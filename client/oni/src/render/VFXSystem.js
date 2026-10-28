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
