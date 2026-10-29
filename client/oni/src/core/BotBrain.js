/**
 * BotBrain - P3 Deterministic Behavior Tree (BT) & Tactical AI
 * Supports tiered enemy archetypes from Oni:
 *   - STRIKER_GRUNT ('easy')
 *   - COMBAT_ELITE ('normal')
 *   - SYNDICATE_NINJA ('hard')
 *
 * Behavior Tree Hierarchy (evaluated top-to-bottom per tick):
 *   Selector (Root)
 *    ├── 1. Survival Reflex Branch: Throw-Tech (拆投) & Break-Fall Ukemi (受身)
 *    ├── 2. Emergency Evasion Branch: Double-tap I-Frame Roll/Backflip against Homing Missiles / Heavy Attacks
 *    ├── 3. Tactical Retreat & Hypo-Spray Branch: Backflip disengage + Hypo-Spray injection when HP is critical
 *    ├── 4. Daodan Chrysalis Awakening Branch: Trigger Daodan Overdrive Burst when meter >= 80
 *    ├── 5. Punish & Guard Response Branch: Frontal/Back Throw on Dizzy, Ground Stomp on Knockdown, Guard vs Startups
 *    ├── 6. Gun-Fu Disarm & Weapon Control Branch: Acrobatic Disarm / Slide vs Armed foe, Scavenge nearby loaded guns
 *    └── 7. Range-Based Offensive Pressure: Close (3-hit chains, command specials) / Mid-Long (Firearms, Throw empty gun, Dash)
 */

import { FIGHTER_STATE, AI_ARCHETYPES, STAGE_CONFIG } from './Constants.js';
import { createDeterministicRNG } from './Simulation.js';
import { CollisionSystem } from './CollisionSystem.js';

export const BT_STATUS = {
    SUCCESS: 'SUCCESS',
    FAILURE: 'FAILURE',
    RUNNING: 'RUNNING'
};

export class BotBrain {
    // Attack Token Bucket for coordinating multiple squad enemies (prevents unfair multi-striking)
    static activeAttackerId = null;
    static tokenExpireFrame = 0;

    static requestAttackToken(botId, currentFrame = 0, duration = 45) {
        if (!this.activeAttackerId || this.activeAttackerId === botId || currentFrame >= this.tokenExpireFrame) {
            this.activeAttackerId = botId;
            this.tokenExpireFrame = currentFrame + duration;
            return true;
        }
        return false;
    }

    static releaseAttackToken(botId) {
        if (this.activeAttackerId === botId) {
            this.activeAttackerId = null;
            this.tokenExpireFrame = 0;
        }
    }

    constructor(level = 'normal', seed = 0xB07A1) {
        this.setLevel(level);
        this.actionTimer = 0;
        this.lastBranch = 'IDLE';
        this.strafePhase = 0;
        this.evadeTapQueue = []; // multi-frame input queue for deterministic double-tap evade / dash
        this.rng = createDeterministicRNG(seed);
        this.tree = this.buildBehaviorTree();
    }

    setLevel(level = 'normal') {
        this.level = level;
        if (level === 'hard' || level === 'SYNDICATE_NINJA') {
            this.profile = AI_ARCHETYPES.SYNDICATE_NINJA;
        } else if (level === 'easy' || level === 'STRIKER_GRUNT') {
            this.profile = AI_ARCHETYPES.STRIKER_GRUNT;
        } else {
            this.profile = AI_ARCHETYPES.COMBAT_ELITE;
        }
    }

    rand(sim) {
        if (sim && typeof sim.random === 'function') {
            return sim.random();
        }
        return this.rng.next();
    }

    createBlankInput() {
        return {
            dirX: 0,
            dirZ: 0,
            punch: false,
            kick: false,
            block: false,
            jump: false,
            crouch: false,
            slide: false,
            throwBtn: false,
            fire: false,
            daodan: false,
            heal: false
        };
    }

