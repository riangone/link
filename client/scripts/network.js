window.URL = window.URL || window.webkitURL;
window.isRtcSupported = !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);

/**
 * Base64 <-> UTF-8 text codec shared by every message payload that needs to
 * cross the wire as JSON (chat text, clipboard sync). Centralizing this
 * means `sendText`/`sendClipboardText` (and their receive-side
 * counterparts) don't each hand-roll the same
 * `btoa(unescape(encodeURIComponent(...)))` dance, and any future message
 * type (reactions, @mentions, ...) gets encode/decode for free.
 */
const MessageCodec = {
    encode(text) {
        return btoa(unescape(encodeURIComponent(text)));
    },
    decode(encoded) {
        return decodeURIComponent(escape(atob(encoded)));
    }
};

// Chat-message tuning. TEXT_CHUNK_CHARS keeps each wire message's base64
// payload well under the signaling server's WS_MAX_PAYLOAD_BYTES (64KB,
// see server/index.js) so a long chat message sent over the WSPeer relay
// fallback is never silently dropped by the server the way a single
// unchunked message would be - it reuses the same chunk+reassemble idea
// file transfers already rely on, instead of a size-limited special case.
const TEXT_CHUNK_CHARS = 32000; // ~32KB of base64 per wire message, well under the 64KB WS cap
const TEXT_ACK_TIMEOUT_MS = 8000; // how long to wait for a text-ack before treating a send as failed/needing retry
const TEXT_MAX_RETRIES = 3;

// RTCDataChannel backpressure watermarks (see Peer#_waitForBufferSpace /
// RTCPeer#_waitForBufferSpace). A fast sender on a slow link can otherwise
// pile megabytes into `bufferedAmount` between partition acks.
const RTC_BUFFERED_AMOUNT_HIGH_WATERMARK = 8 * 1024 * 1024; // pause starting the next partition above this
const RTC_BUFFERED_AMOUNT_LOW_WATERMARK = 1 * 1024 * 1024;  // resume once buffered amount drains back below this

/**
 * WebSocket connection to the signaling server (server/index.js). Handles
 * peer discovery (`peers`/`peer-joined`/`peer-left`), relays WebRTC
 * offer/answer/ICE `signal` messages, and receives dynamic TURN
 * credentials (`turn-config`). Does NOT carry file bytes — those go
 * peer-to-peer over WebRTC data channels (see RTCPeer) once two peers
 * have found each other through this connection.
 */
class ServerConnection {

    constructor() {
        this._connect();
        Events.on('beforeunload', e => this._disconnect());
        Events.on('pagehide', e => this._disconnect());
        document.addEventListener('visibilitychange', e => this._onVisibilityChange());
        window.addEventListener('hashchange', e => this._onHashChange());
        Events.on('change-nickname-request', e => {
            this.send({ type: 'change-nickname', displayName: e.detail });
        });
    }

    _onHashChange() {
        console.log('WS: Hash changed, reconnecting to new room...');
        if (this._socket) {
            this._socket.onclose = null;
            this._socket.close();
        }
        this._connect();
        Events.fire('room-changed');
    }

    _connect() {
        clearTimeout(this._reconnectTimer);
        if (this._isConnected() || this._isConnecting()) return;
        const ws = new WebSocket(this._endpoint());
        ws.binaryType = 'arraybuffer';
        ws.onopen = e => {
            console.log('WS: server connected');
            Events.fire('ws-connected');
        };
        ws.onmessage = e => this._onMessage(e.data);
        ws.onclose = e => this._onDisconnect();
        ws.onerror = e => console.error(e);
        this._socket = ws;
    }

    _onMessage(msg) {
        msg = JSON.parse(msg);
        console.log('WS:', msg);
        switch (msg.type) {
            case 'peers':
                Events.fire('peers', msg.peers);
                break;
            case 'peer-joined':
                Events.fire('peer-joined', msg.peer);
                break;
            case 'peer-left':
                Events.fire('peer-left', msg.peerId);
                break;
            case 'signal':
                Events.fire('signal', msg);
                break;
            case 'ping':
                this.send({ type: 'pong' });
                break;
            case 'display-name':
                Events.fire('display-name', msg);
                const savedNick = localStorage.getItem('custom-nickname');
                if (savedNick) {
                    this.send({ type: 'change-nickname', displayName: savedNick });
                }
                break;
            case 'peer-nickname-changed':
                Events.fire('peer-nickname-changed', msg);
                break;
            case 'turn-config':
                Events.fire('turn-config', msg);
                break;
            case 'peer-message':
                Events.fire('peer-message', msg);
                break;
            default:
                console.error('WS: unkown message type', msg);
        }
    }

    send(message) {
        if (!this._isConnected()) return;
        this._socket.send(JSON.stringify(message));
    }

    _endpoint() {
        // hack to detect if deployment or development environment
        const protocol = location.protocol.startsWith('https') ? 'wss' : 'ws';
        const webrtc = window.isRtcSupported ? '/webrtc' : '/fallback';
        let roomId = '';
        if (location.hash && location.hash.length > 1) {
            roomId = encodeURIComponent(location.hash.substring(1));
        }
        const query = roomId ? `?room=${roomId}` : '';
        const url = protocol + '://' + location.host + location.pathname + 'server' + webrtc + query;
        return url;
    }

