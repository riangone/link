/**
 * Oni Combat i18n
 */

export const I18N = {
    zh: {
        title: '鬼神对决 · Oni Combat',
        tagline: '3D 赛博近空格斗 · 搓招、滑铲、格挡与硬直判定',
        p1_name: 'KONOKO (长谷川舞)',
        p2_name: 'SYNDI-BOT (特遣队镜像)',
        controls_title: '出招表与指令',
        ctrl_move: 'A / D (方向键 ← / →)：移动 (双击前冲)',
        ctrl_z_move: 'W / S (方向键 ↑ / ↓)：3D 轴向走位',
        ctrl_punch: 'J / Z 键：出拳 (轻刺拳 → 直拳 → 升龙)',
        ctrl_kick: 'K / X 键：踢腿 (低踢 → 回旋重踢)',
        ctrl_slide: '前冲中按 K / X：疾风滑铲 (扫堂倒地)',
        ctrl_uppercut: 'S + D + J (↓ + → + 拳)：升龙破空拳 (击飞浮空)',
        ctrl_block: 'L / C 或 后退：能量格挡',
        vs_human: '👥 真人对战',
        vs_bot: '🤖 人机对战',
        start_game: '开始对决',
        restart: '再来一局',
        back_to_lobby: '返回大厅',
        round_time: '时间',
        ko: 'K.O.',
        winner_p1: 'KONOKO 获胜！',
        winner_p2: '对手获胜！',
        draw: '平局！'
    },
    ja: {
        title: 'オニ・コンバット · Oni Combat',
        tagline: '3Dサイバー近接格闘 · コマンド技、スライディング、ガード＆ヒットストップ',
        p1_name: 'コノコ (長谷川舞)',
        p2_name: 'シンディ・ボット (TCTFミラー)',
        controls_title: 'コマンドリスト',
        ctrl_move: 'A / D (← / →)：移動 (ダッシュ：素早く2回)',
        ctrl_z_move: 'W / S (↑ / ↓)：3D軸移動',
        ctrl_punch: 'J / Z キー：パンチ (ジャブ → ストレート → アッパー)',
        ctrl_kick: 'K / X キー：キック (ローキック → 回し蹴り)',
        ctrl_slide: 'ダッシュ中に K / X：スライディング (足払い転倒)',
        ctrl_uppercut: 'S + D + J (↓ + → + P)：ライジング・アッパー (打ち上げ)',
        ctrl_block: 'L / C または 後退：ガード',
        vs_human: '👥 対人戦',
        vs_bot: '🤖 CPU戦',
        start_game: '対戦開始',
        restart: 'もう一度',
        back_to_lobby: 'ロビーへ戻る',
        round_time: 'TIME',
        ko: 'K.O.',
        winner_p1: 'KONOKO の勝利！',
        winner_p2: '相手の勝利！',
        draw: '引き分け！'
    },
    en: {
        title: 'Oni Combat - 3D Cyber Strike',
        tagline: '3D Cyberpunk Melee · Combos, Slide Sweeps, Blocking & Hitstop',
        p1_name: 'KONOKO (TCTF Agent)',
        p2_name: 'SYNDI-BOT (Mirror Combatant)',
        controls_title: 'COMMAND LIST',
        ctrl_move: 'A / D (← / →): Move / Double-tap to Dash',
        ctrl_z_move: 'W / S (↑ / ↓): 3D Axis Stride',
        ctrl_punch: 'J / Z: Punch (Jab → Cross → Uppercut)',
        ctrl_kick: 'K / X: Kick (Low Kick → Spin Roundhouse)',
        ctrl_slide: 'Dash + K / X: Slide Sweep (Knockdown)',
        ctrl_uppercut: 'S + D + J (↓ + → + P): Rising Uppercut (Launch)',
        ctrl_block: 'L / C or Walk Back: Energy Guard',
        vs_human: '👥 vs Human',
        vs_bot: '🤖 vs Bot',
        start_game: 'FIGHT',
        restart: 'REMATCH',
        back_to_lobby: 'LOBBY',
        round_time: 'TIME',
        ko: 'K.O.',
        winner_p1: 'KONOKO WINS!',
        winner_p2: 'OPPONENT WINS!',
        draw: 'DRAW!'
    }
};

export function getLocale() {
    const qs = new URLSearchParams(location.search);
    const lang = qs.get('lang') || localStorage.getItem('language') || (navigator.language || 'en').slice(0, 2);
    return I18N[lang] || I18N.zh;
}
