/**
 * Link Tennis — strings (zh / en / ja / ko).
 */
window.TennisI18n = SportKit.i18n({
    zh: {
        page_title: 'Link Tennis - 机甲网球',
        tagline: '机甲<b>自动智能跑位</b>接球，玩家轻划或按键决定落点！',
        how_mini: '🕹️ 摇杆选位 / 划屏击球<br>💥 右侧按钮正手<b>抽球</b>与<b>挑高</b>',
        ready_h2: '准备发球',
        btn_lob: '挑高',
        btn_hit: '抽球',
        k_move: '落点角度调整',
        k_hit: '平击重抽（按键/点击）',
        k_lob: '战术挑高球',
        k_act1: '平击重抽（底线深球）',
        k_act2: '防守挑高（越顶吊球）',
        hud_mouse: '屏幕单指/鼠标轻划击球（滑速控力度，方向控角度）',
        touch_hint: '🤖 <b>机甲自动跑位</b><br>👆 <b>屏幕划动击球</b>（滑速控力量，方向控落点）',
        toast_serve: '机甲自动跟球跑位！在球到达瞬间 划动屏幕 或按 空格/J 抽球！',
        briefing_keys: '自动跑位 · WASD/方向键控角度 · Space/J 抽球 · K 挑高',
        briefing_touch: '无需手动跑位 · 屏幕单指划动击球（向目标方向划）· 支持按键',
        k_touch: '<b>触屏</b>：自动跑位辅助，左侧摇杆可主动走位选角度，右侧抽球/挑高球（也可在画面快速滑球）',
        k_keys: '<b>键盘</b>：WASD 或方向键走位选角度，空格 / J 抽球，K 挑高球',
        k_mark: '球快到身前的黄金瞬间出拍打出 <b>PERFECT</b>：球速更快且带等离子光芒！',
        k_rule: '球必须过网并落在界内，对方两跳未接则己方得分。每两球轮换发球，先到 7 分获胜。',
        serve_me: '你发球：按抽球或划屏发球', serve_opp: '对方发球',
        modal_keys_html: `
            <table>
                <tr><th>按键</th><th>动作</th><th>实战效果</th></tr>
                <tr><td><strong>无需移动按键</strong></td><td>🤖 自动跑位</td><td>机甲战术核心全自动向落点机动奔跑，省心省力！</td></tr>
                <tr><td><kbd data-key="w">W</kbd> / <kbd data-key="arrow">↑</kbd></td><td>变线上死角</td><td>击球时向上侧边线变线拉大角度</td></tr>
                <tr><td><kbd data-key="s">S</kbd> / <kbd data-key="arrow">↓</kbd></td><td>变线下死角</td><td>击球时向下侧边线变线拉大角度</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> / <kbd data-key="d">D</kbd></td><td>💥 平击重抽</td><td>高速低平重抽球，球速极快压制底线</td></tr>
                <tr><td><kbd data-key="k">K</kbd> / <kbd data-key="a">A</kbd></td><td>🌈 战术挑高球</td><td>高弧度飞跃前压对手，落入底线深区</td></tr>
                <tr><td><strong>鼠标 / 屏幕划动</strong></td><td>👆 划动控球 (推荐)</td><td>向目标角度快速滑动！滑速越快球速越猛，滑动方向即球路！</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🤖 智能自动跑位</strong>：无需疲劳操控方向，机甲全自动向落点机动奔跑。</li>
                <li><strong>👆 单指划屏击球（核心体验）</strong>：
                    <ul>
                        <li>向目标方向轻快滑动即可击球！</li>
                        <li>滑动速度越快，击球力量越强（Power 增大）；</li>
                        <li>向后反向滑动直接打出高弧度挑高球（Lob）；</li>
                        <li>轻点屏幕为中路稳健回球。</li>
                    </ul>
                </li>
                <li><strong>动作按键</strong>：亦可使用右侧 <strong>抽球（💥）</strong> 与 <strong>挑高（⚡）</strong> 按钮，配合左侧摇杆微调落点。</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>✨ PERFECT 黄金击球时机</strong>：在球即将到达机甲挥拍范围的刹那出拍，触发金色 <strong>PERFECT</strong> 提示，球速与穿透力大幅提升！</li>
                <li><strong>⚡ 激光屏障中网</strong>：球触击中网或飞出底线/边线直接判对方得分。</li>
                <li><strong>🎾 得分与发球</strong>：球在对方半场弹地 2 次未被接起即可得分。每 2 球轮换发球权，先得 <strong>7 分</strong> 获胜！</li>
            </ul>`
    },
    en: {
        page_title: 'Link Tennis - Mech Tennis',
        tagline: 'Your mech <b>runs to the ball automatically</b> — you just direct the shot!',
        how_mini: '🕹️ Joystick steer / swipe to hit<br>💥 Right buttons for <b>HIT</b> & <b>LOB</b>',
        ready_h2: 'Ready to serve',
        btn_lob: 'LOB',
        btn_hit: 'HIT',
        k_move: 'Position & Aim',
        k_hit: 'Drive Hit',
        k_lob: 'Lob Shot',
        k_act1: 'Flat Drive Hit',
        k_act2: 'Tactical Lob',
        hud_mouse: 'Swipe screen or mouse in shot direction (faster swipe = more power)',
        touch_hint: '🤖 <b>Auto-run assisted</b><br>👆 <b>Swipe to hit</b> (swipe speed = power, angle = aim)',
        toast_serve: 'Mech auto-runs! Swipe screen or press Space/J right as ball arrives!',
        briefing_keys: 'Auto-run · WASD/arrows aim · Space/J drive · K lob',
        briefing_touch: 'No manual running · Swipe toward target to hit · Buttons available',
        k_touch: '<b>Touch</b>: Auto-run assisted, left stick steers, right buttons hit/lob (or swipe on court)',
        k_keys: '<b>Keyboard</b>: WASD or arrows to steer/aim, Space / J to drive, K to lob',
        k_mark: 'Hit <b>just before</b> the ball reaches you for a <b>PERFECT</b> shot: faster and sharper',
        k_rule: 'Clear the net and land in court; 2 bounces on opponent side = 1 point. Serve swaps every 2 points. First to 7 wins.',
        serve_me: 'Your serve: press HIT or swipe', serve_opp: 'Their serve',
        modal_keys_html: `
            <table>
                <tr><th>Key</th><th>Action</th><th>Combat Effect</th></tr>
                <tr><td><strong>No Run Keys Needed</strong></td><td>🤖 Auto-run</td><td>Mech tactical AI tracks and runs to the landing zone automatically</td></tr>
                <tr><td><kbd data-key="w">W</kbd> / <kbd data-key="arrow">↑</kbd></td><td>Aim Top Corner</td><td>Angle shot toward the top sideline</td></tr>
                <tr><td><kbd data-key="s">S</kbd> / <kbd data-key="arrow">↓</kbd></td><td>Aim Bottom Corner</td><td>Angle shot toward the bottom sideline</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> / <kbd data-key="d">D</kbd></td><td>💥 Flat Drive</td><td>High-velocity flat drive pushing rival deep</td></tr>
                <tr><td><kbd data-key="k">K</kbd> / <kbd data-key="a">A</kbd></td><td>🌈 Tactical Lob</td><td>High-arc lob sailing over rushing opponents</td></tr>
                <tr><td><strong>Mouse / Screen Swipe</strong></td><td>👆 Swipe Control (Best)</td><td>Flick toward target! Faster swipe = greater power, angle = flight course!</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🤖 Smart Auto-Run</strong>: No tedious steering required. Mech automatically dashes to position.</li>
                <li><strong>👆 One-Finger Swipe (Core Experience)</strong>:
                    <ul>
                        <li>Flick your finger toward the desired court target!</li>
                        <li>Faster swipe imparts greater power;</li>
                        <li>Flick backwards for a defensive high lob;</li>
                        <li>Tap screen for a solid center drive.</li>
                    </ul>
                </li>
                <li><strong>Action Buttons</strong>: You can also use the <strong>HIT (💥)</strong> and <strong>LOB (⚡)</strong> buttons on the right.</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>✨ PERFECT Timing</strong>: Strike at the exact moment before contact to trigger a golden <strong>PERFECT</strong> shot with boosted velocity!</li>
                <li><strong>⚡ Laser Net Barrier</strong>: Net faults or balls landing out of bounds award the point to your opponent.</li>
                <li><strong>🎾 Scoring & Service</strong>: Ball bouncing twice in rival court scores 1 point. Service swaps every 2 points. First to <strong>7 points</strong> wins!</li>
            </ul>`
    },
    ja: {
        page_title: 'Link Tennis - メカテニス',
        tagline: 'キャラは<b>自動でボールへ走る</b>！あなたは打つ方向を決めるだけ',
        how_mini: '🕹️ スティック位置取り / スワイプ打球<br>💥 右ボタンで<b>強打</b>＆<b>ロブ</b>',
        ready_h2: 'サーブの準備',
        btn_lob: 'ロブ',
        btn_hit: '強打',
        k_move: '移動・コース',
        k_hit: '強打ドライブ',
        k_lob: 'ロブショット',
        k_act1: '強打ドライブ',
        k_act2: '戦術ロブ',
        hud_mouse: '画面を目標方向へスワイプして打球（速いほど威力アップ）',
        touch_hint: '🤖 <b>自動移動アシスト</b><br>👆 <b>画面スワイプで打球</b>（速さで威力、角度でコース）',
        toast_serve: '自動でボールを追尾！ボールが届く瞬間にスワイプかスペース/J！',
        briefing_keys: '自動移動・WASDコース指定・スペース/Jドライブ・Kロブ',
        briefing_touch: '移動操作不要・コース方向へスワイプして打球・ボタン操作も可',
        k_touch: '<b>タッチ</b>：自動移動アシスト、左スティックで微調整、右ボタンで強打＆ロブ（スワイプも可）',
        k_keys: '<b>キーボード</b>：WASD / 矢印キーでコース調整、スペース / J で強打、K でロブ',
        k_mark: 'ボールが来る<b>直前</b>に打つと <b>PERFECT</b>：速くて鋭いショットに',
        k_rule: 'ネットを越えて相手コートに入れ、相手側で 2 回バウンドしたら得点。2 点ごとにサーブ交代。先に 7 点で勝ち。',
        serve_me: 'あなたのサーブ：強打かスワイプで打つ', serve_opp: '相手のサーブ',
        modal_keys_html: `
            <table>
                <tr><th>キー</th><th>動作</th><th>効果</th></tr>
                <tr><td><strong>移動操作不要</strong></td><td>🤖 自動移動</td><td>メカが自動で落下地点へ走るため、打球に集中できます</td></tr>
                <tr><td><kbd data-key="w">W</kbd> / <kbd data-key="arrow">↑</kbd></td><td>上サイド狙い</td><td>打球時に画面上側のサイドラインへ角度をつける</td></tr>
                <tr><td><kbd data-key="s">S</kbd> / <kbd data-key="arrow">↓</kbd></td><td>下サイド狙い</td><td>打球時に画面下側のサイドラインへ角度をつける</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> / <kbd data-key="d">D</kbd></td><td>💥 ドライブ</td><td>相手コート深くに突き刺さる低空高速ショット</td></tr>
                <tr><td><kbd data-key="k">K</kbd> / <kbd data-key="a">A</kbd></td><td>🌈 ロブ</td><td>前進してきた相手の頭上を越す山なりのショット</td></tr>
                <tr><td><strong>マウス / スワイプ</strong></td><td>👆 スワイプ操作 (推奨)</td><td>狙う方向へ素早くスワイプ！速いほど威力アップ、方向がそのままコースに！</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🤖 自動移動アシスト</strong>：移動キー不要で、メカが自動的にボールを追います。</li>
                <li><strong>👆 画面スワイプ打球（一番快適）</strong>：
                    <ul>
                        <li>打ちたい方向へ画面をスワイプするだけでショット！</li>
                        <li>スワイプが速いほど強烈なショットになります；</li>
                        <li>後ろへスワイプすると守備的なロブショットになります；</li>
                        <li>画面タップでセンターへの手堅いリターン。</li>
                    </ul>
                </li>
                <li><strong>ボタン操作</strong>：右側の <strong>強打（💥）</strong> と <strong>ロブ（⚡）</strong> ボタンも使用可能。</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>✨ PERFECT タイミング</strong>：ボールが届く直前のベストタイミングで打つと金色 <strong>PERFECT</strong> が発動、球速がアップ！</li>
                <li><strong>⚡ レーザーネット</strong>：ネットにかかるかコート外に出ると相手の得点。</li>
                <li><strong>🎾 得点と勝利</strong>：相手コートで2バウンドさせると1点。2点ごとにサーブ権が交代し、先に <strong>7点</strong> 先取で勝利！</li>
            </ul>`
    },
    ko: {
        page_title: 'Link Tennis - 메카 테니스',
        tagline: '캐릭터가 <b>알아서 공으로 달려가요</b>. 당신은 방향만 정하면 끝!',
        how_mini: '🕹️ 스틱 위치선정 / 스와이프 샷<br>💥 오른쪽 버튼으로 <b>강타</b> 및 <b>로브</b>',
        ready_h2: '서브 준비',
        btn_lob: '로브',
        btn_hit: '강타',
        k_move: '이동 및 코스',
        k_hit: '강타 드라이브',
        k_lob: '로브 샷',
        k_act1: '강타 드라이브',
        k_act2: '전술 로브',
        hud_mouse: '화면을 목표 방향으로 스와이프 타구 (빠를수록 강력한 파워)',
        touch_hint: '🤖 <b>자동 위치선정</b><br>👆 <b>화면 스와이프 타구</b> (속도=파워, 각도=코스)',
        toast_serve: '메카가 자동으로 공을 추적! 공이 도착하는 순간 스와이프 또는 스페이스/J!',
        briefing_keys: '자동 이동 · WASD 코스 조절 · 스페이스/J 드라이브 · K 로브',
        briefing_touch: '이동 조작 불필요 · 코스 방향으로 스와이프하여 타구 · 버튼 가능',
        k_touch: '<b>터치</b>: 자동 이동 보조, 왼쪽 스틱으로 코스 조절, 오른쪽 버튼으로 강타 및 로브',
        k_keys: '<b>키보드</b>: WASD 또는 방향키로 코스 조절, 스페이스 / J 강타, K 로브',
        k_mark: '공이 오기 <b>직전에</b> 치면 <b>PERFECT</b>: 더 빠르고 날카로운 샷',
        k_rule: '네트를 넘겨 상대 코트에 떨어뜨리고, 상대 쪽에서 두 번 튀면 득점. 2점마다 서브 교대, 먼저 7점이면 승리.',
        serve_me: '내 서브: 강타 누르거나 스와이프', serve_opp: '상대 서브',
        modal_keys_html: `
            <table>
                <tr><th>키</th><th>동작</th><th>전투 효과</th></tr>
                <tr><td><strong>이동 조작 불필요</strong></td><td>🤖 자동 이동</td><td>메카 AI가 낙하지점을 예측하여 자동으로 달려갑니다</td></tr>
                <tr><td><kbd data-key="w">W</kbd> / <kbd data-key="arrow">↑</kbd></td><td>상단 사이드라인</td><td>타구 시 윗쪽 사이드라인 코스로 각도 조절</td></tr>
                <tr><td><kbd data-key="s">S</kbd> / <kbd data-key="arrow">↓</kbd></td><td>하단 사이드라인</td><td>타구 시 아랫쪽 사이드라인 코스로 각도 조절</td></tr>
                <tr><td><kbd data-key="space">Space</kbd> / <kbd data-key="j">J</kbd> / <kbd data-key="d">D</kbd></td><td>💥 강타 드라이브</td><td>상대 베이스라인 깊숙이 꽂히는 고속 직선타</td></tr>
                <tr><td><kbd data-key="k">K</kbd> / <kbd data-key="a">A</kbd></td><td>🌈 전술 로브</td><td>전진한 상대를 넘기는 고탄도 띄우기 샷</td></tr>
                <tr><td><strong>마우스 / 스와이프</strong></td><td>👆 스와이프 타구 (추천)</td><td>원하는 방향으로 튕기듯 스와이프! 빠를수록 강한 파워, 각도가 곧 코스!</td></tr>
            </table>`,
        modal_touch_html: `
            <ul>
                <li><strong>🤖 스마트 자동 이동</strong>: 이동 조작 없이도 메카가 알아서 공을 쫓아갑니다.</li>
                <li><strong>👆 원핑거 스와이프 (핵심 재미)</strong>:
                    <ul>
                        <li>원하는 방향으로 손가락을 가볍게 튕기면 타구!</li>
                        <li>스와이프 속도가 빠를수록 더욱 강력한 파워;</li>
                        <li>뒤로 스와이프하면 수비용 높은 로브 샷;</li>
                        <li>화면 탭으로 중앙 안정적인 리턴.</li>
                    </ul>
                </li>
                <li><strong>버튼 조작</strong>: 우측 <strong>강타 (💥)</strong> 및 <strong>로브 (⚡)</strong> 버튼도 사용 가능합니다.</li>
            </ul>`,
        modal_rules_html: `
            <ul>
                <li><strong>✨ PERFECT 타이밍</strong>: 공이 도착하기 직전 황금 타이밍에 치면 금색 <strong>PERFECT</strong> 효과 발동!</li>
                <li><strong>⚡ 레이저 네트</strong>: 네트에 걸리거나 아웃되면 상대방 득점.</li>
                <li><strong>🎾 득점 및 서브</strong>: 상대 코트에서 2회 바운드되면 1점. 2점마다 서브권 교대, 먼저 <strong>7점</strong> 내면 승리!</li>
            </ul>`
    }
});
