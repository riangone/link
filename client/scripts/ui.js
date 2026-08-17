const $ = query => document.getElementById(query);
const $$ = query => document.body.querySelector(query);
const isURL = text => /^((https?:\/\/|www)[^\s]+)/g.test(text.toLowerCase());
window.isDownloadSupported = (typeof document.createElement('a').download !== 'undefined');
window.isProductionEnvironment = !window.location.host.startsWith('localhost');
window.iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// set display name
Events.on('display-name', e => {
    const me = e.detail.message;
    const $displayName = $('displayName');
    const savedNick = localStorage.getItem('custom-nickname');
    window.myDisplayName = savedNick || me.displayName;
    window.myDeviceName = me.deviceName;
    $displayName.textContent = window.I18n.t('known_as', { name: window.myDisplayName });
    $displayName.title = me.deviceName;
});

Events.on('language-changed', () => {
    const $displayName = $('displayName');
    if ($displayName && window.myDisplayName) {
        $displayName.textContent = window.I18n.t('known_as', { name: window.myDisplayName });
    }
});

// Prevent the browser's default "open file in new tab" behavior when a file
// is dropped anywhere outside of a specific drop target. Registered once at
// module scope (was previously re-registered on window for every single
// PeerUI instance, leaking one extra listener per peer joined/left).
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

class PeersUI {

    constructor() {
        Events.on('peer-joined', e => this._onPeerJoined(e.detail));
        Events.on('peer-left', e => this._onPeerLeft(e.detail));
        Events.on('peers', e => this._onPeers(e.detail));
        Events.on('file-progress', e => this._onFileProgress(e.detail));
        Events.on('paste', e => this._onPaste(e));
        Events.on('peer-nickname-changed', e => this._onPeerNicknameChanged(e.detail));
        Events.on('peer-fallback', e => this._onPeerFallback(e.detail));
        Events.on('language-changed', () => this._onLanguageChanged());
    }

    _onLanguageChanged() {
        document.querySelectorAll('x-peer').forEach($peer => {
            if ($peer.ui) {
                const label = $peer.querySelector('label');
                if (label) label.setAttribute('title', window.I18n.t('peer_title'));
                const $connType = $peer.querySelector('.connection-type');
                if ($connType) {
                    const isRelay = $connType.classList.contains('relay');
                    $connType.textContent = window.I18n.t(isRelay ? 'relay' : 'p2p');
                }
            }
        });
    }

    _onPeerJoined(peer) {
        if ($(peer.id)) return; // peer already exists
        const peerUI = new PeerUI(peer);
        $$('x-peers').appendChild(peerUI.$el);
        setTimeout(e => window.animateBackground(false), 1750); // Stop animation
    }

    _onPeers(peers) {
        this._clearPeers();
        peers.forEach(peer => this._onPeerJoined(peer));
    }

    _onPeerLeft(peerId) {
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.remove();
    }

    _onFileProgress(progress) {
        const peerId = progress.sender || progress.recipient;
        const $peer = $(peerId);
        if (!$peer) return;
        $peer.ui.setProgress(progress.progress);
    }

    _clearPeers() {
        const $peers = $$('x-peers').innerHTML = '';
    }

    _onPeerNicknameChanged(detail) {
        const $peer = $(detail.peerId);
        if ($peer && $peer.ui) {
            $peer.ui.updateDisplayName(detail.displayName);
        }
    }

    _onPeerFallback(peerId) {
        const $peer = $(peerId);
        if ($peer && $peer.ui) {
            $peer.ui.setConnectionType('Relay');
        }
    }

    _onPaste(e) {
        const files = e.clipboardData.files || e.clipboardData.items
            .filter(i => i.type.indexOf('image') > -1)
            .map(i => i.getAsFile());
        const peers = document.querySelectorAll('x-peer');
        if (files.length > 0 && peers.length === 1) {
            Events.fire('files-selected', {
                files: files,
                to: $$('x-peer').id
            });
        }
    }
}

class PeerUI {

    html() {
        const titleText = window.I18n.t('peer_title');
        return `
            <label class="column center" title="${titleText}">
                <input type="file" multiple>
                <x-icon shadow="1">
                    <svg class="icon"><use xlink:href="#"/></svg>
                </x-icon>
                <div class="progress">
                  <div class="circle"></div>
                  <div class="circle right"></div>
                </div>
                <div class="name font-subheading"></div>
                <div class="device-name font-body2"></div>
                <div class="status font-body2"></div>
                <div class="connection-type font-body2 p2p">P2P</div>
            </label>`
    }

    constructor(peer) {
        this._peer = peer;
        this._initDom();
        this._bindListeners(this.$el);
    }

    _initDom() {
        const el = document.createElement('x-peer');
        el.id = this._peer.id;
        el.innerHTML = this.html();
        el.ui = this;
        el.querySelector('svg use').setAttribute('xlink:href', this._icon());
        el.querySelector('.name').textContent = this._displayName();
        el.querySelector('.device-name').textContent = this._deviceName();
        this.$el = el;
        this.$progress = el.querySelector('.progress');

        const isRtc = window.isRtcSupported && this._peer.rtcSupported;
        this.setConnectionType(isRtc ? 'P2P' : 'Relay');
    }

    _bindListeners(el) {
        el.querySelector('input').addEventListener('change', e => this._onFilesSelected(e));
        el.addEventListener('drop', e => this._onDrop(e));
        el.addEventListener('dragend', e => this._onDragEnd(e));
        el.addEventListener('dragleave', e => this._onDragEnd(e));
        el.addEventListener('dragover', e => this._onDragOver(e));
        el.addEventListener('contextmenu', e => this._onRightClick(e));
        el.addEventListener('touchstart', e => this._onTouchStart(e), { passive: true });
        el.addEventListener('touchend', e => this._onTouchEnd(e));
        el.addEventListener('touchmove', e => this._onTouchMove(e), { passive: true });
        el.addEventListener('touchcancel', e => this._onTouchCancel(e));
    }

    _displayName() {
        return this._peer.name.displayName;
    }

    _deviceName() {
        return this._peer.name.deviceName;
    }

    _icon() {
        const device = this._peer.name.device || this._peer.name;
        if (device.type === 'mobile') {
            return '#phone-iphone';
        }
        if (device.type === 'tablet') {
            return '#tablet-mac';
        }
        return '#desktop-mac';
    }

