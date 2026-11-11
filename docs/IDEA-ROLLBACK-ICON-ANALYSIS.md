# IDEA 回滚图标的静态证据（2026-11-11）

本轮使用 reverse-engineer-anything 技能和 REA 的 JAR 库存分析，配合 Python zipfile 读取 SVG/XML、已有 JDK 21 的 javap 查看 JVM 指令。只读取本机 IDEA 2026.1.3，没有启动或操作 IDEA 中的仓库。

## 已确认事实

- `lib/intellij.platform.vcs.impl.jar!/META-INF/VcsActions.xml` 原行 131–132：`ChangesView.Revert` 绑定 `com.intellij.openapi.vcs.changes.actions.RollbackAction`，图标为 `AllIcons.Actions.Rollback`。见 [XML 原文选段](evidence/rollback-icons-2026-11-11/action-icon-bindings.json)。
- `lib/intellij.platform.util.ui.jar!/com/intellij/icons/AllIcons$Actions.class` 的 static 初始化，在 javap +2467…+2480 处将 `expui/vcs/revert.svg`、`actions/rollback.svg` 交给 `AllIcons.load` 并赋给 `Rollback`。见 [AllIcons 反汇编](evidence/rollback-icons-2026-11-11/AllIcons-Actions.txt)。
- `lib/intellij.platform.ide.jar` 包含 `expui/vcs/revert.svg`、`expui/vcs/revert_dark.svg`，均为 16×16 左向回折箭头，分别使用 `#6C707E`、`#CED0D6`。这两份原始 SVG 保留在 [亮色资源](evidence/rollback-icons-2026-11-11/revert.svg) 和 [暗色资源](evidence/rollback-icons-2026-11-11/revert_dark.svg)。HarborGit 直接使用其未修改副本。
- 对应 SVG 声明 Apache-2.0，保留版权原文；完整许可和来源说明随应用 `assets/licenses` 一同分发。图标的许可不改写为 MIT。
- [RollbackAction 反汇编](evidence/rollback-icons-2026-11-11/RollbackAction.txt) 的 update 检查可回滚文件，并存在选中项 / 勾选模式判断。这只能证明静态逻辑，不代表本轮观察了实际 UI 操作。

## REA 证据与格式边界

IDE 图标 JAR SHA-256：`720656f47aab69ac6954350eee0abee841a0d26daa9049efc455cc3c96fd6e37`。其他 JAR、member、输出和执行参数的哈希见 [provenance.json](evidence/rollback-icons-2026-11-11/provenance.json)。

[完整 REA bundle](evidence/rollback-icons-2026-11-11/rea-evidence-bundle.json) 包含库存与两次精确选择：

- 库存 `ev_f1559adc10226f81a5f180e303db9a2e87654d4ddb2afc33ae7ab58845bb83f4`。
- 经典图标选择 `ev_646efa1d7d3f8f6e7c4f515327b4e3b9d70e8a6b1787d0161dbefc4644fae2a3`。
- 新界面图标选择 `ev_8c01b9131cce7aece4b28c44430f150eed617e0ecafe144459b419dc2e293973`，精确命中 2/2。结束时已关闭 REA target。

REA 在本轮用于 ZIP/JAR 成员库存，不能据此推导 Java 方法语义。既有 [JVM class 格式限制](evidence/rea-class-format-limitation.json) 仍适用，没有重复失败探测；Java 部分改用 javap，SVG/XML 改用 zipfile 和文本读取。反汇编不是原始 Java 源码。

## 推断与未确认内容

两套路径分别对应新界面和经典图标，是依据 `expui` 命名、双资源加载参数和资源内容作出的解释。本轮未运行 IDEA，因此没有确认用户当前 IDEA 的界面模式、实时悬浮配色或其他版本的资源映射。HarborGit 使用已确认的新界面 SVG，亮暗切换由自身 CSS 决定。

## HarborGit 自行设计与实现

分组勾选、筛选变化清空勾选、独立选择撤销范围、全选的半选状态、失效选择清理均为自行编写。后端沿用已存在的多文件 `git restore`、参数数组与 NUL 路径输入，以及执行前的 HEAD、路径和未跟踪内容保护；没有复制 IDEA 的 Git 实现代码。
