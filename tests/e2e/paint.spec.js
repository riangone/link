// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Paint (client/paint/): 滚筒涂地 — tag/blaster 的第一人称迷宫，改成抢地盘。
 *  - walking paints the floor in your colour, over the rival's colour too;
 *  - the bot actually covers ground;
 *  - a dash into the rival stuns them and splashes paint;
 *  - the timer ends the round, more cells wins;
 *  - PvP: the client receives the paint grid (full snapshot + deltas).
 */
test.describe('Roller Paint', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    const st = page => page.evaluate(() => window.__paint.state);

    async function startBot(page, level, hash) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/paint/?bot=${level}&e2e=1#${hash}`);
        await expect.poll(async () => (await st(page)).status).toBe('playing');
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        await expect.poll(async () => (await st(page)).countdown, { timeout: 6_000 }).toBe(0);
        return errors;
    }

    test('walking paints the floor; the hard bot covers ground', async ({ page }) => {
        const errors = await startBot(page, 'hard', 'paint-walk');
        await page.evaluate(() => window.__paint.place('p1', 2.5, 5.5, 0));
        await page.keyboard.down('w');
        await page.waitForTimeout(1200);
        await page.keyboard.up('w');
        const s = await st(page);
        expect(s.p1.cells).toBeGreaterThan(8);
        expect(await page.evaluate(() => window.__paint.cellAt(3.5, 5.5))).toBe(1);
        await expect.poll(async () => (await st(page)).p2.cells, { timeout: 10_000 }).toBeGreaterThan(40);
        const s2 = await st(page);
        expect(s2.painted).toBe(s2.p1.cells + s2.p2.cells);   // counters stay consistent with the grid
        expect(errors).toEqual([]);
    });

    test('dash into the rival stuns them and splashes paint; timer decides the winner', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'paint-bump');
        await page.evaluate(() => {
            window.__paint.freezeBot(true);
            window.__paint.place('p2', 9.5, 5.5, 0);
            window.__paint.place('p1', 7.6, 5.5, 0);
        });
        await page.keyboard.down('Space');
        await page.waitForTimeout(150);
        await page.keyboard.up('Space');
        await expect.poll(async () => (await st(page)).p2.frz, { timeout: 6_000, intervals: [16] }).toBeGreaterThan(0);
        const s = await st(page);
        expect(s.p1.bumps).toBe(1);
        expect(await page.evaluate(() => window.__paint.cellAt(10.4, 5.5))).toBe(1);   // splash beyond the rival
        await page.evaluate(() => window.__paint.setTimer(0.5));
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 4_000 });
        const end = await st(page);
        expect(end.winner).toBe(end.p1.cells > end.p2.cells ? 1 : (end.p1.cells < end.p2.cells ? 2 : 3));
        await expect(page.locator('#final-score')).toContainText('%');
        expect(errors).toEqual([]);
    });

    test('pvp: client sees the host\'s paint and its own strokes reach the host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        try {
            await pageA.goto(dev.url + '/paint/#gs-paint-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/paint/#gs-paint-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await pageB.waitForTimeout(2600);
            // spawns face a corner: strafe so both slide along the outer wall
            await pageA.keyboard.down('d');
            await pageB.keyboard.down('a');
            await pageB.waitForTimeout(1500);
            await pageA.keyboard.up('d');
            await pageB.keyboard.up('a');
            await expect.poll(async () => (await st(pageA)).p2.cells, { timeout: 5_000 }).toBeGreaterThan(4);
            await expect.poll(async () => {
                const s = await st(pageB);
                return s.p1.cells > 4 && s.painted >= s.p1.cells;
            }, { timeout: 5_000 }).toBe(true);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
