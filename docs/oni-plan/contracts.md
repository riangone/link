# Oni Remake — Architecture Contracts & Data Schemas (M1 Frozen)

本文档定义了核心模拟层（Claude Code）、渲染与 HUD 层（Gemini/Hyperion）、关卡与 AI 层之间交互的强契约。所有后续改动必须遵守此接口规范。

---

## 1. InputFrame 数据契约

由 `OniInput.js` 在每帧生成，传递给 `Simulation.tick(inputs)`：

```typescript
interface InputFrame {
  // 运动控制：[-1, 1]，相对于当前摄像机或角色朝向
  moveFwd: number;      // 1.0 = 前, -1.0 = 后
  moveSide: number;     // 1.0 = 右, -1.0 = 左
  
  // 3D 瞄准角（弧度制）
  yaw: number;          // 水平偏航角（0 = 正北/世界坐标-Z轴）
  pitch: number;        // 垂直俯仰角（弧度，[-0.6, 1.1]）

  // 动作按钮（布尔触发或按住状态）
  punch: boolean;       // 左键：出拳 / 开火
  kick: boolean;        // 右键：踢击
  jump: boolean;        // Space：跳跃
  crouch: boolean;      // Ctrl/C：蹲伏 / 滑铲（跑步中） / 翻滚（配合方向）
  walk: boolean;        // Shift：步行修饰符（默认跑动）
  action: boolean;      // E：场景交互（开门、骇入控制台、拾取枪械/道具）
  reload: boolean;      // R：武器换弹
  holster: boolean;     // Q：收枪/拔枪切换
}
```

---

## 2. World 空间与几何数据契约

纯数据结构（不依赖 Three.js），由关卡加载器实例化，供物理和渲染公用：

```typescript
interface WorldData {
  id: string;
  name: string;
  
  // 水平板 (Floors)
  floors: Array<{
    id: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    y: number;
  }>;

  // 楼梯/斜坡 (Ramps)
  ramps: Array<{
    id: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    y0: number;         // 起点高度
    y1: number;         // 终点高度
    axis: 'x' | 'z';    // 坡度延伸轴
  }>;

  // 阻挡墙体 (Walls, 带高度区间的 AABB)
  walls: Array<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minY: number;
    maxY: number;
    blocksProjectiles: boolean;
  }>;

  // 门与闸门 (Doors)
  doors: Array<{
    id: string;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    locked: boolean;
    openProgress: number; // 0.0 (关闭) ~ 1.0 (全开)
    unlocksBy: 'proximity' | string; // 例如 'proximity' | 'console:c1' | 'clear:zone1'
  }>;

  // 控制台与开关 (Consoles)
  consoles: Array<{
    id: string;
    x: number;
    y: number;
    z: number;
    hacked: boolean;
    action: string;       // 例如 'unlock:d1' | 'alarm:on' | 'save'
  }>;

  // 场景道具与武器拾取点 (Pickups)
  pickups: Array<{
    id: string;
    type: 'HYPO' | 'AMMO_BALLISTIC' | 'AMMO_ENERGY' | 'WEAPON';
    weaponId?: string;
    x: number;
    y: number;
    z: number;
    collected: boolean;
  }>;

  // 刷怪点定义 (Spawns)
  spawns: Array<{
    archetype: string;
    tier: 'green' | 'blue' | 'red';
    x: number;
    y: number;
    z: number;
    patrol?: Array<[number, number]>;
    alert: 'lull' | 'low' | 'medium' | 'high' | 'combat';
  }>;

  // 坠落死亡 Y 阈值
  killY: number;

  // 玩家出生点与检查点
  spawnPoint: { x: number; y: number; z: number; yaw: number };
  savePoints: Array<{ id: string; x: number; y: number; z: number }>;
}
```

---

## 3. Simulation 事件契约 (`sim.events`)

每 tick 产出的事件数组，供渲染层（特效、音效、HUD）消费：

```typescript
type SimulationEvent =
  | { type: 'HIT'; attackerId: string; victimId: string; damage: number; hitType: 'LIGHT'|'HEAVY'|'BLOWN_BACK'|'DIZZY'; pos: [number, number, number] }
  | { type: 'BLOCK'; attackerId: string; defenderId: string; pos: [number, number, number] }
  | { type: 'FIRE'; shooterId: string; weaponId: string; origin: [number, number, number]; dir: [number, number, number] }
  | { type: 'RELOAD'; shooterId: string }
  | { type: 'PICKUP'; entityId: string; pickupType: string; itemId?: string }
  | { type: 'NOISE'; pos: [number, number, number]; radius: number; intensity: number; source: 'GUN'|'FOOTSTEP'|'COMBAT'|'ALARM' }
  | { type: 'ALARM_TRIGGERED'; consoleId: string; pos: [number, number, number] }
  | { type: 'DOOR_STATE_CHANGE'; doorId: string; open: boolean }
  | { type: 'FIGHTER_DOWN'; entityId: string; isBoss: boolean }
  | { type: 'PLAYER_DEAD'; checkpointId: string };
```

---

## 4. 战斗机体只读快照契约 (`Fighter` 渲染暴露面)

渲染层和 HUD 层仅通过下列只读状态读取实体，不得直接改写内部模拟数据：

```typescript
interface FighterSnapshot {
  id: string;
  isPlayer: boolean;
  archetype: string;
  x: number;
  y: number;
  z: number;
  facingAngle: number;
  pitchAngle: number;
  
  hp: number;
  maxHp: number;
  daodanOverpowerHp: number; // 超出 100 的数值 (0 ~ 100)
  
  state: string;
  stateFrame: number;
  hitstopTicks: number;
  
  // 武器与弹药
  hasWeapon: boolean;
  weaponId: string | null;
  clipAmmo: number;
  reserveAmmo: number;
  
  // 道具库存
  hypoCount: number;
}
```
