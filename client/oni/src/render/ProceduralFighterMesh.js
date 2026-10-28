/**
 * ProceduralFighterMesh - Articulated Humanoid Rig & Pose Interpolator
 * Procedurally assembled 3D mesh with hierarchical joints.
 * Implements fluid anime-style combat poses for Oni martial arts.
 */

import * as THREE from '../../vendor/three.module.js';
import { FIGHTER_STATE } from '../core/Constants.js';

export class ProceduralFighterMesh {
    constructor(scene, isP1 = true) {
        this.scene = scene;
        this.isP1 = isP1;

        // Group container
        this.root = new THREE.Group();
        this.scene.add(this.root);

        // Materials with emissive glow for high-tech cyberpunk visibility
        const suitColor = isP1 ? 0x252b42 : 0x1a1c24;
        const armorColor = isP1 ? 0xe2e8f8 : 0x4a526d;
        const accentColor = isP1 ? 0x00f0ff : 0xff0055;
        const skinColor = isP1 ? 0xffdfc4 : 0x363044;
        const hairColor = isP1 ? 0xaa55ff : 0x12141c; // Konoko's iconic glowing purple hair

        this.matSuit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.5 });
        this.matArmor = new THREE.MeshStandardMaterial({
            color: armorColor,
            roughness: 0.2,
            metalness: 0.6,
            emissive: armorColor,
            emissiveIntensity: 0.08
        });
        this.matAccent = new THREE.MeshStandardMaterial({
            color: accentColor,
            emissive: accentColor,
            emissiveIntensity: 1.6,
            roughness: 0.2
        });
        this.matSkin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
        this.matHair = new THREE.MeshStandardMaterial({
            color: hairColor,
            roughness: 0.4,
            emissive: isP1 ? 0x5a1b9a : 0x000000,
            emissiveIntensity: 0.25
        });

        this.buildRig();

        // Cyberpunk Ground Shadow & Stance Ring (Sharp ground grounding)
        const ringGeo = new THREE.RingGeometry(0.25, 0.48, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: accentColor,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide
        });
        this.groundRing = new THREE.Mesh(ringGeo, ringMat);
        this.groundRing.rotation.x = -Math.PI / 2;
        this.groundRing.position.y = 0.02;
        this.root.add(this.groundRing);
    }

    buildRig() {
        // Pelvis (root of body)
        this.pelvis = new THREE.Group();
        this.pelvis.position.y = 0.95;
        this.root.add(this.pelvis);

        const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.24), this.matArmor);
        pelvisMesh.castShadow = true;
        this.pelvis.add(pelvisMesh);

        // Torso & Chest
        this.torso = new THREE.Group();
        this.torso.position.y = 0.12;
        this.pelvis.add(this.torso);

        const chestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.26), this.matArmor);
        chestMesh.position.y = 0.22;
        chestMesh.castShadow = true;
        this.torso.add(chestMesh);

        // Glowing cyber logo / core on chest
        const coreMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), this.matAccent);
        coreMesh.position.set(0, 0.25, 0.14);
        this.torso.add(coreMesh);

        // Head & Hair
        this.head = new THREE.Group();
        this.head.position.y = 0.48;
        this.torso.add(this.head);

        const faceMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), this.matSkin);
        faceMesh.position.y = 0.14;
        faceMesh.castShadow = true;
        this.head.add(faceMesh);

        // Hair (Konoko anime bob / cyber helmet)
        const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.28), this.matHair);
        hairTop.position.set(0, 0.25, -0.02);
        this.head.add(hairTop);

        const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.10), this.matHair);
        hairBack.position.set(0, 0.14, -0.12);
        this.head.add(hairBack);

        // Visor / Eyes
        const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.05, 0.04), this.matAccent);
        visorMesh.position.set(0, 0.16, 0.13);
        this.head.add(visorMesh);

        // Left Arm
        this.leftShoulder = new THREE.Group();
        this.leftShoulder.position.set(0.26, 0.32, 0);
        this.torso.add(this.leftShoulder);

        const leftUpper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.12), this.matSuit);
        leftUpper.position.y = -0.14;
        this.leftShoulder.add(leftUpper);

        this.leftElbow = new THREE.Group();
        this.leftElbow.position.y = -0.28;
        this.leftShoulder.add(this.leftElbow);

        const leftFore = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.11), this.matArmor);
        leftFore.position.y = -0.13;
        this.leftElbow.add(leftFore);

        this.leftFist = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), this.matAccent);
        this.leftFist.position.y = -0.28;
        this.leftElbow.add(this.leftFist);

        // Right Arm
        this.rightShoulder = new THREE.Group();
        this.rightShoulder.position.set(-0.26, 0.32, 0);
        this.torso.add(this.rightShoulder);

        const rightUpper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.12), this.matSuit);
        rightUpper.position.y = -0.14;
        this.rightShoulder.add(rightUpper);

        this.rightElbow = new THREE.Group();
        this.rightElbow.position.y = -0.28;
        this.rightShoulder.add(this.rightElbow);

        const rightFore = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.11), this.matArmor);
        rightFore.position.y = -0.13;
        this.rightElbow.add(rightFore);

        this.rightFist = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), this.matAccent);
        this.rightFist.position.y = -0.28;
        this.rightElbow.add(this.rightFist);

        // Left Leg
        this.leftHip = new THREE.Group();
        this.leftHip.position.set(0.12, -0.1, 0);
        this.pelvis.add(this.leftHip);

        const leftThigh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.14), this.matSuit);
        leftThigh.position.y = -0.18;
        this.leftHip.add(leftThigh);

        this.leftKnee = new THREE.Group();
        this.leftKnee.position.y = -0.36;
        this.leftHip.add(this.leftKnee);

        const leftShin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.13), this.matArmor);
        leftShin.position.y = -0.18;
        this.leftKnee.add(leftShin);

        const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.24), this.matArmor);
        leftFoot.position.set(0, -0.38, 0.05);
        this.leftKnee.add(leftFoot);

        // Right Leg
        this.rightHip = new THREE.Group();
        this.rightHip.position.set(-0.12, -0.1, 0);
        this.pelvis.add(this.rightHip);

        const rightThigh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.14), this.matSuit);
        rightThigh.position.y = -0.18;
        this.rightHip.add(rightThigh);

        this.rightKnee = new THREE.Group();
        this.rightKnee.position.y = -0.36;
        this.rightHip.add(this.rightKnee);

        const rightShin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.13), this.matArmor);
        rightShin.position.y = -0.18;
        this.rightKnee.add(rightShin);

        const rightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.24), this.matArmor);
        rightFoot.position.set(0, -0.38, 0.05);
        this.rightKnee.add(rightFoot);
    }

    /**
     * Animate joints to match simulation state
     */
    update(fighter, timeSeconds) {
        // Position
        this.root.position.set(fighter.x, fighter.y, fighter.z);

        // Facing orientation: rotate Y to face right (Math.PI/2) or left (-Math.PI/2)
        const targetRotY = fighter.facing === 1 ? Math.PI * 0.45 : -Math.PI * 0.45;
        this.root.rotation.y = targetRotY;

        // Reset base transforms
        this.pelvis.position.y = 0.95;
        this.pelvis.rotation.set(0, 0, 0);
        this.torso.rotation.set(0, 0, 0);
        this.head.rotation.set(0, 0, 0);
        this.leftShoulder.rotation.set(0, 0, 0);
        this.rightShoulder.rotation.set(0, 0, 0);
        this.leftElbow.rotation.set(0, 0, 0);
        this.rightElbow.rotation.set(0, 0, 0);
        this.leftHip.rotation.set(0, 0, 0);
        this.rightHip.rotation.set(0, 0, 0);
        this.leftKnee.rotation.set(0, 0, 0);
        this.rightKnee.rotation.set(0, 0, 0);

        const state = fighter.state;
        const timer = fighter.stateTimer;
        const move = fighter.currentMove;

        if (state === FIGHTER_STATE.IDLE) {
            // Breathing bounce
            const breath = Math.sin(timeSeconds * 5.0) * 0.04;
            this.pelvis.position.y = 0.95 + breath;
            this.torso.rotation.x = breath * 0.5;

            // Combat guard arms
            this.leftShoulder.rotation.x = 0.8;
            this.leftShoulder.rotation.z = -0.3;
            this.leftElbow.rotation.x = -1.4;

            this.rightShoulder.rotation.x = 0.7;
            this.rightShoulder.rotation.z = 0.3;
            this.rightElbow.rotation.x = -1.3;

            // Stance feet
            this.leftHip.rotation.x = 0.2;
            this.rightHip.rotation.x = -0.2;
        } else if (state === FIGHTER_STATE.WALK) {
            const walkCycle = timeSeconds * 10.0;
            const swing = Math.sin(walkCycle) * 0.5;

            this.leftHip.rotation.x = swing;
            this.rightHip.rotation.x = -swing;
            this.leftKnee.rotation.x = swing > 0 ? swing * 0.8 : 0;
            this.rightKnee.rotation.x = -swing > 0 ? -swing * 0.8 : 0;

            this.leftShoulder.rotation.x = -swing * 0.7 + 0.4;
            this.rightShoulder.rotation.x = swing * 0.7 + 0.4;
        } else if (state === FIGHTER_STATE.RUN) {
            const runCycle = timeSeconds * 16.0;
            const swing = Math.sin(runCycle) * 0.85;

            this.torso.rotation.x = 0.35; // forward sprint lean
            this.pelvis.position.y = 0.88 + Math.abs(Math.sin(runCycle)) * 0.06;

            this.leftHip.rotation.x = swing;
            this.rightHip.rotation.x = -swing;
            this.leftKnee.rotation.x = swing > 0 ? swing * 1.2 : 0.1;
            this.rightKnee.rotation.x = -swing > 0 ? -swing * 1.2 : 0.1;

            this.leftShoulder.rotation.x = -swing * 1.0;
            this.rightShoulder.rotation.x = swing * 1.0;
            this.leftElbow.rotation.x = -1.2;
            this.rightElbow.rotation.x = -1.2;
        } else if (state === FIGHTER_STATE.ATTACK && move) {
            const total = move.startup + move.active + move.recovery;
            const progress = Math.min(1.0, timer / total);

            if (move.id === 'PUNCH_1') {
                // Snappy jab (Right arm extension)
                const punchExt = Math.sin(progress * Math.PI);
                this.rightShoulder.rotation.x = 1.57 * punchExt;
                this.rightElbow.rotation.x = -0.2 * (1 - punchExt);
                this.torso.rotation.y = 0.3 * punchExt;

                // Left guard
                this.leftShoulder.rotation.x = 0.9;
                this.leftElbow.rotation.x = -1.5;
            } else if (move.id === 'PUNCH_2') {
                // Deep Cross (Left arm heavy punch)
                const punchExt = Math.sin(progress * Math.PI);
                this.leftShoulder.rotation.x = 1.6 * punchExt;
                this.leftElbow.rotation.x = -0.1 * (1 - punchExt);
                this.torso.rotation.y = -0.6 * punchExt;
                this.torso.rotation.x = 0.2 * punchExt;
            } else if (move.id === 'UPPERCUT') {
                // Rising Uppercut scoop
                if (timer < move.startup) {
                    // Scoop windup
                    this.pelvis.position.y = 0.75;
                    this.torso.rotation.x = 0.4;
                    this.rightShoulder.rotation.x = -0.5;
                } else {
                    // Skyward thrust
                    this.pelvis.position.y = 1.1;
                    this.torso.rotation.x = -0.2;
                    this.rightShoulder.rotation.x = 2.8;
                    this.rightElbow.rotation.x = 0;
                    this.leftHip.rotation.x = 0.4;
                }
            } else if (move.id === 'KICK_LOW') {
                // Low kick snap
                const kickExt = Math.sin(progress * Math.PI);
                this.rightHip.rotation.x = 1.2 * kickExt;
                this.rightKnee.rotation.x = 0.2;
                this.torso.rotation.x = -0.2 * kickExt;
            } else if (move.id === 'KICK_HEAVY') {
                // Roundhouse 360 spin
                this.root.rotation.y += progress * Math.PI * 2;
                this.rightHip.rotation.x = 1.6;
                this.rightHip.rotation.z = -0.5;
                this.torso.rotation.z = 0.3;
            } else if (move.id === 'SLIDE_KICK') {
                // Slide Sweep (low horizontal body)
                this.pelvis.position.y = 0.35;
                this.torso.rotation.x = -1.1;
                this.rightHip.rotation.x = 1.4;
                this.leftHip.rotation.x = -1.2;
            }
        } else if (state === FIGHTER_STATE.BLOCK) {
            // Guard stance
            this.torso.rotation.x = -0.15;
            this.leftShoulder.rotation.x = 1.4;
            this.leftShoulder.rotation.z = -0.5;
            this.leftElbow.rotation.x = -1.8;
            this.rightShoulder.rotation.x = 1.3;
            this.rightShoulder.rotation.z = 0.5;
            this.rightElbow.rotation.x = -1.8;
        } else if (state === FIGHTER_STATE.HIT_STUN) {
            // Recoil back
            this.pelvis.position.y = 0.92;
            this.torso.rotation.x = -0.5;
            this.head.rotation.x = -0.4;
            this.leftShoulder.rotation.x = -0.4;
            this.rightShoulder.rotation.x = -0.4;
        } else if (state === FIGHTER_STATE.KNOCKED_DOWN) {
            // Ground sprawl
            this.pelvis.position.y = 0.2;
            this.torso.rotation.x = -1.55;
            this.head.rotation.x = -0.2;
            this.leftHip.rotation.x = 0.2;
            this.rightHip.rotation.x = -0.2;
        } else if (state === FIGHTER_STATE.WAKEUP) {
            // Rolling up
            const t = Math.min(1.0, timer / 22.0);
            this.pelvis.position.y = 0.2 + 0.75 * t;
            this.torso.rotation.x = -1.55 * (1 - t);
        } else if (state === FIGHTER_STATE.VICTORY) {
            // Victory stance: Fist raised
            this.rightShoulder.rotation.x = 2.9;
            this.head.rotation.x = -0.2;
        }
    }

    destroy() {
        this.scene.remove(this.root);
    }
}
