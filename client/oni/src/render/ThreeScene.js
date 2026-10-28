/**
 * ThreeScene - Three.js WebGL Viewport Adapter
 * Manages lighting, cyberpunk stage geometry, dynamic fighting camera, and screen shake.
 */

import * as THREE from '../../vendor/three.module.js';

export class ThreeScene {
    constructor(canvasContainer) {
        this.container = canvasContainer;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0c16);
        this.scene.fog = new THREE.FogExp2(0x0a0c16, 0.025);

        // Camera (Tuned for Golden Ratio 3D Fighter Framing)
        this.camera = new THREE.PerspectiveCamera(
            38,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            100
        );
        this.camera.position.set(0, 1.8, 6.5);

        // Camera dynamics & shake
        this.cameraTarget = new THREE.Vector3(0, 1.05, 0);
        this.shakeIntensity = 0;
        this.shakeDecay = 0.9;

        // Setup Stage & Lights
        this.setupLights();
        this.setupStage();

        // Resize Listener
        window.addEventListener('resize', () => this.onResize());
    }

    setupLights() {
        // High-ambient base to avoid black mud shadows
        const ambient = new THREE.AmbientLight(0x455278, 2.2);
        this.scene.add(ambient);

        // Key Light (Sun / Stadium overhead)
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
        keyLight.position.set(4, 10, 7);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 1024;
        keyLight.shadow.mapSize.height = 1024;
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 28;
        keyLight.shadow.camera.left = -12;
        keyLight.shadow.camera.right = 12;
        keyLight.shadow.camera.top = 8;
        keyLight.shadow.camera.bottom = -3;
        this.scene.add(keyLight);

        // Cyberpunk Rim Light (Neon Cyan for P1 silhouette)
        const rimCyan = new THREE.DirectionalLight(0x00f0ff, 4.2);
        rimCyan.position.set(-7, 4.5, -4.5);
        this.scene.add(rimCyan);

        // Accent Light (Magenta for P2 silhouette)
        const rimMagenta = new THREE.DirectionalLight(0xff0066, 3.8);
        rimMagenta.position.set(7, 5, -4.5);
        this.scene.add(rimMagenta);

        // Upward arena glow (Cyber ground reflection)
        const groundGlow = new THREE.DirectionalLight(0x0088ff, 1.2);
        groundGlow.position.set(0, -5, 2);
        this.scene.add(groundGlow);
    }

    setupStage() {
        // Arena Floor (Hex/Grid Cyber Platform)
        const floorGeo = new THREE.PlaneGeometry(36, 18);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x14182b,
            roughness: 0.2,
            metalness: 0.85
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Floor Grid Lines
        const grid = new THREE.GridHelper(36, 36, 0x00f0ff, 0x223055);
        grid.position.y = 0.01;
        this.scene.add(grid);

        // Central Combat Octagon Ring
        const ringMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 });
        const ringPoints = [];
        const segs = 16;
        const radius = 5.2;
        for (let i = 0; i <= segs; i++) {
            const theta = (i / segs) * Math.PI * 2;
            ringPoints.push(new THREE.Vector3(Math.cos(theta) * radius, 0.02, Math.sin(theta) * radius));
        }
        const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
        const arenaRing = new THREE.Line(ringGeo, ringMat);
        this.scene.add(arenaRing);

        // Neon Arena Outer Boundary Lines
        const lineMat = new THREE.LineBasicMaterial({ color: 0xff0077, linewidth: 2 });
        const points = [
            new THREE.Vector3(-14, 0.02, -5.5),
            new THREE.Vector3(14, 0.02, -5.5),
            new THREE.Vector3(14, 0.02, 5.5),
            new THREE.Vector3(-14, 0.02, 5.5),
            new THREE.Vector3(-14, 0.02, -5.5)
        ];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const boundaryLine = new THREE.Line(lineGeo, lineMat);
        this.scene.add(boundaryLine);

        // Background Cyber City Pillars / Skyscrapers
        const bldgMat = new THREE.MeshStandardMaterial({ color: 0x090c18, roughness: 0.7 });
        const windowMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

        for (let i = -10; i <= 10; i++) {
            if (Math.abs(i) < 2) continue;
            const w = 2.5 + Math.random() * 2;
            const d = 2.5 + Math.random() * 2;
            const h = 10 + Math.random() * 24;
            const bldg = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bldgMat);
            bldg.position.set(i * 3.5 + (Math.random() - 0.5) * 2, h / 2 - 2, -14 - Math.random() * 12);
            this.scene.add(bldg);

            // Glowing holo accents
            if (Math.random() > 0.4) {
                const strip = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.4), windowMat);
                strip.position.set(bldg.position.x, bldg.position.y + (Math.random() - 0.5) * h * 0.6, bldg.position.z + d / 2 + 0.05);
                this.scene.add(strip);
            }
        }
    }

    /**
     * Trigger camera trauma / shake on heavy hits
     */
    addTrauma(intensity = 0.3) {
        this.shakeIntensity = Math.min(0.8, this.shakeIntensity + intensity);
    }

    /**
     * Update camera position dynamically based on both fighters
     * Tight framing keeps both fighters large, focused, and centered.
     */
    updateCamera(f1, f2, isPreview = false, timeSeconds = 0) {
        // Midpoint
        const midX = (f1.x + f2.x) * 0.5;
        const midY = (f1.y + f2.y) * 0.5;
        const dist = Math.abs(f1.x - f2.x);

        // Dynamic close framing (fighters occupy ~45% screen height)
        const targetZ = Math.max(5.2, Math.min(9.2, 4.2 + dist * 0.48));
        const targetX = midX * 0.85;
        const targetY = 1.05 + midY * 0.35;
        const targetCamY = 1.55 + dist * 0.04;

        if (isPreview) {
            // Elegant subtle sway during idle/pre-fight screen
            const swayX = Math.sin(timeSeconds * 0.5) * 0.6;
            const swayY = Math.cos(timeSeconds * 0.3) * 0.15;
            this.camera.position.x += ((targetX + swayX) - this.camera.position.x) * 0.05;
            this.camera.position.z += ((targetZ + 0.5) - this.camera.position.z) * 0.05;
            this.camera.position.y += ((targetCamY + swayY) - this.camera.position.y) * 0.05;
        } else {
            // Smooth dynamic follow during battle
            this.camera.position.x += (targetX - this.camera.position.x) * 0.12;
            this.camera.position.z += (targetZ - this.camera.position.z) * 0.12;
            this.camera.position.y += (targetCamY - this.camera.position.y) * 0.12;
        }

        this.cameraTarget.x += (midX - this.cameraTarget.x) * 0.12;
        this.cameraTarget.y += (targetY - this.cameraTarget.y) * 0.12;

        // Apply shake
        if (this.shakeIntensity > 0.005) {
            const ox = (Math.random() - 0.5) * this.shakeIntensity * 1.5;
            const oy = (Math.random() - 0.5) * this.shakeIntensity * 1.5;
            this.camera.position.x += ox;
            this.camera.position.y += oy;
            this.shakeIntensity *= this.shakeDecay;
        } else {
            this.shakeIntensity = 0;
        }

        this.camera.lookAt(this.cameraTarget);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }
}
