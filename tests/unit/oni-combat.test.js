// Unit tests for Oni Combat Core Logic (Simulation, HFSM, InputBuffer, CollisionSystem)
const test = require('node:test');
const assert = require('node:assert');

test('Oni Combat core module loading and simulation verification', async (t) => {
    const { Simulation } = await import('../../client/oni/src/core/Simulation.js');
    const { InputBuffer } = await import('../../client/oni/src/core/InputBuffer.js');
    const { CollisionSystem } = await import('../../client/oni/src/core/CollisionSystem.js');
    const { MOVES, FIGHTER_STATE } = await import('../../client/oni/src/core/Constants.js');

    await t.test('InputBuffer: tracks frames and recognizes dash', () => {
        const ib = new InputBuffer(30);

        // Simulate neutral
        ib.push({ dirX: 0 });
        ib.push({ dirX: 1 }); // tap forward
        ib.push({ dirX: 0 }); // release
        ib.push({ dirX: 1 }); // tap forward again

        const isDash = ib.checkDashForward(1, 10);
        assert.strictEqual(isDash, true, 'Should detect double tap forward dash');
    });

    await t.test('CollisionSystem: resolves pushbox overlap', () => {
        const f1 = { x: 0, z: 0 };
        const f2 = { x: 0.2, z: 0 };
        CollisionSystem.resolvePushbox(f1, f2, 0.65);

        const newDist = Math.abs(f2.x - f1.x);
        assert.ok(newDist >= 1.29, `Fighters should be pushed apart to ~1.3m, got ${newDist}`);
    });

    await t.test('Fighter HFSM: transition through Attack and recovery', () => {
        const sim = new Simulation();
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.IDLE);

        // Player presses punch
        sim.tick({ punch: true }, { dirX: 0 });
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.ATTACK);
        assert.strictEqual(sim.f1.currentMove.id, 'PUNCH_1');

        // Advance frames past recovery
        for (let i = 0; i < 20; i++) {
            sim.tick({ punch: false }, { dirX: 0 });
        }
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.IDLE, 'Should return to IDLE after recovery');
    });

    await t.test('Combat Hit Detection: Jab damage and Hitstop', () => {
        const sim = new Simulation();
        // Move P1 close to P2
        sim.f1.x = 2.8;
        sim.f2.x = 3.5;
        sim.f1.facing = 1;
        sim.f2.facing = -1;

        const hpBefore = sim.f2.hp;
        // P1 triggers punch
        sim.tick({ punch: true }, { dirX: 0 });

        // Step until active frames hit
        let hitDetected = false;
        for (let i = 0; i < 8; i++) {
            sim.tick({ punch: false }, { dirX: 0 });
            if (sim.hitstopFrames > 0) {
                hitDetected = true;
                break;
            }
        }

        assert.ok(hitDetected, 'Hitstop should be triggered upon impact');
        assert.ok(sim.f2.hp < hpBefore, `P2 should take damage (Before: ${hpBefore}, After: ${sim.f2.hp})`);
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.HIT_STUN, 'Defender should enter HIT_STUN');
    });

    await t.test('Simulation KO condition', () => {
        const sim = new Simulation();
        sim.f2.hp = 5;
        sim.f1.x = 2.8;
        sim.f2.x = 3.5;

        // P1 punches to finish P2
        sim.tick({ punch: true }, { dirX: 0 });
        for (let i = 0; i < 10; i++) {
            sim.tick({ punch: false }, { dirX: 0 });
        }

        assert.strictEqual(sim.isMatchOver, true, 'Match should be over on KO');
        assert.strictEqual(sim.winner, 'p1', 'P1 should be declared winner');
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.VICTORY);
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.DEFEAT);
    });
});
