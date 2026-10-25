/**
 * GameSession: generic 2-player, host-authoritative WebRTC transport for
 * the realtime multiplayer games under client/<game>/.
 *
 * This is extracted out of what used to be pong/game.js's own hand-rolled
 * signaling + WebRTC code. Two bugs had already been found and fixed in
 * that code (the 'turn-config' arrival-order race that broke cross-network
 * connections, and treating ICE 'disconnected' as a hard failure instead of
 * giving it a few seconds to self-heal) — both fixes live here now, so
 * every game built on top of GameSession gets them for free instead of
 * re-discovering (and re-fixing) the same two bugs independently.
 *
 * Deliberately NOT built on scripts/network.js's RTCPeer/PeersManager: that
 * stack is shaped for the file-transfer/chat app — one ordered+reliable
 * data channel, an arbitrary number of simultaneous peers, and everything
 * wired through the main app's global `Events` (window CustomEvent) bus
 * tied to the share-page's own room semantics. A game wants the opposite
 * shape: exactly one unreliable/unordered low-latency channel to exactly
 * one opponent, a host/client role assigned purely by arrival order in the
 * room, and no coupling to the main app's event bus or DOM. Forcing a game
 * onto RTCPeer would mean fighting its defaults, not reusing them.
 *
 * Usage (see client/pong/game.js and client/tron/game.js for full examples):
 *
 *   const session = new GameSession({
 *     gameFolder: 'pong',              // required — the URL path segment
 *                                       // this game is served from, used to
 *                                       // derive the signaling endpoint the
 *                                       // same way pong always has: strip
 *                                       // '/<gameFolder>/' off location.pathname.
 *     dataChannelOptions: { ordered: false, maxRetransmits: 0 },
 *     onRole: (role) => {},             // 'host' | 'client'
 *     onSignalingStatus: (status) => {},// 'connecting' | 'open' | 'closed'
 *     onChannelOpen: () => {},          // data channel usable, show "ready" UI
 *     onPeerConnected: () => {},        // ICE connected (incl. self-heal)
 *     onPeerReconnecting: () => {},     // ICE 'disconnected', grace period running
 *     onPeerDisconnected: () => {},     // opponent is gone for good, reset to lobby
 *     onMessage: (data) => {},          // parsed JSON payload from the opponent
 *     onRtt: (ms) => {},                // fired ~every 1.5s once connected
 *   });
 *
 *   session.send({ type: 'state', ... });   // game-defined message shapes
 *   session.isHost                          // convenience for role === 'host'
 */
class GameSession {
    constructor(opts = {}) {
        if (!opts.gameFolder) throw new Error('GameSession: gameFolder is required');
        this.gameFolder = opts.gameFolder;
        this.dataChannelOptions = opts.dataChannelOptions || { ordered: false, maxRetransmits: 0 };
        this.roomId = opts.roomId || (location.hash ? location.hash.substring(1) : '');
        this.reconnectGraceMs = opts.reconnectGraceMs != null ? opts.reconnectGraceMs : 6000;

        this.onRole = opts.onRole || function () {};
        this.onSignalingStatus = opts.onSignalingStatus || function () {};
        this.onChannelOpen = opts.onChannelOpen || function () {};
        this.onPeerConnected = opts.onPeerConnected || function () {};
        this.onPeerReconnecting = opts.onPeerReconnecting || function () {};
        this.onPeerDisconnected = opts.onPeerDisconnected || function () {};
        this.onMessage = opts.onMessage || function () {};
        this.onRtt = opts.onRtt || function () {};

        this.role = null;           // 'host' | 'client'
        this.peerId = null;         // our own signaling-assigned display name
        this.opponentId = null;
        this.iceServersConfig = [{ urls: 'stun:stun.l.google.com:19302' }];
        // See startWebRTCWhenReady() below for why this race needs guarding.
        this.turnConfigReceived = false;
        this.pendingInit = null;    // { targetPeerId, isInitiator } queued until turn-config arrives

        this.reconnectGraceTimer = null;
        this.rttInterval = null;
        this.lastPingTime = 0;

        this.ws = null;
        this.pc = null;
        this.dc = null;
        this.remoteCandidatesQueue = [];
        this.pendingSignals = [];
        this.usingWsFallback = false;
        // Relay mode only counts as "connected" once the opponent has
        // actually sent something back over it — see _activateWsFallback().
        this._fallbackConfirmed = false;
        this._lastRelayAt = 0;
        this._relayStalled = false;
        this._connectTimeoutTimer = null;
        this._destroyed = false;

        this._connectSignaling();
    }

