/**
 * Link Armor — 装甲对决: 1v1 realtime top-down tank duel.
 *
 * Built on the Link Spin skeleton: GameSession (or GameBot's LocalSession)
 * pairs two browsers, the host runs the whole simulation at 60 Hz and
 * broadcasts state at 30 Hz, the client only sends inputs. One-shot presses
 * (dash / special) travel as increasing counters so a dropped packet on the
 * unreliable channel never eats a press; fire is a held flag.
 *
 * Canonical coordinates: host's tank starts at the bottom, client's at the
 * top; the client renders the arena rotated 180° so everyone fights "from
 * the bottom". Maps are 180°-symmetric, so neither seat is favoured.
 *
 * Unlike /tanks/ there is NO self-damage anywhere — by construction:
 *   - shells never ricochet (steel stops them, crates absorb them);
 *   - a shell never tests its owner for hits (b.o === i → skip);
 *   - the heavy's splash only looks at the *other* tank;
 *   - firing point-blank into a wall just sparks.
 *
 * Round flow: ready (3-2-1) → battle → finish (K.O. banner) → next round …
 * first to WIN_SCORE. After ZONE_START battle frames a red ring shrinks so
 * every round ends.
 */
document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    if (!location.hash || location.hash.length <= 1) {
        location.hash = 'room-' + Math.random().toString(36).substring(2, 9);
    }
    const L = ArmorI18n.t;
    const opponentName = new URLSearchParams(location.search).get('opponent') || '';
    const waitingText = opponentName ? L('waiting_for', { name: opponentName }) : L('waiting_peer');

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
        copyBtn.textContent = L('copied');
        setTimeout(() => { copyBtn.textContent = L('copy'); }, 2000);
    });

    // ==========================================================
    // Constants
    // ==========================================================
    const W = 640, H = 640, CX = W / 2, CY = H / 2;
    const WALL = 16;                    // border thickness
    const WIN_SCORE = 3;
    const READY_T = 150;                // 3-2-1 (50 frames each)
    const FINISH_T = 150;
    const ZONE_START = 40 * 60, ZONE_T = 20 * 60, ZONE_MAX = 470, ZONE_MIN = 80, ZONE_DMG = 0.3;
    const DASH_T = 12, DASH_CD = 120, DASH_MUL = 2.8;
    const SP_RATE = 100 / (16 * 60);    // special gauge: full in 16 s on its own
    const CRATE_HP = 50;
    const START = [{ x: CX, y: H - 80, a: -Math.PI / 2 }, { x: CX, y: 80, a: Math.PI / 2 }];
    const OWNER = ['#ff3fb4', '#2de2ff'];          // P1 magenta / P2 cyan

    const TYPES = ['rapid', 'heavy', 'sniper', 'balance'];
    // rl = reload frames, bs = shell speed, turn = turret rad/frame
    const TANKS = {
        rapid: { icon: '⚡', name: 'BLITZ', col: '#ffb020', hp: 90, spd: 2.55, r: 17, rl: 13, dmg: 8, bs: 9.5, turn: 0.10, splash: 0, len: 13 },
        heavy: { icon: '🛡️', name: 'TITAN', col: '#7dff6a', hp: 140, spd: 1.85, r: 21, rl: 42, dmg: 24, bs: 7.2, turn: 0.055, splash: 40, len: 15 },
        sniper: { icon: '🎯', name: 'HAWK', col: '#b98cff', hp: 80, spd: 2.25, r: 17, rl: 58, dmg: 30, bs: 15, turn: 0.075, splash: 0, len: 22 },
        balance: { icon: '⭐', name: 'ACE', col: '#ffe14d', hp: 105, spd: 2.2, r: 18, rl: 26, dmg: 14, bs: 10.5, turn: 0.08, splash: 0, len: 16 }
    };
    const ADV = { rapid: 'sniper', sniper: 'heavy', heavy: 'rapid' };   // key beats value
    const ADV_MUL = 1.15;
    const SPEC = { rapid: 200, heavy: 220, sniper: 360, balance: 100 };  // effect frames
    const RAIL = { dmg: 46, bs: 22 };

    // ---- Gear & loot -------------------------------------------------
    // Weapons replace the main gun until their ammo runs out (same fire
    // button); defence gear and treasures apply the moment you drive over
    // them. Counters: 🧱 armour plates shrug off 🔫 machine-gun / 🛸 drone
    // pellets, 📡 the interceptor shoots down 🚀 missiles and 🛸 drones,
    // 💠 the shield soaks a fixed amount of anything.
    const ITEMS = {
        hp: { icon: '❤️', col: '#ff5b7a', w: 18 },
        en: { icon: '🔋', col: '#ffe14d', w: 9 },
        nitro: { icon: '💨', col: '#9bffcf', w: 7 },
        star: { icon: '⭐', col: '#ffd700', w: 5 },
        mg: { icon: '🔫', col: '#ffb020', w: 13 },
        ms: { icon: '🚀', col: '#ff6a3d', w: 11 },
        dr: { icon: '🛸', col: '#8fe3ff', w: 9 },
        sh: { icon: '💠', col: '#5ad7ff', w: 9 },
        ip: { icon: '📡', col: '#c3a6ff', w: 7 },
        ar: { icon: '🧱', col: '#c9b18a', w: 7 },
        box: { icon: '🎁', col: '#ff8ad8', w: 7 }
    };
    const ITEM_KEYS = Object.keys(ITEMS);
    const ITEM_LIFE = 15 * 60, ITEM_MAX = 6, ITEM_FIRST = 4 * 60, ITEM_GAP = [8 * 60, 11 * 60], CRATE_DROP = 0.45;
    const GEAR_T = 15 * 60;                                           // shield / interceptor / plates last 15 s
    const MG = { ammo: 60, max: 120, rl: 5, dmg: 4, bs: 12, spread: 0.07 };
    const MSL = { ammo: 4, max: 8, rl: 40, dmg: 24, bs0: 4, bs1: 7.6, acc: 0.12, turn: 0.055, life: 230 };
    const DRONE = { hp: 18, life: 15 * 60, orbit: 40, rl: 45, dmg: 5, bs: 9, range: 360, max: 2 };
    const SHIELD_HP = 45, PLATE = 4, POWER_MUL = 1.3, POWER_T = 10 * 60, NITRO_T = 6 * 60;
    const IP = { range: 120, cd: 18, droneDmg: 12 };
    const SPLASH = { 1: 40, 4: 34 };                                  // bullet kind → splash radius
    // bullet kinds: 0 shell, 1 heavy, 2 rail, 3 mg, 4 missile, 5 drone pellet

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
    const rnd = (a, b) => a + Math.random() * (b - a);

    // ==========================================================
    // Maps: listed pieces get their 180° twin automatically; `mid` pieces
    // are already self-symmetric. k: 's' steel (solid), 'c' crate (breakable)
    // ==========================================================
    const MAPS = [
        {   // Crossroads
            mid: [['s', 296, 296, 48, 48]],
            half: [['s', 110, 160, 140, 22], ['s', 390, 160, 140, 22], ['c', 300, 196, 40, 40],
                ['c', 60, 290, 40, 40], ['c', 200, 250, 36, 36], ['s', 470, 240, 22, 80]]
        },
        {   // Fortress
            mid: [['c', 300, 300, 40, 40]],
            half: [['s', 196, 308, 74, 24], ['s', 250, 140, 140, 20], ['c', 150, 200, 36, 36],
                ['c', 454, 200, 36, 36], ['c', 76, 110, 36, 36], ['s', 510, 90, 22, 110], ['c', 300, 236, 40, 34]]
        },
        {   // Crate yard
            mid: [['c', 300, 300, 40, 40]],
            half: [['c', 220, 220, 40, 40], ['c', 380, 220, 40, 40], ['s', 60, 200, 100, 22], ['s', 480, 200, 100, 22],
                ['c', 150, 110, 36, 36], ['c', 454, 110, 36, 36], ['c', 300, 160, 40, 40], ['s', 40, 330, 22, 90]]
        }
    ];
    const MAP_RECTS = MAPS.map((m) => {
        const out = [];
        const add = (p) => out.push({ k: p[0], x: p[1], y: p[2], w: p[3], h: p[4] });
        m.mid.forEach(add);
        m.half.forEach((p) => { add(p); add([p[0], W - p[1] - p[3], H - p[2] - p[4], p[3], p[4]]); });
        let ci = 0;
        out.forEach((r) => { if (r.k === 'c') r.ci = ci++; });
        out.nCrates = ci;
        return out;
    });

    /** Rect index containing (x, y) — steel always, crates only while alive. -2 = outside the field. */
    function rectAt(x, y, mp, cr) {
        if (x < WALL || y < WALL || x > W - WALL || y > H - WALL) return -2;
        const rs = MAP_RECTS[mp];
        for (let i = 0; i < rs.length; i++) {
            const r = rs[i];
            if (r.k === 'c' && !(cr && cr[r.ci] > 0)) continue;
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
        }
        return -1;
    }
    /** Is the straight line blocked? withCrates=false → only steel counts. */
    function blocked(x0, y0, x1, y1, mp, cr, withCrates) {
        const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 7);
        for (let i = 1; i < n; i++) {
            const k = rectAt(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, mp, withCrates ? cr : null);
            if (k === -2) return true;
            if (k >= 0 && (withCrates || MAP_RECTS[mp][k].k === 's')) return true;
        }
        return false;
    }
    function pushOut(t, r, mp, cr) {
        for (let pass = 0; pass < 2; pass++) {
            for (const rc of MAP_RECTS[mp]) {
                if (rc.k === 'c' && !(cr[rc.ci] > 0)) continue;
                const nx = clamp(t.x, rc.x, rc.x + rc.w), ny = clamp(t.y, rc.y, rc.y + rc.h);
                const dx = t.x - nx, dy = t.y - ny, d2 = dx * dx + dy * dy;
                if (d2 >= r * r) continue;
                if (d2 > 1e-6) {
                    const d = Math.sqrt(d2);
                    t.x += dx / d * (r - d); t.y += dy / d * (r - d);
                } else {        // centre inside: leave by the nearest edge
                    const e = [t.x - rc.x, rc.x + rc.w - t.x, t.y - rc.y, rc.y + rc.h - t.y];
                    const m = Math.min(...e);
                    if (m === e[0]) t.x = rc.x - r; else if (m === e[1]) t.x = rc.x + rc.w + r;
                    else if (m === e[2]) t.y = rc.y - r; else t.y = rc.y + rc.h + r;
                }
            }
            t.x = clamp(t.x, WALL + r, W - WALL - r);
            t.y = clamp(t.y, WALL + r, H - WALL - r);
        }
    }

    // ==========================================================
    // Audio (synthesised)
    // ==========================================================
    const Sfx = (() => {
        let ac = null, master = null, noiseBuf = null;
        let muted = localStorage.getItem('armor-muted') === '1';
        function init() {
            if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
            try {
                ac = new (window.AudioContext || window.webkitAudioContext)();
                master = ac.createGain();
                master.gain.value = muted ? 0 : 0.5;
                master.connect(ac.destination);
                noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
                const d = noiseBuf.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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
                localStorage.setItem('armor-muted', muted ? '1' : '0');
                if (master) master.gain.value = muted ? 0 : 0.5;
                return muted;
            },
            shot(k, mine) {
                const v = mine ? 1 : 0.6;
                if (k === 2) { tone(1800, 0.35, 'sawtooth', 0.12 * v, 120); noise(0.3, 3000, 1, 0.3 * v); return; }
                if (k === 3) { noise(0.04, 2200, 2, 0.18 * v); return; }
                if (k === 4) { noise(0.5, 600, 0.7, 0.35 * v); tone(200, 0.4, 'sawtooth', 0.06 * v, 600); return; }
                if (k === 5) { tone(1400, 0.05, 'square', 0.03 * v, 900); return; }
                if (k === 1) { noise(0.3, 220, 1, 0.55 * v, 'lowpass'); tone(110, 0.25, 'square', 0.1 * v, 40); return; }
                noise(0.08, 1300, 2, 0.28 * v); tone(520, 0.07, 'square', 0.04 * v, 200);
            },
            hit(big) { noise(big ? 0.25 : 0.12, big ? 500 : 1600, 2, big ? 0.5 : 0.35); tone(big ? 160 : 300, 0.12, 'triangle', 0.1, 80); },
            spark() { noise(0.05, 3200, 3, 0.12); },
            crate() { noise(0.25, 700, 1.2, 0.35); },
            boom() { noise(0.6, 140, 0.8, 0.7, 'lowpass'); tone(90, 0.5, 'sine', 0.25, 30); },
            dash() { noise(0.22, 900, 1.5, 0.3); },
            special() { tone(440, 0.12, 'square', 0.1); tone(660, 0.12, 'square', 0.1, null, 0.1); tone(990, 0.25, 'square', 0.1, null, 0.2); },
            pick(good) { tone(good ? 880 : 520, 0.09, 'triangle', 0.12); tone(good ? 1320 : 780, 0.14, 'triangle', 0.12, null, 0.08); },
            zap() { tone(2400, 0.08, 'sawtooth', 0.05, 900); },
            block() { tone(1600, 0.1, 'sine', 0.1, 2400); },
            beep(go) { tone(go ? 1040 : 620, go ? 0.35 : 0.14, 'square', 0.1); },
            win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'square', 0.09, null, i * 0.12)); }
        };
    })();
    const syncMute = () => { muteBtn.textContent = Sfx.muted ? '🔇' : '🔊'; };
    syncMute();
    muteBtn.addEventListener('click', () => { Sfx.init(); Sfx.toggle(); syncMute(); });

    // ==========================================================
    // View (client sees the arena rotated 180°)
    // ==========================================================
    let myRole = null, myIdx = 0;
    const view = GameFit.view(canvas, { width: W, height: H });
    const flip = () => myRole === 'client';
    const toView = (x, y) => (flip() ? { x: W - x, y: H - y } : { x, y });
    const vecToCanon = (x, y) => (flip() ? { x: -x, y: -y } : { x, y });

    // ==========================================================
    // Input
    // ==========================================================
    const keys = {};
    let dSeq = 0, sSeq = 0;
    let touchFire = false;
    let mouseAim = null;                 // logical point while the left button is held
    const touchStick = { x: 0, y: 0, on: false };

    function pressDash() { dSeq++; if (myRole === 'host') hostAction(0, 'd'); else sendInput(); }
    function pressSpecial() { sSeq++; if (myRole === 'host') hostAction(0, 's'); else sendInput(); }

    window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
        if (e.repeat) return;
        keys[e.key.toLowerCase()] = true;
        Sfx.init();
        if (!inMatch()) return;
        const k = e.key.toLowerCase();
        if (k === 'q' || k === 'k') pressDash();
        if (k === 'e' || k === 'l' || e.key === 'Shift') pressSpecial();
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseAim = null; touchFire = false; });

    const dragArea = canvas.closest('.gf-box') || canvas;
    dragArea.addEventListener('contextmenu', (e) => e.preventDefault());
    dragArea.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.overlay')) return;
        Sfx.init();
        if (!inMatch() || e.pointerType === 'touch') return;
        if (e.button === 2) { pressDash(); return; }
        if (e.button === 0) mouseAim = view.toLogical(e.clientX, e.clientY);
    });
    dragArea.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'mouse' && mouseAim && (e.buttons & 1)) mouseAim = view.toLogical(e.clientX, e.clientY);
    });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && e.button === 0) mouseAim = null; });

    // ---- control layout: two hands (stick + buttons) / one hand (right or left) ----
    // One hand = everything clustered in one corner, auto-fire when there is a
    // shot, and a double-tap on the stick dashes. Saved per device.
    const CTRL_MODES = ['two', 'right', 'left'];
    let ctrlMode = CTRL_MODES.includes(localStorage.getItem('armor-ctrl')) ? localStorage.getItem('armor-ctrl') : 'two';
    const oneHand = () => ctrlMode !== 'two';
    const touchMode = () => document.documentElement.classList.contains('gf-touch');
    const ctrlBtn = $('ctrl-mode-btn'), touchBox = $('touch-controls');
    function applyCtrlMode() {
        touchBox.classList.toggle('one-hand', oneHand());
        touchBox.classList.toggle('left-hand', ctrlMode === 'left');
        ctrlBtn.textContent = L('ctrl_' + ctrlMode);
        touchFire = false;
    }
    ctrlBtn.addEventListener('click', () => {
        ctrlMode = CTRL_MODES[(CTRL_MODES.indexOf(ctrlMode) + 1) % CTRL_MODES.length];
        localStorage.setItem('armor-ctrl', ctrlMode);
        applyCtrlMode();
    });
    applyCtrlMode();

    let stickDownAt = 0, stickUpAt = -1e9;
    GameFit.joystick($('stick-zone'), $('stick-knob'), (x, y, on) => {
        if (on && !touchStick.on) {                       // new touch on the stick
            const now = performance.now();
            if (oneHand() && inMatch() && now - stickUpAt < 280 && stickUpAt - stickDownAt < 250) pressDash();
            stickDownAt = now;
        } else if (!on && touchStick.on) stickUpAt = performance.now();
        touchStick.x = x; touchStick.y = y; touchStick.on = on;
    });

    /** One-hand auto-fire: shoot when the rival is in range and no steel is in the way. */
    const AUTO_RANGE = 460;
    function autoFireWanted() {
        const tk = drawTanks(), me = tk[myIdx], foe = tk[1 - myIdx];
        const st = myRole === 'host' ? S : net;
        if (!me || !foe || !st || !st.cr || (me.hp !== undefined && me.hp <= 0)) return false;
        if (Math.hypot(foe.x - me.x, foe.y - me.y) > AUTO_RANGE) return false;
        return !blocked(me.x, me.y, foe.x, foe.y, st.mp, st.cr, false);
    }
    GameFit.touchButtons($('touch-controls').querySelector('.touch-actions'), (action, down) => {
        Sfx.init();
        if (action === 'fire') { touchFire = down; return; }
        if (!down || !inMatch()) return;
        if (action === 'dash') pressDash();
        if (action === 'special') pressSpecial();
    }, { slide: false });

    /** {x, y, f, ax, ay} in canonical coordinates. */
    function localInput() {
        let x = 0, y = 0;
        if (keys.arrowup || keys.w) y -= 1;
        if (keys.arrowdown || keys.s) y += 1;
        if (keys.arrowleft || keys.a) x -= 1;
        if (keys.arrowright || keys.d) x += 1;
        if (touchStick.on) { x += touchStick.x; y += touchStick.y; }
        const m = Math.hypot(x, y);
        if (m > 1) { x /= m; y /= m; }
        const dir = vecToCanon(x, y);
        const out = { x: dir.x, y: dir.y, f: !!(keys[' '] || keys.j || touchFire || mouseAim || (oneHand() && touchMode() && inMatch() && autoFireWanted())), ax: null, ay: null };
        if (mouseAim) {
            const me = drawTanks()[myIdx];
            if (me) {
                const p = toView(me.x, me.y);
                const v = vecToCanon(mouseAim.x - p.x, mouseAim.y - p.y);
                const d = Math.hypot(v.x, v.y);
                if (d > 4) { out.ax = v.x / d; out.ay = v.y / d; }
            }
        }
        return out;
    }

    // ==========================================================
    // Picker
    // ==========================================================
    let myPick = TYPES.includes(localStorage.getItem('armor-pick')) ? localStorage.getItem('armor-pick') : 'balance';
    let oppPick = null;
    const pickCanvases = [];
    TYPES.forEach((t) => {
        const T = TANKS[t];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pick';
        b.dataset.type = t;
        b.style.setProperty('--c', T.col);
        const cv = document.createElement('canvas');
        cv.width = cv.height = 112;
        pickCanvases.push({ cv, t });
        const bar = (k, v) => `<div class="pk-bar" title="${L(k)}"><i style="width:${Math.round(clamp(v, 0.08, 1) * 100)}%"></i></div>`;
        const dps = T.dmg / T.rl * 60;
        b.appendChild(cv);
        b.insertAdjacentHTML('beforeend',
            `<span class="pk-name">${T.name}</span><span class="pk-type">${T.icon} ${L('t_' + t)}</span>` +
            `<div class="pk-stats">${bar('bar_hp', T.hp / 140)}${bar('bar_spd', (T.spd - 1.2) / 1.4)}${bar('bar_pow', T.dmg / 32)}</div>` +
            `<span class="pk-sp">${L('s_' + t)}</span>` +
            (ADV[t] ? `<span class="pk-adv">${L('adv', { x: TANKS[ADV[t]].icon + L('t_' + ADV[t]) })}</span>` : `<span class="pk-adv">&nbsp;</span>`));
        b.title = `${T.name} · DPS ${dps.toFixed(0)}`;
        b.addEventListener('click', () => {
            myPick = t;
            localStorage.setItem('armor-pick', t);
            refreshPicker();
            syncPick();
        });
        pickerEl.appendChild(b);
    });
    function refreshPicker() {
        pickerEl.querySelectorAll('.pick').forEach((b) => b.classList.toggle('on', b.dataset.type === myPick));
        if (myRole === 'host') picks[0] = myPick;
        oppPickEl.textContent = oppPick ? L('opp_picked', { name: `${TANKS[oppPick].icon} ${TANKS[oppPick].name} (${L('t_' + oppPick)})` }) : L('opp_choosing');
    }

    // ==========================================================
    // Host simulation
    // ==========================================================
    let S = null;              // host authoritative state
    let net = null, netAt = 0; // client: last received state
    const picks = [myPick, 'balance'];
    const inputs = [{ x: 0, y: 0, f: false, ax: null, ay: null }, { x: 0, y: 0, f: false, ax: null, ay: null }];
    const lastSeq = [{ d: null, s: null }, { d: null, s: null }];
    let evId = 0, frame = 0, hostLoop = null;
    let mapSeed = 0;
    let inputOverride = null;          // test hook: scripted input for the host's tank

    function mkTank(i, type) {
        const T = TANKS[type], st = START[i];
        return {
            type, x: st.x, y: st.y, vx: 0, vy: 0, ba: st.a, ta: st.a, hp: T.hp, sp: 0,
            dash: 0, ddx: 0, ddy: 0, dcd: 0, cd: 30, fx: 0, boost: 0, arm: 0, hitT: 0,
            w: 0, ammo: 0, sh: 0, shT: 0, ip: 0, ipCd: 0, ap: 0, pw: 0          // gear: weapon 1 mg / 2 missile
        };
    }
    function startMatch() {
        if (GameBot.enabled) picks[1] = botPickType();
        mapSeed = Math.floor(Math.random() * MAPS.length);
        S = { ph: 'ready', pt: 0, rd: 0, sc: [0, 0], tp: [picks[0], picks[1]], mp: 0, cr: [], tanks: null, bl: [], it: [], dr: [], itT: 0, itId: 0, events: [], fin: null, zr: ZONE_MAX, bt: 0 };
        lastSeq[0] = { d: null, s: null }; lastSeq[1] = { d: null, s: null };
        startRound();
        hideOverlay();
        clearInterval(hostLoop);
        hostLoop = setInterval(hostTick, 1000 / 60);
        broadcast();
    }
    function startRound() {
        S.rd++;
        S.ph = 'ready'; S.pt = 0; S.bt = 0; S.fin = null; S.zr = ZONE_MAX; S.bl = []; S.it = []; S.dr = []; S.itT = ITEM_FIRST;
        S.mp = (mapSeed + S.rd - 1) % MAPS.length;
        S.cr = new Array(MAP_RECTS[S.mp].nCrates).fill(CRATE_HP);
        S.tanks = [mkTank(0, S.tp[0]), mkTank(1, S.tp[1])];
        bot.reset();
    }
    function emit(ev) {
        ev.id = ++evId;
        S.events.push(ev);
        if (S.events.length > 30) S.events.shift();
        fx(ev);
    }

    function hostAction(i, k) {
        if (!S || S.ph !== 'battle') return;
        const t = S.tanks[i], T = TANKS[t.type];
        if (t.hp <= 0) return;
        if (k === 'd') {
            if (t.dcd > 0) return;
            let dx = inputs[i].x, dy = inputs[i].y;
            const m = Math.hypot(dx, dy);
            if (m < 0.2) { dx = Math.cos(t.ba); dy = Math.sin(t.ba); } else { dx /= m; dy /= m; }
            t.dash = DASH_T; t.ddx = dx; t.ddy = dy; t.dcd = DASH_CD;
            emit({ k: 'dash', i, x: t.x, y: t.y });
        } else if (k === 's') {
            if (t.sp < 100) return;
            t.sp = 0;
            if (t.type === 'balance') { t.hp = Math.min(T.hp, t.hp + 40); t.boost = SPEC.balance; }
            else if (t.type === 'sniper') { t.arm = SPEC.sniper; t.cd = Math.min(t.cd, 6); }
            else t.fx = SPEC[t.type];
            emit({ k: 'spec', i, t: t.type, x: t.x, y: t.y });
        }
    }

    function fire(i) {
        const t = S.tanks[i], T = TANKS[t.type];
        const rail = t.arm > 0;
        if (!rail && t.w && t.ammo > 0) { fireGear(i); return; }
        t.cd = rail ? T.rl : Math.round(T.rl * (t.type === 'rapid' && t.fx > 0 ? 0.5 : 1));
        t.arm = 0;
        const c = Math.cos(t.ta), s = Math.sin(t.ta);
        const mx = t.x + c * (T.r + T.len), my = t.y + s * (T.r + T.len);
        const k = rail ? 2 : t.type === 'heavy' ? 1 : 0;
        emit({ k: 'shot', i, x: mx, y: my, a: t.ta, b: k });
        if (t.type === 'heavy') { t.x -= c * 1.6; t.y -= s * 1.6; pushOut(t, T.r, S.mp, S.cr); }
        // Muzzle inside steel (hugging a wall): the shell just sparks there.
        if (blocked(t.x, t.y, mx, my, S.mp, S.cr, false)) { emit({ k: 'spark', x: mx, y: my }); return; }
        const bs = rail ? RAIL.bs : T.bs;
        S.bl.push({ x: mx, y: my, vx: c * bs, vy: s * bs, o: i, k, life: 110, dmg: rail ? RAIL.dmg : T.dmg });
    }

    /** Machine gun / missile launcher: replaces the main gun while ammo lasts. */
    function fireGear(i) {
        const t = S.tanks[i], T = TANKS[t.type];
        const mg = t.w === 1;
        t.cd = mg ? MG.rl : MSL.rl;
        const a = t.ta + (mg ? rnd(-MG.spread, MG.spread) : 0);
        const c = Math.cos(a), s = Math.sin(a);
        const mx = t.x + c * (T.r + T.len), my = t.y + s * (T.r + T.len);
        const k = mg ? 3 : 4;
        if (--t.ammo <= 0) { t.w = 0; t.ammo = 0; }
        emit({ k: 'shot', i, x: mx, y: my, a, b: k });
        if (blocked(t.x, t.y, mx, my, S.mp, S.cr, false)) { emit({ k: 'spark', x: mx, y: my }); return; }
        const bs = mg ? MG.bs : MSL.bs0;
        S.bl.push({ x: mx, y: my, vx: c * bs, vy: s * bs, o: i, k, life: mg ? 70 : MSL.life, dmg: mg ? MG.dmg : MSL.dmg });
    }

    // ---------------- loot ----------------
    function freeSpot(x, y, pad) {
        if (x < WALL + pad || y < WALL + pad || x > W - WALL - pad || y > H - WALL - pad) return false;
        for (const r of MAP_RECTS[S.mp]) {
            if (r.k === 'c' && !(S.cr[r.ci] > 0)) continue;
            const nx = clamp(x, r.x, r.x + r.w), ny = clamp(y, r.y, r.y + r.h);
            if (Math.hypot(x - nx, y - ny) < pad) return false;
        }
        return true;
    }
    function rollItem(exclude) {
        let tot = 0;
        for (const k of ITEM_KEYS) if (k !== exclude) tot += ITEMS[k].w;
        let r = Math.random() * tot;
        for (const k of ITEM_KEYS) { if (k === exclude) continue; r -= ITEMS[k].w; if (r <= 0) return k; }
        return 'hp';
    }
    function addItem(k, x, y) {
        const it = { id: ++S.itId, k, x, y, life: ITEM_LIFE };
        S.it.push(it);
        emit({ k: 'drop', x, y });
        return it;
    }
    /** Fair drop: the same item at a spot and at its 180° twin. */
    function spawnLoot() {
        if (S.it.length > ITEM_MAX - 2) return;
        const lim = S.zr < ZONE_MAX ? S.zr * 0.8 : 1e9;
        for (let tries = 0; tries < 40; tries++) {
            const x = rnd(60, W - 60), y = rnd(60, H - 60), mx = W - x, my = H - y;
            if (!freeSpot(x, y, 20) || !freeSpot(mx, my, 20)) continue;
            if (Math.hypot(x - CX, y - CY) > lim) continue;
            if (Math.hypot(x - mx, y - my) < 50) continue;
            if (S.tanks.some((t) => Math.hypot(t.x - x, t.y - y) < 90 || Math.hypot(t.x - mx, t.y - my) < 90)) continue;
            if (S.it.some((q) => Math.hypot(q.x - x, q.y - y) < 60 || Math.hypot(q.x - mx, q.y - my) < 60)) continue;
            const k = rollItem();
            addItem(k, x, y); addItem(k, mx, my);
            return;
        }
    }
    /** Hand item `k` to tank `i`. Returns the item actually granted (🎁 rolls another). */
    function giveItem(i, k) {
        const t = S.tanks[i], T = TANKS[t.type];
        if (k === 'box') k = rollItem('box');
        switch (k) {
            case 'hp': t.hp = Math.min(T.hp, t.hp + 35); break;
            case 'en': t.sp = Math.min(100, t.sp + 50); break;
            case 'nitro': t.boost = Math.max(t.boost, NITRO_T); break;
            case 'star': t.pw = POWER_T; break;
            case 'mg': t.ammo = t.w === 1 ? Math.min(MG.max, t.ammo + MG.ammo) : MG.ammo; t.w = 1; break;
            case 'ms': t.ammo = t.w === 2 ? Math.min(MSL.max, t.ammo + MSL.ammo) : MSL.ammo; t.w = 2; break;
            case 'dr': {
                const mine = S.dr.filter((d) => d.o === i);
                if (mine.length >= DRONE.max) { mine.forEach((d) => { d.life = DRONE.life; d.hp = DRONE.hp; }); break; }
                const a = mine.length ? mine[0].a + Math.PI : rnd(0, Math.PI * 2);
                S.dr.push({ o: i, a, x: t.x + Math.cos(a) * DRONE.orbit, y: t.y + Math.sin(a) * DRONE.orbit, hp: DRONE.hp, life: DRONE.life, cd: 30 });
                break;
            }
            case 'sh': t.sh = SHIELD_HP; t.shT = GEAR_T; break;
            case 'ip': t.ip = GEAR_T; break;
            case 'ar': t.ap = GEAR_T; break;
        }
        return k;
    }
    function stepLoot() {
        if (--S.itT <= 0) { spawnLoot(); S.itT = Math.round(rnd(ITEM_GAP[0], ITEM_GAP[1])); }
        for (const it of S.it) {
            if (--it.life <= 0) { it.dead = true; continue; }
            for (let i = 0; i < 2; i++) {
                const t = S.tanks[i];
                if (t.hp <= 0 || Math.hypot(t.x - it.x, t.y - it.y) > TANKS[t.type].r + 14) continue;
                const got = giveItem(i, it.k);
                emit({ k: 'pick', i, x: it.x, y: it.y, it: it.k, got });
                it.dead = true; break;
            }
        }
        S.it = S.it.filter((q) => !q.dead);
    }
    function stepDrones() {
        for (const d of S.dr) {
            const t = S.tanks[d.o], foe = S.tanks[1 - d.o];
            if (t.hp <= 0 || --d.life <= 0 || d.hp <= 0) { d.dead = true; emit({ k: 'dkill', x: d.x, y: d.y }); continue; }
            d.a += 0.035;
            d.x = t.x + Math.cos(d.a) * DRONE.orbit; d.y = t.y + Math.sin(d.a) * DRONE.orbit;
            if (--d.cd > 0 || foe.hp <= 0) continue;
            const dx = foe.x - d.x, dy = foe.y - d.y, dist = Math.hypot(dx, dy);
            if (dist > DRONE.range || blocked(d.x, d.y, foe.x, foe.y, S.mp, S.cr, false)) continue;
            const lead = dist / DRONE.bs * 0.5;
            const ax = dx + foe.vx * lead, ay = dy + foe.vy * lead, am = Math.hypot(ax, ay) || 1;
            d.cd = DRONE.rl;
            emit({ k: 'shot', i: d.o, x: d.x, y: d.y, a: Math.atan2(ay, ax), b: 5 });
            S.bl.push({ x: d.x, y: d.y, vx: ax / am * DRONE.bs, vy: ay / am * DRONE.bs, o: d.o, k: 5, life: 60, dmg: DRONE.dmg });
        }
        S.dr = S.dr.filter((d) => !d.dead);
    }
    /** Interceptor: zaps the nearest enemy missile or drone in range. */
    function stepInterceptor(i) {
        const t = S.tanks[i];
        if (t.ip <= 0 || t.hp <= 0) return;
        if (t.ipCd > 0) { t.ipCd--; return; }
        let best = null, bd = IP.range;
        for (const b of S.bl) if (b.o !== i && b.k === 4 && !b.dead) { const d = Math.hypot(b.x - t.x, b.y - t.y); if (d < bd) { bd = d; best = b; } }
        for (const d of S.dr) if (d.o !== i) { const q = Math.hypot(d.x - t.x, d.y - t.y); if (q < bd) { bd = q; best = d; } }
        if (!best) return;
        t.ipCd = IP.cd;
        emit({ k: 'zap', i, x: t.x, y: t.y, x2: best.x, y2: best.y });
        if (best.k === 4) { best.dead = true; emit({ k: 'spark', x: best.x, y: best.y }); }
        else best.hp -= IP.droneDmg;
    }

    /** Damage tank `i` from attacker `o` (never called with i === o). */
    function hurt(i, o, amount, x, y) {
        const t = S.tanks[i];
        if (t.hp <= 0 || i === o) return;
        let d = amount;
        if (o >= 0 && S.tanks[o].pw > 0) d *= POWER_MUL;
        if (o >= 0 && ADV[S.tanks[o].type] === t.type) d *= ADV_MUL;
        if (t.type === 'heavy' && t.fx > 0) d *= 0.3;
        d = Math.max(1, Math.round(d));
        if (t.ap > 0) d = Math.max(1, d - PLATE);                    // armour plates: flat cut per hit
        if (t.sh > 0) {                                                // energy shield soaks first
            const soak = Math.min(t.sh, d);
            t.sh -= soak; d -= soak;
            if (t.sh <= 0) t.shT = 0;
            if (d <= 0) { emit({ k: 'block', i, x, y, d: soak }); return; }
        }
        t.hp = Math.max(0, t.hp - d);
        t.hitT = 10;
        t.sp = Math.min(100, t.sp + d * 0.45);
        if (o >= 0) S.tanks[o].sp = Math.min(100, S.tanks[o].sp + d * 0.7);
        emit({ k: 'hit', i, x, y, d, big: d >= 25 ? 1 : 0 });
    }
    function hurtCrate(ci, d, x, y) {
        if (!(S.cr[ci] > 0)) return;
        S.cr[ci] = Math.max(0, S.cr[ci] - d);
        if (S.cr[ci] === 0) {
            const r = MAP_RECTS[S.mp].find((q) => q.ci === ci);
            emit({ k: 'crate', x: r.x + r.w / 2, y: r.y + r.h / 2 });
            if (Math.random() < CRATE_DROP && S.it.length < ITEM_MAX) addItem(rollItem(), r.x + r.w / 2, r.y + r.h / 2);
        }
    }
    /** Shell from owner b.o bursts at (x, y). Splash (heavy) only ever reaches the *other* tank. */
    function impact(b, x, y, direct) {
        const R = SPLASH[b.k] || 0;
        emit({ k: R ? 'blast' : 'spark', x, y });
        if (!R) return;
        const foe = 1 - b.o, t = S.tanks[foe];
        if (direct !== foe) {
            const d = Math.hypot(t.x - x, t.y - y) - TANKS[t.type].r;
            if (d < R) hurt(foe, b.o, b.dmg * 0.5 * (1 - Math.max(0, d) / R * 0.6), t.x, t.y);
        }
        for (const r of MAP_RECTS[S.mp]) {
            if (r.k !== 'c' || !(S.cr[r.ci] > 0)) continue;
            const nx = clamp(x, r.x, r.x + r.w), ny = clamp(y, r.y, r.y + r.h);
            if (Math.hypot(nx - x, ny - y) < R) hurtCrate(r.ci, b.dmg * 0.6, nx, ny);
        }
    }

    function stepBullets() {
        const rs = MAP_RECTS[S.mp];
        for (const b of S.bl) {
            if (b.dead) continue;
            if (b.k === 4) {                       // missile: accelerate + home on the rival
                const foe = S.tanks[1 - b.o];
                let a = Math.atan2(b.vy, b.vx);
                const v = Math.min(MSL.bs1, Math.hypot(b.vx, b.vy) + MSL.acc);
                if (foe.hp > 0) a += clamp(angDiff(a, Math.atan2(foe.y - b.y, foe.x - b.x)), -MSL.turn, MSL.turn);
                b.vx = Math.cos(a) * v; b.vy = Math.sin(a) * v;
            }
            const sp = Math.hypot(b.vx, b.vy), n = Math.ceil(sp / 6);
            for (let s = 0; s < n && !b.dead; s++) {
                b.x += b.vx / n; b.y += b.vy / n;
                for (let i = 0; i < 2; i++) {
                    if (i === b.o) continue;              // ← own shells never hit their owner
                    const t = S.tanks[i];
                    if (t.hp <= 0) continue;
                    if (Math.hypot(t.x - b.x, t.y - b.y) < TANKS[t.type].r + 3) {
                        hurt(i, b.o, b.dmg, b.x, b.y);
                        impact(b, b.x, b.y, i);
                        b.dead = true; break;
                    }
                }
                if (b.dead) break;
                for (const d of S.dr) {                   // enemy drones can be shot down
                    if (d.o === b.o || d.hp <= 0) continue;
                    if (Math.hypot(d.x - b.x, d.y - b.y) < 11) {
                        d.hp -= b.k === 2 ? 999 : b.dmg;
                        emit({ k: 'spark', x: b.x, y: b.y });
                        if (b.k !== 2) { b.dead = true; break; }
                    }
                }
                if (b.dead) break;
                const ri = rectAt(b.x, b.y, S.mp, S.cr);
                if (ri === -2) { impact(b, clamp(b.x, WALL, W - WALL), clamp(b.y, WALL, H - WALL), -1); b.dead = true; }
                else if (ri >= 0) {
                    const r = rs[ri];
                    if (r.k === 'c') {
                        if (b.k === 2) { hurtCrate(r.ci, 999, b.x, b.y); continue; }   // railgun pierces crates
                        hurtCrate(r.ci, b.dmg, b.x, b.y);
                    }
                    impact(b, b.x, b.y, -1);
                    b.dead = true;
                }
            }
            if (!b.dead && --b.life <= 0) b.dead = true;
        }
        // opposing shells cancel each other (a railgun shot wins)
        for (let a = 0; a < S.bl.length; a++) {
            const A = S.bl[a];
            if (A.dead) continue;
            for (let c = a + 1; c < S.bl.length; c++) {
                const B = S.bl[c];
                if (B.dead || B.o === A.o) continue;
                if (Math.hypot(A.x - B.x, A.y - B.y) < 8 + (A.k === 1 || B.k === 1 || A.k === 4 || B.k === 4 ? 4 : 0)) {
                    if (A.k !== 2) A.dead = true;
                    if (B.k !== 2) B.dead = true;
                    emit({ k: 'spark', x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
                    if (A.dead) break;
                }
            }
        }
        S.bl = S.bl.filter((b) => !b.dead);
    }

    function stepTank(i) {
        const t = S.tanks[i], T = TANKS[t.type], inp = inputs[i], foe = S.tanks[1 - i];
        if (t.hitT > 0) t.hitT--;
        if (t.hp <= 0) { t.vx = t.vy = 0; return; }
        const battle = S.ph === 'battle';
        if (battle) {
            if (t.dcd > 0) t.dcd--;
            if (t.fx > 0) t.fx--;
            if (t.boost > 0) t.boost--;
            if (t.arm > 0) t.arm--;
            if (t.cd > 0) t.cd--;
            if (t.pw > 0) t.pw--;
            if (t.ap > 0) t.ap--;
            if (t.ip > 0) t.ip--;
            if (t.shT > 0 && --t.shT <= 0) t.sh = 0;
            t.sp = Math.min(100, t.sp + SP_RATE);
            let spd = T.spd * (t.type === 'rapid' && t.fx > 0 ? 1.15 : 1) * (t.boost > 0 ? 1.25 : 1);
            let vx, vy;
            if (t.dash > 0) { t.dash--; vx = t.ddx * spd * DASH_MUL; vy = t.ddy * spd * DASH_MUL; }
            else { vx = inp.x * spd; vy = inp.y * spd; }
            const ox = t.x, oy = t.y;
            t.x += vx; t.y += vy;
            pushOut(t, T.r, S.mp, S.cr);
            // tank vs tank: just push apart (no ramming damage)
            const fr = TANKS[foe.type].r;
            if (foe.hp > 0) {
                const dx = t.x - foe.x, dy = t.y - foe.y, d = Math.hypot(dx, dy) || 1, min = T.r + fr;
                if (d < min) { t.x += dx / d * (min - d); t.y += dy / d * (min - d); pushOut(t, T.r, S.mp, S.cr); }
            }
            t.vx = t.x - ox; t.vy = t.y - oy;
            if (Math.hypot(vx, vy) > 0.3) t.ba += clamp(angDiff(t.ba, Math.atan2(vy, vx)), -0.2, 0.2);
        } else { t.vx = t.vy = 0; }
        // turret: free aim (mouse) or auto-track the rival
        const ta = inp.ax !== null && inp.ax !== undefined ? Math.atan2(inp.ay, inp.ax) : Math.atan2(foe.y - t.y, foe.x - t.x);
        t.ta += clamp(angDiff(t.ta, ta), -T.turn, T.turn);
        if (battle && inp.f && t.cd <= 0) fire(i);
    }

    function hostTick() {
        if (!S) return;
        frame++;
        inputs[0] = inputOverride || localInput();
        if (GameBot.enabled) botStep();
        S.pt++;
        if (S.ph === 'ready') {
            stepTank(0); stepTank(1);
            if (S.pt >= READY_T) { S.ph = 'battle'; S.pt = 0; emit({ k: 'go' }); }
        } else if (S.ph === 'battle') {
            S.bt++;
            stepTank(0); stepTank(1);
            stepDrones();
            stepInterceptor(0); stepInterceptor(1);
            stepBullets();
            stepLoot();
            if (S.bt > ZONE_START) {
                S.zr = ZONE_MAX - (ZONE_MAX - ZONE_MIN) * Math.min(1, (S.bt - ZONE_START) / ZONE_T);
                if (S.bt === ZONE_START + 1) emit({ k: 'zone' });
                for (const t of S.tanks) {
                    if (t.hp > 0 && Math.hypot(t.x - CX, t.y - CY) > S.zr) { t.hp = Math.max(0, t.hp - ZONE_DMG); if (frame % 12 === 0) t.hitT = 6; }
                }
            }
            const dead = S.tanks.map((t) => t.hp <= 0);
            if (dead[0] || dead[1]) {
                const w = dead[0] && dead[1] ? -1 : dead[0] ? 1 : 0;
                if (w >= 0) S.sc[w]++;
                S.fin = { w };
                S.tanks.forEach((t, i) => { if (dead[i]) emit({ k: 'ko', i, x: t.x, y: t.y }); });
                S.ph = 'finish'; S.pt = 0;
                updateScoreDom(S.sc);
            }
        } else if (S.ph === 'finish') {
            stepBullets();
            if (S.pt >= FINISH_T) {
                if (S.sc[0] >= WIN_SCORE || S.sc[1] >= WIN_SCORE) {
                    S.ph = 'gameover';
                    broadcast();
                    showGameOver(S.sc);
                    return;
                }
                startRound();
            }
        }
        if (frame % 2 === 0) broadcast();
    }

    const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
    function broadcast() {
        if (!S) return;
        session.send({
            type: 'state', ph: S.ph, pt: S.pt, rd: S.rd, sc: S.sc, tp: S.tp, mp: S.mp, cr: S.cr.map(Math.round), zr: Math.round(S.zr), fin: S.fin,
            tk: S.tanks.map((t) => [r1(t.x), r1(t.y), r2(t.ba), r2(t.ta), Math.ceil(t.hp), Math.floor(t.sp), t.dash, t.dcd, t.cd, t.fx, t.arm, t.hitT, r2(t.vx), r2(t.vy), t.boost, t.w, t.ammo, t.shT, t.sh, t.ip, t.ap, t.pw]),
            it: S.it.map((q) => [Math.round(q.x), Math.round(q.y), ITEM_KEYS.indexOf(q.k), q.life]),
            dr: S.dr.map((d) => [r1(d.x), r1(d.y), d.o, d.hp, r2(d.a)]),
            bl: S.bl.map((b) => [r1(b.x), r1(b.y), r2(b.vx), r2(b.vy), b.o, b.k]),
            ev: S.events
        });
    }

    // ==========================================================
    // Bot (?bot=easy|normal|hard) — plays the client side (index 1)
    // ==========================================================
    const BOT = {
        react: GameBot.pick({ easy: 16, normal: 9, hard: 4 }),
        dodge: GameBot.pick({ easy: 0.2, normal: 0.6, hard: 0.95 }),
        fireGap: GameBot.pick({ easy: 0.5, normal: 0.2, hard: 0 }),
        lead: GameBot.pick({ easy: 0, normal: 0.35, hard: 0.75 }),
        dashP: GameBot.pick({ easy: 0.05, normal: 0.35, hard: 0.7 }),
        specDelay: GameBot.pick({ easy: 150, normal: 60, hard: 10 }),
        counter: GameBot.pick({ easy: 0, normal: 0.3, hard: 0.6 }),
        loot: GameBot.pick({ easy: 110, normal: 220, hard: 330 })
    };
    const WANT = { rapid: 160, heavy: 150, sniper: 330, balance: 220 };
    const bot = {
        t: 0, dir: { x: 0, y: 0 }, fire: false, aim: null, d: 0, s: 0, strafe: 1, strafeT: 0, stuck: 0, unstick: 0, ux: 0, uy: 0, specWait: 0, frozen: false,
        reset() { this.t = 0; this.dir = { x: 0, y: 0 }; this.fire = false; this.aim = null; this.stuck = 0; this.unstick = 0; this.specWait = 0; }
    };
    function botPickType() {
        if (Math.random() < BOT.counter) {
            const c = TYPES.find((k) => ADV[k] === picks[0]);
            if (c) return c;
        }
        return TYPES[Math.floor(Math.random() * TYPES.length)];
    }
    /** Frames-ahead danger of standing at (x, y) moving (vx, vy): min distance to an enemy shell. */
    function danger(me, r, vx, vy) {
        let worst = 0;
        for (const b of S.bl) {
            if (b.o === 1) continue;
            for (let f = 0; f <= 36; f += 4) {
                const d = Math.hypot(b.x + b.vx * f - (me.x + vx * f), b.y + b.vy * f - (me.y + vy * f));
                if (d < r + 10) { worst = Math.max(worst, 1 - f / 40); break; }
            }
        }
        return worst;
    }
    // Grid distance field (20 px cells) so the bot can route around cover.
    const CELL = 20, GN = W / CELL;
    function flowField(gx, gy, r) {
        const free = new Uint8Array(GN * GN), dist = new Float32Array(GN * GN).fill(1e9);
        const rs = MAP_RECTS[S.mp];
        for (let cy = 0; cy < GN; cy++) for (let cx = 0; cx < GN; cx++) {
            const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
            let ok = x > WALL + r && y > WALL + r && x < W - WALL - r && y < H - WALL - r;
            for (let i = 0; ok && i < rs.length; i++) {
                const q = rs[i];
                if (q.k === 'c' && !(S.cr[q.ci] > 0)) continue;
                const nx = clamp(x, q.x, q.x + q.w), ny = clamp(y, q.y, q.y + q.h);
                if (Math.hypot(x - nx, y - ny) < r + 1) ok = false;
            }
            free[cy * GN + cx] = ok ? 1 : 0;
        }
        let sx = clamp(Math.floor(gx / CELL), 0, GN - 1), sy = clamp(Math.floor(gy / CELL), 0, GN - 1);
        if (!free[sy * GN + sx]) {      // goal inside cover: nearest free cell
            let best = -1, bd = 1e9;
            for (let i = 0; i < free.length; i++) if (free[i]) { const d = Math.hypot(i % GN - sx, Math.floor(i / GN) - sy); if (d < bd) { bd = d; best = i; } }
            if (best < 0) return null;
            sx = best % GN; sy = Math.floor(best / GN);
        }
        const q = [sy * GN + sx]; dist[q[0]] = 0;
        for (let h = 0; h < q.length; h++) {
            const c = q[h], cx = c % GN, cy = Math.floor(c / GN);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= GN || ny >= GN) continue;
                const n = ny * GN + nx;
                if (!free[n]) continue;
                if (dx && dy && (!free[cy * GN + nx] || !free[ny * GN + cx])) continue;   // no corner cutting
                const nd = dist[c] + (dx && dy ? 1.414 : 1);
                if (nd < dist[n]) { dist[n] = nd; q.push(n); }
            }
        }
        return (x, y) => {
            const cx = clamp(Math.floor(x / CELL), 0, GN - 1), cy = clamp(Math.floor(y / CELL), 0, GN - 1);
            const v = dist[cy * GN + cx];
            return v >= 1e9 ? null : v * CELL;
        };
    }
    function botDecide() {
        const me = S.tanks[1], foe = S.tanks[0], T = TANKS[me.type];
        const dx = foe.x - me.x, dy = foe.y - me.y, dist = Math.hypot(dx, dy);
        const losSteel = !blocked(me.x, me.y, foe.x, foe.y, S.mp, S.cr, false);
        const los = losSteel && !blocked(me.x, me.y, foe.x, foe.y, S.mp, S.cr, true);
        if (--bot.strafeT <= 0) { bot.strafe = -bot.strafe; bot.strafeT = Math.round(rnd(40, 110) / BOT.react * 4); }
        // goal point
        let gx, gy;
        const want = WANT[me.type] * (me.hp < T.hp * 0.35 && me.type !== 'heavy' ? 1.3 : 1);
        if (los) {
            const a = Math.atan2(me.y - foe.y, me.x - foe.x) + bot.strafe * 0.6;
            gx = foe.x + Math.cos(a) * want; gy = foe.y + Math.sin(a) * want;
        } else { gx = foe.x; gy = foe.y; }
        // loot: grab items we reach first (repair kits matter more when hurt)
        let lootBest = null, lootScore = 0;
        for (const it of S.it) {
            const dm = Math.hypot(it.x - me.x, it.y - me.y), df = Math.hypot(it.x - foe.x, it.y - foe.y);
            const want2 = it.k === 'hp' ? (me.hp < T.hp * 0.7 ? 1.6 : 0.4) : 1;
            if (dm > BOT.loot * want2 || dm > df + 40) continue;
            const sc = want2 / (dm + 30);
            if (sc > lootScore) { lootScore = sc; lootBest = it; }
        }
        if (lootBest) { gx = lootBest.x; gy = lootBest.y; }
        if (S.zr < ZONE_MAX) {                // stay inside the ring
            const zd = Math.hypot(gx - CX, gy - CY), lim = S.zr * 0.7;
            if (zd > lim) { gx = CX + (gx - CX) / zd * lim; gy = CY + (gy - CY) / zd * lim; }
        }
        const field = flowField(gx, gy, T.r);
        const here = field ? field(me.x, me.y) : null;
        const careful = Math.random() < BOT.dodge;
        let best = null, bestS = -Infinity, bestDanger = 0;
        if (bot.unstick > 0) { bot.unstick--; best = { x: bot.ux, y: bot.uy }; }
        else {
            for (let k = 0; k <= 16; k++) {
                const a = k * Math.PI / 8, m = k === 16 ? 0 : 1;
                const vx = Math.cos(a) * m, vy = Math.sin(a) * m;
                const px = me.x + vx * 34, py = me.y + vy * 34;
                const p2x = me.x + vx * T.r * 1.4, p2y = me.y + vy * T.r * 1.4;
                const fd = field ? field(px, py) : null;
                let sc = fd !== null && here !== null ? -(fd - here) / 12 - fd / 4000 : -Math.hypot(gx - px, gy - py) / 40;
                if (m && (rectAt(p2x, p2y, S.mp, S.cr) !== -1 || rectAt(px, py, S.mp, S.cr) !== -1)) sc -= 3;
                sc += (vx * bot.dir.x + vy * bot.dir.y) * 0.25;            // keep course
                const dg = careful ? danger(me, T.r, vx * T.spd, vy * T.spd) : 0;
                sc -= dg * 8;
                if (sc > bestS) { bestS = sc; best = { x: vx, y: vy }; bestDanger = dg; }
            }
        }
        bot.dir = best;
        // stuck → wander a bit
        if (Math.hypot(me.vx, me.vy) < 0.25 && Math.hypot(best.x, best.y) > 0.5) {
            if (++bot.stuck > 4) { const a = rnd(0, Math.PI * 2); bot.ux = Math.cos(a); bot.uy = Math.sin(a); bot.unstick = 3; bot.stuck = 0; }
        } else bot.stuck = 0;
        if (careful && me.dcd === 0 && danger(me, T.r, 0, 0) > 0.55 && Math.random() < BOT.dashP) bot.d++;
        // aim (with some lead) and fire
        const bs = me.arm > 0 ? RAIL.bs : me.w === 1 ? MG.bs : me.w === 2 ? MSL.bs1 : T.bs, lead = (dist / bs) * (me.w === 2 ? 0 : BOT.lead);
        const ax = foe.x + foe.vx * lead - me.x, ay = foe.y + foe.vy * lead - me.y, am = Math.hypot(ax, ay) || 1;
        bot.aim = { x: ax / am, y: ay / am };
        const aligned = Math.abs(angDiff(me.ta, Math.atan2(ay, ax))) < 0.22;
        bot.fire = losSteel && aligned && dist < (me.type === 'sniper' ? 620 : 440) && Math.random() >= BOT.fireGap;
        // special
        if (me.sp >= 100) {
            if (bot.specWait <= 0) bot.specWait = BOT.specDelay;
            else if (--bot.specWait <= 1) {
                const use = me.type === 'balance' ? me.hp < T.hp * 0.6 : (los && dist < 360) || me.type === 'heavy' && me.hp < T.hp * 0.5;
                if (use) { bot.s++; bot.specWait = 0; }
            }
        }
    }
    function botStep() {
        if (!S || bot.frozen) { GameBot.deliver({ type: 'input', x: 0, y: 0, f: 0, d: bot.d, s: bot.s }); return; }
        if (S.ph === 'battle' && --bot.t <= 0) { bot.t = BOT.react + Math.floor(Math.random() * 3); botDecide(); }
        if (S.ph !== 'battle') { bot.dir = { x: 0, y: 0 }; bot.fire = false; }
        const a = bot.aim;
        GameBot.deliver({ type: 'input', x: bot.dir.x, y: bot.dir.y, f: bot.fire ? 1 : 0, ax: a ? a.x : null, ay: a ? a.y : null, d: bot.d, s: bot.s });
    }

    // ==========================================================
    // Network
    // ==========================================================
    connectionStateText.textContent = L('conn_signal');
    let channelOpen = false;
    const session = GameBot.session({
        gameFolder: 'armor',
        dataChannelOptions: { ordered: false, maxRetransmits: 0 },
        onSignalingStatus(status) {
            if (status === 'open') {
                statusText.textContent = waitingText;
                statusText.className = 'status-online';
                connectionStateText.textContent = L('conn_open');
            } else if (status === 'closed') {
                statusText.textContent = L('st_offline');
                statusText.className = 'status-offline';
                connectionStateText.textContent = L('conn_closed');
            }
        },
        onRole(role) {
            myRole = role;
            myIdx = role === 'host' ? 0 : 1;
            roleStatusText.textContent = role.toUpperCase();
            p1Label.textContent = L(role === 'host' ? 'p1_you' : 'p1_host');
            p2Label.textContent = L(role === 'host' ? 'p2_opp' : 'p2_you');
            roleText.innerHTML = L(role === 'host' ? 'role_host' : 'role_client');
        },
        onChannelOpen() {
            channelOpen = true;
            showScreen(readyScreen);
            startBtn.classList.toggle('hidden', myRole !== 'host');
            if (GameBot.enabled) { oppPick = null; oppPickEl.textContent = '🤖 ' + GameBot.t('bot'); }
            else refreshPicker();
            syncPick();
        },
        onPeerConnected() { statusText.textContent = L('st_p2p'); statusText.className = 'status-online'; },
        onPeerReconnecting() { statusText.textContent = L('st_reconnect'); statusText.className = 'status-offline'; },
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

    function syncPick() { if (myRole === 'host') picks[0] = myPick; session.send({ type: 'pick', t: myPick }); }
    let awaitingRestart = false;
    setInterval(() => {
        if (!channelOpen) return;
        if (!inMatch()) syncPick();
        if (myRole === 'host' && S && S.ph === 'gameover') broadcast();
        if (awaitingRestart) session.send({ type: 'restart-request' });
    }, 600);

    function sendInput() {
        if (myRole !== 'client') return;
        const i = localInput();
        session.send({ type: 'input', x: r2(i.x), y: r2(i.y), f: i.f ? 1 : 0, ax: i.ax === null ? null : r2(i.ax), ay: i.ay === null ? null : r2(i.ay), d: dSeq, s: sSeq });
    }
    setInterval(() => { if (channelOpen && myRole === 'client') sendInput(); }, 1000 / 30);

    const num = (v) => typeof v === 'number' && isFinite(v);
    function handleMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'pick') {
            if (!TYPES.includes(msg.t)) return;
            if (myRole === 'host') picks[1] = msg.t;
            if (!GameBot.enabled && oppPick !== msg.t) { oppPick = msg.t; refreshPicker(); }
        } else if (msg.type === 'input') {
            if (myRole !== 'host') return;
            const inp = { x: 0, y: 0, f: !!msg.f, ax: null, ay: null };
            if (num(msg.x) && num(msg.y)) {
                const m = Math.hypot(msg.x, msg.y);
                inp.x = m > 1 ? msg.x / m : msg.x; inp.y = m > 1 ? msg.y / m : msg.y;
            }
            if (num(msg.ax) && num(msg.ay) && Math.hypot(msg.ax, msg.ay) > 0.01) { inp.ax = msg.ax; inp.ay = msg.ay; }
            inputs[1] = inp;
            const ls = lastSeq[1];
            for (const k of ['d', 's']) {
                const v = msg[k];
                if (!num(v)) continue;
                if (ls[k] === null) { ls[k] = v; continue; }
                if (v > ls[k]) { ls[k] = v; hostAction(1, k); }
            }
        } else if (msg.type === 'state') {
            if (myRole !== 'client') return;
            if (!net || net.rd !== msg.rd) disp[0] = disp[1] = null;
            net = msg;
            netAt = performance.now();
            for (const ev of msg.ev || []) if (ev.id > lastEvId) { lastEvId = ev.id; fx(ev); }
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
    let lastEvId = 0, gameoverShown = false;

    // ==========================================================
    // Lifecycle / overlay
    // ==========================================================
    function showScreen(el) {
        overlay.classList.remove('hidden');
        [lobbyScreen, readyScreen, gameoverScreen, disconnectScreen].forEach((s) => s.classList.toggle('hidden', s !== el));
        if (el === readyScreen) readyScreen.insertBefore(pickerSlot, startBtn);
        if (el === gameoverScreen) pickerSlot2.appendChild(pickerSlot);
    }
    function hideOverlay() { overlay.classList.add('hidden'); restartBtn.disabled = false; restartBtn.textContent = L('rematch'); }
    function inMatch() { const d = D(); return !!d && d.ph !== 'gameover' && overlay.classList.contains('hidden'); }
    function updateScoreDom(sc) { p1ScoreVal.textContent = sc[0]; p2ScoreVal.textContent = sc[1]; }
    function showGameOver(sc) {
        gameoverShown = true;
        if (myRole === 'host') clearInterval(hostLoop);
        showScreen(gameoverScreen);
        finalScore.textContent = `${sc[0]} - ${sc[1]}`;
        const iWon = sc[myIdx] > sc[1 - myIdx];
        winLossTitle.textContent = iWon ? 'VICTORY!' : 'DEFEAT';
        winLossTitle.className = iWon ? 'neon-text' : 'danger-text';
        if (iWon) Sfx.win();
        touchFire = false; mouseAim = null;
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
            restartBtn.textContent = L('awaiting');
            restartBtn.disabled = true;
        }
    });

    // ==========================================================
    // Draw-state accessors (host: live state, client: smoothed net state)
    // ==========================================================
    const disp = [null, null];
    function D() { return myRole === 'host' ? S : net; }
    function since() { return net ? Math.min(6, (performance.now() - netAt) / (1000 / 60)) : 0; }
    function drawTanks() {
        if (myRole === 'host') return S && S.tanks ? S.tanks : [];
        if (!net) return [];
        const k = since();
        return net.tk.map((a, i) => {
            const tx = a[0] + a[12] * k, ty = a[1] + a[13] * k;
            let p = disp[i];
            if (!p || Math.hypot(p.x - tx, p.y - ty) > 60) p = disp[i] = { x: tx, y: ty, ba: a[2], ta: a[3] };
            else {
                p.x += (tx - p.x) * 0.45; p.y += (ty - p.y) * 0.45;
                p.ba += angDiff(p.ba, a[2]) * 0.45; p.ta += angDiff(p.ta, a[3]) * 0.45;
            }
            return { type: net.tp[i], x: p.x, y: p.y, ba: p.ba, ta: p.ta, hp: a[4], sp: a[5], dash: a[6], dcd: a[7], cd: a[8], fx: a[9], arm: a[10], hitT: a[11], vx: a[12], vy: a[13], boost: a[14], w: a[15], ammo: a[16], shT: a[17], sh: a[18], ip: a[19], ap: a[20], pw: a[21] };
        });
    }
    function drawItems() {
        if (myRole === 'host') return S ? S.it : [];
        return net && net.it ? net.it.map((q) => ({ x: q[0], y: q[1], k: ITEM_KEYS[q[2]], life: q[3] })) : [];
    }
    function drawDrones() {
        if (myRole === 'host') return S ? S.dr : [];
        return net && net.dr ? net.dr.map((d) => ({ x: d[0], y: d[1], o: d[2], hp: d[3], a: d[4] })) : [];
    }
    function drawBullets() {
        if (myRole === 'host') return S ? S.bl : [];
        if (!net) return [];
        const k = Math.min(3, since());
        return net.bl.map((b) => ({ x: b[0] + b[2] * k, y: b[1] + b[3] * k, vx: b[2], vy: b[3], o: b[4], k: b[5] }));
    }

    // ==========================================================
    // Effects (both sides; canonical coordinates)
    // ==========================================================
    const parts = [], floats = [], smoke = [], zaps = [];
    let shake = 0, flash = 0, lastBeep = -1;
    const treadOdo = [0, 0];
    function burst(x, y, n, col, sp, life, size) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = Math.random() * sp;
            parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, col, size: size || 2.5 });
        }
    }
    function fx(ev) {
        switch (ev.k) {
            case 'shot': {
                const mine = ev.i === myIdx;
                Sfx.shot(ev.b, mine);
                if (ev.b === 5) break;
                burst(ev.x, ev.y, ev.b === 1 || ev.b === 4 ? 10 : ev.b === 3 ? 2 : 5, ev.b === 2 ? '#d7b8ff' : '#ffd38a', ev.b === 1 ? 3 : 2, 12, 2);
                if (ev.b === 1 || ev.b === 2 || ev.b === 4) shake = Math.max(shake, mine ? 5 : 2);
                break;
            }
            case 'spark': Sfx.spark(); burst(ev.x, ev.y, 6, '#ffe7a0', 2.4, 14, 2); break;
            case 'blast':
                Sfx.boom();
                burst(ev.x, ev.y, 22, '#ffb347', 4, 26, 3.5);
                smoke.push({ x: ev.x, y: ev.y, r: 10, life: 40, max: 40 });
                shake = Math.max(shake, 6);
                break;
            case 'hit':
                Sfx.hit(ev.big);
                burst(ev.x, ev.y, ev.big ? 16 : 8, ev.i === myIdx ? '#ff6b6b' : '#ffffff', 3.2, 18, 2.5);
                floats.push({ x: ev.x, y: ev.y, txt: '-' + ev.d, col: ev.i === myIdx ? '#ff7b7b' : '#ffe14d', life: 50, big: ev.big });
                if (ev.i === myIdx) { shake = Math.max(shake, ev.big ? 9 : 4); flash = Math.max(flash, ev.big ? 0.35 : 0.18); }
                break;
            case 'crate':
                Sfx.crate();
                burst(ev.x, ev.y, 18, '#c98a4a', 3.4, 30, 3.5);
                break;
            case 'dash': Sfx.dash(); burst(ev.x, ev.y, 10, '#cfe8ff', 2, 16, 2); break;
            case 'spec':
                Sfx.special();
                burst(ev.x, ev.y, 26, TANKS[ev.t].col, 4, 30, 3);
                floats.push({ x: ev.x, y: ev.y - 10, txt: L('s_' + ev.t).split(/[：:]/)[0], col: TANKS[ev.t].col, life: 70, big: 1 });
                break;
            case 'ko':
                Sfx.boom();
                burst(ev.x, ev.y, 46, '#ff8a1f', 6, 44, 4);
                burst(ev.x, ev.y, 20, '#ffffff', 4, 30, 2);
                for (let i = 0; i < 4; i++) smoke.push({ x: ev.x + rnd(-14, 14), y: ev.y + rnd(-14, 14), r: 14, life: 70, max: 70 });
                shake = Math.max(shake, 14);
                break;
            case 'go': Sfx.beep(true); break;
            case 'drop': burst(ev.x, ev.y, 10, '#fff6c0', 2, 22, 2); break;
            case 'pick': {
                const I = ITEMS[ev.got] || ITEMS[ev.it];
                Sfx.pick(ev.i === myIdx);
                burst(ev.x, ev.y, 16, I.col, 3, 26, 2.5);
                const txt = (ev.it === 'box' ? '🎁→' : '') + I.icon + ' ' + L('it_' + ev.got);
                floats.push({ x: ev.x, y: ev.y, txt, col: ev.i === myIdx ? I.col : '#cfd3ff', life: 70, big: ev.i === myIdx ? 1 : 0 });
                break;
            }
            case 'zap':
                Sfx.zap();
                zaps.push({ x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, life: 10 });
                break;
            case 'block':
                Sfx.block();
                burst(ev.x, ev.y, 8, '#5ad7ff', 2.4, 16, 2);
                floats.push({ x: ev.x, y: ev.y, txt: '💠' + ev.d, col: '#5ad7ff', life: 40 });
                break;
            case 'dkill':
                Sfx.crate();
                burst(ev.x, ev.y, 14, '#8fe3ff', 3, 24, 2.5);
                break;
            case 'zone': floats.push({ x: CX, y: CY, txt: L('zone_warn'), col: '#ff6b6b', life: 110, big: 1, hud: 1 }); break;
        }
    }

    // ==========================================================
    // Rendering
    // ==========================================================
    const floorCache = new Map();
    function floor(mp) {
        let c = floorCache.get(mp);
        if (c) return c;
        c = document.createElement('canvas');
        c.width = c.height = 1280;
        const g = c.getContext('2d');
        g.scale(2, 2);
        const grd = g.createRadialGradient(CX, CY, 40, CX, CY, 460);
        grd.addColorStop(0, '#2a3324'); grd.addColorStop(1, '#151a14');
        g.fillStyle = grd; g.fillRect(0, 0, W, H);
        // dirt blotches (deterministic)
        let seed = 1234 + mp * 77;
        const rr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 70; i++) {
            g.fillStyle = `rgba(${rr() < 0.5 ? '90,80,50' : '40,60,35'},${0.08 + rr() * 0.12})`;
            g.beginPath(); g.ellipse(rr() * W, rr() * H, 8 + rr() * 30, 6 + rr() * 18, rr() * 3, 0, Math.PI * 2); g.fill();
        }
        g.strokeStyle = 'rgba(255,255,255,0.035)'; g.lineWidth = 1;
        for (let x = 0; x <= W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
        for (let y = 0; y <= H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
        // spawn pads
        START.forEach((s, i) => {
            g.strokeStyle = OWNER[i] + '55'; g.lineWidth = 2; g.setLineDash([6, 6]);
            g.beginPath(); g.arc(s.x, s.y, 30, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        });
        // border
        g.fillStyle = '#3b4250';
        g.fillRect(0, 0, W, WALL); g.fillRect(0, H - WALL, W, WALL); g.fillRect(0, 0, WALL, H); g.fillRect(W - WALL, 0, WALL, H);
        g.fillStyle = 'rgba(255,200,0,0.5)';
        for (let x = 0; x < W; x += 28) { g.fillRect(x, 6, 14, 4); g.fillRect(x + 14, H - 10, 14, 4); }
        for (let y = 0; y < H; y += 28) { g.fillRect(6, y + 14, 4, 14); g.fillRect(W - 10, y, 4, 14); }
        // steel
        for (const r of MAP_RECTS[mp]) {
            if (r.k !== 's') continue;
            g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(r.x + 4, r.y + 5, r.w, r.h);
            const lg = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
            lg.addColorStop(0, '#9aa6b8'); lg.addColorStop(1, '#5a6475');
            g.fillStyle = lg; g.fillRect(r.x, r.y, r.w, r.h);
            g.strokeStyle = '#2b313c'; g.lineWidth = 2; g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
            g.fillStyle = '#d7dee9';
            for (const [px, py] of [[4, 4], [r.w - 4, 4], [4, r.h - 4], [r.w - 4, r.h - 4]]) { g.beginPath(); g.arc(r.x + px, r.y + py, 1.8, 0, Math.PI * 2); g.fill(); }
        }
        floorCache.set(mp, c);
        return c;
    }
    function drawCrate(r, hp) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(r.x + 3, r.y + 4, r.w, r.h);
        ctx.fillStyle = '#b5773c'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = '#6e4220'; ctx.lineWidth = 3; ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
        ctx.beginPath(); ctx.moveTo(r.x + 3, r.y + 3); ctx.lineTo(r.x + r.w - 3, r.y + r.h - 3);
        ctx.moveTo(r.x + r.w - 3, r.y + 3); ctx.lineTo(r.x + 3, r.y + r.h - 3); ctx.lineWidth = 2; ctx.stroke();
        const dmg = 1 - hp / CRATE_HP;
        if (dmg > 0.3) {
            ctx.strokeStyle = 'rgba(30,15,5,0.85)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(r.x + r.w * 0.2, r.y); ctx.lineTo(r.x + r.w * 0.45, r.y + r.h * 0.5); ctx.lineTo(r.x + r.w * 0.3, r.y + r.h);
            if (dmg > 0.6) { ctx.moveTo(r.x + r.w, r.y + r.h * 0.3); ctx.lineTo(r.x + r.w * 0.55, r.y + r.h * 0.55); }
            ctx.stroke();
        }
    }
    function roundRect(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    /** Tank body + turret at the origin of g (already translated). */
    function drawTank(g, type, owner, ba, ta, odo, o) {
        const T = TANKS[type], r = T.r;
        g.save();
        g.rotate(ba);
        // treads
        const tl = r * 2.1, tw = r * 0.55;
        for (const side of [-1, 1]) {
            g.fillStyle = '#1b1d22';
            roundRect(g, -tl / 2, side * (r * 0.78) - tw / 2, tl, tw, 4); g.fill();
            g.strokeStyle = '#4a4e57'; g.lineWidth = 1.5;
            const ph = ((odo % 6) + 6) % 6;
            for (let x = -tl / 2 + ph; x < tl / 2; x += 6) { g.beginPath(); g.moveTo(x, side * r * 0.78 - tw / 2 + 1); g.lineTo(x, side * r * 0.78 + tw / 2 - 1); g.stroke(); }
        }
        // hull
        g.fillStyle = o.hit ? '#ffffff' : owner;
        roundRect(g, -r * 0.95, -r * 0.62, r * 1.9, r * 1.24, 6); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(g, -r * 0.95, r * 0.15, r * 1.9, r * 0.47, 5); g.fill();
        g.fillStyle = o.wreck ? '#2a2a2a' : T.col;
        g.fillRect(r * 0.55, -r * 0.5, r * 0.22, r);          // front stripe = type colour
        g.restore();
        // turret
        g.save();
        g.rotate(ta);
        const bw = type === 'heavy' ? 9 : type === 'rapid' ? 5 : 6;
        g.fillStyle = '#2a2d35';
        g.fillRect(0, -bw / 2, r + T.len, bw);
        if (type === 'rapid') g.fillRect(0, -bw / 2 - 5, r + T.len - 3, 4);
        g.fillStyle = T.col;
        g.fillRect(r + T.len - 4, -bw / 2 - 1, 5, bw + 2);
        g.beginPath(); g.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        g.fillStyle = o.hit ? '#ffffff' : o.wreck ? '#4a4a4a' : T.col; g.fill();
        g.lineWidth = 2.5; g.strokeStyle = owner; g.stroke();
        g.restore();
    }

    let lastT = performance.now(), tGlobal = 0;
    function render(now) {
        const dtf = Math.min(3, (now - lastT) / (1000 / 60));
        lastT = now; tGlobal += dtf;
        view.begin(ctx);
        const d = D();
        const mp = d ? d.mp : 0;
        const tanks = drawTanks(), bullets = drawBullets();

        // countdown beeps (both sides)
        if (d && d.ph === 'ready') {
            const n = Math.ceil((READY_T - d.pt) / 50);
            if (n !== lastBeep && n > 0 && n <= 3) { lastBeep = n; Sfx.beep(false); }
        } else lastBeep = -1;

        ctx.save();
        if (shake > 0.2) { ctx.translate(rnd(-shake, shake), rnd(-shake, shake)); shake *= Math.pow(0.86, dtf); } else shake = 0;
        if (flip()) { ctx.translate(W, H); ctx.rotate(Math.PI); }
        ctx.drawImage(floor(mp), 0, 0, W, H);
        if (d) for (const r of MAP_RECTS[mp]) if (r.k === 'c' && d.cr[r.ci] > 0) drawCrate(r, d.cr[r.ci]);

        // zone
        const zr = d ? d.zr : ZONE_MAX;
        if (zr < ZONE_MAX) {
            ctx.save();
            ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(CX, CY, zr, 0, Math.PI * 2, true);
            ctx.fillStyle = `rgba(255,40,60,${0.18 + 0.06 * Math.sin(tGlobal / 8)})`; ctx.fill();
            ctx.beginPath(); ctx.arc(CX, CY, zr, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff4d6a'; ctx.lineWidth = 3; ctx.setLineDash([12, 8]); ctx.lineDashOffset = -tGlobal; ctx.stroke(); ctx.setLineDash([]);
            ctx.restore();
        }

        // smoke under tanks
        for (const s of smoke) {
            s.life -= dtf; s.r += 0.5 * dtf;
            ctx.fillStyle = `rgba(60,60,60,${Math.max(0, s.life / s.max) * 0.45})`;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].life <= 0) smoke.splice(i, 1);

        // loot (glow on the ground; the icon is drawn upright in the HUD pass)
        const items = drawItems();
        for (const it of items) {
            const I = ITEMS[it.k], blink = it.life < 180 && Math.floor(tGlobal / 6) % 2;
            if (blink) continue;
            const r = 15 + Math.sin(tGlobal / 8 + it.x) * 1.5;
            const g = ctx.createRadialGradient(it.x, it.y, 2, it.x, it.y, r + 8);
            g.addColorStop(0, I.col + 'aa'); g.addColorStop(1, I.col + '00');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(it.x, it.y, r + 8, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(10,12,20,0.75)'; ctx.beginPath(); ctx.arc(it.x, it.y, r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = I.col; ctx.lineWidth = 2; ctx.stroke();
        }

        // tanks
        tanks.forEach((t, i) => {
            const T = TANKS[t.type];
            if (t.hp <= 0) {        // wreck
                ctx.save(); ctx.translate(t.x, t.y); ctx.globalAlpha = 0.7;
                drawTank(ctx, t.type, '#3a3a3a', t.ba, t.ta, 0, { wreck: true });
                ctx.restore();
                return;
            }
            treadOdo[i] += Math.hypot(t.vx || 0, t.vy || 0) * dtf;
            ctx.save();
            ctx.translate(t.x, t.y);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath(); ctx.ellipse(3, 5, T.r * 1.15, T.r * 0.95, 0, 0, Math.PI * 2); ctx.fill();
            if (t.dash > 0) { ctx.shadowColor = '#cfe8ff'; ctx.shadowBlur = 18; }
            if (t.type === 'rapid' && t.fx > 0) { ctx.shadowColor = '#ff8a1f'; ctx.shadowBlur = 16 + 6 * Math.sin(tGlobal / 3); }
            if (t.boost > 0) { ctx.shadowColor = '#9bffcf'; ctx.shadowBlur = 14; }
            drawTank(ctx, t.type, OWNER[i], t.ba, t.ta, treadOdo[i], { hit: t.hitT > 6 });
            ctx.shadowBlur = 0;
            if (t.ap > 0) {                       // armour plates: bolted skirt
                ctx.save(); ctx.rotate(t.ba);
                ctx.strokeStyle = '#c9b18a'; ctx.lineWidth = 3; ctx.setLineDash([7, 3]);
                roundRect(ctx, -T.r * 1.12, -T.r * 1.05, T.r * 2.24, T.r * 2.1, 6); ctx.stroke();
                ctx.setLineDash([]); ctx.restore();
            }
            if (t.pw > 0) {
                ctx.strokeStyle = `rgba(255,215,0,${0.5 + 0.3 * Math.sin(tGlobal / 4)})`; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(0, 0, T.r + 4, 0, Math.PI * 2); ctx.stroke();
            }
            if (t.ip > 0) {                       // interceptor: spinning radar + faint range ring
                const ra = tGlobal / 6;
                ctx.strokeStyle = 'rgba(195,166,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
                ctx.beginPath(); ctx.arc(0, 0, IP.range, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
                ctx.strokeStyle = '#c3a6ff'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(-T.r * 0.5, 0, 5, ra, ra + Math.PI); ctx.stroke();
            }
            if (t.sh > 0) {                       // energy shield bubble
                ctx.beginPath(); ctx.arc(0, 0, T.r + 11, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(90,215,255,${0.08 + 0.12 * t.sh / SHIELD_HP})`; ctx.fill();
                ctx.strokeStyle = `rgba(90,215,255,${0.4 + 0.5 * t.sh / SHIELD_HP})`; ctx.lineWidth = 2; ctx.stroke();
            }
            if (t.type === 'heavy' && t.fx > 0) {
                ctx.beginPath(); ctx.arc(0, 0, T.r + 9, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(125,255,106,${0.12 + 0.05 * Math.sin(tGlobal / 5)})`; ctx.fill();
                ctx.strokeStyle = 'rgba(125,255,106,0.8)'; ctx.lineWidth = 2; ctx.stroke();
            }
            ctx.restore();
            if (t.arm > 0) {        // railgun laser sight (stops at steel)
                const c = Math.cos(t.ta), s = Math.sin(t.ta);
                let L2 = T.r + T.len;
                while (L2 < 900 && rectAt(t.x + c * L2, t.y + s * L2, mp, null) < 0 && rectAt(t.x + c * L2, t.y + s * L2, mp, null) !== -2) L2 += 6;
                ctx.strokeStyle = `rgba(200,160,255,${0.45 + 0.3 * Math.sin(tGlobal / 3)})`; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(t.x + c * (T.r + T.len), t.y + s * (T.r + T.len)); ctx.lineTo(t.x + c * L2, t.y + s * L2); ctx.stroke();
            }
        });

        // drones
        for (const dr of drawDrones()) {
            ctx.save(); ctx.translate(dr.x, dr.y); ctx.rotate(dr.a || 0);
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(4, 7, 8, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#2a2d35'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke();
            for (const [px, py] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
                ctx.fillStyle = `rgba(220,240,255,${0.35 + 0.25 * Math.sin(tGlobal * 2 + px)})`;
                ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = OWNER[dr.o]; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
        // interceptor beams
        for (const z of zaps) {
            z.life -= dtf;
            ctx.strokeStyle = `rgba(215,190,255,${Math.max(0, z.life / 10)})`; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(z.x, z.y); ctx.lineTo(z.x2, z.y2); ctx.stroke();
        }
        for (let i = zaps.length - 1; i >= 0; i--) if (zaps[i].life <= 0) zaps.splice(i, 1);

        // shells
        for (const b of bullets) {
            if (b.k === 4) {                       // missile: body + exhaust
                const a = Math.atan2(b.vy, b.vx);
                if (Math.random() < 0.6 * dtf) smoke.push({ x: b.x - Math.cos(a) * 8, y: b.y - Math.sin(a) * 8, r: 3, life: 18, max: 18 });
                ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
                ctx.fillStyle = `rgba(255,${150 + Math.random() * 80 | 0},60,0.9)`;
                ctx.beginPath(); ctx.moveTo(-6, -2.5); ctx.lineTo(-13 - Math.random() * 5, 0); ctx.lineTo(-6, 2.5); ctx.fill();
                ctx.fillStyle = '#e8e8e8'; roundRect(ctx, -7, -3, 13, 6, 3); ctx.fill();
                ctx.fillStyle = OWNER[b.o]; ctx.fillRect(3, -3, 3, 6);
                ctx.fillStyle = '#888'; ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(-10, -6); ctx.lineTo(-4, -3); ctx.moveTo(-7, 3); ctx.lineTo(-10, 6); ctx.lineTo(-4, 3); ctx.fill();
                ctx.restore();
                continue;
            }
            const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
            const col = b.k === 2 ? '#d7b8ff' : OWNER[b.o];
            const tail = b.k === 2 ? 40 : b.k === 1 ? 10 : b.k >= 3 ? 8 : 14;
            const lg = ctx.createLinearGradient(b.x, b.y, b.x - ux * tail, b.y - uy * tail);
            lg.addColorStop(0, col); lg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.strokeStyle = lg; ctx.lineWidth = b.k === 1 ? 6 : b.k === 2 ? 4 : b.k >= 3 ? 2 : 3; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - ux * tail, b.y - uy * tail); ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(b.x, b.y, b.k === 1 ? 5 : b.k === 2 ? 3.5 : b.k >= 3 ? 1.9 : 2.6, 0, Math.PI * 2); ctx.fill();
        }

        // particles
        for (const p of parts) {
            p.x += p.vx * dtf; p.y += p.vy * dtf; p.vx *= 0.92; p.vy *= 0.92; p.life -= dtf;
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            ctx.fillStyle = p.col;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
        for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
        ctx.restore();

        // ---------- HUD (screen-upright) ----------
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const it of items) {
            if (it.life < 180 && Math.floor(tGlobal / 6) % 2) continue;
            const p = toView(it.x, it.y);
            ctx.font = '16px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
            ctx.fillText(ITEMS[it.k].icon, p.x, p.y + 1 + Math.sin(tGlobal / 10 + it.x) * 1.5);
        }
        ctx.textBaseline = 'alphabetic';
        const drones = drawDrones();
        tanks.forEach((t, i) => {
            if (t.hp <= 0) return;
            const icons = gearIcons(t, i, drones);
            if (!icons.length) return;
            const p = toView(t.x, t.y);
            ctx.font = '10px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center';
            ctx.fillStyle = '#fff';
            ctx.fillText(icons.map((g) => g[0]).join(''), p.x, p.y - TANKS[t.type].r - 22);
        });
        tanks.forEach((t, i) => {
            if (t.hp <= 0) return;
            const T = TANKS[t.type], p = toView(t.x, t.y);
            const bw = 44, x = p.x - bw / 2, y = p.y - T.r - 18;
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, bw + 2, 9);
            const f = t.hp / T.hp;
            ctx.fillStyle = f > 0.5 ? '#5bff8f' : f > 0.25 ? '#ffd34d' : '#ff5b5b';
            ctx.fillRect(x, y, bw * f, 4);
            ctx.fillStyle = t.sp >= 100 ? (Math.floor(tGlobal / 8) % 2 ? '#fff' : T.col) : T.col;
            ctx.fillRect(x, y + 5, bw * t.sp / 100, 2);
            if (i === myIdx && d && d.ph === 'ready') {
                ctx.fillStyle = OWNER[i];
                ctx.font = '900 13px Orbitron, sans-serif'; ctx.textAlign = 'center';
                ctx.fillText('YOU', p.x, y - 8 + Math.sin(tGlobal / 6) * 2);
            }
        });
        for (const f of floats) {
            f.life -= dtf;
            const p = f.hud ? { x: f.x, y: f.y } : toView(f.x, f.y);
            ctx.globalAlpha = Math.min(1, f.life / 20);
            ctx.font = `900 ${f.big ? 18 : 14}px "Plus Jakarta Sans", system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            const yy = p.y - 24 - (f.hud ? 0 : (60 - f.life) * 0.5);
            ctx.strokeText(f.txt, p.x, yy); ctx.fillStyle = f.col; ctx.fillText(f.txt, p.x, yy);
        }
        ctx.globalAlpha = 1;
        for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);
        if (flash > 0.01) { ctx.fillStyle = `rgba(255,40,40,${flash})`; ctx.fillRect(0, 0, W, H); flash *= Math.pow(0.88, dtf); }

        if (d && tanks[myIdx]) {
            const me = tanks[myIdx], T = TANKS[me.type];
            // bottom-left: my gauges
            const gear = gearIcons(me, myIdx, drones);
            ctx.fillStyle = 'rgba(8,10,16,0.7)'; roundRect(ctx, 24, H - (gear.length ? 78 : 58), 196, gear.length ? 56 : 36, 8); ctx.fill();
            if (gear.length) {
                ctx.font = '700 11px "Plus Jakarta Sans", system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffe9a8';
                ctx.fillText(gear.map((g) => g[0] + g[1]).join('  '), 32, H - 62);
            }
            ctx.font = '700 11px "Plus Jakarta Sans", sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#cfd3ff';
            ctx.fillText(`${T.icon} ${T.name}  HP ${Math.ceil(me.hp)}`, 32, H - 44);
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(32, H - 36, 130, 6);
            ctx.fillStyle = me.sp >= 100 ? '#fff' : T.col; ctx.fillRect(32, H - 36, 130 * me.sp / 100, 6);
            ctx.fillStyle = me.dcd > 0 ? 'rgba(255,255,255,0.3)' : '#cfe8ff';
            ctx.fillText(me.dcd > 0 ? '💨 ' + Math.ceil(me.dcd / 60) : '💨 OK', 170, H - 30);
            specialBtn.classList.toggle('ready', me.sp >= 100 && me.hp > 0);
            // top: round + timer
            ctx.textAlign = 'center'; ctx.font = '900 13px Orbitron, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.fillText(`ROUND ${d.rd}`, CX, 34);
        }
        if (d && d.ph === 'ready') {
            const n = Math.ceil((READY_T - d.pt) / 50);
            banner(n > 0 ? String(n) : 'GO!', '#ffd34d', 1 - ((READY_T - d.pt) % 50) / 50);
        } else if (d && d.ph === 'battle' && d.pt < 40) {
            banner('GO!', '#7dff6a', d.pt / 40);
        } else if (d && d.ph === 'finish' && d.fin) {
            const w = d.fin.w;
            banner(w < 0 ? 'DRAW' : 'K.O.!', w === myIdx ? '#7dff6a' : w < 0 ? '#cfd3ff' : '#ff5b5b', 0);
            ctx.font = '700 16px "Plus Jakarta Sans", sans-serif'; ctx.textAlign = 'center';
            ctx.fillStyle = '#fff';
            ctx.fillText(L(w < 0 ? 'round_draw' : w === myIdx ? 'round_win' : 'round_lose'), CX, CY + 48);
        }
        if (!d) {           // idle arena behind the lobby
            ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H);
        }
        renderPicker(dtf);
        requestAnimationFrame(render);
    }
    /** [[icon, label], …] for the gear tank `i` carries (HUD). */
    function gearIcons(t, i, drones) {
        const out = [];
        if (t.w === 1) out.push(['🔫', t.ammo]);
        if (t.w === 2) out.push(['🚀', t.ammo]);
        if (t.sh > 0) out.push(['💠', Math.ceil(t.sh)]);
        if (t.ip > 0) out.push(['📡', Math.ceil(t.ip / 60) + 's']);
        if (t.ap > 0) out.push(['🧱', Math.ceil(t.ap / 60) + 's']);
        if (t.pw > 0) out.push(['⭐', Math.ceil(t.pw / 60) + 's']);
        const nd = drones.filter((q) => q.o === i).length;
        if (nd) out.push(['🛸', nd]);
        return out;
    }
    function banner(txt, col, fade) {
        ctx.save();
        ctx.globalAlpha = 1 - Math.max(0, fade) * 0.6;
        ctx.font = `900 ${64 + (1 - fade) * 8}px Orbitron, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(txt, CX, CY);
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.fillText(txt, CX, CY);
        ctx.restore();
    }
    const pickAng = {};
    function renderPicker(dtf) {
        if (overlay.classList.contains('hidden')) return;
        for (const { cv, t } of pickCanvases) {
            const g = cv.getContext('2d');
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, cv.width, cv.height);
            const on = t === myPick;
            pickAng[t] = (pickAng[t] || -Math.PI / 2) + (on ? 0.03 : 0) * dtf;
            g.translate(56, 58); g.scale(1.55, 1.55);
            drawTank(g, t, OWNER[myIdx], -Math.PI / 2, pickAng[t], on ? tGlobal : 0, {});
        }
    }

    // ==========================================================
    // Test hooks
    // ==========================================================
    GameBot.expose({
        state: () => S,
        place(i, x, y, ta) { const t = S.tanks[i]; t.x = x; t.y = y; if (ta !== undefined) t.ta = ta; },
        setInput(inp) { inputOverride = inp ? Object.assign({ x: 0, y: 0, f: false, ax: null, ay: null }, inp) : null; },
        freezeBot(v) { bot.frozen = v; },
        skipCountdown() { if (S && S.ph === 'ready') S.pt = READY_T - 1; },
        fire, hostAction, rects: (mp) => MAP_RECTS[mp], TANKS,
        giveItem, spawnItem: (k, x, y) => addItem(k, x, y), stopLoot() { if (S) S.itT = 1e9; }, ITEMS
    });

    requestAnimationFrame(render);
});
