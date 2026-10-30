# IDEA 增量证据：指定源分支变基到特定提交

调查日期：2026-10-30（Asia/Shanghai）。本报告回答两个独立问题：IDEA 如何把“所选提交”作为基底，以及普通 Rebase 对话框如何指定非当前源分支。以下均为本机交付包的静态证据；没有在 IDEA 或用户真实仓库执行变基。

## 1. 身份、REA 复用与格式边界

目标仍是 IntelliJ IDEA 2026.1.3，安装目录 `D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3`。本次重新核对的后端 `plugins\vcs-git\lib\vcs-git.jar` SHA-256 为 `6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0`，与前两次一致；前端 JAR SHA-256 为 `0e5135d36bcb94fbf4f5773bb123bd2f964566b872988bee6d5cfc6a0de75a17`。详见 [源身份](evidence/rebase-target-2026-10-30/source-identities.json)。

REA 6.8.0 起始 session 为 `open=false / cleanup_pending=false`。使用 `inspect_analysis_view(source: evidence-file)` 认证并复用 [首次 bundle](evidence/rea-evidence-bundle.json) 的 inventory `ev_b3436a50eea22fcaae9597c602b3ada48b0592bf729014c1efc1ffce19e530e3`，精确选择 5 个 class occurrence：GitRebaseOntoCommitAction、GitLogBranchOperationsActionGroup、GitRebaseDialog、GitRebaseParams、RebaseUpstream.Companion；全部 `hash_status=verified`。新 view Evidence ID 为 **`ev_8b7dc91bb0b6677fa4a86a56cfd5e492ed6af0b4c266c3e7ef8178131b7e378a`**，见 [occurrence 记录](evidence/rebase-target-2026-10-30/rea-selected-occurrences.json) 和 [导出的 view bundle](evidence/rebase-target-2026-10-30/rea-view-bundle.json)。没有重复完整 JAR inventory。

REA 不支持独立 JVM `.class` 的限制沿用 [首次格式记录](evidence/rea-class-format-limitation.json)，未重复失败探测。用现有 JDK `javap -p -c` 补充 11 个精确 class，另核验并复用 7 个已有输出。每个 class / JAR / 输出 SHA-256 及工具参数见 [新增来源](evidence/rebase-target-2026-10-30/javap-provenance.json)、[复用来源](evidence/rebase-target-2026-10-30/reused-bytecode.json)；[采集脚本](evidence/rebase-target-2026-10-30/collect_rebase_target.py) 会跳过哈希一致的旧结果。本次没有启动 UI、附加进程或产生 Git 写操作。

## 2. Log 的“Rebase Current onto Selected”究竟指什么

**已确认事实／入口注册与名称：** 原 [plugin.xml](evidence/resources/backend/META-INF/plugin.xml) L36 注册 `Git.BranchOperationGroup → GitLogBranchOperationsActionGroup`，L294 将它加入 Log 上下文菜单。原 [GitBundle.properties](evidence/resources/frontend/messages/GitBundle.properties) L1112–1115 有：`Rebase {0} onto {1}`、`Rebase {0} onto Selected Commit`、`Rebase Current onto Selected`。这些精确位置与 SHA-256 已保留在 [资源摘录](evidence/rebase-target-2026-10-30/resource-excerpts.json)。不能只凭字符串断定它们都是同一个静态菜单项。

**已确认事实／动态菜单分支：** [GitLogBranchOperationsActionGroup.getChildren](evidence/rebase-target-2026-10-30/javap/git4idea.ui.branch.GitLogBranchOperationsActionGroup.txt) 接受选定 `CommitId`。offset 195–202 检查该提交关联的 branch refs：存在 refs 时构建本地 / 远程分支动作组；没有 refs 时，offset **371** 创建 `GitRebaseOntoCommitAction(project, repository, selectedCommitId)`。因此同一个 Log 位置的动作文本与分组会随所选提交是否带分支引用而变化。

**已确认事实／任意所选提交路径：** [GitRebaseOntoCommitAction](evidence/rebase-target-2026-10-30/javap/git4idea.ui.branch.GitRebaseOntoCommitAction.txt) 的 `update` 用 `branches.rebase.onto.selected.commit`（offset 58）生成包含当前分支名的文本；detached HEAD 会禁用；若 Log 数据已可用，还会检查目标是否已经包含在当前分支中并调整可见 / 可用状态。它不是“把所选 commit 的补丁复制过来”的动作。

