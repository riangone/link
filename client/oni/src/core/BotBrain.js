/**
 * BotBrain - Rule-based Fighting Game AI
 * Supports 'easy', 'normal', 'hard' difficulty settings.
 */

export class BotBrain {
    constructor(level = 'normal') {
        this.level = level; // 'easy' | 'normal' | 'hard'
        this.actionTimer = 0;
        this.currentAction = 'IDLE';
        this.thinkInterval = level === 'hard' ? 4 : (level === 'easy' ? 18 : 10);
    }

    /**
     * Compute input for bot fighter this tick
     * @param {Object} botFighter The bot fighter instance
     * @param {Object} opponent The player fighter instance
     * @returns {Object} raw input { dirX, dirZ, punch, kick, block, jump }
     */
    think(botFighter, opponent) {
        this.actionTimer++;

        const dx = opponent.x - botFighter.x;
        const dist = Math.abs(dx);
        const towardsPlayer = Math.sign(dx);

        let input = {
            dirX: 0,
            dirZ: 0,
            punch: false,
            kick: false,
            block: false,
            jump: false
        };

        // Don't issue inputs if knocked down or in hit stun
        if (botFighter.state === 'KNOCKED_DOWN' || botFighter.state === 'HIT_STUN' || botFighter.state === 'WAKEUP') {
            return input;
        }

        // Defensive reaction on Hard / Normal
        if (opponent.state === 'ATTACK' && dist < 2.5) {
            const blockChance = this.level === 'hard' ? 0.85 : (this.level === 'normal' ? 0.45 : 0.15);
            if (Math.random() < blockChance) {
                input.block = true;
                input.dirX = -towardsPlayer; // back away
                return input;
            }
        }

        // Close range combat
        if (dist < 1.4) {
            if (this.level === 'hard') {
                // Hard bot combos
                const r = Math.random();
                if (r < 0.45) {
                    input.punch = true; // Jab -> Cross
                } else if (r < 0.75) {
                    input.kick = true; // Kick
                } else if (r < 0.90) {
                    // Uppercut command: Down + Forward + Punch
                    input.dirZ = 1.0;
                    input.dirX = towardsPlayer;
                    input.punch = true;
                } else {
                    input.block = true;
                }
            } else if (this.level === 'normal') {
                const r = Math.random();
                if (r < 0.35) input.punch = true;
                else if (r < 0.6) input.kick = true;
                else if (r < 0.8) input.block = true;
            } else {
                // Easy
                if (Math.random() < 0.15) input.punch = true;
                else if (Math.random() < 0.15) input.kick = true;
            }
            return input;
        }

        // Medium range: Approach or Dash
        if (dist >= 1.4 && dist < 5.0) {
            input.dirX = towardsPlayer;

            // Z-axis alignment
            const dz = opponent.z - botFighter.z;
            if (Math.abs(dz) > 0.4) {
                input.dirZ = Math.sign(dz) * 0.7;
            }

            // Hard bot dash slide kick
            if (this.level === 'hard' && dist > 2.2 && dist < 3.8 && Math.random() < 0.08) {
                input.kick = true; // slide kick if dashing
            }

            return input;
        }

        // Long range: Close the gap
        input.dirX = towardsPlayer;
        return input;
    }
}
