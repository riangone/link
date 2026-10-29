/**
 * AnimationLibrary - data-driven poses & keyframe tracks (render-only, zero Three.js dependency)
 *
 * Semantic convention (character-local, facing +Z, independent of Three.js euler signs):
 *   hipY        pelvis height offset from standing (m)
 *   hipP/T/R    pelvis pitch(+ = tilt forward) / twist / roll
 *   hipS, fwd   pelvis shift sideways (+ = toward lead/left foot) / forward (m). Planted feet stay put.
 *   spP/Y/R     spine pitch(+ = lean forward) / yaw(+ = right shoulder forward) / roll
 *   hdP/hdY     head pitch(+ = look down) / yaw — on top of automatic gaze stabilisation
 *   xSP xSR xSY shoulder pitch(+ = raise arm forward) / roll(+ = abduct outward) / yaw(+ = swing inward)
 *   xEB xWB     elbow bend (+ = forearm folds up) / wrist bend
 *   xHP xHR xKB FK leg: hip pitch(+ = leg forward) / hip roll(+ = outward) / knee bend(+ = shin back)
 *   xFx xFy xFz IK foot target: outward from midline / height / forward (m), sole on the floor at 0
 *   xFY xFP     foot yaw(+ = toe turned out) / foot pitch(+ = heel raised, pivot on the ball)
 *   xIK         0 = leg follows FK angles, 1 = leg solved to the foot target (planted)
 *   lift, spin  whole-body lift (m) / extra yaw (rad); turn = how far the stance opens to camera
 *
 * The rig maps semantics to Three.js in ONE place (ProceduralFighterMesh.applyPose).
 * Left = lead side (far from camera), right = rear side (near camera).
 */

import { FIGHTER_STATE } from '../core/Constants.js';

export const POSE_KEYS = [
    'hipY', 'hipP', 'hipT', 'hipR', 'hipS', 'fwd',
    'spP', 'spY', 'spR', 'hdP', 'hdY',
    'lSP', 'lSR', 'lSY', 'lEB', 'lWB', 'rSP', 'rSR', 'rSY', 'rEB', 'rWB',
    'lHP', 'lHR', 'lKB', 'rHP', 'rHR', 'rKB',
    'lFx', 'lFy', 'lFz', 'lFY', 'lFP', 'rFx', 'rFy', 'rFz', 'rFY', 'rFP',
    'lIK', 'rIK',
    'lift', 'spin', 'turn'
];

const ZERO = Object.fromEntries(POSE_KEYS.map(k => [k, 0]));

export function makePose(over = {}) {
    return Object.assign({}, ZERO, over);
}

// ---------------------------------------------------------------- base stances
// Wide, athletic Oni martial-arts stance: deep knee bend, open foot spacing, dynamic guard
const STANCE_FEET = {
    lFx: 0.14, lFz: 0.28, lFY: 0.22, rFx: 0.17, rFz: -0.30, rFY: 0.88, lIK: 1, rIK: 1
};

export const GUARD = makePose({
    ...STANCE_FEET,
    hipY: -0.115, hipT: 0.28, hipS: 0.0, fwd: 0.02, spP: 0.18, spY: -0.22, spR: 0.05, hdP: 0.12, hdY: 0.08,
    lSP: 1.12, lSR: 0.38, lSY: 0.05, lEB: 1.55, lWB: 0.12,
    rSP: 0.72, rSR: 0.45, rSY: 0.18, rEB: 1.95, rWB: 0.18,
    lHP: 0.48, lHR: 0.16, lKB: 0.52, rHP: -0.42, rHR: 0.16, rKB: 0.56,
    turn: 1
});

const BLOCK = makePose({
    ...STANCE_FEET, lFz: 0.18, rFz: -0.27, rFx: 0.15,
    hipY: -0.14, hipT: 0.1, fwd: -0.03, spP: 0.28, spY: -0.05, hdP: 0.32,
    lSP: 1.25, lSR: -0.05, lSY: 0.35, lEB: 2.4, lWB: 0.3,
    rSP: 1.15, rSR: 0.0, rSY: 0.4, rEB: 2.45, rWB: 0.3,
    turn: 0.6
});

const AIR = makePose({
    spP: 0.15, lSP: 0.9, lSR: 0.4, lEB: 1.8, rSP: 0.6, rSR: 0.4, rEB: 2.1,
    lHP: 1.0, lKB: 1.5, rHP: 0.35, rKB: 1.1, lFP: 0.6, rFP: 0.6, turn: 0.8
});

const HIT_RECOIL = makePose({
    ...STANCE_FEET, rFz: -0.33, lFz: 0.17, lFP: 0.35,
    hipY: -0.12, hipP: -0.12, fwd: -0.14, spP: -0.5, spY: 0.3, spR: -0.08, hdP: -0.5, hdY: 0.2,
    lSP: 0.45, lSR: 0.7, lEB: 0.8, lWB: -0.3, rSP: -0.15, rSR: 0.6, rEB: 0.7, rWB: -0.3,
    turn: 0.8
});

const LAUNCHED = makePose({
    hipP: -0.7, spP: -0.45, hdP: -0.4,
    lSP: 2.3, lSR: 0.5, lEB: 0.4, rSP: 1.9, rSR: 0.6, rEB: 0.6,
    lHP: 0.8, lKB: 1.0, rHP: 0.3, rKB: 0.5, lFP: 0.5, rFP: 0.6, turn: 0.7
});

// lying face-up, head away from the attacker
const LYING = makePose({
    hipY: -0.85, hipP: -1.52, spP: 0.05, hdP: -0.25, hdY: 0.4,
    lSP: 2.6, lSR: 0.6, lEB: 0.3, rSP: 2.4, rSR: 0.9, rEB: 0.5,
    lHP: 0.30, lHR: 0.18, lKB: 0.65, rHP: 0.05, rHR: 0.12, rKB: 0.15,
    lFP: 0.5, rFP: 0.7, turn: 0.4
});

const SIT_UP = makePose({
    hipY: -0.62, hipP: -0.35, spP: 0.55, hdP: 0.2,
    lSP: 0.9, lSR: 0.35, lEB: 1.9, rSP: -0.5, rSR: 0.3, rEB: 0.2,
    lHP: 1.6, lKB: 2.2, rHP: 0.9, rKB: 2.0, turn: 0.8
});

