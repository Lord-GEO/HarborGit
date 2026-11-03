# IntelliJ IDEA 2026.1.3 标签创建与推送增量分析

分析日期：2026-11-03。范围是本机已安装构建的静态证据；不操作用户仓库、不创建标签、不访问真实远端。本轮没有修改 HarborGit 软件或版本。

## 结论和阅读边界

本机 IDEA 有图形化创建及推送标签的实现，标签并非只能用命令行创建。两条创建入口不同：Git 菜单标签操作打开完整表单；Git Log 所选提交的 New Tag 打开仅输入名称的快捷框。Push 窗口支持 Push tags 的 All 和 Current Branch；标签上下文另有按远端生成的单标签推送动作。

以下“已确认”指本机构建中的注册资源、字节码和参数构造已确认，不能等同于本轮实际点击或执行观察。没有把 2026.2 网页文档当作本机 2026.1.3 事实。Git 参数的含义单列为推断/解释；用户当前设置、真实远端权限和推送结果未观察。

## 目标身份、REA 和文件格式限制

安装根：`D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3`，已知产品构建 IU-261.25134.95。此次重新计算两份实际 JAR 的 SHA-256，与前轮匹配；没有重做全盘搜索或全量库存。

| 本机 artifact | 大小 | SHA-256 |
| --- | ---: | --- |
| plugins/vcs-git/lib/vcs-git.jar | 14989928 | 6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0 |
| plugins/vcs-git/lib/vcs-git-frontend.jar | 1475108 | 0e5135d36bcb94fbf4f5773bb123bd2f964566b872988bee6d5cfc6a0de75a17 |

身份原始记录：[source-identities.json](evidence/tags-2026-11-03/source-identities.json)。逐个 class 的 member SHA-256、JAR 路径、javap 参数和输出 SHA-256 在 [javap-provenance.json](evidence/tags-2026-11-03/javap-provenance.json)；复用的六份反汇编身份在 [reused-bytecode.json](evidence/tags-2026-11-03/reused-bytecode.json)。这里的字节码位置 `+N` 是指定方法中十进制 JVM 指令偏移，不是 JAR 文件偏移或源码行号。

REA 6.8.0 本轮起止均无打开的 target；只针对已保存 inventory Evidence 精确查询六个相关 class occurrence，命中 6/6：
- 原库存 Evidence：`ev_b3436a50eea22fcaae9597c602b3ada48b0592bf729014c1efc1ffce19e530e3`，见 [原 bundle](evidence/rea-evidence-bundle.json)。
- 本轮 selected-occurrences Evidence：`ev_aa63bf157dd383021a641b4d80cc1d1bc5769367a3707e8ee2622945381deffc`，见 [完整工具返回](evidence/tags-2026-11-03/rea-selected-occurrences.json) 和 [本轮导出 bundle](evidence/tags-2026-11-03/rea-evidence-bundle.json)。
- occurrence 身份支持“该 class 存在于该 archive”；它不提供 Java 方法语义。REA 对 JVM class 的既有不支持记录保留在 [rea-class-format-limitation.json](evidence/rea-class-format-limitation.json)，此次未重复失败探测。语义继续使用已有 JDK 21 的 `javap -p -c` 和 Python zipfile，只读取实际安装文件。没有安装或修复 REA/Java 配置。
- [资源选段](evidence/tags-2026-11-03/resource-excerpts.json) 保存原 member hash、原资源行号；[拼接 recipe](evidence/tags-2026-11-03/concat-recipes.json) 补充 javap -v 的 BootstrapMethods 选段，验证 refs/tags/ 前缀与 source:target 拼接。非 ASCII 原输出字节转为显式转义，不把反汇编称为原始源码。

## 已确认：创建标签

