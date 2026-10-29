// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

test.describe('Oni Combat 3D Fighting Game', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { dev && await dev.close(); });

    test('Loads 3D arena, starts fight, and simulates combat', async ({ page }) => {
        // software-rendered WebGL in CI spends ~20s compiling shaders before the start button responds
        test.setTimeout(60000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));

        await page.goto(`${dev.url}/oni/?bot=normal`);

        // Check modal is visible & difficulty selector works
        const startBtn = page.locator('#btn-start');
        await expect(startBtn).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#difficulty-selector')).toBeVisible();
        await page.locator('.diff-btn[data-diff="easy"]').click();

        // Click start
        await startBtn.click();
        await expect(page.locator('#start-overlay')).toHaveClass(/hidden/);

        // Verify canvas, difficulty pill, and fullscreen pill exist
        const canvas = page.locator('#canvas-container canvas');
        await expect(canvas).toBeVisible();
        await expect(page.locator('#btn-difficulty')).toBeVisible();
        const fsBtn = page.locator('#btn-fullscreen');
        await expect(fsBtn).toBeVisible();

        // Test Fullscreen toggle button (activates native fullscreen or pseudo-fullscreen fallback in headless Chromium)
        await fsBtn.click();
        await expect(page.locator('#btn-fullscreen-text')).toHaveText('退出全屏');
        await fsBtn.click();
        await expect(page.locator('#btn-fullscreen-text')).toHaveText('全屏');

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
        expect(state.isMultiplayer).toBe(false);
        expect(state.p1.hp).toBeGreaterThan(0);
        expect(state.p2.hp).toBeGreaterThan(0);
        // Verify Bot AI actively moved from its initial spawn (x = 2.6) or acted
        expect(Math.abs(state.p2.x - 2.6)).toBeGreaterThan(0.05);

        // Verify no uncaught browser runtime errors occurred
        expect(errors).toEqual([]);
    });

    test('Mobile view renders virtual joystick, arcade buttons, and toggles move list', async ({ page }) => {
        test.setTimeout(60000);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${dev.url}/oni/?bot=normal`);

        // Check virtual joystick and expanded 9-button arcade action pad exist
        await expect(page.locator('#joystick-zone')).toBeVisible();
        await expect(page.locator('#btn-jump')).toBeVisible();
        await expect(page.locator('#btn-evade')).toBeVisible();
        await expect(page.locator('#btn-special')).toBeVisible();
        await expect(page.locator('#btn-throw')).toBeVisible();
        await expect(page.locator('#btn-fire')).toBeVisible();
        await expect(page.locator('#btn-punch')).toBeVisible();
        await expect(page.locator('#btn-kick')).toBeVisible();
        await expect(page.locator('#btn-slide')).toBeVisible();
        await expect(page.locator('#btn-block')).toBeVisible();

        // Start TCTF Training Dojo first, verify Shinatama comms banner & highlighted button, then switch to Campaign Ch.1
        await page.click('#btn-start-tutorial');
        await expect(page.locator('#start-overlay')).toHaveClass(/hidden/);
        await expect(page.locator('#comms-banner')).toBeVisible();
        await expect(page.locator('#comms-title')).toContainText('第 1 课');

        const dojoState = await page.evaluate(() => window.__oni.getState());
        expect(dojoState.stageType).toBe('INDOOR_FLAT');
        expect(dojoState.stageMode).toBe('INDOOR_DOJO');

        // Open mode menu and start Story Campaign Ch.1
        await page.click('#btn-menu');
        await expect(page.locator('#start-overlay')).not.toHaveClass(/hidden/);
        await page.click('#btn-start-campaign');
        await expect(page.locator('#start-overlay')).toHaveClass(/hidden/);
        await expect(page.locator('#comms-title')).toContainText('CH.1');

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

    test('Lobby index includes oni game card and matchmaking accepts all 20 games', async ({ page }) => {
        await page.goto(`${dev.url}/play/?lang=zh`);
        const oniCard = page.locator('#g-oni');
        await expect(oniCard).toBeVisible();

        // Switch to PvP mode and verify clicking oni enters matchmaking waiting state (not bad-game error)
        await page.locator('#mode button[data-m="pvp"]').click();
        await oniCard.click();
        await expect(page.locator('#ov.on')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#box .c')).toHaveText(/^\d{4}$/);
        await page.locator('#cx').click();
        await expect(page.locator('#ov.on')).not.toBeVisible();
    });
});
