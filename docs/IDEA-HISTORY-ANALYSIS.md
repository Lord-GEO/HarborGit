# IDEA Git 增量调查：变基、文件回滚、历史 Revert 与 Reset

日期：2026-10-30（Asia/Shanghai）。目标仍是本机 `D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3`，IU-261.25134.95。本报告补充 [首次调查](IDEA-ANALYSIS.md)，只分析交付软件与必要资源，不改动用户的 Git 仓库。

## 1. 目标核验与 REA 证据复用

本次重新计算 `plugins\vcs-git\lib\vcs-git.jar` SHA-256，仍为 `6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0`，与首次调查一致。前端包也单独记录了哈希，见 [增量源身份](evidence/history-2026-10-30/history-source-identities.json)。没有重新扫描安装目录或重复完整 inventory。

REA 6.8.0 会话起始状态为 `open=false / cleanup_pending=false`。通过 `inspect_analysis_view` 的 `source: evidence-file` 认证并重用首次导出 bundle：

| 证据 | Evidence ID / 文件 |
|---|---|
| 首次 JAR inventory 父记录 | `ev_b3436a50eea22fcaae9597c602b3ada48b0592bf729014c1efc1ffce19e530e3`，位于 [原始 bundle](evidence/rea-evidence-bundle.json) |
| 首次 inspect_artifact 父记录 | `ev_7a407b37dc36585d670d110ee04f45be222ae46639deff99c4c882c81e7f6350` |
| 本次认证复用的 summary | `ev_1cf0eb31355917cd4f31786a4188b1503b73e48cdd8aad3fd96d5dd0d2d7d518`，见 [summary](evidence/history-2026-10-30/history-rea-reused-summary.json) |
| 本次选取 8 个目标 class 的 occurrence view | `ev_6fbc3165d6b0a8da34f5988a0fdf7f72170940b7f4627bf2752f94da4a315323`，见 [selected occurrences](evidence/history-2026-10-30/history-rea-selected-occurrences.json) |
| 本次保留的两条 REA view | [增量 REA bundle](evidence/history-2026-10-30/history-rea-evidence-bundle.json)，两条记录、12,081 bytes；其父证据在上面的原始 bundle 中 |

8 个选取条目包括普通 Rebase、Continue、Skip、Abort、RebaseProcess、GitRollbackEnvironment、GitRevertProcess、GitResetOperation。它们的 occurrence 都由 REA 标记 `hash_status=verified`，但 class 仍是 opaque resource/file/unknown，**不是 JVM 反编译结果**。中央目录范围、非条目字节和运行语义限制与首次相同。

REA 的独立 JVM `.class` 不支持已在首次调查得到明确 `unsupported binary format`；本次没有重复这个无效探测，也没有把 class 误送到 .NET / native provider。原限制记录见 [rea-class-format-limitation.json](evidence/rea-class-format-limitation.json)，本次状态见 [history-session-check.json](evidence/history-2026-10-30/history-session-check.json)。

继续使用本机 JDK 21.0.11 `javap -p -c`，新增 38 个精确 class 的字节码输出；复用已核验哈希的 6 个旧输出（GitImpl、GitFileUtils、GitRepositoryReader、GitVcs、GitHandler、GitMergeUtil）。[新增字节码来源](evidence/history-2026-10-30/history-javap-provenance.json) 记录 JAR 路径、class 成员 SHA-256、输出 SHA-256、完整参数；[复用索引](evidence/history-2026-10-30/history-reused-bytecode.json) 指向原证据。可用 [采集脚本](evidence/history-2026-10-30/collect_history_evidence.py) 复核，脚本会校验目标 JAR 并跳过哈希匹配的已有输出。

**分级约定：** 下文“事实”是 XML / properties / 已选择字节码中的静态观察；“流程推断”是把这些节点串成操作路径；“未确认”表示没有动态执行证据。本次没有激活或操作用户当前 IDEA 窗口；首次 UI 观察只支持当时的分支入口与提交面板，不证明本次这些菜单 / 对话框的现场状态。所有新增 Git 语义都明确来源于本机包，而非实际执行 IDEA 写操作。

