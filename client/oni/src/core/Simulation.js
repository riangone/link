/**
 * Simulation - Deterministic 60Hz Match Simulation Kernel
 * Manages deterministic PRNG, entity registry, fighters, hitstop, events, and snapshot generation.
 */

import { Fighter } from './Fighter.js';
import { CollisionSystem } from './CollisionSystem.js';
import { FIGHTER_STATE } from './Constants.js';

/**
 * Deterministic Mulberry32 PRNG for lockstep / replay / AI consistency
 */
export function createDeterministicRNG(seed = 0x0412001) {
    let s = seed | 0;
    return {
        next() {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
        getState() {
            return s;
        },
        setState(newSeed) {
            s = newSeed | 0;
        }
    };
}

export class Simulation {
    constructor(seed = 0x0412001) {
        this.initialSeed = seed;
        this.rng = createDeterministicRNG(seed);

        this.f1 = new Fighter('p1', 'Konoko', -2.6, 1, false);
        this.f2 = new Fighter('p2', 'Syndi-Bot', 2.6, -1, true);

        // Unified Entity Registry (Fighters, dropped weapons, projectiles)
        this.entities = new Map();
        this.registerEntity(this.f1);
        this.registerEntity(this.f2);

        this.roundTimer = 99 * 60; // 99 seconds in frames
        this.currentFrame = 0;
        this.hitstopFrames = 0;
        this.isMatchOver = false;
        this.winner = null;

        // Event queue for render/audio listeners (drained each frame)
        this.events = [];
    }

    registerEntity(entity) {
        this.entities.set(entity.id, entity);
    }

    removeEntity(id) {
        this.entities.delete(id);
    }

    getFighters() {
        const list = [];
        for (const ent of this.entities.values()) {
            if (ent.entityType === 'fighter') list.push(ent);
        }
        return list;
    }

    /**
     * Deterministic random [0, 1)
     */
    random() {
        return this.rng.next();
    }

    reset() {
        this.rng.setState(this.initialSeed);
        this.f1.reset(-2.6, 1);
        this.f2.reset(2.6, -1);
        this.entities.clear();
        this.registerEntity(this.f1);
        this.registerEntity(this.f2);
        this.roundTimer = 99 * 60;
        this.currentFrame = 0;
        this.hitstopFrames = 0;
        this.isMatchOver = false;
        this.winner = null;
        this.events = [];
    }

    /**
     * Advance simulation by 1 fixed tick (1/60s)
     * @param {Object} input1 Raw input for Fighter 1
     * @param {Object} input2 Raw input for Fighter 2
     */
    tick(input1 = {}, input2 = {}) {
        this.currentFrame++;
        this.events = [];

        // Hitstop freeze (for intense impact crunch)
        if (this.hitstopFrames > 0) {
            this.hitstopFrames--;
            return;
        }

        if (this.isMatchOver) {
            // Still run basic physics for falling fighters
            this.f1.update({ dirX: 0, dirZ: 0 }, this.f2, this.events);
            this.f2.update({ dirX: 0, dirZ: 0 }, this.f1, this.events);
            return;
        }

        // Timer decrement
        if (this.roundTimer > 0) {
            this.roundTimer--;
            if (this.roundTimer === 0) {
                this.handleTimeout();
                return;
            }
        }

        // 1. Update Fighters in deterministic order
        this.f1.update(input1, this.f2, this.events);
        this.f2.update(input2, this.f1, this.events);

        // Check if a throw finished and caused a KO
        if (this.f2.hp <= 0 && !this.isMatchOver) {
            this.declareWinner('p1');
            return;
        }
        if (this.f1.hp <= 0 && !this.isMatchOver) {
            this.declareWinner('p2');
            return;
        }

        // 2. Resolve Pushbox overlap among all fighters
        const fighters = this.getFighters();
        for (let i = 0; i < fighters.length; i++) {
            for (let j = i + 1; j < fighters.length; j++) {
                CollisionSystem.resolvePushbox(fighters[i], fighters[j], 0.65);
            }
        }

        // 3. Collision & Combat Detection
        this.resolveAttackHit(this.f1, this.f2);
        if (!this.isMatchOver) {
            this.resolveAttackHit(this.f2, this.f1);
        }
    }

    resolveAttackHit(attacker, defender) {
        const hitResult = CollisionSystem.checkHit(attacker, defender);
        if (!hitResult) return;

        attacker.hasHitThisMove = true;
        attacker.comboCount++;
        attacker.comboResetTimer = 60; // frames to keep combo alive

        const hitInfo = defender.takeHit(hitResult, attacker);
        const isHeavy =
            hitResult.move.knockdown ||
            hitResult.move.isLauncher ||
            hitResult.move.damage >= 18 ||
            hitInfo.poiseBroken;
        this.hitstopFrames = hitInfo.blocked ? 4 : (isHeavy ? 10 : 6);

        this.events.push({
            type: 'HIT',
            attacker: attacker.id,
            defender: defender.id,
            hitPoint: hitResult.hitPoint,
            move: hitResult.move,
            damage: hitInfo.damage,
            blocked: hitInfo.blocked,
            armored: !!hitInfo.armored,
            poiseBroken: !!hitInfo.poiseBroken,
            juggled: !!hitInfo.juggled,
            combo: attacker.comboCount,
            knockdown: hitResult.move.knockdown || hitResult.move.isLauncher || defender.hp <= 0
        });

        if (defender.hp <= 0) {
            this.declareWinner(attacker.id);
        }
    }

    declareWinner(winnerId) {
        this.isMatchOver = true;
        this.winner = winnerId;
        if (winnerId === 'p1') {
            this.f1.transitionTo(FIGHTER_STATE.VICTORY);
            this.f2.transitionTo(FIGHTER_STATE.DEFEAT);
        } else {
            this.f2.transitionTo(FIGHTER_STATE.VICTORY);
            this.f1.transitionTo(FIGHTER_STATE.DEFEAT);
        }
        this.events.push({
            type: 'KO',
            winner: winnerId
        });
    }

    handleTimeout() {
        this.isMatchOver = true;
        if (this.f1.hp > this.f2.hp) {
            this.declareWinner('p1');
        } else if (this.f2.hp > this.f1.hp) {
            this.declareWinner('p2');
        } else {
            this.winner = 'DRAW';
            this.events.push({ type: 'TIMEOUT_DRAW' });
        }
    }

    /**
     * Export lightweight serializable snapshot for WebRTC transmission
     */
    getSnapshot() {
        const serializeFighter = (f) => ({
            x: Number(f.x.toFixed(2)),
            y: Number(f.y.toFixed(2)),
            z: Number(f.z.toFixed(2)),
            vx: Number(f.vx.toFixed(2)),
            vy: Number(f.vy.toFixed(2)),
            vz: Number(f.vz.toFixed(2)),
            facing: f.facing,
            facingAngle: Number(f.facingAngle.toFixed(3)),
            hp: f.hp,
            poise: Math.round(f.poise),
            state: f.state,
            stateTimer: f.stateTimer,
            moveId: f.currentMove ? f.currentMove.id : null,
            combo: f.comboCount
        });

        return {
            frame: this.currentFrame,
            time: Math.ceil(this.roundTimer / 60),
            p1: serializeFighter(this.f1),
            p2: serializeFighter(this.f2),
            over: this.isMatchOver,
            winner: this.winner
        };
    }
}
