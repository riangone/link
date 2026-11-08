// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Steel Shadow: Frontline (client/frontline/): big-map fog-of-war tank duel.
 *  - the player's own tank is actually painted (regression: the fog used to
 *    erase it with destination-out on the main canvas);
 *  - forests hide a tank, a hovering drone reveals it, firing reveals it;
 *  - shells from hiding are ambushes (×1.6), and the satellite pings the enemy;
 *  - loadout (class / gun / gear), mines, supply crates, auto-fire and touch drag-aim;
 *  - two peers: the client sees its own tank and its input drives the host sim.
 */
test.describe('Frontline', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function startBot(page) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/frontline/?bot=easy&lang=zh#bot-frontline-${Math.random().toString(36).slice(2, 7)}`);
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
            // (a rock/ruin between us would block the line of sight on some random maps → pick a clear side)
            let spot = null;
            for (let a = Math.PI; a < Math.PI * 3 && !spot; a += 0.3) {
                const c = B.free(f.x + Math.cos(a) * (f.r + 130), f.y + Math.sin(a) * (f.r + 130));
                if (c && Math.hypot(c.x - f.x, c.y - f.y) < f.r + 220 && B.los(c, f)) spot = c;
            }
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
            for (let k = 0; k < 60 && !S.ev.some(e => e.k === 'fire' && e.i === 1); k++) await new Promise(r => setTimeout(r, 16));
            B.setInput(1, { f: false });
            out.fireReveal = B.visible(0);
            if (!out.fireReveal) out.dbg = JSON.stringify({ T: S.T, rev: S.tanks[1].reveal, me: S.tanks[0], foe: S.tanks[1], f, los: B.los(S.tanks[0], S.tanks[1]), ev: S.ev.slice(-6) });
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
            if (!out.amb) out.dbg2 = JSON.stringify({ ev: S.ev.slice(-8), me: S.tanks[0], foe: S.tanks[1], f, tgt });
            return out;
        });
        expect(r.hidden).toBe(true);
        expect(r.drone).toBe(true);
        expect(r.dbg || '').toBe('');
        expect(r.fireReveal).toBe(true);
        expect(r.dbg2 || '').toBe('');
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
        await expect.poll(() => page.evaluate(() => { const S = window.__bot.state(), t = S.tanks[0]; return t.satTo > t.satFrom; })).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__bot.state().drones[0]?.hover), { timeout: 3000 }).toBe(true);
        expect(errors).toEqual([]);
    });

    test('loadout picker: class + mods change the tank (heavy = 150 HP, plate +35)', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/frontline/?bot=easy&lang=zh#bot-frontline-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('#cls-chips button[data-k="heavy"]').click();
        await page.locator('#g-chips button[data-k="plate"]').click();
        await page.locator('#w-chips button[data-k="he"]').click();
        await expect(page.locator('#lo-stats')).toContainText('185');
        await page.screenshot({ path: 'test-results/frontline-ready.png' });
        await page.locator('#start-btn').click();
        await page.evaluate(() => window.__bot.freezeBot(true));
        const t = await page.evaluate(() => { const t = window.__bot.state().tanks[0]; return { cls: t.cls, w: t.w, g: t.g, hp: t.hp, maxHp: t.maxHp }; });
        expect(t).toEqual({ cls: 'heavy', w: 'he', g: 'plate', hp: 185, maxHp: 185 });
        // the choice is remembered on this device
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('frontline-loadout')).cls)).toBe('heavy');
        expect(errors).toEqual([]);
    });

    test('F lays a hidden mine that blows up under the enemy', async ({ page }) => {
        const errors = await startBot(page);
        const r = await page.evaluate(async () => {
            const B = window.__bot, S = B.state();
            B.items(false);
            const p = B.free(700, 900);
            B.place(0, p.x, p.y);
            const before = S.tanks[0].mines;
            return { before };
        });
        await page.keyboard.press('f');
        await expect.poll(() => page.evaluate(() => window.__bot.state().mines.length)).toBe(1);
        const res = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), m = S.mines[0], foe = S.tanks[1];
            const out = { left: S.tanks[0].mines, mine: { x: m.x, y: m.y } };
            // the enemy far away can't see it; up close it can
            B.place(1, m.x + 300, m.y); out.farSees = B.mineVisible(1, 0);
            B.place(1, m.x + 60, m.y); out.nearSees = B.mineVisible(1, 0);
            B.place(0, m.x - 200, m.y);
            await new Promise(r => setTimeout(r, 1000));          // arm
            const hp0 = foe.hp;
            B.place(1, m.x + 5, m.y);
            await new Promise(r => setTimeout(r, 80));
            out.dmg = hp0 - foe.hp; out.gone = S.mines.length === 0;
            return out;
        });
        expect(res.left).toBe(r.before - 1);
        expect(res.farSees).toBe(false);
        expect(res.nearSees).toBe(true);
        expect(res.dmg).toBe(42);
        expect(res.gone).toBe(true);
        expect(errors).toEqual([]);
    });

    test('crates: repair heals, shield soaks damage, crates fall in on their own', async ({ page }) => {
        const errors = await startBot(page);
        const r = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), me = S.tanks[0];
            const [p, q] = B.clearPair(700, 700, 200);
            B.place(0, p.x, p.y); B.place(1, 2200, 1600);
            me.hp = 40;
            B.spawnItem('repair', p.x, p.y);
            await new Promise(r => setTimeout(r, 60));
            const out = { healed: me.hp };
            B.spawnItem('shield', p.x, p.y);
            await new Promise(r => setTimeout(r, 60));
            out.shield = me.shield;
            // a shell into the shield: 25 damage, no HP lost
            const foe = S.tanks[1];
            B.place(1, q.x, q.y); foe.ta = Math.atan2(p.y - q.y, p.x - q.x); foe.cd = 0;
            const hp1 = me.hp;
            B.setInput(1, { f: true, ax: foe.ta }); await new Promise(r => setTimeout(r, 40)); B.setInput(1, { f: false, ax: foe.ta });
            const t0 = performance.now();
            while (performance.now() - t0 < 1500 && me.shield === 50) { B.place(0, p.x, p.y); await new Promise(r => setTimeout(r, 20)); }
            B.setInput(1, null);
            out.hpAfter = me.hp; out.hp1 = hp1; out.shieldAfter = me.shield;
            // automatic drops
            S.items.length = 0; S.itemAt = S.T;
            await new Promise(r => setTimeout(r, 100));
            out.dropped = S.items.length;
            return out;
        });
        expect(r.healed).toBe(85);
        expect(r.shield).toBe(50);
        expect(r.hpAfter).toBe(r.hp1);
        expect(r.shieldAfter).toBeLessThan(50);
        expect(r.dropped).toBe(2);                   // a crate and its mirror twin
        expect(errors).toEqual([]);
    });

    test('auto-fire shoots once the gun is on a visible enemy; manual touch aim does not track', async ({ page }) => {
        const errors = await startBot(page);
        const r = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), me = S.tanks[0];
            B.items(false);
            const [p, q] = B.clearPair(900, 1200, 250);
            const out = {};
            // aa:false (manual touch aim), no ax → turret follows the hull, not the enemy
            B.place(0, p.x, p.y); B.place(1, q.x, q.y); me.a = Math.PI / 2; me.ta = Math.PI / 2;
            B.setInput(0, { aa: false });
            await new Promise(r => setTimeout(r, 400));
            out.manualTa = me.ta;
            // auto-fire on: no trigger pulled, yet it shoots once lined up
            S.shots.length = 0; me.cd = 0;
            B.setInput(0, { af: true });
            const t0 = performance.now();
            while (performance.now() - t0 < 1500 && !S.shots.some(s => s.o === 0)) await new Promise(r => setTimeout(r, 20));
            out.fired = S.shots.some(s => s.o === 0);
            out.aimErr = Math.abs(Math.atan2(Math.sin(me.ta - Math.atan2(q.y - p.y, q.x - p.x)), Math.cos(me.ta - Math.atan2(q.y - p.y, q.x - p.x))));
            B.setInput(0, null);
            return out;
        });
        expect(Math.abs(r.manualTa - Math.PI / 2)).toBeLessThan(0.05);
        expect(r.fired).toBe(true);
        expect(r.aimErr).toBeLessThan(0.15);
        expect(errors).toEqual([]);
    });

    test('touch drag-aim: release fires toward the dragged direction', async ({ page }) => {
        const errors = await startBot(page);
        const r = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), me = S.tanks[0];
            B.items(false);
            const p = B.free(1000, 500);
            B.place(0, p.x, p.y); B.place(1, 2200, 1650);
            me.ta = 0; me.cd = 0; S.shots.length = 0;
            const ang = Math.PI * 0.75;
            B.touchDrag(ang);
            await new Promise(r => setTimeout(r, 120));
            const firedWhileDragging = S.ev.some(e => e.k === 'fire' && e.i === 0);
            B.touchRelease();
            const t0 = performance.now();
            const fired = () => S.ev.find(e => e.k === 'fire' && e.i === 0);
            while (performance.now() - t0 < 1500 && !fired()) await new Promise(r => setTimeout(r, 16));
            return { firedWhileDragging, ang: fired() ? fired().a : null, want: ang };
        });
        expect(r.firedWhileDragging).toBe(false);
        expect(r.ang).not.toBeNull();
        expect(Math.abs(r.ang - r.want)).toBeLessThan(0.1);
        expect(errors).toEqual([]);
    });

    test('HE shells splash a near miss against a wall', async ({ page }) => {
        const errors = await startBot(page);
        const r = await page.evaluate(async () => {
            const B = window.__bot, S = B.state(), M = B.map();
            B.items(false);
            B.loadout(0, { cls: 'mbt', w: 'he', g: 'radar' });
            // a ruin: the enemy hugs its west wall; the shell flies 40px below it (a miss) and bursts on the wall
            const foe = S.tanks[1], me = S.tanks[0];
            const o = M.ruins.find(o => o.h > 64 && o.x > 320 && B.los({ x: o.x - 220, y: o.y + 54 }, { x: o.x - 2, y: o.y + 54 }));
            const fx = o.x - 24, fy = o.y + 14, spot = { x: o.x - 220, y: o.y + 54 };
            B.place(0, spot.x, spot.y); B.place(1, fx, fy);
            foe.hp = foe.maxHp; foe.reveal = 1e9;
            me.ta = 0; me.cd = 0;
            const hp0 = foe.hp;
            B.setInput(0, { ax: 0, f: true });
            const t0 = performance.now();
            while (performance.now() - t0 < 1500 && foe.hp === hp0) {
                if (S.shots.some(s => s.o === 0)) B.setInput(0, { ax: 0, f: false });
                B.place(1, fx, fy); B.place(0, spot.x, spot.y);
                await new Promise(r => setTimeout(r, 16));
            }
            B.setInput(0, null);
            return { d: Math.hypot(fx - o.x, fy - spot.y), lost: hp0 - foe.hp, splash: S.ev.some(e => e.k === 'hit' && e.src === 'splash') };
        });
        expect(r.d).toBeLessThan(75);
        expect(r.splash).toBe(true);
        expect(r.lost).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });

    test('bot match with crates and mines runs without errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/frontline/?bot=hard&lang=zh#bot-frontline-${Math.random().toString(36).slice(2, 7)}`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        // speed the sim up: let the bot roam, crates drop, mines get laid
        await page.evaluate(() => { const S = window.__bot.state(); S.itemAt = 0; S.tanks[1].mines = 6; });
        await page.waitForTimeout(6000);
        const s = await page.evaluate(() => { const S = window.__bot.state(); return { items: S.items.length + S.ev.filter(e => e.k === 'pick').length, T: S.T }; });
        expect(s.items).toBeGreaterThan(0);
        await page.screenshot({ path: 'test-results/frontline-bot.png' });
        expect(errors).toEqual([]);
    });

    test('two peers: client sees its tank and drives it', async ({ browser }) => {
        const ctxA = await browser.newContext(), ctxB = await browser.newContext();
        const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
        const errors = [];
        for (const p of [pageA, pageB]) p.on('pageerror', e => errors.push(String(e)));
        try {
            const room = '#frontline-' + Math.random().toString(36).slice(2, 7);
            await pageA.goto(dev.url + '/frontline/' + room);
            await expect(pageA.locator('#lobby-screen')).toBeVisible();
            await pageB.goto(dev.url + '/frontline/' + room);
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            const x0 = await pageA.evaluate(() => window.__bot.state().tanks[1].x);
            await pageB.keyboard.down('a'); await pageB.waitForTimeout(700); await pageB.keyboard.up('a');
            await expect.poll(() => pageA.evaluate(() => window.__bot.state().tanks[1].x)).toBeLessThan(x0 - 40);
            await pageB.waitForTimeout(300);
            await pageB.screenshot({ path: 'test-results/frontline-client.png' });
            expect(await pageB.evaluate(() => window.__bot.explored())).toBeGreaterThan(20);
            expect(errors).toEqual([]);
        } finally {
            await ctxA.close(); await ctxB.close();
        }
    });
});