## 2. 入口与状态概览

注册资源仍为 [plugin.xml](evidence/resources/backend/META-INF/plugin.xml)，界面字符串在前端包 [GitBundle.properties](evidence/resources/frontend/messages/GitBundle.properties)。本次按原始行号提取的相关资源见 [history-resource-excerpts.json](evidence/history-2026-10-30/history-resource-excerpts.json)。

| 用户入口 | 已确认注册 / 状态依据 | 最终静态调用类别 |
|---|---|---|
| 普通 Rebase | `Git.Rebase → GitRebase`，XML L127；分支动作还有 `GitRebaseBranchAction`（L220） | REBASE + `GitRebaseParams.asCommandLineArguments` |
| Continue / Skip / Abort | XML L101–104；ongoing 动作组 L188–195 | REBASE + `--continue` / `--skip` / `--abort` |
| 工作区文件 Rollback | `Git.Stage.Revert → GitRevertAction`，L329；传统 `ChangesView.Revert` 也被引用 | staging 未暂存回滚走 CHECKOUT 无 HEAD；传统回滚可走 CHECKOUT HEAD |
| 暂存区 Unstage | `Git.Stage.Reset`，L328，名称资源为 Unstage | 路径级 RESET，与历史 Reset 不同 |
| 历史 Revert | `Git.Revert.In.Log → GitRevertAction`，L42；Log 菜单引用 L267 / L282 | REVERT + 选定 commit；正常路径自动创建反向提交 |
| 历史 Reset | `Git.Reset.In.Log → GitResetAction`，L41；Log 菜单引用 L281 | RESET + 模式 + 目标 commit |

**事实：** Rebase 的控制动作继承 `GitAbstractRebaseAction`，构造器将目标仓库状态绑定到 `Repository.State.REBASING`（[字节码](evidence/history-2026-10-30/javap/git4idea.actions.GitAbstractRebaseAction.txt)，构造器 offset 1）。已存在 `GitRepositoryReader` 的 `readState` 逻辑可识别 REBASING、MERGING、REVERTING；GitRebaseProcess 另有自己的 SUCCESS / SUSPENDED / ERROR / NOT_STARTED 过程状态（[枚举](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseStatus$Type.txt)，L3–9）。不能把一次非零 exit code 一概当作“仓库没有变化”：冲突会留下可继续的过程状态。

## 3. 普通变基与 Continue / Skip / Abort

### 普通变基

**事实／操作入口：** [GitRebase.actionPerformed](evidence/history-2026-10-30/javap/git4idea.actions.GitRebase.txt) 选择仓库后创建 `GitRebaseDialog`，offset 105 调 `showAndGet`，126 读 `getSelectedParams`，162 构建后台 task。后台 [GitRebase$1.run](evidence/history-2026-10-30/javap/git4idea.actions.GitRebase$1.txt) offset 24 调 `GitRebaseUtils.rebase`。对话框 [GitRebaseDialog](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseDialog.txt) 有 upstream / new base / branch / options 字段及验证；资源 L185–207 提供“未选择 upstream / new base、分支无效、已在 rebase 中”等文案和可选 `--onto`、interactive、root 等说明。

**事实／参数与状态：** [GitRebaseParams.asCommandLineArguments](evidence/history-2026-10-30/javap/git4idea.branch.GitRebaseParams.txt)，L229 起，将 selected options、upstream、可选 newBase / source branch 组成参数列表；其中 `--onto` 常量位于 offset 261，`--root` 在 304。原 [GitImpl.rebase](evidence/javap/git4idea.commands.GitImpl.txt)，L2019 起，offset 54 选择 `GitCommand.REBASE`，68 调 `asCommandLineArguments`，71 添加整个参数列表。非交互模式最终直接 `runCommand`；interactive 走 `runWithEditor`。因此普通目标分支重放可以概括为 `git rebase <upstream>`，但不能把所有 IDEA rebase 选项强行简化成这一条固定命令。