    _onFilesSelected(e) {
        const $input = e.target;
        const files = $input.files;
        Events.fire('files-selected', {
            files: files,
            to: this._peer.id
        });
        $input.value = null; // reset input
    }

    setProgress(progress) {
        if (progress > 0) {
            this.$el.setAttribute('transfer', '1');
        }
        if (progress > 0.5) {
            this.$progress.classList.add('over50');
        } else {
            this.$progress.classList.remove('over50');
        }
        const degrees = `rotate(${360 * progress}deg)`;
        this.$progress.style.setProperty('--progress', degrees);
        if (progress >= 1) {
            this.setProgress(0);
            this.$el.removeAttribute('transfer');
        }
    }

    updateDisplayName(name) {
        this._peer.name.displayName = name;
        this.$el.querySelector('.name').textContent = name;
    }

    setConnectionType(type) {
        const $connType = this.$el.querySelector('.connection-type');
        if ($connType) {
            $connType.textContent = window.I18n.t(type.toLowerCase());
            $connType.className = `connection-type font-body2 ${type.toLowerCase()}`;
        }
    }

    _onDrop(e) {
        e.preventDefault();
        const files = e.dataTransfer.files;
        Events.fire('files-selected', {
            files: files,
            to: this._peer.id
        });
        this._onDragEnd();
    }

    _onDragOver() {
        this.$el.setAttribute('drop', 1);
    }

    _onDragEnd() {
        this.$el.removeAttribute('drop');
    }

    _onRightClick(e) {
        e.preventDefault();
        Events.fire('text-recipient', this._peer.id);
    }

    _onTouchStart(e) {
        this._touchStart = Date.now();
        this._isLongPress = false;
        
        if (e.touches && e.touches.length > 0) {
            this._touchStartX = e.touches[0].clientX;
            this._touchStartY = e.touches[0].clientY;
        }

        clearTimeout(this._touchTimer);
        this._touchTimer = setTimeout(() => {
            this._isLongPress = true;
            if (navigator.vibrate) navigator.vibrate(50);
            Events.fire('text-recipient', this._peer.id);
        }, 600);
    }

    _onTouchMove(e) {
        if (!this._touchStartX || !this._touchStartY || !e.touches || e.touches.length === 0) return;
        
        const deltaX = Math.abs(e.touches[0].clientX - this._touchStartX);
        const deltaY = Math.abs(e.touches[0].clientY - this._touchStartY);
        
        if (deltaX > 10 || deltaY > 10) {
            clearTimeout(this._touchTimer);
        }
    }

    _onTouchCancel(e) {
        clearTimeout(this._touchTimer);
        this._isLongPress = false;
    }

    _onTouchEnd(e) {
        clearTimeout(this._touchTimer);
        if (this._isLongPress) {
            if (e) e.preventDefault();
            this._isLongPress = false;
        }
    }
}


class Dialog {
    constructor(id) {
        this.$el = $(id);
        this.$el.querySelectorAll('[close]').forEach(el => el.addEventListener('click', e => this.hide()))
        this.$autoFocus = this.$el.querySelector('[autofocus]');
    }

    show() {
        this.$el.setAttribute('show', 1);
        if (this.$autoFocus) this.$autoFocus.focus();
    }

    hide() {
        this.$el.removeAttribute('show');
        document.activeElement.blur();
        window.blur();
    }
}

class ReceiveDialog extends Dialog {

    constructor() {
        super('receiveDialog');
        Events.on('file-received', e => {
            this._nextFile(e.detail);
            window.blop.play();
        });
        this._filesQueue = [];
    }

    _nextFile(nextFile) {
        if (nextFile) this._filesQueue.push(nextFile);
        if (this._busy) return;
        this._busy = true;
        const file = this._filesQueue.shift();
        this._displayFile(file);
    }

    _dequeueFile() {
        if (!this._filesQueue.length) { // nothing to do
            this._busy = false;
            return;
        }
        // dequeue next file
        setTimeout(_ => {
            this._busy = false;
            this._nextFile();
        }, 300);
    }

    _displayFile(file) {
        const $a = this.$el.querySelector('#download');
        const url = URL.createObjectURL(file.blob);
        $a.href = url;
        $a.download = file.name;

        if(this._autoDownload()){
            $a.click()
            return
        }
        if(file.mime.split('/')[0] === 'image'){
            console.log('the file is image');
            this.$el.querySelector('.preview').style.visibility = 'inherit';
            this.$el.querySelector("#img-preview").src = url;
        }

        this.$el.querySelector('#fileName').textContent = file.name;
        this.$el.querySelector('#fileSize').textContent = this._formatFileSize(file.size);
        this.show();

        if (window.isDownloadSupported) return;
        // fallback for iOS
        $a.target = '_blank';
        const reader = new FileReader();
        reader.onload = e => $a.href = reader.result;
        reader.readAsDataURL(file.blob);
    }

    _formatFileSize(bytes) {
        if (bytes >= 1e9) {
            return (Math.round(bytes / 1e8) / 10) + ' GB';
        } else if (bytes >= 1e6) {
            return (Math.round(bytes / 1e5) / 10) + ' MB';
        } else if (bytes > 1000) {
            return Math.round(bytes / 1000) + ' KB';
        } else {
            return bytes + ' Bytes';
        }
    }

    hide() {
        this.$el.querySelector('.preview').style.visibility = 'hidden';
        this.$el.querySelector("#img-preview").src = "";
        super.hide();
        this._dequeueFile();
    }


    _autoDownload(){
        return !this.$el.querySelector('#autoDownload').checked
    }
}


/**
 * Wraps MediaRecorder to capture a single voice message. One instance is
 * reused across recordings (see SendTextDialog._recorder) - start()/stop()
 * just re-arm it. Deliberately has no knowledge of peers/network; it only
 * ever hands back a Blob + duration via onStop, exactly like picking a file
 * from an <input type=file> hands back a File. What happens to that Blob
 * (Peer#sendVoice in network.js) is the caller's problem.
 */
class VoiceRecorder {

    static MAX_DURATION_MS = 60000; // hard cap so one voice message can't grow unbounded

    constructor() {
        this._mediaRecorder = null;
        this._stream = null;
        this._chunks = [];
        this._startTime = 0;
        this._maxTimer = null;
        this._cancelled = false;
        this.onStop = null;  // (blob: Blob, durationSeconds: number) => void
        this.onError = null; // (error: Error) => void
    }

