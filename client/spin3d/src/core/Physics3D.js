/**
 * Link Spin 3D - Physics Engine
 * 3D Bowl Surface Incline, Gyroscopic Precession & Wobble,
 * Xtreme Line Rail Engagement (X-DASH), Real-time Joystick/Key Inputs, and 3D Kinematics.
 */

import {
    FIXED_DT,
    STADIUM_RADIUS,
    BOWL_DEPTH,
    getBowlHeight,
    getBowlSlope,
    isInPocket,
    isOnRail,
    GRAVITY,
    BASE_SPIN_DRAIN,
    SCRAPE_SPIN_DRAIN,
    MAX_SPIN,
    MAX_BURST_HP,
    WOBBLE_SPIN_THRESHOLD,
    MAX_TILT_RAD
} from './Constants.js';

export class Top3D {
    constructor(id, core, ownerIdx = 0) {
        this.id = id;
        this.core = core;
        this.ownerIdx = ownerIdx; // 0: Player 1 (Host), 1: Player 2 (Client/Bot)

        // Transform in 3D Space
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;

        // Gyroscopic & Rotation
        this.spin = 0; // 0 - 100 RPM
        this.spinAngle = 0; // High speed spin around top axis
        this.spinDir = ownerIdx === 0 ? 1 : -1; // 1: CW, -1: CCW (Right vs Left spin)
        this.tiltAngle = 0; // Wobble lean angle (radians)
        this.precessionAngle = 0; // Direction of wobble lean (radians)

        // Combat Stats & States
        this.burstHp = MAX_BURST_HP;
        this.specialGauge = 0;
        this.specialActiveTimer = 0;
        this.dashTimer = 0;
        this.dashCooldown = 0;
        this.xdashTimer = 0;
        this.railAccum = 0;
        this.railCooldown = 0;
        this.isScraping = false;
        this.status = 'idle'; // 'idle', 'launching', 'spinning', 'bursted', 'over', 'sleep'

        // Procedural Burst Explosion Pieces
        this.burstPieces = [];
    }

    reset(spawnX, spawnZ, launchPower = 1.0, perfectLaunch = false) {
        this.x = spawnX;
        this.z = spawnZ;
        const groundY = getBowlHeight(Math.hypot(spawnX, spawnZ));
        this.y = groundY + 1.2; // Drop slightly onto stadium floor

        // Tangential initial launch velocity towards opponent/orbit
        const r = Math.hypot(spawnX, spawnZ);
        const tanX = -spawnZ / (r || 1);
        const tanZ = spawnX / (r || 1);
        const launchSpeed = (12.0 + launchPower * 10.0) * (perfectLaunch ? 1.15 : 1.0);

        this.vx = tanX * launchSpeed * (this.spinDir > 0 ? 1 : -1) * 0.7;
        this.vz = tanZ * launchSpeed * (this.spinDir > 0 ? 1 : -1) * 0.7;
        this.vy = -1.5; // Initial downward drop

        this.spin = Math.min(MAX_SPIN, (75.0 + launchPower * 25.0) * (perfectLaunch ? 1.1 : 1.0));
        this.spinAngle = 0;
        this.tiltAngle = 0;
        this.precessionAngle = 0;

        this.burstHp = MAX_BURST_HP;
        this.specialGauge = 15; // Starting special charge
        this.specialActiveTimer = 0;
        this.dashTimer = 0;
        this.dashCooldown = 0;
        this.xdashTimer = 0;
        this.railAccum = 0;
        this.railCooldown = 0;
        this.isScraping = false;
        this.status = 'spinning';
        this.burstPieces = [];
    }

    applyInput(ix, iz, dt) {
        if (this.status !== 'spinning') return;
        const mag = Math.hypot(ix, iz);
        if (mag > 0.05) {
            const nx = ix / (mag > 1 ? mag : 1);
            const nz = iz / (mag > 1 ? mag : 1);
            const accel = this.core.accel * 42.0;
            this.vx += (nx * accel / this.core.mass) * dt;
            this.vz += (nz * accel / this.core.mass) * dt;
        }
    }

    triggerDash(dirX = 0, dirZ = 0) {
        if (this.status !== 'spinning' || this.dashCooldown > 0 || this.spin < 8) return false;
        let dx = dirX;
        let dz = dirZ;
        const mag = Math.hypot(dx, dz);
        if (mag < 0.1) {
            const sp = Math.hypot(this.vx, this.vz);
            if (sp > 0.5) {
                dx = this.vx / sp;
                dz = this.vz / sp;
            } else {
                dx = 0;
                dz = this.ownerIdx === 0 ? -1 : 1;
            }
        } else {
            dx /= mag;
            dz /= mag;
        }
        const burstImpulse = (this.core.dashForce || 8.0) * 2.6;
        this.vx += (dx * burstImpulse / this.core.mass);
        this.vz += (dz * burstImpulse / this.core.mass);
        this.dashTimer = 0.55;
        this.dashCooldown = 1.4;
        this.spin = Math.max(0, this.spin - 1.2);
        return true;
    }

