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
    var TYPE_INFO = {
        attack: { icon: '⚔️', name: '攻击' }, defense: { icon: '🛡️', name: '防御' },
        stamina: { icon: '🌀', name: '持久' }, balance: { icon: '🔥', name: '平衡' }, dragon: { icon: '🐉', name: '龙王' }
    };

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
            '<button type="button" class="meta-btn" data-open="guide">📖 玩法</button>' +
            '<button type="button" class="meta-btn" data-open="tower">🏯 擂台</button>' +
            '<button type="button" class="meta-btn" data-open="board">🏆 排行</button>' +
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
        var p = P.load(), t = P.tierOf(p.rp);
        bars.forEach(function (w) {
            w.style.setProperty('--rk', t.tier.col);
            w.querySelector('.rk-icon').textContent = t.tier.icon;
            w.querySelector('.rk-name').textContent = t.tier.name + ' ' + t.tier.en;
            w.querySelector('.rk-rp').textContent = p.rp + ' RP' + (t.next ? ' / ' + t.next.min : '');
            w.querySelector('.rk-track i').style.width = Math.round(t.frac * 100) + '%';
            var g = w.querySelector('[data-open="guide"]');
            g.classList.toggle('glow', !p.tut);
            g.textContent = p.tut ? '📖 玩法' : '📖 新手教学';
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
    function open(which) {
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
        ({ guide: guidePanel, tower: towerPanel, board: boardPanel })[which]();
    }
    function close() {
        if (!screen) return;
        screen.classList.add('hidden');
        if (prev) prev.classList.remove('hidden');
        prev = null;
    }
    function title(t) { screen.querySelector('.panel-title').textContent = t; }

    // ------------------------------------------------------------------
    // 玩法指南
    // ------------------------------------------------------------------
    function guidePanel() {
        title('HOW TO WIN');
        var p = P.load();
        body.innerHTML =
            '<button type="button" class="btn btn-primary" id="tut-go">▶ ' + (p.tut ? '重玩' : '开始') + '互动教学（1 分钟）</button>' +
            '<h4>三种胜利方式</h4>' +
            '<div class="win-ways">' +
            '<div class="ww ww-over"><b>OVER</b><span>+2 分</span><small>把对手撞出左右两个<b>红色缺口</b></small></div>' +
            '<div class="ww ww-burst"><b>BURST</b><span>+2 分</span><small>连续重击，打满对手的<b>爆裂槽</b></small></div>' +
            '<div class="ww ww-spin"><b>SPIN</b><span>+1 分</span><small>对手<b>先停转</b>，你还在转</small></div>' +
            '</div>' +
            '<p class="g-note">先拿到 4 分的一方赢下整场（擂台前三层 3 分）。</p>' +
            '<h4>操作</h4>' +
            '<ul class="g-list">' +
            '<li><b>发射</b>：3-2-1 倒数时按 <kbd>SPACE</kbd> / 点屏幕锁定力量条。<b>金色区 = PERFECT</b>，开局转速满格。</li>' +
            '<li><b>移动</b>：<kbd>WASD</kbd> / 方向键 / 按住鼠标 / 左下摇杆。陀螺有惯性，提前转向。</li>' +
            '<li><b>冲撞</b>：<kbd>SPACE</kbd> / 💥。朝<b>白色箭头</b>方向猛冲（没推摇杆就自动瞄准对手）。耗 5 转速，冷却约 1.7 秒。</li>' +
            '<li><b>必杀</b>：<kbd>E</kbd> / ⚡。撞击会充能，能量条满了才能用，持续 3 秒。</li>' +
            '</ul>' +
            '<h4>类型克制（伤害 ×1.2）</h4>' +
            '<div class="tri">⚔️ 攻击 <i>克</i> 🌀 持久 <i>克</i> 🛡️ 防御 <i>克</i> ⚔️ 攻击<br><small>🔥 平衡型不克也不被克，适合新手</small></div>' +
            '<h4>必杀技</h4>' +
            '<ul class="g-list">' +
            '<li>⚔️ <b>METEOR RUSH</b>：加速并自动追踪对手，伤害 ×1.8</li>' +
            '<li>🛡️ <b>AEGIS WALL</b>：质量 ×3、免疫爆裂，并清掉一截爆裂槽</li>' +
            '<li>🌀 <b>ETERNAL GALE</b>：转速不降反升——拖时间神技</li>' +
            '<li>🔥 <b>RISING FLARE</b>：回复转速、降爆裂槽、伤害 ×1.4</li>' +
            '<li>🐉 <b>DRAGON STORM</b>：龙卷风把附近的对手吹向场边（通关擂台解锁）</li>' +
            '</ul>' +
            '<h4>赢的诀窍</h4>' +
            '<ul class="g-list tips">' +
            '<li>🎯 <b>站中心</b>：场地是碗形，中心最安全；离红色缺口近时会闪红光，赶紧往回拉。</li>' +
            '<li>💥 <b>侧面推</b>：从对手<b>远离缺口的一侧</b>冲撞，把它往缺口方向推。</li>' +
            '<li>🔋 <b>看转速</b>：场边弧条——粗的是转速，细的是爆裂槽（你的在下方）。冲撞和撞墙都会掉转，别乱冲。</li>' +
            '<li>💔 <b>爆裂槽 70% 以上</b>就危险了：避免正面重击，或用防御/平衡必杀清槽。</li>' +
            '<li>⏱ 45 秒后进入<b>SUDDEN DEATH</b>，转速掉得飞快——持久型最赚。</li>' +
            '</ul>';
        body.querySelector('#tut-go').addEventListener('click', function () { location.href = modeUrl('tutorial'); });
    }

    // ------------------------------------------------------------------
    // 擂台 tower
    // ------------------------------------------------------------------
    function towerPanel() {
        title('擂台 TOWER');
        var p = P.load(), max = P.maxFloor();
        var list = el('div', 'tower');
        list.appendChild(el('p', 'g-note', '击败每层擂主解锁下一层。首次突破 +RP，通关第 8 层解锁 🐉 <b>龙王陀螺</b>。'));
        for (var i = P.TOWER.length - 1; i >= 0; i--) {
            var f = P.TOWER[i], n = i + 1;
            var state = n <= p.tw ? 'cleared' : n === max ? 'current' : n < max ? 'cleared' : 'locked';
            var ti = TYPE_INFO[f.type];
            var row = el('button', 'floor ' + state);
            row.type = 'button';
            row.disabled = state === 'locked';
            row.innerHTML = '<span class="fl-n">' + n + 'F</span>' +
                '<span class="fl-who"><b>' + (state === 'locked' ? '???' : esc(f.name)) + '</b>' +
                '<small>' + (state === 'locked' ? '未解锁' : ti.icon + ' ' + ti.name + '型 · ' + f.title) + '</small></span>' +
                '<span class="fl-st">' + (state === 'cleared' ? '✅' : state === 'current' ? '⚔️ 挑战' : '🔒') + '</span>';
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
        title('排行榜 RANKING');
        var me = P.load();
        var nameRow = el('form', 'lb-name');
        nameRow.innerHTML = '<label>我的名字</label><input maxlength="16" required>' +
            '<button class="btn btn-secondary" type="submit">保存</button>';
        var input = nameRow.querySelector('input');
        input.value = defaultName();
        nameRow.addEventListener('submit', function (e) {
            e.preventDefault();
            P.setName(input.value);
            sync().then(load);
        });
        body.appendChild(nameRow);
        var t = P.tierOf(me.rp);
        body.appendChild(el('p', 'g-note', '我的战绩：' + t.tier.icon + ' ' + t.tier.name + ' · ' + me.rp + ' RP · ' +
            me.w + ' 胜 ' + me.l + ' 负 · 擂台 ' + me.tw + 'F'));
        var table = el('div', 'lb-table', '<div class="lb-msg">加载中…</div>');
        body.appendChild(table);

        function load() {
            GameBoard.get(GAME).then(function (res) {
                var rows = res.top.slice();
                if (res.me) rows.push(null, res.me);
                if (!rows.length) { table.innerHTML = '<div class="lb-msg">还没有人上榜——打一场就是第一名！</div>'; return; }
                table.innerHTML = rows.map(function (r) {
                    if (!r) return '<div class="lb-gap">⋯</div>';
                    var tt = P.tierOf(r.rp).tier;
                    var medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '#' + r.rank;
                    return '<div class="lb-row' + (r.me ? ' me' : '') + '"><span class="lb-rk">' + medal + '</span>' +
                        '<span class="lb-nm">' + esc(r.name) + (r.me ? ' <em>(我)</em>' : '') + '</span>' +
                        '<span class="lb-tier" style="color:' + tt.col + '">' + tt.icon + ' ' + tt.name + '</span>' +
                        '<span class="lb-rp">' + r.rp + '<small>RP</small></span>' +
                        '<span class="lb-tw">' + r.tw + 'F</span></div>';
                }).join('') + '<div class="lb-foot">共 ' + res.total + ' 名玩家 · 按 RP 排序</div>';
            }).catch(function () {
                table.innerHTML = '<div class="lb-msg">⚠ 连接不到排行榜服务器，稍后再试。</div>';
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
        if (res.rankUp) html += '<div class="rw-rank">▲ 段位提升：' + a.tier.icon + ' ' + a.tier.name + ' ' + a.tier.en + '</div>';
        if (res.rankDown) html += '<div class="rw-rank down">▼ 段位下降：' + a.tier.icon + ' ' + a.tier.name + '</div>';
        if (res.unlocked === 'dragon') html += '<div class="rw-rank unlock">🐉 解锁新陀螺：VOID DRAGON！</div>';
        html += '<div class="rw-bar" style="--rk:' + a.tier.col + '"><i style="width:' + Math.round(a.frac * 100) + '%"></i></div>' +
            '<div class="rw-next">' + (a.next ? '距离 ' + a.next.icon + ' ' + a.next.name + ' 还差 ' + (a.next.min - res.profile.rp) + ' RP' : '已达最高段位！') + '</div>';
        card.innerHTML = html;
        container.appendChild(card);
        refreshBars();
        sync();
    }

    window.SpinPanels = {
        mode: mode,
        floor: floor,
        modeUrl: modeUrl,
        rankBar: rankBar,
        refresh: refreshBars,
        open: open,
        close: close,
        rewards: rewards,
        sync: sync,
        typeInfo: TYPE_INFO
    };
})();
