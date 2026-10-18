# Peach · JAV 入库

在 JAV 作品详情页识别或选中番号，点击「加入 Peach」，交给自己的 Peach 搜索磁力、提交云下载并入库。脚本需要已运行的 [Peach](https://github.com/peach-mitao/peach) 写入端，并在 Peach 配置好下载渠道、目标目录和挂载路径。

## 安装与配对

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开[可直接安装的脚本](https://raw.githubusercontent.com/peach-mitao/peach-userscript/main/dist/peach-jav.user.js)，在脚本管理器中确认安装。
3. 在 Peach 打开「Peach 配置 → 下载渠道 → 浏览器添加 JAV」，启用并生成专用令牌。
4. 在支持的站点打开脚本菜单「配置 Peach 地址与令牌」，填入自己的 Peach 地址和专用令牌。
5. 允许脚本连接该 Peach 地址。浏览器须信任其 HTTPS 证书；HTTP 仅支持回环地址。

详情页能够明确识别单个番号时，右下角显示添加按钮。其他页面可选中一个完整番号，再使用脚本菜单「选中番号加入 Peach」。状态查询不会创建下载任务。任务由 Peach 保存，关闭来源页面后继续处理。

专用令牌只保存在脚本管理器的 GM 存储中。脚本不提交来源站 Cookie、播放器地址或整页正文。来源地址仅保留作品路径和清单允许的作品标识参数。网盘凭据由 Peach 管理。

## 支持的站点

支持范围由 [`jav-sites.json`](jav-sites.json) 唯一维护；构建同时生成安装匹配规则、内联运行规则及供 Peach 后端验证的站点快照。登记不代表站点当前可达或已取得真实扩展、源站与网盘联合验收。已完成合成页面行为回归，具体接入方式见 [站点规则](docs/SITES.md)。

## 构建与验证

使用 [Node.js 24 LTS](https://nodejs.org/en/about/previous-releases)。构建与基础单测仅使用 Node 内置模块，无运行依赖。浏览器回归的唯一开发依赖为 `playwright-core`。

以下命令均在仓库根目录执行。生成确定性的安装脚本及站点快照：

```powershell
npm run build
```

执行构建和候选工具的基础单测：

```powershell
npm test
```

按锁文件安装浏览器测试依赖：

```powershell
npm ci --ignore-scripts
```

安装用于离线合成页面回归的 Chromium：

```powershell
node node_modules/playwright-core/cli.js install chromium
```

核对已提交产物并运行全部测试：

```powershell
npm run verify
```

有本机 Chrome 时，可将 `PEACH_E2E_CHROME` 设置为其完整可执行文件路径。测试拦截所有页面请求并模拟 GM API，不访问真实 Peach、源站或网盘。真实扩展权限确认与网盘联合验收仍需在实际部署中完成。

## 发布与 Peach 同步

`dist/peach-jav.user.js` 可直接安装，`dist/jav-sites.json` 是版本化站点快照，`dist/release.json` 记录脚本版本与两个文件的 SHA256，`dist/SHA256SUMS` 用于校验制品。构建不写时间戳、不访问网络。CI 检查已提交制品与源文件一致，并上传制品。

Peach 主仓库消费同一次发布的脚本与站点快照，服务端继续独立验证来源域名和作品参数。维护脚本或站点时在本仓库修改、构建、验证，递增版本后同步制品；协议说明见 [Peach API](docs/PROTOCOL.md)。[Sleazy 发布说明](docs/SLEAZY.md) 可用于发布页面。

需要交给其他项目时，可运行 `npm run export -- --output <制品目录>`，导出这四个文件。导出前会核对源与产物一致；相同内容可重复导出，已有不同内容会被拒绝，防止覆盖混合版本。

同步到 Peach 隔离工作树时，使用 `node scripts/export-peach.mjs --target <Peach隔离工作树> --commit <本仓库40位提交SHA>`。默认仅预览，添加 `--apply` 才写入 `web/integrations/` 中的脚本、站点快照与 `jav-userscript-release.json` 来源记录。工具校验工作树注册关系、Peach 项目标识、发布清单与 hash，不访问网络、不执行 Git 或服务命令。

## 站点与镜像候选

[候选同步工具](docs/MIRROR_REVIEW.md) 从人工选定并固定 SHA256 的 Sleazy 用户脚本元数据中，提取显式 `@match` / `@include` / `@connect` 域名，辅助发现镜像和缺少的源站。仓库提供 6 个不含第三方实现的元数据快照，支持离线重放。所有候选结果保持待复核；工具不执行远程代码，也不改 `jav-sites.json`。没有自动站点同步或定时任务。

## 许可证与来源

采用 [AGPL-3.0-or-later](LICENSE)。用户脚本和回归测试来自 Peach 项目，固定来源和依赖说明见 [NOTICE](NOTICE.md) 与 [复用记录](docs/REUSE.md)。
