# IDEA Pull / Update 保存与恢复改动：本机字节码证据

分析日期：2026-11-14。目标为 `D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3`，build `IU-261.25134.95`。本子任务仅静态读取安装包与已有证据，没有操作 IDEA UI、执行用户仓库 Git 写入或改变 REA 活动目标。

`vcs-git.jar` SHA-256：`6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0`。`vcs-git-frontend.jar` SHA-256：`0e5135d36bcb94fbf4f5773bb123bd2f964566b872988bee6d5cfc6a0de75a17`。完整源文件身份见 `source-identities.json`；新增 15 个类的完整 javap 参数、源 JAR / class member / 输出 SHA 见 `javap-provenance.json`。6 个既有证据已逐项重新比较当前安装包 member 与旧输出 SHA，结果见 `reused-bytecode.json`。

工具边界：本文件的 JVM 方法控制流来自本机 `C:\Program Files\Zulu\zulu-21\bin\javap.exe -p -c`，不是 Java 源码，也不是 REA 动态执行结果。REA 包库存证据由主任务独立保存和汇总；这里没有把 archive inventory 当作 Java 方法反编译结果。

## 核心区别（已确认）

**此版本的直接 Pull 合并入口，与 Update Project 的自动保存更新入口是两条不同调用链。不能笼统宣称 IDEA 的每一个 Pull 都自动保存。**

1. `GitPull.perform(DialogState, Project)` 检查 `GitPullOption.REBASE`（方法偏移 +20..23）。不含该选项时 +34 调父类 `GitMergeAction.perform`；包含时 +42 调 `performRebase`。证据：`javap/git4idea.actions.GitPull.txt`。
2. 直接 Pull 路径的 `GitMergeAction$1.run` +234 直接执行 `Git.runCommand`，再于 +290 调 `GitMergeAction.handleResult`；该任务及 handleResult 中没有 `GitPreservingProcess` / saver 调用。证据：`javap/git4idea.actions.GitMergeAction$1.txt`。
3. `GitMergeAction.handleResult` +323..350 检测本地改动会被覆盖，调用 `LocalChangesWouldBeOverwrittenHelper.showErrorNotification`；+356..377 对未跟踪覆盖显示专门通知。没有在这个分支自动 stash 并重试。证据：`javap/git4idea.actions.GitMergeAction.txt`。
4. Pull 选择 REBASE 时，`GitPull.performRebase` +114..118 使用 `UpdateMethod.REBASE`，调用 `GitUpdateExecutionProcess.launchUpdate`，进入下述更新流程。第五参数 false 对应 shouldSetAsUpstream（见 `GitUpdateExecutionProcess$createSpec$updateEnvironment$1` 构造器字段 +7），不是关闭 autosave 的开关。

## 直接 Pull：入口 → 命令 → 状态 → 展示（已确认）

`GitPull.displayDialog` +24 创建 `GitPullDialog`，+38 `showAndGet`，并捕获所选根、分支、选项与 commitAfterMerge。`getHandlerProvider` 的命令构造 lambda 创建 `GitCommand.PULL`（+12），添加 `--no-stat`（+35）、每个被选中选项的 `getOption()`（+81）、`-v`（+99）、受版本能力检查约束的 `--progress`（+123）、所选 remote 名（+138）及分支 `getNameForRemoteOperations()`（+154..158）。这是参数列表构造，未出现 shell 字符串拼接。

`GitPullOption` 的静态初始化确认选项 REBASE / `--rebase`、FF_ONLY / `--ff-only`、NO_FF / `--no-ff`、SQUASH / `--squash`、NO_COMMIT / `--no-commit`、NO_VERIFY / `--no-verify`。其互斥列表将 REBASE 与 FF_ONLY、NO_FF、SQUASH、NO_COMMIT 排斥；FF_ONLY 与 NO_FF、SQUASH、REBASE 排斥。**这些是可选项和约束，不能据此声称本机用户勾选了某项。**证据：`javap/git4idea.pull.GitPullOption.txt` 静态初始化 +0..332。

