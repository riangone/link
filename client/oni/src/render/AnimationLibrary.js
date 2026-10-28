/**
 * AnimationLibrary - Data-driven pose & keyframe definitions (render-only, zero Three.js dependency)
 *
 * Semantic joint convention (character-local, facing +Z, independent of Three.js euler signs):
 *   hipY      pelvis height offset from standing (m)
 *   hipP/T/R  pelvis pitch(+ = tilt forward) / twist(yaw) / roll
 *   spP/Y/R   spine  pitch(+ = lean forward) / yaw(+ = right shoulder forward) / roll
 *   hdP/hdY   head   pitch(+ = look down) / yaw
 *   lSP/rSP   shoulder pitch (+ = raise arm FORWARD)
 *   lSR/rSR   shoulder roll  (+ = abduct arm OUTWARD)
 *   lEB/rEB   elbow bend     (+ = forearm folds forward/up)
 *   lHP/rHP   hip pitch      (+ = swing leg FORWARD)
 *   lHR/rHR   hip roll       (+ = leg outward)
 *   lKB/rKB   knee bend      (+ = shin folds backward)
 *   fwd       visual root lunge along facing (m)
 *   lift      extra root height (airborne moves, m)
 *   spin      extra root yaw (rad)
 *   turn      0..1 how much the body opens toward the camera (readability)
 *
 * The rig maps these semantics to Three.js rotations in ONE place (ProceduralFighterMesh.applyPose),
 * which eliminates per-move sign mistakes (e.g. kicks swinging backwards).
 */

import { FIGHTER_STATE } from '../core/Constants.js';

export const POSE_KEYS = [
    'hipY', 'hipP', 'hipT', 'hipR',
    'spP', 'spY', 'spR', 'hdP', 'hdY',
    'lSP', 'lSR', 'lEB', 'rSP', 'rSR', 'rEB',
    'lHP', 'lHR', 'lKB', 'rHP', 'rHR', 'rKB',
    'fwd', 'lift', 'spin', 'turn'
];

const ZERO = Object.fromEntries(POSE_KEYS.map(k => [k, 0]));

export function makePose(over = {}) {
    return Object.assign({}, ZERO, over);
}

// ---------------------------------------------------------------- base stances
export const GUARD = makePose({
    hipY: -0.08, hipT: 0.15, spP: 0.10, spY: -0.10, hdP: 0.08, hdY: 0.10,
    lSP: 0.95, lSR: 0.28, lEB: 1.95,
    rSP: 0.55, rSR: 0.32, rEB: 2.25,
    lHP: 0.38, lHR: 0.12, lKB: 0.40,
    rHP: -0.34, rHR: 0.12, rKB: 0.48,
    turn: 1
});

const BLOCK = makePose({
    hipY: -0.10, spP: 0.22, hdP: 0.30,
    lSP: 1.35, lSR: -0.18, lEB: 2.35,
    rSP: 1.25, rSR: -0.10, rEB: 2.35,
    lHP: 0.35, lHR: 0.10, lKB: 0.55,
    rHP: -0.30, rHR: 0.10, rKB: 0.60,
    fwd: -0.04, turn: 0.6
});

const AIR = makePose({
    spP: 0.15, lSP: 0.9, lSR: 0.4, lEB: 1.8, rSP: 0.6, rSR: 0.4, rEB: 2.1,
    lHP: 1.0, lKB: 1.5, rHP: 0.35, rKB: 1.1, turn: 0.8
});

const HIT_RECOIL = makePose({
    hipY: -0.04, hipP: -0.15, spP: -0.55, spY: 0.25, hdP: -0.55,
    lSP: 0.4, lSR: 0.75, lEB: 0.6, rSP: -0.2, rSR: 0.65, rEB: 0.5,
    lHP: 0.25, lKB: 0.35, rHP: -0.35, rKB: 0.55, fwd: -0.12, turn: 0.8
});

const LAUNCHED = makePose({
    hipP: -0.7, spP: -0.45, hdP: -0.4,
    lSP: 2.3, lSR: 0.5, lEB: 0.4, rSP: 1.9, rSR: 0.6, rEB: 0.6,
    lHP: 0.8, lKB: 1.0, rHP: 0.3, rKB: 0.5, turn: 0.7
});

