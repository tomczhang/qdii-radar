# 额度雷达

项目仓库：https://github.com/tomczhang/qdii-radar

本机开发目录：`/Users/tomczhang/Documents/git/qdii-radar`。原 Codex 工作目录保留作迁移前备份；日常开发和服务启动使用本目录。

国内纳斯达克100、标普500 QDII 基金的真实额度看板。React + Express + SQLite，同一服务提供响应式页面、数据 API、公告更新任务和邮箱订阅。当前目录覆盖 16 个人民币基金份额，清单在 `server/catalog.json`。

## 运行

要求 Node.js 24（使用内置 SQLite）。

```sh
npm install
# 首次安装且不存在 .env 时执行；不要覆盖已有配置
cp .env.example .env
npm run dev
```

打开 http://localhost:4387 。生产运行：

```sh
npm run build
npm start
```

`.env` 配置服务端地址、Resend/SMTP、管理员令牌和可选聚源 MCP。`ADMIN_TOKEN` 应使用随机长字符串。密钥不能使用 `VITE_` 前缀。当前本地 `.env` 已生成管理员令牌；不要提交该文件。

## 数据来源与口径

| 数据 | 当前来源 | 处理 |
|---|---|---|
| 代销状态、单日上限 | 天天基金 `FundMNBasicInformation` | 暂停优先于残留额度；不销售与暂停分开；缺失或哨兵值不当作无限额 |
| 近1、3、5年累计收益 | `FundMNPeriodIncrease` | 使用接口收益截止日期；不足年限留空，不按年化展示 |
| 近30个净值日走势 | `FundMNHisNetList` | 链接每日净值增长率，基准100；缺失时截取最近连续数据，上游小数舍入会产生误差 |
| 直销额度 | 基金公司公告，当前经天天基金公告索引/PDF镜像获取 | 存公告原文、份额、渠道、生效时间与提取依据 |
| 主收益与净值来源（配置后） | 恒生聚源 MCP `FinQuery` | 校验基金代码、人民币份额、成立日期、收益日期与净值；更新收益、走势和对应日涨幅，失败回退天天并标明来源 |

公告列表端点：`https://api.fund.eastmoney.com/f10/JJGG`，正文 PDF 来源：`https://pdf.dfcfw.com/pdf/H2_<公告ID>_1.pdf`。这不是已签约的数据 SLA，也不是逐个基金公司官网爬虫；公告镜像有延迟或故障时会显示更新时间/待核验。生产公开展示所需的数据使用授权需另行确认。

不同基金的收益、净值截止日可能不同，页面分别标注。额度是公告/销售渠道的账户单日上限，不是个人剩余额度，也不能默认跨渠道、跨份额累加。16个直销规则以已核验公告建立基线，保存在 `server/verified-baseline.json`，后续新公告按实际生效时间覆盖。

## 聚源 MCP 接入

已实测官方地址支持 **Streamable HTTP**，Token 使用查询参数认证；代码在发请求时从环境变量组合，配置 URL 本身不含密钥：

```dotenv
GILDATA_MCP_URL=https://api.gildata.com/mcp-servers/aidata-assistant-srv-tool
GILDATA_MCP_TOKEN=<你的Token>
GILDATA_MCP_TRANSPORT=http
GILDATA_MCP_AUTH=query
```

仅填 Token 也会使用上述默认地址。兼容其他服务配置的 `sse` 传输和 `bearer` 认证，但当前官方地址已验证使用 `http` + `query`。用 SDK `initialize`/`tools/list` 确认工具，再调用 `FinQuery`；不在浏览器直连 MCP。超时或返回不符合约定时回退天天数据，并记录每个份额的失败状态。

2026-10-15 实测16个份额全部成功，聚源与天天同截止日可比较的1/3/5年累计收益未发现超过0.02个百分点的差异。此结论仅对应本次数据，不能代替持续核验。供应商数值不作为直销额度证据：代销继续取天天，直销继续按基金公司公告。

