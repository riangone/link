// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Abyssal Front (client/abyss/): deep-sea pressure-hull duel with sonar stealth.
 *  - the player's own hull is actually painted (fog must not erase it);
 *  - kelp hides a hull, an echo drone illuminates it, firing reveals it;
 *  - a torpedo from hiding is a silent strike (×1.6) and the sonar scan pings;
 *  - depth band rescales both hulls; leviathan dens cap and pay out supplies;
 *  - two peers: the client renders its own hull and its input drives the host sim.
 */
test.describe('Abyssal Front', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    /**
     * Wait until the vs-computer room hands the page a local session. GameBot
     * opens the ready card only when its (deferred) LocalSession connects, and
     * clicking through earlier just gets the start call dropped.
     */
    async function waitBotReady(page) {
        await page.waitForFunction(() => !!window.__bot && typeof window.__bot.state === 'function', null, { timeout: 5_000 });
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
    }

    async function startBot(page, { bot = 'easy', lan = 'zh' } = {}) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/abyss/?bot=${bot}&lang=${lan}#bot-abyss-${Math.random().toString(36).slice(2, 7)}`);
        await waitBotReady(page);
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        await page.evaluate(() => window.__bot.freezeBot(true));
        return errors;
    }
    const simT = page => page.evaluate(() => window.__bot.state().T);
    /**
     * Leave a running dive and get back to the ready card. The lobby card is
     * display:none while the overlay is hidden, so it cannot be clicked — the
     * overlay itself has to be unhidden first (the real UI gets there through
     * the game-over / disconnect screens).
     */
    async function redive(page, depthIndex) {
        await page.evaluate(() => {
            // showScreen() only shows the card it is asked for, so open the ready card
            // explicitly and close the game-over card left open by the last dive
            const el = id => document.getElementById(id);
            el('overlay').classList.remove('hidden');
            el('ready-screen').classList.remove('hidden');
            el('gameover-screen').classList.add('hidden');
        });
        await waitBotReady(page);
        await page.locator('#depth-chips button').nth(depthIndex).click();
        await expect(page.locator('#depth-chips button').nth(depthIndex)).toHaveClass(/active/);
        await expect(page.locator('#lo-stats')).toContainText('228');   // ram 380 sonar × 0.6 (hadal)
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        await page.evaluate(() => window.__bot.freezeBot(true));
        await page.waitForTimeout(150);
    }
    /** Freeze the sim on the host: our own overrides stop the bot moving, and we place hulls by hand. */
    async function still(page) {
        await page.evaluate(() => window.__bot.setInput(1, { mx: 0, my: 0, ax: null, f: false, aa: false }));
    }

    test('own hull is drawn, dives and fires a torpedo', async ({ page }) => {
        const errors = await startBot(page);
        // the player's own hull (amber shoal, south-west start); state vs net is checked elsewhere
        await expect.poll(() => page.evaluate(() => !!window.__bot.net())).toBe(true);
        const S0 = await page.evaluate(() => window.__bot.net().tanks[0]);
        expect(S0.x).toBeLessThan(600);                       // the amber shoal starts west

        await page.keyboard.down('d'); await page.waitForTimeout(500); await page.keyboard.up('d');
        const x1 = await page.evaluate(() => window.__bot.state().tanks[0].x);
        expect(x1).toBeGreaterThan(S0.x + 40);

        // a fresh dive starts with a short arming delay on the tubes; wait it out, then hold fire
        await expect.poll(() => page.evaluate(() => window.__bot.state().tanks[0].cd), { timeout: 4_000 }).toBeLessThan(200);
        await page.keyboard.down(' ');
        await expect.poll(() => page.evaluate(() => window.__bot.state().shots.length)).toBeGreaterThan(0);
        await page.keyboard.up(' ');
        expect(await page.evaluate(() => window.__bot.explored())).toBeGreaterThan(20);
        expect(errors).toEqual([]);
    });

    test('the host simulation time advances (no per-frame exceptions)', async ({ page }) => {
        const errors = await startBot(page);
        const t0 = await simT(page);
        await page.waitForTimeout(700);
        expect(await simT(page)).toBeGreaterThan(t0 + 300);
        expect(errors).toEqual([]);
    });

    test('kelp hides a hull, its torpedo is a silent strike, the echo drone illuminates it', async ({ page }) => {
        await startBot(page);
        await still(page);
        const pair = await page.evaluate(() => window.__bot.clearPair(500, 1350, 330) || window.__bot.clearPair(900, 900, 330));
        expect(pair).toBeTruthy();
        // Put a big kelp bed directly in the rival's path, park the rival deep inside it and
        // the amber hull in open water with a clear line: the hiding rule alone decides vision.
        const setup = await page.evaluate(() => {
            const S = window.__bot.state();
            // a captured den is a listening post: keep every den (and its radar) away from this test
            S.dens.length = 0;
            // open water near the rival's patch of sea: a = our hull, k = the kelp centre ~300px east.
            // Scan the whole west edge for a pair that satisfies every rule at once: a clear line of
            // sound (no basalt), a straight-line distance inside the rival's spot radius (kelp hides
            // beyond it) yet inside the shooter's own sonar reach (so only the kelp can explain the
            // silence), and a kelp centre that is itself in open water
            const seaW = S.size === 'large' ? 3600 : 2400;
            const reach = window.__bot.stats(0).sight;
            let a = null, k = null;
            for (let y = 120; y < 900 && !k; y += 60) {
                const c = window.__bot.free(seaW - 1000, y);
                if (!c) continue;
                for (let dx = 0; dx <= 300 && !k; dx += 30) {
                    const q = window.__bot.free(c.x + 300 + dx, c.y);
                    if (!q || window.__bot.inKelp(q.x, q.y)) continue;
                    const d = Math.hypot(q.x - c.x, q.y - c.y);
                    if (d <= 125 || d >= reach || !window.__bot.los(c, q)) continue;
                    a = c; k = q;
                }
            }
            if (!k) return { fail: 'no clear kelp spot' };
            window.__bot.map().forests.push({ x: k.x, y: k.y, r: 150 });
            // zero the clocks before teleporting: a stale `reveal` from before the move must not leak
            const T = S.T;
            S.tanks[0].x = S.tanks[1].x; S.tanks[0].y = S.tanks[1].y;
            S.tanks[0].reveal = T; S.tanks[1].reveal = T;
            window.__bot.place(0, a.x, a.y);
            window.__bot.place(1, k.x, k.y);
            window.__bot.setInput(1, { mx: 0, my: 0, ax: null, f: false, aa: false });
            S.tanks[1].still = T;
            return { d: Math.hypot(a.x - k.x, a.y - k.y), inKelp: window.__bot.inKelp(k.x, k.y), los: window.__bot.los(a, k), sight: reach, a, k };
        });
        expect(setup.inKelp).toBe(true);
        expect(setup.los).toBe(true);
        expect(setup.d).toBeLessThan(setup.sight);
        expect(setup.d).toBeGreaterThan(125);                    // plainly beyond the kelp spot radius

        // the rival sits in kelp: amber cannot hear it
        await expect.poll(() => page.evaluate(() => window.__bot.visible(0))).toBe(false);
        // ...unless the echo drone hovers over it
        await page.evaluate(() => {
            const S = window.__bot.state(), foe = S.tanks[1];
            S.drones[0] = { x: foe.x, y: foe.y, tx: foe.x, ty: foe.y, hover: true, until: S.T + 8000 };
        });
        await expect.poll(() => page.evaluate(() => window.__bot.visible(0))).toBe(true);
        // ...or it fires (the bioluminescent glow gives it away)
        await page.evaluate(() => {
            const S = window.__bot.state();
            S.drones[0] = null;
            S.tanks[1].reveal = S.T + 3000;
        });
        await expect.poll(() => page.evaluate(() => window.__bot.visible(0))).toBe(true);
        // back to silence: a torpedo launched now is a silent strike (fire for real, through input)
        const ambush = await page.evaluate(() => {
            const S = window.__bot.state(), me = S.tanks[0], foe = S.tanks[1];
            foe.reveal = 0;
            window.__bot.setInput(1, { mx: 0, my: 0, ax: null, f: false, aa: false });
            foe.still = S.T;
            const ang = Math.atan2(foe.y - me.y, foe.x - me.x);
            me.ta = ang; me.cd = 0;
            // snapshot the host view at the instant of firing: `amb` is decided right there
            const evMark = S.ev.length, shotMark = S.shots.length;
            return { hidden: !window.__bot.visible(0), ang, evMark, shotMark };
        });
        expect(ambush.hidden).toBe(true);
        // Silent strike = the shooter hides in kelp and the victim cannot hear it. (Out in the
        // open, firing visibly gives you away: that shot is NOT an ambush — by design.)
        await page.evaluate(() => {
            const S = window.__bot.state(), a = S.tanks[0], k = S.tanks[1];
            const ang = Math.atan2(k.y - a.y, k.x - a.x);
            const tx = a.x, ty = a.y;
            a.x = k.x; a.y = k.y;                       // swap spots through the kelp
            k.x = tx; k.y = ty;
            a.ta = ang + Math.PI; k.still = S.T;
            S.tanks[0].reveal = S.T; S.tanks[1].reveal = S.T;
            a.cd = 0;
            window.__bot.setInput(0, { ax: ang + Math.PI, f: true });
        });
        await expect.poll(() => page.evaluate(() => window.__bot.state().shots.some(s => s.o === 0 && s.amb))).toBe(true);
    });

    test('sonar scan pings after a delay; depth band rescales both hulls', async ({ page }) => {
        await startBot(page);
        const hp0 = await page.evaluate(() => window.__bot.stats(0).hp);
        await page.evaluate(() => window.__bot.state().tanks[0].scanAt = 0);
        await page.keyboard.press('e');
        // the key is consumed on the next sim tick, which is a frame away: give it until the ping lands
        await expect.poll(() => page.evaluate(() => { const t = window.__bot.state().tanks[0]; return t.scanTo > t.scanFrom; })).toBe(true);

        // the depth band is host-owned: pick it on the ready screen, then dive
        await redive(page, 3);                                   // hadal zone
        const info = await page.evaluate(() => ({
            depth: window.__bot.state().depth,
            max: window.__bot.state().tanks[0].maxHp,
            sight: window.__bot.stats(0).sight,
            tubeSpeed: window.__bot.stats(0).shot
        }));
        expect(info.depth).toBe('hadal');
        expect(info.max).toBe(hp0);                              // hp is not stretched by the band
        expect(info.sight).toBeLessThan(380);                 // narrow sonar in the hadal dark
        expect(info.tubeSpeed).toBeGreaterThan(0.42);         // ...but a longer reach
    });

    test('leviathan dens cap to the diver standing in them', async ({ page }) => {
        await startBot(page);
        await still(page);
        const den = await page.evaluate(() => {
            const d = window.__bot.state().dens[0];
            window.__bot.place(0, d.x + 4, d.y + 4);
            window.__bot.place(1, 200, 200);
            return d;
        });
        await expect.poll(() => page.evaluate(() => window.__bot.state().dens[0].owner), { timeout: 8_000 }).toBe(0);
        expect(den.r).toBe(90);
    });

    test('two peers: the client renders its own hull and its input drives the host', async ({ browser }) => {
        const room = '#abyss-' + Math.random().toString(36).slice(2, 7);
        const ctxA = await browser.newContext(), ctxB = await browser.newContext();
        const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
        try {
            const errors = [];
            for (const p of [pageA, pageB]) p.on('pageerror', e => errors.push(String(e)));
            await pageA.goto(dev.url + '/abyss/?lang=en' + room);
            await expect(pageA.locator('#lobby-screen')).toBeVisible();
            await pageB.goto(dev.url + '/abyss/?lang=en' + room);
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            // the client cannot rewrite the sea, but it can pick its own hull
            expect(await pageB.locator('#map-chips button').first().isDisabled()).toBe(true);
            await pageB.locator('#cls-chips button[data-k="stalk"]').click();

            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 10_000 });
            // the client is hull 1 (bottom-right start) and hears its own hull
            await expect.poll(() => pageB.evaluate(() => window.__bot.net() ? window.__bot.net().tanks[1].x : 0)).toBeGreaterThan(3000);
            expect(await pageB.evaluate(() => window.__bot.role())).toBe('client');

            // the client's input reaches the host sim
            const x0 = await pageA.evaluate(() => window.__bot.state().tanks[1].x);
            await pageB.keyboard.down('a'); await pageB.waitForTimeout(700); await pageB.keyboard.up('a');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().tanks[1].x)).toBeLessThan(x0 - 40);
            expect(await pageA.evaluate(() => window.__bot.state().tanks[1].cls)).toBe('stalk');
            expect(await pageB.evaluate(() => window.__bot.explored())).toBeGreaterThan(20);
            expect(errors).toEqual([]);
            await pageB.screenshot({ path: 'test-results/abyss-client.png' });
        } finally {
            await ctxA.close(); await ctxB.close();
        }
    });
});
