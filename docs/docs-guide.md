# desk-tabs 文档管理指南

> 项目产品、技术和交接文档以 `wiki/` 为主目录，遵循根目录 `AGENTS.md`。本 `docs/` 结构仅在用户明确要求使用 docs-organizer，或需要存放独立的调研、报告和规划材料时使用；不要把 `wiki/` 文档无条件复制到这里。

## 目标

- 一眼看出文档类型和用途
- 文件名在终端、URL、Git 中都能安全使用（无空格、无括号等特殊字符）
- 新旧文档能快速定位，避免根目录堆积
- 明确什么时候该写文档、写什么、写在哪
- 关联文档之间可追溯、可交叉引用

---

## 一、目录结构

```
docs/
├── docs-guide.md             ← 本文件
│
├── prd/                 产品需求、功能规格、业务逻辑说明
├── tech/                 技术实现、数据 schema、技术设计、开发者规范
├── design/                 UI/UX 规范、品牌、配色、线框图、参考素材
├── handover/                 模块完成后的技术交接文档
├── research/                 技术调研、可行性分析、POC、竞品分析
├── reports/                 开发进度、代码审查等回顾性报告
├── planning/                 开发计划、里程碑、路线图
├── raw-source/                 外部原始参考资料
├── archive/                 过时但仍需保留的历史文档
│

```

### 1.1 关于受保护目录

当前没有配置受保护目录。若未来有框架或工具自动管理的目录，请先加入 `.claude/docs-organizer.yaml` 的 `protected_dirs`。

### 1.2 核心目录说明

| 目录 | 用途 |
|:---|:---|
| `prd/` | 产品需求、功能规格、业务逻辑说明 |
| `tech/` | 技术实现、数据 schema、技术设计、开发者规范 |
| `design/` | UI/UX 规范、品牌、配色、线框图、参考素材 |
| `handover/` | 模块完成后的技术交接文档 |
| `research/` | 技术调研、可行性分析、POC、竞品分析 |
| `reports/` | 开发进度、代码审查等回顾性报告 |
| `planning/` | 开发计划、里程碑、路线图 |
| `archive/` | 过时但仍需保留的历史文档 |
| `raw-source/` | 外部原始参考资料 |

---

## 二、文件名格式

### 2.1 语言选择

| 场景 | 推荐语言 |
|:---|:---|
| 技术实现、代码相关、schema、API 文档 | **英文**（kebab-case） |
| 产品需求、业务逻辑、面向非技术人员的说明 | **中文** 或中英混合均可 |
| 设计文档 | 中英文均可，保持目录内统一 |
| 调研与分析文档 | 中文或英文均可，保持目录内统一 |

### 2.2 字符规范

| 允许 | 禁止 | 示例 |
|:---|:---|:---|
| 字母、数字、中文 | 空格 | ✅ `sync-engine.md` ❌ `sync engine.md` |
| 连字符 `-` | 下划线 `_`（除非代码相关） | ✅ `data-fields.md` ❌ `data_fields.md` |
| 句点 `.`（仅用于扩展名） | 括号 `()` `[]`、斜杠、问号等 | ✅ `setup-guide.md` ❌ `指南(完整).md` |
| 小写（英文部分） | 大写驼峰 | ✅ `database-schema.md` ❌ `DatabaseSchema.md` |

### 2.3 版本与日期

- **不需要版本号**：Git 管理历史，文件名不要带 `v1`、`v2`、`final`、`最新`
- **需要日期的情况**：计划类、报告类文档可带日期前缀，格式 `YYYY-MM-DD-`：
  - ✅ `2026-04-18-mvp-plan.md`
  - ❌ `4.18计划.md`、`plan_final_v2.md`

---

## 三、命名模式速查表

| 目录 | 推荐命名 |
|:---|:---|
| `prd/` | `{module}-requirements.md` 或 `{feature}-spec.md` |
| `tech/` | `{topic}-design.md`、`{component}-logic.md`、`{topic}-guide.md` |
| `design/` | `{feature}-interaction.md`、`design-token-{scope}.md` |
| `handover/` | `{module}.md` |
| `research/` | `{topic}-research.md`、`{topic}-feasibility.md`、`{topic}-analysis.md` |
| `reports/` | `{YYYY-MM-DD}-{topic}-progress-report.md` 或 `{scope}-code-review.md` |
| `planning/` | `{YYYY-MM-DD}-{topic}-plan.md` |
| `archive/` | 沿用原文件名，必要时保持可追溯 |
| `raw-source/` | `{source}-api-ref.md`、`{tool}-cli-ref.md` |