`GitMergeAction.handleResult` 遇 MERGE_CONFLICT detector 时 +93..120 创建冲突 resolver 并调用 merge。命令成功或检测到冲突时 +138..145 刷新 VFS / repository，后续通过更新日志通知或 showUpdates 展示结果。其他失败走本地覆盖、未跟踪覆盖或通用 stderr 通知（+383..411）。这些字节码没有证明运行时一定解决成功；resolver 的返回值在该入口 +123 被丢弃。

## Update Project / REBASE Pull：先 fetch，再按需保存（已确认）

`GitUpdateProcess.update(UpdateMethod)` +103 调 `fetchAndNotify`；失败则 +109 返回 NOT_READY。fetch 成功后 +142 才进入 `updateImpl`。因此网络失败发生在保存本地改动前。证据：`javap/git4idea.update.GitUpdateProcess.txt`。

`GitUpdateProcess.updateImpl` +48 定义 updaters；+144 尝试 rebase updater 的快进捷径；之后逐个调用 `GitUpdater.isSaveNeeded`（+448），把需要保存的 repository roots 收集到集合（+458..463）。+555 读取 `GitVcsSettings.getSaveChangesPolicy`；+575 创建 `GitPreservingProcess`，+587 传入 operation 与恢复条件执行。

`GitMergeUpdater.isSaveNeeded` 的规则：

- +9 调 `GitUtil.hasLocalChanges(true, project, root)`；存在暂存改动则 +15 返回 true。`GitUtil.hasLocalChanges` 的 true 参数在 +52 添加 `--cached`，所以这里明确检查 index。
- 没有暂存改动时，+103 取得 source / target refs 差异路径，+112 取得 ChangeListManager 的 affected paths，+157 比较是否重叠；有重叠 +163 返回 true，否则 +168 返回 false。比较器使用 `FileUtil.pathsEqual`（`lambda$isSaveNeeded$1` +5）。
- 检查 index 或 refs 差异抛出 VcsException 时采取保守保存（+31 或 +185 返回 true）。

证据：`javap/git4idea.update.GitMergeUpdater.txt`；`javap/git4idea.GitUtil.txt` 的 `hasLocalChanges`。这不是把所有未提交文件一律拒绝，也不是无条件把所有文件 stash。

`GitRebaseUpdater.isSaveNeeded` 则检查 roots 下的本地 Change 集合以及 index（+11、+43）；任一存在便保存，异常也返回 true。`GitUpdateProcess.tryFastForwardMergeForRebaseUpdaters` 只针对 rebase updater、且有本地 Change 集合时尝试 `fastForwardMerge`（+123..153）；成功便从待更新集合跳过。该方法内部使用 `Git.merge(..., ["--ff-only"], ...)`（`GitRebaseUpdater.fastForwardMerge` +96..105），不是强制所有 merge updater 只能快进。

## 合并结果如何决定恢复（已确认）

`GitMergeUpdater.doUpdate` +123 调 `Git.merge(repository, targetName, ["--no-stat", "-v"], listeners)`。命令成功 +148 返回 SUCCESS；失败 +159 交给 handleMergeFailure。

| 更新结果 / 情况 | 静态行为 | 自动 load 条件 |
| --- | --- | --- |
| 普通合并成功 | doUpdate +148 → SUCCESS | 满足 |
| 合并冲突已全部解决并合并提交 | handleMergeFailure +53 resolver.merge 返回 true，+63 → SUCCESS_WITH_RESOLVED_CONFLICTS | 满足 |
| 合并冲突未解决 | resolver.merge 返回 false，+69 → INCOMPLETE | 不满足，保留保存内容 |
| 本地覆盖、未跟踪覆盖、其他命令失败 | handleMergeFailure +127 / +180 / +234 → ERROR | 不满足 |
| ProcessCanceledException | doUpdate +166 调 cancel，+169 → CANCEL；cancel 构造 `git reset --merge` | 不满足 |

