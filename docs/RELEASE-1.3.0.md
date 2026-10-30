# HarborGit v1.3.0 — 软件更新

新增“软件更新”入口。Windows Setup 安装版支持后台或手动检查 GitHub 正式版、查看说明、下载进度、取消重试及确认安装，普通退出不会自动安装。Git 和 AI 任务运行时阻止安装。现有仓库文件及应用配置保留。

旧版需要先手动安装本版本。便携版、目录版及当前未签名 macOS 版使用发布页下载更新。发布下一版本时需要将 Setup、blockmap 与 `latest.yml` 一同上传；GitHub Actions 已补齐附件及校验。

- [使用、发布与验证指南](UPDATES.md)
- 构建：`npm run dist:setup`
- 更新附件核验：`npm run verify:updates`
- 本次 Setup SHA-256：`321cb5beb278944ba13c225c0a3359a2485503b073f9d9fba695f1ce6353b373`

本次未推送或发布 GitHub Release，尚未进行真实线上覆盖升级验证。下载、校验、UI、安装入口与安装/卸载分别在隔离环境验证，详细边界见指南。
