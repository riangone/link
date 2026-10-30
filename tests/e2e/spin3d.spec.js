// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

test.describe('Link Spin 3D - Full 3D Beyblade Combat', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { dev && await dev.close(); });

    test('Loads 3D stadium, launches tops, simulates 3D battle & camera controls', async ({ page }) => {
        test.setTimeout(120000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));

        await page.goto(`${dev.url}/spin3d/?bot=normal`);

        // Check canvas container and launch overlay
        const canvas = page.locator('#canvas-container canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });

        const launchOverlay = page.locator('#launch-overlay');
        await expect(launchOverlay).toBeVisible();

        const launchBtn = page.locator('#launch-btn');
        await expect(launchBtn).toBeVisible();

        // Check camera toggle button (Defaults to 2.5D Top-Down overview for complete arena visibility)
        const btnCamera = page.locator('#btn-camera');
        await expect(btnCamera).toBeVisible();
        await expect(page.locator('#btn-camera-text')).toHaveText(/俯瞰|Top-Down|見下ろし/);
        await btnCamera.click({ force: true });
        await expect(page.locator('#btn-camera-text')).toHaveText(/自由|Orbit/);
        await btnCamera.click({ force: true });
        await expect(page.locator('#btn-camera-text')).toHaveText(/动作|Action/);
        await btnCamera.click({ force: true });
        await expect(page.locator('#btn-camera-text')).toHaveText(/俯瞰|Top-Down|見下ろし/);

        // Check top selection modal
        const btnCore = page.locator('#btn-core');
        await btnCore.click({ force: true });
        const selectModal = page.locator('#select-modal');
        await expect(selectModal).toBeVisible();

        // Select Zephyr Wing (Stamina)
        const coreCards = page.locator('.core-card');
        await expect(coreCards.first()).toBeVisible();
        await page.locator('.core-card', { hasText: 'ZEPHYR WING' }).click({ force: true });
        await page.locator('#btn-confirm-top').click({ force: true });
        await expect(selectModal).toHaveClass(/hidden/);
        await expect(page.locator('#p1-core-name')).toHaveText('ZEPHYR WING');

        // Launch Top
        await launchBtn.click({ force: true });
        await expect(launchOverlay).toHaveClass(/hidden/);

        // Fast-forward countdown
        await page.evaluate(() => window.__spin3d && window.__spin3d.skipCountdown());

        // Verify Battle Phase
        await expect.poll(async () => {
            return await page.evaluate(() => window.__spin3d && window.__spin3d.getState().phase);
        }, { timeout: 5000 }).toBe('battle');

        // Verify initial 3D positions and spin RPM
        const initialState = await page.evaluate(() => window.__spin3d.getState());
        expect(initialState.p1.spin).toBeGreaterThan(60);
        expect(initialState.p2.spin).toBeGreaterThan(60);
        expect(initialState.p1.burstHp).toBeGreaterThan(0);
        expect(initialState.p2.burstHp).toBeGreaterThan(0);

        // Run simulation for 2.5 seconds as tops spiral, clash, and bot AI reacts
        await page.waitForTimeout(2500);

        const battleState = await page.evaluate(() => window.__spin3d.getState());
        expect(battleState.p1.status === 'spinning' || battleState.p1.status === 'bursted' || battleState.p1.status === 'over').toBe(true);
        expect(battleState.p2.status === 'spinning' || battleState.p2.status === 'bursted' || battleState.p2.status === 'over').toBe(true);

        // Verify bot actively moved towards center or opponent
        const distFromSpawn = Math.hypot(battleState.p2.x - 16.0, battleState.p2.z - 0);
        expect(distFromSpawn).toBeGreaterThan(0.5);

        // Confirm zero JavaScript runtime errors
        expect(errors).toEqual([]);
    });

    test('X-DASH rail engagement and 3D burst finish resolution', async ({ page }) => {
        test.setTimeout(120000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));

        await page.goto(`${dev.url}/spin3d/?bot=hard`);
        await expect(page.locator('#canvas-container canvas')).toBeVisible({ timeout: 10000 });

        // Launch and skip countdown
        await page.evaluate(() => {
            window.__spin3d.launch(1.0, true);
            window.__spin3d.skipCountdown();
        });

        await expect.poll(async () => {
            return await page.evaluate(() => window.__spin3d.getState().phase);
        }).toBe('battle');

        // Trigger special attack on P1
        await page.evaluate(() => {
            window.__spin3d.t1.specialGauge = 100;
            window.__spin3d.triggerSpecial();
        });

        const stateAfterSpecial = await page.evaluate(() => window.__spin3d.getState());
        expect(stateAfterSpecial.p1.burstHp).toBeGreaterThan(0);

        // Force a collision by moving tops into contact and checking impact
        await page.evaluate(() => {
            window.__spin3d.t1.x = 0;
            window.__spin3d.t1.z = 0;
            window.__spin3d.t1.vx = 10;
            window.__spin3d.t2.x = 2;
            window.__spin3d.t2.z = 0;
            window.__spin3d.t2.vx = -10;
        });

        await page.waitForTimeout(500);

        const clashState = await page.evaluate(() => window.__spin3d.getState());
        // Both tops should have experienced physics collision (burstHp lowered or velocity changed)
        expect(clashState.p1.burstHp + clashState.p2.burstHp).toBeLessThan(200);

        expect(errors).toEqual([]);
    });
});
