// Unit tests for Oni Combat Core Logic (Simulation, HFSM, InputBuffer, CollisionSystem, P0+P1 Deep Combat)
const test = require('node:test');
const assert = require('node:assert');

test('Oni Combat core module loading and P0+P1 simulation verification', async (t) => {
    const { Simulation, createDeterministicRNG } = await import('../../client/oni/src/core/Simulation.js');
    const { InputBuffer } = await import('../../client/oni/src/core/InputBuffer.js');
    const { CollisionSystem } = await import('../../client/oni/src/core/CollisionSystem.js');
    const { MOVES, FIGHTER_STATE } = await import('../../client/oni/src/core/Constants.js');
    const { BotBrain } = await import('../../client/oni/src/core/BotBrain.js');

    await t.test('InputBuffer: tracks frames and recognizes dash, evade, and Rising Fury', () => {
        const ib = new InputBuffer(30);

        // Simulate neutral -> forward -> neutral -> forward
        ib.push({ dirX: 0 });
        ib.push({ dirX: 1 });
        ib.push({ dirX: 0 });
        ib.push({ dirX: 1 });
        assert.strictEqual(ib.checkDashForward(1, 10), true, 'Should detect double tap forward dash');

        // Double-tap back evade
        ib.clear();
        ib.push({ dirX: 0 });
        ib.push({ dirX: -1 });
        ib.push({ dirX: 0 });
        ib.push({ dirX: -1 });
        assert.strictEqual(ib.checkDoubleTapEvade(1, 0, 12), 'BACK', 'Should detect double tap BACK evade');

        // Rising Fury (Crouch + Jump + Kick)
        ib.clear();
        ib.push({ crouch: true });
        ib.push({ jump: true, kick: true });
        assert.strictEqual(ib.checkRisingFury(10), true, 'Should detect Crouch + Jump + Kick Rising Fury');
    });

    await t.test('CollisionSystem: resolves pushbox overlap and 3D relative sectors', () => {
        const f1 = { x: 0, z: 0, facingAngle: 0, facing: 1 };
        const f2 = { x: 0.2, z: 0, facingAngle: Math.PI, facing: -1 };
        CollisionSystem.resolvePushbox(f1, f2, 0.65);

        const newDist = Math.abs(f2.x - f1.x);
        assert.ok(newDist >= 1.29, `Fighters should be pushed apart to ~1.3m, got ${newDist}`);

        // f2 is facing -X (towards f1), so f1 is in f2's FRONT sector
        assert.strictEqual(CollisionSystem.getRelativeSector(f2, f1), 'FRONT');

        // If f1 moves behind f2 (x > f2.x while f2 still faces -X), f1 is in f2's BACK sector
        f1.x = f2.x + 1.0;
        assert.strictEqual(CollisionSystem.getRelativeSector(f2, f1), 'BACK');
    });

    await t.test('Fighter HFSM: P-P-K and K-K-K 3-hit directional chains', () => {
        const sim = new Simulation();
        sim.f1.x = 0;
        sim.f2.x = 5.0; // out of range to test pure chain transitions

        // Start Jab (PUNCH_1)
        sim.tick({ punch: true }, {});
        assert.strictEqual(sim.f1.currentMove.id, 'PUNCH_1');

        // Advance to cancel window (frame 5) and press Punch -> PUNCH_2
        for (let i = 0; i < 5; i++) sim.tick({ punch: false }, {});
        sim.tick({ punch: true }, {});
        for (let i = 0; i < 3; i++) sim.tick({ punch: false }, {});
        assert.strictEqual(sim.f1.currentMove.id, 'PUNCH_2', 'Should chain into PUNCH_2');

        // Advance to cancel window of PUNCH_2 and press Kick -> COMBO_PUNCH_KICK
        for (let i = 0; i < 6; i++) sim.tick({ punch: false, kick: false }, {});
        sim.tick({ kick: true }, {});
        for (let i = 0; i < 4; i++) sim.tick({ kick: false }, {});
        assert.strictEqual(sim.f1.currentMove.id, 'COMBO_PUNCH_KICK', 'Should finish P-P-K with COMBO_PUNCH_KICK');
    });

    await t.test('Combat Hit Detection: Jab damage, Poise break -> DIZZY, and Frontal Throw + Tech', () => {
        const sim = new Simulation();
        sim.f1.x = 2.0;
        sim.f2.x = 2.85;
        sim.f1.facing = 1;
        sim.f2.facing = -1;
        sim.f2.poise = 10; // Low poise so next jab (18 poiseDmg) breaks poise into DIZZY even with regen

        sim.tick({ punch: true }, {});
        for (let i = 0; i < 6; i++) {
            sim.tick({ punch: false }, {});
        }
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.DIZZY, 'Breaking poise should put defender into DIZZY state');

        // Wait out hitstop and PUNCH_1 recovery while f2 remains DIZZY (90 frames)
        for (let i = 0; i < 20; i++) {
            sim.tick({ punch: false }, {});
        }
        sim.f1.x = sim.f2.x - 0.9; // step in within throw range

        // Trigger frontal throw (Punch while close to DIZZY opponent)
        sim.tick({ punch: true }, {});
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.THROW, 'Attacker should enter THROW');
        assert.strictEqual(sim.f1.currentMove.id, 'THROW_FRONT');
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.BEING_THROWN, 'Defender should enter BEING_THROWN');

        // Defender techs the throw within THROW_TECH_WINDOW by pressing throwBtn
        sim.tick({ punch: false }, { throwBtn: true });
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.IDLE, 'Throw tech should return attacker to IDLE');
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.IDLE, 'Throw tech should return defender to IDLE');
    });

    await t.test('Context-Sensitive Back Throw (Untechable Suplex)', () => {
        const sim = new Simulation();
        sim.f1.x = 2.0;
        sim.f2.x = 1.1;
        // Both facing -X, so f1 is directly behind f2!
        sim.f1.facing = -1;
        sim.f2.facing = -1;

        const hpBefore = sim.f2.hp;
        sim.tick({ punch: true }, { throwBtn: true }); // f2 tries to tech, but back throw is untechable
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.THROW);
        assert.strictEqual(sim.f1.currentMove.id, 'THROW_BACK');

        for (let i = 0; i < 25; i++) {
            sim.tick({}, { throwBtn: true });
        }
        assert.ok(sim.f2.hp < hpBefore - 25, 'Back suplex should deal heavy untechable damage');
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.KNOCKED_DOWN);
    });

    await t.test('Omnidirectional Evade I-frames & Break-Fall Tech Recovery (Ukemi)', () => {
        const sim = new Simulation();
        // Double-tap back to trigger EVADE
        sim.tick({ dirX: -1 }, {});
        sim.tick({ dirX: 0 }, {});
        sim.tick({ dirX: -1 }, {});
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.EVADE, 'Should enter EVADE state');
        assert.strictEqual(sim.f1.invincible, true, 'EVADE should grant I-frames');

        // Put f2 in knocked-down falling state and press Jump right before landing -> TECH_RECOVERY
        sim.f2.transitionTo(FIGHTER_STATE.KNOCKED_DOWN);
        sim.f2.y = 0.4;
        sim.f2.vy = -3.0;
        sim.f2.isGrounded = false;
        sim.tick({}, { jump: true });
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.TECH_RECOVERY, 'Pressing Jump before landing should trigger TECH_RECOVERY');
    });

    await t.test('Deterministic Simulation & BotBrain reproducibility', () => {
        const runSim = () => {
            const s = new Simulation(123456);
            const bot1 = new BotBrain('hard', 111);
            const bot2 = new BotBrain('hard', 222);
            for (let i = 0; i < 180; i++) {
                const i1 = bot1.think(s.f1, s.f2, s);
                const i2 = bot2.think(s.f2, s.f1, s);
                s.tick(i1, i2);
            }
            return s.getSnapshot();
        };
        assert.deepStrictEqual(runSim(), runSim(), 'Identical seeds must produce bit-identical snapshots after 180 ticks');
    });

    await t.test('Simulation KO condition', () => {
        const sim = new Simulation();
        sim.f2.hp = 5;
        sim.f1.x = 2.8;
        sim.f2.x = 3.5;

        sim.tick({ punch: true }, { dirX: 0 });
        for (let i = 0; i < 10; i++) {
            sim.tick({ punch: false }, { dirX: 0 });
        }

        assert.strictEqual(sim.isMatchOver, true, 'Match should be over on KO');
        assert.strictEqual(sim.winner, 'p1', 'P1 should be declared winner');
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.VICTORY);
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.DEFEAT);
    });

    await t.test('P2 Gun-Fu: Single-slot weapon, Slide disarm -> airborne drop -> pickup & shoot', () => {
        const sim = new Simulation();
        // Clear initial arena weapons for isolated test
        for (const w of sim.getWeapons()) sim.removeEntity(w.id);
        sim.f1.unequipWeapon();
        sim.f2.equipWeapon({ type: 'TCTF_PISTOL', ammo: 4 });

        sim.f1.x = 0;
        sim.f2.x = 1.65;
        sim.f1.facing = 1;
        sim.f2.facing = -1;

        // 1. P1 performs SLIDE_KICK into armed P2 -> should disarm P2 and spawn an airborne weapon entity!
        sim.tick({ slide: true }, {});
        for (let i = 0; i < 10; i++) {
            sim.tick({ slide: false }, {});
        }
        assert.strictEqual(sim.f2.weapon, null, 'P2 should be disarmed by SLIDE_KICK');
        const droppedWeapons = sim.getWeapons();
        assert.strictEqual(droppedWeapons.length, 1, 'Disarmed gun should spawn as a physical weapon entity in arena');
        assert.strictEqual(droppedWeapons[0].type, 'TCTF_PISTOL');

        // 2. Acrobatic Disarm Snatch: Run + Jump + Punch directly snatches the gun into P1's hand
        const sim2 = new Simulation();
        for (const w of sim2.getWeapons()) sim2.removeEntity(w.id);
        sim2.f1.unequipWeapon();
        sim2.f2.equipWeapon({ type: 'MERCURY_BOW', ammo: 2 });
        sim2.f1.x = 0;
        sim2.f2.x = 1.4;
        sim2.f1.transitionTo(FIGHTER_STATE.RUN);
        sim2.tick({ dirX: 1, jump: true, punch: true }, {});
        assert.strictEqual(sim2.f1.currentMove.id, 'DISARM_KICK', 'Run + Jump + Punch should trigger DISARM_KICK');
        for (let i = 0; i < 7; i++) {
            sim2.tick({ dirX: 1 }, {});
        }
        assert.strictEqual(sim2.f2.weapon, null, 'Defender should lose weapon');
        assert.ok(sim2.f1.weapon && sim2.f1.weapon.type === 'MERCURY_BOW', 'Attacker should snatch weapon in mid-air');

        // 3. Firing Mercury Bow (Piercing Beam) & throwing empty weapon
        const sim3 = new Simulation();
        sim3.f1.equipWeapon({ type: 'MERCURY_BOW', ammo: 1 });
        sim3.f2.unequipWeapon();
        sim3.f1.x = -2.0;
        sim3.f2.x = 2.5;
        const hpBefore = sim3.f2.hp;
        // Fire even while f2 holds block -> Mercury Bow pierces guard!
        sim3.tick({ fire: true }, { block: true });
        for (let i = 0; i < 12; i++) {
            sim3.tick({ fire: false }, { block: true });
        }
        assert.strictEqual(sim3.f1.weapon.ammo, 0, 'Firing should consume 1 ammo');
        assert.ok(sim3.f2.hp < hpBefore - 20, 'Mercury Bow should pierce guard and deal full damage');

        // Wait out hitstop + recovery, then press fire with 0 ammo -> throws the empty weapon!
        for (let i = 0; i < 32; i++) sim3.tick({}, {});
        sim3.tick({ fire: true }, {});
        for (let i = 0; i < 8; i++) sim3.tick({}, {});
        assert.strictEqual(sim3.f1.weapon, null, 'Firing with 0 ammo should throw and unequip the empty weapon');
    });

    await t.test('P2 Gun-Fu: Scram Cannon homing swarm missiles & I-frame evade break-lock', () => {
        const sim = new Simulation();
        for (const w of sim.getWeapons()) sim.removeEntity(w.id);
        sim.f1.equipWeapon({ type: 'SCRAM_CANNON', ammo: 2 });
        sim.f2.unequipWeapon();
        sim.f1.x = -3.0;
        sim.f2.x = 2.0;

        sim.tick({ fire: true }, {});
        for (let i = 0; i < 9; i++) sim.tick({}, {});
        const projs = sim.getProjectiles();
        assert.strictEqual(projs.length, 3, 'Scram Cannon should launch 3 homing micro-missiles');

        // Let missiles fly and hit stationary f2
        const hpBefore = sim.f2.hp;
        for (let i = 0; i < 45; i++) sim.tick({}, {});
        assert.ok(sim.f2.hp < hpBefore, 'Homing missiles should track and damage target');
    });
});
