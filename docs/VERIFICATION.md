# 实际验证记录

日期：2026-10-29（Asia/Shanghai）。环境：Windows x64（系统版本 10.0.26200）、Git 2.50.1.windows.1、Node 26.13.0、npm 11.20.0、Electron 45.1.0、React 19.3.1、TypeScript 5.9.3、Playwright 1.64.1。

## 写入范围

后端测试仅创建 `work/git-integration/harborgit-test-*`，界面测试仅创建 `work/ui-integration/harborgit-ui-*`，单文件启动检查仅创建 `work/portable-smoke/harborgit-portable-*`。每组结束前检查待删除目录的绝对路径处于专用父目录且名称前缀匹配，然后清理。所有 Git 身份设置在测试仓库 local config，远程验证仅连接新建本地裸仓库。没有对用户真实仓库、真实远程或全局 Git 配置执行写测试。

## 构建与后端

`npm run build` 的 TypeScript 检查、Vite renderer 构建和 esbuild main / preload 构建全部通过。`npm run pack` 与 `npm run dist` 实际完成 Windows x64 目录包和单文件便携包。

后端 `npm test`：**10/10 通过，无跳过**。最后全量验证在批量路径改为 stdin NUL pathspec 后完成，耗时 30.296 秒；[原始输出](verification-backend.txt)。

1. Unborn 仓库、Unicode / 空格 / `-` 前缀 / 通配符外观路径，首次暂存 / 取消暂存 / 提交 / 历史。
2. 同一文件同时有 index / worktree 修改，Diff 范围保持独立；删除、rename、二进制。
3. 分支创建 / 切换 / 已合并删除，未合并分支删除被拒绝。
4. 本地裸仓库 clone / Fetch / Push / fast-forward Pull；分叉 Pull 被拒绝且 HEAD 不变；non-fast-forward Push 被拒绝。
5. 合并冲突 base / ours / theirs、采用 ours、完成 merge；merge commit 文件和 first-parent Diff。
6. 手工解决、采用 theirs、abort 恢复合并前状态。
7. Modify/delete 冲突中采用删除一侧。
8. 非法路径、`.git`、选项注入、错误 payload 与无效仓库；失败时保留原仓库。
9. 慢 pre-commit hook 取消，返回及时且没有产生提交。
10. 慢 hook 超时，移除 hook 后可以正常重试提交。

取消实现的实际修复：最初 root Git 已退出但 MSYS pipe 句柄让 close 延迟到 20 秒。现在停止后在 exit 清理管道，正常成功命令仍等待 close 完整读取。最后取消测试约 1.76 秒，超时并重试约 3.60 秒。

## 真实桌面界面

使用 Playwright 控制实际 Electron 主进程和 renderer，核心操作全部通过按钮 / 表单完成。Git CLI 仅创建测试数据、模拟另一开发者并断言仓库结果，没有把 IPC 调用代替用户流程。

源码桌面版本 **3/3 通过**，约 1.2 分钟，renderer page errors 为零；[原始输出](verification-ui.txt)。

| 流程 | 实际步骤 |
|---|---|
| 提交闭环与分支 | 打开含中文 / 空格路径的仓库 → 选择文件读 Diff → 暂存 → 取消暂存 → 再暂存 → 提交 → 历史 / 文件 Diff → 创建并切换分支 → 切回 → 删除 |
| 克隆与远程 | 克隆本地裸仓库 → 设置本仓库身份 → 另一开发者推送 → Fetch / behind → Pull → 界面暂存和提交 → Push → 裸仓库 hash 与本地 HEAD 一致 |
| 冲突 | 分支页合并 → 显示 conflict / merge 状态 → 读取双方和 Base → 手工填写合并结果 → 保存并暂存 → 完成双父 merge commit |

打包目录版也对相同流程验证。前两轮首项在 Playwright `page.screenshot()` 的隐藏 Windows 窗口截图步骤超时，尚未到后续 Git 操作；remote 和 conflict 项已通过。原始记录分别保留为 [首轮](verification-packaged-ui.txt)、[最终二轮](verification-packaged-ui-final.txt)。这是测试截图路径的限制，不能把那两轮称为全量通过。

测试后改用 Electron 原生 `webContents.capturePage`，并在截图前 `showInactive`、等待两次渲染帧、截图后隐藏窗口，保证 Windows 合成的是当前页面。仅设置 `stayHidden` 曾抓到旧表面，已通过人工检查发现并改正；Git 功能断言不依赖截图。中间复查结果见 [packaged UI recheck](verification-packaged-ui-recheck.txt)，最新首项和真实截图复核 **PASS（12.7 秒）** 见 [最终截图与核心流程复查](verification-packaged-ui-rendered.txt)。与最终二轮的 remote（31.4 秒）及 conflict（24.6 秒）PASS 合计覆盖三项打包功能流程。核心业务操作没有变化。

人工查看了实际工作区和冲突截图，核对中文、Diff 行号、增删着色、提交区域、双方内容和结果编辑器。截图见 [工作区](screenshots/changes.png)、[历史](screenshots/history.png)、[分支](screenshots/branches.png)、[冲突](screenshots/conflict.png)。打开冲突编辑器时清除上一操作的过期错误，Git stderr 为空时从 stdout 显示实际冲突原因。

## 单文件便携版

直接启动实际 `HarborGit-1.0.0-Windows-x64.exe`，让 NSIS 自解压并运行内含应用，再通过专用 loopback CDP 连接核验：主页面标题 HarborGit、版本 1.0.0、Git preload 桥存在、renderer 没有 `require`。使用专用空 profile，没有打开仓库；正常退出并清理通过。[机器结果](verification-portable.json)。

Playwright 的 `_electron.launch` 不能直接把 NSIS bootstrap 当作 Electron 可执行程序：该尝试超时后改为 raw spawn launcher + CDP 连接到其解压后的真实窗口。此限制不影响双击启动，也没有被计为应用功能测试通过。

最终单文件 SHA-256：`7ed5dfeb4f7e03923e660b3579b91508cebc9648408409bde49251ddf6b9cbc3`。精确文件大小、ASAR 和源文件身份另见 `delivery-manifest.json`。

Electron 官方运行时 ZIP SHA-256：`55eaba17abff7b5bba6c3bbc85068967379024fe742fe9c7fdba9118922ccbe2`，与 Electron npm 包提供的 checksums 一致；其安装后 runtime 被 `electronDist` 复用到本次发行包。

## 未验证范围

没有真实 HTTPS / SSH 服务器凭据交互、GPG / pinentry、各类第三方 hooks、超大型仓库性能或复杂子模块 / rename 冲突测试。打包版本未签名。只验证本文列出的操作，IDEA 中的写操作并未执行；IDEA 的静态与界面研究证据另见 [调查报告](IDEA-ANALYSIS.md)。
