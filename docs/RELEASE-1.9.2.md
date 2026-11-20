# HarborGit 1.9.2 — 分支合并自动保存补丁

修复分支页“合并到当前”仍直接执行 git merge、被未提交配置文件阻止的问题。1.9.1 的 Pull 自动保存只覆盖 Pull；Pull 恢复已结束后，本地修改重新出现在工作区，普通分支合并仍可能被 Git 的覆盖保护中止。

## 使用

在 master 的分支管理中，找到 dev 并点击“合并到当前”。本地分支和远程分支入口均支持：

1. 有本地改动时，自动保存暂存、未暂存和未跟踪文件，建立专用 WIP 引用。
2. 把所选分支的已提交内容合并到当前分支；允许快进或生成合并提交。
3. 合并成功后恢复原改动和暂存状态；WIP 及 Stash 备份保留。

无冲突时自动恢复原暂存划分；恢复有冲突时，Git 可能把其他修改也加入暂存区，请检查并按需逐项取消暂存。

分支合并冲突时，原改动继续保存在备份中。解决冲突后填写提交信息，点击“提交合并并恢复原改动”；也可“中止合并”并恢复原改动。本地改动恢复时产生的冲突单独展示，解决后点击“结束恢复并保留备份”，再按需提交。

重名未跟踪 / 忽略内容、过期的源分支提交或当前分支变化仍会阻止操作。真实冲突需要选择或编辑正确内容。忽略文件不收入备份，特殊文件的保守保护继续保留。

## 实现与分析依据

本次是源码修复，没有重新运行 IDEA 逆向分析。复用 [1.9.1 对 IDEA Update 保存与恢复的静态分析](IDEA-PULL-SAVE-ANALYSIS.md) 及项目自行编写的保存机制。

- `src/main/git-service.ts`：原 merge 分发路径直接调用 merge；现改为 mergeWithSavedChanges，并与 Pull 共用 integrateSavedChanges / finishSavedMerge。保存对象使用唯一 token、精确 OID 和固定 refs，恢复前核对分支与合并结果。
- 分支源用完整 refs/heads 或 refs/remotes 解析，防止同名标签替代所选分支。界面传入当前 HEAD、当前分支和所选分支提交，拒绝过期操作。
- 新的分支合并记录使用 v4，旧 v1 变基、v2 签出、v3 Pull 记录继续兼容。保留原工作区、暂存区、未跟踪内容；合并提交中不混入这些改动。
- `src/renderer/App.tsx`、`RebaseSavedChangesBanner.tsx`：本地和远程分支合并统一入口、分支合并备份阶段、继续 / 中止后的恢复、恢复冲突的“合并后的内容”标签。

## 有限验证

- [4 个分支合并专项](verification-v1.9.2-merge.txt)：三个配置文件的暂存 / 未暂存恢复、中文空格路径和二进制未跟踪文件、旧 Stash、同名标签、过期源分支、未跟踪 / 忽略碰撞、合并冲突重开后继续、中止合并、恢复冲突禁止重放。
- [2 个既有 Pull 冲突回查](verification-v1.9.2-pull-regression.txt)，仅本地裸仓库。
- [最终打包版界面](verification-v1.9.2-merge-ui.json)：从 dev“合并到当前”，分支合并冲突 → 合并提交 → 本地恢复冲突 → 手工处理、检查并调整暂存划分后结束恢复；原配置和未跟踪内容保留。
- [构建](verification-v1.9.2-build.txt)、[Setup 打包](verification-v1.9.2-package.txt)、[更新附件校验](verification-v1.9.2-update-metadata.json)、[包内字节核对](verification-v1.9.2-final-package.json)。

仅使用专用临时仓库及隔离应用配置，没有写入真实项目、真实远程或当前安装目录。没有运行全量测试或安装卸载验证，没有提交、打标签或发布 GitHub。

## 启动与交付

```powershell
npm ci
npm start
npm run test:merge
npm run dist:setup
```

安装包为 release/HarborGit-1.9.2-Setup-x64.exe，源码和附件的哈希见交付清单。版本为修复现有智能保存流程的 1.9.2 补丁。

Setup SHA-256：`895bb1835473d21f77b8296e0f626288933625e506dc130e3c291389c8614c8f`。
