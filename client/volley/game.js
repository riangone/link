/**
 * Link Volley — 机甲排球: 1v1 realtime top-down volleyball.
 *
 * Built on scripts/sport-kit.js and scripts/sport-mech.js in the same
 * visual language as Link Armor and Link Spin: pure top-down camera,
 * dark steel arena, team neon accents (P1 magenta / P2 cyan), glowing
 * plasma energy ball, and top-down armored battle mechs.
 *
 * Rules:
 *   - The ball must clear the center laser net (x = NET_X).
 *   - If the ball lands (z <= 0) on your half-court, the rival scores.
 *   - Move in 2D on your side with drag or WASD / arrow keys.
 *   - Tap or Space to jump/spike when near the ball.
 *   - First to WIN_SCORE points wins.
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    if (!location.hash || location.hash.length <= 1) {
        location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    }
    const L = VolleyI18n.t;
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    // ==========================================================
    // Constants
    // ==========================================================
    const W = 800, H = 450;
    const FX0 = 54, FX1 = W - 54, FY0 = 46, FY1 = H - 26;
    const MY = (FY0 + FY1) / 2;
    const NET_X = W / 2, NET_HW = 6, NET_H = 34;
    const PR = 22;                      // player chassis collision radius
    const BR = 13;                      // ball radius
    const GROUND = 410, GY = 376;       // for test hook compatibility
    const G_BALL = 0.28, G_PL = 0.58;
    const JUMP_VZ = 9.8, RUN = 4.6;
    const WALL_E = 0.85, NET_E = 0.65;
    const WIN_SCORE = 7;
    const SERVE_T = 70, POINT_T = 90;
    const SERVE_X = [160, W - 160];
    const START_X = [180, W - 180];
    const COL = SportMech.TEAM;

    const { clamp, rnd, r1, num } = SportKit;
    const fwdOf = (i) => (i === 0 ? 1 : -1);
    const minX = (i) => (i === 0 ? FX0 + PR : NET_X + NET_HW + PR);
    const maxX = (i) => (i === 0 ? NET_X - NET_HW - PR : FX1 - PR);
    const minY = () => FY0 + PR;
    const maxY = () => FY1 - PR;

    // ==========================================================
    // Ball physics (3D: x, y on court, z is height above floor)
    // ==========================================================
    function ballStep(b, hit) {
        b.vz = (b.vz || 0) - G_BALL;
        b.x += b.vx;
        b.y += b.vy;
        b.z = (b.z || 0) + b.vz;

        // Outer court walls (X)
        if (b.x < FX0 + BR) {
            b.x = FX0 + BR; b.vx = Math.abs(b.vx) * WALL_E; if (hit) hit.wall = 1;
        } else if (b.x > FX1 - BR) {
            b.x = FX1 - BR; b.vx = -Math.abs(b.vx) * WALL_E; if (hit) hit.wall = 1;
        }
        // Outer court walls (Y)
        if (b.y < FY0 + BR) {
            b.y = FY0 + BR; b.vy = Math.abs(b.vy) * WALL_E; if (hit) hit.wall = 1;
        } else if (b.y > FY1 - BR) {
            b.y = FY1 - BR; b.vy = -Math.abs(b.vy) * WALL_E; if (hit) hit.wall = 1;
        }

        // Center Laser Net at NET_X
        if (b.z < NET_H && Math.abs(b.x - NET_X) < BR + NET_HW && b.y >= FY0 && b.y <= FY1) {
            const side = b.vx > 0 ? -1 : 1;
            b.x = NET_X + side * (BR + NET_HW);
            b.vx = -b.vx * NET_E;
            if (hit) hit.net = Math.abs(b.vx);
        }

        b.spin = (b.spin || 0) + (b.vx + b.vy) * 0.02;

        // Floor contact
        if (b.z <= 0) {
            b.z = 0;
            return true;
        }
        return false;
    }

    /** Run the ball ahead until it touches the floor (z <= 0). */
    function predictLanding(b0, maxSteps) {
        const c = { x: b0.x, y: b0.y, z: b0.z || 0, vx: b0.vx, vy: b0.vy, vz: b0.vz || 0 };
        const lim = maxSteps || 200;
        for (let t = 1; t <= lim; t++) {
            if (ballStep(c)) return { x: c.x, y: c.y, t };
        }
        return { x: c.x, y: c.y, t: lim };
    }

    // ==========================================================
    // Players (2D movement on court half + jump z)
    // ==========================================================
    function mkPlayer(i) {
        return {
            x: START_X[i], y: MY, z: 0,
            vx: 0, vy: 0, vz: 0,
            sw: 0, hc: 0, land: 0
        };
    }

    /** ctl: {mx, my, tx, ty, jump}. Returns 'jump'|'swing'|null. */
    function simPlayer(p, i, ctl) {
        let out = null;
        const run = RUN * (ctl.sp || 1);

        let vx = 0, vy = 0;
        if (ctl.tx !== null && ctl.tx !== undefined && ctl.ty !== null && ctl.ty !== undefined) {
            const dx = ctl.tx - p.x, dy = ctl.ty - p.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 2) {
                const s = Math.min(run, dist * 0.35);
                vx = (dx / dist) * s;
                vy = (dy / dist) * s;
            }
        } else {
            vx = clamp(ctl.mx || 0, -1, 1) * run;
            vy = clamp(ctl.my || 0, -1, 1) * run;
        }

        p.x = clamp(p.x + vx, minX(i), maxX(i));
        p.y = clamp(p.y + vy, minY(), maxY());
        p.vx = vx;
        p.vy = vy;

        const grounded = (p.z || 0) <= 0.1;
        if (ctl.jump) {
            if (grounded) {
                p.vz = JUMP_VZ;
                p.z = 1;
                out = 'jump';
            } else if (p.sw === 0) {
                p.sw = 14;
                out = 'swing';
            }
        }

        if (!grounded || p.vz > 0) {
            p.vz = (p.vz || 0) - G_PL;
            p.z = Math.max(0, (p.z || 0) + p.vz);
            if (p.z <= 0) {
                p.z = 0;
                p.vz = 0;
                p.land = 8;
            }
        }

        if (p.sw > 0) p.sw--;
        if (p.land > 0) p.land--;
        return out;
    }

    // ==========================================================
    // Audio / FX / View
    // ==========================================================
    const Sfx = SportKit.sfx('volley-muted');
    Sfx.bindMute(document.getElementById('mute-btn'));
    Sfx.bump = () => { Sfx.tone(420, 0.09, 'sine', 0.22, 260); Sfx.noise(0.05, 1200, 2, 0.15); };
    Sfx.spike = () => { Sfx.noise(0.25, 2400, 0.8, 0.35); Sfx.tone(160, 0.25, 'square', 0.12, 60); };
    Sfx.jump = () => Sfx.tone(300, 0.12, 'triangle', 0.08, 620);
    Sfx.swing = () => Sfx.noise(0.1, 3000, 1.5, 0.12);
    Sfx.net = () => Sfx.noise(0.18, 300, 1, 0.3, 'lowpass');
    Sfx.sand = () => Sfx.noise(0.3, 500, 0.7, 0.35, 'lowpass');
    const FX = SportKit.fx();

    const view = GameFit.view(canvas, { width: W, height: H, rotate: 'auto' });

    // ==========================================================
    // Match shell
    // ==========================================================
    let S = null, hostLoop = null, matchId = 0;
    let me = mkPlayer(1);
    const emit = SportKit.emitter(fx);
    const M = SportKit.match({
        game: 'volley', L, sfx: Sfx, effects: FX, W, H,
        startMatch, stopHost() { clearInterval(hostLoop); }, hostOver: () => !S || S.ph === 'over',
        broadcast, onInput, onEvent: fx,
        onNewMatch() { me = mkPlayer(1); },
        onGameOver() { pointers.clear(); touchTarget = null; }
    });
    const flip = () => M.flip();
    const toCanonX = (vx) => (flip() ? W - vx : vx);

    // ==========================================================
    // Input
    // ==========================================================
    const keys = {};
    let jumpQueued = false, touchTarget = null;
    const joy = { x: 0, y: 0, active: false };
    const JUMP_KEYS = [' ', 'w', 'arrowup', 'j'];

    window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        const k = e.key.toLowerCase();
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
        Sfx.init();
        if (e.repeat) return;
        keys[k] = true;
        if (['a', 'd', 'w', 's', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) touchTarget = null;
        if (JUMP_KEYS.includes(k) && inMatch()) jumpQueued = true;
        if (k === 'k' && inMatch()) {
            const meRef = M.role === 'host' ? (S ? S.p[0] : null) : me;
            if (meRef && (meRef.z || 0) > 2) meRef.sw = 14;
            else jumpQueued = true;
        }
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

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
                if (active) touchTarget = null;
            },
            onAction: (action, down) => {
                if (!inMatch() || !down) return;
                if (action === 'jump') {
                    jumpQueued = true;
                } else if (action === 'spike') {
                    const meRef = M.role === 'host' ? (S ? S.p[0] : null) : me;
                    if (meRef && (meRef.z || 0) > 2) {
                        meRef.sw = 14;
                    } else {
                        jumpQueued = true;
                    }
                }
            }
        });
    }

    const dragArea = canvas.closest('.gf-box') || canvas;
    const pointers = new Map();
    const logicalPos = (e) => {
        const v = view.toLogical(e.clientX, e.clientY);
        return { x: toCanonX(v.x), y: v.y };
    };

    dragArea.addEventListener('pointerdown', (e) => {
        if (e.target.closest && e.target.closest('.overlay:not(.hidden)')) return;
        Sfx.init();
        if (!inMatch()) return;
        if (e.pointerType === 'touch') e.preventDefault();
        const p = logicalPos(e);
        if (pointers.size > 0) jumpQueued = true;
        pointers.set(e.pointerId, { x0: p.x, y0: p.y, t0: performance.now(), moved: false });
        touchTarget = p;
        try { dragArea.setPointerCapture(e.pointerId); } catch (err) {}
    });
    dragArea.addEventListener('pointermove', (e) => {
        const ptr = pointers.get(e.pointerId);
        if (!ptr) {
            if (e.pointerType === 'mouse' && inMatch()) touchTarget = logicalPos(e);
            return;
        }
        const p = logicalPos(e);
        if (Math.hypot(p.x - ptr.x0, p.y - ptr.y0) > 10) ptr.moved = true;
        touchTarget = p;
    });
    function endPointer(e) {
        const ptr = pointers.get(e.pointerId);
        if (!ptr) return;
        pointers.delete(e.pointerId);
        const quick = performance.now() - ptr.t0 < 250;
        if (e.type === 'pointerup' && quick && !ptr.moved && inMatch()) {
            jumpQueued = true;
        }
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
        const jump = jumpQueued;
        jumpQueued = false;
        return {
            mx, my,
            tx: (joy.active || mx || my) ? null : (touchTarget ? touchTarget.x : null),
            ty: (joy.active || mx || my) ? null : (touchTarget ? touchTarget.y : null),
            jump
        };
    }

    // ==========================================================
    // Host simulation
    // ==========================================================
    const hist = SportKit.history(16);

    function startMatch() {
        matchId++;
        S = {
            mid: matchId, ph: 'serve', pt: 0, sc: [0, 0], sv: Math.random() < 0.5 ? 0 : 1,
            b: { x: 0, y: MY, z: 28, vx: 0, vy: 0, vz: 0, spin: 0 },
            p: [mkPlayer(0), mkPlayer(1)],
            touch: 0, last: -1, rally: 0, evId: 0, events: [], winner: -1
        };
        if (GameBot.enabled) { botP = mkPlayer(1); bot = mkBrain(1, GameBot.level); }
        placeServe();
        clearInterval(hostLoop);
        hostLoop = setInterval(hostTick, 1000 / 60);
        M.started(S.sc);
        M.showToast(L('toast_serve'), 3600);
        broadcast();
    }

    function placeServe() {
        const b = S.b;
        b.x = SERVE_X[S.sv];
        b.y = MY;
        b.z = 32;
        b.vx = 0; b.vy = 0; b.vz = 0;
        S.ph = 'serve'; S.pt = 0; S.touch = 0; S.last = -1;
        hist.clear();
        emit(S, { k: 'serve', i: S.sv });
    }

    function hostTick() {
        if (!S || S.ph === 'over') return;
        const r0 = simPlayer(S.p[0], 0, autoHost ? think(autoHost, S.p[0]) : localCtl());
        if (r0) playerFx(0, r0);
        if (GameBot.enabled && !botFrozen) botStep();

        const p1 = S.p[1];
        if (p1.sw > 0) p1.sw--;
        if (p1.hc > 0) p1.hc--;
        if (S.p[0].hc > 0) S.p[0].hc--;

        if (S.ph === 'serve') {
            S.b.z = 30 + Math.sin(S.pt / 8) * 4;
            if (++S.pt >= SERVE_T) {
                S.ph = 'play'; S.pt = 0;
                S.b.vx = fwdOf(S.sv) * 5.6;
                S.b.vy = rnd(-1.0, 1.0);
                S.b.vz = 9.6;
            }
        } else if (S.ph === 'play') {
            S.pt++;
            const hit = {};
            const landed = ballStep(S.b, hit);
            if (hit.net > 1.2) emit(S, { k: 'net', x: r1(S.b.x), y: r1(S.b.y) });
            hist.push({ x: S.b.x, y: S.b.y, z: S.b.z });
            if (landed) {
                onLand();
            } else {
                tryHit(0, false);
                tryHit(1, !GameBot.enabled);
            }
        } else if (S.ph === 'point') {
            if (++S.pt >= POINT_T) {
                if (S.sc[0] >= WIN_SCORE || S.sc[1] >= WIN_SCORE) {
                    S.ph = 'over';
                    S.winner = S.sc[0] > S.sc[1] ? 0 : 1;
                    broadcast();
                    M.gameOver(S.sc);
                    return;
                }
                placeServe();
            }
        }
        if (S.ph !== 'over' && (S.pt & 1) === 0) broadcast();
    }

    function onLand() {
        const b = S.b;
        const scorer = b.x < NET_X ? 1 : 0;
        S.sc[scorer]++;
        S.sv = scorer;
        S.ph = 'point'; S.pt = 0;
        b.vx = 0; b.vy = 0; b.vz = 0;
        emit(S, { k: 'point', i: scorer, x: r1(b.x), y: r1(b.y), sc: S.sc.slice() });
        M.score(S.sc);
    }

    function tryHit(i, lagComp) {
        const p = S.p[i], b = S.b;
        if (p.hc > 0) return;
        const reach2D = PR + BR + 12;
        let src = null;
        if (Math.hypot(b.x - p.x, b.y - p.y) < reach2D && (b.z || 0) < 68) {
            src = b;
        } else if (lagComp) {
            src = hist.lagScan(M.rtt, (h) => {
                const dist = h.z !== undefined ? Math.hypot(h.x - p.x, h.y - p.y) : Math.abs(h.x - p.x);
                return dist < reach2D;
            });
            if (src && (b.x - NET_X) * fwdOf(i) > BR) src = null;
        }
        if (src) hitBall(i, src);
    }

    function hitBall(i, src) {
        const p = S.p[i], b = S.b, fwd = fwdOf(i);
        const airborne = (p.z || 0) > 4;
        const highBall = (b.z || 0) > 22;
        let kind = 'bump';

        if ((p.sw > 0 || airborne) && highBall) {
            kind = 'spike';
            b.vx = fwd * rnd(8.5, 11.0);
            b.vy = clamp((MY - b.y) * 0.08 + rnd(-2.2, 2.2), -5, 5);
            const dxNet = Math.abs(b.x - NET_X);
            const tNet = Math.max(1, dxNet / Math.abs(b.vx));
            const minVz = (NET_H + 10 - (b.z || 0) + 0.5 * G_BALL * tNet * tNet) / tNet;
            b.vz = dxNet < 45 ? -1.5 : Math.max(minVz, -0.5);
            p.sw = 0;
        } else {
            kind = 'bump';
            b.vx = fwd * rnd(5.2, 6.8) + p.vx * 0.3;
            b.vy = clamp((MY - b.y) * 0.05 + p.vy * 0.4 + rnd(-1.5, 1.5), -4, 4);
            b.vz = rnd(8.5, 10.5);
        }

        // Separate ball from player
        const dx = b.x - p.x, dy = b.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        b.x = clamp(p.x + (dx / d) * (PR + BR + 2), FX0 + BR, FX1 - BR);
        b.y = clamp(p.y + (dy / d) * (PR + BR + 2), FY0 + BR, FY1 - BR);

        p.hc = 12;
        S.touch = S.last === i ? S.touch + 1 : 1;
        S.last = i;
        S.rally++;
        emit(S, { k: kind, i, x: r1(b.x), y: r1(b.y) });
    }

    function broadcast() {
        if (!S) return;
        const b = S.b;
        M.send({
            type: 'state', mid: S.mid, ph: S.ph, pt: S.pt, sc: S.sc, sv: S.sv,
            b: [r1(b.x), r1(b.y), r1(b.z || 0), r1(b.vx), r1(b.vy), r1(b.vz || 0), Math.round((b.spin || 0) * 100) / 100],
            p: S.p.map((q) => [r1(q.x), r1(q.y), r1(q.z || 0), r1(q.vx), r1(q.vy), q.sw]),
            ev: S.events.slice(-8)
        });
    }

    // ==========================================================
    // Bot
    // ==========================================================
    const BOT_LV = {
        easy:   { sp: 0.65, react: 14, spike: 0.25 },
        normal: { sp: 0.85, react: 7,  spike: 0.65 },
        hard:   { sp: 1.0,  react: 2,  spike: 0.95 }
    };
    function mkBrain(i, lv) {
        return { i, B: BOT_LV[lv] || BOT_LV.normal, timer: 0, tx: START_X[i], ty: MY };
    }
    function think(br, me) {
        const b = S.b, i = br.i, fwd = fwdOf(i), B = br.B;
        const homeX = i === 0 ? FX0 + 120 : FX1 - 120;
        const mine = (x) => (x - NET_X) * fwd < -NET_HW;
        let jump = false;

        if (--br.timer <= 0) {
            br.timer = B.react;
            if (S.ph === 'serve' && S.sv === i) {
                br.tx = SERVE_X[i] - fwd * 8;
                br.ty = MY;
            } else if (S.ph === 'play') {
                const land = predictLanding(b, 160);
                if (land && mine(land.x)) {
                    br.tx = land.x - fwd * 8;
                    br.ty = land.y;
                    if (Math.hypot(b.x - me.x, b.y - me.y) < PR + BR + 20 && (b.z || 0) > 20 && Math.random() < B.spike) {
                        jump = true;
                    }
                } else {
                    br.tx = homeX;
                    br.ty = MY;
                }
            }
        }
        return { tx: br.tx, ty: br.ty, jump, sp: B.sp };
    }

    let bot = null, botP = null, botFrozen = false, autoHost = null;
    function botStep() {
        if (!bot || !botP || S.ph === 'over') return;
        const r1 = simPlayer(botP, 1, think(bot, botP));
        S.p[1].x = botP.x; S.p[1].y = botP.y; S.p[1].z = botP.z;
        S.p[1].vx = botP.vx; S.p[1].vy = botP.vy;
        if (r1) playerFx(1, r1);
    }

    // ==========================================================
    // Client extrapolation
    // ==========================================================
    function onInput(msg) {
        if (!S) return;
        const p1 = S.p[1];
        if (num(msg.x)) p1.x = clamp(msg.x, minX(1), maxX(1));
        if (num(msg.y)) p1.y = clamp(msg.y, minY(), maxY());
        if (num(msg.z)) p1.z = Math.max(0, msg.z);
        if (num(msg.vx)) p1.vx = msg.vx;
        if (num(msg.vy)) p1.vy = msg.vy;
        if (msg.jump) {
            if ((p1.z || 0) <= 0.1) { p1.vz = JUMP_VZ; p1.z = 1; playerFx(1, 'jump'); }
            else if (p1.sw === 0) { p1.sw = 14; playerFx(1, 'swing'); }
        }
    }

    function inMatch() {
        const d = M.role === 'host' ? S : M.net;
        return !!d && d.ph !== 'over' && !M.overlayUp();
    }

    function playerFx(i, kind) {
        if (kind === 'jump') { Sfx.jump(); FX.burst(S.p[i].x, S.p[i].y, 8, COL[i].main, 2.5, 20, 3); }
        else if (kind === 'swing') Sfx.swing();
    }

    function fx(e) {
        if (e.k === 'bump') {
            Sfx.bump();
            FX.burst(e.x, e.y, 12, COL[e.i].glow, 3, 20, 3);
            FX.float('BUMP!', e.x, e.y - 12, COL[e.i].main, 20);
        } else if (e.k === 'spike') {
            Sfx.spike();
            FX.shake = 8;
            FX.burst(e.x, e.y, 24, '#ffd34d', 5, 30, 4);
            FX.float('SPIKE!!', e.x, e.y - 16, '#ffd34d', 24);
        } else if (e.k === 'net') {
            Sfx.net();
            FX.burst(e.x, e.y, 14, '#9bdcff', 3, 20, 3);
        } else if (e.k === 'point') {
            Sfx.sand();
            FX.burst(e.x, e.y, 18, COL[e.i].main, 3.5, 30, 3);
            FX.float('POINT!', e.x, e.y - 14, COL[e.i].main, 22);
        }
    }

    // Client stepping
    let lastClientT = performance.now();
    setInterval(() => {
        if (M.role !== 'client' || !inMatch()) return;
        const now = performance.now();
        lastClientT = now;
        simPlayer(me, 1, localCtl());
        M.send({
            type: 'input', x: r1(me.x), y: r1(me.y), z: r1(me.z || 0),
            vx: r1(me.vx), vy: r1(me.vy), jump: jumpQueued
        });
    }, 1000 / 60);

    function drawState() {
        if (M.role === 'host') return S;
        const n = M.net;
        if (!n) return null;
        const f = M.age();
        return {
            ph: n.ph, pt: n.pt, sc: n.sc, sv: n.sv,
            b: {
                x: n.b[0] + n.b[3] * f,
                y: n.b[1] + n.b[4] * f,
                z: Math.max(0, n.b[2] + (n.b[5] || 0) * f),
                vx: n.b[3], vy: n.b[4], vz: n.b[5] || 0,
                spin: n.b[6] || 0
            },
            p: [
                { x: n.p[0][0] + n.p[0][3] * f, y: n.p[0][1] + n.p[0][4] * f, z: n.p[0][2], vx: n.p[0][3], vy: n.p[0][4], sw: n.p[0][5] },
                me
            ]
        };
    }

    // ==========================================================
    // Top-down Renderer
    // ==========================================================
    let bgCache = null;
    function background() {
        if (bgCache) return bgCache;
        const c = document.createElement('canvas');
        c.width = W * 2; c.height = H * 2;
        const g = c.getContext('2d');
        g.scale(2, 2);

        // Outer steel deck, hazard border on all four sides
        SportMech.steel(g, 0, 0, W, H, { top: '#181c28', bot: '#0d1017', plate: 48 });
        SportMech.rim(g, FX0, FY0, FX1, FY1);

        // Armored court pitch with hex pattern
        const pg = g.createLinearGradient(0, FY0, 0, FY1);
        pg.addColorStop(0, '#131826'); pg.addColorStop(1, '#1b2336');
        g.fillStyle = pg;
        g.fillRect(FX0, FY0, FX1 - FX0, FY1 - FY0);

        g.save();
        g.beginPath(); g.rect(FX0, FY0, FX1 - FX0, FY1 - FY0); g.clip();
        g.strokeStyle = 'rgba(140,170,220,0.07)'; g.lineWidth = 1;
        const hr = 14, hw = hr * Math.sqrt(3);
        for (let row = 0, y = FY0; y < FY1 + hr; row++, y += hr * 1.5) {
            for (let x = FX0 + (row % 2) * hw / 2; x < FX1 + hw; x += hw) {
                g.beginPath();
                for (let k = 0; k < 6; k++) {
                    const a = Math.PI / 6 + k * Math.PI / 3;
                    g.lineTo(x + Math.cos(a) * hr, y + Math.sin(a) * hr);
                }
                g.closePath(); g.stroke();
            }
        }

        // Team-tinted halves
        for (const i of [0, 1]) {
            const x0 = i === 0 ? FX0 : NET_X, x1 = i === 0 ? NET_X : FX1;
            const tg = g.createLinearGradient(i === 0 ? FX0 : FX1, 0, NET_X, 0);
            tg.addColorStop(0, COL[i].main + '2b'); tg.addColorStop(1, COL[i].main + '00');
            g.fillStyle = tg; g.fillRect(x0, FY0, x1 - x0, FY1 - FY0);
        }
        g.restore();

        // Neon court lines
        SportMech.neon(g, '#cfe6ff', 2, () => {
            g.rect(FX0, FY0, FX1 - FX0, FY1 - FY0);
            g.moveTo(FX0 + 110, FY0); g.lineTo(FX0 + 110, FY1);
            g.moveTo(FX1 - 110, FY0); g.lineTo(FX1 - 110, FY1);
        });

        bgCache = c;
        return c;
    }

    function drawNet(tg) {
        // Pure top-down laser net across NET_X
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(155, 220, 255, 0.22)';
        ctx.fillRect(NET_X - 3, FY0, 6, FY1 - FY0);

        ctx.strokeStyle = '#9bdcff'; ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.4 + 0.2 * Math.sin(tg / 3);
        const off = (tg * 0.8) % 8;
        ctx.beginPath();
        for (let y = FY0 + off; y <= FY1; y += 8) {
            ctx.moveTo(NET_X - 12, y); ctx.lineTo(NET_X + 12, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        SportMech.neon(ctx, '#9bdcff', 3, () => {
            ctx.moveTo(NET_X, FY0); ctx.lineTo(NET_X, FY1);
        });

        // Top-down emitter pylons
        for (const py of [FY0, FY1]) {
            ctx.fillStyle = '#1c202a';
            ctx.beginPath(); ctx.arc(NET_X, py, 7.5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#8a93a6'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#9bdcff'; ctx.shadowColor = '#9bdcff'; ctx.shadowBlur = 8;
            ctx.beginPath(); ctx.arc(NET_X, py, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }

    function drawShadow(x, y, r, z) {
        SportMech.shadow(ctx, x, y, r, z);
    }

    function drawBall(b) {
        const z = b.z || 0;
        if (Math.hypot(b.vx, b.vy) > 7) SportMech.streak(ctx, b, BR, '#ffd34d', 5);
        SportMech.ball(ctx, b, BR, 'volley');
    }

    function drawLandingRing(d, tg) {
        if (d.ph !== 'play') return;
        const land = predictLanding(d.b, 200);
        if (!land) return;
        const side = land.x < NET_X ? 0 : 1;
        const pulse = 1 + Math.sin(tg / 5) * 0.08;
        const urgency = clamp(1 - land.t / 100, 0.25, 1);
        ctx.save();
        ctx.strokeStyle = COL[side].ring;
        ctx.globalAlpha = 0.5 + urgency * 0.45;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([7, 5]); ctx.lineDashOffset = -tg;
        ctx.beginPath(); ctx.arc(land.x, land.y, 22 * pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COL[side].ring;
        ctx.globalAlpha *= 0.2;
        ctx.beginPath(); ctx.arc(land.x, land.y, 22 * pulse * urgency, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    function drawPlayer(p, i, ball, tg) {
        const moving = Math.hypot(p.vx || 0, p.vy || 0) > 0.3;
        let ang;
        const dx = ball.x - p.x, dy = ball.y - p.y;
        if (Math.hypot(dx, dy) < 160) ang = Math.atan2(dy, dx);
        else ang = fwdOf(i) > 0 ? 0 : Math.PI;

        const air = (p.z || 0) > 2;
        SportMech.mech(ctx, {
            x: p.x, y: p.y, z: p.z || 0, r: PR, i, ang, t: tg,
            moving, air, weapon: 'volley',
            charge: p.sw > 0 ? 0.8 : 0
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
        drawNet(tGlobal);

        if (d) {
            drawLandingRing(d, tGlobal);
            drawShadow(d.b.x, d.b.y, BR, d.b.z || 0);
            drawPlayer(d.p[0], 0, d.b, tGlobal);
            drawPlayer(d.p[1], 1, d.b, tGlobal);
            drawBall(d.b);
        } else {
            drawPlayer(mkPlayer(0), 0, { x: NET_X, y: MY }, tGlobal);
            drawPlayer(mkPlayer(1), 1, { x: NET_X, y: MY }, tGlobal);
        }
        FX.drawParts(ctx, dtf);
        ctx.restore();

        const sx = (x) => (flip() ? W - x : x);
        FX.drawFloats(ctx, dtf, sx);

        if (d) {
            // Scoreboard at top
            ctx.save();
            ctx.font = '900 28px Orbitron, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillStyle = 'rgba(10, 14, 24, 0.82)';
            ctx.fillRect(W / 2 - 90, 8, 180, 36);
            ctx.strokeStyle = '#384259'; ctx.lineWidth = 1.5;
            ctx.strokeRect(W / 2 - 90, 8, 180, 36);

            const left = flip() ? 1 : 0;
            const txt = `${d.sc[left]}  :  ${d.sc[1 - left]}`;
            ctx.fillStyle = '#ffffff';
            ctx.fillText(txt, W / 2, 12);
            ctx.restore();

            if (d.ph === 'serve') {
                const mineServe = d.sv === M.idx;
                ctx.save();
                ctx.font = '800 16px "Plus Jakarta Sans", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = mineServe ? SportMech.GOLD : '#9fb3d9';
                const n = Math.ceil((SERVE_T - d.pt) / 24);
                ctx.fillText(L(mineServe ? 'serve_me' : 'serve_opp') + (n > 0 ? ` · ${n}` : ''), sx(SERVE_X[d.sv]), MY - 60);
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
        state: () => S,
        net: () => M.net,
        me: () => me,
        freezeBot(v) { botFrozen = v; },
        autoplay(lv) { autoHost = lv ? mkBrain(0, lv) : null; },
        hist: () => hist.buf,
        setBall(x, y, vx, vy) {
            if (!S) return;
            S.ph = 'play'; S.pt = 0;
            // Handle both legacy (x, y_altitude, vx, vy) and (x, y, vx, vy)
            let z = 24, vy_val = vy, vz_val = 0;
            if (y >= 100) {
                z = Math.max(0, GROUND - y);
                vz_val = -vy;
                vy_val = 0;
            }
            Object.assign(S.b, { x, y: MY, z, vx: vx || 0, vy: vy_val || 0, vz: vz_val });
            hist.clear();
        },
        place(i, x, y) {
            const p = i === 1 && GameBot.enabled ? botP : S.p[i];
            p.x = x;
            p.y = (y === undefined || y === GY) ? MY : y;
            p.z = 0; p.vx = 0; p.vy = 0; p.vz = 0;
            if (i === 1) { S.p[1].x = p.x; S.p[1].y = p.y; S.p[1].z = p.z; }
        },
        skipServe() { if (S && S.ph === 'serve') S.pt = SERVE_T - 1; },
        setRtt(ms) { M.rtt = ms; },
        jump() { jumpQueued = true; },
        tryHit, predictLanding, ballStep,
        C: { W, H, GROUND, NET_X, NET_TOP: 262, PR, BR, GY, WIN_SCORE, SERVE_X }
    });
});
