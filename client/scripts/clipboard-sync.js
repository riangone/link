/**
 * ClipboardSync
 *
 * Mirrors the OS clipboard across paired devices over the existing WebRTC
 * (or WS-relay fallback) data channel. Opt-in via the header toggle button
 * (#clipboard-sync-toggle); state persists in localStorage.
 *
 * Design notes:
 * - Uses the async Clipboard API (navigator.clipboard.readText/writeText).
 *   Both require a secure context (https/localhost) and, in most browsers,
 *   the page to be focused — this is why we poll on `focus`/`copy` rather
 *   than on a blind interval, which would just fail silently in the
 *   background and burn CPU.
 * - `_lastSyncedText` is the loop-prevention guard: every device that is
 *   part of a sync only ever re-broadcasts a value if it differs from the
 *   last value it either sent or received. Without this, A -> B -> A -> B...
 *   would echo forever across a 3+ device room.
 * - Writing the incoming clipboard is best-effort: if the browser refuses
 *   (no permission / tab not focused), we fall back to a toast rather than
 *   a modal dialog, since clipboard-sync is meant to be silent/ambient.
 */
class ClipboardSync {
    constructor() {
        this.$btn = $('clipboard-sync-toggle');
        if (!this.$btn) return;

        this._supported = window.isSecureContext
            && !!(navigator.clipboard && navigator.clipboard.readText && navigator.clipboard.writeText);

        if (!this._supported) {
            this.$btn.hidden = true;
            return;
        }

        this._enabled = localStorage.getItem('clipboard-sync-enabled') === 'true';
        this._lastSyncedText = localStorage.getItem('clipboard-sync-last') || '';

        this.$btn.addEventListener('click', e => {
            e.preventDefault();
            this._toggle();
        });

        Events.on('clipboard-sync-received', e => this._onReceived(e.detail));
        Events.on('language-changed', () => this._updateButton());
        window.addEventListener('focus', () => this._checkClipboard());
        document.addEventListener('copy', () => setTimeout(() => this._checkClipboard(), 50));

        this._updateButton();
        if (this._enabled) this._checkClipboard();
    }

    _toggle() {
        this._enabled = !this._enabled;
        localStorage.setItem('clipboard-sync-enabled', this._enabled ? 'true' : 'false');
        this._updateButton();
        Events.fire('notify-user', window.I18n.t(
            this._enabled ? 'clipboard_sync_enabled' : 'clipboard_sync_disabled'
        ));
        if (this._enabled) this._checkClipboard();
    }

    _updateButton() {
        this.$btn.classList.toggle('active', this._enabled);
        const key = this._enabled ? 'header_clipboard_sync_on_title' : 'header_clipboard_sync_title';
        this.$btn.title = window.I18n.t(key);
        this.$btn.setAttribute('data-translate-title', key);
    }

    async _checkClipboard() {
        if (!this._enabled || !document.hasFocus()) return;
        let text;
        try {
            text = await navigator.clipboard.readText();
        } catch (err) {
            return; // permission not granted (yet) / denied - stay silent
        }
        if (!text || text === this._lastSyncedText) return;
        this._remember(text);
        Events.fire('clipboard-sync-broadcast', { text });
    }

    async _onReceived(detail) {
        if (!this._enabled) return;
        const text = detail.text;
        if (!text || text === this._lastSyncedText) return;
        this._remember(text);
        try {
            await navigator.clipboard.writeText(text);
            Events.fire('notify-user', window.I18n.t('clipboard_sync_received'));
        } catch (err) {
            Events.fire('notify-user', window.I18n.t('clipboard_sync_received_manual'));
        }
    }

    _remember(text) {
        this._lastSyncedText = text;
        localStorage.setItem('clipboard-sync-last', text);
    }
}
