/**
 * Link Spin — 改装工坊 (garage): edit the saved build of each core.
 *
 * Opens as a SpinPanels panel ('garage', arg {core}). Every change is saved
 * at once (SpinParts.saveBuild) and reported through onSave so game.js can
 * rebuild the picker and re-send its pick. Drawing comes from game.js via
 * SpinGarage.init({ drawBey, built, dragonOk, onSave }).
 *
 * What a kid should get from this screen in 5 seconds:
 *   - the big spinning preview changes when a part changes,
 *   - every part card says one good thing (✓) and one bad thing (✗),
 *   - the ⚡ energy pips say why a part can't be added right now.
 */
(function () {
    'use strict';

    var t = window.SpinI18n.t;
    var SP = window.SpinParts;
    var P = window.SpinProgress;
    var Panels = window.SpinPanels;
    var esc = Panels.esc;
    var hooks = null;
    var ICON = { attack: '⚔️', defense: '🛡️', stamina: '🌀', balance: '🔥', dragon: '🐉' };

    function partName(slot, p) { return p.id === 'std' ? t('p_std_n') : t('part_' + slot + '_' + p.id); }
    /** "到 🥉青铜 或 打通擂台 2F" */
    function unlockText(p) {
        var u = p.unlock, out = [];
        if (u.rp != null) {
            var tier = P.TIERS.filter(function (x) { return x.min === u.rp; })[0];
            out.push(t('ul_rp', { tier: tier ? tier.icon + ' ' + tier.name : u.rp + ' RP' }));
        }
        if (u.tw != null) out.push(t('ul_tw', { n: u.tw }));
        if (u.bursts != null) out.push(t('ul_burst', { n: u.bursts }));
        return out.join(t('ul_or'));
    }

    function panel(body, arg) {
        Panels.setTitle(t('gar_title'));
        var prof = P.load();
        var core = arg && SP.isCore(arg.core) ? arg.core : (localStorage.getItem('spin-pick') || 'attack');
        if (!SP.isCore(core) || (core === 'dragon' && !hooks.dragonOk())) core = 'attack';
        var cfg = SP.buildFor(core);
        var msgTimer = 0;

        body.innerHTML =
            '<p class="g-note">' + t('gar_intro') + '</p>' +
            '<div class="gar-cores"></div>' +
            '<div class="gar-head">' +
            '<canvas class="gar-prev" width="150" height="150"></canvas>' +
            '<div class="gar-info"><div class="gar-name"></div><div class="gar-type"></div>' +
            '<div class="gar-energy"></div><div class="gar-bars"></div></div>' +
            '</div>' +
            '<div class="gar-msg" aria-live="polite"></div>' +
            '<div class="gar-slots"></div>' +
            '<h4>' + t('gar_look_h') + '</h4>' +
            '<div class="gar-cols"></div>' +
            '<label class="gar-nick"><span>' + t('gar_name') + '</span><input maxlength="' + SP.NAME_MAX + '" placeholder="' + esc(t('gar_name_ph')) + '"></label>' +
            '<div class="gar-actions"><button type="button" class="btn btn-secondary gar-reset">' + t('gar_reset') + '</button>' +
            '<button type="button" class="btn btn-primary gar-done">' + t('gar_done') + '</button></div>';
        var $ = function (sel) { return body.querySelector(sel); };
        var cv = $('.gar-prev'), nick = $('.gar-nick input');

        function say(html, cls) {
            var m = $('.gar-msg');
            m.innerHTML = html;
            m.className = 'gar-msg show ' + (cls || '');
            clearTimeout(msgTimer);
            msgTimer = setTimeout(function () { m.className = 'gar-msg'; }, 2600);
        }
        function save() {
            cfg = SP.saveBuild(cfg);
            hooks.onSave(cfg);
        }

        function renderCores() {
            $('.gar-cores').innerHTML = SP.CORE_IDS.map(function (c) {
                var locked = c === 'dragon' && !hooks.dragonOk();
                return '<button type="button" class="gar-core' + (c === core ? ' on' : '') + (locked ? ' locked' : '') +
                    '" data-core="' + c + '"' + (locked ? ' title="' + esc(t('gar_dragon_locked')) + '"' : '') + '>' +
                    (locked ? '🔒' : ICON[c]) + '<small>' + (locked ? '???' : SP.CORES[c].short) + '</small></button>';
            }).join('');
        }
        function renderHead() {
            var b = hooks.built(cfg), base = hooks.built(SP.defaultCfg(core));
            $('.gar-name').textContent = b.nick || b.name;
            $('.gar-type').innerHTML = ICON[core] + ' ' + esc(t('ty_' + core)) + ' · ' + b.spec;
            var used = SP.cost(cfg), pips = '';
            for (var i = 0; i < SP.CAP; i++) pips += '<i class="' + (i < used ? 'on' : '') + '"></i>';
            $('.gar-energy').innerHTML = '<span>' + t('gar_energy') + '</span><span class="pips">' + pips + '</span><b>' + used + '/' + SP.CAP + '</b>';
            $('.gar-energy').title = t('gar_energy_note', { cap: SP.CAP });
            var nb = SP.bars(b), ob = SP.bars(base);
            $('.gar-bars').innerHTML = nb.map(function (v, i) {
                var d = v - ob[i], arrow = d > 0.15 ? '<em class="up">▲</em>' : d < -0.15 ? '<em class="down">▼</em>' : '<em></em>';
                return '<div class="gb"><span>' + t('bar_' + i) + '</span><span class="gb-track">' +
                    '<i class="gb-base" style="width:' + Math.round(ob[i] / 6 * 100) + '%"></i>' +
                    '<i class="gb-now" style="width:' + Math.round(v / 6 * 100) + '%;background:' + b.c1 + '"></i></span>' + arrow + '</div>';
            }).join('');
        }
        function renderSlots() {
            var used = SP.cost(cfg);
            $('.gar-slots').innerHTML = SP.SLOTS.map(function (slot) {
                var cards = SP.PARTS[slot].map(function (p) {
                    var on = cfg[slot] === p.id;
                    var ok = SP.unlocked(p, prof);
                    var cur = SP.find(slot, cfg[slot]).cost;
                    var tooMuch = !on && ok && used - cur + p.cost > SP.CAP;
                    var cost = '';
                    for (var i = 0; i < p.cost; i++) cost += '⚡';
                    var desc = p.id === 'std'
                        ? '<span class="pg">' + t('p_std_g') + '</span>'
                        : '<span class="pg">✓ ' + t('part_' + slot + '_' + p.id + '_g') + '</span><span class="pb">✗ ' + t('part_' + slot + '_' + p.id + '_b') + '</span>';
                    return '<button type="button" class="gp' + (on ? ' on' : '') + (ok ? '' : ' locked') + (tooMuch ? ' heavy' : '') +
                        '" data-slot="' + slot + '" data-id="' + p.id + '">' +
                        '<span class="gp-top"><span class="gp-ic">' + (ok ? p.icon : '🔒') + '</span><b>' + partName(slot, p) + '</b>' +
                        '<span class="gp-cost">' + (cost || t('gar_free')) + '</span></span>' +
                        (ok ? desc : '<span class="pl">' + t('gar_locked', { how: unlockText(p) }) + '</span>') +
                        '</button>';
                }).join('');
                return '<h4>' + t('slot_' + slot) + ' <small>' + t('slot_' + slot + '_note') + '</small></h4><div class="gar-parts">' + cards + '</div>';
            }).join('');
        }
        function renderCols() {
            var sw = '<button type="button" class="gc' + (cfg.col < 0 ? ' on' : '') + '" data-col="-1" title="' + esc(t('gar_col_default')) + '" style="--a:' + SP.CORES[core].c1 + ';--b:' + SP.CORES[core].c2 + '"></button>';
            SP.COLORS.forEach(function (c, i) {
                sw += '<button type="button" class="gc' + (cfg.col === i ? ' on' : '') + '" data-col="' + i + '" style="--a:' + c[0] + ';--b:' + c[1] + '"></button>';
            });
            $('.gar-cols').innerHTML = sw;
        }
        function renderAll() {
            renderCores(); renderHead(); renderSlots(); renderCols();
            nick.value = cfg.name;
        }

        body.addEventListener('click', function (e) {
            var c = e.target.closest('.gar-core');
            if (c) {
                if (c.classList.contains('locked')) { say(t('gar_dragon_locked'), 'warn'); return; }
                core = c.dataset.core;
                cfg = SP.buildFor(core);
                hooks.onSave(cfg);              // picking a core here also picks it in the picker
                renderAll();
                return;
            }
            var gp = e.target.closest('.gp');
            if (gp) {
                var slot = gp.dataset.slot, p = SP.find(slot, gp.dataset.id);
                if (!SP.unlocked(p, prof)) { say(t('gar_locked', { how: unlockText(p) }), 'warn'); return; }
                if (cfg[slot] === p.id) return;
                var next = Object.assign({}, cfg);
                next[slot] = p.id;
                if (SP.cost(next) > SP.CAP) { say(t('gar_over'), 'warn'); gp.classList.add('shake'); setTimeout(function () { gp.classList.remove('shake'); }, 400); return; }
                cfg = next;
                save();
                renderHead(); renderSlots();
                spinKick = 1;
                say(t('gar_saved'), 'good');
                return;
            }
            var gc = e.target.closest('.gc');
            if (gc) {
                cfg.col = Number(gc.dataset.col);
                save(); renderHead(); renderCols();
                return;
            }
            if (e.target.closest('.gar-reset')) {
                cfg = SP.defaultCfg(core);
                save(); renderAll();
                say(t('gar_saved'), 'good');
                return;
            }
            if (e.target.closest('.gar-done')) Panels.close();
        });
        nick.addEventListener('change', function () {
            cfg.name = nick.value;
            save();
            nick.value = cfg.name;
            renderHead();
        });

        // spinning preview while the panel is open
        var ang = 0, spinKick = 0, last = performance.now();
        function frame(now) {
            if (!Panels.isOpen() || !cv.isConnected) return;
            var dt = Math.min(3, (now - last) / 16.7);
            last = now;
            spinKick = Math.max(0, spinKick - 0.02 * dt);
            ang += (0.35 + spinKick * 0.6) * dt;
            var g = cv.getContext('2d'), b = hooks.built(cfg);
            var s = 75 / (b.r * 1.5);
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, cv.width, cv.height);
            g.setTransform(s, 0, 0, s, 0, 0);
            hooks.drawBey(g, 75 / s, 75 / s, b, ang, { spin: 100, live: true, t: now / 16.7, scale: 1, aura: spinKick > 0.2 });
            requestAnimationFrame(frame);
        }
        renderAll();
        requestAnimationFrame(frame);
    }

    Panels.register('garage', panel);
    window.SpinGarage = {
        init: function (h) { hooks = h; }
    };
})();
