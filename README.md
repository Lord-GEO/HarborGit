# HarborGit 1.2.1

可独立运行的 Windows x64 Git 图形客户端。Electron + React + TypeScript，实际仓库操作交给本机 Git CLI。界面、代码和产品设计独立编写；IDEA 的插件只用于研究交互与状态模型，没有作为客户端依赖。

本次新增 Windows Setup 安装版和 HarborGit 自有图标，支持选择安装目录、创建快捷方式及标准卸载。详见 [1.2.1 更新说明](docs/RELEASE-1.2.1.md)。彩色提交图、AI 提交消息、多项目、明暗主题和智能合并功能继续保留，功能说明见 [1.2 更新说明](docs/RELEASE-1.2.md)。

## 安装与运行

本次交付已包含打包结果：

- 安装版：`release/HarborGit-1.2.1-Setup-x64.exe`，双击后按向导安装。默认安装到当前用户，可选择目录，创建桌面和开始菜单快捷方式。
- 目录版：`release/win-unpacked/HarborGit.exe`；复制时保留整个 `win-unpacked` 目录。

安装前关闭正在运行的 HarborGit；原便携版无需卸载。安装完成后可从快捷方式启动；在 Windows“设置 → 应用”中卸载。卸载保留 `%APPDATA%/HarborGit` 内的设置、最近仓库记录和加密 AI 配置，也不会删除项目仓库。升级继续使用原配置。

打包版自带 Electron，无需 Node.js、npm 或 IDEA。需要 **Git for Windows 在 PATH 中**（本机已验证 Git 2.50.1）；客户端不会安装 Git。该构建未进行代码签名。需要便携版时可使用下方命令自行打包；之前版本的便携 EXE 仍为历史产物。

![HarborGit 图标](assets/harborgit-128.png)

## 从源码启动与打包

在本目录执行，建议 Node.js 22.12+；本次使用 Node 26.13.0、npm 11.20.0。版本由 `package-lock.json` 锁定。

```powershell
npm ci
npm start          # 类型检查、构建并启动桌面应用
npm run dev       # Vite 热更新界面；主进程修改后需重启
npm run build     # 类型检查及生产构建
npm test          # 真实 Git 后端集成测试
npm run test:ui   # 真实 Electron 界面端到端测试（先 build）
npm run test:portable # 运行实际单文件便携版的启动检查（先 dist:portable）
npm run pack      # release/win-unpacked
npm run dist      # Windows x64 Setup 安装版，同 dist:setup
npm run dist:setup # release/HarborGit-1.2.1-Setup-x64.exe
npm run dist:portable # 可选：Windows x64 单文件便携版
npm run icons     # 从 assets/harborgit.svg 重新生成 PNG 与 Windows ICO
```

安装依赖会下载 Electron 运行时，首次打包会下载 NSIS 等打包工具，需要网络。如果网络环境导致运行时下载失败，可在网络可达环境重新运行 `node node_modules/electron/install.js`。最初构建时的 Electron 下载替代方案与校验过程保留在历史验证报告。

## 已实现的操作

| 功能 | 操作与行为 |
|---|---|
| 多项目与主题 | 多个项目同时打开、标签页切换与关闭、相同仓库重复打开时定位已有标签；每个项目独立保留 Diff、导航、提交消息和日志；全局明暗主题并记住选择 |
| 打开与克隆 | 选择根目录或仓库内子目录；支持 HTTPS、SSH 和本地路径克隆；克隆到新目录或空目录，完成后打开；最近仓库快捷入口 |
| 文件状态 | 显式区分工作区与暂存区；修改、未跟踪、新增、删除、重命名和冲突；同一文件可同时出现在两组；显示分支、上游和 ahead/behind |
| Diff | 点击文件查看统一差异和行号；工作区与 index 比较，index 与 HEAD 比较；未跟踪文件按新增显示；二进制提示；初始提交和合并提交的历史 Diff |
| 暂存与提交 | 单文件或全部暂存 / 取消暂存；保留工作区内容；支持首次提交；多行消息；本仓库提交身份设置；空消息、空暂存区、未解决冲突会阻止提交 |
| 历史与提交图 | 默认全部本地/远程分支、标签及当前 HEAD，按拓扑排序；可筛选当前分支；分支颜色、真实父提交连线、双圈合并节点与分页路径延续；选择提交查看文件和 Diff，merge 与第一父提交比较 |
| AI 提交消息 | 在 AI 设置中配置 Responses 或 Chat Completions 兼容接口、基础地址、模型与 Key；按固定暂存快照生成候选，预览应用后可编辑；暂存区变化检测、取消和超时；Key 由系统加密保存在主进程 |
| 分支 | 本地 / 远程分组；创建并切换；切换已有分支；从远程分支创建；安全删除已合并本地分支；合并本地 / 远程分支到当前 |
| 智能合并 | 在 dev 上选择“将当前分支合并到…”→master；在独立 worktree 合并已提交内容，dev 的暂存/未暂存/未跟踪文件原样保留；有冲突时新标签解决，完成或中止后可结束合并工作区 |
| 远程 | 选择已有 remote；Fetch 并 prune；Pull 固定 `--ff-only`；Push 当前 HEAD 到明确的目标分支并设置 upstream；Git 拒绝非快进 push，客户端不强推 |
| 冲突 | 读取 index 的 base / ours / theirs；展示双方与可编辑结果；查看共同祖先；完整采用一侧或手工保存并暂存；支持 modify/delete 中采用删除一侧；检查后提交完成合并；可中止合并 |
| 执行反馈 | 异步操作、命令 / stderr / exit code 日志、耗时任务进度、取消和超时；命令失败保留消息并刷新真实状态；窗口重新聚焦或手动刷新可读取外部改动 |

