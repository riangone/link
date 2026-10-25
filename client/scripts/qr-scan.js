/**
 * Camera-based QR decoder used by the Friends drawer (friends-ui.js) to add
 * a friend by scanning their device-code QR instead of pasting it.
 *
 * Deliberately has zero knowledge of dialogs/friends/i18n — it only knows
 * how to turn a <video>+<canvas> pair into a stream of decoded strings, the
 * same separation friends.js (logic) / friends-ui.js (DOM) already uses.
 *
 * Decoding strategy:
 *   1. Native `BarcodeDetector` (Chrome/Edge desktop + Android) — zero extra
 *      bytes downloaded, detects directly off the <video> frame.
 *   2. Fallback: lazily fetch scripts/vendor/jsQR.js (only when the native
 *      API is unavailable, e.g. Safari/Firefox) and decode video frames
 *      drawn to an offscreen <canvas> one at a time.
 * Both paths converge on the same `onDecode(text)` callback so callers
 * don't need to care which one ran.
 */
class QrScanner {
    constructor(videoEl, canvasEl) {
        this.video = videoEl;
        this.canvas = canvasEl;
        this._stream = null;
        this._rafId = null;
        this._detector = null;
        this._jsQrLoading = null;
    }

    /**
     * @returns {Promise<boolean>} true once the camera is live and scanning
     *   started; false if camera access failed (onError already fired).
     */
    async start(onDecode, onError) {
        this.stop();

        try {
            this._stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
        } catch (e) {
            if (onError) onError(e);
            return false;
        }

        this.video.srcObject = this._stream;
        try { await this.video.play(); } catch (e) { /* autoplay quirks, ignore */ }

        if (window.BarcodeDetector) {
            try {
                this._detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            } catch (e) {
                this._detector = null;
            }
        }

        if (this._detector) {
            this._loopNative(onDecode);
        } else {
            try {
                await this._ensureJsQr();
            } catch (e) {
                if (onError) onError(e);
                this.stop();
                return false;
            }
            this._loopFallback(onDecode);
        }
        return true;
    }

    stop() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = null;
        if (this._stream) {
            this._stream.getTracks().forEach(track => track.stop());
            this._stream = null;
        }
        if (this.video) this.video.srcObject = null;
        this._detector = null;
    }

    // --- native BarcodeDetector path ------------------------------------

    _loopNative(onDecode) {
        const tick = async () => {
            if (!this._stream) return; // stopped mid-flight
            try {
                const codes = await this._detector.detect(this.video);
                if (codes && codes.length) {
                    onDecode(codes[0].rawValue);
                    return; // caller decides whether to keep scanning
                }
            } catch (e) {
                // transient (e.g. video not ready yet) — keep polling
            }
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    // --- jsQR fallback path ----------------------------------------------

    _ensureJsQr() {
        if (window.jsQR) return Promise.resolve();
        if (this._jsQrLoading) return this._jsQrLoading;
        this._jsQrLoading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'scripts/vendor/jsQR.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load jsQR'));
            document.head.appendChild(script);
        });
        return this._jsQrLoading;
    }

    _loopFallback(onDecode) {
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        const tick = () => {
            if (!this._stream) return;
            const w = this.video.videoWidth;
            const h = this.video.videoHeight;
            if (w && h && window.jsQR) {
                this.canvas.width = w;
                this.canvas.height = h;
                ctx.drawImage(this.video, 0, 0, w, h);
                const frame = ctx.getImageData(0, 0, w, h);
                const result = window.jsQR(frame.data, w, h, { inversionAttempts: 'dontInvert' });
                if (result && result.data) {
                    onDecode(result.data);
                    return;
                }
            }
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }
}

window.QrScanner = QrScanner;
