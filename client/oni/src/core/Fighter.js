/**
 * Fighter Entity & HFSM (Hierarchical Finite State Machine)
 * Deterministic character logic executing at 60Hz.
 */

import {
    FIXED_DT,
    GRAVITY,
    MOVE_SPEED,
    MOVES,
    FIGHTER_STATE,
    STAGE_BOUNDS
} from './Constants.js';
import { InputBuffer } from './InputBuffer.js';

export class Fighter {
    constructor(id, name, startX, facingSign = 1, isBot = false) {
        this.id = id;
        this.name = name;
        this.isBot = isBot;

        // Transform
        this.x = startX;
        this.y = 0;
        this.z = 0;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.facing = facingSign; // +1 facing right, -1 facing left

        // Combat Stats
        this.maxHp = 100;
        this.hp = this.maxHp;
        this.stamina = 100;

        // State Machine
        this.state = FIGHTER_STATE.IDLE;
        this.stateTimer = 0; // Frames spent in current state
        this.currentMove = null;
        this.hasHitThisMove = false;
        this.bufferedMove = null;
        this.comboCount = 0;
        this.comboResetTimer = 0;

        // Flags
        this.isGrounded = true;
        this.isBlocking = false;
        this.invincible = false;
        this.dashTimer = 0;

        // Input
        this.inputBuffer = new InputBuffer();
    }

    reset(startX, facingSign) {
        this.x = startX;
        this.y = 0;
        this.z = 0;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.facing = facingSign;
        this.hp = this.maxHp;
        this.stamina = 100;
        this.state = FIGHTER_STATE.IDLE;
        this.stateTimer = 0;
        this.currentMove = null;
        this.hasHitThisMove = false;
        this.bufferedMove = null;
        this.comboCount = 0;
        this.comboResetTimer = 0;
        this.isGrounded = true;
        this.isBlocking = false;
        this.invincible = false;
        this.inputBuffer.clear();
    }

    /**
     * Set state and reset state timer
     */
    transitionTo(newState, move = null) {
        this.state = newState;
        this.stateTimer = 0;
        this.currentMove = move;
        this.hasHitThisMove = false;
        this.bufferedMove = null;

        if (newState === FIGHTER_STATE.ATTACK && move) {
            if (move.velocityImpulse) {
                this.vx = move.velocityImpulse * this.facing;
            }
        }
    }

    /**
     * Fixed 60Hz update
     */
    update(rawInput, opponent) {
        this.inputBuffer.push(rawInput);
        const input = this.inputBuffer.get(0);

        this.stateTimer++;

        // Combo reset decay
        if (this.comboResetTimer > 0) {
            this.comboResetTimer--;
            if (this.comboResetTimer === 0) {
                this.comboCount = 0;
            }
        }

        // Auto-face opponent if in neutral and not attacking/hit
        if (this.state === FIGHTER_STATE.IDLE || this.state === FIGHTER_STATE.WALK) {
            if (opponent) {
                this.facing = opponent.x >= this.x ? 1 : -1;
            }
        }

        // Execute state logic
        switch (this.state) {
            case FIGHTER_STATE.IDLE:
                this.handleIdle(input, opponent);
                break;
            case FIGHTER_STATE.WALK:
                this.handleWalk(input, opponent);
                break;
            case FIGHTER_STATE.RUN:
                this.handleRun(input, opponent);
                break;
            case FIGHTER_STATE.ATTACK:
                this.handleAttack(input);
                break;
            case FIGHTER_STATE.BLOCK:
                this.handleBlock(input);
                break;
            case FIGHTER_STATE.HIT_STUN:
                this.handleHitStun();
                break;
            case FIGHTER_STATE.KNOCKED_DOWN:
                this.handleKnockdown();
                break;
            case FIGHTER_STATE.WAKEUP:
                this.handleWakeup();
                break;
        }

        // Apply physics (gravity & velocity)
        if (!this.isGrounded) {
            this.vy += GRAVITY * FIXED_DT;
            this.y += this.vy * FIXED_DT;

            if (this.y <= 0) {
                this.y = 0;
                this.vy = 0;
                this.isGrounded = true;

                if (this.state === FIGHTER_STATE.KNOCKED_DOWN) {
                    this.vx *= 0.3;
                }
            }
        }

        // Horizontal integration
        this.x += this.vx * FIXED_DT;
        this.z += this.vz * FIXED_DT;

        // Friction when on ground
        if (this.isGrounded) {
            if (this.state !== FIGHTER_STATE.WALK && this.state !== FIGHTER_STATE.RUN) {
                this.vx *= 0.78;
                this.vz *= 0.78;
                if (Math.abs(this.vx) < 0.05) this.vx = 0;
                if (Math.abs(this.vz) < 0.05) this.vz = 0;
            }
        }

        // Stage bounds clamping
        this.x = Math.max(STAGE_BOUNDS.minX, Math.min(STAGE_BOUNDS.maxX, this.x));
        this.z = Math.max(STAGE_BOUNDS.minZ, Math.min(STAGE_BOUNDS.maxZ, this.z));
    }

    handleIdle(input, opponent) {
        this.isBlocking = input.block;

        // Check Dash
        if (this.inputBuffer.checkDashForward(this.facing)) {
            this.transitionTo(FIGHTER_STATE.RUN);
            return;
        }

        // Check Attacks
        if (this.tryStartAttack(input)) {
            return;
        }

        // Check Jump
        if (input.jump && this.isGrounded) {
            this.vy = 12.0;
            this.isGrounded = false;
        }

        // Check Movement
        if (Math.abs(input.dirX) > 0.1 || Math.abs(input.dirZ) > 0.1) {
            this.transitionTo(FIGHTER_STATE.WALK);
        }
    }