其 `actionPerformed` 的关键字节码为：offset **21** 取所选 hash，**24** 调 `Hash.asString`，**29** 调 `GitBrancher.rebase(repoList, hashString)`。参数是所选提交的 hash，而非强制使用某个分支最新 tip。随后 [GitBrancherImpl](evidence/rebase-target-2026-10-30/javap/git4idea.branch.GitBrancherImpl.txt) 创建后台 task；[GitBrancherImpl$10.execute](evidence/rebase-target-2026-10-30/javap/git4idea.branch.GitBrancherImpl$10.txt) offset 24 调 `GitBranchWorker.rebase(repositories, reference)`。原 [GitBranchWorker](evidence/javap/git4idea.branch.GitBranchWorker.txt) 创建仅设置 upstream 的 `GitRebaseParams`，再调 `GitRebaseUtils.rebase`。

**已确认事实／分支引用路径的命名：** [GitRebaseBranchAction](evidence/rebase-target-2026-10-30/javap/git4idea.actions.branch.GitRebaseBranchAction.txt) 构造器 offset 1 使用 **`branches.rebase.current.onto.selected`**，也就是“Rebase Current onto Selected”；更新时可替换为具体源 / 目标分支名，执行时传所选 `GitReference` 给 GitBrancher。它仍以当前分支为被重放者。

**流程推断：** Log 中选择某个提交 → 由对应动作确定所选 hash / ref → 将**当前分支**变基到那里 → 进入既有后台 RebaseProcess，成功刷新仓库 / Log，冲突时保留可继续状态。本次没有点击该菜单。若要指定一个非当前源分支，不能把这条 Log 动作本身描述成“自带任意源分支选择器”；下节的普通对话框提供另一条入口。

## 3. 普通 Rebase 对话框能否选择非当前源分支

**已确认事实：** 本机资源有 `rebase.option.switch.to.branch=Select another branch to rebase`（L205）、`rebase.dialog.branch.field=source branch`（L199）、目标字段提示 `branch or hash`（L196）、new base / old base 的分别提示（L197–198）。

已有 [GitRebaseDialog](evidence/history-2026-10-30/javap/git4idea.rebase.GitRebaseDialog.txt) 中：

- `updateTopPanel / updateBottomPanel` 根据 **SWITCH_BRANCH** 选项显示源分支字段（L1891、L2008 起）；`addBranchField` 将它放入对应 placeholder。
- `updateBranches`（L1100 起）用 repository 的 **localBranches** 名称填充候选项。
- `validateBranch`（L830 起）仅在 SWITCH_BRANCH 被选择时启用；检查非空，并把输入与 localBranches 的名字列表比较（offset 176 `List.contains`），失败显示 branch.invalid。该路径没有要求输入必须等于当前分支。
- `getSelectedParams`（L430 起）offset 4 读 `branchField.getItem`，30 读可选 `ontoField`，80 将 upstream 输入解析为 RebaseUpstream，118 将 **version、branch、newBase、upstream、selected flags** 送入 GitRebaseParams 构造器。

**流程推断：** 选择“切换到另一分支进行变基” → 选本地源分支 → 输入或选择 upstream（可以是提交 hash）→ 后台执行 `git rebase <upstream> <sourceBranch>`。Git 会按 source 参数切到该分支再执行变基；不是直接原地修改一个完全不切换的后台分支。是否被别的 worktree 占用、脏工作区如何处理及 UI 最终焦点，本次没有 IDEA 动态证据。

## 4. branch、upstream 与 newBase 的精确关系

**已确认事实／hash 不是只接受分支名：** 新增 [RebaseUpstream.Companion.fromRefString](evidence/rebase-target-2026-10-30/javap/git4idea.branch.GitRebaseParams$RebaseUpstream$Companion.txt) offset 45 调 `GitUtil.isHashString`；匹配时在 65 创建 `RebaseUpstream.Commit(HashImpl.build(input))`，否则创建 Reference。Commit 继承 Reference，最终可提供 ref 字符串。空输入的底层 fallback 不能代替对话框和客户端的输入验证。

**已确认事实／参数顺序：** 原 [GitRebaseParams](evidence/history-2026-10-30/javap/git4idea.branch.GitRebaseParams.txt) 主构造器 offset 101 保存第二个参数为 `branch`，158 保存第三个为 `newBase`，32 保存 upstream；空白 branch / newBase 会归一为 null。`asCommandLineArguments`（L229 起）先加入 flags，然后：

```text
244–280: newBase 非空 → 添加 ["--onto", newBase]
286–338: upstream 为 Reference/Commit → 添加 upstream.ref
         upstream 为 Root → 添加 "--root"
350–362: branch 非空 → 最后添加 branch
```

