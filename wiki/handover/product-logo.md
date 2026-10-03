# 产品 Logo 与应用图标

Stickiii（贴贴便签）使用挥手的立体便签小公仔：浅绿便签身体、翻角和叠页、大眼睛、微笑、腮红、小手和小脚，配合深绿圆角底板与勾选徽章，表达随手记录。窗口中的标记固定为 24×24 像素，保持各便签主题中的产品识别。中文界面显示「贴贴便签」，英文界面显示「Stickiii」；图标资源路径沿用现有名称。

## 当前可用

| 位置 | 资源与接入 |
| --- | --- |
| 窗口顶部 | `public/desk-tabs-logo.png`，256×256；Vite 复制到 `dist/renderer/`，使用相对路径加载 |
| 页面图标 | `public/desk-tabs-favicon.png`，64×64；使用相对路径加载 |
| Dock、macOS 应用包图标 | `src-tauri/icons/icon.icns`；由 `tauri.conf.json` 的 `bundle.icon` 声明，打包时嵌入应用包 |
| Windows 应用包图标 | `src-tauri/icons/icon.ico`；由同一原稿导出，真实 Windows 安装包显示待 Windows 环境验收 |
| 原生窗口 PNG、尺寸变体 | `src-tauri/icons/`；`32x32.png`、`128x128.png` 等由 Tauri 图标工具导出 |

唯一设计原稿是 `assets/branding/desk-tabs-mascot.png`，1254×1254 RGBA，由内置 imagegen 生成。四周保留真实透明边距；脚本保留原稿透明通道，导出 1024×1024 Dock PNG、窗口标记、页面图标与 `.icns`。`.icns` 包含 16、32、128、256、512 像素及对应双倍像素表示，最大为 1024 像素。

旧扁平版 SVG 存档在 `wiki/handover/assets/desk-tabs-logo-flat-v1.svg`，不参与当前运行。完整生成提示词见 [公仔 Logo 生成记录](assets/desk-tabs-mascot-prompt.md)。

## 更新方式

替换 `assets/branding/desk-tabs-mascot.png` 后，在 macOS 执行：

```bash
npm run icons
npm run typecheck
npm run test:contracts
npm run package:mac
```

`npm run icons` 使用 Tauri CLI 从原稿导出原生图标、窗口标记和页面图标。脚本使用临时目录导出 64、256、1024 像素 PNG，复制到对应目录后清理。`assets/branding/desk-tabs-icon.png` 与 `desk-tabs.icns` 保留作为通用导出交付文件；当前应用直接使用 `src-tauri/icons/` 的资源。

当前 Tauri 应用产物：`src-tauri/target/release/bundle/macos/贴贴便签.app`。应用图标变更需要重新启动应用才会生效。

## 2026-10-03 公仔版验证（改名前）

- `npm run icons`、`npm run typecheck`、`npm run test:contracts` 与 `npm run package:mac` 通过，40 项契约测试全部通过。
- Tauri 生成 `Desk Tabs.app` 与 `Desk Tabs_0.1.0_aarch64.dmg`；应用包 `Info.plist` 的 `CFBundleIconFile` 指向 `icon.icns`，包内图标 SHA-256 与 `src-tauri/icons/icon.icns` 完全一致。
- `dist/renderer/` 中的窗口 Logo、页面图标与 `public/` 对应资源逐字节一致。
- 用 ego-browser 打开静态构建页，确认窗口 Logo 成功解码，原始尺寸 256×256、显示尺寸 24×24，左上角 alpha 为 0。检查 [浅色主题](assets/desk-tabs-mascot-paper.png) 与 [夜墨主题](assets/desk-tabs-mascot-ink.png)，确认图标无裁切、无额外矩形背景。
- 本次视觉检查基于静态构建页；原生窗口及安装后 Dock 显示未作为本次验收结果。

## 2026-10-03 旧扁平版验证记录

- `npm run icons`、`npm run typecheck`、`npm run package:mac` 通过；当前 40 项契约测试全部通过。
- 新应用包 `Info.plist` 的 `CFBundleIconFile` 指向 `Resources/electron.icns`，文件内容与源 `.icns` 完全一致。
- `app.asar` 中的 SVG 和 PNG 与对应构建文件完全一致。
- 使用独立临时数据目录运行打包后的主进程入口与 preload，确认 `file://` 页面中的 SVG 解码成功、尺寸为 20×20；截图检查浅色和夜墨主题显示正常。
- 同一运行验证中加载本地 Vite 开发页，确认 Logo 也正常加载；主进程 Dock 设置调用使用包内 PNG，Electron 能读取非空图像。

技术参考：[Electron Dock](https://www.electronjs.org/docs/latest/api/dock)、[Electron Packager 图标选项](https://electron.github.io/packager/main/interfaces/Options.html#icon)。
