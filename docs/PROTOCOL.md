# Peach 浏览器添加协议

脚本使用 Peach 现有 `/api/jav-browser` 接口。Peach 是独立服务，负责校验番号、验证来源、搜索磁力、选择下载渠道、保存队列和入库。脚本不接触网盘凭据，也不从页面直接采纳磁力。

## 配对与传输

在 Peach 的浏览器添加设置中启用并生成专用令牌。脚本管理器将 Peach origin 和令牌保存在 `peach.jav.base` 与 `peach.jav.token`，所有请求通过 `GM_xmlhttpRequest` 发往用户配置的 Peach origin。

地址接受 HTTPS；HTTP 仅接受 `localhost`、`127.0.0.1`、`[::1]`。地址须为 origin，不能带用户名、密码、路径、查询或片段。令牌不能为空，最多 256 字符，不接受换行。请求使用 `Authorization: Bearer <专用令牌>`，`Accept: application/json`，`anonymous: true`，单次超时 15 秒。`@connect *` 用于自选 Peach 地址；脚本的请求目标始终来自有效配置。

## 查询状态

`GET /api/jav-browser?code=SSIS-057` 仅查询状态。首次识别、请求结果不确定和已提交任务的按钮操作均使用查询。查询请求不带来源页面或令牌查询参数。

## 添加任务

`POST /api/jav-browser` 使用 `Content-Type: application/json`，请求体为：

```json
{"code":"SSIS-057","source_url":"https://javdb.com/v/opaque123"}
```

| 字段 | 内容 |
| --- | --- |
| `code` | 单个明确番号，由 Peach 最终校验并规范化 |
| `source_url` | 来源 HTTPS 页面的 origin、路径与允许的作品参数，不带片段、其他查询参数、Cookie 或页面正文 |

同域及登记域名的子域符合站点匹配规则。JavLibrary 允许 `v`，FANZA / DMM 允许 `id`，色花堂允许 `tid`；参数值必须唯一且匹配 `[A-Za-z0-9_-]{1,100}`。色花堂的 `mod=viewthread` 不属于保留参数。Peach 服务端独立检查来源 URL 和允许的参数，具体接受范围以部署版本自带的站点快照为准。

## 响应与恢复

成功响应必须为 JSON，包含 `ok: true`、与请求番号一致的 `code` 和已知 `state`。`message` 由服务端提供，脚本使用自己的状态文案。

| `state` | 脚本行为 |
| --- | --- |
| `idle` | 允许主动添加 |
| `queued`、`searching`、`submitted` | 查询进度，不重复提交 |
| `ingested`、`owned` | 显示完成状态，添加按钮禁用 |
| `failed`、`no_match` | 允许用户主动重试 |

队列状态每 2 秒查询一次，最多追加 30 次，轮询总预算 120 秒。达到上限后保留查询按钮。网络超时、401 / 403、非成功 HTTP、未知状态、无效 JSON 和番号不匹配都保留查询入口。请求结果不确定时不会自动重复 POST。

页面跳转会隔离旧响应；重复执行脚本只注入一次。任务取消在 Peach 活动页执行。实际云下载和入库状态以 Peach 为准。