const VICTORY = makePose({
    ...STANCE_FEET, lFz: 0.12, rFz: -0.12, lFx: 0.12, rFx: 0.12, rFY: 0.5, lFY: 0.3,
    hipY: -0.02, hipT: 0.3, hipS: 0.03, spP: -0.08, spY: -0.2, hdP: -0.25, hdY: -0.2,
    lSP: 0.2, lSR: 0.3, lEB: 1.7, lSY: 0.6,
    rSP: 2.95, rSR: 0.2, rEB: 0.15, rWB: 0.3,
    turn: 1.6
});

const CROUCH_POSE = makePose({
    ...STANCE_FEET, lFz: 0.24, rFz: -0.26, rFx: 0.16,
    hipY: -0.44, hipP: 0.15, hipT: 0.22, spP: 0.38, spY: -0.15, hdP: -0.22,
    lSP: 1.05, lSR: 0.25, lEB: 2.1, rSP: 0.75, rSR: 0.3, rEB: 2.25,
    turn: 0.65
});

const DIZZY_BASE = makePose({
    ...STANCE_FEET, lFz: 0.14, rFz: -0.16, lFx: 0.16, rFx: 0.16,
    hipY: -0.16, spP: 0.25, hdP: 0.35,
    lSP: 0.25, lSR: 0.45, lEB: 0.85, rSP: 0.2, rSR: 0.45, rEB: 0.85,
    turn: 0.7
});

const GRABBED_POSE = makePose({
    ...STANCE_FEET, lIK: 0, rIK: 0,
    hipY: -0.05, hipP: 0.35, spP: 0.45, hdP: 0.3,
    lSP: 0.8, lSR: 0.7, lEB: 1.2, rSP: 0.8, rSR: 0.7, rEB: 1.2,
    lHP: 0.5, lKB: 0.8, rHP: 0.3, rKB: 0.9, turn: 0.2
});

