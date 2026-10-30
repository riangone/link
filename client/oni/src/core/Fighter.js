/**
 * Fighter Entity & HFSM (Hierarchical Finite State Machine)
 * Deterministic character logic executing at 60Hz.
 * Supports 3D arbitrary yaw facingAngle, declarative MOVE_TABLE, Poise/Dizzy,
 * Context-Sensitive Throws with Throw-Tech, Omnidirectional I-Frame Evades, and Break-Fall Tech Recovery.
 */

import {
    FIXED_DT,
    GRAVITY,
    MOVE_SPEED,
    MOVES,
    MOVE_TABLE,
    FIGHTER_STATE,
    STAGE_BOUNDS,
    STAGE_CONFIG,
    POISE_CONFIG,
    DAODAN_CONFIG,
    THROW_TECH_WINDOW,
    TECH_RECOVERY_WINDOW,
    WEAPON_PICKUP_RANGE,
    WEAPON_SPECS
} from './Constants.js';
import { InputBuffer } from './InputBuffer.js';
import { CollisionSystem } from './CollisionSystem.js';

function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

export class Fighter {
    constructor(id, name, startX, facingSign = 1, isBot = false) {
        this.id = id;
        this.name = name;
        this.isBot = isBot;
        this.entityType = 'fighter';

        // Transform & 3D Orientation
        this.x = startX;
        this.y = 0;
        this.z = 0;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this._facing = facingSign >= 0 ? 1 : -1;
        this.facingAngle = this._facing === 1 ? 0 : Math.PI;

        // Combat Stats & Poise
        this.maxHp = 100;
        this.hp = this.maxHp;
        this.stamina = 100;
        this.maxPoise = POISE_CONFIG.MAX_POISE;
        this.poise = this.maxPoise;
        this.poiseRegenCooldown = 0;

        // State Machine
        this.state = FIGHTER_STATE.IDLE;
        this.stateTimer = 0;
        this.currentMove = null;
        this.hasHitThisMove = false;
        this.bufferedMove = null;
        this.comboCount = 0;
        this.comboResetTimer = 0;
        this.hitStunDuration = 0;
        this.antiGankTimer = 0; // Beat 'em up crowd anti-stun-lock grace frames

        // Throw & Evade Tracking
        this.throwTarget = null;
        this.thrownBy = null;
        this.evadeDir = 'BACK'; // 'BACK' | 'LEFT' | 'RIGHT' | 'FORWARD'
        this.unlockedMoves = new Set(Object.keys(MOVES));
        this.canSteppingDisarm = true; // Campaign restricts this to Ch.13+

        // P2 Single-Slot Firearm State (null or { id, type, name, ammo, maxAmmo, color })
        this.weapon = null;

        // P3 Hypo-Spray (打针回血) & P4 Daodan Chrysalis (道弹蛹生物机械觉醒)
        this.maxHypo = 1;
        this.hypoCount = this.maxHypo;
        this.daodanMeter = 0;
        this.maxDaodanMeter = DAODAN_CONFIG.MAX_METER;
        this.daodanStage = 1; // 1 | 2 | 3
        this.daodanOverdrive = false;
        this.daodanOverpower = false;
        this.overpowerShield = 0;
        this.overdriveTimer = 0;

        // Flags & P5 Arena Elevation Tracking
        this.isGrounded = true;
        this.isBlocking = false;
        this.invincible = false;
        this.dashTimer = 0;
        this.ringOut = false;
        this.floorY = 0;
        this.speedScale = 1.0;
        this.aiSpeedMult = 1.0; // set by BotBrain per AI tier; 1.0 for human players

        // Input
        this.inputBuffer = new InputBuffer();
    }

    /**
     * Equip a weapon into the single slot (replaces any existing weapon)
     */
    equipWeapon(weaponData) {
        if (!weaponData) {
            this.weapon = null;
            return null;
        }
        const spec = WEAPON_SPECS[weaponData.type] || WEAPON_SPECS[weaponData.id] || WEAPON_SPECS.TCTF_PISTOL;
        this.weapon = {
            id: weaponData.id || `wpn_${this.id}`,
            type: spec.id,
            name: spec.name,
            ammo: weaponData.ammo !== undefined ? weaponData.ammo : spec.maxAmmo,
            maxAmmo: spec.maxAmmo,
            color: spec.color
        };
        return this.weapon;
    }

    /**
     * Unequip and return the currently held weapon (for disarm or throw)
     */
    unequipWeapon() {
        const w = this.weapon;
        this.weapon = null;
        return w;
    }

    /**
     * P4 Daodan Chrysalis: Add bio-mechanical resonance meter & evolve stages (1 -> 2 -> 3)
     */
    gainDaodan(amount, simEvents = null) {
        if (amount <= 0) return;
        const prevStage = this.daodanStage;
        this.daodanMeter = Math.min(this.maxDaodanMeter, this.daodanMeter + amount);

        if (this.daodanMeter >= DAODAN_CONFIG.STAGE_THRESHOLDS.STAGE_3 && this.daodanStage < 3) {
            this.daodanStage = 3;
            this.unlockMove('DEVIL_SPIN_KICK');
            this.unlockMove('DAODAN_SURGE');
        } else if (this.daodanMeter >= DAODAN_CONFIG.STAGE_THRESHOLDS.STAGE_2 && this.daodanStage < 2) {
            this.daodanStage = 2;
            this.unlockMove('RISING_FURY');
            this.unlockMove('DISARM_KICK');
        }

        if (this.daodanStage > prevStage && simEvents) {
            simEvents.push({
                type: 'DAODAN_STAGE_UP',
                fighter: this.id,
                stage: this.daodanStage,
                x: this.x,
                y: this.y + 1.1,
                z: this.z
            });
        }
    }

    unlockMove(moveId) {
        this.unlockedMoves.add(moveId);
    }

    lockMove(moveId) {
        this.unlockedMoves.delete(moveId);
    }

    /**
     * Activate P4 Daodan Overdrive (Full Chrysalis Awakening: Hyper-Armor, +35% Damage, Bio-Regen, Speed Boost)
     */
    activateDaodanOverdrive(simEvents = null) {
        this.daodanOverdrive = true;
        this.daodanStage = 3;
        this.unlockMove('DEVIL_SPIN_KICK');
        this.unlockMove('DAODAN_SURGE');
        this.overdriveTimer = Math.max(240, Math.round(this.daodanMeter / DAODAN_CONFIG.OVERDRIVE_DRAIN_PER_TICK));
        this.poise = this.maxPoise;

        if (simEvents) {
            simEvents.push({
                type: 'DAODAN_OVERDRIVE',
                fighter: this.id,
                x: this.x,
                y: this.y + 1.1,
                z: this.z
            });
        }
    }

    /**
     * Activate P5 Daodan Overpower (Full HP Hypo Injection: Golden Body, Overshield +50, +50% Damage, Unbreakable Hyper-Armor)
     */
    activateDaodanOverpower(simEvents = null) {
        this.daodanOverpower = true;
        this.daodanOverdrive = true;
        this.daodanStage = 3;
        this.unlockMove('DEVIL_SPIN_KICK');
        this.unlockMove('DAODAN_SURGE');
        this.daodanMeter = DAODAN_CONFIG.MAX_METER;
        this.overpowerShield = DAODAN_CONFIG.OVERPOWER_SHIELD_AMOUNT || 50;
        this.overdriveTimer = 480; // ~8 seconds
        this.poise = this.maxPoise * 1.5;

        if (simEvents) {
            simEvents.push({
                type: 'DAODAN_OVERPOWER',
                fighter: this.id,
                shield: this.overpowerShield,
                x: this.x,
                y: this.y + 1.1,
                z: this.z,
                text: 'DAODAN OVERPOWER! 满血超载!'
            });
        }
    }

    get facing() {
        return this._facing;
    }

    set facing(val) {
        this._facing = val >= 0 ? 1 : -1;
        this.facingAngle = this._facing === 1 ? 0 : Math.PI;
    }

    /**
     * Set 2D facing angle in radians (0 = +X, PI = -X) and sync legacy `facing` sign
     */
    setFacingAngle(angleRad) {
        this.facingAngle = wrapAngle(angleRad);
        const c = Math.cos(this.facingAngle);
        if (Math.abs(c) > 0.05) {
            this._facing = c >= 0 ? 1 : -1;
        }
    }

    /**
     * Smoothly or immediately turn towards a target point (tx, tz)
     */
    faceTowards(tx, tz, maxTurnRad = Math.PI) {
        const dx = tx - this.x;
        const dz = tz - this.z;
        if (dx * dx + dz * dz < 0.0001) return;
        const desired = Math.atan2(dz, dx);
        const diff = wrapAngle(desired - this.facingAngle);
        if (Math.abs(diff) <= maxTurnRad) {
            this.setFacingAngle(desired);
        } else {
            this.setFacingAngle(this.facingAngle + Math.sign(diff) * maxTurnRad);
        }
    }

