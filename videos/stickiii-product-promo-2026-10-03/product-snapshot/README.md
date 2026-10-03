# Stickiii · 贴贴便签

<p align="center">
  <img src="public/desk-tabs-logo.png" alt="Stickiii · 贴贴便签 Logo" width="128" />
</p>

<p align="center">从任意窗口唤起的本地优先桌面随手记。</p>

**Stickiii**（中文名：贴贴便签）是一款基于 **Tauri 2 + Rust + React** 的桌面记录工具。按下快捷键即可打开一张可拖动、可缩放的便签，把文字、Markdown、图片或文件先收在本机，再按需整理到飞书文档。

它适合记录临时想法、会议片段、待办和需要稍后整理的资料。每条记录都是一个可切换的标签，窗口保持轻量，不要求先打开一个完整的知识库应用。

> **项目状态：0.1.0 预发布**
>
> 当前代码可以运行，macOS arm64 已完成构建与隔离运行检查。Windows 安装与真实飞书租户写入仍需在目标环境单独验收。本项目采用 [Apache License 2.0](LICENSE)。

## 能做什么

### 当前可用

- `Command/Ctrl + Shift + Space` 从任意窗口唤起或隐藏便签。
- 为唤起 / 隐藏、新建、上一条和下一条记录配置全局快捷键。
- 在默认约 `440 × 390` 的无边框窗口中编辑、拖动、缩放、最小化和隐藏。
- 每条便签可独立打开为窗口，多条便签同时显示；独立置顶，关闭前保存，正常退出后恢复仍打开的窗口。独立打开期间主窗口提供内容预览和定位入口。
- 使用 Markdown 编辑 / 预览，支持 GFM 标题、列表、待办、表格、引用、代码块、链接和网络图片；首行自动作为记录标题。
- 本地自动保存；记录、附件和快捷键写入应用数据目录，保存采用临时文件、`fsync` 和原子替换。
- 选择图片或文件作为附件。图片可以预览，文件交给系统打开；附件复制到应用数据目录后才会被记录引用。
- 截图/图片可直接粘贴到便签，文件可拖入正文；支持主窗口与独立窗口、编辑与预览模式。一次最多 20 个，单个不超过 20 MB，部分失败保留成功附件；普通文字粘贴不变。
- 每条便签独立使用白色、雾灰、鼠尾草绿、天空蓝、暖杏、淡紫或夜墨主题；全局背景透明度可在 40%–100% 间调整，并支持中英文界面。
- 飞书手动同步：为每条便签创建独立文档，或追加为指定文档中的独立章节；重复同步会更新原位置，并在检测到远端修改时要求确认。
- 首次启动或本地笔记库为空时会预置两条产品介绍便签，包含使用方法和联系邮箱 `imyuanwen@gmail.com`；它们可以像普通便签一样编辑或删除，重新安装后即使应用数据目录被保留也会恢复显示。
- Notion 远端写入尚未接入，当前不显示同步按钮和配置入口；已有配置仍保留。
- 首次启动可迁移旧 Electron 版本的便签、附件和快捷键；旧版加密 Secret 需要重新填写。

### 尚未实现

- 自动同步、双向同步、跨设备同步和云端历史记录。
- Notion 远端写入、OAuth 用户授权和多维表格同步。
- 在应用内直接打开并编辑飞书网页标签；当前同步完成后通过系统浏览器打开文档。
- 图片或文件附件上传到飞书；同步时 Markdown 图片保留为链接，文件附件保留在本地。
- 应用内截图工具、OCR、文件夹拖入、异常终止后的草稿恢复、签名、公证和自动更新。
- Linux 支持，以及未经目标系统验证的 Windows 发布包。

能力状态的详细说明见 [产品需求](wiki/prd/quick-capture-notes-prd.md) 和 [飞书与 Markdown 使用及验收](wiki/handover/feishu-markdown.md)。

## 快速开始

### 运行开发版

需要：

