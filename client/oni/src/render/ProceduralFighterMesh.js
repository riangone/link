/**
 * ProceduralFighterMesh - Articulated anime-proportioned rig (render adapter, "dumb terminal")
 *
 * Responsibilities:
 *  - Build a stylised humanoid from primitives (no external assets)
 *  - Consume a read-only fighter snapshot, resolve a semantic pose via AnimationLibrary,
 *    smooth it, and map semantics -> Three.js joint rotations in ONE place (applyPose)
 *  - Ground-lock feet, mirror the rig so both fighters show their near side to camera,
 *    and draw strike trails / hit flashes for readability
 */

import * as THREE from '../../vendor/three.module.js';
import { FIGHTER_STATE } from '../core/Constants.js';
import { POSE_KEYS, makePose, resolvePose, ATTACK_ANIMS } from './AnimationLibrary.js';

const CAM_TURN = 0.38;          // rad the stance opens toward the camera at turn = 1
const SIDE_L = 1, SIDE_R = -1;  // local +X is the character's left

// [angular frequency rad/s, damping ratio] per semantic key at full speed (attack)
const SPRING_DEFAULT = [46, 0.62];
const SPRING = {
    hipY: [44, 0.7], hipP: [44, 0.72], hipT: [48, 0.65], hipR: [40, 0.7],
    spP: [50, 0.6], spY: [52, 0.55], spR: [44, 0.6],
    hdP: [30, 0.5], hdY: [30, 0.5],
    lSP: [42, 0.45], lSR: [40, 0.5], lEB: [46, 0.5],
    rSP: [42, 0.45], rSR: [40, 0.5], rEB: [46, 0.5],
    lHP: [50, 0.7], lHR: [48, 0.75], lKB: [56, 0.72],
    rHP: [50, 0.62], rHR: [48, 0.7], rKB: [56, 0.65],
    fwd: [40, 0.8], lift: [42, 0.8], spin: [46, 0.85], turn: [20, 0.9]
};

function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

export class ProceduralFighterMesh {
    constructor(scene, isP1 = true) {
        this.scene = scene;
        this.isP1 = isP1;

        this.root = new THREE.Group();
        this.scene.add(this.root);

        this.palette = isP1
            ? { suit: 0x1c2236, armor: 0xe9eef7, trim: 0x2b3350, accent: 0x18e8ff, skin: 0xf3cfb3, hair: 0x9046ff, glove: 0x23283a }
            : { suit: 0x17151c, armor: 0x4a4f5e, trim: 0x2a2b33, accent: 0xff2a5c, skin: 0x2e2a36, hair: 0x15151b, glove: 0x1d1c22 };

        this.buildMaterials();
        this.buildRig();
        this.buildGroundDecal();
        this.buildTrail();

        this.pose = makePose();
        this.vel = makePose();         // joint angular velocities for spring dynamics
        this.camYaw = 0;               // set by game loop; used to open stance toward the viewer
        this.target = makePose();
        this.loco = { phase: 0 };
        this.lastTime = null;
        this.lastHp = null;
        this.flash = 0;
        this.lastX = 0;
        this.lastZ = 0;
    }

    // ------------------------------------------------------------------ build
    buildMaterials() {
        const p = this.palette;
        this.matSuit = new THREE.MeshStandardMaterial({ color: p.suit, roughness: 0.62, metalness: 0.15 });
        this.matArmor = new THREE.MeshPhysicalMaterial({
            color: p.armor, roughness: 0.28, metalness: this.isP1 ? 0.15 : 0.75,
            clearcoat: 1.0, clearcoatRoughness: 0.15
        });
        this.matTrim = new THREE.MeshStandardMaterial({ color: p.trim, roughness: 0.4, metalness: 0.6 });
        this.matAccent = new THREE.MeshStandardMaterial({
            color: p.accent, emissive: p.accent, emissiveIntensity: 2.2, roughness: 0.3
        });
        this.matSkin = new THREE.MeshStandardMaterial({ color: p.skin, roughness: 0.55 });
        this.matHair = new THREE.MeshStandardMaterial({
            color: p.hair, roughness: 0.35, metalness: 0.1,
            emissive: this.isP1 ? 0x3a0f78 : 0x000000, emissiveIntensity: 0.6
        });
        this.matGlove = new THREE.MeshStandardMaterial({ color: p.glove, roughness: 0.5, metalness: 0.3 });
        this.matEye = new THREE.MeshBasicMaterial({ color: this.isP1 ? 0x1a1030 : p.accent });
        this.matFlash = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.meshes = [];
    }

