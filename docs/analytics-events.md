# 对战小游戏统计事件设计

状态：第一期已实现（`server/metrics.js`）。查看数据：`node scripts/metrics-report.js [天数]`。

## 1. 要回答的问题

| 问题 | 指标 | 用来决定什么 |
|---|---|---|
| 朋友开房的路径是否成立 | `match_end(source=code, via=link)` / `code_join(via=link)` | 是否继续主推朋友对战 |
| 用户第二周是否回来 | 周留存表（第 1 周 / 第 0 周） | 是否值得接广告 |
| 陌生人能否匹配到人 | `match_found(source=quick)` / `queue_join(kind=quick)`，以及等待时长分布 | 是否合并队列 |
| 配对后能否真正连上 | `room_ready` / `match_found` | 优先修连接还是修玩法 |
| 中继成本有多大 | `net_result` 中 direct、turn、ws 的比例 | TURN 限额和成本预估 |
| 玩家是否连续玩 | `rematch` / `match_end` | 选哪几款上首页 |

## 2. 方案

新增 `server/metrics.js`，接入方式与 `Matchmaker`、`Leaderboard` 相同：构造后在 `_onMessage` 里调用 `handle()`。

不继续扩展 GA，原因如下：

- 一场对局会跨两个页面和两条 WebSocket，GA 很难把它们串起来，服务器却能用房间 ID 关联。
- 匹配事件本来就在服务器上产生，不依赖客户端上报，也不受广告拦截器影响。
- 只记录聚合计数，不需要用户标识。

现有 GA 保留，继续用于看流量来源。

**隐私规则：** 不持久化 IP、昵称、`deviceId`、`pid`、房间 ID 和房间码。房间 ID 只作为内存中的关联键，对局结束或超时后丢弃。

## 3. 事件

维度都是枚举值。`game` 必须在 `GAMES` 中，非法事件或维度直接丢弃，这样统计文件的大小有上限。

### 服务器产生（无法由客户端伪造）

| 事件 | 触发位置 | 维度 |
|---|---|---|
| `lobby_open` | `lobby-subscribe` | 无（断线重连会重复计数，不能当作人数） |
| `queue_join` | `_joinQuick`、`_create` | `game`、`kind`=quick/private |
| `queue_leave` | `match-leave`、`remove()`、`_expireCodes` | `game`、`reason`=cancel/bot/disconnect/expired、`wait` |
| `code_join` | `_joinCode` | `via`=link/manual、`result`=ok/no_code |
| `match_found` | `_pair` | `game`、`source`=quick/code、`wait` |
| `room_ready` | `_joinRoom`：已登记的房间到齐 2 人 | `game`、`source` |

- `wait` 分桶：`0-5s`、`5-15s`、`15-30s`、`30-60s`、`60s+`。
- `queue_leave` 只在上表的入口处记录，不要放进 `_unqueue`。`_unqueue` 也用于配对和切换队列，放进去会多算。

### 客户端上报

通过已有的 WebSocket 发送 `{type:'metric', ev, ...}`。

| 事件 | 接入位置 | 维度 |
|---|---|---|
| `visit` | 大厅和游戏页，每周最多一次 | `cohort`（首次访问周）、`week`（距首次访问的周数） |
| `share_click` | `client/play` 的 `share()` | `game`、`method`=native/copy |
| `bot_start` | `client/play` 的 `playBot()` | `game`、`from`=lobby/waiting |
| `net_result` | `GameSession`，每条连接一次 | `game`、`kind`=direct/turn/ws/unknown |
| `match_end` | 每款游戏的结算处，调用 `session.roundEnd()` | 客户端发 `sec`，服务器分桶为 `duration`；另附房间的 `source`、`via` |
| `rematch` | 每款游戏的再来一局处，调用 `session.rematch()` | 房间的 `game`、`source`、`via` |

- `duration` 分桶：`0-30s`、`30-60s`、`1-3m`、`3-10m`、`10m+`。
- 客户端事件可以伪造。每条连接限 100 条（20 条会漏掉连续多局的玩家，正好影响 `rematch`），这份数据只用于产品判断，不用于排名或结算。

### 需要的协议改动

以下都是可选字段，旧客户端不受影响。

