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

        // Throw & Evade Tracking
        this.throwTarget = null;
        this.thrownBy = null;
        this.evadeDir = 'BACK'; // 'BACK' | 'LEFT' | 'RIGHT' | 'FORWARD'
        this.unlockedMoves = new Set(Object.keys(MOVES));

        // P2 Single-Slot Firearm State (null or { id, type, name, ammo, maxAmmo, color })
        this.weapon = null;

        // P3 Hypo-Spray (打针回血) & P4 Daodan Chrysalis (道弹蛹生物机械觉醒)
        this.maxHypo = 1;
        this.hypoCount = this.maxHypo;
        this.daodanMeter = 0;
        this.maxDaodanMeter = DAODAN_CONFIG.MAX_METER;
        this.daodanStage = 1; // 1 | 2 | 3
        this.daodanOverdrive = false;
        this.overdriveTimer = 0;

        // Flags & P5 Arena Elevation Tracking
        this.isGrounded = true;
        this.isBlocking = false;
        this.invincible = false;
        this.dashTimer = 0;
        this.ringOut = false;
        this.floorY = 0;

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
        this.throwTarget = null;
        this.thrownBy = null;
        this.evadeDir = 'BACK';
        this.weapon = null;
        this.hypoCount = this.maxHypo;
        this.daodanMeter = 0;
        this.daodanStage = 1;
        this.daodanOverdrive = false;
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
        this.bufferedMove = null;
        this.invincible = false;

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

        // P4 Daodan Overdrive tick (passive bio-regen, hyper-armor poise floor, meter drain)
        if (this.daodanOverdrive) {
            this.daodanMeter = Math.max(0, this.daodanMeter - DAODAN_CONFIG.OVERDRIVE_DRAIN_PER_TICK);
            if (this.hp > 0 && this.hp < this.maxHp) {
                this.hp = Math.min(this.maxHp, this.hp + DAODAN_CONFIG.OVERDRIVE_REGEN_PER_TICK);
            }
            if (this.poise < DAODAN_CONFIG.OVERDRIVE_POISE_FLOOR && this.state !== FIGHTER_STATE.DIZZY) {
                this.poise = DAODAN_CONFIG.OVERDRIVE_POISE_FLOOR;
            }
            if (this.daodanMeter <= 0) {
                this.daodanOverdrive = false;
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

        // Auto-face opponent in neutral states (supports full 3D yaw tracking)
        if (
            this.state === FIGHTER_STATE.IDLE ||
            this.state === FIGHTER_STATE.WALK ||
            this.state === FIGHTER_STATE.CROUCH
        ) {
            if (opponent) {
                this.faceTowards(opponent.x, opponent.z, 0.28);
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
                this.handleKnockdown(input, simEvents);
                break;
            case FIGHTER_STATE.WAKEUP:
                this.handleWakeup();
                break;
            case FIGHTER_STATE.TECH_RECOVERY:
                this.handleTechRecovery();
                break;
        }

        // Horizontal integration + P5 Step-Up / Ledge-Drop / Ring-Out Elevation Physics
        const nextX = this.x + this.vx * FIXED_DT;
        const nextZ = this.z + this.vz * FIXED_DT;
        const nextFloorY = CollisionSystem.getFloorHeightAt(nextX, nextZ);

        // If moving horizontally into a higher wall (e.g. on lower catwalk y = -1.8 trying to walk into upper deck wall y = 0 without jumping high enough)
        if (Number.isFinite(nextFloorY) && nextFloorY > this.y + 0.35) {
            // Block horizontal penetration into the higher deck wall
            const onlyXFloor = CollisionSystem.getFloorHeightAt(nextX, this.z);
            const onlyZFloor = CollisionSystem.getFloorHeightAt(this.x, nextZ);
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
        this.x = Math.max(STAGE_BOUNDS.minX, Math.min(STAGE_BOUNDS.maxX, this.x));
        this.z = Math.max(STAGE_BOUNDS.minZ, Math.min(STAGE_BOUNDS.maxZ, this.z));

        const targetFloorY = CollisionSystem.getFloorHeightAt(this.x, this.z);
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
                    if (impactVy < STAGE_CONFIG.FALL_DAMAGE_THRESHOLD_VY && !this.invincible && this.hp > 0) {
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
                } else if (!this.ringOut && this.y <= STAGE_CONFIG.ABYSS_DEATH_Y) {
                    // P5 Ring-Out into the cyberpunk abyss!
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
    buildMoveContext(input, opponent) {
        const { fx, fz } = this.getForwardVector();
        const fwdDot = input.dirX * fx + input.dirZ * fz;
        const holdingBack = fwdDot < -0.35;
        const holdingForward = fwdDot > 0.35;

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

            // Check button trigger
            let triggered = false;
            if (entry.button === 'punch') triggered = input.punchJustPressed;
            else if (entry.button === 'kick') triggered = input.kickJustPressed;
            else if (entry.button === 'slide') triggered = input.slideJustPressed;
            else if (entry.button === 'fire') triggered = input.fireJustPressed;
            else if (entry.button === 'daodan') triggered = input.daodanJustPressed;
            else if (entry.button === 'heal') triggered = input.healJustPressed;
            else if (entry.button === 'crouch') triggered = input.crouchJustPressed || input.down;
            else if (entry.button === 'punchOrThrow') triggered = input.punchJustPressed || input.throwJustPressed;

            if (!triggered) continue;

            if (entry.condition(this, input, opponent, ctx)) {
                let move = MOVES[entry.id];
                if (!move) continue;

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

                if (move.isThrow && opponent) {
                    this.startThrow(move, opponent, simEvents);
                } else {
                    if (opponent) this.faceTowards(opponent.x, opponent.z, Math.PI);
                    this.transitionTo(FIGHTER_STATE.ATTACK, move);
                }
                return true;
            }
        }
        return false;
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
        if (move.id === 'THROW_BACK') {
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
     * Check double-tap omnidirectional evasion (Backflip / Side Cartwheel)
     */
    tryStartEvade(input, simEvents) {
        if (!this.isGrounded) return false;
        const { fx, fz } = this.getForwardVector();
        const evadeDir = this.inputBuffer.checkDoubleTapEvade(fx, fz);
        if (!evadeDir) return false;

        this.evadeDir = evadeDir;
        this.transitionTo(FIGHTER_STATE.EVADE);
        this.invincible = true;

        const speed = MOVE_SPEED.EVADE_IMPULSE;
        if (evadeDir === 'BACK') {
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

    handleIdle(input, opponent, simEvents) {
        const { fx, fz } = this.getForwardVector();
        const fwdDot = input.dirX * fx + input.dirZ * fz;

        // Oni-style auto-guard on button OR while holding back
        this.isBlocking = input.block || fwdDot < -0.35;

        // 1. Check Omnidirectional Evade (Backflip / Cartwheel)
        if (this.tryStartEvade(input, simEvents)) return;

        // 2. Check Forward Dash (double-tap forward, or touch-joystick double-tap via dashTimer)
        if (
            this.inputBuffer.checkDashForward(fx, 18, fz) ||
            (this.dashTimer > 0 && fwdDot > 0.35)
        ) {
            this.dashTimer = 0;
            this.transitionTo(FIGHTER_STATE.RUN);
            return;
        }

        // 3. Check Declarative Move Table (Throws, Specials, Attacks)
        if (this.tryStartMoveFromTable(input, opponent, simEvents)) {
            return;
        }

        // 4. Check Crouch
        if (input.crouch && this.isGrounded) {
            this.transitionTo(FIGHTER_STATE.CROUCH);
            return;
        }

        // 5. Check Jump
        if (input.jump && this.isGrounded) {
            this.vy = 12.0;
            this.isGrounded = false;
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
        this.isBlocking = input.block || fwdDot < -0.25;

        if (this.tryStartEvade(input, simEvents)) return;

        if (
            this.inputBuffer.checkDashForward(fx, 18, fz) ||
            (this.dashTimer > 0 && fwdDot > 0.35)
        ) {
            this.dashTimer = 0;
            this.transitionTo(FIGHTER_STATE.RUN);
            return;
        }

        if (this.tryStartMoveFromTable(input, opponent, simEvents)) {
            return;
        }

        if (input.crouch && this.isGrounded) {
            this.vx = 0;
            this.vz = 0;
            this.transitionTo(FIGHTER_STATE.CROUCH);
            return;
        }

        if (input.jump && this.isGrounded) {
            this.vy = 12.0;
            this.isGrounded = false;
            return;
        }

        const dirMag = Math.hypot(input.dirX, input.dirZ);
        if (dirMag < 0.1) {
            this.vx *= 0.55;
            this.vz *= 0.55;
            this.transitionTo(FIGHTER_STATE.IDLE);
            return;
        }

        const nx = input.dirX / Math.max(1.0, dirMag);
        const nz = input.dirZ / Math.max(1.0, dirMag);
        const speedMult = this.daodanOverdrive ? 1.18 : 1.0;

        // Oni 2001 directional speed profile: fast forward advance, guarded back-step, agile lateral strafe
        let baseSpeed;
        if (Math.abs(sideDot) > Math.abs(fwdDot) * 1.15) {
            baseSpeed = (MOVE_SPEED.WALK_FORWARD * 0.88);
        } else if (fwdDot >= 0) {
            baseSpeed = MOVE_SPEED.WALK_FORWARD;
        } else {
            baseSpeed = MOVE_SPEED.WALK_BACK;
        }
        const targetVx = nx * baseSpeed * speedMult;
        const targetVz = nz * baseSpeed * speedMult * 0.86;

        // Smooth athletic acceleration (eliminates robotic instant velocity snapping)
        this.vx += (targetVx - this.vx) * 0.42;
        this.vz += (targetVz - this.vz) * 0.42;
    }

    handleRun(input, opponent, simEvents) {
        // Check running moves from declarative table (Slide Kick, Flying Kick, Dash Punch, Run Throw)
        if (this.tryStartMoveFromTable(input, opponent, simEvents)) {
            return;
        }

        if (input.jump && this.isGrounded) {
            this.vy = 12.5;
            this.isGrounded = false;
            return;
        }

        const { fx, fz } = this.getForwardVector();
        const fwdDot = input.dirX * fx + input.dirZ * fz;
        const runSpd = MOVE_SPEED.RUN * (this.daodanOverdrive ? 1.18 : 1.0);

        if (fwdDot > 0.2) {
            this.vx = fx * runSpd;
            this.vz = fz * runSpd + input.dirZ * runSpd * 0.4;
        } else {
            this.transitionTo(FIGHTER_STATE.IDLE);
        }
    }

    handleCrouch(input, opponent, simEvents) {
        this.isBlocking = input.block;
        this.vx = 0;
        this.vz = 0;

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
            this.transitionTo(FIGHTER_STATE.IDLE);
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

        // P2 Firearm Discharge, Weapon Throw, P3 Hypo-Spray Heal, or P4 Daodan Overdrive Burst on first active frame
        if (this.stateTimer === move.startup) {
            if (move.isDaodanBurst && !this.daodanOverdrive) {
                this.activateDaodanOverdrive(simEvents);
            } else if (move.isHealMove && !this.hasHitThisMove && this.hypoCount > 0) {
                this.hasHitThisMove = true;
                this.hypoCount = Math.max(0, this.hypoCount - 1);
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
            } else if (!this.hasHitThisMove && move.isFirearmMove && this.weapon && this.weapon.ammo > 0) {
                this.hasHitThisMove = true;
                this.weapon.ammo = Math.max(0, this.weapon.ammo - 1);
                if (opponent) this.faceTowards(opponent.x, opponent.z, Math.PI);
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
                if (opponent) this.faceTowards(opponent.x, opponent.z, Math.PI);
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

        // 1. Animation Cancel into Evade during recovery window
        if (this.stateTimer >= move.startup + move.active && this.tryStartEvade(input, simEvents)) {
            return;
        }

        // 2. Combo Buffer / Cancel Window Check
        if (move.cancelTo && move.cancelTo.length > 0 && this.stateTimer >= startCancel) {
            if (input.punchJustPressed) {
                if (move.cancelTo.includes('UPPERCUT') && this.inputBuffer.checkUppercut(this.facing)) {
                    this.bufferedMove = MOVES.UPPERCUT;
                } else {
                    for (const candidateKey of move.cancelTo) {
                        if (candidateKey.startsWith('PUNCH') || candidateKey === 'UPPERCUT') {
                            this.bufferedMove = MOVES[candidateKey];
                            break;
                        }
                    }
                }
            } else if (input.kickJustPressed) {
                if (move.cancelTo.includes('RISING_FURY') && this.inputBuffer.checkRisingFury()) {
                    this.bufferedMove = MOVES.RISING_FURY;
                } else {
                    for (const candidateKey of move.cancelTo) {
                        if (candidateKey.startsWith('KICK') || candidateKey === 'COMBO_PUNCH_KICK' || candidateKey === 'RISING_FURY') {
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
            if (opponent) this.faceTowards(opponent.x, opponent.z, 0.45);
            this.transitionTo(FIGHTER_STATE.ATTACK, nextMove);
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

        if (this.stateTimer === releaseFrame && !this.hasHitThisMove) {
            this.hasHitThisMove = true;
            this.comboCount++;
            this.comboResetTimer = 65;

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
            (input.throwJustPressed || input.punchJustPressed)
        ) {
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

    handleKnockdown(input, simEvents) {
        // Allow Break-Fall Tech Recovery if player presses Jump within first 10 frames of hitting the ground
        if (
            this.isGrounded &&
            this.hp > 0 &&
            this.stateTimer <= TECH_RECOVERY_WINDOW &&
            input &&
            input.jumpJustPressed
        ) {
            this.triggerTechRecovery(simEvents);
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

    handleWakeup() {
        this.invincible = true;
        if (this.stateTimer >= 22) {
            this.invincible = false;
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
            if (attackerFacingOrFighter.daodanOverdrive) {
                dmgMult = DAODAN_CONFIG.OVERDRIVE_DAMAGE_MULT;
            }
        } else {
            fx = attackerFacingOrFighter >= 0 ? 1 : -1;
        }
        const effectiveDmg = Math.round(move.damage * dmgMult);

        if (hitInfo.isBlock) {
            const chipDamage = Math.max(1, Math.floor(effectiveDmg * 0.15));
            this.hp = Math.max(0, this.hp - chipDamage);
            this.vx = fx * 2.0;
            this.vz = fz * 2.0;
            this.state = FIGHTER_STATE.BLOCK;
            this.stateTimer = 0;
            this.hitStunDuration = move.blockStun;
            return { blocked: true, damage: chipDamage, poiseBroken: false };
        }

        // Clean Hit!
        this.hp = Math.max(0, this.hp - effectiveDmg);
        const poiseDmg = move.poiseDamage || move.damage * 2;
        this.poise = Math.max(0, this.poise - poiseDmg);
        this.poiseRegenCooldown = POISE_CONFIG.REGEN_DELAY;

        // Check Hyper-Armor: if currently executing a heavy move OR in P4 Daodan Overdrive
        const baseArmor =
            this.state === FIGHTER_STATE.ATTACK && this.currentMove
                ? (this.currentMove.armorThreshold || 0)
                : 0;
        const currentArmor = this.daodanOverdrive ? Math.max(baseArmor, DAODAN_CONFIG.OVERDRIVE_POISE_FLOOR) : baseArmor;
        const hasArmor =
            currentArmor > poiseDmg &&
            this.hp > 0 &&
            this.poise > 0 &&
            !move.knockdown &&
            !move.isLauncher;

        if (hasArmor) {
            return { blocked: false, damage: effectiveDmg, armored: true, poiseBroken: false };
        }

        // Airborne Juggle or Knockdown / Launcher
        const isAirborneJuggle = !this.isGrounded;
        if (move.knockdown || this.hp <= 0 || move.isLauncher || isAirborneJuggle) {
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
        this.hitStunDuration = move.hitStun;
        const kbX = move.knockback.x || 2.0;
        this.vx = fx * kbX;
        this.vz = fz * kbX;

        return { blocked: false, damage: effectiveDmg, poiseBroken: false };
    }
}
