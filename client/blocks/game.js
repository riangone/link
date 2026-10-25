/**
 * 萌萌方块对战 (Q 版俄罗斯方块对战)
 *
 * 和其他游戏不同，这里不是"房主算一切"：每个人在自己手机上跑自己的棋盘，
 * 手感完全不受网络延迟影响。网络上只传三类东西：
 *   - board   我的棋盘快照（200 字符，给对方画小窗）
 *   - garbage 我消行产生的攻击行数
 *   - over    我堆到顶了（发给房主）；房主判定胜负后广播 result
 * 开局时房主发一个随机种子，双方用同一个种子出方块（7-bag），公平。
 *
 * 人机模式下，程序对手在本机跑第二块棋盘（botBoard），消息不走网络，
 * 直接在 sendGameData / GameBot.deliver 之间转一手。
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
    // 规则常量
    // ==========================================
    const W = 10, H = 20, HIDDEN = 2;       // 顶上 2 行不可见，用来出生
    const ROWS = H + HIDDEN;
    const LW = 360, LH = 540;               // 逻辑画布
    const CELL = 26, BX = 6, BY = 6;        // 主棋盘
    const view = GameFit.view(canvas, { width: LW, height: LH, onResize: () => render() });

    // 糖果色：I O T S Z J L + 垃圾行
    const COLORS = [null, '#7fd8ff', '#ffd966', '#c79bff', '#8ee59b', '#ff8f9e', '#7fa7ff', '#ffb070', '#b9b0c9'];
    const SHAPES = {
        1: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
        2: [[1, 1], [1, 1]],
        3: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
        4: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
        5: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
        6: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
        7: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
    };
    function rotateM(m, times) {
        let r = m;
        for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
            const n = r.length;
            r = r.map((row, y) => row.map((_, x) => r[n - 1 - x][y]));
        }
        return r;
    }
    const ROT = {};
    for (const k in SHAPES) ROT[k] = [0, 1, 2, 3].map(t => rotateM(SHAPES[k], t));
    const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1]];
    const ATTACK = [0, 0, 1, 2, 4];

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // ==========================================
    // 棋盘（我和程序对手共用）
    // ==========================================
    class Board {
        constructor(seed) {
            this.grid = Array.from({ length: ROWS }, () => new Array(W).fill(0));
            this.rng = mulberry32(seed);
            this.garbageRng = mulberry32(seed ^ 0x5bd1e995);
            this.bag = [];
            this.queue = [];
            this.hold = 0;
            this.canHold = true;
            this.incoming = [];     // 待落地的垃圾行（每条一批）
            this.combo = -1;
            this.lines = 0;
            this.sent = 0;
            this.pieces = 0;
            this.dead = false;
            this.fallAcc = 0;
            this.lockAcc = 0;
            this.lockMoves = 0;
            this.events = [];       // 渲染用：消行、攻击等
            this.spawn();
        }
        nextKind() {
            while (this.queue.length < 6) { // 取走一个后预览仍有 5 个
                if (!this.bag.length) {
                    this.bag = [1, 2, 3, 4, 5, 6, 7];
                    for (let i = 6; i > 0; i--) {
                        const j = Math.floor(this.rng() * (i + 1));
                        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
                    }
                }
                this.queue.push(this.bag.pop());
            }
            return this.queue.shift();
        }
        spawn(kind) {
            const k = kind || this.nextKind();
            const size = ROT[k][0].length;
            this.cur = { k, r: 0, x: Math.floor((W - size) / 2), y: k === 1 ? 0 : 1 };
            this.fallAcc = 0; this.lockAcc = 0; this.lockMoves = 0;
            if (!this.fits(this.cur.k, this.cur.r, this.cur.x, this.cur.y)) this.dead = true;
        }
        fits(k, r, x, y) {
            const m = ROT[k][r];
            for (let j = 0; j < m.length; j++) for (let i = 0; i < m.length; i++) {
                if (!m[j][i]) continue;
                const gx = x + i, gy = y + j;
                if (gx < 0 || gx >= W || gy >= ROWS) return false;
                if (gy >= 0 && this.grid[gy][gx]) return false;
            }
            return true;
        }
        touching() { return !this.fits(this.cur.k, this.cur.r, this.cur.x, this.cur.y + 1); }
        move(dx) {
            if (this.dead) return false;
            const c = this.cur;
            if (!this.fits(c.k, c.r, c.x + dx, c.y)) return false;
            c.x += dx;
            this.bumpLock();
            return true;
        }
        rotate(dir) {
            if (this.dead) return false;
            const c = this.cur, nr = (c.r + dir + 4) % 4;
            if (c.k === 2) return true;
            for (const [kx, ky] of KICKS) {
                if (this.fits(c.k, nr, c.x + kx * (dir > 0 ? 1 : -1), c.y + ky)) {
                    c.x += kx * (dir > 0 ? 1 : -1); c.y += ky; c.r = nr;
                    this.bumpLock();
                    return true;
                }
            }
            return false;
        }
        bumpLock() { if (this.touching() && this.lockMoves < 15) { this.lockAcc = 0; this.lockMoves++; } }
        softDrop() {
            if (this.dead || this.touching()) return false;
            this.cur.y++; this.fallAcc = 0;
            return true;
        }
        ghostY() {
            let y = this.cur.y;
            while (this.fits(this.cur.k, this.cur.r, this.cur.x, y + 1)) y++;
            return y;
        }
        hardDrop() {
            if (this.dead) return null;
            const d = this.ghostY() - this.cur.y;
            this.cur.y += d;
            this.events.push({ type: 'drop', x: this.cur.x, y: this.cur.y, k: this.cur.k, r: this.cur.r, d });
            return this.lock();
        }
        doHold() {
            if (this.dead || !this.canHold) return false;
            const k = this.cur.k;
            if (this.hold) { const h = this.hold; this.hold = k; this.spawn(h); }
            else { this.hold = k; this.spawn(); }
            this.canHold = false;
            return true;
        }
        /** 落定当前方块。返回本次要发给对手的攻击行数。 */
        lock() {
            const c = this.cur, m = ROT[c.k][c.r];
            for (let j = 0; j < m.length; j++) for (let i = 0; i < m.length; i++) {
                if (m[j][i] && c.y + j >= 0) this.grid[c.y + j][c.x + i] = c.k;
            }
            this.pieces++;
            const full = [];
            for (let y = 0; y < ROWS; y++) if (this.grid[y].every(v => v)) full.push(y);
            let attack = 0;
            if (full.length) {
                for (const y of full) { this.grid.splice(y, 1); this.grid.unshift(new Array(W).fill(0)); }
                this.lines += full.length;
                this.combo++;
                attack = ATTACK[full.length] + (this.combo > 0 ? Math.min(this.combo, 4) : 0);
                if (this.grid.every(row => row.every(v => !v))) attack += 4; // 全清
                // 先抵消自己身上待落地的垃圾
                while (attack > 0 && this.incoming.length) {
                    const use = Math.min(attack, this.incoming[0]);
                    attack -= use; this.incoming[0] -= use;
                    if (!this.incoming[0]) this.incoming.shift();
                }
                this.sent += attack;
                this.events.push({ type: 'clear', rows: full, n: full.length, combo: this.combo, attack });
            } else {
                this.combo = -1;
                this.applyGarbage();
            }
            this.canHold = true;
            this.spawn();
            return attack;
        }
        applyGarbage() {
            let budget = 8; // 一次最多落 8 行，剩下的下回合再落
            while (this.incoming.length && budget > 0) {
                const n = Math.min(this.incoming[0], budget);
                const hole = Math.floor(this.garbageRng() * W);
                for (let i = 0; i < n; i++) {
                    if (this.grid[0].some(v => v)) this.dead = true;
                    this.grid.shift();
                    const row = new Array(W).fill(8); row[hole] = 0;
                    this.grid.push(row);
                }
                budget -= n;
                this.incoming[0] -= n;
                if (!this.incoming[0]) this.incoming.shift();
                this.events.push({ type: 'garbage', n });
            }
        }
        receive(n) { if (n > 0) this.incoming.push(Math.min(n, 12)); }
        pending() { return this.incoming.reduce((a, b) => a + b, 0); }
        /** 重力 + 锁定延迟。dt 毫秒，gravity 每格毫秒。 */
        update(dt, gravity, soft) {
            if (this.dead) return null;
            const g = soft ? Math.min(gravity, 35) : gravity;
            if (this.touching()) {
                this.lockAcc += dt;
                if (this.lockAcc >= 500) return { attack: this.lock() };
            } else {
                this.fallAcc += dt;
                while (this.fallAcc >= g && !this.touching()) { this.fallAcc -= g; this.cur.y++; }
            }
            return null;
        }
        /** 200 字符快照（可见区），当前方块也画进去。 */
        snapshot() {
            const g = this.grid.map(r => r.slice());
            if (!this.dead) {
                const c = this.cur, m = ROT[c.k][c.r];
                for (let j = 0; j < m.length; j++) for (let i = 0; i < m.length; i++) {
                    if (m[j][i] && c.y + j >= 0 && c.y + j < ROWS) g[c.y + j][c.x + i] = c.k;
                }
            }
            return g.slice(HIDDEN).map(r => r.join('')).join('');
        }
        height() {
            for (let y = 0; y < ROWS; y++) if (this.grid[y].some(v => v)) return ROWS - y;
            return 0;
        }
    }

    // ==========================================
    // 对局状态
    // ==========================================
    let myRole = null;
    let me = null;              // 我的 Board
    let foe = { snap: '0'.repeat(W * H), pending: 0, lines: 0, dead: false };
    let botBoard = null;        // 人机模式：程序对手的 Board
    let status = 'lobby';       // lobby | playing | over
    let score = { p1: 0, p2: 0 };  // p1 = 房主, p2 = 客机
    let winner = 0;
    let startAt = 0;
    let lastSnapAt = 0;
    let raf = 0, lastT = 0;
    let fx = [];                // 粒子/飘字

    const BOT_LV = GameBot.level || 'normal';

    const session = GameBot.session({
        gameFolder: 'blocks',
        dataChannelOptions: { ordered: true },
        onSignalingStatus(s) {
            if (GameBot.enabled) return;
            statusText.textContent = s === 'open' ? '等待对手' : '离线';
            statusText.className = s === 'open' ? 'status-online' : 'status-offline';
        },
        onRole(role) {
            myRole = role;
            roleStatusText.textContent = role.toUpperCase();
            $('role-text').textContent = role === 'host' ? '你是房主，点开始就开局' : '等房主点开始…';
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
            status = 'lobby';
            show('disconnect-screen');
            statusText.textContent = '等待对手'; pingText.textContent = '-- ms';
        },
        onRtt(ms) { pingText.textContent = ms + ' ms'; },
        onMessage: onMessage
    });

    /** 发给对手。人机模式下"对手"就是本机的 botBoard。 */
    function sendGameData(msg) {
        if (GameBot.enabled) botReceive(msg);
        else session.send(msg);
    }

    function onMessage(msg) {
        if (!msg || typeof msg.type !== 'string') return;
        switch (msg.type) {
            case 'start':
                if (myRole === 'client') beginRound(msg.seed >>> 0, msg.score);
                break;
            case 'board':
                if (typeof msg.g === 'string' && msg.g.length === W * H) foe.snap = msg.g;
                foe.pending = msg.p | 0; foe.lines = msg.l | 0;
                break;
            case 'garbage':
                if (status === 'playing' && me && !me.dead) {
                    const n = Math.max(0, Math.min(12, msg.n | 0));
                    me.receive(n);
                    if (n) fx.push({ kind: 'text', x: BX + CELL * W / 2, y: BY + CELL * 4, text: '⚠️ +' + n, color: '#ff8f9e', t: 0, life: 900 });
                }
                break;
            case 'over':   // 客机 → 房主：我输了
                if (myRole === 'host') finish(1);
                else foe.dead = true;
                break;
            case 'result': // 房主 → 客机
                if (myRole === 'client') endRound(msg.winner, msg.score);
                break;
            case 'restart-request':
                if (myRole === 'host' && status !== 'playing') initGame();
                break;
        }
    }

    // ==========================================
    // 开局 / 结束
    // ==========================================
    startBtn.addEventListener('click', () => { if (myRole === 'host') initGame(); });
    restartBtn.addEventListener('click', () => {
        if (myRole === 'host') initGame();
        else { sendGameData({ type: 'restart-request' }); restartBtn.textContent = '等房主…'; restartBtn.disabled = true; }
    });
    $('lobby-btn').addEventListener('click', () => location.reload());

    function initGame() {
        const seed = (Math.random() * 0xffffffff) >>> 0;
        sendGameData({ type: 'start', seed, score });
        beginRound(seed, score);
        if (GameBot.enabled) startBot(seed);
    }

    function beginRound(seed, sc) {
        score = { p1: sc ? sc.p1 | 0 : score.p1, p2: sc ? sc.p2 | 0 : score.p2 };
        me = new Board(seed);
        foe = { snap: '0'.repeat(W * H), pending: 0, lines: 0, dead: false };
        status = 'playing'; winner = 0; fx = [];
        startAt = performance.now();
        keys.left = keys.right = keys.soft = false;
        restartBtn.textContent = '再来一局'; restartBtn.disabled = false;
        updateScore();
        show(null);
        cancelAnimationFrame(raf); lastT = performance.now();
        raf = requestAnimationFrame(loop);
    }

    /** 房主判定：winner 1 = 房主赢, 2 = 客机赢 */
    function finish(w) {
        if (status !== 'playing') return;
        if (w === 1) score.p1++; else score.p2++;
        sendGameData({ type: 'result', winner: w, score });
        endRound(w, score);
    }

    function endRound(w, sc) {
        status = 'over'; winner = w;
        if (sc) score = { p1: sc.p1 | 0, p2: sc.p2 | 0 };
        updateScore();
        const iWon = (w === 1) === (myRole === 'host');
        const title = $('win-loss-title');
        title.textContent = iWon ? '🎉 你赢了！' : '😵 被堆满了…';
        title.className = iWon ? 'neon-text' : 'danger-text';
        $('final-score').textContent = myScore() + ' - ' + foeScore();
        GameFit.buzz(iWon ? 30 : 60);
        render();
        setTimeout(() => { if (status === 'over') show('gameover-screen'); }, 700);
    }
    const myScore = () => myRole === 'client' ? score.p2 : score.p1;
    const foeScore = () => myRole === 'client' ? score.p1 : score.p2;
    function updateScore() { p1ScoreVal.textContent = myScore(); p2ScoreVal.textContent = foeScore(); }

    function gravityMs() {
        const s = (performance.now() - startAt) / 1000;
        return Math.max(90, 800 - s * 5);   // 2 分钟后约 200ms/格
    }

    // ==========================================
    // 主循环
    // ==========================================
    function loop(t) {
        const dt = Math.min(50, t - lastT); lastT = t;
        if (status === 'playing') {
            handleRepeat(dt);
            const res = me.update(dt, gravityMs(), keys.soft);
            if (res) afterLock(res.attack);
            if (me.dead) iLost();
            if (botBoard) botTick(dt);
            if (t - lastSnapAt > 110) {
                lastSnapAt = t;
                // 每 110ms 发一次全量快照（可靠有序通道，~220 字节），对方小窗约 9 帧/秒
                sendGameData({ type: 'board', g: me.snapshot(), p: me.pending(), l: me.lines });
            }
        }
        consumeEvents(me, BX, BY, CELL);
        render();
        if (status === 'playing' || fx.length) raf = requestAnimationFrame(loop);
    }

    function afterLock(attack) {
        if (attack > 0) sendGameData({ type: 'garbage', n: attack });
        if (me.dead) iLost();
    }

    function iLost() {
        if (status !== 'playing') return;
        if (myRole === 'host') finish(2);
        else { sendGameData({ type: 'over' }); me.dead = true; }
    }

    function consumeEvents(b, ox, oy, cell) {
        for (const e of b.events) {
            if (e.type === 'clear') {
                for (const ry of e.rows) {
                    const vy = ry - HIDDEN;
                    for (let i = 0; i < 10; i++) {
                        fx.push({ kind: 'spark', x: ox + Math.random() * cell * W, y: oy + (vy + 0.5) * cell,
                            vx: (Math.random() - 0.5) * 0.25, vy: -Math.random() * 0.25, color: COLORS[1 + (i % 7)], t: 0, life: 650 });
                    }
                }
                const words = ['', '好耶', '双消!', '三消!!', '四消!!!'];
                let text = words[e.n] || '';
                if (e.combo > 0) text += ' 连消x' + (e.combo + 1);
                if (e.attack) text += ' ➜' + e.attack;
                fx.push({ kind: 'text', x: ox + cell * W / 2, y: oy + cell * 9, text, color: '#fff3a8', t: 0, life: 1000 });
                GameFit.buzz(e.n >= 4 ? 40 : 15);
            } else if (e.type === 'garbage') {
                GameFit.buzz(25);
            }
        }
        b.events.length = 0;
    }

    // ==========================================
    // 输入：键盘 / 触屏按钮 / 画面手势
    // ==========================================
    const keys = { left: false, right: false, soft: false };
    let das = { dir: 0, t: 0, fired: false };
    const DAS = 160, ARR = 45;

    function act(a) {
        if (status !== 'playing' || !me || me.dead) return;
        let ok = false;
        if (a === 'left') ok = me.move(-1);
        else if (a === 'right') ok = me.move(1);
        else if (a === 'rotate') ok = me.rotate(1);
        else if (a === 'ccw') ok = me.rotate(-1);
        else if (a === 'soft') ok = me.softDrop();
        else if (a === 'drop') { const atk = me.hardDrop(); afterLock(atk || 0); ok = true; GameFit.buzz(10); }
        else if (a === 'hold') ok = me.doHold();
        return ok;
    }
    function setHeld(a, down) {
        if (a === 'left' || a === 'right') {
            keys[a] = down;
            // 后按下的方向优先；松开一个时退回仍按着的那个
            if (down) { act(a); das = { dir: a === 'left' ? -1 : 1, t: 0 }; }
            else das = { dir: keys.left ? -1 : keys.right ? 1 : 0, t: 0 };
        } else if (a === 'soft') {
            keys.soft = down;
        } else if (down) act(a);
    }
    function handleRepeat(dt) {
        if (!das.dir) return;
        das.t += dt;
        while (das.t >= DAS) { act(das.dir < 0 ? 'left' : 'right'); das.t -= ARR; }
    }

    const KEYMAP = {
        ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
        ArrowDown: 'soft', s: 'soft', S: 'soft',
        ArrowUp: 'rotate', x: 'rotate', X: 'rotate', w: 'rotate', W: 'rotate',
        z: 'ccw', Z: 'ccw', ' ': 'drop', c: 'hold', C: 'hold', Shift: 'hold'
    };
    window.addEventListener('keydown', e => {
        const a = KEYMAP[e.key];
        if (!a) return;
        e.preventDefault();
        if (e.repeat) return;
        setHeld(a, true);
    });
    window.addEventListener('keyup', e => {
        const a = KEYMAP[e.key];
        if (a) setHeld(a, false);
    });

    GameFit.touchButtons($('touch-controls'), setHeld, { buzz: 6 });

    // 画面手势：点=旋转（点左半边逆转），左右拖=逐格移动，下拖=加速，快速下划=直接落下，上划=暂存
    let gest = null;
    canvas.addEventListener('pointerdown', e => {
        if (status !== 'playing') return;
        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        gest = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, dropped: false };
    });
    canvas.addEventListener('pointermove', e => {
        if (!gest || e.pointerId !== gest.id || gest.dropped) return;
        const r = canvas.getBoundingClientRect();
        const step = Math.max(14, (CELL * r.width / LW) * 0.9);
        const dx = e.clientX - gest.x, dy = e.clientY - gest.y;
        const vy = (e.clientY - gest.y0) / Math.max(1, performance.now() - gest.t0);
        if (e.clientY - gest.y0 > 60 && vy > 1.1 && Math.abs(e.clientX - gest.x0) < 50) {
            act('drop'); gest.dropped = true; gest.moved = true; return;
        }
        if (Math.abs(dx) >= step) {
            const n = Math.trunc(dx / step);
            for (let i = 0; i < Math.abs(n); i++) act(n < 0 ? 'left' : 'right');
            gest.x += n * step; gest.moved = true; GameFit.buzz(4);
        }
        if (dy >= step) {
            const n = Math.trunc(dy / step);
            for (let i = 0; i < n; i++) act('soft');
            gest.y += n * step; gest.moved = true;
        }
    });
    function endGesture(e) {
        if (!gest || e.pointerId !== gest.id) return;
        const g = gest; gest = null;
        const dt = performance.now() - g.t0;
        const up = g.y0 - e.clientY;
        if (!g.moved && up > 50 && dt < 400) { act('hold'); return; }
        if (!g.moved && dt < 300 && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 14) {
            const r = canvas.getBoundingClientRect();
            const left = view.toLogical ? view.toLogical(e.clientX, e.clientY).x < LW / 2 : (e.clientX - r.left) < r.width / 2;
            act(left ? 'ccw' : 'rotate');
            GameFit.buzz(5);
        }
    }
    canvas.addEventListener('pointerup', endGesture);
    canvas.addEventListener('pointercancel', () => { gest = null; });

    // ==========================================
    // 人机对手：在本机跑第二块棋盘
    // ==========================================
    // 每块方块枚举 旋转×列 的所有落点，用经典的四项特征打分
    // （总高度、消行、空洞、凹凸度）。难度只影响思考间隔和失误率：
    //   简单 ~1.2 s/块，常常选次优；普通 ~0.65 s/块；困难 ~0.3 s/块，
    //   还会考虑暂存，并更怕堆高。
    let bot = null;
    function startBot(seed) {
        botBoard = new Board(seed);
        bot = { t: 0, snapT: 0, plan: null };
    }
    function botReceive(msg) {
        if (!botBoard) return;
        if (msg.type === 'garbage' && status === 'playing') botBoard.receive(Math.max(0, Math.min(12, msg.n | 0)));
    }
    function evalGrid(grid, cleared) {
        let agg = 0, holes = 0, bump = 0, maxH = 0, prev = -1, wells = 0;
        const hs = [];
        for (let x = 0; x < W; x++) {
            let h = 0, seen = false;
            for (let y = 0; y < ROWS; y++) {
                if (grid[y][x]) { if (!seen) { h = ROWS - y; seen = true; } }
                else if (seen) holes++;
            }
            hs.push(h); agg += h; maxH = Math.max(maxH, h);
            if (prev >= 0) bump += Math.abs(h - prev);
            prev = h;
        }
        for (let x = 0; x < W; x++) {
            const l = x ? hs[x - 1] : 99, r = x < W - 1 ? hs[x + 1] : 99;
            const d = Math.min(l, r) - hs[x];
            if (d > 2) wells += d - 2;
        }
        const hard = BOT_LV === 'hard';
        let s = -0.51 * agg + 0.76 * cleared - 0.36 * holes - 0.18 * bump;
        if (hard) s -= 0.25 * wells + (maxH > 12 ? (maxH - 12) * 1.2 : 0) - (maxH > 10 ? cleared * 0.8 : 0);
        return s;
    }
    function simulate(b, k, r, x) {
        let y = k === 1 ? 0 : 1;
        if (!b.fits(k, r, x, y)) { y = 0; if (!b.fits(k, r, x, y)) return null; }
        while (b.fits(k, r, x, y + 1)) y++;
        const g = b.grid.map(row => row.slice());
        const m = ROT[k][r];
        for (let j = 0; j < m.length; j++) for (let i = 0; i < m.length; i++) if (m[j][i] && y + j >= 0) g[y + j][x + i] = k;
        let cleared = 0;
        for (let yy = ROWS - 1; yy >= 0; yy--) {
            if (g[yy].every(v => v)) { g.splice(yy, 1); g.unshift(new Array(W).fill(0)); cleared++; yy++; }
        }
        return evalGrid(g, cleared);
    }
    function planMove(b) {
        const cands = [{ k: b.cur.k, hold: false }];
        if (BOT_LV === 'hard' && b.canHold) cands.push({ k: b.hold || b.queue[0], hold: true });
        const all = [];
        for (const c of cands) for (let r = 0; r < 4; r++) {
            if (c.k === 2 && r) continue;
            for (let x = -2; x < W; x++) {
                const s = simulate(b, c.k, r, x);
                if (s !== null) all.push({ k: c.k, hold: c.hold, r, x, s: s + GameBot.gauss() * GameBot.pick({ easy: 1.6, normal: 0.35, hard: 0.02 }) });
            }
        }
        all.sort((a, b2) => b2.s - a.s);
        if (!all.length) return null;
        if (BOT_LV === 'easy' && Math.random() < 0.18) return all[Math.min(all.length - 1, Math.floor(Math.random() * 6))];
        return all[0];
    }
    function botTick(dt) {
        const b = botBoard;
        bot.snapT += dt;
        if (bot.snapT > 110) {
            bot.snapT = 0;
            GameBot.deliver({ type: 'board', g: b.snapshot(), p: b.pending(), l: b.lines });
        }
        if (b.dead) return;
        bot.t += dt;
        const elapsed = (performance.now() - startAt) / 1000;
        const delay = GameBot.pick({ easy: 1200, normal: 650, hard: 300 }) * Math.max(0.6, 1 - elapsed / 300);
        if (!bot.plan) bot.plan = planMove(b) || { k: b.cur.k, r: 0, x: b.cur.x, hold: false };
        if (bot.t < delay) return;
        bot.t = 0;
        const p = bot.plan; bot.plan = null;
        if (p.hold) b.doHold();
        if (b.cur.k === p.k && b.fits(p.k, p.r, p.x, b.cur.y)) { b.cur.r = p.r; b.cur.x = p.x; }
        else if (b.cur.k === p.k && b.fits(p.k, p.r, p.x, 0)) { b.cur.r = p.r; b.cur.x = p.x; b.cur.y = 0; }
        const atk = b.hardDrop();
        b.events.length = 0;
        if (atk > 0) GameBot.deliver({ type: 'garbage', n: atk });
        if (b.dead) { GameBot.deliver({ type: 'board', g: b.snapshot(), p: 0, l: b.lines }); finish(1); }
    }

    GameBot.expose({
        state: () => ({
            status, winner, score,
            me: me && { lines: me.lines, sent: me.sent, dead: me.dead, height: me.height(), pending: me.pending(), pieces: me.pieces },
            bot: botBoard && { lines: botBoard.lines, sent: botBoard.sent, dead: botBoard.dead, height: botBoard.height(), pieces: botBoard.pieces },
            foe: { lines: foe.lines, pending: foe.pending }
        }),
        act: a => act(a),
        garbage: n => onMessage({ type: 'garbage', n })
    });

    // ==========================================
    // 渲染（Q 版：每个方块都是一张小脸）
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
    function drawCell(x, y, s, v, opts) {
        const col = COLORS[v];
        const pad = Math.max(0.6, s * 0.05);
        rr(x + pad, y + pad, s - pad * 2, s - pad * 2, s * 0.28);
        if (opts && opts.ghost) {
            ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, s * 0.08);
            ctx.stroke(); ctx.globalAlpha = 1;
            return;
        }
        ctx.fillStyle = col; ctx.fill();
        if (s < 10) return;
        // 高光
        ctx.fillStyle = 'rgba(255,255,255,.38)';
        rr(x + s * 0.18, y + s * 0.13, s * 0.42, s * 0.16, s * 0.08); ctx.fill();
        // 脸
        ctx.fillStyle = 'rgba(60,30,60,.75)';
        const ey = y + s * 0.5, r = s * 0.065;
        if (v === 8) {           // 垃圾块：困困眼
            ctx.fillRect(x + s * 0.27, ey, s * 0.14, s * 0.05);
            ctx.fillRect(x + s * 0.59, ey, s * 0.14, s * 0.05);
            return;
        }
        ctx.beginPath(); ctx.arc(x + s * 0.34, ey, r, 0, 7); ctx.arc(x + s * 0.66, ey, r, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(60,30,60,.7)'; ctx.lineWidth = Math.max(1, s * 0.05);
        ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.6, s * 0.09, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        ctx.fillStyle = 'rgba(255,120,160,.35)';
        ctx.beginPath(); ctx.arc(x + s * 0.22, y + s * 0.66, s * 0.07, 0, 7); ctx.arc(x + s * 0.78, y + s * 0.66, s * 0.07, 0, 7); ctx.fill();
    }
    function drawPiece(k, cx, cy, s) {
        const m = ROT[k][0];
        let minX = 9, maxX = -1, minY = 9, maxY = -1;
        m.forEach((row, j) => row.forEach((v, i) => { if (v) { minX = Math.min(minX, i); maxX = Math.max(maxX, i); minY = Math.min(minY, j); maxY = Math.max(maxY, j); } }));
        const w = (maxX - minX + 1) * s, h = (maxY - minY + 1) * s;
        m.forEach((row, j) => row.forEach((v, i) => { if (v) drawCell(cx - w / 2 + (i - minX) * s, cy - h / 2 + (j - minY) * s, s, k); }));
    }
    function panel(x, y, w, h, title) {
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        rr(x, y, w, h, 12); ctx.fill();
        if (title) {
            ctx.fillStyle = '#d6c3ec'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(title, x + w / 2, y + 14);
        }
    }

    function render() {
        view.begin(ctx);
        const bg = ctx.createLinearGradient(0, 0, 0, LH);
        bg.addColorStop(0, '#3d2c5e'); bg.addColorStop(1, '#2a1f3f');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, LW, LH);

        // 主棋盘
        ctx.fillStyle = 'rgba(20,12,35,.55)';
        rr(BX - 3, BY - 3, CELL * W + 6, CELL * H + 6, 14); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            ctx.beginPath(); ctx.arc(BX + x * CELL + CELL / 2, BY + y * CELL + CELL / 2, 1.6, 0, 7); ctx.fill();
        }
        if (me) {
            for (let y = HIDDEN; y < ROWS; y++) for (let x = 0; x < W; x++) {
                const v = me.grid[y][x];
                if (v) drawCell(BX + x * CELL, BY + (y - HIDDEN) * CELL, CELL, v);
            }
            if (!me.dead && status === 'playing') {
                const c = me.cur, m = ROT[c.k][c.r], gy = me.ghostY();
                for (let j = 0; j < m.length; j++) for (let i = 0; i < m.length; i++) {
                    if (!m[j][i]) continue;
                    if (gy + j >= HIDDEN) drawCell(BX + (c.x + i) * CELL, BY + (gy + j - HIDDEN) * CELL, CELL, c.k, { ghost: true });
                }
                for (let j = 0; j < m.length; j++) for (let i = 0; i < m.length; i++) {
                    if (m[j][i] && c.y + j >= HIDDEN) drawCell(BX + (c.x + i) * CELL, BY + (c.y + j - HIDDEN) * CELL, CELL, c.k);
                }
            }
            // 待落地垃圾
            const pend = me.pending();
            if (pend) {
                const h = Math.min(H, pend) * CELL;
                ctx.fillStyle = pend >= 4 ? '#ff5d7a' : '#ffb070';
                rr(BX + CELL * W + 3, BY + CELL * H - h, 5, h, 2.5); ctx.fill();
            }
            if (me.dead) {
                ctx.fillStyle = 'rgba(30,10,30,.55)'; ctx.fillRect(BX, BY, CELL * W, CELL * H);
                ctx.font = '48px system-ui'; ctx.textAlign = 'center'; ctx.fillText('😵', BX + CELL * W / 2, BY + CELL * H / 2);
            }
        } else {
            ctx.font = '40px system-ui'; ctx.textAlign = 'center';
            ctx.fillText('🍬', BX + CELL * W / 2, BY + CELL * H / 2);
        }

        // 右栏
        const RX = BX + CELL * W + 12, RW = LW - RX - 6;
        panel(RX, BY, RW, 150, '下一个');
        if (me) for (let i = 0; i < 3; i++) drawPiece(me.queue[i], RX + RW / 2, BY + 42 + i * 38, i ? 10 : 13);
        panel(RX, BY + 158, RW, 62, '暂存');
        if (me && me.hold) {
            ctx.globalAlpha = me.canHold ? 1 : 0.4;
            drawPiece(me.hold, RX + RW / 2, BY + 196, 12);
            ctx.globalAlpha = 1;
        }
        // 对手小窗
        const ms = RW / W, OY = BY + 228;
        panel(RX, OY, RW, ms * H + 22, GameBot.enabled ? '🤖 程序' : '对手');
        for (let i = 0; i < W * H; i++) {
            const v = foe.snap.charCodeAt(i) - 48;
            if (v > 0 && v <= 8) drawCell(RX + (i % W) * ms, OY + 20 + Math.floor(i / W) * ms, ms, v);
        }
        if (foe.pending) {
            const h = Math.min(H, foe.pending) * ms;
            ctx.fillStyle = '#ff5d7a'; ctx.fillRect(RX, OY + 20 + ms * H - h, 3, h);
        }
        // 数据
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff4fb';
        ctx.font = '700 12px system-ui, sans-serif';
        const sy = OY + ms * H + 40;
        if (me) {
            ctx.fillText('消行 ' + me.lines, RX + RW / 2, sy);
            ctx.fillText('攻击 ' + me.sent, RX + RW / 2, sy + 18);
            ctx.fillStyle = '#d6c3ec'; ctx.font = '11px system-ui, sans-serif';
            ctx.fillText('对手消 ' + foe.lines, RX + RW / 2, sy + 36);
        }

        // 特效
        fx = fx.filter(f => {
            f.t += 16;
            const k = f.t / f.life;
            if (k >= 1) return false;
            ctx.globalAlpha = 1 - k;
            if (f.kind === 'spark') {
                f.x += f.vx * 16; f.y += f.vy * 16; f.vy += 0.01;
                ctx.fillStyle = f.color;
                ctx.beginPath(); ctx.arc(f.x, f.y, 3.5 * (1 - k) + 1, 0, 7); ctx.fill();
            } else {
                ctx.fillStyle = f.color; ctx.font = '800 22px system-ui, sans-serif'; ctx.textAlign = 'center';
                ctx.strokeStyle = 'rgba(60,20,60,.8)'; ctx.lineWidth = 4;
                ctx.strokeText(f.text, f.x, f.y - k * 30); ctx.fillText(f.text, f.x, f.y - k * 30);
            }
            ctx.globalAlpha = 1;
            return true;
        });
    }

    render();
});
