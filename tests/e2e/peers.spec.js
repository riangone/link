// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * These tests spin up the real signaling server (server/index.js, attached
 * to a plain Node static file server — see dev-server.js) and drive two
 * real browser contexts against it, the same way the click/long-press
 * regression was originally root-caused by hand. They exist so that class
 * of bug (an invisible-but-`pointer-events: all` overlay silently
 * swallowing clicks on the peer list) fails CI instead of shipping again.
 */

test.describe('peer discovery + click reachability', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;

    test.beforeAll(async () => {
        dev = await startDevServer();
    });

    test.afterAll(async () => {
        await dev.close();
    });

    test('two clients discover each other as x-peer elements', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url);
            await pageB.goto(dev.url);

            await expect(pageA.locator('x-peer')).toHaveCount(1, { timeout: 10_000 });
            await expect(pageB.locator('x-peer')).toHaveCount(1, { timeout: 10_000 });
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('clicking a peer card reaches the file input (about panel does not swallow clicks while closed)', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url);
            await pageB.goto(dev.url);
            await expect(pageA.locator('x-peer')).toHaveCount(1, { timeout: 10_000 });

            // Regression check for the bug where #about .about-card had an
            // unconditional `pointer-events: all` and, despite being
            // invisible (opacity: 0), sat centered over the peer list and
            // absorbed every click meant for x-peer.
            const centerPoint = await pageA.locator('x-peer').first().boundingBox();
            expect(centerPoint).not.toBeNull();
            const elementAtCenter = await pageA.evaluate(({ x, y }) => {
                const el = document.elementFromPoint(x, y);
                return el ? el.closest('x-peer') !== null || el.tagName === 'X-PEER' : false;
            }, { x: centerPoint.x + centerPoint.width / 2, y: centerPoint.y + centerPoint.height / 2 });
            expect(elementAtCenter).toBe(true);

            // A real click on the peer's <label> must be able to reach the
            // <input type="file"> inside it (this is exactly what silently
            // broke: file picker never opened because the about panel ate
            // the click first).
            const fileChooserPromise = pageA.waitForEvent('filechooser', { timeout: 5_000 });
            await pageA.locator('x-peer label').first().click();
            const fileChooser = await fileChooserPromise;
            expect(fileChooser).toBeTruthy();
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });

    test('about panel still blocks/receives clicks correctly while open (no regression the other way)', async ({ page }) => {
        await page.goto(dev.url);
        await page.locator('a[href="#about"]').first().click();
        await expect(page).toHaveURL(/#about$/);
        // the about card itself should now be interactive and visible
        await expect(page.locator('#about .about-card')).toBeVisible();
    });
});
