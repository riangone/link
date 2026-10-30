// Campaign chapter maps: one distinct, completable layout per chapter; physics and visuals share data.
const test = require('node:test');
const assert = require('node:assert');

test('oni chapter maps', async (t) => {
    const { LEVEL_LAYOUTS, buildLevel, pathZ, SECTOR_GATES } = await import('../../client/oni/src/core/LevelLayouts.js');
    const { CAMPAIGN_CHAPTERS, CampaignManager } = await import('../../client/oni/src/core/CampaignManager.js');
    const { Simulation } = await import('../../client/oni/src/core/Simulation.js');
    const { CollisionSystem } = await import('../../client/oni/src/core/CollisionSystem.js');

    const chapters = CAMPAIGN_CHAPTERS.filter((c) => Array.isArray(c.zones));
    const levels = chapters.map((c) => buildLevel(c.id, c.zones));

    const inside = (o, x, z, pad = 0) => x > o.minX - pad && x < o.maxX + pad && z > o.minZ - pad && z < o.maxZ + pad;

    await t.test('chapters 1-14 each have their own layout and theme', () => {
        assert.strictEqual(chapters.length, 14);
        for (const c of chapters) assert.ok(LEVEL_LAYOUTS[c.id], `layout for ${c.id}`);
        const themes = new Set(levels.map((l) => l.theme));
        assert.ok(themes.size >= 13, `distinct themes, got ${themes.size}`);
        const sigs = new Set(levels.map((l) => l.obstacles.map((o) => `${o.minX.toFixed(1)},${o.minZ.toFixed(1)}`).join(';')));
        assert.strictEqual(sigs.size, 14, 'no two chapters share obstacle geometry');
        const paths = new Set(levels.map((l) => JSON.stringify(l.path)));
        assert.strictEqual(paths.size, 14, 'each chapter routes differently');
        for (const l of levels) assert.ok(l.obstacles.length >= 12, `${l.chapterId} has real set dressing (${l.obstacles.length})`);
    });

    await t.test('chapter order and locations follow the original game', () => {
        const expect = ['仓库', '武藏', '生物研究所', '机场', '机库', 'TCTF 总部', '大气转换中心', '大气转换中心', '州政府', '天台', '长谷川', '监狱', 'TCTF 总部', '山地要塞'];
        chapters.forEach((c, i) => assert.ok(c.name.includes(expect[i]), `${c.id} ${c.name} should be ${expect[i]}`));
    });

    await t.test('every spawn, prop and console is clear of obstacles; path crosses gate openings', () => {
        for (let i = 0; i < chapters.length; i++) {
            const c = chapters[i], l = levels[i];
            const pts = [];
            for (const z of c.zones) {
                for (const o of [z.enemy, ...(z.extraEnemies || []), ...(z.reinforcements || []), ...(z.props || []), z.consolePos, z.alarmConsolePos]) {
                    if (o) pts.push([o.x, o.z || 0]);
                }
                if (z.playerStartX !== undefined) pts.push([z.playerStartX, pathZ(l.path, z.playerStartX)]);
            }
            for (const [x, z] of pts) {
                assert.ok(Math.abs(z) < l.halfWidth, `${c.id} point (${x},${z}) inside bounds`);
                for (const o of l.obstacles) {
                    if (o.minY >= 2) continue;
                    assert.ok(!inside(o, x, z, 0.45), `${c.id} point (${x},${z}) blocked by ${o.id}`);
                }
            }
            for (const gx of SECTOR_GATES) assert.ok(Math.abs(pathZ(l.path, gx)) < 2.6, `${c.id} path crosses gate ${gx} inside the opening`);
        }
    });

    await t.test('the critical path is walkable end to end (grid flood fill)', () => {
        for (const l of levels) {
            const step = 0.25, r = 0.45;
            const nx = Math.round((l.bounds.maxX - l.bounds.minX) / step), nz = Math.round((l.bounds.maxZ - l.bounds.minZ) / step);
            const solid = (ix, iz) => {
                const x = l.bounds.minX + ix * step, z = l.bounds.minZ + iz * step;
                if (Math.abs(z) > l.halfWidth - r) return true;
                return l.obstacles.some((o) => !(o.minY >= 2) && inside(o, x, z, r));
            };
            const key = (ix, iz) => ix * (nz + 1) + iz;
            const startX = -22, sx = Math.round((startX - l.bounds.minX) / step), sz = Math.round((pathZ(l.path, startX) - l.bounds.minZ) / step);
            const seen = new Set([key(sx, sz)]);
            const q = [[sx, sz]];
            while (q.length) {
                const [ix, iz] = q.pop();
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const jx = ix + dx, jz = iz + dz;
                    if (jx < 0 || jz < 0 || jx > nx || jz > nz) continue;
                    const k = key(jx, jz);
                    if (seen.has(k) || solid(jx, jz)) continue;
                    seen.add(k);
                    q.push([jx, jz]);
                }
            }
            const ex = Math.round((30 - l.bounds.minX) / step), ez = Math.round((pathZ(l.path, 30) - l.bounds.minZ) / step);
            assert.ok(seen.has(key(ex, ez)), `${l.chapterId}: boss arena reachable from the start`);
        }
    });

    await t.test('starting a chapter loads its map into physics and bounds', () => {
        const sim = new Simulation();
        const cm = new CampaignManager(sim);
        cm.startChapter('ch5');
        assert.strictEqual(cm.activeLevel.theme, 'HANGAR');
        assert.strictEqual(CollisionSystem.getActiveBounds().maxZ, LEVEL_LAYOUTS.ch5.halfWidth);
        const ids = new Set(CollisionSystem.obstacles.map((o) => o.id));
        for (const o of cm.activeLevel.obstacles) assert.ok(ids.has(o.id), `physics has ${o.id}`);
        cm.startChapter('ch10');
        assert.strictEqual(cm.activeLevel.theme, 'ROOFTOP');
        assert.ok(!CollisionSystem.obstacles.some((o) => o.id.startsWith('ch5_')), 'previous map cleared');
        cm.disableCampaign();
    });
});
