# TURN 运维

## 密钥位置

| 文件 | 权限 | 读取方 |
|---|---|---|
| `/etc/link/turn-secret` | `ubuntu:ubuntu 600` | `snapdrop` 和 `link-lite` 启动时读取 |
| `/etc/turnserver.conf` 的 `static-auth-secret` | `root:turnserver 640` | coturn |

两处的值必须相同。密钥不进仓库，也不进 PM2 环境变量（`pm2 save` 会把环境变量明文写入 dump）。
也可以用 `TURN_SECRET` 或 `TURN_SECRET_FILE` 环境变量覆盖。

读不到密钥时，服务不下发 TURN 地址，用户只能用 STUN 和 WebSocket 中继，日志里会有告警。

## 换密钥

1. 生成新值：`openssl rand -hex 32`，写入上面两个文件。
2. `sudo systemctl restart coturn && pm2 restart snapdrop link-lite`

正在走 TURN 的对局会断开。已打开的页面要重连信令后才能拿到新凭证。

## 配置

模板见 `server/turnserver.conf.template`。`max-bps` 和 `bps-capacity` 的单位是字节/秒。

`denied-peer-ip` 和 `no-tcp-relay` 不能删：没有它们，别人可以通过 TURN 访问本机所在内网、云元数据地址和本机的 TCP 服务（2026-11-06 实测确认过）。

**这些限制才是主要防线，换密钥不是。** 任何连上信令的人都会拿到有效期 24 小时的 TURN 凭证，所以要假设陌生人总能用上 TURN。

**已知遗留问题：** coturn 总是放行自己的中继地址，`denied-peer-ip` 对 `10.0.0.202` 无效，UDP 中继仍能访问本机监听在这个地址上的 UDP 服务（目前是 rpcbind、avahi 和 coturn 自身）。TCP 已由 `no-tcp-relay` 挡住。彻底修复要加防火墙规则：
`iptables -I OUTPUT -m owner --uid-owner turnserver -d 10.0.0.202 -j REJECT`

会话日志在 `/var/log/turnserver/turnserver.log`，含客户端 IP 和 TURN 用户名，由 `/etc/logrotate.d/coturn` 轮转，保留 7 天。
