/**
 * Link Spin 3D - 3D Top-to-Top Collision & Combat Resolution
 * Elastic Momentum Exchange, Realistic Burst Gauge Attrition,
 * Contact Friction Spin Decay, Spark Contacts, and Finishes.
 *
 * Tuned to match classic Beyblade physics: tops are sturdy and resilient,
 * clashing dozens of times with intense sparks and spin attrition.
 * Only heavy dashes, X-DASH impacts, specials, or exhausted spin lead to bursts!
 */

export class CollisionSystem3D {
    static checkAndResolve(t1, t2, events = []) {
        if (t1.status !== 'spinning' || t2.status !== 'spinning') return false;

        const dx = t1.x - t2.x;
        const dy = t1.y - t2.y;
        const dz = t1.z - t2.z;
        const dist = Math.hypot(dx, dy, dz);
        const rSum = t1.core.radius + t2.core.radius;

        if (dist >= rSum || dist < 0.0001) return false;

        // Collision Normal (pointing from t2 to t1)
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        // Position Separation (prevent interpenetration)
        const overlap = rSum - dist;
        const totalMass = t1.core.mass + t2.core.mass;
        const m1Ratio = t2.core.mass / totalMass;
        const m2Ratio = t1.core.mass / totalMass;

        t1.x += nx * overlap * m1Ratio;
        t1.y += ny * overlap * m1Ratio;
        t1.z += nz * overlap * m1Ratio;

        t2.x -= nx * overlap * m2Ratio;
        t2.y -= ny * overlap * m2Ratio;
        t2.z -= nz * overlap * m2Ratio;

        // Relative Velocity
        const rvx = t1.vx - t2.vx;
        const rvy = t1.vy - t2.vy;
        const rvz = t1.vz - t2.vz;
        const normVel = rvx * nx + rvy * ny + rvz * nz;

        // If separating already, return
        if (normVel > 0) return false;

        // Collision Energy & Restitution
        const e = 0.82; // Bouncy metallic collision
        const impulseMag = -(1 + e) * normVel / (1 / t1.core.mass + 1 / t2.core.mass);

        // Apply Linear Velocity Changes
        t1.vx += (impulseMag / t1.core.mass) * nx;
        t1.vy += (impulseMag / t1.core.mass) * ny * 0.35 + 0.8; // Controlled vertical hop
        t1.vz += (impulseMag / t1.core.mass) * nz;

        t2.vx -= (impulseMag / t2.core.mass) * nx;
        t2.vy -= (impulseMag / t2.core.mass) * ny * 0.35 + 0.8;
        t2.vz -= (impulseMag / t2.core.mass) * nz;

        // Combat Intensity (velocity + spin factors)
        const approachSpeed = Math.max(0, -normVel);
        const spinFactor = (t1.spin + t2.spin) / 200.0;
        const baseIntensity = approachSpeed * 0.75 + spinFactor * 2.2;

        // Buffs from Dash, X-DASH & Special Moves
        const t1Dash = (t1.dashTimer > 0 ? 1.35 : 1.0);
        const t2Dash = (t2.dashTimer > 0 ? 1.35 : 1.0);
        const t1Buff = (t1.xdashTimer > 0 ? 1.4 : 1.0) * (t1.specialActiveTimer > 0 ? 1.7 : 1.0) * t1Dash;
        const t2Buff = (t2.xdashTimer > 0 ? 1.4 : 1.0) * (t2.specialActiveTimer > 0 ? 1.7 : 1.0) * t2Dash;

        // Burst Damage Resolution (Tops are solid! No instant bursting on gentle contact)
        // Gentle rubs don't hurt burst gauge; only impactful collisions or specials chip it.
        let dmgToT2 = 0;
        let dmgToT1 = 0;

        const lowSpinFactor2 = 1.0 + Math.max(0, (50 - t2.spin) / 50) * 0.6;
        const lowSpinFactor1 = 1.0 + Math.max(0, (50 - t1.spin) / 50) * 0.6;

        if (baseIntensity > 1.6 || t1Buff > 1.1 || t2Buff > 1.1) {
            const raw1 = Math.pow(Math.max(0.2, baseIntensity - 1.2), 1.2);
            dmgToT2 = (raw1 * 0.85 * t1.core.attackPower * t1Buff * lowSpinFactor2) /
                      (t2.core.defenseFactor * t2.core.burstResist);
            dmgToT1 = (raw1 * 0.85 * t2.core.attackPower * t2Buff * lowSpinFactor1) /
                      (t1.core.defenseFactor * t1.core.burstResist);
        }

        // Apply burst reduction
        t2.burstHp = Math.max(0, t2.burstHp - dmgToT2);
        t1.burstHp = Math.max(0, t1.burstHp - dmgToT1);

        // Spin Decay from Contact Friction (spin loss is the primary attrition during battle)
        const spinLoss1 = (0.35 + baseIntensity * 0.3) * (t2.core.attackPower / t1.core.defenseFactor);
        const spinLoss2 = (0.35 + baseIntensity * 0.3) * (t1.core.attackPower / t2.core.defenseFactor);
        t1.spin = Math.max(0, t1.spin - spinLoss1);
        t2.spin = Math.max(0, t2.spin - spinLoss2);

        // Build Special Gauge on Impact
        t1.specialGauge = Math.min(100, t1.specialGauge + 10 + baseIntensity * 0.4);
        t2.specialGauge = Math.min(100, t2.specialGauge + 10 + baseIntensity * 0.4);

        // Clash Contact Point (midpoint in 3D)
        const cx = (t1.x + t2.x) * 0.5;
        const cy = (t1.y + t2.y) * 0.5;
        const cz = (t1.z + t2.z) * 0.5;

        events.push({
            type: 'clash',
            x: cx,
            y: cy,
            z: cz,
            nx: nx,
            ny: ny,
            nz: nz,
            intensity: baseIntensity * Math.max(t1Buff, t2Buff),
            isCritical: baseIntensity > 7.0 || t1Buff > 1.3 || t2Buff > 1.3
        });

        // Check for Burst Finish (0 HP)
        if (t1.burstHp <= 0 && t2.burstHp <= 0) {
            t1.triggerBurst();
            t2.triggerBurst();
            events.push({ type: 'burst', victim: t1.spin < t2.spin ? 0 : 1 });
        } else if (t2.burstHp <= 0) {
            t2.triggerBurst();
            events.push({ type: 'burst', victim: 1, winner: 0 });
        } else if (t1.burstHp <= 0) {
            t1.triggerBurst();
            events.push({ type: 'burst', victim: 0, winner: 1 });
        }

        return true;
    }
}
