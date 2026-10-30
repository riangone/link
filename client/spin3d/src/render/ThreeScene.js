/**
 * Link Spin 3D - Three.js Viewport & Lighting Setup
 * WebGL 2.0 Renderer, Dynamic Stadium Cyber-Lighting, and Shadow Pipeline.
 */

import * as THREE from '../../vendor/three.module.js';

export class ThreeScene {
    constructor(container) {
        this.container = container;

        const w = this.container.clientWidth || window.innerWidth;
        const h = this.container.clientHeight || window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance'
        });
        const isMobile = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.75);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(w, h);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x06050e);
        this.scene.fog = new THREE.FogExp2(0x06050e, 0.008);

        this.camera = new THREE.PerspectiveCamera(46, w / h, 0.5, 400);
        this.camera.position.set(0, 70, 24);
        this.camera.lookAt(0, 0, 0);

        this.onResizeCallback = null;
        this.setupLights();
        this.setupResizeListener();
    }

    setupLights() {
        // High-contrast futuristic cyber arena lighting
        const ambientLight = new THREE.AmbientLight(0x181c30, 1.6);
        this.scene.add(ambientLight);

        // Key Overhead Directional Light (Crisp metallic bevel highlights & soft shadows)
        this.dirLight = new THREE.DirectionalLight(0xffffff, 3.0);
        this.dirLight.position.set(22, 65, 32);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 1024;
        this.dirLight.shadow.mapSize.height = 1024;
        this.dirLight.shadow.camera.near = 10;
        this.dirLight.shadow.camera.far = 170;
        this.dirLight.shadow.camera.left = -48;
        this.dirLight.shadow.camera.right = 48;
        this.dirLight.shadow.camera.top = 48;
        this.dirLight.shadow.camera.bottom = -48;
        this.dirLight.shadow.bias = -0.0004;
        this.scene.add(this.dirLight);

        // Cyber Stadium Rim Spotlights (Intense Electric Cyan & Neon Pink)
        this.rimLight1 = new THREE.PointLight(0x00f0ff, 5.5, 100, 1.2);
        this.rimLight1.position.set(-36, 24, -28);
        this.scene.add(this.rimLight1);

        this.rimLight2 = new THREE.PointLight(0xff007f, 5.5, 100, 1.2);
        this.rimLight2.position.set(36, 24, 28);
        this.scene.add(this.rimLight2);

        // High Center Arena Sun Spotlight
        this.centerLight = new THREE.PointLight(0xffeedd, 2.8, 70, 1.3);
        this.centerLight.position.set(0, 26, 0);
        this.scene.add(this.centerLight);

        // High-Burst Clash Flash Light (Lights up entire arena on hard impact)
        this.clashFlashLight = new THREE.PointLight(0xffffff, 0, 75, 1.5);
        this.clashFlashLight.position.set(0, 4, 0);
        this.scene.add(this.clashFlashLight);
    }

    triggerClashFlash(x, y, z, intensity = 1.0) {
        this.clashFlashLight.position.set(x, y + 2.5, z);
        this.clashFlashLight.intensity = Math.min(16.0, 7.0 * intensity);
    }

    update(dt) {
        // Decay clash flash smoothly
        if (this.clashFlashLight.intensity > 0.05) {
            this.clashFlashLight.intensity *= Math.pow(0.82, dt * 60);
        } else {
            this.clashFlashLight.intensity = 0;
        }
    }

    setupResizeListener() {
        this.onResize = () => {
            const w = this.container.clientWidth || window.innerWidth;
            const h = this.container.clientHeight || window.innerHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
            if (this.onResizeCallback) {
                this.onResizeCallback(w, h);
            }
        };
        window.addEventListener('resize', this.onResize);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    destroy() {
        window.removeEventListener('resize', this.onResize);
        if (this.renderer && this.renderer.domElement) {
            this.container.removeChild(this.renderer.domElement);
            this.renderer.dispose();
        }
    }
}
