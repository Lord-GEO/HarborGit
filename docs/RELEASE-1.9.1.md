# HarborGit 1.9.1 — Pull 自动保存与合并

点击右上角 **↓ Pull**，选择远程和分支后执行。有未提交改动时，默认勾选“自动保存并恢复本地改动”：先获取远程更新，再保存暂存、未暂存和未跟踪文件，合并后恢复改动及原暂存状态。

- 本地和远程分叉时创建合并提交，不再因只能快进而中止。
- 远程合并冲突：先解决冲突，填写提交信息，点击“提交合并并恢复原改动”；也可中止合并并恢复原改动。
- 本地改动恢复冲突：单独显示恢复状态，处理文件后点击“结束恢复并保留备份”，然后可正常提交。必要时可明确选择恢复为未暂存修改。
- 专用 WIP 引用和 Stash 保留；重新打开仍可处理未完成的恢复，不自动重复应用。
- 网络失败发生在保存前。重名未跟踪 / 忽略内容、外部变更或不确定的恢复版本仍会拦截，避免覆盖。

这是 1.9 自动保存工作流的后续补丁，版本号为 1.9.1。[IDEA 取证及自行设计](IDEA-PULL-SAVE-ANALYSIS.md) 区分直接 Pull 与 Update Project；本功能借鉴 Update 的分阶段保存机制，独立编写实现。

## 验证范围

- [5 个后端专项](verification-v1.9.1-pull.txt)：获取失败不动 WIP、快进恢复原暂存与未暂存状态 / 中文空格路径 / 二进制未跟踪文件 / 旧 Stash、分叉合并、合并冲突重开后继续、合并中止、恢复冲突禁止重放。
- [最终参数核对及共用保存器回查](verification-v1.9.1-focused.txt)。
- [打包版界面流程](verification-v1.9.1-pull-ui.json)：Pull 默认选项、远程冲突、提交合并后恢复冲突、文件编辑及结束恢复。
- [生产构建](verification-v1.9.1-build.txt)、[Setup 打包](verification-v1.9.1-package.txt)、[更新附件校验](verification-v1.9.1-update-metadata.json)、[最终打包内容](verification-v1.9.1-final-package.json)。

全部写入验证仅使用临时测试仓库，远程仅本地裸仓库；使用隔离应用配置。没有操作真实 Codeup 仓库、当前安装目录或真实 AI 配置；没有运行全量回归或安装卸载测试，没有上传 GitHub。

## 启动与打包

```powershell
npm ci
npm start
npm run dev
npm run test:pull
npm run dist:setup
```

安装包：`release/HarborGit-1.9.1-Setup-x64.exe`。交付哈希见 [清单](delivery-manifest-v1.9.1.json)。

本次未添加 Pull 变基 / squash 策略选择、备份自动清理、子模块与符号链接的智能保存；遇到这些特殊文件或真实覆盖风险会保守阻止。

Setup SHA-256：`fb87a4b691fc5416e073f72868144898cfae97e0939571c5d3c66c7c7102066b`。
