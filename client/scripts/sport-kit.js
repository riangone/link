/**
 * SportKit — shared plumbing for the 1v1 ball games (volley / soccer / tennis / hoops).
 *
 * Lifted out of client/volley/game.js once a second sport existed. Each game
 * keeps its own physics, controls, bot brain and drawing; everything that was
 * pure boilerplate lives here:
 *
 *   SportKit.i18n(dict)  zh/en/ja/ko strings; COMMON lobby/status strings are
 *                        merged under the game's own, so a game only writes
 *                        what is specific to it. Same ?lang= → localStorage →
 *                        browser → en rule as every other game.
 *   SportKit.sfx(key)    WebAudio synth (tone/noise) + common whistles/jingles,
 *                        with the mute button wired.
 *   SportKit.fx()        particles, floating shout text, shake/flash/slow-mo.
 *   SportKit.history(n)  ring buffer of recent ball positions: the host's
 *                        "HitWindow" — a remote player who touched the ball on
 *                        their (RTT/2-old) screen still gets the touch.
 *   SportKit.match(o)    GameSession/GameBot lifecycle: invite link, status
 *                        panel, ready / game-over / disconnect overlays,
 *                        rematch handshake, state dedupe on the client.
 *
 * Network contract (same as volley/spin/armor): the host owns the sim and
 * sends {type:'state', mid, ph, sc, ev:[{id,k,…}], …} at 30 Hz; the client
 * sends {type:'input', …}. Events carry a monotonically increasing id so the
 * client plays each sound/effect exactly once even with an unordered channel.
 */
