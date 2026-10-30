/**
 * Link Spin 3D - High-Velocity Neon Light Ribbon Trail System
 * Generates dynamic blazing 3D ribbon trails following tops,
 * with explosive width & glow boosts during Dash and X-DASH.
 */

import * as THREE from '../../vendor/three.module.js';

export class TrailSystem3D {
    constructor(scene) {
        this.scene = scene;
        this.maxPoints = 30; // History length per top
        this.trails = [];

        // Pre-allocate ribbons for P1 and P2
        this.trails.push(this.createRibbon(0xff2d78, 0x00f0ff)); // P1: Hot-pink / Magenta with Cyan core
        this.trails.push(this.createRibbon(0x00f0ff, 0xffd34d)); // P2: Electric Cyan with Golden core
    }

    createRibbon(outerHex, innerHex) {
        // Ribbon is a triangle strip of (maxPoints - 1) quads = (maxPoints - 1) * 2 triangles
        const quadCount = this.maxPoints - 1;
        const vertexCount = quadCount * 6; // 6 vertices per quad (2 triangles)

        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 3);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        this.scene.add(mesh);

        return {
            mesh,
            geometry,
            material,
            positions,
            colors,
            history: [],
            outerColor: new THREE.Color(outerHex),
            innerColor: new THREE.Color(innerHex),
            whiteColor: new THREE.Color(0xffffff)
        };
    }

    clear() {
        for (const trail of this.trails) {
            trail.history.length = 0;
            trail.positions.fill(0);
            trail.colors.fill(0);
            trail.geometry.attributes.position.needsUpdate = true;
            trail.geometry.attributes.color.needsUpdate = true;
        }
    }

    /**
     * Updates trails for tops array [t1, t2]
     */
    update(tops, dt) {
        for (let i = 0; i < tops.length && i < this.trails.length; i++) {
            const top = tops[i];
            const trail = this.trails[i];

            if (top.status !== 'spinning') {
                if (trail.history.length > 0) {
                    trail.history.shift(); // Fade out rapidly
                }
                this.rebuildRibbonMesh(trail, top);
                continue;
            }

            // Record current position
            const speed = Math.hypot(top.vx, top.vz);
            const isMoving = speed > 0.8 || top.isDashing || top.xdashTimer > 0;

            if (isMoving) {
                // Determine width based on state
                let width = 0.9;
                if (top.specialActiveTimer > 0) width = 2.4;
                else if (top.xdashTimer > 0) width = 2.6;
                else if (top.isDashing) width = 1.8;
                else width = 0.8 + Math.min(0.6, speed * 0.03);

                // Add to history head
                trail.history.unshift({
                    x: top.x,
                    y: top.y + 0.15,
                    z: top.z,
                    vx: top.vx,
                    vz: top.vz,
                    width,
                    isXdash: top.xdashTimer > 0,
                    isDash: top.isDashing || top.specialActiveTimer > 0
                });

                if (trail.history.length > this.maxPoints) {
                    trail.history.pop();
                }
            } else if (trail.history.length > 0) {
                trail.history.pop();
            }

            this.rebuildRibbonMesh(trail, top);
        }
    }

    rebuildRibbonMesh(trail, top) {
        const hist = trail.history;
        const positions = trail.positions;
        const colors = trail.colors;
        const count = hist.length;

        if (count < 2) {
            positions.fill(0);
            colors.fill(0);
            trail.geometry.attributes.position.needsUpdate = true;
            trail.geometry.attributes.color.needsUpdate = true;
            return;
        }

        let vIdx = 0;
        let cIdx = 0;

        for (let k = 0; k < count - 1; k++) {
            const p0 = hist[k];
            const p1 = hist[k + 1];

            // Direction between segment points
            let dx = p1.x - p0.x;
            let dz = p1.z - p0.z;
            let len = Math.hypot(dx, dz);
            if (len < 0.0001) {
                dx = 0; dz = 1; len = 1;
            }
            dx /= len;
            dz /= len;

            // Perpendicular tangent vector in horizontal plane
            const nx = -dz;
            const nz = dx;

            // Half widths
            const hw0 = (p0.width || 0.9) * 0.5;
            const hw1 = (p1.width || 0.9) * 0.5;

            // Quad corners:
            // v0: p0 left,  v1: p0 right
            // v2: p1 left,  v3: p1 right
            const v0x = p0.x - nx * hw0, v0y = p0.y, v0z = p0.z - nz * hw0;
            const v1x = p0.x + nx * hw0, v1y = p0.y, v1z = p0.z + nz * hw0;
            const v2x = p1.x - nx * hw1, v2y = p1.y, v2z = p1.z - nz * hw1;
            const v3x = p1.x + nx * hw1, v3y = p1.y, v3z = p1.z + nz * hw1;

            // Fading alpha and luminous colors
            const alpha0 = Math.pow(1.0 - k / count, 1.4);
            const alpha1 = Math.pow(1.0 - (k + 1) / count, 1.4);

            let baseCol0 = p0.isXdash ? trail.innerColor : trail.outerColor;
            let baseCol1 = p1.isXdash ? trail.innerColor : trail.outerColor;

            // Triangle 1: (v0, v1, v2)
            positions[vIdx++] = v0x; positions[vIdx++] = v0y; positions[vIdx++] = v0z;
            colors[cIdx++] = baseCol0.r * alpha0; colors[cIdx++] = baseCol0.g * alpha0; colors[cIdx++] = baseCol0.b * alpha0;

            positions[vIdx++] = v1x; positions[vIdx++] = v1y; positions[vIdx++] = v1z;
            colors[cIdx++] = (p0.isDash ? 1.0 : baseCol0.r) * alpha0;
            colors[cIdx++] = (p0.isDash ? 1.0 : baseCol0.g) * alpha0;
            colors[cIdx++] = (p0.isDash ? 1.0 : baseCol0.b) * alpha0;

            positions[vIdx++] = v2x; positions[vIdx++] = v2y; positions[vIdx++] = v2z;
            colors[cIdx++] = baseCol1.r * alpha1; colors[cIdx++] = baseCol1.g * alpha1; colors[cIdx++] = baseCol1.b * alpha1;

            // Triangle 2: (v1, v3, v2)
            positions[vIdx++] = v1x; positions[vIdx++] = v1y; positions[vIdx++] = v1z;
            colors[cIdx++] = (p0.isDash ? 1.0 : baseCol0.r) * alpha0;
            colors[cIdx++] = (p0.isDash ? 1.0 : baseCol0.g) * alpha0;
            colors[cIdx++] = (p0.isDash ? 1.0 : baseCol0.b) * alpha0;

            positions[vIdx++] = v3x; positions[vIdx++] = v3y; positions[vIdx++] = v3z;
            colors[cIdx++] = (p1.isDash ? 1.0 : baseCol1.r) * alpha1;
            colors[cIdx++] = (p1.isDash ? 1.0 : baseCol1.g) * alpha1;
            colors[cIdx++] = (p1.isDash ? 1.0 : baseCol1.b) * alpha1;

            positions[vIdx++] = v2x; positions[vIdx++] = v2y; positions[vIdx++] = v2z;
            colors[cIdx++] = baseCol1.r * alpha1; colors[cIdx++] = baseCol1.g * alpha1; colors[cIdx++] = baseCol1.b * alpha1;
        }

        // Zero out unused vertices
        while (vIdx < positions.length) {
            positions[vIdx++] = 0;
            colors[cIdx++] = 0;
        }

        trail.geometry.attributes.position.needsUpdate = true;
        trail.geometry.attributes.color.needsUpdate = true;
    }
}
