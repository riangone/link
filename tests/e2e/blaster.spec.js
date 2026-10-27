// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Blaster (client/blaster/): Q版第一人称泡泡枪.
 *  - Bot mode runs fully locally (no peer) and the AI must actually hunt,
 *    shoot and damage the idle player.
 *  - PvP mode goes through GameSession like the other games, with the
 *    client's view angle (sent in its inputs) applied by the host.
 */
test.describe('Blaster FPS', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    test('bot mode: lobby button starts a match and the bot hunts and hits the player', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(dev.url + '/blaster/#bot-room-1');
        await page.locator('.btn-bot[data-level="hard"]').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);

        const start = await page.evaluate(() => window.__blaster.state);
        expect(start.status).toBe('playing');
        expect(await page.evaluate(() => window.__blaster.mode)).toBe('bot');

        // Player stands still; the hard bot must path-find over and land hits.
        await expect.poll(async () => {
            const s = await page.evaluate(() => window.__blaster.state);
            return s.p1.hp < 100 || s.p1.dead > 0 || s.p2.frags > 0;
        }, { timeout: 25_000 }).toBe(true);

        const s = await page.evaluate(() => window.__blaster.state);
        expect(Math.hypot(s.p2.x - start.p2.x, s.p2.y - start.p2.y)).toBeGreaterThan(1);
        expect(errors).toEqual([]);
    });

    test('pvp: two peers connect, host starts, client turning and shooting reach the host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        try {
            await pageA.goto(dev.url + '/blaster/#gs-blaster-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/blaster/#gs-blaster-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });

            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#start-btn')).toBeHidden();
            await pageA.locator('#start-btn').click();

            await expect(pageA.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });

            const before = await pageA.evaluate(() => window.__blaster.state.p2.a);
            await pageB.waitForTimeout(2600); // countdown
            await pageB.keyboard.down('e');
            await pageB.keyboard.down(' ');
            await pageB.waitForTimeout(700);
            await pageB.keyboard.up('e');
            await pageB.keyboard.up(' ');

            // Host saw the client's new view angle (input carries angle).
            await expect.poll(() => pageA.evaluate(() => window.__blaster.state.p2.a), { timeout: 5_000 })
                .not.toBeCloseTo(before, 1);
            await expect(pageA.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('one-hand touch: a single stick moves, turns and taps to fire', async ({ browser }) => {
        const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        try {
            await page.goto(dev.url + '/blaster/?bot=easy&e2e=1#one-hand-room');
            await expect(page.locator('.touch-controls')).toHaveClass(/one-hand/);
            const zone = page.locator('#stick-zone');
            await expect(zone).toBeVisible();
            // 关掉自动开火，单独验证“轻点开火”
            const auto = page.locator('#ctrl-auto-btn');
            if (/开$/.test((await auto.textContent()) || '')) await auto.tap();
            await expect(auto).toContainText('关');
            await zone.scrollIntoViewIfNeeded();
            await expect.poll(() => page.evaluate(() => window.__blaster.state.status)).toBe('playing');
            await page.waitForTimeout(2600); // 倒计时
            // 把对手冻结在远处（超出锁定距离），避免触发锁定平移，专测“左右 = 转视角”
            await page.evaluate(() => { window.__blaster.freezeBot(true); window.__blaster.place('p2', 14.5, 14.5, 0); });

            const box = await zone.boundingBox();
            const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
            const cdp = await ctx.newCDPSession(page);
            const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }]
            });

            const s0 = await page.evaluate(() => window.__blaster.state.p1);
            // 推上：前进
            await touch('touchStart', cx, cy);
            await touch('touchMove', cx, cy - 25);
            await touch('touchMove', cx, cy - 55);
            await page.waitForTimeout(700);
            const s1 = await page.evaluate(() => window.__blaster.state.p1);
            expect(Math.hypot(s1.x - s0.x, s1.y - s0.y)).toBeGreaterThan(0.6);
            // 推右：转视角
            await touch('touchMove', cx + 55, cy);
            await page.waitForTimeout(500);
            const s2 = await page.evaluate(() => window.__blaster.state.p1);
            const turned = Math.abs(Math.atan2(Math.sin(s2.a - s1.a), Math.cos(s2.a - s1.a)));
            expect(turned).toBeGreaterThan(0.4);
            await touch('touchEnd');

            // 轻点：开火（cd 被置位）
            await page.waitForTimeout(400);
            await touch('touchStart', cx, cy);
            await touch('touchEnd');
            await expect.poll(() => page.evaluate(() => window.__blaster.state.p1.cd), { timeout: 1000, intervals: [16] }).toBeGreaterThan(0);
            expect(errors).toEqual([]);
        } finally {
            await ctx.close();
        }
    });

    test('one-hand lock: stick left/right strafes around a locked foe instead of turning', async ({ browser }) => {
        const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        try {
            await page.goto(dev.url + '/blaster/?bot=easy&e2e=1#lock-room');
            await expect(page.locator('.touch-controls')).toHaveClass(/one-hand/);
            const auto = page.locator('#ctrl-auto-btn');
            if (/开$/.test((await auto.textContent()) || '')) await auto.tap(); // 不让自动开火干扰
            await expect.poll(() => page.evaluate(() => window.__blaster.state.status)).toBe('playing');
            await page.waitForTimeout(2600);
            // 同一行空地：玩家 (2.5,5.5) 面朝 +x，对手 (8.5,5.5) 冻结不动
            await page.evaluate(() => {
                window.__blaster.freezeBot(true);
                window.__blaster.place('p2', 8.5, 5.5, Math.PI);
                window.__blaster.place('p1', 2.5, 5.5, 0);
            });
            await expect.poll(() => page.evaluate(() => window.__blaster.strafeLock)).toBe(true);
            await expect(page.locator('#stick-zone')).toHaveClass(/strafe/);

            const zone = page.locator('#stick-zone');
            await zone.scrollIntoViewIfNeeded();
            const box = await zone.boundingBox();
            const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
            const cdp = await ctx.newCDPSession(page);
            const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }]
            });
            const s0 = await page.evaluate(() => window.__blaster.state.p1);
            await touch('touchStart', cx, cy);
            await touch('touchMove', cx + 25, cy);
            await touch('touchMove', cx + 55, cy);
            // 推得太久会横移进 y≈7 的墙角挡住视线（锁定按设计会解除），只推一小段
            await page.waitForTimeout(280);
            await touch('touchEnd');
            const s1 = await page.evaluate(() => window.__blaster.state.p1);
            // 右平移：面朝 +x 时向 +y 移动，x 基本不变
            expect(s1.y - s0.y).toBeGreaterThan(0.5);
            expect(Math.abs(s1.x - s0.x)).toBeLessThan(0.3);
            // 视角仍跟着对手（误差远小于“转视角”会造成的偏转）
            const bearing = Math.atan2(5.5 - s1.y, 8.5 - s1.x);
            const off = Math.abs(Math.atan2(Math.sin(s1.a - bearing), Math.cos(s1.a - bearing)));
            expect(off).toBeLessThan(0.2);
            expect(await page.evaluate(() => window.__blaster.strafeLock)).toBe(true);
            expect(errors).toEqual([]);
        } finally {
            await ctx.close();
        }
    });

    test('auto-fire: the player shoots by itself when the crosshair sweeps over the bot', async ({ page }) => {
        test.setTimeout(60_000);
        await page.goto(dev.url + '/blaster/#autofire-room');
        await page.locator('.gf-info').click(); // the option lives in the collapsed ⓘ panel
        await page.locator('#autofire-chk').check();
        await page.locator('.gf-info').click();
        await page.locator('.btn-bot[data-level="normal"]').click();
        await page.waitForTimeout(2600);
        await page.keyboard.down('e'); // 只转圈，不按开火
        try {
            await expect.poll(() => page.evaluate(() => {
                const s = window.__blaster.state;
                return s.p1.cd > 0 || s.p2.hp < 100 || s.p1.frags > 0;
            }), { timeout: 45_000, intervals: [16] }).toBe(true);
        } finally {
            await page.keyboard.up('e');
        }
    });
});
