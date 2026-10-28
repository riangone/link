/**
 * ProceduralFighterMesh - animation driver for one fighter (render adapter, "dumb terminal")
 *
 * Responsibilities:
 *  - Own a CharacterModel (the look) and place it in the world from the read-only fighter snapshot
 *  - Resolve a semantic target pose (AnimationLibrary), run it through per-joint springs
 *    (overshoot, follow-through, overlapping action) and map semantics -> joints in ONE place (applyPose)
 *  - Two-bone leg IK: planted feet stay on the floor while the pelvis drives (weight shift, knee flex)
 *  - Secondary motion: gaze stabilisation, hair sway, hit impulses; strike trails / hit flash
 */

import * as THREE from '../../vendor/three.module.js';
import { FIGHTER_STATE } from '../core/Constants.js';
import { POSE_KEYS, makePose, resolvePose, ATTACK_ANIMS, GAIT } from './AnimationLibrary.js';
import { CharacterModel, SIDE_L, SIDE_R } from './CharacterModel.js';

const CAM_TURN = 0.38; // rad the stance opens toward the camera at turn = 1

// [angular frequency rad/s, damping ratio] per semantic key at full speed (attack)
const SPRING_DEFAULT = [46, 0.62];
const SPRING = {
    hipY: [40, 0.62], hipP: [42, 0.7], hipT: [40, 0.58], hipR: [36, 0.6], hipS: [30, 0.7], fwd: [38, 0.7],
    spP: [44, 0.55], spY: [42, 0.5], spR: [38, 0.55],
    hdP: [26, 0.5], hdY: [26, 0.5],
    lSP: [38, 0.42], lSR: [36, 0.48], lSY: [36, 0.5], lEB: [44, 0.45], lWB: [30, 0.4],
    rSP: [38, 0.42], rSR: [36, 0.48], rSY: [36, 0.5], rEB: [44, 0.45], rWB: [30, 0.4],
    lHP: [48, 0.62], lHR: [46, 0.68], lKB: [54, 0.62],
    rHP: [48, 0.58], rHR: [46, 0.65], rKB: [54, 0.6],
    lift: [40, 0.75], spin: [42, 0.82], turn: [18, 0.9]
};
// feet/IK weights: fast and critically damped (no foot skating, no wobble); not slowed in idle
const FOOT_SPRING = [64, 1.0];
const FOOT_KEYS = new Set(['lFx', 'lFy', 'lFz', 'lFY', 'lFP', 'rFx', 'rFy', 'rFz', 'rFY', 'rFP', 'lIK', 'rIK']);

function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

// scratch objects
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _pole = new THREE.Vector3(), _hip = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _e = new THREE.Euler();
const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0);

export class ProceduralFighterMesh {
    constructor(scene, isP1 = true) {
        this.scene = scene;
        this.isP1 = isP1;

        this.root = new THREE.Group();
        this.scene.add(this.root);

        this.model = new CharacterModel(isP1);
        this.body = this.model.root;
        this.body.scale.setScalar(isP1 ? 1.0 : 1.06); // syndicate trooper is slightly bigger
        this.root.add(this.body);
        const m = this.model;
        this.pelvis = m.pelvis; this.spine = m.spine; this.chest = m.chest;
        this.neck = m.neck; this.head = m.head; this.arms = m.arms; this.legs = m.legs;
        this.meshes = m.meshes;
        this.dims = m.dims;
        this.accent = m.p.accent;

        this.buildGroundDecal();
        this.buildTrail();
        this.buildHeldWeaponMesh();

        this.pose = makePose();
        this.vel = makePose();         // spring velocities
        this.target = makePose();
        this.camYaw = 0;               // set by game loop; used to open stance toward the viewer
        this.loco = { phase: 0 };
        this.lastTime = null;
        this.lastHp = null;
        this.flash = 0;
        this.lastX = 0;
        this.lastZ = 0;
        this.hair = { lag: null, vel: new THREE.Vector3(), rx: 0, rz: 0 };
    }