    get isRecording() {
        return !!this._mediaRecorder && this._mediaRecorder.state === 'recording';
    }

    async start() {
        if (this.isRecording) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
            this.onError && this.onError(new Error('voice recording not supported'));
            return;
        }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            this.onError && this.onError(e);
            return;
        }
        this._stream = stream;
        this._chunks = [];
        this._cancelled = false;
        const mimeType = VoiceRecorder._pickMimeType();
        this._mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        this._mediaRecorder.addEventListener('dataavailable', e => {
            if (e.data && e.data.size > 0) this._chunks.push(e.data);
        });
        this._mediaRecorder.addEventListener('stop', () => this._onRecorderStop());
        this._startTime = Date.now();
        this._mediaRecorder.start();
        this._maxTimer = setTimeout(() => this.stop(), VoiceRecorder.MAX_DURATION_MS);
    }

    /** Stop and keep the recording (fires onStop). */
    stop() {
        clearTimeout(this._maxTimer);
        if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
            this._mediaRecorder.stop();
        }
        this._releaseStream();
    }

    /** Stop and discard the recording (onStop is not called). */
    cancel() {
        this._cancelled = true;
        this.stop();
    }

    _onRecorderStop() {
        const durationSeconds = Math.max(0, (Date.now() - this._startTime) / 1000);
        const mimeType = this._mediaRecorder ? (this._mediaRecorder.mimeType || 'audio/webm') : 'audio/webm';
        const blob = new Blob(this._chunks, { type: mimeType });
        this._chunks = [];
        this._mediaRecorder = null;
        const cancelled = this._cancelled;
        this._cancelled = false;
        if (cancelled || blob.size === 0) return;
        this.onStop && this.onStop(blob, durationSeconds);
    }

    _releaseStream() {
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
    }

    static _pickMimeType() {
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null;
        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
        return candidates.find(type => MediaRecorder.isTypeSupported(type)) || null;
    }
}

/**
 * Compose dialog *and* per-peer chat thread. Replaces the old pair of
 * SendTextDialog ("compose, fire-and-forget, dialog closes")
 * / ReceiveTextDialog ("last message received, overwrites on every new
 * one") with a single scrollable history keyed by peer id
 * (`this._threads`), fed by the `message-updated` (outgoing status
 * transitions: sending/delivered/failed - see Peer#_recordText in
 * network.js) and `text-received` (incoming) events. Network-layer state
 * (network.js `Peer#_textHistory`) is the source of truth for retries/acks;
 * this class keeps its own light mirror purely for rendering.
 */
class SendTextDialog extends Dialog {
    constructor() {
        super('sendTextDialog');
        this.$text = this.$el.querySelector('#textInput');
        this.$thread = this.$el.querySelector('#textThread');
        this._threads = new Map(); // peerId -> [{id, text?, type?, duration?, direction, status, timestamp}]
        this._recipient = null;

        // Voice recording/playback state. One VoiceRecorder is reused across
        // recordings; at most one voice message plays back at a time
        // (_playingAudio), independent of DOM rebuilds in _renderThread -
        // see _renderVoiceBubble/_bindVoiceProgress for how a re-render
        // reattaches to still-playing audio instead of restarting it.
        this._recorder = new VoiceRecorder();
        this._recorder.onStop = (blob, duration) => this._onRecordingStop(blob, duration);
        this._recorder.onError = e => this._onRecordingError(e);
        this._recordTimer = null;
        this._playingAudio = null; // {id, audio, url, _progressHandler}

        this.$voiceBar = this.$el.querySelector('#voiceRecordBar');
        this.$voiceTime = this.$el.querySelector('#voiceRecordTime');
        this.$voiceRecordBtn = this.$el.querySelector('#voiceRecordBtn');
        this.$voiceCancelBtn = this.$el.querySelector('#voiceCancelBtn');

        Events.on('text-recipient', e => this._onRecipient(e.detail));
        Events.on('message-updated', e => this._onMessageUpdated(e.detail));
        Events.on('text-received', e => this._onTextReceived(e.detail));
        Events.on('voice-message', e => this._onVoiceMessage(e.detail));

        const form = this.$el.querySelector('form');
        form.addEventListener('submit', e => this._send(e));

        if (this.$voiceRecordBtn) {
            this.$voiceRecordBtn.addEventListener('click', e => {
                e.preventDefault();
                this._recorder.isRecording ? this._stopRecording() : this._startRecording();
            });
        }
        if (this.$voiceCancelBtn) {
            this.$voiceCancelBtn.addEventListener('click', e => {
                e.preventDefault();
                this._cancelRecording();
            });
        }
    }

