# Peach · JAV 入库

在 JAV 作品页点击「加入 Peach」，按番号自动搜索磁力，提交到 115 或 PikPak 云下载，文件落地后由 Peach 入库。

需要已运行的 Peach 写入端，并配置好网盘账号、目标目录与挂载路径。115 通过 CloudDrive2 使用。

## 安装与配对

1. 安装 Tampermonkey 和本脚本。
2. 在运行 Peach 的电脑上打开「Peach 配置 → 下载渠道 → 浏览器添加 JAV」，选择下载渠道，点击「启用并生成令牌」。
3. 在支持的站点打开脚本菜单「配置 Peach 地址与令牌」，填入 Peach 地址与专用令牌。
4. 允许脚本连接自己的 Peach 地址。浏览器须信任 Peach 的 HTTPS 证书；HTTP 仅支持回环地址。

专用令牌只在生成时显示。需要重新配对时，在 Peach 更新令牌；关闭浏览器添加会撤销令牌。

## 支持的站点

登记 78 项站点、104 个域名。自动识别适用于作品详情页；其他站点先选中一个完整番号，在脚本菜单选择「选中番号加入 Peach」，再点击添加按钮。站点改版或身份有冲突时，也可以使用这个操作。

| 类别 | 自动识别 | 选中番号添加 |
| --- | --- | --- |
| 在线播放 | MissAV、Jable、JAV.guru、NJAV / 123AV、JAVtiful、7mmtv | SupJAV、JAVMost、JAVGG、HPJAV、ThisAV、JAVHD、NETFLAV、BestJavPorn、AVJOY、GGJAV、AV01、HighPorn、EvoJAV、HayAV、JAVHub、JAVRate、Paipancon |
| 数据库 | JavDB、JavBus、JavLibrary、Jav321、AVBase、JAVDatabase | JAV.land、AVMOO、AVSOX、AV-Wiki、FC2PPVDB、FC2CmaDB、JAVTrailers、JavArchive、JAVten、r18.dev、JAVMenu、AirAV、JavCV |
| 发行平台 | — | FANZA / DMM、MGS、DUGA、Prestige、SOD / SODprime、FALENO、FC2 内容市场 |
| 片商 | — | S1、MOODYZ、IdeaPocket、Madonna、Attackers、Premium、Kawaii、MAX-A、MAXING |
| 无码 | — | 一本道、加勒比、天然むすめ、Pacopacomama、HEYZO、Tokyo-Hot |
| 资源 | — | manko.fun、Sukebei、OneJAV、Free JAV Torrent、16mag、141JAV、141PPV、FreeJavBT、色花堂、SEX169、2048论坛、JavBooks、JavFree、ProjectJav |

12 项自动识别，66 项选中番号添加。域名以脚本的 `@match` 为准；登记范围经过模拟页面回归，全部站点的真实扩展与网盘联合验收未取得。

镜像与新增站点参考 6 个公开 Sleazy 脚本的版本、安装数和域名声明，并结合 HTTPS 首页探测复核。403 挑战、年龄确认页、空白或混淆首页不能证明详情页已验收。色花堂当前仅按脚本声明登记；更多证据见 [公开复核记录](https://github.com/peach-mitao/peach-userscript/blob/main/docs/evidence/site-review.json)。

## 添加与进度

点击后可关闭来源页面，Peach 会保存队列并继续搜索。馆藏已有、下载中的番号会显示现有状态。云下载与入库进度在 Peach 活动页查看。

未找到资源或任务失败时，可主动重试。网络超时会先查询状态。已经提交的下载从 Peach 活动页取消。

## 权限与来源信息

脚本用专用令牌访问自己的 Peach。`@connect *` 用于用户自行配置的 Peach 地址。网盘账号由 Peach 管理。

提交内容为番号和来源页面地址；地址只保留协议、主机、路径及允许的作品标识参数，例如 JavLibrary 的 `v`、FANZA 的 `id`、色花堂的 `tid`。不提交来源站 Cookie 或播放器地址。

脚本用于云下载入库；直接在 Peach 播放来源网站的视频属于后续功能。