// ---------------------------------------------------------------- attack tracks
// Each track is a list of keys. `at` is anchored to the move's frame data so visuals always line up
// with the deterministic hitbox window:  'wind' = 55% of startup, 'hit' = first active frame,
// 'act' = last active frame, 'rec:x' = x of the way through recovery. Frame 0 and the final
// frame are always the guard. Keys inherit from the previous key, so only changes are listed.
export const ATTACK_ANIMS = {
    PUNCH_1: { // lead jab: deep lunge step-in, explosive full extension & rear arm tight guard
        trail: 'lFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.14, spY: 0.28, lSP: 0.65, lSR: 0.35, lEB: 2.30, fwd: -0.06 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lSP: 1.82, lSR: -0.06, lSY: -0.12, lEB: 0.0, lWB: -0.06,
                    spY: -0.88, spP: 0.30, spR: 0.10, hipT: -0.32, hdP: 0.15,
                    rSP: -0.28, rSR: 0.60, rSY: 0.14, rEB: 1.85,
                    lFz: 0.46, rFz: -0.28, rFP: 0.50, hipY: -0.15, fwd: 0.30, hipS: 0.05, turn: 0.05
                }
            },
            { at: 'act', pose: { lSP: 1.84, spY: -0.92, fwd: 0.32, lEB: 0.0 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lSP: 1.18, lEB: 1.25, spY: -0.25, fwd: 0.08, lFz: 0.32, rFz: -0.28, rFP: 0.12 } }
        ]
    },
    PUNCH_2: { // rear cross: massive hip pivot, shoulder whip, rear heel drive, lead arm retracted
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipT: -0.42, spY: -0.78, hipY: -0.15, fwd: -0.08, hipS: -0.04,
                    rSP: 0.20, rSR: 0.50, rEB: 2.45, lSP: 1.30, lEB: 0.95, lSY: 0.1, hdY: 0.22
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.95, spY: 1.35, spP: 0.40, spR: -0.16, hipY: -0.17, fwd: 0.38, hipS: 0.07,
                    rSP: 1.85, rSR: -0.06, rSY: -0.15, rEB: 0.0, rWB: -0.05,
                    lSP: -0.60, lSR: 0.82, lSY: -0.2, lEB: 1.45,
                    lFz: 0.44, rFz: -0.26, rFY: 0.15, rFP: 0.85, hdY: -0.42, hdP: 0.14, turn: 0.0
                }
            },
            { at: 'act', pose: { spY: 1.40, rSP: 1.88, fwd: 0.40, rEB: 0.0 } },
            { at: 'rec:0.45', ease: 'inout', pose: { spY: 0.38, hipT: 0.35, rSP: 1.05, rEB: 1.30, fwd: 0.12, rFP: 0.25, rFY: 0.45 } }
        ]
    },
    UPPERCUT: { // rising dragon: deep crouch coil -> skyward rocket uppercut, body arch, airborne leap
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipY: -0.42, spP: 0.75, spY: -0.72, hipT: -0.32, hdP: 0.32, fwd: -0.04,
                    rSP: -0.80, rSR: 0.42, rEB: 1.65, lSP: 1.25, lSR: 0.45, lEB: 1.9,
                    lFz: 0.32, rFz: -0.34, rFx: 0.18
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: 0.18, spP: -0.65, spY: 0.95, spR: -0.22, hipT: 0.65, hdP: -0.68, fwd: 0.24,
                    rSP: 3.12, rSR: 0.12, rSY: 0.08, rEB: 0.08, rWB: -0.25,
                    lSP: -0.90, lSR: 0.95, lEB: 0.45,
                    rIK: 0, lIK: 0, rHP: 1.55, rKB: 1.85, lHP: -0.40, lKB: 0.15, rFP: 0.88, lFP: 0.95,
                    lift: 0.52, turn: 0.25
                }
            },
            { at: 'act', pose: { lift: 0.64, rSP: 3.16, rEB: 0.05, spP: -0.68 } },
            { at: 'rec:0.5', ease: 'in', pose: { lift: 0.0, hipY: -0.20, spP: 0.25, rSP: 1.25, rEB: 1.4, lIK: 1, rIK: 1, lFP: 0, rFP: 0, rHP: 0.2, rKB: 0.6 } }
        ]
    },
    KICK_LOW: { // wide snapping roundhouse kick: high chamber, hip turnover, locked out whip, torso counter-balance
        trail: 'rFoot',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    rIK: 0, rHP: 1.62, rHR: 0.58, rKB: 2.35, rFP: 0.7,
                    hipS: 0.09, hipT: 0.42, hipY: -0.09, fwd: 0.08, spP: -0.15,
                    lSP: 1.15, lSR: 0.65, rSP: -0.35, rSR: 0.85, rEB: 1.4
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 1.52, rHR: 0.75, rKB: 0.0, rFP: 1.05,
                    hipT: 0.82, hipP: -0.30, spP: -0.58, spY: 0.55, spR: -0.38, hdP: 0.35,
                    lSP: 0.95, lSR: 1.35, lEB: 0.45, rSP: -0.65, rSR: 1.35, rEB: 0.35,
                    fwd: 0.24, lFY: 0.68, lFP: 0.35, turn: 0.15
                }
            },
            { at: 'act', pose: { rHP: 1.58, rHR: 0.82, fwd: 0.28 } },
            { at: 'rec:0.45', ease: 'inout', pose: { rHP: 1.15, rHR: 0.25, rKB: 1.85, spP: -0.12, hipT: 0.3, lSR: 0.45, rSR: 0.45, rSP: 0.4, rEB: 1.7 } },
            { at: 'rec:0.8', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0, hipS: 0.02, fwd: 0.02, lFY: 0.22 } }
        ]
    },
    KICK_HEAVY: { // 360 spinning high hook/roundhouse: deep torso tilt, wide eagle-wing arms, head-level leg extension
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            {
                at: 'wind', ease: 'inout', pose: {
                    spin: Math.PI * 0.95, hipY: -0.16, spP: 0.25, spY: -0.45, hdY: 1.05, hdP: 0.15,
                    lFx: 0.04, lFz: 0.04, lFP: 0.55, rFx: 0.16, rFz: -0.28, rFP: 0.6, hipS: 0.08,
                    lSP: 0.55, lSR: 1.25, lEB: 0.75, rSP: 0.5, rSR: 1.25, rEB: 0.75
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    spin: Math.PI * 2, rIK: 0, rHP: 2.05, rHR: 1.32, rKB: 0.0, rFP: 1.0,
                    spR: -0.98, spP: -0.60, hipR: -0.38, hipP: -0.28, hdY: 0.25, hdP: 0.25,
                    lSP: 0.1, lSR: 1.75, lEB: 0.1, rSP: -0.2, rSR: 1.65, rEB: 0.1,
                    fwd: 0.28, lift: 0.16, lFP: 0.55, turn: 0.15
                }
            },
            { at: 'act', pose: { spin: Math.PI * 2 + 0.38, rHP: 2.10, rHR: 1.38, fwd: 0.32 } },
            { at: 'rec:0.55', ease: 'inout', pose: { spin: Math.PI * 2, lift: 0, rHP: 0.7, rHR: 0.3, rKB: 1.4, spR: -0.2, spP: 0.0, lSR: 0.6, rSR: 0.6, lEB: 1.4, rEB: 1.4, lFP: 0.1 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0 } }
        ]
    },
    SLIDE_KICK: { // Oni signature baseball slide sweep: ground drop, horizontal extension, kicking leg completely flat
        trail: 'rFoot',
        keys: [
            {
                at: 'wind', ease: 'in', pose: {
                    hipY: -0.42, spP: 0.65, fwd: 0.16, lSP: -0.55, rSP: 1.25, rEB: 1.5,
                    rFz: -0.12, rFP: 0.75
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, hipY: -0.76, hipP: -1.12, spP: -0.40, hdP: 0.68, fwd: 0.36,
                    rHP: 1.24, rHR: 0.18, rKB: 0.0, rFP: 1.05, lHP: 0.45, lHR: 0.45, lKB: 2.20, lFP: 0.4,
                    lSP: -1.35, lSR: 0.75, lEB: 0.05, rSP: 1.35, rSR: 0.55, rEB: 1.25, turn: 0.5
                }
            },
            { at: 'act', pose: { hipY: -0.78, spP: -0.45, fwd: 0.42, rHP: 1.28 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipY: -0.48, hipP: -0.32, spP: 0.52, rHP: 0.95, rKB: 1.35, lHP: 1.35, lKB: 2.0, lSP: 0.3, lEB: 1.0, fwd: 0.12 } },
            { at: 'rec:0.85', ease: 'out', pose: { lIK: 1, rIK: 1, hipY: -0.18, hipP: 0, spP: 0.22, rFP: 0, lFP: 0, fwd: 0.02 } }
        ]
    },
    COMBO_PUNCH_KICK: { // P-P-K finisher: explosive high axe/crescent kick with dramatic torso lean-back
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { rIK: 0, rHP: 1.70, rHR: 0.55, rKB: 2.25, hipT: 0.38, spP: -0.22, lSP: 1.25, rSP: -0.35 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 2.10, rHR: 0.95, rKB: 0.0, rFP: 1.0,
                    hipT: 0.85, hipP: -0.35, spP: -0.66, spR: -0.70, hdP: 0.38,
                    lSP: 0.25, lSR: 1.65, lEB: 0.15, rSP: -0.35, rSR: 1.55, rEB: 0.15,
                    fwd: 0.30, lift: 0.14, lFP: 0.45, turn: 0.15
                }
            },
            { at: 'act', pose: { rHP: 2.18, rHR: 1.08, fwd: 0.34 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lift: 0, rHP: 0.85, rHR: 0.2, rKB: 1.6, spP: -0.05, spR: -0.1, lSR: 0.45, rSR: 0.45 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0, fwd: 0.02 } }
        ]
    },
    KICK_MID: { // K-K middle hit: deep chambered Bruce Lee style side thrust kick
        trail: 'lFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, lHP: 1.68, lHR: 0.68, lKB: 2.35, hipT: -0.45, hipS: -0.08, spR: 0.40 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lHP: 1.88, lHR: 1.15, lKB: 0.0, lFP: 0.95,
                    hipT: -0.82, hipP: -0.28, spP: -0.48, spR: 0.82, hdP: 0.25,
                    lSP: 1.05, lSR: 1.35, lEB: 0.35, rSP: -0.35, rSR: 1.25, rEB: 0.85,
                    fwd: 0.28, rFP: 0.35, turn: 0.15
                }
            },
            { at: 'act', pose: { lHP: 1.92, lHR: 1.20, fwd: 0.32 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lHP: 0.95, lHR: 0.2, lKB: 1.7, spR: 0.1, hipT: 0 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, lFP: 0, rFP: 0 } }
        ]
    },
    RISING_FURY: { // Crouch+Jump+Kick: airborne 540 hurricane rising split kick
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'in', pose: { hipY: -0.42, spP: 0.62, spin: Math.PI * 0.5, lSP: 0.3, rSP: 0.3, lSR: 0.9, rSR: 0.9 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.56, spin: Math.PI * 1.65,
                    rHP: 2.08, rHR: 1.25, rKB: 0.0, lHP: 1.05, lHR: 0.55, lKB: 2.05,
                    spP: -0.58, spR: -0.80, lSP: 0.15, lSR: 1.72, lEB: 0.1, rSP: 0.15, rSR: 1.72, rEB: 0.1,
                    fwd: 0.24
                }
            },
            { at: 'act', pose: { lift: 0.70, spin: Math.PI * 2.15, rHP: 2.16 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0.12, spin: Math.PI * 2, rHP: 0.7, rKB: 1.4, lSR: 0.5, rSR: 0.5 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0 } }
        ]
    },
    DASH_PUNCH: { // Running lunging full-body haymaker
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.22, spY: -0.98, spP: 0.38, rSP: -0.58, rSR: 0.85, rEB: 1.4, lSP: 1.45, lEB: 0.5, fwd: -0.08 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.96, spY: 1.45, spP: 0.55, spR: -0.24, hipY: -0.18, fwd: 0.46,
                    rSP: 1.82, rSR: -0.06, rSY: -0.15, rEB: 0.0,
                    lSP: -0.65, lSR: 0.95, lEB: 1.1,
                    lFz: 0.50, rFz: -0.32, rFP: 0.88, turn: 0.0
                }
            },
            { at: 'act', pose: { fwd: 0.50, rSP: 1.86, spY: 1.50 } },
            { at: 'rec:0.5', ease: 'inout', pose: { fwd: 0.12, spY: 0.35, rSP: 0.95, rEB: 1.4, rFP: 0.2 } }
        ]
    },
    FLYING_KICK: { // Running airborne dropkick / flying side kick — full horizontal airborne layout
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.28, rHP: 1.60, rKB: 2.05, lHP: 1.1, lKB: 1.85, spP: 0.3 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.58, hipP: -0.82, spP: -0.55, spR: -0.68,
                    rHP: 1.95, rHR: 0.80, rKB: 0.0, rFP: 1.0,
                    lHP: 1.15, lHR: 0.45, lKB: 2.30,
                    lSP: 0.35, lSR: 1.55, lEB: 0.2, rSP: -0.35, rSR: 1.55, rEB: 0.2,
                    fwd: 0.40, turn: 0.2
                }
            },
            { at: 'act', pose: { lift: 0.62, rHP: 2.02, fwd: 0.46 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lift: 0.1, hipP: -0.1, spP: 0.2, rHP: 0.8, rKB: 1.5, fwd: 0.08 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0, rFP: 0 } }
        ]
    },
    BACK_SPIN_FIST: { // Back + Punch: wide spinning backfist whip
        trail: 'lFist',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'in', pose: { spin: -Math.PI * 0.9, hipY: -0.16, spY: 0.65, lSP: 0.6, lSR: 0.5, lEB: 2.1 } },
            {
                at: 'hit', ease: 'out', pose: {
                    spin: -Math.PI * 2, hipY: -0.12, spY: -1.20, spP: 0.30, fwd: 0.30,
                    lSP: 1.72, lSR: 1.38, lSY: -0.45, lEB: 0.0,
                    rSP: -0.45, rSR: 0.85, rEB: 1.6, turn: 0.15
                }
            },
            { at: 'act', pose: { lSR: 1.50, fwd: 0.34 } },
            { at: 'rec:0.5', ease: 'inout', pose: { spin: -Math.PI * 2, spY: -0.25, lSP: 1.0, lSR: 0.35, lEB: 1.5, fwd: 0.04 } }
        ]
    },
    WILLOW_KICK: { // Back + Kick: overhead backward scorpion/arc kick (倒挂金钩)
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.32, spP: 0.75, hdP: 0.45, lSP: -0.2, rSP: -0.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rIK: 0, hipY: -0.18, hipP: 0.95, spP: 1.10, hdP: 0.58,
                    rHP: 2.48, rHR: 0.38, rKB: 0.0, rFP: 1.05,
                    lSP: -0.95, lSR: 1.15, lEB: 0.1, rSP: -0.95, rSR: 1.15, rEB: 0.1,
                    fwd: 0.20, lFP: 0.45, turn: 0.25
                }
            },
            { at: 'act', pose: { rHP: 2.56, hipP: 1.02 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipP: 0.2, spP: 0.3, rHP: 0.9, rKB: 1.5, lSP: 0.6, rSP: 0.6 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0 } }
        ]
    },
    GROUND_STOMP: { // Downed opponent stomp: high knee raise -> heavy heel slam
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { rIK: 0, rHP: 1.60, rKB: 2.25, lift: 0.15, hipY: -0.04, spP: -0.12, lSP: 1.1, rSP: 0.9, lSR: 0.6, rSR: 0.6 } },
            {
                at: 'hit', ease: 'in', pose: {
                    rIK: 0, lift: 0, hipY: -0.26, spP: 0.45, fwd: 0.18,
                    rHP: 0.75, rKB: 0.30, rFP: -0.35,
                    lSP: -0.2, lSR: 0.5, lEB: 0.8, rSP: 1.2, rEB: 1.6
                }
            },
            { at: 'act', pose: { hipY: -0.28, spP: 0.48 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rIK: 1, hipY: -0.12, spP: 0.18, rFP: 0, fwd: 0.04 } }
        ]
    },
    THROW_FRONT: { // Shoulder throw
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.18, spP: 0.3, fwd: 0.16, lSP: 1.4, rSP: 1.4, lEB: 0.6, rEB: 0.6 } },
            { at: 'hit', ease: 'inout', pose: { hipY: -0.28, hipT: 0.75, spP: 0.75, spY: 0.85, lSP: 1.6, rSP: 1.7, lEB: 1.5, rEB: 1.4, fwd: 0.1 } },
            { at: 'act', pose: { hipY: -0.32, spP: 0.95, spY: 1.1, rSP: 0.4, lSP: 0.5 } },
            { at: 'rec:0.5', ease: 'out', pose: { hipY: -0.12, spP: 0.2, spY: 0.2 } }
        ]
    },
    THROW_RUN: { // Running head-scissors takedown
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.45, hipP: -0.5, lHP: 1.4, rHP: 1.4, lKB: 0.6, rKB: 0.6 } },
            { at: 'hit', ease: 'inout', pose: { lIK: 0, rIK: 0, lift: 0.25, hipP: -1.1, spin: Math.PI, lHP: 1.6, rHP: 1.6, lSP: 0.3, rSP: 0.3, lSR: 1.1, rSR: 1.1 } },
            { at: 'act', pose: { lift: 0.05, hipY: -0.45, spin: Math.PI * 1.8 } },
            { at: 'rec:0.6', ease: 'out', pose: { lIK: 1, rIK: 1, lift: 0, hipY: -0.15, spin: Math.PI * 2 } }
        ]
    },
    THROW_BACK: { // German suplex arch
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.22, spP: 0.25, fwd: 0.15, lSP: 1.2, rSP: 1.2, lSY: 0.6, rSY: 0.6, lEB: 1.4, rEB: 1.4 } },
            { at: 'hit', ease: 'inout', pose: { hipY: 0.05, hipP: -0.65, spP: -0.85, hdP: -0.6, lift: 0.28, lSP: 1.3, rSP: 1.3, lEB: 1.8, rEB: 1.8 } },
            { at: 'act', pose: { hipY: -0.35, hipP: -1.15, spP: -1.1, lift: 0.1 } },
            { at: 'rec:0.6', ease: 'out', pose: { hipY: -0.12, hipP: 0, spP: 0.1, lift: 0 } }
        ]
    },
    DISARM_KICK: { // Run + Jump + Punch: acrobatic vaulting disarm kick + mid-air weapon snatch
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.35, hipP: -0.45, rHP: 1.70, rKB: 1.95, lHP: 1.05, lKB: 1.75, rSP: 1.45, lSP: 0.9 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.62, hipP: -0.85, spP: -0.45,
                    rHP: 2.08, rHR: 0.68, rKB: 0.0, rFP: 1.0,
                    lHP: 1.15, lKB: 2.20,
                    rSP: 1.90, rEB: 0.05, lSP: -0.65, lSR: 1.35, lEB: 0.25,
                    fwd: 0.38, turn: 0.2
                }
            },
            { at: 'act', pose: { lift: 0.58, rHP: 2.14, rSP: 1.95 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0.1, hipP: -0.1, spP: 0.15, rHP: 0.8, rKB: 1.4, rSP: 1.0, rEB: 1.4 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0, rFP: 0 } }
        ]
    },
    FIRE_WEAPON: { // Tactical two-handed / one-handed gun-fu firing stance with recoil kick
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipY: -0.1, hipT: 0.25, spY: 0.35, spP: 0.12,
                    rSP: 1.55, rSR: -0.05, rSY: 0.22, rEB: 0.08,
                    lSP: 1.40, lSR: 0.05, lSY: 0.55, lEB: 0.55,
                    turn: 0.2
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: -0.11, hipT: 0.22, spY: 0.28, spP: -0.08, hdP: -0.08,
                    rSP: 1.75, rSR: -0.04, rSY: 0.22, rEB: 0.18, rWB: -0.25,
                    lSP: 1.48, lSR: 0.08, lSY: 0.55, lEB: 0.65,
                    fwd: -0.05, turn: 0.2
                }
            },
            { at: 'act', pose: { rSP: 1.68, spP: -0.04 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rSP: 1.48, rEB: 0.35, spP: 0.08, fwd: 0 } }
        ]
    },
    THROW_WEAPON: { // Whipping empty gun at opponent's face
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipT: -0.25, spY: -0.65, rSP: 0.35, rSR: 0.65, rEB: 2.1, lSP: 1.1 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.55, spY: 0.95, spP: 0.28, fwd: 0.18,
                    rSP: 1.70, rSR: 0.15, rSY: 0.35, rEB: 0.05,
                    lSP: 0.4, lSR: 0.6, lEB: 2.0, turn: 0.1
                }
            },
            { at: 'act', pose: { rSP: 1.55, fwd: 0.2 } },
            { at: 'rec:0.5', ease: 'inout', pose: { spY: 0.3, rSP: 0.95, rEB: 1.5, fwd: 0.05 } }
        ]
    },
    USE_HYPO: { // P3 Hypo-Spray neck/chest bio-injection + deep breath
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipY: -0.14, spP: 0.18, hdP: 0.2,
                    rSP: 1.45, rSR: -0.15, rSY: 0.65, rEB: 2.35,
                    lSP: 0.85, lSR: 0.25, lEB: 1.85, turn: 0.5
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: -0.05, spP: -0.22, hdP: -0.35,
                    rSP: 1.55, rSR: -0.2, rSY: 0.72, rEB: 2.5,
                    lSP: 0.4, lSR: 0.55, lEB: 1.2, turn: 0.6
                }
            },
            { at: 'act', pose: { spP: -0.28, hdP: -0.4 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipY: -0.08, spP: 0.08, rSP: 0.85, rEB: 1.9, hdP: 0.05 } }
        ]
    },
    DEVIL_SPIN_KICK: { // P4 Stage-3 Awakened 720° Cyclone Spin Kick
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'in', pose: { hipY: -0.25, spP: 0.35, spin: Math.PI * 0.8, lSP: 0.4, rSP: 0.4, lSR: 1.0, rSR: 1.0 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.36, spin: Math.PI * 2.2,
                    rHP: 1.85, rHR: 1.18, rKB: 0.0, rFP: 0.95,
                    lHP: 0.9, lKB: 1.9,
                    spP: -0.48, spR: -0.68,
                    lSP: 0.2, lSR: 1.55, lEB: 0.2, rSP: 0.2, rSR: 1.55, rEB: 0.2,
                    fwd: 0.28, turn: 0.2
                }
            },
            { at: 'act', pose: { lift: 0.42, spin: Math.PI * 3.8, rHP: 1.90 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0.08, spin: Math.PI * 4, rHP: 0.75, rKB: 1.4, lSR: 0.5, rSR: 0.5 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0, rFP: 0 } }
        ]
    },
    DAODAN_SURGE: { // P4 Daodan Chrysalis Overdrive Burst (coil in -> explosive arch outward)
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'in', pose: {
                    hipY: -0.32, spP: 0.55, hdP: 0.45,
                    lSP: 1.35, lSY: 0.65, lEB: 2.3, rSP: 1.35, rSY: 0.65, rEB: 2.3, turn: 0.8
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: 0.06, lift: 0.18, spP: -0.52, hdP: -0.65,
                    lSP: 0.25, lSR: 1.45, lEB: 0.25, rSP: 0.25, rSR: 1.45, rEB: 0.25,
                    lFP: 0.45, rFP: 0.45, turn: 0.95
                }
            },
            { at: 'act', pose: { lift: 0.22, spP: -0.58, lSR: 1.55, rSR: 1.55 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0, hipY: -0.08, spP: 0.05, lSR: 0.4, rSR: 0.4, lEB: 1.6, rEB: 1.8, lFP: 0, rFP: 0 } }
        ]
    }
};

