# IDEA 增量调查：带未提交修改进行变基

日期：2026-10-30（Asia/Shanghai）。**本机 IDEA 包含“先保存本地修改，再变基，随后恢复”的流程；dirty 并不是一律禁止变基的产品规则。** 但保存范围、暂存区恢复和失败处理具有条件，不能把它说成无条件、无损、原子的一步操作。本报告只记录静态证据与推断，没有在 IDEA 或用户真实仓库执行写操作。

## 1. 证据与工具边界

继续使用 IntelliJ IDEA 2026.1.3 / IU-261.25134.95，安装于 `D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3`。重新核对的 `plugins\vcs-git\lib\vcs-git.jar` SHA-256 仍为 `6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0`；前端包为 `0e5135d36bcb94fbf4f5773bb123bd2f964566b872988bee6d5cfc6a0de75a17`。为跟进 Shelf 委托，另检查 `lib\intellij.platform.vcs.impl.jar`，SHA-256 `cbae07100b8eeecf5def4a8c358fdc396b66f2e44e1eee23179d6f67e3e8b0d5`。见 [源文件身份](evidence/rebase-wip-2026-10-30/source-identities.json)。

REA 6.8.0 session 起始为 `open=false / cleanup_pending=false`。复用 [首次 bundle](evidence/rea-evidence-bundle.json) 的 inventory **`ev_b3436a50eea22fcaae9597c602b3ada48b0592bf729014c1efc1ffce19e530e3`**，通过 evidence-file view 精确认证 GitChangesSaver、GitStashChangesSaver、GitShelveChangesSaver、GitStashUtils、GitPreservingProcess 五个 occurrence，全部 `hash_status=verified`。新 view ID 为 **`ev_4997165fe37b1e165cf5ae14d0825e1799eb7e1fa8bbe5e83174b4c092925976`**，见 [选取记录](evidence/rebase-wip-2026-10-30/rea-selected-occurrences.json) 与 [REA view bundle](evidence/rebase-wip-2026-10-30/rea-view-bundle.json)。没有重复完整 inventory 或已知失败的 JVM `.class` 打开探测；格式边界沿用 [原限制记录](evidence/rea-class-format-limitation.json)。

用现有 JDK 21.0.11 `javap -p -c` 新增 13 份精确 class 输出，并核验复用 6 份旧字节码。JAR / class / 输出哈希与参数见 [新增来源](evidence/rebase-wip-2026-10-30/javap-provenance.json)、[复用来源](evidence/rebase-wip-2026-10-30/reused-bytecode.json)；[采集脚本](evidence/rebase-wip-2026-10-30/collect_rebase_wip.py) 会跳过哈希一致的已有输出。以下“事实”表示这些注册资源、字段、字节码调用和分支；“推断”表示由它们推导的操作语义，不是运行 trace。

## 2. Rebase 的保存与恢复时机

**已确认事实：** 原 [GitRebaseProcess.doRebase](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseProcess.txt) 在执行各仓库的 rebase 前，offset **96** 调 `saveDirtyRootsInitially`。该方法（L845 起）先排除已在 ongoing rebase 的仓库，再用 `getDirtyRoots → findRootsWithLocalChanges` 检测本地修改；后者用 `ChangeListManager.haveChangesUnder(root) != ThreeState.NO`，不能仅凭这个调用证明它收集了全部未跟踪文件。

`saveDirtyRootsInitially` 的 offset **45** 调 `mySaver.saveLocalChangesOrError(roots)`；返回错误字符串时显示 `rebase.notification.not.started.title` 并返回 false。保存成功才进入后续 rebase。`rebaseSingleRoot` 还有一次补救路径：命令报告 dirty tree、不是 resume 且尚未重试时，offset **355** 再尝试保存；成功后设置已重试标志继续。这不是简单把 dirty 错误忽略后强制执行。

**已确认事实／恢复分支：** 同一 `doRebase` 中，最后一项状态为 **SUCCESS 或 NOT_STARTED** 时，offset **366** 调 saver.load；**SUSPENDED / ERROR 不经过这个成功收尾的 load 分支**。SUCCESS 随后设置 `isSuccessful` 并发通知；`load()` 是 void，因此这段代码本身不把“rebase 成功”和“本地修改已完整恢复”合并为一个布尔保证。过程状态、saver 和初始引用由 [GitRebaseSpec](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseSpec.txt) 保存，`saveUpdatedSpec` 视条件保留 ongoing spec。