**事实／后台处理和反馈：** [GitRebaseUtils](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseUtils.txt) 创建 `GitRebaseSpec / GitRebaseProcess`。[GitRebaseSpec](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseSpec.txt) 保存初始分支、revision、各仓库进度及 `GitChangesSaver`；saver 的策略来自设置。`GitRebaseProcess.rebase` 先检查已发布提交，再执行 process；`doRebase` 的 offset 96 调 `saveDirtyRootsInitially`。单仓库执行会分析命令和事件 detector，必要时进入 SUSPENDED / 冲突处理，更新 spec。它有 `notifySuccess`、`notifyNotAllConflictsResolved`、未跟踪覆盖错误、未暂存阻塞 Continue 等独立反馈分支（[process](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseProcess.txt)，L131、L380、L769、L845、L900、L1008 起）。

**流程推断：** “Rebase 入口 → 选择 upstream 并验证 → 保存过程起点及必要的本地改动 → 后台参数化 rebase → 成功刷新分支 / VFS / 历史；冲突保持可恢复状态并展示解决入口”。IDEA 可 stash / shelf 本地更改不等于 HarborGit 必须自动这样做；自动保存策略、确认 UI 和多根依赖顺序没有本次运行验证。

### Continue 与 Skip

**事实：** [GitRebaseContinue](evidence/history-2026-10-30/javap/git4idea.actions.GitRebaseContinue.txt) / [GitRebaseSkip](evidence/history-2026-10-30/javap/git4idea.actions.GitRebaseSkip.txt) 的项目级和仓库级 action 分别调用 `GitRebaseUtils.continueRebase / skipRebase`；utils 创建恢复模式的 process。`GitRebaseProcess.callRebase` offset 112 调 `Git.rebaseSkip`，126 调 `Git.rebaseContinue`。

[GitRebaseResumeMode](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseResumeMode.txt) 静态初始化中 offset 7 为 `--continue`、22 为 `--skip`；[GitImpl.rebaseResume](evidence/javap/git4idea.commands.GitImpl.txt)，L2154 起，offset 74 取 `asCommandLineArgument`，78 添加参数，并配置 editor handler。**Continue 不是普通 commit 按钮；Skip 不是 Abort。** 资源 L342、L368–372 表明冲突暂停、全部解决后继续的提示、未暂存更改阻塞及 Stage and Retry 的反馈路径存在。

**流程推断：** “解决并暂存冲突 → Continue → 当前提交重放完成后继续后续提交，可能再次暂停”；“Skip → 跳过当前待应用提交并继续余下序列”。这两项过程推进语义由 Git 的恢复子命令和状态分支共同支持；没有通过 IDEA 实际重放一串提交。

### Abort

**事实：** [GitRebaseAbort](evidence/history-2026-10-30/javap/git4idea.actions.GitRebaseAbort.txt) 调 utils.abort；utils 创建 [GitAbortRebaseProcess](evidence/history-2026-10-30/javap/git4idea.rebase.GitAbortRebaseProcess.txt) 并调用 `abortWithConfirmation`。该类有仅 Abort、Abort and Rollback、多仓库已成功部分回滚等确认分支。真正的 abort 路径调用 `Git.rebaseAbort`（`lambda$doAbort$1` offset 97）；[GitImpl.rebaseAbort](evidence/javap/git4idea.commands.GitImpl.txt)，L2082 起，offset 50 加 `--abort`。多仓库回滚成功部分还可调用 `reset --keep`（AbortProcess L424–447）；这与对当前单仓库做 `rebase --abort` 是两个分支。

**流程推断：** “Abort 入口 → 展示终止范围 → rebase --abort 恢复该变基开始前的状态 → 刷新仓库与保存改动的处理结果 / 通知”。不能把 IDEA 多根 abort 成功当作原子回滚保证；保存改动恢复失败、外部修改、editor 取消、签名和 hooks 情况均未动态确认。

