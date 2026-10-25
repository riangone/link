/**
 * Link Spin — 爆旋陀螺 (Beyblade-style) 1v1 realtime battle.
 *
 * Same skeleton as hockey/tanks: GameSession (or GameBot's LocalSession)
 * pairs two browsers, the host runs the whole simulation at 60 Hz and
 * broadcasts state at 30 Hz, the client only sends inputs. Button presses
 * travel as monotonically increasing counters (a = shoot/dash, s = special)
 * so a dropped packet on the unreliable channel never eats a press.
 *
 * Canonical coordinates: host's top launches from the bottom, client's from
 * the top. The client renders the arena rotated 180° so everyone fights
 * "from the bottom" (same trick as hockey).
 *
 * Round flow:  launch (3-2-1 power meter) → battle → finish (slow-mo banner)
 *              → next round … first to WIN_SCORE points.
 * Finishes:    OVER (knocked through a pocket) 2 pts · BURST (burst gauge
 *              full) 2 pts · SPIN (opponent stops first) 1 pt.
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    if (!location.hash || location.hash.length <= 1) {
        location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    }
    const opponentName = new URLSearchParams(location.search).get('opponent') || '';
    const waitingText = opponentName ? `WAITING FOR ${opponentName.toUpperCase()}` : 'WAITING FOR PEER';

    const $ = (id) => document.getElementById(id);
    const canvas = $('game-canvas');
    const ctx = canvas.getContext('2d');

    const p1ScoreVal = $('p1-score'), p2ScoreVal = $('p2-score');
    const p1Label = $('p1-label'), p2Label = $('p2-label');
    const overlay = $('overlay');
    const lobbyScreen = $('lobby-screen'), readyScreen = $('ready-screen');
    const gameoverScreen = $('gameover-screen'), disconnectScreen = $('disconnect-screen');
    const inviteUrlInput = $('invite-url'), copyBtn = $('copy-btn');
    const startBtn = $('start-btn'), restartBtn = $('restart-btn'), lobbyBtn = $('lobby-btn');
    const connectionStateText = $('connection-state-text'), roleText = $('role-text');
    const winLossTitle = $('win-loss-title'), finalScore = $('final-score');
    const statusText = $('status-text'), pingText = $('ping-text'), roleStatusText = $('role-status-text');
    const pickerEl = $('picker'), pickerSlot = $('picker-slot'), pickerSlot2 = $('picker-slot-2'), oppPickEl = $('opp-pick');
    const muteBtn = $('mute-btn'), specialBtn = $('special-btn');

    inviteUrlInput.value = location.href;
    copyBtn.addEventListener('click', () => {
        inviteUrlInput.select();
        document.execCommand('copy');
        copyBtn.textContent = 'COPIED!';
        setTimeout(() => { copyBtn.textContent = 'COPY'; }, 2000);
    });

    // ==========================================================
    // Constants
    // ==========================================================
    const W = 640, H = 640;
    const CX = W / 2, CY = H / 2;
    const ARENA_R = 272;
    const POCKET_HALF = 0.24;           // rad; pockets at angle 0 and π (left / right)
    const BOWL_K = 0.00042;             // pull toward the centre (the stadium slope)
    const ORBIT_K = 0.034;              // spinning tops naturally swirl around the bowl
    const FRICTION = 0.988;
    const WIN_SCORE = 4;
    const GO_T = 180;                   // launch countdown frames (3 s)
    const FINISH_T = 170;               // finish banner frames
    const SUDDEN_T = 45 * 60;           // battle frames before sudden death
    const SPIN_MAX = 110;
    const PERFECT = 0.93;
    const START_DY = 160;

    const TYPES = ['attack', 'defense', 'stamina', 'balance'];
    const BEYS = {
        attack: {
            name: 'STORM STRIKER', short: 'STRIKER', label: '⚔️ 攻击', spec: 'METEOR RUSH',
            c1: '#ff3b5c', c2: '#ffb02e', r: 34, mass: 1.0, accel: 0.40, vmax: 9.6, drain: 0.050,
            atk: 1.35, def: 0.85, bres: 0.9, dash: 8.6, blades: 3,
            shape: [[0.42, -0.62], [0.98, -0.2], [1.04, 0.04], [0.8, 0.13], [0.62, 0.42]],
            stats: [5, 2, 2, 5]
        },
        defense: {
            name: 'IRON FORTRESS', short: 'FORTRESS', label: '🛡️ 防御', spec: 'AEGIS WALL',
            c1: '#3d8bff', c2: '#a9dcff', r: 37, mass: 1.55, accel: 0.27, vmax: 7.0, drain: 0.042,
            atk: 0.95, def: 1.4, bres: 1.45, dash: 6.4, blades: 6,
            shape: [[0.55, -0.48], [0.96, -0.4], [1.02, 0], [0.96, 0.4], [0.55, 0.48]],
            stats: [2, 5, 3, 2]
        },
        stamina: {
            name: 'ZEPHYR WING', short: 'ZEPHYR', label: '🌀 持久', spec: 'ETERNAL GALE',
            c1: '#22e39b', c2: '#d4fff0', r: 33, mass: 0.9, accel: 0.33, vmax: 8.2, drain: 0.030,
            atk: 0.85, def: 1.0, bres: 1.0, dash: 7.4, blades: 4,
            shape: [[0.38, -0.25], [0.82, -0.32], [1.04, -0.12], [0.98, 0.06], [0.46, 0.34]],
            stats: [2, 3, 5, 3]
        },
        balance: {
            name: 'PHOENIX FLARE', short: 'PHOENIX', label: '🔥 平衡', spec: 'RISING FLARE',
            c1: '#ffb300', c2: '#fff1a8', r: 35, mass: 1.12, accel: 0.34, vmax: 8.4, drain: 0.040,
            atk: 1.12, def: 1.12, bres: 1.15, dash: 7.8, blades: 5,
            shape: [[0.5, -0.42], [0.88, -0.32], [1.05, -0.02], [0.84, 0.08], [0.95, 0.3], [0.55, 0.42]],
            stats: [4, 3, 3, 4]
        }
    };
    const OWNER = ['#ff3fb4', '#2de2ff'];          // P1 magenta / P2 cyan ring
    const FIN_INFO = {
        over: { text: 'OVER FINISH!', col: '#ff4d4d' },
        burst: { text: 'BURST FINISH!!', col: '#ffd34d' },
        spin: { text: 'SPIN FINISH!', col: '#2de2ff' },
        draw: { text: 'DRAW', col: '#cfd3ff' }
    };

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const meter = (t) => { const m = (t % 70) / 35; return m <= 1 ? m : 2 - m; };

    // ==========================================================
    // Audio (synthesised, no assets)
    // ==========================================================
    const Sfx = (() => {
        let ac = null, master = null, noiseBuf = null, hums = [];
        let muted = localStorage.getItem('spin-muted') === '1';
        function init() {
            if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
            try {
                ac = new (window.AudioContext || window.webkitAudioContext)();
                master = ac.createGain();
                master.gain.value = muted ? 0 : 0.55;
                master.connect(ac.destination);
                noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
                const d = noiseBuf.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
                hums = [0, 1].map((i) => {
                    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
                    o.type = 'sawtooth'; o.frequency.value = 120 + i * 7;
                    f.type = 'lowpass'; f.frequency.value = 700;
                    g.gain.value = 0;
                    o.connect(f); f.connect(g); g.connect(master); o.start();
                    return { o, g };
                });
            } catch (e) { ac = null; }
        }
        function noise(dur, freq, q, vol, type) {
            if (!ac) return;
            const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
            s.buffer = noiseBuf;
            f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            s.connect(f); f.connect(g); g.connect(master);
            s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
            return f;
        }
        function tone(freq, dur, type, vol, slideTo, delay) {
            if (!ac) return;
            const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + (delay || 0);
            o.type = type; o.frequency.setValueAtTime(freq, t);
            if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(master);
            o.start(t); o.stop(t + dur + 0.02);
        }
        return {
            init,
            get muted() { return muted; },
            toggle() {
                muted = !muted;
                localStorage.setItem('spin-muted', muted ? '1' : '0');
                if (master) master.gain.value = muted ? 0 : 0.55;
                return muted;
            },
            clash(i) {
                const v = clamp(i / 14, 0.15, 1);
                noise(0.12 + v * 0.15, 2600 + Math.random() * 1400, 3, 0.5 * v);
                tone(1400 + Math.random() * 900, 0.18 + v * 0.2, 'square', 0.06 * v, 600);
                tone(3100 + Math.random() * 500, 0.1, 'sine', 0.08 * v);
                if (i > 9) noise(0.35, 180, 1, 0.5, 'lowpass');
            },
            wall(i) { noise(0.08, 1800, 4, clamp(i / 10, 0.05, 0.35)); },
            launch() {
                const f = noise(0.55, 400, 2, 0.45);
                if (f) f.frequency.exponentialRampToValueAtTime(5000, ac.currentTime + 0.45);
                tone(200, 0.5, 'sawtooth', 0.08, 1400);
            },
            dash() { noise(0.25, 900, 1.5, 0.35); tone(300, 0.2, 'triangle', 0.12, 900); },
            special() {
                tone(220, 0.7, 'sawtooth', 0.12, 880);
                tone(330, 0.7, 'square', 0.06, 1320, 0.05);
                noise(0.8, 1200, 0.8, 0.3);
            },
            beep(hi) { tone(hi ? 1320 : 660, hi ? 0.45 : 0.16, 'square', 0.1); },
            burst() {
                noise(0.9, 300, 0.7, 0.9, 'lowpass');
                noise(0.5, 4000, 2, 0.5);
                tone(900, 0.6, 'square', 0.12, 80);
            },
            over() { tone(1200, 0.8, 'triangle', 0.18, 90); noise(0.5, 600, 1, 0.4); },
            stop() { tone(500, 0.9, 'sine', 0.15, 60); },
            win() { [523, 659, 784, 1046].forEach((f, k) => tone(f, 0.3, 'square', 0.08, 0, k * 0.11)); },
            hum(i, spin, on) {
                if (!ac || !hums[i]) return;
                const h = hums[i], t = ac.currentTime;
                h.o.frequency.setTargetAtTime(60 + spin * 1.7 + i * 5, t, 0.05);
                h.g.gain.setTargetAtTime(on ? 0.02 + spin / SPIN_MAX * 0.025 : 0, t, 0.08);
            }
        };
    })();
    muteBtn.textContent = Sfx.muted ? '🔇' : '🔊';
    muteBtn.addEventListener('click', () => { Sfx.init(); muteBtn.textContent = Sfx.toggle() ? '🔇' : '🔊'; });
    window.addEventListener('pointerdown', () => Sfx.init(), { capture: true });
    window.addEventListener('keydown', () => Sfx.init(), { capture: true });

    // ==========================================================
    // View (client sees the arena rotated 180°)
    // ==========================================================
    let myRole = null;
    let myIdx = 0;
    const view = GameFit.view(canvas, { width: W, height: H });
    const toView = (x, y) => (myRole === 'client' ? { x: W - x, y: H - y } : { x, y });
    const vecToCanon = (x, y) => (myRole === 'client' ? { x: -x, y: -y } : { x, y });

    // ==========================================================
    // Input
    // ==========================================================
    const keys = {};
    let aSeq = 0, sSeq = 0;           // local press counters
    let lastLockValue = 0;
    const touchStick = { x: 0, y: 0, on: false };
    let mouseSteer = null;            // logical point while the mouse button is held

    function pressAction() {
        lastLockValue = meter(curPt());
        aSeq++;
        if (myRole === 'host') hostAction(0, 'a', lastLockValue);
        else sendInput();
    }
    function pressSpecial() {
        sSeq++;
        if (myRole === 'host') hostAction(0, 's');
        else sendInput();
    }

    window.addEventListener('keydown', (e) => {
        if (e.target && e.target.tagName === 'INPUT') return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
        if (e.repeat) return;
        keys[e.key.toLowerCase()] = true;
        if (!inMatch()) return;
        if (e.key === ' ') pressAction();
        if (e.key === 'e' || e.key === 'E' || e.key === 'Shift') pressSpecial();
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

    const dragArea = canvas.closest('.gf-box') || canvas;
    dragArea.addEventListener('contextmenu', (e) => e.preventDefault());
    dragArea.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.overlay')) return;
        if (!inMatch()) return;
        if (e.pointerType === 'touch') {
            e.preventDefault();
            if (D().ph === 'launch') pressAction();   // tap anywhere to shoot
            return;
        }
        if (e.button === 2) { pressAction(); return; }   // right click = dash
        if (D().ph === 'launch') { pressAction(); return; }
        mouseSteer = view.toLogical(e.clientX, e.clientY);
    });
    dragArea.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse' && mouseSteer && e.buttons & 1) mouseSteer = view.toLogical(e.clientX, e.clientY);
    });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') mouseSteer = null; });

    GameFit.joystick($('stick-zone'), $('stick-knob'), (x, y, on) => {
        touchStick.x = x; touchStick.y = y; touchStick.on = on;
    });
    GameFit.touchButtons($('touch-controls').querySelector('.touch-actions'), (action, down) => {
        if (!down || !inMatch()) return;
        if (action === 'dash') pressAction();
        if (action === 'special') pressSpecial();
    }, { slide: false });

    /** Current steering direction in canonical coordinates, |v| ≤ 1. */
    function localDir() {
        let x = 0, y = 0;
        if (keys.arrowup || keys.w) y -= 1;
        if (keys.arrowdown || keys.s) y += 1;
        if (keys.arrowleft || keys.a) x -= 1;
        if (keys.arrowright || keys.d) x += 1;
        if (touchStick.on) { x += touchStick.x; y += touchStick.y; }
        if (mouseSteer) {
            const me = drawTops()[myIdx];
            if (me) {
                const p = toView(me.x, me.y);
                const dx = mouseSteer.x - p.x, dy = mouseSteer.y - p.y, d = Math.hypot(dx, dy);
                if (d > 4) { const k = Math.min(1, d / 90) / d; x += dx * k; y += dy * k; }
            }
        }
        const m = Math.hypot(x, y);
        if (m > 1) { x /= m; y /= m; }
        return vecToCanon(x, y);
    }

    // ==========================================================
    // Picker (choose your bey)
    // ==========================================================
    let myPick = TYPES.includes(localStorage.getItem('spin-pick')) ? localStorage.getItem('spin-pick') : 'attack';
    let oppPick = null;
    const pickCanvases = [];
    TYPES.forEach((t) => {
        const b = BEYS[t];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pick';
        btn.dataset.type = t;
        btn.style.setProperty('--c', b.c1);
        const cv = document.createElement('canvas');
        cv.width = cv.height = 112;
        pickCanvases.push({ cv, t });
        btn.appendChild(cv);
        btn.insertAdjacentHTML('beforeend',
            `<span class="pk-name">${b.short}</span><span class="pk-type">${b.label}</span>` +
            `<span class="pk-stats">${b.stats.map((s) => `<span class="pk-bar"><i style="width:${s * 20}%"></i></span>`).join('')}</span>`);
        btn.title = `${b.name} — ATK / DEF / STA / SPD · 必杀: ${b.spec}`;
        btn.addEventListener('click', () => {
            myPick = t;
            localStorage.setItem('spin-pick', t);
            refreshPicker();
            syncPick();
        });
        pickerEl.appendChild(btn);
    });
    function refreshPicker() {
        pickerEl.querySelectorAll('.pick').forEach((b) => b.classList.toggle('on', b.dataset.type === myPick));
        oppPickEl.textContent = oppPick ? `对手：${BEYS[oppPick].label} ${BEYS[oppPick].name}` : '对手：选择中…';
    }
    refreshPicker();

    // ==========================================================
    // Host simulation state
    // ==========================================================
    let S = null;              // host authoritative state
    let net = null;            // client: last received state
    let netAt = 0;
    const picks = ['attack', 'attack'];
    const inputs = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    const lastSeq = [{ a: null, s: null }, { a: null, s: null }];
    let evId = 0;
    let frame = 0;
    let hostLoop = null;

    function mkTop(i, type) {
        const sg = i === 0 ? 1 : -1;
        return {
            type, x: CX, y: CY + sg * START_DY, vx: 0, vy: 0,
            spin: 0, bg: 0, sg: 0, sp: 0, dash: 0, cd: 0, st: 0, hitCd: 0, wallCd: 0
        };
    }

    function startMatch() {
        S = {
            ph: 'launch', pt: 0, bt: 0, ft: 0, rd: 0, sd: 0, hitstop: 0,
            sc: [0, 0], tp: [picks[0], picks[1]], lk: [-1, -1], fin: null, tops: null, events: []
        };
        if (GameBot.enabled) bot.lockTarget = null;
        startRound();
        hideOverlay();
        clearInterval(hostLoop);
        hostLoop = setInterval(hostTick, 1000 / 60);
        broadcast();
    }

    function startRound() {
        S.rd++;
        S.ph = 'launch'; S.pt = 0; S.bt = 0; S.ft = 0; S.sd = 0; S.hitstop = 0;
        S.lk = [-1, -1]; S.fin = null;
        S.tops = [mkTop(0, S.tp[0]), mkTop(1, S.tp[1])];
        bot.lockTarget = null;
    }

    function emit(ev) {
        ev.id = ++evId;
        ev.f = frame;
        S.events.push(ev);
        if (S.events.length > 24) S.events.shift();
        fx(ev);
    }

    function hostAction(i, kind, lv) {
        if (!S) return;
        const t = S.tops[i];
        if (kind === 'a') {
            if (S.ph === 'launch') {
                if (S.lk[i] < 0) S.lk[i] = clamp(typeof lv === 'number' ? lv : meter(S.pt), 0, 1);
            } else if ((S.ph === 'battle' || S.ph === 'finish') && t.st === 0 && t.cd <= 0 && t.spin > 8) {
                const o = S.tops[1 - i], b = BEYS[t.type];
                let dx = inputs[i].x, dy = inputs[i].y;
                if (Math.hypot(dx, dy) < 0.25) { dx = o.x - t.x; dy = o.y - t.y; }
                const m = Math.hypot(dx, dy) || 1;
                t.vx += dx / m * b.dash; t.vy += dy / m * b.dash;
                t.spin -= 5; t.cd = 100; t.dash = 16;
                emit({ k: 'dash', p: i, x: t.x, y: t.y });
            }
        } else if (kind === 's') {
            if (S.ph === 'battle' && t.st === 0 && t.sg >= 100 && t.sp <= 0) {
                t.sg = 0; t.sp = 180;
                if (t.type === 'defense') t.bg = Math.max(0, t.bg - 25);
                emit({ k: 'spec', p: i, x: t.x, y: t.y });
            }
        }
    }

    function hostTick() {
        if (!S || S.ph === 'gameover') return;
        frame++;
        inputs[0] = localDir();
        if (GameBot.enabled) botStep();

        if (S.ph === 'launch') {
            S.pt++;
            if (S.pt >= GO_T) launchTops();
        } else {
            if (S.hitstop > 0) S.hitstop--;
            else simStep(S.ph === 'finish' && S.ft < 70 ? 0.33 : 1);
            if (S.ph === 'battle') {
                S.bt++;
                if (S.bt > SUDDEN_T) S.sd = 1;
                checkFinish();
            } else if (S.ph === 'finish') {
                S.ft++;
                if (S.ft >= FINISH_T) nextRound();
            }
        }
        if (frame % 2 === 0) broadcast();
    }

    function launchTops() {
        for (let i = 0; i < 2; i++) {
            const t = S.tops[i];
            if (S.lk[i] < 0) S.lk[i] = meter(S.pt) * 0.6;
            const lv = S.lk[i], perfect = lv >= PERFECT;
            t.spin = perfect ? SPIN_MAX : 48 + 50 * lv;
            const sg = i === 0 ? 1 : -1;
            const sp = 3 + 5 * lv;
            t.vx = -sg * sp + inputs[i].x * 3;
            t.vy = -sg * 1.4 + inputs[i].y * 3;
            emit({ k: 'launch', p: i, pf: perfect ? 1 : 0, x: t.x, y: t.y });
        }
        S.ph = 'battle';
        S.bt = 0;
    }

    function simStep(dt) {
        const tops = S.tops;
        for (let i = 0; i < 2; i++) {
            const t = tops[i], b = BEYS[t.type], o = tops[1 - i];
            if (t.st === 2) continue;                       // burst: gone
            if (t.st === 1) {                               // over: falling out of the pocket
                const d = Math.hypot(t.x - CX, t.y - CY) || 1;
                t.vx += (t.x - CX) / d * 0.25 * dt;
                t.vy += (t.y - CY) / d * 0.25 * dt;
                t.x += t.vx * dt; t.y += t.vy * dt;
                continue;
            }
            const alive = t.st === 0;
            const spinF = clamp(t.spin / 100, 0, 1.1);
            const dx = t.x - CX, dy = t.y - CY, d = Math.hypot(dx, dy) || 1;

            if (alive) {
                const atkSp = t.sp > 0 && t.type === 'attack';
                const a = b.accel * (0.35 + 0.65 * Math.min(1, spinF)) * (atkSp ? 1.6 : 1);
                t.vx += inputs[i].x * a * dt;
                t.vy += inputs[i].y * a * dt;
                if (atkSp && o.st === 0) {                  // Meteor Rush homes in
                    const hx = o.x - t.x, hy = o.y - t.y, hm = Math.hypot(hx, hy) || 1;
                    t.vx += hx / hm * 0.3 * dt; t.vy += hy / hm * 0.3 * dt;
                }
                // natural swirl
                const ok = ORBIT_K * Math.min(1, spinF) * Math.min(1, d / 120);
                t.vx += (-dy / d) * ok * dt;
                t.vy += (dx / d) * ok * dt;
            }
            // stadium slope
            t.vx -= dx * BOWL_K * dt;
            t.vy -= dy * BOWL_K * dt;
            const fr = Math.pow(alive ? FRICTION : 0.96, dt);
            t.vx *= fr; t.vy *= fr;

            // soft speed cap
            const sp = Math.hypot(t.vx, t.vy);
            const cap = b.vmax * (t.dash > 0 ? 1.9 : 1) * (t.sp > 0 && t.type === 'attack' ? 1.3 : 1);
            if (sp > cap) {
                const ns = cap + (sp - cap) * Math.pow(0.86, dt);
                t.vx *= ns / sp; t.vy *= ns / sp;
            }
            t.x += t.vx * dt; t.y += t.vy * dt;

            // rim / pockets
            const ex = t.x - CX, ey = t.y - CY, ed = Math.hypot(ex, ey) || 1;
            if (ed > ARENA_R - b.r) {
                const ang = Math.atan2(ey, ex), ad = Math.abs(ang);
                const inPocket = Math.min(ad, Math.PI - ad) < POCKET_HALF;
                const nearPocket = Math.min(ad, Math.PI - ad) < POCKET_HALF + 0.15;
                if (inPocket || (nearPocket && ed > ARENA_R - b.r * 0.3)) {
                    if (ed > ARENA_R + b.r * 0.25 && t.st !== 1) {
                        t.st = 1;
                        emit({ k: 'over', p: i, x: t.x, y: t.y });
                    }
                } else {
                    const nx = ex / ed, ny = ey / ed;
                    t.x = CX + nx * (ARENA_R - b.r); t.y = CY + ny * (ARENA_R - b.r);
                    const vn = t.vx * nx + t.vy * ny;
                    if (vn > 0) {
                        t.vx -= 1.72 * vn * nx; t.vy -= 1.72 * vn * ny;
                        if (alive) t.spin -= vn * 0.3;
                        if (vn > 2.6 && t.wallCd <= 0) {
                            t.wallCd = 6;
                            emit({ k: 'wall', x: CX + nx * ARENA_R, y: CY + ny * ARENA_R, i: Math.round(vn * 10) / 10 });
                        }
                    }
                }
            }

            if (alive) {
                const spd = Math.hypot(t.vx, t.vy);
                let drain = b.drain * (1 + spd / 14) * (S.sd ? 3 : 1);
                if (t.sp > 0) {
                    if (t.type === 'stamina') drain = -0.18;
                    if (t.type === 'balance') { drain -= 0.07; t.bg = Math.max(0, t.bg - 0.3 * dt); }
                }
                t.spin = Math.min(SPIN_MAX, t.spin - drain * dt);
                t.sg = Math.min(100, t.sg + 0.07 * dt);
                t.bg = Math.max(0, t.bg - 0.025 * dt);
                if (t.spin <= 0) {
                    t.spin = 0; t.st = 3;
                    emit({ k: 'stop', p: i, x: t.x, y: t.y });
                }
            }
            t.dash = Math.max(0, t.dash - dt);
            t.cd = Math.max(0, t.cd - dt);
            t.sp = Math.max(0, t.sp - dt);
            t.hitCd = Math.max(0, t.hitCd - dt);
            t.wallCd = Math.max(0, t.wallCd - dt);
        }
        collide(tops[0], tops[1]);
    }

    function collide(a, b) {
        if (a.st === 1 || a.st === 2 || b.st === 1 || b.st === 2) return;
        const A = BEYS[a.type], B = BEYS[b.type];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), R = A.r + B.r;
        if (d >= R || d < 1e-4) return;
        const nx = dx / d, ny = dy / d;
        const ma = A.mass * (a.sp > 0 && a.type === 'defense' ? 3 : 1);
        const mb = B.mass * (b.sp > 0 && b.type === 'defense' ? 3 : 1);
        const ia = 1 / ma, ib = 1 / mb, tot = ia + ib;
        const ov = R - d;
        a.x -= nx * ov * ia / tot; a.y -= ny * ov * ia / tot;
        b.x += nx * ov * ib / tot; b.y += ny * ov * ib / tot;

        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        const approach = Math.max(0, -rv);
        const spinRepel = 1.7 * Math.sqrt(Math.max(0, a.spin) * Math.max(0, b.spin)) / 100;
        const fresh = a.hitCd <= 0;
        const J = ((1.85) * approach + (fresh ? spinRepel : spinRepel * 0.25)) / tot;
        a.vx -= J * ia * nx; a.vy -= J * ia * ny;
        b.vx += J * ib * nx; b.vy += J * ib * ny;
        // both spin the same way → contact surfaces grind in opposite directions
        const tk = spinRepel * 0.7 * (fresh ? 1 : 0.2);
        a.vx += -ny * tk * ia; a.vy += nx * tk * ia;
        b.vx -= -ny * tk * ib; b.vy -= nx * tk * ib;

        const I = approach + spinRepel * 0.6;
        if (!fresh || I < 1.4) return;
        a.hitCd = b.hitCd = 8;
        const pair = [[a, A, b, B], [b, B, a, A]];
        let crit = false;
        for (const [att, AT, def, DF] of pair) {
            if (att.st !== 0 && def.st !== 0) continue;
            let atk = AT.atk * (att.dash > 0 ? 1.45 : 1);
            if (att.sp > 0 && att.type === 'attack') atk *= 1.8;
            if (att.sp > 0 && att.type === 'balance') atk *= 1.4;
            if (att.st !== 0) atk *= 0.3;
            const dv = DF.def * (def.sp > 0 && def.type === 'defense' ? 2 : 1);
            if (def.st === 0) {
                def.spin -= I * 0.72 * atk / dv;
                if (I > 4 && !(def.sp > 0 && def.type === 'defense')) {
                    const lowSpin = 1.5 - Math.min(1, Math.max(0, def.spin) / 100);
                    const add = Math.pow(I - 4, 1.3) * 2.0 * atk / DF.bres * lowSpin * (0.75 + Math.random() * 0.5);
                    def.bg += add;
                    if (add > 22) crit = true;
                    if (def.bg >= 100 && def.st === 0) {
                        def.bg = 100; def.st = 2;
                        emit({ k: 'burst', p: S.tops.indexOf(def), x: def.x, y: def.y });
                    }
                }
                def.sg = Math.min(100, def.sg + I * 1.6);
            }
            att.sg = Math.min(100, att.sg + I * 2.2);
        }
        if (I > 9) S.hitstop = Math.min(6, Math.round(I / 3));
        emit({
            k: 'hit', x: Math.round((a.x + nx * A.r) * 10) / 10, y: Math.round((a.y + ny * A.r) * 10) / 10,
            i: Math.round(I * 10) / 10, nx: Math.round(nx * 100) / 100, ny: Math.round(ny * 100) / 100, c: crit ? 1 : 0
        });
    }

    function checkFinish() {
        const lost = S.tops.map((t) => t.st !== 0);
        if (!lost[0] && !lost[1]) return;
        let w = -1, kind = 'draw', pts = 0, lt = null;
        if (!(lost[0] && lost[1])) {
            w = lost[0] ? 1 : 0;
            lt = S.tops[1 - w];
            kind = ['', 'over', 'burst', 'spin'][lt.st];
            pts = kind === 'spin' ? 1 : 2;
            S.sc[w] += pts;
        } else {
            lt = S.tops[0];
        }
        S.fin = { k: kind, w, p: pts, x: Math.round(lt.x), y: Math.round(lt.y) };
        S.ph = 'finish';
        S.ft = 0;
        updateScoreDom(S.sc);
    }

    function nextRound() {
        if (S.sc[0] >= WIN_SCORE || S.sc[1] >= WIN_SCORE) {
            S.ph = 'gameover';
            broadcast();
            showGameOver(S.sc);
            return;
        }
        startRound();
    }

    function r1(v) { return Math.round(v * 10) / 10; }
    function broadcast() {
        if (!S) return;
        session.send({
            type: 'state', ph: S.ph, pt: S.pt, bt: S.bt, ft: S.ft, rd: S.rd, sd: S.sd,
            sc: S.sc, tp: S.tp, lk: S.lk.map(r1), fin: S.fin,
            tops: S.tops.map((t) => [r1(t.x), r1(t.y), r1(t.vx), r1(t.vy), r1(t.spin), r1(t.bg), r1(t.sg), Math.round(t.sp), Math.round(t.dash), Math.round(t.cd), t.st]),
            ev: S.events.filter((e) => frame - e.f < 24)
        });
    }

    // ==========================================================
    // Bot (?bot=easy|normal|hard) — plays the client side (index 1)
    // ==========================================================
    const BOT = {
        react: GameBot.pick({ easy: 18, normal: 9, hard: 3 }),
        noise: GameBot.pick({ easy: 0.55, normal: 0.28, hard: 0.08 }),
        dashP: GameBot.pick({ easy: 0.012, normal: 0.04, hard: 0.12 }),
        lock: GameBot.pick({ easy: [0.4, 0.85], normal: [0.72, 0.97], hard: [0.9, 1.0] }),
        specDelay: GameBot.pick({ easy: 120, normal: 40, hard: 5 })
    };
    const bot = { timer: 0, x: 0, y: 0, a: 0, s: 0, lockTarget: null, specWait: 0, sent: false };
    if (GameBot.enabled) picks[1] = TYPES[Math.floor(Math.random() * TYPES.length)];

    function botStep() {
        const me = S.tops[1], op = S.tops[0];
        if (S.ph === 'launch') {
            if (bot.lockTarget === null) bot.lockTarget = GameBot.rand(BOT.lock[0], BOT.lock[1]);
            const m = meter(S.pt);
            if (S.lk[1] < 0 && S.pt > 30 && (Math.abs(m - bot.lockTarget) < 0.03 || S.pt > GO_T - 3)) {
                bot.a++;
                GameBot.deliver({ type: 'input', x: 0, y: 0, a: bot.a, s: bot.s, lv: m });
                return;
            }
        } else if (me.st === 0 && op.st !== 2) {
            if (--bot.timer <= 0) {
                bot.timer = BOT.react;
                const b = BEYS[me.type];
                const ox = op.x + op.vx * 6, oy = op.y + op.vy * 6;
                let tx, ty;
                const aggressive = op.st === 0 && (me.type === 'attack' || me.type === 'balance' ||
                    (me.type === 'defense' && Math.hypot(op.x - CX, op.y - CY) > 120) ||
                    me.spin > op.spin + 25 || me.sp > 0);
                if (aggressive || op.st !== 0) {
                    // hit the opponent from the side away from its nearest pocket
                    const px = op.x >= CX ? CX + ARENA_R : CX - ARENA_R;
                    let ax = px - ox, ay = CY - oy;
                    const am = Math.hypot(ax, ay) || 1;
                    tx = ox - ax / am * (b.r + 10);
                    ty = oy - ay / am * (b.r + 10);
                    if (Math.hypot(me.x - tx, me.y - ty) < 40) { tx = ox; ty = oy; }
                } else {
                    // stamina style: keep away, circle near the centre
                    const ax = me.x - op.x, ay = me.y - op.y, am = Math.hypot(ax, ay) || 1;
                    tx = CX + ax / am * 90; ty = CY + ay / am * 90;
                }
                let dx = tx - me.x, dy = ty - me.y;
                // never wander into a pocket
                const mx = me.x - CX, my = me.y - CY, md = Math.hypot(mx, my) || 1;
                const ang = Math.abs(Math.atan2(my, mx));
                if (md > ARENA_R - 80 && Math.min(ang, Math.PI - ang) < 0.6) { dx -= mx / md * 120; dy -= my / md * 120; }
                const m = Math.hypot(dx, dy) || 1;
                bot.x = dx / m + GameBot.gauss() * BOT.noise;
                bot.y = dy / m + GameBot.gauss() * BOT.noise;
                const om = Math.hypot(op.x - me.x, op.y - me.y) || 1;
                const align = ((op.x - me.x) * dx + (op.y - me.y) * dy) / (om * m);
                if (aggressive && me.cd <= 0 && om < 170 && align > 0.85 && Math.random() < BOT.dashP * BOT.react) bot.a++;
            }
            if (me.sg >= 100) {
                if (++bot.specWait > BOT.specDelay) { bot.s++; bot.specWait = 0; }
            }
        }
        GameBot.deliver({ type: 'input', x: bot.x, y: bot.y, a: bot.a, s: bot.s });
    }
    GameBot.expose({ state: () => S });

    // ==========================================================
    // Network
    // ==========================================================
    connectionStateText.textContent = '正在连接信号服务器...';
    let channelOpen = false;

    const session = GameBot.session({
        gameFolder: 'spin',
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
            myIdx = role === 'host' ? 0 : 1;
            roleStatusText.textContent = role.toUpperCase();
            p1Label.textContent = role === 'host' ? 'P1 (YOU)' : 'P1 (HOST)';
            p2Label.textContent = role === 'host' ? 'P2 (OPPONENT)' : 'P2 (YOU)';
            roleText.innerHTML = role === 'host'
                ? '选择你的陀螺，准备好就 <strong>LET IT RIP!</strong>'
                : '选择你的陀螺，等待 Host 开始对局…';
        },
        onChannelOpen() {
            channelOpen = true;
            showScreen(readyScreen);
            startBtn.classList.toggle('hidden', myRole !== 'host');
            if (GameBot.enabled) { oppPick = picks[1]; refreshPicker(); }
            syncPick();
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
            clearInterval(hostLoop);
            S = null; net = null;
            showScreen(disconnectScreen);
            statusText.textContent = waitingText;
            pingText.textContent = '-- ms';
        },
        onRtt(ms) { pingText.textContent = `${ms} ms`; },
        onMessage: handleMessage
    });

    function syncPick() { session.send({ type: 'pick', t: myPick }); }
    // The channel is unreliable: keep re-sending the few "must arrive" things.
    let awaitingRestart = false;
    setInterval(() => {
        if (!channelOpen) return;
        if (!inMatch()) syncPick();
        if (myRole === 'host' && S && S.ph === 'gameover') broadcast();
        if (awaitingRestart) session.send({ type: 'restart-request' });
    }, 600);

    function sendInput() {
        if (myRole !== 'client') return;
        const d = localDir();
        session.send({ type: 'input', x: Math.round(d.x * 100) / 100, y: Math.round(d.y * 100) / 100, a: aSeq, s: sSeq, lv: Math.round(lastLockValue * 1000) / 1000 });
    }
    setInterval(() => { if (channelOpen && myRole === 'client') sendInput(); }, 1000 / 30);

    function handleMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'pick') {
            if (TYPES.includes(msg.t)) {
                oppPick = msg.t;
                if (myRole === 'host') picks[1] = msg.t;
                refreshPicker();
            }
        } else if (msg.type === 'input') {
            if (myRole !== 'host') return;
            if (typeof msg.x === 'number' && typeof msg.y === 'number' && isFinite(msg.x) && isFinite(msg.y)) {
                const m = Math.hypot(msg.x, msg.y);
                inputs[1] = m > 1 ? { x: msg.x / m, y: msg.y / m } : { x: msg.x, y: msg.y };
            }
            const ls = lastSeq[1];
            for (const k of ['a', 's']) {
                const v = msg[k];
                if (typeof v !== 'number') continue;
                if (ls[k] === null) { ls[k] = v; continue; }
                if (v > ls[k]) {
                    ls[k] = v;
                    hostAction(1, k, typeof msg.lv === 'number' ? msg.lv : undefined);
                }
            }
        } else if (msg.type === 'state') {
            if (myRole !== 'client') return;
            const first = !net || net.rd !== msg.rd;
            net = msg;
            netAt = performance.now();
            if (first) trails[0].length = trails[1].length = 0;
            for (const ev of msg.ev || []) {
                if (ev.id > lastEvId) { lastEvId = ev.id; fx(ev); }
            }
            updateScoreDom(msg.sc);
            if (msg.ph === 'gameover') { if (!gameoverShown) showGameOver(msg.sc); }
            else {
                gameoverShown = false;
                awaitingRestart = false;
                if (!overlay.classList.contains('hidden')) hideOverlay();
            }
        } else if (msg.type === 'restart-request') {
            if (myRole === 'host' && (!S || S.ph === 'gameover')) startMatch();
        }
    }
    let lastEvId = 0;
    let gameoverShown = false;

    // ==========================================================
    // Lifecycle / overlay
    // ==========================================================
    function showScreen(el) {
        overlay.classList.remove('hidden');
        [lobbyScreen, readyScreen, gameoverScreen, disconnectScreen].forEach((s) => s.classList.toggle('hidden', s !== el));
        if (el === readyScreen) readyScreen.insertBefore(pickerSlot, startBtn);
        if (el === gameoverScreen) pickerSlot2.appendChild(pickerSlot);
    }
    function hideOverlay() { overlay.classList.add('hidden'); restartBtn.disabled = false; restartBtn.textContent = 'REMATCH'; }
    function inMatch() {
        const d = D();
        return !!d && d.ph !== 'gameover' && overlay.classList.contains('hidden');
    }
    function updateScoreDom(sc) { p1ScoreVal.textContent = sc[0]; p2ScoreVal.textContent = sc[1]; }

    function showGameOver(sc) {
        gameoverShown = true;
        if (myRole === 'host') clearInterval(hostLoop);
        showScreen(gameoverScreen);
        finalScore.textContent = `${sc[0]} - ${sc[1]}`;
        const iWon = sc[myIdx] >= WIN_SCORE;
        winLossTitle.textContent = iWon ? 'VICTORY!' : 'DEFEAT';
        winLossTitle.className = iWon ? 'neon-text' : 'danger-text';
        if (iWon) Sfx.win();
    }

    lobbyBtn.addEventListener('click', () => location.reload());
    startBtn.addEventListener('click', () => {
        Sfx.init();
        if (myRole === 'host' && (!S || S.ph === 'gameover')) { picks[0] = myPick; startMatch(); }
    });
    restartBtn.addEventListener('click', () => {
        Sfx.init();
        if (myRole === 'host') { picks[0] = myPick; startMatch(); }
        else {
            syncPick();
            session.send({ type: 'restart-request' });
            awaitingRestart = true;
            restartBtn.textContent = 'AWAITING HOST...';
            restartBtn.disabled = true;
        }
    });

    // ==========================================================
    // Draw-state accessors (host: live state, client: smoothed net state)
    // ==========================================================
    const disp = [null, null];
    function D() { return myRole === 'host' ? S : net; }
    function since() { return net ? Math.min(8, (performance.now() - netAt) / (1000 / 60)) : 0; }
    function curPt() {
        const d = D();
        if (!d) return 0;
        return myRole === 'host' ? d.pt : d.pt + (d.ph === 'launch' ? since() : 0);
    }
    function drawTops() {
        if (myRole === 'host') return S ? S.tops : [];
        if (!net) return [];
        const k = since();
        return net.tops.map((a, i) => {
            const tx = a[0] + (a[10] === 2 ? 0 : a[2] * k), ty = a[1] + (a[10] === 2 ? 0 : a[3] * k);
            let p = disp[i];
            if (!p || Math.hypot(p.x - tx, p.y - ty) > 70) p = disp[i] = { x: tx, y: ty };
            else { p.x += (tx - p.x) * 0.45; p.y += (ty - p.y) * 0.45; }
            return {
                type: net.tp[i], x: p.x, y: p.y, vx: a[2], vy: a[3], spin: a[4], bg: a[5], sg: a[6],
                sp: a[7], dash: a[8], cd: a[9], st: a[10]
            };
        });
    }

    // ==========================================================
    // Effects
    // ==========================================================
    const parts = [];
    const trails = [[], []];
    const angles = [0, 0];
    let shake = 0, flash = 0, flashCol = '#fff', pulse = 0;
    const floaters = [];

    function addPart(p) { if (parts.length < 500) parts.push(p); }
    function sparks(x, y, n, cols, spd, dirx, diry, spread) {
        for (let k = 0; k < n; k++) {
            let a = Math.random() * Math.PI * 2;
            if (dirx !== undefined) a = Math.atan2(diry, dirx) + (Math.random() - 0.5) * spread;
            const s = spd * (0.3 + Math.random());
            addPart({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 16 + Math.random() * 18, c: cols[k % cols.length], w: 1 + Math.random() * 2 });
        }
    }
    function ring(x, y, c, r, life, w) { addPart({ k: 'ring', x, y, r0: 4, r, life: 0, max: life, c, w }); }
    function floater(x, y, text, c, size) { floaters.push({ x, y, text, c, size: size || 22, life: 0, max: 60 }); }

    function fx(ev) {
        const p = toView(ev.x, ev.y);
        const myTop = ev.p === myIdx;
        switch (ev.k) {
            case 'hit': {
                const nv = myRole === 'client' ? { x: -ev.nx, y: -ev.ny } : { x: ev.nx, y: ev.ny };
                const I = ev.i;
                const cnt = Math.min(60, 10 + I * 3);
                sparks(p.x, p.y, cnt / 2, ['#fff', '#ffe27a', '#ffb02e'], 2 + I * 0.7, -nv.y, nv.x, 1.2);
                sparks(p.x, p.y, cnt / 2, ['#fff', '#ffe27a', '#ff6ad5'], 2 + I * 0.7, nv.y, -nv.x, 1.2);
                ring(p.x, p.y, 'rgba(255,240,200,', 20 + I * 5, 18, 3);
                if (I > 7) ring(p.x, p.y, 'rgba(255,90,200,', 40 + I * 7, 26, 5);
                shake = Math.max(shake, Math.min(16, I * 1.1));
                pulse = Math.min(1, pulse + I / 14);
                if (I > 9) { flash = 0.35; flashCol = '#fff'; }
                if (ev.c) floater(p.x, p.y - 30, 'CRITICAL!', '#ffd34d', 26);
                else if (I > 11) floater(p.x, p.y - 30, 'SMASH!', '#ff8bd8', 22);
                Sfx.clash(I);
                if (I > 7) GameFit.buzz(Math.min(40, I * 2));
                break;
            }
            case 'wall':
                sparks(p.x, p.y, 8 + ev.i * 1.5, ['#fff', '#9be8ff', '#ff9bd8'], 2 + ev.i * 0.4);
                shake = Math.max(shake, ev.i * 0.5);
                Sfx.wall(ev.i);
                break;
            case 'dash': {
                ring(p.x, p.y, 'rgba(255,255,255,', 50, 14, 3);
                Sfx.dash();
                break;
            }
            case 'spec': {
                const b = BEYS[(D() && D().tp ? D().tp[ev.p] : 'attack')];
                ring(p.x, p.y, hexA(b.c1), 160, 34, 8);
                ring(p.x, p.y, 'rgba(255,255,255,', 110, 24, 3);
                sparks(p.x, p.y, 40, [b.c1, b.c2, '#fff'], 7);
                flash = 0.5; flashCol = b.c1;
                shake = Math.max(shake, 10);
                floater(p.x, p.y - 50, 'LIMIT BREAK!', b.c2, 30);
                floater(p.x, p.y - 20, b.spec, b.c1, 20);
                Sfx.special();
                break;
            }
            case 'launch': {
                const b = BEYS[(D() && D().tp ? D().tp[ev.p] : 'attack')];
                sparks(p.x, p.y, 26, [b.c1, b.c2, '#fff'], 6);
                ring(p.x, p.y, hexA(b.c1), 70, 20, 4);
                if (ev.pf) floater(p.x, p.y + (myTop ? -60 : 60), 'PERFECT!!', '#ffd34d', 30);
                if (ev.p === 0) { Sfx.launch(); shake = Math.max(shake, 6); }
                break;
            }
            case 'burst': {
                const b = BEYS[(D() && D().tp ? D().tp[ev.p] : 'attack')];
                for (let k = 0; k < 14; k++) {
                    const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 8;
                    addPart({ k: 'shard', x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: a, vr: (Math.random() - 0.5) * 0.6, life: 0, max: 70 + Math.random() * 30, c: k % 3 ? b.c1 : '#d9dce8', s: 7 + Math.random() * 9 });
                }
                sparks(p.x, p.y, 60, ['#fff', '#ffd34d', b.c1], 10);
                ring(p.x, p.y, 'rgba(255,220,120,', 220, 40, 10);
                ring(p.x, p.y, 'rgba(255,255,255,', 140, 26, 4);
                flash = 0.8; flashCol = '#fff';
                shake = 24;
                Sfx.burst();
                GameFit.buzz(80);
                break;
            }
            case 'over':
                sparks(p.x, p.y, 40, ['#ff4d4d', '#ffb02e', '#fff'], 8);
                ring(p.x, p.y, 'rgba(255,80,80,', 140, 30, 6);
                flash = 0.45; flashCol = '#ff4d4d';
                shake = 18;
                Sfx.over();
                GameFit.buzz(60);
                break;
            case 'stop':
                ring(p.x, p.y, 'rgba(160,200,255,', 60, 30, 3);
                Sfx.stop();
                break;
        }
    }
    function hexA(hex) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},`;
    }

    // ==========================================================
    // Stadium (pre-rendered)
    // ==========================================================
    const stadium = document.createElement('canvas');
    (function buildStadium() {
        const SC = 2;
        stadium.width = W * SC; stadium.height = H * SC;
        const g = stadium.getContext('2d');
        g.scale(SC, SC);
        // floor
        let gr = g.createRadialGradient(CX, CY, 50, CX, CY, W * 0.75);
        gr.addColorStop(0, '#1b0d33'); gr.addColorStop(1, '#040209');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        // hex-ish dotted floor grid
        g.fillStyle = 'rgba(180,140,255,0.08)';
        for (let y = 8; y < H; y += 18) for (let x = (y / 18) % 2 ? 8 : 17; x < W; x += 18) g.fillRect(x, y, 1.5, 1.5);
        // outer ticks
        g.strokeStyle = 'rgba(255,255,255,0.10)';
        g.lineWidth = 2;
        for (let k = 0; k < 72; k++) {
            const a = k / 72 * Math.PI * 2, r0 = ARENA_R + 26, r1x = ARENA_R + (k % 6 ? 32 : 40);
            g.beginPath();
            g.moveTo(CX + Math.cos(a) * r0, CY + Math.sin(a) * r0);
            g.lineTo(CX + Math.cos(a) * r1x, CY + Math.sin(a) * r1x);
            g.stroke();
        }
        // bowl
        gr = g.createRadialGradient(CX, CY, 10, CX, CY, ARENA_R);
        gr.addColorStop(0, '#0b0f24');
        gr.addColorStop(0.55, '#121838');
        gr.addColorStop(0.9, '#222a5c');
        gr.addColorStop(1, '#3a4385');
        g.fillStyle = gr;
        g.beginPath(); g.arc(CX, CY, ARENA_R, 0, Math.PI * 2); g.fill();
        // concentric ridges
        for (let k = 1; k <= 5; k++) {
            g.strokeStyle = `rgba(140,160,255,${0.05 + k * 0.012})`;
            g.lineWidth = 1;
            g.beginPath(); g.arc(CX, CY, ARENA_R * k / 6, 0, Math.PI * 2); g.stroke();
        }
        // spokes
        g.strokeStyle = 'rgba(140,160,255,0.06)';
        for (let k = 0; k < 24; k++) {
            const a = k / 24 * Math.PI * 2;
            g.beginPath();
            g.moveTo(CX + Math.cos(a) * 40, CY + Math.sin(a) * 40);
            g.lineTo(CX + Math.cos(a) * (ARENA_R - 6), CY + Math.sin(a) * (ARENA_R - 6));
            g.stroke();
        }
        // big X emblem
        g.save();
        g.translate(CX, CY);
        g.strokeStyle = 'rgba(255,63,180,0.10)';
        g.lineWidth = 18; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-80, -80); g.lineTo(80, 80); g.moveTo(80, -80); g.lineTo(-80, 80); g.stroke();
        g.strokeStyle = 'rgba(45,226,255,0.08)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, 46, 0, Math.PI * 2); g.stroke();
        g.restore();
        // rim (with gaps for pockets)
        const rimSeg = (a0, a1) => {
            g.lineCap = 'butt';
            const mg = g.createRadialGradient(CX, CY, ARENA_R, CX, CY, ARENA_R + 16);
            mg.addColorStop(0, '#9aa3d6'); mg.addColorStop(0.4, '#4a5080'); mg.addColorStop(1, '#151829');
            g.strokeStyle = mg; g.lineWidth = 16;
            g.beginPath(); g.arc(CX, CY, ARENA_R + 8, a0, a1); g.stroke();
            g.save();
            g.shadowColor = '#ff3fb4'; g.shadowBlur = 14;
            const lg = g.createLinearGradient(0, 0, W, H);
            lg.addColorStop(0, '#ff3fb4'); lg.addColorStop(1, '#2de2ff');
            g.strokeStyle = lg; g.lineWidth = 3;
            g.beginPath(); g.arc(CX, CY, ARENA_R + 1, a0, a1); g.stroke();
            g.restore();
        };
        rimSeg(POCKET_HALF, Math.PI - POCKET_HALF);
        rimSeg(Math.PI + POCKET_HALF, Math.PI * 2 - POCKET_HALF);
        // pockets
        for (const base of [0, Math.PI]) {
            g.save();
            const pg = g.createRadialGradient(CX, CY, ARENA_R - 10, CX, CY, ARENA_R + 50);
            pg.addColorStop(0, 'rgba(255,40,60,0)'); pg.addColorStop(0.35, 'rgba(255,40,60,0.35)'); pg.addColorStop(1, 'rgba(0,0,0,0.95)');
            g.fillStyle = pg;
            g.beginPath();
            g.arc(CX, CY, ARENA_R + 50, base - POCKET_HALF, base + POCKET_HALF);
            g.arc(CX, CY, ARENA_R - 8, base + POCKET_HALF, base - POCKET_HALF, true);
            g.closePath(); g.fill();
            g.shadowColor = '#ff3030'; g.shadowBlur = 12;
            g.strokeStyle = '#ff5050'; g.lineWidth = 3;
            for (const s of [-1, 1]) {
                const a = base + s * POCKET_HALF;
                g.beginPath();
                g.moveTo(CX + Math.cos(a) * (ARENA_R - 4), CY + Math.sin(a) * (ARENA_R - 4));
                g.lineTo(CX + Math.cos(a) * (ARENA_R + 44), CY + Math.sin(a) * (ARENA_R + 44));
                g.stroke();
            }
            g.restore();
            g.save();
            g.translate(CX + Math.cos(base) * (ARENA_R + 22), CY + Math.sin(base) * (ARENA_R + 22));
            g.rotate(base === 0 ? Math.PI / 2 : -Math.PI / 2);
            g.fillStyle = '#ffd1d1';
            g.font = 'italic 900 13px Orbitron, sans-serif';
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText('OVER', 0, 0);
            g.restore();
        }
    })();

    // ==========================================================
    // Bey drawing
    // ==========================================================
    function bladePath(g, b, r) {
        g.beginPath();
        for (let k = 0; k < b.blades; k++) {
            const base = k / b.blades * Math.PI * 2;
            b.shape.forEach(([rr, aa], j) => {
                const x = Math.cos(base + aa) * rr * r, y = Math.sin(base + aa) * rr * r;
                if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
            });
            g.closePath();
        }
    }

    function drawBey(g, x, y, type, ang, opt) {
        const b = BEYS[type], r = b.r * (opt.scale || 1);
        const spinF = clamp(opt.spin / 100, 0, 1.1);
        g.save();
        g.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
        // shadow
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.beginPath(); g.ellipse(x + 5, y + 8, r * 1.02, r * 0.9, 0, 0, Math.PI * 2); g.fill();
        // wobble when low on spin
        let wx = 0, wy = 0, sy = 1;
        if (opt.stopped) { sy = 0.82; }
        else if (opt.live && spinF < 0.3) {
            const w = (0.3 - spinF) / 0.3;
            wx = Math.cos(opt.t * 0.22) * w * 5; wy = Math.sin(opt.t * 0.22) * w * 5;
            sy = 1 - w * 0.12;
        }
        g.translate(x + wx, y + wy);
        g.scale(1, sy);
        // aura
        if (opt.aura) {
            g.save();
            g.globalCompositeOperation = 'lighter';
            const fl = 0.75 + Math.random() * 0.25;
            const ag = g.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.1 * fl);
            ag.addColorStop(0, hexA(b.c1) + '0.55)'); ag.addColorStop(1, hexA(b.c1) + '0)');
            g.fillStyle = ag;
            g.beginPath(); g.arc(0, 0, r * 2.1 * fl, 0, Math.PI * 2); g.fill();
            g.restore();
        }
        // spin blur disc
        if (opt.live) {
            const bg = g.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.08);
            bg.addColorStop(0, hexA(b.c2) + (0.08 + spinF * 0.18) + ')');
            bg.addColorStop(0.75, hexA(b.c1) + (0.1 + spinF * 0.3) + ')');
            bg.addColorStop(1, hexA(b.c1) + '0)');
            g.fillStyle = bg;
            g.beginPath(); g.arc(0, 0, r * 1.08, 0, Math.PI * 2); g.fill();
        }
        // motion-blur ghosts
        const blur = opt.live ? Math.min(1, spinF * 1.2) : 0;
        if (blur > 0.1) {
            for (let k = 3; k >= 1; k--) {
                g.save();
                g.rotate(ang - k * 0.2);
                g.globalAlpha *= 0.16 * blur;
                g.fillStyle = b.c1;
                bladePath(g, b, r);
                g.fill();
                g.restore();
            }
        }
        // blades
        g.save();
        g.rotate(ang);
        g.globalAlpha *= 1 - blur * 0.25;
        const lg = g.createLinearGradient(-r, -r, r, r);
        lg.addColorStop(0, b.c2); lg.addColorStop(0.5, b.c1); lg.addColorStop(1, '#1a1020');
        g.fillStyle = lg;
        bladePath(g, b, r);
        g.fill();
        g.lineWidth = 1.5; g.strokeStyle = 'rgba(10,6,20,0.8)'; g.stroke();
        // metal disc
        const mg = g.createRadialGradient(-r * 0.2, -r * 0.2, 2, 0, 0, r * 0.62);
        mg.addColorStop(0, '#ffffff'); mg.addColorStop(0.4, '#b8bfd8'); mg.addColorStop(1, '#4a5070');
        g.fillStyle = mg;
        g.beginPath(); g.arc(0, 0, r * 0.6, 0, Math.PI * 2); g.fill();
        // disc cut-outs
        g.fillStyle = 'rgba(20,20,40,0.55)';
        for (let k = 0; k < b.blades; k++) {
            const a = (k + 0.5) / b.blades * Math.PI * 2;
            g.beginPath(); g.arc(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, r * 0.08, 0, Math.PI * 2); g.fill();
        }
        g.restore();
        // owner ring
        g.lineWidth = 3;
        g.strokeStyle = opt.owner;
        g.shadowColor = opt.owner; g.shadowBlur = opt.live ? 10 : 0;
        g.beginPath(); g.arc(0, 0, r * 0.68, 0, Math.PI * 2); g.stroke();
        g.shadowBlur = 0;
        // bit chip
        g.save();
        g.rotate(ang * 0.5);
        g.fillStyle = '#120b1e';
        g.beginPath(); g.arc(0, 0, r * 0.3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = b.c1; g.lineWidth = 2;
        g.beginPath();
        for (let k = 0; k < 3; k++) {
            const a = k / 3 * Math.PI * 2;
            g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(a + 0.8) * r * 0.25, Math.sin(a + 0.8) * r * 0.25, Math.cos(a) * r * 0.24, Math.sin(a) * r * 0.24);
        }
        g.stroke();
        g.restore();
        // specular
        g.strokeStyle = 'rgba(255,255,255,0.45)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, r * 0.9, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
        g.restore();
    }

    // ==========================================================
    // Render
    // ==========================================================
    let lastNow = performance.now();
    let tGlobal = 0;
    let prevKey = '';
    let lastBeep = -1;

    function render(now) {
        const dtf = Math.min(3, (now - lastNow) / (1000 / 60));
        lastNow = now;
        tGlobal += dtf;
        const d = D();
        const tops = d ? drawTops() : [];
        const ph = d ? d.ph : 'idle';
        const pt = curPt();
        const bt = d ? d.bt + (myRole === 'client' && ph === 'battle' ? since() : 0) : 0;
        const ft = d ? d.ft + (myRole === 'client' && ph === 'finish' ? since() : 0) : 0;

        // phase-change sounds (deterministic from state, both sides)
        if (d) {
            const key = d.rd + ph;
            if (key !== prevKey) {
                if (ph === 'finish' && d.fin) {
                    if (d.fin.w === myIdx) setTimeout(() => Sfx.win(), 300);
                }
                if (ph === 'launch') lastBeep = -1;
                prevKey = key;
            }
            if (ph === 'launch') {
                const step = Math.floor(pt / 60);
                if (step !== lastBeep && step < 3) { lastBeep = step; Sfx.beep(false); }
            } else if (ph === 'battle' && lastBeep !== 3 && bt < 10) { lastBeep = 3; Sfx.beep(true); }
            tops.forEach((t, i) => Sfx.hum(i, t.spin, (ph === 'battle' || ph === 'finish') && t.st === 0));
        } else {
            Sfx.hum(0, 0, false); Sfx.hum(1, 0, false);
        }

        view.begin(ctx);
        ctx.fillStyle = '#05030b';
        ctx.fillRect(0, 0, W, H);
        // camera: shake + finish zoom
        ctx.save();
        if (shake > 0.2) {
            ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
            shake *= Math.pow(0.86, dtf);
        } else shake = 0;
        let zoom = 1;
        if (ph === 'finish' && d.fin) {
            const k = Math.min(1, ft / 20) * (ft > FINISH_T - 30 ? Math.max(0, (FINISH_T - ft) / 30) : 1);
            zoom = 1 + 0.12 * k;
            const fp = toView(d.fin.x, d.fin.y);
            const fx0 = CX + (fp.x - CX) * 0.4 * k, fy0 = CY + (fp.y - CY) * 0.4 * k;
            ctx.translate(CX, CY); ctx.scale(zoom, zoom); ctx.translate(-fx0, -fy0);
        }

        ctx.drawImage(stadium, 0, 0, W, H);

        // rotating neon rings + centre pulse
        pulse *= Math.pow(0.95, dtf);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const rot = tGlobal * 0.01 + (ph === 'battle' ? tGlobal * 0.01 : 0);
        for (let k = 0; k < 6; k++) {
            const a0 = rot + k * Math.PI / 3;
            ctx.strokeStyle = k % 2 ? `rgba(45,226,255,${0.25 + pulse * 0.5})` : `rgba(255,63,180,${0.25 + pulse * 0.5})`;
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(CX, CY, ARENA_R + 46, a0, a0 + 0.55); ctx.stroke();
        }
        const cg = ctx.createRadialGradient(CX, CY, 0, CX, CY, 120);
        cg.addColorStop(0, `rgba(255,63,180,${0.08 + pulse * 0.35})`);
        cg.addColorStop(1, 'rgba(255,63,180,0)');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(CX, CY, 120, 0, Math.PI * 2); ctx.fill();
        // pocket danger glow when someone is close
        for (const base of [0, Math.PI]) {
            let danger = 0;
            tops.forEach((t) => {
                if (t.st !== 0) return;
                const v = toView(t.x, t.y);
                const ex = v.x - CX, ey = v.y - CY, ed = Math.hypot(ex, ey);
                let da = Math.abs(Math.atan2(ey, ex) - base); if (da > Math.PI) da = Math.PI * 2 - da;
                if (ed > ARENA_R - 90 && da < 0.7) danger = Math.max(danger, (ed - (ARENA_R - 90)) / 90 * (1 - da / 0.7));
            });
            if (danger > 0) {
                const px = CX + Math.cos(base) * ARENA_R, py = CY + Math.sin(base) * ARENA_R;
                const dg = ctx.createRadialGradient(px, py, 0, px, py, 90);
                dg.addColorStop(0, `rgba(255,40,40,${danger * (0.45 + 0.25 * Math.sin(tGlobal * 0.5))})`);
                dg.addColorStop(1, 'rgba(255,40,40,0)');
                ctx.fillStyle = dg;
                ctx.beginPath(); ctx.arc(px, py, 90, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.restore();

        // trails
        tops.forEach((t, i) => {
            const v = toView(t.x, t.y);
            const tr = trails[i];
            if (t.st === 0 && (ph === 'battle' || ph === 'finish')) {
                tr.push({ x: v.x, y: v.y, dash: t.dash > 0 || (t.sp > 0) });
                if (tr.length > 18) tr.shift();
            } else if (tr.length) tr.shift();
            if (tr.length < 2) return;
            const b = BEYS[t.type];
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'round';
            for (let k = 1; k < tr.length; k++) {
                const f = k / tr.length;
                ctx.strokeStyle = hexA(tr[k].dash ? '#ffffff' : b.c1) + (f * (tr[k].dash ? 0.7 : 0.4)) + ')';
                ctx.lineWidth = f * b.r * (tr[k].dash ? 1.4 : 0.9);
                ctx.beginPath(); ctx.moveTo(tr[k - 1].x, tr[k - 1].y); ctx.lineTo(tr[k].x, tr[k].y); ctx.stroke();
            }
            ctx.restore();
        });

        // tops
        tops.forEach((t, i) => {
            if (t.st === 2) return;
            const v = toView(t.x, t.y);
            const live = t.st === 0 && (ph === 'battle' || ph === 'finish');
            if (live || t.st === 1) angles[i] += Math.min(0.62, 0.06 + t.spin * 0.0058) * dtf;
            let scale = 1, alpha = 1;
            if (t.st === 1) {
                const ed = Math.hypot(t.x - CX, t.y - CY);
                scale = clamp(1 - (ed - ARENA_R) / 110, 0.25, 1);
                alpha = clamp(1 - (ed - ARENA_R) / 140, 0, 1);
            }
            if (ph === 'launch') {
                // launcher ready ring
                const b = BEYS[t.type];
                ctx.save();
                ctx.strokeStyle = hexA(OWNER[i]) + (0.4 + 0.3 * Math.sin(tGlobal * 0.2)) + ')';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 6]);
                ctx.lineDashOffset = -tGlobal;
                ctx.beginPath(); ctx.arc(v.x, v.y, b.r + 14, 0, Math.PI * 2); ctx.stroke();
                ctx.restore();
            }
            if (t.sp > 0 && t.st === 0 && Math.random() < 0.6 * dtf) {
                const b = BEYS[t.type];
                const a = Math.random() * Math.PI * 2;
                addPart({ k: 'ember', x: v.x + Math.cos(a) * b.r, y: v.y + Math.sin(a) * b.r, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6 - 0.8, life: 0, max: 30, c: Math.random() < 0.5 ? b.c1 : b.c2, w: 2 + Math.random() * 3 });
            }
            drawBey(ctx, v.x, v.y, t.type, angles[i], {
                spin: t.spin, live, stopped: t.st === 3, t: tGlobal, aura: t.sp > 0 && t.st === 0,
                owner: OWNER[i], scale, alpha
            });
        });

        // particles
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let k = parts.length - 1; k >= 0; k--) {
            const p = parts[k];
            p.life += dtf;
            if (p.life >= p.max) { parts.splice(k, 1); continue; }
            const f = 1 - p.life / p.max;
            if (p.k === 'spark') {
                p.x += p.vx * dtf; p.y += p.vy * dtf; p.vx *= Math.pow(0.92, dtf); p.vy *= Math.pow(0.92, dtf);
                ctx.strokeStyle = p.c; ctx.globalAlpha = f; ctx.lineWidth = p.w;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2); ctx.stroke();
            } else if (p.k === 'ring') {
                const r = p.r0 + (p.r - p.r0) * (1 - f * f);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = p.c + f + ')'; ctx.lineWidth = p.w * f + 0.5;
                ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
            } else if (p.k === 'ember') {
                p.x += p.vx * dtf; p.y += p.vy * dtf;
                ctx.globalAlpha = f; ctx.fillStyle = p.c;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.w * f, 0, Math.PI * 2); ctx.fill();
            } else if (p.k === 'shard') {
                p.x += p.vx * dtf; p.y += p.vy * dtf; p.vx *= Math.pow(0.96, dtf); p.vy *= Math.pow(0.96, dtf); p.rot += p.vr * dtf;
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = Math.min(1, f * 2);
                ctx.translate(p.x, p.y); ctx.rotate(p.rot);
                ctx.fillStyle = p.c;
                ctx.beginPath(); ctx.moveTo(-p.s, -p.s * 0.4); ctx.lineTo(p.s, 0); ctx.lineTo(-p.s * 0.5, p.s * 0.5); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
                ctx.restore();
            }
        }
        ctx.restore();

        // floaters
        for (let k = floaters.length - 1; k >= 0; k--) {
            const f = floaters[k];
            f.life += dtf;
            if (f.life > f.max) { floaters.splice(k, 1); continue; }
            const e = f.life / f.max, s = e < 0.15 ? 0.6 + e / 0.15 * 0.6 : 1.2 - Math.min(0.2, (e - 0.15));
            ctx.save();
            ctx.translate(f.x, f.y - e * 30);
            ctx.scale(s, s);
            ctx.globalAlpha = e > 0.7 ? (1 - e) / 0.3 : 1;
            ctx.font = `italic 900 ${f.size}px Orbitron, sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,0,20,0.85)'; ctx.strokeText(f.text, 0, 0);
            ctx.shadowColor = f.c; ctx.shadowBlur = 14;
            ctx.fillStyle = f.c; ctx.fillText(f.text, 0, 0);
            ctx.restore();
        }

        ctx.restore(); // camera

        // ---------- HUD (not zoomed / shaken) ----------
        if (d && tops.length === 2) drawHud(d, tops, ph, pt, bt, ft);

        if (flash > 0.01) {
            ctx.save();
            ctx.globalAlpha = flash;
            ctx.fillStyle = flashCol;
            ctx.fillRect(0, 0, W, H);
            ctx.restore();
            flash *= Math.pow(0.86, dtf);
        }
        // vignette
        const vg = ctx.createRadialGradient(CX, CY, W * 0.35, CX, CY, W * 0.75);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

        // special button state on touch
        const me = tops[myIdx];
        specialBtn.classList.toggle('ready', !!me && me.sg >= 100 && me.sp <= 0 && ph === 'battle');

        if (!overlay.classList.contains('hidden')) renderPicker(dtf);
        requestAnimationFrame(render);
    }

    function textC(str, x, y, size, fill, glow, stroke) {
        ctx.font = `italic 900 ${size}px Orbitron, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(8,0,18,0.9)'; ctx.strokeText(str, x, y); }
        if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 18; }
        ctx.fillStyle = fill; ctx.fillText(str, x, y);
        ctx.shadowBlur = 0;
    }

    function drawHud(d, tops, ph, pt, bt, ft) {
        const RH = ARENA_R + 30;
        const deg = Math.PI / 180;
        for (const side of [0, 1]) {               // 0 = me (bottom), 1 = opponent (top)
            const i = side === 0 ? myIdx : 1 - myIdx;
            const t = tops[i], b = BEYS[t.type];
            const a0 = side === 0 ? 150 * deg : 210 * deg;
            const dir = side === 0 ? -1 : 1;
            const span = 120 * deg;
            const fSpin = clamp(t.spin / SPIN_MAX, 0, 1);
            ctx.save();
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 10;
            ctx.beginPath(); ctx.arc(CX, CY, RH, Math.min(a0, a0 + dir * span), Math.max(a0, a0 + dir * span)); ctx.stroke();
            if (fSpin > 0.002) {
                const low = fSpin < 0.25;
                ctx.strokeStyle = low ? (Math.sin(tGlobal * 0.4) > 0 ? '#ff4d4d' : '#ffb0b0') : b.c1;
                ctx.shadowColor = b.c1; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(CX, CY, RH, Math.min(a0, a0 + dir * span * fSpin), Math.max(a0, a0 + dir * span * fSpin)); ctx.stroke();
                ctx.shadowBlur = 0;
            }
            // burst gauge (inner thin arc)
            const fB = clamp(t.bg / 100, 0, 1);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(CX, CY, RH - 11, Math.min(a0, a0 + dir * span), Math.max(a0, a0 + dir * span)); ctx.stroke();
            if (fB > 0.002) {
                ctx.strokeStyle = fB > 0.7 ? (Math.sin(tGlobal * 0.6) > 0 ? '#ff2a2a' : '#ffd34d') : '#ff7a3d';
                ctx.beginPath(); ctx.arc(CX, CY, RH - 11, Math.min(a0, a0 + dir * span * fB), Math.max(a0, a0 + dir * span * fB)); ctx.stroke();
            }
            ctx.restore();

            // corner labels
            const y = side === 0 ? H - 22 : 22;
            const yy = side === 0 ? H - 44 : 44;
            ctx.save();
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.font = 'italic 900 13px Orbitron, sans-serif';
            ctx.fillStyle = OWNER[i];
            ctx.fillText(side === 0 ? 'YOU' : (GameBot.enabled ? 'CPU' : 'RIVAL'), 14, yy);
            ctx.fillStyle = b.c1;
            ctx.fillText(b.short, 14, y);
            ctx.font = 'italic 900 22px Orbitron, sans-serif';
            ctx.fillStyle = '#fff';
            ctx.fillText(String(Math.max(0, Math.round(t.spin))), 104, yy + 11);
            ctx.font = '700 9px Orbitron, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fillText('SPIN', 104, yy - 9);
            ctx.restore();

            // limit-break gauge (right corner)
            const gx = W - 36, gy = side === 0 ? H - 36 : 36;
            const fS = clamp(t.sg / 100, 0, 1);
            const ready = fS >= 1 && t.sp <= 0;
            ctx.save();
            ctx.fillStyle = 'rgba(10,6,24,0.75)';
            ctx.beginPath(); ctx.arc(gx, gy, 24, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.arc(gx, gy, 21, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = t.sp > 0 ? '#fff' : ready ? '#ffd34d' : b.c1;
            if (ready || t.sp > 0) { ctx.shadowColor = '#ffd34d'; ctx.shadowBlur = 12 + 8 * Math.sin(tGlobal * 0.3); }
            const f2 = t.sp > 0 ? t.sp / 180 : fS;
            ctx.beginPath(); ctx.arc(gx, gy, 21, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f2); ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.font = '900 16px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = ready ? '#ffd34d' : 'rgba(255,255,255,0.6)';
            ctx.fillText('⚡', gx, gy);
            if (side === 0 && ready && !GameFit.isTouch) {
                ctx.font = 'italic 900 10px Orbitron, sans-serif';
                ctx.fillText('PRESS E', gx - 4, gy - 34);
            }
            ctx.restore();
        }

        // launch phase: countdown + power meter
        if (ph === 'launch') {
            const step = Math.min(2, Math.floor(pt / 60));
            const within = (pt % 60) / 60;
            const s = 1.8 - Math.min(1, within * 4) * 0.8;
            ctx.save();
            ctx.globalAlpha = within > 0.8 ? (1 - within) / 0.2 : 1;
            ctx.translate(CX, CY - 10);
            ctx.scale(s, s);
            textC(String(3 - step), 0, 0, 84, '#fff', '#ff3fb4', 8);
            ctx.restore();
            textC('READY…', CX, CY + 58, 16, 'rgba(255,255,255,0.7)');

            const myLk = d.lk[myIdx], opLk = d.lk[1 - myIdx];
            const m = myLk >= 0 ? myLk : meter(pt);
            const bw = 280, bh = 18, bx = CX - bw / 2, by = H - 72;
            ctx.save();
            ctx.fillStyle = 'rgba(10,6,24,0.8)';
            roundRect(bx - 6, by - 26, bw + 12, bh + 40, 10); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            roundRect(bx, by, bw, bh, 6); ctx.fill();
            const mg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
            mg.addColorStop(0, '#2de2ff'); mg.addColorStop(0.6, '#ff3fb4'); mg.addColorStop(1, '#ffd34d');
            ctx.fillStyle = mg;
            roundRect(bx, by, bw * m, bh, 6); ctx.fill();
            ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
            ctx.strokeRect(bx + bw * PERFECT, by - 2, bw * (1 - PERFECT), bh + 4);
            ctx.font = 'italic 900 12px Orbitron, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#fff';
            const lbl = myLk >= 0 ? (myLk >= PERFECT ? 'PERFECT!!  READY TO RIP' : `LOCKED  ${Math.round(myLk * 100)}%`)
                : (GameFit.isTouch ? 'TAP TO SHOOT — 满格 = PERFECT' : 'SPACE / CLICK TO SHOOT — 满格 = PERFECT');
            ctx.fillStyle = myLk >= PERFECT ? '#ffd34d' : '#fff';
            ctx.fillText(lbl, CX, by - 12);
            ctx.restore();
            textC(opLk >= 0 ? 'RIVAL READY ✓' : 'RIVAL CHARGING…', CX, 96, 13, opLk >= 0 ? '#9bffcf' : 'rgba(255,255,255,0.6)');
        }

        if (ph === 'battle' && bt < 55) {
            const e = bt / 55;
            ctx.save();
            ctx.globalAlpha = e > 0.6 ? (1 - e) / 0.4 : 1;
            ctx.translate(CX, CY);
            ctx.rotate(-0.08);
            const s = 0.6 + Math.min(1, e * 5) * 0.6 + e * 0.2;
            ctx.scale(s, s);
            // speed lines
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 2;
            for (let k = 0; k < 20; k++) {
                const a = k / 20 * Math.PI * 2;
                ctx.beginPath(); ctx.moveTo(Math.cos(a) * 120, Math.sin(a) * 60); ctx.lineTo(Math.cos(a) * 220, Math.sin(a) * 110); ctx.stroke();
            }
            const tg = ctx.createLinearGradient(-150, 0, 150, 0);
            tg.addColorStop(0, '#2de2ff'); tg.addColorStop(0.5, '#ffffff'); tg.addColorStop(1, '#ff3fb4');
            textC('GO SHOOT!', 0, 0, 56, tg, '#ff3fb4', 10);
            ctx.restore();
        }
        if (ph === 'battle' && d.sd && Math.sin(tGlobal * 0.15) > -0.3) {
            textC('⚠ SUDDEN DEATH ⚠', CX, 74, 15, '#ff6060', '#ff0000', 4);
        }

        if (ph === 'finish' && d.fin) drawFinish(d.fin, ft);
    }

    function drawFinish(fin, ft) {
        const info = FIN_INFO[fin.k] || FIN_INFO.draw;
        const e = Math.min(1, ft / 14), ease = 1 - Math.pow(1 - e, 3);
        const out = ft > FINISH_T - 20 ? (FINISH_T - ft) / 20 : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, out);
        ctx.translate(CX, CY);
        ctx.rotate(-0.1);
        // band
        const bw = W * 1.4 * ease;
        const bgd = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
        bgd.addColorStop(0, 'rgba(0,0,0,0)'); bgd.addColorStop(0.2, 'rgba(8,2,20,0.88)');
        bgd.addColorStop(0.8, 'rgba(8,2,20,0.88)'); bgd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bgd;
        ctx.fillRect(-bw / 2, -54, bw, 108);
        ctx.fillStyle = info.col;
        ctx.fillRect(-bw / 2, -58, bw, 4);
        ctx.fillRect(-bw / 2, 54, bw, 4);
        // diagonal streaks
        ctx.save();
        ctx.beginPath(); ctx.rect(-bw / 2, -54, bw, 108); ctx.clip();
        ctx.fillStyle = hexA(info.col) + '0.12)';
        for (let k = -8; k < 8; k++) {
            const x = k * 70 + ((ft * 6) % 70);
            ctx.beginPath(); ctx.moveTo(x, -54); ctx.lineTo(x + 30, -54); ctx.lineTo(x - 10, 54); ctx.lineTo(x - 40, 54); ctx.fill();
        }
        ctx.restore();
        const s = 1 + (1 - Math.min(1, ft / 10)) * 1.2;
        ctx.save();
        ctx.scale(s, s);
        const tg = ctx.createLinearGradient(0, -24, 0, 24);
        tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, info.col);
        textC(info.text, 0, -6, fin.k === 'burst' ? 46 : 50, tg, info.col, 8);
        ctx.restore();
        let sub = 'NO POINTS';
        if (fin.w >= 0) sub = (fin.w === myIdx ? 'YOU WIN THE ROUND' : 'RIVAL WINS THE ROUND') + `  +${fin.p} PT${fin.p > 1 ? 'S' : ''}`;
        textC(sub, 0, 34, 14, fin.w === myIdx ? '#9bffcf' : fin.w >= 0 ? '#ff9b9b' : '#ddd');
        ctx.restore();
    }

    function roundRect(x, y, w, h, r) {
        w = Math.max(w, 0.01);
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    const pickAng = { attack: 0, defense: 0, stamina: 0, balance: 0 };
    function renderPicker(dtf) {
        for (const { cv, t } of pickCanvases) {
            const g = cv.getContext('2d');
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, cv.width, cv.height);
            const on = t === myPick;
            pickAng[t] += (on ? 0.45 : 0.05) * dtf;
            const s = 56 / (BEYS[t].r * 1.45);
            g.setTransform(s, 0, 0, s, 0, 0);
            drawBey(g, 56 / s, 56 / s, t, pickAng[t], { spin: on ? 100 : 25, live: on, t: tGlobal, owner: OWNER[myIdx], scale: 1, aura: on });
        }
    }

    // idle arena behind the lobby overlay
    requestAnimationFrame(render);
});
