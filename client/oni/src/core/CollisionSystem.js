/**
 * CollisionSystem - Hitbox / Hurtbox / Pushbox & Spatial Sector Pipeline
 * Pure mathematical intersection checks in 3D (supporting arbitrary yaw facingAngle).
 */

import { FIGHTER_STATE, STAGE_BOUNDS, INDOOR_BOUNDS, STAGE_CONFIG } from './Constants.js';

export class CollisionSystem {
    /**
     * Active Stage Geometry Mode:
     *   - 'ROOFTOP': Multi-elevation rooftop deck (y = 0), lower catwalk (y = -1.8), outer abyss (-Infinity)
     *   - 'INDOOR_FLAT': Enclosed flat indoor dojo / warehouse / lab floor (y = 0 everywhere, zero fall/ring-out risk)
     */
    static stageType = 'ROOFTOP';
    static obstacles = [];
    static customBounds = null;

    static setStageType(type = 'ROOFTOP') {
        this.stageType = type === 'INDOOR_FLAT' ? 'INDOOR_FLAT' : 'ROOFTOP';
    }

    static isIndoor() {
        return this.stageType === 'INDOOR_FLAT';
    }

    static setCustomBounds(bounds = null) {
        this.customBounds = bounds;
    }

    static getActiveBounds() {
        if (this.customBounds) return this.customBounds;
        return this.stageType === 'INDOOR_FLAT' ? INDOOR_BOUNDS : STAGE_BOUNDS;
    }

    /**
     * Set active tactical obstacles for campaign sectors (cargo containers, terminals, laser gates)
     */
    static setObstacles(list = []) {
        this.obstacles = Array.isArray(list) ? list : [];
    }

    static clearObstacles() {
        this.obstacles = [];
    }

    /**
     * Resolve character collision against static obstacles in the zone.
     * Pushes the character out along the penetration vector (AABB sliding).
     */
    static resolveObstacles(fighter, radius = 0.45) {
        if (!this.obstacles || this.obstacles.length === 0) return;
        const fy = fighter.y || 0;

        for (let i = 0; i < this.obstacles.length; i++) {
            const obs = this.obstacles[i];
            if (obs.active === false) continue;
            // Height check
            const obsHeight = obs.height || 3.0;
            if (fy < (obs.minY || 0) - 0.2 || fy > (obs.minY || 0) + obsHeight) continue;

            const minX = obs.minX - radius;
            const maxX = obs.maxX + radius;
            const minZ = obs.minZ - radius;
            const maxZ = obs.maxZ + radius;

            if (fighter.x > minX && fighter.x < maxX && fighter.z > minZ && fighter.z < maxZ) {
                // Find shallowest axis to push out
                const dLeft = fighter.x - minX;
                const dRight = maxX - fighter.x;
                const dTop = fighter.z - minZ;
                const dBottom = maxZ - fighter.z;
                const minPen = Math.min(dLeft, dRight, dTop, dBottom);

                if (minPen === dLeft) {
                    fighter.x = minX;
                    if (fighter.vx > 0) fighter.vx = 0;
                } else if (minPen === dRight) {
                    fighter.x = maxX;
                    if (fighter.vx < 0) fighter.vx = 0;
                } else if (minPen === dTop) {
                    fighter.z = minZ;
                    if (fighter.vz > 0) fighter.vz = 0;
                } else {
                    fighter.z = maxZ;
                    if (fighter.vz < 0) fighter.vz = 0;
                }
            }
        }
    }

