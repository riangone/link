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

    function newTank(i, spawn) {
        const p = SPAWNS[i][spawn % 3];
        return { x: p.x, y: p.y, a: i ? Math.PI : 0, ta: i ? Math.PI : 0, hp: 100, cd: 0, alive: true, respawnAt: 0,
            reveal: 0, droneAt: 4000, satAt: 9000, satFrom: 0, satTo: 0, qs: null, es: null };
    }
    function startMatch() {
        const seed = 1 + Math.floor(Math.random() * 1e9);
        useMap(seed);
        S = { seed, T: 0, ph: 'play', sc: [0, 0], tanks: [newTank(0, 0), newTank(1, 0)], shots: [], drones: [null, null], ev: [], evId: 0, spawnN: [0, 0] };
        bot.reset();
        lastEvId = 0;
        event({ k: 'start' });
        showScreen(null);
        broadcast();
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
        const d = dist(me, t);
        if (d > SIGHT || !losClear(me, t)) return false;
        if (inForest(t.x, t.y) && d > FOREST_SPOT && D.T > t.reveal) return false;
        return true;
    }

    function stepSim(dt) {
        S.T += dt;
        const T = S.T;
        if (overrides[1]) inputs[1] = overrides[1];
        else if (GameBot.enabled) inputs[1] = bot.think(T);
        for (let i = 0; i < 2; i++) {
            const t = S.tanks[i], v = inputs[i] || {}, foe = S.tanks[1 - i];
            if (!t.alive) {
                if (T >= t.respawnAt && S.ph === 'play') {
                    Object.assign(t, newTank(i, ++S.spawnN[i]), { droneAt: t.droneAt, satAt: t.satAt, qs: t.qs, es: t.es });
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
                const sp = SPEED * dt * (inForest(t.x, t.y) ? FOREST_SLOW : 1);
                t.a = Math.atan2(my, mx);
                const nx = t.x + mx * sp, ny = t.y + my * sp;
                if (!blockedTank(nx, t.y)) t.x = nx;
                if (!blockedTank(t.x, ny)) t.y = ny;
            }
            // aim: explicit (mouse/bot) > auto-track a visible enemy > follow hull
            let want = t.a;
            if (typeof v.ax === 'number' && isFinite(v.ax)) want = v.ax;
            else if (visibleTo(S, i, foe)) want = Math.atan2(foe.y - t.y, foe.x - t.x);
            const da = angDiff(want, t.ta), turn = 0.009 * dt;
            t.ta += clamp(da, -turn, turn);
            // fire
            t.cd = Math.max(0, t.cd - dt);
            if (v.f && t.cd <= 0) {
                const amb = !visibleTo(S, 1 - i, t);
                S.shots.push({ x: t.x + Math.cos(t.ta) * 30, y: t.y + Math.sin(t.ta) * 30, vx: Math.cos(t.ta) * SHOT_SPEED, vy: Math.sin(t.ta) * SHOT_SPEED, o: i, life: SHOT_LIFE, amb });
                t.cd = FIRE_CD;
                t.reveal = T + FIRE_REVEAL;
                event({ k: 'fire', i, x: Math.round(t.x), y: Math.round(t.y) });
            }
            // drone (edge-triggered by a sequence number so lost packets can't double-fire)
            if (typeof v.q === 'number') {
                if (t.qs === null) t.qs = v.q;
                else if (v.q > t.qs) {
                    t.qs = v.q;
                    if (T >= t.droneAt) {
                        const tx = clamp(t.x + Math.cos(t.ta) * DRONE_RANGE, 40, W - 40), ty = clamp(t.y + Math.sin(t.ta) * DRONE_RANGE, 40, H - 40);
                        S.drones[i] = { x: t.x, y: t.y, tx, ty, hover: false, until: 0 };
                        t.droneAt = T + DRONE_CD;
                        event({ k: 'drone', i });
                    }
                }
            }
            if (typeof v.e === 'number') {
                if (t.es === null) t.es = v.e;
                else if (v.e > t.es) {
                    t.es = v.e;
                    if (T >= t.satAt) {
                        t.satFrom = T + SAT_DELAY; t.satTo = T + SAT_DELAY + SAT_TIME; t.satAt = T + SAT_CD;
                        event({ k: 'sat', i });
                    }
                }
            }
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
            if (b.life <= 0 || blockedShot(b.x, b.y)) {
                if (b.life > 0) event({ k: 'spark', x: Math.round(b.x), y: Math.round(b.y) });
                S.shots.splice(j, 1);
                continue;
            }
            const t = S.tanks[1 - b.o];
            if (t.alive && Math.hypot(b.x - t.x, b.y - t.y) < TANK_R + 6) {
                const dmg = Math.round(DMG * (b.amb ? AMBUSH_MUL : 1));
                t.hp -= dmg;
                t.reveal = Math.max(t.reveal, T + 600);
                S.shots.splice(j, 1);
                event({ k: 'hit', i: 1 - b.o, x: Math.round(t.x), y: Math.round(t.y), dmg, amb: b.amb });
                if (t.hp <= 0) {
                    t.hp = 0; t.alive = false; t.respawnAt = T + RESPAWN;
                    S.sc[b.o]++;
                    event({ k: 'kill', i: 1 - b.o, by: b.o, x: Math.round(t.x), y: Math.round(t.y) });
                    if (S.sc[b.o] >= WIN) { S.ph = 'over'; S.win = b.o; event({ k: 'over', w: b.o }); }
                }
            }
        }
    }

    function snapshot() {
        const r = v => Math.round(v * 10) / 10;
        return {
            type: 'state', seed: S.seed, T: Math.round(S.T), ph: S.ph, sc: S.sc, win: S.win,
            tanks: S.tanks.map(t => ({ x: r(t.x), y: r(t.y), a: r(t.a * 100) / 100, ta: r(t.ta * 100) / 100, hp: t.hp, alive: t.alive, respawnAt: t.respawnAt,
                reveal: t.reveal, droneAt: t.droneAt, satAt: t.satAt, satFrom: t.satFrom, satTo: t.satTo })),
            shots: S.shots.map(b => ({ x: r(b.x), y: r(b.y), vx: b.vx, vy: b.vy, o: b.o })),
            drones: S.drones.map(d => d && { x: r(d.x), y: r(d.y), hover: d.hover, until: d.until }),
            ev: S.ev
        };
    }
    function broadcast() { if (S && myRole === 'host' && !GameBot.enabled) session.send(snapshot()); }

    // ---------------------------------------------------------------- bot (host side, uses only what its own side can know)
    const bot = {
        reset() { Object.assign(this, { wp: null, seen: null, seenT: -1e9, since: 0, side: 1, q: 0, e: 0, lastPos: null, lastPosT: 0, burstErr: 0, strafeT: 0, camp: 0, frozen: this.frozen || false }); },
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
            const out = { mx: 0, my: 0, ax: null, f: false, q: this.q, e: this.e };
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
                return out;
            }
            // no contact: chase last intel, otherwise roam/lurk
            let goal = this.seen && T - this.seenT < 6000 ? this.seen : null;
            if (!goal) {
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
            return out;
        }
    };
    bot.reset();

    // ---------------------------------------------------------------- input
    const keys = {};
    let mouseAim = null, mouseDown = false, touchFire = false, stickVec = { x: 0, y: 0 }, qSeq = 0, eSeq = 0;
    addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (!keys[e.code]) {
            if (e.code === 'KeyQ') qSeq++;
            if (e.code === 'KeyE') eSeq++;
        }
        keys[e.code] = true;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { keys[e.code] = false; });
    addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; touchFire = false; });
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
    holdBtn($('fire-btn'), () => { touchFire = true; }, () => { touchFire = false; });
    holdBtn($('drone-btn'), () => { qSeq++; });
    holdBtn($('sat-btn'), () => { eSeq++; });

    let view = { ox: 0, oy: 0, s: 1, w: 0, h: 0 };
    function localInput() {
        let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
        let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
        if (!mx && !my) { mx = stickVec.x; my = stickVec.y; }
        let ax = null;
        const me = D()?.tanks[myIdx];
        if (mouseAim && me) ax = Math.atan2(mouseAim.y / view.s + view.oy - me.y, mouseAim.x / view.s + view.ox - me.x);
        return { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, ax: ax === null ? null : Math.round(ax * 100) / 100, f: !!(keys.Space || mouseDown || touchFire), q: qSeq, e: eSeq };
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
            inputs[1] = { mx: n(m.mx), my: n(m.my), ax: typeof m.ax === 'number' && isFinite(m.ax) ? m.ax : null, f: !!m.f, q: n(m.q), e: n(m.e) };
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
        session.send({ type: 'input', ...localInput() });
        if (wantRestart) session.send({ type: 'restart' });
    }, 1000 / 30);
    setInterval(() => { if (myRole === 'host' && S) broadcast(); }, NET_MS);

    // ---------------------------------------------------------------- screens
    function showScreen(id) {
        overlay.classList.toggle('hidden', !id);
        for (const s of screens) s.classList.toggle('hidden', s.id !== id);
    }
    function refreshTexts() {
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
                case 'fire': if (mine || canSeePoint(D, e)) { fx.push({ k: 'flash', x: e.x, y: e.y, t: now }); Sfx.fire(); } break;
                case 'spark': fx.push({ k: 'spark', x: e.x, y: e.y, t: now }); break;
                case 'hit':
                    fx.push({ k: 'hit', x: e.x, y: e.y, t: now, dmg: e.dmg });
                    Sfx.hit();
                    if (e.amb) banner(L('ambush') + ' -' + e.dmg, mine ? '#ff7a7a' : '#ffd36a');
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
    function canSeePoint(D, p) { const me = D.tanks[myIdx]; return me.alive && Math.hypot(me.x - p.x, me.y - p.y) < SIGHT; }

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

    function drawTank(t, i, alpha) {
        const c = COLORS[i];
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(t.x, t.y);
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath(); ctx.ellipse(4, 8, 27, 20, 0, 0, 7); ctx.fill();
        ctx.save();
        ctx.rotate(t.a);
        ctx.fillStyle = '#1b1f1d';
        ctx.fillRect(-25, -22, 50, 10); ctx.fillRect(-25, 12, 50, 10);
        ctx.fillStyle = '#3a403b';
        for (let k = -22; k < 25; k += 7) { ctx.fillRect(k, -22, 3, 10); ctx.fillRect(k, 12, 3, 10); }
        ctx.fillStyle = c.dark; ctx.fillRect(-22, -15, 44, 30);
        ctx.fillStyle = c.body; ctx.fillRect(-20, -13, 40, 24);
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(12, -10, 6, 20);
        ctx.restore();
        ctx.rotate(t.ta);
        ctx.fillStyle = '#20282b'; ctx.fillRect(4, -4, 30, 8);
        ctx.fillStyle = c.turret;
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill();
        ctx.strokeStyle = c.dark; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
        // hp bar
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(t.x - 24, t.y - 36, 48, 6);
        ctx.fillStyle = t.hp > 50 ? '#70ff91' : t.hp > 25 ? '#ffd36a' : '#ff6060';
        ctx.fillRect(t.x - 23, t.y - 35, 46 * t.hp / 100, 4);
        ctx.globalAlpha = 1;
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
                else { const d = disp[i]; d.x += (t.x - d.x) * 0.35; d.y += (t.y - d.y) * 0.35; d.a = t.a; d.ta = t.ta; Object.assign(d, { hp: t.hp, alive: t.alive, reveal: t.reveal, respawnAt: t.respawnAt }); }
                return disp[i];
            });
        }
        const me = tanks ? tanks[myIdx] : { x: W / 2, y: H / 2, alive: true };
        const shown = Dn ? { ...Dn, tanks, T } : null;
        const ox = clamp(me.x - vw / 2, -40, W - vw + 40), oy = clamp(me.y - vh / 2, -40, H - vh + 40);
        view = { ox, oy, s: scale, w: vw, h: vh };

        if (Dn && me.alive) markExplored(me.x, me.y, SIGHT);
        const myDrone = Dn && Dn.drones[myIdx];
        if (myDrone && myDrone.hover) markExplored(myDrone.x, myDrone.y, DRONE_R);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#05090d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
        shake = Math.max(0, shake - 0.8);
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (-ox + sx) * dpr * scale, (-oy + sy) * dpr * scale);
        if (!groundCache) groundCache = buildGround();
        ctx.drawImage(groundCache, 0, 0, W, H);

        // painter's order: ruins/rocks/tanks sorted by their bottom edge
        const items = [];
        const inView = (x, y, m) => x > ox - m && x < ox + vw + m && y > oy - m && y < oy + vh + m;
        for (const o of map.ruins) if (inView(o.x + o.w / 2, o.y + o.h / 2, 260)) items.push({ y: o.y + o.h, draw: () => drawRuin(o) });
        for (const o of map.rocks) if (inView(o.x, o.y, 80)) items.push({ y: o.y + o.r, draw: () => drawRock(o) });
        const enemyVisible = Dn ? visibleTo(shown, myIdx, tanks[1 - myIdx]) : false;
        if (Dn) {
            tanks.forEach((t, i) => {
                if (!t.alive) return;
                if (i === myIdx) items.push({ y: t.y + TANK_R, draw: () => drawTank(t, i, inForest(t.x, t.y) ? 0.85 : 1) });
                else if (enemyVisible) items.push({ y: t.y + TANK_R, draw: () => drawTank(t, i, 1) });
            });
        }
        items.sort((a, b) => a.y - b.y).forEach(it => it.draw());

        // forest canopies (see-through over your own tank)
        for (const f of map.forests) if (inView(f.x, f.y, f.r + 40)) drawForest(f, Dn && me.alive && Math.hypot(me.x - f.x, me.y - f.y) < f.r + 10);
        // tank inside a forest stays readable under the canopy
        if (Dn && me.alive && inForest(me.x, me.y)) { ctx.strokeStyle = 'rgba(140,255,170,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(me.x, me.y, 30, 0, 7); ctx.stroke(); }
        if (Dn && enemyVisible && inForest(tanks[1 - myIdx].x, tanks[1 - myIdx].y)) drawTank(tanks[1 - myIdx], 1 - myIdx, 0.75);

        // shells (only near what I can see) + effects
        if (Dn) {
            const ext = myRole === 'host' ? 0 : Math.min(80, performance.now() - netAt);
            for (const b of Dn.shots) {
                const x = b.x + b.vx * ext, y = b.y + b.vy * ext;
                if (b.o !== myIdx && Math.hypot(x - me.x, y - me.y) > SIGHT + 40 && !(myDrone && myDrone.hover && Math.hypot(x - myDrone.x, y - myDrone.y) < DRONE_R)) continue;
                ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x + 4, y + 8, 4, 0, 7); ctx.fill();
                ctx.strokeStyle = 'rgba(255,200,90,.45)'; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - b.vx * 40, y - b.vy * 40); ctx.stroke();
                ctx.fillStyle = '#fff1b8'; ctx.shadowColor = '#ffab32'; ctx.shadowBlur = 14;
                ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
            }
        }
        for (let k = fx.length - 1; k >= 0; k--) {
            const f = fx[k], age = now - f.t;
            const life = { flash: 120, spark: 260, hit: 700, boom: 900 }[f.k];
            if (age > life) { fx.splice(k, 1); continue; }
            const p = age / life;
            if (f.k === 'flash') { ctx.fillStyle = `rgba(255,220,120,${1 - p})`; ctx.beginPath(); ctx.arc(f.x, f.y, 34 * (1 - p) + 10, 0, 7); ctx.fill(); }
            if (f.k === 'spark') { ctx.strokeStyle = `rgba(255,210,120,${1 - p})`; ctx.lineWidth = 2; for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + Math.cos(a) * 18 * p + 2, f.y + Math.sin(a) * 18 * p + 2); ctx.stroke(); } }
            if (f.k === 'hit') {
                ctx.fillStyle = `rgba(255,120,60,${0.8 * (1 - p)})`; ctx.beginPath(); ctx.arc(f.x, f.y, 14 + 26 * p, 0, 7); ctx.fill();
                ctx.fillStyle = `rgba(255,255,255,${1 - p})`; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('-' + f.dmg, f.x, f.y - 40 - 30 * p);
            }
            if (f.k === 'boom') {
                for (let r = 0; r < 3; r++) { ctx.fillStyle = `rgba(${255 - r * 40},${150 - r * 50},40,${(1 - p) * 0.7})`; ctx.beginPath(); ctx.arc(f.x + (r - 1) * 12 * p, f.y - r * 8 * p, (20 + 60 * p) * (1 - r * 0.2), 0, 7); ctx.fill(); }
            }
        }
        if (Dn) Dn.drones.forEach((d, i) => { if (d && (i === myIdx || (me.alive && Math.hypot(d.x - me.x, d.y - me.y) < SIGHT + 120))) drawDrone(d, i === myIdx, now); });

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
            if (me.alive) hole(me.x, me.y, SIGHT);
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
        ctx.strokeStyle = '#2d6170'; ctx.strokeRect(mx - 2, my - 2, mw + 4, mh + 4);

        if (satLive && foe.alive) offscreenArrow(foe.x, foe.y, cw, ch, '#ff536a', '🛰️');
        if (myD) offscreenArrow(myD.x, myD.y, cw, ch, '#6ef0ff', '');

        // status lines (top-left)
        ctx.textAlign = 'left'; ctx.font = `bold ${small ? 12 : 14}px system-ui`;
        let ly = 22;
        const line = (t, c) => { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillText(t, 13, ly + 1); ctx.fillStyle = c; ctx.fillText(t, 12, ly); ly += small ? 17 : 20; };
        if (me.alive) {
            line(`${meT.hp} HP`, meT.hp > 50 ? '#7dff9a' : meT.hp > 25 ? '#ffd36a' : '#ff7070');
            if (inForest(me.x, me.y)) line(T < meT.reveal ? '⚠ ' + L('spotted') : '🌲 ' + L('hidden'), T < meT.reveal ? '#ffb070' : '#8dffb0');
        } else line(L('respawn', { s: Math.max(0, Math.ceil((meT.respawnAt - T) / 1000)) }), '#ff9a9a');
        if (myD && myD.hover) line('🛸 ' + L('drone_on'), '#6ef0ff');
        if (satLive) line('🛰️ ' + L('sat_on'), '#ff9db0');
        const ed = Dn.drones[1 - myIdx];
        if (ed && ed.hover && me.alive && Math.hypot(ed.x - me.x, ed.y - me.y) < DRONE_R) line('⚠ ' + L('enemy_drone'), '#ff7a7a');

        // gadget cooldowns (desktop: bottom-left chips; touch: button fill)
        const cdD = clamp((meT.droneAt - T) / DRONE_CD, 0, 1), cdS = clamp((meT.satAt - T) / SAT_CD, 0, 1);
        if (isTouch) {
            for (const [id, p] of [['drone-btn', cdD], ['sat-btn', cdS]]) {
                const b = $(id); b.querySelector('.cd').style.height = (p * 100) + '%'; b.classList.toggle('ready', p === 0);
            }
        } else {
            const chip = (x, icon, key, p) => {
                ctx.fillStyle = 'rgba(2,10,16,.8)'; ctx.fillRect(x, ch - 52, 118, 40);
                ctx.fillStyle = p ? 'rgba(80,110,120,.6)' : 'rgba(60,200,230,.35)'; ctx.fillRect(x, ch - 52, 118 * (1 - p), 40);
                ctx.strokeStyle = p ? '#355' : '#5ef0ff'; ctx.strokeRect(x, ch - 52, 118, 40);
                ctx.fillStyle = '#e8fcff'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'left';
                ctx.fillText(`${icon} [${key}] ${p ? Math.ceil(p * (key === 'Q' ? DRONE_CD : SAT_CD) / 1000) + 's' : 'OK'}`, x + 8, ch - 27);
            };
            chip(12, '🛸', 'Q', cdD); chip(138, '🛰️', 'E', cdS);
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
