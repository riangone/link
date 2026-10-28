/**
 * Oni Combat - Architecture Constants
 * Deterministic 60Hz Combat Parameters, Poise/Stun, Throws & Move Data
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
    DASH: 14.0,
    EVADE_IMPULSE: 10.5
};

// Poise & Stun
export const POISE_CONFIG = {
    MAX_POISE: 100,
    REGEN_DELAY: 90,       // frames without taking poise damage before regen starts
    REGEN_PER_TICK: 0.8,   // poise recovered per frame
    DIZZY_DURATION: 90     // frames spent in DIZZY (vulnerable to frontal throws)
};

// Throw & Evasion constants
export const THROW_RANGE = 1.38;
export const THROW_TECH_WINDOW = 10; // frames during which defender can tech a frontal throw
export const TECH_RECOVERY_WINDOW = 18; // frames before landing where pressing Jump triggers break-fall
export const WEAPON_PICKUP_RANGE = 1.45; // radius within which a fighter can snatch a ground or mid-air weapon

// P2 Firearms & Gun-Fu Specifications
export const WEAPON_SPECS = {
    TCTF_PISTOL: {
        id: 'TCTF_PISTOL',
        name: 'TCTF 战术手枪 (Ballistic Pistol)',
        category: 'BALLISTIC',
        maxAmmo: 10,
        fireType: 'HITSCAN',
        range: 13.5,
        damage: 9,
        poiseDamage: 16,
        hitStun: 12,
        blockStun: 6,
        knockback: { x: 1.5, y: 0 },
        startup: 3,
        active: 2,
        recovery: 7,
        color: 0x00f0ff
    },
    SCRAM_CANNON: {
        id: 'SCRAM_CANNON',
        name: '蜂群追踪炮 (Scram Cannon)',
        category: 'ENERGY_HEAVY',
        maxAmmo: 4,
        fireType: 'HOMING_SWARM',
        swarmCount: 3,
        projectileSpeed: 9.5,
        turnRate: 0.048,
        lifetime: 110,
        damage: 8,
        poiseDamage: 22,
        hitStun: 16,
        blockStun: 8,
        knockback: { x: 2.2, y: 1.8 },
        startup: 7,
        active: 4,
        recovery: 14,
        color: 0xff9900
    },
    MERCURY_BOW: {
        id: 'MERCURY_BOW',
        name: '水银狙击弩 (Mercury Bow)',
        category: 'ENERGY_HEAVY',
        maxAmmo: 3,
        fireType: 'PIERCING_BEAM',
        range: 18.0,
        damage: 26,
        poiseDamage: 65,
        hitStun: 26,
        blockStun: 14,
        knockback: { x: 5.2, y: 3.5 },
        knockdown: true,
        piercesGuard: true,
        startup: 9,
        active: 3,
        recovery: 16,
        color: 0x00ffaa
    }
};

// Move definitions (Frame data @ 60fps)
// startup: frames before hit detection starts
// active: duration of hitbox
// recovery: recovery frames after active
// cancelWindowStart: frame during which next combo hit can be buffered
// poiseDamage: amount of poise reduced on clean hit
// armorThreshold: resists interrupt from attacks with poiseDamage < armorThreshold
export const MOVES = {
    // --- Basic Punch String: P -> P -> K (Jab -> Cross -> Crescent Kick) ---
    PUNCH_1: {
        id: 'PUNCH_1',
        name: '刺拳 (Jab)',
        startup: 4,
        active: 3,
        recovery: 8,
        damage: 8,
        poiseDamage: 18,
        hitStun: 14,
        blockStun: 8,
        knockback: { x: 1.4, y: 0 },
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
        poiseDamage: 26,
        hitStun: 18,
        blockStun: 10,
        knockback: { x: 2.2, y: 0 },
        cancelTo: ['COMBO_PUNCH_KICK', 'KICK_HEAVY', 'UPPERCUT'],
        cancelWindowStart: 6,
        hitbox: { offset: { x: 1.05, y: 1.25, z: 0 }, radius: 0.38 }
    },
    COMBO_PUNCH_KICK: {
        id: 'COMBO_PUNCH_KICK',
        name: '三段终结旋踢 (Crescent Kick)',
        startup: 7,
        active: 5,
        recovery: 16,
        damage: 18,
        poiseDamage: 45,
        hitStun: 24,
        blockStun: 12,
        knockback: { x: 4.2, y: 2.2 },
        knockdown: true,
        cancelTo: [],
        hitbox: { offset: { x: 1.15, y: 1.35, z: 0 }, radius: 0.46 }
    },

    // --- Basic Kick String: K -> K -> K (Low Kick -> Mid Side Kick -> Spin Roundhouse) ---
    KICK_LOW: {
        id: 'KICK_LOW',
        name: '低踢 (Low Kick)',
        startup: 6,
        active: 4,
        recovery: 12,
        damage: 10,
        poiseDamage: 20,
        hitStun: 16,
        blockStun: 9,
        knockback: { x: 1.8, y: 0 },
        cancelTo: ['KICK_MID', 'KICK_HEAVY'],
        cancelWindowStart: 7,
        hitbox: { offset: { x: 0.95, y: 0.5, z: 0 }, radius: 0.35 }
    },
    KICK_MID: {
        id: 'KICK_MID',
        name: '中段侧踢 (Side Kick)',
        startup: 6,
        active: 4,
        recovery: 13,
        damage: 14,
        poiseDamage: 30,
        hitStun: 19,
        blockStun: 11,
        knockback: { x: 2.6, y: 0 },
        cancelTo: ['KICK_HEAVY', 'RISING_FURY'],
        cancelWindowStart: 7,
        hitbox: { offset: { x: 1.1, y: 1.05, z: 0 }, radius: 0.42 }
    },
    KICK_HEAVY: {
        id: 'KICK_HEAVY',
        name: '回旋重踢 (Spin Roundhouse)',
        startup: 8,
        active: 6,
        recovery: 18,
        damage: 22,
        poiseDamage: 55,
        armorThreshold: 22,
        hitStun: 26,
        blockStun: 14,
        knockback: { x: 4.5, y: 1.8 },
        knockdown: true,
        disarms: true,
        cancelTo: [],
        hitbox: { offset: { x: 1.2, y: 1.3, z: 0 }, radius: 0.5 }
    },

    // --- Directional & Command Specials ---
    UPPERCUT: {
        id: 'UPPERCUT',
        name: '升龙升拳 (Rising Uppercut)',
        startup: 7,
        active: 5,
        recovery: 16,
        damage: 20,
        poiseDamage: 50,
        armorThreshold: 22,
        hitStun: 28,
        blockStun: 14,
        knockback: { x: 2.8, y: 7.5 },
        isLauncher: true,
        cancelTo: [],
        hitbox: { offset: { x: 0.8, y: 1.6, z: 0 }, radius: 0.45 }
    },
    RISING_FURY: {
        id: 'RISING_FURY',
        name: '旋风升龙腿 (Rising Fury)',
        startup: 6,
        active: 8,
        recovery: 16,
        damage: 24,
        poiseDamage: 60,
        armorThreshold: 25,
        hitStun: 30,
        blockStun: 15,
        knockback: { x: 2.5, y: 8.2 },
        isLauncher: true,
        disarms: true,
        velocityImpulse: 4.0,
        verticalImpulse: 8.5,
        cancelTo: [],
        hitbox: { offset: { x: 0.95, y: 1.5, z: 0 }, radius: 0.5 }
    },
    DASH_PUNCH: {
        id: 'DASH_PUNCH',
        name: '冲刺穿心拳 (Haymaker)',
        startup: 5,
        active: 6,
        recovery: 14,
        damage: 18,
        poiseDamage: 50,
        armorThreshold: 22,
        hitStun: 24,
        blockStun: 13,
        knockback: { x: 5.0, y: 1.2 },
        knockdown: true,
        velocityImpulse: 11.5,
        cancelTo: [],
        hitbox: { offset: { x: 1.1, y: 1.2, z: 0 }, radius: 0.44 }
    },
    FLYING_KICK: {
        id: 'FLYING_KICK',
        name: '疾风飞踢 (Flying Kick)',
        startup: 6,
        active: 9,
        recovery: 15,
        damage: 20,
        poiseDamage: 55,
        hitStun: 26,
        blockStun: 12,
        knockback: { x: 5.5, y: 2.5 },
        knockdown: true,
        disarms: true,
        velocityImpulse: 12.5,
        verticalImpulse: 5.2,
        cancelTo: [],
        hitbox: { offset: { x: 1.15, y: 1.15, z: 0 }, radius: 0.48 }
    },
    SLIDE_KICK: {
        id: 'SLIDE_KICK',
        name: '疾风滑铲 (Slide Sweep)',
        startup: 6,
        active: 10,
        recovery: 14,
        damage: 16,
        poiseDamage: 40,
        hitStun: 22,
        blockStun: 12,
        knockback: { x: 4.0, y: 3.2 },
        knockdown: true,
        isLow: true,
        disarms: true,
        velocityImpulse: 12.0,
        cancelTo: [],
        hitbox: { offset: { x: 1.1, y: 0.3, z: 0 }, radius: 0.45 }
    },
    BACK_SPIN_FIST: {
        id: 'BACK_SPIN_FIST',
        name: '背身后摆拳 (Spinning Backfist)',
        startup: 5,
        active: 4,
        recovery: 12,
        damage: 15,
        poiseDamage: 40,
        hitStun: 22,
        blockStun: 11,
        knockback: { x: 3.2, y: 0 },
        cancelTo: ['KICK_HEAVY'],
        cancelWindowStart: 6,
        hitbox: { offset: { x: 1.0, y: 1.3, z: 0 }, radius: 0.42 }
    },
    WILLOW_KICK: {
        id: 'WILLOW_KICK',
        name: '倒挂金钩 (Willow Kick)',
        startup: 7,
        active: 5,
        recovery: 15,
        damage: 19,
        poiseDamage: 50,
        hitStun: 26,
        blockStun: 13,
        knockback: { x: 3.0, y: 6.5 },
        isLauncher: true,
        cancelTo: [],
        hitbox: { offset: { x: 1.0, y: 1.45, z: 0 }, radius: 0.46 }
    },
    GROUND_STOMP: {
        id: 'GROUND_STOMP',
        name: '震地追击踏 (Ground Stomp)',
        startup: 8,
        active: 4,
        recovery: 14,
        damage: 14,
        poiseDamage: 30,
        hitStun: 16,
        blockStun: 10,
        knockback: { x: 1.2, y: 2.0 },
        hitsGrounded: true,
        isLow: true,
        cancelTo: [],
        hitbox: { offset: { x: 0.75, y: 0.25, z: 0 }, radius: 0.48 }
    },

    // --- Context-Sensitive Throws ---
    THROW_FRONT: {
        id: 'THROW_FRONT',
        name: '过肩摔 (Shoulder Throw)',
        isThrow: true,
        startup: 5,
        active: 18,
        recovery: 10,
        releaseFrame: 16,
        damage: 24,
        poiseDamage: 60,
        knockback: { x: 4.5, y: 3.5 },
        knockdown: true,
        techable: true,
        cancelTo: []
    },
    THROW_RUN: {
        id: 'THROW_RUN',
        name: '剪刀脚绞头摔 (Head Scissors)',
        isThrow: true,
        startup: 4,
        active: 20,
        recovery: 10,
        releaseFrame: 17,
        damage: 26,
        poiseDamage: 70,
        knockback: { x: 5.2, y: 3.8 },
        knockdown: true,
        disarms: true,
        techable: true,
        cancelTo: []
    },
    THROW_BACK: {
        id: 'THROW_BACK',
        name: '背身抱腰过桥摔 (Backbreaker Suplex)',
        isThrow: true,
        startup: 4,
        active: 22,
        recovery: 10,
        releaseFrame: 19,
        damage: 32,
        poiseDamage: 100,
        knockback: { x: -3.2, y: 4.2 },
        knockdown: true,
        disarms: true,
        techable: false, // Untechable back ambush
        cancelTo: []
    },

    // --- P2 Gun-Fu & Disarm Moves ---
    DISARM_KICK: {
        id: 'DISARM_KICK',
        name: '腾空缴械踢 (Acrobatic Disarm)',
        startup: 4,
        active: 8,
        recovery: 12,
        damage: 16,
        poiseDamage: 50,
        hitStun: 24,
        blockStun: 10,
        knockback: { x: 3.6, y: 2.0 },
        disarms: true,
        snatchDisarmedWeapon: true, // Auto-snatches the knocked-out weapon in mid-air!
        velocityImpulse: 10.5,
        verticalImpulse: 6.2,
        cancelTo: [],
        hitbox: { offset: { x: 1.1, y: 1.35, z: 0 }, radius: 0.5 }
    },
    FIRE_WEAPON: {
        id: 'FIRE_WEAPON',
        name: '战术射击 (Fire Weapon)',
        isFirearmMove: true,
        startup: 4,
        active: 3,
        recovery: 9,
        damage: 0,
        poiseDamage: 0,
        hitStun: 12,
        blockStun: 6,
        knockback: { x: 1.5, y: 0 },
        cancelTo: []
    },
    THROW_WEAPON: {
        id: 'THROW_WEAPON',
        name: '掷枪砸击 (Weapon Toss)',
        isWeaponThrow: true,
        startup: 4,
        active: 4,
        recovery: 10,
        damage: 14,
        poiseDamage: 45,
        hitStun: 22,
        blockStun: 10,
        knockback: { x: 3.0, y: 1.5 },
        cancelTo: []
    }
};

export const FIGHTER_STATE = {
    IDLE: 'IDLE',
    WALK: 'WALK',
    RUN: 'RUN',
    CROUCH: 'CROUCH',
    EVADE: 'EVADE',
    ATTACK: 'ATTACK',
    THROW: 'THROW',
    BEING_THROWN: 'BEING_THROWN',
    BLOCK: 'BLOCK',
    HIT_STUN: 'HIT_STUN',
    DIZZY: 'DIZZY',
    KNOCKED_DOWN: 'KNOCKED_DOWN',
    WAKEUP: 'WAKEUP',
    TECH_RECOVERY: 'TECH_RECOVERY',
    VICTORY: 'VICTORY',
    DEFEAT: 'DEFEAT'
};

/**
 * Declarative Move Table (Sorted by priority descending)
 * Evaluated by Fighter.resolveCommandTable(input, opponent, relContext)
 */
