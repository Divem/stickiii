# 整体架构与同步边界

> 产品需求见：[快速记录产品需求](../prd/quick-capture-notes-prd.md)
>
> 后续方案：[飞书文档窗口技术设计](feishu-document-tabs-design.md)，采用独立 `WebContentsView` 承载网页；尚未实现，本文以下仍描述现有架构。

## 1. 桌面框架

贴贴便签使用 Tauri 2 + Rust 承载 React 界面。macOS 使用系统 WKWebView，Windows 使用 WebView2，应用不携带 Chromium 或 Node.js。默认窗口约 440×390，无系统标题栏，可拖动、缩放、最小化及隐藏。主窗口关闭表示隐藏，快捷键与 macOS Dock 可重新唤起；独立便签窗口关闭前保存，便签仍保留。同一应用实例复用主窗口，每条便签最多拥有一个独立窗口。

唤起时按当前鼠标所在显示器的可用区域放置窗口，使用物理坐标与缩放比例限制边界。置顶通过原生命令切换；macOS 同时切换跨桌面显示。窗口拖动由标题栏空白区域调用原生 start_dragging，按钮不触发拖动。

透明窗口在 macOS 开启 Tauri 的 macOSPrivateApi。该选项不适用于 Mac App Store 审核，当前交付为独立应用包；签名、公证与商店发布未配置。

## 2. 进程与权限边界

```text
Rust 桌面进程
  窗口 / 全局快捷键 / JSON 与附件 / 系统凭据 / 飞书和 AI 认证与传输
            ↕ 本地 main / 绑定单条便签的 note 窗口的具名命令
React + desktop.ts
  编辑 / Markdown 预览 / 菜单 / 连接器冲突与恢复逻辑
```

- `src-tauri/src/lib.rs` 装配桌面生命周期并验证每次调用的窗口标签与来源；发布版不接受开发服务器来源。
- `src-tauri/src/storage.rs` 保存记录、导入附件并校验规范化后的路径，阻止父目录与符号链接逃逸。
- `src-tauri/src/note_windows.rs` 管理独立窗口与便签的对应关系、单窗口编辑归属、布局持久化和多窗口退出确认；独立窗口只接收绑定便签的数据通知。
- `src-tauri/src/credentials.rs` 保管凭据；`sync.rs` 认证、限流并限制请求路由和文档范围；`ai.rs` 保存独立 AI 配置并执行受限的便签润色请求。
- `src/renderer/desktop.ts` 保留 window.desktopTabs 的具名产品方法，不向 UI 暴露通用 invoke、文件系统、HTTP 或 shell。
- `src-tauri/capabilities/main.json` 只授权本地 main 窗口的业务命令，不授权远程来源或通用插件命令；窗口通知由 Rust 派发到指定 WebView 内，不通过全局事件监听传递正文；CSP 禁止 iframe、对象与表单提交。
- `src-tauri/capabilities/note.json` 为原生登记的独立窗口授权当前便签的有限操作，Rust 额外校验来源、便签 ID、附件和同步任务归属；仅匹配窗口名前缀不能通过原生校验。
- `src/shared/types.ts` 是 Note / Attachment / SyncResult 的共享契约。Rust 以兼容 JSON 格式持久化，保留同步元数据。

全局快捷键保存在应用数据目录的 shortcuts.json。原生层校验四个动作、解析键位并检测别名重复，注册失败或文件保存失败时恢复上一组；按下事件通知 React，松开事件不重复触发。

## 3. 数据与迁移

记录存储在 Tauri app_data_dir 对应的 notes.json，附件位于 attachments/，快捷键位于 shortcuts.json。首次启动或读取到空笔记库时，存储层会写入两条产品介绍便签；它们是普通便签，用户可以编辑或删除，删除全部后下次启动会重新生成，以覆盖重新安装但应用数据目录仍被保留的情况。文件通过 BufWriter 写入同目录临时文件，显式 flush、fsync 后原子替换；写入成功后才更新内存快照。未修改便签直接返回已存快照，不写盘也不更新时间。保存命令在阻塞工作线程执行，文件选择后的复制也在工作线程执行并释放整个记录集合的锁。损坏文件或读取失败不会当作空数据覆盖。图片不超过 3 MB 时额外保存 data URL 用于预览。

renderer 的 `noteSaveQueue.ts` 串行执行本地写入，记录最新草稿与已落盘版本。排队的保存读取执行时的最新草稿，切换与退出执行 flush，将保存期间的新输入继续落盘后再完成操作；失败保留最新草稿，重试队列不会被拒绝的 Promise 阻塞。删除同样进入队列，避免迟到保存复活便签。便签列表顺序在会话中保持稳定；标题按首行缓存，列表搜索使用延迟查询，每次最多增加 100 个条目。

