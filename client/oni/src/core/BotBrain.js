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

import { FIGHTER_STATE, AI_ARCHETYPES } from './Constants.js';
import { createDeterministicRNG } from './Simulation.js';

export const BT_STATUS = {
    SUCCESS: 'SUCCESS',
    FAILURE: 'FAILURE',
    RUNNING: 'RUNNING'
};

export class BotBrain {
    constructor(level = 'normal', seed = 0xB07A1) {
        this.setLevel(level);
        this.actionTimer = 0;
        this.lastBranch = 'IDLE';
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
            { name: 'STUNNED_IDLE', fn: (bb) => this.branchStunnedGuard(bb) },
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
            if (!bot.isGrounded && bot.vy < 0 && bot.y <= 0.75 && this.rand(sim) < this.profile.ukemiChance) {
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
        if (dist >= 1.55 && bot.weapon) {
            if (bot.weapon.ammo > 0 && dist < 9.5) {
                const fireChance = this.profile.level === 'hard' ? 0.16 : (this.profile.level === 'normal' ? 0.08 : 0.03);
                if (this.rand(sim) < fireChance) {
                    input.fire = true;
                    return BT_STATUS.SUCCESS;
                }
            } else if (bot.weapon.ammo <= 0 && dist < 5.5) {
                if (this.rand(sim) < 0.28) {
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
        const { bot, dist, nx, nz, input, sim } = bb;
        if (dist >= 1.48) return BT_STATUS.FAILURE;

        const r = this.rand(sim);
        if (this.profile.level === 'hard') {
            if (r < 0.38) {
                input.punch = true;
            } else if (r < 0.66) {
                input.kick = true;
            } else if (r < 0.78 && (bot.daodanStage >= 3 || bot.daodanOverdrive)) {
                // Awakened Stage 3 Devil Spin Kick (Down + Forward + Kick)
                input.down = true;
                input.dirX = nx;
                input.dirZ = nz;
                input.kick = true;
            } else if (r < 0.86) {
                // Uppercut (Down + Forward + Punch)
                input.down = true;
                input.dirX = nx;
                input.dirZ = nz;
                input.punch = true;
            } else if (r < 0.94) {
                input.throwBtn = true;
            } else {
                input.block = true;
            }
        } else if (this.profile.level === 'normal') {
            if (r < 0.35) input.punch = true;
            else if (r < 0.62) input.kick = true;
            else if (r < 0.80) input.block = true;
        } else {
            if (r < 0.15) input.punch = true;
            else if (r < 0.28) input.kick = true;
        }
        return BT_STATUS.SUCCESS;
    }

    /**
     * Branch 10: Approach & Mid-Range Gap Closing
     */
    branchApproachPressure(bb) {
        const { dist, dz, nx, nz, input, sim } = bb;
        input.dirX = nx;
        input.dirZ = Math.abs(dz) > 0.25 ? nz : 0;

        if (this.profile.level === 'hard' && dist > 2.2 && dist < 3.8 && this.rand(sim) < 0.08) {
            input.slide = true;
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
