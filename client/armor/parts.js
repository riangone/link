/**
 * Link Armor — custom tanks (改装工坊): core + gun + hull + track.
 *
 * Pure data + rules, no DOM, loadable in Node:
 *   CORES        the 4 base tanks (type, special move, matchups come from here)
 *   PARTS        per slot; every non-standard part has an upside AND a downside
 *   CAP          energy budget: Σ part cost ≤ CAP (same for everyone online)
 *   sanitize()   what the host runs on every cfg a peer sends
 *   build()      cfg → the stats object the simulation reads
 */
(function (root) {
    'use strict';

    var CORES = {
        rapid: { icon: '⚡', name: 'BLITZ', col: '#ffb020', hp: 90, spd: 2.55, r: 17, rl: 13, dmg: 8, bs: 9.5, turn: 0.10, splash: 0, len: 13 },
        heavy: { icon: '🛡️', name: 'TITAN', col: '#7dff6a', hp: 140, spd: 1.85, r: 21, rl: 42, dmg: 24, bs: 7.2, turn: 0.055, splash: 40, len: 15 },
        sniper: { icon: '🎯', name: 'HAWK', col: '#b98cff', hp: 80, spd: 2.25, r: 17, rl: 58, dmg: 30, bs: 15, turn: 0.075, splash: 0, len: 22 },
        balance: { icon: '⭐', name: 'ACE', col: '#ffe14d', hp: 105, spd: 2.2, r: 18, rl: 26, dmg: 14, bs: 10.5, turn: 0.08, splash: 0, len: 16 }
    };
    var CORE_IDS = ['rapid', 'heavy', 'sniper', 'balance'];
    var SLOTS = ['gun', 'hull', 'track'];
    var CAP = 6;
    var NAME_MAX = 10;

    var PARTS = {
        gun: [
            { id: 'std', icon: '🔩', cost: 0 },
            { id: 'quick', icon: '⚡', cost: 1, mul: { rl: 0.85, dmg: 0.90 } },
            { id: 'long', icon: '🔭', cost: 2, add: { len: 4 }, mul: { bs: 1.25, turn: 0.82 } },
            { id: 'heavy', icon: '💣', cost: 2, mul: { dmg: 1.22, rl: 1.15, bs: 0.92 } },
            { id: 'twin', icon: '🔥', cost: 3, mul: { rl: 0.72, dmg: 0.82, bs: 0.90 } }
        ],
        hull: [
            { id: 'std', icon: '🛡️', cost: 0 },
            { id: 'light', icon: '🪶', cost: 1, add: { r: -1 }, mul: { spd: 1.09, hp: 0.88 } },
            { id: 'plate', icon: '🧱', cost: 2, add: { r: 1 }, mul: { hp: 1.20, spd: 0.91 } },
            { id: 'sloped', icon: '📐', cost: 2, mul: { hp: 1.12, turn: 1.15, dmg: 0.92 } },
            { id: 'fort', icon: '🏰', cost: 3, add: { r: 2 }, mul: { hp: 1.32, spd: 0.84 } }
        ],
        track: [
            { id: 'std', icon: '⚙️', cost: 0 },
            { id: 'grip', icon: '🛞', cost: 1, mul: { turn: 1.22, spd: 0.95 } },
            { id: 'turbo', icon: '🚀', cost: 2, mul: { spd: 1.14, hp: 0.92 } },
            { id: 'dash', icon: '💨', cost: 2, mul: { dcd: 0.72, spd: 0.95 } },
            { id: 'omni', icon: '🌀', cost: 3, mul: { spd: 1.10, turn: 1.25, dcd: 0.85, hp: 0.88 } }
        ]
    };

    var COLORS = ['#ffb020', '#7dff6a', '#b98cff', '#ffe14d', '#ff3fb4', '#2de2ff', '#ff5b7a', '#e8ecf8'];

    function isCore(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(CORES, k); }
    function find(slot, id) {
        var list = Object.prototype.hasOwnProperty.call(PARTS, slot) ? PARTS[slot] : [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }
    function defaultCfg(core) {
        return { core: isCore(core) ? core : 'balance', gun: 'std', hull: 'std', track: 'std', col: -1, name: '' };
    }
    function cost(cfg) {
        var n = 0;
        SLOTS.forEach(function (s) { var p = find(s, cfg && cfg[s]); n += p ? p.cost : 0; });
        return n;
    }
    function cleanName(s) {
        return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim().slice(0, NAME_MAX);
    }

    function sanitize(raw, fallbackCore) {
        var c = raw && typeof raw === 'object' ? raw : {};
        var out = defaultCfg(isCore(c.core) ? c.core : fallbackCore);
        var ok = true;
        SLOTS.forEach(function (s) {
            if (c[s] === undefined || c[s] === null) return;
            if (find(s, c[s])) out[s] = c[s]; else ok = false;
        });
        if (cost(out) > CAP) ok = false;
        if (!ok) { out.gun = out.hull = out.track = 'std'; }
        var col = Number(c.col);
        out.col = Number.isInteger(col) && col >= 0 && col < COLORS.length ? col : -1;
        out.name = cleanName(c.name);
        return { cfg: out, ok: ok };
    }

    function build(raw) {
        var cfg = sanitize(raw).cfg;
        var src = CORES[cfg.core], b = {};
        for (var k in src) b[k] = src[k];
        b.type = cfg.core;
        b.dcd = 120;
        SLOTS.forEach(function (s) {
            var p = find(s, cfg[s]);
            var m = p.mul || {}, a = p.add || {};
            for (var x in m) b[x] *= m[x];
            for (var y in a) b[y] += a[y];
        });
        b.hp = Math.round(b.hp);
        b.rl = Math.max(4, Math.round(b.rl));
        b.dmg = Math.max(1, Math.round(b.dmg));
        b.dcd = Math.max(40, Math.round(b.dcd));
        if (cfg.col >= 0) b.col = COLORS[cfg.col];
        b.nick = cfg.name;
        b.cfg = cfg;
        b.cost = cost(cfg);
        return b;
    }

    /** 3 bars (HP, Speed, Power) on a 0..1 scale. */
    function bars(b) {
        var lim = function (v) { return Math.max(0.08, Math.min(1, v)); };
        var dps = b.dmg / b.rl * 60;
        return [
            lim(b.hp / 160),
            lim((b.spd - 1.1) / 1.8),
            lim(dps / 48)
        ];
    }

    function allCfgs(core) {
        var out = [];
        PARTS.gun.forEach(function (g) {
            PARTS.hull.forEach(function (h) {
                PARTS.track.forEach(function (t) {
                    if (g.cost + h.cost + t.cost <= CAP) out.push({ core: core, gun: g.id, hull: h.id, track: t.id, col: -1, name: '' });
                });
            });
        });
        return out;
    }

    var KEY = 'armor-builds';
    function loadBuilds() {
        try {
            var o = JSON.parse(root.localStorage.getItem(KEY));
            return o && typeof o === 'object' ? o : {};
        } catch (e) { return {}; }
    }
    function buildFor(core) { return sanitize(loadBuilds()[core], core).cfg; }
    function saveBuild(cfg) {
        var c = sanitize(cfg).cfg, all = loadBuilds();
        all[c.core] = c;
        root.localStorage.setItem(KEY, JSON.stringify(all));
        return c;
    }

    var api = {
        CORES: CORES, CORE_IDS: CORE_IDS, SLOTS: SLOTS, PARTS: PARTS, COLORS: COLORS, CAP: CAP, NAME_MAX: NAME_MAX,
        isCore: isCore, find: find, defaultCfg: defaultCfg, cost: cost, sanitize: sanitize, build: build, bars: bars,
        allCfgs: allCfgs, loadBuilds: loadBuilds, buildFor: buildFor, saveBuild: saveBuild
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ArmorParts = api;
})(typeof window !== 'undefined' ? window : globalThis);
