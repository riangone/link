/**
 * Link Spin 3D - Procedural 3D Stadium Mesh
 * High-Precision Beveled Bowl Surface, Rotating Cyber Neon Rings,
 * Animated X-DASH Toothed Rails, Dynamic Pocket Hazard Glow,
 * Expanding Concentric Energy Ripple Waves, and Volumetric Championship Floodlights.
 */

import * as THREE from '../../vendor/three.module.js';
import {
    STADIUM_RADIUS,
    BOWL_DEPTH,
    RIM_HEIGHT,
    getBowlHeight,
    POCKET_ANGLES,
    POCKET_HALF_ANGLE,
    RAIL_ARCS,
    RAIL_RADIUS_MIN,
    RAIL_RADIUS_MAX
} from '../core/Constants.js';

export class StadiumMesh {
    constructor() {
        this.group = new THREE.Group();
        this.hazardMeshes = [];
        this.rotatingNeonRings = [];
        this.railPulses = [];
        this.railToothMeshes = [];
        this.spotlightCones = [];
        this.rippleRings = [];
        this.centerPulse = null;
        this.time = 0;

        this.buildBowl();
        this.buildRails();
        this.buildPockets();
        this.buildCyberNeonRings();
        this.buildArenaSurround();
        this.buildConcentricRipples();
        this.buildChampionshipSpotlights();
    }

