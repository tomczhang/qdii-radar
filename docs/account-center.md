# TomcatTravel 统一账号接入

额度雷达使用 account-center 的 Keycloak OIDC，不托管密码。`/login`、`/register` 提供统一账号入口，注册、邮箱验证、找回密码和账号管理均在账号中心原生页面完成。看板、计算器继续免登录可用；未配置账号服务时显示未开放，业务功能不受影响。

## 身份和权限的边界

统一账号仅证明身份。每个产品独立的 OIDC client 接收以自身为 audience 的登录结果，不能接受其他产品的 ID token。额度雷达按 `(issuer, sub)` 创建自己的 `account_users`，不以邮箱作为永久主键、不按同邮箱自动合并用户。已有本地用户在每次成功登录时更新邮箱和显示名。

会员、角色、付费功能和使用额度属于产品后端。本次没有新增收费或会员权限，也没有把登录当作会员资格。现有管理员 API 仍要求独立管理员凭证，普通统一账号不获得管理权限。未来可以在额度雷达本地用户下增加会员/权限表，由每个受保护 API 校验；若统一售卖跨产品套餐，也需要显式的产品标识及授权同步接口。其他平台的会员不会自动授予额度雷达会员。

收藏与计算方案仍保存在当前浏览器，不做云同步。已登录时，保留的订阅 API 使用本地用户的稳定标识隔离数据；匿名订阅不自动迁移、邮箱验证不跳过。通知入口仍关闭。

## 客户端登记与配置

生产 issuer：`https://auth.tomcattravel.com/realms/tomcat`。

登记独立的 confidential web client `qdii-radar`：

- 开启 Authorization Code，强制 PKCE S256。
- 登录回调：`https://qdii.tomcattravel.com/auth/callback`。
- 退出回调：`https://qdii.tomcattravel.com/auth/logout/callback`。
- 不启用 implicit、password grant、service accounts、通配回调或匿名动态注册。
- scope 为 `openid email profile`，ID token 签名算法为 RS256，邮箱必须验证。

[客户端配置片段](account-center-client.example.json) 使用 account-center 的客户端配置格式。片段仅供新增客户端时参考，**不是覆盖现有 realm 或 clients 的导入文件**；现有账号中心需要定点添加、检查，不重新导入已有用户。不要复用其他产品密钥。

在额度雷达部署环境配置：

```dotenv
PUBLIC_BASE_URL=https://qdii.tomcattravel.com
ACCOUNT_CENTER_ISSUER=https://auth.tomcattravel.com/realms/tomcat
ACCOUNT_CENTER_CLIENT_ID=qdii-radar
ACCOUNT_CENTER_CLIENT_SECRET=<此客户端的专属密钥>
```

account-center 配置生成器使用的 `QDII_RADAR_OIDC_CLIENT_SECRET` 与额度雷达使用的 `ACCOUNT_CENTER_CLIENT_SECRET` 应为这个新客户端的同一个密钥；它们只存在各自服务端私密配置中。所有三项留空则关闭账号登录；部分配置或不安全的地址会拒绝启动。生产要求 HTTPS，开发仅对 loopback 地址允许 HTTP。

两个 GET 回调已在 `server/auth.mjs` 实现：登录回调验证授权结果后建立本地会话并返回原页面；统一退出回调验证一次性 state 后返回登录页。本地退出不经过账号中心。客户端编号通过环境变量传入，与回调路径无关；登记 `qdii-radar` 后使用上述配置即可，回调 URL 不包含客户端编号。

本地开发登记另一个客户端，例如 `qdii-radar-local`，使用本机 issuer `http://127.0.0.1:8180/realms/tomcat`，登录回调 `http://localhost:4387/auth/callback`、退出回调 `http://localhost:4387/auth/logout/callback`，并将 `PUBLIC_BASE_URL` 设为 `http://localhost:4387`。精确匹配主机和端口，不混用 localhost 和 127.0.0.1。不要将开发回调加入生产客户端。

配置后重建或重启产品服务。`.env` 不提交，不能使用 `VITE_` 前缀。反向代理、CDN 不缓存 `/auth/*`、`/api/auth/*`，认证路径访问日志不记录查询串或 Location 响应头（授权码、结束会话的 ID token hint 均属敏感信息）。页面使用 `Referrer-Policy: no-referrer`。

## 会话与退出

- 使用 `openid-client` 的 discovery 获取端点，校验 ID token 签名、issuer、audience、时效、nonce；回调校验 state 与 PKCE。拒绝未验证邮箱。
- 10 分钟的登录事务绑定 HttpOnly Cookie，一次使用即销毁；仅允许返回首页、计算器、额度动态。回调地址取固定配置，不信任请求 Host。
- 本地会话最长 8 小时，登录时更换随机会话标识，数据库只保存标识摘要；Cookie 为 HttpOnly、SameSite=Lax，HTTPS 使用 Secure 和 `__Host-` 前缀。会话和用户映射随 SQLite 持久化。
- 不保存 access/refresh token、不申请 offline_access。仅服务端存储结束会话所需的 ID token；浏览器 JavaScript、localStorage、sessionStorage 不获取令牌。
- 退出通过原生 POST 表单提交，校验 Origin 与 CSRF；浏览器在 no-referrer 下发送 `Origin: null` 时，额外要求浏览器控制的 `Sec-Fetch-Site: same-origin` 和有效 CSRF，不接受来源不明或跨站请求。退出本产品删除本地会话；退出统一登录还进入账号中心的标准结束会话流程，并校验一次性退出 state。
- 本次不接 backchannel logout，也不逐请求检查中心会话。因此账号中心改密、禁用或其他产品发起统一退出，**不会立即撤销额度雷达已建立的本地会话**，最长持续至 8 小时有效期结束。额度雷达发起统一退出时先删除自己的会话；其他产品的本地会话由其自身机制处理。不要将此描述为所有设备立即退出。
- 数据目录及备份包含邮箱和会话信息，继续按私密数据保护。

## 验证

```sh
node --test test/auth.test.mjs
npm test
npm run build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/account-smoke.mjs
```

协议测试使用独立的本地 RSA 签名 OIDC fixture，验证真实 `openid-client` 的换码和签名验证路径，包括伪造 state、nonce、issuer、audience、签名、过期、PKCE、授权码重放、未验证邮箱、跨身份隔离、会话轮换/持久化、CSRF 和退出。浏览器测试使用临时数据库、同一个本地 fixture；不连接生产账号、不发送邮件。截图写入 `outputs/account-center/`。

这些测试不等同于真实 Keycloak 或生产验收。正式登记后还需验证：真实注册及验证邮件、已有账号登录、跨产品 SSO、找回密码、账号管理、两种退出，以及重启后的登录态恢复。

2026-10-19 本次验证：全量 167 项测试通过；随后 Cookie/退出兼容修正的 12 项账号与订阅测试通过；构建及桌面/手机浏览器测试通过。浏览器测试使用 localhost 与 127.0.0.1 两个站点，覆盖跨站登录/统一退出时匿名身份 Cookie 的保留，并确认普通账号不能访问管理员 API。生产 discovery 初次请求被办公网络按进程拦截；用户放行 Node 后重试返回 HTTP 200，issuer 正确并支持 S256 PKCE 和结束会话。此结果仅确认协议发现可达；未登记或部署生产客户端，也未改动账号中心已有配置，真实生产登录尚未验收。
