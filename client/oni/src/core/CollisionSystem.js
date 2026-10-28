/**
 * CollisionSystem - Hitbox / Hurtbox / Pushbox Pipeline
 * Pure mathematical intersection checks without physics engine overhead.
 */

export class CollisionSystem {
    /**
     * Check pushbox overlap and separate two fighters on X/Z plane
     * @param {Object} f1 Fighter 1
     * @param {Object} f2 Fighter 2
     * @param {number} radius Character collision radius
     */
    static resolvePushbox(f1, f2, radius = 0.65) {
        const dx = f2.x - f1.x;
        const dz = f2.z - f1.z;
        const distSq = dx * dx + dz * dz;
        const minDist = radius * 2;

        if (distSq < minDist * minDist && distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const overlap = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const nz = dz / dist;

            f1.x -= nx * overlap;
            f1.z -= nz * overlap;
            f2.x += nx * overlap;
            f2.z += nz * overlap;
        }
    }

    /**
     * Get world position of fighter's active hitbox
     */
    static getActiveHitboxWorld(attacker) {
        if (!attacker.currentMove) return null;
        const move = attacker.currentMove;
        const frameInMove = attacker.stateTimer;

        // Is move in active frames?
        const start = move.startup;
        const end = move.startup + move.active;
        if (frameInMove < start || frameInMove >= end) {
            return null;
        }

        const facingSign = attacker.facing; // +1 or -1
        const offset = move.hitbox.offset;

        return {
            x: attacker.x + offset.x * facingSign,
            y: attacker.y + offset.y,
            z: attacker.z + offset.z,
            radius: move.hitbox.radius,
            move: move
        };
    }

    /**
     * Get defender's hurtbox spheres
     */
    static getHurtboxesWorld(defender) {
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
     * @returns {Object|null} Collision result { hitPoint, move, isBlock, hurtPart }
     */
    static checkHit(attacker, defender) {
        // Can't hit if defender is in invincible wakeup or already knocked down/dead
        if (defender.invincible || defender.hp <= 0 || defender.state === 'KNOCKED_DOWN' || defender.state === 'WAKEUP') {
            return null;
        }

        const hitbox = this.getActiveHitboxWorld(attacker);
        if (!hitbox) return null;

        // Has this move already hit during this execution?
        if (attacker.hasHitThisMove) return null;

        const hurtboxes = this.getHurtboxesWorld(defender);

        for (let i = 0; i < hurtboxes.length; i++) {
            const hurt = hurtboxes[i];
            const dx = hitbox.x - hurt.x;
            const dy = hitbox.y - hurt.y;
            const dz = hitbox.z - hurt.z;
            const rSum = hitbox.radius + hurt.radius;

            if (dx * dx + dy * dy + dz * dz <= rSum * rSum) {
                // Intersected!
                const hitPoint = {
                    x: (hitbox.x + hurt.x) * 0.5,
                    y: (hitbox.y + hurt.y) * 0.5,
                    z: (hitbox.z + hurt.z) * 0.5
                };

                // Check block: is defender actively blocking or walking back?
                const isFacingAttacker = (defender.facing === 1 && attacker.x > defender.x) ||
                                         (defender.facing === -1 && attacker.x < defender.x);
                const isBlock = defender.isBlocking && isFacingAttacker && !hitbox.move.isLow;

                return {
                    hitPoint,
                    move: hitbox.move,
                    isBlock,
                    hurtPart: hurt.part
                };
            }
        }

        return null;
    }
}
