/**
 * Link Armor — strings (zh / en / ja / ko).
 *
 * Same language rule as spin/i18n.js (?lang= → localStorage 'language' →
 * browser → en) and the same API: data-i18n="key" sets innerHTML,
 * data-i18n-title sets title. Kid-friendly wording; shout words
 * (READY, GO!, K.O.!) stay English on purpose.
 */
(function () {
    'use strict';

    var D = {};

    D.zh = {
        page_title: 'Link Armor - 装甲对决',
        lang_title: '语言', mute_title: '声音',
        p1_host: 'P1（房主）', p2_client: 'P2（客人）', p1_you: 'P1（你）', p2_opp: 'P2（对手）', p2_you: 'P2（你）',
        tagline: '开着坦克在掩体间穿梭，把对手的血条<b>打空</b>就赢一局！',
        safe: '🛡️ 放心开炮：自己的炮弹<b>永远不会</b>打到自己，也不会反弹。',
        invite_label: '邀请链接（发给朋友一起玩）',
        copy: '复制', copied: '复制好了！',
        conn_wait: '正在找对手…', conn_signal: '正在连接服务器…',
        conn_open: '连上了！等朋友打开链接加入…', conn_closed: '和服务器断开了，刷新试试',
        waiting_peer: '等待对手', waiting_for: '等待 {name}',
        ready_h2: '选择你的坦克',
        role_host: '你是<b>房主</b>：选好坦克，点开始！', role_client: '你是<b>客人</b>：选好坦克，等房主开始。',
        opp_choosing: '对手正在选坦克…', opp_picked: '对手选了：{name}',
        final_score: '比分', rematch: '再来一局', awaiting: '等房主同意…',
        lost_h2: '对手离开了', lost_p: '连接断了。', lobby_btn: '回到大厅',
        stick: '移动', btn_fire: '开火', btn_dash: '冲刺', btn_special: '必杀',
        ctrl_two: '🙌 双手', ctrl_right: '👉 单手·右', ctrl_left: '👈 单手·左', auto_fire: '自动开火 · 双击冲刺',
        k_onehand: '<b>手机单手模式</b>：点控制区角落的按钮切换双手 / 单手（右/左）。单手时自动开火，双击摇杆冲刺',
        how_h3: '怎么玩',
        k_move: '<b>WASD / 方向键</b> 移动', k_fire: '<b>空格 / J</b> 开火（炮塔自动瞄准对手）',
        k_aim: '<b>鼠标左键按住</b> 朝鼠标方向开火', k_dash: '<b>Q / K / 右键</b> 冲刺躲子弹',
        k_special: '<b>E / L / Shift</b> 必杀技（能量满了才能用）',
        k_rule: '把对手打到 0 血得 1 分，先得 {n} 分的赢。木箱能打碎，钢墙打不穿。',
        k_tri: '克制：⚡突击 → 🎯狙击 → 🛡️重装 → ⚡突击（伤害 ×1.15）',
        k_zone: '40 秒后红圈开始缩小，待在圈外会掉血。',
        status_h3: '状态', st_state: '状态', st_ping: '延迟', st_role: '身份',
        st_disconnected: '未连接', st_offline: '离线', st_p2p: '已直连', st_reconnect: '重连中…', st_spectator: '观战',
        back: '返回 LINK',
        t_rapid: '突击', t_heavy: '重装', t_sniper: '狙击', t_balance: '均衡',
        s_rapid: '必杀·狂暴：射速翻倍 + 加速', s_heavy: '必杀·护盾：受到伤害 -70%',
        s_sniper: '必杀·磁轨炮：下一发超强，穿透木箱', s_balance: '必杀·修理：回血 +40 并加速',
        adv: '克制 {x}', bar_hp: '血量', bar_spd: '速度', bar_pow: '火力',
        round_win: '你赢了这一局！', round_lose: '这局输了，下局加油！', round_draw: '同归于尽，不算分',
        zone_warn: '⚠ 红圈在缩小！', special_ready: '必杀就绪！',
        it_hp: '维修包 +35', it_en: '能量电池 +50%', it_nitro: '氮气加速', it_star: '火力强化',
        it_mg: '机枪', it_ms: '追踪导弹', it_dr: '护卫无人机', it_sh: '能量护盾',
        it_ip: '激光拦截器', it_ar: '反应装甲板', it_box: '神秘补给箱',
        opt_items: '🎁 宝物', opt_on: '开', opt_off: '关', opt_speed: '⏱ 速度',
        spd_slow: '慢速', spd_normal: '标准', spd_fast: '快速',
        garage_btn: '🔧 改装 {name}', pk_mod_title: '已装改装件',
        gar_title: '🔧 坦克改装工坊',
        gar_intro: '更换主炮、装甲和履带！每个配件都有<b>优点 ✓</b>和<b>代价 ✗</b>，预算上限 {cap} ⚡，联机完全公平。',
        gar_energy: '⚡ 预算', gar_over: '⚡ 超出预算上限！请先换下高费配件。',
        gar_saved: '改装已保存 ✓', gar_free: '免费', gar_reset: '恢复原厂', gar_done: '完成',
        gar_look_h: '🎨 涂装与呼号（不影响属性）', gar_name: '呼号', gar_name_ph: '给坦克起个名字', gar_col_default: '原厂涂装',
        slot_gun: '主炮', slot_gun_note: '射速、威力与弹速',
        slot_hull: '车体装甲', slot_hull_note: '血量、体型与移速',
        slot_track: '履带引擎', slot_track_note: '移速、转向与冲刺冷却',
        p_std_n: '原厂标准', p_std_g: '均衡无增减',
        part_gun_quick: '速射炮管', part_gun_quick_g: '装填更快', part_gun_quick_b: '单发伤害略降',
        part_gun_long: '加长狙击管', part_gun_long_g: '弹速更快、射程更稳', part_gun_long_b: '炮塔转向变慢',
        part_gun_heavy: '重型榴弹炮', part_gun_heavy_g: '单发伤害大幅提升', part_gun_heavy_b: '装填与弹速变慢',
        part_gun_twin: '双联机关炮', part_gun_twin_g: '射速大幅提升', part_gun_twin_b: '单发伤害与弹速降低',
        part_hull_light: '轻量化车体', part_hull_light_g: '移动更快、体型略小', part_hull_light_b: '血量减少',
        part_hull_plate: '加厚钢板', part_hull_plate_g: '血量增加 +20%', part_hull_plate_b: '移动略慢',
        part_hull_sloped: '倾斜装甲', part_hull_sloped_g: '血量与炮塔转速提升', part_hull_sloped_b: '主炮伤害略降',
        part_hull_fort: '重型堡垒车体', part_hull_fort_g: '血量大幅增加 +32%', part_hull_fort_b: '移动变慢、体型变大',
        part_track_grip: '高抓地履带', part_track_grip_g: '炮塔与车体转向更快', part_track_grip_b: '最高速度略降',
        part_track_turbo: '涡轮引擎', part_track_turbo_g: '移动速度 +14%', part_track_turbo_b: '血量略降',
        part_track_dash: '推进喷口', part_track_dash_g: '冲刺冷却大幅缩短', part_track_dash_b: '平跑速度略降',
        part_track_omni: '全向悬浮履带', part_track_omni_g: '移速、转向与冲刺全面提升', part_track_omni_b: '血量减少 12%'
    };

    D.en = {
        page_title: 'Link Armor - Tank Duel',
        lang_title: 'Language', mute_title: 'Sound',
        p1_host: 'P1 (host)', p2_client: 'P2 (guest)', p1_you: 'P1 (you)', p2_opp: 'P2 (rival)', p2_you: 'P2 (you)',
        tagline: 'Drive between the cover and <b>empty</b> your rival\'s health bar to win the round!',
        safe: '🛡️ Fire freely: your own shells <b>never</b> hurt you and never bounce back.',
        invite_label: 'Invite link (send it to a friend)',
        copy: 'Copy', copied: 'Copied!',
        conn_wait: 'Looking for a rival…', conn_signal: 'Connecting to the server…',
        conn_open: 'Connected! Waiting for your friend to open the link…', conn_closed: 'Lost the server. Try refreshing',
        waiting_peer: 'Waiting for rival', waiting_for: 'Waiting for {name}',
        ready_h2: 'Pick your tank',
        role_host: 'You are the <b>host</b>: pick a tank and press start!', role_client: 'You are the <b>guest</b>: pick a tank, the host starts.',
        opp_choosing: 'Rival is choosing…', opp_picked: 'Rival picked: {name}',
        final_score: 'Score', rematch: 'Rematch', awaiting: 'Waiting for the host…',
        lost_h2: 'Rival left', lost_p: 'The connection dropped.', lobby_btn: 'Back to lobby',
        stick: 'Move', btn_fire: 'Fire', btn_dash: 'Dash', btn_special: 'Special',
        ctrl_two: '🙌 Two hands', ctrl_right: '👉 One hand · R', ctrl_left: '👈 One hand · L', auto_fire: 'Auto-fire · double-tap to dash',
        k_onehand: '<b>One-hand mode (touch)</b>: tap the corner button to switch two hands / one hand (right/left). One hand = auto-fire, double-tap the stick to dash',
        how_h3: 'How to play',
        k_move: '<b>WASD / arrows</b> move', k_fire: '<b>Space / J</b> fire (turret auto-aims at the rival)',
        k_aim: '<b>Hold left mouse</b> to fire toward the cursor', k_dash: '<b>Q / K / right click</b> dash out of the way',
        k_special: '<b>E / L / Shift</b> special (when the energy bar is full)',
        k_rule: 'Knock the rival to 0 HP for a point. First to {n} wins. Crates break, steel does not.',
        k_tri: 'Counters: ⚡Blitz → 🎯Hawk → 🛡️Titan → ⚡Blitz (damage ×1.15)',
        k_zone: 'After 40 s the red ring shrinks; outside it you lose HP.',
        status_h3: 'Status', st_state: 'State', st_ping: 'Ping', st_role: 'Role',
        st_disconnected: 'Disconnected', st_offline: 'Offline', st_p2p: 'Direct link', st_reconnect: 'Reconnecting…', st_spectator: 'Spectator',
        back: 'Back to LINK',
        t_rapid: 'Assault', t_heavy: 'Heavy', t_sniper: 'Sniper', t_balance: 'Balanced',
        s_rapid: 'Special · Frenzy: double fire rate + speed', s_heavy: 'Special · Shield: take 70% less damage',
        s_sniper: 'Special · Railgun: one huge shot that pierces crates', s_balance: 'Special · Repair: +40 HP and a speed boost',
        adv: 'beats {x}', bar_hp: 'HP', bar_spd: 'Speed', bar_pow: 'Power',
        round_win: 'You won this round!', round_lose: 'Round lost — get the next one!', round_draw: 'Double K.O. — no points',
        zone_warn: '⚠ The ring is shrinking!', special_ready: 'Special ready!',
        it_hp: 'Repair +35', it_en: 'Battery +50%', it_nitro: 'Nitro Boost', it_star: 'Power Up',
        it_mg: 'Machine Gun', it_ms: 'Homing Missile', it_dr: 'Attack Drone', it_sh: 'Energy Shield',
        it_ip: 'Laser Interceptor', it_ar: 'Armor Plates', it_box: 'Mystery Box',
        opt_items: '🎁 Loot', opt_on: 'ON', opt_off: 'OFF', opt_speed: '⏱ Speed',
        spd_slow: 'Slow', spd_normal: 'Normal', spd_fast: 'Fast',
        garage_btn: '🔧 Customize {name}', pk_mod_title: 'Custom parts equipped',
        gar_title: '🔧 Tank Garage',
        gar_intro: 'Swap gun, hull, and tracks! Every part has an <b>upside ✓</b> and a <b>tradeoff ✗</b>. Budget cap is {cap} ⚡ for fair online play.',
        gar_energy: '⚡ Budget', gar_over: '⚡ Over budget! Pick a cheaper part in another slot first.',
        gar_saved: 'Build saved ✓', gar_free: 'Free', gar_reset: 'Reset to Stock', gar_done: 'Done',
        gar_look_h: '🎨 Paint & Callsign (cosmetic)', gar_name: 'Callsign', gar_name_ph: 'Nickname your tank', gar_col_default: 'Stock paint',
        slot_gun: 'Main Gun', slot_gun_note: 'Fire rate, damage & shell speed',
        slot_hull: 'Hull Armor', slot_hull_note: 'HP, size & speed',
        slot_track: 'Tracks & Engine', slot_track_note: 'Speed, turning & dash cooldown',
        p_std_n: 'Stock', p_std_g: 'Balanced stock part',
        part_gun_quick: 'Quick Breech', part_gun_quick_g: 'Faster reload', part_gun_quick_b: 'Slightly less damage',
        part_gun_long: 'Sniper Barrel', part_gun_long_g: 'Faster shells', part_gun_long_b: 'Slower turret turn',
        part_gun_heavy: 'Heavy Howitzer', part_gun_heavy_g: 'Big damage boost', part_gun_heavy_b: 'Slower reload & shells',
        part_gun_twin: 'Twin Autocannon', part_gun_twin_g: 'Much faster fire rate', part_gun_twin_b: 'Lower damage & shell speed',
        part_hull_light: 'Light Frame', part_hull_light_g: 'Faster & slightly smaller', part_hull_light_b: 'Less HP',
        part_hull_plate: 'Heavy Plates', part_hull_plate_g: '+20% HP', part_hull_plate_b: 'Slightly slower',
        part_hull_sloped: 'Sloped Armor', part_hull_sloped_g: 'More HP & faster turret', part_hull_sloped_b: 'Slightly less damage',
        part_hull_fort: 'Fortress Hull', part_hull_fort_g: '+32% HP', part_hull_fort_b: 'Slower & larger hull',
        part_track_grip: 'Grip Tracks', part_track_grip_g: 'Faster turret rotation', part_track_grip_b: 'Slightly lower top speed',
        part_track_turbo: 'Turbo Engine', part_track_turbo_g: '+14% move speed', part_track_turbo_b: 'Slightly less HP',
        part_track_dash: 'Dash Thrusters', part_track_dash_g: 'Shorter dash cooldown', part_track_dash_b: 'Slightly slower move speed',
        part_track_omni: 'Hover Tracks', part_track_omni_g: 'Boosts speed, turn & dash', part_track_omni_b: '-12% HP'
    };

    D.ja = {
        page_title: 'Link Armor - タンク対決',
        lang_title: '言語', mute_title: 'サウンド',
        p1_host: 'P1（ホスト）', p2_client: 'P2（ゲスト）', p1_you: 'P1（あなた）', p2_opp: 'P2（相手）', p2_you: 'P2（あなた）',
        tagline: '障害物のあいだを走って、相手の HP を<b>ゼロ</b>にしたらラウンド勝ち！',
        safe: '🛡️ 安心して撃とう：自分の弾は<b>ぜったいに</b>自分に当たらず、はね返りもしません。',
        invite_label: '招待リンク（友だちに送ろう）',
        copy: 'コピー', copied: 'コピーしました！',
        conn_wait: '相手を探しています…', conn_signal: 'サーバーに接続中…',
        conn_open: 'つながった！友だちがリンクを開くのを待っています…', conn_closed: 'サーバーと切れました。再読み込みしてね',
        waiting_peer: '相手を待っています', waiting_for: '{name} を待っています',
        ready_h2: 'タンクをえらぼう',
        role_host: 'あなたは<b>ホスト</b>：タンクを選んでスタート！', role_client: 'あなたは<b>ゲスト</b>：タンクを選んで、ホストのスタートを待とう。',
        opp_choosing: '相手が選んでいます…', opp_picked: '相手のタンク：{name}',
        final_score: 'スコア', rematch: 'もう一回', awaiting: 'ホストを待っています…',
        lost_h2: '相手が退出しました', lost_p: '接続が切れました。', lobby_btn: 'ロビーへ',
        stick: '移動', btn_fire: '発射', btn_dash: 'ダッシュ', btn_special: '必殺',
        ctrl_two: '🙌 両手', ctrl_right: '👉 片手・右', ctrl_left: '👈 片手・左', auto_fire: '自動発射・ダブルタップでダッシュ',
        k_onehand: '<b>片手モード（スマホ）</b>：操作エリア隅のボタンで 両手 / 片手（右・左）を切り替え。片手は自動発射、スティックをダブルタップでダッシュ',
        how_h3: '遊び方',
        k_move: '<b>WASD / 矢印キー</b> 移動', k_fire: '<b>スペース / J</b> 発射（砲塔は相手を自動で狙う）',
        k_aim: '<b>マウス左ボタン長押し</b> カーソルの方向へ発射', k_dash: '<b>Q / K / 右クリック</b> ダッシュでよける',
        k_special: '<b>E / L / Shift</b> 必殺技（ゲージが満タンのとき）',
        k_rule: '相手の HP を 0 にすると 1 点。先に {n} 点取ったら勝ち。木箱はこわせる、鉄の壁はこわせない。',
        k_tri: '相性：⚡突撃 → 🎯狙撃 → 🛡️重装 → ⚡突撃（ダメージ ×1.15）',
        k_zone: '40 秒たつと赤い輪が小さくなり、外にいると HP が減ります。',
        status_h3: 'ステータス', st_state: '状態', st_ping: 'Ping', st_role: '役割',
        st_disconnected: '未接続', st_offline: 'オフライン', st_p2p: '直接接続', st_reconnect: '再接続中…', st_spectator: '観戦',
        back: 'LINK に戻る',
        t_rapid: '突撃', t_heavy: '重装', t_sniper: '狙撃', t_balance: 'バランス',
        s_rapid: '必殺・フレンジー：連射2倍＋スピードアップ', s_heavy: '必殺・シールド：ダメージ -70%',
        s_sniper: '必殺・レールガン：次の一発が超強力、木箱を貫通', s_balance: '必殺・リペア：HP +40＋スピードアップ',
        adv: '{x} に強い', bar_hp: 'HP', bar_spd: '速さ', bar_pow: '火力',
        round_win: 'このラウンドはあなたの勝ち！', round_lose: '負けちゃった、次はがんばろう！', round_draw: '相打ち、点数なし',
        zone_warn: '⚠ 赤い輪が縮んでいる！', special_ready: '必殺技 OK！',
        it_hp: 'リペア +35', it_en: 'バッテリー +50%', it_nitro: 'ニトロ加速', it_star: 'パワーアップ',
        it_mg: 'マシンガン', it_ms: 'ホーミングミサイル', it_dr: 'ドローン', it_sh: 'シールド',
        it_ip: '迎撃レーザー', it_ar: '装甲プレート', it_box: 'ミステリー箱',
        opt_items: '🎁 アイテム', opt_on: 'あり', opt_off: 'なし', opt_speed: '⏱ スピード',
        spd_slow: 'ゆっくり', spd_normal: 'ふつう', spd_fast: 'はやい',
        garage_btn: '🔧 {name} を改造', pk_mod_title: '改造パーツ装着中',
        gar_title: '🔧 タンク改造工房',
        gar_intro: '主砲・装甲・キャタピラを交換！どのパーツにも<b>長所 ✓</b>と<b>短所 ✗</b>があります（上限 {cap} ⚡）。',
        gar_energy: '⚡ コスト', gar_over: '⚡ コスト上限オーバー！他のパーツを軽くしてね。',
        gar_saved: '保存しました ✓', gar_free: '無料', gar_reset: '標準に戻す', gar_done: '完了',
        gar_look_h: '🎨 カラー＆コールサイン', gar_name: '名前', gar_name_ph: 'タンクの名前', gar_col_default: '標準カラー',
        slot_gun: '主砲', slot_gun_note: '連射・威力・弾速',
        slot_hull: 'ボディ装甲', slot_hull_note: 'HP・サイズ・速度',
        slot_track: 'キャタピラ', slot_track_note: '速度・旋回・ダッシュ冷却',
        p_std_n: '標準', p_std_g: 'バランス型（増減なし）',
        part_gun_quick: '速射砲', part_gun_quick_g: 'リロードが速い', part_gun_quick_b: '威力が少し下がる',
        part_gun_long: 'ロングバレル', part_gun_long_g: '弾速が速い', part_gun_long_b: '砲塔の旋回が遅い',
        part_gun_heavy: 'ヘビー砲', part_gun_heavy_g: '威力が大きく上がる', part_gun_heavy_b: 'リロードと弾速が遅い',
        part_gun_twin: 'ツイン機関砲', part_gun_twin_g: '連射が大幅アップ', part_gun_twin_b: '威力と弾速が下がる',
        part_hull_light: '軽量ボディ', part_hull_light_g: '速くて少し小さい', part_hull_light_b: 'HPが減る',
        part_hull_plate: '増加装甲', part_hull_plate_g: 'HP +20%', part_hull_plate_b: '少し遅くなる',
        part_hull_sloped: '傾斜装甲', part_hull_sloped_g: 'HPと砲塔旋回アップ', part_hull_sloped_b: '威力が少し下がる',
        part_hull_fort: 'フォートレス装甲', part_hull_fort_g: 'HP +32%', part_hull_fort_b: '遅くなりサイズ増',
        part_track_grip: 'グリップ履帯', part_track_grip_g: '旋回が速くなる', part_track_grip_b: '速度が少し下がる',
        part_track_turbo: 'ターボエンジン', part_track_turbo_g: '移動速度 +14%', part_track_turbo_b: 'HPが少し減る',
        part_track_dash: 'ダッシュブースター', part_track_dash_g: 'ダッシュ間隔が短い', part_track_dash_b: '移動速度が少し下がる',
        part_track_omni: 'ホバー履帯', part_track_omni_g: '速度・旋回・ダッシュ向上', part_track_omni_b: 'HP -12%'
    };

    D.ko = {
        page_title: 'Link Armor - 탱크 대결',
        lang_title: '언어', mute_title: '소리',
        p1_host: 'P1 (방장)', p2_client: 'P2 (손님)', p1_you: 'P1 (나)', p2_opp: 'P2 (상대)', p2_you: 'P2 (나)',
        tagline: '엄폐물 사이를 달리며 상대의 체력을 <b>0</b>으로 만들면 라운드 승리!',
        safe: '🛡️ 마음껏 쏘세요: 내 포탄은 <b>절대</b> 나를 맞히지 않고 튕겨 나오지도 않아요.',
        invite_label: '초대 링크 (친구에게 보내세요)',
        copy: '복사', copied: '복사됨!',
        conn_wait: '상대를 찾는 중…', conn_signal: '서버에 연결 중…',
        conn_open: '연결됐어요! 친구가 링크를 열 때까지 기다리는 중…', conn_closed: '서버 연결이 끊겼어요. 새로고침 해 보세요',
        waiting_peer: '상대를 기다리는 중', waiting_for: '{name} 기다리는 중',
        ready_h2: '탱크를 고르세요',
        role_host: '당신은 <b>방장</b>: 탱크를 고르고 시작!', role_client: '당신은 <b>손님</b>: 탱크를 고르고 방장을 기다리세요.',
        opp_choosing: '상대가 고르는 중…', opp_picked: '상대 탱크: {name}',
        final_score: '점수', rematch: '한 판 더', awaiting: '방장을 기다리는 중…',
        lost_h2: '상대가 나갔어요', lost_p: '연결이 끊겼어요.', lobby_btn: '로비로',
        stick: '이동', btn_fire: '발사', btn_dash: '대시', btn_special: '필살',
        ctrl_two: '🙌 양손', ctrl_right: '👉 한손·오른쪽', ctrl_left: '👈 한손·왼쪽', auto_fire: '자동 발사 · 더블탭 대시',
        k_onehand: '<b>한손 모드(터치)</b>: 조작 영역 모서리 버튼으로 양손 / 한손(오른쪽·왼쪽) 전환. 한손은 자동 발사, 스틱 더블탭으로 대시',
        how_h3: '플레이 방법',
        k_move: '<b>WASD / 방향키</b> 이동', k_fire: '<b>스페이스 / J</b> 발사 (포탑이 상대를 자동 조준)',
        k_aim: '<b>마우스 왼쪽 누르기</b> 커서 방향으로 발사', k_dash: '<b>Q / K / 오른쪽 클릭</b> 대시로 피하기',
        k_special: '<b>E / L / Shift</b> 필살기 (게이지가 가득 찼을 때)',
        k_rule: '상대 체력을 0으로 만들면 1점. {n}점 먼저 따면 승리. 나무 상자는 부서지고 강철 벽은 안 부서져요.',
        k_tri: '상성: ⚡돌격 → 🎯저격 → 🛡️중장 → ⚡돌격 (피해 ×1.15)',
        k_zone: '40초 후 빨간 원이 줄어들고, 원 밖에 있으면 체력이 줄어요.',
        status_h3: '상태', st_state: '상태', st_ping: '핑', st_role: '역할',
        st_disconnected: '연결 안 됨', st_offline: '오프라인', st_p2p: '직접 연결', st_reconnect: '재연결 중…', st_spectator: '관전',
        back: 'LINK로 돌아가기',
        t_rapid: '돌격', t_heavy: '중장', t_sniper: '저격', t_balance: '균형',
        s_rapid: '필살·광폭: 연사 2배 + 가속', s_heavy: '필살·방패: 받는 피해 -70%',
        s_sniper: '필살·레일건: 다음 한 발이 아주 강하고 상자를 관통', s_balance: '필살·수리: 체력 +40, 가속',
        adv: '{x}에 강함', bar_hp: '체력', bar_spd: '속도', bar_pow: '화력',
        round_win: '이번 라운드 승리!', round_lose: '졌어요, 다음 판 화이팅!', round_draw: '동시 K.O. — 점수 없음',
        zone_warn: '⚠ 빨간 원이 줄어들어요!', special_ready: '필살기 준비 완료!',
        it_hp: '수리 키트 +35', it_en: '배터리 +50%', it_nitro: '니트로 가속', it_star: '화력 강화',
        it_mg: '기관총', it_ms: '유도 미사일', it_dr: '공격 드론', it_sh: '에너지 실드',
        it_ip: '레이저 요격기', it_ar: '장갑판', it_box: '미스터리 박스',
        opt_items: '🎁 보물', opt_on: '켜짐', opt_off: '꺼짐', opt_speed: '⏱ 속도',
        spd_slow: '느림', spd_normal: '보통', spd_fast: '빠름',
        garage_btn: '🔧 {name} 개조', pk_mod_title: '개조 부품 장착됨',
        gar_title: '🔧 탱크 개조 공방',
        gar_intro: '주포, 장갑, 궤도를 교체하세요! 모든 부품은 <b>장점 ✓</b>과 <b>단점 ✗</b>이 있습니다 (예산 {cap} ⚡).',
        gar_energy: '⚡ 예산', gar_over: '⚡ 예산 초과! 다른 슬롯의 부품을 먼저 낮추세요.',
        gar_saved: '저장됨 ✓', gar_free: '무료', gar_reset: '기본으로 초기화', gar_done: '완료',
        gar_look_h: '🎨 도색 & 콜사인', gar_name: '콜사인', gar_name_ph: '탱크 이름', gar_col_default: '기본 색상',
        slot_gun: '주포', slot_gun_note: '연사력, 위력, 탄속',
        slot_hull: '차체 장갑', slot_hull_note: '체력, 크기, 속도',
        slot_track: '궤도 & 엔진', slot_track_note: '속도, 회전, 대시 쿨타임',
        p_std_n: '기본', p_std_g: '균형 잡힌 기본 부품',
        part_gun_quick: '속사포', part_gun_quick_g: '장전 속도 상승', part_gun_quick_b: '공격력 소폭 감소',
        part_gun_long: '저격 포신', part_gun_long_g: '탄속 상승', part_gun_long_b: '포탑 회전 느려짐',
        part_gun_heavy: '중포', part_gun_heavy_g: '공격력 대폭 상승', part_gun_heavy_b: '장전 및 탄속 감소',
        part_gun_twin: '쌍열 기관포', part_gun_twin_g: '연사력 대폭 상승', part_gun_twin_b: '공격력 및 탄속 감소',
        part_hull_light: '경량 차체', part_hull_light_g: '속도 상승 & 크기 축소', part_hull_light_b: '체력 감소',
        part_hull_plate: '증가장갑', part_hull_plate_g: '체력 +20%', part_hull_plate_b: '속도 소폭 감소',
        part_hull_sloped: '경사 장갑', part_hull_sloped_g: '체력 & 포탑 회전 상승', part_hull_sloped_b: '공격력 소폭 감소',
        part_hull_fort: '요새형 차체', part_hull_fort_g: '체력 +32%', part_hull_fort_b: '속도 감소 & 크기 증가',
        part_track_grip: '고접지 궤도', part_track_grip_g: '포탑 회전 속도 상승', part_track_grip_b: '최고 속도 소폭 감소',
        part_track_turbo: '터보 엔진', part_track_turbo_g: '이동 속도 +14%', part_track_turbo_b: '체력 소폭 감소',
        part_track_dash: '대시 추진기', part_track_dash_g: '대시 쿨타임 단축', part_track_dash_b: '이동 속도 소폭 감소',
        part_track_omni: '호버 궤도', part_track_omni_g: '속도, 회전, 대시 모두 상승', part_track_omni_b: '체력 -12%'
    };

    var LANGS = [['zh', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']];
    var qs = new URLSearchParams(location.search);
    var lang = qs.get('lang') || localStorage.getItem('language') || (navigator.language || 'en').slice(0, 2);
    if (!D[lang]) lang = 'en';
    document.documentElement.lang = lang;

    function t(k, r) {
        var s = D[lang][k];
        if (s === undefined) s = D.en[k];
        if (s === undefined) s = k;
        for (var x in (r || {})) s = s.split('{' + x + '}').join(r[x]);
        return s;
    }
    function apply(root) {
        (root || document).querySelectorAll('[data-i18n]').forEach(function (e) { e.innerHTML = t(e.dataset.i18n, e.dataset.i18nN ? { n: e.dataset.i18nN } : null); });
        (root || document).querySelectorAll('[data-i18n-title]').forEach(function (e) { e.title = t(e.dataset.i18nTitle); });
    }
    function setLang(l) {
        if (!D[l] || l === lang) return;
        localStorage.setItem('language', l);
        var u = new URL(location.href);
        u.searchParams.delete('lang');
        location.replace(u.toString());
    }
    function mountPicker(sel) {
        LANGS.forEach(function (p) {
            var o = document.createElement('option');
            o.value = p[0]; o.textContent = p[1];
            sel.appendChild(o);
        });
        sel.value = lang;
        sel.addEventListener('change', function () { setLang(sel.value); });
    }

    document.title = t('page_title');
    apply();
    var sel = document.getElementById('lang-select');
    if (sel) mountPicker(sel);
    window.ArmorI18n = { lang: lang, t: t, apply: apply, setLang: setLang, dict: D };
})();