    _onRecipient(recipient) {
        if (this._recipient !== recipient) {
            this.$text.textContent = '';
            this._cancelRecording();
        }
        this._recipient = recipient;
        this._handleShareTargetText();
        this._renderThread();
        this.show();

        const range = document.createRange();
        const sel = window.getSelection();

        range.selectNodeContents(this.$text);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    hide() {
        this._cancelRecording();
        if (this._playingAudio) {
            this._playingAudio.audio.pause();
        }
        super.hide();
    }

    async _startRecording() {
        if (!this._recipient || this._recorder.isRecording) return;
        await this._recorder.start();
        if (!this._recorder.isRecording) return; // start() failed (denied/unsupported) - onError already handled it
        if (this.$voiceBar) this.$voiceBar.hidden = false;
        if (this.$voiceRecordBtn) {
            this.$voiceRecordBtn.classList.add('active');
            this.$voiceRecordBtn.innerHTML = '<svg class="icon"><use xlink:href="#stop-circle" /></svg>';
        }
        this._recordStart = Date.now();
        this._updateRecordTimer();
        this._recordTimer = setInterval(() => this._updateRecordTimer(), 250);
    }

    _stopRecording() {
        if (!this._recorder.isRecording) return;
        this._recorder.stop(); // fires onStop -> _onRecordingStop, which does the actual send
        this._resetRecordingUI();
    }

    _cancelRecording() {
        if (!this._recorder.isRecording) return;
        this._recorder.cancel();
        this._resetRecordingUI();
    }

    _resetRecordingUI() {
        clearInterval(this._recordTimer);
        this._recordTimer = null;
        if (this.$voiceBar) this.$voiceBar.hidden = true;
        if (this.$voiceRecordBtn) {
            this.$voiceRecordBtn.classList.remove('active');
            this.$voiceRecordBtn.innerHTML = '<svg class="icon"><use xlink:href="#mic" /></svg>';
        }
    }

    _updateRecordTimer() {
        if (!this.$voiceTime) return;
        const elapsed = (Date.now() - this._recordStart) / 1000;
        this.$voiceTime.textContent = this._formatDuration(elapsed);
    }

    _onRecordingStop(blob, duration) {
        if (!this._recipient) return;
        Events.fire('voice-selected', { to: this._recipient, blob, duration });
    }

    _onRecordingError(e) {
        console.error('VoiceRecorder:', e);
        this._resetRecordingUI();
        Events.fire('notify-user', window.I18n.t('voice_permission_denied'));
    }

    _onVoiceMessage(detail) {
        this._upsert(detail.peerId, {
            id: detail.id,
            type: 'voice',
            duration: detail.duration,
            direction: detail.direction,
            status: detail.status,
            timestamp: detail.timestamp
        });
        if (detail.direction === 'incoming' && detail.status === 'delivered') {
            window.blop.play();
            if (this._recipient !== detail.peerId) {
                this._recipient = detail.peerId;
                this.$text.textContent = '';
            }
            this.show();
        }
        if (detail.peerId === this._recipient) this._renderThread();
    }

    _handleShareTargetText() {
        if (!window.shareTargetText) return;
        this.$text.textContent = window.shareTargetText;
        window.shareTargetText = '';
    }

    _send(e) {
        e.preventDefault();
        const text = this.$text.innerText.trim();
        if (!text || !this._recipient) return;
        Events.fire('send-text', { to: this._recipient, text });
        this.$text.textContent = '';
    }

    _upsert(peerId, message) {
        if (!peerId) return;
        let thread = this._threads.get(peerId);
        if (!thread) {
            thread = [];
            this._threads.set(peerId, thread);
        }
        const existing = thread.find(m => m.id === message.id);
        if (existing) {
            Object.assign(existing, message);
        } else {
            thread.push(message);
            if (thread.length > 200) thread.shift(); // mirrors network.js's own bound, see Peer#_recordText
        }
    }

    _onMessageUpdated(detail) {
        this._upsert(detail.peerId, detail);
        if (detail.peerId === this._recipient) this._renderThread();
    }

    _onTextReceived(detail) {
        this._upsert(detail.sender, {
            id: detail.id,
            text: detail.text,
            direction: 'incoming',
            status: 'delivered',
            timestamp: Date.now()
        });
        window.blop.play();
        if (this._recipient !== detail.sender) {
            // Mirrors the old ReceiveTextDialog auto-popup: jump to this
            // peer's thread even if we were composing to someone else.
            this._recipient = detail.sender;
            this.$text.textContent = '';
        }
        this._renderThread();
        this.show();
    }

    _renderThread() {
        this.$thread.innerHTML = '';
        const thread = this._threads.get(this._recipient) || [];
        if (!thread.length) {
            const $empty = document.createElement('div');
            $empty.className = 'text-thread-empty';
            $empty.textContent = window.I18n.t('dialog_chat_empty');
            this.$thread.appendChild($empty);
            return;
        }
        thread.forEach(message => this.$thread.appendChild(this._renderMessage(message)));
        this.$thread.scrollTop = this.$thread.scrollHeight;
    }

    _renderMessage(message) {
        const $msg = document.createElement('div');
        $msg.className = 'text-msg text-msg-' + message.direction;

        if (message.type === 'voice') {
            $msg.appendChild(this._renderVoiceBubble(message));
        } else {
            const $bubble = document.createElement('div');
            $bubble.className = 'text-msg-bubble';
            $bubble.title = window.I18n.t('click_to_copy');
            if (isURL(message.text)) {
                const $a = document.createElement('a');
                $a.href = message.text;
                $a.target = '_blank';
                $a.textContent = message.text;
                $bubble.appendChild($a);
            } else {
                $bubble.textContent = message.text;
            }
            $bubble.addEventListener('click', () => this._copy(message.text));
            $msg.appendChild($bubble);
        }

        if (message.direction === 'outgoing') {
            const $status = document.createElement('div');
            $status.className = 'text-msg-status text-msg-status-' + message.status;
            $status.textContent = window.I18n.t('msg_status_' + message.status);
            if (message.status === 'failed') {
                if (message.type === 'voice') {
                    $status.textContent = window.I18n.t('voice_status_failed');
                } else {
                    $status.textContent += ' · ' + window.I18n.t('msg_retry');
                    $status.classList.add('text-msg-status-retryable');
                    $status.addEventListener('click', () => Events.fire('send-text', { to: this._recipient, text: message.text }));
                }
            }
            $msg.appendChild($status);
        }
        return $msg;
    }

    /**
     * Renders one voice-message bubble. Playback state (this._playingAudio)
     * lives outside the DOM so it survives _renderThread() rebuilding the
     * whole list on every unrelated event (new message, status change,
     * language switch) - see _toggleVoicePlayback/_bindVoiceProgress.
     */
    _renderVoiceBubble(message) {
        const $bubble = document.createElement('div');
        $bubble.className = 'voice-msg-bubble';

        if (message.status === 'receiving') {
            $bubble.classList.add('voice-msg-pending');
            $bubble.textContent = window.I18n.t('voice_receiving');
            return $bubble;
        }
        if (message.status === 'failed') {
            $bubble.classList.add('voice-msg-unavailable');
            $bubble.textContent = window.I18n.t('voice_status_failed');
            return $bubble;
        }

        const isPlaying = !!(this._playingAudio && this._playingAudio.id === message.id && !this._playingAudio.audio.paused);

        const $btn = document.createElement('button');
        $btn.type = 'button';
        $btn.className = 'voice-play-btn';
        $btn.title = window.I18n.t('voice_play');
        $btn.innerHTML = `<svg class="icon"><use xlink:href="#${isPlaying ? 'pause' : 'play-arrow'}" /></svg>`;

        const $track = document.createElement('div');
        $track.className = 'voice-msg-track';
        const $progress = document.createElement('div');
        $progress.className = 'voice-msg-progress';
        $track.appendChild($progress);

        const $duration = document.createElement('span');
        $duration.className = 'voice-msg-duration';
        $duration.textContent = this._formatDuration(message.duration);

        $btn.addEventListener('click', () => this._toggleVoicePlayback(message.id, message.duration, $btn, $progress, $duration));

        $bubble.appendChild($btn);
        $bubble.appendChild($track);
        $bubble.appendChild($duration);

        if (this._playingAudio && this._playingAudio.id === message.id) {
            this._bindVoiceProgress(this._playingAudio, $progress, $duration, message.duration);
            if (isPlaying) {
                const total = this._playingAudio.audio.duration && isFinite(this._playingAudio.audio.duration) ? this._playingAudio.audio.duration : message.duration;
                $progress.style.width = total > 0 ? Math.min(100, (this._playingAudio.audio.currentTime / total) * 100) + '%' : '0%';
            }
        }

        return $bubble;
    }

    async _toggleVoicePlayback(id, duration, $btn, $progress, $duration) {
        if (this._playingAudio && this._playingAudio.id === id) {
            const audio = this._playingAudio.audio;
            if (audio.paused) {
                audio.play();
                $btn.innerHTML = '<svg class="icon"><use xlink:href="#pause" /></svg>';
            } else {
                audio.pause();
                $btn.innerHTML = '<svg class="icon"><use xlink:href="#play-arrow" /></svg>';
            }
            return;
        }

        if (this._playingAudio) {
            this._playingAudio.audio.pause();
            this._playingAudio = null;
        }

        let record;
        try {
            record = await VoiceStore.get(id);
        } catch (e) {
            console.error('VoiceStore: read failed', e);
        }
        if (!record || !record.blob) {
            Events.fire('notify-user', window.I18n.t('voice_unavailable'));
            return;
        }

        const url = URL.createObjectURL(record.blob);
        const audio = new Audio(url);
        this._playingAudio = { id, audio, url, _progressHandler: null };

        audio.addEventListener('ended', () => {
            $btn.innerHTML = '<svg class="icon"><use xlink:href="#play-arrow" /></svg>';
            $progress.style.width = '0%';
            $duration.textContent = this._formatDuration(duration);
            URL.revokeObjectURL(url);
            if (this._playingAudio && this._playingAudio.id === id) this._playingAudio = null;
        });

        this._bindVoiceProgress(this._playingAudio, $progress, $duration, duration);
        audio.play();
        $btn.innerHTML = '<svg class="icon"><use xlink:href="#pause" /></svg>';
    }

    /**
     * (Re)binds the timeupdate listener that drives one voice bubble's
     * progress bar to `playing.audio`, replacing whatever listener was
     * previously bound (e.g. from before _renderThread rebuilt the DOM) so
     * we never stack multiple listeners on the same long-lived Audio
     * instance.
     */
    _bindVoiceProgress(playing, $progress, $duration, fallbackDuration) {
        if (playing._progressHandler) {
            playing.audio.removeEventListener('timeupdate', playing._progressHandler);
        }
        const handler = () => {
            const total = playing.audio.duration && isFinite(playing.audio.duration) ? playing.audio.duration : fallbackDuration;
            if (total > 0) $progress.style.width = Math.min(100, (playing.audio.currentTime / total) * 100) + '%';
            $duration.textContent = this._formatDuration(Math.max(0, total - playing.audio.currentTime));
        };
        playing._progressHandler = handler;
        playing.audio.addEventListener('timeupdate', handler);
    }

    _formatDuration(seconds) {
        const s = Math.max(0, Math.round(seconds || 0));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return m + ':' + String(r).padStart(2, '0');
    }

    async _copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            Events.fire('notify-user', window.I18n.t('copied_clipboard'));
        } catch (e) {
            console.error('Clipboard write failed', e);
        }
    }
}

