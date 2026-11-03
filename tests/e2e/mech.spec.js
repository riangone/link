// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Mech (client/mech/): tank ⇄ mech transform duel.
 *  - tank form: Space fires shells that leave the barrel (not just sparks);
 *    behind steel the gun follows the hull, with a clear line it tracks the rival;
 *  - mech form: R transforms, a punch in reach hurts the rival;
 *  - two peers: the flipped client view renders and its fire reaches the host.
 */
test.describe('Mech', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function startBot(page) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/mech/?bot=easy#bot-mech-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        await page.evaluate(() => { window.__bot.freezeBot(true); window.__bot.skipCountdown(); window.__bot.stopLoot(); });
        await expect.poll(() => page.evaluate(() => window.__bot.state().ph)).toBe('battle');
        return errors;
    }
    /** Shells of tank 0 that travelled at least `min` px from where they spawned. */
    const flyingShells = (page, min) => page.evaluate(async (min) => {
        const S = window.__bot.state(), seen = new Map();
        const t0 = performance.now();
        while (performance.now() - t0 < 1200) {
            for (const b of S.bl) if (b.o === 0) { if (!seen.has(b)) seen.set(b, { x: b.x, y: b.y }); seen.get(b).d = Math.hypot(b.x - seen.get(b).x, b.y - seen.get(b).y); }
            await new Promise(r => setTimeout(r, 16));
        }
        return [...seen.values()].filter(v => v.d >= min).length;
    }, min);

    test('tank form: Space fires shells that fly, even from behind cover', async ({ page }) => {
        const errors = await startBot(page);
        // spawn: a steel bar sits between both tanks → drive left, gun follows the hull
        await page.keyboard.down('a'); await page.waitForTimeout(700); await page.keyboard.up('a');
        await page.keyboard.down(' ');
        expect(await flyingShells(page, 60)).toBeGreaterThan(0);
        await page.keyboard.up(' ');
        // the turret either follows the hull (cover in the way) or tracks the rival
        // (driving left may already have cleared the steel bar's line)
        const aim = await page.evaluate(() => {
            const [me, foe] = window.__bot.state().tanks;
            const d = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
            return Math.min(d(me.ta, Math.PI), d(me.ta, Math.atan2(foe.y - me.y, foe.x - me.x)));
        });
        expect(aim).toBeLessThan(0.3);

        // clear line → the turret tracks the rival and the shell hits it
        const hit = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), foe = S.tanks[1];
            B.place(0, 160, 40); B.place(1, 460, 40);
            const hp0 = foe.hp;
            B.setInput({ f: true });
            const t0 = performance.now();
            while (performance.now() - t0 < 2500 && foe.hp === hp0) { B.place(0, 160, 40); B.place(1, 460, 40); await new Promise(r => setTimeout(r, 30)); }
            B.setInput(null);
            return { hp0, hp: foe.hp };
        });
        expect(hit.hp).toBeLessThan(hit.hp0);
        expect(errors).toEqual([]);
    });

    test('R transforms into a mech whose punch hurts in reach', async ({ page }) => {
        const errors = await startBot(page);
        await page.keyboard.press('r');
        await expect.poll(() => page.evaluate(() => window.__bot.state().tanks[0].form)).toBe(1);
        const res = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), foe = S.tanks[1];
            B.place(0, 300, 40); B.place(1, 360, 40); S.tanks[0].ba = 0;
            const hp0 = foe.hp;
            B.setInput({ f: true });
            await new Promise(r => setTimeout(r, 600));
            B.setInput(null);
            return { hp0, hp: foe.hp, punches: S.events.filter(e => e.k === 'punch' && e.i === 0).length };
        });
        expect(res.punches).toBeGreaterThan(0);
        expect(res.hp).toBeLessThan(res.hp0);
        await page.waitForTimeout(450);                       // mcd cooldown
        await page.keyboard.press('r');
        await expect.poll(() => page.evaluate(() => window.__bot.state().tanks[0].form)).toBe(0);
        expect(errors).toEqual([]);
    });

    test('mech dash locks onto and closes distance to a kiting tank', async ({ page }) => {
        const errors = await startBot(page);
        const result = await page.evaluate(async () => {
            const B = window.__bot, S = B.state();
            B.place(0, 220, 320); B.place(1, 470, 320);
            S.tanks[0].form = 1; S.tanks[0].mcd = 0; S.tanks[0].dcd = 0;
            const before = Math.hypot(S.tanks[1].x - S.tanks[0].x, S.tanks[1].y - S.tanks[0].y);
            B.hostAction(0, 'd');
            await new Promise(r => setTimeout(r, 180));
            const after = Math.hypot(S.tanks[1].x - S.tanks[0].x, S.tanks[1].y - S.tanks[0].y);
            return { before, after, dash: S.tanks[0].dash, dcd: S.tanks[0].dcd };
        });
        expect(result.after).toBeLessThan(result.before - 30);
        expect(result.dcd).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });

    test('two peers: flipped client renders and its fire reaches the host', async ({ browser }) => {
        const ctxA = await browser.newContext(), ctxB = await browser.newContext();
        const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/mech/#mech-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/mech/#mech-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await pageA.evaluate(() => window.__bot.skipCountdown());
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().ph)).toBe('battle');

            await pageB.keyboard.down(' ');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().events.filter(e => e.k === 'shot' && e.i === 1).length), { timeout: 5_000 }).toBeGreaterThan(0);
            await pageB.keyboard.up(' ');
            await pageB.keyboard.press('r');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().tanks[1].form), { timeout: 5_000 }).toBe(1);
            await pageB.waitForTimeout(400);
            await pageB.screenshot({ path: test.info().outputPath('client-mech.png') });
            expect(errors).toEqual([]);
        } finally {
            await ctxA.close(); await ctxB.close();
        }
    });
});
