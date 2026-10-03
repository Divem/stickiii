# AGENTS.md

> **贴贴便签（Stickiii）**：从任意窗口唤起的本地优先桌面随手记。技术栈是 Tauri 2、Rust、React 和 TypeScript，面向 macOS 与 Windows。

本文件是所有 AI agent 的共享规则入口。规则分为稳定的工作原则和随项目演进的项目约束；README、Wiki 和源码是事实依据，遇到冲突先核对当前实现。

## 我们要解决什么

这个项目同时跨越 React 渲染层、Tauri 桌面桥和 Rust 原生层。最容易出现的错误是：

- 按旧代码或猜测补充命令、权限和文档位置；
- 为了方便把文件系统、网络或凭据能力放进渲染层；
- 改了一个边界却漏改 capability、桌面桥、类型或测试；
- 只确认编译通过，没有验证窗口归属、同步结果和失败状态。

下面的原则用于避免这些错误；项目红线描述违反后必须返工的具体约束。

## 工作原则

| 原则 | 解决的问题 |
|:---|:---|
| **编码前思考** | 错误假设、隐藏歧义和未经说明的权衡 |
| **简洁优先** | 过度抽象、无用 fallback 和任务外功能 |
| **精准修改** | 越界编辑、顺手重构和无关格式化 |
| **目标驱动** | 没有完成判据、只凭感觉报告完成 |

### 1. 编码前思考

- 先读相关源码、配置和测试；不确定时列出假设并询问，不默默补需求。
- 看到文档与实现不一致，先说明差异，再以当前源码和实际命令为准。

**检验标准：** 完成后，用户不会需要追问“你为什么没有先确认 X”。

### 2. 简洁优先

- 不增加任务之外的功能、配置或抽象；重复三次后再考虑抽象。
- Rust 使用 `Option`、TypeScript 使用 `null`/`undefined` 表示缺失，不用空字符串或 `-1` 伪造值。
- 只在用户输入、外部 API 和文件边界做必要校验，不为不可能的内部状态堆兜底。

**检验标准：** 资深工程师 review 时，不会认为实现明显过度设计。

### 3. 精准修改

- 不顺手改相邻代码、注释、空白或正常工作的结构；重构另开任务。
- 只清理本次改动产生的 unused 内容；已有死代码先标注，不自行删除。

**检验标准：** `git diff` 中每一行都能解释其与当前任务的关系。

### 4. 目标驱动

- 把“修 bug”“加校验”“优化 UI”改写成复现步骤、测试断言或明确的界面验收条件。
- 多步骤任务先写“步骤 → 验证”，完成后按验证结果报告边界。

**检验标准：** 动手前能用一句话描述完成后的可观察行为。

## 项目红线（违反必须返工）

1. **原生权限与窗口归属**：修改 `src-tauri/src/lib.rs`、`src-tauri/src/note_windows.rs`、`src-tauri/capabilities/` 或新增原生命令时，必须同时检查命令注册、`main`/`note-*` capability、窗口来源和便签/附件/同步任务归属，并运行 `npm run check:native` 与相关测试。不能只凭窗口名前缀授权。
2. **桌面桥边界**：渲染层的 Tauri 调用只能经过 `src/renderer/desktop.ts`。禁止在其他渲染文件直接引入 `invoke`、Node.js、文件系统、通用 HTTP 或 shell 插件；违反时必须移回受限桌面桥。
3. **凭据和附件安全**：App Secret 与访问令牌留在 Rust；macOS 使用 Keychain，Windows 使用 Credential Manager。外部文件必须先复制到应用数据目录，渲染层不能接收任意路径来读文件；不得提交凭据、真实便签、私人文档链接或构建产物。
4. **同步结果必须诚实**：Notion/飞书写入必须由用户主动触发并使用真实认证。未配置、权限不足、冲突、超时或结果不确定时，必须返回明确失败/待确认状态，不能显示“已同步”。
5. **用户文案不硬编码**：用户可见的句子、按钮、提示和错误文案走 `src/renderer/i18n.ts` 并保持中英文键一致。品牌字形、provider 标识和日期格式化等固定显示常量可以保留在组件中，但不能借此绕过翻译。
6. **不主动执行外部写入**：未经用户明确指示，不执行 `git commit`、`git push`、`git tag`、发布、部署或真实飞书写入；不修改与任务无关的工作区改动。

## 架构边界与 Gotchas

