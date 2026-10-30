/**
 * Weapons - Firearm Arsenal & 3D Ballistic Raycasting Pipeline (M2)
 *
 * Implements the 6 authentic Oni weapons, magazine / reserve ammo tracking,
 * 3D pitch/yaw raycast trajectory intersection against World geometry & fighters,
 * weapon swapping (via Action key E), and holster toggling (Q key).
 */

export const WEAPON_REGISTRY = {
    TCTF_PISTOL: {
        id: 'TCTF_PISTOL',
        name: 'TCTF 战术手枪 (Ballistic Pistol)',
        category: 'BALLISTIC',
        ammoType: 'BALLISTIC',
        clip: 10,
        maxReserve: 50,
        fireMode: 'semi',
        rof: 12,              // Ticks between shots (~5 rps)
        reloadFrames: 45,      // ~0.75s
        damage: 12,
        poiseDamage: 18,
        range: 30.0,
        spread: 0.02,
        projectile: 'hitscan',
        knockback: { x: 1.8, y: 0.2 },
        color: 0x00f0ff,
        causesDizzy: false
    },
    PLASMA_RIFLE: {
        id: 'PLASMA_RIFLE',
        name: '等离子冲锋枪 (Plasma Rifle)',
        category: 'ENERGY',
        ammoType: 'ENERGY',
        clip: 24,
        maxReserve: 96,
        fireMode: 'auto',
        rof: 5,               // Fast rate of fire
        reloadFrames: 60,
        damage: 7,
        poiseDamage: 10,
        range: 22.0,
        spread: 0.045,
        projectile: 'bolt',
        projectileSpeed: 24.0,
        knockback: { x: 1.4, y: 0.1 },
        color: 0x39ff14,
        causesDizzy: false
    },
    SCRAM_CANNON: {
        id: 'SCRAM_CANNON',
        name: '蜂群追踪炮 (Scram Cannon)',
        category: 'ENERGY_HEAVY',
        ammoType: 'ENERGY',
        clip: 4,
        maxReserve: 16,
        fireMode: 'semi',
        rof: 28,
        reloadFrames: 80,
        damage: 24,
        poiseDamage: 35,
        range: 28.0,
        spread: 0.08,
        projectile: 'homing',
        swarmCount: 3,
        projectileSpeed: 9.0,
        turnRate: 0.045,
        knockback: { x: 3.2, y: 2.2 },
        color: 0xff3b30,
        causesDizzy: false
    },
    VAN_DE_GRAAFF: {
        id: 'VAN_DE_GRAAFF',
        name: '范德格拉夫电击枪 (Van de Graaff)',
        category: 'ENERGY',
        ammoType: 'ENERGY',
        clip: 5,
        maxReserve: 20,
        fireMode: 'semi',
        rof: 22,
        reloadFrames: 50,
        damage: 10,
        poiseDamage: 50,
        range: 18.0,
        spread: 0.01,
        projectile: 'bolt',
        knockback: { x: 0.8, y: 0 },
        color: 0xffee00,
        causesDizzy: true      // Hits inflict DIZZY paralysis
    },
    MERCURY_BOW: {
        id: 'MERCURY_BOW',
        name: '水银狙击弓 (Mercury Bow)',
        category: 'ENERGY_HEAVY',
        ammoType: 'ENERGY',
        clip: 2,
        maxReserve: 10,
        fireMode: 'semi',
        rof: 38,
        reloadFrames: 90,
        damage: 48,
        poiseDamage: 80,
        range: 45.0,
        spread: 0.002,
        projectile: 'piercing_beam',
        knockback: { x: 5.5, y: 1.5 },
        color: 0xbf5af2,
        causesDizzy: false,
        piercing: true
    },
    BLACK_THUNDER: {
        id: 'BLACK_THUNDER',
        name: '黑雷战术霰弹枪 (Black Thunder)',
        category: 'BALLISTIC',
        ammoType: 'BALLISTIC',
        clip: 6,
        maxReserve: 24,
        fireMode: 'semi',
        rof: 24,
        reloadFrames: 70,
        damage: 32,
        pellets: 5,
        poiseDamage: 45,
        range: 14.0,
        spread: 0.09,
        projectile: 'hitscan',
        knockback: { x: 4.0, y: 1.0 },
        color: 0xff9500,
        causesDizzy: false
    }
};

