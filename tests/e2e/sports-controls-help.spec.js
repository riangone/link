const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server');

test.describe('Sports Games Controls & Help Manual', () => {
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });

    const games = [
        { path: 'volley', title: 'VOLLEY' },
        { path: 'soccer', title: 'SOCCER' },
        { path: 'tennis', title: 'TENNIS' },
        { path: 'hoops',  title: 'HOOPS' }
    ];

    for (const g of games) {
        test(`${g.path} displays desktop controls HUD, briefing card, and functional help modal`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', e => errors.push(String(e)));

            // 1. Visit game on desktop viewport
            await page.setViewportSize({ width: 1024, height: 768 });
            await page.goto(`${dev.url}/${g.path}/?bot=easy&lang=zh#manual-test-${Math.random().toString(36).slice(2, 6)}`);

            // 2. Ready screen shows the tactical briefing card
            const readyScreen = page.locator('#ready-screen');
            await expect(readyScreen).toBeVisible({ timeout: 10_000 });

            const briefing = readyScreen.locator('.briefing-card');
            await expect(briefing).toBeVisible();
            await expect(briefing.locator('.briefing-tag')).toHaveText('🎮 作战操控速查');

            // 3. Test opening help modal via briefing card button
            const manualBtn = briefing.locator('.btn-briefing-help');
            await expect(manualBtn).toBeVisible();
            await manualBtn.click();

            const modal = page.locator('#controls-modal');
            await expect(modal).toBeVisible();
            await expect(modal.locator('.modal-title')).toHaveText('机甲竞技操控指南');

            // Test tab switching
            const touchTabBtn = modal.locator('.tab-btn[data-tab="tab-touch"]');
            await touchTabBtn.click();
            await expect(touchTabBtn).toHaveClass(/active/);
            await expect(modal.locator('#pane-tab-touch')).toBeVisible();

            const rulesTabBtn = modal.locator('.tab-btn[data-tab="tab-rules"]');
            await rulesTabBtn.click();
            await expect(rulesTabBtn).toHaveClass(/active/);
            await expect(modal.locator('#pane-tab-rules')).toBeVisible();

            // Test closing modal
            const closeBtn = modal.locator('#close-help-btn');
            await closeBtn.click();
            await expect(modal).toHaveClass(/hidden/);

            // 4. Test opening help modal via header #help-btn
            const headerHelpBtn = page.locator('#help-btn');
            await expect(headerHelpBtn).toBeVisible();
            await headerHelpBtn.click();
            await expect(modal).toBeVisible();

            // Close via ok button
            await modal.locator('#modal-ok-btn').click();
            await expect(modal).toHaveClass(/hidden/);

            // 5. Start match
            await page.locator('#start-btn').click();
            await expect(page.locator('#overlay')).toHaveClass(/hidden/, { timeout: 8_000 });

            // 6. Desktop HUD bar must be visible during match
            const hudBar = page.locator('#desktop-hud-bar');
            await expect(hudBar).toBeVisible();

            // 7. Test live keypress feedback: pressing Space should highlight kbd[data-key="space"]
            const spaceKbd = hudBar.locator('kbd[data-key="space"]');
            if (await spaceKbd.count() > 0) {
                await page.keyboard.down(' ');
                await expect(spaceKbd).toHaveClass(/active-key/);
                await page.keyboard.up(' ');
                await expect(spaceKbd).not.toHaveClass(/active-key/);
            }

            // 8. Round-start toast must have triggered or be visible
            const toast = page.locator('#game-toast');
            // Toast exists in DOM and contains text
            const text = await toast.textContent();
            expect(text.length).toBeGreaterThan(5);

            expect(errors).toEqual([]);
        });
    }
});
