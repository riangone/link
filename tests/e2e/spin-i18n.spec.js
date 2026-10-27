// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Spin strings (client/spin/i18n.js):
 *  - an English page shows no leftover Chinese anywhere a player can read it
 *    (DOM text, titles, guide panel) — catches strings that bypass t();
 *  - the ready screen recommends the counter pick for the bot's type and
 *    marks that top with the 👍 badge;
 *  - the language select switches language (shared 'language' key) and reloads.
 */
const CJK = /[぀-ヿ一-鿿가-힯]/;

test.describe('Spin i18n', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    test('English page has no untranslated text; counter pick is recommended', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/spin/?lang=en&bot=hard#bot-i18n`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#opp-pick')).toContainText('Rival:');

        // the bot's type is shown in #opp-pick; the recommended top must carry the badge
        const rec = await page.evaluate(() => {
            const shown = document.querySelector('#opp-pick').textContent;
            const names = { attack: 'STORM STRIKER', defense: 'IRON FORTRESS', stamina: 'ZEPHYR WING', balance: 'PHOENIX FLARE' };
            const opp = Object.keys(names).find((k) => shown.includes(names[k]));
            return { want: window.SpinPanels.REC[opp], got: [...document.querySelectorAll('.pick.rec')].map((b) => b.dataset.type) };
        });
        expect(rec.got).toEqual([rec.want]);
        // pick something else → the advice line names the recommendation
        const other = ['attack', 'defense', 'stamina', 'balance'].find((t) => t !== rec.want);
        await page.locator(`.pick[data-type="${other}"]`).click();
        await expect(page.locator('#opp-pick .mu.rec')).toHaveCount(0); // folded by default
        await page.locator('#opp-pick .tips-toggle').click();
        await expect(page.locator('#opp-pick .mu.rec')).toContainText('Best pick');
        await expect(page.locator('#opp-pick .mu.style')).toContainText('How to play');

        const leftovers = async () => page.evaluate((re) => {
            const rx = new RegExp(re);
            const out = [];
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walk.nextNode()) if (rx.test(walk.currentNode.nodeValue)) out.push(walk.currentNode.nodeValue.trim());
            document.querySelectorAll('[title]').forEach((e) => { if (rx.test(e.title)) out.push('title: ' + e.title); });
            if (rx.test(document.title)) out.push('document.title');
            return out.filter((s) => !/^(中文|日本語|한국어)$/.test(s));      // language names stay native
        }, CJK.source);
        expect(await leftovers()).toEqual([]);
        for (const which of ['guide', 'tower', 'board', 'garage']) {
            await page.locator(`#ready-screen [data-open="${which}"]`).click();
            await expect(page.locator('#panel-screen')).toBeVisible();
            expect(await leftovers()).toEqual([]);
            await page.locator('#panel-screen .panel-close').click();
        }
        expect(errors).toEqual([]);
    });

    test('language select switches to Japanese and remembers it', async ({ page }) => {
        await page.goto(`${dev.url}/spin/?lang=en&bot=easy#bot-i18n2`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await Promise.all([page.waitForEvent('load'), page.locator('#lang-select').selectOption('ja')]);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#opp-pick')).toContainText('あいて：');
        await expect(page.locator('#ready-screen .meta-btn[data-open="tower"]')).toHaveText('🏯 タワー');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
        expect(new URL(page.url()).searchParams.get('lang')).toBeNull();
        expect(await page.evaluate(() => localStorage.getItem('language'))).toBe('ja');
    });
});