**流程推断：** “识别 dirty → 保存 → 变基 → 成功后恢复”；遇到变基冲突应先保留保存的 WIP，解决并 Continue / Skip，或者 Abort，再按结果恢复。把 WIP 提前应用到尚在冲突中的 rebase 工作区会混淆两种修改，这不是所选静态流程。

## 3. 用户设置：Shelf 与 Stash 是两条路径

**已确认事实：** `GitRebaseSpec.newSaver`（原文件 L299 起）offset **26** 读取 `GitVcsSettings.getSaveChangesPolicy`，55 调 `GitChangesSaver.getSaver`。[GitVcsSettings](evidence/rebase-wip-2026-10-30/javap/git4idea.config.GitVcsSettings.txt) 委托 [GitVcsOptions](evidence/rebase-wip-2026-10-30/javap/git4idea.config.GitVcsOptions.txt)；后者构造器 offset **50** 用 **SHELVE** 初始化 saveChangesPolicy delegate。它是本版本类的默认初始化值，不证明用户当前配置就是 Shelf；本次没有读取用户的项目设置值。

[GitChangesSaver.getSaver](evidence/rebase-wip-2026-10-30/javap/git4idea.stash.GitChangesSaver.txt) 检查 policy，SHELVE 时构造 `GitShelveChangesSaver`，否则构造 `GitStashChangesSaver`。`saveLocalChangesOrError` 捕获 VcsException，按所选机制组织保存失败消息；`notifyLocalChangesAreNotRestored` 还可显示“未恢复”通知和 Show Saved Changes 动作。资源键及原始行号见 [资源摘录](evidence/rebase-wip-2026-10-30/resource-excerpts.json)。

## 4. Stash 保存路径：范围与 index 条件

**已确认事实／保存参数：** [GitStashChangesSaver.save](evidence/rebase-wip-2026-10-30/javap/git4idea.stash.GitStashChangesSaver.txt) offset **192** 调 `Git.stashSave(repo, message)`；保存成功且不是“No local changes to save”时，235 解析 `stash@{0}`，240 将 **root→stash hash** 存入 `myStashedRoots`。

原 [GitImpl.stashSave](evidence/javap/git4idea.commands.GitImpl.txt)（L530–581）实际组参为：offset **48** `push`、61 `-m`、74 message，再 runCommand；这条自动保存路径**没有添加 `-u / --include-untracked / --all`**。因此基于通常 Git 子命令语义，它保存已跟踪文件的 index / worktree 修改，不能声称这里自动移走了所有 untracked 或 ignored 文件。仍留在工作区的未跟踪文件若与目标冲突，可继续阻止操作；这不等于保存失败后允许覆盖它们。手工 Stash 对话框 / GitStashUtils 的其他参数化入口不应混入此自动保存路径的结论。

**已确认事实／恢复参数：** saver 的 `lambda$load$0`（同文件 L324 起）offset **51** 添加 **`pop`**；65 根据 `isStagingAreaAvailable(project)` 分支，75 才添加 **`--index`**。新增 [GitStageManagerKt.isStagingAreaAvailable](evidence/rebase-wip-2026-10-30/javap/git4idea.index.GitStageManagerKt.txt) 明确检查当前 commit mode 是否为 `GitStagingAreaCommitMode`，并非 Git 的通用可用性测试。

所以在这条路径中：启用 staging area 的 commit mode 时，恢复会**尝试**还原 index；否则不加 `--index`。即使加了它，也可能产生 index conflict，不能写成“任何情况下 staged / unstaged 划分原样回来”。

**已确认事实／stash 标识使用边界：** [GitStashOperations.unstash](evidence/rebase-wip-2026-10-30/javap/git4idea.stash.GitStashOperations.txt) 从 map 取 stash hash，但在此调用链中该 hash 用于 `refreshUnstashedChanges`；实际 handler 由 saver lambda 提供，命令没有显式加 stash OID 或专用 ref，而是 `stash pop [--index]`。因此不能把这条已分析路径描述为“总是按持久恢复 ID 精确 apply 保存对象”。对并发改变 stash 栈的保障，本次没有运行证据。

