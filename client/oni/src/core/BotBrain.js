/**
 * BotBrain - Deterministic Fighting Game AI
 * Supports 'easy', 'normal', 'hard' difficulty settings.
 * Uses deterministic seeded PRNG (no Math.random()) for replay/lockstep compatibility.
 */

import { FIGHTER_STATE } from './Constants.js';
import { createDeterministicRNG } from './Simulation.js';

export class BotBrain {
    constructor(level = 'normal', seed = 0xB07A1) {
        this.level = level; // 'easy' | 'normal' | 'hard'
        this.actionTimer = 0;
        this.currentAction = 'IDLE';
        this.thinkInterval = level === 'hard' ? 4 : (level === 'easy' ? 18 : 10);
        this.rng = createDeterministicRNG(seed);
    }

    rand(sim) {
        if (sim && typeof sim.random === 'function') {
            return sim.random();
        }
        return this.rng.next();
    }

    /**
     * Compute input for bot fighter this tick
     * @param {Object} botFighter The bot fighter instance
     * @param {Object} opponent The player fighter instance
     * @param {Object} [sim] Optional Simulation instance for shared deterministic PRNG
     * @returns {Object} raw input { dirX, dirZ, punch, kick, block, jump, crouch, slide, throwBtn }
     */
    think(botFighter, opponent, sim = null) {
        this.actionTimer++;

        const dx = opponent.x - botFighter.x;
        const dz = opponent.z - botFighter.z;
        const dist = Math.hypot(dx, dz);
        const nx = dist > 0.001 ? dx / dist : 1;
        const nz = dist > 0.001 ? dz / dist : 0;

        const input = {
            dirX: 0,
            dirZ: 0,
            punch: false,
            kick: false,
            block: false,
            jump: false,
            crouch: false,
            slide: false,
            throwBtn: false
        };

        // 1. Throw-Tech reaction when grabbed on Hard / Normal
        if (botFighter.state === FIGHTER_STATE.BEING_THROWN) {
            const techChance = this.level === 'hard' ? 0.55 : (this.level === 'normal' ? 0.2 : 0.0);
            if (botFighter.stateTimer === 3 && this.rand(sim) < techChance) {
                input.throwBtn = true;
            }
            return input;
        }

        // 2. Break-Fall Tech Recovery when knocked down on Hard / Normal
        if (botFighter.state === FIGHTER_STATE.KNOCKED_DOWN && botFighter.hp > 0) {
            const ukemiChance = this.level === 'hard' ? 0.65 : (this.level === 'normal' ? 0.25 : 0.0);
            if (!botFighter.isGrounded && botFighter.vy < 0 && botFighter.y <= 0.7 && this.rand(sim) < ukemiChance) {
                input.jump = true;
            }
            return input;
        }

        // Don't issue inputs if stunned, dizzy, or waking up
        if (
            botFighter.state === FIGHTER_STATE.HIT_STUN ||
            botFighter.state === FIGHTER_STATE.DIZZY ||
            botFighter.state === FIGHTER_STATE.WAKEUP ||
            botFighter.state === FIGHTER_STATE.TECH_RECOVERY
        ) {
            return input;
        }

        // 3. Defensive reaction on Hard / Normal
        if (opponent.state === FIGHTER_STATE.ATTACK && dist < 2.6) {
            const blockChance = this.level === 'hard' ? 0.82 : (this.level === 'normal' ? 0.45 : 0.15);
            if (this.rand(sim) < blockChance) {
                input.block = true;
                input.dirX = -nx;
                input.dirZ = -nz;
                return input;
            }
        }

        // 4. Punish dizzy or knocked down opponent
        if (opponent.state === FIGHTER_STATE.DIZZY && dist < 1.35) {
            input.throwBtn = true;
            input.punch = true;
            return input;
        }
        if (opponent.state === FIGHTER_STATE.KNOCKED_DOWN && dist < 1.5 && this.level !== 'easy') {
            if (this.rand(sim) < 0.35) {
                input.kick = true; // Ground stomp
                return input;
            }
        }

        // 5. Close range combat
        if (dist < 1.45) {
            const r = this.rand(sim);
            if (this.level === 'hard') {
                if (r < 0.42) {
                    input.punch = true; // Jab -> Cross -> Crescent Kick
                } else if (r < 0.72) {
                    input.kick = true; // Low Kick -> Side Kick -> Spin Roundhouse
                } else if (r < 0.84) {
                    // Uppercut command: Down + Forward + Punch
                    input.down = true;
                    input.dirX = nx;
                    input.dirZ = nz;
                    input.punch = true;
                } else if (r < 0.92) {
                    // Throw attempt
                    input.throwBtn = true;
                } else {
                    input.block = true;
                }
            } else if (this.level === 'normal') {
                if (r < 0.35) input.punch = true;
                else if (r < 0.62) input.kick = true;
                else if (r < 0.80) input.block = true;
            } else {
                // Easy
                if (r < 0.15) input.punch = true;
                else if (r < 0.28) input.kick = true;
            }
            return input;
        }

        // 6. Medium range: Approach or Dash / Slide
        if (dist >= 1.45 && dist < 5.0) {
            input.dirX = nx;
            input.dirZ = Math.abs(dz) > 0.25 ? nz : 0;

            if (this.level === 'hard' && dist > 2.2 && dist < 3.8 && this.rand(sim) < 0.08) {
                input.slide = true;
            }
            return input;
        }

        // 7. Long range: Close the gap
        input.dirX = nx;
        input.dirZ = nz;
        return input;
    }
}