    triggerBurst() {
        if (this.status === 'bursted') return;
        this.status = 'bursted';
        this.burstHp = 0;
        this.spin = 0;

        // Disassemble into 4 3D flying pieces:
        // 0: Face Chip, 1: Attack Ring (Blades), 2: Metal Weight Disk, 3: Bit Tip
        const pieceConfigs = [
            { type: 'chip', name: 'Face Chip', mass: 0.1, vyBonus: 8.5 },
            { type: 'ring', name: 'Attack Ring', mass: 0.4, vyBonus: 5.5 },
            { type: 'disk', name: 'Weight Disk', mass: 0.7, vyBonus: 3.5 },
            { type: 'tip',  name: 'Bit Tip',     mass: 0.2, vyBonus: 2.0 }
        ];

        this.burstPieces = pieceConfigs.map((cfg, idx) => {
            const angle = (idx * Math.PI * 0.5) + (Math.random() - 0.5) * 0.6;
            const speed = 6.0 + Math.random() * 8.0;
            return {
                type: cfg.type,
                x: this.x,
                y: this.y + 0.3 * idx,
                z: this.z,
                vx: this.vx * 0.3 + Math.cos(angle) * speed,
                vy: cfg.vyBonus + Math.random() * 4.0,
                vz: this.vz * 0.3 + Math.sin(angle) * speed,
                rotX: Math.random() * Math.PI,
                rotY: Math.random() * Math.PI,
                rotZ: Math.random() * Math.PI,
                vrotX: (Math.random() - 0.5) * 20.0,
                vrotY: (Math.random() - 0.5) * 20.0,
                vrotZ: (Math.random() - 0.5) * 20.0,
                mass: cfg.mass
            };
        });
    }
}

export class Simulation3D {
    constructor() {
        this.events = [];
    }

