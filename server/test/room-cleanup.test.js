'use strict';

// Regression test for a real bug found while building the Playwright E2E
// suite: when a peer's WebSocket simply closes (browser crash, tab killed,
// network drop — anything that isn't a clean {type:'disconnect'} message),
// the room used to keep a "ghost" entry around for up to ~60s because
// nothing was listening for the socket's 'close' event. Other peers would
// keep seeing a device that was already gone. Fixed in SnapdropServer by
// registering `peer.socket.on('close', () => this._leaveRoom(peer))`.
//
// This test exercises it at the raw ws/http level (no browser) so it runs
// in milliseconds; tests/e2e/peers.spec.js exercises the same fix through
// real browser contexts for end-to-end confidence.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');

const { SnapdropServer } = require('../index.js');

function listen() {
    return new Promise(resolve => {
        const httpServer = http.createServer((req, res) => { res.writeHead(404); res.end(); });
        new SnapdropServer(null, httpServer);
        httpServer.listen(0, '127.0.0.1', () => resolve(httpServer));
    });
}

function waitForMessageType(ws, type, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), timeoutMs);
        ws.on('message', raw => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === type) {
                clearTimeout(timer);
                resolve(msg);
            }
        });
    });
}

test('a peer that disappears without sending {type: disconnect} is removed from the room as soon as its socket closes', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrl = `ws://127.0.0.1:${port}/server/webrtc`;

    try {
        const wsA = new WebSocket(wsUrl);
        await new Promise(resolve => wsA.on('open', resolve));

        const wsB = new WebSocket(wsUrl);
        await new Promise(resolve => wsB.on('open', resolve));

        // A must see B join
        await waitForMessageType(wsA, 'peer-joined');

        // Simulate an abrupt disappearance: no {type:'disconnect'} message,
        // just the raw socket going away (this is exactly what happens when
        // a browser tab is killed or the network drops).
        const peerLeftPromise = waitForMessageType(wsA, 'peer-left');
        wsB.terminate();

        const leftMsg = await peerLeftPromise; // must resolve quickly, not after a ~60s keepalive timeout
        assert.equal(leftMsg.type, 'peer-left');

        wsA.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});
