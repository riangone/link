/**
 * Game invites: "tap a device/friend -> pick a game -> they accept ->
 * both browsers jump into the same game room".
 *
 * Transport: plain signaling-server relay. The server already forwards any
 * message carrying a `to: <peerId>` field verbatim (adding `sender`), both
 * inside a room and process-wide via `_peersById` — so this module needs no
 * server changes. Message types (all relayed):
 *
 *   game-invite          {inviteId, game, roomId, fromName}
 *   game-invite-response {inviteId, accept, reason?}
 *   game-invite-cancel   {inviteId}
 *
 * Targets:
 *   - local peers (PeerUI on the home screen): already have a peerId
 *   - friends / public devices: resolved deviceId -> peerId through
 *     FriendsManager#findDevice, then the exact same protocol.
 *
 * Once accepted, both sides navigate to `<game>/?opponent=<name>#room-<roomId>`.
 * Every game page already pairs two browsers by that room hash
 * (GameSession, first in = host), so the games themselves are untouched.
 *
 * Available games come from the `data-games` attribute on this <script>
 * tag (comma-separated folder names), so deployments that ship a subset of
 * games (link-lite) can list only what exists.
 */
(function () {
    'use strict';

    const CATALOG = {
        hockey: { emoji: '🏒', key: 'game_name_hockey' },
        brawl:  { emoji: '🍑', key: 'game_name_brawl' },
        tanks:  { emoji: '💥', key: 'game_name_tanks' },
        gomoku: { emoji: '⚫', key: 'game_name_gomoku' },
        pong:   { emoji: '🏓', key: 'game_name_pong' },
        tron:   { emoji: '🏍️', key: 'game_name_tron' },
        blaster: { emoji: '🫧', key: 'game_name_blaster' },
        blocks: { emoji: '🍬', key: 'game_name_blocks' },
        bombs:  { emoji: '💧', key: 'game_name_bombs' },
        tag:    { emoji: '👻', key: 'game_name_tag' },
        paint:  { emoji: '🎨', key: 'game_name_paint' },
        kart:   { emoji: '🏎️', key: 'game_name_kart' },
        kart3d: { emoji: '🏁', key: 'game_name_kart3d' },
        spin:   { emoji: '🌀', key: 'game_name_spin' },
        spin3d: { emoji: '🌀', key: 'game_name_spin3d' },
        armor:  { emoji: '🛡️', key: 'game_name_armor' },
        volley: { emoji: '🏐', key: 'game_name_volley' },
        soccer: { emoji: '⚽', key: 'game_name_soccer' },
        tennis: { emoji: '🎾', key: 'game_name_tennis' },
        hoops:  { emoji: '🏀', key: 'game_name_hoops' },
        oni:    { emoji: '🥋', key: 'game_name_oni' }
    };

    const scriptEl = document.currentScript;
    const configured = ((scriptEl && scriptEl.dataset.games) || Object.keys(CATALOG).join(','))
        .split(',').map(s => s.trim()).filter(id => CATALOG[id]);
    const GAMES = configured.map(id => Object.assign({ id }, CATALOG[id]));

    const INVITE_TIMEOUT_MS = 30000;
    const ROOM_RE = /^[a-z0-9]{4,16}$/;

    // --- i18n (merged into the shared dictionary so I18n.t() just works) --
    const STRINGS = {
        en: {
            game_name_hockey: 'Air Hockey', game_name_brawl: 'Mochi Brawl', game_name_tanks: 'Ricochet Tanks',
            game_name_gomoku: 'Blitz Gomoku', game_name_pong: 'Neon Pong', game_name_tron: 'Neon Tron', game_name_blaster: 'Bubble Blaster', game_name_blocks: 'Candy Blocks', game_name_bombs: 'Water Balloon Battle', game_name_tag: 'Bubble Tag', game_name_paint: 'Roller Paint', game_name_kart: 'Link Kart', game_name_kart3d: 'Link Kart 3D', game_name_spin: 'Link Spin', game_name_spin3d: 'Link Spin 3D', game_name_armor: 'Link Armor', game_name_volley: 'Mech Volley', game_name_soccer: 'Mech Soccer', game_name_tennis: 'Mech Tennis', game_name_hoops: 'Mech Hoops', game_name_oni: 'Oni Combat',
            game_invite_button: 'Challenge',
            game_invite_button_title: 'Invite to a game',
            game_picker_title: 'Challenge {name}',
            game_picker_hint: 'Pick a game — they\'ll get an invite to accept',
            game_picker_waiting: 'Waiting for {name} to accept {game}…',
            game_picker_cancel: 'Cancel',
            game_picker_cancel_invite: 'Cancel invite',
            game_incoming_title: 'Game challenge',
            game_incoming_body: '{name} challenges you to {game}!',
            game_incoming_accept: 'Accept & play',
            game_incoming_decline: 'Decline',
            game_incoming_expires: 'Expires in {s}s',
            game_invite_declined_toast: '{name} declined the challenge',
            game_invite_busy_toast: '{name} is busy with another invite',
            game_invite_timeout_toast: '{name} didn\'t respond in time',
            game_invite_offline_toast: '{name} is offline right now',
            game_invite_cancelled_toast: 'The challenge was cancelled',
            game_match_starting_toast: 'Challenge accepted — starting {game}…',
            game_invite_disconnected_toast: 'Not connected to the server yet, try again in a moment'
        },
        zh: {
            game_name_hockey: '霓虹气垫球', game_name_brawl: '萌团大乱斗', game_name_tanks: '弹射坦克',
            game_name_gomoku: '闪电五子棋', game_name_pong: '霓虹弹球', game_name_tron: '光轮对决', game_name_blaster: '萌萌泡泡枪', game_name_blocks: '萌萌方块', game_name_bombs: '水弹大作战', game_name_tag: '泡泡鬼抓人', game_name_paint: '滚筒涂地', game_name_kart: '萌萌卡丁车', game_name_kart3d: '3D 卡丁车', game_name_spin: '爆旋陀螺', game_name_spin3d: '3D 爆旋陀螺', game_name_armor: '装甲对决', game_name_volley: '机甲排球', game_name_soccer: '机甲足球', game_name_tennis: '机甲网球', game_name_hoops: '机甲篮球', game_name_oni: '奥尼',
            game_invite_button: '约战',
            game_invite_button_title: '邀请对战',
            game_picker_title: '向 {name} 发起约战',
            game_picker_hint: '选择一款游戏，对方确认后双方自动进入房间',
            game_picker_waiting: '等待 {name} 接受【{game}】…',
            game_picker_cancel: '取消',
            game_picker_cancel_invite: '取消邀请',
            game_incoming_title: '对战邀请',
            game_incoming_body: '{name} 邀请你对战【{game}】！',
            game_incoming_accept: '接受并开战',
            game_incoming_decline: '拒绝',
            game_incoming_expires: '{s} 秒后过期',
            game_invite_declined_toast: '{name} 拒绝了对战邀请',
            game_invite_busy_toast: '{name} 正在处理其他邀请',
            game_invite_timeout_toast: '{name} 未及时响应',
            game_invite_offline_toast: '{name} 当前不在线',
            game_invite_cancelled_toast: '对方已取消对战邀请',
            game_match_starting_toast: '对方已接受 — 正在进入【{game}】…',
            game_invite_disconnected_toast: '尚未连接服务器，请稍后再试'
        },
        ja: {
            game_name_hockey: 'エアホッケー', game_name_brawl: 'もちもち大乱闘', game_name_tanks: '跳弾タンク',
            game_name_gomoku: '電光五目並べ', game_name_pong: 'ネオンポン', game_name_tron: 'ネオントロン', game_name_blaster: 'バブルブラスター', game_name_blocks: 'キャンディブロック', game_name_bombs: '水風船バトル', game_name_tag: 'バブル鬼ごっこ', game_name_paint: 'ローラーぬりぬり', game_name_kart: 'もちもちカート', game_name_kart3d: '3D カート', game_name_spin: 'ベイバトル', game_name_spin3d: '3D ベイバトル', game_name_armor: 'タンク対決', game_name_volley: 'メカバレー', game_name_soccer: 'メカサッカー', game_name_tennis: 'メカテニス', game_name_hoops: 'メカバスケ', game_name_oni: 'オニ・コンバット',
            game_invite_button: '対戦',
            game_invite_button_title: '対戦に招待',
            game_picker_title: '{name} に対戦を申し込む',
            game_picker_hint: 'ゲームを選択 — 相手が承認すると自動で入室します',
            game_picker_waiting: '{name} が「{game}」を承認するのを待っています…',
            game_picker_cancel: 'キャンセル',
            game_picker_cancel_invite: '招待を取り消す',
            game_incoming_title: '対戦の招待',
            game_incoming_body: '{name} から「{game}」の対戦申し込み！',
            game_incoming_accept: '承認して開始',
            game_incoming_decline: '拒否',
            game_incoming_expires: 'あと {s} 秒',
            game_invite_declined_toast: '{name} が対戦を拒否しました',
            game_invite_busy_toast: '{name} は他の招待に対応中です',
            game_invite_timeout_toast: '{name} から応答がありませんでした',
            game_invite_offline_toast: '{name} は現在オフラインです',
            game_invite_cancelled_toast: '対戦の招待が取り消されました',
            game_match_starting_toast: '承認されました — 「{game}」を開始…',
            game_invite_disconnected_toast: 'サーバー未接続です。少し待ってから再試行してください'
        },
        ko: {
            game_name_hockey: '에어하키', game_name_brawl: '모찌 난투', game_name_tanks: '리코셰 탱크',
            game_name_gomoku: '번개 오목', game_name_pong: '네온 퐁', game_name_tron: '네온 트론', game_name_blaster: '버블 블래스터', game_name_blocks: '캔디 블록', game_name_bombs: '물풍선 대작전', game_name_tag: '버블 술래잡기', game_name_paint: '롤러 땅따먹기', game_name_kart: '모찌 카트', game_name_kart3d: '3D 카트', game_name_spin: '팽이 배틀', game_name_spin3d: '3D 팽이 배틀', game_name_armor: '탱크 대결', game_name_volley: '메카 배구', game_name_soccer: '메카 축구', game_name_tennis: '메카 테니스', game_name_hoops: '메카 농구', game_name_oni: '오니 대전',
            game_invite_button: '대전',
            game_invite_button_title: '대전 초대',
            game_picker_title: '{name}에게 대전 신청',
            game_picker_hint: '게임을 고르세요 — 상대가 수락하면 자동으로 입장합니다',
            game_picker_waiting: '{name}님이 [{game}] 수락하기를 기다리는 중…',
            game_picker_cancel: '취소',
            game_picker_cancel_invite: '초대 취소',
            game_incoming_title: '대전 초대',
            game_incoming_body: '{name}님이 [{game}] 대전을 신청했습니다!',
            game_incoming_accept: '수락하고 시작',
            game_incoming_decline: '거절',
            game_incoming_expires: '{s}초 후 만료',
            game_invite_declined_toast: '{name}님이 대전을 거절했습니다',
            game_invite_busy_toast: '{name}님이 다른 초대를 처리 중입니다',
            game_invite_timeout_toast: '{name}님이 응답하지 않았습니다',
            game_invite_offline_toast: '{name}님은 현재 오프라인입니다',
            game_invite_cancelled_toast: '대전 초대가 취소되었습니다',
            game_match_starting_toast: '수락됨 — [{game}] 시작 중…',
            game_invite_disconnected_toast: '아직 서버에 연결되지 않았습니다. 잠시 후 다시 시도하세요'
        }
    };
    if (window.I18n && window.I18n.dictionary) {
        Object.keys(STRINGS).forEach(lang => {
            window.I18n.dictionary[lang] = Object.assign(window.I18n.dictionary[lang] || {}, STRINGS[lang]);
        });
    }
    const t = (key, rep) => (window.I18n ? window.I18n.t(key, rep) : key);
    const gameLabel = id => {
        const g = CATALOG[id];
        return g ? `${g.emoji} ${t(g.key)}` : id;
    };
    const randomId = () => Math.random().toString(36).substring(2, 10);
    const myName = () => window.myDisplayName || 'Someone';

    // ---------------------------------------------------------------------
    // Protocol / state
    // ---------------------------------------------------------------------
    class GameInviteManager {
        constructor(server) {
            this._server = server;
            this._outgoing = null; // {inviteId, peerId, game, roomId, name, timer}
            this._incoming = null; // {inviteId, peerId, game, roomId, fromName, timer}
            Events.on('game-invite', e => this._onInvite(e.detail));
            Events.on('game-invite-response', e => this._onResponse(e.detail));
            Events.on('game-invite-cancel', e => this._onCancel(e.detail));
            Events.on('peer-left', e => {
                if (this._outgoing && this._outgoing.peerId === e.detail) this._failOutgoing('game_invite_offline_toast');
            });
        }

        get games() { return GAMES; }

        _connected() {
            return !!(this._server && this._server._isConnected && this._server._isConnected());
        }

        /** Invite a friend/public device by deviceId. @returns 'sent'|'offline'|'disconnected' */
        async inviteDevice(deviceId, game, name) {
            const fm = window.friendsManager;
            if (!fm) return 'offline';
            const res = await fm.findDevice(deviceId);
            if (!res || !res.online) return 'offline';
            const resolvedName = name || (res.peer && res.peer.name && res.peer.name.displayName);
            return this.invitePeer(res.peerId, game, resolvedName);
        }

        /** Invite a peer we already know the signaling id of. */
        invitePeer(peerId, game, name) {
            if (!CATALOG[game] || !GAMES.some(g => g.id === game)) throw new Error('unknown game ' + game);
            if (!this._connected()) return 'disconnected';
            this.cancel();
            const inviteId = randomId();
            const roomId = randomId();
            const timer = setTimeout(() => this._failOutgoing('game_invite_timeout_toast'), INVITE_TIMEOUT_MS);
            this._outgoing = { inviteId, peerId, game, roomId, name: name || '', timer };
            this._server.send({ type: 'game-invite', to: peerId, inviteId, game, roomId, fromName: myName() });
            Events.fire('game-invite-pending', { peerId, game, name });
            return 'sent';
        }

        cancel() {
            const o = this._outgoing;
            if (!o) return;
            clearTimeout(o.timer);
            this._outgoing = null;
            this._server.send({ type: 'game-invite-cancel', to: o.peerId, inviteId: o.inviteId });
            Events.fire('game-invite-closed', { reason: 'cancelled' });
        }

        _failOutgoing(toastKey) {
            const o = this._outgoing;
            if (!o) return;
            clearTimeout(o.timer);
            this._outgoing = null;
            Events.fire('game-invite-closed', { reason: toastKey });
            Events.fire('notify-user', t(toastKey, { name: o.name || '?' }));
        }

        _onResponse(msg) {
            const o = this._outgoing;
            if (!o || msg.sender !== o.peerId || msg.inviteId !== o.inviteId) return;
            if (!msg.accept) {
                this._failOutgoing(msg.reason === 'busy' ? 'game_invite_busy_toast' : 'game_invite_declined_toast');
                return;
            }
            clearTimeout(o.timer);
            this._outgoing = null;
            Events.fire('game-invite-closed', { reason: 'accepted' });
            this._startMatch(o.game, o.roomId, o.name, 0);
        }

        _onInvite(msg) {
            const peerId = msg.sender;
            const valid = peerId && typeof msg.inviteId === 'string'
                && GAMES.some(g => g.id === msg.game) && ROOM_RE.test(msg.roomId || '');
            if (!valid) {
                if (peerId && msg.inviteId) {
                    this._server.send({ type: 'game-invite-response', to: peerId, inviteId: msg.inviteId, accept: false, reason: 'unsupported' });
                }
                return;
            }
            // One prompt at a time: a second challenger gets a polite "busy".
            if (this._incoming && this._incoming.peerId !== peerId) {
                this._server.send({ type: 'game-invite-response', to: peerId, inviteId: msg.inviteId, accept: false, reason: 'busy' });
                return;
            }
            if (this._incoming) clearTimeout(this._incoming.timer);
            const fromName = String(msg.fromName || '').slice(0, 64) || '?';
            const timer = setTimeout(() => this._expireIncoming(), INVITE_TIMEOUT_MS);
            this._incoming = { inviteId: msg.inviteId, peerId, game: msg.game, roomId: msg.roomId, fromName, timer, expiresAt: Date.now() + INVITE_TIMEOUT_MS };
            Events.fire('game-invite-received', Object.assign({}, this._incoming));
        }

        _expireIncoming() {
            if (!this._incoming) return;
            this._incoming = null;
            Events.fire('game-invite-incoming-closed', {});
        }

        _onCancel(msg) {
            const i = this._incoming;
            if (!i || i.peerId !== msg.sender || i.inviteId !== msg.inviteId) return;
            clearTimeout(i.timer);
            this._incoming = null;
            Events.fire('game-invite-incoming-closed', {});
            Events.fire('notify-user', t('game_invite_cancelled_toast'));
        }

        accept() {
            const i = this._incoming;
            if (!i) return;
            clearTimeout(i.timer);
            this._incoming = null;
            this._server.send({ type: 'game-invite-response', to: i.peerId, inviteId: i.inviteId, accept: true });
            Events.fire('game-invite-incoming-closed', {});
            // Small delay so the WebSocket flushes the response before unload.
            this._startMatch(i.game, i.roomId, i.fromName, 300);
        }

        decline() {
            const i = this._incoming;
            if (!i) return;
            clearTimeout(i.timer);
            this._incoming = null;
            this._server.send({ type: 'game-invite-response', to: i.peerId, inviteId: i.inviteId, accept: false });
            Events.fire('game-invite-incoming-closed', {});
        }

        _startMatch(game, roomId, opponentName, delay) {
            Events.fire('notify-user', t('game_match_starting_toast', { game: gameLabel(game) }));
            const url = new URL(game + '/', location.href);
            url.search = '';
            if (opponentName) url.searchParams.set('opponent', opponentName);
            url.hash = 'room-' + roomId;
            Events.fire('game-match-ready', { game, roomId, url: url.toString() });
            setTimeout(() => { location.href = url.toString(); }, delay);
        }
    }

    // ---------------------------------------------------------------------
    // UI: game picker (outgoing) + incoming challenge dialog
    // ---------------------------------------------------------------------
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (k === 'text') node.textContent = v;
            else if (k === 'class') node.className = v;
            else node.setAttribute(k, v);
        });
        (children || []).forEach(c => node.appendChild(c));
        return node;
    }

    class GameInviteUI {
        constructor(manager) {
            this.m = manager;
            this._target = null; // {peerId?|deviceId?, name}
            this._buildPicker();
            this._buildIncoming();

            Events.on('game-invite-pick', e => this.openPicker(e.detail));
            Events.on('game-invite-pending', e => this._showWaiting(e.detail));
            Events.on('game-invite-closed', () => this._hide(this.$picker));
            Events.on('game-invite-received', e => this._showIncoming(e.detail));
            Events.on('game-invite-incoming-closed', () => this._hideIncoming());
            Events.on('language-changed', () => this._refreshLabels());
        }

        _show($d) { $d.setAttribute('show', 1); }
        _hide($d) { $d.removeAttribute('show'); }

        _buildPicker() {
            this.$pickTitle = el('h3', { id: 'gamePickerTitle' });
            this.$pickHint = el('div', { class: 'font-body2 game-picker-hint' });
            this.$grid = el('div', { class: 'game-picker-grid', id: 'gamePickerGrid' });
            GAMES.forEach(g => {
                const btn = el('button', { type: 'button', class: 'game-picker-item', 'data-game': g.id }, [
                    el('span', { class: 'game-picker-emoji', text: g.emoji }),
                    el('span', { class: 'game-picker-name', text: t(g.key) })
                ]);
                btn.addEventListener('click', () => this._onGameChosen(g.id));
                this.$grid.appendChild(btn);
            });
            this.$waiting = el('div', { class: 'game-picker-waiting', hidden: '' }, [
                el('div', { class: 'game-picker-spinner' }),
                el('div', { class: 'font-body1', id: 'gamePickerWaitingText' })
            ]);
            this.$pickCancel = el('button', { type: 'button', class: 'button', id: 'gamePickerCancel' });
            this.$pickCancel.addEventListener('click', () => {
                if (this.m._outgoing) this.m.cancel();
                this._hide(this.$picker);
            });
            const paper = el('x-paper', { shadow: '2', class: 'game-picker-paper' }, [
                this.$pickTitle, this.$pickHint, this.$grid, this.$waiting,
                el('div', { class: 'row-reverse' }, [this.$pickCancel])
            ]);
            const bg = el('x-background', { class: 'full center' }, [paper]);
            bg.addEventListener('click', e => { if (e.target === bg && !this.m._outgoing) this._hide(this.$picker); });
            this.$picker = el('x-dialog', { id: 'gamePickerDialog' }, [bg]);
            document.body.appendChild(this.$picker);
        }

        _buildIncoming() {
            this.$inTitle = el('h3', { id: 'gameInviteTitle' });
            this.$inEmoji = el('div', { class: 'game-invite-emoji' });
            this.$inBody = el('div', { class: 'font-body1', id: 'gameInviteBody' });
            this.$inCountdown = el('div', { class: 'font-body2 game-invite-countdown' });
            this.$inAccept = el('button', { type: 'button', class: 'button', id: 'gameInviteAccept' });
            this.$inDecline = el('button', { type: 'button', class: 'button', id: 'gameInviteDecline' });
            this.$inAccept.addEventListener('click', () => this.m.accept());
            this.$inDecline.addEventListener('click', () => this.m.decline());
            const paper = el('x-paper', { shadow: '2', class: 'game-invite-paper' }, [
                this.$inTitle, this.$inEmoji, this.$inBody, this.$inCountdown,
                el('div', { class: 'row-reverse' }, [this.$inAccept, this.$inDecline])
            ]);
            this.$incoming = el('x-dialog', { id: 'gameInviteDialog' }, [el('x-background', { class: 'full center' }, [paper])]);
            document.body.appendChild(this.$incoming);
        }

        _refreshLabels() {
            this.$grid.querySelectorAll('.game-picker-item').forEach(b => {
                b.querySelector('.game-picker-name').textContent = t(CATALOG[b.dataset.game].key);
            });
            this.$pickHint.textContent = t('game_picker_hint');
            this.$inTitle.textContent = t('game_incoming_title');
            this.$inAccept.textContent = t('game_incoming_accept');
            this.$inDecline.textContent = t('game_incoming_decline');
            if (this._target) this.$pickTitle.textContent = t('game_picker_title', { name: this._target.name || '?' });
        }

        openPicker(target) {
            if (this.m._outgoing) return this._show(this.$picker); // already waiting: just re-show
            this._target = target;
            this._refreshLabels();
            this.$grid.hidden = false;
            this.$pickHint.hidden = false;
            this.$waiting.hidden = true;
            this.$pickCancel.textContent = t('game_picker_cancel');
            this.$grid.querySelectorAll('button').forEach(b => { b.disabled = false; });
            this._show(this.$picker);
        }

        async _onGameChosen(game) {
            const target = this._target;
            if (!target) return;
            this.$grid.querySelectorAll('button').forEach(b => { b.disabled = true; });
            let result;
            try {
                result = target.peerId
                    ? this.m.invitePeer(target.peerId, game, target.name)
                    : await this.m.inviteDevice(target.deviceId, game, target.name);
            } catch (e) {
                result = 'offline';
            }
            if (result !== 'sent') {
                this._hide(this.$picker);
                Events.fire('notify-user', t(
                    result === 'disconnected' ? 'game_invite_disconnected_toast' : 'game_invite_offline_toast',
                    { name: target.name || '?' }));
            }
        }

        _showWaiting(detail) {
            const name = detail.name || (this._target && this._target.name) || '?';
            this.$pickTitle.textContent = t('game_picker_title', { name });
            this.$grid.hidden = true;
            this.$pickHint.hidden = true;
            this.$waiting.hidden = false;
            this.$waiting.querySelector('#gamePickerWaitingText').textContent =
                t('game_picker_waiting', { name, game: gameLabel(detail.game) });
            this.$pickCancel.textContent = t('game_picker_cancel_invite');
            this._show(this.$picker);
        }

        _showIncoming(detail) {
            this._refreshLabels();
            this.$inEmoji.textContent = CATALOG[detail.game].emoji;
            this.$inBody.textContent = t('game_incoming_body', { name: detail.fromName, game: gameLabel(detail.game) });
            clearInterval(this._countdown);
            const tick = () => {
                const s = Math.max(0, Math.ceil((detail.expiresAt - Date.now()) / 1000));
                this.$inCountdown.textContent = t('game_incoming_expires', { s });
            };
            tick();
            this._countdown = setInterval(tick, 1000);
            this._show(this.$incoming);
            try { const blop = document.getElementById('blop'); if (blop) blop.play().catch(() => {}); } catch (e) { /* ignore */ }
            if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
            if (document.hidden && window.Notification && Notification.permission === 'granted') {
                try {
                    const n = new Notification(t('game_incoming_title'), { body: this.$inBody.textContent });
                    n.onclick = () => { window.focus(); n.close(); };
                } catch (e) { /* ignore */ }
            }
        }

        _hideIncoming() {
            clearInterval(this._countdown);
            this._hide(this.$incoming);
        }
    }

    window.GameInviteManager = GameInviteManager;
    window.GameInviteUI = GameInviteUI;
    window.LinkGames = { list: GAMES, label: gameLabel };

    // Bootstrap once the app's ServerConnection exists (created synchronously
    // by ui.js, which loads after us) and the DOM is ready.
    window.addEventListener('load', () => {
        if (!window.serverConnection || window.gameInvites) return;
        window.gameInvites = new GameInviteManager(window.serverConnection);
        window.gameInviteUI = new GameInviteUI(window.gameInvites);
    });
})();