    _disconnect() {
        this.send({ type: 'disconnect' });
        this._socket.onclose = null;
        this._socket.close();
    }

    _onDisconnect() {
        console.log('WS: server disconnected');
        Events.fire('notify-user', window.I18n.t('net_connection_lost'));
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(_ => this._connect(), 5000);
    }

    _onVisibilityChange() {
        if (document.hidden) return;
        this._connect();
    }

    _isConnected() {
        return this._socket && this._socket.readyState === this._socket.OPEN;
    }

    _isConnecting() {
        return this._socket && this._socket.readyState === this._socket.CONNECTING;
    }
}

/**
 * Caps how many *outgoing* file transfers, across all peers combined, may
 * be actively sending (post-header) at once. Each Peer still queues its
 * own files strictly in submission order (`Peer._filesQueue`) — this only
 * gates when a peer is allowed to move a file from "queued" to "active",
 * so fanning a send out to many peers at once doesn't open a data channel
 * per peer simultaneously and doesn't force every receiver to buffer a
 * file in memory at the same time (see FileDigester, which holds the
 * whole incoming file in RAM until it's complete).
 *
 * Deliberately does NOT throttle inbound transfers: a peer sending to us
 * has no way to know our slots are full without a protocol-level "busy,
 * retry" handshake, which is out of scope here.
 */
class TransferScheduler {
    constructor(maxConcurrent = 3) {
        this._max = maxConcurrent;
        this._active = 0;
        this._waiters = []; // FIFO of onGranted callbacks
    }

    /**
     * @param {() => void} onGranted - invoked once a slot is available,
     *   synchronously if one is free right now.
     */
    requestSlot(onGranted) {
        if (this._active < this._max) {
            this._active++;
            onGranted();
        } else {
            this._waiters.push(onGranted);
        }
    }

    releaseSlot() {
        if (this._active === 0) return; // guard against a stray double-release
        this._active--;
        const next = this._waiters.shift();
        if (next) {
            this._active++;
            next();
        }
    }
}

const transferScheduler = new TransferScheduler();

/**
 * Base class for a connection to one remote peer. Owns the outgoing file
 * queue (one file transferred at a time, in submission order — see
 * `_dequeueFile`/`_sendFile`) and the chunked send/receive protocol built
 * on top of whatever `_send()` transport the subclass provides
 * (WebRTC data channel for RTCPeer, relayed WebSocket for WSPeer).
 */
class Peer {

    /**
     * @param {ServerConnection} serverConnection
     * @param {string} peerId - id of the remote peer, as assigned by the signaling server
     */
    constructor(serverConnection, peerId) {
        this._server = serverConnection;
        this._peerId = peerId;
        this._filesQueue = [];
        this._busy = false;
        this._pendingTransferId = null; // reserved locally, waiting on a global TransferScheduler slot
        this._holdsSlot = false; // true once TransferScheduler actually granted us a slot

        this._textHistory = []; // {id, text, direction: 'outgoing'|'incoming', status, timestamp} - bounded chat thread with this peer
        this._pendingTexts = new Map(); // id -> {text, attempts, timer} - outgoing messages awaiting a text-ack
        this._textOutbox = []; // ids queued because we had no live connection when sendText() was called
        this._incomingTexts = new Map(); // id -> {parts: string[]} - in-progress reassembly of a chunked incoming message
    }

    sendJSON(message) {
        this._send(JSON.stringify(message));
    }

