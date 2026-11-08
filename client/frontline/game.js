/**
 * Steel Shadow: Recon (client/recon/) — big-map scouting / ambush tank duel.
 *
 * Host-authoritative like the other Link duels: the host (or the only player
 * in ?bot= mode) runs the simulation `S`; the client sends inputs and renders
 * the host's snapshots. Times inside the sim are host-sim milliseconds (S.T),
 * never wall clock, so two devices with skewed clocks agree.
 *
 * Vision rules (what makes scouting/ambush matter):
 *   - each tank sees SIGHT px around it, blocked by ruins and rocks;
 *   - a tank inside a forest is hidden unless the viewer is within
 *     FOREST_SPOT px, or it fired in the last FIRE_REVEAL ms;
 *   - a drone hovering at a point reveals everything inside DRONE_R;
 *   - a satellite scan only shows a ping of the enemy position (no vision);
 *   - a shell fired while the victim could not see the shooter = ambush ×1.6.
 * Enemies the local player can't see are simply not drawn. The fog is drawn
 * on its own offscreen canvas, so it never erases the world under it.
 */
'use strict';
(() => {
    const { L } = window.FrontlineI18n;

    // ---------------------------------------------------------------- tuning & map sizes
    const MAP_SPECS = {
        normal: { w: 2400, h: 1800, name: 'Normal Front', forestN: 10, ruinN: 9, rockN: 6, waterN: 2, patchN: 160, outposts: 1 },
        large:  { w: 3600, h: 2700, name: 'Deep Assault', forestN: 18, ruinN: 15, rockN: 10, waterN: 4, patchN: 260, outposts: 3 },
        huge:   { w: 4800, h: 3600, name: 'Grand War',    forestN: 26, ruinN: 22, rockN: 16, waterN: 6, patchN: 380, outposts: 5 }
    };
    let currentMapSize = 'large';
    let W = 3600, H = 2700, CELL = 60, EC = W / CELL, ER = H / CELL;
    const TANK_R = 20, SPEED = 0.20, FOREST_SLOW = 0.75;
    const SHOT_SPEED = 0.72, SHOT_LIFE = 1200, FIRE_CD = 620, DMG = 26, AMBUSH_MUL = 1.6;
    const SIGHT = 420, FOREST_SPOT = 125, FIRE_REVEAL = 1500;
    const DRONE_CD = 14000, DRONE_TIME = 7500, DRONE_R = 300, DRONE_RANGE = 600, DRONE_SPEED = 0.58;
    const SAT_CD = 22000, SAT_DELAY = 1100, SAT_TIME = 3200;
    const EMP_CD = 24000, EMP_TIME = 4000, EMP_R = 240;
    const SMOKE_CD = 18000, SMOKE_TIME = 6500, SMOKE_R = 170;
    const OUTPOST_R = 90, OUTPOST_CAP_TIME = 3200, OUTPOST_SUPPLY_CD = 24000;
    const WIN = 3, DOM_WIN = 100, RESPAWN = 2400, STEP = 1000 / 60, NET_MS = 50;
    let SPAWNS = [
        [{ x: 180, y: H / 2 }, { x: 220, y: 320 }, { x: 220, y: H - 320 }],
        [{ x: W - 180, y: H / 2 }, { x: W - 220, y: H - 320 }, { x: W - 220, y: 320 }]
    ];
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
    setWorldDimensions('large');
    const COLORS = [{ body: '#e8a33c', dark: '#8a5a17', turret: '#ffc867' }, { body: '#3cbde8', dark: '#165f7a', turret: '#8fe6ff' }];

    // ---------------------------------------------------------------- loadout: class + weapon mod + gear mod
    /** Tank classes. Realistic reload times (2~3.4s), heavy tactical cannon mechanics. */
    const CLASSES = {
        mbt:    { icon: '🛡️', hp: 100, speed: 0.19,  sight: 380, dmg: 25, cd: 2400, shot: 0.42, life: 1900, turn: 0.009, droneCd: 14000, size: 1 },
        scout:  { icon: '🦅', hp: 80,  speed: 0.235, sight: 450, dmg: 20, cd: 1800, shot: 0.45, life: 1600, turn: 0.012, droneCd: 9000,  size: 0.88 },
        heavy:  { icon: '🐘', hp: 150, speed: 0.15,  sight: 340, dmg: 35, cd: 3000, shot: 0.35, life: 2000, turn: 0.0065, droneCd: 16000, size: 1.16 },
        sniper: { icon: '🎯', hp: 80,  speed: 0.17,  sight: 400, dmg: 48, cd: 3400, shot: 0.55, life: 2400, turn: 0.006, droneCd: 14000, size: 0.97 }
    };
    /** Weapon mods: multipliers on the class gun. splash = blast radius on impact. */
    const WEAPONS = {
        std:   { icon: '⚪', dmg: 1, cd: 1, shot: 1 },
        ap:    { icon: '🔩', dmg: 1.35, cd: 1.2, shot: 1.15 },
        rapid: { icon: '⚡', dmg: 0.72, cd: 0.68, shot: 1 },
        he:    { icon: '💥', dmg: 0.95, cd: 1.15, shot: 0.88, splash: 85 }
    };
    const MIN_DISP = 0.00, MAX_DISP = 0.22;
    /** Gear mods. */
    const GEARS = {
        radar:  { icon: '📡' },              // sight +70, sees enemy mines from further
        camo:   { icon: '🍃' },              // still for CAMO_T → hidden on open ground too; harder to spot in forests
        plate:  { icon: '🧱' },              // +35 hp, -10% speed
        mines:  { icon: '💣' },              // 6 mines instead of 3, +12 mine damage
        turbo:  { icon: '🚀' }               // +16% speed, faster turret
    };
    const DEFAULT_LO = { cls: 'mbt', w: 'std', g: 'radar' };
    const validLo = lo => ({
        cls: lo && CLASSES[lo.cls] ? lo.cls : DEFAULT_LO.cls,
        w: lo && WEAPONS[lo.w] ? lo.w : DEFAULT_LO.w,
        g: lo && GEARS[lo.g] ? lo.g : DEFAULT_LO.g
    });
    /** Final stats of a loadout. */
    function statsOf(lo) {
        const c = CLASSES[lo.cls] || CLASSES.mbt, w = WEAPONS[lo.w] || WEAPONS.std, g = lo.g;
        return {
            hp: c.hp + (g === 'plate' ? 35 : 0),
            speed: c.speed * (g === 'plate' ? 0.9 : 1) * (g === 'turbo' ? 1.16 : 1),
            sight: c.sight + (g === 'radar' ? 70 : 0),
            dmg: c.dmg * w.dmg, cd: c.cd * w.cd, shot: c.shot * w.shot, life: c.life,
            turn: c.turn * (g === 'turbo' ? 1.3 : 1), droneCd: c.droneCd,
            splash: w.splash || 0, mines: g === 'mines' ? 6 : 3, mineDmg: MINE_DMG + (g === 'mines' ? 12 : 0),
            spot: g === 'camo' ? 80 : FOREST_SPOT, camo: g === 'camo', size: c.size
        };
    }

    const stCache = {};
    /** Stats of a tank (or any {cls,w,g}); works on host state and client snapshots alike. */
    const stOf = t => { const k = t.cls + '/' + t.w + '/' + t.g; return stCache[k] || (stCache[k] = statsOf(validLo(t))); };

    // ---------------------------------------------------------------- mines & supply crates
    const MINE_DMG = 42, MINE_ARM = 900, MINE_R = 30, MINE_SPOT = 85, MINE_MAX = 4;
    const CAMO_T = 1200, CAMO_SPOT = 210;
    const ITEM_EVERY = 9000, ITEM_MAX = 4, ITEM_FALL = 1600, ITEM_R = 32, BUFF_T = 9000;
    const ITEMS = {
        repair: { icon: '🔧', color: '#7dff9a' },
        shield: { icon: '🛡️', color: '#8fd3ff' },
        rapid:  { icon: '⚡', color: '#ffe066' },
        speed:  { icon: '🚀', color: '#ff9f5a' },
        mines:  { icon: '💣', color: '#ff7a7a' },
        intel:  { icon: '📡', color: '#c79bff' }
    };
    const ITEM_KEYS = Object.keys(ITEMS);

    // ---------------------------------------------------------------- dom
    const $ = id => document.getElementById(id);
    const canvas = $('game'), ctx = canvas.getContext('2d'), field = $('field');
    const overlay = $('overlay'), screens = ['lobby-screen', 'ready-screen', 'gameover-screen', 'disconnect-screen'].map($);
    const fog = document.createElement('canvas'), fctx = fog.getContext('2d');
    const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
    if (isTouch) document.body.classList.add('is-touch');

    if (!location.hash || location.hash.length <= 1) location.hash = 'room-' + Math.random().toString(36).slice(2, 9);
    $('invite-url').value = location.href;
    $('copy-btn').onclick = () => { navigator.clipboard?.writeText(location.href); $('copy-btn').textContent = L('copied'); };
    $('lang').value = window.FrontlineI18n.lang;
    $('lang').onchange = e => { window.FrontlineI18n.setLang(e.target.value); refreshTexts(); };
    window.FrontlineI18n.apply();

    // ---------------------------------------------------------------- map
    function rng(seed) {
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    /** Point-symmetric map (x,y)→(W-x,H-y) so both sides are equally fair. Supports multi-scale warzones & outposts */
    function genMap(seed, sz) {
        if (sz && sz !== currentMapSize) setWorldDimensions(sz);
        const spec = MAP_SPECS[currentMapSize];
        const r = rng(seed), M = { seed, size: currentMapSize, ruins: [], rocks: [], forests: [], water: [], outposts: [] };
        const spawnClear = (x, y, m) => SPAWNS.flat().every(s => Math.hypot(s.x - x, s.y - y) > m);
        const solids = () => [...M.ruins.map(o => ({ x: o.x + o.w / 2, y: o.y + o.h / 2, r: Math.hypot(o.w, o.h) / 2 })), ...M.rocks, ...M.water];
        const farFromSolids = (x, y, rad) => solids().every(o => Math.hypot(o.x - x, o.y - y) > o.r + rad + 64);
        const mirrorC = o => ({ ...o, x: W - o.x, y: H - o.y });
        const mirrorR = o => ({ ...o, x: W - o.x - o.w, y: H - o.y - o.h });
        const half = () => ({ x: 300 + r() * (W / 2 - 400), y: 120 + r() * (H - 240) });

        // Tactical Outposts (Radar Stations)
        M.outposts.push({ id: 0, x: W / 2, y: H * 0.35, r: OUTPOST_R, owner: -1, cap: 0, capTeam: -1 });
        if (spec.outposts >= 3) {
            M.outposts.push({ id: 1, x: W / 2, y: H * 0.65, r: OUTPOST_R, owner: -1, cap: 0, capTeam: -1 });
            M.outposts.push({ id: 2, x: W * 0.3, y: H * 0.5, r: OUTPOST_R, owner: -1, cap: 0, capTeam: -1 });
        }
        if (spec.outposts >= 5) {
            M.outposts.push({ id: 3, x: W * 0.7, y: H * 0.5, r: OUTPOST_R, owner: -1, cap: 0, capTeam: -1 });
            M.outposts.push({ id: 4, x: W / 2, y: H * 0.15, r: OUTPOST_R, owner: -1, cap: 0, capTeam: -1 });
        }

        M.forests.push({ x: W / 2, y: H / 2, r: 140 });
        for (let i = 0, n = 0; n < spec.forestN && i < 400; i++) {
            const p = half(), rad = 80 + r() * 80;
            if (!spawnClear(p.x, p.y, rad + 80) || M.forests.some(f => Math.hypot(f.x - p.x, f.y - p.y) < f.r + rad - 20)) continue;
            const f = { x: p.x, y: p.y, r: rad };
            M.forests.push(f, mirrorC(f)); n++;
        }
        for (let i = 0, n = 0; n < spec.ruinN && i < 500; i++) {
            const p = half(), w = 70 + r() * 150, h = 60 + r() * 130, cx = p.x + w / 2, cy = p.y + h / 2;
            if (!spawnClear(cx, cy, 260) || !farFromSolids(cx, cy, Math.hypot(w, h) / 2) || p.y + h > H - 50) continue;
            if (M.outposts.some(op => Math.hypot(op.x - cx, op.y - cy) < op.r + 80)) continue;
            const o = { x: p.x, y: p.y, w, h };
            M.ruins.push(o, mirrorR(o)); n++;
        }
        for (let i = 0, n = 0; n < spec.rockN && i < 350; i++) {
            const p = half(), rad = 28 + r() * 26;
            if (!spawnClear(p.x, p.y, 200) || !farFromSolids(p.x, p.y, rad)) continue;
            const o = { x: p.x, y: p.y, r: rad };
            M.rocks.push(o, mirrorC(o)); n++;
        }
        for (let i = 0, n = 0; n < spec.waterN && i < 250; i++) {
            const p = half(), rad = 80 + r() * 60;
            if (!spawnClear(p.x, p.y, 280) || !farFromSolids(p.x, p.y, rad)) continue;
            const o = { x: p.x, y: p.y, r: rad };
            M.water.push(o, mirrorC(o)); n++;
        }
        // decorative ground patches
        M.patches = [];
        for (let i = 0; i < spec.patchN; i++) M.patches.push({ x: r() * W, y: r() * H, r: 35 + r() * 110, l: r() });
        return M;
    }

    let map = genMap(1, 'large'), groundCache = null;
    function useMap(seed, sz) {
        if (sz && sz !== currentMapSize) setWorldDimensions(sz);
        if (map.seed === seed && map.size === currentMapSize && groundCache) return;
        map = genMap(seed, currentMapSize);
        groundCache = buildGround();
        explored = new Uint8Array(EC * ER);
    }

    // ---------------------------------------------------------------- geometry
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    function inRect(x, y, o, pad = 0) { return x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad; }
    function circRect(cx, cy, r, o) {
        const nx = clamp(cx, o.x, o.x + o.w), ny = clamp(cy, o.y, o.y + o.h);
        return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
    }
    function blockedTank(x, y) {
        if (x < TANK_R || y < TANK_R || x > W - TANK_R || y > H - TANK_R) return true;
        return map.ruins.some(o => circRect(x, y, TANK_R, o)) ||
            map.rocks.some(o => Math.hypot(x - o.x, y - o.y) < o.r + TANK_R) ||
            map.water.some(o => Math.hypot(x - o.x, y - o.y) < o.r + TANK_R - 6);
    }
    function blockedShot(x, y) {
        if (x < 0 || y < 0 || x > W || y > H) return true;
        return map.ruins.some(o => inRect(x, y, o)) || map.rocks.some(o => Math.hypot(x - o.x, y - o.y) < o.r);
    }
    function inForest(x, y) { return map.forests.some(f => Math.hypot(x - f.x, y - f.y) < f.r - 8); }
    function losClear(a, b) {
        const d = dist(a, b), n = Math.ceil(d / 14);
        for (let i = 1; i < n; i++) {
            const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
            if (map.ruins.some(o => inRect(x, y, o, -3)) || map.rocks.some(o => Math.hypot(x - o.x, y - o.y) < o.r - 3)) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- sim state
    /** S = authoritative state (host only). The client renders `net` instead. */
    let S = null, net = null, netAt = 0;
    let myRole = null, myIdx = 0, channelOpen = false;
    const inputs = [{}, {}], overrides = [null, null];

    const loadouts = [validLo(null), validLo(null)];
    let myLoadout = validLo((() => { try { return JSON.parse(localStorage.getItem('frontline-loadout')); } catch (e) { return null; } })());
    function newTank(i, spawn, lo) {
        const p = SPAWNS[i][spawn % 3], st = statsOf(lo);
        return { x: p.x, y: p.y, a: i ? Math.PI : 0, ta: i ? Math.PI : 0, hp: st.hp, maxHp: st.hp, cd: 0, alive: true, respawnAt: 0,
            cls: lo.cls, w: lo.w, g: lo.g,
            disp: MIN_DISP, crippledUntil: 0, recoil: 0,
            reveal: 0, still: 0, droneAt: 4000, attackAt: 12000, satAt: 9000, satFrom: 0, satTo: 0,
            empAt: 15000, smokeAt: 10000, empUntil: 0, smokeUntil: 0,
            qs: null, as: null, es: null, ms: null, zs: null, xs: null,
            mines: st.mines, shield: 0, shieldTo: 0, rapidTo: 0, speedTo: 0 };
    }
    let itemsOn = localStorage.getItem('frontline-items') !== '0';
    function startMatch() {
        const seed = 1 + Math.floor(Math.random() * 1e9);
        useMap(seed, currentMapSize);
        loadouts[0] = validLo(myLoadout);
        if (GameBot.enabled) loadouts[1] = bot.pickLoadout();
        const outposts = map.outposts.map(op => ({ id: op.id, x: op.x, y: op.y, r: op.r, owner: -1, cap: 0, capTeam: -1, supplyAt: 0 }));
        S = { seed, size: currentMapSize, T: 0, ph: 'play', sc: [0, 0], dom: [0, 0], winReason: null, tanks: [newTank(0, 0, loadouts[0]), newTank(1, 0, loadouts[1])],
            shots: [], drones: [null, null], attackDrones: [null, null], outposts, smokes: [],
            mines: [], items: [], itemsOn, itemAt: 2500, itemN: 0, ev: [], evId: 0, spawnN: [0, 0] };
        bot.reset();
        lastEvId = 0;
        event({ k: 'start', size: currentMapSize });
        showScreen(null);
        broadcast();
    }
    /** Drop a crate (and its mirror image, so both sides get an equal chance). */
    function spawnCrates() {
        for (let k = 0; k < 40; k++) {
            const x = 300 + Math.random() * (W - 600), y = 150 + Math.random() * (H - 300);
            if (blockedTank(x, y) || blockedTank(W - x, H - y) || Math.hypot(x - W / 2, y - H / 2) < 60) continue;
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
            case 'intel': t.droneAt = Math.min(t.droneAt, T); t.satAt = Math.min(t.satAt, T); break;
        }
        event({ k: 'pick', i, it: it.k, x: it.x, y: it.y });
    }
    /** Apply damage (shield first); handles kill/score/game over. */
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

    /** Can `team`'s side see enemy tank `t`? (vision rules in the header) */
    function inSmoke(D, x, y) {
        if (!D || !D.smokes) return false;
        return D.smokes.some(s => D.T < s.until && Math.hypot(s.x - x, s.y - y) < s.r);
    }
    function visibleTo(D, team, t) {
        if (!t.alive) return false;
        const me = D.tanks[team], dr = D.drones[team];
        if (dr && dr.hover && Math.hypot(dr.x - t.x, dr.y - t.y) < DRONE_R) return true;
        // Captured Outposts give radar sight
        if (D.outposts && D.outposts.some(op => op.owner === team && Math.hypot(op.x - t.x, op.y - t.y) < 360)) return true;
        if (!me.alive) return false;
        if (inSmoke(D, t.x, t.y) && dist(me, t) > 70) return false;
        const underEmp = D.T < (me.empUntil || 0);
        const mySight = underEmp ? 130 : stOf(me).sight;
        const d = dist(me, t), ts = stOf(t);
        if (d > mySight || !losClear(me, t)) return false;
        if (D.T <= t.reveal) return true;
        if (inForest(t.x, t.y) && d > ts.spot) return false;
        if (ts.camo && D.T - t.still > CAMO_T && d > CAMO_SPOT) return false;
        return true;
    }
    /** Can `team` see mine `m` (own mines always; enemy ones up close or under a drone)? */
    function mineVisible(D, team, m) {
        if (m.o === team) return true;
        const me = D.tanks[team], dr = D.drones[team];
        if (dr && dr.hover && Math.hypot(dr.x - m.x, dr.y - m.y) < DRONE_R) return true;
        return me.alive && Math.hypot(me.x - m.x, me.y - m.y) < MINE_SPOT + (me.g === 'radar' ? 40 : 0);
    }
    /** Edge-triggered gadget: a counter in the input increases once per press. */
    function pressed(t, key, v) {
        if (typeof v !== 'number') return false;
        if (t[key] === null) {
            t[key] = v;
            return v > 0;
        }
        if (v > t[key]) { t[key] = v; return true; }
        return false;
    }
    function fireShot(t, i, T) {
        const st = stOf(t);
        const amb = !visibleTo(S, 1 - i, t);
        t.recoil = 1.0;
        const spread = (t.disp || 0) > 0.015 ? (Math.random() - 0.5) * t.disp : 0;
        const shootAng = t.ta + spread;
        t.disp = Math.min(MAX_DISP, (t.disp || MIN_DISP) + 0.10);
        S.shots.push({ x: t.x + Math.cos(t.ta) * 30, y: t.y + Math.sin(t.ta) * 30, vx: Math.cos(shootAng) * st.shot, vy: Math.sin(shootAng) * st.shot,
            o: i, life: st.life, amb, dmg: st.dmg, sp: st.splash, w: t.w });
        t.cd = st.cd * (T < t.rapidTo ? 0.5 : 1);
        t.reveal = T + FIRE_REVEAL;
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
                    Object.assign(t, newTank(i, ++S.spawnN[i], t), { droneAt: t.droneAt, attackAt: t.attackAt, satAt: t.satAt, empAt: t.empAt, smokeAt: t.smokeAt, qs: t.qs, as: t.as, es: t.es, ms: t.ms, zs: t.zs, xs: t.xs, still: T });
                    event({ k: 'spawn', i });
                }
                continue;
            }
            if (S.ph !== 'play') continue;
            // move
            let mx = +v.mx || 0, my = +v.my || 0;
            const m = Math.hypot(mx, my);
            if (m > 1) { mx /= m; my /= m; }
            const underEmp = T < (t.empUntil || 0);
            const crippled = T < (t.crippledUntil || 0);
            if (m > 0.12) {
                const sp = st.speed * dt * (inForest(t.x, t.y) ? FOREST_SLOW : 1) * (T < t.speedTo ? 1.35 : 1) * (underEmp ? 0.45 : 1) * (crippled ? 0.52 : 1);
                t.a = Math.atan2(my, mx);
                const nx = t.x + mx * sp, ny = t.y + my * sp;
                if (!blockedTank(nx, t.y)) t.x = nx;
                if (!blockedTank(t.x, ny)) t.y = ny;
                t.still = T;
                t.disp = Math.min(MAX_DISP, (t.disp || MIN_DISP) + dt * 0.0006);
            }
            // aim: explicit (mouse/drag/bot) > auto-track a visible enemy (unless the player turned it off) > follow hull
            const sees = visibleTo(S, i, foe), toFoe = Math.atan2(foe.y - t.y, foe.x - t.x);
            let want = t.a;
            const explicit = typeof v.ax === 'number' && isFinite(v.ax);
            if (explicit) want = v.ax;
            else if (v.aa !== false && sees) want = toFoe;
            const da = angDiff(want, t.ta), turnRate = (v.fw ? st.turn * 1.8 : st.turn) * dt;
            t.ta += clamp(da, -turnRate, turnRate);
            if (Math.abs(da) > 0.02) {
                t.disp = Math.min(MAX_DISP, (t.disp || MIN_DISP) + dt * 0.0004);
            } else if (m <= 0.12) {
                t.disp = Math.max(MIN_DISP, (t.disp || MIN_DISP) - dt * 0.00035);
            }
            // fire: responsive trigger freedom; `fw` = drag-release snaps to target;
            // `af` = auto-fire fallback when lined up on visible enemy
            t.cd = Math.max(0, t.cd - dt);
            t.recoil = Math.max(0, (t.recoil || 0) - dt * 0.006);
            if (t.cd <= 0 && T >= (t.empUntil || 0)) {
                let shoot = false;
                if (v.f) {
                    if (v.fw) {
                        // Touch drag-release: wait for turret to align to dragged direction
                        if (Math.abs(angDiff(want, t.ta)) < 0.07) shoot = true;
                    } else {
                        // Direct press / space / mouse / tap: instant fire! Fire from the current barrel orientation
                        shoot = true;
                    }
                } else if (v.af && sees && dist(t, foe) < st.shot * st.life * 0.95 && Math.abs(angDiff(toFoe, t.ta)) < 0.22 && losClear(t, foe)) {
                    shoot = true;
                }
                if (shoot) fireShot(t, i, T);
            }
            // drone / satellite / mine (edge-triggered by a sequence number so lost packets can't double-fire)
            if (pressed(t, 'qs', v.q) && T >= t.droneAt) {
                const tx = clamp(v.tx ?? (t.x + Math.cos(t.ta) * DRONE_RANGE), 40, W - 40), ty = clamp(v.ty ?? (t.y + Math.sin(t.ta) * DRONE_RANGE), 40, H - 40);
                S.drones[i] = { x: t.x, y: t.y, tx, ty, hover: false, until: 0 };
                t.droneAt = T + st.droneCd;
                event({ k: 'drone', i });
            }
            if (pressed(t, 'as', v.r) && T >= t.attackAt) {
                const tx = clamp(v.tx ?? (t.x + Math.cos(t.ta) * 420), 40, W - 40), ty = clamp(v.ty ?? (t.y + Math.sin(t.ta) * 420), 40, H - 40);
                S.attackDrones[i] = { x: t.x, y: t.y, tx, ty, hover: false, until: 0, next: T + 500, ammo: 4 };
                t.attackAt = T + 18000;
                event({ k: 'attack_drone', i });
            }
            if (pressed(t, 'es', v.e) && T >= t.satAt) {
                t.satFrom = T + SAT_DELAY; t.satTo = T + SAT_DELAY + SAT_TIME; t.satAt = T + SAT_CD;
                event({ k: 'sat', i });
            }
            if (pressed(t, 'ms', v.m) && t.mines > 0) {
                const x = t.x - Math.cos(t.a) * 30, y = t.y - Math.sin(t.a) * 30;
                if (!blockedTank(x, y) || !blockedShot(x, y)) {
                    const own = S.mines.filter(q => q.o === i);
                    if (own.length >= MINE_MAX) S.mines.splice(S.mines.indexOf(own[0]), 1);
                    S.mines.push({ x: Math.round(x), y: Math.round(y), o: i, arm: T + MINE_ARM, dmg: st.mineDmg });
                    t.mines--;
                    event({ k: 'mine_set', i });
                }
            }
            // EMP strike (Z)
            if (pressed(t, 'zs', v.z) && T >= t.empAt) {
                const tx = clamp(v.tx ?? (t.x + Math.cos(t.ta) * 450), 40, W - 40), ty = clamp(v.ty ?? (t.y + Math.sin(t.ta) * 450), 40, H - 40);
                t.empAt = T + EMP_CD;
                event({ k: 'emp', i, x: Math.round(tx), y: Math.round(ty) });
                if (foe.alive && Math.hypot(foe.x - tx, foe.y - ty) < EMP_R) {
                    foe.empUntil = T + EMP_TIME;
                    event({ k: 'emp_hit', i: 1 - i });
                }
            }
            // Smoke screen (X)
            if (pressed(t, 'xs', v.x) && T >= t.smokeAt) {
                t.smokeAt = T + SMOKE_CD;
                S.smokes.push({ x: Math.round(t.x), y: Math.round(t.y), r: SMOKE_R, until: T + SMOKE_TIME, o: i });
                event({ k: 'smoke', i, x: Math.round(t.x), y: Math.round(t.y) });
            }
            // crates
            for (let j = S.items.length - 1; j >= 0; j--) {
                const it = S.items[j];
                if (T >= it.land && Math.hypot(it.x - t.x, it.y - t.y) < ITEM_R) { S.items.splice(j, 1); pickUp(t, i, it); }
            }
            if (t.shield > 0 && T >= t.shieldTo) t.shield = 0;
        }
        // Tactical Outposts capture logic & Supply Drops
        if (S.outposts && S.ph === 'play') {
            const opCount = [0, 0];
            for (const op of S.outposts) {
                let occ = -1, nOcc = 0;
                for (let i = 0; i < 2; i++) {
                    const tk = S.tanks[i];
                    if (tk.alive && Math.hypot(tk.x - op.x, tk.y - op.y) < op.r) { occ = i; nOcc++; }
                }
                if (nOcc === 1) {
                    const rate = (dt / OUTPOST_CAP_TIME) * (stOf(S.tanks[occ]).sight > 400 ? 1.4 : 1.0);
                    if (op.owner === occ) { op.cap = Math.min(1, op.cap + rate); }
                    else {
                        op.cap -= rate;
                        if (op.cap <= 0) {
                            op.owner = occ; op.cap = 0.05;
                            op.supplyAt = T + 10000;
                            event({ k: 'outpost_taken', i: occ, id: op.id });
                        }
                    }
                } else if (nOcc === 0 && op.cap < 1 && op.owner >= 0) {
                    op.cap = Math.min(1, op.cap + dt / (OUTPOST_CAP_TIME * 2));
                }
                if (op.owner >= 0 && op.cap >= 0.8) {
                    opCount[op.owner]++;
                    // Periodic tactical supply drop directly at this outpost
                    if (S.itemsOn) {
                        if (!op.supplyAt) op.supplyAt = T + 12000;
                        if (T >= op.supplyAt) {
                            op.supplyAt = T + OUTPOST_SUPPLY_CD;
                            const kind = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)];
                            S.items.push({ id: ++S.itemN, x: Math.round(op.x), y: Math.round(op.y), k: kind, land: T + 800 });
                            event({ k: 'outpost_supply', op: op.id, kind, x: Math.round(op.x), y: Math.round(op.y) });
                        }
                    }
                }
            }
            // Dominance progression (tracked for stats, but does not end match; kills determine victory!)
            const domRates = [0, 0.0016, 0.0034, 0.0055, 0.0075, 0.0095];
            for (let i = 0; i < 2; i++) {
                const cnt = opCount[i];
                if (cnt > 0) {
                    const rate = (domRates[Math.min(cnt, domRates.length - 1)] || 0.002) * dt;
                    S.dom[i] = Math.min(DOM_WIN, S.dom[i] + rate);
                }
            }
        }
        // Smokes cleanup
        if (S.smokes) {
            for (let k = S.smokes.length - 1; k >= 0; k--) if (T >= S.smokes[k].until) S.smokes.splice(k, 1);
        }
        // mines
        for (let j = S.mines.length - 1; j >= 0; j--) {
            const mn = S.mines[j], t = S.tanks[1 - mn.o];
            if (S.ph === 'play' && T >= mn.arm && t.alive && Math.hypot(mn.x - t.x, mn.y - t.y) < MINE_R) {
                S.mines.splice(j, 1);
                event({ k: 'boom_mine', x: mn.x, y: mn.y });
                t.speedTo = 0;
                damage(t, 1 - mn.o, mn.dmg, mn.o, 'mine', false, mn.x, mn.y);
            }
        }
        // crates drop in over time
        if (S.itemsOn && S.ph === 'play' && T >= S.itemAt) {
            S.itemAt = T + ITEM_EVERY;
            if (S.items.length <= ITEM_MAX - 2) spawnCrates();
        }
        // drones fly out, hover, then return to base (vanish)
        for (let i = 0; i < 2; i++) {
            const d = S.drones[i];
            if (!d) continue;
            if (!d.hover) {
                const dx = d.tx - d.x, dy = d.ty - d.y, l = Math.hypot(dx, dy), s = DRONE_SPEED * dt;
                if (l <= s) { d.x = d.tx; d.y = d.ty; d.hover = true; d.until = T + DRONE_TIME; }
                else { d.x += dx / l * s; d.y += dy / l * s; }
            } else if (T > d.until) S.drones[i] = null;
        }
        for (let i = 0; i < 2; i++) {
            const d = S.attackDrones[i]; if (!d) continue;
            if (!d.hover) {
                const dx = d.tx - d.x, dy = d.ty - d.y, l = Math.hypot(dx, dy), s = 0.72 * dt;
                if (l <= s) { d.x = d.tx; d.y = d.ty; d.hover = true; d.until = T + 5200; }
                else { d.x += dx / l * s; d.y += dy / l * s; }
            } else if (T >= d.next && d.ammo > 0) {
                const target = S.tanks[1 - i];
                if (target.alive && dist(d, target) < 230 && losClear(d, target)) {
                    S.shots.push({ x: d.x, y: d.y, vx: (target.x - d.x) / Math.max(1, dist(d, target)) * 0.62, vy: (target.y - d.y) / Math.max(1, dist(d, target)) * 0.62, o: i, life: 720, amb: false, dmg: 12, sp: 0, drone: true });
                    event({ k: 'drone_strike', i }); d.ammo--; d.next = T + 1050;
                } else d.next = T + 350;
                if (!d.ammo) d.until = Math.min(d.until, T + 400);
            } else if (T > d.until) S.attackDrones[i] = null;
        }
        // shells
        for (let j = S.shots.length - 1; j >= 0; j--) {
            const b = S.shots[j];
            b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
            const t = S.tanks[1 - b.o];
            const hit = t.alive && Math.hypot(b.x - t.x, b.y - t.y) < TANK_R * stOf(t).size + 6;
            const wall = b.life <= 0 || blockedShot(b.x, b.y);
            if (!hit && !wall) continue;
            S.shots.splice(j, 1);
            if (S.ph !== 'play') continue;
            const mul = b.amb ? AMBUSH_MUL : 1;
            if (hit) {
                // Ballistics & Angling analysis
                const bAng = Math.atan2(b.vy, b.vx);
                const relImpactAng = Math.atan2(b.y - t.y, b.x - t.x);
                // Engine Weakspot (Rear Sector of the tank)
                const isRearSector = Math.abs(angDiff(relImpactAng, t.a + Math.PI)) < 0.82;
                const isRearPenetration = Math.abs(angDiff(bAng, t.a)) < 0.85;
                const isEngineCrit = isRearSector || isRearPenetration;

                // Frontal Ricochet Angle (Sloped Front Armor deflection)
                const isFrontSector = Math.abs(angDiff(relImpactAng, t.a)) < 1.35;
                const headOnAngleDiff = Math.abs(angDiff(bAng, t.a + Math.PI));
                const ricoThreshold = (b.w === 'ap') ? 1.25 : 1.05; // AP sabot has better normalization
                const isRicochet = !b.amb && !b.sp && !isEngineCrit && isFrontSector && (headOnAngleDiff > ricoThreshold);

                if (isEngineCrit) {
                    const critDmg = Math.round(b.dmg * mul * 1.75);
                    t.crippledUntil = Math.max(t.crippledUntil || 0, S.T + 1600);
                    event({ k: 'crit', i: 1 - b.o, by: b.o, x: Math.round(t.x), y: Math.round(t.y), dmg: critDmg });
                    damage(t, 1 - b.o, critDmg, b.o, 'crit', b.amb, t.x, t.y);
                } else if (isRicochet) {
                    const ricoDmg = Math.max(4, Math.round(b.dmg * 0.12));
                    event({ k: 'ricochet', i: 1 - b.o, by: b.o, x: Math.round(b.x), y: Math.round(b.y), dmg: ricoDmg });
                    damage(t, 1 - b.o, ricoDmg, b.o, 'ricochet', false, t.x, t.y);
                } else {
                    damage(t, 1 - b.o, b.dmg * mul, b.o, 'shell', b.amb, t.x, t.y);
                }
            } else if (b.life > 0 || b.sp) {
                event({ k: 'spark', x: Math.round(b.x), y: Math.round(b.y), sp: b.sp || 0 });
            }
            // high-explosive splash also catches a near miss (and a tank hugging the wall)
            if (b.sp) {
                if (hit) event({ k: 'spark', x: Math.round(b.x), y: Math.round(b.y), sp: b.sp });
                else if (t.alive && Math.hypot(b.x - t.x, b.y - t.y) < b.sp) damage(t, 1 - b.o, b.dmg * 0.55 * mul, b.o, 'splash', b.amb, t.x, t.y);
            }
        }
    }

    function snapshot() {
        const r = v => Math.round(v * 10) / 10;
        return {
            type: 'state', seed: S.seed, size: S.size || currentMapSize, T: Math.round(S.T), ph: S.ph, sc: S.sc, win: S.win, winReason: S.winReason,
            dom: S.dom ? S.dom.map(r) : [0, 0],
            tanks: S.tanks.map(t => ({ x: r(t.x), y: r(t.y), a: r(t.a * 100) / 100, ta: r(t.ta * 100) / 100, hp: t.hp, alive: t.alive, respawnAt: t.respawnAt,
                reveal: t.reveal, still: t.still, droneAt: t.droneAt, attackAt: t.attackAt, satAt: t.satAt, satFrom: t.satFrom, satTo: t.satTo,
                empAt: t.empAt, smokeAt: t.smokeAt, empUntil: t.empUntil, recoil: r(t.recoil || 0), disp: r((t.disp || MIN_DISP) * 100) / 100, crippledUntil: t.crippledUntil || 0,
                cls: t.cls, w: t.w, g: t.g, maxHp: t.maxHp, mines: t.mines, shield: t.shield, shieldTo: t.shieldTo, rapidTo: t.rapidTo, speedTo: t.speedTo, cd: Math.round(t.cd) })),
            shots: S.shots.map(b => ({ x: r(b.x), y: r(b.y), vx: b.vx, vy: b.vy, o: b.o })),
            drones: S.drones.map(d => d && { x: r(d.x), y: r(d.y), hover: d.hover, until: d.until }),
            attackDrones: S.attackDrones.map(d => d && { x: r(d.x), y: r(d.y), hover: d.hover, until: d.until, ammo: d.ammo }),
            outposts: S.outposts ? S.outposts.map(op => ({ id: op.id, x: op.x, y: op.y, r: op.r, owner: op.owner, cap: r(op.cap) })) : [],
            smokes: S.smokes ? S.smokes.map(s => ({ x: s.x, y: s.y, r: s.r, until: s.until })) : [],
            mines: S.mines, items: S.items, itemsOn: S.itemsOn,
            ev: S.ev
        };
    }
    function broadcast() { if (S && myRole === 'host' && !GameBot.enabled) session.send(snapshot()); }

    // ---------------------------------------------------------------- bot (host side, uses only what its own side can know)
    const bot = {
        reset() { Object.assign(this, { wp: null, seen: null, seenT: -1e9, since: 0, side: 1, q: 0, e: 0, m: 0, mineT: 0, lastPos: null, lastPosT: 0, burstErr: 0, strafeT: 0, camp: 0, frozen: this.frozen || false }); },
        pickLoadout() {
            const any = o => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
            return validLo({ cls: any(CLASSES), w: any(WEAPONS), g: any(GEARS) });
        },
        /** Nearest landed crate the bot can see (or a fresh drop marker, which everyone sees on the minimap). */
        crate(me) {
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
                if (!blockedTank(me.x + Math.cos(a) * 34, me.y + Math.sin(a) * 34)) return { mx: Math.cos(a), my: Math.sin(a) };
            }
            return { mx: 0, my: 0 };
        },
        pickWaypoint(me) {
            const r = Math.random();
            if (r < 0.55 && map.forests.length) {           // lurk in a forest, preferring ones toward the middle/enemy side
                const f = map.forests.slice().sort((a, b) => (a.x - b.x) * 0.002 + (Math.random() - 0.5))[Math.floor(Math.random() * Math.min(6, map.forests.length))];
                return { x: f.x, y: f.y, forest: true };
            }
            for (let k = 0; k < 20; k++) {
                const p = { x: 200 + Math.random() * (W - 400), y: 120 + Math.random() * (H - 240) };
                if (!blockedTank(p.x, p.y)) return p;
            }
            return { x: W / 2, y: H / 2 };
        },
        think(T) {
            const me = S.tanks[1], foe = S.tanks[0], lv = this.level();
            const out = { mx: 0, my: 0, ax: null, f: false, q: this.q, e: this.e, m: this.m };
            if (this.frozen || !me.alive || S.ph !== 'play') return out;
            const sees = visibleTo(S, 1, foe);
            const satLive = T >= me.satFrom && T < me.satTo;
            if (sees || satLive) { this.seen = { x: foe.x, y: foe.y }; this.seenT = T; }
            if (sees) { if (!this.since) { this.since = T; this.burstErr = (Math.random() - 0.5) * 2 * lv.err; } }
            else this.since = 0;

            if (sees && T - this.since > lv.react) {
                const d = dist(me, foe), aim = Math.atan2(foe.y - me.y, foe.x - me.x);
                out.ax = aim + this.burstErr;
                if (T > this.strafeT) { this.strafeT = T + 900 + Math.random() * 1200; this.side = -this.side; this.burstErr = (Math.random() - 0.5) * 2 * lv.err; }
                const hidden = inForest(me.x, me.y) && T > me.reveal;
                if (!(hidden && this.camp > T)) {        // campers hold still in cover until spotted
                    const toward = d > lv.keep + 80 ? 1 : d < lv.keep - 60 ? -1 : 0;
                    let mx = Math.cos(aim) * toward - Math.sin(aim) * this.side * 0.8, my = Math.sin(aim) * toward + Math.cos(aim) * this.side * 0.8;
                    const s = this.steer(me, me.x + mx * 60, me.y + my * 60);
                    out.mx = s.mx; out.my = s.my;
                }
                out.f = losClear(me, foe) && Math.abs(angDiff(me.ta, out.ax)) < 0.22 && Math.random() < lv.fire;
                if (me.mines > 0 && d < 260 && T > this.mineT && Math.random() < lv.gadget * 3) { out.m = ++this.m; this.mineT = T + 2500; }
                return out;
            }
            // no contact: chase last intel, otherwise roam/lurk
            let goal = this.seen && T - this.seenT < 6000 ? this.seen : null;
            const crate = S.itemsOn && this.crate(me);
            if (crate && (!goal || dist(me, crate) < 300) && !(this.camp > T && dist(me, crate) > 350)) { goal = crate; this.camp = 0; }
            else if (!goal) {
                if (!this.wp || dist(me, this.wp) < 50) {
                    if (this.wp && this.wp.forest && Math.random() < lv.camp) this.camp = T + 3000 + Math.random() * 4000;
                    this.wp = this.pickWaypoint(me);
                }
                goal = this.wp;
            } else if (dist(me, goal) < 60) this.seen = null;
            if (this.camp > T && inForest(me.x, me.y)) {
                out.ax = Math.atan2(H / 2 - me.y, W / 2 - me.x) + Math.sin(T / 900) * 0.8;   // scan while lurking
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
                const tgt = this.seen || foe.alive && { x: W - me.x, y: H - me.y } || goal;
                out.ax = Math.atan2(tgt.y - me.y, tgt.x - me.x);
                if (Math.abs(angDiff(me.ta, out.ax)) < 0.3) out.q = ++this.q;
            }
            if (T >= me.satAt && T - this.seenT > 9000 && Math.random() < lv.gadget * 0.6) out.e = ++this.e;
            // seed a mine on the way into a forest or where the enemy was last seen
            if (me.mines > 0 && T > this.mineT && Math.random() < lv.gadget && (inForest(me.x, me.y) || (this.seen && dist(me, this.seen) < 200))) { out.m = ++this.m; this.mineT = T + 6000; }
            return out;
        }
    };
    bot.reset();

    // ---------------------------------------------------------------- input
    const keys = {};
    let mouseAim = null, mouseDown = false, mouseFire = false, touchFire = false, stickVec = { x: 0, y: 0 }, qSeq = 0, rSeq = 0, eSeq = 0, mSeq = 0, zSeq = 0, xSeq = 0;
    /** Player prefs: touch control layout ('single' vs 'dual') */
    const prefs = {
        aim: localStorage.getItem('frontline-aim') === 'manual' ? 'manual' : 'auto',
        autoFire: localStorage.getItem('frontline-autofire') === '1',
        control: localStorage.getItem('frontline-ctrl') === 'single' ? 'single' : 'dual'
    };
    function setAutoFire(on, announce) {
        prefs.autoFire = on; localStorage.setItem('frontline-autofire', on ? '1' : '0');
        if (announce) banner((on ? '🎯 ' : '✋ ') + L(on ? 'af_on' : 'af_off'), '#ffe066', 1200);
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
            mouseDown = true;
            mouseFire = true;
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
            if (e.pointerType === 'mouse' && e.button === 0) {
                mouseDown = false;
                mouseFire = false;
            }
        });
    }

    // virtual stick
    const stick = $('stick'), knob = $('knob');
    let stickId = null;
    let singleFlickAim = null, singleFlickFire = false;
    function stickMove(e) {
        const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
        let dx = e.clientX - cx, dy = e.clientY - cy;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx = dx / l * R; dy = dy / l * R; }
        const norm = l / R;
        if (prefs.control === 'single') {
            // Single-hand tactical mode:
            // Outer zone: vehicle movement
            // Inner flick/aim: instantly aligns cannon and fires
            stickVec = { x: dx / R, y: dy / R };
            if (norm > 0.35) {
                singleFlickAim = Math.atan2(dy, dx);
                if (norm > 0.75 && prefs.autoFire) singleFlickFire = true;
            }
        } else {
            stickVec = { x: dx / R, y: dy / R };
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
    function holdBtn(el, on, off) {
        el.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.init(); on(); });
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => off && off());
    }
    // Fire button doubles as an aim stick: tap/hold = fire (auto-aim), drag = aim the gun, release = fire there.
    const fireBtn = $('fire-btn');
    let fireId = null, fireStart = null, dragAim = null, release = null;
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
        if (dragAim !== null && ev === 'pointerup') release = { ang: dragAim, until: performance.now() + 650 + ((D() && D().tanks[myIdx].cd) || 0) };
        fireId = null; dragAim = null; touchFire = false;
    });
    holdBtn($('drone-btn'), () => { qSeq++; });
    holdBtn($('attack-drone-btn'), () => { rSeq++; });
    holdBtn($('sat-btn'), () => { eSeq++; });
    holdBtn($('emp-btn'), () => { zSeq++; });
    holdBtn($('smoke-btn'), () => { xSeq++; });
    holdBtn($('mine-btn'), () => { mSeq++; });

    let view = { ox: 0, oy: 0, s: 1, w: 0, h: 0 };
    function localInput() {
        let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
        let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
        if (!mx && !my) { mx = stickVec.x; my = stickVec.y; }
        let ax = null, f = !!(keys.Space || touchFire || singleFlickFire || mouseFire), fw = false;
        const me = D()?.tanks[myIdx];
        if (dragAim !== null) ax = dragAim;
        else if (singleFlickAim !== null) ax = singleFlickAim;
        else if (release && performance.now() < release.until) { ax = release.ang; f = true; fw = true; }
        else if (mouseAim && me) ax = Math.atan2(mouseAim.y / view.s + view.oy - me.y, mouseAim.x / view.s + view.ox - me.x);
        if (release && performance.now() >= release.until) release = null;
        return { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, ax: ax === null ? null : Math.round(ax * 100) / 100,
            f, fw, aa: !isTouch || prefs.aim === 'auto', af: prefs.autoFire, q: qSeq, r: rSeq,
            tx: me && mouseAim ? Math.round(mouseAim.x / view.s + view.ox) : null, ty: me && mouseAim ? Math.round(mouseAim.y / view.s + view.oy) : null,
            e: eSeq, m: mSeq, z: zSeq, x: xSeq };
    }

    // ---------------------------------------------------------------- network
    const D = () => (myRole === 'host' ? S : net);
    /** Host-sim time as best known locally (client extrapolates from the last snapshot). */
    const nowT = () => (myRole === 'host' ? (S ? S.T : 0) : net ? net.T + (performance.now() - netAt) : 0);

    const session = GameBot.session({
        gameFolder: 'frontline',
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

    let lastEvId = 0, wantRestart = false;
    function handleMessage(m) {
        if (!m || typeof m !== 'object') return;
        if (m.type === 'input' && myRole === 'host') {
            const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);
            inputs[1] = { mx: n(m.mx), my: n(m.my), ax: typeof m.ax === 'number' && isFinite(m.ax) ? m.ax : null, f: !!m.f, fw: !!m.fw, aa: m.aa !== false, af: !!m.af, q: n(m.q), r: n(m.r), tx: typeof m.tx === 'number' && isFinite(m.tx) ? m.tx : null, ty: typeof m.ty === 'number' && isFinite(m.ty) ? m.ty : null, e: n(m.e), m: n(m.m), z: n(m.z), x: n(m.x) };
            if (m.lo) loadouts[1] = validLo(m.lo);
        } else if (m.type === 'restart' && myRole === 'host') {
            if (!S || S.ph === 'over') startMatch();
        } else if (m.type === 'state' && myRole === 'client') {
            if (!net || net.seed !== m.seed || (m.size && m.size !== currentMapSize)) lastEvId = 0;
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
    function chipRow(id, table, key, prefix) {
        const box = $(id);
        box.textContent = '';
        for (const k of Object.keys(table)) {
            const b = document.createElement('button');
            b.type = 'button'; b.dataset.k = k;
            b.textContent = table[k].icon + ' ' + L(prefix + k);
            b.classList.toggle('on', myLoadout[key] === k);
            b.onclick = () => {
                myLoadout = validLo({ ...myLoadout, [key]: k });
                localStorage.setItem('frontline-loadout', JSON.stringify(myLoadout));
                renderOptions();
            };
            box.appendChild(b);
        }
    }
    function renderOptions() {
        // Map size chips (host only)
        const mapBox = $('map-chips');
        if (mapBox) {
            mapBox.textContent = '';
            for (const sz of Object.keys(MAP_SPECS)) {
                const b = document.createElement('button');
                b.type = 'button'; b.dataset.sz = sz;
                b.textContent = L('map_' + sz);
                b.classList.toggle('active', currentMapSize === sz);
                b.disabled = myRole === 'client';
                b.onclick = () => {
                    setWorldDimensions(sz);
                    renderOptions();
                };
                mapBox.appendChild(b);
            }
            $('map-desc').textContent = L('d_map_' + currentMapSize);
        }

        // Control mode chips
        const ctrlBox = $('ctrl-chips');
        if (ctrlBox) {
            ctrlBox.textContent = '';
            for (const cm of ['dual', 'single']) {
                const b = document.createElement('button');
                b.type = 'button'; b.dataset.cm = cm;
                b.textContent = L('ctrl_' + cm);
                b.classList.toggle('active', prefs.control === cm);
                b.onclick = () => {
                    prefs.control = cm;
                    localStorage.setItem('frontline-ctrl', cm);
                    const touchEl = $('touch');
                    if (touchEl) touchEl.classList.toggle('mode-single', cm === 'single');
                    renderOptions();
                };
                ctrlBox.appendChild(b);
            }
            $('ctrl-desc').textContent = L('d_ctrl_' + prefs.control);
        }
        const touchEl = $('touch');
        if (touchEl) touchEl.classList.toggle('mode-single', prefs.control === 'single');

        chipRow('cls-chips', CLASSES, 'cls', 'cls_');
        chipRow('w-chips', WEAPONS, 'w', 'w_');
        chipRow('g-chips', GEARS, 'g', 'g_');
        $('cls-desc').textContent = L('d_' + myLoadout.cls);
        $('w-desc').textContent = L('dw_' + myLoadout.w);
        $('g-desc').textContent = L('dg_' + myLoadout.g);
        const st = statsOf(myLoadout);
        $('lo-stats').textContent = `${L('st_hp')} ${st.hp} · ${L('st_spd')} ${Math.round(st.speed * 1000)} · ${L('st_sight')} ${st.sight} · ` +
            `${L('st_dmg')} ${Math.round(st.dmg)}${st.splash ? '💥' : ''} · ${(st.cd / 1000).toFixed(1)}s ${L('reloading')} · ${L('st_range')} ${Math.round(st.shot * st.life)} · 💣${st.mines}`;
        const canItems = myRole !== 'client';
        $('items-btn').textContent = canItems ? L(itemsOn ? 'items_on' : 'items_off') : L('items_host');
        $('items-btn').disabled = !canItems;
        $('items-btn').classList.toggle('off', !itemsOn);
        $('aim-btn').textContent = L(prefs.aim === 'auto' ? 'aim_auto' : 'aim_manual');
        $('aim-btn').classList.toggle('hidden', !isTouch);
        $('af-btn').textContent = L(prefs.autoFire ? 'af_on' : 'af_off');
        $('af-btn').classList.toggle('off', !prefs.autoFire);
    }
    $('items-btn').onclick = () => { itemsOn = !itemsOn; localStorage.setItem('frontline-items', itemsOn ? '1' : '0'); renderOptions(); };
    $('aim-btn').onclick = () => { prefs.aim = prefs.aim === 'auto' ? 'manual' : 'auto'; localStorage.setItem('frontline-aim', prefs.aim); renderOptions(); };
    $('af-btn').onclick = () => setAutoFire(!prefs.autoFire, false);

    function refreshTexts() {
        renderOptions();
        $('role-text').textContent = GameBot.enabled ? GameBot.t('ready', { lv: GameBot.t(GameBot.level).replace(/^\S+\s/, '') })
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
    function showGameOver(D) {
        if (!$('gameover-screen').classList.contains('hidden')) return;
        const won = D.win === myIdx;
        $('result-title').textContent = L(won ? 'win' : 'lose');
        $('result-title').style.color = won ? '#8ef4ff' : '#ff7a7a';
        $('final-score').textContent = `${D.sc[myIdx]} - ${D.sc[1 - myIdx]}`;
        const reasonEl = $('result-reason');
        if (reasonEl) {
            reasonEl.textContent = D.winReason === 'dominance' ? L('win_reason_dom') : L('win_reason_kill');
        }
        $('restart-btn').disabled = false; $('restart-btn').textContent = L('rematch');
        showScreen('gameover-screen');
        if (won) Sfx.win(); else Sfx.lose();
    }

    // ---------------------------------------------------------------- audio
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
            fire() { tone(180, 0.12, 'sawtooth', 0.05, -120); },
            hit() { tone(90, 0.2, 'square', 0.07, -50); },
            boom() { tone(70, 0.5, 'sawtooth', 0.09, -40); },
            gadget() { tone(660, 0.12, 'sine', 0.05, 400); },
            click() { tone(320, 0.06, 'square', 0.04, -100); },
            ping() { tone(1200, 0.25, 'sine', 0.04, -300); },
            ricochet() { tone(1300, 0.16, 'sawtooth', 0.08, -700); },
            crit() { tone(55, 0.35, 'square', 0.12, -25); },
            reload() { tone(880, 0.08, 'sine', 0.04, 120); },
            win() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.06), i * 140)); },
            lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.06), i * 160)); }
        };
    })();

    // ---------------------------------------------------------------- effects
    const fx = [], banners = [];
    function banner(text, color = '#8ef4ff', ms = 1600) { banners.push({ text, color, until: performance.now() + ms, born: performance.now() }); if (banners.length > 3) banners.shift(); }
    function runEvents(D) {
        for (const e of D.ev || []) {
            if (e.id <= lastEvId) continue;
            lastEvId = e.id;
            if (nowT() - e.t > 1500) continue;            // stale (e.g. joined late)
            const mine = e.i === myIdx, now = performance.now();
            switch (e.k) {
                case 'start': explored = new Uint8Array(EC * ER); banner(L('start_msg'), '#8ef4ff', 2400); break;
                case 'fire': if (mine) release = null; if (mine || canSeePoint(D, e)) { fx.push({ k: 'flash', x: e.x, y: e.y, t: now }); fx.push({ k: 'muzzle', x: e.x + Math.cos(e.a) * 36, y: e.y + Math.sin(e.a) * 36, a: e.a, t: now }); Sfx.fire(); } break;
                case 'spark':
                    if (e.sp) { fx.push({ k: 'blast', x: e.x, y: e.y, t: now, r: e.sp }); Sfx.hit(); }
                    else fx.push({ k: 'spark', x: e.x, y: e.y, t: now });
                    break;
                case 'boom_mine': fx.push({ k: 'blast', x: e.x, y: e.y, t: now, r: MINE_R + 30 }); fx.push({ k: 'boom', x: e.x, y: e.y, t: now }); Sfx.boom(); break;
                case 'mine_set': if (mine) Sfx.click(); break;
                case 'drop': banner(L('drop'), '#ffd36a', 1800); Sfx.ping(); break;
                case 'outpost_supply': banner('📦 ' + (L('outpost_supply') || 'Outpost Supply Drop'), '#8ef4ff', 1800); Sfx.ping(); break;
                case 'pick':
                    fx.push({ k: 'pick', x: e.x, y: e.y, t: now, c: ITEMS[e.it].color, icon: ITEMS[e.it].icon });
                    if (mine) { banner(ITEMS[e.it].icon + ' ' + L('it_' + e.it), ITEMS[e.it].color, 1400); Sfx.gadget(); }
                    else if (canSeePoint(D, e)) banner(L('pick_enemy'), '#ff9a9a', 1100);
                    break;
                case 'ricochet':
                    fx.push({ k: 'ricochet', x: e.x, y: e.y, t: now });
                    Sfx.ricochet();
                    banner(mine ? L('ricochet_self') : L('ricochet'), mine ? '#8fd3ff' : '#ffd36a', 1600);
                    if (mine) shake = 6;
                    break;
                case 'crit':
                    fx.push({ k: 'crit', x: e.x, y: e.y, t: now, dmg: e.dmg });
                    Sfx.crit();
                    banner(mine ? L('crit_self') : L('crit_hit'), mine ? '#ff5252' : '#ffc83b', 2200);
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
                    banner(L(mine ? 'killed' : 'kill'), mine ? '#ff7a7a' : '#7dff9a', 2000);
                    if (mine) shake = 18;
                    break;
                case 'drone': if (mine) Sfx.gadget(); break;
                case 'sat': if (mine) { Sfx.gadget(); banner(L('sat_wait'), '#ff9db0', 1100); } break;
                case 'emp': if (mine) Sfx.gadget(); fx.push({ k: 'emp_shock', x: e.x, y: e.y, t: now }); break;
                case 'emp_hit': if (e.i === myIdx) { banner(L('emp_active'), '#ff5252', 2000); Sfx.hit(); shake = 12; } break;
                case 'smoke': if (mine) { Sfx.gadget(); banner(L('smoke_active'), '#e2e8f0', 1400); } break;
                case 'outpost_taken':
                    banner(e.i === myIdx ? L('outpost_taken') : L('outpost_lost'), e.i === myIdx ? '#3cbde8' : '#e8a33c', 2200);
                    Sfx.ping();
                    break;
            }
        }
        if (D.ph === 'over') showGameOver(D);
    }
    function canSeePoint(D, p) { const me = D.tanks[myIdx]; return me.alive && Math.hypot(me.x - p.x, me.y - p.y) < stOf(me).sight; }

    // ---------------------------------------------------------------- exploration (local per player)
    let explored = new Uint8Array(EC * ER);
    function markExplored(cx, cy, rad) {
        for (let y = Math.max(0, Math.floor((cy - rad) / CELL)); y < Math.min(ER, Math.ceil((cy + rad) / CELL)); y++)
            for (let x = Math.max(0, Math.floor((cx - rad) / CELL)); x < Math.min(EC, Math.ceil((cx + rad) / CELL)); x++)
                if (Math.hypot(x * CELL + CELL / 2 - cx, y * CELL + CELL / 2 - cy) < rad) explored[y * EC + x] = 1;
    }

    // ---------------------------------------------------------------- rendering
    const maxTracks = 140;
    const tracks = [];
    const lastTrackPos = [null, null];
    function updateTracks(tanks) {
        if (!tanks) return;
        for (let i = 0; i < 2; i++) {
            const t = tanks[i];
            if (!t || !t.alive) continue;
            const last = lastTrackPos[i];
            if (!last || Math.hypot(t.x - last.x, t.y - last.y) > 22) {
                tracks.push({ x: t.x, y: t.y, a: t.a, born: performance.now() });
                if (tracks.length > maxTracks) tracks.shift();
                lastTrackPos[i] = { x: t.x, y: t.y };
            }
        }
    }
    function drawTracks(now) {
        for (let k = 0; k < tracks.length; k++) {
            const tr = tracks[k], age = now - tr.born;
            if (age > 20000) continue;
            const alpha = Math.max(0, 0.25 * (1 - age / 20000));
            ctx.save();
            ctx.translate(tr.x, tr.y);
            ctx.rotate(tr.a);
            ctx.fillStyle = `rgba(10, 16, 12, ${alpha})`;
            ctx.fillRect(-10, -18, 20, 6);
            ctx.fillRect(-10, 12, 20, 6);
            ctx.restore();
        }
    }

    function buildGround() {
        const g = document.createElement('canvas');
        g.width = W / 2; g.height = H / 2;              // half-res cache: ground is soft anyway
        const c = g.getContext('2d');
        c.scale(0.5, 0.5);
        c.fillStyle = '#1e2920'; c.fillRect(0, 0, W, H);
        for (const p of map.patches) {
            c.fillStyle = p.l < 0.5 ? 'rgba(55,75,45,.45)' : 'rgba(20,30,22,.45)';
            c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill();
        }
        // Strategic concrete service runways connecting spawns and outposts
        c.strokeStyle = 'rgba(40, 50, 58, 0.6)'; c.lineWidth = 26;
        for (const op of (map.outposts || [])) {
            c.beginPath(); c.moveTo(180, H / 2); c.lineTo(op.x, op.y); c.stroke();
            c.beginPath(); c.moveTo(W - 180, H / 2); c.lineTo(op.x, op.y); c.stroke();
        }
        // Center dashed yellow/white centerline for runways
        c.strokeStyle = 'rgba(210, 190, 120, 0.25)'; c.lineWidth = 2; c.setLineDash([16, 14]);
        for (const op of (map.outposts || [])) {
            c.beginPath(); c.moveTo(180, H / 2); c.lineTo(op.x, op.y); c.stroke();
            c.beginPath(); c.moveTo(W - 180, H / 2); c.lineTo(op.x, op.y); c.stroke();
        }
        c.setLineDash([]);
        // Tactical military grid with coordinates
        c.strokeStyle = 'rgba(120, 180, 150, 0.09)'; c.lineWidth = 1.5;
        c.font = 'bold 11px monospace'; c.fillStyle = 'rgba(130, 190, 160, 0.22)';
        for (let x = 0; x <= W; x += 150) {
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
            const col = String.fromCharCode(65 + Math.floor(x / 400));
            for (let y = 0; y <= H; y += 300) c.fillText(`${col}-${Math.floor(y / 300) + 1}`, x + 6, y + 16);
        }
        for (let y = 0; y <= H; y += 150) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
        // Outpost reinforced hexagonal base pads
        for (const op of (map.outposts || [])) {
            c.save();
            c.translate(op.x, op.y);
            c.fillStyle = '#263138';
            c.beginPath();
            for (let a = 0; a < 6; a++) {
                const ang = a * Math.PI / 3;
                const px = Math.cos(ang) * (op.r + 20), py = Math.sin(ang) * (op.r + 20);
                if (a === 0) c.moveTo(px, py); else c.lineTo(px, py);
            }
            c.closePath();
            c.fill();
            c.strokeStyle = '#3a4a54'; c.lineWidth = 4; c.stroke();
            // Hazard perimeter stripes
            c.strokeStyle = '#c49a2a'; c.lineWidth = 3; c.setLineDash([10, 10]);
            c.stroke();
            c.restore();
        }
        for (const w of map.water) {
            c.fillStyle = '#143f54'; c.beginPath(); c.arc(w.x, w.y, w.r, 0, 7); c.fill();
            c.strokeStyle = '#5bbad4'; c.lineWidth = 4; c.stroke();
            c.fillStyle = '#1f5a75'; c.beginPath(); c.arc(w.x - w.r * 0.25, w.y - w.r * 0.2, w.r * 0.45, 0, 7); c.fill();
        }
        for (const f of map.forests) { c.fillStyle = 'rgba(8,24,12,.62)'; c.beginPath(); c.arc(f.x, f.y, f.r + 8, 0, 7); c.fill(); }
        c.strokeStyle = '#4a3520'; c.lineWidth = 12;
        c.strokeRect(6, 6, W - 12, H - 12);
        return g;
    }

    let shake = 0, lastFrame = performance.now(), acc = 0;
    const disp = [null, null];
    function resize() {
        const r = field.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; fog.width = Math.ceil(w / 2); fog.height = Math.ceil(h / 2); }
        return { cw: r.width, ch: r.height, dpr };
    }

    function drawTank(t, i, alpha, T) {
        const c = COLORS[i], st = stOf(t), k = st.size, cls = t.cls, w = t.w;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(t.x, t.y);
        if (T < t.speedTo) {                                   // boost trail
            ctx.fillStyle = 'rgba(255,160,90,.25)';
            ctx.beginPath(); ctx.ellipse(-Math.cos(t.a) * 26, -Math.sin(t.a) * 26, 22, 14, t.a, 0, 7); ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath(); ctx.ellipse(4, 8, 27 * k, 20 * k, 0, 0, 7); ctx.fill();
        ctx.save();
        ctx.rotate(t.a); ctx.scale(k, k);
        ctx.fillStyle = '#1b1f1d';
        ctx.fillRect(-25, -22, 50, 10); ctx.fillRect(-25, 12, 50, 10);
        ctx.fillStyle = '#3a403b';
        for (let q = -22; q < 25; q += 7) { ctx.fillRect(q, -22, 3, 10); ctx.fillRect(q, 12, 3, 10); }
        ctx.fillStyle = c.dark; ctx.fillRect(-22, -15, 44, 30);
        ctx.fillStyle = c.body;
        if (cls === 'scout') { ctx.beginPath(); ctx.moveTo(-20, -12); ctx.lineTo(16, -12); ctx.lineTo(24, 0); ctx.lineTo(16, 12); ctx.lineTo(-20, 12); ctx.fill(); }
        else ctx.fillRect(-20, -13, 40, 24);
        if (cls === 'heavy' || t.g === 'plate') { ctx.fillStyle = c.dark; ctx.fillRect(-18, -17, 36, 4); ctx.fillRect(-18, 13, 36, 4); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(-16, -16, 32, 2); }
        if (t.g === 'camo') { ctx.fillStyle = 'rgba(40,90,40,.65)'; for (const [x, y] of [[-12, -6], [2, 4], [-4, -10], [10, -3]]) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); } }
        if (t.g === 'mines') { ctx.fillStyle = '#2a2a2a'; for (const y of [-7, 0, 7]) { ctx.beginPath(); ctx.arc(-21, y, 3, 0, 7); ctx.fill(); } }
        if (t.g === 'turbo') { ctx.fillStyle = '#ff9f5a'; ctx.fillRect(-25, -6, 4, 4); ctx.fillRect(-25, 2, 4, 4); }
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(12, -10, 6, 20);

        // Hull Armor Angling indicator (Frontal Sloped Armor Arc & Rear Engine Hazard)
        if (i === myIdx) {
            ctx.strokeStyle = 'rgba(94, 240, 255, 0.45)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, 31, -Math.PI * 0.35, Math.PI * 0.35);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255, 90, 60, 0.4)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, 31, Math.PI - Math.PI * 0.28, Math.PI + Math.PI * 0.28);
            ctx.stroke();
        }

        ctx.restore();
        ctx.save();
        ctx.rotate(t.ta); ctx.scale(k, k);
        const len = cls === 'sniper' ? 46 : cls === 'heavy' ? 34 : 30, bw = w === 'he' ? 11 : cls === 'heavy' ? 10 : w === 'ap' || cls === 'sniper' ? 6 : 8;
        const recoilOffset = (t.recoil || 0) * 8;
        ctx.fillStyle = '#20282b';
        if (w === 'rapid') { ctx.fillRect(4 - recoilOffset, -7, len - 4, 5); ctx.fillRect(4 - recoilOffset, 2, len - 4, 5); }
        else ctx.fillRect(4 - recoilOffset, -bw / 2, len, bw);
        if (cls === 'sniper') { ctx.fillStyle = '#20282b'; ctx.fillRect(len - recoilOffset, -bw / 2 - 2, 6, bw + 4); }
        if (w === 'he') { ctx.fillStyle = '#5a2a14'; ctx.fillRect(len - 2 - recoilOffset, -bw / 2 - 1, 6, bw + 2); }
        ctx.fillStyle = c.turret;
        ctx.beginPath(); ctx.arc(0, 0, cls === 'heavy' ? 13 : 11, 0, 7); ctx.fill();
        ctx.strokeStyle = c.dark; ctx.lineWidth = 2; ctx.stroke();
        if (cls === 'scout' || t.g === 'radar') { ctx.strokeStyle = '#d9f6ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-16, -14); ctx.stroke(); ctx.fillStyle = '#5ef0ff'; ctx.beginPath(); ctx.arc(-16, -14, 2.5, 0, 7); ctx.fill(); }
        ctx.restore();
        if (T < (t.crippledUntil || 0)) {
            // Crippled engine smoke puffs
            ctx.save();
            ctx.fillStyle = 'rgba(30, 25, 20, 0.65)';
            const offX = -Math.cos(t.a) * 24 * k, offY = -Math.sin(t.a) * 24 * k;
            for (let s = 0; s < 3; s++) {
                const sp = ((T / 120 + s * 1.5) % 3) / 3;
                ctx.beginPath();
                ctx.arc(offX + (Math.sin(T / 80 + s) * 8), offY - sp * 24, 6 + 12 * sp, 0, 7);
                ctx.fill();
            }
            ctx.restore();
        }
        if (T < (t.empUntil || 0)) {
            // EMP electric lightning arcs
            ctx.save();
            ctx.strokeStyle = '#5ef0ff';
            ctx.lineWidth = 1.8;
            for (let s = 0; s < 3; s++) {
                const a1 = (T / 90 + s * 2.1) % (Math.PI * 2), r1 = 18 * k;
                const a2 = a1 + 0.9, r2 = 24 * k;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
                ctx.lineTo((Math.cos(a1) * r1 + Math.cos(a2) * r2) / 2 + Math.sin(T / 40 + s) * 7,
                           (Math.sin(a1) * r1 + Math.sin(a2) * r2) / 2 + Math.cos(T / 40 + s) * 7);
                ctx.lineTo(Math.cos(a2) * r2, Math.sin(a2) * r2);
                ctx.stroke();
            }
            ctx.restore();
        }
        if (t.shield > 0 && T < t.shieldTo) {                  // shield bubble
            ctx.strokeStyle = `rgba(143,211,255,${0.45 + 0.25 * Math.sin(T / 120)})`; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, 34 * k, 0, 7); ctx.stroke();
            ctx.fillStyle = 'rgba(143,211,255,.12)'; ctx.fill();
        }
        if (T < t.rapidTo) { ctx.strokeStyle = 'rgba(255,224,102,.7)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(0, 0, 28 * k, T / 300, T / 300 + 5); ctx.stroke(); ctx.setLineDash([]); }
        ctx.restore();
        // hp (+ shield) bar and class tag
        ctx.globalAlpha = alpha;
        const bw2 = 52, hpw = (bw2 - 2) * t.hp / (t.maxHp || 100);
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(t.x - bw2 / 2, t.y - 38 * k, bw2, 7);
        ctx.fillStyle = t.hp > t.maxHp / 2 ? '#70ff91' : t.hp > t.maxHp / 4 ? '#ffd36a' : '#ff6060';
        ctx.fillRect(t.x - bw2 / 2 + 1, t.y - 38 * k + 1, hpw, 5);
        if (t.shield > 0 && T < t.shieldTo) { ctx.fillStyle = '#8fd3ff'; ctx.fillRect(t.x - bw2 / 2 + 1, t.y - 38 * k + 1, (bw2 - 2) * Math.min(1, t.shield / (t.maxHp || 100)), 2); }
        ctx.font = '11px system-ui'; ctx.textAlign = 'right'; ctx.fillText(CLASSES[cls]?.icon || '', t.x - bw2 / 2 - 2, t.y - 30 * k);
        ctx.globalAlpha = 1;
    }
    function drawMine(m, mine, T) {
        const armed = T >= m.arm;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(m.x + 2, m.y + 3, 10, 0, 7); ctx.fill();
        ctx.fillStyle = '#3b3a33'; ctx.beginPath(); ctx.arc(m.x, m.y, 9, 0, 7); ctx.fill();
        ctx.strokeStyle = mine ? '#8fd3ff' : '#ff536a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = armed ? (Math.floor(T / 400) % 2 ? '#ff3a3a' : '#661010') : '#888';
        ctx.beginPath(); ctx.arc(m.x, m.y, 3, 0, 7); ctx.fill();
        if (!mine) { ctx.strokeStyle = 'rgba(255,83,106,.5)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(m.x, m.y, MINE_R, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    }
    function drawCrate(it, T, now) {
        const fall = clamp((it.land - T) / ITEM_FALL, 0, 1), h = fall * 160, info = ITEMS[it.k];
        ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.25 * (1 - fall)})`;
        ctx.beginPath(); ctx.ellipse(it.x + 3, it.y + 6, 18 * (1 - fall * 0.5), 10 * (1 - fall * 0.5), 0, 0, 7); ctx.fill();
        const y = it.y - h - (fall ? 0 : 4 + 3 * Math.sin(now / 260 + it.id));
        if (fall > 0) {                                        // parachute
            ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(it.x - 12, y - 10); ctx.lineTo(it.x - 22, y - 44); ctx.moveTo(it.x + 12, y - 10); ctx.lineTo(it.x + 22, y - 44); ctx.stroke();
            ctx.fillStyle = '#e8e2cf'; ctx.beginPath(); ctx.arc(it.x, y - 44, 26, Math.PI, 0); ctx.fill();
        } else {
            ctx.strokeStyle = info.color; ctx.globalAlpha = 0.4 + 0.3 * Math.sin(now / 200); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(it.x, it.y, ITEM_R, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#7a5a2e'; ctx.fillRect(it.x - 14, y - 12, 28, 22);
        ctx.strokeStyle = '#c99a52'; ctx.lineWidth = 2; ctx.strokeRect(it.x - 14, y - 12, 28, 22);
        ctx.font = '15px system-ui'; ctx.textAlign = 'center'; ctx.fillText(info.icon, it.x, y + 4);
    }
    function drawRuin(o) {
        const hgt = 22;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(o.x + 6, o.y + 8, o.w, o.h);
        ctx.fillStyle = '#4c4e47'; ctx.fillRect(o.x, o.y - hgt + o.h, o.w, hgt);         // front wall
        ctx.fillStyle = '#7b7d70'; ctx.fillRect(o.x, o.y - hgt, o.w, o.h);               // roof/top
        ctx.strokeStyle = '#9a9c8c'; ctx.lineWidth = 2; ctx.strokeRect(o.x + 1, o.y - hgt + 1, o.w - 2, o.h - 2);
        ctx.fillStyle = '#5f6157';
        for (let k = 12; k < o.w - 10; k += 26) ctx.fillRect(o.x + k, o.y - hgt + 8, 10, Math.min(14, o.h - 16));
    }
    function drawRock(o) {
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(o.x + 5, o.y + 7, o.r, 0, 7); ctx.fill();
        ctx.fillStyle = '#6a6458'; ctx.beginPath(); ctx.arc(o.x, o.y - 6, o.r, 0, 7); ctx.fill();
        ctx.fillStyle = '#8b8473'; ctx.beginPath(); ctx.arc(o.x - o.r * 0.3, o.y - 6 - o.r * 0.3, o.r * 0.5, 0, 7); ctx.fill();
    }
    function drawForest(f, under) {
        ctx.save();
        ctx.globalAlpha = under ? 0.42 : 0.94;
        const n = Math.max(6, Math.round(f.r / 14));
        const r0 = rng(Math.round(f.x * 7 + f.y));
        ctx.fillStyle = '#1e4a2c'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
        for (let k = 0; k < n; k++) {
            const a = r0() * 7, d = Math.sqrt(r0()) * (f.r - 22), x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d, rr = 20 + r0() * 16;
            ctx.fillStyle = k % 3 ? '#2f6b3d' : '#3f8248';
            ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill();
            ctx.fillStyle = 'rgba(160,220,140,.18)'; ctx.beginPath(); ctx.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.45, 0, 7); ctx.fill();
        }
        ctx.restore();
    }
    function drawDrone(d, mine, now) {
        const hover = 26;
        if (d.hover) {
            ctx.strokeStyle = mine ? 'rgba(110,240,255,.5)' : 'rgba(255,90,110,.5)';
            ctx.setLineDash([10, 8]); ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(d.x, d.y, DRONE_R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(d.x + 6, d.y + 10, 14, 9, 0, 0, 7); ctx.fill();
        ctx.save(); ctx.translate(d.x, d.y - hover);
        ctx.strokeStyle = mine ? '#bdf7ff' : '#ffb0bc'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(12, 12); ctx.moveTo(12, -12); ctx.lineTo(-12, 12); ctx.stroke();
        ctx.fillStyle = mine ? '#4fe3ff' : '#ff5a6e';
        for (const [x, y] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 30 + x); ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1; ctx.fillStyle = '#e8fbff'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
        ctx.restore();
    }


    function drawOutpost(op, now, T) {
        const rad = op.r;
        ctx.save();
        ctx.translate(op.x, op.y);
        // Base perimeter ring
        const ownerColor = op.owner === 0 ? COLORS[0].body : op.owner === 1 ? COLORS[1].body : '#8899a6';
        ctx.strokeStyle = ownerColor;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, rad, 0, 7); ctx.stroke();
        ctx.fillStyle = op.owner === -1 ? 'rgba(40,55,65,0.3)' : op.owner === myIdx ? 'rgba(60,189,232,0.22)' : 'rgba(232,163,60,0.22)';
        ctx.fill();

        // Holographic radar sweep beam
        const sweepAngle = (now / 1500) % (Math.PI * 2);
        const sweepGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, rad);
        const sweepRgb = op.owner === myIdx ? '60, 189, 232' : op.owner >= 0 ? '232, 163, 60' : '150, 210, 230';
        sweepGrad.addColorStop(0, `rgba(${sweepRgb}, 0.35)`);
        sweepGrad.addColorStop(1, `rgba(${sweepRgb}, 0)`);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, rad, sweepAngle - 0.45, sweepAngle);
        ctx.closePath();
        ctx.fillStyle = sweepGrad;
        ctx.fill();
        ctx.strokeStyle = op.owner === myIdx ? '#8fe6ff' : op.owner >= 0 ? '#ffc867' : '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(sweepAngle) * rad, Math.sin(sweepAngle) * rad); ctx.stroke();

        // Capture ring indicator
        if (op.cap > 0 && op.cap < 1) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(0, 0, rad - 6, -Math.PI / 2, -Math.PI / 2 + op.cap * Math.PI * 2);
            ctx.stroke();
        }

        // Radar dish rotating
        const rot = (now / 1200) % (Math.PI * 2);
        ctx.rotate(rot);
        ctx.fillStyle = '#1b2630';
        ctx.beginPath(); ctx.arc(0, 0, 24, 0, 7); ctx.fill();
        ctx.strokeStyle = ownerColor;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -6, 14, Math.PI, 0); ctx.stroke();
        // Blinking beacon LED
        ctx.fillStyle = Math.sin(now / 160) > 0 ? '#5ef0ff' : '#ffffff';
        ctx.beginPath(); ctx.arc(0, -6, 3.5, 0, 7); ctx.fill();

        ctx.restore();
        // Label with capture percentage
        ctx.fillStyle = ownerColor;
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        const capPct = op.owner >= 0 ? Math.round(op.cap * 100) + '%' : '0%';
        ctx.fillText(`🛰️ OUTPOST ${op.owner === myIdx ? 'SECURED' : op.owner >= 0 ? 'ENEMY' : 'NEUTRAL'} (${capPct})`, op.x, op.y + rad + 18);
    }

    function drawSmoke(s, now, T) {
        ctx.save();
        const pulse = 0.85 + 0.15 * Math.sin(now / 180);
        const grad = ctx.createRadialGradient(s.x, s.y, s.r * 0.2, s.x, s.y, s.r * pulse);
        grad.addColorStop(0, 'rgba(220, 230, 240, 0.88)');
        grad.addColorStop(0.6, 'rgba(160, 180, 195, 0.7)');
        grad.addColorStop(1, 'rgba(100, 120, 130, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * pulse, 0, 7); ctx.fill();
        ctx.restore();
    }

    function render(now) {
        const { cw, ch, dpr } = resize();
        const Dn = D();
        const T = nowT();
        const scale = clamp(Math.min(cw, ch) / 640, 0.5, 1.35);
        const vw = cw / scale, vh = ch / scale;

        // display positions (client: smooth toward snapshots)
        let tanks = null;
        if (Dn) {
            tanks = Dn.tanks.map((t, i) => {
                if (myRole === 'host' || !disp[i] || !t.alive || dist(disp[i], t) > 150) disp[i] = { ...t };
                else { const d = disp[i], px = d.x, py = d.y; Object.assign(d, t); d.x = px + (t.x - px) * 0.35; d.y = py + (t.y - py) * 0.35; }
                return disp[i];
            });
        }
        const me = tanks ? tanks[myIdx] : { x: W / 2, y: H / 2, alive: true };
        const shown = Dn ? { ...Dn, tanks, T } : null;
        const ox = clamp(me.x - vw / 2, -40, W - vw + 40), oy = clamp(me.y - vh / 2, -40, H - vh + 40);
        view = { ox, oy, s: scale, w: vw, h: vh };

        const inView = (x, y, m) => x > ox - m && x < ox + vw + m && y > oy - m && y < oy + vh + m;
        if (Dn && me.alive) markExplored(me.x, me.y, stOf(me).sight);
        const myDrone = Dn && Dn.drones[myIdx];
        if (myDrone && myDrone.hover) markExplored(myDrone.x, myDrone.y, DRONE_R);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#05090d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
        shake = Math.max(0, shake - 0.8);
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (-ox + sx) * dpr * scale, (-oy + sy) * dpr * scale);
        if (!groundCache) groundCache = buildGround();
        ctx.drawImage(groundCache, 0, 0, W, H);
        updateTracks(tanks);
        drawTracks(now);

        // Draw outposts
        if (map.outposts) {
            const outposts = (Dn && Dn.outposts) ? Dn.outposts : map.outposts;
            for (const op of outposts) if (inView(op.x, op.y, op.r + 50)) drawOutpost(op, now, T);
        }

        // Draw smokes
        if (Dn && Dn.smokes) {
            for (const s of Dn.smokes) if (inView(s.x, s.y, s.r + 40)) drawSmoke(s, now, T);
        }

        if (Dn) for (const m of Dn.mines || []) if (inView(m.x, m.y, 40) && mineVisible(shown, myIdx, m)) drawMine(m, m.o === myIdx, T);
        // aim guide: dashed line along the gun to its range + dynamic reticle and reload ring
        if (Dn && me.alive) {
            const st = stOf(me), ang = dragAim !== null ? dragAim : release ? release.ang : me.ta, rng2 = st.shot * st.life;
            ctx.strokeStyle = dragAim !== null || release ? 'rgba(255,230,120,.75)' : prefs.autoFire ? 'rgba(255,224,102,.28)' : 'rgba(255,255,255,.2)';
            ctx.lineWidth = dragAim !== null ? 3 : 2; ctx.setLineDash([12, 10]);
            ctx.beginPath(); ctx.moveTo(me.x + Math.cos(ang) * 34, me.y + Math.sin(ang) * 34); ctx.lineTo(me.x + Math.cos(ang) * rng2, me.y + Math.sin(ang) * rng2); ctx.stroke();
            ctx.setLineDash([]);
            if (dragAim !== null) { ctx.fillStyle = 'rgba(255,230,120,.8)'; ctx.beginPath(); ctx.arc(me.x + Math.cos(ang) * rng2, me.y + Math.sin(ang) * rng2, 6, 0, 7); ctx.fill(); }

            // Dynamic Reticle with Dispersion & Reload status at aim target
            let targetX = me.x + Math.cos(ang) * Math.min(rng2, 340), targetY = me.y + Math.sin(ang) * Math.min(rng2, 340);
            if (mouseAim && !isTouch) {
                targetX = mouseAim.x / view.s + view.ox;
                targetY = mouseAim.y / view.s + view.oy;
            }
            const dispRadius = Math.max(14, (me.disp || MIN_DISP) * 180);
            const cdRatio = clamp((me.cd || 0) / st.cd, 0, 1);
            const ready = cdRatio === 0;

            ctx.save();
            ctx.translate(targetX, targetY);

            // Dispersion circle
            ctx.strokeStyle = ready ? 'rgba(94, 240, 255, 0.75)' : 'rgba(255, 120, 80, 0.65)';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.arc(0, 0, dispRadius, 0, 7); ctx.stroke();
            ctx.setLineDash([]);

            // Crosshair tick marks
            const tick = 6;
            ctx.strokeStyle = ready ? '#5ef0ff' : '#ff7a7a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -dispRadius - tick); ctx.lineTo(0, -dispRadius + tick);
            ctx.moveTo(0, dispRadius - tick); ctx.lineTo(0, dispRadius + tick);
            ctx.moveTo(-dispRadius - tick, 0); ctx.lineTo(-dispRadius + tick, 0);
            ctx.moveTo(dispRadius - tick, 0); ctx.lineTo(dispRadius + tick, 0);
            ctx.stroke();

            // Center pip
            ctx.fillStyle = ready ? '#5ef0ff' : '#ff7a7a';
            ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill();

            // Reload Progress Arc
            if (!ready) {
                ctx.strokeStyle = '#ff9f5a';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, dispRadius + 7, -Math.PI / 2, -Math.PI / 2 + (1 - cdRatio) * Math.PI * 2);
                ctx.stroke();

                ctx.font = 'bold 11px system-ui';
                ctx.fillStyle = '#ffb070';
                ctx.textAlign = 'center';
                ctx.fillText(`${(me.cd / 1000).toFixed(1)}s`, 0, dispRadius + 22);
            } else {
                ctx.strokeStyle = 'rgba(125, 255, 154, 0.85)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(0, 0, dispRadius + 6, 0, 7); ctx.stroke();
            }
            ctx.restore();
        }
        // painter's order: ruins/rocks/tanks sorted by their bottom edge
        const items = [];
        for (const o of map.ruins) if (inView(o.x + o.w / 2, o.y + o.h / 2, 260)) items.push({ y: o.y + o.h, draw: () => drawRuin(o) });
        for (const o of map.rocks) if (inView(o.x, o.y, 80)) items.push({ y: o.y + o.r, draw: () => drawRock(o) });
        if (Dn) for (const it of Dn.items || []) if (inView(it.x, it.y, 200)) items.push({ y: it.y + 8, draw: () => drawCrate(it, T, now) });
        const enemyVisible = Dn ? visibleTo(shown, myIdx, tanks[1 - myIdx]) : false;
        if (Dn) {
            tanks.forEach((t, i) => {
                if (!t.alive) return;
                if (i === myIdx) items.push({ y: t.y + TANK_R, draw: () => drawTank(t, i, inForest(t.x, t.y) || (stOf(t).camo && T - t.still > CAMO_T) ? 0.8 : 1, T) });
                else if (enemyVisible) items.push({ y: t.y + TANK_R, draw: () => drawTank(t, i, 1, T) });
            });
        }
        items.sort((a, b) => a.y - b.y).forEach(it => it.draw());

        // target lock brackets when autoFire is on and enemy is visible
        if (Dn && prefs.autoFire && enemyVisible && tanks[1 - myIdx] && tanks[1 - myIdx].alive) {
            const foeTank = tanks[1 - myIdx];
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 77, 77, 0.85)';
            ctx.lineWidth = 2;
            const sz = 24;
            ctx.beginPath();
            ctx.moveTo(foeTank.x - sz, foeTank.y - sz + 8); ctx.lineTo(foeTank.x - sz, foeTank.y - sz); ctx.lineTo(foeTank.x - sz + 8, foeTank.y - sz);
            ctx.moveTo(foeTank.x + sz, foeTank.y - sz + 8); ctx.lineTo(foeTank.x + sz, foeTank.y - sz); ctx.lineTo(foeTank.x + sz - 8, foeTank.y - sz);
            ctx.moveTo(foeTank.x - sz, foeTank.y + sz - 8); ctx.lineTo(foeTank.x - sz, foeTank.y + sz); ctx.lineTo(foeTank.x - sz + 8, foeTank.y + sz);
            ctx.moveTo(foeTank.x + sz, foeTank.y + sz - 8); ctx.lineTo(foeTank.x + sz, foeTank.y + sz); ctx.lineTo(foeTank.x + sz - 8, foeTank.y + sz);
            ctx.stroke();
            ctx.restore();
        }

        // forest canopies (see-through over your own tank)
        for (const f of map.forests) if (inView(f.x, f.y, f.r + 40)) drawForest(f, Dn && me.alive && Math.hypot(me.x - f.x, me.y - f.y) < f.r + 10);
        // tank inside a forest stays readable under the canopy
        if (Dn && me.alive && inForest(me.x, me.y)) { ctx.strokeStyle = 'rgba(140,255,170,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(me.x, me.y, 30, 0, 7); ctx.stroke(); }
        if (Dn && enemyVisible && inForest(tanks[1 - myIdx].x, tanks[1 - myIdx].y)) drawTank(tanks[1 - myIdx], 1 - myIdx, 0.75, T);

        // shells (only near what I can see) + effects
        if (Dn) {
            const ext = myRole === 'host' ? 0 : Math.min(80, performance.now() - netAt);
            for (const b of Dn.shots) {
                const x = b.x + b.vx * ext, y = b.y + b.vy * ext;
                if (b.o !== myIdx && Math.hypot(x - me.x, y - me.y) > stOf(me).sight + 40 && !(myDrone && myDrone.hover && Math.hypot(x - myDrone.x, y - myDrone.y) < DRONE_R)) continue;
                ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x + 4, y + 8, 4, 0, 7); ctx.fill();
                ctx.strokeStyle = 'rgba(255,200,90,.45)'; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - b.vx * 40, y - b.vy * 40); ctx.stroke();
                ctx.fillStyle = '#fff1b8'; ctx.shadowColor = '#ffab32'; ctx.shadowBlur = 14;
                ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
            }
        }
        for (let k = fx.length - 1; k >= 0; k--) {
            const f = fx[k], age = now - f.t;
            const life = { flash: 120, muzzle: 160, spark: 260, hit: 700, boom: 900, blast: 450, pick: 800, ricochet: 520, crit: 850 }[f.k];
            if (age > life) { fx.splice(k, 1); continue; }
            const p = Math.max(0, age / life);          // rAF time can trail performance.now()
            if (f.k === 'flash') { ctx.fillStyle = `rgba(255,220,120,${1 - p})`; ctx.beginPath(); ctx.arc(f.x, f.y, 34 * (1 - p) + 10, 0, 7); ctx.fill(); }
            if (f.k === 'muzzle') {
                ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a);
                ctx.fillStyle = `rgba(255,220,80,${1 - p})`;
                ctx.beginPath(); ctx.moveTo(0, -6 * (1 - p)); ctx.lineTo(24 * (1 - p), 0); ctx.lineTo(0, 6 * (1 - p)); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = `rgba(255,170,40,${(1 - p) * 0.7})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 14 * p + 4, 0, 7); ctx.stroke();
                ctx.restore();
            }
            if (f.k === 'spark') { ctx.strokeStyle = `rgba(255,210,120,${1 - p})`; ctx.lineWidth = 2; for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(a) * 18 * p + 2, f.y + Math.sin(a) * 18 * p + 2); ctx.stroke(); } }
            if (f.k === 'ricochet') {
                ctx.save();
                ctx.strokeStyle = `rgba(255,245,180,${1 - p})`; ctx.lineWidth = 2.5;
                for (let a = 0; a < 7; a++) {
                    const ang = a * 0.9 + p * 1.5;
                    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(ang) * 26 * p, f.y + Math.sin(ang) * 26 * p); ctx.stroke();
                }
                ctx.font = '900 15px system-ui'; ctx.fillStyle = `rgba(255,230,120,${1 - p})`; ctx.textAlign = 'center';
                ctx.fillText('⚡ RICOCHET!', f.x, f.y - 20 - 20 * p);
                ctx.restore();
            }
            if (f.k === 'crit') {
                ctx.save();
                ctx.fillStyle = `rgba(255,80,30,${0.65 * (1 - p)})`;
                ctx.beginPath(); ctx.arc(f.x, f.y, 20 + 36 * p, 0, 7); ctx.fill();
                ctx.fillStyle = `rgba(30,30,30,${0.75 * (1 - p)})`;
                ctx.beginPath(); ctx.arc(f.x + Math.sin(p * 8) * 10, f.y - 14 * p, 14 + 18 * p, 0, 7); ctx.fill();
                ctx.font = '900 18px system-ui'; ctx.fillStyle = `rgba(255,60,60,${1 - p})`; ctx.textAlign = 'center';
                ctx.fillText('💥 CRITICAL! -' + (f.dmg || ''), f.x, f.y - 32 - 28 * p);
                ctx.restore();
            }
            if (f.k === 'hit') {
                ctx.fillStyle = `rgba(255,120,60,${0.8 * (1 - p)})`; ctx.beginPath(); ctx.arc(f.x, f.y, 14 + 26 * p, 0, 7); ctx.fill();
                ctx.fillStyle = `rgba(255,255,255,${1 - p})`; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('-' + f.dmg, f.x, f.y - 40 - 30 * p);
            }
            if (f.k === 'blast') {
                ctx.fillStyle = `rgba(255,150,60,${0.45 * (1 - p)})`; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * p), 0, 7); ctx.fill();
                ctx.strokeStyle = `rgba(255,230,160,${1 - p})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * p, 0, 7); ctx.stroke();
            }
            if (f.k === 'pick') {
                ctx.strokeStyle = f.c; ctx.globalAlpha = 1 - p; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, 20 + 40 * p, 0, 7); ctx.stroke();
                ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.fillText(f.icon, f.x, f.y - 20 - 30 * p); ctx.globalAlpha = 1;
            }
            if (f.k === 'boom') {
                for (let r = 0; r < 3; r++) { ctx.fillStyle = `rgba(${255 - r * 40},${150 - r * 50},40,${(1 - p) * 0.7})`; ctx.beginPath(); ctx.arc(f.x + (r - 1) * 12 * p, f.y - r * 8 * p, (20 + 60 * p) * (1 - r * 0.2), 0, 7); ctx.fill(); }
            }
        }
        if (Dn) Dn.drones.forEach((d, i) => { if (d && (i === myIdx || (me.alive && Math.hypot(d.x - me.x, d.y - me.y) < stOf(me).sight + 120))) drawDrone(d, i === myIdx, now); });
        if (Dn && Dn.attackDrones) Dn.attackDrones.forEach((d, i) => { if (!d || (i !== myIdx && (!me.alive || Math.hypot(d.x - me.x, d.y - me.y) > stOf(me).sight + 80))) return;
            ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(d.x + 4, d.y + 9, 16, 8, 0, 0, 7); ctx.fill();
            ctx.save(); ctx.translate(d.x, d.y - 30); ctx.fillStyle = i === myIdx ? '#ffb547' : '#ff5969'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(13, 9); ctx.lineTo(0, 5); ctx.lineTo(-13, 9); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('×' + d.ammo, 0, 22); ctx.restore();
        });

        // ---- fog (offscreen, then composited) ----
        if (Dn) {
            const fs = fog.width / cw;
            fctx.setTransform(1, 0, 0, 1, 0, 0);
            fctx.globalCompositeOperation = 'source-over';
            fctx.clearRect(0, 0, fog.width, fog.height);
            fctx.fillStyle = 'rgba(3,8,14,.93)'; fctx.fillRect(0, 0, fog.width, fog.height);
            fctx.setTransform(fs * scale, 0, 0, fs * scale, -ox * fs * scale, -oy * fs * scale);
            fctx.globalCompositeOperation = 'destination-out';
            fctx.fillStyle = 'rgba(0,0,0,.5)';
            const x0 = Math.max(0, Math.floor(ox / CELL)), y0 = Math.max(0, Math.floor(oy / CELL));
            const x1 = Math.min(EC, Math.ceil((ox + vw) / CELL)), y1 = Math.min(ER, Math.ceil((oy + vh) / CELL));
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (explored[y * EC + x]) fctx.fillRect(x * CELL - 1, y * CELL - 1, CELL + 2, CELL + 2);
            const hole = (x, y, r) => {
                const g = fctx.createRadialGradient(x, y, r * 0.7, x, y, r);
                g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
                fctx.fillStyle = g; fctx.beginPath(); fctx.arc(x, y, r, 0, 7); fctx.fill();
            };
            if (me.alive) hole(me.x, me.y, stOf(me).sight);
            if (myDrone && myDrone.hover) hole(myDrone.x, myDrone.y, DRONE_R);
            fctx.globalCompositeOperation = 'source-over';
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fog, 0, 0, canvas.width, canvas.height); ctx.restore();

            // intel drawn above the fog: satellite ping + enemy drone warning
            const meT = Dn.tanks[myIdx], foe = tanks[1 - myIdx];
            if (T >= meT.satFrom && T < meT.satTo && foe.alive) {
                const p = (now / 600) % 1;
                ctx.strokeStyle = `rgba(255,83,106,${1 - p})`; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(foe.x, foe.y, 20 + 60 * p, 0, 7); ctx.stroke();
                ctx.strokeStyle = '#ff536a'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(foe.x - 16, foe.y); ctx.lineTo(foe.x + 16, foe.y); ctx.moveTo(foe.x, foe.y - 16); ctx.lineTo(foe.x, foe.y + 16); ctx.stroke();
            }
        }

        // ---- HUD (screen space, CSS px) ----
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (Dn) drawHud(Dn, tanks, cw, ch, T, now, enemyVisible);
    }

    function offscreenArrow(x, y, cw, ch, color, label) {
        const sx = (x - view.ox) * view.s, sy = (y - view.oy) * view.s;
        if (sx > 0 && sx < cw && sy > 0 && sy < ch) return;
        const cx = cw / 2, cy = ch / 2, a = Math.atan2(sy - cy, sx - cx);
        const m = 26, k = Math.min((cw / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (ch / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
        const px = cx + Math.cos(a) * k, py = cy + Math.sin(a) * k;
        ctx.save(); ctx.translate(px, py); ctx.rotate(a);
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.fill();
        ctx.restore();
        if (label) { ctx.fillStyle = color; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(label, px - Math.cos(a) * 22, py - Math.sin(a) * 22 + 4); }
    }

    function drawHud(Dn, tanks, cw, ch, T, now, enemyVisible) {
        const meT = Dn.tanks[myIdx], me = tanks[myIdx], foe = tanks[1 - myIdx];
        $('score').textContent = `${Dn.sc[myIdx]} : ${Dn.sc[1 - myIdx]}`;
        const small = cw < 520;

        // Tactical Elimination & Outpost Status Panel (Top Center)
        const myScore = Dn.sc[myIdx] || 0, foeScore = Dn.sc[1 - myIdx] || 0;
        const panelW = small ? 200 : 310, panelH = small ? 32 : 38;
        const px = (cw - panelW) / 2, py = small ? 8 : 12;

        ctx.save();
        ctx.fillStyle = 'rgba(6, 15, 24, 0.88)';
        ctx.strokeStyle = 'rgba(56, 105, 142, 0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(px, py, panelW, panelH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.font = `bold ${small ? 14 : 17}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS[myIdx].turret;
        ctx.fillText(`${myScore} / ${WIN}`, px + panelW / 2 - 16, py + (small ? 16 : 19));

        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(210, 235, 255, 0.8)';
        ctx.font = `bold ${small ? 11 : 12}px system-ui`;
        ctx.fillText('VS', px + panelW / 2, py + (small ? 15 : 18));

        ctx.textAlign = 'left';
        ctx.fillStyle = COLORS[1 - myIdx].turret;
        ctx.font = `bold ${small ? 14 : 17}px system-ui, -apple-system, sans-serif`;
        ctx.fillText(`${foeScore} / ${WIN}`, px + panelW / 2 + 16, py + (small ? 16 : 19));

        if (Dn.outposts && Dn.outposts.length > 0) {
            const numOp = Dn.outposts.length;
            const opSpacing = small ? 24 : 32;
            const startX = px + panelW / 2 - ((numOp - 1) * opSpacing) / 2;
            const dotY = py + (small ? 25 : 29);
            const opLabels = ['A', 'B', 'C', 'D', 'E'];

            for (let oi = 0; oi < numOp; oi++) {
                const op = Dn.outposts[oi];
                const dx = startX + oi * opSpacing;
                const owned = op.owner;
                const col = owned === myIdx ? COLORS[myIdx].turret : owned >= 0 ? COLORS[1 - myIdx].turret : '#7a8c96';

                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(dx, dotY, small ? 3.5 : 4.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.font = 'bold 8px system-ui';
                ctx.fillStyle = owned >= 0 ? '#ffffff' : 'rgba(180, 200, 215, 0.6)';
                ctx.textAlign = 'center';
                ctx.fillText(opLabels[oi] || `${oi + 1}`, dx, dotY + 2.5);
            }
        }

        if (!small) {
            ctx.font = '9px system-ui';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(180, 215, 235, 0.7)';
            ctx.fillText(L('dom_bar_sub'), cw / 2, py + panelH + 13);
        }
        ctx.restore();

        // minimap
        const mw = small ? 120 : 180, mh = mw * H / W, mx = cw - mw - 10, my = 10, k = mw / W;
        ctx.fillStyle = 'rgba(2,8,12,.82)'; ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
        ctx.fillStyle = 'rgba(70,95,70,.9)';
        for (let y = 0; y < ER; y++) for (let x = 0; x < EC; x++) if (explored[y * EC + x]) ctx.fillRect(mx + x * CELL * k, my + y * CELL * k, CELL * k + 0.6, CELL * k + 0.6);
        const known = (x, y) => explored[Math.floor(y / CELL) * EC + Math.floor(x / CELL)];
        for (const f of map.forests) if (known(f.x, f.y)) { ctx.fillStyle = '#2f7a43'; ctx.beginPath(); ctx.arc(mx + f.x * k, my + f.y * k, f.r * k, 0, 7); ctx.fill(); }
        for (const o of map.ruins) if (known(o.x + o.w / 2, o.y + o.h / 2)) { ctx.fillStyle = '#9a9c8c'; ctx.fillRect(mx + o.x * k, my + o.y * k, o.w * k, o.h * k); }
        for (const o of map.water) if (known(o.x, o.y)) { ctx.fillStyle = '#3d8fb0'; ctx.beginPath(); ctx.arc(mx + o.x * k, my + o.y * k, o.r * k, 0, 7); ctx.fill(); }
        if (Dn && Dn.outposts) {
            for (const op of Dn.outposts) {
                ctx.fillStyle = op.owner === myIdx ? '#3cbde8' : op.owner >= 0 ? '#e8a33c' : '#ffffff';
                ctx.beginPath(); ctx.arc(mx + op.x * k, my + op.y * k, 4.5, 0, 7); ctx.fill();
            }
        }
        ctx.strokeStyle = 'rgba(140,240,255,.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(mx + view.ox * k, my + view.oy * k, view.w * k, view.h * k);
        const myD = Dn.drones[myIdx];
        if (myD) { ctx.strokeStyle = '#6ef0ff'; ctx.beginPath(); ctx.arc(mx + myD.x * k, my + myD.y * k, myD.hover ? DRONE_R * k : 3, 0, 7); ctx.stroke(); }
        if (me.alive) { ctx.fillStyle = COLORS[myIdx].turret; ctx.beginPath(); ctx.arc(mx + me.x * k, my + me.y * k, 3.5, 0, 7); ctx.fill(); }
        const satLive = T >= meT.satFrom && T < meT.satTo;
        if ((enemyVisible || satLive) && foe.alive) {
            ctx.fillStyle = '#ff536a'; ctx.beginPath(); ctx.arc(mx + foe.x * k, my + foe.y * k, 3.5 + (satLive ? 2 * Math.sin(now / 90) : 0), 0, 7); ctx.fill();
        }
        for (const it of Dn.items || []) {                 // crates are announced to everyone
            ctx.fillStyle = ITEMS[it.k].color; ctx.globalAlpha = T < it.land ? 0.5 + 0.5 * Math.sin(now / 80) : 0.9;
            ctx.fillRect(mx + it.x * k - 3, my + it.y * k - 3, 6, 6); ctx.globalAlpha = 1;
        }
        for (const m of Dn.mines || []) if (mineVisible({ ...Dn, tanks }, myIdx, m)) { ctx.fillStyle = m.o === myIdx ? '#8fd3ff' : '#ff536a'; ctx.fillRect(mx + m.x * k - 1.5, my + m.y * k - 1.5, 3, 3); }
        ctx.strokeStyle = '#2d6170'; ctx.strokeRect(mx - 2, my - 2, mw + 4, mh + 4);

        if (satLive && foe.alive) offscreenArrow(foe.x, foe.y, cw, ch, '#ff536a', '🛰️');
        if (myD) offscreenArrow(myD.x, myD.y, cw, ch, '#6ef0ff', '');

        // status lines (top-left)
        ctx.textAlign = 'left'; ctx.font = `bold ${small ? 12 : 14}px system-ui`;
        let ly = 22;
        const line = (t, c) => { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillText(t, 13, ly + 1); ctx.fillStyle = c; ctx.fillText(t, 12, ly); ly += small ? 17 : 20; };
        if (me.alive) {
            const mh2 = meT.maxHp || 100;
            line(`${CLASSES[meT.cls]?.icon || ''} ${meT.hp}/${mh2} HP${meT.shield > 0 && T < meT.shieldTo ? ' 🛡️' + meT.shield : ''}`, meT.hp > mh2 / 2 ? '#7dff9a' : meT.hp > mh2 / 4 ? '#ffd36a' : '#ff7070');
            const camoOn = stOf(meT).camo && T - meT.still > CAMO_T;
            if (inForest(me.x, me.y) || camoOn) line(T < meT.reveal ? '⚠ ' + L('spotted') : (camoOn && !inForest(me.x, me.y) ? '🍃 ' : '🌲 ') + L('hidden'), T < meT.reveal ? '#ffb070' : '#8dffb0');
            const buffs = [];
            if (T < meT.rapidTo) buffs.push('⚡' + Math.ceil((meT.rapidTo - T) / 1000));
            if (T < meT.speedTo) buffs.push('🚀' + Math.ceil((meT.speedTo - T) / 1000));
            if (buffs.length) line(buffs.join('  '), '#ffe066');
            if (prefs.autoFire) line('🎯 AUTO', '#ffe066');
        } else line(L('respawn', { s: Math.max(0, Math.ceil((meT.respawnAt - T) / 1000)) }), '#ff9a9a');
        if (myD && myD.hover) line('🛸 ' + L('drone_on'), '#6ef0ff');
        if (satLive) line('🛰️ ' + L('sat_on'), '#ff9db0');
        if (T < (meT.empUntil || 0)) {
            line('⚡ ' + L('emp_active'), '#ff7070');
            // Center screen EMP tactical warning
            const empSec = ((meT.empUntil - T) / 1000).toFixed(1);
            const empRatio = clamp((meT.empUntil - T) / EMP_TIME, 0, 1);
            const cx = cw / 2, cy = ch * 0.38;
            ctx.save();
            ctx.fillStyle = 'rgba(25, 6, 10, 0.9)';
            ctx.strokeStyle = '#ff4d4d';
            ctx.lineWidth = 2;
            ctx.fillRect(cx - 140, cy - 22, 280, 48);
            ctx.strokeRect(cx - 140, cy - 22, 280, 48);
            ctx.fillStyle = '#ff4d4d';
            ctx.fillRect(cx - 136, cy + 18, 272 * empRatio, 4);
            ctx.font = 'bold 15px system-ui';
            ctx.fillStyle = '#ff7070';
            ctx.textAlign = 'center';
            ctx.fillText(`⚡ ⚠ ${L('emp_offline')}: ${empSec}s`, cx, cy - 2);
            ctx.font = '11px system-ui';
            ctx.fillStyle = '#ffb3b3';
            ctx.fillText('武器火控压制中 · 避开敌方火力', cx, cy + 13);
            ctx.restore();
        }
        const ed = Dn.drones[1 - myIdx];
        if (ed && ed.hover && me.alive && Math.hypot(ed.x - me.x, ed.y - me.y) < DRONE_R) line('⚠ ' + L('enemy_drone'), '#ff7a7a');

        // gadget cooldowns (desktop: bottom-left chips; touch: button fill)
        const cdD = clamp((meT.droneAt - T) / DRONE_CD, 0, 1), cdA = clamp((meT.attackAt - T) / 18000, 0, 1), cdS = clamp((meT.satAt - T) / SAT_CD, 0, 1), cdZ = clamp(((meT.empAt || 0) - T) / EMP_CD, 0, 1), cdX = clamp(((meT.smokeAt || 0) - T) / SMOKE_CD, 0, 1);
        const fireCd = clamp((meT.cd || 0) / stOf(meT).cd, 0, 1);
        if (isTouch) {
            for (const [id, p] of [['drone-btn', cdD], ['attack-drone-btn', cdA], ['sat-btn', cdS], ['emp-btn', cdZ], ['smoke-btn', cdX], ['fire-btn', fireCd]]) {
                const b = $(id); b.querySelector('.cd').style.height = (p * 100) + '%'; b.classList.toggle('ready', p === 0 && id !== 'fire-btn');
            }
            $('mine-n').textContent = meT.mines;
            $('mine-btn').classList.toggle('empty', !meT.mines);
        } else {
            const chip = (x, icon, key, p) => {
                ctx.fillStyle = 'rgba(2,10,16,.8)'; ctx.fillRect(x, ch - 52, 114, 40);
                ctx.fillStyle = p ? 'rgba(80,110,120,.6)' : 'rgba(60,200,230,.35)'; ctx.fillRect(x, ch - 52, 114 * (1 - p), 40);
                ctx.strokeStyle = p ? '#355' : '#5ef0ff'; ctx.strokeRect(x, ch - 52, 114, 40);
                ctx.fillStyle = '#e8fcff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'left';
                ctx.fillText(`${icon} [${key}] ${p ? Math.ceil(p * (key === 'Q' ? DRONE_CD : key === 'E' ? SAT_CD : key === 'Z' ? EMP_CD : SMOKE_CD) / 1000) + 's' : 'OK'}`, x + 6, ch - 27);
            };
            chip(12, '🛸', 'Q', cdD);
            chip(132, '🛰️', 'E', cdS);
            chip(252, '⚡', 'Z', cdZ);
            chip(372, '💨', 'X', cdX);
            ctx.fillStyle = 'rgba(2,10,16,.8)'; ctx.fillRect(492, ch - 52, 85, 40);
            ctx.strokeStyle = meT.mines ? '#ff7a7a' : '#355'; ctx.strokeRect(492, ch - 52, 85, 40);
            ctx.fillStyle = meT.mines ? '#ffe0e0' : '#789'; ctx.fillText(`💣 [F] ×${meT.mines}`, 498, ch - 27);
            ctx.fillStyle = 'rgba(255,170,80,.7)'; ctx.fillRect(12, ch - 58, 565 * (1 - fireCd), 3);
        }
        // banners
        ctx.textAlign = 'center';
        let by = ch * 0.3;
        for (let k2 = banners.length - 1; k2 >= 0; k2--) {
            const b = banners[k2];
            if (now > b.until) { banners.splice(k2, 1); continue; }
            const a = Math.min(1, (b.until - now) / 300), pop = Math.min(1, (now - b.born) / 120);
            ctx.globalAlpha = a;
            ctx.font = `900 ${Math.round((small ? 20 : 28) * (0.7 + 0.3 * pop))}px system-ui`;
            ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(b.text, cw / 2 + 2, by + 2);
            ctx.fillStyle = b.color; ctx.fillText(b.text, cw / 2, by);
            ctx.globalAlpha = 1;
            by += small ? 28 : 36;
        }
    }

    function frame(now) {
        const dt = Math.min(100, now - lastFrame);
        lastFrame = now;
        if (myRole === 'host' && S) {
            inputs[0] = overrides[0] || localInput();
            acc += dt;
            while (acc >= STEP) { stepSim(STEP); acc -= STEP; }
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
        visible: team => (S ? visibleTo(S, team, S.tanks[1 - team]) : false),
        place(i, x, y) { const t = S.tanks[i]; t.x = x; t.y = y; if (i === myIdx) disp[i] = null; },
        freezeBot(on) { bot.frozen = !!on; },
        loadout(i, lo) {                               // swap a tank's loadout mid-match (tests)
            loadouts[i] = validLo(lo);
            if (i === myIdx) myLoadout = loadouts[i];
            const t = S.tanks[i], keep = { x: t.x, y: t.y, a: t.a, ta: t.ta, qs: t.qs, es: t.es, ms: t.ms };
            Object.assign(t, newTank(i, 0, loadouts[i]), keep);
        },
        items(on) { S.itemsOn = !!on; if (!on) S.items.length = 0; },
        spawnItem(k, x, y) { S.items.push({ id: ++S.itemN, k, x, y, land: S.T }); },
        mineVisible: (team, j) => mineVisible(S, team, S.mines[j]),
        stats: i => stOf(S.tanks[i]),
        los: (a, b) => losClear(a, b),
        clearPair(x, y, d) {                           // two open spots `d` apart (east-west) with a clear line (tests)
            for (let k = 0; k < 400; k++) {
                const a = this.free(x + (k % 20) * 60 - 600, y + Math.floor(k / 20) * 60 - 600);
                if (!a) continue;
                const b = { x: a.x + d, y: a.y };
                if (!blockedTank(b.x, b.y) && !inForest(b.x, b.y) && losClear(a, b)) return [a, b];
            }
            return null;
        },
        touchDrag(ang) { dragAim = ang; },
        touchRelease() { if (dragAim !== null) release = { ang: dragAim, until: performance.now() + 650 + (S ? S.tanks[myIdx].cd : 0) }; dragAim = null; },
        prefs,
        setInput(i, v) { overrides[i] = v; },
        explored: () => explored.reduce((a, b) => a + b, 0),
        free(x0, y0) {                                 // nearest open, forest-free spot (for tests)
            for (let r = 0; r < 600; r += 20) for (let a = 0; a < 6.28; a += 0.4) {
                const x = x0 + Math.cos(a) * r, y = y0 + Math.sin(a) * r;
                if (!blockedTank(x, y) && !inForest(x, y)) return { x, y };
            }
            return null;
        }
    });
})();