// lying face-up, head away from the attacker
const LYING = makePose({
    hipY: -0.86, hipP: -1.52, spP: 0.05, hdP: -0.25, hdY: 0.4,
    lSP: 2.6, lSR: 0.6, lEB: 0.3, rSP: 2.4, rSR: 0.9, rEB: 0.5,
    lHP: 0.30, lHR: 0.18, lKB: 0.65, rHP: 0.05, rHR: 0.12, rKB: 0.15,
    turn: 0.4
});

const SIT_UP = makePose({
    hipY: -0.62, hipP: -0.35, spP: 0.55, hdP: 0.2,
    lSP: 0.9, lSR: 0.35, lEB: 1.9, rSP: -0.5, rSR: 0.3, rEB: 0.2,
    lHP: 1.6, lKB: 2.2, rHP: 0.9, rKB: 2.0, turn: 0.8
});

const VICTORY = makePose({
    spP: -0.05, hdP: -0.25, hdY: -0.25,
    lSP: 0.15, lSR: 0.35, lEB: 1.6,
    rSP: 2.95, rSR: 0.25, rEB: 0.15,
    lHP: 0.12, lHR: 0.12, lKB: 0.08, rHP: -0.08, rHR: 0.12, rKB: 0.05,
    turn: 1.6
});

// ---------------------------------------------------------------- attack tracks
// Each attack = windup pose + strike pose (+ optional settle). Keyframes are built from
// the move's frame data so visuals always line up with the deterministic hitbox window.
export const ATTACK_ANIMS = {
    PUNCH_1: { // lead (left) jab: shoulder drives through, rear hand guards the chin
        trail: 'lFist',
        windup: { lSP: 0.9, lEB: 2.3, spY: -0.05, hipY: -0.09, lKB: 0.45, fwd: -0.03, turn: 0.5 },
        strike: {
            lSP: 1.58, lSR: -0.04, lEB: 0.0, spY: -0.62, spP: 0.2, spR: 0.08, hipT: -0.12, hdY: 0.35, hdP: 0.12,
            rSP: 0.75, rSR: 0.15, rEB: 2.45, lHP: 0.6, lKB: 0.55, rHP: -0.55, rKB: 0.2,
            hipY: -0.12, fwd: 0.34, turn: 0.1
        }
    },
    PUNCH_2: { // rear (right) cross: load the back leg, pivot hips, lead hand snaps back
        trail: 'rFist',
        windup: {
            spY: -0.6, hipT: -0.25, rSP: 0.45, rSR: 0.35, rEB: 2.5, hipY: -0.13,
            rKB: 0.7, lKB: 0.45, fwd: -0.06, turn: 0.6
        },
        strike: {
            rSP: 1.6, rSR: -0.05, rEB: 0.0, spY: 1.05, hipT: 0.55, spP: 0.28, spR: -0.1, hdY: -0.45, hdP: 0.1,
            lSP: 0.4, lSR: 0.55, lEB: 2.5,
            lHP: 0.7, lKB: 0.65, rHP: -0.7, rKB: 0.1,
            hipY: -0.14, fwd: 0.5, turn: 0.05
        }
    },
    UPPERCUT: { // rising dragon uppercut: deep crouch, explode upward, lead arm counter-swings
        trail: 'rFist',
        windup: {
            hipY: -0.38, spP: 0.6, spY: -0.5, hdP: 0.25,
            rSP: -0.55, rSR: 0.3, rEB: 1.2, lSP: 1.1, lEB: 2.2,
            lHP: 0.8, lKB: 1.35, rHP: 0.0, rKB: 1.2, fwd: -0.05, turn: 0.5
        },
        strike: {
            hipY: 0.08, spP: -0.45, spY: 0.7, spR: -0.15, hdP: -0.6,
            rSP: 3.0, rSR: 0.05, rEB: 0.2, lSP: -0.6, lSR: 0.6, lEB: 0.7,
            lHP: 0.6, lKB: 1.6, rHP: -0.35, rKB: 0.3,
            fwd: 0.3, lift: 0.5, turn: 0.4, noLock: true
        }
    },
    KICK_LOW: { // near-side (right) snap kick: high knee chamber, arms counterbalance
        trail: 'rFoot',
        windup: {
            rHP: 1.45, rKB: 2.25, spP: -0.1, hipT: 0.25, hipY: -0.04, lKB: 0.4,
            lSP: 0.9, lSR: 0.4, lEB: 1.9, rSP: 0.3, rSR: 0.5, rEB: 1.7, turn: 0.5
        },
        strike: {
            rHP: 1.55, rHR: 0.08, rKB: 0.0, spP: -0.5, spY: 0.35, hipT: 0.45, hipP: -0.15,
            lHP: 0.05, lKB: 0.3, lSP: 0.75, lSR: 0.85, lEB: 1.3, rSP: -0.2, rSR: 0.95, rEB: 0.9,
            hdP: 0.2, fwd: 0.18, turn: 0.25
        }
    },
    KICK_HEAVY: { // 360 spinning roundhouse: arms fling wide, torso leans away from the kick
        trail: 'rFoot',
        windup: {
            spin: Math.PI * 0.9, hipY: -0.16, spP: 0.2, spY: -0.3, lKB: 0.7, rHP: 0.6, rKB: 1.6,
            lSP: 0.4, lSR: 1.2, lEB: 0.8, rSP: 0.3, rSR: 1.2, rEB: 0.8, hdY: 0.5, turn: 0.3
        },
        strike: {
            spin: Math.PI * 2, rHP: 1.75, rHR: 0.95, rKB: 0.0, spR: -0.8, spP: -0.45, hipR: -0.2,
            lHP: 0.0, lKB: 0.2, lSP: 0.2, lSR: 1.55, lEB: 0.2, rSP: 0.1, rSR: 1.5, rEB: 0.2,
            hdY: 0.35, hdP: 0.15, fwd: 0.25, turn: 0.2
        },
        keepSpin: true
    },
    SLIDE_KICK: { // Oni signature slide sweep
        trail: 'rFoot',
        windup: { hipY: -0.4, spP: 0.55, lKB: 1.5, rKB: 1.3, lHP: 0.8, rHP: 0.3, lSP: -0.5, rSP: 1.0, rEB: 1.8, turn: 0.5 },
        strike: {
            hipY: -0.68, hipP: -0.8, spP: -0.3, hdP: 0.45,
            rHP: 0.85, rKB: 0.0, lHP: 0.25, lKB: 1.8,
            lSP: -1.1, lSR: 0.45, lEB: 0.1, rSP: 1.1, rSR: 0.3, rEB: 1.7,
            fwd: 0.15, turn: 0.6, noLock: true
        }
    }
};

