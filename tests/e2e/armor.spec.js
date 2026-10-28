// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Armor (client/armor/): 1v1 tank duel on the Spin skeleton.
 *  - no self-damage: point-blank shots into steel, heavy splash next to
 *    yourself and your own shell placed on your own hull never cost HP;
 *  - shells do hurt the rival;
 *  - hard bot wins a full match against an idle player, no page errors;
 *  - real P2P: the client's pick and fire input reach the host.
 */
test.describe('Armor', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function startBot(page, level, pick) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/armor/?bot=${level}#bot-armor-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator(`.pick[data-type="${pick}"]`).click();
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        return errors;
    }

    test('own shells never hurt their owner, but do hurt the rival', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'heavy');
        await page.evaluate(() => { window.__bot.freezeBot(true); window.__bot.skipCountdown(); });
        await expect.poll(() => page.evaluate(() => window.__bot.state().ph)).toBe('battle');

        // 1) heavy shells point-blank into a steel block (splash right next to us)
        const res = await page.evaluate(async () => {
            const B = window.__bot, S = B.state();
            const steel = B.rects(S.mp).find(r => r.k === 's');
            const me = S.tanks[0], hp0 = me.hp;
            B.place(0, steel.x - 60, steel.y + steel.h / 2, 0);
            B.place(1, 600, 40);
            B.setInput({ f: true, ax: 1, ay: 0 });
            await new Promise(r => setTimeout(r, 2500));
            B.setInput(null);
            // 2) a shell of ours spawned right on our own hull
            S.bl.push({ x: me.x, y: me.y, vx: 0.1, vy: 0, o: 0, k: 1, life: 30, dmg: 99 });
            await new Promise(r => setTimeout(r, 300));
            return { hp0, hp: me.hp, shots: S.events.filter(e => e.k === 'shot' && e.i === 0).length };
        });
        expect(res.shots).toBeGreaterThan(0);
        expect(res.hp).toBe(res.hp0);

        // 3) the same shell on the rival does hurt it
        const hit = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), foe = S.tanks[1], hp0 = foe.hp;
            S.bl.push({ x: foe.x - 30, y: foe.y, vx: 6, vy: 0, o: 0, k: 0, life: 30, dmg: 10 });
            await new Promise(r => setTimeout(r, 300));
            return { hp0, hp: foe.hp };
        });
        expect(hit.hp).toBeLessThan(hit.hp0);
        expect(errors).toEqual([]);
    });

    test('hard bot wins a full match against an idle player', async ({ page }) => {
        test.setTimeout(150_000);
        const errors = await startBot(page, 'hard', 'balance');
        const st = () => page.evaluate(() => { const s = window.__bot.state(); return { ph: s.ph, sc: s.sc, tp: s.tp }; });
        expect((await st()).tp[0]).toBe('balance');
        await expect.poll(async () => (await st()).sc[1], { timeout: 130_000, intervals: [1000] }).toBeGreaterThanOrEqual(3);
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#win-loss-title')).toHaveText('DEFEAT');
        expect(errors).toEqual([]);
    });

    test('two peers: pick and fire travel client → host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/armor/#armor-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/armor/#armor-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });

            await pageB.locator('.pick[data-type="sniper"]').click();
            await expect(pageA.locator('#opp-pick')).toContainText('HAWK', { timeout: 5_000 });

            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await pageA.evaluate(() => window.__bot.skipCountdown());
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().ph)).toBe('battle');
            expect(await pageA.evaluate(() => window.__bot.state().tp[1])).toBe('sniper');

            await pageB.keyboard.down(' ');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().events.filter(e => e.k === 'shot' && e.i === 1).length), { timeout: 5_000 }).toBeGreaterThan(0);
            await pageB.keyboard.up(' ');
            expect(errors).toEqual([]);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
    test('touch: one-hand mode auto-fires, double-tap dashes, toggles back to two hands', async ({ browser }) => {
        const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 420, height: 860 } });
        const page = await ctx.newPage();
        try {
            await page.addInitScript(() => localStorage.removeItem('armor-ctrl'));
            const errors = await startBot(page, 'easy', 'balance');
            await page.evaluate(() => { window.__bot.freezeBot(true); window.__bot.skipCountdown(); });
            await expect.poll(() => page.evaluate(() => window.__bot.state().ph)).toBe('battle');
            const box = page.locator('#touch-controls'), btn = page.locator('#ctrl-mode-btn');
            await expect(box).toBeVisible();
            await expect(box).not.toHaveClass(/one-hand/);
            await expect(page.locator('#fire-btn')).toBeVisible();

            // clear line of fire, no input at all → count our shots over 1.5 s
            const shotsIdle = () => page.evaluate(async () => {
                const B = window.__bot, S = B.state();
                B.place(0, 160, 40); B.place(1, 460, 40);
                const seen = new Set();
                const t0 = performance.now();
                while (performance.now() - t0 < 1500) {
                    B.place(0, 160, 40); B.place(1, 460, 40);
                    for (const e of S.events) if (e.k === 'shot' && e.i === 0) seen.add(e.id);
                    await new Promise(r => setTimeout(r, 30));
                }
                return seen.size;
            });
            expect(await shotsIdle()).toBe(0);           // two hands: no auto-fire

            await btn.tap();                             // → one hand (right)
            await expect(box).toHaveClass(/one-hand/);
            await expect(box).not.toHaveClass(/left-hand/);
            await expect(page.locator('#fire-btn')).toBeHidden();
            expect(await page.evaluate(() => localStorage.getItem('armor-ctrl'))).toBe('right');
            expect(await shotsIdle()).toBeGreaterThan(0); // one hand: auto-fire

            // double-tap the stick → dash
            const z = await page.locator('#stick-zone').boundingBox();
            const cx = z.x + z.width / 2, cy = z.y + z.height / 2;
            const dashBefore = await page.evaluate(() => window.__bot.state().tanks[0].dcd);
            await page.evaluate(([x, y]) => {
                const el = document.getElementById('stick-zone');
                const ev = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
                ev('pointerdown'); ev('pointerup'); ev('pointerdown'); ev('pointerup');
            }, [cx, cy]);
            await expect.poll(() => page.evaluate(() => window.__bot.state().tanks[0].dcd)).toBeGreaterThan(dashBefore);

            await btn.tap();                             // → one hand (left)
            await expect(box).toHaveClass(/left-hand/);
            await btn.tap();                             // → back to two hands
            await expect(box).not.toHaveClass(/one-hand/);
            await expect(page.locator('#fire-btn')).toBeVisible();
            expect(errors).toEqual([]);
        } finally {
            await ctx.close();
        }
    });

    test('match options (loot toggle, game speed) and tank garage customization work', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.addInitScript(() => {
            localStorage.removeItem('armor-items');
            localStorage.removeItem('armor-speed');
            localStorage.removeItem('armor-builds');
        });
        await page.goto(`${dev.url}/armor/?bot=easy#bot-armor-opts`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });

        // Toggle loot off and speed to slow
        await page.locator('#opt-items-btn').click();
        expect(await page.evaluate(() => localStorage.getItem('armor-items'))).toBe('0');
        await page.locator('#opt-speed-btn').click(); // normal -> fast
        await page.locator('#opt-speed-btn').click(); // fast -> slow
        expect(await page.evaluate(() => localStorage.getItem('armor-speed'))).toBe('slow');

        // Open garage and equip parts on heavy tank
        await page.locator('.pick[data-type="heavy"]').click();
        await page.locator('#garage-btn').click();
        await expect(page.locator('#garage-screen')).toBeVisible();
        await page.locator('.gp[data-slot="gun"][data-id="heavy"]').click();
        await page.locator('.gp[data-slot="hull"][data-id="plate"]').click();
        await page.locator('.gar-done').click();
        await expect(page.locator('#ready-screen')).toBeVisible();
        await expect(page.locator('.pick[data-type="heavy"] .pk-mod')).toContainText('💣🧱');

        // Start match and verify custom stats + loot disabled + slow speed
        await page.locator('#start-btn').click();
        await page.evaluate(() => window.__bot.skipCountdown());
        await expect.poll(() => page.evaluate(() => window.__bot.state().ph)).toBe('battle');
        const st = await page.evaluate(() => {
            const s = window.__bot.state();
            return { opt: s.opt, hp: s.tanks[0].hp, baseHp: window.__bot.TANKS.heavy.hp, itT: s.itT };
        });
        expect(st.opt).toEqual({ items: false, spd: 'slow' });
        expect(st.hp).toBeGreaterThan(st.baseHp);
        expect(st.itT).toBeGreaterThan(1e6);
        expect(errors).toEqual([]);
    });
});
