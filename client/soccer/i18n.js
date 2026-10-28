/**
 * Link Soccer — strings (zh / en / ja / ko).
 */
window.SoccerI18n = SportKit.i18n({
    zh: {
        page_title: 'Link Soccer - 机甲足球',
        tagline: '带球突防，把等离子球轰进<b>对方球门</b>！',
        how_mini: '🕹️ 摇杆跑位带球 / 拖动<br>💥 按住射门键蓄力，松手<b>射门</b>，推进键加速',
        ready_h2: '准备开球',
        btn_dash: '推进',
        btn_kick: '射门',
        k_move: '移动带球',
        k_kick: '蓄力射门（松开踢出 / 轻点传球）',
        k_dash: '推进加速',
        k_act1: '长按蓄力射门（松手轰出）',
        k_act2: '推进冲刺加速',
        hud_mouse: '拖动画布运球 · 单击射门',
        touch_hint: '🕹️ 摇杆运球推土<br>💥 <b>长按蓄力</b>松手破门 · 💨推进冲刺！',
        toast_kick: '长按 空格/J 蓄力射门（松手踢出） · Shift/K 推进加速过人！',
        briefing_keys: 'WASD 移动带球 · Space/J 长按蓄力射门 · Shift/K 推进冲刺',
        briefing_touch: '左摇杆运球 · 按住射门键蓄力松手射门 · 推进键加速',
        k_touch: '<b>触屏</b>：左侧摇杆移动，右侧按住射门蓄力、松手抽射，推进键冲刺过人',
        k_keys: '<b>键盘</b>：WASD 或方向键移动，空格 / J 蓄力射门（轻点短传），Shift / K 推进加速',
        k_mark: '球门有<b>自动守门无人机</b>：离门越近射门越容易进；蓄满力的球带抛物线飞行',
        k_rule: '两分钟比赛，进球多者胜；先进 5 球直接获胜。时间到平局进入金球决胜。',
        ko_me: '你开球', ko_opp: '对方开球',
        modal_keys_html: `
            <table>
                <tr><th>按键</th><th>动作</th><th>实战效果</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">方向键</kbd></td><td>移动带球</td><td>推土机式控球走位与身体对抗抢断</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (轻点)</td><td>短传 / 推射</td><td>近距离快速低平球推射或短传</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (长按松开)</td><td>💥 蓄力重炮轰门</td><td>蓄力槽满后松手，发射高弧度重炮射门，可飞越防守机甲！</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd></td><td>💨 推进冲刺</td><td>启动涡轮加速 35%，用于快速突防或回防断球</td></tr>
                <tr><td><strong>鼠标拖拽</strong></td><td>运球移动</td><td>按住鼠标拖拽走位，单击射门</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 左侧虚拟摇杆</strong>：灵活操控机甲移动与带球方向。</li>
                <li><strong>💥 射门按钮</strong>：按住开始积蓄射门能量条，松手瞬间轰出重炮！轻点为短传。</li>
                <li><strong>💨 推进按钮</strong>：按住持续加速冲刺，强行超车或断球。</li>
                <li><strong>👆 双指瞬发</strong>：在运球中单指带球，第二根手指轻点屏幕可直接瞬发中距离抽射。</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🤖 巡逻门将无人机</strong>：双方球门线上各有 1 台自动门将。离球门越近、射门角度越偏离门将，进球概率越高！</li>
                <li><strong>🚀 飞行高度与重力</strong>：蓄满力的球具有飞行高度，可越过阻挡的机甲，但若距离过远可能高出横梁。</li>
                <li><strong>⏱️ 比赛时间与绝杀</strong>：比赛限时 2 分钟，进球多者胜。若平局则进入激动人心的<strong>金球绝杀（Golden Goal）</strong>，先进球者胜！</li>
            </ul>`
    },
    en: {
        page_title: 'Link Soccer - Mech Soccer',
        tagline: 'Dribble up and blast the plasma ball into <b>their goal</b>!',
        how_mini: '🕹️ Joystick / drag = run & dribble<br>💥 Hold SHOOT to charge, release to kick!',
        ready_h2: 'Ready for kick-off',
        btn_dash: 'BOOST',
        btn_kick: 'SHOOT',
        k_move: 'Move & Dribble',
        k_kick: 'Charge shoot (release to kick / tap to pass)',
        k_dash: 'Boost dash',
        k_act1: 'Charge Shot (Hold & release)',
        k_act2: 'Turbo Boost Dash',
        hud_mouse: 'Drag to dribble · Click to shoot',
        touch_hint: '🕹️ Stick = dribble<br>💥 <b>Hold & release</b> to shoot · 💨Turbo Boost!',
        toast_kick: 'Hold Space/J to charge shot, release to fire · Shift/K to turbo boost!',
        briefing_keys: 'WASD move & dribble · Space/J charge shot · Shift/K boost',
        briefing_touch: 'Left stick dribble · Hold & release shoot · Boost to sprint',
        k_touch: '<b>Touch</b>: Left stick to run, right buttons to boost & charge-shoot',
        k_keys: '<b>Keyboard</b>: WASD or arrows to run, Space / J to charge-shoot, Shift / K to boost',
        k_mark: 'Each goal has an <b>auto keeper drone</b>: closer shots beat it easier. Charged shots loft into the air',
        k_rule: 'Two-minute match, first to 5 goals wins outright. Level at full time = golden goal.',
        ko_me: 'Your kick-off', ko_opp: 'Their kick-off',
        modal_keys_html: `
            <table>
                <tr><th>Key</th><th>Action</th><th>Combat Effect</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">Arrows</kbd></td><td>Move & Dribble</td><td>Tractor-dribble and physical body tackle</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (Tap)</td><td>Pass / Tap Shoot</td><td>Quick low pass or close-range tap-in</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (Hold & Release)</td><td>💥 Charge Cannon Shot</td><td>Release at full gauge for high-arc cannon shot clearing defenders</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd></td><td>💨 Turbo Boost</td><td>+35% sprint speed for fast break or tracking back</td></tr>
                <tr><td><strong>Mouse</strong></td><td>Drag to dribble / Click to shoot</td><td>Hold and drag to steer, click to shoot</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ Left Virtual Stick</strong>: Steer mech dribble run.</li>
                <li><strong>💥 Shoot Button</strong>: Hold to charge power bar, release to blast cannon shot! Tap for quick pass.</li>
                <li><strong>💨 Boost Button</strong>: Hold for turbo sprint burst.</li>
                <li><strong>👆 Second-Finger Shot</strong>: Tap second finger while dribbling for immediate snapshot.</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🤖 Keeper Drone</strong>: Auto-patrolling drone defends each goal line. Shoot from close range and wide angles.</li>
                <li><strong>🚀 Elevation & Arc</strong>: High-charge shots gain height and sail over blocking mechs.</li>
                <li><strong>⏱️ Golden Goal</strong>: 2-minute match. In case of a draw, next goal wins instantly!</li>
            </ul>`
    },
    ja: {
        page_title: 'Link Soccer - メカサッカー',
        tagline: 'ドリブルで攻めこんで、<b>相手ゴール</b>にシュート！',
        how_mini: '🕹️ スティック / ドラッグで移動<br>💥 シュート長押しでため、離して<b>シュート</b>',
        ready_h2: 'キックオフの準備',
        btn_dash: 'ダッシュ',
        btn_kick: 'シュート',
        k_move: '移動・ドリブル',
        k_kick: '長押しシュート（離してキック / タップでパス）',
        k_dash: 'ダッシュ加速',
        k_act1: '長押しシュート（離して発射）',
        k_act2: 'ダッシュ加速',
        hud_mouse: 'ドラッグでドリブル・クリックでシュート',
        touch_hint: '🕹️ スティックでドリブル<br>💥 <b>長押し蓄力</b>で強烈シュート・💨加速！',
        toast_kick: 'スペース/J長押しでシュート蓄力、離して発射！Shift/Kでブースト加速！',
        briefing_keys: 'WASD移動ドリブル・スペース/J長押しシュート・Shift/Kダッシュ',
        briefing_touch: '左スティックでドリブル・シュート長押し・ダッシュで加速',
        k_touch: '<b>タッチ</b>：左スティックで移動、右ボタンでダッシュ＆長押しシュート',
        k_keys: '<b>キーボード</b>：WASD / 矢印キーで移動、スペース / J で長押しシュート、Shift / K でダッシュ',
        k_mark: 'ゴールには<b>自動キーパー</b>がいます。近くから打つほど入りやすい。フルパワーは浮く仕様',
        k_rule: '2 分間の試合。先に 5 点で即勝利。同点ならゴールデンゴール。',
        ko_me: 'あなたのキックオフ', ko_opp: '相手のキックオフ',
        modal_keys_html: `
            <table>
                <tr><th>キー</th><th>動作</th><th>効果</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">矢印</kbd></td><td>移動・ドリブル</td><td>ドリブル突破と激しい体当たり</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (タップ)</td><td>ショートパス</td><td>近距離での素早いパス・押し込み</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (長押し)</td><td>💥 強烈キャノンシュート</td><td>ゲージを溜めて離すと、相手の頭上を越える強烈シュート</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd></td><td>💨 ブースト加速</td><td>速度が35%アップし、一気に相手を抜き去る</td></tr>
                <tr><td><strong>マウス</strong></td><td>ドラッグで移動 / クリックでシュート</td><td>画面ドラッグでメカ誘導、クリックでキック</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 左スティック</strong>：ドリブルと移動を直感操作。</li>
                <li><strong>💥 シュートボタン</strong>：長押しでパワーチャージ、離してシュート！</li>
                <li><strong>💨 ダッシュボタン</strong>：押し続けてブーストスプリント。</li>
                <li><strong>👆 2本指操作</strong>：ドリブル中に画面を別指でタップすると即座にシュート。</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🤖 キーパードローン</strong>：ゴール前を巡回。至近距離や角度をつけたシュートが有効！</li>
                <li><strong>🚀 弾道の高さ</strong>：フルチャージショットは高さがつき、地上のメカを飛び越えます。</li>
                <li><strong>⏱️ ゴールデンゴール</strong>：2分ハーフ。同点時はサドンデスのゴールデンゴールへ！</li>
            </ul>`
    },
    ko: {
        page_title: 'Link Soccer - 메카 축구',
        tagline: '드리블 돌파 후 <b>상대 골대</b>에 플라즈마 볼을 때려 넣으세요!',
        how_mini: '🕹️ 조이스틱 / 드래그 = 이동<br>💥 슛 버튼 누르고 힘 모으기, 떼면 <b>슛</b>',
        ready_h2: '킥오프 준비',
        btn_dash: '대시',
        btn_kick: '슛',
        k_move: '이동 및 드리블',
        k_kick: '차징 슛 (떼면 킥 / 탭하면 패스)',
        k_dash: '대시 가속',
        k_act1: '차징 슛 (길게 눌러 발사)',
        k_act2: '부스터 대시 가속',
        hud_mouse: '드래그로 드리블 · 클릭으로 슛',
        touch_hint: '🕹️ 스틱으로 드리블<br>💥 <b>길게 눌러 차지</b> 후 슛 · 💨대시!',
        toast_kick: '스페이스/J를 길게 눌러 차지 후 슛! Shift/K로 부스터 대시 돌파!',
        briefing_keys: 'WASD 이동 드리블 · 스페이스/J 길게 눌러 차지 슛 · Shift/K 대시',
        briefing_touch: '왼쪽 스틱 드리블 · 슛 버튼 차지 후 슛 · 대시 가속',
        k_touch: '<b>터치</b>: 왼쪽 스틱으로 이동, 오른쪽 버튼으로 대시 및 차징 슛',
        k_keys: '<b>키보드</b>: WASD 또는 화살표 이동, 스페이스 / J 차징 슛, Shift / K 대시',
        k_mark: '골대에는 <b>자동 골키퍼 드론</b>이 있어요. 가까이서 찰수록 잘 들어갑니다',
        k_rule: '2분 경기, 먼저 5골이면 바로 승리. 동점이면 골든골.',
        ko_me: '내 킥오프', ko_opp: '상대 킥오프',
        modal_keys_html: `
            <table>
                <tr><th>키</th><th>동작</th><th>전투 효과</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">화살표</kbd></td><td>이동 및 드리블</td><td>탱크식 몸싸움 돌파 및 볼 컨트롤</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (탭)</td><td>숏패스 / 밀어넣기</td><td>근거리 빠른 패스 및 마무리 슛</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> (길게 누름)</td><td>💥 차징 캐논 슛</td><td>게이지 충전 후 발사, 수비 메카를 넘기는 고탄도 강슛</td></tr>
                <tr><td><kbd data-key="shift">Shift</kbd> / <kbd data-key="k">K</kbd></td><td>💨 부스터 대시</td><td>속도 35% 증가, 번개같은 돌파 및 태클</td></tr>
                <tr><td><strong>마우스</strong></td><td>드래그 드리블 / 클릭 슛</td><td>마우스 드래그로 이동, 클릭하여 슛</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 왼쪽 가상 스틱</strong>: 직관적인 드리블 및 이동 조작.</li>
                <li><strong>💥 슛 버튼</strong>: 길게 눌러 파워 충전 후 손을 떼어 발사! 탭하면 패스.</li>
                <li><strong>💨 대시 버튼</strong>: 부스터 가속으로 질주.</li>
                <li><strong>👆 투핑거 슛</strong>: 드리블 중 다른 손가락으로 화면을 탭하면 즉시 슈팅.</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🤖 골키퍼 드론</strong>: 골라인 순찰 드론. 가까운 거리 및 측면 각도에서 슛하세요!</li>
                <li><strong>🚀 비행 고도</strong>: 풀파워 슛은 높이 떠올라 지상 수비수를 넘어갑니다.</li>
                <li><strong>⏱️ 골든골</strong>: 2분 정규시간. 무승부 시 먼저 골을 넣는 쪽이 승리하는 골든골 돌입!</li>
            </ul>`
    }
});