收益按一组、净值/日涨幅/走势按另一组整体选择较新来源，页面分别显示来源和截止日期。拒绝错误代码、未来日期、缺失成熟区间、冲突净值；不满对应年限的收益留空。同步结果提供 `gildataSuccess` / `gildataErrors`，看板提供实际使用聚源的份额数；“已配置”不冒充“成功取数”。

## 每日公告任务

服务运行期间，每日 **07:30（Asia/Shanghai）** 同步全部份额的额度、收益、净值和公告。启动时补做当天错过的任务；部分失败15分钟后重试。每天一次不能保证捕获当日盘中的即时变化。

流程：

1. 逐份额分页获取全部类型公告，再筛选申购/定投/转换转入限制、恢复和暂停公告。
2. 以“公告ID + 基金代码”去重，保存PDF及文本；至少重叠回查14天，停机较久则从上次扫描日回溯。超过单轮分页上限，保存游标，下轮重查首页并从重叠分页继续。
3. 解析明确的代码、份额、渠道、金额和生效日期。存在扫描PDF、多个日期、特定投资者、渠道细分、交易截止时间等歧义时进入 `pending_review`。正文失败单独重试，不因滚出列表窗口而丢失。
4. 未来规则先入库，到生效时间后由每分钟检查应用。尚未生效时不提前改额度。新公告待核验时直销显示“待核验”，不会继续宣称旧额度已确认。
5. 与最近确认的状态比较，记录恢复/增加/降低/暂停，持久化提醒队列。首次同步只建基线；重复扫描不重复生成变化。同一浏览器同一邮箱的全局和单基金订阅合并去重。
6. 保留失败前的数据和时间；超过36小时无成功数据/公告扫描会提示待更新。任务、队列有数据库锁和失败重试。

手动同步：

```sh
npm run sync
npm run sync -- --notices-only
```

这属于网站服务内部任务，需要服务器持续运行。关闭进程或电脑休眠期间不执行；启动后补抓。无需 Codex 对话自动化。

## 邮箱提醒

`POST /api/subscriptions` 真正写入 SQLite；前端可新增、编辑、删除。当前复用 tomcatTravel 的 **Resend HTTP 服务**，独立保存本项目的队列和订阅。配置如下：

```dotenv
MAIL_TRANSPORT=resend
RESEND_API_KEY=<服务端密钥>
RESEND_FROM="额度雷达 <newsletter@tomcattravel.com>"
PUBLIC_BASE_URL=http://localhost:4387
# 可选：真实可接收回复的邮箱
MAIL_REPLY_TO=
```

当前本地 Key 已从 tomcatTravel 的 `.env` 写入本项目私有 `.env`，原项目未修改。发件地址由用户确认。本地 Key 不能查询域名列表（`restricted_api_key`），因此本次没有独立确认域名状态，也没有实际发送测试邮件。代码使用模拟 HTTP 测试验证投递流程；配置齐备不等于真实投递已验证。

缺少 Key、发件人或站点地址时，返回 `awaiting_configuration`。配置齐备后发送确认邮件；用户点击并确认后才收到变化通知。验证码48小时有效、一次性，提醒邮件带退订链接。本地确认链接只能在运行本服务的电脑打开；公网运行前把 `PUBLIC_BASE_URL` 改为网站 HTTPS 域名。

Resend 的每封邮件使用持久化请求内容和独立的 `qdii-radar/` 幂等 Key；普通重试最多5次，间隔指数退避。429遵循 `Retry-After`，持久化全队列冷却；不可恢复的4xx终止重试。首次尝试超过23小时停止自动重试，避免超出服务商24小时幂等窗口后重复发送。服务商返回邮件ID才记为 `sent`（已接受，不代表已进入收件箱）。发送速率限制为每秒1次；与 tomcatTravel 共用 Key 时仍共享账户限额。

