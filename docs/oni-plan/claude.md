# Oni 复刻 —— Claude Code 分析与提案

> 范围：只分析 `client/oni/`（game.js、src/core/*、src/render/*、index.html）和 `tests/unit/oni-*.test.js`，本轮没有改任何代码。
> 基线：`node --test tests/unit/oni-*.test.js` 共 55 个测试，全部通过（2026-10-30，工作区有未提交改动）。
> 说明：文中"原作"指 Bungie 2001 年的 PC 版《Oni》。凭记忆写的细节标了【待复核】，动手前请对照原版手册或实机核实。

---

## 0. 现状一句话

现在做出来的是**"3D 格斗游戏 + 横向清版"**，不是**"第三人称动作冒险"**。
核心是 1v1 的 `f1/f2`：有回合计时、K.O.、双方血条/韧性条/道弹条、RPG 等级/EXP、十几个功能键，后来再往上叠"额外敌人"。关卡是 x∈[-28,38]、z 很窄的单层走廊，靠三道闸门分段推进。
原作的骨架完全不同：在大型多层室内关卡里自由探索，WASD+鼠标第三人称操作，**没有计时、没有敌人血条、不用专门的格挡键**，拳脚加方向组合出招，枪、弹药、血包都是关卡里拾取的资源。

| 模块 | 行数 | 评价 |
|---|---|---|
| core/Fighter.js | 1778 | 状态机完整，但格斗游戏规则（韧性、超载、防围殴保护）和 `'p1'` 硬编码混在一起 |
| core/Constants.js | 1216 | MOVES 帧数据 + 声明式 MOVE_TABLE，**这是最值得保留的资产** |
| core/Simulation.js | 1325 | 固定 60Hz、确定性 RNG，做得不错；多敌人支持是后补的，有 bug（见 §5） |
| core/CampaignManager.js | 2476 | 章节数据和逻辑混在一起；区域计时、RPG、自动骇入 |
| core/BotBrain.js | 834 | 优先级行为树，**没有寻路、没有听觉**；静态全局的攻击令牌 |
| core/LevelLayouts.js | 457 | 单层 AABB 障碍布局，可完成性靠构造保证（这个思路好） |
| render/* | ~4.6k | 程序化骨骼 + 程序化姿态，赛博风天台、雨、PostFX |
| game.js | 1651 | 上帝文件：输入、触屏、UI、音频、网络、主循环全在里面 |

---

## 1. 差距清单（按对"像不像原作"的影响排序）

### P0 —— 不改这些，就不可能"像 Oni"

| # | 方面 | 原作 | 现状 | 证据 |
|---|---|---|---|---|
| G1 | **游戏规则/框架** | 关卡式动作冒险；没有计时；死了从存档点重来；没有敌人血条和 EXP | 99 秒回合 / 战役每个区域 120 秒，**超时直接判负**；K.O. 横幅；RPG Lv1–5 和 EXP；连击数提示 | `Simulation.js:1137-1142`、`CampaignManager.js:1962`、`index.html:60` |
| G2 | **操控键位** | WASD 移动（按住即跑），Shift 走路，Space 跳，Ctrl 蹲，鼠标转向/俯仰，左键拳/开火，右键踢，E 动作/拾取，R 换弹，Q 收枪【待复核：具体键位】 | J/K/L/U/I/O/R/F/H/Q/E/V/G 等十几个键；鼠标操控要点击锁定才生效，触屏/非锁定时**自动朝向敌人（软锁定）** | `game.js:770-787`、`Fighter.js:398-412` |
| G3 | **移动节奏** | 按住方向默认就是**跑**，靠 walk 键才走；跑步中蹲 = 滑铲，蹲+方向 = 翻滚，跳+方向 = 前空翻/后空翻/侧翻 | 靠近敌人（<6m）时默认走路，离开 14 帧后才转跑；有双击冲刺；闪避和滑铲是独立按键 | `Fighter.js:985-997`、`Constants.js` SLIDE_KICK×3、`tryStartEvade` |
| G4 | **格挡** | 自动格挡：不在攻击、不往前移动、正面朝向攻击者时自动挡；下段攻击要蹲着才挡得住；从背后挨打必中【待复核：后退是否必需】 | 后退或按格挡键才挡；**小兵永远不会被动格挡**（`!this.isMinion`） | `Fighter.js:899,951`、`CollisionSystem.js:398-407` |
| G5 | **关卡** | 大型 3D 室内多层关卡：楼梯、坡道、门（自动门/锁门）、电梯、控制台（按 E 用）、存档点、可坠落的边缘 | 单层地板；`getFloorHeightAt` 只认天台两层的硬编码；关卡是一条带闸门的走廊；**控制台走近 1.25m 就自动骇入** | `CollisionSystem.js:165-178`、`LevelLayouts.js:1-17`、`CampaignManager.js:2296` |
| G6 | **相机** | 唯一的第三人称肩后视角，跟随鼠标转向和俯仰，碰墙会推近 | 侧视/斜视/肩后/俯视四种；只有锁定鼠标后才跟随朝向；默认是格斗游戏式的侧视 | `ThreeScene.js:958-1000,1114+` |
| G7 | **HUD** | 左下角圆环血量，右下角圆环武器/弹药（弹匣 + 备用弹），**不显示敌人血条**；F1 打开 Datapad（目标/招式/日记）【待复核：键位】 | 格斗游戏式双人顶栏：HP/韧性/道弹三条 + 计时 + 💉徽章 + Lv 徽章 | `index.html:36-85` |
| G8 | **血包与 Daodan** | Hypo 是**踩上去就用**的血包（满血时不会自动拾取）；满血时按 E 强行用 → 血量超过上限（最高约 200%），Konoko 发光、伤害提高，超出部分逐渐回落；后期章节有被动的 Daodan 再生【待复核：数值】 | Hypo 当库存按 H 用；道弹是 0–100 的能量条，分三阶段，Q 键"超载"并放冲击波 DAODAN_SURGE；还有护盾值 | `Constants.js:117-137`、`Fighter.js:136-220,1163-1187` |
| G9 | **枪械** | 屏幕中心准星、鼠标俯仰瞄准（可以打上下层）；弹匣加备用弹药（Ballistic Ammo / Energy Cell），R 换弹；持枪时左键开火、右键仍可踢；近身可以缴械；大约 10 种枪（Campbell Equalizer、Black Thunder、Plasma Rifle、Phase Stream、Van de Graaff、Mercury Bow、Scram Cannon、Screaming Cannon、SBG、Super Ballistic……【待复核：完整清单】） | 只有 3 种；只沿朝向**水平**射击（没有俯仰）；不能换弹，打空了就"把枪扔出去"；拳键靠近枪就拾取（会吞掉出拳）；还有一个独立 F 键 | `Constants.js:194-257`、`Simulation.js:583-635,667+` |

### P1 —— 决定手感和战斗是否"对味"

| # | 方面 | 原作 | 现状 |
|---|---|---|---|
| G10 | 敌人兵种与 AI | Striker / Comguard（枪兵，会翻滚躲闪、蹲着射击）/ Thug / Fury / Ninja / Tanker / Elite，按颜色分档（绿 < 蓝 < 红）；警戒等级会升级；能听到枪声和打斗声；会跑去按警报；会捡枪；残血时会逃跑去找血包；可以多人一起围攻 | 5 种 archetype（STRIKER/FURY/TANKER/BLACK_OPS/SNIPER），名字是自编的；**没有寻路**（直线靠近，会卡在障碍物上）；同一时间只有一个敌人允许近战（静态令牌）；对玩家的伤害×0.45 是"手下留情" |
| G11 | 动画与位移 | 关键帧动画自带根运动（root motion）：出招时身体跟着位移；投技是双人同步动画；受击分轻、重、击飞、晕眩；起身有多种方式 | 程序化姿态 + `applyMagneticCombatLunge` 磁吸位移；位移和动画分开，导致"滑步"感 |
| G12 | 打击停顿 | 局部轻微停顿，只作用于受击双方 | `hitstopFrames` **冻结整个世界**（4/6/10 帧），多个敌人一起打的时候世界频繁卡住 |
| G13 | 受击体系 | HP + 状态动画；只有特定招式能打晕（dizzy）；背后挨打更容易被打倒 | 韧性（poise）条 + 打晕 + 霸体阈值 + 防围殴保护 + 隐身暴击 +50%，属于格斗游戏和清版游戏的规则 |
| G14 | 招式输入 | 方向 + 键 + 当前状态（跑/跳/蹲/背后）决定出什么招；没有"必杀键" | MOVE_TABLE 基本对得上，但还多出了 `special`/`slide`/`evade`/`throw`/`daodan`/`heal` 这些原作没有的按钮分支 |
| G15 | 投技 | 靠近后"前 + 拳/踢"出投；背后有专门的背摔；被投时可以按跳受身 | 已经实现（THROW_FRONT/BACK/RUN、BACKBREAKER、THROW_FRONT_K），但多了一个独立投技键，`punch+kick` 也算投技 |

### P2 —— 打磨与完整度

- G16 剧情：过场、对话、每章开场/结尾、存档点；现在只有 comms 横幅和 Boss 推镜头。
- G17 道具：Force Shield（护盾）、Phase Cloak（隐身）、LSI 等任务物品【待复核】。
- G18 音效/音乐：原作有环境音乐、脚步声、按材质区分的击打声；现在只有合成的哔哔声。
- G19 美术：原作是动漫风低多边形、光照偏冷；现在是霓虹赛博配色、雨、bloom，风格偏离。
- G20 模式：PvP、生存模式、训练营可以保留，但应该挪到"附加模式"下面，**不要污染战役的核心规则**。

---

## 2. 实现方案

总原则：
1. 新增 `GameRules` 层，把"Oni 规则"和"Arena 竞技规则"拆开，**现有的 PvP/生存模式改由 ArenaRules 驱动，继续可用**；
2. core 里不许再写死 `'p1'`/`'p2'`，统一用 `entities` 和 `team`；
3. 每一项都附带 `node --test` 单元测试或 Playwright 验收。

### 2.1 [G1] 规则层拆分 —— 新增 `src/core/Rules.js`
- `class OniRules { onTick(sim); onFighterDown(f); isGameOver(sim) }`：没有计时；玩家 HP 归零 → `PLAYER_DEAD` 事件 → 回到存档点。
- `class ArenaRules`：把现有的 roundTimer / declareWinner / survival 逻辑整体搬进来。
- `Simulation` 构造时注入 `rules`，`tick()` 里面不再直接调用 `handleTimeout`。
- 战役关掉 RPG 和 EXP（`CampaignManager.addExp` 只在 Arena 下生效）；招式解锁只保留 `MOVE_CHAPTER_UNLOCK` 这一套。
- **验收**：单测 —— 在 OniRules 下跑 200×60 tick，`isMatchOver === false`；玩家死亡后会产出 `PLAYER_DEAD` 事件，而不是 `KO`。

### 2.2 [G2/G3/G14] 原作操控 —— 新增 `src/input/OniInput.js`（从 game.js 里抽出来）
- 键位表 `KEYMAP = { forward:'KeyW', back:'KeyS', left:'KeyA', right:'KeyD', jump:'Space', crouch:'ControlLeft', walk:'ShiftLeft', action:'KeyE', reload:'KeyR', holster:'KeyQ', punch:'Mouse0', kick:'Mouse2' }`，存到 localStorage，允许改键。
- 输出统一的 `InputFrame { move:{f,s}, yaw, pitch, punch, kick, jump, crouch, walk, action, reload, holster }`。**PC 端默认就是鼠标锁定模式**，点击画面锁定鼠标。
- `Fighter`：
  - 去掉非鼠标模式下的软锁定（`Fighter.js:398-412`）；只给触屏保留可选的"辅助朝向"开关。
  - `handleWalk`：按住方向默认跑（加 4–6 帧起跑过渡），按住 walk 键才走；删掉双击冲刺和 `autoRunFrames`。
  - 翻滚、空翻、滑铲改用原作的组合输入：`crouch+方向` = 翻滚（无敌帧不超过 8）；`RUN + crouch` = 滑铲；`jump+方向` = 对应方向的空翻。
- `MOVE_TABLE`：删除 `special/slide/evade/throw/daodan/heal/fire` 这些 button 分支，只留 `punch|kick` + 上下文；拔枪状态下 punch 映射为开火。
- 触屏：保留摇杆 + 拳/踢/跳/蹲/动作 5 个键，**相机跟随摇杆的横向分量**。
- **验收**：单测 `oni-controls.test.js` —— 按住 W 8 帧后 state 为 RUN；按住 W+Shift 时为 WALK；RUN 中按 crouch 出 SLIDE；静止时 crouch+A 出侧滚；MOVE_TABLE 里所有 button 都属于 `{punch,kick}`。Playwright：锁定鼠标后按 W 1 秒，Konoko 的位移 > 4m。

### 2.3 [G4] 自动格挡 —— 修改 `Fighter.js` / `CollisionSystem.checkHit`
- `canAutoBlock(f) = state ∈ {IDLE, WALK(后退或侧移), CROUCH, BLOCK} && 没有往前推方向`。挡上段/中段要站着，挡下段（`move.isLow`）要蹲着；背后来的攻击一律挡不住。
- 敌人和玩家用同一套规则（删掉 `isMinion` 例外），AI 自己决定"站着不动"还是"进攻"。
- 删除 `block` 按键和 `isBlocking` 的输入来源，改成每 tick 由 `canAutoBlock` 推导。
- **验收**：单测 —— 防守方 IDLE 且正面朝向 → PUNCH_1 被挡；防守方往前走 → 打中；CROUCH_SWEEP 打站立的防守方 → 打中；从背后打 → 打中。

### 2.4 [G5] 三维关卡与世界 —— 新增 `src/core/World.js`、`src/core/levels/chNN.js`；`CollisionSystem` 改为调用 World
- 数据结构（仍然是纯数据，不依赖 Three.js）：
  ```js
  { floors:[{id,minX,maxX,minZ,maxZ,y}],              // 水平板
    ramps:[{minX,maxX,minZ,maxZ,y0,y1,axis:'x'|'z'}], // 楼梯/坡道
    walls:[{minX,maxX,minZ,maxZ,minY,maxY,blocksProjectiles}],
    doors:[{id,aabb,locked,opensBy:'proximity'|'console:ID'}],
    consoles:[{id,x,y,z,action:'unlock:door3'|'alarm'|'save'}],
    pickups:[{type:'HYPO'|'AMMO_BALLISTIC'|'AMMO_ENERGY'|'WEAPON',x,y,z}],
    spawns:[{archetype,tier,x,y,z,patrol:[[x,z],...], alert:'lull'}],
    savePoints:[{id,x,y,z}], killY:-20 }
  ```
- `World.floorAt(x,z,yHint)`：在 `y ≤ yHint+STEP(0.45)` 的板和坡道里取最高的一个，这样能支持楼上楼下。墙体碰撞改成带 Y 区间的 AABB，用胶囊体（半径 0.35，高 1.8）做扫掠检测。
- 天台的 `STAGE_CONFIG` 只留给 Arena 使用。`LevelLayouts` 的"可完成性构造"思路保留，升级为 `World.validate()`：从起点到终点在导航图上必须连通。
- 控制台、门、存档点统一由 `action` 键（E）触发，**不再"走近就骇入"**。
- 渲染：`ThreeScene.buildWorld(world)` 根据同一份数据生成几何体（墙、楼梯、门的动画），保证"没有隐形墙"。
- **验收**：单测 —— 走上坡道后 y 单调上升；从二楼边缘走出去会下落并落在一楼；锁着的门挡路，用对应控制台（`action`）解锁后才能通过；每一章 `World.validate()` 都返回 true。

### 2.5 [G6] 相机 —— 修改 `ThreeScene.js`
- 默认（也是唯一的战役模式）为 `aimFollow` 肩后视角：yaw = Konoko 的朝向，pitch = 鼠标 Y（限制在 -0.6~0.9），距离 3.2m，右肩偏移 0.35m。
- 碰撞：从目标点到相机位置做射线检测，碰到 World 的墙就推近；穿过半透明物体时淡出。
- 侧视/俯视只作为 Arena 的调试选项保留。
- **验收**：Playwright —— 战役开始后 `threeScene.camMode === 'shoulder'`；Konoko 背靠墙时，相机到她的距离 < 墙到她的距离。

### 2.6 [G7] HUD —— 新增 `src/ui/OniHud.js` + 一个 canvas
- 左下角圆环血量：0–100% 绿→黄→红，100–200% 发光层；右下角圆环：当前弹匣弹数做环、备用弹药数字、武器图标；准星只在拔枪时显示。
- 不显示敌人血条（可以加开关保留给 Arena）。按 F1 打开 Datapad 覆盖层：目标 / 招式表（复用 `oni-movelist` 的数据）/ 日记。
- `index.html` 的顶栏只在 Arena 模式下显示。
- **验收**：Playwright 截图 —— 战役中 `#p2-hp-fill` 不可见，`canvas#oni-hud` 存在；HP 从 100 降到 40 时，圆环的 `data-pct` 等于 40。

### 2.7 [G8] Hypo/Daodan 回归原作 —— 修改 `Fighter.js`、`Constants.js`；新增 `src/core/Pickups.js`
- `maxHp = 100`，`hp` 允许到 `2*maxHp`。踩到 Hypo：`hp < maxHp` 时自动用，回复 +40（暂定）；满血时只有按 E 才能强行用，进入 overpower。
- `hp > maxHp` 时：每 tick 掉 `OVER_DRAIN`，攻击力乘以 `1 + (hp-maxHp)/maxHp*0.5`，同时打开发光渲染标志。
- 删掉 `daodanMeter/Stage/Overdrive/Surge/overpowerShield` 和 `USE_HYPO`、`DAODAN_SURGE` 这两个招式；章节解锁配置里加一个 `daodanRegen` 开关，控制后期被动回血。
- **验收**：单测 —— 满血时踩 Hypo 不会消耗；满血按 E 后 hp > 100，并在约 N 秒后回落到 100；hp=150 时打一拳，伤害比 hp=100 时更高。

### 2.8 [G9] 枪械系统 —— 新增 `src/core/Weapons.js`（把 WEAPON_SPECS 和开火逻辑从 Simulation 里移出来）
- `spec = { id, ammoType:'BALLISTIC'|'ENERGY', clip, fireMode:'semi'|'auto'|'charge', rof, reloadFrames, spread, projectile:'hitscan'|'bolt'|'homing'|'arc', twoHanded }`，先做 6 种：Campbell Equalizer、Black Thunder、Plasma Rifle、Mercury Bow、Scram Cannon、Van de Graaff（打中会晕）。
- 状态：`fighter.weapon={id,clipAmmo}`；`fighter.ammo={BALLISTIC:n, ENERGY:n}`；`holstered`。
- 3D 射线：方向 = `(cos(pitch)cos(yaw), sin(pitch), cos(pitch)sin(yaw))`，跟 World 墙体和敌人胶囊体求交，打中会触发对方的受击动画。
- 拾取：武器按 E 拾取（会替换掉手上的并把旧的丢下）；弹药踩上去自动拾取；敌人死亡时掉落武器和部分弹药。**拳键不再承担拾取。**
- **验收**：单测 —— clip 打空后不能开火，按 R 后经过 `reloadFrames` 帧恢复，并从备用弹药里扣除；pitch=+0.5 时能打中高台上的敌人、打不中同一水平线上的敌人；Q 收枪后左键是出拳。

### 2.9 [G10] 敌人 AI —— 新增 `src/core/ai/Perception.js`、`src/core/ai/NavGraph.js`；重构 `BotBrain.js`
- 感知：视锥（前方 ±60°、20m，被墙遮挡）+ 听觉（`NOISE` 事件：枪声 25m、打斗声 10m、跑步声 4m）。警戒等级：`lull → low → medium → high → combat`，会随时间衰减。
- 寻路：根据 World 的地板/坡道生成 0.5m 网格，用 A* 找路，再用直线检测平滑路径；节点按 floorId 分层。
- 兵种配置 `AI_PROFILES = { STRIKER:{tier:'green'|'blue'|'red', melee:[...招式权重], blockRate, dodgeRate}, COMGUARD:{ranged:true, keepDist:[5,10], rollOnAim:0.3}, ... }`。
- 行为：巡逻 → 调查噪音 → 战斗（近战兵绕圈、出连招；枪兵保持距离、换弹时找掩护）→ 残血逃跑（找最近的 Hypo）→ 跑去按警报。允许 2–3 个敌人同时近战（令牌数量可配置，改成每个 Simulation 实例一份，不再用静态变量）。
- 删除 `Fighter.takeHit` 里伤害×0.45/0.65 的倍率，难度统一由 `AI_PROFILES` 和 `DIFFICULTY` 控制。
- **验收**：单测 —— 隔着一面墙时 A* 能绕路到达；3m 外开枪 → 背对着的 Striker 警戒等级升到 `high`；枪兵 clip 打空时会进入 `RELOAD` 分支；残血敌人会朝 Hypo 方向移动。

### 2.10 [G11/G12/G13] 战斗手感
- **局部打击停顿**：`fighter.hitstop` 计数器，只冻结攻击方和受击方的 `update`，世界其他部分照常运行（`Simulation.js:438,1022`）。
- **根运动**：给 `MOVES[id]` 加 `motion:[[frame, fwdMeters], ...]`，在 `handleAttack` 里按帧插值写入 vx/vz；然后删掉磁吸位移，或者把它限制在 ≤0.4m。动画采样（`AnimationLibrary.sampleAttack`）用同一份 frame 数据，避免滑步。
- **受击状态细分**：`HIT_LIGHT / HIT_HEAVY / BLOWN_BACK / DIZZY / FALLEN / GETUP_*`；`poise` 改成隐藏的"连续受击计数"，或者干脆删掉；DIZZY 只由带 `dizzy:true` 的招式触发。
- 投技做成双人同步：`MOVES.THROW_*` 加 `victimAnim` 和 `victimOffset`，被投方每帧按投方的骨骼位置定位。
- **验收**：单测 —— 3 个敌人时 A 打中 B，C 的 stateTimer 照常递增；`PUNCH_1` 在 active 帧前的位移等于 motion 表的积分值（误差 ±0.02）。

### 2.11 [G16–G19] P2 列表（暂不细化）
存档点（localStorage 存 `{chapter, savePointId, hp, weapon, ammo}`）、过场脚本（时间轴 JSON）、按材质区分的击打音效、美术配色从霓虹改为原作的冷色调。

---

## 3. 落地顺序（建议的里程碑）

1. **M1 骨架**（1–2 天）：Rules 拆分、OniInput、自动格挡、默认跑步、肩后相机、修 §5 的 bug。完成后战役"操作起来像 Oni"。
2. **M2 世界**：World.js + 两张多层样板关（参照 Ch1 仓库的结构自己设计，**不照抄原始几何**）+ 门/控制台/E 键。
3. **M3 资源**：新的 Hypo/overpower、Weapons.js、弹药、拾取、新 HUD。
4. **M4 AI**：感知、导航、兵种、警报。
5. **M5 手感**：根运动、局部停顿、受击细分、投技双人同步。
6. **M6 内容**：14 章关卡、过场、存档、音频。

---

## 4. 三人分工（按文件归属切分，尽量减少冲突）

| 负责人 | 归属文件（独占写） | 内容 |
|---|---|---|
| **Claude Code**（我） | `src/core/Simulation.js`、`Fighter.js`、`Constants.js`（MOVES/MOVE_TABLE）、`CollisionSystem.js`、新增 `Rules.js`、`Weapons.js`、`Pickups.js`、`World.js`（运行时查询部分）、`tests/unit/oni-*.test.js` | G1/G3/G4/G8/G9/G11–G13：规则、状态机、格挡、枪械、物理、打击停顿、根运动数据 |
| **Gemini (antigravity)** | `src/render/*`（ThreeScene、ProceduralFighterMesh、AnimationLibrary、CharacterModel、VFX、PostFX）、新增 `src/ui/OniHud.js`、`index.html`、`style.css`、`tests/e2e/*` | G6/G7/G11（动画采样那一侧）/G19：相机、HUD、Datapad、根据 World 生成几何、动画与特效、美术风格 |
| **opencode** | `src/core/BotBrain.js`、新增 `src/core/ai/*`、`CampaignManager.js`、`LevelLayouts.js` → `src/core/levels/*`（关卡数据）、`i18n.js` | G5（关卡内容）/G10/G16：AI 感知与寻路、兵种、章节和关卡数据、对话/过场脚本 |

- `game.js` 由我先拆成 `src/input/OniInput.js` 和 `src/app/Loop.js`（M1 里一次性完成），拆完后 `game.js` 只做装配；之后谁需要改 UI 绑定，就在各自的模块里改。
- **接口契约**（M1 第一天由我提交，冻结后再分头开发）：
  - `InputFrame` 字段表；
  - `World` 数据 schema（opencode 写数据，我写查询，Gemini 写渲染）；
  - `sim.events` 事件类型表（`HIT`/`NOISE`/`PICKUP`/`PLAYER_DEAD`/`DOOR_OPEN`…）；
  - `Fighter` 只读字段（渲染和 AI 使用）。
  都写进 `docs/oni-plan/contracts.md`。
- 我最适合负责的是 **core 模拟层**：确定性 tick、状态机、帧数据、碰撞，这一块的单元测试最多，最需要保证改了不出回归，而且我已经把 Fighter/Simulation 的调用链通读过了。

---

## 5. 现有代码的明显 bug 和架构问题

1. **【Bug，高】额外敌人开枪/投掷时被当成 f2**：`Simulation.js:645,650,653-654,850` 用 `ev.attacker === 'p1' ? this.f1 : this.f2` 找攻击者。战役里持枪的 `enemy_*` 开枪时，枪口位置、朝向和弹药都会取自 f2（f2 可能已经死了，或在别的区域）。应改为 `this.entities.get(ev.attacker)`。
2. **【Bug，高】战役每个区域 120 秒超时就判负**：`CampaignManager.js:1962` 加上 `Simulation.js:1139-1141`。原作没有计时，玩家打得慢就会莫名"战败"。
3. **【Bug，中】拳键靠近枪械时被吞掉**：`Simulation.js:600-617`，空手的人站在枪旁边出拳，会变成捡枪。敌人站在枪上时，玩家打不出拳。
4. **【Bug，中】控制台/警报台走近就触发，出拳也会触发**：`CampaignManager.js:2290-2300`，近身打斗时容易误触。
5. **【架构，中】全局打击停顿**：`Simulation.js:438-441`，`tick` 直接 return，所有实体、投射物、AI 都被冻结；而且停顿帧的事件数组为空，渲染端可能漏掉事件。
6. **【架构，中】单对手签名**：`Fighter.update(input, opponent)` 加上 `findBestTarget`，敌人永远只看 f1；`takeHit` 里写死 `this.id === 'p1'` 来做伤害倍率和防围殴（`Fighter.js:1631-1638,1676-1681,1703-1709`），规则泄漏进了核心层。
7. **【架构，中】两套招式解锁体系冲突**：`RPG_LEVEL_TABLE.unlockedMoves`（含 `RISING_FURY`）和 `MOVE_CHAPTER_UNLOCK`（含 `RISING_FURY_PUNCH`）。另外 `RISING_FURY` 和 `RISING_FURY_PUNCH` 是两个不同的招式，`DEVIL_SPIN_KICK` 在 MOVE_TABLE 里有三个不同的触发条件（`Constants.js:916-930,946-951,1082-1087`），解锁时机无法推断。
8. **【架构，低】BotBrain 用静态变量保存攻击令牌**：`BotBrain.js:34-43`，多个 Simulation 实例（测试、预览）会互相污染。
9. **【架构，低】快照只序列化 p1/p2**：`Simulation.js:1156+`，额外敌人、关卡状态都没有同步。目前 PvP 没问题，但以后做合作模式或回放时会出问题。
10. **【代码质量】跳跃逻辑复制了 4 份**，参数 12.2/12.6/12.8 各不相同（`Fighter.js:916,966,1060,1105,1215`）；`takeHit` 的格挡分支直接写 `this.state = BLOCK`，绕过了 `transitionTo`（`Fighter.js:1667`）。
11. **【代码质量】上帝文件**：`game.js` 1651 行，`CampaignManager.js` 2476 行（其中约 1400 行是章节数据）。数据和逻辑应当分离：章节数据放进 `levels/`，逻辑只留状态推进。
12. **【手感】闪避给 12 帧无敌，总长 18 帧**（`Fighter.js:1137`），加上双击和独立闪避键，回避成本过低，和原作翻滚的节奏不一致。

---

## 6. 需要小组共同确认的问题

- 现有的 PvP、生存模式、TCTF 训练营保留在"附加模式"里吗？（我建议保留，由 ArenaRules 驱动）
- RPG/EXP 是否整体移除？（我建议战役移除，Arena 可以保留）
- 关卡几何：自己设计的布局要多接近原作的"结构气质"？要遵守"不照搬原始资产和几何"。
- 原作数值（Hypo 回复量、各招式伤害、武器参数）由谁负责查资料核对？建议我们三人各自负责对应模块的数值，统一记录到 `docs/oni-plan/reference.md`。
