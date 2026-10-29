/**
 * CampaignManager - Oni 2001 Story Campaign, TCTF Training Dojo, RPG Progression & Interactables
 *
 * Implements:
 *   - Ch.0: TCTF Combat Training Facility (Shinatama 6-stage interactive tutorial dojo)
 *   - Ch.1: Syndicate Freight Warehouse (Console hacking, Security Gate, Boss Barabas)
 *   - Ch.2: Musashi Biotech Laboratory (Cyber-Ninja ambush, Hypo supply crates, Boss Mukade)
 *   - Ch.3: TCTF Headquarters Rooftop (Multi-elevation rooftop showdown vs Boss Muro)
 *   - Konoko RPG Progression (Lv.1 ~ Lv.5, EXP, Max HP/Poise/Hypo scaling, Move Unlock Diary, localStorage save)
 */

import { FIGHTER_STATE, WEAPON_SPECS, MOVES } from './Constants.js';
import { CollisionSystem } from './CollisionSystem.js';

export const RPG_LEVEL_TABLE = [
    {
        level: 1,
        expRequired: 0,
        title: 'TCTF 见习特工 (Cadet)',
        maxHp: 110,
        maxPoise: 100,
        maxHypo: 1,
        daodanGainMult: 1.0,
        unlockedMoves: [
            'PUNCH_1', 'PUNCH_2', 'COMBO_PUNCH_KICK',
            'KICK_LOW', 'KICK_MID', 'KICK_HEAVY',
            'DASH_PUNCH', 'FLYING_KICK', 'SLIDE_KICK',
            'GROUND_STOMP', 'THROW_FRONT', 'THROW_RUN', 'THROW_BACK',
            'FIRE_WEAPON', 'THROW_WEAPON', 'USE_HYPO'
        ],
        unlockLabel: '基础三连击 · 疾风滑铲 · 贴身过肩摔'
    },
    {
        level: 2,
        expRequired: 120,
        title: 'TCTF 外勤干员 (Field Operative)',
        maxHp: 125,
        maxPoise: 115,
        maxHypo: 2,
        daodanGainMult: 1.15,
        unlockedMoves: [
            'BACK_SPIN_FIST', 'WILLOW_KICK', 'UPPERCUT'
        ],
        unlockLabel: '转身里拳 · 柳叶反踢 · 升龙破空拳'
    },
    {
        level: 3,
        expRequired: 280,
        title: 'TCTF 突击精英 (Special Assault)',
        maxHp: 140,
        maxPoise: 130,
        maxHypo: 2,
        daodanGainMult: 1.3,
        unlockedMoves: [
            'RISING_FURY', 'DISARM_KICK'
        ],
        unlockLabel: '旋风升龙腿 · 腾空缴械夺枪踢'
    },
    {
        level: 4,
        expRequired: 500,
        title: 'TCTF 战术指挥官 (Strike Commander)',
        maxHp: 155,
        maxPoise: 145,
        maxHypo: 3,
        daodanGainMult: 1.5,
        unlockedMoves: [
            'DEVIL_SPIN_KICK'
        ],
        unlockLabel: '鬼神烈风脚 (破防突进旋风腿)'
    },
    {
        level: 5,
        expRequired: 800,
        title: '鬼神觉醒者 (Daodan Awakened)',
        maxHp: 175,
        maxPoise: 165,
        maxHypo: 4,
        daodanGainMult: 1.8,
        unlockedMoves: [
            'DAODAN_SURGE'
        ],
        unlockLabel: '道弹蛹完全觉醒超载 · 再生剂上限×4'
    }
];

export const TRAINING_STAGES = [
    {
        id: 'STAGE_1_MOVE_SLIDE',
        step: 1,
        total: 6,
        speaker: 'SHINATAMA (品玉)',
        title: '第 1 课：3D 战术走位与疾风滑铲',
        instruction: '推动左侧摇杆（或 WASD）移动，向前推住并按 ⚡闪避（或 I 键）使出【疾风滑铲】穿过训练场！',
        highlightBtn: 'btn-evade',
        goalCount: 2,
        botDummyMode: 'PASSIVE'
    },
    {
        id: 'STAGE_2_EVADE_JUMP',
        step: 2,
        total: 6,
        speaker: 'SHINATAMA (品玉)',
        title: '第 2 课：无敌翻滚闪避与跳跃飞踢',
        instruction: '拉后/侧推按 ⚡闪避 触发【无敌翻滚】，再按 ⬆️跳跃 + 🦵腿 使出【空中飞踢】！（完成 2 次）',
        highlightBtn: 'btn-jump',
        goalCount: 2,
        botDummyMode: 'PASSIVE'
    },
    {
        id: 'STAGE_3_COMBO_STRINGS',
        step: 3,
        total: 6,
        speaker: 'SHINATAMA (品玉)',
        title: '第 3 课：三段连击与拳腿派生',
        instruction: '靠近陪练假人，按住或连按 👊拳 打出三连击，或 👊-👊-🦵 派生【终结旋踢】命中目标！（0/3）',
        highlightBtn: 'btn-punch',
        goalCount: 3,
        botDummyMode: 'GUARD_POKE'
    },
    {
        id: 'STAGE_4_THROW_SPECIAL',
        step: 4,
        total: 6,
        speaker: 'GRIFFIN (格里芬局长)',
        title: '第 4 课：贴身过肩摔与上划升龙必杀',
        instruction: '贴近敌人前推 + 👊拳（或 🤼摔投）施展【过肩摔】，或向上划动 👊/🦵 释放【升龙拳】！（0/2）',
        highlightBtn: 'btn-punch',
        goalCount: 2,
        botDummyMode: 'DIZZY_DUMMY'
    },
    {
        id: 'STAGE_5_GUN_FU_DISARM',
        step: 5,
        total: 6,
        speaker: 'SHINATAMA (品玉)',
        title: '第 5 课：Gun-Fu 滑铲夺枪与实弹射击',
        instruction: '陪练机器人已拔枪！用【前推+⚡滑铲】或【重踢】踢飞它的配枪，按 🔫 拾取并开火命中！（0/2）',
        highlightBtn: 'btn-fire',
        goalCount: 2,
        botDummyMode: 'ARMED_DUMMY'
    },
    {
        id: 'STAGE_6_HYPO_DAODAN',
        step: 6,
        total: 6,
        speaker: 'SHINATAMA (品玉)',
        title: '最终考核：再生剂恢复与道弹超载击败对手',
        instruction: '点击左上角 💉（或 H 键）注射再生剂回血，按下道弹槽（Q/E）爆发觉醒，击败陪练机器人结业！',
        highlightBtn: 'p1-hypo-badge',
        goalCount: 1,
        botDummyMode: 'SPARRING'
    }
];

