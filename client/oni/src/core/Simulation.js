/**
 * Simulation - Deterministic 60Hz Match Simulation Kernel
 * Manages deterministic PRNG, entity registry, fighters, hitstop, events, and snapshot generation.
 */

import { Fighter } from './Fighter.js';
import { CollisionSystem } from './CollisionSystem.js';
import {
    FIGHTER_STATE,
    FIXED_DT,
    GRAVITY,
    STAGE_BOUNDS,
    WEAPON_PICKUP_RANGE,
    WEAPON_SPECS,
    MOVES
} from './Constants.js';

/**
 * Deterministic Mulberry32 PRNG for lockstep / replay / AI consistency
 */
export function createDeterministicRNG(seed = 0x0412001) {
    let s = seed | 0;
    return {
        next() {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
        getState() {
            return s;
        },
        setState(newSeed) {
            s = newSeed | 0;
        }
    };
}

export class Simulation {
    constructor(seed = 0x0412001) {
        this.initialSeed = seed;
        this.rng = createDeterministicRNG(seed);

        this.f1 = new Fighter('p1', 'Konoko', -2.6, 1, false);
        this.f2 = new Fighter('p2', 'Syndi-Bot', 2.6, -1, true);

        // Unified Entity Registry (Fighters, dropped weapons, projectiles)
        this.entities = new Map();
        this.nextEntitySeq = 1;
        this.registerEntity(this.f1);
        this.registerEntity(this.f2);

        // P2 Initial Gun-Fu Setup: Syndicate Trooper starts armed with a TCTF Pistol,
        // and a heavy weapon crate / Scram Cannon sits on the arena floor!
        this.f2.equipWeapon({ type: 'TCTF_PISTOL', id: 'wpn_init_p2' });
        this.spawnWeaponDrop('SCRAM_CANNON', 0, 0.15, -1.6);

        this.roundTimer = 99 * 60; // 99 seconds in frames
        this.currentFrame = 0;
        this.hitstopFrames = 0;
        this.isMatchOver = false;
        this.winner = null;

        // Event queue for render/audio listeners (drained each frame)
        this.events = [];
    }

    registerEntity(entity) {
        this.entities.set(entity.id, entity);
        return entity;
    }

    removeEntity(id) {
        this.entities.delete(id);
    }

    getFighters() {
        const list = [];
        for (const ent of this.entities.values()) {
            if (ent.entityType === 'fighter') list.push(ent);
        }
        return list;
    }

    getWeapons() {
        const list = [];
        for (const ent of this.entities.values()) {
            if (ent.entityType === 'weapon') list.push(ent);
        }
        return list;
    }

    getProjectiles() {
        const list = [];
        for (const ent of this.entities.values()) {
            if (ent.entityType === 'projectile') list.push(ent);
        }
        return list;
    }

    /**
     * Spawn a physical weapon entity in the arena (dropped, disarmed, or thrown)
     */
    spawnWeaponDrop(weaponTypeOrObj, x, y, z, vx = 0, vy = 0, vz = 0, opts = {}) {
        const typeKey = typeof weaponTypeOrObj === 'string'
            ? weaponTypeOrObj
            : (weaponTypeOrObj.type || 'TCTF_PISTOL');
        const spec = WEAPON_SPECS[typeKey] || WEAPON_SPECS.TCTF_PISTOL;
        const id = (typeof weaponTypeOrObj === 'object' && weaponTypeOrObj.id)
            ? weaponTypeOrObj.id
            : `wpn_${this.nextEntitySeq++}`;
        const ammo = (typeof weaponTypeOrObj === 'object' && weaponTypeOrObj.ammo !== undefined)
            ? weaponTypeOrObj.ammo
            : spec.maxAmmo;

        const wpn = {
            id,
            entityType: 'weapon',
            type: spec.id,
            name: spec.name,
            ammo,
            maxAmmo: spec.maxAmmo,
            color: spec.color,
            x,
            y: Math.max(0.12, y),
            z,
            vx,
            vy,
            vz,
            spinPitch: 0,
            spinYaw: 0,
            spinSpeed: opts.spinSpeed !== undefined ? opts.spinSpeed : (Math.hypot(vx, vy, vz) > 1 ? 14.0 : 2.0),
            isGrounded: y <= 0.15 && Math.abs(vy) < 0.1,
            pickupCooldown: opts.pickupCooldown || 0,
            lastOwnerId: opts.lastOwnerId || null,
            isThrownAttack: !!opts.isThrownAttack,
            throwAttackerId: opts.throwAttackerId || null,
            throwMove: opts.throwMove || null
        };
        this.registerEntity(wpn);
        return wpn;
    }

    /**
     * Disarm a fighter if they are holding a weapon, launching it into the air with spin
     */
    disarmFighter(defender, attacker, autoSnatch = false) {
        if (!defender.weapon) return null;
        const wpnData = defender.unequipWeapon();
        if (!wpnData) return null;

        if (autoSnatch && attacker && !attacker.weapon && wpnData.ammo > 0) {
            attacker.equipWeapon(wpnData);
            this.events.push({
                type: 'WEAPON_SNATCH',
                fighter: attacker.id,
                from: defender.id,
                weaponType: wpnData.type,
                x: defender.x,
                y: defender.y + 1.25,
                z: defender.z
            });
            return null;
        }

        // Launch weapon along parabola between defender and attacker so either can grab it!
        const dirToAttackerX = attacker ? Math.sign(attacker.x - defender.x || -defender.facing) : -defender.facing;
        const vx = dirToAttackerX * (1.8 + this.random() * 1.4);
        const vz = (this.random() - 0.5) * 2.2;
        const vy = 6.8 + this.random() * 1.5;

        const dropped = this.spawnWeaponDrop(
            wpnData,
            defender.x,
            defender.y + 1.15,
            defender.z,
            vx,
            vy,
            vz,
            {
                spinSpeed: 18.0,
                pickupCooldown: 10,
                lastOwnerId: defender.id
            }
        );

        this.events.push({
            type: 'WEAPON_DISARM',
            attacker: attacker ? attacker.id : null,
            defender: defender.id,
            weaponId: dropped.id,
            weaponType: dropped.type,
            x: dropped.x,
            y: dropped.y,
            z: dropped.z
        });
        return dropped;
    }

    /**
     * Deterministic random [0, 1)
     */
    random() {
        return this.rng.next();
    }

    reset() {
        this.rng.setState(this.initialSeed);
        this.nextEntitySeq = 1;
        this.f1.reset(-2.6, 1);
        this.f2.reset(2.6, -1);
        this.entities.clear();
        this.registerEntity(this.f1);
        this.registerEntity(this.f2);
        this.f2.equipWeapon({ type: 'TCTF_PISTOL', id: 'wpn_init_p2' });
        this.spawnWeaponDrop('SCRAM_CANNON', 0, 0.15, -1.6);
        this.roundTimer = 99 * 60;
        this.currentFrame = 0;
        this.hitstopFrames = 0;
        this.isMatchOver = false;
        this.winner = null;
        this.events = [];
    }

    /**
     * Advance simulation by 1 fixed tick (1/60s)
     * @param {Object} input1 Raw input for Fighter 1
     * @param {Object} input2 Raw input for Fighter 2
     */
    tick(input1 = {}, input2 = {}) {
        this.currentFrame++;
        this.events = [];

        // Hitstop freeze (for intense impact crunch)
        if (this.hitstopFrames > 0) {
            this.hitstopFrames--;
            return;
        }

        if (this.isMatchOver) {
            // Still run basic physics for falling fighters
            this.f1.update({ dirX: 0, dirZ: 0 }, this.f2, this.events);
            this.f2.update({ dirX: 0, dirZ: 0 }, this.f1, this.events);
            return;
        }

        // Timer decrement
        if (this.roundTimer > 0) {
            this.roundTimer--;
            if (this.roundTimer === 0) {
                this.handleTimeout();
                return;
            }
        }

        // 1. Check weapon pickup before fighter update (if Punch or Fire pressed near a weapon while unarmed)
        const p1In = { ...input1 };
        const p2In = { ...input2 };
        this.tryPickupWeapon(this.f1, p1In, this.f2);
        this.tryPickupWeapon(this.f2, p2In, this.f1);

        // 2. Update Fighters in deterministic order
        this.f1.update(p1In, this.f2, this.events);
        this.f2.update(p2In, this.f1, this.events);

        // Process firearm discharge & weapon throw requests emitted by fighters
        this.processFighterRequests();

        // Check if a throw finished and caused a KO
        if (this.f2.hp <= 0 && !this.isMatchOver) {
            this.declareWinner('p1');
            return;
        }
        if (this.f1.hp <= 0 && !this.isMatchOver) {
            this.declareWinner('p2');
            return;
        }

        // 3. Update Weapons & Projectiles in deterministic order
        this.updateWeapons();
        this.updateProjectiles();

        if (this.isMatchOver) return;

        // 4. Resolve Pushbox overlap among all fighters
        const fighters = this.getFighters();
        for (let i = 0; i < fighters.length; i++) {
            for (let j = i + 1; j < fighters.length; j++) {
                CollisionSystem.resolvePushbox(fighters[i], fighters[j], 0.65);
            }
        }

        // 5. Collision & Combat Detection
        this.resolveAttackHit(this.f1, this.f2);
        if (!this.isMatchOver) {
            this.resolveAttackHit(this.f2, this.f1);
        }
    }

    /**
     * Allow unarmed fighter to snatch a weapon on the ground or in mid-air
     * Automatic grab during SLIDE_KICK or RUN, or on Punch/Fire press in neutral states
     */
    tryPickupWeapon(fighter, rawInput = {}, opponent = null) {
        if (fighter.weapon || fighter.hp <= 0) return false;

        // If fighter is in throw range of a DIZZY opponent and presses punch/throw, prioritize the throw!
        if (
            opponent &&
            (opponent.state === FIGHTER_STATE.DIZZY || rawInput.throwBtn) &&
            Math.hypot(opponent.x - fighter.x, opponent.z - fighter.z) <= 1.45
        ) {
            return false;
        }

        const isSlidingOrRunning =
            fighter.state === FIGHTER_STATE.RUN ||
            (fighter.state === FIGHTER_STATE.ATTACK && fighter.currentMove && fighter.currentMove.id === 'SLIDE_KICK');
        const canManualPickup =
            (fighter.state === FIGHTER_STATE.IDLE ||
                fighter.state === FIGHTER_STATE.WALK ||
                fighter.state === FIGHTER_STATE.CROUCH) &&
            (rawInput.punch || rawInput.fire);

        if (!isSlidingOrRunning && !canManualPickup) return false;

        const weapons = this.getWeapons();
        for (let i = 0; i < weapons.length; i++) {
            const wpn = weapons[i];
            if (wpn.ammo <= 0) continue; // Do not pick up empty discarded guns
            if (wpn.pickupCooldown > 0 && wpn.lastOwnerId === fighter.id) continue;

            const dist = Math.hypot(wpn.x - fighter.x, wpn.z - fighter.z);
            const dy = Math.abs(wpn.y - (fighter.y + 0.6));
            if (dist <= WEAPON_PICKUP_RANGE && dy <= 1.45) {
                fighter.equipWeapon(wpn);
                this.removeEntity(wpn.id);
                // Consume punch/fire edge so fighter doesn't immediately punch on the same frame
                rawInput.punch = false;
                rawInput.fire = false;

                this.events.push({
                    type: 'WEAPON_PICKUP',
                    fighter: fighter.id,
                    weaponId: wpn.id,
                    weaponType: wpn.type,
                    midAir: !wpn.isGrounded,
                    x: wpn.x,
                    y: wpn.y,
                    z: wpn.z
                });
                return true;
            }
        }
        return false;
    }

    /**
     * Process WEAPON_FIRE_REQUEST and WEAPON_THROW_REQUEST queued during Fighter.update
     */
    processFighterRequests() {
        for (let i = this.events.length - 1; i >= 0; i--) {
            const ev = this.events[i];
            if (ev.type === 'WEAPON_FIRE_REQUEST') {
                this.events.splice(i, 1);
                const attacker = ev.attacker === 'p1' ? this.f1 : this.f2;
                const defender = ev.attacker === 'p1' ? this.f2 : this.f1;
                this.executeWeaponFire(attacker, defender, ev.weaponType);
            } else if (ev.type === 'WEAPON_THROW_REQUEST') {
                this.events.splice(i, 1);
                const attacker = ev.attacker === 'p1' ? this.f1 : this.f2;
                this.executeWeaponThrow(attacker, ev.weapon, ev.move);
            } else if (ev.type === 'HIT' && ev.isThrow && ev.move && ev.move.disarms) {
                const attacker = ev.attacker === 'p1' ? this.f1 : this.f2;
                const defender = ev.defender === 'p1' ? this.f1 : this.f2;
                this.disarmFighter(defender, attacker, false);
            }
        }
    }

    /**
     * Execute firearm shot: Hitscan (TCTF Pistol), Piercing Beam (Mercury Bow), or Homing Swarm (Scram Cannon)
     */
    executeWeaponFire(attacker, defender, weaponType) {
        const spec = WEAPON_SPECS[weaponType] || WEAPON_SPECS.TCTF_PISTOL;
        const { fx, fz } = attacker.getForwardVector();
        const muzzleX = attacker.x + fx * 0.65;
        const muzzleY = attacker.y + 1.32;
        const muzzleZ = attacker.z + fz * 0.65;

        if (spec.fireType === 'HITSCAN' || spec.fireType === 'PIERCING_BEAM') {
            const syntheticMove = {
                id: spec.id,
                name: spec.name,
                damage: spec.damage,
                poiseDamage: spec.poiseDamage,
                hitStun: spec.hitStun,
                blockStun: spec.blockStun,
                knockback: spec.knockback,
                knockdown: !!spec.knockdown,
                piercesGuard: !!spec.piercesGuard
            };

            const hit = CollisionSystem.checkRayHit(
                attacker,
                defender,
                muzzleX,
                muzzleY,
                muzzleZ,
                fx,
                fz,
                spec.range,
                syntheticMove
            );

            const endDist = hit && spec.fireType !== 'PIERCING_BEAM' ? hit.distance : spec.range;
            const endPoint = {
                x: muzzleX + fx * endDist,
                y: muzzleY,
                z: muzzleZ + fz * endDist
            };

            this.events.push({
                type: 'WEAPON_FIRE',
                attacker: attacker.id,
                weaponType: spec.id,
                fireType: spec.fireType,
                color: spec.color,
                muzzle: { x: muzzleX, y: muzzleY, z: muzzleZ },
                endPoint
            });

            if (hit) {
                this.applyDamageResult(attacker, defender, hit);
            }
        } else if (spec.fireType === 'HOMING_SWARM') {
            const count = spec.swarmCount || 3;
            for (let k = 0; k < count; k++) {
                const spreadAngle = (k - (count - 1) * 0.5) * 0.28;
                const ca = Math.cos(spreadAngle);
                const sa = Math.sin(spreadAngle);
                const dirX = fx * ca - fz * sa;
                const dirZ = fx * sa + fz * ca;
                const proj = {
                    id: `proj_${this.nextEntitySeq++}`,
                    entityType: 'projectile',
                    ownerId: attacker.id,
                    targetId: defender.id,
                    weaponType: spec.id,
                    color: spec.color,
                    x: muzzleX + dirX * 0.2,
                    y: muzzleY + (k - 1) * 0.12,
                    z: muzzleZ + dirZ * 0.2,
                    vx: dirX * spec.projectileSpeed,
                    vy: 1.2 + k * 0.5,
                    vz: dirZ * spec.projectileSpeed,
                    speed: spec.projectileSpeed,
                    turnRate: spec.turnRate,
                    life: spec.lifetime,
                    maxLife: spec.lifetime,
                    syntheticMove: {
                        id: spec.id,
                        name: spec.name,
                        damage: spec.damage,
                        poiseDamage: spec.poiseDamage,
                        hitStun: spec.hitStun,
                        blockStun: spec.blockStun,
                        knockback: spec.knockback,
                        knockdown: false
                    }
                };
                this.registerEntity(proj);
            }

            this.events.push({
                type: 'WEAPON_FIRE',
                attacker: attacker.id,
                weaponType: spec.id,
                fireType: spec.fireType,
                color: spec.color,
                muzzle: { x: muzzleX, y: muzzleY, z: muzzleZ },
                endPoint: { x: muzzleX + fx * 3, y: muzzleY, z: muzzleZ + fz * 3 }
            });
        }
    }

    /**
     * Throw an empty or held weapon at the opponent as a physical spinning projectile
     */
    executeWeaponThrow(attacker, weaponData, move) {
        const { fx, fz } = attacker.getForwardVector();
        const wpn = this.spawnWeaponDrop(
            weaponData,
            attacker.x + fx * 0.65,
            attacker.y + 1.28,
            attacker.z + fz * 0.65,
            fx * 15.0,
            2.4,
            fz * 15.0,
            {
                spinSpeed: 24.0,
                pickupCooldown: 20,
                lastOwnerId: attacker.id,
                isThrownAttack: true,
                throwAttackerId: attacker.id,
                throwMove: move || MOVES.THROW_WEAPON
            }
        );

        this.events.push({
            type: 'WEAPON_THROW',
            attacker: attacker.id,
            weaponId: wpn.id,
            weaponType: wpn.type
        });
    }

    /**
     * Update physical weapons in the arena (parabolic arc, bounce, thrown impact)
     */
    updateWeapons() {
        const weapons = this.getWeapons();
        for (let i = 0; i < weapons.length; i++) {
            const wpn = weapons[i];
            if (wpn.pickupCooldown > 0) wpn.pickupCooldown--;

            if (!wpn.isGrounded) {
                wpn.vy += GRAVITY * FIXED_DT;
                wpn.x += wpn.vx * FIXED_DT;
                wpn.y += wpn.vy * FIXED_DT;
                wpn.z += wpn.vz * FIXED_DT;
                wpn.spinPitch += wpn.spinSpeed * FIXED_DT;
                wpn.spinYaw += wpn.spinSpeed * 0.6 * FIXED_DT;

                // Check if thrown weapon hits opponent in flight
                if (wpn.isThrownAttack && wpn.throwAttackerId) {
                    const attacker = wpn.throwAttackerId === 'p1' ? this.f1 : this.f2;
                    const defender = wpn.throwAttackerId === 'p1' ? this.f2 : this.f1;
                    const hit = CollisionSystem.checkSphereHit(
                        attacker,
                        defender,
                        wpn.x,
                        wpn.y,
                        wpn.z,
                        0.32,
                        wpn.throwMove || MOVES.THROW_WEAPON
                    );
                    if (hit) {
                        wpn.isThrownAttack = false;
                        wpn.vx = -wpn.vx * 0.25;
                        wpn.vy = 3.5;
                        this.applyDamageResult(attacker, defender, hit);
                    }
                }

                // Floor bounce / settle
                if (wpn.y <= 0.14) {
                    wpn.y = 0.14;
                    if (Math.abs(wpn.vy) > 2.2) {
                        wpn.vy = -wpn.vy * 0.35;
                        wpn.vx *= 0.6;
                        wpn.vz *= 0.6;
                        wpn.isThrownAttack = false;
                    } else {
                        wpn.vy = 0;
                        wpn.vx = 0;
                        wpn.vz = 0;
                        wpn.isGrounded = true;
                        wpn.isThrownAttack = false;
                        wpn.spinPitch = 0;
                        wpn.spinSpeed = 1.8;
                    }
                }
            } else {
                wpn.spinYaw += 1.8 * FIXED_DT;
            }

            wpn.x = Math.max(STAGE_BOUNDS.minX + 0.5, Math.min(STAGE_BOUNDS.maxX - 0.5, wpn.x));
            wpn.z = Math.max(STAGE_BOUNDS.minZ + 0.5, Math.min(STAGE_BOUNDS.maxZ - 0.5, wpn.z));
        }
    }

    /**
     * Update active projectiles (e.g. Scram Cannon homing swarm missiles)
     */
    updateProjectiles() {
        const projectiles = this.getProjectiles();
        for (let i = 0; i < projectiles.length; i++) {
            const p = projectiles[i];
            p.life--;
            if (p.life <= 0) {
                this.removeEntity(p.id);
                continue;
            }

            const attacker = p.ownerId === 'p1' ? this.f1 : this.f2;
            const defender = p.targetId === 'p1' ? this.f1 : this.f2;

            // Homing steering toward target's chest unless target is in I-frames (EVADE breaks tracking!)
            if (defender && !defender.invincible && defender.hp > 0) {
                const tx = defender.x - p.x;
                const ty = (defender.y + 1.05) - p.y;
                const tz = defender.z - p.z;
                const dist = Math.hypot(tx, ty, tz);
                if (dist > 0.05) {
                    const desiredVx = (tx / dist) * p.speed;
                    const desiredVy = (ty / dist) * p.speed;
                    const desiredVz = (tz / dist) * p.speed;
                    p.vx += (desiredVx - p.vx) * p.turnRate;
                    p.vy += (desiredVy - p.vy) * p.turnRate;
                    p.vz += (desiredVz - p.vz) * p.turnRate;
                    const curSpd = Math.hypot(p.vx, p.vy, p.vz) || 1;
                    p.vx = (p.vx / curSpd) * p.speed;
                    p.vy = (p.vy / curSpd) * p.speed;
                    p.vz = (p.vz / curSpd) * p.speed;
                }
            }

            p.x += p.vx * FIXED_DT;
            p.y += p.vy * FIXED_DT;
            p.z += p.vz * FIXED_DT;

            // Check collision with defender
            if (defender) {
                const hit = CollisionSystem.checkSphereHit(
                    attacker,
                    defender,
                    p.x,
                    p.y,
                    p.z,
                    0.24,
                    p.syntheticMove
                );
                if (hit) {
                    this.applyDamageResult(attacker, defender, hit);
                    this.removeEntity(p.id);
                    continue;
                }
            }

            // Remove if hits floor or out of stage bounds
            if (
                p.y <= 0.05 ||
                p.x < STAGE_BOUNDS.minX - 2 ||
                p.x > STAGE_BOUNDS.maxX + 2 ||
                p.z < STAGE_BOUNDS.minZ - 2 ||
                p.z > STAGE_BOUNDS.maxZ + 2
            ) {
                this.removeEntity(p.id);
            }
        }
    }

    resolveAttackHit(attacker, defender) {
        const hitResult = CollisionSystem.checkHit(attacker, defender);
        if (!hitResult) return;

        attacker.hasHitThisMove = true;
        this.applyDamageResult(attacker, defender, hitResult);
    }

    applyDamageResult(attacker, defender, hitResult) {
        attacker.comboCount++;
        attacker.comboResetTimer = 60; // frames to keep combo alive

        const hitInfo = defender.takeHit(hitResult, attacker);
        const isHeavy =
            hitResult.move.knockdown ||
            hitResult.move.isLauncher ||
            hitResult.move.damage >= 18 ||
            hitInfo.poiseBroken;
        this.hitstopFrames = hitInfo.blocked ? 4 : (isHeavy ? 10 : 6);

        // P2 Disarm Check: if clean hit with a disarming move (or defender is knocked down/dizzy while holding a gun)
        let disarmed = false;
        if (
            !hitInfo.blocked &&
            defender.weapon &&
            (hitResult.move.disarms || hitInfo.poiseBroken)
        ) {
            this.disarmFighter(defender, attacker, !!hitResult.move.snatchDisarmedWeapon);
            disarmed = true;
        }

        this.events.push({
            type: 'HIT',
            attacker: attacker.id,
            defender: defender.id,
            hitPoint: hitResult.hitPoint,
            move: hitResult.move,
            damage: hitInfo.damage,
            blocked: hitInfo.blocked,
            armored: !!hitInfo.armored,
            poiseBroken: !!hitInfo.poiseBroken,
            juggled: !!hitInfo.juggled,
            disarmed,
            combo: attacker.comboCount,
            knockdown: hitResult.move.knockdown || hitResult.move.isLauncher || defender.hp <= 0
        });

        if (defender.hp <= 0) {
            this.declareWinner(attacker.id);
        }
    }

    declareWinner(winnerId) {
        this.isMatchOver = true;
        this.winner = winnerId;
        if (winnerId === 'p1') {
            this.f1.transitionTo(FIGHTER_STATE.VICTORY);
            this.f2.transitionTo(FIGHTER_STATE.DEFEAT);
        } else {
            this.f2.transitionTo(FIGHTER_STATE.VICTORY);
            this.f1.transitionTo(FIGHTER_STATE.DEFEAT);
        }
        this.events.push({
            type: 'KO',
            winner: winnerId
        });
    }

    handleTimeout() {
        this.isMatchOver = true;
        if (this.f1.hp > this.f2.hp) {
            this.declareWinner('p1');
        } else if (this.f2.hp > this.f1.hp) {
            this.declareWinner('p2');
        } else {
            this.winner = 'DRAW';
            this.events.push({ type: 'TIMEOUT_DRAW' });
        }
    }

    /**
     * Export lightweight serializable snapshot for WebRTC transmission
     */
    getSnapshot() {
        const serializeFighter = (f) => ({
            x: Number(f.x.toFixed(2)),
            y: Number(f.y.toFixed(2)),
            z: Number(f.z.toFixed(2)),
            vx: Number(f.vx.toFixed(2)),
            vy: Number(f.vy.toFixed(2)),
            vz: Number(f.vz.toFixed(2)),
            facing: f.facing,
            facingAngle: Number(f.facingAngle.toFixed(3)),
            hp: f.hp,
            poise: Math.round(f.poise),
            state: f.state,
            stateTimer: f.stateTimer,
            moveId: f.currentMove ? f.currentMove.id : null,
            combo: f.comboCount,
            weapon: f.weapon ? { type: f.weapon.type, ammo: f.weapon.ammo } : null
        });

        return {
            frame: this.currentFrame,
            time: Math.ceil(this.roundTimer / 60),
            p1: serializeFighter(this.f1),
            p2: serializeFighter(this.f2),
            weapons: this.getWeapons().map((w) => ({
                id: w.id,
                type: w.type,
                ammo: w.ammo,
                x: Number(w.x.toFixed(2)),
                y: Number(w.y.toFixed(2)),
                z: Number(w.z.toFixed(2))
            })),
            projectiles: this.getProjectiles().length,
            over: this.isMatchOver,
            winner: this.winner
        };
    }
}
