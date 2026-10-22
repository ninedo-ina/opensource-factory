# M9 验收与回顾 · 数据资产与洞察

> 需求：REQ-202610-0984（backlog M9-07）｜ 分支：`feat/req-202610-0984-m9-acceptance`
> 验收日期：2026-10-22 ｜ 原始报告：[acceptance-m9-report.md](./acceptance-m9-report.md) · [acceptance-m9-report.json](./acceptance-m9-report.json)

## 1. 结论

**M9-01~06 全部交付能力通过（16/16 PASS，0 FAIL，0 GAP），M9 里程碑达成。**

- 已集成并验收：M9-01 个人技术画像、M9-02 资产报表、M9-03 数据导入、M9-04 全量导出与归档、
  M9-05 数据质量治理、M9-06 数据保留与隐私策略；
- 本轮不再存在平台 `pending` 缺口；M9-06 分支在本轮开始前完成提交（`f6b1e90`），已一并集成；
- 真实 D1 迁移应用、Cron / Celery 定时触发与外部链接检测仍需部署后人工复核，见第 6 节。

三端检查全绿：**vps 563 passed** · **edge 290 passed + typecheck** · **admin 302 passed + lint + build**。

## 2. 验收范围与方法

验收分支基于 M8 验收 tip `4d061dd` 拉出，按依赖顺序 `--no-ff` 合并六个已交付分支：

| 顺序 | 需求 | 交付分支 tip | 合并提交 |
| ---: | --- | --- | --- |
| 1 | M9-01 个人技术画像（REQ-202610-0978） | `af36647` | `8f2c44b` |
| 2 | M9-02 资产报表（REQ-202610-0979） | `7207528` | `09b1234` |
| 3 | M9-03 数据导入（REQ-202610-0980） | `638e1b6` | `e9102cd` |
| 4 | M9-04 全量导出与归档（REQ-202610-0981） | `e68a12e` | `56dfa95` |
| 5 | M9-05 数据质量治理（REQ-202610-0982） | `f37170c` | `baf12d5` |
| 6 | M9-06 数据保留与隐私（REQ-202610-0983） | `f6b1e90` | `de5698b` |

方法：`vps/scripts/m9_acceptance.py` 做跨分支静态资产检查 + M9-05 纯函数实跑；
不访问网络、不依赖 Cloudflare / GitHub / VPS 凭据，可离线复跑。
判定口径：**PASS** 通过 · **FAIL** 行为错误 · **GAP** 未交付缺口（不计入通过率）。

## 3. 验收矩阵

| 编号 | 检查项 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| M9-A01 | M9-01 技术画像聚合纯函数 | PASS | `buildTechProfile` / `parseProfileDate` / `monthKey` / `shiftMonth`；语言 / 框架 / 趋势 / 活跃度 / 画像类型 / 洞察 |
| M9-A02 | M9-01 路由与 admin 页面 | PASS | `GET /api/tech-profile`、months 1..24、`user_id` 隔离、admin `/tech-profile` |
| M9-B01 | M9-02 资产报表聚合纯函数 | PASS | `buildAssetReport` / `normalizeMonths` / `starTrendDays`；收录量 / 分类 / 语言 / Star 趋势 / 覆盖率 / 洞察 |
| M9-B02 | M9-02 路由与 admin 页面 | PASS | `GET /api/asset-report`、`trending_snapshots` 白名单、admin `/asset-report` |
| M9-C01 | M9-03 三格式解析与预览计划 | PASS | JSON / CSV / 书签 HTML、URL 归一、去重、2 MB / 2000 条 / 20 标签上限 |
| M9-C02 | M9-03 导入接口与迁移 | PASS | `/preview` `/execute` `/history`、`import_runs`（迁移 `0023`）、admin `/import` |
| M9-D01 | M9-04 归档构建与校验和 | PASS | `openfactory.archive.v1`、ZIP / JSON、SHA-256、敏感表排除 |
| M9-D02 | M9-04 归档接口与 admin 页面 | PASS | `/summary` `/manifest` 下载、`Content-Disposition`、admin `/archive`、格式指南 |
| M9-E01 | M9-05 edge 扫描 / 补全 / 迁移 | PASS | 扫描 / 补全 / 忽略 / 恢复 / 内部镜像、迁移 `0024` |
| M9-E02 | M9-05 VPS 链接检测与对账 | PASS | `evaluate_response` / `normalize_url` / `reconcile_snapshot` 实跑、CLI、测试、admin `/data-quality` |
| M9-F01 | M9-06 edge 策略 / 导出 / 删除 / 清理 | PASS | `policy.ts` / `export.ts` / `cleanup.ts`、`privacy_events`（迁移 `0025`）、admin `/settings/privacy` |
| M9-F02 | M9-06 VPS 保留清理与测试 | PASS | `purge_user_data` / `cleanup_expired_data` / `retention_status`、API、测试 |
| M9-S01 | edge / admin 路由集成 | PASS | `/api/tech-profile`、`/api/asset-report`、`/api/import`、`/api/export`、`/api/data-quality`、`/api/privacy` 全部挂载；routeTree 六个页面齐全 |
| M9-S02 | M9 迁移编号唯一 | PASS | M9 迁移 `0023` / `0024` / `0025` 编号唯一，`0021` / `0022` 保持 |
| M9-S03 | 需求与验收文档状态 | PASS | backlog M9-01~07 全部完成，验收结论与计划文档齐全 |
| M9-06-GAP | M9-06 数据保留与隐私策略 | PASS | `feat/req-202610-0983-data-retention-privacy` 已合并进验收分支 |

