# HarborGit v1.4.0 — 变基与回滚

新增普通 Rebase 及冲突后 Continue/Skip/Abort；支持选择保留合并结构。新增文件恢复、Revert 反向提交、Soft/Mixed/Hard Reset，明确区分工作区、index 与 HEAD。

历史操作前记录原 HEAD 恢复引用，检测过期确认、路径覆盖碰撞及进行中的 Git 操作。Hard 与文件撤销需要明确确认，无关未跟踪/ignored 内容保留。恢复引用不是未提交文件备份。

- [操作与测试说明](HISTORY-ACTIONS.md)
- [本机 IDEA 增量逆向报告](IDEA-HISTORY-ANALYSIS.md)：区分已确认静态事实、流程推断、未确认内容；REA JVM 限制与 javap 替代分析有原始定位。
- 保留 v1.3 的应用更新，发布需包含 Setup、blockmap 和 latest.yml。
- 构建：`npm run dist:setup`；更新附件核验：`npm run verify:updates`。
- 验证：后端 51/51；完整界面 13 项通过、1 项安装版条件跳过；实际安装后界面 5/5 通过，安装及卸载已核验。
- Setup SHA-256：`7701ff1c91d64537504665e3c1c22195f20fa36ef75a649ffb6c483ac3bb956d`。

本次不提供交互式变基、自动 stash/shelf、Reset Keep、行级回滚或强推；变基/Revert 前需先处理未提交改动。IDEA 本机版本禁用 merge commit 的 Log Revert，HarborGit 通过显式 mainline 选择扩展支持它。代码、界面和保护策略均为独立实现。

测试记录与交付哈希见 [操作说明](HISTORY-ACTIONS.md) 和 [交付清单](delivery-manifest-v1.4.0.json)。本次未推送或发布 GitHub Release；macOS 新功能尚未做真机验证。
