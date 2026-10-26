/**
 * GameBoard: client for the per-game leaderboard (server/leaderboard.js).
 *
 * The board lives on the signaling server, so this opens a short-lived
 * WebSocket to /server/webrtc, sends one request, waits for the matching
 * reply and closes. It joins a throw-away `?room=` so the connection never
 * shows up as a "device" for other Link users on the same network.
 *
 *   GameBoard.get('spin')                → Promise<{top, me?, total}>
 *   GameBoard.submit('spin', {rp, tw, w, l, name}) → Promise<{rank}>
 *   GameBoard.pid()                      → this browser's secret player id
 *
 * Works the same in bot mode (no GameSession needed). Rejects after 6 s if
 * the server is unreachable, so callers can show an "offline" state.
 */
(function () {
    'use strict';

    var PID_KEY = 'game-board-pid';

    function pid() {
        var p = localStorage.getItem(PID_KEY);
        if (!p || p.length < 16) {
            var a = new Uint8Array(16);
            crypto.getRandomValues(a);
            p = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
            localStorage.setItem(PID_KEY, p);
        }
        return p;
    }

    function wsUrl() {
        var protocol = location.protocol.indexOf('https') === 0 ? 'wss' : 'ws';
        // /<app root>/<game>/ → /<app root>/server/webrtc (same rule as GameSession)
        var root = location.pathname.replace(/\/[a-z0-9]+\/(?:index\.html)?$/, '');
        var room = 'lb-' + Math.random().toString(36).slice(2, 10);
        return protocol + '://' + location.host + root + '/server/webrtc?room=' + room;
    }

    function request(msg, replyTypes) {
        return new Promise(function (resolve, reject) {
            var ws, done = false;
            var timer = setTimeout(function () { finish(new Error('timeout')); }, 6000);
            function finish(err, data) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { ws.close(); } catch (e) { /* already closed */ }
                if (err) reject(err); else resolve(data);
            }
            try { ws = new WebSocket(wsUrl()); } catch (e) { finish(e); return; }
            ws.onopen = function () { ws.send(JSON.stringify(msg)); };
            ws.onmessage = function (e) {
                var m;
                try { m = JSON.parse(e.data); } catch (x) { return; }
                if (m.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
                if (replyTypes.indexOf(m.type) < 0 || m.game !== msg.game) return;
                if (m.type === 'lb-error') finish(new Error(m.error || 'error'));
                else finish(null, m);
            };
            ws.onerror = function () { finish(new Error('network')); };
            ws.onclose = function () { finish(new Error('closed')); };
        });
    }

    window.GameBoard = {
        pid: pid,
        get: function (game) {
            return request({ type: 'lb-get', game: game, pid: pid() }, ['lb-data']);
        },
        submit: function (game, row) {
            return request({
                type: 'lb-submit', game: game, pid: pid(),
                name: row.name, rp: row.rp, tw: row.tw || 0, w: row.w || 0, l: row.l || 0
            }, ['lb-ok', 'lb-error']);
        }
    };
})();
