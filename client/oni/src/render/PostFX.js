/**
 * PostFX - Minimal HDR bloom + ACES tonemap + vignette pipeline (no three/addons dependency)
 *
 *   scene ──► HDR RT (MSAA) ──► bright-pass ½ ──► blur ½ ──► blur ¼ ──► composite(tonemap, sRGB, vignette) ──► screen
 *
 * Disabled automatically when float render targets are unsupported, or via ?fx=0.
 */

import * as THREE from '../../vendor/three.module.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */`
uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float k = smoothstep(threshold, threshold + 0.6, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR = /* glsl */`
uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
void main() {
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  s += texture2D(tDiffuse, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tDiffuse, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB;
uniform float strength; uniform float exposure; uniform float flash; varying vec2 vUv;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 d = (vUv - 0.5);
  float ca = dot(d, d) * 0.006;                                  // subtle chromatic fringe at edges
  vec3 col;
  col.r = texture2D(tScene, vUv + d * ca * 4.0).r;
  col.g = texture2D(tScene, vUv).g;
  col.b = texture2D(tScene, vUv - d * ca * 4.0).b;
  col += (texture2D(tBloomA, vUv).rgb * 0.9 + texture2D(tBloomB, vUv).rgb * 0.7) * strength;
  col = aces(col * exposure);
  col = toSRGB(col);
  float vig = smoothstep(0.98, 0.35, length(d * vec2(1.1, 1.25)));
  col *= mix(0.88, 1.0, vig);
  col += flash;
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
    constructor(renderer) {
        this.renderer = renderer;
        this.enabled = true;
        this.flash = 0;

        const caps = renderer.capabilities;
        const qs = new URLSearchParams(location.search);
        if (qs.get('fx') === '0' || !caps.isWebGL2) {
            this.enabled = false;
            return;
        }

        const opts = { type: THREE.HalfFloatType, depthBuffer: false };
        this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
        this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
        this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
        this.rtC = new THREE.WebGLRenderTarget(1, 1, opts);
        this.rtD = new THREE.WebGLRenderTarget(1, 1, opts);

        this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        this.quad.frustumCulled = false;
        this.quadScene = new THREE.Scene();
        this.quadScene.add(this.quad);

        const mk = (frag, uniforms) => new THREE.ShaderMaterial({
            vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false
        });
        this.matBright = mk(BRIGHT, { tDiffuse: { value: null }, threshold: { value: 1.18 } });
        this.matBlur = mk(BLUR, { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } });
        this.matComposite = mk(COMPOSITE, {
            tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null },
            strength: { value: 0.28 }, exposure: { value: 1.30 }, flash: { value: 0 }
        });
    }

    setExposure(val) {
        if (this.matComposite && this.matComposite.uniforms && this.matComposite.uniforms.exposure) {
            this.matComposite.uniforms.exposure.value = val;
        }
    }

    setSize(w, h, pixelRatio) {
        if (!this.enabled) return;
        const W = Math.max(1, Math.floor(w * pixelRatio));
        const H = Math.max(1, Math.floor(h * pixelRatio));
        this.rtScene.setSize(W, H);
        this.rtA.setSize(W >> 1, H >> 1);
        this.rtB.setSize(W >> 1, H >> 1);
        this.rtC.setSize(W >> 2, H >> 2);
        this.rtD.setSize(W >> 2, H >> 2);
    }

    pass(mat, target) {
        this.quad.material = mat;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.quadScene, this.quadCam);
    }

    blur(src, tmp, w, h, spread) {
        const u = this.matBlur.uniforms;
        u.tDiffuse.value = src.texture; u.dir.value.set(spread / w, 0);
        this.pass(this.matBlur, tmp);
        u.tDiffuse.value = tmp.texture; u.dir.value.set(0, spread / h);
        this.pass(this.matBlur, src);
    }

    render(scene, camera) {
        const r = this.renderer;
        if (!this.enabled) {
            r.setRenderTarget(null);
            r.render(scene, camera);
            return;
        }
        r.setRenderTarget(this.rtScene);
        r.render(scene, camera);

        this.matBright.uniforms.tDiffuse.value = this.rtScene.texture;
        this.pass(this.matBright, this.rtA);
        this.blur(this.rtA, this.rtB, this.rtA.width, this.rtA.height, 1.0);

        this.matBlur.uniforms.tDiffuse.value = this.rtA.texture;
        this.matBlur.uniforms.dir.value.set(0, 0);
        this.pass(this.matBlur, this.rtC);               // downsample ½ -> ¼
        this.blur(this.rtC, this.rtD, this.rtC.width, this.rtC.height, 1.6);
        this.blur(this.rtC, this.rtD, this.rtC.width, this.rtC.height, 2.4);

        const u = this.matComposite.uniforms;
        u.tScene.value = this.rtScene.texture;
        u.tBloomA.value = this.rtA.texture;
        u.tBloomB.value = this.rtC.texture;
        u.flash.value = this.flash;
        this.pass(this.matComposite, null);
    }
}
