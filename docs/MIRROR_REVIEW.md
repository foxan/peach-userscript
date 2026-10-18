# 站点与镜像候选复核

该工具帮助从热门 Sleazy 脚本发现镜像和遗漏的 JAV 源站。它只读取用户脚本元数据中 `@match`、`@include` 和 `@connect` 的显式域名，不执行代码，不接受远程代码作为 Peach 规则，也不修改 `jav-sites.json`。没有定时任务。连接声明可能包含无关服务，必须复核用途。

## 固定来源

人工选择一个公开脚本版本，将源码快照保存到 `evidence/`，计算原始文件 SHA256，再在 `mirror-sources.json` 的 `sources` 中登记。当前清单包含 6 个已固定来源的元数据快照，可离线复现候选；快照保存在 `docs/evidence/sleazy-metadata/`，只包含域名声明和来源 hash，不包含第三方实现源码。

```json
{
  "id": "reviewed-script-version",
  "url": "https://update.sleazyfork.org/scripts/123/456/example.user.js",
  "evidence_url": "https://sleazyfork.org/zh-CN/scripts/123-example",
  "path": "evidence/reviewed-script-version.user.js",
  "sha256": "原始快照的64位小写SHA256"
}
```

上例为原始快照的结构说明，不是已取得的来源。脚本 ID、版本、地址与 hash 均需替换为实际证据。登记 URL 只能是公开 Sleazy HTTPS 地址，不带凭据、查询或片段。记录热门程度、抓取日期、版本和站点归属证据时，不保存登录信息、令牌或私有页面。元数据快照使用 `format: metadata`，并额外固定 `metadata_sha256`，候选工具同时核对元数据与来源 hash 关联。

## 生成候选

在仓库根目录离线重放已有快照：

```powershell
npm run candidates
```

只有明确需要下载缺少的已登记快照时，手动启用网络获取：

```powershell
npm run candidates -- --fetch
```

网络获取只访问登记的原始 Sleazy 地址，拒绝重定向，单次超时 15 秒，大小上限 2 MB，无自动重试。文件 hash 不符即失败；已有快照不会覆盖。缺失的元数据快照须从本地取证重新生成，不通过网络补写。无需网络即可重放同一批元数据快照并得到相同结果。

结果在 `candidates/mirrors.json`，包含来源 URL、快照 SHA256、提取规则、已登记站点关联及未解析的模式。新站点的 `registered_site` 为 `null`。所有域名都标记为 `candidate`、`review: required`、`confidence: unverified`，包括已登记域名。`evidence/` 与 `candidates/` 默认不进入 Git；需要公开证据时，只提交复核所需的最小文本和公开 URL，并遵守来源许可。

`scripts/record-review.mjs` 用于将本地 `sources.json`、`domain-probes.json` 和脚本归档整理为公开元数据快照及站点复核记录。它校验来源 hash，记录归档字节 hash；CRLF 归档只有在转为 LF 后与来源 hash 完全一致时才接受，并写明转换。它不复制脚本实现，也不修改站点清单。工具中的来源归属映射对应本次人工审阅范围，新的审阅范围需明确维护。

## 人工复核与发布

1. 核对来源是否为所讨论的脚本和版本，并记录其公开热门程度依据。
2. 对照 `jav-sites.json`，区分既有主站、镜像、独立新站和无关工具站。
3. 使用主页、官方迁址公告或可复现详情页确认域名归属；未取得证据的候选保持待核验。
4. 将明确通过复核的条目手动写入 `jav-sites.json`。新增自动规则须补详情页夹具；其余使用选中番号。
5. 递增脚本版本，构建并验证，发布同一版本的安装脚本和站点快照。Peach 服务端消费对应快照。

候选结果不会自动触发生产配置、真实下载、远程仓库写入或发布。
