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
// bladed orthodox stance: lead foot forward and slightly in, rear foot turned out
const STANCE_FEET = {
    lFx: 0.1, lFz: 0.21, lFY: 0.2, rFx: 0.13, rFz: -0.23, rFY: 0.85, lIK: 1, rIK: 1
};

export const GUARD = makePose({
    ...STANCE_FEET,
    hipY: -0.085, hipT: 0.18, hipS: 0.0, fwd: -0.01, spP: 0.12, spY: -0.12, spR: 0.03, hdP: 0.1, hdY: 0.05,
    lSP: 0.95, lSR: 0.24, lSY: 0.12, lEB: 1.95, lWB: 0.15,
    rSP: 0.6, rSR: 0.3, rSY: 0.25, rEB: 2.3, rWB: 0.2,
    lHP: 0.38, lHR: 0.1, lKB: 0.4, rHP: -0.32, rHR: 0.1, rKB: 0.45,
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
    PUNCH_1: { // lead jab: small step-in, shoulder drives through, rear hand stays on the chin
        trail: 'lFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.1, spY: -0.02, lSP: 0.85, lEB: 2.2, fwd: -0.03 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lSP: 1.55, lSR: -0.02, lSY: 0.22, lEB: 0.04, lWB: 0.0,
                    spY: -0.6, spP: 0.22, spR: 0.06, hipT: -0.05, hdP: 0.14,
                    rSP: 0.8, rSY: 0.4, rEB: 2.45,
                    lFz: 0.33, rFz: -0.2, rFP: 0.25, hipY: -0.12, fwd: 0.12, hipS: 0.03, turn: 0.15
                }
            },
            { at: 'act', pose: { lSP: 1.6, spY: -0.66, fwd: 0.14 } },
            { at: 'rec:0.45', ease: 'inout', pose: { lSP: 1.1, lEB: 1.4, spY: -0.25, fwd: 0.05, lFz: 0.27, rFz: -0.22, rFP: 0.05 } }
        ]
    },
    PUNCH_2: { // rear cross: load the back leg, pivot the rear foot, hips then shoulders, lead hand back
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipT: -0.15, spY: -0.55, hipY: -0.12, fwd: -0.06, hipS: -0.02,
                    rSP: 0.45, rSR: 0.35, rEB: 2.45, lSP: 1.15, lEB: 1.3, lSY: 0.3, hdY: 0.15
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.6, spY: 1.0, spP: 0.3, spR: -0.1, hipY: -0.13, fwd: 0.2, hipS: 0.05,
                    rSP: 1.55, rSR: -0.05, rSY: 0.4, rEB: 0.02, rWB: 0.0,
                    lSP: 0.55, lSR: 0.5, lSY: 0.5, lEB: 2.5,
                    lFz: 0.31, rFz: -0.2, rFY: 0.15, rFP: 0.55, hdY: -0.35, hdP: 0.12, turn: 0.05
                }
            },
            { at: 'act', pose: { spY: 1.12, rSP: 1.6, fwd: 0.23 } },
            { at: 'rec:0.4', ease: 'inout', pose: { spY: 0.4, hipT: 0.35, rSP: 1.0, rEB: 1.4, fwd: 0.08, rFP: 0.25, rFY: 0.45 } }
        ]
    },
    UPPERCUT: { // rising dragon: deep coil, explode upward with a knee drive, lead arm counter-swings
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipY: -0.3, spP: 0.6, spY: -0.55, hipT: -0.1, hdP: 0.25, fwd: 0.02,
                    rSP: -0.45, rSR: 0.25, rEB: 1.4, lSP: 1.1, lEB: 2.2,
                    lFz: 0.26, rFz: -0.3, rFx: 0.16
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: 0.1, spP: -0.42, spY: 0.75, spR: -0.15, hipT: 0.45, hdP: -0.55, fwd: 0.12,
                    rSP: 2.85, rSR: 0.08, rSY: 0.3, rEB: 0.35, rWB: -0.2,
                    lSP: -0.5, lSR: 0.55, lEB: 0.9,
                    rIK: 0, rHP: 1.15, rKB: 1.7, rFP: 0.7, lFP: 0.9,
                    lift: 0.32, turn: 0.4
                }
            },
            { at: 'act', pose: { lift: 0.45, rSP: 3.0, spP: -0.5 } },
            { at: 'rec:0.45', ease: 'in', pose: { lift: 0.0, hipY: -0.2, spP: 0.25, rSP: 1.2, rEB: 1.6, rIK: 1, lFP: 0, rFP: 0, rHP: 0.2, rKB: 0.6 } }
        ]
    },
    KICK_LOW: { // rear-leg snap kick: knee chamber, weight over the lead foot, arms counterbalance
        trail: 'rFoot',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    rIK: 0, rHP: 1.35, rHR: 0.05, rKB: 2.2, rFP: 0.6,
                    hipS: 0.07, hipT: 0.3, hipY: -0.06, fwd: 0.06, spP: -0.08,
                    lSP: 0.95, lSR: 0.35, rSP: 0.4, rSR: 0.45, rEB: 1.9
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 1.2, rKB: 0.04, rFP: 0.95, hipT: 0.5, hipP: -0.12, spP: -0.42, spY: 0.3, hdP: 0.3,
                    lSP: 0.75, lSR: 0.85, lEB: 1.3, rSP: -0.25, rSR: 0.95, rEB: 0.9,
                    fwd: 0.1, lFY: 0.5, turn: 0.25
                }
            },
            { at: 'act', pose: { rHP: 1.28 } },
            { at: 'rec:0.4', ease: 'inout', pose: { rHP: 1.15, rKB: 1.9, spP: -0.1, hipT: 0.3, lSR: 0.4, rSR: 0.4, rSP: 0.4, rEB: 1.9 } },
            { at: 'rec:0.75', ease: 'in', pose: { rIK: 1, rFP: 0, hipS: 0.02, fwd: 0.02, lFY: 0.2 } }
        ]
    },
    KICK_HEAVY: { // 360 spinning roundhouse: spot over the shoulder, pivot on the ball of the lead foot
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            {
                at: 'wind', ease: 'inout', pose: {
                    spin: Math.PI * 0.95, hipY: -0.12, spP: 0.15, spY: -0.25, hdY: 0.9, hdP: 0.1,
                    lFx: 0.03, lFz: 0.02, lFP: 0.4, rFx: 0.14, rFz: -0.25, rFP: 0.5, hipS: 0.06,
                    lSP: 0.45, lSR: 1.0, lEB: 1.0, rSP: 0.4, rSR: 1.0, rEB: 1.0
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    spin: Math.PI * 2, rIK: 0, rHP: 1.65, rHR: 1.0, rKB: 0.05, rFP: 0.85,
                    spR: -0.75, spP: -0.4, hipR: -0.2, hdY: 0.2, hdP: 0.2,
                    lSP: 0.15, lSR: 1.55, lEB: 0.25, rSP: 0.1, rSR: 1.45, rEB: 0.25,
                    fwd: 0.12, turn: 0.2
                }
            },
            { at: 'act', pose: { spin: Math.PI * 2 + 0.3, rHR: 1.1 } },
            { at: 'rec:0.5', ease: 'inout', pose: { spin: Math.PI * 2, rHP: 0.6, rHR: 0.3, rKB: 1.4, spR: -0.2, spP: 0.0, lSR: 0.6, rSR: 0.6, lEB: 1.5, rEB: 1.5, lFP: 0.1 } },
            { at: 'rec:0.8', ease: 'in', pose: { rIK: 1, rFP: 0 } }
        ]
    },
    SLIDE_KICK: { // Oni signature slide sweep: drop, lean back, lead with the near leg
        trail: 'rFoot',
        keys: [
            {
                at: 'wind', ease: 'in', pose: {
                    hipY: -0.32, spP: 0.5, fwd: 0.1, lSP: -0.3, rSP: 1.0, rEB: 1.8,
                    rFz: -0.1, rFP: 0.6
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, hipY: -0.66, hipP: -0.85, spP: -0.25, hdP: 0.5, fwd: 0,
                    rHP: 0.85, rKB: 0.0, rFP: 0.9, lHP: 0.3, lKB: 1.85, lFP: 0.3,
                    lSP: -1.1, lSR: 0.45, lEB: 0.15, rSP: 1.1, rSR: 0.3, rEB: 1.7, turn: 0.6
                }
            },
            { at: 'act', pose: { hipY: -0.68, spP: -0.3 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipY: -0.45, hipP: -0.3, spP: 0.45, rHP: 0.9, rKB: 1.3, lHP: 1.3, lKB: 2.0, lSP: 0.2, lEB: 1.0 } },
            { at: 'rec:0.8', ease: 'out', pose: { lIK: 1, rIK: 1, hipY: -0.2, hipP: 0, spP: 0.25, rFP: 0, lFP: 0 } }
        ]
    },
    COMBO_PUNCH_KICK: { // P-P-K finisher: high crescent kick with torso lean back
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { rIK: 0, rHP: 1.45, rHR: 0.35, rKB: 2.1, hipT: 0.25, spP: -0.1, lSP: 1.0, rSP: 0.5 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 1.72, rHR: 0.75, rKB: 0.04, rFP: 0.85,
                    hipT: 0.65, spP: -0.45, spR: -0.5, hdP: 0.25,
                    lSP: 0.3, lSR: 1.35, lEB: 0.4, rSP: 0.2, rSR: 1.25, rEB: 0.4,
                    fwd: 0.14, turn: 0.2
                }
            },
            { at: 'act', pose: { rHP: 1.8, rHR: 0.9 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rHP: 0.85, rHR: 0.2, rKB: 1.6, spP: -0.05, spR: -0.1, lSR: 0.4, rSR: 0.4 } },
            { at: 'rec:0.8', ease: 'in', pose: { rIK: 1, rFP: 0, fwd: 0.02 } }
        ]
    },
    KICK_MID: { // K-K middle hit: chambered side thrust kick
        trail: 'lFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, lHP: 1.4, lHR: 0.45, lKB: 2.15, hipT: -0.25, hipS: -0.05, spR: 0.25 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lHP: 1.55, lHR: 0.85, lKB: 0.03, lFP: 0.75,
                    hipT: -0.55, spP: -0.28, spR: 0.55, hdP: 0.15,
                    lSP: 0.85, lSR: 0.9, lEB: 1.1, rSP: 0.7, rSR: 0.8, rEB: 1.6,
                    fwd: 0.12, turn: 0.25
                }
            },
            { at: 'act', pose: { lHP: 1.6 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lHP: 0.95, lHR: 0.2, lKB: 1.7, spR: 0.1, hipT: 0 } },
            { at: 'rec:0.8', ease: 'in', pose: { lIK: 1, lFP: 0 } }
        ]
    },
    RISING_FURY: { // Crouch+Jump+Kick: airborne 540 hurricane rising kick
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'in', pose: { hipY: -0.35, spP: 0.45, spin: Math.PI * 0.5, lSP: 0.5, rSP: 0.5 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.35, spin: Math.PI * 1.65,
                    rHP: 1.75, rHR: 0.95, rKB: 0.05, lHP: 0.85, lKB: 1.85,
                    spP: -0.35, spR: -0.55, lSP: 0.3, lSR: 1.45, lEB: 0.35, rSP: 0.3, rSR: 1.45, rEB: 0.35
                }
            },
            { at: 'act', pose: { lift: 0.52, spin: Math.PI * 2.1, rHP: 1.85 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0.1, spin: Math.PI * 2, rHP: 0.7, rKB: 1.4, lSR: 0.5, rSR: 0.5 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0 } }
        ]
    },
    DASH_PUNCH: { // Running lunging haymaker
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.16, spY: -0.75, spP: 0.25, rSP: -0.25, rSR: 0.65, rEB: 1.6, lSP: 1.3, fwd: -0.05 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.7, spY: 1.15, spP: 0.38, hipY: -0.15, fwd: 0.28,
                    rSP: 1.62, rSR: -0.05, rSY: 0.45, rEB: 0.02,
                    lSP: 0.3, lSR: 0.65, lEB: 2.3,
                    lFz: 0.36, rFz: -0.24, rFP: 0.65, turn: 0.05
                }
            },
            { at: 'act', pose: { fwd: 0.32, rSP: 1.68 } },
            { at: 'rec:0.45', ease: 'inout', pose: { fwd: 0.08, spY: 0.35, rSP: 0.95, rEB: 1.5, rFP: 0.2 } }
        ]
    },
    FLYING_KICK: { // Running airborne dropkick / flying side kick
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.18, rHP: 1.35, rKB: 1.9, lHP: 0.9, lKB: 1.7, spP: 0.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.38, hipP: -0.55, spP: -0.35, spR: -0.45,
                    rHP: 1.65, rHR: 0.55, rKB: 0.02, rFP: 0.85,
                    lHP: 0.95, lKB: 2.1,
                    lSP: 0.4, lSR: 1.25, lEB: 0.5, rSP: 0.2, rSR: 1.25, rEB: 0.5,
                    fwd: 0.22, turn: 0.3
                }
            },
            { at: 'act', pose: { lift: 0.42, rHP: 1.72, fwd: 0.26 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lift: 0.08, hipP: -0.1, spP: 0.2, rHP: 0.8, rKB: 1.5, fwd: 0.05 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0, rFP: 0 } }
        ]
    },
    BACK_SPIN_FIST: { // Back + Punch: spinning backfist
        trail: 'lFist',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'in', pose: { spin: -Math.PI * 0.85, hipY: -0.12, spY: 0.45, lSP: 0.7, lSR: 0.3, lEB: 1.9 } },
            {
                at: 'hit', ease: 'out', pose: {
                    spin: -Math.PI * 2, hipY: -0.1, spY: -0.85, spP: 0.18, fwd: 0.16,
                    lSP: 1.55, lSR: 0.95, lSY: -0.3, lEB: 0.08,
                    rSP: 0.7, rEB: 2.2, turn: 0.2
                }
            },
            { at: 'act', pose: { lSR: 1.1, fwd: 0.18 } },
            { at: 'rec:0.5', ease: 'inout', pose: { spin: -Math.PI * 2, spY: -0.25, lSP: 1.0, lSR: 0.35, lEB: 1.5, fwd: 0.04 } }
        ]
    },
    WILLOW_KICK: { // Back + Kick: overhead backward arc kick (倒挂金钩)
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.24, spP: 0.55, hdP: 0.35, lSP: 0.2, rSP: 0.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rIK: 0, hipY: -0.15, hipP: 0.65, spP: 0.85, hdP: 0.45,
                    rHP: 2.15, rHR: 0.25, rKB: 0.05, rFP: 0.9,
                    lSP: -0.6, lSR: 0.85, lEB: 0.3, rSP: -0.6, rSR: 0.85, rEB: 0.3,
                    fwd: 0.08, turn: 0.3
                }
            },
            { at: 'act', pose: { rHP: 2.25, hipP: 0.75 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipP: 0.2, spP: 0.3, rHP: 0.9, rKB: 1.5, lSP: 0.6, rSP: 0.6 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0 } }
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
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.28, hipP: -0.35, rHP: 1.45, rKB: 1.8, lHP: 0.9, lKB: 1.6, rSP: 1.3, lSP: 0.8 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.48, hipP: -0.65, spP: -0.25,
                    rHP: 1.8, rHR: 0.45, rKB: 0.04, rFP: 0.85,
                    lHP: 1.05, lKB: 2.0,
                    rSP: 1.75, rEB: 0.2, lSP: -0.4, lSR: 0.95, lEB: 0.5,
                    fwd: 0.24, turn: 0.25
                }
            },
            { at: 'act', pose: { lift: 0.45, rHP: 1.85, rSP: 1.8 } },
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
    WALK: { perMeter: 9.5, stance: 0.6 },
    RUN: { perMeter: 4.2, stance: 0.36 }
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

    if (st === FIGHTER_STATE.BLOCK || f.isBlocking) {
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
        const L = gaitFoot(ph, stride, g.stance, 0.16);
        const R = gaitFoot(ph + Math.PI, stride, g.stance, 0.16);
        Object.assign(out, GUARD, {
            lFx: 0.07, rFx: 0.07, lFY: 0.05, rFY: 0.05,
            lFz: 0.05 + L.z - L.swing * 0.12, lFy: L.y, lFP: L.swing * 0.7,
            rFz: 0.05 + R.z - R.swing * 0.12, rFy: R.y, rFP: R.swing * 0.7,
            hipY: -0.06 - Math.abs(c) * 0.035, fwd: 0.06,
            hipT: -s * 0.18, hipR: s * 0.05, hipS: 0, spP: 0.48, spY: s * 0.32, spR: 0, hdP: -0.3, hdY: 0,
            lSP: s * 1.2 + 0.3, lSR: 0.15, lSY: 0.1, lEB: 1.55 + Math.max(0, s) * 0.4,
            rSP: -s * 1.2 + 0.3, rSR: 0.15, rSY: 0.1, rEB: 1.55 + Math.max(0, -s) * 0.4,
            turn: 0.15
        });
        out.gait = true;
        return out;
    }

    if (st === FIGHTER_STATE.WALK) {
        // fighting-stance shuffle: feet keep their bladed spacing and never cross
        const ph = loco.phase;
        const s = Math.sin(ph);
        const g = GAIT.WALK;
        const stride = (Math.PI * 2 / g.perMeter) * g.stance;
        const L = gaitFoot(ph, stride, g.stance, 0.07);
        const R = gaitFoot(ph + Math.PI, stride, g.stance, 0.07);
        Object.assign(out, GUARD);
        out.lFz += L.z; out.lFy = L.y; out.lFP = L.swing * 0.25;
        out.rFz += R.z; out.rFy = R.y; out.rFP = R.swing * 0.25;
        out.hipY = GUARD.hipY - 0.015 - Math.abs(Math.cos(ph)) * 0.02;
        out.hipS = (L.swing - R.swing) * -0.02;
        out.hipR = (L.swing - R.swing) * 0.04;
        out.hipT = GUARD.hipT + s * 0.06;
        out.spY = GUARD.spY - s * 0.1;
        out.spP = GUARD.spP + 0.04;
        out.lSP = GUARD.lSP - s * 0.1;
        out.rSP = GUARD.rSP + s * 0.1;
        out.gait = true;
        return out;
    }

    // IDLE: bounce on the balls of the feet + weight shift + breathing (non-repeating mix)
    Object.assign(out, GUARD);
    const b = Math.sin(t * 5.2);
    const w = Math.sin(t * 1.3 + (f.id === 'p2' ? 1.7 : 0));
    const br = Math.sin(t * 2.1);
    out.hipY = GUARD.hipY + b * 0.022 - 0.01;
    out.hipS = w * 0.025;
    out.hipR = w * 0.04;
    out.hipT = GUARD.hipT + w * 0.05;
    out.spP = GUARD.spP + b * 0.03 + br * 0.025;
    out.spR = GUARD.spR - w * 0.05;
    out.spY = GUARD.spY + Math.sin(t * 0.9) * 0.07;
    out.hdY = GUARD.hdY - w * 0.05;
    out.lFP = Math.max(0, b) * 0.12;
    out.rFP = 0.15 + Math.max(0, b) * 0.15;
    out.lSP = GUARD.lSP + br * 0.06;
    out.rSP = GUARD.rSP - br * 0.05;
    out.lEB = GUARD.lEB + b * 0.07;
    out.rEB = GUARD.rEB - b * 0.06;
    return out;
}
