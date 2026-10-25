/**
 * GameBot: shared "play against the computer" plumbing for the 2-player
 * games under client/<game>/ (pong, gomoku, hockey, tanks, brawl, tron).
 *
 * Every one of those games is host-authoritative: the host runs the whole
 * simulation and the client only sends inputs ({type:'input'|'dir'|'place'}).
 * So a bot doesn't need a second game engine — it just *is* a fake client:
 *
 *   - `?bot=easy|normal|hard` in the URL turns bot mode on.
 *   - GameBot.session(opts) then returns a LocalSession instead of a real
 *     GameSession: no signaling socket, no WebRTC. It immediately reports
 *     role 'host' + channel open, so the game shows its normal ready screen
 *     and runs its normal host loop. send() is a no-op.
 *   - Each game's own bot brain (inside its game.js, where it can read the
 *     host state) produces the opponent's input and feeds it back through
 *     GameBot.deliver(msg) — the exact same message the remote client would
 *     have sent, through the same validation in the game's onMessage.
 *
 * Without `?bot=`, GameBot.session() is just `new GameSession(opts)` and the
 * only visible change is a "play vs computer" box on the waiting screen.
 */
(function () {
    'use strict';

    var LEVELS = ['easy', 'normal', 'hard'];
    // <script src="../scripts/game-bot.js" data-lobby="../play/">: the site has
    // a matchmaking lobby (main Link). The lite build has none.
    var me = document.currentScript;
    var lobbyPath = me && me.dataset ? me.dataset.lobby : '';
    var qs = new URLSearchParams(location.search);
    var raw = qs.get('bot');
    var level = raw === null ? null : (LEVELS.indexOf(raw) >= 0 ? raw : 'normal');

    var S = {
        zh: { vs: '🤖 人机对战', easy: '🍼 简单', normal: '🍬 普通', hard: '🌶️ 困难', bot: '机器人',
            box: '不想等？先和程序对战', ready: '对手是程序（{lv}）。准备好就点开始！', status: 'VS BOT',
            level: '难度', human: '👥 找真人对战' },
        ja: { vs: '🤖 CPU 対戦', easy: '🍼 かんたん', normal: '🍬 ふつう', hard: '🌶️ むずかしい', bot: 'CPU',
            box: '待ちたくない？CPU と対戦', ready: '相手は CPU（{lv}）。準備ができたらスタート！', status: 'VS CPU',
            level: '難易度', human: '👥 人と対戦' },
        ko: { vs: '🤖 컴퓨터 대전', easy: '🍼 쉬움', normal: '🍬 보통', hard: '🌶️ 어려움', bot: '봇',
            box: '기다리기 싫다면? 컴퓨터와 대전', ready: '상대는 컴퓨터({lv})입니다. 준비되면 시작!', status: 'VS BOT',
            level: '난이도', human: '👥 사람과 대전' },
        en: { vs: '🤖 vs Computer', easy: '🍼 Easy', normal: '🍬 Normal', hard: '🌶️ Hard', bot: 'BOT',
            box: "Don't want to wait? Play the computer", ready: 'Your opponent is the computer ({lv}). Press start when ready!', status: 'VS BOT',
            level: 'Level', human: '👥 Play a human' }
    };
    var lang = qs.get('lang') || localStorage.getItem('language') || (navigator.language || 'en').slice(0, 2);
    if (!S[lang]) lang = 'en';
    function t(k, r) {
        var s = S[lang][k] || S.en[k] || k;
        for (var x in (r || {})) s = s.split('{' + x + '}').join(r[x]);
        return s;
    }

    function gameFolder() {
        var m = location.pathname.match(/\/([a-z]+)\/(?:index\.html)?$/);
        return m ? m[1] : '';
    }
    function randRoom() { return Math.random().toString(36).slice(2, 9); }
    function botUrl(lv) {
        var u = new URL(location.href);
        u.searchParams.delete('opponent');
        u.searchParams.set('bot', lv);
        u.hash = 'bot-' + randRoom();
        return u.toString();
    }
    function humanUrl() {
        if (lobbyPath) {
            var l = new URL(lobbyPath, location.href);
            l.searchParams.set('g', gameFolder());
            return l.toString();
        }
        // No lobby: a fresh shareable room of this game.
        var u = new URL(location.href);
        u.searchParams.delete('bot');
        u.hash = 'room-' + randRoom();
        return u.toString();
    }

    function LocalSession(opts) {
        this.opts = opts;
        this.role = 'host';
        this.roomId = location.hash ? location.hash.substring(1) : '';
        var self = this;
        setTimeout(function () {
            if (opts.onSignalingStatus) opts.onSignalingStatus('open');
            if (opts.onRole) opts.onRole('host');
            if (opts.onChannelOpen) opts.onChannelOpen();
            if (opts.onPeerConnected) opts.onPeerConnected();
            decorateBotMode();
            self.ready = true;
        }, 0);
    }
    LocalSession.prototype.send = function () {};
    LocalSession.prototype.destroy = function () {};
    Object.defineProperty(LocalSession.prototype, 'isHost', { get: function () { return true; } });

    var current = null;

    var GameBot = {
        LEVELS: LEVELS,
        level: level,
        enabled: !!level,
        /** Real GameSession normally; a local fake opponent session in bot mode. */
        session: function (opts) {
            current = level ? new LocalSession(opts) : new GameSession(opts);
            return current;
        },
        /** Feed a message to the game as if the remote client had sent it. */
        deliver: function (msg) {
            if (current && current.opts && current.opts.onMessage) current.opts.onMessage(msg);
        },
        /** Pick a per-difficulty value: GameBot.pick({easy:1, normal:2, hard:3}) */
        pick: function (map) { return map[level || 'normal']; },
        /** Test/debug hook: window.__bot.state() etc. */
        expose: function (api) {
            window.__bot = Object.assign({ level: level, enabled: !!level }, api);
        },
        t: t,
        botUrl: botUrl,
        humanUrl: humanUrl
    };
    window.GameBot = GameBot;

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------
    var CSS =
        '.gb-box{margin:14px auto 0;padding:12px 10px;border:1px dashed rgba(148,163,184,.45);border-radius:14px;max-width:420px;text-align:center}' +
        '.gb-box .gb-t{font-size:13px;opacity:.85;margin-bottom:8px}' +
        '.gb-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}' +
        '.gb-row .btn{padding:8px 12px;font-size:13px;min-width:0}' +
        '.gb-row .btn.gb-on{outline:2px solid #fbbf24;outline-offset:1px}' +
        '.gb-bar{margin-top:12px;font-size:13px;opacity:.9}' +
        '.gb-bar a{color:inherit;opacity:.8}';

    function injectCss() {
        if (document.getElementById('gb-css')) return;
        var st = document.createElement('style');
        st.id = 'gb-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    function levelButtons(active) {
        var row = document.createElement('div');
        row.className = 'gb-row';
        LEVELS.forEach(function (lv) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn-secondary gb-level' + (lv === active ? ' gb-on' : '');
            b.dataset.level = lv;
            b.textContent = t(lv);
            b.addEventListener('click', function () { location.href = botUrl(lv); });
            row.appendChild(b);
        });
        return row;
    }

    function addLobbyBox() {
        var lobby = document.getElementById('lobby-screen');
        if (!lobby || lobby.querySelector('.gb-box')) return;
        injectCss();
        var box = document.createElement('div');
        box.className = 'gb-box';
        box.id = 'gb-lobby';
        var title = document.createElement('div');
        title.className = 'gb-t';
        title.textContent = '🤖 ' + t('box');
        box.appendChild(title);
        box.appendChild(levelButtons(null));
        lobby.appendChild(box);
    }

    function decorateBotMode() {
        injectCss();
        var lvName = t(level).replace(/^\S+\s/, '');
        var role = document.getElementById('role-text');
        if (role) role.textContent = t('ready', { lv: lvName });
        var h2 = document.querySelector('#ready-screen h2');
        if (h2) h2.textContent = t('vs');
        var st = document.getElementById('status-text');
        if (st) { st.textContent = t('status'); st.className = 'status-online'; }
        var ping = document.getElementById('ping-text');
        if (ping) ping.textContent = 'LOCAL';
        var p2 = document.getElementById('p2-label');
        if (p2) p2.textContent = '🤖 ' + t('bot') + ' (' + lvName + ')';

        var ready = document.getElementById('ready-screen');
        if (ready && !ready.querySelector('.gb-bar')) {
            var bar = document.createElement('div');
            bar.className = 'gb-bar';
            bar.id = 'gb-ready';
            var lab = document.createElement('div');
            lab.className = 'gb-t';
            lab.textContent = t('level');
            bar.appendChild(lab);
            bar.appendChild(levelButtons(level));
            var a = document.createElement('a');
            a.href = humanUrl();
            a.textContent = t('human');
            a.style.display = 'inline-block';
            a.style.marginTop = '10px';
            bar.appendChild(a);
            ready.appendChild(bar);
        }
        // Game-over screen: "change level" shortcut too.
        var over = document.getElementById('gameover-screen');
        if (over && !over.querySelector('.gb-row')) {
            var row = levelButtons(level);
            row.style.marginTop = '12px';
            over.appendChild(row);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!level) addLobbyBox();
        else document.title = t('vs') + ' · ' + document.title;
    });

    // ------------------------------------------------------------------
    // Small shared helpers for bot brains
    // ------------------------------------------------------------------
    GameBot.rand = function (a, b) { return a + Math.random() * (b - a); };
    GameBot.gauss = function () { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; };
    GameBot.folder = gameFolder;
})();
