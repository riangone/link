// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Spin (client/spin/): Beyblade-style 1v1.
 *  - bot mode: hard bot beats an idle player (rounds actually finish, points
 *    are awarded, the match ends in a game-over screen) with no page errors;
 *  - real P2P: the client's bey pick reaches the host and the client's
 *    launch press (an increasing counter on an unreliable channel) locks its
 *    launch power on the host.
 */
test.describe('Spin', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    test('hard bot wins a full match against an idle player', async ({ page }) => {
        test.setTimeout(120_000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/spin/?bot=hard#bot-spin-test`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('.pick[data-type="stamina"]').click();
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);

        const st = () => page.evaluate(() => {
            const s = window.__bot.state();
            return { ph: s.ph, sc: s.sc, tp: s.tp, rd: s.rd };
        });
        expect((await st()).tp[0]).toBe('stamina');
        await expect.poll(async () => (await st()).ph, { timeout: 8_000 }).toBe('battle');
        await expect.poll(async () => (await st()).sc[1], { timeout: 100_000, intervals: [1000] }).toBeGreaterThanOrEqual(4);
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#win-loss-title')).toHaveText('DEFEAT');
        expect(errors).toEqual([]);
    });

    test('two peers: pick and launch press travel client → host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/spin/#spin-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/spin/#spin-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });

            await pageB.locator('.pick[data-type="defense"]').click();
            await expect(pageA.locator('#opp-pick')).toContainText('FORTRESS', { timeout: 5_000 });

            await pageA.locator('#start-btn').click();
            await expect(pageA.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });

            const hostState = () => pageA.evaluate(() => {
                const s = window.__bot.state();
                return { ph: s.ph, lk: s.lk, tp: s.tp };
            });
            expect((await hostState()).tp[1]).toBe('defense');
            await pageB.waitForTimeout(700);
            await pageB.keyboard.press('Space');
            await expect.poll(async () => (await hostState()).lk[1], { timeout: 3_000 }).toBeGreaterThanOrEqual(0);
            await expect.poll(async () => (await hostState()).ph, { timeout: 6_000 }).toBe('battle');
            expect(errors).toEqual([]);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