    /**
     * Queue a 3-frame double-tap directional evade so InputBuffer.checkDoubleTapEvade triggers deterministically
     */
    queueDoubleTap(dirX, dirZ) {
        this.evadeTapQueue = [
            { dirX, dirZ },
            { dirX: 0, dirZ: 0 },
            { dirX, dirZ }
        ];
    }

    /**
     * Build modular Behavior Tree (Selector of prioritized tactical branches)
     */
    buildBehaviorTree() {
        const branches = [
            { name: 'SURVIVAL_REFLEX', fn: (bb) => this.branchSurvivalReflex(bb) },
            { name: 'PATROL_AND_ALERT', fn: (bb) => this.branchPatrolAndAlert(bb) },
            { name: 'RUN_TO_ALARM', fn: (bb) => this.branchRunToAlarm(bb) },
            { name: 'STUNNED_IDLE', fn: (bb) => this.branchStunnedGuard(bb) },
            { name: 'LEDGE_HAZARD_AWARENESS', fn: (bb) => this.branchLedgeHazardAwareness(bb) },
            { name: 'PROJECTILE_EVADE', fn: (bb) => this.branchProjectileEvade(bb) },
            { name: 'TACTICAL_HYPO_RETREAT', fn: (bb) => this.branchTacticalHypoRetreat(bb) },
            { name: 'DAODAN_AWAKEN', fn: (bb) => this.branchDaodanAwaken(bb) },
            { name: 'DEFENSIVE_GUARD', fn: (bb) => this.branchDefensiveGuard(bb) },
            { name: 'PUNISH_OPPONENT', fn: (bb) => this.branchPunishOpponent(bb) },
            { name: 'GUN_FU_TACTICS', fn: (bb) => this.branchGunFuTactics(bb) },
            { name: 'CLOSE_COMBAT', fn: (bb) => this.branchCloseCombat(bb) },
            { name: 'APPROACH_PRESSURE', fn: (bb) => this.branchApproachPressure(bb) }
        ];

        return {
            evaluate: (bb) => {
                for (let i = 0; i < branches.length; i++) {
                    const b = branches[i];
                    const status = b.fn(bb);
                    if (status === BT_STATUS.SUCCESS || status === BT_STATUS.RUNNING) {
                        this.lastBranch = b.name;
                        return status;
                    }
                }
                this.lastBranch = 'IDLE';
                return BT_STATUS.FAILURE;
            }
        };
    }

    /**
     * Branch 0: Patrol & Vision Cone Alert Detection (P2)
     * Unalerted sentries patrol between bounds with directional vision cone.
     * Backwards blindspot enables stealth sneak-ups and takedowns.
     */
    branchPatrolAndAlert(bb) {
        const { bot, opp, dist, input, sim } = bb;
        if (bot.isAlerted === undefined || bot.isAlerted === true) return BT_STATUS.FAILURE;

        // Vision cone & perception check:
        // Bot faces along X: bot.facing > 0 means looking towards +X (right), < 0 means looking towards -X (left)
        const facingSign = (bot.facing !== undefined && bot.facing !== 0) ? Math.sign(bot.facing) : (bot.patrolDir || -1);
        const isOppInFront = opp ? ((opp.x - bot.x) * facingSign > -0.4) : false;

        // Triggers for becoming alerted:
        // 1. Sighted: player within vision cone in front (dist <= 7.0m)
        // 2. Audible Footsteps: sprinting/dashing loudly from behind within 2.2m
        // 3. Gunfire: player firing firearms nearby within 12.0m
        // 4. Physical Impact: bot suffered damage
        const sawPlayerInFront = isOppInFront && dist <= 7.0;
        const heardLoudRun = opp && (opp.state === FIGHTER_STATE.RUN || opp.state === FIGHTER_STATE.DASH) && dist <= 2.2;
        const heardGunfire = opp && opp.state === FIGHTER_STATE.ATTACK && opp.currentMove && opp.currentMove.isFirearmMove && dist <= 12.0;
        const tookDamage = bot.hp < (bot.maxHp || 100);

        if (sawPlayerInFront || heardLoudRun || heardGunfire || tookDamage) {
            bot.isAlerted = true;
            bot.alertTimer = 120; // 2 seconds alert bubble
            if (sim && Array.isArray(sim.events)) {
                sim.events.push({
                    type: 'ENEMY_ALERT',
                    id: bot.id,
                    name: bot.name,
                    x: bot.x,
                    y: bot.y,
                    z: bot.z
                });
                // Chain-alert squad comrades within 7.5m
                const squad = typeof sim.getEnemies === 'function' ? sim.getEnemies() : [];
                for (let k = 0; k < squad.length; k++) {
                    const mate = squad[k];
                    if (mate.id !== bot.id && !mate.isAlerted) {
                        const d = Math.hypot(mate.x - bot.x, mate.z - bot.z);
                        if (d <= 7.5) {
                            mate.isAlerted = true;
                            mate.alertTimer = 120;
                        }
                    }
                }
            }
            return BT_STATUS.FAILURE;
        }

        // Unalerted: gently patrol back and forth along X with correct facing orientation
        const minX = bot.patrolMinX !== undefined ? bot.patrolMinX : (bot.x - 2.5);
        const maxX = bot.patrolMaxX !== undefined ? bot.patrolMaxX : (bot.x + 2.5);
        if (bot.patrolDir === undefined) bot.patrolDir = -1;

        if (bot.x <= minX) {
            bot.patrolDir = 1;
            bot.facing = 1;
        } else if (bot.x >= maxX) {
            bot.patrolDir = -1;
            bot.facing = -1;
        } else {
            bot.facing = bot.patrolDir;
        }

        input.dirX = bot.patrolDir * 0.55;
        input.dirZ = 0;
        return BT_STATUS.SUCCESS;
    }

