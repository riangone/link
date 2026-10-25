// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * 水弹大作战 (client/bombs/): host-authoritative Bomberman-like.
 * `?e2e` exposes __bot.grid/place/set so the map can be fixed for tests.
 */
test.describe('Water bombs', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });
    test.setTimeout(60_000);
    const st = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__bot.state())));
    // 11×13, pillars on odd/odd, no boxes
    const OPEN = Array.from({ length: 13 }, (_, y) => Array.from({ length: 11 }, (_, x) => (x % 2 && y % 2) ? '#' : '.').join(''));

    test('hard bot breaks boxes and survives its own balloons', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/bombs/?bot=hard#bot-t1`);
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        const boxes0 = (await st(page)).boxes;
        await page.waitForTimeout(12_000);
        const s = await st(page);
        expect(s.boxes).toBeLessThan(boxes0 - 3);
        expect(s.players[1].state).toBe('ok');
        expect(errors).toEqual([]);
    });

    test('hard bot traps an idle player and pops the bubble', async ({ page }) => {
        await page.goto(`${dev.url}/bombs/?bot=hard&e2e#bot-t2`);
        await page.locator('#start-btn').click();
        await page.evaluate(rows => window.__bot.grid(rows), OPEN);
        await expect.poll(async () => (await st(page)).status, { timeout: 40_000 }).toBe('over');
        const s = await st(page);
        expect(s.winner).toBe(2);
        expect(s.players[0].state).toBe('dead');
        await expect(page.locator('#gameover-screen')).toBeVisible();
    });

    test('a balloon traps you and the needle frees you', async ({ page }) => {
        await page.goto(`${dev.url}/bombs/?bot=easy&e2e#bot-t3`);
        await page.locator('#start-btn').click();
        await page.evaluate(rows => window.__bot.grid(rows), OPEN);
        await page.evaluate(() => { window.__bot.place(1, 10, 12); window.__bot.set(1, 'speed', 0); window.__bot.set(0, 'needle', 1); });
        await page.keyboard.press('Space');                // balloon under my feet, stay put
        await expect.poll(async () => (await st(page)).players[0].state, { timeout: 5_000 }).toBe('trapped');
        await page.keyboard.press('Space');                // use the needle
        await expect.poll(async () => (await st(page)).players[0].state).toBe('ok');
        expect((await st(page)).players[0].needle).toBe(0);
    });

    test('two humans: client moves and drops a balloon on the host simulation', async ({ browser }) => {
        const ca = await browser.newContext(), cb = await browser.newContext();
        const a = await ca.newPage(), b = await cb.newPage();
        const room = 'bombs-' + Date.now();
        await a.goto(`${dev.url}/bombs/?e2e#${room}`);
        await b.goto(`${dev.url}/bombs/?e2e#${room}`);
        await expect(a.locator('#start-btn')).toBeVisible({ timeout: 15_000 });
        await a.locator('#start-btn').click();
        await expect(b.locator('#overlay')).toHaveClass(/hidden/);
        await a.evaluate(rows => window.__bot.grid(rows), OPEN);
        await b.keyboard.down('ArrowLeft');
        await b.waitForTimeout(500);
        await b.keyboard.up('ArrowLeft');
        await expect.poll(async () => (await st(a)).players[1].x, { timeout: 5_000 }).toBeLessThan(9.5);
        // client view follows the host snapshot
        await expect.poll(async () => (await st(b)).players[1].x).toBeLessThan(9.5);
        await b.keyboard.press('Space');
        await expect.poll(async () => (await st(a)).bombs, { timeout: 5_000 }).toBe(1);
        await ca.close(); await cb.close();
    });
});