(function () {
    'use strict';

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const r1 = (v) => Math.round(v * 10) / 10;
    const num = (v) => typeof v === 'number' && isFinite(v);

    // ==================================================================
    // i18n
    // ==================================================================
    const COMMON = {
        zh: {
            lang_title: '语言', mute_title: '声音',
            p1_host: 'P1（房主）', p2_client: 'P2（客人）', p1_you: 'P1（你）', p2_opp: 'P2（对手）', p2_you: 'P2（你）',
            invite_label: '邀请链接（发给朋友一起玩）', copy: '复制', copied: '复制好了！',
            conn_wait: '正在找对手…', conn_signal: '正在连接服务器…',
            conn_open: '连上了！等朋友打开链接加入…', conn_closed: '和服务器断开了，刷新试试',
            waiting_peer: '等待对手', waiting_for: '等待 {name}',
            role_host: '你是<b>房主</b>：准备好就点开始！', role_client: '你是<b>客人</b>：等房主开始。',
            final_score: '比分', rematch: '再来一局', awaiting: '等房主同意…',
            lost_h2: '对手离开了', lost_p: '连接断了。', lobby_btn: '回到大厅',
            how_h3: '怎么玩', status_h3: '状态', st_state: '状态', st_ping: '延迟', st_role: '身份',
            st_disconnected: '未连接', st_offline: '离线', st_p2p: '已直连', st_reconnect: '重连中…', st_spectator: '观战',
            back: '返回 LINK',
            help_btn: '操作说明', help_title: '查看详细操控与战术指南',
            help_h2: '机甲竞技操控指南', help_close: '我知道了',
            tab_keys: '💻 电脑键盘', tab_touch: '📱 手机触控', tab_rules: '🏆 战术与规则',
            briefing_title: '🎮 作战操控速查', view_manual: '📖 完整操作手册',
            tip_keyboard: '键盘', tip_touch: '触控', tip_mouse: '鼠标/手势'
        },
        en: {
            lang_title: 'Language', mute_title: 'Sound',
            p1_host: 'P1 (host)', p2_client: 'P2 (guest)', p1_you: 'P1 (you)', p2_opp: 'P2 (rival)', p2_you: 'P2 (you)',
            invite_label: 'Invite link (send it to a friend)', copy: 'Copy', copied: 'Copied!',
            conn_wait: 'Looking for a rival…', conn_signal: 'Connecting to the server…',
            conn_open: 'Connected! Waiting for your friend to open the link…', conn_closed: 'Lost the server. Try refreshing',
            waiting_peer: 'Waiting for rival', waiting_for: 'Waiting for {name}',
            role_host: 'You are the <b>host</b>: press start when ready!', role_client: 'You are the <b>guest</b>: wait for the host to start.',
            final_score: 'Score', rematch: 'Play again', awaiting: 'Waiting for host…',
            lost_h2: 'Your rival left', lost_p: 'The connection was lost.', lobby_btn: 'Back to lobby',
            how_h3: 'How to play', status_h3: 'Status', st_state: 'State', st_ping: 'Ping', st_role: 'Role',
            st_disconnected: 'Disconnected', st_offline: 'Offline', st_p2p: 'Direct link', st_reconnect: 'Reconnecting…', st_spectator: 'Spectator',
            back: 'Back to LINK',
            help_btn: 'Controls', help_title: 'View detailed controls & tactics guide',
            help_h2: 'Mech Combat Controls', help_close: 'Got it',
            tab_keys: '💻 Keyboard', tab_touch: '📱 Touch', tab_rules: '🏆 Rules & Tactics',
            briefing_title: '🎮 Tactical Controls', view_manual: '📖 Full Manual',
            tip_keyboard: 'Keyboard', tip_touch: 'Touch', tip_mouse: 'Mouse/Touch'
        },
        ja: {
            lang_title: '言語', mute_title: 'サウンド',
            p1_host: 'P1（ホスト）', p2_client: 'P2（ゲスト）', p1_you: 'P1（あなた）', p2_opp: 'P2（相手）', p2_you: 'P2（あなた）',
            invite_label: '招待リンク（友だちに送ろう）', copy: 'コピー', copied: 'コピーしました！',
            conn_wait: '相手を探しています…', conn_signal: 'サーバーに接続中…',
            conn_open: '接続しました！友だちがリンクを開くのを待っています…', conn_closed: 'サーバーと切断されました。再読み込みしてね',
            waiting_peer: '相手待ち', waiting_for: '{name} を待っています',
            role_host: 'あなたは<b>ホスト</b>：準備ができたらスタート！', role_client: 'あなたは<b>ゲスト</b>：ホストのスタートを待ってね。',
            final_score: 'スコア', rematch: 'もう一回', awaiting: 'ホストの承認待ち…',
            lost_h2: '相手が退出しました', lost_p: '接続が切れました。', lobby_btn: 'ロビーに戻る',
            how_h3: '遊び方', status_h3: '状態', st_state: '状態', st_ping: 'Ping', st_role: '役割',
            st_disconnected: '未接続', st_offline: 'オフライン', st_p2p: '直接接続', st_reconnect: '再接続中…', st_spectator: '観戦',
            back: 'LINK に戻る',
            help_btn: '操作説明', help_title: '詳しい操作と戦術ガイドを見る',
            help_h2: 'メカ対戦操作ガイド', help_close: '了解',
            tab_keys: '💻 キーボード', tab_touch: '📱 タッチ操作', tab_rules: '🏆 ルールと戦術',
            briefing_title: '🎮 作戦操作ガイド', view_manual: '📖 詳細マニュアル',
            tip_keyboard: 'キーボード', tip_touch: 'タッチ', tip_mouse: 'マウス/タッチ'
        },
        ko: {
            lang_title: '언어', mute_title: '소리',
            p1_host: 'P1 (방장)', p2_client: 'P2 (손님)', p1_you: 'P1 (나)', p2_opp: 'P2 (상대)', p2_you: 'P2 (나)',
            invite_label: '초대 링크 (친구에게 보내세요)', copy: '복사', copied: '복사했어요!',
            conn_wait: '상대를 찾는 중…', conn_signal: '서버에 연결 중…',
            conn_open: '연결됐어요! 친구가 링크를 열기를 기다리는 중…', conn_closed: '서버 연결이 끊겼어요. 새로고침 해 보세요',
            waiting_peer: '상대 대기 중', waiting_for: '{name} 기다리는 중',
            role_host: '당신은 <b>방장</b>: 준비되면 시작!', role_client: '당신은 <b>손님</b>: 방장이 시작하길 기다려요.',
            final_score: '점수', rematch: '한 판 더', awaiting: '방장 수락 대기 중…',
            lost_h2: '상대가 나갔어요', lost_p: '연결이 끊겼어요.', lobby_btn: '로비로',
            how_h3: '플레이 방법', status_h3: '상태', st_state: '상태', st_ping: '핑', st_role: '역할',
            st_disconnected: '연결 안 됨', st_offline: '오프라인', st_p2p: '직접 연결', st_reconnect: '재연결 중…', st_spectator: '관전',
            back: 'LINK로 돌아가기',
            help_btn: '조작법', help_title: '상세 조작법 및 전술 가이드 보기',
            help_h2: '메카 대전 조작 가이드', help_close: '확인',
            tab_keys: '💻 키보드', tab_touch: '📱 터치 조작', tab_rules: '🏆 규칙 및 전술',
            briefing_title: '🎮 작전 조작 가이드', view_manual: '📖 상세 매뉴얼',
            tip_keyboard: '키보드', tip_touch: '터치', tip_mouse: '마우스/터치'
        }
    };
    const LANGS = [['zh', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']];

    function i18n(game) {
        const D = {};
        for (const l of Object.keys(COMMON)) D[l] = Object.assign({}, COMMON[l], game[l] || {});
        const qs = new URLSearchParams(location.search);
        let lang = qs.get('lang') || localStorage.getItem('language') || (navigator.language || 'en').slice(0, 2);
        if (!D[lang]) lang = 'en';
        document.documentElement.lang = lang;
        function t(k, r) {
            let s = D[lang][k];
            if (s === undefined) s = D.en[k];
            if (s === undefined) s = k;
            for (const x in (r || {})) s = s.split('{' + x + '}').join(r[x]);
            return s;
        }
        function apply(root) {
            (root || document).querySelectorAll('[data-i18n]').forEach((e) => { e.innerHTML = t(e.dataset.i18n, e.dataset.i18nN ? { n: e.dataset.i18nN } : null); });
            (root || document).querySelectorAll('[data-i18n-title]').forEach((e) => { e.title = t(e.dataset.i18nTitle); });
        }
        function setLang(l) {
            if (!D[l] || l === lang) return;
            localStorage.setItem('language', l);
            const u = new URL(location.href);
            u.searchParams.delete('lang');
            location.replace(u.toString());
        }
        const mount = () => {
            document.title = t('page_title');
            apply();
            const sel = document.getElementById('lang-select');
            if (sel && !sel.options.length) {
                for (const [v, n] of LANGS) { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); }
                sel.value = lang;
                sel.addEventListener('change', () => setLang(sel.value));
            }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
        return { lang, t, apply, setLang, dict: D };
    }

    // ==================================================================
    // Audio
    // ==================================================================
    function sfx(storeKey) {
        let ac = null, master = null, noiseBuf = null;
        let muted = localStorage.getItem(storeKey) === '1';
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
        const api = {
            init, tone, noise,
            get muted() { return muted; },
            toggle() {
                muted = !muted;
                localStorage.setItem(storeKey, muted ? '1' : '0');
                if (master) master.gain.value = muted ? 0 : 0.5;
                return muted;
            },
            bindMute(btn) {
                const sync = () => { btn.textContent = muted ? '🔇' : '🔊'; };
                sync();
                btn.addEventListener('click', () => { init(); api.toggle(); sync(); });
            },
            whistle() { tone(2100, 0.12, 'sine', 0.12); tone(2100, 0.3, 'sine', 0.12, 1900, 0.15); },
            beep() { tone(660, 0.1, 'triangle', 0.1); },
            thud() { noise(0.2, 400, 0.8, 0.3, 'lowpass'); },
            cheer() { noise(0.9, 1400, 0.4, 0.18); [784, 988, 1175].forEach((f, i) => tone(f, 0.18, 'triangle', 0.07, null, i * 0.08)); },
            win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'square', 0.09, null, i * 0.12)); }
        };
        return api;
    }

    // ==================================================================
    // FX: particles + floating text + screen shake / flash / slow-mo
    // ==================================================================
    function fx() {
        let parts = [], floats = [];
        const F = {
            shake: 0, flash: 0, slowmo: 0,
            burst(x, y, n, col, sp, life, size, grav) {
                for (let k = 0; k < n; k++) {
                    const a = Math.random() * Math.PI * 2, s = sp * (0.3 + Math.random());
                    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - sp * 0.3, life, max: life, col, size: size * (0.5 + Math.random()), g: grav === undefined ? 0.15 : grav });
                }
            },
            /** dust/grass/sand kicked up at ground point (x, y) */
            puff(x, y, n, col) {
                for (let k = 0; k < n; k++) parts.push({ x: x + rnd(-12, 12), y: y - 2, vx: rnd(-2.2, 2.2), vy: rnd(-3, -0.5), life: 28, max: 28, col, size: rnd(2.5, 5), g: 0.14 });
            },
            confetti(x, y, n) {
                const cols = ['#ff3fb4', '#ffd34d', '#2de2ff', '#ffffff', '#9bffcf'];
                for (let k = 0; k < n; k++) parts.push({ x: x + rnd(-60, 60), y: y + rnd(-20, 20), vx: rnd(-5, 5), vy: rnd(-7, -1), life: 90, max: 90, col: cols[k % cols.length], size: rnd(3, 6), g: 0.12, rect: true, rot: rnd(0, 6) });
            },
            float(txt, x, y, col, size) { floats.push({ txt, x, y, col, size: size || 26, life: 60, max: 60 }); },
            /** Frame delta (in 60 Hz frames) after slow-mo. */
            time(dtf) { if (F.slowmo > 0) { F.slowmo -= dtf; return dtf * 0.45; } return dtf; },
            applyShake(ctx, dtf) {
                if (F.shake > 0.2) { ctx.translate(rnd(-F.shake, F.shake), rnd(-F.shake, F.shake)); F.shake *= Math.pow(0.85, dtf); } else F.shake = 0;
            },
            drawParts(ctx, dtf) {
                for (const q of parts) {
                    q.x += q.vx * dtf; q.y += q.vy * dtf; q.vy += q.g * dtf; q.life -= dtf;
                    ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
                    ctx.fillStyle = q.col;
                    if (q.rect) { q.rot += 0.2 * dtf; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.fillRect(-q.size, -q.size / 2, q.size * 2, q.size); ctx.restore(); }
                    else { ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2); ctx.fill(); }
                }
                ctx.globalAlpha = 1;
                parts = parts.filter((q) => q.life > 0);
            },
            /** sx maps a canonical x to screen x (mirroring); text itself is never mirrored. */
            drawFloats(ctx, dtf, sx) {
                for (const f of floats) {
                    f.life -= dtf;
                    const k = f.life / f.max;
                    ctx.save();
                    ctx.globalAlpha = clamp(k * 1.6, 0, 1);
                    ctx.translate(sx ? sx(f.x) : f.x, f.y - (1 - k) * 30);
                    const s = 1 + Math.max(0, k - 0.85) * 3;
                    ctx.scale(s, s);
                    ctx.font = `900 italic ${f.size}px Orbitron, sans-serif`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(30,20,60,.75)';
                    ctx.strokeText(f.txt, 0, 0);
                    ctx.fillStyle = f.col; ctx.fillText(f.txt, 0, 0);
                    ctx.restore();
                }
                floats = floats.filter((f) => f.life > 0);
            },
            drawFlash(ctx, W, H, dtf) {
                if (F.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${F.flash * 0.04})`; ctx.fillRect(0, 0, W, H); F.flash -= dtf; }
            }
        };
        return F;
    }

    // ==================================================================
    // HitWindow: recent ball positions on the host
    // ==================================================================
    function history(n) {
        const buf = [];
        return {
            buf,
            push(o) { buf.push(o); if (buf.length > n) buf.shift(); },
            clear() { buf.length = 0; },
            /**
             * Look back up to ~RTT (in 60 Hz frames) for a past ball position
             * that satisfies test(h). Returns it or null. k=0 (now) is the
             * caller's job.
             */
            lagScan(rttMs, test) {
                const lag = clamp(Math.round(rttMs / (1000 / 60)), 0, buf.length - 1);
                for (let k = 1; k <= lag; k++) {
                    const h = buf[buf.length - 1 - k];
                    if (test(h)) return h;
                }
                return null;
            }
        };
    }

    // ==================================================================
    // Match shell: session + overlays + rematch + client state dedupe
    // ==================================================================
    /**
     * o: {
     *   game, L, sfx, effects (a SportKit.fx()), W, H,
     *   startMatch()            host: (re)start a match
     *   stopHost()              host: stop the sim loop (peer lost / game over)
     *   hostOver() → bool       host: is there no running match?
     *   broadcast()             host: send the current state now
     *   onInput(msg)            host: a {type:'input'} from the client / bot
     *   onNewMatch()            client: the host started a new match
     *   onEvent(ev)             both: play one event
     *   onRole(role)            optional extra
     * }
     */
    function match(o) {
        const $ = (id) => document.getElementById(id);
        const L = o.L;
        const el = {
            p1: $('p1-score'), p2: $('p2-score'), p1l: $('p1-label'), p2l: $('p2-label'),
            overlay: $('overlay'), lobby: $('lobby-screen'), ready: $('ready-screen'), over: $('gameover-screen'), lost: $('disconnect-screen'),
            invite: $('invite-url'), copy: $('copy-btn'), start: $('start-btn'), restart: $('restart-btn'), lobbyBtn: $('lobby-btn'),
            conn: $('connection-state-text'), roleText: $('role-text'), title: $('win-loss-title'), final: $('final-score'),
            status: $('status-text'), ping: $('ping-text'), roleStatus: $('role-status-text')
        };
        const opponentName = new URLSearchParams(location.search).get('opponent') || '';
        const waitingText = opponentName ? L('waiting_for', { name: opponentName }) : L('waiting_peer');

        el.invite.value = location.href;
        el.copy.addEventListener('click', () => {
            el.invite.select();
            document.execCommand('copy');
            el.copy.textContent = L('copied');
            setTimeout(() => { el.copy.textContent = L('copy'); }, 2000);
        });
        el.conn.textContent = L('conn_signal');

        const M = {
            role: null, idx: 0, rtt: 0, open: false,
            net: null, netAt: 0, mid: -1,
            flip() { return M.role === 'client'; },
            session: null
        };
        let lastEvId = 0, overShown = false, awaitingRestart = false;
        // host: the peer dropped mid-match, so the stopped sim may still be in
        // a live phase; a reconnecting peer must still be able to start anew.
        let peerLost = false;
        const canStart = () => o.hostOver() || peerLost;
        const hostStart = () => { peerLost = false; o.startMatch(); };

        function showScreen(s) {
            el.overlay.classList.remove('hidden');
            [el.lobby, el.ready, el.over, el.lost].forEach((x) => x.classList.toggle('hidden', x !== s));
        }
        M.hideOverlay = function () { el.overlay.classList.add('hidden'); el.restart.disabled = false; el.restart.textContent = L('rematch'); };
        M.overlayUp = () => !el.overlay.classList.contains('hidden');
        M.score = function (sc) { el.p1.textContent = sc[0]; el.p2.textContent = sc[1]; };
        M.gameOver = function (sc) {
            overShown = true;
            if (M.role === 'host') o.stopHost();
            showScreen(el.over);
            el.final.textContent = `${sc[0]} - ${sc[1]}`;
            const won = sc[M.idx] > sc[1 - M.idx];
            el.title.textContent = won ? 'VICTORY!' : 'DEFEAT';
            el.title.className = won ? 'neon-text' : 'danger-text';
            if (won) { o.sfx.win(); o.effects.confetti(o.W / 2, o.H / 3, 90); }
            if (o.onGameOver) o.onGameOver();
        };

        function handle(msg) {
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'input') { if (M.role === 'host') o.onInput(msg); return; }
            if (msg.type === 'state') {
                if (M.role !== 'client') return;
                if (msg.mid !== M.mid) { M.mid = msg.mid; lastEvId = 0; if (o.onNewMatch) o.onNewMatch(); }
                M.net = msg; M.netAt = performance.now();
                for (const ev of msg.ev || []) if (ev.id > lastEvId) { lastEvId = ev.id; o.onEvent(ev); }
                if (msg.sc) M.score(msg.sc);
                if (msg.ph === 'over') { if (!overShown) M.gameOver(msg.sc); }
                else {
                    overShown = false; awaitingRestart = false;
                    if (M.overlayUp()) M.hideOverlay();
                }
                return;
            }
            if (msg.type === 'restart-request') {
                if (M.role === 'host' && canStart()) hostStart();
            }
        }

        M.session = GameBot.session({
            gameFolder: o.game,
            dataChannelOptions: { ordered: false, maxRetransmits: 0 },
            onSignalingStatus(status) {
                if (status === 'open') {
                    el.status.textContent = waitingText; el.status.className = 'status-online';
                    el.conn.textContent = L('conn_open');
                } else if (status === 'closed') {
                    el.status.textContent = L('st_offline'); el.status.className = 'status-offline';
                    el.conn.textContent = L('conn_closed');
                }
            },
            onRole(role) {
                M.role = role; M.idx = role === 'host' ? 0 : 1;
                el.roleStatus.textContent = role.toUpperCase();
                el.p1l.textContent = L(role === 'host' ? 'p1_you' : 'p1_host');
                el.p2l.textContent = L(role === 'host' ? 'p2_opp' : 'p2_you');
                el.roleText.innerHTML = L(role === 'host' ? 'role_host' : 'role_client');
                if (o.onRole) o.onRole(role);
            },
            onChannelOpen() {
                M.open = true;
                showScreen(el.ready);
                el.start.classList.toggle('hidden', M.role !== 'host');
            },
            onPeerConnected() { el.status.textContent = L('st_p2p'); el.status.className = 'status-online'; },
            onPeerReconnecting() { el.status.textContent = L('st_reconnect'); el.status.className = 'status-offline'; },
            onPeerDisconnected() {
                M.open = false;
                peerLost = true;
                o.stopHost();
                M.net = null;
                showScreen(el.lost);
                el.status.textContent = waitingText;
                el.ping.textContent = '-- ms';
            },
            onRtt(ms) { M.rtt = ms; el.ping.textContent = `${ms} ms`; },
            onMessage: handle
        });
        M.send = (m) => M.session.send(m);

        setInterval(() => {
            if (!M.open) return;
            if (M.role === 'host' && o.hostOver()) o.broadcast();
            if (awaitingRestart) M.send({ type: 'restart-request' });
        }, 600);

        el.lobbyBtn.addEventListener('click', () => location.reload());
        el.start.addEventListener('click', () => {
            o.sfx.init();
            if (M.role === 'host' && canStart()) hostStart();
        });
        el.restart.addEventListener('click', () => {
            o.sfx.init();
            if (M.role === 'host') hostStart();
            else {
                M.send({ type: 'restart-request' });
                awaitingRestart = true;
                el.restart.textContent = L('awaiting');
                el.restart.disabled = true;
            }
        });
        // ==========================================================
        // Controls / Tactical Help Modal & Live HUD
        // ==========================================================
        function ensureHelpModal() {
            let modal = $('controls-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'controls-modal';
                modal.className = 'controls-modal hidden';
                modal.innerHTML = `
                    <div class="modal-backdrop"></div>
                    <div class="modal-dialog">
                        <div class="modal-header">
                            <h3 class="modal-title">${L('help_h2')}</h3>
                            <button type="button" id="close-help-btn" class="modal-close" aria-label="Close">✕</button>
                        </div>
                        <div class="modal-tabs">
                            <button type="button" class="tab-btn active" data-tab="tab-keys">${L('tab_keys')}</button>
                            <button type="button" class="tab-btn" data-tab="tab-touch">${L('tab_touch')}</button>
                            <button type="button" class="tab-btn" data-tab="tab-rules">${L('tab_rules')}</button>
                        </div>
                        <div class="modal-body">
                            <div class="tab-pane active" id="pane-tab-keys">${L('modal_keys_html') || ''}</div>
                            <div class="tab-pane" id="pane-tab-touch">${L('modal_touch_html') || ''}</div>
                            <div class="tab-pane" id="pane-tab-rules">${L('modal_rules_html') || ''}</div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary modal-ok-btn" id="modal-ok-btn">${L('help_close')}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);

                // Tab switching
                modal.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                        modal.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                        btn.classList.add('active');
                        const pane = modal.querySelector('#pane-' + btn.dataset.tab);
                        if (pane) pane.classList.add('active');
                    });
                });

                const closeFn = () => modal.classList.add('hidden');
                modal.querySelector('.modal-backdrop').addEventListener('click', closeFn);
                modal.querySelector('#close-help-btn').addEventListener('click', closeFn);
                modal.querySelector('#modal-ok-btn').addEventListener('click', closeFn);
            }
            return modal;
        }

        function openHelp() {
            const m = ensureHelpModal();
            m.classList.remove('hidden');
        }
        function closeHelp() {
            const m = $('controls-modal');
            if (m) m.classList.add('hidden');
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeHelp();
        });

        const helpBtn = $('help-btn');
        if (helpBtn) helpBtn.addEventListener('click', openHelp);

        document.querySelectorAll('.open-help-modal').forEach(b => {
            b.addEventListener('click', (e) => { e.preventDefault(); openHelp(); });
        });

        // Key highlight detection for .desktop-hud-bar
        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
            highlightKey(e.key.toLowerCase(), true);
        });
        window.addEventListener('keyup', (e) => {
            highlightKey(e.key.toLowerCase(), false);
        });

        function highlightKey(k, down) {
            let sel = null;
            if (['w', 'a', 's', 'd'].includes(k)) sel = `kbd[data-key="${k}"]`;
            else if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) sel = `kbd[data-key="arrow"], kbd[data-key="${k}"]`;
            else if (k === ' ') sel = `kbd[data-key="space"]`;
            else if (k === 'j') sel = `kbd[data-key="j"]`;
            else if (k === 'k') sel = `kbd[data-key="k"]`;
            else if (k === 'shift') sel = `kbd[data-key="shift"]`;
            if (sel) {
                document.querySelectorAll(sel).forEach(el => el.classList.toggle('active-key', down));
            }
        }

        // Dynamic Toast Banner
        let toastTimer = null;
        M.showToast = function (msg, durationMs = 3200) {
            let toast = $('game-toast');
            if (!toast) {
                const wrap = document.querySelector('.canvas-wrapper') || document.body;
                toast = document.createElement('div');
                toast.id = 'game-toast';
                toast.className = 'game-toast hidden';
                wrap.appendChild(toast);
            }
            toast.innerHTML = msg;
            toast.classList.remove('hidden');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toast.classList.add('hidden'); }, durationMs);
        };
        M.openHelp = openHelp;
        M.closeHelp = closeHelp;

        /** Called by the host after starting a match. */
        M.started = function (sc) { overShown = false; M.hideOverlay(); M.score(sc); };
        /** Frames since the last client snapshot (for extrapolation). */
        M.age = () => Math.min(6, (performance.now() - M.netAt) / (1000 / 60));
        return M;
    }

    /** Shared event-id bookkeeping for the host sim: S.events ring + id. */
    function emitter(fxFn) {
        return function emit(S, ev) {
            ev.id = ++S.evId;
            S.events.push(ev);
            if (S.events.length > 16) S.events.shift();
            fxFn(ev);
        };
    }

    /**
     * Shared dual-mode touch controls (virtual analog stick + action buttons)
     * with GameFit screen vector conversion and flip support.
     */
    function controls(o) {
        o = o || {};
        const { stick, knob, actions, view, flip, onMove, onAction } = o;
        const joy = { x: 0, y: 0, active: false };

        if (stick && knob && onMove && window.GameFit && GameFit.joystick) {
            GameFit.joystick(stick, knob, (x, y, active) => {
                joy.active = active;
                if (!active || Math.hypot(x, y) < 0.12) {
                    joy.x = 0; joy.y = 0;
                    onMove(0, 0, false);
                    return;
                }
                const w = view && view.screenVec ? view.screenVec(x, y) : { x, y };
                let mx = w.x, my = w.y;
                if (flip && flip()) mx = -mx;
                joy.x = mx; joy.y = my;
                onMove(mx, my, true);
            }, { radius: o.radius || 48 });
        }

        if (actions && onAction && window.GameFit && GameFit.touchButtons) {
            GameFit.touchButtons(actions, (action, down) => {
                if (o.sfx && o.sfx.init) o.sfx.init();
                onAction(action, down);
            });
        }

        return {
            getJoy: () => joy
        };
    }

    window.SportKit = { clamp, rnd, r1, num, i18n, sfx, fx, history, match, emitter, controls, COMMON };
})();
