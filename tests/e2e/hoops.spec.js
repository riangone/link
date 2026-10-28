// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Hoops (client/hoops/): side-view 1v1 basketball.
 *  - a ball dropping through the rim scores for the hoop's attacker; 3 beyond the arc;
 *  - a shot flies over a grounded defender, a jumping one blocks it; a loose ball is picked up (with HitWindow for the remote side);
 *  - winning shows VICTORY (confetti path) without errors; hard bot beats an idle player;
 *  - real P2P: client movement and its shot reach the host.
 */
test.describe('Hoops', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function startBot(page, level) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/hoops/?bot=${level}#bot-h-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        return errors;
    }

    test('baskets: 2 inside the arc, 3 beyond it, and the hoop decides who scores', async ({ page }) => {
        const errors = await startBot(page, 'easy');
        const r = await page.evaluate(async () => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true); B.skipCheck();
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            await wait(100);
            B.place(0, 300); B.place(1, 300);
            // seat 0 jump shot from close range, then a 3 from deep
            const shoot = async (x) => {
                B.place(0, x, C.MY - 60);
                B.give(0);
                S.p[0].vy = 0;
                let made = false;
                for (let k = 0; k < 40 && !made; k++) {           // retry until it drops (accuracy is random but high)
                    const sc = S.sc[0];
                    S.ph = 'play'; S.hold = 0; B.place(0, x, C.MY - 60);
                    B.release(0, S.p[0]);
                    for (let t = 0; t < 120 && S.ph === 'play' && S.hold < 0; t++) await wait(16);
                    if (S.sc[0] > sc) { made = S.sc[0] - sc; break; }
                }
                await wait(1600);
                return made;
            };
            const two = await shoot(C.RIM_X[0] - 160);
            B.skipCheck(); await wait(100);
            const three = await shoot(C.RIM_X[0] - C.THREE - 40);
            return { two, three, sc1: S.sc[1] };
        });
        expect(r.two).toBe(2);
        expect(r.three).toBe(3);
        expect(r.sc1).toBe(0);
        expect(errors).toEqual([]);
    });

    test('a shot flies over a grounded defender, a jumping one blocks it; a loose ball is grabbed (late remote touch too)', async ({ page }) => {
        await startBot(page, 'easy');
        const r = await page.evaluate(() => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true);
            S.ph = 'play';
            // a seat-0 shot rising over seat 1: grounded seat 1 can't reach it,
            // a jumping seat 1 blocks it
            B.place(1, 500, C.MY);
            B.setBall(510, C.MY, 50, 3, 0, 4); S.shooter = 0; S.pick[1] = 0;
            B.touchFree(1, false);
            const overHead = S.hold === -1 && S.blocks === 0 && S.shooter === 0;
            B.place(1, 500, C.MY, 20);
            B.touchFree(1, false);
            const blocked = S.blocks === 1 && S.hold === -1;
            // a loose ball that passed seat 1 a few frames ago (remote, 120 ms RTT)
            B.place(1, 300);
            B.setBall(300 + C.PR + C.BR + 30, C.MY, 0, 0, 0, 0); S.shooter = -1; S.pick[1] = 0;
            const hist = B.hist(); hist.length = 0;
            for (let k = 0; k < 8; k++) hist.push({ x: 300 + 5, y: C.MY, z: 0 });
            hist.push({ x: S.b.x, y: C.MY, z: 0 });
            B.setRtt(0); B.touchFree(1, true); const noLag = S.hold;
            B.setRtt(120); B.touchFree(1, true); const lag = S.hold;
            return { overHead, blocked, noLag, lag };
        });
        expect(r.overHead).toBe(true);
        expect(r.blocked).toBe(true);
        expect(r.noLag).toBe(-1);
        expect(r.lag).toBe(1);
    });

    test('winning shows VICTORY without errors', async ({ page }) => {
        const errors = await startBot(page, 'easy');
        await page.evaluate(() => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true); B.skipCheck();
            S.sc[0] = C.WIN_SCORE - 2;
            B.setBall(C.RIM_X[0], C.RIM_Y, C.RIM_Z + 30, 0, 0, -1); S.shooter = 0; S.shotPts = 2;
        });
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 8_000 });
        await expect(page.locator('#win-loss-title')).toHaveText('VICTORY!');
        expect(errors).toEqual([]);
    });

    test('hard bot beats an idle player', async ({ page }) => {
        test.setTimeout(120_000);
        const errors = await startBot(page, 'hard');
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 110_000 });
        await expect(page.locator('#win-loss-title')).toHaveText('DEFEAT');
        expect(errors).toEqual([]);
    });

    test('two peers: client movement and shot reach the host', async ({ browser }) => {
        const ctxA = await browser.newContext(), ctxB = await browser.newContext();
        const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/hoops/#hoops-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/hoops/#hoops-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await pageA.evaluate(() => { window.__bot.skipCheck(); });
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().ph)).toBe('play');
            const x0 = await pageA.evaluate(() => window.__bot.state().p[1].x);
            await pageB.keyboard.down('ArrowRight');       // mirrored: toward the client's hoop (canonical −x)
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().p[1].x), { timeout: 5_000 }).toBeLessThan(x0 - 60);
            await pageB.keyboard.up('ArrowRight');
            await pageA.evaluate(() => window.__bot.give(1));
            const shots0 = await pageA.evaluate(() => window.__bot.state().shots);
            await pageB.keyboard.press(' ');
            await pageB.waitForTimeout(200);
            await pageB.keyboard.press(' ');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().shots), { timeout: 5_000 }).toBeGreaterThan(shots0);
            expect(errors).toEqual([]);
        } finally { await ctxA.close(); await ctxB.close(); }
    });
});