最短使用流程：打开仓库 → 左侧工作区选文件看 Diff → 点击文件旁 `+` 暂存 → 检查暂存区 Diff → 填写提交消息 → 提交 → 提交历史选中提交查看文件。

`Ctrl+O` 打开仓库，`Ctrl+R` 刷新。远程凭据使用本机 Git 已有的 credential helper / SSH 配置；没有内置网页登录和密码录入。终端交互提示被禁用，缺失凭据会返回 Git 的失败信息。

Pull 遇到分叉会保留仓库状态并报告错误：先 Fetch，在分支页将相应远程分支合并到当前，解决冲突后提交，再 Push。冲突中的“当前分支 / 传入分支”针对普通 merge；客户端没有 rebase 流程。

## 实现与边界

主进程通过 `spawn(executable, args, { shell: false })` 调用 Git。文件参数使用相对路径、`--literal-pathspecs` 和选项分隔；批量暂存 / 取消暂存通过 NUL 分隔的 stdin pathspec 文件传入，避免 Windows 命令行长度限制。状态、历史、文件列表用 NUL 分隔解析，支持中文、空格、`-` 前缀和通配符外观文件名。每个项目有独立 GitService 和串行任务队列；请求与进度显式绑定标签会话，不会因切换标签改变目标仓库。操作后重新读取状态；取消独立于队列。

Renderer 无 Node 权限，启用 context isolation 与 sandbox，通过有限 preload API 和主进程请求白名单访问 Git；IPC 核验窗口和 main frame。没有任意 shell 命令执行接口。手工冲突编辑只允许仓库内普通文件，拒绝 `.git`、路径逃逸、符号链接 / junction 目录和残留冲突标记。

文本 Diff / 冲突预览上限 2 MiB；界面最多展示 10,000 行 Diff 并提示截断。手工保存二进制或截断内容被禁用，采用一侧直接交给 Git 保留原始字节。普通命令默认 3 分钟、克隆 / 远程 10 分钟超时，可取消。取消与超时会停止 Git 进程树并返回失败；已完成的 Git 状态变化不会自动回滚，以刷新后的状态为准。

详细调用与状态设计见 [IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。

## 分析所得与自行设计

[IDEA-ANALYSIS.md](docs/IDEA-ANALYSIS.md) 提供本机 IDEA 安装、插件、配置和打包资源位置，以及入口 → 状态 → 内部调用 / 命令 → 展示的证据链。逐项区分已确认静态事实、现场界面观察、流程推断和未确认内容，并链接 REA Evidence ID、文件 SHA-256、XML 及 JVM 字节码位置。

REA 可清点 JAR，但不支持该 JVM `.class` 格式；报告保留原始拒绝结果，之后使用 Python zipfile 与 JDK javap 继续。IDEA 只做了有限只读 UI 观察，没有执行用户仓库的提交、分支、合并或远程写操作。

借鉴的依据是 index / worktree 双维状态、文件选择驱动 Diff、后台执行与结果后刷新、base / 双方冲突内容。HarborGit 的布局、组件、命令协议、任务队列、Pull 策略、历史分页、冲突编辑器均为自行设计。IDEA 的 Diff 证据涉及通用内容版本引擎，不能称其每次都调用 `git diff`；HarborGit 自主采用 Git CLI 的 diff。

## 验证与尚未实现

1.2.1 的 [安装验证](docs/verification-v1.2.1-installer.json)、[已安装程序界面测试](docs/verification-v1.2.1-installed-ui.txt)、[EXE 图标核验](docs/verification-v1.2.1-icons.json)均通过。为保护正在使用的便携版，安装测试采用独立的 QA 安装身份，应用载荷与交付版本一致；完整范围与限制见 [1.2.1 更新说明](docs/RELEASE-1.2.1.md)。

1.2 的实测范围和原始输出见 [更新验证](docs/RELEASE-1.2.md)、[后端结果](docs/verification-v1.2-backend-final.txt)、[发行包界面结果](docs/verification-v1.2-packaged-ui.txt)。1.0 历史验证保留在 [VERIFICATION.md](docs/VERIFICATION.md)。所有写入测试使用工作区内新建的专用仓库，远程仅使用本地裸仓库；未使用用户真实仓库或互联网远程进行写验证。

当前未实现：按行 / hunk 部分暂存、rebase / cherry-pick / stash、标签管理、跨分支全文搜索、远程地址管理界面、子模块专用界面、Git LFS 专用操作、内置凭据登录、签名配置界面、自动更新、完整的 rename/rename / 子模块冲突编辑。复杂冲突可以在外部解决后通过 Git CLI 暂存；普通文件的二进制冲突可完整采用一侧。

未做真实 HTTPS / SSH 服务端认证验证、大型仓库性能基准、所有外部 hooks / 签名工具兼容测试。这里只声称报告中实际验证的范围。IDEA 的功能研究与本客户端的测试结果是两套证据。

AI 首次使用：顶部“AI 设置”填写协议、基础地址（通常含 /v1）、模型 ID 和 Key，再暂存文件，点击“AI 生成”。只有点击生成才会发送暂存文件清单和文本差异；未暂存内容不发送。候选不会自动覆盖已有草稿，也不会自动提交。测试仅连接本地 HTTP fixture，真实服务的认证、可用模型及生成质量需在自行配置后确认。

![彩色提交图与合并路径](docs/screenshots/v1.2-graph-dark.png)
