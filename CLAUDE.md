## 文档管理

项目文档遵循 `docs/docs-guide.md` 规范，核心规则：

### 目录约定

| 目录 | 用途 |
|:---|:---|
| `prd/` | 产品需求、功能规格 |
| `tech/` | 技术实现、设计文档（`-design` 后缀）、schema |
| `design/` | UI/UX 设计资源、品牌、参考素材 |
| `handover/` | 模块完成后的交接文档 |
| `research/` | 调研分析（前瞻性：技术方案、可行性、竞品） |
| `reports/` | 回顾性报告（进度、代码审查） |
| `planning/` | 开发计划、里程碑 |
| `archive/` | 废弃但需保留的历史文档 |
| `raw-source/` | 外部原始参考资料（API 文档、CLI 手册） |

### 命名规范

- 英文 kebab-case，无空格无括号无版本号
- 技术设计文档用 `-design` 后缀：`tech/{topic}-design.md`
- 计划/报告类用日期前缀：`{YYYY-MM-DD}-{topic}-plan.md`
- Git 管理历史，不要在文件名中加 `v1`、`v2`、`final`

### 产出触发

- 新功能/大迭代 → 必须写技术设计文档 + PRD（如无）
- Schema 变更 → 必须更新 `tech/database-schema.md`
- 模块完成 → 写交接文档到 `handover/`
- 调研/竞品分析 → 写到 `research/`

### 交叉引用

PRD 与技术设计文档**必须双向链接**：

```markdown
<!-- prd/ 头部 -->  > 技术实现见 [xxx-design.md](../tech/xxx-design.md)
<!-- tech/ 头部 --> > 产品需求见 [xxx-requirements.md](../prd/xxx-requirements.md)
```

### 索引

每个文档目录维护 `README.md` 索引表。新增/删除文件后立即更新。

### 受保护目录

当前没有配置受保护目录。若未来有框架或工具自动管理的目录，请先加入 `.claude/docs-organizer.yaml` 的 `protected_dirs`。
