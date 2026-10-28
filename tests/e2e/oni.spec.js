// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

test.describe('Oni Combat 3D Fighting Game', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { dev && await dev.close(); });

    test('Loads 3D arena, starts fight, and simulates combat', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));

        await page.goto(`${dev.url}/oni/?bot=normal`);

        // Check modal is visible
        const startBtn = page.locator('#btn-start');
        await expect(startBtn).toBeVisible({ timeout: 5000 });

        // Click start
        await startBtn.click();
        await expect(page.locator('#start-overlay')).toHaveClass(/hidden/);

        // Verify canvas exists and is rendering
        const canvas = page.locator('#canvas-container canvas');
        await expect(canvas).toBeVisible();

        // Check initial state
        await expect.poll(async () => {
            return await page.evaluate(() => window.__oni && window.__oni.getState().isPlaying);
        }, { timeout: 3000 }).toBe(true);

        // Press 'KeyJ' to attack (Jab)
        await page.keyboard.press('KeyJ');

        // Let simulation run for 1.5 seconds while bot and player engage
        await page.waitForTimeout(1500);

        const state = await page.evaluate(() => window.__oni.getState());
        expect(state.isPlaying).toBe(true);
        expect(state.p1.hp).toBeGreaterThan(0);
        expect(state.p2.hp).toBeGreaterThan(0);

        // Verify no uncaught browser runtime errors occurred
        expect(errors).toEqual([]);
    });

    test('Mobile view renders virtual joystick, arcade buttons, and toggles move list', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${dev.url}/oni/?bot=normal`);

        // Check virtual joystick and arcade action buttons exist
        await expect(page.locator('#joystick-zone')).toBeVisible();
        await expect(page.locator('#btn-punch')).toBeVisible();
        await expect(page.locator('#btn-kick')).toBeVisible();
        await expect(page.locator('#btn-slide')).toBeVisible();
        await expect(page.locator('#btn-block')).toBeVisible();

        // Start fight
        await page.click('#btn-start');
        await expect(page.locator('#start-overlay')).toHaveClass(/hidden/);

        // Toggle move list modal
        const toggleBtn = page.locator('#btn-toggle-moves');
        await expect(toggleBtn).toBeVisible();
        await toggleBtn.click();
        await expect(page.locator('#moves-panel')).toHaveClass(/open/);

        // Close move list modal
        await toggleBtn.click();
        await expect(page.locator('#moves-panel')).not.toHaveClass(/open/);

        // Test touch virtual punch button
        await page.locator('#btn-punch').dispatchEvent('pointerdown');
        await page.waitForTimeout(50);
        await page.locator('#btn-punch').dispatchEvent('pointerup');

        // Test touch slide button
        await page.locator('#btn-slide').dispatchEvent('pointerdown');
        await page.waitForTimeout(50);
        await page.locator('#btn-slide').dispatchEvent('pointerup');

        const state = await page.evaluate(() => window.__oni.getState());
        expect(state.isPlaying).toBe(true);
    });

    test('Lobby index includes oni game card', async ({ page }) => {
        await page.goto(`${dev.url}/play/`);
        const oniCard = page.locator('#g-oni');
        await expect(oniCard).toBeVisible();
    });
});