原 [GitImpl.rebase](evidence/javap/git4idea.commands.GitImpl.txt) offset 54 选择 REBASE，68 调上述组参方法，71 以列表加入参数。该层不存在把 hash 自动替换为分支 tip 的证据。

| 输入字段 | 普通模式的作用 | 启用 `--onto` 时的作用 |
|---|---|---|
| `branch` / source branch | 选择要切换并重放的本地分支；省略时为当前分支 | 同左 |
| `upstream`（ref 或 hash） | 同时确定普通重放的上游边界和新基底 | 作为旧上游 / 排除边界；不再单独代表新基底 |
| `newBase` | null，不生成 `--onto` | 显式的新基底；生成 `--onto newBase` |

表中作用属于由命令组参推导的 Git 流程语义；实际重放集合还受 Git 的等价补丁、merge、版本和 flags 影响。对话框 `moveNewBaseValue`（L1744 起）在开关 ONTO 时还移动字段值并清空原字段，说明 UI 明确区分这两种参数模型。

概念命令分别是 `git rebase <targetHash> <sourceBranch>` 和 `git rebase --onto <newBase> <oldUpstream> <sourceBranch>`。指定某个历史提交作为普通基底，本身不需要高级 `--onto`。

## 5. 用户的 A–B–C 示例：推断与客户端验证预期

以下是**Git 语义推断及应由专用测试仓库核验的预期**，不是 IDEA 动态观察结果。设初始提交链为：

```text
A ── B ── C
↑         ↑
master    dev
```

其中 B 是 dev 比 master 多出的第一个提交，C 是第二个。对于“指定 master 变基到第二个提交”，目标应固定为 **C 的 hash**。

| 用户选择 | 概念命令 | 预期结果 |
|---|---|---|
| master → B | `git rebase B master` | master 到 B，dev 仍在 C；最终当前分支是 master |
| master → C | `git rebase C master` | master 到 C，与 dev 指向同一提交；dev 不移动 |
| master 有 A 后的独有 D，目标 B | `git rebase B master` | 把 master 独有提交重放到 B 后面，例如得到 D′；可能冲突 |

在前两种纯祖先场景中，通常只是快进，没有源分支独有提交需要重新生成。**选择 C 作为基底会包含其祖先 B 的历史；不是只取 C 的补丁。** 操作的引用归属是源分支 master，目标所在的 dev 分支无需跟随变化。若起点不满足这个图、启用了额外 flags 或外部状态改变，必须按实际仓库结果判断。

区别如下：

- **普通 rebase 到任意提交**：目标 hash 是新基底；重放源分支相对它的候选独有提交。
- **高级 `--onto` 范围移植**：新基底与旧边界分别给出。例如移植某个源分支上 oldUpstream 之后的序列到 newBase；不等同于简单选一个目标提交。
- **Cherry-pick 某个提交**：在当前分支上应用该提交相对父提交的补丁并创建新的提交；不会因为选了 C 就把 A→B→C 整条链设为该分支基底。

## 6. 独立实现范围与未确认内容

HarborGit 可以自行设计“源分支下拉框 + Log 所选 commit 作为目标 + 完整 hash / subject 预览”的统一入口，并在确认时明确最终会切到源分支。这是把 IDEA 两条已确认能力组合为独立交互，不声称照搬某个 IDEA 窗口。输入完整解析成 commit 后固定 hash、阻止当前进行中操作、检验本地源分支、脏工作区及 worktree 占用，是客户端自己的实现和验证职责。

本次已回答 Log 的具体 action / 文本及 hash 调用链、普通对话框的非当前 source 选择、GitRebaseParams 三个字段和参数顺序。未确认：用户本机此刻这些选项的现场显示、每个 branch refs 菜单的最终布局、IDEA 真实子进程命令、实际提交图变化、所有 saver / hooks / editor / 签名 / worktree 分支。没有复刻高级 `--onto`、交互式 rebase 或 cherry-pick 的实现承诺。客户端的测试结果必须另行记录，不能反向标注为 IDEA 已观察事实。

本报告所有方法 offset 指 JVM 字节码位置，L 指本交付物的证据文本行。最终 REA session 与增量文件哈希见 [session-and-scope.json](evidence/rebase-target-2026-10-30/session-and-scope.json)、[文件清单](evidence/rebase-target-2026-10-30/file-manifest.json)；本次仅使用认证证据文件 view，没有打开新的 active target。