## 4. 集成修复

1. **迁移编号冲突**：M9-03 原 `0022_data_import.sql`、M9-05 原 `0023_data_quality.sql`、
   M9-06 原 `0023_privacy_lifecycle.sql` 与既有 `0021` / `0022` 重号，依次顺延为
   `0023_data_import.sql` / `0024_data_quality.sql` / `0025_privacy_lifecycle.sql`，
   同步 `d1-schema.sql`、`data-model.md`、README 与各计划文档引用；
2. **迭代编号冲突**：六个分支均从旧基线拉出，M9-01~05 统一为 IT-0072~0076，
   M9-06 顺延为 IT-0077，本轮验收为 IT-0078；删除重复的 IT-0065 / IT-0072 行；
3. **问题编号冲突**：各分支重复使用 Q36 / Q37，统一顺延为 Q37 技术画像、Q38 导入冲突、
   Q39 归档加密、Q40 数据质量、Q41 保留期策略；
4. **文档章节冲突**：`overview.md` M9 章节统一为 3.36~3.41，`data-model.md` 为 3.27~3.29；
5. **路由生成物**：合并后 `admin/src/routeTree.gen.ts` 缺少 `/settings/privacy` 等路由，
   由 `vite build` 重新生成，未手改；
6. **文档并集**：`README` / `roadmap` / `backlog` / `task-planning` / `open-questions` /
   `edge/README` / `vps/README` 以 M8 验收后版本为基线，M9 内容统一补齐。

## 5. 缺口与再验收条件

本轮无 GAP。M9-06 在本轮开始前已完成提交并合并，因此 M9-01~06 全部纳入验收。
后续如新增 M9 范围需求，按同一脚本追加检查项并重新生成报告即可。

## 6. 仍需人工处理

- 在真实 Cloudflare D1 按序应用迁移 `0023` / `0024` / `0025`，确认无列冲突与数据回填问题；
- 部署后验证 Worker Cron `20 3 * * *`（UTC）与 Celery beat 每日 04:33（Asia/Shanghai）保留清理实际触发；
- 配置 `VPS_NODE_URL` 后验证 M9-05 外部链接检测与 GitHub 元数据补全的真实限流表现；
- 在浏览器走通 M9-06 个人数据导出、账号删除确认与 admin 隐私页展示；
- M9-03 导入大文件（接近 2 MB / 2000 条）与 M9-04 大账号归档的内存 / 响应体上限需在预发环境压测。

## 7. 回顾

**做得好的：**

- 六个分支全部纳入同一验收分支，验收脚本覆盖每个需求的纯函数、路由、迁移、页面与文档五类资产；
- 迁移编号、迭代编号、问题编号与章节编号在集成时一次性归一，避免后续需求继续撞号；
- PASS / FAIL / GAP 口径延续 M8，报告可离线复跑，不依赖任何外部凭据。

**暴露的问题：**

- 各分支从旧基线拉出，迁移号、IT 号、Q 号、章节号重复集中爆发，说明分支开工前缺少统一的号段分配；
- `routeTree.gen.ts` 与 `README` 等生成物 / 汇总文档在合并时反复冲突，人工解决成本高；
- M9-06 分支在验收开始时才完成提交，说明交付节奏与验收窗口需要更早对齐。

**改进项：**

- 需求分派时由平台或规划文档预分配迁移号段、IT 号段与 Q 号段；
- CI 增加迁移编号唯一性、routeTree 干净构建与文档链接检查；
- 验收脚本作为每个里程碑的固定交付物，后续需求直接追加检查项而不是另起脚本。

## 8. 复跑方式

```bash
cd vps
python scripts/m9_acceptance.py \
  --report-md docs/planning/acceptance-m9-report.md \
  --report-json docs/planning/acceptance-m9-report.json

# 严格模式：存在 GAP 或 FAIL 时返回非零
python scripts/m9_acceptance.py --strict
```

三端检查：

```bash
cd vps && .venv/bin/pytest -q
cd edge && npm run typecheck && npm test
cd admin && npm run lint && npm run build && npm test
```