| 入口 → 状态 → 调用 → 展示 | 证据位置 |
| --- | --- |
| Git.MainMenu 中 `Git.Tag`（GitTag）及 GitRepositoryActions 引用该动作。动作打开 GitTagDialog，showAndGet 为真才排队后台任务。 | 后端 META-INF/plugin.xml 原行 117、140、173；[GitTag](evidence/tags-2026-11-03/javap/git4idea.actions.GitTag.txt) perform +24…+65；[后台任务](evidence/tags-2026-11-03/javap/git4idea.actions.GitTag$1.txt) run。动作 getActionName 取 tag.action.name=Tag；不将新版文档标签文字当作本机实测文字。 |
| 完整表单有 Repository、当前分支、Tag Name、Commit、Validate、Message、Force。Commit 提示明确留空使用 HEAD；Message 提示非空则创建 annotated tag。已有同名标签时 Force 才启用；未选 Force 会阻止重复名。 | [GitTagDialog](evidence/tags-2026-11-03/javap/git4idea.ui.GitTagDialog.txt) 构造与 validateFields +9…+75；前端 messages/GitBundle.properties 原行 543…556。 |
| `Message.trim().isEmpty()` 为假时写 UTF-8 临时消息文件，并添加 `-a -F <absolute-message-file>`；空消息不添加这两个参数。Force 需同时 enabled 和 selected 才添加 `-f`。随后按独立参数添加标签名和非空 Commit。 | 同文件 runAction +9…+23、+74…+99、+189、+198…+213、+220…+248、+251…+278、+290…+331。命令结构为 `git tag [-a] [-f] [-F <file>] <name> [<commit>]`。 |
| 执行 Git.runCommand，按 success 分支显示成功或包含 stderr 的失败通知，刷新 tags files，并清理临时消息文件。 | 同文件 runAction +340、+349、+389、+419、+454、+478…+512。临时文件创建失败单独通知并返回（+133…+174）。 |
| Git Log 右键 `Git.CreateNewTag` 显示 New Tag…，描述为对当前所选 commit 创建标签。文件历史菜单也注册相同动作。 | 后端 XML 原行 39、271、296；前端 properties 原行 736…737、1215…1216。 |
| Log 快捷动作取得所选 hash，只显示名称输入框；取消时不执行。确认后 GitBrancher.createNewTag(name, selectedHash, singletonRepository, null)。未走完整 Message/Force 表单。 | [GitCreateTagAction](evidence/tags-2026-11-03/javap/git4idea.actions.GitCreateTagAction.txt) actionPerformed +24…+29；createNewTag +59、+64、+78。 |
| GitBrancher 服务映射 GitBrancherImpl，后台任务调用 GitBranchWorker，再调用 Git.createNewTag。GitImpl 构造 TAG handler，只添加 name 及非空 reference，不添加 `-a/-F/-f`。失败通知、刷新标签文件。 | 后端 XML 原行 592；[GitBrancherImpl](evidence/rebase-target-2026-10-30/javap/git4idea.branch.GitBrancherImpl.txt) createNewTag +27…+57；[其任务 $3](evidence/tags-2026-11-03/javap/git4idea.branch.GitBrancherImpl$3.txt) execute +13、+28；[GitBranchWorker](evidence/javap/git4idea.branch.GitBranchWorker.txt) createNewTag +66、+80、+155；[GitImpl](evidence/javap/git4idea.commands.GitImpl.txt) createNewTag +44、+68、+90、+106。 |

解释：通常 Git 配置下，完整表单空 Message 与 Log 快捷路径请求轻量标签，完整表单非空 Message 明确请求注解标签。严格的本机代码事实是上述参数，不保证用户任意 Git 配置下最终对象类型。本轮未读取签名相关 Git 配置或动态验证对象类型。`Force` 是这条本地 `git tag -f`，不能据此推断它授权或执行远端强制覆盖。

## 已确认：Push tags 选项和记忆

| 流程 | 静态证据 |
| --- | --- |
| PushSupport 创建面板时读取 GitVcsSettings.getPushTagMode；Git 版本是否支持 FOLLOW_TAGS 决定模式组合框是否显示。 | [GitPushSupport](evidence/tags-2026-11-03/javap/git4idea.push.GitPushSupport.txt) createOptionsPanel +8、+11…+25。 |
| 传入 mode 非 null 才选中 Push tags；有值时选择该模式。取消勾选后 getValue 返回 tagMode=null；旧 Git 无可见组合框时勾选使用 ALL。 | [GitPushOptionsPanel](evidence/tags-2026-11-03/javap/git4idea.push.GitPushOptionsPanel.txt) 构造 +45…+54、+102…+111；getValue +4…+42。 |
| All 映射 `--tags`；Current Branch 映射 `--follow-tags`。 | [GitPushTagMode](evidence/tags-2026-11-03/javap/git4idea.push.GitPushTagMode.txt) static +54…+79；前端 properties 原行 893…895。 |
| 发起 push 时 GitPusher 取得选项，在执行前 setPushTagMode，包括未勾选的 null。因此重开时可恢复上次发起推送的选择，不是每次强制未选。 | [GitPusher](evidence/tags-2026-11-03/javap/git4idea.push.GitPusher.txt) 四参数 push +17…+86；[GitVcsSettings](evidence/rebase-wip-2026-10-30/javap/git4idea.config.GitVcsSettings.txt) getPushTagMode +7、setPushTagMode +8，委托持久状态 GitVcsOptions 的 pushTags 属性。 |
| GitPushOperation 读取 tagMode.getArgument，null 不产生选项；形成 GitPushParamsImpl 后传到 Git.push。GitImpl 在 handler 中以独立参数追加该非空 tag 参数。 | [GitPushOperation](evidence/javap/git4idea.push.GitPushOperation.txt) doPush +44…+58、+176…+197；[GitImpl](evidence/javap/git4idea.commands.GitImpl.txt) lambda$doPush$2 +262…+278。 |

一般推送命令构造可归纳为 `git push [--progress] --porcelain <remote> <source>:<target> [--tags|--follow-tags] [其他 Push 选项]`；这是字节码构造的摘要，不是本轮实际执行日志。GitImpl 的 progress/porcelain 在 lambda$doPush$2 +49…+83、remote/refspec 在 +97/+111。未勾选只确认不添加上述额外 tag 参数；未观察是否有其他 Git 配置影响实际推送，不能承诺“未勾选就绝不附带任何标签”。

