/**
 * Link Paint — 滚筒涂地：Q版第一人称迷宫抢地盘（WebRTC 联机 / 人机对战）
 * 基于 tag/（再往上是 blaster/）的射线投射引擎与单手操控。
 *
 * 规则：推着滚筒走过的地板涂成自己的颜色，可以覆盖对方的颜色。
 *       在自己颜色上跑得快、在对方颜色上变慢；冲刺撞到对方会把 TA 撞晕并溅一大片颜色。
 *       ROUND_TIME 秒后，地盘大的一方获胜。地板用 floor casting 绘制涂色。
 *
 * 渲染：Canvas 2D 射线投射（Wolfenstein 式 DDA），无第三方依赖。
 * 同步：Host-Authoritative —— Host 跑全部模拟并 60Hz 广播状态；
 *       Client 只上报输入（含本地视角角度，保证转头零延迟），
 *       并对自己的位置做本地预测 + 平滑校正。
 * 人机：mode === 'bot' 时本机就是 Host，P2 的输入由 botThink() 产生，
 *       与联机共用同一套模拟代码。
 */
document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash || location.hash.length <= 1) {
        location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    }
    const params = new URLSearchParams(location.search);
    const opponentName = params.get('opponent') || '';
    const waitingText = opponentName ? `WAITING FOR ${opponentName.toUpperCase()}` : 'WAITING FOR PEER';

    const $ = id => document.getElementById(id);
    const canvas = $('game-canvas');
    const ctx = canvas.getContext('2d');
    // 渲染分辨率随屏幕比例变化（GameFit adaptive：短边固定 450 逻辑像素），
    // 竖屏手机上画面是竖长的，不再是一条 16:9 的窄带。见 setRenderSize()。
    let W = canvas.width, H = canvas.height;

    const p1ScoreVal = $('p1-score'), p2ScoreVal = $('p2-score');
    const p1Label = $('p1-label'), p2Label = $('p2-label');
    const overlay = $('overlay');
    const screens = {
        lobby: $('lobby-screen'), ready: $('ready-screen'),
        gameover: $('gameover-screen'), disconnect: $('disconnect-screen')
    };
    const inviteUrlInput = $('invite-url'), copyBtn = $('copy-btn');
    const startBtn = $('start-btn'), restartBtn = $('restart-btn');
    const menuBtn = $('menu-btn'), lobbyBtn = $('lobby-btn');
    const connectionStateText = $('connection-state-text'), roleText = $('role-text');
    const winLossTitle = $('win-loss-title'), winnerMascot = $('winner-mascot'), finalScore = $('final-score');
    const statusText = $('status-text'), pingText = $('ping-text'), roleStatusText = $('role-status-text');

    // 邀请链接不带 ?bot= 等参数，避免好友打开后直接进人机
    const inviteUrl = location.origin + location.pathname + location.hash;
    inviteUrlInput.value = inviteUrl;
    copyBtn.addEventListener('click', () => {
        const done = () => { copyBtn.textContent = 'COPIED!'; setTimeout(() => { copyBtn.textContent = 'COPY'; }, 2000); };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(inviteUrl).then(done, () => { inviteUrlInput.select(); document.execCommand('copy'); done(); });
        } else {
            inviteUrlInput.select(); document.execCommand('copy'); done();
        }
    });

    // ==========================================
    // 地图（16×16，180° 旋转对称）
    // ==========================================
    const TOP_HALF = [
        '1111111111111111',
        '1......1.......1',
        '1.22.......33..1',
        '1.2...44.......1',
        '1.....4....5...1',
        '1..........5...1',
        '1..3...........1',
        '1.......2......1'
    ];
    const MAP_ROWS = TOP_HALF.concat(TOP_HALF.slice().reverse().map(r => r.split('').reverse().join('')));
    const MAP_W = 16, MAP_H = 16;
    const MAP = MAP_ROWS.map(r => r.split('').map(c => (c === '.' ? 0 : +c)));
    const tileAt = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? 1 : MAP[y][x];
    const solid = (x, y) => tileAt(Math.floor(x), Math.floor(y)) > 0;

    const SPAWNS = [[1.5, 1.5], [14.5, 14.5], [14.5, 1.5], [1.5, 14.5], [8.5, 1.5], [7.5, 14.5]];
    const PICKUP_SPOTS = [[7.5, 7.5], [8.5, 8.5], [3.5, 12.5], [12.5, 3.5], [4.5, 4.5], [11.5, 11.5]]
        .filter(([x, y]) => !solid(x, y));

    // ==========================================
    // 玩法常量（秒 / 格）
    // ==========================================
    const DT = 1 / 60;
    const MOVE_SPEED = 3.1, STRAFE_SPEED = 2.7;
    const PLAYER_R = 0.22, HIT_R = 0.34;
    const PG = 2;                          // 每格地板细分成 PG×PG 个涂色小格
    const GW = MAP_W * PG, GH = MAP_H * PG;
    const ROLLER_R = 0.42, BIG_R = 0.78, BIG_TIME = 6;
    const OWN_MUL = 1.12, ENEMY_MUL = 0.8;
    const BUMP_R = 0.62, STUN_TIME = 1.2, SPLASH_R = 1.25, BUMP_IMMUNE = 1.6;
    const DASH_TIME = 0.32, DASH_MUL = 2.1, DASH_CD = 3.0;
    const BOOST_TIME = 4, BOOST_MUL = 1.3;
    const ROUND_TIME = 90;
    const COUNTDOWN = 2.4;
    const MAX_HP = 100;   // 仅为与 blaster 共用的绘制代码保留
    // 视野：16:9 时 0.66（约 67°）；越窄的屏幕视野越小，避免竖屏时画面像鱼眼一样被横向挤压
    let FOV_K = 0.66;
    let PROJ = H;   // 墙体/精灵的垂直投影比例（16:9、800 宽时正好等于原来的 H=450）
    const KEY_TURN_SPEED = 2.6;

    const CHARS = {
        bunny: { name: '奶糖兔', emoji: '🐰', body: '#ffb3d1', belly: '#fff0f6', dark: '#e0789f', bubble: [255, 143, 192] },
        bear:  { name: '可可熊', emoji: '🐻', body: '#e0aa7c', belly: '#fbe3c8', dark: '#a96f44', bubble: [255, 197, 107] },
        bot:   { name: '布丁机器人', emoji: '🤖', body: '#9fe6d6', belly: '#e8fffa', dark: '#4fae9b', bubble: [127, 224, 255] }
    };

    // ==========================================
    // 运行状态
    // ==========================================
    let mode = 'idle';        // 'idle' | 'bot' | 'pvp'
    let myRole = null;        // 'host' | 'client'（来自 GameSession）
    let botLevel = 'normal';
    let channelOpen = false;
    let shownGameover = false;

    function createPlayer(id, spawn, a) {
        // cells：涂色格数；frz：被撞晕剩余；imm：撞晕保护；dash：冲刺剩余；cd：冲刺冷却；boost：⚡；big：🎨大滚筒
        return {
            id, x: spawn[0], y: spawn[1], a, vx: 0, vy: 0,
            hp: MAX_HP, cells: 0, dead: 0, frz: 0, imm: 0, dash: 0, boost: 0, big: 0,
            cd: 0, hurt: 0, walk: 0, moving: 0, bumps: 0
        };
    }

    function createInitialState() {
        return {
            p1: createPlayer(1, SPAWNS[0], Math.PI / 4),
            p2: createPlayer(2, SPAWNS[1], -3 * Math.PI / 4),
            grid: new Uint8Array(GW * GH),      // 0 = 未涂，1/2 = 玩家颜色
            timer: ROUND_TIME,
            pickups: [],
            pickupTimer: 5,
            countdown: COUNTDOWN,
            status: 'lobby',     // 'lobby' | 'playing' | 'gameover'
            winner: 0,           // 1 | 2 | 3(平局)
            seq: 0
        };
    }

    let gs = createInitialState();

    const meKey = () => (mode === 'pvp' && myRole === 'client') ? 'p2' : 'p1';
    const foeKey = () => (meKey() === 'p1' ? 'p2' : 'p1');
    const charOf = key => key === 'p1' ? CHARS.bunny : (mode === 'bot' ? CHARS.bot : CHARS.bear);
    const kindOf = key => key === 'p1' ? 'bunny' : (mode === 'bot' ? 'bot' : 'bear');
    const idOf = key => key === 'p1' ? 1 : 2;
    const myId = () => idOf(meKey());
    const PAINT_RGB = { 1: [255, 128, 182], 2: [92, 200, 255] };   // 兔子粉 / 对手蓝
    const paintAt = (x, y) => {
        const gx = Math.floor(x * PG), gy = Math.floor(y * PG);
        return (gx < 0 || gy < 0 || gx >= GW || gy >= GH) ? 0 : gs.grid[gy * GW + gx];
    };

    // ==========================================
    // 输入：键盘 / 鼠标指针锁定 / 触屏
    // ==========================================
    const keys = { f: false, b: false, l: false, r: false, tl: false, tr: false, fire: false };
    let localAngle = gs.p1.a;
    const remoteInput = { f: 0, b: 0, l: 0, r: 0, a: 0, fire: 0, seq: -1 };
    const MOUSE_SENS = 0.0026, TOUCH_SENS = 0.0065;

    function setKey(e, down) {
        const k = e.key.toLowerCase();
        let hit = true;
        if (k === 'w' || k === 'arrowup') keys.f = down;
        else if (k === 's' || k === 'arrowdown') keys.b = down;
        else if (k === 'a') keys.l = down;
        else if (k === 'd') keys.r = down;
        else if (k === 'arrowleft' || k === 'q') keys.tl = down;
        else if (k === 'arrowright' || k === 'e') keys.tr = down;
        else if (k === ' ' || k === 'j') keys.fire = down;
        else hit = false;
        if (hit && gs.status === 'playing' && mode !== 'idle') e.preventDefault();
    }
    window.addEventListener('keydown', e => setKey(e, true));
    window.addEventListener('keyup', e => setKey(e, false));
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseFwd = false; stick.id = null; });

    const playing = () => gs.status === 'playing' && mode !== 'idle';
    const locked = () => document.pointerLockElement === canvas;
    let dragging = false, mouseFwd = false;

    canvas.addEventListener('mousedown', e => {
        if (!playing()) return;
        if (e.button === 0) {
            if (!locked() && canvas.requestPointerLock) {
                try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* ignore */ }
            }
            keys.fire = true;
            dragging = true;
        } else if (e.button === 2) {
            // 单手鼠标：按住右键前进（配合移动鼠标转向、左键开火）
            mouseFwd = true;
        }
    });
    window.addEventListener('mouseup', e => {
        if (e.button === 0) { keys.fire = false; dragging = false; }
        else if (e.button === 2) mouseFwd = false;
    });
    window.addEventListener('mousemove', e => {
        if (!playing()) return;
        // 指针锁定时直接转头；未锁定（浏览器拒绝）时按住拖动也能转头
        if (locked() || dragging) localAngle += e.movementX * MOUSE_SENS;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // ==========================================
    // 操控设置：单手 / 双手、左右手、自动开火（localStorage 记忆）
    // ==========================================
    const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    const ctrl = (() => {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('paint-ctrl') || '{}') || {}; } catch (_) { /* ignore */ }
        return {
            oneHand: typeof saved.oneHand === 'boolean' ? saved.oneHand : coarse,
            hand: saved.hand === 'left' ? 'left' : 'right',
            autoFire: typeof saved.autoFire === 'boolean' ? saved.autoFire : false
        };
    })();
    const touchControls = document.querySelector('.touch-controls');
    const modeBtn = $('ctrl-mode-btn'), handBtn = $('ctrl-hand-btn');
    const autoBtn = $('ctrl-auto-btn'), autoChk = $('autofire-chk');
    function applyCtrl() {
        try { localStorage.setItem('paint-ctrl', JSON.stringify(ctrl)); } catch (_) { /* ignore */ }
        if (touchControls) {
            touchControls.classList.toggle('one-hand', ctrl.oneHand);
            touchControls.classList.toggle('left-hand', ctrl.hand === 'left');
        }
        if (modeBtn) modeBtn.textContent = ctrl.oneHand ? '🖐 单手' : '🙌 双手';
        if (handBtn) handBtn.textContent = ctrl.hand === 'left' ? '👈 左手' : '👉 右手';
        if (autoBtn) { autoBtn.textContent = ctrl.autoFire ? '🎯 撞人辅助：开' : '🎯 撞人辅助：关'; autoBtn.classList.toggle('on', ctrl.autoFire); }
        if (autoChk) autoChk.checked = ctrl.autoFire;
    }
    const tapBtn = (el, fn) => el && el.addEventListener('click', e => { e.preventDefault(); fn(); applyCtrl(); });
    tapBtn(modeBtn, () => { ctrl.oneHand = !ctrl.oneHand; });
    tapBtn(handBtn, () => { ctrl.hand = ctrl.hand === 'left' ? 'right' : 'left'; });
    tapBtn(autoBtn, () => { ctrl.autoFire = !ctrl.autoFire; });
    if (autoChk) autoChk.addEventListener('change', () => { ctrl.autoFire = autoChk.checked; applyCtrl(); });
    window.addEventListener('keydown', e => {
        if (e.key.toLowerCase() === 'f' && !e.repeat && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) {
            ctrl.autoFire = !ctrl.autoFire; applyCtrl();
            banner(ctrl.autoFire ? '🎯 撞人辅助 ON' : '🎯 撞人辅助 OFF', 0.9);
        }
    });
    applyCtrl();

    // ==========================================
    // 单手摇杆：上下 = 前进/后退，左右 = 转动视角（模拟量），轻点 = 开火
    // 来源：下方摇杆区，或单手模式下直接在画面任意位置按下（浮动摇杆）
    // ==========================================
    const STICK_R = 56;               // 满偏半径（CSS px）
    const STICK_DEAD = 0.14, STICK_TURN = 3.4, TAP_MS = 220, TAP_MOVE = 12;
    const stick = { id: null, src: null, ox: 0, oy: 0, x: 0, y: 0, tx: 0, ty: 0, t0: 0, travel: 0 };
    let tapFireT = 0;
    const stickZone = $('stick-zone'), stickKnob = $('stick-knob');

    function stickVec() {
        if (stick.id === null) return { x: 0, y: 0 };
        let dx = (stick.x - stick.ox) / STICK_R, dy = (stick.y - stick.oy) / STICK_R;
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        return { x: dx, y: dy };
    }
    function drawKnob() {
        if (!stickKnob) return;
        const v = stick.src === 'zone' ? stickVec() : { x: 0, y: 0 };
        stickKnob.style.transform = `translate(${v.x * STICK_R}px, ${v.y * STICK_R}px)`;
        if (stickZone) stickZone.classList.toggle('active', stick.src === 'zone');
    }
    function stickDown(t, src, ox, oy) {
        stick.id = t.identifier; stick.src = src;
        stick.ox = ox; stick.oy = oy; stick.x = t.clientX; stick.y = t.clientY;
        stick.tx = t.clientX; stick.ty = t.clientY;   // 轻点判定以按下点为基准
        stick.t0 = performance.now(); stick.travel = 0;
        unlockAudio(); drawKnob();
    }
    function stickMove(t) {
        stick.travel = Math.max(stick.travel, Math.hypot(t.clientX - stick.tx, t.clientY - stick.ty));
        stick.x = t.clientX; stick.y = t.clientY; drawKnob();
    }
    function stickUp() {
        const tap = performance.now() - stick.t0 < TAP_MS && stick.travel < TAP_MOVE;
        if (tap && playing()) tapFireT = 0.12;   // 轻点 = 冲刺
        stick.id = null; stick.src = null; drawKnob();
    }
    if (stickZone) {
        stickZone.addEventListener('touchstart', e => {
            e.preventDefault();
            const t = e.changedTouches[0];
            if (stick.id !== null || !t) return;
            const r = stickZone.getBoundingClientRect();
            stickDown(t, 'zone', r.left + r.width / 2, r.top + r.height / 2);
        }, { passive: false });
    }

    // 画面触控：双手模式 = 拖动转头；单手模式 = 浮动摇杆
    let touchLookId = null, touchLastX = 0;
    canvas.addEventListener('touchstart', e => {
        for (const t of e.changedTouches) {
            if (ctrl.oneHand) {
                if (stick.id === null) stickDown(t, 'canvas', t.clientX, t.clientY);
            } else if (touchLookId === null) { touchLookId = t.identifier; touchLastX = t.clientX; }
        }
        e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', e => {
        let mine = false;
        for (const t of e.changedTouches) {
            if (t.identifier === stick.id) {
                mine = true;
                stickMove(t);
            } else if (t.identifier === touchLookId) {
                mine = true;
                if (playing()) localAngle += (t.clientX - touchLastX) * TOUCH_SENS;
                touchLastX = t.clientX;
            }
        }
        if (mine && e.cancelable) e.preventDefault();
    }, { passive: false });
    const endTouch = e => {
        for (const t of e.changedTouches) {
            if (t.identifier === touchLookId) touchLookId = null;
            if (t.identifier === stick.id) stickUp();
        }
    };
    window.addEventListener('touchend', endTouch);
    window.addEventListener('touchcancel', endTouch);

    document.querySelectorAll('.touch-btn').forEach(btn => {
        const action = btn.dataset.action;
        const on = e => { e.preventDefault(); keys[action] = true; btn.classList.add('active'); unlockAudio(); };
        const off = e => { e.preventDefault(); keys[action] = false; btn.classList.remove('active'); };
        btn.addEventListener('touchstart', on, { passive: false });
        btn.addEventListener('touchend', off, { passive: false });
        btn.addEventListener('touchcancel', off, { passive: false });
        btn.addEventListener('mousedown', on);
        btn.addEventListener('mouseup', off);
        btn.addEventListener('mouseleave', off);
    });

    // 自动开火 + 轻度瞄准吸附：只用本机已知的渲染数据，不改网络协议
    // 单手锁定（strafeLock）：单手模式下准星吸住对手后，摇杆左右从“转视角”改为“平移”，
    // 视角由锁定自动跟随。带迟滞：进入要求准星接近对手，退出要丢失视线/偏离过大并持续一小段时间。
    const LOCK_ENTER = 0.32, LOCK_EXIT = 0.75, LOCK_GRACE = 0.35, LOCK_RANGE = 11;
    let autoAimOn = false, strafeLock = false, lockLostT = 0, e2eFreezeBot = false;
    function foeBearing() {
        if (!playing() || gs.countdown > 0) return null;
        const me = gs[meKey()], foe = gs[foeKey()];
        if (!ctrl.autoFire || me.frz > 0 || foe.frz > 0 || foe.imm > 0) return null;   // 涂地时视角自由；只有开了撞人辅助才吸附/锁定
        const px = cam.x, py = cam.y;
        const dist = Math.hypot(foe.x - px, foe.y - py);
        if (dist > LOCK_RANGE || !hasLOS(px, py, foe.x, foe.y)) return null;
        return { d: wrapAngle(Math.atan2(foe.y - py, foe.x - px) - localAngle), dist, foe };
    }
    function updateLock(t, dt) {
        if (!ctrl.oneHand) { strafeLock = false; lockLostT = 0; return; }
        const ad = t ? Math.abs(t.d) : Infinity;
        if (!strafeLock) {
            if (ad < LOCK_ENTER) { strafeLock = true; lockLostT = 0; }
            return;
        }
        if (ad > LOCK_EXIT) {
            lockLostT += dt;
            if (lockLostT > LOCK_GRACE) strafeLock = false;
        } else lockLostT = 0;
    }
    function autoAim(dt) {
        autoAimOn = false;
        const t = foeBearing();
        updateLock(t, dt);
        if (!t) return false;
        const { d, dist, foe } = t;
        if (strafeLock) {
            // 锁定：平移时持续跟住对手（比普通吸附更强）
            localAngle += d * Math.min(1, 9 * dt);
        } else if (Math.abs(d) < 0.32) {
            // 吸附：准星附近才轻拉，摇杆/鼠标大幅转动时会自然盖过它
            localAngle += d * Math.min(1, 5 * dt);
        }
        const tol = Math.atan2(HIT_R * 0.9, dist);
        autoAimOn = Math.abs(d) < tol * 1.6;
        // 追踪辅助：正对着且够近时自动冲刺扑过去
        return autoAimOn && dist < 2.0 && gs[meKey()].cd <= 0;
    }

    function collectLocalInput(dt) {
        if (keys.tl) localAngle -= KEY_TURN_SPEED * dt;
        if (keys.tr) localAngle += KEY_TURN_SPEED * dt;
        let sf = 0, sb = 0, sl = 0, sr = 0;
        const assist = ctrl.autoFire || stick.id !== null || ctrl.oneHand;
        const autoShot = assist ? autoAim(dt) && ctrl.autoFire : (autoAimOn = false, strafeLock = false, false);
        if (stick.id !== null && playing()) {
            const v = stickVec();
            const ax = Math.abs(v.x);
            if (strafeLock) {
                if (v.x < -0.3) sl = 1; else if (v.x > 0.3) sr = 1;
            } else if (ax > STICK_DEAD) {
                localAngle += Math.sign(v.x) * Math.pow((ax - STICK_DEAD) / (1 - STICK_DEAD), 1.6) * STICK_TURN * dt;
            }
            if (v.y < -0.32) sf = 1; else if (v.y > 0.42) sb = 1;
        }
        if (stickZone) stickZone.classList.toggle('strafe', strafeLock);
        tapFireT = Math.max(0, tapFireT - dt);
        localAngle = wrapAngle(localAngle);
        return {
            f: (keys.f || mouseFwd || sf) ? 1 : 0, b: (keys.b || sb) ? 1 : 0,
            l: (keys.l || sl) ? 1 : 0, r: (keys.r || sr) ? 1 : 0, a: localAngle,
            fire: (keys.fire || tapFireT > 0 || autoShot) ? 1 : 0
        };
    }

    // ==========================================
    // 小工具
    // ==========================================
    function wrapAngle(a) {
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        return a;
    }
    const r3 = v => Math.round(v * 1000) / 1000;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function hasLOS(x0, y0, x1, y1) {
        const dx = x1 - x0, dy = y1 - y0;
        const dist = Math.hypot(dx, dy);
        const steps = Math.ceil(dist / 0.08);
        for (let i = 1; i < steps; i++) {
            if (solid(x0 + dx * i / steps, y0 + dy * i / steps)) return false;
        }
        return true;
    }

    function blocked(x, y) {
        return solid(x - PLAYER_R, y - PLAYER_R) || solid(x + PLAYER_R, y - PLAYER_R) ||
               solid(x - PLAYER_R, y + PLAYER_R) || solid(x + PLAYER_R, y + PLAYER_R);
    }

    // 共享的移动积分（Host 模拟与 Client 预测都用它，保证一致）
    // 速度倍率：自己颜色快 / 对方颜色慢 / 冲刺 / ⚡加速 / 撞晕。p 是同步来的玩家状态，Host 与 Client 预测共用
    function speedMul(p) {
        if (!p || p.frz > 0) return 0;
        const c = paintAt(p.x, p.y);
        let m = c === p.id ? OWN_MUL : (c ? ENEMY_MUL : 1);
        if (p.dash > 0) m = DASH_MUL;
        if (p.boost > 0) m *= BOOST_MUL;
        return m;
    }
    function moveBody(body, inp, a, dt, mul) {
        const k = mul == null ? 1 : mul;
        if (k <= 0) return 0;
        const fwd = (inp.f ? 1 : 0) - (inp.b ? 1 : 0);
        const side = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
        // 冲刺时没按方向也往前冲
        const f2 = fwd || side ? fwd : (body.dash > 0 ? 1 : 0);
        let mx = (Math.cos(a) * f2 * MOVE_SPEED - Math.sin(a) * side * STRAFE_SPEED) * k;
        let my = (Math.sin(a) * f2 * MOVE_SPEED + Math.cos(a) * side * STRAFE_SPEED) * k;
        if (f2 && side) { mx *= 0.75; my *= 0.75; }
        const ox = body.x, oy = body.y;
        const nx = body.x + mx * dt;
        if (!blocked(nx, body.y)) body.x = nx;
        const ny = body.y + my * dt;
        if (!blocked(body.x, ny)) body.y = ny;
        return Math.hypot(body.x - ox, body.y - oy) / dt;
    }

    // ==========================================
    // 音效（WebAudio 合成，无素材）
    // ==========================================
    let actx = null;
    function unlockAudio() {
        if (!actx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) { try { actx = new AC(); } catch (_) { actx = null; } }
        }
        if (actx && actx.state === 'suspended') actx.resume();
    }
    function tone(freq, dur, type, vol, slide) {
        if (!actx) return;
        const t = actx.currentTime;
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(vol || 0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t); o.stop(t + dur + 0.02);
    }
    const sfx = {
        dash: () => tone(380, 0.18, 'triangle', 0.07, 900),
        tag: () => { tone(660, 0.1, 'triangle', 0.1); setTimeout(() => tone(990, 0.16, 'triangle', 0.1), 90); },
        caught: () => { tone(520, 0.14, 'square', 0.06, 260); setTimeout(() => tone(330, 0.3, 'sine', 0.08, 160), 120); },
        tick: () => tone(1400, 0.04, 'square', 0.03),
        shoot: () => tone(520, 0.12, 'sine', 0.08, 1100),
        pop: () => tone(900, 0.06, 'triangle', 0.05, 300),
        hit: () => { tone(1200, 0.08, 'square', 0.05, 1600); },
        hurt: () => tone(300, 0.18, 'sawtooth', 0.06, 150),
        ko: () => { tone(660, 0.12, 'triangle', 0.1); setTimeout(() => tone(880, 0.12, 'triangle', 0.1), 110); setTimeout(() => tone(1320, 0.2, 'triangle', 0.1), 220); },
        down: () => tone(440, 0.5, 'sine', 0.1, 110),
        pick: () => { tone(780, 0.08, 'sine', 0.08); setTimeout(() => tone(1170, 0.12, 'sine', 0.08), 80); }
    };

    // ==========================================
    // 模拟（Host / 人机共用）
    // ==========================================
    let pendingFx = [];
    function emit(fx) { pendingFx.push(fx); handleFx(fx); }

    // 涂一个圆：记录变化（发给 Client 的增量），同时维护双方格数
    let paintDelta = [];
    function paintDisc(x, y, r, id) {
        const g = gs.grid;
        const x0 = Math.max(0, Math.floor((x - r) * PG)), x1 = Math.min(GW - 1, Math.floor((x + r) * PG));
        const y0 = Math.max(0, Math.floor((y - r) * PG)), y1 = Math.min(GH - 1, Math.floor((y + r) * PG));
        for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
            const cx = (gx + 0.5) / PG, cy = (gy + 0.5) / PG;
            if ((cx - x) * (cx - x) + (cy - y) * (cy - y) > r * r) continue;
            if (solid(cx, cy)) continue;
            const i = gy * GW + gx, old = g[i];
            if (old === id) continue;
            if (old) gs['p' + old].cells--;
            g[i] = id; gs['p' + id].cells++;
            paintDelta.push(i, id);
        }
    }
    const PAINTABLE = (() => { let n = 0; for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) if (!solid((gx + 0.5) / PG, (gy + 0.5) / PG)) n++; return n; })();

    function stepPlayer(p, other, inp, dt) {
        p.hurt = Math.max(0, p.hurt - dt);
        p.frz = Math.max(0, p.frz - dt);
        p.imm = Math.max(0, p.imm - dt);
        p.big = Math.max(0, p.big - dt);
        p.dash = Math.max(0, p.dash - dt);
        p.boost = Math.max(0, p.boost - dt);
        p.cd = Math.max(0, p.cd - dt);
        if (typeof inp.a === 'number' && isFinite(inp.a)) p.a = wrapAngle(inp.a);

        const frozen = gs.countdown > 0;
        if (!frozen && inp.fire && p.cd <= 0 && p.frz <= 0) {
            p.dash = DASH_TIME;
            p.cd = DASH_CD;
            emit({ k: 'dash', who: p.id });
        }
        const ox = p.x, oy = p.y;
        const speed = frozen ? 0 : moveBody(p, inp, p.a, dt, speedMul(p));
        p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt;
        p.moving = speed > 0.2 ? 1 : 0;
        if (p.moving) p.walk += dt * (p.dash > 0 ? 16 : 9);
    }

    function stepWorld(inp1, inp2, dt) {
        if (gs.status !== 'playing') return;
        const { p1, p2 } = gs;
        if (gs.countdown > 0) gs.countdown = Math.max(0, gs.countdown - dt);
        stepPlayer(p1, p2, inp1, dt);
        stepPlayer(p2, p1, inp2, dt);
        if (gs.countdown > 0) return;

        gs.timer = Math.max(0, gs.timer - dt);
        if (p1.frz <= 0) paintDisc(p1.x, p1.y, p1.big > 0 ? BIG_R : ROLLER_R, 1);
        if (p2.frz <= 0) paintDisc(p2.x, p2.y, p2.big > 0 ? BIG_R : ROLLER_R, 2);

        // 冲刺撞人：被撞的一方晕一下，周围溅满撞人者的颜色
        if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < BUMP_R) {
            for (const [a, b] of [[p1, p2], [p2, p1]]) {
                if (a.dash > 0 && b.imm <= 0 && b.frz <= 0) {
                    b.frz = STUN_TIME; b.imm = BUMP_IMMUNE + STUN_TIME; b.dash = 0; b.hurt = 0.3;
                    a.bumps++;
                    paintDisc(b.x, b.y, SPLASH_R, a.id);
                    emit({ k: 'bump', by: a.id, to: b.id, x: r3(b.x), y: r3(b.y) });
                }
            }
        }

        // ⚡ 加速道具
        gs.pickupTimer -= dt;
        if (gs.pickupTimer <= 0) {
            gs.pickupTimer = 6 + Math.random() * 4;
            if (gs.pickups.length < 2) {
                const free = PICKUP_SPOTS.filter(([x, y]) =>
                    !gs.pickups.some(k => k.x === x && k.y === y) &&
                    Math.hypot(p1.x - x, p1.y - y) > 2 && Math.hypot(p2.x - x, p2.y - y) > 2);
                if (free.length) {
                    const [x, y] = free[Math.floor(Math.random() * free.length)];
                    gs.pickups.push({ x, y, type: Math.random() < 0.5 ? 'big' : 'boost' });
                }
            }
        }
        gs.pickups = gs.pickups.filter(k => {
            for (const p of [p1, p2]) {
                if (Math.hypot(p.x - k.x, p.y - k.y) > 0.55) continue;
                if (k.type === 'big') p.big = BIG_TIME; else p.boost = BOOST_TIME;
                emit({ k: 'pick', who: p.id, type: k.type });
                return false;
            }
            return true;
        });

        if (gs.timer <= 0) {
            gs.status = 'gameover';
            const d = p1.cells - p2.cells;
            gs.winner = d === 0 ? 3 : (d > 0 ? 1 : 2);
        }
    }

    // ==========================================
    // 人机 AI
    // ==========================================
    // turn：转向速度；replan：重新选目标间隔；greed：选点时多看重“近”（越大越不乱跑）；
    // bump：看到对手在身边时主动冲刺撞人的概率；pick：前几名里随机挑（越大越随性）；pause：发呆比例
    const BOT_LEVELS = {
        easy:   { turn: 2.4, replan: 1.4, greed: 0.8, bump: 0,   pick: 6, pause: 0.25, react: 0.6 },
        normal: { turn: 3.6, replan: 0.8, greed: 1.1, bump: 0.5, pick: 3, pause: 0,    react: 0.3 },
        hard:   { turn: 5.4, replan: 0.5, greed: 1.3, bump: 1,   pick: 1, pause: 0,    react: 0.12 }
    };
    let brain = null;
    function resetBrain() {
        brain = {
            seen: 0, path: [], pathT: 0, goalKey: '',
            stuckT: 0, lastX: 0, lastY: 0, unstickT: 0, unstickDir: 1,
            goal: null, goalT: 0, slowT: 0
        };
    }

    // 从一个格子出发的 BFS 步数图（-1 = 不可达）
    function distMap(x, y) {
        const d = new Int16Array(MAP_W * MAP_H).fill(-1);
        const s0 = Math.floor(y) * MAP_W + Math.floor(x);
        if (tileAt(Math.floor(x), Math.floor(y)) > 0) return d;
        d[s0] = 0;
        const q = [s0];
        for (let qi = 0; qi < q.length; qi++) {
            const c = q[qi], cx = c % MAP_W, cy = (c / MAP_W) | 0;
            for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + ddx, ny = cy + ddy;
                if (tileAt(nx, ny) > 0) continue;
                const n = ny * MAP_W + nx;
                if (d[n] !== -1) continue;
                d[n] = d[c] + 1;
                q.push(n);
            }
        }
        return d;
    }
    // 身体宽度的直线可达检测（中心线 + 左右各偏 PLAYER_R）
    function clearLine(x0, y0, x1, y1) {
        const d = Math.hypot(x1 - x0, y1 - y0) || 1;
        const nx = -(y1 - y0) / d * (PLAYER_R + 0.02), ny = (x1 - x0) / d * (PLAYER_R + 0.02);
        return hasLOS(x0, y0, x1, y1) && hasLOS(x0 + nx, y0 + ny, x1 + nx, y1 + ny) && hasLOS(x0 - nx, y0 - ny, x1 - nx, y1 - ny);
    }
    const openNeighbors = (cx, cy) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => tileAt(cx + dx, cy + dy) === 0).length;

    // 选下一块要涂的地：附近 3×3 格里“不是我的颜色”的小格越多越好（对方颜色额外加分），离得越近越好
    function pickPaintTile(me, L) {
        const dM = distMap(me.x, me.y);
        const per = new Float32Array(MAP_W * MAP_H);
        for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
            const tx = (gx / PG) | 0, ty = (gy / PG) | 0;
            if (tileAt(tx, ty) > 0) continue;
            const c = gs.grid[gy * GW + gx];
            if (c !== me.id) per[ty * MAP_W + tx] += c ? 1.4 : 1;
        }
        const cands = [];
        const here = Math.floor(me.y) * MAP_W + Math.floor(me.x);
        for (let c = 0; c < MAP_W * MAP_H; c++) {
            if (dM[c] < 1 || c === here) continue;
            const cx = c % MAP_W, cy = (c / MAP_W) | 0;
            let v = per[c] * 2;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (dx || dy) { const n = (cy + dy) * MAP_W + cx + dx; if (n >= 0 && n < per.length) v += per[n] * 0.5; }
            }
            if (v <= 0) continue;
            cands.push({ c, score: v / Math.pow(dM[c] + 2, L.greed) });
        }
        if (!cands.length) return null;
        cands.sort((a, b) => b.score - a.score);
        const pick = cands[Math.floor(Math.random() * Math.min(L.pick, cands.length))].c;
        return [pick % MAP_W + 0.5, ((pick / MAP_W) | 0) + 0.5];
    }

    function bfsPath(sx, sy, gx, gy) {
        sx = Math.floor(sx); sy = Math.floor(sy); gx = Math.floor(gx); gy = Math.floor(gy);
        if (sx === gx && sy === gy) return [[gx + 0.5, gy + 0.5]];
        const prev = new Int16Array(MAP_W * MAP_H).fill(-1);
        const start = sy * MAP_W + sx, goal = gy * MAP_W + gx;
        prev[start] = start;
        const q = [start];
        for (let qi = 0; qi < q.length; qi++) {
            const c = q[qi];
            if (c === goal) break;
            const cx = c % MAP_W, cy = (c / MAP_W) | 0;
            for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + ddx, ny = cy + ddy;
                if (tileAt(nx, ny) > 0) continue;
                const n = ny * MAP_W + nx;
                if (prev[n] !== -1) continue;
                prev[n] = c;
                q.push(n);
            }
        }
        if (prev[goal] === -1) return [];
        const path = [];
        for (let c = goal; c !== start; c = prev[c]) path.push([(c % MAP_W) + 0.5, ((c / MAP_W) | 0) + 0.5]);
        return path.reverse();
    }

    function turnToward(cur, desired, rate, dt) {
        const d = wrapAngle(desired - cur);
        return wrapAngle(cur + clamp(d, -rate * dt, rate * dt));
    }

    function botThink(dt) {
        const L = BOT_LEVELS[botLevel] || BOT_LEVELS.normal;
        const me = gs.p2, foe = gs.p1;
        const inp = { f: 0, b: 0, l: 0, r: 0, a: me.a, fire: 0 };
        if (e2eFreezeBot) return inp;
        if (gs.status !== 'playing' || gs.countdown > 0 || me.frz > 0) { brain.path = []; return inp; }

        const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
        const sees = hasLOS(me.x, me.y, foe.x, foe.y);

        const followPath = (gx, gy, key) => {
            brain.pathT -= dt;
            if (brain.pathT <= 0 || brain.goalKey !== key || !brain.path.length) {
                brain.path = bfsPath(me.x, me.y, gx, gy);
                brain.pathT = 0.4;
                brain.goalKey = key;
            }
            while (brain.path.length && Math.hypot(brain.path[0][0] - me.x, brain.path[0][1] - me.y) < 0.3) brain.path.shift();
            while (brain.path.length > 1 && clearLine(me.x, me.y, brain.path[1][0], brain.path[1][1])) brain.path.shift();
            const wp = brain.path[0] || [gx, gy];
            const desired = Math.atan2(wp[1] - me.y, wp[0] - me.x);
            inp.a = turnToward(me.a, desired, L.turn * 1.3, dt);
            if (Math.abs(wrapAngle(desired - inp.a)) < 0.9) inp.f = 1;
        };

        if (sees) brain.seen += dt; else brain.seen = 0;

        const canBump = L.bump > 0 && sees && dist < 2.4 && me.cd <= 0 && foe.imm <= 0 && foe.frz <= 0;
        if (canBump && brain.seen > L.react && (L.bump >= 1 || Math.random() < L.bump * dt * 3 || brain.bumping)) {
            // 撞人：转向对手，对准了就冲刺
            brain.bumping = true;
            const desired = Math.atan2(foe.y + foe.vy * 0.2 - me.y, foe.x + foe.vx * 0.2 - me.x);
            inp.a = turnToward(me.a, desired, L.turn, dt);
            inp.f = 1;
            if (Math.abs(wrapAngle(desired - inp.a)) < 0.22 && dist < 1.9) inp.fire = 1;
        } else {
            brain.bumping = false;
            brain.goalT -= dt;
            if (!brain.goal || brain.goalT <= 0 || Math.hypot(brain.goal[0] - me.x, brain.goal[1] - me.y) < 0.45) {
                brain.goal = pickPaintTile(me, L) || [8.5, 8.5];
                brain.goalT = L.replan;
            }
            // 顺路的道具
            let goal = brain.goal;
            for (const k of gs.pickups) if (Math.hypot(k.x - me.x, k.y - me.y) < 2.5) goal = [k.x, k.y];
            followPath(goal[0], goal[1], 'paint' + goal.join(','));
            // 长直道上冲刺，涂得更快（冲刺本身也涂色）
            if (L.bump >= 1 && me.cd <= 0 && brain.path.length && Math.hypot(brain.path[0][0] - me.x, brain.path[0][1] - me.y) > 3) inp.fire = 1;
        }

        // 简单难度偶尔停下发呆
        if (L.pause > 0) {
            brain.slowT -= dt;
            if (brain.slowT <= 0) brain.slowT = 1.2 + Math.random();
            if (brain.slowT < L.pause) { inp.f = 0; inp.fire = 0; }
        }

        // 卡住检测：0.6 秒几乎没动就侧移一下
        brain.stuckT += dt;
        if (brain.stuckT > 0.6) {
            const moved = Math.hypot(me.x - brain.lastX, me.y - brain.lastY);
            if (moved < 0.15 && (inp.f || inp.b || inp.l || inp.r)) {
                brain.unstickT = 0.35; brain.unstickDir = Math.random() < 0.5 ? -1 : 1; brain.path = [];
            }
            brain.stuckT = 0; brain.lastX = me.x; brain.lastY = me.y;
        }
        if (brain.unstickT > 0) {
            brain.unstickT -= dt;
            inp.l = brain.unstickDir < 0 ? 1 : 0;
            inp.r = brain.unstickDir > 0 ? 1 : 0;
            inp.b = 1; inp.f = 0;
        }
        return inp;
    }

    // ==========================================
    // 网络
    // ==========================================
    connectionStateText.textContent = '正在连接信号服务器...';
    const session = new GameSession({
        gameFolder: 'paint',
        dataChannelOptions: { ordered: false, maxRetransmits: 0 },
        onSignalingStatus(status) {
            if (status === 'open') {
                statusText.textContent = waitingText;
                statusText.className = 'status-online';
                connectionStateText.textContent = '已连接信令服务，等待好友通过链接加入…';
            } else if (status === 'closed') {
                statusText.textContent = 'OFFLINE';
                statusText.className = 'status-offline';
                connectionStateText.textContent = '信令连接已断开，正在重连…（人机对战不受影响）';
            }
        },
        onRole(role) {
            myRole = role;
            roleStatusText.textContent = role.toUpperCase();
            updateLabels();
        },
        onChannelOpen() {
            channelOpen = true;
            // 好友到了：结束人机练习，切换到联机准备界面
            mode = 'pvp';
            if (document.pointerLockElement) document.exitPointerLock();
            gs = createInitialState();
            localAngle = gs[meKey()].a;
            predicted = null;
            updateLabels();
            updateScores();
            showScreen('ready');
            if (myRole === 'host') {
                roleText.innerHTML = '你是 <strong>🐰 奶糖兔</strong>（房主）。好友已连接，点击开始！';
                startBtn.classList.remove('hidden');
                startBtn.disabled = false;
            } else {
                roleText.innerHTML = '你是 <strong>🐻 可可熊</strong>。等待房主点击开始…';
                startBtn.classList.add('hidden');
            }
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
            channelOpen = false;
            statusText.textContent = waitingText;
            statusText.className = 'status-online';
            pingText.textContent = '-- ms';
            if (mode !== 'pvp') return;
            mode = 'idle';
            gs.status = 'lobby';
            if (document.pointerLockElement) document.exitPointerLock();
            showScreen('disconnect');
        },
        onRtt(ms) { pingText.textContent = `${ms} ms`; },
        onMessage: handleNet
    });

    let lastStateSeq = -1;
    let restartResend = null;

    function packPlayer(p) {
        return {
            id: p.id, x: r3(p.x), y: r3(p.y), a: r3(p.a), vx: r3(p.vx), vy: r3(p.vy),
            hp: p.hp, cells: p.cells, dead: 0, frz: r3(p.frz), imm: r3(p.imm), dash: r3(p.dash), boost: r3(p.boost), big: r3(p.big),
            cd: r3(p.cd), hurt: r3(p.hurt), walk: r3(p.walk), moving: p.moving, bumps: p.bumps
        };
    }

    // 地板涂色同步：每帧发增量 pd=[格子, 颜色, ...]；通道不可靠，所以每 0.5 秒再附一份完整快照 g
    const gridToStr = g => { let out = ''; for (let i = 0; i < g.length; i++) out += g[i]; return out; };
    function sendState() {
        gs.seq++;
        const full = gs.seq % 30 === 1 || gs.status !== 'playing';
        session.send({
            type: 'state', seq: gs.seq,
            p1: packPlayer(gs.p1), p2: packPlayer(gs.p2),
            timer: r3(gs.timer),
            pd: paintDelta.length ? paintDelta : undefined, g: full ? gridToStr(gs.grid) : undefined,
            pickups: gs.pickups, countdown: r3(gs.countdown),
            status: gs.status, winner: gs.winner,
            fx: pendingFx.length ? pendingFx : undefined
        });
        pendingFx = [];
        paintDelta = [];
    }

    function handleNet(msg) {
        if (!msg || mode !== 'pvp') return;
        if (msg.type === 'state' && myRole === 'client') {
            if (typeof msg.seq === 'number' && msg.seq <= lastStateSeq && msg.seq > lastStateSeq - 1000) return;
            lastStateSeq = msg.seq;
            const prevStatus = gs.status;
            gs.p1 = msg.p1; gs.p2 = msg.p2;
            gs.timer = msg.timer || 0;
            if (typeof msg.g === 'string' && msg.g.length === GW * GH) {
                for (let i = 0; i < msg.g.length; i++) gs.grid[i] = msg.g.charCodeAt(i) - 48;
            }
            if (Array.isArray(msg.pd)) {
                for (let i = 0; i + 1 < msg.pd.length; i += 2) if (msg.pd[i] >= 0 && msg.pd[i] < gs.grid.length) gs.grid[msg.pd[i]] = msg.pd[i + 1];
            }
            gs.pickups = msg.pickups || [];
            gs.countdown = msg.countdown || 0;
            gs.status = msg.status;
            gs.winner = msg.winner;
            if (msg.fx) msg.fx.forEach(handleFx);
            reconcile();
            updateScores();
            if (gs.status === 'playing' && prevStatus !== 'playing') {
                clearInterval(restartResend); restartResend = null;
                shownGameover = false;
                localAngle = gs.p2.a;
                predicted = { x: gs.p2.x, y: gs.p2.y };
                strafeLock = false;
                showScreen(null);
            } else if (gs.status === 'gameover' && !shownGameover) {
                showGameOver();
            }
        } else if (msg.type === 'input' && myRole === 'host') {
            if (typeof msg.seq === 'number' && msg.seq <= remoteInput.seq && msg.seq > remoteInput.seq - 1000) return;
            Object.assign(remoteInput, {
                f: msg.f ? 1 : 0, b: msg.b ? 1 : 0, l: msg.l ? 1 : 0, r: msg.r ? 1 : 0,
                a: typeof msg.a === 'number' ? msg.a : remoteInput.a, fire: msg.fire ? 1 : 0, seq: msg.seq
            });
        } else if (msg.type === 'restart-request' && myRole === 'host') {
            if (gs.status !== 'playing') startMatch();
        }
    }

    // ==========================================
    // 客户端预测
    // ==========================================
    let predicted = null;
    function reconcile() {
        const me = gs[meKey()];
        if (!predicted) { predicted = { x: me.x, y: me.y }; return; }
        const err = Math.hypot(me.x - predicted.x, me.y - predicted.y);
        if (err > 0.8) { predicted.x = me.x; predicted.y = me.y; }
        else { predicted.x += (me.x - predicted.x) * 0.12; predicted.y += (me.y - predicted.y) * 0.12; }
    }

    // 对手位置平滑（client 端）
    const smooth = { x: 0, y: 0, a: 0, init: false };

    // ==========================================
    // 流程控制
    // ==========================================
    function showScreen(name) {
        Object.entries(screens).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
        overlay.classList.toggle('hidden', !name);
    }

    function updateLabels() {
        const mk = meKey();
        const c1 = CHARS.bunny, c2 = charOf('p2');
        const tag = k => (k === mk ? 'YOU' : (mode === 'bot' ? 'BOT' : (k === 'p1' ? 'HOST' : 'CLIENT')));
        p1Label.textContent = `${c1.emoji} ${c1.name} (${tag('p1')})`;
        p2Label.textContent = `${c2.emoji} ${c2.name} (${tag('p2')})`;
    }
    const pct = n => (n * 100 / PAINTABLE).toFixed(1);
    function updateScores() {
        p1ScoreVal.textContent = pct(gs.p1.cells) + '%';
        p2ScoreVal.textContent = pct(gs.p2.cells) + '%';
    }

    function startMatch() {
        gs = createInitialState();
        gs.status = 'playing';
        pendingFx = [];
        strafeLock = false;
        shownGameover = false;
        localAngle = gs[meKey()].a;
        smooth.init = false;
        if (mode === 'bot') resetBrain();
        updateLabels();
        updateScores();
        showScreen(null);
        feed = []; particles = [];
        banner('READY…', COUNTDOWN);
        if (mode === 'pvp') session.send({ type: 'start' });
    }

    function startBot(level) {
        unlockAudio();
        botLevel = BOT_LEVELS[level] ? level : 'normal';
        mode = 'bot';
        startMatch();
        canvas.focus();
    }

    document.querySelectorAll('.btn-bot').forEach(b => b.addEventListener('click', () => startBot(b.dataset.level)));

    startBtn.addEventListener('click', () => {
        unlockAudio();
        if (mode === 'pvp' && myRole === 'host' && gs.status !== 'playing') startMatch();
    });

    restartBtn.addEventListener('click', () => {
        unlockAudio();
        if (mode === 'bot' || (mode === 'pvp' && myRole === 'host')) {
            startMatch();
        } else if (mode === 'pvp') {
            restartBtn.textContent = 'WAITING FOR HOST…';
            restartBtn.disabled = true;
            // 不可靠通道：重发直到收到 playing 状态
            clearInterval(restartResend);
            session.send({ type: 'restart-request' });
            restartResend = setInterval(() => session.send({ type: 'restart-request' }), 500);
        }
    });

    const backToLobby = () => {
        mode = channelOpen ? 'pvp' : 'idle';
        gs = createInitialState();
        updateLabels(); updateScores();
        showScreen(channelOpen ? 'ready' : 'lobby');
    };
    menuBtn.addEventListener('click', backToLobby);
    lobbyBtn.addEventListener('click', backToLobby);

    function showGameOver() {
        shownGameover = true;
        if (document.pointerLockElement) document.exitPointerLock();
        const mk = meKey();
        const draw = gs.winner === 3;
        const iWon = (gs.winner === 1 && mk === 'p1') || (gs.winner === 2 && mk === 'p2');
        winLossTitle.textContent = draw ? 'DRAW 🤝' : (iWon ? 'VICTORY! 🎉' : 'DEFEAT…');
        winLossTitle.style.color = iWon || draw ? '#ffd36b' : '#ff9ab0';
        const wk = gs.winner === 1 ? 'p1' : 'p2';
        winnerMascot.textContent = draw ? '🤝' : '🏆 ' + charOf(wk).emoji;
        finalScore.textContent = `地盘 ${charOf('p1').emoji} ${pct(gs.p1.cells)}% - ${pct(gs.p2.cells)}% ${charOf('p2').emoji}`;
        restartBtn.textContent = mode === 'bot' ? '再来一局' : 'PLAY AGAIN';
        restartBtn.disabled = false;
        menuBtn.classList.toggle('hidden', mode !== 'bot');
        showScreen('gameover');
        if (iWon) sfx.ko(); else sfx.down();
    }

    // ==========================================
    // 特效 / 击杀播报
    // ==========================================
    let feed = [];          // { text, t }
    let particles = [];     // 世界空间泡泡碎片 { x, y, t, c }
    let bannerText = '', bannerT = 0;
    let hitMarkT = 0, hurtFlashT = 0, recoilT = 0;
    let muzzle = [];        // 屏幕空间泡泡 { x, y, vx, vy, r, t }

    function banner(text, t) { bannerText = text; bannerT = t; }

    function handleFx(fx) {
        const myId = meKey() === 'p1' ? 1 : 2;
        const nameOf = id => charOf(id === 1 ? 'p1' : 'p2');
        if (fx.k === 'dash') {
            if (fx.who === myId) { recoilT = 0.2; spawnMuzzle(); }
            sfx.dash();
        } else if (fx.k === 'bump') {
            const a = nameOf(fx.by), b = nameOf(fx.to);
            feed.push({ text: `${a.emoji} 撞晕了 ${b.emoji} 💥🎨`, t: 3 });
            if (feed.length > 4) feed.shift();
            const c = PAINT_RGB[fx.by];
            for (let i = 0; i < 16; i++) particles.push({ x: fx.x, y: fx.y, z: 0.5, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: Math.random() * 1.6, t: 0.7, c });
            if (fx.by === myId) { banner('💥 撞晕啦！', 1.1); hitMarkT = 0.3; sfx.tag(); GameFit.buzz && GameFit.buzz(30); }
            if (fx.to === myId) { banner('💫 被撞晕了…', 1.1); hurtFlashT = 0.5; sfx.caught(); GameFit.buzz && GameFit.buzz([40, 40, 40]); }
            strafeLock = false;
        } else if (fx.k === 'pick') {
            if (fx.who === myId) { banner(fx.type === 'big' ? '🎨 大滚筒！' : '⚡ 加速！', 1.0); sfx.pick(); }
        }
    }

    function spawnMuzzle() {
        for (let i = 0; i < 4; i++) {
            const sd = i % 2 ? 1 : -1;
            muzzle.push({ x: W / 2 + sd * W * 0.3, y: H * 0.9, vx: sd * (60 + Math.random() * 80), vy: -30 - Math.random() * 60, r: 5 + Math.random() * 8, t: 0.45 });
        }
    }

    function updateLocalFx(dt) {
        feed.forEach(f => { f.t -= dt; }); feed = feed.filter(f => f.t > 0);
        particles.forEach(p => { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= 2 * dt; });
        particles = particles.filter(p => p.t > 0);
        muzzle.forEach(m => { m.t -= dt; m.x += m.vx * dt; m.y += m.vy * dt; });
        muzzle = muzzle.filter(m => m.t > 0);
        bannerT = Math.max(0, bannerT - dt);
        hitMarkT = Math.max(0, hitMarkT - dt);
        hurtFlashT = Math.max(0, hurtFlashT - dt);
        recoilT = Math.max(0, recoilT - dt);
    }

    // ==========================================
    // 主循环（60Hz 模拟 + rAF 渲染）
    // ==========================================
    let inputSeq = 0, idleSendTick = 0, lastTick = 0, scoreTick = 0;
    setInterval(() => {
        const dt = DT;
        if (mode === 'bot' || (mode === 'pvp' && myRole === 'host')) {
            const inp1 = collectLocalInput(dt);
            if (gs.status === 'playing') {
                const inp2 = mode === 'bot' ? botThink(dt) : remoteInput;
                stepWorld(inp1, inp2, dt);
                if (gs.status === 'gameover' && !shownGameover) showGameOver();
            }
            if (mode === 'pvp') {
                // 对局中 60Hz；其它阶段 10Hz（保证结算状态在不可靠通道上也能送达）
                if (gs.status === 'playing' || (idleSendTick++ % 6 === 0)) sendState();
            } else {
                pendingFx = [];
                paintDelta = [];
            }
        } else if (mode === 'pvp' && myRole === 'client') {
            const inp = collectLocalInput(dt);
            const me = gs.p2;
            if (gs.status === 'playing') {
                if (predicted && gs.countdown <= 0) {
                    predicted.dash = me.dash;
                    moveBody(predicted, inp, localAngle, dt, speedMul(me));
                    // 本地先涂（仅显示用，Host 的快照会覆盖校正）
                    if (me.frz <= 0) { paintDisc(predicted.x, predicted.y, me.big > 0 ? BIG_R : ROLLER_R, 2); paintDelta = []; }
                }
                session.send(Object.assign({ type: 'input', seq: ++inputSeq }, inp));
            }
        } else {
            collectLocalInput(dt);
        }
        if (gs.countdown <= 0 && bannerText === 'READY…') banner('🎨 开涂！', 1.0);
        if (gs.status === 'playing' && gs.countdown <= 0) {
            const sec = Math.ceil(gs.timer);
            if (sec <= 10 && sec !== lastTick) { lastTick = sec; sfx.tick(); }
            if (++scoreTick % 6 === 0) updateScores();
        }
        updateLocalFx(dt);
    }, 1000 / 60);

    // ==========================================
    // 渲染：精灵缓存
    // ==========================================
    const spriteCache = {};
    function characterSprite(kind, front, hurt) {
        const key = kind + (front ? 'F' : 'B') + (hurt ? 'H' : '');
        if (spriteCache[key]) return spriteCache[key];
        const c = document.createElement('canvas');
        c.width = 128; c.height = 160;
        const g = c.getContext('2d');
        const C = CHARS[kind];
        const body = hurt ? '#ffffff' : C.body;
        g.lineWidth = 4; g.strokeStyle = 'rgba(60,30,60,.55)';

        // 影子
        g.fillStyle = 'rgba(0,0,0,.18)';
        g.beginPath(); g.ellipse(64, 154, 40, 6, 0, 0, Math.PI * 2); g.fill();

        // 耳朵 / 天线
        g.fillStyle = body;
        if (kind === 'bunny') {
            for (const s of [-1, 1]) {
                g.save(); g.translate(64 + s * 20, 40); g.rotate(s * 0.18);
                g.beginPath(); g.ellipse(0, -14, 11, 30, 0, 0, Math.PI * 2); g.fill(); g.stroke();
                g.fillStyle = hurt ? '#ffe0ea' : '#ffd9e8';
                g.beginPath(); g.ellipse(0, -12, 5, 21, 0, 0, Math.PI * 2); g.fill();
                g.restore(); g.fillStyle = body;
            }
        } else if (kind === 'bear') {
            for (const s of [-1, 1]) {
                g.beginPath(); g.arc(64 + s * 34, 52, 15, 0, Math.PI * 2); g.fill(); g.stroke();
                g.fillStyle = C.belly; g.beginPath(); g.arc(64 + s * 34, 52, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = body;
            }
        } else {
            g.strokeStyle = '#4fae9b'; g.beginPath(); g.moveTo(64, 46); g.lineTo(64, 18); g.stroke();
            g.fillStyle = '#ff7aa8'; g.beginPath(); g.arc(64, 15, 8, 0, Math.PI * 2); g.fill();
            g.strokeStyle = 'rgba(60,30,60,.55)'; g.stroke(); g.fillStyle = body;
        }

        // 脚
        g.fillStyle = C.dark;
        g.beginPath(); g.ellipse(44, 146, 14, 8, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(84, 146, 14, 8, 0, 0, Math.PI * 2); g.fill();

        // 圆滚滚的身体（Q版大头身合一）
        g.fillStyle = body;
        g.beginPath();
        if (kind === 'bot') { roundRect(g, 18, 46, 92, 100, 30); } else { g.ellipse(64, 98, 48, 52, 0, 0, Math.PI * 2); }
        g.fill(); g.stroke();

        if (front) {
            // 肚皮
            g.fillStyle = C.belly;
            g.beginPath(); g.ellipse(64, 126, 26, 17, 0, 0, Math.PI * 2); g.fill();
            if (kind === 'bot') {
                g.fillStyle = '#2b2346';
                g.beginPath(); roundRect(g, 30, 70, 68, 34, 14); g.fill();
                g.strokeStyle = hurt ? '#ff6b8a' : '#7fffe9'; g.lineWidth = 4;
                if (hurt) {
                    for (const ex of [48, 80]) { g.beginPath(); g.moveTo(ex - 6, 81); g.lineTo(ex + 6, 93); g.moveTo(ex + 6, 81); g.lineTo(ex - 6, 93); g.stroke(); }
                } else {
                    for (const ex of [48, 80]) { g.beginPath(); g.arc(ex, 92, 8, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
                }
            } else {
                // 大眼睛
                if (hurt) {
                    g.strokeStyle = '#3a2340'; g.lineWidth = 4;
                    g.beginPath(); g.moveTo(38, 82); g.lineTo(50, 89); g.lineTo(38, 96); g.stroke();
                    g.beginPath(); g.moveTo(90, 82); g.lineTo(78, 89); g.lineTo(90, 96); g.stroke();
                } else {
                    for (const ex of [46, 82]) {
                        g.fillStyle = '#3a2340'; g.beginPath(); g.ellipse(ex, 89, 8, 10, 0, 0, Math.PI * 2); g.fill();
                        g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + 3, 85, 3.4, 0, Math.PI * 2); g.fill();
                        g.beginPath(); g.arc(ex - 2.5, 93, 1.6, 0, Math.PI * 2); g.fill();
                    }
                }
                // 腮红
                g.fillStyle = 'rgba(255,110,150,.45)';
                g.beginPath(); g.ellipse(33, 104, 8, 5, 0, 0, Math.PI * 2); g.fill();
                g.beginPath(); g.ellipse(95, 104, 8, 5, 0, 0, Math.PI * 2); g.fill();
                // 嘴
                g.strokeStyle = '#3a2340'; g.lineWidth = 3;
                g.beginPath();
                if (hurt) { g.arc(64, 108, 5, 0, Math.PI * 2); }
                else { g.arc(58, 102, 6, 0.1 * Math.PI, 0.9 * Math.PI); g.moveTo(76, 102); g.arc(70, 102, 6, 0.1 * Math.PI, 0.9 * Math.PI); }
                g.stroke();
            }
            // 小泡泡枪
            g.fillStyle = '#7fe0ff'; g.strokeStyle = 'rgba(60,30,60,.55)'; g.lineWidth = 3;
            g.beginPath(); roundRect(g, 88, 112, 30, 16, 7); g.fill(); g.stroke();
            g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.arc(100, 108, 7, 0, Math.PI * 2); g.fill(); g.stroke();
            g.fillStyle = body; g.beginPath(); g.arc(92, 122, 9, 0, Math.PI * 2); g.fill(); g.stroke();
        } else {
            // 背面：小尾巴 / 背包
            if (kind === 'bot') {
                g.fillStyle = '#7fd0c0'; g.beginPath(); roundRect(g, 40, 76, 48, 46, 12); g.fill(); g.stroke();
            } else {
                g.fillStyle = kind === 'bunny' ? '#ffffff' : C.dark;
                g.beginPath(); g.arc(64, 128, 12, 0, Math.PI * 2); g.fill(); g.stroke();
            }
        }
        spriteCache[key] = c;
        return c;
    }

    function roundRect(g, x, y, w, h, r) {
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    }

    function emojiSprite(ch) {
        const key = 'E' + ch;
        if (spriteCache[key]) return spriteCache[key];
        const c = document.createElement('canvas');
        c.width = 96; c.height = 96;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.beginPath(); g.arc(48, 48, 44, 0, Math.PI * 2); g.fill();
        g.font = '60px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(ch, 48, 52);
        spriteCache[key] = c;
        return c;
    }

    function bubbleSprite(rgb) {
        const key = 'B' + rgb.join(',');
        if (spriteCache[key]) return spriteCache[key];
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const g = c.getContext('2d');
        const grd = g.createRadialGradient(26, 24, 4, 32, 32, 30);
        grd.addColorStop(0, 'rgba(255,255,255,.95)');
        grd.addColorStop(0.35, `rgba(${rgb},.55)`);
        grd.addColorStop(1, `rgba(${rgb},.9)`);
        g.fillStyle = grd;
        g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
        g.beginPath(); g.arc(32, 32, 27, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
        spriteCache[key] = c;
        return c;
    }

    // ==========================================
    // 渲染：射线投射
    // ==========================================
    const COL_W = 2;
    let RAYS = W / COL_W;
    let zbuf = new Float32Array(RAYS);

    function setRenderSize(w, h) {
        W = Math.round(w / 2) * 2; H = h;   // RAYS 必须是整数
        const a = W / H;
        FOV_K = clamp(0.66 * a / (16 / 9), 0.45, 0.72);
        PROJ = (W / 2 / FOV_K) * 0.7425;
        RAYS = W / COL_W;
        zbuf = new Float32Array(RAYS);
    }
    setRenderSize(W, H);
    const view = GameFit.view(canvas, {
        width: W, height: H,
        adaptive: { short: 450, min: 0.62, max: 2.1 },
        onResize: info => setRenderSize(info.width, info.height)
    });
    const WALL_RGB = { 1: [184, 166, 255], 2: [255, 158, 199], 3: [143, 227, 196], 4: [255, 216, 138], 5: [143, 208, 255] };
    const FOG = [255, 232, 244];

    function shade(rgb, k, fog) {
        const r = rgb[0] * k * (1 - fog) + FOG[0] * fog;
        const g = rgb[1] * k * (1 - fog) + FOG[1] * fog;
        const b = rgb[2] * k * (1 - fog) + FOG[2] * fog;
        return `rgb(${r | 0},${g | 0},${b | 0})`;
    }

    let cam = { x: 1.5, y: 1.5, a: 0 };

    function drawSkyFloor(hz) {
        const sky = ctx.createLinearGradient(0, 0, 0, hz);
        sky.addColorStop(0, '#8fd3ff'); sky.addColorStop(1, '#ffe3f1');
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hz);
        // 随视角平移的云朵
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        for (let i = 0; i < 6; i++) {
            const ang = i * (Math.PI / 3) + 0.4;
            let rel = wrapAngle(ang - cam.a);
            const x = W / 2 + (rel / (Math.atan(FOV_K) * 2)) * W;
            if (x < -100 || x > W + 100) continue;
            const y = hz * (0.25 + (i % 3) * 0.17);
            ctx.beginPath();
            ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.arc(x + 20, y - 8, 22, 0, Math.PI * 2); ctx.arc(x + 42, y, 16, 0, Math.PI * 2);
            ctx.fill();
        }
        drawFloor(hz);
    }

    // 地板投射（floor casting）：半分辨率逐像素算出地板对应的世界坐标，查涂色网格上色
    const floorCv = document.createElement('canvas');
    const fctx = floorCv.getContext('2d');
    let floorImg = null;
    const COOKIE_A = [255, 233, 216], COOKIE_B = [246, 214, 192];
    function drawFloor(hz) {
        const top = Math.max(0, Math.floor(hz));
        const fw = Math.max(1, Math.round(W / 2)), fh = Math.max(1, Math.ceil((H - top) / 2));
        if (!floorImg || floorCv.width !== fw || floorCv.height !== fh) {
            floorCv.width = fw; floorCv.height = fh;
            floorImg = fctx.createImageData(fw, fh);
        }
        const d = floorImg.data, grid = gs.grid;
        const dirX = Math.cos(cam.a), dirY = Math.sin(cam.a);
        const planeX = -dirY * FOV_K, planeY = dirX * FOV_K;
        const r0x = dirX - planeX, r0y = dirY - planeY;
        const spanX = 2 * planeX / fw, spanY = 2 * planeY / fw;
        let o = 0;
        for (let r = 0; r < fh; r++) {
            const py = top + (r + 0.5) * 2 - hz;
            const dist = py > 0.5 ? (PROJ / 2) / py : 60;
            const fog = Math.min(0.75, dist / 16), keep = 1 - fog;
            const fr = FOG[0] * fog, fg = FOG[1] * fog, fb = FOG[2] * fog;
            let wx = cam.x + dist * (r0x + spanX * 0.5), wy = cam.y + dist * (r0y + spanY * 0.5);
            const sx = dist * spanX, sy = dist * spanY;
            for (let c = 0; c < fw; c++, wx += sx, wy += sy, o += 4) {
                const gx = Math.floor(wx * PG), gy = Math.floor(wy * PG);
                let R, G, B;
                const own = (gx >= 0 && gy >= 0 && gx < GW && gy < GH) ? grid[gy * GW + gx] : 0;
                if (own) {
                    const col = PAINT_RGB[own];
                    const k = ((gx * 7 + gy * 13) % 3) * 0.04 + 0.92;   // 颜料的深浅斑驳
                    R = col[0] * k; G = col[1] * k; B = col[2] * k;
                } else {
                    const col = ((Math.floor(wx) + Math.floor(wy)) & 1) ? COOKIE_A : COOKIE_B;
                    R = col[0]; G = col[1]; B = col[2];
                }
                const fx = wx - Math.floor(wx), fy = wy - Math.floor(wy);
                if (fx < 0.03 || fy < 0.03) { R *= 0.85; G *= 0.85; B *= 0.85; }   // 饼干格缝
                d[o] = R * keep + fr; d[o + 1] = G * keep + fg; d[o + 2] = B * keep + fb; d[o + 3] = 255;
            }
        }
        fctx.putImageData(floorImg, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(floorCv, 0, top, W, fh * 2);
        ctx.imageSmoothingEnabled = true;
    }

    function drawWalls(hz) {
        const dirX = Math.cos(cam.a), dirY = Math.sin(cam.a);
        const planeX = -dirY * FOV_K, planeY = dirX * FOV_K;
        for (let i = 0; i < RAYS; i++) {
            const camX = 2 * (i + 0.5) / RAYS - 1;
            const rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
            let mapX = Math.floor(cam.x), mapY = Math.floor(cam.y);
            const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
            const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
            let stepX, stepY, sdx, sdy;
            if (rdx < 0) { stepX = -1; sdx = (cam.x - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - cam.x) * ddx; }
            if (rdy < 0) { stepY = -1; sdy = (cam.y - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - cam.y) * ddy; }
            let side = 0, tile = 0;
            for (let guard = 0; guard < 64; guard++) {
                if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; } else { sdy += ddy; mapY += stepY; side = 1; }
                tile = tileAt(mapX, mapY);
                if (tile > 0) break;
            }
            const perp = Math.max(0.05, side === 0 ? sdx - ddx : sdy - ddy);
            zbuf[i] = perp;
            let wallX = side === 0 ? cam.y + perp * rdy : cam.x + perp * rdx;
            wallX -= Math.floor(wallX);
            const lineH = PROJ / perp;
            const top = hz - lineH / 2;
            const rgb = WALL_RGB[tile] || WALL_RGB[1];
            const fog = Math.min(0.75, perp / 16);
            let k = side ? 0.84 : 1;
            if (Math.floor(wallX * 4) % 2 === 1) k *= 0.93;           // 糖果竖条纹
            if (wallX < 0.04 || wallX > 0.96) k *= 0.72;              // 卡通描边
            const x = i * COL_W;
            ctx.fillStyle = shade(rgb, k, fog);
            ctx.fillRect(x, top, COL_W, lineH);
            ctx.fillStyle = shade(rgb, Math.min(1.25, k * 1.18), fog);   // 顶部奶油边
            ctx.fillRect(x, top, COL_W, lineH * 0.09);
            ctx.fillStyle = shade(rgb, k * 0.7, fog);                     // 踢脚线
            ctx.fillRect(x, top + lineH * 0.88, COL_W, lineH * 0.12);
        }
    }

    function project(wx, wy) {
        const dirX = Math.cos(cam.a), dirY = Math.sin(cam.a);
        const planeX = -dirY * FOV_K, planeY = dirX * FOV_K;
        const dx = wx - cam.x, dy = wy - cam.y;
        const inv = 1 / (planeX * dirY - dirX * planeY);
        const tx = inv * (dirY * dx - dirX * dy);
        const ty = inv * (-planeY * dx + planeX * dy);
        if (ty < 0.12) return null;
        return { sx: (W / 2) * (1 + tx / ty), depth: ty, unit: PROJ / ty };
    }

    // 按列做 z-buffer 裁剪的精灵绘制
    function drawClipped(img, left, top, w, h, depth, alpha) {
        const i0 = Math.max(0, Math.floor(left / COL_W));
        const i1 = Math.min(RAYS - 1, Math.floor((left + w) / COL_W));
        if (i1 < i0) return;
        ctx.globalAlpha = alpha == null ? 1 : alpha;
        let runStart = -1;
        for (let i = i0; i <= i1 + 1; i++) {
            const vis = i <= i1 && depth < zbuf[i];
            if (vis && runStart < 0) runStart = i;
            if (!vis && runStart >= 0) {
                const x0 = Math.max(left, runStart * COL_W);
                const x1 = Math.min(left + w, i * COL_W);
                if (x1 > x0) {
                    ctx.drawImage(img, (x0 - left) / w * img.width, 0, (x1 - x0) / w * img.width, img.height, x0, top, x1 - x0, h);
                }
                runStart = -1;
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawSprites(hz, foeView) {
        const list = [];
        const fk = foeKey();
        const foe = gs[fk];
        if (gs.status !== 'lobby') {
            const pr = project(foeView.x, foeView.y);
            if (pr) list.push({ pr, kind: 'player', foe, view: foeView });
        }
        for (const k of gs.pickups) {
            const pr = project(k.x, k.y);
            if (pr) list.push({ pr, kind: 'pickup', k });
        }
        for (const p of particles) {
            const pr = project(p.x, p.y);
            if (pr) list.push({ pr, kind: 'particle', p });
        }
        list.sort((a, b) => b.pr.depth - a.pr.depth);
        const now = performance.now() / 1000;
        for (const s of list) {
            const { sx, depth, unit } = s.pr;
            const floorY = hz + unit / 2;
            if (s.kind === 'player') {
                const f = s.foe;
                const toCamX = cam.x - s.view.x, toCamY = cam.y - s.view.y;
                const front = Math.cos(s.view.a) * toCamX + Math.sin(s.view.a) * toCamY > 0;
                const img = characterSprite(kindOf(fk), front, f.hurt > 0.12);
                const h = unit * 0.66, w = h * 0.8;
                const bob = f.moving ? Math.abs(Math.sin(f.walk)) * unit * 0.03 : 0;
                const blink = (f.frz > 0 || f.imm > 0) && Math.floor(now * 8) % 2 === 0;
                drawClipped(img, sx - w / 2, floorY - h - bob, w, h, depth, blink ? 0.55 : 1);
                // 头顶：被撞晕时 💫
                const ci = Math.floor(clamp(sx / COL_W, 0, RAYS - 1));
                if (depth < zbuf[ci]) {
                    const sz = clamp(unit * 0.22, 18, 70);
                    const fl = Math.sin(now * 4) * sz * 0.08;
                    if (f.frz > 0) ctx.drawImage(emojiSprite('💫'), sx - sz / 2, floorY - h - bob - sz * 1.05 + fl, sz, sz);
                    // 身前的滚筒（对手颜色）
                    const rc = PAINT_RGB[f.id], rw = w * (f.big > 0 ? 1.25 : 0.9), rh = h * 0.13;
                    ctx.fillStyle = `rgb(${rc})`; ctx.strokeStyle = 'rgba(60,30,60,.55)'; ctx.lineWidth = 2;
                    ctx.beginPath(); roundRect(ctx, sx - rw / 2, floorY - rh - 2, rw, rh, rh / 2); ctx.fill(); ctx.stroke();
                    if (f.dash > 0) {
                        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 3;
                        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(sx - w * 0.7, floorY - h * (0.5 + i * 0.15)); ctx.lineTo(sx - w * 0.95, floorY - h * (0.5 + i * 0.15)); ctx.stroke(); }
                    }
                }
            } else if (s.kind === 'pickup') {
                const size = unit * 0.38;
                const float = Math.sin(now * 3 + s.k.x) * unit * 0.04;
                drawClipped(emojiSprite(s.k.type === 'big' ? '🎨' : '⚡'), sx - size / 2, floorY - size - unit * 0.08 + float, size, size, depth);
            } else {
                const ci = Math.floor(clamp(sx / COL_W, 0, RAYS - 1));
                if (depth >= zbuf[ci]) continue;
                const size = unit * 0.07 * (s.p.t / 0.45 + 0.3);
                ctx.fillStyle = `rgba(${s.p.c},${Math.min(1, s.p.t * 2.5)})`;
                ctx.beginPath(); ctx.arc(sx, hz + unit * (0.5 - s.p.z) * 0.5, size, 0, Math.PI * 2); ctx.fill();
            }
        }
    }

    // 第一人称：两只小爪子握着滚筒杆，滚筒在画面下方滚动
    function drawWeapon(me, moving) {
        const now = performance.now() / 1000;
        const bobX = moving ? Math.sin(now * (me.dash > 0 ? 16 : 9)) * 6 : 0;
        const bobY = moving ? Math.abs(Math.cos(now * 9)) * 6 : Math.sin(now * 2) * 2;
        const push = recoilT > 0 ? recoilT / 0.2 : 0;
        const col = PAINT_RGB[myId()];
        const C = charOf(meKey());
        const rw = W * (me.big > 0 ? 0.72 : 0.5), rh = Math.min(70, H * 0.12);
        const rx = W / 2 - rw / 2 + bobX, ry = H - rh * 0.9 + bobY - push * 20;
        ctx.save();
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(60,30,60,.6)';
        // 杆
        ctx.fillStyle = '#c9a27a';
        for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(W / 2 + sd * W * 0.17, H + 10); ctx.lineTo(W / 2 + sd * rw * 0.18 + bobX, ry + rh * 0.4); ctx.lineTo(W / 2 + sd * rw * 0.18 + bobX + sd * 8, ry + rh * 0.4); ctx.lineTo(W / 2 + sd * W * 0.17 + sd * 14, H + 10); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        // 滚筒
        ctx.fillStyle = `rgb(${col})`;
        ctx.beginPath(); roundRect(ctx, rx, ry, rw, rh, rh / 2); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.beginPath(); roundRect(ctx, rx, ry, rw, rh, rh / 2); ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        const roll = (me.walk * 18) % 28;
        for (let x = rx - 28 + roll; x < rx + rw; x += 28) ctx.fillRect(x, ry, 10, rh);
        ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(rx, ry + rh * 0.12, rw, rh * 0.12);
        ctx.restore();
        // 爪子
        ctx.fillStyle = C.body;
        for (const sd of [-1, 1]) {
            ctx.beginPath(); ctx.ellipse(W / 2 + sd * W * 0.17 + bobX * 0.5, H - 18 + bobY * sd * 0.5, 34, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
        for (const m of muzzle) {
            ctx.globalAlpha = Math.min(1, m.t * 2);
            ctx.fillStyle = `rgba(${col},.9)`;
            ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawHud(me, hz) {
        // 准星
        const cx = W / 2, cy = hz;
        ctx.strokeStyle = autoAimOn ? '#ff6fa8' : 'rgba(255,255,255,.95)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, autoAimOn ? 11 : 7, 0, Math.PI * 2); ctx.stroke();
        if (strafeLock) {
            // 单手锁定提示：准星两侧金色箭头 = 摇杆左右现在是平移
            ctx.fillStyle = '#ffd36e';
            for (const s of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(cx + s * 30, cy); ctx.lineTo(cx + s * 20, cy - 7); ctx.lineTo(cx + s * 20, cy + 7);
                ctx.closePath(); ctx.fill();
            }
        }
        if (stick.src === 'canvas') {
            // 浮动摇杆：把 CSS 坐标换算到画布坐标
            const r = canvas.getBoundingClientRect(), k = W / r.width;
            const v = stickVec();
            const ox = (stick.ox - r.left) * k, oy = (stick.oy - r.top) * k, R = STICK_R * k;
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = 'rgba(40,20,60,.6)'; ctx.beginPath(); ctx.arc(ox, oy, R, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = '#ff8fc0'; ctx.beginPath(); ctx.arc(ox + v.x * R, oy + v.y * R, R * 0.42, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#ff6fa8'; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
        if (hitMarkT > 0) {
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
            for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                ctx.beginPath(); ctx.moveTo(cx + sx * 10, cy + sy * 10); ctx.lineTo(cx + sx * 17, cy + sy * 17); ctx.stroke();
            }
        }

        // 冲刺冷却 / 加速
        // 放在第一人称滚筒上方，不挡滚筒
        const hb = H - 34 - Math.min(70, H * 0.12) - 22;
        ctx.fillStyle = 'rgba(40,20,60,.55)';
        ctx.beginPath(); roundRect(ctx, 16, hb - 17, 190, 34, 17); ctx.fill();
        ctx.font = '600 16px Fredoka, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const maxCd = DASH_CD;
        const ready = me.cd <= 0;
        ctx.fillStyle = '#fff'; ctx.fillText('💨', 26, hb);
        ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(54, hb - 7, 110, 14);
        ctx.fillStyle = ready ? '#7af0a8' : '#9fb6ff'; ctx.fillRect(54, hb - 7, 110 * (1 - Math.min(1, me.cd / maxCd)), 14);
        ctx.fillStyle = '#fff'; ctx.fillText(ready ? 'GO' : me.cd.toFixed(1), 170, hb);
        let by = hb - 33;
        if (me.boost > 0) { ctx.fillStyle = '#ffd36b'; ctx.fillText(`⚡ ${me.boost.toFixed(1)}s`, 20, by); by -= 22; }
        if (me.big > 0) { ctx.fillStyle = '#ffd36b'; ctx.fillText(`🎨 ${me.big.toFixed(1)}s`, 20, by); }

        // 倒计时
        const mk = meKey();
        const c1 = charOf('p1'), c2 = charOf('p2');
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(40,20,60,.55)';
        ctx.beginPath(); roundRect(ctx, W / 2 - 46, 10, 92, 36, 18); ctx.fill();
        ctx.font = '700 20px Fredoka, sans-serif';
        ctx.fillStyle = gs.timer <= 10 ? '#ffd36b' : '#fff';
        const tsec = Math.ceil(gs.timer);
        ctx.fillText(`${Math.floor(tsec / 60)}:${String(tsec % 60).padStart(2, '0')}`, W / 2, 29);
        // 地盘条：左粉右蓝，中间是未涂
        const bw = Math.min(300, W - 40), bx = W / 2 - bw / 2, byy = W < 640 ? 122 : 50;   // 竖屏时让开右上角小地图
        const f1 = gs.p1.cells / PAINTABLE, f2 = gs.p2.cells / PAINTABLE;
        ctx.fillStyle = 'rgba(40,20,60,.45)'; ctx.beginPath(); roundRect(ctx, bx - 3, byy - 3, bw + 6, 20, 10); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(bx, byy, bw, 14);
        ctx.fillStyle = `rgb(${PAINT_RGB[1]})`; ctx.fillRect(bx, byy, bw * f1, 14);
        ctx.fillStyle = `rgb(${PAINT_RGB[2]})`; ctx.fillRect(bx + bw * (1 - f2), byy, bw * f2, 14);
        ctx.font = '700 12px Fredoka, sans-serif'; ctx.fillStyle = '#fff';
        ctx.textAlign = 'left'; ctx.fillText(`${c1.emoji} ${pct(gs.p1.cells)}%`, bx + 4, byy + 7);
        ctx.textAlign = 'right'; ctx.fillText(`${pct(gs.p2.cells)}% ${c2.emoji}`, bx + bw - 4, byy + 7);
        ctx.textAlign = 'center';
        ctx.font = '600 12px Fredoka, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.9)';
        const under = paintAt(cam.x, cam.y);
        ctx.fillText(under === myId() ? '🏃 自己的颜色上跑得更快' : (under ? '🐢 对方颜色会变慢，涂回来！' : `🎨 你是 ${charOf(mk).emoji} · 涂得多的赢`), W / 2, byy + 30);

        // 对手方向指示（看不见对手时，准星旁的小箭头指向 TA）
        const foeP = gs[foeKey()];
        const fd = wrapAngle(Math.atan2(foeP.y - cam.y, foeP.x - cam.x) - cam.a);
        if (Math.abs(fd) > Math.atan(FOV_K) * 0.9 || !hasLOS(cam.x, cam.y, foeP.x, foeP.y)) {
            const ax = cx + Math.sin(fd) * 46, ay = cy - Math.cos(fd) * 46;
            ctx.save(); ctx.translate(ax, ay); ctx.rotate(fd);
            ctx.fillStyle = `rgb(${PAINT_RGB[foeP.id]})`;
            ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 5); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill();
            ctx.restore();
        }

        // 击杀播报
        ctx.textAlign = 'right'; ctx.font = '600 14px Fredoka, sans-serif';
        feed.forEach((f, i) => {
            ctx.globalAlpha = Math.min(1, f.t);
            ctx.fillStyle = 'rgba(40,20,60,.55)';
            const tw = ctx.measureText(f.text).width + 16;
            ctx.fillRect(W - tw - 12, 118 + i * 24, tw, 21);
            ctx.fillStyle = '#fff'; ctx.fillText(f.text, W - 20, 129 + i * 24);
        });
        ctx.globalAlpha = 1;

        // 小地图
        const ms = 6, mx0 = W - MAP_W * ms - 12, my0 = 12;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(40,20,60,.5)'; ctx.fillRect(mx0 - 3, my0 - 3, MAP_W * ms + 6, MAP_H * ms + 6);
        for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
            const t = MAP[y][x];
            if (t) { const c = WALL_RGB[t]; ctx.fillStyle = `rgb(${c})`; ctx.fillRect(mx0 + x * ms, my0 + y * ms, ms, ms); }
        }
        // 小地图上的涂色
        const cs = ms / PG;
        for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
            const o = gs.grid[gy * GW + gx];
            if (!o) continue;
            ctx.fillStyle = o === 1 ? 'rgba(255,128,182,.9)' : 'rgba(92,200,255,.9)';
            ctx.fillRect(mx0 + gx * cs, my0 + gy * cs, cs, cs);
        }
        for (const k of gs.pickups) { ctx.fillStyle = '#ffd36b'; ctx.fillRect(mx0 + k.x * ms - 2, my0 + k.y * ms - 2, 4, 4); }
        const foe = gs[foeKey()];
        if (gs.status !== 'lobby') {
            ctx.fillStyle = '#3a2340';
            ctx.beginPath(); ctx.arc(mx0 + foe.x * ms, my0 + foe.y * ms, 3.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(mx0 + cam.x * ms, my0 + cam.y * ms, 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(mx0 + cam.x * ms, my0 + cam.y * ms);
        ctx.lineTo(mx0 + (cam.x + Math.cos(cam.a) * 1.6) * ms, my0 + (cam.y + Math.sin(cam.a) * 1.6) * ms); ctx.stroke();
        ctx.globalAlpha = 1;

        // 受伤粉色晕影
        if (hurtFlashT > 0) {
            const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.65);
            g.addColorStop(0, 'rgba(255,90,140,0)');
            g.addColorStop(1, `rgba(255,90,140,${Math.min(0.55, hurtFlashT)})`);
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }

        // 倒计时 / 横幅
        ctx.textAlign = 'center';
        if (gs.status === 'playing' && gs.countdown > 0) {
            drawBigText(String(Math.ceil(gs.countdown / (COUNTDOWN / 3))), '#ffffff');
        } else if (bannerT > 0 && bannerText !== 'READY…') {
            ctx.globalAlpha = Math.min(1, bannerT * 2);
            drawBigText(bannerText, '#ffe36b', 34);
            ctx.globalAlpha = 1;
        }

        // 被撞晕
        if (me.frz > 0 && gs.status === 'playing') {
            ctx.fillStyle = 'rgba(120,90,160,.35)'; ctx.fillRect(0, 0, W, H);
            drawBigText('💫 被撞晕了…', '#ffffff', 32, -20);
            ctx.font = '600 18px Fredoka, sans-serif'; ctx.fillStyle = '#fff';
            ctx.fillText(`${me.frz.toFixed(1)} 秒`, W / 2, H / 2 + 28);
        }

        if (gs.status === 'playing' && mode !== 'idle' && !locked() && !('ontouchstart' in window)) {
            ctx.font = '500 13px Fredoka, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
            ctx.fillText('点击画面锁定鼠标视角 · 右键前进 · 左键/空格 冲刺 · Esc 释放', W / 2, H - 14);
        }
    }

    function drawBigText(text, color, size, dy) {
        ctx.font = `700 ${size || 64}px Fredoka, sans-serif`;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(80,40,100,.6)';
        ctx.strokeText(text, W / 2, H / 2 - 40 + (dy || 0));
        ctx.fillStyle = color;
        ctx.fillText(text, W / 2, H / 2 - 40 + (dy || 0));
    }

    let lobbySpin = 0;
    function render() {
        view.begin(ctx);
        const mk = meKey();
        const me = gs[mk];
        const foe = gs[foeKey()];

        if (gs.status === 'lobby' || mode === 'idle') {
            // 大厅背景：镜头在场地中缓慢环视
            lobbySpin += 0.003;
            cam = { x: 8, y: 6.5, a: lobbySpin };
        } else if (mode === 'pvp' && myRole === 'client') {
            const pos = predicted || me;
            cam = { x: pos.x, y: pos.y, a: localAngle };
        } else {
            cam = { x: me.x, y: me.y, a: localAngle };
        }

        // 对手渲染平滑（client 收到的是 60Hz 快照）
        if (!smooth.init || Math.hypot(smooth.x - foe.x, smooth.y - foe.y) > 1.5) {
            smooth.x = foe.x; smooth.y = foe.y; smooth.a = foe.a; smooth.init = true;
        } else {
            smooth.x += (foe.x - smooth.x) * 0.45;
            smooth.y += (foe.y - smooth.y) * 0.45;
            smooth.a += wrapAngle(foe.a - smooth.a) * 0.45;
        }

        const moving = (!!(keys.f || keys.b || keys.l || keys.r || mouseFwd || (stick.id !== null && Math.abs(stickVec().y) > 0.32)) || me.dash > 0) && gs.status === 'playing' && me.frz <= 0;
        const hz = H / 2 + (moving ? Math.sin(performance.now() / 1000 * 9 * 2) * 2.5 : 0);

        drawSkyFloor(hz);
        drawWalls(hz);
        drawSprites(hz, smooth);
        if (gs.status === 'playing' && mode !== 'idle') {
            drawWeapon(me, moving);
            drawHud(me, hz);
        }
        requestAnimationFrame(render);
    }

    // ==========================================
    // 启动
    // ==========================================
    showScreen('lobby');
    updateLabels();
    requestAnimationFrame(render);

    const botParam = params.get('bot');
    if (botParam !== null) startBot(botParam || 'normal');

    // 供 E2E 测试读取的只读调试句柄
    window.__paint = {
        get mode() { return mode; },
        get role() { return myRole; },
        get state() { return JSON.parse(JSON.stringify({ status: gs.status, p1: gs.p1, p2: gs.p2, timer: gs.timer, countdown: gs.countdown, winner: gs.winner, total: PAINTABLE, painted: gs.grid.reduce((n, v) => n + (v ? 1 : 0), 0) })); },
        cellAt: (x, y) => paintAt(x, y),
        get strafeLock() { return strafeLock; }
    };
    // 仅 ?e2e 时开放：冻结程序对手并摆放位置，用于确定性地测试单手锁定平移
    if (params.has('e2e')) {
        window.__paint.freezeBot = on => { e2eFreezeBot = !!on; };
        window.__paint.setTimer = t => { gs.timer = t; };
        window.__paint.place = (key, x, y, a) => {
            const p = gs[key]; p.x = x; p.y = y; p.a = a; p.vx = p.vy = 0;
            if (key === meKey()) { localAngle = a; cam.x = x; cam.y = y; cam.a = a; }
        };
    }
});
