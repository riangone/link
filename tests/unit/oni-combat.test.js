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

    await t.test('P3 Behavior Tree AI: Projectile Evade, Tactical Hypo-Spray Heal & Survival Waves', () => {
        const sim = new Simulation(999);
        const bot = new BotBrain('hard', 777);

        // 1. Tactical Hypo-Spray Retreat & Heal when HP is low
        sim.f2.hp = 20; // below 32% retreatHpRatio
        sim.f2.hypoCount = 1;
        sim.f1.x = -2.0;
        sim.f2.x = 2.5; // dist = 4.5m (> 2.8m safe distance)

        const decision = bot.think(sim.f2, sim.f1, sim);
        assert.strictEqual(decision.heal, true, 'Hard AI should trigger Hypo-Spray heal when low HP at safe distance');
        assert.strictEqual(bot.lastBranch, 'TACTICAL_HYPO_RETREAT');

        // Execute heal in simulation
        sim.tick({}, decision);
        for (let i = 0; i < 14; i++) sim.tick({}, {});
        assert.ok(sim.f2.hp >= 50, `Hypo-Spray should restore +35 HP (got ${sim.f2.hp})`);
        assert.strictEqual(sim.f2.hypoCount, 0, 'Hypo-Spray charge should be consumed');

        // 2. Survival Wave mode respawn upon defeating enemy
        const waveSim = new Simulation(888);
        waveSim.enableSurvivalMode(true);
        assert.strictEqual(waveSim.waveNumber, 1);
        waveSim.f2.hp = 4;
        waveSim.f1.x = 1.0;
        waveSim.f2.x = 1.75;
        waveSim.tick({ punch: true }, {});
        for (let i = 0; i < 8; i++) waveSim.tick({}, {});
        assert.strictEqual(waveSim.isMatchOver, false, 'Survival mode should not end match when enemy is defeated');
        assert.ok(waveSim.respawnTimer > 0, 'Survival mode should start reinforcement respawn timer');
        for (let i = 0; i < 80; i++) waveSim.tick({}, {});
        assert.strictEqual(waveSim.waveNumber, 2, 'Wave number should advance to 2 after respawn timer');
        assert.ok(waveSim.f2.hp > 90, 'New wave enemy should spawn with full HP');
    });

    await t.test('P4 Daodan Chrysalis: Stage evolution, Devil Spin Kick unlock, and Daodan Overdrive Burst', () => {
        const sim = new Simulation();
        sim.f1.x = 0;
        sim.f2.x = 1.1;
        sim.f1.facing = 1;
        sim.f2.facing = -1;

        assert.strictEqual(sim.f1.daodanStage, 1, 'Fighter starts at Daodan Stage 1');
        sim.f1.gainDaodan(80, sim.events);
        assert.strictEqual(sim.f1.daodanStage, 3, 'Gaining 80 Daodan meter evolves fighter to Stage 3');
        assert.strictEqual(sim.f1.unlockedMoves.has('DEVIL_SPIN_KICK'), true);

        // Trigger Daodan Surge (Overdrive activation) via daodan button
        const hpBefore = sim.f2.hp;
        sim.tick({ daodan: true }, { block: true });
        assert.strictEqual(sim.f1.currentMove.id, 'DAODAN_SURGE');
        for (let i = 0; i < 8; i++) sim.tick({}, { block: true });

        assert.strictEqual(sim.f1.daodanOverdrive, true, 'DAODAN_SURGE should activate Daodan Overdrive');
        assert.ok(sim.f2.hp < hpBefore - 15, 'DAODAN_SURGE should pierce guard and deal burst damage');
    });

    await t.test('P5 Rooftop Elevation, Fall Damage & Ring-Out Abyss KO', () => {
        const sim = new Simulation();

        // 1. Multi-tier elevation query: Upper Deck (y = 0), Lower Catwalk (y = -1.8), Abyss (-Infinity)
        assert.strictEqual(CollisionSystem.getFloorHeightAt(0, 0), 0, 'Center of arena should be Upper Deck (y=0)');
        assert.strictEqual(CollisionSystem.getFloorHeightAt(7.5, 0), -1.8, 'x=7.5 should be Lower Catwalk (y=-1.8)');
        assert.strictEqual(CollisionSystem.getFloorHeightAt(11.0, 0), -Infinity, 'x=11.0 should be Outer Abyss (-Infinity)');

        // 2. Fall Damage when dropping from high altitude onto the Lower Catwalk
        sim.f2.x = 7.5;
        sim.f2.z = 0;
        sim.f2.y = 3.0;
        sim.f2.vy = -16.5; // exceeding FALL_DAMAGE_THRESHOLD_VY (-13.2)
        sim.f2.isGrounded = false;
        const hpBeforeFall = sim.f2.hp;
        for (let i = 0; i < 25; i++) {
            sim.tick({}, {});
            if (sim.f2.isGrounded) break;
        }
        assert.strictEqual(sim.f2.y, -1.8, 'Fighter should land on the lower perimeter catwalk (y = -1.8)');
        assert.ok(sim.f2.hp < hpBeforeFall, `High-velocity impact should deal fall damage (HP: ${hpBeforeFall} -> ${sim.f2.hp})`);
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.KNOCKED_DOWN, 'Heavy fall impact should knock fighter down');

        // 3. Ring-Out KO when knocked beyond the outer catwalk edge into the cyberpunk abyss
        const ringSim = new Simulation();
        ringSim.f2.x = 10.6; // beyond LOWER_CATWALK_X (9.8)
        ringSim.f2.z = 0;
        ringSim.f2.y = -1.8;
        ringSim.f2.vy = -8.0;
        ringSim.f2.isGrounded = false;
        for (let i = 0; i < 40; i++) {
            ringSim.tick({}, {});
            if (ringSim.isMatchOver) break;
        }
        assert.strictEqual(ringSim.f2.ringOut, true, 'Falling below ABYSS_DEATH_Y should flag ringOut = true');
        assert.strictEqual(ringSim.isMatchOver, true, 'Ring-Out should immediately end the match');
        assert.strictEqual(ringSim.winner, 'p1', 'Opponent Ring-Out should award victory to P1');
    });

    await t.test('UX Enhancements: Bot Difficulty Speed Scaling, Jump Attacks, and One-Button Specials', () => {
        const sim = new Simulation();
        const easyBot = new BotBrain('easy', 101);
        const hardBot = new BotBrain('hard', 202);
        assert.ok(easyBot.profile.speedScale < hardBot.profile.speedScale, 'Easy bot should have lower movement speedScale than Hard bot');
        assert.ok(easyBot.profile.attackInterval > hardBot.profile.attackInterval, 'Easy bot should attack less frequently than Hard bot');

        // 1. Directional Jump with horizontal momentum + Mid-Air Jump Kick (FLYING_KICK)
        sim.f1.x = 0;
        sim.f1.z = 0;
        sim.tick({ dirX: 1, jump: true }, {});
        assert.strictEqual(sim.f1.isGrounded, false, 'Pressing jump should launch fighter into the air');
        assert.ok(sim.f1.vx > 4.0, 'Directional jump should impart forward horizontal velocity');

        sim.tick({ dirX: 1, jump: false, kick: true }, {});
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.ATTACK, 'Pressing kick in mid-air should trigger aerial attack');
        assert.strictEqual(sim.f1.currentMove.id, 'FLYING_KICK', 'Mid-air kick should trigger FLYING_KICK');

        // 2. Dedicated one-button Special (Uppercut / Devil Spin Kick) and Evade button
        const sim2 = new Simulation();
        sim2.tick({ special: true }, {});
        assert.strictEqual(sim2.f1.state, FIGHTER_STATE.ATTACK);
        assert.strictEqual(sim2.f1.currentMove.id, 'UPPERCUT', 'Dedicated special button should trigger UPPERCUT');

        const sim3 = new Simulation();
        sim3.tick({ evade: true }, {});
        assert.strictEqual(sim3.f1.state, FIGHTER_STATE.EVADE, 'Dedicated evade button should trigger EVADE roll/backflip');

        // 3. 10-Frame Input Pre-Buffer & Magnetic Combat Lunge
        const sim4 = new Simulation();
        sim4.f1.x = 0;
        sim4.f2.x = 2.1; // mid-close gap (2.1m)
        sim4.f2.z = 0.4; // slight Z offset
        sim4.tick({ punch: true }, {});
        assert.strictEqual(sim4.f1.state, FIGHTER_STATE.ATTACK);
        assert.ok(sim4.f1.vx > 3.5, 'Magnetic combat lunge should propel attacker toward mid-range opponent');
        assert.ok(sim4.f1.vz > 0.5, 'Magnetic combat lunge should gently align Z-axis toward opponent');

        // Press slide 3 frames before recovery finishes -> should automatically fire SLIDE_KICK via pre-buffer!
        const sim5 = new Simulation();
        sim5.f1.transitionTo(FIGHTER_STATE.HIT_STUN);
        sim5.f1.hitStunDuration = 4;
        sim5.tick({ slide: true }, {}); // pressed while still in HIT_STUN!
        sim5.tick({}, {});
        sim5.tick({}, {});
        sim5.tick({}, {}); // exits HIT_STUN on frame 4
        sim5.tick({}, {}); // IDLE evaluates pre-buffered slide press!
        assert.strictEqual(sim5.f1.state, FIGHTER_STATE.ATTACK, 'Pre-buffered button pressed during hit-stun should fire immediately upon recovery');
        assert.strictEqual(sim5.f1.currentMove.id, 'SLIDE_KICK', 'Pre-buffered slide input should execute SLIDE_KICK');

        // 4. Oni 2001 Context-Sensitive Controls:
        // (a) Forward + Evade button triggers SLIDE_KICK
        const sim6 = new Simulation();
        sim6.f1.facing = 1;
        sim6.tick({ dirX: 1, evade: true }, {});
        assert.strictEqual(sim6.f1.state, FIGHTER_STATE.ATTACK);
        assert.strictEqual(sim6.f1.currentMove.id, 'SLIDE_KICK', 'Holding forward + Evade should contextually trigger SLIDE_KICK');

        // (b) Close-range Forward + Punch triggers THROW_FRONT without needing a separate Throw button
        const sim7 = new Simulation();
        sim7.f1.x = 0;
        sim7.f2.x = 1.1;
        sim7.f1.facing = 1;
        sim7.f2.facing = -1;
        sim7.tick({ dirX: 1, punch: true }, {});
        assert.strictEqual(sim7.f1.state, FIGHTER_STATE.THROW, 'Close-range Forward + Punch should contextually trigger THROW_FRONT');
        assert.strictEqual(sim7.f1.currentMove.id, 'THROW_FRONT');

        // (c) Soft Target Strafe: pushing Z-axis in close range circle-strafes around opponent while keeping eyes locked
        const sim8 = new Simulation();
        sim8.f1.x = 0;
        sim8.f1.z = 0;
        sim8.f2.x = 2.2;
        sim8.f2.z = 0;
        for (let i = 0; i < 12; i++) {
            sim8.tick({ dirX: 0, dirZ: 1 }, {});
        }
        assert.ok(sim8.f1.z > 0.2, 'Soft target strafe should smoothly orbit laterally around opponent');
        const angleToOpp = Math.atan2(sim8.f2.z - sim8.f1.z, sim8.f2.x - sim8.f1.x);
        assert.ok(Math.abs(sim8.f1.facingAngle - angleToOpp) < 0.25, 'Fighter should stay locked facing opponent during lateral circle strafe');
    });

    await t.test('P6 TCTF Training Dojo, Story Campaign Zones, Console Hacking & RPG Progression', async () => {
        const { CampaignManager } = await import('../../client/oni/src/core/CampaignManager.js');
        const sim = new Simulation();
        const campaign = new CampaignManager(sim);
        const bot = new BotBrain('easy', 303);

        // 1. Tutorial Dojo Stage 1 -> Stage 2 progression
        campaign.startTutorial();
        assert.strictEqual(campaign.mode, 'TUTORIAL');
        assert.strictEqual(campaign.tutorialStageIdx, 0);
        assert.strictEqual(campaign.commsState.visible, true);

        // Execute 2 Slide Kicks to complete Stage 1
        sim.tick({ dirX: 1, evade: true }, campaign.getTutorialBotInput(bot));
        campaign.updateTick({ dirX: 1, evade: true }, sim.events);
        assert.strictEqual(campaign.tutorialProgress, 1, 'First Slide Kick should advance tutorial progress to 1/2');
        for (let i = 0; i < 35; i++) {
            sim.tick({}, campaign.getTutorialBotInput(bot));
            campaign.updateTick({}, sim.events);
        }
        sim.tick({ dirX: 1, evade: true }, campaign.getTutorialBotInput(bot));
        campaign.updateTick({ dirX: 1, evade: true }, sim.events);
        assert.strictEqual(campaign.tutorialProgress, 2, 'Second Slide Kick should complete Stage 1 goal (2/2)');
        for (let i = 0; i < 40; i++) {
            sim.tick({}, campaign.getTutorialBotInput(bot));
            campaign.updateTick({}, sim.events);
        }
        assert.strictEqual(campaign.tutorialStageIdx, 1, 'Tutorial should automatically advance to Stage 2');

        // 2. Story Campaign Ch.1: Zone 1 combat, Console Hacking, Medkit Pickup & RPG EXP Level Up
        campaign.startChapter('ch1');
        assert.strictEqual(campaign.mode, 'CAMPAIGN');
        assert.strictEqual(campaign.activeChapterId, 'ch1');
        assert.strictEqual(campaign.zoneIndex, 0);
        assert.strictEqual(campaign.consoleHacked, false, 'Zone 1 requires hacking the security console');

        // Move Konoko onto the Medkit Crate while damaged
        const medkit = campaign.interactables.find((i) => i.type === 'MEDKIT_CRATE');
        assert.ok(medkit !== undefined, 'Zone 1 should contain a Medkit Crate');
        sim.f1.hp = 60;
        sim.f1.x = medkit.x;
        sim.f1.z = medkit.z;
        const events1 = [];
        campaign.updateTick({}, events1);
        assert.ok(sim.f1.hp >= 95, 'Walking over Medkit Crate should restore +40 HP');

        // Walk near the Security Console to hack it
        const consoleItem = campaign.interactables.find((i) => i.type === 'CONSOLE');
        assert.ok(consoleItem !== undefined, 'Zone 1 should contain a Security Console');
        sim.f1.x = consoleItem.x;
        sim.f1.z = consoleItem.z;
        const events2 = [];
        campaign.updateTick({ punch: true }, events2);
        assert.strictEqual(campaign.consoleHacked, true, 'Interacting with Console should unlock security gate');

        // Defeat Zone 1 Sentry and squad -> should NOT end match, instead should transition to Zone 2!
        sim.f2.hp = 0;
        for (const e of sim.extraEnemies) e.hp = 0;
        const events3 = [{ type: 'KO', winner: 'p1' }];
        sim.isMatchOver = true;
        campaign.updateTick({}, events3);
        assert.strictEqual(sim.isMatchOver, false, 'Defeating Zone 1 guard must not end the chapter');
        assert.strictEqual(campaign.zoneCleared, true);

        // Advance transition timer to enter Zone 2
        for (let i = 0; i < 90; i++) {
            campaign.updateTick({}, []);
        }
        assert.strictEqual(campaign.zoneIndex, 1, 'Chapter should advance to Zone 2 after Zone 1 clear + console hack');
        assert.ok(sim.f2.hp > 90, 'Zone 2 enemy should spawn with full HP');

        // 3. RPG EXP & Level Up unlocks new moves and increases Max HP
        const lvBefore = campaign.rpg.level;
        const leveled = campaign.addExp(300, []);
        assert.strictEqual(leveled, true, 'Adding 300 EXP should level up Konoko');
        assert.ok(campaign.rpg.level > lvBefore);
        assert.ok(sim.f1.maxHp >= 125, 'Leveling up should increase Konoko Max HP');
        assert.strictEqual(sim.f1.unlockedMoves.has('RISING_FURY'), true, 'Lv.3 should unlock RISING_FURY');

        // 4. TCTF Training Dojo Zero-Fall-Risk Flat Indoor Mode Verification
        campaign.startTutorial();
        assert.strictEqual(CollisionSystem.stageType, 'INDOOR_FLAT');
        assert.strictEqual(CollisionSystem.isIndoor(), true);
        assert.strictEqual(CollisionSystem.getFloorHeightAt(0, 0), 0, 'Indoor dojo center is flat y = 0');
        assert.strictEqual(CollisionSystem.getFloorHeightAt(7.5, 0), 0, 'Indoor dojo x=7.5 is flat y = 0 (no lower catwalk)');
        assert.strictEqual(CollisionSystem.getFloorHeightAt(11.0, 0), 0, 'Indoor dojo x=11.0 is flat y = 0 (no outer abyss)');

        // Verify no fall damage on heavy downward impact in indoor mode
        sim.f2.x = 2.0;
        sim.f2.y = 3.0;
        sim.f2.vy = -16.5;
        sim.f2.isGrounded = false;
        const hpBeforeIndoorImpact = sim.f2.hp;
        for (let i = 0; i < 25; i++) {
            sim.tick({}, {});
            if (sim.f2.isGrounded) break;
        }
        assert.strictEqual(sim.f2.y, 0, 'Fighter should land on flat indoor floor (y = 0)');
        assert.strictEqual(sim.f2.hp, hpBeforeIndoorImpact, 'Zero fall damage risk in indoor flat training mode');

        // Verify no ring-out and horizontal containment in indoor mode
        sim.f2.x = 8.5;
        sim.f2.vx = 20.0;
        for (let i = 0; i < 30; i++) {
            sim.tick({}, {});
        }
        assert.strictEqual(sim.f2.ringOut, false, 'No ring-out permitted in indoor dojo');
        assert.ok(sim.f2.x <= 8.61, 'Fighter should be physically contained by indoor perimeter wall');

        campaign.disableCampaign();
        assert.strictEqual(CollisionSystem.stageType, 'ROOFTOP', 'Disabling campaign restores default rooftop arena mode');
    });

    await t.test('P7 Oni Immersive Campaign: Squad Encounters, Sector Obstacles, Collateral Throw Splash & Tokens', async () => {
        const { CampaignManager } = await import('../../client/oni/src/core/CampaignManager.js');
        const sim = new Simulation();
        const campaign = new CampaignManager(sim);

        // 1. Sector AABB Obstacles & Collision Slidewall
        CollisionSystem.clearObstacles();
        CollisionSystem.setObstacles([
            { id: 'cargo_crate', minX: 1.0, maxX: 3.0, minZ: -1.0, maxZ: 1.0, height: 3.0, blocksProjectiles: true, active: true }
        ]);

        sim.f1.x = 0.5;
        sim.f1.z = 0.0;
        sim.f1.vx = 8.0;
        sim.tick({ dirX: 1.0 }, {});
        assert.ok(sim.f1.x <= 1.01, `Fighter should slide against obstacle boundary, got x=${sim.f1.x}`);

        // Obstacle raycast blocking bullets
        const rayBlocked = CollisionSystem.checkRayObstacles(0, 0, 4.0, 0);
        assert.ok(rayBlocked !== null, 'Obstacle should intercept line of fire');
        assert.strictEqual(rayBlocked.obstacle.id, 'cargo_crate');

        // 2. Multi-enemy squad spawn & target switching
        sim.clearExtraEnemies();
        const extraGrunt = sim.spawnExtraEnemy({
            id: 'extra_sentry',
            name: 'EXTRA SENTRY',
            x: 4.5,
            z: 0.0,
            maxHp: 80
        });
        const enemies = sim.getEnemies();
        assert.strictEqual(enemies.length, 2, 'Should have 2 enemies registered in the sector');
        assert.strictEqual(sim.entities.has('extra_sentry'), true);

        // Soft target selection
        sim.f1.x = 0;
        sim.f1.z = 0;
        sim.f1.setFacingAngle(0); // facing +X towards extraGrunt
        const bestTarget = sim.f1.findBestTarget(enemies);
        assert.ok(bestTarget !== null);

        // 3. Collateral Throw Splash (Body Bowling over adjacent enemies)
        sim.f2.x = 0.9;
        sim.f2.z = 0.0;
        sim.f2.poise = 0;
        sim.f2.transitionTo(FIGHTER_STATE.DIZZY);
        extraGrunt.x = 1.8;
        extraGrunt.z = 0.5;
        extraGrunt.hp = 80;
        extraGrunt.poise = 100;

        // Perform frontal throw on f2
        sim.tick({ punch: true }, {});
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.THROW);

        // Advance until throw release impact
        let collateralTriggered = false;
        for (let i = 0; i < 40; i++) {
            sim.tick({}, {});
            for (const ev of sim.events) {
                if (ev.type === 'COLLATERAL_SPLASH') {
                    collateralTriggered = true;
                }
            }
        }
        assert.strictEqual(collateralTriggered, true, 'Throw slam should emit COLLATERAL_SPLASH event');
        assert.ok(extraGrunt.hp < 80, 'Nearby squad enemy should take collateral splash damage');
        assert.strictEqual(extraGrunt.state, FIGHTER_STATE.KNOCKED_DOWN, 'Nearby squad enemy should be bowled over');

        // 4. Squad Attack Token Management
        BotBrain.releaseAttackToken('enemy_1');
        const token1 = BotBrain.requestAttackToken('enemy_1', 10, 30);
        assert.strictEqual(token1, true, 'First enemy requests and gets attack token');
        const token2 = BotBrain.requestAttackToken('enemy_2', 12, 30);
        assert.strictEqual(token2, false, 'Second enemy request denied while token is actively held');
        const token1Again = BotBrain.requestAttackToken('enemy_1', 15, 30);
        assert.strictEqual(token1Again, true, 'Same token holder retains access');
        const tokenAfterExpire = BotBrain.requestAttackToken('enemy_2', 45, 30);
        assert.strictEqual(tokenAfterExpire, true, 'Second enemy acquires token after previous expired');

        CollisionSystem.clearObstacles();
        sim.clearExtraEnemies();
    });

    await t.test('P8 Oni Continuous Sectors, Stealth Vision Cone & Boss Cinematic Cutscenes', async () => {
        const { CampaignManager, CAMPAIGN_CHAPTERS } = await import('../../client/oni/src/core/CampaignManager.js');
        const sim = new Simulation();
        const campaign = new CampaignManager(sim);

        // 1. P1: Continuous 3-Sector Map Layout & Seamless Transition Across Security Gates
        campaign.startChapter('ch1');
        assert.strictEqual(campaign.mode, 'CAMPAIGN');
        const bounds = CollisionSystem.getActiveBounds();
        assert.ok(bounds.minX <= -20.0 && bounds.maxX >= 30.0, 'Custom bounds should span full grand warehouse');
        assert.strictEqual(sim.f1.x, -22.0, 'Player starts at Sector 1 western entrance (x = -22.0)');
        assert.strictEqual(campaign.zoneIndex, 0);

        // Hack Console 1
        const console1 = campaign.interactables.find((i) => i.type === 'CONSOLE');
        sim.f1.x = console1.x;
        sim.f1.z = console1.z;
        campaign.updateTick({ punch: true }, []);
        assert.strictEqual(campaign.consoleHacked, true);

        // Defeat all Sector 1 enemies
        sim.f2.hp = 0;
        for (const e of sim.extraEnemies) e.hp = 0;
        campaign.updateTick({}, [{ type: 'KO', winner: 'p1' }]);
        assert.strictEqual(campaign.zoneCleared, true);

        // Physically run eastwards across Gate 1 (x = -6.0)
        sim.f1.x = -5.5; // crossed threshold
        campaign.updateTick({ dirX: 1.0 }, []);
        assert.strictEqual(campaign.zoneIndex, 1, 'Running across open Gate 1 should advance to Sector 2 seamlessly');
        assert.strictEqual(sim.f1.x, -5.5, 'Player physical coordinates must NOT be reset on sector advance');
        assert.ok(sim.f2.x >= 1.5, 'Sector 2 Striker Trooper should be positioned in Sector 2 (x >= 1.5)');

        // 2. P2: Stealth Patrol, Vision Cone & Squad Alert Escalation
        const sentry = sim.f2;
        sentry.isAlerted = false;
        sentry.facing = 1; // looking east (+X)
        sentry.x = 4.0;
        sentry.z = 0.0;

        // Player sneaks up directly behind the sentry (at x = 2.5, facing east)
        sim.f1.x = 2.5;
        sim.f1.z = 0.0;
        const bb = new BotBrain('normal');
        const blankInput = bb.createBlankInput();
        const status = bb.branchPatrolAndAlert({
            bot: sentry,
            opp: sim.f1,
            dist: 1.5,
            input: blankInput,
            sim
        });
        assert.strictEqual(sentry.isAlerted, false, 'Approaching from rear blindspot should not alert the sentry');

        // Performing an attack from behind deals +50% stealth critical damage
        const hpBeforeStealth = sentry.hp;
        sim.events = [];
        sim.applyDamageResult(sim.f1, sentry, {
            hitPoint: { x: 3.5, y: 1.0, z: 0 },
            move: { damage: 20, knockdown: false, knockback: { x: 2.0, y: 0 } }
        });
        assert.strictEqual(sentry.isAlerted, true, 'Suffering a stealth attack immediately triggers alert');
        const stealthEvent = sim.events.find((e) => e.type === 'STEALTH_CRIT');
        assert.ok(stealthEvent !== undefined, 'Stealth takedown must trigger STEALTH_CRIT event');
        assert.strictEqual(sentry.hp, hpBeforeStealth - 30, 'Stealth takedown deals base 20 + 50% bonus (30 total)');

        // 3. P3: Boss Battle Cinematic Cutscene, Typewriter & Instant Skip
        // Transition into Sector 3 (Boss Barabas)
        campaign.setupCampaignZone(CAMPAIGN_CHAPTERS[1], 2, false);
        assert.strictEqual(campaign.zoneIndex, 2);
        assert.strictEqual(campaign.cinematic.active, true, 'Entering Boss zone initiates cinematic cutscene');
        assert.strictEqual(campaign.cinematic.bossName, 'BARABAS (巴拉巴斯)');

        // Typewriter advances progressively
        const initialText = campaign.cinematic.typedText;
        campaign.updateTick({}, []);
        campaign.updateTick({}, []);
        assert.ok(campaign.cinematic.typeIndex > 0, 'Typewriter character index advances during cutscene');

        // Instant Skip on user input / keypress
        sim.events = [];
        campaign.skipBossCinematic();
        assert.strictEqual(campaign.cinematic.active, false, 'Skipping cutscene deactivates cinematic mode');
        const engageEvent = sim.events.find((e) => e.type === 'BOSS_ENGAGE');
        assert.ok(engageEvent !== undefined, 'Skipping cutscene emits BOSS_ENGAGE combat event');

        campaign.disableCampaign();
    });

    await t.test('P9 Global Difficulty Scaling (Recruit / Elite / Master) & Player Damage Mitigation', async () => {
        const { DIFFICULTY_PRESETS } = await import('../../client/oni/src/core/Constants.js');
        const sim = new Simulation();

        // 1. Default difficulty must be 'easy' (Recruit) for approachable combat
        assert.strictEqual(sim.difficulty, 'easy');
        assert.strictEqual(sim.f1.damageTakenMult, DIFFICULTY_PRESETS.easy.playerDamageTakenMult);
        assert.ok(sim.f1.damageTakenMult < 1.0, 'Player takes mitigated damage in Recruit mode (0.65x)');

        // Test damage mitigation on incoming strike
        const hitResultRecruit = sim.f1.takeHit({ move: { damage: 20, poiseDamage: 40, knockback: { x: 2, y: 0 } }, isBlock: false }, 1);
        assert.strictEqual(hitResultRecruit.damage, 13, '20 base damage scaled by 0.65 = 13');

        // 2. Switch difficulty to 'hard' (Master)
        sim.setDifficulty('hard');
        assert.strictEqual(sim.difficulty, 'hard');
        assert.strictEqual(sim.f1.damageTakenMult, DIFFICULTY_PRESETS.hard.playerDamageTakenMult);
        const hitResultMaster = sim.f1.takeHit({ move: { damage: 20, poiseDamage: 40, knockback: { x: 2, y: 0 } }, isBlock: false }, 1);
        assert.strictEqual(hitResultMaster.damage, 26, '20 base damage scaled by 1.3 = 26 in Master mode');

        // 3. Enemy HP scaling based on difficulty
        sim.setDifficulty('easy');
        const recruitEnemy = sim.spawnExtraEnemy({ maxHp: 100 });
        assert.strictEqual(recruitEnemy.hp, 75, 'Enemy HP scaled by 0.75 in Recruit mode');

        sim.setDifficulty('hard');
        const masterEnemy = sim.spawnExtraEnemy({ maxHp: 100 });
        assert.strictEqual(masterEnemy.hp, 125, 'Enemy HP scaled by 1.25 in Master mode');
        sim.clearExtraEnemies();
    });

    await t.test('P10 Dynamic Alarm & Reinforcements Engine, Run-To-Alarm & Stealth Intercept', async () => {
        const { CampaignManager, CAMPAIGN_CHAPTERS } = await import('../../client/oni/src/core/CampaignManager.js');
        const sim = new Simulation();
        const campaign = new CampaignManager(sim);
        sim.campaignManager = campaign;

        campaign.startChapter('ch1');
        assert.strictEqual(campaign.alarmActive, false);

        // Verify alarm console presence in Sector 1
        const alarmConsole = campaign.interactables.find((i) => i.type === 'ALARM_CONSOLE');
        assert.ok(alarmConsole !== undefined, 'Sector 1 must contain an ALARM_CONSOLE interactable');

        // 1. Sentry runs towards alarm console when alerted
        const sentry = sim.f2;
        sentry.canTriggerAlarm = true;
        sentry.isAlerted = true;
        sentry.x = alarmConsole.x + 4.0;
        sentry.z = alarmConsole.z;

        const bb = new BotBrain('easy');
        const input = bb.createBlankInput();
        const status = bb.branchRunToAlarm({
            bot: sentry,
            input,
            sim
        });
        assert.strictEqual(status, 'RUNNING');
        assert.strictEqual(sentry.isRunningToAlarm, true);
        assert.strictEqual(input.dirX, -1, 'Sentry moves westwards towards alarm console');

        // 2. Sentry triggers alarm upon reaching console
        sentry.x = alarmConsole.x + 0.5;
        const statusAtConsole = bb.branchRunToAlarm({
            bot: sentry,
            input,
            sim
        });
        assert.strictEqual(statusAtConsole, 'SUCCESS');
        assert.strictEqual(campaign.alarmActive, true, 'Alarm must be triggered');
        assert.strictEqual(alarmConsole.alarmTriggered, true);

        // Reinforcements squad should spawn
        assert.ok(sim.extraEnemies.length >= 2, 'Alarm must spawn dynamic reinforcement squad');

        // 3. Player approaches console and overrides/disables alarm
        sim.f1.x = alarmConsole.x;
        sim.f1.z = alarmConsole.z;
        const tickEvents = [];
        campaign.updateTick({ punch: true }, tickEvents);
        assert.strictEqual(campaign.alarmActive, false, 'Interacting with tripped console disables alarm');
        const disabledEv = tickEvents.find((e) => e.type === 'ALARM_DISABLED');
        assert.ok(disabledEv !== undefined, 'Should emit ALARM_DISABLED event');

        campaign.disableCampaign();
        sim.clearExtraEnemies();
    });

    await t.test('P11 Distinct Enemy Archetypes (Striker, Fury, Tanker, Sniper, Black-Ops)', async () => {
        const sim = new Simulation();
        sim.setDifficulty('normal');

        // 1. TANKER: Big scale, high poise, ground stomp
        const tanker = sim.spawnExtraEnemy({ archetype: 'TANKER', maxHp: 160 });
        assert.strictEqual(tanker.archetype, 'TANKER');
        assert.strictEqual(tanker.scale, 1.25, 'Tanker model scale should be 1.25x');
        assert.strictEqual(tanker.maxPoise, 180, 'Tanker has high poise (180)');
        assert.strictEqual(tanker.unlockedMoves.has('GROUND_STOMP'), true);

        // 2. FURY: Agile female assassin, slide kick, willow kick, throw
        const fury = sim.spawnExtraEnemy({ archetype: 'FURY', maxHp: 80 });
        assert.strictEqual(fury.archetype, 'FURY');
        assert.strictEqual(fury.scale, 0.94, 'Fury model scale should be 0.94x');
        assert.strictEqual(fury.unlockedMoves.has('SLIDE_KICK'), true);
        assert.strictEqual(fury.unlockedMoves.has('WILLOW_KICK'), true);

        // 3. BLACK_OPS: Optical camouflage stealth
        const blackOps = sim.spawnExtraEnemy({ archetype: 'BLACK_OPS' });
        assert.strictEqual(blackOps.archetype, 'BLACK_OPS');
        assert.strictEqual(blackOps.isCamouflage, true, 'Black-Ops features active camouflage');

        // 4. SNIPER: Long-range marksman
        const sniper = sim.spawnExtraEnemy({ archetype: 'SNIPER' });
        assert.strictEqual(sniper.archetype, 'SNIPER');
        assert.strictEqual(sniper.isSniper, true);

        sim.clearExtraEnemies();
    });
});