class Toast extends Dialog {
    constructor() {
        super('toast');
        Events.on('notify-user', e => this._onNotfiy(e.detail));
    }

    _onNotfiy(message) {
        this.$el.textContent = message;
        this.show();
        setTimeout(_ => this.hide(), 3000);
    }
}


class Notifications {

    constructor() {
        // Check if the browser supports notifications
        if (!('Notification' in window)) return;

        // Check whether notification permissions have already been granted
        if (Notification.permission !== 'granted') {
            this.$button = $('notification');
            this.$button.removeAttribute('hidden');
            this.$button.addEventListener('click', e => this._requestPermission());
        }
        Events.on('text-received', e => this._messageNotification(e.detail.text));
        Events.on('file-received', e => this._downloadNotification(e.detail.name));
        Events.on('voice-message', e => {
            if (e.detail.direction === 'incoming' && e.detail.status === 'delivered') {
                this._voiceNotification();
            }
        });
    }

    _requestPermission() {
        Notification.requestPermission(permission => {
            if (permission !== 'granted') {
                Events.fire('notify-user', Notifications.PERMISSION_ERROR || 'Error');
                return;
            }
            this._notify(window.I18n.t('snappy_sharing'));
            this.$button.setAttribute('hidden', 1);
        });
    }

    _notify(message, body) {
        const config = {
            body: body,
            icon: '/images/logo_transparent_128x128.png',
        }
        let notification;
        try {
            notification = new Notification(message, config);
        } catch (e) {
            // Android doesn't support "new Notification" if service worker is installed
            if (!serviceWorker || !serviceWorker.showNotification) return;
            notification = serviceWorker.showNotification(message, config);
        }

        // Notification is persistent on Android. We have to close it manually
        const visibilitychangeHandler = () => {                             
            if (document.visibilityState === 'visible') {    
                notification.close();
                Events.off('visibilitychange', visibilitychangeHandler);
            }                                                       
        };                                                                                
        Events.on('visibilitychange', visibilitychangeHandler);

        return notification;
    }

    _messageNotification(message) {
        if (document.visibilityState !== 'visible') {
            if (isURL(message)) {
                const notification = this._notify(message, window.I18n.t('click_to_open'));
                this._bind(notification, e => window.open(message, '_blank', null, true));
            } else {
                const notification = this._notify(message, window.I18n.t('click_to_copy'));
                this._bind(notification, e => this._copyText(message, notification));
            }
        }
    }

    _downloadNotification(message) {
        if (document.visibilityState !== 'visible') {
            const notification = this._notify(message, window.I18n.t('click_to_download'));
            if (!window.isDownloadSupported) return;
            this._bind(notification, e => this._download(notification));
        }
    }

    _voiceNotification() {
        if (document.visibilityState !== 'visible') {
            this._notify(window.I18n.t('voice_notification_title'));
        }
    }

    _download(notification) {
        document.querySelector('x-dialog [download]').click();
        notification.close();
    }

