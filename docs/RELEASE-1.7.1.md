# HarborGit 1.7.1 — 取消切换时自动刷新

日期：2026-11-03（Asia/Shanghai）。本次为刷新行为调整，使用补丁版本 1.7.1。

## 调整结果

- 切换到其他软件后再回到 HarborGit，不再自动刷新。
- 切换项目标签页，不再自动刷新；保留该项目的状态和提交消息草稿。
- 已加载过的历史、分支和标签页面保留数据，返回这些页面不再重复读取。历史分页也会保留。
- 点击右上角“刷新仓库”或按 `Ctrl+R` 才更新外部改动。历史页也可单独点击“刷新历史”。
- 首次打开仓库仍读取初始状态；在应用中暂存、提交、切换分支、打标签等操作完成后继续更新结果。操作使历史缓存失效时，下次进入历史页面读取新结果。
- 明确重新打开已经打开的仓库时，会应用这次打开操作返回的新状态，并继续使用原项目标签页。

原来的窗口 / 项目切换刷新调用的是本地 `refresh` 和历史、分支等读取，没有自动 Fetch 或 Pull。本次取消这些切换触发的读取；Fetch、Pull 和 Push 仍需用户手动确认。

外部编辑器、终端或其他 Git 工具修改仓库后，界面会保持之前的数据，直到手动刷新。历史 / 分支 / 标签页面首次读取，以及应用内操作后的更新属于必要结果展示。

## 实现与验证

[App.tsx](../src/renderer/App.tsx) 移除窗口 `focus` 和项目激活时的刷新入口；历史缓存只在首次读取或用户操作后需要更新时加载，分支、远程和标签数据在打开 / 操作 / 手动刷新后更新。Git 服务和远程命令实现没有改动。

[刷新回归](../tests/refresh-ui.spec.ts)使用专用中文空格路径仓库和本地裸仓库，记录真实 Git 活动。外部修改文件、分支与标签后，验证窗口焦点、项目切换及页面返回均无 Git 命令；手动刷新与 `Ctrl+R` 才展示改动，并检查暂存、提交、历史更新、草稿保留及明确重新打开已有项目。

[标签界面回归](../tests/tags-ui.spec.ts)对测试仓库中的外部修改改用显式刷新，适配新的交互规则。

## 验证结果

- **源码界面 4/4**：[完整日志](verification-v1.7.1-source-ui.txt)，含刷新专项与标签功能回归。
- **安装后界面 19/19**：[完整日志](verification-v1.7.1-installed-ui.txt)，覆盖切换与手动刷新、提交闭环、多项目、主题、历史操作、标签和独立合并工作区。
- **隔离安装与卸载通过**：[记录](verification-v1.7.1-installer.json)。安装后的 EXE / ASAR 与正式载荷完全一致，测试目录、注册项和快捷方式已移除；原 HarborGit 进程与路径前后一致。
- **类型检查和构建通过**：[编译](verification-v1.7.1-build.txt)、[Setup 打包](verification-v1.7.1-package.txt)。
- **更新元数据与图标通过**：[更新附件](verification-v1.7.1-update-metadata.json)、[图标](verification-v1.7.1-icons.json)。
- Git 后端与共享契约的字节哈希与 1.7.0 交付一致，沿用其 [80/80 后端基线](verification-v1.7.0-backend.txt)，本补丁未重复执行该后端套件。

汇总见 [机器可读记录](verification-v1.7.1-refresh.json)。写入验证仅使用专用仓库、本地裸仓库及独立配置。

## 运行与打包

```powershell
npm ci
npm start
npm run build
npm run test:ui -- refresh-ui.spec.ts tags-ui.spec.ts
npm run dist:setup
```

本次交付 Setup 安装版，更新附件仍为 Setup、对应 `.exe.blockmap` 和 `latest.yml`。没有推送源码、标签或发布 GitHub Release。

Setup SHA-256：`8ed13e025829f791feb086945ba5df76ae609920408713d54f66254326c8de52`。最终源码及产物身份见 [交付清单](delivery-manifest-v1.7.1.json)。