    /**
     * Branch: Run To Alarm Station (🚨 Oni Sentry Alarm Protocol)
     * Alerted sentries who have alarm authorization sprint towards the nearest active console
     * to trigger emergency reinforcements unless intercepted or neutralized.
     */
    branchRunToAlarm(bb) {
        const { bot, input, sim } = bb;
        if (!bot.canTriggerAlarm || !bot.isAlerted || bot.hasTriggeredAlarm) {
            bot.isRunningToAlarm = false;
            return BT_STATUS.FAILURE;
        }
        const camp = sim && sim.campaignManager;
        if (!camp || camp.alarmActive) {
            bot.isRunningToAlarm = false;
            return BT_STATUS.FAILURE;
        }
        // Find nearest active ALARM_CONSOLE in current sector
        const alarmConsole = Array.isArray(camp.interactables)
            ? camp.interactables.find((item) => item.type === 'ALARM_CONSOLE' && !item.alarmTriggered && item.active)
            : null;
        if (!alarmConsole) {
            bot.isRunningToAlarm = false;
            return BT_STATUS.FAILURE;
        }

        const distToAlarm = Math.hypot(alarmConsole.x - bot.x, alarmConsole.z - bot.z);
        if (distToAlarm <= 1.35) {
            bot.hasTriggeredAlarm = true;
            bot.isRunningToAlarm = false;
            camp.triggerAlarm(bot);
            return BT_STATUS.SUCCESS;
        }

        // Sprint towards alarm console
        bot.isRunningToAlarm = true;
        const dx = alarmConsole.x - bot.x;
        const dz = alarmConsole.z - bot.z;
        input.dirX = Math.abs(dx) > 0.2 ? Math.sign(dx) * 1.0 : 0;
        input.dirZ = Math.abs(dz) > 0.2 ? Math.sign(dz) * 1.0 : 0;
        return BT_STATUS.RUNNING;
    }

