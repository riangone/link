/**
 * Link Spin 3D - Procedural 3D Top (Beyblade) Mesh & 3D Visual Expressiveness
 * 4 Detachable Modular Layers:
 * 1. Bit Chip (Center Holographic Sacred Beast Emblem & Energy Lens)
 * 2. Attack Ring (Sharp Multi-Blade PBR Assembly + Glowing Energy Edges)
 * 3. Metal Weight Disk (Heavy Faceted Metallic Ring with Mirror Polish)
 * 4. Gear Bit Tip (Bottom Cone Pivot + Toothed Gear Collar)
 *
 * Plus High-Octane Anime Combat FX:
 * - Spiraling Elemental Energy Cyclone (Tornado vortex that rises with high RPM)
 * - Holographic Beast Glyph Ring (Floats above Bit Chip with tech brackets)
 * - Luminous Radial Blade Cutter Disc (High-speed motion blur)
 * - Sonic Boom Mach Cones (Backward shockwave rings during Dash & X-DASH)
 * - Ground Contact Decal & Dynamic Tilt Precession
 */

import * as THREE from '../../vendor/three.module.js';

export class BeyMesh {
    constructor(top) {
        this.top = top;
        this.group = new THREE.Group();

        // Separate modular component sub-groups for dynamic assembly & burst explosion
        this.chipMesh = null;
        this.ringMesh = null;
        this.diskMesh = null;
        this.tipMesh = null;

        // Visual expressiveness meshes
        this.spinBlurDisc = null;
        this.auraMesh = null;
        this.cycloneMesh = null;
        this.hologramRing = null;
        this.machRings = [];
        this.groundContactDisc = null;
        this.bladeMeshes = [];

        this.time = 0;
        this.buildComponents();
    }

    buildComponents() {
        const core = this.top.core;
        const col1 = new THREE.Color(core.color1);
        const col2 = new THREE.Color(core.color2);
        const metalCol = new THREE.Color(core.metalColor || 0xdbe2ea);

        // ----------------------------------------------------
        // 1. Bit Tip (Bottom Cone Pivot + Mechanical Gear Collar)
        // ----------------------------------------------------
        const tipGroup = new THREE.Group();
        // Lower tapered cone (sharp pivot point)
        const tipGeo = new THREE.ConeGeometry(0.48, 0.82, 16);
        tipGeo.rotateX(Math.PI); // Point downwards
        const tipMat = new THREE.MeshStandardMaterial({
            color: 0x1a1c24,
            roughness: 0.12,
            metalness: 0.92
        });
        const tipCone = new THREE.Mesh(tipGeo, tipMat);
        tipCone.position.y = -0.41;
        tipCone.castShadow = true;
        tipGroup.add(tipCone);

        // Gear Teeth Collar (mechanical engagement for Xtreme Line)
        const gearCollarGeo = new THREE.CylinderGeometry(0.88, 0.92, 0.38, 14);
        const gearMat = new THREE.MeshStandardMaterial({
            color: 0xffaa00,
            emissive: 0x884400,
            emissiveIntensity: 0.65,
            roughness: 0.18,
            metalness: 0.92
        });
        const gearCollar = new THREE.Mesh(gearCollarGeo, gearMat);
        gearCollar.position.y = 0.05;
        gearCollar.castShadow = true;
        tipGroup.add(gearCollar);

        this.tipMesh = tipGroup;
        this.group.add(this.tipMesh);

        // ----------------------------------------------------
        // 2. Heavy Metal Weight Disk (Mirror Chrome Finish + Hollow Cut-outs)
        // ----------------------------------------------------
        const diskGroup = new THREE.Group();
        const diskRadius = core.radius * 0.82;
        const diskGeo = new THREE.CylinderGeometry(diskRadius * 0.95, diskRadius, 0.44, 20);
        const diskMat = new THREE.MeshStandardMaterial({
            color: metalCol,
            roughness: 0.08,
            metalness: 0.98
        });
        const disk = new THREE.Mesh(diskGeo, diskMat);
        disk.position.y = 0.40;
        disk.castShadow = true;
        diskGroup.add(disk);

        // Outer Metallic Rim Ring with Chamfer
        const rimRingGeo = new THREE.TorusGeometry(diskRadius * 0.98, 0.14, 8, 24);
        rimRingGeo.rotateX(Math.PI * 0.5);
        const rimRing = new THREE.Mesh(rimRingGeo, diskMat);
        rimRing.position.y = 0.42;
        diskGroup.add(rimRing);

        // Weight Disk Cutouts (Hexagonal decorative bolt accents)
        const boltCount = 6;
        const boltGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.48, 6);
        const boltMat = new THREE.MeshStandardMaterial({
            color: 0x12141c,
            roughness: 0.3,
            metalness: 0.85
        });
        for (let k = 0; k < boltCount; k++) {
            const bAng = (k / boltCount) * Math.PI * 2;
            const bDist = diskRadius * 0.65;
            const bolt = new THREE.Mesh(boltGeo, boltMat);
            bolt.position.set(Math.cos(bAng) * bDist, 0.41, Math.sin(bAng) * bDist);
            diskGroup.add(bolt);
        }