- Node.js 22 或更高版本
- Rust stable（当前 crate 要求 Rust `1.85` 或更高版本）
- 对应平台的 [Tauri 2 构建依赖](https://v2.tauri.app/start/prerequisites/)
  - macOS：Xcode Command Line Tools
  - Windows：Visual Studio C++ Build Tools 和 WebView2

```bash
git clone <仓库地址>
cd desktop-tabs
npm install
npm run dev
```

开发窗口启动后，按 `Command/Ctrl + Shift + Space` 唤起主窗口。主窗口右上角关闭动作表示隐藏，独立便签窗口的关闭动作表示保存后关闭该窗口，便签仍保留。要退出应用，请从主窗口“更多”菜单选择退出，或使用系统退出命令；所有窗口保存成功后才退出。

### 本地验证

```bash
npm run typecheck       # TypeScript 类型检查
npm run test:contracts  # 前端、同步和桌面桥契约测试
npm run check:native    # Rust 编译检查
npm run test:native     # Rust 单元测试
npm run build           # 生产构建，不生成安装包
```

这些检查使用模拟的同步接口，不会向真实飞书租户写入数据。真实飞书验收需要使用测试应用、测试文档和测试账号，步骤见 [飞书与 Markdown 使用及验收](wiki/handover/feishu-markdown.md)。

## 构建安装包

`npm run build` 只生成前端资源和 Rust 发布二进制，不递增版本号，也不生成安装包。

### macOS

```bash
npm run package:mac
```

产物位于 `src-tauri/target/release/bundle/macos/` 和 `src-tauri/target/release/bundle/dmg/`。构建架构随当前 Mac 主机决定。当前配置要求 macOS 11.0 或更高版本；签名与公证尚未配置。

修改 Logo 后，在 macOS 上执行 `npm run icons`，再重新运行打包命令。

### Windows

```bash
npm run package:win          # 缺少 WebView2 时联网下载
npm run package:win:managed  # IT 预先安装 WebView2，安装器不处理运行环境
npm run package:win:offline  # 安装包携带 WebView2 离线安装器
```

安装程序位于 `src-tauri/target/release/bundle/nsis/`。`managed` 包体积较小但要求现场已有 WebView2；`offline` 包不要求现场联网，但会明显增大。三种包的体积和 Windows 实际运行结果需要在 Windows 主机上分别记录，不能用 macOS 构建代替验收。部署背景见 [Tauri 迁移、数据与 Windows 内网部署](wiki/handover/tauri-migration.md)。

## 配置飞书同步

飞书连接器使用企业自建应用的 App ID 和 App Secret，通过 Rust 进程调用飞书 API。首次配置的大致步骤是：

1. 在飞书开放平台创建并发布企业自建应用。
2. 为应用申请新版文档读写、Markdown/HTML 内容转换，以及按模式需要的协作者权限，并完成管理员审批。
3. 在贴贴便签的“设置 → 飞书”中填写 App ID 和 App Secret。
4. 选择“每条笔记创建新文档”，填写协作者邮箱；或选择“追加到同一篇文档”，粘贴 `docx` / `wiki` 文档链接并确保应用对目标文档有编辑权限。
5. 编写一条测试便签，点击底部“飞书”按钮，确认返回链接、内容和权限，再开始使用真实记录。

Secret 保存在 macOS Keychain 或 Windows Credential Manager；访问令牌只存在 Rust 进程内，不会传给 React 渲染层。同步失败、冲突、权限不足和结果不确定时不会伪造“已同步”，本地记录仍会保留。

同步边界、权限清单、冲突处理和真实租户验收步骤见 [飞书与 Markdown 使用及验收](wiki/handover/feishu-markdown.md)。

## 数据与隐私

默认情况下，便签内容和附件只写入本机。应用不会因为启动而初始化云端同步；只有用户配置飞书并主动点击同步时，当前便签的文字和 Markdown 才会发送到飞书。

| 数据 | 保存位置 / 行为 |
| --- | --- |
| 便签内容 | 应用数据目录的 `notes.json` |
| 附件 | 应用数据目录的 `attachments/`；导入时复制，不读取任意外部路径 |
| 快捷键 | 应用数据目录的 `shortcuts.json` |
| App Secret | macOS Keychain / Windows Credential Manager |
| 飞书访问令牌 | 仅在 Rust 进程内存中短暂使用，不返回给前端 |
| 界面语言与透明度 | WebView 的本地偏好 |

常见数据目录：

- macOS：`~/Library/Application Support/com.dawinyuan.desktabs/`
- Windows：`%APPDATA%/com.dawinyuan.desktabs/`

请勿把 `notes.json`、附件目录、日志或任何凭据提交到公开仓库。删除应用前如需保留记录，请先备份应用数据目录；当前项目还没有图形化导出和损坏数据修复入口。

安全边界由 Rust 进程、受限 `desktop.ts` 桌面桥和 React 渲染层共同维护：渲染层没有 Node.js、通用文件系统、通用 HTTP 或 shell 能力；桌面命令只接受本地可信的 `main` 窗口；飞书传输也不是通用网络代理。详细设计见 [整体架构与同步边界](wiki/tech/architecture.md)。

## 项目结构

```text
desktop-tabs/
├── src/
│   ├── shared/              # Note、附件、Markdown 和同步结果等共享契约
│   ├── renderer/            # React 界面、编辑器和受限 desktop.ts 桥
│   └── platform/sync/       # 飞书实现与 Notion 连接器边界
├── src-tauri/
│   ├── src/lib.rs           # 窗口、快捷键、命令和来源校验
│   ├── src/storage.rs       # 原子 JSON 存储、附件复制和旧数据迁移
│   ├── src/credentials.rs   # 系统凭据存储
│   ├── src/sync.rs          # 受限飞书认证和文档传输
│   └── capabilities/        # Tauri 权限清单
├── scripts/                 # 契约测试、图标生成和 macOS 打包脚本
├── wiki/                    # 产品、技术和交接文档
└── package.json
```

## 参与贡献

欢迎提交 Issue、文档修正和代码改进。提交前请：

1. 先搜索已有 Issue；涉及行为变化的改动先说明使用场景和能力边界。
2. 保持 `src/renderer/desktop.ts` 为前端唯一桌面桥，不在渲染层直接引入 Node.js、文件系统、HTTP 或 shell。
3. 涉及新功能时同步更新 `wiki/prd/`、`wiki/tech/` 或 `wiki/handover/`，并区分“当前可用”“接口已预留”和“尚未实现”。
4. 运行 `npm run typecheck`、`npm run test:contracts`、`npm run check:native`、`npm run test:native` 和 `npm run build`；涉及平台行为时注明实际验收平台。
5. 不要在 Issue、日志、测试夹具或提交中放入 App Secret、访问令牌、私人文档链接或真实便签内容。

提交信息使用 Conventional Commits，并用中文描述，例如：

```text
feat: 增加全局唤起随手记窗口
fix: 修复附件保存后的预览状态
docs: 补充飞书同步设计
```

## 文档入口

- [产品需求：快速记录](wiki/prd/quick-capture-notes-prd.md)
- [产品设计：飞书文档标签（尚未实现）](wiki/prd/feishu-document-tabs-prd.md)
- [技术设计：整体架构与同步边界](wiki/tech/architecture.md)
- [交接：飞书与 Markdown 使用及验收](wiki/handover/feishu-markdown.md)
- [交接：Tauri 迁移、数据与 Windows 内网部署](wiki/handover/tauri-migration.md)
- [交接：产品 Logo 与应用图标](wiki/handover/product-logo.md)
- [更新日志](CHANGELOG.md)
- [完整文档索引](wiki/README.md)

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。允许个人使用、企业内部使用和商业用途；在遵守许可证条款的前提下，可以修改、再分发及出售原软件或衍生版本，商业化无需另行取得作者许可。

再分发时须附带许可证、保留相关版权及 [NOTICE](NOTICE) 声明，并在修改的文件中注明变更。第三方依赖仍遵循各自的许可证。