    /**
     * Queue one or more files for transfer to this peer. Files already
     * queued/in-flight are unaffected; new files are appended and sent
     * strictly after the current one finishes (see `_dequeueFile`).
     * @param {FileList|File[]} files
     */
    sendFiles(files) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const transferId = 'tx-' + Math.random().toString(36).substring(2, 9);
            file.transferId = transferId;
            this._filesQueue.push(file);
            Events.fire('transfer-queued', {
                id: transferId,
                name: file.name,
                size: file.size,
                peerId: this._peerId,
                direction: 'outgoing',
                status: 'queued'
            });
        }
        if (this._busy) return;
        this._dequeueFile();
    }

    _dequeueFile() {
        if (!this._filesQueue.length) return;
        if (this._busy) return;
        this._busy = true;
        const file = this._filesQueue.shift();
        this._pendingTransferId = file.transferId;
        transferScheduler.requestSlot(() => {
            if (this._pendingTransferId !== file.transferId) {
                // cancelled (or peer torn down) while waiting for a global slot
                transferScheduler.releaseSlot();
                return;
            }
            this._pendingTransferId = null;
            this._sendFile(file);
        });
    }

    /** Give back a scheduler slot if (and only if) we're currently holding one. */
    _releaseSlotIfHeld() {
        if (!this._holdsSlot) return;
        this._holdsSlot = false;
        transferScheduler.releaseSlot();
    }

    /**
     * Send a recorded voice message. Reuses the exact same chunked
     * send/receive protocol as sendFiles() (FileChunker/FileDigester,
     * backpressure, the global TransferScheduler) - a voice message is
     * transport-wise just a small file - but differs in three ways:
     *
     *   1. It jumps to the front of _filesQueue instead of the back:
     *      recording is a synchronous "hit send, expect it to go now"
     *      interaction, so it shouldn't sit behind an in-flight multi-GB
     *      file transfer to the same peer.
     *   2. It never touches the file-received/download UI - both sides
     *      persist the audio Blob into VoiceStore (IndexedDB) instead, and
     *      the app-level "server/relay never stores this" requirement means
     *      there's no URL to hand around, only local Blobs.
     *   3. It fails fast instead of queuing when not currently connected
     *      (path A from the design discussion: no store-and-forward for
     *      voice - if the peer isn't reachable right now, the message
     *      doesn't go, unlike sendText()'s outbox/retry).
     *
     * @param {Blob} blob - recorded audio, e.g. from MediaRecorder
     * @param {number} duration - seconds
     * @returns {string} transferId, also used as the VoiceStore key and the
     *   id in every 'voice-message' event for this message
     */
    sendVoice(blob, duration) {
        const transferId = 'voice-' + Math.random().toString(36).substring(2, 9);
        blob.transferId = transferId;
        blob.name = 'voice-message';
        blob.isVoice = true;
        blob.duration = duration;

        VoiceStore.put(transferId, blob, { duration, peerId: this._peerId, direction: 'outgoing' })
            .catch(e => console.error('VoiceStore: failed to persist outgoing voice message', e));

        if (!this._isConnected()) {
            Events.fire('voice-message', {
                id: transferId, peerId: this._peerId, duration,
                direction: 'outgoing', status: 'failed', timestamp: Date.now()
            });
            return transferId;
        }

        Events.fire('voice-message', {
            id: transferId, peerId: this._peerId, duration,
            direction: 'outgoing', status: 'sending', timestamp: Date.now()
        });

        this._filesQueue.unshift(blob);
        if (!this._busy) this._dequeueFile();
        return transferId;
    }

    _sendFile(file) {
        this._holdsSlot = true;
        this._activeIsVoice = !!file.isVoice;
        this._activeVoiceDuration = file.duration;
        this._activeVoiceDirection = 'outgoing';
        this._activeTransferId = file.transferId;
        this.sendJSON({
            type: 'header',
            transferId: file.transferId,
            name: file.name,
            mime: file.type,
            size: file.size,
            isVoice: !!file.isVoice,
            duration: file.duration
        });
        if (!file.isVoice) {
            Events.fire('transfer-active', { id: file.transferId });
            Events.fire('transfer-started', {
                id: file.transferId,
                name: file.name,
                size: file.size,
                peerId: this._peerId,
                direction: 'outgoing',
                status: 'transferring'
            });
        }
        this._chunker = new FileChunker(file,
            chunk => this._send(chunk),
            offset => this._onPartitionEnd(offset));
        this._waitForBufferSpace(() => this._chunker.nextPartition());
    }

    /**
     * Give the transport a chance to apply backpressure before starting the
     * next partition. The base implementation is a no-op (fires `cb`
     * immediately) because most transports (WSPeer, relayed through the
     * signaling socket) don't expose a meaningful buffered-amount signal;
     * RTCPeer overrides this to actually wait on `bufferedamountlow`.
     * @param {() => void} cb
     */
    _waitForBufferSpace(cb) {
        cb();
    }

    _onPartitionEnd(offset) {
        this.sendJSON({ type: 'partition', offset: offset });
    }

    _onReceivedPartitionEnd(offset) {
        this.sendJSON({ type: 'partition-received', offset: offset });
    }

    _sendNextPartition() {
        if (!this._chunker || this._chunker.isFileEnd()) return;
        this._waitForBufferSpace(() => this._chunker.nextPartition());
    }

    _sendProgress(progress) {
        this.sendJSON({ type: 'progress', progress: progress });
    }

    _onMessage(message) {
        if (typeof message !== 'string') {
            this._onChunkReceived(message);
            return;
        }
        message = JSON.parse(message);
        console.log('RTC:', message);
        switch (message.type) {
            case 'header':
                this._onFileHeader(message);
                break;
            case 'partition':
                this._onReceivedPartitionEnd(message);
                break;
            case 'partition-received':
                this._sendNextPartition();
                break;
            case 'progress':
                this._onDownloadProgress(message.progress);
                break;
            case 'transfer-complete':
                this._onTransferCompleted();
                break;
            case 'cancel-transfer':
                this._onCancelTransferReceived(message);
                break;
            case 'text':
                this._onTextReceived(message);
                break;
            case 'text-ack':
                this._onTextAck(message);
                break;
            case 'clipboard-sync':
                this._onClipboardSyncReceived(message);
                break;
        }
    }

    _onFileHeader(header) {
        this._lastProgress = 0;
        this._activeTransferId = header.transferId;
        this._activeIsVoice = !!header.isVoice;
        this._activeVoiceDuration = header.duration;
        this._activeVoiceDirection = 'incoming';
        this._digester = new FileDigester({
            name: header.name,
            mime: header.mime,
            size: header.size
        }, file => this._onFileReceived(file));
        if (header.isVoice) {
            Events.fire('voice-message', {
                id: header.transferId, peerId: this._peerId, duration: header.duration,
                direction: 'incoming', status: 'receiving', timestamp: Date.now()
            });
        } else {
            Events.fire('transfer-started', {
                id: header.transferId,
                name: header.name,
                size: header.size,
                peerId: this._peerId,
                direction: 'incoming',
                status: 'transferring'
            });
        }
    }

    _onChunkReceived(chunk) {
        if(!chunk.byteLength) return;
        
        this._digester.unchunk(chunk);
        const progress = this._digester.progress;
        this._onDownloadProgress(progress);

        // occasionally notify sender about our progress 
        if (progress - this._lastProgress < 0.01) return;
        this._lastProgress = progress;
        this._sendProgress(progress);
    }

    _onDownloadProgress(progress) {
        Events.fire('file-progress', { sender: this._peerId, progress: progress, transferId: this._activeTransferId });
    }

    _onFileReceived(proxyFile) {
        if (this._activeIsVoice) {
            VoiceStore.put(this._activeTransferId, proxyFile.blob, {
                duration: this._activeVoiceDuration, peerId: this._peerId, direction: 'incoming'
            }).catch(e => console.error('VoiceStore: failed to persist incoming voice message', e));
            Events.fire('voice-message', {
                id: this._activeTransferId, peerId: this._peerId, duration: this._activeVoiceDuration,
                direction: 'incoming', status: 'delivered', timestamp: Date.now()
            });
        } else {
            Events.fire('transfer-completed', { id: this._activeTransferId });
            Events.fire('file-received', proxyFile);
        }
        this.sendJSON({ type: 'transfer-complete' });
        this._activeTransferId = null;
        this._activeIsVoice = false;
        this._busy = false;
    }

    _onTransferCompleted() {
        const wasVoice = this._activeIsVoice;
        if (wasVoice) {
            Events.fire('voice-message', {
                id: this._activeTransferId, peerId: this._peerId, duration: this._activeVoiceDuration,
                direction: 'outgoing', status: 'delivered', timestamp: Date.now()
            });
        } else {
            Events.fire('transfer-completed', { id: this._activeTransferId });
        }
        this._onDownloadProgress(1);
        this._reader = null;
        this._busy = false;
        this._activeTransferId = null;
        this._activeIsVoice = false;
        this._releaseSlotIfHeld();
        this._dequeueFile();
        if (!wasVoice) {
            Events.fire('notify-user', window.I18n.t('net_transfer_completed'));
        }
    }

    cancelTransfer(transferId) {
        if (this._activeTransferId === transferId) {
            if (this._chunker) {
                this._chunker.abort();
            }
            this.sendJSON({ type: 'cancel-transfer', transferId: transferId });
            this._cleanActiveTransfer('cancelled');
        } else if (this._pendingTransferId === transferId) {
            // Reserved this peer's one local "in-flight" spot but still
            // queued behind the global TransferScheduler cap — never sent
            // a header, so there's nothing to tell the remote side.
            this._pendingTransferId = null;
            this._busy = false;
            Events.fire('transfer-cancelled', { id: transferId, status: 'cancelled' });
            this._dequeueFile();
        } else {
            const lenBefore = this._filesQueue.length;
            this._filesQueue = this._filesQueue.filter(file => file.transferId !== transferId);
            if (this._filesQueue.length < lenBefore) {
                Events.fire('transfer-cancelled', { id: transferId, status: 'cancelled' });
            }
        }
    }

    _onCancelTransferReceived(message) {
        if (this._activeTransferId === message.transferId) {
            this._cleanActiveTransfer('remote-cancelled');
            Events.fire('notify-user', window.I18n.t('net_transfer_cancelled_peer'));
        }
    }

    _cleanActiveTransfer(status) {
        const tid = this._activeTransferId;
        const wasVoice = this._activeIsVoice;
        const voiceDuration = this._activeVoiceDuration;
        const voiceDirection = this._activeVoiceDirection;
        this._activeTransferId = null;
        this._activeIsVoice = false;
        this._chunker = null;
        this._digester = null;
        this._busy = false;
        this._releaseSlotIfHeld(); // no-op if we're the receiver side (never held a slot)
        if (wasVoice) {
            Events.fire('voice-message', {
                id: tid, peerId: this._peerId, duration: voiceDuration,
                direction: voiceDirection, status: 'failed', timestamp: Date.now()
            });
        } else {
            Events.fire('transfer-cancelled', { id: tid, status: status });
        }
        this._dequeueFile();
    }

    /**
     * Queue a chat message for delivery. Unlike the old fire-and-forget
     * version, this never silently drops text: if we're not connected right
     * now it waits in `_textOutbox` for a reconnect (see `_flushTextOutbox`),
     * and once sent it's tracked in `_pendingTexts` until a `text-ack`
     * arrives or `TEXT_MAX_RETRIES` is exhausted (see `_onTextTimeout`).
     * Every state transition (sending/delivered/failed) is broadcast via a
     * `message-updated` event and appended to `_textHistory` so the UI can
     * render a persistent per-peer thread instead of a single "last
     * message" popup.
     * @param {string} text
     * @returns {string} the message id, so callers can correlate UI state if they want to
     */
    sendText(text) {
        const id = 'msg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        this._pendingTexts.set(id, { text, attempts: 0, timer: null });
        this._recordText(id, text, 'outgoing', 'sending');
        this._dispatchText(id, text);
        return id;
    }

    /** Append/update one message in this peer's thread and notify the UI. */
    _recordText(id, text, direction, status) {
        let entry = this._textHistory.find(m => m.id === id);
        if (!entry) {
            entry = { id, text, direction, status, timestamp: Date.now() };
            this._textHistory.push(entry);
            // Keep the in-memory thread bounded; this is a live chat aid, not persistent storage.
            if (this._textHistory.length > 200) this._textHistory.shift();
        } else {
            entry.status = status;
        }
        Events.fire('message-updated', {
            peerId: this._peerId,
            id, text, direction, status,
            timestamp: entry.timestamp
        });
    }

    /**
     * Actually put a message on the wire (chunked if needed), or park it in
     * the outbox if the transport isn't connected. Also (re)arms the
     * per-message ack timer.
     */
    _dispatchText(id, text) {
        if (!this._isConnected()) {
            if (!this._textOutbox.includes(id)) this._textOutbox.push(id);
            return;
        }
        const idx = this._textOutbox.indexOf(id);
        if (idx > -1) this._textOutbox.splice(idx, 1);

        const encoded = MessageCodec.encode(text);
        const total = Math.max(1, Math.ceil(encoded.length / TEXT_CHUNK_CHARS));
        for (let i = 0; i < total; i++) {
            const part = encoded.substring(i * TEXT_CHUNK_CHARS, (i + 1) * TEXT_CHUNK_CHARS);
            this.sendJSON({ type: 'text', id, index: i, total, text: part });
        }
        this._armTextAckTimer(id);
    }

    _armTextAckTimer(id) {
        const pending = this._pendingTexts.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pending.timer = setTimeout(() => this._onTextTimeout(id), TEXT_ACK_TIMEOUT_MS);
    }

    _onTextTimeout(id) {
        const pending = this._pendingTexts.get(id);
        if (!pending) return; // already acked in the meantime
        pending.attempts++;
        if (pending.attempts > TEXT_MAX_RETRIES) {
            this._pendingTexts.delete(id);
            this._recordText(id, pending.text, 'outgoing', 'failed');
            return;
        }
        this._recordText(id, pending.text, 'outgoing', 'sending');
        this._dispatchText(id, pending.text);
    }

    _onTextAck(message) {
        const pending = this._pendingTexts.get(message.id);
        if (!pending) return; // late/duplicate ack, or already timed out and given up
        clearTimeout(pending.timer);
        this._pendingTexts.delete(message.id);
        this._recordText(message.id, pending.text, 'outgoing', 'delivered');
    }

    /**
     * Resend anything that was queued while disconnected. Called once a
     * transport becomes usable again (RTCPeer on channel open, and by
     * PeersManager on signaling-socket reconnect for WSPeer).
     */
    _flushTextOutbox() {
        if (!this._textOutbox.length || !this._isConnected()) return;
        const ids = this._textOutbox.splice(0);
        ids.forEach(id => {
            const pending = this._pendingTexts.get(id);
            if (pending) this._dispatchText(id, pending.text);
        });
    }

    _onTextReceived(message) {
        const total = message.total || 1;
        let entry = this._incomingTexts.get(message.id);
        if (!entry) {
            entry = { parts: new Array(total) };
            this._incomingTexts.set(message.id, entry);
        }
        entry.parts[message.index || 0] = message.text;
        if (entry.parts.some(part => part === undefined)) return; // still waiting on more chunks

        this._incomingTexts.delete(message.id);
        const text = MessageCodec.decode(entry.parts.join(''));
        this._recordText(message.id, text, 'incoming', 'delivered');
        // Ack only once the full (possibly multi-chunk) message has been
        // reassembled, so the sender's retry only fires for messages we
        // genuinely never finished receiving.
        this.sendJSON({ type: 'text-ack', id: message.id });
        Events.fire('text-received', { text, sender: this._peerId, id: message.id });
    }

    /**
     * Silently push a clipboard-sync payload to this peer. Distinct from
     * sendText()/`text` messages: no dialog pops up on the receiving end,
     * it's meant to transparently mirror the OS clipboard across paired
     * devices (see ClipboardSync in clipboard-sync.js). Best-effort/"latest
     * wins" like the rest of clipboard sync, so it deliberately does not go
     * through the ack/retry/outbox pipeline sendText() uses.
     * @param {string} text
     */
    sendClipboardText(text) {
        this.sendJSON({ type: 'clipboard-sync', text: MessageCodec.encode(text) });
    }

    _onClipboardSyncReceived(message) {
        Events.fire('clipboard-sync-received', { text: MessageCodec.decode(message.text), sender: this._peerId });
    }
}

