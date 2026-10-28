/**
 * Link Tennis — 机甲网球: 1v1 realtime top-down tennis with auto-running.
 *
 * Built on scripts/sport-kit.js. The relaxing twist: players run to the ball
 * by themselves (identical speed for both seats) — you only choose the shot.
 * Swipe toward where you want the ball to go; the faster the swipe, the
 * harder the shot. Swipe *backward* for a lob. If you don't swipe at all
 * your player still blocks the ball back, softly and down the middle.
 *
 * Netcode: because movement is automatic, the host simulates *both* players
 * authoritatively and the client only sends shot intents (a counter + aim +
 * power). An intent is armed until the ball reaches your racket, so latency
 * just shifts when you may swipe — nothing ever teleports. Swiping close to
 * contact ("PERFECT", window widened by the measured RTT for the remote side)
 * gives a faster, sharper shot.
 *
 * Rules: the ball must cross the net and bounce inside the other court, then
 * the receiver must hit it before it bounces twice. Serve alternates every
 * two points; first to WIN_SCORE.
 *
 * Canonical coordinates: host on the left, client on the right; the client
 * mirrors horizontally so everyone plays from the left.
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    if (!location.hash || location.hash.length <= 1) location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    const { clamp, rnd, r1, num } = SportKit;
    const L = TennisI18n.t;
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    // ==========================================================
    // Constants
    // ==========================================================
    const W = 800, H = 450;
    const CX0 = 96, CX1 = W - 96, CY0 = 102, CY1 = 402;
    const NET_X = W / 2, NET_H = 24, MY = (CY0 + CY1) / 2;
    const PR = 17, BR = 6;
    const G = 0.2, BOUNCE_E = 0.7;
    const RUN = 2.5, REACH = 31, REACH_Z = 64;
    const GRACE = 6, PERFECT_T = 14;
    const WIN_SCORE = 7, SERVE_T = 110, POINT_T = 100;
    const HOME_X = [CX0 - 26, CX1 + 26];
    const COL = SportMech.TEAM;
    const fwdOf = (i) => (i === 0 ? 1 : -1);
    const sideOf = (x) => (x < NET_X ? 0 : 1);
    const inCourt = (x, y) => x >= CX0 - BR && x <= CX1 + BR && y >= CY0 - BR && y <= CY1 + BR;

    // ==========================================================
    // Ball physics
    // ==========================================================
    /** One 1/60 s step. hit.bounce = true when it touched the ground; hit.net when stopped by the net. */
    function ballStep(b, hit) {
        const px = b.x;
        b.vz -= G;
        b.x += b.vx; b.y += b.vy; b.z += b.vz;
        b.vx *= 0.999; b.vy *= 0.999;
        if ((px - NET_X) * (b.x - NET_X) <= 0 && px !== b.x && b.z < NET_H && b.y > CY0 - 30 && b.y < CY1 + 30) {
            b.x = NET_X - Math.sign(b.vx) * (BR + 1);
            b.vx = -b.vx * 0.25; b.vy *= 0.4;
            if (hit) hit.net = 1;
        }
        if (b.z <= 0) {
            b.z = 0;
            if (b.vz < -0.8) { b.vz = -b.vz * BOUNCE_E; if (hit) hit.bounce = 1; }
            else { b.vz = 0; b.vx *= 0.95; b.vy *= 0.95; if (hit && !b.rolled) { hit.bounce = 1; b.rolled = 1; } }
        }
        b.spin = (b.spin || 0) + Math.hypot(b.vx, b.vy) * 0.1;
    }
    /** Where will the ball first bounce? */
    function predictBounce(b0, maxSteps) {
        const c = { x: b0.x, y: b0.y, z: b0.z, vx: b0.vx, vy: b0.vy, vz: b0.vz };
        for (let t = 1; t <= (maxSteps || 240); t++) {
            const h = {};
            ballStep(c, h);
            if (h.net) return null;
            if (h.bounce) return { x: c.x, y: c.y, t };
        }
        return null;
    }
    /**
     * Comfortable contact point for player i: after the bounce on i's side,
     * at the top of the bounce, or on the rise for high-kicking balls. nb = bounces already done.
     */
    function predictContact(b0, i, nb) {
        const c = { x: b0.x, y: b0.y, z: b0.z, vx: b0.vx, vy: b0.vy, vz: b0.vz };
        let bounced = nb > 0;
        for (let t = 1; t <= 260; t++) {
            const h = {};
            ballStep(c, h);
            if (h.net) return null;
            if (h.bounce) {
                if (bounced) return { x: c.x, y: c.y, t, late: true };
                if (sideOf(c.x) !== i) return null;
                bounced = true;
            }
            // take it at the top of the bounce, or on the rise if it kicks up high
            if (bounced && (c.vz <= 0 || c.z > 26) && c.z < REACH_Z - 8) return { x: c.x, y: c.y, t };
        }
        return null;
    }

    // ==========================================================
    // Audio / FX / view
    // ==========================================================
    const Sfx = SportKit.sfx('tennis-muted');
    Sfx.bindMute(document.getElementById('mute-btn'));
    Sfx.hit = (pw) => { Sfx.tone(520 + pw * 260, 0.07, 'square', 0.12, 300); Sfx.noise(0.06, 2600, 2, 0.2 + pw * 0.15); };
    Sfx.bounce = () => Sfx.tone(200, 0.06, 'sine', 0.18, 140);
    Sfx.net = () => Sfx.noise(0.22, 260, 1, 0.3, 'lowpass');
    Sfx.swish = () => Sfx.noise(0.08, 3500, 1.5, 0.08);
    const FX = SportKit.fx();
    const view = GameFit.view(canvas, { width: W, height: H, rotate: 'auto' });

    // ==========================================================
    // Match shell
    // ==========================================================
    let S = null, hostLoop = null, matchId = 0;
    const emit = SportKit.emitter(fx);
    const M = SportKit.match({
        game: 'tennis', L, sfx: Sfx, effects: FX, W, H,
        startMatch, stopHost() { clearInterval(hostLoop); }, hostOver: () => !S || S.ph === 'over',
        broadcast, onInput, onEvent: fx
    });
    const flip = () => M.flip();
    const toCanonX = (x) => (flip() ? W - x : x);

    // ==========================================================
    // Input → shot intents {aim -1..1, pw 0..1, lob}
    // ==========================================================
    let myIntent = null;          // what the local player has armed (for the HUD arrow)
    let shotSeq = 0;
    function intend(aim, pw, lob) {
        if (!inMatch()) return;
        Sfx.init(); Sfx.swish();
        myIntent = { aim: clamp(aim, -1, 1), pw: clamp(pw, 0, 1), lob: lob ? 1 : 0, at: performance.now() };
        if (M.role === 'host') arm(0, myIntent.aim, myIntent.pw, myIntent.lob, false);
        else { shotSeq++; M.send({ type: 'input', s: shotSeq, aim: r1(myIntent.aim), pw: r1(myIntent.pw), lob: myIntent.lob }); }
    }
    window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        const k = e.key.toLowerCase();
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
        Sfx.init();
        if (e.repeat) return;
        if (k === 'w' || k === 'arrowup') intend(-1, 0.8);
        else if (k === 's' || k === 'arrowdown') intend(1, 0.8);
        else if (k === 'd' || k === 'arrowright' || k === ' ' || k === 'j') intend(0, 0.85);
        else if (k === 'a' || k === 'arrowleft' || k === 'k') intend(0, 0.5, true);
    });

    let joyAim = 0;
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
                joyAim = active ? clamp(my, -1, 1) : 0;
            },
            onAction: (action, down) => {
                if (!inMatch() || !down) return;
                if (action === 'hit') {
                    intend(joyAim, 0.85, false);
                } else if (action === 'lob') {
                    intend(joyAim * 0.5, 0.55, true);
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
        pointers.set(e.pointerId, Object.assign(logical(e), { t: performance.now(), done: false }));
        try { dragArea.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    /** Fire as soon as the finger has travelled far enough — no need to lift. */
    function swipe(q, p, now) {
        const dx = (p.x - q.x) * fwdOf(M.idx), dy = p.y - q.y, d = Math.hypot(dx, dy);
        if (d < 28) return false;
        const sp = d / Math.max(16, now - q.t);           // px per ms
        const pw = clamp((sp - 0.25) / 1.3, 0.2, 1);
        if (dx < -Math.abs(dy) * 0.7) intend(clamp(dy / 80, -1, 1), 0.5, true);
        else intend(clamp(dy / Math.max(40, Math.abs(dx)), -1, 1), pw, false);
        return true;
    }
    dragArea.addEventListener('pointermove', (e) => {
        const q = pointers.get(e.pointerId);
        if (!q || q.done) return;
        const now = performance.now();
        if (swipe(q, logical(e), now)) q.done = true;
    });
    function endPointer(e) {
        const q = pointers.get(e.pointerId);
        if (!q) return;
        pointers.delete(e.pointerId);
        if (q.done || e.type !== 'pointerup') return;
        if (!swipe(q, logical(e), performance.now()) && performance.now() - q.t < 300) intend(0, 0.6, false);   // tap = solid centre drive
    }
    dragArea.addEventListener('pointerup', endPointer);
    dragArea.addEventListener('pointercancel', endPointer);
    dragArea.addEventListener('contextmenu', (e) => e.preventDefault());

    // ==========================================================
    // Host simulation
    // ==========================================================
    const lastShot = [0, null];
    function mkPlayer(i) { return { x: HOME_X[i], y: MY, vx: 0, vy: 0, sw: 0, face: fwdOf(i), run: 0 }; }
    function startMatch() {
        matchId++;
        S = {
            mid: matchId, ph: 'serve', pt: 0, sc: [0, 0], sv: Math.random() < 0.5 ? 0 : 1, nPts: 0,
            b: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 },
            p: [mkPlayer(0), mkPlayer(1)],
            intent: [null, null], grace: [0, 0],
            last: -1, nb: 0, rally: 0, shots: 0, evId: 0, events: [], winner: -1, tick: 0
        };
        if (GameBot.enabled) bot = mkBrain(1, GameBot.level);
        lastShot[1] = null;
        placeServe();
        clearInterval(hostLoop);
        hostLoop = setInterval(hostTick, 1000 / 60);
        M.started(S.sc);
        M.showToast(L('toast_serve'), 3800);
        broadcast();
    }
    function placeServe() {
        const sv = S.sv;
        const sy = MY + (S.nPts % 2 ? -50 : 50) * (sv ? -1 : 1);
        S.p[0] = mkPlayer(0); S.p[1] = mkPlayer(1);
        S.p[sv].y = sy;
        S.p[1 - sv].y = MY - (sy - MY) * 0.6;
        Object.assign(S.b, { x: S.p[sv].x + fwdOf(sv) * 10, y: sy, z: 30, vx: 0, vy: 0, vz: 0, rolled: 0 });
        S.ph = 'serve'; S.pt = 0; S.last = -1; S.nb = 0; S.rally = 0;
        S.intent = [null, null]; S.grace = [0, 0];
        emit(S, { k: 'serve', i: sv });
    }
    const lagFrames = (i) => (i === 1 && !GameBot.enabled ? Math.round(M.rtt / (1000 / 60)) : 0);

    function hostTick() {
        if (!S || S.ph === 'over') return;
        S.tick++;
        if (GameBot.enabled && !botFrozen) botThink(bot);
        if (autoHost) botThink(autoHost);
        for (const q of S.p) if (q.sw > 0) q.sw--;
        if (S.ph === 'serve') {
            S.pt++;
            const b = S.b, sv = S.sv;
            // toss: up and down above the server's head
            if (S.pt === 20) { b.vz = 4.6; }
            if (S.pt >= 20) { b.vz -= G; b.z += b.vz; if (b.z < 30) { b.z = 30; b.vz = 4.6; } }
            const ready = S.pt > 34 && b.vz < 1 && b.z > 60;
            if ((ready && S.intent[sv]) || S.pt >= SERVE_T) {
                S.ph = 'play'; S.pt = 0;
                hitBall(sv, S.intent[sv], true);
            }
        } else if (S.ph === 'play') {
            S.pt++;
            const h = {};
            ballStep(S.b, h);
            if (h.net) emit(S, { k: 'net', x: r1(S.b.x), y: r1(S.b.y) });
            if (h.bounce) { if (onBounce()) return broadcastMaybe(); }
            if (S.b.x < -60 || S.b.x > W + 60 || S.b.y < -60 || S.b.y > H + 60) {
                pointTo(S.nb === 0 ? 1 - S.last : S.last, S.nb === 0 ? 'out' : 'winner');
                return broadcastMaybe();
            }
            for (const i of [0, 1]) autoRun(i);
            for (const i of [0, 1]) tryContact(i);
        } else if (S.ph === 'point') {
            ballStep(S.b);
            for (const i of [0, 1]) autoRun(i);
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
        broadcastMaybe();
    }
    function broadcastMaybe() { if (S && S.ph !== 'over' && (S.tick & 1) === 0) broadcast(); }

    /** Returns true when the point ended. */
    function onBounce() {
        const b = S.b, side = sideOf(b.x);
        emit(S, { k: 'bounce', x: r1(b.x), y: r1(b.y) });
        if (S.last < 0) return false;
        if (S.nb === 0) {
            if (side === S.last) { pointTo(1 - S.last, 'net'); return true; }
            if (!inCourt(b.x, b.y)) { pointTo(1 - S.last, 'out'); return true; }
            S.nb = 1;
            emit(S, { k: 'in', x: r1(b.x), y: r1(b.y) });
            return false;
        }
        pointTo(S.last, 'winner');
        return true;
    }
    function pointTo(i, why) {
        S.sc[i]++;
        S.nPts++;
        if (S.nPts % 2 === 0) S.sv = 1 - S.sv;
        S.ph = 'point'; S.pt = 0;
        emit(S, { k: 'point', i, why, x: r1(S.b.x), y: r1(S.b.y), sc: S.sc.slice() });
        M.score(S.sc);
    }

    /** Players run to the ball by themselves — same speed for both seats. */
    function autoRun(i) {
        const p = S.p[i], b = S.b;
        let tx = HOME_X[i], ty = MY + (b.y - MY) * 0.3;
        if (S.ph === 'play' && S.last === 1 - i) {
            const c = predictContact(b, i, S.nb);
            if (c) { tx = c.x - fwdOf(i) * 14; ty = c.y + 8; }
        }
        tx = i === 0 ? clamp(tx, 20, NET_X - 30) : clamp(tx, NET_X + 30, W - 20);
        ty = clamp(ty, 30, H - 14);
        const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
        const sp = d > 1 ? Math.min(RUN, d * 0.4) : 0;
        p.vx = d > 0 ? dx / d * sp : 0; p.vy = d > 0 ? dy / d * sp : 0;
        p.x += p.vx; p.y += p.vy;
        if (Math.abs(p.vy) > 0.3 || Math.abs(p.vx) > 0.3) p.run += sp * 0.12;
    }

    function arm(i, aim, pw, lob, remote) {
        if (!S || (S.ph !== 'play' && S.ph !== 'serve')) return;
        S.intent[i] = { aim, pw, lob, t: S.tick, lag: remote ? Math.round(M.rtt / (1000 / 60)) : 0 };
    }
    function tryContact(i) {
        if (S.last !== 1 - i || S.nb !== 1 || sideOf(S.b.x) !== i) { S.grace[i] = 0; return; }
        const p = S.p[i], b = S.b;
        const inReach = b.z < REACH_Z && Math.hypot(b.x - p.x, b.y - p.y) < REACH;
        if (inReach) {
            if (S.intent[i]) return hitBall(i, S.intent[i], false);
            if (++S.grace[i] > GRACE + lagFrames(i)) hitBall(i, null, false);
        } else if (S.grace[i] > 0) hitBall(i, S.intent[i], false);   // leaving reach: never whiff a ball we were waiting on
    }

    /**
     * Shot: pick a landing point on the other side from aim/power, then solve
     * the launch so it lands there, clearing the net. No intent = soft block
     * down the middle. PERFECT = intent armed just before contact.
     */
    function hitBall(i, it, serve) {
        const p = S.p[i], b = S.b, fwd = fwdOf(i);
        let tx, ty, sp, perfect = false, kind = 'block';
        if (it) {
            const age = S.tick - it.t;
            perfect = !serve && age <= PERFECT_T + (it.lag || 0);
            if (it.lob) {
                kind = 'lob';
                tx = NET_X + fwd * 260; ty = MY + it.aim * 90; sp = 4.6;
            } else {
                kind = perfect ? 'smash' : 'drive';
                const depth = 130 + it.pw * 160;
                tx = NET_X + fwd * depth;
                ty = MY + it.aim * ((CY1 - CY0) / 2 - 22);
                sp = 7 + it.pw * 7;
                if (perfect) { sp *= 1.18; ty = MY + it.aim * ((CY1 - CY0) / 2 - 14); }
                const err = 5 + 24 * it.pw * Math.abs(it.aim) + (perfect ? 0 : 8);
                tx += GameBot.gauss() * err; ty += GameBot.gauss() * err;
            }
            if (serve) { sp = Math.min(sp, 9.5); tx = NET_X + fwd * clamp(Math.abs(tx - NET_X), 120, 250); }
        } else {
            tx = NET_X + fwd * rnd(150, 210); ty = MY + rnd(-40, 40); sp = 6;
        }
        const z0 = Math.max(b.z, 8);
        let dx = tx - b.x, dy = ty - b.y;
        const D = Math.hypot(dx, dy) || 1;
        // slow down until the arc clears the net with a margin
        let vz = 0, T = 0;
        for (let k = 0; k < 30; k++) {
            T = D / sp;
            vz = (0.5 * G * T * T - z0) / T;
            const tn = Math.abs(NET_X - b.x) / Math.max(0.1, Math.abs(dx / D * sp));
            const zn = z0 + vz * tn - 0.5 * G * tn * tn;
            if (zn > NET_H + 6 || tn > T) break;
            sp *= 0.93;
        }
        // flatten moon balls (soft blocks over long distances) unless it is a lob
        for (let k = 0; k < 20 && vz > 6 && !(it && it.lob); k++) { sp *= 1.07; T = D / sp; vz = (0.5 * G * T * T - z0) / T; }
        if (it && it.lob) vz = Math.max(vz, 5.6);
        b.vx = dx / D * sp; b.vy = dy / D * sp; b.vz = vz; b.z = z0; b.rolled = 0;
        if (it && it.lob) { const Tl = (vz + Math.sqrt(vz * vz + 2 * G * z0)) / G; b.vx = dx / Tl; b.vy = dy / Tl; }
        p.sw = 14; p.face = fwd;
        S.last = i; S.nb = 0; S.rally++; S.shots++;
        S.intent[i] = null; S.grace[i] = 0;
        emit(S, { k: serve ? 'srv' : kind, i, x: r1(b.x), y: r1(b.y), pw: it ? r1(it.pw) : 0.3, pf: perfect ? 1 : 0 });
    }

    function broadcast() {
        if (!S) return;
        const b = S.b;
        M.send({
            type: 'state', mid: S.mid, ph: S.ph, pt: S.pt, sc: S.sc, sv: S.sv, last: S.last, nb: S.nb,
            b: [r1(b.x), r1(b.y), r1(b.z), r1(b.vx), r1(b.vy), r1(b.vz), r1(b.spin)],
            p: S.p.map((q) => [r1(q.x), r1(q.y), r1(q.vx), r1(q.vy), q.sw]),
            arm: [S.intent[0] ? 1 : 0, S.intent[1] ? 1 : 0],
            ev: S.events.slice(-8)
        });
    }

    function onInput(msg) {
        if (!S || !num(msg.s)) return;
        if (lastShot[1] !== null && msg.s <= lastShot[1]) return;
        lastShot[1] = msg.s;
        arm(1, num(msg.aim) ? clamp(msg.aim, -1, 1) : 0, num(msg.pw) ? clamp(msg.pw, 0, 1) : 0.5, !!msg.lob, !GameBot.enabled);
    }

    // ==========================================================
    // Bot: only chooses shots (movement is automatic for everybody)
    // ==========================================================
    const BOT_LV = {
        easy: { skip: 0.45, pf: 0.15, pw: [0.25, 0.6], aim: 0.45, lob: 0.12 },
        normal: { skip: 0.15, pf: 0.5, pw: [0.45, 0.85], aim: 0.75, lob: 0.1 },
        hard: { skip: 0.0, pf: 0.9, pw: [0.7, 1.0], aim: 1.0, lob: 0.06 }
    };
    function mkBrain(i, lv) { return { i, B: BOT_LV[lv] || BOT_LV.normal, plan: -1, at: 0, skip: false, botShot: 0 }; }
    function botThink(br) {
        const i = br.i, B = br.B, b = S.b, op = S.p[1 - i], me = S.p[i];
        const key = S.ph === 'serve' ? -100 - S.nPts : S.rally;
        const mine = S.ph === 'serve' ? S.sv === i : S.ph === 'play' && S.last === 1 - i;
        if (!mine || S.intent[i]) return;
        if (br.plan !== key) {
            br.plan = key;
            br.skip = Math.random() < B.skip;
            br.perfect = Math.random() < B.pf;
            br.at = S.ph === 'serve' ? rnd(40, 80) : rnd(0, 12);
        }
        if (br.skip) return;
        let fire;
        if (S.ph === 'serve') fire = S.pt > br.at && b.vz < 1 && b.z > 60;
        else {
            const d = Math.hypot(b.x - me.x, b.y - me.y);
            fire = br.perfect ? (S.nb === 1 && d < REACH + 50) : (S.pt > br.at);
        }
        if (!fire) return;
        const lob = Math.random() < B.lob;
        // aim away from the rival
        const away = op.y < MY ? 1 : -1;
        const aim = clamp(away * B.aim * rnd(0.6, 1) + rnd(-0.2, 0.2), -1, 1);
        const pw = rnd(B.pw[0], B.pw[1]);
        if (i === 1 && GameBot.enabled && br === bot) { br.botShot++; GameBot.deliver({ type: 'input', s: br.botShot, aim, pw, lob: lob ? 1 : 0 }); }
        else arm(i, aim, pw, lob, false);
    }
    let bot = mkBrain(1, GameBot.level), botFrozen = false, autoHost = null;

    function inMatch() { const d = M.role === 'host' ? S : M.net; return !!d && d.ph !== 'over' && !M.overlayUp(); }

    // ==========================================================
    // Draw-state
    // ==========================================================
    const disp = [{ x: HOME_X[0], y: MY }, { x: HOME_X[1], y: MY }];
    function drawState() {
        if (M.role === 'host') {
            if (!S) return null;
            return { ph: S.ph, pt: S.pt, sc: S.sc, sv: S.sv, last: S.last, nb: S.nb, b: S.b, p: S.p, arm: [S.intent[0] ? 1 : 0, S.intent[1] ? 1 : 0] };
        }
        const n = M.net;
        if (!n) return null;
        const f = M.age();
        const b = { x: n.b[0], y: n.b[1], z: n.b[2], vx: n.b[3], vy: n.b[4], vz: n.b[5], spin: n.b[6] };
        if (n.ph === 'play') for (let k = 0; k < Math.floor(f); k++) ballStep(b);
        const p = n.p.map((q, i) => {
            disp[i].x += (q[0] + q[2] * f - disp[i].x) * 0.5;
            disp[i].y += (q[1] + q[3] * f - disp[i].y) * 0.5;
            return { x: disp[i].x, y: disp[i].y, vx: q[2], vy: q[3], sw: q[4], face: fwdOf(i), run: performance.now() / 110 * Math.min(1, Math.hypot(q[2], q[3]) / RUN) };
        });
        return { ph: n.ph, pt: n.pt + f, sc: n.sc, sv: n.sv, last: n.last, nb: n.nb, b, p, arm: n.arm || [0, 0] };
    }

    // ==========================================================
    // FX events
    // ==========================================================
    function fx(ev) {
        const mine = ev.i === M.idx;
        if (ev.k === 'drive' || ev.k === 'smash' || ev.k === 'block' || ev.k === 'lob' || ev.k === 'srv') {
            Sfx.hit(ev.pw || 0.3);
            FX.burst(ev.x, ev.y - 20, ev.pf ? 16 : 6, ev.pf ? '#c8ff3d' : '#9bdcff', ev.pf ? 5 : 2.5, 18, 2.5);
            if (ev.pf) { FX.float('PERFECT!', ev.x, ev.y - 60, '#c8ff3d', 28); FX.shake = 4; }
            if (ev.i === M.idx) myIntent = null;
        } else if (ev.k === 'bounce') { Sfx.bounce(); FX.puff(ev.x, ev.y, 4, '#9bdcff'); }
        else if (ev.k === 'net') { Sfx.net(); FX.float('NET', ev.x, ev.y - 40, '#ffffff', 22); }
        else if (ev.k === 'point') {
            Sfx.whistle();
            FX.shake = 5; FX.slowmo = 30;
            const label = ev.why === 'out' ? 'OUT!' : ev.why === 'net' ? 'NET!' : (mine ? 'WINNER!' : 'MISSED…');
            FX.float(label, W / 2, 130, mine ? '#7dff9b' : '#ff6b6b', 40);
            if (mine) { Sfx.cheer(); FX.confetti(ev.i === 0 ? W * 0.25 : W * 0.75, 140, 40); }
        } else if (ev.k === 'serve') Sfx.beep();
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
        SportMech.steel(g, 0, 0, W, H, { top: '#1a1e2c', bot: '#0d1018', plate: 50 });
        SportMech.rim(g, CX0 - 30, CY0 - 30, CX1 + 30, CY1 + 20);
        // apron + court surface
        g.fillStyle = '#121828'; g.fillRect(CX0 - 30, CY0 - 30, CX1 - CX0 + 60, CY1 - CY0 + 50);
        const cg = g.createLinearGradient(0, CY0, 0, CY1);
        cg.addColorStop(0, '#16213a'); cg.addColorStop(1, '#1d2b4a');
        g.fillStyle = cg; g.fillRect(CX0, CY0, CX1 - CX0, CY1 - CY0);
        // scan lines across the court
        g.fillStyle = 'rgba(140,180,255,.04)';
        for (let y = CY0; y < CY1; y += 6) g.fillRect(CX0, y, CX1 - CX0, 2);
        for (const i of [0, 1]) {
            const x0 = i === 0 ? CX0 : NET_X, x1 = i === 0 ? NET_X : CX1;
            const tg = g.createLinearGradient(i === 0 ? CX0 : CX1, 0, NET_X, 0);
            tg.addColorStop(0, T[i].main + '2a'); tg.addColorStop(1, T[i].main + '00');
            g.fillStyle = tg; g.fillRect(x0, CY0, x1 - x0, CY1 - CY0);
        }
        const sx0 = NET_X - 170, sx1 = NET_X + 170;
        SportMech.neon(g, '#cfe6ff', 2, () => {
            g.rect(CX0, CY0, CX1 - CX0, CY1 - CY0);
            g.moveTo(sx0, CY0); g.lineTo(sx0, CY1); g.moveTo(sx1, CY0); g.lineTo(sx1, CY1);
            g.moveTo(sx0, MY); g.lineTo(sx1, MY);
            g.moveTo(CX0, MY); g.lineTo(CX0 + 10, MY); g.moveTo(CX1, MY); g.lineTo(CX1 - 10, MY);
        });
        // service-box corner emitters
        for (const [x, y] of [[CX0, CY0], [CX1, CY0], [CX0, CY1], [CX1, CY1]]) {
            g.fillStyle = '#2a2f3b'; g.fillRect(x - 5, y - 5, 10, 10);
            g.fillStyle = SportMech.GOLD; g.fillRect(x - 2, y - 2, 4, 4);
        }
        bgCache = c;
        return c;
    }
    function drawNet(tg) {
        // Pure top-down laser net across NET_X
        const top = CY0 - 16, bot = CY1 + 16;
        ctx.save();
        // Energy net plane (straight vertical line in top-down view)
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(155, 220, 255, 0.18)';
        ctx.fillRect(NET_X - 3, top, 6, bot - top);

        ctx.strokeStyle = '#9bdcff';
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.4 + 0.2 * Math.sin(tg / 3);
        const off = (tg * 0.8) % 8;
        ctx.beginPath();
        for (let y = top + off; y <= bot; y += 8) {
            ctx.moveTo(NET_X - 10, y); ctx.lineTo(NET_X + 10, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        // Laser beam center line
        SportMech.neon(ctx, '#9bdcff', 2.5, () => {
            ctx.moveTo(NET_X, top); ctx.lineTo(NET_X, bot);
        });

        // Top-down emitter pylons at top and bottom ends
        for (const py of [top, bot]) {
            ctx.fillStyle = '#1c202a';
            ctx.beginPath(); ctx.arc(NET_X, py, 7, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#8a93a6'; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = '#9bdcff'; ctx.shadowColor = '#9bdcff'; ctx.shadowBlur = 8;
            ctx.beginPath(); ctx.arc(NET_X, py, 3, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
        ctx.restore();
    }
    function drawShadow(x, y, r, z) {
        SportMech.shadow(ctx, x, y, r, z);
    }
    function drawBall(b) {
        if (Math.hypot(b.vx, b.vy) > 6) SportMech.streak(ctx, b, BR + 1, '#c8ff3d', 6);
        SportMech.ball(ctx, b, BR + 1, 'tennis');
    }
    function drawLanding(d, tg) {
        if (d.ph !== 'play' || d.nb !== 0 || d.last < 0) return;
        const land = predictBounce(d.b, 200);
        if (!land) return;
        const good = sideOf(land.x) !== d.last && inCourt(land.x, land.y);
        const col = good ? COL[1 - d.last].ring : '#ffffff';
        const pulse = 1 + Math.sin(tg / 5) * 0.08;
        ctx.save();
        ctx.strokeStyle = col; ctx.globalAlpha = 0.85; ctx.lineWidth = 2.5;
        ctx.shadowColor = col; ctx.shadowBlur = 8;
        ctx.setLineDash([6, 5]); ctx.lineDashOffset = -tg;
        ctx.beginPath(); ctx.arc(land.x, land.y, 14 * pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    }
    const MR = 20;   // drawn mech radius
    function drawPlayer(p, i, ball, tg, armed) {
        if (armed) {
            ctx.save(); ctx.globalAlpha = 0.6 + Math.sin(tg / 4) * 0.3;
            SportMech.neon(ctx, '#c8ff3d', 2.5, () => { ctx.arc(p.x, p.y, PR + 9, 0, Math.PI * 2); });
            ctx.restore();
        }
        const sw = p.sw || 0;
        const moving = Math.hypot(p.vx || 0, p.vy || 0) > 0.3;
        // Face toward ball or opponent's court
        let ang;
        const dx = ball.x - p.x, dy = ball.y - p.y;
        if (Math.hypot(dx, dy) < 160) ang = Math.atan2(dy, dx);
        else ang = fwdOf(i) > 0 ? 0 : Math.PI;

        const armAngle = sw > 0 ? (-1.6 + (1 - sw / 14) * 3.0) : -0.3;
        SportMech.mech(ctx, {
            x: p.x, y: p.y, r: MR, i, ang, t: tg,
            moving, weapon: 'tennis', arm: armAngle
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
        const ball = d ? d.b : { x: NET_X, y: MY, z: 0, vx: 0, vy: 0, vz: 0 };
        const pp = d ? d.p : [mkPlayer(0), mkPlayer(1)];
        if (d) drawLanding(d, tGlobal);
        drawShadow(ball.x, ball.y, BR + 1, ball.z);
        // players never cross the net and the ball can't pass through it below
        // the tape, so a fixed order is correct: net, players (y-sorted), ball.
        drawNet(tGlobal);
        [0, 1].sort((x, y) => pp[x].y - pp[y].y).forEach((i) => drawPlayer(pp[i], i, ball, tGlobal, d && d.arm[i]));
        if (d) drawBall(ball);
        FX.drawParts(ctx, dtf);
        ctx.restore();

        const sx = (x) => (flip() ? W - x : x);
        FX.drawFloats(ctx, dtf, sx);
        if (d) {
            const left = flip() ? 1 : 0;
            ctx.save();
            ctx.fillStyle = 'rgba(8,10,20,.82)';
            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(W / 2 - 90, 14, 180, 30, 12); else ctx.rect(W / 2 - 90, 14, 180, 30); ctx.fill();
            ctx.font = '900 20px Orbitron, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = COL[left].ring; ctx.fillText(String(d.sc[left]), W / 2 - 50, 30);
            ctx.fillStyle = '#ffffff'; ctx.fillText(':', W / 2, 30);
            ctx.fillStyle = COL[1 - left].ring; ctx.fillText(String(d.sc[1 - left]), W / 2 + 50, 30);
            // serve dot
            ctx.fillStyle = '#c8ff3d';
            const sl = (d.sv === left) ? -1 : 1;
            ctx.beginPath(); ctx.arc(W / 2 + sl * 76, 30, 4, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            if (d.ph === 'serve') {
                const mine = d.sv === M.idx;
                ctx.save();
                ctx.font = '800 17px "Plus Jakarta Sans", sans-serif'; ctx.textAlign = 'center';
                ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(5,8,20,.75)';
                const txt = L(mine ? 'serve_me' : 'serve_opp');
                ctx.strokeText(txt, W / 2, H - 16); ctx.fillStyle = '#ffffff'; ctx.fillText(txt, W / 2, H - 16);
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
        state: () => S, net: () => M.net,
        freezeBot(v) { botFrozen = v; },
        autoplay(lv) { autoHost = lv ? mkBrain(0, lv) : null; },
        setBall(x, y, z, vx, vy, vz, last, nb) { if (!S) return; S.ph = 'play'; S.pt = 0; Object.assign(S.b, { x, y, z, vx, vy, vz, rolled: 0 }); S.last = last; S.nb = nb || 0; },
        place(i, x, y) { Object.assign(S.p[i], { x, y }); },
        intend, arm, hitBall, predictContact, predictBounce,
        setRtt(ms) { M.rtt = ms; },
        C: { W, H, CX0, CX1, CY0, CY1, NET_X, NET_H, MY, REACH, WIN_SCORE, PERFECT_T }
    });
});