    getForwardVector() {
        return {
            fx: Math.cos(this.facingAngle),
            fz: Math.sin(this.facingAngle)
        };
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
        this.poise = this.maxPoise;
        this.poiseRegenCooldown = 0;
        this.state = FIGHTER_STATE.IDLE;
        this.stateTimer = 0;
        this.currentMove = null;
        this.hasHitThisMove = false;
        this.bufferedMove = null;
        this.comboCount = 0;
        this.comboResetTimer = 0;
        this.hitStunDuration = 0;
        this.antiGankTimer = 0; // Beat 'em up crowd anti-stun-lock grace frames
        this.throwTarget = null;
        this.thrownBy = null;
        this.evadeDir = 'BACK';
        this.weapon = null;
        this.hypoCount = this.maxHypo;
        this.daodanMeter = 0;
        this.daodanStage = 1;
        this.daodanOverdrive = false;
        this.daodanOverpower = false;
        this.overpowerShield = 0;
        this.overdriveTimer = 0;
        this.isGrounded = true;
        this.isBlocking = false;
        this.invincible = false;
        this.dashTimer = 0;
        this.ringOut = false;
        this.floorY = 0;
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
        this.hitTargets = new Set();
        this.bufferedMove = null;
        this.invincible = (newState === FIGHTER_STATE.THROW) || !!(move && move.invulnFrames);

        if (newState !== FIGHTER_STATE.IDLE && newState !== FIGHTER_STATE.WALK && newState !== FIGHTER_STATE.BLOCK && newState !== FIGHTER_STATE.CROUCH) {
            this.isBlocking = false;
        }

        if ((newState === FIGHTER_STATE.ATTACK || newState === FIGHTER_STATE.THROW) && move) {
            const { fx, fz } = this.getForwardVector();
            if (move.velocityImpulse) {
                this.vx = fx * move.velocityImpulse;
                this.vz = fz * move.velocityImpulse;
            }
            if (move.verticalImpulse && this.isGrounded) {
                this.vy = move.verticalImpulse;
                this.isGrounded = false;
            }
        }
    }

