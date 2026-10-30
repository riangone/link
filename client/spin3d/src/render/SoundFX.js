/**
 * Link Spin 3D - Procedural Web Audio Sound Synthesizer
 * Zero-asset audio engine: mechanical gyro hums, metal clashes,
 * X-DASH power surges, and explosive burst finishes.
 */

export class SoundFX {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.muted = localStorage.getItem('spin-muted') === '1';

        // Continuous gyro hums for P1 and P2
        this.hums = [];
        this.initialized = false;

        this.setupUserUnlock();
    }

    setupUserUnlock() {
        const unlock = () => {
            this.init();
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('pointerdown', unlock);
        };
        window.addEventListener('keydown', unlock, { once: true });
        window.addEventListener('pointerdown', unlock, { once: true });
    }

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        try {
            this.ctx = new AudioContext();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 0.6;
            this.master.connect(this.ctx.destination);

            // Gyroscopic Hum Oscillators for Tops
            this.hums = [0, 1].map((i) => {
                const osc = this.ctx.createOscillator();
                const filter = this.ctx.createBiquadFilter();
                const gain = this.ctx.createGain();

                osc.type = 'sawtooth';
                osc.frequency.value = 110 + i * 8;

                filter.type = 'lowpass';
                filter.frequency.value = 550;

                gain.gain.value = 0;

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.master);
                osc.start();

                return { osc, filter, gain };
            });

            this.initialized = true;
        } catch (e) {
            console.warn('Web Audio not supported', e);
        }
    }

    setMuted(muted) {
        this.muted = muted;
        localStorage.setItem('spin-muted', muted ? '1' : '0');
        if (this.master && this.ctx) {
            this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
        }
        return this.muted;
    }

    toggleMute() {
        return this.setMuted(!this.muted);
    }

    updateHums(t1, t2) {
        if (!this.initialized || !this.ctx || this.muted) return;
        const tops = [t1, t2];
        const now = this.ctx.currentTime;

        tops.forEach((top, idx) => {
            const h = this.hums[idx];
            if (!h) return;

            if (top && top.status === 'spinning' && top.spin > 2) {
                const rpmRatio = Math.min(1.2, top.spin / 100);
                const targetFreq = 90 + rpmRatio * 260 + (top.xdashTimer > 0 ? 120 : 0);
                const targetGain = Math.min(0.25, 0.04 + rpmRatio * 0.18);

                h.osc.frequency.setTargetAtTime(targetFreq, now, 0.08);
                h.filter.frequency.setTargetAtTime(450 + rpmRatio * 750, now, 0.08);
                h.gain.gain.setTargetAtTime(targetGain, now, 0.06);
            } else {
                h.gain.gain.setTargetAtTime(0, now, 0.1);
            }
        });
    }

    playClash(intensity = 1.0, isCritical = false) {
        if (!this.initialized || !this.ctx || this.muted) return;
        const now = this.ctx.currentTime;

        // Metallic Impact Clang (Biquad filtered pulse)
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = isCritical ? 'square' : 'triangle';
        osc.frequency.setValueAtTime(isCritical ? 380 : 540, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.18);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1400, now);
        filter.Q.value = 4.0;

        const vol = Math.min(0.85, 0.25 + intensity * 0.12);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (isCritical ? 0.32 : 0.18));

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);

        osc.start(now);
        osc.stop(now + 0.35);

        // White noise impact burst
        this.playNoiseSnap(0.08, vol * 0.7);
    }

    playXDash() {
        if (!this.initialized || !this.ctx || this.muted) return;
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(980, now + 0.22);

        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(this.master);

        osc.start(now);
        osc.stop(now + 0.38);
    }

    playBurst() {
        if (!this.initialized || !this.ctx || this.muted) return;
        const now = this.ctx.currentTime;

        // Low frequency explosion boom
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.45);

        gain.gain.setValueAtTime(0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

        osc.connect(gain);
        gain.connect(this.master);

        osc.start(now);
        osc.stop(now + 0.6);

        // Heavy crash noise
        this.playNoiseSnap(0.35, 0.75);
    }

    playCountdown(isGo = false) {
        if (!this.initialized || !this.ctx || this.muted) return;
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(isGo ? 880 : 440, now);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.45 : 0.15));

        osc.connect(gain);
        gain.connect(this.master);

        osc.start(now);
        osc.stop(now + 0.5);
    }

    playPerfectLaunch() {
        if (!this.initialized || !this.ctx || this.muted) return;
        const now = this.ctx.currentTime;

        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;

            const t = now + i * 0.05;
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

            osc.connect(gain);
            gain.connect(this.master);
            osc.start(t);
            osc.stop(t + 0.32);
        });
    }

    playNoiseSnap(duration = 0.1, volume = 0.3) {
        if (!this.ctx) return;
        const bufferSize = Math.floor(this.ctx.sampleRate * duration);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-3 * (i / bufferSize));
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const gain = this.ctx.createGain();
        gain.gain.value = volume;

        noise.connect(gain);
        gain.connect(this.master);

        noise.start();
    }
}
