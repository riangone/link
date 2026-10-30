/**
 * Link Spin 3D - Main Game Loop & Systems Controller
 * Ultra-Responsive Top-Down 2.5D/3D Action Beyblade Arena.
 *
 * Fully addresses user feedback:
 * 1. Zero UI Obstruction: Unblocked viewport with sleek corner gauges.
 * 2. Solid & Resilient Tops: Balanced clash physics, tops don't burst on soft touches.
 * 3. Intuitive Dual Controls: Classic Touch Joystick, Dash & Special keys, WASD navigation.
 * 4. Classic Launch Meter: Oscillating power bar with satisfying PERFECT timing.
 */

import * as THREE from './vendor/three.module.js';

import {
    FIXED_DT,
    CORES_3D,
    MAX_SPIN,
    MAX_BURST_HP
} from './src/core/Constants.js';

import { Top3D, Simulation3D } from './src/core/Physics3D.js';
import { CollisionSystem3D } from './src/core/Collision3D.js';
import { BotBrain3D } from './src/core/BotBrain3D.js';

import { ThreeScene } from './src/render/ThreeScene.js';
import { StadiumMesh } from './src/render/StadiumMesh.js';
import { BeyMesh } from './src/render/BeyMesh.js';
import { VFXSystem3D } from './src/render/VFXSystem3D.js';
import { TrailSystem3D } from './src/render/TrailSystem3D.js';
import { CameraRig } from './src/render/CameraRig.js';
import { SoundSynth } from './src/audio/SoundSynth.js';