    /**
     * Fixed 60Hz update
     */
    update(rawInput, opponent, simEvents = null) {
        this.inputBuffer.push(rawInput);
        const input = this.inputBuffer.get(0);

        this.stateTimer++;
        if (this.dashTimer > 0) this.dashTimer--;

        // P4 & P5 Daodan Overdrive / Overpower tick (passive bio-regen, hyper-armor poise floor, meter/timer drain)
        if (this.daodanOverdrive) {
            this.daodanMeter = Math.max(0, this.daodanMeter - DAODAN_CONFIG.OVERDRIVE_DRAIN_PER_TICK);
            if (this.hp > 0 && this.hp < this.maxHp) {
                this.hp = Math.min(this.maxHp, this.hp + DAODAN_CONFIG.OVERDRIVE_REGEN_PER_TICK);
            }
            const poiseFloor = this.daodanOverpower ? (DAODAN_CONFIG.OVERPOWER_POISE_FLOOR || 50) : DAODAN_CONFIG.OVERDRIVE_POISE_FLOOR;
            if (this.poise < poiseFloor && this.state !== FIGHTER_STATE.DIZZY) {
                this.poise = poiseFloor;
            }
            if (this.overdriveTimer > 0) {
                this.overdriveTimer--;
            }
            if (this.daodanMeter <= 0 || (this.daodanOverpower && this.overdriveTimer <= 0)) {
                this.daodanOverdrive = false;
                this.daodanOverpower = false;
                this.overpowerShield = 0;
                this.overdriveTimer = 0;
            }
        }

        // Combo reset decay
        if (this.comboResetTimer > 0) {
            this.comboResetTimer--;
            if (this.comboResetTimer === 0) {
                this.comboCount = 0;
            }
        }

        // Anti-Gank hitstun lock decay
        if (this.antiGankTimer > 0) {
            this.antiGankTimer--;
        }

        // Poise recovery when not stunned or dizzy
        if (this.poiseRegenCooldown > 0) {
            this.poiseRegenCooldown--;
        } else if (
            this.poise < this.maxPoise &&
            this.state !== FIGHTER_STATE.HIT_STUN &&
            this.state !== FIGHTER_STATE.DIZZY &&
            this.state !== FIGHTER_STATE.KNOCKED_DOWN &&
            this.state !== FIGHTER_STATE.BEING_THROWN
        ) {
            this.poise = Math.min(this.maxPoise, this.poise + POISE_CONFIG.REGEN_PER_TICK);
        }

        // Oni 2001 mouse-look: the player turns Konoko directly; no auto-facing
        const aimControlled = this.isAimControlled(input);
        if (aimControlled && (
            this.state === FIGHTER_STATE.IDLE ||
            this.state === FIGHTER_STATE.WALK ||
            this.state === FIGHTER_STATE.RUN ||
            this.state === FIGHTER_STATE.CROUCH ||
            this.state === FIGHTER_STATE.BLOCK
        )) {
            this.setFacingAngle(input.aimYaw);
        }

        // Auto-face opponent in neutral states (Oni 2001 Soft Target Strafe: tight tracking in close/mid combat)
        if (!aimControlled && (
            this.state === FIGHTER_STATE.IDLE ||
            this.state === FIGHTER_STATE.WALK ||
            this.state === FIGHTER_STATE.CROUCH
        )) {
            const distToOpp = opponent ? Math.hypot(opponent.x - this.x, opponent.z - this.z) : Infinity;
            if (opponent && distToOpp < 5.2) {
                this.faceTowards(opponent.x, opponent.z, 0.55);
            } else if (this.state === FIGHTER_STATE.WALK && (Math.abs(input.dirX) > 0.1 || Math.abs(input.dirZ) > 0.1)) {
                this.faceTowards(this.x + input.dirX, this.z + input.dirZ, 0.35);
            }
        }

        // Execute state logic
        switch (this.state) {
            case FIGHTER_STATE.IDLE:
                this.handleIdle(input, opponent, simEvents);
                break;
            case FIGHTER_STATE.WALK:
                this.handleWalk(input, opponent, simEvents);
                break;
            case FIGHTER_STATE.RUN:
                this.handleRun(input, opponent, simEvents);
                break;
            case FIGHTER_STATE.CROUCH:
                this.handleCrouch(input, opponent, simEvents);
                break;
            case FIGHTER_STATE.EVADE:
                this.handleEvade();
                break;
            case FIGHTER_STATE.ATTACK:
                this.handleAttack(input, opponent, simEvents);
                break;
            case FIGHTER_STATE.THROW:
                this.handleThrow(input, simEvents);
                break;
            case FIGHTER_STATE.BEING_THROWN:
                this.handleBeingThrown(input, simEvents);
                break;
            case FIGHTER_STATE.BLOCK:
                this.handleBlock(input);
                break;
            case FIGHTER_STATE.HIT_STUN:
                this.handleHitStun();
                break;
            case FIGHTER_STATE.DIZZY:
                this.handleDizzy();
                break;
            case FIGHTER_STATE.KNOCKED_DOWN:
                this.handleKnockdown(input, simEvents, opponent);
                break;
            case FIGHTER_STATE.WAKEUP:
                this.handleWakeup(input, opponent, simEvents);
                break;
            case FIGHTER_STATE.TECH_RECOVERY:
                this.handleTechRecovery();
                break;
        }

        // Horizontal integration + P5 Step-Up / Ledge-Drop / Ring-Out Elevation Physics
        const nextX = this.x + this.vx * FIXED_DT;
        const nextZ = this.z + this.vz * FIXED_DT;
        const nextFloorY = CollisionSystem.getFloorHeightAt(nextX, nextZ, this.y);

        // If moving horizontally into a higher wall (e.g. on lower catwalk y = -1.8 trying to walk into upper deck wall y = 0 without jumping high enough)
        if (Number.isFinite(nextFloorY) && nextFloorY > this.y + 0.35) {
            // Block horizontal penetration into the higher deck wall
            const onlyXFloor = CollisionSystem.getFloorHeightAt(nextX, this.z, this.y);
            const onlyZFloor = CollisionSystem.getFloorHeightAt(this.x, nextZ, this.y);
            if (!Number.isFinite(onlyXFloor) || onlyXFloor <= this.y + 0.35) {
                this.x = nextX;
            } else {
                this.vx = 0;
            }
            if (!Number.isFinite(onlyZFloor) || onlyZFloor <= this.y + 0.35) {
                this.z = nextZ;
            } else {
                this.vz = 0;
            }
        } else {
            this.x = nextX;
            this.z = nextZ;
        }

        // Clamp within outer simulation bounds
        const bounds = CollisionSystem.getActiveBounds();
        this.x = Math.max(bounds.minX, Math.min(bounds.maxX, this.x));
        this.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, this.z));

        // P7 Sector Environment Obstacles (Sliding collision against cargo crates, consoles, gates)
        CollisionSystem.resolveObstacles(this);

        // Soft wall impact damping in indoor flat mode
        if (CollisionSystem.isIndoor()) {
            if (this.x <= bounds.minX + 0.02 || this.x >= bounds.maxX - 0.02) {
                this.vx = -this.vx * 0.15;
            }
            if (this.z <= bounds.minZ + 0.02 || this.z >= bounds.maxZ - 0.02) {
                this.vz = -this.vz * 0.15;
            }
        }

        const targetFloorY = CollisionSystem.getFloorHeightAt(this.x, this.z, this.y);
        this.floorY = targetFloorY;

        // If fighter was grounded on a higher ledge and stepped/slid off into a lower tier or the abyss:
        if (this.isGrounded && this.y > targetFloorY + 0.08) {
            this.isGrounded = false;
        }

        // Apply vertical gravity, Break-Fall Ukemi, and Fall Damage / Ring-Out checks
        if (!this.isGrounded) {
            const distAboveFloor = Number.isFinite(targetFloorY) ? (this.y - targetFloorY) : Infinity;

            // Break-Fall Tech Recovery check right before hitting a valid floor while falling in KNOCKED_DOWN
            if (
                this.state === FIGHTER_STATE.KNOCKED_DOWN &&
                this.hp > 0 &&
                this.vy < 0 &&
                distAboveFloor <= 0.85 &&
                distAboveFloor >= 0 &&
                input.jumpJustPressed
            ) {
                this.triggerTechRecovery(simEvents);
            } else {
                const impactVy = this.vy;
                this.vy += GRAVITY * FIXED_DT;
                this.y += this.vy * FIXED_DT;

                if (Number.isFinite(targetFloorY) && this.y <= targetFloorY) {
                    this.y = targetFloorY;
                    this.vy = 0;
                    this.isGrounded = true;

                    // P5 Fall Damage: landing from a high launch or dropping off the upper rooftop onto the lower catwalk
                    // (Strictly disabled in indoor mode to ensure zero fall risk!)
                    if (!CollisionSystem.isIndoor() && impactVy < STAGE_CONFIG.FALL_DAMAGE_THRESHOLD_VY && !this.invincible && this.hp > 0) {
                        const excessSpeed = Math.abs(impactVy) - Math.abs(STAGE_CONFIG.FALL_DAMAGE_THRESHOLD_VY);
                        const fallDmg = Math.max(4, Math.round(excessSpeed * STAGE_CONFIG.FALL_DAMAGE_SCALE));
                        const fallPoise = Math.round(excessSpeed * STAGE_CONFIG.FALL_POISE_SCALE);
                        this.hp = Math.max(0, this.hp - fallDmg);
                        this.poise = Math.max(0, this.poise - fallPoise);
                        this.transitionTo(FIGHTER_STATE.KNOCKED_DOWN);
                        this.vx *= 0.35;
                        this.vz *= 0.35;
                        if (simEvents) {
                            simEvents.push({
                                type: 'FALL_DAMAGE',
                                fighter: this.id,
                                damage: fallDmg,
                                x: this.x,
                                y: this.y + 0.2,
                                z: this.z
                            });
                        }
                    } else if (this.state === FIGHTER_STATE.KNOCKED_DOWN) {
                        this.vx *= 0.3;
                        this.vz *= 0.3;
                    }
                } else if (!CollisionSystem.isIndoor() && !this.ringOut && this.y <= STAGE_CONFIG.ABYSS_DEATH_Y) {
                    // P5 Ring-Out into the cyberpunk abyss! (Only outside on Rooftop)
                    this.ringOut = true;
                    this.hp = 0;
                    this.transitionTo(FIGHTER_STATE.DEFEAT);
                    if (simEvents) {
                        simEvents.push({
                            type: 'RING_OUT',
                            fighter: this.id,
                            x: this.x,
                            y: this.y,
                            z: this.z
                        });
                    }
                }
            }
        }

        // Friction when on ground
        if (this.isGrounded) {
            if (
                this.state !== FIGHTER_STATE.WALK &&
                this.state !== FIGHTER_STATE.RUN &&
                this.state !== FIGHTER_STATE.EVADE
            ) {
                this.vx *= 0.78;
                this.vz *= 0.78;
                if (Math.abs(this.vx) < 0.05) this.vx = 0;
                if (Math.abs(this.vz) < 0.05) this.vz = 0;
            }
        }
    }

    /**
     * Compute relative combat context for declarative MOVE_TABLE matching
     */
    /** Oni "release crouch, then P/K": crouch was held in the last few frames and is now released. */
    crouchReleasedRecently(windowFrames = 12) {
        const cur = this.inputBuffer.get(0);
        if (!cur || cur.crouch) return false;
        let held = 0;
        for (let i = 1; i <= windowFrames; i++) {
            const e = this.inputBuffer.get(i);
            if (!e) break;
            if (e.crouch) held++;
        }
        return held >= 3;
    }

    /** Motion input "<dir> then forward" (Willow: BACK, Twister: SIDE) within ~14 frames, relative to facing. */
    recentDirThenForward(kind, windowFrames = 14) {
        const { fx, fz } = this.getForwardVector();
        for (let i = 2; i <= windowFrames; i++) {
            const e = this.inputBuffer.get(i);
            if (!e) break;
            const fwd = e.dirX * fx + e.dirZ * fz;
            const side = e.dirX * -fz + e.dirZ * fx;
            if (kind === 'BACK' && fwd < -0.5) return true;
            if (kind === 'SIDE' && Math.abs(side) > 0.6 && Math.abs(fwd) < 0.4) return true;
        }
        return false;
    }

    /** True while the player steers facing with the mouse (Oni 2001 controls) instead of auto-facing. */
    isAimControlled(input) {
        return !this.isBot && input && input.aimYaw !== null && input.aimYaw !== undefined;
    }

    /**
     * Turn toward the opponent when an attack starts. Legacy controls snap fully; mouse-look
     * controls only get a small melee assist so the attack goes where the player is aiming.
     */
    attackFace(opponent, input, fullTurn = Math.PI) {
        if (!opponent) return;
        if (this.isAimControlled(input || this.inputBuffer.get(0))) {
            const dx = opponent.x - this.x, dz = opponent.z - this.z;
            const d = Math.hypot(dx, dz);
            if (d > 3.0 || d < 1e-3) return;
            const diff = wrapAngle(Math.atan2(dz, dx) - this.facingAngle);
            if (Math.abs(diff) <= 0.6) this.setFacingAngle(Math.atan2(dz, dx));
            return;
        }
        this.faceTowards(opponent.x, opponent.z, fullTurn);
    }

    buildMoveContext(input, opponent) {
        const { fx, fz } = this.getForwardVector();
        const fwdDot = input.dirX * fx + input.dirZ * fz;
        const holdingBack = fwdDot < -0.35;
        const holdingForward = fwdDot > 0.35;
        const sideDot = input.dirX * -fz + input.dirZ * fx;
        const holdingSide = Math.abs(sideDot) > 0.55 && Math.abs(fwdDot) < 0.45;

        let dist = Infinity;
        let sector = 'FRONT';
        let canBeThrown = false;
        let oppDizzy = false;

        if (opponent) {
            dist = Math.hypot(opponent.x - this.x, opponent.z - this.z);
            sector = CollisionSystem.getRelativeSector(opponent, this);
            oppDizzy = opponent.state === FIGHTER_STATE.DIZZY || opponent.state === FIGHTER_STATE.HIT_STUN;
            canBeThrown =
                opponent.isGrounded &&
                opponent.hp > 0 &&
                !opponent.invincible &&
                opponent.state !== FIGHTER_STATE.KNOCKED_DOWN &&
                opponent.state !== FIGHTER_STATE.WAKEUP &&
                opponent.state !== FIGHTER_STATE.TECH_RECOVERY &&
                opponent.state !== FIGHTER_STATE.EVADE &&
                opponent.state !== FIGHTER_STATE.BEING_THROWN;
        }

        return {
            fx,
            fz,
            fwdDot,
            holdingBack,
            holdingForward,
            holdingSide,
            oppArmed: !!(opponent && opponent.weapon),
            dist,
            sector,
            canBeThrown,
            oppDizzy
        };
    }

    /**
     * Evaluate declarative MOVE_TABLE and start the highest-priority valid move
     */
    tryStartMoveFromTable(input, opponent, simEvents) {
        const ctx = this.buildMoveContext(input, opponent);

        for (const entry of MOVE_TABLE) {
            if (!this.unlockedMoves.has(entry.id)) continue;
            if (!entry.states.includes(this.state)) continue;

            // Check button trigger (with 10-frame Pre-Buffer so taps right before recovery ends never drop)
            let triggered = false;
            if (entry.button === 'crouch') {
                triggered = this.inputBuffer.wasRecentlyPressed('crouch', 10) || !!input.crouch;
            } else {
                triggered = this.inputBuffer.wasRecentlyPressed(entry.button, 10);
            }

            if (!triggered) continue;

            if (entry.condition(this, input, opponent, ctx)) {
                let move = MOVES[entry.id];
                if (!move) continue;

                // Consume the buffered button press so a single tap doesn't re-trigger after the move
                this.inputBuffer.consumeBufferedButton(entry.button, 12);

                // Adapt FIRE_WEAPON frame data to the equipped weapon's spec
                if (move.id === 'FIRE_WEAPON' && this.weapon) {
                    const spec = WEAPON_SPECS[this.weapon.type] || WEAPON_SPECS.TCTF_PISTOL;
                    move = {
                        ...move,
                        name: spec.name,
                        startup: spec.startup,
                        active: spec.active,
                        recovery: spec.recovery,
                        weaponSpec: spec
                    };
                }

                // Stepping Disarm (Ch.13): the front kick throw strips an armed opponent's weapon
                if (move.id === 'THROW_FRONT_K' && this.canSteppingDisarm && opponent && opponent.weapon) {
                    move = { ...move, name: '踏步缴械 Stepping Disarm (近身 前+K)', disarms: true };
                }

                if (move.isThrow && opponent) {
                    this.startThrow(move, opponent, simEvents);
                } else {
                    this.attackFace(opponent, input);
                    this.transitionTo(FIGHTER_STATE.ATTACK, move);
                    if (move.noHit) {
                        // pure movement (jump flip): keep momentum, no lunge
                    } else {
                        this.applyMagneticCombatLunge(move, opponent, ctx);
                    }
                }
                return true;
            }
        }
        return false;
    }

    /**
     * Oni / Sifu style Magnetic Combat Lunge & Soft Z-Axis Auto-Align:
     * When launching a melee strike at mid-close range (0.95m .. 2.75m), smoothly
     * step into range and align Z so strikes connect reliably instead of whiffing by inches.
     */
    applyMagneticCombatLunge(move, opponent, ctx) {
        if (!move || !opponent || move.isFirearmMove || move.isWeaponThrow || move.isHealMove || move.isDaodanBurst) {
            return;
        }
        const dx = opponent.x - this.x;
        const dz = opponent.z - this.z;
        const dist = ctx ? ctx.dist : Math.hypot(dx, dz);
        if (dist < 0.05 || dist > 2.85) return;

        const { fx, fz } = this.getForwardVector();
        const idealDist = 0.92;
        const gap = Math.max(0, dist - idealDist);

        // Compute adaptive forward lunge impulse when outside point-blank range
        if (gap > 0.08 && dist <= 2.75) {
            const lungeBoost = Math.min(6.2, 2.2 + gap * 2.4);
            if (Math.hypot(this.vx, this.vz) < lungeBoost) {
                this.vx = fx * lungeBoost;
                this.vz = fz * lungeBoost;
            }
        }

        // Soft Z-axis lateral alignment so 3D depth misalignment doesn't cause frustrating whiffs
        if (Math.abs(dz) > 0.06 && Math.abs(dz) < 1.35 && dist < 2.65) {
            this.vz += Math.max(-2.4, Math.min(2.4, dz * 2.8));
        }
    }

    /**
     * Initiate a synchronized grab/throw on `opponent`
     */
    startThrow(move, opponent, simEvents) {
        this.faceTowards(opponent.x, opponent.z, Math.PI);
        const { fx, fz } = this.getForwardVector();

        this.transitionTo(FIGHTER_STATE.THROW, move);
        this.throwTarget = opponent;
        this.vx = 0;
        this.vz = 0;

        opponent.transitionTo(FIGHTER_STATE.BEING_THROWN, move);
        opponent.thrownBy = this;
        opponent.vx = 0;
        opponent.vz = 0;
        // Snap defender to grapple socket in front of attacker
        opponent.x = this.x + fx * 0.75;
        opponent.z = this.z + fz * 0.75;
        if (move.id === 'THROW_BACK' || move.id === 'BACKBREAKER') {
            opponent.setFacingAngle(this.facingAngle);
        } else {
            opponent.setFacingAngle(this.facingAngle + Math.PI);
        }

        if (simEvents) {
            simEvents.push({
                type: 'THROW_START',
                attacker: this.id,
                defender: opponent.id,
                moveId: move.id
            });
        }
    }

    /**
     * Check double-tap omnidirectional evasion (Backflip / Side Cartwheel) or dedicated Evade button
     */
    tryStartEvade(input, simEvents) {
        if (!this.isGrounded) return false;
        const { fx, fz } = this.getForwardVector();
        const fwdDot = input ? (input.dirX * fx + input.dirZ * fz) : 0;
        let evadeDir = this.inputBuffer.checkDoubleTapEvade(fx, fz);
        // When holding forward + pressing Evade button, defer to MOVE_TABLE so it executes Oni's SLIDE_KICK!
        if (!evadeDir && input && fwdDot <= 0.35 && this.inputBuffer.wasRecentlyPressed('evade', 10)) {
            this.inputBuffer.consumeBufferedButton('evade', 12);
            const sideDot = -input.dirX * fz + input.dirZ * fx;
            if (sideDot > 0.45) evadeDir = 'RIGHT';
            else if (sideDot < -0.45) evadeDir = 'LEFT';
            else evadeDir = 'BACK';
        }
        if (!evadeDir) return false;

        this.evadeDir = evadeDir;
        this.transitionTo(FIGHTER_STATE.EVADE);
        this.invincible = true;

        const speed = MOVE_SPEED.EVADE_IMPULSE;
        if (evadeDir === 'FORWARD') {
            this.vx = fx * speed * 0.9;
            this.vz = fz * speed * 0.9;
        } else if (evadeDir === 'BACK') {
            this.vx = -fx * speed;
            this.vz = -fz * speed;
        } else if (evadeDir === 'RIGHT') {
            this.vx = -fz * speed * 0.85;
            this.vz = fx * speed * 0.85;
        } else if (evadeDir === 'LEFT') {
            this.vx = fz * speed * 0.85;
            this.vz = -fx * speed * 0.85;
        }

        if (simEvents) {
            simEvents.push({
                type: 'EVADE',
                fighter: this.id,
                direction: evadeDir
            });
        }
        return true;
    }

    /**
     * Oni "Escape": press crouch while moving in any direction -> roll that way (i-frames).
     * Forward while running stays the slide (MOVE_TABLE).
     */
    tryEscapeRoll(input, simEvents) {
        if (!this.isGrounded || !input || !input.crouchJustPressed) return false;
        if (Math.hypot(input.dirX, input.dirZ) < 0.5) return false;
        const { fx, fz } = this.getForwardVector();
        const fwd = input.dirX * fx + input.dirZ * fz;
        const side = input.dirX * -fz + input.dirZ * fx;
        let dir;
        if (Math.abs(side) > Math.abs(fwd)) dir = side > 0 ? 'RIGHT' : 'LEFT';
        else dir = fwd >= 0 ? 'FORWARD' : 'BACK';
        this.inputBuffer.consumeBufferedButton('crouch', 12);
        this.evadeDir = dir;
        this.transitionTo(FIGHTER_STATE.EVADE);
        this.invincible = true;
        const speed = MOVE_SPEED.EVADE_IMPULSE * 0.9;
        const vx = dir === 'FORWARD' ? fx : dir === 'BACK' ? -fx : dir === 'RIGHT' ? -fz : fz;
        const vz = dir === 'FORWARD' ? fz : dir === 'BACK' ? -fz : dir === 'RIGHT' ? fx : -fx;
        this.vx = vx * speed;
        this.vz = vz * speed;
        if (simEvents) simEvents.push({ type: 'EVADE', fighter: this.id, direction: dir, escape: true });
        return true;
    }

    handleIdle(input, opponent, simEvents) {
        const { fx, fz } = this.getForwardVector();
        const fwdDot = input.dirX * fx + input.dirZ * fz;

        // Oni-style auto-guard on button OR while holding back
        // Campaign minions never get the free back-walk guard (only an explicit AI block roll)
        this.isBlocking = input.block || (!this.isMinion && fwdDot < -0.35);

        // 1. Check Omnidirectional Evade (Backflip / Cartwheel)
        if (this.tryStartEvade(input, simEvents)) return;

        // 2. Check Declarative Move Table (Throws, Specials, Attacks)
        if (this.tryStartMoveFromTable(input, opponent, simEvents)) {
            return;
        }

        // 3. Check Crouch
        if (input.crouch && this.isGrounded) {
            this.transitionTo(FIGHTER_STATE.CROUCH);
            return;
        }

        // 4. Check Jump (Apply horizontal momentum from directional input for dynamic forward/lateral jumps)
        if ((input.jump || this.inputBuffer.wasRecentlyPressed('jump', 8)) && this.isGrounded) {
            this.inputBuffer.consumeBufferedButton('jump', 10);
            this.vy = 12.2;
            this.isGrounded = false;
            const speedMult = (this.daodanOverdrive ? 1.18 : 1.0) * (this.speedScale || 1.0) * (this.aiSpeedMult || 1.0);
            if (Math.abs(input.dirX) > 0.1 || Math.abs(input.dirZ) > 0.1) {
                this.vx = input.dirX * Math.max(4.5, MOVE_SPEED.WALK_FORWARD * 1.75) * speedMult;
                this.vz = input.dirZ * Math.max(3.8, MOVE_SPEED.WALK_FORWARD * 1.45) * speedMult;
            }
            return;
        }

        // 5. Check Forward Dash (double-tap forward, or touch-joystick double-tap via dashTimer)
        if (
            this.inputBuffer.checkDashForward(fx, 18, fz) ||
            (this.dashTimer > 0 && fwdDot > 0.35)
        ) {
            this.dashTimer = 0;
            this.transitionTo(FIGHTER_STATE.RUN);
            return;
        }

        // 6. Check Walk
        if (Math.abs(input.dirX) > 0.1 || Math.abs(input.dirZ) > 0.1) {
            this.transitionTo(FIGHTER_STATE.WALK);
        }
    }

    handleWalk(input, opponent, simEvents) {
        const { fx, fz } = this.getForwardVector();
        const rx = -fz, rz = fx;
        const fwdDot = input.dirX * fx + input.dirZ * fz;
        const sideDot = input.dirX * rx + input.dirZ * rz;

        // Oni-style auto-guard while walking backward or holding block
        this.isBlocking = input.block || (!this.isMinion && fwdDot < -0.25);

        if (this.tryStartEvade(input, simEvents)) return;

        if (this.tryStartMoveFromTable(input, opponent, simEvents)) {
            return;
        }

        if (this.tryEscapeRoll(input, simEvents)) return;

        if (input.crouch && this.isGrounded) {
            this.vx = 0;
            this.vz = 0;
            this.transitionTo(FIGHTER_STATE.CROUCH);
            return;
        }

        if ((input.jump || this.inputBuffer.wasRecentlyPressed('jump', 8)) && this.isGrounded) {
            this.inputBuffer.consumeBufferedButton('jump', 10);
            this.vy = 12.2;
            this.isGrounded = false;
            const speedMult = (this.daodanOverdrive ? 1.18 : 1.0) * (this.speedScale || 1.0) * (this.aiSpeedMult || 1.0);
            this.vx = input.dirX * Math.max(4.5, MOVE_SPEED.WALK_FORWARD * 1.75) * speedMult;
            this.vz = input.dirZ * Math.max(3.8, MOVE_SPEED.WALK_FORWARD * 1.45) * speedMult;
            return;
        }

        if (
            this.inputBuffer.checkDashForward(fx, 18, fz) ||
            (this.dashTimer > 0 && fwdDot > 0.35)
        ) {
            this.dashTimer = 0;
            this.transitionTo(FIGHTER_STATE.RUN);
            return;
        }

        const dirMag = Math.hypot(input.dirX, input.dirZ);

        // Oni: away from enemies a held forward direction breaks into a run; back-walk must NEVER auto-run!
        const foeNear = opponent && opponent.hp > 0 && Math.hypot(opponent.x - this.x, opponent.z - this.z) < 6.0;
        const aimRun = this.isAimControlled(input) && !input.walk && fwdDot > 0.6;
        if (!this.isBot && !input.walk && !input.block && dirMag > 0.6 && fwdDot > 0.35 && (aimRun || !foeNear)) {
            this.autoRunFrames = (this.autoRunFrames || 0) + 1;
            if (this.autoRunFrames >= 14) {
                this.autoRunFrames = 0;
                this.transitionTo(FIGHTER_STATE.RUN);
                return;
            }
        } else {
            this.autoRunFrames = 0;
        }

        if (dirMag < 0.1) {
            this.vx *= 0.55;
            this.vz *= 0.55;
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        const nx = input.dirX / Math.max(1.0, dirMag);
        const nz = input.dirZ / Math.max(1.0, dirMag);
        const speedMult = (this.daodanOverdrive ? 1.18 : 1.0) * (this.speedScale || 1.0) * (this.aiSpeedMult || 1.0);

        // Oni 2001 Soft Target Strafe & directional speed profile:
        // When in close/mid combat range (< 5.2m), decompose stick along the opponent's radial vector (tx, tz)
        // and tangential orbit vector (-tz, tx) so pushing up/down smoothly circle-strafes around the opponent!
        let targetVx;
        let targetVz;
        const distToOpp = opponent ? Math.hypot(opponent.x - this.x, opponent.z - this.z) : Infinity;
        this.inCombatRange = distToOpp < 5.2;   // render hint: keep the guard up while walking near a foe

        if (!this.isAimControlled(input) && opponent && distToOpp > 0.15 && distToOpp < 5.2) {
            const tx = (opponent.x - this.x) / distToOpp;
            const tz = (opponent.z - this.z) / distToOpp;
            const tanX = -tz;
            const tanZ = tx;
            const radialDot = nx * tx + nz * tz;
            const tangentDot = nx * tanX + nz * tanZ;

            const radialSpeed = radialDot >= 0 ? MOVE_SPEED.WALK_FORWARD : MOVE_SPEED.WALK_BACK;
            const orbitSpeed = MOVE_SPEED.WALK_FORWARD * 0.9;

            targetVx = (tx * radialDot * radialSpeed + tanX * tangentDot * orbitSpeed) * speedMult;
            targetVz = (tz * radialDot * radialSpeed + tanZ * tangentDot * orbitSpeed) * speedMult;
        } else {
            let baseSpeed;
            if (Math.abs(sideDot) > Math.abs(fwdDot) * 1.15) {
                baseSpeed = MOVE_SPEED.WALK_FORWARD * 0.88;
            } else if (fwdDot >= 0) {
                baseSpeed = MOVE_SPEED.WALK_FORWARD;
            } else {
                baseSpeed = MOVE_SPEED.WALK_BACK;
            }
            targetVx = nx * baseSpeed * speedMult;
            targetVz = nz * baseSpeed * speedMult;
        }

        // Smooth athletic acceleration (eliminates robotic instant velocity snapping)
        this.vx += (targetVx - this.vx) * 0.35;
        this.vz += (targetVz - this.vz) * 0.35;
    }

    handleRun(input, opponent, simEvents) {
        // Check running moves from declarative table (Slide Kick, Flying Kick, Dash Punch, Run Throw)
        if (this.tryStartMoveFromTable(input, opponent, simEvents)) {
            return;
        }

        if (input.jump && this.isGrounded) {
            this.vy = 12.6;
            this.isGrounded = false;
            return;
        }

        const dirMag = Math.hypot(input.dirX, input.dirZ);
        if (dirMag < 0.15) {
            this.vx *= 0.6;
            this.vz *= 0.6;
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        if (this.isAimControlled(input)) {
            const { fx: afx, fz: afz } = this.getForwardVector();
            if (input.dirX * afx + input.dirZ * afz < 0.3) {
                this.transitionTo(FIGHTER_STATE.WALK);
                return;
            }
        } else if (dirMag > 0.25) { // Agile 360-degree running steering
            const desired = Math.atan2(input.dirZ, input.dirX);
            const diff = wrapAngle(desired - this.facingAngle);
            const maxTurn = 0.24; // ~14 deg per tick, fluid responsive carving
            if (Math.abs(diff) <= maxTurn) {
                this.setFacingAngle(desired);
            } else {
                this.setFacingAngle(this.facingAngle + Math.sign(diff) * maxTurn);
            }
        }

        const { fx, fz } = this.getForwardVector();
        const runSpd = MOVE_SPEED.RUN * (this.daodanOverdrive ? 1.18 : 1.0) * (this.speedScale || 1.0) * (this.aiSpeedMult || 1.0);
        this.vx = fx * runSpd;
        this.vz = fz * runSpd;
    }

    handleCrouch(input, opponent, simEvents) {
        this.isBlocking = input.block;

        if (this.tryStartMoveFromTable(input, opponent, simEvents)) {
            return;
        }

        if (input.jump && this.isGrounded) {
            this.vy = 12.8; // High jump from crouch
            this.isGrounded = false;
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        if (!input.crouch) {
            this.vx = 0;
            this.vz = 0;
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        // Tactical silent crouch-sneak
        if (input && (input.dirX !== 0 || input.dirZ !== 0)) {
            const len = Math.hypot(input.dirX, input.dirZ);
            if (len > 0.1) {
                const sneakSpeed = 1.25;
                this.vx = (input.dirX / len) * sneakSpeed;
                this.vz = (input.dirZ / len) * sneakSpeed;
                if (!this.isAimControlled(input)) this.setFacingAngle(Math.atan2(input.dirZ, input.dirX));
            } else {
                this.vx = 0;
                this.vz = 0;
            }
        } else {
            this.vx = 0;
            this.vz = 0;
        }
    }

    handleEvade() {
        // Frames 1..12 have complete I-frames
        this.invincible = this.stateTimer <= 12;
        if (this.stateTimer > 12) {
            this.vx *= 0.82;
            this.vz *= 0.82;
        }
        if (this.stateTimer >= 18) {
            this.invincible = false;
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    handleAttack(input, opponent, simEvents) {
        const move = this.currentMove;
        if (!move) {
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        const totalFrames = move.startup + move.active + move.recovery;
        const startCancel = move.cancelWindowStart || (move.startup + 1);

        if (move.invulnFrames) {
            this.invincible = this.stateTimer < move.invulnFrames;
        }

        // P2 Firearm Discharge, Weapon Throw, P3 Hypo-Spray Heal, or P4 Daodan Overdrive Burst on first active frame
        if (this.stateTimer === move.startup) {
            if (move.isDaodanBurst && !this.daodanOverdrive) {
                this.activateDaodanOverdrive(simEvents);
            } else if (move.isHealMove && !this.hasHitThisMove && this.hypoCount > 0) {
                this.hasHitThisMove = true;
                this.hypoCount = Math.max(0, this.hypoCount - 1);
                if (this.hp >= this.maxHp) {
                    this.activateDaodanOverpower(simEvents);
                } else {
                    const healAmt = move.healAmount || DAODAN_CONFIG.HYPO_HEAL_AMOUNT;
                    const oldHp = this.hp;
                    this.hp = Math.min(this.maxHp, this.hp + healAmt);
                    this.poise = this.maxPoise;
                    this.gainDaodan(20, simEvents);
                    if (simEvents) {
                        simEvents.push({
                            type: 'HYPO_HEAL',
                            fighter: this.id,
                            healed: Math.round(this.hp - oldHp),
                            hypoLeft: this.hypoCount,
                            x: this.x,
                            y: this.y + 1.15,
                            z: this.z
                        });
                    }
                }
            } else if (!this.hasHitThisMove && move.isFirearmMove && this.weapon && this.weapon.ammo > 0) {
                this.hasHitThisMove = true;
                this.weapon.ammo = Math.max(0, this.weapon.ammo - 1);
                if (!this.isAimControlled(input)) { if (opponent) this.faceTowards(opponent.x, opponent.z, Math.PI); }
                if (simEvents) {
                    simEvents.push({
                        type: 'WEAPON_FIRE_REQUEST',
                        attacker: this.id,
                        weaponType: this.weapon.type,
                        ammoLeft: this.weapon.ammo
                    });
                }
            } else if (!this.hasHitThisMove && move.isWeaponThrow && this.weapon) {
                this.hasHitThisMove = true;
                const thrownWpn = this.unequipWeapon();
                if (!this.isAimControlled(input)) { if (opponent) this.faceTowards(opponent.x, opponent.z, Math.PI); }
                if (simEvents && thrownWpn) {
                    simEvents.push({
                        type: 'WEAPON_THROW_REQUEST',
                        attacker: this.id,
                        weapon: thrownWpn,
                        move
                    });
                }
            }
        }

        // 1. Animation Cancel during recovery window (Evade, Jump, Slide, Special, Throw, or Dash/Walk Cancel)
        const activeEnd = move.startup + move.active;
        if (this.stateTimer >= activeEnd) {
            if (this.tryStartEvade(input, simEvents)) return;

            // Allow Jump-Cancel during recovery for fluid aerial follow-ups
            if ((input.jumpJustPressed || this.inputBuffer.wasRecentlyPressed('jump', 8)) && this.isGrounded) {
                this.inputBuffer.consumeBufferedButton('jump', 10);
                this.vy = 12.2;
                this.isGrounded = false;
                this.transitionTo(FIGHTER_STATE.IDLE);
                return;
            }

            // Allow Slide / Special / Throw / Heal / Daodan cancel during recovery
            if (
                this.inputBuffer.wasRecentlyPressed('special', 8) ||
                this.inputBuffer.wasRecentlyPressed('slide', 8) ||
                this.inputBuffer.wasRecentlyPressed('throw', 8) ||
                this.inputBuffer.wasRecentlyPressed('daodan', 8) ||
                this.inputBuffer.wasRecentlyPressed('heal', 8)
            ) {
                const prevState = this.state;
                this.state = FIGHTER_STATE.IDLE;
                if (this.tryStartMoveFromTable(input, opponent, simEvents)) {
                    return;
                }
                this.state = prevState;
            }

            // Early Walk/Block Cancel in the late recovery frames (last 35% of recovery) so movement never feels stuck in mud
            const lateRecoveryStart = activeEnd + Math.max(2, Math.floor(move.recovery * 0.65));
            if (this.stateTimer >= lateRecoveryStart && this.isGrounded) {
                if (input.block) {
                    this.transitionTo(FIGHTER_STATE.IDLE);
                    this.isBlocking = true;
                    return;
                }
                if (Math.hypot(input.dirX, input.dirZ) > 0.25) {
                    this.transitionTo(FIGHTER_STATE.WALK);
                    return;
                }
            }
        }

        // 2a. Oni string table: explicit per-button follow-ups. A button the chain names never
        //     falls back to the generic cancel list (locked follow-ups simply end the string).
        let chainHandled = false;
        if (move.chain && !this.bufferedMove && this.stateTimer >= startCancel) {
            const pick = (id) => (id && MOVES[id] && this.unlockedMoves.has(id) ? MOVES[id] : null);
            if (move.chain.P && this.inputBuffer.wasRecentlyPressed('punch', 8)) {
                chainHandled = true;
                this.bufferedMove = pick(move.chain.P);
                this.inputBuffer.consumeBufferedButton('punch', 10);
            } else if ((move.chain.K || move.chain.KF) && this.inputBuffer.wasRecentlyPressed('kick', 8)) {
                chainHandled = true;
                const ctx = this.buildMoveContext(input, opponent);
                this.bufferedMove = (ctx.holdingForward && pick(move.chain.KF)) || pick(move.chain.K);
                this.inputBuffer.consumeBufferedButton('kick', 10);
            }
        }

        // 2. Combo Buffer / Cancel Window Check
        if (!chainHandled && !this.bufferedMove && move.cancelTo && move.cancelTo.length > 0 && this.stateTimer >= startCancel) {
            if (this.inputBuffer.wasRecentlyPressed('punch', 8)) {
                if (move.cancelTo.includes('UPPERCUT') && this.inputBuffer.checkUppercut(this.facing)) {
                    this.bufferedMove = MOVES.UPPERCUT;
                } else {
                    for (const candidateKey of move.cancelTo) {
                        if ((candidateKey.startsWith('PUNCH') || candidateKey === 'UPPERCUT') && this.unlockedMoves.has(candidateKey)) {
                            this.bufferedMove = MOVES[candidateKey];
                            break;
                        }
                    }
                }
                if (this.bufferedMove) this.inputBuffer.consumeBufferedButton('punch', 10);
            } else if (this.inputBuffer.wasRecentlyPressed('kick', 8)) {
                if (move.cancelTo.includes('RISING_FURY') && this.inputBuffer.checkRisingFury()) {
                    this.bufferedMove = MOVES.RISING_FURY;
                } else {
                    for (const candidateKey of move.cancelTo) {
                        if ((candidateKey.startsWith('KICK') || candidateKey === 'COMBO_PUNCH_KICK' || candidateKey === 'RISING_FURY') && this.unlockedMoves.has(candidateKey)) {
                            this.bufferedMove = MOVES[candidateKey];
                            break;
                        }
                    }
                }
                if (this.bufferedMove) this.inputBuffer.consumeBufferedButton('kick', 10);
            } else if (this.inputBuffer.wasRecentlyPressed('special', 8)) {
                this.bufferedMove = (this.daodanStage >= 3 || this.daodanOverdrive)
                    ? MOVES.DEVIL_SPIN_KICK
                    : MOVES.UPPERCUT;
                this.inputBuffer.consumeBufferedButton('special', 10);
            }
        }

        // Did active window finish and can execute buffered move?
        if (this.stateTimer >= activeEnd && this.bufferedMove) {
            const nextMove = this.bufferedMove;
            this.attackFace(opponent, input, 0.65);
            this.transitionTo(FIGHTER_STATE.ATTACK, nextMove);
            const ctx = this.buildMoveContext(input, opponent);
            this.applyMagneticCombatLunge(nextMove, opponent, ctx);
            return;
        }

        // Finished entire move recovery
        if (this.stateTimer >= totalFrames) {
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    handleThrow(input, simEvents) {
        const move = this.currentMove;
        const target = this.throwTarget;
        if (!move || !target || target.state !== FIGHTER_STATE.BEING_THROWN) {
            this.throwTarget = null;
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        this.invincible = true;
        const releaseFrame = move.releaseFrame || (move.startup + Math.floor(move.active * 0.7));
        const totalFrames = move.startup + move.active + move.recovery;

        // Dynamic synchronized grapple positioning throughout windup/lift
        if (this.stateTimer < releaseFrame) {
            const { fx, fz } = this.getForwardVector();
            const rx = -fz, rz = fx;
            const progress = this.stateTimer / Math.max(1, releaseFrame);

            if (move.id === 'THROW_FRONT') {
                if (progress < 0.4) {
                    const t = progress / 0.4;
                    target.x = this.x + fx * (0.75 - t * 0.15);
                    target.z = this.z + fz * (0.75 - t * 0.15);
                    target.y = this.y + t * 0.35;
                } else if (progress < 0.75) {
                    const t = (progress - 0.4) / 0.35;
                    target.x = this.x + fx * (0.60 - t * 0.35);
                    target.z = this.z + fz * (0.60 - t * 0.35);
                    target.y = this.y + 0.35 + t * 0.55;
                } else {
                    const t = (progress - 0.75) / 0.25;
                    target.x = this.x + fx * (0.25 + t * 0.95);
                    target.z = this.z + fz * (0.25 + t * 0.95);
                    target.y = this.y + Math.max(0, 0.9 * (1.0 - t));
                }
                target.setFacingAngle(this.facingAngle + Math.PI);
            } else if (move.id === 'THROW_BACK') {
                if (progress < 0.45) {
                    const t = progress / 0.45;
                    target.x = this.x + fx * (0.50 - t * 0.1);
                    target.z = this.z + fz * (0.50 - t * 0.1);
                    target.y = this.y + t * 0.45;
                } else if (progress < 0.75) {
                    const t = (progress - 0.45) / 0.3;
                    target.x = this.x + fx * (0.40 - t * 0.9);
                    target.z = this.z + fz * (0.40 - t * 0.9);
                    target.y = this.y + 0.45 + t * 0.45;
                } else {
                    const t = (progress - 0.75) / 0.25;
                    target.x = this.x - fx * (0.50 + t * 0.45);
                    target.z = this.z - fz * (0.50 + t * 0.45);
                    target.y = this.y + Math.max(0, 0.9 * (1.0 - t));
                }
                target.setFacingAngle(this.facingAngle);
            } else if (move.id === 'THROW_FRONT_K') {
                // hop up, scissor the head with the legs and flip the opponent over forward
                const flip = Math.min(1, progress * 1.15);
                target.x = this.x + fx * (0.7 + flip * 0.35);
                target.z = this.z + fz * (0.7 + flip * 0.35);
                target.y = this.y + Math.sin(flip * Math.PI) * 0.75;
                target.setFacingAngle(this.facingAngle + Math.PI);
            } else if (move.id === 'BACKBREAKER') {
                // hoist from behind, then drop the opponent's back across the raised knee
                if (progress < 0.6) {
                    const t = progress / 0.6;
                    target.x = this.x + fx * (0.55 - t * 0.2);
                    target.z = this.z + fz * (0.55 - t * 0.2);
                    target.y = this.y + t * 0.95;
                } else {
                    const t = (progress - 0.6) / 0.4;
                    target.x = this.x + fx * 0.35;
                    target.z = this.z + fz * 0.35;
                    target.y = this.y + 0.95 - t * 0.45;
                }
                target.setFacingAngle(this.facingAngle);
            } else if (move.id === 'THROW_RUN') {
                const spinAngle = progress * Math.PI * 2;
                target.x = this.x + fx * 0.65 + rx * Math.sin(spinAngle) * 0.3;
                target.z = this.z + fz * 0.65 + rz * Math.sin(spinAngle) * 0.3;
                target.y = this.y + Math.sin(progress * Math.PI) * 0.55;
                target.setFacingAngle(this.facingAngle + spinAngle);
            }
        }

        if (this.stateTimer === releaseFrame && !this.hasHitThisMove) {
            this.hasHitThisMove = true;
            this.comboCount++;
            this.comboResetTimer = 65;

            const isStealth = (target.isAlerted === false);
            const { fx, fz } = this.getForwardVector();
            target.hp = Math.max(0, target.hp - move.damage);
            target.poise = this.maxPoise;
            target.thrownBy = null;
            target.transitionTo(FIGHTER_STATE.KNOCKED_DOWN);
            target.vx = fx * (move.knockback.x || 4.0);
            target.vz = fz * (move.knockback.x || 4.0);
            target.vy = move.knockback.y || 3.8;
            target.isGrounded = false;

            if (simEvents) {
                if (isStealth) {
                    simEvents.push({
                        type: 'STEALTH_CRIT',
                        attacker: this.id,
                        defender: target.id,
                        damage: move.damage,
                        text: `STEALTH TAKEDOWN! ${move.name} 伏击暗杀 (+50 EXP)`
                    });
                }

                simEvents.push({
                    type: 'HIT',
                    attacker: this.id,
                    defender: target.id,
                    hitPoint: { x: target.x, y: target.y + 1.0, z: target.z },
                    move,
                    damage: move.damage,
                    blocked: false,
                    combo: this.comboCount,
                    knockdown: true,
                    isThrow: true
                });

                // Oni Collateral Body Splash: slamming an opponent sends a shockwave that bowls over adjacent enemies
                simEvents.push({
                    type: 'COLLATERAL_SPLASH',
                    attacker: this.id,
                    thrownFighter: target.id,
                    x: target.x,
                    y: target.y,
                    z: target.z,
                    radius: 2.8,
                    damage: Math.max(14, Math.round(move.damage * 0.75))
                });
            }
        }

        if (this.stateTimer >= totalFrames) {
            this.invincible = false;
            this.throwTarget = null;
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    handleBeingThrown(input, simEvents) {
        const attacker = this.thrownBy;
        const move = this.currentMove;
        if (!attacker || attacker.state !== FIGHTER_STATE.THROW || !move) {
            this.thrownBy = null;
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        // Throw Tech (拆投): during first THROW_TECH_WINDOW frames of a techable throw,
        // pressing Throw or Punch breaks the grab and pushes both fighters apart!
        if (
            move.techable &&
            this.stateTimer <= THROW_TECH_WINDOW &&
            (this.inputBuffer.wasRecentlyPressed('throw', 8) || this.inputBuffer.wasRecentlyPressed('punch', 8))
        ) {
            this.inputBuffer.consumeBufferedButton('throw', 10);
            this.inputBuffer.consumeBufferedButton('punch', 10);
            const { fx, fz } = attacker.getForwardVector();
            attacker.invincible = false;
            attacker.throwTarget = null;
            attacker.transitionTo(FIGHTER_STATE.IDLE);
            attacker.vx = -fx * 5.0;
            attacker.vz = -fz * 5.0;

            this.thrownBy = null;
            this.poise = Math.max(40, this.poise);
            this.transitionTo(FIGHTER_STATE.IDLE);
            this.vx = fx * 5.0;
            this.vz = fz * 5.0;

            if (simEvents) {
                simEvents.push({
                    type: 'THROW_TECH',
                    defender: this.id,
                    attacker: attacker.id,
                    x: (this.x + attacker.x) * 0.5,
                    y: this.y + 1.1,
                    z: (this.z + attacker.z) * 0.5
                });
            }
        }
    }

    handleBlock(input) {
        if (this.stateTimer >= this.hitStunDuration && !input.block) {
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
                this.antiGankTimer = 24; // 24 frames of anti-stun-lock grace
                this.transitionTo(FIGHTER_STATE.IDLE);
            }
        }
    }

    handleDizzy() {
        if (this.stateTimer >= POISE_CONFIG.DIZZY_DURATION) {
            this.poise = this.maxPoise;
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    handleKnockdown(input, simEvents, opponent = null) {
        // Allow Break-Fall Tech Recovery if player presses Jump within first 10 frames of hitting the ground
        if (
            this.isGrounded &&
            this.hp > 0 &&
            this.stateTimer <= TECH_RECOVERY_WINDOW &&
            input &&
            (input.jumpJustPressed || this.inputBuffer.wasRecentlyPressed('jump', 10))
        ) {
            this.inputBuffer.consumeBufferedButton('jump', 12);
            this.triggerTechRecovery(simEvents);
            return;
        }

        // Get-up attack (P/K while lying on the floor, after the landing settles)
        if (this.stateTimer >= 16 && this.isGrounded && this.hp > 0 && this.tryStartMoveFromTable(input, opponent, simEvents)) {
            return;
        }

        if (this.stateTimer >= 35 && this.isGrounded) {
            if (this.hp <= 0) {
                this.transitionTo(FIGHTER_STATE.DEFEAT);
            } else {
                this.transitionTo(FIGHTER_STATE.WAKEUP);
            }
        }
    }

    triggerTechRecovery(simEvents) {
        const { fx, fz } = this.getForwardVector();
        this.transitionTo(FIGHTER_STATE.TECH_RECOVERY);
        this.invincible = true;
        this.poise = this.maxPoise;
        this.vy = 6.5;
        this.vx = -fx * 5.5;
        this.vz = -fz * 5.5;
        this.isGrounded = false;

        if (simEvents) {
            simEvents.push({
                type: 'TECH_RECOVERY',
                fighter: this.id,
                x: this.x,
                y: this.y + 0.5,
                z: this.z
            });
        }
    }

    handleWakeup(input, opponent, simEvents) {
        this.invincible = true;
        if (input && this.tryStartMoveFromTable(input, opponent, simEvents)) return;
        if (this.stateTimer >= 22) {
            this.invincible = false;
            this.antiGankTimer = 20; // 20 frames anti-stun-lock grace after waking up
            this.poise = this.maxPoise;
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    handleTechRecovery() {
        this.invincible = true;
        if (this.stateTimer >= 16 && this.isGrounded) {
            this.invincible = false;
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    /**
     * Receive hit event from collision system
     * Handles Chip Damage, Hyper-Armor / Poise Break -> DIZZY, Knockdown, and Airborne Juggling.
     */
    takeHit(hitInfo, attackerFacingOrFighter) {
        const move = hitInfo.move;
        let fx = 1;
        let fz = 0;
        let dmgMult = 1.0;
        if (typeof attackerFacingOrFighter === 'object' && attackerFacingOrFighter !== null) {
            const vec = CollisionSystem.getForwardVector(attackerFacingOrFighter);
            fx = vec.fx;
            fz = vec.fz;
            if (attackerFacingOrFighter.daodanOverpower) {
                dmgMult = DAODAN_CONFIG.OVERPOWER_DAMAGE_MULT || 1.50;
            } else if (attackerFacingOrFighter.daodanOverdrive) {
                dmgMult = DAODAN_CONFIG.OVERDRIVE_DAMAGE_MULT;
            }
            // Beat 'em up crowd balance: Minion/Grunt damage scaling vs Player (P1)
            if (this.id === 'p1' && attackerFacingOrFighter.id !== 'p1') {
                const arch = attackerFacingOrFighter.archetype;
                if (arch === 'STRIKER' || arch === 'FURY' || arch === 'SNIPER') {
                    dmgMult *= 0.45;
                } else if (arch === 'TANKER' || arch === 'BLACK_OPS') {
                    dmgMult *= 0.65;
                }
            }
        } else {
            fx = attackerFacingOrFighter >= 0 ? 1 : -1;
        }
        const effectiveDmg = Math.max(1, Math.round(move.damage * dmgMult * (this.damageTakenMult || 1.0)));

        if (hitInfo.isBlock) {
            let chipDamage = Math.max(1, Math.floor(effectiveDmg * 0.15));
            if (this.daodanOverpower && this.overpowerShield > 0) {
                if (this.overpowerShield >= chipDamage) {
                    this.overpowerShield -= chipDamage;
                    chipDamage = 0;
                } else {
                    chipDamage -= this.overpowerShield;
                    this.overpowerShield = 0;
                }
            }
            this.hp = Math.max(0, this.hp - chipDamage);
            this.vx = fx * 2.0;
            this.vz = fz * 2.0;
            this.state = FIGHTER_STATE.BLOCK;
            this.stateTimer = 0;
            this.hitStunDuration = move.blockStun;
            return { blocked: true, damage: chipDamage, poiseBroken: false };
        }

        // Clean Hit! Absorb through Daodan Overpower shield first
        let actualDmg = effectiveDmg;
        if (this.daodanOverpower && this.overpowerShield > 0) {
            if (this.overpowerShield >= actualDmg) {
                this.overpowerShield -= actualDmg;
                actualDmg = 0;
            } else {
                actualDmg -= this.overpowerShield;
                this.overpowerShield = 0;
            }
        }
        this.hp = Math.max(0, this.hp - actualDmg);
        const poiseDmg = Math.round((move.poiseDamage || move.damage * 2) * (this.poiseTakenMult || 1.0));
        this.poise = Math.max(0, this.poise - poiseDmg);
        this.poiseRegenCooldown = POISE_CONFIG.REGEN_DELAY;

        // Check Hyper-Armor: if currently executing a heavy move OR in P4/P5 Daodan Overdrive / Overpower
        const baseArmor =
            this.state === FIGHTER_STATE.ATTACK && this.currentMove
                ? (this.currentMove.armorThreshold || 0)
                : 0;
        const poiseFloor = this.daodanOverpower ? (DAODAN_CONFIG.OVERPOWER_POISE_FLOOR || 50) : DAODAN_CONFIG.OVERDRIVE_POISE_FLOOR;
        const currentArmor = this.daodanOverdrive ? Math.max(baseArmor, poiseFloor) : baseArmor;
        const hasAntiGankProtection =
            this.id === 'p1' &&
            this.antiGankTimer > 0 &&
            this.hp > 0 &&
            !move.knockdown &&
            !move.isLauncher;
        const hasArmor =
            hasAntiGankProtection ||
            (currentArmor > poiseDmg &&
                this.hp > 0 &&
                this.poise > 0 &&
                !move.knockdown &&
                !move.isLauncher);

        if (hasArmor) {
            return { blocked: false, damage: effectiveDmg, armored: true, poiseBroken: false };
        }

        // Oni asymmetry: rank-and-file minions only stagger Konoko; knockdowns are reserved for
        // Tanker slams, throws and bosses so a crowd can't chain-floor the player.
        const minionStaggerOnly =
            this.id === 'p1' &&
            attackerFacingOrFighter && typeof attackerFacingOrFighter === 'object' &&
            attackerFacingOrFighter.isMinion &&
            attackerFacingOrFighter.archetype !== 'TANKER' &&
            !move.isThrow;
        const isKnockdownMove = (move.knockdown || move.isLauncher) && !minionStaggerOnly;

        // Airborne Juggle or Knockdown / Launcher
        const isAirborneJuggle = !this.isGrounded;
        if (isKnockdownMove || this.hp <= 0 || isAirborneJuggle) {
            this.transitionTo(FIGHTER_STATE.KNOCKED_DOWN);
            const kbX = move.knockback.x || 3.5;
            this.vx = fx * kbX;
            this.vz = fz * kbX;
            this.vy = isAirborneJuggle
                ? Math.max(4.8, (move.knockback.y || 3.8) * 0.85)
                : (move.knockback.y || 4.5);
            this.isGrounded = false;
            this.poise = this.maxPoise;
            return { blocked: false, damage: effectiveDmg, poiseBroken: false, juggled: isAirborneJuggle };
        }

        // Poise broken -> Enter DIZZY state (vulnerable to frontal grabs!)
        if (this.poise <= 0) {
            this.transitionTo(FIGHTER_STATE.DIZZY);
            this.vx = fx * 1.5;
            this.vz = fz * 1.5;
            return { blocked: false, damage: effectiveDmg, poiseBroken: true };
        }

        this.transitionTo(FIGHTER_STATE.HIT_STUN);
        this.hitStunDuration = move.hitStun || 14;
        const kbX = (move.knockback && move.knockback.x) || 2.0;
        this.vx = fx * kbX;
        this.vz = fz * kbX;

        return { blocked: false, damage: effectiveDmg, poiseBroken: false };
    }

    /**
     * Find best target among active enemy fighters for soft lock, camera tracking, and magnetic lunges
     * @param {Array<Fighter>} candidates
     */
    findBestTarget(candidates) {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;
        let best = null;
        let bestScore = -Infinity;
        const { fx, fz } = this.getForwardVector();

        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            if (!c || c.hp <= 0 || c.id === this.id) continue;
            const dx = c.x - this.x;
            const dz = c.z - this.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 0.001) return c;

            const nx = dx / dist;
            const nz = dz / dist;
            const dot = nx * fx + nz * fz; // 1 = right in front

            // Score prioritizes forward vision cone, then proximity
            const score = dot * 2.2 - dist * 0.75;
            if (score > bestScore) {
                bestScore = score;
                best = c;
            }
        }
        return best;
    }
}