    _copyText(message, notification) {
        notification.close();
        if (!navigator.clipboard.writeText(message)) return;
        this._notify(window.I18n.t('copied_text'));
    }

    _bind(notification, handler) {
        if (notification.then) {
            notification.then(e => serviceWorker.getNotifications().then(notifications => {
                serviceWorker.addEventListener('notificationclick', handler);
            }));
        } else {
            notification.onclick = handler;
        }
    }
}


class NetworkStatusUI {

    constructor() {
        window.addEventListener('offline', e => this._showOfflineMessage(), false);
        window.addEventListener('online', e => this._showOnlineMessage(), false);
        if (!navigator.onLine) this._showOfflineMessage();
    }

    _showOfflineMessage() {
        Events.fire('notify-user', window.I18n.t('offline'));
    }

    _showOnlineMessage() {
        Events.fire('notify-user', window.I18n.t('online'));
    }
}

class WebShareTargetUI {
    constructor() {
        const parsedUrl = new URL(window.location);
        const title = parsedUrl.searchParams.get('title');
        const text = parsedUrl.searchParams.get('text');
        const url = parsedUrl.searchParams.get('url');

        let shareTargetText = title ? title : '';
        shareTargetText += text ? shareTargetText ? ' ' + text : text : '';

        if(url) shareTargetText = url; // We share only the Link - no text. Because link-only text becomes clickable.

        if (!shareTargetText) return;
        window.shareTargetText = shareTargetText;
        history.pushState({}, 'URL Rewrite', '/');
        console.log('Shared Target Text:', '"' + shareTargetText + '"');
    }
}

class RoomStatusUI {
    constructor() {
        this.$roomStatus = $('roomStatus');
        this.$btnCopyRoom = $('btnCopyRoom');
        this.$btnCreateRoom = $('btnCreateRoom');
        this.$btnLeaveRoom = $('btnLeaveRoom');

        if (this.$btnCopyRoom) this.$btnCopyRoom.addEventListener('click', () => this._onCopyRoom());
        if (this.$btnCreateRoom) this.$btnCreateRoom.addEventListener('click', () => this._onCreateRoom());
        if (this.$btnLeaveRoom) this.$btnLeaveRoom.addEventListener('click', () => this._onLeaveRoom());

        Events.on('room-changed', () => this._updateRoomUI());
        Events.on('language-changed', () => this._updateRoomUI());
        // Handle direct load with hash
        this._updateRoomUI();
    }

    _updateRoomUI() {
        if (!this.$roomStatus) return;
        const hash = window.location.hash;
        if (hash && hash.length > 1) {
            const roomName = decodeURIComponent(hash.substring(1));
            this.$roomStatus.textContent = window.I18n.t('room_status_private', { roomName: roomName });
            if (this.$btnCopyRoom) this.$btnCopyRoom.style.display = 'inline-block';
            if (this.$btnLeaveRoom) this.$btnLeaveRoom.style.display = 'inline-block';
            if (this.$btnCreateRoom) this.$btnCreateRoom.style.display = 'none';
        } else {
            this.$roomStatus.textContent = window.I18n.t('room_status_public');
            if (this.$btnCopyRoom) this.$btnCopyRoom.style.display = 'none';
            if (this.$btnLeaveRoom) this.$btnLeaveRoom.style.display = 'none';
            if (this.$btnCreateRoom) this.$btnCreateRoom.style.display = 'inline-block';
        }
    }

    _onCopyRoom() {
        navigator.clipboard.writeText(window.location.href)
            .then(() => Events.fire('notify-user', window.I18n.t('room_copied')))
            .catch(() => Events.fire('notify-user', window.I18n.t('room_copy_failed')));
    }

    _onCreateRoom() {
        const randomRoom = Math.random().toString(36).substring(2, 8);
        window.location.hash = randomRoom;
    }

    _onLeaveRoom() {
        window.location.hash = '';
    }
}

class ThemeManager {
    constructor() {
        this.$btn = $('theme-toggle');
        if (!this.$btn) return;
        this.$btn.addEventListener('click', e => {
            e.preventDefault();
            this.toggle();
        });
        this._loadTheme();
    }
    _loadTheme() {
        const saved = localStorage.getItem('theme');
        if (saved) {
            document.body.className = 'theme-' + saved;
        } else {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.body.className = prefersDark ? 'theme-dark' : 'theme-light';
        }
    }
    toggle() {
        const current = document.body.classList.contains('theme-dark') || document.body.className === 'theme-dark';
        const next = current ? 'light' : 'dark';
        document.body.className = 'theme-' + next;
        localStorage.setItem('theme', next);
    }
}

class EditNicknameDialog extends Dialog {
    constructor() {
        super('editNicknameDialog');
        this.$input = this.$el.querySelector('#nicknameInput');
        const form = this.$el.querySelector('form');
        form.addEventListener('submit', e => this._save(e));
        
        const $displayName = $('displayName');
        if ($displayName) {
            $displayName.addEventListener('click', () => {
                const savedNick = localStorage.getItem('custom-nickname');
                const prefix = window.I18n.t('known_as', { name: '' });
                const fallbackName = $displayName.textContent.replace(prefix, '').trim();
                this.$input.value = window.myDisplayName || savedNick || fallbackName;
                this.show();
            });
        }
    }
    _save(e) {
        e.preventDefault();
        const val = this.$input.value.trim();
        if (!val) return;
        localStorage.setItem('custom-nickname', val);
        window.myDisplayName = val;
        Events.fire('change-nickname-request', val);
        $('displayName').textContent = window.I18n.t('known_as', { name: val });
        this.hide();
    }
}

class TransferCenterUI {
    constructor() {
        this.$drawer = $('transferCenter');
        this.$btnToggle = $('transfers-toggle');
        this.$btnClose = $('btn-close-drawer');
        this.$btnClear = $('btn-clear-transfers');
        this.$badge = $('transfers-badge');
        this.$list = $('transfer-list');

        this.transfers = {}; // transferId -> { el, size, status, startTime }

        if (this.$btnToggle) this.$btnToggle.addEventListener('click', e => { e.preventDefault(); this.toggle(); });
        if (this.$btnClose) this.$btnClose.addEventListener('click', e => { e.preventDefault(); this.hide(); });
        if (this.$btnClear) this.$btnClear.addEventListener('click', e => { e.preventDefault(); this.clearCompleted(); });

        Events.on('transfer-queued', e => this._onQueued(e.detail));
        Events.on('transfer-started', e => this._onStarted(e.detail));
        Events.on('transfer-active', e => this._onActive(e.detail));
        Events.on('file-progress', e => this._onProgress(e.detail));
        Events.on('transfer-completed', e => this._onCompleted(e.detail));
        Events.on('transfer-cancelled', e => this._onCancelled(e.detail));
        Events.on('language-changed', () => this._onLanguageChanged());
    }

