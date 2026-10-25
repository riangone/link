// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * End-to-end coverage for the deviceId-based friend pairing feature
 * (server/index.js bind-device/find-device/global relay + client
 * friends.js/friends-ui.js): two browser contexts placed in *different*
 * rooms (simulating two different networks that would never otherwise see
 * each other via the normal same-room `peers`/`peer-joined` discovery)
 * must still be able to find and connect to each other purely by
 * exchanging their persistent deviceId.
 */

test.describe('deviceId friend pairing across rooms', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;

    test.beforeAll(async () => {
        dev = await startDevServer();
    });

    test.afterAll(async () => {
        await dev.close();
    });

    test('two peers in different rooms never see each other as ordinary x-peer discovery', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '#net-A');
            await pageB.goto(dev.url + '#net-B');
            await pageA.waitForTimeout(500);
            await pageB.waitForTimeout(500);

            await expect(pageA.locator('x-peer')).toHaveCount(0);
            await expect(pageB.locator('x-peer')).toHaveCount(0);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('inviting a friend by deviceId across rooms pairs them as a normal peer on both sides', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '#net-A');
            await pageB.goto(dev.url + '#net-B');

            // wait until each page's FriendsManager has a stable deviceId
            // and has bound it with the server (fires on 'ws-connected')
            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);

            // A adds B as a friend and invites them, purely by deviceId —
            // no room/URL sharing involved
            await pageA.evaluate(id => window.friendsManager.addFriend(id), deviceIdB);
            const inviteResult = await pageA.evaluate(id => window.friendsManager.inviteFriend(id), deviceIdB);
            expect(inviteResult).toBe('sent');

            // B should see the incoming-invite dialog...
            await expect(pageB.locator('#friendInviteDialog')).toHaveAttribute('show', '1', { timeout: 5000 });

            // ...and accepting it should make A show up as a normal x-peer on B's screen
            await pageB.locator('#friendInviteAccept').click();
            await expect(pageB.locator('x-peer')).toHaveCount(1, { timeout: 5000 });

            // A, who initiated, should likewise now see B as a normal x-peer
            await expect(pageA.locator('x-peer')).toHaveCount(1, { timeout: 5000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('declining an invite notifies the inviter and does not create a peer card', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '#net-A2');
            await pageB.goto(dev.url + '#net-B2');
            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);
            await pageA.evaluate(id => window.friendsManager.inviteFriend(id), deviceIdB);

            await expect(pageB.locator('#friendInviteDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
            await pageB.locator('#friendInviteDecline').click();

            await expect(pageA.locator('.toast-container x-toast')).toContainText('declined', { timeout: 5000 });
            await expect(pageA.locator('x-peer')).toHaveCount(0);
            await expect(pageB.locator('x-peer')).toHaveCount(0);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
