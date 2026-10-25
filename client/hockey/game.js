document.addEventListener('DOMContentLoaded', () => {
    // 确保 URL 中有 Room ID
    if (!location.hash || location.hash.length <= 1) {
        const randomRoomId = Math.random().toString(36).substring(2, 9);
        location.hash = 'room-' + randomRoomId;
    }

    const opponentName = new URLSearchParams(location.search).get('opponent') || '';
    const waitingText = opponentName ? `WAITING FOR ${opponentName.toUpperCase()}` : 'WAITING FOR PEER';

    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    // UI 元素
    const p1ScoreVal = document.getElementById('p1-score');
    const p2ScoreVal = document.getElementById('p2-score');
    const p1Label = document.getElementById('p1-label');
    const p2Label = document.getElementById('p2-label');
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
    // 场地与物理常量（规范坐标系：Host 在下半场，Client 在上半场）
    // ==========================================
    const WIDTH = canvas.width;        // 440
    const HEIGHT = canvas.height;      // 660
    const GOAL_WIDTH = 150;
    const GOAL_X1 = (WIDTH - GOAL_WIDTH) / 2;
    const GOAL_X2 = GOAL_X1 + GOAL_WIDTH;

    const MALLET_RADIUS = 26;
    const PUCK_RADIUS = 15;
    const WINNING_SCORE = 5;

    const FRICTION = 0.993;
    const MIN_HIT_SPEED = 7.2;
    const MAX_PUCK_SPEED = 16.5;
    const KEY_MOVE_SPEED = 6.5;
    const SUBSTEPS = 2;

    let myRole = null; // 'host' | 'client'
    let gameLoopInterval = null;
    let netSendInterval = null;

    // 键盘状态
    const keys = {};
    window.addEventListener('keydown', e => { keys[e.key] = true; });
    window.addEventListener('keyup', e => { keys[e.key] = false; });

    // 冰球残影轨迹（仅本地视觉渲染）
    let puckTrail = [];
    let goalFlashTimer = 0;

    function createInitialState(score) {
        return {
            puck: { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 },
            // Host (p1) 规范坐标位于下半场 (y > HEIGHT/2)
            p1: { x: WIDTH / 2, y: HEIGHT - 90, vx: 0, vy: 0 },
            // Client (p2) 规范坐标位于上半场 (y < HEIGHT/2)
            p2: { x: WIDTH / 2, y: 90, vx: 0, vy: 0 },
            score: score || { p1: 0, p2: 0 },
            status: 'lobby', // lobby, playing, gameover
            winner: 0        // 1 (host) or 2 (client)
        };
    }

    let gameState = createInitialState();
    let prevP1 = { x: gameState.p1.x, y: gameState.p1.y };
    let prevP2 = { x: gameState.p2.x, y: gameState.p2.y };

    // ==========================================
    // 主视角镜像变换（Perspective Mirroring）
    // ==========================================
    // 无论 Host 还是 Client，在自己的屏幕上永远处于下半场（守下方球门，攻上方球门）。
    // Host 的屏幕坐标 === 规范坐标；Client 的屏幕坐标与规范坐标关于球台中心旋转 180°。
    function toCanonical(viewX, viewY) {
        if (myRole === 'client') {
            return { x: WIDTH - viewX, y: HEIGHT - viewY };
        }
        return { x: viewX, y: viewY };
    }

    function toView(canonX, canonY) {
        if (myRole === 'client') {
            return { x: WIDTH - canonX, y: HEIGHT - canonY };
        }
        return { x: canonX, y: canonY };
    }

    // 限制本地玩家球柄在视图下半场 [HEIGHT/2 + MALLET_RADIUS, HEIGHT - MALLET_RADIUS]
    function clampViewMallet(vx, vy) {
        const x = Math.max(MALLET_RADIUS, Math.min(WIDTH - MALLET_RADIUS, vx));
        const y = Math.max(HEIGHT / 2 + MALLET_RADIUS, Math.min(HEIGHT - MALLET_RADIUS, vy));
        return { x, y };
    }

    // 球台本身是纵向的；横屏（电脑、横握手机）时整体旋转 90°，让球台横着铺满屏幕
    const view = GameFit.view(canvas, { width: WIDTH, height: HEIGHT, rotate: 'auto', onResize: () => render() });

    // 触屏时球柄显示在手指上方 TOUCH_LIFT 个逻辑单位，手指不会挡住球柄；
    // 拖动区域是整个舞台（画布外的留白也能拖），超出范围自动夹紧。
    const TOUCH_LIFT = 46;
    function handlePointer(clientX, clientY, isTouch) {
        if (gameState.status !== 'playing') return;
        const lp = view.toLogical(clientX, clientY);
        const rawViewX = lp.x;
        const rawViewY = lp.y - (isTouch ? TOUCH_LIFT : 0);
        const clampedView = clampViewMallet(rawViewX, rawViewY);
        const canon = toCanonical(clampedView.x, clampedView.y);

        if (myRole === 'host') {
            gameState.p1.x = canon.x;
            gameState.p1.y = canon.y;
        } else if (myRole === 'client') {
            gameState.p2.x = canon.x;
            gameState.p2.y = canon.y;
        }
    }

    const dragArea = canvas.closest('.gf-box') || canvas;
    dragArea.addEventListener('pointermove', e => {
        if (e.pointerType === 'mouse' || e.buttons) handlePointer(e.clientX, e.clientY, e.pointerType === 'touch');
    });
    dragArea.addEventListener('pointerdown', e => {
        if (e.target.closest('.overlay')) return;
        if (e.pointerType === 'touch') e.preventDefault();
        handlePointer(e.clientX, e.clientY, e.pointerType === 'touch');
    });

    function applyKeyboardMovement() {
        if (gameState.status !== 'playing' || !myRole) return;
        let dx = 0;
        let dy = 0;
        if (keys['ArrowUp'] || keys['w'] || keys['W']) dy -= KEY_MOVE_SPEED;
        if (keys['ArrowDown'] || keys['s'] || keys['S']) dy += KEY_MOVE_SPEED;
        if (keys['ArrowLeft'] || keys['a'] || keys['A']) dx -= KEY_MOVE_SPEED;
        if (keys['ArrowRight'] || keys['d'] || keys['D']) dx += KEY_MOVE_SPEED;
        if (dx === 0 && dy === 0) return;
        // 方向键按「屏幕方向」理解：球台旋转显示时换算回球台坐标
        const sv = view.screenVec(dx, dy);
        dx = sv.x; dy = sv.y;

        const me = myRole === 'host' ? gameState.p1 : gameState.p2;
        const curView = toView(me.x, me.y);
        const nextView = clampViewMallet(curView.x + dx, curView.y + dy);
        const nextCanon = toCanonical(nextView.x, nextView.y);
        me.x = nextCanon.x;
        me.y = nextCanon.y;
    }

    // ==========================================
    // 网络层：GameSession（不可靠无序低延迟通道）
    // ==========================================
    connectionStateText.textContent = '正在连接信号服务器...';

    const session = GameBot.session({
        gameFolder: 'hockey',
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
                p1Label.textContent = 'P1 (YOU)';
                p2Label.textContent = 'P2 (OPPONENT)';
                roleText.innerHTML = `你是 <strong>Host (翡翠绿球柄)</strong>，掌握核心物理模拟。<br>已就绪，点击下方按钮开始对局！`;
            } else if (role === 'client') {
                p1Label.textContent = 'P1 (HOST)';
                p2Label.textContent = 'P2 (YOU)';
                roleText.innerHTML = `你是 <strong>Client (霓虹蓝球柄)</strong>，已启用主视角镜像。<br>等待 Host 点击开始对局...`;
            }
            render();
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

    function sendGameData(data) {
        session.send(data);
    }

    function handleGameData(msg) {
        if (msg.type === 'state') {
            if (myRole === 'client') {
                gameState.puck = msg.puck;
                gameState.p1 = msg.p1;
                gameState.score = msg.score;
                gameState.status = msg.status;
                gameState.winner = msg.winner;

                p1ScoreVal.textContent = gameState.score.p1;
                p2ScoreVal.textContent = gameState.score.p2;

                if (gameState.status === 'playing') {
                    overlay.classList.add('hidden');
                } else if (gameState.status === 'gameover') {
                    showGameOver();
                }
            }
        } else if (msg.type === 'input') {
            if (myRole === 'host' && typeof msg.x === 'number' && typeof msg.y === 'number') {
                // 校验并限制在 Client 的规范上半场
                gameState.p2.x = Math.max(MALLET_RADIUS, Math.min(WIDTH - MALLET_RADIUS, msg.x));
                gameState.p2.y = Math.max(MALLET_RADIUS, Math.min(HEIGHT / 2 - MALLET_RADIUS, msg.y));
            }
        } else if (msg.type === 'start') {
            gameState = createInitialState(msg.score || { p1: 0, p2: 0 });
            gameState.status = 'playing';
            p1ScoreVal.textContent = gameState.score.p1;
            p2ScoreVal.textContent = gameState.score.p2;
            puckTrail = [];
            overlay.classList.add('hidden');
            restartBtn.textContent = 'PLAY AGAIN';
            restartBtn.disabled = false;
            startClientLoop();
        } else if (msg.type === 'restart-request') {
            if (myRole === 'host') {
                initGame();
                sendGameData({ type: 'start', score: gameState.score });
            }
        }
    }

    // ==========================================
    // 按钮事件与对局生命周期
    // ==========================================
    lobbyBtn.addEventListener('click', () => {
        location.reload();
    });

    startBtn.addEventListener('click', () => {
        if (myRole === 'host' && gameState.status !== 'playing') {
            initGame();
            sendGameData({ type: 'start', score: gameState.score });
        }
    });

    restartBtn.addEventListener('click', () => {
        if (myRole === 'host') {
            initGame();
            sendGameData({ type: 'start', score: gameState.score });
        } else {
            sendGameData({ type: 'restart-request' });
            restartBtn.textContent = 'AWAITING HOST...';
            restartBtn.disabled = true;
        }
    });

    function initGame() {
        gameState = createInitialState({ p1: 0, p2: 0 });
        gameState.status = 'playing';
        puckTrail = [];

        p1ScoreVal.textContent = '0';
        p2ScoreVal.textContent = '0';

        resetPuck(Math.random() < 0.5 ? -1 : 1);

        overlay.classList.add('hidden');
        restartBtn.textContent = 'PLAY AGAIN';
        restartBtn.disabled = false;

        clearInterval(gameLoopInterval);
        gameLoopInterval = setInterval(hostGameLoop, 1000 / 60);

        clearInterval(netSendInterval);
        netSendInterval = setInterval(broadcastState, 1000 / 30);
    }

    function startClientLoop() {
        clearInterval(gameLoopInterval);
        gameLoopInterval = setInterval(() => {
            if (gameState.status === 'playing') {
                applyKeyboardMovement();
                updateTrail();
                render();
            }
        }, 1000 / 60);

        clearInterval(netSendInterval);
        netSendInterval = setInterval(() => {
            if (gameState.status === 'playing') {
                sendGameData({
                    type: 'input',
                    x: Math.round(gameState.p2.x * 10) / 10,
                    y: Math.round(gameState.p2.y * 10) / 10
                });
            }
        }, 1000 / 35);
    }

    // dirY: -1 发向 P2(上半场)，1 发向 P1(下半场)
    function resetPuck(dirY) {
        gameState.puck.x = WIDTH / 2;
        gameState.puck.y = HEIGHT / 2;
        const angle = (Math.random() - 0.5) * 0.7; // 轻微随机偏角
        const speed = 5.5;
        gameState.puck.vx = Math.sin(angle) * speed;
        gameState.puck.vy = Math.cos(angle) * speed * dirY;
        puckTrail = [];
    }

    // ==========================================
    // Host 权威物理引擎 (60 FPS, 2x Sub-stepping)
    // ==========================================
    function hostGameLoop() {
        if (gameState.status !== 'playing') return;

        applyKeyboardMovement();
        if (GameBot.enabled) botStep();

        // 计算球柄瞬时速度（用于动量传递）
        gameState.p1.vx = Math.max(-18, Math.min(18, gameState.p1.x - prevP1.x));
        gameState.p1.vy = Math.max(-18, Math.min(18, gameState.p1.y - prevP1.y));
        prevP1.x = gameState.p1.x;
        prevP1.y = gameState.p1.y;

        gameState.p2.vx = Math.max(-18, Math.min(18, gameState.p2.x - prevP2.x));
        gameState.p2.vy = Math.max(-18, Math.min(18, gameState.p2.y - prevP2.y));
        prevP2.x = gameState.p2.x;
        prevP2.y = gameState.p2.y;

        for (let step = 0; step < SUBSTEPS; step++) {
            stepPhysics(1 / SUBSTEPS);
            if (gameState.status !== 'playing') break;
        }

        updateTrail();
        render();
    }

    // ==========================================
    // 人机对手（?bot=easy|normal|hard）：守上半场 (p2，规范坐标)
    // ==========================================
    // 冰球在己方半场且速度不快 → 绕到球后面朝对方球门推射；
    // 否则 → 回到球门前，按预测的来球 x 站位封堵。
    const BOT = {
        speed: GameBot.pick({ easy: 4.2, normal: 6.6, hard: 9.5 }),     // 每帧最大位移
        react: GameBot.pick({ easy: 14, normal: 7, hard: 2 }),         // 重新判断间隔（帧）
        err: GameBot.pick({ easy: 34, normal: 16, hard: 5 }),          // 站位误差 px
        attackSpeed: GameBot.pick({ easy: 3.5, normal: 6, hard: 9 })   // 冰球比这慢才主动出击
    };
    const bot = { tx: WIDTH / 2, ty: 70, timer: 0, err: 0 };
    const BOT_HOME_Y = 64;

    function predictPuckXAt(yLine) {
        const p = gameState.puck;
        if (p.vy >= -0.05) return null;
        const t = (yLine - p.y) / p.vy;
        if (t < 0 || t > 160) return null;
        const lo = PUCK_RADIUS, hi = WIDTH - PUCK_RADIUS, span = hi - lo;
        let m = (p.x + p.vx * t - lo) % (2 * span);
        if (m < 0) m += 2 * span;
        return lo + (m <= span ? m : 2 * span - m);
    }

    function botStep() {
        const me = gameState.p2, p = gameState.puck;
        const minY = MALLET_RADIUS, maxY = HEIGHT / 2 - MALLET_RADIUS;
        if (--bot.timer <= 0) {
            bot.timer = BOT.react;
            bot.err = GameBot.gauss() * BOT.err;
            const speed = Math.hypot(p.vx, p.vy);
            const inMyHalf = p.y < HEIGHT / 2 - 4;
            if (inMyHalf && (speed < BOT.attackSpeed || p.vy > 0)) {
                // 进攻：从球门方向的反侧顶过去
                const gx = WIDTH / 2 + GameBot.gauss() * (GameBot.level === 'hard' ? 40 : 10);
                const gy = HEIGHT + 40;
                let dx = gx - p.x, dy = gy - p.y;
                const len = Math.hypot(dx, dy) || 1;
                dx /= len; dy /= len;
                const behind = me.y < p.y - 6; // 我在球后（离自家球门更近）
                bot.dx = dx; bot.dy = dy;
                if (behind) {
                    bot.tx = p.x + dx * 30; bot.ty = p.y + dy * 30; bot.mode = 'strike';
                } else {
                    // 先绕到球的后方，避免把球往自己门里推
                    bot.tx = p.x - dx * (MALLET_RADIUS + PUCK_RADIUS + 14) + (me.x < p.x ? -18 : 18);
                    bot.ty = p.y - dy * (MALLET_RADIUS + PUCK_RADIUS + 14);
                    bot.mode = 'setup';
                }
            } else {
                // 防守：站在球门前，挡住预测落点
                const fx = predictPuckXAt(BOT_HOME_Y);
                const x = fx === null ? WIDTH / 2 + (p.x - WIDTH / 2) * 0.5 : fx;
                bot.tx = Math.max(GOAL_X1 - 10, Math.min(GOAL_X2 + 10, x)) + bot.err;
                bot.ty = BOT_HOME_Y;
                bot.mode = 'guard';
            }
        }
        // 进攻时持续跟踪球（不受反应间隔限制，否则球一动就挥空）
        let tx = bot.tx, ty = bot.ty;
        if (bot.mode === 'strike') { tx = p.x + bot.dx * 30; ty = p.y + bot.dy * 30; }
        const d = Math.hypot(tx - me.x, ty - me.y);
        const sp = bot.mode === 'strike' ? BOT.speed * 1.15 : BOT.speed;
        let nx = me.x, ny = me.y;
        if (d > 0.5) {
            const k = Math.min(1, sp / d);
            nx += (tx - me.x) * k;
            ny += (ty - me.y) * k;
        }
        nx = Math.max(MALLET_RADIUS, Math.min(WIDTH - MALLET_RADIUS, nx));
        ny = Math.max(minY, Math.min(maxY, ny));
        if (bot.mode === 'strike' && d < 4) bot.timer = 0; // 推射完成，马上重新判断
        GameBot.deliver({ type: 'input', x: nx, y: ny });
    }
    GameBot.expose({ state: () => gameState });

    function stepPhysics(dt) {
        const puck = gameState.puck;
        puck.x += puck.vx * dt;
        puck.y += puck.vy * dt;

        // 桌面阻尼
        const damp = Math.pow(FRICTION, dt);
        puck.vx *= damp;
        puck.vy *= damp;

        // 左右墙壁反弹
        if (puck.x - PUCK_RADIUS < 0) {
            puck.x = PUCK_RADIUS;
            puck.vx = Math.abs(puck.vx);
        } else if (puck.x + PUCK_RADIUS > WIDTH) {
            puck.x = WIDTH - PUCK_RADIUS;
            puck.vx = -Math.abs(puck.vx);
        }

        // 上下边界与球门判定
        const inGoalSlot = puck.x > GOAL_X1 + PUCK_RADIUS * 0.4 && puck.x < GOAL_X2 - PUCK_RADIUS * 0.4;

        // 顶部边界 (P2 球门，P1 得分)
        if (puck.y - PUCK_RADIUS <= 0) {
            if (inGoalSlot) {
                onGoalScored(1);
                return;
            } else {
                puck.y = PUCK_RADIUS;
                puck.vy = Math.abs(puck.vy);
            }
        }

        // 底部边界 (P1 球门，P2 得分)
        if (puck.y + PUCK_RADIUS >= HEIGHT) {
            if (inGoalSlot) {
                onGoalScored(2);
                return;
            } else {
                puck.y = HEIGHT - PUCK_RADIUS;
                puck.vy = -Math.abs(puck.vy);
            }
        }

        // 球柄与冰球圆碰撞
        resolveMalletCollision(gameState.p1);
        resolveMalletCollision(gameState.p2);
    }

    function resolveMalletCollision(mallet) {
        const puck = gameState.puck;
        const dx = puck.x - mallet.x;
        const dy = puck.y - mallet.y;
        const dist = Math.hypot(dx, dy);
        const minDist = MALLET_RADIUS + PUCK_RADIUS;

        if (dist < minDist && dist > 0.0001) {
            const nx = dx / dist;
            const ny = dy / dist;

            // 1. 消除穿透重叠
            const overlap = minDist - dist + 0.5;
            puck.x += nx * overlap;
            puck.y += ny * overlap;

            // 防止把冰球挤出左右墙壁
            puck.x = Math.max(PUCK_RADIUS, Math.min(WIDTH - PUCK_RADIUS, puck.x));

            // 2. 计算法向反射 + 球柄动量传递
            const relVx = puck.vx - mallet.vx;
            const relVy = puck.vy - mallet.vy;
            const normalVel = relVx * nx + relVy * ny;

            if (normalVel < 0) {
                const restitution = 1.05;
                puck.vx -= (1 + restitution) * normalVel * nx;
                puck.vy -= (1 + restitution) * normalVel * ny;
            }

            // 叠加球柄主动挥击速度
            puck.vx += mallet.vx * 0.55;
            puck.vy += mallet.vy * 0.55;

            // 保证最小清脆弹射速度与最大速度上限
            const speed = Math.hypot(puck.vx, puck.vy);
            if (speed < MIN_HIT_SPEED) {
                puck.vx = nx * MIN_HIT_SPEED;
                puck.vy = ny * MIN_HIT_SPEED;
            } else if (speed > MAX_PUCK_SPEED) {
                puck.vx = (puck.vx / speed) * MAX_PUCK_SPEED;
                puck.vy = (puck.vy / speed) * MAX_PUCK_SPEED;
            }
        }
    }

    function onGoalScored(scorer) {
        goalFlashTimer = 18;
        if (scorer === 1) {
            gameState.score.p1 += 1;
            p1ScoreVal.textContent = gameState.score.p1;
        } else {
            gameState.score.p2 += 1;
            p2ScoreVal.textContent = gameState.score.p2;
        }

        if (gameState.score.p1 >= WINNING_SCORE) {
            gameState.status = 'gameover';
            gameState.winner = 1;
            broadcastState();
            showGameOver();
        } else if (gameState.score.p2 >= WINNING_SCORE) {
            gameState.status = 'gameover';
            gameState.winner = 2;
            broadcastState();
            showGameOver();
        } else {
            // 失球方获得发球球权
            resetPuck(scorer === 1 ? -1 : 1);
            broadcastState();
        }
    }

    function broadcastState() {
        sendGameData({
            type: 'state',
            puck: {
                x: Math.round(gameState.puck.x * 10) / 10,
                y: Math.round(gameState.puck.y * 10) / 10,
                vx: Math.round(gameState.puck.vx * 10) / 10,
                vy: Math.round(gameState.puck.vy * 10) / 10
            },
            p1: {
                x: Math.round(gameState.p1.x * 10) / 10,
                y: Math.round(gameState.p1.y * 10) / 10
            },
            score: gameState.score,
            status: gameState.status,
            winner: gameState.winner
        });
    }

    function updateTrail() {
        const viewPuck = toView(gameState.puck.x, gameState.puck.y);
        puckTrail.push({ x: viewPuck.x, y: viewPuck.y });
        if (puckTrail.length > 10) {
            puckTrail.shift();
        }
        if (goalFlashTimer > 0) goalFlashTimer--;
    }

    // ==========================================
    // 画面渲染（带主视角自动转换）
    // ==========================================
    function render() {
        view.begin(ctx);
        // 背景球台底色
        ctx.fillStyle = goalFlashTimer > 0 ? '#131d2e' : '#080b11';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // 细微背景网格
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1;
        for (let x = 40; x < WIDTH; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, HEIGHT);
            ctx.stroke();
        }
        for (let y = 40; y < HEIGHT; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(WIDTH, y);
            ctx.stroke();
        }

        // 中线与中圈
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(0, HEIGHT / 2);
        ctx.lineTo(WIDTH, HEIGHT / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(WIDTH / 2, HEIGHT / 2, 56, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.arc(WIDTH / 2, HEIGHT / 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 确定上下半场颜色（己方在下方，对手在上方）
        const isClient = myRole === 'client';
        const bottomColor = isClient ? '#29b6ff' : '#00e676';
        const topColor = isClient ? '#00e676' : '#29b6ff';

        // 绘制上下球门禁区半圆与发光门线
        drawGoalCrease(WIDTH / 2, 0, GOAL_WIDTH, topColor, true);
        drawGoalCrease(WIDTH / 2, HEIGHT, GOAL_WIDTH, bottomColor, false);

        // 绘制冰球尾迹
        for (let i = 0; i < puckTrail.length; i++) {
            const pt = puckTrail[i];
            const ratio = (i + 1) / puckTrail.length;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, PUCK_RADIUS * ratio * 0.75, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 200, 40, ${ratio * 0.25})`;
            ctx.fill();
        }

        // 绘制两个球柄（经过视角变换）
        const p1View = toView(gameState.p1.x, gameState.p1.y);
        const p2View = toView(gameState.p2.x, gameState.p2.y);

        drawMallet(p1View.x, p1View.y, '#00e676', 'rgba(0, 230, 118, 0.55)');
        drawMallet(p2View.x, p2View.y, '#29b6ff', 'rgba(41, 182, 255, 0.55)');

        // 绘制冰球
        const puckView = toView(gameState.puck.x, gameState.puck.y);
        drawPuck(puckView.x, puckView.y);
    }

    function drawGoalCrease(cx, cy, width, color, isTop) {
        ctx.save();
        // 门前禁区弧线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, width / 2 + 12, isTop ? 0 : Math.PI, isTop ? Math.PI : Math.PI * 2);
        ctx.stroke();

        // 发光球门槽
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(cx - width / 2, isTop ? 3 : HEIGHT - 3);
        ctx.lineTo(cx + width / 2, isTop ? 3 : HEIGHT - 3);
        ctx.stroke();
        ctx.restore();
    }

    function drawMallet(x, y, color, glow) {
        ctx.save();
        // 外发光主环
        ctx.beginPath();
        ctx.arc(x, y, MALLET_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#0d131c';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = color;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 16;
        ctx.stroke();

        // 内部握把核心
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, MALLET_RADIUS * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    }

    function drawPuck(x, y) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, PUCK_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#ffca28';
        ctx.shadowColor = 'rgba(255, 202, 40, 0.75)';
        ctx.shadowBlur = 16;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, PUCK_RADIUS * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#fff8e1';
        ctx.fill();
        ctx.restore();
    }

    function showGameOver() {
        clearInterval(gameLoopInterval);
        clearInterval(netSendInterval);

        overlay.classList.remove('hidden');
        lobbyScreen.classList.add('hidden');
        readyScreen.classList.add('hidden');
        disconnectScreen.classList.add('hidden');
        gameoverScreen.classList.remove('hidden');

        finalScore.textContent = `${gameState.score.p1} - ${gameState.score.p2}`;

        const iWon = (gameState.winner === 1 && myRole === 'host') ||
                     (gameState.winner === 2 && myRole === 'client');
        if (iWon) {
            winLossTitle.textContent = 'VICTORY';
            winLossTitle.className = 'neon-text';
        } else {
            winLossTitle.textContent = 'DEFEAT';
            winLossTitle.className = 'danger-text';
        }
    }

    // 首帧渲染
    render();
});
