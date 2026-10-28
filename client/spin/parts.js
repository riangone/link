/**
 * Link Spin — custom tops (改装工坊): core + attack ring + weight disk + tip.
 *
 * Pure data + rules, no DOM, loadable in Node (the offline balance sims and
 * unit tests require() this file):
 *   CORES        the 5 base tops (type, special move, matchups come from here)
 *   PARTS        per slot; every non-standard part has an upside AND a downside
 *   CAP          energy budget: Σ part cost ≤ CAP (same for everyone online)
 *   sanitize()   what the host runs on every cfg a peer sends
 *   build()      cfg → the stats object the physics reads (top.b in game.js)
 *
 * A cfg is { core, ring, disk, tip, col, name }:
 *   col   index into COLORS (cosmetic) or -1 = the core's own colours
 *   name  nickname shown on the HUD (cosmetic, ≤ NAME_MAX chars)
 * Unknown part ids / over budget → the parts fall back to 'std'. Unlocks are a
 * local progression thing only; the host can't check them, and doesn't need
 * to: unlocking never raises the budget.
 *
 * gear: how hard the tip meshes with the stadium's gear rails (齿轨) → X-DASH
 *   strength in game.js. 0 = smooth tip, never engages (needle).
 *
 * Stat mods: `mul` multiplies, `add` adds. Tuned with offline sims of the real
 * physics (see git log / tests/unit/spin-parts.test.js for the guard rails).
 */
