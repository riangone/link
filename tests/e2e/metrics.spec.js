// @ts-check
const { test, expect } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/** @type {Awaited<ReturnType<typeof startDevServer>>} */
let dev;
test.beforeAll(async () => { dev = await startDevServer(); });
test.afterAll(async () => { await dev.close(); });

/** Record every `metric` message a page sends over any WebSocket. */
async function captureMetrics(page) {
    await page.addInitScript(() => {
        window.__metrics = [];
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
            try {
                const m = JSON.parse(data);
                if (m.type === 'metric' || m.type === 'match-join') window.__metrics.push(m);
            } catch (e) { /* binary */ }
            return send.call(this, data);
        };
    });
}
const sent = (page, ev) => page.evaluate((e) => window.__metrics.filter((m) => m.ev === e), ev);

test('lobby invite link -> pong match reports the funnel metrics', async ({ browser }) => {
    test.setTimeout(180000);
    const ctxA = await browser.newContext(), ctxB = await browser.newContext();
    const a = await ctxA.newPage(), b = await ctxB.newPage();
    await captureMetrics(a);
    await captureMetrics(b);

    await a.goto(dev.url + '/play/?g=pong');
    const code = (await a.locator('#box .c').innerText()).trim();
    expect(code).toMatch(/^\d{4}$/);
    expect((await sent(a, 'visit'))[0]).toMatchObject({ week: 0 });
    expect((await sent(a, 'visit'))[0].cohort).toMatch(/^\d{4}-W\d{2}$/);

    await a.locator('#sh').click();
    await expect.poll(() => sent(a, 'share_click')).toHaveLength(1);

    await b.goto(dev.url + '/play/#' + code);
    await expect.poll(async () => (await b.evaluate(() => window.__metrics.find((m) => m.type === 'match-join'))) || null, { timeout: 5000 })
        .toMatchObject({ via: 'link', code });

    await a.waitForURL(/\/pong\//, { timeout: 15000 });
    await b.waitForURL(/\/pong\//, { timeout: 15000 });

    // The connection decides who hosts, and only the host gets a start button.
    let host = null, guest = null;
    await expect.poll(async () => {
        if (await a.locator('#start-btn').isVisible()) [host, guest] = [a, b];
        else if (await b.locator('#start-btn').isVisible()) [host, guest] = [b, a];
        return !!host;
    }, { timeout: 20000 }).toBe(true);

    // Nobody moves the paddles, so the host's ball scores until game over.
    await host.locator('#start-btn').click({ force: true });

    await expect.poll(() => sent(host, 'net_result').then((r) => r.length), { timeout: 15000 }).toBe(1);
    expect(['direct', 'turn', 'ws']).toContain((await sent(host, 'net_result'))[0].kind);

    await expect.poll(() => sent(host, 'match_end').then((r) => r.length), { timeout: 150000 }).toBe(1);
    await expect.poll(() => sent(guest, 'match_end').then((r) => r.length), { timeout: 10000 }).toBe(1);
    expect((await sent(host, 'match_end'))[0]).toMatchObject({ game: 'pong' });
    expect((await sent(host, 'match_end'))[0].sec).toBeGreaterThan(0);

    await host.locator('#restart-btn').click();
    await expect.poll(() => sent(host, 'rematch').then((r) => r.length)).toBe(1);

    await ctxA.close();
    await ctxB.close();
});

test('bot games send no match metrics', async ({ page }) => {
    await captureMetrics(page);
    await page.goto(dev.url + '/pong/?bot=easy#bot-test');
    await page.waitForTimeout(1500);
    expect(await sent(page, 'net_result')).toHaveLength(0);
});
