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

import { FIGHTER_STATE, WEAPON_SPECS, MOVES, DIFFICULTY_PRESETS, MOVE_CHAPTER_UNLOCK, STEPPING_DISARM_CHAPTER } from './Constants.js';
import { CollisionSystem } from './CollisionSystem.js';
import { LEVEL_LAYOUTS, buildLevel, anchorZone, pathZ } from './LevelLayouts.js';

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
            'PUNCH_1', 'PUNCH_2', 'PUNCH_3', 'COMBO_PUNCH_KICK',
            'KICK_LOW', 'KICK_MID', 'KICK_HEAVY', 'SLEDGEHAMMER',
            'DASH_PUNCH', 'FLYING_KICK', 'SLIDE_KICK',
            'GROUND_STOMP', 'THROW_FRONT', 'THROW_RUN', 'THROW_BACK',
            'FIRE_WEAPON', 'THROW_WEAPON', 'USE_HYPO'
        ],
        unlockLabel: '体力与韧性提升（招式按章节习得）'
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
        unlockLabel: '体力、韧性提升，再生剂上限 +1'
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
        unlockLabel: '体力与韧性提升'
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
        unlockLabel: '体力、韧性提升，再生剂上限 +1'
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
        subtitle: 'Syndicate Freight Depot · 哨兵警报 & 守备队长巴拉巴斯',
        isTutorial: false,
        themeColor: 0x38bdf8,
        recommendedLv: 1,
        zones: [
            {
                title: '区域 1/3：外围货场集装箱迷宫 & 巡逻哨兵',
                speaker: 'SHINATAMA',
                dialogue: 'Konoko，前方是辛迪加 14 号露天货场！利用集装箱卡视线潜行。小心哨兵发现你后会狂奔拍响 🚨警报控制台 呼叫增援！消灭守卫并黑入终端开启安全大门！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: {
                    name: 'SYNDICATE SENTRY (巡逻哨兵)',
                    archetype: 'STRIKER',
                    x: -14.0,
                    z: -1.0,
                    level: 'easy',
                    maxHp: 42,
                    weapon: 'TCTF_PISTOL',
                    hypo: 0,
                    expReward: 65,
                    isAlerted: false,
                    canTriggerAlarm: true,
                    patrolMinX: -17.0,
                    patrolMaxX: -12.0
                },
                extraEnemies: [
                    { id: 'grunt_1a', name: 'CARGO BRAWLER (近战打手)', archetype: 'STRIKER', x: -9.5, z: 2.2, maxHp: 38, weapon: null, hypo: 0, level: 'easy', expReward: 45, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 货场警报控制台' },
                reinforcements: [
                    { id: 'reinf_fury_1', name: 'SYNDICATE FURY (突击女刺客)', archetype: 'FURY', x: -6.5, z: 0.5, maxHp: 48, weapon: null, hypo: 0, expReward: 70 },
                    { id: 'reinf_striker_1', name: 'DEPOT ENFORCER (增援突击手)', archetype: 'STRIKER', x: -6.5, z: -2.0, maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 55 }
                ],
                obstacles: [
                    { id: 'crate_1a', minX: -21.0, maxX: -18.8, minZ: -4.2, maxZ: -2.0, height: 2.8, blocksProjectiles: true, label: '📦 集装箱 A' },
                    { id: 'crate_1b', minX: -17.5, maxX: -15.2, minZ: 1.8, maxZ: 4.2, height: 2.8, blocksProjectiles: true, label: '📦 集装箱 B' },
                    { id: 'crate_1c', minX: -12.5, maxX: -10.2, minZ: -3.5, maxZ: -1.5, height: 2.6, blocksProjectiles: true, label: '📦 集装箱 C' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -18.0, z: -3.2, label: '💉 医疗补给箱' },
                    { type: 'WEAPON_CRATE', weaponType: 'SCRAM_CANNON', x: -8.5, z: -3.2, label: '🔫 蜂群炮补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.2, label: '💻 货场安全门禁终端' },
                consoleDiary: {
                    title: '辛迪加货运清单 #0482',
                    author: '仓储主管 诺里斯',
                    text: '从武藏丸秘密转移的 6 号生物容器已入库。注意：该道弹有机组织极不稳定，格里芬局长的爪牙正在全城搜捕，巴拉巴斯长官命令全体持枪戒备。'
                }
            },
            {
                title: '区域 2/3：激光警戒长廊 & 重装防暴机房',
                speaker: 'SHINATAMA',
                dialogue: '第一道门已突破！长廊内有霸体重装巨汉（Tanker）与后排高台水银狙击手架枪！警惕走廊警报器，速战速决！',
                gateX: 14.0,
                enemy: {
                    name: 'TANKER TROOPER (重装防暴巨汉)',
                    archetype: 'TANKER',
                    x: 3.5,
                    z: 0.0,
                    level: 'normal',
                    maxHp: 105,
                    weapon: 'SCRAM_CANNON',
                    hypo: 1,
                    expReward: 110,
                    isAlerted: false,
                    patrolMinX: 1.5,
                    patrolMaxX: 5.5
                },
                extraEnemies: [
                    { id: 'sniper_2a', name: 'CORRIDOR SNIPER (走廊狙击手)', archetype: 'SNIPER', x: 8.5, z: -2.8, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 75, isAlerted: false, canTriggerAlarm: true, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                alarmConsolePos: { x: 4.0, z: -4.0, label: '🚨 长廊警报控制台' },
                reinforcements: [
                    { id: 'reinf_grunt_2a', name: 'STRIKER GRUNT (增援小兵)', archetype: 'STRIKER', x: 13.0, z: 2.0, maxHp: 38, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 50 },
                    { id: 'reinf_grunt_2b', name: 'STRIKER BRAWLER (增援打手)', archetype: 'STRIKER', x: 13.0, z: -2.0, maxHp: 38, weapon: null, hypo: 0, expReward: 50 }
                ],
                obstacles: [
                    { id: 'crate_2a', minX: 0.2, maxX: 2.4, minZ: -3.4, maxZ: -1.2, height: 2.8, blocksProjectiles: true, label: '📦 战术掩体箱' },
                    { id: 'gantry_2b', minX: 4.5, maxX: 6.5, minZ: 1.2, maxZ: 3.5, height: 3.2, blocksProjectiles: true, label: '🏗️ 龙门吊支架' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 0.5, z: 2.8, label: '💉 再生剂补给' },
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.8, label: '🛡️ 纳米护盾充能' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.2, label: '💻 升降台主控终端' },
                consoleDiary: {
                    title: '重装机房安保日志',
                    author: '防暴中队指令',
                    text: '所有激光警戒门阻断已通电。外骨骼生化战士（Tanker）已就位，一旦触发火警或潜入警报，立即封锁走廊实施交叉火力歼灭。'
                }
            },
            {
                title: '区域 3/3：BOSS 战 · 守备统领巴拉巴斯 (BARABAS) & 亲卫小队',
                speaker: 'BARABAS (巴拉巴斯)',
                dialogue: '「TCTF 居然派一个女人孤身闯进来？小姑娘，我会用重型水银穿甲箭把你钉在大门上！」—— 击败巴拉巴斯与亲卫小队！',
                isBoss: true,
                enemy: {
                    name: 'BOSS: BARABAS (巴拉巴斯)',
                    archetype: 'TANKER',
                    x: 24.0,
                    z: 0.0,
                    level: 'normal',
                    maxHp: 160,
                    weapon: 'MERCURY_BOW',
                    hypo: 1,
                    expReward: 200
                },
                extraEnemies: [
                    { id: 'guard_fury_3', name: 'ROYAL FURY (巴拉巴斯亲卫女刺客)', archetype: 'FURY', x: 21.0, z: 2.8, maxHp: 48, weapon: null, hypo: 1, level: 'normal', expReward: 75 },
                    { id: 'guard_blackops_3', name: 'BLACK OPS STALKER (潜影暗部特工)', archetype: 'BLACK_OPS', x: 27.0, z: -2.6, maxHp: 55, weapon: 'SCRAM_CANNON', hypo: 0, level: 'normal', expReward: 85 }
                ],
                obstacles: [
                    { id: 'crate_3a', minX: 17.5, maxX: 19.8, minZ: -3.8, maxZ: -1.5, height: 2.8, blocksProjectiles: true, label: '📦 重型升降机货架' },
                    { id: 'lift_3b', minX: 23.0, maxX: 25.2, minZ: 1.8, maxZ: 4.0, height: 3.2, blocksProjectiles: true, label: '⚙️ 升降液压柱' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: -2.8, label: '💉 紧急医疗箱' },
                    { type: 'WEAPON_CRATE', weaponType: 'SCRAM_CANNON', x: 18.0, z: 2.8, label: '🔫 追踪蜂群炮' }
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
        subtitle: 'Musashi Biotech Lab · 道弹基因机密 & 暗影忍者百足',
        isTutorial: false,
        themeColor: 0xa855f7,
        recommendedLv: 2,
        zones: [
            {
                title: '区域 1/3：生化离心长廊 & 暗影特工',
                speaker: 'SHINATAMA',
                dialogue: '这里存放着“道弹蛹（Daodan Chrysalis）”绝密档案……小心潜影暗部特工（Black-Ops）的光学迷彩伏击！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: {
                    name: 'BLACK OPS SCOUT (光学迷彩侦察兵)',
                    archetype: 'BLACK_OPS',
                    x: -14.0,
                    z: -1.0,
                    level: 'normal',
                    maxHp: 48,
                    weapon: 'TCTF_PISTOL',
                    hypo: 0,
                    expReward: 100,
                    isAlerted: false,
                    canTriggerAlarm: true,
                    patrolMinX: -17.0,
                    patrolMaxX: -12.0
                },
                extraEnemies: [
                    { id: 'lab_ninja_1', name: 'SYNDICATE FURY (暗影女刺客)', archetype: 'FURY', x: -9.5, z: 2.5, maxHp: 42, weapon: null, hypo: 0, level: 'normal', expReward: 70, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 实验室警报控制台' },
                reinforcements: [
                    { id: 'reinf_shadow_1', name: 'SHADOW REINFORCEMENT (增援暗影兵)', archetype: 'BLACK_OPS', x: -6.5, z: 0.0, maxHp: 48, weapon: 'SCRAM_CANNON', hypo: 0, expReward: 75 }
                ],
                obstacles: [
                    { id: 'bio_tube_1', minX: -18.5, maxX: -16.2, minZ: -3.8, maxZ: -1.5, height: 3.2, blocksProjectiles: true, label: '🧪 培养槽机柜 A' }
                ],
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'MERCURY_BOW', x: -19.5, z: -3.2, label: '🔫 水银狙击弩箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.2, label: '💻 培养室门禁终端 A' },
                consoleDiary: {
                    title: '克尔博士（Dr. Kerr）实验手记 #14',
                    author: '克尔博士 · 绝密档案',
                    text: '麦玉（Konoko）体内的道弹蛹（Daodan Chrysalis）已经进入共鸣阶段。如果满生命状态下注入高纯度再生剂，将诱发生物机械超载（Overpower），释放金光护盾与霸体力量。'
                }
            },
            {
                title: '区域 2/3：双刃精锐守卫 & 反应堆中控',
                speaker: 'KONOKO (麦玉)',
                dialogue: '终端数据显示我体内的道弹蛹正在共鸣……不管是多少人挡路，统统打倒！',
                gateX: 14.0,
                enemy: {
                    name: 'TANKER WARDEN (反应堆典狱长)',
                    archetype: 'TANKER',
                    x: 3.5,
                    z: 0.0,
                    level: 'normal',
                    maxHp: 110,
                    weapon: 'SCRAM_CANNON',
                    hypo: 1,
                    expReward: 130,
                    isAlerted: false,
                    patrolMinX: 1.5,
                    patrolMaxX: 5.5
                },
                extraEnemies: [
                    { id: 'black_ops_trooper', name: 'ELITE SHADOW TROOPER (精锐暗影兵)', archetype: 'BLACK_OPS', x: 8.5, z: 2.2, maxHp: 50, weapon: 'TCTF_PISTOL', hypo: 0, level: 'normal', expReward: 80, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                alarmConsolePos: { x: 4.0, z: -4.0, label: '🚨 反应堆警报控制台' },
                reinforcements: [
                    { id: 'reinf_lab_2', name: 'LAB SHADOW GUARD (增援卫兵)', archetype: 'FURY', x: 13.0, z: 1.0, maxHp: 45, weapon: null, hypo: 0, expReward: 65 }
                ],
                obstacles: [
                    { id: 'bio_tube_2', minX: 3.5, maxX: 5.5, minZ: -1.2, maxZ: 1.0, height: 3.2, blocksProjectiles: true, label: '🧪 反应堆立柱' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 1.5, z: -2.8, label: '💉 医疗补给箱' },
                    { type: 'SHIELD_CELL', x: 6.0, z: 3.0, label: '🛡️ 道弹共鸣晶簇' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.2, label: '💻 主机数据终端 B' },
                consoleDiary: {
                    title: '武藏丸中控通信记录',
                    author: '暗影首领 百足 (Mukade)',
                    text: '穆罗大人，麦玉正在逼近培养核心。她的战斗潜能正在呈指数级跃升，我将在生化离心台设伏亲手剥离她的蛹。'
                }
            },
            {
                title: '区域 3/3：BOSS 战 · 暗影忍者百足 (MUKADE)',
                speaker: 'MUKADE (百足)',
                dialogue: '「在阴影中化为尘埃吧，Konoko！你的道弹力量属于辛迪加！」—— 击败擅长空翻闪避、背摔分身与水银弩的百足！',
                isBoss: true,
                enemy: {
                    name: 'BOSS: MUKADE (暗影百足)',
                    archetype: 'FURY',
                    x: 24.0,
                    z: 0.0,
                    level: 'hard',
                    maxHp: 150,
                    weapon: 'MERCURY_BOW',
                    hypo: 2,
                    expReward: 260
                },
                extraEnemies: [
                    { id: 'mukade_clone', name: 'SHADOW CLONE (百足分身)', archetype: 'FURY', x: 21.0, z: 2.5, maxHp: 42, weapon: null, hypo: 0, level: 'normal', expReward: 70 },
                    { id: 'mukade_stalker', name: 'SHADOW ASSASSIN (暗影刺客)', archetype: 'BLACK_OPS', x: 27.0, z: -2.5, maxHp: 48, weapon: 'TCTF_PISTOL', hypo: 0, level: 'normal', expReward: 75 }
                ],
                obstacles: [
                    { id: 'bio_tube_3', minX: 18.0, maxX: 20.0, minZ: 1.5, maxZ: 3.5, height: 3.2, blocksProjectiles: true, label: '🧪 离心核心柱' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 2.5, label: '💉 医疗补给箱' }
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
                dialogue: 'Muro 已经占领了顶层大气处理器天台！消灭守备部队并夺取控制台权限！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: {
                    name: 'SYNDICATE ENFORCER (天台督军)',
                    archetype: 'TANKER',
                    x: -14.0,
                    z: -0.5,
                    level: 'normal',
                    maxHp: 105,
                    weapon: 'SCRAM_CANNON',
                    hypo: 1,
                    expReward: 130,
                    isAlerted: false,
                    patrolMinX: -17.0,
                    patrolMaxX: -12.0
                },
                extraEnemies: [
                    { id: 'rooftop_sentry', name: 'ROOFTOP SNIPER (天台枪手)', archetype: 'SNIPER', x: -9.5, z: 2.2, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 70, isAlerted: false, patrolMinX: -11.5, patrolMaxX: -7.5 }
                ],
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'TCTF_PISTOL', x: -19.5, z: -2.5, label: '🔫 战术手枪箱' },
                    { type: 'MEDKIT_CRATE', x: -12.0, z: -3.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 大气处理器主控台 A' },
                consoleDiary: {
                    title: 'TCTF 紧急红色警报',
                    author: '格里芬局长',
                    text: '麦玉已经得知自己的身世，并且正在前往天台。穆罗的大气转化装置一旦启动，整座城市的生态将被彻底洗牌。不惜一切代价阻止他们！'
                }
            },
            {
                title: '区域 2/3：穆罗亲卫队 (Elite Guard)',
                speaker: 'SHINATAMA',
                dialogue: '主控台已锁定！那是 Muro 的贴身暗影亲卫统领，善用过肩摔和道弹超载！',
                gateX: 14.0,
                enemy: {
                    name: 'MURO ROYAL GUARD (亲卫统领)',
                    archetype: 'TANKER',
                    x: 3.5,
                    z: 0.0,
                    level: 'hard',
                    maxHp: 115,
                    weapon: 'MERCURY_BOW',
                    hypo: 1,
                    expReward: 170,
                    isAlerted: false,
                    patrolMinX: 1.5,
                    patrolMaxX: 5.5
                },
                extraEnemies: [
                    { id: 'royal_fury', name: 'ROYAL FURY (亲卫先锋刺客)', archetype: 'FURY', x: 8.5, z: -2.5, maxHp: 48, weapon: null, hypo: 1, level: 'hard', expReward: 90, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 2.5, z: 2.5, label: '🛡️ 超载能量核心' },
                    { type: 'MEDKIT_CRATE', x: 7.5, z: 2.5, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 能源矩阵终端 B' },
                consoleDiary: {
                    title: '穆罗的个人录音 #01',
                    author: '辛迪加总领 穆罗 (Muro)',
                    text: '他们称我们是怪物，麦玉。但道弹不是武器，它是人类迈向无毒生存环境的唯一进阶阶梯。到顶层来，让我看看你继承了多少力量。'
                }
            },
            {
                title: '最终区域：FINAL BOSS · 穆罗 (MURO)',
                speaker: 'MURO (穆罗)',
                titleBanner: 'FINAL SHOWDOWN: MURO',
                dialogue: '「整个世界都将在道弹的进化中重塑，我的妹妹！顺从命运吧！」—— 击败完全觉醒的辛迪加首领 Muro！',
                isBoss: true,
                enemy: {
                    name: 'FINAL BOSS: MURO (鬼神穆罗)',
                    archetype: 'TANKER',
                    x: 24.0,
                    z: 0.0,
                    level: 'hard',
                    maxHp: 200,
                    weapon: 'SCRAM_CANNON',
                    hypo: 2,
                    daodanStage: 3,
                    expReward: 400
                },
                extraEnemies: [
                    { id: 'muro_shadow_elite', name: 'MURO SHADOW ELITE (宿卫暗忍)', archetype: 'BLACK_OPS', x: 21.0, z: 2.8, maxHp: 55, weapon: 'MERCURY_BOW', hypo: 1, level: 'hard', expReward: 100 }
                ],
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'MERCURY_BOW', x: 18.0, z: -3.0, label: '🔫 水银狙击弩' },
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 战术医疗箱' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch4',
        index: 4,
        code: 'CH.4',
        name: '制造重地 · 地下装配厂',
        subtitle: 'Storm Warning · 辛迪加生化机械流水线',
        isTutorial: false,
        themeColor: 0x06b6d4,
        recommendedLv: 3,
        briefing: '【TCTF 战术档案 #04】辛迪加正在地下精密机械装配厂暗中量产外骨骼动力甲。麦玉需潜入地下水冷通道，破坏流水线动力核心。',
        zones: [
            {
                title: '区域 1/3：地下水冷通道 & 巡逻哨兵',
                speaker: 'SHINATAMA',
                dialogue: '水冷通道内湿度极高，雷达显示前方有辛迪加巡逻哨兵。保持潜行卡掩体前进！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'DEPOT ENFORCER', archetype: 'STRIKER', x: -14.0, z: -1.0, level: 'normal', maxHp: 40, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 80, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch4_grunt_1', name: 'TUNNEL BRAWLER', archetype: 'STRIKER', x: -9.5, z: 2.0, maxHp: 38, weapon: null, hypo: 0, level: 'normal', expReward: 50, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 水冷道警报控制台' },
                reinforcements: [
                    { id: 'ch4_reinf_1', name: 'PIPELINE STRIKER', archetype: 'STRIKER', x: -6.5, z: 0.0, maxHp: 40, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 50 }
                ],
                obstacles: [
                    { id: 'ch4_pipe_1', minX: -18.0, maxX: -15.5, minZ: -3.5, maxZ: -1.5, height: 2.8, blocksProjectiles: true, label: '📦 液氮冷凝罐' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 水冷阀门终端' },
                consoleDiary: { title: '流水线排班日志 #402', author: '工段长 维克托', text: '外骨骼动力装甲装配已经进入第三批次。克尔实验室送来的道弹神经接驳线已接入测试平台。' }
            },
            {
                title: '区域 2/3：动力流水线 & 重装工兵',
                speaker: 'KONOKO (麦玉)',
                dialogue: '这里到处都是外骨骼机械臂……重型坦克工兵正在守卫动力炉，利用滑铲和摔投迅速击倒！',
                gateX: 14.0,
                enemy: { name: 'FACTORY TANKER', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 105, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 120, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch4_sniper_2', name: 'GANTRY SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.5, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 65, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch4_crate_2', minX: 1.0, maxX: 3.0, minZ: -3.2, maxZ: -1.0, height: 2.8, blocksProjectiles: true, label: '📦 机械液压箱' }
                ],
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'SCRAM_CANNON', x: 0.5, z: 2.5, label: '🔫 蜂群炮补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 流水线控制终端' },
                consoleDiary: { title: '装甲测试报告', author: '辛迪加工程部', text: 'Tanker 型装甲虽然抗冲击强，但在背摔和下盘滑铲面前姿态恢复缓慢，务必配备狙击手交叉掩护。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 机械监工 维克托 (VIKTOR)',
                speaker: 'VIKTOR (维克托)',
                dialogue: '「没人能活着离开我的装配车间！女特工，成为机床下的废铁吧！」',
                isBoss: true,
                enemy: { name: 'BOSS: VIKTOR (维克托)', archetype: 'TANKER', x: 24.0, z: 0.0, level: 'hard', maxHp: 155, weapon: 'MERCURY_BOW', hypo: 1, expReward: 240 },
                extraEnemies: [
                    { id: 'ch4_guard_fury', name: 'ASSEMBLY FURY', archetype: 'FURY', x: 21.0, z: 2.5, maxHp: 45, weapon: null, hypo: 0, level: 'normal', expReward: 65 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch5',
        index: 5,
        code: 'CH.5',
        name: '绝密转运 · 生化撤离点',
        subtitle: 'Catching the Swarm · 突围生化护送队',
        isTutorial: false,
        themeColor: 0x10b981,
        recommendedLv: 3,
        briefing: '【TCTF 战术档案 #05】武藏丸实验室遭受重创后，辛迪加正试图将剩余道弹活性样本通过高架轻轨转运。Shinatama 协助锁定转运列车坐标。',
        zones: [
            {
                title: '区域 1/3：高架货运站台 & 暗忍伏击',
                speaker: 'SHINATAMA',
                dialogue: '高架转运列车将在 5 分钟后发车！站台上布置了暗影特工，注意隐蔽！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'PLATFORM STALKER', archetype: 'BLACK_OPS', x: -14.0, z: -1.0, level: 'normal', maxHp: 48, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 90, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch5_grunt_1', name: 'DEPOT GUARD', archetype: 'STRIKER', x: -9.5, z: 2.2, maxHp: 38, weapon: null, hypo: 0, level: 'normal', expReward: 50, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 站台警报控制台' },
                reinforcements: [
                    { id: 'ch5_reinf_1', name: 'ESCORT ENFORCER', archetype: 'STRIKER', x: -6.5, z: 0.0, maxHp: 40, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 55 }
                ],
                obstacles: [
                    { id: 'ch5_crate_1', minX: -17.0, maxX: -15.0, minZ: 1.5, maxZ: 3.5, height: 2.8, blocksProjectiles: true, label: '📦 货运集装箱' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 站台信号主控终端' },
                consoleDiary: { title: '列车发车指令', author: '护送队长 莫瑟', text: '生物反应罐必须在黎明前送达万斯大厦。任何人靠近铁轨一律格杀勿论。' }
            },
            {
                title: '区域 2/3：高速列车车顶 & 水银狙击手',
                speaker: 'KONOKO (麦玉)',
                dialogue: '列车开动了！狂风呼啸，前方有水银狙击手在车厢连接处架枪！',
                gateX: 14.0,
                enemy: { name: 'ROOF SNIPER', archetype: 'SNIPER', x: 3.5, z: 0.0, level: 'normal', maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, expReward: 90, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch5_fury_2', name: 'TRAIN FURY', archetype: 'FURY', x: 8.5, z: 2.0, maxHp: 45, weapon: null, hypo: 0, level: 'normal', expReward: 65, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch5_vent_2', minX: 2.0, maxX: 4.0, minZ: -2.5, maxZ: -0.8, height: 2.2, blocksProjectiles: true, label: '📦 列车排气口' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 5.5, z: 2.5, label: '🛡️ 能量充能包' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 紧急制动阀终端' },
                consoleDiary: { title: '紧急制动日志', author: '轻轨列车自检', text: '制动系统已锁死在最高时速，唯有在火车头总中枢才能解除。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 护送统领 莫瑟 (MERCER)',
                speaker: 'MERCER (莫瑟)',
                dialogue: '「想停下这列火车？踏过我的尸体再说吧，TCTF 的猎犬！」',
                isBoss: true,
                enemy: { name: 'BOSS: MERCER (莫瑟)', archetype: 'TANKER', x: 24.0, z: 0.0, level: 'hard', maxHp: 160, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 250 },
                extraEnemies: [
                    { id: 'ch5_guard_stalker', name: 'MERCER SHADOW', archetype: 'BLACK_OPS', x: 21.0, z: -2.2, maxHp: 50, weapon: 'TCTF_PISTOL', hypo: 0, level: 'normal', expReward: 70 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch6',
        index: 6,
        code: 'CH.6',
        name: '潜影突入 · 州政府深潜',
        subtitle: 'Deep Cover · 官商勾结的隐秘网络',
        isTutorial: false,
        themeColor: 0x3b82f6,
        recommendedLv: 4,
        briefing: '【TCTF 战术档案 #06】州政府大楼内部已被辛迪加渗透。麦玉孤身潜入档案中心，调取克尔博士与格里芬局长的绝密联合项目协议。',
        zones: [
            {
                title: '区域 1/3：地下行政车库 & 战术巡逻',
                speaker: 'SHINATAMA',
                dialogue: '州政府安保权限已被篡改。注意监控探头与黑衣特工！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'CIVIC ENFORCER', archetype: 'STRIKER', x: -14.0, z: -1.0, level: 'normal', maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 85, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch6_guard_1', name: 'SECURITY BRAWLER', archetype: 'STRIKER', x: -9.5, z: 2.0, maxHp: 38, weapon: null, hypo: 0, level: 'normal', expReward: 50, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 行政车库警报控制台' },
                reinforcements: [
                    { id: 'ch6_reinf_1', name: 'CIVIC SPECIALIST', archetype: 'FURY', x: -6.5, z: 0.0, maxHp: 45, weapon: null, hypo: 0, expReward: 60 }
                ],
                obstacles: [
                    { id: 'ch6_car_1', minX: -18.0, maxX: -15.0, minZ: -3.5, maxZ: -1.0, height: 2.2, blocksProjectiles: true, label: '📦 行政防弹轿车' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: 2.5, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 门禁授权终端' },
                consoleDiary: { title: '联合备忘录 #009', author: '州长特别顾问', text: '格里芬局长已保证 TCTF 不会干涉辛迪加在港口和工业区的道弹蛹研发工作。' }
            },
            {
                title: '区域 2/3：档案安保长廊 & 激光防护网',
                speaker: 'KONOKO (麦玉)',
                dialogue: '长廊里有密集的激光警戒网！下蹲滑铲可以安全钻过去！',
                gateX: 14.0,
                enemy: { name: 'ARCHIVE GUARD', archetype: 'BLACK_OPS', x: 3.5, z: 0.0, level: 'normal', maxHp: 50, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 95, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch6_sniper_2', name: 'CORRIDOR SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.2, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 70, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch6_rack_2', minX: 1.0, maxX: 3.0, minZ: 1.5, maxZ: 3.5, height: 3.0, blocksProjectiles: true, label: '📦 服务器档案机架' }
                ],
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'SCRAM_CANNON', x: 0.5, z: -2.5, label: '🔫 蜂群炮补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 档案库安全终端' },
                consoleDiary: { title: '绝密：双子道弹实验体', author: '克尔博士', text: '实验体 01（穆罗）表现出强烈的攻击性与统治欲；实验体 02（麦玉）被注入共生抑制剂送入 TCTF。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 州府特务长 罗德里格斯 (RODRIGUEZ)',
                speaker: 'RODRIGUEZ (罗德里格斯)',
                dialogue: '「你知道得太多了，小特工。政治不是黑与白，乖乖倒下吧！」',
                isBoss: true,
                enemy: { name: 'BOSS: RODRIGUEZ', archetype: 'BLACK_OPS', x: 24.0, z: 0.0, level: 'hard', maxHp: 150, weapon: 'MERCURY_BOW', hypo: 1, expReward: 260 },
                extraEnemies: [
                    { id: 'ch6_guard_tanker', name: 'STATE TANKER', archetype: 'TANKER', x: 21.0, z: 2.2, maxHp: 105, weapon: 'SCRAM_CANNON', hypo: 0, level: 'normal', expReward: 80 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch7',
        index: 7,
        code: 'CH.7',
        name: '午夜突袭 · 机场货运机库',
        subtitle: 'Midnight Run · 封锁空中外逃通道',
        isTutorial: false,
        themeColor: 0x8b5cf6,
        recommendedLv: 4,
        briefing: '【TCTF 战术档案 #07】暴风雨之夜，辛迪加重装护卫队正在封锁机场 7 号机库。麦玉必须在重型运输机升空前瘫痪雷达制导中继站。',
        zones: [
            {
                title: '区域 1/3：暴雨停机坪 & 巡逻小队',
                speaker: 'SHINATAMA',
                dialogue: '雨势很大，能见度低。辛迪加重型运输机正在机库跑道预热引擎！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'TARMAC ENFORCER', archetype: 'STRIKER', x: -14.0, z: -1.0, level: 'normal', maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 90, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch7_fury_1', name: 'RUNWAY FURY', archetype: 'FURY', x: -9.5, z: 2.0, maxHp: 45, weapon: null, hypo: 0, level: 'normal', expReward: 60, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 停机坪警报控制台' },
                reinforcements: [
                    { id: 'ch7_reinf_1', name: 'HANGAR REINFORCEMENT', archetype: 'STRIKER', x: -6.5, z: 0.0, maxHp: 40, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 55 }
                ],
                obstacles: [
                    { id: 'ch7_cargo_1', minX: -17.5, maxX: -15.0, minZ: -3.5, maxZ: -1.2, height: 2.8, blocksProjectiles: true, label: '📦 航空货运箱' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 跑道道闸终端' },
                consoleDiary: { title: '货运舱清单', author: '航空调度员', text: '目的地：旧城地下遗迹。货物：道弹次级孵化器共计 12 箱。' }
            },
            {
                title: '区域 2/3：7号重型机库 & 重装防暴机兵',
                speaker: 'KONOKO (麦玉)',
                dialogue: '机库闸门打开了，里面架着重型水银狙击！必须利用掩体迅速逼近！',
                gateX: 14.0,
                enemy: { name: 'HANGAR TANKER', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 110, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 125, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch7_sniper_2', name: 'GANTRY SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.5, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 75, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch7_engine_2', minX: 1.5, maxX: 4.0, minZ: 1.5, maxZ: 3.5, height: 3.0, blocksProjectiles: true, label: '📦 运输机喷气引擎' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.5, label: '🛡️ 能量电池' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 雷达中继终端' },
                consoleDiary: { title: '雷达站维护手册', author: '空管技师', text: '中继站一旦断电，整个空域的自动导航系统将强制进入盲降锁死。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 空勤突击长 霍克 (HAWK)',
                speaker: 'HAWK (霍克)',
                dialogue: '「没人能阻挡运输机起飞！TCTF 的丫头，给我坠落在暴风雨里吧！」',
                isBoss: true,
                enemy: { name: 'BOSS: HAWK (霍克)', archetype: 'TANKER', x: 24.0, z: 0.0, level: 'hard', maxHp: 160, weapon: 'MERCURY_BOW', hypo: 1, expReward: 270 },
                extraEnemies: [
                    { id: 'ch7_guard_fury', name: 'AVIONICS FURY', archetype: 'FURY', x: 21.0, z: 2.5, maxHp: 48, weapon: null, hypo: 0, level: 'normal', expReward: 70 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch8',
        index: 8,
        code: 'CH.8',
        name: '组织背叛 · TCTF 总部武装沦陷',
        subtitle: 'Betrayal · 决裂与绝境逃亡',
        isTutorial: false,
        themeColor: 0xef4444,
        recommendedLv: 4,
        briefing: '【TCTF 战术档案 #08】格里芬局长下达对麦玉的清剿密令。曾经并肩作战的 TCTF 特警部队反戈相向，麦玉必须依靠 Gun-Fu 枪斗在总部走廊杀出血路。',
        zones: [
            {
                title: '区域 1/3：TCTF 总部走廊 & 反戈特警',
                speaker: 'GRIFFIN (格里芬)',
                dialogue: '「全员注意：特工麦玉已被道弹寄生体深度侵蚀，列为特级生化威胁，授权就地击毙！」',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'TCTF SWAT GRUNT', archetype: 'STRIKER', x: -14.0, z: -1.0, level: 'normal', maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 95, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch8_swat_1', name: 'TCTF ENFORCER', archetype: 'STRIKER', x: -9.5, z: 2.0, maxHp: 40, weapon: 'TCTF_PISTOL', hypo: 0, level: 'normal', expReward: 60, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 TCTF 总部防卫警报' },
                reinforcements: [
                    { id: 'ch8_reinf_1', name: 'SWAT BREACHER', archetype: 'STRIKER', x: -6.5, z: 0.0, maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 60 }
                ],
                obstacles: [
                    { id: 'ch8_desk_1', minX: -18.0, maxX: -15.5, minZ: -3.5, maxZ: -1.2, height: 2.4, blocksProjectiles: true, label: '📦 警用接待台' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 局长授权安全闸门' },
                consoleDiary: { title: '格里芬的清剿令', author: '格里芬局长', text: '麦玉已经查到了克尔实验室的真相。她体内共生的道弹力量一旦失控，整个 TCTF 将万劫不复。' }
            },
            {
                title: '区域 2/3：简报大厅 & 防暴装甲中队',
                speaker: 'KONOKO (麦玉)',
                dialogue: '曾经教导我的战友……现在却拿枪指着我！我不会束手就擒！',
                gateX: 14.0,
                enemy: { name: 'TCTF TANKER GUARD', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 110, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 130, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch8_swat_sniper', name: 'SWAT MARKSMAN', archetype: 'SNIPER', x: 8.5, z: -2.2, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 75, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch8_podium_2', minX: 1.5, maxX: 3.5, minZ: 1.5, maxZ: 3.5, height: 2.8, blocksProjectiles: true, label: '📦 指挥演讲台' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.5, label: '🛡️ 警用防爆盾充能' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 通信中继控制台' },
                consoleDiary: { title: '品玉的紧急加密信', author: 'Shinatama // SLD-044', text: 'Konoko，万斯大厦……辛迪加攻进来了！他们要抓我当人质……快离开总部！' }
            },
            {
                title: '区域 3/3：BOSS 战 · 特警叛逆队长 雷克斯 (REX)',
                speaker: 'REX (雷克斯)',
                dialogue: '「对不起了麦玉，服从命令是特警的天职。放下武器吧！」',
                isBoss: true,
                enemy: { name: 'BOSS: REX (雷克斯)', archetype: 'TANKER', x: 24.0, z: 0.0, level: 'hard', maxHp: 165, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 280 },
                extraEnemies: [
                    { id: 'ch8_guard_blackops', name: 'BLACK OPS HUNTER', archetype: 'BLACK_OPS', x: 21.0, z: 2.5, maxHp: 52, weapon: 'TCTF_PISTOL', hypo: 0, level: 'normal', expReward: 75 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch9',
        index: 9,
        code: 'CH.9',
        name: '紧急求援 · 万斯大厦救出品玉',
        subtitle: 'S.O.S. · 拯救拟真生命体 Shinatama',
        isTutorial: false,
        themeColor: 0xf59e0b,
        recommendedLv: 5,
        briefing: '【TCTF 战术档案 #09】万斯大厦被辛迪加攻占，Shinatama 的全息中枢被物理剥离禁锢。麦玉必须争分夺秒突破生化防线，拯救自己的唯一挚友。',
        zones: [
            {
                title: '区域 1/3：万斯大厦大厅 & 辛迪加突袭队',
                speaker: 'SHINATAMA',
                dialogue: '「Konoko……我的主意识正在被穆罗的黑客强行离线……他们在顶层……」',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'VANCE INVADER', archetype: 'STRIKER', x: -14.0, z: -1.0, level: 'normal', maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 95, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch9_fury_1', name: 'SHADOW INFILTRATOR', archetype: 'FURY', x: -9.5, z: 2.2, maxHp: 45, weapon: null, hypo: 0, level: 'normal', expReward: 65, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 大厦安防警报' },
                reinforcements: [
                    { id: 'ch9_reinf_1', name: 'HEAVY ENFORCER', archetype: 'STRIKER', x: -6.5, z: 0.0, maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 60 }
                ],
                obstacles: [
                    { id: 'ch9_statue_1', minX: -17.5, maxX: -15.0, minZ: -3.5, maxZ: -1.5, height: 3.2, blocksProjectiles: true, label: '📦 大厦大理石雕塑' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 高速电梯终端' },
                consoleDiary: { title: '辛迪加突袭日志', author: '突袭指挥官', text: 'SLD-044（品玉）体内储存着麦玉蛹体共振的所有密钥，已经装载至顶层全息禁锢室。' }
            },
            {
                title: '区域 2/3：核心机房 & 激光护栏',
                speaker: 'KONOKO (麦玉)',
                dialogue: '品玉，撑住！我绝不会让他们把你当成工具！',
                gateX: 14.0,
                enemy: { name: 'VANCE TANKER', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 110, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 135, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch9_sniper_2', name: 'SERVER SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.5, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 75, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch9_server_2', minX: 1.5, maxX: 4.0, minZ: 1.5, maxZ: 3.5, height: 3.0, blocksProjectiles: true, label: '📦 光子计算服务器' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.5, label: '🛡️ 能量晶簇' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 禁锢协议解除终端' },
                consoleDiary: { title: '克尔博士的绝笔信件', author: '克尔博士', text: '品玉不是单纯的人工智能，她是根据我死去女儿的心智模组所重构的生命体……麦玉，保护她。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 生化行刑官 瓦尔加 (VARGA)',
                speaker: 'VARGA (瓦尔加)',
                dialogue: '「太迟了麦玉！这台拟真生命体的主回路马上就要烧毁了，陪她一起化为灰烬吧！」',
                isBoss: true,
                enemy: { name: 'BOSS: VARGA (瓦尔加)', archetype: 'TANKER', x: 24.0, z: 0.0, level: 'hard', maxHp: 170, weapon: 'MERCURY_BOW', hypo: 1, expReward: 300 },
                extraEnemies: [
                    { id: 'ch9_guard_fury', name: 'EXECUTION FURY', archetype: 'FURY', x: 21.0, z: 2.5, maxHp: 50, weapon: null, hypo: 0, level: 'normal', expReward: 75 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch10',
        index: 10,
        code: 'CH.10',
        name: '记忆深处 · 蛹化起源真相觉醒',
        subtitle: 'Revelations · 克尔实验室的挽歌',
        isTutorial: false,
        themeColor: 0xec4899,
        recommendedLv: 5,
        briefing: '【TCTF 战术档案 #10】克尔博士在弥留之际交出道弹蛹的全部研发数据：麦玉与穆罗是同母同胞的亲兄妹，两人体内共生着世界上仅有的两枚完全体道弹蛹。',
        zones: [
            {
                title: '区域 1/3：废弃克尔研究中心外围',
                speaker: 'KERR (克尔博士)',
                dialogue: '「麦玉……你终于来到这里了。看看培养舱里的最初档案吧，那才是你和穆罗的真正起源。」',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'RUIN SCOUT', archetype: 'BLACK_OPS', x: -14.0, z: -1.0, level: 'normal', maxHp: 48, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 100, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch10_fury_1', name: 'LAB SHADOW', archetype: 'FURY', x: -9.5, z: 2.0, maxHp: 45, weapon: null, hypo: 0, level: 'normal', expReward: 65, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 实验室警报控制台' },
                reinforcements: [
                    { id: 'ch10_reinf_1', name: 'SHADOW SENTRY', archetype: 'BLACK_OPS', x: -6.5, z: 0.0, maxHp: 48, weapon: 'SCRAM_CANNON', hypo: 0, expReward: 65 }
                ],
                obstacles: [
                    { id: 'ch10_tank_1', minX: -18.0, maxX: -15.5, minZ: -3.5, maxZ: -1.5, height: 3.2, blocksProjectiles: true, label: '📦 生物基因离心罐' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 原始研究数据终端 A' },
                consoleDiary: { title: '道弹蛹起源日记 #01', author: '克尔博士', text: '母亲长谷川惠美将道弹蛹植入了尚在胎儿期的麦玉和穆罗体内。道弹是抵御环境毒化的奇迹，而非杀戮兵器。' }
            },
            {
                title: '区域 2/3：深层无菌培养舱长廊',
                speaker: 'KONOKO (麦玉)',
                dialogue: '原来穆罗是我的亲哥哥……但为了整个城市无辜的人，我绝不会任由他用极端毒气毁灭人类！',
                gateX: 14.0,
                enemy: { name: 'CYBER TANKER', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 110, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 140, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch10_sniper_2', name: 'STERILE SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.5, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 80, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch10_chamber_2', minX: 1.5, maxX: 4.0, minZ: 1.5, maxZ: 3.5, height: 3.0, blocksProjectiles: true, label: '📦 人类基因冷冻舱' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.5, label: '🛡️ 超载灵气晶核' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 核心基因库终端 B' },
                consoleDiary: { title: '克尔博士的临终遗言', author: '克尔博士', text: '当道弹蛹达到满状态共振时，再生剂将引发无上霸体。麦玉，你是人类最后的希望。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 幻影百足 (MUKADE SHADOW)',
                speaker: 'MUKADE (百足残像)',
                dialogue: '「武藏丸的仇恨将在今夜终结！死在记忆深处的阴影中吧！」',
                isBoss: true,
                enemy: { name: 'BOSS: MUKADE SHADOW', archetype: 'FURY', x: 24.0, z: 0.0, level: 'hard', maxHp: 160, weapon: 'MERCURY_BOW', hypo: 1, expReward: 310 },
                extraEnemies: [
                    { id: 'ch10_guard_ops', name: 'GENETIC SHADOW', archetype: 'BLACK_OPS', x: 21.0, z: 2.5, maxHp: 50, weapon: 'TCTF_PISTOL', hypo: 0, level: 'normal', expReward: 80 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch11',
        index: 11,
        code: 'CH.11',
        name: '困局突围 · 山地前哨生化堡',
        subtitle: 'A Friend in Need · 严寒要塞的围歼战',
        isTutorial: false,
        themeColor: 0x14b8a6,
        recommendedLv: 5,
        briefing: '【TCTF 战术档案 #11】在城市边缘的风雪山地前哨，辛迪加暗影刺客与重装机兵发动了终极合围。麦玉彻底觉醒道弹超载力量，横扫严寒哨卡。',
        zones: [
            {
                title: '区域 1/3：风雪外围前哨卡 & 严寒哨兵',
                speaker: 'SHINATAMA',
                dialogue: '严寒气温极低，地表已结冰！敌人配备了重防寒战术服，注意脚底防滑！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'ARCTIC SENTRY', archetype: 'STRIKER', x: -14.0, z: -1.0, level: 'normal', maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 100, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch11_fury_1', name: 'BLIZZARD FURY', archetype: 'FURY', x: -9.5, z: 2.0, maxHp: 45, weapon: null, hypo: 0, level: 'normal', expReward: 70, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 要塞警报控制台' },
                reinforcements: [
                    { id: 'ch11_reinf_1', name: 'MOUNTAIN ENFORCER', archetype: 'STRIKER', x: -6.5, z: 0.0, maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 65 }
                ],
                obstacles: [
                    { id: 'ch11_rock_1', minX: -17.5, maxX: -15.0, minZ: -3.5, maxZ: -1.5, height: 3.0, blocksProjectiles: true, label: '📦 风雪岩体掩护' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 要塞外门控制台' },
                consoleDiary: { title: '山地要塞通报', author: '前哨司令 鲍里斯', text: '通往旧城地下飞地的密道就在要塞后方，所有人守住隘口，穆罗大人正处于蛹化觉醒的关键期。' }
            },
            {
                title: '区域 2/3：要塞坚固走廊 & 重装暴雪机兵',
                speaker: 'KONOKO (麦玉)',
                dialogue: '寒风挡不住我！道弹蛹的热量正在胸口激荡！',
                gateX: 14.0,
                enemy: { name: 'BLIZZARD TANKER', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 115, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 145, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch11_sniper_2', name: 'GLACIER SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.5, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 80, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch11_bunker_2', minX: 1.5, maxX: 4.0, minZ: 1.5, maxZ: 3.5, height: 3.2, blocksProjectiles: true, label: '📦 混凝土碉堡掩体' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.5, label: '🛡️ 暴雪护盾核心' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 隘口停机坪道闸终端' },
                consoleDiary: { title: '要塞作战日志', author: '辛迪加高阶参谋', text: '麦玉单人突破了 4 个战术联队。她的动作已经不再属于人类范畴，只有鬼神穆罗能压制她。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 前哨司令官 鲍里斯 (BORIS)',
                speaker: 'BORIS (鲍里斯)',
                dialogue: '「在严寒中长眠吧！这里是辛迪加无法逾越的钢铁雄关！」',
                isBoss: true,
                enemy: { name: 'BOSS: BORIS (鲍里斯)', archetype: 'TANKER', x: 24.0, z: 0.0, level: 'hard', maxHp: 170, weapon: 'MERCURY_BOW', hypo: 1, expReward: 320 },
                extraEnemies: [
                    { id: 'ch11_guard_ops', name: 'FROST SHADOW', archetype: 'BLACK_OPS', x: 21.0, z: 2.5, maxHp: 52, weapon: 'TCTF_PISTOL', hypo: 0, level: 'normal', expReward: 85 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch12',
        index: 12,
        code: 'CH.12',
        name: '绝望遗迹 · 辛迪加最终飞地',
        subtitle: 'The Forgotten · 废弃都市地底的余孽',
        isTutorial: false,
        themeColor: 0x64748b,
        recommendedLv: 5,
        briefing: '【TCTF 战术档案 #12】深入旧城地下的废弃工业区，辛迪加最精锐的宿卫亲军在此设下了最后的交叉火力网。',
        zones: [
            {
                title: '区域 1/3：旧城废墟长廊 & 隐秘暗忍',
                speaker: 'SHINATAMA',
                dialogue: '地下充满有毒废气，空气过滤网已超负荷运转。小心无声接近的暗杀者！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'RUIN STALKER', archetype: 'BLACK_OPS', x: -14.0, z: -1.0, level: 'normal', maxHp: 50, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 105, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch12_fury_1', name: 'FORGOTTEN FURY', archetype: 'FURY', x: -9.5, z: 2.0, maxHp: 48, weapon: null, hypo: 0, level: 'normal', expReward: 75, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 地底警报终端' },
                reinforcements: [
                    { id: 'ch12_reinf_1', name: 'RUIN ASSASSIN', archetype: 'BLACK_OPS', x: -6.5, z: 0.0, maxHp: 50, weapon: 'SCRAM_CANNON', hypo: 0, expReward: 70 }
                ],
                obstacles: [
                    { id: 'ch12_debris_1', minX: -17.5, maxX: -15.0, minZ: -3.5, maxZ: -1.5, height: 2.8, blocksProjectiles: true, label: '📦 塌陷钢筋混凝土' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 排毒管道控制台' },
                consoleDiary: { title: '旧城地下报告', author: '辛迪加暗部', text: '穆罗大人已经完成了蛹化第 3 阶段的最终蜕变。大气转换中心顶层的巨型装置正在充能。' }
            },
            {
                title: '区域 2/3：废弃动力泵房 & 重装宿卫',
                speaker: 'KONOKO (麦玉)',
                dialogue: '这里是通往核心中枢的唯一排气井……消灭他们！',
                gateX: 14.0,
                enemy: { name: 'FORGOTTEN TANKER', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 115, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 150, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch12_sniper_2', name: 'RUIN SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.5, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 85, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch12_pump_2', minX: 1.5, maxX: 4.0, minZ: 1.5, maxZ: 3.5, height: 3.0, blocksProjectiles: true, label: '📦 高压排毒泵机' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.5, label: '🛡️ 纳米护盾包' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 核心竖井升降终端' },
                consoleDiary: { title: '宿卫死士军令', author: '宿卫死士长 影月', text: '不惜一切代价为大人拖延时间。只要大气转换器启动，新世界将由我们主宰。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 宿卫死士长 影月 (SHADOW MOON)',
                speaker: 'SHADOW MOON (影月)',
                dialogue: '「穆罗大人的意志不可违逆！你的旅途到此为止了！」',
                isBoss: true,
                enemy: { name: 'BOSS: SHADOW MOON', archetype: 'FURY', x: 24.0, z: 0.0, level: 'hard', maxHp: 165, weapon: 'MERCURY_BOW', hypo: 1, expReward: 340 },
                extraEnemies: [
                    { id: 'ch12_guard_tanker', name: 'RUIN ELITE TANKER', archetype: 'TANKER', x: 21.0, z: 2.5, maxHp: 110, weapon: 'SCRAM_CANNON', hypo: 0, level: 'normal', expReward: 90 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch13',
        index: 13,
        code: 'CH.13',
        name: '破晓复仇 · 辛迪加核心中枢',
        subtitle: 'Retribution · 决战前夜的肃清',
        isTutorial: false,
        themeColor: 0x84cc16,
        recommendedLv: 5,
        briefing: '【TCTF 战术档案 #13】辛迪加核心指挥中枢全面瘫痪，麦玉突破最后一道外骨骼重甲阵线，直奔大气转换中心顶层。',
        zones: [
            {
                title: '区域 1/3：中枢总控大门防线',
                speaker: 'SHINATAMA',
                dialogue: '前面就是大气转换器主升降梯！这是辛迪加最后的精锐部队！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'CORE ENFORCER', archetype: 'STRIKER', x: -14.0, z: -1.0, level: 'normal', maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 110, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch13_ops_1', name: 'CORE BLACK OPS', archetype: 'BLACK_OPS', x: -9.5, z: 2.0, maxHp: 50, weapon: 'TCTF_PISTOL', hypo: 0, level: 'normal', expReward: 80, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 中枢大门警报终端' },
                reinforcements: [
                    { id: 'ch13_reinf_1', name: 'CORE HEAVY', archetype: 'STRIKER', x: -6.5, z: 0.0, maxHp: 42, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 75 }
                ],
                obstacles: [
                    { id: 'ch13_gate_1', minX: -17.5, maxX: -15.0, minZ: -3.5, maxZ: -1.5, height: 3.2, blocksProjectiles: true, label: '📦 防爆合金隔离门' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 核心总控终端 A' },
                consoleDiary: { title: '大气转换器启动倒计时', author: '系统自动警报', text: '距完全充能还剩 300 秒。剧毒气体催化剂注入完毕。' }
            },
            {
                title: '区域 2/3：核心动力矩阵 & 外骨骼重兵',
                speaker: 'KONOKO (麦玉)',
                dialogue: '巨型动力涡轮正在全速旋转……摧毁控制台，打开升降梯！',
                gateX: 14.0,
                enemy: { name: 'MATRIX TANKER', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 115, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 160, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch13_sniper_2', name: 'MATRIX SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.5, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 90, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch13_core_2', minX: 1.5, maxX: 4.0, minZ: 1.5, maxZ: 3.5, height: 3.2, blocksProjectiles: true, label: '📦 超导能量转子' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.5, label: '🛡️ 灵气矩阵充能' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 顶层超导升降梯终端' },
                consoleDiary: { title: '最后的通讯录音', author: '穆罗 (Muro)', text: '我的妹妹，你终于上来了。这是属于我们两个人的终局舞台。' }
            },
            {
                title: '区域 3/3：BOSS 战 · 近卫大统领 铁壁格尔 (GEL)',
                speaker: 'GEL (铁壁格尔)',
                dialogue: '「我是穆罗大人最后的盾牌！任何人都别想踏上升降台半步！」',
                isBoss: true,
                enemy: { name: 'BOSS: GEL (铁壁格尔)', archetype: 'TANKER', x: 24.0, z: 0.0, level: 'hard', maxHp: 175, weapon: 'MERCURY_BOW', hypo: 1, expReward: 360 },
                extraEnemies: [
                    { id: 'ch13_guard_fury', name: 'CORE ROYAL FURY', archetype: 'FURY', x: 21.0, z: 2.5, maxHp: 50, weapon: null, hypo: 0, level: 'normal', expReward: 95 }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 再生剂补给' }
                ],
                requireConsoleHack: false
            }
        ]
    },
    {
        id: 'ch14',
        index: 14,
        code: 'CH.14',
        name: '终极裁决 · 大气转换核心决战',
        subtitle: 'The Final Battle · 兄妹宿命与人类命运',
        isTutorial: false,
        themeColor: 0xf43f5e,
        recommendedLv: 5,
        briefing: '【TCTF 战术档案 #14】巨型大气转换转换器顶层，暴风雨与雷鸣中，完全觉醒的鬼神穆罗与麦玉展开终极对决。世界命运在此一役。',
        zones: [
            {
                title: '区域 1/3：大气转换器狂风下层管道',
                speaker: 'SHINATAMA',
                dialogue: '雷暴正在天台肆虐！穆罗已经启动了转换器，这是最后的防线！',
                playerStartX: -22.0,
                gateX: -6.0,
                enemy: { name: 'SUMMIT STALKER', archetype: 'BLACK_OPS', x: -14.0, z: -1.0, level: 'normal', maxHp: 52, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 120, isAlerted: false, canTriggerAlarm: true, patrolMinX: -17.0, patrolMaxX: -12.0 },
                extraEnemies: [
                    { id: 'ch14_fury_1', name: 'STORM FURY', archetype: 'FURY', x: -9.5, z: 2.0, maxHp: 48, weapon: null, hypo: 0, level: 'normal', expReward: 85, patrolMinX: -11.5, patrolMaxX: -7.5, isAlerted: false }
                ],
                alarmConsolePos: { x: -12.5, z: -4.0, label: '🚨 顶层风暴警报' },
                reinforcements: [
                    { id: 'ch14_reinf_1', name: 'STORM ENFORCER', archetype: 'STRIKER', x: -6.5, z: 0.0, maxHp: 45, weapon: 'TCTF_PISTOL', hypo: 0, expReward: 80 }
                ],
                obstacles: [
                    { id: 'ch14_vent_1', minX: -17.5, maxX: -15.0, minZ: -3.5, maxZ: -1.5, height: 3.2, blocksProjectiles: true, label: '📦 狂风排气导管' }
                ],
                props: [
                    { type: 'MEDKIT_CRATE', x: -19.0, z: -3.0, label: '💉 医疗补给箱' }
                ],
                requireConsoleHack: true,
                consolePos: { x: -7.0, z: -3.0, label: '💻 天台安全阻断终端' },
                consoleDiary: { title: '人类命运终章', author: '大气转换器自检', text: '转换器释放的道弹气体将剥夺所有未变异人类的呼吸机能。唯有道弹宿主能在新世界生存。' }
            },
            {
                title: '区域 2/3：转换器回廊 · 穆罗宿卫死士',
                speaker: 'KONOKO (麦玉)',
                dialogue: '穆罗，你的野心在今夜彻底化为灰烬！品玉、克尔博士、整个世界……我都将守护到底！',
                gateX: 14.0,
                enemy: { name: 'APEX TANKER', archetype: 'TANKER', x: 3.5, z: 0.0, level: 'normal', maxHp: 115, weapon: 'SCRAM_CANNON', hypo: 1, expReward: 170, isAlerted: false, patrolMinX: 1.5, patrolMaxX: 5.5 },
                extraEnemies: [
                    { id: 'ch14_sniper_2', name: 'APEX SNIPER', archetype: 'SNIPER', x: 8.5, z: -2.5, maxHp: 38, weapon: 'MERCURY_BOW', hypo: 0, level: 'normal', expReward: 95, isAlerted: false, patrolMinX: 6.5, patrolMaxX: 10.5 }
                ],
                obstacles: [
                    { id: 'ch14_pillar_2', minX: 1.5, maxX: 4.0, minZ: 1.5, maxZ: 3.5, height: 3.2, blocksProjectiles: true, label: '📦 大气催化反应柱' }
                ],
                props: [
                    { type: 'SHIELD_CELL', x: 6.0, z: 2.5, label: '🛡️ 黄金超载能量核' }
                ],
                requireConsoleHack: true,
                consolePos: { x: 12.5, z: -3.0, label: '💻 巨型转换核心解密终端' },
                consoleDiary: { title: '兄妹宿命的誓约', author: '麦玉 (Konoko)', text: '如果必须用战斗来拯救世界，那么来吧，我的哥哥。道弹蛹将在破晓中迎来真正的进化。' }
            },
            {
                title: '最终区域：FINAL SHOWDOWN · 鬼神穆罗 (AWAKENED MURO)',
                speaker: 'MURO (穆罗)',
                titleBanner: 'FINAL BATTLE: AWAKENED MURO',
                dialogue: '「看看这闪电与风暴，麦玉！只有强者才有资格统领新人类！拿出你体内全部的道弹力量吧！」—— 彻底击败完全觉醒的穆罗！',
                isBoss: true,
                enemy: {
                    name: 'FINAL BOSS: AWAKENED MURO (完全体穆罗)',
                    archetype: 'TANKER',
                    x: 24.0,
                    z: 0.0,
                    level: 'hard',
                    maxHp: 220,
                    weapon: 'SCRAM_CANNON',
                    hypo: 2,
                    daodanStage: 3,
                    expReward: 500
                },
                extraEnemies: [
                    { id: 'ch14_apex_guard', name: 'APEX ROYAL ASSASSIN', archetype: 'BLACK_OPS', x: 21.0, z: 2.8, maxHp: 55, weapon: 'MERCURY_BOW', hypo: 1, level: 'hard', expReward: 110 }
                ],
                props: [
                    { type: 'WEAPON_CRATE', weaponType: 'MERCURY_BOW', x: 18.0, z: -3.0, label: '🔫 水银狙击弩' },
                    { type: 'MEDKIT_CRATE', x: 28.5, z: 0.0, label: '💉 战术医疗箱' }
                ],
                requireConsoleHack: false
            }
        ]
    }
];

const STORAGE_KEY = 'oni_rpg_save_v1';

// ---------------------------------------------------------------------------------------------
// Chapter order & locations follow the original Oni (2001). Text below is our own short
// mission copy (not the original script); enemy rosters are this game's own balance.
// ---------------------------------------------------------------------------------------------
const CHAPTER_STORY = {
    ch1: { name: '试炼 · 辛迪加仓库', subtitle: 'Ch.1 Trial Run · Syndicate Warehouse', themeColor: 0x38bdf8,
        briefing: '首个外勤任务：潜入辛迪加走私仓库，查明失联特工的下落。',
        zones: ['集装箱迷宫', '装卸长廊', '仓库深处 · 守卫队长'], boss: 'BOSS: 仓库守卫队长' },
    ch2: { name: '邪恶引擎 · 武藏工厂', subtitle: 'Ch.2 Engines of Evil · Musashi Manufacturing', themeColor: 0xf59e0b,
        briefing: '线索指向武藏制造厂。沿装配线推进，找到工厂的控制中枢。',
        zones: ['装配线车间', '冲压机区', '熔炉控制室 · 工厂监工'], boss: 'BOSS: 工厂监工' },
    ch3: { name: '拼图碎片 · 生物研究所', subtitle: 'Ch.3 Puzzle Pieces · Bio-Research Lab', themeColor: 0x10b981,
        briefing: '生物研究所里藏着道弹实验的记录。穿过玻璃隔间，小心巴拉巴斯。',
        zones: ['隔离走廊', '标本实验室', '主实验大厅 · 巴拉巴斯'], boss: 'BOSS: BARABAS (巴拉巴斯)' },
    ch4: { name: '骑虎难下 · 万山区域机场', subtitle: 'Ch.4 Tiger by the Tail · Vansam Regional Airport', themeColor: 0x60a5fa,
        briefing: '穆罗的人在机场出现。航站楼空旷，注意远处的枪手。',
        zones: ['值机大厅', '候机区', '行李提取区 · 辛迪加精英'], boss: 'BOSS: 机场突击队长' },
    ch5: { name: '紧追不舍 · 机场货运机库', subtitle: 'Ch.5 Hot Pursuit · Airport Cargo Hangars', themeColor: 0x94a3b8,
        briefing: '目标正前往货运机库。在起飞前追上货机。',
        zones: ['货箱堆场', '维修机库', '货机停机坪 · 机库守卫'], boss: 'BOSS: 机库守卫长' },
    ch6: { name: '反击 · TCTF 总部', subtitle: 'Ch.6 Counterattack · TCTF Headquarters', themeColor: 0x22d3ee,
        briefing: '辛迪加突袭 TCTF 总部。穿过办公层击退入侵者，巴拉巴斯再次出现。',
        zones: ['办公区', '指挥层', '中庭 · 巴拉巴斯'], boss: 'BOSS: BARABAS (巴拉巴斯)' },
    ch7: { name: '患难之交 · 大气转换中心', subtitle: 'Ch.7 A Friend in Need · Atmospheric Conversion Center', themeColor: 0x2dd4bf,
        briefing: '违抗命令，独自前往大气转换中心营救品玉。',
        zones: ['处理塔外环', '管道区', '主处理器 · 辛迪加精英'], boss: 'BOSS: 中心警备队长' },
    ch8: { name: '无辜之命 · 大气转换中心深处', subtitle: 'Ch.8 An Innocent Life · ACC Inner Works', themeColor: 0x14b8a6,
        briefing: '深入转换中心的机械层。昔日的同伴正在追捕你。',
        zones: ['狭窄维修通道', '机械层', '核心平台 · 追兵'], boss: 'BOSS: TCTF 追捕小队长' },
    ch9: { name: '真相与代价 · 州政府大楼', subtitle: 'Ch.9 Truth and Consequences · Regional State Building', themeColor: 0xe2e8f0,
        briefing: '关于你过去的资料藏在州政府大楼。忍者百足也盯上了它。',
        zones: ['大理石回廊', '档案馆', '中央大厅 · 百足'], boss: 'BOSS: MUKADE (百足)' },
    ch10: { name: '猫鼠游戏 · 城市天台', subtitle: 'Ch.10 Cat and Mouse · Rooftops', themeColor: 0x818cf8,
        briefing: '百足带着数据盘逃上屋顶。在雨中追上他，夺回数据盘。',
        zones: ['水塔屋顶', '空调机组区', '高楼边缘 · 百足'], boss: 'BOSS: MUKADE (百足)' },
    ch11: { name: '潜梦者 · 长谷川博士实验室', subtitle: "Ch.11 Dream Diver · Dr. Hasegawa's Lab", themeColor: 0xc084fc,
        briefing: '在父亲留下的实验室里，你被拉进一场梦境。',
        zones: ['梦境入口', '漂浮石阵', '梦境深处 · 心魔'], boss: 'BOSS: 梦境之影' },
    ch12: { name: '父之罪 · 科学监狱 112', subtitle: 'Ch.12 Sins of the Father · TCTF Science Prison #112', themeColor: 0xfb7185,
        briefing: '克尔博士被关押在 TCTF 第 112 号科学监狱。突破牢房区找到他。',
        zones: ['牢房走廊', '守卫岗', '特别监区 · 典狱长'], boss: 'BOSS: 监狱典狱长' },
    ch13: { name: '凤凰涅槃 · 强攻 TCTF 总部', subtitle: 'Ch.13 Phoenix Rising · TCTF Headquarters', themeColor: 0xfacc15,
        briefing: '强攻 TCTF 总部，穿过机房和安检口，直抵欧米伽金库。',
        zones: ['服务器机房', '安检口', '欧米伽金库 · 金库守卫'], boss: 'BOSS: 金库守卫' },
    ch14: { name: '蛹之黎明 · 辛迪加山地要塞', subtitle: 'Ch.14 Dawn of the Chrysalis · Syndicate Mountain Compound', themeColor: 0xef4444,
        briefing: '最后的战场：穆罗的雪山要塞。',
        zones: ['雪原外围', '碉堡防线', '要塞核心 · 穆罗'], boss: 'BOSS: MURO (穆罗)' }
};

(function applyOriginalChapterOrder() {
    for (const ch of CAMPAIGN_CHAPTERS) {
        const story = CHAPTER_STORY[ch.id];
        if (!story || !Array.isArray(ch.zones)) continue;
        ch.name = story.name;
        ch.subtitle = story.subtitle;
        ch.themeColor = story.themeColor;
        ch.briefing = story.briefing;
        ch.zones = ch.zones.map((zone, i) => {
            const z = { ...zone };
            const total = ch.zones.length;
            z.title = `区域 ${i + 1}/${total}：${story.zones[i] || z.title}`;
            if (z.isBoss && z.enemy) {
                z.enemy = { ...z.enemy, name: story.boss };
                z.speaker = story.boss.replace(/^BOSS:\s*/, '');
                z.dialogue = `「${story.zones[i] || ''}」—— 击败${z.speaker}和他的部下！`;
            } else {
                z.speaker = 'SHINATAMA';
                z.dialogue = i === 0
                    ? `${story.briefing} 先清理${story.zones[i]}的守卫，再黑入终端打开安全门。`
                    : `已进入${story.zones[i]}。消灭守卫，黑入终端前往下一区域。`;
            }
            if (z.consoleDiary) {
                z.consoleDiary = { title: `${ch.code} ${story.zones[i]} · 终端记录`, author: '截获数据', text: story.briefing };
            }
            return LEVEL_LAYOUTS[ch.id] ? anchorZone(z, LEVEL_LAYOUTS[ch.id]) : z;
        });
    }
})();

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

        // 🚨 Dynamic Alarm & Reinforcements Engine State
        this.alarmActive = false;
        this.alarmAverted = false;

        // HUD Banner State
        this.commsState = {
            visible: false,
            speaker: 'SHINATAMA',
            speakerCode: 'SLD-044',
            frequency: '140.85 MHz',
            channel: 'TCTF NEURAL-LINK',
            title: '',
            text: '',
            progressText: '',
            highlightBtn: null,
            objectiveHint: '',
            diary: null
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

    /**
     * Campaign move set follows the original Oni: specials are learned chapter by chapter
     * (MOVE_CHAPTER_UNLOCK). RPG levels only raise stats, except the non-original Daodan Surge (Lv.5).
     */
    getUnlockedMoveList(upToLevel = this.rpg.level, chapterIndex = this.getActiveChapterIndex()) {
        const set = new Set();
        for (const id of Object.keys(MOVES)) {
            const gate = MOVE_CHAPTER_UNLOCK[id];
            if (gate !== undefined && gate > chapterIndex) continue;
            if (id === 'DAODAN_SURGE' && upToLevel < 5) continue;
            set.add(id);
        }
        return set;
    }

    getActiveChapterIndex() {
        const ch = CAMPAIGN_CHAPTERS.find((c) => c.id === this.activeChapterId);
        return ch ? ch.index : 0;
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
                fighter.canSteppingDisarm = this.getActiveChapterIndex() >= STEPPING_DISARM_CHAPTER;
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
        this.activeLevel = null;
        CollisionSystem.setStageType('INDOOR_FLAT');
        CollisionSystem.setCustomBounds(null);
        CollisionSystem.clearObstacles();
        this.sim.clearExtraEnemies();
        this.mode = 'TUTORIAL';
        this.activeChapterId = 'ch0';
        this.tutorialStageIdx = 0;
        this.tutorialProgress = 0;
        this.tutorialCompleteTimer = 0;
        this.tutorialCompleted = false;
        this.interactables = [];

        this.sim.survivalMode = false;
        this.sim.reset();
        this.sim.campaignMode = false;
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
        // Campaign maps are long continuous sectors (x -28..38); the small-arena ROOFTOP ledge/abyss
        // physics (|x| <= 9.8) would drop Konoko into the void at spawn. Rooftop chapters are themed
        // visually only (see game.js ROOFTOP_CAMPAIGN), physics stays flat.
        CollisionSystem.setStageType('INDOOR_FLAT');
        // Each chapter has its own map (LevelLayouts); width varies per location
        this.activeLevel = buildLevel(chapter.id, chapter.zones);
        CollisionSystem.setCustomBounds(this.activeLevel ? this.activeLevel.bounds : { minX: -28.0, maxX: 38.0, minZ: -9.0, maxZ: 9.0 });
        this.mode = 'CAMPAIGN';
        this.activeChapterId = chapter.id;
        this.zoneIndex = 0;
        this.alarmActive = false;
        this.alarmAverted = false;
        this.sim.survivalMode = false;
        this.sim.reset();
        if (typeof this.sim.setCampaignMode === 'function') {
            this.sim.setCampaignMode(true);
        } else {
            this.sim.campaignMode = true;
        }
        this.applyRpgStatsToPlayer(this.sim.f1, true);
        this.sim.f1.name = `KONOKO (Lv.${this.rpg.level})`;
        this.setupCampaignZone(chapter, 0, true);
    }

    triggerAlarm(sourceBot) {
        if (this.alarmActive) return;
        this.alarmActive = true;
        this.alarmAverted = false;

        const chapter = CAMPAIGN_CHAPTERS.find((c) => c.id === this.activeChapterId);
        const zone = chapter ? chapter.zones[this.zoneIndex] : null;

        for (let i = 0; i < this.interactables.length; i++) {
            if (this.interactables[i].type === 'ALARM_CONSOLE') {
                this.interactables[i].alarmTriggered = true;
            }
        }

        if (this.sim && Array.isArray(this.sim.events)) {
            this.sim.events.push({
                type: 'ALARM_TRIGGERED',
                source: sourceBot ? sourceBot.name : 'SENTRY',
                x: sourceBot ? sourceBot.x : 0,
                z: sourceBot ? sourceBot.z : 0
            });
        }

        if (zone && Array.isArray(zone.reinforcements) && this.sim) {
            this.sim.spawnReinforcements(zone.reinforcements);
        }

        if (this.commsState) {
            this.commsState.title = '🚨 警报大作！辛迪加武装增援正在赶来！';
            this.commsState.text = '警报控制台被拍响了！哨兵呼叫了战术突击增援，注意防范侧翼围攻并黑入控制台关闭警报！';
            this.commsState.objectiveHint = '消灭增援敌人并黑入控制台关闭警报！';
        }
    }

    interceptAlarm(sourceBot) {
        if (this.alarmActive || this.alarmAverted) return;
        this.alarmAverted = true;
        this.addExp(60, this.sim ? this.sim.events : null);
        if (this.sim && Array.isArray(this.sim.events)) {
            this.sim.events.push({
                type: 'ALARM_AVERTED',
                source: sourceBot ? sourceBot.name : 'SENTRY',
                text: 'ALARM INTERCEPTED! 成功拦截哨兵 (+60 EXP)',
                exp: 60
            });
        }
        if (this.commsState) {
            this.commsState.title = '🎯 战术拦截！成功在哨兵拍响警报前将其制伏！';
            this.commsState.text = '干得漂亮，麦玉！在警报传达到辛迪加增援指挥所前完成了拦截！';
            this.commsState.objectiveHint = '已成功挫败报警企图，继续推进肃清区域敌军！';
        }
    }

    disableAlarm(tickEvents) {
        if (!this.alarmActive) return;
        this.alarmActive = false;
        for (let i = 0; i < this.interactables.length; i++) {
            if (this.interactables[i].type === 'ALARM_CONSOLE') {
                this.interactables[i].alarmTriggered = false;
            }
        }
        this.addExp(40, tickEvents);
        if (tickEvents) {
            tickEvents.push({
                type: 'ALARM_DISABLED',
                text: 'ALARM OVERRIDDEN! 警报已切断 (+40 EXP)'
            });
        }
        if (this.commsState) {
            this.commsState.title = '✅ 警报已成功切断！';
            this.commsState.text = '控制台警报已被手动切断，后续武装增援停止入场！';
        }
    }

    isAlarmTriggered() {
        return this.alarmActive;
    }

    startBossCinematic(zone) {
        this.cinematic = {
            active: true,
            bossName: zone.speaker || zone.enemy.name,
            bossTitle: zone.title || 'BOSS SHOWDOWN',
            dialogue: zone.dialogue,
            typedText: '',
            typeIndex: 0,
            frame: 0,
            totalFrames: 160,
            canSkip: true
        };
        if (this.sim && Array.isArray(this.sim.events)) {
            this.sim.events.push({
                type: 'BOSS_CINEMATIC_START',
                bossName: this.cinematic.bossName,
                dialogue: zone.dialogue
            });
        }
    }

    skipBossCinematic() {
        if (!this.cinematic || !this.cinematic.active) return;
        this.cinematic.active = false;
        if (this.sim && Array.isArray(this.sim.events)) {
            this.sim.events.push({
                type: 'BOSS_ENGAGE',
                bossName: this.cinematic.bossName
            });
        }
        if (this.commsState) {
            this.commsState.text = this.cinematic.dialogue;
            this.commsState.objectiveHint = `消灭 ${this.cinematic.bossName}！`;
        }
    }

    getCurrentChapter() {
        return CAMPAIGN_CHAPTERS.find((c) => c.id === this.activeChapterId) || CAMPAIGN_CHAPTERS[1];
    }

    getCurrentZone() {
        const ch = this.getCurrentChapter();
        return (ch && Array.isArray(ch.zones)) ? ch.zones[this.zoneIndex] : null;
    }

    setupCampaignZone(chapter, zoneIdx, isInitial = false) {
        this.zoneIndex = zoneIdx;
        this.zoneCleared = false;
        this.zoneTransitionTimer = 0;
        this.interactables = [];
        this.alarmActive = false;
        this.alarmAverted = false;

        const curChapter = chapter || this.getCurrentChapter();
        const zone = (curChapter.zones && curChapter.zones[zoneIdx]) ? curChapter.zones[zoneIdx] : {
            title: `${curChapter.code} 战术潜入行动`,
            speaker: 'SHINATAMA',
            dialogue: curChapter.briefing || `Konoko，正在执行 ${curChapter.name} 任务！肃清区域内所有辛迪加守军！`,
            playerStartX: -14.0,
            gateX: 10.0,
            enemy: {
                name: 'SYNDICATE ENFORCER (特遣精锐)',
                archetype: 'TANKER',
                x: 4.0,
                z: 0.0,
                level: 'normal',
                maxHp: 160,
                weapon: 'SCRAM_CANNON',
                hypo: 1,
                expReward: 120
            },
            props: [
                { type: 'MEDKIT_CRATE', x: -2.0, z: -2.5, label: '💉 战术医疗箱' },
                { type: 'WEAPON_CRATE', weaponType: 'MERCURY_BOW', x: 2.0, z: 2.5, label: '🔫 水银穿甲弩' }
            ],
            requireConsoleHack: false
        };

        // Clear leftover dropped weapons & projectiles
        for (const w of this.sim.getWeapons()) {
            this.sim.removeEntity(w.id);
        }
        for (const p of this.sim.getProjectiles()) {
            this.sim.removeEntity(p.id);
        }

        // Setup unified chapter obstacles across all sectors (including security laser gates)
        CollisionSystem.clearObstacles();
        const sectorObstacles = [];
        const level = (this.activeLevel && this.activeLevel.chapterId === chapter.id) ? this.activeLevel : null;
        if (level) {
            for (const obs of level.obstacles) sectorObstacles.push({ ...obs, active: true });
        }
        if (Array.isArray(chapter.zones)) {
            for (let z = 0; z < chapter.zones.length; z++) {
                const zData = chapter.zones[z];
                if (!level && Array.isArray(zData.obstacles)) {
                    for (const obs of zData.obstacles) {
                        sectorObstacles.push({ ...obs, active: true });
                    }
                }
                if (zData.requireConsoleHack && zData.gateX !== undefined) {
                    const gx = zData.gateX;
                    const isPassed = z < zoneIdx;
                    sectorObstacles.push({
                        id: `gate_obs_${chapter.id}_${z}`,
                        minX: gx - 0.25,
                        maxX: gx + 0.25,
                        minZ: -3.5,
                        maxZ: 3.5,
                        height: 3.5,
                        blocksProjectiles: true,
                        isGate: true,
                        gateZoneIndex: z,
                        active: !isPassed
                    });
                }
            }
        }
        CollisionSystem.setObstacles(sectorObstacles);

        // Clear and spawn squad enemies for this sector
        this.sim.clearExtraEnemies();
        if (Array.isArray(zone.extraEnemies)) {
            for (const cfg of zone.extraEnemies) {
                this.sim.spawnExtraEnemy(cfg);
            }
        }

        // Fighter placement: Only reset player position on INITIAL chapter start!
        // On zone transitions, player physically walks through the gate into the sector!
        const f1 = this.sim.f1;
        const f2 = this.sim.f2;
        if (isInitial) {
            f1.x = zone.playerStartX !== undefined ? zone.playerStartX : -12.0;
            f1.y = 0;
            f1.z = level ? pathZ(level.path, f1.x) : 0;
            f1.vx = 0;
            f1.vy = 0;
            f1.vz = 0;
            f1.facing = 1;
            f1.transitionTo(FIGHTER_STATE.IDLE);
        } else {
            f1.facing = 1;
            f1.transitionTo(FIGHTER_STATE.IDLE);
        }

        // Setup primary sector enemy (f2)
        const preset = (this.sim && this.sim.difficulty && DIFFICULTY_PRESETS[this.sim.difficulty]) || DIFFICULTY_PRESETS.easy;
        const enemyX = zone.enemy.x !== undefined ? zone.enemy.x : (f1.x + 6.0);
        const enemyZ = zone.enemy.z !== undefined ? zone.enemy.z : 0;
        f2.reset(enemyX, -1);
        f2.z = enemyZ;
        f2.archetype = zone.enemy.archetype || 'STRIKER';
        f2.isMinion = !zone.isBoss;
        f2.name = zone.enemy.name;
        const baseHp = zone.enemy.maxHp || 42;
        f2.maxHp = baseHp;
        f2.hp = f2.maxHp;
        f2.maxPoise = zone.isBoss ? 135 : (f2.archetype === 'TANKER' ? 110 : 38);
        f2.poise = f2.maxPoise;
        f2.speedScale = (zone.enemy.speedScale || 1.0) * preset.enemySpeedMult;
        f2.maxHypo = zone.enemy.hypo || 0;
        f2.hypoCount = zone.enemy.hypo || 0;
        f2.aiProfileLevel = zone.enemy.level || (preset.id === 'easy' ? 'easy' : 'normal');
        f2.isAlerted = zone.enemy.isAlerted !== undefined ? zone.enemy.isAlerted : false;
        f2.patrolMinX = zone.enemy.patrolMinX;
        f2.patrolMaxX = zone.enemy.patrolMaxX;
        f2.canTriggerAlarm = zone.enemy.canTriggerAlarm !== undefined ? zone.enemy.canTriggerAlarm : false;
        f2.hasTriggeredAlarm = false;
        f2.isRunningToAlarm = false;
        if (zone.enemy.daodanStage) {
            f2.daodanStage = zone.enemy.daodanStage;
            f2.daodanMeter = 80;
        }
        if (zone.enemy.weapon) {
            f2.equipWeapon({ type: zone.enemy.weapon, id: `wpn_${chapter.id}_z${zoneIdx}` });
        } else {
            f2.unequipWeapon();
        }

        this.sim.roundTimer = -1; // Authentic Oni: no countdown timer in story campaign zones
        this.sim.isMatchOver = false;
        this.sim.winner = null;

        // Spawn interactive props (Medkits, Weapon Crates, Shield Cells, Terminal Console, Gate)
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
        if (zone.alarmConsolePos) {
            this.interactables.push({
                id: `alarm_console_${chapter.id}_${zoneIdx}`,
                type: 'ALARM_CONSOLE',
                zoneIndex: zoneIdx,
                x: zone.alarmConsolePos.x,
                y: 0,
                z: zone.alarmConsolePos.z,
                label: zone.alarmConsolePos.label || '🚨 警报控制台',
                active: true,
                alarmTriggered: false
            });
        }
        if (zone.requireConsoleHack && zone.consolePos) {
            this.interactables.push({
                id: `console_${chapter.id}_${zoneIdx}`,
                type: 'CONSOLE',
                zoneIndex: zoneIdx,
                x: zone.consolePos.x,
                y: 0,
                z: zone.consolePos.z,
                label: zone.consolePos.label || '💻 战术终端',
                active: true,
                hacked: false
            });
            const gx = zone.gateX !== undefined ? zone.gateX : (zone.consolePos.x + 0.8);
            this.interactables.push({
                id: `gate_${chapter.id}_${zoneIdx}`,
                type: 'SECURITY_GATE',
                zoneIndex: zoneIdx,
                x: gx,
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
            speakerCode: 'SLD-044',
            frequency: '140.85 MHz',
            channel: 'TCTF NEURAL-LINK',
            title: `📖 ${chapter.code} ${chapter.name} · ${zone.title}`,
            text: zone.dialogue,
            progressText: `Lv.${this.rpg.level} (${this.rpg.exp} EXP)`,
            highlightBtn: null,
            objectiveHint: zone.requireConsoleHack ? '目标：击败守卫并靠近 💻终端 解锁通道' : '目标：击败区域守卫',
            diary: null
        };

        // P3 Boss Cinematic Cutscene trigger on boss encounters
        if (zone.isBoss) {
            this.startBossCinematic(zone);
        }
    }

    disableCampaign() {
        this.activeLevel = null;
        CollisionSystem.setStageType('ROOFTOP');
        CollisionSystem.setCustomBounds(null);
        CollisionSystem.clearObstacles();
        this.sim.clearExtraEnemies();
        this.sim.campaignMode = false;
        this.sim.f2.isMinion = false;
        this.mode = 'VERSUS';
        this.interactables = [];
        this.commsState.visible = false;
        if (this.cinematic) this.cinematic.active = false;
        this.applyRpgStatsToPlayer(this.sim.f1, false);
    }

    // =========================================================================
    // Per-Tick Update & Bot Override for Tutorial / Campaign
    // =========================================================================

    getCurrentZone() {
        const chapter = CAMPAIGN_CHAPTERS.find((c) => c.id === this.activeChapterId);
        return (chapter && Array.isArray(chapter.zones)) ? chapter.zones[this.zoneIndex] : null;
    }

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

        // P3 Boss Cinematic Playback (freezes combat ticks while typewriter dialogue runs)
        if (this.cinematic && this.cinematic.active) {
            this.cinematic.frame++;
            if (this.cinematic.frame % 2 === 0 && this.cinematic.typeIndex < this.cinematic.dialogue.length) {
                this.cinematic.typeIndex++;
                this.cinematic.typedText = this.cinematic.dialogue.substring(0, this.cinematic.typeIndex);
            }
            if (this.cinematic.frame >= this.cinematic.totalFrames) {
                this.skipBossCinematic();
            }
            return;
        }

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
            } else if (item.type === 'ALARM_CONSOLE' && this.alarmActive) {
                // Konoko approaches tripped alarm console to disable subsequent reinforcements
                if (dist <= 1.8 && (p1Input.action || (dist <= 1.4 && (p1Input.punch || p1Input.fire)))) {
                    this.disableAlarm(tickEvents);
                }
            } else if (item.type === 'CONSOLE' && !item.hacked) {
                // Hack console when player presses Action (E), Punch/Fire, or walks up after zone is cleared
                if (dist <= 1.8 && (p1Input.action || p1Input.punch || p1Input.fire || (this.zoneCleared && dist <= 1.25))) {
                    item.hacked = true;
                    this.consoleHacked = true;
                    this.addExp(30, tickEvents);
                    for (const g of this.interactables) {
                        if (g.type === 'SECURITY_GATE' && (g.zoneIndex === undefined || g.zoneIndex === this.zoneIndex)) {
                            g.unlocked = true;
                        }
                    }
                    if (CollisionSystem.obstacles) {
                        for (const obs of CollisionSystem.obstacles) {
                            if (obs.isGate && (obs.gateZoneIndex === undefined || obs.gateZoneIndex === this.zoneIndex)) {
                                obs.active = false;
                            }
                        }
                    }
                    const currentZone = this.getCurrentZone();
                    const diary = (currentZone && currentZone.consoleDiary) ? currentZone.consoleDiary : null;
                    if (this.commsState && diary) {
                        this.commsState.diary = diary;
                    }
                    tickEvents.push({
                        type: 'CONSOLE_HACKED',
                        text: 'CONSOLE HACKED! 安全门已解锁 (+30 EXP)',
                        diary,
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

        // 3. Intercept enemy defeat in multi-zone chapters (must defeat all enemies in the sector!)
        const enemies = this.sim.getEnemies();
        const allEnemiesDefeated = enemies.length > 0 && enemies.every((e) => e.hp <= 0);

        // If primary boss/sentry is down but extra squad/reinforcement enemies remain, advise player
        if (f2.hp <= 0 && !allEnemiesDefeated && !this.zoneCleared) {
            const aliveCount = enemies.filter((e) => e.hp > 0).length;
            if (this.sim.currentFrame % 90 === 0) {
                this.commsState.objectiveHint = `消灭剩余敌军 (${aliveCount} 名敌人剩余)`;
            }
        }

        if (allEnemiesDefeated && !this.zoneCleared) {
            this.zoneCleared = true;

            // Stealth reward: If zone had an alarm console and player neutralized sentry before alarm tripped
            if (zone.alarmConsolePos && !this.alarmActive && !this.alarmAverted) {
                this.alarmAverted = true;
                this.addExp(60, tickEvents);
                tickEvents.push({
                    type: 'ALARM_AVERTED',
                    text: '🚨 STEALTH SUCCESS: 警报已成功遏制！(+60 EXP)'
                });
            }

            let totalExp = zone.enemy.expReward || 80;
            if (Array.isArray(zone.extraEnemies)) {
                for (const ee of zone.extraEnemies) totalExp += (ee.expReward || 45);
            }
            this.addExp(totalExp, tickEvents);

            const isLastZone = this.zoneIndex >= chapter.zones.length - 1;
            if (!isLastZone) {
                // Prevent Simulation from ending the match on intermediate zones!
                this.sim.isMatchOver = false;
                this.sim.winner = null;
                f1.transitionTo(FIGHTER_STATE.IDLE);
                for (let k = 0; k < enemies.length; k++) {
                    enemies[k].hp = 0;
                    enemies[k].transitionTo(FIGHTER_STATE.DEFEAT);
                }

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
                    if (CollisionSystem.obstacles) {
                        for (const obs of CollisionSystem.obstacles) {
                            if (obs.isGate && (obs.gateZoneIndex === undefined || obs.gateZoneIndex === this.zoneIndex)) {
                                obs.active = false;
                            }
                        }
                    }
                    this.zoneTransitionTimer = 85;
                    this.commsState.text = '区域守军肃清！安全门已开启，正在推进至下一区域……';
                    this.commsState.objectiveHint = '区域完成！穿过安全门推进';
                } else {
                    this.commsState.text = '区域守军已肃清！请前往发光的 💻战术终端 骇入门禁解除激光网！';
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
                this.sim.declareWinner('p1');
            }
        }

        // If zone was already cleared and player just hacked the console, unlock gate and set transition message
        if (this.zoneCleared && this.consoleHacked && this.zoneTransitionTimer === 0 && this.zoneIndex < chapter.zones.length - 1) {
            if (CollisionSystem.obstacles) {
                for (const obs of CollisionSystem.obstacles) {
                    if (obs.isGate && (obs.gateZoneIndex === undefined || obs.gateZoneIndex === this.zoneIndex)) {
                        obs.active = false;
                    }
                }
            }
            this.zoneTransitionTimer = 90;
            this.commsState.text = '终端门禁已骇入！安全门已开启，穿过大门推进至下一区域！';
            this.commsState.objectiveHint = '目标：穿过安全大门';
        }

        // P1 Sector Transition: player physically runs through the open security gate OR fallback timer expires
        const currentGateX = (zone && zone.gateX !== undefined) ? zone.gateX : (this.zoneIndex === 0 ? -2.0 : 10.0);
        const playerCrossedGate = f1.x >= (currentGateX - 0.2);

        if (!this.zoneCleared && playerCrossedGate && this.sim.currentFrame % 90 === 0) {
            tickEvents.push({
                type: 'CLEAR_REQUIRED',
                text: '⚠️ 必须消灭区域内所有守军方可推进至下一战区！'
            });
        }

        if (this.zoneCleared && this.consoleHacked && this.zoneIndex + 1 < chapter.zones.length) {
            if (playerCrossedGate || this.zoneTransitionTimer === 1) {
                this.zoneTransitionTimer = 0;
                this.setupCampaignZone(chapter, this.zoneIndex + 1, false);
                tickEvents.push({
                    type: 'ZONE_ADVANCE',
                    zoneIndex: this.zoneIndex + 1,
                    title: chapter.zones[this.zoneIndex].title,
                    enemyLevel: chapter.zones[this.zoneIndex].enemy.level,
                    isBoss: !!chapter.zones[this.zoneIndex].isBoss
                });
                return;
            }
        }

        if (this.zoneTransitionTimer > 1) {
            this.zoneTransitionTimer--;
        }
    }
}
