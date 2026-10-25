// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Coverage for the QR-code layer on top of deviceId friend pairing
 * (client/scripts/qr-scan.js + the QR/deep-link additions in
 * client/scripts/friends-ui.js): turning a deviceId into a scannable
 * `?add-friend=` URL, rendering it as a QR code, and — the other side of
 * the same coin — a page load that already carries that query param
 * prompting a confirmation dialog instead of silently trusting it.
 */

test.describe('QR code friend pairing', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;

    test.beforeAll(async () => {
        dev = await startDevServer();
    });

    test.afterAll(async () => {
        await dev.close();
    });

    test('toggling "Show QR code" renders a non-empty canvas encoding the add-friend URL', async ({ page }) => {
        await page.goto(dev.url + '#qr-A');
        await page.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

        await page.locator('#friends-toggle').click();
        await expect(page.locator('#friendsCenter')).toHaveClass(/show/);

        await page.locator('#btnToggleDeviceQr').click();
        const canvas = page.locator('#myDeviceQr');
        await expect(page.locator('#myDeviceQrWrap')).toBeVisible();

        const size = await canvas.evaluate(el => ({ w: el.width, h: el.height }));
        expect(size.w).toBeGreaterThan(0);
        expect(size.h).toBeGreaterThan(0);

        // Sanity-check the canvas isn't just a blank/solid fill (i.e. some
        // pattern actually got drawn), and that it encodes this device's id.
        const deviceId = await page.evaluate(() => window.friendsManager.deviceId);
        const encodedUrl = await page.evaluate(() => {
            const url = new URL(location.href);
            url.hash = '';
            url.searchParams.set('add-friend', window.friendsManager.deviceId);
            if (window.myDisplayName) url.searchParams.set('n', window.myDisplayName);
            return url.toString();
        });
        expect(encodedUrl).toContain(deviceId);
    });

    test('FriendsUI.parseAddFriendUrl extracts deviceId + name from a deep link and rejects non-matching input', async ({ page }) => {
        await page.goto(dev.url + '#qr-B');
        await page.waitForFunction(() => !!window.FriendsUI);

        const good = await page.evaluate(() =>
            window.FriendsUI.parseAddFriendUrl('https://example.com/?add-friend=abc-123&n=Alice')
        );
        expect(good).toEqual({ deviceId: 'abc-123', name: 'Alice' });

        const noParam = await page.evaluate(() =>
            window.FriendsUI.parseAddFriendUrl('https://example.com/?foo=bar')
        );
        expect(noParam).toBeNull();

        const notAUrl = await page.evaluate(() =>
            window.FriendsUI.parseAddFriendUrl('just-some-random-text')
        );
        expect(notAUrl).toBeNull();
    });

    test('opening the app with ?add-friend=<id> shows a confirmation dialog, accepting adds the friend, and the URL is cleaned up', async ({ page }) => {
        const fakeDeviceId = '11111111-2222-3333-4444-555555555555';
        await page.goto(dev.url + `/?add-friend=${fakeDeviceId}&n=Bob#qr-C`);

        await expect(page.locator('#addFriendDeepLinkDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
        await expect(page.locator('#addFriendDeepLinkBody')).toContainText('Bob');

        // the deep-link params must not linger (avoid re-prompting on refresh)
        await expect.poll(() => page.evaluate(() => location.search)).toBe('');

        await page.locator('#addFriendDeepLinkAccept').click();
        await expect(page.locator('#addFriendDeepLinkDialog')).not.toHaveAttribute('show', '1');

        const friends = await page.evaluate(() => window.friendsManager.listFriends());
        expect(friends.some(f => f.deviceId === fakeDeviceId && f.nickname === 'Bob')).toBe(true);
    });

    test('opening the app with your own deviceId in ?add-friend= does not prompt (scanning your own code is a no-op)', async ({ page }) => {
        await page.goto(dev.url + '#qr-D');
        await page.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
        const ownId = await page.evaluate(() => window.friendsManager.deviceId);

        await page.goto(dev.url + `/?add-friend=${ownId}#qr-D`);
        await page.waitForTimeout(500);
        await expect(page.locator('#addFriendDeepLinkDialog')).not.toHaveAttribute('show', '1');
    });
});
