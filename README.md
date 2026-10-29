# HarborGit

HarborGit 是基于 Electron、React 和 TypeScript 开发的 Git 图形客户端，通过本机 Git 管理代码仓库，提供 Windows 和 macOS 打包配置。

## 项目功能

- 查看工作区和暂存区状态、文件 Diff，完成暂存、取消暂存和提交。
- 浏览彩色提交图、分支和提交历史，管理分支、合并与冲突。
- 在独立工作区中合并已提交内容，保留原项目的未提交改动。
- 管理远程仓库地址，执行 Fetch、Pull 和 Push。
- 配置 AI 接口，根据暂存区改动生成提交消息。
- 支持多项目标签页、明暗主题和操作日志。

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
