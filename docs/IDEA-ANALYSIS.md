# IntelliJ IDEA Git 功能调查与独立实现依据

调查日期：2026-10-29（Asia/Shanghai）。目标是本机实际安装的 **IntelliJ IDEA 2026.1.3 / IU-261.25134.95**。本报告依据安装包、已选择的 JVM 字节码、用户设置文件的结构及有限只读界面观察。没有把源码仓库资料、互联网上其他版本的描述或客户端自身实现当成 IDEA 的事实。

## 1. 目标与证据边界

| 项目 | 已确认位置 / 身份 |
|---|---|
| 安装根目录 | `D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3` |
| Windows 启动器 | `bin\idea64.exe`；`product-info.json` 声明 Windows amd64、最低 Java 21 |
| Git 后端主包 | `plugins\vcs-git\lib\vcs-git.jar`，14,989,928 bytes，SHA-256 `6dee7a6363454456b7b187c3c9682b01d78f62b50840b1f571b6d5afdf4e5be0` |
| 其他 Git 包 | `vcs-git-frontend.jar`、`git4idea-rt.jar`，以及 `lib\modules\intellij.vcs.git.*.jar` |
| 提交模态插件 | `plugins\vcs-git-commit-modal\lib\vcs-git-commit-modal.jar`，存在不等于当前正在启用 |
| GitHub / GitLab | 独立的 `plugins\vcs-github`、`plugins\vcs-gitlab`；本次未追踪其托管服务工作流 |
| 通用“打开”功能 | `lib\intellij.platform.ide.impl.jar` 中 `com.intellij.ide.actions.OpenFileAction`、`com.intellij.ide.impl.ProjectUtil` |
| 本地设置目录 | `C:\Users\Admin\AppData\Roaming\JetBrains\IntelliJIdea2026.1\options` |
| 缓存 / 日志目录 | `C:\Users\Admin\AppData\Local\JetBrains\IntelliJIdea2026.1`；仅定位，没有读取项目日志或凭据 |

身份清单见 [artifact-identities.json](evidence/artifact-identities.json)，版本摘要见 [product-identity.json](evidence/product-identity.json)。清单对本次涉及的 10 个包 / 元数据文件保留了路径、大小和 SHA-256。它不是整套 IDEA 的完整 SBOM。

**证据分级：**

- **已确认／静态**：安装包条目、XML 注册、选定 class 的反汇编调用和常量。能证明打包代码中存在的路径，不能证明用户本次运行一定走了该分支。
- **已确认／界面观察**：实际窗口中看见的入口和面板结构。不能证明 Git 子进程参数或写操作效果。
- **推断**：把多个已确认静态节点串成用户操作流程、解释其设计目的。各节单独标注。
- **未确认**：没有进程级 trace、没有在 IDEA 内执行写操作、没有覆盖全部动态分派和异常分支的内容。

## 2. REA 使用、格式限制及替代工具

已连接 REA 6.8.0，未改动 REA 配置、未安装其他分析引擎。对真实 `vcs-git.jar` 调用 `open_binary`，REA 按文件头识别为 ZIP archive；再调用 `inspect_artifact(detail: summary)`，得到完整中央目录范围内的 **2,910 个文件**，没有完整性矛盾。

| REA 记录 | Evidence ID |
|---|---|
| JAR inventory | `ev_b3436a50eea22fcaae9597c602b3ada48b0592bf729014c1efc1ffce19e530e3` |
| 保留的 inspect_artifact 父记录 | `ev_7a407b37dc36585d670d110ee04f45be222ae46639deff99c4c882c81e7f6350` |
| 派生 summary view | `ev_1cf0eb31355917cd4f31786a4188b1503b73e48cdd8aad3fd96d5dd0d2d7d518` |

完整 REA 证据见 [rea-evidence-bundle.json](evidence/rea-evidence-bundle.json)，小摘要见 [rea-inventory-summary.json](evidence/rea-inventory-summary.json)。REA 明确限定 ZIP inventory 为中央目录条目，不覆盖非条目字节，也不解释 JVM 语义。分析结束已 `export_evidence_bundle` 并 `close_binary`。

