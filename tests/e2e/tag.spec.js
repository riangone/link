// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Tag (client/tag/): 泡泡鬼抓人 — blaster 的第一人称迷宫，改成鬼抓人。
 *  - bot as "it" must hunt down and tag an idle player;
 *  - bot as runner must flee (keep its distance) from a chaser;
 *  - a tag swaps roles, freezes the new "it", and the timer decides the winner;
 *  - PvP goes through GameSession; the client's input reaches the host.
 */
test.describe('Bubble Tag', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    const st = page => page.evaluate(() => window.__tag.state);

    async function startBot(page, level, hash) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/tag/?bot=${level}&e2e=1#${hash}`);
        await expect.poll(async () => (await st(page)).status).toBe('playing');
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        await page.waitForTimeout(2600); // countdown
        return errors;
    }

    test('bot as "it" hunts down and tags an idle player, roles swap', async ({ page }) => {
        const errors = await startBot(page, 'hard', 'tag-bot-it');
        await page.evaluate(() => window.__tag.setIt(2));
        await expect.poll(async () => (await st(page)).it, { timeout: 25_000 }).toBe(1);
        const s = await st(page);
        expect(s.p1.frz).toBeGreaterThan(0);   // new "it" is frozen for a moment
        expect(s.p2.tags).toBe(1);
        expect(s.p2.itT).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });

    test('bot as runner flees from a chaser', async ({ page }) => {
        const errors = await startBot(page, 'hard', 'tag-bot-run');
        // Player is "it", standing still in the middle; bot starts 2 cells away.
        await page.evaluate(() => {
            window.__tag.setIt(1);
            window.__tag.place('p1', 7.5, 5.5, 0);
            window.__tag.place('p2', 9.5, 5.5, 0);
        });
        await expect.poll(async () => {
            const s = await st(page);
            return s.it === 1 && Math.hypot(s.p1.x - s.p2.x, s.p1.y - s.p2.y) > 3.5;
        }, { timeout: 6_000 }).toBe(true);
        await page.waitForTimeout(1500);
        const s = await st(page);
        expect(s.it).toBe(1);   // the still player never got close enough to tag it
        expect(Math.hypot(s.p1.x - s.p2.x, s.p1.y - s.p2.y)).toBeGreaterThan(3);
        expect(errors).toEqual([]);
    });

    test('touching the runner tags it; the timer ends the round and fewer "it" seconds wins', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'tag-rules');
        await page.evaluate(() => {
            window.__tag.freezeBot(true);
            window.__tag.setIt(1);
            window.__tag.place('p2', 9.5, 5.5, 0);
            window.__tag.place('p1', 7.5, 5.5, 0);
        });
        await page.keyboard.down('w');
        // (headless rendering slows the 60Hz sim down, so allow generous wall time)
        await expect.poll(async () => (await st(page)).it, { timeout: 8_000 }).toBe(2);
        await page.keyboard.up('w');
        expect((await st(page)).p2.frz).toBeGreaterThan(0);
        // p1 has been "it" for a while, p2 just now → p2 is "it" for the rest; end the round soon.
        await page.evaluate(() => window.__tag.setTimer(1.2));
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 4_000 });
        const s = await st(page);
        expect(s.status).toBe('gameover');
        expect(s.winner).toBe(s.p1.itT < s.p2.itT ? 1 : 2);
        await expect(page.locator('#final-score')).toContainText('当鬼时间');
        expect(errors).toEqual([]);
    });

    test('one-hand touch: tap dashes, stick moves', async ({ browser }) => {
        const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        try {
            const errors = await startBot(page, 'easy', 'tag-touch');
            await expect(page.locator('.touch-controls')).toHaveClass(/one-hand/);
            await page.evaluate(() => { window.__tag.freezeBot(true); window.__tag.setIt(2); window.__tag.place('p2', 14.5, 14.5, 0); });
            const zone = page.locator('#stick-zone');
            await zone.scrollIntoViewIfNeeded();
            const box = await zone.boundingBox();
            if (!box) throw new Error('no stick');
            const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
            const cdp = await ctx.newCDPSession(page);
            const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }]
            });
            const s0 = (await st(page)).p1;
            await touch('touchStart', cx, cy);
            await touch('touchMove', cx, cy - 55);
            await page.waitForTimeout(600);
            await touch('touchEnd');
            const s1 = (await st(page)).p1;
            expect(Math.hypot(s1.x - s0.x, s1.y - s0.y)).toBeGreaterThan(0.6);
            await touch('touchStart', cx, cy);
            await touch('touchEnd');
            await expect.poll(async () => (await st(page)).p1.cd, { timeout: 1000, intervals: [16] }).toBeGreaterThan(0);
            expect(errors).toEqual([]);
        } finally {
            await ctx.close();
        }
    });

    test('pvp: two peers connect, host starts, client input reaches the host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        try {
            await pageA.goto(dev.url + '/tag/#gs-tag-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/tag/#gs-tag-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await pageB.waitForTimeout(2600);
            const before = (await st(pageA)).p2;
            await pageB.keyboard.down('e');
            await pageB.keyboard.press('Space');
            await pageB.waitForTimeout(600);
            await pageB.keyboard.up('e');
            await expect.poll(async () => (await st(pageA)).p2.a, { timeout: 5_000 }).not.toBeCloseTo(before.a, 1);
            // client sees the synced timer counting down
            await expect.poll(async () => (await st(pageB)).timer, { timeout: 5_000 }).toBeLessThan(89);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
