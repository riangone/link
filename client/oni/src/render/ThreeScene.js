/**
 * ThreeScene - Three.js WebGL viewport adapter
 * Cyberpunk rooftop dojo: procedural textures, neon skyline, rain, HDR bloom,
 * fighting-game camera with adaptive FOV and trauma-based shake.
 */

import * as THREE from '../../vendor/three.module.js';
import { PostFX } from './PostFX.js';

// deterministic PRNG so the skyline is identical every load
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class ThreeScene {
    constructor(canvasContainer) {
        this.container = canvasContainer;
        this.rand = mulberry32(1337);

        const w = this.container.clientWidth || window.innerWidth;
        const h = this.container.clientHeight || window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.lowPower = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1.25 : 1.75);
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(w, h);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        this.postfx = new PostFX(this.renderer);
        if (!this.postfx.enabled) {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.05;
        }
        this.postfx.setSize(w, h, this.pixelRatio);

        // adaptive quality: 0 = full, 1 = no shadows + 1x DPR, 2 = no post-processing
        this.quality = 0;
        this._perf = { last: 0, frames: 0, sum: 0, n: 0 };

        this.scene = new THREE.Scene();
        this.fogColor = new THREE.Color(0x0b0f18);
        this.scene.fog = new THREE.FogExp2(this.fogColor, 0.024);

        this.camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 200);
        this.camera.position.set(0, 1.8, 7);
        this.updateAdaptiveFOV();

        this.cameraTarget = new THREE.Vector3(0, 1.1, 0);

        // camera rig: preset view + user orbit offsets (all render-only)
        this.camModes = ['side', 'diagonal', 'shoulder', 'top'];
        this.camMode = 'side';
        this.orbit = { yaw: 0, pitch: 0, zoom: 1 };
        this.camYaw = 0;      // smoothed yaw actually used (0 = classic side view from +Z)
        this.camPitch = 0.1;
        this.camDist = 7;
        this.setupOrbitControls();
        this.shakeIntensity = 0;
        this.shakeDecay = 0.9;
        this.clock = 0;

        this.rooftopGroup = new THREE.Group();
        this.skylineGroup = new THREE.Group();
        this.indoorGroup = new THREE.Group();
        this.scene.add(this.rooftopGroup);
        this.scene.add(this.skylineGroup);
        this.scene.add(this.indoorGroup);

        this.setupSky();
        this.setupLights();
        this.setupStage();
        this.setupIndoorStage();
        this.setupSkyline();
        this.setupRain();

        this.setStageMode('ROOFTOP');

        window.addEventListener('resize', () => this.onResize());
    }

    // ------------------------------------------------------------------ environment
    setupSky() {
        const geo = new THREE.SphereGeometry(90, 32, 16);
        const mat = new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, fog: false,
            uniforms: {
                top: { value: new THREE.Color(0x070a10) },
                mid: { value: new THREE.Color(0x131b28) },
                glow: { value: new THREE.Color(0x2a5678) }
            },
            vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
            fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 glow; varying vec3 vP;
              void main(){
                float h = vP.y;
                vec3 c = mix(mid, top, smoothstep(0.0, 0.48, h));
                c += glow * 0.35 * exp(-abs(h - 0.02) * 14.0);
                c += vec3(0.42, 0.32, 0.18) * 0.14 * exp(-abs(h - 0.06) * 10.0);
                gl_FragColor = vec4(c, 1.0);
              }`
        });
        this.sky = new THREE.Mesh(geo, mat);
        this.scene.add(this.sky);
    }

    setupLights() {
        this.scene.add(new THREE.HemisphereLight(0x889ab5, 0x1a1e26, 1.25));

        const key = new THREE.DirectionalLight(0xf6ede0, 2.1);
        key.position.set(3, 9, 6);
        key.castShadow = true;
        key.shadow.mapSize.setScalar(this.lowPower ? 1024 : 2048);
        key.shadow.camera.near = 1;
        key.shadow.camera.far = 30;
        key.shadow.camera.left = -9;
        key.shadow.camera.right = 9;
        key.shadow.camera.top = 6;
        key.shadow.camera.bottom = -6;
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.02;
        key.shadow.radius = 4;
        this.keyLight = key;
        this.scene.add(key);
        this.scene.add(key.target);

        const rimC = new THREE.DirectionalLight(0x5890b8, 1.35);
        rimC.position.set(-8, 4, -6);
        this.scene.add(rimC);
        const rimM = new THREE.DirectionalLight(0xc88a55, 1.15);
        rimM.position.set(8, 4, -6);
        this.scene.add(rimM);
        const fill = new THREE.DirectionalLight(0x7c8ea6, 0.55);
        fill.position.set(0, 2, 10);
        this.scene.add(fill);
    }

    makeFloorTextures() {
        const S = 512;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        // Oni 2001 architectural brutalist concrete & matte tactical steel deck
        g.fillStyle = '#252932';
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
            const v = 38 + Math.floor(this.rand() * 12);
            g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
            g.fillRect(i * 128 + 4, j * 128 + 4, 120, 120);
            // Concrete weathering & industrial stencil marks
            g.fillStyle = `rgba(18,20,26,0.35)`;
            g.fillRect(i * 128 + 10, j * 128 + 10, 108, 4);
        }
        // Dark expansion joints (matte asphalt/rubber seams, no mirror glare)
        g.strokeStyle = 'rgba(14,16,20,1)';
        g.lineWidth = 6;
        for (let i = 0; i <= 4; i++) {
            g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, S); g.stroke();
            g.beginPath(); g.moveTo(0, i * 128); g.lineTo(S, i * 128); g.stroke();
        }
        const map = new THREE.CanvasTexture(c);
        map.colorSpace = THREE.SRGBColorSpace;

        // Subtle recessed floor marker lights (subdued industrial amber/cyan)
        const e = document.createElement('canvas');
        e.width = e.height = S;
        const ge = e.getContext('2d');
        ge.fillStyle = '#000';
        ge.fillRect(0, 0, S, S);
        ge.strokeStyle = '#1e3f52';
        ge.lineWidth = 1.5;
        for (let i = 0; i <= 4; i++) {
            ge.beginPath(); ge.moveTo(i * 128, 0); ge.lineTo(i * 128, S); ge.stroke();
            ge.beginPath(); ge.moveTo(0, i * 128); ge.lineTo(S, i * 128); g.stroke();
        }
        ge.fillStyle = '#b87328';
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) ge.fillRect(i * 128 - 3, j * 128 - 3, 6, 6);
        const emissive = new THREE.CanvasTexture(e);
        emissive.colorSpace = THREE.SRGBColorSpace;

        for (const t of [map, emissive]) {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(9, 5);
            t.anisotropy = 8;
        }
        return { map, emissive };
    }

    setupStage() {
        const { map, emissive } = this.makeFloorTextures();

        // P5 Tier 1: Elevated Upper Rooftop Deck — Oni brutalist matte concrete (roughness 0.88, metalness 0.08)
        const upperDeckMat = new THREE.MeshStandardMaterial({
            map,
            emissiveMap: emissive,
            emissive: 0xffffff,
            emissiveIntensity: 0.16,
            roughness: 0.88,
            metalness: 0.08
        });
        const upperDeck = new THREE.Mesh(new THREE.BoxGeometry(12.8, 1.8, 9.2), upperDeckMat);
        upperDeck.position.set(0, -0.9, 0);
        upperDeck.receiveShadow = true;
        upperDeck.castShadow = true;
        this.rooftopGroup.add(upperDeck);

        // Tactical industrial hazard trim along the upper deck edge (|x| = 6.4, |z| = 4.6)
        const edgeGlowC = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a88a8) });
        const edgeGlowWarn = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd88418) });
        const upperRimX1 = new THREE.Mesh(new THREE.BoxGeometry(12.88, 0.06, 0.08), edgeGlowC);
        upperRimX1.position.set(0, 0.01, 4.6);
        this.rooftopGroup.add(upperRimX1);
        const upperRimX2 = upperRimX1.clone();
        upperRimX2.position.set(0, 0.01, -4.6);
        this.rooftopGroup.add(upperRimX2);

        const upperRimZ1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 9.28), edgeGlowWarn);
        upperRimZ1.position.set(-6.4, 0.01, 0);
        this.rooftopGroup.add(upperRimZ1);
        const upperRimZ2 = upperRimZ1.clone();
        upperRimZ2.position.set(6.4, 0.01, 0);
        this.rooftopGroup.add(upperRimZ2);

        // P5 Tier 2: Lower Perimeter Catwalk (matte industrial concrete & dark grating)
        const catwalkMat = new THREE.MeshStandardMaterial({
            color: 0x1c212b,
            roughness: 0.85,
            metalness: 0.14,
            emissive: 0x080d14,
            emissiveIntensity: 0.2
        });
        const lowerCatwalk = new THREE.Mesh(new THREE.BoxGeometry(19.6, 2.2, 11.6), catwalkMat);
        lowerCatwalk.position.set(0, -2.9, 0);
        lowerCatwalk.receiveShadow = true;
        this.rooftopGroup.add(lowerCatwalk);

        // Fatal Abyss Danger Trim around outer catwalk edge (|x| = 9.8, |z| = 5.8, y = -1.8)
        const dangerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc83232) });
        const lowerRimX1 = new THREE.Mesh(new THREE.BoxGeometry(19.68, 0.07, 0.09), dangerMat);
        lowerRimX1.position.set(0, -1.79, 5.8);
        this.rooftopGroup.add(lowerRimX1);
        const lowerRimX2 = lowerRimX1.clone();
        lowerRimX2.position.set(0, -1.79, -5.8);
        this.rooftopGroup.add(lowerRimX2);
        const lowerRimZ1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 11.68), dangerMat);
        lowerRimZ1.position.set(-9.8, -1.79, 0);
        this.rooftopGroup.add(lowerRimZ1);
        const lowerRimZ2 = lowerRimZ1.clone();
        lowerRimZ2.position.set(9.8, -1.79, 0);
        this.rooftopGroup.add(lowerRimZ2);

        // Painted TCTF tactical combat ring on the upper concrete deck
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x3b7898, transparent: true, opacity: 0.65 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.035, 8, 96), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.025;
        this.rooftopGroup.add(ring);

        // Perimeter concrete/steel barrier posts + subdued warning bars along the back of the lower catwalk
        const postMat = new THREE.MeshStandardMaterial({ color: 0x222630, roughness: 0.82, metalness: 0.18 });
        const barC = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a88a8) });
        const barM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd88418) });
        for (let i = -4; i <= 4; i++) {
            const x = i * 2.3;
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.18), postMat);
            post.position.set(x, -1.15, -5.7);
            post.castShadow = true;
            this.rooftopGroup.add(post);
            const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.0, 0.04), i % 2 ? barM : barC);
            bar.position.set(x, -1.1, -5.59);
            this.rooftopGroup.add(bar);
        }
        const rail = new THREE.Mesh(new THREE.BoxGeometry(19.2, 0.05, 0.05), barC);
        rail.position.set(0, -0.55, -5.62);
        this.rooftopGroup.add(rail);
        const rail2 = new THREE.Mesh(new THREE.BoxGeometry(19.2, 0.03, 0.03), barM);
        rail2.position.set(0, -1.55, -5.62);
        this.rooftopGroup.add(rail2);
    }

    makeWindowTexture(seed) {
        const r = mulberry32(seed);
        const c = document.createElement('canvas');
        c.width = 64; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, 64, 128);
        const palette = ['#7fd8ff', '#ffd27f', '#ff7fc8', '#b48cff'];
        const col = palette[Math.floor(r() * palette.length)];
        for (let y = 2; y < 128; y += 6) for (let x = 2; x < 64; x += 5) {
            if (r() < 0.14) {
                g.fillStyle = col;
                g.globalAlpha = 0.4 + r() * 0.6;
                g.fillRect(x, y, 3, 3);
            }
        }
        g.globalAlpha = 1;
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.magFilter = THREE.NearestFilter;
        return t;
    }

    setupSkyline() {
        const r = this.rand;
        const texes = [0, 1, 2, 3].map(i => this.makeWindowTexture(100 + i));
        const neonCols = [0x22e6ff, 0xff2f8a, 0xffb020, 0x9a5bff];

        const addRow = (z0, zJitter, count, spacing, hMin, hMax) => {
            for (let i = 0; i < count; i++) {
                const x = (i - count / 2) * spacing + (r() - 0.5) * spacing * 0.6;
                const w = 2.5 + r() * 3;
                const d = 2.5 + r() * 3;
                const h = hMin + r() * (hMax - hMin);
                const tex = texes[Math.floor(r() * texes.length)].clone();
                tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                tex.repeat.set(Math.max(1, Math.round(w / 2.5)), Math.max(1, Math.round(h / 6)));
                tex.needsUpdate = true;
                const mat = new THREE.MeshStandardMaterial({
                    color: 0x141922, roughness: 0.92, metalness: 0.06,
                    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.45
                });
                const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
                b.position.set(x, h / 2 - 3, z0 - r() * zJitter);
                this.skylineGroup.add(b);

                if (r() > 0.55) { // vertical industrial sign
                    const c = neonCols[Math.floor(r() * neonCols.length)];
                    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2 + r() * 3, 0.1),
                        new THREE.MeshBasicMaterial({ color: new THREE.Color(c) }));
                    sign.position.set(x + w / 2 + 0.25, 1.5 + r() * (h * 0.5), b.position.z + d / 2);
                    this.skylineGroup.add(sign);
                }
                if (r() > 0.6) { // rooftop aircraft warning beacon
                    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6),
                        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd93838) }));
                    beacon.position.set(x, h - 3 + 0.2, b.position.z);
                    this.skylineGroup.add(beacon);
                }
            }
        };
        addRow(-18, 6, 14, 4.8, 8, 22);
        addRow(-32, 10, 18, 6.5, 16, 40);

        // big holographic billboard
        const holo = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.2),
            new THREE.MeshBasicMaterial({ map: this.makeBillboardTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        holo.position.set(-3, 9, -18);
        this.skylineGroup.add(holo);
    }

    makeBillboardTexture() {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 160;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(0,0,0,0)';
        g.fillRect(0, 0, 512, 160);
        g.font = 'bold 96px "Hiragino Sans", "Noto Sans CJK JP", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = '#ff2f8a';
        g.shadowBlur = 24;
        g.fillStyle = '#ff6ab0';
        g.fillText('鬼 神 ONI', 256, 82);
        g.strokeStyle = 'rgba(34,230,255,0.8)';
        g.lineWidth = 3;
        g.strokeRect(8, 8, 496, 144);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    setupRain() {
        const N = this.lowPower ? 400 : 900;
        const pos = new Float32Array(N * 6);
        this.rainSpeed = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const x = (this.rand() - 0.5) * 34, y = this.rand() * 14, z = -12 + this.rand() * 18;
            pos.set([x, y, z, x + 0.02, y - 0.35, z], i * 6);
            this.rainSpeed[i] = 14 + this.rand() * 8;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            color: 0x7fa8ff, transparent: true, opacity: 0.18, depthWrite: false
        }));
        this.rain.frustumCulled = false;
        this.scene.add(this.rain);
    }

    updateRain(dt) {
        if (!this.rain || !this.rain.visible) return;
        const a = this.rain.geometry.attributes.position.array;
        for (let i = 0; i < this.rainSpeed.length; i++) {
            const o = i * 6;
            const d = this.rainSpeed[i] * dt;
            a[o + 1] -= d; a[o + 4] -= d;
            if (a[o + 4] < 0) { a[o + 1] += 14; a[o + 4] += 14; }
        }
        this.rain.geometry.attributes.position.needsUpdate = true;
    }

    makeIndoorFloorTextures() {
        const S = 512;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        g.fillStyle = '#1c2230';
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
            const v = 30 + Math.floor(this.rand() * 8);
            g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
            g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
            // Fine non-slip diamond grid pattern
            g.fillStyle = 'rgba(0,0,0,0.2)';
            g.fillRect(i * 128 + 6, j * 128 + 6, 56, 56);
            g.fillRect(i * 128 + 66, j * 128 + 66, 56, 56);
        }
        g.strokeStyle = '#10141d';
        g.lineWidth = 4;
        for (let i = 0; i <= 4; i++) {
            g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, S); g.stroke();
            g.beginPath(); g.moveTo(0, i * 128); g.lineTo(S, i * 128); g.stroke();
        }
        const map = new THREE.CanvasTexture(c);
        map.colorSpace = THREE.SRGBColorSpace;

        const e = document.createElement('canvas');
        e.width = e.height = S;
        const ge = e.getContext('2d');
        ge.fillStyle = '#000';
        ge.fillRect(0, 0, S, S);
        ge.strokeStyle = '#00f0ff';
        ge.lineWidth = 1.5;
        for (let i = 0; i <= 4; i++) {
            ge.beginPath(); ge.moveTo(i * 128, 0); ge.lineTo(i * 128, S); ge.stroke();
        }
        ge.fillStyle = '#d88418';
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
            ge.fillRect(i * 128 - 2, j * 128 - 2, 4, 4);
        }
        const emissive = new THREE.CanvasTexture(e);
        emissive.colorSpace = THREE.SRGBColorSpace;

        for (const t of [map, emissive]) {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(8, 5);
            t.anisotropy = 8;
        }
        return { map, emissive };
    }

    makeIndoorBannerTexture() {
        const c = document.createElement('canvas');
        c.width = 512; c.height = 160;
        const g = c.getContext('2d');
        g.fillStyle = '#0b1120';
        g.fillRect(0, 0, 512, 160);
        g.strokeStyle = '#00f0ff';
        g.lineWidth = 4;
        g.strokeRect(6, 6, 500, 148);
        g.fillStyle = 'rgba(0, 240, 255, 0.12)';
        g.fillRect(8, 8, 496, 44);

        g.font = 'bold 26px "Hiragino Sans", "Noto Sans", monospace';
        g.textAlign = 'center';
        g.fillStyle = '#38bdf8';
        g.fillText('TCTF HQ // COMBAT TRAINING DOJO', 256, 38);

        g.font = 'bold 22px "Hiragino Sans", "Noto Sans", sans-serif';
        g.fillStyle = '#00ff88';
        g.fillText('● SIMULATION ACTIVE · ZERO FALL RISK', 256, 84);

        g.font = '16px monospace';
        g.fillStyle = '#94a3b8';
        g.fillText('SAFETY FORCEFIELDS ENGAGED · SECTOR 0', 256, 126);

        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    makeForcefieldTexture() {
        const S = 256;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(0,0,0,0)';
        g.fillRect(0, 0, S, S);
        g.strokeStyle = 'rgba(0, 240, 255, 0.65)';
        g.lineWidth = 2;
        const step = 32;
        for (let x = 0; x <= S; x += step) {
            g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke();
        }
        for (let y = 0; y <= S; y += step) {
            g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(6, 3);
        return t;
    }

    setupIndoorStage() {
        const { map, emissive } = this.makeIndoorFloorTextures();

        // 1. Solid Flat Indoor Dojo Floor (Zero fall risk, flat at y = 0.0)
        const indoorFloorMat = new THREE.MeshStandardMaterial({
            map,
            emissiveMap: emissive,
            emissive: 0xffffff,
            emissiveIntensity: 0.15,
            roughness: 0.86,
            metalness: 0.1
        });
        const indoorFloor = new THREE.Mesh(new THREE.BoxGeometry(18.6, 1.0, 11.4), indoorFloorMat);
        indoorFloor.position.set(0, -0.5, 0);
        indoorFloor.receiveShadow = true;
        this.indoorGroup.add(indoorFloor);

        // Tactical Concentric Sparring Rings on Floor
        const ringOuterMat = new THREE.MeshBasicMaterial({ color: 0xd88418, transparent: true, opacity: 0.8 });
        const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.04, 8, 96), ringOuterMat);
        ringOuter.rotation.x = -Math.PI / 2;
        ringOuter.position.y = 0.02;
        this.indoorGroup.add(ringOuter);

        const ringInnerMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.75 });
        const ringInner = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.03, 8, 96), ringInnerMat);
        ringInner.rotation.x = -Math.PI / 2;
        ringInner.position.y = 0.02;
        this.indoorGroup.add(ringInner);

        // 2. North Enclosure Wall (Heavy composite concrete + glowing cyan status strip)
        const northWallMat = new THREE.MeshStandardMaterial({
            color: 0x141a24,
            roughness: 0.9,
            metalness: 0.12
        });
        const northWall = new THREE.Mesh(new THREE.BoxGeometry(18.6, 5.5, 0.8), northWallMat);
        northWall.position.set(0, 2.75, -5.5);
        this.indoorGroup.add(northWall);

        // Lower kickplate along north wall
        const kickplateMat = new THREE.MeshStandardMaterial({ color: 0x1e2533, roughness: 0.85, metalness: 0.15 });
        const kickplate = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.45, 0.12), kickplateMat);
        kickplate.position.set(0, 0.22, -5.04);
        this.indoorGroup.add(kickplate);

        // Horizontal glowing cyan status strip
        const glowStripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00f0ff) });
        const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.08, 0.06), glowStripMat);
        glowStrip.position.set(0, 1.35, -5.04);
        this.indoorGroup.add(glowStrip);

        // Holographic TCTF Training Dojo Billboard
        const bannerMat = new THREE.MeshBasicMaterial({
            map: this.makeIndoorBannerTexture(),
            transparent: true,
            depthWrite: false
        });
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.0), bannerMat);
        banner.position.set(0, 3.2, -5.02);
        this.indoorGroup.add(banner);

        // 3. West & East Safety Containment Pillars & Holographic Forcefields (x = ±8.8)
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, roughness: 0.8, metalness: 0.2 });
        const warnLampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd88418) });
        const cyanLampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00f0ff) });
        const zPillars = [-4.2, -1.4, 1.4, 4.2];

        for (const xSign of [-1, 1]) {
            const x = xSign * 8.8;
            for (let i = 0; i < zPillars.length; i++) {
                const z = zPillars[i];
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.5, 0.5), pillarMat);
                pillar.position.set(x, 2.75, z);
                this.indoorGroup.add(pillar);

                const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), i % 2 === 0 ? cyanLampMat : warnLampMat);
                lamp.position.set(x - (xSign * 0.22), 2.5, z);
                this.indoorGroup.add(lamp);
            }

            // Holographic containment grid forcefield
            const ffMat = new THREE.MeshBasicMaterial({
                map: this.makeForcefieldTexture(),
                transparent: true,
                opacity: 0.24,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const ff = new THREE.Mesh(new THREE.PlaneGeometry(10.8, 5.0), ffMat);
            ff.position.set(xSign * 8.75, 2.5, 0);
            ff.rotation.y = Math.PI / 2;
            this.indoorGroup.add(ff);
        }

        // 4. South Front Safety Curb (Low profile to keep camera view completely unobstructed)
        const curbMat = new THREE.MeshStandardMaterial({ color: 0x181e28, roughness: 0.85, metalness: 0.15 });
        const curb = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.38, 0.25), curbMat);
        curb.position.set(0, 0.19, 5.3);
        this.indoorGroup.add(curb);

        const curbGlow = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.05, 0.05), warnLampMat);
        curbGlow.position.set(0, 0.37, 5.25);
        this.indoorGroup.add(curbGlow);

        // 5. Ceiling Steel Trusses & Industrial Downlights
        const trussMat = new THREE.MeshStandardMaterial({ color: 0x121720, roughness: 0.8, metalness: 0.3 });
        for (const z of [-1.8, 1.8]) {
            const truss = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.3, 0.3), trussMat);
            truss.position.set(0, 5.2, z);
            this.indoorGroup.add(truss);

            for (const x of [-5, 0, 5]) {
                const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.25, 12), pillarMat);
                lamp.position.set(x, 5.0, z);
                this.indoorGroup.add(lamp);

                const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), cyanLampMat);
                bulb.position.set(x, 4.85, z);
                this.indoorGroup.add(bulb);
            }
        }
    }

    setStageMode(mode = 'ROOFTOP') {
        const isIndoor = mode === 'INDOOR_DOJO';
        this.stageMode = isIndoor ? 'INDOOR_DOJO' : 'ROOFTOP';

        if (this.rooftopGroup) this.rooftopGroup.visible = !isIndoor;
        if (this.skylineGroup) this.skylineGroup.visible = !isIndoor;
        if (this.rain) this.rain.visible = !isIndoor;
        if (this.sky) this.sky.visible = !isIndoor;
        if (this.indoorGroup) this.indoorGroup.visible = isIndoor;

        if (isIndoor) {
            this.scene.fog.density = 0.010;
            this.scene.fog.color.setHex(0x101520);
        } else {
            this.scene.fog.density = 0.024;
            this.scene.fog.color.setHex(0x0b0f18);
        }
    }

    // ------------------------------------------------------------------ camera
    addTrauma(intensity = 0.3) {
        this.shakeIntensity = Math.min(0.8, this.shakeIntensity + intensity);
    }

    hitFlash(amount = 0.12) {
        this.postfx.flash = Math.max(this.postfx.flash, amount);
    }

    updateAdaptiveFOV() {
        if (!this.container) return;
        const w = this.container.clientWidth || window.innerWidth;
        const h = this.container.clientHeight || window.innerHeight;
        if (w === 0 || h === 0) return;
        const aspect = w / h;
        this.camera.aspect = aspect;
        // keep >= ~60deg horizontal coverage so both fighters stay in frame on portrait screens
        const baseV = 36;
        const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseV) / 2) * aspect);
        const minH = THREE.MathUtils.degToRad(60);
        if (hFov < minH) {
            const v = 2 * Math.atan(Math.tan(minH / 2) / aspect);
            this.camera.fov = Math.min(80, THREE.MathUtils.radToDeg(v));
        } else {
            this.camera.fov = baseV;
        }
        this.camera.updateProjectionMatrix();
    }

    // ---- camera presets & orbit -------------------------------------------
    setCameraMode(mode) {
        if (!this.camModes.includes(mode)) return this.camMode;
        this.camMode = mode;
        this.orbit.yaw = 0; this.orbit.pitch = 0; this.orbit.zoom = 1;
        return mode;
    }

    cycleCameraMode() {
        const i = this.camModes.indexOf(this.camMode);
        return this.setCameraMode(this.camModes[(i + 1) % this.camModes.length]);
    }

    resetOrbit() {
        this.orbit.yaw = 0; this.orbit.pitch = 0; this.orbit.zoom = 1;
    }

    /** Yaw used to convert screen-relative stick input to world space. */
    getInputYaw() {
        return this.camYaw;
    }

    setupOrbitControls() {
        const el = this.renderer.domElement;
        el.style.touchAction = 'none';
        let drag = null;
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button > 2) return;
            drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
            el.setPointerCapture?.(e.pointerId);
        });
        el.addEventListener('pointermove', (e) => {
            if (!drag || drag.id !== e.pointerId) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            drag.x = e.clientX; drag.y = e.clientY;
            this.orbit.yaw -= dx * 0.008;
            this.orbit.pitch = Math.max(-0.08, Math.min(1.1, this.orbit.pitch + dy * 0.006));
        });
        const end = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.orbit.zoom = Math.max(0.55, Math.min(1.8, this.orbit.zoom * Math.exp(e.deltaY * 0.001)));
        }, { passive: false });
        el.addEventListener('dblclick', () => this.resetOrbit());
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    updateCamera(f1, f2, isPreview = false, timeSeconds = 0) {
        const dt = this._lastCamT === undefined ? 1 / 60 : Math.min(0.1, Math.max(0, timeSeconds - this._lastCamT));
        this._lastCamT = timeSeconds;
        this.updateRain(dt);
        this.postfx.flash *= Math.exp(-dt * 18);

        let midX = (f1.x + f2.x) * 0.5;
        let midZ = (f1.z + f2.z) * 0.5;
        const midY = (f1.y + f2.y) * 0.5;
        const dist = Math.hypot(f1.x - f2.x, f1.z - f2.z);

        // preset framing
        let yaw = 0, pitch = 0.1;
        let camDist = Math.max(5.6, Math.min(12, 4.2 + dist * 0.8));
        let lookY = 0.82 + midY * 0.35;
        const p1Facing = f1.facing === -1 ? -1 : 1;
        if (this.camMode === 'diagonal') {           // Tekken-style 3/4 view
            yaw = -p1Facing * 0.62; pitch = 0.2; camDist *= 0.95; // P1 on the near side
        } else if (this.camMode === 'shoulder') {    // behind P1, looking at the opponent
            yaw = -p1Facing * (Math.PI / 2 - 0.32);
            pitch = 0.16;
            camDist = 2.6 + dist * 0.55;
            midX = f1.x + (f2.x - f1.x) * 0.3;
            midZ = f1.z + (f2.z - f1.z) * 0.3;
            lookY = 1.05 + midY * 0.3;
        } else if (this.camMode === 'top') {         // high tactical view
            pitch = 0.95; camDist *= 1.15; lookY = 0.5;
        }
        if (isPreview) {
            yaw += Math.sin(timeSeconds * 0.45) * 0.14;
            pitch += Math.cos(timeSeconds * 0.3) * 0.02;
        }
        yaw += this.orbit.yaw;
        pitch = Math.max(-0.05, Math.min(1.35, pitch + this.orbit.pitch));
        camDist *= this.orbit.zoom;

        const k = 1 - Math.exp(-dt * (isPreview ? 3 : 7));
        let dy = yaw - this.camYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.camYaw += dy * k;
        this.camPitch += (pitch - this.camPitch) * k;
        this.camDist += (camDist - this.camDist) * k;

        this.cameraTarget.x += (midX - this.cameraTarget.x) * k;
        this.cameraTarget.y += (lookY - this.cameraTarget.y) * k;
        this.cameraTarget.z += (midZ - this.cameraTarget.z) * k;

        const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
        this.camera.position.set(
            this.cameraTarget.x + Math.sin(this.camYaw) * cp * this.camDist,
            Math.max(0.35, this.cameraTarget.y + sp * this.camDist + 0.25),
            this.cameraTarget.z + Math.cos(this.camYaw) * cp * this.camDist
        );

        // shadow frustum follows the action
        this.keyLight.position.set(midX + 3, 9, midZ + 6);
        this.keyLight.target.position.set(midX, 0, midZ);

        this.camera.lookAt(this.cameraTarget);
        if (this.shakeIntensity > 0.005) {
            const s = this.shakeIntensity;
            this.camera.position.x += (Math.random() - 0.5) * s * 0.5;
            this.camera.position.y += (Math.random() - 0.5) * s * 0.5;
            this.camera.rotation.z += (Math.random() - 0.5) * s * 0.06;
            this.shakeIntensity *= Math.pow(this.shakeDecay, dt * 60);
        } else {
            this.shakeIntensity = 0;
        }
        this.sky.position.copy(this.camera.position);
    }

    render() {
        this.postfx.render(this.scene, this.camera);
        this.monitorPerformance();
    }

    /** Step quality down when the device can't hold ~30 FPS (weak GPUs, software GL). */
    monitorPerformance() {
        const now = performance.now();
        const p = this._perf;
        if (p.last && ++p.frames > 5) { // skip shader-compile warmup frames
            p.sum += now - p.last;
            p.n++;
        }
        p.last = now;
        if (this.quality >= 2 || p.n < 3) return;
        if (p.n < 30 && p.sum < 2000) return;
        const avg = p.sum / p.n;
        p.sum = 0; p.n = 0;
        // very slow (<12 FPS): jump straight to the floor so shaders recompile only once
        if (avg > 80) this.setQuality(2);
        else if (avg > 34) this.setQuality(this.quality + 1);
    }

    setQuality(level) {
        this.quality = level;
        if (level >= 1) {
            this.pixelRatio = 1;
            this.renderer.setPixelRatio(1);
            this.renderer.shadowMap.enabled = false;
            this.scene.traverse(o => {
                if (!o.material) return;
                (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; });
            });
        }
        if (level >= 2 && this.postfx.enabled) {
            this.postfx.enabled = false;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.05;
        }
        this.onResize();
    }

    onResize() {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w === 0 || h === 0) return;
        this.updateAdaptiveFOV();
        this.renderer.setSize(w, h);
        this.postfx.setSize(w, h, this.pixelRatio);
    }
}