    _connectSignaling() {
        if (this._destroyed) return;
        const protocol = location.protocol.startsWith('https') ? 'wss' : 'ws';
        // Mirrors pong's original derivation exactly: strip '/<gameFolder>/'
        // (or '/<gameFolder>') off the end of the current path to recover
        // the app root, then hit its /server/webrtc signaling endpoint.
        const folderRe = new RegExp('/' + this.gameFolder + '/?$');
        const cleanPath = location.pathname.replace(folderRe, '');
        const query = this.roomId ? `?room=${this.roomId}` : '';
        const wsUrl = `${protocol}://${location.host}${cleanPath}/server/webrtc${query}`;

        this.onSignalingStatus('connecting');
        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.onopen = () => this.onSignalingStatus('open');
        ws.onclose = () => {
            this.onSignalingStatus('closed');
            if (!this._destroyed) setTimeout(() => this._connectSignaling(), 3000);
        };
        ws.onerror = (err) => console.error('GameSession: signaling socket error', err);
        ws.onmessage = (event) => this._handleSignalingMessage(JSON.parse(event.data));
    }

    _handleSignalingMessage(msg) {
        switch (msg.type) {
            case 'display-name':
                this.peerId = msg.message.displayName;
                break;

            case 'turn-config':
                if (msg.iceServers) {
                    this.iceServersConfig = msg.iceServers;
                    this.turnConfigReceived = true;
                    if (this.pendingInit) {
                        const { targetPeerId, isInitiator } = this.pendingInit;
                        this.pendingInit = null;
                        this._initWebRTC(targetPeerId, isInitiator);
                    }
                }
                break;

            case 'peers':
                // Two-player assumption. Pick the most recently joined
                // occupant: an older entry may be a "ghost" — a tab the
                // phone froze in the background, which the server only
                // evicts after its 60-90s keepalive — while the newest one
                // is whoever is actually waiting for us right now.
                if (msg.peers.length > 0) {
                    this.opponentId = msg.peers[msg.peers.length - 1].id;
                    this._setRole('client');
                    this._startWebRTCWhenReady(this.opponentId, false);
                } else {
                    this._setRole('host');
                }
                break;

            case 'peer-joined':
                // Already in a live match with someone else: ignore the
                // newcomer (2-player room).
                if (this.opponentId && this.opponentId !== msg.peer.id && this._isLive()) break;
                this.opponentId = msg.peer.id;
                // The peer already in the room always initiates. If we were
                // 'client' it means the original host left (page reload,
                // tab discarded by the phone, signaling reconnect with a new
                // id) and is coming back as a fresh peer that will see us in
                // 'peers' and take the client role — so we must become host,
                // otherwise both sides sit at "waiting for host" forever.
                if (this.role !== 'host') this._setRole('host');
                this._startWebRTCWhenReady(this.opponentId, true);
                break;

            case 'peer-left':
                if (msg.peerId === this.opponentId) {
                    this._finalDisconnect();
                }
                break;

            case 'signal':
                if (msg.sender === this.opponentId) {
                    this._handleWebRTCSignal(msg.signal);
                }
                break;

            case 'game-relay':
                if (msg.sender === this.opponentId && msg.payload) {
                    if (!this.usingWsFallback) {
                        this._activateWsFallback();
                    }
                    this._lastRelayAt = Date.now();
                    if (!this._fallbackConfirmed) {
                        // first proof the opponent is really there
                        this._fallbackConfirmed = true;
                        this.onChannelOpen();
                        this.onPeerConnected();
                    } else if (this._relayStalled) {
                        this._relayStalled = false;
                        this.onPeerConnected();
                    }
                    this._dispatchPayload(msg.payload);
                }
                break;

            case 'ping':
                this._sendSignaling({ type: 'pong' });
                break;
        }
    }

    _setRole(role) {
        this.role = role;
        this.onRole(role);
    }

    // The signaling server sends 'peers'/'peer-joined' before 'turn-config'
    // on a fresh connection (see server/index.js _onConnection), so acting
    // on either immediately would create the RTCPeerConnection with only
    // the default STUN server — no TURN relay candidates, ever (iceServers
    // is only read at `new RTCPeerConnection()` time). That's fine on a
    // permissive/same-network NAT and silently fatal across real networks.
    // Queue the request until turn-config actually lands instead.
    _startWebRTCWhenReady(targetPeerId, isInitiator) {
        if (this.turnConfigReceived) {
            this._initWebRTC(targetPeerId, isInitiator);
        } else {
            this.pendingInit = { targetPeerId, isInitiator };
        }
    }