/**
 * A peer reached over a real WebRTC RTCDataChannel (P2P, does not transit
 * the signaling server once connected). Falls back to WSPeer
 * (server-relayed) via `_fallbackToWSPeer()` if the data channel never
 * opens (e.g. symmetric NAT without a working TURN relay).
 */
class RTCPeer extends Peer {

    constructor(serverConnection, peerId) {
        super(serverConnection, peerId);
        if (!peerId) return; // we will listen for a caller
        this._connect(peerId, true);
    }

    _connect(peerId, isCaller) {
        if (!this._conn) this._openConnection(peerId, isCaller);

        if (isCaller) {
            this._openChannel();
        } else {
            this._conn.ondatachannel = e => this._onChannelOpened(e);
        }
    }

    _openConnection(peerId, isCaller) {
        this._isCaller = isCaller;
        this._peerId = peerId;
        this._conn = new RTCPeerConnection(RTCPeer.config);
        this._conn.onicecandidate = e => this._onIceCandidate(e);
        this._conn.onconnectionstatechange = e => this._onConnectionStateChange(e);
        this._conn.oniceconnectionstatechange = e => this._onIceConnectionStateChange(e);
    }

    _openChannel() {
        const channel = this._conn.createDataChannel('data-channel', { 
            ordered: true,
            reliable: true // Obsolete. See https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/reliable
        });
        channel.onopen = e => this._onChannelOpened(e);
        this._conn.createOffer().then(d => this._onDescription(d)).catch(e => this._onError(e));
    }

