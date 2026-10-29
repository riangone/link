/**
 * Matchmaker: the "对战大厅" (client/play/) server side.
 *
 * Two ways for strangers / friends on different networks to meet without
 * passing URLs around:
 *
 *   1. Quick match  — `match-join {game}`: if someone is already waiting
 *      for that game, both are paired instantly; otherwise you wait in the
 *      public queue AND get a 4-digit code a friend can use.
 *   2. Private room — `match-create {game}`: code only, not in the queue.
 *   A friend joins either with `match-join {code}` (no need to know the game).
 *
 * On a pair, both peers get `match-found {game, roomId, opponent}` and
 * navigate to `<game>/?opponent=<name>#room-<roomId>` — the exact same
 * entry point game-invite.js uses, so the games need no changes.
 *
 * Lobby pages send `lobby-subscribe` to receive `lobby-stats`
 * ({waiting: {game: [names]}, online}) whenever the queues change.
 *
 * Kept as its own module so server/index.js only needs three hook lines:
 * construct, `handle()` in _onMessage, `remove()` in _leaveRoom.
 */
const crypto = require('crypto');

const GAMES = ['gomoku', 'pong', 'hockey', 'tanks', 'brawl', 'tron', 'blaster', 'blocks', 'bombs', 'tag', 'paint', 'kart', 'kart3d', 'spin', 'armor', 'volley', 'soccer', 'tennis', 'hoops', 'oni'];
const CODE_RE = /^\d{4}$/;
const NAME_MAX = 16;
const CODE_TTL_MS = 30 * 60 * 1000;

class Matchmaker {
    /** @param {(peer, msg) => void} send */
    constructor(send) {
        this._send = send;
        this._quick = new Map();   // game -> peer waiting for a random opponent
        this._codes = new Map();   // code -> { peer, game, ts }
        this._waitingOf = new Map(); // peer -> { quick?: game, code?: string }
        this._subscribers = new Set();
    }

    static get GAMES() { return GAMES; }

    /** @returns {boolean} true if the message was a matchmaking message */
    handle(peer, msg) {
        switch (msg && msg.type) {
            case 'lobby-subscribe':
                this._subscribers.add(peer);
                this._broadcast();
                return true;
            case 'match-join':
                peer.lobbyName = Matchmaker._cleanName(msg.name) || (peer.name && peer.name.displayName) || '?';
                if (typeof msg.code === 'string') this._joinCode(peer, msg.code);
                else this._joinQuick(peer, msg.game);
                return true;
            case 'match-create':
                peer.lobbyName = Matchmaker._cleanName(msg.name) || (peer.name && peer.name.displayName) || '?';
                this._create(peer, msg.game);
                return true;
            case 'match-leave':
                this._unqueue(peer);
                this._broadcast();
                return true;
            default:
                return false;
        }
    }

    /** Called when a peer disconnects. */
    remove(peer) {
        const wasSub = this._subscribers.delete(peer);
        if (this._unqueue(peer) || wasSub) this._broadcast();
    }

    _joinQuick(peer, game) {
        if (!GAMES.includes(game)) return this._send(peer, { type: 'match-error', reason: 'bad-game' });
        this._unqueue(peer);
        const other = this._quick.get(game);
        if (other && other !== peer) {
            this._unqueue(other);
            this._pair(other, peer, game);
        } else {
            // public queue + a private code at the same time: whichever
            // comes first (a stranger or the friend you sent the code to) wins
            const code = this._newCode();
            this._quick.set(game, peer);
            if (code) this._codes.set(code, { peer, game, ts: Date.now() });
            this._waitingOf.set(peer, { quick: game, code });
            this._send(peer, { type: 'match-waiting', game, code, public: true });
        }
        this._broadcast();
    }

    /** Private room: only reachable by code, not listed in the quick queue. */
    _create(peer, game) {
        if (!GAMES.includes(game)) return this._send(peer, { type: 'match-error', reason: 'bad-game' });
        this._unqueue(peer);
        const code = this._newCode();
        if (!code) return this._send(peer, { type: 'match-error', reason: 'busy' });
        this._codes.set(code, { peer, game, ts: Date.now() });
        this._waitingOf.set(peer, { code });
        this._send(peer, { type: 'match-waiting', game, code, public: false });
        this._broadcast();
    }

    _newCode() {
        this._expireCodes();
        for (let i = 0; i < 50; i++) {
            const c = String(crypto.randomInt(1000, 10000));
            if (!this._codes.has(c)) return c;
        }
        return null;
    }

    _joinCode(peer, code) {
        this._expireCodes();
        const entry = CODE_RE.test(code) && this._codes.get(code);
        if (!entry || entry.peer === peer) return this._send(peer, { type: 'match-error', reason: 'no-code' });
        this._unqueue(peer);
        this._unqueue(entry.peer);
        this._pair(entry.peer, peer, entry.game);
        this._broadcast();
    }

    _pair(a, b, game) {
        const roomId = crypto.randomBytes(6).toString('hex');
        this._send(a, { type: 'match-found', game, roomId, opponent: b.lobbyName });
        this._send(b, { type: 'match-found', game, roomId, opponent: a.lobbyName });
    }

    _unqueue(peer) {
        const w = this._waitingOf.get(peer);
        if (!w) return false;
        this._waitingOf.delete(peer);
        if (w.quick && this._quick.get(w.quick) === peer) this._quick.delete(w.quick);
        if (w.code && this._codes.get(w.code) && this._codes.get(w.code).peer === peer) this._codes.delete(w.code);
        return true;
    }

    _expireCodes() {
        const now = Date.now();
        for (const [code, e] of this._codes) {
            if (now - e.ts > CODE_TTL_MS) {
                this._unqueue(e.peer);
                this._send(e.peer, { type: 'match-error', reason: 'expired' });
            }
        }
    }

    _stats() {
        const waiting = {};
        for (const [game, p] of this._quick) waiting[game] = [p.lobbyName];
        return { type: 'lobby-stats', waiting, online: this._subscribers.size };
    }

    _broadcast() {
        const msg = this._stats();
        for (const p of this._subscribers) this._send(p, msg);
    }

    static _cleanName(name) {
        if (typeof name !== 'string') return '';
        return name.replace(/[\u0000-\u001f<>"'&]/g, '').trim().slice(0, NAME_MAX);
    }
}

module.exports = { Matchmaker, GAMES };
