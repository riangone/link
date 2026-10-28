/**
 * Simulation - Deterministic 60Hz Match Simulation Kernel
 * Manages game state, fighters, hitstop, events, and snapshot generation.
 */

import { Fighter } from './Fighter.js';
import { CollisionSystem } from './CollisionSystem.js';
import { FIGHTER_STATE } from './Constants.js';

export class Simulation {
    constructor() {
        this.f1 = new Fighter('p1', 'Konoko', -3.5, 1, false);
        this.f2 = new Fighter('p2', 'Syndi-Bot', 3.5, -1, true);

        this.roundTimer = 99 * 60; // 99 seconds in frames
        this.currentFrame = 0;
        this.hitstopFrames = 0;
        this.isMatchOver = false;
        this.winner = null;

        // Event queue for render/audio listeners (drained each frame)
        this.events = [];
    }

    reset() {
        this.f1.reset(-3.5, 1);
        this.f2.reset(3.5, -1);
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
    tick(input1, input2) {
        this.currentFrame++;
        this.events = [];

        // Hitstop freeze (for intense impact crunch)
        if (this.hitstopFrames > 0) {
            this.hitstopFrames--;
            return;
        }

        if (this.isMatchOver) {
            // Still run basic physics for falling fighters
            this.f1.update({ dirX: 0, dirZ: 0 }, this.f2);
            this.f2.update({ dirX: 0, dirZ: 0 }, this.f1);
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

        // 1. Update Fighters
        this.f1.update(input1, this.f2);
        this.f2.update(input2, this.f1);

        // 2. Resolve Pushbox overlap
        CollisionSystem.resolvePushbox(this.f1, this.f2, 0.65);

        // 3. Collision & Combat Detection
        // F1 hits F2
        const hitResult1 = CollisionSystem.checkHit(this.f1, this.f2);
        if (hitResult1) {
            this.f1.hasHitThisMove = true;
            this.f1.comboCount++;
            this.f1.comboResetTimer = 55; // frames to keep combo alive

            const hitInfo = this.f2.takeHit(hitResult1, this.f1.facing);
            const isHeavy = hitResult1.move.knockdown || hitResult1.move.damage >= 18;
            this.hitstopFrames = hitInfo.blocked ? 4 : (isHeavy ? 10 : 6);

            this.events.push({
                type: 'HIT',
                attacker: 'p1',
                defender: 'p2',
                hitPoint: hitResult1.hitPoint,
                move: hitResult1.move,
                damage: hitInfo.damage,
                blocked: hitInfo.blocked,
                combo: this.f1.comboCount,
                knockdown: hitResult1.move.knockdown || this.f2.hp <= 0
            });

            if (this.f2.hp <= 0) {
                this.declareWinner('p1');
            }
        }

        // F2 hits F1
        const hitResult2 = CollisionSystem.checkHit(this.f2, this.f1);
        if (hitResult2) {
            this.f2.hasHitThisMove = true;
            this.f2.comboCount++;
            this.f2.comboResetTimer = 55;

            const hitInfo = this.f1.takeHit(hitResult2, this.f2.facing);
            const isHeavy = hitResult2.move.knockdown || hitResult2.move.damage >= 18;
            this.hitstopFrames = hitInfo.blocked ? 4 : (isHeavy ? 10 : 6);

            this.events.push({
                type: 'HIT',
                attacker: 'p2',
                defender: 'p1',
                hitPoint: hitResult2.hitPoint,
                move: hitResult2.move,
                damage: hitInfo.damage,
                blocked: hitInfo.blocked,
                combo: this.f2.comboCount,
                knockdown: hitResult2.move.knockdown || this.f1.hp <= 0
            });

            if (this.f1.hp <= 0) {
                this.declareWinner('p2');
            }
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
        return {
            frame: this.currentFrame,
            time: Math.ceil(this.roundTimer / 60),
            p1: {
                x: Number(this.f1.x.toFixed(2)),
                y: Number(this.f1.y.toFixed(2)),
                z: Number(this.f1.z.toFixed(2)),
                vx: Number(this.f1.vx.toFixed(2)),
                vy: Number(this.f1.vy.toFixed(2)),
                vz: Number(this.f1.vz.toFixed(2)),
                facing: this.f1.facing,
                hp: this.f1.hp,
                state: this.f1.state,
                stateTimer: this.f1.stateTimer,
                moveId: this.f1.currentMove ? this.f1.currentMove.id : null,
                combo: this.f1.comboCount
            },
            p2: {
                x: Number(this.f2.x.toFixed(2)),
                y: Number(this.f2.y.toFixed(2)),
                z: Number(this.f2.z.toFixed(2)),
                vx: Number(this.f2.vx.toFixed(2)),
                vy: Number(this.f2.vy.toFixed(2)),
                vz: Number(this.f2.vz.toFixed(2)),
                facing: this.f2.facing,
                hp: this.f2.hp,
                state: this.f2.state,
                stateTimer: this.f2.stateTimer,
                moveId: this.f2.currentMove ? this.f2.currentMove.id : null,
                combo: this.f2.comboCount
            },
            over: this.isMatchOver,
            winner: this.winner
        };
    }
}
