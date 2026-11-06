'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { SnapdropServer } = require('../index.js');
const { Metrics } = require('../metrics.js');
const { GAMES } = require('../matchmaker.js');

const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function listen() {
    return new Promise(resolve => {
        const httpServer = http.createServer((req, res) => { res.writeHead(404); res.end(); });
        const server = new SnapdropServer(null, httpServer);
        httpServer.listen(0, '127.0.0.1', () => resolve({ httpServer, server, port: httpServer.address().port }));
    });
}

async function client(port, room) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/server/webrtc?room=${room}`);
    ws.msgs = [];
    ws.on('message', raw => ws.msgs.push(JSON.parse(raw.toString())));
    await new Promise(r => ws.on('open', r));
    ws.j = o => ws.send(JSON.stringify(o));
    ws.wait = async (type) => {
        for (let i = 0; i < 200; i++) {
            const m = ws.msgs.find(x => x.type === type);
            if (m) { ws.msgs.splice(ws.msgs.indexOf(m), 1); return m; }
            await new Promise(r => setTimeout(r, 10));
        }
        throw new Error('timeout ' + type);
    };
    return ws;
}
const tick = () => new Promise(r => setTimeout(r, 60));
const counts = s => s._metrics._data.days[today()] || {};

test('a code match is tracked from the lobby through to the game room', async () => {
    const { httpServer, server, port } = await listen();
    const a = await client(port, 'lobby-a'), b = await client(port, 'lobby-b');
    a.j({ type: 'match-create', game: 'pong', name: 'A' });
    const { code } = await a.wait('match-waiting');
    b.j({ type: 'match-join', code, name: 'B', via: 'link' });
    const { roomId } = await a.wait('match-found');

    const c = counts(server);
    assert.equal(c['queue_join|pong|private'], 1);
    assert.equal(c['code_join|link|ok'], 1);
    assert.equal(c['match_found|pong|code|link|0-5s'], 1);
    assert.equal(c['room_ready|pong|code|link'], undefined);

    const ga = await client(port, 'room-' + roomId);
    ga.j({ type: 'metric', ev: 'match_end', game: 'pong', sec: 40 }); // alone: not a match
    await tick();
    assert.equal(counts(server)['match_end|pong|code|link|30-60s'], undefined);

    const gb = await client(port, 'room-' + roomId);
    await tick();
    assert.equal(counts(server)['room_ready|pong|code|link'], 1);

    // both report the same round; the client's claimed game is ignored
    ga.j({ type: 'metric', ev: 'match_end', game: 'pong', sec: 40 });
    gb.j({ type: 'metric', ev: 'match_end', game: 'tanks', sec: 41 });
    ga.j({ type: 'metric', ev: 'rematch', game: 'pong' });
    await tick();
    assert.equal(counts(server)['match_end|pong|code|link|30-60s'], 1);
    assert.equal(counts(server)['match_end|tanks|code|link|30-60s'], undefined);
    assert.equal(counts(server)['rematch|pong|code|link'], 1);

    for (const w of [a, b, ga, gb]) w.terminate();
    httpServer.close();
});

test('quick match, leave reasons and a bad code', async () => {
    const { httpServer, server, port } = await listen();
    const a = await client(port, 'lobby-a'), b = await client(port, 'lobby-b'), c = await client(port, 'lobby-c');
    a.j({ type: 'match-join', game: 'tanks', name: 'A' });
    await a.wait('match-waiting');
    b.j({ type: 'match-join', game: 'tanks', name: 'B' });
    await b.wait('match-found');
    assert.equal(counts(server)['match_found|tanks|quick|-|0-5s'], 1);

    c.j({ type: 'match-join', game: 'hockey', name: 'C' });
    await c.wait('match-waiting');
    c.j({ type: 'match-leave', reason: 'bot' });
    await tick();
    assert.equal(counts(server)['queue_leave|hockey|bot|0-5s'], 1);

    c.j({ type: 'match-join', game: 'hockey', name: 'C' });
    await c.wait('match-waiting');
    c.terminate();
    await tick();
    assert.equal(counts(server)['queue_leave|hockey|disconnect|0-5s'], 1);

    a.j({ type: 'match-join', code: '0000' });
    await a.wait('match-error');
    assert.equal(counts(server)['code_join|unknown|no_code'], 1, 'old clients send no via');

    a.terminate(); b.terminate();
    httpServer.close();
});

test('invalid client events are dropped and do not grow the table', () => {
    const m = new Metrics(GAMES, null);
    const p = { ip: 'room-x' };
    const bad = [
        { ev: 'share_click', game: 'nope', method: 'copy' },
        { ev: 'share_click', game: 'pong', method: 'x'.repeat(50) },
        { ev: 'bot_start', game: 'pong', from: 'elsewhere' },
        { ev: 'net_result', game: 'pong', kind: 'p2p' },
        { ev: 'match_end', game: 'pong', sec: 'long' },
        { ev: 'match_end', game: 'nope', sec: 5 },
        { ev: 'whatever' },
        { ev: 'visit', cohort: 'evil', week: 0 },
        { ev: 'visit', cohort: '1999-W01', week: 0 },
        { ev: 'visit', cohort: '2026-W45', week: 9999 },
    ];
    for (const e of bad) assert.equal(m.handle(p, Object.assign({ type: 'metric' }, e), 2), true);
    assert.deepEqual(m._data.days, {});
    assert.deepEqual(m._data.retention, {});
    assert.equal(m.handle(p, { type: 'lb-get' }, 2), false);
});

test('each connection has an event budget', () => {
    const m = new Metrics(GAMES, null);
    const p = { ip: 'room-x' };
    for (let i = 0; i < Metrics.MAX_EVENTS_PER_CONN + 10; i++) {
        m.handle(p, { type: 'metric', ev: 'share_click', game: 'pong', method: 'copy' }, 2);
    }
    const day = Object.keys(m._data.days)[0];
    assert.equal(m._data.days[day]['share_click|pong|copy'], Metrics.MAX_EVENTS_PER_CONN);
});

test('match events need a room, a second player, and separate rounds count separately', () => {
    let now = 1e12;
    const m = new Metrics(GAMES, null, () => now);
    const end = { type: 'metric', ev: 'match_end', game: 'pong', sec: 5 };
    m.handle({ ip: '203.0.113.9' }, end, 2); // IP-scoped peer
    m.handle({ ip: 'room-x' }, end, 1);      // bot/lone tab
    assert.deepEqual(m._data.days, {});
    assert.equal(m._rooms.size, 0, 'no IP is kept even in memory');

    m.handle({ ip: 'room-x' }, end, 2);
    m.handle({ ip: 'room-x' }, end, 2);
    now += Metrics.DEDUP_MS + 1;
    m.handle({ ip: 'room-x' }, end, 2);
    const day = Object.keys(m._data.days)[0];
    assert.equal(m._data.days[day]['match_end|pong|other|-|0-30s'], 2);
});

test('the persisted file holds aggregates only and old days are trimmed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-'));
    const file = path.join(dir, 'metrics.json');
    let now = Date.UTC(2026, 10, 6, 3);
    const m = new Metrics(GAMES, file, () => now);
    m.handle({ ip: 'room-secretroom', deviceId: 'dev-1', lobbyName: 'Alice' }, { type: 'metric', ev: 'match_end', game: 'pong', sec: 5, name: 'Alice' }, 2);
    m.handle({ ip: '203.0.113.9' }, { type: 'metric', ev: 'visit', cohort: '2026-W45', week: 1 }, 1);
    m.matchFound('abcdef', { game: 'pong', source: 'code', via: 'link', waitMs: 7000 });
    m.flush();
    const raw = fs.readFileSync(file, 'utf8');
    for (const secret of ['secretroom', 'dev-1', 'Alice', '203.0.113.9', 'abcdef']) assert.ok(!raw.includes(secret), secret);
    assert.deepEqual(JSON.parse(raw).retention, { '2026-W45': { 1: 1 } });

    const reloaded = new Metrics(GAMES, file, () => now);
    assert.equal(reloaded._data.days['2026-11-06']['match_found|pong|code|link|5-15s'], 1);

    now += 91 * 24 * 3600 * 1000;
    reloaded.lobbyOpen();
    reloaded.flush();
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).days), ['2027-02-05']);
    fs.rmSync(dir, { recursive: true });
});
