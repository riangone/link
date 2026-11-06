/**
 * Metrics: anonymous, aggregate-only funnel counters for the game platform.
 * Design and rationale: docs/analytics-events.md.
 *
 * Only counters keyed by enum dimensions reach the disk: no IP, nickname,
 * deviceId, pid, room id or room code. Room keys exist in memory only, to tie
 * a match's events together across the lobby and game-page connections.
 *
 * Client-reported events (`{type:'metric', ev, ...}`) can be forged. They are
 * bounded so they can't grow the file, and are good enough for product
 * decisions, but must never drive rankings or payouts.
 *
 * Same integration shape as Leaderboard: construct, then `handle()` in
 * SnapdropServer._onMessage. Pass `file = null` for memory only (tests).
 */
const fs = require('fs');
const path = require('path');

const SAVE_DELAY_MS = 5000;
const DAY_MS = 24 * 3600 * 1000;
const JST_OFFSET_MS = 9 * 3600 * 1000;
const RETAIN_DAYS = 90;
const ROOM_TTL_MS = 3 * 3600 * 1000;
const ROOM_MAX = 5000;
// Both players report the same match end, up to a network delay apart.
const DEDUP_MS = 5000;
// A long rematch streak must not hit this: it only stops one socket spamming.
const MAX_EVENTS_PER_CONN = 100;
const MAX_WEEK = 104;
const COHORT_RE = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

const VIAS = new Set(['link', 'manual']);
const SHARE_METHODS = new Set(['native', 'copy']);
const BOT_FROM = new Set(['lobby', 'waiting']);
const NET_KINDS = new Set(['direct', 'turn', 'ws', 'unknown']);

function bucket(seconds, edges) {
    for (const [limit, label] of edges) if (seconds < limit) return label;
    return edges.overflow;
}
const WAIT_EDGES = Object.assign([[5, '0-5s'], [15, '5-15s'], [30, '15-30s'], [60, '30-60s']], { overflow: '60s+' });
const DURATION_EDGES = Object.assign([[30, '0-30s'], [60, '30-60s'], [180, '1-3m'], [600, '3-10m']], { overflow: '10m+' });

class Metrics {
    /**
     * @param {string[]} games - accepted game folder names
     * @param {string|null} file - JSON file to persist to, or null for memory only
     * @param {() => number} [now] - clock, injectable for tests
     */
    constructor(games, file, now = Date.now) {
        this._games = new Set(games);
        this._file = file;
        this._now = now;
        this._data = { days: {}, retention: {} };
        this._rooms = new Map(); // room key -> { game, source, via, ready, ts, last: {ev: ms} }
        this._saveTimer = null;
        if (file) this._load();
    }

    /** The `peer.ip` a matched player gets: game pages connect with ?room=room-<roomId>. */
    static roomKey(roomId) { return 'room-room-' + roomId; }

    // --- server-side events ---------------------------------------------------

    lobbyOpen() { this._count('lobby_open'); }

    queueJoin(game, kind) { this._count('queue_join', game, kind); }

    queueLeave(game, reason, waitMs) { this._count('queue_leave', game, reason, Metrics._wait(waitMs)); }

    codeJoin(via, result) { this._count('code_join', Metrics._via(via), result); }

    matchFound(roomId, { game, source, via, waitMs }) {
        const v = source === 'code' ? Metrics._via(via) : '-';
        this._count('match_found', game, source, v, Metrics._wait(waitMs));
        this._remember(Metrics.roomKey(roomId), { game, source, via: v, ready: false });
    }

    /** @param {string} roomKey - peer.ip  @param {number} size - peers now in the room */
    peerJoined(roomKey, size) {
        const room = this._rooms.get(roomKey);
        if (!room || room.ready || size < 2) return;
        room.ready = true;
        this._count('room_ready', room.game, room.source, room.via);
    }

    // --- client-reported events -----------------------------------------------

