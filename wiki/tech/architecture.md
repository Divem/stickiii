# 整体架构与同步边界

> 产品需求见：[快速记录产品需求](../prd/quick-capture-notes-prd.md)

## 1. 运行形态

Desk Tabs 使用 Electron 桌面应用承载一个 React 界面。Electron 主进程常驻，负责注册全局快捷键并管理一个约 440×390 的无边框置顶便签窗口。窗口第一次唤起时出现在当前鼠标附近，之后保留用户拖动后的位置；窗口关闭按钮执行隐藏，应用本身继续运行，直到用户使用系统退出命令。

## 2. 进程边界

```text
┌───────────────────────────────────────────┐
│ Electron main                              │
│  BrowserWindow · globalShortcut · storage  │
│  file dialog · attachment copy · sync IPC  │
└─────────────────┬─────────────────────────┘
                  │ minimal contextBridge
┌─────────────────▼─────────────────────────┐
│ React renderer                             │
│  note list · editor · attachment UI        │
│  no Node.js · no arbitrary IPC              │
└───────────────────────────────────────────┘
```

- `src/main.ts` 保存 `notes.json`，附件复制到 Electron `userData/attachments/`；窗口使用 `alwaysOnTop` 和 `setVisibleOnAllWorkspaces` 保持辅助窗口属性。
- `src/preload.ts` 只暴露记录、附件、同步和窗口控制方法。
- `src/shared/types.ts` 是 Note / Attachment / SyncResult 的唯一共享契约。
- `src/platform/sync/` 用 `NoteSyncAdapter` 隔离 Notion、飞书的认证和 API 差异。

## 3. 数据策略

当前使用单一本地 JSON 文件，适合初始化和低频个人记录。写入时覆盖完整快照，并以 `updatedAt` 排序。附件内容复制到应用数据目录，图片小于 3 MB 时额外存为 data URL 用于即时预览。

当记录数量、附件体积或同步队列增长后，再迁移到 SQLite / IndexedDB。迁移前需要补充 schema、备份和失败恢复设计，不在初始化阶段引入不必要的存储复杂度。

## 4. 同步契约

同步调用必须返回三种可区分结果：

- `not-configured`：连接器存在，但用户还没有完成授权或配置。
- `synced`：第三方已确认写入，可选返回远端 URL。
- `error`：请求失败，返回用户可理解的错误信息，并保留本地记录。

当前 Notion / 飞书 adapter 只返回 `not-configured`。真正接入时，需要独立实现：

1. 认证信息的安全存储；
2. Note 到远端页面 / 文档块的映射；
3. 附件上传和远端链接回填；
4. 幂等键、重试和冲突策略。

## 5. 构建与版本

Vite 只构建 renderer，TypeScript NodeNext 编译 main / preload。`npm run build` 调用两段构建并输出 `dist/renderer`、`dist/main.js`、`dist/preload.js`。版本号以 `package.json` 为唯一来源；打包、签名和自动更新属于后续发布工作。
