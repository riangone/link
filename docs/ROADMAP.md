# Link — 后续实施路线图

本文档记录本轮"除无构建/类型系统外全部开始实施"请求中，**已落地**与**尚待实施**的部分。约束条件：不引入前端框架、不引入 TypeScript/构建流水线；JSDoc 作为轻量文档手段可以使用。

## 本轮已落地（2026-08-15）

| 条目 | 状态 | 说明 |
|---|---|---|
| 测试体系 | ✅ | `server/test/*.test.js`（Node 内置 `node:test`，零新增运行时依赖）+ `tests/e2e/*.spec.js`（Playwright，浏览器级真实验证）。`npm test`（根目录）会先跑 server 单测再跑 E2E。 |
| CI/CD | ✅ | `.github/workflows/ci.yml`：server 单测 → client 语法检查（`node --check`）→ Playwright E2E，三个 job 串行依赖，任一失败即红。不含构建步骤。 |
| 信令层限流/防滥用 | ✅ | `server/index.js`：`RateLimiter`（每 peer 每秒消息数上限）、`WS_MAX_PAYLOAD_BYTES`（单条信令消息体积上限）、`ROOM_MAX_PEERS`（单房间人数上限，超限拒绝连接并回复 `room-full`）。均可通过环境变量调参。 |
| TURN 动态凭证 | ✅（此前已实现，本轮确认/补测） | `getTurnCredentials()`：基于 `use-auth-secret` HMAC 方案的 24 小时时限凭证，已配单元测试。 |
| 幽灵 Peer 清理 bug | ✅（本轮编写 E2E 时发现并修复的真实 bug） | Socket 异常断开（浏览器崩溃/强杀标签页/断网）时，此前要等 ~60s 惰性心跳超时才会清理房间里的"幽灵设备"。现已在 `socket.on('close', ...)` 立即触发 `_leaveRoom`，两级测试（`server/test/room-cleanup.test.js` + E2E）覆盖。 |
| JSDoc 注释 | ✅（部分，非强制类型检查） | `server/index.js` 与 `client/scripts/network.js` 的核心类/方法已补充 `@param`/`@returns` 注释，仅供编辑器提示，未引入 `jsconfig.json`/`tsc --checkJs` 等强制校验（按要求排除"无构建/类型系统"这一项）。 |
| 单进程可嵌入信令服务 | ✅（E2E 测试的副产品，亦可用于生产） | `SnapdropServer` 构造函数新增可选 `httpServer` 参数，允许将信令 attach 到已有 `http.Server` 而非独占端口，见 `tests/e2e/dev-server.js`。理论上可用于免 nginx 的单进程部署，但**生产迁移未做**，仍以 docker-compose 的 node+nginx 双容器方案为准。 |

## 尚未实施：分阶段计划

以下条目工作量大、涉及协议/UX/基础设施变更，**不适合在一次性大改中仓促完成**（尤其是本项目此前已多次出现"改完当场生效但实际引入新 bug"的教训）。建议按以下优先级分批实施，每批独立提测：

### Phase A（建议下一批，风险低、价值高）
1. **文件夹/多文件批量传输**
   - 现状：`Peer.sendFiles()` 已支持多文件队列（`_filesQueue`），但**严格串行**、无并发；文件夹需要 `<input webkitdirectory>` + 客户端递归展开为文件列表喂给现有队列。
   - 复杂度：中低。对接点：`client/scripts/network.js` `Peer.sendFiles`、`client/index.html` 的 `<input type="file">`。
2. **传输队列并发控制**
   - 现状：`_dequeueFile()` 每次仅发一个文件，`_busy` 标志全局串行。
   - 目标：同一 peer 内维持有序（避免乱序到达影响体验），但允许**多个不同 peer 之间**并行发送（现有代码天然支持，需确认无共享状态误用）。
   - 复杂度：低。
3. **WebRTC 指纹校验 UI（安全）**
   - 现状：DTLS 本身已加密，但用户无法肉眼核对双方连接指纹以防中间人。
   - 目标：连接建立后通过 `RTCPeerConnection.getStats()` 取本地/远端证书指纹，各截取短哈希在 UI 上显示，供双方口头/视觉核对。
   - 复杂度：中。对接点：`client/scripts/network.js` `RTCPeer._onChannelOpened`。

### Phase B（中等复杂度，需要协议扩展）
4. **断点续传**：需要在 `header`/`partition` 协议中加入文件内容哈希 + 已接收 offset 的持久化（`IndexedDB`），重连后对比续传。改动面涉及 `FileChunker`/`FileDigester` 协议版本，需要新旧协议兼容处理。
5. **跨设备文本历史**：当前文本传输是一次性 toast（`_onTextReceived`），无持久化。目标：`IndexedDB` 本地历史 + 简单列表 UI（抽屉式，复用现有 Transfer Center 的 UI 语言）。
6. **剪贴板同步 UI**：`client/scripts/clipboard.js` 目前只是 `writeText` 的 polyfill，尚无"发送剪贴板内容到 peer"的入口和权限请求流程（`navigator.clipboard.readText()` 需要用户手势 + 权限）。
7. **二维码配对**：当前发现机制仅限同 IP/同房间。目标：房间链接生成二维码（`location.hash` 房间 id），移动端扫码跳转加入同一 room。可用轻量、零依赖的纯 JS QR 编码（避免引入大型库，需要评估体积）。

### Phase C（基础设施级，影响面最大，需单独设计评审）
8. **Redis pub/sub 水平扩展**：当前 `_rooms` 是进程内内存态，多实例部署下彼此看不到对方的 peer。真要做需要重新设计"本进程只管本地 socket，房间成员列表与信令转发走 Redis 广播"的架构，属于一次独立的设计+实施，不建议和其他项混在一起改，避免影响现有单实例部署的稳定性。
9. **Web Share Target API + 后台推送**：PWA manifest 增加 `share_target`；推送需要后端推送服务（Web Push 协议 + VAPID key 管理），涉及新的服务端持久化（订阅信息），目前 `server/index.js` 完全无状态持久层，需先决定是否引入数据库。
10. **轻量错误上报（Sentry 类）**：需要先决定"自建上报端点"还是"接第三方 SaaS"（涉及数据出境/隐私评估），不是纯代码问题，需要产品侧拍板。
11. **服务端文件大小/类型兜底限制**：⚠️ 架构说明——本项目文件是通过 **WebRTC P2P 数据通道**直接在两个浏览器之间传输的，**信令服务器完全不经手文件内容**，因此"服务端限制文件大小/类型"在当前架构下并不成立（服务器看不到文件）。可行的替代方案是：(a) 客户端在 `sendFiles`/`_onFileHeader` 处做大小硬上限 + 类型黑名单提示（纯 UX 提示，不是安全边界）；(b) 若未来要做真正的服务端可控限制，需要改为文件先上传服务器中转再下发，这是与当前 P2P 架构相反的取舍，建议不做，除非有明确的合规需求。

---
如需启动某一阶段，请指明优先做 Phase A 中的哪一项，我会按该项单独出实施方案再动手，避免像 Phase C 这类基础设施变更被仓促塞进一次性大改动里。
