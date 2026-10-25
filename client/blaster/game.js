/**
 * Link Blaster — Q版第一人称泡泡枪对战（WebRTC 联机 / 人机对战）
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
    const BUBBLE_SPEED = 8.5, BUBBLE_R = 0.13, BUBBLE_LIFE = 2.2;
    const FIRE_CD = 0.32, RAPID_CD = 0.15, RAPID_TIME = 6;
    const DAMAGE = 20, MAX_HP = 100, HEAL = 40;
    const RESPAWN_TIME = 2.2, SPAWN_INVULN = 1.5;
    const WIN_FRAGS = 5;
    const COUNTDOWN = 2.4;
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
        return {
            id, x: spawn[0], y: spawn[1], a, vx: 0, vy: 0,
            hp: MAX_HP, frags: 0, dead: 0, inv: SPAWN_INVULN, rapid: 0,
            cd: 0, hurt: 0, walk: 0, moving: 0
        };
    }

    function createInitialState() {
        return {
            p1: createPlayer(1, SPAWNS[0], Math.PI / 4),
            p2: createPlayer(2, SPAWNS[1], -3 * Math.PI / 4),
            bubbles: [],
            pickups: [],
            pickupTimer: 4,
            countdown: COUNTDOWN,
            status: 'lobby',     // 'lobby' | 'playing' | 'gameover'
            winner: 0,
            seq: 0
        };
    }

    let gs = createInitialState();
    let bubbleSeq = 0;

    const meKey = () => (mode === 'pvp' && myRole === 'client') ? 'p2' : 'p1';
    const foeKey = () => (meKey() === 'p1' ? 'p2' : 'p1');
    const charOf = key => key === 'p1' ? CHARS.bunny : (mode === 'bot' ? CHARS.bot : CHARS.bear);
    const kindOf = key => key === 'p1' ? 'bunny' : (mode === 'bot' ? 'bot' : 'bear');

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
        try { saved = JSON.parse(localStorage.getItem('blaster-ctrl') || '{}') || {}; } catch (_) { /* ignore */ }
        return {
            oneHand: typeof saved.oneHand === 'boolean' ? saved.oneHand : coarse,
            hand: saved.hand === 'left' ? 'left' : 'right',
            autoFire: typeof saved.autoFire === 'boolean' ? saved.autoFire : coarse
        };
    })();
    const touchControls = document.querySelector('.touch-controls');
    const modeBtn = $('ctrl-mode-btn'), handBtn = $('ctrl-hand-btn');
    const autoBtn = $('ctrl-auto-btn'), autoChk = $('autofire-chk');
    function applyCtrl() {
        try { localStorage.setItem('blaster-ctrl', JSON.stringify(ctrl)); } catch (_) { /* ignore */ }
        if (touchControls) {
            touchControls.classList.toggle('one-hand', ctrl.oneHand);
            touchControls.classList.toggle('left-hand', ctrl.hand === 'left');
        }
        if (modeBtn) modeBtn.textContent = ctrl.oneHand ? '🖐 单手' : '🙌 双手';
        if (handBtn) handBtn.textContent = ctrl.hand === 'left' ? '👈 左手' : '👉 右手';
        if (autoBtn) { autoBtn.textContent = ctrl.autoFire ? '🎯 自动开火：开' : '🎯 自动开火：关'; autoBtn.classList.toggle('on', ctrl.autoFire); }
        if (autoChk) autoChk.checked = ctrl.autoFire;
    }
    const tapBtn = (el, fn) => el && el.addEventListener('click', e => { e.preventDefault(); fn(); applyCtrl(); });
    tapBtn(modeBtn, () => { ctrl.oneHand = !ctrl.oneHand; if (ctrl.oneHand) ctrl.autoFire = true; });
    tapBtn(handBtn, () => { ctrl.hand = ctrl.hand === 'left' ? 'right' : 'left'; });
    tapBtn(autoBtn, () => { ctrl.autoFire = !ctrl.autoFire; });
    if (autoChk) autoChk.addEventListener('change', () => { ctrl.autoFire = autoChk.checked; applyCtrl(); });
    window.addEventListener('keydown', e => {
        if (e.key.toLowerCase() === 'f' && !e.repeat && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) {
            ctrl.autoFire = !ctrl.autoFire; applyCtrl();
            banner(ctrl.autoFire ? '🎯 自动开火 ON' : '🎯 自动开火 OFF', 0.9);
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
        if (tap && playing()) tapFireT = 0.12;   // 轻点 = 开一枪
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
        if (me.dead > 0 || foe.dead > 0) return null;
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
        autoAimOn = Math.abs(d) < tol * 1.4;
        return autoAimOn && foe.inv <= 0;
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
    function moveBody(body, inp, a, dt) {
        const fwd = (inp.f ? 1 : 0) - (inp.b ? 1 : 0);
        const side = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
        let mx = Math.cos(a) * fwd * MOVE_SPEED - Math.sin(a) * side * STRAFE_SPEED;
        let my = Math.sin(a) * fwd * MOVE_SPEED + Math.cos(a) * side * STRAFE_SPEED;
        if (fwd && side) { mx *= 0.75; my *= 0.75; }
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

    function pickSpawn(other) {
        let best = SPAWNS[0], bestD = -1;
        for (const s of SPAWNS) {
            const d = other.dead > 0 ? Math.random() : Math.hypot(s[0] - other.x, s[1] - other.y) + Math.random() * 2;
            if (d > bestD) { bestD = d; best = s; }
        }
        return best;
    }

    function stepPlayer(p, other, inp, dt) {
        p.hurt = Math.max(0, p.hurt - dt);
        if (p.dead > 0) {
            p.dead -= dt;
            if (p.dead <= 0) {
                const s = pickSpawn(other);
                p.x = s[0]; p.y = s[1]; p.dead = 0; p.hp = MAX_HP; p.inv = SPAWN_INVULN; p.rapid = 0;
                p.a = Math.atan2(8 - p.y, 8 - p.x);
                emit({ k: 'spawn', who: p.id, a: r3(p.a) });
            }
            p.vx = p.vy = 0; p.moving = 0;
            return;
        }
        p.inv = Math.max(0, p.inv - dt);
        p.rapid = Math.max(0, p.rapid - dt);
        p.cd = Math.max(0, p.cd - dt);
        if (typeof inp.a === 'number' && isFinite(inp.a)) p.a = wrapAngle(inp.a);

        const frozen = gs.countdown > 0;
        const ox = p.x, oy = p.y;
        const speed = frozen ? 0 : moveBody(p, inp, p.a, dt);
        p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt;
        p.moving = speed > 0.2 ? 1 : 0;
        if (p.moving) p.walk += dt * 9;

        if (!frozen && inp.fire && p.cd <= 0) {
            p.cd = p.rapid > 0 ? RAPID_CD : FIRE_CD;
            const spread = p.rapid > 0 ? (Math.random() - 0.5) * 0.06 : 0;
            const a = p.a + spread;
            gs.bubbles.push({
                id: ++bubbleSeq, o: p.id,
                x: p.x + Math.cos(a) * 0.3, y: p.y + Math.sin(a) * 0.3,
                dx: Math.cos(a), dy: Math.sin(a), t: BUBBLE_LIFE
            });
            emit({ k: 'shot', who: p.id });
        }
    }

    function damage(target, attacker) {
        if (target.dead > 0 || target.inv > 0) return;
        target.hp -= DAMAGE;
        target.hurt = 0.25;
        if (target.hp <= 0) {
            target.hp = 0;
            target.dead = RESPAWN_TIME;
            attacker.frags++;
            emit({ k: 'ko', by: attacker.id, to: target.id });
            if (attacker.frags >= WIN_FRAGS) {
                gs.status = 'gameover';
                gs.winner = attacker.id;
            }
        } else {
            emit({ k: 'hit', by: attacker.id, to: target.id });
        }
    }

    function stepWorld(inp1, inp2, dt) {
        if (gs.status !== 'playing') return;
        if (gs.countdown > 0) gs.countdown = Math.max(0, gs.countdown - dt);
        const { p1, p2 } = gs;
        stepPlayer(p1, p2, inp1, dt);
        stepPlayer(p2, p1, inp2, dt);

        // 泡泡飞行与命中
        const survivors = [];
        for (const b of gs.bubbles) {
            b.t -= dt;
            const sub = 3;
            let alive = b.t > 0;
            for (let s = 0; s < sub && alive; s++) {
                b.x += b.dx * BUBBLE_SPEED * dt / sub;
                b.y += b.dy * BUBBLE_SPEED * dt / sub;
                if (solid(b.x, b.y)) {
                    alive = false;
                    emit({ k: 'pop', x: r3(b.x - b.dx * 0.12), y: r3(b.y - b.dy * 0.12), o: b.o });
                    break;
                }
                const target = b.o === 1 ? p2 : p1;
                const shooter = b.o === 1 ? p1 : p2;
                if (target.dead <= 0 && Math.hypot(target.x - b.x, target.y - b.y) < HIT_R + BUBBLE_R) {
                    alive = false;
                    emit({ k: 'pop', x: r3(b.x), y: r3(b.y), o: b.o });
                    damage(target, shooter);
                }
            }
            if (alive) survivors.push(b);
        }
        gs.bubbles = survivors;

        // 道具刷新与拾取
        gs.pickupTimer -= dt;
        if (gs.pickupTimer <= 0) {
            gs.pickupTimer = 7 + Math.random() * 4;
            if (gs.pickups.length < 2) {
                const free = PICKUP_SPOTS.filter(([x, y]) =>
                    !gs.pickups.some(k => k.x === x && k.y === y) &&
                    Math.hypot(p1.x - x, p1.y - y) > 2 && Math.hypot(p2.x - x, p2.y - y) > 2);
                if (free.length) {
                    const [x, y] = free[Math.floor(Math.random() * free.length)];
                    gs.pickups.push({ x, y, type: Math.random() < 0.6 ? 'heal' : 'rapid' });
                }
            }
        }
        gs.pickups = gs.pickups.filter(k => {
            for (const p of [p1, p2]) {
                if (p.dead > 0 || Math.hypot(p.x - k.x, p.y - k.y) > 0.55) continue;
                if (k.type === 'heal' && p.hp >= MAX_HP) continue;
                if (k.type === 'heal') p.hp = Math.min(MAX_HP, p.hp + HEAL);
                else p.rapid = RAPID_TIME;
                emit({ k: 'pick', who: p.id, type: k.type });
                return false;
            }
            return true;
        });

        if (gs.status === 'gameover') {
            gs.bubbles = [];
        }
    }

    // ==========================================
    // 人机 AI
    // ==========================================
    const BOT_LEVELS = {
        easy:   { turn: 2.3, noise: 0.17, react: 0.8, cone: 0.11, keep: 4.5, strafe: 0.35, lead: 0,   fireRate: 0.55, track: 0.5 },
        normal: { turn: 3.6, noise: 0.08, react: 0.42, cone: 0.08, keep: 4.0, strafe: 0.75, lead: 0.5, fireRate: 0.85, track: 0.85 },
        hard:   { turn: 5.6, noise: 0.035, react: 0.18, cone: 0.06, keep: 3.4, strafe: 1.0, lead: 1.0, fireRate: 1.0, track: 1 }
    };
    let brain = null;
    function resetBrain() {
        brain = {
            seen: 0, noise: 0, noiseT: 0, strafeDir: 1, strafeT: 0,
            path: [], pathT: 0, goalKey: '', lastKnown: null,
            stuckT: 0, lastX: 0, lastY: 0, unstickT: 0, unstickDir: 1,
            wander: null, fireGate: 1, fireGateT: 0
        };
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
        if (me.dead > 0 || gs.status !== 'playing') { brain.seen = 0; brain.path = []; return inp; }

        const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
        const sees = foe.dead <= 0 && hasLOS(me.x, me.y, foe.x, foe.y);

        // 低血量时优先去拿草莓
        let pickGoal = null;
        if (me.hp <= 50) {
            let bd = 1e9;
            for (const k of gs.pickups) {
                if (k.type !== 'heal') continue;
                const d = Math.hypot(k.x - me.x, k.y - me.y);
                if (d < bd) { bd = d; pickGoal = k; }
            }
        } else {
            for (const k of gs.pickups) {
                if (k.type === 'rapid' && Math.hypot(k.x - me.x, k.y - me.y) < 4) pickGoal = k;
            }
        }

        const followPath = (gx, gy, key, turnMul) => {
            brain.pathT -= dt;
            if (brain.pathT <= 0 || brain.goalKey !== key || !brain.path.length) {
                brain.path = bfsPath(me.x, me.y, gx, gy);
                brain.pathT = 0.4;
                brain.goalKey = key;
            }
            while (brain.path.length && Math.hypot(brain.path[0][0] - me.x, brain.path[0][1] - me.y) < 0.3) brain.path.shift();
            const wp = brain.path[0] || [gx, gy];
            const desired = Math.atan2(wp[1] - me.y, wp[0] - me.x);
            if (turnMul) {
                inp.a = turnToward(me.a, desired, L.turn * 1.3, dt);
                if (Math.abs(wrapAngle(desired - inp.a)) < 0.7) inp.f = 1;
            } else {
                // 边瞄准边移动：把期望方向分解到前后/左右
                const rel = wrapAngle(desired - inp.a);
                const c = Math.cos(rel), s = Math.sin(rel);
                if (c > 0.35) inp.f = 1; else if (c < -0.35) inp.b = 1;
                if (s > 0.35) inp.r = 1; else if (s < -0.35) inp.l = 1;
            }
        };

        if (sees) {
            brain.seen += dt;
            brain.lastKnown = { x: foe.x, y: foe.y };
            brain.noiseT -= dt;
            if (brain.noiseT <= 0) {
                brain.noiseT = 0.3 + Math.random() * 0.25;
                brain.noise = (Math.random() * 2 - 1) * L.noise * (1 + dist * 0.06);
            }
            const lead = dist / BUBBLE_SPEED * L.lead;
            const tx = foe.x + foe.vx * lead, ty = foe.y + foe.vy * lead;
            const desired = Math.atan2(ty - me.y, tx - me.x) + brain.noise;
            inp.a = turnToward(me.a, desired, L.turn, dt);

            brain.fireGateT -= dt;
            if (brain.fireGateT <= 0) { brain.fireGateT = 0.5; brain.fireGate = Math.random() < L.fireRate ? 1 : 0; }
            if (brain.seen > L.react && brain.fireGate && Math.abs(wrapAngle(desired - inp.a)) < L.cone + 0.4 / Math.max(dist, 1)) {
                inp.fire = foe.inv > 0 ? 0 : 1;
            }

            if (pickGoal) {
                followPath(pickGoal.x, pickGoal.y, 'pick' + pickGoal.x + ',' + pickGoal.y, false);
            } else {
                if (dist > L.keep + 1) inp.f = 1;
                else if (dist < L.keep - 1.3) inp.b = 1;
                brain.strafeT -= dt;
                if (brain.strafeT <= 0) {
                    brain.strafeT = 0.5 + Math.random() * 1.0;
                    brain.strafeDir = Math.random() < L.strafe ? (Math.random() < 0.5 ? -1 : 1) : 0;
                }
                if (brain.strafeDir > 0) inp.r = 1; else if (brain.strafeDir < 0) inp.l = 1;
            }
        } else {
            brain.seen = Math.max(0, brain.seen - dt * 2);
            if (pickGoal) {
                followPath(pickGoal.x, pickGoal.y, 'pick' + pickGoal.x + ',' + pickGoal.y, true);
            } else if (foe.dead <= 0 && (L.track >= 1 || brain.lastKnown || Math.random() < L.track)) {
                // 追踪玩家（简单难度更多时候只去“最后看见的位置”）
                const g = (L.track >= 0.85 || !brain.lastKnown) ? foe : brain.lastKnown;
                followPath(g.x, g.y, 'hunt' + Math.floor(g.x) + ',' + Math.floor(g.y), true);
                if (brain.lastKnown && Math.hypot(brain.lastKnown.x - me.x, brain.lastKnown.y - me.y) < 0.6) brain.lastKnown = null;
            } else {
                if (!brain.wander || Math.hypot(brain.wander[0] - me.x, brain.wander[1] - me.y) < 0.6) {
                    brain.wander = PICKUP_SPOTS[Math.floor(Math.random() * PICKUP_SPOTS.length)];
                }
                followPath(brain.wander[0], brain.wander[1], 'wander' + brain.wander.join(','), true);
            }
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
        gameFolder: 'blaster',
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
            hp: p.hp, frags: p.frags, dead: r3(p.dead), inv: r3(p.inv), rapid: r3(p.rapid),
            cd: 0, hurt: r3(p.hurt), walk: r3(p.walk), moving: p.moving
        };
    }

    function sendState() {
        gs.seq++;
        session.send({
            type: 'state', seq: gs.seq,
            p1: packPlayer(gs.p1), p2: packPlayer(gs.p2),
            bubbles: gs.bubbles.map(b => ({ id: b.id, o: b.o, x: r3(b.x), y: r3(b.y), dx: r3(b.dx), dy: r3(b.dy), t: 1 })),
            pickups: gs.pickups, countdown: r3(gs.countdown),
            status: gs.status, winner: gs.winner,
            fx: pendingFx.length ? pendingFx : undefined
        });
        pendingFx = [];
    }

    function handleNet(msg) {
        if (!msg || mode !== 'pvp') return;
        if (msg.type === 'state' && myRole === 'client') {
            if (typeof msg.seq === 'number' && msg.seq <= lastStateSeq && msg.seq > lastStateSeq - 1000) return;
            lastStateSeq = msg.seq;
            const prevStatus = gs.status;
            gs.p1 = msg.p1; gs.p2 = msg.p2;
            gs.bubbles = msg.bubbles || [];
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
        if (!predicted || me.dead > 0) { predicted = { x: me.x, y: me.y }; return; }
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
    function updateScores() {
        p1ScoreVal.textContent = gs.p1.frags;
        p2ScoreVal.textContent = gs.p2.frags;
    }

    function startMatch() {
        gs = createInitialState();
        gs.status = 'playing';
        bubbleSeq = 0;
        pendingFx = [];
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
        const iWon = (gs.winner === 1 && mk === 'p1') || (gs.winner === 2 && mk === 'p2');
        winLossTitle.textContent = iWon ? 'VICTORY! 🎉' : 'DEFEAT…';
        winLossTitle.style.color = iWon ? '#ffd36b' : '#ff9ab0';
        const wk = gs.winner === 1 ? 'p1' : 'p2';
        winnerMascot.textContent = '🏆 ' + charOf(wk).emoji;
        finalScore.textContent = `${gs.p1.frags} - ${gs.p2.frags}`;
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
        if (fx.k === 'shot') {
            if (fx.who === myId) { recoilT = 0.12; spawnMuzzle(); }
            sfx.shoot();
        } else if (fx.k === 'pop') {
            const c = CHARS[kindOf(fx.o === 1 ? 'p1' : 'p2')].bubble;
            for (let i = 0; i < 5; i++) particles.push({ x: fx.x, y: fx.y, z: 0.5, vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, vz: Math.random() * 0.8, t: 0.45, c });
            sfx.pop();
        } else if (fx.k === 'hit') {
            if (fx.by === myId) { hitMarkT = 0.18; sfx.hit(); }
            if (fx.to === myId) { hurtFlashT = 0.35; sfx.hurt(); }
        } else if (fx.k === 'ko') {
            const a = nameOf(fx.by), b = nameOf(fx.to);
            feed.push({ text: `${a.emoji} ${a.name} 🫧 ${b.emoji} ${b.name}`, t: 3.5 });
            if (feed.length > 4) feed.shift();
            if (fx.by === myId) { banner('💥 POP! 击倒对手！', 1.4); hitMarkT = 0.3; sfx.ko(); }
            if (fx.to === myId) { hurtFlashT = 0.6; sfx.down(); }
            updateScores();
        } else if (fx.k === 'pick') {
            if (fx.who === myId) {
                banner(fx.type === 'heal' ? '🍓 +40 HP' : '⚡ 闪电连射！', 1.2);
                sfx.pick();
            }
        } else if (fx.k === 'spawn') {
            if (fx.who === myId) {
                localAngle = fx.a;
                predicted = null;
            }
        }
    }

    function spawnMuzzle() {
        for (let i = 0; i < 4; i++) {
            muzzle.push({ x: W * 0.56 + Math.random() * 10, y: H * 0.72, vx: -40 - Math.random() * 60, vy: -80 - Math.random() * 90, r: 4 + Math.random() * 7, t: 0.5 });
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
    let inputSeq = 0, idleSendTick = 0;
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
            }
        } else if (mode === 'pvp' && myRole === 'client') {
            const inp = collectLocalInput(dt);
            const me = gs.p2;
            if (gs.status === 'playing') {
                if (predicted && me.dead <= 0 && gs.countdown <= 0) moveBody(predicted, inp, localAngle, dt);
                session.send(Object.assign({ type: 'input', seq: ++inputSeq }, inp));
            }
        } else {
            collectLocalInput(dt);
        }
        if (gs.countdown <= 0 && bannerText === 'READY…') banner('GO! 🫧', 0.8);
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
        const floor = ctx.createLinearGradient(0, hz, 0, H);
        floor.addColorStop(0, '#ffe7d6'); floor.addColorStop(1, '#f2b99a');
        ctx.fillStyle = floor; ctx.fillRect(0, hz, W, H - hz);
        // 地板的透视横纹（饼干格子感）
        ctx.strokeStyle = 'rgba(200,120,100,.18)'; ctx.lineWidth = 2;
        for (let d = 1; d < 14; d++) {
            const y = hz + (PROJ / 2) / d;
            if (y > H) continue;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
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
        if (gs.status !== 'lobby' && foe.dead <= 0) {
            const pr = project(foeView.x, foeView.y);
            if (pr) list.push({ pr, kind: 'player', foe, view: foeView });
        }
        for (const b of gs.bubbles) {
            const pr = project(b.x, b.y);
            if (pr) list.push({ pr, kind: 'bubble', b });
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
                const blink = f.inv > 0 && Math.floor(now * 10) % 2 === 0;
                drawClipped(img, sx - w / 2, floorY - h - bob, w, h, depth, blink ? 0.35 : 1);
                // 头顶血条
                const ci = Math.floor(clamp(sx / COL_W, 0, RAYS - 1));
                if (depth < zbuf[ci] && depth < 9) {
                    const bw = Math.max(26, w * 0.6), bx = sx - bw / 2, by = floorY - h - bob - 12;
                    ctx.fillStyle = 'rgba(40,20,50,.55)'; ctx.fillRect(bx, by, bw, 6);
                    ctx.fillStyle = f.hp > 40 ? '#7af0a8' : '#ff7a8a'; ctx.fillRect(bx, by, bw * f.hp / MAX_HP, 6);
                }
            } else if (s.kind === 'bubble') {
                const ci = Math.floor(clamp(sx / COL_W, 0, RAYS - 1));
                if (depth >= zbuf[ci]) continue;
                const rgb = CHARS[kindOf(s.b.o === 1 ? 'p1' : 'p2')].bubble;
                const size = Math.min(unit * 0.2, 56);
                ctx.drawImage(bubbleSprite(rgb), sx - size / 2, hz + unit * 0.06 - size / 2, size, size);
            } else if (s.kind === 'pickup') {
                const size = unit * 0.38;
                const float = Math.sin(now * 3 + s.k.x) * unit * 0.04;
                drawClipped(emojiSprite(s.k.type === 'heal' ? '🍓' : '⚡'), sx - size / 2, floorY - size - unit * 0.08 + float, size, size, depth);
            } else {
                const ci = Math.floor(clamp(sx / COL_W, 0, RAYS - 1));
                if (depth >= zbuf[ci]) continue;
                const size = unit * 0.07 * (s.p.t / 0.45 + 0.3);
                ctx.fillStyle = `rgba(${s.p.c},${Math.min(1, s.p.t * 2.5)})`;
                ctx.beginPath(); ctx.arc(sx, hz + unit * (0.5 - s.p.z) * 0.5, size, 0, Math.PI * 2); ctx.fill();
            }
        }
    }

    function drawWeapon(me, moving) {
        const now = performance.now() / 1000;
        const bobX = moving ? Math.sin(now * 9) * 8 : 0;
        const bobY = moving ? Math.abs(Math.cos(now * 9)) * 8 : Math.sin(now * 2) * 2;
        const kick = recoilT > 0 ? recoilT / 0.12 : 0;
        const C = charOf(meKey());
        ctx.save();
        ctx.translate(W * 0.64 + bobX, H * 0.86 + bobY + kick * 18);
        ctx.rotate(-0.28 - kick * 0.08);
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(60,30,60,.6)';
        // 枪身
        ctx.fillStyle = '#7fe0ff';
        ctx.beginPath(); roundRect(ctx, -70, -30, 150, 62, 28); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#b49bff';
        ctx.beginPath(); roundRect(ctx, -110, -18, 50, 36, 16); ctx.fill(); ctx.stroke();
        // 枪口
        ctx.fillStyle = '#ff9ec7';
        ctx.beginPath(); roundRect(ctx, -130, -14, 26, 28, 10); ctx.fill(); ctx.stroke();
        // 泡泡储液罐
        const slosh = Math.sin(now * 4) * 4;
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        ctx.beginPath(); ctx.arc(20, -48, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.beginPath(); ctx.arc(20, -48, 27, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = me.rapid > 0 ? '#ffd36b' : `rgb(${C.bubble})`;
        ctx.fillRect(-12, -46 + slosh, 64, 40);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(10, -60, 7, 0, Math.PI * 2); ctx.fill();
        // 小爪子
        ctx.fillStyle = C.body;
        ctx.beginPath(); ctx.ellipse(40, 30, 34, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,140,170,.6)';
        for (const [px, py] of [[28, 22], [42, 18], [56, 24]]) { ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();

        for (const m of muzzle) {
            ctx.globalAlpha = Math.min(1, m.t * 2);
            ctx.drawImage(bubbleSprite(C.bubble), m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
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

        // 血量
        ctx.fillStyle = 'rgba(40,20,60,.55)';
        ctx.beginPath(); roundRect(ctx, 16, H - 50, 210, 34, 17); ctx.fill();
        ctx.font = '600 18px Fredoka, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillStyle = '#fff'; ctx.fillText('❤', 28, H - 33);
        ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(54, H - 40, 120, 14);
        ctx.fillStyle = me.hp > 40 ? '#7af0a8' : '#ff7a8a'; ctx.fillRect(54, H - 40, 120 * me.hp / MAX_HP, 14);
        ctx.fillStyle = '#fff'; ctx.fillText(String(Math.max(0, Math.round(me.hp))), 182, H - 33);
        if (me.rapid > 0) {
            ctx.fillStyle = '#ffd36b';
            ctx.fillText(`⚡ ${me.rapid.toFixed(1)}s`, 20, H - 66);
        }

        // 比分
        const mk = meKey();
        const c1 = charOf('p1'), c2 = charOf('p2');
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(40,20,60,.55)';
        ctx.beginPath(); roundRect(ctx, W / 2 - 90, 10, 180, 34, 17); ctx.fill();
        ctx.font = '700 20px Fredoka, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(`${c1.emoji} ${gs.p1.frags}  :  ${gs.p2.frags} ${c2.emoji}`, W / 2, 28);
        ctx.font = '500 12px Fredoka, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.8)';
        ctx.fillText(`先拿 ${WIN_FRAGS} 次击倒获胜 · 你是 ${charOf(mk).emoji}`, W / 2, 56);

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
        for (const k of gs.pickups) { ctx.fillStyle = k.type === 'heal' ? '#ff5577' : '#ffd36b'; ctx.fillRect(mx0 + k.x * ms - 2, my0 + k.y * ms - 2, 4, 4); }
        const foe = gs[foeKey()];
        if (foe.dead <= 0 && gs.status !== 'lobby') {
            ctx.fillStyle = `rgb(${charOf(foeKey()).bubble})`;
            ctx.beginPath(); ctx.arc(mx0 + foe.x * ms, my0 + foe.y * ms, 3, 0, Math.PI * 2); ctx.fill();
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

        // 被击倒
        if (me.dead > 0 && gs.status === 'playing') {
            ctx.fillStyle = 'rgba(120,90,160,.45)'; ctx.fillRect(0, 0, W, H);
            drawBigText('🫧 被泡泡包住啦！', '#ffffff', 34, -20);
            ctx.font = '600 18px Fredoka, sans-serif'; ctx.fillStyle = '#fff';
            ctx.fillText(`${me.dead.toFixed(1)} 秒后复活`, W / 2, H / 2 + 28);
        }

        if (gs.status === 'playing' && mode !== 'idle' && !locked() && !('ontouchstart' in window)) {
            ctx.font = '500 13px Fredoka, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
            ctx.fillText('点击画面锁定鼠标视角 · 右键前进 · F 自动开火 · Esc 释放', W / 2, H - 14);
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
            const pos = predicted && me.dead <= 0 ? predicted : me;
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

        const moving = !!(keys.f || keys.b || keys.l || keys.r || mouseFwd || (stick.id !== null && Math.abs(stickVec().y) > 0.32)) && gs.status === 'playing' && me.dead <= 0;
        const hz = H / 2 + (moving ? Math.sin(performance.now() / 1000 * 9 * 2) * 2.5 : 0);

        drawSkyFloor(hz);
        drawWalls(hz);
        drawSprites(hz, smooth);
        if (gs.status === 'playing' && mode !== 'idle') {
            if (me.dead <= 0) drawWeapon(me, moving);
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
    window.__blaster = {
        get mode() { return mode; },
        get role() { return myRole; },
        get state() { return JSON.parse(JSON.stringify({ status: gs.status, p1: gs.p1, p2: gs.p2, bubbles: gs.bubbles.length, winner: gs.winner })); },
        get strafeLock() { return strafeLock; }
    };
    // 仅 ?e2e 时开放：冻结程序对手并摆放位置，用于确定性地测试单手锁定平移
    if (params.has('e2e')) {
        window.__blaster.freezeBot = on => { e2eFreezeBot = !!on; };
        window.__blaster.place = (key, x, y, a) => {
            const p = gs[key]; p.x = x; p.y = y; p.a = a; p.vx = p.vy = 0;
            if (key === meKey()) { localAngle = a; cam.x = x; cam.y = y; cam.a = a; }
        };
    }
});
