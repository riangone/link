/**
 * Leaderboard: per-game score tables for the P2P games (client/<game>/).
 *
 * Games already talk to this process over the signaling WebSocket, so the
 * board rides on the same socket instead of adding an HTTP API (nginx only
 * proxies /server to us as a WebSocket upgrade anyway):
 *
 *   lb-submit {game, pid, name, rp, tw, w, l}  → lb-ok {game, rank}
 *   lb-get    {game, pid?}                     → lb-data {game, top:[...], me?}
 *
 * `pid` is a random secret the browser keeps in localStorage. It is never
 * stored or sent back: rows are keyed by sha256(pid), and lb-data only marks
 * the caller's own row with `me: true`. So nobody can overwrite somebody
 * else's row by reading the board.
 *
 * Scores are client-reported (the games are host-authoritative P2P with no
 * server simulation), so this is an honor-system board with cheap sanity
 * limits: bounded fields, a cap on how much RP one submit can add (a looser
 * one for a player's first submit, since profiles are local), and a
 * minimum interval between submits per player. Good enough for a hobby
 * arcade; not a ranked ladder.
 *
 * Persistence: one JSON file, written atomically (tmp + rename), debounced.
 * Pass `file = null` for an in-memory board (unit tests).
 *
 * Same integration shape as Matchmaker: construct, then `handle()` in
 * SnapdropServer._onMessage.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NAME_MAX = 16;
const TOP_N = 50;
const MAX_ROWS_PER_GAME = 5000;
const MAX_RP = 1e6;
const MAX_RP_GAIN = 400;          // per submit
const MAX_FIRST_RP = 6000;        // first submit: profiles built before the board existed
const MIN_SUBMIT_MS = 4000;       // per player
const SAVE_DELAY_MS = 2000;

class Leaderboard {
    /**
     * @param {string[]} games - accepted game folder names
     * @param {string|null} file - JSON file to persist to, or null for memory only
     */
    constructor(games, file) {
        this._games = new Set(games);
        this._file = file;
        this._data = {};          // game -> { [key]: row }
        this._saveTimer = null;
        if (file) this._load();
    }

    /** @returns {boolean} true if the message was a leaderboard message */
    handle(peer, msg, send) {
        switch (msg && msg.type) {
            case 'lb-submit': {
                const res = this.submit(msg, Date.now());
                send(peer, Object.assign({ type: res.ok ? 'lb-ok' : 'lb-error', game: msg.game }, res));
                return true;
            }
            case 'lb-get':
                if (!this._games.has(msg.game)) return true;
                send(peer, Object.assign({ type: 'lb-data', game: msg.game }, this.get(msg.game, msg.pid)));
                return true;
        }
        return false;
    }

    submit(msg, now) {
        if (!this._games.has(msg.game)) return { ok: false, error: 'game' };
        const key = Leaderboard._key(msg.pid);
        if (!key) return { ok: false, error: 'pid' };
        const name = Leaderboard._cleanName(msg.name);
        if (!name) return { ok: false, error: 'name' };
        const rp = Leaderboard._int(msg.rp, MAX_RP), tw = Leaderboard._int(msg.tw, 99);
        const w = Leaderboard._int(msg.w, 1e6), l = Leaderboard._int(msg.l, 1e6);
        if (rp === null || tw === null || w === null || l === null) return { ok: false, error: 'fields' };

        const table = this._data[msg.game] || (this._data[msg.game] = {});
        const old = table[key];
        if (old) {
            if (now - old.ts < MIN_SUBMIT_MS) return { ok: false, error: 'rate' };
            if (rp - old.rp > MAX_RP_GAIN) return { ok: false, error: 'gain' };
        } else if (rp > MAX_FIRST_RP) {
            return { ok: false, error: 'gain' };
        }
        table[key] = { name, rp, tw, w, l, ts: now };
        this._trim(table);
        this._scheduleSave();
        return { ok: true, rank: this._rankOf(msg.game, key) };
    }

    get(game, pid) {
        const table = this._data[game] || {};
        const mine = Leaderboard._key(pid);
        const sorted = Leaderboard._sorted(table);
        const row = (k, i) => {
            const r = table[k];
            const out = { rank: i + 1, name: r.name, rp: r.rp, tw: r.tw, w: r.w, l: r.l };
            if (k === mine) out.me = true;
            return out;
        };
        const res = { top: sorted.slice(0, TOP_N).map(row), total: sorted.length };
        if (mine && table[mine]) {
            const i = sorted.indexOf(mine);
            if (i >= TOP_N) res.me = row(mine, i);
        }
        return res;
    }

    _rankOf(game, key) { return Leaderboard._sorted(this._data[game]).indexOf(key) + 1; }

    _trim(table) {
        const keys = Object.keys(table);
        if (keys.length <= MAX_ROWS_PER_GAME) return;
        for (const k of Leaderboard._sorted(table).slice(MAX_ROWS_PER_GAME)) delete table[k];
    }

    static _sorted(table) {
        return Object.keys(table || {}).sort((a, b) => {
            const x = table[a], y = table[b];
            return (y.rp - x.rp) || (y.tw - x.tw) || (y.w - x.w) || (x.ts - y.ts);
        });
    }

    static _key(pid) {
        if (typeof pid !== 'string' || pid.length < 16 || pid.length > 64) return null;
        return crypto.createHash('sha256').update(pid).digest('hex').slice(0, 32);
    }

    static _cleanName(n) {
        if (typeof n !== 'string') return '';
        // strip control / bidi-override characters, collapse whitespace
        return n.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
            .replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    }

    static _int(v, max) {
        return Number.isInteger(v) && v >= 0 && v <= max ? v : null;
    }

    _load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this._file, 'utf8'));
            if (raw && typeof raw === 'object') {
                for (const g of Object.keys(raw)) if (this._games.has(g)) this._data[g] = raw[g];
            }
        } catch (e) {
            if (e.code !== 'ENOENT') console.error('leaderboard: could not load', this._file, e.message);
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
            fs.mkdirSync(path.dirname(this._file), { recursive: true });
            const tmp = this._file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this._data));
            fs.renameSync(tmp, this._file);
        } catch (e) {
            console.error('leaderboard: could not save', this._file, e.message);
        }
    }
}

Leaderboard.MAX_RP_GAIN = MAX_RP_GAIN;
Leaderboard.MAX_FIRST_RP = MAX_FIRST_RP;
Leaderboard.MIN_SUBMIT_MS = MIN_SUBMIT_MS;
Leaderboard.TOP_N = TOP_N;

module.exports = { Leaderboard };
