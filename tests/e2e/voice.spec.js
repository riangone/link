// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const { startDevServer } = require('./dev-server.js');

/**
 * End-to-end check for the voice-message feature (see network.js
 * Peer#sendVoice, voice-store.js, ui.js VoiceRecorder/SendTextDialog).
 *
 * Exercises the real contract that motivated the design: audio is recorded
 * with MediaRecorder, sent peer-to-peer over the same transport file
 * transfers use (WebRTC data channel, or the WSPeer relay fallback), and
 * persisted only in each browser's own IndexedDB (voice-store.js) - never
 * written to the signaling/relay server. This spins up its own Chromium
 * instance (rather than the shared `browser` fixture) so it can pass fake
 * media flags, letting MediaRecorder run headlessly against a synthetic
 * (silent) audio track instead of requiring a real microphone.
 */
test.describe('voice messages', () => {
    /** @type {Awaited<ReturnType<typeof startDevServer>>} */
    let dev;
    /** @type {import('@playwright/test').Browser} */
    let browser;

    test.beforeAll(async () => {
        dev = await startDevServer();
        browser = await chromium.launch({
            args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
        });
    });

    test.afterAll(async () => {
        await browser.close();
        await dev.close();
    });

    test('recording and sending a voice message delivers a playable, locally-persisted bubble to the peer', async () => {
        const ctxA = await browser.newContext({ permissions: ['microphone'] });
        const ctxB = await browser.newContext({ permissions: ['microphone'] });
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        try {
            await pageA.goto(dev.url);
            await pageB.goto(dev.url);

            await expect(pageA.locator('x-peer')).toHaveCount(1, { timeout: 10_000 });
            await expect(pageB.locator('x-peer')).toHaveCount(1, { timeout: 10_000 });

            // Right-click opens the chat dialog (same entry point as text messages)
            await pageA.locator('x-peer label').first().click({ button: 'right' });
            await expect(pageA.locator('#sendTextDialog')).toBeVisible();

            await pageA.locator('#voiceRecordBtn').click();
            await expect(pageA.locator('#voiceRecordBar')).toBeVisible({ timeout: 5_000 });

            await pageA.waitForTimeout(3000); // record ~3s of fake/silent audio

            await pageA.locator('#voiceRecordBtn').click(); // stop -> Peer#sendVoice()
            await expect(pageA.locator('#voiceRecordBar')).toBeHidden();

            // Sender-side bubble renders immediately (status: sending/delivered)
            await expect(pageA.locator('.voice-msg-bubble')).toHaveCount(1, { timeout: 5_000 });
            await expect(pageA.locator('.voice-msg-bubble.voice-msg-unavailable')).toHaveCount(0);

            // Receiver's chat dialog auto-opens on incoming voice message, mirroring text
            await expect(pageB.locator('#sendTextDialog')).toBeVisible({ timeout: 10_000 });
            await expect(pageB.locator('.voice-msg-bubble')).toHaveCount(1, { timeout: 10_000 });
            await expect(pageB.locator('.voice-msg-bubble .voice-play-btn')).toBeVisible();

            // The audio itself must have landed in each side's own
            // IndexedDB (VoiceStore) - this is the "server/relay never
            // stores it" contract; only a metadata event crossed the wire
            // logically, the bytes went client-to-client.
            const countStoredVoiceMessages = () => new Promise(resolve => {
                const req = indexedDB.open('link-voice-messages');
                req.onsuccess = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('audios')) { resolve(0); return; }
                    const tx = db.transaction('audios', 'readonly');
                    const countReq = tx.objectStore('audios').count();
                    countReq.onsuccess = () => resolve(countReq.result);
                    countReq.onerror = () => resolve(0);
                };
                req.onerror = () => resolve(0);
            });

            await expect.poll(() => pageA.evaluate(countStoredVoiceMessages), { timeout: 5_000 }).toBe(1);
            await expect.poll(() => pageB.evaluate(countStoredVoiceMessages), { timeout: 5_000 }).toBe(1);

            // Playback: clicking play must actually pull the Blob back out
            // of IndexedDB and drive an <audio> element - assert the
            // progress bar moves off 0%, which only happens once
            // 'timeupdate' fires on real playback.
            await pageB.locator('.voice-msg-bubble .voice-play-btn').click();
            await expect.poll(() => {
                return pageB.locator('.voice-msg-progress').first().evaluate(el => el.style.width);
            }, { timeout: 5_000 }).not.toBe('0%');
        } finally {
            await ctxA.close();
            await ctxB.close();
        }
    });
});