- `src-tauri/src/lib.rs` 负责窗口生命周期、全局快捷键、具名命令注册和来源校验；新命令要在这里注册，不能只添加 Rust 函数。
- `src-tauri/src/storage.rs` 负责原子文件存储、附件复制和 Electron 旧数据迁移；附件路径必须经过应用数据目录约束。
- `src-tauri/src/credentials.rs` 与 `src-tauri/src/sync.rs` 负责系统凭据、飞书认证和受限文档传输；渲染层只能拿到脱敏状态和同步结果。
- `src/renderer/desktop.ts` 是唯一的前端桌面桥；其余 `src/renderer/` 文件只通过按功能命名的方法访问原生能力。
- `src/shared/` 只放主进程和渲染层共享的数据类型与纯逻辑，不放运行时副作用；`src/platform/sync/` 负责外部连接器边界。
- `note-*` 窗口由 Rust 登记并绑定到单条便签。命令必须经过 `note_windows::guard` 和对应的 note/attachment/session 归属校验；`note.json` 的窗口匹配不能替代运行时绑定校验。
- 飞书同步按 `sync_begin` → `sync_checkpoint` → `sync_finish` 管理任务状态；`feishu_request` 只能使用已登记任务和窗口，不是通用网络代理。
- `trusted_url` 只允许 `tauri://localhost` 和无端口的 `http/https://tauri.localhost`；debug 额外允许 `http://127.0.0.1:5173`，不得放宽为任意远程来源。
- `npm run build` 使用 `tauri build --no-bundle`，只构建前端和 Rust 二进制；安装包由平台专用脚本生成，不能把二者的体积或验收混报。

## 命令速查

```bash
npm install                         # 安装依赖
npm run dev                         # 启动 Tauri 开发环境
npm run dev:renderer                # 只启动 Vite 渲染层
npm run typecheck                   # TypeScript 类型检查
npm run test:contracts              # 前端、桌面桥和同步契约测试
npm run check:native                # Rust cargo check
npm run test:native                 # Rust 单元测试
npm run test:window-smoke           # 独立窗口 QA；会构建并启动隔离测试应用
npm run build                       # React + Rust 构建，不生成安装包
npm run package:mac                 # macOS .app 与 DMG，仅 macOS
npm run package:win                 # Windows NSIS，联网下载 WebView2
npm run package:win:managed         # Windows NSIS，现场预装 WebView2
npm run package:win:offline         # Windows NSIS，携带 WebView2 离线安装器
```

项目没有独立 lint 脚本；不要臆测执行 `npm run lint`。Windows 安装包和运行验收必须在 Windows 完成，macOS 打包需要 macOS。`npm run build` 不自动递增版本号，也不替代签名、公证或真实租户验收。

## 提交前自检

- [ ] `npm run typecheck` 通过。
- [ ] `npm run test:contracts` 通过（改动前端、桥接、Markdown 或同步逻辑时）。
- [ ] `npm run check:native` 通过（改动 Rust、命令、capability 或存储时）。
- [ ] `npm run test:native` 通过（改动 Rust 行为、凭据、窗口或存储时）。
- [ ] `npm run test:window-smoke` 通过（改动独立窗口生命周期或布局时）。
- [ ] `npm run build` 通过（准备发布或改动 Tauri 构建配置时）。
- [ ] 新增/修改用户文案已检查 `src/renderer/i18n.ts` 的中英文键。
- [ ] 新功能已更新对应的 `wiki/prd/`、`wiki/tech/` 或 `wiki/handover/` 文档，并更新 `wiki/README.md` 索引。
- [ ] `git diff` 每一处都属于当前任务；未覆盖其他未提交改动。
- [ ] 没有新增密钥、访问令牌、真实文档链接、便签内容或构建产物。

## 文档要求

- `wiki/` 是项目产品、技术和交接文档的主目录：PRD 放 `wiki/prd/`，技术设计放 `wiki/tech/`，完成后的模块说明放 `wiki/handover/`。
- 新功能文档必须区分“当前可用”“接口已预留”和“尚未实现”；文件名使用小写 kebab-case。
- 新增、移动或归档 Wiki 文档后更新 `wiki/README.md`，不要只创建孤立文件。
- `docs/` 是显式调用 docs-organizer 时使用的辅助结构，不与 `wiki/` 镜像产品文档；除非用户明确要求，否则不把同一篇产品文档复制到两处。

## 提交规范

使用 Conventional Commits + 中文，例如：

```text
feat: 增加全局唤起随手记窗口
fix: 修复附件保存后的预览状态
docs: 补充飞书同步设计
```

提交正文说明改了什么、为什么改、影响范围；bug 修复补充根因。未经用户明确指示，不提交或推送。

## 关键参考

- `README.md` — 当前能力、平台构建和真实验收边界。
- `wiki/README.md` — 产品、技术和交接文档索引。
- `wiki/tech/architecture.md` — 原生边界、同步边界和安全设计。
- `wiki/handover/feishu-markdown.md` — 飞书 Markdown 同步使用与验收。
- `src-tauri/capabilities/main.json`、`src-tauri/capabilities/note.json` — 窗口 capability 清单。
- `docs/docs-guide.md` — 仅在显式使用 docs-organizer 时参考的辅助目录规范。
