/**
 * Link Kart — Q版卡丁车 1v1 对战 (client/kart/).
 *
 * Same skeleton as the other realtime games (see tanks/game.js):
 *   - GameBot.session() → GameSession (WebRTC, unreliable channel) or a local
 *     fake session in `?bot=` mode. Host-authoritative: the host simulates
 *     both karts, the client only sends {type:'input'}.
 *   - GameFit.view(adaptive) → the logical viewport follows the screen aspect
 *     (no rotation): the camera scrolls with your own kart, so a tall phone
 *     simply sees more track ahead/behind.
 *
 * Track = closed Catmull-Rom spline resampled at equal arc length. Every kart
 * keeps a hint index into that sample list, so projecting onto the centreline
 * is a ±14-sample local search per frame. Race progress is the *unwrapped*
 * arc length (prog), which gives lap count, placing and anti-reverse for free.
 *
 * Wire protocol (host → client, ~30 Hz, seq-numbered, may drop/reorder):
 *   {type:'state', n, r, st, cd, f, et, w, sc, k:[kart,kart], b, m, bx, fx}
 * client → host (~60 Hz): {type:'input', keys:{steer,gas,brake,drift,item}}
 * plus {type:'start'} / {type:'restart-request'} (the race id `r` in every
 * state also starts the client, so a lost 'start' packet doesn't matter).
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
    const MAX_SPEED = 6.4;
    const BOOST_MAX = 9.4;
    const ACCEL = 0.15;
    const BRAKE = 0.28;
    const REV_MAX = -2.6;
    const TURN = 0.05;              // rad/frame at full lock
    const HW = 92;                  // asphalt half width
    const CURB = 12;
    const RUNOFF = 64;              // grass strip before the candy wall
    const WALL = HW + RUNOFF;
    const COUNTDOWN = 210;
    const BOMB_R = 110;             // 炸弹爆炸半径          // 3.5 s: 3 · 2 · 1 · GO
    const DRIFT_LV = [0, 50, 105, 165];       // charge thresholds → spark level 1..3
    const DRIFT_BOOST = [0, 32, 58, 88];      // mini-turbo frames per level
    const SPARK = ['#ffffff', '#38bdf8', '#fb923c', '#e879f9'];
    const ITEMS = {
        banana: '🍌', missile: '🫧', mushroom: '🍄', shield: '🛡️',
        triple: '🍄', star: '⭐', bolt: '⚡', bomb: '💣', ink: '🦑'
    };
    const ITEM_NAME = {
        banana: '香蕉皮', missile: '追踪泡泡', mushroom: '加速蘑菇', shield: '护盾', triple: '三连蘑菇',
        star: '无敌星', bolt: '缩小闪电', bomb: '泡泡炸弹', ink: '墨鱼汁'
    };
    const ITEM_KEYS = Object.keys(ITEMS);
    const COLORS = { 1: '#f472b6', 2: '#38bdf8' };
    const DRIVER = { 1: '🐰', 2: '🐱' };
    const NAME = { 1: '草莓兔', 2: '汽水猫' };

    // ==========================================
    // 赛道：闭合 Catmull-Rom → 等弧长采样。多条路线，每条有自己的主题/地形/加速带
    // ==========================================
    // grip: 非漂移时每帧保留的横向速度（越大越滑）；offMul: 出界时的极速倍率
    // pads: 加速带 [圈长比例, 横向偏移]；boxes: 道具盒排的位置（圈长比例）
    const TRACKS = [
        {
            id: 'meadow', name: '甜甜草原', icon: '🌷', grip: 0.8, offMul: 0.5,
            ctrl: [[400, 1250], [400, 700], [520, 380], [850, 260], [1150, 380], [1250, 650],
                [1450, 800], [1700, 700], [1800, 420], [2050, 300], [2200, 500], [2200, 1000],
                [2050, 1300], [1700, 1380], [1400, 1250], [1100, 1350], [800, 1400], [550, 1400]],
            boxes: [0.3, 0.68], pads: [[0.5, 0]],
            theme: { bg: '#86d36e', bg2: '#7cc964', wall: '#f9a8d4', runoff: '#a7e08c', curb: '#f43f5e', road: '#6d6a8e',
                lane: 'rgba(255,255,255,.28)', decor: ['🌳', '🌳', '🌲', '🌸', '🌼', '🍄', '🌷', '🪨', '🍭'] }
        },
        {
            id: 'beach', name: '椰林海滩', icon: '🏝️', grip: 0.8, offMul: 0.42,
            ctrl: [[400, 1300], [350, 800], [450, 400], [800, 300], [1300, 320], [1800, 300], [2300, 350],
                [2550, 650], [2450, 1000], [2050, 1050], [1700, 900], [1400, 1050], [1250, 1450], [950, 1600], [600, 1550]],
            boxes: [0.22, 0.6], pads: [[0.12, -40], [0.12, 40], [0.78, 0]],
            theme: { bg: '#f3d99b', bg2: '#ecd08a', wall: '#38bdf8', runoff: '#fbe7b5', curb: '#0ea5e9', road: '#7c8aa5',
                lane: 'rgba(255,255,255,.35)', decor: ['🌴', '🌴', '🌴', '🐚', '🦀', '⛱️', '🏖️', '🐢', '🪸'] }
        },
        {
            id: 'snow', name: '冰雪山道', icon: '⛄', grip: 0.9, offMul: 0.5,
            ctrl: [[400, 1500], [350, 900], [400, 350], [750, 250], [1000, 500], [950, 900], [1050, 1200], [1400, 1250],
                [1550, 900], [1500, 500], [1700, 250], [2100, 300], [2250, 700], [2200, 1200], [2250, 1600], [1900, 1900],
                [1300, 1900], [800, 1850]],
            boxes: [0.25, 0.55, 0.82], pads: [[0.4, 0], [0.7, -30]],
            theme: { bg: '#e3eefb', bg2: '#d6e4f5', wall: '#60a5fa', runoff: '#f4f8ff', curb: '#3b82f6', road: '#8790b5',
                lane: 'rgba(255,255,255,.4)', decor: ['🌲', '🌲', '🌲', '⛄', '❄️', '🏔️', '🐧', '🎄', '🪨'] }
        },
        {
            id: 'candy', name: '糖果夜城', icon: '🍭', grip: 0.8, offMul: 0.5,
            ctrl: [[500, 1700], [350, 1250], [450, 850], [400, 450], [650, 250], [1000, 350], [1100, 750], [1450, 850],
                [1650, 500], [1950, 300], [2350, 400], [2450, 800], [2200, 1100], [1850, 1250], [1950, 1600], [2300, 1750],
                [2200, 2050], [1750, 2100], [1300, 1950], [900, 2050]],
            boxes: [0.2, 0.48, 0.77], pads: [[0.36, 0], [0.62, 30], [0.92, -30]],
            theme: { bg: '#2b2150', bg2: '#33285e', wall: '#e879f9', runoff: '#4a3a7c', curb: '#22d3ee', road: '#3d3566',
                lane: 'rgba(250,204,21,.55)', night: true, decor: ['🍭', '🍬', '🧁', '🍩', '🏮', '✨', '🍫', '🎠', '🌙'] }
        }
    ];
    const trackIndex = id => Math.max(0, TRACKS.findIndex(t => t.id === id));

    // 当前赛道：loadTrack() 换赛道时整体替换（赛道几何只在两场比赛之间变化）
    let TD = TRACKS[0], TRACK, N, L, BOXES, PADS, DECOR, trackPath;
    const S0 = 300;                 // start/finish line (arc length)

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

    /** World position at arc length s, `lat` units along the left normal. */
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
        return { idx: best, s: (best + bf) * TRACK.seg, dist: Math.sqrt(bd), px, py };
    }

    function loadTrack(idx) {
        TD = TRACKS[idx] || TRACKS[0];
        TRACK = buildTrack(TD.ctrl, 16);
        N = TRACK.pts.length;
        L = TRACK.len;
        // 道具盒：每排 4 个
        BOXES = [];
        for (const f of TD.boxes) for (const lat of [-54, -18, 18, 54]) BOXES.push(pointAt(S0 + L * f, lat));
        PADS = TD.pads.map(([f, lat]) => Object.assign(pointAt(S0 + L * f, lat), { s: wrapS(S0 + L * f), lat }));
        // 装饰：赛道外的树/花（固定种子，双方一致）
        let seed = 1234567 + idx * 7919;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        DECOR = [];
        const B = TRACK.bounds, icons = TD.theme.decor;
        for (let i = 0; i < 600 && DECOR.length < 190; i++) {
            const x = B.minX - 320 + rnd() * (B.maxX - B.minX + 640);
            const y = B.minY - 320 + rnd() * (B.maxY - B.minY + 640);
            if (project(x, y, -1).dist < WALL + 34) continue;
            DECOR.push({ x, y, e: icons[Math.floor(rnd() * icons.length)], s: 20 + rnd() * 16 });
        }
        trackPath = new Path2D();
        TRACK.pts.forEach((p, i) => (i ? trackPath.lineTo(p.x, p.y) : trackPath.moveTo(p.x, p.y)));
        trackPath.closePath();
        return idx;
    }
    let curTrack = -1;
    function useTrack(idx) {
        idx = clamp(idx | 0, 0, TRACKS.length - 1);
        if (idx !== curTrack) curTrack = loadTrack(idx);
    }
    useTrack(0);

    // ==========================================
    // 状态
    // ==========================================
    function createKart(id) {
        const sGrid = S0 - 90;
        const p = pointAt(sGrid, id === 1 ? -40 : 40);
        return {
            id, x: p.x, y: p.y, h: p.a, vx: 0, vy: 0,
            idx: p.idx, s: sGrid, prog: sGrid - S0,
            item: null, ic: 0, roll: 0, spin: 0, spinA: 0, inv: 0, shield: 0, boost: 0,
            star: 0, zap: 0, ink: 0, padCd: 0,
            drift: 0, charge: 0, fin: 0, off: 0, wrong: 0, gasAt: 0, lastItem: false
        };
    }

    function createInitialState(score, race) {
        return {
            p1: createKart(1), p2: createKart(2),
            bananas: [], missiles: [], bombs: [], boxes: BOXES.map(() => 0), track: curTrack,
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
    const cam = { x: gs.p1.x, y: gs.p1.y, z: 1, a: gs.p1.h };
    let camRot = 0;                 // 当前帧的画布旋转角（chase 视角下 = -(车头 + 90°)）

    // ==========================================
    // 视角：chase = 车头永远朝上（道路随前进方向旋转）；north = 固定朝北
    // ==========================================
    const store = {
        get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
    };
    // 默认固定视角（用户反馈“车头朝上”难操控）；只有手动点过切换按钮才记住 chase。
    // 换了存储键：旧版本初始化时会自动把 'chase' 写进 link.kart.view。
    let viewMode = qs.get('view') || store.get('link.kart.view2') || 'north';
    if (viewMode !== 'chase') viewMode = 'north';
    const viewBtn = $('view-btn'), touchHint = document.querySelector('.touch-hint');
    function setViewMode(m) {
        viewMode = m === 'chase' ? 'chase' : 'north';
        viewBtn.textContent = viewMode === 'chase' ? '🧭 车头朝上' : '🗺️ 固定视角';
        viewBtn.setAttribute('aria-pressed', viewMode === 'chase' ? 'true' : 'false');
        touchHint.innerHTML = viewMode === 'chase' ? '左右转向<br>下拉倒车' : '摇杆或手指<br>指哪开哪';
        const me = kartOf(myId());
        cam.a = me.h;
        render();
    }
    function toggleView() {
        setViewMode(viewMode === 'chase' ? 'north' : 'chase');
        store.set('link.kart.view2', viewMode);
    }
    viewBtn.addEventListener('click', e => { e.preventDefault(); toggleView(); canvas.focus({ preventScroll: true }); });

    // ==========================================
    // 赛道选择（房主选，-1 = 随机）
    // ==========================================
    let selTrack = (() => {
        const q = qs.get('track');
        if (q) return q === 'random' ? -1 : trackIndex(q);
        const v = parseInt(store.get('link.kart.track'), 10);
        return isFinite(v) && v >= -1 && v < TRACKS.length ? v : 0;
    })();
    if (selTrack >= 0 && selTrack !== curTrack) {
        useTrack(selTrack);
        gs = createInitialState();
        Object.assign(cam, { x: gs.p1.x, y: gs.p1.y, a: gs.p1.h });
    }
    function renderPickers() {
        for (const el of document.querySelectorAll('.track-picker')) {
            el.innerHTML = '';
            const opts = TRACKS.map((t, i) => [i, t.icon, t.name]).concat([[-1, '🎲', '随机']]);
            for (const [i, icon, name] of opts) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'track-btn' + (i === selTrack ? ' active' : '');
                b.dataset.track = String(i);
                b.innerHTML = `<span class="track-icon">${icon}</span><span>${name}</span>`;
                b.disabled = myRole === 'client';
                b.addEventListener('click', () => pickTrack(i));
                el.appendChild(b);
            }
            const note = el.parentElement.querySelector('.track-note');
            if (note) note.textContent = myRole === 'client' ? '房主选择赛道' : '选择赛道';
        }
        // 比赛之外：预览选中的赛道
        if (selTrack >= 0 && gs.status !== 'countdown' && gs.status !== 'racing' && gs.status !== 'finished' && selTrack !== curTrack) {
            useTrack(selTrack);
            gs = createInitialState(gs.score, gs.race);
            const me = kartOf(myId());
            cam.x = me.x; cam.y = me.y; cam.a = me.h;
            render();
        }
    }
    function pickTrack(i) {
        if (myRole === 'client') return;
        selTrack = i;
        store.set('link.kart.track', String(i));
        for (let n = 0; n < 2; n++) setTimeout(() => send({ type: 'track', sel: i }), n * 150);
        renderPickers();
    }

    const myId = () => (myRole === 'client' ? 2 : 1);
    const kartOf = id => (id === 1 ? gs.p1 : gs.p2);

    // ==========================================
    // 输入
    // ==========================================
    const keys = { up: false, down: false, left: false, right: false, drift: false, item: false };
    const touch = { used: false, active: false, ang: 0, mag: 0, x: 0, y: 0, brake: false, gasHint: false, drift: false, item: false };
    let itemLatch = 0;
    const clientInput = { steer: 0, gas: false, brake: false, drift: false, item: false };

    function setKey(key, down) {
        const k = key.toLowerCase();
        if (k === 'w' || k === 'arrowup') keys.up = down;
        else if (k === 's' || k === 'arrowdown') keys.down = down;
        else if (k === 'a' || k === 'arrowleft') keys.left = down;
        else if (k === 'd' || k === 'arrowright') keys.right = down;
        else if (k === 'shift' || k === 'k' || k === 'x') keys.drift = down;
        else if (k === 'v' && down) toggleView();
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

    // 触屏摇杆 = 绝对方向：摇杆指向哪里，车就往屏幕上的哪个方向开。
    // 镜头不旋转（north-up），相对转向（左右=车头左右）在车头朝下时是反的，很难操控。
    // 这里把“目标方向 - 当前车头”的夹角换算成 steer，物理/网络协议保持不变。
    const STICK_DEAD = 0.28, STICK_FULL_LOCK = 0.45;   // 夹角 ≥ ~26° 打满方向
    // chase 视角下画面随车头旋转，“左右 = 车头左右”本身就是直觉的 → 摇杆横向分量直接打方向，下拉倒车
    function chaseSteer() {
        if (!touch.active) return 0;
        if (touch.y > 0.55 && Math.abs(touch.x) < 0.6) touch.brake = true;
        const ax = Math.abs(touch.x);
        if (ax < 0.14) return 0;
        return Math.sign(touch.x) * clamp((ax - 0.14) / 0.5, 0, 1);
    }
    // 手指按住画面 = 车朝手指的位置开（任何视角都适用，屏幕方向按镜头旋转换算回世界方向）
    const point = { id: null, x: 0, y: 0 };
    let kartScr = { x: 0, y: 0 };      // render() 更新：自己的车在画面上的逻辑坐标
    function pointAngle() {
        if (point.id === null) return null;
        const dx = point.x - kartScr.x, dy = point.y - kartScr.y;
        if (Math.hypot(dx, dy) < 22) return null;     // 按在车上：保持直行
        return Math.atan2(dy, dx) - camRot;
    }
    function aimSteer(ang) {
        const me = kartOf(myId());
        const h = me.h + smooth[me.id].h;
        const diff = wrapA(ang - h);
        const steer = clamp(diff / STICK_FULL_LOCK, -1, 1);
        // 贴墙/停住且要掉头：转向需要车速，原地顶墙转不动 → 倒车掉头（倒车时方向反过来）
        const vf = me.vx * Math.cos(h) + me.vy * Math.sin(h);
        if (Math.abs(diff) > 2.2 && vf < 1.2 && gs.status === 'racing') {
            touch.brake = true;
            return -steer || 1;
        }
        return steer;
    }
    function touchSteer() {
        touch.brake = false;
        const pa = pointAngle();
        if (pa !== null) return aimSteer(pa);
        if (viewMode === 'chase') return chaseSteer();
        if (!touch.active || touch.mag < STICK_DEAD) return 0;
        return aimSteer(touch.ang);
    }

    function readInput() {
        const kbSteer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        const ts = touchSteer();
        const steer = ts !== 0 ? ts : kbSteer;
        const brake = keys.down || touch.brake;
        // 触屏：比赛中自动油门；倒数时推动摇杆 = 踩油门（可以抢起步加速）
        const touchGas = touch.used && !brake && (gs.status === 'racing' || touch.gasHint || point.id !== null);
        return {
            steer: r2(steer), gas: keys.up || touchGas, brake,
            drift: keys.drift || touch.drift,
            item: keys.item || touch.item || performance.now() < itemLatch
        };
    }

    GameFit.joystick($('move-stick'), $('move-knob'), (x, y, active) => {
        touch.used = true;
        if (!active) { touch.active = false; touch.mag = 0; touch.gasHint = false; return; }
        touch.active = true;
        touch.mag = Math.min(1, Math.hypot(x, y));
        touch.x = x; touch.y = y;
        if (touch.mag >= STICK_DEAD) touch.ang = Math.atan2(y, x);   // 屏幕坐标 = 世界坐标（镜头不旋转）
        touch.gasHint = touch.mag > 0.45;
    }, { radius: 48 });
    GameFit.touchButtons(document.querySelector('.touch-actions'), (action, down) => {
        touch.used = true;
        if (action === 'item' && down) itemLatch = performance.now() + 120;
        touch[action] = down;
    });

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => {
        if (point.id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if (gs.status !== 'countdown' && gs.status !== 'racing') return;
        e.preventDefault();
        point.id = e.pointerId;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        touch.used = true;
        const p = view.toLogical(e.clientX, e.clientY); point.x = p.x; point.y = p.y;
    });
    canvas.addEventListener('pointermove', e => {
        if (e.pointerId !== point.id) return;
        const p = view.toLogical(e.clientX, e.clientY); point.x = p.x; point.y = p.y;
    });
    const pointEnd = e => { if (e.pointerId === point.id) point.id = null; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(ev, pointEnd);

    const view = GameFit.view(canvas, {
        width: canvas.width, height: canvas.height,
        adaptive: { short: 480, min: 0.56, max: 2.2 },
        onResize: () => render()
    });

    // ==========================================
    // 网络
    // ==========================================
    connectionStateText.textContent = '正在连接信号服务器...';
    const session = GameBot.session({
        gameFolder: 'kart',
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
            const me = kartOf(myId());
            cam.x = me.x; cam.y = me.y; cam.a = me.h;
            renderPickers();
            render();
        },
        onChannelOpen() {
            renderPickers();
            if (myRole === 'host') setTimeout(() => send({ type: 'track', sel: selTrack }), 300);
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
                beginRace(msg.sc, msg.r, msg.t);      // lost 'start' packet → the state stream starts us anyway
            }
            // netSeq never resets on the host, so stale packets from the previous race are dropped too
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
            if (myRole === 'client' && msg.r !== gs.race) beginRace(msg.score, msg.r, msg.t);
        } else if (msg.type === 'track') {
            if (myRole === 'client' && typeof msg.sel === 'number') { selTrack = msg.sel; renderPickers(); }
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
            // keep what's on screen where it is, then let the offset decay → no snapping
            o.x += k.x - n.x; o.y += k.y - n.y; o.h += wrapA(k.h - n.h);
            if (Math.hypot(o.x, o.y) > 120) { o.x = o.y = 0; o.h = 0; }
            Object.assign(k, n);
        }
        gs.bananas = (m.b || []).map(b => ({ x: b[0], y: b[1] }));
        gs.missiles = (m.m || []).map(b => ({ x: b[0], y: b[1], h: b[2] }));
        gs.bombs = (m.o || []).map(b => ({ x: b[0], y: b[1], vx: b[2], vy: b[3], t: b[4] }));
        if (Array.isArray(m.bx)) gs.boxes = m.bx;
        p1ScoreVal.textContent = gs.score.p1;
        p2ScoreVal.textContent = gs.score.p2;
        if (Array.isArray(m.fx)) m.fx.forEach(triggerFx);
        if (gs.status === 'gameover' && prevStatus !== 'gameover') showGameOver();
    }

    function packKart(k) {
        return {
            id: k.id, x: r1(k.x), y: r1(k.y), h: r2(k.h), vx: r2(k.vx), vy: r2(k.vy),
            idx: k.idx, s: r1(k.s), prog: r1(k.prog), item: k.item, ic: k.ic, roll: k.roll, spin: k.spin,
            star: k.star, zap: k.zap, ink: k.ink,
            spinA: r2(k.spinA), inv: k.inv, shield: k.shield, boost: k.boost, drift: k.drift,
            charge: Math.round(k.charge), fin: k.fin, off: k.off, wrong: k.wrong
        };
    }

    function sendState() {
        send({
            type: 'state', n: ++netSeq, r: gs.race, t: gs.track, st: gs.status, cd: gs.cd, f: gs.frame,
            et: gs.endTimer, w: gs.winner, sc: gs.score,
            k: [packKart(gs.p1), packKart(gs.p2)],
            b: gs.bananas.map(b => [r1(b.x), r1(b.y)]),
            m: gs.missiles.map(m => [r1(m.x), r1(m.y), r2(m.h)]),
            o: gs.bombs.map(b => [r1(b.x), r1(b.y), r2(b.vx), r2(b.vy), b.t]),
            bx: gs.boxes.map(t => (t > 0 ? 1 : 0)),
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
        // unreliable channel: say it a few times
        for (let i = 0; i < 3; i++) setTimeout(() => send({ type: 'restart-request' }), i * 120);
        restartBtn.textContent = 'AWAITING HOST...';
        restartBtn.disabled = true;
    });

    function hostStart() {
        // 随机：尽量不和上一场重复
        let t = selTrack;
        if (t < 0) { t = Math.floor(Math.random() * (TRACKS.length - 1)); if (t >= curTrack) t++; }
        beginRace(gs.score, gs.race + 1, t);
        send({ type: 'start', score: gs.score, r: gs.race, t: gs.track });
        clearInterval(netSendInterval);
        netSendInterval = setInterval(sendState, 1000 / 30);
    }

    function beginRace(score, race, track) {
        if (typeof track === 'number') useTrack(track);
        gs = createInitialState(score || { p1: 0, p2: 0 }, race);
        gs.status = 'countdown';
        particles = []; popTexts = []; banner = null; pendingFx = []; flash = null;
        gameOverShown = false;
        smooth[1] = { x: 0, y: 0, h: 0 }; smooth[2] = { x: 0, y: 0, h: 0 };
        botReset();
        const me = kartOf(myId());
        cam.x = me.x; cam.y = me.y; cam.a = me.h;
        banner = { text: `${TD.icon} ${TD.name}`, t: 150, color: '#fff' };
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
        const gen = ++loopGen;          // a quick restart must not leave two rAF chains running
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
                    // pressed the gas in the last ~0.45 s → rocket start
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
        stepBananas();
        stepMissiles();
        stepBombs();
        if (gs.status === 'finished' && --gs.endTimer <= 0) {
            gs.status = 'gameover';
            sendState();
            showGameOver();
        }
    }

    function stepKart(k, inp, other) {
        if (k.spin > 0) k.spin--;
        if (k.inv > 0) k.inv--;
        if (k.shield > 0) k.shield--;
        if (k.boost > 0) k.boost--;
        if (k.star > 0) k.star--;
        if (k.zap > 0) k.zap--;
        if (k.ink > 0) k.ink--;
        if (k.padCd > 0) k.padCd--;
        if (k.spin <= 0) k.spinA *= 0.7;

        let steer = clamp(inp.steer || 0, -1, 1), gas = !!inp.gas, brake = !!inp.brake;
        if (k.fin) { gas = false; brake = false; steer *= 0.5; }
        if (k.spin > 0) { gas = brake = false; steer = 0; k.spinA += 0.42; }

        const pr0 = project(k.x, k.y, k.idx);
        k.off = pr0.dist > HW + 4 ? 1 : 0;

        const ch = Math.cos(k.h), sh = Math.sin(k.h);
        let vf = k.vx * ch + k.vy * sh;
        let vl = -k.vx * sh + k.vy * ch;
        const offSlow = k.off && k.boost <= 0 && k.star <= 0;
        // 无敌星 = 更快；被闪电缩小 = 变慢
        const mul = (k.star > 0 ? 1.12 : 1) * (k.zap > 0 ? 0.72 : 1);
        const maxF = (k.boost > 0 ? BOOST_MAX : (offSlow ? MAX_SPEED * TD.offMul : MAX_SPEED)) * mul;

        if (k.boost > 0) vf = Math.min(maxF, vf + 0.55);
        else if (gas) { if (vf < maxF) vf = Math.min(maxF, vf + (vf < 0 ? BRAKE : ACCEL)); }
        else if (brake) vf = vf > 0 ? Math.max(0, vf - BRAKE) : Math.max(REV_MAX, vf - 0.09);
        else vf *= 0.986;
        if (vf > maxF) vf = Math.max(maxF, vf * 0.95);
        if (k.spin > 0) vf *= 0.93;

        // ---- 漂移 / 迷你加速 ----
        if (inp.drift && !k.drift && Math.abs(steer) > 0.3 && vf > 3.4 && k.spin <= 0 && !k.fin) {
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
            // drift direction fixed; the stick only tightens/widens the arc
            turn = TURN * 1.08 * k.drift * clamp(0.62 + 0.4 * steer * k.drift, 0.22, 1.02);
            k.charge += 1 + (steer * k.drift > 0.4 ? 0.7 : 0);
        } else {
            turn = TURN * steer * (k.off ? 0.85 : 1);
        }
        if (k.spin <= 0) k.h = wrapA(k.h + turn * clamp(vf / 2.6, -1, 1));
        vl *= k.drift ? 0.94 : TD.grip;

        // recompose in the *old* basis: next frame's decomposition along the
        // new heading turns part of it into lateral slip → grip eats it
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
                if (vn > 2.2) emitFx({ kind: 'bump', x: k.x + nx * KART_R, y: k.y + ny * KART_R });
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
        // wrong way: heading against the track tangent while moving
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

        // ---- 加速带 ----
        if (!k.padCd && k.spin <= 0) {
            for (const pd of PADS) {
                let ds2 = k.s - pd.s;
                if (ds2 > L / 2) ds2 -= L;
                if (ds2 < -L / 2) ds2 += L;
                if (Math.abs(ds2) > 22) continue;
                if (Math.abs((k.x - pd.x) * -pd.ty + (k.y - pd.y) * pd.tx) < 34) {
                    k.boost = Math.max(k.boost, 45);
                    k.padCd = 30;
                    emitFx({ kind: 'boost', id: k.id, x: k.x, y: k.y, lv: 1, text: 'DASH PANEL!' });
                    break;
                }
            }
        }

        // ---- 道具 ----
        if (k.roll > 0 && --k.roll === 0) {
            k.item = rollItem(k, other);
            k.ic = k.item === 'triple' ? 3 : 1;
        }
        const pressed = !!inp.item && !k.lastItem;
        k.lastItem = !!inp.item;
        if (pressed && k.item && k.spin <= 0 && gs.status === 'racing') useItem(k, other);
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
            // a mushroom/boosting kart barges through
            const wa = b.boost > 0 && a.boost <= 0 ? 1.5 : (a.boost > 0 && b.boost <= 0 ? 0.5 : 1);
            a.vx -= nx * j * wa; a.vy -= ny * j * wa;
            b.vx += nx * j * (2 - wa); b.vy += ny * j * (2 - wa);
            if (rel > 1.5) emitFx({ kind: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
        // 无敌星撞人 = 对方打转
        if (a.star > 0 && b.star <= 0) hitKart(b, 'star');
        else if (b.star > 0 && a.star <= 0) hitKart(a, 'star');
    }

    // 位置平衡：领先拿防守道具，落后越多越容易拿到强力道具
    const ROLL_TABLE = {
        lead: [['banana', 30], ['shield', 20], ['missile', 14], ['bomb', 14], ['mushroom', 12], ['ink', 10]],
        close: [['missile', 22], ['mushroom', 16], ['triple', 12], ['bomb', 12], ['ink', 12], ['banana', 8], ['shield', 8], ['star', 6], ['bolt', 4]],
        far: [['triple', 22], ['star', 18], ['missile', 15], ['bolt', 15], ['mushroom', 12], ['ink', 10], ['bomb', 8]]
    };
    function rollItem(k, other) {
        const gap = other.prog - k.prog;
        const table = ROLL_TABLE[gap <= 0 ? 'lead' : gap > 600 ? 'far' : 'close'];
        let r = Math.random() * table.reduce((t, e) => t + e[1], 0);
        for (const [it, w] of table) { if ((r -= w) < 0) return it; }
        return 'mushroom';
    }

    function useItem(k, other) {
        const it = k.item;
        if (it === 'triple' && --k.ic > 0) { /* 还剩几颗：道具槽保留 */ } else { k.item = null; k.ic = 0; }
        const ch = Math.cos(k.h), sh = Math.sin(k.h);
        if (it === 'banana') {
            gs.bananas.push({ x: k.x - ch * 30, y: k.y - sh * 30, owner: k.id, t: 0 });
            if (gs.bananas.length > 8) gs.bananas.shift();
        } else if (it === 'missile') {
            gs.missiles.push({ x: k.x + ch * 30, y: k.y + sh * 30, h: k.h, owner: k.id, idx: k.idx, life: 360, t: 0 });
        } else if (it === 'mushroom' || it === 'triple') {
            k.boost = Math.max(k.boost, it === 'triple' ? 60 : 75);
            emitFx({ kind: 'boost', id: k.id, x: k.x, y: k.y, lv: 2, text: 'DASH!' });
        } else if (it === 'shield') {
            k.shield = 480;
        } else if (it === 'star') {
            k.star = 420;
            k.boost = Math.max(k.boost, 30);
            k.spin = 0; k.zap = 0;
            emitFx({ kind: 'star', id: k.id, x: k.x, y: k.y });
        } else if (it === 'bomb') {
            // 往前扔，滑行减速；碰到车或 100 帧后爆炸（范围伤害，自己也会被炸）
            const v = Math.max(0, k.vx * ch + k.vy * sh) + 7;
            gs.bombs.push({ x: k.x + ch * 34, y: k.y + sh * 34, vx: ch * v, vy: sh * v, owner: k.id, t: 0, idx: k.idx });
        } else if (it === 'bolt') {
            if (!other.fin && other.star <= 0) {
                if (other.shield > 0) {
                    other.shield = 0; other.inv = 30;
                    emitFx({ kind: 'shield', id: other.id, x: other.x, y: other.y });
                } else {
                    other.zap = 240;
                    other.spin = Math.max(other.spin, 28);
                    other.drift = 0; other.charge = 0; other.boost = 0;
                    if (other.item && other.item !== 'triple' && Math.random() < 0.5) { other.item = null; other.ic = 0; }
                }
            }
            emitFx({ kind: 'bolt', id: other.id, x: other.x, y: other.y, by: k.id });
        } else if (it === 'ink') {
            if (!other.fin && other.star <= 0) other.ink = 260;
            emitFx({ kind: 'ink', id: other.id, x: other.x, y: other.y, by: k.id });
        }
        emitFx({ kind: 'use', id: k.id, item: it, x: k.x, y: k.y });
    }

    /** Banana / missile contact. Returns true if the hazard is consumed. */
    function hitKart(k, cause) {
        if (k.fin) return false;
        if (k.inv > 0 || k.star > 0) return true;
        if (k.shield > 0) {
            k.shield = 0;
            k.inv = 30;
            emitFx({ kind: 'shield', id: k.id, x: k.x, y: k.y });
            return true;
        }
        k.spin = cause === 'bomb' ? 70 : 55;
        k.inv = 100;
        k.drift = 0; k.charge = 0; k.boost = 0;
        emitFx({ kind: 'spin', id: k.id, x: k.x, y: k.y, cause });
        return true;
    }

    function stepBoxes() {
        for (let i = 0; i < BOXES.length; i++) {
            if (gs.boxes[i] > 0) { gs.boxes[i]--; continue; }
            const b = BOXES[i];
            for (const k of [gs.p1, gs.p2]) {
                if (Math.hypot(k.x - b.x, k.y - b.y) < KART_R + 13) {
                    gs.boxes[i] = 240;
                    if (!k.item && !k.roll && !k.fin) k.roll = 50;
                    emitFx({ kind: 'box', x: b.x, y: b.y });
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
            if (!tgt.fin && d < 300 && Math.cos(Math.atan2(dy, dx) - m.h) > -0.2) {
                want = Math.atan2(dy, dx); rate = 0.13;
            } else {
                const p = pointAt(pr.s + 90, 0);           // follow the track
                want = Math.atan2(p.y - m.y, p.x - m.x); rate = 0.09;
            }
            m.h = wrapA(m.h + clamp(wrapA(want - m.h), -rate, rate));
            m.x += Math.cos(m.h) * 10.5;
            m.y += Math.sin(m.h) * 10.5;
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

    function stepBombs() {
        gs.bombs = gs.bombs.filter(b => {
            b.t++;
            b.vx *= 0.955; b.vy *= 0.955;
            b.x += b.vx; b.y += b.vy;
            const pr = project(b.x, b.y, b.idx);
            b.idx = pr.idx;
            if (pr.dist > WALL - 12) {             // 撞墙弹回来
                const nx = (b.x - pr.px) / pr.dist, ny = (b.y - pr.py) / pr.dist;
                b.x = pr.px + nx * (WALL - 12); b.y = pr.py + ny * (WALL - 12);
                const vn = b.vx * nx + b.vy * ny;
                if (vn > 0) { b.vx -= nx * vn * 1.6; b.vy -= ny * vn * 1.6; }
            }
            let boom = b.t >= 100;
            for (const k of [gs.p1, gs.p2]) {
                if ((b.t > 30 || b.owner !== k.id) && Math.hypot(k.x - b.x, k.y - b.y) < KART_R + 12) boom = true;
            }
            if (!boom) return true;
            for (const k of [gs.p1, gs.p2]) {
                if (Math.hypot(k.x - b.x, k.y - b.y) < BOMB_R) {
                    hitKart(k, 'bomb');
                    const d = Math.hypot(k.x - b.x, k.y - b.y) || 1;
                    k.vx += (k.x - b.x) / d * 3; k.vy += (k.y - b.y) / d * 3;
                }
            }
            emitFx({ kind: 'boom', x: b.x, y: b.y });
            return false;
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
            for (const m of gs.missiles) { m.x += Math.cos(m.h) * 10.5; m.y += Math.sin(m.h) * 10.5; }
            for (const b of gs.bombs) { b.vx *= 0.955; b.vy *= 0.955; b.x += b.vx; b.y += b.vy; b.t++; }
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
        let lat = Math.sign(curv) * Math.min(48, Math.abs(curv) * 75) * BOT.line;

        // dodge bananas on the line ahead
        if (BOT.dodge && Math.random() < BOT.dodge) {
            for (const b of gs.bananas) {
                const pb = project(b.x, b.y, k.idx);
                let ahead = pb.s - k.s;
                if (ahead < -L / 2) ahead += L;
                if (ahead > 0 && ahead < 260) {
                    const p = pointAt(pb.s, 0);
                    const bl = (b.x - p.x) * -p.ty + (b.y - p.y) * p.tx;     // banana's lateral offset
                    if (Math.abs(bl - lat) < 40) lat = bl > 0 ? bl - 52 : bl + 52;
                }
            }
        }
        bot.dodgeLat += (lat - bot.dodgeLat) * 0.15;
        const tp = pointAt(k.s + look, clamp(bot.dodgeLat, -HW + 20, HW - 20));
        const diff = wrapA(Math.atan2(tp.y - k.y, tp.x - k.x) - k.h);
        if (--bot.noiseT <= 0) { bot.noiseT = 18; bot.noise = GameBot.gauss() * (BOT.noise + (k.ink > 0 ? 0.25 : 0)); }

        inp.steer = clamp(diff * 3 + bot.noise, -1, 1);
        inp.gas = vf < MAX_SPEED * BOT.speed || k.boost > 0;
        if (Math.abs(curv) > 1.2 && vf > 5.3 && !BOT.drift) inp.gas = false;

        // drift through the sharper corners
        if (BOT.drift && !bot.drifting && Math.abs(curv) > 0.55 && vf > 4.6 && Math.abs(diff) > 0.12 && Math.random() < BOT.drift * 0.3) {
            bot.drifting = true;
        }
        if (bot.drifting) {
            inp.drift = true;
            if (!k.drift) inp.steer = Math.sign(diff || curv) || 1;          // the hop needs steering input
            const lvWant = Math.abs(curv) > 1 ? 2 : 1;
            if ((k.drift && Math.abs(curv) < 0.25 && driftLevel(k.charge) >= 1) ||
                driftLevel(k.charge) >= lvWant + 1 || Math.abs(diff) > 0.9 || (k.drift && k.drift * diff < -0.35)) {
                bot.drifting = false;
                inp.drift = false;
            }
        }

        // stuck against the wall → reverse out
        bot.stuck = Math.abs(vf) < 0.6 && k.spin <= 0 ? bot.stuck + 1 : 0;
        if (bot.stuck > 45) { bot.reverse = 40; bot.stuck = 0; }
        if (bot.reverse > 0) {
            bot.reverse--;
            inp.gas = false; inp.brake = true; inp.steer = -inp.steer; inp.drift = false;
            bot.drifting = false;
        }

        // items
        if (bot.itemCd > 0) bot.itemCd--;
        if (k.item) bot.hold++; else bot.hold = 0;
        if (k.item && bot.itemCd <= 0) {
            const gap = o.prog - k.prog;     // >0: rival ahead
            let use = false;
            const near = Math.hypot(o.x - k.x, o.y - k.y);
            if (k.item === 'mushroom' || k.item === 'triple') use = Math.abs(diff) < 0.25 && Math.abs(curv) < 0.45;
            else if (k.item === 'star') use = Math.abs(curv) < 0.7 || bot.hold > 240;
            else if (k.item === 'bolt' || k.item === 'ink') use = gap > 0 || bot.hold > 300;
            else if (k.item === 'bomb') use = (gap > 60 && gap < 420 && near < 380) || bot.hold > 480;
            else if (k.item === 'missile') use = (gap > 0 && gap < 700) || bot.hold > 600;
            else if (k.item === 'banana') use = (gap < 0 && gap > -260) || bot.hold > 420;
            else if (k.item === 'shield') use = GameBot.level === 'easy' || bot.hold > 360 ||
                gs.missiles.some(m => m.owner === 1 && Math.hypot(m.x - k.x, m.y - k.y) < 320);
            if (GameBot.level === 'easy' && bot.hold > 90) use = true;
            if (use) { inp.item = true; bot.itemCd = 30; }
        }
        GameBot.deliver({ type: 'input', keys: inp });
    }

    // ==========================================
    // 特效
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

    const SPIN_FX = {
        banana: ['🍌 滑倒!', '#fde047'], missile: ['🫧 被击中!', '#a5f3fc'],
        bomb: ['💣 被炸飞!', '#fb923c'], star: ['⭐ 被撞飞!', '#fde047']
    };
    let flash = null;
    function burst(x, y, n, color, speed, size, life) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random());
            particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life, max: life, color, size });
        }
    }
    function pop(x, y, text, color) { popTexts.push({ x, y, dy: -24, text, color: color || '#fff', life: 44 }); }

    function triggerFx(fx) {
        if (!fx) return;
        const mine = fx.id === myId();
        switch (fx.kind) {
            case 'beep': beep(520, 0.18); break;
            case 'go': beep(1040, 0.4); banner = { text: 'GO!', t: 50, color: '#4ade80' }; break;
            case 'hop': burst(fx.x, fx.y, 5, 'rgba(255,255,255,.8)', 1.6, 3, 16); break;
            case 'boost':
                burst(fx.x, fx.y, 12, SPARK[fx.lv] || '#fde047', 3, 3.5, 24);
                if (fx.text) pop(fx.x, fx.y, fx.text, SPARK[fx.lv]);
                if (mine) { beep(300 + fx.lv * 160, 0.2, 'sawtooth'); shake = Math.max(shake, 3); }
                break;
            case 'bump': burst(fx.x, fx.y, 7, '#fde68a', 2.4, 3, 18); if (mine || myRole === 'host') beep(140, 0.08, 'triangle'); break;
            case 'box': burst(fx.x, fx.y, 14, `hsl(${Math.random() * 360},90%,70%)`, 3, 3.5, 26); beep(880, 0.08, 'triangle'); break;
            case 'spin':
                burst(fx.x, fx.y, 18, SPIN_FX[fx.cause] ? SPIN_FX[fx.cause][1] : '#a5f3fc', 4, 4, 30);
                pop(fx.x, fx.y, SPIN_FX[fx.cause] ? SPIN_FX[fx.cause][0] : '💥', '#fecaca');
                if (mine) { shake = 10; beep(180, 0.35, 'sawtooth'); }
                break;
            case 'shield': burst(fx.x, fx.y, 16, '#a5b4fc', 3.5, 3.5, 26); pop(fx.x, fx.y, 'BLOCK!', '#c7d2fe'); break;
            case 'pop': burst(fx.x, fx.y, 10, '#bae6fd', 2.6, 3, 20); break;
            case 'boom':
                burst(fx.x, fx.y, 34, '#fb923c', 6, 5, 34);
                burst(fx.x, fx.y, 18, '#fde047', 3.5, 4, 28);
                pop(fx.x, fx.y, 'BOOM!', '#fdba74');
                shake = Math.max(shake, Math.hypot(kartOf(myId()).x - fx.x, kartOf(myId()).y - fx.y) < 400 ? 9 : 0);
                beep(90, 0.4, 'sawtooth');
                break;
            case 'star':
                burst(fx.x, fx.y, 24, '#fde047', 4, 4, 30);
                pop(fx.x, fx.y, '⭐ 无敌!', '#fde047');
                if (mine) { beep(988, 0.12, 'square'); setTimeout(() => beep(1319, 0.2, 'square'), 110); }
                break;
            case 'bolt':
                burst(fx.x, fx.y, 20, '#93c5fd', 4.5, 3.5, 26);
                pop(fx.x, fx.y, '⚡ 缩小!', '#bfdbfe');
                flash = { t: 14, color: 'rgba(191,219,254,' };
                if (mine) { shake = Math.max(shake, 8); beep(160, 0.3, 'sawtooth'); } else beep(1200, 0.12, 'triangle');
                break;
            case 'ink':
                pop(fx.x, fx.y, '🦑 墨汁!', '#c4b5fd');
                if (mine) beep(200, 0.25, 'triangle');
                break;
            case 'use': if (mine) beep(660, 0.1, 'triangle'); break;
            case 'lap':
                if (mine) {
                    banner = { text: fx.lap === LAPS ? 'FINAL LAP!' : `LAP ${fx.lap}/${LAPS}`, t: 90, color: fx.lap === LAPS ? '#fb923c' : '#fde047' };
                    beep(780, 0.15); setTimeout(() => beep(980, 0.2), 140);
                }
                break;
            case 'finish':
                burst(fx.x, fx.y, 40, COLORS[fx.id], 5, 4, 50);
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
        // drift sparks / boost flames from the (rendered) karts
        for (const k of [gs.p1, gs.p2]) {
            if (gs.status !== 'racing' && gs.status !== 'finished') continue;
            const o = smooth[k.id];
            const x = k.x + o.x, y = k.y + o.y;
            const ch = Math.cos(k.h), sh = Math.sin(k.h);
            if (k.drift && animTick % 2 === 0) {
                const lv = driftLevel(k.charge);
                for (const side of [-1, 1]) {
                    const wx = x - ch * 14 - sh * 11 * side, wy = y - sh * 14 + ch * 11 * side;
                    particles.push({ x: wx, y: wy, vx: -ch * 1.5 + (Math.random() - 0.5) * 2, vy: -sh * 1.5 + (Math.random() - 0.5) * 2,
                        life: 12, max: 12, color: lv ? SPARK[lv] : 'rgba(255,255,255,.55)', size: lv ? 3 : 2.4 });
                }
            }
            if (k.boost > 0) {
                particles.push({ x: x - ch * 20, y: y - sh * 20, vx: -ch * 3 + (Math.random() - 0.5), vy: -sh * 3 + (Math.random() - 0.5),
                    life: 14, max: 14, color: Math.random() < 0.5 ? '#fb923c' : '#fde047', size: 4 });
            } else if (k.off && Math.hypot(k.vx, k.vy) > 2 && animTick % 3 === 0) {
                particles.push({ x: x - ch * 16, y: y - sh * 16, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5,
                    life: 18, max: 18, color: '#65a30d', size: 3 });
            }
        }
        particles = particles.filter(p => {
            p.x += p.vx; p.y += p.vy; p.vx *= 0.92; p.vy *= 0.92;
            return --p.life > 0;
        });
        popTexts = popTexts.filter(t => { t.dy -= 0.6; return --t.life > 0; });
        if (banner && --banner.t <= 0) banner = null;
        if (flash && --flash.t <= 0) flash = null;
        for (const k of [gs.p1, gs.p2]) {
            if (k.star > 0 && animTick % 2 === 0 && (gs.status === 'racing' || gs.status === 'finished')) {
                particles.push({ x: k.x + smooth[k.id].x + (Math.random() - 0.5) * 30, y: k.y + smooth[k.id].y + (Math.random() - 0.5) * 30,
                    vx: 0, vy: 0, life: 16, max: 16, color: `hsl(${Math.random() * 360},100%,70%)`, size: 2.5 });
            }
        }
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
    // 渲染
    // ==========================================
    function render() {
        view.begin(ctx);
        const W = view.width, H = view.height;
        const me = kartOf(myId());
        const mo = smooth[me.id];
        const spd = Math.hypot(me.vx, me.vy);
        const chase = viewMode === 'chase';
        // chase：车放在画面偏下（前方看得更远），镜头角度平滑追随车头（打转时不跟着转，免得晕）
        const lead = chase ? 8 : 14;
        const tx = me.x + mo.x + me.vx * lead, ty = me.y + mo.y + me.vy * lead;
        cam.x += (tx - cam.x) * 0.14;
        cam.y += (ty - cam.y) * 0.14;
        cam.z += ((1.08 - spd * 0.018) - cam.z) * 0.05;
        cam.a = wrapA(cam.a + wrapA(me.h + mo.h - cam.a) * (me.spin > 0 ? 0.02 : 0.085));
        camRot = chase ? -(cam.a + Math.PI / 2) : 0;
        const th = TD.theme;

        ctx.fillStyle = th.bg;
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
        ctx.translate(W / 2 + sx, H * (chase ? 0.64 : 0.5) + sy);
        ctx.scale(cam.z, cam.z);
        ctx.rotate(camRot);
        ctx.translate(-cam.x, -cam.y);
        // 旋转后用外接圆做视野裁剪
        const vr = Math.hypot(W, H) / cam.z * (chase ? 0.7 : 0.5) + 60;
        const x0 = cam.x - vr, x1 = cam.x + vr, y0 = cam.y - vr, y1 = cam.y + vr;
        const inView = (x, y) => x > x0 && x < x1 && y > y0 && y < y1;
        {
            const dx = (me.x + mo.x - cam.x) * cam.z, dy = (me.y + mo.y - cam.y) * cam.z;
            const c = Math.cos(camRot), s = Math.sin(camRot);
            kartScr = { x: W / 2 + dx * c - dy * s, y: H * (chase ? 0.64 : 0.5) + dx * s + dy * c };
        }

        // 地面棋盘格
        const T = 96;
        ctx.fillStyle = th.bg2;
        for (let gx = Math.floor(x0 / T); gx <= Math.ceil(x1 / T); gx++) {
            for (let gy = Math.floor(y0 / T); gy <= Math.ceil(y1 / T); gy++) {
                if ((gx + gy) & 1) ctx.fillRect(gx * T, gy * T, T, T);
            }
        }

        // 赛道层
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = th.wall; ctx.lineWidth = WALL * 2 + 14; ctx.stroke(trackPath);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = WALL * 2 + 4; ctx.setLineDash([30, 30]); ctx.stroke(trackPath); ctx.setLineDash([]);
        ctx.strokeStyle = th.runoff; ctx.lineWidth = WALL * 2; ctx.stroke(trackPath);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = (HW + CURB) * 2; ctx.stroke(trackPath);
        ctx.strokeStyle = th.curb; ctx.setLineDash([22, 22]); ctx.stroke(trackPath); ctx.setLineDash([]);
        ctx.strokeStyle = th.road; ctx.lineWidth = HW * 2; ctx.stroke(trackPath);
        ctx.strokeStyle = th.lane; ctx.lineWidth = 3; ctx.setLineDash([26, 30]); ctx.stroke(trackPath); ctx.setLineDash([]);

        drawStartLine();
        drawPads(inView);

        // 装饰（emoji 保持正立）
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const d of DECOR) {
            if (!inView(d.x, d.y)) continue;
            ctx.font = `${d.s}px sans-serif`;
            uprightText(d.e, d.x, d.y);
        }

        // 道具盒
        for (let i = 0; i < BOXES.length; i++) {
            if (gs.boxes[i]) continue;
            const b = BOXES[i];
            if (!inView(b.x, b.y)) continue;
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(-camRot);
            ctx.translate(0, Math.sin(animTick * 0.08 + i) * 2);
            ctx.rotate(animTick * 0.03 + i);
            const g = ctx.createLinearGradient(-12, -12, 12, 12);
            g.addColorStop(0, `hsl(${(animTick * 3 + i * 40) % 360},90%,72%)`);
            g.addColorStop(1, `hsl(${(animTick * 3 + i * 40 + 120) % 360},90%,66%)`);
            ctx.fillStyle = g;
            ctx.strokeStyle = 'rgba(255,255,255,.9)';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.roundRect(-12, -12, 24, 24, 6); ctx.fill(); ctx.stroke();
            ctx.rotate(-(animTick * 0.03 + i));
            ctx.fillStyle = '#fff';
            ctx.font = '700 15px "Fredoka", sans-serif';
            ctx.fillText('?', 0, 1);
            ctx.restore();
        }

        // 香蕉 / 泡泡导弹 / 炸弹
        ctx.font = '22px sans-serif';
        for (const b of gs.bananas) uprightText('🍌', b.x, b.y);
        for (const m of gs.missiles) {
            ctx.save();
            ctx.translate(m.x, m.y);
            ctx.fillStyle = 'rgba(165,243,252,.35)';
            for (let i = 1; i <= 3; i++) {
                ctx.beginPath();
                ctx.arc(-Math.cos(m.h) * i * 9, -Math.sin(m.h) * i * 9, 7 - i * 1.6, 0, Math.PI * 2);
                ctx.fill();
            }
            const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 11);
            g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#a5f3fc'); g.addColorStop(1, 'rgba(56,189,248,.7)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.restore();
        }
        for (const b of gs.bombs) drawBomb(b);

        // 赛车（屏幕上靠下的后画）
        const depth = k => (chase ? -(k.x * Math.cos(cam.a) + k.y * Math.sin(cam.a)) : k.y);
        [gs.p1, gs.p2].sort((a, b) => depth(a) - depth(b)).forEach(drawKart);
        if (!chase) drawStickAim(me);

        for (const p of particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.font = '700 14px "Fredoka", sans-serif';
        for (const t of popTexts) {
            ctx.globalAlpha = Math.min(1, t.life / 18);
            ctx.save();
            ctx.translate(t.x, t.y);
            ctx.rotate(-camRot);
            ctx.translate(0, t.dy);
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(30,20,60,.8)';
            ctx.strokeText(t.text, 0, 0);
            ctx.fillStyle = t.color;
            ctx.fillText(t.text, 0, 0);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        if (th.night) drawNightVignette(W, H);
        if (flash) { ctx.fillStyle = flash.color + (flash.t / 14 * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }
        if (me.ink > 0) drawInk(W, H, me.ink);
        drawHud(W, H);
    }

    /** fillText that stays upright on screen whatever the camera rotation. */
    function uprightText(text, x, y) {
        if (!camRot) { ctx.fillText(text, x, y); return; }
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-camRot);
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }

    function drawPads(inView) {
        for (const pd of PADS) {
            if (!inView(pd.x, pd.y)) continue;
            ctx.save();
            ctx.translate(pd.x, pd.y);
            ctx.rotate(pd.a);
            ctx.fillStyle = 'rgba(253,224,71,.9)';
            ctx.beginPath(); ctx.roundRect(-22, -32, 44, 64, 8); ctx.fill();
            const ph = (animTick % 30) / 30;
            for (let i = 0; i < 3; i++) {
                const ox = -14 + i * 12 + ph * 6;
                ctx.fillStyle = i === Math.floor(animTick / 8) % 3 ? '#ffffff' : '#f97316';
                ctx.beginPath();
                ctx.moveTo(ox, -22); ctx.lineTo(ox + 10, 0); ctx.lineTo(ox, 22); ctx.lineTo(ox - 5, 22);
                ctx.lineTo(ox + 5, 0); ctx.lineTo(ox - 5, -22);
                ctx.closePath(); ctx.fill();
            }
            ctx.restore();
        }
    }

    function drawBomb(b) {
        ctx.save();
        ctx.translate(b.x, b.y);
        const fuse = b.t > 70 && Math.floor(animTick / 3) % 2;
        ctx.fillStyle = 'rgba(0,0,0,.22)';
        ctx.beginPath(); ctx.ellipse(3, 5, 13, 9, 0, 0, Math.PI * 2); ctx.fill();
        if (fuse) {
            ctx.strokeStyle = 'rgba(248,113,113,.55)';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 8]);
            ctx.beginPath(); ctx.arc(0, 0, BOMB_R, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.rotate(-camRot);
        ctx.font = `${fuse ? 28 : 24}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💣', 0, 0);
        ctx.restore();
    }

    function drawNightVignette(W, H) {
        const g = ctx.createRadialGradient(W / 2, H * 0.6, Math.min(W, H) * 0.3, W / 2, H * 0.6, Math.hypot(W, H) * 0.62);
        g.addColorStop(0, 'rgba(10,5,30,0)');
        g.addColorStop(1, 'rgba(10,5,30,.55)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    // 墨鱼汁：屏幕上糊几团墨，最后一秒慢慢淡掉
    const INK_BLOBS = [[0.3, 0.35, 0.16], [0.62, 0.28, 0.13], [0.5, 0.58, 0.2], [0.78, 0.6, 0.12], [0.2, 0.7, 0.11]];
    function drawInk(W, H, t) {
        const S = Math.min(W, H);
        ctx.save();
        ctx.globalAlpha = Math.min(1, t / 60) * 0.92;
        ctx.fillStyle = '#1e1b2e';
        for (const [fx, fy, fr] of INK_BLOBS) {
            const cx = fx * W, cy = fy * H, r = fr * S * 1.1;
            ctx.beginPath();
            for (let i = 0; i <= 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                const rr = r * (0.75 + 0.25 * Math.sin(i * 2.7 + fx * 10));
                if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
                else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
            }
            ctx.closePath();
            ctx.fill();
            ctx.beginPath(); ctx.arc(cx + r * 0.9, cy + r * 0.7, r * 0.18, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    // 触屏时在自己车外圈画一个目标方向箭头，让“摇杆=方向”一眼可见
    function drawStickAim(me) {
        let ang = pointAngle();
        if (ang === null) {
            if (viewMode === 'chase' || !touch.active || touch.mag < STICK_DEAD) return;
            ang = touch.ang;
        }
        const o = smooth[me.id];
        ctx.save();
        ctx.translate(me.x + o.x, me.y + o.y);
        ctx.rotate(ang);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(30,20,60,.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(48, 0); ctx.lineTo(36, -8); ctx.lineTo(36, 8); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
    }

    function drawStartLine() {
        const p = pointAt(S0, 0);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        const sq = 10, rows = 2, n = Math.ceil((HW * 2) / sq);
        for (let r = 0; r < rows; r++) {
            for (let i = 0; i < n; i++) {
                ctx.fillStyle = (i + r) & 1 ? '#1f1b2e' : '#ffffff';
                ctx.fillRect(-sq + r * sq, -HW + i * sq, sq, sq);
            }
        }
        ctx.restore();
        // 拱门旗帜
        for (const side of [-1, 1]) {
            const q = pointAt(S0, side * (HW + CURB + 10));
            ctx.font = '22px sans-serif';
            uprightText('🏁', q.x, q.y);
        }
    }

    function drawKart(k) {
        const o = smooth[k.id];
        const x = k.x + o.x, y = k.y + o.y;
        const h = k.h + o.h + k.spinA + (k.drift ? k.drift * 0.32 : 0);
        const color = COLORS[k.id];
        ctx.save();
        ctx.translate(x, y);
        if (k.inv > 0 && k.spin <= 0 && k.star <= 0 && Math.floor(animTick / 4) % 2) ctx.globalAlpha = 0.55;
        if (k.zap > 0) ctx.scale(0.68, 0.68);           // 被闪电缩小
        if (k.star > 0) {
            const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 36);
            g.addColorStop(0, `hsla(${animTick * 12 % 360},100%,70%,.85)`);
            g.addColorStop(1, 'hsla(0,100%,70%,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(0, 0, 36, 0, Math.PI * 2); ctx.fill();
        }

        ctx.fillStyle = 'rgba(0,0,0,.22)';
        ctx.beginPath(); ctx.ellipse(3, 5, 23, 16, h, 0, Math.PI * 2); ctx.fill();

        ctx.save();
        ctx.rotate(h);
        // 轮子
        ctx.fillStyle = '#2b2440';
        for (const [wx, wy] of [[11, -13], [11, 13], [-12, -14], [-12, 14]]) {
            ctx.beginPath(); ctx.roundRect(wx - 6, wy - 4, 12, 8, 3); ctx.fill();
        }
        // 车身
        ctx.fillStyle = k.star > 0 ? `hsl(${animTick * 12 % 360},90%,62%)` : color;
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(-18, -11, 36, 22, 9); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.roundRect(8, -8, 9, 16, 4); ctx.fill();             // 前保险杠高光
        ctx.fillStyle = '#fde047';
        ctx.beginPath(); ctx.roundRect(-22, -12, 5, 24, 2); ctx.fill();         // 尾翼
        ctx.restore();

        // 护盾泡泡
        if (k.shield > 0) {
            ctx.strokeStyle = `rgba(165,180,252,${0.6 + Math.sin(animTick * 0.2) * 0.25})`;
            ctx.fillStyle = 'rgba(165,180,252,.15)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }

        // Q版车手（头部保持正立）
        const bob = Math.sin(animTick * 0.3 + k.id) * (Math.hypot(k.vx, k.vy) > 1 ? 1.2 : 0.3);
        ctx.rotate(-camRot);
        view.upright(ctx, 0, 0);
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(DRIVER[k.id], 0, -4 + bob);
        if (k.id !== myId()) {
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.moveTo(-6, -36); ctx.lineTo(6, -36); ctx.lineTo(0, -28); ctx.fill();
        }
        if (k.roll > 0 || k.item) {
            ctx.font = '13px sans-serif';
            ctx.fillText(k.item ? ITEMS[k.item] : ITEMS[ITEM_KEYS[Math.floor(animTick / 4) % ITEM_KEYS.length]], 18, -22);
            if (k.item === 'triple' && k.ic > 1) { ctx.font = '700 10px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('×' + k.ic, 30, -16); }
        }
        ctx.restore();
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
        const lap = clamp(Math.floor(me.prog / L) + 1, 1, LAPS);
        const S = Math.min(W, H);
        const pad = 12;

        hudText(`LAP ${me.fin ? LAPS : lap}/${LAPS}`, pad, pad + 14, 22, '#fde047');
        const secs = gs.frame / 60;
        hudText(`${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, '0')}`, pad, pad + 40, 15, '#e9d5ff');
        hudText(`${TD.icon} ${TD.name}`, pad, pad + 60, 12, '#f5f3ff');

        const place = placeOf(me);
        hudText(ordinal(place), W - pad - 64, pad + 22, 34, place === 1 ? '#fde047' : '#cbd5e1', 'right');

        // 道具槽
        const bx = W - pad - 52, by = pad;
        ctx.fillStyle = 'rgba(30,20,60,.6)';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.roundRect(bx, by, 52, 52, 12); ctx.fill(); ctx.stroke();
        ctx.font = '30px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (me.item) {
            ctx.fillText(ITEMS[me.item], bx + 26, by + 28);
            if (me.item === 'triple') hudText('×' + me.ic, bx + 50, by + 46, 14, '#fde047', 'right');
        } else if (me.roll > 0) ctx.fillText(ITEMS[ITEM_KEYS[Math.floor(animTick / 3) % ITEM_KEYS.length]], bx + 26, by + 28);
        if (me.item) hudText(ITEM_NAME[me.item], bx + 26, by + 64, 11, '#e9d5ff', 'center');
        // 状态提示
        const flags = [];
        if (me.star > 0) flags.push(['⭐ 无敌', '#fde047']);
        if (me.zap > 0) flags.push(['⚡ 缩小中', '#93c5fd']);
        if (me.shield > 0) flags.push(['🛡️ 护盾', '#c7d2fe']);
        flags.forEach(([t, c], i) => hudText(t, W - pad, by + 86 + i * 20, 13, c, 'right'));

        // 漂移火花等级 / 加速条
        if (me.drift) {
            const lv = driftLevel(me.charge);
            const next = DRIFT_LV[Math.min(3, lv + 1)];
            const f = lv >= 3 ? 1 : (me.charge - DRIFT_LV[lv]) / (next - DRIFT_LV[lv]);
            const w = 110, x = W / 2 - w / 2, y = H - 26;
            ctx.fillStyle = 'rgba(30,20,60,.6)';
            ctx.beginPath(); ctx.roundRect(x, y, w, 10, 5); ctx.fill();
            ctx.fillStyle = SPARK[Math.min(3, lv + 1)];
            ctx.beginPath(); ctx.roundRect(x, y, w * clamp(f, 0.05, 1), 10, 5); ctx.fill();
        }

        drawMinimap(W, H, S);

        // 倒数 / 横幅 / 逆行
        if (gs.status === 'countdown') {
            const n = Math.ceil(gs.cd / 60);   // 210‥181 READY · 3 · 2 · 1 · GO
            if (n >= 1 && n <= 3) {
                const f = (gs.cd % 60) / 60;
                hudText(String(n), W / 2, H * 0.4, 60 + f * 30, ['#4ade80', '#fde047', '#fb923c'][n - 1] || '#fff', 'center');
            } else if (gs.cd > 0) {
                hudText('READY', W / 2, H * 0.4, 44, '#fff', 'center');
            }
        }
        if (banner) {
            ctx.globalAlpha = Math.min(1, banner.t / 15);
            hudText(banner.text, W / 2, H * 0.3, 40, banner.color, 'center');
            ctx.globalAlpha = 1;
        }
        if (me.wrong > 45 && animTick % 40 < 26) hudText('⚠️ 逆行!', W / 2, H * 0.55, 30, '#f87171', 'center');
        if (me.fin && !banner) hudText(place === 1 ? '🏆 WINNER' : '🏁 FINISHED', W / 2, H * 0.3, 34, '#fde047', 'center');
    }

    function drawMinimap(W, H, S) {
        const B = TRACK.bounds;
        const size = clamp(S * 0.3, 90, 170);
        const sc = size / Math.max(B.maxX - B.minX, B.maxY - B.minY);
        const mw = (B.maxX - B.minX) * sc, mh = (B.maxY - B.minY) * sc;
        const ox = 12, oy = H - mh - 14;
        ctx.save();
        ctx.fillStyle = 'rgba(30,20,60,.45)';
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
        for (const k of [kartOf(3 - myId()), kartOf(myId())]) {   // own dot on top
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
    window.__kart = {
        get state() {
            return JSON.parse(JSON.stringify({ status: gs.status, p1: gs.p1, p2: gs.p2, frame: gs.frame,
                winner: gs.winner, score: gs.score, bananas: gs.bananas, missiles: gs.missiles, bombs: gs.bombs,
                boxes: gs.boxes, track: curTrack, sel: selTrack }));
        },
        get track() { return { id: TD.id, index: curTrack, len: L, laps: LAPS, start: S0, hw: HW, wall: WALL, pads: PADS.length }; },
        tracks: TRACKS.map(t => t.id),
        get view() { return { mode: viewMode, rot: camRot, kartScr }; },
        pointAt
    };
    if (E2E) {
        Object.assign(window.__kart, {
            freeze: on => { e2eFreeze = !!on; },
            freezeBot: on => { e2eFreezeBot = !!on; },
            skipCountdown: () => { if (gs.status === 'countdown') gs.cd = 1; },
            /** place a kart at arc length s (relative to the start line), lateral offset, heading along the track */
            place: (id, s, lat, speed) => {
                const k = kartOf(id), p = pointAt(S0 + s, lat || 0);
                const pr = project(p.x, p.y, -1);
                Object.assign(k, { x: p.x, y: p.y, h: p.a, vx: p.tx * (speed || 0), vy: p.ty * (speed || 0), idx: pr.idx, s: pr.s, prog: s });
            },
            give: (id, item) => { kartOf(id).item = item; },
            set: (id, props) => Object.assign(kartOf(id), props)
        });
    }

    setViewMode(viewMode);
    renderPickers();
    render();
});
