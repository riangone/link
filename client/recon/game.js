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
    const { L } = window.ReconI18n;

    // ---------------------------------------------------------------- tuning
    const W = 2400, H = 1800, CELL = 60, EC = W / CELL, ER = H / CELL;
    const TANK_R = 20, SPEED = 0.19, FOREST_SLOW = 0.75;
    const SHOT_SPEED = 0.72, SHOT_LIFE = 1050, FIRE_CD = 650, DMG = 25, AMBUSH_MUL = 1.6;
    const SIGHT = 380, FOREST_SPOT = 125, FIRE_REVEAL = 1500;
    const DRONE_CD = 14000, DRONE_TIME = 7500, DRONE_R = 290, DRONE_RANGE = 560, DRONE_SPEED = 0.55;
    const SAT_CD = 22000, SAT_DELAY = 1100, SAT_TIME = 2800;
    const WIN = 3, RESPAWN = 2400, STEP = 1000 / 60, NET_MS = 50;
    const SPAWNS = [
        [{ x: 150, y: 900 }, { x: 190, y: 260 }, { x: 190, y: 1540 }],
        [{ x: 2250, y: 900 }, { x: 2210, y: 1540 }, { x: 2210, y: 260 }]
    ];
    const COLORS = [{ body: '#e8a33c', dark: '#8a5a17', turret: '#ffc867' }, { body: '#3cbde8', dark: '#165f7a', turret: '#8fe6ff' }];

    // ---------------------------------------------------------------- loadout: class + weapon mod + gear mod
    /** Tank classes. sight = vision radius, shot/life = shell speed (px/ms) and lifetime (range = shot*life). */
    const CLASSES = {
        mbt:    { icon: '🛡️', hp: 100, speed: 0.19,  sight: 380, dmg: 25, cd: 650,  shot: 0.72, life: 1050, turn: 0.009, droneCd: 14000, size: 1 },
        scout:  { icon: '🦅', hp: 80,  speed: 0.235, sight: 450, dmg: 19, cd: 480,  shot: 0.78, life: 900,  turn: 0.012, droneCd: 9000,  size: 0.88 },
        heavy:  { icon: '🐘', hp: 150, speed: 0.15,  sight: 340, dmg: 34, cd: 920,  shot: 0.64, life: 1050, turn: 0.0065, droneCd: 16000, size: 1.16 },
        sniper: { icon: '🎯', hp: 80,  speed: 0.17,  sight: 400, dmg: 46, cd: 1400, shot: 1.05, life: 1150, turn: 0.006, droneCd: 14000, size: 0.97 }
    };
    /** Weapon mods: multipliers on the class gun. splash = blast radius on impact. */
    const WEAPONS = {
        std:   { icon: '⚪', dmg: 1, cd: 1, shot: 1 },
        ap:    { icon: '🔩', dmg: 1.3, cd: 1.25, shot: 1.1 },
        rapid: { icon: '⚡', dmg: 0.7, cd: 0.62, shot: 1 },
        he:    { icon: '💥', dmg: 0.85, cd: 1.1, shot: 0.85, splash: 75 }
    };
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
    $('lang').value = window.ReconI18n.lang;
    $('lang').onchange = e => { window.ReconI18n.setLang(e.target.value); refreshTexts(); };
    window.ReconI18n.apply();

    // ---------------------------------------------------------------- map
    function rng(seed) {
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    /** Point-symmetric map (x,y)→(W-x,H-y) so both sides are equally fair. */
    function genMap(seed) {
        const r = rng(seed), M = { seed, ruins: [], rocks: [], forests: [], water: [] };
        const spawnClear = (x, y, m) => SPAWNS.flat().every(s => Math.hypot(s.x - x, s.y - y) > m);
        const solids = () => [...M.ruins.map(o => ({ x: o.x + o.w / 2, y: o.y + o.h / 2, r: Math.hypot(o.w, o.h) / 2 })), ...M.rocks, ...M.water];
        const farFromSolids = (x, y, rad) => solids().every(o => Math.hypot(o.x - x, o.y - y) > o.r + rad + 64);
        const mirrorC = o => ({ ...o, x: W - o.x, y: H - o.y });
        const mirrorR = o => ({ ...o, x: W - o.x - o.w, y: H - o.y - o.h });
        const half = () => ({ x: 260 + r() * 900, y: 90 + r() * 1620 });

        M.forests.push({ x: W / 2, y: H / 2, r: 135 });
        for (let i = 0, n = 0; n < 10 && i < 300; i++) {
            const p = half(), rad = 75 + r() * 70;
            if (!spawnClear(p.x, p.y, rad + 60) || M.forests.some(f => Math.hypot(f.x - p.x, f.y - p.y) < f.r + rad - 20)) continue;
            const f = { x: p.x, y: p.y, r: rad };
            M.forests.push(f, mirrorC(f)); n++;
        }
        for (let i = 0, n = 0; n < 9 && i < 400; i++) {
            const p = half(), w = 60 + r() * 130, h = 50 + r() * 120, cx = p.x + w / 2, cy = p.y + h / 2;
            if (!spawnClear(cx, cy, 230) || !farFromSolids(cx, cy, Math.hypot(w, h) / 2) || p.y + h > H - 40) continue;
            const o = { x: p.x, y: p.y, w, h };
            M.ruins.push(o, mirrorR(o)); n++;
        }
        for (let i = 0, n = 0; n < 6 && i < 300; i++) {
            const p = half(), rad = 24 + r() * 22;
            if (!spawnClear(p.x, p.y, 180) || !farFromSolids(p.x, p.y, rad)) continue;
            const o = { x: p.x, y: p.y, r: rad };
            M.rocks.push(o, mirrorC(o)); n++;
        }
        for (let i = 0, n = 0; n < 2 && i < 200; i++) {
            const p = half(), rad = 70 + r() * 40;
            if (!spawnClear(p.x, p.y, 260) || !farFromSolids(p.x, p.y, rad)) continue;
            const o = { x: p.x, y: p.y, r: rad };
            M.water.push(o, mirrorC(o)); n++;
        }
        // decorative ground patches (precomputed so the cache is deterministic)
        M.patches = [];
        for (let i = 0; i < 160; i++) M.patches.push({ x: r() * W, y: r() * H, r: 30 + r() * 90, l: r() });
        return M;
    }

    let map = genMap(1), groundCache = null;
    function useMap(seed) {
        if (map.seed === seed && groundCache) return;
        map = genMap(seed);
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
    let myLoadout = validLo((() => { try { return JSON.parse(localStorage.getItem('recon-loadout')); } catch (e) { return null; } })());
    function newTank(i, spawn, lo) {
        const p = SPAWNS[i][spawn % 3], st = statsOf(lo);
        return { x: p.x, y: p.y, a: i ? Math.PI : 0, ta: i ? Math.PI : 0, hp: st.hp, maxHp: st.hp, cd: 0, alive: true, respawnAt: 0,
            cls: lo.cls, w: lo.w, g: lo.g,
            reveal: 0, still: 0, droneAt: 4000, satAt: 9000, satFrom: 0, satTo: 0, qs: null, es: null, ms: null,
            mines: st.mines, shield: 0, shieldTo: 0, rapidTo: 0, speedTo: 0 };
    }
    let itemsOn = localStorage.getItem('recon-items') !== '0';
    function startMatch() {
        const seed = 1 + Math.floor(Math.random() * 1e9);
        useMap(seed);
        loadouts[0] = validLo(myLoadout);
        if (GameBot.enabled) loadouts[1] = bot.pickLoadout();
        S = { seed, T: 0, ph: 'play', sc: [0, 0], tanks: [newTank(0, 0, loadouts[0]), newTank(1, 0, loadouts[1])], shots: [], drones: [null, null],
            mines: [], items: [], itemsOn, itemAt: 2500, itemN: 0, ev: [], evId: 0, spawnN: [0, 0] };
        bot.reset();
        lastEvId = 0;
        event({ k: 'start' });
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
            if (S.sc[by] >= WIN) { S.ph = 'over'; S.win = by; event({ k: 'over', w: by }); }
        }
    }
    function event(e) {
        e.id = ++S.evId; e.t = S.T;
        S.ev.push(e);
        if (S.ev.length > 24) S.ev.shift();
    }

    /** Can `team`'s side see enemy tank `t`? (vision rules in the header) */
    function visibleTo(D, team, t) {
        if (!t.alive) return false;
        const me = D.tanks[team], dr = D.drones[team];
        if (dr && dr.hover && Math.hypot(dr.x - t.x, dr.y - t.y) < DRONE_R) return true;
        if (!me.alive) return false;
        const d = dist(me, t), ts = stOf(t);
        if (d > stOf(me).sight || !losClear(me, t)) return false;
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
        if (t[key] === null) { t[key] = v; return false; }
        if (v > t[key]) { t[key] = v; return true; }
        return false;
    }
    function fireShot(t, i, T) {
        const st = stOf(t);
        const amb = !visibleTo(S, 1 - i, t);
        S.shots.push({ x: t.x + Math.cos(t.ta) * 30, y: t.y + Math.sin(t.ta) * 30, vx: Math.cos(t.ta) * st.shot, vy: Math.sin(t.ta) * st.shot,
            o: i, life: st.life, amb, dmg: st.dmg, sp: st.splash });
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
                    Object.assign(t, newTank(i, ++S.spawnN[i], t), { droneAt: t.droneAt, satAt: t.satAt, qs: t.qs, es: t.es, ms: t.ms, still: T });
                    event({ k: 'spawn', i });
                }
                continue;
            }
            if (S.ph !== 'play') continue;
            // move
            let mx = +v.mx || 0, my = +v.my || 0;
            const m = Math.hypot(mx, my);
            if (m > 1) { mx /= m; my /= m; }
            if (m > 0.12) {
                const sp = st.speed * dt * (inForest(t.x, t.y) ? FOREST_SLOW : 1) * (T < t.speedTo ? 1.35 : 1);
                t.a = Math.atan2(my, mx);
                const nx = t.x + mx * sp, ny = t.y + my * sp;
                if (!blockedTank(nx, t.y)) t.x = nx;
                if (!blockedTank(t.x, ny)) t.y = ny;
                t.still = T;
            }
            // aim: explicit (mouse/drag/bot) > auto-track a visible enemy (unless the player turned it off) > follow hull
            const sees = visibleTo(S, i, foe), toFoe = Math.atan2(foe.y - t.y, foe.x - t.x);
            let want = t.a;
            const explicit = typeof v.ax === 'number' && isFinite(v.ax);
            if (explicit) want = v.ax;
            else if (v.aa !== false && sees) want = toFoe;
            const da = angDiff(want, t.ta), turn = st.turn * dt;
            t.ta += clamp(da, -turn, turn);
            // fire: held trigger; `fw` = wait until the turret is on target (touch drag-release);
            // `af` = auto-fire when the gun is lined up on a visible enemy within range
            t.cd = Math.max(0, t.cd - dt);
            if (t.cd <= 0) {
                const aligned = Math.abs(angDiff(want, t.ta)) < 0.08;
                let shoot = !!v.f && (!v.fw || aligned);
                if (!shoot && v.af && sees && dist(t, foe) < st.shot * st.life * 0.95 && Math.abs(angDiff(toFoe, t.ta)) < 0.09 && losClear(t, foe)) shoot = true;
                if (shoot) fireShot(t, i, T);
            }
            // drone / satellite / mine (edge-triggered by a sequence number so lost packets can't double-fire)
            if (pressed(t, 'qs', v.q) && T >= t.droneAt) {
                const tx = clamp(t.x + Math.cos(t.ta) * DRONE_RANGE, 40, W - 40), ty = clamp(t.y + Math.sin(t.ta) * DRONE_RANGE, 40, H - 40);
                S.drones[i] = { x: t.x, y: t.y, tx, ty, hover: false, until: 0 };
                t.droneAt = T + st.droneCd;
                event({ k: 'drone', i });
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
            // crates
            for (let j = S.items.length - 1; j >= 0; j--) {
                const it = S.items[j];
                if (T >= it.land && Math.hypot(it.x - t.x, it.y - t.y) < ITEM_R) { S.items.splice(j, 1); pickUp(t, i, it); }
            }
            if (t.shield > 0 && T >= t.shieldTo) t.shield = 0;
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
            if (hit) damage(t, 1 - b.o, b.dmg * mul, b.o, 'shell', b.amb, t.x, t.y);
            else if (b.life > 0 || b.sp) event({ k: 'spark', x: Math.round(b.x), y: Math.round(b.y), sp: b.sp || 0 });
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
            type: 'state', seed: S.seed, T: Math.round(S.T), ph: S.ph, sc: S.sc, win: S.win,
            tanks: S.tanks.map(t => ({ x: r(t.x), y: r(t.y), a: r(t.a * 100) / 100, ta: r(t.ta * 100) / 100, hp: t.hp, alive: t.alive, respawnAt: t.respawnAt,
                reveal: t.reveal, still: t.still, droneAt: t.droneAt, satAt: t.satAt, satFrom: t.satFrom, satTo: t.satTo,
                cls: t.cls, w: t.w, g: t.g, maxHp: t.maxHp, mines: t.mines, shield: t.shield, shieldTo: t.shieldTo, rapidTo: t.rapidTo, speedTo: t.speedTo, cd: Math.round(t.cd) })),
            shots: S.shots.map(b => ({ x: r(b.x), y: r(b.y), vx: b.vx, vy: b.vy, o: b.o })),
            drones: S.drones.map(d => d && { x: r(d.x), y: r(d.y), hover: d.hover, until: d.until }),
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
    let mouseAim = null, mouseDown = false, touchFire = false, stickVec = { x: 0, y: 0 }, qSeq = 0, eSeq = 0, mSeq = 0;
    /** Player prefs: touch aim mode ('auto' tracks visible enemies, 'manual' = only where you drag) and auto-fire. */
    const prefs = { aim: localStorage.getItem('recon-aim') === 'manual' ? 'manual' : 'auto', autoFire: localStorage.getItem('recon-autofire') === '1' };
    function setAutoFire(on, announce) {
        prefs.autoFire = on; localStorage.setItem('recon-autofire', on ? '1' : '0');
        if (announce) banner((on ? '🎯 ' : '✋ ') + L(on ? 'af_on' : 'af_off'), '#ffe066', 1200);
        renderOptions();
    }
    addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (!keys[e.code]) {
            if (e.code === 'KeyQ') qSeq++;
            if (e.code === 'KeyE') eSeq++;
            if (e.code === 'KeyF') mSeq++;
            if (e.code === 'KeyV') setAutoFire(!prefs.autoFire, true);
        }
        keys[e.code] = true;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { keys[e.code] = false; });
    addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; touchFire = false; dragAim = null; });
    canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { const r = canvas.getBoundingClientRect(); mouseAim = { x: e.clientX - r.left, y: e.clientY - r.top }; } });
    canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { mouseDown = true; Sfx.init(); } });
    addEventListener('pointerup', e => { if (e.pointerType === 'mouse') mouseDown = false; });
    canvas.addEventListener('mouseleave', () => { mouseDown = false; });

    // virtual stick
    const stick = $('stick'), knob = $('knob');
    let stickId = null;
    function stickMove(e) {
        const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
        let dx = e.clientX - cx, dy = e.clientY - cy;
        const l = Math.hypot(dx, dy);
        if (l > R) { dx = dx / l * R; dy = dy / l * R; }
        stickVec = { x: dx / R, y: dy / R };
        knob.style.transform = `translate(${dx}px,${dy}px)`;
    }
    stick.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.init(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); });
    stick.addEventListener('pointermove', e => { if (e.pointerId === stickId) stickMove(e); });
    for (const ev of ['pointerup', 'pointercancel']) stick.addEventListener(ev, e => { if (e.pointerId !== stickId) return; stickId = null; stickVec = { x: 0, y: 0 }; knob.style.transform = ''; });
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
    holdBtn($('sat-btn'), () => { eSeq++; });
    holdBtn($('mine-btn'), () => { mSeq++; });

    let view = { ox: 0, oy: 0, s: 1, w: 0, h: 0 };
    function localInput() {
        let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
        let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
        if (!mx && !my) { mx = stickVec.x; my = stickVec.y; }
        let ax = null, f = !!(keys.Space || mouseDown || touchFire), fw = false;
        const me = D()?.tanks[myIdx];
        if (dragAim !== null) ax = dragAim;
        else if (release && performance.now() < release.until) { ax = release.ang; f = true; fw = true; }
        else if (mouseAim && me) ax = Math.atan2(mouseAim.y / view.s + view.oy - me.y, mouseAim.x / view.s + view.ox - me.x);
        if (release && performance.now() >= release.until) release = null;
        return { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, ax: ax === null ? null : Math.round(ax * 100) / 100,
            f, fw, aa: !isTouch || prefs.aim === 'auto', af: prefs.autoFire, q: qSeq, e: eSeq, m: mSeq };
    }

    // ---------------------------------------------------------------- network
    const D = () => (myRole === 'host' ? S : net);
    /** Host-sim time as best known locally (client extrapolates from the last snapshot). */
    const nowT = () => (myRole === 'host' ? (S ? S.T : 0) : net ? net.T + (performance.now() - netAt) : 0);

    const session = GameBot.session({
        gameFolder: 'recon',
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
            inputs[1] = { mx: n(m.mx), my: n(m.my), ax: typeof m.ax === 'number' && isFinite(m.ax) ? m.ax : null, f: !!m.f, fw: !!m.fw, aa: m.aa !== false, af: !!m.af, q: n(m.q), e: n(m.e), m: n(m.m) };
            if (m.lo) loadouts[1] = validLo(m.lo);
        } else if (m.type === 'restart' && myRole === 'host') {
            if (!S || S.ph === 'over') startMatch();
        } else if (m.type === 'state' && myRole === 'client') {
            if (!net || net.seed !== m.seed) lastEvId = 0;
            useMap(m.seed);
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
                localStorage.setItem('recon-loadout', JSON.stringify(myLoadout));
                renderOptions();
            };
            box.appendChild(b);
        }
    }
    function renderOptions() {
        chipRow('cls-chips', CLASSES, 'cls', 'cls_');
        chipRow('w-chips', WEAPONS, 'w', 'w_');
        chipRow('g-chips', GEARS, 'g', 'g_');
        $('cls-desc').textContent = L('d_' + myLoadout.cls);
        $('w-desc').textContent = L('dw_' + myLoadout.w);
        $('g-desc').textContent = L('dg_' + myLoadout.g);
        const st = statsOf(myLoadout);
        $('lo-stats').textContent = `${L('st_hp')} ${st.hp} · ${L('st_spd')} ${Math.round(st.speed * 1000)} · ${L('st_sight')} ${st.sight} · ` +
            `${L('st_dmg')} ${Math.round(st.dmg)}${st.splash ? '💥' : ''} · ${(1000 / st.cd).toFixed(1)}${L('st_rof')} · ${L('st_range')} ${Math.round(st.shot * st.life)} · 💣${st.mines}`;
        const canItems = myRole !== 'client';
        $('items-btn').textContent = canItems ? L(itemsOn ? 'items_on' : 'items_off') : L('items_host');
        $('items-btn').disabled = !canItems;
        $('items-btn').classList.toggle('off', !itemsOn);
        $('aim-btn').textContent = L(prefs.aim === 'auto' ? 'aim_auto' : 'aim_manual');
        $('aim-btn').classList.toggle('hidden', !isTouch);
        $('af-btn').textContent = L(prefs.autoFire ? 'af_on' : 'af_off');
        $('af-btn').classList.toggle('off', !prefs.autoFire);
    }
    $('items-btn').onclick = () => { itemsOn = !itemsOn; localStorage.setItem('recon-items', itemsOn ? '1' : '0'); renderOptions(); };
    $('aim-btn').onclick = () => { prefs.aim = prefs.aim === 'auto' ? 'manual' : 'auto'; localStorage.setItem('recon-aim', prefs.aim); renderOptions(); };
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
                case 'fire': if (mine) release = null; if (mine || canSeePoint(D, e)) { fx.push({ k: 'flash', x: e.x, y: e.y, t: now }); Sfx.fire(); } break;
                case 'spark':
                    if (e.sp) { fx.push({ k: 'blast', x: e.x, y: e.y, t: now, r: e.sp }); Sfx.hit(); }
                    else fx.push({ k: 'spark', x: e.x, y: e.y, t: now });
                    break;
                case 'boom_mine': fx.push({ k: 'blast', x: e.x, y: e.y, t: now, r: MINE_R + 30 }); fx.push({ k: 'boom', x: e.x, y: e.y, t: now }); Sfx.boom(); break;
                case 'mine_set': if (mine) Sfx.click(); break;
                case 'drop': banner(L('drop'), '#ffd36a', 1800); Sfx.ping(); break;
                case 'pick':
                    fx.push({ k: 'pick', x: e.x, y: e.y, t: now, c: ITEMS[e.it].color, icon: ITEMS[e.it].icon });
                    if (mine) { banner(ITEMS[e.it].icon + ' ' + L('it_' + e.it), ITEMS[e.it].color, 1400); Sfx.gadget(); }
                    else if (canSeePoint(D, e)) banner(L('pick_enemy'), '#ff9a9a', 1100);
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
    function buildGround() {
        const g = document.createElement('canvas');
        g.width = W / 2; g.height = H / 2;              // half-res cache: ground is soft anyway
        const c = g.getContext('2d');
        c.scale(0.5, 0.5);
        c.fillStyle = '#2b3b26'; c.fillRect(0, 0, W, H);
        for (const p of map.patches) {
            c.fillStyle = p.l < 0.5 ? 'rgba(70,90,50,.35)' : 'rgba(30,40,24,.35)';
            c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill();
        }
        c.strokeStyle = 'rgba(160,200,150,.08)'; c.lineWidth = 2;
        for (let x = 0; x <= W; x += 120) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
        for (let y = 0; y <= H; y += 120) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
        for (const w of map.water) {
            c.fillStyle = '#1d4f66'; c.beginPath(); c.arc(w.x, w.y, w.r, 0, 7); c.fill();
            c.strokeStyle = '#6fc3d9'; c.lineWidth = 4; c.stroke();
            c.fillStyle = '#2a6e8a'; c.beginPath(); c.arc(w.x - w.r * 0.25, w.y - w.r * 0.2, w.r * 0.45, 0, 7); c.fill();
        }
        for (const f of map.forests) { c.fillStyle = 'rgba(10,30,14,.55)'; c.beginPath(); c.arc(f.x, f.y, f.r + 8, 0, 7); c.fill(); }
        c.strokeStyle = '#6d4c2c'; c.lineWidth = 10;
        c.strokeRect(5, 5, W - 10, H - 10);
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
        ctx.restore();
        ctx.save();
        ctx.rotate(t.ta); ctx.scale(k, k);
        const len = cls === 'sniper' ? 46 : cls === 'heavy' ? 34 : 30, bw = w === 'he' ? 11 : cls === 'heavy' ? 10 : w === 'ap' || cls === 'sniper' ? 6 : 8;
        ctx.fillStyle = '#20282b';
        if (w === 'rapid') { ctx.fillRect(4, -7, len - 4, 5); ctx.fillRect(4, 2, len - 4, 5); }
        else ctx.fillRect(4, -bw / 2, len, bw);
        if (cls === 'sniper') { ctx.fillStyle = '#20282b'; ctx.fillRect(len, -bw / 2 - 2, 6, bw + 4); }
        if (w === 'he') { ctx.fillStyle = '#5a2a14'; ctx.fillRect(len - 2, -bw / 2 - 1, 6, bw + 2); }
        ctx.fillStyle = c.turret;
        ctx.beginPath(); ctx.arc(0, 0, cls === 'heavy' ? 13 : 11, 0, 7); ctx.fill();
        ctx.strokeStyle = c.dark; ctx.lineWidth = 2; ctx.stroke();
        if (cls === 'scout' || t.g === 'radar') { ctx.strokeStyle = '#d9f6ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-16, -14); ctx.stroke(); ctx.fillStyle = '#5ef0ff'; ctx.beginPath(); ctx.arc(-16, -14, 2.5, 0, 7); ctx.fill(); }
        ctx.restore();
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

        if (Dn) for (const m of Dn.mines || []) if (inView(m.x, m.y, 40) && mineVisible(shown, myIdx, m)) drawMine(m, m.o === myIdx, T);
        // aim guide: dashed line along the gun to its range (brighter while dragging the touch fire button)
        if (Dn && me.alive) {
            const st = stOf(me), ang = dragAim !== null ? dragAim : release ? release.ang : me.ta, rng2 = st.shot * st.life;
            ctx.strokeStyle = dragAim !== null || release ? 'rgba(255,230,120,.75)' : prefs.autoFire ? 'rgba(255,224,102,.28)' : 'rgba(255,255,255,.16)';
            ctx.lineWidth = dragAim !== null ? 3 : 2; ctx.setLineDash([12, 10]);
            ctx.beginPath(); ctx.moveTo(me.x + Math.cos(ang) * 34, me.y + Math.sin(ang) * 34); ctx.lineTo(me.x + Math.cos(ang) * rng2, me.y + Math.sin(ang) * rng2); ctx.stroke();
            ctx.setLineDash([]);
            if (dragAim !== null) { ctx.fillStyle = 'rgba(255,230,120,.8)'; ctx.beginPath(); ctx.arc(me.x + Math.cos(ang) * rng2, me.y + Math.sin(ang) * rng2, 6, 0, 7); ctx.fill(); }
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
            const life = { flash: 120, spark: 260, hit: 700, boom: 900, blast: 450, pick: 800 }[f.k];
            if (age > life) { fx.splice(k, 1); continue; }
            const p = Math.max(0, age / life);          // rAF time can trail performance.now()
            if (f.k === 'flash') { ctx.fillStyle = `rgba(255,220,120,${1 - p})`; ctx.beginPath(); ctx.arc(f.x, f.y, 34 * (1 - p) + 10, 0, 7); ctx.fill(); }
            if (f.k === 'spark') { ctx.strokeStyle = `rgba(255,210,120,${1 - p})`; ctx.lineWidth = 2; for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(a) * 18 * p + 2, f.y + Math.sin(a) * 18 * p + 2); ctx.stroke(); } }
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
        // minimap
        const mw = small ? 120 : 180, mh = mw * H / W, mx = cw - mw - 10, my = 10, k = mw / W;
        ctx.fillStyle = 'rgba(2,8,12,.82)'; ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
        ctx.fillStyle = 'rgba(70,95,70,.9)';
        for (let y = 0; y < ER; y++) for (let x = 0; x < EC; x++) if (explored[y * EC + x]) ctx.fillRect(mx + x * CELL * k, my + y * CELL * k, CELL * k + 0.6, CELL * k + 0.6);
        const known = (x, y) => explored[Math.floor(y / CELL) * EC + Math.floor(x / CELL)];
        for (const f of map.forests) if (known(f.x, f.y)) { ctx.fillStyle = '#2f7a43'; ctx.beginPath(); ctx.arc(mx + f.x * k, my + f.y * k, f.r * k, 0, 7); ctx.fill(); }
        for (const o of map.ruins) if (known(o.x + o.w / 2, o.y + o.h / 2)) { ctx.fillStyle = '#9a9c8c'; ctx.fillRect(mx + o.x * k, my + o.y * k, o.w * k, o.h * k); }
        for (const o of map.water) if (known(o.x, o.y)) { ctx.fillStyle = '#3d8fb0'; ctx.beginPath(); ctx.arc(mx + o.x * k, my + o.y * k, o.r * k, 0, 7); ctx.fill(); }
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
        const ed = Dn.drones[1 - myIdx];
        if (ed && ed.hover && me.alive && Math.hypot(ed.x - me.x, ed.y - me.y) < DRONE_R) line('⚠ ' + L('enemy_drone'), '#ff7a7a');

        // gadget cooldowns (desktop: bottom-left chips; touch: button fill)
        const cdD = clamp((meT.droneAt - T) / DRONE_CD, 0, 1), cdS = clamp((meT.satAt - T) / SAT_CD, 0, 1);
        const fireCd = clamp((meT.cd || 0) / stOf(meT).cd, 0, 1);
        if (isTouch) {
            for (const [id, p] of [['drone-btn', cdD], ['sat-btn', cdS], ['fire-btn', fireCd]]) {
                const b = $(id); b.querySelector('.cd').style.height = (p * 100) + '%'; b.classList.toggle('ready', p === 0 && id !== 'fire-btn');
            }
            $('mine-n').textContent = meT.mines;
            $('mine-btn').classList.toggle('empty', !meT.mines);
        } else {
            const chip = (x, icon, key, p) => {
                ctx.fillStyle = 'rgba(2,10,16,.8)'; ctx.fillRect(x, ch - 52, 118, 40);
                ctx.fillStyle = p ? 'rgba(80,110,120,.6)' : 'rgba(60,200,230,.35)'; ctx.fillRect(x, ch - 52, 118 * (1 - p), 40);
                ctx.strokeStyle = p ? '#355' : '#5ef0ff'; ctx.strokeRect(x, ch - 52, 118, 40);
                ctx.fillStyle = '#e8fcff'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'left';
                ctx.fillText(`${icon} [${key}] ${p ? Math.ceil(p * (key === 'Q' ? DRONE_CD : SAT_CD) / 1000) + 's' : 'OK'}`, x + 8, ch - 27);
            };
            chip(12, '🛸', 'Q', cdD); chip(138, '🛰️', 'E', cdS);
            ctx.fillStyle = 'rgba(2,10,16,.8)'; ctx.fillRect(264, ch - 52, 90, 40);
            ctx.strokeStyle = meT.mines ? '#ff7a7a' : '#355'; ctx.strokeRect(264, ch - 52, 90, 40);
            ctx.fillStyle = meT.mines ? '#ffe0e0' : '#789'; ctx.fillText(`💣 [F] ×${meT.mines}`, 272, ch - 27);
            ctx.fillStyle = 'rgba(255,170,80,.7)'; ctx.fillRect(12, ch - 58, 342 * (1 - fireCd), 3);
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
