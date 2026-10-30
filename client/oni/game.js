/**
 * Oni Combat - Main Orchestrator (game.js)
 * Bridges Input, Deterministic Simulation (60Hz Fixed Tick),
 * Three.js Viewport, Bot AI, and WebRTC Multiplayer Transport.
 */

import { Simulation } from './src/core/Simulation.js';
import { FIXED_DT } from './src/core/Constants.js';
import { CollisionSystem } from './src/core/CollisionSystem.js';
import { BotBrain } from './src/core/BotBrain.js';
import { CampaignManager, CAMPAIGN_CHAPTERS } from './src/core/CampaignManager.js';
import { ThreeScene } from './src/render/ThreeScene.js';
import { ProceduralFighterMesh } from './src/render/ProceduralFighterMesh.js';
import { VFXSystem } from './src/render/VFXSystem.js';
import { getLocale } from './i18n.js';

function init() {
    'use strict';

    const locale = getLocale();
    const qs = new URLSearchParams(location.search);
    let botMode = qs.get('bot') || (function() {
        try { return localStorage.getItem('oni_difficulty'); } catch(_) { return null; }
    })() || 'easy'; // Default to 'easy' (Recruit) so players can comfortably learn and enjoy fluid combat

    // DOM Elements
    const appEl = document.getElementById('app');
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
    const p1RpgBadge = document.getElementById('p1-rpg-badge');
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
    const btnStartCampaign = document.getElementById('btn-start-campaign');
    const btnStartTutorial = document.getElementById('btn-start-tutorial');
    const btnNextChapter = document.getElementById('btn-next-chapter');
    const btnBackMenu = document.getElementById('btn-back-menu');
    const btnMenu = document.getElementById('btn-menu');
    const chapterSelector = document.getElementById('chapter-selector');
    const rpgStripRank = document.getElementById('rpg-strip-rank');
    const rpgStripExp = document.getElementById('rpg-strip-exp');
    const rpgStripMoves = document.getElementById('rpg-strip-moves');
    const commsBanner = document.getElementById('comms-banner');
    const commsSpeaker = document.getElementById('comms-speaker');
    const commsFreqText = document.getElementById('comms-freq-text');
    const commsTitle = document.getElementById('comms-title');
    const commsProgress = document.getElementById('comms-progress');
    const commsText = document.getElementById('comms-text');
    const commsDiaryBox = document.getElementById('comms-diary-box');
    const commsDiaryTitle = document.getElementById('comms-diary-title');
    const commsDiaryText = document.getElementById('comms-diary-text');
    const btnToggleDossier = document.getElementById('btn-toggle-dossier');
    const campaignDossierDrawer = document.getElementById('campaign-dossier-drawer');
    const dossierItemsList = document.getElementById('dossier-items-list');
    const dossierCaret = document.getElementById('dossier-caret');
    const btnRematch = document.getElementById('btn-rematch');
    const winnerText = document.getElementById('winner-text');
    const fpsCounter = document.getElementById('fps-counter');
    const btnToggleMoves = document.getElementById('btn-toggle-moves');
    const moveListOverlay = document.getElementById('move-list-overlay');
    const btnCloseMoves = document.getElementById('btn-close-moves');
    const movesPanel = document.getElementById('moves-panel');
    const btnDifficulty = document.getElementById('btn-difficulty');
    const btnDifficultyText = document.getElementById('btn-difficulty-text');
    const difficultySelector = document.getElementById('difficulty-selector');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnFullscreenText = document.getElementById('btn-fullscreen-text');
    const joystickZone = document.getElementById('joystick-zone');
    const joystickBase = document.getElementById('joystick-base');
    const joystickStick = document.getElementById('joystick-stick');
    const cinematicOverlay = document.getElementById('cinematic-overlay');
    const cinematicSpeaker = document.getElementById('cinematic-speaker');
    const cinematicTitle = document.getElementById('cinematic-title');
    const cinematicText = document.getElementById('cinematic-text');

    // Web Audio Sound Synthesizer for Tactical Feedback (Alerts, Boss Chords)
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
            const AC = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AC();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playAlertSound() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            const now = ctx.currentTime;
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.setValueAtTime(1175, now + 0.08);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.26);
        } catch (_) {}
    }

    function playAlarmSiren() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            for (let i = 0; i < 3; i++) {
                osc.frequency.setValueAtTime(620, now + i * 0.3);
                osc.frequency.setValueAtTime(860, now + i * 0.3 + 0.15);
            }
            gain.gain.setValueAtTime(0.14, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.96);
        } catch (_) {}
    }

    function playOverrideChime() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.setValueAtTime(659.25, now + 0.08);
            osc.frequency.setValueAtTime(783.99, now + 0.16);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.36);
        } catch (_) {}
    }

    function playCommsChirp() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1480, now);
            osc.frequency.setValueAtTime(1760, now + 0.04);
            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.13);
        } catch (_) {}
    }

    // Systems
    const threeScene = new ThreeScene(container);
    const sim = new Simulation();
    const campaign = new CampaignManager(sim);
    sim.campaignManager = campaign;
    const meshP1 = new ProceduralFighterMesh(threeScene.scene, true);
    const meshP2 = new ProceduralFighterMesh(threeScene.scene, false, { archetype: (sim.f2 && sim.f2.archetype) || 'STRIKER' });
    const vfx = new VFXSystem(threeScene.scene);
    const botBrain = new BotBrain(botMode);
    const extraMeshes = new Map();
    const extraBrains = new Map();

    let selectedChapterId = 'ch1';
    function updateRpgModalStrip() {
        const spec = campaign.getLevelSpec(campaign.rpg.level);
        const nextSpec = campaign.getNextLevelSpec();
        if (rpgStripRank) {
            rpgStripRank.textContent = `🎖️ Lv.${campaign.rpg.level} ${spec.title}`;
        }
        if (rpgStripExp) {
            rpgStripExp.textContent = nextSpec
                ? `EXP: ${campaign.rpg.exp} / ${nextSpec.expRequired}`
                : `EXP: ${campaign.rpg.exp} (MAX)`;
        }
        if (rpgStripMoves) {
            rpgStripMoves.textContent = `已解锁: ${spec.unlockLabel}`;
        }
        if (p1RpgBadge) {
            p1RpgBadge.textContent = `Lv.${campaign.rpg.level}`;
        }
    }
    updateRpgModalStrip();

    const chapterCountBadge = document.getElementById('chapter-count-badge');
    const actTabs = document.getElementById('act-tabs');

    function selectChapterCard(chId) {
        selectedChapterId = chId;
        if (chapterSelector) {
            chapterSelector.querySelectorAll('.chapter-card').forEach((card) => {
                card.classList.toggle('active', card.getAttribute('data-chapter') === chId);
            });
        }
        const ch = CAMPAIGN_CHAPTERS.find((c) => c.id === chId);
        if (chapterCountBadge && ch) {
            chapterCountBadge.textContent = `${ch.code} ${ch.name}`;
        }
        if (btnStartCampaign && ch) {
            btnStartCampaign.textContent = ch.isTutorial
                ? `🎓 开始 ${ch.code} ${ch.name}`
                : `📖 开始战役闯关 (${ch.code} ${ch.name})`;
        }
    }
    // Chapter cards always show the data-driven chapter list (original Oni chapter order)
    if (chapterSelector) {
        chapterSelector.querySelectorAll('.chapter-card').forEach((card) => {
            const ch = CAMPAIGN_CHAPTERS.find((c) => c.id === card.getAttribute('data-chapter'));
            if (!ch || ch.isTutorial) return;
            const nameEl = card.querySelector('.ch-name');
            const subEl = card.querySelector('.ch-sub');
            const parts = String(ch.name).split('·').map((t) => t.trim());
            if (nameEl) nameEl.textContent = parts[1] || parts[0];
            if (subEl) subEl.textContent = parts[1] ? `「${parts[0]}」` : ch.subtitle;
        });
    }
    if (chapterSelector) {
        chapterSelector.addEventListener('click', (e) => {
            const card = e.target.closest('.chapter-card');
            if (!card) return;
            e.stopPropagation();
            const chId = card.getAttribute('data-chapter');
            selectChapterCard(chId);
        });
    }

    if (actTabs && chapterSelector) {
        actTabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.act-tab');
            if (!tab) return;
            actTabs.querySelectorAll('.act-tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            const targetAct = tab.getAttribute('data-act');
            const cards = chapterSelector.querySelectorAll('.chapter-card');
            cards.forEach((card) => {
                const cardAct = card.getAttribute('data-act');
                if (targetAct === 'all' || cardAct === targetAct) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    }

    function initDossierDrawer() {
        if (!btnToggleDossier || !campaignDossierDrawer || !dossierItemsList) return;
        btnToggleDossier.addEventListener('click', (e) => {
            e.stopPropagation();
            campaignDossierDrawer.classList.toggle('hidden');
            if (dossierCaret) {
                dossierCaret.textContent = campaignDossierDrawer.classList.contains('hidden') ? '▼' : '▲';
            }
        });

        dossierItemsList.innerHTML = '';
        CAMPAIGN_CHAPTERS.forEach((ch) => {
            const card = document.createElement('div');
            card.className = 'dossier-card';
            card.innerHTML = `
                <div class="dossier-card-head">
                    <strong>${ch.code} · ${ch.name}</strong>
                    <span>推荐 Lv.${ch.recommendedLv || 1}</span>
                </div>
                <p>${ch.briefing || ch.subtitle}</p>
            `;
            card.addEventListener('click', () => {
                selectChapterCard(ch.id);
                campaignDossierDrawer.classList.add('hidden');
                if (dossierCaret) dossierCaret.textContent = '▼';
            });
            dossierItemsList.appendChild(card);
        });
    }
    initDossierDrawer();

    // Move List Panel & Modal Overlay Event Handlers
    if (btnToggleMoves) {
        btnToggleMoves.addEventListener('click', (e) => {
            e.stopPropagation();
            if (movesPanel) movesPanel.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (movesPanel && movesPanel.classList.contains('open')) {
                if (!movesPanel.contains(e.target) && e.target !== btnToggleMoves && !btnToggleMoves.contains(e.target)) {
                    movesPanel.classList.remove('open');
                }
            }
        });
    }
    if (btnCloseMoves && moveListOverlay) {
        btnCloseMoves.addEventListener('click', () => {
            moveListOverlay.classList.add('hidden');
            if (movesPanel) movesPanel.classList.remove('open');
        });
        moveListOverlay.addEventListener('click', (e) => {
            if (e.target === moveListOverlay) {
                moveListOverlay.classList.add('hidden');
                if (movesPanel) movesPanel.classList.remove('open');
            }
        });
    }
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (moveListOverlay && !moveListOverlay.classList.contains('hidden')) {
                moveListOverlay.classList.add('hidden');
            }
            if (movesPanel) movesPanel.classList.remove('open');
        }
    });

    // Difficulty Selection & Live Switcher ('easy' -> 'normal' -> 'hard')
    const DIFF_LABELS = {
        easy: '难度: 新兵',
        normal: '难度: 精锐',
        hard: '难度: 鬼神'
    };
    const DIFF_ORDER = ['easy', 'normal', 'hard'];

    function setBotDifficulty(level) {
        if (!DIFF_LABELS[level]) level = 'easy';
        botMode = level;
        try { localStorage.setItem('oni_difficulty', botMode); } catch (_) {}
        botBrain.setLevel(botMode);
        extraBrains.clear();
        if (sim) {
            sim.setDifficulty(botMode);
        }
        if (btnDifficultyText) {
            btnDifficultyText.textContent = DIFF_LABELS[botMode];
        }
        if (difficultySelector) {
            const btns = difficultySelector.querySelectorAll('.diff-btn');
            btns.forEach((b) => {
                b.classList.toggle('active', b.getAttribute('data-diff') === botMode);
            });
        }
    }
    setBotDifficulty(botMode);

    // Enemy AI tier = the enemy's authored level clamped by the PLAYER-chosen difficulty.
    // Never writes back to botMode / the saved difficulty.
    function applyEnemyTier(cfgLevel, isBoss = false) {
        botBrain.setLevel(BotBrain.resolveTier(cfgLevel || 'normal', botMode, !!isBoss));
    }

    if (difficultySelector) {
        difficultySelector.addEventListener('click', (e) => {
            const btn = e.target.closest('.diff-btn');
            if (!btn) return;
            e.stopPropagation();
            setBotDifficulty(btn.getAttribute('data-diff'));
            showActionNotice(`${DIFF_LABELS[botMode]}!`);
        });
    }
    if (btnDifficulty) {
        btnDifficulty.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextIdx = (DIFF_ORDER.indexOf(botMode) + 1) % DIFF_ORDER.length;
            setBotDifficulty(DIFF_ORDER[nextIdx]);
            showActionNotice(`${DIFF_LABELS[botMode]}!`);
        });
    }

    // Fullscreen Switcher (Multi-tier: Native Fullscreen API -> Webkit/DocumentElement -> Parent Top Frame -> Pseudo Fullscreen Viewport Lock)
    function isFullscreenActive() {
        return !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement ||
            document.body.classList.contains('pseudo-fullscreen')
        );
    }

    function updateFullscreenButton() {
        const isFs = isFullscreenActive();
        if (btnFullscreenText) {
            btnFullscreenText.textContent = isFs ? '退出全屏' : '全屏';
        }
        setTimeout(() => threeScene.onResize(), 40);
        setTimeout(() => threeScene.onResize(), 200);
    }

    async function toggleFullscreen() {
        const nativeFsEl =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement;
        const isPseudo = document.body.classList.contains('pseudo-fullscreen');

        if (nativeFsEl || isPseudo) {
            document.body.classList.remove('pseudo-fullscreen');
            try {
                if (document.exitFullscreen && nativeFsEl) {
                    await document.exitFullscreen();
                } else if (document.webkitExitFullscreen && nativeFsEl) {
                    document.webkitExitFullscreen();
                }
            } catch (_) {
                // ignore
            }
            updateFullscreenButton();
            return;
        }

        // Attempt native Fullscreen on documentElement first, then appEl, then parent document (if same-origin iframe)
        let enteredNative = false;
        const targets = [document.documentElement, appEl];
        try {
            if (window.parent && window.parent !== window && window.parent.document && window.parent.document.documentElement) {
                targets.push(window.parent.document.documentElement);
            }
        } catch (_) {
            // cross-origin parent frame, ignore
        }

        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            if (!t) continue;
            const req = t.requestFullscreen || t.webkitRequestFullscreen || t.mozRequestFullScreen || t.msRequestFullscreen;
            if (req) {
                try {
                    const p = req.call(t, { navigationUI: 'hide' });
                    if (p && typeof p.then === 'function') {
                        await p;
                    }
                    enteredNative = !!(document.fullscreenElement || document.webkitFullscreenElement);
                    if (enteredNative) break;
                } catch (_) {
                    // try next target or fallback
                }
            }
        }

        // Always activate pseudo-fullscreen fallback when native Fullscreen API is unavailable or blocked (e.g. iOS Safari / iframe without allowfullscreen)
        if (!enteredNative) {
            document.body.classList.add('pseudo-fullscreen');
            window.scrollTo(0, 1);
        }

        // Attempt landscape orientation lock on mobile if supported
        try {
            if (screen.orientation && typeof screen.orientation.lock === 'function') {
                screen.orientation.lock('landscape').catch(() => {});
            }
        } catch (_) {}

        updateFullscreenButton();
    }
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFullscreen();
        });
    }
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => threeScene.onResize());
    }

    // Keyboard & Input State
    const keysDown = {};
    window.addEventListener('keydown', (e) => {
        if (trySkipCinematic()) {
            e.preventDefault();
            return;
        }
        keysDown[e.code] = true;
        const camKeys = { Digit1: 'side', Digit2: 'diagonal', Digit3: 'shoulder', Digit4: 'top' };
        if (camKeys[e.code]) setCam(threeScene.setCameraMode(camKeys[e.code]));
        if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') {
            e.preventDefault();
            threeScene.adjustZoom(0.92);
        } else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_') {
            e.preventDefault();
            threeScene.adjustZoom(1.08);
        } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
            threeScene.resetOrbit();
        }
        if (e.code === 'F11') {
            e.preventDefault();
            toggleFullscreen();
        }
        if (!isPlaying && (e.code === 'Space' || e.code === 'Enter')) {
            startFight();
        }
    });
    window.addEventListener('keyup', (e) => {
        keysDown[e.code] = false;
    });

    // ---- Oni 2001 PC controls: mouse turns Konoko (camera locked behind her), LMB punch, RMB kick.
    // Click the game view to capture the mouse; Esc releases it. Toggle with the M key.
    const oniCtrl = {
        enabled: localStorage.getItem('oni_ctrl') !== '0' &&
            !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches),
        locked: false,
        pendingDX: 0,
        sens: Number(localStorage.getItem('oni_mouse_sens')) || 0.0026
    };
    const lockTarget = threeScene.renderer.domElement;
    function oniAimAllowed() {
        return oniCtrl.enabled && isPlaying && !(isMultiplayer && myRole === 'client');
    }
    lockTarget.addEventListener('click', () => {
        if (oniAimAllowed() && !oniCtrl.locked && lockTarget.requestPointerLock) {
            try { lockTarget.requestPointerLock(); } catch (_) { /* unsupported */ }
        }
    });
    document.addEventListener('pointerlockchange', () => {
        oniCtrl.locked = document.pointerLockElement === lockTarget;
        oniCtrl.pendingDX = 0;
        threeScene.setAimFollow(oniCtrl.locked);
        keysDown.Mouse0 = false;
        keysDown.Mouse2 = false;
        if (oniCtrl.locked) showActionNotice('原作操控：鼠标转向 · 左键拳 · 右键踢 · Esc 释放鼠标');
    });
    document.addEventListener('mousemove', (e) => {
        if (!oniCtrl.locked) return;
        oniCtrl.pendingDX += e.movementX || 0;
        threeScene.adjustAimPitch((e.movementY || 0) * 0.0022);
    });
    document.addEventListener('mousedown', (e) => {
        if (!oniCtrl.locked) return;
        if (e.button === 0) keysDown.Mouse0 = true;
        if (e.button === 2) keysDown.Mouse2 = true;
    });
    document.addEventListener('mouseup', (e) => {
        if (e.button === 0) keysDown.Mouse0 = false;
        if (e.button === 2) keysDown.Mouse2 = false;
    });
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyM' || e.repeat) return;
        oniCtrl.enabled = !oniCtrl.enabled;
        localStorage.setItem('oni_ctrl', oniCtrl.enabled ? '1' : '0');
        if (!oniCtrl.enabled && oniCtrl.locked && document.exitPointerLock) document.exitPointerLock();
        showActionNotice(oniCtrl.enabled ? '原作操控：开（点击画面锁定鼠标）' : '原作操控：关（自动朝向敌人）');
    });

    // Zoom Toast HUD
    let zoomToastTimer = null;
    let zoomToastEl = document.getElementById('zoom-toast');
    if (!zoomToastEl) {
        zoomToastEl = document.createElement('div');
        zoomToastEl.id = 'zoom-toast';
        zoomToastEl.className = 'zoom-toast';
        document.body.appendChild(zoomToastEl);
    }
    threeScene.onZoomChange = (pct) => {
        if (!zoomToastEl) return;
        zoomToastEl.textContent = `🔍 视距: ${pct}%`;
        zoomToastEl.classList.add('visible');
        clearTimeout(zoomToastTimer);
        zoomToastTimer = setTimeout(() => {
            zoomToastEl.classList.remove('visible');
        }, 1100);
    };

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

    // Touch & On-Screen Dynamic Floating Joystick + Oni 4-Core Context-Sensitive Cluster
    const touchState = {
        punch: false,
        kick: false,
        block: false,
        slide: false,
        jump: false,
        crouch: false,
        throwBtn: false,
        fire: false,
        daodan: false,
        heal: false,
        evade: false,
        special: false
    };
    const touchHoldFrames = {
        punch: 0,
        kick: 0
    };
    const swipePulseFrames = {
        special: 0,
        slide: 0
    };
    const lblPunch = document.getElementById('lbl-punch');
    const lblKick = document.getElementById('lbl-kick');
    const lblEvade = document.getElementById('lbl-evade');
    const btnFireEl = document.getElementById('btn-fire');
    const lblFire = document.getElementById('lbl-fire');

    const setupTouchBtn = (id, key, opts = {}) => {
        const el = document.getElementById(id);
        if (!el) return;
        let startX = 0;
        let startY = 0;
        let swiped = false;

        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX || 0;
            startY = e.clientY || 0;
            swiped = false;
            touchState[key] = true;
            if (key in touchHoldFrames) touchHoldFrames[key] = 0;
            el.classList.add('active');
        });

        if (opts.swipeUpSpecial || opts.swipeForwardSlide) {
            el.addEventListener('pointermove', (e) => {
                if (!touchState[key] || swiped) return;
                const dy = (e.clientY || 0) - startY;
                const dx = (e.clientX || 0) - startX;
                if (opts.swipeUpSpecial && dy < -24) {
                    swiped = true;
                    swipePulseFrames.special = 6;
                } else if (opts.swipeForwardSlide && Math.hypot(dx, dy) > 24 && dy > -10) {
                    swiped = true;
                    swipePulseFrames.slide = 6;
                }
            });
        }

        const release = () => {
            touchState[key] = false;
            if (key in touchHoldFrames) touchHoldFrames[key] = 0;
            el.classList.remove('active');
        };
        el.addEventListener('pointerup', release);
        el.addEventListener('pointercancel', release);
        el.addEventListener('pointerleave', release);
    };
    setupTouchBtn('btn-punch', 'punch', { swipeUpSpecial: true });
    setupTouchBtn('btn-kick', 'kick', { swipeUpSpecial: true });
    setupTouchBtn('btn-jump', 'jump', { swipeUpSpecial: true });
    setupTouchBtn('btn-evade', 'evade', { swipeForwardSlide: true });
    setupTouchBtn('btn-slide', 'slide');
    setupTouchBtn('btn-block', 'block');
    setupTouchBtn('btn-special', 'special');
    setupTouchBtn('btn-throw', 'throwBtn');
    setupTouchBtn('btn-fire', 'fire');
    setupTouchBtn('p1-hypo-badge', 'heal');
    if (p1DaodanFill && p1DaodanFill.parentElement) {
        p1DaodanFill.parentElement.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            touchState.daodan = true;
        });
        window.addEventListener('pointerup', () => { touchState.daodan = false; });
    }

    // Dynamic Floating Virtual Joystick logic (anchors center wherever thumb touches inside left zone)
    let touchDirX = 0;
    let touchDirZ = 0;
    let isJoystickDragging = false;
    let joyOriginX = 0;
    let joyOriginY = 0;
    let lastTapTime = 0;

    if (joystickZone && joystickBase && joystickStick) {
        const maxRadius = 42;

        const onJoyStart = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isJoystickDragging = true;
            const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

            // Dynamically anchor the floating joystick base at the thumb's touch point within joystickZone
            const zoneRect = joystickZone.getBoundingClientRect();
            const halfBase = 56;
            const localX = Math.max(halfBase, Math.min(zoneRect.width - halfBase, clientX - zoneRect.left));
            const localY = Math.max(halfBase, Math.min(zoneRect.height - halfBase, clientY - zoneRect.top));
            joyOriginX = zoneRect.left + localX;
            joyOriginY = zoneRect.top + localY;

            const defaultX = halfBase + 18;
            const defaultY = zoneRect.height - halfBase - 18;
            joystickBase.style.transform = `translate(${localX - defaultX}px, ${localY - defaultY}px)`;

            onJoyMove(e);

            // Double tap dash detection
            const now = performance.now();
            if (now - lastTapTime < 280) {
                sim.f1.dashTimer = 25;
            }
            lastTapTime = now;
        };

        const onJoyMove = (e) => {
            if (!isJoystickDragging) return;
            const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
            const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

            let dx = clientX - joyOriginX;
            let dy = clientY - joyOriginY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > maxRadius) {
                dx = (dx / dist) * maxRadius;
                dy = (dy / dist) * maxRadius;
            }

            joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;

            // Deadzone of 5px
            if (dist > 5) {
                touchDirX = dx / maxRadius;
                touchDirZ = dy / maxRadius;
                // Push virtual stick past 78% rim to smoothly enter Oni tactical run/sprint
                if (dist > maxRadius * 0.78) {
                    sim.f1.dashTimer = Math.max(sim.f1.dashTimer, 8);
                    joystickBase.classList.add('sprinting');
                } else {
                    joystickBase.classList.remove('sprinting');
                }
            } else {
                touchDirX = 0;
                touchDirZ = 0;
                joystickBase.classList.remove('sprinting');
            }
        };

        const onJoyEnd = () => {
            if (!isJoystickDragging) return;
            isJoystickDragging = false;
            touchDirX = 0;
            touchDirZ = 0;
            joystickStick.style.transform = 'translate(0px, 0px)';
            joystickBase.style.transform = 'translate(0px, 0px)';
            joystickBase.classList.remove('sprinting');
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

        // Combine touch virtual joystick (preserve continuous 360-degree analog vector so 3D movement is silky smooth)
        if (Math.hypot(touchDirX, touchDirZ) > 0.12) {
            dirX += touchDirX;
            dirZ += touchDirZ;
        }
        const rawMag = Math.hypot(dirX, dirZ);
        if (rawMag > 1.0) {
            dirX /= rawMag;
            dirZ /= rawMag;
        } else if (rawMag < 0.08) {
            dirX = 0;
            dirZ = 0;
        }
        const down = dirZ > 0.4; // screen-space "down" for motion commands (uppercut)

        let aimYaw = null;
        if (oniCtrl.locked && oniAimAllowed()) {
            // Oni mouse-look: W/S along Konoko's facing, A/D strafe; the mouse turns her
            const a = sim.f1.facingAngle + oniCtrl.pendingDX * oniCtrl.sens;
            oniCtrl.pendingDX = 0;
            aimYaw = Math.atan2(Math.sin(a), Math.cos(a));
            const fx = Math.cos(aimYaw), fz = Math.sin(aimYaw);
            const wx = fx * -dirZ + -fz * dirX;
            const wz = fz * -dirZ + fx * dirX;
            dirX = Math.max(-1, Math.min(1, wx));
            dirZ = Math.max(-1, Math.min(1, wz));
        } else {
            // screen-relative stick -> world axes, following the current camera yaw
            const yaw = threeScene.getInputYaw();
            const c = Math.cos(yaw), sn = Math.sin(yaw);
            const wx = c * dirX + sn * dirZ;
            const wz = -sn * dirX + c * dirZ;
            dirX = Math.max(-1, Math.min(1, wx));
            dirZ = Math.max(-1, Math.min(1, wz));
        }

        // Hold-to-Combo rhythmic pulse for mobile touch (holding 👊 or 🦵 smoothly chains 3-hit combos without mashing)
        let touchPunchActive = false;
        if (touchState.punch) {
            touchHoldFrames.punch++;
            touchPunchActive = (touchHoldFrames.punch === 1) || (touchHoldFrames.punch > 6 && touchHoldFrames.punch % 6 < 2);
        }
        let touchKickActive = false;
        if (touchState.kick) {
            touchHoldFrames.kick++;
            touchKickActive = (touchHoldFrames.kick === 1) || (touchHoldFrames.kick > 7 && touchHoldFrames.kick % 7 < 2);
        }

        let swipeSpecial = false;
        if (swipePulseFrames.special > 0) {
            swipePulseFrames.special--;
            swipeSpecial = true;
        }
        let swipeSlide = false;
        if (swipePulseFrames.slide > 0) {
            swipePulseFrames.slide--;
            swipeSlide = true;
        }

        const punch = !!(keysDown['KeyJ'] || keysDown['KeyZ'] || keysDown.Mouse0 || touchPunchActive);
        const kick = !!(keysDown['KeyK'] || keysDown['KeyX'] || keysDown.Mouse2 || touchKickActive);
        const block = !!(keysDown['KeyL'] || keysDown['KeyC'] || touchState.block);
        const jump = !!(keysDown['Space'] || touchState.jump);
        const crouch = !!(keysDown['ShiftLeft'] || keysDown['ShiftRight'] || keysDown['ControlLeft'] || touchState.crouch);
        const walk = !!(keysDown['CapsLock'] || keysDown['AltLeft']);
        const slide = !!(keysDown['KeyI'] || keysDown['KeyV'] || touchState.slide || swipeSlide);
        const throwBtn = !!(keysDown['KeyU'] || keysDown['KeyG'] || touchState.throwBtn || (punch && kick));
        const fire = !!(keysDown['KeyF'] || touchState.fire);
        const heal = !!(keysDown['KeyH'] || touchState.heal);
        const daodan = !!(keysDown['KeyQ'] || keysDown['KeyE'] || touchState.daodan);
        const evade = !!(keysDown['KeyR'] || touchState.evade);
        const special = !!(keysDown['KeyO'] || touchState.special || swipeSpecial);

        return { dirX, dirZ, down, punch, kick, block, jump, crouch, slide, throwBtn, fire, heal, daodan, evade, special, aimYaw, walk };
    }

    // Match State
    let isPlaying = false;
    let isMultiplayer = false;
    let peerConnected = false;
    let myRole = 'host'; // 'host' or 'client'
    let session = null;
    const modeStatusText = document.getElementById('mode-status-text');
    const opponentName = qs.get('opponent') || '';

    function updateLobbyModeUI() {
        if (peerConnected) {
            isMultiplayer = true;
            if (modeStatusText) {
                modeStatusText.textContent = opponentName ? `👥 对战: ${opponentName}` : '👥 真人对战模式';
            }
            if (difficultySelector) difficultySelector.style.display = 'none';
            if (btnStartSurvival) btnStartSurvival.style.display = 'none';
            if (btnStart) {
                btnStart.textContent = myRole === 'host'
                    ? (opponentName ? `开始对战 (VS ${opponentName})` : '开始真人对战 (1v1 PVP)')
                    : '等待房主开始对决...';
                btnStart.disabled = myRole !== 'host';
            }
        } else {
            isMultiplayer = false;
            if (modeStatusText) {
                modeStatusText.textContent = '🤖 人机战模式';
            }
            if (difficultySelector) difficultySelector.style.display = '';
            if (btnStartSurvival) btnStartSurvival.style.display = '';
            if (btnStart) {
                btnStart.textContent = '开始对决 (1v1 VS BOT)';
                btnStart.disabled = false;
            }
        }
    }

    // Expose for E2E testing & GameBot integration
    window.__oni = {
        sim,
        campaign,
        threeScene,
        botBrain,
        startFight,
        startCampaignChapter,
        startTutorialDojo,
        setBotDifficulty,
        toggleFullscreen,
        isFullscreenActive,
        getState: () => ({
            isPlaying,
            isMultiplayer,
            peerConnected,
            myRole,
            gameMode: campaign.mode,
            activeChapterId: campaign.activeChapterId,
            zoneIndex: campaign.zoneIndex,
            rpgLevel: campaign.rpg.level,
            rpgExp: campaign.rpg.exp,
            stageType: CollisionSystem.stageType,
            stageMode: threeScene.stageMode,
            botDifficulty: botMode,
            isFullscreen: isFullscreenActive(),
            p1: { hp: sim.f1.hp, maxHp: sim.f1.maxHp, state: sim.f1.state, x: sim.f1.x, y: sim.f1.y, z: sim.f1.z, combo: sim.f1.comboCount },
            p2: { hp: sim.f2.hp, maxHp: sim.f2.maxHp, state: sim.f2.state, x: sim.f2.x, y: sim.f2.y, z: sim.f2.z, combo: sim.f2.comboCount },
            roundTimer: sim.roundTimer,
            isMatchOver: sim.isMatchOver,
            winner: sim.winner
        })
    };

    let remoteInput = { dirX: 0, dirZ: 0, punch: false, kick: false, block: false };
    let nextChapterTargetId = null;

    function clearTutorialHighlights() {
        document.querySelectorAll('.tutorial-highlight').forEach((el) => el.classList.remove('tutorial-highlight'));
    }

    let lastCommsText = '';
    function syncCommsBannerUI() {
        const cs = campaign.commsState;
        if (!commsBanner) return;
        if (!cs || !cs.visible || !isPlaying) {
            commsBanner.classList.add('hidden');
            clearTutorialHighlights();
            return;
        }
        commsBanner.classList.remove('hidden');
        if (commsSpeaker) commsSpeaker.textContent = cs.speaker || 'SHINATAMA';
        if (commsFreqText) {
            commsFreqText.textContent = `FREQ: ${cs.frequency || '140.85 MHz'} // ${cs.channel || 'TCTF NEURAL-LINK'}`;
        }
        if (commsTitle) commsTitle.textContent = cs.title || '';
        if (commsProgress) commsProgress.textContent = cs.progressText || '';
        if (commsText) {
            if (cs.text && cs.text !== lastCommsText) {
                lastCommsText = cs.text;
                playCommsChirp();
            }
            commsText.textContent = cs.text || '';
        }

        if (commsDiaryBox) {
            if (cs.diary) {
                commsDiaryBox.classList.remove('hidden');
                if (commsDiaryTitle) commsDiaryTitle.textContent = `【${cs.diary.author || 'TCTF INTEL'}】${cs.diary.title}`;
                if (commsDiaryText) commsDiaryText.textContent = cs.diary.text;
            } else {
                commsDiaryBox.classList.add('hidden');
            }
        }

        clearTutorialHighlights();
        if (cs.highlightBtn) {
            const targetBtn = document.getElementById(cs.highlightBtn);
            if (targetBtn) targetBtn.classList.add('tutorial-highlight');
        }
    }

    function syncCinematicUI() {
        if (!cinematicOverlay) return;
        const c = campaign ? campaign.cinematic : null;
        if (!c || !c.active || !isPlaying) {
            cinematicOverlay.classList.add('hidden');
            return;
        }
        cinematicOverlay.classList.remove('hidden');
        if (cinematicSpeaker) cinematicSpeaker.textContent = c.bossName || 'BOSS';
        if (cinematicTitle) cinematicTitle.textContent = c.bossTitle || '';
        if (cinematicText) cinematicText.textContent = c.typedText || '';
    }

    function trySkipCinematic() {
        if (campaign && campaign.cinematic && campaign.cinematic.active) {
            campaign.skipBossCinematic();
            syncCinematicUI();
            return true;
        }
        return false;
    }

    if (cinematicOverlay) {
        cinematicOverlay.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            trySkipCinematic();
        });
    }

    function startTutorialDojo() {
        startOverlay.classList.add('hidden');
        gameoverOverlay.classList.add('hidden');
        if (btnNextChapter) btnNextChapter.classList.add('hidden');
        koBanner.style.display = 'none';
        isMultiplayer = false;
        if (sim) sim.setDifficulty('easy');
        campaign.startTutorial();
        threeScene.setStageMode('INDOOR_DOJO');
        botBrain.setLevel('easy');
        isPlaying = true;
        document.body.classList.add('in-fight');
        if (modeStatusText) modeStatusText.textContent = '🎓 TCTF 训练营';
        updateRpgModalStrip();
        syncCommsBannerUI();
    }

    function startCampaignChapter(chapterId = selectedChapterId) {
        if (chapterId === 'ch0') {
            startTutorialDojo();
            return;
        }
        startOverlay.classList.add('hidden');
        gameoverOverlay.classList.add('hidden');
        if (moveListOverlay) moveListOverlay.classList.add('hidden');
        if (btnNextChapter) btnNextChapter.classList.add('hidden');
        koBanner.style.display = 'none';
        isMultiplayer = false;
        setBotDifficulty(botMode); // spawn the chapter with the player's chosen difficulty
        campaign.startChapter(chapterId);
        // each chapter has its own map (LevelLayouts) rendered from the physics obstacle list
        threeScene.buildCampaignLevel(campaign.activeLevel);
        threeScene.setStageMode(campaign.activeLevel ? 'CAMPAIGN_LEVEL' : 'WAREHOUSE');
        applyEnemyTier(sim.f2.aiProfileLevel, sim.f2.isBoss);
        isPlaying = true;
        document.body.classList.add('in-fight');
        if (modeStatusText) modeStatusText.textContent = `📖 战役: ${chapterId.toUpperCase()}`;
        updateRpgModalStrip();
        syncCommsBannerUI();
    }

    function startFight(survival = false, forceP2P = null) {
        startOverlay.classList.add('hidden');
        gameoverOverlay.classList.add('hidden');
        if (btnNextChapter) btnNextChapter.classList.add('hidden');
        koBanner.style.display = 'none';
        const useP2P = forceP2P !== null ? forceP2P : (!survival && peerConnected);
        isMultiplayer = useP2P;
        campaign.disableCampaign();
        threeScene.setStageMode('ROOFTOP');
        campaign.mode = survival ? 'SURVIVAL' : 'VERSUS';
        sim.survivalMode = !useP2P && !!survival;
        sim.reset();
        if (useP2P) {
            sim.f1.name = myRole === 'host' ? (localStorage.getItem('custom-nickname') || 'KONOKO') : (opponentName || 'HOST');
            sim.f2.name = myRole === 'host' ? (opponentName || 'RIVAL') : (localStorage.getItem('custom-nickname') || 'SYNDI');
            if (myRole === 'host' && session) {
                session.send({ type: 'start', p1Name: sim.f1.name, p2Name: sim.f2.name });
            }
        } else if (survival) {
            sim.setDifficulty(botMode);
            sim.enableSurvivalMode(true);
            applyEnemyTier(sim.f2.aiProfileLevel, false);
            if (modeStatusText) modeStatusText.textContent = '🔥 街机生存模式';
        } else {
            setBotDifficulty(botMode);
            if (modeStatusText) modeStatusText.textContent = '⚔️ 1v1 竞技对决';
        }
        isPlaying = true;
        document.body.classList.add('in-fight');
        syncCommsBannerUI();
    }

    // Optional WebRTC integration with Link platform
    // CRITICAL: GameBot.session() returns a LocalSession when `?bot=easy|normal|hard` is in the URL,
    // which immediately fires `onChannelOpen()`. We must only enable `isMultiplayer` when it is a
    // real P2P human session (!GameBot.enabled), otherwise the local BotBrain gets bypassed!
    if (window.GameBot && typeof window.GameBot.session === 'function') {
        const isBotUrlMode = !!window.GameBot.enabled;
        session = window.GameBot.session({
            gameFolder: 'oni',
            onRole: (role) => {
                myRole = role;
                updateLobbyModeUI();
            },
            onChannelOpen: () => {
                if (!isBotUrlMode) {
                    peerConnected = true;
                    updateLobbyModeUI();
                }
            },
            onPeerDisconnected: () => {
                peerConnected = false;
                updateLobbyModeUI();
            },
            onMessage: (msg) => {
                if (!msg || typeof msg !== 'object') return;
                if (msg.type === 'input' && myRole === 'host' && msg.input) {
                    remoteInput = msg.input;
                } else if (msg.type === 'start' && myRole === 'client') {
                    startFight(false, true);
                    if (msg.p1Name) sim.f1.name = msg.p1Name;
                    if (msg.p2Name) sim.f2.name = msg.p2Name;
                } else if (msg.type === 'state' && myRole === 'client' && msg.snap) {
                    if (!isPlaying) startFight(false, true);
                    sim.applySnapshot(msg.snap);
                    if (Array.isArray(msg.events) && msg.events.length > 0) {
                        processSimEvents(msg.events);
                    }
                } else if (msg.type === 'rematch' && myRole === 'host') {
                    startFight(false, true);
                }
            }
        });
    }

    btnStart.addEventListener('click', () => {
        if (peerConnected && myRole !== 'host') return;
        startFight(false);
    });
    if (btnStartSurvival) {
        btnStartSurvival.addEventListener('click', () => startFight(true, false));
    }
    if (btnStartCampaign) {
        btnStartCampaign.addEventListener('click', () => startCampaignChapter(selectedChapterId));
    }
    if (btnStartTutorial) {
        btnStartTutorial.addEventListener('click', () => startTutorialDojo());
    }
    if (btnNextChapter) {
        btnNextChapter.addEventListener('click', () => {
            if (nextChapterTargetId) {
                selectChapterCard(nextChapterTargetId);
                startCampaignChapter(nextChapterTargetId);
            }
        });
    }
    function openModeMenu() {
        isPlaying = false;
        updateRpgModalStrip();
        gameoverOverlay.classList.add('hidden');
        startOverlay.classList.remove('hidden');
        clearTutorialHighlights();
    }
    if (btnBackMenu) {
        btnBackMenu.addEventListener('click', openModeMenu);
    }
    if (btnMenu) {
        btnMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            openModeMenu();
        });
    }
    btnRematch.addEventListener('click', () => {
        if (isMultiplayer && myRole === 'client' && session) {
            session.send({ type: 'rematch' });
            gameoverOverlay.classList.add('hidden');
            return;
        }
        if (campaign.mode === 'TUTORIAL') {
            startTutorialDojo();
        } else if (campaign.mode === 'CAMPAIGN') {
            startCampaignChapter(campaign.activeChapterId);
        } else {
            startFight(sim.survivalMode);
        }
    });

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
            } else if (ev.type === 'DAODAN_OVERPOWER') {
                vfx.spawnShockwave(ev.x, 0.95, ev.z, 0xfacc15);
                vfx.spawnShockwave(ev.x, 0.1, ev.z, 0xd946ef);
                threeScene.addTrauma(0.65);
                threeScene.hitFlash(0.35);
                showActionNotice('💥 DAODAN OVERPOWER! 满血超载霸体! (+50 护盾 & 1.5x 攻击)');
                playOverrideChime();
            } else if (ev.type === 'OVERPOWER_SHIELD_ABSORB') {
                vfx.spawnHitSpark(ev.x, ev.y, ev.z, true, 14);
                showActionNotice(`🛡️ OVERPOWER SHIELD! [${ev.shieldLeft} 护盾剩余]`);
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
                applyEnemyTier(ev.level, false);
                vfx.spawnShockwave(ev.x, 0.15, ev.z, 0xff0077);
                showActionNotice(`WAVE ${ev.wave}: ${ev.enemyName}!`);
            } else if (ev.type === 'COLLATERAL_SPLASH') {
                vfx.spawnShockwave(ev.x, 0.2, ev.z, 0xffaa00);
                threeScene.addTrauma(0.42);
                showActionNotice('BODY BOWLING! 摔投范围波及!');
            } else if (ev.type === 'ENEMY_ALERT') {
                showActionNotice(`⚠️ 警报: ${ev.name} 已察觉!`);
                vfx.spawnShockwave(ev.x, 0.5, ev.z, 0xff0055);
                playAlertSound();
            } else if (ev.type === 'ALARM_TRIGGERED') {
                threeScene.setAlarmState(true);
                threeScene.addTrauma(0.5);
                playAlarmSiren();
                showActionNotice('🚨 警报大作！哨兵拍响警报呼叫武装增援!');
                syncCommsBannerUI();
            } else if (ev.type === 'ALARM_DISABLED') {
                threeScene.setAlarmState(false);
                playOverrideChime();
                showActionNotice('✅ 警报切断！武装增援停止入场 (+40 EXP)!');
                syncCommsBannerUI();
            } else if (ev.type === 'ALARM_AVERTED') {
                threeScene.setAlarmState(false);
                vfx.spawnShockwave(sim.f1.x, 0.4, sim.f1.z, 0x00ff88);
                threeScene.addTrauma(0.35);
                showActionNotice('🎯 战术拦截！成功在哨兵触碰控制台前将其制伏 (+60 EXP)!');
                syncCommsBannerUI();
            } else if (ev.type === 'STEALTH_CRIT') {
                vfx.spawnShockwave(sim.f1.x, 0.5, sim.f1.z, 0xffaa00);
                threeScene.addTrauma(0.45);
                showActionNotice(ev.text || 'STEALTH TAKEDOWN!');
            } else if (ev.type === 'BOSS_CINEMATIC_START') {
                syncCinematicUI();
            } else if (ev.type === 'BOSS_ENGAGE') {
                threeScene.addTrauma(0.6);
                threeScene.hitFlash(0.25);
                showActionNotice(`ENGAGE BOSS: ${ev.bossName}!`);
                syncCinematicUI();
            } else if (ev.type === 'OBSTACLE_IMPACT') {
                vfx.spawnHitSpark(ev.x, ev.y, ev.z, true, 8);
            } else if (ev.type === 'TUTORIAL_STEP_CLEAR') {
                vfx.spawnShockwave(sim.f1.x, 0.2, sim.f1.z, 0x00ff88);
                showActionNotice(`STAGE ${ev.step} UNLOCKED! 下一项训练!`);
                syncCommsBannerUI();
            } else if (ev.type === 'PROP_PICKUP') {
                vfx.spawnShockwave(ev.x, 0.2, ev.z, 0x00ff88);
                vfx.spawnHitSpark(ev.x, ev.y, ev.z, false, 14);
                showActionNotice(ev.text || 'SUPPLY ACQUIRED!');
            } else if (ev.type === 'CONSOLE_HACKED') {
                vfx.spawnShockwave(ev.x, 0.5, ev.z, 0x00f0ff);
                showActionNotice(ev.text || 'CONSOLE HACKED!');
                playOverrideChime();
                syncCommsBannerUI();
            } else if (ev.type === 'RPG_LEVEL_UP') {
                vfx.spawnShockwave(ev.x, 0.9, ev.z, 0xa855f7);
                vfx.spawnShockwave(ev.x, 0.15, ev.z, 0xffe600);
                threeScene.hitFlash(0.2);
                showActionNotice(`LEVEL UP! Lv.${ev.level} 解锁: ${ev.unlockLabel}`);
                updateRpgModalStrip();
            } else if (ev.type === 'ENEMY_DOWN') {
                showActionNotice(`击败敌军: ${ev.enemyName || 'ENEMY'}`);
                vfx.spawnShockwave(sim.f1.x, 0.15, sim.f1.z, 0xffe600);
                syncCommsBannerUI();
            } else if (ev.type === 'ZONE_CLEARED') {
                showActionNotice(`ZONE ${ev.zoneIndex}/${ev.totalZones} CLEARED!`);
                syncCommsBannerUI();
            } else if (ev.type === 'ZONE_ADVANCE') {
                applyEnemyTier(ev.enemyLevel, ev.isBoss);
                vfx.spawnShockwave(sim.f2.x, 0.2, sim.f2.z, 0xff0077);
                showActionNotice(`${ev.title}!`);
                syncCommsBannerUI();
            } else if (ev.type === 'CHAPTER_COMPLETED') {
                nextChapterTargetId = ev.nextChapterId || null;
                if (btnNextChapter) {
                    if (nextChapterTargetId) {
                        btnNextChapter.classList.remove('hidden');
                        btnNextChapter.textContent = `📖 进入下一章 (${nextChapterTargetId.toUpperCase()})`;
                    } else {
                        btnNextChapter.classList.add('hidden');
                    }
                }
                updateRpgModalStrip();
                syncCommsBannerUI();
            } else if (ev.type === 'KO') {
                const isRingOut = sim.f1.ringOut || sim.f2.ringOut;
                if (campaign.mode === 'TUTORIAL' && ev.winner === 'p1') {
                    koBanner.textContent = 'TRAINING COMPLETE!';
                } else if (campaign.mode === 'CAMPAIGN' && ev.winner === 'p1') {
                    koBanner.textContent = 'MISSION CLEAR!';
                } else {
                    koBanner.textContent = isRingOut ? 'RING OUT!' : 'K.O.';
                }
                koBanner.style.display = 'block';
                threeScene.addTrauma(0.65);
                setTimeout(() => {
                    if (campaign.mode === 'TUTORIAL' && ev.winner === 'p1') {
                        winnerText.textContent = `🎓 恭喜通过 TCTF 训练考核！当前等级 Lv.${campaign.rpg.level}`;
                        nextChapterTargetId = 'ch1';
                        if (btnNextChapter) {
                            btnNextChapter.classList.remove('hidden');
                            btnNextChapter.textContent = '📖 开启 CH.1 辛迪加货运仓库';
                        }
                    } else if (campaign.mode === 'CAMPAIGN' && ev.winner === 'p1') {
                        winnerText.textContent = `🏆 章节通关！Lv.${campaign.rpg.level} (${campaign.rpg.exp} EXP)`;
                    } else {
                        winnerText.textContent = ev.winner === 'p1' ? locale.winner_p1 : locale.winner_p2;
                    }
                    gameoverOverlay.classList.remove('hidden');
                }, 1400);
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

        // Release the captured mouse whenever a menu / result screen is up
        if (oniCtrl.locked && !isPlaying && document.exitPointerLock) document.exitPointerLock();

        // Fixed 60Hz Physics & Logic Ticks
        while (accumulator >= FIXED_DT) {
            accumulator -= FIXED_DT;

            if (isPlaying) {
                const localInput = samplePlayerInput();

                if (isMultiplayer && myRole === 'client') {
                    // Client sends input to Host; Host streams authoritative snapshots
                    if (session) {
                        session.send({ type: 'input', input: localInput });
                    }
                } else {
                    const p1Input = localInput;
                    let p2Input;

                    if (isMultiplayer && myRole === 'host') {
                        p2Input = remoteInput;
                    } else if (campaign.mode === 'TUTORIAL') {
                        p2Input = campaign.getTutorialBotInput(botBrain);
                    } else {
                        p2Input = botBrain.think(sim.f2, sim.f1, sim);
                    }

                    // Multi-agent squad enemy AI updates
                    if (Array.isArray(sim.extraEnemies) && sim.extraEnemies.length > 0) {
                        for (let i = 0; i < sim.extraEnemies.length; i++) {
                            const extra = sim.extraEnemies[i];
                            let eb = extraBrains.get(extra.id);
                            if (!eb) {
                                eb = new BotBrain(BotBrain.resolveTier(extra.aiProfileLevel || 'normal', botMode, extra.isBoss));
                                extraBrains.set(extra.id, eb);
                            }
                            extra.cachedAiInput = eb.think(extra, sim.f1, sim);
                        }
                    }

                    // Tick simulation
                    sim.tick(p1Input, p2Input);

                    const tickEvents = sim.events.length > 0 ? [...sim.events] : [];
                    if (!isMultiplayer && (campaign.mode === 'TUTORIAL' || campaign.mode === 'CAMPAIGN')) {
                        campaign.updateTick(p1Input, tickEvents);
                        syncCommsBannerUI();
                        syncCinematicUI();
                    }
                    // Drain and handle events
                    if (tickEvents.length > 0) {
                        processSimEvents(tickEvents);
                    }

                    // Broadcast state snapshot to client at 30Hz (or immediately on combat events / KO)
                    if (isMultiplayer && myRole === 'host' && session && (sim.currentFrame % 2 === 0 || tickEvents.length > 0)) {
                        session.send({
                            type: 'state',
                            snap: sim.getSnapshot(),
                            events: tickEvents
                        });
                    }
                }
            }
        }

        // Visual Updates & Rendering
        const timeSec = currentTime / 1000;
        meshP1.camYaw = meshP2.camYaw = threeScene.camYaw;
        meshP1.update(sim.f1, timeSec);
        meshP2.update(sim.f2, timeSec);

        // Update squad enemy procedural meshes & recycle defeated ones
        if (Array.isArray(sim.extraEnemies)) {
            const activeIds = new Set();
            for (let i = 0; i < sim.extraEnemies.length; i++) {
                const extra = sim.extraEnemies[i];
                activeIds.add(extra.id);
                let eMesh = extraMeshes.get(extra.id);
                if (!eMesh) {
                    eMesh = new ProceduralFighterMesh(threeScene.scene, false, { archetype: extra.archetype || 'STRIKER' });
                    extraMeshes.set(extra.id, eMesh);
                }
                eMesh.camYaw = threeScene.camYaw;
                eMesh.update(extra, timeSec);
            }
            for (const [id, eMesh] of extraMeshes.entries()) {
                if (!activeIds.has(id)) {
                    eMesh.destroy();
                    extraMeshes.delete(id);
                }
            }
        }

        vfx.syncEntities(sim);
        vfx.syncInteractables(campaign, timeSec);
        vfx.update(delta);
        const focusedEnemy = (typeof sim.f1.findBestTarget === 'function' ? sim.f1.findBestTarget(sim.getEnemies()) : null) || sim.f2;
        threeScene.updateCamera(sim.f1, focusedEnemy, !isPlaying, timeSec, campaign ? campaign.cinematic : null);
        threeScene.render();

        // Update HUD (smartly mirrors the currently locked/focused active enemy)
        const activeEnemy = focusedEnemy;
        if (p1NameEl) p1NameEl.textContent = sim.f1.name || 'KONOKO';
        if (p2NameEl) p2NameEl.textContent = activeEnemy.name || 'SYNDI-BOT';
        p1HpFill.style.width = `${Math.max(0, (sim.f1.hp / sim.f1.maxHp) * 100)}%`;
        p1HpFill.classList.toggle('overpower-active', !!sim.f1.daodanOverpower);
        p2HpFill.style.width = `${Math.max(0, (activeEnemy.hp / activeEnemy.maxHp) * 100)}%`;
        if (p1PoiseFill) p1PoiseFill.style.width = `${Math.max(0, (sim.f1.poise / sim.f1.maxPoise) * 100)}%`;
        if (p2PoiseFill) p2PoiseFill.style.width = `${Math.max(0, (activeEnemy.poise / activeEnemy.maxPoise) * 100)}%`;
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
        if (p1DaodanStage) {
            if (sim.f1.daodanOverpower) {
                p1DaodanStage.textContent = `OVERPOWER +${Math.round(sim.f1.overpowerShield)}`;
                p1DaodanStage.classList.add('overpower-badge');
            } else {
                p1DaodanStage.textContent = sim.f1.daodanOverdrive ? 'OVR' : `S${sim.f1.daodanStage}`;
                p1DaodanStage.classList.remove('overpower-badge');
            }
        }
        if (p2DaodanStage) p2DaodanStage.textContent = sim.f2.daodanOverdrive ? 'OVR' : `S${sim.f2.daodanStage}`;
        if (p1HypoBadge) {
            p1HypoBadge.textContent = `💉×${sim.f1.hypoCount}`;
            p1HypoBadge.classList.toggle('empty', sim.f1.hypoCount <= 0);
        }
        if (p2HypoBadge) {
            p2HypoBadge.textContent = `💉×${activeEnemy.hypoCount || 0}`;
            p2HypoBadge.classList.toggle('empty', (activeEnemy.hypoCount || 0) <= 0);
        }
        if (p1RpgBadge) {
            p1RpgBadge.textContent = `Lv.${campaign.rpg.level}`;
        }
        if (roundWaveLabel) {
            if (campaign.mode === 'TUTORIAL') {
                roundWaveLabel.textContent = `STEP ${campaign.tutorialStageIdx + 1}/6`;
            } else if (campaign.mode === 'CAMPAIGN') {
                roundWaveLabel.textContent = `${campaign.activeChapterId.toUpperCase()} Z${campaign.zoneIndex + 1}`;
            } else {
                roundWaveLabel.textContent = sim.survivalMode ? `WAVE ${sim.waveNumber}` : 'TIME';
            }
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
        if (sim.f1.daodanOverpower && sim.f1.overpowerShield > 0) {
            p1HpText.textContent = `${Math.ceil(sim.f1.hp)} (+${Math.ceil(sim.f1.overpowerShield)}🛡️) / ${sim.f1.maxHp}`;
        } else {
            p1HpText.textContent = `${Math.ceil(sim.f1.hp)} / ${sim.f1.maxHp}`;
        }
        p2HpText.textContent = `${Math.ceil(sim.f2.hp)} / ${sim.f2.maxHp}`;
        roundTimerEl.textContent = Math.ceil(sim.roundTimer / 60);

        // Dynamic Context-Sensitive Labels for Oni 4-Core Touch Cluster
        const f1 = sim.f1;
        const f2 = sim.f2;
        const dist = Math.hypot(f2.x - f1.x, f2.z - f1.z);
        const { fx, fz } = f1.getForwardVector();
        const stickFwd = touchDirX * fx + touchDirZ * fz > 0.3;

        if (lblPunch) {
            if (dist <= 1.32 && (f2.state === 'DIZZY' || stickFwd)) {
                lblPunch.textContent = '过肩摔!';
            } else if (f1.state === 'RUN') {
                lblPunch.textContent = '冲刺拳';
            } else {
                lblPunch.textContent = '拳·连击';
            }
        }
        if (lblKick) {
            if (f2.state === 'KNOCKED_DOWN' && dist <= 1.75) {
                lblKick.textContent = '重踏!';
            } else if (f1.state === 'RUN' || stickFwd || !f1.isGrounded) {
                lblKick.textContent = '疾风飞踢';
            } else {
                lblKick.textContent = '腿·三连';
            }
        }
        if (lblEvade) {
            lblEvade.textContent = stickFwd ? '疾风滑铲' : '闪避·滑铲';
        }
        if (btnFireEl && lblFire) {
            const weapons = sim.getWeapons();
            let nearWpn = false;
            for (let i = 0; i < weapons.length; i++) {
                if (weapons[i].ammo > 0 && Math.hypot(weapons[i].x - f1.x, weapons[i].z - f1.z) <= 1.35) {
                    nearWpn = true;
                    break;
                }
            }
            if (f1.weapon) {
                btnFireEl.classList.add('context-ready');
                lblFire.textContent = f1.weapon.ammo > 0 ? `开火(${f1.weapon.ammo})` : '掷空枪!';
            } else if (nearWpn) {
                btnFireEl.classList.add('context-ready');
                lblFire.textContent = '拾取枪械!';
            } else {
                btnFireEl.classList.remove('context-ready');
                lblFire.textContent = '射击·拾枪';
            }
        }
    }

    requestAnimationFrame(gameLoop);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
