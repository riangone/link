/**
 * LevelLayouts — one data-driven map per campaign chapter (pure data, no Three.js).
 *
 * Chapters follow the original Oni (2001) location order. The maps are our own layouts built
 * around each location's character (container maze, assembly lines, glass labs, open terminal…);
 * they are NOT copies of the original level geometry.
 *
 * Every map shares the campaign skeleton: x ∈ [-28, 38], three sectors split by security gates
 * at x = -6 and x = 14. Each layout supplies:
 *   - halfWidth: corridor half width (z bounds)
 *   - path: monotonic-x polyline Konoko's critical path follows (crosses gates at |z| < 2.6)
 *   - build(rng, L): candidate set dressing; anything that would block the path, a spawn point,
 *     a prop or a console is pruned automatically, so maps stay completable by construction.
 * Spawn points, props and consoles are re-anchored onto the chapter's path (anchorZone).
 *
 * The SAME obstacle list feeds CollisionSystem and the renderer (no invisible walls).
 */

export const SECTOR_GATES = [-6, 14];
export const WORLD_X = { min: -28, max: 38 };
const PATH_CLEARANCE = 1.15;   // half width of the guaranteed walking lane
const POINT_CLEARANCE = 1.05;  // free radius around spawns / props / consoles
const GATE_OPENING = 3.5;      // the laser gate itself spans |z| <= 3.5

