# 标签能力核对：HarborGit 1.6.2 与本机 IDEA

> 此文保留 1.6.2 的历史核对结果及原始证据。**1.7.0 已新增标签创建和单标签推送**，当前使用方式见 [标签指南](TAGS.md)。下文的“当前”均指被调查的 1.6.2 基线；源码位置可能随后续开发移动，精确版本以文末证据清单中的哈希为准。

日期：2026-11-03（Asia/Shanghai）。标签可以通过图形界面创建和推送；HarborGit 当前只有标签显示能力，尚无专门创建和推送入口。IDEA 的本机插件证据见 [IDEA 标签调查](IDEA-TAGS-ANALYSIS.md)。

## HarborGit：已确认的能力

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| 能否显示已有 tag | 能。全部历史包含 tags，提交引用中显示 tag 名称 | [GitService.history](../src/main/git-service.ts#L793) 使用 `--tags`、`--decorate=full`；[提交列表](../src/renderer/CommitHistory.tsx#L30) 渲染 `tag-ref`；专用仓库探测同时识别轻量和注解标签 |
| 能否在界面新建 tag | 当前未实现 | [Requests](../src/shared/types.ts#L31) 无相应请求；`createTag` 运行探测返回“不支持的操作”。检索范围为当前 `src` 的请求、派发和 renderer 操作 |
| 能否选择 tag 进行推送 | 当前无专门入口或请求 | `pushTag` 探测返回“不支持的操作”；[Push 实现](../src/main/git-service.ts#L1017) 固定使用 `HEAD:refs/heads/<branch>` |
| 普通 Push 是否带 tag | 常规配置下不带；可能受 Git 配置影响 | 同一服务请求在 `push.followTags=false` 时只推分支，在 `true` 时附带可达注解标签，轻量标签未附带 |

“历史中看得到 tag”不意味着具备创建或推送标签的界面。Push 表单的“远程分支”字段用于 `refs/heads/...`，填入版本字符串也仍是分支目标。

## 专用仓库运行验证

[运行结果 JSON](verification-tags-2026-11-03.json)和[原始输出](verification-tags-2026-11-03.txt)使用 Git `2.50.1.windows.1`。仅创建专用测试仓库与本地裸仓库，禁用 system / global Git 配置，未操作用户实际仓库或真实远端。

同一条 HarborGit 请求执行的命令为：

```text
git push --progress --set-upstream -- origin HEAD:refs/heads/main
```

两种配置的结果：

| 测试配置 | 裸仓库中的 tag |
| --- | --- |
| `push.followTags=false` | 无 |
| `push.followTags=true` | 仅 `v-proof-annotated`，没有 `v-proof-lightweight` |

因此不能把“没有推送标签按钮”说成“任何配置下都绝不会推送标签”。这是继承 Git 配置的行为，并不是 GUI 对标签范围的显式控制。[Git 官方文档](https://git-scm.com/docs/git-push#Documentation/git-push.txt---follow-tags)定义了 `--follow-tags`：附带从推送引用可达、远端缺少的注解标签；`push.followTags` 可默认启用它。

可复现脚本：[probe.ts](evidence/tag-capability-probe-2026-11-03/probe.ts)，执行 `npx tsx docs/evidence/tag-capability-probe-2026-11-03/probe.ts`。核对源码身份见 [source-manifest.json](evidence/tag-capability-probe-2026-11-03/source-manifest.json)。脚本对 1.6.2 行为作断言，若未来新增相应 API，探测结果应重新评估。

## IDEA 的操作路径

本机 2026.1.3 的静态分析确认两种入口：日志右键 `New Tag` 是针对所选提交的快捷输入；`Git → New Tag` 打开完整表单，支持仓库、标签名、提交、Message 和 Force 等字段。Message 非空时添加注解标签参数。完整字节码、资源位置、REA ID 与未确认项见 [本机调查报告](IDEA-TAGS-ANALYSIS.md)。

实际使用时：

1. 在 `Git → New Tag` 选择仓库、填标签名称、确认目标提交；需要发布说明时填写 Message，再点击 Create Tag。也可在 `Git Log` 右键目标提交使用快捷入口。
2. 打开 `Git → Push`（常用 Windows 默认键位 `Ctrl+Shift+K`），检查 `Push tags` 是否已选择。IDEA 会读取、记忆标签推送选项，用户当前设置需要以界面为准。
3. 选 `All` 对应 `--tags`，包含所有本地标签；`Current Branch` 对应 `--follow-tags`，受到注解标签与可达性条件限制，不能认为它会发送每一个轻量标签。
4. 本机还存在所选 tag 动态生成 `Push to <remote>` 的入口，可在标签列表中选择标签后指定远端；标签创建与推送是两个步骤。

[JetBrains 当前官方操作手册](https://www.jetbrains.com/help/idea/use-tags-to-mark-specific-commits.html)为 2026.2 文档；它用作入口说明补充，与本机 2026.1.3 静态证据分开。没有在 IDEA 中实际创建或推送用户标签，也未读取用户当前 Push tags 设置。

## 与 GitHub 发布的关系

HarborGit 源码中的 [.github/workflows/build-desktop.yml](../.github/workflows/build-desktop.yml#L3) 配置了 `v*` 标签 push 触发，并核对标签是否等于 `v${package.json.version}`；发布 job 还依赖打包 job 成功。这是工作流文件中的配置事实，不是已经观察到 GitHub 成功执行。创建本地标签、把标签推到远端、CI 打包和创建 Release 是后续相连的步骤。

本轮仅核对能力与记录证据，未修改产品代码或软件版本。尚未核对的事项包括用户当前 Git / IDEA 偏好、实际远端权限和 GitHub 工作流运行状态。