- `match-join` 增加 `via`：链接打开时（`/play/#1234`）为 `link`，手动输入时为 `manual`。
- `match-leave` 增加 `reason`：从等待页转去人机时为 `bot`，默认为 `cancel`。

## 4. 关键机制

### 房间关联

`_pair` 把 `room-room-<roomId>`（游戏页用 `?room=room-<roomId>` 连接，即 `peer.ip`）登记到内存表，内容为 `{game, source, via, waitBucket, ts}`。

- `_joinRoom` 查这张表，判断 `room_ready`。
- `match_end` 和 `rematch` 使用服务器已知的连接所在房间（`peer.ip` 字段在房间模式下保存房间键），不接受客户端上报的房间 ID。
- 双方都会上报，服务器按“房间 + 事件”做 5 秒窗口去重，只计一次。两边的局数计数可能不一致，所以不用局数去重。
- 不在表里的房间（如 `game-invite.js` 发起的邀请）记为 `source=other`。其中包含开单机或机器人的房间，所以只有在房间已到齐 2 人时才计 `match_end`。
- 表项 3 小时后过期，总数上限 5000。服务器重启后表会清空，这段时间的对局记为 `other`，可以接受。

### 无 ID 留存

客户端在 `localStorage` 保存首次访问周和上次上报周。每个自然周首次打开时上报一次 `visit {cohort, week}`。服务器只累加 `cohort × week` 的计数，不需要任何用户 ID。

已知偏差：

- 清除浏览器数据或换设备，会被算成新用户。
- `week` 由客户端计算，服务器只校验格式和范围。

### 连接类型

- `usingWsFallback` 为真时记 `ws`。
- 否则连接成功后调用 `pc.getStats()`，取选中候选对。任意一端为 `relay` 记 `turn`，否则记 `direct`。

## 5. 存储和查看

- **文件：** `server/data/metrics.json`（已被 gitignore），与榜单一样采用防抖和原子写入。退出时通过 `onExit` 落盘。
- **格式：** `{ "days": { "2026-11-06": { "match_found|gomoku|quick|5-15s": 3 } }, "retention": { "2026-W45": { "0": 40, "1": 9 } } }`
- **时区和保留：** 按 JST 分天，每日数据保留 90 天。
- **查看：** 新增 `scripts/metrics-report.js` 命令行报表。不新增 HTTP 接口，避免增加对外暴露面。
- **测试：** `METRICS_FILE=''` 时只存内存，规则与 `LEADERBOARD_FILE` 相同。

## 6. 覆盖范围和分期

| 挂接点 | 覆盖游戏 | 说明 |
|---|---|---|
| `GameSession` | armor、blaster、brawl、gomoku、hockey、kart、kart3d、mech、paint、pong、spin、spin-arena、tag、tanks、tron | 可统一统计 `net_result` |
| `SportKit` | hoops、soccer、tennis、volley | 已确认经 `GameBot.session` 走 `GameSession`；`M.gameOver` 统一统计 `match_end` |
| 未确认 | blocks、bombs、oni、recon、spin3d | 主文件没有直接引用 `GameSession`，接入前要先确认传输方式 |

`match_end` 和 `rematch` 除 `SportKit` 外没有统一入口。每款游戏要加四处调用：房主开局和客户端收到 playing 状态时调用 `session.roundStart()`，结算时调用 `roundEnd()`，点再来一局时调用 `rematch()`。

第一期已接入 `gomoku`、`pong`、`hockey`、`tanks`、`spin` 和 `SportKit` 的 4 款。人机对局走 `LocalSession`，不上报这些事件。`visit` 也不覆盖只开人机局、又没经过大厅的访问。

- **第一期：** 服务器事件、`visit`、`share_click`、`bot_start`、`net_result`，再加 `SportKit` 的 4 款和首页候选游戏的 `match_end`、`rematch`。
- **第二期：** 根据第一期数据选定首页游戏，再覆盖其余游戏。没有上首页的游戏不必补。

## 7. 发布前检查

- 更新 `service-worker.js` 的 `CACHE_NAME`，新脚本加入缓存列表（如果需要离线可用）。
- 更新隐私说明：写明收集匿名聚合统计。如果之后接广告，还要单独处理广告的同意流程。
- 用计数交叉校验：`room_ready` 不应大于 `match_found`，`match_end(source=code)` 不应大于对应的 `room_ready` 乘以平均局数。
