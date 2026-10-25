/**
 * Link Kart 3D — 追尾视角（第一视角）卡丁车大奖赛 1v1 (client/kart3d/).
 *
 * Gameplay/netcode skeleton is the same as client/kart/ (top-down):
 *   - GameBot.session() → GameSession (WebRTC, unreliable channel) or a local
 *     fake session in `?bot=` mode. Host-authoritative: the host simulates
 *     both karts in 2D world space, the client only sends {type:'input'}.
 *   - Track = closed Catmull-Rom spline resampled at equal arc length; race
 *     progress (prog) is unwrapped arc length → laps / placing / wrong-way.
 *   - Mario-Kart extras: 🪙 coins (+top speed, lost when hit) and ⏩ dash pads.
 *
 * Renderer (pure Canvas 2D, no WebGL / libraries), SNES "Mode 7" style:
 *   1. Ground: the whole track is painted once into a top-down texture
 *      (Uint32Array, 0.8 texel/unit + a half-res mip). Every frame each row
 *      below the horizon is a straight line in world space, so a low-res
 *      buffer is filled with two adds per pixel and scaled up.
 *   2. Sky: gradient + wrap-around hills/clouds panned by the camera heading.
 *   3. World objects (candy fence, trees, item boxes, coins, karts, particles)
 *      are projected with the same pinhole camera and painter-sorted.
 *      Karts are tiny low-poly box models (back-face culled) so they read
 *      correctly from any angle; everything else is a billboard.
 *
 * Wire protocol (host → client, ~30 Hz, seq-numbered, may drop/reorder):
 *   {type:'state', n, r, st, cd, f, et, w, sc, k:[kart,kart], b, m, bx, c, fx}
 * client → host (~60 Hz): {type:'input', keys:{steer,gas,brake,drift,item}}
 * plus {type:'start'} / {type:'restart-request'}.
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    if (!location.hash || location.hash.length <= 1) {
        location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    }
    const qs = new URLSearchParams(location.search);
    const opponentName = qs.get('opponent') || '';
    const waitingText = opponentName ? `WAITING FOR ${opponentName.toUpperCase()}` : 'WAITING FOR PEER';
    const E2E = qs.get('e2e') === '1';

    const $ = id => document.getElementById(id);
    const canvas = $('game-canvas');
    const ctx = canvas.getContext('2d');
    const p1ScoreVal = $('p1-score'), p2ScoreVal = $('p2-score');
    const p1Label = $('p1-label'), p2Label = $('p2-label');
    const overlay = $('overlay');
    const lobbyScreen = $('lobby-screen'), readyScreen = $('ready-screen');
    const gameoverScreen = $('gameover-screen'), disconnectScreen = $('disconnect-screen');
    const inviteUrlInput = $('invite-url'), copyBtn = $('copy-btn');
    const startBtn = $('start-btn'), restartBtn = $('restart-btn'), lobbyBtn = $('lobby-btn');
    const connectionStateText = $('connection-state-text'), roleText = $('role-text');
    const winLossTitle = $('win-loss-title'), winnerMascot = $('winner-mascot'), finalScore = $('final-score');
    const statusText = $('status-text'), pingText = $('ping-text'), roleStatusText = $('role-status-text');

    inviteUrlInput.value = location.href;
    copyBtn.addEventListener('click', () => {
        inviteUrlInput.select();
        try { navigator.clipboard.writeText(location.href); } catch (e) { document.execCommand('copy'); }
        copyBtn.textContent = 'COPIED!';
        setTimeout(() => { copyBtn.textContent = 'COPY'; }, 2000);
    });

    // ==========================================
    // 常量
    // ==========================================
    const LAPS = 3;
    const KART_R = 17;
    const MAX_SPEED = 7.0;
    const BOOST_MAX = 10.2;
    const ACCEL = 0.16;
    const BRAKE = 0.3;
    const REV_MAX = -2.8;
    const TURN = 0.052;             // rad/frame at full lock
    const HW = 110;                 // asphalt half width
    const CURB = 12;
    const RUNOFF = 70;              // grass strip before the candy fence
    const WALL = HW + RUNOFF;
    const COUNTDOWN = 210;          // 3.5 s: READY · 3 · 2 · 1 · GO
    const DRIFT_LV = [0, 50, 105, 165];
    const DRIFT_BOOST = [0, 32, 58, 88];
    const SPARK = ['#ffffff', '#38bdf8', '#fb923c', '#e879f9'];
    const ITEMS = { banana: '🍌', missile: '🫧', mushroom: '🍄', shield: '🛡️' };
    const ITEM_KEYS = Object.keys(ITEMS);
    const COIN_MAX = 10, COIN_BONUS = 0.012, COIN_RESPAWN = 600;
    const COLORS = { 1: '#f472b6', 2: '#38bdf8' };
    const DRIVER = { 1: '🐰', 2: '🐱' };

    // ==========================================
    // 赛道：闭合 Catmull-Rom → 等弧长采样
    // ==========================================
    // validated offline: 9.4k lap, ≥444 units between non-adjacent sections (needs 2·WALL = 360)
    const CTRL = [
        [640, 2128], [1150, 2128], [1660, 2111], [2128, 2043], [2383, 1788], [2340, 1448], [2043, 1320],
        [1703, 1405], [1405, 1533], [1150, 1448], [1193, 1150], [1490, 980], [1830, 895], [2170, 853],
        [2425, 768], [2510, 513], [2255, 343], [1745, 343], [1150, 385], [640, 470], [343, 725],
        [385, 1108], [598, 1363], [555, 1660], [428, 1915]
    ];
    const TRACK = buildTrack(CTRL, 16);
    const N = TRACK.pts.length;
    const L = TRACK.len;
    const S0 = 400;                 // start/finish line (arc length)

    function buildTrack(ctrl, step) {
        const dense = [];
        const n = ctrl.length;
        for (let i = 0; i < n; i++) {
            const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
            for (let k = 0; k < 40; k++) {
                const t = k / 40, t2 = t * t, t3 = t2 * t;
                const cr = j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t +
                    (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
                dense.push([cr(0), cr(1)]);
            }
        }
        const cum = [0];
        for (let i = 1; i < dense.length; i++) {
            cum[i] = cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
        }
        const last = dense[dense.length - 1];
        const total = cum[cum.length - 1] + Math.hypot(dense[0][0] - last[0], dense[0][1] - last[1]);
        const count = Math.round(total / step);
        const seg = total / count;
        const pts = [];
        let j = 0;
        for (let i = 0; i < count; i++) {
            const s = i * seg;
            while (j < dense.length - 1 && cum[j + 1] < s) j++;
            const a = dense[j], b = dense[(j + 1) % dense.length];
            const segLen = (j + 1 < dense.length ? cum[j + 1] : total) - cum[j];
            const f = segLen > 0 ? (s - cum[j]) / segLen : 0;
            pts.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, tx: 0, ty: 0, a: 0 });
        }
        for (let i = 0; i < count; i++) {
            const p = pts[(i - 1 + count) % count], q = pts[(i + 1) % count];
            const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
            pts[i].tx = (q.x - p.x) / l;
            pts[i].ty = (q.y - p.y) / l;
            pts[i].a = Math.atan2(pts[i].ty, pts[i].tx);
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }
        return { pts, len: seg * count, seg, bounds: { minX, minY, maxX, maxY } };
    }

    const wrapS = s => ((s % L) + L) % L;
    const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
    const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
    const r1 = v => Math.round(v * 10) / 10;
    const r2 = v => Math.round(v * 100) / 100;

    /** World position at arc length s, `lat` units along the left normal (-ty, tx). */
    function pointAt(s, lat) {
        const u = wrapS(s) / TRACK.seg;
        const i = Math.floor(u) % N, f = u - Math.floor(u);
        const a = TRACK.pts[i], b = TRACK.pts[(i + 1) % N];
        const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
        return { x: x - a.ty * (lat || 0), y: y + a.tx * (lat || 0), tx: a.tx, ty: a.ty, a: a.a, idx: i };
    }
    const tangentAngle = s => TRACK.pts[Math.floor(wrapS(s) / TRACK.seg) % N].a;

    /** Nearest centreline point. hint < 0 → full scan, else ±14 samples around it. */
    function project(x, y, hint) {
        const P = TRACK.pts;
        const full = hint == null || hint < 0;
        const from = full ? 0 : hint - 14, to = full ? N : hint + 14;
        let best = 0, bd = Infinity, bf = 0;
        for (let k = from; k < to; k++) {
            const i = ((k % N) + N) % N, a = P[i], b = P[(i + 1) % N];
            const ex = b.x - a.x, ey = b.y - a.y;
            const f = clamp(((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey || 1), 0, 1);
            const dx = x - (a.x + ex * f), dy = y - (a.y + ey * f);
            const d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; bf = f; }
        }
        const a = P[best], b = P[(best + 1) % N];
        const px = a.x + (b.x - a.x) * bf, py = a.y + (b.y - a.y) * bf;
        return { idx: best, s: (best + bf) * TRACK.seg, dist: Math.sqrt(bd), px, py, lat: (x - px) * -a.ty + (y - py) * a.tx };
    }
    const sAt = (x, y) => project(x, y, -1).s;

    // 道具盒：两排 × 4
    const BOXES = [];
    for (const s of [sAt(1830, 895), sAt(385, 1108)]) for (const lat of [-66, -22, 22, 66]) BOXES.push(pointAt(s, lat));
    // 金币：四串 × 5
    const COINS = [];
    for (const [x, y, lat] of [[1250, 2128, 55], [2000, 350, -50], [1300, 1490, 0], [380, 920, 45]]) {
        const s = sAt(x, y);
        for (let i = 0; i < 5; i++) COINS.push(pointAt(s + i * 42, lat));
    }
    // 加速带
    const PADS = [[1650, 2111, -55], [1400, 372, 50], [1620, 948, -45]].map(([x, y, lat]) => {
        const s = sAt(x, y);
        return Object.assign(pointAt(s, lat), { s, lat });
    });

    // ==========================================
    // 状态
    // ==========================================
    function createKart(id) {
        const sGrid = S0 - 90;
        const p = pointAt(sGrid, id === 1 ? -45 : 45);
        return {
            id, x: p.x, y: p.y, h: p.a, vx: 0, vy: 0,
            idx: p.idx, s: sGrid, prog: sGrid - S0,
            item: null, roll: 0, spin: 0, spinA: 0, inv: 0, shield: 0, boost: 0,
            drift: 0, charge: 0, fin: 0, off: 0, wrong: 0, gasAt: 0, lastItem: false,
            coins: 0, pad: 0
        };
    }

    function createInitialState(score, race) {
        return {
            p1: createKart(1), p2: createKart(2),
            bananas: [], missiles: [], boxes: BOXES.map(() => 0), coins: COINS.map(() => 0),
            score: score || { p1: 0, p2: 0 },
            status: 'lobby', cd: COUNTDOWN, frame: 0, endTimer: 0, winner: 0, race: race || 0
        };
    }

    let gs = createInitialState();
    let myRole = null;
    let running = false;
    let netSendInterval = null;
    let animTick = 0;
    let pendingFx = [];
    let particles = [], popTexts = [], banner = null;
    let shake = 0;
    let netSeq = 0, lastSeq = -1;
    let gameOverShown = false;
    const smooth = { 1: { x: 0, y: 0, h: 0 }, 2: { x: 0, y: 0, h: 0 } };   // client visual correction offsets
    const hop = { 1: 0, 2: 0 };     // visual hop timers (drift start)

    const myId = () => (myRole === 'client' ? 2 : 1);
    const kartOf = id => (id === 1 ? gs.p1 : gs.p2);

    // ==========================================
    // 输入（镜头在车后，左右 = 车头左右，天然直观）
    // ==========================================
    const keys = { up: false, down: false, left: false, right: false, drift: false, item: false };
    const touch = { used: false, x: 0, y: 0, active: false, drift: false, item: false };
    let itemLatch = 0;
    const clientInput = { steer: 0, gas: false, brake: false, drift: false, item: false };

    function setKey(key, down) {
        const k = key.toLowerCase();
        if (k === 'w' || k === 'arrowup') keys.up = down;
        else if (k === 's' || k === 'arrowdown') keys.down = down;
        else if (k === 'a' || k === 'arrowleft') keys.left = down;
        else if (k === 'd' || k === 'arrowright') keys.right = down;
        else if (k === 'shift' || k === 'k' || k === 'x') keys.drift = down;
        else if (k === ' ' || k === 'j' || k === 'z' || k === 'e') {
            if (down && !keys.item) itemLatch = performance.now() + 120;
            keys.item = down;
        }
    }
    window.addEventListener('keydown', e => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key) && running) e.preventDefault();
        setKey(e.key, true);
    });
    window.addEventListener('keyup', e => setKey(e.key, false));
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

    function readInput() {
        const kbSteer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        // stick: x → steering (small dead zone, full lock at 75 %), pull down → brake/reverse
        const tx = touch.active ? touch.x : 0;
        const ts = Math.abs(tx) < 0.12 ? 0 : clamp((tx - Math.sign(tx) * 0.12) / 0.63, -1, 1);
        const steer = ts !== 0 ? ts : kbSteer;
        const touchBrake = touch.active && touch.y > 0.55 && Math.abs(touch.y) > Math.abs(touch.x);
        const brake = keys.down || touchBrake;
        // touch: auto-gas while racing; during the countdown pushing the stick up = gas (rocket start)
        const touchGas = touch.used && !brake && (gs.status === 'racing' || (touch.active && touch.y < -0.45));
        return {
            steer: r2(steer), gas: keys.up || touchGas, brake,
            drift: keys.drift || touch.drift,
            item: keys.item || touch.item || performance.now() < itemLatch
        };
    }

    GameFit.joystick($('move-stick'), $('move-knob'), (x, y, active) => {
        touch.used = true;
        touch.active = !!active;
        touch.x = active ? clamp(x, -1, 1) : 0;
        touch.y = active ? clamp(y, -1, 1) : 0;
    }, { radius: 48 });
    GameFit.touchButtons(document.querySelector('.touch-actions'), (action, down) => {
        touch.used = true;
        if (action === 'item' && down) itemLatch = performance.now() + 120;
        touch[action] = down;
    });

    const view = GameFit.view(canvas, {
        width: canvas.width, height: canvas.height,
        adaptive: { short: 450, min: 0.62, max: 2.1 },
        onResize: () => render()
    });

    // ==========================================
    // 网络
    // ==========================================
    connectionStateText.textContent = '正在连接信号服务器...';
    const session = GameBot.session({
        gameFolder: 'kart3d',
        dataChannelOptions: { ordered: false, maxRetransmits: 0 },
        onSignalingStatus(status) {
            if (status === 'open') {
                statusText.textContent = waitingText;
                statusText.className = 'status-online';
                connectionStateText.textContent = '已连接信令服务，等待对手通过链接加入...';
            } else if (status === 'closed') {
                statusText.textContent = 'OFFLINE';
                statusText.className = 'status-offline';
                connectionStateText.textContent = '信令连接已断开，正在重连...';
            }
        },
        onRole(role) {
            myRole = role;
            roleStatusText.textContent = role.toUpperCase();
            if (role === 'host') {
                p1Label.textContent = '🐰 草莓兔 (YOU)';
                p2Label.textContent = '🐱 汽水猫 (FOE)';
                roleText.innerHTML = '你是 <strong>Host (🐰 草莓兔)</strong>，粉色赛车。<br>对手已就位，点击下方按钮发车！';
            } else {
                p1Label.textContent = '🐰 草莓兔 (HOST)';
                p2Label.textContent = '🐱 汽水猫 (YOU)';
                roleText.innerHTML = '你是 <strong>Client (🐱 汽水猫)</strong>，蓝色赛车。<br>等待房主点击发车...';
            }
            snapCam();
            render();
        },
        onChannelOpen() {
            showScreen(readyScreen);
            startBtn.classList.toggle('hidden', myRole !== 'host');
            startBtn.disabled = myRole !== 'host';
        },
        onPeerConnected() {
            statusText.textContent = 'P2P ESTABLISHED';
            statusText.className = 'status-online';
        },
        onPeerReconnecting() {
            statusText.textContent = 'RECONNECTING…';
            statusText.className = 'status-offline';
        },
        onPeerDisconnected() {
            stopLoops();
            showScreen(disconnectScreen);
            statusText.textContent = waitingText;
            statusText.className = 'status-online';
            pingText.textContent = '-- ms';
        },
        onRtt(ms) { pingText.textContent = `${ms} ms`; },
        onMessage: handleGameData
    });
    const send = data => session.send(data);

    function showScreen(el) {
        overlay.classList.toggle('hidden', !el);
        for (const s of [lobbyScreen, readyScreen, gameoverScreen, disconnectScreen]) s.classList.toggle('hidden', s !== el);
    }

    function handleGameData(msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'state') {
            if (myRole !== 'client') return;
            if (msg.r !== gs.race && (msg.st === 'countdown' || msg.st === 'racing')) {
                beginRace(msg.sc, msg.r);      // lost 'start' packet → the state stream starts us anyway
            }
            if (msg.r !== gs.race || typeof msg.n !== 'number' || msg.n <= lastSeq) return;
            lastSeq = msg.n;
            applySnapshot(msg);
        } else if (msg.type === 'input') {
            if (myRole !== 'host' || !msg.keys) return;
            const k = msg.keys;
            clientInput.steer = typeof k.steer === 'number' && isFinite(k.steer) ? clamp(k.steer, -1, 1) : 0;
            clientInput.gas = !!k.gas;
            clientInput.brake = !!k.brake;
            clientInput.drift = !!k.drift;
            clientInput.item = !!k.item;
        } else if (msg.type === 'start') {
            if (myRole === 'client' && msg.r !== gs.race) beginRace(msg.score, msg.r);
        } else if (msg.type === 'restart-request') {
            if (myRole === 'host' && gs.status === 'gameover') hostStart();
        }
    }

    function applySnapshot(m) {
        const prevStatus = gs.status;
        gs.status = m.st;
        gs.cd = m.cd; gs.frame = m.f; gs.endTimer = m.et; gs.winner = m.w;
        if (m.sc) gs.score = m.sc;
        for (let i = 0; i < 2; i++) {
            const k = gs[i ? 'p2' : 'p1'], n = m.k && m.k[i];
            if (!n) continue;
            const o = smooth[k.id];
            o.x += k.x - n.x; o.y += k.y - n.y; o.h += wrapA(k.h - n.h);
            if (Math.hypot(o.x, o.y) > 120) { o.x = o.y = 0; o.h = 0; }
            Object.assign(k, n);
        }
        gs.bananas = (m.b || []).map(b => ({ x: b[0], y: b[1] }));
        gs.missiles = (m.m || []).map(b => ({ x: b[0], y: b[1], h: b[2] }));
        if (Array.isArray(m.bx)) gs.boxes = m.bx;
        if (Array.isArray(m.c)) gs.coins = m.c;
        p1ScoreVal.textContent = gs.score.p1;
        p2ScoreVal.textContent = gs.score.p2;
        if (Array.isArray(m.fx)) m.fx.forEach(triggerFx);
        if (gs.status === 'gameover' && prevStatus !== 'gameover') showGameOver();
    }

    function packKart(k) {
        return {
            id: k.id, x: r1(k.x), y: r1(k.y), h: r2(k.h), vx: r2(k.vx), vy: r2(k.vy),
            idx: k.idx, s: r1(k.s), prog: r1(k.prog), item: k.item, roll: k.roll, spin: k.spin,
            spinA: r2(k.spinA), inv: k.inv, shield: k.shield, boost: k.boost, drift: k.drift,
            charge: Math.round(k.charge), fin: k.fin, off: k.off, wrong: k.wrong, coins: k.coins
        };
    }

    function sendState() {
        send({
            type: 'state', n: ++netSeq, r: gs.race, st: gs.status, cd: gs.cd, f: gs.frame,
            et: gs.endTimer, w: gs.winner, sc: gs.score,
            k: [packKart(gs.p1), packKart(gs.p2)],
            b: gs.bananas.map(b => [r1(b.x), r1(b.y)]),
            m: gs.missiles.map(m => [r1(m.x), r1(m.y), r2(m.h)]),
            bx: gs.boxes.map(t => (t > 0 ? 1 : 0)),
            c: gs.coins.map(t => (t > 0 ? 1 : 0)),
            fx: pendingFx.length ? pendingFx : undefined
        });
        pendingFx = [];
    }

    lobbyBtn.addEventListener('click', () => location.reload());
    startBtn.addEventListener('click', () => {
        if (myRole === 'host' && gs.status !== 'countdown' && gs.status !== 'racing') hostStart();
    });
    restartBtn.addEventListener('click', () => {
        if (myRole === 'host') { hostStart(); return; }
        for (let i = 0; i < 3; i++) setTimeout(() => send({ type: 'restart-request' }), i * 120);
        restartBtn.textContent = 'AWAITING HOST...';
        restartBtn.disabled = true;
    });

    function hostStart() {
        beginRace(gs.score, gs.race + 1);
        send({ type: 'start', score: gs.score, r: gs.race });
        clearInterval(netSendInterval);
        netSendInterval = setInterval(sendState, 1000 / 30);
    }

    function beginRace(score, race) {
        gs = createInitialState(score || { p1: 0, p2: 0 }, race);
        gs.status = 'countdown';
        particles = []; popTexts = []; banner = null; pendingFx = [];
        gameOverShown = false;
        smooth[1] = { x: 0, y: 0, h: 0 }; smooth[2] = { x: 0, y: 0, h: 0 };
        botReset();
        snapCam();
        p1ScoreVal.textContent = gs.score.p1;
        p2ScoreVal.textContent = gs.score.p2;
        restartBtn.textContent = 'RACE AGAIN';
        restartBtn.disabled = false;
        showScreen(null);
        canvas.focus({ preventScroll: true });
        if (myRole === 'client') {
            clearInterval(netSendInterval);
            netSendInterval = setInterval(() => {
                if (gs.status === 'countdown' || gs.status === 'racing' || gs.status === 'finished') {
                    send({ type: 'input', keys: readInput() });
                }
            }, 1000 / 60);
        }
        startLoop();
    }

    // ==========================================
    // 主循环：rAF 渲染 + 60 Hz 固定步长
    // ==========================================
    let lastT = 0, acc = 0, loopGen = 0;
    function startLoop() {
        const gen = ++loopGen;
        running = true;
        lastT = performance.now();
        acc = 0;
        requestAnimationFrame(t => frame(t, gen));
    }
    function stopLoops() {
        running = false;
        clearInterval(netSendInterval);
        netSendInterval = null;
    }
    function frame(t, gen) {
        if (!running || gen !== loopGen) return;
        acc += Math.min(250, t - lastT);
        lastT = t;
        let steps = 0;
        while (acc >= 1000 / 60 && steps < 5) {
            if (myRole === 'host') hostStep(); else clientStep();
            acc -= 1000 / 60;
            steps++;
        }
        if (steps === 5) acc = 0;
        render();
        requestAnimationFrame(t2 => frame(t2, gen));
    }

    // ==========================================
    // Host 物理
    // ==========================================
    function emitFx(fx) {
        pendingFx.push(fx);
        triggerFx(fx);
    }

    function hostStep() {
        updateEffects();
        if (e2eFreeze) return;
        if (gs.status === 'countdown') {
            if (GameBot.enabled) botStep();
            gs.cd--;
            for (const [k, inp] of [[gs.p1, readInput()], [gs.p2, clientInput]]) {
                if (inp.gas) { if (!k.gasAt) k.gasAt = gs.cd; } else k.gasAt = 0;
            }
            if (gs.cd % 60 === 0 && gs.cd > 0 && gs.cd <= 180) emitFx({ kind: 'beep' });
            if (gs.cd <= 0) {
                gs.status = 'racing';
                for (const k of [gs.p1, gs.p2]) {
                    if (k.gasAt && k.gasAt <= 28) {
                        k.boost = 55;
                        emitFx({ kind: 'boost', id: k.id, x: k.x, y: k.y, lv: 2, text: 'ROCKET START!' });
                    }
                }
                emitFx({ kind: 'go' });
            }
            return;
        }
        if (gs.status !== 'racing' && gs.status !== 'finished') return;
        gs.frame++;
        if (GameBot.enabled) botStep();
        stepKart(gs.p1, readInput(), gs.p2);
        stepKart(gs.p2, clientInput, gs.p1);
        collideKarts(gs.p1, gs.p2);
        stepBoxes();
        stepCoins();
        stepBananas();
        stepMissiles();
        if (gs.status === 'finished' && --gs.endTimer <= 0) {
            gs.status = 'gameover';
            sendState();
            showGameOver();
        }
    }

    const topSpeed = k => MAX_SPEED * (1 + COIN_BONUS * (k.coins || 0));

    function stepKart(k, inp, other) {
        if (k.spin > 0) k.spin--;
        if (k.inv > 0) k.inv--;
        if (k.shield > 0) k.shield--;
        if (k.boost > 0) k.boost--;
        if (k.pad > 0) k.pad--;
        if (k.spin <= 0) k.spinA *= 0.7;

        let steer = clamp(inp.steer || 0, -1, 1), gas = !!inp.gas, brake = !!inp.brake;
        if (k.fin) { gas = false; brake = false; steer *= 0.5; }
        if (k.spin > 0) { gas = brake = false; steer = 0; k.spinA += 0.42; }

        const pr0 = project(k.x, k.y, k.idx);
        k.off = pr0.dist > HW + 4 ? 1 : 0;

        // ⏩ dash pad
        if (k.pad <= 0 && !k.fin) {
            for (const p of PADS) {
                let ds = pr0.s - p.s;
                if (ds > L / 2) ds -= L;
                if (ds < -L / 2) ds += L;
                if (Math.abs(ds) < 32 && Math.abs(pr0.lat - p.lat) < 32) {
                    k.boost = Math.max(k.boost, 48);
                    k.pad = 30;
                    emitFx({ kind: 'boost', id: k.id, x: k.x, y: k.y, lv: 2, text: 'DASH!' });
                    break;
                }
            }
        }

        const ch = Math.cos(k.h), sh = Math.sin(k.h);
        let vf = k.vx * ch + k.vy * sh;
        let vl = -k.vx * sh + k.vy * ch;
        const offSlow = k.off && k.boost <= 0;
        const top = topSpeed(k);
        const maxF = k.boost > 0 ? BOOST_MAX : (offSlow ? top * 0.5 : top);

        if (k.boost > 0) vf = Math.min(BOOST_MAX, vf + 0.6);
        else if (gas) { if (vf < maxF) vf = Math.min(maxF, vf + (vf < 0 ? BRAKE : ACCEL)); }
        else if (brake) vf = vf > 0 ? Math.max(0, vf - BRAKE) : Math.max(REV_MAX, vf - 0.09);
        else vf *= 0.986;
        if (vf > maxF) vf = Math.max(maxF, vf * 0.95);
        if (k.spin > 0) vf *= 0.93;

        // ---- 漂移 / 迷你加速 ----
        if (inp.drift && !k.drift && Math.abs(steer) > 0.3 && vf > 3.6 && k.spin <= 0 && !k.fin) {
            k.drift = steer > 0 ? 1 : -1;
            k.charge = 0;
            emitFx({ kind: 'hop', id: k.id, x: k.x, y: k.y });
        }
        if (k.drift && (!inp.drift || vf < 2.4 || k.spin > 0)) {
            const lv = driftLevel(k.charge);
            if (lv && k.spin <= 0) {
                k.boost = Math.max(k.boost, DRIFT_BOOST[lv]);
                emitFx({ kind: 'boost', id: k.id, x: k.x, y: k.y, lv, text: ['', 'BOOST', 'SUPER!', 'ULTRA!!'][lv] });
            }
            k.drift = 0;
            k.charge = 0;
        }
        let turn;
        if (k.drift) {
            turn = TURN * 1.08 * k.drift * clamp(0.62 + 0.4 * steer * k.drift, 0.22, 1.02);
            k.charge += 1 + (steer * k.drift > 0.4 ? 0.7 : 0);
        } else {
            turn = TURN * steer * (k.off ? 0.85 : 1);
        }
        if (k.spin <= 0) k.h = wrapA(k.h + turn * clamp(vf / 2.6, -1, 1));
        vl *= k.drift ? 0.94 : 0.8;

        k.vx = ch * vf - sh * vl;
        k.vy = sh * vf + ch * vl;
        k.x += k.vx;
        k.y += k.vy;

        // ---- 围栏 ----
        const pr = project(k.x, k.y, pr0.idx);
        const lim = WALL - KART_R;
        if (pr.dist > lim) {
            const nx = (k.x - pr.px) / pr.dist, ny = (k.y - pr.py) / pr.dist;
            k.x = pr.px + nx * lim;
            k.y = pr.py + ny * lim;
            const vn = k.vx * nx + k.vy * ny;
            if (vn > 0) {
                k.vx -= nx * vn * 1.4;
                k.vy -= ny * vn * 1.4;
                k.vx *= 0.82; k.vy *= 0.82;
                if (vn > 2.2) emitFx({ kind: 'bump', id: k.id, x: k.x + nx * KART_R, y: k.y + ny * KART_R });
            }
        }

        // ---- 进度 / 圈数 ----
        const pr2 = project(k.x, k.y, pr.idx);
        let ds = pr2.s - k.s;
        if (ds > L / 2) ds -= L;
        if (ds < -L / 2) ds += L;
        const lapBefore = Math.floor(k.prog / L);
        k.prog += ds;
        k.s = pr2.s;
        k.idx = pr2.idx;
        const lapNow = Math.floor(k.prog / L);
        const along = Math.cos(k.h - TRACK.pts[k.idx].a);
        k.wrong = !k.fin && k.spin <= 0 && along < -0.35 && Math.hypot(k.vx, k.vy) > 1 ? Math.min(k.wrong + 1, 999) : 0;

        if (!k.fin && lapNow > lapBefore && k.prog > 0) {
            if (lapNow >= LAPS) {
                k.fin = gs.frame;
                if (!gs.winner) {
                    gs.winner = k.id;
                    gs.score[k.id === 1 ? 'p1' : 'p2']++;
                    p1ScoreVal.textContent = gs.score.p1;
                    p2ScoreVal.textContent = gs.score.p2;
                    gs.status = 'finished';
                    gs.endTimer = 150;
                }
                emitFx({ kind: 'finish', id: k.id, x: k.x, y: k.y });
            } else {
                emitFx({ kind: 'lap', id: k.id, x: k.x, y: k.y, lap: lapNow + 1 });
            }
        }

        // ---- 道具 ----
        if (k.roll > 0 && --k.roll === 0) k.item = rollItem(k, other);
        const pressed = !!inp.item && !k.lastItem;
        k.lastItem = !!inp.item;
        if (pressed && k.item && k.spin <= 0 && gs.status === 'racing') useItem(k);
    }

    function driftLevel(c) {
        return c >= DRIFT_LV[3] ? 3 : c >= DRIFT_LV[2] ? 2 : c >= DRIFT_LV[1] ? 1 : 0;
    }

    function collideKarts(a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d >= KART_R * 2) return;
        const nx = dx / d, ny = dy / d, push = (KART_R * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) {
            const j = rel * 0.9;
            const wa = b.boost > 0 && a.boost <= 0 ? 1.5 : (a.boost > 0 && b.boost <= 0 ? 0.5 : 1);
            a.vx -= nx * j * wa; a.vy -= ny * j * wa;
            b.vx += nx * j * (2 - wa); b.vy += ny * j * (2 - wa);
            if (rel > 1.5) emitFx({ kind: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
    }

    function rollItem(k, other) {
        const gap = other.prog - k.prog;
        const table = gap <= 0
            ? [['banana', 45], ['shield', 25], ['missile', 20], ['mushroom', 10]]
            : gap > 700
                ? [['mushroom', 45], ['missile', 40], ['shield', 10], ['banana', 5]]
                : [['missile', 35], ['mushroom', 30], ['banana', 15], ['shield', 20]];
        let r = Math.random() * 100;
        for (const [it, w] of table) { if ((r -= w) < 0) return it; }
        return 'mushroom';
    }

    function useItem(k) {
        const it = k.item;
        k.item = null;
        const ch = Math.cos(k.h), sh = Math.sin(k.h);
        if (it === 'banana') {
            gs.bananas.push({ x: k.x - ch * 30, y: k.y - sh * 30, owner: k.id, t: 0 });
            if (gs.bananas.length > 8) gs.bananas.shift();
        } else if (it === 'missile') {
            gs.missiles.push({ x: k.x + ch * 30, y: k.y + sh * 30, h: k.h, owner: k.id, idx: k.idx, life: 400, t: 0 });
        } else if (it === 'mushroom') {
            k.boost = Math.max(k.boost, 75);
            emitFx({ kind: 'boost', id: k.id, x: k.x, y: k.y, lv: 2, text: 'DASH!' });
        } else if (it === 'shield') {
            k.shield = 480;
        }
        emitFx({ kind: 'use', id: k.id, item: it, x: k.x, y: k.y });
    }

    /** Banana / missile contact. Returns true if the hazard is consumed. */
    function hitKart(k, cause) {
        if (k.fin) return false;
        if (k.inv > 0) return true;
        if (k.shield > 0) {
            k.shield = 0;
            k.inv = 30;
            emitFx({ kind: 'shield', id: k.id, x: k.x, y: k.y });
            return true;
        }
        k.spin = 55;
        k.inv = 100;
        k.drift = 0; k.charge = 0; k.boost = 0;
        const lost = Math.min(3, k.coins);
        k.coins -= lost;
        emitFx({ kind: 'spin', id: k.id, x: k.x, y: k.y, cause, lost });
        return true;
    }

    function stepBoxes() {
        for (let i = 0; i < BOXES.length; i++) {
            if (gs.boxes[i] > 0) { gs.boxes[i]--; continue; }
            const b = BOXES[i];
            for (const k of [gs.p1, gs.p2]) {
                if (Math.hypot(k.x - b.x, k.y - b.y) < KART_R + 14) {
                    gs.boxes[i] = 240;
                    if (!k.item && !k.roll && !k.fin) k.roll = 50;
                    emitFx({ kind: 'box', id: k.id, x: b.x, y: b.y });
                    break;
                }
            }
        }
    }

    function stepCoins() {
        for (let i = 0; i < COINS.length; i++) {
            if (gs.coins[i] > 0) { gs.coins[i]--; continue; }
            const c = COINS[i];
            for (const k of [gs.p1, gs.p2]) {
                if (!k.fin && Math.hypot(k.x - c.x, k.y - c.y) < KART_R + 10) {
                    gs.coins[i] = COIN_RESPAWN;
                    k.coins = Math.min(COIN_MAX, k.coins + 1);
                    emitFx({ kind: 'coin', id: k.id, x: c.x, y: c.y });
                    break;
                }
            }
        }
    }

    function stepBananas() {
        gs.bananas = gs.bananas.filter(b => {
            b.t++;
            for (const k of [gs.p1, gs.p2]) {
                if ((b.t > 25 || b.owner !== k.id) && Math.hypot(k.x - b.x, k.y - b.y) < KART_R + 8) {
                    if (hitKart(k, 'banana')) return false;
                }
            }
            return true;
        });
    }

    function stepMissiles() {
        gs.missiles = gs.missiles.filter(m => {
            m.t++;
            if (--m.life <= 0) { emitFx({ kind: 'pop', x: m.x, y: m.y }); return false; }
            const pr = project(m.x, m.y, m.idx);
            m.idx = pr.idx;
            const tgt = kartOf(m.owner === 1 ? 2 : 1);
            const dx = tgt.x - m.x, dy = tgt.y - m.y, d = Math.hypot(dx, dy);
            let want, rate;
            if (!tgt.fin && d < 320 && Math.cos(Math.atan2(dy, dx) - m.h) > -0.2) {
                want = Math.atan2(dy, dx); rate = 0.13;
            } else {
                const p = pointAt(pr.s + 90, 0);
                want = Math.atan2(p.y - m.y, p.x - m.x); rate = 0.09;
            }
            m.h = wrapA(m.h + clamp(wrapA(want - m.h), -rate, rate));
            m.x += Math.cos(m.h) * 11.5;
            m.y += Math.sin(m.h) * 11.5;
            if (project(m.x, m.y, m.idx).dist > WALL - 6) { emitFx({ kind: 'pop', x: m.x, y: m.y }); return false; }
            for (const k of [gs.p1, gs.p2]) {
                if ((m.t > 40 || m.owner !== k.id) && Math.hypot(k.x - m.x, k.y - m.y) < KART_R + 9) {
                    if (hitKart(k, 'missile')) { emitFx({ kind: 'pop', x: m.x, y: m.y }); return false; }
                }
            }
            for (let i = 0; i < gs.bananas.length; i++) {
                const b = gs.bananas[i];
                if (Math.hypot(b.x - m.x, b.y - m.y) < 18) {
                    gs.bananas.splice(i, 1);
                    emitFx({ kind: 'pop', x: m.x, y: m.y });
                    return false;
                }
            }
            return true;
        });
    }

    // ==========================================
    // Client：航位推测 + 平滑
    // ==========================================
    function clientStep() {
        updateEffects();
        if (gs.status === 'racing' || gs.status === 'finished') {
            for (const k of [gs.p1, gs.p2]) {
                k.x += k.vx; k.y += k.vy;
                if (k.spin > 0) k.spinA += 0.42;
            }
            for (const m of gs.missiles) { m.x += Math.cos(m.h) * 11.5; m.y += Math.sin(m.h) * 11.5; }
            gs.frame++;
        } else if (gs.status === 'countdown' && gs.cd > 0) {
            gs.cd--;
        }
        for (const id of [1, 2]) {
            const o = smooth[id];
            o.x *= 0.8; o.y *= 0.8; o.h *= 0.75;
        }
    }

    // ==========================================
    // 人机：沿赛道看前方目标点 + 内线 + 漂移 + 道具策略
    // ==========================================
    const BOT = {
        speed: GameBot.pick({ easy: 0.8, normal: 0.91, hard: 1 }),
        noise: GameBot.pick({ easy: 0.28, normal: 0.1, hard: 0.03 }),
        drift: GameBot.pick({ easy: 0, normal: 0.55, hard: 1 }),
        line: GameBot.pick({ easy: 0, normal: 0.6, hard: 1 }),
        dodge: GameBot.pick({ easy: 0, normal: 0.5, hard: 1 }),
        rocket: GameBot.level === 'hard'
    };
    let bot;
    function botReset() {
        bot = { noise: 0, noiseT: 0, drifting: false, stuck: 0, reverse: 0, itemCd: 60, hold: 0, dodgeLat: 0 };
    }
    botReset();

    function botStep() {
        const k = gs.p2, o = gs.p1;
        const inp = { steer: 0, gas: false, brake: false, drift: false, item: false };
        if (gs.status === 'countdown') {
            inp.gas = BOT.rocket && gs.cd <= 22;
            GameBot.deliver({ type: 'input', keys: inp });
            return;
        }
        if (e2eFreezeBot || k.fin || gs.status !== 'racing') { GameBot.deliver({ type: 'input', keys: inp }); return; }

        const ch = Math.cos(k.h), sh = Math.sin(k.h);
        const vf = k.vx * ch + k.vy * sh;
        const look = 70 + Math.max(0, vf) * 14;
        const a0 = tangentAngle(k.s + look), a1 = tangentAngle(k.s + look + 170);
        const curv = wrapA(a1 - a0);
        let lat = Math.sign(curv) * Math.min(60, Math.abs(curv) * 90) * BOT.line;

        if (BOT.dodge && Math.random() < BOT.dodge) {
            for (const b of gs.bananas) {
                const pb = project(b.x, b.y, k.idx);
                let ahead = pb.s - k.s;
                if (ahead < -L / 2) ahead += L;
                if (ahead > 0 && ahead < 280 && Math.abs(pb.lat - lat) < 44) lat = pb.lat > 0 ? pb.lat - 58 : pb.lat + 58;
            }
        }
        bot.dodgeLat += (lat - bot.dodgeLat) * 0.15;
        const tp = pointAt(k.s + look, clamp(bot.dodgeLat, -HW + 24, HW - 24));
        const diff = wrapA(Math.atan2(tp.y - k.y, tp.x - k.x) - k.h);
        if (--bot.noiseT <= 0) { bot.noiseT = 18; bot.noise = GameBot.gauss() * BOT.noise; }

        inp.steer = clamp(diff * 3 + bot.noise, -1, 1);
        inp.gas = vf < topSpeed(k) * BOT.speed || k.boost > 0;
        if (Math.abs(curv) > 1.2 && vf > 5.6 && !BOT.drift) inp.gas = false;

        if (BOT.drift && !bot.drifting && Math.abs(curv) > 0.55 && vf > 4.8 && Math.abs(diff) > 0.12 && Math.random() < BOT.drift * 0.3) {
            bot.drifting = true;
        }
        if (bot.drifting) {
            inp.drift = true;
            if (!k.drift) inp.steer = Math.sign(diff || curv) || 1;
            const lvWant = Math.abs(curv) > 1 ? 2 : 1;
            if ((k.drift && Math.abs(curv) < 0.25 && driftLevel(k.charge) >= 1) ||
                driftLevel(k.charge) >= lvWant + 1 || Math.abs(diff) > 0.9 || (k.drift && k.drift * diff < -0.35)) {
                bot.drifting = false;
                inp.drift = false;
            }
        }

        bot.stuck = Math.abs(vf) < 0.6 && k.spin <= 0 ? bot.stuck + 1 : 0;
        if (bot.stuck > 45) { bot.reverse = 40; bot.stuck = 0; }
        if (bot.reverse > 0) {
            bot.reverse--;
            inp.gas = false; inp.brake = true; inp.steer = -inp.steer; inp.drift = false;
            bot.drifting = false;
        }

        if (bot.itemCd > 0) bot.itemCd--;
        if (k.item) bot.hold++; else bot.hold = 0;
        if (k.item && bot.itemCd <= 0) {
            const gap = o.prog - k.prog;
            let use = false;
            if (k.item === 'mushroom') use = Math.abs(diff) < 0.25 && Math.abs(curv) < 0.45;
            else if (k.item === 'missile') use = (gap > 0 && gap < 750) || bot.hold > 600;
            else if (k.item === 'banana') use = (gap < 0 && gap > -280) || bot.hold > 420;
            else if (k.item === 'shield') use = GameBot.level === 'easy' || bot.hold > 360 ||
                gs.missiles.some(m => m.owner === 1 && Math.hypot(m.x - k.x, m.y - k.y) < 340);
            if (GameBot.level === 'easy' && bot.hold > 90) use = true;
            if (use) { inp.item = true; bot.itemCd = 30; }
        }
        GameBot.deliver({ type: 'input', keys: inp });
    }

    // ==========================================
    // 特效（世界坐标粒子，带高度 z）
    // ==========================================
    let audioCtx = null;
    function beep(freq, dur, type) {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = type || 'square';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.06, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
            o.connect(g).connect(audioCtx.destination);
            o.start();
            o.stop(audioCtx.currentTime + dur);
        } catch (e) { /* no audio */ }
    }

    function burst(x, y, z, n, color, speed, size, life) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random());
            particles.push({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 1 + Math.random() * speed,
                life, max: life, color, size });
        }
    }
    function pop(x, y, text, color) { popTexts.push({ x, y, z: 46, text, color: color || '#fff', life: 50 }); }

    function triggerFx(fx) {
        if (!fx) return;
        const mine = fx.id === myId();
        switch (fx.kind) {
            case 'beep': beep(520, 0.18); break;
            case 'go': beep(1040, 0.4); banner = { text: 'GO!', t: 50, color: '#4ade80' }; break;
            case 'hop': hop[fx.id] = 12; burst(fx.x, fx.y, 2, 5, 'rgba(255,255,255,.85)', 1.6, 3, 16); break;
            case 'boost':
                burst(fx.x, fx.y, 8, 12, SPARK[fx.lv] || '#fde047', 3, 3.5, 24);
                if (fx.text) pop(fx.x, fx.y, fx.text, SPARK[fx.lv]);
                if (mine) { beep(300 + fx.lv * 160, 0.2, 'sawtooth'); shake = Math.max(shake, 3); }
                break;
            case 'bump': burst(fx.x, fx.y, 6, 7, '#fde68a', 2.4, 3, 18); if (mine) { beep(140, 0.08, 'triangle'); shake = Math.max(shake, 4); } break;
            case 'box': burst(fx.x, fx.y, 14, 14, `hsl(${Math.random() * 360},90%,70%)`, 3, 3.5, 26); if (mine) beep(880, 0.08, 'triangle'); break;
            case 'coin': burst(fx.x, fx.y, 10, 6, '#fde047', 1.8, 3, 18); if (mine) { beep(1320, 0.06, 'square'); setTimeout(() => beep(1760, 0.1, 'square'), 60); } break;
            case 'spin':
                burst(fx.x, fx.y, 10, 18, fx.cause === 'banana' ? '#fde047' : '#a5f3fc', 4, 4, 30);
                if (fx.lost) burst(fx.x, fx.y, 14, fx.lost * 3, '#facc15', 3, 4, 34);
                pop(fx.x, fx.y, fx.cause === 'banana' ? '🍌 滑倒!' : '🫧 被击中!', '#fecaca');
                if (mine) { shake = 10; beep(180, 0.35, 'sawtooth'); }
                break;
            case 'shield': burst(fx.x, fx.y, 12, 16, '#a5b4fc', 3.5, 3.5, 26); pop(fx.x, fx.y, 'BLOCK!', '#c7d2fe'); break;
            case 'pop': burst(fx.x, fx.y, 10, 10, '#bae6fd', 2.6, 3, 20); break;
            case 'use': if (mine) beep(660, 0.1, 'triangle'); break;
            case 'lap':
                if (mine) {
                    banner = { text: fx.lap === LAPS ? 'FINAL LAP!' : `LAP ${fx.lap}/${LAPS}`, t: 90, color: fx.lap === LAPS ? '#fb923c' : '#fde047' };
                    beep(780, 0.15); setTimeout(() => beep(980, 0.2), 140);
                }
                break;
            case 'finish':
                burst(fx.x, fx.y, 20, 40, COLORS[fx.id], 5, 4, 50);
                if (mine) banner = { text: gs.winner === fx.id || !gs.winner ? '🏁 FINISH! 🏆' : '🏁 FINISH', t: 160, color: '#fde047' };
                else if (gs.winner === fx.id) banner = { text: `${DRIVER[fx.id]} 先冲线了!`, t: 120, color: '#fca5a5' };
                break;
            default: break;
        }
    }

    function updateEffects() {
        animTick++;
        shake *= 0.85;
        if (shake < 0.3) shake = 0;
        for (const id of [1, 2]) if (hop[id] > 0) hop[id]--;
        for (const k of [gs.p1, gs.p2]) {
            if (gs.status !== 'racing' && gs.status !== 'finished') continue;
            if (k.off && k.boost <= 0 && Math.hypot(k.vx, k.vy) > 2 && animTick % 3 === 0) {
                const o = smooth[k.id], ch = Math.cos(k.h), sh = Math.sin(k.h);
                particles.push({ x: k.x + o.x - ch * 18, y: k.y + o.y - sh * 18, z: 2, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5,
                    vz: 1.2, life: 18, max: 18, color: '#65a30d', size: 3 });
            }
        }
        particles = particles.filter(p => {
            p.x += p.vx; p.y += p.vy; p.z = Math.max(0, p.z + p.vz);
            p.vx *= 0.92; p.vy *= 0.92; p.vz -= 0.18;
            return --p.life > 0;
        });
        popTexts = popTexts.filter(t => { t.z += 0.7; return --t.life > 0; });
        if (banner && --banner.t <= 0) banner = null;
    }

    function showGameOver() {
        if (gameOverShown) return;
        gameOverShown = true;
        setTimeout(() => { if (gs.status === 'gameover') running = false; }, 400);
        if (myRole === 'client') { clearInterval(netSendInterval); netSendInterval = null; }
        showScreen(gameoverScreen);
        const win = gs.winner === myId();
        winnerMascot.textContent = `${DRIVER[gs.winner] || '🏎️'}🏆`;
        winLossTitle.textContent = win ? 'VICTORY!' : 'DEFEAT';
        winLossTitle.className = win ? 'neon-text' : 'danger-text';
        finalScore.textContent = `${gs.score.p1} - ${gs.score.p2}`;
        p1ScoreVal.textContent = gs.score.p1;
        p2ScoreVal.textContent = gs.score.p2;
        restartBtn.textContent = 'RACE AGAIN';
        restartBtn.disabled = false;
    }

    // ==========================================
    // 渲染资源：地面纹理（一次性绘制）
    // ==========================================
    const TEX = 0.8;                                  // texels per world unit
    const TB = TRACK.bounds;
    const TX0 = TB.minX - WALL - 240, TY0 = TB.minY - WALL - 240;
    const TW = Math.ceil((TB.maxX - TB.minX + 2 * (WALL + 240)) * TEX);
    const TH = Math.ceil((TB.maxY - TB.minY + 2 * (WALL + 240)) * TEX);
    const TW2 = TW >> 1, TH2 = TH >> 1;
    const rgba32 = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
    const GRASS_A = rgba32(124, 201, 100), GRASS_B = rgba32(111, 191, 88);

    const trackPath = new Path2D();
    TRACK.pts.forEach((p, i) => (i ? trackPath.lineTo(p.x, p.y) : trackPath.moveTo(p.x, p.y)));
    trackPath.closePath();

    const { tex, tex2 } = (() => {
        const c = document.createElement('canvas');
        c.width = TW; c.height = TH;
        const g = c.getContext('2d');
        g.fillStyle = '#7cc964';
        g.fillRect(0, 0, TW, TH);
        g.scale(TEX, TEX);
        g.translate(-TX0, -TY0);
        const T = 96;
        g.fillStyle = '#6fbf58';
        for (let gx = Math.floor(TX0 / T); gx * T < TX0 + TW / TEX; gx++) {
            for (let gy = Math.floor(TY0 / T); gy * T < TY0 + TH / TEX; gy++) {
                if ((gx + gy) & 1) g.fillRect(gx * T, gy * T, T, T);
            }
        }
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.strokeStyle = '#f9a8d4'; g.lineWidth = WALL * 2 + 16; g.stroke(trackPath);
        g.strokeStyle = '#a7e08c'; g.lineWidth = WALL * 2; g.stroke(trackPath);
        g.strokeStyle = '#94d27a'; g.lineWidth = (HW + CURB) * 2 + 40; g.setLineDash([40, 40]); g.stroke(trackPath); g.setLineDash([]);
        g.strokeStyle = '#ffffff'; g.lineWidth = (HW + CURB) * 2; g.stroke(trackPath);
        g.strokeStyle = '#f43f5e'; g.setLineDash([24, 24]); g.stroke(trackPath); g.setLineDash([]);
        g.strokeStyle = '#6d6a8e'; g.lineWidth = HW * 2; g.stroke(trackPath);
        g.strokeStyle = '#75729a'; g.lineWidth = HW * 1.1; g.stroke(trackPath);                // racing groove
        g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 4; g.setLineDash([30, 34]); g.stroke(trackPath); g.setLineDash([]);

        // start / finish checkers
        const sp = pointAt(S0, 0);
        g.save();
        g.translate(sp.x, sp.y);
        g.rotate(sp.a);
        const sq = 11, n = Math.ceil((HW * 2) / sq);
        for (let r = 0; r < 3; r++) {
            for (let i = 0; i < n; i++) {
                g.fillStyle = (i + r) & 1 ? '#1f1b2e' : '#ffffff';
                g.fillRect(-sq * 1.5 + r * sq, -HW + i * sq, sq, sq);
            }
        }
        g.restore();
        // grid slots
        for (const lat of [-45, 45]) {
            const p = pointAt(S0 - 90, lat);
            g.save(); g.translate(p.x, p.y); g.rotate(p.a);
            g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3;
            g.strokeRect(-26, -22, 52, 44);
            g.restore();
        }
        // dash pads
        for (const p of PADS) {
            g.save(); g.translate(p.x, p.y); g.rotate(p.a);
            g.fillStyle = '#f59e0b';
            g.beginPath(); g.roundRect(-34, -30, 68, 60, 8); g.fill();
            g.fillStyle = '#fde047';
            for (const off of [-22, 0, 22]) {
                g.beginPath();
                g.moveTo(off - 6, -20); g.lineTo(off + 8, 0); g.lineTo(off - 6, 20);
                g.lineTo(off - 14, 20); g.lineTo(off, 0); g.lineTo(off - 14, -20); g.closePath();
                g.fill();
            }
            g.restore();
        }
        const img = g.getImageData(0, 0, TW, TH);
        const t = new Uint32Array(img.data.buffer);
        // grit: per-texel brightness noise so speed reads even on plain asphalt
        let seed = 987654321;
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            const n = ((seed >> 16) & 15) - 7;
            d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n, 0, 255);
        }
        // half-res mip (box filter) for the far rows → less shimmering
        const t2 = new Uint32Array(TW2 * TH2);
        for (let y = 0; y < TH2; y++) {
            for (let x = 0; x < TW2; x++) {
                const i0 = (y * 2) * TW + x * 2, i1 = i0 + TW;
                let r = 0, gg = 0, b = 0;
                for (const v of [t[i0], t[i0 + 1], t[i1], t[i1 + 1]]) { r += v & 255; gg += (v >> 8) & 255; b += (v >> 16) & 255; }
                t2[y * TW2 + x] = rgba32(r >> 2, gg >> 2, b >> 2);
            }
        }
        c.width = c.height = 1;            // free the backing store
        return { tex: t, tex2: t2 };
    })();

    // 装饰：赛道外的树/花/蘑菇（固定种子，双方一致）
    const DECOR = (() => {
        let seed = 7654321;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const out = [];
        const icons = [['🌳', 90, 30], ['🌲', 100, 18], ['🌴', 100, 8], ['🌸', 26, 8], ['🌼', 22, 8], ['🍄', 34, 8],
            ['🌷', 24, 6], ['🪨', 36, 6], ['🍭', 60, 6], ['🏰', 240, 0]];
        const total = icons.reduce((a, b) => a + b[2], 0);
        for (let i = 0; i < 1600 && out.length < 340; i++) {
            const x = TB.minX - 700 + rnd() * (TB.maxX - TB.minX + 1400);
            const y = TB.minY - 700 + rnd() * (TB.maxY - TB.minY + 1400);
            if (project(x, y, -1).dist < WALL + 40) continue;
            let r = rnd() * total, pick = icons[0];
            for (const ic of icons) { if ((r -= ic[2]) < 0) { pick = ic; break; } }
            out.push({ x, y, e: pick[0], s: pick[1] * (0.8 + rnd() * 0.45) });
        }
        // two castles far outside, Mario-style landmarks
        out.push({ x: TB.minX - 520, y: (TB.minY + TB.maxY) / 2, e: '🏰', s: 300 });
        out.push({ x: TB.maxX + 560, y: TB.minY + 300, e: '🏰', s: 300 });
        return out;
    })();

    // 糖果围栏：沿两侧墙线的线段（内弯处偏移线会自相交 → 丢掉不在墙上的点）
    const FENCE = (() => {
        const out = [];
        const step = 3;
        for (const side of [1, -1]) {
            let prev = null;
            for (let i = 0; i <= N; i += step) {
                const p = pointAt(i * TRACK.seg, side * WALL);
                const ok = project(p.x, p.y, -1).dist > WALL - 3;
                const cur = ok ? { x: p.x, y: p.y } : null;
                if (prev && cur) out.push({ x1: prev.x, y1: prev.y, x2: cur.x, y2: cur.y, c: (i / step) & 1 });
                prev = cur;
            }
        }
        return out;
    })();

    const emojiCache = {};
    function emo(e) {
        let c = emojiCache[e];
        if (!c) {
            c = document.createElement('canvas');
            c.width = c.height = 80;
            const g = c.getContext('2d');
            g.font = '64px sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(e, 40, 44);
            emojiCache[e] = c;
        }
        return c;
    }

    const shadeCache = {};
    function shade(hex, f) {
        const key = hex + f;
        if (!shadeCache[key]) {
            const n = parseInt(hex.slice(1), 16);
            const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
            shadeCache[key] = `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
        }
        return shadeCache[key];
    }

    // ==========================================
    // 相机 / 投影
    // ==========================================
    const CAM_DIST = 118, CAM_Z = 40, NEAR = 14, FAR = 2600;
    const cam = { x: 0, y: 0, h: 0, z: CAM_Z };
    let CX = 400, HOR = 180, F = 600, CF = 1, SF = 0;

    function snapCam() {
        const me = kartOf(myId());
        cam.h = me.h;
        cam.x = me.x - Math.cos(cam.h) * CAM_DIST;
        cam.y = me.y - Math.sin(cam.h) * CAM_DIST;
    }
    snapCam();

    /** world (x, y, z-up) → screen {x, y, k: px per unit, d: depth} or null if behind the near plane. */
    function proj(wx, wy, wz) {
        const dx = wx - cam.x, dy = wy - cam.y;
        const d = dx * CF + dy * SF;
        if (d < NEAR) return null;
        const k = F / d;
        return { x: CX + (-dx * SF + dy * CF) * k, y: HOR + (cam.z - wz) * k, k, d };
    }
    const depthOf = (wx, wy) => (wx - cam.x) * CF + (wy - cam.y) * SF;

    // ground buffer (low-res, scaled up)
    const GRES = 0.6;
    const gbuf = document.createElement('canvas');
    const gctx = gbuf.getContext('2d');
    let gimg = null, gpix = null;

    function renderGround(W, H) {
        const GW = Math.max(16, Math.ceil(W * GRES));
        const GH = Math.max(4, Math.ceil((H - HOR) * GRES));
        if (!gimg || gbuf.width !== GW || gbuf.height !== GH) {
            gbuf.width = GW; gbuf.height = GH;
            gimg = gctx.createImageData(GW, GH);
            gpix = new Uint32Array(gimg.data.buffer);
        }
        const rx = -SF, ry = CF;                 // camera right vector in world
        const cellInv = 1 / (96 * TEX);
        for (let r = 0; r < GH; r++) {
            const dy = (r + 0.5) / GRES;
            const z = cam.z * F / dy;
            let o = r * GW;
            const k = z / F;
            const xl = (0.5 / GRES - CX) * k;
            const wx = cam.x + CF * z + rx * xl, wy = cam.y + SF * z + ry * xl;
            const stepW = k / GRES;
            const far = stepW * TEX > 1.4;
            const S = far ? TEX * 0.5 : TEX;
            const t = far ? tex2 : tex, tw = far ? TW2 : TW, th = far ? TH2 : TH;
            let u = (wx - TX0) * S, v = (wy - TY0) * S;
            const du = rx * stepW * S, dv = ry * stepW * S;
            const ci = far ? cellInv * 2 : cellInv;
            for (let c = 0; c < GW; c++, o++, u += du, v += dv) {
                if (u >= 0 && v >= 0 && u < tw && v < th) gpix[o] = t[(v | 0) * tw + (u | 0)];
                else gpix[o] = ((Math.floor(u * ci) + Math.floor(v * ci)) & 1) ? GRASS_B : GRASS_A;
            }
        }
        gctx.putImageData(gimg, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(gbuf, 0, HOR, W, GH / GRES);
        // distance haze
        const fogH = Math.min(H - HOR, Math.max(30, F * cam.z / 260));
        const fg = ctx.createLinearGradient(0, HOR, 0, HOR + fogH);
        fg.addColorStop(0, 'rgba(214,236,255,0.95)');
        fg.addColorStop(1, 'rgba(214,236,255,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, HOR - 1, W, fogH + 1);
    }

    const hillFar = a => 0.55 + 0.22 * Math.sin(3 * a + 1) + 0.14 * Math.sin(7 * a + 2.1) + 0.08 * Math.sin(13 * a + 0.4);
    const hillNear = a => 0.42 + 0.26 * Math.sin(5 * a + 0.3) + 0.16 * Math.sin(11 * a + 1.7) + 0.07 * Math.sin(23 * a);
    const CLOUDS = Array.from({ length: 11 }, (_, i) => ({ a: i * 0.571 + Math.sin(i * 7.3) * 0.2, h: 0.25 + ((i * 37) % 10) / 22, s: 0.7 + ((i * 53) % 10) / 14 }));

    function renderSky(W, H) {
        const g = ctx.createLinearGradient(0, 0, 0, HOR);
        g.addColorStop(0, '#4f9ff5');
        g.addColorStop(1, '#cfe9ff');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, HOR + 1);
        // clouds
        for (const c of CLOUDS) {
            const da = wrapA(c.a - cam.h);
            if (Math.abs(da) > 1.3) continue;
            const x = CX + Math.tan(da) * F * 0.9, y = HOR * c.h, s = c.s * HOR * 0.11;
            ctx.fillStyle = 'rgba(255,255,255,.92)';
            ctx.beginPath();
            ctx.ellipse(x, y, s * 1.6, s * 0.6, 0, 0, Math.PI * 2);
            ctx.ellipse(x - s * 0.8, y + s * 0.1, s * 0.8, s * 0.5, 0, 0, Math.PI * 2);
            ctx.ellipse(x + s * 0.5, y - s * 0.35, s * 0.9, s * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // wrap-around hills: column angle = heading + atan(dx / F)
        for (const [fn, amp, col, cap] of [[hillFar, 0.42, '#a5b4fc', '#e0e7ff'], [hillNear, 0.2, '#4ade80', null]]) {
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.moveTo(0, HOR + 1);
            for (let x = 0; x <= W + 8; x += 8) {
                const a = cam.h + Math.atan((x - CX) / F);
                ctx.lineTo(x, HOR - fn(a) * HOR * amp);
            }
            ctx.lineTo(W, HOR + 1);
            ctx.closePath();
            ctx.fill();
            if (cap) {
                ctx.fillStyle = cap;
                for (let x = 0; x <= W; x += 8) {
                    const a = cam.h + Math.atan((x - CX) / F), h = fn(a);
                    if (h > 0.78) ctx.fillRect(x, HOR - h * HOR * amp, 8, (h - 0.78) * HOR * amp);
                }
            }
        }
    }

    // ---- 低多边形赛车：本地坐标 a=前, b=右, z=上 ----
    const KART_MODEL = [
        // [a0, a1, b0, b1, z0, z1, color('body'|'light'|hex)]
        [-17, 17, -13, 13, 3, 9, 'body'],
        [10, 24, -9, 9, 4, 11, 'light'],
        [-19, -11, -7, 7, 8, 15, '#6b7280'],
        [-11, -3, -8, 8, 9, 21, '#ffffff'],
        [-21, -19, -2, 2, 12, 18, '#374151'],
        [-24, -18, -15, 15, 17, 20, '#fde047'],
        [7, 18, -19, -12, 0, 9, '#2b2440'], [7, 18, 12, 19, 0, 9, '#2b2440'],
        [-18, -6, -20, -12, 0, 11, '#2b2440'], [-18, -6, 12, 20, 0, 11, '#2b2440']
    ];
    const FACES = [[1, 3, 7, 5, 'a+'], [0, 4, 6, 2, 'a-'], [2, 6, 7, 3, 'b+'], [0, 1, 5, 4, 'b-'], [4, 5, 7, 6, 'z+']];
    const LIGHT = { 'a+': 0.7, 'a-': 0.62, 'b+': 0.8, 'b-': 0.86, 'z+': 1.08 };

    function drawKart(k) {
        const o = smooth[k.id];
        const x = k.x + o.x, y = k.y + o.y;
        const yaw = k.h + o.h + k.spinA + (k.drift ? k.drift * 0.38 : 0);
        const lift = hop[k.id] > 0 ? Math.sin((12 - hop[k.id]) / 12 * Math.PI) * 7 : 0;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const base = COLORS[k.id];
        const toW = (a, b) => [x + c * a - s * b, y + s * a + c * b];
        // camera in kart-local coords (for back-face culling)
        const cdx = cam.x - x, cdy = cam.y - y;
        const ca = cdx * c + cdy * s, cb = -cdx * s + cdy * c;
        const alpha = k.inv > 0 && k.spin <= 0 && Math.floor(animTick / 4) % 2 ? 0.55 : 1;
        ctx.globalAlpha = alpha;

        // shadow
        const sh = [];
        for (let i = 0; i < 12; i++) {
            const t = i / 12 * Math.PI * 2;
            const [wx, wy] = toW(Math.cos(t) * 24, Math.sin(t) * 18);
            const p = proj(wx, wy, 0);
            if (!p) { sh.length = 0; break; }
            sh.push(p);
        }
        if (sh.length) {
            ctx.fillStyle = 'rgba(0,0,0,.25)';
            ctx.beginPath();
            sh.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
            ctx.fill();
        }

        const boxes = KART_MODEL.map(m => {
            const [wx, wy] = toW((m[0] + m[1]) / 2, (m[2] + m[3]) / 2);
            return { m, d: depthOf(wx, wy) };
        }).sort((p, q) => q.d - p.d);
        for (const { m } of boxes) {
            const [a0, a1, b0, b1, z0, z1, col] = m;
            const pts = [];
            let ok = true;
            for (let i = 0; i < 8; i++) {
                const [wx, wy] = toW(i & 1 ? a1 : a0, i & 2 ? b1 : b0);
                const p = proj(wx, wy, (i & 4 ? z1 : z0) + lift);
                if (!p) { ok = false; break; }
                pts.push(p);
            }
            if (!ok) continue;
            const color = col === 'body' ? base : col === 'light' ? shade(base, 1.18) : col;
            for (const f of FACES) {
                const n = f[4];
                const vis = n === 'a+' ? ca > a1 : n === 'a-' ? ca < a0 : n === 'b+' ? cb > b1 : n === 'b-' ? cb < b0 : cam.z > z1 + lift;
                if (!vis) continue;
                ctx.fillStyle = shade(color, LIGHT[n]);
                ctx.beginPath();
                ctx.moveTo(pts[f[0]].x, pts[f[0]].y);
                ctx.lineTo(pts[f[1]].x, pts[f[1]].y);
                ctx.lineTo(pts[f[2]].x, pts[f[2]].y);
                ctx.lineTo(pts[f[3]].x, pts[f[3]].y);
                ctx.closePath();
                ctx.fill();
            }
        }

        // driver (billboard)
        const [dx, dy] = toW(-5, 0);
        const dp = proj(dx, dy, 15 + lift);
        if (dp) {
            const sz = 25 * dp.k;
            const bob = Math.sin(animTick * 0.3 + k.id) * (Math.hypot(k.vx, k.vy) > 1 ? 1.2 : 0.3) * dp.k;
            ctx.drawImage(emo(DRIVER[k.id]), dp.x - sz / 2, dp.y - sz + bob, sz, sz);
            if (k.id !== myId()) {
                ctx.fillStyle = base;
                const ty = dp.y - sz - 6 * dp.k;
                ctx.beginPath(); ctx.moveTo(dp.x - 6 * dp.k, ty - 7 * dp.k); ctx.lineTo(dp.x + 6 * dp.k, ty - 7 * dp.k); ctx.lineTo(dp.x, ty); ctx.fill();
            }
            if (k.roll > 0 || k.item) {
                const isz = 14 * dp.k;
                const e = k.item ? ITEMS[k.item] : ITEMS[ITEM_KEYS[Math.floor(animTick / 4) % 4]];
                ctx.drawImage(emo(e), dp.x + sz * 0.35, dp.y - sz * 1.25, isz, isz);
            }
        }

        // drift sparks at the rear wheels, flames from the exhaust
        const live = gs.status === 'racing' || gs.status === 'finished';
        if (live && k.drift) {
            const lv = driftLevel(k.charge);
            for (const side of [-1, 1]) {
                const [wx, wy] = toW(-14, side * 17);
                const p = proj(wx, wy, 2);
                if (!p) continue;
                ctx.fillStyle = lv ? SPARK[lv] : 'rgba(255,255,255,.7)';
                for (let i = 0; i < (lv ? 4 : 2); i++) {
                    const r = (lv ? 3 + Math.random() * 3 : 2 + Math.random() * 2) * p.k;
                    ctx.beginPath();
                    ctx.arc(p.x + (Math.random() - 0.5) * 10 * p.k, p.y - Math.random() * 8 * p.k, r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        if (live && k.boost > 0) {
            const [wx, wy] = toW(-23, 0);
            const p = proj(wx, wy, 11 + lift);
            if (p) {
                for (let i = 0; i < 3; i++) {
                    ctx.fillStyle = i === 0 ? '#fb923c' : i === 1 ? '#fde047' : '#fff7ed';
                    const r = (9 - i * 2.6 + Math.random() * 2) * p.k;
                    ctx.beginPath(); ctx.arc(p.x + (Math.random() - 0.5) * 3 * p.k, p.y + (Math.random() - 0.5) * 3 * p.k, r, 0, Math.PI * 2); ctx.fill();
                }
            }
        }
        if (k.shield > 0) {
            const p = proj(x, y, 12 + lift);
            if (p) {
                ctx.strokeStyle = `rgba(165,180,252,${0.6 + Math.sin(animTick * 0.2) * 0.25})`;
                ctx.fillStyle = 'rgba(165,180,252,.15)';
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.arc(p.x, p.y, 30 * p.k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawBillboard(img, p, size) {
        const sz = size * p.k;
        ctx.drawImage(img, p.x - sz / 2, p.y - sz * 0.92, sz, sz);
    }

    function drawFence(f) {
        let x1 = f.x1, y1 = f.y1, x2 = f.x2, y2 = f.y2;
        let d1 = depthOf(x1, y1), d2 = depthOf(x2, y2);
        if (d1 < NEAR && d2 < NEAR) return;
        if (d1 < NEAR) { const t = (NEAR - d1) / (d2 - d1); x1 += (x2 - x1) * t; y1 += (y2 - y1) * t; }
        else if (d2 < NEAR) { const t = (NEAR - d2) / (d1 - d2); x2 += (x1 - x2) * t; y2 += (y1 - y2) * t; }
        const a = proj(x1, y1, 0), b = proj(x2, y2, 0), at = proj(x1, y1, 16), bt = proj(x2, y2, 16);
        if (!a || !b || !at || !bt) return;
        if (Math.max(a.x, b.x) < 0 || Math.min(a.x, b.x) > view.width) return;
        ctx.fillStyle = f.c ? '#f472b6' : '#fdf2f8';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(bt.x, bt.y); ctx.lineTo(at.x, at.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath();
        ctx.moveTo(at.x, at.y); ctx.lineTo(bt.x, bt.y); ctx.lineTo(bt.x, bt.y + Math.max(1, 2 * bt.k)); ctx.lineTo(at.x, at.y + Math.max(1, 2 * at.k));
        ctx.fill();
    }

    function drawGate() {
        const l = pointAt(S0, HW + 22), r = pointAt(S0, -HW - 22);
        const pl0 = proj(l.x, l.y, 0), pl1 = proj(l.x, l.y, 86), pr0 = proj(r.x, r.y, 0), pr1 = proj(r.x, r.y, 86);
        const bl = proj(l.x, l.y, 66), br = proj(r.x, r.y, 66);
        if (!pl0 || !pl1 || !pr0 || !pr1 || !bl || !br) return;
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineCap = 'round';
        for (const [p0, p1] of [[pl0, pl1], [pr0, pr1]]) {
            ctx.lineWidth = Math.max(2, 7 * p0.k);
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
        // checkered banner
        const cols = 12;
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < 2; j++) {
                const t0 = i / cols, t1 = (i + 1) / cols;
                const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
                const top = j === 0 ? [pl1, pr1] : [lerp(bl, pl1, 0.5), lerp(br, pr1, 0.5)];
                const bot = j === 0 ? [lerp(bl, pl1, 0.5), lerp(br, pr1, 0.5)] : [bl, br];
                const a = lerp(top[0], top[1], t0), b = lerp(top[0], top[1], t1), c = lerp(bot[0], bot[1], t1), d = lerp(bot[0], bot[1], t0);
                ctx.fillStyle = (i + j) & 1 ? '#1f1b2e' : '#ffffff';
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.fill();
            }
        }
    }

    function drawItemBox(i, p) {
        const sz = 30 * p.k;
        const y = p.y - sz * 0.6 - Math.sin(animTick * 0.08 + i) * 3 * p.k;
        ctx.save();
        ctx.translate(p.x, y);
        ctx.rotate(Math.sin(animTick * 0.05 + i) * 0.35);
        const g = ctx.createLinearGradient(-sz / 2, -sz / 2, sz / 2, sz / 2);
        g.addColorStop(0, `hsla(${(animTick * 3 + i * 40) % 360},90%,72%,.9)`);
        g.addColorStop(1, `hsla(${(animTick * 3 + i * 40 + 120) % 360},90%,66%,.9)`);
        ctx.fillStyle = g;
        ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.lineWidth = Math.max(1, 2.5 * p.k);
        ctx.beginPath(); ctx.roundRect(-sz / 2, -sz / 2, sz, sz, sz * 0.22); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.max(6, sz * 0.62)}px "Fredoka", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, sz * 0.04);
        ctx.restore();
    }

    function drawCoin(i, p) {
        const r = 8 * p.k;
        const w = Math.abs(Math.cos(animTick * 0.09 + i * 0.6)) * r + r * 0.15;
        const y = p.y - r - (6 + Math.sin(animTick * 0.1 + i) * 2) * p.k;
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#a16207';
        ctx.lineWidth = Math.max(1, 1.6 * p.k);
        ctx.beginPath(); ctx.ellipse(p.x, y, w, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fef9c3';
        ctx.beginPath(); ctx.ellipse(p.x, y, w * 0.35, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }

    function drawMissile(m, p) {
        const r = 11 * p.k;
        const y = p.y - r - 6 * p.k;
        const g = ctx.createRadialGradient(p.x - r * 0.3, y - r * 0.3, 1, p.x, y, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#a5f3fc'); g.addColorStop(1, 'rgba(56,189,248,.75)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 1.5 * p.k); ctx.stroke();
    }

    // ==========================================
    // 主渲染
    // ==========================================
    let renderStats = { sprites: 0, ms: 0 };
    function render() {
        const t0 = performance.now();
        view.begin(ctx);
        const W = view.width, H = view.height;
        const me = kartOf(myId());
        const mo = smooth[me.id];
        const kx = me.x + mo.x, ky = me.y + mo.y;
        const spd = Math.hypot(me.vx, me.vy);

        // chase camera: lags the heading a little, leans into drifts, ignores spin-outs
        const want = me.h + mo.h + (me.drift ? me.drift * 0.2 : 0);
        cam.h = wrapA(cam.h + wrapA(want - cam.h) * 0.14);
        const dist = CAM_DIST + clamp(spd - MAX_SPEED, 0, 4) * 4;
        cam.x = kx - Math.cos(cam.h) * dist;
        cam.y = ky - Math.sin(cam.h) * dist;
        CF = Math.cos(cam.h); SF = Math.sin(cam.h);

        // projection: own kart's wheels at ~85 % height; FOV widens a bit at boost speed
        const boostF = clamp((spd - MAX_SPEED) / (BOOST_MAX - MAX_SPEED), 0, 1);
        F = Math.min(H * 1.4, W * 0.95) * (1 - 0.1 * boostF);
        HOR = Math.min(H * 0.5, H * 0.85 - cam.z * F / CAM_DIST);
        CX = W / 2;
        const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
        CX += sx; HOR += sy;

        renderSky(W, H);
        renderGround(W, H);

        // ---- collect sprites ----
        const sprites = [];
        const add = (d, fn) => { if (d < FAR) sprites.push({ d, fn }); };
        const vis = (p, margin) => p && p.x > -margin && p.x < W + margin;

        for (const f of FENCE) {
            const d = depthOf((f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2);
            if (d > -40 && d < FAR) add(Math.max(d, NEAR), () => drawFence(f));
        }
        for (const dco of DECOR) {
            const p = proj(dco.x, dco.y, 0);
            if (!vis(p, dco.s * (p ? p.k : 0))) continue;
            add(p.d, () => drawBillboard(emo(dco.e), p, dco.s));
        }
        {
            const sp = pointAt(S0, 0);
            const d = depthOf(sp.x, sp.y);
            if (d > NEAR) add(d, drawGate);
        }
        for (let i = 0; i < BOXES.length; i++) {
            if (gs.boxes[i]) continue;
            const p = proj(BOXES[i].x, BOXES[i].y, 0);
            if (vis(p, 60)) add(p.d, () => drawItemBox(i, p));
        }
        for (let i = 0; i < COINS.length; i++) {
            if (gs.coins[i]) continue;
            const p = proj(COINS[i].x, COINS[i].y, 0);
            if (vis(p, 40)) add(p.d, () => drawCoin(i, p));
        }
        for (const b of gs.bananas) {
            const p = proj(b.x, b.y, 0);
            if (vis(p, 40)) add(p.d, () => drawBillboard(emo('🍌'), p, 24));
        }
        for (const m of gs.missiles) {
            const p = proj(m.x, m.y, 0);
            if (vis(p, 40)) add(p.d, () => drawMissile(m, p));
        }
        for (const k of [gs.p1, gs.p2]) {
            const o = smooth[k.id];
            const d = depthOf(k.x + o.x, k.y + o.y);
            if (d > 40) add(d, () => drawKart(k));
        }
        for (const pt of particles) {
            const p = proj(pt.x, pt.y, pt.z);
            if (!vis(p, 10)) continue;
            add(p.d - 1, () => {
                ctx.globalAlpha = Math.max(0, pt.life / pt.max);
                ctx.fillStyle = pt.color;
                ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.8, pt.size * p.k), 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            });
        }
        sprites.sort((a, b) => b.d - a.d);
        for (const s of sprites) s.fn();

        // floating texts
        ctx.textAlign = 'center';
        for (const t of popTexts) {
            const p = proj(t.x, t.y, t.z);
            if (!p) continue;
            ctx.globalAlpha = Math.min(1, t.life / 18);
            hudText(t.text, p.x, p.y, clamp(16 * p.k * 1.6, 12, 26), t.color, 'center');
        }
        ctx.globalAlpha = 1;

        if (boostF > 0.05 && (gs.status === 'racing' || gs.status === 'finished')) drawSpeedLines(W, H, boostF);
        drawHud(W, H);
        renderStats = { sprites: sprites.length, ms: Math.round((performance.now() - t0) * 10) / 10 };
    }

    function drawSpeedLines(W, H, f) {
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * f})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2;
            const r0 = Math.max(W, H) * (0.42 + Math.random() * 0.1), r1 = r0 + Math.max(W, H) * 0.25;
            ctx.moveTo(CX + Math.cos(a) * r0, HOR + Math.sin(a) * r0 * 0.6);
            ctx.lineTo(CX + Math.cos(a) * r1, HOR + Math.sin(a) * r1 * 0.6);
        }
        ctx.stroke();
    }

    function ordinal(n) { return n === 1 ? '1st' : '2nd'; }
    function placeOf(k) {
        const o = kartOf(k.id === 1 ? 2 : 1);
        if (k.fin && o.fin) return k.fin <= o.fin ? 1 : 2;
        if (k.fin) return 1;
        if (o.fin) return 2;
        return k.prog >= o.prog ? 1 : 2;
    }

    function hudText(text, x, y, size, color, align) {
        ctx.font = `700 ${size}px "Fredoka", "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = align || 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(3, size / 6);
        ctx.strokeStyle = 'rgba(30,20,60,.85)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color || '#fff';
        ctx.fillText(text, x, y);
    }

    function drawHud(W, H) {
        const me = kartOf(myId());
        const rival = kartOf(3 - myId());
        const lap = clamp(Math.floor(me.prog / L) + 1, 1, LAPS);
        const pad = 12;

        hudText(`LAP ${me.fin ? LAPS : lap}/${LAPS}`, pad, pad + 14, 22, '#fde047');
        const secs = gs.frame / 60;
        hudText(`${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, '0')}`, pad, pad + 40, 15, '#e9d5ff');
        hudText(`🪙 ×${me.coins || 0}`, pad, pad + 64, 16, me.coins >= COIN_MAX ? '#fde047' : '#fef9c3');

        const place = placeOf(me);
        hudText(ordinal(place), W - pad - 64, pad + 22, 34, place === 1 ? '#fde047' : '#cbd5e1', 'right');

        // item slot
        const bx = W - pad - 52, by = pad;
        ctx.fillStyle = 'rgba(30,20,60,.6)';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.roundRect(bx, by, 52, 52, 12); ctx.fill(); ctx.stroke();
        const it = me.item ? ITEMS[me.item] : me.roll > 0 ? ITEMS[ITEM_KEYS[Math.floor(animTick / 3) % 4]] : null;
        if (it) ctx.drawImage(emo(it), bx + 6, by + 6, 40, 40);

        // drift charge bar
        if (me.drift) {
            const lv = driftLevel(me.charge);
            const next = DRIFT_LV[Math.min(3, lv + 1)];
            const f = lv >= 3 ? 1 : (me.charge - DRIFT_LV[lv]) / (next - DRIFT_LV[lv]);
            const w = 120, x = W / 2 - w / 2, y = H - 18;
            ctx.fillStyle = 'rgba(30,20,60,.6)';
            ctx.beginPath(); ctx.roundRect(x, y, w, 10, 5); ctx.fill();
            ctx.fillStyle = SPARK[Math.min(3, lv + 1)];
            ctx.beginPath(); ctx.roundRect(x, y, w * clamp(f, 0.05, 1), 10, 5); ctx.fill();
        }

        // rival right behind you (not on screen) → peek arrow at the bottom edge
        const ro = smooth[rival.id];
        const rd = depthOf(rival.x + ro.x, rival.y + ro.y);
        if (gs.status === 'racing' && rd < 60 && Math.hypot(rival.x - me.x, rival.y - me.y) < 420) {
            const side = clamp((-(rival.x - cam.x) * SF + (rival.y - cam.y) * CF) / 120, -1, 1);
            const x = W / 2 + side * W * 0.3;
            ctx.globalAlpha = 0.85;
            hudText(`${DRIVER[rival.id]}▲`, x, H - 40, 20, COLORS[rival.id], 'center');
            ctx.globalAlpha = 1;
        }

        drawMinimap(W, H);

        if (gs.status === 'countdown') {
            const n = Math.ceil(gs.cd / 60);
            if (n >= 1 && n <= 3) {
                const f = (gs.cd % 60) / 60;
                hudText(String(n), W / 2, H * 0.32, 60 + f * 30, ['#4ade80', '#fde047', '#fb923c'][n - 1] || '#fff', 'center');
            } else if (gs.cd > 0) {
                hudText('READY', W / 2, H * 0.32, 44, '#fff', 'center');
            }
        }
        if (banner) {
            ctx.globalAlpha = Math.min(1, banner.t / 15);
            hudText(banner.text, W / 2, H * 0.24, 40, banner.color, 'center');
            ctx.globalAlpha = 1;
        }
        if (me.wrong > 45 && animTick % 40 < 26) hudText('⚠️ 逆行!', W / 2, H * 0.45, 30, '#f87171', 'center');
        if (me.fin && !banner) hudText(place === 1 ? '🏆 WINNER' : '🏁 FINISHED', W / 2, H * 0.24, 34, '#fde047', 'center');
    }

    function drawMinimap(W, H) {
        const B = TRACK.bounds;
        const size = clamp(Math.min(W, H) * 0.24, 80, 140);
        const sc = size / Math.max(B.maxX - B.minX, B.maxY - B.minY);
        const mw = (B.maxX - B.minX) * sc, mh = (B.maxY - B.minY) * sc;
        const ox = 16, oy = 96;
        if (oy + mh > H - 90) return;          // very short screens: skip rather than collide with controls
        ctx.save();
        ctx.fillStyle = 'rgba(30,20,60,.42)';
        ctx.beginPath(); ctx.roundRect(ox - 8, oy - 8, mw + 16, mh + 16, 10); ctx.fill();
        ctx.translate(ox - B.minX * sc, oy - B.minY * sc);
        ctx.scale(sc, sc);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 7 / sc;
        ctx.stroke(trackPath);
        const st = pointAt(S0, 0);
        ctx.fillStyle = '#fff';
        ctx.fillRect(st.x - 3 / sc, st.y - 3 / sc, 6 / sc, 6 / sc);
        for (const k of [kartOf(3 - myId()), kartOf(myId())]) {
            ctx.fillStyle = COLORS[k.id];
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2 / sc;
            ctx.beginPath(); ctx.arc(k.x, k.y, (k.id === myId() ? 6 : 5) / sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
    }

    // ==========================================
    // 测试钩子
    // ==========================================
    let e2eFreeze = false, e2eFreezeBot = false;
    GameBot.expose({ state: () => gs });
    window.__kart3d = {
        get state() {
            return JSON.parse(JSON.stringify({ status: gs.status, p1: gs.p1, p2: gs.p2, frame: gs.frame,
                winner: gs.winner, score: gs.score, bananas: gs.bananas, missiles: gs.missiles, boxes: gs.boxes, coins: gs.coins }));
        },
        get render() { return Object.assign({ cam: { x: cam.x, y: cam.y, h: cam.h }, horizon: HOR }, renderStats); },
        track: { len: L, laps: LAPS, start: S0, hw: HW, wall: WALL },
        coins: COINS.map(c => ({ x: c.x, y: c.y })),
        pads: PADS.map(p => ({ s: p.s - S0, lat: p.lat })),
        pointAt
    };
    if (E2E) {
        Object.assign(window.__kart3d, {
            freeze: on => { e2eFreeze = !!on; },
            freezeBot: on => { e2eFreezeBot = !!on; },
            skipCountdown: () => { if (gs.status === 'countdown') gs.cd = 1; },
            /** place a kart at arc length s (relative to the start line), lateral offset, heading along the track */
            place: (id, s, lat, speed) => {
                const k = kartOf(id), p = pointAt(S0 + s, lat || 0);
                const pr = project(p.x, p.y, -1);
                Object.assign(k, { x: p.x, y: p.y, h: p.a, vx: p.tx * (speed || 0), vy: p.ty * (speed || 0), idx: pr.idx, s: pr.s, prog: s });
                if (id === myId()) snapCam();
            },
            give: (id, item) => { kartOf(id).item = item; },
            set: (id, props) => Object.assign(kartOf(id), props)
        });
    }

    render();
});
