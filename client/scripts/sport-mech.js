/**
 * SportMech — shared top-down "armored arena" art for the sports games
 * (volley / soccer / tennis / hoops), matching the visual language of
 * Link Armor and Link Spin: dark industrial steel arenas, team neon accents
 * (P1 magenta / P2 cyan), glowing plasma energy balls, and heavy top-down
 * armored combat mechs.
 *
 * All games use pure TOP-DOWN camera perspective (俯视，无斜视).
 *
 *   SportMech.TEAM[i]                       palette for seat i
 *   SportMech.mech(g, o)                    top-down armored battle mech
 *   SportMech.drone(g, x, y, r, t, ang)     top-down guardian defense drone
 *   SportMech.orb(g, x, y, r, spin, kind)   energy ball: 'volley'|'soccer'|'tennis'|'hoops'
 *   SportMech.streak(g, b, r, col, n)       motion trail behind a fast ball
 *   SportMech.ball(g, b, r, kind)           top-down ball: true x/y, grows with height z
 *   SportMech.shadow(g, x, y, r, z)         ground shadow, slides away as z rises
 *   SportMech.rim(g, x0, y0, x1, y1)        hazard-striped border around the arena
 *   SportMech.steel(g, x, y, w, h, opt)     brushed-steel panel area
 *   SportMech.crowd(g, x, y, w, h, seed)    dark stands with neon light-sticks
 *   SportMech.lights(g, W, y, n)            stadium flood-light glows
 *   SportMech.hazard(g, x, y, w, h)         yellow/black warning stripes
 *   SportMech.neon(g, col, width, fn)       stroke the path built by fn() with a glow
 *   SportMech.pylon(g, x, yTop, yBot, w)    steel post with emitter light
 *   SportMech.field(g, x0, y0, x1, y1, t, col)  flickering energy barrier
 */
