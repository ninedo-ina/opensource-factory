# 实施计划 · REQ-202610-0982 数据质量治理（去重 / 失效链接 / 元数据补全）

> 需求：REQ-202610-0982（backlog M9-05）｜ 分支：`feat/req-202610-0982-data-quality-governance`
> 依赖：M1-16 数据一致性巡检（本轮补齐最小对账能力）｜ 基线：M8 验收（4d061dd）
> 目标：为收藏库建立可复跑的「数据质量体检」：识别重复条目、失效链接与缺失元数据，
> 支持一键补全元数据、忽略 / 恢复问题，并提供 D1 ↔ 本机镜像对账工具。

## 1. 现状与缺口

- 收藏库的元数据来自 GitHub / Gitee 同步，历史数据可能缺简介、语言、License、摘要、分类；
- 项目被删除、改名或迁移后，`html_url` 可能 404 或跳转，当前没有任何检测；
- M6-03 已有重复检测，但结果只用于「重复检测」页面，没有沉淀为可跟踪的数据质量台账；
- M1-16 的 D1 ↔ 本机镜像对账尚未实现，数据质量缺少一致性视角；
- 用户需要一个总览页回答「我的收藏库健康度如何、有哪些问题、哪些能一键修」。

## 2. 方案总览

```
admin /data-quality
  ├─ POST /api/data-quality/scan
  │    ├─ edge 本地规则：元数据缺失 / 陈旧 + 重复检测（复用 M6-03 纯函数）
  │    ├─ VPS /api/data-quality/check-links：HEAD 校验链接（404 / 重定向）
  │    └─ 结果 upsert 到 D1 data_quality_issues（按用户 + 仓库 + 问题键幂等）
  ├─ POST /api/data-quality/fix
  │    └─ VPS /api/data-quality/metadata：拉取 GitHub 仓库详情 → 回写 D1 元数据
  ├─ POST /api/data-quality/issues/ignore|restore
  └─ GET  /api/data-quality：最近一次扫描 + 问题台账 + 历史
```

设计原则：

1. **只读检测、显式修复**：扫描不修改仓库；只有用户点「补全元数据」才写 D1；
2. **按用户隔离**：所有 D1 SQL 带 `user_id`，VPS 只接收当前用户的仓库 id / URL；
3. **可降级**：VPS 不可达时本地规则照常扫描；元数据补全退化为「用 README 摘要补简介」；
4. **幂等台账**：`(user_id, repo_id, issue_key)` 唯一，重复扫描更新而不是新增；
5. **不重复造轮子**：重复检测复用 M6-03 的 `detectNameDuplicates`，不新增向量逻辑。

## 3. 数据模型（D1 migration `0023_data_quality.sql`）

`data_quality_scans`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `dq_<uuid>` |
| `user_id` | TEXT | 用户 id |
| `mode` | TEXT | `local` / `hybrid`（VPS 链接检测可用时为 hybrid） |
| `scanned` | INTEGER | 参与扫描的仓库数 |
| `issue_count` | INTEGER | 本次检出问题数 |
| `critical_count` / `warning_count` / `info_count` | INTEGER | 分级计数 |
| `score` | INTEGER | 质量分 0–100 |
| `duplicate_count` / `broken_link_count` / `metadata_count` | INTEGER | 分类计数 |
| `created_at` | TEXT | 扫描时间 |

`data_quality_issues`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 稳定 id（user + repo + issue_key 摘要） |
| `user_id` / `scan_id` / `repo_id` | TEXT | 归属与来源 |
| `issue_key` | TEXT | 稳定键：`missing_metadata:description` / `duplicate:<cluster>:<repo>` / `broken_link:url` |
| `type` | TEXT | `duplicate` / `broken_link` / `missing_metadata` / `stale_metadata` |
| `severity` | TEXT | `critical` / `warning` / `info` |
| `field` | TEXT NULL | `description` / `language` / `license` / `summary` / `category` / `html_url` |
| `title` / `detail` / `suggestion` | TEXT | 展示文案与修复建议 |
| `status` | TEXT | `open` / `ignored` / `fixed` |
| `detected_at` / `resolved_at` | TEXT | 检测 / 关闭时间 |

索引：`(user_id, status, severity)`、`(scan_id)`、`(user_id, repo_id)`。

## 4. 接口

