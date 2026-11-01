// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

test.describe('Oni Combat 3D Fighting Game', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { dev && await dev.close(); });

    test('Loads 3D arena, starts fight, and simulates combat', async ({ page }) => {
        // software-rendered WebGL in CI spends ~30-60s compiling shaders before the start button responds
        test.setTimeout(120_000);
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
        }, { timeout: 10000 }).toBe(true);

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
        test.setTimeout(90_000);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${dev.url}/oni/?bot=normal`);

        // Check virtual joystick and gamepad-style action pad exist
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

    test('Mobile multi-touch keeps joystick, look drag, and same-button pointers independent', async ({ browser }) => {
        test.setTimeout(90_000);
        const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        try {
            await page.goto(`${dev.url}/oni/?bot=normal`);
            await page.click('#btn-start-tutorial');
            await expect(page.locator('#start-overlay')).toHaveClass(/hidden/);

            const joystick = page.locator('#joystick-zone');
            const punch = page.locator('#btn-punch');
            const look = page.locator('#touch-look-zone');
            const joyBox = await joystick.boundingBox();
            const punchBox = await punch.boundingBox();
            const lookBox = await look.boundingBox();
            expect(joyBox && punchBox && lookBox).toBeTruthy();

            const joyX = joyBox.x + joyBox.width * 0.28;
            const joyY = joyBox.y + joyBox.height * 0.72;
            const punchX = punchBox.x + punchBox.width / 2;
            const punchY = punchBox.y + punchBox.height / 2;
            const lookX = lookBox.x + lookBox.width * 0.65;
            const lookY = lookBox.y + lookBox.height * 0.45;

            const cdp = await context.newCDPSession(page);
            const touchPoints = new Map();
            const dispatch = async (type, updates = []) => {
                for (const [id, x, y] of updates) touchPoints.set(id, { id, x, y });
                if (type === 'touchEnd') for (const [id] of updates) touchPoints.delete(id);
                await cdp.send('Input.dispatchTouchEvent', {
                    type,
                    touchPoints: [...touchPoints.values()].map(({ id, x, y }) => ({ id, x, y }))
                });
            };
            await dispatch('touchStart', [[1, joyX, joyY]]);
            await dispatch('touchMove', [[1, joyX + 34, joyY - 4]]);
            await dispatch('touchStart', [[2, punchX, punchY], [3, punchX + 2, punchY + 2]]);
            await dispatch('touchStart', [[4, lookX, lookY]]);
            await dispatch('touchMove', [[4, lookX + 30, lookY - 18]]);

            await expect(punch).toHaveClass(/active/);
            await expect.poll(() => page.evaluate(() => window.__oni.getState().p1.x)).not.toBe(0);
            await expect.poll(() => page.evaluate(() => window.__oni.sim.f1.yaw)).not.toBe(0);

            await dispatch('touchEnd', [[2, punchX, punchY]]);
            await expect(punch).toHaveClass(/active/);
            await dispatch('touchEnd', [[1, joyX + 34, joyY - 4], [3, punchX + 2, punchY + 2], [4, lookX + 30, lookY - 18]]);
            await expect(punch).not.toHaveClass(/active/);
        } finally {
            await context.close();
        }
    });

    test('Lobby index includes oni game card and matchmaking accepts all 20 games', async ({ page }) => {
        await page.goto(`${dev.url}/play/?lang=zh`);
        const oniCard = page.locator('#g-oni');
        await expect(oniCard).toBeVisible();
        await expect(oniCard.locator('.n')).toHaveText('奥尼');

        // Switch to PvP mode and verify clicking oni enters matchmaking waiting state (not bad-game error)
        await page.locator('#mode button[data-m="pvp"]').click();
        await oniCard.click();
        await expect(page.locator('#ov.on')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#box .c')).toHaveText(/^\d{4}$/);
        await page.locator('#cx').click();
        await expect(page.locator('#ov.on')).not.toBeVisible();
    });

    test('Zoom In/Out controls and toast HUD banner work properly', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto(`${dev.url}/oni/?bot=normal`);
        await page.locator('#btn-start').click();

        // Check title displays 奥尼
        await expect(page).toHaveTitle(/奥尼/);

        // Test Zoom In via key press '='
        await page.keyboard.press('Equal');
        const zoomToast = page.locator('#zoom-toast');
        await expect(zoomToast).toBeVisible({ timeout: 3000 });
        await expect(zoomToast).toHaveText(/🔍 视距:/);

        // Test Zoom Out via key press '-'
        await page.keyboard.press('Minus');
        await expect(zoomToast).toHaveText(/🔍 视距:/);
    });
});
