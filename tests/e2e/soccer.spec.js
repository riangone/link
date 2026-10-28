// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Soccer (client/soccer/): top-down 1v1 with a 3D ball and auto keepers.
 *  - ball over the goal line (under the bar, inside the posts) scores; over the bar does not;
 *  - HitWindow: a remote kick counts if the ball was in reach ~RTT ago;
 *  - hard bot beats an idle player; no page errors;
 *  - real P2P: client movement and kicks reach the host.
 */
test.describe('Soccer', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function startBot(page, level) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/soccer/?bot=${level}#bot-s-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        return errors;
    }

    test('goal line: under the bar scores, over the bar does not', async ({ page }) => {
        const errors = await startBot(page, 'easy');
        const r = await page.evaluate(async () => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true);
            B.place(0, 300, C.FY0 + 30); B.place(1, 500, C.FY1 - 30);
            // keeper out of the way, low shot into the right goal
            S.kp[1].y = C.GY0 + 8;
            B.setBall(C.FX1 - 60, C.GY1 - 20, 9, 0, 0, 0);
            await new Promise(r => setTimeout(r, 400));
            const low = S.sc.slice();
            // a fresh kick-off; skip it and sky one over the bar into the left goal
            await new Promise(r => setTimeout(r, 2200));
            B.skipKickoff();
            await new Promise(r => setTimeout(r, 100));
            S.kp[0].y = C.GY0 + 8;
            B.setBall(C.FX0 + 60, C.GY1 - 20, -9, 0, C.GZ + 30, 0.3);
            await new Promise(r => setTimeout(r, 400));
            return { low, high: S.sc.slice(), ph: S.ph };
        });
        expect(r.low).toEqual([1, 0]);
        expect(r.high).toEqual([1, 0]);
        expect(errors).toEqual([]);
    });

    test('HitWindow: a late remote kick still counts', async ({ page }) => {
        await startBot(page, 'easy');
        const r = await page.evaluate(() => {
            const B = window.__bot, S = B.state(), C = B.C;
            B.freezeBot(true);
            B.skipKickoff();
            S.ph = 'play';
            B.place(1, 500, 200);
            // the ball rolled past the player a few frames ago and is now just out of reach
            S.b.x = 500 - C.REACH - 20; S.b.y = 200; S.b.z = 0; S.b.vx = 0; S.b.vy = 0;
            const hist = B.hist(); hist.length = 0;
            for (let k = 0; k < 8; k++) hist.push({ x: 500 - 10, y: 200, z: 0 });
            hist.push({ x: S.b.x, y: 200, z: 0 });
            B.setRtt(0); B.armKick(1, 0.8, true); const no = S.kicks; S.arm[1] = null;
            B.setRtt(120); B.armKick(1, 0.8, true); const yes = S.kicks;
            return { no, yes, vx: S.b.vx };
        });
        expect(r.no).toBe(0);
        expect(r.yes).toBe(1);
        expect(r.vx).toBeLessThan(0);      // seat 1 shoots toward the left goal
    });

    test('winning shows VICTORY without errors', async ({ page }) => {
        const errors = await startBot(page, 'easy');
        await page.evaluate(() => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true); B.skipKickoff();
            S.sc[0] = C.WIN_GOALS - 1;
            B.place(0, 300, C.FY0 + 30); B.place(1, 300, C.FY1 - 30);
            S.kp[1].y = C.GY0 + 8;
            B.setBall(C.FX1 - 40, C.GY1 - 20, 9, 0, 0, 0);
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

    test('two peers: client movement and kicks reach the host', async ({ browser }) => {
        const ctxA = await browser.newContext(), ctxB = await browser.newContext();
        const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/soccer/#soccer-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/soccer/#soccer-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await pageA.evaluate(() => window.__bot.skipKickoff());
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().ph)).toBe('play');
            const x0 = await pageA.evaluate(() => window.__bot.state().p[1].x);
            // mirrored: → on the client's screen runs toward the left goal (canonical −x)
            await pageB.keyboard.down('ArrowRight');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().p[1].x), { timeout: 5_000 }).toBeLessThan(x0 - 60);
            await pageB.keyboard.up('ArrowRight');
            await pageB.waitForTimeout(500);       // let the player stop before placing the ball
            // put the ball at the client's feet and shoot
            await pageA.evaluate(() => { const S = window.__bot.state(); S.b.x = S.p[1].x - 30; S.b.y = S.p[1].y; S.b.vx = S.b.vy = 0; });
            await pageB.keyboard.down(' ');
            await pageB.waitForTimeout(300);
            await pageB.keyboard.up(' ');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().kicks), { timeout: 5_000 }).toBeGreaterThan(0);
            expect(errors).toEqual([]);
        } finally { await ctxA.close(); await ctxB.close(); }
    });
});