        this.diskMesh = diskGroup;
        this.group.add(this.diskMesh);

        // ----------------------------------------------------
        // 3. Attack Ring (High-Performance Aerodynamic Blades + Neon Strips)
        // ----------------------------------------------------
        const ringGroup = new THREE.Group();
        ringGroup.position.y = 0.68;

        // Base Ring Hub
        const hubRadius = core.radius * 0.74;
        const baseRingGeo = new THREE.CylinderGeometry(hubRadius, hubRadius * 1.05, 0.32, 24);
        const baseRingMat = new THREE.MeshStandardMaterial({
            color: col1,
            roughness: 0.22,
            metalness: 0.7
        });
        const baseRing = new THREE.Mesh(baseRingGeo, baseRingMat);
        baseRing.castShadow = true;
        ringGroup.add(baseRing);

        // Procedural Custom Blades based on core Archetype
        const bladeCount = core.bladeCount || 3;
        const bladeLength = core.radius * 0.78;

        // Blade Material with bright Neon Emissive Edge
        const bladeMat = new THREE.MeshStandardMaterial({
            color: col2,
            emissive: col1,
            emissiveIntensity: 0.55,
            roughness: 0.15,
            metalness: 0.85
        });

        const neonEdgeMat = new THREE.MeshBasicMaterial({
            color: col2,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending
        });

        for (let b = 0; b < bladeCount; b++) {
            const bAngle = (b / bladeCount) * Math.PI * 2;
            const bladeSubGroup = new THREE.Group();

            // Main Strike Wing (Wedge-shaped box)
            const wingGeo = new THREE.BoxGeometry(0.88, 0.34, bladeLength);
            const wing = new THREE.Mesh(wingGeo, bladeMat);
            wing.position.set(0, 0, bladeLength * 0.5);
            wing.castShadow = true;
            bladeSubGroup.add(wing);

            // Glowing Leading Strike Edge
            const edgeGeo = new THREE.BoxGeometry(0.24, 0.36, bladeLength * 0.96);
            const edgeMesh = new THREE.Mesh(edgeGeo, neonEdgeMat);
            edgeMesh.position.set(0.44, 0.01, bladeLength * 0.5);
            bladeSubGroup.add(edgeMesh);

            // Position and rotate along ring perimeter
            bladeSubGroup.position.set(
                Math.cos(bAngle) * hubRadius * 0.8,
                0.05,
                Math.sin(bAngle) * hubRadius * 0.8
            );
            bladeSubGroup.rotation.y = -bAngle + 0.45 * (this.top.spinDir > 0 ? 1 : -1);

            ringGroup.add(bladeSubGroup);
            this.bladeMeshes.push(bladeSubGroup);
        }

        this.ringMesh = ringGroup;
        this.group.add(this.ringMesh);

        // ----------------------------------------------------
        // 4. Bit Chip (Central Sacred Holographic Emblem)
        // ----------------------------------------------------
        const chipGroup = new THREE.Group();
        chipGroup.position.y = 0.92;

        const chipGeo = new THREE.CylinderGeometry(0.78, 0.78, 0.22, 12);
        const chipMat = new THREE.MeshStandardMaterial({
            color: 0x0a0c14,
            roughness: 0.1,
            metalness: 0.6
        });
        const chipBase = new THREE.Mesh(chipGeo, chipMat);
        chipGroup.add(chipBase);

