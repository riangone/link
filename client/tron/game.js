document.addEventListener('DOMContentLoaded', () => {
    // 确保 URL 中有 Room ID
    if (!location.hash || location.hash.length <= 1) {
        const randomRoomId = Math.random().toString(36).substring(2, 9);
        location.hash = 'room-' + randomRoomId;
    }

    // 与 pong/game.js 相同的"好友邀请跳转带对方昵称"约定，见那边的注释。
    const opponentName = new URLSearchParams(location.search).get('opponent') || '';
    const waitingText = opponentName ? `WAITING FOR ${opponentName.toUpperCase()}` : 'WAITING FOR PEER';

    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    // UI 元素
    const p1ScoreVal = document.getElementById('p1-score');
    const p2ScoreVal = document.getElementById('p2-score');
    const overlay = document.getElementById('overlay');
    const lobbyScreen = document.getElementById('lobby-screen');
    const readyScreen = document.getElementById('ready-screen');
    const gameoverScreen = document.getElementById('gameover-screen');
    const disconnectScreen = document.getElementById('disconnect-screen');

    const inviteUrlInput = document.getElementById('invite-url');
    const copyBtn = document.getElementById('copy-btn');
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');
    const lobbyBtn = document.getElementById('lobby-btn');

    const connectionStateText = document.getElementById('connection-state-text');
    const roleText = document.getElementById('role-text');
    const winLossTitle = document.getElementById('win-loss-title');
    const finalScore = document.getElementById('final-score');

    const statusText = document.getElementById('status-text');
    const pingText = document.getElementById('ping-text');
    const roleStatusText = document.getElementById('role-status-text');

    // 填充邀请链接
    inviteUrlInput.value = location.href;
    copyBtn.addEventListener('click', () => {
        inviteUrlInput.select();
        document.execCommand('copy');
        copyBtn.textContent = 'COPIED!';
        setTimeout(() => { copyBtn.textContent = 'COPY'; }, 2000);
    });

    // ==========================================
    // 网格与规则常量
    // ==========================================
    const CELL = 20;
    const COLS = canvas.width / CELL;  // 30
    const ROWS = canvas.height / CELL; // 30
    const view = GameFit.view(canvas, { width: COLS * CELL, height: ROWS * CELL, onResize: () => render() });
    const TICK_MS = 110; // 光轨移动节奏：约 9 格/秒，经典 Tron/Snake 的手感

    const DIR_VECTORS = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 }
    };
    const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const VALID_DIRS = new Set(['up', 'down', 'left', 'right']);

    const START_P1 = { x: 5, y: Math.floor(ROWS / 2), dir: 'right' };
    const START_P2 = { x: COLS - 6, y: Math.floor(ROWS / 2), dir: 'left' };

    // 角色身份: 'host' (绿色光轨/P1), 'client' (蓝色光轨/P2)
    let myRole = null;

    // Host 专属：已占用格子集合（双方全部光轨 + 已经飞过的格子），
    // 用 "x,y" 字符串做 key。Client 不维护这份数据——它只负责渲染
    // Host 广播过来的轨迹，不做本地碰撞判定（见下面协议说明）。
    let occupied = new Set();
    let pendingP1Dir = null; // Host 本地键盘输入，下个 tick 生效
    let pendingP2Dir = null; // Client 发来的最新方向请求，下个 tick 生效
    let tickInterval = null;
    let lastSentDir = null; // Client 侧：避免同一方向重复发送

    /**
     * 对局的"干净"初始状态。Host 在 initGame() 里用它重置模拟；Client
     * 在收到 host 的 'start' 消息时用它重新播种本地渲染状态——两边永远
     * 从完全相同的起始格子和朝向开始，不需要互相协商。
     */
    function freshGameState(score) {
        return {
            p1: { x: START_P1.x, y: START_P1.y, dir: START_P1.dir, alive: true, trail: [{ x: START_P1.x, y: START_P1.y }] },
            p2: { x: START_P2.x, y: START_P2.y, dir: START_P2.dir, alive: true, trail: [{ x: START_P2.x, y: START_P2.y }] },
            score: score || { p1: 0, p2: 0 },
            status: 'lobby', // lobby, playing, gameover
            winner: 0 // 0 无, 1, 2, 3 平局
        };
    }

    let gameState = freshGameState();

    // ==========================================
    // 网络层：GameSession（client/scripts/game-session.js）
    // ==========================================
    // 与 Pong 不同：Tron 的同步协议是"每个 tick 增量追加一格"（host 每
    // TICK_MS 广播一次双方的新头部坐标，client 直接 push 进本地 trail
    // 数组），这要求消息不能丢、不能乱序——丢一个 tick client 就会永久
    // 错位。所以这里显式用可靠有序通道 (ordered: true)，而不是
    // GameSession 默认给 Pong 用的 unordered/maxRetransmits:0（那是因为
    // Pong 广播的是可覆盖的全量物理状态，丢一帧换下一帧即可，语义完全
    // 不同，不能照搬）。
    connectionStateText.textContent = '正在连接信号服务器...';

    const session = GameBot.session({
        gameFolder: 'tron',
        dataChannelOptions: { ordered: true },

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
                roleText.innerHTML = `你是 <strong>Host (绿色光轨)</strong>，掌握核心模拟。<br>已就绪，等待对手加入...`;
            } else if (role === 'client') {
                roleText.innerHTML = `你是 <strong>Client (蓝色光轨)</strong>，正在接收游戏画面。<br>等待 Host 开始模拟...`;
            }
        },

        onChannelOpen() {
            overlay.classList.remove('hidden');
            lobbyScreen.classList.add('hidden');
            readyScreen.classList.remove('hidden');
            gameoverScreen.classList.add('hidden');
            disconnectScreen.classList.add('hidden');

            if (myRole === 'host') {
                startBtn.classList.remove('hidden');
                startBtn.disabled = false;
            } else {
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
            clearInterval(tickInterval);

            overlay.classList.remove('hidden');
            lobbyScreen.classList.add('hidden');
            readyScreen.classList.add('hidden');
            gameoverScreen.classList.add('hidden');
            disconnectScreen.classList.remove('hidden');

            statusText.textContent = waitingText;
            statusText.className = 'status-online';
            pingText.textContent = '-- ms';
        },

        onRtt(ms) {
            pingText.textContent = `${ms} ms`;
        },

        onMessage: handleGameData
    });

    function sendGameData(data) {
        session.send(data);
    }

    // ==========================================
    // 输入
    // ==========================================
    const KEY_DIR = {
        ArrowUp: 'up', w: 'up', W: 'up',
        ArrowDown: 'down', s: 'down', S: 'down',
        ArrowLeft: 'left', a: 'left', A: 'left',
        ArrowRight: 'right', d: 'right', D: 'right'
    };

    function requestDirection(dir) {
        if (gameState.status !== 'playing') return;
        if (myRole === 'host') {
            pendingP1Dir = dir;
        } else if (myRole === 'client') {
            if (dir === lastSentDir) return; // 避免按住/重复按键刷屏
            lastSentDir = dir;
            sendGameData({ type: 'dir', dir });
        }
    }

    window.addEventListener('keydown', e => {
        const dir = KEY_DIR[e.key];
        if (dir) requestDirection(dir);
    });

    // 移动端四方向 D-Pad（pointerdown 立即生效，不等 click）
    ['up', 'down', 'left', 'right'].forEach(dir => {
        const btn = document.getElementById('mkey-' + dir);
        if (!btn) return;
        btn.style.touchAction = 'none';
        btn.addEventListener('pointerdown', e => { e.preventDefault(); GameFit.buzz(6); requestDirection(dir); });
    });

    // 滑动转向：在整个舞台上任意位置滑一下即可（一笔里可以连续拐弯）
    const swipeArea = canvas.closest('.gf-box') || canvas;
    let swipe = null;
    swipeArea.addEventListener('pointerdown', e => {
        if (e.target.closest('.overlay')) return;
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    swipeArea.addEventListener('pointermove', e => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        requestDirection(dir);
        swipe.x = e.clientX; swipe.y = e.clientY;
    });
    const endSwipe = e => { if (swipe && e.pointerId === swipe.id) swipe = null; };
    swipeArea.addEventListener('pointerup', endSwipe);
    swipeArea.addEventListener('pointercancel', endSwipe);

    // ==========================================
    // 对局收发协议
    // ==========================================
    function handleGameData(msg) {
        if (msg.type === 'tick') {
            if (myRole !== 'client') return; // Host 自己的模拟已经是权威状态，不需要回灌
            applyTick(msg);
        } else if (msg.type === 'start') {
            gameState = freshGameState(msg.score || gameState.score);
            gameState.status = 'playing';
            lastSentDir = null;
            overlay.classList.add('hidden');
            restartBtn.textContent = 'PLAY AGAIN';
            restartBtn.disabled = false;
            render();
        } else if (msg.type === 'dir') {
            if (myRole === 'host' && VALID_DIRS.has(msg.dir)) {
                pendingP2Dir = msg.dir;
            }
        } else if (msg.type === 'restart-request') {
            if (myRole === 'host') initGame();
        }
    }

    /** Client 侧：把 host 广播的新头部坐标追加进本地 trail 并重绘。 */
    function applyTick(msg) {
        pushIfNew(gameState.p1.trail, msg.p1);
        pushIfNew(gameState.p2.trail, msg.p2);
        gameState.p1.x = msg.p1.x; gameState.p1.y = msg.p1.y; gameState.p1.alive = msg.p1.alive;
        gameState.p2.x = msg.p2.x; gameState.p2.y = msg.p2.y; gameState.p2.alive = msg.p2.alive;
        gameState.status = msg.status;
        gameState.winner = msg.winner;
        gameState.score = msg.score;

        p1ScoreVal.textContent = gameState.score.p1;
        p2ScoreVal.textContent = gameState.score.p2;

        render();
        if (gameState.status === 'gameover') showGameOver();
    }

    function pushIfNew(trail, pos) {
        const last = trail[trail.length - 1];
        if (!last || last.x !== pos.x || last.y !== pos.y) trail.push({ x: pos.x, y: pos.y });
    }

    // ==========================================
    // 大厅 / 开始 / 重开 按钮
    // ==========================================
    lobbyBtn.addEventListener('click', () => {
        location.reload();
    });

    startBtn.addEventListener('click', () => {
        if (myRole === 'host' && gameState.status !== 'playing') {
            initGame();
        }
    });

    restartBtn.addEventListener('click', () => {
        if (myRole === 'host') {
            initGame();
        } else {
            sendGameData({ type: 'restart-request' });
            restartBtn.textContent = 'AWAITING HOST...';
            restartBtn.disabled = true;
        }
    });

    // 1. 初始化/重开一局 (Host 权威模式)——比分跨局累计，直到有一方断线。
    function initGame() {
        gameState = freshGameState(gameState.score);
        gameState.status = 'playing';

        occupied = new Set();
        occupied.add(START_P1.x + ',' + START_P1.y);
        occupied.add(START_P2.x + ',' + START_P2.y);
        pendingP1Dir = null;
        pendingP2Dir = null;

        overlay.classList.add('hidden');
        restartBtn.textContent = 'PLAY AGAIN';
        restartBtn.disabled = false;

        sendGameData({ type: 'start', p1: START_P1, p2: START_P2, score: gameState.score });

        clearInterval(tickInterval);
        tickInterval = setInterval(hostTick, TICK_MS);

        render();
    }

    // ==========================================
    // HOST 模拟 (权威物理/规则判定)
    // ==========================================
    function hostTick() {
        if (gameState.status !== 'playing') return;

        if (GameBot.enabled) botStep();

        // 应用上一帧收到的转向请求；拒绝直接掉头(180°)——经典 Tron/贪吃蛇规则。
        if (pendingP1Dir && pendingP1Dir !== OPPOSITE[gameState.p1.dir]) {
            gameState.p1.dir = pendingP1Dir;
        }
        pendingP1Dir = null;
        if (pendingP2Dir && pendingP2Dir !== OPPOSITE[gameState.p2.dir]) {
            gameState.p2.dir = pendingP2Dir;
        }
        pendingP2Dir = null;

        const v1 = DIR_VECTORS[gameState.p1.dir];
        const v2 = DIR_VECTORS[gameState.p2.dir];
        const n1 = { x: gameState.p1.x + v1.x, y: gameState.p1.y + v1.y };
        const n2 = { x: gameState.p2.x + v2.x, y: gameState.p2.y + v2.y };

        const outOfBounds = p => p.x < 0 || p.x >= COLS || p.y < 0 || p.y >= ROWS;
        const hitsTrail = p => occupied.has(p.x + ',' + p.y);

        let dead1 = outOfBounds(n1) || hitsTrail(n1);
        let dead2 = outOfBounds(n2) || hitsTrail(n2);
        // 双方同时飞进同一个格子：头对头相撞，算平局而不是谁先到谁赢。
        if (!dead1 && !dead2 && n1.x === n2.x && n1.y === n2.y) {
            dead1 = true;
            dead2 = true;
        }

        if (!dead1) {
            gameState.p1.x = n1.x;
            gameState.p1.y = n1.y;
            occupied.add(n1.x + ',' + n1.y);
            gameState.p1.trail.push({ x: n1.x, y: n1.y });
        } else {
            gameState.p1.alive = false;
        }

        if (!dead2) {
            gameState.p2.x = n2.x;
            gameState.p2.y = n2.y;
            occupied.add(n2.x + ',' + n2.y);
            gameState.p2.trail.push({ x: n2.x, y: n2.y });
        } else {
            gameState.p2.alive = false;
        }

        if (dead1 || dead2) {
            gameState.status = 'gameover';
            if (dead1 && dead2) {
                gameState.winner = 3; // 平局
            } else if (dead1) {
                gameState.winner = 2;
                gameState.score.p2 += 1;
            } else {
                gameState.winner = 1;
                gameState.score.p1 += 1;
            }
            p1ScoreVal.textContent = gameState.score.p1;
            p2ScoreVal.textContent = gameState.score.p2;
            broadcastTick();
            showGameOver();
            return;
        }

        broadcastTick();
        render();
    }

    // ==========================================
    // 人机对手（?bot=easy|normal|hard）：蓝色光轨 (p2)
    // ==========================================
    // 简单：只看下一格，偶尔乱拐；普通：洪水填充选空间最大的方向；
    // 困难：洪水填充 + Voronoi 领地（哪些格子我比对手先到），并避开
    // 可能和对手头对头相撞的格子。
    const BOT_LV = GameBot.level || 'normal';
    const inGrid = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
    const free = (x, y, blocked) => inGrid(x, y) && !occupied.has(x + ',' + y) && !(blocked && blocked.has(x + ',' + y));

    function floodCount(sx, sy, blocked, cap) {
        if (!free(sx, sy, blocked)) return 0;
        const seen = new Set([sx + ',' + sy]);
        const q = [[sx, sy]];
        while (q.length && seen.size < cap) {
            const [x, y] = q.shift();
            for (const k in DIR_VECTORS) {
                const nx = x + DIR_VECTORS[k].x, ny = y + DIR_VECTORS[k].y, key = nx + ',' + ny;
                if (!seen.has(key) && free(nx, ny, blocked)) { seen.add(key); q.push([nx, ny]); }
            }
        }
        return seen.size;
    }
    function distMap(sx, sy, blocked) {
        const d = new Map([[sx + ',' + sy, 0]]);
        const q = [[sx, sy]];
        while (q.length) {
            const [x, y] = q.shift();
            const base = d.get(x + ',' + y);
            for (const k in DIR_VECTORS) {
                const nx = x + DIR_VECTORS[k].x, ny = y + DIR_VECTORS[k].y, key = nx + ',' + ny;
                if (!d.has(key) && free(nx, ny, blocked)) { d.set(key, base + 1); q.push([nx, ny]); }
            }
        }
        return d;
    }
    function voronoi(mx, my, ox, oy, blocked) {
        const dm = distMap(mx, my, blocked), dof = distMap(ox, oy, blocked);
        let score = 0;
        dm.forEach((v, key) => { const o = dof.get(key); if (o === undefined || v < o) score++; else if (v > o) score--; });
        return score;
    }

    function botStep() {
        const me = gameState.p2, foe = gameState.p1;
        const opts = Object.keys(DIR_VECTORS).filter(d => d !== OPPOSITE[me.dir]);
        // 对手下一步可能到达的格子（头对头风险）
        const foeNext = new Set();
        for (const k in DIR_VECTORS) {
            if (k === OPPOSITE[foe.dir]) continue;
            foeNext.add((foe.x + DIR_VECTORS[k].x) + ',' + (foe.y + DIR_VECTORS[k].y));
        }
        let best = null, bestScore = -Infinity;
        for (const d of opts) {
            const nx = me.x + DIR_VECTORS[d].x, ny = me.y + DIR_VECTORS[d].y;
            let sc;
            if (!free(nx, ny)) sc = -1e6;
            else if (BOT_LV === 'easy') {
                sc = Math.random() * 10 + (d === me.dir ? 6 : 0);
                // 简单难度只看一步：下一格前方马上是墙也不在意
            } else {
                const blocked = new Set([nx + ',' + ny]);
                const area = floodCount(nx, ny, null, COLS * ROWS);
                sc = area * 10;
                if (BOT_LV === 'hard') {
                    const foeArea = floodCount(foe.x, foe.y, blocked, COLS * ROWS);
                    // 是否和对手处在同一片空间：同区就抢领地，否则只比空间大小
                    const reach = distMap(nx, ny, null);
                    const sameRegion = [...foeNext].some(k => reach.has(k));
                    sc += sameRegion ? voronoi(nx, ny, foe.x, foe.y, blocked) * 6 : (area - foeArea) * 4;
                }
                if (foeNext.has(nx + ',' + ny)) sc -= BOT_LV === 'hard' ? 400 : 150;
                if (d === me.dir) sc += 3;
                sc += Math.random() * (BOT_LV === 'hard' ? 1 : 8);
            }
            if (sc > bestScore) { bestScore = sc; best = d; }
        }
        // 简单难度：偶尔走神，选一个随机方向
        if (BOT_LV === 'easy' && Math.random() < 0.05) {
            const ok = opts.filter(d => free(me.x + DIR_VECTORS[d].x, me.y + DIR_VECTORS[d].y));
            if (ok.length) best = ok[Math.floor(Math.random() * ok.length)];
        }
        if (best && best !== me.dir) GameBot.deliver({ type: 'dir', dir: best });
    }
    GameBot.expose({ state: () => gameState });

    function broadcastTick() {
        sendGameData({
            type: 'tick',
            p1: { x: gameState.p1.x, y: gameState.p1.y, alive: gameState.p1.alive },
            p2: { x: gameState.p2.x, y: gameState.p2.y, alive: gameState.p2.alive },
            status: gameState.status,
            winner: gameState.winner,
            score: gameState.score
        });
    }

    // ==========================================
    // 渲染
    // ==========================================
    function render() {
        view.begin(ctx);
        ctx.fillStyle = '#0a0c10';
        ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        for (let gx = 0; gx <= COLS; gx++) {
            ctx.beginPath();
            ctx.moveTo(gx * CELL, 0);
            ctx.lineTo(gx * CELL, ROWS * CELL);
            ctx.stroke();
        }
        for (let gy = 0; gy <= ROWS; gy++) {
            ctx.beginPath();
            ctx.moveTo(0, gy * CELL);
            ctx.lineTo(COLS * CELL, gy * CELL);
            ctx.stroke();
        }

        drawTrail(gameState.p1.trail, '#00e676', 'rgba(0, 230, 118, 0.5)');
        drawTrail(gameState.p2.trail, '#29b6ff', 'rgba(41, 182, 255, 0.5)');
    }

    function drawTrail(trail, color, glow) {
        if (!trail.length) return;
        ctx.fillStyle = color;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 8;
        trail.forEach(cell => {
            ctx.fillRect(cell.x * CELL + 1, cell.y * CELL + 1, CELL - 2, CELL - 2);
        });
        ctx.shadowBlur = 0;
    }

    // 展示对局结束画面
    function showGameOver() {
        clearInterval(tickInterval);

        overlay.classList.remove('hidden');
        lobbyScreen.classList.add('hidden');
        readyScreen.classList.add('hidden');
        disconnectScreen.classList.add('hidden');
        gameoverScreen.classList.remove('hidden');

        finalScore.textContent = `${gameState.score.p1} - ${gameState.score.p2}`;

        if (gameState.winner === 3) {
            winLossTitle.textContent = 'DRAW';
            winLossTitle.className = 'neon-text';
        } else if (gameState.winner === 1) {
            if (myRole === 'host') {
                winLossTitle.textContent = 'VICTORY';
                winLossTitle.className = 'neon-text';
            } else {
                winLossTitle.textContent = 'DEFEAT';
                winLossTitle.className = 'danger-text';
            }
        } else if (gameState.winner === 2) {
            if (myRole === 'client') {
                winLossTitle.textContent = 'VICTORY';
                winLossTitle.className = 'neon-text';
            } else {
                winLossTitle.textContent = 'DEFEAT';
                winLossTitle.className = 'danger-text';
            }
        }
    }

    // 首帧渲染（空场地 + 起始位置提示）
    render();
});
