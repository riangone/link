/**
 * Link Spin 3D - Procedural Web Audio Sound Synthesizer
 * Zero-Asset Mechanical Sound Design: Top Hum, Metallic Clashes,
 * X-DASH Jet Acceleration, and Explosive Burst Shatter.
 */

export class SoundSynth {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.humNode = null;
        this.humGain = null;
    }

    ensureContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
                this.setupHumLoop();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setupHumLoop() {
        if (!this.ctx) return;
        try {
            // Dual oscillator drone for spinning tops
            this.humOsc = this.ctx.createOscillator();
            this.humOsc.type = 'triangle';
            this.humOsc.frequency.setValueAtTime(80, this.ctx.currentTime);

            this.humGain = this.ctx.createGain();
            this.humGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

            this.humOsc.connect(this.humGain);
            this.humGain.connect(this.ctx.destination);
            this.humOsc.start();
        } catch (_) {}
    }

    updateHum(s1, s2 = 0, isMatchActive = true) {
        if (!this.ctx || !this.humGain || !this.enabled || !isMatchActive) {
            if (this.humGain) this.humGain.gain.setValueAtTime(0, this.ctx ? this.ctx.currentTime : 0);
            return;
        }

        const maxSpin = Math.max(typeof s1 === 'number' ? s1 : 0, typeof s2 === 'number' ? s2 : 0);
        if (maxSpin <= 2) {
            this.humGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        } else {
            const freq = 65 + (maxSpin / 100) * 260; // 65Hz to 325Hz
            this.humOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
            const targetVol = 0.04 + (maxSpin / 100) * 0.08;
            this.humGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.05);
        }
    }

    playClash(intensity = 1.0, isCritical = false) {
        if (!this.enabled) return;
        this.ensureContext();
        if (!this.ctx) return;

        // Support boolean as first arg or number
        let isCrit = isCritical;
        let inten = 1.0;
        if (typeof intensity === 'boolean') {
            isCrit = intensity;
            inten = isCrit ? 2.0 : 1.0;
        } else {
            inten = intensity;
        }

        const now = this.ctx.currentTime;
        const baseFreq = isCrit ? 620 : (420 + Math.random() * 200);

        // Metallic ping oscillator
        const osc = this.ctx.createOscillator();
        osc.type = isCrit ? 'sawtooth' : 'sine';
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.4, now + 0.18);

        // Bandpass filter for metallic resonance
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(baseFreq * 1.5, now);
        filter.Q.setValueAtTime(6.0, now);

        const gain = this.ctx.createGain();
        const vol = Math.min(0.4, 0.15 + inten * 0.04);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.24);

        if (isCrit) {
            this.playImpactPunch();
        }
    }

    playImpactPunch() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
    }

    playXDash() {
        if (!this.enabled) return;
        this.ensureContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.35);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, now);
        filter.frequency.exponentialRampToValueAtTime(2800, now + 0.35);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.02, now);
        gain.gain.linearRampToValueAtTime(0.28, now + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.48);
    }

    playRailDash() {
        this.playXDash();
    }

    playBurst() {
        if (!this.enabled) return;
        this.ensureContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        // 1. Deep explosion thump
        const boom = this.ctx.createOscillator();
        boom.type = 'triangle';
        boom.frequency.setValueAtTime(120, now);
        boom.frequency.exponentialRampToValueAtTime(20, now + 0.45);

        const boomGain = this.ctx.createGain();
        boomGain.gain.setValueAtTime(0.5, now);
        boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        boom.connect(boomGain);
        boomGain.connect(this.ctx.destination);
        boom.start(now);
        boom.stop(now + 0.52);

        // 2. High-frequency metallic shatter ringing
        [1100, 1540, 2200].forEach((freq, idx) => {
            const shatter = this.ctx.createOscillator();
            shatter.type = 'sawtooth';
            shatter.frequency.setValueAtTime(freq, now + idx * 0.03);
            shatter.frequency.exponentialRampToValueAtTime(freq * 0.3, now + 0.4);

            const sGain = this.ctx.createGain();
            sGain.gain.setValueAtTime(0.18, now + idx * 0.03);
            sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

            shatter.connect(sGain);
            sGain.connect(this.ctx.destination);
            shatter.start(now + idx * 0.03);
            shatter.stop(now + 0.48);
        });
    }

    playSpecialBurst() {
        this.playBurst();
    }

    playScrape() {
        this.playClash(0.3, false);
    }

    playCountdownBeep(isGo = false) {
        if (!this.enabled) return;
        this.ensureContext();
        if (!this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(isGo ? 880 : 440, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.35 : 0.15));

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + (isGo ? 0.38 : 0.18));
    }

    playLaunchBeep(isGo = false) {
        this.playCountdownBeep(isGo);
    }

    playWin() {
        if (!this.enabled) return;
        this.ensureContext();
        if (!this.ctx) return;

        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const startTime = this.ctx.currentTime + idx * 0.12;
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.25, startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.38);
        });
    }

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled && this.humGain) {
            this.humGain.gain.setValueAtTime(0, this.ctx ? this.ctx.currentTime : 0);
        }
        return this.enabled;
    }
}