        // Glowing Sacred Center Eye Lens
        const lensGeo = new THREE.SphereGeometry(0.55, 18, 10);
        lensGeo.scale(1, 0.32, 1);
        const lensMat = new THREE.MeshStandardMaterial({
            color: col1,
            emissive: col2,
            emissiveIntensity: 1.3,
            roughness: 0.05,
            metalness: 0.1,
            transparent: true,
            opacity: 0.95
        });
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.position.y = 0.12;
        chipGroup.add(lens);

        // Floating Holographic Beast Glyph Ring (Floats right above the chip)
        const holoGeo = new THREE.RingGeometry(0.75, 1.15, 24);
        holoGeo.rotateX(-Math.PI * 0.5);
        this.holoMat = new THREE.MeshBasicMaterial({
            color: col2,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending
        });
        this.hologramRing = new THREE.Mesh(holoGeo, this.holoMat);
        this.hologramRing.position.y = 0.32;
        chipGroup.add(this.hologramRing);

        this.chipMesh = chipGroup;
        this.group.add(this.chipMesh);

        // ----------------------------------------------------
        // 5. Luminous High-Speed Spin Blur Disc
        // (Expands and shines intensely when RPM is high, recreating 2D spin feel)
        // ----------------------------------------------------
        const discRadius = core.radius * 1.38;
        const spinBlurGeo = new THREE.RingGeometry(0.6, discRadius, 36);
        spinBlurGeo.rotateX(-Math.PI * 0.5);

        this.spinBlurMat = new THREE.MeshBasicMaterial({
            color: col1,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending
        });
        this.spinBlurDisc = new THREE.Mesh(spinBlurGeo, this.spinBlurMat);
        this.spinBlurDisc.position.y = 0.52;
        this.group.add(this.spinBlurDisc);

