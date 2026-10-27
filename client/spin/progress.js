/**
 * Link Spin — progression (local profile, ranks, the 擂台 tower).
 *
 * Pure data + rules, no DOM: game.js reports each finished match through
 * SpinProgress.record(), panels.js renders what's here.
 *
 * Profile (localStorage 'spin-profile'):
 *   rp      rank points: drive the rank tier and the leaderboard position
 *   w / l   matches won / lost (all modes except the tutorial)
 *   tw      highest tower floor cleared (0..TOWER.length)
 *   tut     tutorial finished
 *   bursts / overs / perfects   lifetime highlight counters
 *
 * RP rules (kept deliberately simple so the gameover screen can explain them):
 *   win vs bot  easy +10 · normal +20 · hard +35
 *   win online  +30          loss online −10 (RP never below 0; you can drop a tier)
 *   tower floor first clear  +40 + 10 × floor;  re-clear +10
 *   any loss vs bot / tower  +2 (you still practised)
 *   bonuses: each BURST finish you land +3 · each PERFECT launch +1
 *   tutorial (first time) +50
 */
(function () {
    'use strict';

    var KEY = 'spin-profile';
    var t = window.SpinI18n.t;

    var TIERS = [
        { min: 0, name: t('tier_0'), en: 'ROOKIE', icon: '🔰', col: '#9aa4c7' },
        { min: 100, name: t('tier_1'), en: 'BRONZE', icon: '🥉', col: '#d08a52' },
        { min: 300, name: t('tier_2'), en: 'SILVER', icon: '🥈', col: '#c9d4e8' },
        { min: 600, name: t('tier_3'), en: 'GOLD', icon: '🥇', col: '#ffd34d' },
        { min: 1000, name: t('tier_4'), en: 'PLATINUM', icon: '💠', col: '#7fffe0' },
        { min: 1600, name: t('tier_5'), en: 'DIAMOND', icon: '💎', col: '#62b8ff' },
        { min: 2400, name: t('tier_6'), en: 'MASTER', icon: '👑', col: '#ff6ad5' },
        { min: 3500, name: t('tier_7'), en: 'LEGEND', icon: '🐉', col: '#b07bff' }
    ];

    /**
     * The 擂台 (tower): beat each champion to unlock the next floor.
     * ai: bot brain tuning (see BOT in game.js) · buff: champion's stat
     * multiplier · ws: points to win · tip: how to beat them (shown on the
     * floor card — this is where players learn matchups) · parts: the
     * champion's custom build (改装 ideas for the player; sims show each
     * floor's best-pick win rate stays within noise of the stock champion).
     */
    var TOWER = [
        { name: t('tw1_name'), title: 'ROOKIE TOP', type: 'stamina', buff: 0.85, ws: 3,
            ai: { react: 20, noise: 0.6, dashP: 0.008, lock: [0.35, 0.7], specDelay: 200 },
            tip: t('tw1_tip') },
        { name: t('tw2_name'), title: 'IRON GUARD', type: 'defense', buff: 0.95, ws: 3,
            ai: { react: 14, noise: 0.45, dashP: 0.015, lock: [0.5, 0.85], specDelay: 120 },
            tip: t('tw2_tip') },
        { name: t('tw3_name'), title: 'GALE RUNNER', type: 'stamina', buff: 1.0, ws: 3,
            ai: { react: 10, noise: 0.32, dashP: 0.02, lock: [0.7, 0.95], specDelay: 60 },
            tip: t('tw3_tip'), parts: { ring: 'wide', tip: 'ball' } },
        { name: t('tw4_name'), title: 'HUNTER', type: 'attack', buff: 1.0, ws: 4,
            ai: { react: 8, noise: 0.26, dashP: 0.05, lock: [0.75, 0.97], specDelay: 40 },
            tip: t('tw4_tip'), parts: { ring: 'spike', tip: 'rubber' } },
        { name: t('tw5_name'), title: 'PHOENIX', type: 'balance', buff: 1.05, ws: 4,
            ai: { react: 6, noise: 0.2, dashP: 0.07, lock: [0.8, 0.98], specDelay: 25 },
            tip: t('tw5_tip'), parts: { ring: 'fang', disk: 'heavy' } },
        { name: t('tw6_name'), title: 'FORTRESS KING', type: 'defense', buff: 1.12, ws: 4,
            ai: { react: 5, noise: 0.14, dashP: 0.08, lock: [0.85, 1.0], specDelay: 12 },
            tip: t('tw6_tip'), parts: { ring: 'guard', disk: 'heavy', tip: 'ball' } },
        { name: t('tw7_name'), title: 'STORM LORD', type: 'attack', buff: 1.18, ws: 4,
            ai: { react: 3, noise: 0.08, dashP: 0.12, lock: [0.9, 1.0], specDelay: 5 },
            tip: t('tw7_tip'), parts: { ring: 'fang', tip: 'jet' } },
        { name: t('tw8_name'), title: 'DRAGON EMPEROR', type: 'dragon', buff: 1.1, ws: 4,
            ai: { react: 2, noise: 0.05, dashP: 0.14, lock: [0.93, 1.0], specDelay: 3 },
            tip: t('tw8_tip'), parts: { ring: 'spike', disk: 'swirl' } }
    ];

    TOWER.forEach(function (f) { f.cfg = Object.assign({ core: f.type }, f.parts || {}); });

    var BOT_WIN = { easy: 10, normal: 20, hard: 35 };

    function blank() {
        return { rp: 0, w: 0, l: 0, tw: 0, tut: false, bursts: 0, overs: 0, perfects: 0, name: '' };
    }
    function load() {
        try {
            var p = JSON.parse(localStorage.getItem(KEY));
            if (p && typeof p === 'object') return Object.assign(blank(), p);
        } catch (e) { /* corrupt → fresh */ }
        return blank();
    }
    function save(p) { localStorage.setItem(KEY, JSON.stringify(p)); }

    function tierOf(rp) {
        var i = 0;
        while (i + 1 < TIERS.length && rp >= TIERS[i + 1].min) i++;
        var t = TIERS[i], next = TIERS[i + 1] || null;
        return {
            idx: i, tier: t, next: next,
            frac: next ? (rp - t.min) / (next.min - t.min) : 1
        };
    }

    /**
     * Record a finished match and return what changed, for the gameover screen.
     * @param {{mode:'bot'|'tower'|'pvp'|'tutorial', level?:string, floor?:number,
     *          won:boolean, bursts?:number, overs?:number, perfects?:number}} r
     */
    function record(r) {
        var p = load();
        var before = tierOf(p.rp);
        var lines = [];
        var gain = 0;
        var unlocked = null;

        if (r.mode === 'tutorial') {
            if (!p.tut) { gain += 50; lines.push([t('rl_tut'), 50]); }
            p.tut = true;
        } else {
            if (r.won) p.w++; else p.l++;
            if (r.mode === 'pvp') {
                if (r.won) { gain += 30; lines.push([t('rl_pvp_w'), 30]); }
                else { gain -= 10; lines.push([t('rl_pvp_l'), -10]); }
            } else if (r.mode === 'tower') {
                var f = r.floor;
                if (r.won) {
                    if (f > p.tw) {
                        var g = 40 + 10 * f;
                        gain += g; lines.push([t('rl_tw_first', { f: f }), g]);
                        p.tw = f;
                        if (f === TOWER.length) unlocked = 'dragon';
                    } else { gain += 10; lines.push([t('rl_tw_again', { f: f }), 10]); }
                } else { gain += 2; lines.push([t('rl_tw_fail'), 2]); }
            } else {
                if (r.won) { var b = BOT_WIN[r.level] || 20; gain += b; lines.push([t('rl_bot_w', { lv: t('lv_' + (r.level || 'normal')) }), b]); }
                else { gain += 2; lines.push([t('rl_bot_l'), 2]); }
            }
            if (r.bursts) { gain += 3 * r.bursts; lines.push([t('rl_burst', { n: r.bursts }), 3 * r.bursts]); }
            if (r.perfects) { gain += r.perfects; lines.push([t('rl_perfect', { n: r.perfects }), r.perfects]); }
            p.bursts += r.bursts || 0;
            p.overs += r.overs || 0;
            p.perfects += r.perfects || 0;
        }
        p.rp = Math.max(0, p.rp + gain);
        save(p);
        var after = tierOf(p.rp);
        return {
            gain: gain, lines: lines, profile: p, before: before, after: after,
            rankUp: after.idx > before.idx, rankDown: after.idx < before.idx, unlocked: unlocked
        };
    }

    window.SpinProgress = {
        TIERS: TIERS,
        TOWER: TOWER,
        load: load,
        save: save,
        tierOf: tierOf,
        record: record,
        /** Highest floor the player may enter (1-based). */
        maxFloor: function () { return Math.min(TOWER.length, load().tw + 1); },
        dragonUnlocked: function () { return load().tw >= TOWER.length; },
        playerName: function () {
            var p = load();
            return p.name || localStorage.getItem('custom-nickname') || '';
        },
        setName: function (n) { var p = load(); p.name = String(n || '').trim().slice(0, 16); save(p); return p.name; }
    };
})();
