# 复用记录

用户脚本保留 Peach `f8ca8a5b9ac57f6873661c98db7f6df3694535f9` 的识别、来源净化、GM 凭据存储、请求、状态轮询及 SPA 生命周期行为。构建复用原安装端点按站点清单生成 `@match` 与内联 JSON 的边界，使用 Node 内置 `fs`、`crypto` 和 `node:test`，不引入打包器或运行依赖。

已检查源树的用户脚本、路由与浏览器测试，`docs/REUSE.md` 中的 GM API 记录，以及历史提交 `509827d5` 和 `a15b1758`。Tampermonkey [官方文档](https://www.tampermonkey.net/documentation.php) 定义存储、菜单、跨域请求与 URL 变更通知。浏览器测试复用 `playwright-core` 1.64.0（Apache-2.0），沿用主项目精确版本；这是开发依赖，不进入制品。

[Node.js 官方测试入口](https://nodejs.org/docs/latest-v24.x/api/test.html) 与原生 TypeScript 类型擦除满足测试运行要求。未引入 Vite、Rollup、webpack 或用户脚本框架：产物只需两处确定性标记替换，不涉及模块分包。完整浏览器扩展增加独立权限和发布流程，现有需求由脚本管理器承接。

镜像和缺少源站的发现复用 Sleazy 用户脚本的公开元数据格式。只解析人工选定且固定 SHA256 的快照，禁止执行远程脚本；通配主机、正则 include 等不能安全确定域名的规则保留为跳过记录。域名归属、自动识别和服务端信任属于 Peach 的复核边界。

最小实证为确定性构建、字节一致性校验、候选快照 hash 校验、离线同步与合成 Chromium 页面回归。真实扩展和真实网盘联合验收未取得。构建和测试不写生产或 ledger。