        // ----------------------------------------------------
        // 6. Dynamic Anime Elemental Energy Cyclone (Tornado Vortex)
        // ----------------------------------------------------
        const cycloneGeo = new THREE.CylinderGeometry(core.radius * 1.8, core.radius * 0.7, 4.2, 18, 1, true);
        this.cycloneMat = new THREE.MeshBasicMaterial({
            color: col2,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.cycloneMesh = new THREE.Mesh(cycloneGeo, this.cycloneMat);
        this.cycloneMesh.position.y = 2.4;
        this.group.add(this.cycloneMesh);

        // ----------------------------------------------------
        // 7. Dynamic Power Aura Sphere (Bursting glow during Special / X-DASH)
        // ----------------------------------------------------
        const auraGeo = new THREE.SphereGeometry(core.radius * 1.6, 18, 18);
        this.auraMat = new THREE.MeshBasicMaterial({
            color: col2,
            transparent: true,
            opacity: 0.0,
            wireframe: true,
            blending: THREE.AdditiveBlending
        });
        this.auraMesh = new THREE.Mesh(auraGeo, this.auraMat);
        this.auraMesh.position.y = 0.55;
        this.group.add(this.auraMesh);

        // ----------------------------------------------------
        // 8. Ground Contact Shadow Disc
        // ----------------------------------------------------
        const groundShadowGeo = new THREE.RingGeometry(0.1, 1.4, 20);
        groundShadowGeo.rotateX(-Math.PI * 0.5);
        const groundShadowMat = new THREE.MeshBasicMaterial({
            color: 0x020208,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide
        });
        this.groundContactDisc = new THREE.Mesh(groundShadowGeo, groundShadowMat);
        this.groundContactDisc.position.y = -0.42;
        this.group.add(this.groundContactDisc);
    }

    update(arg1, arg2) {
        const dt = (typeof arg1 === 'number') ? arg1 : ((typeof arg2 === 'number') ? arg2 : 0.016);
        this.time += dt;
        const top = this.top;

        if (top.status === 'bursted') {
            // Disassembled 3D Burst Physics: each piece follows its own 3D ballistic trajectory
            const pieces = top.burstPieces;
            const meshes = [this.chipMesh, this.ringMesh, this.diskMesh, this.tipMesh];

            for (let i = 0; i < pieces.length && i < meshes.length; i++) {
                const p = pieces[i];
                const m = meshes[i];
                if (!m) continue;

                m.position.set(p.x - top.x, p.y - top.y, p.z - top.z);
                m.rotation.set(p.rotX, p.rotY, p.rotZ);
            }

            this.group.position.set(top.x, top.y, top.z);
            if (this.spinBlurMat) this.spinBlurMat.opacity = 0;
            if (this.auraMat) this.auraMat.opacity = 0;
            if (this.cycloneMat) this.cycloneMat.opacity = 0;
            if (this.groundContactDisc) this.groundContactDisc.visible = false;
            return;
        }

        // Standard Top World Position
        this.group.position.set(top.x, top.y, top.z);

        // Reset relative piece offsets to standard tight assembly
        this.tipMesh.position.set(0, 0, 0);
        this.tipMesh.rotation.set(0, 0, 0);

        this.diskMesh.position.set(0, 0, 0);
        this.diskMesh.rotation.set(0, 0, 0);

        this.ringMesh.position.set(0, 0, 0);
        this.ringMesh.rotation.set(0, 0, 0);

        this.chipMesh.position.set(0, 0, 0);
        this.chipMesh.rotation.set(0, 0, 0);

        if (this.groundContactDisc) this.groundContactDisc.visible = true;

        // Gyroscopic Wobble & Tilt Dynamics
        this.group.rotation.set(0, 0, 0);
        if (top.tiltAngle > 0.001) {
            const axisX = Math.cos(top.precessionAngle);
            const axisZ = Math.sin(top.precessionAngle);
            this.group.rotation.x = axisZ * top.tiltAngle;
            this.group.rotation.z = -axisX * top.tiltAngle;
        }

        // Ultra-High-Speed Spin Rotation
        this.group.rotateY(top.spinAngle);

        // Hologram beast glyph ring counter-rotates independently
        if (this.hologramRing) {
            this.hologramRing.rotation.z -= dt * 3.5;
            const pulse = 0.65 + 0.35 * Math.sin(this.time * 6.0);
            this.holoMat.opacity = top.status === 'spinning' ? pulse : 0.0;
        }

        // Spin Blur Disc Opacity & Scale Dynamics (High RPM = High Brilliance)
        const spinFactor = Math.max(0, Math.min(1.2, top.spin / 100.0));
        if (this.spinBlurMat) {
            if (top.status === 'spinning' && spinFactor > 0.15) {
                this.spinBlurMat.opacity = 0.2 + spinFactor * 0.55;
                const scale = 0.9 + spinFactor * 0.25;
                this.spinBlurDisc.scale.set(scale, scale, scale);
            } else {
                this.spinBlurMat.opacity = 0.0;
            }
        }

        // Elemental Energy Cyclone Vortex (Swirls and expands with spin)
        if (this.cycloneMesh && this.cycloneMat) {
            if (top.status === 'spinning' && spinFactor > 0.35) {
                const boost = top.specialActiveTimer > 0 ? 1.5 : (top.xdashTimer > 0 ? 1.3 : (top.isDashing ? 1.1 : 1.0));
                this.cycloneMat.opacity = (0.2 + spinFactor * 0.35) * boost;
                this.cycloneMesh.rotation.y += dt * (12.0 + spinFactor * 15.0);
                const s = (0.8 + spinFactor * 0.4) * boost;
                this.cycloneMesh.scale.set(s, 1.0 + spinFactor * 0.3, s);
            } else {
                this.cycloneMat.opacity = 0.0;
            }
        }

        // Special Aura Glow & X-DASH Pulsing
        if (this.auraMat) {
            if (top.specialActiveTimer > 0) {
                this.auraMat.opacity = 0.75 + 0.25 * Math.sin(this.time * 16.0);
                this.auraMesh.rotation.y += dt * 6.0;
                this.auraMesh.scale.setScalar(1.0 + 0.2 * Math.sin(this.time * 8.0));
            } else if (top.xdashTimer > 0) {
                this.auraMat.opacity = 0.65 + 0.25 * Math.sin(this.time * 20.0);
                this.auraMesh.rotation.y += dt * 10.0;
                this.auraMesh.scale.setScalar(1.0 + 0.15 * Math.sin(this.time * 12.0));
            } else if (top.isDashing) {
                this.auraMat.opacity = 0.45;
                this.auraMesh.rotation.y += dt * 7.0;
            } else {
                this.auraMat.opacity = 0.0;
            }
        }
    }
}