为查明 Java 支持边界，将选定 `git4idea/commands/GitImpl.class` 提取到工作区后调用 REA `open_binary`，返回 `unsupported_target / unsupported binary format / file_format_rejected`，不是把它当作 native PE、.NET 或 Android APK 继续猜测。当前 JEB/JADX provider 也缺失。详见 [rea-class-format-limitation.json](evidence/rea-class-format-limitation.json)。

因此用 **Python 标准库 zipfile** 读取 JAR 条目 / XML / properties，以本机 **JDK javap 21.0.11** 的 `-p -c` 查看选定 JVM 字节码，`-v -p` 查看存储注解。共保留 62 份反汇编，每份源 JAR、class 成员 SHA-256、输出 SHA-256 和参数见 [javap-provenance.json](evidence/javap-provenance.json)。这不是恢复的原 Java/Kotlin 源码。初期六个类名探测未找到，已依据真实成员表纠正，见 [javap-probe-corrections.json](evidence/javap-probe-corrections.json)。

## 3. 插件、资源与用户设置

插件注册资源为 [META-INF/plugin.xml](evidence/resources/backend/META-INF/plugin.xml)：

- L547–552 注册 Git VCS（行政目录 `.git`）、根检测器 `GitRootChecker` 和 `GitRepositoryCreator`。
- L562 注册 `GitLogProvider`；L585 注册 Git 设置面板；L595/602 注册应用设置及 Git executable manager。
- L318–345 注册启用 / 关闭 staging area、Add、Reset、接受双方、Merge、两版本和三版本 Diff 等动作。
- L647–660 注册 Commit 工具窗的 `Staging Area`、`GitStageTracker`、文档监听、Diff 扩展。
- L686 注册 `Git Conflicts` 变更工具窗内容。
- L797–798 声明项目设置 `GitVcsSettings` / `versionControl.git`。

资源内容的存在确认了可用入口和绑定类；仅凭注册不能确认当前功能已启用。打包成员清单见 [backend-members.txt](evidence/backend-members.txt)、[frontend-members.txt](evidence/frontend-members.txt)，界面字符串资源见前端包中的 [GitBundle.properties](evidence/resources/frontend/messages/GitBundle.properties)。

本地设置只保存**结构摘要**，[local-config-schema-only.json](evidence/local-config-schema-only.json) 不包含 remembered URLs、用户名或其他值。已定位 `vcs.xml`、`vcs-inputs.xml`、`advancedSettings.xml`；后者存在 `show.diff.as.editor.tab` 键。`GitVcsApplicationSettings` 存储注解确认为 `git.xml`（[反汇编](evidence/javap/git4idea.config.GitVcsApplicationSettings.verbose.txt)，L879–885），但选定 `options` 目录未发现该文件。文件缺席不能证明所有 Git 设置都取默认值，也不能推断实际 executable 路径；项目设置、远程开发设置和自动探测都可能另行影响结果。本次没有读取用户项目 `.idea`，没有读取密码库。

## 4. 实际界面观察

使用 computer-use 技能的 `@oai/sky` 进行有限只读观察，见 [runtime-observations.md](evidence/runtime-observations.md)。应用原本已经打开且最小化；激活后观察顶部当前分支控件及分支弹窗，然后以 Ctrl+K 打开提交面板。没有使用项目中的 Git 写操作。

**已确认／界面：** 分支弹窗含“更新项目”“提交”“推送”“新建分支”“签出标记或修订”，以及最近、本地、远程分组。提交面板含“更改”分组、选择复选框、提交消息、“提交”“提交并推送”。本机当时的项目面板**没有显示显式 Staged / Unstaged 分组**。因此当前 UI 是选择改动的提交路径；打包插件还提供可选 staging area，这是两项不同证据。

为避免读取用户改动配置文件内容，没有点击文件 Diff。最后恢复项目面板。没有把用户源码截图、仓库名称、URL、邮箱或配置内容作为交付素材。界面截图是现场观察证据，未做进程级 Git 命令捕获。

