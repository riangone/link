/**
 * Cross-network "friends" layer, built on top of the signaling relay in
 * server/index.js (`bind-device` / `find-device` / the generic `to` relay,
 * now with a global cross-room fallback — see that file's comments).
 *
 * The problem this solves: `PeersManager` (network.js) only ever learns
 * about peers the signaling server put in the *same room* (same IP, or
 * same `?room=` id) as us. Two devices on different networks never share a
 * room, so they can never see each other there — no matter how the room
 * was chosen, someone still has to share a URL/room-id/QR code every time.
 *
 * FriendsManager instead gives each browser a stable, random `deviceId`
 * (persisted in localStorage, survives across networks/sessions). Devices
 * exchange that id with each other *once*, out-of-band (read it aloud,
 * copy-paste, paste into a chat) and save each other as a "friend". From
 * then on, either side can ask the server "is deviceId X online right now,
 * and if so what's its current peer id?" (`find-device`) and, if yes, send
 * it an app-level invite over the same relay. Once accepted, the resulting
 * peer id is just... a normal peer id: it's handed to the existing
 * `PeersManager`/`RTCPeer`/`WSPeer` machinery unchanged, so file transfer,
 * chat, and anything else built on `peersManager.sendTo(peerId, ...)`
 * automatically works with friends too, not just same-room peers.
 *
 * Emits (via the shared `Events` bus):
 *   - 'friends-changed'                friend list (added/removed/renamed)
 *   - 'friend-presence' {deviceId, online, peerId?}   result of a lookup
 *   - 'friend-invite-received' {peerId, deviceId, fromName}   incoming invite
 *   - 'friend-invite-declined' {peerId}
 *   - 'friend-invite-timeout' {peerId}
 *   - 'friend-connected' {peerId, deviceId, name}   safe to treat as a peer now
 *   - 'friend-pong-match-ready' {peerId, deviceId, roomId, name}   both sides
 *        accepted a Pong invite; DOM layer should navigate to pong/#room-<roomId>
 *   - 'visibility-changed' {visible}                own public-directory opt-in flipped
 *   - 'public-devices-changed'                       nearby-public-devices list changed
 *   - 'friends-online-changed' [{deviceId, nickname, peerId}, ...]   which
 *        friends are *currently* reachable, kept fresh by a background
 *        `find-device` poll (see `_pollFriendsPresence`) so the DOM layer can
 *        render a "friend online" card on the home screen without the
 *        Friends drawer ever being opened.
 *
 * Pong matchmaking piggybacks on the exact same invite/invite-response
 * handshake described above instead of teaching Pong (client/pong/game.js)
 * anything about deviceId/friends: `invitePongMatch()` sends a normal
 * `invite` with two extra fields (`kind: 'pong'`, a freshly-generated
 * `roomId`), and once the other side accepts, both browsers already agree
 * on the same roomId (it travelled inside the invite payload, nobody has to
 * derive/hash anything) and can navigate straight to `pong/#room-<roomId>`.
 * Pong's own room-based signaling then pairs them exactly like today, the
 * only thing that changed is *how* two browsers ended up on the same hash.
 *
 * When the challenger and the target are already friends, the receiving
 * side auto-answers the Pong invite instead of surfacing an accept/decline
 * dialog (see `_onInviteReceived`): friendship is itself the trust check,
 * so both browsers jump straight into the match. Non-friends (e.g. reached
 * through the public directory) still go through the normal dialog.
 *
 * Public directory (opt-in, off the same `bind-device` handshake as the
 * deviceId itself): when `visible` is true, this device's {deviceId,
 * nickname, peer} is listed on the server in a process-wide directory that
 * *any* connected client can request a snapshot of (`list-public-devices`)
 * and gets pushed live join/leave events for. This is deliberately a
 * separate, coarser trust tier from the friends list above — being
 * "public" means any stranger can see and invite you (still subject to the
 * same accept/decline handshake), whereas the deviceId/`find-device` path
 * only resolves a peer id for someone who already *has* the exact id. Set
 * `visible = false` and the server actually removes the directory entry
 * (see server/index.js bind-device), not just hides it client-side.
 */
class FriendsManager {

    static DEVICE_ID_KEY = 'link-device-id';
    static FRIENDS_KEY = 'link-friends';
    static VISIBLE_KEY = 'link-device-visible';
    static FIND_TIMEOUT_MS = 6000;
    static INVITE_TIMEOUT_MS = 30000;
    static PRESENCE_POLL_MS = 10000;

