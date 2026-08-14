window.URL = window.URL || window.webkitURL;
window.isRtcSupported = !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);

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
        ws.onopen = e => console.log('WS: server connected');
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
        Events.fire('notify-user', 'Connection lost. Retry in 5 seconds...');
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

class Peer {

    constructor(serverConnection, peerId) {
        this._server = serverConnection;
        this._peerId = peerId;
        this._filesQueue = [];
        this._busy = false;
    }

    sendJSON(message) {
        this._send(JSON.stringify(message));
    }

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
        this._busy = true;
        const file = this._filesQueue.shift();
        Events.fire('transfer-active', { id: file.transferId });
        this._sendFile(file);
    }

    _sendFile(file) {
        this._activeTransferId = file.transferId;
        this.sendJSON({
            type: 'header',
            transferId: file.transferId,
            name: file.name,
            mime: file.type,
            size: file.size
        });
        Events.fire('transfer-started', {
            id: file.transferId,
            name: file.name,
            size: file.size,
            peerId: this._peerId,
            direction: 'outgoing',
            status: 'transferring'
        });
        this._chunker = new FileChunker(file,
            chunk => this._send(chunk),
            offset => this._onPartitionEnd(offset));
        this._chunker.nextPartition();
    }

    _onPartitionEnd(offset) {
        this.sendJSON({ type: 'partition', offset: offset });
    }

    _onReceivedPartitionEnd(offset) {
        this.sendJSON({ type: 'partition-received', offset: offset });
    }

    _sendNextPartition() {
        if (!this._chunker || this._chunker.isFileEnd()) return;
        this._chunker.nextPartition();
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
        }
    }

    _onFileHeader(header) {
        this._lastProgress = 0;
        this._activeTransferId = header.transferId;
        this._digester = new FileDigester({
            name: header.name,
            mime: header.mime,
            size: header.size
        }, file => this._onFileReceived(file));
        Events.fire('transfer-started', {
            id: header.transferId,
            name: header.name,
            size: header.size,
            peerId: this._peerId,
            direction: 'incoming',
            status: 'transferring'
        });
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
        Events.fire('transfer-completed', { id: this._activeTransferId });
        Events.fire('file-received', proxyFile);
        this.sendJSON({ type: 'transfer-complete' });
        this._activeTransferId = null;
        this._busy = false;
    }

    _onTransferCompleted() {
        Events.fire('transfer-completed', { id: this._activeTransferId });
        this._onDownloadProgress(1);
        this._reader = null;
        this._busy = false;
        this._activeTransferId = null;
        this._dequeueFile();
        Events.fire('notify-user', 'File transfer completed.');
    }

    cancelTransfer(transferId) {
        if (this._activeTransferId === transferId) {
            if (this._chunker) {
                this._chunker.abort();
            }
            this.sendJSON({ type: 'cancel-transfer', transferId: transferId });
            this._cleanActiveTransfer('cancelled');
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
            Events.fire('notify-user', 'File transfer was cancelled by the other device.');
        }
    }

    _cleanActiveTransfer(status) {
        const tid = this._activeTransferId;
        this._activeTransferId = null;
        this._chunker = null;
        this._digester = null;
        this._busy = false;
        Events.fire('transfer-cancelled', { id: tid, status: status });
        this._dequeueFile();
    }

    sendText(text) {
        const unescaped = btoa(unescape(encodeURIComponent(text)));
        this.sendJSON({ type: 'text', text: unescaped });
    }

    _onTextReceived(message) {
        const escaped = decodeURIComponent(escape(atob(message.text)));
        Events.fire('text-received', { text: escaped, sender: this._peerId });
    }
}

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
        if (!this._channel) return this.refresh();
        this._channel.send(message);
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
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('turn-config', e => this._onTurnConfig(e.detail));
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
    }

}

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
            Events.fire('notify-user', `Files > 10MB cannot be sent via relay (WebRTC failed).`);
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

class FileChunker {

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

class FileDigester {

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
