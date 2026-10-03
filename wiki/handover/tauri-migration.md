# Tauri 迁移与部署交接

## 当前实现

贴贴便签的桌面底座改为 Tauri 2 + Rust，保留现有 React 便签界面、Markdown、主题、透明度、附件、四个全局快捷键和飞书 API 同步。Notion 仍为未实现接口；内嵌飞书网页登录编辑仍尚未实现，旧 Electron 技术方案须重新评估。

中文品牌名为「贴贴便签」，英文品牌名为「Stickiii」，替代原英文名 Desk Tabs。应用按界面语言显示对应名称，README、页面标题与 npm 展示名使用「Stickiii · 贴贴便签」。安装包继续使用中文名：macOS 打包生成 `贴贴便签.app` 与 `贴贴便签_<版本>_<架构>.dmg`，DMG 宗卷为「贴贴便签」。内部包名 `desk-tabs`、应用标识 `com.dawinyuan.desktabs`、凭据服务名与偏好设置键保持不变，继续读取原有便签、附件、快捷键和凭据。下方验收记录与 `tauri-validation.json` 保留当时产物的原始证据。

不再安装或打包 Electron、Electron Packager、Node.js 运行环境。飞书连接器复用原有版本检查、章节归属、未知写入恢复和幂等逻辑；Rust 负责认证和实际传输，真实密钥与访问令牌不返回前端。

## 开发和验证

```bash
npm install
npm run dev
npm run typecheck
npm run test:contracts
npm run check:native
npm run test:native
npm run build
npm run package:mac
```

需要 Node.js 22、Rust 稳定版和对应平台的 Tauri 构建依赖。版本来自 package.json，不因构建递增。macOS 默认只构建当前主机架构；Windows 安装包优先在 Windows 构建。scripts/fixtures/legacy-config-store.ts 仅供旧凭据契约测试，不会进入生产应用。

## 旧版数据

首次启动会在新目录没有 notes.json 时，复制 Electron desk-tabs/ 中的便签、被引用的附件与快捷键。旧目录保持完整；同步文档 ID、章节 ID、内容摘要和恢复检查点随记录保留，避免重建远端文档。读取失败、数据损坏或附件路径异常时不会用空快照覆盖旧记录。

新的 macOS 目录为 ~/Library/Application Support/com.dawinyuan.desktabs/；Windows 使用 Tauri app_data_dir（通常为 %APPDATA%/com.dawinyuan.desktabs/）。旧 Electron 目录通常为对应系统应用数据目录下的 desk-tabs/。

Electron safeStorage 的 sync-config.bin 不自动解密迁入。用户需要在设置中重新填写原 App ID、Secret、同步模式和目标，沿用原 App ID 才能复用既有映射。新配置保存在 macOS Keychain / Windows Credential Manager；系统存储锁定或不可用时返回明确失败。

## 2026-10-03 品牌改名验证

- 类型检查、44 项 TypeScript 契约与桥接测试、11 项 Rust 测试全部通过。
- `npm run package:mac` 生成 `贴贴便签.app` 与 `贴贴便签_0.1.0_aarch64.dmg`，DMG 校验和通过。
- 应用包的 `CFBundleName`、`CFBundleDisplayName` 与前端页面标题均为「贴贴便签」；应用标识仍为 `com.dawinyuan.desktabs`，版本仍为 `0.1.0`。
- 本次验证覆盖构建与打包；Windows 安装和原生窗口实际显示未在本次重新验收。

## Windows 企业内网

| 构建命令 | WebView2 安装行为 | 现场是否需要联网 |
| --- | --- | --- |
| npm run package:win | 缺少时下载 Bootstrapper 并安装运行环境 | 缺少运行环境时需要 |
| npm run package:win:managed | 安装器不处理 WebView2，由 IT 提前安装 | 不需要 |
| npm run package:win:offline | 安装包内包含完整离线安装器 | 不需要 |

managed 适合企业统一部署：在外网电脑从 [微软官方下载页](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download) 下载 Evergreen Standalone Installer，选择内网电脑的 x64 / ARM64 / x86 架构，再通过企业允许的渠道传入并安装。Bootstrapper 仍依赖联网，不适合隔离内网。

WebView2 安装一次可供多个应用共享。managed 包的小体积不包含单独部署的运行环境；offline 包的体积包含运行环境，两者不可混报。长期隔离网络的电脑由 IT 另行分发运行环境更新。

配置参考：[Tauri Windows 安装器](https://v2.tauri.app/distribute/windows-installer/)、[微软离线部署](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#offline-deployment)。

## 2026-10-03 验收记录

- 类型检查通过；44 项 TypeScript 契约与桥接测试、11 项 Rust 测试全部通过。
- 使用隔离数据目录与独立 QA 应用标识，实际运行 WKWebView，验证 React 输入自动保存、Markdown 预览、置顶、记录增删、附件路径限制及未配置同步状态。QA 输入与结果可从落盘 JSON 恢复，测试不会修改真实便签或凭据。
- npm run package:mac 完整通过。最终 arm64 应用包 5,534,401 字节（5.53 MB / 5.28 MiB）；DMG 为 3,715,801 字节（3.72 MB / 3.54 MiB）。原 Electron 应用约 342 MB，安装后体积减少约 98%。
- DMG 校验和通过，已只读挂载并比较可执行文件、Info.plist 和图标，均与构建产物逐字节相同；Applications 链接正确。
- 生产二进制不包含 QA 环境变量入口或测试脚本，package.json 与 lockfile 中不再依赖 Electron 运行环境。
- Tauri 默认 DMG 流程曾因临时宗卷占用而卸载失败。现改为先构建 .app，再使用 hdiutil 从临时目录直接生成并验证 DMG，不挂载构建临时宗卷，不操作 Finder。

体积与 SHA-256 见 [验证数据](tauri-validation.json)。本次产物来自当前工作区，应用版本仍为 0.1.0，未作为签名、公证的正式发布。

复现隔离开发运行检查（macOS）：

```bash
DESK_TABS_DEV_DATA_DIR="$(mktemp -d)" DESK_TABS_DEV_SMOKE=1 npm run dev -- --no-watch --config '{"identifier":"com.dawinyuan.desktabs.qa","productName":"贴贴便签 QA"}'
```

测试结果保存在隔离目录的 notes.json 中，记录 ID 为 desktop-smoke-result；仅 debug 构建允许该模式。

Windows 实机、真实飞书租户写入、签名、公证和自动更新未完成。Windows 包体积需在 Windows 构建后单独实测；macOS 的运行检查不能代表 Windows 已验收。Notion 与内嵌飞书网页编辑均仍尚未实现。
