import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../client/oni/src/core/Simulation.js';
import { OniRules, ArenaRules } from '../../client/oni/src/core/Rules.js';

test('Oni Rules: Campaign exploration has no timeout limit and handles player death / enemy down events', () => {
    const sim = new Simulation();
    sim.setCampaignMode(true);

    assert.strictEqual(sim.rules.name, 'ONI_CAMPAIGN');
    assert.strictEqual(sim.roundTimer, -1, 'Campaign mode should have roundTimer = -1');

    // Run 180 ticks (3 seconds)
    for (let i = 0; i < 180; i++) {
        sim.tick({}, {});
    }
    assert.strictEqual(sim.isMatchOver, false, 'No timeout defeat should occur during campaign exploration');

    // Defeating an enemy emits FIGHTER_DOWN, not KO
    sim.f2.hp = 0;
    sim.tick({}, {});
    const downEvent = sim.events.find((e) => e.type === 'FIGHTER_DOWN');
    assert.ok(downEvent, 'Defeated enemy should emit FIGHTER_DOWN');
    assert.strictEqual(downEvent.entityId, sim.f2.id);

    // Player death triggers PLAYER_DEAD event
    sim.f1.hp = 0;
    sim.tick({}, {});
    assert.strictEqual(sim.isMatchOver, true);
    const deathEvent = sim.events.find((e) => e.type === 'PLAYER_DEAD');
    assert.ok(deathEvent, 'Defeated player should emit PLAYER_DEAD event for checkpoint retry');
});

test('Arena Rules: Arcade / PvP mode retains round countdown and timeout resolution', () => {
    const sim = new Simulation();
    sim.setRules(new ArenaRules(1)); // 1 second round = 60 frames

    assert.strictEqual(sim.rules.name, 'ARENA');
    assert.strictEqual(sim.roundTimer, 60);

    for (let i = 0; i < 60; i++) {
        sim.tick({}, {});
    }

    assert.strictEqual(sim.isMatchOver, true, 'Match should finish on timeout');
    assert.ok(sim.winner !== null, 'A winner or draw should be declared');
});

test('Simulation entity resolution: extra enemy firearms do not hijack f2 state', () => {
    const sim = new Simulation();
    const enemy = sim.spawnExtraEnemy({
        id: 'enemy_trooper_99',
        name: 'Syndicate Trooper 99',
        x: 10,
        z: 2,
        facing: -1,
        weapon: 'TCTF_PISTOL'
    });

    // Make f2 dead and far away
    sim.f2.hp = 0;
    sim.f2.x = -20;

    // Simulate WEAPON_FIRE_REQUEST from extra enemy
    sim.events.push({
        type: 'WEAPON_FIRE_REQUEST',
        attacker: enemy.id,
        weaponType: 'TCTF_PISTOL'
    });

    sim.processFighterRequests();
    const fireEvent = sim.events.find((e) => e.type === 'WEAPON_FIRE');
    assert.ok(fireEvent, 'Should emit WEAPON_FIRE event for hitscan firearm');
    assert.strictEqual(fireEvent.attacker, enemy.id, 'Attacker must be extra enemy id');
    // Muzzle position must be near extra enemy (x ~ 10), not f2 (x = -20)
    assert.ok(Math.abs(fireEvent.muzzle.x - enemy.x) < 2.0, `Muzzle x (${fireEvent.muzzle.x}) should be near enemy x (10)`);
});
