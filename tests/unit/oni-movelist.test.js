// Oni 2001 Konoko move list: every input from the original Combat_moves table maps to a move,
// plus mouse-look (aimYaw) controls and chapter-gated unlocks.
const test = require('node:test');
const assert = require('node:assert');

test('oni move list matches the original input table', async (t) => {
    const { Simulation } = await import('../../client/oni/src/core/Simulation.js');
    const { MOVES, MOVE_TABLE, FIGHTER_STATE, MOVE_CHAPTER_UNLOCK } = await import('../../client/oni/src/core/Constants.js');
    const { ATTACK_ANIMS, getAttackAnim } = await import('../../client/oni/src/render/AnimationLibrary.js');

    // f1 at origin facing +X; f2 `dist` metres in front (or behind) and idle
    function setup(dist = 2.2, behind = false) {
        const sim = new Simulation();
        sim.f1.x = 0; sim.f1.z = 0; sim.f1.setFacingAngle(0);
        sim.f2.x = dist; sim.f2.z = 0; sim.f2.setFacingAngle(behind ? 0 : Math.PI);
        sim.f2.isBot = true;
        return sim;
    }
    const idle = (sim, n = 1, inp = {}) => { for (let i = 0; i < n; i++) sim.tick(inp, {}); };
    const moveId = (sim) => (sim.f1.currentMove ? sim.f1.currentMove.id : null);
    // ride out the current move, feeding `inp` and pressing `btn` once the cancel window opens
    function chainInto(sim, btn, extra = {}) {
        const m = sim.f1.currentMove;
        const start = m.cancelWindowStart || m.startup + 1;
        while (sim.f1.stateTimer < start) idle(sim, 1, extra);
        idle(sim, 1, { ...extra, [btn]: true });
        for (let i = 0; i < 40 && sim.f1.currentMove === m; i++) idle(sim, 1, extra);
        return moveId(sim);
    }

    await t.test('every MOVE_TABLE entry points at a defined move with an animation', () => {
        for (const e of MOVE_TABLE) {
            assert.ok(MOVES[e.id], `MOVES.${e.id} missing`);
            if (!MOVES[e.id].isFirearmMove && !MOVES[e.id].isWeaponThrow) {
                assert.ok(getAttackAnim(MOVES[e.id]), `no animation for ${e.id}`);
            }
        }
        for (let i = 1; i < MOVE_TABLE.length; i++) {
            assert.ok(MOVE_TABLE[i - 1].priority >= MOVE_TABLE[i].priority, 'table must be priority sorted');
        }
        for (const id of Object.keys(MOVE_CHAPTER_UNLOCK)) assert.ok(MOVES[id], `unlock gate for unknown ${id}`);
        assert.ok(ATTACK_ANIMS.JUMP_FLIP && ATTACK_ANIMS.GETUP_KICK.from === 'SIT_UP');
    });

    await t.test('punch string P,P,P and P,P,K,K,K,K', () => {
        let sim = setup(1.0);
        idle(sim, 1, { punch: true });
        assert.strictEqual(moveId(sim), 'PUNCH_1');
        assert.strictEqual(chainInto(sim, 'punch'), 'PUNCH_2');
        assert.strictEqual(chainInto(sim, 'punch'), 'PUNCH_3');

        sim = setup(1.0);
        idle(sim, 1, { punch: true });
        chainInto(sim, 'punch');
        assert.strictEqual(chainInto(sim, 'kick'), 'COMBO_PUNCH_KICK', 'P,P,K = Sledgehammer Heel');
        assert.strictEqual(chainInto(sim, 'kick'), 'PPK_K');
        assert.strictEqual(chainInto(sim, 'kick'), 'PPK_KK');
        assert.strictEqual(chainInto(sim, 'kick'), 'PPK_KKK');
    });

    await t.test('kick string K,K,K and K,K,forward+K', () => {
        let sim = setup(1.0);
        idle(sim, 1, { kick: true });
        assert.strictEqual(moveId(sim), 'KICK_LOW');
        assert.strictEqual(chainInto(sim, 'kick'), 'KICK_MID');
        assert.strictEqual(chainInto(sim, 'kick'), 'KICK_HEAVY', 'K,K,K = Spinning Sidekick');

        sim = setup(1.0);
        idle(sim, 1, { kick: true });
        chainInto(sim, 'kick');
        assert.strictEqual(chainInto(sim, 'kick', { dirX: 1 }), 'CRESCENT_MOON_KICK', 'K,K,fwd+K = Crescent Moon');
    });

    await t.test('directional and motion attacks', () => {
        const cases = [
            [{ dirZ: 1, punch: true }, 'SIDE_PUNCH'],
            [{ dirZ: -1, kick: true }, 'SIDE_KICK'],
            [{ dirX: -1, punch: true }, 'BACK_SPIN_FIST'],
            [{ dirX: -1, kick: true }, 'BACK_KICK'],
            [{ dirX: 1, kick: true }, 'KICK_FW']
        ];
        for (const [inp, id] of cases) {
            const sim = setup(2.2);
            idle(sim, 1, inp);
            assert.strictEqual(moveId(sim), id, JSON.stringify(inp));
        }
        let sim = setup(2.2);
        idle(sim, 3, { dirX: -1 });
        idle(sim, 1, { dirX: 1, kick: true });
        assert.strictEqual(moveId(sim), 'WILLOW_KICK', 'back, then forward+K');

        sim = setup(2.2);
        idle(sim, 3, { dirZ: 1 });
        idle(sim, 1, { dirX: 1, kick: true });
        assert.strictEqual(moveId(sim), 'TWISTER_KICK', 'side, then forward+K');
    });

    await t.test('crouch attacks and release-crouch specials', () => {
        let sim = setup(1.2);
        idle(sim, 4, { crouch: true });
        idle(sim, 1, { crouch: true, punch: true });
        assert.strictEqual(moveId(sim), 'CROUCH_PUNCH');

        sim = setup(1.2);
        idle(sim, 4, { crouch: true });
        idle(sim, 1, { crouch: true, kick: true });
        assert.strictEqual(moveId(sim), 'CROUCH_SWEEP');
        assert.ok(MOVES.CROUCH_SWEEP.knockdown && MOVES.CROUCH_SWEEP.lowAttack);

        sim = setup(1.2);
        idle(sim, 6, { crouch: true });
        idle(sim, 2);
        idle(sim, 1, { punch: true });
        assert.strictEqual(moveId(sim), 'RISING_FURY_PUNCH', 'crouch, release, P');

        sim = setup(1.2);
        idle(sim, 6, { crouch: true });
        idle(sim, 2);
        idle(sim, 1, { kick: true });
        assert.strictEqual(moveId(sim), 'DEVIL_SPIN_KICK', 'crouch, release, K');
    });

    await t.test('jump punch, jump flip, running lariat, escape roll', () => {
        let sim = setup(4);
        idle(sim, 1, { jump: true });
        idle(sim, 3);
        idle(sim, 1, { punch: true });
        assert.strictEqual(moveId(sim), 'JUMP_PUNCH');

        sim = setup(4);
        idle(sim, 1, { jump: true });
        idle(sim, 3);
        idle(sim, 1, { crouch: true });
        assert.strictEqual(moveId(sim), 'JUMP_FLIP');
        assert.ok(sim.f1.invincible, 'flip has i-frames');

        sim = setup(1.6);
        sim.f1.transitionTo(FIGHTER_STATE.RUN);
        idle(sim, 1, { dirX: 1, punch: true });
        assert.strictEqual(moveId(sim), 'RUNNING_LARIAT');

        sim = setup(5);
        idle(sim, 2, { dirZ: 1 });
        idle(sim, 1, { dirZ: 1, crouch: true });
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.EVADE, 'crouch while moving = escape roll');
        assert.strictEqual(sim.f1.evadeDir, 'RIGHT');
    });

    await t.test('get-up attack from the floor', () => {
        const sim = setup(1.2);
        sim.f1.transitionTo(FIGHTER_STATE.KNOCKED_DOWN);
        sim.f1.isGrounded = true;
        idle(sim, 18);
        idle(sim, 1, { kick: true });
        assert.strictEqual(moveId(sim), 'GETUP_KICK');
        assert.ok(sim.f1.invincible, 'get-up kick starts invulnerable');
    });

    await t.test('kick throws: front forward+K and Backbreaker from behind; Stepping Disarm', () => {
        let sim = setup(1.0);
        idle(sim, 1, { dirX: 1, kick: true });
        assert.strictEqual(moveId(sim), 'THROW_FRONT_K');
        assert.strictEqual(sim.f2.state, FIGHTER_STATE.BEING_THROWN);

        sim = setup(1.0, true);
        idle(sim, 1, { dirX: 1, kick: true });
        assert.strictEqual(moveId(sim), 'BACKBREAKER');

        sim = setup(1.0);
        sim.f2.equipWeapon({ type: 'TCTF_PISTOL', ammo: 6 });
        idle(sim, 1, { dirX: 1, kick: true });
        assert.ok(sim.f1.currentMove.disarms, 'Stepping Disarm strips the weapon');
        for (let i = 0; i < 40; i++) idle(sim);
        assert.ok(!sim.f2.weapon, 'opponent disarmed');
    });

    await t.test('mouse-look: aimYaw sets facing and W runs where Konoko looks', () => {
        const sim = setup(20);
        const yaw = Math.PI / 2;
        idle(sim, 1, { aimYaw: yaw });
        assert.ok(Math.abs(sim.f1.facingAngle - yaw) < 1e-6);
        // forward in world terms along the aim yaw
        for (let i = 0; i < 30; i++) idle(sim, 1, { aimYaw: yaw, dirX: Math.cos(yaw), dirZ: Math.sin(yaw), down: false });
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.RUN, 'holding forward breaks into a run');
        assert.ok(sim.f1.z > 1.0 && Math.abs(sim.f1.x) < 0.2, 'moved along +Z');
        // strafing keeps the facing (no auto-turn toward the opponent)
        const s2 = setup(2.0);
        for (let i = 0; i < 20; i++) idle(s2, 1, { aimYaw: Math.PI / 2, dirX: 1, dirZ: 0 });
        assert.ok(Math.abs(s2.f1.facingAngle - Math.PI / 2) < 1e-6, 'no auto-face under mouse-look');
    });

    await t.test('campaign unlocks follow the original chapters', async () => {
        const { CampaignManager } = await import('../../client/oni/src/core/CampaignManager.js');
        const sim = new Simulation();
        const cm = new CampaignManager(sim);
        const at = (idx) => cm.getUnlockedMoveList(1, idx);
        assert.ok(!at(1).has('PUNCH_3') && at(2).has('PUNCH_3'), 'Triple-Hit Haymaker in Ch.2');
        assert.ok(!at(5).has('DEVIL_SPIN_KICK') && at(6).has('DEVIL_SPIN_KICK'), 'Devil Spin Kick in Ch.6');
        assert.ok(!at(9).has('TWISTER_KICK') && at(10).has('TWISTER_KICK'), 'Twister Kick in Ch.10');
        assert.ok(at(1).has('THROW_FRONT_K') && at(1).has('BACKBREAKER') && at(1).has('SLIDE_KICK'), 'starting moves');
    });

    await t.test('joystick back-walk regression: down/back never triggers slide kick, keeps auto-guard', () => {
        const sim = setup(3.0);
        // P1 at 0, P2 at 3. P1 facing +X. Pulling stick back (dirX: -1, down: true)
        for (let i = 0; i < 25; i++) {
            idle(sim, 1, { dirX: -1, down: true });
            assert.notStrictEqual(sim.f1.state, FIGHTER_STATE.ATTACK, 'pulling stick back must never trigger an attack');
            assert.strictEqual(sim.f1.currentMove, null, 'pulling stick back must never trigger SLIDE_KICK');
            assert.ok(sim.f1.isBlocking, 'back-walk must maintain active auto-guard');
        }
        assert.ok(sim.f1.x < -0.3, 'back-walk should move backwards away from opponent');
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.WALK, 'back-walk stays in WALK state');

        // Explicit crouch in RUN state DOES trigger slide kick
        const simRun = setup(6.0);
        simRun.f1.transitionTo(FIGHTER_STATE.RUN);
        idle(simRun, 1, { crouch: true });
        assert.strictEqual(simRun.f1.state, FIGHTER_STATE.ATTACK);
        assert.strictEqual(simRun.f1.currentMove.id, 'SLIDE_KICK', 'explicit crouch button triggers slide kick in run');
    });
});
