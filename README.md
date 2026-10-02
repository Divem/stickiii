# Desk Tabs

Desk Tabs 是一个从任意窗口快速打开的桌面随手记。它把每条记录做成一个可切换的标签，支持文字、图片和文件附件；记录先保存到本机，之后可以通过同步连接器发送到 Notion、飞书等外部文档服务。

## 当前状态

当前版本是可运行的产品骨架，已经包含：

- `Command/Ctrl + Shift + Space` 全局唤起快捷键
- 默认约 440×390 的悬浮便签窗口，始终置顶并可拖动、缩放、最小化、关闭
- 当前便签直接进入输入状态；其他便签、删除、设置和同步入口在悬停工具栏或弹出菜单中
- 文字记录和本地自动保存
- 极简无边框视觉，以及白色、雾灰、鼠尾草绿、天空蓝、暖杏、淡紫和夜墨主题
- 图片与文件附件选择、图片预览、文件打开
- Notion / 飞书同步连接器的接口和未配置状态
- Electron 主进程、preload 安全桥、React 渲染层的分层

同步服务的 OAuth、远端文档映射和冲突处理属于下一阶段，目前不会伪装成已经接通。

## 开发

```bash
npm install
npm run dev
npm run typecheck
npm run test:contracts
npm run build
```

开发时按 `Command/Ctrl + Shift + Space` 打开置顶便签窗口。窗口关闭按钮会隐藏窗口，应用仍可通过快捷键重新唤起；使用系统的退出命令才能退出应用。

## 项目结构

```text
desktop-tabs/
├── src/
│   ├── main.ts              # Electron 主进程、窗口、快捷键、IPC
│   ├── preload.ts           # 最小化安全桥
│   ├── shared/              # 主进程与渲染层共享的数据契约
│   ├── renderer/            # React 界面与本地交互
│   └── platform/sync/       # Notion / 飞书等同步连接器边界
├── scripts/                 # 构建与契约测试
├── wiki/
│   ├── prd/                 # 产品需求
│   ├── tech/                # 技术设计
│   └── handover/            # 交接与验证记录
└── package.json
```

## 文档

- [产品需求](wiki/prd/quick-capture-notes-prd.md)
- [技术设计](wiki/tech/architecture.md)
- [初始化交接](wiki/handover/initialization.md)
- [文档索引](wiki/README.md)

## 提交约定

使用 Conventional Commits，并用中文描述，例如 `feat: 增加全局唤起随手记窗口`。