| 端点 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/api/data-quality` | GET | 登录态 | 最新扫描摘要 + 问题列表（`type` / `severity` / `status` / `limit`）+ 历史 |
| `/api/data-quality/scan` | POST | 登录态 | 执行质量扫描（`checkLinks` / `maxRepos`），upsert 台账 |
| `/api/data-quality/fix` | POST | 登录态 | 补全元数据（`repoIds` / `fields`），VPS 拉取 GitHub 详情并回写 |
| `/api/data-quality/issues/ignore` | POST | 登录态 | 批量忽略问题（`issueIds`） |
| `/api/data-quality/issues/restore` | POST | 登录态 | 批量恢复为待处理 |

VPS 内部接口（`X-Internal-Token`）：

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/data-quality/check-links` | POST | HEAD 校验 `html_url`，返回 `ok` / `broken` / `redirected` / `unknown` |
| `/api/data-quality/metadata` | POST | 按仓库 id 拉取 GitHub 详情，返回可回写的元数据 patch |

## 5. 问题规则

| 类型 | 触发条件 | 级别 | 修复 |
| --- | --- | --- | --- |
| `broken_link` | HEAD 404 / 410 | critical | 404 建议归档；重定向建议更新 URL |
| `duplicate` | M6-03 名称 / 地址聚类命中 | warning | 跳转重复检测页确认合并 |
| `missing_metadata:description` | 简介与 README 摘要均为空 | warning | GitHub 元数据补全 |
| `missing_metadata:language` | 语言为空 | info | GitHub 元数据补全 |
| `missing_metadata:license` | 从未做过 License 识别 | info | GitHub 元数据补全 |
| `missing_metadata:summary` | README 摘要为空 | info | 跳转摘要生成（不自动生成） |
| `missing_metadata:category` | 未分类 | info | 手动分类 |
| `stale_metadata` | 最近同步超过 90 天 | warning | GitHub 元数据补全 |

质量分：`100 - 8 × critical - 4 × warning - 1 × info`，下限 0。

## 6. 交付物

| 文件 | 说明 |
| --- | --- |
| `edge/migrations/0023_data_quality.sql` | 扫描 / 问题台账表 |
| `edge/src/data-quality/checks.ts` | 元数据检查、重复问题、链接结果合并、质量分纯函数 |
| `edge/src/routes/data-quality.ts` | 扫描 / 查询 / 补全 / 忽略 / 恢复路由 |
| `edge/src/index.ts` | 挂载 `/api/data-quality` |
| `edge/scripts/data-quality-helpers.test.mjs` | 纯函数用例 |
| `edge/scripts/data-quality-route.test.mjs` | 路由 / 鉴权 / 幂等 / 降级用例 |
| `vps/app/services/data_quality.py` | 链接检测、元数据 patch、镜像对账纯函数 |
| `vps/app/api/data_quality.py` | 内部接口 |
| `vps/app/data_quality.py` | CLI：`report` / `reconcile`（M1-16 最小对账） |
| `vps/tests/test_data_quality.py` | 离线用例（注入假 fetcher，不依赖网络） |
| `admin/src/features/data-quality/*` | API、工具函数、质量总览页、演示数据、Vitest |
| `admin/src/routes/_authenticated/data-quality/index.tsx` | 文件式路由 |
| `admin/src/components/layout/data/sidebar-data.ts` | 「开源资产」新增「数据质量」 |
| 文档 | 本计划、架构总览、数据模型、D1 schema、backlog、roadmap、task-planning、open-questions、README |

## 7. 验证计划

```bash
cd edge && npm run typecheck && npm test
cd vps && .venv/bin/pytest -q
cd admin && npm run lint && npm run build && npm run test
git diff --check
```

验收标准：

1. 登录用户访问 `/data-quality` 能看到质量分、问题分布、最近扫描与问题台账；
2. 扫描能检出缺失元数据、重复条目；VPS 可用时检出 404 / 重定向链接；
3. 「补全元数据」能把 GitHub 的简介 / 语言 / License / Star / URL 回写 D1，并关闭对应问题；
4. 忽略后问题不再出现在默认列表，恢复后重新出现；重复扫描幂等；
5. VPS 不可达时扫描仍可用（local 模式），页面有明确降级提示；
6. 三端检查全绿，文档同步。

## 8. 边界与风险

- 链接检测受 GitHub / Gitee 限流影响，单次最多检查 30 个仓库，失败标记 `unknown` 不误报；
- 元数据补全只写 GitHub 可提供的字段，不臆造简介 / 分类；
- 不自动删除重复仓库或失效仓库，只给建议，合并 / 归档仍由用户确认；
- M1-16 对账工具先提供 CLI + 纯函数，D1 快照由 edge 内部接口导出，不在 Worker 中做全量对比；
- 与 M9-03 / M9-04 并行开发时迁移编号取 `0023`，避免与数据导入的 `0022` 冲突。
