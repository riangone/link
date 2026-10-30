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
import { POSE_KEYS, makePose, resolvePose, ATTACK_ANIMS, GAIT, getAttackAnim } from './AnimationLibrary.js';
import { CharacterModel, SIDE_L, SIDE_R } from './CharacterModel.js';

const CAM_TURN = 0.38; // rad the stance opens toward the camera at turn = 1

// [angular frequency rad/s, damping ratio] per semantic key
// Controlled, organic frequencies (44-64 rad/s) & critical damping (0.68-0.78)
// eliminate robotic jitter and snap, producing deliberate, martial-arts weight and follow-through.
const SPRING_DEFAULT = [52, 0.72];
const SPRING = {
    hipY: [48, 0.75], hipP: [50, 0.72], hipT: [54, 0.70], hipR: [48, 0.75], hipS: [46, 0.75], fwd: [50, 0.72],
    spP: [52, 0.70], spY: [54, 0.68], spR: [48, 0.72],
    hdP: [38, 0.82], hdY: [38, 0.82],
    lSP: [58, 0.68], lSR: [54, 0.70], lSY: [54, 0.70], lEB: [62, 0.68], lWB: [48, 0.72],
    rSP: [58, 0.68], rSR: [54, 0.70], rSY: [54, 0.70], rEB: [62, 0.68], rWB: [48, 0.72],
    lHP: [60, 0.70], lHR: [56, 0.72], lKB: [64, 0.68],
    rHP: [60, 0.70], rHR: [56, 0.72], rKB: [64, 0.68],
    lift: [48, 0.78], spin: [56, 0.75], turn: [32, 0.82]
};
// feet/IK weights: smooth and critically damped (no skating or abrupt pops)
const FOOT_SPRING = [62, 0.88];
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
const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _e = new THREE.Euler();
const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0);

