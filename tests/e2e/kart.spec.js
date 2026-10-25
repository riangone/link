// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Kart (client/kart/): Q版卡丁车 1v1.
 *  - the hard bot actually races: it makes progress and stays inside the walls;
 *  - drifting through a turn charges sparks and releasing gives a mini-turbo;
 *  - a bubble missile homes in and spins the rival out;
 *  - crossing the line on the last lap wins and shows the game-over screen;
 *  - PvP: the client's input drives the blue kart on the host, the client
 *    sees the host's kart move.
 */
test.describe('Link Kart', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    const st = page => page.evaluate(() => window.__kart.state);

    async function startBot(page, level, hash, extra) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/kart/?bot=${level}&e2e=1${extra || ''}#${hash}`);
        await expect(page.locator('#start-btn')).toBeVisible({ timeout: 5_000 });
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        return errors;
    }

    test('hard bot races forward and stays on the track', async ({ page }) => {
        const errors = await startBot(page, 'hard', 'kart-bot');
        await expect.poll(async () => (await st(page)).status, { timeout: 6_000 }).toBe('racing');
        const wall = await page.evaluate(() => window.__kart.track.wall);
        let maxOff = 0;
        for (let i = 0; i < 16; i++) {
            await page.waitForTimeout(500);
            const s = await st(page);
            const d = await page.evaluate(([x, y]) => {
                // distance to the nearest sampled centreline point
                let best = Infinity;
                for (let a = 0; a < window.__kart.track.len; a += 8) {
                    const p = window.__kart.pointAt(a, 0);
                    best = Math.min(best, Math.hypot(p.x - x, p.y - y));
                }
                return best;
            }, [s.p2.x, s.p2.y]);
            maxOff = Math.max(maxOff, d);
        }
        const s = await st(page);
        expect(s.p2.prog).toBeGreaterThan(2000);          // ≈ a third of a lap in 8 s, at least
        expect(maxOff).toBeLessThan(wall);
        expect(s.p1.prog).toBeLessThan(0);                // idle human never moved off the grid
        expect(errors).toEqual([]);
    });

    test('drift charges sparks and releasing gives a mini-turbo', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'kart-drift');
        await page.evaluate(() => { window.__kart.freezeBot(true); window.__kart.skipCountdown(); });
        await expect.poll(async () => (await st(page)).status).toBe('racing');
        await page.evaluate(() => window.__kart.place(1, 200, -70, 6));
        await page.keyboard.down('w');
        await page.keyboard.down('d');
        await page.keyboard.down('Shift');
        await expect.poll(async () => (await st(page)).p1.drift, { timeout: 2_000 }).not.toBe(0);
        // release the drift key in-page the moment the sparks reach level 1+ (no poll-latency races)
        const boost = await page.evaluate(() => new Promise(resolve => {
            const tick = () => {
                const k = window.__kart.state.p1;
                if (k.drift && k.charge > 60) {
                    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
                    setTimeout(() => resolve(window.__kart.state.p1.boost), 60);
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

    test('bubble missile spins the rival out', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'kart-missile');
        await page.evaluate(() => { window.__kart.freezeBot(true); window.__kart.skipCountdown(); });
        await expect.poll(async () => (await st(page)).status).toBe('racing');
        await page.evaluate(() => {
            window.__kart.place(1, 150, 0, 0);
            window.__kart.place(2, 420, 30, 0);
            window.__kart.give(1, 'missile');
        });
        await page.keyboard.press('Space');
        await expect.poll(async () => (await st(page)).p1.item).toBe(null);
        await expect.poll(async () => (await st(page)).p2.spin, { timeout: 3_000 }).toBeGreaterThan(0);
        expect((await st(page)).missiles.length).toBe(0);
        expect(errors).toEqual([]);
    });

    test('finishing the last lap wins the race', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'kart-finish');
        await page.evaluate(() => { window.__kart.freezeBot(true); window.__kart.skipCountdown(); });
        await expect.poll(async () => (await st(page)).status).toBe('racing');
        await page.evaluate(() => {
            const t = window.__kart.track;
            window.__kart.place(1, t.len * t.laps - 60, 0, 6);
        });
        await page.keyboard.down('w');
        await expect.poll(async () => (await st(page)).winner, { timeout: 3_000 }).toBe(1);
        await page.keyboard.up('w');
        await expect(page.locator('#gameover-screen')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#win-loss-title')).toHaveText('VICTORY!');
        await expect(page.locator('#final-score')).toHaveText('1 - 0');
        // race again keeps the tally
        await page.locator('#restart-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        expect((await st(page)).score).toEqual({ p1: 1, p2: 0 });
        expect(errors).toEqual([]);
    });

    test('north view — touch stick is absolute: the kart turns to face where the stick points', async ({ browser }) => {
        const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        try {
            const errors = await startBot(page, 'easy', 'kart-stick', '&view=north');
            await page.evaluate(() => { window.__kart.freezeBot(true); window.__kart.skipCountdown(); });
            await expect.poll(async () => (await st(page)).status).toBe('racing');
            await page.evaluate(() => window.__kart.place(1, 200, 0, 5));
            const h0 = (await st(page)).p1.h;
            const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

            const zone = page.locator('#move-stick');
            await expect(zone).toBeVisible();
            const box = await zone.boundingBox();
            if (!box) throw new Error('no stick');
            const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
            const cdp = await ctx.newCDPSession(page);
            const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }]
            });
            // 目标方向 = 当前车头 + 80°（屏幕坐标）。相对转向下"往右推"只会右转，这里要求车头收敛到摇杆方向
            for (const delta of [1.4, -1.4]) {
                const target = wrap(h0 + delta);
                await touch('touchStart', cx, cy);
                await touch('touchMove', cx + Math.cos(target) * 20, cy + Math.sin(target) * 20);
                await touch('touchMove', cx + Math.cos(target) * 60, cy + Math.sin(target) * 60);
                await expect.poll(async () => Math.abs(wrap((await st(page)).p1.h - target)),
                    { timeout: 2_000, intervals: [50] }).toBeLessThan(0.15);
                // 对准之后不再继续打方向（不会绕圈）
                await page.waitForTimeout(250);
                expect(Math.abs(wrap((await st(page)).p1.h - target))).toBeLessThan(0.2);
                await touch('touchEnd');
                await page.evaluate(() => window.__kart.place(1, 200, 0, 5));
            }
            expect(errors).toEqual([]);
        } finally {
            await ctx.close();
        }
    });

    test('pvp: client input drives the blue kart and the client sees the host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/kart/#gs-kart-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/kart/#gs-kart-room');
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
    // 每条新赛道：困难人机能跑起来、不出界（赛道几何/加速带/冰面抓地都在这里一起验证）
    for (const id of ['beach', 'snow', 'candy']) {
        test(`track ${id}: hard bot laps it inside the walls`, async ({ page }) => {
            const errors = await startBot(page, 'hard', `kart-${id}`, `&track=${id}`);
            expect((await page.evaluate(() => window.__kart.track)).id).toBe(id);
            await expect.poll(async () => (await st(page)).status, { timeout: 6_000 }).toBe('racing');
            const wall = await page.evaluate(() => window.__kart.track.wall);
            let maxOff = 0;
            for (let i = 0; i < 20; i++) {
                await page.waitForTimeout(500);
                const s = await st(page);
                const d = await page.evaluate(([x, y]) => {
                    let best = Infinity;
                    for (let a = 0; a < window.__kart.track.len; a += 8) {
                        const p = window.__kart.pointAt(a, 0);
                        best = Math.min(best, Math.hypot(p.x - x, p.y - y));
                    }
                    return best;
                }, [s.p2.x, s.p2.y]);
                maxOff = Math.max(maxOff, d);
            }
            expect((await st(page)).p2.prog).toBeGreaterThan(2500);
            expect(maxOff).toBeLessThan(wall);
            expect(errors).toEqual([]);
        });
    }

    test('track picker: the chosen course is used for the race and remembered', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/kart/?bot=easy&e2e=1#kart-pick`);
        await expect(page.locator('#start-btn')).toBeVisible({ timeout: 5_000 });
        const btn = page.locator('#ready-screen .track-btn[data-track="3"]');
        await btn.click();
        await expect(btn).toHaveClass(/active/);
        expect((await page.evaluate(() => window.__kart.track)).id).toBe('candy');   // lobby preview
        await page.locator('#start-btn').click();
        await expect.poll(async () => (await st(page)).track).toBe(3);
        // remembered on reload
        await page.reload();
        await expect(page.locator('#ready-screen .track-btn[data-track="3"]')).toHaveClass(/active/, { timeout: 5_000 });
        // random never crashes and picks a real track
        await page.locator('#ready-screen .track-btn[data-track="-1"]').click();
        await page.locator('#start-btn').click();
        await expect.poll(async () => (await st(page)).status).toBe('countdown');
        const t = (await st(page)).track;
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(4);
        expect(errors).toEqual([]);
    });

    test('default fixed view; holding a finger on the track steers the kart toward it', async ({ browser }) => {
        const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        try {
            const errors = await startBot(page, 'easy', 'kart-finger');
            expect((await page.evaluate(() => window.__kart.view)).mode).toBe('north');
            await page.evaluate(() => { window.__kart.freezeBot(true); window.__kart.skipCountdown(); });
            await expect.poll(async () => (await st(page)).status).toBe('racing');
            await page.evaluate(() => window.__kart.place(1, 200, 0, 0));
            await page.waitForTimeout(500);   // 镜头追上
            // 车的屏幕位置 → client 坐标，手指按在车的正上方（世界 -y = 航向 -90°）
            const pt = await page.evaluate(() => {
                const c = document.getElementById('game-canvas'), r = c.getBoundingClientRect();
                const [lw, lh] = c.dataset.logical.split('x').map(Number);
                const k = window.__kart.view.kartScr;
                return { x: r.left + k.x / lw * r.width, y: r.top + (k.y - 110) / lh * r.height };
            });
            const cdp = await ctx.newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
            const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
            await expect.poll(async () => Math.abs(wrap((await st(page)).p1.h + Math.PI / 2)),
                { timeout: 2_500, intervals: [50] }).toBeLessThan(0.45);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            expect(errors).toEqual([]);
        } finally {
            await ctx.close();
        }
    });

    test('chase view: camera turns with the kart; stick right steers right, pull down reverses', async ({ browser }) => {
        const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        try {
            const errors = await startBot(page, 'easy', 'kart-chase', '&view=chase');
            await page.evaluate(() => { window.__kart.freezeBot(true); window.__kart.skipCountdown(); });
            await expect.poll(async () => (await st(page)).status).toBe('racing');
            await page.evaluate(() => window.__kart.place(1, 200, 0, 5));
            const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
            // 画布旋转 = -(车头 + 90°)：车头朝屏幕上方
            await expect.poll(async () => {
                const [v, s] = await Promise.all([page.evaluate(() => window.__kart.view), st(page)]);
                return Math.abs(wrap(v.rot + s.p1.h + Math.PI / 2));
            }, { timeout: 3_000 }).toBeLessThan(0.15);

            const box = await page.locator('#move-stick').boundingBox();
            if (!box) throw new Error('no stick');
            const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
            const cdp = await ctx.newCDPSession(page);
            const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
                type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }]
            });
            const h0 = (await st(page)).p1.h;
            await touch('touchStart', cx, cy);
            await touch('touchMove', cx + 30, cy);
            await touch('touchMove', cx + 60, cy);
            await page.waitForTimeout(400);
            // 屏幕坐标系 y 向下 → 右转 = 航向角增大；一直推着会一直转（相对转向）
            const turned = wrap((await st(page)).p1.h - h0);
            expect(turned).toBeGreaterThan(0.5);
            await touch('touchEnd');

            await page.evaluate(() => window.__kart.place(1, 200, 0, 0));
            await touch('touchStart', cx, cy);
            await touch('touchMove', cx, cy + 30);
            await touch('touchMove', cx, cy + 60);
            await expect.poll(async () => {
                const k = (await st(page)).p1;
                return k.vx * Math.cos(k.h) + k.vy * Math.sin(k.h);
            }, { timeout: 2_000, intervals: [50] }).toBeLessThan(-0.5);
            await touch('touchEnd');

            // 切换按钮 → 固定视角
            await page.locator('#view-btn').click();
            expect((await page.evaluate(() => window.__kart.view)).mode).toBe('north');
            await expect.poll(async () => (await page.evaluate(() => window.__kart.view)).rot).toBe(0);
            expect(errors).toEqual([]);
        } finally {
            await ctx.close();
        }
    });

    test('new items: bolt shrinks, ink splats, bomb blasts, star barges through, triple has 3 uses', async ({ page }) => {
        const errors = await startBot(page, 'easy', 'kart-items');
        await page.evaluate(() => { window.__kart.freezeBot(true); window.__kart.skipCountdown(); });
        await expect.poll(async () => (await st(page)).status).toBe('racing');
        const fire = async () => { await page.keyboard.down('Space'); await page.waitForTimeout(60); await page.keyboard.up('Space'); await page.waitForTimeout(60); };

        // ⚡ 闪电：对手缩小 + 短暂打转
        await page.evaluate(() => { window.__kart.place(1, 150, 0, 0); window.__kart.place(2, 900, 0, 0); window.__kart.give(1, 'bolt'); });
        await fire();
        await expect.poll(async () => (await st(page)).p2.zap).toBeGreaterThan(0);
        expect((await st(page)).p2.spin).toBeGreaterThan(0);

        // 🦑 墨汁
        await page.evaluate(() => { window.__kart.set(2, { zap: 0, spin: 0, inv: 0 }); window.__kart.give(1, 'ink'); });
        await fire();
        await expect.poll(async () => (await st(page)).p2.ink).toBeGreaterThan(0);

        // 💣 炸弹：往前扔，炸到前方的对手
        await page.evaluate(() => {
            window.__kart.set(2, { ink: 0, spin: 0, inv: 0 });
            window.__kart.place(1, 150, 0, 0); window.__kart.place(2, 320, 0, 0); window.__kart.give(1, 'bomb');
        });
        await fire();
        await expect.poll(async () => (await st(page)).bombs.length).toBe(1);
        await expect.poll(async () => (await st(page)).p2.spin, { timeout: 3_000 }).toBeGreaterThan(0);
        expect((await st(page)).bombs.length).toBe(0);

        // ⭐ 无敌星：香蕉无效，撞到对手 → 对手打转
        await page.evaluate(() => {
            window.__kart.set(2, { spin: 0, inv: 0, spinA: 0 });
            window.__kart.place(1, 150, 0, 0); window.__kart.place(2, 1200, 0, 0); window.__kart.give(1, 'star');
        });
        await fire();
        await expect.poll(async () => (await st(page)).p1.star).toBeGreaterThan(0);
        await page.evaluate(() => {
            const k = window.__kart.state.p1;      // the star dash has moved p1 on: park the rival just ahead of it
            window.__kart.place(2, k.prog + 30, 0, 0);
            window.__kart.set(2, { spin: 0, inv: 0 });
        });
        await expect.poll(async () => (await st(page)).p2.spin, { timeout: 2_000 }).toBeGreaterThan(0);
        expect((await st(page)).p1.spin).toBe(0);

        // 🍄×3：用三次才清空
        await page.evaluate(() => { window.__kart.set(1, { star: 0, item: 'triple', ic: 3 }); window.__kart.place(1, 150, 0, 0); });
        for (const left of [2, 1]) {
            await fire();
            await expect.poll(async () => (await st(page)).p1.ic).toBe(left);
            expect((await st(page)).p1.item).toBe('triple');
        }
        await fire();
        await expect.poll(async () => (await st(page)).p1.item).toBe(null);
        expect(errors).toEqual([]);
    });

    test('pvp: the client races on the course the host picked', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        try {
            await pageA.goto(dev.url + '/kart/#gs-kart-track');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/kart/#gs-kart-track');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen .track-btn').first()).toBeDisabled();
            await pageA.locator('#ready-screen .track-btn[data-track="2"]').click();
            await expect(pageB.locator('#ready-screen .track-btn[data-track="2"]')).toHaveClass(/active/, { timeout: 5_000 });
            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect.poll(async () => (await st(pageB)).track, { timeout: 5_000 }).toBe(2);
            expect((await pageB.evaluate(() => window.__kart.track)).id).toBe('snow');
            expect(errors).toEqual([]);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
