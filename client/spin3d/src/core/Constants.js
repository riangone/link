/**
 * Link Spin 3D - Constants & Configuration
 * Physics, Stadium Geometry, Top Archetypes, and Match Rules.
 */

export const FIXED_DT = 1 / 60;

// 3D Stadium Dimensions
export const STADIUM_RADIUS = 30.0;
export const BOWL_DEPTH = 3.8;
export const RIM_HEIGHT = 5.2;

/**
 * Calculates bowl elevation y for a given 2D radial distance r from center.
 */
export function getBowlHeight(r) {
    const normR = Math.min(1.0, r / STADIUM_RADIUS);
    // Smooth bowl with subtle center plateau and steepening rim
    return BOWL_DEPTH * Math.pow(normR, 2.2);
}

/**
 * Surface slope derivative dy/dr
 */
export function getBowlSlope(r) {
    if (r <= 0.001) return 0;
    const normR = Math.min(1.0, r / STADIUM_RADIUS);
    return (2.2 * BOWL_DEPTH / STADIUM_RADIUS) * Math.pow(normR, 1.2);
}

// Pocket Gate Geometry (Two knockout pockets at 0 and PI)
export const POCKET_RADIUS = 27.2;
export const POCKET_HALF_ANGLE = 0.38; // ~22 degrees each side
export const POCKET_ANGLES = [0, Math.PI];

export function isInPocket(x, z) {
    const r = Math.hypot(x, z);
    if (r < POCKET_RADIUS) return false;
    let angle = Math.atan2(z, x);
    if (angle < 0) angle += Math.PI * 2;
    for (const p of POCKET_ANGLES) {
        let diff = Math.abs(angle - p);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff <= POCKET_HALF_ANGLE) return true;
    }
    return false;
}

// 3D Xtreme Line (Toothed Rails for X-DASH)
export const RAIL_RADIUS_MIN = 25.5;
export const RAIL_RADIUS_MAX = 29.5;
export const RAIL_ARCS = [
    { start: Math.PI * 0.28, end: Math.PI * 0.72 }, // Upper arc (60-130 deg)
    { start: Math.PI * 1.28, end: Math.PI * 1.72 }  // Lower arc (230-310 deg)
];

export function isOnRail(x, z) {
    const r = Math.hypot(x, z);
    if (r < RAIL_RADIUS_MIN || r > RAIL_RADIUS_MAX) return false;
    let angle = Math.atan2(z, x);
    if (angle < 0) angle += Math.PI * 2;
    for (const arc of RAIL_ARCS) {
        if (angle >= arc.start && angle <= arc.end) return true;
    }
    return false;
}

// Physics & Gyroscopic Constants
export const GRAVITY = 32.0;
export const BASE_SPIN_DRAIN = 0.85; // RPM decay per second
export const SCRAPE_SPIN_DRAIN = 4.5; // RPM decay per second when scraping outer blade
export const MAX_SPIN = 100.0;
export const MAX_BURST_HP = 100.0;
export const WOBBLE_SPIN_THRESHOLD = 38.0;
export const MAX_TILT_RAD = 0.48; // ~27 degrees max tilt before toppling

// Match Rules
export const TARGET_SCORE = 3; // First to 3 points wins
export const LAUNCH_COUNTDOWN_TIME = 3.0; // 3, 2, 1, GO SHOOT!

// 5 Base Tops Archetypes
export const CORES_3D = {
    attack: {
        id: 'attack',
        name: 'STORM STRIKER',
        short: 'STRIKER',
        type: 'ATTACK',
        specName: 'METEOR RUSH',
        color1: '#ff2d55', // Flame Red
        color2: '#ff9500', // Gold
        metalColor: '#e0e5eb',
        mass: 1.15,
        radius: 2.2,
        maxSpeed: 24.0,
        accel: 38.0,
        drainRate: 1.05,
        attackPower: 1.45,
        defenseFactor: 0.85,
        burstResist: 0.88,
        gearRatio: 1.2, // Strong bite on Xtreme rail
        bladeCount: 3,
        bladeStyle: 'swept',
        desc: '超高速三翼斩刃，搭载大齿数咬合齿轮，极易触发致命 X-DASH！'
    },
    defense: {
        id: 'defense',
        name: 'IRON FORTRESS',
        short: 'FORTRESS',
        type: 'DEFENSE',
        specName: 'AEGIS WALL',
        color1: '#007aff', // Deep Azure
        color2: '#5ac8fa', // Sky Cyan
        metalColor: '#8e8e93',
        mass: 1.65,
        radius: 2.45,
        maxSpeed: 17.5,
        accel: 25.0,
        drainRate: 0.82,
        attackPower: 0.92,
        defenseFactor: 1.45,
        burstResist: 1.50,
        gearRatio: 0.5,
        bladeCount: 6,
        bladeStyle: 'shield',
        desc: '六角重甲铁壁，超高配重与抗爆裂锁扣，稳如泰山无惧冲击！'
    },
    stamina: {
        id: 'stamina',
        name: 'ZEPHYR WING',
        short: 'ZEPHYR',
        type: 'STAMINA',
        specName: 'ETERNAL GALE',
        color1: '#34c759', // Emerald
        color2: '#a8ffb2', // Mint
        metalColor: '#d1d1d6',
        mass: 0.95,
        radius: 2.15,
        maxSpeed: 19.0,
        accel: 26.0,
        drainRate: 0.72,
        attackPower: 0.88,
        defenseFactor: 1.02,
        burstResist: 1.02,
        gearRatio: 0.3,
        bladeCount: 4,
        bladeStyle: 'aero',
        desc: '流线型低风阻翼面，持久回转能力超群，耐力战的绝对王者！'
    },
    balance: {
        id: 'balance',
        name: 'PHOENIX FLARE',
        short: 'PHOENIX',
        type: 'BALANCE',
        specName: 'RISING FLARE',
        color1: '#ff9500', // Amber
        color2: '#ff3b30', // Crimson
        metalColor: '#c7c7cc',
        mass: 1.18,
        radius: 2.25,
        maxSpeed: 21.0,
        accel: 32.0,
        drainRate: 0.88,
        attackPower: 1.18,
        defenseFactor: 1.12,
        burstResist: 1.20,
        gearRatio: 0.65,
        bladeCount: 5,
        bladeStyle: 'feather',
        desc: '不死鸟锋刃，攻守平衡兼备，兼具强劲突进与稳健持久力！'
    },
    dragon: {
        id: 'dragon',
        name: 'VOID DRAGON',
        short: 'DRAGON',
        type: 'SPECIAL',
        specName: 'DRAGON STORM',
        color1: '#af52de', // Void Purple
        color2: '#00f0ff', // Electric Neon Cyan
        metalColor: '#3a3a3c', // Gunmetal Black
        mass: 1.30,
        radius: 2.30,
        maxSpeed: 22.5,
        accel: 36.0,
        drainRate: 0.90,
        attackPower: 1.35,
        defenseFactor: 1.22,
        burstResist: 1.25,
        gearRatio: 1.05,
        bladeCount: 3,
        bladeStyle: 'dragon',
        desc: '传说中的暗黑虚空龙王，撕裂空间的狂暴风暴与极境突袭！'
    }
};
