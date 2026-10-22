# 实施计划 · REQ-202610-0981 全量导出与归档（备份格式规范）

> 需求：REQ-202610-0981（backlog M9-04）｜ 分支：`feat/req-202610-0981-full-export-archive`
> 依赖：M5-04 备份与恢复（已落地，`vps/app/backup.py` + `deploy/scripts/backup-*.sh`）
> 基线：M8 验收分支 `4d061dd`（含 M6-08 知识库导出与 M5-04 备份能力）

## 1. 现状与缺口

- M5-04 解决的是**运维侧物理备份**：SQLite 快照、D1 SQL 导出、恢复演练，产物绑定当前部署，
  不能直接给用户带走，也不能跨部署 / 跨数据库恢复；
- M6-08 已提供**知识库导出**（`openfactory.knowledge.v1`：仓库 / 分类 / 标签 / 摘要，
  Markdown / JSON / Obsidian），但它只覆盖「知识库」视图，不含推荐、通知、报告、更新提醒等
  账号数据，也没有校验和、归档清单与格式版本治理；
- `docs/guides/knowledge-export.md` 与 `docs/guides/backup-restore.md` 均明确把
  「校验和、保留策略、备份元数据」留给 M9-04；
- 用户需要一份**可长期保存、可校验、可跨环境导入**的个人数据全量归档，而不是数据库物理文件。

## 2. 方案总览

```
admin /archive（全量导出与归档）
  → GET /api/export/archive/summary（登录态）
       返回各数据集条数、总记录数、预估字节、schema 版本、排除项
  → GET /api/export/archive?scope=full|knowledge&format=zip|json
       edge 按 user_id 只读查询全部用户数据
       → 纯函数构建 `openfactory.archive.v1`
       → ZIP：manifest.json + data/*.json + README.md + checksums.sha256
       → JSON：单文件 manifest + data
       → Content-Disposition 附件下载
```

设计原则：

1. **逻辑归档，不是物理备份**：导出稳定 JSON 结构，可跨 D1 / SQLite / 部署环境导入；
2. **只读、无迁移**：不新增表、不写 D1，所有数据在请求时聚合；
3. **账号隔离**：所有 SQL 强制 `user_id = ?`；分类 / 标签只导出当前用户仓库引用到的行；
4. **格式即契约**：`openfactory.archive.v1` 带 `manifest`、数据集清单、SHA-256 校验和、
   隐私排除项与恢复说明，后续只加字段不改语义；
5. **不导出秘密**：会话、令牌摘要、Telegram 绑定码、登录尝试、安全事件、限流与监控数据一律排除。

## 3. 归档格式（`openfactory.archive.v1`）

### 3.1 文件布局（ZIP）

```
manifest.json          归档元数据 + 数据集清单 + 隐私说明
checksums.sha256       sha256sum 兼容校验文件（每行 "<sha256>  <path>"）
README.md              人读摘要与恢复步骤
data/profile.json
data/repositories.json
data/categories.json
data/tags.json
data/recommendations.json
data/recommendation-feedback.json
data/notifications.json
data/push-preferences.json
data/reports.json
data/repo-updates.json
data/duplicate-dismissals.json
```

`scope=knowledge` 只包含 `profile / repositories / categories / tags` 五个数据集；
`scope=full`（默认）包含全部。`format=json` 时上述数据集收进单文件
`{"manifest": {...}, "data": {...}}`，文件名 `openfactory-archive-<date>.json`。

### 3.2 manifest

```json
{
  "schema": "openfactory.archive.v1",
  "version": 1,
  "archiveId": "arc-20261022T134500Z-full",
  "generatedAt": "2026-10-22T13:45:00.000Z",
  "generator": { "name": "OpenFactory", "url": "https://github.com/fntp/opensource-factory" },
  "format": "zip",
  "scope": "full",
  "user": { "id": "123", "login": "fntp", "name": "fntp" },
  "stats": { "datasets": 11, "records": 321, "bytes": 45678, "files": 15 },
  "datasets": [
    {
      "key": "repositories",
      "label": "收藏仓库",
      "path": "data/repositories.json",
      "records": 12,
      "bytes": 1234,
      "sha256": "…"
    }
  ],
  "privacy": {
    "excluded": ["sessions", "extension_tokens", "telegram_links", "telegram_link_codes",
                 "login_attempts", "security_events", "worker_metrics", "rate_limit_counters"],
    "notes": ["不包含任何明文令牌 / 会话 / 安全事件", "邮箱仅来自用户自己的 GitHub 资料"]
  },
  "restore": {
    "mode": "logical",
    "instructions": "按 data/*.json 的 user_id 归属导入；先导入 profile，再导入 categories/tags，最后导入 repositories 与活动数据。"
  },
  "checksums": { "algorithm": "sha256", "file": "checksums.sha256" }
}
```

### 3.3 数据集口径

