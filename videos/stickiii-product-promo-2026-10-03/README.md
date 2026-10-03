# Stickiii · 贴贴便签 宣传片

50 秒，1920 × 1080，16:9，30 fps，中文说明，repo 风格，无旁白，原创配乐与独立动作音效。

成片：`renders/stickiii-product-promo-1080p.mp4`。分镜：`DIRECTION.md`。时间和声音的唯一数据源：`plan.json`。

## 内容

灵感纸片 → 快捷唤起 / 记录 → Markdown 预览 → 三张独立便签 / 置顶 → 七种主题 → AI 操作菜单 → 飞书两种同步配置 → 品牌。

功能源于当前 v0.1.0 预发布工作树。完整原 React App、NoteEditor、NoteBook 和 MarkdownPreview 已接入；`product-snapshot/` 保存制作开始时的原源码快照，未改写内部 DOM，保留其 Apache-2.0 LICENSE / NOTICE。桌面桥仅在视频工程内替换为离线内存 fixture。真实 OS 快捷键、原生多窗口 / 置顶、系统存储不作为本片的运行验收。

AI 只显示真实菜单，需配置模型；飞书只演示真实配置表单 / 模式切换，需配置企业应用及权限。影片未调用模型、未向飞书写入，也未生成虚假成功反馈。macOS 与 Windows 共享界面，但 Windows 安装 / 运行仍待目标平台验收。未覆盖移动端、Web、CLI 或服务端 API。

## 复现

使用 Node.js 22+、Python 3.9+、FFmpeg / FFprobe。字体采用 macOS 系统 PingFang SC 和 Avenir Next，不随工程分发字体；其他系统需准备有授权的相应字体或修改影片外层字体并重新审片。

```bash
npm ci
npx playwright install chromium --only-shell
npm run build
npm run preview
# 打开控制台给出的地址 + /watch.html，可播放含声音的最终 MP4。
# 浏览器控制台：await seek(16); playFilm(); stopFilm();
# 上面的代码预览无音轨，成片含完整音轨。
node qa.mjs
node stills.mjs evidence/stills 3.2 10.5 16 24.5 31.7 35.5 42.5 49.8
node render.mjs --audio assets/master.wav --output renders/stickiii-product-promo-1080p.mp4
python3 tools/check_delivery.py plan.json --video renders/stickiii-product-promo-1080p.mp4 --mix-report evidence/audio-mix.json
```

可选：把 `PRODUCT_REPO` 指向另一个源码仓库以更新真实组件，默认使用固定快照。组件更新后需同步 product.css / 证据并重新审片，不能混报旧片验收。

重新生成音乐 / 混音：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python score.py
python3 tools/sfx_landmarks.py assets/sfx/*.wav
python3 tools/mix_audio.py plan.json
```

改了 plan、声音文件或分镜后，须重新混音、构建、导出。导出器会核对 plan / master 哈希，避免旧音轨进入新成片。

## 验证边界

- `evidence/render-qa.json`：10 个交互状态，5 个任意跳转帧与干净初始帧逐像素相同，无页面错误、无外部请求、无破图。
- `evidence/component-usage.json` / `component-imports.json` / `product-snapshot.json`：原组件来源、适配项、依赖图和源码哈希。
- `evidence/audio-selection.json`：原创配乐和内置原创音效的来源；`audio-mix.json`：分轨、音乐让位、17 个声音事件、响度和哈希。
- 最终 MP4 的联系表、转场条带和重点全尺寸画面将保存在 evidence/。
- 当前环境无法完成音频试听；电平、频谱和落点检查不能替代听感验收。

## 来源与许可证

原产品源码快照：Apache-2.0，见 product-snapshot/LICENSE 和 NOTICE。影片引擎、kit 和交付检查脚本由用户指定的 guizang-product-video-skill 起步工程适配，见项目 LICENSE / NOTICE.md（AGPL-3.0）。原产品完整 Logo 使用仓库公开资产。音乐是 score.py 从波形原创合成，无外部采样；5 类音效来自该 skill 的原创 WAV，详见 assets/sfx/SOURCE.md。未使用 default / fallback 的 BSL 组件，也未打包系统字体。

## 发布封面

16:9 3840×2160、4:3 2880×2160、3:4 2160×2880，见 covers/。三版重新排版，主图来自本片 10.5 秒真实渲染帧；已检查 320px 缩略图。重新导出：`node cover.mjs`。