(function (root) {
    'use strict';

    var CORES = {
        attack: {
            name: 'STORM STRIKER', short: 'STRIKER', spec: 'METEOR RUSH',
            c1: '#ff3b5c', c2: '#ffb02e', r: 34, mass: 1.1, accel: 0.40, vmax: 9.6, drain: 0.040,
            atk: 1.35, def: 0.85, bres: 0.9, dash: 8.6, gear: 1.0, blades: 3,
            shape: [[0.42, -0.62], [0.98, -0.2], [1.04, 0.04], [0.8, 0.13], [0.62, 0.42]]
        },
        defense: {
            name: 'IRON FORTRESS', short: 'FORTRESS', spec: 'AEGIS WALL',
            c1: '#3d8bff', c2: '#a9dcff', r: 37, mass: 1.55, accel: 0.27, vmax: 7.0, drain: 0.0345,
            atk: 0.86, def: 1.4, bres: 1.45, dash: 6.4, gear: 0.5, blades: 6,
            shape: [[0.55, -0.48], [0.96, -0.4], [1.02, 0], [0.96, 0.4], [0.55, 0.48]]
        },
        stamina: {
            name: 'ZEPHYR WING', short: 'ZEPHYR', spec: 'ETERNAL GALE',
            c1: '#22e39b', c2: '#d4fff0', r: 33, mass: 0.9, accel: 0.264, vmax: 7.4, drain: 0.0375,
            atk: 0.85, def: 1.0, bres: 1.0, dash: 7.4, gear: 0.3, blades: 4,
            shape: [[0.38, -0.25], [0.82, -0.32], [1.04, -0.12], [0.98, 0.06], [0.46, 0.34]]
        },
        balance: {
            name: 'PHOENIX FLARE', short: 'PHOENIX', spec: 'RISING FLARE',
            c1: '#ffb300', c2: '#fff1a8', r: 35, mass: 1.12, accel: 0.34, vmax: 8.4, drain: 0.0352,
            atk: 1.15, def: 1.12, bres: 1.24, dash: 7.8, gear: 0.4, blades: 5,
            shape: [[0.5, -0.42], [0.88, -0.32], [1.05, -0.02], [0.84, 0.08], [0.95, 0.3], [0.55, 0.42]]
        },
        dragon: {
            name: 'VOID DRAGON', short: 'DRAGON', spec: 'DRAGON STORM',
            c1: '#9b5cff', c2: '#00f0ff', r: 35, mass: 1.2, accel: 0.37, vmax: 9.0, drain: 0.036,
            atk: 1.25, def: 1.12, bres: 1.2, dash: 8.2, gear: 0.9, blades: 3,
            shape: [[0.3, -0.7], [0.9, -0.45], [1.08, -0.08], [0.7, 0.05], [0.95, 0.38], [0.5, 0.5]]
        }
    };
    var CORE_IDS = ['attack', 'defense', 'stamina', 'balance', 'dragon'];
    var SLOTS = ['ring', 'disk', 'tip'];
    var CAP = 6;
    var NAME_MAX = 10;

    /**
     * unlock: null = from the start; otherwise the first of rp / tw (tower
     * floors cleared) / bursts (lifetime BURST finishes) that the profile meets.
     * look: drawing hints for game.js (ring → blade outline, disk → metal disc,
     * tip → centre chip).
     */
    var PARTS = {
        ring: [
            { id: 'std', icon: '⭕', cost: 0, unlock: null },
            { id: 'wide', icon: '🛞', cost: 1, unlock: null, add: { r: 2 }, mul: { mass: 1.04, vmax: 0.93, accel: 0.95 },
                look: { shape: [[0.5, -0.5], [0.96, -0.42], [1.06, 0], [0.96, 0.42], [0.5, 0.5]] } },
            { id: 'spike', icon: '🗡️', cost: 2, unlock: { rp: 100, tw: 2, bursts: 3 }, mul: { atk: 1.12, bres: 0.84, def: 0.94 },
                look: { shape: [[0.36, -0.5], [1.12, -0.08], [0.7, 0.1], [0.5, 0.36]] } },
            { id: 'guard', icon: '🛡️', cost: 2, unlock: { tw: 2 }, mul: { bres: 1.15, def: 1.04, atk: 0.88 },
                look: { shape: [[0.6, -0.55], [0.95, -0.5], [1.0, -0.2], [1.0, 0.2], [0.95, 0.5], [0.6, 0.55]] } },
            { id: 'fang', icon: '🦷', cost: 3, unlock: { rp: 300, tw: 4 }, mul: { atk: 1.2, drain: 1.1, bres: 0.88 },
                look: { blades: 2, shape: [[0.3, -0.8], [1.0, -0.5], [1.14, -0.1], [0.62, 0.1], [0.5, 0.4]] } }
        ],
        disk: [
            { id: 'std', icon: '⚙️', cost: 0, unlock: null },
            { id: 'light', icon: '🪶', cost: 1, unlock: null, mul: { mass: 0.85, vmax: 1.06, accel: 1.08, bres: 0.95 }, look: { disc: 'light' } },
            { id: 'heavy', icon: '🪨', cost: 2, unlock: { rp: 100, tw: 1 }, mul: { mass: 1.18, vmax: 0.9, accel: 0.86, drain: 1.06 }, look: { disc: 'heavy' } },
            { id: 'swirl', icon: '🌪️', cost: 2, unlock: { tw: 3, bursts: 10 }, mul: { atk: 1.06, vmax: 1.04, def: 0.9 }, look: { disc: 'swirl' } },
            { id: 'rim', icon: '💍', cost: 3, unlock: { rp: 600, tw: 4 }, mul: { mass: 1.05, drain: 0.96, accel: 0.84, vmax: 0.92 }, look: { disc: 'rim' } }
        ],
        tip: [
            { id: 'std', icon: '🔩', cost: 0, unlock: null },
            { id: 'ball', icon: '⚪', cost: 1, unlock: null, mul: { def: 1.03, drain: 0.97, accel: 0.86, dash: 0.9, gear: 0.6 }, look: { chip: '#d9dce8' } },
            { id: 'needle', icon: '📍', cost: 2, unlock: { rp: 300, tw: 3 }, mul: { drain: 0.9, mass: 0.9, accel: 0.86, dash: 0.85, gear: 0 }, look: { chip: '#22e39b' } },
            { id: 'rubber', icon: '🛞', cost: 2, unlock: { rp: 300, tw: 4, bursts: 5 }, mul: { accel: 1.15, dash: 1.1, atk: 1.03, drain: 1.09, gear: 1.25 }, look: { chip: '#ff7a3d' } },
            { id: 'cog', icon: '⚡', cost: 2, unlock: { rp: 200, tw: 2 }, mul: { gear: 1.7, drain: 1.04, def: 0.97 }, look: { chip: '#ffe27a' } },
            { id: 'jet', icon: '🚀', cost: 3, unlock: { rp: 1000, tw: 6 }, mul: { vmax: 1.1, dash: 1.2, accel: 1.08, atk: 1.04, drain: 1.04, bres: 0.97, gear: 1.1 }, look: { chip: '#ffd34d' } }
        ]
    };

    /** Cosmetic colour pairs [main, highlight]. */
    var COLORS = [
        ['#ff3b5c', '#ffb02e'], ['#3d8bff', '#a9dcff'], ['#22e39b', '#d4fff0'], ['#ffb300', '#fff1a8'],
        ['#9b5cff', '#00f0ff'], ['#ff5fd2', '#ffd6f4'], ['#e8ecf8', '#8f9bbf'], ['#2a2a3a', '#ff4d4d']
    ];

    /** Own keys only: a peer can send "__proto__" / "constructor" as a core id. */
    function isCore(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(CORES, k); }
    function find(slot, id) {
        var list = Object.prototype.hasOwnProperty.call(PARTS, slot) ? PARTS[slot] : [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }
    function defaultCfg(core) {
        return { core: isCore(core) ? core : 'attack', ring: 'std', disk: 'std', tip: 'std', col: -1, name: '' };
    }
    function cost(cfg) {
        var n = 0;
        SLOTS.forEach(function (s) { var p = find(s, cfg && cfg[s]); n += p ? p.cost : 0; });
        return n;
    }
    function cleanName(s) {
        return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim().slice(0, NAME_MAX);
    }

    /**
     * Validate a cfg from anywhere (a peer, localStorage). Never throws.
     * @returns {{cfg:object, ok:boolean}} ok=false: parts were reset to 'std'
     *          (unknown id or over the energy cap). Core/colour/name are kept
     *          when they are valid on their own.
     */
    function sanitize(raw, fallbackCore) {
        var c = raw && typeof raw === 'object' ? raw : {};
        var out = defaultCfg(isCore(c.core) ? c.core : fallbackCore);
        var ok = true;
        SLOTS.forEach(function (s) {
            if (c[s] === undefined || c[s] === null) return;
            if (find(s, c[s])) out[s] = c[s]; else ok = false;
        });
        if (cost(out) > CAP) ok = false;
        if (!ok) { out.ring = out.disk = out.tip = 'std'; }
        var col = Number(c.col);
        out.col = Number.isInteger(col) && col >= 0 && col < COLORS.length ? col : -1;
        out.name = cleanName(c.name);
        return { cfg: out, ok: ok };
    }

    /** cfg → stats for the physics + drawing. Always sanitises first. */
    function build(raw) {
        var cfg = sanitize(raw).cfg;
        var src = CORES[cfg.core], b = {};
        for (var k in src) b[k] = src[k];
        b.type = cfg.core;
        b.disc = 'std';
        b.chip = null;
        SLOTS.forEach(function (s) {
            var p = find(s, cfg[s]);
            var m = p.mul || {}, a = p.add || {}, look = p.look || {};
            for (var x in m) b[x] *= m[x];
            for (var y in a) b[y] += a[y];
            if (look.shape) b.shape = look.shape;
            if (look.blades) b.blades = look.blades;
            if (look.disc) b.disc = look.disc;
            if (look.chip) b.chip = look.chip;
        });
        if (cfg.col >= 0) { b.c1 = COLORS[cfg.col][0]; b.c2 = COLORS[cfg.col][1]; }
        b.nick = cfg.name;
        b.cfg = cfg;
        b.cost = cost(cfg);
        return b;
    }

    /**
     * 4 kid-readable bars (attack · defence · stamina · speed) on a 0..6 scale;
     * the stock cores land near their old hand-made [5,2,2,5] style numbers.
     */
    function bars(b) {
        var lim = function (v) { return Math.max(0.3, Math.min(6, v)); };
        return [
            lim((b.atk - 0.6) * 6.2),
            lim((b.def * Math.sqrt(b.mass) * Math.sqrt(b.bres) - 0.7) * 4.2),
            lim((0.058 - b.drain) * 175),
            lim((b.vmax * b.accel - 1.5) * 2.0)
        ];
    }

    /** Is a part available to this local profile ({rp, tw, bursts})? */
    function unlocked(part, prof) {
        var u = part.unlock;
        if (!u) return true;
        prof = prof || {};
        return (u.rp != null && (prof.rp || 0) >= u.rp) ||
            (u.tw != null && (prof.tw || 0) >= u.tw) ||
            (u.bursts != null && (prof.bursts || 0) >= u.bursts);
    }

    /** All valid cfgs for a core (for sims/tests). */
    function allCfgs(core) {
        var out = [];
        PARTS.ring.forEach(function (r) {
            PARTS.disk.forEach(function (d) {
                PARTS.tip.forEach(function (t) {
                    if (r.cost + d.cost + t.cost <= CAP) out.push({ core: core, ring: r.id, disk: d.id, tip: t.id, col: -1, name: '' });
                });
            });
        });
        return out;
    }

    // ---------------- local storage of the player's builds (browser only) ----------------
    var KEY = 'spin-builds';
    function loadBuilds() {
        try {
            var o = JSON.parse(root.localStorage.getItem(KEY));
            return o && typeof o === 'object' ? o : {};
        } catch (e) { return {}; }
    }
    /** The saved build for a core (sanitised; defaults if none). */
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
        unlocked: unlocked, allCfgs: allCfgs, loadBuilds: loadBuilds, buildFor: buildFor, saveBuild: saveBuild
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SpinParts = api;
})(typeof window !== 'undefined' ? window : globalThis);
