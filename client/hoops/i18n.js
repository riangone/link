/**
 * Link Hoops — strings (zh / en / ja / ko).
 */
window.HoopsI18n = SportKit.i18n({
    zh: {
        page_title: 'Link Hoops - 机甲篮球',
        tagline: '1 对 1 钢铁斗牛！把等离子篮球轰进<b>对方篮筐</b>！',
        how_mini: '🕹️ 摇杆半场跑位 / 拖动<br>🏀 投篮键跳投（篮下暴扣），防守键盖帽抢断',
        ready_h2: '准备跳球',
        btn_steal: '防守',
        btn_shoot: '投篮',
        k_move: '跑位移动',
        k_shoot: '起跳投篮（篮下触发暴扣）',
        k_steal: '盖帽 / 冲刺抢断',
        k_act1: '跳起投篮 / 篮下暴扣',
        k_act2: '防守盖帽 / 冲刺抢断',
        hud_mouse: '拖动画布跑位 · 单击跳投',
        touch_hint: '🕹️ 摇杆跑位晃人<br>🏀 <b>最高点跳投</b>/篮下暴扣 · 🛡️防守盖帽抢断！',
        toast_tip: '按 空格/J 跳起并在最高点投篮 · 突入篮下起跳触发涡轮暴扣！',
        briefing_keys: 'WASD 走位 · Space/J 跳投/篮下暴扣 · Shift/K 防守盖帽',
        briefing_touch: '左摇杆移动 · 投篮键跳投/暴扣 · 防守键抢断/盖帽',
        k_touch: '<b>触屏</b>：左侧摇杆移动，投篮键跳投（篮下触发推进器暴扣），防守键冲刺抢断/盖帽',
        k_keys: '<b>键盘</b>：WASD 或方向键移动，空格 / J 投篮/暴扣，Shift / K 盖帽/抢断',
        k_mark: '<b>跳到最高点</b>出手命中率最高；对手投篮刚离手时起跳可触发 <b>BLOCK!</b> 盖帽',
        k_rule: '三分线外投进得 3 分，内线 2 分。先到 11 分获胜。失分方下一回合发球。',
        ball_me: '你的球', ball_opp: '对方的球',
        modal_keys_html: `
            <table>
                <tr><th>按键</th><th>动作</th><th>实战效果</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">方向键</kbd></td><td>移动跑位</td><td>全向走位晃人、拉开投篮空档或贴身卡位</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (中远距离)</td><td>🏀 跳起投篮</td><td>起跳升空，在<strong>跳至最高点瞬间</strong>出手命中率最高！</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (突入篮下禁区)</td><td>⚡ 涡轮暴扣</td><td>杀入篮下禁区起跳触发涡轮重扣，100% 爆框进球！</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd> (防守状态)</td><td>🛡️ 盖帽 / 抢断</td><td>对手起跳投篮时跳起触发 <strong>BLOCK!</strong> 封盖；贴身时抢断球权</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd> (进攻状态)</td><td>💨 推进冲刺</td><td>启动机甲涡轮爆发力，加速变向突破防线</td></tr>
                <tr><td><strong>鼠标</strong></td><td>拖拽移动 / 单击跳投</td><td>按住拖拽走位，单击起跳投篮</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 左侧虚拟摇杆</strong>：灵活运球走位，晃开防守队员。</li>
                <li><strong>🏀 投篮按钮</strong>：按下起跳投篮；在篮下禁区范围内按下触发极具冲击力的<strong>机甲涡轮暴扣</strong>！</li>
                <li><strong>🛡️ 防守按钮</strong>：贴身时按住抢断对手球权；对手起跳投篮时按下起跳实施当头大帽。</li>
                <li><strong>👆 屏幕拖拽</strong>：支持单指在屏幕上拖拽走位与单击投篮。</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🎯 投篮时机与命中率</strong>：起跳到最高点时出手准星最佳；面对贴身防守强行投篮容易打铁；背身面对防守球员可有效护球防抢断。</li>
                <li><strong>🚫 封盖机制 (Block)</strong>：对手投篮且球刚出手上升时，在其正面起跳拦截可触发封盖！</li>
                <li><strong>3️⃣ 三分线与判分</strong>：在弧形霓虹三分线外命中计 <strong>3 分</strong>，三分线内得分计 <strong>2 分</strong>。</li>
                <li><strong>🏆 获胜条件</strong>：先得 <strong>11 分</strong> 获胜！失分方拥有下一回合发球权。</li>
            </ul>`
    },
    en: {
        page_title: 'Link Hoops - Mech Hoops',
        tagline: '1-on-1 cyber streetball! Slam the plasma ball into <b>their hoop</b>!',
        how_mini: '🕹️ Joystick / drag = run<br>🏀 SHOOT for jump shots & dunks; CONTEST to block',
        ready_h2: 'Ready for tip-off',
        btn_steal: 'DEFEND',
        btn_shoot: 'SHOOT',
        k_move: 'Move & Position',
        k_shoot: 'Jump shot / slam dunk near rim',
        k_steal: 'Contest block / steal',
        k_act1: 'Jump Shot / Slam Dunk',
        k_act2: 'Contest Block / Steal',
        hud_mouse: 'Drag to move · Click to shoot',
        touch_hint: '🕹️ Stick = move<br>🏀 <b>Release at peak</b> / Dunk · 🛡️Contest block!',
        toast_tip: 'Press Space/J to jump and shoot at peak · Jump near rim to slam dunk!',
        briefing_keys: 'WASD move · Space/J jump shot & dunk · Shift/K block & steal',
        briefing_touch: 'Left stick move · Shoot button to shoot/dunk · Defend to block',
        k_touch: '<b>Touch</b>: Left stick to run, SHOOT to shoot/dunk, DEFEND to block/steal',
        k_keys: '<b>Keyboard</b>: WASD or arrows to run, Space / J to shoot/dunk, Shift / K to block/steal',
        k_mark: 'Release <b>at the top of your jump</b> for the best aim; touch rising shots to block',
        k_rule: 'Beyond the arc = 3 points, inside = 2. First to 11 wins. Conceding side serves.',
        ball_me: 'Your ball', ball_opp: 'Their ball',
        modal_keys_html: `
            <table>
                <tr><th>Key</th><th>Action</th><th>Combat Effect</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">Arrows</kbd></td><td>Move & Position</td><td>Maneuver around court, create space, or contest rival</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (Mid-to-long range)</td><td>🏀 Jump Shot</td><td>Leap up; release <strong>at apex of jump</strong> for top accuracy!</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (Near rim paint)</td><td>⚡ Turbo Slam Dunk</td><td>Drive into the paint and jump for a 100% unstoppable slam dunk!</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd> (On defense)</td><td>🛡️ Block / Steal</td><td>Jump to trigger <strong>BLOCK!</strong> on rising shots; swipe close for steals</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd> (On offense)</td><td>💨 Turbo Boost</td><td>Burst of speed to blow past your defender</td></tr>
                <tr><td><strong>Mouse</strong></td><td>Drag to move / Click to shoot</td><td>Hold and drag to move, click to jump & shoot</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ Left Virtual Stick</strong>: Dribble and position across the half-court.</li>
                <li><strong>🏀 SHOOT Button</strong>: Tap to jump shoot; drive inside the paint to unleash a <strong>Turbo Slam Dunk</strong>!</li>
                <li><strong>🛡️ DEFEND Button</strong>: Swipe close to steal, or leap up to swat down rising shots with a huge BLOCK.</li>
                <li><strong>👆 Drag & Tap</strong>: Drag on screen to steer, tap to shoot.</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🎯 Jump Shot Timing</strong>: Release at the absolute peak of your jump for maximum accuracy. Contested shots suffer accuracy penalty.</li>
                <li><strong>🚫 Swat Blocks</strong>: Intercept shots while they are still ascending for a clean rejection!</li>
                <li><strong>3️⃣ 3-Point Line</strong>: Shots from beyond the neon arc count for <strong>3 points</strong>; inside counts for <strong>2 points</strong>.</li>
                <li><strong>🏆 Win Condition</strong>: First to <strong>11 points</strong> claims the championship!</li>
            </ul>`
    },
    ja: {
        page_title: 'Link Hoops - メカバスケ',
        tagline: '1 対 1 の勝負！プラズマボールを<b>相手ゴール</b>に叩き込め！',
        how_mini: '🕹️ スティック / ドラッグで移動<br>🏀 シュートでジャンプシュート＆ダンク、守備でブロック',
        ready_h2: 'ティップオフの準備',
        btn_steal: '守備',
        btn_shoot: 'シュート',
        k_move: '移動・位置取り',
        k_shoot: 'ジャンプシュート / ゴール下ダンク',
        k_steal: 'ブロック / スティール',
        k_act1: 'シュート / ダンク',
        k_act2: 'ブロック / スティール',
        hud_mouse: 'ドラッグで移動・クリックでシュート',
        touch_hint: '🕹️ スティックで移動<br>🏀 <b>頂点でシュート</b>/ダンク・🛡️ブロック！',
        toast_tip: 'スペース/Jでジャンプし頂点でシュート・ゴール下でダンク炸裂！',
        briefing_keys: 'WASD移動・スペース/Jシュート/ダンク・Shift/Kブロック',
        briefing_touch: '左スティックで移動・シュートボタンでダンク・守備ボタンでブロック',
        k_touch: '<b>タッチ</b>：左スティックで移動、シュートボタンでシュート/ダンク、守備ボタンでブロック',
        k_keys: '<b>キーボード</b>：WASD / 矢印キーで移動、スペース / J でシュート/ダンク、Shift / K でブロック/スティール',
        k_mark: '<b>ジャンプの頂点</b>で打つのが一番正確。打ったばかりの球に触ればブロック',
        k_rule: '3 ポイントラインの外から決めれば 3 点、それ以外は 2 点。先に 11 点で勝ち。',
        ball_me: 'あなたのボール', ball_opp: '相手のボール',
        modal_keys_html: `
            <table>
                <tr><th>キー</th><th>動作</th><th>効果</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">矢印</kbd></td><td>移動・位置取り</td><td>スペースを作り出したり、相手に密着してマーク</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (中遠距離)</td><td>🏀 ジャンプシュート</td><td>跳び上がり、<strong>ジャンプの最高到達点</strong>で打つと命中率最大！</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (ゴール下)</td><td>⚡ ターボダンク</td><td>ゴール下で跳ぶと100%決まる大迫力のターボダンク！</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd> (守備時)</td><td>🛡️ ブロック / スティール</td><td>相手のシュートに合わせて跳んで <strong>BLOCK!</strong>、密着してスティール</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd> (攻撃時)</td><td>💨 ブーストダッシュ</td><td>一瞬のダッシュでディフェンスを振り切る</td></tr>
                <tr><td><strong>マウス</strong></td><td>ドラッグ移動 / クリックシュート</td><td>画面ドラッグで移動、クリックでジャンプシュート</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 左スティック</strong>：俊敏なフットワークでディフェンスを翻弄。</li>
                <li><strong>🏀 シュートボタン</strong>：ジャンプシュート。ゴール下ではド派手な<strong>ダンクシュート</strong>が発動！</li>
                <li><strong>🛡️ 守備ボタン</strong>：密着してスティール、相手のシュートを叩き落とすブロック。</li>
                <li><strong>👆 画面ドラッグ</strong>：画面上でメカを直接誘導可能。</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🎯 シュートのタイミング</strong>：ジャンプの頂点で放つと正確無比。密着マークされると命中率低下。</li>
                <li><strong>🚫 ブロックのコツ</strong>：相手がシュートを放ち、ボールが上昇中の瞬間に跳び上がるとブロック成功！</li>
                <li><strong>3️⃣ 3ポイントライン</strong>：アークの外側からは <strong>3点</strong>、内側は <strong>2点</strong>。</li>
                <li><strong>🏆 勝利条件</strong>：先に <strong>11点</strong> 先取したチームの勝利！</li>
            </ul>`
    },
    ko: {
        page_title: 'Link Hoops - 메카 농구',
        tagline: '1대1 강철 길거리 농구! 플라즈마 농구공을 <b>상대 골대</b>에 꽂아 넣으세요!',
        how_mini: '🕹️ 조이스틱 / 드래그 = 이동<br>🏀 슛 버튼으로 점프슛＆덩크, 수비로 블록',
        ready_h2: '점프볼 준비',
        btn_steal: '수비',
        btn_shoot: '슛',
        k_move: '이동 및 위치선정',
        k_shoot: '점프슛 / 골밑 덩크',
        k_steal: '블록 / 스틸',
        k_act1: '점프슛 / 슬램덩크',
        k_act2: '블록 / 스틸',
        hud_mouse: '드래그로 이동 · 클릭으로 슛',
        touch_hint: '🕹️ 스틱으로 이동<br>🏀 <b>최고점에서 슛</b>/덩크 · 🛡️블록/스틸!',
        toast_tip: '스페이스/J로 점프하여 최고점에서 슛 · 골밑에서 덩크 폭발!',
        briefing_keys: 'WASD 이동 · 스페이스/J 점프슛/덩크 · Shift/K 블록/스틸',
        briefing_touch: '왼쪽 스틱 이동 · 슛 버튼으로 덩크 · 수비 버튼으로 블록',
        k_touch: '<b>터치</b>: 왼쪽 스틱으로 이동, 슛 버튼으로 슛/덩크, 수비 버튼으로 블록/스틸',
        k_keys: '<b>키보드</b>: WASD 또는 화살표 이동, 스페이스 / J 슛/덩크, Shift / K 블록/스틸',
        k_mark: '<b>점프 최고점</b>에서 던지면 가장 정확해요. 막 던진 공에 닿으면 블록',
        k_rule: '3점 라인 밖에서 넣으면 3점, 나머지는 2점. 먼저 11점이면 승리.',
        ball_me: '내 공', ball_opp: '상대 공',
        modal_keys_html: `
            <table>
                <tr><th>키</th><th>동작</th><th>전투 효과</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">화살표</kbd></td><td>이동 및 위치선정</td><td>하프코트 전 방향 이동 및 밀착 수비</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (중원거리)</td><td>🏀 점프슛</td><td>도약 후 <strong>점프 최고 정점</strong>에서 슛 시 최고 적중률!</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (골밑 돌파)</td><td>⚡ 터보 슬램덩크</td><td>골밑 페인트존에서 도약 시 100% 림 파괴 슬램덩크!</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd> (수비 시)</td><td>🛡️ 블록 / 스틸</td><td>상대 슈팅 시 점프하여 <strong>BLOCK!</strong> 수비, 밀착 스틸</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd> (공격 시)</td><td>💨 부스터 질주</td><td>순간 가속으로 수비수를 제치고 돌파</td></tr>
                <tr><td><strong>마우스</strong></td><td>드래그 이동 / 클릭 슈팅</td><td>화면 드래그로 이동, 클릭하여 슛</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 왼쪽 가상 스틱</strong>: 민첩한 드리블과 포지셔닝.</li>
                <li><strong>🏀 슛 버튼</strong>: 점프슛 발동; 골밑에서는 호쾌한 <strong>메카 터보 덩크</strong> 작렬!</li>
                <li><strong>🛡️ 수비 버튼</strong>: 밀착 스틸 및 상대 슛을 쳐내는 파워 블록.</li>
                <li><strong>👆 제스처 조작</strong>: 코트 위 드래그로 이동 및 탭 슈팅 지원.</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🎯 점프슛 타이밍</strong>: 점프의 정점에서 슛할 때 가장 정확합니다. 상대의 견제가 심하면 적중률이 떨어집니다.</li>
                <li><strong>🚫 블록 타이밍</strong>: 상대가 슛을 쏴서 공이 떠오르는 순간 점프하면 블록슛 성공!</li>
                <li><strong>3️⃣ 3점슛 라인</strong>: 네온 아크 바깥 슛은 <strong>3점</strong>, 안쪽 슛은 <strong>2점</strong>.</li>
                <li><strong>🏆 승리 조건</strong>: 먼저 <strong>11점</strong>을 내면 승리!</li>
            </ul>`
    }
});