## 5. 完整操作链：打开与克隆

### 打开已有仓库

**已确认／静态：** `OpenFileAction.actionPerformed` 调 `FileChooser.chooseFiles`；其打开逻辑可调 `ProjectUtil.openExistingDir(... AS_PROJECT ...)`（[OpenFileAction](evidence/javap/com.intellij.ide.actions.OpenFileAction.txt)，L17–64、L209–233）。Git 插件注册根检测器后，`GitRootChecker.isRoot` 检查 `.git`；`GitRepositoryCreator` 调 `GitUtil.findGitDir` 再 `GitRepositoryImpl.createInstance`（[根检测](evidence/javap/git4idea.roots.GitRootChecker.txt)，L9–19；[仓库创建](evidence/javap/git4idea.repo.GitRepositoryCreator.txt)，L24–34）。仓库模型持有 reader、staging holder、untracked holder（[GitRepositoryImpl](evidence/javap/git4idea.repo.GitRepositoryImpl.txt)，L9–21、L60–99）。

**流程推断：** “打开目录 → 平台项目打开 / 根映射 → Git 仓库模型建立并刷新 → 分支控件和更改窗展示”。这里“打开”本身没有证据要求执行 `git clone` 或其他写命令；根识别和部分仓库状态直接读文件。通用打开分支很多，本次没有逐一执行所有项目导入器、无 Git 目录及 worktree 的 IDEA 打开分支。

### 克隆

**已确认／静态：** `plugin.xml` L152 注册 `Git.Clone → GitCloneAction`。该 action 使用 checkout provider；`GitCheckoutProvider` 创建 `GitCloneDialog`、`showAndGet`、`rememberSettings`，取得 source URL、父目录和目标名，再启动 clone（[checkout provider](evidence/javap/git4idea.checkout.GitCheckoutProvider.txt)，L33–82、L106–136）。`doClone` 调 `Git.clone`（同文件 L221）。`GitImpl.lambda$clone$0` 创建 `GitCommand.CLONE`，Windows 下加入 `core.longpaths=true` 配置，加入 `--progress`，按设置 / Git 版本可加递归子模块和 shallow depth（[GitImpl](evidence/javap/git4idea.commands.GitImpl.txt)，L3171 起）。

**流程推断：** “Clone 入口 → 对话框校验 / 记录输入 → 后台 clone handler → 成功后 checkout listener / VFS 刷新并交给平台打开流程，失败返回通知”。静态 clone 回调和 result 分支见 [GitCheckoutProvider$1](evidence/javap/git4idea.checkout.GitCheckoutProvider$1.txt)。没有对 IDEA 执行真实 clone；凭据弹窗、取消时的半成品目录处理未观察。

## 6. 工作区、暂存区、Diff、暂存和提交

### 状态获取与展示

**已确认／静态：** `GitIndexStatusUtilKt` 创建 `GitCommand.STATUS`，参数包含 `--porcelain`、`-z`，另按输入控制 ignored/untracked；调用 `Git.runCommand` 后 `parseGitStatusOutput`（[状态工具](evidence/javap/git4idea.index.GitIndexStatusUtilKt.txt)，L115–124、L232–247、L400 起）。记录保留 index/workTree 两字符及 path/origPath。`GitStagingAreaHolder` 调 `getStatus` 并发布 `stagingAreaChanged`（[holder](evidence/javap/git4idea.status.GitStagingAreaHolder.txt)，L286、L326）。`GitStageTracker` 读取 records，分别求 `getStagedStatus` 和 `getUnStagedStatus`（[tracker](evidence/javap/git4idea.index.GitStageTracker.txt)，L407–408、L578、L617）。

**流程推断：** “刷新 / 文件变化 → Git status → 解析 index/workTree → holder 发布变化 → tracker / panel 重建节点 → 文件分组、状态徽标与计数更新”。这解释同一文件为何可能同时出现在两个版本集合，不应按文件路径简单去重。XML 注册和 selected bytecode 支持该链，但没有对每个异步 listener 调用时序作运行 trace。

