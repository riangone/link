// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * End-to-end coverage for the opt-in public-device directory (server/index.js
 * `_publicDevices` + client friends.js `visible`/`_publicDevices` +
 * friends-ui.js visibility toggle + "Nearby public devices" list): unlike
 * friends.spec.js (which requires exchanging a deviceId out-of-band first),
 * this is the "default discoverable, opt out if you want privacy" path —
 * two peers in different rooms/networks should see each other in the
 * directory with *no* prior deviceId exchange, be able to invite each other
 * from there, and a peer that turns visibility off must disappear from the
 * other side's list.
 */

test.describe('public device directory (default-visible, opt-out)', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;

    test.beforeAll(async () => {
        dev = await startDevServer();
    });

    test.afterAll(async () => {
        await dev.close();
    });

    test('two peers in different rooms see each other in the public directory by default, with no deviceId shared', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '#pub-net-A');
            await pageB.goto(dev.url + '#pub-net-B');

            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            // default visibility is "on" for both — no addFriend/inviteFriend call anywhere here
            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);
            await expect.poll(
                () => pageA.evaluate(() => window.friendsManager.listPublicDevices().map(d => d.deviceId)),
                { timeout: 5000 }
            ).toContain(deviceIdB);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('inviting a device discovered via the public directory pairs them as a normal peer, without ever adding as a friend first', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '#pub-net-C');
            await pageB.goto(dev.url + '#pub-net-D');
            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);
            await expect.poll(
                () => pageA.evaluate(() => window.friendsManager.listPublicDevices().map(d => d.deviceId)),
                { timeout: 5000 }
            ).toContain(deviceIdB);

            // was never added as a friend beforehand — purely from the public listing
            const wasFriend = await pageA.evaluate(id => window.friendsManager.listFriends().some(f => f.deviceId === id), deviceIdB);
            expect(wasFriend).toBe(false);

            const inviteResult = await pageA.evaluate(id => window.friendsManager.invitePublicDevice(id), deviceIdB);
            expect(inviteResult).toBe('sent');

            await expect(pageB.locator('#friendInviteDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
            await pageB.locator('#friendInviteAccept').click();

            await expect(pageB.locator('x-peer')).toHaveCount(1, { timeout: 5000 });
            await expect(pageA.locator('x-peer')).toHaveCount(1, { timeout: 5000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('turning visibility off removes the device from the other side\'s directory (real removal, not a client-side hide)', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '#pub-net-E');
            await pageB.goto(dev.url + '#pub-net-F');
            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);
            await expect.poll(
                () => pageA.evaluate(() => window.friendsManager.listPublicDevices().map(d => d.deviceId)),
                { timeout: 5000 }
            ).toContain(deviceIdB);

            // B goes private
            await pageB.evaluate(() => window.friendsManager.setVisibility(false));

            await expect.poll(
                () => pageA.evaluate(() => window.friendsManager.listPublicDevices().map(d => d.deviceId)),
                { timeout: 5000 }
            ).not.toContain(deviceIdB);

            // and a fresh snapshot request confirms it's gone server-side too, not just client-side filtered
            await pageA.evaluate(() => window.friendsManager.requestPublicDevices());
            await expect.poll(
                () => pageA.evaluate(() => window.friendsManager.listPublicDevices().map(d => d.deviceId)),
                { timeout: 5000 }
            ).not.toContain(deviceIdB);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('the visibility toggle in the Friends drawer reflects and controls the same state', async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();

        try {
            await page.goto(dev.url + '#pub-net-ui');
            await page.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            await page.locator('#friends-toggle').click();
            await expect(page.locator('#friendsCenter')).toHaveClass(/show/);

            const toggle = page.locator('#friendsVisibilityToggle');
            await expect(toggle).toBeChecked(); // default on

            await toggle.uncheck();
            await expect.poll(() => page.evaluate(() => window.friendsManager.visible)).toBe(false);

            await toggle.check();
            await expect.poll(() => page.evaluate(() => window.friendsManager.visible)).toBe(true);
        } finally {
            await ctx.close();
        }
    });
});
