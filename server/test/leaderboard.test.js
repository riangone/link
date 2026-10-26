const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Leaderboard } = require('../leaderboard');

const PID_A = 'a'.repeat(24), PID_B = 'b'.repeat(24);
const row = (o) => Object.assign({ game: 'spin', pid: PID_A, name: 'Ann', rp: 10, tw: 0, w: 1, l: 0 }, o);

test('submit + get: sorted by rp, own row marked, pid never echoed', () => {
    const lb = new Leaderboard(['spin'], null);
    assert.ok(lb.submit(row({}), 0).ok);
    assert.ok(lb.submit(row({ pid: PID_B, name: 'Bob', rp: 50 }), 0).ok);
    const res = lb.get('spin', PID_A);
    assert.deepStrictEqual(res.top.map(r => r.name), ['Bob', 'Ann']);
    assert.strictEqual(res.top[1].me, true);
    assert.strictEqual(res.top[0].me, undefined);
    assert.ok(!JSON.stringify(res).includes(PID_A));
});

test('rejects unknown game, bad pid, bad fields, oversized gain and rapid resubmits', () => {
    const lb = new Leaderboard(['spin'], null);
    assert.strictEqual(lb.submit(row({ game: 'nope' }), 0).error, 'game');
    assert.strictEqual(lb.submit(row({ pid: 'short' }), 0).error, 'pid');
    assert.strictEqual(lb.submit(row({ rp: -1 }), 0).error, 'fields');
    assert.strictEqual(lb.submit(row({ rp: 1.5 }), 0).error, 'fields');
    assert.strictEqual(lb.submit(row({ name: '‮  ' }), 0).error, 'name');
    assert.strictEqual(lb.submit(row({ rp: Leaderboard.MAX_FIRST_RP + 1 }), 0).error, 'gain');
    assert.ok(lb.submit(row({ rp: 100 }), 0).ok);
    assert.strictEqual(lb.submit(row({ rp: 120 }), 10).error, 'rate');
    const t = Leaderboard.MIN_SUBMIT_MS + 1;
    assert.strictEqual(lb.submit(row({ rp: 100 + Leaderboard.MAX_RP_GAIN + 1 }), t).error, 'gain');
    assert.ok(lb.submit(row({ rp: 90, name: 'Ann2' }), t).ok);   // losses allowed
    assert.strictEqual(lb.get('spin').top[0].rp, 90);
});

test('players outside the top N still get their own rank', () => {
    const lb = new Leaderboard(['spin'], null);
    for (let i = 0; i < Leaderboard.TOP_N + 5; i++) {
        lb.submit(row({ pid: 'p' + String(i).padStart(20, '0'), name: 'P' + i, rp: 100 + i }), 0);
    }
    lb.submit(row({ rp: 1 }), 0);
    const res = lb.get('spin', PID_A);
    assert.strictEqual(res.top.length, Leaderboard.TOP_N);
    assert.strictEqual(res.me.rank, Leaderboard.TOP_N + 6);
    assert.strictEqual(res.total, Leaderboard.TOP_N + 6);
});

test('persists to a file and reloads', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lb-')), 'sub', 'lb.json');
    const lb = new Leaderboard(['spin'], file);
    lb.submit(row({ rp: 42 }), 0);
    lb.flush();
    const again = new Leaderboard(['spin'], file);
    assert.strictEqual(again.get('spin', PID_A).top[0].rp, 42);
});

test('handle() answers lb-get / lb-submit and ignores other messages', () => {
    const lb = new Leaderboard(['spin'], null);
    const out = [];
    const send = (p, m) => out.push(m);
    assert.strictEqual(lb.handle({}, { type: 'signal' }, send), false);
    assert.strictEqual(lb.handle({}, Object.assign(row({}), { type: 'lb-submit' }), send), true);
    assert.strictEqual(out[0].type, 'lb-ok');
    assert.strictEqual(out[0].rank, 1);
    lb.handle({}, { type: 'lb-get', game: 'spin', pid: PID_A }, send);
    assert.strictEqual(out[1].type, 'lb-data');
    assert.strictEqual(out[1].top[0].me, true);
});