语义解释（来自 Git 参数语义，非 IDEA 动态观察）：`--tags` 请求推送所有本地标签；`--follow-tags` 随本次推送补发指向可达提交、远端缺少的注解标签。“Current Branch” 不是简单地推送所有贴在该分支历史上的轻量/注解标签。这也意味着 Log 快捷创建的普通轻量标签通常需要 All 或明确的单标签推送。

默认状态的证据边界：GitVcsOptions 构造 +570 为 pushTags 调用无参 `BaseState.property()`，未在 Git 插件内传入默认 ALL/FOLLOW。结合 panel 的 null→未选分支，可推断无既有状态时初始未选；此次没有继续解析平台 BaseState 实现或读取用户实际持久设置，故“全新配置一定未选”未列为完全闭环的本机事实。已确认记忆来源和分支条件，不把用户当前勾选状态写成事实。

## 已确认：单个标签推送

后端 XML 原行 215、231、237 将 `Git.Push.Tags` 注册在分支/引用动作组，并注册 `Git.Tag.Push`。其 [GitPushTagsActionGroup](evidence/tags-2026-11-03/javap/git4idea.actions.tag.GitPushTagsActionGroup.txt) update +7…+54 只接受 selected reference 为 GitTag 且有 affected repositories 的上下文；getChildren +30、+102、+189…+202 为仓库每个 remote 生成动作。前端 properties 原行 656…657 提供 Push Tag / Push to {remote} 文本；并非仅硬编码 origin。

[GitPushTagAction](evidence/tags-2026-11-03/javap/git4idea.actions.tag.GitPushTagAction.txt) 取得标签、仓库和远端，启动后台 coroutine。[任务 $1](evidence/tags-2026-11-03/javap/git4idea.actions.tag.GitPushTagAction$actionPerformed$1.txt) invokeSuspend +40、+92 使用推送进度；[任务 $1$1](evidence/tags-2026-11-03/javap/git4idea.actions.tag.GitPushTagAction$actionPerformed$1$1.txt) +66 preparePushSpec，+87 调用 Pusher.push(singletonSpecMap, null, false)。

[preparePushSpec](evidence/tags-2026-11-03/javap/git4idea.actions.tag.GitPushTagAction$Companion.txt) +13 创建 Tag source，+32 取得所选标签 fullName 作为 special-ref target；[Tag source](evidence/tags-2026-11-03/javap/git4idea.push.GitPushSource$Tag.txt) getRevision +4 返回 fullName，isBranchRef=false。[special-ref target](evidence/tags-2026-11-03/javap/git4idea.push.GitSpecialRefRemoteBranch.txt) 将传入 ref 原样用于 getNameForRemoteOperations。结合 [GitTag](evidence/tags-2026-11-03/javap/git4idea.GitTag.txt) getFullName +4 及拼接 recipe 的 `refs/tags/<name>`，与 GitPushOperation.createPushSpec +73…+79 的冒号拼接，单标签核心 refspec 确认为 `refs/tags/<name>:refs/tags/<name>`。此入口传 null options 和 false force，没有主动添加 All/FOLLOW 或强推。

单标签和普通 push 共用 GitPusher→GitPushOperation→GitImpl。结果经 [GitPusher.Companion](evidence/tags-2026-11-03/javap/git4idea.push.GitPusher$Companion.txt) pushAndNotify +19 执行、+152 发布完成结果，lambda +17 创建 GitPushResultNotification、+92 notify。静态存在成功/失败结果反馈链；本轮没有向真实远端验证成功、重名拒绝、权限/网络失败的具体画面。

## 未确认、独立设计与交付核对

- 本轮不做 UI 点击，标签树/菜单的当前展开位置、不同 UI 模式的最终文字、用户 Push tags 当前值均未动态观察。能确认动作注册及所需数据上下文，不能仅凭注册认定每个项目当前都显示该动作。
- 没有扩展删除、签名、检出标签、远端强制覆盖的完整生命周期；不将选中 class 之外的所有实现声称已穷尽。
- 本轮仅分析文档和证据，没有新增 HarborGit 标签功能。HarborGit 当前能力和专用本地裸仓库验证由根调查记录在 [HARBORGIT-TAG-CAPABILITIES.md](HARBORGIT-TAG-CAPABILITIES.md)；其实现属于项目自己的设计，不能作为 IDEA 的动态证据。
- [采集脚本](evidence/tags-2026-11-03/collect_tags.py) 可重新核对匹配 JAR 并生成反汇编；[文件清单](evidence/tags-2026-11-03/file-manifest.json) 记录本轮输出 SHA-256；[范围和会话状态](evidence/tags-2026-11-03/scope-and-verification.json) 记录 links/hash 验证与未打开 target。本轮无需 close_binary，因为没有打开会话目标；已有用户 IDEA 状态保持原样。