恢复条件是 `GitUpdateProcess.lambda$updateImpl$1`：没有 INCOMPLETE 标记（+0..10）、聚合 result 非 null（+13..17）、result.isSuccess（+27），三者同时成立才 true。`lambda$updateImpl$0` 每次 updater 返回 INCOMPLETE 时 +102..113 设置该单独标记。

需要特别小心：`GitUpdateResult.isSuccess()` **把 INCOMPLETE 也视作 true**（+14..18）。正是上面的单独标记阻止冲突未解决时恢复 WIP；只复制 isSuccess 判断会漏掉这个保护。ERROR / CANCEL / NOT_READY 不在 isSuccess 的 true 集合中。证据：`javap/git4idea.update.GitUpdateResult.txt`。

冲突解决后的 commit 由 `GitMergeUpdater$MyConflictResolver.proceedAfterAllMerged` / `proceedIfNothingToMerge` 调 `GitMerger.mergeCommit`（各方法 +15），成功返回 true。因此原本地 WIP 恢复在远程合并提交之后，不应成为该 merge commit 的一部分。

## 保存 / 恢复机制（复核旧字节码，已确认）

以下输出均已重新验证当前安装文件 class member 与旧记录 SHA 一致，详见 `reused-bytecode.json`：

- `GitChangesSaver.getSaver` 根据 policy 选择 `GitShelveChangesSaver` 或 `GitStashChangesSaver`；`GitVcsOptions` 构造器 +50 默认 policy 为 SHELVE。这是默认值，**没有读取或证实本机当前项目的实际保存配置**。
- `GitPreservingProcess.execute$lambda$0` +9 在 noncancelable section 保存；+38..56 仅保存成功后运行 operation。正常返回和异常 finally 都检查调用者传入的 autoLoadCondition；条件 false 时 +121 / +179 调 `notifyLocalChangesAreNotRestored`。无条件 wrapper 的一般行为不能代替 Update 调用者的条件判断。
- `GitPreservingProcess.load` 使用 `isLoaded.compareAndSet(false,true)` 再调 saver.load，限制一次恢复尝试；这不是恢复成功证明。
- `GitChangesSaver.notifyLocalChangesAreNotRestored` 只有 wereChangesSaved 才显示通知，通知 action 的 lambda 调 `showSavedChanges`（+1）。该 action 证明可查看已保存内容，不能据此宣称 Update merge abort 后会自动 load。
- `GitStashChangesSaver.save` 调 `Git.stashSave`，保存 `stash@{0}` 的 hash；load 的命令 provider `lambda$load$0` +51 添加 `pop`，只有 `isStagingAreaAvailable` 成立时 +75 添加 `--index`。该 provider 没有显式添加已记录 stash hash，因此不能描述为按 OID apply。
- Shelf saver 委托平台 shelf / unshelve 机制。不能把 shelf 行为描述成 `git stash -u`，也不能由它证明所有未跟踪 / ignored 内容都被自动保存。

已有完整保存证据路径为 `docs/evidence/rebase-wip-2026-10-30/javap/`。本次没有修改旧输出。

## 推断与未确认

**推断**：用户希望的“Pull 自动保存 → 合并远程提交 → 恢复原本地修改”可以借鉴 Update Project 的保存策略和分阶段冲突处理，作为 HarborGit 的独立设计；它不是已确认直接 Pull 入口的原样复制。为了保持数据与 index 可恢复，HarborGit 可以自行采用明确 WIP 引用 / stash OID 等更可追踪的实现。

**未确认**：没有运行 IDEA 的 Pull / Update / abort 测试，没有确认本机用户当前保存 policy、Git pull.rebase / pull.ff 配置、第三方插件或更外层 action 是否额外包裹自动保存；没有证明失败后跨进程自动恢复或未跟踪 / ignored 全覆盖。当前证据可确认 Update 的 ERROR / CANCEL 不触发其自动 load 条件，以及冲突未解决时暂缓恢复；不能泛化为所有 IDEA 合并 / abort 入口永久不恢复。

HarborGit 的实现、Git 参数、状态机与专用测试仓库验证属于本项目自行编写部分，应由主任务的代码与测试结果另行说明。