    // ------------------------------------------------------------------ build
    buildGroundDecal() {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
        grd.addColorStop(0, 'rgba(0,0,0,0.75)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, 128, 128);
        this.blob = new THREE.Mesh(
            new THREE.PlaneGeometry(1.1, 1.1),
            new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
        );
        this.blob.rotation.x = -Math.PI / 2;
        this.blob.renderOrder = 1;
        this.scene.add(this.blob);

        this.ring = new THREE.Mesh(
            new THREE.RingGeometry(0.44, 0.47, 48),
            new THREE.MeshBasicMaterial({
                color: this.accent, transparent: true, opacity: 0.55,
                blending: THREE.AdditiveBlending, depthWrite: false
            })
        );
        this.ring.rotation.x = -Math.PI / 2;
        this.scene.add(this.ring);
    }

    buildTrail() {
        this.TRAIL_N = 14;
        const n = this.TRAIL_N;
        const geo = new THREE.BufferGeometry();
        this.trailPos = new Float32Array(n * 2 * 3);
        this.trailCol = new Float32Array(n * 2 * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
        const idx = [];
        for (let i = 0; i < n - 1; i++) {
            const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
            idx.push(a, b, c, b, d, c);
        }
        geo.setIndex(idx);
        this.trailMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide, depthWrite: false
        }));
        this.trailMesh.frustumCulled = false;
        this.scene.add(this.trailMesh);
        this.trailSamples = [];
        this.trailColor = new THREE.Color(this.accent);
    }

    buildHeldWeaponMesh() {
        this.heldGunGroup = new THREE.Group();
        this.heldGunMat = new THREE.MeshStandardMaterial({
            color: 0x262c3e,
            roughness: 0.35,
            metalness: 0.75
        });
        this.heldGunGlowMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff
        });

        const body = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.08, 0.28), this.heldGunMat);
        body.position.set(0, -0.04, 0.10);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.11, 0.055), this.heldGunMat);
        grip.position.set(0, -0.02, 0.0);
        grip.rotation.x = 0.25;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.22), this.heldGunGlowMat);
        strip.position.set(0, -0.04, 0.12);

        this.heldGunGroup.add(body, grip, strip);
        this.heldGunGroup.visible = false;
        this.arms.r.fist.add(this.heldGunGroup);
    }

    // ------------------------------------------------------------------ per-frame
    update(fighter, timeSeconds, dtIn) {
        const dt = dtIn !== undefined ? dtIn
            : (this.lastTime === null ? 1 / 60 : Math.min(0.1, Math.max(0, timeSeconds - this.lastTime)));
        this.lastTime = timeSeconds;

        // gait phase advances with distance travelled -> planted feet do not slide
        const moved = Math.hypot(fighter.x - this.lastX, fighter.z - this.lastZ);
        this.lastX = fighter.x; this.lastZ = fighter.z;
        if (fighter.state === FIGHTER_STATE.RUN) this.loco.phase += moved * GAIT.RUN.perMeter;
        else if (fighter.state === FIGHTER_STATE.WALK) {
            const dir = Math.sign(fighter.vx * fighter.facing) || 1;
            this.loco.phase += dir * moved * GAIT.WALK.perMeter;
        }

        resolvePose(this.target, fighter, this.loco, timeSeconds);
        this.detectHit(fighter);
        this.integrateSprings(fighter.state, dt);

        this.applyRoot(fighter);
        this.applyPose(this.pose, !this.target.gait);
        this.updateHeldWeapon(fighter);
        this.updateHair(dt);
        this.updateDecals(fighter);
        this.updateTrail(fighter, dt);
        this.updateFlash(dt);
    }

    updateHeldWeapon(fighter) {
        if (!this.heldGunGroup) return;
        const hasGun = !!(fighter.weapon && fighter.hp > 0);
        this.heldGunGroup.visible = hasGun;
        if (hasGun) {
            const col = fighter.weapon.color || 0x00f0ff;
            this.heldGunGlowMat.color.setHex(fighter.weapon.ammo > 0 ? col : 0x555566);
            const scaleZ = fighter.weapon.type === 'MERCURY_BOW' ? 1.55 : (fighter.weapon.type === 'SCRAM_CANNON' ? 1.25 : 1.0);
            this.heldGunGroup.scale.set(1, 1, scaleZ);
        }
    }

    /** Taking damage: white flash + a physical jolt injected into the spring velocities. */
    detectHit(f) {
        if (this.lastHp !== null && f.hp < this.lastHp) {
            this.flash = 0.09;
            const V = this.vel;
            V.spP -= 9; V.hdP -= 14; V.spY += 5; V.fwd -= 2.2; V.hipY -= 1.2;
            V.lSR += 8; V.rSR += 8; V.lEB -= 10; V.rEB -= 10;
        }
        this.lastHp = f.hp;
    }

    /**
     * Second-order (mass-spring-damper) joint dynamics. Underdamped arms whip and overshoot,
     * the torso leads and head/arms trail it (overlapping action), feet are critically damped.
     */
    integrateSprings(state, dt) {
        const attack = state === FIGHTER_STATE.ATTACK;
        const hurt = state === FIGHTER_STATE.HIT_STUN;
        const speed = attack ? 1.0 : (hurt ? 0.9 : 0.6);
        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / steps;
        const P = this.pose, V = this.vel, T = this.target;
        for (const k of POSE_KEYS) {
            const foot = FOOT_KEYS.has(k);
            const [w0, z] = foot ? FOOT_SPRING : (SPRING[k] || SPRING_DEFAULT);
            const w = foot ? w0 : w0 * speed;
            const ww = w * w, c = 2 * z * w;
            const target = T[k];
            let p = P[k], v = V[k];
            for (let i = 0; i < steps; i++) {
                const err = k === 'spin' ? wrapAngle(target - p) : target - p;
                v += (ww * err - c * v) * h;
                p += v * h;
            }
            P[k] = p; V[k] = v;
        }
        P.spin = wrapAngle(P.spin);
        P.lIK = Math.max(0, Math.min(1, P.lIK));
        P.rIK = Math.max(0, Math.min(1, P.rIK));
    }

    applyRoot(f) {
        const facing = f.facing === -1 ? -1 : 1;
        const p = this.pose;
        // mirror so both fighters present their right (near) side to the camera
        this.root.scale.x = facing;
        // open the stance toward the viewer only when the camera looks from the side (+Z)
        const toCam = Math.max(0, Math.cos(this.camYaw));
        let baseRotY = facing * (Math.PI / 2 - CAM_TURN * p.turn * toCam);
        if (typeof f.facingAngle === 'number' && Number.isFinite(f.facingAngle)) {
            const worldYaw = Math.PI / 2 - f.facingAngle;
            baseRotY = worldYaw - facing * CAM_TURN * p.turn * toCam;
        }
        this.root.rotation.y = baseRotY + facing * p.spin;
        this.root.position.set(f.x, f.y + Math.max(-0.05, p.lift), f.z);
    }

    /** The single place where semantic values become joint transforms. */
    applyPose(p, autoStep) {
        const d = this.dims;
        this.pelvis.position.set(p.hipS, d.pelvisY + p.hipY, p.fwd);
        this.pelvis.rotation.set(p.hipP, p.hipT, p.hipR);
        this.spine.rotation.set(p.spP * 0.45, p.spY * 0.45, p.spR * 0.5);
        this.chest.rotation.set(p.spP * 0.4, p.spY * 0.45, p.spR * 0.5);
        // neck + head: keep the eyes on the opponent (gaze stabilisation) and add the authored offset
        const torsoP = p.hipP + p.spP * 0.85, torsoY = p.hipT + p.spY * 0.9;
        this.neck.rotation.set(-torsoP * 0.3 + p.hdP * 0.3, -torsoY * 0.35 + p.hdY * 0.4, -p.spR * 0.3);
        this.head.rotation.set(-torsoP * 0.35 + p.hdP * 0.7, -torsoY * 0.4 + p.hdY * 0.6, -p.spR * 0.3 - p.hipR * 0.5);

        this.applyArm(this.arms.l, SIDE_L, p.lSP, p.lSR, p.lSY, p.lEB, p.lWB);
        this.applyArm(this.arms.r, SIDE_R, p.rSP, p.rSR, p.rSY, p.rEB, p.rWB);

        this.pelvis.updateMatrix();
        const sL = autoStep ? Math.min(0.09, Math.hypot(this.vel.lFx, this.vel.lFz) * 0.035) : 0;
        const sR = autoStep ? Math.min(0.09, Math.hypot(this.vel.rFx, this.vel.rFz) * 0.035) : 0;
        this.applyLeg(this.legs.l, SIDE_L, p.lHP, p.lHR, p.lKB, p.lFx, p.lFy + sL, p.lFz, p.lFY, p.lFP, p.lIK);
        this.applyLeg(this.legs.r, SIDE_R, p.rHP, p.rHR, p.rKB, p.rFx, p.rFy + sR, p.rFz, p.rFY, p.rFP, p.rIK);
    }

    applyArm(A, side, SP, SR, SY, EB, WB) {
        A.sh.rotation.set(-SP, -SY * side, SR * side);   // order YXZ: roll, pitch, then swing in parent
        A.el.rotation.set(-EB, 0, 0);
        A.fist.rotation.set(-WB, 0, 0);
    }

    /**
     * Leg = blend(FK angles, analytic two-bone IK to a foot target) by weight w.
     * IK is solved in pelvis space; the knee tracks over the toes; the sole stays flat
     * (or pivots on the ball of the foot when the heel is raised).
     */
    applyLeg(L, side, HP, HR, KB, Fx, Fy, Fz, FY, FP, w) {
        const d = this.dims;
        _e.set(-HP, 0, HR * side);
        const qFK = _q1.setFromEuler(_e);
        let knee = KB;
        L.hip.quaternion.copy(qFK);

        if (w > 0.001) {
            const yaw = FY * side;
            const cy = Math.cos(yaw), sy = Math.sin(yaw);
            const heel = Math.max(0, FP);
            // ball of the foot stays on the target; ankle rises as the heel lifts
            const ballZ = d.toeZ;
            const ax = side * Fx + sy * ballZ, az = Fz + cy * ballZ; // ball position
            const ry = -d.ankleH * Math.cos(heel) - ballZ * Math.sin(heel);
            const rz = -d.ankleH * Math.sin(heel) + ballZ * Math.cos(heel);
            const target = _v1.set(ax - sy * rz, Fy - ry, az - cy * rz);

            // hip joint position (body space) and direction to target in pelvis space
            _hip.copy(L.hip.position).applyMatrix4(this.pelvis.matrix);
            _qInv.copy(this.pelvis.quaternion).invert();
            const dir = _v2.subVectors(target, _hip).applyQuaternion(_qInv);
            _pole.set(sy + side * 0.12, 0, cy).applyQuaternion(_qInv);

            const a = d.thigh, b = d.shin;
            const len = Math.max(0.05, Math.min(a + b - 1e-4, dir.length()));
            const dn = dir.normalize();
            const cosA = Math.max(-1, Math.min(1, (a * a + len * len - b * b) / (2 * a * len)));
            const cosK = Math.max(-1, Math.min(1, (a * a + b * b - len * len) / (2 * a * b)));
            const alpha = Math.acos(cosA);
            const kneeIK = Math.PI - Math.acos(cosK);
            const pp = _pole.addScaledVector(dn, -_pole.dot(dn));
            if (pp.lengthSq() < 1e-6) pp.set(0, 0, 1);
            pp.normalize();
            const ca = Math.cos(alpha), sa = Math.sin(alpha);
            _by.copy(dn).multiplyScalar(-ca).addScaledVector(pp, -sa);    // -thigh direction
            _bz.copy(pp).multiplyScalar(ca).addScaledVector(dn, -sa);     // knee-forward
            _bx.crossVectors(_by, _bz);
            const qIK = _q2.setFromRotationMatrix(_m4.makeBasis(_bx, _by, _bz));

            L.hip.quaternion.copy(qFK).slerp(qIK, w);
            knee = KB + (kneeIK - KB) * w;
            L.knee.rotation.set(knee, 0, 0);

            // foot orientation: flat on the floor, yawed, pitched by heel lift (body space)
            const qFoot = _q3.setFromAxisAngle(AX_Y, yaw).multiply(_q2.setFromAxisAngle(AX_X, heel));
            const qShin = _q1.copy(this.pelvis.quaternion).multiply(L.hip.quaternion).multiply(L.knee.quaternion);
            const qAnkleIK = qShin.invert().multiply(qFoot);
            const qAnkleFK = _q2.setFromAxisAngle(AX_X, FP);
            L.ankle.quaternion.copy(qAnkleFK).slerp(qAnkleIK, w);
            return;
        }
        L.knee.rotation.set(knee, 0, 0);
        L.ankle.quaternion.setFromAxisAngle(AX_X, FP);
    }

    /** Hair follows a lagging point: swings back on lunges, bounces on landings. */
    updateHair(dt) {
        const sway = this.model.hairSway;
        if (!sway || dt <= 0) return;
        this.root.updateMatrixWorld(true);
        const pos = sway.getWorldPosition(_v1);
        const H = this.hair;
        if (!H.lag) { H.lag = pos.clone(); return; }
        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / steps, w = 22, z = 0.32;
        for (let i = 0; i < steps; i++) {
            _v2.subVectors(pos, H.lag);
            H.vel.addScaledVector(_v2, w * w * h).addScaledVector(H.vel, -2 * z * w * h);
            H.lag.addScaledVector(H.vel, h);
        }
        // lag offset in head space
        _v2.subVectors(H.lag, pos);
        sway.parent.getWorldQuaternion(_q1).invert();
        _v2.applyQuaternion(_q1);
        const s = 1 / this.body.scale.x;
        const tx = Math.max(-0.7, Math.min(0.7, -_v2.z * 9 * s));
        const tz = Math.max(-0.6, Math.min(0.6, _v2.x * 9 * s));
        sway.rotation.set(tx, 0, tz);
    }

    updateDecals(f) {
        const h = Math.max(0, f.y + this.pose.lift);
        const k = 1 / (1 + h * 1.5);
        this.blob.position.set(f.x, 0.012, f.z);
        this.blob.scale.setScalar(0.8 + k * 0.4);
        this.blob.material.opacity = k;
        this.ring.position.set(f.x, 0.015, f.z);
    }

    updateTrail(f, dt) {
        const n = this.TRAIL_N;
        const move = (f.state === FIGHTER_STATE.ATTACK || f.state === FIGHTER_STATE.THROW) ? f.currentMove : null;
        const anim = move ? ATTACK_ANIMS[move.id] : null;
        let emitting = false;
        if (anim) {
            const fr = f.stateTimer;
            emitting = fr >= move.startup * 0.5 && fr <= move.startup + move.active + 2;
        }

        for (const s of this.trailSamples) s.age += dt;
        this.trailSamples = this.trailSamples.filter(s => s.age < 0.16);

        if (emitting) {
            this.root.updateMatrixWorld(true);
            const limb = anim.trail;
            let tipObj, baseObj;
            if (limb === 'lFist') { tipObj = this.arms.l.tip; baseObj = this.arms.l.el; }
            else if (limb === 'rFist') { tipObj = this.arms.r.tip; baseObj = this.arms.r.el; }
            else if (limb === 'lFoot') { tipObj = this.legs.l.toe; baseObj = this.legs.l.knee; }
            else { tipObj = this.legs.r.toe; baseObj = this.legs.r.knee; }
            const tip = tipObj.getWorldPosition(new THREE.Vector3());
            const base = baseObj.getWorldPosition(new THREE.Vector3()).lerp(tip, 0.45);
            this.trailSamples.unshift({ tip, base, age: 0 });
            if (this.trailSamples.length > n) this.trailSamples.length = n;
        }

        const samples = this.trailSamples;
        const c = this.trailColor;
        for (let i = 0; i < n; i++) {
            const s = samples[Math.min(i, samples.length - 1)];
            const o = i * 6;
            if (!s) {
                this.trailPos.fill(0, o, o + 6);
                this.trailCol.fill(0, o, o + 6);
                continue;
            }
            this.trailPos[o] = s.tip.x; this.trailPos[o + 1] = s.tip.y; this.trailPos[o + 2] = s.tip.z;
            this.trailPos[o + 3] = s.base.x; this.trailPos[o + 4] = s.base.y; this.trailPos[o + 5] = s.base.z;
            const fade = i < samples.length ? Math.max(0, 1 - s.age / 0.16) * (1 - i / n) : 0;
            const tipI = fade * 1.6, baseI = fade * 0.1;
            this.trailCol[o] = c.r * tipI + fade * 0.4; this.trailCol[o + 1] = c.g * tipI + fade * 0.4; this.trailCol[o + 2] = c.b * tipI + fade * 0.4;
            this.trailCol[o + 3] = c.r * baseI; this.trailCol[o + 4] = c.g * baseI; this.trailCol[o + 5] = c.b * baseI;
        }
        const g = this.trailMesh.geometry;
        g.attributes.position.needsUpdate = true;
        g.attributes.color.needsUpdate = true;
        this.trailMesh.visible = samples.length > 1;
    }

    updateFlash(dt) {
        const on = this.flash > 0;
        if (on) this.flash -= dt;
        if (on !== this._flashOn) {
            this._flashOn = on;
            if (!this.matFlash) this.matFlash = new THREE.MeshBasicMaterial({ color: 0xffffff });
            for (const m of this.meshes) m.material = on ? this.matFlash : m.userData.baseMat;
        }
    }

    destroy() {
        this.scene.remove(this.root, this.blob, this.ring, this.trailMesh);
    }
}