    _onDescription(description) {
        // description.sdp = description.sdp.replace('b=AS:30', 'b=AS:1638400');
        this._conn.setLocalDescription(description)
            .then(_ => this._sendSignal({ sdp: description }))
            .catch(e => this._onError(e));
    }

    _onIceCandidate(event) {
        if (!event.candidate) return;
        this._sendSignal({ ice: event.candidate });
    }

    onServerMessage(message) {
        if (!this._conn) this._connect(message.sender, false);

        if (message.sdp) {
            this._conn.setRemoteDescription(new RTCSessionDescription(message.sdp))
                .then( _ => {
                    if (message.sdp.type === 'offer') {
                        return this._conn.createAnswer()
                            .then(d => this._onDescription(d));
                    }
                })
                .catch(e => this._onError(e));
        } else if (message.ice) {
            this._conn.addIceCandidate(new RTCIceCandidate(message.ice));
        }
    }

    _onChannelOpened(event) {
        console.log('RTC: channel opened with', this._peerId);
        const channel = event.channel || event.target;
        channel.binaryType = 'arraybuffer';
        channel.onmessage = e => this._onMessage(e.data);
        channel.onclose = e => this._onChannelClosed();
        this._channel = channel;
        this._flushTextOutbox();
    }

    _onChannelClosed() {
        console.log('RTC: channel closed', this._peerId);
        if (!this.isCaller) return;
        this._connect(this._peerId, true); // reopen the channel
    }