export class WeaponSystem {
    /**
     * Check if fighter is equipped with a firearm and ready to fire.
     */
    static canFire(fighter) {
        if (!fighter || !fighter.weapon) return false;
        if (fighter.isHolstered) return false;
        if (fighter.reloadTimer > 0) return false;
        if (fighter.fireCooldown > 0) return false;
        return (fighter.weapon.clipAmmo || 0) > 0;
    }

    /**
     * Execute 3D firearm shot with pitch & yaw raycasting.
     * Intersects against World geometry (walls/doors) and character bounding cylinders.
     * @param {Object} attacker The shooter
     * @param {Object} world Active World instance (optional)
     * @param {Array<Object>} potentialTargets List of other characters
     * @param {number} pitch Vertical aim pitch in radians (positive = up, negative = down)
     * @param {number} yaw Horizontal aim yaw in radians (fallback to attacker.facingAngle)
     * @returns {Object} Shot result containing hit status, 3D hit point, and damaged target
     */
    static fire(attacker, world = null, potentialTargets = [], pitch = 0, yaw = null) {
        if (!this.canFire(attacker)) {
            return { fired: false, reason: 'NO_AMMO_OR_COOLDOWN' };
        }

        const weapon = attacker.weapon;
        const spec = WEAPON_REGISTRY[weapon.type] || WEAPON_REGISTRY.TCTF_PISTOL;

        // Consume magazine ammo
        weapon.clipAmmo = Math.max(0, weapon.clipAmmo - 1);
        attacker.fireCooldown = spec.rof;

        // Compute 3D ray direction vector
        const aimYaw = yaw !== null && Number.isFinite(yaw) ? yaw : attacker.facingAngle;
        const cosPitch = Math.cos(pitch);
        const sinPitch = Math.sin(pitch);
        const dirX = cosPitch * Math.cos(aimYaw);
        const dirY = sinPitch;
        const dirZ = cosPitch * Math.sin(aimYaw);

        const muzzle = [
            attacker.x + dirX * 0.45,
            attacker.y + 1.25 + dirY * 0.45,
            attacker.z + dirZ * 0.45
        ];

        let maxDist = spec.range;
        let wallHit = null;

        // 1. Raycast against World geometry
        if (world && typeof world.raycast === 'function') {
            wallHit = world.raycast(muzzle, [dirX, dirY, dirZ], maxDist);
            if (wallHit.hit) {
                maxDist = wallHit.dist;
            }
        }

        // 2. Raycast against targets (bounding cylinder: radius 0.45, height 1.8)
        let closestTarget = null;
        let targetDist = maxDist;
        let hitPoint = wallHit && wallHit.hit ? wallHit.point : [
            muzzle[0] + dirX * maxDist,
            muzzle[1] + dirY * maxDist,
            muzzle[2] + dirZ * maxDist
        ];

        for (let i = 0; i < potentialTargets.length; i++) {
            const target = potentialTargets[i];
            if (!target || target.id === attacker.id || target.hp <= 0) continue;

            const tHit = this._intersectCylinder(muzzle, [dirX, dirY, dirZ], target, 0.48, 1.8);
            if (tHit && tHit.dist < targetDist) {
                targetDist = tHit.dist;
                closestTarget = target;
                hitPoint = tHit.point;
            }
        }

        // Apply damage if target hit
        let damageDealt = 0;
        let causedDizzy = false;

        if (closestTarget) {
            damageDealt = spec.damage;
            causedDizzy = !!spec.causesDizzy;
            closestTarget.hp = Math.max(0, closestTarget.hp - damageDealt);

            if (causedDizzy && typeof closestTarget.transitionTo === 'function') {
                closestTarget.transitionTo('DIZZY');
            }
        }

        return {
            fired: true,
            weaponType: spec.id,
            spec,
            muzzle,
            direction: [dirX, dirY, dirZ],
            hitPoint,
            target: closestTarget,
            damage: damageDealt,
            causedDizzy,
            wallHit: !closestTarget && wallHit && wallHit.hit,
            remainingClip: weapon.clipAmmo
        };
    }

