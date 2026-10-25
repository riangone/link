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
    const turnBanner = document.getElementById('turn-banner');
    const shotClockEl = document.getElementById('shot-clock');
    const moveCountText = document.getElementById('move-count-text');
    const emoteToast = document.getElementById('emote-toast');
    const undoBtn = document.getElementById('undo-btn');

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
    // 15×15 棋盘几何常量
    // ==========================================
    const SIZE = 15;
    const WIDTH = canvas.width;        // 540
    const PAD = 38;
    const CELL = (WIDTH - PAD * 2) / (SIZE - 1); // 33.14px
    const view = GameFit.view(canvas, { width: WIDTH, height: WIDTH, onResize: () => render() });
    // 触屏防误触：第一次轻点只放「预选虚影」，再点同一个交叉点才真正落子
    let touchPending = null; // {row, col} | null
    const TURN_TIME_LIMIT = 15;        // 每手 15 秒闪电限时

    let myRole = null;                 // 'host' (1: 黑) | 'client' (2: 白)
    let renderLoop = null;
    let clockInterval = null;
    let animTick = 0;
    let emoteTimer = null;

    // 鼠标/键盘悬浮坐标
    let cursorRow = 7;
    let cursorCol = 7;

    function createEmptyBoard() {
        return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    }

    function createInitialState(score, starter) {
        return {
            board: createEmptyBoard(),
            history: [],               // [{ r, c, player }]
            turn: starter || 1,        // 1: Host (⚫), 2: Client (⚪)
            timeLeft: TURN_TIME_LIMIT,
            score: score || { p1: 0, p2: 0 },
            winLine: null,             // [{r, c}, ...] 五连珠坐标
            status: 'lobby',           // lobby | playing | gameover
            winner: 0                  // 0 | 1 | 2 | 3 (平局)
        };
    }

    let gameState = createInitialState();

    // ==========================================
    // 网络层：GameSession（可靠有序回合同步模式）
    // ==========================================
    connectionStateText.textContent = '正在连接信号服务器...';

    const session = GameBot.session({
        gameFolder: 'gomoku',
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
                p1Label.textContent = '⚫ 曜石黑 (YOU)';
                p2Label.textContent = '⚪ 星光白 (FOE)';
                roleText.innerHTML = `你是 <strong>Host (⚫ 曜石黑)</strong>。<br>对手已就绪，点击下方按钮开始五子连珠对弈！`;
            } else if (role === 'client') {
                p1Label.textContent = '⚫ 曜石黑 (HOST)';
                p2Label.textContent = '⚪ 星光白 (YOU)';
                roleText.innerHTML = `你是 <strong>Client (⚪ 星光白)</strong>。<br>等待房主点击开始棋局...`;
            }
            updateHud();
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
            clearInterval(clockInterval);
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
            gameState.board = msg.board;
            gameState.history = msg.history || [];
            gameState.turn = msg.turn;
            gameState.timeLeft = msg.timeLeft;
            gameState.score = msg.score;
            gameState.winLine = msg.winLine || null;
            gameState.status = msg.status;
            gameState.winner = msg.winner;

            p1ScoreVal.textContent = gameState.score.p1;
            p2ScoreVal.textContent = gameState.score.p2;
            moveCountText.textContent = String(gameState.history.length);
            updateHud();

            if (gameState.status === 'playing') {
                overlay.classList.add('hidden');
                restartBtn.textContent = 'NEXT ROUND';
                restartBtn.disabled = false;
            } else if (gameState.status === 'gameover') {
                showGameOver();
            }
        } else if (msg.type === 'place') {
            if (myRole === 'host' && gameState.status === 'playing' && gameState.turn === 2) {
                attemptPlaceStone(msg.r, msg.c, 2);
            }
        } else if (msg.type === 'undo') {
            if (myRole === 'host' && gameState.status === 'playing' && gameState.history.length > 0) {
                const last = gameState.history.pop();
                gameState.board[last.r][last.c] = 0;
                gameState.turn = last.player;
                gameState.timeLeft = TURN_TIME_LIMIT;
                broadcastState();
                showEmote('↩️ 已撤回上一手落子');
                sendGameData({ type: 'emote', text: '↩️ 已撤回上一手落子' });
            }
        } else if (msg.type === 'emote') {
            if (msg.text) showEmote(msg.text);
        } else if (msg.type === 'restart-request') {
            if (myRole === 'host') {
                startNewMatch();
            }
        }
    }

    function broadcastState() {
        p1ScoreVal.textContent = gameState.score.p1;
        p2ScoreVal.textContent = gameState.score.p2;
        moveCountText.textContent = String(gameState.history.length);
        updateHud();
        sendGameData({
            type: 'state',
            board: gameState.board,
            history: gameState.history,
            turn: gameState.turn,
            timeLeft: gameState.timeLeft,
            score: gameState.score,
            winLine: gameState.winLine,
            status: gameState.status,
            winner: gameState.winner
        });
    }

    // ==========================================
    // 棋局逻辑与五连珠判定
    // ==========================================
    function checkWin(board, r, c, player) {
        const dirs = [
            [0, 1],   // 横向
            [1, 0],   // 纵向
            [1, 1],   // 正斜 \
            [1, -1]   // 反斜 /
        ];
        for (const [dr, dc] of dirs) {
            const line = [{ r, c }];
            for (let step = 1; step < 5; step++) {
                const nr = r + dr * step;
                const nc = c + dc * step;
                if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === player) {
                    line.push({ r: nr, c: nc });
                } else break;
            }
            for (let step = 1; step < 5; step++) {
                const nr = r - dr * step;
                const nc = c - dc * step;
                if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] === player) {
                    line.unshift({ r: nr, c: nc });
                } else break;
            }
            if (line.length >= 5) {
                return line;
            }
        }
        return null;
    }

    function attemptPlaceStone(r, c, player) {
        if (gameState.status !== 'playing') return false;
        if (gameState.turn !== player) return false;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
        if (gameState.board[r][c] !== 0) return false;

        gameState.board[r][c] = player;
        gameState.history.push({ r, c, player });

        const winLine = checkWin(gameState.board, r, c, player);
        if (winLine) {
            gameState.winLine = winLine;
            gameState.status = 'gameover';
            gameState.winner = player;
            if (player === 1) gameState.score.p1++;
            else gameState.score.p2++;
            broadcastState();
            showGameOver();
            return true;
        }

        if (gameState.history.length >= SIZE * SIZE) {
            gameState.status = 'gameover';
            gameState.winner = 3; // 平局
            broadcastState();
            showGameOver();
            return true;
        }

        gameState.turn = player === 1 ? 2 : 1;
        gameState.timeLeft = TURN_TIME_LIMIT;
        broadcastState();
        return true;
    }

    function autoPlaceForTimeout(player) {
        // 优先从天元 (7,7) 向外螺旋寻找空位自动落子
        const center = 7;
        const candidates = [];
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (gameState.board[r][c] === 0) {
                    const dist = Math.hypot(r - center, c - center);
                    candidates.push({ r, c, dist });
                }
            }
        }
        if (candidates.length > 0) {
            candidates.sort((a, b) => a.dist - b.dist);
            const pick = candidates[0];
            attemptPlaceStone(pick.r, pick.c, player);
        }
    }

    function startNewMatch() {
        const totalGames = gameState.score.p1 + gameState.score.p2;
        const starter = (totalGames % 2 === 0) ? 1 : 2;
        gameState = createInitialState(gameState.score, starter);
        gameState.status = 'playing';
        overlay.classList.add('hidden');
        restartBtn.textContent = 'NEXT ROUND';
        restartBtn.disabled = false;

        clearInterval(clockInterval);
        clockInterval = setInterval(() => {
            if (gameState.status !== 'playing') return;
            gameState.timeLeft--;
            if (gameState.timeLeft <= 0) {
                autoPlaceForTimeout(gameState.turn);
            } else {
                broadcastState();
            }
        }, 1000);

        broadcastState();
    }

    function updateHud() {
        shotClockEl.textContent = `${gameState.timeLeft}s`;
        if (gameState.status !== 'playing') {
            turnBanner.textContent = '等待对局开始...';
            return;
        }
        const myPlayerNum = myRole === 'host' ? 1 : 2;
        const isMyTurn = gameState.turn === myPlayerNum;
        if (gameState.turn === 1) {
            turnBanner.innerHTML = isMyTurn
                ? '🟢 <strong>轮到你落子</strong> (⚫ 曜石黑)'
                : '⏳ 对手思考中... (⚫ 曜石黑)';
        } else {
            turnBanner.innerHTML = isMyTurn
                ? '🟢 <strong>轮到你落子</strong> (⚪ 星光白)'
                : '⏳ 对手思考中... (⚪ 星光白)';
        }
    }

    function showEmote(text) {
        emoteToast.textContent = text;
        emoteToast.classList.remove('hidden');
        clearTimeout(emoteTimer);
        emoteTimer = setTimeout(() => {
            emoteToast.classList.add('hidden');
        }, 2600);
    }

    function showGameOver() {
        clearInterval(clockInterval);
        setTimeout(() => {
            if (gameState.status !== 'gameover') return;
            overlay.classList.remove('hidden');
            lobbyScreen.classList.add('hidden');
            readyScreen.classList.add('hidden');
            gameoverScreen.classList.remove('hidden');
            disconnectScreen.classList.add('hidden');

            const myPlayerNum = myRole === 'host' ? 1 : 2;
            const isWinner = gameState.winner === myPlayerNum;

            winnerMascot.textContent = gameState.winner === 1 ? '⚫👑' : (gameState.winner === 2 ? '⚪👑' : '🤝');
            winLossTitle.textContent = gameState.winner === 3 ? 'DRAW GAME' : (isWinner ? 'VICTORY!' : 'DEFEAT');
            winLossTitle.className = isWinner ? 'neon-text' : 'danger-text';
            finalScore.textContent = `${gameState.score.p1} - ${gameState.score.p2}`;
        }, 650);
    }

    // ==========================================
    // 鼠标、触屏与键盘落子交互
    // ==========================================
    function pointerToGrid(e) {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = (e.clientX - rect.left) * (WIDTH / rect.width);
        const y = (e.clientY - rect.top) * (WIDTH / rect.height);
        const col = Math.round((x - PAD) / CELL);
        const row = Math.round((y - PAD) / CELL);
        if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
        return { row, col };
    }

    canvas.addEventListener('mousemove', e => {
        const pos = pointerToGrid(e);
        if (pos) {
            cursorRow = pos.row;
            cursorCol = pos.col;
        }
    });

    function triggerPlaceAt(row, col) {
        if (gameState.status !== 'playing') return;
        const myPlayerNum = myRole === 'host' ? 1 : 2;
        if (gameState.turn !== myPlayerNum) return;
        if (gameState.board[row][col] !== 0) return;

        if (myRole === 'host') {
            attemptPlaceStone(row, col, 1);
        } else if (myRole === 'client') {
            sendGameData({ type: 'place', r: row, c: col });
        }
    }

    let lastPointerType = 'mouse';
    canvas.addEventListener('pointerdown', e => { lastPointerType = e.pointerType || 'mouse'; });
    canvas.addEventListener('click', e => {
        const pos = pointerToGrid(e);
        if (!pos) return;
        cursorRow = pos.row;
        cursorCol = pos.col;
        if (lastPointerType === 'touch' || lastPointerType === 'pen') {
            if (!touchPending || touchPending.row !== pos.row || touchPending.col !== pos.col) {
                touchPending = { row: pos.row, col: pos.col };
                GameFit.buzz(6);
                return;
            }
        }
        touchPending = null;
        triggerPlaceAt(pos.row, pos.col);
    });

    window.addEventListener('keydown', e => {
        if (gameState.status !== 'playing') return;
        const k = e.key.toLowerCase();
        if (k === 'arrowup' || k === 'w') {
            e.preventDefault();
            cursorRow = Math.max(0, cursorRow - 1);
        } else if (k === 'arrowdown' || k === 's') {
            e.preventDefault();
            cursorRow = Math.min(SIZE - 1, cursorRow + 1);
        } else if (k === 'arrowleft' || k === 'a') {
            e.preventDefault();
            cursorCol = Math.max(0, cursorCol - 1);
        } else if (k === 'arrowright' || k === 'd') {
            e.preventDefault();
            cursorCol = Math.min(SIZE - 1, cursorCol + 1);
        } else if (k === ' ' || k === 'enter' || k === 'j') {
            e.preventDefault();
            triggerPlaceAt(cursorRow, cursorCol);
        }
    });

    // 快捷按钮与表情事件
    document.querySelectorAll('.emote-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.getAttribute('data-emote');
            if (!text) return;
            const prefix = myRole === 'host' ? '⚫ ' : '⚪ ';
            showEmote(prefix + text);
            sendGameData({ type: 'emote', text: prefix + text });
        });
    });

    undoBtn.addEventListener('click', () => {
        if (gameState.status !== 'playing' || gameState.history.length === 0) return;
        if (myRole === 'host') {
            if (GameBot.enabled) {
                // 人机：连同程序的应手一起撤回，回到"轮到我"
                let last;
                do {
                    last = gameState.history.pop();
                    gameState.board[last.r][last.c] = 0;
                } while (last.player !== 1 && gameState.history.length > 0);
                if (last.player !== 1) { // 只剩程序的首手：放回去
                    gameState.board[last.r][last.c] = last.player;
                    gameState.history.push(last);
                    return;
                }
                gameState.turn = 1;
                gameState.timeLeft = TURN_TIME_LIMIT;
                bot.pending = false;
                broadcastState();
                showEmote('↩️ 已悔棋');
                return;
            }
            const last = gameState.history.pop();
            gameState.board[last.r][last.c] = 0;
            gameState.turn = last.player;
            gameState.timeLeft = TURN_TIME_LIMIT;
            broadcastState();
            showEmote('↩️ 房主撤回了上一手');
            sendGameData({ type: 'emote', text: '↩️ 房主撤回了上一手' });
        } else {
            sendGameData({ type: 'undo' });
        }
    });

    lobbyBtn.addEventListener('click', () => location.reload());

    startBtn.addEventListener('click', () => {
        if (myRole === 'host' && gameState.status !== 'playing') {
            startNewMatch();
        }
    });

    restartBtn.addEventListener('click', () => {
        if (myRole === 'host') {
            startNewMatch();
        } else {
            sendGameData({ type: 'restart-request' });
            restartBtn.textContent = 'AWAITING HOST...';
            restartBtn.disabled = true;
        }
    });

    // ==========================================
    // 赛博霓虹棋盘渲染引擎
    // ==========================================
    function gridToXY(r, c) {
        return {
            x: PAD + c * CELL,
            y: PAD + r * CELL
        };
    }

    function render() {
        animTick++;
        view.begin(ctx);
        ctx.clearRect(0, 0, WIDTH, WIDTH);

        // 棋盘底色
        const bgGrad = ctx.createRadialGradient(WIDTH / 2, WIDTH / 2, 40, WIDTH / 2, WIDTH / 2, WIDTH * 0.72);
        bgGrad.addColorStop(0, '#18233c');
        bgGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, WIDTH, WIDTH);

        // 绘制 15×15 网格线
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < SIZE; i++) {
            const pos = PAD + i * CELL;
            // 横线
            ctx.beginPath();
            ctx.moveTo(PAD, pos);
            ctx.lineTo(WIDTH - PAD, pos);
            ctx.stroke();
            // 竖线
            ctx.beginPath();
            ctx.moveTo(pos, PAD);
            ctx.lineTo(pos, WIDTH - PAD);
            ctx.stroke();
        }

        // 外框霓虹边线
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(PAD - 1, PAD - 1, (SIZE - 1) * CELL + 2, (SIZE - 1) * CELL + 2);

        // 五个标准星位（天元 + 四角星）
        const stars = [
            [3, 3], [3, 11],
            [7, 7],
            [11, 3], [11, 11]
        ];
        for (const [sr, sc] of stars) {
            const { x, y } = gridToXY(sr, sc);
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath();
            ctx.arc(x, y, 3.8, 0, Math.PI * 2);
            ctx.fill();
        }

        // 当前轮到自己落子时，绘制光标虚影预览
        const myPlayerNum = myRole === 'host' ? 1 : 2;
        if (gameState.status === 'playing' && gameState.turn === myPlayerNum) {
            if (gameState.board[cursorRow] && gameState.board[cursorRow][cursorCol] === 0) {
                const { x, y } = gridToXY(cursorRow, cursorCol);
                ctx.save();
                ctx.strokeStyle = myPlayerNum === 1 ? 'rgba(34, 211, 238, 0.75)' : 'rgba(244, 114, 182, 0.75)';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2);
                ctx.stroke();
                if (touchPending && touchPending.row === cursorRow && touchPending.col === cursorCol) {
                    // 触屏预选：半透明棋子 + 十字准线 + 提示，再点一次确认
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 0.45;
                    ctx.fillStyle = myPlayerNum === 1 ? '#22d3ee' : '#f472b6';
                    ctx.beginPath();
                    ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = 0.5;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(PAD, y); ctx.lineTo(WIDTH - PAD, y);
                    ctx.moveTo(x, PAD); ctx.lineTo(x, WIDTH - PAD);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                    ctx.font = '700 13px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const ty = y < 70 ? y + CELL * 0.95 : y - CELL * 0.95;
                    ctx.fillStyle = 'rgba(8, 12, 24, 0.85)';
                    ctx.fillRect(x - 52, ty - 11, 104, 22);
                    ctx.fillStyle = '#fff';
                    ctx.fillText('再点一次落子', x, ty);
                }
                ctx.restore();
            }
        }

        // 绘制所有已落棋子
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                const cell = gameState.board[r][c];
                if (cell === 0) continue;
                const { x, y } = gridToXY(r, c);
                const radius = CELL * 0.43;

                ctx.save();
                if (cell === 1) {
                    // ⚫ 曜石黑 + 青色霓虹光环
                    ctx.shadowColor = 'rgba(34, 211, 238, 0.6)';
                    ctx.shadowBlur = 10;
                    const grad = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, radius);
                    grad.addColorStop(0, '#475569');
                    grad.addColorStop(0.55, '#0f172a');
                    grad.addColorStop(1, '#020617');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#22d3ee';
                    ctx.lineWidth = 1.8;
                    ctx.stroke();
                } else {
                    // ⚪ 星光白 + 粉色霓虹光环
                    ctx.shadowColor = 'rgba(244, 114, 182, 0.6)';
                    ctx.shadowBlur = 10;
                    const grad = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, radius);
                    grad.addColorStop(0, '#ffffff');
                    grad.addColorStop(0.7, '#e2e8f0');
                    grad.addColorStop(1, '#cbd5e1');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(x, y, radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#f472b6';
                    ctx.lineWidth = 1.8;
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        // 高亮最新一手落子标记
        if (gameState.history.length > 0) {
            const last = gameState.history[gameState.history.length - 1];
            const { x, y } = gridToXY(last.r, last.c);
            const pulse = 3 + Math.sin(animTick * 0.15) * 1.5;
            ctx.save();
            ctx.fillStyle = last.player === 1 ? '#22d3ee' : '#f472b6';
            ctx.beginPath();
            ctx.arc(x, y, pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 绘制五子连珠获胜激光连线
        if (gameState.winLine && gameState.winLine.length >= 5) {
            const first = gridToXY(gameState.winLine[0].r, gameState.winLine[0].c);
            const last = gridToXY(
                gameState.winLine[gameState.winLine.length - 1].r,
                gameState.winLine[gameState.winLine.length - 1].c
            );
            ctx.save();
            ctx.strokeStyle = '#fbbf24';
            ctx.shadowColor = '#fbbf24';
            ctx.shadowBlur = 16;
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(first.x, first.y);
            ctx.lineTo(last.x, last.y);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ==========================================
    // 人机对手（?bot=easy|normal|hard）：执白 (player 2)
    // ==========================================
    // 经典棋型打分：对每个候选空位，分别估算"我下这里"(进攻) 和
    // "对手下这里"(防守) 四个方向能形成的最强棋型，加权求和取最高分。
    // 困难难度额外做一层前瞻：排除下完后让对手出现必胜棋型的点。
    const SHAPE = { FIVE: 1e7, OPEN4: 1e6, FOUR: 1e5, OPEN3: 1e4, THREE: 1e3, OPEN2: 500, TWO: 80, ONE: 10 };
    // 9 格窗口（中心第 4 位是候选点）：1=己方 2=对方/出界 0=空
    const PATTERNS = [
        ['11111', 'FIVE'],
        ['011110', 'OPEN4'],
        ['011112', 'FOUR'], ['211110', 'FOUR'], ['10111', 'FOUR'], ['11011', 'FOUR'], ['11101', 'FOUR'],
        ['011100', 'OPEN3'], ['001110', 'OPEN3'], ['010110', 'OPEN3'], ['011010', 'OPEN3'],
        ['211100', 'THREE'], ['001112', 'THREE'], ['211010', 'THREE'], ['010112', 'THREE'],
        ['210110', 'THREE'], ['011012', 'THREE'], ['10011', 'THREE'], ['11001', 'THREE'], ['10101', 'THREE'],
        ['001100', 'OPEN2'], ['011000', 'OPEN2'], ['000110', 'OPEN2'], ['001010', 'OPEN2'], ['010100', 'OPEN2'],
        ['211000', 'TWO'], ['000112', 'TWO'], ['210100', 'TWO'], ['001012', 'TWO'], ['10001', 'TWO']
    ];
    const DIRS4 = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const BOT_CFG = {
        easy: { def: 0.55, top: 6, blunder: 0.22, lookahead: false, think: [500, 1100] },
        normal: { def: 0.95, top: 2, blunder: 0.04, lookahead: false, think: [400, 900] },
        hard: { def: 1.05, top: 1, blunder: 0, lookahead: true, think: [350, 750] }
    }[GameBot.level || 'normal'];
    const bot = { pending: false };

    function lineString(board, r, c, dr, dc, me) {
        let str = '';
        for (let k = -4; k <= 4; k++) {
            if (k === 0) { str += '1'; continue; }
            const nr = r + dr * k, nc = c + dc * k;
            if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) { str += '2'; continue; }
            const v = board[nr][nc];
            str += v === 0 ? '0' : (v === me ? '1' : '2');
        }
        return str;
    }
    function bestShape(str) {
        // 只认覆盖中心位 (index 4) 的棋型
        for (const [pat, name] of PATTERNS) {
            let i = str.indexOf(pat);
            while (i !== -1) {
                if (i <= 4 && 4 < i + pat.length) return name;
                i = str.indexOf(pat, i + 1);
            }
        }
        return 'ONE';
    }
    function pointScore(board, r, c, me) {
        const counts = {};
        let sum = 0;
        for (const [dr, dc] of DIRS4) {
            const name = bestShape(lineString(board, r, c, dr, dc, me));
            counts[name] = (counts[name] || 0) + 1;
            sum += SHAPE[name];
        }
        // 组合杀：双四 / 四三 ≈ 活四；双活三 ≈ 冲四以上
        const fours = (counts.FOUR || 0) + (counts.OPEN4 || 0);
        if (fours >= 2 || (fours >= 1 && counts.OPEN3)) sum = Math.max(sum, SHAPE.OPEN4 * 0.9);
        else if ((counts.OPEN3 || 0) >= 2) sum = Math.max(sum, SHAPE.FOUR * 0.9);
        return sum;
    }
    function candidates(board) {
        const out = [];
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (board[r][c] !== 0) continue;
                let near = false;
                for (let dr = -2; dr <= 2 && !near; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] !== 0) { near = true; break; }
                    }
                }
                if (near) out.push({ r, c });
            }
        }
        return out;
    }
    function rankMoves(board, me, defW) {
        const foe = me === 1 ? 2 : 1;
        const list = candidates(board).map(p => {
            const atk = pointScore(board, p.r, p.c, me);
            const def = pointScore(board, p.r, p.c, foe);
            // 越靠中心越好一点点（打破平分）
            const center = -Math.hypot(p.r - 7, p.c - 7);
            return { r: p.r, c: p.c, atk, def, score: atk * 1.1 + def * defW + center };
        });
        list.sort((a, b) => b.score - a.score);
        return list;
    }
    function chooseBotMove() {
        const board = gameState.board;
        if (!gameState.history.length) return { r: 7, c: 7 };
        let list = rankMoves(board, 2, BOT_CFG.def);
        if (!list.length) return null;
        // 必胜 / 必防 总是先看（简单难度偶尔看漏防守）
        if (list[0].atk >= SHAPE.FIVE) return list[0];
        if (BOT_CFG.lookahead) {
            // 前瞻一层：试下前 8 个点，看对手的最佳应手分数，选净收益最高的
            const top = list.slice(0, 8);
            let best = null;
            for (const m of top) {
                board[m.r][m.c] = 2;
                if (checkWin(board, m.r, m.c, 2)) { board[m.r][m.c] = 0; return m; }
                const reply = rankMoves(board, 1, 1.0)[0];
                board[m.r][m.c] = 0;
                const val = m.score - (reply ? reply.atk * 0.8 : 0);
                if (!best || val > best.val) best = { r: m.r, c: m.c, val };
            }
            return best;
        }
        if (Math.random() < BOT_CFG.blunder) {
            // 失误：从更大的范围里随便挑一个
            list = list.slice(0, Math.min(list.length, 12));
            return list[Math.floor(Math.random() * list.length)];
        }
        const n = Math.min(BOT_CFG.top, list.length);
        // 防守必须：对手已有冲四/活四时不随机
        if (list[0].def >= SHAPE.FOUR * 0.9 && GameBot.level !== 'easy') return list[0];
        return list[Math.floor(Math.random() * n)];
    }
    function botStep() {
        if (!GameBot.enabled || gameState.status !== 'playing' || gameState.turn !== 2 || bot.pending) return;
        bot.pending = true;
        const moveNo = gameState.history.length;
        setTimeout(() => {
            bot.pending = false;
            if (gameState.status !== 'playing' || gameState.turn !== 2 || gameState.history.length !== moveNo) return;
            const m = chooseBotMove();
            if (m) GameBot.deliver({ type: 'place', r: m.r, c: m.c });
        }, GameBot.rand(BOT_CFG.think[0], BOT_CFG.think[1]));
    }
    if (GameBot.enabled) setInterval(botStep, 100);
    GameBot.expose({
        state: () => gameState,
        place: (r, c) => triggerPlaceAt(r, c),
        choose: () => chooseBotMove()
    });

    renderLoop = setInterval(render, 1000 / 30);
    render();
});
