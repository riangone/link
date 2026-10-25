'use strict';

// Unit tests for the opt-in public-device directory added on top of the
// deviceId friend routing (see device-friends.test.js): a peer can mark
// itself discoverable via `bind-device { public: true }`, which lists it
// in a process-wide directory that any other connected peer can snapshot
// (`list-public-devices`) and gets pushed live join/leave pushes for
// (`public-peer-joined` / `public-peer-left`). Turning it back off — or
// disconnecting — must be a real removal, not just a client-side hide.

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

test('list-public-devices returns a peer that bound itself as public, excluding the requester', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrlA = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;
    const wsUrlB = `ws://127.0.0.1:${port}/server/webrtc?room=networkB`;

    try {
        const wsA = new WebSocket(wsUrlA);
        await new Promise(resolve => wsA.on('open', resolve));
        const wsB = new WebSocket(wsUrlB);
        await new Promise(resolve => wsB.on('open', resolve));

        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'public-device-b', nickname: 'Bob', public: true }));
        await new Promise(resolve => setTimeout(resolve, 50));

        wsA.send(JSON.stringify({ type: 'list-public-devices' }));
        const result = await waitForMessageType(wsA, 'public-devices');

        assert.equal(result.devices.length, 1);
        assert.equal(result.devices[0].deviceId, 'public-device-b');
        assert.equal(result.devices[0].nickname, 'Bob');
        assert.equal(typeof result.devices[0].peer.id, 'string');

        wsA.close();
        wsB.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});

test('a peer that never opts in to public never appears in list-public-devices', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrlA = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;
    const wsUrlB = `ws://127.0.0.1:${port}/server/webrtc?room=networkB`;

    try {
        const wsA = new WebSocket(wsUrlA);
        await new Promise(resolve => wsA.on('open', resolve));
        const wsB = new WebSocket(wsUrlB);
        await new Promise(resolve => wsB.on('open', resolve));

        // bind without `public: true` — the default/private path
        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'private-device-b' }));
        await new Promise(resolve => setTimeout(resolve, 50));

        wsA.send(JSON.stringify({ type: 'list-public-devices' }));
        const result = await waitForMessageType(wsA, 'public-devices');

        assert.deepEqual(result.devices, []);

        wsA.close();
        wsB.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});

test('other connected peers are pushed a public-peer-joined event when a device opts in live', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrlA = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;
    const wsUrlB = `ws://127.0.0.1:${port}/server/webrtc?room=networkB`;

    try {
        const wsA = new WebSocket(wsUrlA);
        await new Promise(resolve => wsA.on('open', resolve));
        const wsB = new WebSocket(wsUrlB);
        await new Promise(resolve => wsB.on('open', resolve));

        const joinedPromise = waitForMessageType(wsA, 'public-peer-joined');
        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'public-device-live', nickname: 'Live', public: true }));

        const joined = await joinedPromise;
        assert.equal(joined.deviceId, 'public-device-live');
        assert.equal(joined.nickname, 'Live');

        wsA.close();
        wsB.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});

test('flipping public back off removes the device from the directory and pushes public-peer-left', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrlA = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;
    const wsUrlB = `ws://127.0.0.1:${port}/server/webrtc?room=networkB`;

    try {
        const wsA = new WebSocket(wsUrlA);
        await new Promise(resolve => wsA.on('open', resolve));
        const wsB = new WebSocket(wsUrlB);
        await new Promise(resolve => wsB.on('open', resolve));

        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'public-device-toggle', public: true }));
        await new Promise(resolve => setTimeout(resolve, 50));

        const leftPromise = waitForMessageType(wsA, 'public-peer-left');
        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'public-device-toggle', public: false }));

        const left = await leftPromise;
        assert.equal(left.deviceId, 'public-device-toggle');

        wsA.send(JSON.stringify({ type: 'list-public-devices' }));
        const result = await waitForMessageType(wsA, 'public-devices');
        assert.deepEqual(result.devices, []);

        wsA.close();
        wsB.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});

test('a public device disappears from the directory (with a push) once it disconnects', async () => {
    const httpServer = await listen();
    const port = httpServer.address().port;
    const wsUrlA = `ws://127.0.0.1:${port}/server/webrtc?room=networkA`;
    const wsUrlB = `ws://127.0.0.1:${port}/server/webrtc?room=networkB`;

    try {
        const wsA = new WebSocket(wsUrlA);
        await new Promise(resolve => wsA.on('open', resolve));
        const wsB = new WebSocket(wsUrlB);
        await new Promise(resolve => wsB.on('open', resolve));

        wsB.send(JSON.stringify({ type: 'bind-device', deviceId: 'public-device-gone', public: true }));
        await new Promise(resolve => setTimeout(resolve, 50));

        const leftPromise = waitForMessageType(wsA, 'public-peer-left');
        wsB.terminate();

        const left = await leftPromise;
        assert.equal(left.deviceId, 'public-device-gone');

        wsA.close();
    } finally {
        await new Promise(resolve => httpServer.close(resolve));
    }
});
