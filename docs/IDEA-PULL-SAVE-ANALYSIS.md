# IDEA Pull / Update 自动保存分析与 HarborGit 实现

分析日期 2026-11-14，目标为本机 IntelliJ IDEA 2026.1.3 / IU-261.25134.95。安装包身份、类 member 哈希、完整 javap 命令和方法偏移见 [取证报告](evidence/pull-save-2026-11-14/idea/FINDINGS.md) 及同目录 provenance JSON。

## 工具与证据边界

REA 用既有 JAR 证据做精确成员查询，确认 GitPull、GitMergeAction、两个内部任务、GitUpdateProcess、GitMergeUpdater 共 6 项打包类。见 [查询响应](evidence/pull-save-2026-11-14/rea-selected-occurrences.json)，证据 ID `ev_fe27525db8e7119b36a9550043165fa83cd714ea14e1bae1d6851360bae71db9`；[本次证据包](evidence/pull-save-2026-11-14/rea-evidence-bundle.json)。本次没有打开二进制目标，结束时 session open=false、cleanup_pending=false。

REA 的本机原生分析路径不支持 JVM `.class` 方法分析，JAR 库存不等于方法反编译。因此使用本机 Zulu JDK 21 的 javap 读取安装包字节码，15 个类保留完整输出，并重新核对 6 个旧 saver/policy 类证据的 member 与输出 SHA。没有安装反编译工具或运行 IDEA 的 Git 写操作。以下结论是静态分析，不是 IDEA 界面实测。

## 已确认的流程

| 入口 | 状态与内部调用 / Git 命令 | 结果展示与恢复 |
| --- | --- | --- |
| Git → Pull，对话框不选 REBASE | GitPull.perform → GitMergeAction；任务直接调用 Git.runCommand，命令为 PULL，追加所选选项、remote、branch | handleResult 本地覆盖保护显示错误；该直接路径没有自动保存 wrapper。冲突进入 resolver，刷新 repository / VFS 并展示通知 |
| Update Project，或 REBASE Pull | GitUpdateProcess.update 先 fetch；updateImpl 按 updater.isSaveNeeded 收集需保存的仓库，读取保存 policy，建立 GitPreservingProcess | 保存成功才开始更新；merge updater 调 merge，rebase updater 调 rebase；按更新结果决定是否恢复 |
| Update 的远程合并冲突未解决 | GitMergeUpdater 返回 INCOMPLETE，单独记录未完成标志 | 禁止自动 load，保留原改动，避免将本地 WIP 混进远程合并提交 |
| 更新成功 / 冲突已解决且合并提交成功 | SUCCESS / SUCCESS_WITH_RESOLVED_CONFLICTS，且没有 INCOMPLETE 标志 | 满足 load 条件后恢复；ERROR / CANCEL 不满足 |

精确证据：GitPull.perform +20..42；GitMergeAction$1.run +234、+290；GitMergeAction.handleResult +323..377；GitUpdateProcess.update +103..142、updateImpl +448..587；lambda$updateImpl$1 +0..27；GitMergeUpdater.handleMergeFailure +53..69。完整输出在 [javap 目录](evidence/pull-save-2026-11-14/idea/javap/)。

保存策略方面，GitMergeUpdater 对暂存区改动直接要求保存，对其他 tracked 改动按源目标差异路径重叠判断；异常时保守保存。Shelf / Stash 根据 policy 选择，默认构造值为 SHELVE，不能据此判断用户实际配置。Stash load 的 pop / --index 条件及未跟踪覆盖范围见取证报告，不能将 IDEA 所有入口一概描述为 stash -u。

## 推断与未确认

推断：把 Update 的保存与恢复阶段用于 HarborGit Pull，可以解决用户的未提交文件阻止 merge 的问题；这是本项目设计选择。未确认 IDEA 用户当前设置、第三方插件行为、真实远程认证、每种 UI 失败路径、跨进程恢复或未跟踪文件的完整覆盖。不能声称此 IDEA 版本的直接 Pull 一定自动保存。

## HarborGit 自行实现

实现位于 `src/main/git-service.ts` 的 pullWithSavedChanges、finishPullMerge、completePullSave 和共用 WIP 恢复器；`src/renderer/App.tsx` 的 Pull 对话框、合并提交入口及冲突标签；`RebaseSavedChangesBanner.tsx` 的阶段提示。界面及 TypeScript 均自行编写。

1. 校验本地分支和确认 HEAD，先 Fetch 指定远程分支至本次唯一的临时引用，再读取精确提交 ID。网络失败不移动本地改动；仅清理自己的临时引用。命令使用参数数组，无 shell。
2. 有本地改动时默认 stash push --include-untracked，保存全部暂存、未暂存和未跟踪内容；忽略文件不收进备份，覆盖风险提前拦截。使用唯一标记验证 Stash 归属，建立 refs/harborgit/wip/<uuid> 固定引用，持久写入每个 worktree 的恢复记录。
3. 合并捕获的远程提交，允许快进；分叉时创建合并提交。不再固定 --ff-only，不强推、不变基，不把私有 WIP 包含在合并提交中。
4. 远程合并冲突时保持 WIP 在备份中。解决并提交，或中止这次合并后，再恢复原 WIP；只有原分支、原提交 / 精确快进目标 / 精确双亲合并结果吻合时才自动应用。
5. 恢复使用固定引用 stash apply --index；恢复失败 / 冲突保留备份，不盲目重放。保留暂存状态失败且确认没有部分写入时，提供显式“恢复为未暂存修改”。重新打开只展示持久状态，不擅自自动应用。
6. 成功或手工结束恢复都保留专用引用与 Stash。Pull 的恢复记录为 v3，共用旧版保存文件名，兼容 v1 变基和 v2 智能签出；不是复用当前 stash@{0}。

验证仅使用专用仓库和本地裸仓库，见 [版本说明](RELEASE-1.9.1.md)。