export const CAMPAIGN_CHAPTERS = [
    {
        id: 'ch0',
        index: 0,
        code: 'CH.0',
        name: 'TCTF 总部训练基地',
        subtitle: 'Combat Training Facility · Shinatama 全息引导',
        isTutorial: true,
        themeColor: 0x00f0ff,
        recommendedLv: 1
    },
    {
        id: 'ch1',
        index: 1,
        code: 'CH.1',
        name: '辛迪加货运仓库',
        subtitle: 'Syndicate Freight Depot · 骇入终端 & 守备队长巴拉巴斯',
        isTutorial: false,
        themeColor: 0x38bdf8,
        recommendedLv: 1,
        zones: [
            {
                title: '区域 1/3：外围货场巡逻队',
                speaker: 'SHINATAMA',
                dialogue: 'Konoko，你已潜入辛迪加 14 号货运仓库。先解决外围巡逻兵，夺取他的配枪！',
                enemy: { name: 'SYNDICATE SENTRY (哨兵)', level: 'easy', maxHp: 85, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 65 },
                props: [
                    { type: 'MEDKIT_CRATE', x: -3.8, z: -2.2, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 4.2, z: -2.6, label: '💻 仓库门禁终端' }
            },
            {
                title: '区域 2/3：重装武器库守卫',
                speaker: 'SHINATAMA',
                dialogue: '大门已解锁！当心，重装突击兵正守在蜂群追踪炮补给箱旁！',
                enemy: { name: 'STRIKER TROOPER (重装兵)', level: 'normal', maxHp: 110, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 85 },
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'SCRAM_CANNON', x: 0.0, z: -2.0, label: '🔫 蜂群炮武器箱' },
                    { type: 'SHIELD_CELL', x: -3.2, z: 2.2, label: '🛡️ 纳米护盾充能' }
                ],
                requireConsoleHack: false
            },
            {
                title: '区域 3/3：BOSS 战 · 巴拉巴斯 (BARABAS)',
                speaker: 'BARABAS (巴拉巴斯)',
                dialogue: '「TCTF 的小丫头？让你尝尝重型粒子束的厉害！」—— 击败仓库守备队长巴拉巴斯！',
                isBoss: true,
                enemy: { name: 'BOSS: BARABAS (巴拉巴斯)', level: 'normal', maxHp: 145, weapon: 'MERCURY_BOW', hypo: 1, expReward: 150 },
                props: [
                    { type: 'MEDKIT_CRATE', x: 3.5, z: 2.4, label: '💉 紧急再生剂' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch2',
        index: 2,
        code: 'CH.2',
        name: '武藏丸生物实验室',
        subtitle: 'Musashi Biotech Lab · 道弹蛹真相 & 暗影忍者百足',
        isTutorial: false,
        themeColor: 0xa855f7,
        recommendedLv: 2,
        zones: [
            {
                title: '区域 1/3：实验室激光走廊',
                speaker: 'SHINATAMA',
                dialogue: '这里存放着“道弹蛹（Daodan Chrysalis）”的实验档案……小心辛迪加特工伏击！',
                enemy: { name: 'BIO-LAB GUARD (实验室卫兵)', level: 'normal', maxHp: 115, weapon: 'TCTF_PISTOL', hypo: 1, expReward: 95 },
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'MERCURY_BOW', x: -1.5, z: -2.4, label: '🔫 水银狙击弩箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -4.2, z: -2.5, label: '💻 主机数据终端' }
            },
            {
                title: '区域 2/3：黑曜石精锐双刃卫',
                speaker: 'KONOKO (麦玉)',
                dialogue: '终端数据显示我体内的道弹蛹正在共鸣……不管是谁挡路，统统打倒！',
                enemy: { name: 'BLACK OPS CAPTAIN (黑曜石队长)', level: 'normal', maxHp: 135, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 120 },
                props: [
                    { type: 'MEDKIT_CRATE', x: 3.6, z: -2.0, label: '💉 医疗补给箱' },
                    { type: 'SHIELD_CELL', x: 0.0, z: 2.5, label: '🛡️ 道弹共鸣晶簇' }
                ],
                requireConsoleHack: false
            },
            {
                title: '区域 3/3：BOSS 战 · 暗影忍者百足 (MUKADE)',
                speaker: 'MUKADE (百足)',
                dialogue: '「在阴影中化为尘埃吧，Konoko！」—— 击败擅长空翻闪避与背摔的辛迪加忍者百足！',
                isBoss: true,
                enemy: { name: 'BOSS: MUKADE (暗影百足)', level: 'hard', maxHp: 165, weapon: 'MERCURY_BOW', hypo: 2, expReward: 220 },
                props: [
                    { type: 'MEDKIT_CRATE', x: -3.6, z: 2.2, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch3',
        index: 3,
        code: 'CH.3',
        name: 'TCTF 总部天台决战',
        subtitle: 'Atmospheric Processor Rooftop · 宿敌 Muro 最终决战',
        isTutorial: false,
        themeColor: 0xff0077,
        recommendedLv: 3,
        zones: [
            {
                title: '区域 1/3：天台防线突破',
                speaker: 'GRIFFIN (格里芬)',
                dialogue: 'Muro 已经占领了顶层大气处理器天台！注意天台边缘的高低差，可以把敌人击落深渊！',
                enemy: { name: 'SYNDICATE ENFORCER (天台督军)', level: 'normal', maxHp: 130, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 120 },
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'TCTF_PISTOL', x: -2.5, z: -2.0, label: '🔫 战术手枪箱' },
                    { type: 'MEDKIT_CRATE', x: 2.8, z: -2.2, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 0.0, z: -3.4, label: '💻 大气处理器主控台' }
            },
            {
                title: '区域 2/3：穆罗亲卫队 (Elite Guard)',
                speaker: 'SHINATAMA',
                dialogue: '主控台已锁定！那是 Muro 的贴身暗影亲卫，善用过肩摔和道弹超载！',
                enemy: { name: 'MURO ROYAL GUARD (亲卫统领)', level: 'hard', maxHp: 155, weapon: 'MERCURY_BOW', hypo: 1, expReward: 160 },
                props: [
                    { type: 'SHIELD_CELL', x: -3.5, z: 2.0, label: '🛡️ 超载能量核心' },
                    { type: 'MEDKIT_CRATE', x: 3.5, z: 2.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            },
            {
                title: '最终区域：FINAL BOSS · 穆罗 (MURO)',
                speaker: 'MURO (穆罗)',
                titleBanner: 'FINAL SHOWDOWN: MURO',
                dialogue: '「整个世界都将在道弹的进化中重塑，妹妹！」—— 击败完全觉醒的辛迪加首领 Muro！',
                isBoss: true,
                enemy: { name: 'FINAL BOSS: MURO (鬼神穆罗)', level: 'hard', maxHp: 200, weapon: 'SCRAM_CANNON', hypo: 2, daodanStage: 3, expReward: 350 },
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'MERCURY_BOW', x: 0.0, z: -2.6, label: '🔫 水银狙击弩' },
                    { type: 'MEDKIT_CRATE', x: -4.0, z: 0.0, label: '💉 战术医疗箱' }
                ],
                requireConsoleHack: false
            }
        ]
    }
];

const STORAGE_KEY = 'oni_rpg_save_v1';

export class CampaignManager {
    constructor(sim) {
        this.sim = sim;
        this.mode = 'VERSUS'; // 'VERSUS' | 'SURVIVAL' | 'TUTORIAL' | 'CAMPAIGN'
        this.activeChapterId = 'ch1';
        this.zoneIndex = 0;
        this.zoneCleared = false;
        this.consoleHacked = true;
        this.zoneTransitionTimer = 0;

        // Tutorial State
        this.tutorialStageIdx = 0;
        this.tutorialProgress = 0;
        this.tutorialCompleteTimer = 0;
        this.tutorialCompleted = false;

        // Interactive 3D Props in current zone (Consoles, Medkits, Weapon Crates, Shield Cells, Security Gate)
        this.interactables = [];

        // HUD Banner State
        this.commsState = {
            visible: false,
            speaker: 'SHINATAMA',
            title: '',
            text: '',
            progressText: '',
            highlightBtn: null,
            objectiveHint: ''
        };

        // Persistent RPG Profile
        this.rpg = this.loadProfile();
    }

    loadProfile() {
        const defaultRpg = {
            level: 1,
            exp: 0,
            clearedChapters: [],
            tutorialDone: false
        };
        try {
            if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
                const raw = window.localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    return {
                        level: Math.max(1, Math.min(5, Number(parsed.level) || 1)),
                        exp: Math.max(0, Number(parsed.exp) || 0),
                        clearedChapters: Array.isArray(parsed.clearedChapters) ? parsed.clearedChapters : [],
                        tutorialDone: !!parsed.tutorialDone
                    };
                }
            }
        } catch (_) {
            // ignore storage errors in private/headless mode
        }
        return defaultRpg;
    }

    saveProfile() {
        try {
            if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.setItem === 'function') {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.rpg));
            }
        } catch (_) {
            // ignore
        }
    }

    getLevelSpec(lv = this.rpg.level) {
        return RPG_LEVEL_TABLE[Math.max(0, Math.min(RPG_LEVEL_TABLE.length - 1, lv - 1))];
    }

    getNextLevelSpec() {
        if (this.rpg.level >= RPG_LEVEL_TABLE.length) return null;
        return RPG_LEVEL_TABLE[this.rpg.level];
    }

    getUnlockedMoveList(upToLevel = this.rpg.level) {
        const set = new Set();
        for (let i = 0; i < RPG_LEVEL_TABLE.length; i++) {
            if (RPG_LEVEL_TABLE[i].level <= upToLevel) {
                for (const m of RPG_LEVEL_TABLE[i].unlockedMoves) {
                    set.add(m);
                }
            }
        }
        return set;
    }

    /**
     * Apply RPG stats and unlocked move set to Konoko (f1)
     * In VERSUS / SURVIVAL modes, all moves remain unlocked for competitive balance.
     */
    applyRpgStatsToPlayer(fighter, enforceMoveUnlocks = false) {
        if (!fighter) return;
        if (this.mode === 'CAMPAIGN' || this.mode === 'TUTORIAL') {
            const spec = this.getLevelSpec(this.rpg.level);
            fighter.maxHp = spec.maxHp;
            fighter.hp = spec.maxHp;
            fighter.maxPoise = spec.maxPoise;
            fighter.poise = spec.maxPoise;
            fighter.maxHypo = spec.maxHypo;
            fighter.hypoCount = spec.maxHypo;

            if (enforceMoveUnlocks && this.mode === 'CAMPAIGN') {
                fighter.unlockedMoves = this.getUnlockedMoveList(this.rpg.level);
            } else {
                fighter.unlockedMoves = new Set(Object.keys(MOVES));
            }
        } else {
            fighter.maxHp = 100;
            fighter.hp = 100;
            fighter.maxPoise = 100;
            fighter.poise = 100;
            fighter.maxHypo = 1;
            fighter.hypoCount = 1;
            fighter.unlockedMoves = new Set(Object.keys(MOVES));
        }
    }

    /**
     * Award RPG EXP and check for Level Up
     */
    addExp(amount, simEvents = null) {
        if (amount <= 0) return false;
        this.rpg.exp += Math.round(amount);
        let leveledUp = false;
        let newSpec = null;

        while (this.rpg.level < RPG_LEVEL_TABLE.length) {
            const nextSpec = RPG_LEVEL_TABLE[this.rpg.level];
            if (this.rpg.exp >= nextSpec.expRequired) {
                this.rpg.level++;
                leveledUp = true;
                newSpec = nextSpec;
            } else {
                break;
            }
        }

        this.saveProfile();

        if (leveledUp && this.sim && this.sim.f1) {
            const f1 = this.sim.f1;
            const spec = this.getLevelSpec(this.rpg.level);
            const hpDiff = spec.maxHp - f1.maxHp;
            f1.maxHp = spec.maxHp;
            f1.hp = Math.min(f1.maxHp, f1.hp + Math.max(25, hpDiff));
            f1.maxPoise = spec.maxPoise;
            f1.poise = f1.maxPoise;
            f1.maxHypo = spec.maxHypo;
            f1.hypoCount = Math.min(f1.maxHypo, f1.hypoCount + 1);
            const unlocked = this.getUnlockedMoveList(this.rpg.level);
            for (const m of unlocked) f1.unlockMove(m);

            if (simEvents) {
                simEvents.push({
                    type: 'RPG_LEVEL_UP',
                    level: this.rpg.level,
                    title: spec.title,
                    unlockLabel: newSpec ? newSpec.unlockLabel : spec.unlockLabel,
                    x: f1.x,
                    y: f1.y + 1.1,
                    z: f1.z
                });
            }
        }
        return leveledUp;
    }

    // =========================================================================
    // Mode Initializers
    // =========================================================================

    startTutorial() {
        CollisionSystem.setStageType('INDOOR_FLAT');
        this.mode = 'TUTORIAL';
        this.activeChapterId = 'ch0';
        this.tutorialStageIdx = 0;
        this.tutorialProgress = 0;
        this.tutorialCompleteTimer = 0;
        this.tutorialCompleted = false;
        this.interactables = [];

        this.sim.survivalMode = false;
        this.sim.reset();
        this.sim.roundTimer = 999 * 60; // Unlimited time in training dojo
        this.applyRpgStatsToPlayer(this.sim.f1, false);
        this.sim.f1.name = 'KONOKO (TCTF)';

        // Remove default arena weapon drops until Stage 5
        for (const w of this.sim.getWeapons()) {
            this.sim.removeEntity(w.id);
        }
        this.sim.f1.unequipWeapon();
        this.sim.f2.unequipWeapon();
        this.sim.f2.name = 'TRAINING DROID';
        this.sim.f2.maxHp = 120;
        this.sim.f2.hp = 120;

        this.setupTutorialStage(0);
    }

    setupTutorialStage(idx) {
        this.tutorialStageIdx = idx;
        this.tutorialProgress = 0;
        const st = TRAINING_STAGES[idx];
        if (!st) return;

        const f1 = this.sim.f1;
        const f2 = this.sim.f2;
        f1.hp = f1.maxHp;
        f1.poise = f1.maxPoise;
        f2.maxHp = 120;
        f2.hp = 120;
        f2.poise = f2.maxPoise;
        f2.state = FIGHTER_STATE.IDLE;

        if (st.id === 'STAGE_4_THROW_SPECIAL') {
            // Position dummy close so player can immediately practice shoulder throw / uppercut
            f2.x = f1.x + (f1.facing * 1.15);
            f2.z = f1.z;
            f2.poise = 15;
        } else if (st.id === 'STAGE_5_GUN_FU_DISARM') {
            // Equip dummy with a loaded pistol and spawn a backup pistol crate
            f2.x = f1.x + (f1.facing * 2.3);
            f2.z = f1.z;
            f2.equipWeapon({ type: 'TCTF_PISTOL', ammo: 8 });
            this.sim.spawnWeaponDrop('TCTF_PISTOL', 0, 0.15, -1.5);
        } else if (st.id === 'STAGE_6_HYPO_DAODAN') {
            // Give player damaged HP + Hypo + 85 Daodan meter to test healing & Overdrive
            f1.hp = Math.round(f1.maxHp * 0.55);
            f1.hypoCount = Math.max(2, f1.hypoCount);
            f1.gainDaodan(85);
            f2.maxHp = 75;
            f2.hp = 75;
            f2.x = f1.x + (f1.facing * 2.2);
            f2.z = f1.z;
        }

        this.updateTutorialComms();
    }

    updateTutorialComms() {
        const st = TRAINING_STAGES[this.tutorialStageIdx];
        if (!st) return;
        this.commsState = {
            visible: true,
            speaker: st.speaker,
            title: `🎓 ${st.title}`,
            text: st.instruction,
            progressText: `${this.tutorialProgress} / ${st.goalCount}`,
            highlightBtn: st.highlightBtn,
            objectiveHint: `训练进度 ${st.step}/${st.total}`
        };
    }

    startChapter(chapterId = 'ch1') {
        if (chapterId === 'ch0') {
            this.startTutorial();
            return;
        }
        const chapter = CAMPAIGN_CHAPTERS.find((c) => c.id === chapterId) || CAMPAIGN_CHAPTERS[1];
        if (chapter.id === 'ch3') {
            CollisionSystem.setStageType('ROOFTOP');
        } else {
            CollisionSystem.setStageType('INDOOR_FLAT');
        }
        this.mode = 'CAMPAIGN';
        this.activeChapterId = chapter.id;
        this.zoneIndex = 0;
        this.sim.survivalMode = false;
        this.sim.reset();
        this.applyRpgStatsToPlayer(this.sim.f1, true);
        this.sim.f1.name = `KONOKO (Lv.${this.rpg.level})`;
        this.setupCampaignZone(chapter, 0);
    }

    setupCampaignZone(chapter, zoneIdx) {
        this.zoneIndex = zoneIdx;
        this.zoneCleared = false;
        this.zoneTransitionTimer = 0;
        this.interactables = [];

        const zone = chapter.zones[zoneIdx];
        if (!zone) return;

        // Clear leftover weapons/projectiles
        for (const w of this.sim.getWeapons()) {
            this.sim.removeEntity(w.id);
        }
        for (const p of this.sim.getProjectiles()) {
            this.sim.removeEntity(p.id);
        }

        // Reposition fighters for the new zone
        const f1 = this.sim.f1;
        const f2 = this.sim.f2;
        f1.x = -2.8;
        f1.y = 0;
        f1.z = 0;
        f1.vx = 0;
        f1.vy = 0;
        f1.vz = 0;
        f1.facing = 1;
        f1.transitionTo(FIGHTER_STATE.IDLE);

        f2.reset(2.8, -1);
        f2.name = zone.enemy.name;
        f2.maxHp = zone.enemy.maxHp;
        f2.hp = zone.enemy.maxHp;
        f2.maxPoise = zone.isBoss ? 135 : 100;
        f2.poise = f2.maxPoise;
        f2.maxHypo = zone.enemy.hypo || 0;
        f2.hypoCount = zone.enemy.hypo || 0;
        f2.aiProfileLevel = zone.enemy.level || 'normal';
        if (zone.enemy.daodanStage) {
            f2.daodanStage = zone.enemy.daodanStage;
            f2.daodanMeter = 80;
        }
        if (zone.enemy.weapon) {
            f2.equipWeapon({ type: zone.enemy.weapon, id: `wpn_${chapter.id}_z${zoneIdx}` });
        } else {
            f2.unequipWeapon();
        }

        this.sim.roundTimer = 120 * 60;
        this.sim.isMatchOver = false;
        this.sim.winner = null;

        // Spawn interactive props (Medkit Crates, Weapon Crates, Shield Cells, Security Console)
        let propSeq = 1;
        if (Array.isArray(zone.props)) {
            for (const p of zone.props) {
                this.interactables.push({
                    id: `prop_${chapter.id}_${zoneIdx}_${propSeq++}`,
                    type: p.type,
                    weaponType: p.weaponType || 'TCTF_PISTOL',
                    x: p.x,
                    y: 0,
                    z: p.z,
                    label: p.label,
                    active: true,
                    hacked: false
                });
            }
        }

        this.consoleHacked = !zone.requireConsoleHack;
        if (zone.requireConsoleHack && zone.consolePos) {
            this.interactables.push({
                id: `console_${chapter.id}_${zoneIdx}`,
                type: 'CONSOLE',
                x: zone.consolePos.x,
                y: 0,
                z: zone.consolePos.z,
                label: zone.consolePos.label || '💻 战术终端',
                active: true,
                hacked: false
            });
            // Security laser gate on the right edge until console is hacked & enemy defeated
            this.interactables.push({
                id: `gate_${chapter.id}_${zoneIdx}`,
                type: 'SECURITY_GATE',
                x: 5.8,
                y: 0,
                z: 0,
                label: '🔒 安全激光门',
                active: true,
                unlocked: false
            });
        }

        this.commsState = {
            visible: true,
            speaker: zone.speaker || 'SHINATAMA',
            title: `📖 ${chapter.code} ${chapter.name} · ${zone.title}`,
            text: zone.dialogue,
            progressText: `Lv.${this.rpg.level} (${this.rpg.exp} EXP)`,
            highlightBtn: null,
            objectiveHint: zone.requireConsoleHack ? '目标：击败守卫并靠近 💻终端 解锁通道' : '目标：击败区域守卫'
        };
    }

    disableCampaign() {
        CollisionSystem.setStageType('ROOFTOP');
        this.mode = 'VERSUS';
        this.interactables = [];
        this.commsState.visible = false;
        this.applyRpgStatsToPlayer(this.sim.f1, false);
    }

    // =========================================================================
    // Per-Tick Update & Bot Override for Tutorial / Campaign
    // =========================================================================

    /**
     * Produce AI input during Tutorial Dojo stages
     */
    getTutorialBotInput(botBrain) {
        const blank = botBrain.createBlankInput();
        const st = TRAINING_STAGES[this.tutorialStageIdx];
        if (!st) return blank;

        const f1 = this.sim.f1;
        const f2 = this.sim.f2;
        const dist = Math.hypot(f1.x - f2.x, f1.z - f2.z);

        // Keep dummy on upper deck and facing player
        if (Math.abs(f2.x) > 5.0) {
            blank.dirX = f2.x > 0 ? -1 : 1;
            return blank;
        }

        if (st.botDummyMode === 'PASSIVE') {
            return blank;
        }
        if (st.botDummyMode === 'GUARD_POKE') {
            if (dist > 2.4) {
                blank.dirX = Math.sign(f1.x - f2.x);
            } else if (this.sim.currentFrame % 90 === 0) {
                blank.punch = true;
            }
            return blank;
        }
        if (st.botDummyMode === 'DIZZY_DUMMY') {
            if (dist > 1.35) {
                blank.dirX = Math.sign(f1.x - f2.x);
                blank.dirZ = Math.sign(f1.z - f2.z);
            }
            return blank;
        }
        if (st.botDummyMode === 'ARMED_DUMMY') {
            if (!f2.weapon && this.tutorialProgress === 0) {
                // Re-arm dummy if weapon fell out of reach before player picked it up
                const wpns = this.sim.getWeapons();
                if (wpns.length === 0) {
                    f2.equipWeapon({ type: 'TCTF_PISTOL', ammo: 8 });
                }
            }
            return blank;
        }
        if (st.botDummyMode === 'SPARRING') {
            botBrain.setLevel('easy');
            return botBrain.think(f2, f1, this.sim);
        }
        return blank;
    }

    /**
     * Evaluate tutorial progress, campaign zone objectives, and 3D prop interactions each tick
     */
    updateTick(p1Input, tickEvents) {
        if (this.mode === 'TUTORIAL') {
            this.updateTutorialTick(p1Input, tickEvents);
        } else if (this.mode === 'CAMPAIGN') {
            this.updateCampaignTick(p1Input, tickEvents);
        }
    }

    updateTutorialTick(p1Input, tickEvents) {
        if (this.tutorialCompleted) return;
        const st = TRAINING_STAGES[this.tutorialStageIdx];
        if (!st) return;

        const f1 = this.sim.f1;
        const f2 = this.sim.f2;

        // Keep dummy alive until Stage 6
        if (st.id !== 'STAGE_6_HYPO_DAODAN' && f2.hp < 35) {
            f2.hp = f2.maxHp;
        }

        if (this.tutorialCompleteTimer > 0) {
            this.tutorialCompleteTimer--;
            if (this.tutorialCompleteTimer === 0) {
                if (this.tutorialStageIdx + 1 < TRAINING_STAGES.length) {
                    this.setupTutorialStage(this.tutorialStageIdx + 1);
                    tickEvents.push({
                        type: 'TUTORIAL_STEP_CLEAR',
                        step: this.tutorialStageIdx + 1
                    });
                } else {
                    this.tutorialCompleted = true;
                    this.rpg.tutorialDone = true;
                    this.addExp(120, tickEvents);
                    this.commsState = {
                        visible: true,
                        speaker: 'GRIFFIN & SHINATAMA',
                        title: '🎖️ TCTF 格斗与枪械训练全部合格！',
                        text: '恭喜结业，Konoko！你已晋升并掌握全套《Oni》近战与夺枪技巧，可随时开启【Ch.1 辛迪加货运仓库】战役！',
                        progressText: 'COMPLETED!',
                        highlightBtn: null,
                        objectiveHint: '训练完成 (+120 EXP)'
                    };
                    this.sim.declareWinner('p1');
                }
            }
            return;
        }

        let gained = 0;

        if (st.id === 'STAGE_1_MOVE_SLIDE') {
            if (f1.state === FIGHTER_STATE.ATTACK && f1.currentMove && f1.currentMove.id === 'SLIDE_KICK' && f1.stateTimer === 0) {
                gained = 1;
            } else if ((f1.state === FIGHTER_STATE.WALK || f1.state === FIGHTER_STATE.RUN) && this.sim.currentFrame % 45 === 0 && this.tutorialProgress === 0) {
                gained = 1;
            }
        } else if (st.id === 'STAGE_2_EVADE_JUMP') {
            if (f1.state === FIGHTER_STATE.EVADE && f1.stateTimer === 0) {
                gained = 1;
            }
            if (f1.state === FIGHTER_STATE.ATTACK && f1.currentMove && (f1.currentMove.id === 'FLYING_KICK' || f1.currentMove.id === 'DISARM_KICK') && f1.stateTimer === 0) {
                gained = 1;
            }
        } else if (st.id === 'STAGE_3_COMBO_STRINGS') {
            for (const ev of tickEvents) {
                if (ev.type === 'HIT' && ev.attacker === 'p1') {
                    gained = 1;
                }
            }
        } else if (st.id === 'STAGE_4_THROW_SPECIAL') {
            if (f1.state === FIGHTER_STATE.THROW && f1.stateTimer === 0) {
                gained = 1;
            }
            if (f1.state === FIGHTER_STATE.ATTACK && f1.currentMove && (f1.currentMove.id === 'UPPERCUT' || f1.currentMove.id === 'RISING_FURY' || f1.currentMove.id === 'DEVIL_SPIN_KICK') && f1.stateTimer === 0) {
                gained = 1;
            }
        } else if (st.id === 'STAGE_5_GUN_FU_DISARM') {
            for (const ev of tickEvents) {
                if ((ev.type === 'WEAPON_DISARM' || ev.type === 'WEAPON_SNATCH' || ev.type === 'WEAPON_PICKUP' || ev.type === 'WEAPON_FIRE') && (ev.attacker === 'p1' || ev.fighter === 'p1')) {
                    gained = 1;
                }
            }
        } else if (st.id === 'STAGE_6_HYPO_DAODAN') {
            for (const ev of tickEvents) {
                if ((ev.type === 'HYPO_HEAL' || ev.type === 'DAODAN_OVERDRIVE') && ev.fighter === 'p1') {
                    this.tutorialProgress = Math.min(st.goalCount - 1, this.tutorialProgress);
                }
                if (ev.type === 'KO' && ev.winner === 'p1') {
                    gained = 1;
                }
            }
        }

        if (gained > 0) {
            this.tutorialProgress = Math.min(st.goalCount, this.tutorialProgress + gained);
            this.updateTutorialComms();
            if (this.tutorialProgress >= st.goalCount) {
                this.tutorialCompleteTimer = st.id === 'STAGE_6_HYPO_DAODAN' ? 5 : 35;
            }
        }
    }

    updateCampaignTick(p1Input, tickEvents) {
        const chapter = CAMPAIGN_CHAPTERS.find((c) => c.id === this.activeChapterId);
        if (!chapter) return;
        const zone = chapter.zones[this.zoneIndex];
        if (!zone) return;

        const f1 = this.sim.f1;
        const f2 = this.sim.f2;

        // 1. Check 3D Prop / Console Interactions
        for (let i = 0; i < this.interactables.length; i++) {
            const item = this.interactables[i];
            if (!item.active) continue;
            const dist = Math.hypot(item.x - f1.x, item.z - f1.z);

            if (item.type === 'MEDKIT_CRATE' && dist <= 1.25) {
                item.active = false;
                f1.hp = Math.min(f1.maxHp, f1.hp + 40);
                f1.hypoCount = Math.min(f1.maxHypo, f1.hypoCount + 1);
                tickEvents.push({
                    type: 'PROP_PICKUP',
                    propType: 'MEDKIT_CRATE',
                    text: 'MEDICAL CRATE! +40 HP & +1💉',
                    x: item.x,
                    y: 0.5,
                    z: item.z
                });
            } else if (item.type === 'SHIELD_CELL' && dist <= 1.25) {
                item.active = false;
                f1.poise = f1.maxPoise;
                f1.gainDaodan(40, tickEvents);
                tickEvents.push({
                    type: 'PROP_PICKUP',
                    propType: 'SHIELD_CELL',
                    text: 'DAODAN CELL! +40% 觉醒共鸣!',
                    x: item.x,
                    y: 0.5,
                    z: item.z
                });
            } else if (item.type === 'WEAPON_CRATE' && dist <= 1.35) {
                item.active = false;
                this.sim.spawnWeaponDrop(item.weaponType, item.x, 0.25, item.z);
                tickEvents.push({
                    type: 'PROP_PICKUP',
                    propType: 'WEAPON_CRATE',
                    text: `WEAPON CRATE OPENED: ${item.weaponType}!`,
                    x: item.x,
                    y: 0.5,
                    z: item.z
                });
            } else if (item.type === 'CONSOLE' && !item.hacked) {
                // Auto-hack console when Konoko walks near it or presses punch/fire near it
                if (dist <= 1.45 && (this.zoneCleared || p1Input.punch || p1Input.fire || dist <= 1.15)) {
                    item.hacked = true;
                    this.consoleHacked = true;
                    this.addExp(30, tickEvents);
                    for (const g of this.interactables) {
                        if (g.type === 'SECURITY_GATE') g.unlocked = true;
                    }
                    tickEvents.push({
                        type: 'CONSOLE_HACKED',
                        text: 'CONSOLE HACKED! 安全门已解锁 (+30 EXP)',
                        x: item.x,
                        y: 0.9,
                        z: item.z
                    });
                }
            }
        }

        // 2. Award EXP on combat disarms / throws
        for (const ev of tickEvents) {
            if ((ev.type === 'WEAPON_DISARM' || ev.type === 'WEAPON_SNATCH') && (ev.attacker === 'p1' || ev.fighter === 'p1')) {
                this.addExp(15, tickEvents);
            }
        }

        // 3. Intercept enemy defeat in multi-zone chapters so match doesn't end before the final zone!
        if (f2.hp <= 0 && !this.zoneCleared) {
            this.zoneCleared = true;
            this.addExp(zone.enemy.expReward || 80, tickEvents);

            const isLastZone = this.zoneIndex >= chapter.zones.length - 1;
            if (!isLastZone) {
                // Prevent Simulation from ending the match on intermediate zones!
                this.sim.isMatchOver = false;
                this.sim.winner = null;
                f1.transitionTo(FIGHTER_STATE.IDLE);
                f2.transitionTo(FIGHTER_STATE.DEFEAT);

                // Remove KO event if Simulation just pushed it
                for (let i = tickEvents.length - 1; i >= 0; i--) {
                    if (tickEvents[i].type === 'KO') {
                        tickEvents.splice(i, 1);
                    }
                }
                for (let i = this.sim.events.length - 1; i >= 0; i--) {
                    if (this.sim.events[i].type === 'KO') {
                        this.sim.events.splice(i, 1);
                    }
                }

                if (this.consoleHacked) {
                    this.zoneTransitionTimer = 85;
                    this.commsState.text = '区域肃清！正在进入下一扇安全门……';
                    this.commsState.objectiveHint = '区域完成！准备推进';
                } else {
                    this.commsState.text = '守卫已击倒！请前往发光的 💻战术终端 解锁安全门！';
                    this.commsState.objectiveHint = '目标：靠近 💻终端 骇入门禁';
                }
                this.commsState.progressText = `Lv.${this.rpg.level} (${this.rpg.exp} EXP)`;
                tickEvents.push({
                    type: 'ZONE_CLEARED',
                    zoneIndex: this.zoneIndex + 1,
                    totalZones: chapter.zones.length
                });
            } else {
                // Chapter Boss Defeated!
                if (!this.rpg.clearedChapters.includes(chapter.id)) {
                    this.rpg.clearedChapters.push(chapter.id);
                    this.saveProfile();
                }
                this.commsState.title = `🏆 ${chapter.code} ${chapter.name} · 章节通关！`;
                this.commsState.text = `成功击败 ${zone.enemy.name}！当前等级 Lv.${this.rpg.level} (${this.rpg.exp} EXP)。`;
                this.commsState.progressText = `Lv.${this.rpg.level} (${this.rpg.exp} EXP)`;
                this.commsState.objectiveHint = '章节任务完成！';
                tickEvents.push({
                    type: 'CHAPTER_COMPLETED',
                    chapterId: chapter.id,
                    chapterName: chapter.name,
                    nextChapterId: chapter.index < CAMPAIGN_CHAPTERS.length - 1 ? CAMPAIGN_CHAPTERS[chapter.index + 1].id : null
                });
            }
        }

        // If zone was already cleared and player just hacked the console, start transition timer!
        if (this.zoneCleared && this.consoleHacked && this.zoneTransitionTimer === 0 && this.zoneIndex < chapter.zones.length - 1) {
            this.zoneTransitionTimer = 65;
            this.commsState.text = '终端门禁已骇入！正在推进至下一区域……';
        }

        if (this.zoneTransitionTimer > 0) {
            this.zoneTransitionTimer--;
            if (this.zoneTransitionTimer === 0 && this.zoneIndex + 1 < chapter.zones.length) {
                this.setupCampaignZone(chapter, this.zoneIndex + 1);
                tickEvents.push({
                    type: 'ZONE_ADVANCE',
                    zoneIndex: this.zoneIndex + 1,
                    title: chapter.zones[this.zoneIndex].title,
                    enemyLevel: chapter.zones[this.zoneIndex].enemy.level
                });
            }
        }
    }
}
