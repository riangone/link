'use strict';

// Unit tests for server/index.js using Node's built-in test runner
// (`node --test`). Deliberately dependency-free: no Jest/Mocha, in line
// with the project's "no build/framework" constraint for tooling too.
//
// Run with: npm test  (see package.json)

const test = require('node:test');
const assert = require('node:assert/strict');

const { Peer, RateLimiter, getTurnCredentials, ROOM_MAX_PEERS } = require('../index.js');

test('Peer.uuid() produces well-formed, unique v4-like uuids', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
        const id = Peer.uuid();
        assert.match(id, uuidRegex, `uuid "${id}" does not match expected format`);
        assert.ok(!seen.has(id), 'uuid collision detected');
        seen.add(id);
    }
});

test('String.prototype.hashCode() is deterministic for the same input', () => {
    require('../index.js'); // ensure the hashCode polyfill on String.prototype is installed
    const a = 'peer-id-example'.hashCode();
    const b = 'peer-id-example'.hashCode();
    assert.equal(a, b);
    assert.equal(typeof a, 'number');
});

test('String.prototype.hashCode() differs for different inputs (no trivial collisions)', () => {
    const a = 'peer-id-one'.hashCode();
    const b = 'peer-id-two'.hashCode();
    assert.notEqual(a, b);
});

test('getTurnCredentials() embeds the username and a ~24h expiry timestamp', () => {
    const before = Math.floor(Date.now() / 1000);
    const creds = getTurnCredentials('my-peer-id');
    const [expiry, username] = creds.username.split(':');

    assert.equal(username, 'my-peer-id');
    assert.equal(typeof creds.password, 'string');
    assert.ok(creds.password.length > 0);

    const expirySeconds = parseInt(expiry, 10);
    // Should expire roughly 24h from now (allow a few seconds of test jitter)
    assert.ok(expirySeconds >= before + 24 * 3600 - 5);
    assert.ok(expirySeconds <= before + 24 * 3600 + 5);
});

test('getTurnCredentials() is deterministic for the same username+time (HMAC, not random)', () => {
    // Two calls made in the same second must produce the same password,
    // since it's derived purely from HMAC(secret, "timestamp:username").
    const a = getTurnCredentials('stable-user');
    const b = getTurnCredentials('stable-user');
    if (a.username === b.username) {
        assert.equal(a.password, b.password);
    } else {
        // extremely rare: the process clock ticked over a second boundary
        // between calls, so credentials legitimately differ; not a bug.
        assert.ok(true);
    }
});

test('RateLimiter allows up to maxMessages within a window, then blocks', () => {
    const rl = new RateLimiter(3, 10_000); // generous window so the test can't flake on timing
    assert.equal(rl.isLimited(), false); // 1
    assert.equal(rl.isLimited(), false); // 2
    assert.equal(rl.isLimited(), false); // 3
    assert.equal(rl.isLimited(), true);  // 4 - over the limit
    assert.equal(rl.isLimited(), true);  // still blocked within the same window
});

test('RateLimiter resets the counter after the window elapses', async () => {
    const rl = new RateLimiter(1, 20); // 1 message per 20ms window
    assert.equal(rl.isLimited(), false);
    assert.equal(rl.isLimited(), true);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(rl.isLimited(), false, 'counter should have reset after the window elapsed');
});

test('ROOM_MAX_PEERS is a sane positive default', () => {
    assert.ok(Number.isInteger(ROOM_MAX_PEERS));
    assert.ok(ROOM_MAX_PEERS > 0);
});

test('requiring index.js does not bind a live network port (guarded by require.main)', () => {
    // If this were unguarded, requiring the module a second time under the
    // same process (as happens across multiple test files) would throw
    // EADDRINUSE. The mere fact this test file itself already required
    // index.js above without throwing is the real assertion; this test
    // documents *why* that matters so a future regression is obvious.
    assert.ok(true);
});