    /**
     * @param {object} peer
     * @param {object} msg
     * @param {number} roomSize - peers currently in the sender's room
     * @returns {boolean} true if the message was a metric message
     */
    handle(peer, msg, roomSize) {
        if (!msg || msg.type !== 'metric') return false;
        peer.metricEvents = (peer.metricEvents || 0) + 1;
        if (peer.metricEvents > MAX_EVENTS_PER_CONN) return true;
        switch (msg.ev) {
            case 'visit': this._visit(msg); break;
            case 'share_click':
                if (this._games.has(msg.game) && SHARE_METHODS.has(msg.method)) this._count('share_click', msg.game, msg.method);
                break;
            case 'bot_start':
                if (this._games.has(msg.game) && BOT_FROM.has(msg.from)) this._count('bot_start', msg.game, msg.from);
                break;
            case 'net_result':
                if (this._games.has(msg.game) && NET_KINDS.has(msg.kind)) this._count('net_result', msg.game, msg.kind);
                break;
            case 'match_end':
                if (Number.isFinite(msg.sec) && msg.sec >= 0) {
                    const duration = bucket(msg.sec, DURATION_EDGES);
                    this._matchEvent(peer, msg, roomSize, 'match_end', (r) => [r.game, r.source, r.via, duration]);
                }
                break;
            case 'rematch':
                this._matchEvent(peer, msg, roomSize, 'rematch', (r) => [r.game, r.source, r.via]);
                break;
        }
        return true;
    }

    _matchEvent(peer, msg, roomSize, ev, dims) {
        // The room comes from the connection, never from the client. A bot
        // game or a lone tab can't report a match; IP-scoped peers never get a
        // room entry, so no IP is held here.
        if (roomSize < 2 || typeof peer.ip !== 'string' || !peer.ip.startsWith('room-')) return;
        let room = this._rooms.get(peer.ip);
        if (!room) {
            // e.g. a game-invite.js room: never went through the matchmaker
            if (!this._games.has(msg.game)) return;
            room = this._remember(peer.ip, { game: msg.game, source: 'other', via: '-', ready: true });
        }
        const now = this._now();
        if (now - (room.last[ev] || -Infinity) < DEDUP_MS) return;
        room.last[ev] = now;
        this._count(ev, ...dims(room));
    }

    _visit(msg) {
        const m = typeof msg.cohort === 'string' && COHORT_RE.exec(msg.cohort);
        if (!m || !Number.isInteger(msg.week) || msg.week < 0 || msg.week > MAX_WEEK) return;
        // keeps the number of cohorts, and so the file, bounded
        const year = new Date(this._now()).getUTCFullYear();
        if (+m[1] < year - 2 || +m[1] > year + 1) return;
        const row = this._data.retention[msg.cohort] || (this._data.retention[msg.cohort] = {});
        row[msg.week] = (row[msg.week] || 0) + 1;
        this._scheduleSave();
    }

    // --- internals ------------------------------------------------------------

    _remember(key, fields) {
        const now = this._now();
        // same TTL for all, so insertion order is also expiry order
        for (const [k, r] of this._rooms) {
            if (now - r.ts <= ROOM_TTL_MS && this._rooms.size < ROOM_MAX) break;
            this._rooms.delete(k);
        }
        const room = Object.assign({ ts: now, last: {} }, fields);
        this._rooms.set(key, room);
        return room;
    }

    _count(ev, ...dims) {
        const day = new Date(this._now() + JST_OFFSET_MS).toISOString().slice(0, 10);
        const table = this._data.days[day] || (this._data.days[day] = {});
        const key = [ev, ...dims].join('|');
        table[key] = (table[key] || 0) + 1;
        this._scheduleSave();
    }

    static _via(via) { return VIAS.has(via) ? via : 'unknown'; }

    static _wait(ms) { return bucket(Math.max(0, ms) / 1000, WAIT_EDGES); }

    _trimDays() {
        const cutoff = new Date(this._now() + JST_OFFSET_MS - RETAIN_DAYS * DAY_MS).toISOString().slice(0, 10);
        for (const day of Object.keys(this._data.days)) if (day < cutoff) delete this._data.days[day];
    }

    _load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this._file, 'utf8'));
            if (raw && typeof raw === 'object') {
                this._data.days = raw.days || {};
                this._data.retention = raw.retention || {};
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.error('metrics: could not load', this._file, e.message);
        }
    }

    _scheduleSave() {
        if (!this._file || this._saveTimer) return;
        this._saveTimer = setTimeout(() => { this._saveTimer = null; this.flush(); }, SAVE_DELAY_MS);
        if (this._saveTimer.unref) this._saveTimer.unref();
    }

    flush() {
        if (!this._file) return;
        try {
            this._trimDays();
            fs.mkdirSync(path.dirname(this._file), { recursive: true });
            const tmp = this._file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this._data));
            fs.renameSync(tmp, this._file);
        } catch (e) {
            console.error('metrics: could not save', this._file, e.message);
        }
    }
}

Metrics.MAX_EVENTS_PER_CONN = MAX_EVENTS_PER_CONN;
Metrics.DEDUP_MS = DEDUP_MS;

module.exports = { Metrics };
