/**
 * CharacterModel - procedural character art (no external assets).
 *
 * Builds a jointed, anime-proportioned figure out of lathe/rounded primitives, then bakes
 * every joint's parts into one mesh per material plus one inverted-hull outline mesh.
 * Animation code only ever touches the joint Groups exposed in `rig`; this module owns the look.
 *
 * Joint frame convention (rest pose): character faces +Z, +X is the character's LEFT,
 * limbs hang along -Y from their joint origin.
 */

import * as THREE from '../../vendor/three.module.js';

export const SIDE_L = 1;
export const SIDE_R = -1;

// ------------------------------------------------------------------ geometry helpers

/** Smooth limb of revolution hanging down -Y. profile: [[t 0..1 along length, radius], ...] */
function limbGeo(len, profile, seg = 12) {
    const pts = [new THREE.Vector2(0, -len)];
    for (let i = profile.length - 1; i >= 0; i--) {
        const [t, r] = profile[i];
        pts.push(new THREE.Vector2(r, -t * len));
    }
    pts.push(new THREE.Vector2(0, 0));
    return new THREE.LatheGeometry(pts, seg);
}

/** Closed lathe from [[y, r], ...] listed bottom -> top; optional partial sweep (front half etc). */
function latheY(rows, seg = 16, phiStart = 0, phiLen = Math.PI * 2, closed = true) {
    const pts = [];
    if (closed) pts.push(new THREE.Vector2(0, rows[0][0]));
    for (const [y, r] of rows) pts.push(new THREE.Vector2(r, y));
    if (closed) pts.push(new THREE.Vector2(0, rows[rows.length - 1][0]));
    return new THREE.LatheGeometry(pts, seg, phiStart, phiLen);
}