    constructor(serverConnection) {
        this._server = serverConnection;
        this.deviceId = this._loadOrCreateDeviceId();
        this._friends = this._loadFriends(); // deviceId -> {deviceId, nickname, addedAt}
        this._pendingFinds = new Map(); // deviceId -> [{resolve, timer}]
        this._pendingInvites = new Map(); // peerId -> {deviceId, timer} (invites *we* sent, awaiting a response)
        this._pendingIncoming = new Map(); // peerId -> {deviceId, fromName} (invites others sent *us*, awaiting our answer)
        this.visible = this._loadVisibility(); // default true — see class doc
        this._publicDevices = new Map(); // deviceId -> {deviceId, nickname, peer}
        this._onlineFriends = new Map(); // deviceId -> {deviceId, nickname, peerId} — see 'friends-online-changed'

        Events.on('ws-connected', () => this._bindDevice());
        Events.on('ws-connected', () => this._pollFriendsPresence());
        Events.on('find-device-result', e => this._onFindDeviceResult(e.detail));
        Events.on('friend-invite', e => this._onInviteReceived(e.detail));
        Events.on('friend-invite-response', e => this._onInviteResponse(e.detail));
        Events.on('friend-invite-cancel', e => this._onInviteCancelled(e.detail));
        Events.on('public-devices', e => this._onPublicDevices(e.detail));
        Events.on('public-peer-joined', e => this._onPublicPeerJoined(e.detail));
        Events.on('public-peer-left', e => this._onPublicPeerLeft(e.detail));
        // `window.myDisplayName` isn't known yet the first time `ws-connected`
        // fires bind-device (the server's `display-name` reply is still in
        // flight), and it can change later via the nickname editor — re-bind
        // in both cases so a public directory entry doesn't stay stuck with
        // an empty/stale nickname. No-op server-side cost: bind-device is
        // idempotent and cheap.
        Events.on('display-name', () => { if (this._server._isConnected && this._server._isConnected()) this._bindDevice(); });
        Events.on('change-nickname-request', () => { if (this._server._isConnected && this._server._isConnected()) this._bindDevice(); });

        // the socket may already be open by the time this runs (script
        // load order), so also bind immediately if so
        if (this._server._isConnected && this._server._isConnected()) this._bindDevice();

        // Background presence poll for the whole friends list, independent
        // of the Friends drawer being open — this is what lets a "friend
        // online" card show up on the home screen unprompted. Each tick is
        // just a handful of cheap `find-device` round trips (server answers
        // synchronously, see server/index.js 'find-device'); results flow
        // back through the same `_onFindDeviceResult` used everywhere else.
        this._presenceTimer = setInterval(() => this._pollFriendsPresence(), FriendsManager.PRESENCE_POLL_MS);
        if (this._server._isConnected && this._server._isConnected()) this._pollFriendsPresence();
    }

    /**
     * Re-check every known friend's presence. No-op while offline or with
     * an empty friends list. Safe to call often — `findDevice` just adds
     * another waiter if a lookup for the same deviceId is already in flight.
     */
    _pollFriendsPresence() {
        if (!this._friends.size) return;
        if (!(this._server._isConnected && this._server._isConnected())) return;
        for (const deviceId of this._friends.keys()) this.findDevice(deviceId);
    }

    /** @returns {{deviceId: string, nickname: string, peerId: string}[]} */
    listOnlineFriends() {
        return [...this._onlineFriends.values()];
    }

    // --- identity -----------------------------------------------------

    _loadOrCreateDeviceId() {
        let id = localStorage.getItem(FriendsManager.DEVICE_ID_KEY);
        if (!id) {
            id = (crypto.randomUUID ? crypto.randomUUID() : FriendsManager._fallbackUuid());
            localStorage.setItem(FriendsManager.DEVICE_ID_KEY, id);
        }
        return id;
    }