    _cleanupWebRTCOnly() {
        if (this.reconnectGraceTimer) {
            clearTimeout(this.reconnectGraceTimer);
            this.reconnectGraceTimer = null;
        }
        if (this._connectTimeoutTimer) {
            clearTimeout(this._connectTimeoutTimer);
            this._connectTimeoutTimer = null;
        }
        this.remoteCandidatesQueue = [];
        this.usingWsFallback = false;
        this._fallbackConfirmed = false;
        this._relayStalled = false;
        if (this.dc) {
            try {
                this.dc.onopen = null;
                this.dc.onclose = null;
                this.dc.onmessage = null;
                this.dc.close();
            } catch (e) {}
            this.dc = null;
        }
        if (this.pc) {
            try {
                this.pc.onicecandidate = null;
                this.pc.onconnectionstatechange = null;
                this.pc.ondatachannel = null;
                this.pc.close();
            } catch (e) {}
            this.pc = null;
        }
    }

    _activateWsFallback() {
        if (this.usingWsFallback || this._destroyed || !this.opponentId) return;
        console.warn('GameSession: WebRTC P2P unavailable, falling back to WebSocket signaling relay');
        this._cleanupWebRTCOnly();
        this.usingWsFallback = true;
        // Do NOT report "connected" yet: the opponent may be a frozen
        // background tab that will never answer. onChannelOpen /
        // onPeerConnected fire on the first relayed message we receive
        // (see 'game-relay'); the latency pings below keep knocking every
        // 1.5s until then.
        this._fallbackConfirmed = false;
        this._lastRelayAt = 0;
        this._startLatencyCheck();
        // Notify peer so both sides switch to relay simultaneously
        this._sendSignaling({
            type: 'game-relay',
            to: this.opponentId,
            payload: { type: '__gs_ping__', id: Date.now() }
        });
    }

