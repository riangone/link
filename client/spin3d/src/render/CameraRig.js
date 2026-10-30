/**
 * Link Spin 3D - Cinematic Dynamic Camera Director
 * Adaptive Multi-Mode Rig with Auto-Fit Arena Framing:
 * - 'topdown': 2.5D Tilt Perspective (Default: Complete arena overview, auto-fitted to any screen ratio)
 * - 'action': Dynamic elevated action cam tracking combatants
 * - 'orbit': 360° Free rotation orbital cam
 */

import * as THREE from '../../vendor/three.module.js';
import { STADIUM_RADIUS } from '../core/Constants.js';

export class CameraRig {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;

        // Default to 'topdown' (2.5D tilt overview) as preferred for optimal full-board visibility
        this.mode = 'topdown';
        this.shakeTrauma = 0;

        // Dynamic targets
        this.targetPos = new THREE.Vector3(0, 110, 32);
        this.lookAtTarget = new THREE.Vector3(0, 0, 4);

        // Orbit Mode State
        this.orbitRadius = 75.0;
        this.orbitTheta = 0.0;
        this.orbitPhi = Math.PI * 0.32;
        this.isDragging = false;
        this.lastPointerX = 0;
        this.lastPointerY = 0;

        this.setupPointerControls();
        this.updateFittedDistance();
        this.setMode('topdown');
    }

    /**
     * Dynamically calculates camera distance and position so that the ENTIRE arena disk
     * (including outer rim, rails, pockets, and decorative LED borders) is 100% visible
     * without any clipping on ANY screen aspect ratio (mobile portrait, tablet, ultrawide desktop).
     *
     * It also accounts for top navigation and bottom controls (joystick, dash button) by
     * centering the arena nicely in the unobstructed playable region!
     */
    updateFittedDistance() {
        const aspect = this.camera.aspect || (window.innerWidth / window.innerHeight) || 1.0;
        const vFovRad = (this.camera.fov * Math.PI) / 180;
        const tanHalfV = Math.tan(vFovRad / 2);
        const tanHalfH = tanHalfV * aspect;

        // Arena bounding radius (stadium bowl 30.0 + outer rim/deck 5.5 + outer LED border + safe clearance)
        const arenaBoundingRadius = STADIUM_RADIUS + 8.5; // ~38.5 units

        // Required distance to fit vertically and horizontally
        const distV = arenaBoundingRadius / tanHalfV;
        const distH = arenaBoundingRadius / tanHalfH;

        // On portrait screens (mobile), width is very narrow so distH dominates.
        // We add generous safety padding (32% on portrait, 24% on landscape) to ensure
        // comfortable breathing room around all outer rims and pockets.
        const isPortrait = aspect < 0.95;
        const paddingMultiplier = isPortrait ? 1.34 : 1.25;
        const fitDist = Math.max(distV, distH) * paddingMultiplier;

        // Natural, comfortable 2.5D tilt angle (~15.5 degrees)
        // Provides full 3D bowl depth while keeping the arena round and completely visible.
        const tiltAngleRad = 0.27; // ~15.5 degrees tilt
        this.topdownHeight = fitDist * Math.cos(tiltAngleRad);
        this.topdownDepth = fitDist * Math.sin(tiltAngleRad);

        // Frame the arena nicely centered in the upper/mid portion of the screen
        // so that the touch joystick, dash buttons, and launch meter at the bottom DO NOT overlap the disk!
        // Moving lookAt in +Z shifts the disk up on screen.
        const verticalCenterOffset = isPortrait ? 6.5 : 4.5;
        this.topdownLookZ = verticalCenterOffset;

        this.orbitRadius = Math.max(70.0, fitDist * 0.95);
    }

    setMode(mode) {
        this.mode = mode;
        this.updateFittedDistance();

        if (mode === 'topdown') {
            this.targetPos.set(0, this.topdownHeight, this.topdownDepth + this.topdownLookZ);
            this.lookAtTarget.set(0, 0, this.topdownLookZ);
        } else if (mode === 'action') {
            const h = Math.max(48.0, this.topdownHeight * 0.62);
            const z = Math.max(36.0, this.topdownDepth * 0.68);
            this.targetPos.set(0, h, z + 2.0);
            this.lookAtTarget.set(0, 0, 0);
        }
    }

    cycleMode() {
        if (this.mode === 'topdown') this.setMode('orbit');
        else if (this.mode === 'orbit') this.setMode('action');
        else this.setMode('topdown');
        return this.mode;
    }

    addTrauma(amount) {
        this.shakeTrauma = Math.min(1.0, this.shakeTrauma + amount);
    }

    setupPointerControls() {
        const onDown = (x, y) => {
            if (this.mode !== 'orbit') return;
            this.isDragging = true;
            this.lastPointerX = x;
            this.lastPointerY = y;
        };

        const onMove = (x, y) => {
            if (!this.isDragging || this.mode !== 'orbit') return;
            const dx = x - this.lastPointerX;
            const dy = y - this.lastPointerY;
            this.lastPointerX = x;
            this.lastPointerY = y;

            this.orbitTheta -= dx * 0.008;
            this.orbitPhi = Math.max(0.1, Math.min(Math.PI * 0.48, this.orbitPhi - dy * 0.008));
        };

        const onUp = () => { this.isDragging = false; };

        this.domElement.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
        window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
        window.addEventListener('mouseup', onUp);

        this.domElement.addEventListener('touchstart', e => {
            if (e.touches.length === 1) onDown(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        window.addEventListener('touchmove', e => {
            if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        window.addEventListener('touchend', onUp);
    }

    update(t1, t2, dt) {
        // Shake Trauma Decay (Quadratic falloff for snappy impact)
        let shakeX = 0, shakeY = 0, shakeZ = 0;
        if (this.shakeTrauma > 0.01) {
            const shake = this.shakeTrauma * this.shakeTrauma * 2.5;
            shakeX = (Math.random() - 0.5) * shake;
            shakeY = (Math.random() - 0.5) * shake;
            shakeZ = (Math.random() - 0.5) * shake;
            this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 3.4);
        }

        if (this.mode === 'topdown') {
            // Adaptive 2.5D Tilt Top-Down Camera: Zero blind spots, entire arena framed
            const desiredX = shakeX;
            const desiredY = this.topdownHeight + shakeY;
            const desiredZ = this.topdownDepth + this.topdownLookZ + shakeZ;

            this.camera.position.set(desiredX, desiredY, desiredZ);
            this.camera.lookAt(0, 0, this.topdownLookZ);

        } else if (this.mode === 'action') {
            // Elevated dynamic action cam tracking top cluster
            const midX = (t1.x + t2.x) * 0.5;
            const midZ = (t1.z + t2.z) * 0.5;
            const separation = Math.hypot(t1.x - t2.x, t1.z - t2.z);

            const dist = (this.topdownDepth * 0.6) + separation * 0.25;
            const height = (this.topdownHeight * 0.58) + separation * 0.2;

            this.targetPos.set(midX * 0.25, height, midZ * 0.25 + dist + 2.0);
            this.lookAtTarget.set(midX * 0.5, 0, midZ * 0.5);

            this.camera.position.lerp(this.targetPos, Math.min(1.0, dt * 4.5));
            this.camera.position.x += shakeX;
            this.camera.position.y += shakeY;
            this.camera.position.z += shakeZ;
            this.camera.lookAt(this.lookAtTarget);

        } else if (this.mode === 'orbit') {
            const x = this.orbitRadius * Math.sin(this.orbitPhi) * Math.sin(this.orbitTheta);
            const y = this.orbitRadius * Math.cos(this.orbitPhi);
            const z = this.orbitRadius * Math.sin(this.orbitPhi) * Math.cos(this.orbitTheta);

            this.camera.position.set(x + shakeX, y + shakeY, z + shakeZ);
            this.camera.lookAt(0, 1.5, 0);
        }
    }
}