| key | 来源表 | 说明 |
| --- | --- | --- |
| `profile` | `users` | id / login / name / email / avatar / createdAt |
| `repositories` | `my_repositories` + 分类名 + 标签 | 全字段（含健康度 / License），标签为数组 |
| `categories` | `categories` | 仅当前用户仓库引用的分类（含父级 id） |
| `tags` | `tags` + `repo_tags` | 仅当前用户仓库使用的标签，附 repoIds |
| `recommendations` | `recommendations` | `user_id = ?`，按创建时间倒序 |
| `recommendation-feedback` | `recommendation_feedback` | 收藏 / 忽略 / 点击反馈 |
| `notifications` | `notifications` | 站内通知 |
| `push-preferences` | `push_preferences` | 推送偏好（单行） |
| `reports` | `curated_reports` | 周报 / 月报（含预渲染 Markdown） |
| `repo-updates` | `repo_updates` | 收藏项目更新提醒 |
| `duplicate-dismissals` | `duplicate_dismissals` | 重复检测忽略记录 |

排序规则固定：仓库按 Star 降序、同 Star 按 id 升序；分类 / 标签按名称升序；活动数据按
`created_at`（或 `generated_at` / `detected_at`）倒序；保证同输入生成同字节内容。

## 4. 接口

| 端点 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/api/export/archive/summary` | GET | 登录态 | 数据集条数、总记录 / 字节估算、schema 版本、排除项 |
| `/api/export/archive` | GET | 登录态 | `scope=full\|knowledge`、`format=zip\|json`，返回附件 |
| `/api/export/archive/manifest` | GET | 登录态 | 仅返回 manifest（JSON，便于预览 / 自动化解包前校验） |

响应头统一：`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、
`Content-Disposition: attachment`（manifest 接口为 inline JSON）。

## 5. 交付物

| 文件 | 说明 |
| --- | --- |
| `edge/src/archive/build.ts` | 数据集定义、参数归一化、manifest / README / checksums / JSON 构建 |
| `edge/src/archive/hash.ts` | Web Crypto SHA-256 十六进制摘要 |
| `edge/src/routes/archive.ts` | summary / manifest / download 路由与 D1 只读查询 |
| `edge/src/index.ts` | 挂载 `/api/export/archive`（复用 `/api/export` 前缀） |
| `edge/scripts/archive-build.test.mjs` | 纯函数、manifest、checksums、ZIP 结构、参数用例 |
| `admin/src/features/archive/*` | API、类型、工具、页面、演示数据、Vitest |
| `admin/src/routes/_authenticated/archive/index.tsx` | `/archive` 文件式路由 |
| `admin/src/components/layout/data/sidebar-data.ts` | 「开源资产」新增「全量归档」 |
| 文档 | 本计划、`docs/guides/full-export-archive.md`、架构总览 / 接口边界、数据模型、README、backlog、roadmap、task-planning、open-questions |

## 6. 验证计划

```bash
cd edge && npm run typecheck && npm test
cd admin && npm run lint && npm run build && npm run test
cd vps && .venv/bin/pytest -q
git diff --check
```

验收标准：

1. 登录用户访问 `/archive` 能看到各数据集条数与归档范围，选择完整 / 知识库与 ZIP / JSON；
2. 下载的 ZIP 可被标准解压工具打开，`manifest.json` 数据集清单与实际文件一致；
3. `checksums.sha256` 可用 `sha256sum -c` 校验通过；
4. `scope=knowledge` 不包含活动数据；`scope=full` 不包含任何令牌 / 会话 / 安全事件；
5. 未登录接口 401；所有查询按 `user_id` 隔离；
6. 三端检查全绿，文档同步更新。

## 7. 边界与风险

- **不存储归档文件**：服务端只负责生成与下载，归档由用户保存；保留策略见指南（建议至少保留
  最近 4 份，每季度做一次恢复抽检）；
- **不做加密**：归档含个人邮箱与收藏数据，下载后由用户自行加密保存；后续可评估口令加密 ZIP；
- **大数据量**：Workers 响应体与 CPU 有限，单用户千级仓库仍可控；超过 5 万条活动记录时建议
  分批导出，记入 open-questions；
- **恢复是逻辑导入**：本期只定义格式与校验，不提供自动回灌接口，避免误覆盖线上数据；
- **分类 / 标签为全局表**：只导出当前用户仓库引用到的行，避免泄露其他用户分类名。

## 8. 实施结果（2026-10-22）

- 新增 `openfactory.archive.v1` 归档格式：ZIP（manifest / data / README / checksums）与单文件 JSON；
- 新增 `GET /api/export/archive/summary`、`/api/export/archive`、`/api/export/archive/manifest`；
- 新增 admin `/archive` 页面：范围 / 格式选择、数据集统计、隐私排除说明、格式规范与下载；
- 新增 `docs/guides/full-export-archive.md` 格式规范与恢复 / 保留说明；
- 验证结果与提交哈希见交付记录（`docs/planning/task-planning.md`）。
