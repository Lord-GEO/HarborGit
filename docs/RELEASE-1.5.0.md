# HarborGit v1.5.0 — 指定分支变基到所选提交

提交历史新增“变基到此提交”。选择 dev 的某次提交，再将“要变基的分支”设为 master，即可执行 master → 该提交，无需先手动切分支。master 没有独有提交时前进到目标，有独有提交时重放到目标之后；dev 的引用与后续提交保持不变。

对话框显示源分支快照与目标 hash，执行时会切到所选源分支，核验当前 HEAD、源分支 tip 和 worktree 占用。恢复引用指向真正被修改源分支的原 tip。原有目标分支模式、继续/跳过/中止及路径保护保持可用。

- [使用与验证](REBASE-TO-COMMIT.md)
- [IDEA 静态证据及实现差异](IDEA-REBASE-TARGET-ANALYSIS.md)
- 构建：`npm run dist:setup`；更新附件核验：`npm run verify:updates`。
- Setup SHA-256：`a2f8b81ccde9e344d28d01149fb55be90eb7d2fc78e7f0dc96e8d4523b1b762a`。
- 验证：完整后端 57/57、专项界面 2/2、安装后界面 7/7 通过；安装、卸载、更新附件和自有图标资源均已核验。

选中提交作基底会包含它的祖先，不是只复制该提交补丁的 cherry-pick。本次没有提供高级 --onto 范围移植、交互式变基或自动 stash；当前工作区仍需先处理未提交改动。中止非当前源分支的变基会恢复该源分支，停留在它上面。

本次未推送源码/tag 或发布 GitHub Release。客户端代码和交互独立编写，没有依赖 IDEA 运行。验证明细和交付哈希见 [使用说明](REBASE-TO-COMMIT.md)及[交付清单](delivery-manifest-v1.5.0.json)。
