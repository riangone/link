/**
 * DOM layer for FriendsManager (friends.js): the "Friends" drawer (device
 * code + friend list + connect/remove) and the incoming-invite dialog.
 * Deliberately kept separate from ui.js so the whole feature is one pair
 * of optional, removable files (friends.js + friends-ui.js) on top of the
 * existing ServerConnection/PeersManager/PeersUI stack — nothing else has
 * to know friends exist; once paired, a friend is just a normal peer id
 * (see FriendsManager#_introducePeer / the 'friend-connect' event).
 */
class FriendsUI extends Dialog {

    constructor(friendsManager) {
        // The incoming-invite confirmation itself follows the same
        // show()/hide() x-dialog pattern as ReceiveDialog etc.
        super('friendInviteDialog');
        this.friends = friendsManager;

        this.$drawer = $('friendsCenter');
        this.$toggle = $('friends-toggle');
        this.$close = $('btn-close-friends-drawer');
        this.$myCode = $('myDeviceCode');
        this.$copyCode = $('btnCopyDeviceCode');
        this.$addInput = $('addFriendCode');
        this.$addBtn = $('btnAddFriend');
        this.$list = $('friends-list');
        this.$emptyState = $('friends-empty-state');

        // Visibility toggle + nearby public-devices directory
        this.$visibilityToggle = $('friendsVisibilityToggle');
        this.$publicList = $('public-devices-list');
        this.$publicEmptyState = $('public-devices-empty-state');

        this.$inviteBody = $('friendInviteBody');
        this.$inviteAccept = $('friendInviteAccept');
        this.$inviteDecline = $('friendInviteDecline');

        // QR code generation (own device code) — see scripts/vendor/qrcode.js
        this.$qrToggle = $('btnToggleDeviceQr');
        this.$qrWrap = $('myDeviceQrWrap');
        this.$qrCanvas = $('myDeviceQr');

        // QR code scanning (add a friend by camera) — see scripts/qr-scan.js
        this.$scanBtn = $('btnScanFriendQr');
        this.qrScanDialog = $('qrScanDialog') ? new Dialog('qrScanDialog') : null;
        this.$scanVideo = $('qrScanVideo');
        this.$scanCanvas = $('qrScanCanvas');
        this.$scanCancel = $('qrScanCancel');
        this.scanner = (window.QrScanner && this.$scanVideo && this.$scanCanvas)
            ? new QrScanner(this.$scanVideo, this.$scanCanvas) : null;

        // Deep-link add-friend confirmation (opened via ?add-friend=<id>)
        this.deepLinkDialog = $('addFriendDeepLinkDialog') ? new Dialog('addFriendDeepLinkDialog') : null;
        this.$deepLinkBody = $('addFriendDeepLinkBody');
        this.$deepLinkAccept = $('addFriendDeepLinkAccept');
        this.$deepLinkDecline = $('addFriendDeepLinkDecline');
        this._pendingDeepLink = null;

        this._presence = new Map(); // deviceId -> 'checking'|'online'|'offline'
        this._pendingInviteFromPeerId = null;
        this._refreshTimer = null;

        // Home-screen "friend is online" cards (independent of the drawer —
        // see FriendsManager's background presence poll).
        this.$onlineSection = $('online-friends-section');
        this.$onlinePeers = $('friend-online-peers');

        if (this.$myCode) this.$myCode.value = this.friends.deviceId;

        if (this.$toggle) this.$toggle.addEventListener('click', e => { e.preventDefault(); this.toggleDrawer(); });
        if (this.$close) this.$close.addEventListener('click', e => { e.preventDefault(); this.hideDrawer(); });
        if (this.$copyCode) this.$copyCode.addEventListener('click', e => { e.preventDefault(); this._copyDeviceCode(); });
        if (this.$addBtn) this.$addBtn.addEventListener('click', e => { e.preventDefault(); this._onAddFriend(); });
        if (this.$addInput) this.$addInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); this._onAddFriend(); }
        });

        if (this.$visibilityToggle) {
            this.$visibilityToggle.checked = this.friends.visible;
            this.$visibilityToggle.addEventListener('change', e => {
                this.friends.setVisibility(e.target.checked);
                Events.fire('notify-user', window.I18n.t(
                    e.target.checked ? 'friends_visibility_on_toast' : 'friends_visibility_off_toast'
                ));
            });
        }

        if (this.$qrToggle) this.$qrToggle.addEventListener('click', e => { e.preventDefault(); this._toggleQr(); });
        if (this.$scanBtn) this.$scanBtn.addEventListener('click', e => { e.preventDefault(); this._openScanner(); });
        if (this.$scanCancel) this.$scanCancel.addEventListener('click', e => { e.preventDefault(); this._closeScanner(); });

        if (this.$deepLinkAccept) this.$deepLinkAccept.addEventListener('click', e => {
            e.preventDefault();
            if (this._pendingDeepLink) {
                this.friends.addFriend(this._pendingDeepLink.deviceId, this._pendingDeepLink.name);
                Events.fire('notify-user', window.I18n.t('friend_added_toast'));
            }
            this._pendingDeepLink = null;
            if (this.deepLinkDialog) this.deepLinkDialog.hide();
        });
        if (this.$deepLinkDecline) this.$deepLinkDecline.addEventListener('click', e => {
            e.preventDefault();
            this._pendingDeepLink = null;
            if (this.deepLinkDialog) this.deepLinkDialog.hide();
        });

        if (this.$inviteAccept) this.$inviteAccept.addEventListener('click', e => {
            e.preventDefault();
            if (this._pendingInviteFromPeerId) this.friends.acceptInvite(this._pendingInviteFromPeerId);
            this._pendingInviteFromPeerId = null;
            this.hide();
        });
        if (this.$inviteDecline) this.$inviteDecline.addEventListener('click', e => {
            e.preventDefault();
            if (this._pendingInviteFromPeerId) this.friends.declineInvite(this._pendingInviteFromPeerId);
            this._pendingInviteFromPeerId = null;
            this.hide();
        });

        Events.on('friends-changed', () => this._render());
        Events.on('friend-presence', e => this._onPresence(e.detail));
        Events.on('friend-invite-received', e => this._onInviteReceived(e.detail));
        Events.on('friend-invite-declined', e => this._onInviteDeclined(e.detail));
        Events.on('friend-invite-timeout', e => this._onInviteTimeout(e.detail));
        Events.on('friend-connected', e => this._onFriendConnected(e.detail));
        Events.on('friend-pong-match-ready', e => this._onPongMatchReady(e.detail));
        Events.on('public-devices-changed', e => this._renderPublicDevices(e.detail));
        Events.on('friends-online-changed', e => this._renderOnlinePeers(e.detail));
        Events.on('language-changed', () => {
            this._render();
            this._renderPublicDevices(this.friends.listPublicDevices());
            this._renderOnlinePeers(this.friends.listOnlineFriends());
        });

        this._render();
        this._renderPublicDevices(this.friends.listPublicDevices());
        this._renderOnlinePeers(this.friends.listOnlineFriends());
        this._checkDeepLink();
    }

    // --- drawer -----------------------------------------------------------

    toggleDrawer() {
        if (this.$drawer.classList.contains('show')) this.hideDrawer();
        else this.showDrawer();
    }

    showDrawer() {
        this.$drawer.classList.add('show');
        this._refreshAllPresence();
        if (this.friends.visible) this.friends.requestPublicDevices();
        clearInterval(this._refreshTimer);
        // Cheap presence poll while the panel is actually open — friends
        // connecting/disconnecting elsewhere doesn't otherwise reach us
        // (unlike same-room peers, there's no server push for this yet).
        // Public-directory join/leave, in contrast, IS pushed live by the
        // server (see friends.js '_onPublicPeerJoined/Left'), so this timer
        // only needs to cover friends presence, not the public list.
        this._refreshTimer = setInterval(() => this._refreshAllPresence(), 15000);
    }

    hideDrawer() {
        this.$drawer.classList.remove('show');
        clearInterval(this._refreshTimer);
        this._refreshTimer = null;
    }

    // --- my device code -----------------------------------------------

    _copyDeviceCode() {
        const done = () => Events.fire('notify-user', window.I18n.t('friends_code_copied'));
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(this.friends.deviceId).then(done).catch(() => this._legacyCopy(done));
        } else {
            this._legacyCopy(done);
        }
    }

    _legacyCopy(done) {
        this.$myCode.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* best effort */ }
    }

    // --- add friend -----------------------------------------------------

    _onAddFriend() {
        const code = (this.$addInput.value || '').trim();
        if (!code) {
            Events.fire('notify-user', window.I18n.t('friends_add_invalid'));
            return;
        }
        // Accept either a bare deviceId (manual paste) or a full add-friend
        // deep link (e.g. pasted from a chat message) — same parsing the QR
        // scanner and the ?add-friend= page-load handler use.
        const parsed = FriendsUI.parseAddFriendUrl(code);
        if (parsed) this.friends.addFriend(parsed.deviceId, parsed.name);
        else this.friends.addFriend(code);
        this.$addInput.value = '';
        Events.fire('notify-user', window.I18n.t('friend_added_toast'));
    }

    // --- QR code: showing my own device code -------------------------

    _toggleQr() {
        if (!this.$qrWrap) return;
        const willShow = this.$qrWrap.hidden;
        if (willShow) this._renderQr();
        this.$qrWrap.hidden = !willShow;
        if (this.$qrToggle) {
            this.$qrToggle.textContent = window.I18n.t(willShow ? 'friends_hide_qr' : 'friends_show_qr');
        }
    }

    _renderQr() {
        if (!this.$qrCanvas || !window.qrcode) return;
        const qr = window.qrcode(0, 'M'); // typeNumber 0 = auto-size to fit the data
        qr.addData(this._buildInviteUrl());
        qr.make();
        const moduleCount = qr.getModuleCount();
        const cellSize = Math.max(2, Math.floor(200 / moduleCount));
        this.$qrCanvas.width = this.$qrCanvas.height = moduleCount * cellSize;
        qr.renderTo2dContext(this.$qrCanvas.getContext('2d'), cellSize);
    }

    /** Encodes this device's id (+ display name) into a scannable/shareable URL. */
    _buildInviteUrl() {
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.set('add-friend', this.friends.deviceId);
        if (window.myDisplayName) url.searchParams.set('n', window.myDisplayName);
        return url.toString();
    }

    // --- QR code: scanning a friend's device code ----------------------

    async _openScanner() {
        if (!this.scanner || !this.qrScanDialog) {
            Events.fire('notify-user', window.I18n.t('qr_scan_no_camera'));
            return;
        }
        this.qrScanDialog.show();
        const ok = await this.scanner.start(
            text => this._onScanDecoded(text),
            () => {
                Events.fire('notify-user', window.I18n.t('qr_scan_no_camera'));
                this._closeScanner();
            }
        );
        if (!ok) this._closeScanner();
    }

    _closeScanner() {
        if (this.scanner) this.scanner.stop();
        if (this.qrScanDialog) this.qrScanDialog.hide();
    }

    _onScanDecoded(text) {
        this._closeScanner();
        const parsed = FriendsUI.parseAddFriendUrl(text);
        if (parsed) {
            this.friends.addFriend(parsed.deviceId, parsed.name);
            Events.fire('notify-user', window.I18n.t('friend_added_toast'));
        } else if (FriendsUI._looksLikeDeviceId(text)) {
            this.friends.addFriend(text.trim());
            Events.fire('notify-user', window.I18n.t('friend_added_toast'));
        } else {
            Events.fire('notify-user', window.I18n.t('qr_scan_invalid'));
        }
    }

    // --- deep link: opened via ?add-friend=<deviceId>&n=<name> -----------

    _checkDeepLink() {
        const params = new URLSearchParams(location.search);
        const deviceId = params.get('add-friend');
        if (!deviceId) return;

        // Always strip the params so a refresh/bookmark doesn't re-trigger
        // the confirmation, and so the deviceId doesn't linger in history.
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('add-friend');
        cleanUrl.searchParams.delete('n');
        history.replaceState(null, '', cleanUrl.toString());

        if (deviceId === this.friends.deviceId) return; // scanned/opened own code
        if (!this.deepLinkDialog) return;

        const name = params.get('n') || '';
        this._pendingDeepLink = { deviceId, name };
        if (this.$deepLinkBody) {
            this.$deepLinkBody.textContent = window.I18n.t('add_friend_deeplink_body', {
                name: name || deviceId.slice(0, 8)
            });
        }
        this.deepLinkDialog.show();
    }

    /** @returns {{deviceId: string, name: string}|null} */
    static parseAddFriendUrl(text) {
        try {
            const url = new URL((text || '').trim());
            const deviceId = url.searchParams.get('add-friend');
            if (!deviceId) return null;
            return { deviceId, name: url.searchParams.get('n') || '' };
        } catch (e) {
            return null; // not a URL at all — e.g. a bare pasted/scanned deviceId
        }
    }

    static _looksLikeDeviceId(text) {
        return /^[0-9a-f-]{8,64}$/i.test((text || '').trim());
    }

    // --- friend list ------------------------------------------------------

    _render() {
        if (!this.$list) return;
        const friends = this.friends.listFriends();
        this.$list.querySelectorAll('.friend-row').forEach(el => el.remove());
        if (this.$emptyState) this.$emptyState.hidden = friends.length > 0;

        friends.forEach(f => this.$list.appendChild(this._buildRow(f)));
    }

    _buildRow(friend) {
        const row = document.createElement('div');
        row.className = 'friend-row row';
        row.dataset.deviceId = friend.deviceId;
        row.style.alignItems = 'center';

        const label = document.createElement('div');
        label.className = 'friend-row-label column grow';
        const name = document.createElement('div');
        name.className = 'font-subheading';
        name.textContent = friend.nickname || `${friend.deviceId.slice(0, 8)}…`;
        const status = document.createElement('div');
        status.className = 'font-body2 friend-row-status';
        status.textContent = window.I18n.t('friends_status_checking');
        label.appendChild(name);
        label.appendChild(status);

        const connectBtn = document.createElement('button');
        connectBtn.className = 'button-link';
        connectBtn.textContent = window.I18n.t('friends_invite_button');
        connectBtn.addEventListener('click', e => {
            e.preventDefault();
            this._onInviteClick(friend, connectBtn);
        });

        const pongBtn = document.createElement('button');
        pongBtn.className = 'button-link friend-game-link';
        pongBtn.textContent = this._gameButtonLabel();
        pongBtn.addEventListener('click', e => {
            e.preventDefault();
            if (this._openGamePicker(friend.deviceId, friend.nickname || friend.deviceId.slice(0, 8))) return;
            this._onPongInviteClick(friend, pongBtn);
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'button-link';
        removeBtn.textContent = window.I18n.t('friends_remove_button');
        removeBtn.addEventListener('click', e => {
            e.preventDefault();
            this.friends.removeFriend(friend.deviceId);
        });

        row.appendChild(label);
        row.appendChild(connectBtn);
        row.appendChild(pongBtn);
        row.appendChild(removeBtn);
        return row;
    }

    async _onInviteClick(friend, btn) {
        btn.disabled = true;
        const name = friend.nickname || friend.deviceId.slice(0, 8);
        try {
            const result = await this.friends.inviteFriend(friend.deviceId);
            if (result === 'offline') {
                Events.fire('notify-user', window.I18n.t('friend_invite_offline_toast', { name }));
            } else {
                Events.fire('notify-user', window.I18n.t('friend_invite_sent_toast'));
            }
        } finally {
            btn.disabled = false;
        }
    }

    async _onPongInviteClick(friend, btn) {
        btn.disabled = true;
        const name = friend.nickname || friend.deviceId.slice(0, 8);
        try {
            const result = await this.friends.invitePongMatch(friend.deviceId);
            if (result === 'offline') {
                Events.fire('notify-user', window.I18n.t('friend_invite_offline_toast', { name }));
            } else {
                Events.fire('notify-user', window.I18n.t('friend_pong_invite_sent_toast'));
            }
        } finally {
            btn.disabled = false;
        }
    }

    _refreshAllPresence() {
        this.friends.listFriends().forEach(f => {
            this._presence.set(f.deviceId, 'checking');
            this.friends.findDevice(f.deviceId); // resolves async via 'friend-presence'
        });
        this._updatePresenceLabels();
    }

    _onPresence(detail) {
        this._presence.set(detail.deviceId, detail.online ? 'online' : 'offline');
        this._updatePresenceLabels();
    }

    _updatePresenceLabels() {
        if (!this.$list) return;
        this.$list.querySelectorAll('.friend-row').forEach(row => {
            const state = this._presence.get(row.dataset.deviceId) || 'checking';
            const statusEl = row.querySelector('.friend-row-status');
            if (!statusEl) return;
            statusEl.textContent = window.I18n.t(
                state === 'online' ? 'friends_status_online'
                    : state === 'offline' ? 'friends_status_offline'
                        : 'friends_status_checking'
            );
            statusEl.classList.toggle('friend-online', state === 'online');
        });
    }

    // --- nearby public devices (directory of peers who opted in) --------

    _renderPublicDevices(devices) {
        if (!this.$publicList) return;
        devices = devices || [];
        this.$publicList.querySelectorAll('.friend-row').forEach(el => el.remove());
        if (this.$publicEmptyState) this.$publicEmptyState.hidden = devices.length > 0;
        devices.forEach(d => this.$publicList.appendChild(this._buildPublicRow(d)));
    }

    _buildPublicRow(device) {
        const row = document.createElement('div');
        row.className = 'friend-row row';
        row.dataset.deviceId = device.deviceId;
        row.style.alignItems = 'center';

        const label = document.createElement('div');
        label.className = 'friend-row-label column grow';
        const name = document.createElement('div');
        name.className = 'font-subheading';
        name.textContent = device.nickname
            || (device.peer && device.peer.name && device.peer.name.displayName)
            || `${device.deviceId.slice(0, 8)}…`;
        const status = document.createElement('div');
        status.className = 'font-body2 friend-row-status friend-online';
        status.textContent = window.I18n.t('friends_status_online');
        label.appendChild(name);
        label.appendChild(status);

        const inviteBtn = document.createElement('button');
        inviteBtn.className = 'button-link';
        inviteBtn.textContent = window.I18n.t('friends_invite_button');
        inviteBtn.addEventListener('click', async e => {
            e.preventDefault();
            inviteBtn.disabled = true;
            const label = device.nickname || device.deviceId.slice(0, 8);
            try {
                const result = await this.friends.invitePublicDevice(device.deviceId);
                Events.fire('notify-user', window.I18n.t(
                    result === 'offline' ? 'friend_invite_offline_toast' : 'friend_invite_sent_toast',
                    { name: label }
                ));
            } finally {
                inviteBtn.disabled = false;
            }
        });

        const pongBtn = document.createElement('button');
        pongBtn.className = 'button-link friend-game-link';
        pongBtn.textContent = this._gameButtonLabel();
        pongBtn.addEventListener('click', async e => {
            e.preventDefault();
            const label = device.nickname
                || (device.peer && device.peer.name && device.peer.name.displayName)
                || device.deviceId.slice(0, 8);
            if (this._openGamePicker(device.deviceId, label)) return;
            pongBtn.disabled = true;
            try {
                const result = await this.friends.invitePongMatch(device.deviceId);
                Events.fire('notify-user', window.I18n.t(
                    result === 'offline' ? 'friend_invite_offline_toast' : 'friend_pong_invite_sent_toast',
                    { name: label }
                ));
            } finally {
                pongBtn.disabled = false;
            }
        });

        row.appendChild(label);
        row.appendChild(inviteBtn);
        row.appendChild(pongBtn);
        return row;
    }

    // --- home-screen "friend is online" cards -----------------------------
    //
    // Separate from `_render()`/`$list` (the Friends drawer's full list,
    // shown/hidden by the user) and from `_renderPublicDevices` (also
    // drawer-only): this section lives directly on the main page and only
    // ever contains friends the background presence poll (see
    // FriendsManager#_pollFriendsPresence) currently believes are online,
    // so a Pong challenge is one click away without opening anything first.

    _renderOnlinePeers(friends) {
        if (!this.$onlinePeers) return;
        friends = friends || [];
        this.$onlinePeers.innerHTML = '';
        friends.forEach(f => this.$onlinePeers.appendChild(this._buildOnlinePeerCard(f)));
        if (this.$onlineSection) this.$onlineSection.hidden = friends.length === 0;
    }

    _buildOnlinePeerCard(friend) {
        const el = document.createElement('x-friend-peer');
        el.id = `friend-peer-${friend.deviceId}`;
        const name = friend.nickname || friend.deviceId.slice(0, 8);

        const card = document.createElement('div');
        card.className = 'friend-peer-card';

        const icon = document.createElement('x-icon');
        icon.setAttribute('shadow', '1');
        icon.innerHTML = '<svg class="icon"><use xlink:href="#desktop-mac"/></svg>';

        const info = document.createElement('div');
        info.className = 'friend-peer-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'name';
        nameEl.textContent = name;

        const statusEl = document.createElement('div');
        statusEl.className = 'status friend-online';
        statusEl.textContent = window.I18n.t('friends_status_online');

        info.appendChild(nameEl);
        info.appendChild(statusEl);

        const pongBtn = document.createElement('button');
        pongBtn.type = 'button';
        pongBtn.className = 'friend-pong-btn friend-game-btn';
        pongBtn.textContent = this._gameButtonLabel();
        pongBtn.title = window.GameInviteUI ? window.I18n.t('game_invite_button_title') : window.I18n.t('friends_invite_pong_button');
        pongBtn.addEventListener('click', async e => {
            e.preventDefault();
            e.stopPropagation();
            await this._sendOnlinePongInvite(friend, name, pongBtn);
        });

        // The card itself is also a shortcut for the same action (covers
        // "click the card" as well as "use the button on it").
        card.addEventListener('click', async e => {
            if (e.target === pongBtn) return; // avoid double-firing the button's own handler
            await this._sendOnlinePongInvite(friend, name, pongBtn);
        });

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(pongBtn);
        el.appendChild(card);
        return el;
    }

    async _sendOnlinePongInvite(friend, name, btn) {
        if (btn.disabled) return;
        if (this._openGamePicker(friend.deviceId, name)) return;
        btn.disabled = true;
        try {
            const result = await this.friends.invitePongMatch(friend.deviceId);
            Events.fire('notify-user', window.I18n.t(
                result === 'offline' ? 'friend_invite_offline_toast' : 'friend_pong_invite_sent_toast',
                { name }
            ));
        } finally {
            btn.disabled = false;
        }
    }

    // --- game challenges (game-invite.js) ----------------------------------

    _gameButtonLabel() {
        return window.GameInviteUI
            ? `🎮 ${window.I18n.t('game_invite_button')}`
            : window.I18n.t('friends_invite_pong_button');
    }

    /** Opens the shared game picker; returns false if game-invite.js isn't loaded. */
    _openGamePicker(deviceId, name) {
        if (!window.GameInviteUI) return false;
        Events.fire('game-invite-pick', { deviceId, name });
        return true;
    }

    // --- incoming invites -------------------------------------------------

    _onInviteReceived(detail) {
        this._pendingInviteFromPeerId = detail.peerId;
        const name = detail.fromName || detail.deviceId.slice(0, 8);
        const bodyKey = detail.kind === 'pong' ? 'friend_invite_incoming_pong_body' : 'friend_invite_incoming_body';
        if (this.$inviteBody) this.$inviteBody.textContent = window.I18n.t(bodyKey, { name });
        this.show();
    }

    /**
     * Fired once both sides of a Pong invite agreed (see friends.js class
     * doc) — the roomId already travelled inside the invite payload, so
     * there's nothing left to do here but hop over to the shared room.
     * Pong's own room-based signaling (client/pong/game.js) takes it from
     * there unmodified.
     */
    _onPongMatchReady(detail) {
        Events.fire('notify-user', window.I18n.t('friend_pong_match_starting_toast'));
        const url = new URL('pong/', location.href);
        if (detail.name) url.searchParams.set('opponent', detail.name);
        url.hash = `room-${detail.roomId}`;
        location.href = url.toString();
    }

    _onInviteDeclined(detail) {
        const f = this.friends.listFriends().find(x => x.deviceId === detail.deviceId);
        const name = (f && f.nickname) || (detail.deviceId || '').slice(0, 8);
        Events.fire('notify-user', window.I18n.t('friend_invite_declined_toast', { name }));
    }

    _onInviteTimeout(detail) {
        const f = this.friends.listFriends().find(x => x.deviceId === detail.deviceId);
        const name = (f && f.nickname) || (detail.deviceId || '').slice(0, 8);
        Events.fire('notify-user', window.I18n.t('friend_invite_timeout_toast', { name }));
    }

    _onFriendConnected(detail) {
        Events.fire('notify-user', window.I18n.t('friend_connected_toast', { name: detail.name || 'friend' }));
    }
}

window.FriendsUI = FriendsUI;
