# HarborGit 1.2.1 更新说明

本版本新增 Windows Setup 安装包，替换 Electron 默认图标。Git 操作、提交图、AI 设置和现有仓库数据格式沿用 1.2.0。

## 安装包

- 文件：`HarborGit-1.2.1-Setup-x64.exe`，Windows x64，约 118 MiB。
- NSIS 向导安装，默认面向当前用户，无需管理员权限，可选择安装目录。
- 支持桌面、开始菜单快捷方式，安装结束后可启动应用。
- 在 Windows“设置 → 应用”中卸载；保留用户配置和加密 AI Key，不删除 Git 仓库。
- 安装前关闭现有 HarborGit。便携版用户可直接安装，安装后继续使用 `%APPDATA%/HarborGit` 中的配置。
- 当前构建未进行代码签名，没有加入自动更新服务。

构建命令：`npm run dist` 或 `npm run dist:setup`。可选便携版命令：`npm run dist:portable`，本次交付以 Setup 为主。

## 自有图标

采用深蓝背景、薄荷绿 H 与 Git 分支节点，自行绘制矢量路径。图标用于应用 EXE、窗口、安装器、卸载器及界面品牌位置。

源文件：[harborgit.svg](../assets/harborgit.svg)。`npm run icons` 使用项目自带 Electron/Chromium 将 SVG 生成 11 个 PNG 尺寸，并组装含 16–256 像素共 9 个尺寸的 Windows ICO，无需额外图像处理依赖。

![应用图标](../assets/harborgit-256.png)

## 验证

- [生产构建与 Setup 打包](verification-v1.2.1-build.txt)：TypeScript 检查、Vite/主进程构建、NSIS 打包通过。
- [图标资源核验](verification-v1.2.1-icons.json)：解析实际交付 Setup 和应用 EXE 的 PE 资源，两者各 9 个图标帧与自有 ICO 的 PNG 字节一致。提取预览：[应用](screenshots/app-exe-icon.png)、[安装器](screenshots/setup-exe-icon.png)。
- [安装和卸载](verification-v1.2.1-installer.json)：带空格和中文的目录安装成功，核对版本、卸载注册项及两个快捷方式目标；卸载后程序、注册项和快捷方式均移除。
- [安装后界面闭环](verification-v1.2.1-installed-ui.txt)：真实已安装 EXE 通过打开仓库 → Diff → 暂存/取消暂存 → 提交 → 历史 → 创建/切换/删除分支，**1/1 通过**，同时核验界面新图标加载正常。所有写入仅使用新建专用仓库和隔离用户配置。

为保护电脑上正在运行的 HarborGit 便携版，安装测试使用 `HarborGit Installer QA` 独立安装标识和 EXE 文件名；NSIS 配置沿用正式版，应用载荷一致，安装后的 EXE SHA-256 与交付应用完全相同。测试前后原 HarborGit 主进程 PID 均为 48208，测试结束已卸载 QA 程序并清理测试目录。此结果不等同于在用户环境中实际安装正式名称版本；本次未测试已有安装版升级、多用户/管理员安装或手动向导的每个页面。

测试脚本：先运行 `node scripts/prepare-installer-qa.mjs`，再运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-installer.ps1`。它只接受工作区专用测试根路径，拒绝覆盖已有 QA 注册项或快捷方式。运行图标核验：`node scripts/verify-icons.mjs`。

Windows PowerShell 5 的测试脚本首轮把 Node 的颜色提示 stderr 误作终止错误，且默认文本编码误读中文路径。已显式使用 UTF-8、按实际子进程退出码判定，重新安装到正确中文路径，以上链接为最终通过结果。这是验证工具调整，应用载荷未改变。

本次未修改 Git 或 AI 业务逻辑，没有重复完整后端/网络回归；1.2.0 的完整功能结果见 [上一版本记录](RELEASE-1.2.md)。

## 文件校验

Setup SHA-256：`fbad48df08980fe84966198ec8c0d43cde2971d0343c4e3ee3476743622b37ac`。

应用 EXE SHA-256：`826e51e6163d5debb1f1de675e58bd8d187075e95bf2e4603744b52132b0e1a7`。

源码和应用载荷清单见 [交付清单](delivery-manifest-v1.2.1.json)。
