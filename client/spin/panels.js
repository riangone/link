/**
 * Link Spin — menu panels (DOM only): rank bar, 玩法指南, 擂台 tower map,
 * 排行榜, and the reward card on the gameover screen.
 *
 * Panels open in #panel-screen inside the game overlay and hide whatever
 * overlay screen was showing; closing restores it. game.js includes
 * #panel-screen in its showScreen() list, so a phase change (e.g. the host
 * starting the match) simply replaces an open panel.
 *
 * Depends on SpinProgress (progress.js) and GameBoard (../scripts/game-board.js).
 */
(function () {
    'use strict';

    var GAME = 'spin';
    var P = window.SpinProgress;
    var t = window.SpinI18n.t;
    var TYPE_INFO = {};
    [['attack', '⚔️'], ['defense', '🛡️'], ['stamina', '🌀'], ['balance', '🔥'], ['dragon', '🐉']].forEach(function (x) {
        TYPE_INFO[x[0]] = { icon: x[1], name: t('ty_' + x[0]) };
    });
    function typeLabel(k) { return TYPE_INFO[k].icon + ' ' + TYPE_INFO[k].name; }
    /**
     * Best pick against each opponent type, from offline sims of the real
     * physics + bot (human-level play vs the hard bot): the type triangle, plus
     * stamina vs balance and defense vs dragon. Reasons: rec_vs_<opponent>.
     */
    var REC = { attack: 'defense', defense: 'stamina', stamina: 'attack', balance: 'stamina', dragon: 'defense' };

    var qs = new URLSearchParams(location.search);
    var mode = qs.get('tutorial') ? 'tutorial' : qs.get('tower') ? 'tower' : qs.get('bot') ? 'bot' : 'pvp';
    var floor = Math.max(1, Math.min(P.TOWER.length, parseInt(qs.get('tower'), 10) || 1));

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }
    function randRoom() { return Math.random().toString(36).slice(2, 9); }

    function modeUrl(m, f) {
        var u = new URL(location.href);
        ['bot', 'tower', 'tutorial', 'opponent'].forEach(function (k) { u.searchParams.delete(k); });
        if (m === 'tower') { u.searchParams.set('bot', 'hard'); u.searchParams.set('tower', String(f)); }
        if (m === 'tutorial') { u.searchParams.set('bot', 'easy'); u.searchParams.set('tutorial', '1'); }
        if (m === 'bot') u.searchParams.set('bot', f || 'normal');
        u.hash = (m === 'pvp' ? 'room-' : 'bot-') + randRoom();
        return u.toString();
    }

    // ------------------------------------------------------------------
    // Rank bar (shown on lobby / ready / gameover screens)
    // ------------------------------------------------------------------
    var bars = [];
    function rankBar() {
        var wrap = el('div', 'meta-bar');
        wrap.innerHTML =
            '<div class="rank-chip"><span class="rk-icon"></span><span class="rk-text">' +
            '<b class="rk-name"></b><span class="rk-rp"></span></span>' +
            '<span class="rk-track"><i></i></span></div>' +
            '<div class="meta-btns">' +
            '<button type="button" class="meta-btn" data-open="guide">' + t('btn_guide') + '</button>' +
            '<button type="button" class="meta-btn" data-open="tower">' + t('btn_tower') + '</button>' +
            '<button type="button" class="meta-btn" data-open="board">' + t('btn_board') + '</button>' +
            '<button type="button" class="meta-btn" data-open="garage">' + t('btn_garage') + '</button>' +
            '</div>';
        wrap.addEventListener('click', function (e) {
            var b = e.target.closest('[data-open]');
            if (b) open(b.dataset.open);
        });
        bars.push(wrap);
        refreshBars();
        return wrap;
    }
    function refreshBars() {
        var p = P.load(), tr = P.tierOf(p.rp);
        bars.forEach(function (w) {
            w.style.setProperty('--rk', tr.tier.col);
            w.querySelector('.rk-icon').textContent = tr.tier.icon;
            w.querySelector('.rk-name').textContent = tr.tier.name;
            w.querySelector('.rk-rp').textContent = p.rp + ' RP' + (tr.next ? ' / ' + tr.next.min : '');
            w.querySelector('.rk-track i').style.width = Math.round(tr.frac * 100) + '%';
            var g = w.querySelector('[data-open="guide"]');
            g.classList.toggle('glow', !p.tut);
            g.textContent = p.tut ? t('btn_guide') : t('btn_tut');
        });
    }

    // ------------------------------------------------------------------
    // Panel host
    // ------------------------------------------------------------------
    var screen = null, body = null, prev = null;
    function ensureScreen() {
        if (screen) return;
        screen = el('div', 'overlay-content hidden panel-screen');
        screen.id = 'panel-screen';
        screen.innerHTML = '<div class="panel-head"><h2 class="panel-title"></h2>' +
            '<button type="button" class="panel-close" aria-label="close">✕</button></div><div class="panel-body"></div>';
        body = screen.querySelector('.panel-body');
        screen.querySelector('.panel-close').addEventListener('click', close);
        document.getElementById('overlay').appendChild(screen);
    }
    var PANELS = {};
    /** Other files add panels here (garage.js → 'garage'). fn(body, arg) fills the body. */
    function register(name, fn) { PANELS[name] = fn; }
    function open(which, arg) {
        ensureScreen();
        var overlay = document.getElementById('overlay');
        if (screen.classList.contains('hidden')) {
            prev = Array.prototype.find.call(overlay.children, function (c) {
                return c !== screen && c.classList.contains('overlay-content') && !c.classList.contains('hidden');
            }) || null;
        }
        Array.prototype.forEach.call(overlay.children, function (c) {
            if (c.classList.contains('overlay-content')) c.classList.toggle('hidden', c !== screen);
        });
        overlay.classList.remove('hidden');
        body.innerHTML = '';
        body.scrollTop = 0;
        PANELS[which](body, arg);
    }
    function close() {
        if (!screen) return;
        screen.classList.add('hidden');
        if (prev) prev.classList.remove('hidden');
        prev = null;
    }
    function title(s) { screen.querySelector('.panel-title').textContent = s; }

    // ------------------------------------------------------------------
    // 玩法指南
    // ------------------------------------------------------------------
    function guidePanel() {
        title(t('g_title'));
        var p = P.load();
        var pickRows = ['attack', 'defense', 'stamina', 'balance', 'dragon'].map(function (o) {
            return '<li>' + t('g_pick_row', { opp: typeLabel(o), rec: typeLabel(REC[o]), why: t('rec_vs_' + o) }) + '</li>';
        }).join('');
        body.innerHTML =
            '<button type="button" class="btn btn-primary" id="tut-go">' + t(p.tut ? 'g_tut_again' : 'g_tut_new') + '</button>' +
            '<h4>' + t('g_ways_h') + '</h4>' +
            '<div class="win-ways">' +
            '<div class="ww ww-over"><b>OVER</b><span>' + t('pts2') + '</span><small>' + t('ww_over') + '</small></div>' +
            '<div class="ww ww-burst"><b>BURST</b><span>' + t('pts2') + '</span><small>' + t('ww_burst') + '</small></div>' +
            '<div class="ww ww-spin"><b>SPIN</b><span>' + t('pts1') + '</span><small>' + t('ww_spin') + '</small></div>' +
            '</div>' +
            '<p class="g-note">' + t('g_ws_note') + '</p>' +
            '<h4>' + t('g_pick_h') + '</h4>' +
            '<p class="g-note">' + t('g_pick_note') + '</p>' +
            '<ul class="g-list picks">' + pickRows + '</ul>' +
            '<h4>' + t('g_ctrl_h') + '</h4>' +
            '<ul class="g-list">' +
            ['g_ctrl_launch', 'g_ctrl_move', 'g_ctrl_dash', 'g_ctrl_spec', 'g_ctrl_rail'].map(function (k) { return '<li>' + t(k) + '</li>'; }).join('') +
            '</ul>' +
            '<h4>' + t('g_tri_h') + '</h4>' +
            '<div class="tri">' + t('g_tri') + '</div>' +
            '<h4>' + t('g_spec_h') + '</h4>' +
            '<ul class="g-list">' +
            ['attack', 'defense', 'stamina', 'balance', 'dragon'].map(function (k) { return '<li>' + t('spec_' + k) + '</li>'; }).join('') +
            '</ul>' +
            '<h4>' + t('g_tips_h') + '</h4>' +
            '<ul class="g-list tips">' +
            ['tip1', 'tip2', 'tip3', 'tip4', 'tip5'].map(function (k) { return '<li>' + t(k) + '</li>'; }).join('') +
            '</ul>';
        body.querySelector('#tut-go').addEventListener('click', function () { location.href = modeUrl('tutorial'); });
    }

    // ------------------------------------------------------------------
    // 擂台 tower
    // ------------------------------------------------------------------
    function towerPanel() {
        title(t('t_title'));
        var p = P.load(), max = P.maxFloor();
        var list = el('div', 'tower');
        list.appendChild(el('p', 'g-note', t('t_note')));
        for (var i = P.TOWER.length - 1; i >= 0; i--) {
            var f = P.TOWER[i], n = i + 1;
            var state = n <= p.tw ? 'cleared' : n === max ? 'current' : n < max ? 'cleared' : 'locked';
            var ti = TYPE_INFO[f.type];
            var row = el('button', 'floor ' + state);
            row.type = 'button';
            row.disabled = state === 'locked';
            row.innerHTML = '<span class="fl-n">' + n + 'F</span>' +
                '<span class="fl-who"><b>' + (state === 'locked' ? '???' : esc(f.name)) + '</b>' +
                '<small>' + (state === 'locked' ? t('t_locked') : t('t_type', { icon: ti.icon, type: ti.name, title: f.title })) + '</small></span>' +
                '<span class="fl-st">' + (state === 'cleared' ? '✅' : state === 'current' ? t('t_go') : '🔒') + '</span>';
            row.dataset.floor = String(n);
            row.addEventListener('click', function () { location.href = modeUrl('tower', this.dataset.floor); });
            list.appendChild(row);
        }
        body.appendChild(list);
    }

    // ------------------------------------------------------------------
    // 排行榜
    // ------------------------------------------------------------------
    function defaultName() {
        return P.playerName() || ('Blader-' + GameBoard.pid().slice(0, 4).toUpperCase());
    }
    function boardPanel() {
        title(t('b_title'));
        var me = P.load();
        var nameRow = el('form', 'lb-name');
        nameRow.innerHTML = '<label>' + t('b_name') + '</label><input maxlength="16" required>' +
            '<button class="btn btn-secondary" type="submit">' + t('b_save') + '</button>';
        var input = nameRow.querySelector('input');
        input.value = defaultName();
        nameRow.addEventListener('submit', function (e) {
            e.preventDefault();
            P.setName(input.value);
            sync().then(load);
        });
        body.appendChild(nameRow);
        var mt = P.tierOf(me.rp).tier;
        body.appendChild(el('p', 'g-note', t('b_me', { tier: mt.icon + ' ' + mt.name, rp: me.rp, w: me.w, l: me.l, tw: me.tw })));
        var table = el('div', 'lb-table', '<div class="lb-msg">' + t('b_loading') + '</div>');
        body.appendChild(table);

        function load() {
            GameBoard.get(GAME).then(function (res) {
                var rows = res.top.slice();
                if (res.me) rows.push(null, res.me);
                if (!rows.length) { table.innerHTML = '<div class="lb-msg">' + t('b_empty') + '</div>'; return; }
                table.innerHTML = rows.map(function (r) {
                    if (!r) return '<div class="lb-gap">⋯</div>';
                    var tt = P.tierOf(r.rp).tier;
                    var medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '#' + r.rank;
                    return '<div class="lb-row' + (r.me ? ' me' : '') + '"><span class="lb-rk">' + medal + '</span>' +
                        '<span class="lb-nm">' + esc(r.name) + (r.me ? ' <em>' + t('b_me_tag') + '</em>' : '') + '</span>' +
                        '<span class="lb-tier" style="color:' + tt.col + '">' + tt.icon + ' ' + tt.name + '</span>' +
                        '<span class="lb-rp">' + r.rp + '<small>RP</small></span>' +
                        '<span class="lb-tw">' + r.tw + 'F</span></div>';
                }).join('') + '<div class="lb-foot">' + t('b_foot', { n: res.total }) + '</div>';
            }).catch(function () {
                table.innerHTML = '<div class="lb-msg">' + t('b_err') + '</div>';
            });
        }
        sync().then(load);
    }

    /** Push the local profile to the board (fire and forget). */
    function sync() {
        var p = P.load();
        if (!p.rp && !p.w && !p.l) return Promise.resolve();
        return GameBoard.submit(GAME, { name: defaultName(), rp: p.rp, tw: p.tw, w: p.w, l: p.l })
            .catch(function () { /* offline: next match will retry */ });
    }

    // ------------------------------------------------------------------
    // Gameover reward card
    // ------------------------------------------------------------------
    function rewards(container, res) {
        container.innerHTML = '';
        if (!res) return;
        var card = el('div', 'reward');
        var a = res.after;
        var html = '<div class="rw-gain ' + (res.gain >= 0 ? 'up' : 'down') + '">' + (res.gain >= 0 ? '+' : '') + res.gain + ' RP</div>';
        html += '<div class="rw-lines">' + res.lines.map(function (l) {
            return '<span>' + esc(l[0]) + '</span><b>' + (l[1] >= 0 ? '+' : '') + l[1] + '</b>';
        }).join('') + '</div>';
        if (res.rankUp) html += '<div class="rw-rank">' + t('rw_up', { t: a.tier.icon + ' ' + a.tier.name }) + '</div>';
        if (res.rankDown) html += '<div class="rw-rank down">' + t('rw_down', { t: a.tier.icon + ' ' + a.tier.name }) + '</div>';
        if (res.unlocked === 'dragon') html += '<div class="rw-rank unlock">' + t('rw_unlock') + '</div>';
        html += '<div class="rw-bar" style="--rk:' + a.tier.col + '"><i style="width:' + Math.round(a.frac * 100) + '%"></i></div>' +
            '<div class="rw-next">' + (a.next ? t('rw_next', { t: a.next.icon + ' ' + a.next.name, n: a.next.min - res.profile.rp }) : t('rw_max')) + '</div>';
        card.innerHTML = html;
        container.appendChild(card);
        refreshBars();
        sync();
    }

    PANELS.guide = guidePanel;
    PANELS.tower = towerPanel;
    PANELS.board = boardPanel;
    /** Is the panel screen showing (garage.js stops its preview loop when not)? */
    function isOpen() { return !!screen && !screen.classList.contains('hidden'); }

    window.SpinPanels = {
        register: register,
        isOpen: isOpen,
        setTitle: function (s) { ensureScreen(); title(s); },
        esc: esc,
        mode: mode,
        floor: floor,
        modeUrl: modeUrl,
        rankBar: rankBar,
        refresh: refreshBars,
        open: open,
        close: close,
        rewards: rewards,
        sync: sync,
        typeInfo: TYPE_INFO,
        typeLabel: typeLabel,
        REC: REC
    };
})();
