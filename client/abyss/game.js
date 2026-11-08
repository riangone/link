/**
 * Abyssal Front (client/abyss/) — deep-sea pressure-hull duel with sonar stealth.
 *
 * This is the "other universe" sibling of Steel Shadow: Frontline and keeps the
 * exact same architecture (see docs/abyss-plan/abyss.md):
 *
 *   Host-authoritative: the host (or the only player in ?bot= mode) runs the
 *   simulation `S`; the client sends inputs and renders the host's snapshots.
 *   Every timer is in host-sim milliseconds (S.T), never wall clock, so two
 *   devices with skewed clocks agree.
 *
 * The deep-sea twist on vision (what makes silence matter):
 *   - each hull hears an ACTIVE SONAR bubble around it, blocked by basalt and
 *     coral pillars;
 *   - a hull inside a KELP FOREST is silent (hidden) unless the listener is
 *     within KELP_SPOT px, or it fired in the last FIRE_REVEAL ms;
 *   - an echo drone hovering at a point illuminates everything inside DRONE_R;
 *   - a sonar scan only pings the enemy position after a delay (no vision);
 *   - a leviathan den you hold acts as a listening post (radar);
 *   - a torpedo fired while the victim could not hear the shooter = silent
 *     strike ×1.6.
 * Rivals the local player can't hear are simply not drawn. Fog lives on its own
 * offscreen canvas so it never erases the world (or your own hull) beneath it.
 */