---

## 四、文档产出触发条件

**什么时候必须写文档？**

### 4.1 新功能或大迭代

| 触发条件 | 必须产出 | 存放位置 |
|:---|:---|:---|
| 新增功能模块 | 技术设计文档 | `tech/{topic}-design.md` |
| 新增功能模块 | 产品需求文档（如无已有 PRD） | `prd/{module}-requirements.md` |
| 新增功能模块 | 技术交接文档（模块完成后） | `handover/{module}.md` |
| 数据库 schema 变更 | 更新数据库文档 | `tech/database-schema.md` |

### 4.2 开发过程中的固定产出

| 场景 | 必须产出 | 存放位置 |
|:---|:---|:---|
| 技术调研 | 调研文档 | `research/{topic}-research.md` |
| 技术选型 / 可行性分析 | 可行性分析文档 | `research/{topic}-feasibility.md` |
| POC 验证 | POC 记录 | `research/{topic}-poc.md` |
| 竞品分析 / 产品分析 | 竞品分析文档 | `research/{topic}-analysis.md` |
| 代码审查 | 代码审查文档 | `reports/{scope}-code-review.md` |
| 开发进度总结 | 进度报告 | `reports/{date}-progress-report.md` |
| 重大技术决策 | 决策记录写入技术文档 | `tech/{topic}-design.md` |
| 踩坑 / 调试经验 | 经验教训文档 | `tech/{topic}-lesson.md` |
| 参考外部实践 | 借鉴参考文档 | `tech/{source}-reference.md` |
| 开发计划 | 计划文档 | `planning/{date}-{topic}-plan.md` |

### 4.3 可选产出

以下场景鼓励但不强制造文档：小 bug 修复、纯 UI 微调、配置变更、依赖升级。

---

## 五、文档交叉引用

### 5.1 反向链接要求

当 `prd/` 中的需求文档与 `tech/` 中有对应的技术实现文档时，**双方必须在文件开头互相链接**：

```markdown
<!-- prd/xxx-requirements.md 头部 -->
> 技术实现见 [xxx-design.md](../tech/xxx-design.md)
```

```markdown
<!-- tech/xxx-design.md 头部 -->
> 产品需求见 [xxx-requirements.md](../prd/xxx-requirements.md)
```

### 5.2 何时需要交叉引用

| 关系 | 链接方式 |
|:---|:---|
| PRD ↔ 技术设计 | 双向链接 |
| PRD ↔ 交接文档 | 双向链接 |
| 技术设计 ↔ 经验教训 | 在技术设计的"相关文档"小节链接 |
| 调研报告 → 技术设计 | 在技术设计的"背景/参考"小节链接 |
| 计划文档 → 对应 PRD | 在计划文档头部链接 |

### 5.3 链接格式

统一使用相对路径：`../{目录}/{文件名}`，不使用绝对路径。

---

## 六、目录索引维护

每个文档目录各自维护一个 `README.md` 作为文件索引。

格式示例：

```markdown
# tech/ 技术文档

| 文件 | 主题 | 最后更新 |
|:---|:---|:---|
| `database-schema.md` | 数据库表结构和迁移记录 | 2026-04-18 |
```

### 索引更新时机

- **新增文件时**：同步更新目录 README
- **删除/归档文件时**：同步移除 README 条目
- **大改文件内容时**：更新"主题"描述和"最后更新"日期

---

## 七、文档生命周期

```
[调研] → research/（技术方案、可行性分析、POC）
         ↓ 调研完成，决定实施
[新建] → planning/（活跃计划）
         ↓ 实施完成
         tech/（正式技术文档） 或 prd/（正式需求文档） 或 handover/（交接文档）
         ↓ 过时废弃
         archive/（归档）
```

### 不允许的操作

- ❌ 直接删除文档（必须归档到 `archive/`）
- ❌ 在文件名中加版本号（`v2`、`final`、`最新`）—— Git 管理历史
- ❌ 修改受保护目录下的任何文件

---

## 八、执行建议

1. **不强制一次性迁移**：新文档按规范写，旧文档在下次编辑时顺手移动并重命名
2. **Git 迁移时注意**：`git mv` 保留历史，不要手动复制删除
3. **受保护目录**：任何受保护目录下的文件，一律不动
4. **索引先行**：新增文档后第一时间更新目录 README，不要积攒