    /**
     * Check if a 2D line segment (x1, z1) -> (x2, z2) hits any projectile-blocking obstacle
     * @returns {Object|null} { hit: true, x, z, obstacle }
     */
    static checkRayObstacles(x1, z1, x2, z2) {
        if (!this.obstacles || this.obstacles.length === 0) return null;
        let nearestHit = null;
        let minDistSq = Infinity;

        for (let i = 0; i < this.obstacles.length; i++) {
            const obs = this.obstacles[i];
            if (obs.active === false || obs.blocksProjectiles === false) continue;

            // Liang-Barsky / Slab method for 2D line vs AABB
            const minX = obs.minX, maxX = obs.maxX;
            const minZ = obs.minZ, maxZ = obs.maxZ;
            const dx = x2 - x1;
            const dz = z2 - z1;

            let t0 = 0.0;
            let t1 = 1.0;

            const p = [-dx, dx, -dz, dz];
            const q = [x1 - minX, maxX - x1, z1 - minZ, maxZ - z1];

            let parallelAndOutside = false;
            for (let k = 0; k < 4; k++) {
                if (Math.abs(p[k]) < 1e-6) {
                    if (q[k] < 0) {
                        parallelAndOutside = true;
                        break;
                    }
                } else {
                    const r = q[k] / p[k];
                    if (p[k] < 0) {
                        if (r > t1) { parallelAndOutside = true; break; }
                        if (r > t0) t0 = r;
                    } else {
                        if (r < t0) { parallelAndOutside = true; break; }
                        if (r < t1) t1 = r;
                    }
                }
            }

            if (!parallelAndOutside && t0 <= t1 && t0 >= 0 && t0 <= 1.0) {
                const hitX = x1 + dx * t0;
                const hitZ = z1 + dz * t0;
                const dSq = (hitX - x1) * (hitX - x1) + (hitZ - z1) * (hitZ - z1);
                if (dSq < minDistSq) {
                    minDistSq = dSq;
                    nearestHit = { hit: true, x: hitX, z: hitZ, obstacle: obs };
                }
            }
        }
        return nearestHit;
    }

    /**
     * P5 Rooftop / Indoor Arena Elevation Query
     * Returns the floor height Y at world coordinates (x, z):
     *   - In 'INDOOR_FLAT' mode: flat y = 0.0 everywhere (no ledges, no fall damage, no Ring-Out)
     *   - In 'ROOFTOP' mode:
     *       * Upper Rooftop Deck: |x| <= 6.4, |z| <= 4.6 -> y = 0.0
     *       * Lower Perimeter Catwalk: |x| <= 9.8, |z| <= 5.8 -> y = -1.8
     *       * Outer Cyberpunk Abyss: beyond catwalk -> -Infinity (Ring-Out!)
     */
    static getFloorHeightAt(x, z) {
        if (this.stageType === 'INDOOR_FLAT') {
            return STAGE_CONFIG.UPPER_DECK_Y;
        }
        const ax = Math.abs(x);
        const az = Math.abs(z);
        if (ax <= STAGE_CONFIG.UPPER_DECK_X && az <= STAGE_CONFIG.UPPER_DECK_Z) {
            return STAGE_CONFIG.UPPER_DECK_Y;
        }
        if (ax <= STAGE_CONFIG.LOWER_CATWALK_X && az <= STAGE_CONFIG.LOWER_CATWALK_Z) {
            return STAGE_CONFIG.LOWER_CATWALK_Y;
        }
        return -Infinity;
    }

    /**
     * Returns which platform zone (x, z) belongs to: 'UPPER_DECK' | 'LOWER_CATWALK' | 'ABYSS'
     */
    static getPlatformZone(x, z) {
        if (this.stageType === 'INDOOR_FLAT') {
            return 'UPPER_DECK';
        }
        const ax = Math.abs(x);
        const az = Math.abs(z);
        if (ax <= STAGE_CONFIG.UPPER_DECK_X && az <= STAGE_CONFIG.UPPER_DECK_Z) {
            return 'UPPER_DECK';
        }
        if (ax <= STAGE_CONFIG.LOWER_CATWALK_X && az <= STAGE_CONFIG.LOWER_CATWALK_Z) {
            return 'LOWER_CATWALK';
        }
        return 'ABYSS';
    }
    /**
     * Get 2D unit forward vector (fx, fz) for a fighter.
     * If facingAngle is defined and finite, uses (cos(facingAngle), sin(facingAngle));
     * otherwise falls back to (facingSign, 0).
     */
    static getForwardVector(fighter) {
        if (typeof fighter.facingAngle === 'number' && Number.isFinite(fighter.facingAngle)) {
            return {
                fx: Math.cos(fighter.facingAngle),
                fz: Math.sin(fighter.facingAngle)
            };
        }
        const s = fighter.facing === -1 ? -1 : 1;
        return { fx: s, fz: 0 };
    }

