// Regression tests: rooftop chapters spawn on solid ground; campaign minions can't floor or turtle vs Konoko
const test = require('node:test');
const assert = require('node:assert');

globalThis.localStorage ??= { getItem() { return null; }, setItem() {}, removeItem() {} };

test('Oni campaign balance & rooftop spawn regressions', async (t) => {
    const { Simulation } = await import('../../client/oni/src/core/Simulation.js');
    const { CampaignManager, CAMPAIGN_CHAPTERS } = await import('../../client/oni/src/core/CampaignManager.js');
    const { MOVES, FIGHTER_STATE } = await import('../../client/oni/src/core/Constants.js');

    await t.test('all 14 story chapters + tutorial are defined', () => {
        assert.strictEqual(CAMPAIGN_CHAPTERS.length, 15);
    });

    for (const chId of ['ch3', 'ch11', 'ch14']) {
        await t.test(`${chId} rooftop chapter: Konoko does not fall into the abyss at spawn`, () => {
            const sim = new Simulation();
            const camp = new CampaignManager(sim);
            camp.startChapter(chId);
            for (let f = 0; f < 90; f++) { sim.tick({}, {}); camp.updateTick({}, [...sim.events]); }
            assert.ok(sim.f1.hp > 0, 'player alive');
            assert.ok(sim.f1.y > -0.5, `player on floor (y=${sim.f1.y})`);
        });
    }

    await t.test('minion knockdown moves only stagger Konoko; bosses still floor her', () => {
        const kdMove = Object.values(MOVES).find((m) => m && m.knockdown && !m.isThrow && m.damage);
        assert.ok(kdMove, 'found a knockdown move');
        const sim = new Simulation();
        const minion = sim.spawnExtraEnemy({ archetype: 'STRIKER', x: 1, z: 0 });
        sim.f1.takeHit({ move: kdMove, isBlock: false }, minion);
        assert.strictEqual(sim.f1.state, FIGHTER_STATE.HIT_STUN);

        const sim2 = new Simulation();
        const boss = sim2.spawnExtraEnemy({ archetype: 'STRIKER', x: 1, z: 0, isBoss: true });
        sim2.f1.takeHit({ move: kdMove, isBlock: false }, boss);
        assert.strictEqual(sim2.f1.state, FIGHTER_STATE.KNOCKED_DOWN);
    });

    await t.test('minions walking backwards do not get a free auto-guard', () => {
        const sim = new Simulation();
        const m = sim.spawnExtraEnemy({ archetype: 'STRIKER', x: 2, z: 0, facing: -1 });
        m.handleIdle({ dirX: 1, dirZ: 0 }, sim.f1, []);
        assert.strictEqual(m.isBlocking, false);
        sim.f2.isMinion = false;
        sim.f2.facing = -1; sim.f2.facingAngle = Math.PI;
        sim.f2.handleIdle({ dirX: 1, dirZ: 0 }, sim.f1, []);
        assert.strictEqual(sim.f2.isBlocking, true, 'non-minions keep Oni back-guard');
    });
});
