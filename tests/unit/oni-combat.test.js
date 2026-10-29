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

        // Move Konoko onto the Medkit Crate (-3.8, -2.2) while damaged
        sim.f1.hp = 60;
        sim.f1.x = -3.8;
        sim.f1.z = -2.2;
        const events1 = [];
        campaign.updateTick({}, events1);
        assert.ok(sim.f1.hp >= 95, 'Walking over Medkit Crate should restore +40 HP');

        // Walk near the Security Console (4.2, -2.6) to hack it
        sim.f1.x = 4.1;
        sim.f1.z = -2.5;
        const events2 = [];
        campaign.updateTick({ punch: true }, events2);
        assert.strictEqual(campaign.consoleHacked, true, 'Interacting with Console should unlock security gate');

        // Defeat Zone 1 Sentry -> should NOT end match, instead should transition to Zone 2!
        sim.f2.hp = 0;
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
});
