/**
 * Link Application i18n Localization Engine
 * Supports: English, Simplified Chinese, Japanese, Korean
 */

class I18n {
    constructor() {
        this.dictionary = {
            en: {
                header_about_title: "About Link",
                header_theme_title: "Toggle Theme",
                header_transfers_title: "Transfer Center",
                header_notifications_title: "Enable Notifications",
                header_install_title: "Install Link",
                no_peers_msg: "Open Link on other devices to send files",
                instructions_desktop: "Click to send files or right click to send a message",
                instructions_mobile: "Tap to send files or long tap to send a message",
                display_name_default: "The easiest way to transfer data across devices",
                room_status_public: "You can be discovered by everyone on this network",
                btn_copy_room: "Copy Room Link",
                btn_create_room: "Create Private Room",
                btn_leave_room: "Leave Room",
                dialog_receive_title: "File Received",
                dialog_receive_auto: "Ask to save each file before downloading",
                dialog_receive_save: "Save",
                dialog_receive_ignore: "Ignore",
                dialog_send_text_title: "Send a Message",
                dialog_send_text_placeholder: "Send a message",
                dialog_send_text_send: "Send",
                dialog_send_text_cancel: "Cancel",
                dialog_receive_text_title: "Message Received",
                dialog_receive_text_copy: "Copy",
                dialog_receive_text_close: "Close",
                dialog_edit_nickname_title: "Edit Your Nickname",
                dialog_edit_nickname_placeholder: "Enter nickname",
                dialog_edit_nickname_save: "Save",
                dialog_edit_nickname_cancel: "Cancel",
                drawer_transfers_title: "Transfers",
                drawer_transfers_clear: "Clear All",
                drawer_transfers_empty: "No active or recent transfers",
                drag_overlay_title: "Drop anywhere to send files",
                drag_overlay_sub_default: "Drop files on a device to send",
                drag_overlay_sub_one: "Drop anywhere to send to {peerName}",
                drag_overlay_sub_many: "Drop files directly on a device icon to send",
                toast_completed: "File Transfer Completed",
                about_tagline: "A clean, secure, and modern local file sharing system.",
                about_description: "Link allows you to instantly share files, photos, videos, and text across devices on the same local network or via secure private virtual rooms. Operating directly on WebRTC Peer-to-Peer technology, your data goes straight to the recipient without hitting intermediary servers, ensuring maximum privacy and transfer speeds.",
                about_footer: "No installation or accounts required. Just open and share.",
                noscript_title: "Enable JavaScript",
                noscript_desc: "Link works only with JavaScript",
                
                // Dynamic strings
                known_as: "You are known as {name}",
                peer_title: "Click to send files or right click to send a text",
                relay: "Relay",
                p2p: "P2P",
                copied_clipboard: "Copied to clipboard",
                snappy_sharing: "Even more snappy sharing!",
                click_to_open: "Click to open link",
                click_to_copy: "Click to copy text",
                click_to_download: "Click to download",
                copied_text: "Copied text to clipboard",
                offline: "You are offline",
                online: "You are back online",
                room_copied: "Room link copied to clipboard",
                room_copy_failed: "Failed to copy link",
                room_status_private: "Room: {roomName}",
                unknown_device: "Unknown Device",
                direction_to: "To: {peerName}",
                direction_from: "From: {peerName}",
                status_queued: "Queued",
                status_transferring: "Transferring",
                status_done: "Done",
                status_cancelled: "Cancelled",
                status_cancelled_peer: "Cancelled by peer",
                net_connection_lost: "Connection lost. Retry in 5 seconds...",
                net_transfer_completed: "File transfer completed.",
                net_transfer_cancelled_peer: "File transfer was cancelled by the other device.",
                net_relay_limit: "Files > 10MB cannot be sent via relay (WebRTC failed).",
                permission_error: "Notifications permission has been blocked\nas the user has dismissed the permission prompt several times.\nThis can be reset in Page Info\nwhich can be accessed by clicking the lock icon next to the URL."
            },
            zh: {
                header_about_title: "关于 Link",
                header_theme_title: "切换主题",
                header_transfers_title: "传输中心",
                header_notifications_title: "启用通知",
                header_install_title: "安装 Link",
                no_peers_msg: "在其他设备上打开 Link 即可发送文件",
                instructions_desktop: "点击发送文件，或右键发送文本消息",
                instructions_mobile: "点击发送文件，或长按发送文本消息",
                display_name_default: "跨设备传输数据最简便的方式",
                room_status_public: "此网络上的所有人都可以发现您",
                btn_copy_room: "复制房间链接",
                btn_create_room: "创建私密房间",
                btn_leave_room: "退出房间",
                dialog_receive_title: "收到文件",
                dialog_receive_auto: "下载前询问每个保存位置",
                dialog_receive_save: "保存",
                dialog_receive_ignore: "忽略",
                dialog_send_text_title: "发送消息",
                dialog_send_text_placeholder: "输入消息",
                dialog_send_text_send: "发送",
                dialog_send_text_cancel: "取消",
                dialog_receive_text_title: "收到消息",
                dialog_receive_text_copy: "复制",
                dialog_receive_text_close: "关闭",
                dialog_edit_nickname_title: "修改昵称",
                dialog_edit_nickname_placeholder: "输入昵称",
                dialog_edit_nickname_save: "保存",
                dialog_edit_nickname_cancel: "取消",
                drawer_transfers_title: "传输列表",
                drawer_transfers_clear: "清空已完成",
                drawer_transfers_empty: "暂无传输任务",
                drag_overlay_title: "拖拽到任意位置发送文件",
                drag_overlay_sub_default: "将文件拖放到设备上即可发送",
                drag_overlay_sub_one: "拖拽到任意位置发送给 {peerName}",
                drag_overlay_sub_many: "请将文件直接拖放到对应的设备图标上发送",
                toast_completed: "文件传输完成",
                about_tagline: "极简、安全、现代的本地文件共享系统。",
                about_description: "Link 允许您在同一局域网设备间或通过安全的私密房间，即时共享文件、照片、视频和文本。完全基于 WebRTC 端到端（Peer-to-Peer）技术，数据直达接收端而无需经过中转服务器，最大程度地保护了您的隐私，并提供了极致的传输速度。",
                about_footer: "无需安装，无需注册。即开即用，随心分享。",
                noscript_title: "请启用 JavaScript",
                noscript_desc: "Link 需要启用 JavaScript 才能正常工作",
                known_as: "您的设备昵称为 {name}",
                peer_title: "点击发送文件，或右键发送文本消息",
                relay: "中继",
                p2p: "直连",
                copied_clipboard: "已复制到剪贴板",
                snappy_sharing: "更快捷的共享体验！",
                click_to_open: "点击打开链接",
                click_to_copy: "点击复制文本",
                click_to_download: "点击下载",
                copied_text: "文本已复制到剪贴板",
                offline: "您已离线",
                online: "您已恢复在线",
                room_copied: "房间链接已复制到剪贴板",
                room_copy_failed: "复制链接失败",
                room_status_private: "房间: {roomName}",
                unknown_device: "未知设备",
                direction_to: "发送给: {peerName}",
                direction_from: "来自: {peerName}",
                status_queued: "排队中",
                status_transferring: "传输中",
                status_done: "已完成",
                status_cancelled: "已取消",
                status_cancelled_peer: "对方已取消",
                net_connection_lost: "连接已断开。5秒后重试...",
                net_transfer_completed: "文件传输已完成。",
                net_transfer_cancelled_peer: "文件传输已被对方设备取消。",
                net_relay_limit: "文件大于 10MB 无法通过中继模式发送（WebRTC 直连失败）。",
                permission_error: "通知权限已被阻止。\n可能由于您已多次拒绝此权限请求。\n您可以通过点击地址栏左侧的锁形图标，在“网站设置”中重置该权限。"
            },
            ja: {
                header_about_title: "Link について",
                header_theme_title: "テーマを切り替え",
                header_transfers_title: "転送センター",
                header_notifications_title: "通知を有効化",
                header_install_title: "Link をインストール",
                no_peers_msg: "他のデバイスで Link を開くとファイルを送信できます",
                instructions_desktop: "クリックしてファイルを送信、または右クリックしてメッセージを送信",
                instructions_mobile: "タップしてファイルを送信、または長押ししてメッセージを送信",
                display_name_default: "最も簡単なデバイス間データ転送方法",
                room_status_public: "このネットワーク上のすべてのユーザーから検出可能になっています",
                btn_copy_room: "部屋のリンクをコピー",
                btn_create_room: "プライベート部屋を作成",
                btn_leave_room: "部屋を退出",
                dialog_receive_title: "ファイル受信",
                dialog_receive_auto: "ダウンロードする前に保存場所を確認する",
                dialog_receive_save: "保存",
                dialog_receive_ignore: "無視",
                dialog_send_text_title: "メッセージを送信",
                dialog_send_text_placeholder: "メッセージを入力",
                dialog_send_text_send: "送信",
                dialog_send_text_cancel: "キャンセル",
                dialog_receive_text_title: "メッセージ受信",
                dialog_receive_text_copy: "コピー",
                dialog_receive_text_close: "閉じる",
                dialog_edit_nickname_title: "ニックネームの変更",
                dialog_edit_nickname_placeholder: "ニックネームを入力",
                dialog_edit_nickname_save: "保存",
                dialog_edit_nickname_cancel: "キャンセル",
                drawer_transfers_title: "転送リスト",
                drawer_transfers_clear: "完了分をクリア",
                drawer_transfers_empty: "アクティブな転送はありません",
                drag_overlay_title: "任意の場所にドラッグ＆ドロップして送信",
                drag_overlay_sub_default: "ファイルをデバイス上にドロップして送信",
                drag_overlay_sub_one: "任意の場所にドロップして {peerName} に送信",
                drag_overlay_sub_many: "ファイルを対応するデバイス의 アイコン上にドロップして送信してください",
                toast_completed: "ファイルの転送が完了しました",
                about_tagline: "シンプルで安全、端正なローカルファイル共有システム。",
                about_description: "Link を使うと、同一のローカルネットワーク上のデバイス間、または安全な仮想プライベート部屋を通じて、ファイル、写真、ビデオ、テキストを瞬時に共有できます。WebRTC P2P (Peer-to-Peer) テクノロジーを基盤としており、データは中継サーバーを経由せず直接相手に送信されるため、最大限のプライバシー保護と圧倒的な転送速度を実現します。",
                about_footer: "インストールやアカウント登録は一切不要です。開くだけですぐに共有できます。",
                noscript_title: "JavaScript を有効にしてください",
                noscript_desc: "Link を使用するには JavaScript が必要です",
                known_as: "あなたのニックネーム: {name}",
                peer_title: "クリックしてファイルを送信、または右クリックしてメッセージを送信",
                relay: "リレー",
                p2p: "P2P",
                copied_clipboard: "クリップボードにコピーしました",
                snappy_sharing: "さらに快適な共有体験！",
                click_to_open: "クリックしてリンクを開く",
                click_to_copy: "クリックしてテキストをコピー",
                click_to_download: "クリックしてダウンロード",
                copied_text: "テキストをクリップボードにコピーしました",
                offline: "オフライン状態です",
                online: "オンラインに復帰しました",
                room_copied: "部屋のリンクをコピーしました",
                room_copy_failed: "リンクのコピーに失敗しました",
                room_status_private: "部屋: {roomName}",
                unknown_device: "不明なデバイス",
                direction_to: "宛先: {peerName}",
                direction_from: "送信元: {peerName}",
                status_queued: "待機中",
                status_transferring: "転送中",
                status_done: "完了",
                status_cancelled: "キャンセル済み",
                status_cancelled_peer: "相手側がキャンセル",
                net_connection_lost: "接続が切れました。5秒後に再試行します...",
                net_transfer_completed: "ファイル転送が完了しました。",
                net_transfer_cancelled_peer: "ファイル転送が相手側のデバイスによってキャンセルされました。",
                net_relay_limit: "10MBを超えるファイルは中継モードで送信できません（WebRTC直連に失敗しました）。",
                permission_error: "通知の許可がブロックされています。\n過去に許可のポップアップが拒否された可能性があります。\nURL横の鍵アイコンをクリックし、ページ情報から許可設定をリセットできます。"
            },
            ko: {
                header_about_title: "Link 정보",
                header_theme_title: "테마 전환",
                header_transfers_title: "전송 센터",
                header_notifications_title: "알림 사용",
                header_install_title: "Link 설치",
                no_peers_msg: "다른 기기에서 Link를 열면 파일을 보낼 수 있습니다",
                instructions_desktop: "클릭하여 파일을 보내거나 우클릭하여 메시지를 전송",
                instructions_mobile: "탭하여 파일을 보내거나 길게 눌러 메시지를 전송",
                display_name_default: "가장 쉬운 기기간 데이터 전송 방법",
                room_status_public: "이 네트워크 상의 모든 기기가 사용자를 검색할 수 있습니다",
                btn_copy_room: "방 링크 복사",
                btn_create_room: "비공개 방 만들기",
                btn_leave_room: "방 나가기",
                dialog_receive_title: "파일 수신",
                dialog_receive_auto: "다운로드하기 전에 매번 저장 위치 묻기",
                dialog_receive_save: "저장",
                dialog_receive_ignore: "무시",
                dialog_send_text_title: "메시지 보내기",
                dialog_send_text_placeholder: "메시지 입력",
                dialog_send_text_send: "전송",
                dialog_send_text_cancel: "취소",
                dialog_receive_text_title: "메시지 수신",
                dialog_receive_text_copy: "복사",
                dialog_receive_text_close: "닫기",
                dialog_edit_nickname_title: "닉네임 수정",
                dialog_edit_nickname_placeholder: "닉네임 입력",
                dialog_edit_nickname_save: "저장",
                dialog_edit_nickname_cancel: "취소",
                drawer_transfers_title: "전송 목록",
                drawer_transfers_clear: "완료 항목 삭제",
                drawer_transfers_empty: "전송 중이거나 최근 전송된 내역이 없습니다",
                drag_overlay_title: "아무 곳에나 드래그 앤 드롭하여 파일 전송",
                drag_overlay_sub_default: "기기 위로 파일을 떨어뜨려 전송",
                drag_overlay_sub_one: "아무 곳에나 떨어뜨려 {peerName}에게 전송",
                drag_overlay_sub_many: "파일을 해당 기기의 아이콘 위에 직접 드롭하여 전송하십시오",
                toast_completed: "파일 전송 완료",
                about_tagline: "쉽고 안전하며 트렌디한 로컬 파일 공유 시스템.",
                about_description: "Link를 통해 동일한 로컬 네트워크 기기간 혹은 안전한 가상 비공개 방을 통하여 파일, 사진, 동영상, 텍스트를 즉시 공유할 수 있습니다. WebRTC P2P (Peer-to-Peer) 기술을 기반으로 작동하므로 중간 서버를 거치지 않고 데이터가 상대방에게 직접 전달되어 최대의 개인 정보 보호와 전송 속도를 보장합니다.",
                about_footer: "설치나 회원가입은 필요하지 않습니다. 브라우저를 열고 바로 공유하세요.",
                noscript_title: "JavaScript를 활성화해 주세요",
                noscript_desc: "Link를 사용하려면 JavaScript가 활성화되어 있어야 합니다",
                known_as: "현재 사용자 닉네임: {name}",
                peer_title: "클릭하여 파일을 보내거나 우클릭하여 메시지를 전송",
                relay: "릴레이",
                p2p: "P2P",
                copied_clipboard: "클립보드에 복사되었습니다",
                snappy_sharing: "더욱 쾌적한 공유 경험!",
                click_to_open: "클릭하여 링크 열기",
                click_to_copy: "클릭하여 텍스트 복사",
                click_to_download: "클릭하여 다운로드",
                copied_text: "텍스트가 클립보드에 복사되었습니다",
                offline: "오프라인 상태입니다",
                online: "온라인 상태로 복귀했습니다",
                room_copied: "방 링크가 클립보드에 복사되었습니다",
                room_copy_failed: "링크 복사에 실패했습니다",
                room_status_private: "방: {roomName}",
                unknown_device: "알 수 없는 기기",
                direction_to: "보냄: {peerName}",
                direction_from: "받음: {peerName}",
                status_queued: "대기 중",
                status_transferring: "전송 중",
                status_done: "완료",
                status_cancelled: "취소됨",
                status_cancelled_peer: "상대방이 취소함",
                net_connection_lost: "연결이 끊어졌습니다. 5초 후 재시도합니다...",
                net_transfer_completed: "파일 전송이 완료되었습니다.",
                net_transfer_cancelled_peer: "상대방 기기에 의해 파일 전송이 취소되었습니다.",
                net_relay_limit: "10MB보다 큰 파일은 릴레이 모드로 전송할 수 없습니다 (WebRTC 직접 연결 실패).",
                permission_error: "알림 허용 권한이 차단되었습니다.\n사용자가 알림 창을 여러 번 무시했거나 거부했을 수 있습니다.\nURL 옆 자물쇠 아이콘을 클릭하여 설정 페이지에서 다시 초기화할 수 있습니다."
            }
        };

        // Determine initial language
        const savedLang = localStorage.getItem('language');
        if (savedLang && this.dictionary[savedLang]) {
            this.currentLanguage = savedLang;
        } else {
            const browserLang = navigator.language ? navigator.language.split('-')[0] : 'en';
            this.currentLanguage = this.dictionary[browserLang] ? browserLang : 'en';
        }
    }

