// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Coverage for Pong's orientation handling. Physics run in a fixed landscape
 * logical system (700x400); the canvas backing store is sized by GameFit
 * (scripts/game-fit.js) to the on-screen size × devicePixelRatio, and portrait
 * is a ±90° render rotation exposed as canvas[data-rotation]. So we assert the
 * visible contract: rotation, aspect of the canvas, wrapper class, persisted
 * preference, and that "auto" (no preference) follows the screen shape.
 */

async function canvasShape(page) {
    return page.locator('#game-canvas').evaluate(el => ({
        rot: el.dataset.rotation, w: el.width, h: el.height, logical: el.dataset.logical
    }));
}

test.describe('Pong orientation', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;

    test.beforeAll(async () => {
        dev = await startDevServer();
    });

    test.afterAll(async () => {
        await dev.close();
    });

    test('toggle switches between landscape and rotated portrait and persists the choice', async ({ page }) => {
        await page.goto(dev.url + '/pong/#room-orientation-test');
        const wrapper = page.locator('.canvas-wrapper');
        const btn = page.locator('#orientation-btn');

        // Desktop landscape window + no preference → landscape.
        await expect(page.locator('#game-canvas')).toHaveAttribute('data-rotation', '0');
        let c = await canvasShape(page);
        expect(c.logical).toBe('700x400');
        expect(c.w).toBeGreaterThan(c.h);
        await expect(wrapper).not.toHaveClass(/portrait/);
        await expect(btn).toHaveAttribute('aria-pressed', 'false');

        await btn.click();
        await expect(page.locator('#game-canvas')).toHaveAttribute('data-rotation', '-90'); // host: own paddle at the bottom
        c = await canvasShape(page);
        expect(c.h).toBeGreaterThan(c.w);
        expect(c.logical).toBe('700x400'); // physics coordinates never change
        await expect(wrapper).toHaveClass(/portrait/);
        await expect(btn).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate(() => localStorage.getItem('pong-orientation'))).toBe('portrait');

        await page.reload();
        await expect(page.locator('#game-canvas')).toHaveAttribute('data-rotation', '-90');
        await expect(page.locator('.canvas-wrapper')).toHaveClass(/portrait/);

        await page.locator('#orientation-btn').click();
        await expect(page.locator('#game-canvas')).toHaveAttribute('data-rotation', '0');
        expect(await page.evaluate(() => localStorage.getItem('pong-orientation'))).toBe('landscape');
    });

    test('with no preference a portrait screen gets the rotated portrait view', async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        await page.goto(dev.url + '/pong/#room-orientation-auto');
        await expect(page.locator('#game-canvas')).toHaveAttribute('data-rotation', '-90');
        const box = await page.locator('#game-canvas').boundingBox();
        expect(box.height).toBeGreaterThan(box.width);
        // fills most of the screen width
        expect(box.width).toBeGreaterThan(330);
        await ctx.close();
    });
});
