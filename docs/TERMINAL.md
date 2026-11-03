# HarborGit 1.8.0 内置终端

打开仓库后，点击左下角 **终端**，或按 **Ctrl + 反引号键**。终端停靠在项目下方，初始目录就是当前仓库，可直接输入 `git status`、`git log` 等命令。

- Windows 优先使用标准安装位置的 PowerShell 7；未安装时使用 Windows PowerShell。
- 每个项目各有一个终端。收起面板、切换项目或页面保留进程、当前目录、变量和输出；重新展开即可继续。
- 支持交互式命令、中文、颜色、上下键历史、Ctrl+C 中断，以及拖动面板上沿调整高度。
- **复制 / 粘贴** 按钮及 Ctrl+Shift+C / Ctrl+Shift+V；**清屏** 清理显示，**结束终端** 停止会话，结束后可重新启动。
- 关闭项目或退出应用会结束对应终端。安装应用更新前，先点击“结束终端”。

终端内操作不触发 Git 界面的自动刷新。修改完成后点击右上角刷新按钮；**焦点在终端时，Ctrl+R 等按键交给 Shell**，不触发仓库快捷键。按 Ctrl + 反引号键 可以收起终端。

PowerShell 使用 `-NoProfile`，不会执行个人启动脚本；输入输出使用 UTF-8。命令历史保留在本次 PowerShell 会话中，不写入 PSReadLine 历史文件。HarborGit 不把终端内容保存到操作日志或发送给 AI；终端输出与 Git 操作日志是两个独立面板。

## 实现与打包

使用 [node-pty 1.1.0](https://github.com/microsoft/node-pty) 创建 Windows ConPTY 会话，使用 [xterm.js 6.0.0 与 FitAddon](https://xtermjs.org/docs/guides/using-addons/) 渲染和适配尺寸。终端代码为自行实现，未复用 IDEA 代码。

主进程根据已有仓库会话确定初始目录，不接受界面传入任意工作路径或启动程序。IPC 验证发送窗口、项目和终端标识；输入、尺寸、剪贴板及输出队列有大小限制。输出使用分批发送与解析确认，避免长时间输出无限堆积。

入口见 [App.tsx](../src/renderer/App.tsx)，界面见 [ProjectTerminal.tsx](../src/renderer/ProjectTerminal.tsx)，原生会话管理见 [terminal.ts](../src/main/terminal.ts)。原生模块只在首次打开终端时加载，终端界面也单独分包。

打包时 `node-pty` 保持为外部模块，其文件通过 `asarUnpack` 放到实际磁盘目录，供原生模块和辅助进程使用。Windows / macOS 包使用该依赖携带的预编译模块，`npmRebuild: false` 避免不必要的本机构建。安装目标依旧为 Windows x64；macOS 终端未在本次验证。

## 运行与有限验证

```powershell
npm ci
npm start
npm run dist:setup
```

按本次要求，只进行类型 / 生产构建检查和终端专项运行检查，不执行完整 Git 回归或安装卸载验证。

专项检查通过 `scripts/smoke-terminal.mjs` 运行，使用独立用户配置和专用中文空格目录仓库，验证真实输入、中文、初始目录、Git 调用、项目会话保留、Ctrl+C 及进程清理。复现：

```powershell
# 默认从源码启动，也可设置 HARBOR_EXECUTABLE 指向打包目录内的 exe
npm run test:terminal
```

当前每个项目仅一个终端，尚无 Shell 选择界面、项目内多终端标签或重启应用后的会话恢复。终端完整继承当前用户的正常命令执行能力；界面的 Git 操作保护规则不拦截手动输入的 Shell 命令。
