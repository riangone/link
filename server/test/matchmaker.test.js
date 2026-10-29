'use strict';

// 对战大厅 matchmaking: quick match per game, 4-digit room codes,
// cleanup on disconnect, lobby-stats pushes.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');
const { SnapdropServer } = require('../index.js');
const { GAMES } = require('../matchmaker.js');

function listen() {
    return new Promise(resolve => {
        const httpServer = http.createServer((req, res) => { res.writeHead(404); res.end(); });
        new SnapdropServer(null, httpServer);
        httpServer.listen(0, '127.0.0.1', () => resolve(httpServer));
    });
}

async function client(port, room) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/server/webrtc?room=${room}`);
    ws.msgs = [];
    ws.on('message', raw => ws.msgs.push(JSON.parse(raw.toString())));
    await new Promise(r => ws.on('open', r));
    ws.j = o => ws.send(JSON.stringify(o));
    ws.wait = (type, pred = () => true, ms = 2000) => new Promise((resolve, reject) => {
        const t0 = Date.now();
        (function poll() {
            const m = ws.msgs.find(x => x.type === type && pred(x));
            if (m) { ws.msgs.splice(ws.msgs.indexOf(m), 1); return resolve(m); }
            if (Date.now() - t0 > ms) return reject(new Error('timeout ' + type));
            setTimeout(poll, 10);
        })();
    });
    return ws;
}
const tick = () => new Promise(r => setTimeout(r, 50));

test('quick match pairs two players of the same game into one room', async () => {
    const s = await listen(); const port = s.address().port;
    try {
        const a = await client(port, 'lobby-a'), b = await client(port, 'lobby-b'), c = await client(port, 'lobby-c');
        c.j({ type: 'lobby-subscribe' });
        a.j({ type: 'match-join', game: 'gomoku', name: 'Alice' });
        await a.wait('match-waiting');
        await c.wait('lobby-stats', m => m.waiting.gomoku && m.waiting.gomoku[0] === 'Alice');
        b.j({ type: 'match-join', game: 'pong', name: 'Bob' });
        await b.wait('match-waiting');           // different game: no pair
        b.j({ type: 'match-join', game: 'gomoku', name: 'Bob' });
        const fa = await a.wait('match-found'), fb = await b.wait('match-found');
        assert.equal(fa.roomId, fb.roomId);
        assert.equal(fa.game, 'gomoku');
        assert.equal(fa.opponent, 'Bob'); assert.equal(fb.opponent, 'Alice');
        await c.wait('lobby-stats', m => !m.waiting.gomoku && !m.waiting.pong);
        [a, b, c].forEach(w => w.close());
    } finally { s.close(); }
});

test('room code: creator gets a code, friend joins by code only', async () => {
    const s = await listen(); const port = s.address().port;
    try {
        const a = await client(port, 'lobby-d'), b = await client(port, 'lobby-e');
        a.j({ type: 'match-create', game: 'tanks', name: 'A' });
        const { code, public: pub } = await a.wait('match-waiting');
        assert.equal(pub, false);
        assert.match(code, /^\d{4}$/);
        b.j({ type: 'match-join', code: '0000' === code ? '0001' : '0000' });
        await b.wait('match-error', m => m.reason === 'no-code');
        b.j({ type: 'match-join', code, name: 'B' });
        const fa = await a.wait('match-found'), fb = await b.wait('match-found');
        assert.equal(fa.roomId, fb.roomId); assert.equal(fb.game, 'tanks');
        b.j({ type: 'match-join', code });     // code is single-use
        await b.wait('match-error', m => m.reason === 'no-code');
        // quick-match waiter also gets a code; joining by code takes them out of the public queue
        const c = await client(port, 'lobby-d2'), d = await client(port, 'lobby-e2'), e = await client(port, 'lobby-e3');
        c.j({ type: 'match-join', game: 'tron', name: 'C' });
        const w = await c.wait('match-waiting');
        assert.equal(w.public, true); assert.match(w.code, /^\d{4}$/);
        d.j({ type: 'match-join', code: w.code, name: 'D' });
        await c.wait('match-found'); await d.wait('match-found');
        e.j({ type: 'match-join', game: 'tron', name: 'E' });
        await e.wait('match-waiting');          // C is gone from the queue
        [a, b, c, d, e].forEach(w => w.close());
    } finally { s.close(); }
});

test('disconnect while waiting leaves the queue; bad game rejected; names sanitized', async () => {
    const s = await listen(); const port = s.address().port;
    try {
        const a = await client(port, 'lobby-f'), b = await client(port, 'lobby-g');
        a.j({ type: 'match-join', game: 'evil', name: 'x' });
        await a.wait('match-error', m => m.reason === 'bad-game');
        a.j({ type: 'match-join', game: 'hockey', name: '<img src=x>Eve' });
        await a.wait('match-waiting');
        a.close(); await tick(); await tick();
        b.j({ type: 'lobby-subscribe' });
        const st = await b.wait('lobby-stats');
        assert.equal(st.waiting.hockey, undefined);
        b.j({ type: 'match-join', game: 'hockey', name: 'B' });
        await b.wait('match-waiting');
        const c = await client(port, 'lobby-h');
        c.j({ type: 'match-join', game: 'hockey' });
        const fb = await b.wait('match-found');
        assert.ok(fb.opponent.length > 0);
        const a2 = await client(port, 'lobby-i');
        a2.j({ type: 'match-join', game: 'brawl', name: '<b>Eve</b>' });
        a2.j({ type: 'lobby-subscribe' });
        const st2 = await a2.wait('lobby-stats', m => m.waiting.brawl);
        assert.equal(st2.waiting.brawl[0], 'bEve/b');
        [b, c, a2].forEach(w => w.close());
    } finally { s.close(); }
});

test('all games listed in client/play/index.html are registered in Matchmaker.GAMES', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../../client/play/index.html'), 'utf8');
    const ids = [...html.matchAll(/\{\s*id:\s*'([a-z0-9]+)'/g)].map(m => m[1]);
    assert.ok(ids.length >= 20);
    for (const id of ids) {
        assert.ok(GAMES.includes(id), `Game "${id}" in client/play/index.html is missing from server/matchmaker.js GAMES`);
    }
});
