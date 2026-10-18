# 来源与归属

本项目的初始脚本、站点清单、浏览器回归与使用说明来自 Peach 项目，维护者为 longmeidao 与 Peach 贡献者，沿用 AGPL-3.0-or-later。

固定来源：[peach-mitao/peach，revision `f8ca8a5b9ac57f6873661c98db7f6df3694535f9`](https://github.com/peach-mitao/peach/tree/f8ca8a5b9ac57f6873661c98db7f6df3694535f9)。源路径为 `web/integrations/peach-jav.user.js`、`web/integrations/jav-sites.json`、`frontend/e2e/jav-userscript.test.ts`、`docs/JAV_USERSCRIPT_SLEAZY.md` 和 `docs/JAV_BROWSER_SITES.md`。

本仓库负责脚本与站点清单的独立维护、构建和发布。Peach 服务端保留发布制品和站点验证快照。

`playwright-core` 1.64.1 为 Apache-2.0 许可的开发依赖，不打入用户脚本。脚本使用 Tampermonkey 官方 GM API；Tampermonkey 由用户独立安装，不作为项目分发内容。候选同步工具只从来源快照读取元数据并保留来源 URL 和 SHA256，不复制或执行第三方脚本实现。
