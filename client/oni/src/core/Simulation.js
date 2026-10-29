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
    STAGE_CONFIG,
    WEAPON_PICKUP_RANGE,
    WEAPON_SPECS,
    DAODAN_CONFIG,
    DIFFICULTY_PRESETS,
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
        this.extraEnemies = [];

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

        // Global difficulty scaling (default 'easy' for relaxed, fluid combat)
        this.difficulty = 'easy';
        this.setDifficulty('easy');

        // P3 Survival Wave Mode (optional continuous enemy reinforcements)
        this.survivalMode = false;
        this.waveNumber = 1;
        this.respawnTimer = 0;
        this.WAVE_ROSTER = [
            { name: 'STRIKER GRUNT', level: 'easy', maxHp: 90, weapon: 'TCTF_PISTOL', hypo: 0 },
            { name: 'BLACK OPS ELITE', level: 'normal', maxHp: 110, weapon: 'SCRAM_CANNON', hypo: 1 },
            { name: 'SYNDICATE NINJA', level: 'hard', maxHp: 130, weapon: 'MERCURY_BOW', hypo: 1 }
        ];
    }

    enableSurvivalMode(enabled = true) {
        this.survivalMode = !!enabled;
        this.waveNumber = 1;
        this.respawnTimer = 0;
        this.applyWaveEnemyConfig(1);
    }

    setStageType(type = 'ROOFTOP') {
        CollisionSystem.setStageType(type);
    }

    applyWaveEnemyConfig(waveNum) {
        const idx = Math.min(this.WAVE_ROSTER.length - 1, (waveNum - 1) % this.WAVE_ROSTER.length);
        const cfg = this.WAVE_ROSTER[idx];
        const tierCycle = Math.floor((waveNum - 1) / this.WAVE_ROSTER.length);
        this.f2.name = tierCycle > 0 ? `${cfg.name} MK-${tierCycle + 1}` : cfg.name;
        this.f2.maxHp = cfg.maxHp + tierCycle * 15;
        this.f2.hp = this.f2.maxHp;
        this.f2.poise = this.f2.maxPoise;
        this.f2.maxHypo = cfg.hypo;
        this.f2.hypoCount = cfg.hypo;
        this.f2.aiProfileLevel = cfg.level;
        if (cfg.weapon) {
            this.f2.equipWeapon({ type: cfg.weapon, id: `wpn_wave_${waveNum}` });
        }
    }

    registerEntity(entity) {
        this.entities.set(entity.id, entity);
        return entity;
    }

    removeEntity(id) {
        this.entities.delete(id);
        this.extraEnemies = this.extraEnemies.filter((e) => e.id !== id);
    }

    /**
     * Get all active enemy fighters (including f2 and any campaign reinforcements)
     */
    getEnemies() {
        const list = [];
        if (this.entities.has(this.f2.id)) list.push(this.f2);
        for (let i = 0; i < this.extraEnemies.length; i++) {
            const e = this.extraEnemies[i];
            if (this.entities.has(e.id)) list.push(e);
        }
        return list;
    }

    /**
     * Set global match difficulty ('easy' / 'normal' / 'hard') and scale all current fighters
     */
    setDifficulty(diffMode = 'easy') {
        const preset = DIFFICULTY_PRESETS[diffMode] || DIFFICULTY_PRESETS.easy;
        this.difficulty = preset.id;
        if (this.f1) {
            this.f1.damageTakenMult = preset.playerDamageTakenMult;
            this.f1.poiseTakenMult = preset.playerPoiseTakenMult;
        }
        if (this.f2) {
            this.f2.speedScale = preset.enemySpeedMult;
        }
        for (let i = 0; i < this.extraEnemies.length; i++) {
            this.extraEnemies[i].speedScale = preset.enemySpeedMult;
        }
        return preset;
    }

    /**
     * Spawn an extra campaign sector enemy (adds to unified registry & extraEnemies list)
     */
    spawnExtraEnemy(cfg = {}) {
        const seq = this.nextEntitySeq++;
        const id = cfg.id || `enemy_${seq}`;
        const name = cfg.name || `SYNDICATE GRUNT #${seq}`;
        const x = cfg.x !== undefined ? cfg.x : 4.0;
        const z = cfg.z !== undefined ? cfg.z : 1.2;
        const facing = cfg.facing !== undefined ? cfg.facing : -1;
        const preset = DIFFICULTY_PRESETS[this.difficulty] || DIFFICULTY_PRESETS.easy;

        const enemy = new Fighter(id, name, x, facing, true);
        enemy.z = z;
        enemy.archetype = cfg.archetype || 'STRIKER';

        // Apply archetype baseline stats
        let baseHp = cfg.maxHp || 90;
        let basePoise = cfg.maxPoise || 100;
        let baseSpeed = cfg.speedScale || 1.0;

        if (enemy.archetype === 'TANKER') {
            baseHp = cfg.maxHp || 155;
            basePoise = 180;
            baseSpeed = 0.76;
            enemy.scale = 1.25;
            enemy.unlockMove('GROUND_STOMP');
        } else if (enemy.archetype === 'FURY') {
            baseHp = cfg.maxHp || 80;
            basePoise = 90;
            baseSpeed = 1.06;
            enemy.scale = 0.94;
            enemy.unlockMove('SLIDE_KICK');
            enemy.unlockMove('WILLOW_KICK');
            enemy.unlockMove('THROW_FRONT');
        } else if (enemy.archetype === 'BLACK_OPS') {
            baseHp = cfg.maxHp || 110;
            basePoise = 110;
            baseSpeed = 1.02;
            enemy.isCamouflage = true;
            enemy.unlockMove('BACK_SPIN_FIST');
        } else if (enemy.archetype === 'SNIPER') {
            baseHp = cfg.maxHp || 85;
            basePoise = 95;
            baseSpeed = 0.88;
            enemy.isSniper = true;
        }

        // Apply global difficulty scaling
        enemy.maxHp = Math.max(30, Math.round(baseHp * preset.enemyHpMult));
        enemy.hp = enemy.maxHp;
        enemy.maxPoise = basePoise;
        enemy.poise = enemy.maxPoise;
        enemy.speedScale = baseSpeed * preset.enemySpeedMult;
        enemy.maxHypo = cfg.hypo || 0;
        enemy.hypoCount = cfg.hypo || 0;
        enemy.aiProfileLevel = cfg.level || (this.difficulty === 'easy' ? 'easy' : 'normal');
        enemy.expReward = cfg.expReward || 65;
        enemy.isBoss = !!cfg.isBoss;
        enemy.patrolMinX = cfg.patrolMinX !== undefined ? cfg.patrolMinX : (x - 2.5);
        enemy.patrolMaxX = cfg.patrolMaxX !== undefined ? cfg.patrolMaxX : (x + 2.5);
        enemy.isAlerted = cfg.isAlerted !== undefined ? cfg.isAlerted : true;
        enemy.canTriggerAlarm = cfg.canTriggerAlarm !== undefined ? cfg.canTriggerAlarm : false;

        if (cfg.weapon) {
            enemy.equipWeapon({ type: cfg.weapon, id: `wpn_${id}` });
        }

        this.registerEntity(enemy);
        this.extraEnemies.push(enemy);
        return enemy;
    }

    /**
     * Spawn dynamic reinforcements when an alarm is tripped
     */
    spawnReinforcements(squadList = []) {
        const spawned = [];
        for (let i = 0; i < squadList.length; i++) {
            const cfg = squadList[i];
            const enemy = this.spawnExtraEnemy({
                ...cfg,
                isAlerted: true,
                canTriggerAlarm: false // Reinforcements don't re-trigger alarms
            });
            spawned.push(enemy);
            if (this.events) {
                this.events.push({
                    type: 'REINFORCEMENT_SPAWN',
                    id: enemy.id,
                    name: enemy.name,
                    x: enemy.x,
                    y: 0,
                    z: enemy.z
                });
            }
        }
        return spawned;
    }

    clearExtraEnemies() {
        for (let i = 0; i < this.extraEnemies.length; i++) {
            this.entities.delete(this.extraEnemies[i].id);
        }
        this.extraEnemies = [];
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
            if (attacker.gainDaodan) attacker.gainDaodan(DAODAN_CONFIG.GAIN_ON_DISARM, this.events);
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

        if (attacker && attacker.gainDaodan) {
            attacker.gainDaodan(DAODAN_CONFIG.GAIN_ON_DISARM, this.events);
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
        this.clearExtraEnemies();
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
        this.waveNumber = 1;
        this.respawnTimer = 0;
        if (this.survivalMode) {
            this.applyWaveEnemyConfig(1);
        }
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
            for (let i = 0; i < this.extraEnemies.length; i++) {
                this.extraEnemies[i].update({ dirX: 0, dirZ: 0 }, this.f1, this.events);
            }
            return;
        }

        // P3 Survival Wave Respawn Countdown
        if (this.survivalMode && this.respawnTimer > 0) {
            this.respawnTimer--;
            this.f1.update(input1, this.f2, this.events);
            this.f2.update({ dirX: 0, dirZ: 0 }, this.f1, this.events);
            if (this.respawnTimer === 0) {
                this.waveNumber++;
                const spawnSide = this.f1.x >= 0 ? -4.5 : 4.5;
                this.f2.reset(spawnSide, spawnSide < 0 ? 1 : -1);
                this.applyWaveEnemyConfig(this.waveNumber);
                this.roundTimer = Math.min(99 * 60, this.roundTimer + 30 * 60);
                this.events.push({
                    type: 'WAVE_SPAWN',
                    wave: this.waveNumber,
                    enemyName: this.f2.name,
                    level: this.f2.aiProfileLevel || 'normal',
                    x: this.f2.x,
                    y: 0.2,
                    z: this.f2.z
                });
            }
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

        const enemies = this.getEnemies();
        const activeTarget = (typeof this.f1.findBestTarget === 'function' ? this.f1.findBestTarget(enemies) : null) || this.f2;

        // 1. Check weapon pickup before fighter update (if Punch or Fire pressed near a weapon while unarmed)
        const p1In = { ...input1 };
        const p2In = { ...input2 };
        this.tryPickupWeapon(this.f1, p1In, activeTarget);
        this.tryPickupWeapon(this.f2, p2In, this.f1);
        for (let i = 0; i < this.extraEnemies.length; i++) {
            const extra = this.extraEnemies[i];
            const extraIn = extra.cachedAiInput || { dirX: 0, dirZ: 0 };
            this.tryPickupWeapon(extra, extraIn, this.f1);
        }

        // 2. Update Fighters in deterministic order
        this.f1.update(p1In, activeTarget, this.events);
        this.f2.update(p2In, this.f1, this.events);
        for (let i = 0; i < this.extraEnemies.length; i++) {
            const extra = this.extraEnemies[i];
            const extraIn = extra.cachedAiInput || { dirX: 0, dirZ: 0 };
            extra.update(extraIn, this.f1, this.events);
        }

        // Process firearm discharge & weapon throw requests emitted by fighters
        this.processFighterRequests();

        // Check if player or all enemies are defeated
        const allEnemiesDown = enemies.every((e) => e.hp <= 0);
        if (allEnemiesDown && !this.isMatchOver) {
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

        // 4. Resolve Pushbox overlap among all active fighters
        const fighters = this.getFighters();
        for (let i = 0; i < fighters.length; i++) {
            for (let j = i + 1; j < fighters.length; j++) {
                CollisionSystem.resolvePushbox(fighters[i], fighters[j], 0.65);
            }
        }

        // 5. Collision & Combat Detection
        // Konoko attacks can strike all enemies within range (P7 Collateral Sweep/Chains)
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (e.hp > 0) {
                this.resolveAttackHit(this.f1, e);
            }
        }
        // Active enemies strike back against Konoko
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            if (e.hp > 0 && !this.isMatchOver) {
                this.resolveAttackHit(e, this.f1);
            }
        }

        // 6. Resolve Collateral Body Splash (Throwing one enemy bowls over adjacent foes)
        for (let i = 0; i < this.events.length; i++) {
            const ev = this.events[i];
            if (ev.type === 'COLLATERAL_SPLASH') {
                for (let k = 0; k < enemies.length; k++) {
                    const se = enemies[k];
                    if (se.id === ev.thrownFighter || se.hp <= 0 || se.invincible) continue;
                    const d = Math.hypot(se.x - ev.x, se.z - ev.z);
                    if (d <= ev.radius) {
                        se.hp = Math.max(0, se.hp - ev.damage);
                        se.poise = 0;
                        se.transitionTo(FIGHTER_STATE.KNOCKED_DOWN);
                        const nx = d > 0.01 ? (se.x - ev.x) / d : 1;
                        const nz = d > 0.01 ? (se.z - ev.z) / d : 0;
                        se.vx = nx * 4.8;
                        se.vz = nz * 4.8;
                        se.vy = 4.0;
                        se.isGrounded = false;
                    }
                }
            }
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
            } else if (ev.type === 'HIT' && ev.isThrow) {
                const attacker = ev.attacker === 'p1' ? this.f1 : this.f2;
                const defender = ev.defender === 'p1' ? this.f1 : this.f2;
                if (attacker.gainDaodan) attacker.gainDaodan(ev.damage * DAODAN_CONFIG.GAIN_ON_DEAL_DAMAGE, this.events);
                if (defender.gainDaodan) defender.gainDaodan(ev.damage * DAODAN_CONFIG.GAIN_ON_TAKE_DAMAGE, this.events);
                if (ev.move && ev.move.disarms) {
                    this.disarmFighter(defender, attacker, false);
                }
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

        // Check obstacle collision along line of fire
        const maxRange = spec.range;
        const rayEndX = muzzleX + fx * maxRange;
        const rayEndZ = muzzleZ + fz * maxRange;
        const obsHit = CollisionSystem.checkRayObstacles ? CollisionSystem.checkRayObstacles(muzzleX, muzzleZ, rayEndX, rayEndZ) : null;
        const effectiveRange = obsHit ? Math.hypot(obsHit.x - muzzleX, obsHit.z - muzzleZ) : maxRange;

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

            const candidates = attacker.id === 'p1' ? this.getEnemies() : [this.f1];
            let bestHit = null;
            let hitDefender = null;
            let minHitDist = effectiveRange;

            for (let i = 0; i < candidates.length; i++) {
                const targetFighter = candidates[i];
                if (targetFighter.hp <= 0) continue;
                const hit = CollisionSystem.checkRayHit(
                    attacker,
                    targetFighter,
                    muzzleX,
                    muzzleY,
                    muzzleZ,
                    fx,
                    fz,
                    effectiveRange,
                    syntheticMove
                );
                if (hit && hit.distance < minHitDist) {
                    minHitDist = hit.distance;
                    bestHit = hit;
                    hitDefender = targetFighter;
                }
            }

            const endDist = bestHit && spec.fireType !== 'PIERCING_BEAM' ? bestHit.distance : effectiveRange;
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

            if (bestHit && hitDefender) {
                this.applyDamageResult(attacker, hitDefender, bestHit);
            } else if (obsHit && endDist >= effectiveRange - 0.05) {
                this.events.push({
                    type: 'OBSTACLE_IMPACT',
                    x: endPoint.x,
                    y: muzzleY,
                    z: endPoint.z
                });
            }
        } else if (spec.fireType === 'HOMING_SWARM') {
            const targetCandidate = attacker.id === 'p1'
                ? ((typeof attacker.findBestTarget === 'function' ? attacker.findBestTarget(this.getEnemies()) : null) || this.f2)
                : this.f1;
            const targetId = targetCandidate.id;
            const count = spec.swarmCount || 3;
            for (let k = 0; k < count; k++) {
                const spreadAngle = (k - (count - 1) * 0.5) * 0.28;
                const ca = Math.cos(spreadAngle);
                const sa = Math.sin(spreadAngle);
                const dirX = fx * ca - fz * sa;
                const dirZ = fx * sa + fz * ca;

                const missile = {
                    id: `proj_${this.nextEntitySeq++}`,
                    entityType: 'projectile',
                    ownerId: attacker.id,
                    targetId,
                    weaponType: spec.id,
                    color: spec.color,
                    x: muzzleX,
                    y: muzzleY,
                    z: muzzleZ,
                    vx: dirX * (spec.projectileSpeed * 0.4),
                    vy: (this.random() - 0.5) * 1.5,
                    vz: dirZ * (spec.projectileSpeed * 0.4),
                    speed: spec.projectileSpeed,
                    turnRate: 0.12,
                    life: spec.projectileLife,
                    syntheticMove: {
                        id: spec.id,
                        damage: spec.damage,
                        poiseDamage: spec.poiseDamage,
                        hitStun: spec.hitStun,
                        blockStun: spec.blockStun,
                        knockback: spec.knockback,
                        knockdown: true
                    }
                };
                this.registerEntity(missile);
            }
            this.events.push({
                type: 'WEAPON_FIRE',
                attacker: attacker.id,
                weaponType: spec.id,
                fireType: spec.fireType,
                color: spec.color,
                muzzle: { x: muzzleX, y: muzzleY, z: muzzleZ },
                endPoint: { x: muzzleX + fx * 2.0, y: muzzleY, z: muzzleZ + fz * 2.0 }
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
                    const defenders = wpn.throwAttackerId === 'p1' ? this.getEnemies() : [this.f1];
                    for (let dIdx = 0; dIdx < defenders.length; dIdx++) {
                        const defender = defenders[dIdx];
                        if (defender.hp <= 0) continue;
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
                            break;
                        }
                    }
                }

                // Floor bounce / settle at current platform elevation (Upper Deck y=0 or Lower Catwalk y=-1.8)
                const floorY = CollisionSystem.getFloorHeightAt(wpn.x, wpn.z);
                if (Number.isFinite(floorY) && wpn.y <= floorY + 0.14) {
                    wpn.y = floorY + 0.14;
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
                } else if (!CollisionSystem.isIndoor() && wpn.y <= STAGE_CONFIG.ABYSS_DEATH_Y) {
                    // Weapon fell into the abyss
                    this.removeEntity(wpn.id);
                    continue;
                }
            } else {
                const floorY = CollisionSystem.getFloorHeightAt(wpn.x, wpn.z);
                if (!Number.isFinite(floorY) || wpn.y > floorY + 0.22) {
                    wpn.isGrounded = false;
                } else {
                    wpn.spinYaw += 1.8 * FIXED_DT;
                }
            }

            const bounds = CollisionSystem.getActiveBounds();
            wpn.x = Math.max(bounds.minX + 0.4, Math.min(bounds.maxX - 0.4, wpn.x));
            wpn.z = Math.max(bounds.minZ + 0.4, Math.min(bounds.maxZ - 0.4, wpn.z));
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

            const attacker = p.ownerId === 'p1' ? this.f1 : (this.entities.get(p.ownerId) || this.f2);
            let defender = null;
            if (p.targetId === 'p1') {
                defender = this.f1;
            } else {
                defender = this.entities.get(p.targetId) || this.f2;
                if (!defender || defender.hp <= 0) {
                    defender = (typeof this.f1.findBestTarget === 'function' ? this.f1.findBestTarget(this.getEnemies()) : null) || this.f2;
                }
            }

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

            // Check obstacle interception
            const nextPx = p.x + p.vx * FIXED_DT;
            const nextPz = p.z + p.vz * FIXED_DT;
            if (CollisionSystem.checkRayObstacles && CollisionSystem.checkRayObstacles(p.x, p.z, nextPx, nextPz)) {
                this.removeEntity(p.id);
                continue;
            }

            p.x = nextPx;
            p.y += p.vy * FIXED_DT;
            p.z = nextPz;

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
            const projFloorY = CollisionSystem.getFloorHeightAt(p.x, p.z);
            const bounds = CollisionSystem.getActiveBounds();
            if (
                (Number.isFinite(projFloorY) && p.y <= projFloorY + 0.05) ||
                (!CollisionSystem.isIndoor() && p.y <= STAGE_CONFIG.ABYSS_DEATH_Y) ||
                p.x < bounds.minX - 1.5 ||
                p.x > bounds.maxX + 1.5 ||
                p.z < bounds.minZ - 1.5 ||
                p.z > bounds.maxZ + 1.5
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

        // P2 Stealth Strike: attacking an unalerted enemy deals +50% stealth critical damage
        let isStealthCrit = false;
        if (defender.isAlerted === false && !hitInfo.blocked) {
            isStealthCrit = true;
            const bonus = Math.max(5, Math.round(hitInfo.damage * 0.5));
            defender.hp = Math.max(0, defender.hp - bonus);
            defender.isAlerted = true;
            defender.alertTimer = 120;
            this.events.push({
                type: 'STEALTH_CRIT',
                attacker: attacker.id,
                defender: defender.id,
                bonusDamage: bonus,
                text: 'STEALTH TAKEDOWN! 潜行暴击 (+50% 伤害)'
            });
        } else if (defender.isAlerted === false) {
            defender.isAlerted = true;
            defender.alertTimer = 120;
        }

        // P4 Daodan Chrysalis resonance gain on dealing / taking damage
        if (attacker.gainDaodan) {
            attacker.gainDaodan(hitInfo.damage * DAODAN_CONFIG.GAIN_ON_DEAL_DAMAGE, this.events);
        }
        if (defender.gainDaodan) {
            defender.gainDaodan(hitInfo.damage * DAODAN_CONFIG.GAIN_ON_TAKE_DAMAGE, this.events);
        }

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
        if (this.survivalMode && winnerId === 'p1') {
            this.f2.transitionTo(FIGHTER_STATE.DEFEAT);
            this.respawnTimer = 75; // 1.25s before next Syndicate reinforcement drops in
            this.f1.hypoCount = Math.min(2, this.f1.hypoCount + 1); // reward +1 Hypo-Spray per wave cleared!
            this.events.push({
                type: 'WAVE_CLEARED',
                wave: this.waveNumber
            });
            return;
        }

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
            hp: Math.round(f.hp),
            maxHp: Math.round(f.maxHp),
            poise: Math.round(f.poise),
            daodan: Math.round(f.daodanMeter),
            daodanStage: f.daodanStage,
            overdrive: !!f.daodanOverdrive,
            hypo: f.hypoCount,
            state: f.state,
            stateTimer: f.stateTimer,
            moveId: f.currentMove ? f.currentMove.id : null,
            evadeDir: f.evadeDir,
            isGrounded: !!f.isGrounded,
            isBlocking: !!f.isBlocking,
            invincible: !!f.invincible,
            ringOut: !!f.ringOut,
            combo: f.comboCount,
            weapon: f.weapon ? { type: f.weapon.type, ammo: f.weapon.ammo, maxAmmo: f.weapon.maxAmmo, color: f.weapon.color } : null
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
                maxAmmo: w.maxAmmo,
                color: w.color,
                x: Number(w.x.toFixed(2)),
                y: Number(w.y.toFixed(2)),
                z: Number(w.z.toFixed(2)),
                spinPitch: Number((w.spinPitch || 0).toFixed(2)),
                spinYaw: Number((w.spinYaw || 0).toFixed(2)),
                isGrounded: !!w.isGrounded
            })),
            projectiles: this.getProjectiles().map((p) => ({
                id: p.id,
                weaponType: p.weaponType,
                color: p.color,
                x: Number(p.x.toFixed(2)),
                y: Number(p.y.toFixed(2)),
                z: Number(p.z.toFixed(2)),
                vx: Number(p.vx.toFixed(2)),
                vy: Number(p.vy.toFixed(2)),
                vz: Number(p.vz.toFixed(2))
            })),
            over: this.isMatchOver,
            winner: this.winner
        };
    }

    /**
     * Apply authoritative host snapshot on client peer
     */
    applySnapshot(snap) {
        if (!snap) return;
        this.currentFrame = snap.frame || this.currentFrame;
        if (typeof snap.time === 'number') {
            this.roundTimer = snap.time * 60;
        }
        this.isMatchOver = !!snap.over;
        this.winner = snap.winner || null;

        const applyFighter = (f, s) => {
            if (!s) return;
            f.x = s.x;
            f.y = s.y;
            f.z = s.z;
            f.vx = s.vx || 0;
            f.vy = s.vy || 0;
            f.vz = s.vz || 0;
            if (typeof s.facingAngle === 'number') {
                f.setFacingAngle(s.facingAngle);
            } else if (s.facing) {
                f.facing = s.facing;
            }
            if (typeof s.maxHp === 'number') f.maxHp = s.maxHp;
            f.hp = s.hp;
            f.poise = s.poise;
            f.daodanMeter = s.daodan || 0;
            f.daodanStage = s.daodanStage || 1;
            f.daodanOverdrive = !!s.overdrive;
            if (typeof s.hypo === 'number') f.hypoCount = s.hypo;
            f.state = s.state;
            f.stateTimer = s.stateTimer || 0;
            if (s.moveId && MOVES[s.moveId]) {
                let m = MOVES[s.moveId];
                if (m.id === 'FIRE_WEAPON' && s.weapon) {
                    const spec = WEAPON_SPECS[s.weapon.type] || WEAPON_SPECS.TCTF_PISTOL;
                    m = { ...m, name: spec.name, startup: spec.startup, active: spec.active, recovery: spec.recovery, weaponSpec: spec };
                }
                f.currentMove = m;
            } else {
                f.currentMove = null;
            }
            if (s.evadeDir) f.evadeDir = s.evadeDir;
            f.isGrounded = s.isGrounded !== undefined ? !!s.isGrounded : (s.y <= 0.05);
            f.isBlocking = !!s.isBlocking;
            f.invincible = !!s.invincible;
            f.ringOut = !!s.ringOut;
            f.comboCount = s.combo || 0;
            if (s.weapon) {
                f.equipWeapon(s.weapon);
            } else {
                f.weapon = null;
            }
        };

        applyFighter(this.f1, snap.p1);
        applyFighter(this.f2, snap.p2);

        // Sync weapons & projectiles in entity map
        for (const [id, ent] of this.entities.entries()) {
            if (ent.entityType === 'weapon' || ent.entityType === 'projectile') {
                this.entities.delete(id);
            }
        }
        if (Array.isArray(snap.weapons)) {
            for (const w of snap.weapons) {
                const spec = WEAPON_SPECS[w.type] || WEAPON_SPECS.TCTF_PISTOL;
                this.registerEntity({
                    id: w.id,
                    entityType: 'weapon',
                    type: spec.id,
                    name: spec.name,
                    ammo: w.ammo,
                    maxAmmo: w.maxAmmo || spec.maxAmmo,
                    color: w.color || spec.color,
                    x: w.x,
                    y: w.y,
                    z: w.z,
                    vx: 0,
                    vy: 0,
                    vz: 0,
                    spinPitch: w.spinPitch || 0,
                    spinYaw: w.spinYaw || 0,
                    isGrounded: w.isGrounded !== undefined ? w.isGrounded : true
                });
            }
        }
        if (Array.isArray(snap.projectiles)) {
            for (const p of snap.projectiles) {
                this.registerEntity({
                    id: p.id,
                    entityType: 'projectile',
                    weaponType: p.weaponType,
                    color: p.color || 0xff9900,
                    x: p.x,
                    y: p.y,
                    z: p.z,
                    vx: p.vx || 0,
                    vy: p.vy || 0,
                    vz: p.vz || 0
                });
            }
        }
    }
}
