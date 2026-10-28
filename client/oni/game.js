/**
 * Oni Combat - Main Orchestrator (game.js)
 * Bridges Input, Deterministic Simulation (60Hz Fixed Tick),
 * Three.js Viewport, Bot AI, and WebRTC Multiplayer Transport.
 */

import { Simulation } from './src/core/Simulation.js';
import { FIXED_DT } from './src/core/Constants.js';
import { BotBrain } from './src/core/BotBrain.js';
import { ThreeScene } from './src/render/ThreeScene.js';
import { ProceduralFighterMesh } from './src/render/ProceduralFighterMesh.js';
import { VFXSystem } from './src/render/VFXSystem.js';
import { getLocale } from './i18n.js';

function init() {
    'use strict';

    const locale = getLocale();
    const qs = new URLSearchParams(location.search);
    const botMode = qs.get('bot') || 'normal'; // 'easy' | 'normal' | 'hard'

    // DOM Elements
    const container = document.getElementById('canvas-container');
    const p1HpFill = document.getElementById('p1-hp-fill');
    const p2HpFill = document.getElementById('p2-hp-fill');
    const p1HpText = document.getElementById('p1-hp-text');
    const p2HpText = document.getElementById('p2-hp-text');
    const roundTimerEl = document.getElementById('round-timer');
    const comboNotice = document.getElementById('combo-notice');
    const koBanner = document.getElementById('ko-banner');
    const startOverlay = document.getElementById('start-overlay');
    const gameoverOverlay = document.getElementById('gameover-overlay');
    const btnStart = document.getElementById('btn-start');
    const btnRematch = document.getElementById('btn-rematch');
    const winnerText = document.getElementById('winner-text');
    const fpsCounter = document.getElementById('fps-counter');
    const btnToggleMoves = document.getElementById('btn-toggle-moves');
    const movesPanel = document.getElementById('moves-panel');
    const joystickZone = document.getElementById('joystick-zone');
    const joystickBase = document.getElementById('joystick-base');
    const joystickStick = document.getElementById('joystick-stick');

    // Toggle Moves Panel on mobile / compact screens
    if (btnToggleMoves && movesPanel) {
        btnToggleMoves.addEventListener('click', (e) => {
            e.stopPropagation();
            movesPanel.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!movesPanel.contains(e.target) && e.target !== btnToggleMoves) {
                movesPanel.classList.remove('open');
            }
        });
    }

    // Systems
    const threeScene = new ThreeScene(container);
    const sim = new Simulation();
    const meshP1 = new ProceduralFighterMesh(threeScene.scene, true);
    const meshP2 = new ProceduralFighterMesh(threeScene.scene, false);
    const vfx = new VFXSystem(threeScene.scene);
    const botBrain = new BotBrain(botMode);

    // Keyboard & Input State
    const keysDown = {};
    window.addEventListener('keydown', (e) => {
        keysDown[e.code] = true;
        if (!isPlaying && (e.code === 'Space' || e.code === 'Enter')) {
            startFight();
        }
    });
    window.addEventListener('keyup', (e) => {
        keysDown[e.code] = false;
    });

    // Touch Virtual Joystick & Buttons
    const touchState = { punch: false, kick: false, block: false, slide: false };
    const setupTouchBtn = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            touchState[key] = true;
            el.classList.add('active');
        });
        const release = (e) => {
            touchState[key] = false;
            el.classList.remove('active');
        };
        el.addEventListener('pointerup', release);
        el.addEventListener('pointercancel', release);
    };
    setupTouchBtn('btn-punch', 'punch');
    setupTouchBtn('btn-kick', 'kick');
    setupTouchBtn('btn-slide', 'slide');
    setupTouchBtn('btn-block', 'block');

    // Virtual Joystick logic (supports touch & mouse drag)
    let touchDirX = 0;
    let touchDirZ = 0;
    let isJoystickDragging = false;
    let lastTapTime = 0;

    if (joystickZone && joystickBase && joystickStick) {
        const maxRadius = 36;
        let baseRect = null;

        const onJoyStart = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isJoystickDragging = true;
            baseRect = joystickBase.getBoundingClientRect();
            onJoyMove(e);

            // Double tap dash detection
            const now = performance.now();
            if (now - lastTapTime < 280) {
                sim.f1.dashTimer = 25; // Dash impulse
            }
            lastTapTime = now;
        };

        const onJoyMove = (e) => {
            if (!isJoystickDragging || !baseRect) return;
            const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
            const centerX = baseRect.left + baseRect.width / 2;
            const centerY = baseRect.top + baseRect.height / 2;

            let dx = clientX - centerX;
            let dy = clientY - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > maxRadius) {
                dx = (dx / dist) * maxRadius;
                dy = (dy / dist) * maxRadius;
            }

            joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;

            // Deadzone of 6px
            if (dist > 6) {
                touchDirX = dx / maxRadius;
                touchDirZ = dy / maxRadius;
            } else {
                touchDirX = 0;
                touchDirZ = 0;
            }
        };

        const onJoyEnd = () => {
            isJoystickDragging = false;
            touchDirX = 0;
            touchDirZ = 0;
            joystickStick.style.transform = 'translate(0px, 0px)';
        };

        joystickZone.addEventListener('pointerdown', onJoyStart);
        window.addEventListener('pointermove', onJoyMove);
        window.addEventListener('pointerup', onJoyEnd);
        window.addEventListener('pointercancel', onJoyEnd);
    }

    function samplePlayerInput() {
        let dirX = 0;
        let dirZ = 0;

        if (keysDown['KeyA'] || keysDown['ArrowLeft']) dirX -= 1;
        if (keysDown['KeyD'] || keysDown['ArrowRight']) dirX += 1;
        if (keysDown['KeyW'] || keysDown['ArrowUp']) dirZ -= 1;
        if (keysDown['KeyS'] || keysDown['ArrowDown']) dirZ += 1;

        // Combine touch virtual joystick
        if (Math.abs(touchDirX) > 0.2) {
            dirX += touchDirX > 0 ? 1 : -1;
        }
        if (Math.abs(touchDirZ) > 0.2) {
            dirZ += touchDirZ > 0 ? 1 : -1;
        }
        dirX = Math.max(-1, Math.min(1, dirX));
        dirZ = Math.max(-1, Math.min(1, dirZ));

        const punch = !!(keysDown['KeyJ'] || keysDown['KeyZ'] || touchState.punch);
        let kick = !!(keysDown['KeyK'] || keysDown['KeyX'] || touchState.kick);
        const block = !!(keysDown['KeyL'] || keysDown['KeyC'] || touchState.block);
        const jump = !!keysDown['Space'];

        // Quick slide-kick button trigger
        if (touchState.slide) {
            sim.f1.dashTimer = 25; // Trigger sprint state
            kick = true;
        }

        return { dirX, dirZ, punch, kick, block, jump };
    }

    // Match State
    let isPlaying = false;
    let isMultiplayer = false;
    let myRole = 'host'; // 'host' or 'client'
    let session = null;

    // Expose for E2E testing
    window.__oni = {
        sim,
        threeScene,
        startFight,
        getState: () => ({
            isPlaying,
            p1: { hp: sim.f1.hp, state: sim.f1.state, x: sim.f1.x, combo: sim.f1.comboCount },
            p2: { hp: sim.f2.hp, state: sim.f2.state, x: sim.f2.x, combo: sim.f2.comboCount },
            roundTimer: sim.roundTimer,
            isMatchOver: sim.isMatchOver,
            winner: sim.winner
        })
    };

    // Optional WebRTC integration with Link platform
    if (window.GameBot && typeof window.GameBot.session === 'function') {
        session = window.GameBot.session({
            gameFolder: 'oni',
            onRole: (role) => {
                myRole = role;
            },
            onChannelOpen: () => {
                isMultiplayer = true;
            },
            onMessage: (msg) => {
                if (msg.type === 'input' && myRole === 'host') {
                    remoteInput = msg.input;
                } else if (msg.type === 'state' && myRole === 'client') {
                    // Client syncs snapshot
                }
            }
        });
    }

    let remoteInput = { dirX: 0, dirZ: 0, punch: false, kick: false, block: false };

    function startFight() {
        startOverlay.classList.add('hidden');
        gameoverOverlay.classList.add('hidden');
        koBanner.style.display = 'none';
        sim.reset();
        isPlaying = true;
    }

    btnStart.addEventListener('click', startFight);
    btnRematch.addEventListener('click', startFight);

    // Event Dispatcher
    function processSimEvents(events) {
        for (const ev of events) {
            if (ev.type === 'HIT') {
                // Hit sparks
                vfx.spawnHitSpark(ev.hitPoint.x, ev.hitPoint.y, ev.hitPoint.z, ev.blocked);

                // Heavy impacts produce shockwaves & camera shake
                if (ev.knockdown) {
                    threeScene.addTrauma(0.45);
                    vfx.spawnShockwave(ev.hitPoint.x, 0.05, ev.hitPoint.z, ev.attacker === 'p1' ? 0x00f0ff : 0xff0055);
                } else {
                    threeScene.addTrauma(0.18);
                }

                // Combo Notice
                if (ev.combo >= 2) {
                    comboNotice.textContent = `${ev.combo} HITS!`;
                    comboNotice.classList.add('show');
                    clearTimeout(comboNotice.hideTimer);
                    comboNotice.hideTimer = setTimeout(() => {
                        comboNotice.classList.remove('show');
                    }, 1200);
                }
            } else if (ev.type === 'KO') {
                koBanner.style.display = 'block';
                threeScene.addTrauma(0.65);
                setTimeout(() => {
                    winnerText.textContent = ev.winner === 'p1' ? locale.winner_p1 : locale.winner_p2;
                    gameoverOverlay.classList.remove('hidden');
                }, 1600);
            }
        }
    }

    // Fixed Timestep Accumulator Loop
    let lastTime = performance.now();
    let accumulator = 0;
    let frameCounter = 0;
    let lastFpsUpdate = performance.now();

    function gameLoop(currentTime) {
        requestAnimationFrame(gameLoop);

        const delta = Math.min((currentTime - lastTime) / 1000, 0.1); // clamp to avoid spiral of death
        lastTime = currentTime;
        accumulator += delta;

        // FPS meter
        frameCounter++;
        if (currentTime - lastFpsUpdate >= 1000) {
            fpsCounter.textContent = `${frameCounter} FPS`;
            frameCounter = 0;
            lastFpsUpdate = currentTime;
        }

        // Fixed 60Hz Physics & Logic Ticks
        while (accumulator >= FIXED_DT) {
            accumulator -= FIXED_DT;

            if (isPlaying) {
                const p1Input = samplePlayerInput();
                let p2Input;

                if (isMultiplayer && myRole === 'host') {
                    p2Input = remoteInput;
                } else {
                    p2Input = botBrain.think(sim.f2, sim.f1);
                }

                // Tick simulation
                sim.tick(p1Input, p2Input);

                // Drain and handle events
                if (sim.events.length > 0) {
                    processSimEvents(sim.events);
                }
            }
        }

        // Visual Updates & Rendering
        const timeSec = currentTime / 1000;
        meshP1.update(sim.f1, timeSec);
        meshP2.update(sim.f2, timeSec);

        vfx.update(delta);
        threeScene.updateCamera(sim.f1, sim.f2, !isPlaying, timeSec);
        threeScene.render();

        // Update HUD
        p1HpFill.style.width = `${Math.max(0, (sim.f1.hp / sim.f1.maxHp) * 100)}%`;
        p2HpFill.style.width = `${Math.max(0, (sim.f2.hp / sim.f2.maxHp) * 100)}%`;
        p1HpText.textContent = `${Math.ceil(sim.f1.hp)} / ${sim.f1.maxHp}`;
        p2HpText.textContent = `${Math.ceil(sim.f2.hp)} / ${sim.f2.maxHp}`;
        roundTimerEl.textContent = Math.ceil(sim.roundTimer / 60);
    }

    requestAnimationFrame(gameLoop);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
