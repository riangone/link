const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server');

test.describe('Sports Games Touch Controls', () => {
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });

    const games = [
        { path: 'volley', room: 'v-touch', buttons: ['#jump-btn', '#spike-btn'] },
        { path: 'soccer', room: 's-touch', buttons: ['#dash-btn', '#kick-btn'] },
        { path: 'tennis', room: 't-touch', buttons: ['#lob-btn', '#hit-btn'] },
        { path: 'hoops',  room: 'h-touch', buttons: ['#steal-btn', '#shoot-btn'] }
    ];

    for (const g of games) {
        test(`${g.path} exposes virtual joystick and touch action buttons on mobile`, async ({ browser }) => {
            const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 420, height: 860 } });
            const page = await ctx.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(String(e)));

            try {
                await page.goto(`${dev.url}/${g.path}/?bot=easy&lang=zh#${g.room}-${Math.random().toString(36).slice(2, 6)}`);
                await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 10_000 });
                await page.locator('#start-btn').click();
                await expect(page.locator('#overlay')).toHaveClass(/hidden/, { timeout: 8_000 });

                // Touch controls box and analog stick must be visible on touch devices
                const touchBox = page.locator('#touch-controls');
                await expect(touchBox).toBeVisible();
                const stick = page.locator('#move-stick');
                await expect(stick).toBeVisible();

                // Game-specific action buttons must exist and be visible
                for (const sel of g.buttons) {
                    const btn = page.locator(sel);
                    await expect(btn).toBeVisible();
                    // Tap the button
                    await btn.tap();
                }

                // Drag the joystick
                const stickBox = await stick.boundingBox();
                expect(stickBox).not.toBeNull();
                const cx = stickBox.x + stickBox.width / 2;
                const cy = stickBox.y + stickBox.height / 2;

                await page.touchscreen.tap(cx, cy);
                expect(errors).toEqual([]);
            } finally {
                await ctx.close();
            }
        });
    }
});