// deterministic RNG per chapter
function rngFor(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Axis-aligned box obstacle centred at (cx, cz). */
function box(kind, cx, cz, w, d, h = 2.6, extra = {}) {
    return {
        kind,
        minX: cx - w / 2, maxX: cx + w / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
        height: h,
        blocksProjectiles: h >= 1.0,
        ...extra
    };
}

/** A wall along z at x, cut into short segments so the path pruning carves doorways. */
function zWall(kind, x, z0, z1, h = 2.6, seg = 1.4, thick = 0.25) {
    const out = [];
    for (let z = z0; z < z1 - 1e-6; z += seg) {
        const zz = Math.min(z1, z + seg);
        out.push(box(kind, x, (z + zz) / 2, thick, zz - z, h));
    }
    return out;
}
/** A wall along x at z, segmented. */
function xWall(kind, z, x0, x1, h = 2.6, seg = 1.6, thick = 0.25) {
    const out = [];
    for (let x = x0; x < x1 - 1e-6; x += seg) {
        const xx = Math.min(x1, x + seg);
        out.push(box(kind, (x + xx) / 2, z, xx - x, thick, h));
    }
    return out;
}

const range = (a, b, step) => {
    const out = [];
    for (let v = a; v <= b + 1e-6; v += step) out.push(+v.toFixed(3));
    return out;
};

// ---------------------------------------------------------------------------------------------
// Chapter layouts
// ---------------------------------------------------------------------------------------------
export const LEVEL_LAYOUTS = {
    // Ch.1 Syndicate Warehouse — container stacks; the lane zig-zags through the aisles
    ch1: {
        theme: 'WAREHOUSE', halfWidth: 9, outdoor: false, seed: 101,
        path: [[-28, 0], [-20, 0], [-17, -5], [-11, -5], [-8, 0], [-2, 0], [0, 5], [9, 5], [11.5, 0], [38, 0]],
        build(rng) {
            const o = [];
            for (const x of range(-25, 11, 4.4)) {
                for (const z of [-7, -2.6, 2.6, 7]) {
                    if (rng() < 0.18) continue;
                    o.push(box('CONTAINER', x, z, 3.8, 2.3, rng() < 0.3 ? 5.4 : 2.8));
                }
            }
            for (const x of range(17, 35, 4.5)) {
                o.push(box('CONTAINER', x, -7, 3.8, 2.3, 2.8));
                o.push(box('CONTAINER', x, 7, 3.8, 2.3, rng() < 0.5 ? 5.4 : 2.8));
            }
            o.push(box('CRATE', 20, -3.4, 1.4, 1.4, 1.3), box('CRATE', 30, 3.6, 1.4, 1.4, 1.3));
            o.push(box('FORKLIFT', 25.5, 4.2, 2.2, 1.3, 1.6));
            return o;
        }
    },
    // Ch.2 Musashi manufacturing plant — long assembly lines and stamping presses
    ch2: {
        theme: 'FACTORY', halfWidth: 8, outdoor: false, seed: 202,
        path: [[-28, 0], [-14, 0], [-12, -4.5], [-8, -4.5], [-6, 0], [-2, 0], [0, -4], [8, -4], [11, 0], [16, 0], [18, 3.2], [38, 3.2]],
        build(rng) {
            const o = [];
            for (const z of [-6, -1.6, 2.2, 6]) {
                for (const x of range(-25, 11, 6.5)) o.push(box('CONVEYOR', x, z, 5.6, 1.4, 1.05));
            }
            for (const x of range(-23, 10, 7)) {
                o.push(box('PRESS', x + 2.8, rng() < 0.5 ? -6.8 : 6.8, 2.2, 1.8, 3.4));
            }
            for (const x of [20, 26, 32]) {
                o.push(box('FURNACE', x, -4.6, 3, 3, 4.2));
                o.push(box('PRESS', x + 2.5, 6.6, 2.2, 1.8, 3.4));
            }
            o.push(box('PIPE', 23, 0, 6, 0.8, 0.9));
            return o;
        }
    },
    // Ch.3 Bio-Research Lab — glass-partitioned rooms with doorways, specimen tanks, benches
    ch3: {
        theme: 'LAB', halfWidth: 7, outdoor: false, seed: 303,
        path: [[-28, 0], [-21, -3], [-15, -3], [-11, 3], [-6, 0], [-1, 0], [3, -3.5], [9, 2.5], [14, 0], [38, 0]],
        build(rng) {
            const o = [];
            for (const x of [-24, -18, -12, -1, 5, 10, 20, 31]) o.push(...zWall('GLASS', x, -7, 7, 2.6, 1.4));
            for (const x of range(-26, 12, 3)) {
                const z = rng() < 0.5 ? -5.7 : 5.7;
                o.push(box(rng() < 0.4 ? 'TANK' : 'BENCH', x, z, 1.2, 1.2, rng() < 0.4 ? 2.4 : 0.95));
            }
            for (const x of [17, 23, 28, 34]) {
                o.push(box('TANK', x, -4.6, 1.3, 1.3, 2.6), box('TANK', x, 4.6, 1.3, 1.3, 2.6));
            }
            return o;
        }
    },
    // Ch.4 Vansam Regional Airport — wide terminal hall: pillar grid, check-in counters, seat rows
    ch4: {
        theme: 'AIRPORT', halfWidth: 11, outdoor: false, seed: 404,
        path: [[-28, 0], [-10, 1.5], [6, -1.5], [38, 0]],
        build(rng) {
            const o = [];
            for (const x of range(-24, 36, 6)) for (const z of [-7.5, 7.5]) o.push(box('PILLAR', x, z, 1.1, 1.1, 5));
            for (const x of [-21, -15, -9]) o.push(box('COUNTER', x, -4.5, 3.6, 1.0, 1.1));
            for (const x of range(-3, 11, 4.5)) {
                o.push(box('SEATS', x, 3.6, 3.2, 0.8, 0.8), box('SEATS', x, 5.2, 3.2, 0.8, 0.8));
            }
            o.push(box('CAROUSEL', 25, 0, 6, 3.2, 0.9));
            for (const x of [19, 31]) o.push(box('KIOSK', x, -5, 1.6, 1.6, 2.2), box('KIOSK', x, 5, 1.6, 1.6, 2.2));
            if (rng() < 2) o.push(box('KIOSK', -4, -6, 1.6, 1.6, 2.2));
            return o;
        }
    },
    // Ch.5 Airport cargo hangars — huge open floor, crate stacks, a cargo jet you can walk under
    ch5: {
        theme: 'HANGAR', halfWidth: 12, outdoor: false, seed: 505,
        path: [[-28, 0], [-16, -3], [-4, 2], [8, -2], [38, -1]],
        build(rng) {
            const o = [];
            const cluster = (cx, cz) => {
                for (let i = 0; i < 4; i++) {
                    o.push(box('CRATE', cx + (i % 2) * 1.6, cz + Math.floor(i / 2) * 1.6, 1.5, 1.5, rng() < 0.5 ? 1.5 : 3.0));
                }
            };
            cluster(-22, 4); cluster(-12, -8); cluster(-8, 6); cluster(2, -8); cluster(10, 5);
            // cargo jet in the last hangar: fuselage blocks, wings overhead (minY) — walk underneath
            o.push(box('FUSELAGE', 27, 7.2, 18, 3.2, 3.6));
            o.push(box('WING', 27, 0.8, 5, 9.5, 0.45, { minY: 2.4, blocksProjectiles: false }));
            o.push(box('ENGINE', 24.5, 3.2, 2.2, 1.4, 1.4));
            for (const x of [18, 34]) o.push(box('PILLAR', x, -10, 1.2, 1.2, 8));
            return o;
        }
    },
    // Ch.6 TCTF Headquarters — office floor: cubicle partitions, desks, structural columns
    ch6: {
        theme: 'OFFICE', halfWidth: 8, outdoor: false, seed: 606,
        path: [[-28, 0], [-19, 0], [-16, 4.5], [-9, 4.5], [-7, 0], [0, 0], [2, -4.5], [10, -4.5], [12, 0], [38, 0]],
        build(rng) {
            const o = [];
            for (const x of range(-25, 11, 3.6)) {
                for (const z of [-5.8, -2.2, 2.2, 5.8]) {
                    if (rng() < 0.15) continue;
                    o.push(box('PARTITION', x, z, 0.2, 2.6, 1.45));
                    o.push(box('DESK', x + 1.0, z, 1.4, 1.2, 0.8));
                }
            }
            for (const x of [18, 26, 34]) o.push(box('PILLAR', x, -4.5, 1.2, 1.2, 4), box('PILLAR', x, 4.5, 1.2, 1.2, 4));
            o.push(box('DESK', 22, 0, 3, 1.4, 0.85));
            return o;
        }
    },
    // Ch.7 Atmospheric Conversion Center — giant processor columns, low pipe runs
    ch7: {
        theme: 'ATMOS', halfWidth: 9, outdoor: false, seed: 707,
        path: [[-28, 0], [-20, 3], [-12, -3], [-5, 0], [3, 3.5], [11, -2], [16, 0], [38, 0]],
        build(rng) {
            const o = [];
            for (const x of range(-24, 12, 6)) {
                o.push(box('COLUMN', x, -6, 3, 3, 7));
                o.push(box('COLUMN', x + 3, 6, 3, 3, 7));
            }
            for (const x of range(-26, 12, 4.5)) o.push(box('PIPE', x, rng() < 0.5 ? -2.8 : 2.8, 3.5, 0.7, 0.85));
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                o.push(box('COLUMN', 26 + Math.cos(a) * 7.5, Math.sin(a) * 6.5, 2.2, 2.2, 7));
            }
            return o;
        }
    },
    // Ch.8 Atmospheric Conversion Center, inner works — narrow catwalk slalom between machinery
    ch8: {
        theme: 'ATMOS_CORE', halfWidth: 5.5, outdoor: false, seed: 808,
        path: [[-28, 0], [-21, 2.6], [-15, -2.6], [-9, 2.4], [-6, 1], [-1, -2.6], [5, 2.6], [11, -1.5], [14, 0], [38, 0]],
        build() {
            const o = [];
            for (const x of range(-25, 12, 3)) {
                o.push(box('MACHINE', x, x % 6 === 0 ? 3.6 : -3.6, 2.2, 2.2, 3));
                o.push(box('MACHINE', x + 1.5, x % 6 === 0 ? -3.9 : 3.9, 1.4, 1.4, 2));
            }
            for (const x of range(18, 34, 4)) o.push(box('MACHINE', x, -4.1, 2, 1.6, 3), box('MACHINE', x + 2, 4.1, 2, 1.6, 3));
            return o;
        }
    },
    // Ch.9 Regional State Building — marble colonnades, reception, bookshelves
    ch9: {
        theme: 'STATE', halfWidth: 9, outdoor: false, seed: 909,
        path: [[-28, 0], [-6, 0], [2, 2.5], [12, 2.5], [14, 0], [38, 0]],
        build() {
            const o = [];
            for (const x of range(-25, 12, 3.4)) o.push(box('COLONNADE', x, -4.6, 1.0, 1.0, 5), box('COLONNADE', x, 4.6, 1.0, 1.0, 5));
            for (const x of range(-24, 12, 4)) o.push(box('SHELF', x, -8.2, 3, 0.7, 2.6), box('SHELF', x + 2, 8.2, 3, 0.7, 2.6));
            o.push(box('RECEPTION', -18, -2.4, 4, 1.2, 1.1), box('BENCH', -10, 2.4, 3, 0.8, 0.6), box('BENCH', 6, -2.4, 3, 0.8, 0.6));
            o.push(box('STATUE', 26, 0, 2.2, 2.2, 3.5));
            for (const x of [19, 33]) o.push(box('COLONNADE', x, -5, 1.2, 1.2, 5), box('COLONNADE', x, 5, 1.2, 1.2, 5));
            return o;
        }
    },
    // Ch.10 Rooftops — AC units, vents, water towers, skylights under the open sky
    ch10: {
        theme: 'ROOFTOP', halfWidth: 7, outdoor: true, seed: 1010,
        path: [[-28, 0], [-18, -2.5], [-10, 2.5], [-6, 0], [4, -3], [14, 0], [26, 2.5], [38, 0]],
        build(rng) {
            const o = [];
            for (const x of range(-25, 36, 3.8)) {
                const k = rng();
                const z = (rng() * 2 - 1) * 5.4;
                if (k < 0.35) o.push(box('AC_UNIT', x, z, 2.0, 1.4, 1.5));
                else if (k < 0.6) o.push(box('VENT', x, z, 0.9, 0.9, 1.1));
                else if (k < 0.8) o.push(box('SKYLIGHT', x, z, 2.4, 1.6, 0.6));
                else o.push(box('TOWER', x, z, 2.6, 2.6, 5));
            }
            o.push(...xWall('PARAPET', -6.6, -28, 38, 1.0, 3.2, 0.3), ...xWall('PARAPET', 6.6, -28, 38, 1.0, 3.2, 0.3));
            return o;
        }
    },
    // Ch.11 Dr. Hasegawa's lab / the dream — sparse monoliths floating in fog
    ch11: {
        theme: 'DREAM', halfWidth: 10, outdoor: true, seed: 1111,
        path: [[-28, 0], [-14, -3], [-6, 0], [4, 4], [14, 0], [24, -3], [38, 0]],
        build(rng) {
            const o = [];
            for (let i = 0; i < 34; i++) {
                const x = -26 + rng() * 63;
                const z = (rng() * 2 - 1) * 8.5;
                const s = 0.8 + rng() * 1.8;
                o.push(box('MONOLITH', x, z, s, s, 2.5 + rng() * 5));
            }
            return o;
        }
    },
    // Ch.12 TCTF Science Prison #112 — cell blocks on both sides of a guarded corridor
    ch12: {
        theme: 'PRISON', halfWidth: 7, outdoor: false, seed: 1212,
        path: [[-28, 0], [-6, 0], [-2, -1.5], [12, -1.5], [14, 0], [38, 0]],
        build() {
            const o = [];
            for (const x of range(-27, 12, 3.2)) {
                for (const s of [-1, 1]) {
                    o.push(box('CELL_WALL', x, s * 5.2, 0.3, 3.6, 3));
                    o.push(...xWall('BARS', s * 3.3, x + 0.2, x + 3.0, 3, 0.95, 0.12));
                }
            }
            for (const x of [-16, 2]) o.push(box('BOOTH', x, 2.3, 2, 1.6, 2.4));
            for (const x of range(18, 34, 4)) o.push(box('CELL_WALL', x, -5.5, 2.6, 2.6, 3), box('CELL_WALL', x + 2, 5.5, 2.6, 2.6, 3));
            return o;
        }
    },
    // Ch.13 TCTF Headquarters (assault) — server racks and security checkpoints to the vault
    ch13: {
        theme: 'HQ_VAULT', halfWidth: 8, outdoor: false, seed: 1313,
        path: [[-28, 0], [-17, 3], [-9, -3], [-6, 0], [3, 0], [7, 4], [12, 1], [14, 0], [38, 0]],
        build() {
            const o = [];
            for (const x of range(-25, 12, 2.6)) {
                for (const z of [-5.6, -1.8, 1.8, 5.6]) o.push(box('RACK', x, z, 0.9, 2.6, 2.4));
            }
            for (const gx of [-14, 4]) o.push(box('CHECKPOINT', gx, -5, 1.6, 2.4, 1.15), box('CHECKPOINT', gx, 5, 1.6, 2.4, 1.15));
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                o.push(box('VAULT_PILLAR', 26 + Math.cos(a) * 8, Math.sin(a) * 6, 1.3, 1.3, 5));
            }
            return o;
        }
    },
    // Ch.14 Syndicate mountain compound — snowy courtyard: rocks, bunkers, sandbag lines
    ch14: {
        theme: 'COMPOUND', halfWidth: 12, outdoor: true, seed: 1414,
        path: [[-28, 0], [-18, 4], [-8, -2], [-6, -1], [2, 5], [12, -1], [14, 0], [38, 0]],
        build(rng) {
            const o = [];
            for (let i = 0; i < 26; i++) {
                const x = -26 + rng() * 62;
                const z = (rng() * 2 - 1) * 10.5;
                const s = 1 + rng() * 2.4;
                o.push(box('ROCK', x, z, s, s * (0.7 + rng() * 0.6), 0.8 + rng() * 2.2));
            }
            for (const [x, z] of [[-20, -7], [-10, 8], [4, -8], [10, 8], [22, -8], [32, 8]]) o.push(box('BUNKER', x, z, 4.4, 3.2, 2.6));
            for (const x of range(-24, 34, 7)) o.push(box('SANDBAG', x, (x % 2 === 0 ? 1 : -1) * 4.5, 3, 0.8, 0.9));
            return o;
        }
    }
};

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/** z of the path polyline at x (paths are monotonic in x). */
export function pathZ(path, x) {
    if (x <= path[0][0]) return path[0][1];
    for (let i = 1; i < path.length; i++) {
        const [x0, z0] = path[i - 1], [x1, z1] = path[i];
        if (x <= x1) {
            const t = (x - x0) / Math.max(1e-6, x1 - x0);
            return z0 + (z1 - z0) * t;
        }
    }
    return path[path.length - 1][1];
}

