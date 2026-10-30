# HarborGit v1.6.0 — 保存未提交改动后变基

有未提交改动时，变基对话框现在提供“自动保存未提交改动后变基”。先保存暂存区、工作区和普通未跟踪文件，再变基；结束或中止后尝试恢复原暂存状态。若在 dev 有修改时指定对 master 变基，完成后切回 dev 恢复其 WIP，不会自动把它提交到 master。

恢复可能与变基后的内容冲突。此时显示专用备份和冲突处理入口，处理完毕后需确认结束恢复；不自动创建提交。取消或重新打开项目后保留记录，不盲目重复应用已可能写入的内容。已有用户 Stash、此次 Stash 和专用 WIP 引用均不自动删除。

- [使用、恢复范围和实现位置](REBASE-SAVED-CHANGES.md)
- [IDEA 的 REA / javap 证据及独立设计差异](IDEA-REBASE-WIP-ANALYSIS.md)
- [GitHub Release 描述](../release-notes.md)

## 运行与打包

```powershell
npm ci
npm start
npm run dist:setup
```

Setup 位于 `release/HarborGit-1.6.0-Setup-x64.exe`。发布更新时应同时上传它、对应 `.exe.blockmap` 与 `latest.yml`；执行 `npm run verify:updates` 可校验附件。本次仅生成本地交付，没有提交或推送源码、tag，也没有上传 GitHub Release。当前运行的旧版应用未被替换，安装新版后才会显示新增选项。

## 验证

| 验证项 | 结果与原始记录 |
| --- | --- |
| 完整 Git / 多项目 / AI / 远程 / 更新回归 | **68/68**，[日志](verification-v1.6-tests.txt)；其中新增 WIP 测试 11 项 |
| 自动保存与恢复专项初轮 | **8/8**，[日志](verification-v1.6-rebase-save.txt)，新增 3 项另在完整回归中通过 |
| 两个新增真实 Electron 界面流程 | **2/2**，[日志](verification-v1.6-rebase-ui.txt) |
| 最终安装载荷的界面回归 | **9/9**，[日志](verification-v1.6.0-installed-ui.txt)，含新旧历史操作及更新入口 |
| 隔离安装 / 卸载 | **通过**，[记录](verification-v1.6.0-installer.json)；使用独立 QA 标识与中文空格目录，EXE / ASAR 与交付载荷逐字节相同 |
| Setup 更新附件与校验和 | **通过**，[记录](verification-v1.6.0-update-metadata.json) |
| 应用及 Setup 自定义图标 | **通过**，[9 个尺寸记录](verification-v1.6.0-icons.json) |
| 类型检查与生产打包 | **通过**，[最终构建记录](verification-v1.6-package.txt) |

所有 Git 写入使用专用测试仓库，远程验证使用本地裸仓库。覆盖同文件 staged / unstaged 划分、二进制与中文方括号文件名、已有 Stash 保留、跨分支恢复、重启后 Abort、冲突后 Continue、恢复冲突、同名未跟踪文件保护、取消后找回、保存意图中断找回、外部分支引用变化，以及 `--index` 失败后未部分写入时的显式恢复。安装验证前后现有 HarborGit 主进程 PID 27904、路径 `D:\Harbor\HarborGit\HarborGit.exe` 相同。

Setup SHA-256：`df668d64e2a317e241958b81911545e061161dbe98f7ad940909991a539741ed`。最终源码及产物哈希见 [交付清单](delivery-manifest-v1.6.0.json)。

## 分析与实现边界

已确认 IDEA 静态流程会先保存 dirty 修改再变基，并按结果恢复；其 Shelf 默认初始化、自动 Stash 参数、条件 `--index`、取消和跨分支恢复边界见证据报告，未冒充真实运行轨迹。REA 对独立 JVM class 的格式限制已说明，并用现有 JDK `javap` 继续分析。

HarborGit 的界面、显式选择、包含普通未跟踪文件、唯一 Stash 归属校验、持久引用、原分支恢复和保留备份策略是独立编写的实现，不宣称与 IDEA 完全相同。忽略文件不收入备份，特殊文件模式不支持该自动流程；恢复成功也不自动删除备份。显式不保留暂存划分的恢复仍可能按 Git 行为暂存新增文件，应检查结果。

本版未实现 Shelf、高级 `--onto`、交互式变基或对任意文件系统 / 外部并发写入的完整事务保证。Revert 等原有历史操作仍保留各自的干净状态要求；本次没有放宽这些操作。断电与所有多进程竞争情形未穷尽测试。
