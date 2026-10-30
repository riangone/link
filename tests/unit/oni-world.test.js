import test from 'node:test';
import assert from 'node:assert';
import { World } from '../../client/oni/src/core/World.js';
import { CollisionSystem } from '../../client/oni/src/core/CollisionSystem.js';

test('Oni World & Multi-Elevation Spatial Geometry (M2)', async (t) => {
    // Construct a multi-tier test world with ground floor, mezzanine, connecting ramp, wall, and locked door
    const testWorldData = {
        id: 'test_syndicate_warehouse',
        name: 'Syndicate Warehouse Multi-tier',
        floors: [
            // Ground floor: y = 0
            { id: 'ground', minX: -10, maxX: 10, minZ: -10, maxZ: 10, y: 0.0 },
            // Mezzanine upper catwalk: y = 3.0
            { id: 'mezzanine', minX: 10, maxX: 20, minZ: -5, maxZ: 5, y: 3.0 }
        ],
        ramps: [
            // Staircase / ramp connecting ground (x=6, y=0) to mezzanine (x=10, y=3.0) along X axis
            { id: 'stair_ramp', minX: 6, maxX: 10, minZ: -2, maxZ: 2, y0: 0.0, y1: 3.0, axis: 'x' }
        ],
        walls: [
            // Security dividing wall at x = 0 spanning z from -8 to 8, height 0 to 4m
            { id: 'dividing_wall', minX: -0.2, maxX: 0.2, minZ: -8, maxZ: 8, minY: 0.0, maxY: 4.0, blocksProjectiles: true },
            // Low barrier: height 0 to 0.8m
            { id: 'low_rail', minX: 2, maxX: 4, minZ: 0, maxZ: 0.3, minY: 0.0, maxY: 0.8, blocksProjectiles: false }
        ],
        doors: [
            // Security blast door at x = 5, spanning z: -1.5 to 1.5, locked by default
            { id: 'door_sec_1', minX: 4.8, maxX: 5.2, minZ: -1.5, maxZ: 1.5, minY: 0, maxY: 3.5, locked: true, openProgress: 0.0, unlocksBy: 'console:c1' }
        ],
        consoles: [
            // Terminal next to the blast door
            { id: 'c1', x: 4.2, y: 0, z: 2.2, hacked: false, action: 'unlock:door_sec_1' }
        ],
        pickups: [
            { id: 'p_hypo_1', type: 'HYPO', x: -3, y: 0, z: 1, collected: false }
        ],
        spawns: [
            { archetype: 'STRIKER', tier: 'green', x: -5, y: 0, z: 0, alert: 'lull' }
        ],
        savePoints: [
            { id: 'sp_1', x: -5, y: 0, z: -5 }
        ],
        spawnPoint: { x: -8, y: 0, z: 0, yaw: 0 },
        killY: -20.0
    };

    const world = new World(testWorldData);
    CollisionSystem.setWorld(world);

    await t.test('floorAt: returns correct ground and mezzanine heights', () => {
        // Ground floor
        assert.strictEqual(world.floorAt(0, 0, 0), 0.0);
        assert.strictEqual(world.floorAt(-5, 3, 0), 0.0);

        // Mezzanine upper floor
        assert.strictEqual(world.floorAt(15, 0, 3.0), 3.0);

        // Outside all floors -> abyss killY
        assert.strictEqual(world.floorAt(50, 50, 0), -20.0);
    });

    await t.test('floorAt: ramp elevation increases monotonically from y0 to y1', () => {
        const yStart = world.floorAt(6.0, 0, 0.0);
        const yMid = world.floorAt(8.0, 0, 1.5);
        const yEnd = world.floorAt(10.0, 0, 3.0);

        assert.strictEqual(yStart, 0.0);
        assert.strictEqual(yMid, 1.5);
        assert.strictEqual(yEnd, 3.0);
    });

    await t.test('resolveCapsuleCollision: pushes character out of solid walls within Y range', () => {
        const capsule = { x: 0.1, y: 1.0, z: 0 };
        world.resolveCapsuleCollision(capsule, 0.35, 1.8);

        // Capsule was inside dividing wall at x = 0 [-0.2, 0.2]; with radius 0.35 it must be pushed out
        assert.ok(capsule.x > 0.2 + 0.34 || capsule.x < -0.2 - 0.34, `Capsule pushed out of wall: x=${capsule.x}`);
    });

    await t.test('resolveCapsuleCollision: does NOT block character above wall maxY', () => {
        // Character is at y = 5.0 (jumping over the 4m wall)
        const capsule = { x: 0.0, y: 5.0, z: 0 };
        world.resolveCapsuleCollision(capsule, 0.35, 1.8);

        // X must remain unchanged because Y is above wall
        assert.strictEqual(capsule.x, 0.0);
    });

    await t.test('door & console interaction: E key hacks console, unlocks door, and door opens', () => {
        const door = world.doors.find(d => d.id === 'door_sec_1');
        assert.strictEqual(door.locked, true);
        assert.strictEqual(door.openProgress, 0.0);

        // Fighter near console presses E
        const fighter = { x: 4.2, y: 0, z: 2.0 };
        const result = world.interact(fighter, 1.6);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.type, 'CONSOLE_HACKED');
        assert.strictEqual(result.doorId, 'door_sec_1');
        assert.strictEqual(door.locked, false, 'Door must be unlocked after console hack');

        // Update world tick with fighter walking near the unlocked door
        const nearFighter = { x: 5.0, y: 0, z: 0.5, hp: 100 };
        world.update(0.1, [nearFighter]);

        assert.ok(door.openProgress > 0.0, `Door should begin opening when unlocked and entity is near: ${door.openProgress}`);
    });

    await t.test('3D Raycast: detects projectile collision against dividing wall', () => {
        const origin = [-5, 1.5, 0];
        const dir = [1, 0, 0]; // Shooting directly eastward through x = 0 wall

        const hit = world.raycast(origin, dir, 20);
        assert.strictEqual(hit.hit, true);
        assert.ok(Math.abs(hit.point[0] - (-0.2)) < 0.05, `Ray hit west face of wall at x=-0.2: ${hit.point[0]}`);
    });

    await t.test('Topological validation: world.validate() confirms ground connectivity', () => {
        assert.strictEqual(world.validate(), true);
    });
});
