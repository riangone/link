/**
 * InputBuffer & Command Pattern Recognizer
 * Maintains a rolling ring-buffer of input snapshots (60 frames)
 * Recognizes combos, omnidirectional double-tap dashes/flips, and directional command inputs.
 */

export class InputBuffer {
    constructor(bufferSize = 60) {
        this.bufferSize = bufferSize;
        this.buffer = new Array(bufferSize).fill(null).map(() => this.createEmptyEntry());
        this.head = 0;
        this.currentFrame = 0;
        this.prevRaw = {
            punch: false,
            kick: false,
            block: false,
            jump: false,
            crouch: false,
            slide: false,
            throwBtn: false,
            fire: false,
            daodan: false,
            heal: false,
            evade: false,
            special: false
        };
    }

    createEmptyEntry() {
        return {
            dirX: 0,
            dirZ: 0,
            down: false,
            punch: false,
            kick: false,
            block: false,
            jump: false,
            crouch: false,
            slide: false,
            throwBtn: false,
            fire: false,
            daodan: false,
            heal: false,
            evade: false,
            special: false,
            punchJustPressed: false,
            kickJustPressed: false,
            jumpJustPressed: false,
            crouchJustPressed: false,
            slideJustPressed: false,
            throwJustPressed: false,
            fireJustPressed: false,
            daodanJustPressed: false,
            healJustPressed: false,
            evadeJustPressed: false,
            specialJustPressed: false,
            aimYaw: null,
            walk: false,
            consumedButtons: 0,
            frame: 0
        };
    }

    /**
     * Push raw input for the current fixed frame
     * @param {Object} raw - { dirX, dirZ, down, punch, kick, block, jump, crouch, slide, throwBtn, fire, daodan, heal, evade, special }
     */
    push(raw = {}) {
        this.currentFrame++;
        this.head = (this.head + 1) % this.bufferSize;

        const punch = !!raw.punch;
        const kick = !!raw.kick;
        const block = !!raw.block;
        const jump = !!raw.jump;
        const crouch = !!raw.crouch;
        const slide = !!raw.slide;
        const fire = !!raw.fire;
        const daodan = !!raw.daodan;
        const heal = !!raw.heal;
        const evade = !!raw.evade;
        const special = !!raw.special;
        // Throw can be triggered by dedicated throwBtn OR simultaneous Punch + Kick
        const throwBtn = !!raw.throwBtn || (punch && kick);

        const punchJustPressed = punch && !this.prevRaw.punch;
        const kickJustPressed = kick && !this.prevRaw.kick;
        const jumpJustPressed = jump && !this.prevRaw.jump;
        const crouchJustPressed = crouch && !this.prevRaw.crouch;
        const slideJustPressed = slide && !this.prevRaw.slide;
        const fireJustPressed = fire && !this.prevRaw.fire;
        const daodanJustPressed = daodan && !this.prevRaw.daodan;
        const healJustPressed = heal && !this.prevRaw.heal;
        const evadeJustPressed = evade && !this.prevRaw.evade;
        const specialJustPressed = special && !this.prevRaw.special;
        const throwJustPressed = (!!raw.throwBtn && !this.prevRaw.throwBtn) ||
            (punch && kick && (!this.prevRaw.punch || !this.prevRaw.kick));

        this.buffer[this.head] = {
            dirX: raw.dirX || 0,
            dirZ: raw.dirZ || 0,
            // screen-space "down" for motion commands; falls back to crouch or world +Z
            down: raw.down !== undefined ? !!raw.down : (crouch || (raw.dirZ || 0) > 0.4),
            punch,
            kick,
            block,
            jump,
            crouch,
            slide,
            throwBtn,
            fire,
            daodan,
            heal,
            evade,
            special,
            punchJustPressed,
            kickJustPressed,
            jumpJustPressed,
            crouchJustPressed,
            slideJustPressed,
            throwJustPressed,
            fireJustPressed,
            daodanJustPressed,
            healJustPressed,
            evadeJustPressed,
            specialJustPressed,
            // Oni 2001 mouse-look: absolute facing yaw chosen by the player (null = legacy auto-face)
            aimYaw: typeof raw.aimYaw === 'number' && Number.isFinite(raw.aimYaw) ? raw.aimYaw : null,
            walk: !!raw.walk,
            consumedButtons: 0,
            frame: this.currentFrame
        };

        this.prevRaw = { punch, kick, block, jump, crouch, slide, throwBtn, fire, daodan, heal, evade, special };
    }

    /**
     * Button bitmask helper for 12-frame Pre-Buffer consumption
     */
    static getButtonBit(btnName) {
        switch (btnName) {
            case 'punch': return 1 << 0;
            case 'kick': return 1 << 1;
            case 'jump': return 1 << 2;
            case 'crouch': return 1 << 3;
            case 'slide': return 1 << 4;
            case 'throw': return 1 << 5;
            case 'fire': return 1 << 6;
            case 'daodan': return 1 << 7;
            case 'heal': return 1 << 8;
            case 'evade': return 1 << 9;
            case 'special': return 1 << 10;
            default: return 0;
        }
    }