    t(key, replacements = {}) {
        const dict = this.dictionary[this.currentLanguage] || this.dictionary['en'];
        let text = dict[key] || this.dictionary['en'][key] || key;
        
        for (const placeholder in replacements) {
            text = text.replace(`{${placeholder}}`, replacements[placeholder]);
        }
        return text;
    }

    setLanguage(lang) {
        if (!this.dictionary[lang]) return;
        this.currentLanguage = lang;
        localStorage.setItem('language', lang);
        this.translatePage();
        Events.fire('language-changed', lang);
    }

    translatePage() {
        // Translate text contents using data-translate
        document.querySelectorAll('[data-translate]').forEach(el => {
            const key = el.getAttribute('data-translate');
            el.textContent = this.t(key);
        });

        // Translate title attributes using data-translate-title
        document.querySelectorAll('[data-translate-title]').forEach(el => {
            const key = el.getAttribute('data-translate-title');
            el.setAttribute('title', this.t(key));
        });

        // Translate placeholder attributes using data-translate-placeholder
        document.querySelectorAll('[data-translate-placeholder]').forEach(el => {
            const key = el.getAttribute('data-translate-placeholder');
            el.setAttribute('placeholder', this.t(key));
        });

        // Translate custom properties of specific elements if necessary
        const instructions = document.querySelector('x-instructions');
        if (instructions) {
            instructions.setAttribute('desktop', this.t('instructions_desktop'));
            instructions.setAttribute('mobile', this.t('instructions_mobile'));
        }

        // Keep language select input value in sync
        const select = document.getElementById('language-select');
        if (select) {
            select.value = this.currentLanguage;
        }
    }
}

window.I18n = new I18n();
// Expose instant translate helper
window.t = (key, replacements) => window.I18n.t(key, replacements);
