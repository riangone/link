/**
 * ThreeScene - Three.js WebGL viewport adapter
 * Cyberpunk rooftop dojo: procedural textures, neon skyline, rain, HDR bloom,
 * fighting-game camera with adaptive FOV and trauma-based shake.
 */

import * as THREE from '../../vendor/three.module.js';
import { PostFX } from './PostFX.js';

/** Visual themes for the campaign chapter maps (LevelLayouts themes). */
const LEVEL_THEMES = {
    WAREHOUSE: { floor: 0xc8d3df, wall: 0xd8e3ee, wallH: 8, lamp: 0xf8fafc, accent: 0xf59e0b, fog: 0xdbe6f2, fogDensity: 0.006,
        kinds: { CONTAINER: { color: 0x0284c7, metal: 0.25, trim: 0xf8fafc }, CRATE: { color: 0xb45309 }, FORKLIFT: { color: 0xfacc15, metal: 0.3 }, SECTOR_WALL: { color: 0x94a3b8 }, DEFAULT: { color: 0x64748b } } },
    FACTORY: { floor: 0x9ca3af, wall: 0xb6bcc6, wallH: 9, lamp: 0xfff7d6, accent: 0xf97316, fog: 0xd6d3cb, fogDensity: 0.008,
        kinds: { CONVEYOR: { color: 0x334155, metal: 0.5, trim: 0xfacc15 }, PRESS: { color: 0xea580c, metal: 0.4 }, FURNACE: { color: 0x7c2d12, trim: 0xfb923c }, PIPE: { color: 0x94a3b8, metal: 0.6 }, SECTOR_WALL: { color: 0x6b7280 }, DEFAULT: { color: 0x6b7280 } } },
    LAB: { floor: 0xe5f3ee, wall: 0xf1f5f9, wallH: 4.5, lamp: 0xecfeff, accent: 0x10b981, fog: 0xe0f2ee, fogDensity: 0.006,
        kinds: { GLASS: { color: 0x99f6e4, glass: true }, TANK: { color: 0x34d399, glass: true }, BENCH: { color: 0xf8fafc, trim: 0x10b981 }, SECTOR_WALL: { color: 0xcbd5e1 }, DEFAULT: { color: 0xcbd5e1 } } },
    AIRPORT: { floor: 0xe7e5e4, wall: 0xdbeafe, wallH: 10, lamp: 0xffffff, accent: 0x3b82f6, fog: 0xe2ecf8, fogDensity: 0.005,
        kinds: { PILLAR: { color: 0xf8fafc }, COUNTER: { color: 0x1e3a8a, trim: 0x60a5fa }, SEATS: { color: 0x475569 }, CAROUSEL: { color: 0x334155, metal: 0.5 }, KIOSK: { color: 0x0ea5e9 }, SECTOR_WALL: { color: 0xbfdbfe }, DEFAULT: { color: 0x94a3b8 } } },
    HANGAR: { floor: 0xa8a29e, wall: 0x78716c, wallH: 14, lamp: 0xfef3c7, accent: 0xfacc15, fog: 0xcbc6bf, fogDensity: 0.007,
        kinds: { CRATE: { color: 0x92400e }, FUSELAGE: { color: 0xe2e8f0, metal: 0.4, trim: 0x1d4ed8 }, WING: { color: 0xcbd5e1, metal: 0.4 }, ENGINE: { color: 0x475569, metal: 0.6 }, PILLAR: { color: 0x57534e }, SECTOR_WALL: { color: 0x57534e }, DEFAULT: { color: 0x78716c } } },
    OFFICE: { floor: 0xcbd5e1, wall: 0xe2e8f0, wallH: 4, lamp: 0xffffff, accent: 0x22d3ee, fog: 0xe2e8f0, fogDensity: 0.006,
        kinds: { PARTITION: { color: 0x64748b }, DESK: { color: 0xa16207 }, PILLAR: { color: 0xf1f5f9 }, SECTOR_WALL: { color: 0x94a3b8 }, DEFAULT: { color: 0x94a3b8 } } },
    ATMOS: { floor: 0x94a3b8, wall: 0x64748b, wallH: 12, lamp: 0xccfbf1, accent: 0x2dd4bf, fog: 0xb8d8d4, fogDensity: 0.01,
        kinds: { COLUMN: { color: 0x0f766e, metal: 0.5, trim: 0x5eead4 }, PIPE: { color: 0xcbd5e1, metal: 0.6 }, SECTOR_WALL: { color: 0x475569 }, DEFAULT: { color: 0x475569 } } },
    ATMOS_CORE: { floor: 0x475569, wall: 0x334155, wallH: 6, lamp: 0x99f6e4, accent: 0x14b8a6, fog: 0x8fb3b0, fogDensity: 0.014,
        kinds: { MACHINE: { color: 0x1e293b, metal: 0.6, trim: 0x2dd4bf }, SECTOR_WALL: { color: 0x1e293b }, DEFAULT: { color: 0x334155 } } },
    STATE: { floor: 0xf5f5f4, wall: 0xe7e5e4, wallH: 9, lamp: 0xfffbeb, accent: 0xa8a29e, fog: 0xece9e4, fogDensity: 0.005,
        kinds: { COLONNADE: { color: 0xfafaf9 }, SHELF: { color: 0x78350f }, RECEPTION: { color: 0x44403c, trim: 0xd6d3d1 }, BENCH: { color: 0x57534e }, STATUE: { color: 0xd6d3d1, metal: 0.3 }, SECTOR_WALL: { color: 0xd6d3d1 }, DEFAULT: { color: 0xa8a29e } } },
    ROOFTOP: { floor: 0x6b7280, wall: 0x4b5563, wallH: 1, lamp: 0xffffff, accent: 0x818cf8, fog: 0x9aa7bd, fogDensity: 0.012, skyline: true, rain: true,
        kinds: { AC_UNIT: { color: 0xd1d5db, metal: 0.4 }, VENT: { color: 0x9ca3af, metal: 0.5 }, SKYLIGHT: { color: 0x93c5fd, glass: true }, TOWER: { color: 0x7c2d12 }, PARAPET: { color: 0x4b5563 }, SECTOR_WALL: { color: 0x374151 }, DEFAULT: { color: 0x6b7280 } } },
    DREAM: { floor: 0x2e1065, wall: 0x1e1b4b, wallH: 1, lamp: 0xe9d5ff, accent: 0xe879f9, fog: 0x6d28d9, fogDensity: 0.02,
        kinds: { MONOLITH: { color: 0x1e1b4b, metal: 0.7, trim: 0xc084fc }, SECTOR_WALL: { color: 0x4c1d95 }, DEFAULT: { color: 0x4c1d95 } } },
    PRISON: { floor: 0x9ca3af, wall: 0x6b7280, wallH: 5, lamp: 0xfef9c3, accent: 0xfb7185, fog: 0xc7c2b8, fogDensity: 0.009,
        kinds: { CELL_WALL: { color: 0x78716c }, BARS: { color: 0x1f2937, metal: 0.8 }, BOOTH: { color: 0x334155, trim: 0xfb7185 }, SECTOR_WALL: { color: 0x57534e }, DEFAULT: { color: 0x6b7280 } } },
    HQ_VAULT: { floor: 0x1f2937, wall: 0x374151, wallH: 6, lamp: 0xfef08a, accent: 0xfacc15, fog: 0x4b5563, fogDensity: 0.011,
        kinds: { RACK: { color: 0x111827, metal: 0.6, trim: 0x22c55e }, CHECKPOINT: { color: 0xfacc15, metal: 0.3 }, VAULT_PILLAR: { color: 0xa16207, metal: 0.7 }, SECTOR_WALL: { color: 0x111827 }, DEFAULT: { color: 0x374151 } } },
    COMPOUND: { floor: 0xf1f5f9, wall: 0xcbd5e1, wallH: 1, lamp: 0xffffff, accent: 0xef4444, fog: 0xe2e8f0, fogDensity: 0.012,
        kinds: { ROCK: { color: 0x64748b, rough: 0.95 }, BUNKER: { color: 0x57534e, trim: 0xef4444 }, SANDBAG: { color: 0xa8a29e, rough: 0.95 }, SECTOR_WALL: { color: 0x475569 }, DEFAULT: { color: 0x64748b } } }
};


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
        this.fogColor = new THREE.Color(0xdbe6f2);
        this.scene.fog = new THREE.FogExp2(this.fogColor, 0.006);
        this.renderer.setClearColor(0xdce6f2, 1.0);

        this.camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 200);
        this.camera.position.set(0, 1.8, 7);
        this.updateAdaptiveFOV();

        this.cameraTarget = new THREE.Vector3(0, 1.1, 0);

        // camera rig: preset view + user orbit offsets (all render-only)
        this.camModes = ['adventure', 'side', 'diagonal', 'shoulder', 'top'];
        this.camMode = 'adventure';
        this.orbit = { yaw: 0, pitch: 0, zoom: 1 };
        this.camYaw = 0;      // smoothed yaw actually used (0 = classic side view from +Z)
        this.adventureYaw = undefined;
        this.camPitch = 0.1;
        this.camDist = 7;
        this.setupOrbitControls();
        this.shakeIntensity = 0;
        this.shakeDecay = 0.9;
        this.clock = 0;

        this.rooftopGroup = new THREE.Group();
        this.skylineGroup = new THREE.Group();
        this.indoorGroup = new THREE.Group();
        this.warehouseGroup = new THREE.Group();
        this.scene.add(this.rooftopGroup);
        this.scene.add(this.skylineGroup);
        this.scene.add(this.indoorGroup);
        this.scene.add(this.warehouseGroup);

        this.setupSky();
        this.setupLights();
        this.setupStage();
        this.setupIndoorStage();
        this.setupWarehouseStage();
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
                top: { value: new THREE.Color(0x72aee6) },
                mid: { value: new THREE.Color(0xcde2f8) },
                glow: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
            fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 glow; varying vec3 vP;
              void main(){
                float h = vP.y;
                vec3 c = mix(mid, top, smoothstep(0.0, 0.48, h));
                c += glow * 0.45 * exp(-abs(h - 0.02) * 12.0);
                c += vec3(0.95, 0.92, 0.88) * 0.25 * exp(-abs(h - 0.06) * 8.0);
                gl_FragColor = vec4(c, 1.0);
              }`
        });
        this.sky = new THREE.Mesh(geo, mat);
        this.scene.add(this.sky);
    }

    setupLights() {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd0dce8, 1.85));

        const key = new THREE.DirectionalLight(0xfffef8, 2.7);
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

        const rimC = new THREE.DirectionalLight(0x78b8e8, 1.6);
        rimC.position.set(-8, 4, -6);
        this.scene.add(rimC);
        const rimM = new THREE.DirectionalLight(0xfce8cc, 1.4);
        rimM.position.set(8, 4, -6);
        this.scene.add(rimM);
        const fill = new THREE.DirectionalLight(0xe8f0f8, 0.95);
        fill.position.set(0, 2, 10);
        this.scene.add(fill);

        // Dynamic Tactical Alarm Strobe Light
        this.alarmActive = false;
        const alarmLight = new THREE.PointLight(0xff1744, 0, 38, 1.4);
        alarmLight.position.set(0, 5.0, 0);
        this.alarmLight = alarmLight;
        this.scene.add(alarmLight);
    }

    makeFloorTextures() {
        const S = 512;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        // Oni light-themed high-tech architectural concrete deck
        g.fillStyle = '#b8c4d0';
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
            const v = 205 + Math.floor(this.rand() * 18);
            g.fillStyle = `rgb(${v - 2},${v},${v + 4})`;
            g.fillRect(i * 128 + 4, j * 128 + 4, 120, 120);
            // Crisp clean panel accent lines
            g.fillStyle = `rgba(160, 178, 196, 0.45)`;
            g.fillRect(i * 128 + 8, j * 128 + 8, 112, 3);
        }
        // Clean expansion seams (slate blue-gray)
        g.strokeStyle = '#8ca0b4';
        g.lineWidth = 4;
        for (let i = 0; i <= 4; i++) {
            g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, S); g.stroke();
            g.beginPath(); g.moveTo(0, i * 128); g.lineTo(S, i * 128); g.stroke();
        }
        const map = new THREE.CanvasTexture(c);
        map.colorSpace = THREE.SRGBColorSpace;

        // Clean luminous runway indicators
        const e = document.createElement('canvas');
        e.width = e.height = S;
        const ge = e.getContext('2d');
        ge.fillStyle = '#000';
        ge.fillRect(0, 0, S, S);
        ge.strokeStyle = '#00f0ff';
        ge.lineWidth = 1.5;
        for (let i = 0; i <= 4; i++) {
            ge.beginPath(); ge.moveTo(i * 128, 0); ge.lineTo(i * 128, S); ge.stroke();
            ge.beginPath(); ge.moveTo(0, i * 128); ge.lineTo(S, i * 128); ge.stroke();
        }
        ge.fillStyle = '#f59e0b';
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
        // Clean high-tech white & pale cyan composite tatami dojo matting
        g.fillStyle = '#d4e0ec';
        g.fillRect(0, 0, S, S);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
            const v = 222 + Math.floor(this.rand() * 12);
            g.fillStyle = `rgb(${v - 4},${v},${v + 4})`;
            g.fillRect(i * 128 + 3, j * 128 + 3, 122, 122);
            // Crisp tactical grip geometric pattern
            g.fillStyle = 'rgba(176, 196, 216, 0.4)';
            g.fillRect(i * 128 + 6, j * 128 + 6, 56, 56);
            g.fillRect(i * 128 + 66, j * 128 + 66, 56, 56);
        }
        g.strokeStyle = '#a6b8cc';
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

        // 2. North Enclosure Wall (Clean high-tech architectural panels + cyan status strip)
        const northWallMat = new THREE.MeshStandardMaterial({
            color: 0xdbe4ed,
            roughness: 0.82,
            metalness: 0.12
        });
        const northWall = new THREE.Mesh(new THREE.BoxGeometry(18.6, 5.5, 0.8), northWallMat);
        northWall.position.set(0, 2.75, -5.5);
        this.indoorGroup.add(northWall);

        // Lower kickplate along north wall
        const kickplateMat = new THREE.MeshStandardMaterial({ color: 0xb8c6d4, roughness: 0.75, metalness: 0.15 });
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
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0xc2d0dc, roughness: 0.75, metalness: 0.2 });
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

    setupWarehouseStage() {
        // 1. Industrial High-Tech Clean Freight Warehouse Floor (70m x 24m, centered at x = 5.0)
        // Spans the full grand campaign continuous sectors (x ∈ [-28, +38])
        const warehouseFloorMat = new THREE.MeshStandardMaterial({
            color: 0xc8d3df,
            roughness: 0.78,
            metalness: 0.15
        });
        const warehouseFloor = new THREE.Mesh(new THREE.BoxGeometry(70.0, 1.0, 24.0), warehouseFloorMat);
        warehouseFloor.position.set(5.0, -0.5, 0);
        warehouseFloor.receiveShadow = true;
        this.warehouseGroup.add(warehouseFloor);

        // Industrial Hazard Caution Stripes along north and south perimeter lines
        const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85 });
        for (const z of [-8.5, 8.5]) {
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(68.0, 0.02, 0.45), stripeMat);
            stripe.position.set(5.0, 0.015, z);
            this.warehouseGroup.add(stripe);
        }

        // 2. High-Contrast Shipping Containers & Tactile Props (Anime Tech High-Key Industrial Palette)
        const containerMats = [
            new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.65, metalness: 0.25 }), // Vibrant Sky Blue
            new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.70, metalness: 0.2 }),  // Industrial Safety Amber
            new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.60, metalness: 0.1 }),  // Clean Off-White
            new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.65, metalness: 0.2 })   // Crimson Accent
        ];

        // Helper to place container
        const addContainer = (x, z, w, h, d, matIdx) => {
            const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), containerMats[matIdx % containerMats.length]);
            box.position.set(x, h / 2, z);
            box.castShadow = true;
            box.receiveShadow = true;
            this.warehouseGroup.add(box);
            return box;
        };

        // Sector 1: West Cargo Maze (x in [-26, -6])
        addContainer(-20.0, -3.2, 2.2, 2.8, 2.4, 0);
        addContainer(-16.5, 3.0, 2.4, 2.8, 2.2, 1);
        addContainer(-11.5, -2.5, 2.2, 2.6, 2.0, 2);
        addContainer(-7.9, 1.8, 2.0, 2.6, 2.2, 0);

        // Sector 2: Transit Corridor (x in [-6, +14])
        addContainer(1.35, -2.4, 2.2, 2.8, 2.0, 1);
        addContainer(5.5, 2.5, 2.0, 3.2, 2.2, 2);
        addContainer(9.5, -2.6, 2.4, 2.8, 2.2, 3);

        // Sector 3: Freight Elevator Vault (x in [+14, +36])
        addContainer(18.5, 3.2, 2.5, 3.0, 2.4, 0);
        addContainer(24.0, -3.0, 2.4, 3.2, 2.5, 1);
        addContainer(30.0, 2.8, 2.6, 3.4, 2.6, 2);

        // 3. Structural Sector Portals & Security Archways at x = -6.0 and x = 14.0
        const archSteel = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.5, metalness: 0.5 });
        const cyanGlow = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const amberGlow = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

        const makeArchway = (xPos, signMat, signLabel) => {
            const arch = new THREE.Group();
            for (const z of [-5.5, 5.5]) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.4, 0.6), archSteel);
                post.position.set(xPos, 2.2, z);
                post.castShadow = true;
                arch.add(post);
            }
            const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 11.5), archSteel);
            lintel.position.set(xPos, 4.4, 0);
            arch.add(lintel);

            const neon = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 6.5), signMat);
            neon.position.set(xPos, 4.4, 0);
            arch.add(neon);
            return arch;
        };

        this.warehouseGroup.add(makeArchway(-6.0, cyanGlow, 'SECTOR 02 // LOGISTICS TRANSIT CORRIDOR'));
        this.warehouseGroup.add(makeArchway(14.0, amberGlow, 'SECTOR 03 // FREIGHT ELEVATOR & SECURE VAULT'));

        // 4. Overhead Gantry Cranes & Warehouse Beams (Light Gray/Blue Steel)
        const steelMat = new THREE.MeshStandardMaterial({ color: 0x8293a6, roughness: 0.5, metalness: 0.5 });
        for (const x of [-22.0, -8.0, 6.0, 20.0, 32.0]) {
            const craneBeam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.5, 0.6), steelMat);
            craneBeam.position.set(x, 3.75, -8.5);
            this.warehouseGroup.add(craneBeam);
        }
        const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(68.0, 0.5, 0.5), steelMat);
        crossBeam.position.set(5.0, 7.2, -8.5);
        this.warehouseGroup.add(crossBeam);

        // 5. North Clean Architectural Wall & Billboard
        const northWallMat = new THREE.MeshStandardMaterial({ color: 0xd8e3ee, roughness: 0.85, metalness: 0.1 });
        const northWall = new THREE.Mesh(new THREE.BoxGeometry(70.0, 8.0, 0.8), northWallMat);
        northWall.position.set(5.0, 4.0, -9.5);
        this.warehouseGroup.add(northWall);

        const neonSignMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
        const neonSign = new THREE.Mesh(new THREE.BoxGeometry(32.0, 0.16, 0.05), neonSignMat);
        neonSign.position.set(5.0, 6.0, -9.05);
        this.warehouseGroup.add(neonSign);
    }

    // ------------------------------------------------------------------ campaign chapter maps
    /**
     * Build a chapter map from LevelLayouts.buildLevel(): the SAME obstacle list the physics uses,
     * so every visible object collides and nothing invisible blocks the player.
     */
    buildCampaignLevel(level) {
        if (!this.levelGroup) {
            this.levelGroup = new THREE.Group();
            this.scene.add(this.levelGroup);
        }
        const g = this.levelGroup;
        for (let i = g.children.length - 1; i >= 0; i--) {
            const c = g.children[i];
            g.remove(c);
            c.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        }
        this.levelMats = this.levelMats || new Map();
        this.activeLevelTheme = null;
        this.levelObstacles = level ? level.obstacles : null;
        if (!level) return;

        const T = LEVEL_THEMES[level.theme] || LEVEL_THEMES.WAREHOUSE;
        this.activeLevelTheme = T;
        const mat = (hex, rough = 0.7, metal = 0.15, extra = {}) => {
            const key = `${hex}_${rough}_${metal}_${extra.opacity || 1}`;
            let m = this.levelMats.get(key);
            if (!m) {
                m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal, ...extra });
                this.levelMats.set(key, m);
            }
            return m;
        };
        const { minX, maxX, minZ, maxZ } = level.bounds;
        const W = maxX - minX, D = maxZ - minZ, cx = (minX + maxX) / 2;

        const floor = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 1, D + 4), mat(T.floor, 0.85, 0.05));
        floor.position.set(cx, -0.5, 0);
        floor.receiveShadow = true;
        g.add(floor);

        // floor markings along the critical path (helps reading the route)
        const pathMat = new THREE.MeshBasicMaterial({ color: T.accent, transparent: true, opacity: 0.35 });
        for (let i = 1; i < level.path.length; i++) {
            const [x0, z0] = level.path[i - 1], [x1, z1] = level.path[i];
            const len = Math.hypot(x1 - x0, z1 - z0);
            const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.18), pathMat);
            strip.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
            strip.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
            g.add(strip);
        }

        if (!level.outdoor) {
            const wallMat = mat(T.wall, 0.9, 0.05);
            for (const z of [minZ - 0.4, maxZ + 0.4]) {
                const w = new THREE.Mesh(new THREE.BoxGeometry(W + 2, T.wallH, 0.8), wallMat);
                w.position.set(cx, T.wallH / 2, z);
                w.receiveShadow = true;
                g.add(w);
            }
            for (const x of [minX - 0.4, maxX + 0.4]) {
                const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, T.wallH, D + 2), wallMat);
                w.position.set(x, T.wallH / 2, 0);
                g.add(w);
            }
            // ceiling light strips
            const lightMat = new THREE.MeshBasicMaterial({ color: T.lamp });
            for (let x = minX + 3; x < maxX; x += 6) {
                const l = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.35), lightMat);
                l.position.set(x, T.wallH - 0.2, 0);
                g.add(l);
            }
        }

        for (const o of level.obstacles) {
            const style = T.kinds[o.kind] || T.kinds.DEFAULT || { color: 0x94a3b8 };
            const w = o.maxX - o.minX, d = o.maxZ - o.minZ, h = o.height || 2.6;
            const m = style.glass
                ? mat(style.color, 0.1, 0.1, { transparent: true, opacity: 0.38 })
                : mat(style.color, style.rough ?? 0.7, style.metal ?? 0.15);
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
            mesh.position.set((o.minX + o.maxX) / 2, (o.minY || 0) + h / 2, (o.minZ + o.maxZ) / 2);
            mesh.castShadow = !style.glass;
            mesh.receiveShadow = true;
            mesh.userData.obstacleId = o.id;
            g.add(mesh);
            if (style.trim) { // thin coloured band to break up silhouettes
                const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, Math.min(0.12, h * 0.1), d + 0.02),
                    new THREE.MeshBasicMaterial({ color: style.trim }));
                band.position.set(mesh.position.x, (o.minY || 0) + h * 0.82, mesh.position.z);
                g.add(band);
            }
        }
    }

    setStageMode(mode = 'ROOFTOP') {
        // ROOFTOP_CAMPAIGN = long campaign sector floor (warehouse geometry) under the open rooftop sky
        const isLevel = mode === 'CAMPAIGN_LEVEL';
        const isRooftopCampaign = mode === 'ROOFTOP_CAMPAIGN';
        const isWarehouse = mode === 'WAREHOUSE' || isRooftopCampaign;
        const isIndoor = mode === 'INDOOR_DOJO';
        const isRooftop = !isWarehouse && !isIndoor && !isLevel;
        this.stageMode = mode;
        this.setAlarmState(false);
        if (this.levelGroup) this.levelGroup.visible = isLevel;
        if (isLevel) {
            const T = this.activeLevelTheme || LEVEL_THEMES.WAREHOUSE;
            if (this.rooftopGroup) this.rooftopGroup.visible = false;
            if (this.indoorGroup) this.indoorGroup.visible = false;
            if (this.warehouseGroup) this.warehouseGroup.visible = false;
            if (this.skylineGroup) this.skylineGroup.visible = !!T.skyline;
            if (this.rain) this.rain.visible = !!T.rain;
            if (this.sky) this.sky.visible = true;
            this.scene.fog.color.setHex(T.fog);
            this.scene.fog.density = T.fogDensity;
            return;
        }

        if (this.rooftopGroup) this.rooftopGroup.visible = isRooftop;
        if (this.skylineGroup) this.skylineGroup.visible = isRooftop || isRooftopCampaign;
        if (this.rain) this.rain.visible = isRooftop || isRooftopCampaign;
        if (this.sky) this.sky.visible = true; // Sky remains visible for airy, bright daylight in all scenes
        if (this.indoorGroup) this.indoorGroup.visible = isIndoor;
        if (this.warehouseGroup) this.warehouseGroup.visible = isWarehouse;

        // Bright high-key clean atmosphere across all modes
        this.scene.fog.color.setHex(0xdbe6f2);
        if (isIndoor) {
            this.scene.fog.density = 0.005;
        } else if (isWarehouse) {
            this.scene.fog.density = 0.006;
        } else {
            this.scene.fog.density = 0.008;
        }
    }

    setAlarmState(active) {
        this.alarmActive = !!active;
        if (!this.alarmActive && this.alarmLight) {
            this.alarmLight.intensity = 0;
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
        this.adventureYaw = undefined;
        this.orbit.yaw = 0; this.orbit.pitch = 0; this.orbit.zoom = 1;
        if (typeof this.onZoomChange === 'function') this.onZoomChange(this.getZoomPercent());
        return mode;
    }

    cycleCameraMode() {
        const i = this.camModes.indexOf(this.camMode);
        return this.setCameraMode(this.camModes[(i + 1) % this.camModes.length]);
    }

    resetOrbit() {
        this.orbit.yaw = 0; this.orbit.pitch = 0; this.orbit.zoom = 1;
        if (typeof this.onZoomChange === 'function') this.onZoomChange(this.getZoomPercent());
    }

    setZoom(val) {
        const clamped = Math.max(0.45, Math.min(2.2, Number(val) || 1.0));
        this.orbit.zoom = clamped;
        if (typeof this.onZoomChange === 'function') this.onZoomChange(this.getZoomPercent());
        return clamped;
    }

    adjustZoom(factor) {
        const next = Math.max(0.45, Math.min(2.2, this.orbit.zoom * factor));
        this.orbit.zoom = next;
        if (typeof this.onZoomChange === 'function') this.onZoomChange(this.getZoomPercent());
        return next;
    }

    getZoomPercent() {
        return Math.round(this.orbit.zoom * 100);
    }

    /** Oni 2001 mouse-look camera: locked directly behind Konoko, pitch from the mouse. */
    setAimFollow(on) {
        this.aimFollow = !!on;
        this.aimPitch = 0.2;
    }

    adjustAimPitch(d) {
        this.aimPitch = Math.max(-0.25, Math.min(0.9, (this.aimPitch || 0.2) + d));
    }

    /** Yaw used to convert screen-relative stick input to world space. */
    getInputYaw() {
        return this.camYaw;
    }

    setupOrbitControls() {
        const el = this.renderer.domElement;
        el.style.touchAction = 'none';
        let drag = null;
        const activePointers = new Map();
        let initialPinchDist = 0;
        let initialPinchZoom = 1;

        el.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button > 2) return;
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            el.setPointerCapture?.(e.pointerId);

            if (activePointers.size === 1) {
                drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
            } else if (activePointers.size === 2) {
                // Two touches down: activate pinch-to-zoom
                drag = null;
                const pts = Array.from(activePointers.values());
                initialPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                initialPinchZoom = this.orbit.zoom;
            }
        });

        el.addEventListener('pointermove', (e) => {
            if (!activePointers.has(e.pointerId)) return;
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (activePointers.size === 2 && initialPinchDist > 5) {
                const pts = Array.from(activePointers.values());
                const currDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                if (currDist > 5) {
                    const ratio = initialPinchDist / currDist;
                    this.orbit.zoom = Math.max(0.45, Math.min(2.2, initialPinchZoom * ratio));
                    if (typeof this.onZoomChange === 'function') this.onZoomChange(this.getZoomPercent());
                }
                return;
            }

            if (drag && drag.id === e.pointerId && activePointers.size === 1) {
                const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
                drag.x = e.clientX; drag.y = e.clientY;
                this.orbit.yaw -= dx * 0.008;
                this.orbit.pitch = Math.max(-0.08, Math.min(1.1, this.orbit.pitch + dy * 0.006));
            }
        });

        const end = (e) => {
            activePointers.delete(e.pointerId);
            if (drag && drag.id === e.pointerId) drag = null;
            if (activePointers.size === 1) {
                const [remId, pt] = Array.from(activePointers.entries())[0];
                drag = { id: remId, x: pt.x, y: pt.y };
            }
        };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);

        // Wheel zoom on renderer canvas & parent container
        const onWheel = (e) => {
            e.preventDefault();
            const factor = Math.exp(e.deltaY * 0.0012);
            this.adjustZoom(factor);
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        if (this.container && this.container !== el) {
            this.container.addEventListener('wheel', onWheel, { passive: false });
        }
        el.addEventListener('dblclick', () => this.resetOrbit());
        el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /**
     * Oni-style camera collision: if a map obstacle sits between the look target and the camera,
     * pull the camera in front of it (segment vs. AABB slab test against the physics boxes).
     */
    clipCameraToLevel() {
        const obs = this.levelObstacles;
        if (!obs || !obs.length) return;
        const t = this.cameraTarget, c = this.camera.position;
        const dx = c.x - t.x, dy = c.y - t.y, dz = c.z - t.z;
        let best = 1;
        for (const o of obs) {
            let t0 = 0, t1 = best;
            const slab = (p, d, lo, hi) => {
                if (Math.abs(d) < 1e-9) return p >= lo && p <= hi;
                let a = (lo - p) / d, b = (hi - p) / d;
                if (a > b) { const tmp = a; a = b; b = tmp; }
                if (a > t0) t0 = a;
                if (b < t1) t1 = b;
                return t0 <= t1;
            };
            const pad = 0.12;
            if (slab(t.x, dx, o.minX - pad, o.maxX + pad) &&
                slab(t.y, dy, o.minY ? o.minY - pad : -1, (o.minY || 0) + (o.height || 2.6) + pad) &&
                slab(t.z, dz, o.minZ - pad, o.maxZ + pad) && t0 > 0) {
                best = t0;
            }
        }
        if (best < 1) {
            const f = Math.max(0.12, best - 0.04);
            c.set(t.x + dx * f, t.y + dy * f, t.z + dz * f);
        }
    }

    updateCamera(f1, f2, isPreview = false, timeSeconds = 0, cinematicState = null) {
        const dt = this._lastCamT === undefined ? 1 / 60 : Math.min(0.1, Math.max(0, timeSeconds - this._lastCamT));
        this._lastCamT = timeSeconds;
        this.updateRain(dt);
        this.postfx.flash *= Math.exp(-dt * 18);

        // P3 Boss Cinematic Dramatic Push-In Dolly
        if (cinematicState && cinematicState.active && f2) {
            const progress = Math.min(1.0, cinematicState.frame / 70.0);
            const ease = 1 - Math.pow(1 - progress, 3);
            const dist = 8.2 - ease * 4.8; // dolly in from 8.2m to 3.4m!
            const pitch = 0.14; // low-angle hero shot looking up at Boss
            const yaw = (f2.facingAngle !== undefined ? f2.facingAngle : (f2.facing === 1 ? 0 : Math.PI)) - 0.35;

            const bossX = f2.x;
            const bossZ = f2.z;
            const lookY = 1.15;

            const targetCamPos = new THREE.Vector3(
                bossX + dist * Math.sin(yaw) * Math.cos(pitch),
                lookY + dist * Math.sin(pitch),
                bossZ + dist * Math.cos(yaw) * Math.cos(pitch)
            );
            this.camera.position.lerp(targetCamPos, 0.12);
            this.cameraTarget.set(bossX, lookY, bossZ);
            this.camera.lookAt(this.cameraTarget);

            this.keyLight.position.set(bossX + 3, 9, bossZ + 6);
            this.keyLight.target.position.set(bossX, 0, bossZ);
            return;
        }

        if (this.aimFollow && f1 && !isPreview) {
            const fa = f1.facingAngle || 0;
            const yawA = Math.atan2(-Math.cos(fa), -Math.sin(fa)); // camera sits behind her facing
            const pitchA = this.aimPitch === undefined ? 0.2 : this.aimPitch;
            const distA = 3.6 * this.orbit.zoom;
            let dyA = yawA - this.camYaw;
            while (dyA > Math.PI) dyA -= Math.PI * 2;
            while (dyA < -Math.PI) dyA += Math.PI * 2;
            this.camYaw += dyA * (1 - Math.exp(-dt * 30)); // near-rigid, like the original
            this.camPitch += (pitchA - this.camPitch) * (1 - Math.exp(-dt * 20));
            this.camDist += (distA - this.camDist) * (1 - Math.exp(-dt * 10));
            const kA = 1 - Math.exp(-dt * 18);
            this.cameraTarget.x += (f1.x - this.cameraTarget.x) * kA;
            this.cameraTarget.y += (1.35 + f1.y * 0.6 - this.cameraTarget.y) * kA;
            this.cameraTarget.z += (f1.z - this.cameraTarget.z) * kA;
            const cpA = Math.cos(this.camPitch), spA = Math.sin(this.camPitch);
            this.camera.position.set(
                this.cameraTarget.x + Math.sin(this.camYaw) * cpA * this.camDist,
                Math.max(0.35, this.cameraTarget.y + spA * this.camDist + 0.15),
                this.cameraTarget.z + Math.cos(this.camYaw) * cpA * this.camDist
            );
            this.clipCameraToLevel();
            this.keyLight.position.set(f1.x + 3, 9, f1.z + 6);
            this.keyLight.target.position.set(f1.x, 0, f1.z);
            this.camera.lookAt(this.cameraTarget);
            if (this.alarmActive && this.alarmLight) {
                this.alarmLight.position.set(f1.x, 5.0, f1.z);
                this.alarmLight.intensity = Math.max(0, Math.sin(this.clock * 16.0)) * 4.5;
            }
            if (this.shakeIntensity > 0.005) {
                const sA = this.shakeIntensity;
                this.camera.position.x += (Math.random() - 0.5) * sA * 0.5;
                this.camera.position.y += (Math.random() - 0.5) * sA * 0.5;
                this.shakeIntensity *= Math.pow(this.shakeDecay, dt * 60);
            } else {
                this.shakeIntensity = 0;
            }
            this.sky.position.copy(this.camera.position);
            return;
        }

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
        } else if (this.camMode === 'adventure') {   // Oni 2001 Adventure 3rd-person follow
            const { fx, fz } = typeof f1.getForwardVector === 'function' ? f1.getForwardVector() : { fx: 1, fz: 0 };
            const charBackYaw = f1.facingAngle !== undefined ? Math.atan2(-Math.cos(f1.facingAngle), -Math.sin(f1.facingAngle)) : Math.atan2(-fx, fz);
            if (this.adventureYaw === undefined) {
                this.adventureYaw = charBackYaw;
            } else {
                let diff = charBackYaw - this.adventureYaw;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const speed = Math.hypot(f1.vx || 0, f1.vz || 0);
                // Deadzone of ~24 degrees: micro-turns and idle combat never drag the camera, eliminating feedback vibration
                const deadzone = 0.42;
                if (speed > 1.2 && Math.abs(diff) > deadzone) {
                    const excess = (Math.abs(diff) - deadzone) * Math.sign(diff);
                    const followRate = (f1.state === 'RUN' || f1.state === 2) ? 2.8 : 1.4;
                    this.adventureYaw += excess * (1 - Math.exp(-dt * followRate));
                }
            }
            yaw = this.adventureYaw;
            pitch = 0.22;
            camDist = 3.4 * this.orbit.zoom;
            midX = f1.x;
            midZ = f1.z;
            lookY = 1.25 + (f1.y || 0) * 0.5;
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

        if (!isPreview) this.clipCameraToLevel();

        // shadow frustum follows the action
        this.keyLight.position.set(midX + 3, 9, midZ + 6);
        this.keyLight.target.position.set(midX, 0, midZ);

        if (this.alarmActive && this.alarmLight) {
            const pulse = Math.max(0, Math.sin(this.clock * 16.0));
            this.alarmLight.position.set(midX, 5.0, midZ);
            this.alarmLight.intensity = pulse * 4.5;
        }

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
