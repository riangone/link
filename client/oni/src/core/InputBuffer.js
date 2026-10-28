/**
 * InputBuffer & Command Pattern Recognizer
 * Maintains a rolling ring-buffer of input snapshots (60 frames)
 * Recognizes combos, dashes, and directional command inputs.
 */

export class InputBuffer {
    constructor(bufferSize = 60) {
        this.bufferSize = bufferSize;
        this.buffer = new Array(bufferSize).fill(null).map(() => ({
            dirX: 0,
            dirZ: 0,
            punch: false,
            kick: false,
            block: false,
            jump: false,
            punchJustPressed: false,
            kickJustPressed: false,
            frame: 0
        }));
        this.head = 0;
        this.currentFrame = 0;
        this.prevRaw = { punch: false, kick: false, block: false, jump: false };
    }

    /**
     * Push raw input for the current fixed frame
     * @param {Object} raw - { dirX, dirZ, punch, kick, block, jump }
     */
    push(raw) {
        this.currentFrame++;
        this.head = (this.head + 1) % this.bufferSize;

        const punchJustPressed = !!raw.punch && !this.prevRaw.punch;
        const kickJustPressed = !!raw.kick && !this.prevRaw.kick;

        this.buffer[this.head] = {
            dirX: raw.dirX || 0,
            dirZ: raw.dirZ || 0,
            punch: !!raw.punch,
            kick: !!raw.kick,
            block: !!raw.block,
            jump: !!raw.jump,
            punchJustPressed,
            kickJustPressed,
            frame: this.currentFrame
        };

        this.prevRaw = {
            punch: !!raw.punch,
            kick: !!raw.kick,
            block: !!raw.block,
            jump: !!raw.jump
        };
    }

    /**
     * Get frame input from `framesAgo` (0 is current frame)
     */
    get(framesAgo = 0) {
        if (framesAgo >= this.bufferSize) return null;
        let idx = (this.head - framesAgo + this.bufferSize) % this.bufferSize;
        return this.buffer[idx];
    }

    /**
     * Check if double-tapped forward towards facing direction within `windowFrames`
     * @param {number} facingSign +1 (facing right) or -1 (facing left)
     * @param {number} windowFrames
     */
    checkDashForward(facingSign, windowFrames = 18) {
        const cur = this.get(0);
        if (!cur || Math.sign(cur.dirX) !== facingSign) return false;

        let hasReleased = false;
        let tappedBefore = false;

        for (let i = 1; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;

            if (!hasReleased) {
                if (Math.sign(entry.dirX) !== facingSign) {
                    hasReleased = true;
                }
            } else {
                if (Math.sign(entry.dirX) === facingSign) {
                    tappedBefore = true;
                    break;
                }
            }
        }
        return hasReleased && tappedBefore;
    }

    /**
     * Match special Oni moves:
     * - Down-Forward-Punch: Uppercut
     * - Slide Kick: Running/Dashing + Kick
     */
    checkUppercut(facingSign, windowFrames = 15) {
        const cur = this.get(0);
        if (!cur || !cur.punchJustPressed) return false;

        let sawDown = false;
        let sawForward = false;

        for (let i = 0; i < windowFrames; i++) {
            const entry = this.get(i);
            if (!entry) break;

            if (entry.dirZ > 0.4) sawDown = true;
            if (Math.sign(entry.dirX) === facingSign) sawForward = true;
        }

        return sawDown && sawForward;
    }

    /**
     * Clear buffer state on round reset / knockdown
     */
    clear() {
        for (let i = 0; i < this.bufferSize; i++) {
            this.buffer[i] = {
                dirX: 0,
                dirZ: 0,
                punch: false,
                kick: false,
                block: false,
                jump: false,
                punchJustPressed: false,
                kickJustPressed: false,
                frame: 0
            };
        }
        this.prevRaw = { punch: false, kick: false, block: false, jump: false };
    }
}
