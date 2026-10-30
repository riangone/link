// Locomotion sanity: planted feet never skate, and attack strikes keep their aim keys.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = () => import(pathToFileURL(path.join(__dirname, '../../client/oni/src/render/AnimationLibrary.js')).href);

test('oni gait: stance distance equals body travel (zero foot skating)', async () => {
    const { GAIT } = await lib();
    for (const [name, g] of Object.entries(GAIT)) {
        const planted = g.strike - g.toeOff;
        assert.ok(Math.abs(planted - g.stance * g.cycle) < 0.01, `${name}: stance ${planted} vs ${g.stance * g.cycle}`);
        assert.ok(Math.abs(g.perMeter - 2 * Math.PI / g.cycle) < 1e-9, `${name}: perMeter matches cycle`);
        // swing curve starts where stance ends and lands where stance begins
        assert.ok(Math.abs(g.swingZ(0) - g.toeOff) < 1e-6 && Math.abs(g.swingZ(1) - g.strike) < 1e-6, `${name}: swing endpoints`);
        assert.ok(g.swingY(0.5) > 0.03, `${name}: swing foot clears the floor`);
    }
});

test('oni gait: walk keeps a natural cadence, run has a flight phase', async () => {
    const { GAIT } = await lib();
    const { MOVE_SPEED } = await import(pathToFileURL(path.join(__dirname, '../../client/oni/src/core/Constants.js')).href);
    const walkSteps = 2 * MOVE_SPEED.WALK_FORWARD / GAIT.WALK.cycle;
    const runSteps = 2 * MOVE_SPEED.RUN / GAIT.RUN.cycle;
    assert.ok(walkSteps >= 2.2 && walkSteps <= 3.6, `walk ${walkSteps.toFixed(2)} steps/s`);
    assert.ok(runSteps >= 3.0 && runSteps <= 4.6, `run ${runSteps.toFixed(2)} steps/s`);
    assert.ok(GAIT.WALK.stance > 0.5, 'walk has double support');
    assert.ok(GAIT.RUN.stance < 0.5, 'run has a flight phase');
});

test('oni attacks: straight punches use centre-line aim IK on their hit frames', async () => {
    const { ATTACK_ANIMS } = await lib();
    for (const id of ['PUNCH_1', 'PUNCH_2', 'DASH_PUNCH']) {
        const hit = ATTACK_ANIMS[id].keys.find(k => k.at === 'hit').pose;
        assert.ok((hit.lAW || 0) + (hit.rAW || 0) >= 1, `${id} aims its fist`);
        assert.ok(Math.abs((hit.hipT || 0) + (hit.spY || 0)) < 1.0, `${id} torso twist stays human`);
    }
});
