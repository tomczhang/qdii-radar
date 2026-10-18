# qdii.tomcattravel.com 部署运维

## 架构

- 项目目录：`/root/git/qdii-radar`
- Docker Compose 单实例，容器退出/服务器重启后自动启动。
- 后端仅绑定 `127.0.0.1:4387`，由 Nginx 对外提供服务。
- Nginx 配置：`/etc/nginx/sites-available/qdii.tomcattravel.com`
- `.env` 保存生产配置和随机生成的 `ADMIN_TOKEN`（权限 600，不提交 Git）。
- `PUBLIC_BASE_URL=https://qdii.tomcattravel.com`、`TRUST_PROXY_HOPS=1`。
- 数据卷：`qdii-radar_radar-data`，容器内路径 `/app/.data`。
- 邮件配置已被服务识别（`mailConfigured: true`），尚未验证实际发信；前端提醒入口仍关闭。更改 Resend/SMTP 配置后需重建容器。

## DNS 和 HTTPS

2026-10-18 已完成 DNS 解析、Let's Encrypt 证书签发和 HTTPS 验证；HTTP 自动跳转 HTTPS，首页、静态资源、健康检查和看板接口均正常。首次数据同步成功。证书初始有效期至 2027-01-16，`certbot.timer` 已启用自动续期。

以下为重建部署时的开通步骤。

Cloudflare 添加 `A` 记录：`qdii` → `43.133.164.69`，初次申请证书先使用“仅 DNS”。

DNS 生效后执行：

```sh
certbot --nginx -d qdii.tomcattravel.com --redirect --non-interactive
nginx -t
curl -fsS https://qdii.tomcattravel.com/api/health
```

服务器已有 Certbot 账户和自动续期定时器。证书签发前只有 HTTP 反代可用，不能视为 HTTPS 已上线。若之后开启 Cloudflare 代理，SSL/TLS 模式使用 Full (strict)。

## 更新和检查

```sh
cd /root/git/qdii-radar
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail=100 radar
curl -fsS http://127.0.0.1:4387/api/health
```

仅修改 `.env` 时：`docker compose up -d --force-recreate --wait`。重建容器不会强制重新同步已有数据；数据源配置更新后，需等待定时同步或通过管理员同步接口手动触发，并检查 `/api/dashboard` 的字段异常与来源状态，不能仅以健康检查通过判定数据完整。

不要执行 `docker compose down -v`，否则会删除数据卷。

## 自动更新部署（每 3 分钟）

系统级 systemd 定时任务检查 `origin/main`，仅快进更新代码，然后执行 `docker compose up -d --build --wait` 并检查本机 `/api/health`。已启用开机自动运行；无代码更新时不重建。

- 脚本：`/usr/local/sbin/qdii-auto-deploy`
- 服务：`/etc/systemd/system/qdii-auto-deploy.service`
- 定时器：`/etc/systemd/system/qdii-auto-deploy.timer`
- 成功部署的提交：`/var/lib/qdii-auto-deploy/deployed-commit`
- 每小时第 0、3、6……57 分钟检查一次；锁和 oneshot 服务防止重复并发运行。
- 不覆盖 `.env`，不删除数据卷，不执行强制 reset/clean；本地修改与远端冲突、分支分叉或正在合并时停止并记日志，需人工处理。
- 构建或健康检查失败不更新成功标记，下次任务重试；不自动回滚。
- 仅追踪远端代码更新，本地配置更改仍需手动部署。

```sh
systemctl list-timers qdii-auto-deploy.timer
journalctl -u qdii-auto-deploy.service -n 100 --no-pager
# 立即检查并部署（如有更新）
systemctl start qdii-auto-deploy.service
# 停用自动更新（不会停止网站）
systemctl disable --now qdii-auto-deploy.timer
```

首次运行会执行一次部署以建立成功标记。这些系统文件位于仓库外，迁移服务器时需重新安装。

## 一致性备份（短暂停机）

```sh
cd /root/git/qdii-radar
install -d -m 700 /var/backups/qdii-radar
backup="/var/backups/qdii-radar/$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
docker compose stop radar
# 无论复制是否成功，均重新启动服务。
trap 'docker compose start radar' EXIT
umask 077
docker cp "$(docker compose ps -aq radar):/app/.data" "$backup/data"
cp .env "$backup/env"
```

备份含邮箱等私有数据，应限制访问并定期复制至安全的异地存储。