function rectPointDist(o, x, z) {
    const dx = Math.max(o.minX - x, 0, x - o.maxX);
    const dz = Math.max(o.minZ - z, 0, z - o.maxZ);
    return Math.hypot(dx, dz);
}

function rectSegmentDist(o, ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(len / 0.25));
    let best = Infinity;
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        best = Math.min(best, rectPointDist(o, ax + (bx - ax) * t, az + (bz - az) * t));
    }
    return best;
}

export function rectPathDist(o, path) {
    let best = Infinity;
    for (let i = 1; i < path.length; i++) {
        best = Math.min(best, rectSegmentDist(o, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
    }
    return best;
}

/**
 * Re-anchor one zone's spawns / props / consoles onto the chapter path. Keeps every x
 * (gate & boss logic depend on it) and alternates the lateral offsets.
 */
export function anchorZone(zone, layout) {
    const W = layout.halfWidth - 1.2;
    const clampZ = (z) => Math.max(-W, Math.min(W, z));
    const on = (x, off = 0) => clampZ(pathZ(layout.path, x) + off);
    const z = { ...zone };
    if (z.enemy) {
        z.enemy = { ...z.enemy, z: on(z.enemy.x) };
        if (z.enemy.patrolMinX !== undefined) {
            z.enemy.patrolMinX = z.enemy.x - 1.6;
            z.enemy.patrolMaxX = z.enemy.x + 1.6;
        }
    }
    const offs = [1.6, -1.6, 2.2, -2.2];
    if (Array.isArray(z.extraEnemies)) {
        z.extraEnemies = z.extraEnemies.map((e, i) => {
            const n = { ...e, z: on(e.x, offs[i % offs.length]) };
            if (n.patrolMinX !== undefined) { n.patrolMinX = n.x - 1.5; n.patrolMaxX = n.x + 1.5; }
            return n;
        });
    }
    if (Array.isArray(z.reinforcements)) {
        z.reinforcements = z.reinforcements.map((e, i) => ({ ...e, z: on(e.x, i % 2 ? -1.2 : 1.2) }));
    }
    if (Array.isArray(z.props)) {
        z.props = z.props.map((p, i) => ({ ...p, z: on(p.x, offs[(i + 1) % offs.length]) }));
    }
    if (z.consolePos) z.consolePos = { ...z.consolePos, z: on(z.consolePos.x, -1.7) };
    if (z.alarmConsolePos) z.alarmConsolePos = { ...z.alarmConsolePos, z: on(z.alarmConsolePos.x, 1.9) };
    return z;
}

/** Every point that must stay reachable: spawns, props, consoles. */
export function reservedPoints(zones) {
    const pts = [];
    for (const z of zones || []) {
        const add = (o) => { if (o && typeof o.x === 'number') pts.push([o.x, o.z || 0]); };
        add(z.enemy);
        (z.extraEnemies || []).forEach(add);
        (z.reinforcements || []).forEach(add);
        (z.props || []).forEach(add);
        add(z.consolePos);
        add(z.alarmConsolePos);
        if (z.enemy && z.enemy.patrolMinX !== undefined) {
            pts.push([z.enemy.patrolMinX, z.enemy.z || 0], [z.enemy.patrolMaxX, z.enemy.z || 0]);
        }
    }
    return pts;
}

/**
 * Build the final obstacle list for a chapter: authored dressing pruned against the path and
 * reserved points, plus the sector walls flanking each security gate.
 */
export function buildLevel(chapterId, zones = []) {
    const layout = LEVEL_LAYOUTS[chapterId];
    if (!layout) return null;
    const rng = rngFor(layout.seed);
    const W = layout.halfWidth;
    const pts = reservedPoints(zones);
    const raw = layout.build(rng, layout);
    const obstacles = [];
    let idx = 0;
    for (const o of raw) {
        // keep inside the walkable corridor
        if (o.maxX < WORLD_X.min || o.minX > WORLD_X.max || o.maxZ < -W || o.minZ > W) continue;
        if (o.minY && o.minY >= 2.0) { obstacles.push({ ...o, id: `${chapterId}_${o.kind}_${idx++}` }); continue; }
        if (rectPathDist(o, layout.path) < PATH_CLEARANCE) continue;
        if (pts.some(([x, z]) => rectPointDist(o, x, z) < POINT_CLEARANCE)) continue;
        // never block a gate opening
        if (SECTOR_GATES.some((gx) => o.minX < gx + 0.8 && o.maxX > gx - 0.8)) continue;
        obstacles.push({ ...o, id: `${chapterId}_${o.kind}_${idx++}` });
    }
    // sector walls beside each gate (the gate laser spans |z| <= 3.5)
    for (const gx of SECTOR_GATES) {
        if (W > GATE_OPENING) {
            obstacles.push({ id: `${chapterId}_wall_${gx}_n`, kind: 'SECTOR_WALL', minX: gx - 0.3, maxX: gx + 0.3, minZ: -W - 0.5, maxZ: -GATE_OPENING, height: 4.5, blocksProjectiles: true });
            obstacles.push({ id: `${chapterId}_wall_${gx}_s`, kind: 'SECTOR_WALL', minX: gx - 0.3, maxX: gx + 0.3, minZ: GATE_OPENING, maxZ: W + 0.5, height: 4.5, blocksProjectiles: true });
        }
    }
    return {
        chapterId,
        theme: layout.theme,
        outdoor: !!layout.outdoor,
        halfWidth: W,
        path: layout.path,
        bounds: { minX: WORLD_X.min, maxX: WORLD_X.max, minZ: -W, maxZ: W },
        obstacles
    };
}