    buildBowl() {
        // Construct Lathe profile points for mathematically accurate parabolic bowl
        const points = [];
        const segments = 48;
        for (let i = 0; i <= segments; i++) {
            const r = (i / segments) * STADIUM_RADIUS;
            const y = getBowlHeight(r);
            points.push(new THREE.Vector2(r, y));
        }
        // Outer rim lip with smooth chamfer
        points.push(new THREE.Vector2(STADIUM_RADIUS + 0.8, RIM_HEIGHT * 0.92));
        points.push(new THREE.Vector2(STADIUM_RADIUS + 2.0, RIM_HEIGHT));
        points.push(new THREE.Vector2(STADIUM_RADIUS + 5.5, RIM_HEIGHT));
        points.push(new THREE.Vector2(STADIUM_RADIUS + 6.0, 0.0));

        const latheGeo = new THREE.LatheGeometry(points, 72);
        latheGeo.computeVertexNormals();

        // High-Precision Procedural Sci-Fi Grid & Cyber Marking Texture
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // Dark brushed carbon graphite background
        ctx.fillStyle = '#0a0d16';
        ctx.fillRect(0, 0, 1024, 1024);

        // Subtle tech grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        const gridStep = 32;
        for (let x = 0; x <= 1024; x += gridStep) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1024); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(1024, x); ctx.stroke();
        }

        // Concentric stadium rings (precision calibrated to 3D radiuses)
        for (let rad = 50; rad < 480; rad += 45) {
            const isMajor = rad % 90 === 0;
            ctx.strokeStyle = isMajor ? 'rgba(0, 240, 255, 0.55)' : 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = isMajor ? 3 : 1.5;
            ctx.beginPath();
            ctx.arc(512, 512, rad, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Concentric dashed tech rings
        ctx.save();
        ctx.setLineDash([12, 12]);
        ctx.strokeStyle = 'rgba(255, 0, 127, 0.5)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(512, 512, 220, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(512, 512, 380, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();

        // Center Vortex Emblem & Crosshairs
        ctx.strokeStyle = 'rgba(255, 0, 127, 0.9)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(512, 512, 50, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(512, 220); ctx.lineTo(512, 804);
        ctx.moveTo(220, 512); ctx.lineTo(804, 512);
        ctx.stroke();

        // Arena quadrant ticks
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const r1 = 440, r2 = 470;
            ctx.strokeStyle = i % 3 === 0 ? '#00f0ff' : 'rgba(255,255,255,0.35)';
            ctx.lineWidth = i % 3 === 0 ? 3.5 : 1.5;
            ctx.beginPath();
            ctx.moveTo(512 + Math.cos(a) * r1, 512 + Math.sin(a) * r1);
            ctx.lineTo(512 + Math.cos(a) * r2, 512 + Math.sin(a) * r2);
            ctx.stroke();
        }

        const bowlTex = new THREE.CanvasTexture(canvas);
        bowlTex.wrapS = THREE.RepeatWrapping;
        bowlTex.wrapT = THREE.RepeatWrapping;

        const bowlMat = new THREE.MeshStandardMaterial({
            map: bowlTex,
            roughness: 0.28,
            metalness: 0.78,
            color: 0x1a1f32
        });

        this.bowlMesh = new THREE.Mesh(latheGeo, bowlMat);
        this.bowlMesh.receiveShadow = true;
        this.group.add(this.bowlMesh);

        // Center Vortex Glowing Disc
        const centerVortexGeo = new THREE.RingGeometry(0.1, 4.2, 32);
        centerVortexGeo.rotateX(-Math.PI * 0.5);
        this.centerPulseMat = new THREE.MeshBasicMaterial({
            color: 0xff007f,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending
        });
        this.centerPulse = new THREE.Mesh(centerVortexGeo, this.centerPulseMat);
        this.centerPulse.position.y = 0.06;
        this.group.add(this.centerPulse);

        // Center Cyan Ring
        const centerRingGeo = new THREE.RingGeometry(4.2, 4.7, 36);
        centerRingGeo.rotateX(-Math.PI * 0.5);
        const centerRingMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending
        });
        const centerRing = new THREE.Mesh(centerRingGeo, centerRingMat);
        centerRing.position.y = 0.08;
        this.group.add(centerRing);
    }

    buildRails() {
        // Build 3D Xtreme Line with protruding gear teeth and neon plasma core
        const railMat = new THREE.MeshStandardMaterial({
            color: 0x24283b,
            roughness: 0.18,
            metalness: 0.92
        });

        this.toothMat = new THREE.MeshStandardMaterial({
            color: 0xffbb00,
            emissive: 0xff7700,
            emissiveIntensity: 0.8,
            roughness: 0.18,
            metalness: 0.95
        });

        this.neonStripMat = new THREE.MeshBasicMaterial({
            color: 0xffcc00,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending
        });

        const railRadius = (RAIL_RADIUS_MIN + RAIL_RADIUS_MAX) * 0.5;

        for (const arc of RAIL_ARCS) {
            const arcLength = arc.end - arc.start;
            const segments = 36;

            // Curved rail body
            const curvePoints = [];
            for (let i = 0; i <= segments; i++) {
                const angle = arc.start + (i / segments) * arcLength;
                const r = railRadius;
                const y = getBowlHeight(r) + 0.25;
                curvePoints.push(new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
            }

            const railCurve = new THREE.CatmullRomCurve3(curvePoints);
            const railGeo = new THREE.TubeGeometry(railCurve, 36, 0.48, 8, false);
            const railMesh = new THREE.Mesh(railGeo, railMat);
            railMesh.castShadow = true;
            this.group.add(railMesh);

            // Glowing crest line
            const neonGeo = new THREE.TubeGeometry(railCurve, 36, 0.18, 6, false);
            const neonMesh = new THREE.Mesh(neonGeo, this.neonStripMat);
            neonMesh.position.y += 0.38;
            this.group.add(neonMesh);

            // Protruding Mechanical Gear Teeth along the inner track
            const toothCount = 22;
            const toothGeo = new THREE.BoxGeometry(0.42, 0.42, 0.65);
            for (let t = 0; t < toothCount; t++) {
                const tAngle = arc.start + (t / toothCount) * arcLength;
                const toothMesh = new THREE.Mesh(toothGeo, this.toothMat);
                const ty = getBowlHeight(railRadius) + 0.35;
                toothMesh.position.set(Math.cos(tAngle) * railRadius, ty, Math.sin(tAngle) * railRadius);
                toothMesh.rotation.y = -tAngle + Math.PI * 0.5;
                toothMesh.castShadow = true;
                this.group.add(toothMesh);
                this.railToothMeshes.push(toothMesh);
            }
        }
    }

    buildPockets() {
        // Two knockout pockets at 0 and PI with dynamic hazard glow rings
        const pocketHoleMat = new THREE.MeshBasicMaterial({ color: 0x020205 });

        for (const baseAngle of POCKET_ANGLES) {
            const px = Math.cos(baseAngle) * (STADIUM_RADIUS - 1.5);
            const pz = Math.sin(baseAngle) * (STADIUM_RADIUS - 1.5);
            const py = getBowlHeight(STADIUM_RADIUS - 1.5);

            // Pocket dark drop box
            const holeGeo = new THREE.CylinderGeometry(2.9, 3.4, 6.0, 18);
            const hole = new THREE.Mesh(holeGeo, pocketHoleMat);
            hole.position.set(px, py - 3.0, pz);
            this.group.add(hole);

            // Warning Hazard Arch over pocket
            const archCurve = new THREE.EllipseCurve(0, 0, 3.4, 3.4, 0, Math.PI, false, 0);
            const archPts = archCurve.getPoints(24).map(p => new THREE.Vector3(p.x, p.y, 0));
            const archGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 24, 0.32, 8, false);

            const hazardMat = new THREE.MeshBasicMaterial({
                color: 0xff1744,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending
            });
            const arch = new THREE.Mesh(archGeo, hazardMat);
            arch.position.set(px, py + 0.25, pz);
            arch.rotation.y = -baseAngle + Math.PI * 0.5;
            this.group.add(arch);

            // Red Laser Hazard Grid across pocket mouth
            for (let l = -1; l <= 1; l++) {
                const laserGeo = new THREE.CylinderGeometry(0.08, 0.08, 5.2, 6);
                laserGeo.rotateZ(Math.PI * 0.5);
                const laserMat = new THREE.MeshBasicMaterial({
                    color: 0xff0044,
                    transparent: true,
                    opacity: 0.75,
                    blending: THREE.AdditiveBlending
                });
                const laserMesh = new THREE.Mesh(laserGeo, laserMat);
                laserMesh.position.set(px, py + 0.8 + l * 0.8, pz);
                laserMesh.rotation.y = -baseAngle;
                this.group.add(laserMesh);
            }

            // Dynamic Pulsing Hazard Disc in front of pocket
            const hazardRingGeo = new THREE.RingGeometry(1.0, 3.6, 24);
            hazardRingGeo.rotateX(-Math.PI * 0.5);
            const dynamicHazardMat = new THREE.MeshBasicMaterial({
                color: 0xff0033,
                transparent: true,
                opacity: 0.25,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });
            const hazardDisc = new THREE.Mesh(hazardRingGeo, dynamicHazardMat);
            hazardDisc.position.set(px * 0.9, py + 0.08, pz * 0.9);
            this.group.add(hazardDisc);

            this.hazardMeshes.push({
                baseAngle,
                x: px,
                z: pz,
                mat: dynamicHazardMat,
                archMat: hazardMat
            });
        }
    }

    buildCyberNeonRings() {
        const ringRadius = STADIUM_RADIUS + 3.8;
        const ringY = RIM_HEIGHT + 0.25;
        const arcCount = 6;
        const arcSpread = 0.65; // radians per arc

        const ringGroup = new THREE.Group();

        for (let i = 0; i < arcCount; i++) {
            const isCyan = i % 2 === 0;
            const col = isCyan ? 0x00f0ff : 0xff007f;

            const curve = new THREE.EllipseCurve(0, 0, ringRadius, ringRadius, 0, arcSpread, false, 0);
            const pts = curve.getPoints(18).map(p => new THREE.Vector3(p.x, 0, p.y));
            const tubeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.28, 8, false);

            const tubeMat = new THREE.MeshBasicMaterial({
                color: col,
                transparent: true,
                opacity: 0.85,
                blending: THREE.AdditiveBlending
            });

            const mesh = new THREE.Mesh(tubeGeo, tubeMat);
            mesh.rotation.y = (i / arcCount) * Math.PI * 2;
            ringGroup.add(mesh);
        }

        ringGroup.position.y = ringY;
        this.neonRingsGroup = ringGroup;
        this.group.add(this.neonRingsGroup);
    }

    buildArenaSurround() {
        // Outer stadium deck & illuminated LED borders
        const outerRingGeo = new THREE.TorusGeometry(STADIUM_RADIUS + 5.0, 0.45, 12, 72);
        outerRingGeo.rotateX(Math.PI * 0.5);
        const outerRingMat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.95
        });
        const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
        outerRing.position.y = RIM_HEIGHT + 0.05;
        this.group.add(outerRing);

        // Ground arena base plane
        const groundGeo = new THREE.PlaneGeometry(240, 240);
        groundGeo.rotateX(-Math.PI * 0.5);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x05060b,
            roughness: 0.88,
            metalness: 0.3
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.position.y = -0.05;
        ground.receiveShadow = true;
        this.group.add(ground);
    }

    buildConcentricRipples() {
        // Concentric animated neon ripple tracks expanding across bowl
        for (let i = 0; i < 3; i++) {
            const ringGeo = new THREE.RingGeometry(0.2, 0.8, 36);
            ringGeo.rotateX(-Math.PI * 0.5);
            const mat = new THREE.MeshBasicMaterial({
                color: i % 2 === 0 ? 0x00f0ff : 0xff007f,
                transparent: true,
                opacity: 0.0,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(ringGeo, mat);
            mesh.position.y = 0.12;
            this.group.add(mesh);
            this.rippleRings.push({ mesh, mat, progress: i * 0.33 });
        }
    }

    buildChampionshipSpotlights() {
        // 4 Volumetric Spotlight Cones in stadium corners pointing at arena bowl
        const towerCoords = [
            [-40, 40],
            [40, 40],
            [-40, -40],
            [40, -40]
        ];

        const coneGeo = new THREE.ConeGeometry(9.0, 34.0, 16, 1, true);
        coneGeo.rotateX(Math.PI); // Point down

        for (const [tx, tz] of towerCoords) {
            const col = (tx * tz > 0) ? 0x00f0ff : 0xff007f;
            const coneMat = new THREE.MeshBasicMaterial({
                color: col,
                transparent: true,
                opacity: 0.12,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.set(tx * 0.85, 20.0, tz * 0.85);
            // Angle towards arena center
            cone.lookAt(0, 0, 0);
            cone.rotateX(Math.PI * 0.5);
            this.group.add(cone);
            this.spotlightCones.push({ mesh: cone, mat: coneMat, baseColor: col, ox: tx, oz: tz });
        }
    }

    /**
     * Per-frame animation: rotates cyber neon rings, pulses center vortex,
     * ripples energy waves across bowl, animates spotlights, and pulses rails when tops engage.
     */
    update(t1, t2, dt) {
        this.time += dt;

        // 1. Smoothly rotate cyber neon rings around arena rim
        if (this.neonRingsGroup) {
            this.neonRingsGroup.rotation.y += dt * 0.45;
        }

        // 2. Pulse center vortex core
        if (this.centerPulseMat) {
            const pulse = 0.35 + 0.25 * Math.sin(this.time * 4.0);
            this.centerPulseMat.opacity = pulse;
            this.centerPulse.scale.set(1 + pulse * 0.25, 1, 1 + pulse * 0.25);
        }

        // 3. Dynamic Concentric Energy Ripples expanding from center to rim
        for (const rip of this.rippleRings) {
            rip.progress = (rip.progress + dt * 0.25) % 1.0;
            const r = rip.progress * (STADIUM_RADIUS * 0.95);
            const y = getBowlHeight(r) + 0.08;
            rip.mesh.position.y = y;
            const scale = Math.max(0.1, r);
            rip.mesh.scale.set(scale, scale, scale);
            // Smooth bell curve opacity
            const fade = Math.sin(rip.progress * Math.PI);
            rip.mat.opacity = fade * 0.35;
        }

        // 4. Spotlight Cones gentle sway
        for (let i = 0; i < this.spotlightCones.length; i++) {
            const sc = this.spotlightCones[i];
            const sway = Math.sin(this.time * 0.8 + i * 1.5) * 4.0;
            sc.mesh.position.x = sc.ox * 0.85 + sway;
        }

        // 5. Rail Overdrive Animation when a top is on rail
        const tops = [t1, t2];
        const isRailEngaged = tops.some(t => t && t.status === 'spinning' && (t.isOnRail || t.xdashTimer > 0));
        if (this.toothMat) {
            if (isRailEngaged) {
                const intenseFlash = 0.8 + 0.4 * Math.sin(this.time * 24.0);
                this.toothMat.emissiveIntensity = 1.4 * intenseFlash;
                this.toothMat.emissive.setHex(0xffffff);
            } else {
                this.toothMat.emissiveIntensity = 0.75 + 0.2 * Math.sin(this.time * 3.0);
                this.toothMat.emissive.setHex(0xff7700);
            }
        }

        // 6. Dynamic Pocket Danger Glow (Intensifies as tops get near pocket gates)
        for (const h of this.hazardMeshes) {
            let maxDanger = 0;
            for (const t of tops) {
                if (!t || t.status !== 'spinning') continue;
                const distToPocket = Math.hypot(t.x - h.x, t.z - h.z);
                if (distToPocket < 16.0) {
                    const danger = 1.0 - (distToPocket / 16.0);
                    if (danger > maxDanger) maxDanger = danger;
                }
            }

            if (maxDanger > 0) {
                const flash = (0.4 + 0.5 * Math.sin(this.time * 12.0)) * maxDanger;
                h.mat.opacity = 0.25 + flash * 0.75;
                h.archMat.color.setHex(flash > 0.4 ? 0xff3b30 : 0xff1744);
            } else {
                h.mat.opacity = 0.2;
                h.archMat.color.setHex(0xff1744);
            }
        }
    }
}