    /**
     * Branch 1: Throw-Tech (拆投) & Break-Fall Ukemi (受身)
     */
    branchSurvivalReflex(bb) {
        const { bot, input, sim } = bb;

        if (bot.state === FIGHTER_STATE.BEING_THROWN) {
            if (bot.stateTimer === 3 && this.rand(sim) < this.profile.techChance) {
                input.throwBtn = true;
            }
            return BT_STATUS.SUCCESS;
        }

        if (bot.state === FIGHTER_STATE.KNOCKED_DOWN && bot.hp > 0) {
            const floorY = CollisionSystem.getFloorHeightAt(bot.x, bot.z);
            const distAbove = Number.isFinite(floorY) ? (bot.y - floorY) : Infinity;
            if (!bot.isGrounded && bot.vy < 0 && distAbove <= 0.75 && distAbove >= 0 && this.rand(sim) < this.profile.ukemiChance) {
                input.jump = true;
            }
            return BT_STATUS.SUCCESS;
        }

        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 2b: P5 Ledge Hazard Awareness & High-Ground Recovery
     * Prevents AI from accidentally walking/backflipping into the outer abyss,
     * and jumps back up onto the main rooftop deck if knocked onto the lower catwalk.
     */
    branchLedgeHazardAwareness(bb) {
        // In indoor flat dojo mode there are no outer abysses or lower catwalk ledges
        if (CollisionSystem.isIndoor && CollisionSystem.isIndoor()) {
            return BT_STATUS.FAILURE;
        }

        const { bot, opp, input } = bb;

        // If dangerously close to the outer abyss edge of the lower catwalk, steer inward immediately!
        if (Math.abs(bot.x) > STAGE_CONFIG.LOWER_CATWALK_X - 1.1 || Math.abs(bot.z) > STAGE_CONFIG.LOWER_CATWALK_Z - 0.9) {
            input.dirX = bot.x > 0 ? -1 : 1;
            input.dirZ = Math.abs(bot.z) > 1.0 ? (bot.z > 0 ? -1 : 1) : 0;
            if (bot.isGrounded && Math.abs(bot.x) > STAGE_CONFIG.LOWER_CATWALK_X - 0.65) {
                input.jump = true;
            }
            return BT_STATUS.SUCCESS;
        }

        // If bot is on the lower catwalk (y <= -1.5) while opponent is on the upper rooftop deck (y >= -0.2),
        // move toward the upper deck wall and jump up!
        if (bot.isGrounded && bot.y <= STAGE_CONFIG.LOWER_CATWALK_Y + 0.25 && opp.y > bot.y + 0.8) {
            input.dirX = bot.x > 0 ? -1 : 1;
            input.dirZ = Math.abs(bot.z) > 1.5 ? (bot.z > 0 ? -1 : 1) : 0;
            if (Math.abs(bot.x) <= STAGE_CONFIG.UPPER_DECK_X + 0.85) {
                input.jump = true;
            }
            return BT_STATUS.SUCCESS;
        }

        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 2: Lock out inputs while in hitstun/dizzy/wakeup
     */
    branchStunnedGuard(bb) {
        const { bot } = bb;
        if (
            bot.state === FIGHTER_STATE.HIT_STUN ||
            bot.state === FIGHTER_STATE.DIZZY ||
            bot.state === FIGHTER_STATE.WAKEUP ||
            bot.state === FIGHTER_STATE.TECH_RECOVERY ||
            bot.state === FIGHTER_STATE.EVADE
        ) {
            return BT_STATUS.SUCCESS;
        }
        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 3: Evade incoming Scram Cannon homing missiles or unblockable attacks using I-frame flips
     */
    branchProjectileEvade(bb) {
        const { bot, opp, nx, nz, dist, sim } = bb;
        if (this.profile.evadeChance <= 0 || !bot.isGrounded) return BT_STATUS.FAILURE;

        // Check active homing projectiles targeting bot
        if (sim && typeof sim.getProjectiles === 'function') {
            const projs = sim.getProjectiles();
            for (let i = 0; i < projs.length; i++) {
                const p = projs[i];
                if (p.targetId === bot.id) {
                    const pDist = Math.hypot(p.x - bot.x, p.z - bot.z);
                    if (pDist < 2.8 && this.rand(sim) < this.profile.evadeChance) {
                        // Side-flip or backflip to break missile tracking!
                        this.queueDoubleTap(-nx, -nz);
                        return this.consumeTapQueue(bb);
                    }
                }
            }
        }

        // Evade opponent's Mercury Bow aim or Daodan Surge at close-mid range
        if (
            opp.state === FIGHTER_STATE.ATTACK &&
            opp.currentMove &&
            (opp.currentMove.piercesGuard || opp.currentMove.isDaodanBurst) &&
            dist < 4.5 &&
            this.rand(sim) < this.profile.evadeChance * 0.5
        ) {
            this.queueDoubleTap(-nx, -nz);
            return this.consumeTapQueue(bb);
        }

        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 4: P3 Tactical Retreat & Hypo-Spray Heal when HP is low
     */
    branchTacticalHypoRetreat(bb) {
        const { bot, dist, nx, nz } = bb;
        const hpRatio = bot.hp / bot.maxHp;
        if (bot.hypoCount <= 0 || hpRatio > this.profile.retreatHpRatio || this.profile.retreatHpRatio <= 0) {
            return BT_STATUS.FAILURE;
        }

        // If safely separated (or opponent is knocked down), inject Hypo-Spray immediately!
        if (dist > 2.8 || bb.opp.state === FIGHTER_STATE.KNOCKED_DOWN || bb.opp.state === FIGHTER_STATE.DIZZY) {
            bb.input.heal = true;
            return BT_STATUS.SUCCESS;
        }

        // Otherwise, double-tap backflip to create space for healing
        if (bot.isGrounded && this.evadeTapQueue.length === 0) {
            this.queueDoubleTap(-nx, -nz);
            return this.consumeTapQueue(bb);
        }

        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 5: P4 Daodan Chrysalis Overdrive Activation
     */
    branchDaodanAwaken(bb) {
        const { bot, dist, input, sim } = bb;
        if (
            !bot.daodanOverdrive &&
            bot.daodanMeter >= 75 &&
            dist < 2.8 &&
            this.profile.level !== 'easy' &&
            this.rand(sim) < 0.35
        ) {
            input.daodan = true;
            return BT_STATUS.SUCCESS;
        }
        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 6: Reactive Guard against opponent melee attacks
     */
    branchDefensiveGuard(bb) {
        const { opp, dist, nx, nz, input, sim } = bb;
        if (opp.state === FIGHTER_STATE.ATTACK && dist < 2.6) {
            if (this.rand(sim) < this.profile.blockChance) {
                input.block = true;
                input.dirX = -nx;
                input.dirZ = -nz;
                return BT_STATUS.SUCCESS;
            }
        }
        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 7: Context-sensitive punish against Dizzy or Knocked-Down opponent
     */
    branchPunishOpponent(bb) {
        const { opp, dist, input, sim } = bb;
        if (opp.state === FIGHTER_STATE.DIZZY && dist < 1.38) {
            input.throwBtn = true;
            input.punch = true;
            return BT_STATUS.SUCCESS;
        }
        if (opp.state === FIGHTER_STATE.KNOCKED_DOWN && dist < 1.55 && this.profile.level !== 'easy') {
            if (this.rand(sim) < 0.4) {
                input.kick = true; // Ground stomp
                return BT_STATUS.SUCCESS;
            }
        }
        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 8: Gun-Fu Tactics (Disarm armed opponent, fire weapon, throw empty gun, or scavenge floor guns)
     */
    branchGunFuTactics(bb) {
        const { bot, opp, dist, nx, nz, input, sim } = bb;

        // 8a. If opponent has a loaded gun at mid-range on Hard/Normal, rush in with Slide or Acrobatic Disarm!
        if (!bot.weapon && opp.weapon && opp.weapon.ammo > 0 && dist > 1.8 && dist < 4.2 && this.profile.level !== 'easy') {
            const r = this.rand(sim);
            if (r < 0.14) {
                input.slide = true;
                return BT_STATUS.SUCCESS;
            }
            if (bot.state === FIGHTER_STATE.RUN && dist < 2.5 && r < 0.35) {
                input.jump = true;
                input.punch = true; // DISARM_KICK (snatches opponent's gun in mid-air!)
                return BT_STATUS.SUCCESS;
            }
        }

        // 8b. If bot holds a weapon at mid/long range
        if (dist >= 1.55 && bot.weapon && this.actionTimer % 12 === 0) {
            if (bot.weapon.ammo > 0 && dist < 9.5) {
                const fireChance = this.profile.level === 'hard' ? 0.32 : (this.profile.level === 'normal' ? 0.18 : 0.08);
                if (this.rand(sim) < fireChance) {
                    input.fire = true;
                    return BT_STATUS.SUCCESS;
                }
            } else if (bot.weapon.ammo <= 0 && dist < 5.5) {
                if (this.rand(sim) < 0.35) {
                    input.fire = true; // Throw empty weapon at opponent
                    return BT_STATUS.SUCCESS;
                }
            }
        }

        // 8c. If unarmed and a loaded weapon is on the floor nearby, move to pick it up
        if (!bot.weapon && sim && this.profile.level !== 'easy' && dist >= 1.5) {
            const weapons = sim.getWeapons ? sim.getWeapons() : [];
            for (let i = 0; i < weapons.length; i++) {
                const w = weapons[i];
                if (w.ammo > 0) {
                    const wDist = Math.hypot(w.x - bot.x, w.z - bot.z);
                    if (wDist < 1.35) {
                        input.punch = true;
                        return BT_STATUS.SUCCESS;
                    } else if (wDist < 3.5) {
                        input.dirX = (w.x - bot.x) / wDist;
                        input.dirZ = (w.z - bot.z) / wDist;
                        return BT_STATUS.SUCCESS;
                    }
                }
            }
        }

        return BT_STATUS.FAILURE;
    }

    /**
     * Branch 9: Close-Range Martial Arts Pressure (3-hit chains, Uppercut, Devil Spin Kick, Throws)
     */
    branchCloseCombat(bb) {
        const { bot, dist, dz, nx, nz, input, sim } = bb;
        if (dist >= 1.48) return BT_STATUS.FAILURE;

        // Squad attack token coordination: only token holder presses melee attack chains
        if (sim && typeof sim.getEnemies === 'function') {
            const squad = sim.getEnemies();
            if (squad.length > 1) {
                const currentFrame = sim.currentFrame || 0;
                if (!BotBrain.requestAttackToken(bot.id, currentFrame, 50)) {
                    // Secondary flanker: circles laterally or guards
                    input.dirX = -nx * 0.4;
                    input.dirZ = Math.sign(dz || 1) * 0.7;
                    input.block = true;
                    return BT_STATUS.SUCCESS;
                }
            }
        }

        const interval = this.profile.attackInterval || 14;
        if (this.actionTimer % interval === 0) {
            const r = this.rand(sim);

            // Archetype-specific combat specials
            if (bot.archetype === 'TANKER') {
                if (r < 0.45) {
                    input.punch = true; // Heavy straight slam
                } else if (r < 0.75) {
                    input.down = true;
                    input.kick = true; // Ground Stomp shockwave
                } else {
                    input.block = true;
                }
                return BT_STATUS.SUCCESS;
            } else if (bot.archetype === 'FURY') {
                if (r < 0.35) {
                    input.kick = true; // Willow kick or rapid kick combo
                } else if (r < 0.65) {
                    input.down = true;
                    input.dirX = nx;
                    input.kick = true; // Slide kick
                } else if (r < 0.85) {
                    input.throwBtn = true; // Shoulder throw
                } else {
                    input.punch = true;
                }
                return BT_STATUS.SUCCESS;
            } else if (bot.archetype === 'SNIPER') {
                // Sniper disengages close range
                input.dirX = -nx;
                input.dirZ = Math.sign(dz || 1);
                if (bot.weapon && bot.weapon.ammo > 0) input.fire = true;
                return BT_STATUS.SUCCESS;
            }

            if (this.profile.level === 'hard') {
                if (r < 0.34) {
                    input.punch = true;
                } else if (r < 0.58) {
                    input.kick = true;
                } else if (r < 0.68 && (bot.daodanStage >= 3 || bot.daodanOverdrive)) {
                    // Awakened Stage 3 Devil Spin Kick (Down + Forward + Kick)
                    input.down = true;
                    input.dirX = nx;
                    input.dirZ = nz;
                    input.kick = true;
                } else if (r < 0.76) {
                    // Uppercut (Down + Forward + Punch)
                    input.down = true;
                    input.dirX = nx;
                    input.dirZ = nz;
                    input.punch = true;
                } else if (r < 0.84) {
                    input.throwBtn = true;
                } else {
                    input.block = true;
                }
            } else if (this.profile.level === 'normal') {
                if (r < 0.28) input.punch = true;
                else if (r < 0.48) input.kick = true;
                else if (r < 0.64) input.block = true;
            } else {
                // Easy: slow telegraphing pokes, plenty of openings for player to counter
                if (r < 0.18) input.punch = true;
                else if (r < 0.30) input.kick = true;
            }
        }
        return BT_STATUS.SUCCESS;
    }

    /**
     * Branch 10: Approach & Mid-Range Gap Closing (with Oni-style 3D lateral strafing & dash-ins)
     */
    branchApproachPressure(bb) {
        const { bot, dist, dz, nx, nz, input, sim } = bb;

        // Easy bot occasionally pauses at mid-range ( martial-arts sizing up ) so player isn't overwhelmed
        if (this.profile.level === 'easy' && dist > 1.5 && dist < 2.8 && (this.actionTimer % 50) > 34) {
            input.dirX = 0;
            input.dirZ = 0;
            return BT_STATUS.SUCCESS;
        }

        input.dirX = nx;

        // Lateral Z-axis tactical strafing when approaching at mid-range (1.5m .. 4.0m)
        if (Math.abs(dz) > 0.28) {
            input.dirZ = nz;
        } else if (dist > 1.5 && dist < 3.8 && this.profile.level !== 'easy') {
            const strafeWave = Math.sin(this.actionTimer * 0.055 + (bot.id === 'p2' ? 1.2 : 0));
            input.dirZ = Math.abs(strafeWave) > 0.45 ? Math.sign(strafeWave) * 0.75 : 0;
        } else {
            input.dirZ = 0;
        }

        if (this.profile.level !== 'easy' && dist > 2.2 && dist < 3.9 && this.actionTimer % 12 === 0) {
            const r = this.rand(sim);
            if (r < (this.profile.level === 'hard' ? 0.14 : 0.06)) {
                input.slide = true;
            } else if (r < (this.profile.level === 'hard' ? 0.28 : 0.14) && bot.state !== FIGHTER_STATE.RUN && this.evadeTapQueue.length === 0) {
                // Double-tap forward to sprint/dash into range like Oni's Strikers
                this.queueDoubleTap(nx, 0);
                return this.consumeTapQueue(bb);
            }
        }
        return BT_STATUS.SUCCESS;
    }

    consumeTapQueue(bb) {
        if (this.evadeTapQueue.length === 0) return BT_STATUS.FAILURE;
        const step = this.evadeTapQueue.shift();
        bb.input.dirX = step.dirX;
        bb.input.dirZ = step.dirZ;
        return BT_STATUS.RUNNING;
    }

    /**
     * Compute input for bot fighter this tick
     */
    think(botFighter, opponent, sim = null) {
        this.actionTimer++;
        if (botFighter && this.profile && this.profile.speedScale) {
            botFighter.speedScale = this.profile.speedScale;
        }
        const input = this.createBlankInput();

        // Drain queued multi-frame double-tap inputs first
        if (this.evadeTapQueue.length > 0) {
            const step = this.evadeTapQueue.shift();
            input.dirX = step.dirX;
            input.dirZ = step.dirZ;
            return input;
        }

        const dx = opponent.x - botFighter.x;
        const dz = opponent.z - botFighter.z;
        const dist = Math.hypot(dx, dz);
        const nx = dist > 0.001 ? dx / dist : 1;
        const nz = dist > 0.001 ? dz / dist : 0;

        const blackboard = {
            bot: botFighter,
            opp: opponent,
            sim,
            dx,
            dz,
            dist,
            nx,
            nz,
            input
        };

        this.tree.evaluate(blackboard);
        return input;
    }
}