// ---------------------------------------------------------------- easing / blending
const EASE = {
    linear: t => t,
    out: t => 1 - Math.pow(1 - t, 3),
    in: t => t * t * t,
    inout: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
};
const clamp01 = t => Math.max(0, Math.min(1, t));

function blendInto(out, a, b, t) {
    for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
}

// compiled tracks cached per move: [{frame, pose, ease}]
const compiled = new Map();

function anchorFrame(at, move) {
    const s = move.startup, a = move.active, r = move.recovery;
    if (at === 'wind') return Math.max(1, s * 0.55);
    if (at === 'hit') return s;
    if (at === 'act') return s + a - 1;
    if (typeof at === 'string' && at.startsWith('rec:')) return s + a + r * parseFloat(at.slice(4));
    return Number(at);
}

function compile(move) {
    let c = compiled.get(move.id);
    if (c) return c;
    const anim = ATTACK_ANIMS[move.id];
    c = [{ frame: 0, pose: GUARD, ease: 'out' }];
    let prev = GUARD;
    for (const key of anim.keys) {
        const pose = Object.assign(makePose(), prev, key.pose);
        c.push({ frame: anchorFrame(key.at, move), pose, ease: key.ease || 'out' });
        prev = pose;
    }
    const endPose = makePose(GUARD);
    if (anim.keepSpin) endPose.spin = prev.spin; // finish the 360 instead of unwinding
    c.push({ frame: move.startup + move.active + move.recovery, pose: endPose, ease: 'inout' });
    compiled.set(move.id, c);
    return c;
}