### 选中文件查看 Diff

**已确认／静态：** `ContentVersion` 包含 HEAD、STAGED、LOCAL（[枚举](evidence/javap/git4idea.index.ContentVersion.txt)，L3–7）。`GitStageDiffUtilKt` 构造两侧 / 三侧 request producer，分别加载 head、staged、local 内容，并使用 IntelliJ diff content / request API（[diff 工具](evidence/javap/git4idea.index.GitStageDiffUtilKt.txt)，L5、L86–155、L349 起）。未跟踪文件使用 `UnversionedDiffRequestProducer`。UI request processor 与 preview handler 存在（[processor](evidence/javap/git4idea.index.ui.GitStageDiffRequestProcessor.txt)）。

**流程推断：** “点击文件 / Show Diff → 根据节点类型确定版本对 → 取 HEAD/index/本地内容 → diff request / preview 展示”。本证据**不能**写成“IDEA 每次 Diff 都运行 `git diff`”：它已明确使用内容版本和通用 diff 引擎；具体内容加载可能另行读取 Git objects / index / VFS。

### 暂存与取消暂存

**已确认／静态：** `Git.Stage.Add → GitAddAction → GitAddOperation → GitFileUtils.addPaths`；相应 Reset action 进入 `GitResetOperation → GitFileUtils.resetPaths`（[Add action](evidence/javap/git4idea.index.actions.GitAddAction.txt)，L3–7；[Add operation](evidence/javap/git4idea.index.actions.GitAddOperation.txt)，L142；[Reset operation](evidence/javap/git4idea.index.actions.GitResetOperation.txt)，L137）。

`GitFileUtils.addPathsImpl` 创建 ADD handler，加入 `--ignore-errors -A`，可按参数加 `-f`，`endOptions` 后加入路径列表；resetPaths 则创建 RESET handler，`endOptions` 后加入分块路径（[GitFileUtils](evidence/javap/git4idea.util.GitFileUtils.txt)，L597–665、L758–816）。对这条已选择静态分支可概括为 `git add --ignore-errors -A -- <paths>` / `git reset -- <paths>`，不是用空格拼 shell 命令。

**流程推断：** “Add/Reset → index 更新（worktree 内容保留）→ index VFS / dirty paths 刷新 → 再取状态 → 文件移组，Diff 版本对随之改变”。错误由 `throwOnError` 返回而不是默认为成功。初始无 HEAD 的 IDEA reset 特殊处理未单独运行验证。

### 提交

**已确认／静态：** staging 路径 `GitStageCommitter.commit` 可先调用 `addPaths` 处理 toStage，再逐仓库调 `GitRepositoryCommitter.commitStaged`，并在结束路径 `refreshChanges` 标记 dirty roots；可选 push-after-commit（[staging committer](evidence/javap/git4idea.index.GitStageCommitter.txt)，L170–222、L263–324）。`commitStaged(String)` 经 `GitCheckinEnvironment.Companion.runWithMessageFile` 创建消息文件，`performCommit` 创建 COMMIT handler、设置消息和 options、运行、`throwOnError`；还设置 GPG / pinentry / empty commit problem detector（[repository committer](evidence/javap/git4idea.checkin.GitRepositoryCommitter.txt)，L51–82、L95–155）。消息文件和选项处理见 [committer helpers](evidence/javap/git4idea.checkin.GitRepositoryCommitterKt.txt)。

**流程推断：** “提交按钮 → 校验消息 / selected changes 或 staging commit state → 异步 commit → 失败保留可修正状态并报告原因；成功后刷新 roots / 历史并显示结果”。当前实际 UI 使用的是更改选择式界面，对该提交路径仅静态检查 `GitCheckinEnvironment`，不宣称其所有部分提交 / 临时索引分支均已完整还原。没有在 IDEA 内执行提交或 hooks。

## 7. 提交历史及每次提交的文件变更

