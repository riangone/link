document.addEventListener('DOMContentLoaded', () => {
    // 确保 URL 中有 Room ID
    if (!location.hash || location.hash.length <= 1) {
        const randomRoomId = Math.random().toString(36).substring(2, 9);
        location.hash = 'room-' + randomRoomId;
    }

    // 如果是通过好友系统的"邀请对战"跳转过来的（见 friends-ui.js
    // _onPongMatchReady），URL 上会带对方昵称，用来把通用的 "WAITING FOR
    // PEER" 换成更明确的提示；没有这个参数（比如手动分享链接）时行为不变。
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

    // 移动端控制
    const mobileControls = document.getElementById('mobile-controls');
    const mkeyUp = document.getElementById('mkey-up');
    const mkeyDown = document.getElementById('mkey-down');

    // 屏幕方向控制
    const orientationBtn = document.getElementById('orientation-btn');
    const orientationLabel = document.getElementById('orientation-label');
    const orientationHint = document.getElementById('orientation-hint');
    const canvasWrapper = canvas.parentElement;

    // 填充邀请链接
    inviteUrlInput.value = location.href;
    copyBtn.addEventListener('click', () => {
        inviteUrlInput.select();
        document.execCommand('copy');
        copyBtn.textContent = 'COPIED!';
        setTimeout(() => { copyBtn.textContent = 'COPY'; }, 2000);
    });

    // 游戏尺寸与常数
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    const PADDLE_WIDTH = 12;
    const PADDLE_HEIGHT = 80;
    const BALL_RADIUS = 8;
    const WINNING_SCORE = 5;

    // 屏幕方向：物理演算坐标系(WIDTH x HEIGHT，横长)永远不变，
    // 纵向模式只是把 canvas 的物理像素尺寸对调，并在渲染时整体旋转
    // -90°投影上去——碰撞/得分等逻辑完全不用感知方向，只是"从哪个
    // 角度看"这盘棋。
    // 偏好：'portrait' | 'landscape' | 未设置(=auto，跟随屏幕方向)。
    // 旋转/高清缩放交给 GameFit.view（scripts/game-fit.js）。
    const storedOrientation = localStorage.getItem('pong-orientation');
    let isPortrait = false; // 当前是否以纵向显示（由 view 回调更新）

    // 游戏状态定义
    let gameState = {
        ball: { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 },
        p1: { y: HEIGHT / 2 - PADDLE_HEIGHT / 2 },
        p2: { y: HEIGHT / 2 - PADDLE_HEIGHT / 2 },
        score: { p1: 0, p2: 0 },
        status: 'lobby', // lobby, ready, playing, gameover
        winner: 0 // 1 or 2
    };

    // 角色身份: 'host' (左パドル), 'client' (右パドル), 或 'spectator'
    let myRole = null;

    let gameLoopInterval = null;
    let netSendInterval = null;

    // 本地输入控制状态
    let keys = {};
    let touchMovingUp = false;
    let touchMovingDown = false;

    // 键盘监听
    window.addEventListener('keydown', e => { keys[e.key] = true; });
    window.addEventListener('keyup', e => { keys[e.key] = false; });

    // 移动端按键：纵向时 ◀ ▶ 对应挡板沿逻辑 y 轴移动；client 纵向时画面
    // 转的是 +90°（让自己永远在下方），屏幕左右与逻辑 y 方向相反，需要对调。
    function screenFlip() { return view.rotation === 90; }
    GameFit.touchButtons(mkeyUp.parentElement, (action, down) => {
        const first = action === 'up';
        const up = screenFlip() ? !first : first;
        if (up) touchMovingUp = down; else touchMovingDown = down;
    });
    mkeyUp.dataset.action = 'up';
    mkeyDown.dataset.action = 'down';

    const view = GameFit.view(canvas, {
        width: WIDTH, height: HEIGHT,
        rotate: storedOrientation === 'portrait' ? 'portrait' : storedOrientation === 'landscape' ? 'landscape' : 'auto',
        // 纵向时让自己的挡板在屏幕下方：host(左挡板) 转 -90°，client(右挡板) 转 +90°
        turn: () => (myRole === 'client' ? 90 : -90),
        onResize: () => { updateOrientationUi(); render(); }
    });

    function updateOrientationUi() {
        isPortrait = view.rotation !== 0;
        canvasWrapper.classList.toggle('portrait', isPortrait);
        orientationBtn.setAttribute('aria-pressed', String(isPortrait));
        orientationLabel.textContent = isPortrait ? '横向模式' : '纵向模式';
        orientationHint.textContent = isPortrait
            ? '当前模式：纵向（拖拽/方向键对应左右移动）'
            : '当前模式：横向（拖拽/方向键对应上下移动）';
        mkeyUp.textContent = isPortrait ? '◀' : '▲';
        mkeyDown.textContent = isPortrait ? '▶' : '▼';
    }

    orientationBtn.addEventListener('click', () => {
        const next = isPortrait ? 'landscape' : 'portrait';
        localStorage.setItem('pong-orientation', next);
        view.setMode(next);
    });

    // 鼠标/触屏拖拽：整个舞台区域（画布外的留白也算）都能拖，手指不必压在挡板上。
    // 纵向时 toLogical 已经把屏幕坐标转回逻辑坐标，这里只取逻辑 y。
    function handlePointerMove(clientX, clientY) {
        if (gameState.status !== 'playing') return;
        const p = view.toLogical(clientX, clientY);
        const targetY = p.y - PADDLE_HEIGHT / 2;
        const clampedY = Math.max(0, Math.min(HEIGHT - PADDLE_HEIGHT, targetY));

        if (myRole === 'host') {
            gameState.p1.y = clampedY;
        } else if (myRole === 'client') {
            gameState.p2.y = clampedY;
        }
    }

    const dragArea = canvasWrapper.closest('.gf-box') || canvas;
    dragArea.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) handlePointerMove(e.clientX, e.clientY);
    });
    dragArea.addEventListener('pointerdown', e => {
        if (e.target.closest('.overlay')) return;
        handlePointerMove(e.clientX, e.clientY);
    });

    // ==========================================
    // 网络层：GameSession（client/scripts/game-session.js）
    // ==========================================
    // 建连/信令/TURN时序竞态/断线宽限/心跳这些与具体游戏规则无关的部分，
    // 已经抽取进了通用的 GameSession，pong 这里只需要通过回调把网络事件
    // 翻译成这个页面自己的 UI 状态，以及定义 state/input 这些 Pong 专属的
    // 消息语义。见 game-session.js 顶部注释了解抽取原因。
    //
    // 数据通道用无序+不重传 (ordered:false, maxRetransmits:0)：对局物理
    // 状态是高频覆盖式广播，丢一帧不如等一个过期的重传帧。
    connectionStateText.textContent = '正在连接信号服务器...';

    const session = GameBot.session({
        gameFolder: 'pong',
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

        // 角色分配（host 左挡板 / client 右挡板）
        onRole(role) {
            myRole = role;
            view.refit(); // client 纵向时换成 +90° 旋转，让自己的挡板在下方
            roleStatusText.textContent = role.toUpperCase();
            if (role === 'host') {
                roleText.innerHTML = `你是 <strong>Host (左侧挡板)</strong>，掌握核心物理模拟。<br>已就绪，等待对手加入...`;
            } else if (role === 'client') {
                roleText.innerHTML = `你是 <strong>Client (右侧挡板)</strong>，正在接收游戏画面。<br>等待 Host 开始模拟...`;
            }
        },

        // 数据通道已打开：切换到"对手已连接"界面
        onChannelOpen() {
            console.log('WebRTC Data Channel 已打开');

            overlay.classList.remove('hidden');
            lobbyScreen.classList.add('hidden');
            readyScreen.classList.remove('hidden');
            gameoverScreen.classList.add('hidden');
            disconnectScreen.classList.add('hidden');

            if (myRole === 'host') {
                startBtn.classList.remove('hidden');
                startBtn.disabled = false;
            } else {
                startBtn.classList.add('hidden'); // Client 只能等待 Host 点击启动
            }
        },

        // ICE 已连接（含断线自愈后再次触发）
        onPeerConnected() {
            statusText.textContent = 'P2P ESTABLISHED';
            statusText.className = 'status-online';
        },

        // 'disconnected' 宽限期内：可能自愈，先提示，不立即判对手离线
        onPeerReconnecting() {
            statusText.textContent = 'RECONNECTING…';
            statusText.className = 'status-offline';
        },

        // 对手断开连接时的处理（GameSession 已经关闭了底层 WebRTC 连接，
        // 这里只负责这个游戏自己的 UI/循环收尾）
        onPeerDisconnected() {
            console.warn('检测到对手已断开连接');
            clearInterval(gameLoopInterval);
            clearInterval(netSendInterval);

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

    // 发送游戏网络数据
    function sendGameData(data) {
        session.send(data);
    }

    // 处理对局中收到的 P2P 数据
    function handleGameData(msg) {
        if (msg.type === 'state') {
            // Client 接收 Host 广播的物理状态
            if (myRole === 'client') {
                gameState.ball = msg.ball;
                gameState.p1 = msg.p1;
                // 用本地 Y 轴更新避免感觉卡顿，或者也可以做缓动同步
                // gameState.p2 = msg.p2;
                gameState.score = msg.score;
                gameState.status = msg.status;
                gameState.winner = msg.winner;

                // 同步更新 UI 得分
                p1ScoreVal.textContent = gameState.score.p1;
                p2ScoreVal.textContent = gameState.score.p2;

                if (gameState.status === 'playing') {
                    overlay.classList.add('hidden');
                } else if (gameState.status === 'gameover') {
                    showGameOver();
                }
            }
        } else if (msg.type === 'input') {
            // Host 接收 Client 发送的右挡板 Y 坐标
            if (myRole === 'host') {
                gameState.p2.y = msg.y;
            }
        } else if (msg.type === 'start') {
            // Client 收到 Host 启动游戏的信号
            gameState.status = 'playing';
            overlay.classList.add('hidden');
            startClientGameLoop();
        } else if (msg.type === 'restart-request') {
            // 对手请求再来一局，如果是 Host，则重新初始化
            if (myRole === 'host') {
                initGame();
                sendGameData({ type: 'start' });
            }
        }
    }

    // 点击返回大厅
    lobbyBtn.addEventListener('click', () => {
        location.reload();
    });

    // 开始游戏模拟 (仅 Host 触发)
    startBtn.addEventListener('click', () => {
        if (myRole === 'host' && gameState.status !== 'playing') {
            initGame();
            sendGameData({ type: 'start' });
        }
    });

    // 重新开始游戏 (Host 触发或 Client 发送重试请求)
    restartBtn.addEventListener('click', () => {
        if (myRole === 'host') {
            initGame();
            sendGameData({ type: 'start' });
        } else {
            sendGameData({ type: 'restart-request' });
            restartBtn.textContent = 'AWAITING HOST...';
            restartBtn.disabled = true;
        }
    });

    // 1. 初始化对局 (Host 权威模式)
    function initGame() {
        // 重置比分和球位置
        gameState.score.p1 = 0;
        gameState.score.p2 = 0;
        gameState.status = 'playing';
        gameState.winner = 0;

        p1ScoreVal.textContent = '0';
        p2ScoreVal.textContent = '0';

        resetBall(1); // 1 = 飞向 Client，-1 = 飞向 Host

        overlay.classList.add('hidden');

        // 重置按钮文言
        restartBtn.textContent = 'PLAY AGAIN';
        restartBtn.disabled = false;

        // 启动主循环 (物理模拟: 60FPS)
        clearInterval(gameLoopInterval);
        gameLoopInterval = setInterval(hostGameLoop, 1000 / 60);

        // 启动网络状态广播 (30Hz，减少数据包拥堵)
        clearInterval(netSendInterval);
        netSendInterval = setInterval(broadcastState, 1000 / 30);
    }

    // 2. Client 端的本地循环
    function startClientGameLoop() {
        clearInterval(gameLoopInterval);
        // Client 端只需要以 60FPS 进行渲染和极低频的输入捕获
        gameLoopInterval = setInterval(clientGameLoop, 1000 / 60);

        // 启动网络输入发送 (60Hz，高频率同步操作挡板)
        clearInterval(netSendInterval);
        netSendInterval = setInterval(sendInputToHost, 1000 / 60);

        overlay.classList.add('hidden');
        restartBtn.textContent = 'PLAY AGAIN';
        restartBtn.disabled = false;
    }

    // 重置球到中心点
    function resetBall(direction) {
        gameState.ball.x = WIDTH / 2;
        gameState.ball.y = HEIGHT / 2;

        // 赋予基础球速，根据方向决定发球人
        gameState.ball.vx = direction * 4.5;
        gameState.ball.vy = (Math.random() * 2 - 1) * 3; // 随机垂直斜角
    }

    // ==========================================
    // HOST GAME LOOP (物理计算与主模拟)
    // ==========================================
    function hostGameLoop() {
        if (gameState.status !== 'playing') return;

        // 1. Host 本地左挡板控制
        const paddleSpeed = 6;
        if (keys['w'] || keys['W'] || keys['ArrowUp'] || touchMovingUp) {
            gameState.p1.y = Math.max(0, gameState.p1.y - paddleSpeed);
        }
        if (keys['s'] || keys['S'] || keys['ArrowDown'] || touchMovingDown) {
            gameState.p1.y = Math.min(HEIGHT - PADDLE_HEIGHT, gameState.p1.y + paddleSpeed);
        }

        // 1b. 人机模式：右挡板由程序控制（等同于 Client 发来的 input）
        if (GameBot.enabled) botStep();

        // 2. 物理运动：更新球坐标
        const ball = gameState.ball;
        ball.x += ball.vx;
        ball.y += ball.vy;

        // 3. 上下边界的反弹
        if (ball.y - BALL_RADIUS <= 0) {
            ball.y = BALL_RADIUS;
            ball.vy = -ball.vy;
        } else if (ball.y + BALL_RADIUS >= HEIGHT) {
            ball.y = HEIGHT - BALL_RADIUS;
            ball.vy = -ball.vy;
        }

        // 4. 左侧挡板碰撞 (P1)
        if (ball.vx < 0 && ball.x - BALL_RADIUS <= 20 + PADDLE_WIDTH && ball.x >= 20) {
            if (ball.y >= gameState.p1.y && ball.y <= gameState.p1.y + PADDLE_HEIGHT) {
                // 计算碰撞偏移点，中心为 0，顶部为 -1，底部为 1
                const relativeHit = ((ball.y - gameState.p1.y) / PADDLE_HEIGHT) * 2 - 1;
                ball.vx = -ball.vx * 1.08; // 每次碰撞微微加速
                ball.vy = relativeHit * 4.5; // 根据落点增加垂直分速度
                ball.x = 20 + PADDLE_WIDTH + BALL_RADIUS; // 防穿透
            }
        }

        // 5. 右侧挡板碰撞 (P2)
        const p2X = WIDTH - 20 - PADDLE_WIDTH;
        if (ball.vx > 0 && ball.x + BALL_RADIUS >= p2X && ball.x <= p2X + PADDLE_WIDTH) {
            if (ball.y >= gameState.p2.y && ball.y <= gameState.p2.y + PADDLE_HEIGHT) {
                const relativeHit = ((ball.y - gameState.p2.y) / PADDLE_HEIGHT) * 2 - 1;
                ball.vx = -ball.vx * 1.08; // 每次碰撞微微加速
                ball.vy = relativeHit * 4.5;
                ball.x = p2X - BALL_RADIUS; // 防穿透
            }
        }

        // 6. 得分判定
        if (ball.x - BALL_RADIUS < 0) {
            // P2 得分
            gameState.score.p2 += 1;
            p2ScoreVal.textContent = gameState.score.p2;
            checkMatchEnd(1); // 发球权归 P1
        } else if (ball.x + BALL_RADIUS > WIDTH) {
            // P1 得分
            gameState.score.p1 += 1;
            p1ScoreVal.textContent = gameState.score.p1;
            checkMatchEnd(-1); // 发球权归 P2
        }

        // 7. 本地渲染刷新
        render();
    }

    // ==========================================
    // 人机对手（?bot=easy|normal|hard）：扮演右挡板 Client
    // ==========================================
    // 预测球到达右挡板 x 时的 y（含上下墙反弹），再按难度加反应延迟、
    // 落点误差和挡板速度上限；困难难度会故意用挡板边缘击球打出大角度。
    const BOT = {
        speed: GameBot.pick({ easy: 3.6, normal: 5.2, hard: 7.5 }),
        err: GameBot.pick({ easy: 46, normal: 22, hard: 6 }),
        react: GameBot.pick({ easy: 22, normal: 12, hard: 4 }),   // 帧
        angle: GameBot.pick({ easy: 0, normal: 0.25, hard: 0.7 })   // 用边缘击球的力度
    };
    const bot = { target: HEIGHT / 2, timer: 0, lastVx: 0 };

    function predictBallY(xTarget) {
        const b = gameState.ball;
        if (b.vx <= 0) return null;
        let x = b.x, y = b.y, vy = b.vy;
        const t = (xTarget - x) / b.vx;
        y += vy * t;
        const lo = BALL_RADIUS, hi = HEIGHT - BALL_RADIUS, span = hi - lo;
        // 把反弹展开成锯齿波折返
        let m = (y - lo) % (2 * span);
        if (m < 0) m += 2 * span;
        return lo + (m <= span ? m : 2 * span - m);
    }

    function botStep() {
        const b = gameState.ball;
        const p2X = WIDTH - 20 - PADDLE_WIDTH;
        // 球改变方向（被对手击回）后重新"看"一次：反应延迟 + 随机误差
        if (Math.sign(b.vx) !== Math.sign(bot.lastVx)) {
            bot.lastVx = b.vx;
            bot.timer = BOT.react;
            bot.err = GameBot.gauss() * BOT.err;
            bot.edge = (Math.random() < 0.5 ? -1 : 1) * BOT.angle * (PADDLE_HEIGHT / 2 - 6);
        }
        if (bot.timer > 0) { bot.timer--; }
        else if (b.vx > 0) {
            const py = predictBallY(p2X - BALL_RADIUS);
            bot.target = py + bot.err + (bot.edge || 0);
        } else {
            // 球飞向对方：慢慢回中
            bot.target = HEIGHT / 2 + (b.y - HEIGHT / 2) * 0.3;
        }
        const center = gameState.p2.y + PADDLE_HEIGHT / 2;
        const d = bot.target - center;
        const step = Math.max(-BOT.speed, Math.min(BOT.speed, d));
        const y = Math.max(0, Math.min(HEIGHT - PADDLE_HEIGHT, gameState.p2.y + (Math.abs(d) > 2 ? step : 0)));
        GameBot.deliver({ type: 'input', y });
    }
    GameBot.expose({ state: () => gameState });

    // Host 判定比赛结束
    function checkMatchEnd(nextServeDir) {
        if (gameState.score.p1 >= WINNING_SCORE) {
            gameState.status = 'gameover';
            gameState.winner = 1;
            showGameOver();
            broadcastState();
        } else if (gameState.score.p2 >= WINNING_SCORE) {
            gameState.status = 'gameover';
            gameState.winner = 2;
            showGameOver();
            broadcastState();
        } else {
            resetBall(nextServeDir);
        }
    }

    // Host 广播全量状态
    function broadcastState() {
        sendGameData({
            type: 'state',
            ball: gameState.ball,
            p1: gameState.p1,
            p2: gameState.p2,
            score: gameState.score,
            status: gameState.status,
            winner: gameState.winner
        });
    }

    // ==========================================
    // CLIENT GAME LOOP (接收更新与渲染)
    // ==========================================
    function clientGameLoop() {
        // Client 本地只响应用户上下控制并更新本地的 P2 位置，从而消除输入延迟
        const paddleSpeed = 6;
        if (keys['w'] || keys['W'] || keys['ArrowUp'] || touchMovingUp) {
            gameState.p2.y = Math.max(0, gameState.p2.y - paddleSpeed);
        }
        if (keys['s'] || keys['S'] || keys['ArrowDown'] || touchMovingDown) {
            gameState.p2.y = Math.min(HEIGHT - PADDLE_HEIGHT, gameState.p2.y + paddleSpeed);
        }

        // 本地渲染
        render();
    }

    // Client 发送输入给 Host
    function sendInputToHost() {
        sendGameData({
            type: 'input',
            y: gameState.p2.y
        });
    }

    // ==========================================
    // 渲染系统 (Render Engine)
    // ==========================================
    function render() {
        ctx.save();
        // 逻辑坐标(WIDTH x HEIGHT，横长)→ 设备像素；纵向时 view 会整体旋转 ±90°
        view.begin(ctx);

        // 清空画布
        ctx.fillStyle = '#0a0c10';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // 绘制中线 (虚线风格)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 15]);
        ctx.beginPath();
        ctx.moveTo(WIDTH / 2, 0);
        ctx.lineTo(WIDTH / 2, HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]); // 还原

        // 绘制左挡板 (P1 - 荧光绿，Host)
        ctx.fillStyle = '#00e676';
        ctx.shadowColor = 'rgba(0, 230, 118, 0.4)';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.roundRect(20, gameState.p1.y, PADDLE_WIDTH, PADDLE_HEIGHT, 4);
        ctx.fill();

        // 绘制右挡板 (P2 - 霓虹粉，Client)
        ctx.fillStyle = '#ff2a5f';
        ctx.shadowColor = 'rgba(255, 42, 95, 0.4)';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.roundRect(WIDTH - 20 - PADDLE_WIDTH, gameState.p2.y, PADDLE_WIDTH, PADDLE_HEIGHT, 4);
        ctx.fill();

        // 绘制球 (霓虹球，带有荧光外发光)
        if (gameState.status === 'playing') {
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(gameState.ball.x, gameState.ball.y, BALL_RADIUS, 0, Math.PI * 2);
            ctx.fill();
        }

        // 重置影子模糊 (避免影响后续绘制)
        ctx.shadowBlur = 0;

        ctx.restore(); // 还原 isPortrait 时施加的旋转/平移变换
    }

    // 展示对局结束画面
    function showGameOver() {
        clearInterval(gameLoopInterval);
        clearInterval(netSendInterval);

        overlay.classList.remove('hidden');
        lobbyScreen.classList.add('hidden');
        readyScreen.classList.add('hidden');
        disconnectScreen.classList.add('hidden');
        gameoverScreen.classList.remove('hidden');

        finalScore.textContent = `${gameState.score.p1} - ${gameState.score.p2}`;

        if (gameState.winner === 1) {
            // P1 获胜
            if (myRole === 'host') {
                winLossTitle.textContent = 'VICTORY';
                winLossTitle.className = 'neon-text';
            } else {
                winLossTitle.textContent = 'DEFEAT';
                winLossTitle.className = 'danger-text';
            }
        } else if (gameState.winner === 2) {
            // P2 获胜
            if (myRole === 'client') {
                winLossTitle.textContent = 'VICTORY';
                winLossTitle.className = 'neon-text';
            } else {
                winLossTitle.textContent = 'DEFEAT';
                winLossTitle.className = 'danger-text';
            }
        }
    }

    // 首帧：应用当前方向文案并渲染
    updateOrientationUi();
    render();
});