document.addEventListener('DOMContentLoaded', () => {
    // URL Options
    const urlParams = new URLSearchParams(window.location.search);
    const botMode = urlParams.get('bot') || 'normal';

    // DOM Elements
    const container = document.getElementById('canvas-container');
    const p1ScoreEl = document.getElementById('p1-score');
    const p2ScoreEl = document.getElementById('p2-score');
    const roundIndicatorEl = document.getElementById('round-indicator');

    const p1NameEl = document.getElementById('p1-name');
    const p2NameEl = document.getElementById('p2-name');
    const p1CoreNameEl = document.getElementById('p1-core-name');
    const p2CoreNameEl = document.getElementById('p2-core-name');
    const p1SpinText = document.getElementById('p1-spin-text');
    const p2SpinText = document.getElementById('p2-spin-text');
    const p1BurstFill = document.getElementById('p1-burst-fill');
    const p2BurstFill = document.getElementById('p2-burst-fill');

    const xdashBanner = document.getElementById('xdash-banner');
    const countdownBox = document.getElementById('countdown-box');
    const floatersLayer = document.getElementById('floaters-layer');

    const launchOverlay = document.getElementById('launch-overlay');
    const meterIndicator = document.getElementById('meter-indicator');
    const launchBtn = document.getElementById('launch-btn');

    const stickZone = document.getElementById('stick-zone');
    const stickKnob = document.getElementById('stick-knob');
    const dashBtn = document.getElementById('dash-btn');
    const specialBtn = document.getElementById('special-btn');
    const specialBtnText = document.getElementById('special-btn-text');

    const roundModal = document.getElementById('round-modal');
    const finishTypeTitle = document.getElementById('finish-type-title');
    const roundWinnerText = document.getElementById('round-winner-text');
    const roundScoreSummary = document.getElementById('round-score-summary');
    const btnNextRound = document.getElementById('btn-next-round');

    const gameoverModal = document.getElementById('gameover-modal');
    const gameoverTitle = document.getElementById('gameover-title');
    const gameoverScoreText = document.getElementById('gameover-score-text');
    const btnRematch = document.getElementById('btn-rematch');

    const selectModal = document.getElementById('select-modal');
    const coreGrid = document.getElementById('core-grid');
    const btnConfirmTop = document.getElementById('btn-confirm-top');
    const btnCloseSelect = document.getElementById('btn-close-select');

    const guideModal = document.getElementById('guide-modal');
    const btnGuide = document.getElementById('btn-guide');
    const btnCloseGuide = document.getElementById('btn-close-guide');

    const btnCamera = document.getElementById('btn-camera');
    const btnCameraText = document.getElementById('btn-camera-text');
    const btnDiff = document.getElementById('btn-diff');
    const btnDiffText = document.getElementById('btn-diff-text');
    const btnSound = document.getElementById('btn-sound');
    const soundIcon = document.getElementById('sound-icon');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnCore = document.getElementById('btn-core');

    // 3D Rendering & Systems
    const scene = new ThreeScene(container);
    const stadium = new StadiumMesh();
    scene.scene.add(stadium.group);

    const vfx = new VFXSystem3D(scene.scene);
    const trails = new TrailSystem3D(scene.scene);
    const cameraRig = new CameraRig(scene.camera, scene.renderer.domElement);
    const audio = new SoundSynth();
    const botBrain = new BotBrain3D(botMode);
    const simulation = new Simulation3D();

    // Responsive Auto-Fit Arena Framing Hook
    scene.onResizeCallback = () => {
        cameraRig.updateFittedDistance();
        cameraRig.setMode(cameraRig.mode);
    };

    // Floater Text Projector
    const projVec = new THREE.Vector3();
    function showFloater(text, wx, wy, wz, color = '#ffd34d', size = '1.25rem') {
        if (!floatersLayer) return;
        projVec.set(wx, wy, wz);
        projVec.project(scene.camera);
        if (projVec.z > 1.0) return; // Behind camera
        const screenX = (projVec.x * 0.5 + 0.5) * window.innerWidth;
        const screenY = (-(projVec.y * 0.5) + 0.5) * window.innerHeight;

        const el = document.createElement('div');
        el.className = 'floater-item';
        el.style.left = `${screenX}px`;
        el.style.top = `${screenY}px`;
        el.style.color = color;
        el.style.fontSize = size;
        el.textContent = text;
        floatersLayer.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 900);
    }

    // Match & Game State
    let p1Core = CORES_3D.attack;
    let p2Core = CORES_3D.defense;
    let selectedCoreId = 'attack';

    let t1 = new Top3D('p1', p1Core, 0);
    let t2 = new Top3D('p2', p2Core, 1);

    let t1Mesh = new BeyMesh(t1);
    let t2Mesh = new BeyMesh(t2);
    scene.scene.add(t1Mesh.group);
    scene.scene.add(t2Mesh.group);

    let scores = [0, 0];
    let currentRound = 1;
    let statePhase = 'launch_ready'; // 'launch_ready', 'countdown', 'battle', 'round_finish', 'game_over'
    let countdownTimer = 0;
    let finishCooldown = 0;

    // Launch Power Oscillating Meter
    let meterProgress = 0; // 0.0 to 1.0
    let meterDirection = 1;
    const meterSpeed = 1.35;

    // Real-time Player Navigation Input Vector
    const playerInput = { x: 0, z: 0 };
    const keyState = { up: false, down: false, left: false, right: false };

    // Core Selection Builder
    function renderCoreGrid() {
        coreGrid.innerHTML = '';
        Object.values(CORES_3D).forEach(core => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `core-card ${core.id === selectedCoreId ? 'selected' : ''}`;
            card.innerHTML = `
                <div class="core-card-title" style="color: ${core.color1};">${core.name}</div>
                <div class="core-card-type">${core.type}</div>
                <div style="font-size: 0.72rem; color: #aaa;">必杀: ${core.specialName}</div>
                <div style="font-size: 0.68rem; color: #888; margin-top: 4px;">攻:${core.attackPower} 防:${core.defenseFactor} 耐爆:${core.burstResist}</div>
            `;
            card.addEventListener('click', () => {
                selectedCoreId = core.id;
                document.querySelectorAll('.core-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
            });
            coreGrid.appendChild(card);
        });
    }

    // Set Bot Difficulty
    const diffNames = { easy: '简单', normal: '普通', hard: '极难' };
    btnDiffText.textContent = `难度: ${diffNames[botMode] || '普通'}`;

    btnDiff.addEventListener('click', () => {
        const modes = ['easy', 'normal', 'hard'];
        const next = modes[(modes.indexOf(botBrain.difficulty) + 1) % modes.length];
        botBrain.setDifficulty(next);
        btnDiffText.textContent = `难度: ${diffNames[next]}`;
    });

    // Sound Switch
    btnSound.addEventListener('click', () => {
        const enabled = audio.toggle();
        soundIcon.textContent = enabled ? '🔊' : '🔇';
    });

    // Camera Mode Toggle
    function updateCameraBtnLabel(mode) {
        if (mode === 'topdown') btnCameraText.textContent = '俯瞰机位';
        else if (mode === 'action') btnCameraText.textContent = '动作机位';
        else btnCameraText.textContent = '自由机位';
    }
    updateCameraBtnLabel(cameraRig.mode);

    btnCamera.addEventListener('click', () => {
        const nextMode = cameraRig.cycleMode();
        updateCameraBtnLabel(nextMode);
    });

    // Fullscreen Toggle
    btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    });

    // Modals
    btnCore.addEventListener('click', () => {
        renderCoreGrid();
        selectModal.classList.remove('hidden');
    });
    btnCloseSelect.addEventListener('click', () => selectModal.classList.add('hidden'));
    btnConfirmTop.addEventListener('click', () => {
        p1Core = CORES_3D[selectedCoreId] || CORES_3D.attack;
        p1CoreNameEl.textContent = p1Core.name;
        selectModal.classList.add('hidden');
        resetRound(true);
    });

    btnGuide.addEventListener('click', () => guideModal.classList.remove('hidden'));
    btnCloseGuide.addEventListener('click', () => guideModal.classList.add('hidden'));

    // Reset Round
    function resetRound(fullReset = false) {
        statePhase = 'launch_ready';
        countdownTimer = 0;
        finishCooldown = 0;

        countdownBox.style.display = 'none';
        launchOverlay.classList.remove('hidden');
        roundModal.classList.add('hidden');
        xdashBanner.classList.remove('active');

        // Opponent counter-pick if full reset
        if (fullReset) {
            const oppCores = [CORES_3D.defense, CORES_3D.stamina, CORES_3D.balance, CORES_3D.dragon];
            p2Core = oppCores[Math.floor(Math.random() * oppCores.length)];
            p2CoreNameEl.textContent = p2Core.name;
        }

        scene.scene.remove(t1Mesh.group);
        scene.scene.remove(t2Mesh.group);

        t1 = new Top3D('p1', p1Core, 0);
        t2 = new Top3D('p2', p2Core, 1);

        t1Mesh = new BeyMesh(t1);
        t2Mesh = new BeyMesh(t2);
        scene.scene.add(t1Mesh.group);
        scene.scene.add(t2Mesh.group);

        vfx.clear();
        trails.clear();
        updateHUD();
    }

    // Launch Top Action
    function triggerPlayerLaunch(power = 1.0, perfect = false) {
        if (statePhase !== 'launch_ready') return;

        statePhase = 'countdown';
        launchOverlay.classList.add('hidden');

        audio.playLaunchBeep(false);
        if (perfect) {
            vfx.spawnSpecialAura(0, 0, 0, p1Core.color1);
            cameraRig.addTrauma(0.35);
            showFloater('🌟 PERFECT LAUNCH!!', 0, 2.0, 16.0, '#ffd34d', '1.45rem');
        }

        // Spawn Tops
        t1.reset(0, 16.0, power, perfect);

        // Bot Launch
        const botLaunch = botBrain.getLaunchParams();
        t2.reset(0, -16.0, botLaunch.power, botLaunch.perfect);

        // 3-2-1 Countdown
        countdownTimer = 2.1;
        countdownBox.style.display = 'block';
        countdownBox.textContent = '3';
    }

    // Launch button click & Spacebar
    launchBtn.addEventListener('click', () => {
        // Meter value: 0 to 1. Perfect zone is around 0.80 to 0.95
        const isPerfect = meterProgress >= 0.78 && meterProgress <= 0.96;
        const power = 0.7 + meterProgress * 0.3;
        triggerPlayerLaunch(power, isPerfect);
    });

    // Virtual Joystick Controller (Touch / Mouse drag on stick zone)
    let stickActive = false;
    let stickCenter = { x: 0, y: 0 };
    const maxStickRadius = 34;

    function handleStickStart(clientX, clientY) {
        stickActive = true;
        const rect = stickZone.getBoundingClientRect();
        stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        handleStickMove(clientX, clientY);
    }

    function handleStickMove(clientX, clientY) {
        if (!stickActive) return;
        const dx = clientX - stickCenter.x;
        const dy = clientY - stickCenter.y;
        const dist = Math.hypot(dx, dy);
        const clampedDist = Math.min(dist, maxStickRadius);
        const angle = Math.atan2(dy, dx);

        const knobX = Math.cos(angle) * clampedDist;
        const knobY = Math.sin(angle) * clampedDist;
        stickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

        // Map to 3D movement: dx -> X, dy -> Z
        playerInput.x = knobX / maxStickRadius;
        playerInput.z = knobY / maxStickRadius;
    }

    function handleStickEnd() {
        stickActive = false;
        stickKnob.style.transform = 'translate(0px, 0px)';
        // Reset only if keys are not held
        if (!keyState.left && !keyState.right) playerInput.x = 0;
        if (!keyState.up && !keyState.down) playerInput.z = 0;
    }

    stickZone.addEventListener('mousedown', e => handleStickStart(e.clientX, e.clientY));
    window.addEventListener('mousemove', e => handleStickMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', handleStickEnd);

    stickZone.addEventListener('touchstart', e => {
        if (e.touches.length > 0) handleStickStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchmove', e => {
        if (stickActive && e.touches.length > 0) handleStickMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchend', handleStickEnd);

    // Player Actions: Dash & Special Move
    function triggerPlayerDash() {
        if (statePhase !== 'battle') return;
        const dashed = t1.triggerDash(playerInput.x, playerInput.z);
        if (dashed) {
            audio.playClash(true);
            cameraRig.addTrauma(0.24);
            vfx.emitSonicBoom(t1.x, t1.y, t1.z, t1.vx, t1.vz, 0xff2d78);
            vfx.spawnImpactSparks(t1.x, t1.y + 0.5, t1.z, t1.vx, t1.vz, 16);
            showFloater('💥 DASH!', t1.x, t1.y + 1.2, t1.z, '#2de2ff', '1.15rem');
        }
    }

    function triggerSpecialMove(playerIdx = 0) {
        const top = playerIdx === 0 ? t1 : t2;
        if (top.specialGauge < 100 || top.status !== 'spinning') return;

        top.specialGauge = 0;
        top.specialActiveTimer = 3.2; // 3.2s Special State

        audio.playSpecialBurst();
        cameraRig.addTrauma(0.45);
        vfx.spawnSpecialAura(top.x, top.y + 0.5, top.z, top.core.color1);
        vfx.emitSonicBoom(top.x, top.y, top.z, top.vx, top.vz, playerIdx === 0 ? 0xff2d78 : 0x00f0ff);
        showFloater(`🔥 ${top.core.specialName}!!`, top.x, top.y + 1.5, top.z, top.core.color1, '1.4rem');

        // High burst forward dash
        const opp = playerIdx === 0 ? t2 : t1;
        const dx = opp.x - top.x;
        const dz = opp.z - top.z;
        const dist = Math.hypot(dx, dz) || 1;
        top.vx += (dx / dist) * 16.0;
        top.vz += (dz / dist) * 16.0;
    }

    dashBtn.addEventListener('click', triggerPlayerDash);
    specialBtn.addEventListener('click', () => triggerSpecialMove(0));

    // Keyboard Controls
    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyW' || e.code === 'ArrowUp') { keyState.up = true; playerInput.z = -1; }
        if (e.code === 'KeyS' || e.code === 'ArrowDown') { keyState.down = true; playerInput.z = 1; }
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') { keyState.left = true; playerInput.x = -1; }
        if (e.code === 'KeyD' || e.code === 'ArrowRight') { keyState.right = true; playerInput.x = 1; }

        if (e.code === 'Space' || e.code === 'KeyJ') {
            if (statePhase === 'launch_ready') {
                const isPerfect = meterProgress >= 0.78 && meterProgress <= 0.96;
                const power = 0.7 + meterProgress * 0.3;
                triggerPlayerLaunch(power, isPerfect);
            } else if (statePhase === 'battle') {
                triggerPlayerDash();
            }
        }

        if (e.code === 'KeyK') {
            if (statePhase === 'battle') triggerSpecialMove(0);
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'KeyW' || e.code === 'ArrowUp') keyState.up = false;
        if (e.code === 'KeyS' || e.code === 'ArrowDown') keyState.down = false;
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') keyState.left = false;
        if (e.code === 'KeyD' || e.code === 'ArrowRight') keyState.right = false;

        if (!stickActive) {
            playerInput.x = (keyState.right ? 1 : 0) - (keyState.left ? 1 : 0);
            playerInput.z = (keyState.down ? 1 : 0) - (keyState.up ? 1 : 0);
        }
    });

    // Round End Handler
    function handleRoundFinish(finishType, winnerIdx) {
        if (statePhase === 'round_finish' || statePhase === 'game_over') return;

        statePhase = 'round_finish';
        finishCooldown = 2.4;

        let points = 1;
        let title = 'SPIN FINISH!';
        if (finishType === 'burst') {
            points = 2;
            title = 'BURST FINISH!!';
            audio.playSpecialBurst();
            cameraRig.addTrauma(0.55);
        } else if (finishType === 'over') {
            points = 2;
            title = 'OVER FINISH!';
            audio.playClash(true);
            cameraRig.addTrauma(0.35);
        } else {
            audio.playLaunchBeep(true);
        }

        if (winnerIdx === 0) scores[0] += points;
        else if (winnerIdx === 1) scores[1] += points;

        finishTypeTitle.textContent = title;
        roundWinnerText.textContent = winnerIdx === 0
            ? `PLAYER 1 获得本回合胜利 (+${points}分)`
            : `BOT 获得本回合胜利 (+${points}分)`;
        roundScoreSummary.textContent = `${scores[0]} - ${scores[1]}`;

        setTimeout(() => {
            if (scores[0] >= 3 || scores[1] >= 3) {
                statePhase = 'game_over';
                gameoverTitle.textContent = scores[0] >= 3 ? 'VICTORY!' : 'DEFEAT';
                gameoverTitle.style.color = scores[0] >= 3 ? 'var(--neon-gold)' : 'var(--neon-pink)';
                gameoverScoreText.textContent = `最终比分: ${scores[0]} - ${scores[1]}`;
                gameoverModal.classList.remove('hidden');
            } else {
                roundModal.classList.remove('hidden');
            }
        }, 1200);
    }

    btnNextRound.addEventListener('click', () => {
        currentRound++;
        roundIndicatorEl.textContent = `ROUND ${currentRound}`;
        resetRound(false);
    });

    btnRematch.addEventListener('click', () => {
        scores = [0, 0];
        currentRound = 1;
        roundIndicatorEl.textContent = `ROUND 1`;
        gameoverModal.classList.add('hidden');
        resetRound(true);
    });

    // Update HUD Meters and Labels
    function updateHUD() {
        p1ScoreEl.textContent = scores[0];
        p2ScoreEl.textContent = scores[1];

        p1SpinText.textContent = `${Math.round(t1.spin)} RPM`;
        p2SpinText.textContent = `${Math.round(t2.spin)} RPM`;

        const b1Pct = Math.max(0, Math.min(100, (t1.burstHp / MAX_BURST_HP) * 100));
        const b2Pct = Math.max(0, Math.min(100, (t2.burstHp / MAX_BURST_HP) * 100));
        p1BurstFill.style.width = `${b1Pct}%`;
        p2BurstFill.style.width = `${b2Pct}%`;

        specialBtn.disabled = t1.specialGauge < 100;
        specialBtnText.textContent = t1.specialGauge >= 100
            ? `必杀: ${p1Core.specialName}`
            : `能量: ${Math.round(t1.specialGauge)}%`;
    }

    // Main 60Hz Fixed Simulation & Render Tick
    let lastTime = performance.now();

    function mainLoop(now) {
        requestAnimationFrame(mainLoop);

        const dtSec = Math.min(0.06, (now - lastTime) / 1000.0);
        lastTime = now;

        // 1. Oscillating Power Meter during Launch Ready
        if (statePhase === 'launch_ready') {
            meterProgress += meterDirection * meterSpeed * dtSec;
            if (meterProgress >= 1.0) { meterProgress = 1.0; meterDirection = -1; }
            else if (meterProgress <= 0.0) { meterProgress = 0.0; meterDirection = 1; }

            const frameWidth = 260 - 8;
            meterIndicator.style.left = `${meterProgress * frameWidth}px`;
        }

        // 2. Countdown Tick
        if (statePhase === 'countdown') {
            countdownTimer -= dtSec;
            if (countdownTimer > 1.4) countdownBox.textContent = '3';
            else if (countdownTimer > 0.7) countdownBox.textContent = '2';
            else if (countdownTimer > 0) countdownBox.textContent = '1';
            else {
                countdownBox.textContent = 'GO SHOOT!';
                audio.playLaunchBeep(true);
                statePhase = 'battle';
                setTimeout(() => { countdownBox.style.display = 'none'; }, 500);
            }
        }

        // 3. Battle Physics Simulation (60Hz Ticks)
        if (statePhase === 'battle') {
            // Apply Player Steering
            t1.applyInput(playerInput.x, playerInput.z, FIXED_DT);

            // Bot Brain
            botBrain.update(t2, t1, FIXED_DT);
            if (t2.specialGauge >= 100 && Math.hypot(t1.x - t2.x, t1.z - t2.z) < 14) {
                triggerSpecialMove(1);
            }

            // Physics Steps
            simulation.events = [];
            simulation.step(t1, FIXED_DT);
            simulation.step(t2, FIXED_DT);

            // Collisions
            const combatEvents = [];
            CollisionSystem3D.checkAndResolve(t1, t2, combatEvents);

            // Handle Clash Audio & VFX
            combatEvents.forEach(e => {
                if (e.type === 'clash') {
                    audio.playClash(e.isCritical);
                    vfx.spawnImpactSparks(e.x, e.y, e.z, e.nx, e.nz, e.isCritical ? 48 : 24);
                    scene.triggerClashFlash(e.x, e.y, e.z, e.isCritical ? 2.0 : 0.9);
                    cameraRig.addTrauma(e.isCritical ? 0.45 : 0.22);
                    showFloater(
                        e.isCritical ? '💥 CRITICAL!!' : '💥 CLASH!',
                        e.x, e.y + 1.2, e.z,
                        e.isCritical ? '#ff2d55' : '#ffd34d',
                        e.isCritical ? '1.4rem' : '1.1rem'
                    );
                } else if (e.type === 'burst') {
                    const bx = e.x != null ? e.x : 0;
                    const bz = e.z != null ? e.z : 0;
                    vfx.emitBurstShockwave(bx, 0.6, bz, '#ff2d55');
                    scene.triggerClashFlash(bx, 1.0, bz, 3.2);
                    showFloater('💥 BURST FINISH!!', bx, 2.0, bz, '#ff2d55', '1.6rem');
                    handleRoundFinish('burst', e.winner != null ? e.winner : (e.victim === 0 ? 1 : 0));
                }
            });

            // Handle Rail & Scrape Events
            simulation.events.forEach(e => {
                if (e.type === 'xdash') {
                    audio.playRailDash();
                    cameraRig.addTrauma(0.35);
                    vfx.emitSonicBoom(e.x, e.y, e.z, 0, 0, 0xffd34d);
                    vfx.spawnRailSparks(e.x, e.y, e.z);
                    scene.triggerClashFlash(e.x, e.y, e.z, 1.4);
                    showFloater('⚡ X-DASH!!', e.x, e.y + 1.4, e.z, '#ffd34d', '1.35rem');
                    xdashBanner.classList.add('active');
                    setTimeout(() => xdashBanner.classList.remove('active'), 1200);
                } else if (e.type === 'scrape') {
                    audio.playScrape();
                    vfx.emitScrapeSparks(e.x, e.y, e.z);
                } else if (e.type === 'wall_hit') {
                    audio.playClash(false);
                    scene.triggerClashFlash(e.x, e.y, e.z, 0.7);
                }
            });

            // Check Pocket Out (Over Finish)
            if (t1.status === 'over') {
                showFloater('🌀 OVER FINISH!', t1.x, t1.y + 1.2, t1.z, '#2de2ff', '1.5rem');
                handleRoundFinish('over', 1);
            } else if (t2.status === 'over') {
                showFloater('🌀 OVER FINISH!', t2.x, t2.y + 1.2, t2.z, '#2de2ff', '1.5rem');
                handleRoundFinish('over', 0);
            }

            // Check Spin Drain (Spin Finish)
            if (t1.status === 'sleep' && t2.status === 'sleep') {
                handleRoundFinish('spin', t1.spin > t2.spin ? 0 : 1);
            } else if (t1.status === 'sleep') {
                handleRoundFinish('spin', 1);
            } else if (t2.status === 'sleep') {
                handleRoundFinish('spin', 0);
            }
        }

        // 4. Update Meshes, Trails, Stadium Cyber-Props, Camera, VFX, and Audio
        t1Mesh.update(dtSec);
        t2Mesh.update(dtSec);
        trails.update([t1, t2], dtSec);
        stadium.update(t1, t2, dtSec);
        cameraRig.update(t1, t2, dtSec);
        scene.update(dtSec);
        vfx.update(dtSec);
        scene.render();
        updateHUD();

        // 5. Hum Sound Pitch
        const isHumming = statePhase === 'battle' || statePhase === 'countdown';
        audio.updateHum(t1.spin, isHumming && t1.status === 'spinning');
    }

    // Expose programmatic hooks for Automated E2E & Node Testing
    window.__spin3d = {
        get t1() { return t1; },
        get t2() { return t2; },
        launch: (power = 1.0, perfect = false) => triggerPlayerLaunch(power, perfect),
        skipCountdown: () => {
            countdownTimer = 0;
            statePhase = 'battle';
            countdownBox.style.display = 'none';
        },
        triggerSpecial: (playerIdx = 0) => triggerSpecialMove(playerIdx),
        forceBurst: (victimIdx = 1) => {
            if (victimIdx === 1) t2.triggerBurst();
            else t1.triggerBurst();
            handleRoundFinish('burst', victimIdx === 1 ? 0 : 1);
        },
        getState: () => ({
            phase: statePhase,
            scores: [...scores],
            p1: { x: t1.x, z: t1.z, spin: t1.spin, burstHp: t1.burstHp, status: t1.status },
            p2: { x: t2.x, z: t2.z, spin: t2.spin, burstHp: t2.burstHp, status: t2.status }
        })
    };

    // Initialize Setup
    p1CoreNameEl.textContent = p1Core.name;
    p2CoreNameEl.textContent = p2Core.name;
    resetRound(false);

    // Kick off animation loop
    requestAnimationFrame(mainLoop);
});
