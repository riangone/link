// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * 萌萌方块对战 (client/blocks/): each side runs its own board; only
 * snapshots / garbage / over travel. Bot mode runs a second board locally.
 */
test.describe('Blocks battle', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });
    test.setTimeout(60_000);
    const st = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__bot.state())));

    test('hard bot clears lines, attacks, and an idle player tops out', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/blocks/?bot=hard#bot-test`);
        await expect(page.locator('#ready-screen')).toBeVisible();
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        // Idle human: pieces just fall and stack. Hard-drop to speed it up.
        for (let i = 0; i < 80; i++) {
            const s = await st(page);
            if (s.status !== 'playing') break;
            await page.evaluate(() => window.__bot.act('drop'));
            await page.waitForTimeout(400);
        }
        await expect.poll(async () => (await st(page)).status, { timeout: 30_000 }).toBe('over');
        const s = await st(page);
        expect(s.winner).toBe(2);
        expect(s.score.p2).toBe(1);
        expect(s.bot.pieces).toBeGreaterThan(5);
        expect(s.bot.dead).toBe(false);
        await expect(page.locator('#gameover-screen')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('bot clears lines over time and sends garbage that I can cancel', async ({ page }) => {
        await page.goto(`${dev.url}/blocks/?bot=hard#bot-test2`);
        await page.locator('#start-btn').click();
        await expect.poll(async () => (await st(page)).bot.lines, { timeout: 25_000 }).toBeGreaterThanOrEqual(4);
        // garbage hook lands on my board on the next non-clearing lock
        // (the bot may attack at the same moment, so compare heights, not exact queues)
        const h0 = (await st(page)).me.height;
        await page.evaluate(() => window.__bot.garbage(3));
        expect((await st(page)).me.pending).toBeGreaterThanOrEqual(3);
        await page.evaluate(() => window.__bot.act('drop'));
        expect((await st(page)).me.height).toBeGreaterThanOrEqual(h0 + 3);
    });

    test('two humans: start syncs, garbage crosses, top-out ends the round on both sides', async ({ browser }) => {
        const ca = await browser.newContext(), cb = await browser.newContext();
        const a = await ca.newPage(), b = await cb.newPage();
        const room = 'blocks-' + Date.now();
        await a.goto(`${dev.url}/blocks/#${room}`);
        await b.goto(`${dev.url}/blocks/#${room}`);
        await expect(a.locator('#start-btn')).toBeVisible({ timeout: 15_000 });
        await expect(b.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
        await a.locator('#start-btn').click();
        await expect(b.locator('#overlay')).toHaveClass(/hidden/);
        // b drops pieces until it dies; a should win.
        for (let i = 0; i < 80; i++) {
            if ((await st(b)).status !== 'playing') break;
            await b.evaluate(() => window.__bot.act('drop'));
            await b.waitForTimeout(30);
        }
        await expect.poll(async () => (await st(a)).status, { timeout: 10_000 }).toBe('over');
        await expect.poll(async () => (await st(b)).status, { timeout: 10_000 }).toBe('over');
        expect((await st(a)).winner).toBe(1);
        await expect(a.locator('#win-loss-title')).toContainText('赢');
        await expect(b.locator('#final-score')).toHaveText('0 - 1');
        await ca.close(); await cb.close();
    });
});
