// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Full-screen layout + touch controls (client/scripts/game-fit.js).
 *  - every game fills a phone screen without page scrolling;
 *  - landscape playfields rotate on a portrait phone (tanks), the portrait
 *    hockey table rotates on a landscape desktop;
 *  - touch controls: tanks joystick is mapped through the rotation, gomoku
 *    needs a confirming second tap on touch screens.
 */
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const GAMES = ['pong', 'gomoku', 'hockey', 'tanks', 'brawl', 'tron', 'blaster', 'blocks', 'bombs', 'tag', 'paint', 'kart', 'spin', 'armor', 'volley', 'soccer', 'tennis', 'hoops'];

test.describe('GameFit layout', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    const st = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__bot.state())));

    async function start(page, game) {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/${game}/?bot=easy#fit-test`);
        if (!['blaster', 'tag', 'paint'].includes(game)) { // the FPS games' bot mode starts by itself
            await expect(page.locator('#start-btn')).toBeVisible({ timeout: 5_000 });
            await page.locator('#start-btn').click();
        }
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        return errors;
    }

    test('every game fills a portrait phone without page scrolling', async ({ browser }) => {
        const ctx = await browser.newContext(PHONE);
        for (const game of GAMES) {
            const page = await ctx.newPage();
            const errors = await start(page, game);
            await page.waitForTimeout(300);
            const m = await page.evaluate(() => {
                const c = document.getElementById('game-canvas');
                const r = c.getBoundingClientRect();
                return { w: r.width, h: r.height, px: c.width, vw: innerWidth, vh: innerHeight,
                    scroll: document.documentElement.scrollHeight, bottom: r.bottom };
            });
            expect(m.scroll, game).toBeLessThanOrEqual(m.vh);
            expect(m.bottom, game).toBeLessThanOrEqual(m.vh);
            expect(m.w, game).toBeGreaterThan(m.vw * 0.85);           // uses the screen width
            expect(m.px, game).toBeGreaterThanOrEqual(Math.round(m.w * 1.9)); // hi-DPI backing store
            expect(errors, game).toEqual([]);
            await page.close();
        }
        await ctx.close();
    });

    test('tanks rotates on a portrait phone and the joystick follows the screen', async ({ browser }) => {
        const ctx = await browser.newContext(PHONE);
        const page = await ctx.newPage();
        const errors = await start(page, 'tanks');
        await expect(page.locator('#game-canvas')).toHaveAttribute('data-rotation', '-90');
        const c = await page.locator('#game-canvas').boundingBox();
        expect(c.height).toBeGreaterThan(c.width);

        // wait for the round banner to clear, then push the stick straight up
        await expect.poll(async () => (await st(page)).roundBannerTimer || 0, { timeout: 5_000 }).toBe(0);
        const x0 = (await st(page)).p1.x;
        const stick = await page.locator('#move-stick').boundingBox();
        const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
        await page.locator('#move-stick').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, isPrimary: true, buttons: 1 });
        await page.locator('#move-stick').dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy - 60, isPrimary: true, buttons: 1 });
        await page.waitForTimeout(500);
        await page.locator('#move-stick').dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy - 60, isPrimary: true });
        const s = await st(page);
        // host is drawn at the bottom (rotated -90°): "up" on screen = +x in the world
        expect(s.p1.x).toBeGreaterThan(x0 + 30);
        expect(errors).toEqual([]);
        await ctx.close();
    });

    test('hockey table turns sideways on a landscape desktop', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 860 });
        await start(page, 'hockey');
        await expect(page.locator('#game-canvas')).toHaveAttribute('data-rotation', /^-?90$/);
        const c = await page.locator('#game-canvas').boundingBox();
        expect(c.width).toBeGreaterThan(c.height);
        expect(c.height).toBeGreaterThan(600);
    });

    test('gomoku on touch: first tap previews, second tap on the same point places', async ({ browser }) => {
        const ctx = await browser.newContext(PHONE);
        const page = await ctx.newPage();
        const errors = await start(page, 'gomoku');
        const c = await page.locator('#game-canvas').boundingBox();
        const tap = () => page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2); // centre = (7,7)
        await tap();
        await page.waitForTimeout(250);
        expect((await st(page)).board[7][7]).toBe(0);
        await tap();
        await expect.poll(async () => (await st(page)).board[7][7]).toBe(1);
        expect(errors).toEqual([]);
        await ctx.close();
    });
});
