// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * "Tap a device -> pick a game -> opponent accepts -> both auto-join the
 * same room" (client/scripts/game-invite.js). No URL copy/paste involved.
 */
test.describe('game challenge from the device list', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function twoPeers(browser, room) {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        await pageA.goto(dev.url + '/#net-' + room);
        await pageB.goto(dev.url + '/#net-' + room);
        await expect(pageA.locator('x-peer')).toHaveCount(1, { timeout: 10_000 });
        await expect(pageB.locator('x-peer')).toHaveCount(1, { timeout: 10_000 });
        return { ctxA, ctxB, pageA, pageB };
    }

    test('accepting lands both sides in the same game room', async ({ browser }) => {
        const { ctxA, ctxB, pageA, pageB } = await twoPeers(browser, 'gi-accept');
        try {
            // The challenge button must not open the file picker.
            let chooserOpened = false;
            pageA.on('filechooser', () => { chooserOpened = true; });
            await pageA.locator('x-peer .peer-game-btn').click();
            await expect(pageA.locator('#gamePickerDialog')).toHaveAttribute('show', '1');
            await expect(pageA.locator('.game-picker-item')).toHaveCount(9);
            await expect(pageA.locator('.game-picker-item[data-game="blaster"]')).toBeVisible();
            await expect(pageA.locator('.game-picker-item[data-game="bombs"]')).toBeVisible();
            await pageA.locator('.game-picker-item[data-game="brawl"]').click();
            await expect(pageA.locator('.game-picker-waiting')).toBeVisible();

            await expect(pageB.locator('#gameInviteDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
            await expect(pageB.locator('#gameInviteBody')).toContainText('Mochi Brawl');
            await pageB.locator('#gameInviteAccept').click();

            await pageA.waitForURL(/\/brawl\/.*#room-/, { timeout: 5000 });
            await pageB.waitForURL(/\/brawl\/.*#room-/, { timeout: 5000 });
            const hashA = await pageA.evaluate(() => location.hash);
            const hashB = await pageB.evaluate(() => location.hash);
            expect(hashA).toBe(hashB);
            expect(chooserOpened).toBe(false);

            // ...and they actually pair inside the game (one host, one client).
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            const roles = [
                await pageA.locator('#role-status-text').textContent(),
                await pageB.locator('#role-status-text').textContent()
            ].sort();
            expect(roles).toEqual(['CLIENT', 'HOST']);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('declining notifies the challenger and nobody navigates', async ({ browser }) => {
        const { ctxA, ctxB, pageA, pageB } = await twoPeers(browser, 'gi-decline');
        try {
            await pageA.locator('x-peer .peer-game-btn').click();
            await pageA.locator('.game-picker-item[data-game="gomoku"]').click();
            await expect(pageB.locator('#gameInviteDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
            await pageB.locator('#gameInviteDecline').click();

            await expect(pageA.locator('#gamePickerDialog')).not.toHaveAttribute('show', '1', { timeout: 5000 });
            await expect(pageA.locator('#toast')).toContainText('declined', { timeout: 5000 });
            expect(new URL(pageA.url()).pathname).toBe('/');
            expect(new URL(pageB.url()).pathname).toBe('/');
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('cancelling closes the prompt on the other side', async ({ browser }) => {
        const { ctxA, ctxB, pageA, pageB } = await twoPeers(browser, 'gi-cancel');
        try {
            await pageA.locator('x-peer .peer-game-btn').click();
            await pageA.locator('.game-picker-item[data-game="hockey"]').click();
            await expect(pageB.locator('#gameInviteDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
            await pageA.locator('#gamePickerCancel').click();
            await expect(pageB.locator('#gameInviteDialog')).not.toHaveAttribute('show', '1', { timeout: 5000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