## 5. Shelf 路径：IDE 的补丁 / 变更列表机制

**已确认事实：** [GitShelveChangesSaver](evidence/rebase-wip-2026-10-30/javap/git4idea.stash.GitShelveChangesSaver.txt) 将 save / load 委托给 [平台 VcsShelveChangesSaver](evidence/rebase-wip-2026-10-30/javap/com.intellij.openapi.vcs.changes.VcsShelveChangesSaver.txt)。平台类按选定 roots 过滤 `ChangeListManager.getAllChanges` / 各 LocalChangeList.getChanges，调 `VcsShelveUtils.shelveChanges`，并记下 changelist→ShelvedChangeList；随后调用 doRollback 清理已保存改动。插件的 [匿名子类](evidence/rebase-wip-2026-10-30/javap/git4idea.stash.GitShelveChangesSaver$1.txt) 把 doRollback 接回 Git 专用清理方法。

Git 专用清理代码区分 tracked / staged status，调用 restoreStagedAndWorktree / restoreStaged，另有按版本 / 设置使用的 resetHardLocal 清理分支；这些调用发生在保存后的清理阶段，**不是证明恢复原 staging 划分的证据**。Shelf load（平台文件 L183 起）调用 `VcsShelveUtils.doSystemUnshelve`；遇到 `ApplyPatchStatus.ABORT` 就退出余下列表的恢复。

**边界：** 这条路径是 IDE shelf / patch / changelist 机制，不等于 `git stash -u`。选择的代码没有给出对任意未跟踪文件和原 index tree 的完整快照及重建承诺；更深的 patch engine、二进制 / rename 特例和未跟踪收集边界未穷尽。本次不据类名或恢复文案宣称 Shelf 一定保留全部 index 状态，也不声称它一定做不到。

## 6. 恢复冲突、Abort、取消与恢复位置

**已确认事实／恢复失败不同于变基失败：** `GitStashOperations.unstash`（L424 起）在执行 pop 前安装 INDEX_CONFLICT_ON_UNSTASH、MERGE_CONFLICT_ON_UNSTASH、未跟踪覆盖、本地修改覆盖 detector。index conflict 显示错误并返回 false；merge conflict 调 resolver；文件覆盖及一般失败也各自通知、返回 false。`GitStashChangesSaver.load` 调该方法后 offset **59** 丢弃返回 boolean；上层“rebase 成功”通知不证明 pop 已完全恢复。

[UnstashConflictResolver](evidence/rebase-wip-2026-10-30/javap/git4idea.stash.GitStashChangesSaver$UnstashConflictResolver.txt) 提供 Show Stash、Resolve Conflicts 入口。基于 Git pop 的通常语义，冲突时 stash 可留待后续处理；但本次没有观察实际弹窗、手工解决或所有异常的最终落盘状态。**变基冲突**和**变基结束后的 WIP 恢复冲突**应作为不同状态呈现，不能在后者一律提示用户执行 rebase --continue。

**已确认事实／Abort：** 原 [GitAbortRebaseProcess.doAbort](evidence/history-2026-10-30/javap/git4idea.rebase.GitAbortRebaseProcess.txt) 用布尔结果判断 abort / 选定回滚是否成功；offset **47** 失败时跳过后续 load。成功后等待变更列表更新，71 调 saver.load，再通知 abort 成功。若 abort 或回滚失败，错误消息可带“本地改动仍在 stash / shelf”信息。不是无论 Abort 结果如何都强行恢复 WIP。

**已确认事实／通用 preserving wrapper：** [GitPreservingProcess](evidence/rebase-wip-2026-10-30/javap/git4idea.util.GitPreservingProcess.txt) 的 `execute$lambda$0`（L297 起）在 nonCancelable section 中保存；成功才执行 operation。在正常退出及异常 finally 中，按 auto-load condition 决定在 nonCancelable section 调 load，或通知尚未恢复。`load` 先 `isLoaded.compareAndSet(false,true)` 再调用 saver.load，所以这是“至多尝试一次”的对象状态保护，不能把该布尔量当成已验证恢复成功或自动重试机制。