    static _fallbackUuid() {
        // crypto.randomUUID() is unavailable on non-secure-context http
        // origins in some browsers; fall back to getRandomValues.
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    _bindDevice() {
        this._server.send({
            type: 'bind-device',
            deviceId: this.deviceId,
            public: this.visible,
            nickname: window.myDisplayName
        });
        // a fresh connection means the server's directory (if we're public)
        // was just rebuilt from scratch — reload our view of it too instead
        // of trusting a possibly-stale local snapshot from before a reconnect.
        if (this.visible) this.requestPublicDevices();
    }

    // --- visibility (public directory opt-in) --------------------------

    _loadVisibility() {
        const raw = localStorage.getItem(FriendsManager.VISIBLE_KEY);
        return raw === null ? true : raw === 'true'; // default: public
    }

    /**
     * Flip whether this device is listed in the cross-network public
     * directory. Re-sends `bind-device` immediately so the server-side
     * effect (add/remove from `_publicDevices`) is not delayed until the
     * next reconnect.
     * @param {boolean} visible
     */
    setVisibility(visible) {
        visible = !!visible;
        if (visible === this.visible) return;
        this.visible = visible;
        localStorage.setItem(FriendsManager.VISIBLE_KEY, String(visible));
        if (!visible) this._publicDevices.clear(); // we're no longer entitled to keep watching the directory either
        this._bindDevice();
        Events.fire('visibility-changed', { visible });
        if (!visible) Events.fire('public-devices-changed', this.listPublicDevices());
    }

    // --- public directory (nearby/online devices that opted in) --------

    requestPublicDevices() {
        this._server.send({ type: 'list-public-devices' });
    }

    listPublicDevices() {
        return [...this._publicDevices.values()];
    }

    _onPublicDevices(devices) {
        this._publicDevices.clear();
        (devices || []).forEach(d => this._publicDevices.set(d.deviceId, d));
        Events.fire('public-devices-changed', this.listPublicDevices());
    }

    _onPublicPeerJoined(msg) {
        if (msg.deviceId === this.deviceId) return; // shouldn't happen (server excludes sender), but be defensive
        this._publicDevices.set(msg.deviceId, { deviceId: msg.deviceId, nickname: msg.nickname, peer: msg.peer });
        Events.fire('public-devices-changed', this.listPublicDevices());
    }

    _onPublicPeerLeft(msg) {
        if (this._publicDevices.delete(msg.deviceId)) {
            Events.fire('public-devices-changed', this.listPublicDevices());
        }
    }

    /**
     * Invite a device discovered through the public directory. This is
     * exactly `inviteFriend` — the invite/accept/decline handshake, and the
     * auto-save-as-friend-on-accept behaviour, don't care whether the
     * deviceId came from the friends list or the public directory.
     * @returns {Promise<'sent'|'offline'>}
     */
    invitePublicDevice(deviceId) {
        return this.inviteFriend(deviceId);
    }

    // --- friend list persistence --------------------------------------

    _loadFriends() {
        try {
            const raw = JSON.parse(localStorage.getItem(FriendsManager.FRIENDS_KEY) || '[]');
            const map = new Map();
            raw.forEach(f => f && f.deviceId && map.set(f.deviceId, f));
            return map;
        } catch (e) {
            return new Map();
        }
    }

    _saveFriends() {
        localStorage.setItem(FriendsManager.FRIENDS_KEY, JSON.stringify([...this._friends.values()]));
        Events.fire('friends-changed', this.listFriends());
    }

    listFriends() {
        return [...this._friends.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    }

    addFriend(deviceId, nickname) {
        deviceId = (deviceId || '').trim();
        if (!deviceId) return false;
        if (deviceId === this.deviceId) return false; // can't friend yourself
        const existing = this._friends.get(deviceId);
        this._friends.set(deviceId, {
            deviceId,
            nickname: (nickname || (existing && existing.nickname) || '').trim(),
            addedAt: (existing && existing.addedAt) || Date.now()
        });
        this._saveFriends();
        this._pollFriendsPresence(); // don't make them wait a full poll tick to see the new friend's card
        return true;
    }

    removeFriend(deviceId) {
        if (this._friends.delete(deviceId)) {
            this._saveFriends();
            if (this._onlineFriends.delete(deviceId)) {
                Events.fire('friends-online-changed', this.listOnlineFriends());
            }
        }
    }

    renameFriend(deviceId, nickname) {
        const f = this._friends.get(deviceId);
        if (!f) return;
        f.nickname = (nickname || '').trim();
        this._saveFriends();
        const online = this._onlineFriends.get(deviceId);
        if (online) {
            online.nickname = f.nickname;
            Events.fire('friends-online-changed', this.listOnlineFriends());
        }
    }

    // --- presence lookup -------------------------------------------------

    /**
     * Ask the server whether `deviceId` is currently online (on *any*
     * room/network) and, if so, what its live peer id is right now.
     * @returns {Promise<{online: boolean, peerId?: string, peer?: object}>}
     */
    findDevice(deviceId) {
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                const list = this._pendingFinds.get(deviceId);
                if (list) {
                    const idx = list.findIndex(w => w.resolve === resolve);
                    if (idx > -1) list.splice(idx, 1);
                }
                resolve({ online: false, timedOut: true });
            }, FriendsManager.FIND_TIMEOUT_MS);

            if (!this._pendingFinds.has(deviceId)) this._pendingFinds.set(deviceId, []);
            this._pendingFinds.get(deviceId).push({ resolve, timer });

            this._server.send({ type: 'find-device', deviceId });
        });
    }

    _onFindDeviceResult(msg) {
        Events.fire('friend-presence', { deviceId: msg.deviceId, online: msg.online, peerId: msg.peerId });

        if (this._friends.has(msg.deviceId)) {
            const prev = this._onlineFriends.get(msg.deviceId);
            if (msg.online) {
                const friend = this._friends.get(msg.deviceId);
                this._onlineFriends.set(msg.deviceId, {
                    deviceId: msg.deviceId,
                    nickname: (friend && friend.nickname)
                        || (msg.peer && msg.peer.name && msg.peer.name.displayName) || '',
                    peerId: msg.peerId
                });
            } else {
                this._onlineFriends.delete(msg.deviceId);
            }
            const changed = (!!prev) !== !!msg.online || (prev && prev.peerId !== msg.peerId);
            if (changed) Events.fire('friends-online-changed', this.listOnlineFriends());
        }

        const waiters = this._pendingFinds.get(msg.deviceId);
        if (!waiters || !waiters.length) return;
        this._pendingFinds.delete(msg.deviceId);
        waiters.forEach(w => {
            clearTimeout(w.timer);
            w.resolve({ online: msg.online, peerId: msg.peerId, peer: msg.peer });
        });
    }

    // --- inviting a friend ------------------------------------------------

    /**
     * Look up a friend and, if they're online, send them an invite. The
     * actual pairing (peer card + WebRTC connection) happens once they
     * accept — see `_onInviteResponse`.
     * @returns {Promise<'sent'|'offline'>}
     */
    inviteFriend(deviceId) {
        return this._sendInvite(deviceId, {});
    }

    /**
     * Same handshake as `inviteFriend`, tagged as a Pong match request with
     * a fresh deterministic room id attached. See the class doc for why
     * this doesn't need Pong to know anything about deviceIds.
     * @returns {Promise<'sent'|'offline'>}
     */
    invitePongMatch(deviceId) {
        return this._sendInvite(deviceId, { kind: 'pong', roomId: FriendsManager._randomRoomId() });
    }

    static _randomRoomId() {
        return Math.random().toString(36).substring(2, 9);
    }

    async _sendInvite(deviceId, extra) {
        const result = await this.findDevice(deviceId);
        if (!result.online) return 'offline';

        const peerId = result.peerId;
        const timer = setTimeout(() => {
            if (this._pendingInvites.delete(peerId)) {
                Events.fire('friend-invite-timeout', { peerId, deviceId });
            }
        }, FriendsManager.INVITE_TIMEOUT_MS);
        this._pendingInvites.set(peerId, { deviceId, timer, peerInfo: result.peer, ...extra });

        this._server.send({
            type: 'invite',
            to: peerId,
            fromDeviceId: this.deviceId,
            fromName: window.myDisplayName || 'A friend',
            ...extra
        });
        return 'sent';
    }

    cancelInvite(peerId) {
        const pending = this._pendingInvites.get(peerId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this._pendingInvites.delete(peerId);
        this._server.send({ type: 'invite-cancel', to: peerId });
    }

    _onInviteResponse(msg) {
        const peerId = msg.sender;
        const pending = this._pendingInvites.get(peerId);
        if (!pending) return; // stale/duplicate/unsolicited response, ignore
        clearTimeout(pending.timer);
        this._pendingInvites.delete(peerId);

        if (!msg.accept) {
            Events.fire('friend-invite-declined', { peerId, deviceId: pending.deviceId, kind: pending.kind });
            return;
        }

        // Auto-save as a friend on first successful pairing so future
        // invites don't require re-sharing the deviceId.
        if (!this._friends.has(pending.deviceId)) this.addFriend(pending.deviceId);

        if (pending.kind === 'pong') {
            // Both sides already agree on pending.roomId (it was sent inside
            // the original invite) — nothing left to negotiate, just let the
            // DOM layer navigate. No WebRTC pairing on *this* connection.
            const friend = this._friends.get(pending.deviceId);
            Events.fire('friend-pong-match-ready', {
                peerId, deviceId: pending.deviceId, roomId: pending.roomId,
                name: (friend && friend.nickname) || (pending.peerInfo && pending.peerInfo.name && pending.peerInfo.name.displayName)
            });
            return;
        }

        this._introducePeer(peerId, pending.deviceId, pending.peerInfo);
        // We're the one who initiated the invite, so we also initiate the
        // actual WebRTC connection (avoids both sides racing to be caller).
        Events.fire('friend-connect', peerId);
    }

    // --- receiving an invite ------------------------------------------

    _onInviteReceived(msg) {
        const peerId = msg.sender;

        // Pong challenges between two people who are *already* friends skip
        // the confirmation dialog entirely: the trust decision was already
        // made once, at add-friend time, so re-confirming it per match is
        // pure friction. The invite/invite-response handshake still runs in
        // full (server-side wiring untouched) — this side just answers it
        // itself instead of waiting on a human to click Accept, so both
        // browsers land in the same Pong room within one round trip.
        // Pong challenges from a not-yet-friend (e.g. via the public
        // directory) still go through the normal accept/decline dialog
        // below, same as any other invite.
        if (msg.kind === 'pong' && this._friends.has(msg.fromDeviceId)) {
            this._server.send({ type: 'invite-response', to: peerId, accept: true, fromDeviceId: this.deviceId });
            Events.fire('friend-pong-match-ready', {
                peerId, deviceId: msg.fromDeviceId, roomId: msg.roomId, name: msg.fromName
            });
            return;
        }

        this._pendingIncoming.set(peerId, {
            deviceId: msg.fromDeviceId, fromName: msg.fromName, kind: msg.kind, roomId: msg.roomId
        });
        Events.fire('friend-invite-received', {
            peerId, deviceId: msg.fromDeviceId, fromName: msg.fromName, kind: msg.kind, roomId: msg.roomId
        });
    }

    _onInviteCancelled(msg) {
        const peerId = msg.sender;
        if (this._pendingIncoming.delete(peerId)) {
            Events.fire('friend-invite-cancel', { peerId });
        }
    }

    acceptInvite(peerId) {
        const pending = this._pendingIncoming.get(peerId);
        if (!pending) return;
        this._pendingIncoming.delete(peerId);

        if (!this._friends.has(pending.deviceId)) this.addFriend(pending.deviceId, pending.fromName);

        this._server.send({ type: 'invite-response', to: peerId, accept: true, fromDeviceId: this.deviceId });

        if (pending.kind === 'pong') {
            Events.fire('friend-pong-match-ready', {
                peerId, deviceId: pending.deviceId, roomId: pending.roomId, name: pending.fromName
            });
            return;
        }

        this._introducePeer(peerId, pending.deviceId, {
            id: peerId,
            name: { displayName: pending.fromName || 'Friend', deviceName: 'Friend' },
            rtcSupported: true
        });
        // We're the callee: don't initiate a connection ourselves, just
        // wait — PeersManager already lazily creates an answerer RTCPeer
        // the moment the caller's first `signal` message arrives.
    }

    declineInvite(peerId) {
        if (!this._pendingIncoming.delete(peerId)) return;
        this._server.send({ type: 'invite-response', to: peerId, accept: false });
    }

    /**
     * Make the rest of the app (peer list UI, PeersManager) treat this
     * friend exactly like any other discovered peer, without waiting for
     * the WebRTC handshake to finish first.
     */
    _introducePeer(peerId, deviceId, peerInfo) {
        const info = peerInfo || { id: peerId, name: { displayName: 'Friend', deviceName: 'Friend' }, rtcSupported: true };
        Events.fire('peer-joined', info);
        Events.fire('friend-connected', { peerId, deviceId, name: info.name && info.name.displayName });
    }
}

window.FriendsManager = FriendsManager;