    add(parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.scale.set(sx, sy, sz);
        m.castShadow = true;
        m.userData.baseMat = mat;
        parent.add(m);
        this.meshes.push(m);
        return m;
    }

    sphere(r, w = 16, h = 12) { return new THREE.SphereGeometry(r, w, h); }

    /** tapered limb hanging down -Y from the joint origin */
    limb(parent, rTop, rBot, len, mat) {
        const g = new THREE.CylinderGeometry(rTop, rBot, len, 14, 1);
        g.translate(0, -len / 2, 0);
        return this.add(parent, g, mat);
    }

    joint(parent, x, y, z) {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        parent.add(g);
        return g;
    }

    buildRig() {
        const P1 = this.isP1;
        const s = P1 ? 1.0 : 1.06; // syndicate trooper is slightly bulkier
        this.body = new THREE.Group();
        this.body.scale.setScalar(s);
        this.root.add(this.body);

        // ---------------- pelvis
        this.pelvis = this.joint(this.body, 0, 1.0, 0);
        this.add(this.pelvis, this.sphere(0.13), this.matSuit, 0, -0.01, 0, 1.25, 0.85, 0.95);
        this.add(this.pelvis, new THREE.CylinderGeometry(0.158, 0.165, 0.055, 20), this.matTrim, 0, 0.055, 0);
        this.add(this.pelvis, new THREE.BoxGeometry(0.07, 0.04, 0.02), this.matAccent, 0, 0.055, 0.16);

        // ---------------- spine / chest
        this.spine = this.joint(this.pelvis, 0, 0.06, 0);
        this.limb(this.spine, 0.118, 0.128, 0.2, this.matSuit).position.y = 0.2;
        this.chest = this.joint(this.spine, 0, 0.18, 0);
        this.add(this.chest, this.sphere(0.17), this.matSuit, 0, 0.12, 0, 1.12, 1.0, 0.8);
        // front chest plate (front hemisphere) + back pack
        const plate = new THREE.SphereGeometry(0.175, 18, 12, 0, Math.PI, 0, Math.PI * 0.62);
        this.add(this.chest, plate, this.matArmor, 0, 0.14, 0.012, 1.1, 0.95, 0.8);
        this.add(this.chest, new THREE.BoxGeometry(0.2, 0.2, 0.08), this.matTrim, 0, 0.12, -0.14);
        this.add(this.chest, new THREE.CircleGeometry(0.03, 16), this.matAccent, 0, 0.1, 0.152);
        this.add(this.chest, new THREE.BoxGeometry(0.012, 0.16, 0.012), this.matAccent, 0.06, 0.12, -0.18);
        this.add(this.chest, new THREE.BoxGeometry(0.012, 0.16, 0.012), this.matAccent, -0.06, 0.12, -0.18);

        // ---------------- neck / head
        this.add(this.chest, new THREE.CylinderGeometry(0.042, 0.05, 0.1, 12), this.matSkin, 0, 0.3, 0);
        this.head = this.joint(this.chest, 0, 0.33, 0);
        this.add(this.head, this.sphere(0.102, 20, 16), this.matSkin, 0, 0.1, 0.005, 0.92, 1.06, 1.0);
        if (P1) this.buildKonokoHair(); else this.buildTrooperHelmet();

        // ---------------- arms
        this.arms = {};
        for (const side of [SIDE_L, SIDE_R]) {
            const key = side === SIDE_L ? 'l' : 'r';
            const sh = this.joint(this.chest, 0.205 * side, 0.21, 0);
            const pad = new THREE.SphereGeometry(0.082, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
            this.add(sh, pad, this.matArmor, 0.012 * side, 0.01, 0, 1.0, 0.9, 1.05);
            this.limb(sh, 0.05, 0.042, 0.28, this.matSuit);
            const el = this.joint(sh, 0, -0.28, 0);
            this.add(el, this.sphere(0.044, 10, 8), this.matTrim);
            this.limb(el, 0.047, 0.04, 0.25, this.matArmor);
            this.add(el, new THREE.BoxGeometry(0.012, 0.16, 0.012), this.matAccent, 0.045 * side, -0.14, 0);
            const fist = this.joint(el, 0, -0.275, 0);
            this.add(fist, this.sphere(0.052, 12, 10), this.matGlove, 0, 0, 0.004, 0.95, 1.1, 1.12);
            this.add(fist, new THREE.BoxGeometry(0.07, 0.022, 0.03), this.matAccent, 0, -0.025, 0.04);
            const tip = this.joint(fist, 0, -0.05, 0);
            this.arms[key] = { sh, el, fist, tip };
        }

        // ---------------- legs
        this.legs = {};
        for (const side of [SIDE_L, SIDE_R]) {
            const key = side === SIDE_L ? 'l' : 'r';
            const hip = this.joint(this.pelvis, 0.09 * side, -0.05, 0);
            this.limb(hip, 0.078, 0.056, 0.43, this.matSuit);
            this.add(hip, new THREE.BoxGeometry(0.012, 0.26, 0.014), this.matAccent, 0.07 * side, -0.2, 0);
            const knee = this.joint(hip, 0, -0.43, 0);
            this.add(knee, new THREE.SphereGeometry(0.064, 12, 10, 0, Math.PI), this.matArmor, 0, 0.01, 0.008, 1, 1.15, 1);
            this.limb(knee, 0.058, 0.044, 0.41, this.matArmor);
            const ankle = this.joint(knee, 0, -0.41, 0);
            this.add(ankle, this.sphere(0.06, 12, 8), this.matTrim, 0, -0.03, 0.045, 0.95, 0.72, 1.9);
            this.add(ankle, new THREE.BoxGeometry(0.1, 0.012, 0.2), this.matAccent, 0, -0.068, 0.045);
            const sole = this.joint(ankle, 0, -0.072, 0.045);
            const toe = this.joint(ankle, 0, -0.05, 0.16);
            this.legs[key] = { hip, knee, ankle, sole, toe };
        }
    }

    buildKonokoHair() {
        const h = this.head;
        const hair = this.matHair;
        // skull cap (top + back), leaves the face open
        const cap = new THREE.SphereGeometry(0.118, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.58);
        this.add(h, cap, hair, 0, 0.115, -0.006, 1.0, 1.06, 1.08);
        const back = new THREE.SphereGeometry(0.12, 18, 14, Math.PI, Math.PI, 0, Math.PI * 0.78);
        this.add(h, back, hair, 0, 0.1, -0.01, 1.04, 1.12, 1.1);
        // jagged anime bangs
        const bang = new THREE.ConeGeometry(0.026, 0.11, 6);
        bang.rotateX(Math.PI);
        const xs = [-0.07, -0.035, 0.0, 0.035, 0.07];
        xs.forEach((x, i) => {
            const m = this.add(h, bang, hair, x, 0.16, 0.088 - Math.abs(x) * 0.25, 1, 0.8 + (i % 2) * 0.35, 1);
            m.rotation.x = -0.35;
            m.rotation.z = -x * 2.2;
        });
        // side locks framing the face (bob cut)
        const lock = new THREE.ConeGeometry(0.035, 0.2, 6);
        lock.rotateX(Math.PI);
        for (const sx of [1, -1]) {
            const m = this.add(h, lock, hair, 0.098 * sx, 0.06, 0.03, 1, 1, 0.8);
            m.rotation.z = sx * 0.12;
        }
        // eyes + neon head-set
        for (const sx of [1, -1]) {
            this.add(h, this.sphere(0.014, 8, 6), this.matEye, 0.035 * sx, 0.11, 0.092, 1.1, 1.3, 0.5);
        }
        this.add(h, new THREE.TorusGeometry(0.112, 0.008, 6, 20, Math.PI), this.matAccent, 0, 0.12, -0.01).rotation.set(0, Math.PI / 2, Math.PI / 2);
    }

    buildTrooperHelmet() {
        const h = this.head;
        this.add(h, this.sphere(0.122, 20, 16), this.matArmor, 0, 0.11, -0.005, 1.0, 1.04, 1.08);
        // glowing visor band
        const visor = new THREE.CylinderGeometry(0.118, 0.118, 0.04, 20, 1, true, -Math.PI * 0.42, Math.PI * 0.84);
        this.add(h, visor, this.matAccent, 0, 0.115, 0.012, 1.0, 1, 1.08);
        this.add(h, new THREE.BoxGeometry(0.11, 0.05, 0.05), this.matTrim, 0, 0.04, 0.09);   // respirator
        this.add(h, new THREE.BoxGeometry(0.02, 0.09, 0.05), this.matTrim, 0, 0.22, -0.02); // crest
    }

    buildGroundDecal() {
        // soft contact shadow + thin team ring
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
        grd.addColorStop(0, 'rgba(0,0,0,0.75)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, 128, 128);
        const shadowTex = new THREE.CanvasTexture(c);
        this.blob = new THREE.Mesh(
            new THREE.PlaneGeometry(1.1, 1.1),
            new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
        );
        this.blob.rotation.x = -Math.PI / 2;
        this.blob.renderOrder = 1;
        this.scene.add(this.blob);

        this.ring = new THREE.Mesh(
            new THREE.RingGeometry(0.44, 0.47, 48),
            new THREE.MeshBasicMaterial({
                color: this.palette.accent, transparent: true, opacity: 0.55,
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
        this.trailSamples = []; // {tip: Vector3, base: Vector3, age}
        this.trailColor = new THREE.Color(this.palette.accent);
    }

    // ------------------------------------------------------------------ per-frame
    update(fighter, timeSeconds, dtIn) {
        const dt = dtIn !== undefined ? dtIn
            : (this.lastTime === null ? 1 / 60 : Math.min(0.1, Math.max(0, timeSeconds - this.lastTime)));
        this.lastTime = timeSeconds;

        // locomotion phase advances with distance travelled -> no foot sliding
        const moved = Math.hypot(fighter.x - this.lastX, fighter.z - this.lastZ);
        this.lastX = fighter.x; this.lastZ = fighter.z;
        if (fighter.state === FIGHTER_STATE.RUN) this.loco.phase += moved * 4.2 + dt * 2;
        else if (fighter.state === FIGHTER_STATE.WALK) {
            const dir = Math.sign(fighter.vx * fighter.facing) || 1;
            this.loco.phase += dir * (moved * 6.0 + dt * 1.5);
        }

        resolvePose(this.target, fighter, this.loco, timeSeconds);

        this.integrateSprings(fighter.state, dt);

        this.applyRoot(fighter);
        this.applyPose(this.pose);
        this.groundLock(fighter, this.target.noLock);
        this.updateDecals(fighter);
        this.updateTrail(fighter, dt);
        this.updateFlash(fighter, dt);
    }

    /**
     * Second-order (mass-spring-damper) joint dynamics.
     * Underdamped arms whip and overshoot, the torso leads and the head/arms trail it
     * (overlapping action), legs stay firmer so feet do not wobble.
     */
    integrateSprings(state, dt) {
        const attack = state === FIGHTER_STATE.ATTACK;
        const hurt = state === FIGHTER_STATE.HIT_STUN;
        const speed = attack ? 1.0 : (hurt ? 0.9 : 0.55);
        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / steps;
        const P = this.pose, V = this.vel, T = this.target;
        for (let i = 0; i < steps; i++) {
            for (const k of POSE_KEYS) {
                const [w0, z] = SPRING[k] || SPRING_DEFAULT;
                const w = w0 * speed;
                let err = T[k] - P[k];
                if (k === 'spin') err = wrapAngle(err);
                V[k] += (w * w * err - 2 * z * w * V[k]) * h;
                P[k] += V[k] * h;
            }
        }
        P.spin = wrapAngle(P.spin);
    }

    applyRoot(f) {
        const facing = f.facing === -1 ? -1 : 1;
        const p = this.pose;
        // mirror so both fighters present their right (near) side to the camera
        this.root.scale.x = facing;
        // open the stance toward the viewer only when the camera looks from the side (+Z)
        const toCam = Math.max(0, Math.cos(this.camYaw));
        this.root.rotation.y = facing * (Math.PI / 2 - CAM_TURN * p.turn * toCam) + facing * p.spin;
        this.root.position.set(f.x + facing * p.fwd, f.y + p.lift, f.z);
    }

    /** The single place where semantic angles become Three.js rotations. */
    applyPose(p) {
        this.pelvis.position.y = 1.0 + p.hipY;
        this.pelvis.rotation.set(p.hipP, p.hipT, p.hipR);
        this.spine.rotation.set(p.spP * 0.45, p.spY * 0.45, p.spR * 0.5);
        this.chest.rotation.set(p.spP * 0.55, p.spY * 0.55, p.spR * 0.5);
        this.head.rotation.set(p.hdP - p.spP * 0.5, p.hdY - p.spY * 0.6, 0);

        const L = this.arms.l, R = this.arms.r;
        L.sh.rotation.set(-p.lSP, 0, p.lSR * SIDE_L);
        R.sh.rotation.set(-p.rSP, 0, p.rSR * SIDE_R);
        L.el.rotation.set(-p.lEB, 0, 0);
        R.el.rotation.set(-p.rEB, 0, 0);

        const LL = this.legs.l, RL = this.legs.r;
        LL.hip.rotation.set(-p.lHP, 0, p.lHR * SIDE_L);
        RL.hip.rotation.set(-p.rHP, 0, p.rHR * SIDE_R);
        LL.knee.rotation.set(p.lKB, 0, 0);
        RL.knee.rotation.set(p.rKB, 0, 0);
        // keep soles roughly parallel to the floor (clamped so kicks still point the toes)
        const flat = (hp, kb) => Math.max(-0.8, Math.min(0.8, hp - kb - p.hipP));
        LL.ankle.rotation.set(flat(p.lHP, p.lKB), 0, 0);
        RL.ankle.rotation.set(flat(p.rHP, p.rKB), 0, 0);
    }

    /** Plant the lowest foot on the floor so stances never float or sink. */
    groundLock(f, noLock) {
        if (noLock || !f.isGrounded || f.y > 0.001) return;
        this.root.updateMatrixWorld(true);
        const v = ProceduralFighterMesh._v || (ProceduralFighterMesh._v = new THREE.Vector3());
        let minY = Infinity;
        for (const leg of [this.legs.l, this.legs.r]) {
            minY = Math.min(minY, leg.sole.getWorldPosition(v).y, leg.toe.getWorldPosition(v).y - 0.01);
        }
        const offset = minY - f.y;
        if (Math.abs(offset) < 0.5) {
            this.pelvis.position.y -= offset / this.body.scale.y;
        }
    }

    updateDecals(f) {
        const h = Math.max(0, f.y);
        const k = 1 / (1 + h * 1.5);
        this.blob.position.set(f.x, 0.012, f.z);
        this.blob.scale.setScalar(0.8 + k * 0.4);
        this.blob.material.opacity = k;
        this.ring.position.set(f.x, 0.015, f.z);
    }

    updateTrail(f, dt) {
        const n = this.TRAIL_N;
        const move = f.state === FIGHTER_STATE.ATTACK ? f.currentMove : null;
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

    updateFlash(f, dt) {
        if (this.lastHp !== null && f.hp < this.lastHp) this.flash = 0.09;
        this.lastHp = f.hp;
        const on = this.flash > 0;
        if (on) this.flash -= dt;
        if (on !== this._flashOn) {
            this._flashOn = on;
            for (const m of this.meshes) m.material = on ? this.matFlash : m.userData.baseMat;
        }
    }

    destroy() {
        this.scene.remove(this.root, this.blob, this.ring, this.trailMesh);
    }
}