/** Box with rounded edges (vertices pushed onto a rounded-box surface). */
function roundedBox(w, h, d, r, seg = 3) {
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const p = g.attributes.position;
    const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    const v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        c.set(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
        v.sub(c).normalize().multiplyScalar(r).add(c);
        p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
}

/** Flattened tapering spike for hair tufts; tip points down -Y. */
function tuftGeo(w, len, depth) {
    const g = new THREE.ConeGeometry(w, len, 7, 3);
    g.rotateX(Math.PI);
    g.translate(0, -len / 2, 0);
    g.scale(1, 1, depth);
    return g;
}

/** Merge parts [{geo, matrix}] into one indexed geometry (position/normal/uv). */
function mergeParts(parts) {
    let vCount = 0, iCount = 0;
    const prepared = parts.map(({ geo, matrix }) => {
        const g = geo.index ? geo : geo.clone().setIndex([...Array(geo.attributes.position.count).keys()]);
        vCount += g.attributes.position.count;
        iCount += g.index.count;
        return { g, matrix };
    });
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
    const idx = new (vCount > 65535 ? Uint32Array : Uint16Array)(iCount);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let vo = 0, io = 0;
    for (const { g, matrix } of prepared) {
        nm.getNormalMatrix(matrix);
        const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
        for (let i = 0; i < P.count; i++) {
            v.fromBufferAttribute(P, i).applyMatrix4(matrix);
            pos.set([v.x, v.y, v.z], (vo + i) * 3);
            v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
            nor.set([v.x, v.y, v.z], (vo + i) * 3);
            if (U) uv.set([U.getX(i), U.getY(i)], (vo + i) * 2);
        }
        const I = g.index.array;
        for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo;
        vo += P.count;
        io += I.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
}

function outlineMaterial(color, width) {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace(
            '#include <begin_vertex>',
            `vec3 transformed = position + normalize(normal) * ${width.toFixed(4)};`
        );
    };
    return m;
}

// ------------------------------------------------------------------ face texture

function faceTexture(p) {
    const W = 512, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = p.skinCss;
    g.fillRect(0, 0, W, H);
    // sphere uv: front (+Z) is u = 0.25; equator v = 0.5
    const cx = W * 0.25, ey = H * 0.44;
    // soft cheek blush
    for (const sx of [-1, 1]) {
        const gr = g.createRadialGradient(cx + sx * 34, ey + 30, 2, cx + sx * 34, ey + 30, 18);
        gr.addColorStop(0, 'rgba(255,120,140,0.35)');
        gr.addColorStop(1, 'rgba(255,120,140,0)');
        g.fillStyle = gr;
        g.fillRect(cx + sx * 34 - 20, ey + 10, 40, 40);
    }
    for (const sx of [-1, 1]) {
        const x = cx + sx * 25;
        // eye white
        g.fillStyle = '#f7f4ff';
        g.beginPath(); g.ellipse(x, ey, 12, 10, 0, 0, Math.PI * 2); g.fill();
        // iris (gradient) + pupil + highlight
        const ir = g.createLinearGradient(x, ey - 11, x, ey + 11);
        ir.addColorStop(0, p.irisTop); ir.addColorStop(1, p.irisBot);
        g.fillStyle = ir;
        g.beginPath(); g.ellipse(x + sx * -1.5, ey + 1, 7.5, 10, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#120a1e';
        g.beginPath(); g.ellipse(x + sx * -1.5, ey + 2, 3.5, 5.5, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(x + sx * -1.5 - 3, ey - 3, 2.6, 0, Math.PI * 2); g.fill();
        // heavy upper lash line (anime)
        g.strokeStyle = '#15101c'; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - sx * 14, ey - 3); g.quadraticCurveTo(x, ey - 15, x + sx * 14, ey - 6); g.stroke();
        // brow
        g.strokeStyle = p.browCss; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x - sx * 12, ey - 21); g.quadraticCurveTo(x + sx * 2, ey - 27, x + sx * 14, ey - 20); g.stroke();
    }
    // nose hint + mouth
    g.strokeStyle = 'rgba(150,80,80,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx + 1, ey + 18); g.lineTo(cx - 2, ey + 24); g.stroke();
    g.strokeStyle = '#8a3c4c'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx - 7, ey + 36); g.quadraticCurveTo(cx, ey + 38, cx + 7, ey + 35); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

// ------------------------------------------------------------------ model

/**
 * Stylized 3-tone anime/retro cel-shading ramp for Oni (2001) aesthetic.
 * Eliminates glossy plastic/mirror specular highlights and produces crisp anime shading planes.
 */
function makeCelGradientMap() {
    const data = new Uint8Array([
        95, 95, 95, 255,
        175, 175, 175, 255,
        255, 255, 255, 255
    ]);
    const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
}

const PALETTES = {
    konoko: {
        // Oni 2001 Konoko TCTF Assault Suit: deep indigo-violet bodysuit + matte purple-slate tactical vest
        suit: 0x262344, suit2: 0x1b1932, armor: 0x4b437a, trim: 0x2d3142, accent: 0x38bdf8,
        skin: 0xf4cfb8, skinCss: '#f4cfb8', hair: 0x7c3aed, hairEmissive: 0x190833,
        glove: 0x1e1d30, sole: 0x14151c, outline: 0x090812,
        irisTop: '#4b1d8f', irisBot: '#a855f7', browCss: '#4c1d95'
    },
    trooper: {
        // Oni 2001 Syndicate Striker: matte charcoal polymer armor + crimson tactical visor
        suit: 0x1e2028, suit2: 0x2a2d38, armor: 0x4a5060, trim: 0x2d303b, accent: 0xef4444,
        skin: 0x2e2a36, skinCss: '#2e2a36', hair: 0x15151b, hairEmissive: 0x000000,
        glove: 0x181920, sole: 0x0e0f14, outline: 0x06060a,
        irisTop: '#000', irisBot: '#000', browCss: '#000'
    }
};

export class CharacterModel {
    /**
     * @param {boolean} isP1  true = Konoko (TCTF), false = Syndicate trooper
     * @param {{outline?: boolean}} opts
     */
    constructor(isP1, opts = {}) {
        this.isP1 = isP1;
        this.p = PALETTES[isP1 ? 'konoko' : 'trooper'];
        this.k = isP1 ? 1 : 1.18; // limb girth multiplier
        this.useOutline = opts.outline !== false;
        this.meshes = [];         // flashable meshes (outline excluded)
        this.pending = new Map(); // joint -> Map(material -> parts[])
        this.outlineParts = new Map();

        // skeleton dimensions (body-local units, before the body's uniform scale)
        this.dims = {
            pelvisY: 0.97, hipX: 0.088, hipY: -0.05,
            thigh: 0.43, shin: 0.42, ankleH: 0.07, toeZ: 0.13,
            shoulderX: isP1 ? 0.172 : 0.19, upperArm: 0.27, foreArm: 0.245
        };

        this.makeMaterials();
        this.root = new THREE.Group();
        this.buildSkeleton();
        this.buildBody();
        if (isP1) this.buildKonoko(); else this.buildTrooper();
        this.bake();
    }

    makeMaterials() {
        const p = this.p;
        const grad = makeCelGradientMap();
        this.mat = {
            suit: new THREE.MeshToonMaterial({ color: p.suit, gradientMap: grad }),
            suit2: new THREE.MeshToonMaterial({ color: p.suit2, gradientMap: grad }),
            armor: new THREE.MeshToonMaterial({ color: p.armor, gradientMap: grad }),
            trim: new THREE.MeshToonMaterial({ color: p.trim, gradientMap: grad }),
            accent: new THREE.MeshBasicMaterial({ color: p.accent }),
            skin: new THREE.MeshToonMaterial({ color: p.skin, gradientMap: grad }),
            face: new THREE.MeshToonMaterial({ map: this.isP1 ? faceTexture(p) : null, color: this.isP1 ? 0xffffff : p.skin, gradientMap: grad }),
            hair: new THREE.MeshToonMaterial({ color: p.hair, gradientMap: grad }),
            glove: new THREE.MeshToonMaterial({ color: p.glove, gradientMap: grad }),
            sole: new THREE.MeshToonMaterial({ color: p.sole, gradientMap: grad })
        };
        this.matOutline = outlineMaterial(p.outline, this.isP1 ? 0.0085 : 0.0095);
    }

    // queue a part on a joint; baked later (one mesh per joint+material)
    part(joint, geo, mat, x = 0, y = 0, z = 0, opts = {}) {
        const o = new THREE.Object3D();
        o.position.set(x, y, z);
        if (opts.rot) o.rotation.set(...opts.rot);
        if (opts.scale) o.scale.set(...opts.scale);
        o.updateMatrix();
        if (!this.pending.has(joint)) this.pending.set(joint, new Map());
        const byMat = this.pending.get(joint);
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat).push({ geo, matrix: o.matrix.clone() });
        if (opts.outline !== false && mat !== this.mat.accent) {
            if (!this.outlineParts.has(joint)) this.outlineParts.set(joint, []);
            this.outlineParts.get(joint).push({ geo, matrix: o.matrix.clone() });
        }
    }

    bake() {
        for (const [joint, byMat] of this.pending) {
            for (const [mat, parts] of byMat) {
                const mesh = new THREE.Mesh(mergeParts(parts), mat);
                mesh.castShadow = mat !== this.mat.accent;
                mesh.userData.baseMat = mat;
                joint.add(mesh);
                this.meshes.push(mesh);
            }
        }
        if (this.useOutline) {
            for (const [joint, parts] of this.outlineParts) {
                const m = new THREE.Mesh(mergeParts(parts), this.matOutline);
                m.userData.outline = true;
                joint.add(m);
            }
        }
        this.pending.clear();
        this.outlineParts.clear();
    }

    joint(parent, x, y, z) {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        parent.add(g);
        return g;
    }

    buildSkeleton() {
        const d = this.dims;
        this.pelvis = this.joint(this.root, 0, d.pelvisY, 0);
        this.spine = this.joint(this.pelvis, 0, 0.07, 0);
        this.chest = this.joint(this.spine, 0, 0.19, 0);
        this.neck = this.joint(this.chest, 0, 0.27, -0.01);
        this.head = this.joint(this.neck, 0, 0.05, 0.005);
        this.hairSway = this.joint(this.head, 0, 0.12, -0.02);

        this.arms = {};
        this.legs = {};
        for (const side of [SIDE_L, SIDE_R]) {
            const key = side === SIDE_L ? 'l' : 'r';
            const sh = this.joint(this.chest, d.shoulderX * side, 0.2, -0.005);
            sh.rotation.order = 'YXZ';
            const el = this.joint(sh, 0, -d.upperArm, 0);
            const fist = this.joint(el, 0, -d.foreArm, 0);
            const tip = this.joint(fist, 0, -0.07, 0.01);
            this.arms[key] = { sh, el, fist, tip };

            const hip = this.joint(this.pelvis, d.hipX * side, d.hipY, 0);
            const knee = this.joint(hip, 0, -d.thigh, 0);
            const ankle = this.joint(knee, 0, -d.shin, 0);
            const toe = this.joint(ankle, 0, -d.ankleH + 0.01, d.toeZ);
            this.legs[key] = { hip, knee, ankle, toe };
        }
    }

    /** Shared anatomy: smooth bodysuit limbs/torso, hands, boots. */
    buildBody() {
        const m = this.mat, d = this.dims, k = this.k, F = this.isP1;

        // pelvis / hips (wider for Konoko), z-flattened
        const hipW = F ? 0.152 : 0.16;
        this.part(this.pelvis, latheY([[-0.13, 0.05], [-0.1, hipW * 0.82], [-0.05, hipW], [0.0, hipW * 0.98], [0.06, hipW * 0.83], [0.1, 0.112 * k]]),
            m.suit, 0, 0, 0, { scale: [1, 1, 0.68] });
        // abdomen
        this.part(this.spine, latheY([[-0.03, 0.112 * k], [0.06, (F ? 0.102 : 0.118)], [0.15, 0.112 * k], [0.22, 0.128 * k]]),
            m.suit, 0, 0, 0, { scale: [1, 1, 0.66] });
        // ribcage + chest
        const cw = F ? 0.15 : 0.18;
        this.part(this.chest, latheY([[-0.05, 0.12 * k], [0.04, cw * 0.95], [0.13, cw], [0.21, cw * 0.97], [0.26, cw * 0.78], [0.3, 0.05]], 12),
            m.suit, 0, 0, 0, { scale: [1, 1, 0.66] });
        // neck
        this.part(this.neck, limbGeo(0.09, [[0, 0.04 * k], [1, 0.047 * k]], 12), F ? m.skin : m.suit2, 0, 0.07, 0);
        // trapezius slope to shoulders
        for (const s of [SIDE_L, SIDE_R]) {
            this.part(this.chest, new THREE.SphereGeometry(0.06 * k, 12, 10), m.suit, s * 0.1, 0.235, -0.012, { scale: [1.5, 0.75, 1] });
        }

        for (const side of [SIDE_L, SIDE_R]) {
            const A = this.arms[side === SIDE_L ? 'l' : 'r'];
            this.part(A.sh, new THREE.SphereGeometry(0.056 * k, 14, 10), m.suit, 0, -0.01, 0);
            this.part(A.sh, limbGeo(d.upperArm, [[0, 0.054 * k], [0.25, 0.05 * k], [0.7, 0.04 * k], [1, 0.036 * k]]), m.suit);
            this.part(A.el, new THREE.SphereGeometry(0.037 * k, 12, 8), m.suit);
            this.part(A.el, limbGeo(d.foreArm, [[0, 0.037 * k], [0.22, 0.041 * k], [0.7, 0.031 * k], [1, 0.027 * k]]), m.suit);
            // fist: rounded knuckle block + thumb
            this.part(A.fist, roundedBox(0.07 * k, 0.085 * k, 0.078 * k, 0.026 * k), m.glove, 0, -0.04, 0.008);
            this.part(A.fist, roundedBox(0.026, 0.05, 0.03, 0.012), m.glove, side * -0.03 * k, -0.035, 0.03, { rot: [0.3, 0, side * 0.4] });
            this.part(A.fist, roundedBox(0.075 * k, 0.012, 0.03, 0.005), m.accent, 0, -0.072, 0.03);

            const L = this.legs[side === SIDE_L ? 'l' : 'r'];
            this.part(L.hip, new THREE.SphereGeometry(0.083 * k, 14, 10), m.suit, 0, -0.01, 0);
            this.part(L.hip, limbGeo(d.thigh, [[0, 0.085 * k], [0.18, 0.083 * k], [0.55, 0.068 * k], [0.88, 0.054 * k], [1, 0.05 * k]]), m.suit);
            this.part(L.knee, new THREE.SphereGeometry(0.051 * k, 12, 10), m.suit);
            this.part(L.knee, limbGeo(d.shin, [[0, 0.05 * k], [0.22, 0.054 * k], [0.45, 0.047 * k], [0.8, 0.036 * k], [1, 0.032 * k]]),
                m.suit, 0, 0, -0.004, { scale: [0.95, 1, 1.05] });
            // boot: shaft + foot + sole
            this.part(L.knee, limbGeo(0.17, [[0, 0.05 * k], [1, 0.042 * k]], 14), F ? m.armor : m.trim, 0, -d.shin + 0.17, 0);
            this.part(L.ankle, roundedBox(0.085 * k, 0.07, 0.2, 0.03), F ? m.armor : m.trim, 0, -0.03, 0.045);
            this.part(L.ankle, roundedBox(0.09 * k, 0.022, 0.215, 0.01), m.sole, 0, -d.ankleH + 0.011, 0.047);
            this.part(L.ankle, roundedBox(0.09 * k, 0.008, 0.06, 0.003), m.accent, 0, -0.03, 0.15, { rot: [0.5, 0, 0] });
        }
    }

    buildKonoko() {
        const m = this.mat, d = this.dims;
        // ---- head: face sphere with painted anime face
        const headG = new THREE.SphereGeometry(0.098, 26, 18);
        this.part(this.head, headG, m.face, 0, 0.1, 0.004, { scale: [0.9, 1.04, 0.98] });
        // jaw / chin taper
        this.part(this.head, new THREE.SphereGeometry(0.055, 16, 12), m.skin, 0, 0.055, 0.022, { scale: [1.15, 0.95, 1], outline: false });
        // ears hidden by hair; headset
        for (const s of [SIDE_L, SIDE_R]) {
            this.part(this.head, new THREE.CylinderGeometry(0.022, 0.022, 0.016, 14), m.trim, s * 0.088, 0.09, 0, { rot: [0, 0, Math.PI / 2] });
            this.part(this.head, new THREE.CylinderGeometry(0.012, 0.012, 0.018, 12), m.accent, s * 0.093, 0.09, 0, { rot: [0, 0, Math.PI / 2] });
        }

        // ---- hair: short purple bob with jagged bangs (Konoko)
        const H = this.head, S = this.hairSway;
        this.part(H, new THREE.SphereGeometry(0.111, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), m.hair, 0, 0.112, -0.008, { scale: [1, 1.04, 1.06], rot: [-0.45, 0, 0] });
        // back volume (sways)
        this.part(S, new THREE.SphereGeometry(0.115, 22, 16, Math.PI * 0.85, Math.PI * 1.3, Math.PI * 0.2, Math.PI * 0.62), m.hair, 0, -0.02, -0.012, { scale: [1.08, 1.0, 1.02] });
        // bob ends: tufts around the back/side rim
        const tuft = tuftGeo(0.034, 0.12, 0.55);
        for (let i = 0; i < 9; i++) {
            const a = Math.PI * (0.32 + i * 0.17);           // around the back
            const x = Math.cos(a) * 0.1, z = -Math.abs(Math.sin(a)) * 0.095 - 0.01;
            this.part(S, tuft, m.hair, x, -0.03, z, { rot: [-0.25 + Math.sin(a) * 0.05, -a + Math.PI / 2, x * 2.2] });
        }
        // side locks framing the face
        const lock = tuftGeo(0.032, 0.17, 0.5);
        for (const s of [SIDE_L, SIDE_R]) {
            this.part(S, lock, m.hair, s * 0.093, 0.0, 0.05, { rot: [0.12, 0, s * 0.1] });
            this.part(S, tuftGeo(0.028, 0.13, 0.5), m.hair, s * 0.098, -0.005, 0.0, { rot: [0.05, 0, s * 0.2] });
        }
        // bangs
        const bang = tuftGeo(0.03, 0.085, 0.42);
        const bx = [-0.07, -0.042, -0.014, 0.016, 0.044, 0.07];
        bx.forEach((x, i) => {
            this.part(H, bang, m.hair, x, 0.205, 0.082 - Math.abs(x) * 0.25,
                { rot: [-0.42, x * 1.5, -x * 3.0], scale: [1, 0.8 + (i % 3) * 0.15, 1] });
        });

        // ---- armor: TCTF white plating
        const cw = 0.15;
        // chest plate (front half shell)
        this.part(this.chest, latheY([[0.02, cw * 0.98], [0.11, cw * 1.06], [0.2, cw * 1.04], [0.25, cw * 0.86]], 24, -Math.PI * 0.42, Math.PI * 0.84, false),
            m.armor, 0, 0, 0.004, { scale: [1, 1, 0.72] });
        // core light
        this.part(this.chest, new THREE.CircleGeometry(0.02, 18), m.accent, 0, 0.13, 0.112);
        // collar
        this.part(this.chest, new THREE.TorusGeometry(0.058, 0.016, 8, 20), m.trim, 0, 0.27, 0, { rot: [Math.PI / 2, 0, 0] });
        // back pack + glowing spine strips
        this.part(this.chest, roundedBox(0.17, 0.2, 0.06, 0.025), m.trim, 0, 0.13, -0.1);
        for (const s of [-1, 1]) this.part(this.chest, roundedBox(0.012, 0.15, 0.01, 0.004), m.accent, s * 0.05, 0.13, -0.133);
        // abdominal suit panels + belt
        this.part(this.spine, roundedBox(0.12, 0.13, 0.03, 0.012), m.suit2, 0, 0.09, 0.064);
        this.part(this.pelvis, new THREE.TorusGeometry(0.15, 0.018, 8, 28), m.trim, 0, 0.055, 0, { rot: [Math.PI / 2, 0, 0], scale: [1, 0.7, 1] });
        this.part(this.pelvis, roundedBox(0.055, 0.035, 0.02, 0.008), m.accent, 0, 0.055, 0.11);
        // thigh holster on the near (right) side
        this.part(this.legs.r.hip, roundedBox(0.05, 0.13, 0.1, 0.015), m.trim, -0.08, -0.12, 0.0);

        for (const side of [SIDE_L, SIDE_R]) {
            const A = this.arms[side === SIDE_L ? 'l' : 'r'];
            // shoulder pauldron
            this.part(A.sh, new THREE.SphereGeometry(0.074, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), m.armor, side * 0.012, 0.012, 0, { scale: [1.05, 0.85, 1.1], rot: [0, 0, side * 0.35] });
            this.part(A.sh, roundedBox(0.008, 0.004, 0.09, 0.002), m.accent, side * 0.05, 0.03, 0, { rot: [0, 0, side * 0.6] });
            // gauntlet
            this.part(A.el, limbGeo(0.15, [[0, 0.046], [0.5, 0.042], [1, 0.035]], 12), m.armor, 0, -0.08, 0);
            this.part(A.el, roundedBox(0.008, 0.11, 0.008, 0.003), m.accent, side * 0.042, -0.15, 0);

            const L = this.legs[side === SIDE_L ? 'l' : 'r'];
            // knee guard + shin plate (front shell)
            this.part(L.knee, new THREE.SphereGeometry(0.056, 14, 10, -Math.PI / 2, Math.PI, 0, Math.PI), m.armor, 0, 0.005, 0.012, { scale: [1, 1.2, 1] });
            this.part(L.knee, latheY([[-d.shin + 0.17, 0.05], [-0.25, 0.056], [-0.07, 0.06]], 16, -Math.PI * 0.4, Math.PI * 0.8, false), m.armor, 0, 0, 0.003);
            this.part(L.knee, roundedBox(0.008, 0.12, 0.008, 0.003), m.accent, 0, -0.17, 0.06);
            // thigh accent seam
            this.part(L.hip, roundedBox(0.006, 0.26, 0.006, 0.002), m.accent, side * 0.074, -0.2, 0.02);
        }
    }

    buildTrooper() {
        const m = this.mat;
        const H = this.head;
        // helmet + glowing visor + respirator
        this.part(H, new THREE.SphereGeometry(0.118, 20, 14), m.armor, 0, 0.11, -0.008, { scale: [1, 1.03, 1.1] });
        this.part(H, latheY([[0.09, 0.121], [0.135, 0.121]], 24, -Math.PI * 0.4, Math.PI * 0.8, false), m.accent, 0, 0, -0.005, { scale: [1, 1, 1.08], outline: false });
        this.part(H, roundedBox(0.1, 0.06, 0.07, 0.022), m.trim, 0, 0.04, 0.08);
        for (const s of [-1, 1]) this.part(H, new THREE.CylinderGeometry(0.022, 0.026, 0.03, 14), m.suit2, s * 0.05, 0.035, 0.11, { rot: [Math.PI / 2, 0, 0] });
        this.part(H, roundedBox(0.03, 0.05, 0.16, 0.012), m.trim, 0, 0.22, -0.02);
        for (const s of [-1, 1]) this.part(H, roundedBox(0.03, 0.08, 0.08, 0.012), m.trim, s * 0.115, 0.1, -0.01);

        // heavy chest rig
        this.part(this.chest, roundedBox(0.34, 0.22, 0.2, 0.05), m.armor, 0, 0.13, 0.01);
        this.part(this.chest, roundedBox(0.22, 0.08, 0.04, 0.015), m.trim, 0, 0.06, 0.11);
        this.part(this.chest, roundedBox(0.04, 0.02, 0.01, 0.005), m.accent, 0.07, 0.19, 0.115);
        this.part(this.chest, roundedBox(0.24, 0.26, 0.1, 0.03), m.trim, 0, 0.12, -0.13);
        this.part(this.spine, roundedBox(0.24, 0.12, 0.16, 0.03), m.suit2, 0, 0.1, 0);
        this.part(this.pelvis, new THREE.TorusGeometry(0.16, 0.022, 8, 28), m.trim, 0, 0.055, 0, { rot: [Math.PI / 2, 0, 0], scale: [1, 0.72, 1] });
        for (const s of [-1, 1]) this.part(this.pelvis, roundedBox(0.06, 0.08, 0.04, 0.012), m.trim, s * 0.08, 0.02, 0.1);

        for (const side of [SIDE_L, SIDE_R]) {
            const A = this.arms[side === SIDE_L ? 'l' : 'r'];
            this.part(A.sh, new THREE.SphereGeometry(0.095, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.armor, side * 0.015, 0.015, 0, { scale: [1.1, 0.9, 1.1], rot: [0, 0, side * 0.3] });
            this.part(A.sh, roundedBox(0.03, 0.006, 0.08, 0.003), m.accent, side * 0.07, 0.04, 0, { rot: [0, 0, side * 0.55], outline: false });
            this.part(A.el, limbGeo(0.17, [[0, 0.054], [0.6, 0.05], [1, 0.042]], 12), m.armor, 0, -0.06, 0);
            const L = this.legs[side === SIDE_L ? 'l' : 'r'];
            this.part(L.knee, roundedBox(0.1, 0.12, 0.08, 0.03), m.armor, 0, -0.02, 0.03);
            this.part(L.hip, roundedBox(0.12, 0.18, 0.14, 0.035), m.armor, side * 0.01, -0.16, 0.02);
            this.part(L.knee, roundedBox(0.006, 0.1, 0.006, 0.002), m.accent, 0, -0.2, 0.065, { outline: false });
        }
    }
}
