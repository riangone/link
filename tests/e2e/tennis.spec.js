// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Tennis (client/tennis/): auto-running top-down tennis; you only pick shots.
 *  - rules: first bounce out = point to the receiver; double bounce = point to the hitter; net = hitter loses;
 *  - auto-run: an idle player still returns a reachable ball (soft block);
 *  - PERFECT: an intent armed just before contact (window widened by RTT for the remote side);
 *  - hard bot beats an idle player; bot-vs-bot rallies; real P2P intents reach the host.
 */
test.describe('Tennis', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function startBot(page, level) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/tennis/?bot=${level}#bot-t-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        return errors;
    }

    test('out, double bounce and net decide points correctly', async ({ page }) => {
        const errors = await startBot(page, 'easy');
        const r = await page.evaluate(async () => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true);
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const until = async (f) => { for (let k = 0; k < 200 && !f(); k++) await wait(20); };
            const res = {};
            // 1) seat 0 hits long: first bounce beyond the far baseline → point to seat 1
            await until(() => S.ph === 'serve');
            let sc = S.sc.slice();
            B.setBall(C.CX1 + 10, C.MY, 2, 6, 0, -1, 0, 0);
            await until(() => S.ph === 'point');
            res.out = [S.sc[0] - sc[0], S.sc[1] - sc[1]];
            // 2) seat 1's ball bounces twice on seat 0's side far from seat 0 → point to seat 1
            await until(() => S.ph === 'serve');
            sc = S.sc.slice();
            B.place(0, 40, C.CY0 - 20);
            B.setBall(C.NET_X - 60, C.CY1 - 10, 2, -1, 0, -1, 1, 0);
            await until(() => S.ph === 'point');
            res.dbl = [S.sc[0] - sc[0], S.sc[1] - sc[1]];
            // 3) seat 0's low ball into the net → point to seat 1
            await until(() => S.ph === 'serve');
            sc = S.sc.slice();
            B.setBall(C.NET_X - 80, C.MY, 5, 6, 0, 1, 0, 0);
            await until(() => S.ph === 'point');
            res.net = [S.sc[0] - sc[0], S.sc[1] - sc[1]];
            return res;
        });
        expect(r.out).toEqual([0, 1]);
        expect(r.dbl).toEqual([0, 1]);
        expect(r.net).toEqual([0, 1]);
        expect(errors).toEqual([]);
    });

    test('an idle player auto-runs and still returns a reachable ball', async ({ page }) => {
        await startBot(page, 'easy');
        const r = await page.evaluate(async () => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true);
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            for (let k = 0; k < 200 && S.ph !== 'serve'; k++) await wait(20);
            // seat 1 plays a soft ball into the middle of seat 0's court
            B.setBall(C.NET_X + 40, C.MY, 40, -5, 0.6, 2, 1, 0);
            for (let k = 0; k < 150 && S.last !== 0 && S.ph === 'play'; k++) await wait(20);
            return { last: S.last, ph: S.ph, kind: S.events.filter(e => e.i === 0).map(e => e.k).pop() };
        });
        expect(r.last).toBe(0);
        expect(r.kind).toBe('block');
    });

    test('PERFECT needs an intent armed close to contact (RTT-widened for the remote side)', async ({ page }) => {
        await startBot(page, 'easy');
        const r = await page.evaluate(() => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true);
            S.ph = 'play';
            const shot = (age, lagMs, remote) => {
                B.setRtt(lagMs);
                B.setBall(C.CX1, C.MY, 30, 0, 0, 0, 0, 1);
                B.arm(1, 0.5, 0.8, false, remote);
                S.intent[1].t -= age;
                B.hitBall(1, S.intent[1], false);
                return S.events[S.events.length - 1].pf;
            };
            return { fresh: shot(4, 0, false), stale: shot(C.PERFECT_T + 10, 0, false), lagged: shot(C.PERFECT_T + 10, 250, true) };
        });
        expect(r.fresh).toBe(1);
        expect(r.stale).toBe(0);
        expect(r.lagged).toBe(1);
    });

    test('winning shows VICTORY without errors', async ({ page }) => {
        const errors = await startBot(page, 'easy');
        await page.evaluate(async () => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true);
            S.sc[0] = C.WIN_SCORE - 1;
            B.setBall(C.CX0 - 20, C.MY, 2, -6, 0, -1, 1, 0);      // seat 1 hits it long
        });
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('#win-loss-title')).toHaveText('VICTORY!');
        expect(errors).toEqual([]);
    });

    test('hard bot beats an idle player', async ({ page }) => {
        test.setTimeout(150_000);
        const errors = await startBot(page, 'hard');
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 140_000 });
        await expect(page.locator('#win-loss-title')).toHaveText('DEFEAT');
        expect(errors).toEqual([]);
    });

    test('bot vs bot produces real rallies', async ({ page }) => {
        test.setTimeout(60_000);
        const errors = await startBot(page, 'normal');
        await page.evaluate(() => window.__bot.autoplay('normal'));
        await expect.poll(() => page.evaluate(() => window.__bot.state().shots), { timeout: 45_000, intervals: [1000] }).toBeGreaterThan(14);
        expect(errors).toEqual([]);
    });

    test('two peers: a client swipe arms a shot on the host', async ({ browser }) => {
        const ctxA = await browser.newContext(), ctxB = await browser.newContext();
        const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/tennis/#tennis-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/tennis/#tennis-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await pageB.keyboard.press('ArrowUp');
            await expect.poll(() => pageA.evaluate(() => { const i = window.__bot.state().intent[1]; return i ? i.aim : null; }), { timeout: 5_000 }).toBe(-1);
            expect(errors).toEqual([]);
        } finally { await ctxA.close(); await ctxB.close(); }
    });
});