export const MOVE_TABLE = [
    // 1. Context-Sensitive Throws (Close range + Punch or Throw input)
    {
        id: 'THROW_BACK',
        priority: 100,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.RUN],
        button: 'punchOrThrow',
        condition: (f, input, opp, ctx) =>
            opp && ctx.dist <= THROW_RANGE && ctx.canBeThrown && ctx.sector === 'BACK'
    },
    {
        id: 'THROW_RUN',
        priority: 96,
        states: [FIGHTER_STATE.RUN],
        button: 'punchOrThrow',
        condition: (f, input, opp, ctx) =>
            opp && ctx.dist <= THROW_RANGE + 0.25 && ctx.canBeThrown && (ctx.oppDizzy || input.throwJustPressed)
    },
    {
        id: 'THROW_FRONT',
        priority: 94,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.CROUCH],
        button: 'punchOrThrow',
        condition: (f, input, opp, ctx) =>
            opp && ctx.dist <= THROW_RANGE && ctx.canBeThrown && (ctx.oppDizzy || input.throwJustPressed)
    },

    // 2. Ground Stomp (Opponent knocked down nearby + Kick)
    {
        id: 'GROUND_STOMP',
        priority: 88,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.CROUCH],
        button: 'kick',
        condition: (f, input, opp, ctx) =>
            opp && opp.state === FIGHTER_STATE.KNOCKED_DOWN && opp.y <= 0.15 && ctx.dist <= 1.65
    },

    // 3. Dedicated Slide Button or Run + Crouch/Slide/Kick
    {
        id: 'SLIDE_KICK',
        priority: 85,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.RUN, FIGHTER_STATE.CROUCH],
        button: 'slide',
        condition: (f) => f.isGrounded
    },
    {
        id: 'SLIDE_KICK',
        priority: 84,
        states: [FIGHTER_STATE.RUN],
        button: 'crouch',
        condition: (f) => f.isGrounded
    },

    // 4. Running Attacks (Run + Jump+Punch = Acrobatic Disarm, Kick = Flying Kick, Punch = Haymaker)
    {
        id: 'DISARM_KICK',
        priority: 83,
        states: [FIGHTER_STATE.RUN],
        button: 'punch',
        condition: (f, input) => input.jump || !f.isGrounded || f.inputBuffer.checkJumpAttack()
    },
    {
        id: 'FLYING_KICK',
        priority: 82,
        states: [FIGHTER_STATE.RUN],
        button: 'kick',
        condition: (f) => f.isGrounded
    },
    {
        id: 'DASH_PUNCH',
        priority: 80,
        states: [FIGHTER_STATE.RUN],
        button: 'punch',
        condition: (f) => f.isGrounded
    },

    // 4b. Firearm Actions (Dedicated Fire button, or Punch at medium/long range when armed)
    {
        id: 'FIRE_WEAPON',
        priority: 79,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.RUN, FIGHTER_STATE.CROUCH],
        button: 'fire',
        condition: (f) => !!(f.weapon && f.weapon.ammo > 0)
    },
    {
        id: 'THROW_WEAPON',
        priority: 78,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.RUN, FIGHTER_STATE.CROUCH],
        button: 'fire',
        condition: (f) => !!(f.weapon && f.weapon.ammo <= 0)
    },
    {
        id: 'FIRE_WEAPON',
        priority: 72,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.CROUCH],
        button: 'punch',
        condition: (f, input, opp, ctx) => !!(f.weapon && f.weapon.ammo > 0 && ctx.dist > 1.85)
    },
    {
        id: 'THROW_WEAPON',
        priority: 71,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.CROUCH],
        button: 'punch',
        condition: (f, input, opp, ctx) => !!(f.weapon && f.weapon.ammo <= 0 && ctx.dist > 1.85)
    },

    // 5. Motion & Crouch Specials
    {
        id: 'RISING_FURY',
        priority: 76,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.CROUCH],
        button: 'kick',
        condition: (f) => f.inputBuffer.checkRisingFury()
    },
    {
        id: 'UPPERCUT',
        priority: 75,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.CROUCH],
        button: 'punch',
        condition: (f) => f.inputBuffer.checkUppercut(f.facing)
    },

    // 6. Directional Back Attacks (Back + Punch / Back + Kick)
    {
        id: 'BACK_SPIN_FIST',
        priority: 65,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK],
        button: 'punch',
        condition: (f, input, opp, ctx) => ctx.holdingBack
    },
    {
        id: 'WILLOW_KICK',
        priority: 64,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK],
        button: 'kick',
        condition: (f, input, opp, ctx) => ctx.holdingBack
    },

    // 7. Standard Starters
    {
        id: 'PUNCH_1',
        priority: 20,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.CROUCH],
        button: 'punch',
        condition: () => true
    },
    {
        id: 'KICK_LOW',
        priority: 18,
        states: [FIGHTER_STATE.IDLE, FIGHTER_STATE.WALK, FIGHTER_STATE.CROUCH],
        button: 'kick',
        condition: () => true
    }
];