    _onLanguageChanged() {
        for (const tid in this.transfers) {
            const t = this.transfers[tid];
            const detail = t.detail;
            if (!detail) continue;
            
            const peerName = this._getPeerName(detail.peerId);
            const directionLabel = detail.direction === 'incoming' ? window.I18n.t('direction_from', { peerName: peerName }) : window.I18n.t('direction_to', { peerName: peerName });
            
            const metaSpan = t.el.querySelector('.transfer-meta span:first-child');
            if (metaSpan) metaSpan.textContent = directionLabel;

            const badge = t.el.querySelector('.status-badge');
            if (badge) {
                if (t.status === 'queued') {
                    badge.textContent = window.I18n.t('status_queued');
                } else if (t.status === 'transferring') {
                    if (!badge.textContent.includes('MB/s') && !badge.textContent.includes('KB/s') && !badge.textContent.includes('B/s')) {
                        badge.textContent = window.I18n.t('status_transferring');
                    }
                } else if (t.status === 'completed') {
                    badge.textContent = window.I18n.t('status_done');
                } else if (t.status === 'cancelled') {
                    badge.textContent = t.wasRemoteCancelled ? window.I18n.t('status_cancelled_peer') : window.I18n.t('status_cancelled');
                }
            }

            const cancelBtn = t.el.querySelector('.cancel-btn');
            if (cancelBtn) {
                cancelBtn.textContent = window.I18n.t('dialog_send_text_cancel');
            }
        }
        this._checkEmptyState();
    }

    toggle() {
        this.$drawer.classList.toggle('show');
    }

    show() {
        this.$drawer.classList.add('show');
    }

    hide() {
        this.$drawer.classList.remove('show');
    }

    _updateBadge() {
        let activeCount = 0;
        for (const tid in this.transfers) {
            const t = this.transfers[tid];
            if (t.status === 'transferring' || t.status === 'queued') {
                activeCount++;
            }
        }
        if (activeCount > 0) {
            this.$badge.textContent = activeCount;
            this.$badge.hidden = false;
        } else {
            this.$badge.hidden = true;
        }
    }

    _getPeerName(peerId) {
        const $peer = $(peerId);
        return $peer && $peer.ui ? $peer.ui._displayName() : window.I18n.t('unknown_device');
    }

    _onQueued(detail) {
        this._removeEmptyState();
        const peerName = this._getPeerName(detail.peerId);
        
        const card = document.createElement('div');
        card.className = 'transfer-item';
        card.id = 't-card-' + detail.id;
        card.innerHTML = `
            <div class="file-info" title="${detail.name}">${detail.name}</div>
            <div class="transfer-meta">
                <span>${window.I18n.t('direction_to', { peerName: peerName })}</span>
                <span class="status-badge queued">${window.I18n.t('status_queued')}</span>
            </div>
            <div class="progress-container">
                <progress value="0" max="1"></progress>
                <button class="cancel-btn">${window.I18n.t('dialog_send_text_cancel')}</button>
            </div>
        `;
        
        card.querySelector('.cancel-btn').addEventListener('click', e => {
            Events.fire('cancel-transfer-request', { transferId: detail.id, peerId: detail.peerId });
        });

        this.$list.appendChild(card);
        this.transfers[detail.id] = {
            el: card,
            size: detail.size,
            status: 'queued',
            detail: detail
        };
        this._updateBadge();
    }

    _onStarted(detail) {
        this._removeEmptyState();
        const existing = this.transfers[detail.id];
        const peerName = this._getPeerName(detail.peerId);
        const directionLabel = detail.direction === 'incoming' ? window.I18n.t('direction_from', { peerName: peerName }) : window.I18n.t('direction_to', { peerName: peerName });

        if (existing) {
            existing.status = 'transferring';
            existing.startTime = Date.now();
            existing.el.querySelector('.status-badge').className = 'status-badge transferring';
            existing.el.querySelector('.status-badge').textContent = window.I18n.t('status_transferring');
        } else {
            const card = document.createElement('div');
            card.className = 'transfer-item';
            card.id = 't-card-' + detail.id;
            card.innerHTML = `
                <div class="file-info" title="${detail.name}">${detail.name}</div>
                <div class="transfer-meta">
                    <span>${directionLabel}</span>
                    <span class="status-badge transferring">${window.I18n.t('status_transferring')}</span>
                </div>
                <div class="progress-container">
                    <progress value="0" max="1"></progress>
                    <button class="cancel-btn">${window.I18n.t('dialog_send_text_cancel')}</button>
                </div>
            `;
            card.querySelector('.cancel-btn').addEventListener('click', e => {
                Events.fire('cancel-transfer-request', { transferId: detail.id, peerId: detail.peerId });
            });
            this.$list.appendChild(card);
            this.transfers[detail.id] = {
                el: card,
                size: detail.size,
                status: 'transferring',
                startTime: Date.now(),
                detail: detail
            };
        }
        this._updateBadge();
    }

    _onActive(detail) {
        const existing = this.transfers[detail.id];
        if (existing) {
            existing.status = 'transferring';
            existing.startTime = Date.now();
            const badge = existing.el.querySelector('.status-badge');
            badge.className = 'status-badge transferring';
            badge.textContent = window.I18n.t('status_transferring');
        }
        this._updateBadge();
    }

    _onProgress(detail) {
        const transfer = this.transfers[detail.transferId];
        if (!transfer) return;
        
        const progress = detail.progress;
        const progressEl = transfer.el.querySelector('progress');
        if (progressEl) progressEl.value = progress;

        if (transfer.startTime) {
            const duration = (Date.now() - transfer.startTime) / 1000;
            if (duration > 0.5) {
                const bytesSent = progress * transfer.size;
                const speedBytes = bytesSent / duration;
                const speedText = this._formatSpeed(speedBytes);
                const badge = transfer.el.querySelector('.status-badge');
                if (badge) badge.textContent = speedText;
            }
        }
    }

