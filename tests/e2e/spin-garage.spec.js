// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * Link Spin custom tops (client/spin/parts.js + garage.js):
 *  - the 改装工坊 saves parts, refuses builds over the energy cap and locked
 *    parts, and the match runs on the saved build;
 *  - the host referees: an over-budget / bogus cfg from the peer falls back
 *    to standard parts, an old client that only sends {t} still works;
 *  - P2P: both screens draw both players' builds.
 */
test.describe('Spin garage', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    test.beforeAll(async () => { dev = await startDevServer(); });
    test.afterAll(async () => { await dev.close(); });

    test('garage edits the build, enforces energy + unlocks, match uses it', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`${dev.url}/spin/`);
        // silver (320 RP), tower 2F cleared: spike/heavy/needle unlocked, rim/jet not
        await page.evaluate(() => localStorage.setItem('spin-profile', JSON.stringify({ rp: 320, w: 3, l: 1, tw: 2, tut: true })));
        await page.goto(`${dev.url}/spin/?lang=en&bot=easy#bot-garage`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('.pick[data-type="defense"]').click();
        await page.locator('#garage-btn').click();
        await expect(page.locator('.gar-core.on')).toContainText('FORTRESS');

        await page.locator('.gp[data-slot="ring"][data-id="spike"]').click();
        await page.locator('.gp[data-slot="disk"][data-id="heavy"]').click();
        await page.locator('.gp[data-slot="tip"][data-id="ball"]').click();        // 2+2+1
        await expect(page.locator('.gar-energy b')).toHaveText('5/6');
        await page.locator('.gp[data-slot="tip"][data-id="needle"]').click();      // 2+2+2
        await expect(page.locator('.gar-energy b')).toHaveText('6/6');
        await expect(page.locator('.gar-bars .gb')).toHaveCount(4);
        // the gold rim disk needs 600 RP or tower 4F
        await page.locator('.gp[data-slot="disk"][data-id="rim"]').click();
        await expect(page.locator('.gar-msg')).toContainText('Locked');
        await expect(page.locator('.gp[data-slot="disk"][data-id="heavy"]')).toHaveClass(/\bon\b/);
        await page.locator('.gc[data-col="5"]').click();
        await page.locator('.gar-nick input').fill('Rocky');
        await page.locator('.gar-nick input').press('Tab');
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spin-builds')).defense);
        expect(saved).toMatchObject({ core: 'defense', ring: 'spike', disk: 'heavy', tip: 'needle', col: 5, name: 'Rocky' });
        await page.locator('.gar-done').click();

        await expect(page.locator('.pick[data-type="defense"] .pk-name')).toHaveText('Rocky');
        await expect(page.locator('.pick[data-type="defense"] .pk-mod')).toContainText('🗡️🪨📍');
        await expect(page.locator('#garage-btn')).toContainText('Rocky');

        await page.locator('#start-btn').click();
        await expect.poll(() => page.evaluate(() => window.__bot.state() && window.__bot.state().ph), { timeout: 8_000 }).toBe('battle');
        const top = await page.evaluate(() => {
            const t = window.__bot.state().tops[0];
            return { cfg: t.b.cfg, mass: t.b.mass, core: window.SpinParts.CORES.defense.mass };
        });
        expect(top.cfg).toMatchObject({ core: 'defense', ring: 'spike', disk: 'heavy', tip: 'needle' });
        expect(top.mass).toBeGreaterThan(top.core);        // heavy × needle still heavier than stock
        expect(errors).toEqual([]);
    });

    test('energy cap refusal keeps the old part', async ({ page }) => {
        await page.goto(`${dev.url}/spin/`);
        await page.evaluate(() => {
            localStorage.setItem('spin-profile', JSON.stringify({ rp: 2000, tw: 8, tut: true }));
            localStorage.setItem('spin-builds', JSON.stringify({ attack: { core: 'attack', ring: 'fang', disk: 'rim', tip: 'std' } }));
        });
        await page.goto(`${dev.url}/spin/?lang=en&bot=easy#bot-cap`);
        await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
        await page.locator('.pick[data-type="attack"]').click();
        await page.locator('#garage-btn').click();
        await expect(page.locator('.gar-energy b')).toHaveText('6/6');
        await page.locator('.gp[data-slot="tip"][data-id="ball"]').click();
        await expect(page.locator('.gar-msg')).toContainText('Not enough energy');
        await expect(page.locator('.gp[data-slot="tip"][data-id="std"]')).toHaveClass(/\bon\b/);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spin-builds')).attack.tip)).toBe('std');
    });

    test('host referees the peer cfg: cheats → standard parts, old clients still work', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        // one fresh bot room per case: deliver() feeds the host a pick as if the peer sent it
        const room = async (n, msg) => {
            await page.goto(`${dev.url}/spin/?lang=en&bot=easy&case=${n}#bot-referee`);   // new query → real reload
            await expect(page.locator('#ready-screen')).toBeVisible({ timeout: 5_000 });
            await page.evaluate((m) => window.GameBot.deliver(m), msg);
        };
        const start = async () => {
            await page.locator('#start-btn').click();
            await expect.poll(() => page.evaluate(() => window.__bot.state() && window.__bot.state().ph), { timeout: 8_000 }).toBe('launch');
            return page.evaluate(() => window.__bot.state().cf[1]);
        };
        // over budget (3+3+3) and an HTML nickname
        await room(1, { type: 'pick', t: 'attack', cfg: { core: 'attack', ring: 'fang', disk: 'rim', tip: 'jet', col: 1, name: '<img src=x>' } });
        await expect(page.locator('#opp-pick')).toContainText('STORM STRIKER');
        expect(await page.locator('#opp-pick img').count()).toBe(0);
        const cf = await start();
        expect(cf).toMatchObject({ core: 'attack', ring: 'std', disk: 'std', tip: 'std', col: 1 });
        expect(cf.name).not.toMatch(/[<>]/);
        expect(await page.evaluate(() => window.__bot.state().tops[1].b.atk)).toBe(await page.evaluate(() => window.SpinParts.CORES.attack.atk));
        // prototype-key core falls back to the message's type
        await room(2, { type: 'pick', t: 'stamina', cfg: { core: '__proto__', ring: 'spike' } });
        expect(await start()).toMatchObject({ core: 'stamina', ring: 'spike' });
        // old client: type only
        await room(3, { type: 'pick', t: 'balance' });
        expect(await start()).toMatchObject({ core: 'balance', ring: 'std', disk: 'std', tip: 'std' });
        expect(errors).toEqual([]);
    });

    test('two peers see each other\'s builds', async ({ browser }) => {
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        const errors = [];
        pageA.on('pageerror', e => errors.push(String(e)));
        pageB.on('pageerror', e => errors.push(String(e)));
        const A = { core: 'attack', ring: 'spike', disk: 'swirl', tip: 'std', col: 7, name: 'HostTop' };
        const B = { core: 'stamina', ring: 'guard', disk: 'std', tip: 'ball', col: 4, name: 'Guesty' };
        try {
            for (const [p, c] of [[pageA, A], [pageB, B]]) {
                await p.goto(dev.url + '/spin/?lang=en&setup=1');      // different URL than below → real reload
                await p.evaluate((cfg) => {
                    localStorage.setItem('spin-builds', JSON.stringify({ [cfg.core]: cfg }));
                    localStorage.setItem('spin-pick', cfg.core);
                }, c);
            }
            await pageA.goto(dev.url + '/spin/?lang=en#spin-garage-room');
            await expect(pageA.locator('#role-status-text')).toHaveText('HOST', { timeout: 10_000 });
            await pageB.goto(dev.url + '/spin/?lang=en#spin-garage-room');
            await expect(pageB.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });
            await expect(pageA.locator('#ready-screen')).toBeVisible({ timeout: 15_000 });

            await expect(pageA.locator('#opp-pick')).toContainText('Guesty', { timeout: 5_000 });
            await expect(pageA.locator('#opp-pick .mu.mod')).toContainText('🛡️⚪');
            await expect(pageB.locator('#opp-pick')).toContainText('HostTop', { timeout: 5_000 });

            await pageA.locator('#start-btn').click();
            await expect(pageB.locator('#overlay')).toHaveClass(/hidden/, { timeout: 5_000 });
            const hostCf = await pageA.evaluate(() => window.__bot.state().cf);
            expect(hostCf[0]).toMatchObject(A);
            expect(hostCf[1]).toMatchObject(B);
            // the client draws from the host's broadcast cfgs
            await expect.poll(() => pageB.evaluate(() => window.__bot.view()), { timeout: 3_000 }).toEqual(hostCf);
            expect(await pageA.evaluate(() => window.__bot.view())).toEqual(hostCf);
            expect(errors).toEqual([]);
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