/** Sample an attack pose at a (possibly fractional) frame inside the move. */
function sampleAttack(out, move, frame) {
    if (!ATTACK_ANIMS[move.id]) return Object.assign(out, GUARD);
    const keys = compile(move);
    for (let i = 1; i < keys.length; i++) {
        const k1 = keys[i];
        if (frame <= k1.frame || i === keys.length - 1) {
            const k0 = keys[i - 1];
            const t = clamp01((frame - k0.frame) / Math.max(1e-3, k1.frame - k0.frame));
            return blendInto(out, k0.pose, k1.pose, EASE[k1.ease](t));
        }
    }
    return out;
}

// ---------------------------------------------------------------- locomotion
/**
 * Natural biomechanical foot kinematics along a cyclic gait.
 * Stance: planted foot travels backward linearly relative to pelvis (zero skating).
 * Includes smooth heel-strike dorsiflexion (-pitch), flat mid-stance (0), and push-off plantarflexion (+pitch).
 * Swing:
 *  - Walk: smooth forward sweep with natural knee lift and foot clearance.
 *  - Run: athletic fold-and-drive (shin folds up behind hip early in swing, knee drives forward, then extends down).
 */
function gaitFoot(phase, stride, stanceFrac, liftH, isRun = false) {
    const u = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
    if (u < stanceFrac) {
        const pStance = u / stanceFrac; // 0 (strike) -> 1 (toe-off)
        const z = stride * (0.5 - pStance);
        // Heel-to-toe roll:
        // Initial heel-strike dorsiflexion (-pitch) rolls flat, then ball-of-foot push-off (+pitch)
        let pitch = 0;
        if (pStance < 0.22) {
            pitch = (1 - pStance / 0.22) * -0.16;
        } else if (pStance > 0.58) {
            pitch = ((pStance - 0.58) / 0.42) * 0.40;
        }
        return { z, y: 0, swing: 0, pitch };
    }

    const pSwing = (u - stanceFrac) / (1 - stanceFrac); // 0 -> 1

    if (isRun) {
        // High-performance anime operative sprint mechanics:
        // 1. Early recovery (0 -> 0.44): deep knee flexion, heel kicks high behind pelvis to minimize rotational inertia
        // 2. Drive phase (0.44 -> 1.0): knee drives forward aggressively, lower leg sweeps out and plants
        let z, y;
        if (pSwing < 0.44) {
            const sEarly = pSwing / 0.44;
            const easeEarly = sEarly * sEarly * (3 - 2 * sEarly);
            z = stride * (-0.5 + 0.30 * easeEarly);
            y = liftH * Math.sin(sEarly * Math.PI * 0.85);
        } else {
            const sLate = (pSwing - 0.44) / 0.56;
            const easeLate = sLate * sLate * (3 - 2 * sLate);
            z = stride * (-0.20 + 0.70 * easeLate);
            const drop = Math.cos(sLate * Math.PI * 0.5);
            y = liftH * Math.sin(Math.PI * 0.85) * drop;
        }
        const pitch = Math.sin(pSwing * Math.PI) * 0.22;
        return { z, y, swing: Math.sin(pSwing * Math.PI), pitch };
    }

    // Walk swing: smooth quintic trajectory with natural ground clearance
    const e = pSwing * pSwing * pSwing * (pSwing * (pSwing * 6 - 15) + 10);
    const z = stride * (-0.5 + e);
    const swingLift = Math.sin(Math.PI * pSwing);
    const y = liftH * swingLift;
    const pitch = (1 - pSwing) * 0.16 - pSwing * 0.12;
    return { z, y, swing: swingLift, pitch };
}

