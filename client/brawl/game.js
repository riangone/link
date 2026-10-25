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
    // 舞台与物理常量
    // ==========================================
    const WIDTH = canvas.width;        // 760
    const HEIGHT = canvas.height;      // 440
    const STAGE_LEFT = 80;
    const STAGE_RIGHT = 680;
    const STAGE_Y = 350;               // 主地面高度
    const PLATFORMS = [
        { x: 165, y: 245, w: 130 },    // 左侧云朵跳台
        { x: 465, y: 245, w: 130 }     // 右侧云朵跳台
    ];

    const CHAR_RADIUS = 26;
    const MAX_HP = 100;
    const WINNING_SCORE = 3;

    const GRAVITY = 0.56;
    const MOVE_ACCEL = 1.05;
    const MAX_MOVE_SPEED = 5.4;
    const GROUND_FRICTION = 0.80;
    const AIR_FRICTION = 0.94;
    const JUMP_VEL = -11.4;

    let myRole = null; // 'host' | 'client'
    let gameLoopInterval = null;
    let netSendInterval = null;
    let animTick = 0;

    // 本地与远端输入状态
    const localInput = { left: false, right: false, jump: false, punch: false, heavy: false, guard: false };
    const clientInput = { left: false, right: false, jump: false, punch: false, heavy: false, guard: false };
    let prevJumpHost = false;
    let prevJumpClient = false;
    let prevPunchHost = false;
    let prevPunchClient = false;
    let prevHeavyHost = false;
    let prevHeavyClient = false;

    // 视觉特效粒子与飘字（本地渲染）
    let particles = [];
    let popTexts = [];
    let screenShake = 0;

    function createFighter(id, x, facing) {
        return {
            id,
            x,
            y: STAGE_Y - CHAR_RADIUS,
            vx: 0,
            vy: 0,
            facing,            // 1: 向右, -1: 向左
            hp: MAX_HP,
            jumpsLeft: 2,
            grounded: true,
            state: 'idle',     // idle | run | jump | punch | heavy | guard | hurt | ko
            attackType: '',    // '' | 'punch' | 'heavy'
            attackTimer: 0,
            cooldownTimer: 0,
            hurtTimer: 0,
            invulnTimer: 0,
            combo: 0,
            hasHitThisSwing: false
        };
    }

    function createInitialState(score) {
        return {
            p1: createFighter(1, 230, 1),
            p2: createFighter(2, 530, -1),
            item: null, // { x, y, vy, type: 'berry' | 'star' }
            itemSpawnTimer: 260,
            score: score || { p1: 0, p2: 0 },
            roundBanner: 'READY!',
            roundBannerTimer: 55,
            status: 'lobby', // lobby | playing | gameover
            winner: 0
        };
    }

    let gameState = createInitialState();

    // ==========================================
    // 键盘与触屏虚拟按键控制
    // ==========================================
    function setKeyState(key, isDown) {
        const k = key.toLowerCase();
        if (k === 'a' || key === 'arrowleft') localInput.left = isDown;
        if (k === 'd' || key === 'arrowright') localInput.right = isDown;
        if (k === 'w' || k === 'arrowup' || k === ' ') localInput.jump = isDown;
        if (k === 's' || k === 'arrowdown' || k === 'l') localInput.guard = isDown;
        if (k === 'j' || k === 'z') localInput.punch = isDown;
        if (k === 'k' || k === 'x') localInput.heavy = isDown;
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

    // 触屏按键：多指同时按；拇指在 ◀ ▶ 之间、或从「拳」滑到「跳」不用抬手
    const setTouch = (action, down) => { localInput[action] = down; };
    GameFit.touchButtons(document.querySelector('.touch-dpad'), setTouch);
    GameFit.touchButtons(document.querySelector('.touch-actions'), setTouch);

    // 横版格斗只能横着玩：竖握手机时提示横过来；全屏按钮会顺便锁定横屏
    GameFit.configure({ landscapeOnly: true });
    const view = GameFit.view(canvas, { width: WIDTH, height: HEIGHT, onResize: () => render() });

    // ==========================================
    // 网络层：GameSession（不可靠低延迟模式）
    // ==========================================
    connectionStateText.textContent = '正在连接信号服务器...';

    const session = GameBot.session({
        gameFolder: 'brawl',
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
                p1Label.textContent = '🍑 蜜桃喵 (YOU)';
                p2Label.textContent = '🍮 布丁兔 (FOE)';
                roleText.innerHTML = `你是 <strong>Host (🍑 蜜桃喵)</strong>，位于左侧。<br>对手已就位，点击下方按钮开战！`;
            } else if (role === 'client') {
                p1Label.textContent = '🍑 蜜桃喵 (HOST)';
                p2Label.textContent = '🍮 布丁兔 (YOU)';
                roleText.innerHTML = `你是 <strong>Client (🍮 布丁兔)</strong>，位于右侧。<br>等待房主点击开始乱斗...`;
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
                gameState.item = msg.item;
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
                clientInput.left = !!msg.keys.left;
                clientInput.right = !!msg.keys.right;
                clientInput.jump = !!msg.keys.jump;
                clientInput.punch = !!msg.keys.punch;
                clientInput.heavy = !!msg.keys.heavy;
                clientInput.guard = !!msg.keys.guard;
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

    let pendingFx = null;

    function initGame() {
        gameState = createInitialState({ p1: 0, p2: 0 });
        gameState.status = 'playing';
        particles = [];
        popTexts = [];
        p1ScoreVal.textContent = '0';
        p2ScoreVal.textContent = '0';

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
                animTick++;
                updateVisualEffects();
                render();
            }
        }, 1000 / 60);

        clearInterval(netSendInterval);
        netSendInterval = setInterval(() => {
            if (gameState.status === 'playing') {
                sendGameData({
                    type: 'input',
                    keys: { ...localInput }
                });
            }
        }, 1000 / 35);
    }

    function resetRound(bannerText) {
        gameState.p1 = createFighter(1, 230, 1);
        gameState.p2 = createFighter(2, 530, -1);
        gameState.item = null;
        gameState.itemSpawnTimer = 240;
        gameState.roundBanner = bannerText || 'FIGHT!';
        gameState.roundBannerTimer = 65;
    }

    // ==========================================
    // Host 权威格斗引擎 (60 FPS)
    // ==========================================
    function hostGameLoop() {
        if (gameState.status !== 'playing') return;
        animTick++;

        if (gameState.roundBannerTimer > 0) {
            gameState.roundBannerTimer--;
        }

        // 更新双方战士动作与物理
        stepFighter(gameState.p1, localInput, prevJumpHost, prevPunchHost, prevHeavyHost);
        prevJumpHost = localInput.jump;
        prevPunchHost = localInput.punch;
        prevHeavyHost = localInput.heavy;

        if (GameBot.enabled) botStep();
        stepFighter(gameState.p2, clientInput, prevJumpClient, prevPunchClient, prevHeavyClient);
        prevJumpClient = clientInput.jump;
        prevPunchClient = clientInput.punch;
        prevHeavyClient = clientInput.heavy;

        // 双方身体软挤压防重叠
        resolveBodyPush(gameState.p1, gameState.p2);

        // 攻击命中判定
        checkAttackHit(gameState.p1, gameState.p2);
        checkAttackHit(gameState.p2, gameState.p1);

        // 随机掉落道具逻辑
        stepItems();

        // 判定 KO 或擂台掉落出界 (Ring Out)
        checkRoundOutcome();

        updateVisualEffects();
        render();
    }

    // ==========================================
    // 人机对手（?bot=easy|normal|hard）：布丁兔 (p2)
    // ==========================================
    // 状态机式的决策，每隔 react 帧重新判断：
    //  1. 掉出擂台 → 朝中心移动 + 下落时二段跳回场
    //  2. 对手正在出招且朝向自己 → 按概率举盾
    //  3. 贴身且朝向对手 → 快拳 / 重锤（对手残血或靠边时更爱用重锤）
    //  4. 否则靠近对手（对手在高台就跳上去），有道具时去抢
    const BOT = {
        react: GameBot.pick({ easy: 16, normal: 8, hard: 3 }),
        guard: GameBot.pick({ easy: 0.08, normal: 0.4, hard: 0.8 }),
        aggro: GameBot.pick({ easy: 0.25, normal: 0.6, hard: 0.95 }),
        heavy: GameBot.pick({ easy: 0.15, normal: 0.3, hard: 0.45 }),
        edgeSafe: GameBot.pick({ easy: 20, normal: 40, hard: 55 })
    };
    const bot = { timer: 0, plan: { left: false, right: false, jump: false, punch: false, heavy: false, guard: false }, press: 0, guardFor: 0, sawAttack: false };

    function botDecide() {
        const me = gameState.p2, foe = gameState.p1;
        const plan = { left: false, right: false, jump: false, punch: false, heavy: false, guard: false };
        const mid = (STAGE_LEFT + STAGE_RIGHT) / 2;
        const dx = foe.x - me.x, dy = foe.y - me.y;
        const dir = dx >= 0 ? 1 : -1;
        const offStage = me.x < STAGE_LEFT + 4 || me.x > STAGE_RIGHT - 4;

        // 1. 回场
        if (offStage || (!me.grounded && (me.x < STAGE_LEFT + 30 || me.x > STAGE_RIGHT - 30))) {
            if (me.x < mid) plan.right = true; else plan.left = true;
            if (!me.grounded && me.vy > 0 && me.jumpsLeft > 0 && me.y > STAGE_Y - 90) plan.jump = true;
            return plan;
        }
        // 2. 举盾
        const threat = foe.attackTimer > 0 && Math.abs(dx) < 95 && Math.abs(dy) < 50 && foe.facing === -dir;
        if (threat && !bot.sawAttack) {
            bot.sawAttack = true;
            if (me.grounded && Math.random() < BOT.guard) { bot.guardFor = foe.attackTimer + 4; }
        }
        if (!threat) bot.sawAttack = false;
        if (bot.guardFor > 0) { plan.guard = true; return plan; }

        // 3. 进攻
        const close = Math.abs(dx) < 62 && Math.abs(dy) < 36;
        if (close && foe.invulnTimer <= 0) {
            if (me.facing !== dir) { if (dir > 0) plan.right = true; else plan.left = true; return plan; }
            if (me.cooldownTimer === 0 && Math.random() < BOT.aggro) {
                const foeNearEdge = foe.x < STAGE_LEFT + 110 || foe.x > STAGE_RIGHT - 110;
                const wantHeavy = Math.random() < BOT.heavy + (foe.hp < 40 ? 0.25 : 0) + (foeNearEdge ? 0.2 : 0);
                // 别在擂台边缘朝外放重锤冲刺（会把自己冲下去）
                const heavySafe = !(me.x + dir * 90 < STAGE_LEFT || me.x + dir * 90 > STAGE_RIGHT);
                if (wantHeavy && heavySafe) plan.heavy = true; else plan.punch = true;
            }
            return plan;
        }
        // 对手无敌（吃了星星）：拉开距离
        if (foe.invulnTimer > 60 && Math.abs(dx) < 220) {
            const away = -dir;
            const target = me.x + away * 120;
            if (target > STAGE_LEFT + BOT.edgeSafe && target < STAGE_RIGHT - BOT.edgeSafe) { if (away > 0) plan.right = true; else plan.left = true; }
            else if (me.grounded && Math.random() < 0.3) plan.jump = true;
            return plan;
        }

        // 4. 移动：道具优先（血少或是星星），否则追人
        let tx = foe.x, ty = foe.y;
        const it = gameState.item;
        if (it && it.vy === 0 && (it.type === 'star' || me.hp < 70) && Math.abs(it.x - me.x) < Math.abs(dx) + 160) { tx = it.x; ty = it.y; }
        tx = Math.max(STAGE_LEFT + BOT.edgeSafe, Math.min(STAGE_RIGHT - BOT.edgeSafe, tx));
        if (tx > me.x + 18) plan.right = true; else if (tx < me.x - 18) plan.left = true;
        // 目标在上方平台：靠近后起跳；在空中下落时补二段跳
        if (ty < me.y - 50 && Math.abs(tx - me.x) < 120) {
            if (me.grounded) plan.jump = true;
            else if (me.vy > 1 && me.jumpsLeft > 0 && ty < me.y - 30) plan.jump = true;
        }
        // 目标在下方：在平台上就举盾穿透下落
        if (ty > me.y + 50 && me.grounded && me.y < STAGE_Y - CHAR_RADIUS - 10 && Math.abs(tx - me.x) < 60) { plan.guard = true; plan.left = plan.right = false; }
        return plan;
    }

    function botStep() {
        if (gameState.roundBannerTimer > 25) { GameBot.deliver({ type: 'input', keys: {} }); return; }
        if (bot.guardFor > 0) bot.guardFor--;
        if (--bot.timer <= 0) {
            bot.timer = BOT.react;
            bot.plan = botDecide();
            bot.press = 2; // 按键类（跳/拳/重锤）只按 2 帧，之后松开以便下一次触发
        }
        const keys = Object.assign({}, bot.plan);
        if (bot.press > 0) bot.press--;
        else { keys.jump = false; keys.punch = false; keys.heavy = false; }
        if (bot.guardFor > 0) { keys.guard = true; keys.left = keys.right = false; }
        GameBot.deliver({ type: 'input', keys });
    }
    GameBot.expose({ state: () => gameState });

    function stepFighter(f, inp, wasJump, wasPunch, wasHeavy) {
        if (f.invulnTimer > 0) f.invulnTimer--;
        if (f.cooldownTimer > 0) f.cooldownTimer--;

        const prevBottom = f.y + CHAR_RADIUS;

        // 受击硬直状态
        if (f.hurtTimer > 0) {
            f.hurtTimer--;
            f.state = 'hurt';
        } else if (f.attackTimer > 0) {
            f.attackTimer--;
            f.state = f.attackType;
            if (f.attackTimer === 0) {
                f.attackType = '';
                f.state = f.grounded ? 'idle' : 'jump';
            }
        } else {
            // 护盾状态
            if (inp.guard && f.grounded) {
                f.state = 'guard';
                f.vx *= 0.65;
            } else {
                // 左右移动
                if (inp.left && !inp.right) {
                    f.vx = Math.max(f.vx - MOVE_ACCEL, -MAX_MOVE_SPEED);
                    f.facing = -1;
                    if (f.grounded) f.state = 'run';
                } else if (inp.right && !inp.left) {
                    f.vx = Math.min(f.vx + MOVE_ACCEL, MAX_MOVE_SPEED);
                    f.facing = 1;
                    if (f.grounded) f.state = 'run';
                } else if (f.grounded) {
                    f.state = 'idle';
                }

                // 跳跃 / 二段跳
                if (inp.jump && !wasJump && f.jumpsLeft > 0) {
                    f.vy = JUMP_VEL;
                    f.grounded = false;
                    f.jumpsLeft--;
                    f.state = 'jump';
                    emitParticles(f.x, f.y + CHAR_RADIUS, '#ffffff', 6);
                }

                // 出招：喵喵快拳 (J)
                if (inp.punch && !wasPunch && f.cooldownTimer === 0) {
                    f.attackType = 'punch';
                    f.attackTimer = 14;
                    f.cooldownTimer = 20;
                    f.hasHitThisSwing = false;
                    f.state = 'punch';
                    f.vx += f.facing * 3.0;
                }
                // 出招：重锤冲刺 (K)
                else if (inp.heavy && !wasHeavy && f.cooldownTimer === 0) {
                    f.attackType = 'heavy';
                    f.attackTimer = 22;
                    f.cooldownTimer = 36;
                    f.hasHitThisSwing = false;
                    f.state = 'heavy';
                    f.vx = f.facing * 8.2;
                    if (f.grounded) f.vy = -3.2;
                }
            }
        }

        // 应用重力与速度阻尼
        f.vy = Math.min(f.vy + GRAVITY, 13.5);
        f.x += f.vx;
        f.y += f.vy;

        if (f.grounded) {
            f.vx *= GROUND_FRICTION;
        } else {
            f.vx *= AIR_FRICTION;
            if (f.hurtTimer === 0 && f.attackTimer === 0) {
                f.state = 'jump';
            }
        }

        // 平台与主擂台碰撞检测
        f.grounded = false;
        const newBottom = f.y + CHAR_RADIUS;

        // 1. 主舞台地面
        if (f.x >= STAGE_LEFT - 12 && f.x <= STAGE_RIGHT + 12) {
            if (prevBottom <= STAGE_Y + 8 && newBottom >= STAGE_Y && f.vy >= 0) {
                f.y = STAGE_Y - CHAR_RADIUS;
                f.vy = 0;
                f.grounded = true;
                f.jumpsLeft = 2;
            }
        }

        // 2. 浮空云朵跳台（按住下/护盾时可穿透下落）
        if (!f.grounded && !inp.guard) {
            for (const plat of PLATFORMS) {
                if (f.x >= plat.x - 6 && f.x <= plat.x + plat.w + 6) {
                    if (prevBottom <= plat.y + 6 && newBottom >= plat.y && f.vy >= 0) {
                        f.y = plat.y - CHAR_RADIUS;
                        f.vy = 0;
                        f.grounded = true;
                        f.jumpsLeft = 2;
                        break;
                    }
                }
            }
        }
    }

    function resolveBodyPush(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = CHAR_RADIUS * 1.85;
        if (dist < minDist && dist > 0.01) {
            const push = (minDist - dist) * 0.35;
            const nx = dx / dist;
            a.x -= nx * push;
            b.x += nx * push;
        }
    }

    function checkAttackHit(attacker, defender) {
        if (attacker.attackTimer <= 0 || attacker.hasHitThisSwing) return;

        // 判定帧窗口
        const isPunchActive = attacker.attackType === 'punch' && attacker.attackTimer >= 4 && attacker.attackTimer <= 11;
        const isHeavyActive = attacker.attackType === 'heavy' && attacker.attackTimer >= 5 && attacker.attackTimer <= 17;
        if (!isPunchActive && !isHeavyActive) return;

        const reach = attacker.attackType === 'heavy' ? 44 : 34;
        const hitX = attacker.x + attacker.facing * reach;
        const hitY = attacker.y;
        const hitRadius = attacker.attackType === 'heavy' ? 30 : 25;

        const dist = Math.hypot(defender.x - hitX, defender.y - hitY);
        if (dist <= hitRadius + CHAR_RADIUS) {
            attacker.hasHitThisSwing = true;

            if (defender.invulnTimer > 0) {
                recordFx(defender.x, defender.y - 25, '✨ IMMUNE!', '#ffd54f');
                return;
            }

            const isGuarding = defender.state === 'guard';
            const baseDmg = attacker.attackType === 'heavy' ? 18 : 9;
            const dmg = isGuarding ? Math.max(2, Math.round(baseDmg * 0.2)) : baseDmg;

            defender.hp = Math.max(0, defender.hp - dmg);
            attacker.combo = (attacker.combo || 0) + 1;

            // 击退与击飞力与敌方已损血量正相关（大乱斗风格）
            const missingHpRatio = (MAX_HP - defender.hp) / MAX_HP;
            const kbScale = 1 + missingHpRatio * 0.75;

            if (isGuarding) {
                defender.vx = attacker.facing * 3.5;
                recordFx(defender.x, defender.y - 30, `🛡️ -${dmg}`, '#4dd0e1');
            } else {
                defender.hurtTimer = attacker.attackType === 'heavy' ? 18 : 11;
                defender.attackTimer = 0;
                const launchX = (attacker.attackType === 'heavy' ? 9.6 : 5.6) * kbScale;
                const launchY = (attacker.attackType === 'heavy' ? -7.2 : -4.0) * kbScale;
                defender.vx = attacker.facing * launchX;
                defender.vy = launchY;
                defender.grounded = false;

                const label = attacker.attackType === 'heavy' ? `💥 POW! -${dmg}` : `🐾 -${dmg}`;
                const color = attacker.attackType === 'heavy' ? '#ffd54f' : '#ff6b9d';
                recordFx(defender.x, defender.y - 32, label, color);
            }
        }
    }

    function stepItems() {
        if (!gameState.item) {
            gameState.itemSpawnTimer--;
            if (gameState.itemSpawnTimer <= 0) {
                const type = Math.random() < 0.6 ? 'berry' : 'star';
                gameState.item = {
                    x: 180 + Math.random() * 400,
                    y: 40,
                    vy: 1.5,
                    type
                };
                gameState.itemSpawnTimer = 380;
            }
        } else {
            const it = gameState.item;
            it.y += it.vy;
            it.vy = Math.min(it.vy + 0.22, 5);
            if (it.y >= STAGE_Y - 16) {
                it.y = STAGE_Y - 16;
                it.vy = 0;
            }

            // 检查玩家拾取
            for (const f of [gameState.p1, gameState.p2]) {
                if (Math.hypot(f.x - it.x, f.y - it.y) < CHAR_RADIUS + 20) {
                    if (it.type === 'berry') {
                        f.hp = Math.min(MAX_HP, f.hp + 28);
                        recordFx(f.x, f.y - 34, '🍓 +28 HP!', '#4ade80');
                    } else {
                        f.invulnTimer = 210; // 3.5秒无敌元气星
                        recordFx(f.x, f.y - 34, '⭐ STAR POWER!', '#ffd54f');
                    }
                    gameState.item = null;
                    break;
                }
            }
        }
    }

    function checkRoundOutcome() {
        const p1Out = gameState.p1.hp <= 0 || gameState.p1.y > HEIGHT + 70 || gameState.p1.x < -70 || gameState.p1.x > WIDTH + 70;
        const p2Out = gameState.p2.hp <= 0 || gameState.p2.y > HEIGHT + 70 || gameState.p2.x < -70 || gameState.p2.x > WIDTH + 70;

        if (!p1Out && !p2Out) return;

        if (p1Out && !p2Out) {
            onRoundWin(2);
        } else if (p2Out && !p1Out) {
            onRoundWin(1);
        } else {
            // 同归于尽默认残余血量高者获胜
            onRoundWin(gameState.p1.hp >= gameState.p2.hp ? 1 : 2);
        }
    }

    function onRoundWin(scorer) {
        if (scorer === 1) {
            gameState.score.p1 += 1;
            p1ScoreVal.textContent = gameState.score.p1;
        } else {
            gameState.score.p2 += 1;
            p2ScoreVal.textContent = gameState.score.p2;
        }

        recordFx(WIDTH / 2, HEIGHT / 2 - 20, scorer === 1 ? '🍑 蜜桃喵 KO!' : '🍮 布丁兔 KO!', '#ffd54f');

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
            const roundNum = gameState.score.p1 + gameState.score.p2 + 1;
            resetRound(`ROUND ${roundNum} — FIGHT!`);
            broadcastState();
        }
    }

    function recordFx(x, y, text, color) {
        const fx = { x: Math.round(x), y: Math.round(y), text, color };
        pendingFx = fx;
        triggerFxEvent(fx);
    }

    function triggerFxEvent(fx) {
        popTexts.push({
            x: fx.x,
            y: fx.y,
            text: fx.text,
            color: fx.color || '#ffd54f',
            life: 38
        });
        emitParticles(fx.x, fx.y + 15, fx.color || '#ffd54f', 12);
        screenShake = 7;
    }

    function emitParticles(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 4.5;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1,
                radius: 3 + Math.random() * 4,
                color,
                life: 18 + Math.floor(Math.random() * 12)
            });
        }
    }

    function updateVisualEffects() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.15;
            p.life--;
            if (p.life <= 0) particles.splice(i, 1);
        }

        for (let i = popTexts.length - 1; i >= 0; i--) {
            const t = popTexts[i];
            t.y -= 0.9;
            t.life--;
            if (t.life <= 0) popTexts.splice(i, 1);
        }

        if (screenShake > 0) screenShake--;
    }

    function packFighter(f) {
        return {
            id: f.id,
            x: Math.round(f.x * 10) / 10,
            y: Math.round(f.y * 10) / 10,
            vx: Math.round(f.vx * 10) / 10,
            vy: Math.round(f.vy * 10) / 10,
            facing: f.facing,
            hp: f.hp,
            state: f.state,
            attackType: f.attackType,
            attackTimer: f.attackTimer,
            hurtTimer: f.hurtTimer,
            invulnTimer: f.invulnTimer,
            grounded: f.grounded
        };
    }

    function broadcastState() {
        sendGameData({
            type: 'state',
            p1: packFighter(gameState.p1),
            p2: packFighter(gameState.p2),
            item: gameState.item,
            score: gameState.score,
            roundBanner: gameState.roundBanner,
            roundBannerTimer: gameState.roundBannerTimer,
            status: gameState.status,
            winner: gameState.winner,
            fx: pendingFx
        });
        pendingFx = null;
    }

    // ==========================================
    // Q版软萌画面渲染
    // ==========================================
    function render() {
        view.begin(ctx);
        ctx.save();
        if (screenShake > 0) {
            const sx = (Math.random() - 0.5) * screenShake * 1.6;
            const sy = (Math.random() - 0.5) * screenShake * 1.6;
            ctx.translate(sx, sy);
        }

        // 1. 梦幻星空渐变背景
        const bgGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
        bgGrad.addColorStop(0, '#1e1638');
        bgGrad.addColorStop(0.6, '#2b1e4a');
        bgGrad.addColorStop(1, '#17112b');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // 背景闪烁小星星与软云
        drawBackgroundDecor();

        // 2. 浮空云朵跳台
        for (const plat of PLATFORMS) {
            drawCloudPlatform(plat.x, plat.y, plat.w);
        }

        // 3. 糖果浮空主擂台
        drawMainStage();

        // 4. 掉落道具
        if (gameState.item) {
            drawItem(gameState.item);
        }

        // 5. 绘制两名 Q 版萌系战士
        drawChibiFighter(gameState.p1, true);
        drawChibiFighter(gameState.p2, false);

        // 6. 粒子与受击飘字
        drawParticlesAndPopups();

        // 7. 顶部血条 HUD 与回合横幅
        drawHud();

        ctx.restore();
    }

    function drawBackgroundDecor() {
        ctx.save();
        const stars = [
            { x: 90, y: 70, r: 2 }, { x: 210, y: 50, r: 3 },
            { x: 380, y: 80, r: 2.5 }, { x: 550, y: 55, r: 2 },
            { x: 670, y: 90, r: 3 }, { x: 140, y: 160, r: 2 },
            { x: 620, y: 170, r: 2.5 }
        ];
        for (let i = 0; i < stars.length; i++) {
            const s = stars[i];
            const alpha = 0.35 + 0.35 * Math.sin(animTick * 0.06 + i);
            ctx.fillStyle = `rgba(255, 235, 170, ${alpha})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawCloudPlatform(x, y, w) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 245, 252, 0.92)';
        ctx.shadowColor = 'rgba(255, 107, 157, 0.3)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.roundRect(x, y, w, 16, 10);
        ctx.fill();

        // 粉色糖霜顶边
        ctx.fillStyle = '#ff9ebb';
        ctx.beginPath();
        ctx.roundRect(x + 4, y, w - 8, 5, 4);
        ctx.fill();
        ctx.restore();
    }

    function drawMainStage() {
        ctx.save();
        const w = STAGE_RIGHT - STAGE_LEFT;
        // 舞台底座
        const baseGrad = ctx.createLinearGradient(0, STAGE_Y, 0, STAGE_Y + 46);
        baseGrad.addColorStop(0, '#493975');
        baseGrad.addColorStop(1, '#261d42');
        ctx.fillStyle = baseGrad;
        ctx.beginPath();
        ctx.roundRect(STAGE_LEFT, STAGE_Y, w, 44, [12, 12, 22, 22]);
        ctx.fill();

        // 舞台草坪/奶油顶面
        const topGrad = ctx.createLinearGradient(STAGE_LEFT, 0, STAGE_RIGHT, 0);
        topGrad.addColorStop(0, '#ff80ab');
        topGrad.addColorStop(0.5, '#ffb2dd');
        topGrad.addColorStop(1, '#80deea');
        ctx.fillStyle = topGrad;
        ctx.shadowColor = 'rgba(255, 128, 171, 0.35)';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.roundRect(STAGE_LEFT - 4, STAGE_Y - 2, w + 8, 12, 8);
        ctx.fill();
        ctx.restore();
    }

    function drawItem(it) {
        ctx.save();
        const bob = Math.sin(animTick * 0.12) * 4;
        ctx.translate(it.x, it.y + bob);

        ctx.beginPath();
        ctx.arc(0, 0, 17, 0, Math.PI * 2);
        ctx.fillStyle = it.type === 'berry' ? 'rgba(255, 107, 157, 0.28)' : 'rgba(255, 213, 79, 0.32)';
        ctx.fill();

        ctx.font = '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.type === 'berry' ? '🍓' : '⭐', 0, 1);
        ctx.restore();
    }

    function drawChibiFighter(f, isP1) {
        ctx.save();

        // 地面投影阴影
        if (f.y < STAGE_Y + 20 && f.x >= STAGE_LEFT && f.x <= STAGE_RIGHT) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
            ctx.beginPath();
            ctx.ellipse(f.x, STAGE_Y + 2, 22, 6, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.translate(f.x, f.y);

        // Q版果冻呼吸与奔跑挤压拉伸 (Squash & Stretch)
        let scaleX = 1;
        let scaleY = 1;
        if (f.state === 'run') {
            scaleX = 1 + Math.sin(animTick * 0.35) * 0.08;
            scaleY = 1 - Math.sin(animTick * 0.35) * 0.08;
        } else if (f.state === 'jump') {
            scaleX = 0.92;
            scaleY = 1.1;
        } else if (f.state === 'hurt') {
            scaleX = 1.15;
            scaleY = 0.86;
        } else {
            scaleX = 1 + Math.sin(animTick * 0.1) * 0.03;
            scaleY = 1 - Math.sin(animTick * 0.1) * 0.03;
        }
        ctx.scale(scaleX, scaleY);

        const bodyColor = isP1 ? '#ff85a2' : '#64d8cb';
        const strokeColor = isP1 ? '#ff477e' : '#26a69a';
        const earColor = isP1 ? '#ffb3c6' : '#b2ebf2';

        // 无敌星金光环绕
        if (f.invulnTimer > 0) {
            ctx.save();
            ctx.strokeStyle = '#ffd54f';
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.arc(0, 0, CHAR_RADIUS + 8, animTick * 0.1, animTick * 0.1 + Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // 1. 绘制萌系耳朵 (P1: 尖尖猫耳, P2: 长长垂耳兔耳)
        ctx.fillStyle = bodyColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3;
        if (isP1) {
            // 左猫耳
            ctx.beginPath();
            ctx.moveTo(-18, -16);
            ctx.lineTo(-24, -34);
            ctx.lineTo(-6, -24);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            // 右猫耳
            ctx.beginPath();
            ctx.moveTo(18, -16);
            ctx.lineTo(24, -34);
            ctx.lineTo(6, -24);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else {
            // 兔耳
            const earBob = Math.sin(animTick * 0.15) * 2;
            ctx.beginPath();
            ctx.ellipse(-11, -30 + earBob, 6, 14, -0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(11, -30 - earBob, 6, 14, 0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // 2. 绘制圆滚滚糯米团子身体
        ctx.beginPath();
        ctx.arc(0, 0, CHAR_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = f.hurtTimer > 0 && animTick % 4 < 2 ? '#ffffff' : bodyColor;
        ctx.shadowColor = isP1 ? 'rgba(255, 107, 157, 0.45)' : 'rgba(77, 208, 225, 0.45)';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();

        // 头顶小呆毛或皇冠标记（区分自己）
        const isMe = (isP1 && myRole === 'host') || (!isP1 && myRole === 'client');
        if (isMe) {
            ctx.fillStyle = '#ffd54f';
            ctx.font = 'bold 10px Orbitron, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('▼ YOU', 0, -44);
        }

        // 3. 绘制 Q 版表情（大眼睛 + 粉红腮红 + 嘴巴）
        const faceOffsetX = f.facing * 5;
        // 腮红
        ctx.fillStyle = 'rgba(255, 82, 120, 0.45)';
        ctx.beginPath();
        ctx.ellipse(faceOffsetX - 12, 4, 5, 3, 0, 0, Math.PI * 2);
        ctx.ellipse(faceOffsetX + 12, 4, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#231934';
        ctx.fillStyle = '#231934';
        ctx.lineWidth = 2.5;

        if (f.hurtTimer > 0) {
            // 受击 > < 哭哭眼
            // 左眼 >
            ctx.beginPath();
            ctx.moveTo(faceOffsetX - 11, -7);
            ctx.lineTo(faceOffsetX - 6, -3);
            ctx.lineTo(faceOffsetX - 11, 1);
            ctx.stroke();
            // 右眼 <
            ctx.beginPath();
            ctx.moveTo(faceOffsetX + 11, -7);
            ctx.lineTo(faceOffsetX + 6, -3);
            ctx.lineTo(faceOffsetX + 11, 1);
            ctx.stroke();
            // 惊讶 O 嘴
            ctx.beginPath();
            ctx.arc(faceOffsetX, 7, 3.5, 0, Math.PI * 2);
            ctx.stroke();
        } else if (f.attackTimer > 0) {
            // 出招认真元气眼神
            ctx.beginPath();
            ctx.arc(faceOffsetX - 8, -3, 3.2, 0, Math.PI * 2);
            ctx.arc(faceOffsetX + 8, -3, 3.2, 0, Math.PI * 2);
            ctx.fill();
            // 气势小嘴
            ctx.beginPath();
            ctx.arc(faceOffsetX, 6, 4, 0, Math.PI);
            ctx.fill();
        } else {
            // 呆萌水汪汪大眼
            ctx.beginPath();
            ctx.arc(faceOffsetX - 8, -4, 3.6, 0, Math.PI * 2);
            ctx.arc(faceOffsetX + 8, -4, 3.6, 0, Math.PI * 2);
            ctx.fill();
            // 眼神高光
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(faceOffsetX - 9, -5.2, 1.3, 0, Math.PI * 2);
            ctx.arc(faceOffsetX + 7, -5.2, 1.3, 0, Math.PI * 2);
            ctx.fill();
            // 猫猫 ω 微笑嘴
            ctx.strokeStyle = '#231934';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(faceOffsetX - 2.5, 5, 2.5, 0, Math.PI);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(faceOffsetX + 2.5, 5, 2.5, 0, Math.PI);
            ctx.stroke();
        }

        // 4. 护盾气泡或出招特效（肉球拳套 / 糯米重锤）
        if (f.state === 'guard') {
            ctx.strokeStyle = 'rgba(77, 208, 225, 0.85)';
            ctx.fillStyle = 'rgba(77, 208, 225, 0.22)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, CHAR_RADIUS + 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (f.attackTimer > 0) {
            if (f.attackType === 'punch') {
                // Q版粉色猫爪拳残影
                const punchExtend = f.facing * (CHAR_RADIUS + 14);
                ctx.fillStyle = '#ffeff5';
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(punchExtend, 2, 13, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                // 粉色小肉垫
                ctx.fillStyle = '#ff6b9d';
                ctx.beginPath();
                ctx.arc(punchExtend + f.facing * 2, 2, 5, 0, Math.PI * 2);
                ctx.fill();
            } else if (f.attackType === 'heavy') {
                // Q版黄金大木槌挥击
                const hammerX = f.facing * (CHAR_RADIUS + 20);
                ctx.save();
                ctx.translate(hammerX, -2);
                // 锤柄
                ctx.strokeStyle = '#8d6e63';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(-f.facing * 14, 8);
                ctx.lineTo(0, 0);
                ctx.stroke();
                // 锤头
                ctx.fillStyle = '#ffd54f';
                ctx.strokeStyle = '#ff8f00';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.roundRect(-12, -16, 24, 28, 7);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        ctx.restore();
    }

    function drawParticlesAndPopups() {
        ctx.save();
        for (const p of particles) {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.life / 28);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        for (const t of popTexts) {
            ctx.font = 'bold 16px "Fredoka", "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = t.color;
            ctx.strokeStyle = '#18122b';
            ctx.lineWidth = 4;
            ctx.strokeText(t.text, t.x, t.y);
            ctx.fillText(t.text, t.x, t.y);
        }
        ctx.restore();
    }

    function drawHud() {
        ctx.save();
        // P1 左侧血条
        drawHealthBar(28, 22, 260, 20, gameState.p1.hp, MAX_HP, '#ff6b9d', '🍑 蜜桃喵 P1', false);
        // P2 右侧血条
        drawHealthBar(WIDTH - 288, 22, 260, 20, gameState.p2.hp, MAX_HP, '#4dd0e1', '🍮 布丁兔 P2', true);

        // 中央 VS 徽章与比分开局提示
        ctx.fillStyle = '#ffd54f';
        ctx.font = '900 18px Orbitron, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${gameState.score.p1} : ${gameState.score.p2}`, WIDTH / 2, 38);

        // 回合横幅动画
        if (gameState.roundBannerTimer > 0 && gameState.roundBanner) {
            ctx.save();
            ctx.font = '900 34px Orbitron, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffd54f';
            ctx.strokeStyle = '#1b112c';
            ctx.lineWidth = 6;
            ctx.strokeText(gameState.roundBanner, WIDTH / 2, HEIGHT / 2 - 40);
            ctx.fillText(gameState.roundBanner, WIDTH / 2, HEIGHT / 2 - 40);
            ctx.restore();
        }
        ctx.restore();
    }

    function drawHealthBar(x, y, w, h, hp, maxHp, color, label, alignRight) {
        ctx.save();
        const ratio = Math.max(0, Math.min(1, hp / maxHp));

        // 背板
        ctx.fillStyle = 'rgba(15, 12, 28, 0.78)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 10);
        ctx.fill();
        ctx.stroke();

        // 血量填充
        const fillW = Math.max(0, (w - 4) * ratio);
        if (fillW > 0) {
            ctx.fillStyle = hp <= 25 ? '#ff5252' : color;
            ctx.beginPath();
            const fillX = alignRight ? (x + w - 2 - fillW) : (x + 2);
            ctx.roundRect(fillX, y + 2, fillW, h - 4, 8);
            ctx.fill();
        }

        // 名字与血量数字
        ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = alignRight ? 'right' : 'left';
        ctx.fillText(`${label} (${hp}%)`, alignRight ? x + w - 6 : x + 6, y + 36);
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
        winnerMascot.textContent = gameState.winner === 1 ? '🍑👑' : '🍮👑';

        const iWon = (gameState.winner === 1 && myRole === 'host') ||
                     (gameState.winner === 2 && myRole === 'client');
        if (iWon) {
            winLossTitle.textContent = 'VICTORY!';
            winLossTitle.className = 'neon-text';
        } else {
            winLossTitle.textContent = 'DEFEAT!';
            winLossTitle.className = 'danger-text';
        }
    }

    // 首帧渲染
    render();
});
