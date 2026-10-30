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
 *   lAW rAW     arm aim weight: 0 = FK angles, 1 = arm solved (two-bone IK) to reach the strike point
 *   aY aZ       strike point on the body's centre line: height above the floor / distance in front (m)
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
    'lift', 'spin', 'turn',
    'lAW', 'rAW', 'aY', 'aZ'
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
            { at: 'wind', ease: 'out', pose: { hipY: -0.13, spY: -0.10, lSP: 0.95, lSR: 0.30, lEB: 2.10, fwd: -0.03 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lSP: 1.55, lSR: 0.0, lSY: 0.0, lEB: 0.0, lWB: -0.06, lAW: 1, aY: 1.40, aZ: 1.05,
                    spY: -0.45, spP: 0.16, spR: 0.06, hipT: -0.10, hdP: 0.08,
                    rSP: -0.28, rSR: 0.60, rSY: 0.14, rEB: 1.85,
                    lFz: 0.46, rFz: -0.28, rFP: 0.50, hipY: -0.15, fwd: 0.30, hipS: 0.05, turn: 0.05
                }
            },
            { at: 'act', pose: { spY: -0.48, fwd: 0.32 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lAW: 0, lSP: 1.18, lEB: 1.25, spY: -0.25, fwd: 0.08, lFz: 0.32, rFz: -0.28, rFP: 0.12 } }
        ]
    },
    PUNCH_2: { // rear cross: massive hip pivot, shoulder whip, rear heel drive, lead arm retracted
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipT: 0.05, spY: -0.40, hipY: -0.14, fwd: -0.04, hipS: -0.03,
                    rSP: 0.75, rSR: 0.40, rEB: 2.30, lSP: 1.20, lEB: 1.30, lSY: 0.1, hdY: 0.12
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.42, spY: 0.38, spP: 0.22, spR: -0.08, hipY: -0.16, fwd: 0.32, hipS: 0.06,
                    rSP: 1.55, rSR: 0.0, rSY: 0.0, rEB: 0.0, rWB: -0.05, rAW: 1, aY: 1.40, aZ: 1.10,
                    lSP: 1.05, lSR: 0.40, lSY: 0.30, lEB: 2.05,
                    lFz: 0.40, rFz: -0.26, rFY: 0.15, rFP: 0.75, hdY: -0.20, hdP: 0.08, turn: 0.0
                }
            },
            { at: 'act', pose: { spY: 0.42, fwd: 0.35 } },
            { at: 'rec:0.45', ease: 'inout', pose: { rAW: 0, spY: 0.05, hipT: 0.25, rSP: 1.05, rEB: 1.60, fwd: 0.10, rFP: 0.25, rFY: 0.45 } }
        ]
    },
    PUNCH_3: { // triple punch finish: driving forward heavy cross with step lunge
        trail: 'lFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.16, spY: 0.15, lSP: 1.10, lSR: 0.25, lEB: 2.15, fwd: -0.02 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lSP: 1.62, lSR: 0.0, lSY: 0.0, lEB: 0.0, lWB: -0.05, lAW: 1, aY: 1.42, aZ: 1.12,
                    spY: -0.52, spP: 0.20, spR: 0.08, hipT: -0.18, hdP: 0.10,
                    rSP: -0.15, rSR: 0.50, rSY: 0.15, rEB: 1.95,
                    lFz: 0.52, rFz: -0.32, rFP: 0.65, hipY: -0.18, fwd: 0.38, hipS: 0.06, turn: 0.06
                }
            },
            { at: 'act', pose: { spY: -0.55, fwd: 0.40 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lAW: 0, lSP: 1.15, lEB: 1.30, spY: -0.20, fwd: 0.12, lFz: 0.35, rFz: -0.30, rFP: 0.15 } }
        ]
    },
    SLEDGEHAMMER: { // signature sledgehammer knockout punch: deep coil, massive overhand slam
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipT: -0.25, spY: -0.45, spP: 0.15, hipY: -0.18, fwd: -0.06,
                    rSP: 1.85, rSR: 0.35, rEB: 2.20, lSP: 0.95, lEB: 1.60, hdP: 0.15
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.48, spY: 0.45, spP: 0.28, spR: -0.12, hipY: -0.20, fwd: 0.45,
                    rSP: 1.60, rSR: 0.05, rSY: -0.05, rEB: 0.15, rWB: -0.10, rAW: 1, aY: 1.35, aZ: 1.15,
                    lSP: 0.85, lSR: 0.45, lSY: 0.25, lEB: 2.10,
                    lFz: 0.45, rFz: -0.30, rFY: 0.20, rFP: 0.85, hdY: -0.25, hdP: 0.12
                }
            },
            { at: 'act', pose: { spY: 0.48, fwd: 0.48 } },
            { at: 'rec:0.45', ease: 'inout', pose: { rAW: 0, spY: 0.10, hipT: 0.20, rSP: 1.10, rEB: 1.50, fwd: 0.15 } }
        ]
    },
    UPPERCUT: { // rising dragon uppercut: balanced crouch coil -> explosive upward jaw strike, defensive guard, firm footing
        trail: 'rFist',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    hipY: -0.22, hipT: -0.22, spP: 0.20, spY: -0.32, spR: 0.05, hdP: 0.18, fwd: 0.02,
                    rSP: 0.20, rSR: 0.22, rSY: -0.15, rEB: 1.85, rWB: 0.20, rAW: 0,
                    lSP: 1.08, lSR: 0.36, lEB: 1.80, lWB: 0.10, lAW: 0,
                    lIK: 1, rIK: 1, lHP: 0.38, lKB: 0.72, rHP: 0.28, rKB: 0.55,
                    lFz: 0.26, rFz: -0.28, rFP: 0.35, lFP: 0.0
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: 0.08, lift: 0.22, hipT: 0.24, spP: -0.06, spY: 0.22, spR: -0.08, hdP: -0.12, fwd: 0.18,
                    // Right arm uppercut: 90° bent elbow driving skyward into opponent's jaw! No straight-arm IK distortion!
                    rSP: 1.95, rSR: 0.16, rSY: -0.10, rEB: 1.55, rWB: 0.25, rAW: 0,
                    // Left arm guard protecting chin
                    lSP: 0.95, lSR: 0.38, lEB: 1.75, lWB: 0.10, lAW: 0,
                    // Balanced legs with grounded drive and heel elevation
                    lIK: 1, rIK: 1, lHP: -0.05, lKB: 0.18, rHP: 0.20, rKB: 0.40,
                    lFz: 0.28, rFz: -0.24, rFP: 0.65, lFP: 0.0, turn: 0.10
                }
            },
            {
                at: 'act', pose: {
                    lift: 0.26, hipY: 0.10, rSP: 2.05, rEB: 1.50, spY: 0.25
                }
            },
            {
                at: 'rec:0.5', ease: 'inout', pose: {
                    lift: 0.08, hipY: -0.06, spP: 0.08, spY: 0.10,
                    rSP: 1.25, rSR: 0.35, rEB: 1.65, rWB: 0,
                    lSP: 1.0, lSR: 0.40, lEB: 1.70,
                    rFP: 0.2, lIK: 1, rIK: 1
                }
            },
            {
                at: 'rec:0.85', ease: 'out', pose: {
                    lift: 0.0, hipY: 0.0, spP: 0.0, spY: 0.0, spR: 0.0,
                    rSP: 0.95, rSR: 0.45, rEB: 1.70,
                    lSP: 0.95, lSR: 0.45, lEB: 1.70,
                    rFP: 0.0, lFP: 0.0, lIK: 1, rIK: 1
                }
            }
        ]
    },
    KICK_LOW: { // wide snapping roundhouse kick: high chamber, hip turnover, locked out whip, torso counter-balance
        trail: 'rFoot',
        keys: [
            {
                at: 'wind', ease: 'out', pose: {
                    rIK: 0, rHP: 1.40, rHR: 0.50, rKB: 2.20, rFP: 0.7,
                    hipS: 0.08, hipT: 0.40, hipY: -0.09, fwd: 0.06, spP: -0.05,
                    lSP: 1.10, lSR: 0.45, lEB: 1.8, rSP: 0.2, rSR: 0.6, rEB: 1.6
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 1.30, rHR: 0.70, rKB: 0.10, rFP: 1.0,
                    hipT: 0.75, hipP: -0.12, spP: -0.22, spY: 0.30, spR: -0.22, hdP: 0.20,
                    lSP: 1.05, lSR: 0.55, lEB: 1.7, rSP: -0.35, rSR: 0.70, rEB: 1.0,
                    fwd: 0.24, lFY: 0.68, lFP: 0.35, turn: 0.15
                }
            },
            { at: 'act', pose: { rHP: 1.34, rHR: 0.74, fwd: 0.28 } },
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
                    spR: -0.55, spP: -0.30, hipR: -0.25, hipP: -0.15, hdY: 0.25, hdP: 0.20,
                    lSP: 0.4, lSR: 1.1, lEB: 0.9, rSP: -0.1, rSR: 1.0, rEB: 0.7,
                    fwd: 0.28, lift: 0.16, lFP: 0.55, turn: 0.15
                }
            },
            { at: 'act', pose: { spin: Math.PI * 2 + 0.38, rHP: 2.10, rHR: 1.38, fwd: 0.32 } },
            { at: 'rec:0.55', ease: 'inout', pose: { spin: Math.PI * 2, lift: 0, rHP: 0.7, rHR: 0.3, rKB: 1.4, spR: -0.2, spP: 0.0, lSR: 0.6, rSR: 0.6, lEB: 1.4, rEB: 1.4, lFP: 0.1 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0 } }
        ]
    },
    SLIDE_KICK: { // Oni signature tactical baseball slide sweep: ground drop, horizontal extension, kicking leg flat
        trail: 'rFoot',
        keys: [
            {
                at: 'wind', ease: 'in', pose: {
                    hipY: -0.35, spP: 0.45, fwd: 0.14, lSP: -0.35, rSP: 1.10, rEB: 1.5,
                    rFz: -0.12, rFP: 0.65
                }
            },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, hipY: -0.52, hipP: -0.45, spP: -0.20, hdP: 0.35, fwd: 0.32,
                    rHP: 1.20, rHR: 0.18, rKB: 0.05, rFP: 0.95, lHP: 0.45, lHR: 0.40, lKB: 2.05, lFP: 0.35,
                    lSP: -0.85, lSR: 0.55, lEB: 0.25, rSP: 0.95, rSR: 0.45, rEB: 1.35, turn: 0.25
                }
            },
            { at: 'act', pose: { hipY: -0.54, spP: -0.22, fwd: 0.36, rHP: 1.24 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipY: -0.38, hipP: -0.20, spP: 0.35, rHP: 0.85, rKB: 1.25, lHP: 1.15, lKB: 1.8, lSP: 0.3, lEB: 1.0, fwd: 0.10 } },
            { at: 'rec:0.85', ease: 'out', pose: { lIK: 1, rIK: 1, hipY: -0.14, hipP: 0, spP: 0.15, rFP: 0, lFP: 0, fwd: 0.02 } }
        ]
    },
    COMBO_PUNCH_KICK: { // P-P-K finisher: high crescent kick with balanced torso posture
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { rIK: 0, rHP: 1.45, rHR: 0.45, rKB: 2.10, hipT: 0.32, spP: -0.12, lSP: 1.15, rSP: -0.25 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 1.75, rHR: 0.65, rKB: 0.05, rFP: 0.95,
                    hipT: 0.55, hipP: -0.10, spP: -0.18, spR: -0.22, hdP: 0.18,
                    lSP: 0.75, lSR: 0.65, lEB: 1.2, rSP: -0.15, rSR: 0.65, rEB: 0.9,
                    fwd: 0.24, lift: 0.08, lFP: 0.35, turn: 0.12
                }
            },
            { at: 'act', pose: { rHP: 1.80, rHR: 0.72, fwd: 0.28 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lift: 0, rHP: 0.80, rHR: 0.18, rKB: 1.5, spP: -0.05, spR: -0.08, lSR: 0.45, rSR: 0.45 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0, fwd: 0.02 } }
        ]
    },
    KICK_MID: { // K-K middle hit: deep chambered Bruce Lee style side thrust kick
        trail: 'lFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, lHP: 1.68, lHR: 0.68, lKB: 2.35, hipT: -0.45, hipS: -0.08, spR: 0.40 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lHP: 1.55, lHR: 0.95, lKB: 0.0, lFP: 0.95,
                    hipT: -0.70, hipP: -0.12, spP: -0.22, spR: 0.40, hdP: 0.15,
                    lSP: 0.90, lSR: 0.60, lEB: 1.5, rSP: 0.70, rSR: 0.45, rEB: 1.9,
                    fwd: 0.28, rFP: 0.35, turn: 0.15
                }
            },
            { at: 'act', pose: { lHP: 1.58, lHR: 0.98, fwd: 0.30 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lHP: 0.95, lHR: 0.2, lKB: 1.7, spR: 0.1, hipT: 0 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, lFP: 0, rFP: 0 } }
        ]
    },
    RISING_FURY: { // Crouch+Jump+Kick: balanced airborne hurricane rising split kick
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'in', pose: { hipY: -0.28, spP: 0.35, spin: Math.PI * 0.35, lSP: 0.5, rSP: 0.5, lSR: 0.65, rSR: 0.65 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.38, spin: Math.PI * 1.15,
                    rHP: 1.65, rHR: 0.85, rKB: 0.05, lHP: 0.85, lHR: 0.35, lKB: 1.85,
                    spP: -0.15, spR: -0.25, lSP: 0.45, lSR: 0.75, lEB: 1.1, rSP: 0.45, rSR: 0.75, rEB: 1.1,
                    fwd: 0.18
                }
            },
            { at: 'act', pose: { lift: 0.45, spin: Math.PI * 1.45, rHP: 1.70 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0.08, spin: Math.PI * 1.5, rHP: 0.65, rKB: 1.3, lSR: 0.45, rSR: 0.45 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0 } }
        ]
    },
    DASH_PUNCH: { // Running lunging full-body haymaker
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.20, spY: -0.50, spP: 0.30, rSP: 0.30, rSR: 0.55, rEB: 2.0, lSP: 1.30, lEB: 1.0, fwd: -0.04 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.50, spY: 0.45, spP: 0.32, spR: -0.10, hipY: -0.18, fwd: 0.42,
                    rSP: 1.55, rSR: 0.0, rSY: 0.0, rEB: 0.0, rAW: 1, aY: 1.32, aZ: 1.15,
                    lSP: 0.30, lSR: 0.70, lEB: 1.6,
                    lFz: 0.50, rFz: -0.32, rFP: 0.88, turn: 0.0
                }
            },
            { at: 'act', pose: { fwd: 0.46, spY: 0.48 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rAW: 0, fwd: 0.10, spY: 0.10, rSP: 0.95, rEB: 1.5, rFP: 0.2 } }
        ]
    },
    FLYING_KICK: { // Running airborne dropkick / flying side kick — crisp thrust, balanced guard and torso
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.22, rHP: 1.35, rKB: 1.85, lHP: 0.9, lKB: 1.65, spP: 0.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.38, hipP: -0.35, spP: -0.22, spR: -0.25,
                    rHP: 1.60, rHR: 0.45, rKB: 0.05, rFP: 0.95,
                    lHP: 0.95, lHR: 0.30, lKB: 2.10,
                    lSP: 0.85, lSR: 0.55, lEB: 1.4, rSP: -0.20, rSR: 0.65, rEB: 0.6,
                    fwd: 0.32, turn: 0.15
                }
            },
            { at: 'act', pose: { lift: 0.40, rHP: 1.64, fwd: 0.36 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lift: 0.08, hipP: -0.05, spP: 0.15, rHP: 0.75, rKB: 1.3, fwd: 0.08 } },
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
                    spin: -Math.PI * 2, hipY: -0.12, spY: -0.60, spP: 0.18, fwd: 0.30,
                    lSP: 1.55, lSR: 1.10, lSY: -0.35, lEB: 0.1,
                    rSP: -0.45, rSR: 0.85, rEB: 1.6, turn: 0.15
                }
            },
            { at: 'act', pose: { lSR: 1.50, fwd: 0.34 } },
            { at: 'rec:0.5', ease: 'inout', pose: { spin: -Math.PI * 2, spY: -0.25, lSP: 1.0, lSR: 0.35, lEB: 1.5, fwd: 0.04 } }
        ]
    },
    WILLOW_KICK: { // Back + Kick: balanced backward scorpion/arc kick (倒挂金钩)
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.22, spP: 0.45, hdP: 0.30, lSP: 0.2, rSP: 0.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rIK: 0, hipY: -0.12, hipP: 0.45, spP: 0.55, hdP: 0.35,
                    rHP: 1.75, rHR: 0.25, rKB: 0.05, rFP: 0.95,
                    lSP: -0.45, lSR: 0.65, lEB: 0.3, rSP: -0.45, rSR: 0.65, rEB: 0.3,
                    fwd: 0.16, lFP: 0.35, turn: 0.15
                }
            },
            { at: 'act', pose: { rHP: 1.80, hipP: 0.50 } },
            { at: 'rec:0.5', ease: 'inout', pose: { hipP: 0.15, spP: 0.2, rHP: 0.85, rKB: 1.3, lSP: 0.5, rSP: 0.5 } },
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
    // ---------------------------------------------------------------- Oni move-list completion
    CRESCENT_MOON_KICK: { // K,K,fwd+K: outside-in crescent arc over the head, finishing high
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { rIK: 0, rHP: 0.9, rHR: 0.9, rKB: 0.6, hipT: -0.25, spP: -0.05, lSP: 1.0, lSR: 0.6, rSR: 0.7 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 2.15, rHR: 0.25, rKB: 0.05, rFP: 0.9, hipT: 0.5, hipP: -0.18, spP: -0.25, spR: -0.2,
                    lSP: 0.6, lSR: 0.95, lEB: 0.6, rSP: -0.2, rSR: 0.9, rEB: 0.5, fwd: 0.18, lFP: 0.4, lift: 0.04, turn: 0.15
                }
            },
            { at: 'act', pose: { rHP: 1.7, rHR: -0.35, hipT: 0.7 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rHP: 0.6, rHR: 0, rKB: 1.4, spP: 0, spR: 0, lift: 0 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0 } }
        ]
    },
    SIDE_PUNCH: { // sidestep backhand: step out to the side, whip the lead fist across
        trail: 'lFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipS: -0.12, spY: 0.25, lSP: 1.0, lSR: 0.1, lSY: 0.6, lEB: 1.9, hipY: -0.16 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipS: 0.14, spY: -0.55, spR: 0.12, lSP: 1.5, lSR: 0.55, lSY: -0.3, lEB: 0.2, lWB: 0.3,
                    lAW: 0.6, aY: 1.35, aZ: 0.95, rSP: 0.8, rEB: 2.1, lFx: 0.3, fwd: 0.12, turn: 0.1
                }
            },
            { at: 'act', pose: { spY: -0.6 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lAW: 0, lSP: 1.1, lSR: 0.35, lSY: 0.05, lEB: 1.5, hipS: 0.04, spY: -0.2, lFx: 0.18 } }
        ]
    },
    KICK_FW: { // forward push kick: knee up, drive the sole straight into the midsection
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { rIK: 0, rHP: 1.75, rHR: 0.05, rKB: 2.3, hipP: -0.1, spP: -0.05, lSP: 1.2, rSP: 0.5 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rHP: 1.55, rKB: 0.0, rFP: -0.4, hipP: -0.28, spP: -0.3, hdP: 0.25, fwd: 0.3,
                    lSP: 0.9, lSR: 0.5, lEB: 1.6, rSP: 0.2, rSR: 0.5, rEB: 1.5, lFP: 0.3, turn: 0.6
                }
            },
            { at: 'act', pose: { fwd: 0.34 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rHP: 1.0, rKB: 1.8, hipP: 0, spP: 0.1, fwd: 0.12 } },
            { at: 'rec:0.85', ease: 'in', pose: { rIK: 1, rFP: 0, lFP: 0 } }
        ]
    },
    BACK_KICK: { // back+K: turn away and fire a straight back kick (mule) toward the target
        trail: 'rFoot',
        keepSpin: false,
        keys: [
            { at: 'wind', ease: 'out', pose: { spin: Math.PI * 0.85, rIK: 0, rHP: 1.3, rKB: 2.2, spP: 0.45, hdY: 0.9, lSP: 1.0, rSP: 0.8 } },
            {
                at: 'hit', ease: 'out', pose: {
                    spin: Math.PI, rHP: -1.15, rHR: 0.05, rKB: 0.05, rFP: -0.5, spP: 0.7, hdY: 1.1, hdP: -0.2,
                    lSP: 0.7, lSR: 0.6, rSP: 0.9, rSR: 0.5, lFP: 0.2, fwd: -0.2, turn: 0.4
                }
            },
            { at: 'act', pose: { rHP: -1.2 } },
            { at: 'rec:0.55', ease: 'inout', pose: { spin: Math.PI * 0.4, rHP: 0.2, rKB: 1.3, spP: 0.2, hdY: 0.3 } },
            { at: 'rec:0.9', ease: 'in', pose: { spin: 0, rIK: 1, rFP: 0, lFP: 0, hdY: 0.08 } }
        ]
    },
    TWISTER_KICK: { // side, fwd+K: leaping 360 tornado kick
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'in', pose: { hipY: -0.24, spin: Math.PI * 0.5, spP: 0.3, lSP: 0.6, rSP: 0.6, lSR: 0.8, rSR: 0.8 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.42, spin: Math.PI * 1.6, rHP: 1.6, rHR: 0.9, rKB: 0.05, lHP: 0.9, lKB: 1.9,
                    spP: -0.12, spR: -0.3, lSP: 0.4, lSR: 1.0, rSP: 0.4, rSR: 1.0, fwd: 0.2
                }
            },
            { at: 'act', pose: { lift: 0.45, spin: Math.PI * 1.9 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0.06, spin: Math.PI * 2, rHP: 0.6, rKB: 1.3 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0 } }
        ]
    },
    CROUCH_PUNCH: { // low jab from the crouch
        trail: 'lFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { ...{ hipY: -0.44, hipP: 0.15, spP: 0.38 }, lSP: 0.9, lEB: 2.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: -0.42, spP: 0.32, spY: -0.4, lSP: 1.45, lSR: 0.05, lEB: 0.05, lAW: 1, aY: 0.8, aZ: 0.95,
                    rSP: 0.7, rEB: 2.2, lFz: 0.34, rFz: -0.28, lHP: 1.0, lKB: 1.7, rHP: 0.2, rKB: 1.9, fwd: 0.16, turn: 0.3
                }
            },
            { at: 'rec:0.5', ease: 'inout', pose: { lAW: 0, lSP: 1.0, lEB: 2.0, spY: -0.15, fwd: 0.04 } }
        ]
    },
    CROUCH_SWEEP: { // low spinning leg sweep, hands on the floor
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.6, spP: 0.75, lSP: 1.6, rSP: 1.6, lEB: 0.4, rEB: 0.4, spin: Math.PI * 0.4, rIK: 0, rHP: 0.4, rHR: 1.2, rKB: 0.1 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: -0.7, spP: 0.85, spin: Math.PI * 1.25, rHP: 0.15, rHR: 1.45, rKB: 0.0, rFP: 0.6,
                    lHP: 1.6, lKB: 2.4, lSP: 1.8, rSP: 1.8, lEB: 0.3, rEB: 0.3, turn: 0.5
                }
            },
            { at: 'act', pose: { spin: Math.PI * 1.65 } },
            { at: 'rec:0.6', ease: 'inout', pose: { spin: Math.PI * 2, hipY: -0.4, spP: 0.4, rHR: 0.3, rKB: 1.2 } },
            { at: 'rec:0.9', ease: 'in', pose: { rIK: 1, rFP: 0 } }
        ]
    },
    RISING_FURY_PUNCH: { // release crouch + P: explode upward with a leaping rising punch
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.42, spP: 0.45, rSP: 0.1, rEB: 2.1, rSR: 0.25, lSP: 1.1, lEB: 1.8, hdP: 0.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, hipY: 0.05, lift: 0.5, spP: -0.3, spY: 0.4, hdP: -0.4,
                    rSP: 2.95, rSR: 0.1, rEB: 0.05, rWB: 0.1, lSP: 0.5, lSR: 0.6, lEB: 1.9,
                    lHP: 1.4, lKB: 2.0, rHP: 0.1, rKB: 0.4, rFP: 0.8, turn: 0.4
                }
            },
            { at: 'act', pose: { lift: 0.62 } },
            { at: 'rec:0.5', ease: 'inout', pose: { lift: 0.12, rSP: 1.3, rEB: 1.4, spP: 0.1, hdP: 0.1, lHP: 0.6, lKB: 0.9 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, lift: 0, rFP: 0 } }
        ]
    },
    RUNNING_LARIAT: { // running clothesline: arm out straight at neck height
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { rSP: 1.0, rSR: 1.3, rEB: 0.4, spY: -0.35, spP: 0.2, fwd: 0.1 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rSP: 1.5, rSR: 1.45, rSY: -0.2, rEB: 0.05, spY: 0.45, spP: 0.15, hipT: 0.4, fwd: 0.4,
                    lSP: 0.6, lSR: 0.4, lEB: 1.6, lFz: 0.45, rFz: -0.3, rFP: 0.7, turn: 0.2
                }
            },
            { at: 'act', pose: { spY: 0.7, hipT: 0.6 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rSR: 0.5, rSP: 1.0, rEB: 1.4, spY: 0.1, hipT: 0.2, fwd: 0.1 } }
        ]
    },
    JUMP_PUNCH: { // airborne downward hammer punch
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lHP: 1.0, lKB: 1.6, rHP: 0.5, rKB: 1.3, rSP: 2.6, rSR: 0.3, rEB: 1.6, spP: -0.2 } },
            {
                at: 'hit', ease: 'out', pose: {
                    rSP: 1.0, rSR: 0.1, rEB: 0.1, rAW: 0.8, aY: 1.0, aZ: 0.95, spP: 0.5, hdP: 0.35,
                    lSP: 0.7, lSR: 0.6, lEB: 1.4, lHP: 1.2, lKB: 1.9, rHP: 0.8, rKB: 1.6, turn: 0.4
                }
            },
            { at: 'rec:0.5', ease: 'inout', pose: { rAW: 0, rSP: 0.8, rEB: 1.5, spP: 0.2 } },
            { at: 'rec:0.95', ease: 'in', pose: { lIK: 1, rIK: 1 } }
        ]
    },
    JUMP_FLIP: { // jump + crouch: tucked somersault in the air
        trail: null,
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lHP: 1.6, lKB: 2.3, rHP: 1.6, rKB: 2.3, spP: 0.5, lSP: 1.3, rSP: 1.3, lEB: 1.8, rEB: 1.8, turn: 0.3 } },
            { at: 'rec:0.15', ease: 'linear', pose: { hipP: -Math.PI * 0.7 } },
            { at: 'rec:0.55', ease: 'linear', pose: { hipP: -Math.PI * 1.5 } },
            { at: 'rec:0.85', ease: 'out', pose: { hipP: -Math.PI * 2, lHP: 0.6, lKB: 0.9, rHP: 0.4, rKB: 0.8, spP: 0.2 } },
            { at: 'rec:0.97', ease: 'in', pose: { lIK: 1, rIK: 1 } }
        ]
    },
    GETUP_KICK: { // from the floor: sit up and sweep a kick out, then spring up
        trail: 'rFoot',
        from: 'SIT_UP',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.66, hipP: -0.55, spP: 0.2, lSP: -0.6, rSP: -0.6, lSR: 0.3, rSR: 0.3, lEB: 0.2, rEB: 0.2, rHP: 1.1, rKB: 1.6, lHP: 0.5, lKB: 1.8 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipY: -0.6, hipP: -0.65, rHP: 1.45, rHR: 0.7, rKB: 0.0, rFP: 0.8, spin: Math.PI * 0.35,
                    lSP: -0.7, rSP: -0.5, turn: 0.4
                }
            },
            { at: 'act', pose: { spin: Math.PI * 0.55 } },
            { at: 'rec:0.6', ease: 'inout', pose: { hipY: -0.3, hipP: -0.1, spin: 0, spP: 0.35, rHP: 0.6, rKB: 1.2, lSP: 0.9, rSP: 0.8, lEB: 1.6, rEB: 1.8 } },
            { at: 'rec:0.9', ease: 'in', pose: { lIK: 1, rIK: 1, rFP: 0 } }
        ]
    },
    THROW_FRONT_K: { // hop, wrap the legs around the neck and flip the opponent over
        trail: 'rFoot',
        keys: [
            { at: 'wind', ease: 'out', pose: { lIK: 0, rIK: 0, lift: 0.35, lHP: 1.7, rHP: 1.7, lKB: 1.2, rKB: 1.2, lSP: 1.3, rSP: 1.3, spP: 0.2 } },
            { at: 'hit', ease: 'inout', pose: { lift: 0.55, hipP: -0.9, spP: -0.4, lHP: 1.9, rHP: 1.9, lKB: 0.8, rKB: 0.8, lSP: 2.0, rSP: 2.0, lSR: 0.8, rSR: 0.8 } },
            { at: 'act', pose: { lift: 0.15, hipP: -1.6, spP: -0.6 } },
            { at: 'rec:0.5', ease: 'out', pose: { lift: 0, hipP: -0.2, hipY: -0.35, spP: 0.3, lHP: 1.2, rHP: 0.6, lKB: 2.0, rKB: 1.6 } },
            { at: 'rec:0.85', ease: 'in', pose: { lIK: 1, rIK: 1, hipP: 0, hipY: -0.12 } }
        ]
    },
    BACKBREAKER: { // lift from behind and drop the opponent across the knee
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipY: -0.22, spP: 0.3, lSP: 1.3, rSP: 1.3, lSY: 0.6, rSY: 0.6, lEB: 1.4, rEB: 1.4, fwd: 0.12 } },
            { at: 'hit', ease: 'inout', pose: { hipY: -0.05, spP: -0.15, lSP: 2.4, rSP: 2.4, lEB: 1.0, rEB: 1.0 } },
            { at: 'act', pose: { hipY: -0.3, spP: 0.35, rIK: 0, rHP: 1.3, rKB: 1.7, lSP: 1.5, rSP: 1.5, lEB: 0.6, rEB: 0.6 } },
            { at: 'rec:0.6', ease: 'out', pose: { hipY: -0.12, spP: 0.15, rHP: 0.4, rKB: 0.6 } },
            { at: 'rec:0.9', ease: 'in', pose: { rIK: 1 } }
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
                    rSP: 1.55, rSR: -0.05, rSY: 0.22, rEB: 0.08, rAW: 1, aY: 1.38, aZ: 1.2,
                    lSP: 1.40, lSR: 0.05, lSY: 0.55, lEB: 0.55, lAW: 0.8,
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
            { at: 'rec:0.5', ease: 'inout', pose: { rSP: 1.48, rEB: 0.35, spP: 0.08, fwd: 0 } },
            { at: 'rec:0.9', ease: 'inout', pose: { rAW: 0, lAW: 0 } }
        ]
    },
    THROW_WEAPON: { // Whipping empty gun at opponent's face
        trail: 'rFist',
        keys: [
            { at: 'wind', ease: 'out', pose: { hipT: -0.25, spY: -0.65, rSP: 0.35, rSR: 0.65, rEB: 2.1, lSP: 1.1 } },
            {
                at: 'hit', ease: 'out', pose: {
                    hipT: 0.40, spY: 0.40, spP: 0.20, fwd: 0.18,
                    rSP: 1.60, rSR: 0.10, rSY: 0.0, rEB: 0.05, rAW: 1, aY: 1.45, aZ: 1.1,
                    lSP: 0.4, lSR: 0.6, lEB: 2.0, turn: 0.1
                }
            },
            { at: 'act', pose: { rSP: 1.55, fwd: 0.2 } },
            { at: 'rec:0.5', ease: 'inout', pose: { rAW: 0, spY: 0.1, rSP: 0.95, rEB: 1.5, fwd: 0.05 } }
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
    DEVIL_SPIN_KICK: { // P4 Stage-3 Awakened 720° Cyclone Spin Kick: balanced double spin & solid landing
        trail: 'rFoot',
        keepSpin: true,
        keys: [
            { at: 'wind', ease: 'in', pose: { hipY: -0.20, spP: 0.25, spin: Math.PI * 0.5, lSP: 0.45, rSP: 0.45, lSR: 0.65, rSR: 0.65 } },
            {
                at: 'hit', ease: 'out', pose: {
                    lIK: 0, rIK: 0, lift: 0.28, spin: Math.PI * 1.5,
                    rHP: 1.65, rHR: 0.85, rKB: 0.05, rFP: 0.95,
                    lHP: 0.85, lKB: 1.7,
                    spP: -0.18, spR: -0.25,
                    lSP: 0.35, lSR: 0.75, lEB: 0.9, rSP: 0.35, rSR: 0.75, rEB: 0.9,
                    fwd: 0.22, turn: 0.15
                }
            },
            { at: 'act', pose: { lift: 0.32, spin: Math.PI * 2.0, rHP: 1.70 } },
            { at: 'rec:0.55', ease: 'inout', pose: { lift: 0.06, spin: Math.PI * 2, rHP: 0.70, rKB: 1.3, lSR: 0.45, rSR: 0.45 } },
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

const START_POSES = { SIT_UP, LYING, CROUCH: CROUCH_POSE, AIR };

/** Keyframe track for a move; `animId` lets a move reuse another move's motion. */
export function getAttackAnim(move) {
    if (!move) return null;
    return ATTACK_ANIMS[move.id] || (move.animId ? ATTACK_ANIMS[move.animId] : null) || null;
}

function compile(move) {
    let c = compiled.get(move.id);
    if (c) return c;
    const anim = getAttackAnim(move);
    const start = (anim.from && START_POSES[anim.from]) || GUARD;
    c = [{ frame: 0, pose: start, ease: 'out' }];
    let prev = start;
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
    if (!getAttackAnim(move)) return Object.assign(out, GUARD);
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
 * Keyframed gait cycles (classic contact / down / passing / up keys), sampled per foot.
 *
 * Foot z/y are the ANKLE position relative to the hip projection (m), along the travel direction.
 * Stance: the foot moves back linearly at exactly body speed -> zero skating (stance length = stance * cycle).
 * Swing: smooth monotone-cubic through authored keys (toe-off -> heel recovery -> knee drive -> reach -> strike).
 * Foot pitch: + = heel raised (pivots on the ball), - = toes up (pivots on the heel).
 */
/** Monotone cubic (Fritsch-Carlson) through keys [[t, v], ...]; no overshoot between keys. */
function makeCurve(keys) {
    const n = keys.length, t = keys.map(k => k[0]), v = keys.map(k => k[1]);
    const d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d.push((v[i + 1] - v[i]) / (t[i + 1] - t[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
        const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
        if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    return x => {
        if (x <= t[0]) return v[0];
        if (x >= t[n - 1]) return v[n - 1];
        let i = 0;
        while (x > t[i + 1]) i++;
        const h = t[i + 1] - t[i], s = (x - t[i]) / h, s2 = s * s, s3 = s2 * s;
        return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * m[i + 1];
    };
}

/**
 * Gait definitions.  cycle = metres travelled per full cycle (two steps); stance = fraction of the
 * cycle a foot is planted; strike/toeOff = ankle z at contact start/end (strike - toeOff = stance * cycle).
 */
export const GAIT = {
    // relaxed, upright walk: long heel-to-toe stance, ~2.6 steps/s at walk speed
    WALK: {
        cycle: 1.21, stance: 0.62, strike: 0.25, toeOff: -0.50,
        stancePitch: makeCurve([[0, -0.30], [0.16, 0], [0.50, 0], [1, 0.72]]),
        swingZ: null, // filled below from strike/toeOff
        swingY: makeCurve([[0, 0], [0.30, 0.085], [0.62, 0.055], [0.88, 0.022], [1, 0]]),
        swingPitch: makeCurve([[0, 0.72], [0.30, 0.25], [0.62, -0.05], [1, -0.30]])
    },
    // athletic run with a real flight phase: heel kicks up behind, knee drives through, foot paws back
    RUN: {
        cycle: 2.90, stance: 0.25, strike: 0.20, toeOff: -0.525,
        stancePitch: makeCurve([[0, 0.05], [0.25, 0], [0.45, 0], [1, 0.80]]),
        swingZ: makeCurve([[0, -0.525], [0.22, -0.50], [0.50, -0.06], [0.76, 0.30], [1, 0.20]]),
        swingY: makeCurve([[0, 0], [0.22, 0.30], [0.50, 0.40], [0.76, 0.17], [1, 0]]),
        swingPitch: makeCurve([[0, 0.80], [0.22, 1.05], [0.50, 0.55], [0.80, 0.10], [1, 0.05]])
    }
};
GAIT.WALK.swingZ = makeCurve([[0, GAIT.WALK.toeOff], [0.12, GAIT.WALK.toeOff + 0.05], [0.55, 0.0], [0.88, GAIT.WALK.strike + 0.02], [1, GAIT.WALK.strike]]);
for (const g of Object.values(GAIT)) g.perMeter = (Math.PI * 2) / g.cycle;

/** Foot sample at cycle fraction u (0 = heel strike). */
function gaitFoot(g, u) {
    u = ((u % 1) + 1) % 1;
    if (u < g.stance) {
        const s = u / g.stance;
        return { z: g.strike + (g.toeOff - g.strike) * s, y: 0, pitch: g.stancePitch(s), swing: 0 };
    }
    const s = (u - g.stance) / (1 - g.stance);
    return { z: g.swingZ(s), y: g.swingY(s), pitch: g.swingPitch(s), swing: Math.sin(Math.PI * s) };
}

/**
 * Writes both feet for a gait into `out`, travelling along local direction (mf forward, ms right).
 * Returns normalised fore-aft foot positions (-1..1) so the upper body can counter-swing.
 */
function placeFeet(out, g, u, mf, ms, width) {
    const L = gaitFoot(g, u), R = gaitFoot(g, u + 0.5);
    const half = (g.strike - g.toeOff) / 2, mid = (g.strike + g.toeOff) / 2;
    const side = Math.abs(ms);
    const lat = 0.75; // sidesteps are shorter than forward steps so the feet never cross
    // local +x = character's left, so moving right (ms > 0) pushes feet toward -x
    out.lFz = L.z * mf; out.rFz = R.z * mf;
    out.lFx = width + 0.04 * side - L.z * ms * lat;
    out.rFx = width + 0.04 * side + R.z * ms * lat;
    out.lFy = L.y; out.rFy = R.y;
    // walking backward lands on the toes: mirror the heel-toe roll
    const pitchSign = mf < -0.2 ? -0.6 : 1;
    out.lFP = L.pitch * (L.pitch < 0 ? Math.max(0, pitchSign) : 1);
    out.rFP = R.pitch * (R.pitch < 0 ? Math.max(0, pitchSign) : 1);
    out.lFY = 0.06 + 0.25 * side; out.rFY = 0.06 + 0.25 * side;
    out.lIK = 1; out.rIK = 1;
    return { l: (L.z - mid) / half, r: (R.z - mid) / half, ls: L.swing, rs: R.swing };
}

/** Local movement direction (forward, right) of a fighter, defaulting to straight ahead. */
function travelDir(f) {
    const yaw = typeof f.facingAngle === 'number' ? f.facingAngle : (f.facing === -1 ? Math.PI : 0);
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    const spd = Math.hypot(f.vx || 0, f.vz || 0);
    if (spd < 0.05) return { mf: 1, ms: 0 };
    return { mf: ((f.vx || 0) * fx + (f.vz || 0) * fz) / spd, ms: ((f.vx || 0) * -fz + (f.vz || 0) * fx) / spd };
}

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
        const moveId = (f.thrownBy && f.thrownBy.currentMove ? f.thrownBy.currentMove.id : null) ||
                       (f.currentMove ? f.currentMove.id : 'THROW_FRONT');

        if (moveId === 'THROW_BACK') {
            const p = clamp01(timer / 20);
            Object.assign(out, GRABBED_POSE, {
                lIK: 0, rIK: 0,
                lift: Math.sin(p * Math.PI) * 0.70,
                hipP: -0.2 + p * 3.3,
                spP: -0.3 + p * 1.6,
                hdP: 0.3 + p * 0.6,
                lHP: 0.4 + p * 1.2, rHP: 0.4 + p * 1.2,
                lKB: 0.3 + p * 0.8, rKB: 0.3 + p * 0.8,
                lSP: 1.6 - p * 0.6, rSP: 1.6 - p * 0.6,
                lEB: 1.1, rEB: 1.1
            });
            return out;
        }

        if (moveId === 'THROW_FRONT_K') { // flipped forward over Konoko's scissoring legs
            const p = clamp01(timer / 18);
            Object.assign(out, GRABBED_POSE, {
                lIK: 0, rIK: 0,
                lift: Math.sin(p * Math.PI) * 0.6,
                hipP: p * Math.PI * 1.6,
                spP: 0.3 + p * 0.5,
                lHP: 0.8, rHP: 0.8, lKB: 0.6, rKB: 0.6,
                lSP: 2.0, rSP: 2.0
            });
            return out;
        }

        if (moveId === 'BACKBREAKER') { // lifted face-up, folded across the knee
            const p = clamp01(timer / 18);
            Object.assign(out, GRABBED_POSE, {
                lIK: 0, rIK: 0,
                lift: Math.min(1, p * 1.6) * 0.75,
                hipP: -p * 1.5,
                spP: -p * 0.9, hdP: -p * 0.5,
                lHP: 0.3 + p * 0.6, rHP: 0.3 + p * 0.6, lKB: 0.5, rKB: 0.5,
                lSP: 1.4 + p, rSP: 1.4 + p, lEB: 0.4, rEB: 0.4
            });
            return out;
        }

        if (moveId === 'THROW_RUN') {
            const p = clamp01(timer / 19);
            Object.assign(out, GRABBED_POSE, {
                lIK: 0, rIK: 0,
                lift: Math.sin(p * Math.PI) * 0.65,
                spin: p * Math.PI * 2,
                hipP: 0.4 - p * 2.2,
                hipR: Math.sin(p * Math.PI) * 1.2,
                spP: 0.4,
                lHP: 1.5, rHP: 1.5,
                lSP: 1.8, rSP: 1.8
            });
            return out;
        }

        // Default: THROW_FRONT (Shoulder throw over-the-top arc)
        const p = clamp01(timer / 18);
        Object.assign(out, GRABBED_POSE, {
            lIK: 0, rIK: 0,
            lift: Math.sin(p * Math.PI) * 0.75,
            hipP: 0.3 - p * 3.4,
            spP: 0.2 - p * 1.5,
            lHP: 1.2 + p * 0.6, rHP: 1.0 + p * 0.6,
            lKB: 0.5 + p * 0.5, rKB: 0.4 + p * 0.5,
            lSP: 1.4 - p * 0.8, rSP: 1.4 - p * 0.8,
            lEB: 1.2, rEB: 1.2
        });
        return out;
    }

    if (st === FIGHTER_STATE.CROUCH) {
        Object.assign(out, CROUCH_POSE);
        if (Math.hypot(f.vx || 0, f.vz || 0) > 0.1) {
            // Tactical low sneak crawl
            const cycle = Math.sin(t * 8.0);
            out.hipY = -0.46 + Math.abs(cycle) * 0.04;
            out.lFz = 0.24 + cycle * 0.18;
            out.rFz = -0.26 - cycle * 0.18;
            out.lSP = 1.05 + cycle * 0.25;
            out.rSP = 0.75 - cycle * 0.25;
        }
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
        const g = GAIT.RUN;
        const u = loco.phase / (Math.PI * 2);
        Object.assign(out, GUARD);
        const k = placeFeet(out, g, u, 1, 0, 0.085);
        // pelvis: compresses at mid-stance, rises through the flight phase
        const uu = ((u % 0.5) + 0.5) % 0.5 / 0.5;          // 0..1 per step
        const mid = g.stance / 2 * 2;                        // mid-stance in step units
        const bob = -Math.cos((uu - mid) * Math.PI * 2);    // -1 at mid-stance, +1 mid-flight
        out.hipY = -0.085 + bob * 0.028;
        out.lift = 0;
        out.fwd = 0.05;
        out.hipP = 0.12;
        out.hipT = (k.l - k.r) * -0.11;                     // lead-leg hip forward
        out.hipR = (k.ls - k.rs) * 0.035;                   // swing-side hip drops slightly
        out.hipS = 0;
        out.spP = 0.17 - bob * 0.02;                        // ~20 deg total forward lean
        out.spY = (k.l - k.r) * 0.17;                       // shoulders counter the pelvis
        out.spR = 0; out.hdP = -0.05; out.hdY = 0;
        // arms: pump from the shoulder, elbows ~90deg, hands rise to chin height on the forward swing
        const la = k.r, ra = k.l;                            // contralateral
        out.lSP = 0.20 + la * 0.78; out.rSP = 0.20 + ra * 0.78;
        out.lSR = 0.16; out.rSR = 0.16;
        out.lSY = Math.max(0, la) * 0.22; out.rSY = Math.max(0, ra) * 0.22;
        out.lEB = 1.50 + Math.max(0, la) * 0.30 - Math.max(0, -la) * 0.25;
        out.rEB = 1.50 + Math.max(0, ra) * 0.30 - Math.max(0, -ra) * 0.25;
        out.lWB = 0.05; out.rWB = 0.05;
        out.turn = 0;
        out.gait = true;
        return out;
    }

    if (st === FIGHTER_STATE.WALK) {
        const g = GAIT.WALK;
        const u = loco.phase / (Math.PI * 2);
        const { mf, ms } = travelDir(f);
        const guarded = f.isBlocking || mf < 0.55 || f.inCombatRange; // near a foe / backing off / strafing
        Object.assign(out, GUARD);
        const k = placeFeet(out, g, u, mf, ms, 0.09);
        // inverted pendulum: pelvis highest over the planted leg, lowest at double support
        const uu = ((u % 0.5) + 0.5) % 0.5 / 0.5;
        const bob = Math.cos((uu - 0.62) * Math.PI * 2);    // +1 mid-stance, -1 at heel strike
        const af = Math.abs(mf);
        out.hipY = (guarded ? -0.075 : -0.036) + bob * 0.012;
        out.lift = 0;
        out.fwd = 0.01;
        out.hipP = 0.03;
        out.hipT = (k.l - k.r) * -0.07 * af;
        out.hipR = (k.ls - k.rs) * 0.04;                    // Trendelenburg drop on the swing side
        out.hipS = (k.ls - k.rs) * -0.018;                  // weight shifts over the stance foot
        out.spP = 0.05;
        out.spY = (k.l - k.r) * 0.10 * af;
        out.spR = 0; out.hdP = 0; out.hdY = 0;
        out.turn = 0;
        if (guarded) {
            // compact guard carried through the footwork, slight counter-sway only
            out.lSP = 0.95 + k.r * 0.06; out.lSR = 0.30; out.lSY = 0.20; out.lEB = 1.95; out.lWB = 0.1;
            out.rSP = 0.80 + k.l * 0.06; out.rSR = 0.32; out.rSY = 0.25; out.rEB = 2.10; out.rWB = 0.1;
            out.spP = 0.12;
            out.hipT = 0.18 * (1 - af) + out.hipT; out.spY = -0.10 + out.spY;
        } else {
            // relaxed natural walk: arms hang and swing opposite the legs, elbows soften on the forward swing
            const la = k.r, ra = k.l;
            out.lSP = 0.04 + la * 0.36; out.rSP = 0.04 + ra * 0.36;
            out.lSR = 0.11; out.rSR = 0.11;
            out.lSY = 0.04; out.rSY = 0.04;
            out.lEB = 0.30 + Math.max(0, la) * 0.32; out.rEB = 0.30 + Math.max(0, ra) * 0.32;
            out.lWB = 0.05; out.rWB = 0.05;
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
