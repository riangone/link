/**
 * Link Hoops — 机甲篮球: 1v1 realtime top-down basketball.
 *
 * Built on scripts/sport-kit.js and scripts/sport-mech.js in the same
 * visual language as Link Armor and Link Spin: pure top-down camera,
 * dark steel arena, team neon accents (P1 magenta / P2 cyan), glowing
 * plasma basketball, and top-down armored battle mechs.
 *
 * Controls:
 *   - Drag or WASD / arrow keys to navigate the 2D court.
 *   - Tap or Space to jump/shoot; close to the rim = TURBO SLAM DUNK.
 *   - Outside 3-point line = 3 points, inside = 2 points.
 *   - Defense: touch free balls to steal/rebound, jump to contest or block.
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    if (!location.hash || location.hash.length <= 1) location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    const { clamp, rnd, r1, num } = SportKit;
    const L = HoopsI18n.t;
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    // ==========================================================
    // Constants
    // ==========================================================
    const W = 800, H = 450;
    const FX0 = 46, FX1 = W - 46, FY0 = 46, FY1 = H - 26;
    const MY = (FY0 + FY1) / 2;
    const PR = 22, BR = 12;
    const RIM_Y = MY, RIM_HW = 18, RIM_R = 3;
    const RIM_Z = 24;                  // rim height above the floor
    const REACH_Z = 40;                // how far above its own height a mech can touch the ball
    const RIM_X = [W - 96, 96];        // hoop that seat i attacks
    const BOARD_X = [W - 62, 62], BOARD_TOP = MY - 36, BOARD_BOT = MY + 36, BOARD_HW = 5;
    const THREE = 240;                 // distance from rim for a 3
    const DUNK_R = 78;
    const WIN_SCORE = 11, CHECK_T = 60, SCORE_T = 80;
    const STEAL_P = 0.03, POSS_CD = 40, PICK_CD = 18;
    const SHOT_T = 14;
    const G_BALL = 0.3, G_PL = 0.6, JUMP_V = -12.2, RUN = 4.8;
    const COL = SportMech.TEAM;
    const fwdOf = (i) => (i === 0 ? 1 : -1);
    const hand = (p, f) => ({
        x: p.x + (f !== undefined ? f : p.face) * (PR + 8),
        y: p.y,
        z: (p.z || 0) + 10
    });

    // ==========================================================
    // Ball physics (3D: x, y on court, z is height)
    // ==========================================================
    function boardCollide(b, bx, hit) {
        if ((b.z || 0) > RIM_Z - 8 && Math.abs(b.x - bx) < BR + BOARD_HW && b.y >= BOARD_TOP && b.y <= BOARD_BOT) {
            b.x = bx + (b.x < bx ? -1 : 1) * (BR + BOARD_HW);
            b.vx = -b.vx * 0.7;
            if (hit) hit.board = 1;
        }
    }
    function rimCollide(b, rx, ry, hit) {
        if (Math.abs((b.z || 0) - RIM_Z) > BR * 0.7) return;
        const dx = b.x - rx, dy = b.y - ry, d = Math.hypot(dx, dy);
        // A ball falling downwards through the rim opening is going in — do not deflect it
        if ((b.vz || 0) < 0 && d < RIM_HW - 2) return;
        if (d >= BR + RIM_HW || d < 1e-3) return;
        if (d > RIM_HW - BR) {
            const nx = dx / d, ny = dy / d;
            b.x = rx + nx * (RIM_HW + BR);
            b.y = ry + ny * (RIM_HW + BR);
            b.vx = -b.vx * 0.65;
            b.vy = -b.vy * 0.65;
            if (hit) hit.rim = 1;
        }
    }
    /** One step of a free ball. Returns 0|1 = basket for that seat, or -1. */
    function ballStep(b, hit) {
        const pz = b.z || 0;
        b.vz = (b.vz || 0) - G_BALL;
        b.x += b.vx;
        b.y += b.vy;
        b.z = (b.z || 0) + b.vz;
        if (b.z > 0) {
            b.vx *= 0.999;
            b.vy *= 0.999;
        }

        // Boundaries
        if (b.x < FX0 + BR) { b.x = FX0 + BR; b.vx = Math.abs(b.vx) * 0.7; }
        else if (b.x > FX1 - BR) { b.x = FX1 - BR; b.vx = -Math.abs(b.vx) * 0.7; }
        if (b.y < FY0 + BR) { b.y = FY0 + BR; b.vy = Math.abs(b.vy) * 0.7; }
        else if (b.y > FY1 - BR) { b.y = FY1 - BR; b.vy = -Math.abs(b.vy) * 0.7; }

        // Floor bounce
        if (b.z <= 0) {
            b.z = 0;
            if ((b.vz || 0) < -1.5) {
                if (hit) hit.floor = Math.abs(b.vz);
                b.vz = -b.vz * 0.68;
            } else {
                b.vz = 0;
            }
            b.vx *= 0.94;
            b.vy *= 0.94;
        }

        let made = -1;
        for (const i of [0, 1]) {
            boardCollide(b, BOARD_X[i], hit);
            const rx = RIM_X[i];
            const dx = b.x - rx, dy = b.y - MY;
            if (pz >= RIM_Z && b.z < RIM_Z && (b.vz || 0) < 0 && Math.hypot(dx, dy) < RIM_HW - 2) {
                made = i;
            } else {
                rimCollide(b, rx, MY, hit);
            }
        }
        b.spin = (b.spin || 0) + (b.vx + b.vy) * 0.03;
        return made;
    }
    function predictFall(b0, maxSteps) {
        const c = { x: b0.x, y: b0.y, z: b0.z || 0, vx: b0.vx, vy: b0.vy, vz: b0.vz || 0 };
        for (let t = 1; t <= (maxSteps || 160); t++) {
            ballStep(c);
            if (c.z <= 0) return { x: c.x, y: c.y, t };
        }
        return { x: c.x, y: c.y, t: maxSteps || 160 };
    }

    // ==========================================================
    // Players (2D movement + jump z)
    // ==========================================================
    function mkPlayer(i, x, y) {
        return {
            x: x === undefined ? W / 2 - fwdOf(i) * 120 : x,
            y: y === undefined ? MY : y,
            z: 0,
            vx: 0, vy: 0, vz: 0,
            face: fwdOf(i), sw: 0, land: 0
        };
    }
    function simPlayer(p, i, ctl, holding) {
        let out = null;
        const run = RUN * (ctl.sp || 1) * (holding ? 0.92 : 1);
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
        p.x = clamp(p.x + vx, FX0 + PR, FX1 - PR);
        p.y = clamp(p.y + vy, FY0 + PR, FY1 - PR);
        p.vx = vx;
        p.vy = vy;
        if (Math.abs(vx) > 0.4) p.face = Math.sign(vx);

        const grounded = (p.z || 0) <= 0.1;
        if (ctl.jump) {
            if (grounded) {
                p.vz = 9.5;
                p.z = 1;
                out = 'jump';
            } else if (holding && p.sw === 0) {
                p.sw = SHOT_T;
                out = 'shoot';
                p.face = fwdOf(i);
            }
        }

        if (!grounded || p.vz > 0) {
            p.vz = (p.vz || 0) - G_PL;
            p.z = Math.max(0, (p.z || 0) + p.vz);
            if (p.z <= 0) { p.z = 0; p.vz = 0; p.land = 8; }
        }

        if (p.sw > 0) p.sw--;
        if (p.land > 0) p.land--;
        return out;
    }

    // ==========================================================
    // Audio / FX / View
    // ==========================================================
    const Sfx = SportKit.sfx('hoops-muted');
    Sfx.bindMute(document.getElementById('mute-btn'));
    Sfx.dribble = () => Sfx.tone(110, 0.08, 'sine', 0.22, 70);
    Sfx.shoot = () => Sfx.noise(0.12, 1800, 1.2, 0.12);
    Sfx.rim = () => Sfx.tone(820, 0.25, 'triangle', 0.12, 760);
    Sfx.board = () => Sfx.noise(0.12, 500, 1, 0.3, 'lowpass');
    Sfx.swish = () => { Sfx.noise(0.3, 4200, 0.7, 0.18); };
    Sfx.steal = () => { Sfx.tone(500, 0.08, 'square', 0.08, 900); };
    Sfx.block = () => { Sfx.noise(0.18, 900, 0.8, 0.35); Sfx.tone(180, 0.18, 'square', 0.1, 70); };
    Sfx.jump = () => Sfx.tone(300, 0.12, 'triangle', 0.07, 620);
    Sfx.cheer = () => { Sfx.noise(0.5, 900, 0.5, 0.2, 'lowpass'); };
    const FX = SportKit.fx();
    const view = GameFit.view(canvas, { width: W, height: H, rotate: 'auto' });

    // ==========================================================
    // Match shell
    // ==========================================================
    let S = null, hostLoop = null, matchId = 0;
    const emit = SportKit.emitter(fx);
    const M = SportKit.match({
        game: 'hoops', L, sfx: Sfx, effects: FX, W, H,
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
    let jumpQueued = false, touchTarget = null;
    let dashActive = false;
    const joy = { x: 0, y: 0, active: false };
    const JUMP_KEYS = ['w', 'arrowup', ' ', 'j'];

    window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        const k = e.key.toLowerCase();
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
        Sfx.init();
        if (e.repeat) return;
        keys[k] = true;
        if (['a', 'd', 'w', 's', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) touchTarget = null;
        if (JUMP_KEYS.includes(k) && inMatch()) jumpQueued = true;
        if ((k === 'shift' || k === 'k') && inMatch()) { dashActive = true; jumpQueued = true; }
    });
    window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        keys[k] = false;
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
                if (active) touchTarget = null;
            },
            onAction: (action, down) => {
                if (!inMatch()) return;
                if (action === 'steal') {
                    dashActive = down;
                    if (down) jumpQueued = true;
                } else if (action === 'shoot') {
                    if (down) jumpQueued = true;
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
        if (pointers.size > 0) jumpQueued = true;
        const p = logicalPos(e);
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
        if (e.type === 'pointerup' && quick && !ptr.moved && inMatch()) jumpQueued = true;
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
            mx *= 1.3;
            my *= 1.3;
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
    const lastSh = [0, null];
    function startMatch() {
        matchId++;
        S = {
            mid: matchId, ph: 'check', pt: 0, sc: [0, 0], poss: Math.random() < 0.5 ? 0 : 1,
            b: { x: W / 2, y: MY, z: 24, vx: 0, vy: 0, vz: 0, spin: 0 },
            p: [mkPlayer(0), mkPlayer(1)],
            hold: -1, shooter: -1, shotPts: 2, shotT: 0, pick: [0, 0], cd: 0,
            shots: 0, made: 0, steals: 0, blocks: 0, evId: 0, events: [], winner: -1, tick: 0
        };
        if (GameBot.enabled) { botP = mkPlayer(1); bot = mkBrain(1, GameBot.level); }
        lastSh[1] = null;
        placeCheck();
        clearInterval(hostLoop);
        hostLoop = setInterval(hostTick, 1000 / 60);
        M.started(S.sc);
        M.showToast(L('toast_tip'), 3600);
        broadcast();
    }

    function placeCheck() {
        const o = S.poss, f = fwdOf(o);
        S.p[o] = mkPlayer(o, W / 2 - f * 170, MY);
        S.p[1 - o] = mkPlayer(1 - o, W / 2 - f * 30, MY);
        S.p[1 - o].face = -f;
        if (GameBot.enabled) Object.assign(botP, S.p[1]);
        S.hold = o; S.shooter = -1; S.cd = CHECK_T + POSS_CD;
        Object.assign(S.b, hand(S.p[o]), { vx: 0, vy: 0, vz: 0 });
        S.ph = 'check'; S.pt = 0;
        hist.clear();
        emit(S, { k: 'check', i: o });
    }

    function hostTick() {
        if (!S || S.ph === 'over') return;
        S.tick++;
        const frozen = S.ph === 'check';
        const c0 = autoHost ? think(autoHost, S.p[0]) : localCtl();
        if (!frozen) {
            const r0 = simPlayer(S.p[0], 0, c0, S.hold === 0);
            if (r0 === 'jump') Sfx.jump();
            if (r0 === 'shoot' && S.hold === 0) release(0, S.p[0]);
        }
        if (GameBot.enabled && !botFrozen && !frozen) botStep();
        if (S.cd > 0) S.cd--;
        for (const i of [0, 1]) if (S.pick[i] > 0) S.pick[i]--;

        if (S.ph === 'check') {
            Object.assign(S.b, hand(S.p[S.hold]));
            if (++S.pt >= CHECK_T) { S.ph = 'play'; S.pt = 0; emit(S, { k: 'go' }); }
        } else if (S.ph === 'play' || S.ph === 'score') {
            S.pt++;
            if (S.hold >= 0) {
                const p = S.p[S.hold], h = hand(p);
                S.b.x = h.x; S.b.y = h.y; S.b.z = h.z;
                S.b.vx = p.vx; S.b.vy = p.vy; S.b.vz = p.vz || 0;
                if (S.ph === 'play') trySteal(1 - S.hold);
            } else {
                const hit = {};
                const made = ballStep(S.b, hit);
                if (hit.rim) emit(S, { k: 'rim', x: r1(S.b.x), y: r1(S.b.y) });
                else if (hit.board) emit(S, { k: 'board', x: r1(S.b.x), y: r1(S.b.y) });
                if (hit.floor > 2.5) emit(S, { k: 'floor', x: r1(S.b.x), y: r1(S.b.y) });
                hist.push({ x: S.b.x, y: S.b.y, z: S.b.z, vx: S.b.vx, vy: S.b.vy, vz: S.b.vz });
                if (made >= 0 && S.ph === 'play') onBasket(made);
                else if (S.ph === 'play') for (const i of [0, 1]) touchFree(i, i === 1 && !GameBot.enabled);
            }
            if (S.ph === 'score' && S.pt >= SCORE_T) {
                if (S.sc[0] >= WIN_SCORE || S.sc[1] >= WIN_SCORE) {
                    S.ph = 'over';
                    S.winner = S.sc[0] > S.sc[1] ? 0 : 1;
                    broadcast();
                    M.gameOver(S.sc);
                    return;
                }
                placeCheck();
            }
        }
        if ((S.tick & 1) === 0) broadcast();
    }

    function onBasket(i) {
        const pts = S.shooter === i ? S.shotPts : 2;
        S.sc[i] += pts;
        S.made++;
        S.poss = 1 - i;
        S.ph = 'score'; S.pt = 0;
        emit(S, { k: 'basket', i, pts, dunk: S.dunk ? 1 : 0, x: r1(S.b.x), y: r1(S.b.y), sc: S.sc.slice() });
        M.score(S.sc);
    }

    function release(i, p) {
        const b = S.b, rx = RIM_X[i], f = fwdOf(i);
        const h = hand(p, f);
        b.x = h.x; b.y = p.y; b.z = (p.z || 0) + 12;
        const dx = rx - b.x, dy = MY - b.y, dist = Math.hypot(dx, dy);
        const op = S.p[1 - i];
        S.hold = -1; S.shooter = i; S.pick[i] = PICK_CD; S.dunk = false;
        S.shotPts = dist > THREE ? 3 : 2;
        S.shots++;

        // Dunk: close to rim and airborne
        if (dist < DUNK_R && (p.z || 0) > 4) {
            S.dunk = true; S.shotPts = 2;
            b.x = rx; b.y = MY; b.z = 32; b.vx = 0; b.vy = 0; b.vz = -3.5;
            emit(S, { k: 'dunk', i, x: r1(b.x), y: r1(b.y) });
            return;
        }

        const T = Math.round(clamp(28 + dist * 0.08, 30, 60));
        let vx = dx / T, vy = dy / T;
        let vz = (RIM_Z + 2 - b.z + 0.5 * G_BALL * T * T) / T;

        const contest = (op.x - p.x) * f > 0 && Math.hypot(op.x - p.x, op.y - p.y) < 70 && (op.z || 0) > 4 ? 1 : 0;
        const sigma = 0.008 + contest * 0.04;
        vx *= 1 + GameBot.gauss() * sigma;
        vy *= 1 + GameBot.gauss() * sigma;
        vz *= 1 + GameBot.gauss() * (sigma * 0.5);

        b.vx = vx; b.vy = vy; b.vz = vz;
        emit(S, { k: 'shot', i, x: r1(b.x), y: r1(b.y), pts: S.shotPts, good: sigma < 0.03 ? 1 : 0 });
    }

    function trySteal(j) {
        if (S.cd > 0) return;
        const pj = S.p[j], h = hand(S.p[S.hold]);
        if (Math.hypot(h.x - pj.x, h.y - pj.y) < PR + BR + 8 && Math.random() < STEAL_P) {
            S.hold = j; S.cd = POSS_CD; S.shooter = -1; S.steals++;
            emit(S, { k: 'steal', i: j, x: r1(h.x), y: r1(h.y) });
        }
    }

    function touchFree(i, lag) {
        if (S.pick[i] > 0) return;
        const p = S.p[i], b = S.b;
        const near = (q) => (q.z || 0) < (p.z || 0) + REACH_Z && Math.hypot(q.x - p.x, q.y - p.y) < PR + BR + 8;
        let touched = near(b);
        if (!touched && lag) {
            touched = !!hist.lagScan(M.rtt, near);
        }
        if (!touched) return;

        // Block a rising shot
        if (S.shooter === 1 - i && (b.vz || 0) > 0 && (p.z || 0) > 2) {
            b.vx = fwdOf(i) * 4 + p.vx * 0.3;
            b.vy = p.vy * 0.3;
            b.vz = -2;
            S.shooter = -1; S.blocks++; S.pick[i] = 12;
            emit(S, { k: 'block', i, x: r1(b.x), y: r1(b.y) });
            return;
        }

        S.hold = i; S.cd = Math.max(S.cd, POSS_CD / 2); S.shooter = -1;
        emit(S, { k: 'grab', i, x: r1(b.x), y: r1(b.y) });
    }

    function broadcast() {
        if (!S) return;
        const b = S.b;
        M.send({
            type: 'state', mid: S.mid, ph: S.ph, pt: S.pt, sc: S.sc, poss: S.poss, hold: S.hold,
            b: [r1(b.x), r1(b.y), r1(b.z || 0), r1(b.vx), r1(b.vy), r1(b.vz || 0), Math.round((b.spin || 0) * 100) / 100],
            p: S.p.map((q) => [r1(q.x), r1(q.y), r1(q.z || 0), q.face, q.sw]),
            ev: S.events.slice(-8)
        });
    }

    function onInput(msg) {
        if (!S || !num(msg.x)) return;
        if (S.ph === 'check') return;
        const p = S.p[1];
        p.x = clamp(msg.x, FX0 + PR, FX1 - PR);
        p.y = num(msg.y) ? clamp(msg.y, FY0 + PR, FY1 - PR) : MY;
        p.z = num(msg.z) ? Math.max(0, msg.z) : 0;
        p.vx = num(msg.vx) ? clamp(msg.vx, -RUN, RUN) : 0;
        p.vy = num(msg.vy) ? clamp(msg.vy, -RUN, RUN) : 0;
        if (msg.f === 1 || msg.f === -1) p.face = msg.f;
        if (num(msg.sw)) p.sw = clamp(msg.sw, 0, SHOT_T);
        if (num(msg.sh)) {
            if (lastSh[1] === null) lastSh[1] = msg.sh;
            else if (msg.sh > lastSh[1]) {
                lastSh[1] = msg.sh;
                if (S.hold === 1 && S.ph === 'play') release(1, p);
            }
        }
    }

    // ==========================================================
    // Bot
    // ==========================================================
    const BOT_LV = {
        easy:   { sp: 0.7, react: 18, dunk: 0.25 },
        normal: { sp: 0.86, react: 9,  dunk: 0.55 },
        hard:   { sp: 1.0,  react: 2,  dunk: 0.88 }
    };
    function mkBrain(i, lv) {
        return { i, B: BOT_LV[lv] || BOT_LV.normal, timer: 0, tx: W / 2, ty: MY };
    }
    function think(br, me) {
        const ctl = { tx: br.tx, ty: br.ty, jump: false, sp: br.B.sp };
        if (!S || S.ph !== 'play') return ctl;
        const i = br.i, f = fwdOf(i), B = br.B, op = S.p[1 - i], b = S.b, rx = RIM_X[i];

        if (S.hold === i) {
            // Drive toward opponent's hoop
            const dist = Math.hypot(rx - me.x, MY - me.y);
            br.tx = rx - f * (B.dunk ? 30 : 150);
            br.ty = MY;
            if (dist < 190 && Math.random() < 0.08) ctl.jump = true;
        } else if (S.hold === 1 - i) {
            // Defend between ball handler and our rim
            const ownRim = RIM_X[1 - i];
            br.tx = op.x + Math.sign(ownRim - op.x) * 45;
            br.ty = op.y;
            if ((op.z || 0) > 4 && Math.random() < 0.15) ctl.jump = true;
        } else {
            // Loose ball
            const land = predictFall(b, 120);
            br.tx = land.x;
            br.ty = land.y;
        }
        if (--br.timer <= 0) br.timer = B.react;
        ctl.tx = br.tx; ctl.ty = br.ty;
        return ctl;
    }

    let bot = mkBrain(1, GameBot.level);
    let botP = mkPlayer(1), botSh = 0, botFrozen = false, autoHost = null;
    function botStep() {
        const r = simPlayer(botP, 1, think(bot, botP), S.hold === 1);
        if (r === 'shoot') botSh++;
        GameBot.deliver({
            type: 'input', x: botP.x, y: botP.y, z: botP.z,
            vx: botP.vx, vy: botP.vy, f: botP.face, sw: botP.sw, sh: botSh
        });
    }

    // Client stepping
    let me = mkPlayer(1), shSeq = 0;
    setInterval(() => {
        if (M.role !== 'client' || !M.open || !M.net) return;
        const n = M.net;
        if (n.ph === 'over') return;
        if (n.ph === 'check') {
            me.x = n.p[1][0]; me.y = n.p[1][1]; me.z = n.p[1][2] || 0;
            me.face = n.p[1][3]; localCtl(); return;
        }
        const r = simPlayer(me, 1, localCtl(), n.hold === 1);
        if (r === 'jump') Sfx.jump();
        if (r === 'shoot') shSeq++;
        M.send({
            type: 'input', x: r1(me.x), y: r1(me.y), z: r1(me.z || 0),
            vx: r1(me.vx), vy: r1(me.vy), f: me.face, sw: me.sw, sh: shSeq
        });
    }, 1000 / 60);

    function inMatch() {
        const d = M.role === 'host' ? S : M.net;
        return !!d && d.ph !== 'over' && !M.overlayUp();
    }

    function drawState() {
        if (M.role === 'host') return S;
        const n = M.net;
        if (!n) return null;
        const f = M.age();
        const o = n.p[0];
        const opp = { x: o[0] + o[3] * f, y: o[1] + (o[4] || 0) * f, z: o[2], face: o[3], sw: o[4], land: 0 };
        let b;
        if (n.hold === 1) b = Object.assign({ vx: me.vx, vy: me.vy, vz: me.vz || 0, spin: n.b[6] || 0 }, hand(me));
        else if (n.hold === 0) b = Object.assign({ vx: 0, vy: 0, vz: 0, spin: n.b[6] || 0 }, hand(opp));
        else {
            b = {
                x: n.b[0] + n.b[3] * f, y: n.b[1] + n.b[4] * f, z: Math.max(0, n.b[2] + (n.b[5] || 0) * f),
                vx: n.b[3], vy: n.b[4], vz: n.b[5] || 0, spin: n.b[6] || 0
            };
        }
        return { ph: n.ph, pt: n.pt + f, sc: n.sc, poss: n.poss, hold: n.hold, b, p: [opp, me] };
    }

    function fx(ev) {
        const mine = ev.i === M.idx;
        if (ev.k === 'shot') {
            Sfx.shoot();
            if (ev.pts === 3) FX.float('3PT!', ev.x, ev.y - 30, '#2de2ff', 24);
        } else if (ev.k === 'dunk') {
            Sfx.board(); FX.shake = 10; FX.flash = 6;
            FX.float('DUNK!!', ev.x, ev.y - 30, '#ffd34d', 36);
            FX.burst(ev.x, ev.y, 24, '#ffb02f', 6, 26, 4);
        } else if (ev.k === 'rim') {
            Sfx.rim();
        } else if (ev.k === 'board') {
            Sfx.board();
        } else if (ev.k === 'floor') {
            Sfx.dribble();
        } else if (ev.k === 'steal') {
            Sfx.steal();
            FX.float('STEAL!', ev.x, ev.y - 30, mine ? '#7dff9b' : '#ff6b6b', 24);
            FX.burst(ev.x, ev.y, 10, '#9bdcff', 3, 18, 2.5);
        } else if (ev.k === 'block') {
            Sfx.block(); FX.shake = 7;
            FX.float('BLOCK!', ev.x, ev.y - 30, '#ffd34d', 28);
            FX.burst(ev.x, ev.y, 16, '#ffd34d', 5, 22, 4);
        } else if (ev.k === 'grab') {
            Sfx.dribble();
        } else if (ev.k === 'basket') {
            Sfx.swish(); Sfx.cheer();
            FX.slowmo = 30; FX.shake = 5;
            FX.float(`+${ev.pts}`, ev.x, ev.y + 20, mine ? '#7dff9b' : '#ff6b6b', 34);
            if (!ev.dunk) FX.float(ev.pts === 3 ? 'THREE!' : 'SWISH!', W / 2, 100, mine ? '#ffd34d' : '#ffffff', 38);
            if (mine) FX.confetti(ev.x, ev.y, 45);
        } else if (ev.k === 'check') {
            Sfx.beep();
        } else if (ev.k === 'go') {
            Sfx.whistle();
        }
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
        pg.addColorStop(0, '#131826'); pg.addColorStop(1, '#1c2438');
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

        // Paint key zones tinted with defending team
        for (const i of [0, 1]) {
            const rx = RIM_X[i], s = i === 0 ? 1 : -1;
            const x0 = i === 0 ? FX1 - 130 : FX0;
            g.fillStyle = COL[1 - i].main + '25';
            g.fillRect(x0, MY - 55, 130, 110);
        }
        g.restore();

        // Top-down court markings
        SportMech.neon(g, '#cfe6ff', 2, () => {
            g.rect(FX0, FY0, FX1 - FX0, FY1 - FY0);
            g.moveTo(W / 2, FY0); g.lineTo(W / 2, FY1);
            g.moveTo(W / 2 + 54, MY);
            g.arc(W / 2, MY, 54, 0, Math.PI * 2);

            // Keys
            for (const i of [0, 1]) {
                const x0 = i === 0 ? FX1 - 130 : FX0;
                g.rect(x0, MY - 55, 130, 110);
            }
        });
        // 3-point arcs: exactly the scoring radius around each rim, facing
        // center court and cut off by the sidelines.
        g.save();
        g.beginPath(); g.rect(FX0, FY0, FX1 - FX0, FY1 - FY0); g.clip();
        SportMech.neon(g, '#cfe6ff', 2, () => {
            for (const i of [0, 1]) {
                const rx = RIM_X[i];
                const a0 = i === 0 ? Math.PI / 2 : -Math.PI / 2;
                g.moveTo(rx + Math.cos(a0) * THREE, MY + Math.sin(a0) * THREE);
                g.arc(rx, MY, THREE, a0, a0 + Math.PI);
            }
        });
        g.restore();

        // Top-down Backboards & Rims (baked into bg)
        for (const i of [0, 1]) {
            const bx = BOARD_X[i], rx = RIM_X[i];
            // Backboard plate
            g.fillStyle = '#2a3142';
            g.fillRect(bx - BOARD_HW, BOARD_TOP, BOARD_HW * 2, BOARD_BOT - BOARD_TOP);
            SportMech.neon(g, '#9bdcff', 2, () => {
                g.moveTo(bx, BOARD_TOP); g.lineTo(bx, BOARD_BOT);
            });
            // Rim support arm
            g.fillStyle = '#4a556d';
            g.fillRect(Math.min(bx, rx), MY - 3, Math.abs(rx - bx), 6);
            // Glowing orange circular rim
            SportMech.neon(g, '#ff7a22', 2.8, () => {
                g.arc(rx, MY, RIM_HW, 0, Math.PI * 2);
            });
        }

        bgCache = c;
        return c;
    }

    function drawShadow(x, y, r, z) {
        SportMech.shadow(ctx, x, y, r, z);
    }

    function drawBall(b) {
        const z = b.z || 0;
        if (Math.hypot(b.vx, b.vy) > 6) SportMech.streak(ctx, b, BR, '#ff7a22', 5);
        SportMech.ball(ctx, b, BR, 'hoops');
    }

    function drawPlayer(p, i, ball, tg, holding) {
        const moving = Math.hypot(p.vx || 0, p.vy || 0) > 0.3;
        let ang;
        if (moving) ang = Math.atan2(p.vy, p.vx);
        else ang = p.face > 0 ? 0 : Math.PI;

        const air = (p.z || 0) > 2;
        SportMech.mech(ctx, {
            x: p.x, y: p.y, z: p.z || 0, r: PR, i, ang, t: tg,
            moving, air, weapon: 'hoops',
            charge: holding ? 0.7 : 0
        });

        // Aiming trajectory line while holding
        if (holding) {
            const rx = RIM_X[i];
            ctx.save();
            ctx.strokeStyle = `rgba(255, 122, 34, ${0.35 + 0.2 * Math.sin(tg / 4)})`;
            ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]); ctx.lineDashOffset = -tg;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(rx, MY); ctx.stroke();
            ctx.restore();
        }
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

        if (d) {
            const ball = d.b;
            drawShadow(ball.x, ball.y, BR, ball.z || 0);
            drawPlayer(d.p[0], 0, ball, tGlobal, d.hold === 0);
            drawPlayer(d.p[1], 1, ball, tGlobal, d.hold === 1);
            drawBall(ball);
        } else {
            drawPlayer(mkPlayer(0), 0, { x: W / 2, y: MY }, tGlobal, false);
            drawPlayer(mkPlayer(1), 1, { x: W / 2, y: MY }, tGlobal, false);
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
        give(i) { if (!S) return; S.hold = i; S.shooter = -1; Object.assign(S.b, hand(S.p[i])); },
        release,
        touchFree,
        skipCheck() { if (S) { S.ph = 'play'; S.pt = 0; } },
        place(i, x, y, z) {
            const p = i === 1 && GameBot.enabled ? botP : S.p[i];
            p.x = x; p.y = y === undefined ? MY : y; p.z = z || 0;
            p.vx = 0; p.vy = 0; p.vz = 0;
            if (i === 1) { S.p[1].x = p.x; S.p[1].y = p.y; S.p[1].z = p.z; }
        },
        setBall(x, y, z, vx, vy, vz) {
            if (!S) return;
            S.ph = 'play'; S.pt = 0; S.hold = -1;
            Object.assign(S.b, { x, y, z: z || 0, vx: vx || 0, vy: vy || 0, vz: vz || 0 });
            hist.clear();
        },
        setRtt(ms) { M.rtt = ms; },
        hist: () => hist.buf,
        C: { W, H, MY, PR, BR, RIM_X, RIM_Y, RIM_Z, THREE, WIN_SCORE }
    });
});
