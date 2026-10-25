// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Kart 3D (client/kart3d/): 追尾/第一视角卡丁车 1v1.
 *  - the hard bot races forward and follows the 3D track spline;
 *  - drifting charges mini-turbo sparks and releases a speed boost;
 *  - homing bubble missile hits the rival and causes a spin-out;
 *  - coins increase top speed, crossing the finish line wins after 3 laps;
 *  - PvP: peer input synchronizes smoothly host-authoritatively.
 */
test.describe('Link Kart 3D', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { dev && await dev.close(); });

    const st = page => page.evaluate(() => window.__kart3d.state);

    async function startBot(page, level, hash) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/kart3d/?bot=${level}&e2e=1#${hash}`);
        await expect(page.locator('#start-btn')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        return errors;
    }

    test('hard bot races forward and follows the track', async ({ page }) => {
        const errors = await startBot(page, 'hard', 'kart3d-bot');
        await expect.poll(async () => (await st(page)).status, { timeout: 6_000 }).toBe('racing');
        const wall = await page.evaluate(() => window.__kart3d.track.wall);
        let maxOff = 0;
        for (let i = 0; i < 14; i++) {
            await page.waitForTimeout(500);
            const s = await st(page);
            const d = await page.evaluate(([x, y]) => {
                let best = Infinity;
                for (let a = 0; a < window.__kart3d.track.len; a += 10) {
                    const p = window.__kart3d.pointAt(a, 0);
                    best = Math.min(best, Math.hypot(p.x - x, p.y - y));
                }
                return best;
            }, [s.p2.x, s.p2.y]);
            maxOff = Math.max(maxOff, d);
        }
        const s = await st(page);
        expect(s.p2.prog).toBeGreaterThan(1500);
        expect(maxOff).toBeLessThan(wall);
        expect(s.p1.prog).toBeLessThan(0); // player was idle on grid
        expect(errors).toEqual([]);
    });

    test('drift charges sparks and releasing gives a mini-turbo boost', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'kart3d-drift');
        await page.evaluate(() => { window.__kart3d.freezeBot(true); window.__kart3d.skipCountdown(); });
        await expect.poll(async () => (await st(page)).status).toBe('racing');
        await page.evaluate(() => window.__kart3d.place(1, 200, -70, 6));
        await page.keyboard.down('w');
        await page.keyboard.down('d');
        await page.keyboard.down('Shift');
        await expect.poll(async () => (await st(page)).p1.drift, { timeout: 2_000 }).not.toBe(0);
        const boost = await page.evaluate(() => new Promise(resolve => {
            const tick = () => {
                const k = window.__kart3d.state.p1;
                if (k.drift && k.charge > 50) {
                    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
                    setTimeout(() => resolve(window.__kart3d.state.p1.boost), 60);
                } else requestAnimationFrame(tick);
            };
            tick();
        }));
        expect(boost).toBeGreaterThan(0);
        await page.keyboard.up('Shift');
        await page.keyboard.up('d');
        await page.keyboard.up('w');
        expect(errors).toEqual([]);
    });

    test('bubble missile homes in and spins rival out', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'kart3d-missile');
        await page.evaluate(() => { window.__kart3d.freezeBot(true); window.__kart3d.skipCountdown(); });
        await expect.poll(async () => (await st(page)).status).toBe('racing');
        await page.evaluate(() => {
            window.__kart3d.place(1, 150, 0, 0);
            window.__kart3d.place(2, 420, 30, 0);
            window.__kart3d.give(1, 'missile');
        });
        await page.keyboard.press('Space');
        await expect.poll(async () => (await st(page)).p1.item).toBe(null);
        await expect.poll(async () => (await st(page)).p2.spin, { timeout: 4_000 }).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });

    test('finishing 3 laps triggers victory and score tally', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'kart3d-finish');
        await page.evaluate(() => { window.__kart3d.freezeBot(true); window.__kart3d.skipCountdown(); });
        await expect.poll(async () => (await st(page)).status).toBe('racing');
        await page.evaluate(() => {
            const t = window.__kart3d.track;
            window.__kart3d.place(1, t.len * t.laps - 60, 0, 6);
        });
        await page.keyboard.down('w');
        await expect.poll(async () => (await st(page)).winner, { timeout: 4_000 }).toBe(1);
        await page.keyboard.up('w');
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#win-loss-title')).toHaveText('VICTORY!');
        await expect(page.locator('#final-score')).toHaveText('1 - 0');
        await page.locator('#restart-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        expect((await st(page)).score).toEqual({ p1: 1, p2: 0 });
        expect(errors).toEqual([]);
    });

    test('pvp: two browsers pair up and client movement syncs to host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/kart3d/#gs-kart3d-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/kart3d/#gs-kart3d-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect.poll(async () => (await st(pageA)).status, { timeout: 6_000 }).toBe('racing');
            await pageA.keyboard.down('w');
            await pageB.keyboard.down('w');
            await pageB.waitForTimeout(1500);
            await pageA.keyboard.up('w');
            await pageB.keyboard.up('w');
            await expect.poll(async () => (await st(pageA)).p2.prog, { timeout: 5_000 }).toBeGreaterThan(100);
            await expect.poll(async () => (await st(pageB)).p1.prog, { timeout: 5_000 }).toBeGreaterThan(100);
            expect(errors).toEqual([]);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
