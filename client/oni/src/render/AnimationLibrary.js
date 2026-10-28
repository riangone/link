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
    PUNCH_1: { // lead jab: deep lunge step-in, full shoulder whip & rear arm counterbalance
        trail: 'lFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.14, spY: 0.32, lSP: 0.55, lSR: 0.45, lEB: 2.35, fwd: -0.06 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lSP: 1.68, lSR: -0.08, lSY: -0.15, lEB: 0.0, lWB: -0.08,
                    spY: -0.92, spP: 0.34, spR: 0.12, hipT: -0.35, hdP: 0.18,
                    rSP: -0.25, rSR: 0.65, rSY: 0.15, rEB: 1.75,
                    lFz: 0.44, rFz: -0.26, rFP: 0.45, hipY: -0.16, fwd: 0.28, hipS: 0.05, turn: 0.05
                }
            },
            { at: 'act', pose: { lSP: 1.72, spY: -0.98, fwd: 0.32, lEB: 0.0 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lSP: 1.15, lEB: 1.25, spY: -0.28, fwd: 0.08, lFz: 0.32, rFz: -0.26, rFP: 0.1 } }
        ]
    },
    PUNCH_2: { // rear cross: deep coil, full hip/shoulder torque, rear heel pivot, lead arm whipped back
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipT: -0.45, spY: -0.82, hipY: -0.16, fwd: -0.10, hipS: -0.04,
                    rSP: 0.15, rSR: 0.55, rEB: 2.5, lSP: 1.35, lEB: 0.9, lSY: 0.1, hdY: 0.25
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.85, spY: 1.28, spP: 0.42, spR: -0.18, hipY: -0.18, fwd: 0.36, hipS: 0.07,
                    rSP: 1.68, rSR: -0.08, rSY: -0.18, rEB: 0.0, rWB: -0.05,
                    lSP: -0.55, lSR: 0.85, lSY: -0.2, lEB: 1.35,
                    lFz: 0.42, rFz: -0.24, rFY: 0.12, rFP: 0.78, hdY: -0.45, hdP: 0.16, turn: 0.0
                }
            },
            { at: 'act', pose: { spY: 1.38, rSP: 1.74, fwd: 0.40, rEB: 0.0 } },
            { at: 'rec:0.45', ease: 'inout', pose: { spY: 0.42, hipT: 0.38, rSP: 1.0, rEB: 1.25, fwd: 0.12, rFP: 0.25, rFY: 0.45 } }
        ]
    },
    UPPERCUT: { // rising dragon: deep crouch coil -> explosive skyward uppercut with full body arch & knee drive
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipY: -0.38, spP: 0.78, spY: -0.75, hipT: -0.35, hdP: 0.35, fwd: -0.04,
                    rSP: -0.75, rSR: 0.45, rEB: 1.65, lSP: 1.25, lSR: 0.45, lEB: 1.9,
                    lFz: 0.32, rFz: -0.34, rFx: 0.18
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: 0.16, spP: -0.58, spY: 0.98, spR: -0.24, hipT: 0.65, hdP: -0.68, fwd: 0.22,
                    rSP: 3.05, rSR: 0.15, rSY: 0.1, rEB: 0.12, rWB: -0.25,
                    lSP: -0.85, lSR: 0.95, lEB: 0.45,
                    rIK: 0, lIK: 0, rHP: 1.48, rKB: 1.85, lHP: -0.35, lKB: 0.15, rFP: 0.85, lFP: 0.95,
                    lift: 0.48, turn: 0.25
                }
            },
            { at: 'act', pose: { lift: 0.62, rSP: 3.12, rEB: 0.05, spP: -0.65 } },
            { at: 'rec:0.5', ease: 'in', pose: { lift: 0.0, hipY: -0.22, spP: 0.28, rSP: 1.2, rEB: 1.4, lIK: 1, rIK: 1, lFP: 0, rFP: 0, rHP: 0.2, rKB: 0.6 } }
        ]
    },
    KICK_LOW: { // wide snapping roundhouse kick: high knee chamber, full hip turnover, wide counter-swing arms
        trail: 'rFoot',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    rIK: 0, rHP: 1.55, rHR: 0.55, rKB: 2.35, rFP: 0.7,
                    hipS: 0.09, hipT: 0.42, hipY: -0.08, fwd: 0.08, spP: -0.15,
                    lSP: 1.15, lSR: 0.65, rSP: -0.35, rSR: 0.85, rEB: 1.4
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 1.48, rHR: 0.72, rKB: 0.0, rFP: 1.05,
                    hipT: 0.78, hipP: -0.28, spP: -0.58, spY: 0.55, spR: -0.38, hdP: 0.35,
                    lSP: 0.95, lSR: 1.35, lEB: 0.45, rSP: -0.65, rSR: 1.35, rEB: 0.35,
                    fwd: 0.22, lFY: 0.68, lFP: 0.35, turn: 0.15
                }
            },
            { at: 'act', pose: { rHP: 1.56, rHR: 0.82, fwd: 0.26 } },
            { at: 'rec:0.45', ease: 'inout', pose: { rHP: 1.15, rHR: 0.25, rKB: 1.85, spP: -0.12, hipT: 0.3, lSR: 0.45, rSR: 0.45, rSP: 0.4, rEB: 1.7 } },
            { at: 'rec:0.8', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0, hipS: 0.02, fwd: 0.02, lFY: 0.22 } }
        ]
    },
    KICK_HEAVY: { // 360 spinning high hook/roundhouse: deep torso tilt, wide eagle-wing arms, high head-level leg extension
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
                    spin: Math.PI * 2, rIK: 0, rHP: 1.98, rHR: 1.28, rKB: 0.0, rFP: 1.0,
                    spR: -0.95, spP: -0.58, hipR: -0.35, hipP: -0.25, hdY: 0.25, hdP: 0.25,
                    lSP: 0.1, lSR: 1.75, lEB: 0.1, rSP: -0.2, rSR: 1.65, rEB: 0.1,
                    fwd: 0.26, lift: 0.14, lFP: 0.55, turn: 0.15
                }
            },
            { at: 'act', pose: { spin: Math.PI * 2 + 0.38, rHP: 2.05, rHR: 1.35, fwd: 0.30 } },
            { at: 'rec:0.55', ease: 'inout', pose: { spin: Math.PI * 2, lift: 0, rHP: 0.7, rHR: 0.3, rKB: 1.4, spR: -0.2, spP: 0.0, lSR: 0.6, rSR: 0.6, lEB: 1.4, rEB: 1.4, lFP: 0.1 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0 } }
        ]
    },
    SLIDE_KICK: { // Oni signature baseball slide sweep: full ground drop, body stretched horizontal, kicking leg fully locked out
        trail: 'rFoot',
        keys: [
            {
                at: 'wind', ease: 'in', pose: {
                    hipY: -0.38, spP: 0.62, fwd: 0.16, lSP: -0.55, rSP: 1.25, rEB: 1.5,
                    rFz: -0.12, rFP: 0.75
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, hipY: -0.74, hipP: -1.08, spP: -0.38, hdP: 0.68, fwd: 0.34,
                    rHP: 1.18, rHR: 0.22, rKB: 0.0, rFP: 1.05, lHP: 0.45, lHR: 0.45, lKB: 2.15, lFP: 0.4,
                    lSP: -1.35, lSR: 0.75, lEB: 0.05, rSP: 1.35, rSR: 0.55, rEB: 1.25, turn: 0.5
                }
            },
            { at: 'act', pose: { hipY: -0.76, spP: -0.44, fwd: 0.40, rHP: 1.24 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipY: -0.48, hipP: -0.32, spP: 0.52, rHP: 0.95, rKB: 1.35, lHP: 1.35, lKB: 2.0, lSP: 0.3, lEB: 1.0, fwd: 0.12 } },
            { at: 'rec:0.85', ease: 'out', pose: { lIK: 1, rIK: 1, hipY: -0.18, hipP: 0, spP: 0.22, rFP: 0, lFP: 0, fwd: 0.02 } }
        ]
    },
    COMBO_PUNCH_KICK: { // P-P-K finisher: explosive high axe/crescent kick with dramatic torso lean-back
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { rIK: 0, rHP: 1.65, rHR: 0.55, rKB: 2.2, hipT: 0.38, spP: -0.22, lSP: 1.25, rSP: -0.35 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 2.05, rHR: 0.95, rKB: 0.0, rFP: 1.0,
                    hipT: 0.85, hipP: -0.32, spP: -0.64, spR: -0.68, hdP: 0.38,
                    lSP: 0.25, lSR: 1.65, lEB: 0.15, rSP: -0.35, rSR: 1.55, rEB: 0.15,
                    fwd: 0.28, lift: 0.12, lFP: 0.45, turn: 0.15
                }
            },
            { at: 'act', pose: { rHP: 2.14, rHR: 1.08, fwd: 0.32 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lift: 0, rHP: 0.85, rHR: 0.2, rKB: 1.6, spP: -0.05, spR: -0.1, lSR: 0.45, rSR: 0.45 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0, fwd: 0.02 } }
        ]
    },
    KICK_MID: { // K-K middle hit: deep chambered Bruce Lee style side thrust kick
        trail: 'lFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, lHP: 1.62, lHR: 0.65, lKB: 2.3, hipT: -0.42, hipS: -0.08, spR: 0.38 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lHP: 1.82, lHR: 1.12, lKB: 0.0, lFP: 0.9,
                    hipT: -0.78, hipP: -0.25, spP: -0.45, spR: 0.78, hdP: 0.25,
                    lSP: 1.05, lSR: 1.35, lEB: 0.35, rSP: -0.35, rSR: 1.25, rEB: 0.85,
                    fwd: 0.26, rFP: 0.35, turn: 0.15
                }
            },
            { at: 'act', pose: { lHP: 1.88, lHR: 1.18, fwd: 0.30 } },
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
                    lIK: 0, rIK: 0, lift: 0.52, spin: Math.PI * 1.65,
                    rHP: 2.02, rHR: 1.22, rKB: 0.0, lHP: 1.05, lHR: 0.55, lKB: 2.05,
                    spP: -0.55, spR: -0.78, lSP: 0.15, lSR: 1.72, lEB: 0.1, rSP: 0.15, rSR: 1.72, rEB: 0.1,
                    fwd: 0.22
                }
            },
            { at: 'act', pose: { lift: 0.68, spin: Math.PI * 2.15, rHP: 2.12 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0.12, spin: Math.PI * 2, rHP: 0.7, rKB: 1.4, lSR: 0.5, rSR: 0.5 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0 } }
        ]
    },
    DASH_PUNCH: { // Running lunging full-body haymaker
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.20, spY: -0.95, spP: 0.35, rSP: -0.55, rSR: 0.85, rEB: 1.4, lSP: 1.45, lEB: 0.5, fwd: -0.08 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.92, spY: 1.42, spP: 0.52, spR: -0.22, hipY: -0.18, fwd: 0.44,
                    rSP: 1.75, rSR: -0.08, rSY: -0.15, rEB: 0.0,
                    lSP: -0.65, lSR: 0.95, lEB: 1.1,
                    lFz: 0.48, rFz: -0.30, rFP: 0.85, turn: 0.0
                }
            },
            { at: 'act', pose: { fwd: 0.48, rSP: 1.82, spY: 1.48 } },
            { at: 'rec:0.5', ease: 'inout', pose: { fwd: 0.10, spY: 0.35, rSP: 0.95, rEB: 1.4, rFP: 0.2 } }
        ]
    },
    FLYING_KICK: { // Running airborne dropkick / flying side kick — full horizontal airborne layout
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.26, rHP: 1.55, rKB: 2.0, lHP: 1.1, lKB: 1.85, spP: 0.3 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.54, hipP: -0.78, spP: -0.52, spR: -0.65,
                    rHP: 1.88, rHR: 0.78, rKB: 0.0, rFP: 1.0,
                    lHP: 1.15, lHR: 0.45, lKB: 2.25,
                    lSP: 0.35, lSR: 1.55, lEB: 0.2, rSP: -0.35, rSR: 1.55, rEB: 0.2,
                    fwd: 0.38, turn: 0.2
                }
            },
            { at: 'act', pose: { lift: 0.58, rHP: 1.96, fwd: 0.44 } },
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
                    spin: -Math.PI * 2, hipY: -0.12, spY: -1.15, spP: 0.28, fwd: 0.28,
                    lSP: 1.65, lSR: 1.35, lSY: -0.45, lEB: 0.0,
                    rSP: -0.45, rSR: 0.85, rEB: 1.6, turn: 0.15
                }
            },
            { at: 'act', pose: { lSR: 1.48, fwd: 0.32 } },
            { at: 'rec:0.5', ease: 'inout', pose: { spin: -Math.PI * 2, spY: -0.25, lSP: 1.0, lSR: 0.35, lEB: 1.5, fwd: 0.04 } }
        ]
    },
    WILLOW_KICK: { // Back + Kick: overhead backward scorpion/arc kick (倒挂金钩)
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.32, spP: 0.75, hdP: 0.45, lSP: -0.2, rSP: -0.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rIK: 0, hipY: -0.18, hipP: 0.92, spP: 1.05, hdP: 0.55,
                    rHP: 2.42, rHR: 0.35, rKB: 0.0, rFP: 1.05,
                    lSP: -0.95, lSR: 1.15, lEB: 0.1, rSP: -0.95, rSR: 1.15, rEB: 0.1,
                    fwd: 0.18, lFP: 0.45, turn: 0.25
                }
            },
            { at: 'act', pose: { rHP: 2.52, hipP: 0.98 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipP: 0.2, spP: 0.3, rHP: 0.9, rKB: 1.5, lSP: 0.6, rSP: 0.6 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0 } }
        ]
    },
    GROUND_STOMP: { // Downed opponent stomp: high knee raise -> heavy heel slam
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { rIK: 0, rHP: 1.55, rKB: 2.2, lift: 0.14, hipY: -0.04, spP: -0.12, lSP: 1.1, rSP: 0.9, lSR: 0.6, rSR: 0.6 } },
            {
                at: 'hit', ease: 'in', pose: {
                    rIK: 0, lift: 0, hipY: -0.24, spP: 0.42, fwd: 0.16,
                    rHP: 0.72, rKB: 0.35, rFP: -0.35,
                    lSP: -0.2, lSR: 0.5, lEB: 0.8, rSP: 1.2, rEB: 1.6
                }
            },
            { at: 'act', pose: { hipY: -0.26, spP: 0.46 } },
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
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.32, hipP: -0.45, rHP: 1.65, rKB: 1.9, lHP: 1.05, lKB: 1.75, rSP: 1.45, lSP: 0.9 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.58, hipP: -0.82, spP: -0.42,
                    rHP: 2.02, rHR: 0.65, rKB: 0.0, rFP: 1.0,
                    lHP: 1.15, lKB: 2.15,
                    rSP: 1.85, rEB: 0.05, lSP: -0.65, lSR: 1.35, lEB: 0.25,
                    fwd: 0.36, turn: 0.2
                }
            },
            { at: 'act', pose: { lift: 0.55, rHP: 2.08, rSP: 1.9 } },
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
                    rSP: 1.52, rSR: -0.05, rSY: 0.22, rEB: 0.08,
                    lSP: 1.38, lSR: 0.05, lSY: 0.55, lEB: 0.55,
                    turn: 0.2
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: -0.11, hipT: 0.22, spY: 0.28, spP: -0.06, hdP: -0.08,
                    rSP: 1.72, rSR: -0.04, rSY: 0.22, rEB: 0.18, rWB: -0.25,
                    lSP: 1.45, lSR: 0.08, lSY: 0.55, lEB: 0.65,
                    fwd: -0.04, turn: 0.2
                }
            },
            { at: 'act', pose: { rSP: 1.65, spP: -0.02 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rSP: 1.45, rEB: 0.35, spP: 0.08, fwd: 0 } }
        ]
    },
    THROW_WEAPON: { // Whipping empty gun at opponent's face
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipT: -0.25, spY: -0.65, rSP: 0.35, rSR: 0.65, rEB: 2.1, lSP: 1.1 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.55, spY: 0.95, spP: 0.28, fwd: 0.18,
                    rSP: 1.65, rSR: 0.15, rSY: 0.35, rEB: 0.05,
                    lSP: 0.4, lSR: 0.6, lEB: 2.0, turn: 0.1
                }
            },
            { at: 'act', pose: { rSP: 1.5, fwd: 0.2 } },
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
                    lIK: 0, rIK: 0, lift: 0.32, spin: Math.PI * 2.2,
                    rHP: 1.8, rHR: 1.15, rKB: 0.03, rFP: 0.9,
                    lHP: 0.9, lKB: 1.9,
                    spP: -0.45, spR: -0.65,
                    lSP: 0.2, lSR: 1.55, lEB: 0.2, rSP: 0.2, rSR: 1.55, rEB: 0.2,
                    fwd: 0.26, turn: 0.2
                }
            },
            { at: 'act', pose: { lift: 0.38, spin: Math.PI * 3.8, rHP: 1.85 } },
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
 * Foot offset along a gait cycle. Stance: foot moves back linearly (matches ground speed, no slide);
 * swing: foot travels forward on an arc. Running backwards (phase decreasing) reverses naturally.
 */
