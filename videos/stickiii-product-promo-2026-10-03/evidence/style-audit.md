# 原设计审计

色板取自 src/renderer/styles.css:1–133：paper surface #fff、chrome #fbfbfa、ink #2d322f、body #626761、accent #d8f278；sage surface #f3f7e9、accent #c8df86；lavender surface #f8f4fc；原 ink 暗色主题可用。

原产品字体为 Inter / 系统 sans / PingFang SC / Microsoft YaHei。成片中文采用本机系统 PingFang SC，英文标题 Avenir Next；不打包商业或系统字体文件，字体加载和画面截图另行验证。复现环境需提供对应系统字体或有授权的 CJK sans 替代。

窗口圆角 14px；titlebar 39px；note-page padding 17px 20px 8px；正文 13px / 1.75。产品 CSS 从原文件完整复制，去除未使用的 Tailwind 指令（源 JSX 无 Tailwind utility 依赖）。镜头只适配高度和作用域并等比放大。

品牌使用 public/desk-tabs-logo.png 完整正式图标，不截取符号；项目代码与品牌源在 Apache-2.0 仓库中，保留 LICENSE、NOTICE。repo 风格：纸白、柔和主题、轻阴影、便签叠页。无默认 fallback 的 BSL 资产。