**已确认／静态：** `GitLogProvider` 注册为 log provider；`readFirstBlock`、`readAllHashes`、`readFullDetails` 分别使用 `git4idea.history.GitLogUtil.collectMetadata / readTimedCommits / readFullDetailsForHashes`（[provider](evidence/javap/git4idea.log.GitLogProvider.txt)，L257–331、L826–936）。`GitLogUtil` 使用 LOG handler 和 parser，含 `--encoding=UTF-8`、pretty / decoration 参数，解析 hash、parents、时间、author、subject/body 等（[log 工具](evidence/javap/git4idea.history.GitLogUtil.txt)，L123–231、L779、L1052 起）。按提交读取完整详情不等于每次重读全部历史。

文件变更路径可看到 `--name-status` 与 `GitLogFullRecord.parseChanges`（[history 工具](evidence/javap/git4idea.history.GitHistoryUtils.txt)，L582、L624）。`GitLogDiffHandler` 接受文件路径和两个 hash，构建 `SimpleDiffRequest` 并交 `DiffManager.showDiff`，目录 / 多文件比较还通过 `GitChangeUtils.getDiff`（[log diff handler](evidence/javap/git4idea.log.GitLogDiffHandler.txt)，L25–75、L438–459、L501–537）。

**流程推断：** “Log 入口 → 后台读取和缓存 metadata → 提交列表 / 图和 refs → 选中提交后加载 full details / changes → 选中文件后按 revision pair 显示 Diff”。通用 VCS Log 的整个 Swing 表格 / 图布局不在本次反汇编范围；没有声称客户端实现了 IDEA 的所有图算法、索引或筛选器。

## 8. 分支创建、切换、删除

**已确认／界面：** 当前分支控件弹出带搜索、最近、本地、远程分组的菜单；创建、签出和推送入口可见。

**已确认／静态：** `GitBranchWorker` 先更新 repository 信息，再分派 `GitCreateBranchOperation`、`GitCheckoutOperation`、`GitDeleteBranchOperation.execute`（[worker](evidence/javap/git4idea.branch.GitBranchWorker.txt)，L45–126、L226–313）。创建 operation 调 `Git.branchCreate`，成功后 `repository.update` / notifySuccess；切换 operation 调 `Git.checkout`；删除 operation 调 `Git.branchDelete` 并检查结果（[create](evidence/javap/git4idea.branch.GitCreateBranchOperation.txt)，L74–115；[checkout](evidence/javap/git4idea.branch.GitCheckoutOperation.txt)，L196–209；[delete](evidence/javap/git4idea.branch.GitDeleteBranchOperation.txt)，L116–214）。

`GitImpl` 可确认 BRANCH / CHECKOUT command handler；delete 按 force boolean 选择 `-d` 或 `-D`（[GitImpl](evidence/javap/git4idea.commands.GitImpl.txt)，L672–790、L958–1018、L1019 起）。`GitRepositoryReader` 从 HEAD、refs 或 Git branch 输出建立当前分支 / revision；也区分 detached、merging、rebasing 等状态（[reader](evidence/javap/git4idea.repo.GitRepositoryReader.txt)，L31–119、L277–307、L389、L714）。

**流程推断：** “分支菜单动作 → operation 先检查当前状态 → 参数化 branch/checkout → 按 success/error 分支处理、刷新模型 → 当前分支和列表更新 / 通知”。dirty worktree 的完整 smart checkout / 回滚 / 多根处理未运行，不能把 IDEA 包含这些类等同于本客户端已复刻。

## 9. Fetch、Pull、Push 与冲突

### Fetch

**已确认／静态：** `Git.Fetch` 注册到 action。`GitFetcher` 调 `Git.fetch`，检查结果，显示成功 / 错误通知（[fetcher](evidence/javap/git4idea.update.GitFetcher.txt)，L304、L412–459）。`GitImpl.lambda$fetch$3` 构建 FETCH handler，设置 remote URLs / authentication gate，把 remote name 与参数作为列表加入；按版本加 `--progress` / `--prune`（[GitImpl](evidence/javap/git4idea.commands.GitImpl.txt)，L2946–3015）。

**流程推断：** “Fetch 入口 → 选择仓库和 remote → 后台 fetch、输出进度 → 更新 refs / incoming-outgoing 状态 → 结果通知”。未进行网络请求或认证验证。

