// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Steel Shadow: Recon (client/recon/): big-map fog-of-war tank duel.
 *  - the player's own tank is actually painted (regression: the fog used to
 *    erase it with destination-out on the main canvas);
 *  - forests hide a tank, a hovering drone reveals it, firing reveals it;
 *  - shells from hiding are ambushes (×1.6), and the satellite pings the enemy;
 *  - two peers: the client sees its own tank and its input drives the host sim.
 */
test.describe('Recon', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function startBot(page) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/recon/?bot=easy&lang=zh#bot-recon-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        await page.evaluate(() => window.__bot.freezeBot(true));
        return errors;
    }
    /** Colour of the canvas pixel at the given world point (via the current camera). */
    const worldPixel = (page, x, y) => page.evaluate(([x, y]) => {
        const c = document.querySelector('#game'), r = c.getBoundingClientRect();
        // camera centres the own tank unless clamped at the map edge → find its screen pos
        const S = window.__bot.state(), me = S.tanks[0];
        const scale = Math.min(Math.max(Math.min(r.width, r.height) / 640, 0.5), 1.35);
        const vw = r.width / scale, vh = r.height / scale;
        const ox = Math.min(Math.max(me.x - vw / 2, -40), 2400 - vw + 40), oy = Math.min(Math.max(me.y - vh / 2, -40), 1800 - vh + 40);
        const dpr = c.width / r.width;
        const px = Math.round((x - ox) * scale * dpr), py = Math.round((y - oy) * scale * dpr);
        const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2]];
    }, [x, y]);

    test('own tank is drawn, moves and fires', async ({ page }) => {
        const errors = await startBot(page);
        await page.waitForTimeout(200);
        const S0 = await page.evaluate(() => window.__bot.state().tanks[0]);
        // hull centre is painted in the orange team colour, not fog/ground
        const [r, g, b] = await worldPixel(page, S0.x - 4, S0.y + 6);
        expect(r).toBeGreaterThan(150);
        expect(r - b).toBeGreaterThan(60);

        await page.keyboard.down('d'); await page.waitForTimeout(500); await page.keyboard.up('d');
        const x1 = await page.evaluate(() => window.__bot.state().tanks[0].x);
        expect(x1).toBeGreaterThan(S0.x + 40);

        await page.keyboard.down(' ');
        await expect.poll(() => page.evaluate(() => window.__bot.state().shots.filter(s => s.o === 0).length)).toBeGreaterThan(0);
        await page.keyboard.up(' ');
        expect(await page.evaluate(() => window.__bot.explored())).toBeGreaterThan(20);
        expect(errors).toEqual([]);
    });

    test('forest hides, drone reveals, firing reveals; ambush hits harder', async ({ page }) => {
        const errors = await startBot(page);
        const r = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), M = B.map();
            const f = M.forests[0];                               // the centre forest
            const out = {};
            // enemy in forest, me 250px away on open ground → hidden
            const spot = B.free(f.x - f.r - 130, f.y);
            B.place(0, spot.x, spot.y); B.place(1, f.x, f.y);
            S.tanks[1].reveal = 0;
            await new Promise(r => setTimeout(r, 50));
            out.hidden = !B.visible(0);
            // my drone hovering over it → revealed
            S.drones[0] = { x: f.x, y: f.y, tx: f.x, ty: f.y, hover: true, until: S.T + 5000 };
            await new Promise(r => setTimeout(r, 50));
            out.drone = B.visible(0);
            S.drones[0] = null;
            // the enemy fires from the forest → revealed for a while
            B.setInput(1, { f: true, ax: Math.PI });
            await new Promise(r => setTimeout(r, 80));
            B.setInput(1, { f: false });
            out.fireReveal = B.visible(0);
            // ambush: I shoot from the forest at an enemy on open ground who can't see me
            S.shots.length = 0;
            B.place(0, f.x, f.y); S.tanks[0].reveal = 0; S.tanks[0].cd = 0;
            const tgt = B.free(f.x + f.r + 120, f.y);
            B.place(1, tgt.x, tgt.y); S.tanks[1].hp = 100;
            const aim = Math.atan2(tgt.y - f.y, tgt.x - f.x);
            S.tanks[0].ta = aim;
            B.setInput(0, { ax: aim, f: true });
            await new Promise(r => setTimeout(r, 40));
            B.setInput(0, { ax: aim, f: false });
            const t0 = performance.now();
            while (performance.now() - t0 < 1500 && S.tanks[1].hp === 100) { B.place(1, tgt.x, tgt.y); await new Promise(r => setTimeout(r, 20)); }
            B.setInput(0, null);
            out.hp = S.tanks[1].hp;
            out.amb = S.ev.some(e => e.k === 'hit' && e.amb);
            return out;
        });
        expect(r.hidden).toBe(true);
        expect(r.drone).toBe(true);
        expect(r.fireReveal).toBe(true);
        expect(r.amb).toBe(true);
        expect(r.hp).toBe(60);
        expect(errors).toEqual([]);
    });

    test('Q launches a drone and E schedules a satellite ping', async ({ page }) => {
        const errors = await startBot(page);
        await page.evaluate(() => { const t = window.__bot.state().tanks[0]; t.droneAt = 0; t.satAt = 0; });
        await page.keyboard.press('q');
        await page.keyboard.press('e');
        await expect.poll(() => page.evaluate(() => !!window.__bot.state().drones[0])).toBe(true);
        const sat = await page.evaluate(() => { const S = window.__bot.state(), t = S.tanks[0]; return { from: t.satFrom - S.T, to: t.satTo - S.T }; });
        expect(sat.to).toBeGreaterThan(sat.from);
        await expect.poll(() => page.evaluate(() => window.__bot.state().drones[0]?.hover), { timeout: 3000 }).toBe(true);
        expect(errors).toEqual([]);
    });

    test('two peers: client sees its tank and drives it', async ({ browser }) => {
        const ctxA = await browser.newContext(), ctxB = await browser.newContext();
        const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
        const errors = [];
        for (const p of [pageA, pageB]) p.on('pageerror', e => errors.push(String(e)));
        try {
            const room = '#recon-' + Math.random().toString(36).slice(2, 7);
            await pageA.goto(dev.url + '/recon/' + room);
            await expect(pageA.locator('#lobby-screen')).toBeVisible();
            await pageB.goto(dev.url + '/recon/' + room);
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            const x0 = await pageA.evaluate(() => window.__bot.state().tanks[1].x);
            await pageB.keyboard.down('a'); await pageB.waitForTimeout(700); await pageB.keyboard.up('a');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().tanks[1].x)).toBeLessThan(x0 - 40);
            await pageB.waitForTimeout(300);
            await pageB.screenshot({ path: 'test-results/recon-client.png' });
            expect(await pageB.evaluate(() => window.__bot.explored())).toBeGreaterThan(20);
            expect(errors).toEqual([]);
        } finally {
            await ctxA.close(); await ctxB.close();
        }
    });
});
