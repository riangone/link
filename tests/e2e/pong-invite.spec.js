// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * End-to-end coverage for "invite a friend to a Pong match" (friends.js
 * `invitePongMatch`/`acceptInvite` + friends-ui.js `_onPongMatchReady`):
 * two browsers on different rooms/networks, already paired as friends
 * (deviceId-based, see friends.spec.js), should be able to jump straight
 * into the *same* Pong room without either side ever copy-pasting a URL —
 * the roomId travels inside the existing invite/invite-response handshake
 * and both sides navigate to `pong/#room-<roomId>` once accepted.
 */

test.describe('friend-to-Pong matchmaking', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;

    test.beforeAll(async () => {
        dev = await startDevServer();
    });

    test.afterAll(async () => {
        await dev.close();
    });

    test('inviting a friend to Pong shows a Pong-specific prompt and lands both sides on the same room', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/#net-pong-A');
            await pageB.goto(dev.url + '/#net-pong-B');

            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);
            await pageA.evaluate(id => window.friendsManager.addFriend(id), deviceIdB);

            const inviteResult = await pageA.evaluate(id => window.friendsManager.invitePongMatch(id), deviceIdB);
            expect(inviteResult).toBe('sent');

            // B gets the incoming-invite dialog, worded for a Pong match
            // rather than the generic "wants to connect" body.
            await expect(pageB.locator('#friendInviteDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
            await expect(pageB.locator('#friendInviteBody')).toContainText('Pong', { timeout: 5000 });

            await pageB.locator('#friendInviteAccept').click();

            // Both sides should navigate to the same pong/#room-<id> URL —
            // nobody had to share/copy a link for it to match up. (The
            // redirect also carries a `?opponent=<name>` query param, so
            // the room hash is not immediately adjacent to "/pong/".)
            await pageA.waitForURL(/\/pong\/.*#room-/, { timeout: 5000 });
            await pageB.waitForURL(/\/pong\/.*#room-/, { timeout: 5000 });

            const hashA = await pageA.evaluate(() => location.hash);
            const hashB = await pageB.evaluate(() => location.hash);
            expect(hashA).toBe(hashB);
            expect(hashA).toMatch(/^#room-/);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('mutual friends skip the confirm dialog and drop straight into the same room', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/#net-pong-mutual-A');
            await pageB.goto(dev.url + '/#net-pong-mutual-B');

            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            const deviceIdA = await pageA.evaluate(() => window.friendsManager.deviceId);
            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);
            // Friendship established on *both* sides — this is the trust
            // check the auto-start path relies on, unlike the one-way case
            // above which still needs a human to click Accept.
            await pageA.evaluate(id => window.friendsManager.addFriend(id), deviceIdB);
            await pageB.evaluate(id => window.friendsManager.addFriend(id), deviceIdA);

            const inviteResult = await pageA.evaluate(id => window.friendsManager.invitePongMatch(id), deviceIdB);
            expect(inviteResult).toBe('sent');

            // No confirmation dialog on B's side — the match starts itself
            // and navigates away before a human ever could have clicked
            // Accept; by the time we get here the dialog markup is gone
            // along with the rest of the pre-navigation page.
            await pageA.waitForURL(/\/pong\/.*#room-/, { timeout: 5000 });
            await pageB.waitForURL(/\/pong\/.*#room-/, { timeout: 5000 });

            const hashA = await pageA.evaluate(() => location.hash);
            const hashB = await pageB.evaluate(() => location.hash);
            expect(hashA).toBe(hashB);
            expect(hashA).toMatch(/^#room-/);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
