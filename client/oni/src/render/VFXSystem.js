/**
 * VFXSystem - Combat Sparks, Shockwaves & Web Audio Sound Synthesizer
 * Zero-asset impact audio and procedural particle effects.
 */

import * as THREE from '../../vendor/three.module.js';

export class VFXSystem {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this.rings = [];
        this.beams = [];
        this.weaponMeshes = new Map();
        this.projectileMeshes = new Map();
        this.interactableMeshes = new Map();

        // Audio Context (Synthesized sound effects)
        this.audioCtx = null;
        this.initAudio();
    }

    initAudio() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            const unlock = () => {
                if (!this.audioCtx) {
                    this.audioCtx = new AudioContext();
                }
                if (this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }
                window.removeEventListener('keydown', unlock);
                window.removeEventListener('pointerdown', unlock);
            };
            window.addEventListener('keydown', unlock, { once: true });
            window.addEventListener('pointerdown', unlock, { once: true });
        }
    }

    /**
     * Spawn 3D electric hitspark particles
     */
    spawnHitSpark(x, y, z, isBlocked = false, count = 18) {
        const color = isBlocked ? 0xffcc00 : 0x00f0ff;
        const geom = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = [];

        for (let i = 0; i < count; i++) {
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            const speed = 3.0 + Math.random() * 5.0;
            const theta = Math.random() * Math.PI * 2;
            const phi = (Math.random() - 0.5) * Math.PI;

            velocities.push({
                vx: Math.cos(theta) * Math.cos(phi) * speed,
                vy: Math.sin(phi) * speed + 1.5,
                vz: Math.sin(theta) * Math.cos(phi) * speed
            });
        }

        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: color,
            size: 0.12,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending
        });

        const points = new THREE.Points(geom, mat);
        this.scene.add(points);

        this.particles.push({
            points,
            geom,
            mat,
            velocities,
            life: 0.28,
            maxLife: 0.28
        });

        // Sound trigger
        if (isBlocked) {
            this.playBlockSound();
        } else {
            this.playHitSound();
        }
    }

    /**
     * Spawn expanding shockwave ring
     */
    spawnShockwave(x, y, z, colorHex = 0x00f0ff) {
        const ringGeo = new THREE.RingGeometry(0.1, 0.25, 24);
        const ringMat = new THREE.MeshBasicMaterial({
            color: colorHex,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending
        });
        const mesh = new THREE.Mesh(ringGeo, ringMat);
        mesh.position.set(x, y, z);
        mesh.rotation.x = -Math.PI / 2;
        this.scene.add(mesh);

        this.rings.push({
            mesh,
            scale: 0.5,
            opacity: 1.0
        });

        this.playHeavyImpactSound();
    }

    /**
     * Spawn muzzle flash & ballistic tracer / piercing energy beam
     */
    spawnTracerBeam(muzzle, endPoint, colorHex = 0x00f0ff, isHeavyBeam = false) {
        const start = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
        const end = new THREE.Vector3(endPoint.x, endPoint.y, endPoint.z);
        const dist = start.distanceTo(end);
        if (dist < 0.05) return;

        const radius = isHeavyBeam ? 0.065 : 0.025;
        const geo = new THREE.CylinderGeometry(radius, radius, dist, 8);
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(start).lerp(end, 0.5);
        mesh.lookAt(end);
        this.scene.add(mesh);

        this.beams.push({
            mesh,
            life: isHeavyBeam ? 0.25 : 0.12,
            maxLife: isHeavyBeam ? 0.25 : 0.12
        });

        this.spawnHitSpark(muzzle.x, muzzle.y, muzzle.z, false, 8);
        this.playGunshotSound(isHeavyBeam);
    }

    /**
     * Build authentic Oni (2001) 3D weapon model for arena drops / flying disarmed weapons
     */
    buildArenaWeaponModel(w) {
        const group = new THREE.Group();
        const darkMetal = new THREE.MeshToonMaterial({ color: 0x222634 });
        const slateMetal = new THREE.MeshToonMaterial({ color: 0x3b4358 });
        const silverChrome = new THREE.MeshToonMaterial({ color: 0x94a3b8 });
        const glowMat = new THREE.MeshBasicMaterial({ color: w.color || 0x00f0ff });

        const wType = w.type || 'TCTF_PISTOL';
        const gunRoot = new THREE.Group();

        if (wType === 'SCRAM_CANNON') {
            // SML3 Scram Cannon — Multi-barrel rotary micro-missile launcher pod
            const housing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.44), darkMetal);
            const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.40, 8), slateMetal);
            pod.rotation.x = Math.PI / 2;
            pod.position.set(0, 0.02, 0.05);
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), darkMetal);
            grip.position.set(0, -0.09, -0.08);
            grip.rotation.x = -0.25;
            const vent = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.28), glowMat);
            vent.position.set(0, 0.02, 0.02);
            gunRoot.add(housing, pod, grip, vent);
            for (let k = 0; k < 3; k++) {
                const ang = (k * Math.PI * 2) / 3 + Math.PI / 6;
                const tx = Math.cos(ang) * 0.036;
                const ty = 0.02 + Math.sin(ang) * 0.036;
                const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), silverChrome);
                tube.rotation.x = Math.PI / 2;
                tube.position.set(tx, ty, 0.26);
                const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.045, 8), glowMat);
                warhead.rotation.x = Math.PI / 2;
                warhead.position.set(tx, ty, 0.33);
                gunRoot.add(tube, warhead);
            }
        } else if (wType === 'MERCURY_BOW') {
            // Syndicate Mercury Bow — Long rail-sniper with twin curved crossbow limbs & glowing mercury core
            const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.10, 0.28), darkMetal);
            stock.position.set(0, -0.01, -0.22);
            const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.095, 0.46), slateMetal);
            receiver.position.set(0, 0.01, 0.06);
            const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.78, 10), silverChrome);
            rail.rotation.x = Math.PI / 2;
            rail.position.set(0, 0.02, 0.24);
            const core = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.56, 8), glowMat);
            core.rotation.x = Math.PI / 2;
            core.position.set(0, -0.01, 0.16);
            const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 10), darkMetal);
            scope.rotation.x = Math.PI / 2;
            scope.position.set(0, 0.075, 0.02);
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.065), darkMetal);
            grip.position.set(0, -0.08, -0.06);
            grip.rotation.x = -0.25;
            for (const s of [-1, 1]) {
                const limb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.045), silverChrome);
                limb.position.set(s * 0.14, 0.015, 0.22);
                limb.rotation.y = -s * 0.38;
                const arc = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.018), glowMat);
                arc.position.set(s * 0.14, 0.015, 0.19);
                arc.rotation.y = -s * 0.38;
                gunRoot.add(limb, arc);
            }
            gunRoot.add(stock, receiver, rail, core, scope, grip);
        } else {
            // Campbell Equalizer Mk4 (TCTF Pistol) — Heavy tactical bullpup pistol with underbarrel laser
            const slide = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.078, 0.34), slateMetal);
            slide.position.set(0, 0.03, 0.02);
            const frame = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.048, 0.28), darkMetal);
            frame.position.set(0, -0.01, 0.01);
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.10, 10), silverChrome);
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set(0, 0.035, 0.21);
            const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.14, 0.068), darkMetal);
            grip.position.set(0, -0.08, -0.08);
            grip.rotation.x = -0.24;
            const laser = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.032, 0.14), darkMetal);
            laser.position.set(0, -0.025, 0.09);
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.022, 0.22), glowMat);
            strip.position.set(0, 0.03, 0.04);
            gunRoot.add(slide, frame, barrel, grip, laser, strip);
        }

        const haloRing = new THREE.Mesh(
            new THREE.RingGeometry(0.30, 0.36, 28),
            new THREE.MeshBasicMaterial({
                color: w.color || 0x00f0ff,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.72,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        haloRing.rotation.x = -Math.PI / 2;
        haloRing.position.y = -0.11;

        group.add(gunRoot, haloRing);
        group.userData = { gunRoot, glowMat, haloRing };
        return group;
    }

    /**
     * Synchronize 3D meshes for dropped/flying weapons and active homing projectiles in Simulation
     */
    syncEntities(sim) {
        if (!sim) return;

        // 1. Dropped / Spinning Weapons
        const weapons = sim.getWeapons ? sim.getWeapons() : [];
        const activeWpnIds = new Set();
        for (let i = 0; i < weapons.length; i++) {
            const w = weapons[i];
            activeWpnIds.add(w.id);
            let group = this.weaponMeshes.get(w.id);
            if (!group) {
                group = this.buildArenaWeaponModel(w);
                this.scene.add(group);
                this.weaponMeshes.set(w.id, group);
            }
            group.position.set(w.x, w.y + (w.isGrounded ? 0.09 : 0), w.z);
            if (group.userData.gunRoot) {
                group.userData.gunRoot.rotation.set(w.spinPitch || 0, w.spinYaw || 0, w.isGrounded ? 0.28 : 0.85);
            }
            if (group.userData.haloRing) {
                group.userData.haloRing.visible = w.isGrounded && w.ammo > 0;
            }
        }
        for (const [id, mesh] of this.weaponMeshes.entries()) {
            if (!activeWpnIds.has(id)) {
                this.scene.remove(mesh);
                this.weaponMeshes.delete(id);
            }
        }

        // 2. Active Projectiles (Scram Cannon Homing Micro-Missiles with fins & thruster core)
        const projectiles = sim.getProjectiles ? sim.getProjectiles() : [];
        const activeProjIds = new Set();
        for (let i = 0; i < projectiles.length; i++) {
            const p = projectiles[i];
            activeProjIds.add(p.id);
            let mesh = this.projectileMeshes.get(p.id);
            if (!mesh) {
                mesh = new THREE.Group();
                const rocketBody = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.032, 0.042, 0.22, 8),
                    new THREE.MeshToonMaterial({ color: 0x334155 })
                );
                rocketBody.rotation.x = Math.PI / 2;
                const warhead = new THREE.Mesh(
                    new THREE.ConeGeometry(0.035, 0.09, 8),
                    new THREE.MeshBasicMaterial({ color: p.color || 0xff9900 })
                );
                warhead.rotation.x = Math.PI / 2;
                warhead.position.z = 0.15;
                const thruster = new THREE.Mesh(
                    new THREE.SphereGeometry(0.065, 8, 8),
                    new THREE.MeshBasicMaterial({
                        color: 0xffcc33,
                        blending: THREE.AdditiveBlending
                    })
                );
                thruster.position.z = -0.12;
                mesh.add(rocketBody, warhead, thruster);
                this.scene.add(mesh);
                this.projectileMeshes.set(p.id, mesh);
            }
            mesh.position.set(p.x, p.y, p.z);
            if (Math.hypot(p.vx, p.vy, p.vz) > 0.1) {
                mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
            }
        }
        for (const [id, mesh] of this.projectileMeshes.entries()) {
            if (!activeProjIds.has(id)) {
                this.scene.remove(mesh);
                this.projectileMeshes.delete(id);
            }
        }
    }

    /**
     * Build 3D stage interactables for RPG Story Campaign (Consoles, Medkit Crates, Weapon Crates, Shield Cells, Security Gate)
     */
    buildInteractableModel(item) {
        const group = new THREE.Group();
        const darkSteel = new THREE.MeshToonMaterial({ color: 0x242a38 });
        const slateSteel = new THREE.MeshToonMaterial({ color: 0x3b4459 });

        if (item.type === 'CONSOLE') {
            // Oni Tactical Data Terminal Kiosk (slanted pedestal + glowing screen)
            const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.92, 0.34), darkSteel);
            pedestal.position.y = 0.46;
            const hood = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 0.38), slateSteel);
            hood.position.set(0, 1.0, 0);
            hood.rotation.x = 0.35;
            const screenMat = new THREE.MeshBasicMaterial({ color: item.hacked ? 0x00ff88 : 0x00f0ff });
            const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.24), screenMat);
            screen.position.set(0, 1.04, 0.195);
            screen.rotation.x = -0.35;
            const beacon = new THREE.Mesh(
                new THREE.RingGeometry(0.38, 0.46, 24),
                new THREE.MeshBasicMaterial({
                    color: item.hacked ? 0x00ff88 : 0x00f0ff,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.75
                })
            );
            beacon.rotation.x = -Math.PI / 2;
            beacon.position.y = 0.02;
            group.add(pedestal, hood, screen, beacon);
            group.userData = { screenMat, beacon };
        } else if (item.type === 'SECURITY_GATE') {
            // Security Laser Barrier Pillars + Energy Bars
            const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.7, 10), darkSteel);
            postL.position.set(0, 0.85, -1.6);
            const postR = postL.clone();
            postR.position.set(0, 0.85, 1.6);
            const laserGroup = new THREE.Group();
            const laserMat = new THREE.MeshBasicMaterial({
                color: 0xff2255,
                transparent: true,
                opacity: 0.85
            });
            for (let k = 0; k < 3; k++) {
                const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.2, 8), laserMat);
                bar.rotation.x = Math.PI / 2;
                bar.position.set(0, 0.4 + k * 0.45, 0);
                laserGroup.add(bar);
            }
            group.add(postL, postR, laserGroup);
            group.userData = { laserGroup, laserMat };
        } else if (item.type === 'MEDKIT_CRATE') {
            // Hypo-Spray Medical Supply Crate (emerald cross glow)
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.36), slateSteel);
            box.position.y = 0.19;
            const crossMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
            const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.08), crossMat);
            c1.position.set(0, 0.37, 0);
            const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.22), crossMat);
            c2.position.set(0, 0.37, 0);
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.32, 0.38, 20),
                new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.02;
            group.add(box, c1, c2, ring);
            group.userData = { floatMesh: box };
        } else if (item.type === 'SHIELD_CELL') {
            // Daodan Resonance Crystal / Nano-Shield Cell
            const crystalMat = new THREE.MeshBasicMaterial({ color: 0xd946ef });
            const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), crystalMat);
            crystal.position.y = 0.48;
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.28, 0.35, 20),
                new THREE.MeshBasicMaterial({ color: 0xd946ef, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.02;
            group.add(crystal, ring);
            group.userData = { crystal };
        } else {
            // WEAPON_CRATE (amber ordnance locker)
            const crate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.42), darkSteel);
            crate.position.y = 0.18;
            const trim = new THREE.Mesh(
                new THREE.BoxGeometry(0.64, 0.05, 0.44),
                new THREE.MeshBasicMaterial({ color: 0xffaa00 })
            );
            trim.position.y = 0.33;
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.38, 0.44, 24),
                new THREE.MeshBasicMaterial({ color: 0xffaa00, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.02;
            group.add(crate, trim, ring);
        }

        return group;
    }

    /**
     * Synchronize 3D Campaign Interactables (Consoles, Crates, Security Gate)
     */
    syncInteractables(campaign, timeSec = 0) {
        const list = (campaign && Array.isArray(campaign.interactables)) ? campaign.interactables : [];
        const activeIds = new Set();

        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (!item.active) continue;
            activeIds.add(item.id);

            let mesh = this.interactableMeshes.get(item.id);
            if (!mesh) {
                mesh = this.buildInteractableModel(item);
                this.scene.add(mesh);
                this.interactableMeshes.set(item.id, mesh);
            }
            mesh.position.set(item.x, item.y || 0, item.z);

            if (item.type === 'CONSOLE' && mesh.userData.screenMat) {
                const col = item.hacked ? 0x00ff88 : 0x00f0ff;
                mesh.userData.screenMat.color.setHex(col);
                mesh.userData.beacon.material.color.setHex(col);
            } else if (item.type === 'SECURITY_GATE' && mesh.userData.laserGroup) {
                mesh.userData.laserGroup.visible = !item.unlocked;
            } else if (item.type === 'SHIELD_CELL' && mesh.userData.crystal) {
                mesh.userData.crystal.rotation.y = timeSec * 2.4;
                mesh.userData.crystal.position.y = 0.48 + Math.sin(timeSec * 3.5) * 0.07;
            }
        }

        for (const [id, mesh] of this.interactableMeshes.entries()) {
            if (!activeIds.has(id)) {
                this.scene.remove(mesh);
                this.interactableMeshes.delete(id);
            }
        }
    }

    update(dt) {
        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                this.scene.remove(p.points);
                p.geom.dispose();
                p.mat.dispose();
                this.particles.splice(i, 1);
                continue;
            }

            const positions = p.geom.attributes.position.array;
            for (let j = 0; j < p.velocities.length; j++) {
                positions[j * 3] += p.velocities[j].vx * dt;
                positions[j * 3 + 1] += p.velocities[j].vy * dt;
                positions[j * 3 + 2] += p.velocities[j].vz * dt;
                p.velocities[j].vy -= 9.8 * dt; // gravity on sparks
            }
            p.geom.attributes.position.needsUpdate = true;
            p.mat.opacity = p.life / p.maxLife;
        }

        // Update shockwave rings
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const r = this.rings[i];
            r.scale += dt * 8.0;
            r.opacity -= dt * 3.5;
            r.mesh.scale.set(r.scale, r.scale, r.scale);
            r.mesh.material.opacity = Math.max(0, r.opacity);

            if (r.opacity <= 0) {
                this.scene.remove(r.mesh);
                r.mesh.geometry.dispose();
                r.mesh.material.dispose();
                this.rings.splice(i, 1);
            }
        }

        // Update tracer beams
        for (let i = this.beams.length - 1; i >= 0; i--) {
            const b = this.beams[i];
            b.life -= dt;
            if (b.life <= 0) {
                this.scene.remove(b.mesh);
                b.mesh.geometry.dispose();
                b.mesh.material.dispose();
                this.beams.splice(i, 1);
                continue;
            }
            b.mesh.material.opacity = Math.max(0, b.life / b.maxLife);
        }
    }

    playGunshotSound(isHeavy = false) {
        if (!this.audioCtx) return;
        try {
            const ctx = this.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = isHeavy ? 'sawtooth' : 'square';
            osc.frequency.setValueAtTime(isHeavy ? 620 : 880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(isHeavy ? 60 : 120, ctx.currentTime + (isHeavy ? 0.22 : 0.09));

            gain.gain.setValueAtTime(0.32, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (isHeavy ? 0.22 : 0.09));

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + (isHeavy ? 0.22 : 0.09));
        } catch (e) {}
    }

    // Audio Synthesizers (Zero file downloads)
    playHitSound() {
        if (!this.audioCtx) return;
        try {
            const ctx = this.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(140, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.12);

            gain.gain.setValueAtTime(0.4, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + 0.12);
        } catch (e) {}
    }

    playBlockSound() {
        if (!this.audioCtx) return;
        try {
            const ctx = this.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'square';
            osc.frequency.setValueAtTime(480, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.08);

            gain.gain.setValueAtTime(0.25, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + 0.08);
        } catch (e) {}
    }

    playHeavyImpactSound() {
        if (!this.audioCtx) return;
        try {
            const ctx = this.audioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(90, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.3);

            gain.gain.setValueAtTime(0.5, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) {}
    }
}