## 4. 文件 Rollback 与 Unstage 的区别

**事实／staging 工作区回滚：** [GitRevertOperation.matches](evidence/history-2026-10-30/javap/git4idea.index.actions.GitRevertOperation.txt) 只接受 `NodeKind.UNSTAGED`；`processPaths` offset 167 调 `GitFileUtils.revertUnstagedPaths`，175 刷新虚拟文件。原 [GitFileUtils](evidence/javap/git4idea.util.GitFileUtils.txt) L812–863 的该方法创建 CHECKOUT handler，offset 64 选命令，74 结束 options，81 添加路径，**没有传 HEAD 或其他 revision**。

**流程推断：** 对已在 index 的文件，这条命令是 `git checkout -- <paths>`，从暂存区恢复工作区内容，保留 staged 版本。若同一文件既有 staged 又有新的 unstaged 改动，Rollback unstaged 后应仍保留 staged 改动和 Diff。该路径不移动 HEAD，也不产生提交。

**事实／传统更改列表回滚：** [GitRollbackEnvironment.rollbackChanges](evidence/history-2026-10-30/javap/git4idea.rollback.GitRollbackEnvironment.txt) 按 `Change.Type` 分类处理；对需要恢复的已跟踪文件调用其 `revert` 方法，offset 72 明确添加 HEAD，80 结束 options，87 添加路径，即 `git checkout HEAD -- <paths>`。其他分支对新增文件可 unindex、对移动后的路径可删除文件；最终刷新 VFS 和 index。不能把全部 change 类型描述成“始终只有一条 checkout”。

**流程推断：** 传统 Rollback 可能同时放弃选中文件相对于 HEAD 的 index / worktree 改动；这比只恢复 worktree 的范围更大。当前用户项目到底启用哪个工作流，本次未观察；本报告也不对未跟踪文件自动删除做任何泛化授权或断言。

**事实／取消暂存：** `Git.Stage.Reset` 的资源名称是 Unstage（properties L1023–1025），已分析的 `GitResetOperation`（index/actions 包）调 `GitFileUtils.resetPaths → git reset -- <paths>`，保留工作区。这是路径级操作，不是下面的历史 Reset。资源中的“Rollback Staged Change”还有行级功能，本次未追踪其全部实现。

## 5. 历史 Revert：创建反向提交

**事实／入口与约束：** XML 注册 `Git.Revert.In.Log`。资源 properties L732–734 明确说明创建新的提交以逆转原提交的变更；它与文件 Rollback 的资源键、action class 包名均不同。[GitRevertAction.update](evidence/history-2026-10-30/javap/git4idea.revert.GitRevertAction.txt) 检查 Log selection、已识别仓库和父提交数；遇到 merge commit（parents > 1）将 action 保持可见但禁用，并显示“不允许 Revert merge commit”说明（offset 315–376）。`actionPerformed` 加载选中完整详情并排队 [后台任务](evidence/history-2026-10-30/javap/git4idea.revert.GitRevertAction$actionPerformed$1$3.txt)，其 run offset 27 调 `GitRevertProcess.execute`。

**事实／精确 Git 参数条件：** [GitRevertProcess.applyChanges](evidence/history-2026-10-30/javap/git4idea.revert.GitRevertProcess.txt)，L94–138，offset 41 取得目标 hash，**46 为 `iconst_1`**，87 调 `Git.revert(repository, hash, boolean, listeners)`。原 [GitImpl.revert](evidence/javap/git4idea.commands.GitImpl.txt)，L2281–2331，先加 hash，然后是：

```text
68: iload_3
69: ifne 87
...
80: ldc_w ... // String --no-commit
84: invokevirtual ... addParameters
87: ... addListeners
```

所以 **boolean=true 会跳过 `--no-commit`；仅 false 才加入它**。本次历史 Revert 正常路径传 true，会让 Git 自动生成反向提交。不能仅因为 class 中存在 `--no-commit` 常量就断定它在正常路径被使用。`GitRevertProcess` 父构造调用的 false 参数实际是 `preserveCommitMetadata`，不是 autoCommit 开关（父类字段和赋值可直接核对）。

