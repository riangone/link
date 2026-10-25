'use strict';

// Unit tests for the deviceId-based friend routing added to SnapdropServer:
// a peer can register a stable `deviceId` (bind-device), another peer can
// resolve that deviceId to a *live* peer id regardless of room/network
// (find-device), and once resolved, generic relayed messages (`to`, e.g.
// invite/invite-response and WebRTC `signal`) reach that peer id even
// across rooms — which is what lets two devices on different networks
// pair up without sharing a room URL. See server/index.js's `_onMessage`
// relay section for the trust-model rationale.

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

test('find-device resolves a bound deviceId to the owning peer, even across different rooms', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    // two distinct `?room=` values simulate two devices on different
    // networks/IPs that would never otherwise share a room
    const wsUrlA = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;
    const wsUrlB = `ws://127.0.0.1:${port}/server/webrtc?room=networkB`;

    try {
        const wsA = new WebSocket(wsUrlA);
        await new Promise(resolve => wsA.on('open', resolve));
        const wsB = new WebSocket(wsUrlB);
        await new Promise(resolve => wsB.on('open', resolve));

        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'friend-device-xyz' }));
        // give the server a beat to process bind-device before A asks for it
        await new Promise(resolve => setTimeout(resolve, 50));

        wsA.send(JSON.stringify({ type: 'find-device', deviceId: 'friend-device-xyz' }));
        const result = await waitForMessageType(wsA, 'find-device-result');

        assert.equal(result.online, true);
        assert.equal(typeof result.peerId, 'string');
        assert.ok(result.peer && result.peer.id === result.peerId);

        wsA.close();
        wsB.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});

test('find-device reports offline for an unknown/never-bound deviceId', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrl = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;

    try {
        const ws = new WebSocket(wsUrl);
        await new Promise(resolve => ws.on('open', resolve));

        ws.send(JSON.stringify({ type: 'find-device', deviceId: 'no-such-device' }));
        const result = await waitForMessageType(ws, 'find-device-result');

        assert.equal(result.online, false);
        assert.equal(result.peerId, undefined);

        ws.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});

test('a relayed message reaches its recipient across rooms once the sender knows their peer id (deviceId pairing)', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrlA = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;
    const wsUrlB = `ws://127.0.0.1:${port}/server/webrtc?room=networkB`;

    try {
        const wsA = new WebSocket(wsUrlA);
        await new Promise(resolve => wsA.on('open', resolve));
        const wsB = new WebSocket(wsUrlB);
        await new Promise(resolve => wsB.on('open', resolve));

        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'friend-device-abc' }));
        await new Promise(resolve => setTimeout(resolve, 50));

        wsA.send(JSON.stringify({ type: 'find-device', deviceId: 'friend-device-abc' }));
        const found = await waitForMessageType(wsA, 'find-device-result');
        assert.equal(found.online, true);

        const invitePromise = waitForMessageType(wsB, 'invite');
        wsA.send(JSON.stringify({ type: 'invite', to: found.peerId, fromDeviceId: 'my-device-id' }));

        const invite = await invitePromise;
        assert.equal(invite.fromDeviceId, 'my-device-id');
        assert.equal(typeof invite.sender, 'string'); // server-stamped sender peer id

        wsA.close();
        wsB.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});

test('find-device reports offline again once the owning peer disconnects (no stale routing)', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrlA = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;
    const wsUrlB = `ws://127.0.0.1:${port}/server/webrtc?room=networkB`;

    try {
        const wsA = new WebSocket(wsUrlA);
        await new Promise(resolve => wsA.on('open', resolve));
        const wsB = new WebSocket(wsUrlB);
        await new Promise(resolve => wsB.on('open', resolve));

        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'friend-device-gone' }));
        await new Promise(resolve => setTimeout(resolve, 50));

        wsB.terminate();
        await new Promise(resolve => setTimeout(resolve, 100));

        wsA.send(JSON.stringify({ type: 'find-device', deviceId: 'friend-device-gone' }));
        const result = await waitForMessageType(wsA, 'find-device-result');
        assert.equal(result.online, false);

        wsA.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});
