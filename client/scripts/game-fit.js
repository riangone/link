/**
 * GameFit: shared "fill the screen" layer for the canvas games under
 * client/<game>/ (pong, gomoku, hockey, tanks, brawl, tron, blaster).
 *
 * All of those pages share one skeleton:
 *   .game-container > header.game-header
 *                   > .main-panel > [.stage-column >] .canvas-wrapper (+ .overlay)
 *                                 > .side-panel
 *                   > [.mobile-controls] > footer.game-footer
 * and each used to cap itself at 540–1120 px with a fixed-resolution canvas
 * that the browser just stretched. This file turns that into a full-viewport
 * layout without touching the game rules:
 *
 *   Layout   — html.gf + game-fit.css: the page becomes exactly 100dvh; the
 *              canvas wrapper is sized in JS to the largest box of the game's
 *              aspect ratio that fits the space left by header + controls.
 *              The waiting/ready overlays cover the whole stage (not only the
 *              canvas) so they still fit when the canvas is a thin landscape
 *              strip. The side panel becomes a drawer (ⓘ) on narrow screens,
 *              the footer link becomes a ← in the header, and there is a
 *              fullscreen ⛶ button where the Fullscreen API exists.
 *   Canvas   — GameFit.view(canvas, {width, height}) keeps the game's
 *              *logical* coordinate system (the old canvas width/height) but
 *              gives the canvas a backing store of css size × devicePixelRatio;
 *              the game calls view.begin(ctx) at the top of render() and keeps
 *              drawing in logical units — crisp at any size.
 *   Portrait — rotate:'auto' turns a landscape playfield by ±90° whenever the
 *              available box is portrait (phones held upright), so it fills
 *              the screen instead of being a thin strip. view.toLogical() and
 *              view.screenVec() map pointer positions / joystick vectors back.
 *              adaptive:{short} instead lets a renderer (the FPS) change its
 *              logical size to whatever aspect the box has.
 *   Touch    — GameFit.touchButtons(): multi-touch hold buttons that follow a
 *              sliding thumb from one button to the next; GameFit.joystick():
 *              a floating analog stick.
 */
