var process = require('process')
// Handle SIGINT
process.on('SIGINT', () => {
  console.info("SIGINT Received, exiting...")
  process.exit(0)
})

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.info("SIGTERM Received, exiting...")
  process.exit(0)
})

const parser = require('ua-parser-js');
const { uniqueNamesGenerator, animals, colors } = require('unique-names-generator');
const url = require('url');
const crypto = require('crypto');
const { Matchmaker } = require('./matchmaker');

const TURN_SECRET = process.env.TURN_SECRET || 'snapdrop-static-auth-secret-12345';
const TURN_URLS = [
    'turn:link.0101.click:3478?transport=udp',
    'turn:link.0101.click:3478?transport=tcp'
];

// --- Abuse-protection tunables (all overridable via env for ops flexibility) ---
const ROOM_MAX_PEERS = parseInt(process.env.ROOM_MAX_PEERS || '50', 10);
// 60 (not 30): chat text relayed over WSPeer (WebRTC fallback) is now chunked
// (see TEXT_CHUNK_CHARS in client/scripts/network.js) and each chunk plus its
// text-ack counts as a separate signaling message, so a single long pasted
// message from one peer can legitimately burst well past a 30/window budget.
// 150: in-game WS relay (GameSession fallback when WebRTC can't connect)
// sends 60Hz input + 30Hz state + pings on this socket; 60 dropped inputs
// and occasionally the keepalive pong itself.
const RATE_LIMIT_MAX_MESSAGES = parseInt(process.env.RATE_LIMIT_MAX_MESSAGES || '150', 10); // per window
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '1000', 10); // 1s window
// NOT just "signaling msgs are small": WSPeer (network.js) is the relay
// fallback used whenever a direct RTCDataChannel can't be established
// (no TURN reachable, symmetric NAT, WebRTC unsupported — i.e. exactly
// the cross-network case) and it DOES push file bytes over this same
// WebSocket, base64-encoded, in 64000-byte-raw FileChunker chunks
// (see FileChunker._chunkSize / WSPeer._sendArrayBuffer in
// client/scripts/network.js). Base64 inflates that to ceil(64000/3)*4 =
// 85336 bytes before JSON-wrapping it in {type,to,message,isBinary}.
// A 64KB cap silently killed every such connection with a 1009 "message
// too big" close the instant a WSPeer file transfer sent its first
// chunk — this must stay comfortably above that ~85.5KB floor.
const WS_MAX_PAYLOAD_BYTES = parseInt(process.env.WS_MAX_PAYLOAD_BYTES || String(128 * 1024), 10);
// Cap on how many entries a `list-public-devices` snapshot returns, so an
// instance with lots of concurrently "public" devices can't be turned into
// an unbounded-size response (and, incidentally, keeps the directory usable
// as a UI list rather than an endless scroll).
const PUBLIC_DEVICES_MAX = parseInt(process.env.PUBLIC_DEVICES_MAX || '200', 10);

/**
 * Generate short-lived, time-limited TURN credentials using the
 * coturn `use-auth-secret` HMAC scheme, so credentials cannot be
 * replayed indefinitely if leaked.
 * @param {string} username - stable identifier to embed in the TURN username (e.g. peer id)
 * @returns {{username: string, password: string}} ephemeral TURN credential pair
 */
function getTurnCredentials(username) {
    const unixTimestamp = parseInt(Date.now() / 1000) + 24 * 3600; // 24 hours validity
    const turnUsername = [unixTimestamp, username].join(':');
    const hmac = crypto.createHmac('sha1', TURN_SECRET);
    hmac.update(turnUsername);
    const password = hmac.digest('base64');
    return {
        username: turnUsername,
        password: password
    };
}

/**
 * Simple fixed-window rate limiter, one instance per peer.
 * Not distributed/shared across processes on purpose: it only needs to
 * stop a single abusive socket from flooding this process, which is
 * enough given each peer holds exactly one WebSocket connection here.
 */
