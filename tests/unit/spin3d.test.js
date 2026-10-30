import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getBowlHeight,
    getBowlSlope,
    isInPocket,
    isOnRail,
    CORES_3D,
    STADIUM_RADIUS,
    BOWL_DEPTH,
    MAX_SPIN,
    MAX_BURST_HP
} from '../../client/spin3d/src/core/Constants.js';

import { Top3D, Simulation3D } from '../../client/spin3d/src/core/Physics3D.js';
import { CollisionSystem3D } from '../../client/spin3d/src/core/Collision3D.js';
import { BotBrain3D } from '../../client/spin3d/src/core/BotBrain3D.js';

test('Spin 3D - Stadium Bowl Geometry', () => {
    // Center elevation should be zero
    assert.equal(getBowlHeight(0), 0);

    // Height increases towards rim
    const midHeight = getBowlHeight(15);
    const rimHeight = getBowlHeight(STADIUM_RADIUS);
    assert.ok(midHeight > 0);
    assert.ok(rimHeight > midHeight);
    assert.ok(Math.abs(rimHeight - BOWL_DEPTH) < 0.001);

    // Slope is 0 at center and positive towards rim
    assert.equal(getBowlSlope(0), 0);
    assert.ok(getBowlSlope(15) > 0);
    assert.ok(getBowlSlope(30) > getBowlSlope(15));
});

test('Spin 3D - Pocket Gate Detection', () => {
    // In center arena -> not in pocket
    assert.equal(isInPocket(0, 0), false);
    assert.equal(isInPocket(10, 10), false);

    // Right pocket at angle 0 (x > 27.2, z ≈ 0)
    assert.equal(isInPocket(28, 0), true);

    // Left pocket at angle PI (x < -27.2, z ≈ 0)
    assert.equal(isInPocket(-28, 0), true);

    // Non-pocket angle on rim (e.g. angle π/2, x = 0, z = 28)
    assert.equal(isInPocket(0, 28), false);
});

test('Spin 3D - Xtreme Line (Toothed Rail) Detection', () => {
    // Inside radius limits but outside angle arc -> false
    assert.equal(isOnRail(27.5, 0), false); // angle 0 is pocket, not rail

    // Upper rail arc (~π/2, x = 0, z = 27.5) -> true
    assert.equal(isOnRail(0, 27.5), true);

    // Lower rail arc (~3π/2, x = 0, z = -27.5) -> true
    assert.equal(isOnRail(0, -27.5), true);

    // Center arena -> false
    assert.equal(isOnRail(0, 5), false);
});

test('Spin 3D - Top3D Lifecycle & Gyroscopic Precession', () => {
    const top = new Top3D('p1', CORES_3D.attack, 0);
    assert.equal(top.status, 'idle');

    // Launch top
    top.reset(0, 16, 0.9, true);
    assert.equal(top.status, 'spinning');
    assert.ok(top.spin > 80);
    assert.equal(top.burstHp, MAX_BURST_HP);
    assert.equal(top.tiltAngle, 0);

    const sim = new Simulation3D();

    // High spin: upright and stable
    sim.step(top, 1 / 60);
    assert.equal(top.tiltAngle, 0);
    assert.equal(top.isScraping, false);

    // Drain spin below wobble threshold
    top.spin = 25.0;
    sim.step(top, 1 / 60);
    assert.ok(top.tiltAngle > 0);
    assert.ok(top.precessionAngle !== 0);

    // Trigger burst: separates into 4 procedural 3D pieces
    top.triggerBurst();
    assert.equal(top.status, 'bursted');
    assert.equal(top.burstHp, 0);
    assert.equal(top.spin, 0);
    assert.equal(top.burstPieces.length, 4);

    const pieceTypes = top.burstPieces.map(p => p.type);
    assert.deepEqual(pieceTypes, ['chip', 'ring', 'disk', 'tip']);

    // Simulate flying burst pieces
    sim.step(top, 1 / 60);
    assert.ok(top.burstPieces[0].vy !== 0);
});

test('Spin 3D - Collision System & Momentum Transfer', () => {
    const t1 = new Top3D('t1', CORES_3D.attack, 0);
    const t2 = new Top3D('t2', CORES_3D.defense, 1);

    t1.reset(-2.0, 0, 1.0, true);
    t2.reset(2.0, 0, 1.0, false);

    // Set towards each other
    t1.vx = 8.0;
    t2.vx = -8.0;

    const events = [];
    const collided = CollisionSystem3D.checkAndResolve(t1, t2, events);
    assert.equal(collided, true);

    // Momentum bounced them apart
    assert.ok(t1.vx < 0);
    assert.ok(t2.vx > 0);

    // Burst HP decreased on impact
    assert.ok(t1.burstHp < MAX_BURST_HP);
    assert.ok(t2.burstHp < MAX_BURST_HP);

    // Event generated with 3D coordinates
    assert.ok(events.length > 0);
    const clash = events.find(e => e.type === 'clash');
    assert.ok(clash);
    assert.ok(typeof clash.x === 'number');
    assert.ok(typeof clash.intensity === 'number');
});

test('Spin 3D - Bot AI Decision Making', () => {
    const bot = new BotBrain3D('hard');
    const launch = bot.getLaunchParams();
    assert.ok(launch.power > 0.9);
    assert.equal(launch.perfect, true);

    const botTop = new Top3D('bot', CORES_3D.attack, 1);
    const oppTop = new Top3D('player', CORES_3D.stamina, 0);
    botTop.reset(10, 0, 1.0, false);
    oppTop.reset(-10, 0, 1.0, false);

    // Bot updates steering
    bot.thinkCooldown = 0;
    bot.update(botTop, oppTop, 1 / 60);
    assert.ok(botTop.vx !== 0 || botTop.vz !== 0);
});
