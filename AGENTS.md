# AGENTS.md

贴贴便签是 Tauri 2 + Rust + React 的桌面随手记，面向 macOS 与 Windows。用户通过全局快捷键从任意窗口唤起一个可拖动、可缩放的记录窗口。

## 架构边界

- `src-tauri/src/lib.rs` — 桌面进程：窗口生命周期、全局快捷键、具名命令与来源校验。
- `src-tauri/src/storage.rs` — 原子文件存储、附件复制与 Electron 旧数据迁移。
- `src-tauri/src/credentials.rs` / `sync.rs` — 系统凭据存储、飞书认证与受限文档传输。
- `src/renderer/desktop.ts` — 唯一的前端桌面桥。渲染层禁止直接引用 Node.js、文件系统或任意 HTTP / shell 插件。
- `src/renderer/` — React UI。用户可见文案统一放在 `i18n.ts`，支持中英文切换。
- `src/shared/` — 主进程与渲染层共享的数据类型，不放运行时副作用。
- `src/platform/sync/` — 外部同步连接器。连接器未配置时必须返回明确状态，不能伪造同步成功。

## 安全红线

- 本地 `main` 窗口负责便签库及全局管理；Rust 创建并登记的 `note-*` 独立窗口仅可调用绑定便签的有限命令。原生层必须校验窗口、便签、附件及同步任务归属，不能仅凭窗口名前缀授权；capability 不授予远程来源、通用文件、HTTP 或 shell 权限。
- 桌面桥只暴露按功能命名的最小方法，不暴露原始 invoke、文件系统或任意命令执行能力；渲染层无 Node.js 运行环境。
- App Secret 和访问令牌留在 Rust 进程；macOS 使用 Keychain，Windows 使用 Credential Manager。
- 外部文件复制到应用数据目录后才进入记录附件；渲染层不接收任意路径来读文件。
- Notion / 飞书等外部写入需要真实认证和用户触发，不能在本地按钮上假报成功。

## 开发与验证

```bash
npm install
npm run dev
npm run typecheck
npm run test:contracts
npm run check:native
npm run test:native
npm run build
```

`npm run build` 构建 React 与 Rust 二进制，不生成安装包，也不自动递增版本号。Tauri 配置从 `package.json` 读取应用版本；正式发布时另行签名、公证和记录版本。`package:mac` 生成 `.app` / DMG；Windows 构建和运行验收需在 Windows 完成。内网部署使用单独安装 WebView2 的 managed 模式，或携带运行环境的 offline 模式，不能将二者的体积混报。

## 文档

新功能需要同步更新 `wiki/prd/`、`wiki/tech/` 或 `wiki/handover/`。文件名使用 kebab-case，产品能力描述区分“当前可用”“接口已预留”和“尚未实现”。

## 提交

使用 Conventional Commits + 中文，例如：

```text
feat: 增加全局唤起随手记窗口
fix: 修复附件保存后的预览状态
docs: 补充 Notion 同步设计
```
