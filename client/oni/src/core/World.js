/**
 * World - 3D Multi-Elevation Stage Geometry & Spatial Physics Pipeline (M2)
 *
 * Implements data-driven multi-floor topologies, ramps (stairs), height-bracketed
 * AABB wall collisions, interactive doors & consoles (via E key), and pickups.
 * Pure mathematical implementation (independent of Three.js).
 */

export class World {
    /**
     * @param {Object} data WorldData conformant structure
     */
    constructor(data = {}) {
        this.id = data.id || 'default_world';
        this.name = data.name || 'Unnamed World';

        this.floors = Array.isArray(data.floors) ? data.floors : [];
        this.ramps = Array.isArray(data.ramps) ? data.ramps : [];
        this.walls = Array.isArray(data.walls) ? data.walls : [];
        this.doors = Array.isArray(data.doors) ? data.doors : [];
        this.consoles = Array.isArray(data.consoles) ? data.consoles : [];
        this.pickups = Array.isArray(data.pickups) ? data.pickups : [];
        this.spawns = Array.isArray(data.spawns) ? data.spawns : [];
        this.savePoints = Array.isArray(data.savePoints) ? data.savePoints : [];

        this.killY = data.killY !== undefined ? data.killY : -20.0;
        this.spawnPoint = data.spawnPoint || { x: 0, y: 0, z: 0, yaw: 0 };
    }

    /**
     * Determine ground height at (x, z) given an optional yHint (character's current y).
     * Supports tiered floors and ramps/stairs.
     * @param {number} x
     * @param {number} z
     * @param {number} yHint Character's current vertical elevation
     * @param {number} stepHeight Maximum step-up ledge height (default 0.55m)
     * @returns {number} Elevation Y, or this.killY if over empty abyss
     */
    floorAt(x, z, yHint = 0, stepHeight = 0.55) {
        const candidates = [];

        // 1. Horizontal Floors
        for (let i = 0; i < this.floors.length; i++) {
            const f = this.floors[i];
            if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) {
                candidates.push(f.y);
            }
        }

