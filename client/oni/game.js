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
    const p1NameEl = document.getElementById('p1-name');
    const p2NameEl = document.getElementById('p2-name');
    const p1HpFill = document.getElementById('p1-hp-fill');
    const p2HpFill = document.getElementById('p2-hp-fill');
    const p1PoiseFill = document.getElementById('p1-poise-fill');
    const p2PoiseFill = document.getElementById('p2-poise-fill');
    const p1DaodanFill = document.getElementById('p1-daodan-fill');
    const p2DaodanFill = document.getElementById('p2-daodan-fill');
    const p1DaodanStage = document.getElementById('p1-daodan-stage');
    const p2DaodanStage = document.getElementById('p2-daodan-stage');
    const p1HypoBadge = document.getElementById('p1-hypo-badge');
    const p2HypoBadge = document.getElementById('p2-hypo-badge');
    const p1WeaponBadge = document.getElementById('p1-weapon-badge');
    const p2WeaponBadge = document.getElementById('p2-weapon-badge');
    const p1HpText = document.getElementById('p1-hp-text');
    const p2HpText = document.getElementById('p2-hp-text');
    const roundTimerEl = document.getElementById('round-timer');
    const roundWaveLabel = document.getElementById('round-wave-label');
    const comboNotice = document.getElementById('combo-notice');
    const koBanner = document.getElementById('ko-banner');
    const startOverlay = document.getElementById('start-overlay');
    const gameoverOverlay = document.getElementById('gameover-overlay');
    const btnStart = document.getElementById('btn-start');
    const btnStartSurvival = document.getElementById('btn-start-survival');
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
        const camKeys = { Digit1: 'side', Digit2: 'diagonal', Digit3: 'shoulder', Digit4: 'top' };
        if (camKeys[e.code]) setCam(threeScene.setCameraMode(camKeys[e.code]));
        if (e.code === 'Digit0') threeScene.resetOrbit();
        if (!isPlaying && (e.code === 'Space' || e.code === 'Enter')) {
            startFight();
        }
    });
    window.addEventListener('keyup', (e) => {
        keysDown[e.code] = false;
    });

    // Camera view switcher
    const btnCam = document.getElementById('btn-camera');
    const btnCamText = document.getElementById('btn-camera-text');
    function setCam(mode) {
        if (btnCamText) btnCamText.textContent = (locale.cam_modes && locale.cam_modes[mode]) || mode;
    }
    if (btnCam) {
        btnCam.addEventListener('click', (e) => {
            e.stopPropagation();
            setCam(threeScene.cycleCameraMode());
        });
    }
    setCam(threeScene.camMode);

    // Touch Virtual Joystick & Buttons
    const touchState = { punch: false, kick: false, block: false, slide: false, jump: false, crouch: false, throwBtn: false, fire: false, daodan: false, heal: false };
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
    setupTouchBtn('btn-jump', 'jump');
    setupTouchBtn('p1-hypo-badge', 'heal');
    if (p1DaodanFill && p1DaodanFill.parentElement) {
        p1DaodanFill.parentElement.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            touchState.daodan = true;
        });
        window.addEventListener('pointerup', () => { touchState.daodan = false; });
    }

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
        const down = dirZ > 0.4; // screen-space "down" for motion commands (uppercut)

        // screen-relative stick -> world axes, following the current camera yaw
        const yaw = threeScene.getInputYaw();
        const c = Math.cos(yaw), sn = Math.sin(yaw);
        const snap = v => (Math.abs(v) < 0.15 ? 0 : Math.max(-1, Math.min(1, v)));
        const wx = snap(c * dirX + sn * dirZ);
        const wz = snap(-sn * dirX + c * dirZ);
        dirX = wx; dirZ = wz;

        const punch = !!(keysDown['KeyJ'] || keysDown['KeyZ'] || touchState.punch);
        const kick = !!(keysDown['KeyK'] || keysDown['KeyX'] || touchState.kick);
        const block = !!(keysDown['KeyL'] || keysDown['KeyC'] || touchState.block);
        const jump = !!(keysDown['Space'] || touchState.jump);
        const crouch = !!(keysDown['ShiftLeft'] || keysDown['ShiftRight'] || touchState.crouch);
        const slide = !!(keysDown['KeyI'] || keysDown['KeyV'] || touchState.slide);
        const throwBtn = !!(keysDown['KeyU'] || keysDown['KeyG'] || touchState.throwBtn || (punch && kick));
        const fire = !!(keysDown['KeyF'] || touchState.fire);
        const heal = !!(keysDown['KeyH'] || touchState.heal);
        const daodan = !!(keysDown['KeyQ'] || keysDown['KeyE'] || touchState.daodan);

        return { dirX, dirZ, down, punch, kick, block, jump, crouch, slide, throwBtn, fire, heal, daodan };
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

    function startFight(survival = false) {
        startOverlay.classList.add('hidden');
        gameoverOverlay.classList.add('hidden');
        koBanner.style.display = 'none';
        sim.survivalMode = !!survival;
        sim.reset();
        if (survival) {
            sim.enableSurvivalMode(true);
            botBrain.setLevel(sim.f2.aiProfileLevel || 'easy');
        } else {
            botBrain.setLevel(botMode);
        }
        isPlaying = true;
        document.body.classList.add('in-fight');
    }

    btnStart.addEventListener('click', () => startFight(false));
    if (btnStartSurvival) {
        btnStartSurvival.addEventListener('click', () => startFight(true));
    }
    btnRematch.addEventListener('click', () => startFight(sim.survivalMode));

    // Event Dispatcher
    function showActionNotice(text) {
        comboNotice.textContent = text;
        comboNotice.classList.add('show');
        clearTimeout(comboNotice.hideTimer);
        comboNotice.hideTimer = setTimeout(() => {
            comboNotice.classList.remove('show');
        }, 1200);
    }

    function processSimEvents(events) {
        for (const ev of events) {
            if (ev.type === 'HIT') {
                // Hit sparks
                vfx.spawnHitSpark(ev.hitPoint.x, ev.hitPoint.y, ev.hitPoint.z, ev.blocked);

                // Heavy impacts produce shockwaves & camera shake
                if (!ev.blocked) threeScene.hitFlash(ev.knockdown ? 0.22 : 0.08);
                if (ev.knockdown || ev.poiseBroken || ev.isThrow) {
                    threeScene.addTrauma(0.45);
                    vfx.spawnShockwave(ev.hitPoint.x, 0.05, ev.hitPoint.z, ev.attacker === 'p1' ? 0x00f0ff : 0xff0055);
                } else {
                    threeScene.addTrauma(0.18);
                }

                // Combo or special state notice
                if (ev.disarmed) {
                    showActionNotice('DISARMED! 缴械击飞!');
                } else if (ev.poiseBroken) {
                    showActionNotice('STUNNED! 破防眩晕!');
                } else if (ev.isThrow) {
                    showActionNotice(`${ev.move.name}!`);
                } else if (ev.combo >= 2) {
                    showActionNotice(`${ev.combo} HITS!`);
                }
            } else if (ev.type === 'WEAPON_FIRE') {
                vfx.spawnTracerBeam(
                    ev.muzzle,
                    ev.endPoint,
                    ev.color,
                    ev.fireType === 'PIERCING_BEAM'
                );
                threeScene.addTrauma(ev.fireType === 'PIERCING_BEAM' ? 0.35 : 0.12);
            } else if (ev.type === 'WEAPON_SNATCH') {
                vfx.spawnShockwave(ev.x, ev.y, ev.z, 0x00ffaa);
                showActionNotice('SNATCHED! 凌空夺枪!');
            } else if (ev.type === 'WEAPON_PICKUP') {
                vfx.spawnShockwave(ev.x, Math.max(0.1, ev.y), ev.z, 0x00f0ff);
                if (ev.midAir) {
                    showActionNotice('AIR GRAB! 空中接枪!');
                }
            } else if (ev.type === 'THROW_TECH') {
                vfx.spawnShockwave(ev.x, 0.9, ev.z, 0xffe600);
                threeScene.addTrauma(0.28);
                showActionNotice('THROW TECH! 拆投!');
            } else if (ev.type === 'TECH_RECOVERY') {
                vfx.spawnShockwave(ev.x, 0.15, ev.z, 0x00ff88);
                showActionNotice('UKEMI! 受身!');
            } else if (ev.type === 'HYPO_HEAL') {
                vfx.spawnShockwave(ev.x, 0.9, ev.z, 0x00ff88);
                vfx.spawnHitSpark(ev.x, ev.y, ev.z, false, 16);
                showActionNotice(`HYPO-SPRAY! +${ev.healed} HP`);
            } else if (ev.type === 'DAODAN_STAGE_UP') {
                vfx.spawnShockwave(ev.x, 0.85, ev.z, 0xd946ef);
                showActionNotice(`DAODAN STAGE ${ev.stage}! 道弹进化!`);
            } else if (ev.type === 'DAODAN_OVERDRIVE') {
                vfx.spawnShockwave(ev.x, 0.95, ev.z, 0xf0abfc);
                vfx.spawnShockwave(ev.x, 0.1, ev.z, 0x00f0ff);
                threeScene.addTrauma(0.55);
                threeScene.hitFlash(0.28);
                showActionNotice('DAODAN OVERDRIVE! 道弹蛹完全觉醒!');
            } else if (ev.type === 'FALL_DAMAGE') {
                vfx.spawnShockwave(ev.x, ev.y, ev.z, 0xffaa00);
                threeScene.addTrauma(0.38);
                showActionNotice(`FALL IMPACT! -${ev.damage} HP 跌落重创!`);
            } else if (ev.type === 'RING_OUT') {
                vfx.spawnShockwave(ev.x, -1.8, ev.z, 0xff0055);
                threeScene.addTrauma(0.75);
                showActionNotice('RING OUT! 击落深渊!');
            } else if (ev.type === 'WAVE_CLEARED') {
                showActionNotice(`WAVE ${ev.wave} CLEARED! +1💉 增援接近中!`);
            } else if (ev.type === 'WAVE_SPAWN') {
                botBrain.setLevel(ev.level || 'normal');
                vfx.spawnShockwave(ev.x, 0.15, ev.z, 0xff0077);
                showActionNotice(`WAVE ${ev.wave}: ${ev.enemyName}!`);
            } else if (ev.type === 'KO') {
                const isRingOut = sim.f1.ringOut || sim.f2.ringOut;
                koBanner.textContent = isRingOut ? 'RING OUT!' : 'K.O.';
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
                    p2Input = botBrain.think(sim.f2, sim.f1, sim);
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
        meshP1.camYaw = meshP2.camYaw = threeScene.camYaw;
        meshP1.update(sim.f1, timeSec);
        meshP2.update(sim.f2, timeSec);

        vfx.syncEntities(sim);
        vfx.update(delta);
        threeScene.updateCamera(sim.f1, sim.f2, !isPlaying, timeSec);
        threeScene.render();

        // Update HUD
        if (p1NameEl) p1NameEl.textContent = sim.f1.name || 'KONOKO';
        if (p2NameEl) p2NameEl.textContent = sim.f2.name || 'SYNDI-BOT';
        p1HpFill.style.width = `${Math.max(0, (sim.f1.hp / sim.f1.maxHp) * 100)}%`;
        p2HpFill.style.width = `${Math.max(0, (sim.f2.hp / sim.f2.maxHp) * 100)}%`;
        if (p1PoiseFill) p1PoiseFill.style.width = `${Math.max(0, (sim.f1.poise / sim.f1.maxPoise) * 100)}%`;
        if (p2PoiseFill) p2PoiseFill.style.width = `${Math.max(0, (sim.f2.poise / sim.f2.maxPoise) * 100)}%`;
        if (p1DaodanFill) {
            p1DaodanFill.style.width = `${Math.max(0, (sim.f1.daodanMeter / sim.f1.maxDaodanMeter) * 100)}%`;
            if (p1DaodanFill.parentElement) {
                p1DaodanFill.parentElement.classList.toggle('overdrive', !!sim.f1.daodanOverdrive);
            }
        }
        if (p2DaodanFill) {
            p2DaodanFill.style.width = `${Math.max(0, (sim.f2.daodanMeter / sim.f2.maxDaodanMeter) * 100)}%`;
            if (p2DaodanFill.parentElement) {
                p2DaodanFill.parentElement.classList.toggle('overdrive', !!sim.f2.daodanOverdrive);
            }
        }
        if (p1DaodanStage) p1DaodanStage.textContent = sim.f1.daodanOverdrive ? 'OVR' : `S${sim.f1.daodanStage}`;
        if (p2DaodanStage) p2DaodanStage.textContent = sim.f2.daodanOverdrive ? 'OVR' : `S${sim.f2.daodanStage}`;
        if (p1HypoBadge) {
            p1HypoBadge.textContent = `💉×${sim.f1.hypoCount}`;
            p1HypoBadge.classList.toggle('empty', sim.f1.hypoCount <= 0);
        }
        if (p2HypoBadge) {
            p2HypoBadge.textContent = `💉×${sim.f2.hypoCount}`;
            p2HypoBadge.classList.toggle('empty', sim.f2.hypoCount <= 0);
        }
        if (roundWaveLabel) {
            roundWaveLabel.textContent = sim.survivalMode ? `WAVE ${sim.waveNumber}` : 'TIME';
        }
        if (p1WeaponBadge) {
            if (sim.f1.weapon) {
                p1WeaponBadge.textContent = `🔫 ${sim.f1.weapon.type} [${sim.f1.weapon.ammo}/${sim.f1.weapon.maxAmmo}]`;
                p1WeaponBadge.classList.add('armed');
            } else {
                p1WeaponBadge.textContent = '徒手';
                p1WeaponBadge.classList.remove('armed');
            }
        }
        if (p2WeaponBadge) {
            if (sim.f2.weapon) {
                p2WeaponBadge.textContent = `🔫 ${sim.f2.weapon.type} [${sim.f2.weapon.ammo}/${sim.f2.weapon.maxAmmo}]`;
                p2WeaponBadge.classList.add('armed');
            } else {
                p2WeaponBadge.textContent = '徒手';
                p2WeaponBadge.classList.remove('armed');
            }
        }
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
