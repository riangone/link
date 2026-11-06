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

**本机 UDP 服务：** coturn 总是放行自己的中继地址，`denied-peer-ip` 对 `10.0.0.202` 无效，所以用防火墙挡住（已写入 `/etc/iptables/rules.v4`）：

```
iptables -I OUTPUT -p udp -m owner --uid-owner turnserver -d 10.0.0.202 ! --dport 49152:65535 -j REJECT
```

**不要去掉 `! --dport` 这部分。** coturn 把发往自己公网地址的流量转给 `10.0.0.202`，两端都走中继时要经过这里。挡住全部端口后，这种连接会断（2026-11-06 实测）。

- **遗留问题：** 放行范围内的本机 UDP 服务仍可被访问，目前是 avahi 的随机高位端口。
- **保存规则：** 不要用 `netfilter-persistent save`，它会把 fail2ban 和 Docker 的动态规则也写进文件。要改就手动编辑这一行。
- **本机测试：** 从本机连 TURN 时，不要用 `10.0.0.202` 或 `127.0.0.1` 作源地址。前者的回包会被这条规则挡住，后者的中继会落在环回地址上，测试结果不可信。可以绑定 `172.17.0.1` 连接 `10.0.0.202:3478`。

会话日志在 `/var/log/turnserver/turnserver.log`，含客户端 IP 和 TURN 用户名，由 `/etc/logrotate.d/coturn` 轮转，保留 7 天。
