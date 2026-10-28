/**
 * Link Soccer — 机甲足球: 1v1 realtime top-down mini football.
 *
 * Built on scripts/sport-kit.js (session lifecycle, audio, FX, HitWindow) and
 * the volley pattern: the host owns ball, keepers, clock and goals at 60 Hz
 * and broadcasts at 30 Hz; each side simulates its *own* player locally
 * (zero-latency feel) and streams its position + a kick counter.
 *
 * The ball has height (z): ground passes roll under nobody, charged shots
 * lift — a lob flies over the players and, if hit too hard, over the bar.
 * Each goal has an automatic keeper (same speed for both sides, so the bot
 * level never touches fairness): long shots get saved, close ones go in.
 *
 * Canonical coordinates: host attacks the right goal, client the left; the
 * client mirrors the world horizontally so everyone attacks to the right.
 *
 * One finger: hold & drag = run to your finger (you dribble by running into
 * the ball). Press & hold still = charge, release = shoot (quick tap = short
 * poke). Keyboard: WASD / arrows run, Space hold & release = shoot.
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    if (!location.hash || location.hash.length <= 1) location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    const { clamp, rnd, r1, num } = SportKit;
    const L = SoccerI18n.t;
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    // ==========================================================
    // Constants
    // ==========================================================
    const W = 800, H = 450;
    const FX0 = 44, FX1 = W - 44, FY0 = 46, FY1 = H - 26;
    const MY = (FY0 + FY1) / 2;
    const GY0 = MY - 72, GY1 = MY + 72, GZ = 54, GDEPTH = 30;
    const PR = 19, BR = 10, KR = 17;
    const G = 0.34, RUN = 4.2, ACC = 0.55;
    const REACH = PR + BR + 16, REACH_Z = 34;
    const KEEP_V = 2.0, KEEP_REACT = 6;
    const WIN_GOALS = 5, MATCH_T = 120 * 60, KICK_T = 70, GOAL_T = 120;
    const CHARGE_T = 42;
    const START = [[FX0 + 150, MY], [FX1 - 150, MY]];
    const COL = SportMech.TEAM;
    const fwdOf = (i) => (i === 0 ? 1 : -1);
    const goalX = (i) => (i === 0 ? FX1 : FX0);   // the goal seat i attacks
    const inMouth = (y) => y > GY0 + BR * 0.5 && y < GY1 - BR * 0.5;

    // ==========================================================
    // Ball physics (host sim + client extrapolation)
    // ==========================================================
    /** One 1/60 s step. Returns 0 | 1 = goal *for* that seat, or -1. */
    function ballStep(b, hit) {
        b.vz -= G;
        b.x += b.vx; b.y += b.vy; b.z += b.vz;
        if (b.z <= 0) {
            b.z = 0;
            if (b.vz < -1.6) { if (hit) hit.bounce = -b.vz; b.vz = -b.vz * 0.5; } else b.vz = 0;
        }
        const f = b.z > 0 ? 0.996 : 0.982;
        b.vx *= f; b.vy *= f;
        if (b.y < FY0 + BR) { b.y = FY0 + BR; b.vy = Math.abs(b.vy) * 0.8; if (hit) hit.wall = 1; }
        else if (b.y > FY1 - BR) { b.y = FY1 - BR; b.vy = -Math.abs(b.vy) * 0.8; if (hit) hit.wall = 1; }
        for (const side of [0, 1]) {
            const line = side === 0 ? FX0 : FX1, s = side === 0 ? -1 : 1;     // s: outward
            const past = (b.x - line) * s;                                    // >0 = beyond the goal line
            if (past > -BR) {
                if (inMouth(b.y) && b.z < GZ) {
                    if (past > BR) return side === 0 ? 1 : 0;                 // fully over the line: goal
                } else if (past < BR) {
                    b.x = line - s * BR; b.vx = -s * Math.abs(b.vx) * 0.8; if (hit) hit.wall = 1;
                }
            }
            // posts
            for (const py of [GY0, GY1]) {
                if (b.z >= GZ) continue;
                const dx = b.x - line, dy = b.y - py, d = Math.hypot(dx, dy);
                if (d < BR + 4 && d > 0.01) {
                    const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
                    b.x = line + nx * (BR + 4); b.y = py + ny * (BR + 4);
                    if (vn < 0) { b.vx -= 1.7 * vn * nx; b.vy -= 1.7 * vn * ny; if (hit) hit.post = 1; }
                }
            }
        }
        b.spin = (b.spin || 0) + Math.hypot(b.vx, b.vy) * 0.08;
        return -1;
    }

    // ==========================================================
    // Players (identical stepping on host, client and bot)
    // ==========================================================
    function mkPlayer(i) { return { x: START[i][0], y: START[i][1], vx: 0, vy: 0, face: fwdOf(i), run: 0 }; }
    /** ctl: {mx,my -1..1 | tx,ty canonical target | sp speed mul} */
    function simPlayer(p, i, ctl, frozen) {
        let tvx = 0, tvy = 0;
        const run = RUN * (ctl.sp || 1);
        if (!frozen) {
            if (ctl.mx || ctl.my) {
                const m = Math.hypot(ctl.mx, ctl.my) || 1;
                tvx = ctl.mx / m * run; tvy = ctl.my / m * run;
            } else if (ctl.tx !== null && ctl.tx !== undefined) {
                const dx = ctl.tx - p.x, dy = ctl.ty - p.y, d = Math.hypot(dx, dy);
                if (d > 2) { const s = Math.min(run, d * 0.3); tvx = dx / d * s; tvy = dy / d * s; }
            }
        }
        p.vx += clamp(tvx - p.vx, -ACC, ACC);
        p.vy += clamp(tvy - p.vy, -ACC, ACC);
        p.x = clamp(p.x + p.vx, FX0 + PR, FX1 - PR);
        p.y = clamp(p.y + p.vy, FY0 + PR, FY1 - PR);
        if (Math.abs(p.vx) > 0.4) p.face = Math.sign(p.vx);
        p.run += Math.hypot(p.vx, p.vy) * 0.08;
    }

    // ==========================================================
    // Audio / FX / view
    // ==========================================================
    const Sfx = SportKit.sfx('soccer-muted');
    Sfx.bindMute(document.getElementById('mute-btn'));
    Sfx.kick = (pw) => { Sfx.noise(0.08, 900, 1.2, 0.25 + pw * 0.2); Sfx.tone(140 + pw * 60, 0.12, 'sine', 0.25, 60); };
    Sfx.tap = () => Sfx.tone(320, 0.05, 'sine', 0.12, 220);
    Sfx.post = () => Sfx.tone(1250, 0.35, 'triangle', 0.14, 1180);
    Sfx.save = () => { Sfx.noise(0.15, 600, 1, 0.3); Sfx.tone(240, 0.12, 'square', 0.06, 120); };
    const FX = SportKit.fx();
    const view = GameFit.view(canvas, { width: W, height: H, rotate: 'auto' });

    // ==========================================================
    // Match shell
    // ==========================================================
    let S = null, hostLoop = null, matchId = 0;
    const emit = SportKit.emitter(fx);
    const M = SportKit.match({
        game: 'soccer', L, sfx: Sfx, effects: FX, W, H,
        startMatch, stopHost() { clearInterval(hostLoop); }, hostOver: () => !S || S.ph === 'over',
        broadcast, onInput, onEvent: fx,
        onNewMatch() { me = mkPlayer(1); }
    });
    const flip = () => M.flip();
    const toCanonX = (x) => (flip() ? W - x : x);

    // ==========================================================
    // Input
    // ==========================================================
    const keys = {};
    let touchT = null;               // {x, y} canonical
    let charging = -1;               // frames charged, -1 = not charging
    let kickQueued = null;           // power 0..1
    let dashActive = false;
    const joy = { x: 0, y: 0, active: false };

    window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        const k = e.key.toLowerCase();
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
        Sfx.init();
        if (e.repeat) return;
        keys[k] = true;
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) touchT = null;
        if ((k === ' ' || k === 'j') && inMatch()) charging = 0;
        if (k === 'shift' || k === 'k') dashActive = true;
    });
    window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        keys[k] = false;
        if ((k === ' ' || k === 'j') && charging >= 0) { kickQueued = charging / CHARGE_T; charging = -1; }
        if (k === 'shift' || k === 'k') dashActive = false;
    });

    const touchBox = document.getElementById('touch-controls');
    if (touchBox) {
        SportKit.controls({
            stick: document.getElementById('move-stick'),
            knob: document.getElementById('move-knob'),
            actions: touchBox.querySelector('.touch-actions'),
            view,
            flip,
            sfx: Sfx,
            onMove: (mx, my, active) => {
                joy.x = mx; joy.y = my; joy.active = active;
                if (active) touchT = null;
            },
            onAction: (action, down) => {
                if (!inMatch()) return;
                if (action === 'dash') {
                    dashActive = down;
                } else if (action === 'kick') {
                    if (down) {
                        charging = 0;
                    } else if (charging >= 0) {
                        kickQueued = Math.max(0.25, charging / CHARGE_T);
                        charging = -1;
                    }
                }
            }
        });
    }

    const dragArea = canvas.closest('.gf-box') || canvas;
    const pointers = new Map();
    const logical = (e) => { const p = view.toLogical(e.clientX, e.clientY); return { x: toCanonX(p.x), y: p.y }; };
    dragArea.addEventListener('pointerdown', (e) => {
        if (e.target.closest && e.target.closest('.overlay:not(.hidden)')) return;
        Sfx.init();
        if (!inMatch()) return;
        if (e.pointerType === 'touch') e.preventDefault();
        const p = logical(e);
        if (pointers.size > 0) { kickQueued = 0.6; return; }          // second finger: instant shot
        pointers.set(e.pointerId, { x0: p.x, y0: p.y, t0: performance.now(), moved: false });
        charging = 0;
        try { dragArea.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    dragArea.addEventListener('pointermove', (e) => {
        const q = pointers.get(e.pointerId);
        if (!q) return;
        const p = logical(e);
        if (!q.moved && Math.hypot(p.x - q.x0, p.y - q.y0) > 14) { q.moved = true; charging = -1; }
        if (q.moved) touchT = p;
    });
    function endPointer(e) {
        const q = pointers.get(e.pointerId);
        if (!q) return;
        pointers.delete(e.pointerId);
        if (!q.moved && charging >= 0 && e.type === 'pointerup' && inMatch()) kickQueued = Math.max(0.25, charging / CHARGE_T);
        charging = -1;
    }
    dragArea.addEventListener('pointerup', endPointer);
    dragArea.addEventListener('pointercancel', endPointer);
    dragArea.addEventListener('contextmenu', (e) => e.preventDefault());

    function localCtl() {
        let mx = 0, my = 0;
        if (joy.active) {
            mx = joy.x;
            my = joy.y;
        } else {
            if (keys.a || keys.arrowleft) mx -= 1;
            if (keys.d || keys.arrowright) mx += 1;
            if (keys.w || keys.arrowup) my -= 1;
            if (keys.s || keys.arrowdown) my += 1;
            if (flip()) mx = -mx;
        }
        if (dashActive) {
            mx *= 1.35;
            my *= 1.35;
        }
        if (charging >= 0) charging = Math.min(CHARGE_T, charging + 1);
        const kick = kickQueued;
        kickQueued = null;
        return { mx, my, tx: (joy.active || mx || my) ? null : (touchT ? touchT.x : null), ty: (joy.active || mx || my) ? null : (touchT ? touchT.y : null), kick };
    }

    // ==========================================================
    // Host simulation
    // ==========================================================
    const hist = SportKit.history(16);
    const lastKc = [0, null];
    function startMatch() {
        matchId++;
        S = {
            mid: matchId, ph: 'kick', pt: 0, sc: [0, 0], clk: 0, gg: false, ko: Math.random() < 0.5 ? 0 : 1,
            b: { x: W / 2, y: MY, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 },
            p: [mkPlayer(0), mkPlayer(1)],
            kp: [{ y: MY, rt: 0 }, { y: MY, rt: 0 }],
            arm: [null, null], last: -1, touches: 0, kicks: 0, evId: 0, events: [], winner: -1
        };
        if (GameBot.enabled) { botP = mkPlayer(1); bot = mkBrain(1, GameBot.level); }
        lastKc[1] = null;
        placeKickoff();
        clearInterval(hostLoop);
        hostLoop = setInterval(hostTick, 1000 / 60);
        M.started(S.sc);
        M.showToast(L('toast_kick'), 3600);
        broadcast();
    }
    function placeKickoff() {
        const b = S.b;
        Object.assign(b, { x: W / 2, y: MY, z: 0, vx: 0, vy: 0, vz: 0 });
        S.p[0] = mkPlayer(0); S.p[1] = mkPlayer(1);
        S.p[S.ko].x = W / 2 - fwdOf(S.ko) * (PR + BR + 6);
        if (GameBot.enabled) { botP.x = S.p[1].x; botP.y = S.p[1].y; botP.vx = botP.vy = 0; }
        S.kp.forEach((k) => { k.y = MY; k.rt = 0; });
        S.arm = [null, null];
        S.ph = 'kick'; S.pt = 0;
        hist.clear();
        emit(S, { k: 'ko', i: S.ko });
    }

    function hostTick() {
        if (!S || S.ph === 'over') return;
        const frozen = S.ph !== 'play';
        const c0 = autoHost ? think(autoHost, S.p[0]) : localCtl();
        simPlayer(S.p[0], 0, c0, frozen);
        if (c0.kick !== null && c0.kick !== undefined && !frozen) armKick(0, c0.kick, false);
        if (GameBot.enabled && !botFrozen) botStep(frozen);

        if (S.ph === 'kick') {
            if (++S.pt >= KICK_T) { S.ph = 'play'; S.pt = 0; emit(S, { k: 'go' }); }
        } else if (S.ph === 'play') {
            S.pt++;
            if (!S.gg && ++S.clk >= MATCH_T) {
                if (S.sc[0] !== S.sc[1]) return endMatch();
                S.gg = true; emit(S, { k: 'gg' });
            }
            const hit = {};
            const goal = ballStep(S.b, hit);
            if (hit.post) emit(S, { k: 'post', x: r1(S.b.x), y: r1(S.b.y) });
            else if (hit.bounce > 3) emit(S, { k: 'bounce', x: r1(S.b.x), y: r1(S.b.y) });
            hist.push({ x: S.b.x, y: S.b.y, z: S.b.z });
            if (goal >= 0) return onGoal(goal);
            keepers();
            for (const i of [0, 1]) {
                dribble(i);
                if (S.arm[i] && --S.arm[i].t >= 0 && canKick(S.p[i], S.b)) doKick(i, S.arm[i].pw);
                if (S.arm[i] && S.arm[i].t < 0) S.arm[i] = null;
            }
        } else if (S.ph === 'goal') {
            ballStep(S.b);
            if (S.b.x < FX0 - GDEPTH + BR) { S.b.x = FX0 - GDEPTH + BR; S.b.vx = 0; }
            if (S.b.x > FX1 + GDEPTH - BR) { S.b.x = FX1 + GDEPTH - BR; S.b.vx = 0; }
            if (++S.pt >= GOAL_T) {
                if (S.sc[0] >= WIN_GOALS || S.sc[1] >= WIN_GOALS || S.gg || (S.clk >= MATCH_T)) return endMatch();
                placeKickoff();
            }
        }
        if ((S.pt & 1) === 0) broadcast();
    }
    function endMatch() {
        S.ph = 'over';
        S.winner = S.sc[0] > S.sc[1] ? 0 : 1;
        broadcast();
        M.gameOver(S.sc);
    }
    function onGoal(scorer) {
        S.sc[scorer]++;
        S.ko = 1 - scorer;
        S.ph = 'goal'; S.pt = 0;
        emit(S, { k: 'goal', i: scorer, x: r1(S.b.x), y: r1(S.b.y), sc: S.sc.slice() });
        M.score(S.sc);
    }

    const canKick = (p, b) => b.z < REACH_Z && Math.hypot(b.x - p.x, b.y - p.y) < REACH;
    function armKick(i, pw, lag) {
        const p = S.p[i];
        pw = clamp(pw, 0, 1);
        if (canKick(p, S.b)) return doKick(i, pw);
        // HitWindow: the remote player saw an older ball; if it was in reach
        // on their screen (and still nearby here) the kick counts.
        if (lag && Math.hypot(S.b.x - p.x, S.b.y - p.y) < REACH + 40 &&
            hist.lagScan(M.rtt, (h) => h.z < REACH_Z && Math.hypot(h.x - p.x, h.y - p.y) < REACH)) return doKick(i, pw);
        S.arm[i] = { pw, t: 9 };      // slightly early press: kick when the ball arrives
    }
    /**
     * Shot: toward the far post from the keeper (or the side you are running
     * to), harder = faster and higher. Low taps are ground passes.
     */
    function doKick(i, pw) {
        const p = S.p[i], b = S.b, kp = S.kp[1 - i];
        let ty;
        if (Math.abs(p.vy) > 1.2) ty = p.vy > 0 ? GY1 - 18 : GY0 + 18;
        else ty = kp.y < MY ? GY1 - 18 : GY0 + 18;
        ty += rnd(-10, 10);
        const tx = goalX(i) + fwdOf(i) * 12;
        let dx = tx - b.x, dy = ty - b.y;
        const d = Math.hypot(dx, dy) || 1;
        dx /= d; dy /= d;
        if (dx * fwdOf(i) < 0.15) { dx = fwdOf(i) * 0.4; dy = Math.sign(dy || 1) * 0.92; }   // never shoot backwards
        const sp = 5.5 + pw * 10.5;
        b.vx = dx * sp; b.vy = dy * sp;
        b.vz = pw < 0.3 ? 0.6 : 1.2 + pw * 5.4;
        b.z = Math.max(b.z, 1);
        const n = Math.hypot(b.x - p.x, b.y - p.y) || 1;
        if (n < PR + BR) { b.x = p.x + (b.x - p.x) / n * (PR + BR); b.y = p.y + (b.y - p.y) / n * (PR + BR); }
        S.arm[i] = null;
        S.last = i; S.kicks++;
        emit(S, { k: 'kick', i, x: r1(b.x), y: r1(b.y), pw: r1(pw) });
    }
    /** Running into a rolling ball pushes it: that is dribbling. */
    function dribble(i) {
        const p = S.p[i], b = S.b;
        if (b.z > PR * 1.3) return;
        let dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
        if (d >= PR + BR) return;
        if (d < 0.01) { dx = fwdOf(i); dy = 0; d = 1; }
        const nx = dx / d, ny = dy / d;
        b.x = p.x + nx * (PR + BR); b.y = p.y + ny * (PR + BR);
        const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
        if (vn < 0) {
            b.vx -= 1.25 * vn * nx; b.vy -= 1.25 * vn * ny;
            if (S.last !== i) { S.last = i; emit(S, { k: 'touch', i, x: r1(b.x), y: r1(b.y) }); }
            S.touches++;
        }
    }
    /** Auto keepers: identical for both sides. */
    function keepers() {
        const b = S.b;
        for (const side of [0, 1]) {
            const k = S.kp[side], line = side === 0 ? FX0 : FX1, s = side === 0 ? -1 : 1;
            const kx = line - s * 16;
            const incoming = b.vx * s > 2.5;
            k.rt = incoming ? k.rt + 1 : 0;
            let ty = MY + (b.y - MY) * 0.35;
            if (incoming && k.rt > KEEP_REACT && Math.abs(b.vx) > 0.1) {
                ty = b.y + b.vy * Math.abs((kx - b.x) / b.vx);      // where it crosses the keeper line
            }
            ty = clamp(ty, GY0 + 8, GY1 - 8);
            k.y += clamp(ty - k.y, -KEEP_V, KEEP_V);
            const dx = b.x - kx, dy = b.y - k.y, d = Math.hypot(dx, dy);
            if (b.z < 44 && d < KR + BR && b.vx * s > -1) {
                const sp = Math.hypot(b.vx, b.vy);
                b.vx = -s * Math.max(3, Math.abs(b.vx) * 0.45);
                b.vy = (dy / (d || 1)) * 3 + rnd(-2, 2);
                b.vz = 2.5 + sp * 0.1;
                b.x = kx - s * (KR + BR + 1);
                emit(S, { k: 'save', i: side, x: r1(b.x), y: r1(b.y), hard: sp > 9 ? 1 : 0 });
                S.last = -1;
            }
        }
    }

    function broadcast() {
        if (!S) return;
        const b = S.b;
        M.send({
            type: 'state', mid: S.mid, ph: S.ph, pt: S.pt, sc: S.sc, clk: S.clk, gg: S.gg ? 1 : 0, ko: S.ko,
            b: [r1(b.x), r1(b.y), r1(b.z), r1(b.vx), r1(b.vy), r1(b.vz), r1(b.spin)],
            p: S.p.map((q) => [r1(q.x), r1(q.y), r1(q.vx), r1(q.vy)]),
            ch: Math.max(0, charging),
            k: [r1(S.kp[0].y), r1(S.kp[1].y)],
            ev: S.events.slice(-8)
        });
    }

    function onInput(msg) {
        if (!S || !num(msg.x) || !num(msg.y)) return;
        const p = S.p[1];
        if (S.ph !== 'play') return;      // positions are reset at kick-off; ignore stale ones
        p.x = clamp(msg.x, FX0 + PR, FX1 - PR);
        p.y = clamp(msg.y, FY0 + PR, FY1 - PR);
        p.vx = num(msg.vx) ? clamp(msg.vx, -RUN, RUN) : 0;
        p.vy = num(msg.vy) ? clamp(msg.vy, -RUN, RUN) : 0;
        if (Math.abs(p.vx) > 0.4) p.face = Math.sign(p.vx);
        p.run += Math.hypot(p.vx, p.vy) * 0.08;
        p.ch = num(msg.ch) ? clamp(msg.ch, 0, CHARGE_T) : 0;
        if (num(msg.kc)) {
            if (lastKc[1] === null) lastKc[1] = msg.kc;
            else if (msg.kc > lastKc[1]) {
                lastKc[1] = msg.kc;
                armKick(1, num(msg.pw) ? msg.pw : 0.5, !GameBot.enabled);
            }
        }
    }

    // ==========================================================
    // Bot — plays seat 1 via the same input message; seat-agnostic brain
    // ==========================================================
    const BOT_LV = {
        easy: { sp: 0.72, err: 26, react: 18, range: 170, pw: [0.35, 0.7] },
        normal: { sp: 0.88, err: 12, react: 9, range: 230, pw: [0.5, 0.9] },
        hard: { sp: 1.0, err: 4, react: 3, range: 290, pw: [0.65, 1.0] }
    };
    function mkBrain(i, lv) { return { i, B: BOT_LV[lv] || BOT_LV.normal, timer: 0, tx: START[i][0], ty: MY, ex: 0, ey: 0, cool: 0 }; }
    function think(br, me) {
        const ctl = { tx: br.tx, ty: br.ty, sp: br.B.sp, kick: null };
        if (!S || S.ph !== 'play') return ctl;
        const b = S.b, i = br.i, fwd = fwdOf(i), B = br.B, op = S.p[1 - i];
        if (--br.timer <= 0) { br.timer = B.react; br.ex = GameBot.gauss() * B.err; br.ey = GameBot.gauss() * B.err; }
        const gx = goalX(i), gdx = gx - b.x, gdy = MY - b.y, gd = Math.hypot(gdx, gdy) || 1;
        const ux = gdx / gd, uy = gdy / gd;                        // ball → goal
        const behind = (b.x - me.x) * fwd > 4;                      // I am on the right side of the ball
        const myD = Math.hypot(b.x - me.x, b.y - me.y), opD = Math.hypot(b.x - op.x, b.y - op.y);
        const ownGoal = goalX(1 - i);
        if (!behind) {
            // get round the ball (go wide so we don't knock it into our own goal)
            const side = me.y < b.y ? -1 : 1;
            br.tx = b.x - fwd * (PR + BR + 22); br.ty = b.y + side * (PR + BR + 12);
        } else if (opD + 30 < myD && (b.x - W / 2) * fwd < 60) {
            // defend: sit between ball and our goal
            const ox = ownGoal - b.x, oy = MY - b.y, od = Math.hypot(ox, oy) || 1;
            br.tx = b.x + ox / od * 42; br.ty = b.y + oy / od * 42;
        } else {
            // push through the ball toward goal
            br.tx = b.x + ux * 14; br.ty = b.y + uy * 14;
        }
        br.tx += br.ex * 0.4; br.ty += br.ey * 0.4;
        if (br.cool > 0) br.cool--;
        if (br.cool === 0 && canKick(me, b) && behind && Math.abs(gx - b.x) < B.range) {
            ctl.kick = rnd(B.pw[0], B.pw[1]);
            br.cool = 30;
        } else if (br.cool === 0 && canKick(me, b) && behind && op && Math.hypot(op.x - b.x, op.y - b.y) < PR * 2.4 && Math.random() < 0.05) {
            ctl.kick = 0.45; br.cool = 30;       // pressured: clear it forward
        }
        ctl.tx = br.tx; ctl.ty = br.ty;
        return ctl;
    }
    let bot = mkBrain(1, GameBot.level);
    let botP = mkPlayer(1), botKc = 0, botFrozen = false;
    let autoHost = null;
    function botStep(frozen) {
        const c = think(bot, botP);
        if (frozen) { botP.x = S.p[1].x; botP.y = S.p[1].y; botP.vx = botP.vy = 0; }
        simPlayer(botP, 1, c, frozen);
        if (frozen) return;
        if (c.kick !== null) botKc++;
        GameBot.deliver({ type: 'input', x: botP.x, y: botP.y, vx: botP.vx, vy: botP.vy, kc: botKc, pw: c.kick === null ? 0.5 : c.kick });
    }

    // ==========================================================
    // Client: own player runs locally and streams position + kicks
    // ==========================================================
    let me = mkPlayer(1), kcSeq = 0;
    setInterval(() => {
        if (M.role !== 'client' || !M.open || !M.net) return;
        const n = M.net;
        if (n.ph === 'over') return;
        if (n.ph !== 'play') {             // kick-off: the host places everybody
            me.x = n.p[1][0]; me.y = n.p[1][1]; me.vx = me.vy = 0;
            localCtl();
            return;
        }
        const c = localCtl();
        simPlayer(me, 1, c, false);
        if (c.kick !== null && c.kick !== undefined) kcSeq++;
        M.send({ type: 'input', x: r1(me.x), y: r1(me.y), vx: r1(me.vx), vy: r1(me.vy), kc: kcSeq, pw: c.kick === null ? 0.5 : r1(c.kick), ch: Math.max(0, charging) });
    }, 1000 / 60);

    function inMatch() { const d = M.role === 'host' ? S : M.net; return !!d && d.ph !== 'over' && !M.overlayUp(); }

    // ==========================================================
    // Draw-state
    // ==========================================================
    const dispOpp = { x: START[0][0], y: MY };
    function drawState() {
        if (M.role === 'host') {
            if (!S) return null;
            return { ph: S.ph, pt: S.pt, sc: S.sc, clk: S.clk, gg: S.gg, ko: S.ko, b: S.b, p: S.p, k: [S.kp[0].y, S.kp[1].y], ch: [charging, S.p[1].ch || 0] };
        }
        const n = M.net;
        if (!n) return null;
        const f = M.age();
        const b = { x: n.b[0], y: n.b[1], z: n.b[2], vx: n.b[3], vy: n.b[4], vz: n.b[5], spin: n.b[6] };
        if (n.ph === 'play') for (let k = 0; k < Math.floor(f); k++) if (ballStep(b) >= 0) break;
        const o = n.p[0];
        dispOpp.x += (o[0] - dispOpp.x) * 0.5; dispOpp.y += (o[1] - dispOpp.y) * 0.5;
        return {
            ph: n.ph, pt: n.pt + f, sc: n.sc, clk: n.clk, gg: n.gg, ko: n.ko, b,
            p: [{ x: dispOpp.x, y: dispOpp.y, vx: o[2], vy: o[3], face: o[2] < -0.4 ? -1 : 1, run: performance.now() / 120 * Math.min(1, Math.hypot(o[2], o[3]) / RUN) }, me],
            k: n.k, ch: [n.ch || 0, charging]
        };
    }

    // ==========================================================
    // FX events
    // ==========================================================
    function fx(ev) {
        const mine = ev.i === M.idx;
        if (ev.k === 'kick') {
            Sfx.kick(ev.pw || 0.5);
            FX.burst(ev.x, ev.y, 6 + Math.round((ev.pw || 0) * 12), '#ffffff', 2 + (ev.pw || 0) * 4, 18, 2.5);
            if (ev.pw > 0.85) { FX.float('POWER!', ev.x, ev.y - 40, '#ffd34d', 26); FX.shake = 3; }
        } else if (ev.k === 'touch') Sfx.tap();
        else if (ev.k === 'bounce') { Sfx.thud(); FX.puff(ev.x, ev.y, 6, '#9bdcff'); }
        else if (ev.k === 'post') { Sfx.post(); FX.shake = 5; FX.float('POST!', ev.x, ev.y - 30, '#ffffff', 24); }
        else if (ev.k === 'save') {
            Sfx.save();
            FX.burst(ev.x, ev.y, 12, '#ffd34d', 3, 20, 2.5);
            if (ev.hard) FX.float('SAVE!', ev.x, ev.y - 40, '#7fd3ff', 28);
        } else if (ev.k === 'goal') {
            Sfx.whistle(); Sfx.cheer();
            FX.shake = 10; FX.flash = 6; FX.slowmo = 50;
            FX.float(mine ? 'GOAL!!' : 'GOAL…', W / 2, 150, mine ? '#ffd34d' : '#ff6b6b', 52);
            FX.confetti(ev.x, ev.y, mine ? 70 : 30);
        } else if (ev.k === 'ko') Sfx.beep();
        else if (ev.k === 'go') Sfx.whistle();
        else if (ev.k === 'gg') { Sfx.whistle(); FX.float('GOLDEN GOAL', W / 2, 140, '#ffd34d', 36); }
    }

    // ==========================================================
    // Rendering
    // ==========================================================
    let bgCache = null;
    function background() {
        if (bgCache) return bgCache;
        const c = document.createElement('canvas');
        c.width = W * 2; c.height = H * 2;
        const g = c.getContext('2d');
        g.scale(2, 2);
        const T = SportMech.TEAM;
        // outer deck + stands
        SportMech.steel(g, 0, 0, W, H, { top: '#1a1e2c', bot: '#0d1018', plate: 50 });
        SportMech.rim(g, FX0, FY0, FX1, FY1);
        // pitch: dark armoured floor with hex texture
        const pg = g.createLinearGradient(0, FY0, 0, FY1);
        pg.addColorStop(0, '#141b2c'); pg.addColorStop(1, '#1d2740');
        g.fillStyle = pg; g.fillRect(FX0, FY0, FX1 - FX0, FY1 - FY0);
        g.save();
        g.beginPath(); g.rect(FX0, FY0, FX1 - FX0, FY1 - FY0); g.clip();
        g.strokeStyle = 'rgba(140,170,220,.07)'; g.lineWidth = 1;
        const hr = 14, hw = hr * Math.sqrt(3);
        for (let row = 0, y = FY0; y < FY1 + hr; row++, y += hr * 1.5) {
            for (let x = FX0 + (row % 2) * hw / 2; x < FX1 + hw; x += hw) {
                g.beginPath();
                for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(x + Math.cos(a) * hr, y + Math.sin(a) * hr); }
                g.closePath(); g.stroke();
            }
        }
        // team-tinted halves
        for (const i of [0, 1]) {
            const x0 = i === 0 ? FX0 : W / 2, x1 = i === 0 ? W / 2 : FX1;
            const tg = g.createLinearGradient(i === 0 ? FX0 : FX1, 0, W / 2, 0);
            tg.addColorStop(0, T[i].main + '30'); tg.addColorStop(1, T[i].main + '00');
            g.fillStyle = tg; g.fillRect(x0, FY0, x1 - x0, FY1 - FY0);
        }
        g.restore();
        // neon markings
        const line = '#cfe6ff';
        SportMech.neon(g, line, 2, () => {
            g.rect(FX0, FY0, FX1 - FX0, FY1 - FY0);
            g.moveTo(W / 2, FY0); g.lineTo(W / 2, FY1);
            g.moveTo(W / 2 + 52, MY); g.arc(W / 2, MY, 52, 0, Math.PI * 2);
            for (const [x, s] of [[FX0, 1], [FX1, -1]]) {
                g.rect(Math.min(x, x + s * 110), MY - 120, 110, 240);
                g.rect(Math.min(x, x + s * 40), GY0 - 16, 40, GY1 - GY0 + 32);
                g.moveTo(x + s * 110, MY - 34); g.arc(x + s * 110, MY, 34, s > 0 ? -Math.PI / 2 : Math.PI / 2, s > 0 ? Math.PI / 2 : Math.PI * 1.5);
            }
        });
        SportMech.neon(g, SportMech.GOLD, 3, () => { g.arc(W / 2, MY, 4, 0, Math.PI * 2); });
        // goal mouths glow in the defending team's colour
        for (const [x, s, i] of [[FX0, -1, 0], [FX1, 1, 1]]) {
            g.fillStyle = 'rgba(0,0,0,.35)';
            g.fillRect(Math.min(x, x + s * GDEPTH), GY0, GDEPTH, GY1 - GY0);
            SportMech.neon(g, T[i].main, 2.5, () => { g.moveTo(x, GY0); g.lineTo(x, GY1); });
        }
        bgCache = c;
        return c;
    }
    function drawGoal(side, tg) {
        const x = side === 0 ? FX0 : FX1, s = side === 0 ? -1 : 1, bx = x + s * GDEPTH;
        const col = SportMech.TEAM[side].main;
        ctx.save();
        // Top-down energy goal cage
        ctx.fillStyle = 'rgba(10, 14, 22, 0.75)';
        ctx.fillRect(Math.min(x, bx), GY0, GDEPTH, GY1 - GY0);
        // Energy net mesh inside cage
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(tg / 4);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = GY0 + 12; y < GY1; y += 12) {
            ctx.moveTo(x, y); ctx.lineTo(bx, y);
        }
        for (let gx = Math.min(x, bx) + 8; gx < Math.max(x, bx); gx += 8) {
            ctx.moveTo(gx, GY0); ctx.lineTo(gx, GY1);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Armored back and side boundary frames
        ctx.strokeStyle = '#3b4354';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, GY0); ctx.lineTo(bx, GY0); ctx.lineTo(bx, GY1); ctx.lineTo(x, GY1);
        ctx.stroke();

        // Goal posts (top-down circular pylon bases)
        for (const py of [GY0, GY1]) {
            ctx.fillStyle = '#1c202a';
            ctx.beginPath(); ctx.arc(x, py, 6, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#c9d0dc'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(x, py, 2.5, 0, Math.PI * 2); ctx.fill();
        }

        // Glowing goal line
        SportMech.neon(ctx, col, 2.5, () => { ctx.moveTo(x, GY0); ctx.lineTo(x, GY1); });
        ctx.restore();
    }
    function drawShadow(x, y, r, z) {
        SportMech.shadow(ctx, x, y, r, z);
    }
    function drawBall(b) {
        if (Math.hypot(b.vx, b.vy) > 7) SportMech.streak(ctx, b, BR, '#2de2ff', 5);
        SportMech.ball(ctx, b, BR, 'soccer');
    }
    function drawKeeper(side, ky, ball, tg) {
        const x = side === 0 ? FX0 + 16 : FX1 - 16;
        SportMech.drone(ctx, x, ky, KR * 0.85, tg, Math.atan2(ball.y - ky, ball.x - x));
    }
    const MR = 21;   // drawn mech radius
    function drawPlayer(p, i, ball, tg, ch) {
        // charge ring on the floor
        if (ch > 0) {
            const k = Math.min(1, ch / CHARGE_T);
            SportMech.neon(ctx, k >= 1 ? '#ff5d3d' : SportMech.GOLD, 3, () => {
                ctx.arc(p.x, p.y, PR + 8, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
            });
        }
        const spd = Math.hypot(p.vx || 0, p.vy || 0);
        const moving = spd > 0.3;
        let ang;
        if (moving) {
            ang = Math.atan2(p.vy, p.vx);
        } else {
            // face ball if near, else face opponent goal
            const dx = ball.x - p.x, dy = ball.y - p.y;
            if (Math.hypot(dx, dy) < 140) ang = Math.atan2(dy, dx);
            else ang = fwdOf(i) > 0 ? 0 : Math.PI;
        }
        SportMech.mech(ctx, {
            x: p.x, y: p.y, r: MR, i, ang, t: tg,
            moving, weapon: 'soccer',
            charge: ch > 0 ? Math.min(1, ch / CHARGE_T) : 0
        });
    }

    let lastT = performance.now(), tGlobal = 0;
    function render(now) {
        requestAnimationFrame(render);
        let dtf = Math.min(3, (now - lastT) / (1000 / 60));
        lastT = now;
        dtf = FX.time(dtf);
        tGlobal += dtf;
        view.begin(ctx);
        const d = drawState();
        ctx.save();
        FX.applyShake(ctx, dtf);
        ctx.save();
        if (flip()) { ctx.translate(W, 0); ctx.scale(-1, 1); }
        ctx.drawImage(background(), 0, 0, W, H);
        drawGoal(0, tGlobal); drawGoal(1, tGlobal);
        const ball = d ? d.b : { x: W / 2, y: MY, z: 0, vx: 0, vy: 0, vz: 0 };
        drawShadow(ball.x, ball.y, BR, ball.z);
        // y-sort players, keepers and ball
        const items = [];
        const pp = d ? d.p : [mkPlayer(0), mkPlayer(1)];
        const ky = d ? d.k : [MY, MY];
        items.push({ y: pp[0].y, f: () => drawPlayer(pp[0], 0, ball, tGlobal, d ? d.ch[0] : 0) });
        items.push({ y: pp[1].y, f: () => drawPlayer(pp[1], 1, ball, tGlobal, d ? d.ch[1] : 0) });
        items.push({ y: ky[0], f: () => drawKeeper(0, ky[0], ball, tGlobal) });
        items.push({ y: ky[1], f: () => drawKeeper(1, ky[1], ball, tGlobal) });
        items.push({ y: ball.y + 1, f: () => drawBall(ball) });
        items.sort((a, b) => a.y - b.y).forEach((it) => it.f());
        FX.drawParts(ctx, dtf);
        ctx.restore();

        const sx = (x) => (flip() ? W - x : x);
        FX.drawFloats(ctx, dtf, sx);
        if (d) {
            // scoreboard + clock
            const left = flip() ? 1 : 0;
            const secs = Math.max(0, Math.ceil((MATCH_T - d.clk) / 60));
            ctx.save();
            ctx.fillStyle = 'rgba(8,10,20,.82)';
            ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W / 2 - 110, 6, 220, 32, 12) : ctx.rect(W / 2 - 110, 6, 220, 32); ctx.fill();
            ctx.font = '900 20px Orbitron, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = COL[left].ring; ctx.fillText(String(d.sc[left]), W / 2 - 80, 23);
            ctx.fillStyle = COL[1 - left].ring; ctx.fillText(String(d.sc[1 - left]), W / 2 + 80, 23);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(d.gg ? 'GOLDEN' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, W / 2, 23);
            ctx.restore();
            if (d.ph === 'kick') {
                const mineKo = d.ko === M.idx;
                ctx.save();
                ctx.font = '800 20px "Plus Jakarta Sans", sans-serif'; ctx.textAlign = 'center';
                ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(5,8,20,.75)';
                const n = Math.ceil((KICK_T - d.pt) / 24);
                const txt = L(mineKo ? 'ko_me' : 'ko_opp') + (n > 0 ? ` · ${n}` : '');
                ctx.strokeText(txt, W / 2, MY - 70); ctx.fillStyle = '#ffffff'; ctx.fillText(txt, W / 2, MY - 70);
                ctx.restore();
            }
        }
        FX.drawFlash(ctx, W, H, dtf);
        ctx.restore();
    }
    requestAnimationFrame(render);

    // ==========================================================
    // Test hooks
    // ==========================================================
    GameBot.expose({
        state: () => S, net: () => M.net, me: () => me,
        freezeBot(v) { botFrozen = v; },
        autoplay(lv) { autoHost = lv ? mkBrain(0, lv) : null; },
        setBall(x, y, vx, vy, z, vz) { if (!S) return; S.ph = 'play'; S.pt = 0; Object.assign(S.b, { x, y, vx, vy, z: z || 0, vz: vz || 0 }); hist.clear(); },
        place(i, x, y) { const p = i === 1 && GameBot.enabled ? botP : S.p[i]; Object.assign(p, { x, y, vx: 0, vy: 0 }); if (i === 1) Object.assign(S.p[1], { x, y, vx: 0, vy: 0 }); },
        skipKickoff() { if (S && S.ph === 'kick') S.pt = KICK_T - 1; },
        setClock(f) { if (S) S.clk = f; },
        setRtt(ms) { M.rtt = ms; },
        kick(pw) { kickQueued = pw; },
        armKick, ballStep, hist: () => hist.buf,
        C: { W, H, FX0, FX1, FY0, FY1, MY, GY0, GY1, GZ, PR, BR, REACH, WIN_GOALS, MATCH_T }
    });
});
