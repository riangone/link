/**
 * Link Spin 3D - AI Bot Brain
 * Tactical Decision Making for Easy, Normal, and Hard CPU Opponents.
 */

import { STADIUM_RADIUS, RAIL_ARCS, POCKET_ANGLES } from './Constants.js';

export class BotBrain3D {
    constructor(difficulty = 'normal') {
        this.difficulty = difficulty; // 'easy', 'normal', 'hard'
        this.thinkCooldown = 0;
        this.launchPower = 0.85;
        this.targetAngle = 0;
    }

    setDifficulty(diff) {
        this.difficulty = diff;
    }

    getLaunchParams() {
        if (this.difficulty === 'easy') {
            return {
                power: 0.65 + Math.random() * 0.25,
                perfect: false
            };
        } else if (this.difficulty === 'normal') {
            return {
                power: 0.82 + Math.random() * 0.16,
                perfect: Math.random() < 0.25
            };
        } else {
            // Hard bot
            return {
                power: 0.95 + Math.random() * 0.05,
                perfect: true
            };
        }
    }

    update(botTop, opponentTop, dt) {
        if (botTop.status !== 'spinning') return null;

        this.thinkCooldown -= dt;
        if (this.thinkCooldown > 0) return null;

        // Think interval varies with difficulty (Hard reacts faster)
        this.thinkCooldown = this.difficulty === 'hard' ? 0.08 : (this.difficulty === 'normal' ? 0.15 : 0.3);

        const actions = {
            steerX: 0,
            steerZ: 0,
            triggerSpecial: false
        };

        const distToOpp = Math.hypot(botTop.x - opponentTop.x, botTop.z - opponentTop.z);
        const botR = Math.hypot(botTop.x, botTop.z);
        const oppR = Math.hypot(opponentTop.x, opponentTop.z);

        // Special Move Decision
        if (botTop.specialGauge >= 100) {
            if (this.difficulty === 'easy' && Math.random() < 0.15) {
                actions.triggerSpecial = true;
            } else if (this.difficulty === 'normal' && distToOpp < 12.0) {
                actions.triggerSpecial = true;
            } else if (this.difficulty === 'hard') {
                // Hard: use special when near opponent or when opponent is near pocket
                if (distToOpp < 10.0 || oppR > 22.0) {
                    actions.triggerSpecial = true;
                }
            }
        }

        // Steering & Tactics
        if (this.difficulty === 'easy') {
            // Random meandering
            const randAng = Math.random() * Math.PI * 2;
            actions.steerX = Math.cos(randAng) * 0.4;
            actions.steerZ = Math.sin(randAng) * 0.4;
        } else if (this.difficulty === 'normal') {
            if (botTop.core.type === 'STAMINA' || botTop.core.type === 'DEFENSE') {
                // Settle in center bowl to minimize friction
                actions.steerX = -botTop.x * 0.04;
                actions.steerZ = -botTop.z * 0.04;
            } else {
                // Attack opponent
                const toOppX = (opponentTop.x - botTop.x) / (distToOpp || 1);
                const toOppZ = (opponentTop.z - botTop.z) / (distToOpp || 1);
                actions.steerX = toOppX * 0.6;
                actions.steerZ = toOppZ * 0.6;
            }
        } else {
            // Hard Bot: High Level Aggression & Rail Utilization
            if (botTop.core.gearRatio >= 0.8 && botTop.railCooldown <= 0 && botTop.xdashTimer <= 0) {
                // Aim for closest Xtreme Line rail entry
                let bestArc = RAIL_ARCS[0];
                let currentAng = Math.atan2(botTop.z, botTop.x);
                if (currentAng < 0) currentAng += Math.PI * 2;
                const mid0 = (RAIL_ARCS[0].start + RAIL_ARCS[0].end) * 0.5;
                const mid1 = (RAIL_ARCS[1].start + RAIL_ARCS[1].end) * 0.5;
                const diff0 = Math.abs(currentAng - mid0);
                const diff1 = Math.abs(currentAng - mid1);
                const targetMid = diff0 < diff1 ? mid0 : mid1;

                const railTargetX = Math.cos(targetMid) * 27.5;
                const railTargetZ = Math.sin(targetMid) * 27.5;
                const toRailX = railTargetX - botTop.x;
                const toRailZ = railTargetZ - botTop.z;
                const railDist = Math.hypot(toRailX, toRailZ);

                actions.steerX = (toRailX / (railDist || 1)) * 0.9;
                actions.steerZ = (toRailZ / (railDist || 1)) * 0.9;
            } else {
                // If in X-DASH or opponent is weak, charge directly into opponent
                const toOppX = (opponentTop.x - botTop.x) / (distToOpp || 1);
                const toOppZ = (opponentTop.z - botTop.z) / (distToOpp || 1);
                actions.steerX = toOppX * 1.0;
                actions.steerZ = toOppZ * 1.0;
            }
        }

        // Apply bot steer nudge
        const nudgeForce = botTop.core.accel * (this.difficulty === 'hard' ? 0.35 : 0.22);
        botTop.vx += actions.steerX * nudgeForce * dt;
        botTop.vz += actions.steerZ * nudgeForce * dt;

        if (actions.triggerSpecial) {
            botTop.specialGauge = 0;
            botTop.specialActiveTimer = 1.8;
            return { action: 'special', ownerIdx: botTop.ownerIdx };
        }

        return null;
    }
}