// ---------------------------------------------------------------- easing / blending
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = t => Math.max(0, Math.min(1, t));

function blendInto(out, a, b, t) {
    for (const k of POSE_KEYS) {
        const va = a[k] !== undefined ? a[k] : GUARD[k];
        const vb = b[k] !== undefined ? b[k] : GUARD[k];
        out[k] = va + (vb - va) * t;
    }
    out.noLock = (t < 0.5 ? a.noLock : b.noLock) || false;
    return out;
}

const _tmpA = makePose();
const _tmpB = makePose();

/**
 * Sample attack pose at a (possibly fractional) frame inside the move.
 */
function sampleAttack(out, move, frame) {
    const anim = ATTACK_ANIMS[move.id];
    if (!anim) return Object.assign(out, GUARD);

    const windup = Object.assign(_tmpA, GUARD, anim.windup);
    const strike = Object.assign(_tmpB, GUARD, anim.strike);
    const s = move.startup;
    const aEnd = s + move.active;
    const total = aEnd + move.recovery;
    const windEnd = Math.max(1, s * 0.6);

    if (frame < windEnd) {
        blendInto(out, GUARD, windup, easeOut(frame / windEnd));
    } else if (frame < s) {
        blendInto(out, windup, strike, easeOut((frame - windEnd) / (s - windEnd)));
    } else if (frame < aEnd) {
        Object.assign(out, strike);
        out.noLock = !!anim.strike.noLock;
    } else {
        const t = easeInOut(clamp01((frame - aEnd) / Math.max(1, total - aEnd)));
        blendInto(out, strike, GUARD, t);
        if (anim.keepSpin) out.spin = strike.spin; // finish the 360 instead of unwinding
    }
    return out;
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
    out.noLock = false;

    if (st === FIGHTER_STATE.ATTACK && f.currentMove) {
        return sampleAttack(out, f.currentMove, timer);
    }

    if (st === FIGHTER_STATE.HIT_STUN) {
        const dur = f.hitStunDuration || 16;
        const k = timer < 3 ? easeOut(timer / 3) : 1 - easeInOut(clamp01((timer - 3) / Math.max(1, dur - 3)));
        return blendInto(out, GUARD, HIT_RECOIL, k);
    }

    if (st === FIGHTER_STATE.KNOCKED_DOWN || st === FIGHTER_STATE.DEFEAT) {
        if (f.y > 0.05) {
            Object.assign(out, LAUNCHED);
            out.noLock = true;
            out.lift = 0;
            return out;
        }
        Object.assign(out, LYING);
        out.noLock = true;
        return out;
    }

    if (st === FIGHTER_STATE.WAKEUP) {
        const p = clamp01(timer / 22);
        if (p < 0.45) blendInto(out, LYING, SIT_UP, easeInOut(p / 0.45));
        else blendInto(out, SIT_UP, GUARD, easeInOut((p - 0.45) / 0.55));
        out.noLock = p < 0.8;
        return out;
    }

    if (st === FIGHTER_STATE.VICTORY) {
        Object.assign(out, VICTORY);
        out.hipY = Math.sin(t * 2.2) * 0.012;
        return out;
    }

    if (st === FIGHTER_STATE.BLOCK || f.isBlocking) {
        Object.assign(out, BLOCK);
        if (st === FIGHTER_STATE.BLOCK && timer < 4) out.fwd = -0.12; // blockstun shove
        return out;
    }

    if (!f.isGrounded) {
        Object.assign(out, AIR);
        out.noLock = true;
        return out;
    }

    if (st === FIGHTER_STATE.RUN) {
        const ph = loco.phase;
        const s = Math.sin(ph), c = Math.cos(ph);
        Object.assign(out, GUARD, {
            hipY: -0.08 + Math.abs(c) * 0.07,
            hipT: -s * 0.12, hipR: s * 0.05, spP: 0.5, spY: -s * 0.3, hdP: -0.32, hdY: s * 0.08,
            lSP: -s * 1.3 + 0.25, lSR: 0.15, lEB: 1.5 + Math.max(0, s) * 0.4,
            rSP: s * 1.3 + 0.25, rSR: 0.15, rEB: 1.5 + Math.max(0, -s) * 0.4,
            lHP: s * 1.15 + 0.2, lHR: 0.03, lKB: 0.3 + Math.max(0, -c) * 1.9,
            rHP: -s * 1.15 + 0.2, rHR: 0.03, rKB: 0.3 + Math.max(0, c) * 1.9,
            turn: 0.15
        });
        return out;
    }

    if (st === FIGHTER_STATE.WALK) {
        const ph = loco.phase;
        const s = Math.sin(ph), c = Math.cos(ph);
        Object.assign(out, GUARD);
        out.hipY = GUARD.hipY - 0.03 + Math.abs(c) * 0.04;
        out.hipR = s * 0.06;
        out.hipT = GUARD.hipT + s * 0.1;
        out.lHP = GUARD.lHP * 0.4 + s * 0.6;
        out.rHP = GUARD.rHP * 0.4 - s * 0.6;
        out.lKB = 0.3 + Math.max(0, c) * 1.0;
        out.rKB = 0.3 + Math.max(0, -c) * 1.0;
        out.spY = GUARD.spY - s * 0.16;
        out.spR = -s * 0.05;
        out.lSP = GUARD.lSP - s * 0.15;
        out.rSP = GUARD.rSP + s * 0.15;
        return out;
    }

    // IDLE: layered (non-repeating) bounce + weight shift + breathing
    Object.assign(out, GUARD);
    const b = Math.sin(t * 5.2);
    const w = Math.sin(t * 1.3 + (f.id === 'p2' ? 1.7 : 0));
    const br = Math.sin(t * 2.1);
    out.hipY = GUARD.hipY + b * 0.028 - 0.02;
    out.hipR = w * 0.05;
    out.hipT = GUARD.hipT + w * 0.06;
    out.spP = GUARD.spP + b * 0.04 + br * 0.025;
    out.spR = -w * 0.06;
    out.spY = GUARD.spY + Math.sin(t * 0.9) * 0.08;
    out.hdY = GUARD.hdY - w * 0.06;
    out.lKB = GUARD.lKB + Math.max(0, w) * 0.12 + b * 0.04;
    out.rKB = GUARD.rKB + Math.max(0, -w) * 0.12 + b * 0.04;
    out.lSP = GUARD.lSP + br * 0.06;
    out.rSP = GUARD.rSP - br * 0.05;
    out.lEB = GUARD.lEB + b * 0.08;
    out.rEB = GUARD.rEB - b * 0.07;
    return out;
}