    /**
     * Compute relative spatial sector of `attacker` with respect to `defender`'s facing direction.
     * Used for context-sensitive throws (Shoulder Throw in FRONT, Head Scissors on SIDE/RUN,
     * Suplex / Neck Snap from BACK) and directional block validation.
     * @returns {'FRONT' | 'SIDE' | 'BACK'}
     */
    static getRelativeSector(defender, attacker) {
        const { fx, fz } = this.getForwardVector(defender);
        const dx = attacker.x - defender.x;
        const dz = attacker.z - defender.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.0001) return 'FRONT';

        const nx = dx / len;
        const nz = dz / len;
        const dot = nx * fx + nz * fz; // +1 = directly in front of defender, -1 = directly behind defender

        if (dot >= 0.35) return 'FRONT';
        if (dot <= -0.35) return 'BACK';
        return 'SIDE';
    }

    /**
     * Check pushbox overlap and separate two fighters on X/Z plane
     * @param {Object} f1 Fighter 1
     * @param {Object} f2 Fighter 2
     * @param {number} radius Character collision radius
     */
    static resolvePushbox(f1, f2, radius = 0.65) {
        // Do not push apart during synchronized throw animation
        if (
            f1.state === FIGHTER_STATE.THROW ||
            f2.state === FIGHTER_STATE.THROW ||
            f1.state === FIGHTER_STATE.BEING_THROWN ||
            f2.state === FIGHTER_STATE.BEING_THROWN
        ) {
            return;
        }

        // Do not push apart if two fighters are at significantly different elevations (> 0.9m)
        if (Math.abs((f1.y || 0) - (f2.y || 0)) > 0.9) {
            return;
        }

        const dx = f2.x - f1.x;
        const dz = f2.z - f1.z;
        const distSq = dx * dx + dz * dz;
        const minDist = radius * 2;

        if (distSq < minDist * minDist && distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const overlap = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const nz = dz / dist;

            // P5 Body Bowling (敌人浮空或倒地滑行后具有碰撞体积判定，可撞飞或撞落高台边缘的另一名角色)
            const f1Bowling =
                f1.state === FIGHTER_STATE.KNOCKED_DOWN &&
                Math.hypot(f1.vx || 0, f1.vz || 0) > 3.2;
            const f2Bowling =
                f2.state === FIGHTER_STATE.KNOCKED_DOWN &&
                Math.hypot(f2.vx || 0, f2.vz || 0) > 3.2;

            if (f1Bowling && !f2Bowling && !f2.invincible) {
                f2.vx = (f2.vx || 0) + (f1.vx || 0) * 0.65;
                f2.vz = (f2.vz || 0) + (f1.vz || 0) * 0.65;
                f2.poise = Math.max(0, (f2.poise || 0) - STAGE_CONFIG.BODY_BOWL_POISE);
            } else if (f2Bowling && !f1Bowling && !f1.invincible) {
                f1.vx = (f1.vx || 0) + (f2.vx || 0) * 0.65;
                f1.vz = (f1.vz || 0) + (f2.vz || 0) * 0.65;
                f1.poise = Math.max(0, (f1.poise || 0) - STAGE_CONFIG.BODY_BOWL_POISE);
            }

            f1.x -= nx * overlap;
            f1.z -= nz * overlap;
            f2.x += nx * overlap;
            f2.z += nz * overlap;
        }
    }

    /**
     * Get world position of fighter's active hitbox, rotated by fighter's yaw facing vector
     */
    static getActiveHitboxWorld(attacker) {
        if (!attacker.currentMove || attacker.currentMove.isThrow) return null;
        const move = attacker.currentMove;
        if (!move.hitbox) return null;

        const frameInMove = attacker.stateTimer;
        const start = move.startup;
        const end = move.startup + move.active;
        if (frameInMove < start || frameInMove >= end) {
            return null;
        }

        const { fx, fz } = this.getForwardVector(attacker);
        const offset = move.hitbox.offset;

        // Local offset.x is forward, offset.z is lateral right
        const worldX = attacker.x + offset.x * fx - offset.z * fz;
        const worldZ = attacker.z + offset.x * fz + offset.z * fx;

        return {
            x: worldX,
            y: attacker.y + offset.y,
            z: worldZ,
            radius: move.hitbox.radius,
            move: move
        };
    }

    /**
     * Get defender's hurtbox spheres (adapts to standing, crouching, or knocked down on ground)
     */
    static getHurtboxesWorld(defender) {
        if (defender.state === FIGHTER_STATE.KNOCKED_DOWN) {
            return [
                { x: defender.x, y: defender.y + 0.28, z: defender.z, radius: 0.45, part: 'grounded' }
            ];
        }
        if (defender.state === FIGHTER_STATE.CROUCH) {
            return [
                { x: defender.x, y: defender.y + 1.05, z: defender.z, radius: 0.30, part: 'head' },
                { x: defender.x, y: defender.y + 0.72, z: defender.z, radius: 0.36, part: 'torso' },
                { x: defender.x, y: defender.y + 0.38, z: defender.z, radius: 0.34, part: 'legs' }
            ];
        }
        return [
            // Head
            { x: defender.x, y: defender.y + 1.55, z: defender.z, radius: 0.28, part: 'head' },
            // Torso
            { x: defender.x, y: defender.y + 1.10, z: defender.z, radius: 0.36, part: 'torso' },
            // Legs / Low
            { x: defender.x, y: defender.y + 0.45, z: defender.z, radius: 0.34, part: 'legs' }
        ];
    }

    /**
     * Check if attacker's active hitbox intersects defender's hurtboxes
     * @returns {Object|null} Collision result { hitPoint, move, isBlock, hurtPart, isJuggle }
     */
    static checkHit(attacker, defender) {
        if (
            defender.invincible ||
            defender.hp <= 0 ||
            defender.state === FIGHTER_STATE.WAKEUP ||
            defender.state === FIGHTER_STATE.TECH_RECOVERY ||
            defender.state === FIGHTER_STATE.BEING_THROWN
        ) {
            return null;
        }

        const hitbox = this.getActiveHitboxWorld(attacker);
        if (!hitbox) return null;

        if (attacker.hasHitThisMove) return null;

        // Grounded opponents can only be hit by moves with `hitsGrounded` (e.g. Ground Stomp)
        // UNLESS they are still airborne (juggle physics!)
        const isGroundedDown = defender.state === FIGHTER_STATE.KNOCKED_DOWN && defender.isGrounded;
        if (isGroundedDown && !hitbox.move.hitsGrounded) {
            return null;
        }

        const hurtboxes = this.getHurtboxesWorld(defender);

        for (let i = 0; i < hurtboxes.length; i++) {
            const hurt = hurtboxes[i];
            const dx = hitbox.x - hurt.x;
            const dy = hitbox.y - hurt.y;
            const dz = hitbox.z - hurt.z;
            const rSum = hitbox.radius + hurt.radius;

            if (dx * dx + dy * dy + dz * dz <= rSum * rSum) {
                const hitPoint = {
                    x: (hitbox.x + hurt.x) * 0.5,
                    y: (hitbox.y + hurt.y) * 0.5,
                    z: (hitbox.z + hurt.z) * 0.5
                };

                // Check block: defender must be blocking AND facing attacker (in FRONT sector),
                // and low sweeps break standing high guards unless crouching.
                const sector = this.getRelativeSector(defender, attacker);
                const isFacingAttacker = sector === 'FRONT';
                const lowGuardBreak = hitbox.move.isLow && defender.state !== FIGHTER_STATE.CROUCH;
                const isBlock =
                    !hitbox.move.piercesGuard &&
                    defender.isBlocking &&
                    isFacingAttacker &&
                    !lowGuardBreak &&
                    !isGroundedDown;

                return {
                    hitPoint,
                    move: hitbox.move,
                    isBlock,
                    hurtPart: hurt.part,
                    isJuggle: !defender.isGrounded
                };
            }
        }

        return null;
    }

    /**
     * Check if a ray / beam from (ox, oy, oz) in direction (fx, fz) up to `maxRange`
     * intersects `defender`'s hurtboxes.
     * @returns {Object|null} { hitPoint, move, isBlock, hurtPart, isJuggle, distance }
     */
    static checkRayHit(attacker, defender, ox, oy, oz, fx, fz, maxRange, syntheticMove) {
        if (
            defender.invincible ||
            defender.hp <= 0 ||
            defender.state === FIGHTER_STATE.WAKEUP ||
            defender.state === FIGHTER_STATE.TECH_RECOVERY ||
            defender.state === FIGHTER_STATE.BEING_THROWN
        ) {
            return null;
        }

        const dx = defender.x - ox;
        const dz = defender.z - oz;
        const proj = dx * fx + dz * fz; // distance along ray
        if (proj < 0 || proj > maxRange) return null;

        // Lateral distance from ray in XZ plane
        const perpX = dx - proj * fx;
        const perpZ = dz - proj * fz;
        const lateralDist = Math.hypot(perpX, perpZ);

        const hurtboxes = this.getHurtboxesWorld(defender);
        const beamRadius = 0.25;

        for (let i = 0; i < hurtboxes.length; i++) {
            const hurt = hurtboxes[i];
            if (lateralDist <= hurt.radius + beamRadius && Math.abs(oy - hurt.y) <= hurt.radius + 0.45) {
                const hitPoint = {
                    x: ox + fx * Math.max(0.2, proj - hurt.radius * 0.5),
                    y: hurt.y,
                    z: oz + fz * Math.max(0.2, proj - hurt.radius * 0.5)
                };

                const sector = this.getRelativeSector(defender, attacker);
                const isFacingAttacker = sector === 'FRONT';
                const isBlock =
                    !syntheticMove.piercesGuard &&
                    defender.isBlocking &&
                    isFacingAttacker &&
                    defender.state !== FIGHTER_STATE.KNOCKED_DOWN;

                return {
                    hitPoint,
                    move: syntheticMove,
                    isBlock,
                    hurtPart: hurt.part,
                    isJuggle: !defender.isGrounded && defender.y > 0.12,
                    distance: proj
                };
            }
        }
        return null;
    }

    /**
     * Check if a point/sphere projectile intersects `defender`'s hurtboxes
     */
    static checkSphereHit(attacker, defender, px, py, pz, radius, syntheticMove) {
        if (
            defender.invincible ||
            defender.hp <= 0 ||
            defender.state === FIGHTER_STATE.WAKEUP ||
            defender.state === FIGHTER_STATE.TECH_RECOVERY ||
            defender.state === FIGHTER_STATE.BEING_THROWN
        ) {
            return null;
        }

        const hurtboxes = this.getHurtboxesWorld(defender);
        for (let i = 0; i < hurtboxes.length; i++) {
            const hurt = hurtboxes[i];
            const dx = px - hurt.x;
            const dy = py - hurt.y;
            const dz = pz - hurt.z;
            const rSum = radius + hurt.radius;
            if (dx * dx + dy * dy + dz * dz <= rSum * rSum) {
                const sector = this.getRelativeSector(defender, { x: px - dx, z: pz - dz });
                const isBlock =
                    !syntheticMove.piercesGuard &&
                    defender.isBlocking &&
                    sector === 'FRONT' &&
                    defender.state !== FIGHTER_STATE.KNOCKED_DOWN;
                return {
                    hitPoint: { x: (px + hurt.x) * 0.5, y: (py + hurt.y) * 0.5, z: (pz + hurt.z) * 0.5 },
                    move: syntheticMove,
                    isBlock,
                    hurtPart: hurt.part,
                    isJuggle: !defender.isGrounded && defender.y > 0.12
                };
            }
        }
        return null;
    }
}
