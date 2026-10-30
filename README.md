# HarborGit

HarborGit 是基于 Electron、React 和 TypeScript 开发的 Git 图形客户端，通过本机 Git 管理代码仓库，提供 Windows 和 macOS 打包配置。

**v1.6.0 支持有未提交改动时尝试变基**：勾选“自动保存未提交改动后变基”，先保存暂存、未暂存和未跟踪文件，完成或中止后尝试恢复。若在 dev 上选择对 master 变基，会切回 dev 恢复其原改动；恢复冲突时保留备份并等待处理。见 [自动保存与恢复说明](docs/REBASE-SAVED-CHANGES.md) 和 [IDEA 静态证据](docs/IDEA-REBASE-WIP-ANALYSIS.md)。

保留 v1.5 的 [指定分支与提交变基](docs/REBASE-TO-COMMIT.md)，以及 [文件回滚、Revert、Reset](docs/HISTORY-ACTIONS.md)。旧版文档中的“变基必须先处理全部改动”限制由本版的显式自动保存选项补充；Revert 等操作的限制不变。

## 项目功能

- 查看工作区和暂存区状态、文件 Diff，完成暂存、取消暂存和提交。
- 浏览彩色提交图、分支和提交历史，管理分支、合并与冲突。
- 在独立工作区中合并已提交内容，保留原项目的未提交改动。
- 管理远程仓库地址，执行 Fetch、Pull 和 Push。
- 配置 AI 接口，根据暂存区改动生成提交消息。
- 支持多项目标签页、明暗主题和操作日志。
- 变基与冲突恢复；撤销文件修改、历史反向提交及三种 Reset 模式，操作前记录原提交恢复引用。
- 变基前可选择保存未提交改动；专用 WIP 引用和恢复记录持久保留，支持恢复冲突、重新打开后处理和显式放弃原暂存划分的恢复。
- Windows Setup 安装版支持检查 GitHub 正式版更新、下载进度、取消重试和确认安装；其他分发形式提供发布页入口。

## 软件更新（v1.3.0）

安装后点击顶部 **软件更新**。默认启动 15 秒后检查新版本，也可手动检查；只检查，不自动下载或安装。下载后校验文件，由你确认退出并安装。Git 或 AI 任务运行时阻止安装，仓库未提交修改和应用配置保留；安装前请保存尚未保存的编辑内容及提交消息草稿。

旧版本需要先手动安装 v1.3.0，后续更高正式版本才可通过应用内更新获取。便携版、目录版及当前未签名 macOS 版通过发布页手动更新。更新使用公开仓库 `Lord-GEO/HarborGit`，无需在客户端填写 GitHub Token。

发布新版本时必须把 Setup、对应 `.exe.blockmap` 和 **`latest.yml`** 放入同一个 GitHub Release。工作流已补齐这三项；操作、校验命令及验证范围见 [更新与发布指南](docs/UPDATES.md)。

## 源码安装与运行

### 环境要求

- Node.js 22.12+ 和 npm。
- Git 已安装并加入 PATH；Windows 使用 Git for Windows。
- 访问远程仓库需配置 Git 凭据管理器或 SSH 密钥。

获取源码后，在项目根目录执行：

```bash
npm ci
npm start
```

开发和构建命令：

```bash
npm run dev    # 启动开发模式，界面支持热更新
npm run build  # 类型检查并生成生产构建
```

开发模式修改主进程后需要重启。首次运行或打包需要联网下载 Electron 和相关构建工具。

## 打包

### Windows

在 Windows 项目目录执行：

```powershell
npm run dist:setup     # x64 安装版
npm run dist:portable  # x64 便携版
npm run pack           # 未封装的应用目录
```

产物位于 `release/`：

- 安装版：`HarborGit-*-Setup-x64.exe`。
- 便携版：`HarborGit-*-Windows-x64.exe`。
- 目录版：`win-unpacked/`，运行其中的 `HarborGit.exe`。
- 更新附件：`latest.yml`、Setup 对应的 `.exe.blockmap`，与安装包一起上传 Release。

### macOS

在 Mac 上重新执行 `npm ci` 安装依赖，再选择打包命令：

```bash
npm run dist:mac        # Apple Silicon 和 Intel 两种架构
npm run dist:mac:arm64  # 仅 Apple Silicon（M 系列）
npm run dist:mac:x64    # 仅 Intel
```

产物位于 `release/`，文件名为 `HarborGit-版本号-macOS-arm64` 或 `HarborGit-版本号-macOS-x64`，格式为 `.dmg` 和 `.zip`。打开 DMG 后，将应用拖入 Applications。

当前 macOS 配置使用 ad-hoc 签名，未做 Apple 公证；正式分发需要配置 Developer ID 签名与公证。macOS 安装包尚未经过真机验证。

### GitHub Actions

将源码和工作流推送到 GitHub 后，打开 **Actions → Build desktop packages → Run workflow**，即可并行构建 Windows x64、macOS arm64 和 macOS x64，在该次运行的 **Artifacts** 下载产物。

推送与项目版本一致的 `v` 标签（如版本 `1.2.3` 对应标签 `v1.2.3`）会自动构建，全部成功后发布 GitHub Release 并上传安装包。使用此方式无需本地 Mac。

打包后的应用自带 Electron，使用者仍需安装 Git 并配置远程认证。
