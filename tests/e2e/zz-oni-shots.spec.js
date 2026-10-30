const { test } = require('@playwright/test');
const { startDevServer } = require('/home/ubuntu/ws/link/tests/e2e/dev-server.js');
test('chapter screenshots', async ({ page }) => {
    test.setTimeout(900_000);
    const dev = await startDevServer();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.setViewportSize({ width: 1100, height: 620 });
    await page.goto(`${dev.url}/oni/`);
    await page.waitForSelector('#btn-start-campaign', { timeout: 60000 });
    for (const ch of (process.env.ONI_SHOTS || 'ch1,ch3,ch5,ch10,ch12,ch14').split(',')) {
        await page.evaluate(() => { const o = document.getElementById('start-overlay'); if (o) o.classList.remove('hidden'); });
        await page.locator(`.chapter-card[data-chapter="${ch}"]`).click();
        await page.locator('#btn-start-campaign').click();
        await page.waitForTimeout(9000);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `/tmp/oni-shots/${ch}.png` });
    }
    console.log('ERRORS', JSON.stringify(errors));
    await dev.close();
});