    /**
     * Check if `btnName` was pressed within the last `windowFrames` (default 10 frames = ~166ms)
     * and has not yet been consumed by an action.
     */
    wasRecentlyPressed(btnName, windowFrames = 10) {
        if (btnName === 'punchOrThrow') {
            return this.wasRecentlyPressed('throw', windowFrames) || this.wasRecentlyPressed('punch', windowFrames);
        }
        const prop = `${btnName}JustPressed`;
        const bit = InputBuffer.getButtonBit(btnName);
        for (let i = 0; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;
            if (entry[prop] && (entry.consumedButtons & bit) === 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Mark `btnName` as consumed across the recent buffer window so a single tap
     * does not trigger a second unbuffered action immediately afterwards.
     */
    consumeBufferedButton(btnName, windowFrames = 12) {
        if (btnName === 'punchOrThrow') {
            this.consumeBufferedButton('throw', windowFrames);
            this.consumeBufferedButton('punch', windowFrames);
            return;
        }
        const bit = InputBuffer.getButtonBit(btnName);
        if (!bit) return;
        for (let i = 0; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;
            entry.consumedButtons |= bit;
        }
    }

    /**
     * Get frame input from `framesAgo` (0 is current frame)
     */
    get(framesAgo = 0) {
        if (framesAgo >= this.bufferSize) return null;
        const idx = (this.head - framesAgo + this.bufferSize) % this.bufferSize;
        return this.buffer[idx];
    }

    /**
     * Check if double-tapped forward towards facing direction within `windowFrames`
     * Supports both 1D facingSign (+1/-1) and 2D unit vector (fx, fz)
     */
    checkDashForward(facingSignOrFx, windowFrames = 18, fz = 0) {
        const cur = this.get(0);
        if (!cur) return false;

        const isMatch = (entry) => {
            if (fz === 0) {
                return Math.sign(entry.dirX) === Math.sign(facingSignOrFx) && Math.abs(entry.dirX) > 0.35;
            }
            const dot = entry.dirX * facingSignOrFx + entry.dirZ * fz;
            return dot > 0.55;
        };

        if (!isMatch(cur)) return false;

        let hasReleased = false;
        let tappedBefore = false;

        for (let i = 1; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;

            if (!hasReleased) {
                if (!isMatch(entry)) {
                    hasReleased = true;
                }
            } else {
                if (isMatch(entry)) {
                    tappedBefore = true;
                    break;
                }
            }
        }
        return hasReleased && tappedBefore;
    }

    /**
     * Check double-tap in any 4 relative directions around fighter's facing vector (fx, fz):
     * Returns 'BACK' (Backflip), 'LEFT' / 'RIGHT' (Cartwheel / Side-roll), or null
     */
    checkDoubleTapEvade(fx, fz, windowFrames = 16) {
        const cur = this.get(0);
        if (!cur) return null;

        const mag = Math.hypot(cur.dirX, cur.dirZ);
        if (mag < 0.45) return null;

        // Forward dot & Right cross in 2D X/Z plane
        const classify = (entry) => {
            const m = Math.hypot(entry.dirX, entry.dirZ);
            if (m < 0.45) return 'NEUTRAL';
            const nx = entry.dirX / m;
            const nz = entry.dirZ / m;
            const fwdDot = nx * fx + nz * fz;
            const sideDot = -nx * fz + nz * fx;
            if (fwdDot < -0.6) return 'BACK';
            if (sideDot > 0.6) return 'RIGHT';
            if (sideDot < -0.6) return 'LEFT';
            if (fwdDot > 0.6) return 'FORWARD';
            return 'NEUTRAL';
        };

        const curDir = classify(cur);
        if (curDir !== 'BACK' && curDir !== 'LEFT' && curDir !== 'RIGHT') {
            return null;
        }

        // Only trigger on the rising edge of the second tap
        const prev = this.get(1);
        if (prev && classify(prev) === curDir) {
            return null;
        }

        let hasReleased = false;
        for (let i = 1; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;
            const d = classify(entry);
            if (!hasReleased) {
                if (d === 'NEUTRAL') hasReleased = true;
            } else {
                if (d === curDir) return curDir;
                if (d !== 'NEUTRAL') break; // tapped a different direction
            }
        }
        return null;
    }

    /**
     * Match Down-Forward-Punch: Uppercut
     */
    checkUppercut(facingSign, windowFrames = 15, fx = null, fz = 0) {
        const cur = this.get(0);
        if (!cur || !cur.punchJustPressed) return false;

        let sawDown = false;
        let sawForward = false;

        for (let i = 0; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;

            if (entry.down || entry.crouch) sawDown = true;
            if (fx !== null) {
                if (entry.dirX * fx + entry.dirZ * fz > 0.45) sawForward = true;
            } else if (Math.sign(entry.dirX) === facingSign && Math.abs(entry.dirX) > 0.3) {
                sawForward = true;
            }
        }

        return sawDown && sawForward;
    }

    /**
     * Match Crouch/Down + Jump + Kick (or Down -> Up/Jump + Kick): Rising Fury (旋风升龙腿)
     */
    checkRisingFury(windowFrames = 16) {
        const cur = this.get(0);
        if (!cur || !cur.kickJustPressed) return false;

        let sawCrouchOrDown = false;
        let sawJumpOrUp = false;

        for (let i = 0; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;
            if (entry.crouch || entry.down || entry.slide) sawCrouchOrDown = true;
            if (entry.jump || entry.dirZ < -0.45) sawJumpOrUp = true;
        }

        return sawCrouchOrDown && sawJumpOrUp;
    }

    /**
     * Match Jump + Punch/Kick within recent frames (used for Run + Jump + Punch = Disarm Kick)
     */
    checkJumpAttack(windowFrames = 10) {
        for (let i = 0; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;
            if (entry.jump) return true;
        }
        return false;
    }

    /**
     * Clear buffer state on round reset / knockdown
     */
    clear() {
        for (let i = 0; i < this.bufferSize; i++) {
            this.buffer[i] = this.createEmptyEntry();
        }
        this.prevRaw = {
            punch: false,
            kick: false,
            block: false,
            jump: false,
            crouch: false,
            slide: false,
            throwBtn: false,
            fire: false,
            daodan: false,
            heal: false,
            evade: false,
            special: false
        };
    }
}
