# AGENTS.md

Desk Tabs 是 Electron + React 的桌面随手记。用户通过全局快捷键从任意窗口唤起一个可拖动、可缩放的记录窗口。

## 架构边界

- `src/main.ts` — Electron 主进程：窗口生命周期、全局快捷键、本地文件存储、IPC 和系统文件对话框。
- `src/preload.ts` — 唯一的渲染层安全桥。渲染层禁止直接引用 Electron、Node.js 或文件系统 API。
- `src/renderer/` — React UI。用户可见文案统一放在 `i18n.ts`，支持中英文切换。
- `src/shared/` — 主进程与渲染层共享的数据类型，不放运行时副作用。
- `src/platform/sync/` — 外部同步连接器。连接器未配置时必须返回明确状态，不能伪造同步成功。

## 安全红线

- `contextIsolation` 必须保持开启，`nodeIntegration` 必须保持关闭。
- preload 只暴露按功能命名的最小方法，不暴露 `ipcRenderer`、`fs` 或任意命令执行能力。
- 外部文件复制到应用数据目录后才进入记录附件；渲染层不接收任意路径来读文件。
- Notion / 飞书等外部写入需要真实认证和用户触发，不能在本地按钮上假报成功。

## 开发与验证

```bash
npm install
npm run dev
npm run typecheck
npm run test:contracts
npm run build
```

当前 `npm run build` 只生成 Electron 的 renderer 和 main 产物，不自动递增版本号。版本号唯一来源仍是 `package.json`；正式发布时另行增加安装包、签名和版本记录。

## 文档

新功能需要同步更新 `wiki/prd/`、`wiki/tech/` 或 `wiki/handover/`。文件名使用 kebab-case，产品能力描述区分“当前可用”“接口已预留”和“尚未实现”。

## 提交

使用 Conventional Commits + 中文，例如：

```text
feat: 增加全局唤起随手记窗口
fix: 修复附件保存后的预览状态
docs: 补充 Notion 同步设计
```
