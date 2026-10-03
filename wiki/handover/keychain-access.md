# 钥匙串授权与凭据读取

## 当前可用

启动、唤起主窗口、恢复独立便签窗口及普通编辑，只读取应用数据目录中的 `ai-config.public.json`、`sync-configs.public.json`。这两份文件只包含公开配置字段；API Key、App Secret、访问令牌不会写入其中，也不会回传渲染层。公开状态说明曾保存配置，不代表外部服务已经认证成功。

密钥继续保存在 macOS Keychain / Windows Credential Manager。只有用户执行 AI 操作、飞书同步、保存或清除配置、使用保存的 Key 测试连接，才需要访问系统凭据。成功读取的值只在 Rust 进程内缓存；成功保存和清除立即更新缓存，退出应用后消失。访问被拒绝或发生错误时不缓存失败，不覆盖旧凭据；下次主动操作可以重试。运行期间若在系统工具中手动更改凭据，需退出并重新启动应用使缓存失效。

兼容旧版已经保存的配置：首次主动使用相关功能，或在主窗口打开对应的模型/飞书配置时，读取原钥匙串条目并生成公开配置文件，无需重新填写密钥。公开文件缺失时，启动不会尝试解锁；设置入口显示“查看配置”，避免把尚未读取的旧配置断言为“未配置”。迁移失败时显示明确错误和重试入口，表单不会显示为空配置。普通设置菜单、语言与主题选择不会触发迁移。

`get_ai_config`、`list_sync_configs` 默认只读取公开文件。桌面桥仅在用户进入相关配置时传入 `loadSaved: true`，且原生层只允许可信主窗口使用该参数。独立便签窗口仍只能读公开配置，并在用户使用 AI/同步时通过原有便签、附件与任务归属校验访问凭据。命令注册和 capability 清单无需增加权限。

公开配置损坏或写入失败会返回明确错误，不会自动回退到钥匙串。保存/清除操作先更新系统凭据，再更新公开文件；公开文件写入失败时返回 `unavailable`，不能据此认定凭据没有变化，应在权限或磁盘问题解决后重试。

## macOS 签名

未配置证书时，`npm run package:mac` 保留完整 `.app` 的 ad-hoc 签名，并明确提示：新构建的身份可能变化，更新后首次使用已保存凭据时仍可能需要系统授权。选择“始终允许”可以记住当前构建的授权；应用不会修改钥匙串的访问控制来绕过授权。

已有固定签名证书时，使用同一身份打包，例如：

```bash
APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)' npm run package:mac
```

也可在 `src-tauri/tauri.conf.json` 的 `bundle.macOS.signingIdentity` 配置身份。打包脚本保留配置的证书签名，不替换为 ad-hoc；签名或验证失败会停止打包。证书名称需替换为本机真实身份，可通过 `security find-identity -v -p codesigning` 查看。

证书签名、公证和正式分发尚未完成。本次检查未发现可用代码签名身份，因此不能宣称跨版本授权已稳定。固定签名身份也不替代用户对旧钥匙串条目的首次授权。

## 验证

- Rust 回归覆盖钥匙串拒绝时的零启动读取、主动迁移和重启读取、公开字段白名单、损坏数据、保存/清除失败保留原状态，以及进程内缓存更新和失败后重试。
- 桌面桥契约验证默认 `loadSaved: false` 与显式迁移请求。
- 独立窗口 smoke 增加拒绝读取旧 AI/同步配置的权限断言；该测试使用隔离应用数据和钥匙串命名空间，不读取真实凭据。
- 真实用户钥匙串的系统弹窗、固定证书跨版本授权和 Windows 运行验收，需在对应环境确认；自动测试不等于这些验收。

2026-10-03 验证结果：`npm run typecheck`、`npm run check:native`、80 项契约测试、36 项 Rust 测试通过；独立窗口 smoke 首次因原生点击辅助程序无法取得系统焦点而停止，重试的两个阶段均通过，没有跳过权限断言。macOS arm64 `.app` 与 DMG 已生成，完整签名验证及 DMG 校验通过。本次未替换 `/Applications` 中的安装版，也未读取真实凭据或执行真实 AI/飞书请求。

参考：[Apple 钥匙串授权选项](https://support.apple.com/zh-cn/guide/keychain-access/kyca1243/mac)、[Apple 代码签名身份与 ad-hoc 签名](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html)。