    handleWalk(input, opponent) {
        this.isBlocking = input.block;

        // Check Dash
        if (this.inputBuffer.checkDashForward(this.facing)) {
            this.transitionTo(FIGHTER_STATE.RUN);
            return;
        }

        // Check Attacks
        if (this.tryStartAttack(input)) {
            return;
        }

        // Walk speed calculation
        if (Math.abs(input.dirX) < 0.1 && Math.abs(input.dirZ) < 0.1) {
            this.vx = 0;
            this.vz = 0;
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        const isMovingForward = Math.sign(input.dirX) === this.facing;
        const speedX = isMovingForward ? MOVE_SPEED.WALK_FORWARD : MOVE_SPEED.WALK_BACK;

        this.vx = input.dirX * speedX;
        this.vz = input.dirZ * MOVE_SPEED.WALK_FORWARD * 0.7; // slightly slower along Z axis
    }

    handleRun(input, opponent) {
        // If pressing kick while running -> SLIDE KICK! (Signature Oni move)
        if (input.kickJustPressed) {
            this.transitionTo(FIGHTER_STATE.ATTACK, MOVES.SLIDE_KICK);
            return;
        }

        if (input.punchJustPressed) {
            this.transitionTo(FIGHTER_STATE.ATTACK, MOVES.PUNCH_1);
            return;
        }

        // Continue running towards facing direction
        if (Math.sign(input.dirX) === this.facing && Math.abs(input.dirX) > 0.2) {
            this.vx = this.facing * MOVE_SPEED.RUN;
            this.vz = input.dirZ * MOVE_SPEED.RUN * 0.5;
        } else {
            // Stopped or turned
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    tryStartAttack(input) {
        // 1. Check special command: Uppercut (Down-Forward + Punch)
        if (this.inputBuffer.checkUppercut(this.facing)) {
            this.transitionTo(FIGHTER_STATE.ATTACK, MOVES.UPPERCUT);
            return true;
        }

        // 2. Punch
        if (input.punchJustPressed) {
            this.transitionTo(FIGHTER_STATE.ATTACK, MOVES.PUNCH_1);
            return true;
        }

        // 3. Kick
        if (input.kickJustPressed) {
            this.transitionTo(FIGHTER_STATE.ATTACK, MOVES.KICK_LOW);
            return true;
        }

        return false;
    }

    handleAttack(input) {
        const move = this.currentMove;
        if (!move) {
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        const totalFrames = move.startup + move.active + move.recovery;

        // Combo Buffer / Cancel Window Check
        if (move.cancelTo && move.cancelTo.length > 0) {
            const startCancel = move.cancelWindowStart || (move.startup + 1);
            if (this.stateTimer >= startCancel) {
                // Check if player presses next button
                if (input.punchJustPressed) {
                    for (const candidateKey of move.cancelTo) {
                        if (candidateKey.startsWith('PUNCH') || candidateKey === 'UPPERCUT') {
                            this.bufferedMove = MOVES[candidateKey];
                            break;
                        }
                    }
                } else if (input.kickJustPressed) {
                    for (const candidateKey of move.cancelTo) {
                        if (candidateKey.startsWith('KICK')) {
                            this.bufferedMove = MOVES[candidateKey];
                            break;
                        }
                    }
                }
            }
        }

        // Did active window finish and can execute buffered move?
        const activeEnd = move.startup + move.active;
        if (this.stateTimer >= activeEnd && this.bufferedMove) {
            const nextMove = this.bufferedMove;
            this.transitionTo(FIGHTER_STATE.ATTACK, nextMove);
            return;
        }

        // Finished entire move recovery
        if (this.stateTimer >= totalFrames) {
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    handleBlock(input) {
        if (!input.block) {
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }
        this.isBlocking = true;
    }

    handleHitStun() {
        if (this.stateTimer >= this.hitStunDuration) {
            if (this.hp <= 0) {
                this.transitionTo(FIGHTER_STATE.DEFEAT);
            } else {
                this.transitionTo(FIGHTER_STATE.IDLE);
            }
        }
    }

    handleKnockdown() {
        // Stay on ground for 30 frames before starting wakeup
        if (this.stateTimer >= 35) {
            if (this.hp <= 0) {
                this.transitionTo(FIGHTER_STATE.DEFEAT);
            } else {
                this.transitionTo(FIGHTER_STATE.WAKEUP);
            }
        }
    }

    handleWakeup() {
        // Wakeup animation (20 frames) with invincibility
        this.invincible = true;
        if (this.stateTimer >= 22) {
            this.invincible = false;
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    /**
     * Receive hit event from collision system
     */
    takeHit(hitInfo, attackerFacing) {
        const move = hitInfo.move;

        if (hitInfo.isBlock) {
            // Blocked!
            const chipDamage = Math.max(1, Math.floor(move.damage * 0.15));
            this.hp = Math.max(0, this.hp - chipDamage);
            this.vx = attackerFacing * 2.0;
            this.state = FIGHTER_STATE.BLOCK;
            this.stateTimer = 0;
            this.hitStunDuration = move.blockStun;
            return { blocked: true, damage: chipDamage };
        }

        // Clean Hit!
        this.hp = Math.max(0, this.hp - move.damage);

        if (move.knockdown || this.hp <= 0 || move.isLauncher) {
            this.transitionTo(FIGHTER_STATE.KNOCKED_DOWN);
            this.vx = attackerFacing * (move.knockback.x || 3.5);
            this.vy = move.knockback.y || 4.5;
            this.isGrounded = false;
        } else {
            this.transitionTo(FIGHTER_STATE.HIT_STUN);
            this.hitStunDuration = move.hitStun;
            this.vx = attackerFacing * (move.knockback.x || 2.0);
        }

        return { blocked: false, damage: move.damage };
    }
}