### Pull

**已确认／静态：** `Git.Pull → GitPull`；其 handler 使用 PULL，加入 `--no-stat`、从 `GitPullOption` 取得的选项、`-v`、可选 `--progress`，最后 remote 与 branch（[GitPull](evidence/javap/git4idea.actions.GitPull.txt)，L233–313）。所以不能将 IDEA Pull 的所有模式简化成固定 `--ff-only`，也不能把“更新项目”视为与这个显式 Pull action 完全相同。

**流程推断：** “Pull 对话框收集 remote / branch / mode → Git pull → fetch + 集成改变状态 → 刷新改动 / Log / 通知；冲突转入解决流程”。本次没有追踪所有 update-project merge/rebase 策略和默认值。

### Push

**已确认／界面：** 推送入口及 Ctrl+Shift+K、提交并推送按钮存在。

**已确认／静态：** `GitPushOperation` 持有 source/target PushSpec；执行后聚合按仓库的 push 结果、刷新 repository。`GitImpl.lambda$doPush$2` 使用 PUSH handler，加入 `--progress`、`--porcelain`，还存在 force/lease 等独立选项分支（[operation](evidence/javap/git4idea.push.GitPushOperation.txt)，L143–384、L585 起；[GitImpl](evidence/javap/git4idea.commands.GitImpl.txt)，L3018–3170）。

**流程推断：** “推送入口 / Commit and Push → 目标与提交范围确认 → 后台 push → porcelain 输出归类（成功 / rejected 等）→ 通知和 refs 刷新”。没有实际触发 IDEA push，远程认证、被拒后自动更新的最终 UI 没有观察。

### 合并与基础冲突处理

**已确认／静态：** `Git.Merge` 注册；`GitBranchWorker` 可分派 `GitMergeOperation`，GitImpl 有 MERGE handler。`GitRepositoryReader` 用 merge head 文件等识别 MERGING。`GitMergeProvider.loadRevisions` 调 `GitMergeUtil.loadMergeData`，构建 ORIGINAL / CURRENT / LAST 三份内容（[provider](evidence/javap/git4idea.merge.GitMergeProvider.txt)，L136–158；[merge 工具](evidence/javap/git4idea.merge.GitMergeUtil.txt)，L105–302）。merge session 用 `ls-files --unmerged` 获取冲突记录（[session](evidence/javap/git4idea.merge.GitMergeProvider$MyMergeSession.txt)，L59–77），区分 AcceptedYours / AcceptedTheirs / Merged；解决后 `GitFileUtils.addFilesForce`（provider L165–179）。插件还注册 AcceptTheirs / AcceptYours / Merge / Abort 操作以及 Git Conflicts pane。

**流程推断：** “Merge/Pull 产生冲突 → 仓库变 MERGING 且 index 存多 stage → 冲突列表 → 基线 / 双方内容选择或编辑 → 标记已解决并暂存 → 无 unresolved 项后完成 merge commit；或 Abort”。在 rebase 中左右含义可能反转，bytecode 有 reverse-root 检查，不能一概把 ours 当成用户当前编辑内容。没有在用户仓库制造 / 解决冲突；二进制、rename/delete、多根冲突及完整 rebase session 未运行。

## 10. 命令执行与错误反馈的共通层

**已确认／静态：** `GitHandler` 使用 `GeneralCommandLine.withWorkingDirectory`、`withExePath`、`withCharset(UTF_8)`，以 `addParameter` / `addParameters` 加参数（[handler](evidence/javap/git4idea.commands.GitHandler.txt)，L149–189、L386–419）；`GitImplBase` 验证 executable，执行 line handler，收集 stdout/stderr 与 exit code，建立 `GitCommandResult`（[base](evidence/javap/git4idea.commands.GitImplBase.txt)，L113–209、L304–407）。许多 operation 通过 `success` / `throwOnError` 决定刷新、通知和后续动作。

