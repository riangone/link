/* Abyssal Front — UI strings (zh / en / ja / ko). */
(function () {
    'use strict';
    const S = {
        zh: {
            title: '深渊升潮', tagline: '深海突袭 · 巨兽巢穴 · 声呐隐匿 · 单手操控',
            invite: '邀请链接（发给队友）', copy: '复制', copied: '已复制',
            conn_wait: '正在接入深渊…', conn_open: '声呐链路已建立，等待潜航者…', conn_closed: '与母舰断开连接',
            ready_h: '潜航简报 & 装备整备', role_host: '你是潜航指挥，配置海域后下潜。', role_client: '已接入深渊，等待指挥官下潜…',
            start: '下潜突袭', wait_host: '等待指挥官下潜…', rematch: '再战一场', lobby: '返回大厅',
            lost_h: '队友信号丢失', lost_p: '对方已离开深渊。', reload: '重新部署',
            win: '深渊统治！', lose: '沉入深渊…', final: '总比分',
            rule: '击沉对手 {n} 次，或夺取巨兽巢穴获得补给与视野优势',
            h_move: 'WASD / 方向键：潜航 · 空格：发射',
            h_aim: '鼠标精确瞄准 · 静止蓄能更精准 · 绕后攻击后方排气弱点 · 大倾角命中会被外壳偏折',
            h_sonar: '主动声呐会暴露你的位置，开火即被定位——沉默是深海的通行证',
            h_kelp: '海藻丛提供隐匿（靠近或开火会暴露），无声突袭造成 ×1.6 伤害！',
            h_drone: 'Q：回声无人机（探照灯照明）', h_hunter: 'R：吸血鳗群（追踪打击）', h_scan: 'E：声呐扫描（延迟定位）',
            h_flare: 'Z：深渊爆闪（致盲与锁定）', h_vent: 'X：热泉雾障（阻断视线与弹药）', h_mine: 'F：虹吸水雷',
            drone: '回声', hunter: '鳗群', scan: '扫描', fire: '开火', flare: '爆闪', vent: '雾障', mine: '水雷',

            lo_map: '海域规模', lo_depth: '下潜深度', lo_class: '压力壳', lo_weapon: '声呐武器', lo_gear: '深渊装备',
            map_normal: '浅海前线', map_large: '深渊海沟', map_huge: '极限深渊',
            d_map_normal: '2400×1800 · 1 个巨兽巢穴 · 适合快速遭遇战',
            d_map_large: '3600×2700 · 3 个巨兽巢穴 · 均衡的猎杀区域与开阔水域',
            d_map_huge: '4800×3600 · 5 个巨兽巢穴 · 长距离潜航，补给决定胜负',

            depth_shallow: '浅海层', depth_mid: '温跃层', depth_deep: '无光层', depth_hadal: '超深渊层',
            d_depth_shallow: '声呐半径最大，射程略短——适合贴近缠斗',
            d_depth_mid: '均衡配置：潜深与声呐都没有短板',
            d_depth_deep: '声呐半径缩小，但鱼雷更快更远——远距离狙杀',
            d_depth_hadal: '极度黑暗：声呐急剧衰减，炮弹穿透力与暴击更高',

            cls_ram: '锤头级', cls_skulk: '潜猎级', cls_bulwark: '壁垒级', cls_stalk: '螫针级',
            d_cls_ram: '全能主力壳体：均衡的耐久、速度与声呐',
            d_cls_skulk: '轻快敏捷的猎手：极速潜航与更大声呐范围，但壳薄',
            d_cls_stalk: '远射杀手：单发伤害极高，但转体缓慢、装填漫长',
            d_cls_bulwark: '重装甲堡垒：生命极高，声呐范围极广，但行动迟缓',

            w_pulse: '脉冲', w_torpedo: '重鱼雷', w_swarm: '蜂群', w_eel: '电鳗',
            dw_pulse: '标准脉冲鱼雷：均衡可靠',
            dw_torpedo: '穿甲重鱼雷：伤害 +35% · 装填 +20% · 穿透力更强',
            dw_swarm: '蜂群速射：伤害 -28% · 装填 -32% · 靠近后爆裂',
            dw_eel: '电鳗电击：范围放电 · 少量穿甲穿透 · 装填较慢',

            g_glide: '滑翔鳍', g_bio: '生物装甲', g_hunter: '猎手', g_lookout: '瞭望', g_vent: '废气回收',
            dg_glide: '滑翔鳍：潜航速度 +16% · 转向更快',
            dg_bio: '生物装甲：生命 +35 · 速度 -10%',
            dg_hunter: '猎手：声呐半径 +70 · 更易发现水雷与巢穴',
            dg_lookout: '瞭望：开火暴露时间缩短，回声无人机冷却 -40%',
            dg_vent: '废气回收：更慢的声呐暴露，略高的速度',

            st_hp: '生命', st_spd: '迅捷', st_sight: '声呐', st_dmg: '伤害', st_range: '射程',
            reloading: '装填中',
            items_on: '📦 补给：开', items_off: '📦 补给：关', items_host: '📦 补给由房主设置',
            aim_auto: '🎯 自动瞄准', aim_manual: '🎯 手动瞄准', af_on: '🔥 连开火：开', af_off: '🔥 连开火：关',
            af_hint: 'V 切换自动开火',

            start_msg: '下潜完成 · 声呐静默 · 猎杀开始', stick: '潜行摇杆',
            kill: '击沉敌舰！', killed: '我方舰体被击沉', respawn: '{s} 秒后重新接触',
            ambush: '无声突袭！', hidden: '海藻隐匿中', spotted: '已暴露',
            mine_hit: '水雷命中', crit_hit: '💥 命中后方排气弱点！', crit_self: '⚠ 尾部排气被击穿！',
            ricochet: '⚡ 敌舰外壳偏折了鱼雷！', ricochet_self: '🛡️ 外壳偏折敌方鱼雷',
            drop: '📦 补给舱上浮中', pick_enemy: '敌方拾取了补给',
            it_repair: '修复舱', it_shield: '能量护盾', it_rapid: '超载装填', it_speed: '推进增压', it_mines: '水雷补给', it_intel: '战术情报',
            drone_on: '回声无人机巡航中', scan_on: '声呐扫描锁定', scan_wait: '声呐重新校准中…',
            flare_active: '致盲：声呐与火控瘫痪！', flare_recovered: '火控系统恢复', vent_active: '雾障已展开',
            den_taken: '巢穴已占领（敌方失去视野）', den_lost: '巢穴被敌方夺取', den_supply: '巢穴投放补给',
            win_reason_kill: '击沉胜利：对手被击沉 3 次', win_reason_den: '巢穴统治',
            enemy_drone: '警报：敌方回声无人机进入海域'
        },
        ja: {
            title: '深淵ライズ', tagline: '深海遊撃 · 巨獣の巣 · ソナー隠れ · 片手操作',
            invite: '招待リンク（仲間に送る）', copy: 'コピー', copied: 'コピー済み',
            conn_wait: '深淵へ接続中…', conn_open: 'ソナー回線 確立。潜航者を待機中…', conn_closed: '母艦との接続が切れました',
            ready_h: '潜航ブリーフィング & 装備', role_host: 'あなたは潜航指揮官。海域を決めて潜航しよう。', role_client: '接続完了。指揮官の潜航を待っています…',
            start: '潜行開始', wait_host: '指揮官の潜航を待機中…', rematch: '再戦', lobby: 'ロビーへ',
            lost_h: '仲間の信号が消えました', lost_p: '相手は深淵を離れました。', reload: '再接続',
            win: '深淵を制圧！', lose: '深淵へ沈没…', final: 'スコア',
            rule: '相手を {n} 回撃沈するか、巨獣の巣を奪取して補給と視界を確保',
            h_move: 'WASD / 矢印キー：潜航 · Space：発射',
            h_aim: 'マウスで精密照準 · 停止中は精度上昇 · 背後は弱点 · 浅い角度は装甲で跳ね返る',
            h_sonar: 'アクティブソナーは自分の位置を暴露、射撃でも位置が割れる——静寂こそ深海の武器',
            h_kelp: 'ケルプでは隠れる（接近されると露見）。無音奇襲はダメージ ×1.6！',
            h_drone: 'Q：エコードローン（ライト照射）', h_hunter: 'R：吸血ウナギ群', h_scan: 'E：ソナー走査（遅延探知）',
            h_flare: 'Z：深淵フレア（盲目＆ロック）', h_vent: 'X：熱水ヴェント（視界を遮る）', h_mine: 'F：サイフォン機雷',
            drone: 'エコー', hunter: 'ウナギ', scan: '走査', fire: '発射', flare: 'フレア', vent: '霧障', mine: '機雷',

            lo_map: '海域規模', lo_depth: '潜航深度', lo_class: '圧力殻', lo_weapon: 'ソナー兵器', lo_gear: '深淵装備',
            map_normal: '浅海前線', map_large: '深淵トレンチ', map_huge: '極限深淵',
            d_map_normal: '2400×1800 · 巨獣の巣 1 · 素早い遭遇戦向け',
            d_map_large: '3600×2700 · 巨獣の巣 3 · 狩場と開けた水域のバランス',
            d_map_huge: '4800×3600 · 巨獣の巣 5 · 長距離潜航、補給が勝敗を分ける',

            depth_shallow: '浅海層', depth_mid: '水温躍層', depth_deep: '無光層', depth_hadal: '超深淵層',
            d_depth_shallow: 'ソナー最大、射程は短め——接近戦向き',
            d_depth_mid: 'バランス型：潜航とソナーの弱点なし',
            d_depth_deep: 'ソナー縮小、魚雷は高速長射程——遠距離狙撃',
            d_depth_hadal: '極暗：ソナーは急減衰、弾の貫通とクリティカル増加',

            cls_ram: 'ハンマーヘッド', cls_skulk: 'ストーカー', cls_bulwark: 'バルワーク', cls_stalk: 'スティングレイ',
            d_cls_ram: '万能主力殻：耐久・速度・ソナーが均等',
            d_cls_skulk: '俊敏なハンター：高速と広いソナー、殻は薄い',
            d_cls_stalk: '射撃特化：単発威力が非常高、旋回と装填が遅い',
            d_cls_bulwark: '重装甲要塞：極めて硬くソナーも広いが鈍重',

            w_pulse: 'パルス', w_torpedo: '重魚雷', w_swarm: '群射', w_eel: 'エレキウナギ',
            dw_pulse: '標準パルス魚雷：堅実',
            dw_torpedo: '貫通重魚雷：威力 +35% · 装填 +20% · 貫通力上昇',
            dw_swarm: 'スウォーム速射：威力 -28% · 装填 -32% · 至近で爆裂',
            dw_eel: 'エレキショック：範囲放電 · 若干貫通 · 装填やや遅い',

            g_glide: 'グライドフィン', g_bio: 'バイオアーマー', g_hunter: 'ハンター', g_lookout: '見張り', g_vent: '排気回収',
            dg_glide: 'グライドフィン：速度 +16% · 旋回向上',
            dg_bio: 'バイオアーマー：耐久 +35 · 速度 -10%',
            dg_hunter: 'ハンター：ソナー +70 · 機雷や巣を発見しやすい',
            dg_lookout: '見張り：射撃の露見時間短縮 · エコードローン冷却 -40%',
            dg_vent: '排気回収：ソナー露見が遅い · 速度＋',

            st_hp: '耐久', st_spd: '速力', st_sight: 'ソナー', st_dmg: '威力', st_range: '射程',
            reloading: '装填',
            items_on: '📦 補給：オン', items_off: '📦 補給：オフ', items_host: '📦 補給はホストが設定',
            aim_auto: '🎯 自動照準', aim_manual: '🎯 手動照準', af_on: '🔥 自動連射：オン', af_off: '🔥 自動連射：オフ',
            af_hint: 'V で自動連射切替',

            start_msg: '潜航完了 · ソナー静寂 · 狩り開始', stick: '潜行スティック',
            kill: '敵艦を撃沈！', killed: '自艦が撃沈されました', respawn: '{s} 秒後に再出現',
            ambush: '無音奇襲！', hidden: 'ケルプで隠密中', spotted: '露見',
            mine_hit: '機雷被弾', crit_hit: '💥 後部排気の弱点に命中！', crit_self: '⚠ 尾部排気を破壊！',
            ricochet: '⚡ 敵の装甲で弾かれた！', ricochet_self: '🛡️ 装甲で敵魚雷を弾いた',
            drop: '📦 補給ポッド浮上中', pick_enemy: '敵が補給を取得',
            it_repair: '修理ポッド', it_shield: 'シールド', it_rapid: '急速装填', it_speed: '推進過給', it_mines: '機雷補給', it_intel: '戦術情報',
            drone_on: 'エコードローン航行中', scan_on: 'ソナー走査ロック', scan_wait: 'ソナー再調整中…',
            flare_active: '盲目：ソナーと火器管制が停止！', flare_recovered: '火器管制 回復', vent_active: '霧障を展開',
            den_taken: '巣を占拠（敵は視界を失う）', den_lost: '巣を奪われた', den_supply: '巣から補給投下',
            win_reason_kill: '撃沈勝ち：相手を 3 回撃沈', win_reason_den: '巣の支配',
            enemy_drone: '警告：敵エコードローンが海域に侵入'
        },
        ko: {
            title: '심연 상승', tagline: '심해 기습 · 거대兽 둥지 · 소나 은신 · 한 손 조작',
            invite: '초대 링크 (친구에게 전송)', copy: '복사', copied: '복사됨',
            conn_wait: '심연에 접속 중…', conn_open: '소나 링크 연결됨, 잠수자를 기다리는 중…', conn_closed: '모함과 연결이 끊겼습니다',
            ready_h: '잠항 브리핑 & 장비', role_host: '당신은 잠항 지휘관입니다. 해역을 설정하고 잠항하세요.', role_client: '연결됨. 지휘관의 잠항을 기다립니다…',
            start: '잠항 돌격', wait_host: '지휘관의 잠항을 기다리는 중…', rematch: '재대전', lobby: '로비로',
            lost_h: '동료 신호 상실', lost_p: '상대가 심연을 떠났습니다.', reload: '재배치',
            win: '심연 지배!', lose: '심연에 침몰…', final: '총점',
            rule: '상대를 {n}회 격침하거나 거대兽 둥지를 차지해 보급과 시야를 확보하세요',
            h_move: 'WASD / 방향키: 잠항 · Space: 발사',
            h_aim: '마우스 정밀 조준 · 정지 시 정확도 상승 · 후방 약점 · 얕은 각도는 장갑에 튕김',
            h_sonar: '액티브 소나는 위치를 노출시키고, 발사도 위치를 드러냅니다 — 침묵이 심해의 무기',
            h_kelp: '켈프에선 은신 (접근하면 노출). 무음 기습 피해 ×1.6!',
            h_drone: 'Q: 에코 드론 (조명)', h_hunter: 'R: 흡혈 장어 떼', h_scan: 'E: 소나 스캔 (지연 탐지)',
            h_flare: 'Z: 심연 플레어 (실명·락온)', h_vent: 'X: 열수 분출 (시야 차단)', h_mine: 'F: 사이펀 기뢰',
            drone: '에코', hunter: '장어', scan: '스캔', fire: '발사', flare: '플레어', vent: '수증기', mine: '기뢰',

            lo_map: '해역 규모', lo_depth: '잠항 심도', lo_class: '압력 선체', lo_weapon: '소나 무기', lo_gear: '심연 장비',
            map_normal: '천해 전선', map_large: '심연 트렌치', map_huge: '한계 심연',
            d_map_normal: '2400×1800 · 거대兽 둥지 1 · 빠른 교전용',
            d_map_large: '3600×2700 · 거대兽 둥지 3 · 사냥터와 수역의 균형',
            d_map_huge: '4800×3600 · 거대兽 둥지 5 · 장거리 잠항, 보급이 승부를 가른다',

            depth_shallow: '천해층', depth_mid: '수온 약층', depth_deep: '무광층', depth_hadal: '초심연층',
            d_depth_shallow: '소나 최대, 사거리 짧음 — 접근전에 적합',
            d_depth_mid: '균형형: 잠항과 소나 모두 무난',
            d_depth_deep: '소나 감소, 어뢰는 빠르고 멀리 — 원거리 저격',
            d_depth_hadal: '극한의 어둠: 소나 급감, 발사체 관통·치명타 증가',

            cls_ram: '해머헤드', cls_skulk: '스토커', cls_bulwark: '벌워크', cls_stalk: '스팅레이',
            d_cls_ram: '만능 주력 선체: 내구·속도·소나 균형',
            d_cls_skulk: '민첩한 사냥꾼: 빠른 잠항과 넓은 소나, 얇은 선체',
            d_cls_stalk: '저격 특화: 단발 피해 극대화, 느린 회전과 재장전',
            d_cls_bulwark: '중장갑 요새: 매우 높은 내구와 넓은 소나, 느린 기동',

            w_pulse: '펄스', w_torpedo: '중어뢰', w_swarm: '군집', w_eel: '전기 장어',
            dw_pulse: '표준 펄스 어뢰: 균형형',
            dw_torpedo: '관통 중어뢰: 피해 +35% · 재장전 +20% · 관통력 상승',
            dw_swarm: '군집 속사: 피해 -28% · 재장전 -32% · 근거리 폭발',
            dw_eel: '전기 방전: 범위 공격 · 약간의 관통 · 재장전 다소 느림',

            g_glide: '글라이드 핀', g_bio: '바이오 아머', g_hunter: '헌터', g_lookout: '망루', g_vent: '배기 회수',
            dg_glide: '글라이드 핀: 속도 +16% · 회전 향상',
            dg_bio: '바이오 아머: 내구 +35 · 속도 -10%',
            dg_hunter: '헌터: 소나 +70 · 기뢰와 둥지 발견 용이',
            dg_lookout: '망루: 발사 노출 시간 단축 · 에코 드론 쿨다운 -40%',
            dg_vent: '배기 회수: 소나 노출 지연 · 약간의 속도 상승',

            st_hp: '내구', st_spd: '속력', st_sight: '소나', st_dmg: '피해', st_range: '사거리',
            reloading: '장전',
            items_on: '📦 보급: 켜짐', items_off: '📦 보급: 꺼짐', items_host: '📦 보급은 방장이 설정',
            aim_auto: '🎯 자동 조준', aim_manual: '🎯 수동 조준', af_on: '🔥 자동 연사: 켜짐', af_off: '🔥 자동 연사: 꺼짐',
            af_hint: 'V 자동 연사 전환',

            start_msg: '잠항 완료 · 소나 침묵 · 사냥 시작', stick: '잠행 스틱',
            kill: '적함 격침!', killed: '아군 선체가 침몰했습니다', respawn: '{s}초 후 재접촉',
            ambush: '무음 기습!', hidden: '켈프에 은신 중', spotted: '노출됨',
            mine_hit: '기뢰 피격', crit_hit: '💥 후방 배기 약점 명중!', crit_self: '⚠ 후미 배기 파괴!',
            ricochet: '⚡ 적 장갑이 어뢰를 튕겨냈다!', ricochet_self: '🛡️ 장갑으로 적 어뢰를 튕겨냄',
            drop: '📦 보급 포드 부상 중', pick_enemy: '적이 보급을 획득',
            it_repair: '수리 포드', it_shield: '에너지 실드', it_rapid: '과부하 장전', it_speed: '추진 과급', it_mines: '기뢰 보급', it_intel: '전술 정보',
            drone_on: '에코 드론 순항 중', scan_on: '소나 스캔 락온', scan_wait: '소나 재교정 중…',
            flare_active: '실명: 소나와 화기 제어 정지!', flare_recovered: '화기 제어 복구', vent_active: '수증기 전개',
            den_taken: '둥지 점령 (적 시야 상실)', den_lost: '둥지를 빼앗겼다', den_supply: '둥지에서 보급 투하',
            win_reason_kill: '격침 승리: 상대를 3회 격침', win_reason_den: '둥지 지배',
            enemy_drone: '경고: 적 에코 드론 침입'
        },
        en: {
            title: 'Abyssal Front', tagline: 'Deep-sea raids · Leviathan dens · Sonar stealth · One-hand play',
            invite: 'Invite link (send to your ally)', copy: 'Copy', copied: 'Copied',
            conn_wait: 'Diving into the abyss…', conn_open: 'Sonar link established, waiting for a diver…', conn_closed: 'Disconnected from the mothership',
            ready_h: 'Dive briefing & loadout', role_host: 'You are the dive commander. Pick the sea, then descend.', role_client: "Connected. Waiting for the commander's dive…",
            start: 'Dive assault', wait_host: 'Waiting for the commander…', rematch: 'Rematch', lobby: 'Back to lobby',
            lost_h: 'Ally signal lost', lost_p: 'Your ally left the abyss.', reload: 'Redeploy',
            win: 'The abyss is yours!', lose: 'Sunk into the abyss…', final: 'Final score',
            rule: 'Sink your rival {n} times, or take leviathan dens for supplies and vision',
            h_move: 'WASD / arrows: dive · Space: fire',
            h_aim: 'Mouse to aim · hold still to tighten the spread · hit the rear vents · shallow hits deflect off the hull',
            h_sonar: 'Active sonar exposes you and firing gives you away — silence is the deep-sea weapon',
            h_kelp: 'Kelp hides you (close range or firing reveals). A silent strike deals ×1.6!',
            h_drone: 'Q: Echo drone (searchlight)', h_hunter: 'R: Vampire eel swarm', h_scan: 'E: Sonar scan (delayed)',
            h_flare: 'Z: Abyssal flare (blind & lockout)', h_vent: 'X: Vent plume (blocks sight)', h_mine: 'F: Siphon mine',
            drone: 'Echo', hunter: 'Eels', scan: 'Scan', fire: 'Fire', flare: 'Flare', vent: 'Vent', mine: 'Mine',

            lo_map: 'Sea size', lo_depth: 'Dive depth', lo_class: 'Pressure hull', lo_weapon: 'Sonar weapon', lo_gear: 'Abyss gear',
            map_normal: 'Shallows', map_large: 'Trench', map_huge: 'Hadal Abyss',
            d_map_normal: '2400×1800 · 1 leviathan den · quick encounters',
            d_map_large: '3600×2700 · 3 leviathan dens · balanced hunting grounds',
            d_map_huge: '4800×3600 · 5 leviathan dens · long dives, supplies decide',

            depth_shallow: 'Sunlit layer', depth_mid: 'Thermocline', depth_deep: 'Midnight zone', depth_hadal: 'Hadal zone',
            d_depth_shallow: 'Widest sonar, shorter range — get in close',
            d_depth_mid: 'Balanced: no weakness in dive or sonar',
            d_depth_deep: 'Narrower sonar but fast, far torpedoes — snipe from the dark',
            d_depth_hadal: 'Extreme dark: sonar collapses, but penetration and crits rise',

            cls_ram: 'Hammerhead', cls_skulk: 'Skulk', cls_bulwark: 'Bulwark', cls_stalk: 'Stingray',
            d_cls_ram: 'All-round mainline hull: even durability, speed and sonar',
            d_cls_skulk: 'Nimble hunter: fast dives and wide sonar, thin hull',
            d_cls_stalk: 'Long-range killer: huge single-shot damage, slow turn and reload',
            d_cls_bulwark: 'Armored fortress: massive HP and sonar, sluggish',

            w_pulse: 'Pulse', w_torpedo: 'Heavy torp', w_swarm: 'Swarm', w_eel: 'Electric eel',
            dw_pulse: 'Standard pulse torpedo: steady and reliable',
            dw_torpedo: 'Armor-piercing torpedo: +35% damage · +20% reload · better penetration',
            dw_swarm: 'Swarm rapid-fire: -28% damage · -32% reload · bursts up close',
            dw_eel: 'Electric discharge: area burst · some penetration · slower reload',

            g_glide: 'Glide fins', g_bio: 'Bio-armor', g_hunter: 'Hunter', g_lookout: 'Lookout', g_vent: 'Vent reclaimer',
            dg_glide: 'Glide fins: +16% speed · faster turns',
            dg_bio: 'Bio-armor: +35 HP · -10% speed',
            dg_hunter: 'Hunter: +70 sonar · spots mines and dens sooner',
            dg_lookout: 'Lookout: brief sonar exposure when firing · echo drone cooldown -40%',
            dg_vent: 'Vent reclaimer: slower sonar exposure · a bit more speed',

            st_hp: 'HP', st_spd: 'Speed', st_sight: 'Sonar', st_dmg: 'Damage', st_range: 'Range',
            reloading: 'reload',
            items_on: '📦 Supplies: on', items_off: '📦 Supplies: off', items_host: '📦 Supplies set by host',
            aim_auto: '🎯 Auto-aim', aim_manual: '🎯 Manual aim', af_on: '🔥 Auto-fire: on', af_off: '🔥 Auto-fire: off',
            af_hint: 'V toggles auto-fire',

            start_msg: 'Dive complete · sonar silent · the hunt begins', stick: 'Dive stick',
            kill: 'Enemy hull sunk!', killed: 'Your hull was sunk', respawn: 'Re-contact in {s}s',
            ambush: 'Silent strike!', hidden: 'Hidden in kelp', spotted: 'Exposed',
            mine_hit: 'Mine hit', crit_hit: '💥 Rear vents hit!', crit_self: '⚠ Your tail vents were breached!',
            ricochet: '⚡ Their hull deflected the torpedo!', ricochet_self: '🛡️ Hull deflected the torpedo',
            drop: '📦 Supply pod surfacing', pick_enemy: 'Enemy grabbed a supply',
            it_repair: 'Repair pod', it_shield: 'Shield', it_rapid: 'Overload reload', it_speed: 'Thrust surge', it_mines: 'Mine resupply', it_intel: 'Tactical intel',
            drone_on: 'Echo drone cruising', scan_on: 'Sonar scan locked', scan_wait: 'Realigning sonar…',
            flare_active: 'Blinded: sonar and fire control down!', flare_recovered: 'Fire control restored', vent_active: 'Vent plume deployed',
            den_taken: 'Den captured (enemy vision blind)', den_lost: 'Den lost to the enemy', den_supply: 'Den supply drop',
            win_reason_kill: 'Sinking victory: rival sunk 3 times', win_reason_den: 'Den dominance',
            enemy_drone: 'Alert: enemy echo drone in the water'
        }
    };

    let lang = 'zh';
    try {
        const saved = localStorage.getItem('abyss_lang');
        if (saved && S[saved]) lang = saved;
        else {
            const nav = (navigator.language || 'zh').toLowerCase();
            if (nav.startsWith('zh')) lang = 'zh';
            else if (nav.startsWith('ja')) lang = 'ja';
            else if (nav.startsWith('ko')) lang = 'ko';
            else lang = 'en';
        }
    } catch (_) {}

    function t(key, vars) {
        const dict = S[lang] || S.zh;
        let str = dict[key] || S.zh[key] || key;
        if (vars) {
            for (const k in vars) {
                str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
            }
        }
        return str;
    }

    function apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const k = el.getAttribute('data-i18n');
            const n = el.getAttribute('data-n');
            const s = el.getAttribute('data-s');
            const vars = {};
            if (n !== null) vars.n = n;
            if (s !== null) vars.s = s;
            el.textContent = t(k, vars);
        });
        document.title = t('title');
    }

    window.AbyssI18n = {
        get lang() { return lang; },
        setLang(l) {
            if (S[l]) {
                lang = l;
                try { localStorage.setItem('abyss_lang', l); } catch (_) {}
                apply();
            }
        },
        t, L: t, apply, S
    };
})();
