/**
 * Link Spin 3D - Dynamic Action Camera Rig
 * Smart Framing, Impact Trauma Shake, Dynamic FOV & Multi-View Support.
 */

import * as THREE from '../../vendor/three.module.js';

export class DynamicCamera {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;

        this.mode = 'dynamic'; // 'dynamic', 'chase', 'top', 'orbit'
        this.modes = ['dynamic', 'chase', 'top', 'orbit'];

        // Trauma & Shake
        this.trauma = 0;
        this.shakeDecay = 0.92;
        this.shakeOffset = new THREE.Vector3();

        // Smoothed Targets
        this.currentLookAt = new THREE.Vector3(0, 0, 0);
        this.targetLookAt = new THREE.Vector3(0, 0, 0);
        this.targetPos = new THREE.Vector3(0, 36, 44);

        // Orbit mode controls
        this.orbit = {
            isDragging: false,
            prevX: 0,
            prevY: 0,
            yaw: 0,
            pitch: 0.65,
            dist: 55
        };

        this.setupOrbitListeners();
    }

    setupOrbitListeners() {
        const el = this.domElement;
        if (!el) return;

        el.addEventListener('pointerdown', (e) => {
            if (this.mode !== 'orbit') return;
            this.orbit.isDragging = true;
            this.orbit.prevX = e.clientX;
            this.orbit.prevY = e.clientY;
        });

        window.addEventListener('pointermove', (e) => {
            if (!this.orbit.isDragging || this.mode !== 'orbit') return;
            const dx = e.clientX - this.orbit.prevX;
            const dy = e.clientY - this.orbit.prevY;
            this.orbit.prevX = e.clientX;
            this.orbit.prevY = e.clientY;

            this.orbit.yaw -= dx * 0.008;
            this.orbit.pitch = Math.max(0.15, Math.min(Math.PI * 0.48, this.orbit.pitch + dy * 0.008));
        });

        window.addEventListener('pointerup', () => {
            this.orbit.isDragging = false;
        });

        el.addEventListener('wheel', (e) => {
            if (this.mode !== 'orbit') return;
            e.preventDefault();
            this.orbit.dist = Math.max(25, Math.min(95, this.orbit.dist + e.deltaY * 0.05));
        }, { passive: false });
    }

    setMode(newMode) {
        if (this.modes.includes(newMode)) {
            this.mode = newMode;
        }
        return this.mode;
    }

    cycleMode() {
        const nextIdx = (this.modes.indexOf(this.mode) + 1) % this.modes.length;
        this.mode = this.modes[nextIdx];
        return this.mode;
    }

    addTrauma(amount) {
        this.trauma = Math.min(1.0, this.trauma + amount);
    }

    update(t1, t2, isSlowMo = false, dt = 0.016) {
        // Shake Trauma decay
        if (this.trauma > 0.01) {
            const shake = this.trauma * this.trauma;
            const time = performance.now() * 0.04;
            this.shakeOffset.set(
                (Math.sin(time * 1.3) + Math.cos(time * 1.7)) * shake * 1.5,
                (Math.sin(time * 1.9) + Math.cos(time * 1.1)) * shake * 1.2,
                (Math.sin(time * 1.5) + Math.cos(time * 2.1)) * shake * 1.5
            );
            this.trauma *= Math.pow(this.shakeDecay, dt * 60);
        } else {
            this.shakeOffset.set(0, 0, 0);
            this.trauma = 0;
        }

        if (this.mode === 'orbit') {
            const px = Math.sin(this.orbit.yaw) * Math.cos(this.orbit.pitch) * this.orbit.dist;
            const py = Math.sin(this.orbit.pitch) * this.orbit.dist;
            const pz = Math.cos(this.orbit.yaw) * Math.cos(this.orbit.pitch) * this.orbit.dist;

            this.targetPos.set(px, py, pz);
            this.targetLookAt.set(0, 0, 0);
        } else if (this.mode === 'top') {
            // Overhead tactical view
            this.targetPos.set(0, 58, 0.01);
            this.targetLookAt.set(0, 0, 0);
        } else if (this.mode === 'chase' && t1) {
            // Chase camera behind Player 1's top
            const speed = Math.hypot(t1.vx, t1.vz) || 1;
            const dirX = t1.vx / speed;
            const dirZ = t1.vz / speed;

            const chaseDist = 18.0;
            const chaseHeight = 12.0;

            this.targetPos.set(
                t1.x - dirX * chaseDist,
                t1.y + chaseHeight,
                t1.z - dirZ * chaseDist
            );
            this.targetLookAt.set(t1.x + dirX * 6.0, t1.y + 1.0, t1.z + dirZ * 6.0);
        } else {
            // Dynamic Broadcast Camera (Smart framing both tops)
            if (t1 && t2 && t1.status !== 'idle' && t2.status !== 'idle') {
                const midX = (t1.x + t2.x) * 0.5;
                const midY = (t1.y + t2.y) * 0.5;
                const midZ = (t1.z + t2.z) * 0.5;

                const sep = Math.hypot(t1.x - t2.x, t1.z - t2.z);
                const zoomFactor = Math.max(0.65, Math.min(1.4, sep / 28.0));

                const camHeight = 24.0 + zoomFactor * 14.0;
                const camDist = 30.0 + zoomFactor * 18.0;

                this.targetPos.set(midX * 0.4, camHeight, midZ * 0.4 + camDist);
                this.targetLookAt.set(midX, midY + 1.0, midZ);
            } else {
                // Default stadium view
                this.targetPos.set(0, 36, 44);
                this.targetLookAt.set(0, 0, 0);
            }
        }

        // Smooth Lerp Camera Position & Orientation
        const lerpFactor = isSlowMo ? 0.04 : 0.12;
        this.camera.position.lerp(this.targetPos, lerpFactor);
        this.currentLookAt.lerp(this.targetLookAt, lerpFactor);

        // Apply shake offset
        this.camera.position.add(this.shakeOffset);
        this.camera.lookAt(this.currentLookAt);
    }
}
