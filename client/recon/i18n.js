/* Steel Shadow: Recon — UI strings (zh / en / ja / ko). */
(function () {
    'use strict';
    const S = {
        zh: {
            title: '钢影：侦察战', tagline: '大地图 · 战争迷雾 · 侦察与伏击',
            invite: '邀请链接（发给朋友）', copy: '复制', copied: '已复制',
            conn_wait: '正在连接房间…', conn_open: '房间已连接，等待对手加入…', conn_closed: '与服务器断开',
            ready_h: '准备出击', role_host: '你是房主，点击开始任务。', role_client: '已连接房主，等待房主开始…',
            start: '开始任务', wait_host: '等待房主开始…', rematch: '再来一局', lobby: '返回大厅',
            lost_h: '对手已断开', lost_p: '对方离开了房间。', reload: '重新开始',
            win: '任务成功', lose: '任务失败', final: '比分',
            rule: '先击毁对手 {n} 次获胜',
            h_move: 'WASD / 方向键：移动', h_aim: '鼠标：瞄准 · 左键 / 空格：开火（手机自动瞄准可见敌人）',
            h_drone: 'Q：放出无人机，飞向炮口方向，持续照亮一片区域', h_sat: 'E：卫星扫描，短暂标出敌方坐标',
            h_forest: '躲进森林即可隐身（贴近或开火会暴露），从隐蔽处开火伤害 ×1.6 —— 伏击！',
            h_ruin: '废墟和岩石挡住视线和炮弹；水面只挡坦克',
            drone: '无人机', sat: '卫星', fire: '开火',
            hidden: '已隐蔽', spotted: '被发现', ambush: '伏击！', kill: '击毁敌方！', killed: '你被击毁',
            respawn: '{s} 秒后重新部署', drone_on: '无人机侦察中', sat_on: '卫星锁定敌方', sat_wait: '卫星对准中…',
            enemy_drone: '敌方无人机在你头顶！', start_msg: '任务开始 · 先侦察，再伏击', stick: '移动'
        },
        en: {
            title: 'Steel Shadow: Recon', tagline: 'Big map · Fog of war · Scout and ambush',
            invite: 'Invite link (send to a friend)', copy: 'Copy', copied: 'Copied',
            conn_wait: 'Connecting to room…', conn_open: 'Room open, waiting for an opponent…', conn_closed: 'Disconnected from server',
            ready_h: 'Ready to roll', role_host: 'You are the host. Start the mission.', role_client: 'Connected. Waiting for the host to start…',
            start: 'Start mission', wait_host: 'Waiting for the host…', rematch: 'Rematch', lobby: 'Back to lobby',
            lost_h: 'Opponent left', lost_p: 'The other player left the room.', reload: 'Start over',
            win: 'Mission complete', lose: 'Mission failed', final: 'Score',
            rule: 'First to {n} kills wins',
            h_move: 'WASD / arrows: move', h_aim: 'Mouse: aim · Click / Space: fire (touch auto-aims at visible enemies)',
            h_drone: 'Q: launch a drone toward your gun, it lights up an area for a while', h_sat: 'E: satellite scan, briefly marks the enemy',
            h_forest: 'Forests hide you (getting close or firing reveals you). Shots from hiding deal ×1.6 — ambush!',
            h_ruin: 'Ruins and rocks block sight and shells; water only blocks tanks',
            drone: 'Drone', sat: 'Sat', fire: 'Fire',
            hidden: 'Hidden', spotted: 'Spotted', ambush: 'AMBUSH!', kill: 'Enemy destroyed!', killed: 'You were destroyed',
            respawn: 'Redeploying in {s}s', drone_on: 'Drone feed active', sat_on: 'Satellite lock', sat_wait: 'Satellite aligning…',
            enemy_drone: 'Enemy drone overhead!', start_msg: 'Mission start · scout first, then ambush', stick: 'Move'
        },
        ja: {
            title: 'スティールシャドウ：偵察戦', tagline: '広いマップ · 戦場の霧 · 偵察と待ち伏せ',
            invite: '招待リンク（友だちに送る）', copy: 'コピー', copied: 'コピーしました',
            conn_wait: 'ルームに接続中…', conn_open: 'ルーム接続済み、相手を待っています…', conn_closed: 'サーバーから切断されました',
            ready_h: '出撃準備', role_host: 'あなたはホストです。任務を開始してください。', role_client: '接続しました。ホストの開始を待っています…',
            start: '任務開始', wait_host: 'ホストを待っています…', rematch: 'もう一戦', lobby: 'ロビーへ',
            lost_h: '相手が切断しました', lost_p: '相手がルームを出ました。', reload: 'やり直す',
            win: '任務成功', lose: '任務失敗', final: 'スコア',
            rule: '先に {n} 回撃破で勝利',
            h_move: 'WASD / 矢印キー：移動', h_aim: 'マウス：照準 · クリック / スペース：射撃（スマホは見えている敵を自動照準）',
            h_drone: 'Q：ドローンを砲口方向へ飛ばし、一定時間エリアを照らす', h_sat: 'E：衛星スキャン、敵の位置を一瞬表示',
            h_forest: '森に入ると隠れられる（接近・射撃で発覚）。隠れた状態からの射撃は ×1.6 —— 待ち伏せ！',
            h_ruin: '廃墟と岩は視界と砲弾を遮る。水は戦車だけを止める',
            drone: 'ドローン', sat: '衛星', fire: '射撃',
            hidden: '潜伏中', spotted: '発見された', ambush: '待ち伏せ！', kill: '敵を撃破！', killed: '撃破された',
            respawn: '{s} 秒後に再出撃', drone_on: 'ドローン偵察中', sat_on: '衛星ロック', sat_wait: '衛星照準中…',
            enemy_drone: '敵ドローンが頭上に！', start_msg: '任務開始 · まず偵察、そして待ち伏せ', stick: '移動'
        },
        ko: {
            title: '스틸 섀도: 정찰전', tagline: '넓은 맵 · 전장의 안개 · 정찰과 매복',
            invite: '초대 링크 (친구에게 보내기)', copy: '복사', copied: '복사됨',
            conn_wait: '방에 연결 중…', conn_open: '방 연결됨, 상대를 기다리는 중…', conn_closed: '서버와 연결이 끊김',
            ready_h: '출격 준비', role_host: '당신이 방장입니다. 임무를 시작하세요.', role_client: '연결됨. 방장이 시작하길 기다리는 중…',
            start: '임무 시작', wait_host: '방장을 기다리는 중…', rematch: '한 판 더', lobby: '로비로',
            lost_h: '상대가 나갔습니다', lost_p: '상대가 방을 떠났습니다.', reload: '다시 시작',
            win: '임무 성공', lose: '임무 실패', final: '점수',
            rule: '먼저 {n}번 격파하면 승리',
            h_move: 'WASD / 방향키: 이동', h_aim: '마우스: 조준 · 클릭 / 스페이스: 발사 (모바일은 보이는 적 자동 조준)',
            h_drone: 'Q: 포구 방향으로 드론 발사, 일정 시간 지역을 밝힘', h_sat: 'E: 위성 스캔, 적 위치를 잠깐 표시',
            h_forest: '숲에 들어가면 숨을 수 있음 (가까이 오거나 발사하면 노출). 숨은 상태의 사격은 ×1.6 —— 매복!',
            h_ruin: '폐허와 바위는 시야와 포탄을 막고, 물은 전차만 막음',
            drone: '드론', sat: '위성', fire: '발사',
            hidden: '은신 중', spotted: '발각됨', ambush: '매복!', kill: '적 격파!', killed: '격파당함',
            respawn: '{s}초 후 재배치', drone_on: '드론 정찰 중', sat_on: '위성 고정', sat_wait: '위성 조준 중…',
            enemy_drone: '적 드론이 머리 위에!', start_msg: '임무 시작 · 먼저 정찰, 그다음 매복', stick: '이동'
        }
    };
    const qs = new URLSearchParams(location.search);
    let lang = qs.get('lang') || localStorage.getItem('language') || (navigator.language || 'en').slice(0, 2);
    if (!S[lang]) lang = 'en';

    function L(k, vars) {
        let s = (S[lang] && S[lang][k]) || S.en[k] || k;
        for (const v in (vars || {})) s = s.split('{' + v + '}').join(vars[v]);
        return s;
    }
    function apply() {
        document.documentElement.lang = lang;
        document.title = L('title');
        document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = L(el.dataset.i18n, { n: el.dataset.n }); });
    }
    function setLang(l) {
        if (!S[l]) return;
        lang = l;
        localStorage.setItem('language', l);
        apply();
    }
    window.ReconI18n = { L, apply, setLang, get lang() { return lang; }, langs: Object.keys(S) };
})();