    _initWebRTC(targetPeerId, isInitiator) {
        this._cleanupWebRTCOnly();
        const pc = new RTCPeerConnection({ iceServers: this.iceServersConfig });
        this.pc = pc;
        this._disconnectFired = false;

        // If WebRTC cannot establish a data channel within 8 seconds (e.g. restrictive
        // firewall blocking UDP/TURN), seamlessly fall back to WebSocket relay instead
        // of dropping the match.
        this._connectTimeoutTimer = setTimeout(() => {
            this._connectTimeoutTimer = null;
            if ((!this.dc || this.dc.readyState !== 'open') && !this.usingWsFallback && this.opponentId) {
                this._activateWsFallback();
            }
        }, 8000);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this._sendSignaling({ type: 'signal', to: targetPeerId, signal: { candidate: event.candidate } });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                if (this._connectTimeoutTimer) {
                    clearTimeout(this._connectTimeoutTimer);
                    this._connectTimeoutTimer = null;
                }
                // A pending reconnect-grace timer means ICE just self-healed
                // rather than this being the first connection — cancel it so
                // the stale timeout doesn't fire a disconnect later.
                if (this.reconnectGraceTimer) {
                    clearTimeout(this.reconnectGraceTimer);
                    this.reconnectGraceTimer = null;
                }
                this.onPeerConnected();
                this._startLatencyCheck();
            } else if (pc.connectionState === 'failed') {
                // If ICE fails during initial handshake or mid-game while signaling WS is still alive,
                // fall back to WebSocket relay rather than kicking players out.
                if (this.ws && this.ws.readyState === WebSocket.OPEN && this.opponentId) {
                    this._activateWsFallback();
                } else {
                    this._finalDisconnect();
                }
            } else if (pc.connectionState === 'disconnected') {
                // Usually a transient blip (WiFi handoff, brief packet loss)
                // that ICE recovers from on its own; treating it the same as
                // 'failed' would turn every short stall into a permanent
                // disconnect. Give it a grace window before giving up.
                this.onPeerReconnecting();
                if (!this.reconnectGraceTimer) {
                    this.reconnectGraceTimer = setTimeout(() => {
                        this.reconnectGraceTimer = null;
                        if (this.pc && this.pc.connectionState !== 'connected') {
                            if (this.ws && this.ws.readyState === WebSocket.OPEN && this.opponentId) {
                                this._activateWsFallback();
                            } else {
                                this._finalDisconnect();
                            }
                        }
                    }, this.reconnectGraceMs);
                }
            }
        };

        if (isInitiator) {
            const dc = pc.createDataChannel('game-data', this.dataChannelOptions);
            this._setupDataChannel(dc);

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => this._sendSignaling({ type: 'signal', to: targetPeerId, signal: { sdp: pc.localDescription } }))
                .catch(err => console.error('GameSession: createOffer failed', err));
        } else {
            pc.ondatachannel = (event) => this._setupDataChannel(event.channel);
            while (this.pendingSignals.length > 0) {
                const sig = this.pendingSignals.shift();
                this._handleWebRTCSignal(sig);
            }
        }
    }

    _handleWebRTCSignal(signal) {
        const pc = this.pc;
        if (!pc) {
            this.pendingSignals.push(signal);
            return;
        }
        if (signal.sdp) {
            pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
                .then(() => {
                    while (this.remoteCandidatesQueue.length > 0) {
                        const c = this.remoteCandidatesQueue.shift();
                        pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
                    }
                    if (pc.remoteDescription.type === 'offer') {
                        return pc.createAnswer()
                            .then(answer => pc.setLocalDescription(answer))
                            .then(() => this._sendSignaling({ type: 'signal', to: this.opponentId, signal: { sdp: pc.localDescription } }));
                    }
                })
                .catch(err => console.error('GameSession: remote SDP/answer failed', err));
        } else if (signal.candidate) {
            if (pc.remoteDescription && pc.remoteDescription.type) {
                pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
                    .catch(err => console.error('GameSession: addIceCandidate failed', err));
            } else {
                this.remoteCandidatesQueue.push(signal.candidate);
            }
        }
    }

    _dispatchPayload(data) {
        if (!data || typeof data !== 'object') return;
        // Latency probing is a GameSession concern, not a game concern —
        // handle it internally instead of forwarding it to onMessage.
        if (data.type === '__gs_ping__') {
            this.send({ type: '__gs_pong__', id: data.id });
            return;
        }
        if (data.type === '__gs_pong__') {
            if (data.id === this.lastPingTime) this.onRtt(Date.now() - data.id);
            return;
        }
        this.onMessage(data);
    }

    _setupDataChannel(dc) {
        this.dc = dc;
        dc.onopen = () => {
            if (this._connectTimeoutTimer) {
                clearTimeout(this._connectTimeoutTimer);
                this._connectTimeoutTimer = null;
            }
            this.onChannelOpen();
        };
        dc.onclose = () => {
            if (!this.usingWsFallback) {
                this._finalDisconnect();
            }
        };
        dc.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                return;
            }
            this._dispatchPayload(data);
        };
    }

    _startLatencyCheck() {
        clearInterval(this.rttInterval);
        this.rttInterval = setInterval(() => {
            // Relay mode has no ICE state to tell us the opponent froze
            // (phone locked / switched tab): treat 6s of silence — despite
            // pings every 1.5s — as "reconnecting" instead of looking alive.
            if (this.usingWsFallback && this._fallbackConfirmed && !this._relayStalled
                && Date.now() - this._lastRelayAt > 6000) {
                this._relayStalled = true;
                this.onPeerReconnecting();
            }
            if ((this.dc && this.dc.readyState === 'open') || this.usingWsFallback) {
                this.lastPingTime = Date.now();
                this.send({ type: '__gs_ping__', id: this.lastPingTime });
            }
        }, 1500);
    }

    // Reachable from several independent triggers (ICE 'failed', grace
    // timeout, local dc.onclose, remote 'peer-left') which can legitimately
    // fire in sequence for the same disconnect (e.g. closing the data
    // channel here also triggers its own onclose). `alreadyTornDown` makes
    // the actual onPeerDisconnected callback fire exactly once per episode.
    _finalDisconnect() {
        clearInterval(this.rttInterval);
        this.rttInterval = null;

        const alreadyTornDown = !this.dc && !this.pc && !this.usingWsFallback;
        this._cleanupWebRTCOnly();
        if (alreadyTornDown) return;
        this.onPeerDisconnected();
    }

    _sendSignaling(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    /** Send a game-defined JSON-serializable message to the opponent, if connected. */
    send(obj) {
        if (this.dc && this.dc.readyState === 'open') {
            this.dc.send(JSON.stringify(obj));
        } else if (this.usingWsFallback && this.opponentId) {
            this._sendSignaling({ type: 'game-relay', to: this.opponentId, payload: obj });
        }
    }

    /** Is the current opponent connection actually carrying traffic? */
    _isLive() {
        if (this.dc && this.dc.readyState === 'open') return true;
        return this.usingWsFallback && this._fallbackConfirmed && Date.now() - this._lastRelayAt < 6000;
    }

    get isHost() {
        return this.role === 'host';
    }

    /** Tear down everything and stop auto-reconnecting the signaling socket. */
    destroy() {
        this._destroyed = true;
        clearInterval(this.rttInterval);
        this._cleanupWebRTCOnly();
        if (this.ws) {
            try {
                this.ws.onclose = null;
                this.ws.close();
            } catch (e) {}
            this.ws = null;
        }
    }
}

window.GameSession = GameSession;