    /**
     * Reload active weapon from reserve ammo pool.
     */
    static reload(fighter) {
        if (!fighter || !fighter.weapon) return false;
        const weapon = fighter.weapon;
        const spec = WEAPON_REGISTRY[weapon.type] || WEAPON_REGISTRY.TCTF_PISTOL;
        const needed = spec.clip - (weapon.clipAmmo || 0);

        if (needed <= 0) return false; // Already full

        const ammoType = spec.ammoType;
        fighter.ammo = fighter.ammo || { BALLISTIC: 30, ENERGY: 30 };
        const available = fighter.ammo[ammoType] || 0;

        if (available <= 0) return false; // Out of reserve

        const amountToLoad = Math.min(needed, available);
        weapon.clipAmmo = (weapon.clipAmmo || 0) + amountToLoad;
        fighter.ammo[ammoType] = available - amountToLoad;
        fighter.reloadTimer = spec.reloadFrames;

        return true;
    }

    /**
     * Toggle firearm holster (Q key).
     */
    static toggleHolster(fighter) {
        if (!fighter || !fighter.weapon) return false;
        fighter.isHolstered = !fighter.isHolstered;
        return true;
    }

    /**
     * Pick up or swap weapon (E key).
     * @returns {Object|null} Dropped old weapon if one was equipped
     */
    static pickupWeapon(fighter, newWeaponSpecOrType) {
        const typeKey = typeof newWeaponSpecOrType === 'string'
            ? newWeaponSpecOrType
            : (newWeaponSpecOrType.type || newWeaponSpecOrType.id);

        const spec = WEAPON_REGISTRY[typeKey] || WEAPON_REGISTRY.TCTF_PISTOL;
        const oldWeapon = fighter.weapon || null;

        fighter.weapon = {
            id: `wpn_${Date.now()}`,
            type: spec.id,
            name: spec.name,
            clipAmmo: typeof newWeaponSpecOrType === 'object' && newWeaponSpecOrType.ammo !== undefined
                ? newWeaponSpecOrType.ammo
                : spec.clip
        };
        fighter.isHolstered = false;
        fighter.fireCooldown = 0;
        fighter.reloadTimer = 0;

        return oldWeapon;
    }

    /**
     * Collect ammo box on foot contact.
     */
    static collectAmmo(fighter, ammoType = 'BALLISTIC', amount = 15) {
        if (!fighter) return 0;
        fighter.ammo = fighter.ammo || { BALLISTIC: 0, ENERGY: 0 };
        fighter.ammo[ammoType] = (fighter.ammo[ammoType] || 0) + amount;
        return fighter.ammo[ammoType];
    }

    /**
     * Cylinder ray intersection helper.
     */
    static _intersectCylinder(origin, dir, target, radius, height) {
        const ox = origin[0] - target.x;
        const oz = origin[2] - target.z;
        const dx = dir[0];
        const dz = dir[2];

        const a = dx * dx + dz * dz;
        if (a < 1e-8) return null;

        const b = 2 * (ox * dx + oz * dz);
        const c = ox * ox + oz * oz - radius * radius;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return null;

        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / (2 * a);
        const t2 = (-b + sqrtDisc) / (2 * a);

        let t = t1 > 0 ? t1 : (t2 > 0 ? t2 : null);
        if (t === null) return null;

        const yHit = origin[1] + dir[1] * t;
        const targetY = target.y || 0;
        if (yHit >= targetY && yHit <= targetY + height) {
            return {
                dist: t,
                point: [origin[0] + dir[0] * t, yHit, origin[2] + dir[2] * t]
            };
        }

        return null;
    }
}
