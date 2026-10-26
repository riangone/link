// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Spin progression: tutorial → RP, tower floor 8 → dragon unlock,
 * results reaching the server leaderboard (server/leaderboard.js).
 * State is nudged through window.__bot (host-authoritative bot mode) so the
 * tests don't depend on physics luck.
 */
test.describe('Spin progression', () => {
    // the assertions below use the Chinese strings (client/spin/i18n.js)
    test.use({ locale: 'zh-CN' });
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    test('tutorial walks through every step and awards RP once', async ({ page }) => {
        test.setTimeout(60_000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/spin/?bot=easy&tutorial=1#bot-tut`);
        await expect(page.locator('#ready-screen h2')).toHaveText('新手教学');
        await page.locator('#start-btn').click();
        const step = () => page.evaluate(() => window.__bot.tut().step);
        await expect(page.locator('#coach')).toContainText('发射');
        await page.keyboard.press('Space');
        await expect.poll(step, { timeout: 8_000 }).toBe(1);
        await expect(page.locator('#coach')).toContainText('移动');
        for (let k = 0; k < 3; k++) {
            await page.evaluate(() => {
                const s = window.__bot.state(), t = window.__bot.tut();
                Object.assign(s.tops[0], t.targets[t.ti], { vx: 0, vy: 0 });
            });
            await page.waitForTimeout(100);
        }
        await expect.poll(step).toBe(2);
        // dash into the dummy from close range
        await page.evaluate(() => {
            const s = window.__bot.state();
            Object.assign(s.tops[1], { x: 320, y: 300, vx: 0, vy: 0 });
            Object.assign(s.tops[0], { x: 320, y: 380, vx: 0, vy: 0, cd: 0 });
        });
        await page.keyboard.press('Space');
        await expect.poll(step, { timeout: 3_000 }).toBe(3);
        await page.keyboard.press('e');
        await expect.poll(step, { timeout: 3_000 }).toBe(4);
        await page.evaluate(() => { const s = window.__bot.state(); Object.assign(s.tops[1], { x: 640, y: 320, vx: 6, vy: 0 }); });
        await expect(page.locator('#win-loss-title')).toHaveText('TUTORIAL CLEAR!', { timeout: 10_000 });
        await expect(page.locator('#reward-slot')).toContainText('+50 RP');
        await expect(page.locator('#next-btn')).toContainText('擂台 1F');
        const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('spin-profile')));
        expect(prof.tut).toBe(true);
        expect(prof.rp).toBe(50);
        expect(errors).toEqual([]);
    });

    test('clearing tower 8F unlocks the dragon and lands on the leaderboard', async ({ page }) => {
        test.setTimeout(60_000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/spin/`);
        await page.evaluate(() => localStorage.setItem('spin-profile', JSON.stringify({ rp: 300, w: 7, l: 2, tw: 7, tut: true, name: 'TowerAce' })));
        await page.goto(`${dev.url}/spin/?bot=hard&tower=8#bot-t8`);
        await expect(page.locator('#ready-screen h2')).toHaveText('擂台 8F');
        await expect(page.locator('#floor-card')).toContainText('龙王');
        await expect(page.locator('.pick[data-type="dragon"]')).toHaveClass(/locked/);

        // tower map shows 8F as the current floor
        await page.locator('#ready-screen [data-open="tower"]').click();
        await expect(page.locator('.floor.current .fl-n')).toHaveText('8F');
        await page.locator('.panel-close').click();
        await expect(page.locator('#ready-screen')).toBeVisible();

        await page.locator('.pick[data-type="defense"]').click();
        await page.locator('#start-btn').click();
        const ph = () => page.evaluate(() => window.__bot.state().ph);
        for (let r = 0; r < 2; r++) {
            await expect.poll(ph, { timeout: 8_000 }).toBe('battle');
            await page.evaluate(() => { const s = window.__bot.state(); s.tops[1].bg = 100; s.tops[1].st = 2; });
            await expect.poll(ph, { timeout: 8_000 }).not.toBe('battle');
        }
        await expect(page.locator('#win-loss-title')).toHaveText('TOWER CLEARED!', { timeout: 10_000 });
        await expect(page.locator('#reward-slot')).toContainText('VOID DRAGON');
        await expect(page.locator('#reward-slot')).toContainText('+120');
        await expect(page.locator('.pick[data-type="dragon"]')).not.toHaveClass(/locked/);

        await page.locator('#gameover-screen [data-open="board"]').click();
        await expect(page.locator('.lb-row.me')).toContainText('TowerAce', { timeout: 8_000 });
        // 300 + 120 (first clear of 8F); the forced st=2 emits no burst event, so no burst bonus
        await expect(page.locator('.lb-row.me .lb-rp')).toContainText('420');
        expect(errors).toEqual([]);
    });
});
