# 智能签出：保存和恢复机制（静态证据）

本轮只读当前安装 JAR 和既有 javap 文本。当前 JAR、class member 和历史输出哈希认证见 provenance.json；11 份复用输出均匹配，没有新增 javap、执行 Git 写入或改变 REA 会话。

## 已确认

1. **按 policy 选 Shelf / Stash。** `rebase-wip-2026-10-30/javap/git4idea.stash.GitChangesSaver.txt` L71–105，getSaver(policy,boolean) +45…+116：SHELVE 构造 GitShelveChangesSaver，否则 GitStashChangesSaver。`git4idea.config.GitVcsOptions.txt` L107（构造器 +50）默认初始化为 SHELVE；这不证明用户当前持久配置值。该通用 wrapper 的 policy 实参由 checkout 调用方决定，应与主代理的 checkout 证据合并。

2. **保存成功后才运行操作。** `git4idea.util.GitPreservingProcess.txt` save L225，+8 调 saver.saveLocalChangesOrError，错误时显示 saving.failed。execute$lambda$0 L297，+0…+25 在 nonCancelable section 保存，+38…+56 仅保存成功才运行 operation；+70…+121 按 auto-load condition 恢复或通知未恢复，异常 finally +127…+183 也按同条件处理。load L258，+2…+16 先 AtomicBoolean.compareAndSet(false,true)，再 saver.load，是至多尝试一次，不是恢复成功验证。

3. **自动 Stash 保存参数。** `git4idea.stash.GitStashChangesSaver.txt` save L133（+192）调用 Git.stashSave(repo,message)，L151–152（+235…+240）将 root -> stash@{0} 的 hash 存入 myStashedRoots。`docs/evidence/javap/git4idea.commands.GitImpl.txt` stashSave L530–581（+48 push、+61 -m、+74 message）：实际为 stash push -m message，完整选定方法没有 -u / --include-untracked / --all 参数。不能把它说成移走全部未跟踪或忽略内容。

4. **恢复是 pop，可条件恢复暂存。** `git4idea.stash.GitStashChangesSaver.txt` lambda$load$0 L324–369，+51 pop、+62 isStagingAreaAvailable、+65 条件、+75 --index。`git4idea.index.GitStageManagerKt.txt` 的 isStagingAreaAvailable 检查 GitStagingAreaCommitMode。命令是 stash pop [--index]，没有显式指定保存 OID。`GitStashOperations.unstash` 使用 map 中 hash 的位置是 +270…+283 refreshUnstashedChanges（L543），并非 handler 的 pop 参数。

5. **恢复位置是当前工作树。** 上述 lambda 只用 repository root 创建 STASH handler，不签出原分支、没有记录或使用原 branch。因而若 checkout 操作已成功到 master，随后的 load 会针对 master 当前工作树执行；是否在 checkout 失败后也恢复，要结合调用方的 auto-load condition。代码不能支持“把改动永远留在 dev 然后空手去 master”的一般描述。

6. **恢复冲突单独处理。** `git4idea.stash.GitStashOperations.txt` unstash L424 起：+151 INDEX_CONFLICT_ON_UNSTASH（L486），+163 MERGE_CONFLICT_ON_UNSTASH（L491），+318…+365 index conflict 通知并 false；+366…+389 merge conflict 调 GitConflictResolver.merge（L583）并返回其结果；+390…+435 未跟踪覆盖通知；+436…+483 本地修改覆盖通知；+484…+531 一般失败通知。`GitStashChangesSaver.load` L258 的 +59 丢弃返回 boolean，上层操作完成不等于本地改动完整恢复。

7. **未解决冲突的入口。** `git4idea.stash.GitStashChangesSaver$UnstashConflictResolver.txt` notifyUnresolvedRemain L62 起，L77 / +32 Show Stash，L85 / +53 Resolve Conflicts；后者在 L101 / +1 调 mergeNoProceedInBackground。上述 unstash 的 merge-conflict 分支解决后直接返回；所选路径没有后续显式 stash drop 调用。

8. **Shelf 是独立机制。** `com.intellij.openapi.vcs.changes.VcsShelveChangesSaver.txt` save L87 / +60 getAllChanges；按 root 过滤本地 Change / changelist，在 L139 / +190 和 L165 / +250 调 VcsShelveUtils.shelveChanges，保存 changelist id -> ShelvedChangeList，再 L176 / +272 doRollback。GitShelveChangesSaver 的 doRollback 分支 +130 / +303 resetHardLocal，或 +250 restoreStagedAndWorktree 与 +261 restoreStaged（均为已保存后的清理，不能作为恢复 index 划分证据）。平台 load L183 起，L236 / +131 调 doSystemUnshelve，L239 / +138 检查 ABORT 后退出剩余列表恢复。它不等于 git stash -u。

## checkout 默认 execute() 的特例

主代理已确认 smartCheckout 调用无参 execute()。该方法在 GitPreservingProcess.txt L275–281 +1 传 null，经默认桥到 execute(null)。因此 execute$lambda$0 的 +71（正常路径）和 +129（异常 finally）都直接进入 load 路径；保存成功后，即使 checkoutOrNotify 报告失败或 operation 抛异常，也会尝试在**当时的当前工作树**恢复，失败时当前分支不一定是目标分支。保存失败时 +38/+39 跳过 operation 和 load。这里不能继续沿用一般 wrapper 的“需结合未知条件”措辞，因为 checkout 调用点已消除了这个条件歧义。

保存范围也有两层：GitPreservingProcess 仅处理调用者传入的 rootsToSave；在这些 roots 之内，StashChangesSaver.save（L52 起，+56…+192）逐 root 执行整仓 stashSave，没有只保存冲突文件的 pathspec。Shelf 保存按 roots 过滤全部已知 Change/changelist。哪些 roots 被 checkout 调用者纳入，仍以主代理的 smartCheckout 调用点为准。

## 推断

- 成功 checkout 后立刻恢复的效果是把原有 WIP 带到目标分支；目标分支上的同一修改区域可能与 WIP 冲突，故智能签出只能尝试保存、签出、恢复，不保证无冲突。
- 根据 git pop 的通常语义，成功可移除 stash 栈项，发生合并冲突时 stash 通常保留；这是命令语义推断，不是本轮运行观察。代码中 root -> hash 映射不等于 HarborGit 的持久 refs/harborgit/wip 备份设计，也未证明它防住并发改变 stash 栈的情况。

## 未确认

- 用户当前的 saveChangesPolicy、是否启用 staging commit mode、真实 IDEA 当前 UI 文案和子进程轨迹。
- Shelf patch engine 对任意 untracked、ignored、二进制 / rename 特例的覆盖，以及原 index 的完整重建；通用 getter/getAllChanges 不能证明全部未跟踪文件都进入保存。
- 崩溃 / 强制结束 / 并发 stash 操作后的所有恢复和保留策略。没有读取用户 stash 内容或真实仓库。
