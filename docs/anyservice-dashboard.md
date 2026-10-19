# 小程序看板接口

复用网站现有只读接口，通过 AnyService 的 `dashboard` 服务调用。

小程序必须添加 `view=miniapp`，返回 `meta.view: "miniapp"`。完整网站响应可能超过 AnyService 的 1000KB 限制（错误码 `-606002`）；轻量模式保留额度、收益、行情和日期，省略走势图、逐日额度、公告证据及诊断明细。网站不带参数时仍返回原有完整数据。

## 配置

| 项目 | 值 |
|---|---|
| AnyService 服务标识 | `dashboard` |
| 源站协议 | HTTPS |
| 源站连接信息 | `qdii.tomcattravel.com` |
| 请求方法 | GET |
| 请求路径 | `/api/dashboard?view=miniapp` |
| 查询参数 | `view=miniapp`，请求体为空 |
| 登录要求 | 无；公开看板数据，不依赖 Cookie |

`dashboard` 是服务标识，`/api/dashboard?view=miniapp` 是路径，分别配置。云环境 ID 使用创建这个 AnyService 服务的环境。

## 小程序调用

在 `app.js` 初始化一次：

```js
App({
  onLaunch() {
    wx.cloud.init({ env: '替换为你的云环境ID' });
  }
});
```

新增 `services/dashboard.js`：

```js
async function getDashboard() {
  const response = await wx.cloud.callContainer({
    path: '/api/dashboard?view=miniapp',
    method: 'GET',
    header: {
      'X-WX-SERVICE': 'tcbanyservice',
      'X-AnyService-Name': 'dashboard'
    },
    timeout: 15000
  });
  // HTTP 错误也可能正常返回，不能只依赖 Promise 的 reject。
  if (response.statusCode !== 200) {
    throw new Error(response.data?.error || `看板请求失败：${response.statusCode}`);
  }
  const data = response.data;
  if (!data || !Array.isArray(data.funds) || !Array.isArray(data.changes) || !data.meta) {
    throw new Error('看板数据格式不正确，请检查源站和请求路径');
  }
  return data;
}

module.exports = { getDashboard };
```

页面中调用（按页面所在目录调整引用路径）：

```js
const { getDashboard } = require('../../services/dashboard');

Page({
  data: { funds: [], changes: [], meta: null, loading: true, error: '' },
  async onLoad() {
    try {
      const { funds, changes, meta } = await getDashboard();
      this.setData({ funds, changes, meta });
    } catch (error) {
      this.setData({ error: error.message || '网络暂时不可用' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
```

## 返回数据

HTTP 200，JSON 直接返回以下字段，没有额外的 `data` 包装；上面 SDK 的 `response.data` 就是这个对象。

| 字段 | 类型 | 用途 |
|---|---|---|
| `funds` | 数组 | 基金列表，包含场外份额和场内 ETF |
| `changes` | 数组 | 近 30 天额度动态；不是个人通知列表 |
| `meta` | 对象 | 更新时间、同步状态、数据覆盖情况 |

常用基金字段：`code`、`name`、`share`、`index`、`venue`、`agency`、`direct`、`returns`、`returnsAsOf`、`quote`、`stale`、`dataIssueCount`。`venue === 'etf'` 为场内 ETF，其他为场外基金。`agency` / `direct` 中的 `status` 表示额度状态，`limit` 表示金额。

| `status` | 展示含义 |
|---|---|
| `open` | 可申购，展示 `limit` 元／日 |
| `paused` | 暂停申购 |
| `unavailable` | 当前渠道不可购买 |
| `unknown` | 待核验 |
| `not_applicable` | 不适用场外申购额度 |

缺失金额、收益和行情不能显示成 0。场内 ETF 的 `quote` 可能为 `null`，有行情时按 `quote.date` 标注交易日。`meta.updatedAt` 可能为 `null`；各基金／字段的实际日期以对应字段为准，`stale` 和 `dataIssueCount` 用于提示缺失或过期数据。

接口读取当前已存数据，不触发同步。即使 HTTP 200，也要展示更新时间和数据异常状态。通常每天北京时间 07:30、16:30 同步，早间时间可配置，启动补抓和失败重试可能额外更新。

## 联调

先确认源站：

```sh
curl --fail-with-body 'https://qdii.tomcattravel.com/api/dashboard?view=miniapp'
```

再在微信开发者工具中调用 `getDashboard()`，确认返回 `funds`、`changes` 和 `meta`。若失败，核对云环境、服务标识、路径及 AnyService 返回的源站状态。源站 HTTP 成功不代表 AnyService 链路已经验证成功。

本接口只提供公开数据，不读取或信任客户端传入的微信身份，也不要求在小程序中放置管理员令牌或源站密钥。后续个人订阅接口需要另外实现可信身份校验。

参考：[AnyService 使用指南](https://docs.cloudbase.net/anyservice/usage)。
