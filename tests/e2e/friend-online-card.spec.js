// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * End-to-end coverage for the home-screen "friend is online" card
 * (friends.js background presence poll + friends-ui.js
 * `_renderOnlinePeers`): an online friend should show up as an
 * `<x-friend-peer>` card directly on the main page — no need to open the
 * Friends drawer first — and clicking its "Invite to Pong" action should
 * drive the exact same matchmaking handshake as the button inside the
 * drawer (see pong-invite.spec.js).
 */

test.describe('home-screen online-friend card', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;

    test.beforeAll(async () => {
        dev = await startDevServer();
    });

    test.afterAll(async () => {
        await dev.close();
    });

    test('an online friend gets a card on the main page, without opening the Friends drawer', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/#net-online-card-A');
            await pageB.goto(dev.url + '/#net-online-card-B');

            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            // Nothing to show before any friend is known.
            await expect(pageA.locator('#online-friends-section')).toBeHidden();

            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);
            const nameB = 'Bobby';
            await pageA.evaluate(id => window.friendsManager.addFriend(id, 'Bobby'), deviceIdB);

            // addFriend triggers an immediate presence re-check (see
            // FriendsManager#addFriend), so the card should appear quickly —
            // no need to wait out the full background poll interval.
            const $card = pageA.locator('x-friend-peer');
            await expect($card).toHaveCount(1, { timeout: 5000 });
            await expect(pageA.locator('#online-friends-section')).toBeVisible();
            await expect($card.locator('.name')).toHaveText(nameB);
            await expect($card.locator('.friend-pong-btn')).toBeVisible();

            // Un-friending removes the card immediately (no network round trip
            // needed — see FriendsManager#removeFriend).
            await pageA.evaluate(id => window.friendsManager.removeFriend(id), deviceIdB);
            await expect(pageA.locator('x-friend-peer')).toHaveCount(0);
            await expect(pageA.locator('#online-friends-section')).toBeHidden();
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('clicking the card\'s Invite-to-Pong button lands both sides on the same room', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/#net-online-card-pong-A');
            await pageB.goto(dev.url + '/#net-online-card-pong-B');

            await pageA.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));
            await pageB.waitForFunction(() => !!(window.friendsManager && window.friendsManager.deviceId));

            const deviceIdB = await pageB.evaluate(() => window.friendsManager.deviceId);
            await pageA.evaluate(id => window.friendsManager.addFriend(id), deviceIdB);

            const $card = pageA.locator('x-friend-peer');
            await expect($card).toHaveCount(1, { timeout: 5000 });

            // The card's button now opens the shared game picker
            // (game-invite.js); choosing Pong sends a game challenge.
            await $card.locator('.friend-pong-btn').click();
            await expect(pageA.locator('#gamePickerDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
            await pageA.locator('#gamePickerDialog .game-picker-item[data-game="pong"]').click();

            await expect(pageB.locator('#gameInviteDialog')).toHaveAttribute('show', '1', { timeout: 5000 });
            await expect(pageB.locator('#gameInviteBody')).toContainText('Pong', { timeout: 5000 });
            await pageB.locator('#gameInviteAccept').click();

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