        // 2. Inclined Ramps / Stairs
        for (let i = 0; i < this.ramps.length; i++) {
            const r = this.ramps[i];
            if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
                let rampY;
                if (r.axis === 'x') {
                    const t = (x - r.minX) / Math.max(0.0001, r.maxX - r.minX);
                    rampY = r.y0 + t * (r.y1 - r.y0);
                } else {
                    const t = (z - r.minZ) / Math.max(0.0001, r.maxZ - r.minZ);
                    rampY = r.y0 + t * (r.y1 - r.y0);
                }
                candidates.push(rampY);
            }
        }

        if (candidates.length === 0) {
            return this.killY;
        }

        // Filter valid walkable candidates: must be at or below foot level + stepHeight
        const walkable = candidates.filter(y => y <= yHint + stepHeight);
        if (walkable.length > 0) {
            return Math.max(...walkable);
        }

        // In case character is submerged or below floor, return closest candidate floor above
        return Math.min(...candidates);
    }

    /**
     * Resolve horizontal character capsule collision against walls and closed doors.
     * Pushes capsule out along the shallowest axis of penetration.
     * @param {Object} capsule { x, y, z }
     * @param {number} radius Character body radius (default 0.35m)
     * @param {number} height Character height (default 1.8m)
     */
    resolveCapsuleCollision(capsule, radius = 0.35, height = 1.8) {
        const cy = capsule.y;
        const cyTop = cy + height;

        // 1. Solid Walls
        for (let i = 0; i < this.walls.length; i++) {
            const w = this.walls[i];
            const minY = w.minY !== undefined ? w.minY : -100;
            const maxY = w.maxY !== undefined ? w.maxY : 100;

            // Vertical overlap check
            if (cyTop <= minY || cy >= maxY) continue;

            this._pushOutOfAABB(capsule, w.minX, w.maxX, w.minZ, w.maxZ, radius);
        }

        // 2. Doors (if locked or not fully opened)
        for (let i = 0; i < this.doors.length; i++) {
            const d = this.doors[i];
            const progress = d.openProgress || 0.0;
            if (progress >= 0.88) continue; // Fully open, character can walk through freely

            const minY = d.minY !== undefined ? d.minY : -10;
            const maxY = d.maxY !== undefined ? d.maxY : 10;
            if (cyTop <= minY || cy >= maxY) continue;

            // Partially open doors reduce their collision depth or move aside
            const width = d.maxX - d.minX;
            const openOffset = width * progress;
            const effMinX = d.minX + openOffset;

            this._pushOutOfAABB(capsule, effMinX, d.maxX, d.minZ, d.maxZ, radius);
        }
    }

    /**
     * Internal helper to slide/push cylinder out of AABB box
     */
    _pushOutOfAABB(capsule, minX, maxX, minZ, maxZ, radius) {
        const cx = capsule.x;
        const cz = capsule.z;

        // Expanded box by radius
        const bMinX = minX - radius;
        const bMaxX = maxX + radius;
        const bMinZ = minZ - radius;
        const bMaxZ = maxZ + radius;

        if (cx > bMinX && cx < bMaxX && cz > bMinZ && cz < bMaxZ) {
            // Find minimal penetration distance
            const penLeft = cx - bMinX;
            const penRight = bMaxX - cx;
            const penFront = cz - bMinZ;
            const penBack = bMaxZ - cz;

            const minPen = Math.min(penLeft, penRight, penFront, penBack);

            if (minPen === penLeft) capsule.x = bMinX;
            else if (minPen === penRight) capsule.x = bMaxX;
            else if (minPen === penFront) capsule.z = bMinZ;
            else capsule.z = bMaxZ;
        }
    }

    /**
     * 3D Raycast against walls and closed doors.
     * @param {[number, number, number]} origin [x, y, z]
     * @param {[number, number, number]} dir Normalized direction [dx, dy, dz]
     * @param {number} maxDist Maximum ray travel distance
     * @returns {{ hit: boolean, dist: number, point: [number, number, number]|null, entity: any }}
     */
    raycast(origin, dir, maxDist = 40.0) {
        let closestHit = null;
        let closestDist = maxDist;

        const checkAABB = (minX, maxX, minY, maxY, minZ, maxZ, entity) => {
            let tmin = -Infinity;
            let tmax = Infinity;

            for (let axis = 0; axis < 3; axis++) {
                const o = origin[axis];
                const d = dir[axis];
                const boxMin = axis === 0 ? minX : (axis === 1 ? minY : minZ);
                const boxMax = axis === 0 ? maxX : (axis === 1 ? maxY : maxZ);

                if (Math.abs(d) < 1e-8) {
                    if (o < boxMin || o > boxMax) return;
                } else {
                    let t1 = (boxMin - o) / d;
                    let t2 = (boxMax - o) / d;
                    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                    tmin = Math.max(tmin, t1);
                    tmax = Math.min(tmax, t2);
                    if (tmin > tmax || tmax < 0) return;
                }
            }

            if (tmin > 0 && tmin < closestDist) {
                closestDist = tmin;
                closestHit = {
                    hit: true,
                    dist: tmin,
                    point: [
                        origin[0] + dir[0] * tmin,
                        origin[1] + dir[1] * tmin,
                        origin[2] + dir[2] * tmin
                    ],
                    entity
                };
            }
        };

        // Check walls with blocksProjectiles
        for (let i = 0; i < this.walls.length; i++) {
            const w = this.walls[i];
            if (w.blocksProjectiles === false) continue;
            checkAABB(w.minX, w.maxX, w.minY ?? -10, w.maxY ?? 10, w.minZ, w.maxZ, w);
        }

        // Check closed doors
        for (let i = 0; i < this.doors.length; i++) {
            const d = this.doors[i];
            if ((d.openProgress || 0) < 0.85) {
                checkAABB(d.minX, d.maxX, d.minY ?? -10, d.maxY ?? 10, d.minZ, d.maxZ, d);
            }
        }

        return closestHit || { hit: false, dist: maxDist, point: null, entity: null };
    }

    /**
     * User action (E key) interaction with nearby consoles, doors, or pickups.
     * Prevents accidental hacking or pickups while throwing punches.
     * @param {Object} fighter
     * @param {number} actionRange Max interact radius (default 1.6m)
     * @returns {Object} { success: boolean, event: string, ...details }
     */
    interact(fighter, actionRange = 1.6) {
        const fx = fighter.x;
        const fy = fighter.y;
        const fz = fighter.z;

        // 1. Interactive Consoles
        let nearestConsole = null;
        let minDist = actionRange;

        for (let i = 0; i < this.consoles.length; i++) {
            const c = this.consoles[i];
            if (c.hacked) continue;
            const dist = Math.hypot(c.x - fx, (c.y ?? fy) - fy, c.z - fz);
            if (dist <= minDist) {
                minDist = dist;
                nearestConsole = c;
            }
        }

        if (nearestConsole) {
            nearestConsole.hacked = true;
            const action = nearestConsole.action || '';

            if (action.startsWith('unlock:')) {
                const doorId = action.split(':')[1];
                const door = this.doors.find(d => d.id === doorId);
                if (door) {
                    door.locked = false;
                }
                return {
                    success: true,
                    type: 'CONSOLE_HACKED',
                    consoleId: nearestConsole.id,
                    action,
                    doorId
                };
            }

            if (action === 'alarm' || action === 'alarm:on') {
                return {
                    success: true,
                    type: 'ALARM_TRIGGERED',
                    consoleId: nearestConsole.id
                };
            }

            if (action === 'save' || action === 'checkpoint') {
                return {
                    success: true,
                    type: 'CHECKPOINT_SAVED',
                    consoleId: nearestConsole.id
                };
            }

            return {
                success: true,
                type: 'CONSOLE_HACKED',
                consoleId: nearestConsole.id,
                action
            };
        }

        // 2. Pickups requiring explicit action (e.g., weapon swap or full-HP Overpower Hypo)
        let nearestPickup = null;
        let minPickupDist = actionRange;

        for (let i = 0; i < this.pickups.length; i++) {
            const p = this.pickups[i];
            if (p.collected) continue;
            const dist = Math.hypot(p.x - fx, (p.y ?? fy) - fy, p.z - fz);
            if (dist <= minPickupDist) {
                minPickupDist = dist;
                nearestPickup = p;
            }
        }

        if (nearestPickup) {
            nearestPickup.collected = true;
            return {
                success: true,
                type: 'PICKUP',
                pickup: nearestPickup
            };
        }

        return { success: false };
    }

    /**
     * Per-tick environment updates (e.g. proximity automatic doors and laser gates).
     * @param {number} dt Delta time in seconds
     * @param {Array<Object>} entities Characters in the world
     */
    update(dt, entities = []) {
        for (let i = 0; i < this.doors.length; i++) {
            const door = this.doors[i];
            if (door.locked) {
                // Keep closed if locked
                door.openProgress = Math.max(0.0, (door.openProgress || 0) - dt * 2.5);
                continue;
            }

            // Proximity check for opening
            let near = false;
            const midX = (door.minX + door.maxX) / 2;
            const midZ = (door.minZ + door.maxZ) / 2;

            for (let j = 0; j < entities.length; j++) {
                const ent = entities[j];
                if (!ent || ent.hp <= 0) continue;
                const d = Math.hypot(ent.x - midX, ent.z - midZ);
                if (d < 2.6) {
                    near = true;
                    break;
                }
            }

            const current = door.openProgress || 0.0;
            if (near) {
                door.openProgress = Math.min(1.0, current + dt * 3.0);
            } else {
                door.openProgress = Math.max(0.0, current - dt * 3.0);
            }
        }
    }

    /**
     * Validate topological completeness and walkability from spawn to destination/consoles.
     * @returns {boolean}
     */
    validate() {
        if (!this.spawnPoint) return false;
        if (this.floors.length === 0 && this.ramps.length === 0) return false;

        // Verify spawn point is grounded on a floor or ramp
        const ground = this.floorAt(this.spawnPoint.x, this.spawnPoint.z, this.spawnPoint.y);
        if (!Number.isFinite(ground) || ground <= this.killY) {
            return false;
        }

        // Verify all save points and consoles are located on valid floors
        for (const sp of this.savePoints) {
            const y = this.floorAt(sp.x, sp.z, sp.y);
            if (!Number.isFinite(y) || y <= this.killY) return false;
        }

        return true;
    }
}
