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
    const winnerMascot = document.getElementById('winner-mascot');
    const finalScore = document.getElementById('final-score');

    const statusText = document.getElementById('status-text');
    const pingText = document.getElementById('ping-text');
    const roleStatusText = document.getElementById('role-status-text');

    inviteUrlInput.value = location.href;
    copyBtn.addEventListener('click', () => {
        inviteUrlInput.select();
        document.execCommand('copy');
        copyBtn.textContent = 'COPIED!';
        setTimeout(() => { copyBtn.textContent = 'COPY'; }, 2000);
    });

    // ==========================================
    // 竞技场、掩体与物理常量
    // ==========================================
    const WIDTH = canvas.width;        // 760
    const HEIGHT = canvas.height;      // 480
    const ARENA_PAD = 24;
    const TANK_RADIUS = 19;
    const BULLET_RADIUS = 5;
    const BULLET_SPEED = 7.4;
    const MAX_BOUNCES = 2;
    const MAX_HP = 3;
    const WINNING_SCORE = 3;

    const MOVE_SPEED = 3.4;
    const DASH_SPEED = 9.2;
    const FIRE_COOLDOWN = 22;          // ~0.36s
    const DASH_COOLDOWN = 75;          // ~1.25s
    const DASH_DURATION = 10;

    // 对称战术掩体墙（支持弹道镜面反射与车体阻挡）
    const WALLS = [
        { x: 185, y: 110, w: 26, h: 105 },
        { x: 185, y: 265, w: 26, h: 105 },
        { x: 549, y: 110, w: 26, h: 105 },
        { x: 549, y: 265, w: 26, h: 105 },
        { x: 330, y: 212, w: 100, h: 56 },
        { x: 356, y: 74,  w: 48,  h: 48 },
        { x: 356, y: 358, w: 48,  h: 48 }
    ];

    let myRole = null; // 'host' | 'client'
    let gameLoopInterval = null;
    let netSendInterval = null;
    let animTick = 0;

    // 输入状态（支持鼠标瞄准角 aimAngle，若未移动鼠标则自动瞄准对手或跟随车头）
    const localInput = {
        up: false,
        down: false,
        left: false,
        right: false,
        fire: false,
        dash: false,
        aimAngle: null
    };
    const clientInput = {
        up: false,
        down: false,
        left: false,
        right: false,
        fire: false,
        dash: false,
        aimAngle: null
    };

    let particles = [];
    let popTexts = [];
    let screenShake = 0;
    let pendingFx = null;

    function createTank(id, x, y, angle) {
        return {
            id,
            x,
            y,
            vx: 0,
            vy: 0,
            hullAngle: angle,
            turretAngle: angle,
            hp: MAX_HP,
            shield: 0,           // 护盾层数 (0 or 1)
            spreadTimer: 0,      // 三连散射剩余帧数
            fireCooldown: 0,
            dashCooldown: 0,
            dashTimer: 0,
            invulnTimer: 0,
            hurtTimer: 0
        };
    }

    function createInitialState(score) {
        return {
            p1: createTank(1, 95, HEIGHT / 2, 0),
            p2: createTank(2, WIDTH - 95, HEIGHT / 2, Math.PI),
            bullets: [],
            powerup: null,       // { x, y, type: 'spread' | 'shield' | 'repair' }
            powerupTimer: 210,
            score: score || { p1: 0, p2: 0 },
            roundBanner: 'BATTLE START!',
            roundBannerTimer: 55,
            status: 'lobby',
            winner: 0
        };
    }

    let gameState = createInitialState();

    // ==========================================
    // 键盘、鼠标与触屏控制
    // ==========================================
    function setKeyState(key, isDown) {
        const k = key.toLowerCase();
        if (k === 'w' || k === 'arrowup') localInput.up = isDown;
        if (k === 's' || k === 'arrowdown') localInput.down = isDown;
        if (k === 'a' || k === 'arrowleft') localInput.left = isDown;
        if (k === 'd' || k === 'arrowright') localInput.right = isDown;
        if (k === 'j' || k === ' ' || k === 'z') {
            if (isDown) localInput.aimAngle = null; // 键盘开火启用智能锁定辅助
            localInput.fire = isDown;
        }
        if (k === 'k' || k === 'shift' || k === 'x') localInput.dash = isDown;
    }

    window.addEventListener('keydown', e => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
            if (gameState.status === 'playing') e.preventDefault();
        }
        setKeyState(e.key, true);
    });

    window.addEventListener('keyup', e => {
        setKeyState(e.key, false);
    });

    // 画面：竖屏时整体旋转 90°，并让自己的坦克在屏幕下方
    // （host 出生在左侧 → 转 -90°；client 出生在右侧 → 转 +90°）
    const view = GameFit.view(canvas, {
        width: WIDTH, height: HEIGHT, rotate: 'auto',
        turn: () => (myRole === 'client' ? 90 : -90),
        onResize: () => render()
    });

    // 鼠标瞄准与左右键操作
    function updateMouseAim(e) {
        const lp = view.toLogical(e.clientX, e.clientY);
        const mx = lp.x, my = lp.y;
        const me = myRole === 'client' ? gameState.p2 : gameState.p1;
        if (me) {
            localInput.aimAngle = Math.atan2(my - me.y, mx - me.x);
        }
    }

    canvas.addEventListener('mousemove', updateMouseAim);
    // 触屏：按住画面任意位置 = 朝手指方向瞄准并开火，拖动可以持续调整
    let aimTouchId = null;
    canvas.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' || gameState.status !== 'playing' || aimTouchId !== null) return;
        e.preventDefault();
        aimTouchId = e.pointerId;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        updateMouseAim(e);
        localInput.fire = true;
    });
    canvas.addEventListener('pointermove', e => { if (e.pointerId === aimTouchId) updateMouseAim(e); });
    const endAimTouch = e => {
        if (e.pointerId !== aimTouchId) return;
        aimTouchId = null;
        localInput.fire = false;
    };
    canvas.addEventListener('pointerup', endAimTouch);
    canvas.addEventListener('pointercancel', endAimTouch);
    canvas.addEventListener('mousedown', e => {
        if (gameState.status !== 'playing') return;
        updateMouseAim(e);
        if (e.button === 2) {
            localInput.dash = true;
        } else {
            localInput.fire = true;
        }
    });
    window.addEventListener('mouseup', e => {
        if (e.button === 2) {
            localInput.dash = false;
        } else {
            localInput.fire = false;
        }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // 触屏虚拟手柄：🔥/💨 按住生效（多指同时按、手指滑到另一个键也能切换）
    GameFit.touchButtons(document.querySelector('.touch-actions'), (action, down) => {
        if (action === 'fire' && down) localInput.aimAngle = null; // 触屏开火自动锁定对手方向
        localInput[action] = down;
    });

    // 移动摇杆：屏幕方向 → 世界方向（竖屏旋转时由 view.screenVec 换算），
    // 再量化成协议里的 8 方向 up/down/left/right，不需要改联机协议
    GameFit.joystick(document.getElementById('move-stick'), document.getElementById('move-knob'), (x, y, active) => {
        const m = Math.hypot(x, y);
        localInput.up = localInput.down = localInput.left = localInput.right = false;
        if (!active || m < 0.22) return;
        const w = view.screenVec(x / m, y / m);
        const T = 0.38; // ≈ 22.5°/67.5° 分界 → 8 方向
        if (w.x > T) localInput.right = true; else if (w.x < -T) localInput.left = true;
        if (w.y > T) localInput.down = true; else if (w.y < -T) localInput.up = true;
    }, { radius: 48 });

    // ==========================================
    // 网络层：GameSession（不可靠低延迟模式）
    // ==========================================
    connectionStateText.textContent = '正在连接信号服务器...';

    const session = GameBot.session({
        gameFolder: 'tanks',
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
            view.refit(); // 竖屏时按身份决定旋转方向（自己在下方）
            roleStatusText.textContent = role.toUpperCase();
            if (role === 'host') {
                p1Label.textContent = '🟢 抹茶重坦 (YOU)';
                p2Label.textContent = '🟠 芝士快炮 (FOE)';
                roleText.innerHTML = `你是 <strong>Host (🟢 抹茶重坦)</strong>，驻守左翼基地。<br>对手已连接，点击下方按钮开启装甲大战！`;
            } else if (role === 'client') {
                p1Label.textContent = '🟢 抹茶重坦 (HOST)';
                p2Label.textContent = '🟠 芝士快炮 (YOU)';
                roleText.innerHTML = `你是 <strong>Client (🟠 芝士快炮)</strong>，驻守右翼基地。<br>等待房主点击开始战斗...`;
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
                gameState.p1 = msg.p1;
                gameState.p2 = msg.p2;
                gameState.bullets = msg.bullets || [];
                gameState.powerup = msg.powerup || null;
                gameState.score = msg.score;
                gameState.roundBanner = msg.roundBanner || '';
                gameState.roundBannerTimer = msg.roundBannerTimer || 0;
                gameState.status = msg.status;
                gameState.winner = msg.winner;

                p1ScoreVal.textContent = gameState.score.p1;
                p2ScoreVal.textContent = gameState.score.p2;

                if (msg.fx) {
                    triggerFxEvent(msg.fx);
                }

                if (gameState.status === 'playing') {
                    overlay.classList.add('hidden');
                } else if (gameState.status === 'gameover') {
                    showGameOver();
                }
            }
        } else if (msg.type === 'input') {
            if (myRole === 'host' && msg.keys) {
                clientInput.up = !!msg.keys.up;
                clientInput.down = !!msg.keys.down;
                clientInput.left = !!msg.keys.left;
                clientInput.right = !!msg.keys.right;
                clientInput.fire = !!msg.keys.fire;
                clientInput.dash = !!msg.keys.dash;
                clientInput.aimAngle = typeof msg.keys.aimAngle === 'number' ? msg.keys.aimAngle : null;
            }
        } else if (msg.type === 'start') {
            gameState = createInitialState(msg.score || { p1: 0, p2: 0 });
            gameState.status = 'playing';
            p1ScoreVal.textContent = gameState.score.p1;
            p2ScoreVal.textContent = gameState.score.p2;
            particles = [];
            popTexts = [];
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

    lobbyBtn.addEventListener('click', () => location.reload());

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
        particles = [];
        popTexts = [];
        p1ScoreVal.textContent = '0';
        p2ScoreVal.textContent = '0';
        overlay.classList.add('hidden');

        clearInterval(gameLoopInterval);
        clearInterval(netSendInterval);

        gameLoopInterval = setInterval(() => {
            updateHostPhysics();
            render();
        }, 1000 / 60);

        netSendInterval = setInterval(() => {
            if (gameState.status === 'playing') {
                sendGameData({
                    type: 'state',
                    p1: gameState.p1,
                    p2: gameState.p2,
                    bullets: gameState.bullets,
                    powerup: gameState.powerup,
                    score: gameState.score,
                    roundBanner: gameState.roundBanner,
                    roundBannerTimer: gameState.roundBannerTimer,
                    status: gameState.status,
                    winner: gameState.winner,
                    fx: pendingFx
                });
                pendingFx = null;
            }
        }, 1000 / 60);
    }

    function startClientLoop() {
        clearInterval(gameLoopInterval);
        clearInterval(netSendInterval);

        gameLoopInterval = setInterval(() => {
            updateEffectsOnly();
            render();
        }, 1000 / 60);

        netSendInterval = setInterval(() => {
            if (gameState.status === 'playing') {
                sendGameData({
                    type: 'input',
                    keys: localInput
                });
            }
        }, 1000 / 60);
    }

    // ==========================================
    // 物理与弹道反射引擎 (Host Authoritative)
    // ==========================================
    function circleRectCollide(cx, cy, r, rect) {
        const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        const dx = cx - closestX;
        const dy = cy - closestY;
        const distSq = dx * dx + dy * dy;
        if (distSq < r * r) {
            const dist = Math.sqrt(distSq) || 0.001;
            const overlap = r - dist;
            return {
                hit: true,
                nx: dx / dist,
                ny: dy / dist,
                overlap
            };
        }
        return { hit: false };
    }

    function resolveTankWalls(tank) {
        // 边界限制
        const minX = ARENA_PAD + TANK_RADIUS;
        const maxX = WIDTH - ARENA_PAD - TANK_RADIUS;
        const minY = ARENA_PAD + TANK_RADIUS;
        const maxY = HEIGHT - ARENA_PAD - TANK_RADIUS;
        if (tank.x < minX) tank.x = minX;
        if (tank.x > maxX) tank.x = maxX;
        if (tank.y < minY) tank.y = minY;
        if (tank.y > maxY) tank.y = maxY;

        // 障碍物挤压修正
        for (const w of WALLS) {
            const col = circleRectCollide(tank.x, tank.y, TANK_RADIUS, w);
            if (col.hit) {
                tank.x += col.nx * col.overlap;
                tank.y += col.ny * col.overlap;
            }
        }
    }

    function spawnBullet(tank, angleOffset) {
        const angle = tank.turretAngle + (angleOffset || 0);
        const muzzleDist = TANK_RADIUS + 8;
        gameState.bullets.push({
            owner: tank.id,
            x: tank.x + Math.cos(angle) * muzzleDist,
            y: tank.y + Math.sin(angle) * muzzleDist,
            vx: Math.cos(angle) * BULLET_SPEED,
            vy: Math.sin(angle) * BULLET_SPEED,
            bounces: 0,
            ttl: 240
        });
    }

    function stepTank(tank, input, foe) {
        if (tank.fireCooldown > 0) tank.fireCooldown--;
        if (tank.dashCooldown > 0) tank.dashCooldown--;
        if (tank.dashTimer > 0) tank.dashTimer--;
        if (tank.invulnTimer > 0) tank.invulnTimer--;
        if (tank.hurtTimer > 0) tank.hurtTimer--;
        if (tank.spreadTimer > 0) tank.spreadTimer--;

        let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        const len = Math.hypot(mx, my);
        if (len > 0) {
            mx /= len;
            my /= len;
            tank.hullAngle = Math.atan2(my, mx);
        }

        // 涡轮冲刺
        if (input.dash && tank.dashCooldown <= 0) {
            tank.dashTimer = DASH_DURATION;
            tank.dashCooldown = DASH_COOLDOWN;
            tank.invulnTimer = Math.max(tank.invulnTimer, 14);
            const dashAngle = len > 0 ? tank.hullAngle : tank.turretAngle;
            tank.vx = Math.cos(dashAngle) * DASH_SPEED;
            tank.vy = Math.sin(dashAngle) * DASH_SPEED;
            emitFx({
                kind: 'dash',
                x: tank.x,
                y: tank.y,
                color: tank.id === 1 ? '#4ade80' : '#fb923c',
                text: 'DASH!'
            });
        }

        if (tank.dashTimer > 0) {
            tank.x += tank.vx;
            tank.y += tank.vy;
        } else {
            tank.vx = mx * MOVE_SPEED;
            tank.vy = my * MOVE_SPEED;
            tank.x += tank.vx;
            tank.y += tank.vy;
        }

        resolveTankWalls(tank);

        // 瞄准角更新：优先使用鼠标瞄准角，否则智能指向对手方向
        if (typeof input.aimAngle === 'number') {
            tank.turretAngle = input.aimAngle;
        } else if (foe) {
            tank.turretAngle = Math.atan2(foe.y - tank.y, foe.x - tank.x);
        }

        // 开火
        if (input.fire && tank.fireCooldown <= 0) {
            tank.fireCooldown = FIRE_COOLDOWN;
            if (tank.spreadTimer > 0) {
                spawnBullet(tank, -0.18);
                spawnBullet(tank, 0);
                spawnBullet(tank, 0.18);
            } else {
                spawnBullet(tank, 0);
            }
            emitFx({
                kind: 'muzzle',
                x: tank.x + Math.cos(tank.turretAngle) * (TANK_RADIUS + 8),
                y: tank.y + Math.sin(tank.turretAngle) * (TANK_RADIUS + 8),
                color: tank.id === 1 ? '#4ade80' : '#fb923c'
            });
        }
    }

    // ==========================================
    // 人机对手（?bot=easy|normal|hard）：橙色坦克 (p2)
    // ==========================================
    // 每帧：预判提前量瞄准 → 视线无遮挡就开火（困难会算外墙一次反弹）；
    // 每隔几帧给 8 个方向 + 原地打分：保持交战距离、躲子弹、别撞墙、
    // 抢补给、保持能看到对手；子弹即将命中时冲刺闪避。
    const BOT = {
        aimErr: GameBot.pick({ easy: 0.16, normal: 0.09, hard: 0.025 }),
        lead: GameBot.pick({ easy: 0, normal: 0.6, hard: 1 }),
        fireChance: GameBot.pick({ easy: 0.08, normal: 0.25, hard: 1 }),   // 每帧满足条件时开火概率
        rethink: GameBot.pick({ easy: 16, normal: 9, hard: 5 }),
        dodge: GameBot.pick({ easy: 0, normal: 0.6, hard: 1 }),
        dashDodge: GameBot.pick({ easy: 0, normal: 0.35, hard: 0.9 }),
        range: GameBot.pick({ easy: 250, normal: 230, hard: 210 }),
        bank: GameBot.level === 'hard'
    };
    const bot = { dir: -1, timer: 0, aimNoise: 0, noiseTimer: 0, dashCheck: 0 };
    const BOT_DIRS = [];
    for (let i = 0; i < 8; i++) BOT_DIRS.push({ x: Math.cos(i * Math.PI / 4), y: Math.sin(i * Math.PI / 4) });

    function segBlocked(x1, y1, x2, y2, pad) {
        for (const w of WALLS) {
            // Liang–Barsky：线段与（外扩 pad 的）矩形求交
            const minX = w.x - pad, maxX = w.x + w.w + pad, minY = w.y - pad, maxY = w.y + w.h + pad;
            let t0 = 0, t1 = 1;
            const dx = x2 - x1, dy = y2 - y1;
            const ps = [-dx, dx, -dy, dy];
            const qs = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
            let hit = true;
            for (let i = 0; i < 4; i++) {
                if (ps[i] === 0) { if (qs[i] < 0) { hit = false; break; } }
                else {
                    const r = qs[i] / ps[i];
                    if (ps[i] < 0) { if (r > t1) { hit = false; break; } if (r > t0) t0 = r; }
                    else { if (r < t0) { hit = false; break; } if (r < t1) t1 = r; }
                }
            }
            if (hit) return true;
        }
        return false;
    }
    function posBlocked(x, y) {
        if (x < ARENA_PAD + TANK_RADIUS || x > WIDTH - ARENA_PAD - TANK_RADIUS) return true;
        if (y < ARENA_PAD + TANK_RADIUS || y > HEIGHT - ARENA_PAD - TANK_RADIUS) return true;
        for (const w of WALLS) if (circleRectCollide(x, y, TANK_RADIUS + 2, w).hit) return true;
        return false;
    }
    // 子弹对位置 (x,y) 在未来 frames 帧内的最近距离（只算还会伤人的子弹）
    function bulletThreat(x, y, frames, selfId) {
        let worst = 0;
        for (const b of gameState.bullets) {
            if (b.owner === selfId && b.bounces === 0) continue;
            const rx = x - b.x, ry = y - b.y;
            const vv = b.vx * b.vx + b.vy * b.vy;
            let t = (rx * b.vx + ry * b.vy) / vv;
            if (t < 0 || t > frames) continue;
            const cx = b.x + b.vx * t, cy = b.y + b.vy * t;
            if (segBlocked(b.x, b.y, cx, cy, BULLET_RADIUS)) continue;
            const d = Math.hypot(x - cx, y - cy);
            const danger = TANK_RADIUS + BULLET_RADIUS + 10 - d;
            if (danger > 0) worst = Math.max(worst, danger * (1.5 - t / frames));
        }
        return worst;
    }
    function aimAt(me, foe) {
        const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
        const t = dist / BULLET_SPEED * BOT.lead;
        const tx = foe.x + (foe.vx || 0) * t, ty = foe.y + (foe.vy || 0) * t;
        return { x: tx, y: ty };
    }
    function bankShot(me, target) {
        // 外墙一次镜像反弹：把目标对四面外墙做镜像，两段都没遮挡就可行
        const minX = ARENA_PAD + BULLET_RADIUS, maxX = WIDTH - ARENA_PAD - BULLET_RADIUS;
        const minY = ARENA_PAD + BULLET_RADIUS, maxY = HEIGHT - ARENA_PAD - BULLET_RADIUS;
        const mirrors = [
            { x: 2 * minX - target.x, y: target.y, wall: 'x', v: minX },
            { x: 2 * maxX - target.x, y: target.y, wall: 'x', v: maxX },
            { x: target.x, y: 2 * minY - target.y, wall: 'y', v: minY },
            { x: target.x, y: 2 * maxY - target.y, wall: 'y', v: maxY }
        ];
        let best = null;
        for (const m of mirrors) {
            const dx = m.x - me.x, dy = m.y - me.y;
            const t = m.wall === 'x' ? (m.v - me.x) / dx : (m.v - me.y) / dy;
            if (!(t > 0 && t < 1)) continue;
            const bx = me.x + dx * t, by = me.y + dy * t;
            if (bx < minX - 1 || bx > maxX + 1 || by < minY - 1 || by > maxY + 1) continue;
            if (segBlocked(me.x, me.y, bx, by, BULLET_RADIUS) || segBlocked(bx, by, target.x, target.y, BULLET_RADIUS)) continue;
            const len = Math.hypot(dx, dy);
            if (len > 900) continue;
            if (!best || len < best.len) best = { angle: Math.atan2(dy, dx), len };
        }
        return best;
    }

    function botStep() {
        const me = gameState.p2, foe = gameState.p1;
        const keys = { up: false, down: false, left: false, right: false, fire: false, dash: false, aimAngle: null };
        if (gameState.roundBannerTimer > 30) { GameBot.deliver({ type: 'input', keys }); return; }

        // --- 瞄准与开火
        if (--bot.noiseTimer <= 0) { bot.noiseTimer = 20; bot.aimNoise = GameBot.gauss() * BOT.aimErr; }
        const tgt = aimAt(me, foe);
        const clear = !segBlocked(me.x, me.y, tgt.x, tgt.y, BULLET_RADIUS + 1);
        let angle = Math.atan2(tgt.y - me.y, tgt.x - me.x);
        let canShoot = clear;
        if (!clear && BOT.bank) {
            const b = bankShot(me, tgt);
            if (b) { angle = b.angle; canShoot = true; }
        }
        keys.aimAngle = angle + bot.aimNoise;
        if (canShoot && me.fireCooldown <= 0 && foe.invulnTimer <= 0 && Math.random() < BOT.fireChance) keys.fire = true;

        // --- 移动：周期性给方向打分
        if (--bot.timer <= 0) {
            bot.timer = BOT.rethink;
            const look = 12 * MOVE_SPEED;
            let best = -1, bestScore = -Infinity;
            for (let i = -1; i < 8; i++) {
                const d = i < 0 ? { x: 0, y: 0 } : BOT_DIRS[i];
                const nx = me.x + d.x * look, ny = me.y + d.y * look;
                if (i >= 0 && posBlocked(nx, ny)) continue;
                const fd = Math.hypot(foe.x - nx, foe.y - ny);
                let sc = -Math.abs(fd - BOT.range) * 0.6;
                if (!segBlocked(nx, ny, foe.x, foe.y, BULLET_RADIUS + 1)) sc += 60;
                sc -= bulletThreat(nx, ny, 40, me.id) * 14 * BOT.dodge;
                if (gameState.powerup) sc -= Math.hypot(gameState.powerup.x - nx, gameState.powerup.y - ny) * (me.hp < MAX_HP ? 0.5 : 0.3);
                // 远离角落，避免被卡
                sc -= Math.max(0, 90 - Math.min(nx - ARENA_PAD, WIDTH - ARENA_PAD - nx, ny - ARENA_PAD, HEIGHT - ARENA_PAD - ny)) * 0.4;
                if (i === bot.dir) sc += 18; // 保持方向，避免抖动
                if (i < 0) sc -= GameBot.level === 'easy' ? 0 : 25;
                sc += Math.random() * GameBot.pick({ easy: 60, normal: 25, hard: 8 });
                if (sc > bestScore) { bestScore = sc; best = i; }
            }
            bot.dir = best;
        }
        if (bot.dir >= 0) {
            const d = BOT_DIRS[bot.dir];
            if (d.x > 0.3) keys.right = true; else if (d.x < -0.3) keys.left = true;
            if (d.y > 0.3) keys.down = true; else if (d.y < -0.3) keys.up = true;
        }

        // --- 冲刺躲子弹
        if (BOT.dashDodge > 0 && me.dashCooldown <= 0 && --bot.dashCheck <= 0) {
            bot.dashCheck = 4;
            if (bulletThreat(me.x, me.y, 14, me.id) > 6 && Math.random() < BOT.dashDodge) {
                // 垂直于来弹方向冲刺，选不撞墙且离弹道更远的一侧
                let near = null, nd = Infinity;
                for (const b of gameState.bullets) {
                    if (b.owner === me.id && b.bounces === 0) continue;
                    const d = Math.hypot(b.x - me.x, b.y - me.y);
                    if (d < nd) { nd = d; near = b; }
                }
                if (near) {
                    const v = Math.hypot(near.vx, near.vy) || 1;
                    let px = -near.vy / v, py = near.vx / v;
                    const side = (me.x - near.x) * px + (me.y - near.y) * py;
                    if (side < 0) { px = -px; py = -py; }
                    if (posBlocked(me.x + px * 70, me.y + py * 70)) { px = -px; py = -py; }
                    keys.left = keys.right = keys.up = keys.down = false;
                    if (px > 0.38) keys.right = true; else if (px < -0.38) keys.left = true;
                    if (py > 0.38) keys.down = true; else if (py < -0.38) keys.up = true;
                }
                keys.dash = true;
                bot.timer = 0;
            }
        }
        GameBot.deliver({ type: 'input', keys });
    }
    GameBot.expose({ state: () => gameState });

    function updateHostPhysics() {
        updateEffectsOnly();
        if (gameState.status !== 'playing') return;

        if (gameState.roundBannerTimer > 0) {
            gameState.roundBannerTimer--;
        }

        const p1 = gameState.p1;
        const p2 = gameState.p2;

        if (GameBot.enabled) botStep();
        stepTank(p1, localInput, p2);
        stepTank(p2, clientInput, p1);

        // 两辆坦克之间的车体碰撞推挤
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = TANK_RADIUS * 2;
        if (dist < minDist) {
            const push = (minDist - dist) * 0.5;
            const nx = dx / dist;
            const ny = dy / dist;
            p1.x -= nx * push;
            p1.y -= ny * push;
            p2.x += nx * push;
            p2.y += ny * push;
            resolveTankWalls(p1);
            resolveTankWalls(p2);
        }

        // 战场空投补给生成与拾取
        if (!gameState.powerup) {
            gameState.powerupTimer--;
            if (gameState.powerupTimer <= 0) {
                const spots = [
                    { x: 380, y: 155 },
                    { x: 380, y: 325 },
                    { x: 270, y: 240 },
                    { x: 490, y: 240 }
                ];
                const spot = spots[Math.floor(Math.random() * spots.length)];
                const types = ['spread', 'shield', 'repair'];
                gameState.powerup = {
                    x: spot.x,
                    y: spot.y,
                    type: types[Math.floor(Math.random() * types.length)]
                };
                gameState.powerupTimer = 320;
            }
        } else {
            const item = gameState.powerup;
            for (const t of [p1, p2]) {
                if (Math.hypot(t.x - item.x, t.y - item.y) < TANK_RADIUS + 16) {
                    if (item.type === 'spread') {
                        t.spreadTimer = 360; // 6 秒三连发散射
                        emitFx({ kind: 'pickup', x: item.x, y: item.y, color: '#38bdf8', text: '🔱 SPREAD SHOT!' });
                    } else if (item.type === 'shield') {
                        t.shield = 1;
                        emitFx({ kind: 'pickup', x: item.x, y: item.y, color: '#a78bfa', text: '🛡️ ENERGY SHIELD!' });
                    } else {
                        t.hp = Math.min(MAX_HP, t.hp + 1);
                        emitFx({ kind: 'pickup', x: item.x, y: item.y, color: '#4ade80', text: '🔧 +1 ARMOR!' });
                    }
                    gameState.powerup = null;
                    break;
                }
            }
        }

        // 炮弹步进、墙壁反弹与命中判定
        const minX = ARENA_PAD + BULLET_RADIUS;
        const maxX = WIDTH - ARENA_PAD - BULLET_RADIUS;
        const minY = ARENA_PAD + BULLET_RADIUS;
        const maxY = HEIGHT - ARENA_PAD - BULLET_RADIUS;

        const remainingBullets = [];
        for (const b of gameState.bullets) {
            b.x += b.vx;
            b.y += b.vy;
            b.ttl--;
            if (b.ttl <= 0) continue;

            let bounced = false;
            // 外框墙壁反弹
            if (b.x <= minX) { b.x = minX; b.vx = Math.abs(b.vx); bounced = true; }
            else if (b.x >= maxX) { b.x = maxX; b.vx = -Math.abs(b.vx); bounced = true; }
            if (b.y <= minY) { b.y = minY; b.vy = Math.abs(b.vy); bounced = true; }
            else if (b.y >= maxY) { b.y = maxY; b.vy = -Math.abs(b.vy); bounced = true; }

            // 内部掩体反弹
            if (!bounced) {
                for (const w of WALLS) {
                    if (b.x + BULLET_RADIUS > w.x && b.x - BULLET_RADIUS < w.x + w.w &&
                        b.y + BULLET_RADIUS > w.y && b.y - BULLET_RADIUS < w.y + w.h) {
                        const overlapLeft = (b.x + BULLET_RADIUS) - w.x;
                        const overlapRight = (w.x + w.w) - (b.x - BULLET_RADIUS);
                        const overlapTop = (b.y + BULLET_RADIUS) - w.y;
                        const overlapBottom = (w.y + w.h) - (b.y - BULLET_RADIUS);
                        const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

                        if (minOverlap === overlapLeft) { b.x = w.x - BULLET_RADIUS; b.vx = -Math.abs(b.vx); }
                        else if (minOverlap === overlapRight) { b.x = w.x + w.w + BULLET_RADIUS; b.vx = Math.abs(b.vx); }
                        else if (minOverlap === overlapTop) { b.y = w.y - BULLET_RADIUS; b.vy = -Math.abs(b.vy); }
                        else { b.y = w.y + w.h + BULLET_RADIUS; b.vy = Math.abs(b.vy); }

                        bounced = true;
                        break;
                    }
                }
            }

            if (bounced) {
                b.bounces++;
                emitFx({ kind: 'spark', x: b.x, y: b.y, color: '#fde047' });
                if (b.bounces > MAX_BOUNCES) {
                    continue; // 超过最大反弹次数消散
                }
            }

            // 检测是否击中坦克（剛发射的前几帧不打自己，反弹后允许打任何人但优先打对手）
            let hitTank = null;
            for (const t of [p1, p2]) {
                if (b.owner === t.id && b.bounces === 0) continue;
                if (Math.hypot(b.x - t.x, b.y - t.y) < TANK_RADIUS + BULLET_RADIUS) {
                    hitTank = t;
                    break;
                }
            }

            if (hitTank) {
                if (hitTank.invulnTimer > 0) {
                    emitFx({ kind: 'spark', x: b.x, y: b.y, color: '#94a3b8', text: 'DODGED!' });
                } else if (hitTank.shield > 0) {
                    hitTank.shield = 0;
                    hitTank.invulnTimer = 25;
                    emitFx({ kind: 'hit', x: hitTank.x, y: hitTank.y, color: '#a78bfa', text: 'SHIELD BREAK!' });
                } else {
                    hitTank.hp--;
                    hitTank.hurtTimer = 18;
                    hitTank.invulnTimer = 35;
                    emitFx({
                        kind: 'hit',
                        x: hitTank.x,
                        y: hitTank.y,
                        color: hitTank.id === 1 ? '#4ade80' : '#fb923c',
                        text: hitTank.hp <= 0 ? '💥 ARMOR DESTROYED!' : '💥 -1 ARMOR!'
                    });
                }
                continue;
            }

            remainingBullets.push(b);
        }

        gameState.bullets = remainingBullets;

        // 回合胜负判定
        if (p1.hp <= 0 || p2.hp <= 0) {
            const roundWinner = p1.hp <= 0 ? 2 : 1;
            if (roundWinner === 1) gameState.score.p1++;
            else gameState.score.p2++;

            p1ScoreVal.textContent = gameState.score.p1;
            p2ScoreVal.textContent = gameState.score.p2;

            if (gameState.score.p1 >= WINNING_SCORE || gameState.score.p2 >= WINNING_SCORE) {
                gameState.status = 'gameover';
                gameState.winner = gameState.score.p1 >= WINNING_SCORE ? 1 : 2;
                sendGameData({
                    type: 'state',
                    p1: gameState.p1,
                    p2: gameState.p2,
                    bullets: [],
                    powerup: null,
                    score: gameState.score,
                    status: 'gameover',
                    winner: gameState.winner,
                    fx: pendingFx
                });
                pendingFx = null;
                showGameOver();
            } else {
                const nextScore = { ...gameState.score };
                gameState = createInitialState(nextScore);
                gameState.status = 'playing';
                gameState.roundBanner = roundWinner === 1 ? '🟢 MATCHA SCORES!' : '🟠 CHEDDAR SCORES!';
                gameState.roundBannerTimer = 65;
            }
        }
    }

    // ==========================================
    // 粒子特效与画面震动
    // ==========================================
    function emitFx(fx) {
        pendingFx = fx;
        triggerFxEvent(fx);
    }

    function triggerFxEvent(fx) {
        if (!fx) return;
        const count = fx.kind === 'hit' ? 16 : 7;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.4 + Math.random() * (fx.kind === 'hit' ? 5.2 : 3.0);
            particles.push({
                x: fx.x,
                y: fx.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 18 + Math.random() * 12,
                maxLife: 30,
                color: fx.color || '#fde047',
                size: fx.kind === 'hit' ? 4.5 : 3
            });
        }
        if (fx.text) {
            popTexts.push({
                x: fx.x,
                y: fx.y - 18,
                text: fx.text,
                color: fx.color || '#ffffff',
                life: 36
            });
        }
        if (fx.kind === 'hit') {
            screenShake = 8;
        }
    }

    function updateEffectsOnly() {
        animTick++;
        if (screenShake > 0) screenShake *= 0.82;
        if (screenShake < 0.4) screenShake = 0;

        particles = particles.filter(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.92;
            p.vy *= 0.92;
            p.life--;
            return p.life > 0;
        });

        popTexts = popTexts.filter(t => {
            t.y -= 0.7;
            t.life--;
            return t.life > 0;
        });
    }

    function showGameOver() {
        clearInterval(gameLoopInterval);
        clearInterval(netSendInterval);

        overlay.classList.remove('hidden');
        lobbyScreen.classList.add('hidden');
        readyScreen.classList.add('hidden');
        gameoverScreen.classList.remove('hidden');
        disconnectScreen.classList.add('hidden');

        const isWinner = (myRole === 'host' && gameState.winner === 1) ||
                         (myRole === 'client' && gameState.winner === 2);

        winnerMascot.textContent = gameState.winner === 1 ? '🟢🏆' : '🟠🏆';
        winLossTitle.textContent = isWinner ? 'VICTORY!' : 'DEFEAT';
        winLossTitle.className = isWinner ? 'neon-text' : 'danger-text';
        finalScore.textContent = `${gameState.score.p1} - ${gameState.score.p2}`;
    }

    // ==========================================
    // 渲染引擎
    // ==========================================
    function drawTank(tank, isP1) {
        ctx.save();
        ctx.translate(tank.x, tank.y);

        const primary = isP1 ? '#4ade80' : '#fb923c';
        const darkTone = isP1 ? '#166534' : '#9a3412';
        const lightTone = isP1 ? '#bbf7d0' : '#fed7aa';

        // 无敌闪烁或护盾光环
        if (tank.shield > 0) {
            ctx.save();
            ctx.strokeStyle = '#a78bfa';
            ctx.lineWidth = 3;
            ctx.fillStyle = 'rgba(167, 139, 250, 0.16)';
            ctx.beginPath();
            ctx.arc(0, 0, TANK_RADIUS + 7 + Math.sin(animTick * 0.2) * 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // 激光瞄准辅助虚线
        ctx.save();
        ctx.strokeStyle = isP1 ? 'rgba(74, 222, 128, 0.22)' : 'rgba(251, 146, 60, 0.22)';
        ctx.setLineDash([5, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(tank.turretAngle) * 24, Math.sin(tank.turretAngle) * 24);
        ctx.lineTo(Math.cos(tank.turretAngle) * 125, Math.sin(tank.turretAngle) * 125);
        ctx.stroke();
        ctx.restore();

        // 履带与车体旋转
        ctx.save();
        ctx.rotate(tank.hullAngle);

        // 左右履带
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-20, -21, 40, 9, 4);
        ctx.roundRect(-20, 12, 40, 9, 4);
        ctx.fill();
        ctx.stroke();

        // 车体装甲
        ctx.fillStyle = tank.hurtTimer > 0 ? '#ffffff' : primary;
        ctx.strokeStyle = darkTone;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-17, -14, 34, 28, 8);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // 炮塔与炮管
        ctx.save();
        ctx.rotate(tank.turretAngle);
        ctx.fillStyle = darkTone;
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(6, -4.5, 21, 9, 3);
        ctx.fill();
        ctx.stroke();

        // 圆润萌宠炮塔盖
        ctx.fillStyle = tank.hurtTimer > 0 ? '#ffffff' : lightTone;
        ctx.strokeStyle = darkTone;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 11.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // 顶部装甲血条格 (3格)：竖屏旋转时也保持在屏幕上方、横向排列
        view.upright(ctx, 0, 0);
        const barW = 34;
        const startX = -barW / 2;
        const barY = -TANK_RADIUS - 13;
        for (let i = 0; i < MAX_HP; i++) {
            ctx.fillStyle = i < tank.hp ? primary : 'rgba(15, 23, 42, 0.75)';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(startX + i * 12, barY, 10, 5, 2);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }

    function render() {
        view.begin(ctx);
        ctx.save();
        if (screenShake > 0) {
            ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
        }

        // 背景与战术网格
        ctx.fillStyle = '#0f191e';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
        ctx.lineWidth = 1;
        for (let x = ARENA_PAD; x <= WIDTH - ARENA_PAD; x += 38) {
            ctx.beginPath();
            ctx.moveTo(x, ARENA_PAD);
            ctx.lineTo(x, HEIGHT - ARENA_PAD);
            ctx.stroke();
        }
        for (let y = ARENA_PAD; y <= HEIGHT - ARENA_PAD; y += 38) {
            ctx.beginPath();
            ctx.moveTo(ARENA_PAD, y);
            ctx.lineTo(WIDTH - ARENA_PAD, y);
            ctx.stroke();
        }

        // 竞技场外墙边框
        ctx.strokeStyle = '#334e58';
        ctx.lineWidth = 4;
        ctx.strokeRect(ARENA_PAD, ARENA_PAD, WIDTH - ARENA_PAD * 2, HEIGHT - ARENA_PAD * 2);

        // 掩体障碍物
        for (const w of WALLS) {
            ctx.fillStyle = '#1e323b';
            ctx.strokeStyle = '#476b78';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(w.x, w.y, w.w, w.h, 6);
            ctx.fill();
            ctx.stroke();

            // 顶部科技斜纹高光
            ctx.fillStyle = 'rgba(148, 163, 184, 0.1)';
            ctx.fillRect(w.x + 3, w.y + 3, w.w - 6, 5);
        }

        // 战场空投道具
        if (gameState.powerup) {
            const p = gameState.powerup;
            const pulse = Math.sin(animTick * 0.12) * 3;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 15 + pulse * 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const icon = p.type === 'spread' ? '🔱' : (p.type === 'shield' ? '🛡️' : '🔧');
            view.upright(ctx, 0, 0);
            ctx.fillText(icon, 0, 1);
            ctx.restore();
        }

        // 炮弹绘制
        for (const b of gameState.bullets) {
            ctx.save();
            const color = b.owner === 1 ? '#4ade80' : '#fb923c';
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        // 坦克绘制
        drawTank(gameState.p1, true);
        drawTank(gameState.p2, false);

        // 粒子与飘字
        for (const p of particles) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        for (const t of popTexts) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, t.life / 20);
            ctx.font = '700 13px "Orbitron", sans-serif';
            ctx.fillStyle = t.color;
            ctx.textAlign = 'center';
            view.upright(ctx, t.x, t.y);
            ctx.fillText(t.text, 0, 0);
            ctx.restore();
        }

        // 回合横幅
        if (gameState.roundBannerTimer > 0 && gameState.roundBanner) {
            ctx.save();
            ctx.fillStyle = 'rgba(15, 25, 30, 0.78)';
            view.upright(ctx, WIDTH / 2, HEIGHT / 2); // 竖屏旋转时横幅也保持正向
            ctx.fillRect(-view.displayW / 2, -28, view.displayW, 56);
            ctx.font = '900 24px "Orbitron", sans-serif';
            ctx.fillStyle = '#f8fafc';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(gameState.roundBanner, 0, 0);
            ctx.restore();
        }

        ctx.restore();
    }

    render();
});