    _onConnectionStateChange(e) {
        if (!this._conn) return;
        console.log('RTC: state changed:', this._conn.connectionState);
        switch (this._conn.connectionState) {
            case 'disconnected':
                this._onChannelClosed();
                break;
            case 'failed':
                this._conn = null;
                this._onChannelClosed();
                this._fallbackToWSPeer();
                break;
        }
    }

    _onIceConnectionStateChange() {
        if (!this._conn) return;
        switch (this._conn.iceConnectionState) {
            case 'failed':
                console.error('ICE Gathering failed');
                this._fallbackToWSPeer();
                break;
            default:
                console.log('ICE Gathering', this._conn.iceConnectionState);
        }
    }

    _fallbackToWSPeer() {
        Events.fire('peer-fallback', this._peerId);
    }

    _onError(error) {
        console.error(error);
    }

    _send(message) {
        if (!this._isConnected()) {
            this.refresh();
            return false;
        }
        try {
            this._channel.send(message);
            return true;
        } catch (e) {
            // e.g. the channel closed in the instant between our readyState
            // check and .send() (peer navigated away, network blip). Don't
            // let this bubble up as an uncaught exception - just try to
            // reconnect; anything relying on delivery confirmation (chat
            // text) has its own ack/retry/outbox layer above this.
            console.error('RTC: send failed', e);
            this.refresh();
            return false;
        }
    }

    /**
     * Pause the file-transfer partition loop while the data channel's send
     * buffer is above the high watermark, resuming once it drains back
     * below the low watermark. Without this a fast sender on a slow link
     * can pile many MB into `bufferedAmount` between partition acks.
     * @param {() => void} cb
     */
    _waitForBufferSpace(cb) {
        const channel = this._channel;
        if (!channel || channel.bufferedAmount <= RTC_BUFFERED_AMOUNT_HIGH_WATERMARK) {
            cb();
            return;
        }
        channel.bufferedAmountLowThreshold = RTC_BUFFERED_AMOUNT_LOW_WATERMARK;
        const onLow = () => {
            channel.removeEventListener('bufferedamountlow', onLow);
            cb();
        };
        channel.addEventListener('bufferedamountlow', onLow);
    }

    _sendSignal(signal) {
        signal.type = 'signal';
        signal.to = this._peerId;
        this._server.send(signal);
    }

    refresh() {
        // check if channel is open. otherwise create one
        if (this._isConnected() || this._isConnecting()) return;
        this._connect(this._peerId, this._isCaller);
    }

    _isConnected() {
        return this._channel && this._channel.readyState === 'open';
    }

    _isConnecting() {
        return this._channel && this._channel.readyState === 'connecting';
    }
}

/**
 * Owns the map of peerId -> Peer instance (RTCPeer or WSPeer) and reacts
 * to signaling-server events (`peers`, `peer-joined`, `peer-left`,
 * `signal`, `turn-config`) to create/tear down connections as devices
 * come and go. This is the object UI code should go through to send
 * files/text to a given peer id.
 */
class PeersManager {