也支持 `MAIL_TRANSPORT=smtp`，配置 `SMTP_HOST`、`SMTP_FROM` 及认证信息；`MAIL_TRANSPORT=disabled` 显式关闭发送。SMTP在送达后断线的极端情况不能保证严格 exactly-once。

订阅通过 HttpOnly 会话 Cookie 归属当前浏览器，接口不会返回其他浏览器的订阅；尚未实现跨设备账号登录。验证链接的 GET 只显示确认页，POST 才激活/退订。`MAIL_TRANSPORT=file` 仅供测试，不投递外部邮件。

## API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/dashboard` | 真实基金数据、额度变化、同步状态 |
| GET | `/api/health` | 进程和任务状态 |
| GET / POST | `/api/subscriptions` | 本浏览器的订阅列表 / 保存 |
| PATCH / DELETE | `/api/subscriptions/:id` | 编辑 / 删除 |
| POST | `/api/subscriptions/:id/resend` | 重发确认邮件 |
| GET | `/api/admin/status` | 任务状态、邮件队列、近期公告 |
| POST | `/api/admin/sync` | 触发同步 |
| GET | `/api/admin/notices/:id/:code` | 查看公告正文摘要和解析结果 |
| POST | `/api/admin/notices/:id/:code/review` | 人工核验规则或忽略公告 |

管理员接口要求 `Authorization: Bearer <ADMIN_TOKEN>`。待核验公告目前通过 API 处理，尚无管理页面。审核请求示例（示例金额不是实际公告结论）：

```json
{
  "reason": "已逐项核对公告正文，适用于人民币A份额直销渠道",
  "rules": [{
    "channel": "direct",
    "status": "open",
    "limit": 100,
    "effectiveAt": "2026-10-16T00:00:00+08:00",
    "note": "单日单基金账户累计，申购和定投合并计算"
  }]
}
```

暂停规则为 `status: "paused", limit: null`。忽略请求为 `{ "ignore": true, "reason": "已确认不涉及本份额的申购额度" }`。人工审核原子写入，错误参数不产生部分规则。

## 持久化与部署

`.data/radar.sqlite` 保存快照、公告规则、事件、订阅、队列及任务状态；`.data/notices` 保存公告，`.data/market` 保存最近原始响应。定期备份整个 `.data`（SQLite在线备份应使用 backup API或停服务后复制）。`.env`、`.data` 均为私有文件且不进入前端构建。开发服务器也禁止直接读取这些路径。

仓库提供 Dockerfile 和 compose.yaml，可使用 `docker compose up -d --build` 启动常驻服务并挂载数据卷；本次未部署到公网。正式域名的 `PUBLIC_BASE_URL` 应为 HTTPS，并配置反向代理证书；仅在后端不能被绕过代理访问时设置 `TRUST_PROXY_HOPS=1`。当前是单实例 SQLite 设计，多实例部署前需共享数据库及统一队列。

## 验证

```sh
npm test
npm run build
```

测试覆盖额度状态口径、真实公告样本、未来生效、分页补抓、待核验恢复后的变化、订阅隔离、确认邮件、通知去重和退订。邮件测试只写临时目录或调用模拟 HTTP，不使用真实 Key、不投递外部邮件。只读浏览器验证脚本为 `scripts/ui-smoke.mjs`，检查桌面/手机布局、排序和弹窗，不提交订阅、不发送邮件。需要可用的 Playwright/Chrome；可用 `PLAYWRIGHT_MODULE` 指定 Playwright 模块路径，执行 `node scripts/ui-smoke.mjs`，截图和结果写入被 Git 忽略的 `outputs/visual-refresh`。

Resend 接口依据：[发送邮件](https://resend.com/docs/api-reference/emails/send-email)、[幂等与24小时窗口](https://resend.com/docs/dashboard/emails/idempotency-keys)。
