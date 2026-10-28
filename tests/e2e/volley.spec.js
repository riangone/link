// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Mech Volley (client/volley/): side-view 1v1 volleyball.
 *  - a ball landing on a side scores for the other side;
 *  - lag compensation: a ball that passed the client's player ~RTT ago still counts;
 *  - hard bot beats an idle player; bot-vs-bot rallies happen; no page errors;
 *  - real P2P: client input moves the host's copy of the client's player.
 */
test.describe('Volley', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function startBot(page, level) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/volley/?bot=${level}#bot-v-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        return errors;
    }

    test('ball landing on a side scores for the other side', async ({ page }) => {
        const errors = await startBot(page, 'easy');
        const r = await page.evaluate(async () => {
            const B = window.__bot; B.freezeBot(true);
            B.place(0, 60); B.place(1, 760);
            B.setBall(300, 380, 0, 2);
            await new Promise(r => setTimeout(r, 300));
            return B.state().sc.slice();
        });
        expect(r).toEqual([0, 1]);
        expect(errors).toEqual([]);
    });

    test('lag compensation accepts a ball that passed the client ~RTT ago', async ({ page }) => {
        await startBot(page, 'easy');
        const r = await page.evaluate(() => {
            const B = window.__bot, S = B.state(), C = B.C;
            B.freezeBot(true);
            S.ph = 'play';
            B.place(1, 600);
            const hist = B.hist(); hist.length = 0;
            for (let k = 0; k < 10; k++) hist.push({ x: 600, y: C.GY - 20 });
            S.b.x = 600; S.b.y = 100; S.b.vx = 0; S.b.vy = 0;
            B.setRtt(0); B.tryHit(1, true); const no = S.last;
            B.setRtt(120); B.tryHit(1, true); const yes = S.last;
            return { no, yes };
        });
        expect(r.no).toBe(-1);
        expect(r.yes).toBe(1);
    });

    test('winning shows VICTORY; shared + own zh strings render', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/volley/?bot=easy&lang=zh#bot-v-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await expect(page).toHaveTitle(/机甲排球/);                         // volley string
        await expect(page.locator('#copy-btn')).toHaveText('复制');         // SportKit COMMON string
        await page.locator('#start-btn').click();
        await page.evaluate(() => {
            const B = window.__bot, C = B.C, S = B.state();
            B.freezeBot(true);
            S.sc[0] = C.WIN_SCORE - 1;
            B.place(1, C.W - 60);
            B.setBall(C.W - 200, C.GROUND - C.BR - 2, 0, 3);   // drops on P2's side
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

    test('bot vs bot produces real rallies', async ({ page }) => {
        test.setTimeout(60_000);
        const errors = await startBot(page, 'normal');
        await page.evaluate(() => window.__bot.autoplay('hard'));
        await expect.poll(() => page.evaluate(() => window.__bot.state().rally), { timeout: 45_000, intervals: [1000] }).toBeGreaterThan(15);
        expect(errors).toEqual([]);
    });

    test('two peers: client movement reaches the host', async ({ browser }) => {
        const ctxA = await browser.newContext(), ctxB = await browser.newContext();
        const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/volley/#volley-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/volley/#volley-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            const x0 = await pageA.evaluate(() => window.__bot.state().p[1].x);
            // client's screen is mirrored: ← on screen = toward the right wall in canonical space
            await pageB.keyboard.down('ArrowLeft');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().p[1].x), { timeout: 5_000 }).toBeGreaterThan(x0 + 40);
            await pageB.keyboard.up('ArrowLeft');
            expect(errors).toEqual([]);
        } finally { await ctxA.close(); await ctxB.close(); }
    });
});