**事实／状态与结果：** [GitApplyChangesProcess.executeForCommitChunk](evidence/history-2026-10-30/javap/git4idea.applyChanges.GitApplyChangesProcess.txt) 选择 staging / changelist / simplified commit strategy；offset 251 调 applyChanges、258 检查 success。正常成功分支在 267 刷新 VFS、276 记录成功项、284 finish。冲突分支调用 resolver，刷新 dirty roots；全部解决后 L573–591 的 offset 469 `afterChangesRefreshed`、514 `doUserCommit` 进入 IDE 提交流程；未解决则冲突通知，错误另有覆盖本地 / 未跟踪文件等分支。`GitRepositoryReader` 的 REVERTING 检测可见首次证据。该类“成功项”指成功处理的原 commit，不能误当作旧提交 hash 被保留为新的 revert hash。

**流程推断：** “Log 选择非 merge 提交 → Revert → 参数化 git revert → 正常成功产生新反向提交且历史保留原提交 → 刷新 Log / 工作区并通知；冲突则保留过程，解决后完成提交或中止”。IDEA 此命令层没有证据表明明确加了 `--no-edit`；Git editor 的全部设置与用户确认细节没有本次运行证据。HarborGit 采用用户先确认、再 `git revert --no-edit` 的自动提交路线，并提供冲突继续 / 中止；这是自行编写的具体 UI 与参数策略，不声称逐个复刻 IDEA 对话框。

## 6. 历史 Reset：Soft / Mixed / Hard

**事实／入口与对话框：** [GitResetAction](evidence/history-2026-10-30/javap/git4idea.reset.GitResetAction.txt) 从项目设置读上次 mode，缺失时用 `GitResetMode.getDefault`，创建 `GitNewResetDialog`；offset 51 `showAndGet`，59 读选中 mode，67 存设置，93 queue task。[后台任务](evidence/history-2026-10-30/javap/git4idea.reset.GitResetAction$1.txt) 将选中提交转换为仓库→hash map，创建 `GitResetOperation.execute`。[对话框](evidence/history-2026-10-30/javap/git4idea.reset.GitNewResetDialog.txt) 枚举 mode，显示 name / description radio controls；properties L1193 说明移动 branch head 并按所选 mode 更新 index / worktree。

**事实／四种 IDEA 模式：** [GitResetMode](evidence/history-2026-10-30/javap/git4idea.reset.GitResetMode.txt) 有 SOFT、MIXED、HARD、KEEP；`getDefault` 返回 MIXED（L63–69），static initializer 分别存 `--soft / --mixed / --hard / --keep`。这是无已存设置时的默认值，不代表当前用户一定选 Mixed。

| 模式 | 本机资源说明与 Git 参数 | 流程语义 |
|---|---|---|
| Soft | `--soft`；properties L1185：文件不变，差异处于 staged | HEAD/当前分支移到目标；index、worktree 保留 |
| Mixed | `--mixed`；L1187：文件不变，差异不处于 staged | HEAD/当前分支移到目标；index 恢复到目标，worktree 保留 |
| Hard | `--hard`；L1189：文件恢复为目标提交状态，警告本地更改会丢失 | HEAD/当前分支、index、worktree 回到目标状态；有破坏性 |
| Keep | `--keep`；L1191：目标文件状态并尝试保留本地更改 | IDEA 提供的第四模式；HarborGit 本次不实现 |

前两列是资源 / 参数事实，第三列是相应 Git 操作的流程解释。对未跟踪文件，不能把 Hard 简化为“清空整个目录”或“保证全部保留”：本次没有对所有 obstruction 情况作 IDEA 动态观察。Reset 移动引用，不能从“旧提交暂时不在当前分支历史”直接推出对象已从磁盘删除。