主动退出经过 `request_exit` → Rust `ExitRequested` 暂停退出 → 带唯一请求 ID 的 `app:exit-requested` → 所有 renderer 等待导入、同步与 AI 润色并 flush 草稿 → `complete_exit` 的协议。主动退出命令仅允许 main；保存确认允许 main 和原生登记的独立便签窗口，只在对应退出请求待处理时生效，重复或过期确认无效。所有窗口确认成功且布局落盘后才退出；任一失败通知所有窗口取消退出并恢复编辑。异常终止和系统强制杀进程不能依赖这条协议，草稿恢复日志尚未实现。

独立窗口复用 `NoteEditor.tsx` 与保存队列。一条便签只允许一个编辑窗口，提交写入时再次在原生注册表中校验，阻止主窗口的旧草稿覆盖独立编辑。`note-windows.json` 单独记住窗口位置、尺寸、置顶及是否打开，不改变便签修改时间。详见 [独立便签窗口方案](independent-note-windows.md)。

首次启动且新目录尚无 notes.json 时，从系统应用数据目录下的 desk-tabs/ 复制 Electron 旧记录、被记录引用的附件及快捷键，改写附件为新目录路径并保留旧文件。旧 title 合并到 content 一次；已有新目录数据后不重复迁移，也不会在清空便签后重新导入。旧加密 sync-config.bin 不迁移，用户需重新填写凭据。

普通保存以 Rust 内已有的 feishu / feishuTargets 为准，防止前端旧副本覆盖同步检查点；删除后的迟到保存不能复活记录。主题按便签保存，窗口透明度与界面语言作为 renderer 的应用级偏好保存在 WebView localStorage，切换便签不会改变。旧记录中的 `themeOpacity` 仅在首次启动时迁移为全局值。未来引入 SQLite 需另行设计迁移、备份和恢复。

## 4. 同步契约

同步返回 `not-configured`、`not-implemented`、`synced`、`conflict` 或 `error`。飞书已接入真实 API，Notion 仍返回 `not-implemented`。

- `src-tauri/src/credentials.rs` 在用户主动操作时从 macOS Keychain / Windows Credential Manager 读取凭据；renderer 只接收公开配置。启动读取不含密钥的 `sync-configs.public.json`，成功读取的凭据只在 Rust 进程内缓存。旧 Electron 的加密凭据不自动解密，需要重新填写。
- `desktop.ts` 为原有连接器注入原生 Feishu 传输。Rust 的 `sync.rs` 只访问固定的 `open.feishu.cn/open-apis`，在活动同步任务中校验文档、方法与路由；认证接口不能由 renderer 调用，Secret 和访问令牌不返回前端。每次请求有 20 秒超时和至少 400 ms 间隔，仅对明确限流拒绝退避重试；系统代理的实际行为需在目标网络验收。
- `feishu.ts` 先将 Markdown 转换为文档块并检查结构，再创建文档、持久化映射、分批写入嵌套块。每批最多 1000 个块，父子结构不跨批拆分；本地图片和文件附件分别创建 `docx_image`/`docx_file` 块，通过受限素材上传绑定 token；清除表格只读 `merge_info`。
- `Note.feishu` 保存应用 ID、文档 ID、URL、已确认的版本、内容摘要、同步时间和协作者邮箱。后续同步复用文档；无修改时只读校验。元数据由Rust 进程维护，普通保存不能用 renderer 的旧副本覆盖。
- 更新时先写新块，再删除旧块；校验块列表和版本后，给配置邮箱增加编辑权限，最后才标记同步成功。写入失败可能留下部分新块，保留文档链接，重试继续使用原文档。
- 发现远端版本变化时返回 `conflict`，仅在用户确认覆盖后更新。编辑 API 携带版本号和 UUID `client_token`；创建文档接口没有该幂等参数，创建结果未知时保留 `creationPending` 并停止重复创建，避免生成多篇文档。
- 同步按便签阻止重复点击，按应用串行处理。本地保存与远端写入分离；同步期间的新输入不会被旧响应或冲突重试的快照覆盖。

追加模式由 `feishuChapter.ts` 实现：先分页读取一致版本的文档块快照，每条笔记的首行作为一级标题，其余内容写为该章节正文。只记录并更新当前笔记拥有的根块 ID 与后代内容摘要；更新先插入新章节，再按已验证的连续 ID 范围删除本笔记旧块，不清空文档根节点或改名文档。章节缺失或被其他块穿插时停止更新。

`Note.feishuTargets` 按应用、同步模式及实际文档 ID 保存对应关系，`Note.feishu` 指向最近使用的同步位置。Wiki 节点先解析 `obj_token`，按实际 DocX ID 复用已有章节，用户填写的 URL 则原样保留用于打开。普通保存不能覆盖Rust 进程维护的同步映射。