**推断：** IDEA 将 UI action、后台任务、Git 命令模型、仓库状态缓存和展示解耦；结果返回后要刷新状态，不能只把按钮点击或子进程启动当成功。此结论来自多个 selected bytecode 节点；未恢复其完整执行调度器或取消协议。

## 11. 分析所得与 HarborGit 自行设计的分界

| 分析中获得的交互 / 状态依据 | HarborGit 自行编写的实现选择 |
|---|---|
| 操作入口与当前仓库 / 分支绑定；文件选择驱动 Diff；操作完成后刷新模型 | 独立的 Electron + React + TypeScript 窗口、布局、颜色、名称和组件 |
| index / worktree 是两个维度，HEAD / STAGED / LOCAL 是不同内容版本 | 显式工作区与暂存区分组；通过本机 Git CLI 解析状态与取得 Diff |
| 后台执行、进度 / 失败反馈、提交完成后刷新 Log | 由客户端自己的异步任务、IPC、命令运行器和日志实现 |
| 分支 operation 检查结果、仓库状态区分 merging / detached | 独立选择 CLI 参数、输入校验、操作约束和刷新策略 |
| 冲突使用 base/current/last 数据并在解决后更新 index | 客户端自己的基础冲突界面和解决方式，不复用 IDEA diff/merge 代码 |

客户端没有加载、链接或复制 IDEA 插件 class、图标或 UI 代码。此处列的是实现依据与设计边界；客户端最终已实现能力和验证结果以根目录 README、测试报告和源码为准，不能由 IDEA 的功能清单反向推定。

## 12. 原始问题复核与未确认清单

| 原始问题 | 静态证据 | 实际 UI / 执行覆盖 |
|---|---|---|
| 定位安装、插件、配置、资源 | 已回答（有路径、hash、REA inventory） | 当前进程窗口身份已观察 |
| 打开 / 克隆 | 选定 action→provider→handler 已回答 | 未在 IDEA 执行克隆；通用项目导入分支部分覆盖 |
| 工作区 / 暂存区 / 文件状态 | 状态双维度、解析和刷新已回答 | 当前非 staging 提交面板已观察；可选 staging 未切换 |
| Diff / 暂存 / 取消暂存 / 提交 | 选定 staging 路径完整静态链已回答 | 为保护用户改动，没有在 IDEA 做写操作或读配置 Diff |
| 历史 / 每次文件变更 | provider→log/parser→details→diff 已回答 | 通用 VCS Log 全 UI、缓存算法未运行核验 |
| 创建 / 切换 / 删除分支 | action/worker→operation→command/result 已回答 | 分支菜单已观察，写操作未执行 |
| Fetch / Pull / Push | handler、主要参数、result 路径已回答 | 远程认证与执行未观察 |
| 基础合并冲突 | merge state、unmerged index、三份内容、解决后 add 已回答 | 未运行 IDEA 合并；特殊冲突、rebase 语义部分未确认 |

整个调查的负面结论仅限选择的包、设置目录、类和界面，不声称反编译整套 IDEA 或穷尽其 Git 功能。IDEA 的运行期 Git 子进程轨迹、用户配置的最终 executable 路径、凭据管理器内部、所有 hooks / signing / SSH 交互、超大仓库性能、取消竞态和多根原子操作都保持**未确认**。这些未知不妨碍独立客户端在专用测试仓库和本地裸仓库中验证自己的行为，但两者证据不能混用。

## 13. 复核方法

在同版本本机上，可用 `javap -p -c -classpath "D:\Program Files\JetBrains\IntelliJ IDEA 2026.1.3\plugins\vcs-git\lib\vcs-git.jar" git4idea.commands.GitImpl` 复核字节码。通用 OpenFileAction 使用 `lib\intellij.platform.ide.impl.jar`。复核前按身份清单比较 SHA-256；IDEA 升级后不能直接沿用这些行号和调用结论。XML 的 `L` 标记和 javap 行号指本交付物中证据文本行，实际指令位置同时保留 JVM bytecode offset。REA Evidence ID 指向导出证据包中的同一记录；字节码输出属于外部工具证据，未伪装成 REA decompilation 结果。
