// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * 人机对战 (client/scripts/game-bot.js + per-game bot brains).
 *  - `?bot=<level>` runs a game fully locally: no peer, host loop + bot as
 *    the fake client. Each test lets the hard bot play against an idle
 *    human and checks that it actually plays (scores / damages / survives).
 *  - The lobby (/play/) gets a 真人/人机 toggle; bot mode jumps straight in.
 */
test.describe('Game bots', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    async function openBot(page, game, level = 'hard') {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/${game}/?bot=${level}#bot-test`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#role-status-text')).toHaveText('HOST');
        await expect(page.locator('#gb-ready .gb-level.gb-on')).toHaveAttribute('data-level', level);
        await page.locator('#start-btn').click();
        await expect(page.locator('#overlay')).toHaveClass(/hidden/);
        expect(await page.evaluate(() => window.__bot.enabled)).toBe(true);
        return errors;
    }
    const st = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__bot.state())));

    test('pong: hard bot returns the ball and scores on an idle player', async ({ page }) => {
        const errors = await openBot(page, 'pong');
        await expect.poll(async () => (await st(page)).score.p2, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
        expect((await st(page)).score.p1).toBe(0);
        expect(errors).toEqual([]);
    });

    test('gomoku: bot replies, blocks an open line, and undo takes back both moves', async ({ page }) => {
        const errors = await openBot(page, 'gomoku');
        const playAndWait = async (r, c) => {
            const before = (await st(page)).history.length;
            await page.evaluate(([r, c]) => window.__bot.place(r, c), [r, c]);
            await expect.poll(async () => {
                const x = await st(page);
                return x.history.length >= before + 2 || x.status !== 'playing';
            }, { timeout: 5_000 }).toBe(true);
        };
        // Human greedily extends a straight line on row 7 (nearest free cell
        // to the centre). The hard bot must keep blocking it: no human win.
        let s;
        for (let i = 0; i < 6; i++) {
            s = await st(page);
            if (s.status !== 'playing') break;
            const row = s.board[7];
            const free = [7, 6, 8, 5, 9, 4, 10, 3, 11].find(c => row[c] === 0);
            if (free === undefined) break;
            await playAndWait(7, free);
        }
        s = await st(page);
        expect(s.history.length).toBeGreaterThanOrEqual(6);
        expect(s.winner).not.toBe(1);
        // the bot actually put stones on the human's row to cap it
        expect(s.board[7].filter(v => v === 2).length).toBeGreaterThanOrEqual(1);

        // undo in bot mode: removes the bot's reply and my move, my turn again
        if (s.status === 'playing') {
            const n = s.history.length;
            await page.locator('#undo-btn').click();
            s = await st(page);
            expect(s.history.length).toBe(n - 2);
            expect(s.turn).toBe(1);
        }
        expect(errors).toEqual([]);
    });

    test('hockey: hard bot scores on an idle player', async ({ page }) => {
        const errors = await openBot(page, 'hockey');
        await expect.poll(async () => (await st(page)).score.p2, { timeout: 25_000 }).toBeGreaterThanOrEqual(1);
        expect(errors).toEqual([]);
    });

    test('tanks: hard bot damages an idle player', async ({ page }) => {
        const errors = await openBot(page, 'tanks');
        await expect.poll(async () => {
            const s = await st(page);
            return s.p1.hp < 3 || s.score.p2 > 0;
        }, { timeout: 15_000 }).toBe(true);
        expect(errors).toEqual([]);
    });

    test('brawl: hard bot walks over and damages an idle player', async ({ page }) => {
        const errors = await openBot(page, 'brawl');
        await expect.poll(async () => {
            const s = await st(page);
            return s.p1.hp < 100 || s.score.p2 > 0;
        }, { timeout: 15_000 }).toBe(true);
        expect(errors).toEqual([]);
    });

    test('tron: hard bot dodges the head-on line and outlives an idle player', async ({ page }) => {
        const errors = await openBot(page, 'tron');
        await expect.poll(async () => (await st(page)).status, { timeout: 15_000 }).toBe('gameover');
        expect((await st(page)).winner).toBe(2);
        expect(errors).toEqual([]);
    });

    test('normal pvp page shows a vs-computer box that switches into bot mode', async ({ page }) => {
        await page.goto(`${dev.url}/hockey/#room-gb-pvp`);
        await expect(page.locator('#gb-lobby')).toBeVisible();
        await page.locator('#gb-lobby .gb-level[data-level="easy"]').click();
        await expect(page).toHaveURL(/hockey\/\?bot=easy#bot-/);
        await expect(page.locator('#ready-screen')).toBeVisible();
        await expect(page.locator('#p2-label')).toContainText('🤖');
    });

    test('lobby: 人机 toggle + level go straight into a bot game; waiting overlay offers a bot', async ({ page }) => {
        await page.goto(`${dev.url}/play/?lang=zh`);
        await page.locator('#mode button[data-m="bot"]').click();
        await page.locator('#lv button[data-lv="easy"]').click();
        await page.locator('#g-tanks').click();
        await expect(page).toHaveURL(/tanks\/\?bot=easy#bot-/);
        await expect(page.locator('#ready-screen')).toBeVisible();

        // mode is remembered; switch back to 真人 and wait in a queue
        await page.goto(`${dev.url}/play/?lang=zh`);
        await expect(page.locator('#mode button[data-m="bot"]')).toHaveClass(/on/);
        await page.locator('#mode button[data-m="pvp"]').click();
        await page.locator('#g-tron').click();
        await expect(page.locator('#vb')).toBeVisible({ timeout: 5_000 });
        await page.locator('#vb').click();
        await expect(page).toHaveURL(/tron\/\?bot=easy#bot-/);
    });
});
