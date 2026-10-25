/**
 * 水弹大作战 (Q 版泡泡堂)
 *
 * 房主算一切（和坦克、光轮一样）：地图、水球、水柱、道具、被困、胜负都在
 * 房主这边模拟，每 50ms 把完整状态广播一次（不可靠无序通道，丢一帧就等
 * 下一帧）。客机只发 {type:'input', dx, dy, a}，a 是"放水球"按键计数器，
 * 丢包也不会漏按。
 *
 * 规则：水柱打中 → 被困进泡泡 3 秒（只能慢慢挪）。这期间对手碰到泡泡
 * 就戳破，你输；3 秒到了没人救也输。📌 自救针可以在被困时立刻脱身。
 */
document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash || location.hash.length <= 1) {
        location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    }
    const $ = id => document.getElementById(id);
    const canvas = $('game-canvas');
    const ctx = canvas.getContext('2d');
    const overlay = $('overlay');
    const screens = ['lobby-screen', 'ready-screen', 'gameover-screen', 'disconnect-screen'].map($);
    const startBtn = $('start-btn'), restartBtn = $('restart-btn');
    const statusText = $('status-text'), pingText = $('ping-text'), roleStatusText = $('role-status-text');
    const p1ScoreVal = $('p1-score'), p2ScoreVal = $('p2-score');

    $('invite-url').value = location.href;
    $('copy-btn').addEventListener('click', () => {
        $('invite-url').select();
        document.execCommand('copy');
        $('copy-btn').textContent = '已复制';
        setTimeout(() => { $('copy-btn').textContent = '复制'; }, 1500);
    });
    function show(id) {
        overlay.classList.toggle('hidden', !id);
        screens.forEach(s => s.classList.toggle('hidden', s.id !== id));
    }

    // ==========================================
    // 常量
    // ==========================================
    const COLS = 11, ROWS = 13, CELL = 40, HUD = 40;
    const LW = COLS * CELL, LH = ROWS * CELL + HUD;
    const view = GameFit.view(canvas, { width: LW, height: LH, onResize: () => render() });
    const FUSE = 2.6, FLAME_T = 0.55, TRAP_T = 3.2, ROUND_T = 150;
    const BASE_SPEED = 3.3, SPEED_STEP = 0.45, MAX_SPEED = 6.0;
    const ITEMS = { B: '💧', P: '🌊', S: '👟', N: '📌' };
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // 地图字符：'.' 空地  '#' 柱子  'x' 箱子  'B' 'P' 'S' 'N' 地上的道具
    function makeMap() {
        const g = [], hidden = {};
        for (let y = 0; y < ROWS; y++) {
            const row = [];
            for (let x = 0; x < COLS; x++) {
                if (x % 2 === 1 && y % 2 === 1) row.push('#');
                else row.push(Math.random() < 0.6 ? 'x' : '.');
            }
            g.push(row);
        }
        // 出生点周围留空（L 形，保证能放第一颗水球再躲开）
        const clear = [[0, 0], [1, 0], [0, 1], [2, 0], [0, 2],
            [COLS - 1, ROWS - 1], [COLS - 2, ROWS - 1], [COLS - 1, ROWS - 2], [COLS - 3, ROWS - 1], [COLS - 1, ROWS - 3]];
        clear.forEach(([x, y]) => { g[y][x] = '.'; });
        // 箱子里藏道具
        const bag = ['B', 'B', 'B', 'B', 'B', 'P', 'P', 'P', 'P', 'P', 'S', 'S', 'S', 'S', 'N', 'N'];
        const boxes = [];
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (g[y][x] === 'x') boxes.push(x + ',' + y);
        for (const it of bag) {
            if (!boxes.length) break;
            const i = Math.floor(Math.random() * boxes.length);
            hidden[boxes[i]] = it;
            boxes.splice(i, 1);
        }
        return { g, hidden };
    }

    function newPlayer(x, y, face) {
        return { x, y, face, max: 1, power: 2, speed: BASE_SPEED, needle: 0, state: 'ok', trapT: 0, safeT: 0, dx: 0, dy: 0, a: 0, lastA: 0, deadT: 0 };
    }

    function freshState(score) {
        const m = makeMap();
        return {
            g: m.g, hidden: m.hidden,
            bombs: [],          // {x, y, t, power, owner}
            flames: [],         // {x, y, t}
            p: [newPlayer(0, 0, 'down'), newPlayer(COLS - 1, ROWS - 1, 'up')],
            time: ROUND_T,
            status: 'lobby',    // lobby | playing | over
            winner: 0,          // 1 房主赢 2 客机赢 3 平局
            score: score || { p1: 0, p2: 0 },
            overT: 0
        };
    }
    let S = freshState();
    let myRole = null;
    let fx = [];                // 渲染特效（双方各自生成）

    // ==========================================
    // 网络
    // ==========================================
    const session = GameBot.session({
        gameFolder: 'bombs',
        onSignalingStatus(s) {
            if (GameBot.enabled) return;
            statusText.textContent = s === 'open' ? '等待对手' : '离线';
            statusText.className = s === 'open' ? 'status-online' : 'status-offline';
        },
        onRole(role) {
            myRole = role;
            roleStatusText.textContent = role.toUpperCase();
            $('role-text').textContent = role === 'host' ? '你是房主（粉色兔兔），点开始就开局' : '你是黄色小鸡，等房主点开始…';
        },
        onChannelOpen() {
            show('ready-screen');
            startBtn.classList.toggle('hidden', myRole !== 'host');
        },
        onPeerConnected() {
            if (GameBot.enabled) return;
            statusText.textContent = '已连接'; statusText.className = 'status-online';
        },
        onPeerReconnecting() { statusText.textContent = '重连中…'; statusText.className = 'status-offline'; },
        onPeerDisconnected() {
            S.status = 'lobby';
            show('disconnect-screen');
            statusText.textContent = '等待对手'; pingText.textContent = '-- ms';
        },
        onRtt(ms) { pingText.textContent = ms + ' ms'; },
        onMessage: onMessage
    });

    function onMessage(msg) {
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'input' && myRole === 'host') {
            const p = S.p[1];
            p.dx = clamp(+msg.dx || 0, -1, 1); p.dy = clamp(+msg.dy || 0, -1, 1);
            if ((msg.a | 0) > p.a) p.a = msg.a | 0;
        } else if (msg.type === 's' && myRole === 'client') {
            applySnapshot(msg);
        } else if (msg.type === 'restart-request' && myRole === 'host' && S.status !== 'playing') {
            initGame();
        }
    }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    startBtn.addEventListener('click', () => { if (myRole === 'host') initGame(); });
    restartBtn.addEventListener('click', () => {
        if (myRole === 'host') initGame();
        else { session.send({ type: 'restart-request' }); restartBtn.textContent = '等房主…'; restartBtn.disabled = true; }
    });
    $('lobby-btn').addEventListener('click', () => location.reload());

    // ==========================================
    // 房主模拟
    // ==========================================
    let hostTimer = 0, lastStep = 0, sendAcc = 0;
    const STEP = 1 / 60;

    function initGame() {
        S = freshState(S.score);
        S.status = 'playing';
        fx = [];
        myInput.a = 0; S.p[0].lastA = 0; S.p[1].lastA = 0;
        if (GameBot.enabled) botReset();
        show(null);
        clearInterval(hostTimer);
        lastStep = performance.now();
        hostTimer = setInterval(hostLoop, 16);
        broadcast();
    }

    function hostLoop() {
        const now = performance.now();
        let acc = Math.min(0.25, (now - lastStep) / 1000);
        lastStep = now;
        while (acc >= STEP * 0.5) {
            const dt = Math.min(STEP, acc);
            const p0 = S.p[0];
            p0.dx = myInput.dx; p0.dy = myInput.dy; if (myInput.a > p0.a) p0.a = myInput.a;
            if (GameBot.enabled) botStep(dt);
            step(dt);
            acc -= dt;
            sendAcc += dt;
        }
        if (sendAcc >= 0.05) { sendAcc = 0; broadcast(); }
        if (S.status === 'over' && S.overT > 1.3 && !S.shown) { S.shown = true; showGameOver(); }
    }

    const walkable = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && S.g[y][x] !== '#' && S.g[y][x] !== 'x';
    const bombAt = (x, y) => S.bombs.find(b => b.x === x && b.y === y);
    function blockedFor(p, x, y) {
        if (!walkable(x, y)) return true;
        const b = bombAt(x, y);
        // 自己脚下的水球不挡路（刚放下要能走开）
        return !!b && !(Math.round(p.x) === x && Math.round(p.y) === y);
    }

    /** 网格移动 + 拐角辅助：推的方向被挡住时，自动往能通过的那一侧对齐。 */
    function movePlayer(p, dt) {
        let { dx, dy } = p;
        const mag = Math.hypot(dx, dy);
        if (mag < 0.3) return;
        const spd = (p.state === 'trapped' ? 0.7 : p.speed) * dt;
        const horiz = Math.abs(dx) >= Math.abs(dy);
        const tryAxis = (h, s) => {
            const cx = Math.round(p.x), cy = Math.round(p.y);
            const tx = h ? cx + s : cx, ty = h ? cy : cy + s;
            const off = h ? p.y - cy : p.x - cx;            // 垂直于移动方向的偏移
            const along = h ? p.x - cx : p.y - cy;          // 沿移动方向相对格心
            const blocked = blockedFor(p, tx, ty);
            if (blocked && along * s >= -1e-6) {
                // 正前方被挡：看看斜前方能不能走，能就往那边滑（拐角辅助）
                if (Math.abs(off) > 0.12) {
                    const side = off > 0 ? 1 : -1;
                    const sx = h ? cx + s : cx + side, sy = h ? cy + side : cy + s;
                    const nx = h ? cx : cx + side, ny = h ? cy + side : cy;
                    if (!blockedFor(p, sx, sy) && !blockedFor(p, nx, ny)) {
                        if (h) p.y += side * Math.min(spd, 1 - Math.abs(off)); else p.x += side * Math.min(spd, 1 - Math.abs(off));
                        return true;
                    }
                }
                if (h) p.x = cx; else p.y = cy;
                return false;
            }
            // 先把垂直偏移对齐到格心，再前进
            let left = spd;
            if (Math.abs(off) > 1e-3) {
                const fix = Math.min(Math.abs(off), left);
                if (h) p.y -= Math.sign(off) * fix; else p.x -= Math.sign(off) * fix;
                left -= fix;
            }
            if (h) p.x += s * left; else p.y += s * left;
            if (blocked) { // 前面被挡：最多走到本格格心
                if (h) p.x = s > 0 ? Math.min(p.x, cx) : Math.max(p.x, cx);
                else p.y = s > 0 ? Math.min(p.y, cy) : Math.max(p.y, cy);
            }
            p.x = clamp(p.x, 0, COLS - 1); p.y = clamp(p.y, 0, ROWS - 1);
            return true;
        };
        const primary = horiz ? [true, Math.sign(dx)] : [false, Math.sign(dy)];
        const secondary = horiz ? [false, Math.sign(dy)] : [true, Math.sign(dx)];
        const before = p.x + ',' + p.y;
        tryAxis(primary[0], primary[1]);
        // 主方向完全走不动、而摇杆是斜着推的：试另一个轴
        if (before === p.x + ',' + p.y && secondary[1] && Math.abs(horiz ? dy : dx) > 0.35) tryAxis(secondary[0], secondary[1]);
        p.face = horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }

    function placeBomb(i) {
        const p = S.p[i];
        const x = Math.round(p.x), y = Math.round(p.y);
        if (p.state !== 'ok' || bombAt(x, y)) return false;
        if (S.bombs.filter(b => b.owner === i).length >= p.max) return false;
        S.bombs.push({ x, y, t: FUSE, power: p.power, owner: i });
        return true;
    }

    function blastCells(b, grid) {
        const cells = [[b.x, b.y]];
        for (const [ddx, ddy] of DIRS) {
            for (let k = 1; k <= b.power; k++) {
                const x = b.x + ddx * k, y = b.y + ddy * k;
                if (x < 0 || y < 0 || x >= COLS || y >= ROWS) break;
                const c = grid[y][x];
                if (c === '#') break;
                cells.push([x, y]);
                if (c === 'x') break;
            }
        }
        return cells;
    }

    function explode(b) {
        S.bombs.splice(S.bombs.indexOf(b), 1);
        for (const [x, y] of blastCells(b, S.g)) {
            const c = S.g[y][x];
            if (c === 'x') S.g[y][x] = S.hidden[x + ',' + y] || '.';
            else if (ITEMS[c]) S.g[y][x] = '.';      // 水柱冲走地上的道具
            S.flames.push({ x, y, t: FLAME_T });
            const other = bombAt(x, y);
            if (other) other.t = Math.min(other.t, 0.06); // 连锁
        }
    }

    function step(dt) {
        if (S.status === 'over') { S.overT += dt; return; }
        if (S.status !== 'playing') return;
        S.time -= dt;
        // 放水球
        S.p.forEach((p, i) => {
            if (p.a > p.lastA) {
                p.lastA = p.a;
                if (p.state === 'trapped' && p.needle > 0) { p.needle--; p.state = 'ok'; p.trapT = 0; p.safeT = 1.0; } // 脱身后 1 秒无敌，免得被同一道水柱再困住
                else placeBomb(i);
            }
        });
        S.p.forEach(p => { if (p.state !== 'dead') movePlayer(p, dt); });
        // 捡道具
        S.p.forEach(p => {
            if (p.state !== 'ok') return;
            const x = Math.round(p.x), y = Math.round(p.y), c = S.g[y][x];
            if (!ITEMS[c]) return;
            S.g[y][x] = '.';
            if (c === 'B') p.max = Math.min(6, p.max + 1);
            if (c === 'P') p.power = Math.min(8, p.power + 1);
            if (c === 'S') p.speed = Math.min(MAX_SPEED, p.speed + SPEED_STEP);
            if (c === 'N') p.needle = Math.min(3, p.needle + 1);
        });
        // 水球倒计时 / 爆炸（可能连锁，循环直到没有到点的）
        S.bombs.forEach(b => { b.t -= dt; });
        let boom;
        while ((boom = S.bombs.find(b => b.t <= 0))) explode(boom);
        S.flames.forEach(f => { f.t -= dt; });
        S.flames = S.flames.filter(f => f.t > 0);
        // 水柱命中 → 被困
        S.p.forEach(p => {
            if (p.safeT > 0) p.safeT -= dt;
            if (p.state !== 'ok' || p.safeT > 0) return;
            const x = Math.round(p.x), y = Math.round(p.y);
            if (S.flames.some(f => f.x === x && f.y === y)) { p.state = 'trapped'; p.trapT = TRAP_T; }
        });
        // 被困：对手碰到就戳破；时间到也破
        S.p.forEach((p, i) => {
            if (p.state !== 'trapped') return;
            p.trapT -= dt;
            const o = S.p[1 - i];
            if (o.state === 'ok' && Math.hypot(o.x - p.x, o.y - p.y) < 0.75) p.state = 'dead';
            else if (p.trapT <= 0) p.state = 'dead';
        });
        const d0 = S.p[0].state === 'dead', d1 = S.p[1].state === 'dead';
        if (d0 || d1 || S.time <= 0) {
            S.status = 'over'; S.overT = 0;
            S.winner = d0 && d1 ? 3 : d0 ? 2 : d1 ? 1 : 3;
            if (S.winner === 1) S.score.p1++;
            if (S.winner === 2) S.score.p2++;
            updateScore();
            broadcast();
        }
    }

    function packPlayer(p) {
        return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.face[0], p.state[0], Math.round(p.trapT * 10) / 10, p.max, p.power, Math.round(p.speed * 100) / 100, p.needle];
    }
    function broadcast() {
        session.send({
            type: 's',
            g: S.g.map(r => r.join('')).join(''),
            b: S.bombs.map(b => [b.x, b.y, Math.round(b.t * 10) / 10, b.power]),
            f: S.flames.map(f => [f.x, f.y]),
            p: S.p.map(packPlayer),
            t: Math.ceil(S.time),
            st: S.status, w: S.winner, sc: S.score
        });
    }

    // ==========================================
    // 客机：应用快照
    // ==========================================
    const FACE = { u: 'up', d: 'down', l: 'left', r: 'right' };
    const STATE = { o: 'ok', t: 'trapped', d: 'dead' };
    function applySnapshot(m) {
        if (typeof m.g !== 'string' || m.g.length !== COLS * ROWS) return;
        const wasPlaying = S.status === 'playing';
        for (let y = 0; y < ROWS; y++) S.g[y] = m.g.slice(y * COLS, (y + 1) * COLS).split('');
        S.bombs = (m.b || []).map(a => ({ x: a[0], y: a[1], t: a[2], power: a[3] }));
        S.flames = (m.f || []).map(a => ({ x: a[0], y: a[1], t: FLAME_T }));
        (m.p || []).forEach((a, i) => {
            const p = S.p[i];
            p.tx = a[0]; p.ty = a[1];
            if (p.x === undefined || Math.hypot(p.tx - p.x, p.ty - p.y) > 2) { p.x = a[0]; p.y = a[1]; }
            p.face = FACE[a[2]] || 'down'; p.state = STATE[a[3]] || 'ok'; p.trapT = a[4];
            p.max = a[5]; p.power = a[6]; p.speed = a[7]; p.needle = a[8];
        });
        S.time = m.t; S.winner = m.w;
        if (m.sc) S.score = m.sc;
        if (m.st === 'playing' && !wasPlaying) {
            show(null); fx = []; S.shown = false;
            restartBtn.textContent = '再来一局'; restartBtn.disabled = false;
        }
        if (m.st === 'over' && S.status !== 'over') {
            S.status = 'over';
            setTimeout(showGameOver, 1300);
        }
        S.status = m.st;
        updateScore();
    }

    // ==========================================
    // 输入
    // ==========================================
    const myInput = { dx: 0, dy: 0, a: 0 };
    const keyDir = { up: false, down: false, left: false, right: false };
    let stick = { x: 0, y: 0, on: false };
    const KEYS = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
    function syncInput() {
        if (stick.on) { myInput.dx = stick.x; myInput.dy = stick.y; }
        else {
            myInput.dx = (keyDir.right ? 1 : 0) - (keyDir.left ? 1 : 0);
            myInput.dy = (keyDir.down ? 1 : 0) - (keyDir.up ? 1 : 0);
        }
        if (myRole === 'client') sendInput();
    }
    function pressBomb() {
        if (S.status !== 'playing') return;
        myInput.a++;
        GameFit.buzz(12);
        if (myRole === 'client') sendInput();
    }
    let lastInputSent = 0;
    function sendInput() {
        lastInputSent = performance.now();
        session.send({ type: 'input', dx: Math.round(myInput.dx * 100) / 100, dy: Math.round(myInput.dy * 100) / 100, a: myInput.a });
    }
    // 客机：即使没变化也每 100ms 重发一次（通道不可靠）
    setInterval(() => { if (myRole === 'client' && S.status === 'playing' && performance.now() - lastInputSent > 100) sendInput(); }, 50);

    window.addEventListener('keydown', e => {
        if (KEYS[e.key]) { e.preventDefault(); keyDir[KEYS[e.key]] = true; syncInput(); }
        else if ((e.key === ' ' || e.key === 'j' || e.key === 'J' || e.key === 'Enter') && !e.repeat) {
            if (e.key === 'Enter' && S.status !== 'playing') return;
            e.preventDefault(); pressBomb();
        }
    });
    window.addEventListener('keyup', e => { if (KEYS[e.key]) { keyDir[KEYS[e.key]] = false; syncInput(); } });

    GameFit.joystick($('stick-zone'), $('stick-knob'), (x, y, on) => {
        // 小死区，避免手指轻微抖动导致乱走
        const m = Math.hypot(x, y);
        stick = m < 0.25 ? { x: 0, y: 0, on } : { x, y, on };
        syncInput();
    }, { radius: 46 });
    GameFit.touchButtons($('touch-controls'), (a, down) => { if (a === 'bomb' && down) pressBomb(); }, { slide: false });

    // ==========================================
    // 人机对手（?bot=easy|normal|hard）：黄色小鸡 = p[1]
    // ==========================================
    // 每隔一小段时间"想一次"：
    //   1. 算危险图：每个格子最早会在几秒后被水柱冲到（含连锁），正在喷的水柱 = 0。
    //   2. 脚下危险 → BFS 找最近的安全格（路上经过的格子要在被冲到之前走过）。
    //   3. 对手被困且够得着 → 冲过去戳破。
    //   4. 放水球能炸到箱子/对手，并且放完还有路可逃 → 放，然后去安全格。
    //   5. 否则去捡道具 / 去最近的箱子旁边 / 去找对手。
    // 难度：思考间隔、追人积极性、简单难度偶尔发呆。
    const BOT_LV = GameBot.level || 'normal';
    let bot = null;
    function botReset() { bot = { think: 0, path: [], a: 0, idle: 0 }; }
    botReset();

    function dangerMap(extra) {
        const dm = new Float32Array(COLS * ROWS).fill(Infinity);
        const bombs = S.bombs.map(b => ({ x: b.x, y: b.y, t: b.t, power: b.power }));
        if (extra) bombs.push(extra);
        const cells = bombs.map(b => blastCells(b, S.g));
        // 连锁：被别的水球冲到的水球，会提前到那个时间爆
        for (let it = 0; it < 4; it++) {
            bombs.forEach((b, i) => cells[i].forEach(([x, y]) => {
                bombs.forEach(o => { if (o.x === x && o.y === y && o.t > b.t) o.t = b.t; });
            }));
        }
        bombs.forEach((b, i) => cells[i].forEach(([x, y]) => { const k = y * COLS + x; dm[k] = Math.min(dm[k], b.t); }));
        S.flames.forEach(f => { dm[f.y * COLS + f.x] = 0; });
        return { dm, bombs };
    }
    function search(me, D) {
        const sx = Math.round(me.x), sy = Math.round(me.y);
        const per = 1 / me.speed;
        const arr = new Float32Array(COLS * ROWS).fill(Infinity);
        const par = new Int32Array(COLS * ROWS).fill(-1);
        const start = sy * COLS + sx;
        arr[start] = 0;
        const q = [start];
        while (q.length) {
            const k = q.shift(), x = k % COLS, y = (k / COLS) | 0;
            for (const [ddx, ddy] of DIRS) {
                const nx = x + ddx, ny = y + ddy, nk = ny * COLS + nx;
                if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || arr[nk] !== Infinity) continue;
                if (!walkable(nx, ny) || D.bombs.some(b => b.x === nx && b.y === ny)) continue;
                const t = arr[k] + per;
                const d = D.dm[nk];
                // 水柱正在喷 / 到达时刚好会爆（含水柱残留时间）→ 不能走
                if (d <= t + 0.25 && d + FLAME_T >= t - 0.15) continue;
                arr[nk] = t; par[nk] = k; q.push(nk);
            }
        }
        return { arr, par, start };
    }
    function pathTo(S2, k) {
        const out = [];
        while (k !== -1 && k !== S2.start) { out.push(k); k = S2.par[k]; }
        return out.reverse().map(k => ({ x: k % COLS, y: (k / COLS) | 0 }));
    }
    function nearest(S2, pred) {
        let best = -1, bt = Infinity;
        for (let k = 0; k < COLS * ROWS; k++) {
            if (S2.arr[k] < bt && pred(k % COLS, (k / COLS) | 0, k)) { bt = S2.arr[k]; best = k; }
        }
        return best;
    }
    function bombValue(x, y, power, foe) {
        let v = 0;
        for (const [cx, cy] of blastCells({ x, y, power }, S.g)) {
            if (S.g[cy][cx] === 'x') v += 1;
            if (foe.state === 'ok' && Math.round(foe.x) === cx && Math.round(foe.y) === cy) v += GameBot.pick({ easy: 1, normal: 3, hard: 6 });
        }
        return v;
    }

    function botStep(dt) {
        const me = S.p[1], foe = S.p[0];
        if (S.status !== 'playing' || me.state === 'dead') { send(0, 0); return; }
        bot.think -= dt;
        if (bot.think <= 0) {
            bot.think = GameBot.pick({ easy: 0.34, normal: 0.17, hard: 0.08 });
            think(me, foe);
        }
        // 沿路径走
        const nxt = bot.path[0];
        if (!nxt) { send(0, 0); return; }
        const dx = nxt.x - me.x, dy = nxt.y - me.y;
        if (Math.abs(dx) < 0.06 && Math.abs(dy) < 0.06) { bot.path.shift(); send(0, 0); return; }
        if (Math.abs(dx) >= Math.abs(dy)) send(Math.sign(dx), 0); else send(0, Math.sign(dy));
    }
    function send(dx, dy) { GameBot.deliver({ type: 'input', dx, dy, a: bot.a }); }
    function press() { bot.a++; GameBot.deliver({ type: 'input', dx: 0, dy: 0, a: bot.a }); }

    function think(me, foe) {
        if (me.state === 'trapped') {
            if (me.needle > 0) press();
            bot.path = [];
            return;
        }
        if (BOT_LV === 'easy') {
            if (bot.idle > 0) { bot.idle -= 0.34; return; }
            if (Math.random() < 0.04) { bot.idle = 0.8; bot.path = []; return; }
        }
        const mx = Math.round(me.x), my = Math.round(me.y);
        const D = dangerMap();
        const R = search(me, D);
        const safe = (x, y, k) => D.dm[k] === Infinity;
        // 1. 躲
        if (D.dm[my * COLS + mx] !== Infinity) {
            const k = nearest(R, safe);
            bot.path = k >= 0 ? pathTo(R, k) : [];
            return;
        }
        // 2. 戳破被困的对手
        if (foe.state === 'trapped' && (BOT_LV !== 'easy' || Math.random() < 0.6)) {
            const fk = Math.round(foe.y) * COLS + Math.round(foe.x);
            if (R.arr[fk] !== Infinity) { bot.path = pathTo(R, fk); return; }
        }
        // 3. 放水球
        const mine = S.bombs.filter(b => b.owner === 1).length;
        if (mine < me.max && !bombAt(mx, my)) {
            const v = bombValue(mx, my, me.power, foe);
            const want = v >= (BOT_LV === 'easy' ? 1 : 1) && (BOT_LV !== 'easy' || Math.random() < 0.7);
            if (want) {
                const D2 = dangerMap({ x: mx, y: my, t: FUSE, power: me.power });
                const R2 = search(me, D2);
                const k = nearest(R2, (x, y, kk) => D2.dm[kk] === Infinity && R2.arr[kk] < FUSE - 0.5);
                if (k >= 0) { press(); bot.path = pathTo(R2, k); return; }
            }
        }
        // 4. 找目标
        let goal = nearest(R, (x, y, k) => safe(x, y, k) && ITEMS[S.g[y][x]]);
        const hunt = BOT_LV === 'hard' || (BOT_LV === 'normal' && Math.random() < 0.5);
        if (goal < 0 || R.arr[goal] > 2.5) {
            // 普通/困难：挑"能炸到的箱子数 ÷ 走过去的时间"最划算的位置，而不是只看最近
            let nearBox = -1;
            if (BOT_LV === 'easy') nearBox = nearest(R, (x, y, k) => safe(x, y, k) && DIRS.some(([a, b]) => S.g[y + b] && S.g[y + b][x + a] === 'x'));
            else {
                let bs = 0;
                for (let k = 0; k < COLS * ROWS; k++) {
                    if (R.arr[k] === Infinity || D.dm[k] !== Infinity) continue;
                    const x = k % COLS, y = (k / COLS) | 0;
                    if (bombAt(x, y)) continue;
                    const v = bombValue(x, y, me.power, { state: 'none' });
                    if (!v) continue;
                    const sc = v / (R.arr[k] + 1);
                    if (sc > bs) { bs = sc; nearBox = k; }
                }
            }
            const fx = Math.round(foe.x), fy = Math.round(foe.y);
            const nearFoe = hunt ? nearest(R, (x, y, k) => safe(x, y, k) && (x === fx || y === fy) && Math.abs(x - fx) + Math.abs(y - fy) <= Math.max(1, me.power - 1)) : -1;
            if (nearFoe >= 0 && (nearBox < 0 || R.arr[nearFoe] < R.arr[nearBox] + (BOT_LV === 'hard' ? 1.2 : 0.3))) goal = nearFoe;
            else if (nearBox >= 0) goal = nearBox;
            else if (goal < 0) goal = nearFoe;
        }
        if (goal >= 0) bot.path = pathTo(R, goal);
        else {
            // 没目标：随便挪到一个安全格
            const opts = DIRS.map(([a, b]) => ({ x: mx + a, y: my + b })).filter(c => walkable(c.x, c.y) && !bombAt(c.x, c.y) && D.dm[c.y * COLS + c.x] === Infinity);
            bot.path = opts.length ? [opts[Math.floor(Math.random() * opts.length)]] : [];
        }
    }

    GameBot.expose({
        state: () => ({
            status: S.status, winner: S.winner, score: S.score, time: S.time,
            players: S.p.map(p => ({ x: p.x, y: p.y, state: p.state, max: p.max, power: p.power, speed: p.speed, needle: p.needle })),
            boxes: S.g.reduce((n, r) => n + r.filter(c => c === 'x').length, 0),
            bombs: S.bombs.length
        }),
        // 测试用：只在 ?e2e 时可用
        place: location.search.includes('e2e') ? (i, x, y) => { S.p[i].x = x; S.p[i].y = y; } : undefined,
        set: location.search.includes('e2e') ? (i, k, v) => { S.p[i][k] = v; } : undefined,
        grid: location.search.includes('e2e') ? (rows) => { S.g = rows.map(r => r.split('')); S.hidden = {}; } : undefined
    });

    // ==========================================
    // 结束 / 比分
    // ==========================================
    const myIdx = () => myRole === 'client' ? 1 : 0;
    function updateScore() {
        p1ScoreVal.textContent = myIdx() ? S.score.p2 : S.score.p1;
        p2ScoreVal.textContent = myIdx() ? S.score.p1 : S.score.p2;
    }
    function showGameOver() {
        const title = $('win-loss-title');
        const iWon = S.winner === myIdx() + 1;
        if (S.winner === 3) { title.textContent = '🤝 平局'; title.className = 'neon-text'; }
        else { title.textContent = iWon ? '🎉 你赢了！' : '💦 被戳破了…'; title.className = iWon ? 'neon-text' : 'danger-text'; }
        $('final-score').textContent = (myIdx() ? S.score.p2 : S.score.p1) + ' - ' + (myIdx() ? S.score.p1 : S.score.p2);
        GameFit.buzz(iWon ? 30 : 60);
        show('gameover-screen');
    }

    // ==========================================
    // 渲染
    // ==========================================
    function rr(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
    let lastFrame = performance.now(), clock = 0;
    let flameSeen = new Set();
    const SKIN = [
        { body: '#ff9ec7', dark: '#e0679d', ear: 'bunny', name: '兔兔' },
        { body: '#ffd966', dark: '#e0a930', ear: 'chick', name: '小鸡' }
    ];

    function drawChar(p, i) {
        const sk = SKIN[i];
        const cx = p.x * CELL + CELL / 2, cy = HUD + p.y * CELL + CELL / 2;
        const bob = p.state === 'ok' && (Math.abs(p.dx || 0) + Math.abs(p.dy || 0) > 0.3 || p.tx !== undefined) ? Math.sin(clock * 14) * 1.5 : 0;
        ctx.save();
        ctx.translate(cx, cy + bob);
        if (p.state === 'dead') ctx.globalAlpha = 0.45;
        // 影子
        ctx.fillStyle = 'rgba(0,40,60,.18)';
        ctx.beginPath(); ctx.ellipse(0, 15 - bob, 13, 4, 0, 0, 7); ctx.fill();
        // 耳朵 / 呆毛
        ctx.fillStyle = sk.body;
        if (sk.ear === 'bunny') {
            for (const s of [-1, 1]) {
                ctx.beginPath(); ctx.ellipse(s * 7, -20, 4.5, 10, s * 0.18, 0, 7); ctx.fill();
                ctx.fillStyle = '#ffd3e6'; ctx.beginPath(); ctx.ellipse(s * 7, -19, 2, 6, s * 0.18, 0, 7); ctx.fill();
                ctx.fillStyle = sk.body;
            }
        } else {
            ctx.strokeStyle = sk.dark; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(0, -15); ctx.quadraticCurveTo(3, -24, 7, -22); ctx.stroke();
        }
        // 身体（圆滚滚）
        ctx.fillStyle = sk.body;
        ctx.beginPath(); ctx.ellipse(0, 0, 15, 15.5, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = sk.dark; ctx.lineWidth = 1.5; ctx.stroke();
        // 脸
        const fx2 = p.face === 'left' ? -3 : p.face === 'right' ? 3 : 0;
        const fy2 = p.face === 'up' ? -3 : p.face === 'down' ? 2 : 0;
        ctx.fillStyle = '#3a2440';
        if (p.state === 'dead') {
            ctx.strokeStyle = '#3a2440'; ctx.lineWidth = 2;
            for (const s of [-1, 1]) {
                ctx.beginPath(); ctx.moveTo(fx2 + s * 5 - 2.5, fy2 - 4.5); ctx.lineTo(fx2 + s * 5 + 2.5, fy2 + 0.5);
                ctx.moveTo(fx2 + s * 5 + 2.5, fy2 - 4.5); ctx.lineTo(fx2 + s * 5 - 2.5, fy2 + 0.5); ctx.stroke();
            }
        } else if (p.face !== 'up') {
            ctx.beginPath(); ctx.arc(fx2 - 5, fy2 - 2, 2.4, 0, 7); ctx.arc(fx2 + 5, fy2 - 2, 2.4, 0, 7); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(fx2 - 4.2, fy2 - 3, 0.9, 0, 7); ctx.arc(fx2 + 5.8, fy2 - 3, 0.9, 0, 7); ctx.fill();
            ctx.fillStyle = 'rgba(255,90,140,.35)';
            ctx.beginPath(); ctx.arc(fx2 - 9, fy2 + 3, 2.6, 0, 7); ctx.arc(fx2 + 9, fy2 + 3, 2.6, 0, 7); ctx.fill();
            if (sk.ear === 'chick') { ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.moveTo(fx2 - 3, fy2 + 2); ctx.lineTo(fx2 + 3, fy2 + 2); ctx.lineTo(fx2, fy2 + 6); ctx.fill(); }
            else { ctx.strokeStyle = '#3a2440'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(fx2, fy2 + 2, 2.5, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
        // 被困：大泡泡 + 倒计时圈
        if (p.state === 'trapped') {
            const wob = 1 + Math.sin(clock * 9) * 0.04;
            ctx.fillStyle = 'rgba(150,225,255,.38)';
            ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(0, -2, 22 * wob, 22 / wob, 0, 0, 7); ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,.75)';
            ctx.beginPath(); ctx.ellipse(-9, -12, 5, 3, -0.6, 0, 7); ctx.fill();
            ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, -2, 25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, p.trapT) / TRAP_T); ctx.stroke();
        }
        // 头顶标记
        ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center';
        const tag = i === myIdx() ? '我' : (GameBot.enabled ? '🤖' : 'TA');
        ctx.fillStyle = i === myIdx() ? '#ffffff' : 'rgba(255,255,255,.75)';
        ctx.strokeStyle = 'rgba(0,40,60,.6)'; ctx.lineWidth = 3;
        ctx.strokeText(tag, 0, -33); ctx.fillText(tag, 0, -33);
        ctx.restore();
    }

    function drawHud() {
        ctx.fillStyle = '#0f3443'; ctx.fillRect(0, 0, LW, HUD);
        ctx.font = '600 14px system-ui, sans-serif'; ctx.textBaseline = 'middle';
        const stat = (p, x, align, i) => {
            ctx.textAlign = align;
            const txt = (i === 0 ? '🐰 ' : '🐥 ') + '💧' + p.max + ' 🌊' + p.power + ' 👟' + Math.round((p.speed - BASE_SPEED) / SPEED_STEP) + (p.needle ? ' 📌' + p.needle : '');
            ctx.fillStyle = i === myIdx() ? '#fff' : '#b7dbe8';
            ctx.fillText(txt, x, HUD / 2);
        };
        stat(S.p[0], 8, 'left', 0);
        stat(S.p[1], LW - 8, 'right', 1);
        const t = Math.max(0, Math.ceil(S.time));
        ctx.textAlign = 'center'; ctx.font = '800 16px system-ui, sans-serif';
        ctx.fillStyle = t <= 20 ? '#ff8f9e' : '#ffe08a';
        if (S.status !== 'lobby') ctx.fillText(Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'), LW / 2, HUD / 2);
        ctx.textBaseline = 'alphabetic';
    }

    function render() {
        const now = performance.now();
        const dt = Math.min(0.05, (now - lastFrame) / 1000);
        lastFrame = now; clock += dt;
        if (myRole === 'client') S.p.forEach(p => {
            if (p.tx === undefined) return;
            const k = Math.min(1, dt * 16);
            p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
        });

        view.begin(ctx);
        drawHud();
        // 地板
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#bfe9f2' : '#ace0ec';
            ctx.fillRect(x * CELL, HUD + y * CELL, CELL, CELL);
        }
        // 方块 / 道具
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
            const c = S.g[y][x], px = x * CELL, py = HUD + y * CELL;
            if (c === '#') {
                ctx.fillStyle = '#5f86ad'; rr(px + 2, py + 4, CELL - 4, CELL - 5, 9); ctx.fill();
                ctx.fillStyle = '#8fb6dc'; rr(px + 2, py + 1, CELL - 4, CELL - 11, 9); ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,.45)'; rr(px + 8, py + 5, 12, 4, 2); ctx.fill();
            } else if (c === 'x') {
                ctx.fillStyle = '#d98f55'; rr(px + 3, py + 4, CELL - 6, CELL - 6, 7); ctx.fill();
                ctx.fillStyle = '#f2b27a'; rr(px + 3, py + 2, CELL - 6, CELL - 10, 7); ctx.fill();
                ctx.strokeStyle = 'rgba(140,80,40,.5)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(px + 8, py + 8); ctx.lineTo(px + CELL - 8, py + CELL - 12);
                ctx.moveTo(px + CELL - 8, py + 8); ctx.lineTo(px + 8, py + CELL - 12); ctx.stroke();
                ctx.fillStyle = '#ff7fae'; ctx.beginPath(); ctx.arc(px + CELL / 2, py + CELL / 2 - 4, 3.5, 0, 7); ctx.fill();
            } else if (ITEMS[c]) {
                const bob = Math.sin(clock * 4 + x + y) * 2;
                ctx.fillStyle = 'rgba(255,255,255,.65)';
                ctx.beginPath(); ctx.arc(px + CELL / 2, py + CELL / 2 + bob, 15, 0, 7); ctx.fill();
                ctx.strokeStyle = 'rgba(95,209,255,.9)'; ctx.lineWidth = 2; ctx.stroke();
                ctx.font = '20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(ITEMS[c], px + CELL / 2, py + CELL / 2 + bob + 1);
                ctx.textBaseline = 'alphabetic';
            }
        }
        // 水柱
        const nowSet = new Set();
        for (const f of S.flames) {
            const key = f.x + ',' + f.y; nowSet.add(key);
            if (!flameSeen.has(key)) {
                for (let i = 0; i < 4; i++) fx.push({ x: f.x * CELL + CELL / 2, y: HUD + f.y * CELL + CELL / 2, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 120, t: 0, life: 0.5 });
            }
            const px = f.x * CELL, py = HUD + f.y * CELL;
            const w = Math.sin(clock * 30 + f.x) * 1.5;
            ctx.fillStyle = 'rgba(70,170,255,.85)'; rr(px + 2 - w, py + 2 - w, CELL - 4 + 2 * w, CELL - 4 + 2 * w, 13); ctx.fill();
            ctx.fillStyle = 'rgba(230,248,255,.95)'; rr(px + 10, py + 10, CELL - 20, CELL - 20, 8); ctx.fill();
        }
        if (S.flames.length && !flameSeen.size) GameFit.buzz(20);
        flameSeen = nowSet;
        // 水球
        for (const b of S.bombs) {
            const cx = b.x * CELL + CELL / 2, cy = HUD + b.y * CELL + CELL / 2 + 2;
            const urgency = 1 - Math.max(0, b.t) / FUSE;
            const sc = 1 + Math.sin(clock * (6 + urgency * 18)) * (0.05 + urgency * 0.07);
            ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, 1 / sc);
            ctx.fillStyle = 'rgba(0,40,60,.18)'; ctx.beginPath(); ctx.ellipse(0, 14, 12, 4, 0, 0, 7); ctx.fill();
            const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, 16);
            g.addColorStop(0, '#d8f4ff'); g.addColorStop(0.5, urgency > 0.75 ? '#5aa8ff' : '#45b8f5'); g.addColorStop(1, '#1d6fb8');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill();
            ctx.fillStyle = '#1d6fb8'; ctx.beginPath(); ctx.moveTo(-3, -14); ctx.lineTo(3, -14); ctx.lineTo(0, -10); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.ellipse(-5, -6, 4, 2.5, -0.6, 0, 7); ctx.fill();
            ctx.restore();
        }
        // 角色（按 y 排序，下面的盖住上面的）
        [0, 1].sort((a, b) => S.p[a].y - S.p[b].y).forEach(i => drawChar(S.p[i], i));
        // 水花
        fx = fx.filter(f => {
            f.t += dt; if (f.t > f.life) return false;
            f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 300 * dt;
            ctx.globalAlpha = 1 - f.t / f.life;
            ctx.fillStyle = '#e6f8ff'; ctx.beginPath(); ctx.arc(f.x, f.y, 3, 0, 7); ctx.fill();
            ctx.globalAlpha = 1;
            return true;
        });
        if (S.status === 'lobby') {
            ctx.fillStyle = 'rgba(15,52,67,.35)'; ctx.fillRect(0, HUD, LW, LH - HUD);
        }
    }
    (function frame() { render(); requestAnimationFrame(frame); })();
});