章节写入前持久化原始请求体、版本和 `client_token`；未知插入结果使用同一请求恢复，再通过响应中的 `block_id_relations` 确认归属。删除结果未知时先读取旧块是否仍存在，避免重放索引删除误伤后续章节。配置切换保留各模式及目标位置。当前追加章节限制为 1000 块，独立文档模式仍可分批写入。

Markdown 预览采用 `react-markdown` + `remark-gfm`，不执行原始 HTML。链接和图片只允许 HTTP(S)，点击链接经专用桌面方法交给系统浏览器。主窗口拒绝远程导航及新窗口；capability 不授予远程网页权限。Markdown 网络图片在飞书载荷中转为链接，本地附件通过受管素材上传，原文与附件保持原样。

接口来源、配置步骤和验收边界见 [飞书与 Markdown 使用及验收](../handover/feishu-markdown.md)。

## 5. AI 润色

`ai.rs` 通过独立的 `ai-config` 系统凭据条目保存 API 地址、模型和 Key，与飞书凭据隔离。公开配置只包含地址、模型、配置时间和 `apiKeyConfigured`，保存至 `ai-config.public.json` 供窗口初始化读取；密钥仅在用户主动使用时读取并在 Rust 进程内缓存。公开文件缺失时，旧配置在首次使用或主窗口进入对应配置时迁移，不在启动时解锁。保存时 Key 留空只能复用同一地址的原 Key；更换地址必须重新输入，避免向其他服务发送旧 Key。清除配置将该条目内容置为 null，并更新公开文件和缓存。权限、迁移及固定签名的边界见 [钥匙串授权与凭据读取](../handover/keychain-access.md)。

可信本地窗口只可调用 `get_ai_config`、`save_ai_config`、`clear_ai_config`、`polish_note` 和 `ai_note`。润色与翻译、扩写、解读都只接收便签 ID；Rust 从存储读取已保存文本，根据受控的操作枚举选择固定提示词，再请求配置地址下的 `/chat/completions`。前端不能传入任意路径、请求头、操作提示词或凭据。允许 HTTPS，以及回环地址的 HTTP 本地服务；地址不能包含用户名、密码、查询或片段。禁止重定向，连接超时 15 秒、总请求超时 90 秒，不自动重试付费请求。输入限制为 64 KiB UTF-8，响应体最多 1 MiB，结果文字最多 128 KiB。附件和远端文档不参与请求。

`notePolish.ts` 比较返回结果对应的原文与最新草稿：已删除或已修改则不应用；成功只更新文本、修改时间和本地同步状态，保留附件、主题与同步元数据，通过原有保存队列落盘。支持撤销最近一次润色，但仅在文本仍等于润色结果时允许，避免撤销覆盖后续手动编辑。切换页面后继续保存原便签；退出等待请求及落盘完成。API 鉴权、限流、超时、空响应、截断或拒绝均返回明确状态，服务错误正文不回传，错误信息不包含 Key。

模型配置增加可信本地 `test_ai_connection` 命令：使用未保存的表单配置，Key 留空时仅在同一规范化地址读取已保存 Key。已提供 Key 的测试不依赖凭据库读取，不持久化配置；向相同 Chat Completions 接口发送固定短文本，校验有效回复后返回模型名称及完整响应耗时，总超时 30 秒。测试与四种 AI 操作共用全局请求互斥，不进行自动重试，也不访问便签存储。模型原样回复返回 `unchanged`，前端只说明本次没有改动，不作文字质量判断。

接口来源及用户操作见 [AI 润色](../handover/ai-polish.md)。

## 6. 构建与发布

Vite 构建 dist/renderer，Tauri 将其嵌入 Rust 二进制。npm run build 调用 tauri build --no-bundle；package:mac 先由 Tauri 生成 .app，再从临时目录通过 hdiutil 直接生成并验证 DMG，无需挂载临时宗卷或操作 Finder，避开系统占用导致的卸载失败。package:win 生成 NSIS 安装程序。包中只包含应用二进制、编译后的资源及图标，不复制 node_modules、源码或开发缓存。应用版本由 tauri.conf.json 的 version 指向 package.json，不自动递增。

Windows 默认安装器在需要时下载 WebView2。managed 配置跳过运行环境安装，由企业 IT 预先离线部署 WebView2；offline 配置携带完整离线安装器，包体积会明显增大。三种包需要分别报告体积，macOS 的测量不能代替 Windows 测量。

自动化契约、Rust 测试、macOS 实际运行、Windows 实际运行和真实飞书写入是不同验收层级。未进行的平台或外部写入不得报告为已验收。