(function () {
    'use strict';

    var root = document.documentElement;
    root.classList.add('gf');
    var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (coarse) root.classList.add('gf-touch');

    var LANG = (function () {
        var qs = new URLSearchParams(location.search);
        var l = qs.get('lang') || localStorage.getItem('language') || (navigator.language || 'en').slice(0, 2);
        return ({ zh: 1, ja: 1, ko: 1, en: 1 })[l] ? l : 'en';
    })();
    var T = {
        zh: { back: '返回 LINK', info: '玩法说明', fs: '全屏', rotate: '📱 横过来玩画面更大', close: '关闭' },
        ja: { back: 'LINK に戻る', info: '遊び方', fs: '全画面', rotate: '📱 横向きにすると大きく遊べます', close: '閉じる' },
        ko: { back: 'LINK로 돌아가기', info: '플레이 방법', fs: '전체 화면', rotate: '📱 가로로 돌리면 더 크게 플레이할 수 있어요', close: '닫기' },
        en: { back: 'Back to LINK', info: 'How to play', fs: 'Fullscreen', rotate: '📱 Rotate your phone for a bigger view', close: 'Close' }
    }[LANG];

    var views = [];
    var stage = null, box = null, sideL = null, sideR = null, wrapper = null, sidePanel = null, infoBtn = null;
    var built = false;
    var opts = { landscapeOnly: false };

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }

    // ---------------------------------------------------------------
    // DOM restructuring (idempotent, runs once the skeleton exists)
    // ---------------------------------------------------------------
    function build() {
        if (built) return;
        wrapper = document.querySelector('.canvas-wrapper');
        var container = document.querySelector('.game-container');
        if (!wrapper || !container) return;
        built = true;

        stage = wrapper.closest('.stage-column');
        if (!stage) {
            stage = el('div', 'stage-column');
            wrapper.parentNode.insertBefore(stage, wrapper);
            stage.appendChild(wrapper);
        }
        stage.classList.add('gf-stage');

        box = el('div', 'gf-box');
        stage.insertBefore(box, wrapper);
        box.appendChild(wrapper);

        // The overlay (lobby / ready / game over) covers the whole stage box.
        var ov = wrapper.querySelector(':scope > .overlay');
        if (ov) box.appendChild(ov);

        // Mobile controls that lived outside the main panel join the stage.
        Array.prototype.forEach.call(container.querySelectorAll(':scope > .mobile-controls'), function (m) {
            stage.appendChild(m);
        });

        // Side columns: whatever sits above the canvas (HUD) goes left, below
        // it (action chips, d-pad) goes right. In column mode they are
        // display:contents so nothing changes; on wide stages (html.gf-side)
        // they become real columns so the board can use the full height.
        sideL = el('div', 'gf-side gf-side-l');
        sideR = el('div', 'gf-side gf-side-r');
        var before = true;
        Array.prototype.slice.call(stage.children).forEach(function (c) {
            if (c === box) { before = false; return; }
            if (c.classList.contains('touch-controls')) return;
            (before ? sideL : sideR).appendChild(c);
        });
        stage.insertBefore(sideL, box);
        stage.insertBefore(sideR, box.nextSibling);

        // Header tools: ← back · ⓘ info drawer · ⛶ fullscreen
        var header = container.querySelector('.game-header');
        var footerLink = container.querySelector('.game-footer a');
        if (header) {
            var back = el('a', 'gf-btn gf-back', '←');
            back.href = footerLink ? footerLink.getAttribute('href') : '../';
            back.title = back.ariaLabel = T.back;
            header.insertBefore(back, header.firstChild);

            var tools = el('div', 'gf-tools');
            sidePanel = container.querySelector('.side-panel');
            if (sidePanel) {
                infoBtn = el('button', 'gf-btn gf-info', 'ⓘ');
                infoBtn.type = 'button';
                infoBtn.title = T.info;
                infoBtn.setAttribute('aria-expanded', 'false');
                infoBtn.addEventListener('click', function () { toggleInfo(); });
                tools.appendChild(infoBtn);
                var close = el('button', 'gf-btn gf-close', '✕');
                close.type = 'button';
                close.title = T.close;
                close.addEventListener('click', function () { toggleInfo(false); });
                sidePanel.insertBefore(close, sidePanel.firstChild);
            }
            var fsTarget = root;
            if (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen) {
                var fs = el('button', 'gf-btn gf-fs', '⛶');
                fs.type = 'button';
                fs.title = T.fs;
                fs.addEventListener('click', toggleFullscreen);
                tools.appendChild(fs);
            }
            header.appendChild(tools);
        }

        var hint = el('div', 'gf-rotate-hint', T.rotate);
        stage.insertBefore(hint, box);

        if (window.ResizeObserver) new ResizeObserver(scheduleFit).observe(box);
        window.addEventListener('resize', scheduleFit);
        window.addEventListener('orientationchange', scheduleFit);
        document.addEventListener('fullscreenchange', scheduleFit);
        // Stop page scroll/bounce while dragging on the stage on phones.
        stage.addEventListener('touchmove', function (e) {
            if (!e.target.closest('.overlay, .side-panel, input')) e.preventDefault();
        }, { passive: false });
        applyOpts();
        fit();
    }

    function toggleInfo(force) {
        if (!sidePanel) return;
        var open = typeof force === 'boolean' ? force : !sidePanel.classList.contains('gf-open');
        sidePanel.classList.toggle('gf-open', open);
        if (infoBtn) infoBtn.setAttribute('aria-expanded', String(open));
    }

    function toggleFullscreen() {
        var d = document;
        if (d.fullscreenElement || d.webkitFullscreenElement) {
            (d.exitFullscreen || d.webkitExitFullscreen).call(d);
            return;
        }
        var req = root.requestFullscreen || root.webkitRequestFullscreen;
        var p = req.call(root, { navigationUI: 'hide' });
        if (p && p.then && opts.landscapeOnly && screen.orientation && screen.orientation.lock) {
            p.then(function () { return screen.orientation.lock('landscape'); }).catch(function () {});
        }
    }

    function applyOpts() {
        root.classList.toggle('gf-landscape-only', !!opts.landscapeOnly);
    }

    // ---------------------------------------------------------------
    // Fitting
    // ---------------------------------------------------------------
    var fitQueued = false;
    function scheduleFit() {
        if (fitQueued) return;
        fitQueued = true;
        requestAnimationFrame(function () { fitQueued = false; fit(); });
    }

    function fit() {
        if (!box || !views.length) return;
        var v = views[0];
        var portraitScreen = window.innerHeight > window.innerWidth;
        root.classList.toggle('gf-portrait', portraitScreen);
        // Phones in landscape: the controls float over the stage's side margins
        // instead of stealing height from an already short screen.
        var overlayCtl = coarse && !portraitScreen && window.innerHeight < 600;
        root.classList.toggle('gf-float-controls', overlayCtl);

        // Wide stage + HUD/buttons around the canvas → put them in side columns.
        var hasSide = sideL && (sideL.children.length || sideR.children.length);
        if (hasSide) {
            var sw = stage.clientWidth, sh = stage.clientHeight;
            var ga = v.width / v.height;
            if (v.mode !== 'none' && ga > 1) ga = 1 / ga; // could be rotated either way
            var side = sw > sh * ga + 320 && sh > 0;
            if (side !== root.classList.contains('gf-side')) {
                root.classList.toggle('gf-side', side);
            }
        }
        var bw = box.clientWidth, bh = box.clientHeight;
        if (bw < 10 || bh < 10) return;
        v._layout(bw, bh);
        var aspect = v.displayW / v.displayH;
        var cs = getComputedStyle(wrapper);
        var bx = (parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) +
                  parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) || 0;
        var by = (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) +
                  parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) || 0;
        var iw = bw - bx, ih = bh - by;
        var w = iw, h = w / aspect;
        if (h > ih) { h = ih; w = h * aspect; }
        w = Math.floor(w); h = Math.floor(h);
        wrapper.style.width = (w + bx) + 'px';
        wrapper.style.height = (h + by) + 'px';
        v._resize(w, h);
    }

    // ---------------------------------------------------------------
    // View: logical coordinates ↔ device pixels (+ optional rotation)
    // ---------------------------------------------------------------
    function View(canvas, o) {
        this.canvas = canvas;
        this.o = o || {};
        this.width = this.o.width || canvas.width;    // logical
        this.height = this.o.height || canvas.height;
        this.mode = ({ auto: 1, portrait: 1, landscape: 1 })[this.o.rotate] ? this.o.rotate : 'none';
        this.rotation = 0;   // 0 | 90 | -90 (clockwise degrees applied to the world)
        this.scale = 1;      // device px per logical unit
        this.cssW = this.width;
        this.cssH = this.height;
        this.displayW = this.width;
        this.displayH = this.height;
        this._lastBox = null;
    }
    View.prototype._layout = function (bw, bh) {
        this._lastBox = [bw, bh];
        var a = this.o.adaptive;
        if (a) {
            var r = Math.max(a.min || 0.5, Math.min(a.max || 2, bw / bh));
            var s = a.short || 450;
            var nw = r >= 1 ? Math.round(s * r) : s;
            var nh = r >= 1 ? s : Math.round(s / r);
            if (nw !== this.width || nh !== this.height) {
                this.width = nw; this.height = nh;
                this._sizeChanged = true;
            }
        }
        var rot = 0;
        if (this.mode !== 'none') {
            var wantPortrait = this.mode === 'portrait' || (this.mode === 'auto' && bh > bw * 1.05);
            var landscapeWorld = this.width > this.height;
            if (wantPortrait === landscapeWorld) {
                rot = this.o.turn ? this.o.turn() : -90;
                if (rot !== 90) rot = -90;
            }
        }
        if (rot !== this.rotation) { this.rotation = rot; this._rotChanged = true; }
        this.displayW = rot ? this.height : this.width;
        this.displayH = rot ? this.width : this.height;
    };
    View.prototype._resize = function (cssW, cssH) {
        this.cssW = cssW; this.cssH = cssH;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var maxPx = this.o.maxPixels || 2600000;
        if (cssW * cssH * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (cssW * cssH));
        dpr = Math.max(dpr, 0.5);
        var pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
        var c = this.canvas;
        var changed = c.width !== pw || c.height !== ph;
        if (changed) { c.width = pw; c.height = ph; }
        this.scale = pw / this.displayW;
        c.dataset.rotation = String(this.rotation);
        c.dataset.logical = this.width + 'x' + this.height;
        var rotChanged = this._rotChanged, sizeChanged = this._sizeChanged;
        this._rotChanged = this._sizeChanged = false;
        if (this.o.onResize && (changed || rotChanged || sizeChanged)) {
            this.o.onResize({ rotation: this.rotation, width: this.width, height: this.height, rotationChanged: !!rotChanged });
        }
    };
    /** Reset the context to logical coordinates. Call at the top of render(). */
    View.prototype.begin = function (ctx) {
        var s = this.scale;
        if (this.rotation === 90) ctx.setTransform(0, s, -s, 0, s * this.height, 0);
        else if (this.rotation === -90) ctx.setTransform(0, -s, s, 0, 0, s * this.width);
        else ctx.setTransform(s, 0, 0, s, 0, 0);
    };
    /**
     * Move the origin to logical (x, y) and undo the view rotation, so text /
     * icons drawn at (0, 0) read upright on screen. Wrap in save()/restore().
     */
    View.prototype.upright = function (ctx, x, y) {
        ctx.translate(x, y);
        if (this.rotation) ctx.rotate(-this.rotation * Math.PI / 180);
    };
    /** clientX/Y → logical {x, y} (may fall outside the field). */
    View.prototype.toLogical = function (clientX, clientY) {
        var r = this.canvas.getBoundingClientRect();
        var u = (clientX - r.left) / (r.width || 1) * this.displayW;
        var v = (clientY - r.top) / (r.height || 1) * this.displayH;
        if (this.rotation === 90) return { x: v, y: this.height - u };
        if (this.rotation === -90) return { x: this.width - v, y: u };
        return { x: u, y: v };
    };
    /** A direction on screen (dx right, dy down) → the same direction in the world. */
    View.prototype.screenVec = function (dx, dy) {
        if (this.rotation === 90) return { x: dy, y: -dx };
        if (this.rotation === -90) return { x: -dy, y: dx };
        return { x: dx, y: dy };
    };
    /** Force 'auto' | 'landscape' | 'portrait'. */
    View.prototype.setMode = function (m) {
        this.mode = m;
        fit();
    };
    View.prototype.refit = function () { fit(); };

    // ---------------------------------------------------------------
    // Touch helpers
    // ---------------------------------------------------------------
    function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* ignore */ } }

    /**
     * Hold-buttons inside `container` ([data-action] children). Each pointer
     * tracks which button is under it as it slides, so a thumb can roll from
     * ◀ to ▶ (or onto 🔥) without lifting. set(action, isDown) is called on
     * every change; active buttons get .active.
     */
    function touchButtons(container, set, o) {
        o = o || {};
        var held = {};      // pointerId -> button
        function count(btn) {
            var n = 0;
            for (var k in held) if (held[k] === btn) n++;
            return n;
        }
        function press(id, btn) {
            var prev = held[id];
            if (prev === btn) return;
            delete held[id];
            if (prev && !count(prev)) { prev.classList.remove('active'); set(prev.dataset.action, false); }
            if (btn) {
                held[id] = btn;
                if (count(btn) === 1) { btn.classList.add('active'); set(btn.dataset.action, true); buzz(o.buzz); }
            }
        }
        function btnAt(x, y) {
            var t = document.elementFromPoint(x, y);
            var b = t && t.closest('[data-action]');
            return b && container.contains(b) ? b : null;
        }
        container.style.touchAction = 'none';
        container.addEventListener('pointerdown', function (e) {
            var b = e.target.closest('[data-action]');
            if (!b || !container.contains(b)) return;
            e.preventDefault();
            try { container.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            press(e.pointerId, b);
        });
        container.addEventListener('pointermove', function (e) {
            if (!(e.pointerId in held)) return;
            if (o.slide === false) return;
            var b = btnAt(e.clientX, e.clientY);
            if (b) press(e.pointerId, b);
        });
        function up(e) { if (e.pointerId in held) press(e.pointerId, null); }
        container.addEventListener('pointerup', up);
        container.addEventListener('pointercancel', up);
        container.addEventListener('lostpointercapture', up);
        container.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        return {
            releaseAll: function () { for (var k in held) press(k, null); }
        };
    }

    /**
     * Analog stick in `zone`. The knob (optional) follows the finger; the
     * stick's centre is wherever the finger first lands, so you don't have to
     * hit it precisely. cb(x, y, active) with x/y in [-1, 1] (screen space).
     */
    function joystick(zone, knob, cb, o) {
        o = o || {};
        var id = null, cx = 0, cy = 0;
        var R = o.radius || 56;
        function emit(x, y, active) {
            if (knob) knob.style.transform = active ? 'translate(' + (x * R) + 'px,' + (y * R) + 'px)' : '';
            zone.classList.toggle('active', active);
            cb(x, y, active);
        }
        zone.style.touchAction = 'none';
        zone.addEventListener('pointerdown', function (e) {
            if (id !== null) return;
            e.preventDefault();
            id = e.pointerId;
            try { zone.setPointerCapture(id); } catch (err) { /* ignore */ }
            if (o.fixedCenter) {
                var r = zone.getBoundingClientRect();
                cx = r.left + r.width / 2; cy = r.top + r.height / 2;
                move(e);
            } else {
                cx = e.clientX; cy = e.clientY;
                emit(0, 0, true);
            }
            buzz(6);
        });
        function move(e) {
            if (e.pointerId !== id) return;
            var dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
            var m = Math.hypot(dx, dy);
            if (m > 1) {
                // drag the centre along so reversing direction is instant
                if (!o.fixedCenter) { cx += (dx / m) * (m - 1) * R; cy += (dy / m) * (m - 1) * R; }
                dx /= m; dy /= m;
            }
            emit(dx, dy, true);
        }
        zone.addEventListener('pointermove', move);
        function end(e) {
            if (e.pointerId !== id) return;
            id = null;
            emit(0, 0, false);
        }
        zone.addEventListener('pointerup', end);
        zone.addEventListener('pointercancel', end);
        zone.addEventListener('lostpointercapture', end);
    }

    window.GameFit = {
        /** Register the game's canvas. Returns a View. */
        view: function (canvas, o) {
            var v = new View(canvas, o);
            views.push(v);
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
            else build();
            // async: the game's `const view = GameFit.view(...)` must be assigned
            // before onResize (which usually calls render → view.begin) fires.
            scheduleFit();
            return v;
        },
        configure: function (o) {
            for (var k in o) opts[k] = o[k];
            if (built) applyOpts();
        },
        refit: scheduleFit,
        touchButtons: touchButtons,
        joystick: joystick,
        buzz: buzz,
        isTouch: !!coarse,
        lang: LANG
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