**事实／命令、刷新、失败反馈：** [GitResetOperation.execute](evidence/history-2026-10-30/javap/git4idea.reset.GitResetOperation.txt)，L193–318，保存文档、记录原 HEAD，offset 149 调 `Git.reset(repository, mode, target, listeners)`；失败可检查本地更改覆盖 detector，并按 policy 提供 smart reset。无论选定结果如何，都有 `updateAndRefreshChangedVfs`（218）、dirty root（230）、缓存 invalidation；最后按 map 生成成功 / 部分失败 / 失败通知。[GitImpl.reset](evidence/javap/git4idea.commands.GitImpl.txt)，L1288–1379，从 mode.getArgument 得到参数，底层 RESET handler 按列表加入模式和可选目标；它与 `resetPaths` 的路径级 Reset 不同。

**流程推断：** “在 Log 选择目标提交 → Reset Current Branch to Here → 明确模式和影响范围 → 后台 git reset <mode> <target> → 更新分支 / 文件状态 / Diff / Log，显示结果”。本次未触发任何 hard reset，也不把 IDEA 的 Local History 或 smart reset 当成客户端的备份保证。

## 7. 分析所得与独立实现边界

| 从 IDEA 包中确认的依据 | HarborGit 的自行设计 / 本次范围 |
|---|---|
| 普通变基和恢复动作不同；REBASING / SUSPENDED 可持续存在 | 自行编写 Rebase 入口、状态提示、Continue / Skip / Abort；CLI 执行与禁用条件由客户端实现和测试决定 |
| index、worktree、HEAD 是不同恢复基线 | 明确工作区恢复与全部已跟踪改动恢复的范围；以独立确认文案说明实际影响 |
| 文件 Rollback、历史 Revert、历史 Reset 是不同操作 | 分别提供文件丢弃、反向提交、移动分支引用；不把三者都标成无差别“撤销” |
| IDEA Revert 正常路径自动提交，冲突后进入 IDE commit strategy | HarborGit 确认后执行 `git revert --no-edit`；冲突后用自己的继续 / 中止 UI，不使用 IDEA 类或通用 commit strategy |
| Reset 四种 mode，按模式展示描述 | HarborGit 本次只交付 Soft / Mixed / Hard；Keep 明确未实现 |
| IDEA 有 stash / shelf saver、多根 spec、interactive / onto 等更广能力 | 本次普通单仓库变基的保护、输入校验和任务模型均为独立实现；不宣称覆盖 IDEA 所有高级选项 |

这里描述的是分析依据与已选实现边界，**不构成 HarborGit 已通过测试的证明**。客户端最终功能、打包情况与专用测试仓库验证结果以项目 README、测试输出和实现为准。没有复制或加载 JetBrains class、图标或界面代码。

## 8. 复核清单与限制

- 普通 Rebase：入口、dialog、params、process、Git handler、主要结果分支已回答；全部 editor / hooks / signature / protected-branch 情况未运行。
- Continue / Skip / Abort：各自 action→utils→process→子命令已回答；多根原子性、外部修改及恢复 saver 失败保持未确认。
- 文件 Rollback：staging 未暂存路径及传统 HEAD 路径已分别回答；所有 rename/new/deleted 组合、行级回滚未穷尽。
- 历史 Revert：正常 true boolean 分支自动提交、冲突后 doUserCommit、merge commit 禁用均有精确静态证据；未在 IDEA 写仓库。
- 历史 Reset：三种要求模式和 IDEA 第四种 Keep、参数、对话框、刷新、错误反馈均有证据；未做破坏性运行验证。
- 本次 REA 只读取已导出证据，未新开 native/archive target，也没有遗留自己创建的 active target。新增字节码属于外部工具证据，保留 class/hash/offset；不伪装成 REA runtime trace。

所有 `L` 行号指交付物中的文本证据；方法名及 offset 指 JVM 字节码位置。升级 IDEA 或源哈希变化后须重新建立依据，不能直接沿用行号。本报告未读取或导出用户仓库 URL、代码、提交记录、凭据及真实项目配置值。
