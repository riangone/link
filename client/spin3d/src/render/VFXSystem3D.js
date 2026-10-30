/**
 * Link Spin 3D - High-Impact 3D Visual Effects System
 * Extreme Metal Clash Spark Showers, Dual Expanding Shockwave Rings,
 * Trail Ribbons, Scrape Embers, and Supernova Burst Explosions.
 */

import * as THREE from '../../vendor/three.module.js';

export class VFXSystem3D {
    constructor(scene) {
        this.scene = scene;
        this.sparks = [];
        this.maxSparks = 600; // Increased pool for massive clash showers

        // Particle Buffer Geometry for Metal Sparks
        const sparkPositions = new Float32Array(this.maxSparks * 3);
        const sparkColors = new Float32Array(this.maxSparks * 3);

        this.sparkGeo = new THREE.BufferGeometry();
        this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
        this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));

        this.sparkMat = new THREE.PointsMaterial({
            size: 0.85,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false
        });

        this.sparkPoints = new THREE.Points(this.sparkGeo, this.sparkMat);
        this.scene.add(this.sparkPoints);

        // Pre-allocate spark particle pool
        for (let i = 0; i < this.maxSparks; i++) {
            this.sparks.push({
                active: false,
                x: 0, y: 0, z: 0,
                vx: 0, vy: 0, vz: 0,
                r: 1, g: 0.8, b: 0.2,
                life: 0,
                maxLife: 1.0,
                gravity: 28.0
            });
        }

        // Dual Shockwave Ring Mesh Pool (Horizontal planar rings)
        this.shockwaves = [];
        const shockGeo = new THREE.RingGeometry(0.5, 1.4, 36);
        shockGeo.rotateX(-Math.PI * 0.5);
        for (let i = 0; i < 16; i++) {
            const shockMat = new THREE.MeshBasicMaterial({
                color: 0xffaa00,
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(shockGeo, shockMat);
            mesh.visible = false;
            this.scene.add(mesh);
            this.shockwaves.push({ mesh, active: false, scale: 1, maxScale: 20, life: 0, maxLife: 0.55 });
        }

        // Sonic Boom Mach Rings Pool
        this.machRings = [];
        const machGeo = new THREE.TorusGeometry(1.6, 0.22, 8, 24);
        for (let i = 0; i < 6; i++) {
            const machMat = new THREE.MeshBasicMaterial({
                color: 0x00f0ff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(machGeo, machMat);
            mesh.visible = false;
            this.scene.add(mesh);
            this.machRings.push({ mesh, active: false, life: 0, maxLife: 0.45, vx: 0, vy: 0, vz: 0 });
        }

        // Nova Burst Energy Spheres (Burst Finish Supernova Flash)
        this.novaSpheres = [];
        const novaGeo = new THREE.SphereGeometry(1.0, 16, 16);
        for (let i = 0; i < 4; i++) {
            const novaMat = new THREE.MeshBasicMaterial({
                color: 0xffe600,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(novaGeo, novaMat);
            mesh.visible = false;
            this.scene.add(mesh);
            this.novaSpheres.push({ mesh, active: false, life: 0 });
        }
    }

    clear() {
        for (const p of this.sparks) {
            p.active = false;
        }
        for (const sw of this.shockwaves) {
            sw.active = false;
            sw.mesh.visible = false;
        }
        for (const mr of this.machRings) {
            mr.active = false;
            mr.mesh.visible = false;
        }
        for (const ns of this.novaSpheres) {
            ns.active = false;
            ns.mesh.visible = false;
        }
        const positions = this.sparkGeo.attributes.position.array;
        for (let i = 0; i < this.maxSparks * 3; i++) {
            positions[i] = 999;
        }
        this.sparkGeo.attributes.position.needsUpdate = true;
    }

    emitClashSparks(x, y, z, nx = 0, ny = 0, nz = 0, intensity = 1.0) {
        // High density spark shower with tangential cone explosion
        const count = Math.min(100, Math.floor(36 * intensity));
        let spawned = 0;

        for (let i = 0; i < this.maxSparks && spawned < count; i++) {
            const p = this.sparks[i];
            if (p.active) continue;

            p.active = true;
            p.x = x;
            p.y = y;
            p.z = z;

            const sprayAngle = Math.random() * Math.PI * 2;
            const spraySpeed = (10.0 + Math.random() * 24.0) * Math.min(2.5, intensity);

            // Tangent plane calculation
            const tx = -nz;
            const tz = nx;
            const tLen = Math.hypot(tx, tz) || 1;

            p.vx = (tx / tLen) * Math.cos(sprayAngle) * spraySpeed + (Math.random() - 0.5) * 8.0;
            p.vy = Math.sin(sprayAngle) * spraySpeed * 0.7 + 6.0 + Math.random() * 9.0;
            p.vz = (tz / tLen) * Math.cos(sprayAngle) * spraySpeed + (Math.random() - 0.5) * 8.0;

            // Intense white-hot, gold, and electric orange sparks
            const rVal = Math.random();
            if (rVal < 0.5) {
                p.r = 1.0; p.g = 1.0; p.b = 0.95; // White-hot
            } else if (rVal < 0.82) {
                p.r = 1.0; p.g = 0.88; p.b = 0.2; // Golden amber
            } else {
                p.r = 1.0; p.g = 0.35; p.b = 0.05; // Fiery crimson
            }

            p.life = 0.45 + Math.random() * 0.45;
            p.maxLife = p.life;
            p.gravity = 26.0;
            spawned++;
        }
    }

    spawnImpactSparks(x, y, z, nx = 0, nz = 0, count = 28) {
        const intensity = count / 16.0;
        this.emitClashSparks(x, y, z, nx, 0, nz, intensity);
        // Dual expanding ground shockwave rings
        this.emitShockwave(x, y, z, 0xffe600, 9.0 * Math.min(2.2, intensity));
        this.emitShockwave(x, y, z, 0x00f0ff, 14.0 * Math.min(2.0, intensity));
    }

    emitSonicBoom(x, y, z, vx = 0, vz = 0, color = 0x00f0ff) {
        for (const mr of this.machRings) {
            if (!mr.active) {
                mr.active = true;
                mr.mesh.visible = true;
                mr.mesh.position.set(x, y + 0.4, z);
                mr.mesh.scale.set(0.4, 0.4, 0.4);
                mr.maxLife = 0.38;
                mr.life = mr.maxLife;
                mr.mesh.material.color.setHex(color);
                mr.vx = -vx * 0.15;
                mr.vz = -vz * 0.15;
                // Align ring perpendicular to motion
                const angle = Math.atan2(vz, vx);
                mr.mesh.rotation.set(0, -angle + Math.PI * 0.5, 0);
                break;
            }
        }
    }

    spawnRailSparks(x, y, z) {
        this.emitClashSparks(x, y, z, 0, 1, 0, 2.2);
        this.emitShockwave(x, y, z, 0x00f0ff, 10.0);
    }

    emitScrapeSparks(x, y, z) {
        let spawned = 0;
        for (let i = 0; i < this.maxSparks && spawned < 6; i++) {
            const p = this.sparks[i];
            if (p.active) continue;

            p.active = true;
            p.x = x + (Math.random() - 0.5) * 0.5;
            p.y = y + 0.1;
            p.z = z + (Math.random() - 0.5) * 0.5;

            p.vx = (Math.random() - 0.5) * 6.0;
            p.vy = 2.5 + Math.random() * 3.5;
            p.vz = (Math.random() - 0.5) * 6.0;

            p.r = 1.0; p.g = 0.6; p.b = 0.1;
            p.life = 0.25 + Math.random() * 0.2;
            p.maxLife = p.life;
            p.gravity = 20.0;
            spawned++;
        }
    }

    emitShockwave(x, y, z, color = 0xffaa00, maxScale = 14.0) {
        for (const sw of this.shockwaves) {
            if (!sw.active) {
                sw.active = true;
                sw.mesh.visible = true;
                sw.mesh.position.set(x, y + 0.12, z);
                if (typeof color === 'string') {
                    sw.mesh.material.color.setStyle(color);
                } else {
                    sw.mesh.material.color.setHex(color);
                }
                sw.scale = 0.4;
                sw.maxScale = maxScale;
                sw.maxLife = 0.5;
                sw.life = sw.maxLife;
                break;
            }
        }
    }

    emitBurstShockwave(x, y, z, color = 0xff2d55) {
        // Massive double shockwave + Nova Flash
        this.emitShockwave(x, y, z, color, 24.0);
        this.emitShockwave(x, y, z, 0xffffff, 16.0);
        this.emitClashSparks(x, y, z, 0, 1, 0, 3.5);

        for (const ns of this.novaSpheres) {
            if (!ns.active) {
                ns.active = true;
                ns.mesh.visible = true;
                ns.mesh.position.set(x, y + 0.8, z);
                ns.mesh.scale.set(1, 1, 1);
                ns.life = 0.45;
                break;
            }
        }
    }

    spawnSpecialAura(x, y, z, color) {
        this.emitBurstShockwave(x, y, z, color || 0x00f0ff);
    }

    update(dt) {
        const positions = this.sparkGeo.attributes.position.array;
        const colors = this.sparkGeo.attributes.color.array;

        // Update active sparks
        for (let i = 0; i < this.maxSparks; i++) {
            const p = this.sparks[i];
            const idx = i * 3;

            if (p.active) {
                p.life -= dt;
                if (p.life <= 0) {
                    p.active = false;
                    positions[idx] = 999;
                    positions[idx + 1] = 999;
                    positions[idx + 2] = 999;
                    continue;
                }

                p.vy -= p.gravity * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.z += p.vz * dt;

                positions[idx] = p.x;
                positions[idx + 1] = p.y;
                positions[idx + 2] = p.z;

                const fade = Math.pow(p.life / p.maxLife, 1.2);
                colors[idx] = p.r * fade;
                colors[idx + 1] = p.g * fade;
                colors[idx + 2] = p.b * fade;
            } else {
                positions[idx] = 999;
                positions[idx + 1] = 999;
                positions[idx + 2] = 999;
            }
        }

        this.sparkGeo.attributes.position.needsUpdate = true;
        this.sparkGeo.attributes.color.needsUpdate = true;

        // Update shockwaves
        for (const sw of this.shockwaves) {
            if (sw.active) {
                sw.life -= dt;
                if (sw.life <= 0) {
                    sw.active = false;
                    sw.mesh.visible = false;
                } else {
                    const progress = 1.0 - (sw.life / sw.maxLife);
                    const curScale = 0.4 + Math.sin(progress * Math.PI * 0.5) * (sw.maxScale - 0.4);
                    sw.mesh.scale.set(curScale, curScale, curScale);
                    sw.mesh.material.opacity = (1.0 - progress) * 0.95;
                }
            }
        }

        // Update Mach Rings
        for (const mr of this.machRings) {
            if (mr.active) {
                mr.life -= dt;
                if (mr.life <= 0) {
                    mr.active = false;
                    mr.mesh.visible = false;
                } else {
                    const progress = 1.0 - (mr.life / mr.maxLife);
                    const s = 0.4 + progress * 3.2;
                    mr.mesh.scale.set(s, s, s);
                    mr.mesh.position.x += mr.vx * dt;
                    mr.mesh.position.z += mr.vz * dt;
                    mr.mesh.material.opacity = (1.0 - progress) * 0.9;
                }
            }
        }

        // Update Nova Spheres
        for (const ns of this.novaSpheres) {
            if (ns.active) {
                ns.life -= dt;
                if (ns.life <= 0) {
                    ns.active = false;
                    ns.mesh.visible = false;
                } else {
                    const progress = 1.0 - (ns.life / 0.45);
                    const s = 1.0 + progress * 14.0;
                    ns.mesh.scale.set(s, s, s);
                    ns.mesh.material.opacity = (1.0 - progress) * 0.85;
                }
            }
        }
    }
}