    _onCompleted(detail) {
        const transfer = this.transfers[detail.id];
        if (!transfer) return;
        transfer.status = 'completed';
        const progressEl = transfer.el.querySelector('progress');
        if (progressEl) progressEl.value = 1;
        const badge = transfer.el.querySelector('.status-badge');
        if (badge) {
            badge.className = 'status-badge completed';
            badge.textContent = window.I18n.t('status_done');
        }
        const cancelBtn = transfer.el.querySelector('.cancel-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        this._updateBadge();
    }

    _onCancelled(detail) {
        const transfer = this.transfers[detail.id];
        if (!transfer) return;
        transfer.status = 'cancelled';
        transfer.wasRemoteCancelled = (detail.status === 'remote-cancelled');
        const badge = transfer.el.querySelector('.status-badge');
        if (badge) {
            badge.className = 'status-badge cancelled';
            badge.textContent = transfer.wasRemoteCancelled ? window.I18n.t('status_cancelled_peer') : window.I18n.t('status_cancelled');
        }
        const cancelBtn = transfer.el.querySelector('.cancel-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        this._updateBadge();
    }

    clearCompleted() {
        for (const tid in this.transfers) {
            const t = this.transfers[tid];
            if (t.status === 'completed' || t.status === 'cancelled') {
                t.el.remove();
                delete this.transfers[tid];
            }
        }
        this._checkEmptyState();
    }

    _removeEmptyState() {
        const empty = this.$list.querySelector('.empty-state');
        if (empty) empty.remove();
    }

    _checkEmptyState() {
        if (this.$list.children.length === 0) {
            this.$list.innerHTML = `<div class="empty-state">${window.I18n.t('drawer_transfers_empty')}</div>`;
        }
    }

    _formatSpeed(bytesPerSec) {
        if (bytesPerSec >= 1e6) {
            return (Math.round(bytesPerSec / 1e5) / 10) + ' MB/s';
        } else if (bytesPerSec >= 1000) {
            return Math.round(bytesPerSec / 1000) + ' KB/s';
        } else {
            return Math.round(bytesPerSec) + ' B/s';
        }
    }
}

class UniversalDragAndDrop {
    constructor() {
        this.$overlay = $('drag-overlay');
        this.dragEnterCount = 0;

        window.addEventListener('dragenter', e => this._onDragEnter(e));
        window.addEventListener('dragover', e => this._onDragOver(e));
        window.addEventListener('dragleave', e => this._onDragLeave(e));
        window.addEventListener('drop', e => this._onDrop(e));
    }

    _onDragEnter(e) {
        e.preventDefault();
        const peers = document.querySelectorAll('x-peer');
        if (peers.length === 0) return;

        this.dragEnterCount++;
        if (this.dragEnterCount === 1) {
            document.body.classList.add('drag-active');
            this.$overlay.style.display = 'flex';
            
            const sub = this.$overlay.querySelector('.drag-overlay-sub');
            if (peers.length === 1) {
                const peerName = peers[0].ui ? peers[0].ui._displayName() : 'device';
                sub.textContent = window.I18n.t('drag_overlay_sub_one', { peerName: peerName });
                this.$overlay.style.pointerEvents = 'auto';
            } else {
                sub.textContent = window.I18n.t('drag_overlay_sub_many');
                this.$overlay.style.pointerEvents = 'none';
            }
        }
    }

    _onDragOver(e) {
        e.preventDefault();
    }

    _onDragLeave(e) {
        e.preventDefault();
        const peers = document.querySelectorAll('x-peer');
        if (peers.length === 0) return;

        this.dragEnterCount--;
        if (this.dragEnterCount <= 0) {
            this.dragEnterCount = 0;
            this._hide();
        }
    }

    _onDrop(e) {
        e.preventDefault();
        this.dragEnterCount = 0;
        this._hide();

        const peers = document.querySelectorAll('x-peer');
        if (peers.length === 1 && e.dataTransfer && e.dataTransfer.files.length > 0) {
            Events.fire('files-selected', {
                files: e.dataTransfer.files,
                to: peers[0].id
            });
        }
    }

    _hide() {
        document.body.classList.remove('drag-active');
        this.$overlay.style.display = 'none';
    }
}

class LinkApp {
    constructor() {
        const server = new ServerConnection();
        const peers = new PeersManager(server);
        const peersUI = new PeersUI();
        Events.on('load', e => {
            const receiveDialog = new ReceiveDialog();
            const sendTextDialog = new SendTextDialog();
            const toast = new Toast();
            const notifications = new Notifications();
            const networkStatusUI = new NetworkStatusUI();
            const webShareTargetUI = new WebShareTargetUI();
            const roomStatusUI = new RoomStatusUI();
            
            const themeManager = new ThemeManager();
            const editNicknameDialog = new EditNicknameDialog();
            const transferCenterUI = new TransferCenterUI();
            const universalDragAndDrop = new UniversalDragAndDrop();
            const clipboardSync = new ClipboardSync();

            // Best-effort housekeeping for locally-stored voice message
            // audio (see voice-store.js) - keeps a long-lived browser
            // profile from accumulating IndexedDB usage forever.
            if (window.VoiceStore) window.VoiceStore.pruneOlderThan();

            // Initialize page translation
            window.I18n.translatePage();

            // Bind language selector element events
            const select = $('language-select');
            if (select) {
                select.value = window.I18n.currentLanguage;
                select.addEventListener('change', event => {
                    window.I18n.setLanguage(event.target.value);
                });
            }
        });
    }
}

const linkApp = new LinkApp();



if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(serviceWorker => {
            console.log('Service Worker registered');
            window.serviceWorker = serviceWorker
        });
}

window.addEventListener('beforeinstallprompt', e => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
        // don't display install banner when installed
        return e.preventDefault();
    } else {
        const btn = document.querySelector('#install')
        btn.hidden = false;
        btn.onclick = _ => e.prompt();
        return e.preventDefault();
    }
});

// Background Animation (Canvas ripple removed)
window.animateBackground = function(l) {
    // Disabled canvas background waves
};

Notifications.PERMISSION_ERROR = `
Notifications permission has been blocked
as the user has dismissed the permission prompt several times.
This can be reset in Page Info
which can be accessed by clicking the lock icon next to the URL.`;

document.body.onclick = e => { // safari hack to fix audio
    document.body.onclick = null;
    if (!(/.*Version.*Safari.*/.test(navigator.userAgent))) return;
    blop.play();
}