export class ProceduralFighterMesh {
    constructor(scene, isP1 = true, opts = {}) {
        this.scene = scene;
        this.isP1 = isP1;
        this.archetype = opts.archetype || (isP1 ? 'KONOKO' : 'STRIKER');

        this.root = new THREE.Group();
        this.scene.add(this.root);

        this.model = new CharacterModel(isP1, { ...opts, archetype: this.archetype });
        this.body = this.model.root;
        const scale = isP1 ? 1.0 : (this.archetype === 'TANKER' || this.archetype === 'BARABAS' ? 1.15 : (this.archetype === 'FURY' ? 0.96 : 1.06));
        this.body.scale.setScalar(scale);
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
        this.buildAlertBadge();

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

    setArchetype(archetype) {
        if (!archetype || this.isP1 || this.archetype === archetype) return;
        this.archetype = archetype;
        if (this.heldGunGroup && this.heldGunGroup.parent) {
            this.heldGunGroup.parent.remove(this.heldGunGroup);
        }
        this.root.remove(this.body);
        this.model = new CharacterModel(this.isP1, { archetype: this.archetype });
        this.body = this.model.root;
        const scale = this.archetype === 'TANKER' || this.archetype === 'BARABAS' ? 1.15 : (this.archetype === 'FURY' ? 0.96 : 1.06);
        this.body.scale.setScalar(scale);
        this.root.add(this.body);
        const m = this.model;
        this.pelvis = m.pelvis; this.spine = m.spine; this.chest = m.chest;
        this.neck = m.neck; this.head = m.head; this.arms = m.arms; this.legs = m.legs;
        this.meshes = m.meshes;
        this.dims = m.dims;
        this.accent = m.p.accent;
        if (this.ring && this.ring.material) {
            this.ring.material.color.setHex(this.accent);
        }
        if (this.arms && this.arms.r && this.arms.r.fist && this.heldGunGroup) {
            this.arms.r.fist.add(this.heldGunGroup);
        }
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
        this.weaponVariants = {};
        this.weaponGlowMats = {};

        const darkMetal = new THREE.MeshToonMaterial({ color: 0x222634 });
        const slateMetal = new THREE.MeshToonMaterial({ color: 0x3a4154 });
        const silverChrome = new THREE.MeshToonMaterial({ color: 0x94a3b8 });
        const gripMat = new THREE.MeshToonMaterial({ color: 0x14161f });

        // 1. TCTF_PISTOL (Campbell Equalizer Mk4 — Oni iconic heavy bullpup sidearm with underbarrel laser)
        const pistol = new THREE.Group();
        const pGlow = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        this.weaponGlowMats.TCTF_PISTOL = pGlow;
        const pGrip = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.11, 0.048), gripMat);
        pGrip.position.set(0, -0.02, -0.01);
        pGrip.rotation.x = 0.24;
        const pSlide = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.052, 0.23), slateMetal);
        pSlide.position.set(0, -0.055, 0.075);
        const pFrame = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.032, 0.19), darkMetal);
        pFrame.position.set(0, -0.032, 0.065);
        const pBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.07, 10), silverChrome);
        pBarrel.rotation.x = Math.PI / 2;
        pBarrel.position.set(0, -0.058, 0.205);
        const pLaser = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.02, 0.09), darkMetal);
        pLaser.position.set(0, -0.022, 0.125);
        const pLens = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.014, 0.14), pGlow);
        pLens.position.set(0, -0.055, 0.09);
        const pSight = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.014, 0.035), pGlow);
        pSight.position.set(0, -0.084, 0.02);
        pistol.add(pGrip, pSlide, pFrame, pBarrel, pLaser, pLens, pSight);
        this.weaponVariants.TCTF_PISTOL = pistol;
        this.heldGunGroup.add(pistol);

        // 2. SCRAM_CANNON (SML3 Scram Cannon — Multi-barrel rotary micro-missile launcher pod)
        const scram = new THREE.Group();
        const sGlow = new THREE.MeshBasicMaterial({ color: 0xff9900 });
        this.weaponGlowMats.SCRAM_CANNON = sGlow;
        const sGrip = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.11, 0.052), gripMat);
        sGrip.position.set(0, -0.02, -0.01);
        sGrip.rotation.x = 0.2;
        const sHousing = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 0.28), darkMetal);
        sHousing.position.set(0, -0.055, 0.11);
        const sPod = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.26, 8), slateMetal);
        sPod.rotation.x = Math.PI / 2;
        sPod.position.set(0, -0.06, 0.14);
        // 3 rotary missile tubes + glowing warhead tips
        for (let k = 0; k < 3; k++) {
            const ang = (k * Math.PI * 2) / 3 - Math.PI / 2;
            const tx = Math.cos(ang) * 0.024;
            const ty = -0.06 + Math.sin(ang) * 0.024;
            const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.08, 8), silverChrome);
            tube.rotation.x = Math.PI / 2;
            tube.position.set(tx, ty, 0.275);
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 8), sGlow);
            tip.rotation.x = Math.PI / 2;
            tip.position.set(tx, ty, 0.32);
            scram.add(tube, tip);
        }
        const sVent = new THREE.Mesh(new THREE.BoxGeometry(0.102, 0.024, 0.18), sGlow);
        sVent.position.set(0, -0.055, 0.12);
        scram.add(sGrip, sHousing, sPod, sVent);
        scram.visible = false;
        this.weaponVariants.SCRAM_CANNON = scram;
        this.heldGunGroup.add(scram);

        // 3. MERCURY_BOW (Oni Syndicate Mercury Bow — Long sleek rail-sniper with twin curved bow limbs & mercury flask)
        const bow = new THREE.Group();
        const bGlow = new THREE.MeshBasicMaterial({ color: 0x00ffaa });
        this.weaponGlowMats.MERCURY_BOW = bGlow;
        const bGrip = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.11, 0.048), gripMat);
        bGrip.position.set(0, -0.02, -0.01);
        bGrip.rotation.x = 0.22;
        const bStock = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.068, 0.18), darkMetal);
        bStock.position.set(0, -0.045, -0.09);
        const bReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.065, 0.34), slateMetal);
        bReceiver.position.set(0, -0.055, 0.14);
        const bRail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.56, 10), silverChrome);
        bRail.rotation.x = Math.PI / 2;
        bRail.position.set(0, -0.062, 0.34);
        const bCore = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.44, 8), bGlow);
        bCore.rotation.x = Math.PI / 2;
        bCore.position.set(0, -0.042, 0.26);
        const bScope = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.15, 10), darkMetal);
        bScope.rotation.x = Math.PI / 2;
        bScope.position.set(0, -0.098, 0.10);
        // Twin horizontal/angled crossbow energy limbs at the front receiver
        for (const s of [-1, 1]) {
            const limb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.014, 0.032), silverChrome);
            limb.position.set(s * 0.095, -0.055, 0.28);
            limb.rotation.y = -s * 0.38;
            const arcGlow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.012), bGlow);
            arcGlow.position.set(s * 0.095, -0.055, 0.26);
            arcGlow.rotation.y = -s * 0.38;
            bow.add(limb, arcGlow);
        }
        bow.add(bGrip, bStock, bReceiver, bRail, bCore, bScope);
        bow.visible = false;
        this.weaponVariants.MERCURY_BOW = bow;
        this.heldGunGroup.add(bow);

        this.heldGunGroup.visible = false;
        this.arms.r.fist.add(this.heldGunGroup);

        // 4. Tactical Right Thigh Holster (Bungie Oni iconic sidearm dock)
        this.thighHolsterGroup = new THREE.Group();
        this.holsterVariants = {};

        const holsterMat = new THREE.MeshToonMaterial({ color: 0x181b26 });
        const holsterBase = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.13, 0.078), holsterMat);
        holsterBase.position.set(-0.082, -0.11, 0.01);
        holsterBase.rotation.z = -0.05;
        this.thighHolsterGroup.add(holsterBase);

        const hPistol = new THREE.Group();
        const hpGrip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.08, 0.038), gripMat);
        hpGrip.position.set(-0.084, -0.05, 0.012);
        hpGrip.rotation.x = 0.26;
        const hpSlide = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.042, 0.15), slateMetal);
        hpSlide.position.set(-0.084, -0.10, 0.035);
        hPistol.add(hpGrip, hpSlide);
        this.holsterVariants.TCTF_PISTOL = hPistol;
        this.thighHolsterGroup.add(hPistol);

        const hScram = new THREE.Group();
        const hsBox = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.10, 0.11), slateMetal);
        hsBox.position.set(-0.084, -0.08, 0.018);
        hScram.add(hsBox);
        hScram.visible = false;
        this.holsterVariants.SCRAM_CANNON = hScram;
        this.thighHolsterGroup.add(hScram);

        const hBow = new THREE.Group();
        const hbGrip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.045), gripMat);
        hbGrip.position.set(-0.084, -0.06, 0.018);
        hBow.add(hbGrip);
        hBow.visible = false;
        this.holsterVariants.MERCURY_BOW = hBow;
        this.thighHolsterGroup.add(hBow);

        this.thighHolsterGroup.visible = false;
        this.legs.r.hip.add(this.thighHolsterGroup);
    }

    buildAlertBadge() {
        if (this.isP1) return; // Player does not have an alert badge
        const S = 128;
        const makeBadgeTex = (char, color, bg) => {
            const cvs = document.createElement('canvas');
            cvs.width = cvs.height = S;
            const ctx = cvs.getContext('2d');
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.arc(64, 64, 52, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 10;
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.font = '900 76px "Courier New", monospace, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(char, 64, 66);
            const tex = new THREE.CanvasTexture(cvs);
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
        };

        const texQuestion = makeBadgeTex('?', '#94a3b8', 'rgba(15, 23, 42, 0.92)');
        const texExclamation = makeBadgeTex('!', '#ff1744', 'rgba(60, 10, 20, 0.95)');

        const mat = new THREE.SpriteMaterial({
            map: texQuestion,
            transparent: true,
            depthTest: false
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.65, 0.65, 1.0);
        sprite.position.set(0, 2.2, 0);
        this.root.add(sprite);
        this.alertBadge = { sprite, mat, texQuestion, texExclamation };
    }

    updateAlertBadge(fighter, timeSeconds) {
        if (!this.alertBadge) return;
        if (fighter.hp <= 0) {
            this.alertBadge.sprite.visible = false;
            return;
        }
        const isAlerted = fighter.isAlerted !== false;
        this.alertBadge.sprite.visible = true;
        if (!isAlerted) {
            this.alertBadge.mat.map = this.alertBadge.texQuestion;
            this.alertBadge.sprite.scale.set(0.55, 0.55, 1.0);
            this.alertBadge.sprite.position.y = 2.15 + Math.sin(timeSeconds * 3.5) * 0.05;
        } else {
            this.alertBadge.mat.map = this.alertBadge.texExclamation;
            const pulse = 1.0 + Math.sin(timeSeconds * 12.0) * 0.16;
            this.alertBadge.sprite.scale.set(0.72 * pulse, 0.72 * pulse, 1.0);
            this.alertBadge.sprite.position.y = 2.25 + Math.sin(timeSeconds * 6.0) * 0.04;
        }
    }

    // ------------------------------------------------------------------ per-frame
    update(fighter, timeSeconds, dtIn) {
        const isFirst = (this.lastTime === null);
        const dt = dtIn !== undefined ? dtIn
            : (isFirst ? 1 / 60 : Math.min(0.1, Math.max(0, timeSeconds - this.lastTime)));
        this.lastTime = timeSeconds;

        if (isFirst) {
            this.lastX = fighter.x;
            this.lastZ = fighter.z;
        }

        // gait phase advances with full 3D distance travelled (forward, back, or lateral strafe) -> planted feet never slide
        const dx = fighter.x - this.lastX, dz = fighter.z - this.lastZ;
        const moved = Math.hypot(dx, dz);
        this.lastX = fighter.x; this.lastZ = fighter.z;
        // phase is distance-driven along the actual travel direction (forward, back or sideways)
        if (fighter.state === FIGHTER_STATE.RUN) this.loco.phase += moved * GAIT.RUN.perMeter;
        else if (fighter.state === FIGHTER_STATE.WALK) this.loco.phase += moved * GAIT.WALK.perMeter;
        this.loco.phase %= Math.PI * 4;

        // Archetype visual scaling & optical camouflage
        if (!this.isP1 && fighter.archetype && fighter.archetype !== this.archetype) {
            this.setArchetype(fighter.archetype);
        }
        const targetScale = fighter.scale || (this.isP1 ? 1.0 : (this.archetype === 'TANKER' || this.archetype === 'BARABAS' ? 1.15 : (this.archetype === 'FURY' ? 0.96 : 1.06)));
        if (Math.abs(this.body.scale.x - targetScale) > 0.01) {
            this.body.scale.setScalar(targetScale);
        }
        if (fighter.isCamouflage && this.meshes) {
            const isVisible = fighter.state === FIGHTER_STATE.ATTACK || fighter.hitStunDuration > 0 || fighter.hp <= 0;
            const targetOpacity = isVisible ? 0.95 : 0.32;
            for (let i = 0; i < this.meshes.length; i++) {
                const m = this.meshes[i];
                if (m.material) {
                    m.material.transparent = true;
                    m.material.opacity = targetOpacity;
                }
            }
        }

        resolvePose(this.target, fighter, this.loco, timeSeconds);
        this.detectHit(fighter);
        this.integrateSprings(fighter, dt);

        this.applyRoot(fighter);
        this.applyPose(this.pose, !this.target.gait);
        this.updateHeldWeapon(fighter);
        this.updateAlertBadge(fighter, timeSeconds);
        this.updateHair(dt);
        this.updateDecals(fighter);
        this.updateTrail(fighter, dt);
        this.updateFlash(dt);
    }

    updateHeldWeapon(fighter) {
        if (!this.heldGunGroup) return;
        const hasGun = !!(fighter.weapon && fighter.hp > 0);
        if (!hasGun) {
            this.heldGunGroup.visible = false;
            if (this.thighHolsterGroup) this.thighHolsterGroup.visible = false;
            return;
        }

        const isShooting = (
            fighter.state === FIGHTER_STATE.ATTACK &&
            fighter.currentMove &&
            (fighter.currentMove.isFirearmMove || fighter.currentMove.isWeaponThrow)
        );

        this.heldGunGroup.visible = isShooting;
        if (this.thighHolsterGroup) this.thighHolsterGroup.visible = !isShooting;

        const wType = fighter.weapon.type || 'TCTF_PISTOL';
        for (const [k, grp] of Object.entries(this.weaponVariants)) {
            grp.visible = (k === wType);
        }
        if (this.holsterVariants) {
            for (const [k, grp] of Object.entries(this.holsterVariants)) {
                grp.visible = (k === wType);
            }
        }

        const glowMat = this.weaponGlowMats[wType] || this.weaponGlowMats.TCTF_PISTOL;
        if (glowMat) {
            const col = fighter.weapon.color || 0x00f0ff;
            glowMat.color.setHex(fighter.weapon.ammo > 0 ? col : 0x475569);
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
     * Second-order (mass-spring-damper) joint dynamics with martial-arts strike snappiness.
     * Attacks feature high-stiffness explosive drives and crisp lockout holds on hit frames.
     */
    integrateSprings(fighter, dt) {
        const state = fighter.state;
        const isAttack = state === FIGHTER_STATE.ATTACK || state === FIGHTER_STATE.THROW;
        const isHurt = state === FIGHTER_STATE.HIT_STUN || state === FIGHTER_STATE.BEING_THROWN;
        const isLoco = state === FIGHTER_STATE.WALK || state === FIGHTER_STATE.RUN;

        // Snappy martial arts: attack strikes snap instantly into apex and hold with zero sponge delay
        let activeSnap = false;
        let snapLimb = null;
        if (isAttack && fighter.currentMove) {
            const m = fighter.currentMove;
            const fr = fighter.stateTimer;
            if (fr >= m.startup && fr <= (m.startup + m.active + 1)) {
                activeSnap = true;
                const anim = getAttackAnim(m);
                snapLimb = anim ? anim.trail : null;
            }
        }

        const steps = Math.max(1, Math.ceil(dt / (1 / 300)));
        const h = dt / steps;
        const P = this.pose, V = this.vel, T = this.target;

        for (const k of POSE_KEYS) {
            const foot = FOOT_KEYS.has(k);
            let [w0, z] = foot ? FOOT_SPRING : (SPRING[k] || SPRING_DEFAULT);

            // Responsive martial-arts cadence (smooth, deliberate, pacing matching Oni 2001)
            let w = w0;
            if (isAttack) {
                w = w0 * 1.45; // balanced strike acceleration & fluid kinetic delivery
            } else if (isHurt) {
                w = w0 * 0.90;
            } else if (isLoco) {
                w = w0 * 1.05;
            } else {
                w = w0 * 0.85;
            }

            const target = T[k];
            let p = P[k], v = V[k];

            if (activeSnap && snapLimb) {
                // Strike apex hold: lock attacking limb rigidly to the keyframe pose for maximum impact
                if (snapLimb === 'lFist' && (k.startsWith('lS') || k.startsWith('lE') || k.startsWith('lW') || k === 'lAW')) {
                    P[k] = target; V[k] = 0; continue;
                }
                if (snapLimb === 'rFist' && (k.startsWith('rS') || k.startsWith('rE') || k.startsWith('rW') || k === 'rAW')) {
                    P[k] = target; V[k] = 0; continue;
                }
                if (snapLimb === 'lFoot' && (k.startsWith('lH') || k.startsWith('lK') || k.startsWith('lF'))) {
                    P[k] = target; V[k] = 0; continue;
                }
                if (snapLimb === 'rFoot' && (k.startsWith('rH') || k.startsWith('rK') || k.startsWith('rF'))) {
                    P[k] = target; V[k] = 0; continue;
                }
            }

            const ww = w * w, c = 2 * z * w;
            for (let i = 0; i < steps; i++) {
                const err = k === 'spin' ? wrapAngle(target - p) : target - p;
                v += (ww * err - c * v) * h;
                p += v * h;
            }
            P[k] = p; V[k] = v;
        }
        // Planted feet must not lag behind their targets (a spring there = skating). While a gait is
        // active the feet blend onto the authored trajectory within ~0.1 s, then track it exactly.
        this.gaitW = Math.max(0, Math.min(1, (this.gaitW || 0) + (T.gait ? dt : -dt) / 0.1));
        if (this.gaitW > 0) {
            for (const k of FOOT_KEYS) {
                P[k] += (T[k] - P[k]) * this.gaitW;
                if (this.gaitW >= 1) V[k] = 0;
            }
        }
        P.spin = wrapAngle(P.spin);
        P.lIK = Math.max(0, Math.min(1, P.lIK));
        P.rIK = Math.max(0, Math.min(1, P.rIK));
    }

    applyRoot(f) {
        const p = this.pose;
        this.root.scale.set(1, 1, 1);
        const toCam = Math.max(0, Math.cos(this.camYaw));
        const facingSign = f.facing === -1 ? -1 : 1;
        let baseRotY = Math.PI / 2 - (typeof f.facingAngle === 'number' && Number.isFinite(f.facingAngle) ? f.facingAngle : (facingSign === -1 ? Math.PI : 0));
        baseRotY -= facingSign * CAM_TURN * p.turn * toCam * 0.5;
        this.root.rotation.y = baseRotY + p.spin;
        this.root.position.set(f.x, f.y + Math.max(-0.05, p.lift), f.z);
    }

    /** The single place where semantic values become joint transforms. */
    applyPose(p, autoStep) {
        const d = this.dims;
        this.pelvis.position.set(p.hipS, d.pelvisY + p.hipY, p.fwd);
        this.pelvis.rotation.set(p.hipP, p.hipT, p.hipR);
        this.spine.rotation.set(p.spP * 0.55, p.spY * 0.55, p.spR * 0.58);
        this.chest.rotation.set(p.spP * 0.55, p.spY * 0.58, p.spR * 0.58);
        // neck + head: keep the eyes on the opponent (gaze stabilisation) and add the authored offset
        const torsoP = p.hipP + p.spP * 0.95, torsoY = p.hipT + p.spY * 0.95;
        this.neck.rotation.set(-torsoP * 0.3 + p.hdP * 0.35, -torsoY * 0.35 + p.hdY * 0.45, -p.spR * 0.35);
        this.head.rotation.set(-torsoP * 0.35 + p.hdP * 0.75, -torsoY * 0.4 + p.hdY * 0.65, -p.spR * 0.35 - p.hipR * 0.5);

        this.applyArm(this.arms.l, SIDE_L, p.lSP, p.lSR, p.lSY, p.lEB, p.lWB);
        this.applyArm(this.arms.r, SIDE_R, p.rSP, p.rSR, p.rSY, p.rEB, p.rWB);
        if (p.lAW > 0.01 || p.rAW > 0.01) {
            this.pelvis.updateMatrix(); this.spine.updateMatrix(); this.chest.updateMatrix();
            _m4.multiplyMatrices(this.pelvis.matrix, this.spine.matrix).multiply(this.chest.matrix);
            _q3.copy(this.pelvis.quaternion).multiply(this.spine.quaternion).multiply(this.chest.quaternion).invert();
            if (p.lAW > 0.01) this.aimArm(this.arms.l, SIDE_L, Math.min(1, p.lAW), p.aY, p.aZ);
            if (p.rAW > 0.01) this.aimArm(this.arms.r, SIDE_R, Math.min(1, p.rAW), p.aY, p.aZ);
        }

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
     * Strike aim: two-bone IK that sends the fist to a point on the body's centre line (aY high, aZ ahead),
     * whatever the torso twist is. Expects _m4 = chest-to-body matrix and _q3 = body-to-chest rotation.
     * The elbow hangs below the line of the punch (forearm folds upward), like a real straight punch.
     */
    aimArm(A, side, w, aY, aZ) {
        const d = this.dims;
        const s = 1 / this.body.scale.x;
        const sh = _v1.copy(A.sh.position).applyMatrix4(_m4);                  // shoulder in body space
        const dir = _v2.set(0, aY * s, aZ * s).sub(sh).applyQuaternion(_q3);    // shoulder -> target, chest space
        const a = d.upperArm, b = d.foreArm + 0.07;
        const len = Math.max(0.08, Math.min((a + b) * 0.999, dir.length()));
        const dn = dir.normalize();
        const pp = _pole.set(-0.35 * side, 1, 0.15);
        pp.addScaledVector(dn, -pp.dot(dn));
        if (pp.lengthSq() < 1e-6) pp.set(0, 0, 1);
        pp.normalize();
        const cosA = Math.max(-1, Math.min(1, (a * a + len * len - b * b) / (2 * a * len)));
        const cosE = Math.max(-1, Math.min(1, (a * a + b * b - len * len) / (2 * a * b)));
        const ca = cosA, sa = Math.sqrt(1 - ca * ca);
        _by.copy(dn).multiplyScalar(-ca).addScaledVector(pp, sa);   // -upper arm (elbow sits below the line)
        _bz.copy(pp).multiplyScalar(ca).addScaledVector(dn, sa);    // forearm folds toward +z of the shoulder
        _bx.crossVectors(_by, _bz);
        const qIK = _q2.setFromRotationMatrix(_m4b.makeBasis(_bx, _by, _bz));
        A.sh.quaternion.slerp(qIK, w);
        const eb = Math.PI - Math.acos(cosE);
        A.el.rotation.x += (-eb - A.el.rotation.x) * w;
    }

    /**
     * Leg = blend(FK angles, analytic two-bone IK to a foot target) by weight w.
     * IK is solved in pelvis space; the knee tracks over the toes; the sole stays flat
     * (or pivots on the ball of the foot when the heel is raised / pivots on heel at heel-strike).
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
            const pitch = FP;
            let target;

            if (pitch >= 0) {
                // Ball of foot on target; ankle rises with heel lift (plantarflexion)
                const ballZ = d.toeZ;
                const ax = side * Fx + sy * ballZ, az = Fz + cy * ballZ;
                const ry = -d.ankleH * Math.cos(pitch) - ballZ * Math.sin(pitch);
                const rz = -d.ankleH * Math.sin(pitch) + ballZ * Math.cos(pitch);
                target = _v1.set(ax - sy * rz, Fy - ry, az - cy * rz);
            } else {
                // Heel strike: heel on ground (heelZ = -0.05), toe pitches up (dorsiflexion)
                const heelZ = -0.05;
                const ax = side * Fx + sy * heelZ, az = Fz + cy * heelZ;
                const ry = -d.ankleH * Math.cos(pitch) - heelZ * Math.sin(pitch);
                const rz = -d.ankleH * Math.sin(pitch) + heelZ * Math.cos(pitch);
                target = _v1.set(ax - sy * rz, Fy - ry, az - cy * rz);
            }

            // hip joint position (body space) and direction to target in pelvis space
            _hip.copy(L.hip.position).applyMatrix4(this.pelvis.matrix);
            _qInv.copy(this.pelvis.quaternion).invert();
            const dir = _v2.subVectors(target, _hip).applyQuaternion(_qInv);
            _pole.set(sy + side * 0.12, 0, cy).applyQuaternion(_qInv);

            const a = d.thigh, b = d.shin;
            // Limit reach to 97.5% of max length so the knee maintains organic bend and NEVER locks/pops straight
            const maxReach = (a + b) * 0.975;
            const len = Math.max(0.05, Math.min(maxReach, dir.length()));
            const dn = dir.normalize();
            const cosA = Math.max(-1, Math.min(1, (a * a + len * len - b * b) / (2 * a * len)));
            const cosK = Math.max(-0.95, Math.min(1, (a * a + b * b - len * len) / (2 * a * b)));
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

            // foot orientation: yawed and smoothly pitched by heel-toe roll
            const qFoot = _q3.setFromAxisAngle(AX_Y, yaw).multiply(_q2.setFromAxisAngle(AX_X, pitch));
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
        const floorY = Number.isFinite(f.floorY) ? f.floorY : 0;
        const h = Math.max(0, (f.y - floorY) + this.pose.lift);
        const k = Number.isFinite(f.floorY) ? (1 / (1 + h * 1.5)) : 0;
        this.blob.position.set(f.x, floorY + 0.012, f.z);
        this.blob.scale.setScalar(0.8 + k * 0.4);
        this.blob.material.opacity = k;
        this.ring.position.set(f.x, floorY + 0.015, f.z);
        if (!Number.isFinite(f.floorY)) {
            this.ring.material.opacity = 0;
        } else if (f.daodanOverpower) {
            this.ring.material.color.setHex(0xfacc15); // Golden Daodan Overpower aura
            this.ring.scale.setScalar(1.52 + Math.sin((this.lastTime || 0) * 18) * 0.16);
            this.ring.material.opacity = 0.95;
        } else if (f.daodanOverdrive) {
            this.ring.material.color.setHex(0xd946ef);
            this.ring.scale.setScalar(1.32 + Math.sin((this.lastTime || 0) * 14) * 0.12);
            this.ring.material.opacity = 0.88;
        } else {
            this.ring.material.color.setHex(this.accent);
            this.ring.scale.setScalar(1.0);
            this.ring.material.opacity = 0.55;
        }
    }

    updateTrail(f, dt) {
        const n = this.TRAIL_N;
        const move = (f.state === FIGHTER_STATE.ATTACK || f.state === FIGHTER_STATE.THROW) ? f.currentMove : null;
        const anim = move ? getAttackAnim(move) : null;
        let emitting = false;
        if (anim) {
            const fr = f.stateTimer;
            emitting = fr >= move.startup * 0.5 && fr <= move.startup + move.active + 2;
        }

        for (const s of this.trailSamples) s.age += dt;
        this.trailSamples = this.trailSamples.filter(s => s.age < 0.16);

        if (emitting && anim.trail) {
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
        this.trailColor.setHex(f.daodanOverpower ? 0xfacc15 : (f.daodanOverdrive ? 0xd946ef : this.accent));
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
