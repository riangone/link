# Oni 复刻 —— Gemini (Hyperion) 分析与系统实现提案

> 范围：深入分析 `client/oni/`（game.js、src/core/*、src/render/*、index.html）与 `tests/unit/oni-*.test.js`。
> 原则：本轮【只做分析与提案，禁止修改任何现有工程代码】。
> 约束：玩法机制、操作手感、战斗系统与关卡结构尽可能忠实 Bungie 2001 原作《Oni》；外观、贴图、音效、音乐与关卡美术采用原创设计，严禁提取或照搬原作资产。

---

## 0. 现状核心根因诊断

现有版本经过多轮迭代，功能要素虽多但手感与体验始终“不对味”，其本质根因在于**底层架构的设计意图发生根本性错位**：
1. **游戏类型错位（格斗底座 vs 动作冒险）**：底层沿用 1v1 街机格斗底座（`f1/f2`、顶盘双人格斗血条、99/120秒倒计时、KO 判负横幅、RPG 等级/EXP）。战役模式仅将敌人作为额外实体塞入，骨子里依旧是回合制对决，背离了原作无计时、多层关卡自由探索、死了从检查点复活的动作冒险本质。
2. **操控与视界错位（摇杆离散键 vs 越肩鼠标瞄准）**：原作核心是 PC 第三人称越肩射击+近战，鼠标控制偏航与俯仰，WASD 默认按住即跑，以微量组合键驱动全套体术。现状多达十余个离散功能键（独立滑铲/翻滚/格挡/投技/治疗/大招键），且非鼠标锁定时相机自动朝向对手软锁定，完全丧失了 3D 空间游击立回的自由度。
3. **视觉与骨骼姿态错位**：渲染层存在 `CAM_TURN = 0.38`（约 22°）的硬编码侧身偏角，这是为了横版侧视摆造型设计的，一换到越肩视角，角色背影呈现严重的侧身畸变；同时依赖全局冻结时钟（`hitstopFrames`）和磁吸位移（`combatLunge`），导致多敌人战斗严重卡顿且滑步严重。

---

## 1. 现状与原作差距清单（按对“像原作”的影响排序）

### P0：核心玩法框架与操控骨架（决定是不是 Oni）

| # | 维度 | Bungie 2001 原作规范 | 现有工程现状 | 影响评级与代码证据 |
|---|---|---|---|---|
| G1 | **规则与胜负系统** | 关卡式 3D 动作冒险；无回合计时；击败杂兵无顶栏血条；玩家死亡触发检查点复活重来；无经验值 RPG 养成 | 99 秒回合 / 战役区域 120 秒，**超时直接判负**；双人横向血条/韧性条/连击数；RPG Lv1-5 升级数值成长 | **P0** `Simulation.js:1137`、`CampaignManager.js:1962` |
| G2 | **视角与相机追踪** | 纯粹的第三人称肩后越肩视角（Yaw/Pitch 完全跟随鼠标）；遇墙壁或障碍时智能向前推近（防穿模） | 默认侧视/斜视格斗机位；依赖 `midX/midZ` 居中；仅锁定鼠标时部分跟随；骨骼带 `CAM_TURN` 侧身畸变 | **P0** `ThreeScene.js:1197-1244`、`ProceduralFighterMesh.js:17` |
| G3 | **基础操控与移动** | WASD 移动（**按住即为全速奔跑**）；Shift 为慢走（Walk）；Space 跳跃；Ctrl 蹲伏；鼠标左键拳/射击；右键踢；E 动作交互；R 换弹；Q 收放枪 | 十几个离散操作键（J/K/L/U/I/O/R/F/H/Q/E/V/G 等）；靠近敌人 <6m 强制慢走；依赖双击冲刺与独立闪避/滑铲键 | **P0** `game.js:792-870`、`Fighter.js:985-997` |
| G4 | **格挡与攻防立回** | **自动格挡**：不输入攻击、不前推方向且正对攻击者时自动格挡；中上段站立挡，下段蹲伏挡；背后受击必中；**敌我规则绝对平等** | 依赖按住格挡键或后退；小兵被硬编码禁止被动格挡（`!this.isMinion` 剥夺格挡权） | **P0** `Fighter.js:899,951`、`CollisionSystem.js:403-413` |
| G5 | **关卡立体空间** | 三维多层建筑（厂房、挑空大厅、楼梯、斜坡、二层栈道、安全门、控制台、坠落边缘）；按 E 主动交互 | 一维 X 轴单层走廊（x∈[-28, 38]）；走近控制台 1.25m 或出拳/开火**自动黑入**；缺乏真实 Z/Y 轴立体穿插 | **P0** `LevelLayouts.js:1-17`、`CampaignManager.js:2301` |

### P1：战斗系统、资源与敌人生态（决定战斗对不对味）

| # | 维度 | Bungie 2001 原作规范 | 现有工程现状 | 影响评级与代码证据 |
|---|---|---|---|---|
| G6 | **HUD 界面语言** | 左下角经典圆环生命仪（0-100% 动态色弧，100-200% 超载辉光），右下角圆环武器弹药仪，中心动态准星，无敌人血条，F1/Tab 呼出 Datapad | 网页顶部居中横贯街机双人格斗顶栏（HP/韧性/能量/倒计时）；大号连击提示；全屏漂浮街机文字 | **P1** `index.html:36-85`、`style.css` |
| G7 | **枪械与枪斗术** | 约 10 种特色武器（Campbell、Black Thunder、Mercury Bow、Scram Cannon 等）；3D 射线与弹道（带俯仰角可打高低台）；弹匣+备用弹，R 换弹；持枪右键仍可踢；近战可夺枪 | 仅 3 种武器；固定水平发射无俯仰；无换弹机制（打空投掷枪）；靠近枪械按拳误触拾取吞出拳；开枪逻辑误将杂兵绑至 f2 | **P1** `Simulation.js:600-617,645-654`、`Constants.js:194` |
| G8 | **血包与 Daodan** | Hypo-Spray 踩上即用；满血按 E 强行注射进入 **Daodan Overpower**（HP 上限达 200%，全身散发辉光，伤害暴增，随时间衰减）；后期关卡具被动慢速回血 | Hypo 变为背包存货按 H 键使用；道弹被做成 0-100 怒气槽放冲击波（DAODAN_SURGE）；包含非原版的护盾机制 | **P1** `Constants.js:117-137`、`Fighter.js:136-220` |
| G9 | **投技与双人抓取** | 贴身推前+拳/踢触发正摔/踢摔，背后触发折颈/背摔，冲刺出飞摔；受害者精准受身（Ukemi）；投技动作骨骼绝对对位 | 实现了部分招式帧，但缺乏真正的抓取骨骼同步挂载，容易因位移穿模分离；存在非原版的独立抓投按键 | **P1** `Fighter.js:1328-1510` |
| G10 | **敌人 AI 与生态** | 兵种按绿/蓝/红划分（Striker/Comguard/Ninja 等）；具备视锥 FOV 与听觉（脚步/枪声）；主动奔跑拉警报；残血逃跑捡血包；枪兵翻滚射击 | 仅按距离符号逼近；**无视锥无听觉无寻路**，遇障碍卡死；BotBrain 采用静态全局变量管理单攻击令牌，多敌人无法围攻 | **P1** `BotBrain.js:34-43,244` |
| G11 | **打击顿挫与位移** | 严格 Root Motion（位移由动画帧驱动，杜绝滑步）；局部 Hitstop（仅冻结攻防双方 4-8 帧，世界继续流动）；轻/重/吹飞/击倒分级 | 全局时间冻结（`hitstopFrames` 导致整场卡死）；依赖 `combatLunge` 磁吸位移产生滑步；格斗游戏韧性条机制 | **P1** `Simulation.js:438`、`Fighter.js:1644` |

### P2：打磨、氛围与周边模式

- **G12 视觉美术风格**：原作是日式动漫风冷峻低多边形建筑与包豪斯工业极简美学；现状偏向高饱和霓虹赛博天台与高光雨夜。
- **G13 叙事与检查点**：Shinatama 通讯界面、检查点终端存盘与任务简报（Datapad）。
- **G14 现有附加模式隔离**：现有的 1v1 PvP、生存挑战、训练场应保留在“附加竞技模式”中，不得污染战役核心。

---

## 2. 核心系统实现方案

### 2.1 规则系统彻底解耦（新增 `src/core/Rules.js`，重构 `Simulation.js`）
- **核心设计**：定义抽象策略接口 `GameRules { onTick(sim), onFighterDown(f), isGameOver(sim) }`。
  - `OniCampaignRules`：移除计时器限制（`roundTimer = -1`），不渲染敌人血条；小兵 HP 归零触发 `FIGHTER_DOWN` 事件并移除阻挡；玩家死亡派发 `PLAYER_DEAD` 事件供检查点系统复活。
  - `ArenaRules`：接管现有的 99 秒倒计时、双人血条、判定胜负与生存模式波次逻辑。
- **验收标准**：单测验证战役模式运行 600 tick 不发生超时判负；击倒普通小兵不触发胜负结算；玩家死亡派发 `PLAYER_DEAD`。

### 2.2 原作精简操控与状态驱动（新增 `src/input/OniInput.js`，修改 `Fighter.js`）
- **按键架构**：精简为 WASD + 鼠标视角 + Space（跳） + Ctrl（蹲） + Shift（走） + 左键（拳/射击） + 右键（踢） + E（交互） + R（换弹） + Q（收枪）。
- **状态机推导算法**：
  - **默认奔跑**：按住方向键持续 4 帧后直接进入 `RUN`，按住 Shift 强行保持 `WALK`。彻底移除双击冲刺与近身 6m 慢走限制。
  - **组合动作推导**：`RUN + crouch` 触发滑铲（`SLIDE_KICK`）；`CROUCH + 方向` 触发翻滚（`ESCAPE_ROLL`）；`JUMP + 方向` 触发前/后/侧空翻；贴身 + 前 + 拳/踢触发抓投；倒地受击瞬间按 Space 触发受身（`UKEMI`）。
  - 删除 `MOVE_TABLE` 中所有 `special/slide/evade/throw/heal/daodan` 等非原作 button 分支。
- **验收标准**：单测 `oni-controls.test.js`：按住 W 6 帧状态为 `RUN`；W+Shift 为 `WALK`；RUN 中按 C 转化为滑铲；MOVE_TABLE 中合法按键仅限 `{punch, kick}`。

### 2.3 越肩防穿模相机与骨骼去偏（修改 `src/render/ThreeScene.js`、`ProceduralFighterMesh.js`）
- **肩后矩阵解算**：维持恒定肩部视距：`camPos = target + Rot(yaw, pitch) * (0.32, 1.45, -3.2)`。
- **相机防穿模算法（SphereCast Push-In）**：
  - 每帧自角色视线标点向目标相机位置发射半径 0.25m 的球体扫掠；若撞击 `World` 墙体或障碍，顺延撞击点前向推近 `camDist = hitDist - 0.15m`，杜绝视野穿墙穿模。
- **骨骼姿态校正**：将 `CAM_TURN` 强制置零，骨骼朝向严格锁死瞄准偏航角，彻底消除越肩视角下的身体扭曲。
- **验收标准**：Playwright 自动化测试：后退紧贴墙体时，相机到角色距离缩短，画面不被墙体遮蔽。

### 2.4 原版 HUD 罗盘与动态准星（新增 `src/ui/OniHud.js`，修改 `index.html`）
- **HUD 架构**：纯 Canvas/SVG 原生轻量渲染。
  - **左下角生命罗盘**：外环为基础 100 HP（绿→黄→红动态弧线）；内环为 Daodan Overpower 超额辉光刻度（100-200% 平滑衰减指示）。
  - **右下角武器罗盘**：弧形弹匣刻度（当前子弹），中心高亮数字（备用弹药总数），武器线框图标。
  - **中心动态准星**：仅在持枪状态显示，跳跃与奔跑时准星平滑扩散。
  - **战役隐藏街机顶栏**：战役模式彻底隐藏顶部双人格斗血条与倒计时；按 F1/Tab 呼出 Datapad。
- **验收标准**：Playwright 截图校验：战役模式顶栏隐藏，`canvas#oni-hud` 正常呈现双圆环，受到伤害时弧度精准更新。

### 2.5 自动格挡与攻防平权（修改 `Fighter.js`、`CollisionSystem.js`）
- **格挡判定算法**：
  ```js
  const canAutoBlock = (defender.state === FIGHTER_STATE.IDLE || defender.state === FIGHTER_STATE.WALK || defender.state === FIGHTER_STATE.CROUCH)
      && defender.moveFwdInput <= 0 && relativeSector === 'FRONT';
  const isBlock = canAutoBlock && (!hitbox.move.isLow || defender.state === FIGHTER_STATE.CROUCH);
  ```
- **平权原则**：删除 `!this.isMinion` 限制，敌人与玩家共用同一套格挡逻辑，攻击时无法防御，背后受击 100% 破防。
- **验收标准**：单测验证防守方在 IDLE 且正面受击时成功触发格挡；防守方前冲或处于出招硬直中受击必中。

### 2.6 三维立体关卡与世界空间（新增 `src/core/World.js`，迁移 `LevelLayouts.js`）
- **多层数据模型**：
  ```typescript
  interface WorldData {
    floors: Array<{ id: string, minX: number, maxX: number, minZ: number, maxZ: number, y: number }>;
    ramps: Array<{ minX: number, maxX: number, minZ: number, maxZ: number, y0: number, y1: number, axis: 'x'|'z' }>;
    walls: Array<{ minX: number, maxX: number, minZ: number, maxZ: number, minY: number, maxY: number, blocksProjectiles: boolean }>;
    doors: Array<{ id: string, aabb: Box, locked: boolean, unlocksBy: string }>;
    consoles: Array<{ id: string, x: number, y: number, z: number, action: string }>;
    pickups: Array<{ id: string, type: 'HYPO'|'AMMO'|'WEAPON', x: number, y: number, z: number }>;
  }
  ```
- **物理与交互逻辑**：`World.getFloorHeightAt(x, z, yHint)` 根据高度提示取最高合法地面，支持二层挑空栈道与斜坡；控制台必须按 E 键交互，杜绝走近或挥拳误触。
- **验收标准**：单测验证角色走上坡道时 Y 坐标单调递增；高处跌落正常下落；未按 E 键走近控制台不发生黑入。

### 2.7 真实枪斗术与弹药物理（新增 `src/core/Weapons.js`，修改 `Simulation.js`）
- **枪械规格**：实现 Campbell Equalizer、Black Thunder、Mercury Bow 等经典武器；武器具备 `clipAmmo` 与 `reserveAmmo`；按 R 键换弹；射击包含真实 3D 偏航与俯仰光线（Raycast）。
- **交互规范**：武器仅在按 E 键时拾取并丢弃旧枪；弹药箱踩上自动补充；空手出拳不再因地表有枪而被拦截；持枪状态下右键仍可自由出脚踢击。
- **验收标准**：单测验证弹匣打空后必须按 R 换弹；高低差射击测试射线能够命中高台敌人；持枪状态右键成功触发踢击。

### 2.8 敌人感知与战术 AI（新增 `src/core/ai/Perception.js`、`NavGraph.js`，重构 `BotBrain.js`）
- **感知模型**：前方 120° 视锥探测（带射线视线遮挡） + 听觉事件广播（枪声 25m、跑步声 4m、惨叫 10m）；警戒度随时间平滑衰减。
- **寻路与协同**：基于多层网格生成 NavGraph 并执行 A* 寻路；多敌人近战令牌挂载在 `Simulation` 实例上，彻底移除静态全局变量，支持 2-3 名敌人根据波次协同包抄。
- **验收标准**：单测验证视线被墙遮挡时不触发警觉；隔墙开枪立即激发生发听觉警戒；多 Simulation 实例间攻击令牌完全隔离。

### 2.9 局部打击停顿与根运动同步（修改 `Constants.js`、`Simulation.js`、`AnimationLibrary.js`）
- **局部 Hitstop**：仅在命中瞬间为攻击者与受击者设置 `fighter.hitstopTicks = 4~8`，跳过两者的更新，全局世界时钟与其他敌人丝滑运转。
- **Root Motion 驱动**：在 `MOVES` 表中注入 `motion: [[frame, fwdDist], ...]`，位移由动作帧严格驱动，彻底移除 `combatLunge` 磁吸位移，根治滑步问题。
- **验收标准**：单测验证 3 个敌人场景中，A 打击 B 时，C 的位移与计时器无任何停滞。

---

## 3. 三人协作分工（文件独占与零冲突契约）

为保障多智能体并行开发绝对不产生 Git 合并冲突，项目采用**基于文件所有权的严格切分模式**：

```
                       ┌──────────────────────────┐
                       │  contracts.md (协议中枢) │
                       │  InputFrame / WorldData  │
                       │  sim.events / Snapshots  │
                       └─────────────┬────────────┘
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
    ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
    │  Claude Code  │        │Gemini(Hyperion│        │    opencode   │
    │  物理与规则核心│        │渲染/HUD/视界/交互│       │   关卡与战术AI │
    └───────┬───────┘        └───────┬───────┘        └───────┬───────┘
            │                        │                        │
    ┌───────┴───────┐        ┌───────┴───────┐        ┌───────┴───────┐
    │- Simulation.js│        │- ThreeScene.js│        │- BotBrain.js  │
    │- Fighter.js   │        │- Procedural-  │        │- src/core/ai/*│
    │- Constants.js │        │  FighterMesh  │        │- Campaign-    │
    │- Collision-   │        │- Animation-   │        │  Manager.js   │
    │  System.js    │        │  Library.js   │        │- LevelLayouts │
    │- Rules.js (新)│        │- Character-   │        │- levels/*.js  │
    │- Weapons.js(新│        │  Model.js     │        │- i18n.js      │
    │- Pickups.js(新│        │- OniHud.js(新)│        │               │
    │- World.js(查询│        │- index.html   │        │               │
    │- unit tests   │        │- style.css    │        │               │
    │               │        │- e2e tests    │        │               │
    └───────────────┘        └───────────────┘        └───────────────┘
```

| 成员 | 独占写权限文件与模块 | 负责内容与核心价值 |
|---|---|---|
| **Claude Code** | `src/core/Simulation.js`<br>`src/core/Fighter.js`<br>`src/core/Constants.js`<br>`src/core/CollisionSystem.js`<br>`src/core/Rules.js` (新增)<br>`src/core/Weapons.js` (新增)<br>`src/core/Pickups.js` (新增)<br>`src/core/World.js` (几何碰撞查询)<br>`tests/unit/oni-*.test.js` | 规则抽象（Oni vs Arena）、状态机与按键精简、自动格挡判定、枪械与弹道物理、局部 Hitstop、单元测试守门。 |
| **Gemini (Hyperion)**<br>*(我自己)* | `src/render/ThreeScene.js`<br>`src/render/ProceduralFighterMesh.js`<br>`src/render/AnimationLibrary.js`<br>`src/render/CharacterModel.js`<br>`src/render/VFXSystem.js`<br>`src/render/PostFX.js`<br>`src/ui/OniHud.js` (新增)<br>`index.html`<br>`style.css`<br>`tests/e2e/oni.spec.js` | 越肩第三人称防穿模相机、清除 CAM_TURN 骨骼偏角、原生圆环 HUD 与动态准星、Datapad 覆盖层、立体场景几何渲染、Root Motion 动画采样、E2E 视觉回归。 |
| **opencode**<br>*(或协同推进)* | `src/core/BotBrain.js`<br>`src/core/ai/*` (Perception/NavGraph)<br>`src/core/CampaignManager.js`<br>`src/core/LevelLayouts.js`<br>`src/core/levels/*` (14 章关卡立体数据)<br>`i18n.js` | 敌人视锥与听觉广播、多层 A* 寻路、战役剧情对话与检查点系统、关卡立体数据填充、多语种本地化。 |

- **为什么 Gemini 最适合渲染/HUD/视界**：
  1. 渲染与相机（ThreeScene/ProceduralFighterMesh/AnimationLibrary）对 3D 线性代数（四元数、透视投影、视线射线求交、骨骼逆运动学 IK）要求极高，Gemini 在 Three.js 场景构建、着色器与相机碰撞算法上有最深厚的技术积累；
  2. 原版圆环 HUD 与 Datapad 是决定复刻版“视觉第一印象”的关键，直接负责 `index.html` 和 `OniHud.js` 可确保高保真还原与流畅的 DOM/Canvas 表现；
  3. 配合 Playwright E2E 测试，能闭环验证相机抗穿模与画面表现。

---

## 4. 现有代码中的明显 bug 与架构缺陷

1. **【高危 Bug】额外敌人开火状态严重污染 f2**：
   - `Simulation.js:645,650,653-654,670` 在派发开火、投掷与近战事件时硬编码 `ev.attacker === 'p1' ? this.f1 : this.f2`。战役中所有持枪杂兵射击，枪口坐标与弹药扣除全部错误施加在 f2 身上（f2 可能在别的区域甚至已经阵亡），必须重构为 `this.entities.get(ev.attacker)`。
2. **【高危 Bug】战役模式 120 秒超时强制判负**：
   - `CampaignManager.js:1962` 强行将 `sim.roundTimer` 重置为 `120 * 60`，超时即调用 `handleTimeout` 宣判玩家战败，完全破坏探索体验。
3. **【中危体验】靠近地表枪械时出拳误触拾取吞出拳**：
   - `Simulation.js:600-617` 在检测拾取武器时，将普通 Punch 键作为拾取触发条件。当敌人站在枪械附近时，玩家挥拳被强行拦截转为拾取枪械动作，立回严重受挫。必须将拾取枪械绑定至专属 `action (E)` 键。
4. **【中危体验】走近控制台 1.25m 自动黑入与挥拳误触**：
   - `CampaignManager.js:2301` 判定玩家在清版后走近 1.25m 自动骇入，或在 1.8m 内按拳/开火均触发黑入，导致战斗中极易误触。
5. **【中危架构】全局时钟冻结产生全场卡顿顿挫**：
   - `Simulation.js:438-441` 使用 `this.hitstopFrames` 直接 `return` 整个 `tick`，冻结全场实体模拟，在同屏多杂兵战役中造成世界反复抽搐卡顿。必须改为个体局部 `hitstopTicks`。
6. **【中危架构】单对手模型与规则泄漏至核心层**：
   - `Fighter.js:1631-1638` 中写死 `this.id === 'p1'` 来应用小兵伤害折扣（×0.45/×0.65），`Fighter.update(input, opponent)` 假设永远只有一个单一对手，无法适应真正的群战。
7. **【低危架构】BotBrain 静态全局令牌导致多实例状态污染**：
   - `BotBrain.js:34-43` 的 `activeAttackerId`、`tokenExpireFrame` 均为静态类属性，在单元测试并发或多仿真实例下发生严重交叉污染。
8. **【视觉走形】渲染层 CAM_TURN 硬编码侧身姿态**：
   - `ProceduralFighterMesh.js:17` 定义 `CAM_TURN = 0.38`，在越肩视角下导致角色背影严重斜扭走形，必须置零并改为视线动态跟随。

---

## 5. 对 Claude 提案的意见（赞同/反对/补充）

阅读并研讨了 `docs/oni-plan/claude.md`，整体方案切中要害、思路清晰，具体评审意见如下：

### 赞同点 (Endorsements)
1. **高度赞同规则层拆分（`OniRules` vs `ArenaRules`）**：这是整套方案中最漂亮的设计。既彻底还原本味战役的动作冒险探索本质，又完美保全了前面十几轮迭代沉淀出的 1v1 对战、生存波次与联机资产。
2. **高度赞同基于文件独占的无冲突分工**：按 Simulation/Fighter（Claude）、Render/UI（Gemini）、AI/Levels（opencode）切分，职责边界清晰，完全避免了多人并行开发中的代码踩踏。
3. **赞同其所提炼的 Bug 清单**：特别是杂兵射击绑 f2、拳键吞出拳与 120 秒超时判定，与我方的核查结果高度吻合，属于必须在 M1 立即扫除的致命问题。

### 补充与完善建议 (Additions & Refinements)
1. **关于相机与骨骼姿态的解耦（极其关键）**：
   - Claude 提出了肩后视角，但未关注到现有渲染层的根源病灶：`ProceduralFighterMesh.js` 中的 `CAM_TURN = 0.38`。这是为街机横版正面展示特制的骨骼侧偏。若不在此处做重构清零并结合瞄准方向实时解算脊柱扭转，越肩视界下的 Konoko 将会严重畸变。渲染层改造必须将相机碰撞推近与骨骼正向校准合并实施。
2. **关于 3D 准星与射击弹道 VFX 的闭环**：
   - Claude 提议拓展 6 种武器，但需要强调：射击物理必须与屏幕中心准星（Crosshair）形成三维空间交点。仿真层派发 `FIRE` 事件时必须携带三维起点与终点命中点（HitPoint），由渲染层 `VFXSystem` 同步绘制瞬时弹道光迹与受击火花，否则会导致单测中 Hitscan 与 Projectile 混淆的问题（如 `oni-rules.test.js:74` 的报错）。
3. **关于双人同步摔投（Synchronized Throws）的实现机制**：
   - Claude 建议使用 `victimOffset` 数组。更健壮的做法是在抓取成立至落地期间，建立轻量级 `GrappleContext`，将被投者的坐标系直接相对锚定在投掷者的手部/腰部关节，由投掷主动帧驱动两者同步变换，并在落地帧精确派发受身判定窗口，代码结构将远比逐帧手写 offset 更易维护。
4. **关于 opencode 分工的应急兜底建议**：
   - 鉴于当前 opencode 本地运行配额处于耗尽或不可用状态，为确保工程推进不被阻塞，建议在冻结 `contracts.md` 后，关卡立体数据由 Claude 与 Gemini 联合制定好纯数据模板，必要时由 Gemini 协同接管关卡几何渲染生成与 AI 感知基础骨干，确保 M1/M2 目标如期达成。