class RateLimiter {
    /**
     * @param {number} maxMessages - max messages allowed per window
     * @param {number} windowMs - window size in milliseconds
     */
    constructor(maxMessages = RATE_LIMIT_MAX_MESSAGES, windowMs = RATE_LIMIT_WINDOW_MS) {
        this._maxMessages = maxMessages;
        this._windowMs = windowMs;
        this._count = 0;
        this._windowStart = Date.now();
    }

    /**
     * Record one message and report whether the caller is over the limit.
     * @returns {boolean} true if this message should be dropped (limit exceeded)
     */
    isLimited() {
        const now = Date.now();
        if (now - this._windowStart >= this._windowMs) {
            this._windowStart = now;
            this._count = 0;
        }
        this._count += 1;
        return this._count > this._maxMessages;
    }
}

/**
 * The signaling server. Does not touch file bytes — it only helps peers on
 * the same "room" (same IP, or same `?room=` id) find each other and
 * exchange WebRTC offer/answer/ICE messages. Rooms and peers live in
 * memory only (`this._rooms`), so state does not survive a restart and
 * does not scale horizontally across processes/instances as-is
 * (see docs/ROADMAP.md for the Redis-backed multi-instance design).
 */
class SnapdropServer {

    /**
     * @param {number|null} port - port to listen on; ignored (may be null) when `httpServer` is provided
     * @param {import('http').Server} [httpServer] - an already-listening HTTP server to attach the
     *   WebSocket upgrade handler to instead of binding a dedicated port. This lets a single process
     *   serve both static client files and signaling on one origin — used by the e2e test harness, and
     *   optionally usable in production as an nginx-free single-process deployment.
     */
    constructor(port, httpServer) {
        const WebSocket = require('ws');
        this._wss = httpServer
            ? new WebSocket.Server({ server: httpServer, maxPayload: WS_MAX_PAYLOAD_BYTES })
            : new WebSocket.Server({ port: port, maxPayload: WS_MAX_PAYLOAD_BYTES });
        this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
        // 对战大厅 matchmaking (see matchmaker.js)
        this._matchmaker = new Matchmaker((peer, msg) => this._send(peer, msg));
        this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

        this._rooms = {};

        // --- deviceId-based friend routing (independent of IP/room scoping) ---
        // `_peersById` indexes every currently-connected peer by its raw id,
        // regardless of which room it's in. `_devices` maps a client-chosen,
        // persistent `deviceId` (kept in the browser's localStorage across
        // sessions/networks) to the id of whichever peer currently "owns" it.
        // Together they let two devices that were never on the same
        // room/network find each other's *current* peer id (`find-device`)
        // and then exchange messages via the relay below — this is what
        // makes cross-network friend invites (and, by extension, direct
        // file-transfer/chat with a known device) possible without sharing
        // a room URL. See `_onMessage`'s relay section for the trust model.
        this._peersById = {};
        this._devices = {};

        // `_publicDevices` is a separate, opt-in directory layered on top of
        // `_devices`: a peer only ends up here if it explicitly asked to be
        // discoverable (`bind-device` with `public: true`), so "make my
        // device private" is a real guarantee (the entry is removed, not
        // just hidden client-side) rather than "unlisted but still
        // resolvable" like the precise-deviceId lookup (`find-device`)
        // intentionally is. Keyed by deviceId -> {peerId, nickname, ts}.
        this._publicDevices = {};

        console.log('Snapdrop is running on', httpServer ? 'attached http server' : `port ${port}`);
    }

