/**
 * Oni Combat - Architecture Constants
 * Deterministic 60Hz Combat Parameters & Move Data
 */

export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;

// Stage bounds
export const STAGE_BOUNDS = {
    minX: -14,
    maxX: 14,
    minZ: -6,
    maxZ: 6
};

// Physics
export const GRAVITY = -32;
export const MOVE_SPEED = {
    WALK_FORWARD: 6.0,
    WALK_BACK: 4.2,
    RUN: 11.0,
    DASH: 14.0
};

// Move definitions (Frame data @ 60fps)
// startup: frames before hit detection starts
// active: duration of hitbox
// recovery: recovery frames after active
// cancelWindow: frames during which next combo hit can be buffered
export const MOVES = {
    PUNCH_1: {
        id: 'PUNCH_1',
        name: '刺拳 (Jab)',
        startup: 4,
        active: 3,
        recovery: 8,
        damage: 8,
        hitStun: 14,
        blockStun: 8,
        knockback: { x: 1.5, y: 0 },
        cancelTo: ['PUNCH_2', 'KICK_LOW'],
        cancelWindowStart: 5,
        hitbox: { offset: { x: 0.9, y: 1.25, z: 0 }, radius: 0.35 }
    },
    PUNCH_2: {
        id: 'PUNCH_2',
        name: '直拳 (Cross)',
        startup: 5,
        active: 4,
        recovery: 11,
        damage: 12,
        hitStun: 18,
        blockStun: 10,
        knockback: { x: 2.4, y: 0 },
        cancelTo: ['KICK_HEAVY', 'UPPERCUT'],
        cancelWindowStart: 6,
        hitbox: { offset: { x: 1.05, y: 1.25, z: 0 }, radius: 0.38 }
    },
    UPPERCUT: {
        id: 'UPPERCUT',
        name: '升龙升拳 (Rising Uppercut)',
        startup: 7,
        active: 5,
        recovery: 16,
        damage: 20,
        hitStun: 28,
        blockStun: 14,
        knockback: { x: 2.8, y: 7.5 }, // Launches into air
        isLauncher: true,
        cancelTo: [],
        hitbox: { offset: { x: 0.8, y: 1.6, z: 0 }, radius: 0.45 }
    },
    KICK_LOW: {
        id: 'KICK_LOW',
        name: '低踢 (Low Kick)',
        startup: 6,
        active: 4,
        recovery: 12,
        damage: 10,
        hitStun: 16,
        blockStun: 9,
        knockback: { x: 2.0, y: 0 },
        cancelTo: ['KICK_HEAVY'],
        cancelWindowStart: 7,
        hitbox: { offset: { x: 0.95, y: 0.5, z: 0 }, radius: 0.35 }
    },
    KICK_HEAVY: {
        id: 'KICK_HEAVY',
        name: '回旋重踢 (Spin Roundhouse)',
        startup: 8,
        active: 6,
        recovery: 18,
        damage: 22,
        hitStun: 26,
        blockStun: 14,
        knockback: { x: 4.5, y: 1.8 },
        knockdown: true,
        cancelTo: [],
        hitbox: { offset: { x: 1.2, y: 1.3, z: 0 }, radius: 0.5 }
    },
    SLIDE_KICK: {
        id: 'SLIDE_KICK',
        name: '疾风滑铲 (Slide Sweep)',
        startup: 6,
        active: 10,
        recovery: 14,
        damage: 16,
        hitStun: 22,
        blockStun: 12,
        knockback: { x: 4.0, y: 3.2 },
        knockdown: true,
        isLow: true,
        velocityImpulse: 12.0, // Slides forward
        cancelTo: [],
        hitbox: { offset: { x: 1.1, y: 0.3, z: 0 }, radius: 0.45 }
    }
};

export const FIGHTER_STATE = {
    IDLE: 'IDLE',
    WALK: 'WALK',
    RUN: 'RUN',
    ATTACK: 'ATTACK',
    BLOCK: 'BLOCK',
    HIT_STUN: 'HIT_STUN',
    KNOCKED_DOWN: 'KNOCKED_DOWN',
    WAKEUP: 'WAKEUP',
    VICTORY: 'VICTORY',
    DEFEAT: 'DEFEAT'
};