'use strict';
(() => {
    const { L } = window.AbyssI18n;

    // ---------------------------------------------------------------- tuning & sea sizes
    const MAP_SPECS = {
        normal: { w: 2400, h: 1800, forestN: 9,  rockN: 7,  coralN: 6,  ventN: 2, patchN: 160, dens: 1 },
        large:  { w: 3600, h: 2700, forestN: 16, rockN: 11, coralN: 10, ventN: 4, patchN: 260, dens: 3 },
        huge:   { w: 4800, h: 3600, forestN: 24, rockN: 16, coralN: 15, ventN: 6, patchN: 380, dens: 5 }
    };
    let currentMapSize = 'large';
    let W = 3600, H = 2700, CELL = 60, EC = W / CELL, ER = H / CELL;
    const HULL_R = 20, STEP = 1000 / 60, NET_MS = 50, WIN = 3, RESPAWN = 2400, AMBUSH_MUL = 1.6;
    const FIRE_REVEAL = 1500, KELP_SPOT = 125, DRONE_R = 300, DRONE_RANGE = 600;
    const DRONE_CD = 14000, DRONE_TIME = 7500, DRONE_SPEED = 0.58;
    const HUNTER_CD = 18000, HUNTER_SPEED = 0.72, HUNTER_RANGE = 420;
    const SCAN_CD = 22000, SCAN_DELAY = 1100, SCAN_TIME = 3200;
    const FLARE_CD = 24000, FLARE_TIME = 4000, FLARE_R = 240;
    const VENT_CD = 18000, VENT_TIME = 6500, VENT_R = 170;
    const DEN_R = 90, DEN_CAP_TIME = 3200, DEN_SUPPLY_CD = 24000;
    const MIN_DISP = 0.00, MAX_DISP = 0.22;

    let SPAWNS = [[], []];
    function setWorldDimensions(sz) {
        currentMapSize = MAP_SPECS[sz] ? sz : 'large';
        const spec = MAP_SPECS[currentMapSize];
        W = spec.w; H = spec.h;
        EC = Math.floor(W / CELL); ER = Math.floor(H / CELL);
        SPAWNS = [
            [{ x: 200, y: H / 2 }, { x: 240, y: 360 }, { x: 240, y: H - 360 }],
            [{ x: W - 200, y: H / 2 }, { x: W - 240, y: H - 360 }, { x: W - 240, y: 360 }]
        ];
    }

    // Two water factions: the Amber Shoal (warm, lit hulls) and the Abyssal Bloom (cold, violet).
    const COLORS = [
        { body: '#f0a95a', dark: '#7a4a13', vent: '#ffd27a', trail: 'rgba(240,169,90,0.35)' },
        { body: '#9f7bf0', dark: '#3b2a6b', vent: '#d4beff', trail: 'rgba(159,123,240,0.35)' }
    ];

    // ---------------------------------------------------------------- loadout: hull class + sonar weapon + gear
    /** Pressure hulls. Realistic torpedo reloads (2~3.5s); deep hulls turn slowly. */
    const CLASSES = {
        ram:     { icon: '🦈', hp: 100, speed: 0.19,  sight: 380, dmg: 25, cd: 2400, shot: 0.42, life: 1900, turn: 0.009,  droneCd: 14000, size: 1 },
        skulk:   { icon: '🐙', hp: 80,  speed: 0.235, sight: 450, dmg: 20, cd: 1800, shot: 0.45, life: 1600, turn: 0.012,  droneCd: 9000,  size: 0.88 },
        bulwark: { icon: '🐢', hp: 150, speed: 0.15,  sight: 340, dmg: 35, cd: 3000, shot: 0.35, life: 2000, turn: 0.0065, droneCd: 16000, size: 1.16 },
        stalk:   { icon: '⚡', hp: 80,  speed: 0.17,  sight: 400, dmg: 48, cd: 3400, shot: 0.55, life: 2400, turn: 0.006,  droneCd: 14000, size: 0.97 }
    };
    /** Sonar weapons: multipliers on the hull's launcher. splash = burst radius on impact. */
    const WEAPONS = {
        pulse:  { icon: '◎', dmg: 1,    cd: 1,   shot: 1 },
        torp:   { icon: '➰', dmg: 1.35, cd: 1.2, shot: 1.15 },
        swarm:  { icon: '⁂', dmg: 0.72, cd: 0.68, shot: 1 },
        eel:    { icon: '⚡', dmg: 0.95, cd: 1.15, shot: 0.88, splash: 85 }
    };
    /** Depth bands: a global vision vs. reach trade-off applied to both hulls. */
    const DEPTHS = {
        shallow: { icon: '☀️', sightMul: 1.25, shotMul: 0.9,  turnMul: 1,   revealMul: 1,   critMul: 1 },
        mid:     { icon: '🌊', sightMul: 1,    shotMul: 1,    turnMul: 1,   revealMul: 1,   critMul: 1 },
        deep:    { icon: '🌑', sightMul: 0.8,  shotMul: 1.2,  turnMul: 1,   revealMul: 0.9, critMul: 1 },
        hadal:   { icon: '🕳️', sightMul: 0.6,  shotMul: 1.35, turnMul: 0.85, revealMul: 0.75, critMul: 1.35 }
    };
    /** Gear: each is a small, readable rule. */
    const GEARS = {
        glide:   { icon: '🪽' },   // +16% speed, faster turn
        bio:     { icon: '🦠' },   // +35 hp, -10% speed
        hunter:  { icon: '🎣' },   // sonar +70, find mines & dens sooner
        lookout: { icon: '🔭' },   // shorter firing exposure, echo drone cooldown -40%
        vent:    { icon: '💨' }    // slower exposure after firing, +6% speed
    };
    const DEFAULT_LO = { cls: 'ram', w: 'pulse', g: 'glide' };
    const validLo = lo => ({
        cls: lo && CLASSES[lo.cls] ? lo.cls : DEFAULT_LO.cls,
        w: lo && WEAPONS[lo.w] ? lo.w : DEFAULT_LO.w,
        g: lo && GEARS[lo.g] ? lo.g : DEFAULT_LO.g
    });
    let currentDepth = 'mid';
    const validDepth = d => (DEPTHS[d] ? d : 'mid');

    // ---------------------------------------------------------------- mines & supply pods
    const MINE_DMG = 42, MINE_ARM = 900, MINE_R = 30, MINE_SPOT = 85, MINE_MAX = 4;
    const ITEM_EVERY = 9000, ITEM_MAX = 4, ITEM_FALL = 1600, ITEM_R = 32, BUFF_T = 9000;
    const ITEMS = {
        repair: { icon: '🔧', color: '#5cf0a8' },
        shield: { icon: '🫧', color: '#8fd3ff' },
        rapid:  { icon: '⚡', color: '#ffe066' },
        speed:  { icon: '🚀', color: '#ff9f5a' },
        mines:  { icon: '💣', color: '#ff7a7a' },
        intel:  { icon: '🔊', color: '#c79bff' }
    };
    const ITEM_KEYS = Object.keys(ITEMS);

    /** Final stats of a loadout at a given depth. Pure function of (hull, weapon, gear, depth). */
    function statsOf(lo, depth) {
        lo = validLo(lo);
        const c = CLASSES[lo.cls], w = WEAPONS[lo.w], g = lo.g, dp = DEPTHS[validDepth(depth)];
        const speedMul = (g === 'bio' ? 0.9 : 1) * (g === 'glide' ? 1.16 : 1) * (g === 'vent' ? 1.06 : 1);
        return {
            hp: c.hp + (g === 'bio' ? 35 : 0),
            speed: c.speed * speedMul,
            sight: Math.round((c.sight + (g === 'hunter' ? 70 : 0)) * dp.sightMul),
            dmg: c.dmg * w.dmg, cd: c.cd * w.cd, shot: c.shot * w.shot * dp.shotMul, life: c.life,
            turn: c.turn * (g === 'glide' ? 1.3 : 1) * dp.turnMul,
            droneCd: Math.round(c.droneCd * (g === 'lookout' ? 0.6 : 1)),
            revealMul: (g === 'lookout' ? 0.5 : 1) * (g === 'vent' ? 0.75 : 1) * dp.revealMul,
            critMul: dp.critMul,
            splash: w.splash || 0,
            mines: g === 'hunter' ? 4 : 3, mineDmg: MINE_DMG + (g === 'bio' ? 8 : 0),
            spot: KELP_SPOT, size: c.size
        };
    }
    const stCache = {};
    /** Stats of a hull; works on host state and client snapshots alike. */
    const stOf = t => {
        const k = t.cls + '/' + t.w + '/' + t.g + '/' + currentDepth;
        return stCache[k] || (stCache[k] = statsOf(validLo(t), currentDepth));
    };

    // ---------------------------------------------------------------- dom
    const $ = id => document.getElementById(id);
    const canvas = $('game'), ctx = canvas.getContext('2d'), field = $('field');
    const overlay = $('overlay'), screens = ['lobby-screen', 'ready-screen', 'gameover-screen', 'disconnect-screen'].map($);
    const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
    if (isTouch) document.body.classList.add('is-touch');

    if (!location.hash || location.hash.length <= 1) location.hash = 'room-' + Math.random().toString(36).slice(2, 9);
    $('invite-url').value = location.href;
    $('copy-btn').onclick = () => { navigator.clipboard?.writeText(location.href); $('copy-btn').textContent = L('copied'); };
    $('lang').value = window.AbyssI18n.lang;
    $('lang').onchange = e => { window.AbyssI18n.setLang(e.target.value); refreshTexts(); };
    window.AbyssI18n.apply();

    // ---------------------------------------------------------------- sea floor
    function rng(seed) {
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    /**
     * Point-symmetric sea (x,y)→(W-x,H-y) so both divers are equally fair.
     * forests = kelp (hiding), rocks = basalt (blocks sonar & torpedoes),
     * coral = pillar clusters (blocks movement & sonar), vents = ambient plumes,
     * dens = leviathan dens (capturable listening posts).
     */
    function genMap(seed, sz) {
        if (sz && sz !== currentMapSize) setWorldDimensions(sz);
        const spec = MAP_SPECS[currentMapSize];
        const r = rng(seed), M = { seed, size: currentMapSize, forests: [], rocks: [], coral: [], vents: [], dens: [], patches: [] };
        const spawnClear = (x, y, m) => SPAWNS.flat().every(s => Math.hypot(s.x - x, s.y - y) > m);
        const solids = () => [...M.rocks, ...M.coral];
        const farFromSolids = (x, y, rad) => solids().every(o => Math.hypot(o.x - x, o.y - y) > o.r + rad + 64);
        const mirrorC = o => ({ ...o, x: W - o.x, y: H - o.y });
        const half = () => ({ x: 300 + r() * (W / 2 - 400), y: 120 + r() * (H - 240) });

        // Leviathan dens: fixed, fair placements per sea size.
        M.dens.push({ id: 0, x: W / 2, y: H * 0.35 });
        if (spec.dens >= 3) {
            M.dens.push({ id: 1, x: W / 2, y: H * 0.65 });
            M.dens.push({ id: 2, x: W * 0.3, y: H * 0.5 });
        }
        if (spec.dens >= 5) {
            M.dens.push({ id: 3, x: W * 0.7, y: H * 0.5 });
            M.dens.push({ id: 4, x: W / 2, y: H * 0.15 });
        }
        const nearDen = (x, y, pad) => M.dens.some(d => Math.hypot(d.x - x, d.y - y) < DEN_R + pad);

        // a central kelp bed is the classic ambush spot
        M.forests.push({ x: W / 2, y: H / 2, r: 140 });
        for (let i = 0, n = 0; n < spec.forestN && i < 400; i++) {
            const p = half(), rad = 80 + r() * 80;
            if (!spawnClear(p.x, p.y, rad + 80) || M.forests.some(f => Math.hypot(f.x - p.x, f.y - p.y) < f.r + rad - 20)) continue;
            const f = { x: p.x, y: p.y, r: rad };
            M.forests.push(f, mirrorC(f)); n++;
        }
        for (let i = 0, n = 0; n < spec.rockN && i < 350; i++) {
            const p = half(), rad = 28 + r() * 26;
            if (!spawnClear(p.x, p.y, 200) || !farFromSolids(p.x, p.y, rad) || nearDen(p.x, p.y, rad + 40)) continue;
            const o = { x: p.x, y: p.y, r: rad };
            M.rocks.push(o, mirrorC(o)); n++;
        }
        for (let i = 0, n = 0; n < spec.coralN && i < 300; i++) {
            const p = half(), rad = 55 + r() * 45;
            if (!spawnClear(p.x, p.y, 280) || !farFromSolids(p.x, p.y, rad)) continue;
            const o = { x: p.x, y: p.y, r: rad };
            M.coral.push(o, mirrorC(o)); n++;
        }
        for (let i = 0, n = 0; n < spec.ventN && i < 250; i++) {
            const p = half(), rad = 45 + r() * 40;
            if (!spawnClear(p.x, p.y, 240) || solids().some(o => Math.hypot(o.x - p.x, o.y - p.y) < o.r + rad * 0.5)) continue;
            const o = { x: p.x, y: p.y, r: rad };
            M.vents.push(o, mirrorC(o)); n++;
        }
        // decorative sea-floor patches (bioluminescent drifts)
        for (let i = 0; i < spec.patchN; i++) M.patches.push({ x: r() * W, y: r() * H, r: 35 + r() * 110, l: r() });
        return M;
    }

    let map = null, groundCache = null, mapKey = '';
    /** (Re)build the sea for `seed`/`size`. Idempotent: same key → no rebuild (prevents per-frame loops). */
    function useMap(seed, sz) {
        if (!seed) return;
        const size = MAP_SPECS[sz] ? sz : currentMapSize;
        const key = seed + '/' + size;
        if (map && mapKey === key && groundCache) return;
        if (size !== currentMapSize) setWorldDimensions(size);
        map = genMap(seed, size);
        mapKey = key;
        groundCache = buildGround();
        explored = new Uint8Array(EC * ER);
    }
    setWorldDimensions('large');
    try { currentDepth = validDepth(localStorage.getItem('abyss-depth')); } catch (_) {}

    // ---------------------------------------------------------------- geometry & sonar
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    function blockedHull(x, y) {
        if (x < HULL_R || y < HULL_R || x > W - HULL_R || y > H - HULL_R) return true;
        if (map.rocks.some(o => Math.hypot(x - o.x, y - o.y) < o.r + HULL_R)) return true;
        return map.coral.some(o => Math.hypot(x - o.x, y - o.y) < o.r + HULL_R);
    }
    function blockedShot(x, y) {
        if (x < 0 || y < 0 || x > W || y > H) return true;
        return map.rocks.some(o => Math.hypot(x - o.x, y - o.y) < o.r) ||
            map.coral.some(o => Math.hypot(x - o.x, y - o.y) < o.r);
    }
    function inKelp(x, y) { return map.forests.some(f => Math.hypot(x - f.x, y - f.y) < f.r - 8); }
    /** Does the segment a→b cross basalt/coral? (sonar cannot pass solid rock) */
    function losClear(a, b) {
        const d = dist(a, b), n = Math.ceil(d / 14);
        for (let i = 1; i < n; i++) {
            const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
            if (map.rocks.some(o => Math.hypot(x - o.x, y - o.y) < o.r - 3) ||
                map.coral.some(o => Math.hypot(x - o.x, y - o.y) < o.r - 3)) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- sim state
    /** S = authoritative state (host only). Clients render `net` instead. */
    let S = null, net = null, netAt = 0;
    let myRole = null, myIdx = 1, channelOpen = false;   // client-side default (mapgen: spawn 0 top-left, 1 bottom-right)
    const inputs = [{}, {}], overrides = [null, null];

    const loadouts = [validLo(null), validLo(null)];
    let myLoadout = validLo((() => { try { return JSON.parse(localStorage.getItem('abyss-loadout')); } catch (e) { return null; } })());
    let itemsOn = localStorage.getItem('abyss-items') !== '0';

    function newHull(i, spawn, lo) {
        const p = SPAWNS[i][spawn % 3], st = statsOf(lo, currentDepth);
        return {
            x: p.x, y: p.y, a: i ? Math.PI : 0, ta: i ? Math.PI : 0, hp: st.hp, maxHp: st.hp, cd: 0, alive: true, respawnAt: 0,
            cls: lo.cls, w: lo.w, g: lo.g, disp: MIN_DISP, crippledUntil: 0, recoil: 0,
            reveal: 0, still: 0, droneAt: 4000, hunterAt: 12000, scanAt: 9000, scanFrom: 0, scanTo: 0,
            flareAt: 15000, ventAt: 10000, flareUntil: 0, ventUntil: 0,
            qs: null, as: null, es: null, ms: null, zs: null, xs: null,
            mines: st.mines, shield: 0, shieldTo: 0, rapidTo: 0, speedTo: 0
        };
    }

    function startMatch() {
        const seed = 1 + Math.floor(Math.random() * 1e9);
        useMap(seed, currentMapSize);
        loadouts[0] = validLo(myLoadout);
        if (GameBot.enabled) loadouts[1] = bot.pickLoadout();
        const dens = map.dens.map(d => ({ id: d.id, x: d.x, y: d.y, r: DEN_R, owner: -1, cap: 0, supplyAt: 0 }));
        S = {
            seed, size: currentMapSize, depth: currentDepth, T: 0, ph: 'play', sc: [0, 0], win: null, winReason: null,
            tanks: [newHull(0, 0, loadouts[0]), newHull(1, 0, loadouts[1])],
            shots: [], drones: [null, null], hunters: [null, null], dens, vents: [],
            mines: [], items: [], itemsOn, itemAt: 2500, itemN: 0, spawnN: [0, 0], ev: [], evId: 0
        };
        bot.reset();
        lastEvId = 0;
        event({ k: 'start', size: currentMapSize, depth: currentDepth });
        showScreen(null);
        broadcast();
    }

    /** Drop a supply pod (plus its mirror, so both sides get an equal chance). */
    function spawnPods() {
        for (let k = 0; k < 40; k++) {
            const x = 300 + Math.random() * (W - 600), y = 150 + Math.random() * (H - 300);
            if (blockedHull(x, y) || blockedHull(W - x, H - y) || Math.hypot(x - W / 2, y - H / 2) < 60) continue;
            if (S.items.some(it => Math.hypot(it.x - x, it.y - y) < 200)) continue;
            const kind = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
            for (const [px, py] of [[x, y], [W - x, H - y]]) S.items.push({ id: ++S.itemN, k: kind, x: Math.round(px), y: Math.round(py), land: S.T + ITEM_FALL });
            event({ k: 'drop', x: Math.round(x), y: Math.round(y) });
            return;
        }
    }
    function pickUp(t, i, it) {
        const T = S.T;
        switch (it.k) {
            case 'repair': t.hp = Math.min(t.maxHp, t.hp + 45); break;
            case 'shield': t.shield = 50; t.shieldTo = T + 15000; break;
            case 'rapid': t.rapidTo = T + BUFF_T; break;
            case 'speed': t.speedTo = T + BUFF_T; break;
            case 'mines': t.mines = Math.min(stOf(t).mines + 3, t.mines + 2); break;
            case 'intel': t.droneAt = Math.min(t.droneAt, T); t.scanAt = Math.min(t.scanAt, T); break;
        }
        event({ k: 'pick', i, it: it.k, x: it.x, y: it.y });
    }
    /** Apply damage (shield first); handles sink/score/game over. */
    function damage(t, i, dmg, by, kind, amb, x, y) {
        const T = S.T;
        dmg = Math.round(dmg);
        if (t.shield > 0 && T < t.shieldTo) {
            const ab = Math.min(t.shield, dmg);
            t.shield -= ab; dmg -= ab;
        }
        t.hp -= dmg;
        t.reveal = Math.max(t.reveal, T + 600);
        event({ k: 'hit', i, x: Math.round(x ?? t.x), y: Math.round(y ?? t.y), dmg, amb, src: kind });
        if (t.hp <= 0) {
            t.hp = 0; t.alive = false; t.respawnAt = T + RESPAWN;
            S.sc[by]++;
            event({ k: 'kill', i, by, x: Math.round(t.x), y: Math.round(t.y), src: kind });
            if (S.sc[by] >= WIN) { S.ph = 'over'; S.win = by; S.winReason = 'kill'; event({ k: 'over', w: by, reason: 'kill' }); }
        }
    }
    function event(e) {
        e.id = ++S.evId; e.t = S.T;
        S.ev.push(e);
        if (S.ev.length > 24) S.ev.shift();
    }

    /** Is a point inside a deployed vent plume? */
    function inVent(D, x, y) {
        if (!D || !D.vents) return false;
        return D.vents.some(v => D.T < v.until && Math.hypot(v.x - x, v.y - y) < v.r);
    }
    /** Can `team`'s divers hear enemy hull `t`? (vision rules in the header) */
    function visibleTo(D, team, t) {
        if (!t || !t.alive) return false;
        const me = D.tanks[team], dr = D.drones[team];
        if (dr && dr.hover && Math.hypot(dr.x - t.x, dr.y - t.y) < DRONE_R) return true;
        if (D.dens && D.dens.some(d => d.owner === team && d.cap >= 0.8 && Math.hypot(d.x - t.x, d.y - t.y) < 360)) return true;
        if (!me || !me.alive) return false;
        if (inVent(D, t.x, t.y) && dist(me, t) > 70) return false;
        const underFlare = D.T < (me.flareUntil || 0);
        const mySight = underFlare ? 130 : stOf(me).sight;
        const d = dist(me, t);
        if (d > mySight || !losClear(me, t)) return false;
        if (D.T <= t.reveal) return true;
        if (inKelp(t.x, t.y) && d > stOf(t).spot) return false;
        return true;
    }
    function mineVisible(D, team, m) {
        if (m.o === team) return true;
        const me = D.tanks[team], dr = D.drones[team];
        if (dr && dr.hover && Math.hypot(dr.x - m.x, dr.y - m.y) < DRONE_R) return true;
        return me.alive && Math.hypot(me.x - m.x, me.y - m.y) < MINE_SPOT + (me.g === 'hunter' ? 40 : 0);
    }
    /** Edge-triggered gadget: a counter in the input increases once per press. */
    function pressed(t, key, v) {
        if (typeof v !== 'number') return false;
        if (t[key] === null) { t[key] = v; return v > 0; }
        if (v > t[key]) { t[key] = v; return true; }
        return false;
    }
    function fireTorpedo(t, i, T) {
        const st = stOf(t);
        const amb = !visibleTo(S, 1 - i, t);   // victim's ears, not our own: we may be heard even from kelp
        t.recoil = 1.0;
        const spread = (t.disp || 0) > 0.015 ? (Math.random() - 0.5) * t.disp : 0;
        const shootAng = t.ta + spread;
        t.disp = Math.min(MAX_DISP, (t.disp || MIN_DISP) + 0.10);
        S.shots.push({
            x: t.x + Math.cos(t.ta) * 30, y: t.y + Math.sin(t.ta) * 30,
            vx: Math.cos(shootAng) * st.shot, vy: Math.sin(shootAng) * st.shot,
            o: i, life: st.life, amb, dmg: st.dmg, sp: st.splash, w: t.w
        });
        t.cd = st.cd * (T < t.rapidTo ? 0.5 : 1);
        t.reveal = T + FIRE_REVEAL * st.revealMul;
        event({ k: 'fire', i, x: Math.round(t.x), y: Math.round(t.y), a: Math.round(t.ta * 100) / 100 });
    }

    function stepSim(dt) {
        S.T += dt;
        const T = S.T;
        if (overrides[1]) inputs[1] = overrides[1];
        else if (GameBot.enabled) inputs[1] = bot.think(T);
        for (let i = 0; i < 2; i++) {
            const t = S.tanks[i], v = inputs[i] || {}, foe = S.tanks[1 - i], st = stOf(t);
            if (!t.alive) {
                if (T >= t.respawnAt && S.ph === 'play') {
                    Object.assign(t, newHull(i, ++S.spawnN[i], t), {
                        droneAt: t.droneAt, hunterAt: t.hunterAt, scanAt: t.scanAt, flareAt: t.flareAt, ventAt: t.ventAt,
                        qs: t.qs, as: t.as, es: t.es, ms: t.ms, zs: t.zs, xs: t.xs, still: T
                    });
                    event({ k: 'spawn', i });
                }
                continue;
            }
            if (S.ph !== 'play') continue;

            // ---- dive
            let mx = +v.mx || 0, my = +v.my || 0;
            const m = Math.hypot(mx, my);
            if (m > 1) { mx /= m; my /= m; }
            const underFlare = T < (t.flareUntil || 0);
            const crippled = T < (t.crippledUntil || 0);
            if (m > 0.12) {
                const sp = st.speed * dt * (T < t.speedTo ? 1.35 : 1) * (underFlare ? 0.45 : 1) * (crippled ? 0.52 : 1);
                t.a = Math.atan2(my, mx);
                const nx = t.x + mx * sp, ny = t.y + my * sp;
                if (!blockedHull(nx, t.y)) t.x = nx;
                if (!blockedHull(t.x, ny)) t.y = ny;
                t.still = T;
                t.disp = Math.min(MAX_DISP, (t.disp || MIN_DISP) + dt * 0.0006);
            }

            // ---- aim: explicit (mouse/drag/bot) > auto-track a heard rival > follow hull
            const hears = visibleTo(S, i, foe), toFoe = Math.atan2(foe.y - t.y, foe.x - t.x);
            let want = t.a;
            const explicit = typeof v.ax === 'number' && isFinite(v.ax);
            if (explicit) want = v.ax;
            else if (v.aa !== false && hears) want = toFoe;
            const da = angDiff(want, t.ta), turnRate = (v.fw ? st.turn * 1.8 : st.turn) * dt;
            t.ta += clamp(da, -turnRate, turnRate);
            if (Math.abs(da) > 0.02) t.disp = Math.min(MAX_DISP, (t.disp || MIN_DISP) + dt * 0.0004);
            else if (m <= 0.12) t.disp = Math.max(MIN_DISP, (t.disp || MIN_DISP) - dt * 0.00035);

            // ---- fire
            t.cd = Math.max(0, t.cd - dt);
            t.recoil = Math.max(0, (t.recoil || 0) - dt * 0.006);
            if (t.cd <= 0) {
                let shoot = false;
                if (v.f) {
                    if (v.fw) { if (Math.abs(angDiff(want, t.ta)) < 0.07) shoot = true; }
                    else shoot = true;
                } else if (v.af && hears && dist(t, foe) < st.shot * st.life * 0.95 && Math.abs(angDiff(toFoe, t.ta)) < 0.22 && losClear(t, foe)) {
                    shoot = true;
                }
                if (shoot) fireTorpedo(t, i, T);
            }

            // ---- gadgets (edge-triggered by a sequence number so lost packets can't double-fire)
            if (pressed(t, 'qs', v.q) && T >= t.droneAt) {
                const tx = clamp(v.tx ?? (t.x + Math.cos(t.ta) * DRONE_RANGE), 40, W - 40), ty = clamp(v.ty ?? (t.y + Math.sin(t.ta) * DRONE_RANGE), 40, H - 40);
                S.drones[i] = { x: t.x, y: t.y, tx, ty, hover: false, until: 0 };
                t.droneAt = T + st.droneCd;
                event({ k: 'drone', i });
            }
            if (pressed(t, 'as', v.r) && T >= t.hunterAt) {
                const tx = clamp(v.tx ?? (t.x + Math.cos(t.ta) * HUNTER_RANGE), 40, W - 40), ty = clamp(v.ty ?? (t.y + Math.sin(t.ta) * HUNTER_RANGE), 40, H - 40);
                S.hunters[i] = { x: t.x, y: t.y, tx, ty, hover: false, until: 0, next: T + 500, ammo: 4 };
                t.hunterAt = T + HUNTER_CD;
                event({ k: 'hunter', i });
            }
            if (pressed(t, 'es', v.e) && T >= t.scanAt) {
                t.scanFrom = T + SCAN_DELAY; t.scanTo = T + SCAN_DELAY + SCAN_TIME; t.scanAt = T + SCAN_CD;
                event({ k: 'scan', i });
            }
            if (pressed(t, 'ms', v.m) && t.mines > 0) {
                const x = t.x - Math.cos(t.a) * 30, y = t.y - Math.sin(t.a) * 30;
                if (!blockedHull(x, y)) {
                    const own = S.mines.filter(q => q.o === i);
                    if (own.length >= MINE_MAX) S.mines.splice(S.mines.indexOf(own[0]), 1);
                    S.mines.push({ x: Math.round(x), y: Math.round(y), o: i, arm: T + MINE_ARM, dmg: st.mineDmg });
                    t.mines--;
                    event({ k: 'mine_set', i });
                }
            }
            if (pressed(t, 'zs', v.z) && T >= t.flareAt && T >= (t.flareUntil || 0)) {
                // keyboard players have no cursor: the flare flies along the torpedo tube
                const fdx = v.tx == null ? Math.cos(t.ta) * 450 : v.tx - t.x, fdy = v.ty == null ? Math.sin(t.ta) * 450 : v.ty - t.y;
                const tx = clamp(t.x + fdx, 40, W - 40), ty = clamp(t.y + fdy, 40, H - 40);
                t.flareAt = T + FLARE_CD;
                event({ k: 'flare', i, x: Math.round(tx), y: Math.round(ty) });
                if (foe.alive && Math.hypot(foe.x - tx, foe.y - ty) < FLARE_R) {
                    foe.flareUntil = T + FLARE_TIME;
                    event({ k: 'flare_hit', i: 1 - i });
                }
            }
            if (pressed(t, 'xs', v.x) && T >= t.ventAt) {
                t.ventAt = T + VENT_CD; t.ventUntil = T + VENT_TIME;
                S.vents.push({ x: Math.round(t.x), y: Math.round(t.y), r: VENT_R, until: T + VENT_TIME, o: i });
                event({ k: 'vent', i, x: Math.round(t.x), y: Math.round(t.y) });
            }

            // ---- supply pods
            for (let j = S.items.length - 1; j >= 0; j--) {
                const it = S.items[j];
                if (T >= it.land && Math.hypot(it.x - t.x, it.y - t.y) < ITEM_R) { S.items.splice(j, 1); pickUp(t, i, it); }
            }
            if (t.shield > 0 && T >= t.shieldTo) t.shield = 0;
        }

        // ---- leviathan dens: capture rings, listening posts and supply drops
        if (S.dens && S.ph === 'play') {
            for (const d of S.dens) {
                let occ = -1, nOcc = 0;
                for (let i = 0; i < 2; i++) {
                    const tk = S.tanks[i];
                    if (tk.alive && Math.hypot(tk.x - d.x, tk.y - d.y) < d.r) { occ = i; nOcc++; }
                }
                if (nOcc === 1) {
                    const rate = (dt / DEN_CAP_TIME) * (stOf(S.tanks[occ]).sight > 400 ? 1.4 : 1.0);
                    if (d.owner === occ) d.cap = Math.min(1, d.cap + rate);
                    else {
                        d.cap -= rate;
                        if (d.cap <= 0) {
                            d.owner = occ; d.cap = 0.05; d.supplyAt = T + 10000;
                            event({ k: 'den_taken', i: occ, id: d.id });
                        }
                    }
                } else if (nOcc === 0 && d.cap < 1 && d.owner >= 0) {
                    d.cap = Math.min(1, d.cap + dt / (DEN_CAP_TIME * 2));
                }
                if (d.owner >= 0 && d.cap >= 0.8 && S.itemsOn) {
                    if (!d.supplyAt) d.supplyAt = T + 12000;
                    if (T >= d.supplyAt) {
                        d.supplyAt = T + DEN_SUPPLY_CD;
                        const kind = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
                        S.items.push({ id: ++S.itemN, x: Math.round(d.x), y: Math.round(d.y), k: kind, land: T + 800 });
                        event({ k: 'den_supply', op: d.id, kind, x: Math.round(d.x), y: Math.round(d.y) });
                    }
                }
            }
        }

        // ---- expire vent plumes
        for (let k = S.vents.length - 1; k >= 0; k--) if (T >= S.vents[k].until) S.vents.splice(k, 1);

        // ---- siphon mines
        for (let j = S.mines.length - 1; j >= 0; j--) {
            const mn = S.mines[j], t = S.tanks[1 - mn.o];
            if (S.ph === 'play' && T >= mn.arm && t.alive && Math.hypot(mn.x - t.x, mn.y - t.y) < MINE_R) {
                S.mines.splice(j, 1);
                event({ k: 'boom_mine', x: mn.x, y: mn.y });
                t.speedTo = 0;
                damage(t, 1 - mn.o, mn.dmg, mn.o, 'mine', false, mn.x, mn.y);
            }
        }

        // ---- supply pods over time
        if (S.itemsOn && S.ph === 'play' && T >= S.itemAt) {
            S.itemAt = T + ITEM_EVERY;
            if (S.items.length <= ITEM_MAX - 2) spawnPods();
        }

        // ---- echo drones: swim out, hover with the searchlight, then drift off
        for (let i = 0; i < 2; i++) {
            const d = S.drones[i];
            if (!d) continue;
            if (!d.hover) {
                const dx = d.tx - d.x, dy = d.ty - d.y, l = Math.hypot(dx, dy), s = DRONE_SPEED * dt;
                if (l <= s) { d.x = d.tx; d.y = d.ty; d.hover = true; d.until = T + DRONE_TIME; }
                else { d.x += dx / l * s; d.y += dy / l * s; }
            } else if (T > d.until) S.drones[i] = null;
        }

        // ---- hunter eel swarms: chase a heard rival and spit bio-torpedoes
        for (let i = 0; i < 2; i++) {
            const eh = S.hunters[i]; if (!eh) continue;
            if (!eh.hover) {
                const dx = eh.tx - eh.x, dy = eh.ty - eh.y, l = Math.hypot(dx, dy), s = HUNTER_SPEED * dt;
                if (l <= s) { eh.x = eh.tx; eh.y = eh.ty; eh.hover = true; eh.until = T + 5200; }
                else { eh.x += dx / l * s; eh.y += dy / l * s; }
            } else if (T >= eh.next && eh.ammo > 0) {
                const target = S.tanks[1 - i];
                if (target.alive && dist(eh, target) < 230 && losClear(eh, target)) {
                    const l = Math.max(1, dist(eh, target));
                    S.shots.push({ x: eh.x, y: eh.y, vx: (target.x - eh.x) / l * 0.62, vy: (target.y - eh.y) / l * 0.62, o: i, life: 720, amb: false, dmg: 12, sp: 0, eel: true });
                    event({ k: 'hunter_strike', i }); eh.ammo--; eh.next = T + 1050;
                } else eh.next = T + 350;
                if (!eh.ammo) eh.until = Math.min(eh.until, T + 400);
            } else if (T > eh.until) S.hunters[i] = null;
        }

        // ---- torpedoes & bio-torpedoes
        for (let j = S.shots.length - 1; j >= 0; j--) {
            const b = S.shots[j];
            b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
            const t = S.tanks[1 - b.o];
            const hit = t.alive && Math.hypot(b.x - t.x, b.y - t.y) < HULL_R * stOf(t).size + 6;
            const wall = b.life <= 0 || blockedShot(b.x, b.y);
            if (!hit && !wall) continue;
            S.shots.splice(j, 1);
            if (S.ph !== 'play') continue;
            const mul = b.amb ? AMBUSH_MUL : 1;
            if (hit) {
                // Angle of entry decides the outcome: rear vents cave in, shallow hits glance off bio-armor.
                const bAng = Math.atan2(b.vy, b.vx);
                const relImpactAng = Math.atan2(b.y - t.y, b.x - t.x);
                const isRearSector = Math.abs(angDiff(relImpactAng, t.a + Math.PI)) < 0.82;
                const isRearVent = Math.abs(angDiff(bAng, t.a)) < 0.85;
                const isVentCrit = isRearSector || isRearVent;
                const isFrontSector = Math.abs(angDiff(relImpactAng, t.a)) < 1.35;
                const headOnAngleDiff = Math.abs(angDiff(bAng, t.a + Math.PI));
                const ricoThreshold = (b.w === 'torp') ? 1.25 : 1.05;
                const isDeflect = !b.amb && !b.sp && !isVentCrit && isFrontSector && (headOnAngleDiff > ricoThreshold);

                if (isVentCrit) {
                    const critDmg = Math.round(b.dmg * mul * 1.75 * stOf(S.tanks[b.o]).critMul);
                    t.crippledUntil = Math.max(t.crippledUntil || 0, T + 1600);
                    event({ k: 'crit', i: 1 - b.o, by: b.o, x: Math.round(t.x), y: Math.round(t.y), dmg: critDmg });
                    damage(t, 1 - b.o, critDmg, b.o, 'crit', b.amb, t.x, t.y);
                } else if (isDeflect) {
                    const defDmg = Math.max(4, Math.round(b.dmg * 0.12));
                    event({ k: 'deflect', i: 1 - b.o, by: b.o, x: Math.round(b.x), y: Math.round(b.y), dmg: defDmg });
                    damage(t, 1 - b.o, defDmg, b.o, 'deflect', false, t.x, t.y);
                } else {
                    damage(t, 1 - b.o, b.dmg * mul, b.o, 'shell', b.amb, t.x, t.y);
                }
            } else if (b.life > 0 || b.sp) {
                event({ k: 'spark', x: Math.round(b.x), y: Math.round(b.y), sp: b.sp || 0 });
            }
            // an electric-eel burst also catches a near miss
            if (b.sp) {
                if (hit) event({ k: 'spark', x: Math.round(b.x), y: Math.round(b.y), sp: b.sp });
                else if (t.alive && Math.hypot(b.x - t.x, b.y - t.y) < b.sp) damage(t, 1 - b.o, b.dmg * 0.55 * mul, b.o, 'splash', b.amb, t.x, t.y);
            }
        }
    }
    function snapshot() {
        const r = v => Math.round(v * 10) / 10;
        const q = v => Math.round(v * 100) / 100;
        return {
            type: 'state', seed: S.seed, size: S.size || currentMapSize, depth: S.depth || currentDepth, T: Math.round(S.T),
            ph: S.ph, sc: S.sc, win: S.win, winReason: S.winReason,
            tanks: S.tanks.map(t => ({
                x: r(t.x), y: r(t.y), a: q(t.a), ta: q(t.ta), hp: t.hp, maxHp: t.maxHp, alive: t.alive, respawnAt: t.respawnAt,
                reveal: t.reveal, still: t.still, droneAt: t.droneAt, hunterAt: t.hunterAt, scanAt: t.scanAt, scanFrom: t.scanFrom, scanTo: t.scanTo,
                flareAt: t.flareAt, ventAt: t.ventAt, flareUntil: t.flareUntil, ventUntil: t.ventUntil,
                recoil: q(t.recoil || 0), disp: q(t.disp || MIN_DISP), crippledUntil: t.crippledUntil || 0,
                cls: t.cls, w: t.w, g: t.g, mines: t.mines, shield: t.shield, shieldTo: t.shieldTo, rapidTo: t.rapidTo, speedTo: t.speedTo, cd: Math.round(t.cd)
            })),
            shots: S.shots.map(b => ({ x: r(b.x), y: r(b.y), vx: b.vx, vy: b.vy, o: b.o, eel: !!b.eel, sp: b.sp || 0 })),
            drones: S.drones.map(d => d && { x: r(d.x), y: r(d.y), hover: d.hover, until: d.until }),
            hunters: S.hunters.map(d => d && { x: r(d.x), y: r(d.y), hover: d.hover, until: d.until, ammo: d.ammo }),
            dens: S.dens ? S.dens.map(d => ({ id: d.id, x: d.x, y: d.y, r: d.r, owner: d.owner, cap: r(d.cap) })) : [],
            vents: S.vents ? S.vents.map(v => ({ x: v.x, y: v.y, r: v.r, until: v.until })) : [],
            mines: S.mines, items: S.items, itemsOn: S.itemsOn, ev: S.ev
        };
    }
    function broadcast() { if (S && myRole === 'host' && !GameBot.enabled) session.send(snapshot()); }
    // In bot mode there is no peer, so `net` is just the latest serialised host state for the
    // renderer and the debug hooks (this is how `bot.lost` and turret lag are kept small).
    let botSnapT = -1e9;
    function syncBotSnapshot() {
        if (!GameBot.enabled || !S) return;
        if (S.T === botSnapT && net) return;
        botSnapT = S.T;
        net = JSON.parse(JSON.stringify(snapshot()));
        netAt = performance.now();
    }

    // ---------------------------------------------------------------- bot (host side; only knows what its own side can hear)
    const bot = {
        reset() {
            Object.assign(this, {
                wp: null, seen: null, seenT: -1e9, since: 0, side: 1, q: 0, e: 0, m: 0, r: 0, mineT: 0,
                lastPos: null, lastPosT: 0, burstErr: 0, strafeT: 0, camp: 0, frozen: this.frozen === true
            });
        },
        pickLoadout() {
            const any = o => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
            return validLo({ cls: any(CLASSES), w: any(WEAPONS), g: any(GEARS) });
        },
        /** Nearest surfaced pod the bot can hear (or a fresh drop marker it saw on the minimap). */
        pod(me) {
            let best = null, bd = 1e9;
            for (const it of S.items) {
                const d = dist(me, it);
                if (d < bd && (d < stOf(me).sight || S.T < it.land + 4000)) { bd = d; best = it; }
            }
            return best && bd < 900 ? best : null;
        },
        level() {
            return GameBot.pick({
                easy: { react: 750, err: 0.2, fire: 0.25, keep: 260, gadget: 0.003, camp: 0 },
                normal: { react: 420, err: 0.1, fire: 0.5, keep: 240, gadget: 0.008, camp: 0.3 },
                hard: { react: 230, err: 0.05, fire: 0.8, keep: 220, gadget: 0.015, camp: 0.55 }
            });
        },
        steer(me, tx, ty) {
            const base = Math.atan2(ty - me.y, tx - me.x);
            for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2, 2.6, -2.6]) {
                const a = base + off * this.side;
                if (!blockedHull(me.x + Math.cos(a) * 34, me.y + Math.sin(a) * 34)) return { mx: Math.cos(a), my: Math.sin(a) };
            }
            return { mx: 0, my: 0 };
        },
        pickWaypoint(me) {
            if (Math.random() < 0.55 && map.forests.length) {
                const f = map.forests.slice().sort((a, b) => (a.x - b.x) * 0.002 + (Math.random() - 0.5))[Math.floor(Math.random() * Math.min(6, map.forests.length))];
                return { x: f.x, y: f.y, kelp: true };
            }
            for (let k = 0; k < 20; k++) {
                const p = { x: 200 + Math.random() * (W - 400), y: 120 + Math.random() * (H - 240) };
                if (!blockedHull(p.x, p.y)) return p;
            }
            return { x: W / 2, y: H / 2 };
        },
        think(T) {
            const me = S.tanks[1], foe = S.tanks[0], lv = this.level();
            const out = { mx: 0, my: 0, ax: null, f: false, q: this.q, r: this.r, e: this.e, m: this.m };
            if (this.frozen || !me.alive || S.ph !== 'play') return out;
            const hears = visibleTo(S, 1, foe);
            const scanLive = T >= me.scanFrom && T < me.scanTo;
            if (hears || scanLive) { this.seen = { x: foe.x, y: foe.y }; this.seenT = T; }
            if (hears) { if (!this.since) { this.since = T; this.burstErr = (Math.random() - 0.5) * 2 * lv.err; } }
            else this.since = 0;

            if (hears && T - this.since > lv.react) {
                const d = dist(me, foe), aim = Math.atan2(foe.y - me.y, foe.x - me.x);
                out.ax = aim + this.burstErr;
                if (T > this.strafeT) { this.strafeT = T + 900 + Math.random() * 1200; this.side = -this.side; this.burstErr = (Math.random() - 0.5) * 2 * lv.err; }
                const silent = inKelp(me.x, me.y) && T > me.reveal;
                if (!(silent && this.camp > T)) {
                    const toward = d > lv.keep + 80 ? 1 : d < lv.keep - 60 ? -1 : 0;
                    const mx = Math.cos(aim) * toward - Math.sin(aim) * this.side * 0.8, my = Math.sin(aim) * toward + Math.cos(aim) * this.side * 0.8;
                    const s = this.steer(me, me.x + mx * 60, me.y + my * 60);
                    out.mx = s.mx; out.my = s.my;
                }
                out.f = losClear(me, foe) && Math.abs(angDiff(me.ta, out.ax)) < 0.22 && Math.random() < lv.fire;
                if (me.mines > 0 && d < 260 && T > this.mineT && Math.random() < lv.gadget * 3) { out.m = ++this.m; this.mineT = T + 2500; }
                return out;
            }
            // no contact: chase last intel, otherwise roam/lurk
            let goal = this.seen && T - this.seenT < 6000 ? this.seen : null;
            const pod = S.itemsOn && this.pod(me);
            if (pod && (!goal || dist(me, pod) < 300) && !(this.camp > T && dist(me, pod) > 350)) { goal = pod; this.camp = 0; }
            else if (!goal) {
                if (!this.wp || dist(me, this.wp) < 50) {
                    if (this.wp && this.wp.kelp && Math.random() < lv.camp) this.camp = T + 3000 + Math.random() * 4000;
                    this.wp = this.pickWaypoint(me);
                }
                goal = this.wp;
            } else if (dist(me, goal) < 60) this.seen = null;
            if (this.camp > T && inKelp(me.x, me.y)) {
                out.ax = Math.atan2(H / 2 - me.y, W / 2 - me.x) + Math.sin(T / 900) * 0.8;   // scan the dark while lurking
            } else {
                const s = this.steer(me, goal.x, goal.y);
                out.mx = s.mx; out.my = s.my;
            }
            // stuck → new waypoint, flip avoidance side
            if (T - this.lastPosT > 1200) {
                if (this.lastPos && dist(me, this.lastPos) < 12 && !(this.camp > T)) { this.wp = this.pickWaypoint(me); this.side = -this.side; this.seen = null; }
                this.lastPos = { x: me.x, y: me.y }; this.lastPosT = T;
            }
            // gadgets
            if (T >= me.droneAt && Math.random() < lv.gadget) {
                const tgt = this.seen || (foe.alive && { x: W - me.x, y: H - me.y }) || goal;
                out.ax = Math.atan2(tgt.y - me.y, tgt.x - me.x);
                if (Math.abs(angDiff(me.ta, out.ax)) < 0.3) out.q = ++this.q;
            }
            if (T >= me.hunterAt && this.seen && T - this.seenT < 5000 && Math.random() < lv.gadget) out.r = ++this.r;
            if (T >= me.scanAt && T - this.seenT > 9000 && Math.random() < lv.gadget * 0.6) out.e = ++this.e;
            if (me.mines > 0 && T > this.mineT && Math.random() < lv.gadget && (inKelp(me.x, me.y) || (this.seen && dist(me, this.seen) < 200))) {
                out.m = ++this.m; this.mineT = T + 6000;
            }
            return out;
        }
    };

    // ---------------------------------------------------------------- input
    const keys = {};
    let mouseAim = null, mouseDown = false, mouseFire = false, touchFire = false, stickVec = { x: 0, y: 0 };
    let qSeq = 0, rSeq = 0, eSeq = 0, mSeq = 0, zSeq = 0, xSeq = 0;
    let dragAim = null, release = null;
    /** Player prefs: touch control layout ('single' vs 'dual') */
    const prefs = {
        aim: localStorage.getItem('abyss-aim') === 'manual' ? 'manual' : 'auto',
        autoFire: localStorage.getItem('abyss-autofire') === '1',
        control: localStorage.getItem('abyss-ctrl') === 'single' ? 'single' : 'dual'
    };
    function setAutoFire(on, announce) {
        prefs.autoFire = on; localStorage.setItem('abyss-autofire', on ? '1' : '0');
        if (announce) banner((on ? '🔥 ' : '✋ ') + L(on ? 'af_on' : 'af_off'), '#ffe066', 1200);
        renderOptions();
    }
    addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (!keys[e.code]) {
            if (e.code === 'KeyQ') qSeq++;
            if (e.code === 'KeyR') rSeq++;
            if (e.code === 'KeyE') eSeq++;
            if (e.code === 'KeyF') mSeq++;
            if (e.code === 'KeyZ') zSeq++;
            if (e.code === 'KeyX') xSeq++;
            if (e.code === 'KeyV') setAutoFire(!prefs.autoFire, true);
        }
        keys[e.code] = true;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { keys[e.code] = false; });
    addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; mouseFire = false; touchFire = false; dragAim = null; });
    canvas.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button === 0) {
            mouseDown = true; mouseFire = true;
            const r = canvas.getBoundingClientRect();
            mouseAim = { x: e.clientX - r.left, y: e.clientY - r.top };
            Sfx.init();
        }
    });
    canvas.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse') {
            const r = canvas.getBoundingClientRect();
            mouseAim = { x: e.clientX - r.left, y: e.clientY - r.top };
        }
    });
    for (const ev of ['pointerup', 'pointercancel']) {
        canvas.addEventListener(ev, e => {
            if (e.pointerType === 'mouse' && e.button === 0) { mouseDown = false; mouseFire = false; }
        });
    }

    // virtual dive stick
    const stick = $('stick'), knob = $('knob');
    let stickId = null, singleFlickAim = null, singleFlickFire = false;
    function stickMove(e) {
        const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
        let dx = e.clientX - cx, dy = e.clientY - cy;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx = dx / l * R; dy = dy / l * R; }
        const norm = l / R;
        stickVec = { x: dx / R, y: dy / R };
        if (prefs.control === 'single') {
            // single-hand mode: outer ring = dive, flick = snap the torpedo tube and fire
            if (norm > 0.35) {
                singleFlickAim = Math.atan2(dy, dx);
                if (norm > 0.75 && prefs.autoFire) singleFlickFire = true;
            }
        }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
    }
    stick.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.init(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); });
    stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
    for (const ev of ['pointerup', 'pointercancel']) stick.addEventListener(ev, e => {
        if (e.pointerId !== stickId) return;
        if (prefs.control === 'single' && singleFlickAim !== null) {
            release = { ang: singleFlickAim, until: performance.now() + 600 };
            singleFlickFire = true;
        }
        stickId = null; stickVec = { x: 0, y: 0 }; knob.style.transform = '';
        setTimeout(() => { singleFlickFire = false; singleFlickAim = null; }, 120);
    });
    function holdBtn(el, on) {
        el.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.init(); on(); });
    }
    // The fire button doubles as an aim stick: tap/hold = fire, drag = aim, release = fire there.
    const fireBtn = $('fire-btn');
    let fireId = null, fireStart = null;
    fireBtn.addEventListener('pointerdown', e => {
        e.preventDefault(); Sfx.init();
        fireId = e.pointerId; fireBtn.setPointerCapture(e.pointerId);
        fireStart = { x: e.clientX, y: e.clientY }; dragAim = null; release = null; touchFire = true;
    });
    fireBtn.addEventListener('pointermove', e => {
        if (e.pointerId !== fireId) return;
        const dx = e.clientX - fireStart.x, dy = e.clientY - fireStart.y;
        if (Math.hypot(dx, dy) > 18) { dragAim = Math.atan2(dy, dx); touchFire = false; }
    });
    for (const ev of ['pointerup', 'pointercancel']) fireBtn.addEventListener(ev, e => {
        if (e.pointerId !== fireId) return;
        if (dragAim !== null && ev === 'pointerup') release = { ang: dragAim, until: performance.now() + 650 + ((myRole === 'host' && S && S.tanks[myIdx].cd) || 0) };
        fireId = null; dragAim = null; touchFire = false;
    });
    holdBtn($('drone-btn'), () => { qSeq++; });
    holdBtn($('hunter-btn'), () => { rSeq++; });
    holdBtn($('scan-btn'), () => { eSeq++; });
    holdBtn($('flare-btn'), () => { zSeq++; });
    holdBtn($('vent-btn'), () => { xSeq++; });
    holdBtn($('mine-btn'), () => { mSeq++; });

    let view = { ox: 0, oy: 0, s: 1, w: 0, h: 0 };
    function localInput() {
        let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
        let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
        if (!mx && !my) { mx = stickVec.x; my = stickVec.y; }
        const Dn = D(), me = Dn && Dn.tanks[myIdx];
        let ax = null, f = !!(keys.Space || touchFire || singleFlickFire || mouseFire), fw = false;
        if (dragAim !== null) ax = dragAim;
        else if (singleFlickAim !== null) ax = singleFlickAim;
        else if (release && performance.now() < release.until) { ax = release.ang; f = true; fw = true; }
        else if (mouseAim && me) ax = Math.atan2(mouseAim.y / view.s + view.oy - me.y, mouseAim.x / view.s + view.ox - me.x);
        if (release && performance.now() >= release.until) release = null;
        return {
            mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100,
            ax: ax === null ? null : Math.round(ax * 100) / 100, f, fw,
            aa: !isTouch || prefs.aim === 'auto', af: prefs.autoFire,
            q: qSeq, r: rSeq, e: eSeq, m: mSeq, z: zSeq, x: xSeq,
            tx: me && mouseAim ? Math.round(mouseAim.x / view.s + view.ox) : null,
            ty: me && mouseAim ? Math.round(mouseAim.y / view.s + view.oy) : null
        };
    }

    // ---------------------------------------------------------------- network
    const D = () => (myRole === 'host' ? S : net);
    /** Host-sim time as best known locally (clients extrapolate from the last snapshot). */
    const nowT = () => (myRole === 'host' ? (S ? S.T : 0) : net ? net.T + (performance.now() - netAt) : 0);

    const session = GameBot.session({
        gameFolder: 'abyss',
        dataChannelOptions: { ordered: false, maxRetransmits: 0 },
        onSignalingStatus(s) {
            if (s === 'open') setConn(L('conn_open'));
            else if (s === 'closed') setConn(L('conn_closed'));
            $('status-text').textContent = s;
        },
        onRole(role) {
            myRole = role; myIdx = role === 'host' ? 0 : 1;
            $('role-status-text').textContent = role.toUpperCase();
            refreshTexts();
        },
        onChannelOpen() {
            channelOpen = true;
            showScreen('ready-screen');
            refreshTexts();
        },
        onPeerConnected() { $('status-text').textContent = 'P2P'; },
        onPeerDisconnected() {
            channelOpen = false;
            S = null; net = null;
            showScreen('disconnect-screen');
        },
        onRtt(ms) { $('ping-text').textContent = ms + ' ms'; },
        onMessage: handleMessage
    });
    function setConn(t) { $('conn-text').textContent = t; }

    if (!channelOpen) refreshTexts();
    let lastEvId = 0, wantRestart = false;
    const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
    const numOrNull = v => (typeof v === 'number' && isFinite(v) ? v : null);
    function handleMessage(m) {
        if (!m || typeof m !== 'object') return;
        if (m.type === 'input' && myRole === 'host') {
            inputs[1] = {
                mx: num(m.mx), my: num(m.my), ax: numOrNull(m.ax), f: !!m.f, fw: !!m.fw, aa: m.aa !== false, af: !!m.af,
                q: num(m.q), r: num(m.r), e: num(m.e), m: num(m.m), z: num(m.z), x: num(m.x),
                tx: numOrNull(m.tx), ty: numOrNull(m.ty)
            };
            if (m.lo) loadouts[1] = validLo(m.lo);
        } else if (m.type === 'restart' && myRole === 'host') {
            if (!S || S.ph === 'over') startMatch();
        } else if (m.type === 'state' && myRole === 'client') {
            if (!net || net.seed !== m.seed || (m.size && m.size !== currentMapSize)) lastEvId = 0;
            if (m.depth && m.depth !== currentDepth) currentDepth = validDepth(m.depth);
            useMap(m.seed, m.size || 'large');
            net = m; netAt = performance.now();
            if (m.ph === 'play' && !overlay.classList.contains('hidden')) { wantRestart = false; showScreen(null); }
        }
    }
    setInterval(() => {
        if (!channelOpen || myRole !== 'client') return;
        session.send({ type: 'input', ...localInput(), lo: myLoadout });
        if (wantRestart) session.send({ type: 'restart' });
    }, 1000 / 30);
    setInterval(() => { if (myRole === 'host' && S) broadcast(); }, NET_MS);

    // ---------------------------------------------------------------- screens
    function showScreen(id) {
        overlay.classList.toggle('hidden', !id);
        for (const s of screens) s.classList.toggle('hidden', s.id !== id);
    }

    // ---------------------------------------------------------------- loadout picker (ready screen)
    function setDepth(d) {
        currentDepth = validDepth(d);
        localStorage.setItem('abyss-depth', currentDepth);
    }
    /** Changing the depth band rescales hull HP, so apply it to the live dive too (host only). */
    function applyDepthToState() {
        if (myRole !== 'host' || !S) return;
        S.depth = currentDepth;
        for (const t of S.tanks) {
            const max = stOf(t).hp, ratio = t.maxHp ? t.hp / t.maxHp : 1;
            t.maxHp = max; t.hp = Math.round(max * ratio);
        }
    }
    function chipRow(id, table, key, prefix, wrap) {
        const box = $(id);
        box.textContent = '';
        for (const k of Object.keys(table)) {
            const b = document.createElement('button');
            b.type = 'button'; b.dataset.k = k;
            b.textContent = table[k].icon + ' ' + L(prefix + k);
            b.classList.toggle('active', wrap().pick === k);
            b.onclick = () => { wrap().set(k); renderOptions(); };
            box.appendChild(b);
        }
    }
    function renderOptions() {
        // Sea size (host only)
        const mapBox = $('map-chips');
        mapBox.textContent = '';
        for (const sz of Object.keys(MAP_SPECS)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = L('map_' + sz);
            b.classList.toggle('active', currentMapSize === sz);
            b.disabled = myRole === 'client';
            b.onclick = () => {
                if (myRole === 'client') return;
                setWorldDimensions(sz); renderOptions();
            };
            mapBox.appendChild(b);
        }
        $('map-desc').textContent = L('d_map_' + currentMapSize);

        // Depth band (host only: it changes both hulls' stats, so the host owns it)
        const depthBox = $('depth-chips');
        depthBox.textContent = '';
        for (const dp of Object.keys(DEPTHS)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = DEPTHS[dp].icon + ' ' + L('depth_' + dp);
            b.classList.toggle('active', currentDepth === dp);
            b.disabled = myRole === 'client';
            b.onclick = () => {
                if (myRole === 'client') return;
                setDepth(dp); applyDepthToState(); renderOptions();
            };
            depthBox.appendChild(b);
        }
        $('depth-desc').textContent = L('d_depth_' + currentDepth);

        // Hull / weapon / gear (each player owns their own choice)
        chipRow('cls-chips', CLASSES, 'cls', 'cls_', () => ({ pick: myLoadout.cls, set: k => saveLoadout({ cls: k }) }));
        chipRow('w-chips', WEAPONS, 'w', 'w_', () => ({ pick: myLoadout.w, set: k => saveLoadout({ w: k }) }));
        chipRow('g-chips', GEARS, 'g', 'g_', () => ({ pick: myLoadout.g, set: k => saveLoadout({ g: k }) }));
        $('cls-desc').textContent = L('d_' + myLoadout.cls);
        $('w-desc').textContent = L('dw_' + myLoadout.w);
        $('g-desc').textContent = L('dg_' + myLoadout.g);
        const st = statsOf(myLoadout, currentDepth);
        $('lo-stats').textContent =
            `${L('st_hp')} ${st.hp} · ${L('st_spd')} ${Math.round(st.speed * 1000)} · ${L('st_sight')} ${st.sight} · ` +
            `${L('st_dmg')} ${Math.round(st.dmg)}${st.splash ? '💥' : ''} · ${(st.cd / 1000).toFixed(1)}s ${L('reloading')} · ` +
            `${L('st_range')} ${Math.round(st.shot * st.life)} · 💣${st.mines}`;

        const canItems = myRole !== 'client';
        $('items-btn').textContent = canItems ? L(itemsOn ? 'items_on' : 'items_off') : L('items_host');
        $('items-btn').disabled = !canItems;
        $('items-btn').classList.toggle('off', !itemsOn);
        $('aim-btn').textContent = L(prefs.aim === 'auto' ? 'aim_auto' : 'aim_manual');
        $('aim-btn').classList.toggle('hidden', !isTouch);
        $('af-btn').textContent = L(prefs.autoFire ? 'af_on' : 'af_off');
        $('af-btn').classList.toggle('off', !prefs.autoFire);
    }
    function saveLoadout(patch) {
        myLoadout = validLo({ ...myLoadout, ...patch });
        localStorage.setItem('abyss-loadout', JSON.stringify(myLoadout));
    }
    $('items-btn').onclick = () => { itemsOn = !itemsOn; localStorage.setItem('abyss-items', itemsOn ? '1' : '0'); renderOptions(); };
    $('aim-btn').onclick = () => { prefs.aim = prefs.aim === 'auto' ? 'manual' : 'auto'; localStorage.setItem('abyss-aim', prefs.aim); renderOptions(); };
    $('af-btn').onclick = () => setAutoFire(!prefs.autoFire, false);

    function refreshTexts() {
        renderOptions();
        $('role-text').textContent = GameBot.enabled
            ? GameBot.t('ready', { lv: GameBot.t(GameBot.level).replace(/^\S+\s/, '') })
            : L(myRole === 'client' ? 'role_client' : 'role_host');
        $('start-btn').textContent = myRole === 'client' ? L(wantRestart ? 'wait_host' : 'start') : L('start');
        $('start-btn').disabled = myRole === 'client' && wantRestart;
    }
    $('start-btn').onclick = () => {
        Sfx.init();
        if (myRole === 'host') startMatch();
        else { wantRestart = true; refreshTexts(); }
    };
    $('restart-btn').onclick = () => {
        Sfx.init();
        if (myRole === 'host') startMatch();
        else { wantRestart = true; $('restart-btn').textContent = L('wait_host'); $('restart-btn').disabled = true; }
    };
    $('reload-btn').onclick = () => location.reload();
    function showGameOver(Dn) {
        if (!$('gameover-screen').classList.contains('hidden')) return;
        const won = Dn.win === myIdx;
        $('result-title').textContent = L(won ? 'win' : 'lose');
        $('result-title').style.color = won ? '#6be3d8' : '#ff6b8a';
        $('final-score').textContent = `${Dn.sc[myIdx]} - ${Dn.sc[1 - myIdx]}`;
        const reasonEl = $('result-reason');
        if (reasonEl) reasonEl.textContent = L(Dn.winReason === 'den' ? 'win_reason_den' : 'win_reason_kill');
        $('restart-btn').disabled = false; $('restart-btn').textContent = L('rematch');
        showScreen('gameover-screen');
        if (won) Sfx.win(); else Sfx.lose();
    }

    // ---------------------------------------------------------------- audio (WebAudio tones: no asset loading)
    const Sfx = (() => {
        let ac = null;
        function tone(f, d, type = 'square', vol = 0.06, slide = 0) {
            if (!ac) return;
            const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
            o.type = type; o.frequency.setValueAtTime(f, t);
            if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
            g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
            o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
        }
        return {
            init() { if (!ac) try { ac = new AudioContext(); } catch (e) { /* no audio */ } else if (ac.state === 'suspended') ac.resume(); },
            fire() { tone(220, 0.18, 'sine', 0.05, -160); tone(95, 0.14, 'triangle', 0.04, -40); },   // torpedo thump
            hit() { tone(90, 0.2, 'square', 0.07, -50); },
            boom() { tone(60, 0.6, 'sine', 0.1, -35); tone(140, 0.3, 'triangle', 0.05, -100); },
            gadget() { tone(660, 0.12, 'sine', 0.05, 400); },
            ping() { tone(1200, 0.35, 'sine', 0.045, -300); },
            deflect() { tone(1500, 0.18, 'triangle', 0.06, -900); },
            crit() { tone(50, 0.35, 'square', 0.12, -25); },
            click() { tone(320, 0.06, 'square', 0.04, -100); },
            win() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'sine', 0.06), i * 140)); },
            lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.26, 'sine', 0.06), i * 160)); }
        };
    })();

    // ---------------------------------------------------------------- effects & events
    const fx = [], banners = [];
    let shake = 0;
    function banner(text, color = '#6be3d8', ms = 1600) {
        banners.push({ text, color, until: performance.now() + ms });
        if (banners.length > 3) banners.shift();
    }
    function canSeePoint(Dn, p) { const me = Dn.tanks[myIdx]; return me && me.alive && Math.hypot(me.x - p.x, me.y - p.y) < stOf(me).sight; }
    function runEvents(Dn) {
        for (const e of Dn.ev || []) {
            if (e.id <= lastEvId) continue;
            lastEvId = e.id;
            if (nowT() - e.t > 1500) continue;            // stale (e.g. joined late)
            const mine = e.i === myIdx, now = performance.now();
            switch (e.k) {
                case 'start': explored = new Uint8Array(EC * ER); banner(L('start_msg'), '#6be3d8', 2400); break;
                case 'fire':
                    if (mine) release = null;
                    if (mine || canSeePoint(Dn, e)) {
                        fx.push({ k: 'flash', x: e.x, y: e.y, t: now });
                        fx.push({ k: 'muzzle', x: e.x + Math.cos(e.a) * 36, y: e.y + Math.sin(e.a) * 36, a: e.a, t: now });
                        Sfx.fire();
                    }
                    break;
                case 'spark':
                    if (e.sp) { fx.push({ k: 'blast', x: e.x, y: e.y, t: now, r: e.sp }); Sfx.hit(); }
                    else fx.push({ k: 'spark', x: e.x, y: e.y, t: now });
                    break;
                case 'boom_mine': fx.push({ k: 'blast', x: e.x, y: e.y, t: now, r: MINE_R + 30 }); Sfx.boom(); break;
                case 'mine_set': if (mine) Sfx.click(); break;
                case 'drop': banner(L('drop'), '#c8a2ff', 1800); Sfx.ping(); break;
                case 'den_supply': banner('📦 ' + L('den_supply'), '#6be3d8', 1800); Sfx.ping(); break;
                case 'pick':
                    fx.push({ k: 'pick', x: e.x, y: e.y, t: now, c: ITEMS[e.it].color, icon: ITEMS[e.it].icon });
                    if (mine) { banner(ITEMS[e.it].icon + ' ' + L('it_' + e.it), ITEMS[e.it].color, 1400); Sfx.gadget(); }
                    else if (canSeePoint(Dn, e)) banner(L('pick_enemy'), '#ff9a9a', 1100);
                    break;
                case 'deflect':
                    fx.push({ k: 'deflect', x: e.x, y: e.y, t: now });
                    Sfx.deflect();
                    banner(mine ? L('ricochet_self') : L('ricochet'), mine ? '#8fd3ff' : '#c8a2ff', 1600);
                    if (mine) shake = 6;
                    break;
                case 'crit':
                    fx.push({ k: 'crit', x: e.x, y: e.y, t: now, dmg: e.dmg });
                    Sfx.crit();
                    banner(mine ? L('crit_self') : L('crit_hit'), mine ? '#ff6b8a' : '#ffd36a', 2200);
                    if (mine) shake = 15;
                    break;
                case 'hit':
                    fx.push({ k: 'hit', x: e.x, y: e.y, t: now, dmg: e.dmg });
                    Sfx.hit();
                    if (e.amb) banner(L('ambush') + ' -' + e.dmg, mine ? '#ff7a7a' : '#ffd36a');
                    else if (e.src === 'mine') banner('💣 ' + L('mine_hit') + ' -' + e.dmg, mine ? '#ff7a7a' : '#ffd36a');
                    if (mine) shake = 10;
                    break;
                case 'kill':
                    fx.push({ k: 'boom', x: e.x, y: e.y, t: now });
                    Sfx.boom();
                    banner(L(mine ? 'killed' : 'kill'), mine ? '#ff7a7a' : '#5cf0a8', 2000);
                    if (mine) shake = 18;
                    break;
                case 'drone': if (mine) Sfx.gadget(); break;
                case 'hunter': if (mine) { Sfx.gadget(); banner('🐍 ' + L('hunter'), '#c8a2ff', 1200); } break;
                case 'hunter_strike': fx.push({ k: 'spark', x: e.x, y: e.y, t: now }); break;
                case 'scan': if (mine) { Sfx.gadget(); banner(L('scan_wait'), '#ff9db0', 1100); } else if (Dn.tanks[myIdx]) banner('📡 ' + L('spotted'), '#ffd36a', 1400); break;
                case 'flare': if (mine) Sfx.gadget(); fx.push({ k: 'flare_shock', x: e.x, y: e.y, t: now }); break;
                case 'flare_hit': if (e.i === myIdx) { banner(L('flare_active'), '#ff5252', 2000); Sfx.hit(); shake = 12; } break;
                case 'vent': if (mine) { Sfx.gadget(); banner(L('vent_active'), '#d8f1f2', 1400); } break;
                case 'den_taken':
                    banner(e.i === myIdx ? L('den_taken') : L('den_lost'), e.i === myIdx ? '#6be3d8' : '#ffd36a', 2200);
                    Sfx.ping();
                    break;
            }
        }
        if (Dn.ph === 'over') showGameOver(Dn);
    }

    // ---------------------------------------------------------------- exploration (local per player)
    let explored = new Uint8Array(EC * ER);
    function markExplored(cx, cy, rad) {
        for (let y = Math.max(0, Math.floor((cy - rad) / CELL)); y < Math.min(ER, Math.ceil((cy + rad) / CELL)); y++)
            for (let x = Math.max(0, Math.floor((cx - rad) / CELL)); x < Math.min(EC, Math.ceil((cx + rad) / CELL)); x++)
                if (Math.hypot(x * CELL + CELL / 2 - cx, y * CELL + CELL / 2 - cy) < rad) explored[y * EC + x] = 1;
    }

    // ---------------------------------------------------------------- rendering
    function buildGround() {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        const r = rng(((map && map.seed) || 1) + 7);
        // deep-water base gradient (warm shallows at the edges → black trench centre)
        const grad = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, Math.max(W, H) * 0.75);
        grad.addColorStop(0, '#031016');
        grad.addColorStop(0.55, '#061e28');
        grad.addColorStop(1, '#0a3440');
        g.fillStyle = grad; g.fillRect(0, 0, W, H);
        // bioluminescent drifts
        for (const p of map.patches) {
            const cg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
            const hue = p.l < 0.5 ? '107,227,216' : '159,123,240';
            cg.addColorStop(0, `rgba(${hue},${0.05 + p.l * 0.08})`);
            cg.addColorStop(1, `rgba(${hue},0)`);
            g.fillStyle = cg; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
        }
        // sand ripples
        g.strokeStyle = 'rgba(120,180,190,0.04)'; g.lineWidth = 12;
        for (let i = 0; i < 40; i++) {
            g.beginPath();
            const y0 = r() * H;
            for (let x = 0; x <= W; x += 60) g.lineTo(x, y0 + Math.sin(x / 220 + i) * 30 + r() * 6);
            g.stroke();
        }
        // kelp beds (swaying fronds are drawn live; the floor gets a dark organic patch)
        for (const f of map.forests) {
            const kg = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
            kg.addColorStop(0, 'rgba(30,90,60,0.55)');
            kg.addColorStop(0.75, 'rgba(22,70,52,0.35)');
            kg.addColorStop(1, 'rgba(16,48,40,0)');
            g.fillStyle = kg; g.beginPath(); g.arc(f.x, f.y, f.r, 0, 7); g.fill();
        }
        // basalt rocks
        for (const o of map.rocks) {
            const rg = g.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.1, o.x, o.y, o.r);
            rg.addColorStop(0, '#3a4c54'); rg.addColorStop(1, '#121b20');
            g.fillStyle = rg; g.beginPath(); g.arc(o.x, o.y, o.r, 0, 7); g.fill();
            g.strokeStyle = 'rgba(140,200,210,0.18)'; g.lineWidth = 2; g.stroke();
        }
        // coral pillars (rings of coloured growth)
        for (const o of map.coral) {
            const cg = g.createRadialGradient(o.x, o.y, o.r * 0.2, o.x, o.y, o.r);
            cg.addColorStop(0, '#5a2f58'); cg.addColorStop(0.7, '#3a1f42'); cg.addColorStop(1, 'rgba(20,10,26,0)');
            g.fillStyle = cg; g.beginPath(); g.arc(o.x, o.y, o.r, 0, 7); g.fill();
            g.strokeStyle = 'rgba(230,120,200,0.25)'; g.lineWidth = 3;
            g.beginPath(); g.arc(o.x, o.y, o.r * 0.65, 0, 7); g.stroke();
        }
        return c;
    }

    function resize() {
        const r = field.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        return { cw: r.width, ch: r.height, dpr };
    }

    const disp = [null, null];
    const lastFrame0 = performance.now();
    let lastFrame = lastFrame0, acc = 0;

    /** A pressure hull: teardrop body, lateral fins, a glow at the tail vents. */
    function drawHull(t, i, now, isMe) {
        const st = stOf(t), col = COLORS[i], s = st.size;
        const breath = 1 + Math.sin(now / 420 + i) * 0.02;
        ctx.save();
        ctx.translate(t.x, t.y);
        // sonar halo of the rival: ambient aqua ring (visible only when heard)
        if (!isMe) {
            ctx.strokeStyle = 'rgba(107,227,216,0.28)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(0, 0, HULL_R * s + 10 + Math.sin(now / 300) * 3, 0, 7); ctx.stroke();
        }
        ctx.rotate(t.a);
        ctx.scale(s * breath, s);
        // tail wake
        ctx.fillStyle = col.trail;
        ctx.beginPath(); ctx.moveTo(-HULL_R - 6, -5); ctx.lineTo(-HULL_R - 26 - Math.sin(now / 180) * 5, 0); ctx.lineTo(-HULL_R - 6, 5); ctx.closePath(); ctx.fill();
        // lateral fins
        ctx.fillStyle = col.dark;
        ctx.beginPath(); ctx.moveTo(2, -8); ctx.lineTo(-10, -24); ctx.lineTo(-18, -8); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(2, 8); ctx.lineTo(-10, 24); ctx.lineTo(-18, 8); ctx.closePath(); ctx.fill();
        // teardrop hull (nose at +x)
        ctx.beginPath();
        ctx.moveTo(HULL_R + 6, 0);
        ctx.quadraticCurveTo(HULL_R * 0.4, -HULL_R * 0.85, -HULL_R * 0.4, -HULL_R * 0.72);
        ctx.quadraticCurveTo(-HULL_R - 2, 0, -HULL_R * 0.4, HULL_R * 0.72);
        ctx.quadraticCurveTo(HULL_R * 0.4, HULL_R * 0.85, HULL_R + 6, 0);
        ctx.closePath();
        const bg = ctx.createLinearGradient(0, -HULL_R, 0, HULL_R);
        bg.addColorStop(0, col.body); bg.addColorStop(1, col.dark);
        ctx.fillStyle = bg; ctx.fill();
        ctx.strokeStyle = 'rgba(230,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
        // cockpit porthole
        ctx.fillStyle = 'rgba(200,255,250,0.75)';
        ctx.beginPath(); ctx.ellipse(4, 0, 6, 5, 0, 0, 7); ctx.fill();
        // tail vent glow (the crit weak spot)
        ctx.fillStyle = col.vent;
        ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(now / 300));
        ctx.beginPath(); ctx.arc(-HULL_R + 2, 0, 4, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        // torpedo tube (turret) pointing at ta
        ctx.rotate(t.ta - t.a);
        const kick = (t.recoil || 0) * 6;
        ctx.fillStyle = col.vent;
        ctx.fillRect(HULL_R * 0.3 - kick, -3, HULL_R * 0.9, 6);
        ctx.fillStyle = '#fff';
        ctx.fillRect(HULL_R * 1.15 - kick, -2, 4, 4);
        ctx.restore();
    }

    function drawKelp(f, now) {
        const fronds = Math.max(8, Math.round(f.r / 9));
        ctx.save();
        ctx.translate(f.x, f.y);
        for (let i = 0; i < fronds; i++) {
            const a = i / fronds * Math.PI * 2 + f.x * 0.01;
            const rr = f.r * (0.35 + ((i * 37) % 100) / 160);
            const bx = Math.cos(a) * rr, by = Math.sin(a) * rr;
            const sway = Math.sin(now / 900 + i) * 7;
            const h = 26 + ((i * 53) % 40);
            ctx.strokeStyle = i % 3 ? 'rgba(64,160,104,0.55)' : 'rgba(120,220,150,0.45)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(bx + sway * 0.5, by - h * 0.6, bx + sway, by - h);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawDen(d, now, T) {
        const col = d.owner < 0 ? '#7c9aa3' : d.owner === 0 ? COLORS[0].body : COLORS[1].body;
        ctx.save();
        ctx.translate(d.x, d.y);
        // glow of the leviathan
        const g = ctx.createRadialGradient(0, 0, 10, 0, 0, d.r);
        g.addColorStop(0, d.owner < 0 ? 'rgba(124,154,163,0.25)' : (d.owner === 0 ? 'rgba(240,169,90,0.28)' : 'rgba(159,123,240,0.28)'));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, d.r, 0, 7); ctx.fill();
        // coiling leviathan body
        ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 3.2; a += 0.12) {
            const rr = d.r * 0.72 * (1 - a / (Math.PI * 4));
            const x = Math.cos(a + now / 1400) * rr, y = Math.sin(a + now / 1400) * rr * 0.8;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // three eyes
        ctx.fillStyle = d.owner < 0 ? '#c8e6ea' : '#fff';
        for (let k = -1; k <= 1; k++) {
            ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 260 + k);
            ctx.beginPath(); ctx.arc(k * 9, -6, 3, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // capture ring
        ctx.strokeStyle = 'rgba(216,241,242,0.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, d.r, 0, 7); ctx.stroke();
        if (d.cap > 0.01 && d.owner >= 0) {
            ctx.strokeStyle = col; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(0, 0, d.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * d.cap); ctx.stroke();
        }
        ctx.restore();
    }

    function drawMinimap(Dn, ox, oy, vw, vh, cw, ch, dpr) {
        const mm = 150, pad = 10;
        const x0 = cw - mm - pad, y0 = ch - mm * 0.75 - pad;
        const sc = mm / W;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(2,12,18,0.75)';
        ctx.fillRect(x0, y0, mm, mm * 0.75);
        ctx.strokeStyle = 'rgba(107,227,216,0.35)'; ctx.strokeRect(x0, y0, mm, mm * 0.75);
        // explored cells
        ctx.fillStyle = 'rgba(107,227,216,0.10)';
        for (let y = 0; y < ER; y++) for (let x = 0; x < EC; x++)
            if (explored[y * EC + x]) ctx.fillRect(x0 + x * CELL * sc, y0 + y * CELL * sc, CELL * sc + 0.5, CELL * sc + 0.5);
        // dens (always shown: known geography)
        for (const d of (Dn.dens || [])) {
            ctx.fillStyle = d.owner < 0 ? '#7c9aa3' : d.owner === myIdx ? COLORS[myIdx].body : COLORS[1 - myIdx].body;
            ctx.beginPath(); ctx.arc(x0 + d.x * sc, y0 + d.y * sc, 3.5, 0, 7); ctx.fill();
        }
        // pods everyone sees as markers
        for (const it of (Dn.items || [])) { ctx.fillStyle = ITEMS[it.k].color; ctx.fillRect(x0 + it.x * sc - 1.5, y0 + it.y * sc - 1.5, 3, 3); }
        // my hull
        const me = Dn.tanks[myIdx];
        if (me && me.alive) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x0 + me.x * sc, y0 + me.y * sc, 3, 0, 7); ctx.fill(); }
        // heard rival (or the scan ping)
        if (visibleTo(Dn, myIdx, Dn.tanks[1 - myIdx])) {
            ctx.fillStyle = '#ff6b8a';
            ctx.beginPath(); ctx.arc(x0 + Dn.tanks[1 - myIdx].x * sc, y0 + Dn.tanks[1 - myIdx].y * sc, 3, 0, 7); ctx.fill();
        } else if (me && me.alive && Dn.T >= me.scanFrom && Dn.T < me.scanTo && Dn.tanks[1 - myIdx].alive) {
            ctx.strokeStyle = `rgba(255,107,138,${0.4 + 0.6 * Math.abs(Math.sin(now0 / 220))})`; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x0 + Dn.tanks[1 - myIdx].x * sc, y0 + Dn.tanks[1 - myIdx].y * sc, 5, 0, 7); ctx.stroke();
        }
        // camera window
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
        ctx.strokeRect(x0 + ox * sc, y0 + oy * sc, vw * sc, vh * sc);
        ctx.restore();
    }
    let now0 = 0;
    // Fog gets its own offscreen canvas: the darkness is composited once per frame and
    // never erases the world (or your own hull) underneath it.
    const fog = document.createElement('canvas'), fctx = fog.getContext('2d');

    /** Score chips for both factions, kept outside the canvas so they stay crisp. */
    function updateHud(Dn, T) {
        const hb = $('hud');
        for (let i = 0; i < 2; i++) {
            const t = Dn.tanks[i], bar = hb.querySelector(`.hb[data-i="${i}"]`);
            const pct = t.alive ? Math.max(0, Math.min(100, t.hp / t.maxHp * 100)) : 0;
            bar.querySelector('i').style.width = pct + '%';
            bar.querySelector('b').textContent = t.alive ? Math.round(t.hp) : L('respawn', { s: Math.max(1, Math.ceil((t.respawnAt - T) / 1000)) });
            bar.classList.toggle('dead', !t.alive);
        }
        const me = Dn.tanks[myIdx];
        $('score').textContent = `${Dn.sc[myIdx]} : ${Dn.sc[1 - myIdx]}`;
        const st = $('hint');
        let hint = '';
        if (me && !me.alive) hint = '💀 ' + L('respawn', { s: Math.max(1, Math.ceil((me.respawnAt - T) / 1000)) });
        else if (me && inKelp(me.x, me.y) && T > me.reveal) hint = '🌿 ' + L('hidden');
        else if (me && T < (me.flareUntil || 0)) hint = '💡 ' + L('flare_active');
        st.textContent = hint;
    }

    function render(now) {
        now0 = now;
        const { cw, ch, dpr } = resize();
        const Dn = D(), T = nowT();
        const scale = clamp(Math.min(cw, ch) / 640, 0.5, 1.35);
        const vw = cw / scale, vh = ch / scale;

        // display positions (clients smooth toward snapshots)
        let tanks = null;
        if (Dn) {
            tanks = Dn.tanks.map((t, i) => {
                if (myRole === 'host' || !disp[i] || !t.alive || dist(disp[i], t) > 150) disp[i] = { ...t };
                else {
                    const d = disp[i], px = d.x, py = d.y;
                    Object.assign(d, t);
                    d.x = px + (t.x - px) * 0.35; d.y = py + (t.y - py) * 0.35;
                }
                return disp[i];
            });
        }
        const me = tanks ? tanks[myIdx] : { x: W / 2, y: H / 2, alive: true };
        const shown = Dn ? { ...Dn, tanks, T } : null;
        const ox = clamp(me.x - vw / 2, -40, Math.max(-40, W - vw + 40)), oy = clamp(me.y - vh / 2, -40, Math.max(-40, H - vh + 40));
        view = { ox, oy, s: scale, w: vw, h: vh };
        const inView = (x, y, m) => x > ox - m && x < ox + vw + m && y > oy - m && y < oy + vh + m;

        if (Dn && me.alive) markExplored(me.x, me.y, stOf(me).sight);
        const myDrone = Dn && Dn.drones[myIdx];
        if (myDrone && myDrone.hover) markExplored(myDrone.x, myDrone.y, DRONE_R);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#01070b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
        shake = Math.max(0, shake - 0.8);
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (-ox + sx) * dpr * scale, (-oy + sy) * dpr * scale);
        if (!groundCache) groundCache = buildGround();
        ctx.drawImage(groundCache, 0, 0, W, H);

        // ambient vent plumes (decorative, no gameplay effect)
        for (const v of map.vents) {
            if (!inView(v.x, v.y, v.r + 40)) continue;
            const vg = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r);
            vg.addColorStop(0, 'rgba(200,162,255,0.10)'); vg.addColorStop(1, 'rgba(200,162,255,0)');
            ctx.fillStyle = vg; ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 7); ctx.fill();
        }

        // leviathan dens
        const dens = (Dn && Dn.dens) ? Dn.dens : (map.dens || []).map(d => ({ ...d, owner: -1, cap: 0 }));
        for (const d of dens) if (inView(d.x, d.y, d.r + 60)) drawDen(d, now, T);

        // supply pods
        for (const it of (Dn ? Dn.items : [])) {
            if (!inView(it.x, it.y, 40)) continue;
            const landed = T >= it.land;
            ctx.save(); ctx.translate(it.x, it.y);
            ctx.globalAlpha = landed ? 1 : 0.45;
            ctx.fillStyle = ITEMS[it.k].color;
            ctx.beginPath(); ctx.arc(0, 0, ITEM_R * 0.6, 0, 7); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, ITEM_R * 0.85 + Math.sin(now / 300) * 3, 0, 7); ctx.stroke();
            ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#031016'; ctx.fillText(ITEMS[it.k].icon, 0, 1);
            ctx.restore();
            ctx.globalAlpha = 1;
        }

        // siphon mines
        if (Dn) {
            for (const m of Dn.mines) {
                if (!mineVisible(Dn, myIdx, m) || !inView(m.x, m.y, 30)) continue;
                ctx.fillStyle = m.o === myIdx ? '#5cf0a8' : '#ff6b8a';
                ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, 7); ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(m.x, m.y, 12 + Math.sin(now / 300) * 2, 0, 7); ctx.stroke();
            }
        }

        // vent plumes (gameplay: block sonar)
        for (const v of (Dn && Dn.vents) || []) {
            if (!inView(v.x, v.y, v.r + 20)) continue;
            const vg = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.r);
            vg.addColorStop(0, 'rgba(216,241,242,0.28)');
            vg.addColorStop(0.7, 'rgba(180,220,230,0.14)');
            vg.addColorStop(1, 'rgba(216,241,242,0)');
            ctx.fillStyle = vg; ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 7); ctx.fill();
        }

        // kelp fronds (over the floor, under hulls)
        for (const f of map.forests) if (inView(f.x, f.y, f.r)) drawKelp(f, now);

        // dive trails
        if (tanks) {
            for (let i = 0; i < 2; i++) {
                const t = tanks[i];
                if (!t.alive) continue;
                const tr = COLORS[i].trail;
                const tg = ctx.createLinearGradient(t.x, t.y, t.x - Math.cos(t.a) * 90, t.y - Math.sin(t.a) * 90);
                tg.addColorStop(0, tr); tg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.strokeStyle = tg; ctx.lineWidth = 8; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x - Math.cos(t.a) * 90, t.y - Math.sin(t.a) * 90); ctx.stroke();
            }
        }

        // echo drones
        for (let i = 0; i < 2; i++) {
            const d = (Dn && Dn.drones[i]) || null;
            if (!d) continue;
            const mineD = i === myIdx;
            if (mineD && d.hover) {
                // searchlight cone
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                const lg = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, DRONE_R);
                lg.addColorStop(0, 'rgba(255,240,200,0.30)'); lg.addColorStop(1, 'rgba(255,240,200,0)');
                ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(d.x, d.y, DRONE_R, 0, 7); ctx.fill();
                ctx.restore();
            }
            ctx.fillStyle = mineD ? '#fff6c8' : '#7c9aa3';
            ctx.beginPath(); ctx.arc(d.x, d.y, 5, 0, 7); ctx.fill();
        }

        // hunter swarms
        for (let i = 0; i < 2; i++) {
            const h = (Dn && Dn.hunters[i]) || null;
            if (!h) continue;
            for (let k = 0; k < 4; k++) {
                const a = now / 260 + k * Math.PI / 2;
                ctx.fillStyle = k % 2 ? '#c8a2ff' : '#9f7bf0';
                ctx.beginPath(); ctx.arc(h.x + Math.cos(a) * 14, h.y + Math.sin(a) * 14, 3, 0, 7); ctx.fill();
            }
        }

        // hulls: draw my own hull always, the rival only when heard
        if (tanks) {
            for (let i = 0; i < 2; i++) {
                const t = tanks[i];
                if (!t.alive) continue;
                const isMe = i === myIdx;
                if (!isMe && !visibleTo(shown, myIdx, t)) continue;
                ctx.save();
                // camouflage: kelp-hidden rival fades
                if (!isMe && inKelp(t.x, t.y) && shown.T > t.reveal) ctx.globalAlpha = 0.55;
                drawHull(t, i, now, isMe);
                ctx.restore();
                // health bar over the rival
                if (!isMe) {
                    const w = 40, h = 4;
                    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(t.x - w / 2, t.y - 34, w, h);
                    ctx.fillStyle = '#ff6b8a'; ctx.fillRect(t.x - w / 2, t.y - 34, w * Math.max(0, t.hp / t.maxHp), h);
                }
            }
        }

        // torpedoes
        if (Dn) for (const b of Dn.shots) {
            const mineB = b.o === myIdx;
            if (!mineB && !canSeePoint(Dn, b)) continue;
            ctx.save();
            ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
            if (b.eel) {
                ctx.strokeStyle = 'rgba(200,162,255,0.85)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-10, 0); ctx.quadraticCurveTo(-4, Math.sin(now / 60) * 4, 8, 0); ctx.stroke();
            } else {
                ctx.fillStyle = mineB ? '#fff6c8' : '#ffd27a';
                ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, 0, 0, 7); ctx.fill();
                ctx.fillStyle = 'rgba(107,227,216,0.5)';
                ctx.beginPath(); ctx.ellipse(-10, 0, 4, 2, 0, 0, 7); ctx.fill();
            }
            ctx.restore();
        }

        // ---------- fog of war (own offscreen canvas, so it never erases the world)
        const fw = canvas.width, fh = canvas.height;
        if (fog.width !== fw || fog.height !== fh) { fog.width = fw; fog.height = fh; }
        fctx.setTransform(1, 0, 0, 1, 0, 0);
        fctx.clearRect(0, 0, fw, fh);
        fctx.setTransform(dpr * scale, 0, 0, dpr * scale, (-ox) * dpr * scale, (-oy) * dpr * scale);
        fctx.fillStyle = 'rgba(0,4,8,0.86)';
        fctx.fillRect(ox - 200, oy - 200, vw + 400, vh + 400);
        if (me.alive) {
            const sight = T < (me.flareUntil || 0) ? 130 : stOf(me).sight;
            fctx.globalCompositeOperation = 'destination-out';
            const g = fctx.createRadialGradient(me.x, me.y, sight * 0.25, me.x, me.y, sight);
            g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.75, 'rgba(0,0,0,0.92)'); g.addColorStop(1, 'rgba(0,0,0,0)');
            fctx.fillStyle = g; fctx.beginPath(); fctx.arc(me.x, me.y, sight, 0, 7); fctx.fill();
            if (myDrone && myDrone.hover) {
                const dg = fctx.createRadialGradient(myDrone.x, myDrone.y, 0, myDrone.x, myDrone.y, DRONE_R);
                dg.addColorStop(0, 'rgba(0,0,0,1)'); dg.addColorStop(1, 'rgba(0,0,0,0)');
                fctx.fillStyle = dg; fctx.beginPath(); fctx.arc(myDrone.x, myDrone.y, DRONE_R, 0, 7); fctx.fill();
            }
            fctx.globalCompositeOperation = 'source-over';
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(fog, 0, 0);

        // sonar sweep: a sonar ring pulse, drawn inside the fog mask
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (-ox) * dpr * scale, (-oy) * dpr * scale);
        if (me.alive) {
            const phase = (now % 2600) / 2600;
            ctx.strokeStyle = `rgba(107,227,216,${0.5 * (1 - phase)})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(me.x, me.y, 50 + phase * stOf(me).sight * 0.9, 0, 7); ctx.stroke();
        }

        // ---------- screen space: effects, HUD
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (let k = fx.length - 1; k >= 0; k--) {
            const f = fx[k], age = now - f.t;
            if (age > 900) { fx.splice(k, 1); continue; }
            const a = 1 - age / 900;
            const px = (f.x - ox) * scale, py = (f.y - oy) * scale;
            ctx.globalAlpha = a;
            if (f.k === 'blast') {
                ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(px, py, (f.r || 60) * (0.4 + age / 900), 0, 7); ctx.stroke();
            } else if (f.k === 'crit') {
                ctx.strokeStyle = '#ffd36a'; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.arc(px, py, 20 + age / 20, 0, 7); ctx.stroke();
            } else if (f.k === 'deflect') {
                ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(px, py, 12 + age / 30, 0, 7); ctx.stroke();
            } else if (f.k === 'spark') {
                ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 4 * a + 1, 0, 7); ctx.fill();
            } else if (f.k === 'hit') {
                ctx.fillStyle = '#ff9a9a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText('-' + f.dmg, px, py - 16 - age / 40);
            } else if (f.k === 'pick') {
                ctx.fillStyle = f.c; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(f.icon, px, py - 20 * (1 - a));
            } else if (f.k === 'flare_shock') {
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(px, py, FLARE_R * (0.2 + age / 400), 0, 7); ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;

        // banners
        let by = ch * 0.22;
        for (const b of banners) {
            if (now > b.until) continue;
            const a = Math.min(1, (b.until - now) / 300);
            ctx.globalAlpha = a; ctx.textAlign = 'center';
            ctx.font = 'bold 20px sans-serif';
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(b.text, cw / 2 + 1, by + 1);
            ctx.fillStyle = b.color; ctx.fillText(b.text, cw / 2, by);
            by += 30;
        }
        ctx.globalAlpha = 1;

        // HUD (DOM, crisp) + minimap
        if (Dn) {
            updateHud(Dn, T);
            drawMinimap(shown, ox, oy, vw, vh, cw, ch, dpr);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function frame(now) {
        if (!map) useMap(1, currentMapSize);
        const dt = Math.min(100, now - lastFrame);
        lastFrame = now;
        if (myRole === 'host' && S) {
            inputs[0] = overrides[0] || localInput();
            // A hidden tab pauses the dive (both sides' screens are under the fog while
            // the gameover/disconnect card is up, so nobody gains an advantage).
            if (!overlay.classList.contains('hidden')) acc = 0;
            else {
                acc += dt;
                let guard = 0;
                while (acc >= STEP && guard++ < 10) { stepSim(STEP); acc -= STEP; }
                if (acc > 200) acc = 0;
            }
            syncBotSnapshot();      // bot mode: refresh the render snapshot right after stepping
        }
        const Dn = D();
        if (Dn) runEvents(Dn);
        render(now);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // ---------------------------------------------------------------- test hooks
    GameBot.expose({
        state: () => S,
        net: () => net,
        role: () => myRole,
        map: () => map,
        depth: () => currentDepth,
        setDepth,
        size: () => currentMapSize,
        visible: team => (S ? visibleTo(S, team, S.tanks[1 - team]) : false),
        place(i, x, y) { const t = S.tanks[i]; t.x = x; t.y = y; if (i === myIdx) disp[i] = null; },
        freezeBot(on) { bot.frozen = !!on; },
        loadout(i, lo) {                               // swap a hull's loadout mid-match (tests)
            loadouts[i] = validLo(lo);
            if (i === myIdx) myLoadout = loadouts[i];
            const t = S.tanks[i], keep = { x: t.x, y: t.y, a: t.a, ta: t.ta, qs: t.qs, es: t.es, ms: t.ms };
            Object.assign(t, newHull(i, 0, loadouts[i]), keep);
        },
        items(on) { S.itemsOn = !!on; if (!on) S.items.length = 0; },
        spawnItem(k, x, y) { S.items.push({ id: ++S.itemN, k, x, y, land: S.T }); },
        mineVisible: (team, j) => mineVisible(S, team, S.mines[j]),
        stats: i => stOf(S.tanks[i]),
        los: (a, b) => losClear(a, b),
        inKelp: (x, y) => inKelp(x, y),
        explored: () => explored.reduce((a, b) => a + b, 0),
        clearPair(x, y, d) {                           // two open spots `d` apart (east-west) with kelp-free line (tests)
            for (let k = 0; k < 400; k++) {
                const a = this.free(x + (k % 20) * 60 - 600, y + Math.floor(k / 20) * 60 - 600);
                if (!a) continue;
                const b = { x: a.x + d, y: a.y };
                if (!blockedHull(b.x, b.y) && !inKelp(b.x, b.y) && losClear(a, b)) return [a, b];
            }
            return null;
        },
        touchDrag(ang) { dragAim = ang; },
        touchRelease() { if (dragAim !== null) release = { ang: dragAim, until: performance.now() + 650 + (S ? S.tanks[myIdx].cd : 0) }; dragAim = null; },
        prefs,
        setInput(i, v) { overrides[i] = v; },
        free(x0, y0) {                                 // nearest open, kelp-free spot (for tests)
            for (let r = 0; r < 400; r += 12) for (let a = 0; a < 6.28; a += 0.2) {
                const x = x0 + Math.cos(a) * r, y = y0 + Math.sin(a) * r;
                if (!blockedHull(x, y) && !inKelp(x, y)) return { x, y };
            }
            return null;
        }
    });
})();