    _onConnection(peer) {
        if (!this._joinRoom(peer)) {
            // room is full: reject the connection instead of silently degrading UX for everyone else in it
            this._send(peer, { type: 'room-full' });
            peer.socket.close(1013, 'Room full');
            return;
        }
        peer.socket.on('message', message => this._onMessage(peer, message));
        peer.socket.on('error', console.error);
        // Clean up immediately when the underlying connection drops for any
        // reason (browser crash, tab killed, network loss, etc.), not just
        // on a clean {type:'disconnect'} message. Without this, other peers
        // keep seeing a "ghost" device for up to ~60s (until the lazy
        // keepalive timeout catches up) — reproduced by the E2E suite,
        // where Playwright closing a browser context never sends
        // `disconnect`, only closes the socket.
        peer.socket.on('close', () => this._leaveRoom(peer));
        this._keepAlive(peer);

        // send displayName
        this._send(peer, {
            type: 'display-name',
            message: {
                displayName: peer.name.displayName,
                deviceName: peer.name.deviceName
            }
        });

        // send turn-config with dynamically generated credentials
        const creds = getTurnCredentials(peer.id);
        this._send(peer, {
            type: 'turn-config',
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                {
                    urls: TURN_URLS,
                    username: creds.username,
                    credential: creds.password
                }
            ]
        });
    }

    _onHeaders(headers, response) {
        const parsedUrl = url.parse(response.url || '', true);
        if (parsedUrl.query && parsedUrl.query.room) {
            response.peerId = Peer.uuid();
            return;
        }
        if (response.headers.cookie && /(?:^|;\s*)peerid=([^;]+)/.test(response.headers.cookie)) return;
        response.peerId = Peer.uuid();
        headers.push('Set-Cookie: peerid=' + response.peerId + "; Path=/; SameSite=Strict; Secure");
    }

    /**
     * Handle one raw WebSocket message from `sender`: local control
     * messages (disconnect/pong/change-nickname) are handled directly;
     * anything with a `to` field is relayed verbatim to that peer id
     * within the sender's room (this is how WebRTC offer/answer/ICE
     * `signal` messages, and WSPeer-relayed file chunks, actually travel).
     * @param {Peer} sender
     * @param {string|Buffer} message - raw (not yet JSON-parsed) message
     */
    _onMessage(sender, message) {
        // Per-peer rate limiting: a single misbehaving/malicious client
        // must not be able to flood the room or this process.
        if (sender.rateLimiter.isLimited()) {
            return;
        }

        // Try to parse message
        try {
            message = JSON.parse(message);
        } catch (e) {
            return; // TODO: handle malformed JSON
        }

        if (this._matchmaker.handle(sender, message)) return;

        switch (message.type) {
            case 'disconnect':
                this._leaveRoom(sender);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
            case 'change-nickname':
                sender.name.displayName = message.displayName;
                if (this._rooms[sender.ip]) {
                    for (const otherPeerId in this._rooms[sender.ip]) {
                        if (otherPeerId === sender.id) continue;
                        const otherPeer = this._rooms[sender.ip][otherPeerId];
                        this._send(otherPeer, {
                            type: 'peer-nickname-changed',
                            peerId: sender.id,
                            displayName: message.displayName
                        });
                    }
                }
                break;
            case 'bind-device':
                // Client registers (or re-registers, e.g. after a
                // reconnect) the stable deviceId it persists locally so
                // friends can look it up later regardless of which
                // room/network this connection happens to be in. An
                // optional `public: true` additionally lists it in the
                // cross-network discovery directory (see `_publicDevices`)
                // so *unknown* peers can find and invite it without ever
                // having exchanged the deviceId out-of-band first.
                if (typeof message.deviceId === 'string' && message.deviceId.length > 0 && message.deviceId.length <= 128) {
                    // release a stale mapping left by this same peer under a
                    // previous deviceId (shouldn't normally happen, but keeps
                    // _devices from accumulating dead entries if it does)
                    if (sender.deviceId && sender.deviceId !== message.deviceId && this._devices[sender.deviceId] === sender.id) {
                        delete this._devices[sender.deviceId];
                    }
                    // same cleanup for the public directory, keyed the same way
                    if (sender.deviceId && sender.deviceId !== message.deviceId
                        && this._publicDevices[sender.deviceId] && this._publicDevices[sender.deviceId].peerId === sender.id) {
                        delete this._publicDevices[sender.deviceId];
                        this._broadcastPublic({ type: 'public-peer-left', deviceId: sender.deviceId }, sender.id);
                    }

                    sender.deviceId = message.deviceId;
                    this._devices[message.deviceId] = sender.id;

                    const nickname = typeof message.nickname === 'string' ? message.nickname.slice(0, 64) : undefined;

                    if (message.public) {
                        this._publicDevices[message.deviceId] = { peerId: sender.id, deviceId: message.deviceId, nickname, ts: Date.now() };
                        this._broadcastPublic({
                            type: 'public-peer-joined',
                            deviceId: message.deviceId,
                            nickname,
                            peer: sender.getInfo()
                        }, sender.id);
                    } else if (this._publicDevices[message.deviceId]) {
                        // client flipped visibility off (or reconnected without
                        // re-asserting it) — this is the "go private" path, a
                        // real removal from the directory, not just a client-side hide.
                        delete this._publicDevices[message.deviceId];
                        this._broadcastPublic({ type: 'public-peer-left', deviceId: message.deviceId }, sender.id);
                    }
                }
                break;
            case 'find-device': {
                // Resolve a friend's deviceId to their *current* peer id (if
                // they're online right now, on any room/network) so the
                // caller can address them directly via the relay below.
                const targetPeerId = typeof message.deviceId === 'string' && this._devices[message.deviceId];
                const target = targetPeerId && this._peersById[targetPeerId];
                this._send(sender, {
                    type: 'find-device-result',
                    deviceId: message.deviceId,
                    online: !!target,
                    peerId: target ? target.id : undefined,
                    peer: target ? target.getInfo() : undefined
                });
                break;
            }
            case 'list-public-devices': {
                // One-shot snapshot of everyone currently opted into the
                // discovery directory (excluding the requester itself).
                // Live joins/leaves after this are pushed incrementally via
                // 'public-peer-joined' / 'public-peer-left' (see bind-device
                // and _leaveRoom above/below), so clients don't need to poll
                // this to stay in sync — just to populate the initial list.
                const devices = Object.values(this._publicDevices)
                    .filter(entry => entry.deviceId !== sender.deviceId)
                    .slice(0, PUBLIC_DEVICES_MAX)
                    .map(entry => {
                        const peer = this._peersById[entry.peerId];
                        return peer ? { deviceId: entry.deviceId, nickname: entry.nickname, peer: peer.getInfo() } : null;
                    })
                    .filter(Boolean); // drop entries whose peer vanished without a clean unbind (shouldn't normally happen)
                this._send(sender, { type: 'public-devices', devices });
                break;
            }
        }

        // Relay message to recipient. Prefer the sender's own room (cheap,
        // and preserves today's behaviour for the common case: file
        // transfer/chat/signal between devices that discovered each other
        // on the same network). Fall back to the global `_peersById` index
        // so two devices that paired via deviceId (see 'find-device' above)
        // can keep talking — offer/answer/ICE `signal` messages, invites,
        // and app payloads alike — even though they're on different
        // rooms/networks. This intentionally makes any connected peer id
        // reachable process-wide, same as today's within-room relay; the
        // safety margin is that peer ids are unguessable v4-ish uuids
        // (see Peer.uuid), never enumerable/listable by a stranger.
        if (message.to) {
            const recipientId = message.to; // TODO: sanitize
            const recipient = (this._rooms[sender.ip] && this._rooms[sender.ip][recipientId])
                || this._peersById[recipientId];
            delete message.to;
            // add sender id
            message.sender = sender.id;
            this._send(recipient, message);
            return;
        }
    }

    /**
     * @param {Peer} peer
     * @returns {boolean} false if the room is at capacity and the peer was rejected
     */
    _joinRoom(peer) {
        // if room doesn't exist, create it
        if (!this._rooms[peer.ip]) {
            this._rooms[peer.ip] = {};
        }

        // If an earlier connection with the same peer.id is still in the room,
        // evict it cleanly before adding the new one.
        if (this._rooms[peer.ip][peer.id] && this._rooms[peer.ip][peer.id] !== peer) {
            this._leaveRoom(this._rooms[peer.ip][peer.id]);
            if (!this._rooms[peer.ip]) {
                this._rooms[peer.ip] = {};
            }
        }

        if (Object.keys(this._rooms[peer.ip]).length >= ROOM_MAX_PEERS) {
            return false;
        }

        // notify all other peers
        for (const otherPeerId in this._rooms[peer.ip]) {
            const otherPeer = this._rooms[peer.ip][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // notify peer about the other peers
        const otherPeers = [];
        for (const otherPeerId in this._rooms[peer.ip]) {
            otherPeers.push(this._rooms[peer.ip][otherPeerId].getInfo());
        }

        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        // add peer to room
        this._rooms[peer.ip][peer.id] = peer;
        this._peersById[peer.id] = peer;
        return true;
    }

    /**
     * Remove `peer` from its room and notify the remaining peers.
     * Idempotent: safe to call more than once for the same peer (e.g. once
     * from an explicit {type:'disconnect'} message and again from the
     * socket's 'close' event) — the second call is a no-op.
     * @param {Peer} peer
     */
    _leaveRoom(peer) {
        if (!this._rooms[peer.ip] || this._rooms[peer.ip][peer.id] !== peer) return;
        this._matchmaker.remove(peer);
        this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

        // delete the peer
        delete this._rooms[peer.ip][peer.id];
        if (this._peersById[peer.id] === peer) {
            delete this._peersById[peer.id];
        }
        // only clear the deviceId->peer mapping if it still points at this
        // peer (it could already have been overwritten by a newer
        // connection from the same device, e.g. a page refresh)
        if (peer.deviceId && this._devices[peer.deviceId] === peer.id) {
            delete this._devices[peer.deviceId];
        }
        // same idempotent cleanup for the opt-in public directory, plus a
        // push so anyone with the directory open drops the stale entry
        // immediately instead of waiting for a poll.
        if (peer.deviceId && this._publicDevices[peer.deviceId] && this._publicDevices[peer.deviceId].peerId === peer.id) {
            delete this._publicDevices[peer.deviceId];
            this._broadcastPublic({ type: 'public-peer-left', deviceId: peer.deviceId }, peer.id);
        }

        peer.socket.terminate();
        //if room is empty, delete the room
        if (!Object.keys(this._rooms[peer.ip]).length) {
            delete this._rooms[peer.ip];
        } else {
            // notify all other peers
            for (const otherPeerId in this._rooms[peer.ip]) {
                const otherPeer = this._rooms[peer.ip][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
    }

    /**
     * Push a message to every currently-connected peer except `excludePeerId`.
     * Used only for the low-frequency public-directory join/leave events —
     * deliberately process-wide (like the `_peersById` relay fallback) since
     * "who's browsing the public list right now" isn't tracked separately.
     * @param {object} message
     * @param {string} [excludePeerId]
     */
    _broadcastPublic(message, excludePeerId) {
        for (const peerId in this._peersById) {
            if (peerId === excludePeerId) continue;
            this._send(this._peersById[peerId], message);
        }
    }

    _send(peer, message) {
        if (!peer) return;
        if (this._wss.readyState !== this._wss.OPEN) return;
        message = JSON.stringify(message);
        peer.socket.send(message, error => '');
    }

    _keepAlive(peer) {
        this._cancelKeepAlive(peer);
        var timeout = 30000;
        if (!peer.lastBeat) {
            peer.lastBeat = Date.now();
        }
        if (Date.now() - peer.lastBeat > 2 * timeout) {
            this._leaveRoom(peer);
            return;
        }

        this._send(peer, { type: 'ping' });

        peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
    }

    _cancelKeepAlive(peer) {
        if (peer && peer.timerId) {
            clearTimeout(peer.timerId);
        }
    }
}



/**
 * A connected client, identified by a stable id (cookie-backed) and
 * scoped to a "room" derived from its IP (or an explicit ?room= id).
 */
class Peer {

    /**
     * @param {import('ws')} socket
     * @param {import('http').IncomingMessage} request
     */
    constructor(socket, request) {
        // set socket
        this.socket = socket;


        // set remote ip
        this._setIP(request);

        // set peer id
        this._setPeerId(request)
        // is WebRTC supported ?
        this.rtcSupported = request.url.indexOf('webrtc') > -1;
        // set name
        this._setName(request);
        // for keepalive
        this.timerId = 0;
        this.lastBeat = Date.now();
        // per-connection message rate limiter, see RateLimiter
        this.rateLimiter = new RateLimiter();
    }

    _setIP(request) {
        let ip;
        if (request.headers['x-forwarded-for']) {
            ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        } else {
            ip = request.connection.remoteAddress;
        }
        if (ip === '::1' || ip === '::ffff:127.0.0.1') {
            ip = '127.0.0.1';
        }

        const parsedUrl = url.parse(request.url, true);
        const room = parsedUrl.query && parsedUrl.query.room;
        if (room) {
            this.ip = 'room-' + room;
        } else {
            this.ip = ip;
        }
    }

    _setPeerId(request) {
        if (request.peerId) {
            this.id = request.peerId;
        } else if (request.headers && request.headers.cookie) {
            const match = request.headers.cookie.match(/(?:^|;\s*)peerid=([^;]+)/);
            this.id = match ? match[1] : Peer.uuid();
        } else {
            this.id = Peer.uuid();
        }
    }

    toString() {
        return `<Peer id=${this.id} ip=${this.ip} rtcSupported=${this.rtcSupported}>`
    }

    _setName(req) {
        let ua = parser(req.headers['user-agent']);


        let deviceName = '';
        
        if (ua.os && ua.os.name) {
            deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
        }
        
        if (ua.device.model) {
            deviceName += ua.device.model;
        } else {
            deviceName += ua.browser.name;
        }

        if(!deviceName)
            deviceName = 'Unknown Device';

        const displayName = uniqueNamesGenerator({
            length: 2,
            separator: ' ',
            dictionaries: [colors, animals],
            style: 'capital',
            seed: this.id.hashCode()
        })

        this.name = {
            model: ua.device.model,
            os: ua.os.name,
            browser: ua.browser.name,
            type: ua.device.type,
            deviceName,
            displayName
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported
        }
    }

    // return uuid of form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    static uuid() {
        let uuid = '',
            ii;
        for (ii = 0; ii < 32; ii += 1) {
            switch (ii) {
                case 8:
                case 20:
                    uuid += '-';
                    uuid += (Math.random() * 16 | 0).toString(16);
                    break;
                case 12:
                    uuid += '-';
                    uuid += '4';
                    break;
                case 16:
                    uuid += '-';
                    uuid += (Math.random() * 4 | 8).toString(16);
                    break;
                default:
                    uuid += (Math.random() * 16 | 0).toString(16);
            }
        }
        return uuid;
    };
}

Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    var hash = 0, i, chr;
    for (i = 0; i < this.length; i++) {
      chr   = this.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }
});

// Only bind a port when this file is executed directly (e.g. `node index.js`
// or `npm start`). When it's `require()`d — as the unit tests do — we just
// want the classes/functions below, without a live server listening.
if (require.main === module) {
    new SnapdropServer(process.env.PORT || 3000);
}

module.exports = { SnapdropServer, Peer, RateLimiter, getTurnCredentials, ROOM_MAX_PEERS, RATE_LIMIT_MAX_MESSAGES, RATE_LIMIT_WINDOW_MS, PUBLIC_DEVICES_MAX };
