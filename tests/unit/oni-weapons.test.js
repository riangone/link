import test from 'node:test';
import assert from 'node:assert';
import { WEAPON_REGISTRY, WeaponSystem } from '../../client/oni/src/core/Weapons.js';
import { World } from '../../client/oni/src/core/World.js';

test('Oni Weapons & 3D Ballistic Trajectory Raycast (M2)', async (t) => {
    await t.test('WEAPON_REGISTRY defines all 6 canonical Oni firearms', () => {
        const expected = [
            'TCTF_PISTOL',
            'PLASMA_RIFLE',
            'SCRAM_CANNON',
            'VAN_DE_GRAAFF',
            'MERCURY_BOW',
            'BLACK_THUNDER'
        ];
        for (const id of expected) {
            const spec = WEAPON_REGISTRY[id];
            assert.ok(spec, `Weapon spec ${id} must exist`);
            assert.ok(spec.clip > 0, `${id} clip must be > 0`);
            assert.ok(spec.damage > 0, `${id} damage must be > 0`);
            assert.ok(spec.range > 0, `${id} range must be > 0`);
        }
    });

    await t.test('Weapon firing consumes ammo and halts when empty', () => {
        const fighter = {
            id: 'p1',
            x: 0, y: 0, z: 0,
            facingAngle: 0,
            weapon: { type: 'TCTF_PISTOL', clipAmmo: 2 },
            ammo: { BALLISTIC: 20 },
            isHolstered: false,
            fireCooldown: 0,
            reloadTimer: 0
        };

        const target = { id: 'bot1', x: 5, y: 0, z: 0, hp: 100 };

        // Shot 1
        const shot1 = WeaponSystem.fire(fighter, null, [target], 0, 0);
        assert.strictEqual(shot1.fired, true);
        assert.strictEqual(shot1.target.id, 'bot1');
        assert.strictEqual(fighter.weapon.clipAmmo, 1);
        assert.strictEqual(target.hp, 88); // 100 - 12

        // Reset cooldown for next shot
        fighter.fireCooldown = 0;

        // Shot 2
        const shot2 = WeaponSystem.fire(fighter, null, [target], 0, 0);
        assert.strictEqual(shot2.fired, true);
        assert.strictEqual(fighter.weapon.clipAmmo, 0);
        assert.strictEqual(target.hp, 76);

        // Shot 3 (Empty magazine)
        fighter.fireCooldown = 0;
        const shot3 = WeaponSystem.fire(fighter, null, [target], 0, 0);
        assert.strictEqual(shot3.fired, false);
        assert.strictEqual(shot3.reason, 'NO_AMMO_OR_COOLDOWN');
    });

    await t.test('Reload (R key) refills magazine from reserve ammunition pool', () => {
        const fighter = {
            id: 'p1',
            weapon: { type: 'TCTF_PISTOL', clipAmmo: 0 },
            ammo: { BALLISTIC: 15 },
            reloadTimer: 0
        };

        const reloaded = WeaponSystem.reload(fighter);
        assert.strictEqual(reloaded, true);
        assert.strictEqual(fighter.weapon.clipAmmo, 10);
        assert.strictEqual(fighter.ammo.BALLISTIC, 5); // 15 - 10
        assert.ok(fighter.reloadTimer > 0, 'Reload timer initiated');
    });

    await t.test('Holster toggle (Q key) prevents firing when holstered', () => {
        const fighter = {
            id: 'p1',
            weapon: { type: 'PLASMA_RIFLE', clipAmmo: 24 },
            isHolstered: false,
            fireCooldown: 0,
            reloadTimer: 0
        };

        assert.strictEqual(WeaponSystem.canFire(fighter), true);
        WeaponSystem.toggleHolster(fighter);
        assert.strictEqual(fighter.isHolstered, true);
        assert.strictEqual(WeaponSystem.canFire(fighter), false);

        WeaponSystem.toggleHolster(fighter);
        assert.strictEqual(fighter.isHolstered, false);
        assert.strictEqual(WeaponSystem.canFire(fighter), true);
    });

    await t.test('3D pitch raycasting hits high ground elevation and misses when flat', () => {
        const fighter = {
            id: 'p1',
            x: 0, y: 0, z: 0,
            facingAngle: 0,
            weapon: { type: 'TCTF_PISTOL', clipAmmo: 10 },
            isHolstered: false,
            fireCooldown: 0,
            reloadTimer: 0
        };

        // Target is elevated on a 3.0m catwalk 8m away
        const elevatedTarget = { id: 'sniper', x: 8, y: 3.0, z: 0, hp: 100 };

        // Horizontal shot (pitch = 0): ray travels at y = 1.25, flies under elevated target (y in [3.0, 4.8])
        const flatShot = WeaponSystem.fire(fighter, null, [elevatedTarget], 0, 0);
        assert.strictEqual(flatShot.fired, true);
        assert.strictEqual(flatShot.target, null, 'Horizontal shot should miss elevated target');

        // Angled shot aimed upward: dy = 3.0 - 1.25 = 1.75, dx = 8.0, pitch ~ 0.215 rad
        fighter.fireCooldown = 0;
        const pitchAngle = Math.atan2(1.75 + 0.5, 8.0);
        const angledShot = WeaponSystem.fire(fighter, null, [elevatedTarget], pitchAngle, 0);
        assert.strictEqual(angledShot.fired, true);
        assert.strictEqual(angledShot.target.id, 'sniper', 'Angled shot must hit elevated sniper target');
    });

    await t.test('Van de Graaff stun gun inflicts DIZZY state on hit', () => {
        const fighter = {
            id: 'p1',
            x: 0, y: 0, z: 0,
            facingAngle: 0,
            weapon: { type: 'VAN_DE_GRAAFF', clipAmmo: 5 },
            isHolstered: false,
            fireCooldown: 0,
            reloadTimer: 0
        };

        let transitionedState = null;
        const target = {
            id: 'guard',
            x: 4, y: 0, z: 0,
            hp: 80,
            transitionTo(state) {
                transitionedState = state;
            }
        };

        const shot = WeaponSystem.fire(fighter, null, [target], 0, 0);
        assert.strictEqual(shot.fired, true);
        assert.strictEqual(shot.causedDizzy, true);
        assert.strictEqual(transitionedState, 'DIZZY');
    });

    await t.test('World geometry raycast stops bullet before target behind wall', () => {
        const world = new World({
            walls: [
                { minX: 1.8, maxX: 2.2, minZ: -5, maxZ: 5, minY: 0, maxY: 4, blocksProjectiles: true }
            ]
        });

        const fighter = {
            id: 'p1',
            x: 0, y: 0, z: 0,
            facingAngle: 0,
            weapon: { type: 'TCTF_PISTOL', clipAmmo: 5 },
            isHolstered: false,
            fireCooldown: 0,
            reloadTimer: 0
        };

        const targetBehindWall = { id: 'sheltered_target', x: 6, y: 0, z: 0, hp: 100 };

        const shot = WeaponSystem.fire(fighter, world, [targetBehindWall], 0, 0);
        assert.strictEqual(shot.fired, true);
        assert.strictEqual(shot.wallHit, true);
        assert.strictEqual(shot.target, null, 'Target behind wall must not be hit');
        assert.strictEqual(targetBehindWall.hp, 100);
        assert.ok(shot.hitPoint[0] <= 2.2, `Hit point clipped by wall: ${shot.hitPoint[0]}`);
    });
});