    step(top, dt = FIXED_DT) {
        if (top.status === 'idle') return;

        // If bursted, simulate flying pieces
        if (top.status === 'bursted') {
            for (const piece of top.burstPieces) {
                piece.vy -= GRAVITY * dt;
                piece.x += piece.vx * dt;
                piece.y += piece.vy * dt;
                piece.z += piece.vz * dt;
                piece.rotX += piece.vrotX * dt;
                piece.rotY += piece.vrotY * dt;
                piece.rotZ += piece.vrotZ * dt;

                // Ground bounce for pieces
                const r = Math.hypot(piece.x, piece.z);
                const groundY = getBowlHeight(r);
                if (piece.y < groundY && r < STADIUM_RADIUS + 4.0) {
                    piece.y = groundY;
                    piece.vy = -piece.vy * 0.45;
                    piece.vx *= 0.75;
                    piece.vz *= 0.75;
                    piece.vrotX *= 0.6;
                    piece.vrotZ *= 0.6;
                }
            }
            return;
        }

        const r = Math.hypot(top.x, top.z);
        const inPocketNow = isInPocket(top.x, top.z);

        // Pocket Fall (Over Finish)
        if (inPocketNow || top.status === 'over') {
            top.status = 'over';
            top.vy -= GRAVITY * dt;
            top.x += top.vx * dt * 0.6;
            top.z += top.vz * dt * 0.6;
            top.y += top.vy * dt;
            top.spin = Math.max(0, top.spin - BASE_SPIN_DRAIN * 4.0 * dt);
            return;
        }

        // Standard Stadium Surface Dynamics
        const groundY = getBowlHeight(r);
        const slope = getBowlSlope(r);

        // Surface normal: normalized (-S * x/r, 1, -S * z/r)
        const nx = r > 0.001 ? -(slope * top.x / r) : 0;
        const nz = r > 0.001 ? -(slope * top.z / r) : 0;
        const nLen = Math.hypot(nx, 1.0, nz);
        const normX = nx / nLen;
        const normY = 1.0 / nLen;
        const normZ = nz / nLen;

        // Inward Slope Gravity Force (pushes top towards center bowl)
        const slopeForceMag = GRAVITY * (slope / nLen);
        const fxSlope = r > 0.001 ? -(top.x / r) * slopeForceMag : 0;
        const fzSlope = r > 0.001 ? -(top.z / r) * slopeForceMag : 0;

        top.vx += (fxSlope / top.core.mass) * dt;
        top.vz += (fzSlope / top.core.mass) * dt;

        // Keep top adhered to bowl surface unless airborne
        if (top.y > groundY + 0.05) {
            top.vy -= GRAVITY * dt;
        } else {
            top.y = groundY;
            top.vy = 0;
        }

        // Arena Outer Wall Collision / Rim Containment
        if (r > STADIUM_RADIUS - top.core.radius) {
            const overlap = r - (STADIUM_RADIUS - top.core.radius);
            const ux = top.x / (r || 1);
            const uz = top.z / (r || 1);

            // Push back from rim
            top.x -= ux * overlap;
            top.z -= uz * overlap;

            // Reflect radial velocity with restitution
            const dot = top.vx * ux + top.vz * uz;
            if (dot > 0) {
                top.vx -= (1 + 0.5) * dot * ux;
                top.vz -= (1 + 0.5) * dot * uz;
                top.spin = Math.max(0, top.spin - 1.2);
                this.events.push({ type: 'wall_hit', x: top.x, y: top.y, z: top.z, impulse: dot });
            }
        }

        // Dash Timers
        if (top.dashTimer > 0) top.dashTimer -= dt;
        if (top.dashCooldown > 0) top.dashCooldown -= dt;

        // Xtreme Line (Toothed Rail) Interaction
        if (top.railCooldown > 0) top.railCooldown -= dt;

        const onRailNow = isOnRail(top.x, top.z);
        if (onRailNow && top.spin > 15 && top.railCooldown <= 0) {
            top.railAccum += dt;
            // Tangential acceleration vector along rail
            const tanX = -top.z / (r || 1);
            const tanZ = top.x / (r || 1);
            const thrust = top.core.gearRatio * 45.0 * (top.spinDir > 0 ? 1 : -1);

            top.vx += (tanX * thrust / top.core.mass) * dt;
            top.vz += (tanZ * thrust / top.core.mass) * dt;

            // Trigger X-DASH
            if (top.railAccum >= 0.16 && top.xdashTimer <= 0) {
                top.xdashTimer = 1.35; // 1.35s X-DASH rush
                top.railCooldown = 3.5; // Cooldown before next rail bite
                this.events.push({
                    type: 'xdash',
                    ownerIdx: top.ownerIdx,
                    x: top.x,
                    y: top.y,
                    z: top.z
                });
            }
        } else {
            top.railAccum = Math.max(0, top.railAccum - dt * 2.0);
        }

        // Speed Limits with Dash / X-DASH Boosts
        const curSpeed = Math.hypot(top.vx, top.vz);
        let allowedMaxSpeed = top.core.maxSpeed;
        if (top.xdashTimer > 0) {
            top.xdashTimer -= dt;
            allowedMaxSpeed = top.core.maxSpeed * 1.5;
        } else if (top.dashTimer > 0) {
            allowedMaxSpeed = top.core.maxSpeed * 1.38;
        }

        if (curSpeed > allowedMaxSpeed) {
            top.vx = (top.vx / curSpeed) * allowedMaxSpeed;
            top.vz = (top.vz / curSpeed) * allowedMaxSpeed;
        }

        // Special Move Countdown
        if (top.specialActiveTimer > 0) {
            top.specialActiveTimer -= dt;
        }

        // Integrate Position
        top.x += top.vx * dt;
        top.y += top.vy * dt;
        top.z += top.vz * dt;

        // High Speed Spin Rotation
        const spinRadPerSec = (top.spin / MAX_SPIN) * 120.0 * top.spinDir;
        top.spinAngle += spinRadPerSec * dt;

        // Gyroscopic Precession & Wobble Dynamics
        if (top.spin < WOBBLE_SPIN_THRESHOLD) {
            const wobbleRatio = (WOBBLE_SPIN_THRESHOLD - top.spin) / WOBBLE_SPIN_THRESHOLD;
            top.tiltAngle = wobbleRatio * MAX_TILT_RAD;
            // Precession frequency increases as spin slows down (gyroscopic law)
            const precessionSpeed = (2.0 + wobbleRatio * 6.0) * Math.PI * 2;
            top.precessionAngle += precessionSpeed * dt;

            // Outer blade touches arena floor when heavily tilted
            if (top.tiltAngle > 0.18) {
                top.isScraping = true;
                top.spin = Math.max(0, top.spin - SCRAPE_SPIN_DRAIN * dt);
                if (Math.random() < 0.35) {
                    this.events.push({
                        type: 'scrape',
                        x: top.x,
                        y: top.y + 0.1,
                        z: top.z
                    });
                }
            } else {
                top.isScraping = false;
            }
        } else {
            top.tiltAngle = 0;
            top.isScraping = false;
        }

        // Natural Spin Decay
        const naturalDrain = BASE_SPIN_DRAIN * top.core.drainRate;
        top.spin = Math.max(0, top.spin - naturalDrain * dt);

        if (top.spin <= 0) {
            top.status = 'sleep'; // Spin Finish!
            top.vx *= 0.85;
            top.vz *= 0.85;
        }
    }
}