(function () {
    'use strict';

    const TAU = Math.PI * 2;
    const TEAM = [
        { main: '#ff3fb4', deep: '#7c1450', glow: '#ff7ad0', ring: '#ff3fb4' },
        { main: '#2de2ff', deep: '#0b5c78', glow: '#8af2ff', ring: '#2de2ff' }
    ];
    const GOLD = '#ffd34d';

    function poly(g, pts) {
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
        g.closePath();
    }
    function rrect(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    }
    function metal(g, x0, y0, x1, y1, a, b) {
        const lg = g.createLinearGradient(x0, y0, x1, y1);
        lg.addColorStop(0, a);
        lg.addColorStop(1, b);
        return lg;
    }

    // ==================================================================
    // Top-down Armored Combat Mech
    // ==================================================================
    /**
     * Top-down armored battle mech, viewed directly from above.
     *
     * o: {
     *   x, y      chassis centre
     *   r         chassis radius
     *   i         seat (0 or 1) -> TEAM colours
     *   ang       facing angle in radians (or f: ±1 for horizontal)
     *   t         time / tick for hum / thruster flicker
     *   moving    true if driving / running (ignites plasma thrusters)
     *   air       true while jumping / airborne
     *   charge    0..1 power glow on weapons / reactor
     *   weapon    'soccer' | 'tennis' | 'volley' | 'hoops'
     *   flash     0..1 white hit flash
     *   arm       swing angle for tennis racket / striking arm
     * }
     */
    function mech(g, o) {
        const T = TEAM[o.i] || TEAM[0];
        const r = o.r || 22;
        const t = o.t || 0;
        const moving = o.moving !== undefined ? o.moving : (o.air || (o.run && Math.abs(o.run) > 0.05));
        let ang = 0;
        if (typeof o.ang === 'number') {
            ang = o.ang;
        } else if (typeof o.f === 'number') {
            ang = o.f > 0 ? 0 : Math.PI;
        }
        const charge = Math.max(0, Math.min(1, o.charge || 0));
        const flash = Math.max(0, Math.min(1, o.flash || 0));
        const weapon = o.weapon || (o.tool === 'racket' ? 'tennis' : null);

        // Pure top-down height: the mech stays on its court position, the
        // body grows a little and the ground shadow slides away (light from
        // the upper-left), instead of lifting the sprite up the screen.
        const z = Math.max(0, o.z || 0);
        g.save();
        g.translate(o.x, o.y);

        // 1. Ground shadow (circular / slightly elliptical)
        const so = shadowOff(z);
        g.fillStyle = `rgba(0,0,0,${0.42 - Math.min(0.2, z / 400)})`;
        g.beginPath();
        g.ellipse(so, so, r * 1.15, r * 1.05, 0, 0, TAU);
        g.fill();
        const k = lift(z);
        if (k !== 1) g.scale(k, k);

        // 2. Rotate to facing angle
        g.rotate(ang);

        // 3. Rear Booster Thrusters (at rear: x = -r * 0.75, y = ±r * 0.45)
        for (const sy of [-1, 1]) {
            const ey = sy * r * 0.45;
            g.fillStyle = '#1c202c';
            rrect(g, -r * 0.95, ey - r * 0.18, r * 0.45, r * 0.36, 3);
            g.fill();
            g.strokeStyle = '#384259';
            g.lineWidth = 1.2;
            g.stroke();
            g.fillStyle = T.deep;
            g.fillRect(-r * 0.98, ey - r * 0.12, r * 0.12, r * 0.24);

            if (moving || o.air || charge > 0.3) {
                const fl = (0.75 + Math.random() * 0.4) * (charge > 0.5 ? 1.4 : 1.0);
                const flen = r * (0.8 + fl * 0.75);
                flameTop(g, -r * 0.98, ey, Math.PI, flen, T.glow);
            }
        }

        // 4. Lateral Armored Sponsons / Tread Pads / Hover Skirts
        for (const sy of [-1, 1]) {
            const sy0 = sy * r * 0.55;
            g.fillStyle = metal(g, -r * 0.7, sy0 - r * 0.25, r * 0.7, sy0 + r * 0.25, '#2b3345', '#161922');
            poly(g, [
                -r * 0.65, sy0 - r * 0.25 * sy,
                 r * 0.55, sy0 - r * 0.25 * sy,
                 r * 0.7,  sy0 + r * 0.15 * sy,
                -r * 0.5,  sy0 + r * 0.25 * sy
            ]);
            g.fill();
            g.strokeStyle = 'rgba(0,0,0,0.6)';
            g.lineWidth = 1.2;
            g.stroke();

            // Neon team accent stripe
            g.fillStyle = T.main;
            g.shadowColor = T.main;
            g.shadowBlur = 6;
            g.fillRect(-r * 0.4, sy0 - 1.5 * sy, r * 0.8, 3);
            g.shadowBlur = 0;
        }

        // 5. Main Heavy Torso Hull (hexagonal armored combat chassis)
        g.fillStyle = metal(g, -r * 0.7, -r * 0.6, r * 0.7, r * 0.6, '#3e485e', '#191d28');
        poly(g, [
            -r * 0.65, -r * 0.45,
             r * 0.2,  -r * 0.55,
             r * 0.75, -r * 0.25,
             r * 0.75,  r * 0.25,
             r * 0.2,   r * 0.55,
            -r * 0.65,  r * 0.45,
            -r * 0.75,  0
        ]);
        g.fill();
        g.strokeStyle = '#5a6682';
        g.lineWidth = 1.5;
        g.stroke();

        // Chest armor plate bevel
        g.fillStyle = metal(g, -r * 0.3, -r * 0.35, r * 0.5, r * 0.35, '#54627d', '#272e3d');
        poly(g, [
            -r * 0.35, -r * 0.35,
             r * 0.3,  -r * 0.4,
             r * 0.55, -r * 0.15,
             r * 0.55,  r * 0.15,
             r * 0.3,   r * 0.4,
            -r * 0.35,  r * 0.35
        ]);
        g.fill();
        g.strokeStyle = 'rgba(10,12,18,0.7)';
        g.lineWidth = 1;
        g.stroke();

        // 6. Central Fusion Power Core / Pilot Cockpit Dome
        const pulse = 0.6 + 0.4 * Math.sin(t / 6 + (o.i || 0) * 2);
        const coreR = r * (0.28 + charge * 0.12);
        g.fillStyle = '#10141d';
        g.beginPath();
        g.arc(-r * 0.05, 0, coreR + 3, 0, TAU);
        g.fill();
        g.strokeStyle = T.main;
        g.lineWidth = 1.5;
        g.stroke();

        g.shadowColor = charge > 0.5 ? '#ff4d6a' : T.main;
        g.shadowBlur = 10 + charge * 14;
        g.fillStyle = charge > 0.5 ? '#ffe08a' : T.glow;
        g.beginPath();
        g.arc(-r * 0.05, 0, coreR, 0, TAU);
        g.fill();
        g.fillStyle = `rgba(255,255,255,${0.65 + pulse * 0.35})`;
        g.beginPath();
        g.arc(-r * 0.05, 0, coreR * 0.45, 0, TAU);
        g.fill();
        g.shadowBlur = 0;

        // 7. Tactical Sports Equipment (Front weapon / tool)
        if (weapon === 'soccer') {
            for (const sy of [-1, 1]) {
                g.fillStyle = metal(g, r * 0.4, 0, r * 1.15, 0, '#667491', '#282f3d');
                poly(g, [
                    r * 0.4,  sy * r * 0.4,
                    r * 0.95, sy * r * 0.35,
                    r * 1.1,  sy * r * 0.18,
                    r * 0.75, sy * r * 0.12,
                    r * 0.4,  sy * r * 0.22
                ]);
                g.fill();
                g.strokeStyle = T.main;
                g.lineWidth = 1.2;
                g.stroke();
            }
            g.strokeStyle = charge > 0.5 ? '#ffd34d' : T.glow;
            g.lineWidth = 2.5 + charge * 2.5;
            g.shadowColor = g.strokeStyle;
            g.shadowBlur = 8 + charge * 10;
            g.beginPath();
            g.arc(r * 0.55, 0, r * 0.45, -0.9, 0.9);
            g.stroke();
            g.shadowBlur = 0;
        } else if (weapon === 'tennis') {
            g.save();
            g.translate(r * 0.4, r * 0.3);
            const swing = o.arm !== undefined ? o.arm : 0;
            g.rotate(swing);
            g.fillStyle = '#2f3747';
            g.fillRect(0, -2, r * 0.45, 4);
            g.translate(r * 0.45, 0);
            g.fillStyle = '#6d7b96';
            g.fillRect(0, -2, r * 0.25, 4);
            g.translate(r * 0.25, 0);
            g.strokeStyle = T.glow;
            g.lineWidth = 2.5;
            g.shadowColor = T.glow;
            g.shadowBlur = 10;
            g.beginPath();
            g.ellipse(r * 0.35, 0, r * 0.45, r * 0.3, 0, 0, TAU);
            g.stroke();
            g.shadowBlur = 0;
            g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            g.lineWidth = 0.8;
            g.beginPath();
            for (let gx = -r * 0.2; gx <= r * 0.2; gx += r * 0.14) {
                g.moveTo(r * 0.35 + gx, -r * 0.2);
                g.lineTo(r * 0.35 + gx, r * 0.2);
            }
            for (let gy = -r * 0.15; gy <= r * 0.15; gy += r * 0.1) {
                g.moveTo(r * 0.05, gy);
                g.lineTo(r * 0.65, gy);
            }
            g.stroke();
            g.restore();
        } else if (weapon === 'volley') {
            for (const sy of [-1, 1]) {
                g.fillStyle = metal(g, r * 0.5, 0, r * 0.95, 0, '#7584a3', '#282f3e');
                poly(g, [
                    r * 0.35, sy * r * 0.48,
                    r * 0.85, sy * r * 0.38,
                    r * 0.95, sy * r * 0.15,
                    r * 0.5,  sy * r * 0.18
                ]);
                g.fill();
                g.strokeStyle = T.main;
                g.lineWidth = 1.2;
                g.stroke();
            }
            const wav = (t * 0.3) % 1;
            g.strokeStyle = `rgba(255, 211, 77, ${0.4 + 0.5 * (1 - wav)})`;
            g.lineWidth = 2;
            g.beginPath();
            g.arc(r * 0.5, 0, r * (0.4 + wav * 0.3), -0.8, 0.8);
            g.stroke();
        } else if (weapon === 'hoops') {
            for (const sy of [-1, 1]) {
                g.fillStyle = '#2f3747';
                rrect(g, r * 0.3, sy * r * 0.35 - 3, r * 0.45, 6, 2);
                g.fill();
                g.fillStyle = T.main;
                g.fillRect(r * 0.65, sy * r * 0.35 - 2, 4, 4);
            }
            g.strokeStyle = charge > 0.5 ? '#ff7a22' : T.glow;
            g.lineWidth = 2.5 + charge * 3;
            g.shadowColor = g.strokeStyle;
            g.shadowBlur = 8 + charge * 10;
            g.beginPath();
            g.arc(r * 0.55, 0, r * 0.42, -1.1, 1.1);
            g.stroke();
            g.shadowBlur = 0;
        }

        // 8. Hit flash
        if (flash > 0) {
            g.globalCompositeOperation = 'lighter';
            g.fillStyle = `rgba(255, 255, 255, ${flash * 0.75})`;
            g.beginPath();
            g.arc(0, 0, r * 1.05, 0, TAU);
            g.fill();
            g.globalCompositeOperation = 'source-over';
        }

        g.restore();
    }

    function flameTop(g, x, y, ang, len, col) {
        g.save();
        g.translate(x, y);
        g.rotate(ang);
        g.globalCompositeOperation = 'lighter';
        const fg = g.createLinearGradient(0, 0, len, 0);
        fg.addColorStop(0, '#ffffff');
        fg.addColorStop(0.3, col);
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = fg;
        g.beginPath();
        g.moveTo(0, -3.5);
        g.quadraticCurveTo(len * 1.1, 0, len, 0);
        g.quadraticCurveTo(len * 1.1, 0, 0, 3.5);
        g.closePath();
        g.fill();
        g.restore();
    }

    // ==================================================================
    // Top-down Guardian Defense Drone (Keepers)
    // ==================================================================
    function drone(g, x, y, r, t, ang) {
        g.save();
        g.translate(x, y + Math.sin(t / 9) * 1.2);
        g.rotate(ang || 0);

        // Ground shadow
        g.fillStyle = 'rgba(0, 0, 0, 0.4)';
        g.beginPath();
        g.ellipse(0, 0, r * 1.1, r * 0.9, 0, 0, TAU);
        g.fill();

        // Front energy riot shield
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = `rgba(255, 211, 77, ${0.55 + 0.3 * Math.sin(t / 4)})`;
        g.lineWidth = 3.5;
        g.shadowColor = GOLD;
        g.shadowBlur = 12;
        g.beginPath();
        g.arc(0, 0, r * 1.25, -1.0, 1.0);
        g.stroke();
        g.shadowBlur = 0;
        g.globalCompositeOperation = 'source-over';

        // Drone chassis (top-down quad drone)
        g.fillStyle = metal(g, -r, -r, r, r, '#3a4459', '#1a1f2b');
        poly(g, [
            -r * 0.8, -r * 0.5,
             r * 0.2, -r * 0.7,
             r * 0.8, -r * 0.3,
             r * 0.8,  r * 0.3,
             r * 0.2,  r * 0.7,
            -r * 0.8,  r * 0.5
        ]);
        g.fill();
        g.strokeStyle = '#5a6682';
        g.lineWidth = 1.5;
        g.stroke();

        // Twin energy hover rotors
        for (const sy of [-1, 1]) {
            g.fillStyle = 'rgba(120, 200, 255, 0.4)';
            g.beginPath();
            g.ellipse(0, sy * r * 0.65, r * 0.45, r * 0.18, t * 0.5, 0, TAU);
            g.fill();
        }

        // Central targeting scanner eye
        g.fillStyle = GOLD;
        g.shadowColor = GOLD;
        g.shadowBlur = 10;
        g.beginPath();
        g.arc(r * 0.15, 0, r * 0.28, 0, TAU);
        g.fill();
        g.shadowBlur = 0;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(r * 0.15, 0, r * 0.1, 0, TAU);
        g.fill();

        g.restore();
    }

    // ==================================================================
    // Energy Orbs
    // ==================================================================
    const ORB = {
        volley: { a: '#ffffff', b: '#e3e8f2', c: '#7d8698', seam: GOLD },
        soccer: { a: '#f4f6fa', b: '#9aa3b4', c: '#3b4252', seam: '#2de2ff' },
        tennis: { a: '#f7ffd0', b: '#c8ff3d', c: '#5f8a00', seam: '#ffffff' },
        hoops:  { a: '#ffd2a8', b: '#ff7a22', c: '#7a2e08', seam: GOLD }
    };
    /** A metal-shelled energy ball with glowing seams. */
    function orb(g, x, y, r, spin, kind) {
        const P = ORB[kind] || ORB.volley;
        g.save();
        g.translate(x, y);

        // outer glow
        g.globalCompositeOperation = 'lighter';
        const og = g.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.2);
        og.addColorStop(0, P.seam + '66');
        og.addColorStop(1, P.seam + '00');
        g.fillStyle = og;
        g.beginPath();
        g.arc(0, 0, r * 2.2, 0, TAU);
        g.fill();
        g.globalCompositeOperation = 'source-over';

        // shell gradient
        const sg = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
        sg.addColorStop(0, P.a);
        sg.addColorStop(0.55, P.b);
        sg.addColorStop(1, P.c);
        g.fillStyle = sg;
        g.beginPath();
        g.arc(0, 0, r, 0, TAU);
        g.fill();

        // seams
        g.save();
        g.beginPath();
        g.arc(0, 0, r, 0, TAU);
        g.clip();
        g.rotate(spin || 0);
        g.strokeStyle = P.seam;
        g.lineWidth = Math.max(1.2, r * 0.12);
        g.shadowColor = P.seam;
        g.shadowBlur = 6;
        g.beginPath();
        if (kind === 'soccer') {
            for (let k = 0; k < 6; k++) {
                const a = k * TAU / 6;
                g.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
                g.lineTo(Math.cos(a + TAU / 6) * r * 0.42, Math.sin(a + TAU / 6) * r * 0.42);
                g.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
                g.lineTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
            }
        } else if (kind === 'hoops') {
            g.moveTo(-r, 0); g.lineTo(r, 0); g.moveTo(0, -r); g.lineTo(0, r);
            g.moveTo(-r * 0.3, -r); g.quadraticCurveTo(-r * 0.75, 0, -r * 0.3, r);
            g.moveTo(r * 0.3, -r); g.quadraticCurveTo(r * 0.75, 0, r * 0.3, r);
        } else if (kind === 'tennis') {
            g.moveTo(-r + r * 0.8 * Math.cos(-0.9), r * 0.8 * Math.sin(-0.9));
            g.arc(-r, 0, r * 0.8, -0.9, 0.9);
            g.moveTo(r + r * 0.8 * Math.cos(Math.PI - 0.9), r * 0.8 * Math.sin(Math.PI - 0.9));
            g.arc(r, 0, r * 0.8, Math.PI - 0.9, Math.PI + 0.9);
        } else {
            for (let k = 0; k < 3; k++) {
                g.rotate(TAU / 3);
                g.moveTo(0, 0);
                g.bezierCurveTo(r * 0.9, -r * 0.2, r * 0.9, r * 0.9, -r * 0.1, r * 1.2);
            }
        }
        g.stroke();
        g.restore();

        // core spark + rim
        g.fillStyle = 'rgba(255,255,255,.75)';
        g.beginPath();
        g.ellipse(-r * 0.35, -r * 0.42, r * 0.28, r * 0.16, -0.6, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(10,12,20,.55)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(0, 0, r, 0, TAU);
        g.stroke();

        g.restore();
    }

    /**
     * Additive streak behind a moving ball. b: {x, y, vx, vy, [z, vz]}.
     * dz = true for top-down games (screen y = y - z).
     */
    /** Top-down height cues: sprite scale and ground-shadow offset for height z. */
    function lift(z) { return 1 + Math.min(150, Math.max(0, z || 0)) / 300; }
    function shadowOff(z) { return Math.max(0, z || 0) * 0.32; }

    /** Ground shadow of an airborne object (drawn before the object). */
    function shadow(g, x, y, r, z) {
        const h = Math.min(1, Math.max(0, z || 0) / 160), o = shadowOff(z);
        g.save();
        g.fillStyle = `rgba(0,0,0,${0.5 - h * 0.25})`;
        g.beginPath(); g.arc(x + o, y + o, r * (1 - h * 0.2), 0, TAU); g.fill();
        g.restore();
    }

    /** Motion trail at the ball's true court position (top-down; no height lift). */
    function streak(g, b, r, col, n) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        const rr = r * lift(b.z);
        for (let k = 1; k <= n; k++) {
            g.globalAlpha = 0.32 * (1 - k / (n + 1));
            g.fillStyle = col;
            g.beginPath();
            g.arc(b.x - b.vx * k * 0.9, b.y - b.vy * k * 0.9, rr * (1 - k * 0.09), 0, TAU);
            g.fill();
        }
        g.restore();
    }

    /** Ball seen from directly above: true position, size grows with height. */
    function ball(g, b, r, kind) {
        orb(g, b.x, b.y, r * lift(b.z), b.spin || 0, kind);
    }

    /** Armored arena border: hazard stripes on all four sides of the play area. */
    function rim(g, x0, y0, x1, y1, w) {
        w = w || 6;
        hazard(g, x0 - w - 4, y0 - w - 4, x1 - x0 + 2 * w + 8, w);
        hazard(g, x0 - w - 4, y1 + 4, x1 - x0 + 2 * w + 8, w);
        hazard(g, x0 - w - 4, y0 - 4, w, y1 - y0 + 8);
        hazard(g, x1 + 4, y0 - 4, w, y1 - y0 + 8);
    }

    // ==================================================================
    // Arena pieces
    // ==================================================================
    function seeded(seed) {
        let s = seed || 1;
        return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    }

    /** Brushed-steel deck with plate seams and rivets. */
    function steel(g, x, y, w, h, opt) {
        opt = opt || {};
        g.save();
        g.fillStyle = metal(g, x, y, x, y + h, opt.top || '#232838', opt.bot || '#12151f');
        g.fillRect(x, y, w, h);
        const pw = opt.plate || 64, ph = opt.plateH || pw;
        g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 2;
        for (let px = x; px <= x + w; px += pw) { g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h); g.stroke(); }
        for (let py = y; py <= y + h; py += ph) { g.beginPath(); g.moveTo(x, py); g.lineTo(x + w, py); g.stroke(); }
        g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
        for (let px = x + 1.5; px <= x + w; px += pw) { g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h); g.stroke(); }
        for (let py = y + 1.5; py <= y + h; py += ph) { g.beginPath(); g.moveTo(x, py); g.lineTo(x + w, py); g.stroke(); }
        g.fillStyle = 'rgba(200,210,230,.18)';
        for (let px = x; px < x + w; px += pw) for (let py = y; py < y + h; py += ph) {
            for (const [a, b] of [[5, 5], [pw - 5, 5], [5, ph - 5], [pw - 5, ph - 5]]) {
                if (px + a < x + w && py + b < y + h) { g.beginPath(); g.arc(px + a, py + b, 1.3, 0, TAU); g.fill(); }
            }
        }
        g.restore();
    }

    /** Dark stands with neon light-sticks in the two team colours. */
    function crowd(g, x, y, w, h, seed) {
        const rr = seeded(seed || 7);
        g.save();
        g.fillStyle = metal(g, x, y, x, y + h, '#0a0b14', '#161a28');
        g.fillRect(x, y, w, h);
        const rows = Math.max(2, Math.floor(h / 13));
        for (let r = 0; r < rows; r++) {
            const yy = y + 6 + r * (h - 8) / rows;
            g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x, yy + 6, w, 1);
            for (let k = 0; k < w / 11; k++) {
                const xx = x + 4 + k * 11 + (r % 2) * 5;
                g.fillStyle = '#1c2030';
                g.beginPath(); g.arc(xx, yy + 2, 4, Math.PI, 0); g.fill();
                if (rr() < 0.18) {
                    const c = xx < x + w / 2 ? TEAM[0].main : TEAM[1].main;
                    g.fillStyle = rr() < 0.2 ? GOLD : c;
                    g.shadowColor = g.fillStyle; g.shadowBlur = 6;
                    g.fillRect(xx - 1, yy - 7, 2, 6);
                    g.shadowBlur = 0;
                }
            }
        }
        g.restore();
    }

    function lights(g, W, y, n) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        for (let k = 0; k < n; k++) {
            const x = W * (k + 0.5) / n;
            const lg = g.createRadialGradient(x, y, 2, x, y, 80);
            lg.addColorStop(0, 'rgba(220,235,255,.55)'); lg.addColorStop(1, 'rgba(220,235,255,0)');
            g.fillStyle = lg; g.beginPath(); g.arc(x, y, 80, 0, TAU); g.fill();
            g.fillStyle = '#e8f2ff'; g.fillRect(x - 10, y - 3, 20, 5);
        }
        g.restore();
    }

    function hazard(g, x, y, w, h) {
        g.save();
        g.beginPath(); g.rect(x, y, w, h); g.clip();
        g.fillStyle = '#16181f'; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,200,0,.75)';
        const s = 8;
        for (let k = -h - s; k < w + h; k += s * 2) {
            g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + s, y + h); g.lineTo(x + k + s + h, y); g.lineTo(x + k + h, y); g.closePath(); g.fill();
        }
        g.restore();
    }

    /** Glowing line(s): fn() builds the path, then it is stroked twice (glow + core). */
    function neon(g, col, width, fn) {
        g.save();
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = col; g.globalAlpha = 0.35; g.lineWidth = width * 3;
        g.shadowColor = col; g.shadowBlur = width * 4;
        g.beginPath(); fn(); g.stroke();
        g.globalAlpha = 1; g.lineWidth = width; g.shadowBlur = width * 2;
        g.beginPath(); fn(); g.stroke();
        g.restore();
    }

    function pylon(g, x, yTop, yBot, w) {
        g.save();
        g.fillStyle = metal(g, x - w, 0, x + w, 0, '#8a93a6', '#2a2f3b');
        g.fillRect(x - w, yTop, w * 2, yBot - yTop);
        g.fillStyle = '#1b1f29';
        for (let y = yTop + 10; y < yBot - 6; y += 18) g.fillRect(x - w + 1, y, w * 2 - 2, 2);
        g.fillStyle = '#3b4252';
        poly(g, [x - w - 4, yTop + 2, x + w + 4, yTop + 2, x + w + 2, yTop - 6, x - w - 2, yTop - 6]); g.fill();
        g.fillStyle = GOLD; g.shadowColor = GOLD; g.shadowBlur = 12;
        g.beginPath(); g.arc(x, yTop - 6, 3.5, 0, TAU); g.fill();
        g.restore();
    }

    /** Flickering vertical energy barrier between (x0,y0) and (x1,y1). */
    function field(g, x0, y0, x1, y1, t, col) {
        col = col || '#9bdcff';
        g.save();
        g.globalCompositeOperation = 'lighter';
        const fg = g.createLinearGradient(x0, y0, x1, y1);
        fg.addColorStop(0, col + '55'); fg.addColorStop(1, col + '10');
        g.fillStyle = fg; g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || 1, Math.abs(y1 - y0) || 1);
        g.strokeStyle = col; g.lineWidth = 1;
        g.globalAlpha = 0.35 + 0.15 * Math.sin(t / 3);
        const vert = Math.abs(y1 - y0) > Math.abs(x1 - x0);
        const len = vert ? Math.abs(y1 - y0) : Math.abs(x1 - x0);
        const off = (t * 0.8) % 8;
        g.beginPath();
        for (let k = off; k < len; k += 8) {
            if (vert) { const y = Math.min(y0, y1) + k; g.moveTo(Math.min(x0, x1), y); g.lineTo(Math.max(x0, x1), y); }
            else { const x = Math.min(x0, x1) + k; g.moveTo(x, Math.min(y0, y1)); g.lineTo(x, Math.max(y0, y1)); }
        }
        g.stroke();
        g.restore();
    }

    window.SportMech = {
        TEAM,
        GOLD,
        mech,
        mechTop: mech,
        drone,
        orb,
        streak,
        ball,
        shadow,
        lift,
        rim,
        steel,
        crowd,
        lights,
        hazard,
        neon,
        pylon,
        field,
        poly,
        rrect
    };
})();