**调用边界：** 所选 `GitRebaseProcess` 自己使用 spec+saver+GitFreezingProcess，并没有证据表明每次普通 rebase 都直接被 GitPreservingProcess 包裹。因此不能把通用 wrapper 的 finally 恢复承诺原封不动套到 rebase 的所有取消路径。`doRebase` 的 ProcessCanceledException 分支直接重新抛出；它不必经过成功收尾的 load。中断、应用退出、系统崩溃后的完整恢复流程保持未确认。

**已确认事实／跨分支位置：** Stash saver 按 repository root 保存状态，load 的 handler 只设置工作目录和 pop 参数，没有 checkout 保存时分支的步骤。成功 rebase 如果切到了另一个 source branch，load 针对的是操作后当前工作树。AbortProcess 在特定回滚分支有 initial-branch 处理，但不能据此保证所有单仓库 / source 参数情形都回到保存 WIP 时的分支。

**流程推断：** 若当前 dev 存在 WIP、却选择对 master 变基，保存 WIP 与恢复 WIP 的分支归属必须另行明确。所选代码不支持“始终自动恢复到原 dev 分支”的普遍结论。客户端应记录原 branch / HEAD 及明确的恢复目标，或限制自动恢复范围；具体策略是独立设计。

## 7. 对 HarborGit 独立实现的依据与差异

| IDEA 中已确认的行为 / 边界 | HarborGit 拟采用的独立策略 |
|---|---|
| dirty 可先保存再变基，保存失败阻止继续 | 用户选择自动保存 WIP，再进行原定变基；失败保留可检查状态 |
| 默认 settings 初始化为 Shelf；Stash 自动保存未加 -u | 选择 Git stash 作为统一保存载体；若显式包含 untracked，应明确其范围与 ignored 例外并测试 |
| Stash pop 仅在 staging commit mode 加 --index | 若统一使用 --index，属于客户端对暂存区的明确策略；仍须处理恢复冲突 |
| saver 的 root→hash map、普通 stash 栈；未证明应用重启后持久 recovery record | 自建持久 recovery ref / 元数据，记录 stash OID、原 branch / HEAD、目标与阶段；按该对象恢复并保留备份 |
| rebase 和恢复分别可能成功 / 暂停 / 失败 | 区分 rebase 冲突、abort 失败、WIP 恢复冲突及待恢复状态；不要以进程结束推定全流程成功 |
| load 不一般保证回到保存时的分支；成功 pop 通常移除 stash 栈项 | 对跨源分支恢复制定显式规则；备份生命周期由自己的恢复验证和保留策略控制 |

上述右列是实现方向与证据支持的边界，不是本报告已经验证的客户端结果。恢复 ref 的耐久性、分支归属、staged+unstaged 同文件、中文 / 空格路径、untracked、冲突、取消和重启，应在专用测试仓库单独核验。当前产品“有未提交修改就拒绝”的限制可调整为保存后尝试，不能把放宽检查实现成丢弃改动或直接强制覆盖。

## 8. 已回答与未确认

已回答：dirty 保存→rebase→成功 / 暂停→恢复的静态分支；设置选取与默认初始化；自动 Stash 的真实参数、条件 --index；Shelf 委托边界；恢复失败、Abort、通用 preserving 的取消保护，以及 root / branch 归属限制。

未确认：用户当前 policy / commit mode，真实 IDEA 操作和 Git 子进程轨迹，所有 Shelf patch engine 特例，进程崩溃 / 并发 stash 修改 / 外部文件修改 / 多根部分保存的最终恢复，以及跨源分支下完整 staging 保持。没有读取用户源码、stash 内容或凭据，也没有改动任何真实仓库。

本报告 offset 为 JVM 字节码位置，L 为交付证据文本行。最终 session 状态与证据文件哈希见 [session-and-scope.json](evidence/rebase-wip-2026-10-30/session-and-scope.json)、[file-manifest.json](evidence/rebase-wip-2026-10-30/file-manifest.json)。本次只用认证 evidence-file views，没有新开 active target。
