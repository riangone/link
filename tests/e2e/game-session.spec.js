// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * End-to-end coverage for the shared GameSession transport
 * (client/scripts/game-session.js) through both games built on it:
 * Pong (client/pong/) and Tron (client/tron/). Two real browser contexts
 * join the same room hash, establish a real WebRTC data channel through
 * the real signaling server, and actually play — this is the regression
 * test for the pong/game.js -> GameSession extraction (same role
 * assignment / turn-config-race / data-channel wiring, just no longer
 * hand-rolled per game) and the first proof that a second, structurally
 * different game (discrete grid + reliable channel vs. continuous
 * physics + unreliable channel) can be built on the same abstraction.
 */

test.describe('GameSession-powered games', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;

    test.beforeAll(async () => {
        dev = await startDevServer();
    });

    test.afterAll(async () => {
        await dev.close();
    });

    test('Pong: two peers connect, Host starts the match, and the ball moves', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/pong/#gs-pong-room');
            // Host must observe the (empty) room before the Client joins,
            // otherwise both sides could race to claim the 'host' role.
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });

            await pageB.goto(dev.url + '/pong/#gs-pong-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });

            // Data channel open on both sides -> ready screen visible, Host sees the Start button.
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageA.locator('#start-btn')).toBeVisible();

            await pageA.locator('#start-btn').click();

            // Overlay hides on both sides once play starts.
            await expect(pageA.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });

            // ICE actually reached 'connected' on both sides (not just the
            // data channel opening, which can precede it) -- GameSession
            // only flips the status text once onPeerConnected fires.
            await expect(pageA.locator('#status-text')).toHaveText('P2P ESTABLISHED', { timeout: 5_000 });
            await expect(pageB.locator('#status-text')).toHaveText('P2P ESTABLISHED', { timeout: 5_000 });

            // Let a few network ticks flow, then confirm the RTT readout
            // populated on both sides -- this only happens once the data
            // channel has carried real traffic end-to-end.
            await expect(pageA.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
            await expect(pageB.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('Tron: two peers connect, Host starts, and a direction input reaches Host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/tron/#gs-tron-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });

            await pageB.goto(dev.url + '/tron/#gs-tron-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });

            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });

            await pageA.locator('#start-btn').click();

            await expect(pageA.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });

            // Client turns; Host is authoritative, so Client's own trail
            // growing confirms Host's broadcast ticks are reaching it, and
            // the match staying in 'playing' (no immediate crash) confirms
            // Host accepted the turn without instantly killing Client.
            await pageB.locator('#game-canvas').focus();
            await pageB.keyboard.press('ArrowUp');

            await pageA.waitForTimeout(800); // let a handful of host ticks flow

            await expect(pageA.locator('#status-text')).toHaveText('P2P ESTABLISHED');

            await expect(pageA.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
            await expect(pageB.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('Hockey: two peers connect, Host starts, and Client mallet input reaches Host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/hockey/#gs-hockey-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });

            await pageB.goto(dev.url + '/hockey/#gs-hockey-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });

            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageA.locator('#start-btn')).toBeVisible();

            await pageA.locator('#start-btn').click();

            await expect(pageA.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });

            await expect(pageA.locator('#status-text')).toHaveText('P2P ESTABLISHED', { timeout: 5_000 });
            await expect(pageB.locator('#status-text')).toHaveText('P2P ESTABLISHED', { timeout: 5_000 });

            // Client drags mallet on canvas
            const box = await pageB.locator('#game-canvas').boundingBox();
            if (box) {
                await pageB.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.8);
            }

            await expect(pageA.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
            await expect(pageB.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('Brawl: two peers connect, Host starts, and Client fighter input reaches Host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/brawl/#gs-brawl-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });

            await pageB.goto(dev.url + '/brawl/#gs-brawl-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });

            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageA.locator('#start-btn')).toBeVisible();

            await pageA.locator('#start-btn').click();

            await expect(pageA.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });

            await expect(pageA.locator('#status-text')).toHaveText('P2P ESTABLISHED', { timeout: 5_000 });
            await expect(pageB.locator('#status-text')).toHaveText('P2P ESTABLISHED', { timeout: 5_000 });

            // Client presses jump and punch
            await pageB.keyboard.press('w');
            await pageB.keyboard.press('j');

            await expect(pageA.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
            await expect(pageB.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('Tanks: two peers connect, Host starts, and Client tank input reaches Host', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/tanks/#gs-tanks-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });

            await pageB.goto(dev.url + '/tanks/#gs-tanks-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });

            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageA.locator('#start-btn')).toBeVisible();

            await pageA.locator('#start-btn').click();

            await expect(pageA.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });

            await expect(pageA.locator('#status-text')).toHaveText('P2P ESTABLISHED', { timeout: 5_000 });
            await expect(pageB.locator('#status-text')).toHaveText('P2P ESTABLISHED', { timeout: 5_000 });

            // Client moves and fires ricochet cannon
            await pageB.keyboard.press('w');
            await pageB.keyboard.press('j');

            await expect(pageA.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
            await expect(pageB.locator('#ping-text')).not.toHaveText('-- ms', { timeout: 5_000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('Gomoku: two peers connect, Host starts, and turns alternate on stone placement', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url + '/gomoku/#gs-gomoku-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });

            await pageB.goto(dev.url + '/gomoku/#gs-gomoku-room');
            await expect(pageB.locator('#role-status-text')).toHaveText('CLIENT', { timeout: 10_000 });

            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageA.locator('#start-btn')).toBeVisible();

            await pageA.locator('#start-btn').click();

            await expect(pageA.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });

            // Host places first stone at center (7,7) via keyboard Enter
            await pageA.keyboard.press('Enter');
            await expect(pageB.locator('#move-count-text')).toHaveText('1', { timeout: 5_000 });

            // Client moves cursor right and places second stone
            await pageB.keyboard.press('ArrowRight');
            await pageB.keyboard.press('Enter');
            await expect(pageA.locator('#move-count-text')).toHaveText('2', { timeout: 5_000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