// Strictly synchronized locomotion cadence:
// stride and perMeter satisfy 2 * stride * perMeter = 2 * PI, guaranteeing exact 0 foot skating on ground.
export const GAIT = {
    WALK: { perMeter: 5.41, stance: 0.55, stride: 0.58 },
    RUN:  { perMeter: 3.57, stance: 0.36, stride: 0.88 }
};

/**
 * Resolve the target pose for a fighter snapshot.
 * @param {Object} out    pose object to write into
 * @param {Object} f      fighter (read-only)
 * @param {Object} loco   locomotion state { phase } maintained by the rig
 * @param {number} t      wall clock seconds (cosmetic idle motion only)
 */
export function resolvePose(out, f, loco, t) {
    const st = f.state;
    const timer = f.stateTimer;
    out.gait = false;

    if ((st === FIGHTER_STATE.ATTACK || st === FIGHTER_STATE.THROW) && f.currentMove) {
        return sampleAttack(out, f.currentMove, timer);
    }

    if (st === FIGHTER_STATE.BEING_THROWN) {
        Object.assign(out, GRABBED_POSE);
        const p = clamp01(timer / 18);
        out.lift = Math.sin(p * Math.PI) * 0.45;
        out.hipP = 0.35 - p * 1.45;
        return out;
    }

    if (st === FIGHTER_STATE.CROUCH) {
        Object.assign(out, CROUCH_POSE);
        return out;
    }

    if (st === FIGHTER_STATE.EVADE || st === FIGHTER_STATE.TECH_RECOVERY) {
        const dur = st === FIGHTER_STATE.TECH_RECOVERY ? 16 : 18;
        const p = clamp01(timer / dur);
        Object.assign(out, GUARD, {
            lIK: 0, rIK: 0,
            hipY: -0.25 + Math.sin(p * Math.PI) * 0.38,
            hipP: -p * Math.PI * 2,
            spP: 0.45,
            lHP: 1.2, lKB: 1.9, rHP: 1.0, rKB: 1.8,
            lSP: 1.1, lEB: 1.6, rSP: 1.1, rEB: 1.6,
            turn: 0.3
        });
        return out;
    }

    if (st === FIGHTER_STATE.DIZZY) {
        Object.assign(out, DIZZY_BASE);
        const sw = Math.sin(t * 6.5);
        const cw = Math.cos(t * 6.5);
        out.hipS = sw * 0.08;
        out.spR = sw * 0.18;
        out.spP = 0.25 + cw * 0.14;
        out.hdY = sw * 0.35;
        out.hdP = 0.35 + cw * 0.2;
        return out;
    }

    if (st === FIGHTER_STATE.HIT_STUN) {
        const dur = f.hitStunDuration || 16;
        const k = timer < 3 ? EASE.out(timer / 3) : 1 - EASE.inout(clamp01((timer - 3) / Math.max(1, dur - 3)));
        return blendInto(out, GUARD, HIT_RECOIL, k);
    }

    if (st === FIGHTER_STATE.KNOCKED_DOWN || st === FIGHTER_STATE.DEFEAT) {
        Object.assign(out, f.y > 0.05 ? LAUNCHED : LYING);
        if (f.y <= 0.05 && st === FIGHTER_STATE.DEFEAT) out.hdY = 0.7;
        return out;
    }

    if (st === FIGHTER_STATE.WAKEUP) {
        const p = clamp01(timer / 22);
        if (p < 0.45) blendInto(out, LYING, SIT_UP, EASE.inout(p / 0.45));
        else blendInto(out, SIT_UP, GUARD, EASE.inout((p - 0.45) / 0.55));
        return out;
    }

    if (st === FIGHTER_STATE.VICTORY) {
        Object.assign(out, VICTORY);
        out.hipY += Math.sin(t * 2.2) * 0.012;
        out.rSP += Math.sin(t * 2.2) * 0.04;
        return out;
    }

    if (st === FIGHTER_STATE.BLOCK || (f.isBlocking && st !== FIGHTER_STATE.WALK)) {
        Object.assign(out, BLOCK);
        if (st === FIGHTER_STATE.BLOCK && timer < 5) { out.fwd = -0.1; out.spP = 0.12; out.rFP = 0.2; } // blockstun shove
        return out;
    }

    if (!f.isGrounded) {
        Object.assign(out, AIR);
        return out;
    }

    if (st === FIGHTER_STATE.RUN) {
        const ph = loco.phase;
        const s = Math.sin(ph), c = Math.cos(ph);
        const g = GAIT.RUN;
        const stride = g.stride;
        const L = gaitFoot(ph, stride, g.stance, 0.25, true);
        const R = gaitFoot(ph + Math.PI, stride, g.stance, 0.25, true);

        // Athletic anime operative sprint:
        // Torso: distinct forward aerodynamic tilt (~21.8 deg) with eyes locked forward on target
        const bob = Math.cos(ph * 2) * 0.035;
        const hipY = -0.095 + bob;
        const lift = Math.max(0, bob) * 0.09;
        const fwd = 0.09;
        const spP = 0.38;
        const hdP = -0.22; // gaze locked on target

        // Arms: dynamic contralateral sprint pump, elbows bent tight ~87° (1.52 rad)
        const baseSP = 0.45;
        const swingGain = 1.45;
        const lSP = baseSP + R.z * swingGain;
        const rSP = baseSP + L.z * swingGain;
        const lEB = 1.52 + Math.max(0, R.z) * 0.25;
        const rEB = 1.52 + Math.max(0, L.z) * 0.25;

        // Dynamic pelvis and torso counter-rotation
        const hipT = -s * 0.14;
        const spY = s * 0.20;
        const hipR = c * 0.04;
        const hipS = -c * 0.02;

        Object.assign(out, GUARD, {
            lFx: 0.10, rFx: 0.10,
            lFz: L.z, lFy: L.y, lFP: L.pitch,
            rFz: R.z, rFy: R.y, rFP: R.pitch,
            lFY: 0.04, rFY: 0.04,
            hipY, fwd, lift, hipT, hipR, hipS,
            spP, spY, spR: 0, hdP, hdY: 0,
            lSP, lSR: 0.20, lSY: -R.z * 0.10, lEB, lWB: 0.10,
            rSP, rSR: 0.20, rSY: -L.z * 0.10, rEB, rWB: 0.10,
            turn: 0.05
        });
        out.gait = true;
        return out;
    }

    if (st === FIGHTER_STATE.WALK) {
        // Oni 2001 4-Directional Combat Footwork:
        // Grounded, deliberate martial-arts walk with natural heel-to-toe roll,
        // inverted-pendulum vertical vaulting, and stylish tactical arm carriage.
        const ph = loco.phase;
        const s = Math.sin(ph), c = Math.cos(ph);
        const g = GAIT.WALK;
        const stride = g.stride;
        const L = gaitFoot(ph, stride, g.stance, 0.09, false);
        const R = gaitFoot(ph + Math.PI, stride, g.stance, 0.09, false);

        const yaw = typeof f.facingAngle === 'number' ? f.facingAngle : (f.facing === -1 ? Math.PI : 0);
        const fx = Math.cos(yaw), fz = Math.sin(yaw);
        const rx = -fz, rz = fx;
        const spd = Math.hypot(f.vx || 0, f.vz || 0);
        const fwdFrac = spd > 0.05 ? ((f.vx * fx + f.vz * fz) / spd) : 1;
        const sideFrac = spd > 0.05 ? ((f.vx * rx + f.vz * rz) / spd) : 0;
        const absFwd = Math.abs(fwdFrac), absSide = Math.abs(sideFrac);

        // Pure forward/backward walking vs lateral strafe foot spacing
        const baseWidth = 0.11;
        const lFx = baseWidth + Math.max(0, -sideFrac) * 0.05;
        const rFx = baseWidth + Math.max(0, sideFrac) * 0.05;

        const lFz = L.z * (0.50 + 0.50 * absFwd);
        const rFz = R.z * (0.50 + 0.50 * absFwd);
        const lFy = L.y * (0.85 + 0.15 * absSide);
        const rFy = R.y * (0.85 + 0.15 * absSide);

        const lFP = L.pitch;
        const rFP = R.pitch;

        // Biomechanical vertical bob:
        // Highest at mid-stance (vaulting over stance leg), lowest at heel strike (weight acceptance)
        const bob = -Math.cos(ph * 2) * 0.018;
        const hipY = -0.088 + bob;
        const fwd = 0.02 + fwdFrac * 0.030;
        const hipS = -c * 0.018 * absFwd - sideFrac * 0.040;
        const hipR = c * 0.028 * absFwd + sideFrac * 0.065;

        // Straight forward spine (natural combat awareness)
        const hipT = -s * 0.06 * absFwd - sideFrac * 0.10;
        const spP = 0.12 + fwdFrac * 0.05;
        const spY = s * 0.08 * absFwd + sideFrac * 0.08;
        const spR = -sideFrac * 0.06;
        const hdP = -fwdFrac * 0.02;

        Object.assign(out, GUARD);
        out.lFx = lFx; out.rFx = rFx;
        out.lFz = lFz; out.rFz = rFz;
        out.lFy = lFy; out.rFy = rFy;
        out.lFP = lFP; out.rFP = rFP;
        out.lFY = 0.04; out.rFY = 0.04;
        out.hipY = hipY; out.fwd = fwd;
        out.hipS = hipS; out.hipR = hipR;
        out.hipT = hipT; out.spP = spP;
        out.spY = spY; out.spR = spR;
        out.hdP = hdP; out.hdY = 0;
        out.turn = 0.12 * absFwd + 0.70 * (1 - absFwd);

        // Upper body & Arm motion:
        // When blocking or retreating backwards, raise forearm tactical guard
        if (f.isBlocking || fwdFrac < -0.22) {
            out.lSP = 1.18 + s * 0.10; out.lSR = 0.12; out.lSY = 0.24; out.lEB = 2.15;
            out.rSP = 1.05 - s * 0.10; out.rSR = 0.14; out.rSY = 0.28; out.rEB = 2.22;
        } else {
            // Elegant, athletic tactical operative walk:
            // Hands held ready near torso center line with natural counter-swing
            const baseArmSP = 0.42;
            const baseEB = 1.35;
            const swingGain = 0.65;
            out.lSP = baseArmSP + R.z * swingGain;
            out.rSP = baseArmSP + L.z * swingGain;
            out.lSR = 0.20;
            out.rSR = 0.20;
            out.lSY = 0.10;
            out.rSY = 0.10;
            out.lEB = baseEB + Math.sin(ph) * 0.08;
            out.rEB = baseEB - Math.sin(ph) * 0.08;
        }
        out.gait = true;
        return out;
    }

    // IDLE: relaxed combat readiness with organic breathing and gentle weight shift
    Object.assign(out, GUARD);
    const b = Math.sin(t * 2.2);
    const w = Math.sin(t * 1.2 + (f.id === 'p2' ? 1.7 : 0));
    const br = Math.sin(t * 1.8);
    out.hipY = GUARD.hipY + b * 0.012;
    out.hipS = w * 0.022;
    out.hipR = w * 0.030;
    out.hipT = GUARD.hipT + w * 0.040;
    out.spP = GUARD.spP + b * 0.020 + br * 0.015;
    out.spR = GUARD.spR - w * 0.030;
    out.spY = GUARD.spY + Math.sin(t * 0.9) * 0.050;
    out.hdY = GUARD.hdY - w * 0.035;
    out.lFP = Math.max(0, b) * 0.08;
    out.rFP = 0.15 + Math.max(0, b) * 0.10;
    out.lSP = GUARD.lSP + br * 0.04;
    out.rSP = GUARD.rSP - br * 0.04;
    out.lEB = GUARD.lEB + b * 0.05;
    out.rEB = GUARD.rEB - b * 0.05;
    return out;
}
