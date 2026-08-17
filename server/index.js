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
const RATE_LIMIT_MAX_MESSAGES = parseInt(process.env.RATE_LIMIT_MAX_MESSAGES || '60', 10); // per window
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '1000', 10); // 1s window
const WS_MAX_PAYLOAD_BYTES = parseInt(process.env.WS_MAX_PAYLOAD_BYTES || String(64 * 1024), 10); // signaling msgs are small; file bytes go over WebRTC data channels, not this socket

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
        this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

        this._rooms = {};

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
        if (response.headers.cookie && response.headers.cookie.indexOf('peerid=') > -1) return;
        response.peerId = Peer.uuid();
        headers.push('Set-Cookie: peerid=' + response.peerId + "; SameSite=Strict; Secure");
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
        }

        // relay message to recipient
        if (message.to && this._rooms[sender.ip]) {
            const recipientId = message.to; // TODO: sanitize
            const recipient = this._rooms[sender.ip][recipientId];
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
        if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;
        this._cancelKeepAlive(this._rooms[peer.ip][peer.id]);

        // delete the peer
        delete this._rooms[peer.ip][peer.id];

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
        } else {
            this.id = request.headers.cookie.replace('peerid=', '');
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

module.exports = { SnapdropServer, Peer, RateLimiter, getTurnCredentials, ROOM_MAX_PEERS, RATE_LIMIT_MAX_MESSAGES, RATE_LIMIT_WINDOW_MS };