    constructor(serverConnection) {
        this.peers = {};
        this._server = serverConnection;
        Events.on('signal', e => this._onMessage(e.detail));
        Events.on('peer-message', e => this._onPeerMessage(e.detail));
        Events.on('peer-fallback', e => this._onPeerFallback(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('files-selected', e => this._onFilesSelected(e.detail));
        Events.on('send-text', e => this._onSendText(e.detail));
        Events.on('voice-selected', e => this._onVoiceSelected(e.detail));
        Events.on('clipboard-sync-broadcast', e => this._onClipboardSyncBroadcast(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('turn-config', e => this._onTurnConfig(e.detail));
        Events.on('ws-connected', e => this._flushAllTextOutboxes());
    }

    /**
     * Retry any chat messages that were queued while disconnected. RTCPeer
     * already flushes itself as soon as its data channel opens; this covers
     * WSPeer (relayed over the signaling socket, so "connected" tracks the
     * signaling socket itself) reconnecting after `ServerConnection`'s
     * 5s retry timer fires.
     */
    _flushAllTextOutboxes() {
        Object.values(this.peers).forEach(peer => {
            if (peer && typeof peer._flushTextOutbox === 'function') peer._flushTextOutbox();
        });
    }

    _onTurnConfig(config) {
        console.log('WS: Setting ICE Servers config', config.iceServers);
        RTCPeer.config.iceServers = config.iceServers;
    }

    _onMessage(message) {
        if (!this.peers[message.sender]) {
            this.peers[message.sender] = new RTCPeer(this._server);
        }
        this.peers[message.sender].onServerMessage(message);
    }

    _onPeerMessage(message) {
        const senderId = message.sender;
        if (!this.peers[senderId]) {
            this.peers[senderId] = new WSPeer(this._server, senderId);
        }
        const peer = this.peers[senderId];
        if (peer instanceof WSPeer) {
            peer.onServerMessage(message);
        }
    }

    _onPeerFallback(peerId) {
        const oldPeer = this.peers[peerId];
        if (oldPeer && oldPeer instanceof RTCPeer) {
            try {
                if (oldPeer._channel) oldPeer._channel.close();
                if (oldPeer._conn) oldPeer._conn.close();
            } catch (e) {}

            // The in-flight file (if any) was already shifted out of
            // _filesQueue by _dequeueFile and isn't requeued here, so any
            // scheduler slot oldPeer was holding/awaiting for it would
            // otherwise leak.
            oldPeer._pendingTransferId = null;
            if (oldPeer._releaseSlotIfHeld) oldPeer._releaseSlotIfHeld();

            const filesQueue = oldPeer._filesQueue || [];
            const wsPeer = new WSPeer(this._server, peerId);
            wsPeer._filesQueue = filesQueue;
            this.peers[peerId] = wsPeer;

            if (filesQueue.length > 0) {
                wsPeer._dequeueFile();
            }
            console.log(`Successfully fell back to WSPeer for peer ${peerId}`);
        }
    }

    _onPeers(peers) {
        peers.forEach(peer => {
            if (this.peers[peer.id]) {
                this.peers[peer.id].refresh();
                return;
            }
            if (window.isRtcSupported && peer.rtcSupported) {
                this.peers[peer.id] = new RTCPeer(this._server, peer.id);
            } else {
                this.peers[peer.id] = new WSPeer(this._server, peer.id);
            }
        })
    }

    sendTo(peerId, message) {
        this.peers[peerId].send(message);
    }

    _onFilesSelected(message) {
        this.peers[message.to].sendFiles(message.files);
    }

    _onSendText(message) {
        this.peers[message.to].sendText(message.text);
    }

    _onVoiceSelected(message) {
        const peer = this.peers[message.to];
        if (!peer) return;
        peer.sendVoice(message.blob, message.duration);
    }

    /**
     * Broadcast a clipboard-sync payload to every currently reachable peer
     * (both direct RTCPeer connections and WSPeer relay fallbacks). Peers
     * that never finished connecting are skipped rather than queued —
     * clipboard sync is best-effort/"latest wins", not a guaranteed
     * delivery like file transfers.
     * @param {{text: string}} detail
     */
    _onClipboardSyncBroadcast(detail) {
        Object.values(this.peers).forEach(peer => {
            if (!peer || typeof peer._isConnected !== 'function' || !peer._isConnected()) return;
            peer.sendClipboardText(detail.text);
        });
    }

    _onPeerLeft(peerId) {
        const peer = this.peers[peerId];
        delete this.peers[peerId];
        if (!peer) return;
        if (peer._channel) {
            try { peer._channel.close(); } catch (e) {}
        }
        if (peer._conn) {
            try { peer._conn.close(); } catch (e) {}
        }
        // Drop any global TransferScheduler slot this peer was holding or
        // waiting on, so a mid-transfer disconnect doesn't permanently
        // shrink everyone else's concurrency budget. Clearing
        // _pendingTransferId also makes the queued requestSlot() callback
        // (if any) a no-op instead of sending into a torn-down connection.
        peer._pendingTransferId = null;
        if (peer._releaseSlotIfHeld) peer._releaseSlotIfHeld();
    }

}

/**
 * Fallback peer transport: file bytes are relayed through the signaling
 * WebSocket (server/index.js `_onMessage` relay-by-`to` logic) instead of
 * a direct P2P WebRTC channel. Used when WebRTC isn't supported or a
 * direct/TURN-relayed connection couldn't be established.
 */
class WSPeer extends Peer {
    constructor(serverConnection, peerId) {
        super(serverConnection, peerId);
    }

    sendFiles(files) {
        const LIMIT = 10 * 1024 * 1024;
        const largeFiles = [];
        const okFiles = [];
        for (let i = 0; i < files.length; i++) {
            if (files[i].size > LIMIT) {
                largeFiles.push(files[i]);
            } else {
                okFiles.push(files[i]);
            }
        }
        
        if (largeFiles.length > 0) {
            Events.fire('notify-user', window.I18n.t('net_relay_limit'));
        }
        
        if (okFiles.length > 0) {
            super.sendFiles(okFiles);
        }
    }

    _send(message) {
        if (typeof message === 'string') {
            this._server.send({
                type: 'peer-message',
                to: this._peerId,
                message: message
            });
        } else {
            this._sendArrayBuffer(message);
        }
    }

    _sendArrayBuffer(arrayBuffer) {
        const base64 = this._arrayBufferToBase64(arrayBuffer);
        this.sendJSON({
            type: 'peer-message',
            to: this._peerId,
            message: base64,
            isBinary: true
        });
    }

    onServerMessage(message) {
        if (message.isBinary) {
            const arrayBuffer = this._base64ToArrayBuffer(message.message);
            this._onMessage(arrayBuffer);
        } else {
            this._onMessage(message.message);
        }
    }

    _arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    _base64ToArrayBuffer(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }

    refresh() {
    }

    _isConnected() {
        return this._server._isConnected();
    }

    _isConnecting() {
        return this._server._isConnecting();
    }
}

/**
 * Reads a File in fixed-size chunks (64 KB) grouped into partitions
 * (1 MB), pausing after each partition until the receiver acknowledges
 * it (see Peer#_onPartitionEnd / #_onReceivedPartitionEnd) — a simple
 * flow-control scheme so a fast sender can't overrun a slow
 * RTCDataChannel receive buffer.
 */
class FileChunker {

    /**
     * @param {File} file
     * @param {(chunk: ArrayBuffer) => void} onChunk
     * @param {(offset: number) => void} onPartitionEnd
     */
    constructor(file, onChunk, onPartitionEnd) {
        this._chunkSize = 64000; // 64 KB
        this._maxPartitionSize = 1e6; // 1 MB
        this._offset = 0;
        this._partitionSize = 0;
        this._file = file;
        this._onChunk = onChunk;
        this._onPartitionEnd = onPartitionEnd;
        this._aborted = false;
        this._reader = new FileReader();
        this._reader.addEventListener('load', e => this._onChunkRead(e.target.result));
    }

    abort() {
        this._aborted = true;
    }

    nextPartition() {
        if (this._aborted) return;
        this._partitionSize = 0;
        this._readChunk();
    }

    _readChunk() {
        if (this._aborted) return;
        const chunk = this._file.slice(this._offset, this._offset + this._chunkSize);
        this._reader.readAsArrayBuffer(chunk);
    }

    _onChunkRead(chunk) {
        if (this._aborted) return;
        this._offset += chunk.byteLength;
        this._partitionSize += chunk.byteLength;
        this._onChunk(chunk);
        if (this.isFileEnd()) return;
        if (this._isPartitionEnd()) {
            this._onPartitionEnd(this._offset);
            return;
        }
        this._readChunk();
    }

    repeatPartition() {
        this._offset -= this._partitionSize;
        this._nextPartition();
    }

    _isPartitionEnd() {
        return this._partitionSize >= this._maxPartitionSize;
    }

    isFileEnd() {
        return this._offset >= this._file.size;
    }

    get progress() {
        return this._offset / this._file.size;
    }
}

/**
 * Reassembles chunks received from a FileChunker (possibly relayed
 * through WSPeer) back into a single Blob, tracking download progress.
 */
class FileDigester {

    /**
     * @param {{size: number, mime?: string, name: string}} meta
     * @param {(file: {name: string, mime: string, size: number, blob: Blob}) => void} callback
     */
    constructor(meta, callback) {
        this._buffer = [];
        this._bytesReceived = 0;
        this._size = meta.size;
        this._mime = meta.mime || 'application/octet-stream';
        this._name = meta.name;
        this._callback = callback;
    }

    unchunk(chunk) {
        this._buffer.push(chunk);
        this._bytesReceived += chunk.byteLength || chunk.size;
        const totalChunks = this._buffer.length;
        this.progress = this._bytesReceived / this._size;
        if (isNaN(this.progress)) this.progress = 1

        if (this._bytesReceived < this._size) return;
        // we are done
        let blob = new Blob(this._buffer, { type: this._mime });
        this._callback({
            name: this._name,
            mime: this._mime,
            size: this._size,
            blob: blob
        });
    }

}

class Events {
    static fire(type, detail) {
        window.dispatchEvent(new CustomEvent(type, { detail: detail }));
    }

    static on(type, callback) {
        return window.addEventListener(type, callback, false);
    }

    static off(type, callback) {
        return window.removeEventListener(type, callback, false);
    }
}


RTCPeer.config = {
    'sdpSemantics': 'unified-plan',
    'iceServers': [{
        urls: 'stun:stun.l.google.com:19302'
    }]
}
