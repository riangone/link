/**
 * Link Volley — strings (zh / en / ja / ko).
 */
window.VolleyI18n = SportKit.i18n({
    zh: {
        page_title: 'Link Volley - 机甲排球',
        tagline: '把等离子球击过网，落在<b>对方场地</b>即可得分！',
        how_mini: '🕹️ 摇杆跑位 / 拖动画布<br>⚡ 按钮起跳，空中按扣杀键<b>暴扣</b>',
        ready_h2: '准备开球',
        btn_jump: '起跳',
        btn_spike: '扣杀',
        k_move: '全向移动',
        k_jump: '起跳 / 拦网',
        k_spike: '空中扣杀',
        k_midair: '空中',
        k_act1: '起跳 / 拦网',
        k_act2: '空中暴风扣杀',
        hud_mouse: '拖动画布移动 · 单击起跳',
        touch_hint: '🕹️ 摇杆跑位 / 拖动画布<br>💨 按钮起跳 · 空中⚡<b>暴扣</b>！',
        toast_serve: '站在金色落点圈内 · 空格/J起跳 · 空中按 K 扣杀！',
        briefing_keys: 'WASD / 方向键移动 · Space / J 起跳 · 空中按 K 暴扣',
        briefing_touch: '左摇杆移动 · 右侧起跳与空中扣杀 · 支持画布拖拽',
        k_touch: '<b>触屏</b>：左侧摇杆移动，右侧起跳与空中扣杀（也可直接拖动画布）',
        k_keys: '<b>键盘</b>：WASD 或方向键移动，空格 / J 起跳，空中按 K 或再按空格扣杀',
        k_mark: '地上的<b>能量光圈</b>是球的落点，站过去就能接到并垫起',
        k_rule: '球落在对方场地界内得 1 分，先得 {n} 分的赢。己方半场最多触球 3 次。得分方发球。',
        pt_me: '得分！',
        pt_opp: '对方得分',
        serve_me: '你发球',
        serve_opp: '对方发球',
        modal_keys_html: `
            <table>
                <tr><th>按键</th><th>动作</th><th>实战效果</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">方向键</kbd></td><td>移动跑位</td><td>在己方半场内全向机动，提前占领落点</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd></td><td>起跳 / 拦网</td><td>跃入空中迎击高空球或在网前起跳拦截</td></tr>
                <tr><td>空中按 <kbd data-key="k">K</kbd> 或再按 <kbd data-key="space">Space</kbd></td><td>⚡ 暴风扣杀</td><td>在空中对准球猛烈下扣，等离子球极速射向对方半场</td></tr>
                <tr><td><strong>鼠标拖拽</strong></td><td>跟随移动</td><td>按住鼠标在半场内拖动，机甲自动跑向指针位置</td></tr>
                <tr><td><strong>鼠标单击</strong></td><td>起跳</td><td>快速轻点画面触发起跳</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 左侧虚拟摇杆</strong>：全向滑行机甲，精准走位。</li>
                <li><strong>💨 起跳按钮</strong>：按下后机甲喷射起跳。</li>
                <li><strong>⚡ 扣杀按钮</strong>：在机甲处于空中时按下，触发<strong>强力扣杀</strong>（地面按会自动起跳）。</li>
                <li><strong>👆 屏幕拖拽</strong>：可直接在半场拖动手指引领机甲移动，双指轻触或短按画布起跳。</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🎯 落地光圈预判</strong>：球在空中飞行时，地面会渲染旋转能量光圈，表示<strong>球落地的精确位置与时间</strong>。机甲只需站在光圈内即可自动垫球回击！</li>
                <li><strong>⚡ 扣杀时机</strong>：当球处于机甲头顶上方时跳起并按下扣杀，扣杀球附带等离子尾迹，对手极难反应。</li>
                <li><strong>⚠️ 触球限制</strong>：己方半场最多连续触球 <strong>3 次</strong>，第 3 次前必须击球过网，否则判对方得分。</li>
                <li><strong>🏆 获胜条件</strong>：球落在对方场地界内得 1 分；先得 <strong>7 分</strong> 夺得竞技冠军！由得分方发球。</li>
            </ul>`
    },
    en: {
        page_title: 'Link Volley - Mech Volley',
        tagline: 'Hit the plasma ball over the net — land it on <b>their side</b> to score!',
        how_mini: '🕹️ Joystick / drag = run<br>⚡ Tap jump, press spike in the air to <b>SPIKE</b>',
        ready_h2: 'Ready to serve',
        btn_jump: 'JUMP',
        btn_spike: 'SPIKE',
        k_move: 'Move',
        k_jump: 'Jump / Block',
        k_spike: 'Spike',
        k_midair: 'In-Air',
        k_act1: 'Jump / Block',
        k_act2: 'Air Spike',
        hud_mouse: 'Drag to move · Click to jump',
        touch_hint: '🕹️ Stick / drag = move<br>💨 Tap jump · ⚡<b>Spike</b> in air!',
        toast_serve: 'Stand on the gold landing ring · Space/J jump · K to spike!',
        briefing_keys: 'WASD / Arrows to move · Space / J jump · K in air to spike',
        briefing_touch: 'Left stick move · Right buttons jump & spike · Drag supported',
        k_touch: '<b>Touch</b>: Left stick to run, right buttons to jump & spike (or drag on canvas)',
        k_keys: '<b>Keyboard</b>: WASD or arrows to move, Space / J to jump, K or Space again to spike',
        k_mark: 'The <b>ring</b> on the floor shows where the ball will land — stand there',
        k_rule: 'Ball lands on their side = 1 point. First to {n} wins. 3 touches max per side. Rally winner serves.',
        pt_me: 'Point!',
        pt_opp: 'Their point',
        serve_me: 'Your serve',
        serve_opp: 'Their serve',
        modal_keys_html: `
            <table>
                <tr><th>Key</th><th>Action</th><th>Combat Effect</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">Arrows</kbd></td><td>Move</td><td>Maneuver around your half-court to position under the ball</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd></td><td>Jump / Block</td><td>Leap up to intercept high balls or block at the net</td></tr>
                <tr><td>In air: <kbd data-key="k">K</kbd> or <kbd data-key="space">Space</kbd></td><td>⚡ Spike</td><td>Slam the ball downward at high velocity toward opponent court</td></tr>
                <tr><td><strong>Mouse Drag</strong></td><td>Follow Move</td><td>Drag pointer on court to make mech run toward cursor</td></tr>
                <tr><td><strong>Mouse Click</strong></td><td>Jump</td><td>Quick tap on canvas to jump</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ Left Virtual Stick</strong>: Steer mech in any direction.</li>
                <li><strong>💨 Jump Button</strong>: Jet jump into the air.</li>
                <li><strong>⚡ Spike Button</strong>: Smash the ball when airborne (auto-jumps if grounded).</li>
                <li><strong>👆 Screen Gestures</strong>: Drag directly on court to move, tap to jump.</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🎯 Landing Ring</strong>: Glowing ground ring marks exact ball impact spot. Stand inside to bump it.</li>
                <li><strong>⚡ Spike Timing</strong>: Jump when ball is above your head and press Spike for maximum power.</li>
                <li><strong>⚠️ 3-Touch Limit</strong>: Maximum 3 hits per side before returning over the net.</li>
                <li><strong>🏆 Win Condition</strong>: First to <strong>7 points</strong> wins the match!</li>
            </ul>`
    },
    ja: {
        page_title: 'Link Volley - メカバレー',
        tagline: 'プラズマ球をネットの向こうへ！<b>相手コート</b>に落とせば得点！',
        how_mini: '🕹️ スティック / ドラッグで移動<br>⚡ ジャンプボタン、空中で<b>スパイク</b>',
        ready_h2: 'サーブの準備',
        btn_jump: 'ジャンプ',
        btn_spike: 'スパイク',
        k_move: '移動',
        k_jump: 'ジャンプ / ブロック',
        k_spike: 'スパイク',
        k_midair: '空中',
        k_act1: 'ジャンプ / ブロック',
        k_act2: '空中スパイク',
        hud_mouse: 'ドラッグで移動・クリックでジャンプ',
        touch_hint: '🕹️ スティック/ドラッグ移動<br>💨 ジャンプ・空中⚡<b>スパイク</b>！',
        toast_serve: '金色の着地点に入り、スペース/Jでジャンプ、空中でKでスパイク！',
        briefing_keys: 'WASD / 矢印で移動・スペース/Jでジャンプ・空中Kでスパイク',
        briefing_touch: '左スティックで移動・右ボタンでジャンプ＆スパイク・ドラッグ操作可',
        k_touch: '<b>タッチ</b>：左スティックで移動、右ボタンでジャンプ＆スパイク（画面ドラッグも可）',
        k_keys: '<b>キーボード</b>：WASD / 矢印キーで移動、スペース / J でジャンプ、K かもう一度スペースでスパイク',
        k_mark: '床の<b>輪っか</b>がボールの落下地点。そこに立てばレシーブできます',
        k_rule: '相手コートに落とすと 1 点、先に {n} 点で勝ち。自コート最大3タッチ。点を取った方がサーブ。',
        pt_me: '得点！',
        pt_opp: '相手の得点',
        serve_me: 'あなたのサーブ',
        serve_opp: '相手のサーブ',
        modal_keys_html: `
            <table>
                <tr><th>キー</th><th>動作</th><th>効果</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">矢印</kbd></td><td>移動</td><td>自陣コート内を自在に走り、落下地点へ先回り</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd></td><td>ジャンプ / ブロック</td><td>ジャンプして高いボールを迎撃、またはネット際でブロック</td></tr>
                <tr><td>空中で <kbd data-key="k">K</kbd> / <kbd data-key="space">Space</kbd></td><td>⚡ スパイク</td><td>空中でボールを強烈に叩きつけ、相手コートへ打ち込む</td></tr>
                <tr><td><strong>マウスドラッグ</strong></td><td>移動</td><td>コート上をドラッグしてメカを誘導</td></tr>
                <tr><td><strong>マウスクリック</strong></td><td>ジャンプ</td><td>画面をクリックしてジャンプ</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 左スティック</strong>：自由自在に全方向移動。</li>
                <li><strong>💨 ジャンプボタン</strong>：メカが噴射ジャンプ。</li>
                <li><strong>⚡ スパイクボタン</strong>：空中で強力スパイクを発動。</li>
                <li><strong>👆 画面操作</strong>：コート上をドラッグして移動、タップでジャンプ。</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🎯 落下地点サークル</strong>：床の光る輪がボールの着地点。そこに入れば確実にレシーブ可能！</li>
                <li><strong>⚡ スパイクのコツ</strong>：頭上にボールが来たタイミングで跳び上がりスパイク！</li>
                <li><strong>⚠️ 3タッチ制限</strong>：自陣では最大3回まで触球可能。</li>
                <li><strong>🏆 勝利条件</strong>：先に <strong>7点</strong> 先取で勝利！</li>
            </ul>`
    },
    ko: {
        page_title: 'Link Volley - 메카 배구',
        tagline: '플라즈마 공을 네트 너머로! <b>상대 코트</b>에 떨어뜨리면 득점!',
        how_mini: '🕹️ 조이스틱 / 드래그 = 이동<br>⚡ 점프 버튼, 공중에서 <b>스파이크</b>',
        ready_h2: '서브 준비',
        btn_jump: '점프',
        btn_spike: '스파이크',
        k_move: '이동',
        k_jump: '점프 / 블로킹',
        k_spike: '스파이크',
        k_midair: '공중',
        k_act1: '점프 / 블로킹',
        k_act2: '공중 스파이크',
        hud_mouse: '드래그로 이동 · 클릭으로 점프',
        touch_hint: '🕹️ 스틱/드래그 이동<br>💨 점프 · 공중⚡<b>스파이크</b>!',
        toast_serve: '금색 착지 원에 서서 스페이스/J 점프, 공중에서 K 스파이크!',
        briefing_keys: 'WASD / 화살표 이동 · 스페이스/J 점프 · 공중 K 스파이크',
        briefing_touch: '왼쪽 스틱 이동 · 오른쪽 점프 및 스파이크 · 드래그 지원',
        k_touch: '<b>터치</b>: 왼쪽 스틱으로 이동, 오른쪽 버튼으로 점프 및 스파이크 (화면 드래그 가능)',
        k_keys: '<b>키보드</b>: WASD 또는 화살표 이동, 스페이스 / J 점프, K 또는 스페이스 다시 눌러 스파이크',
        k_mark: '바닥의 <b>에너지 링</b>이 공의 낙하지점입니다. 거기 서 있으면 받아낼 수 있습니다',
        k_rule: '상대 코트에 떨어지면 1점, 먼저 {n}점 내면 승리. 진영당 최대 3회 터치. 득점한 쪽이 서브.',
        pt_me: '득점!',
        pt_opp: '상대 득점',
        serve_me: '내 서브',
        serve_opp: '상대 서브',
        modal_keys_html: `
            <table>
                <tr><th>키</th><th>동작</th><th>전투 효과</th></tr>
                <tr><td><kbd data-key="w">W</kbd><kbd data-key="a">A</kbd><kbd data-key="s">S</kbd><kbd data-key="d">D</kbd> / <kbd data-key="arrow">화살표</kbd></td><td>이동</td><td>자신 진영 내에서 자유롭게 이동하여 낙하지점 선점</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd></td><td>점프 / 블로킹</td><td>도약하여 높은 공을 리시브하거나 네트 앞에서 블로킹</td></tr>
                <tr><td>공중에서 <kbd data-key="k">K</kbd> / <kbd data-key="space">Space</kbd></td><td>⚡ 스파이크</td><td>공중에서 공을 강타하여 상대 코트로 고속 강하</td></tr>
                <tr><td><strong>마우스 드래그</strong></td><td>이동</td><td>코트를 드래그하여 메카 이동</td></tr>
                <tr><td><strong>마우스 클릭</strong></td><td>점프</td><td>화면을 클릭하여 점프</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🕹️ 왼쪽 가상 스틱</strong>: 전 방향 부드러운 이동.</li>
                <li><strong>💨 점프 버튼</strong>: 점프 부스터 발동.</li>
                <li><strong>⚡ 스파이크 버튼</strong>: 공중에서 강력한 스파이크 강타.</li>
                <li><strong>👆 제스처 조작</strong>: 코트 위 드래그로 이동, 탭으로 점프.</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>🎯 낙하지점 링</strong>: 바닥의 회전 에너지 링이 낙하지점을 표시합니다.</li>
                <li><strong>⚡ 스파이크 타이밍</strong>: 공이 메카 머리 위에 도달했을 때 점프 스파이크!</li>
                <li><strong>⚠️ 3터치 제한</strong>: 자진영 최대 3회까지 볼 터치 가능.</li>
                <li><strong>🏆 승리 조건</strong>: 먼저 <strong>7점</strong> 획득 시 승리!</li>
            </ul>`
    }
});