function gaitFoot(phase, stride, stanceFrac, liftH) {
    const u = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
    if (u < stanceFrac) return { z: stride * (0.5 - u / stanceFrac), y: 0, swing: 0 };
    const s = (u - stanceFrac) / (1 - stanceFrac);
    const e = s * s * (3 - 2 * s);
    return { z: stride * (-0.5 + e), y: liftH * Math.sin(Math.PI * s), swing: Math.sin(Math.PI * s) };
}

export const GAIT = {
    WALK: { perMeter: 5.4, stance: 0.56 },
    RUN: { perMeter: 3.1, stance: 0.30 }
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
        const stride = (Math.PI * 2 / g.perMeter) * g.stance;
        const L = gaitFoot(ph, stride, g.stance, 0.26);
        const R = gaitFoot(ph + Math.PI, stride, g.stance, 0.26);
        Object.assign(out, GUARD, {
            lFx: 0.08, rFx: 0.08, lFY: 0.05, rFY: 0.05,
            lFz: 0.08 + L.z - L.swing * 0.14, lFy: L.y, lFP: L.swing * 0.88,
            rFz: 0.08 + R.z - R.swing * 0.14, rFy: R.y, rFP: R.swing * 0.88,
            hipY: -0.09 - Math.abs(c) * 0.06, fwd: 0.12,
            hipT: -s * 0.32, hipR: s * 0.08, hipS: 0, spP: 0.62, spY: s * 0.48, spR: 0, hdP: -0.38, hdY: 0,
            lSP: s * 1.55 + 0.35, lSR: 0.24, lSY: 0.05, lEB: 1.35 + Math.max(0, s) * 0.55,
            rSP: -s * 1.55 + 0.35, rSR: 0.24, rSY: 0.05, rEB: 1.35 + Math.max(0, -s) * 0.55,
            turn: 0.1
        });
        out.gait = true;
        return out;
    }

    if (st === FIGHTER_STATE.WALK) {
        // Oni 2001 4-Directional Combat Footwork:
        // Natural alternating step stride where feet pass through center with heel-to-toe roll,
        // athletic hip weight transfer, and counter-rotating shoulders (no split-legged waddling).
        const ph = loco.phase;
        const s = Math.sin(ph), c = Math.cos(ph);
        const g = GAIT.WALK;
        const stride = (Math.PI * 2 / g.perMeter) * g.stance;
        const L = gaitFoot(ph, stride, g.stance, 0.16);
        const R = gaitFoot(ph + Math.PI, stride, g.stance, 0.16);

        const yaw = typeof f.facingAngle === 'number' ? f.facingAngle : (f.facing === -1 ? Math.PI : 0);
        const fx = Math.cos(yaw), fz = Math.sin(yaw);
        const rx = -fz, rz = fx;
        const spd = Math.hypot(f.vx || 0, f.vz || 0);
        const fwdFrac = spd > 0.05 ? ((f.vx * fx + f.vz * fz) / spd) : 1;
        const sideFrac = spd > 0.05 ? ((f.vx * rx + f.vz * rz) / spd) : 0;
        const absFwd = Math.abs(fwdFrac), absSide = Math.abs(sideFrac);

        Object.assign(out, GUARD);
        // When stepping forward/back, feet alternate cleanly around center (0.04m / -0.04m) instead of staying split
        const baseLz = GUARD.lFz * (1 - 0.82 * absFwd) + 0.04 * absFwd;
        const baseRz = GUARD.rFz * (1 - 0.82 * absFwd) - 0.04 * absFwd;
        out.lFz = baseLz + L.z * (0.35 + 0.65 * absFwd);
        out.rFz = baseRz + R.z * (0.35 + 0.65 * absFwd);

        // Narrow foot width slightly during forward stride for sleek athletic gait; widen on lateral sidestep
        const baseLx = 0.105 * absFwd + GUARD.lFx * (1 - absFwd);
        const baseRx = 0.115 * absFwd + GUARD.rFx * (1 - absFwd);
        out.lFx = Math.max(0.06, baseLx + L.z * 0.48 * sideFrac + Math.max(0, -sideFrac) * L.swing * 0.10);
        out.rFx = Math.max(0.06, baseRx - R.z * 0.48 * sideFrac + Math.max(0, sideFrac) * R.swing * 0.10);
        out.lFY = 0.08 * absFwd + GUARD.lFY * (1 - absFwd);
        out.rFY = 0.16 * absFwd + GUARD.rFY * (1 - absFwd);

        out.lFy = L.y * (0.90 + 0.20 * absSide);
        out.rFy = R.y * (0.90 + 0.20 * absSide);
        // Heel-lift on trailing push-off foot + mid-swing ankle flexion
        out.lFP = Math.max(0, -L.z * 1.15) + L.swing * 0.34 + (fwdFrac < -0.25 ? 0.16 : 0);
        out.rFP = Math.max(0, -R.z * 1.15) + R.swing * 0.34 + (fwdFrac < -0.25 ? 0.20 : 0.06);

        // Pelvis & torso: natural double-frequency vertical bob, counter-twist with legs, athletic forward lean
        const bob = Math.sin(ph * 2 - 0.4);
        out.hipY = -0.075 - 0.03 * (1 - absFwd) + bob * 0.028;
        out.fwd = 0.03 + fwdFrac * 0.075;
        out.hipS = -s * 0.038 * absFwd - sideFrac * 0.065;
        out.hipR = s * 0.065 * absFwd + sideFrac * 0.13;
        // Left leg forward (s < 0) -> pelvis twists right (+hipT) and chest counter-rotates left (-spY)
        out.hipT = GUARD.hipT * (1 - 0.65 * absFwd) - s * 0.26 * (0.35 + 0.65 * absFwd) - sideFrac * 0.16;
        out.spP = GUARD.spP + fwdFrac * 0.12 + bob * 0.025;
        out.spY = GUARD.spY * (1 - 0.65 * absFwd) + s * 0.34 * (0.4 + 0.6 * absFwd) + sideFrac * 0.15;
        out.spR = GUARD.spR * (1 - 0.5 * absFwd) - sideFrac * 0.16 - s * 0.05;
        out.hdP = GUARD.hdP - fwdFrac * 0.08;
        out.turn = 0.32 * absFwd + 0.85 * (1 - absFwd);

        // If retreating (auto-guarding while walking backward), raise high forearm guard while legs step back!
        if (f.isBlocking || fwdFrac < -0.25) {
            out.lSP = 1.24 + s * 0.16; out.lSR = 0.08; out.lSY = 0.28; out.lEB = 2.15;
            out.rSP = 1.08 - s * 0.16; out.rSR = 0.12; out.rSY = 0.34; out.rEB = 2.25;
        } else {
            // Natural counter-arm swing in combat ready posture (when left leg swings forward, right arm swings forward)
            out.lSP = 0.88 + s * 0.42;
            out.rSP = 0.68 - s * 0.42;
            out.lSR = 0.28;
            out.rSR = 0.32;
            out.lEB = 1.48 - s * 0.16;
            out.rEB = 1.72 + s * 0.16;
        }
        out.gait = true;
        return out;
    }

    // IDLE: rhythmic martial-arts footwork bounce + weight transfer + open guard breathing
    Object.assign(out, GUARD);
    const b = Math.sin(t * 5.6);
    const w = Math.sin(t * 1.6 + (f.id === 'p2' ? 1.7 : 0));
    const br = Math.sin(t * 2.4);
    out.hipY = GUARD.hipY + b * 0.036 - 0.012;
    out.hipS = w * 0.045;
    out.hipR = w * 0.06;
    out.hipT = GUARD.hipT + w * 0.09;
    out.spP = GUARD.spP + b * 0.045 + br * 0.035;
    out.spR = GUARD.spR - w * 0.07;
    out.spY = GUARD.spY + Math.sin(t * 1.1) * 0.11;
    out.hdY = GUARD.hdY - w * 0.07;
    out.lFP = Math.max(0, b) * 0.20;
    out.rFP = 0.22 + Math.max(0, b) * 0.22;
    out.lSP = GUARD.lSP + br * 0.10;
    out.rSP = GUARD.rSP - br * 0.09;
    out.lEB = GUARD.lEB + b * 0.11;
    out.rEB = GUARD.rEB - b * 0.10;
    return out;
}
