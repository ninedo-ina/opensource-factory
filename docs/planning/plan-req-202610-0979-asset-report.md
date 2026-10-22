# 实施计划 · REQ-202610-0979 资产报表（收录量 / 分类分布 / Star 趋势）

> 需求：REQ-202610-0979（backlog M9-02）｜ 分支：`feat/req-202610-0979-asset-report`
> 依赖：M9-01 个人技术画像（并行开发）；本需求只读取既有 `my_repositories` / `categories` /
> `trending_snapshots`，不依赖 M9-01 的代码，可独立交付。
> 基线：`0641ef5`（M8 集成分支，含 M6-04 技术栈图谱与 M7-05 Star 趋势）

## 1. 现状与缺口

- 仪表盘只有「收录总数 / 今日热榜 / 待读推荐 / 分类数」四个数字，没有可回溯的资产报表；
- 技术栈图谱回答「语言 / 框架结构」，Star 趋势页回答「热榜仓库的每日增长」，但都没有回答
  「我的收藏按月怎么增长」「分类分布是否失衡」「我的全部资产 Star 存量如何变化」；
- `my_repositories` 已有 `created_at` / `stars` / `category_id` / `platform` / `language`，
  `categories` 有分类名，`trending_snapshots` 可为收藏仓库提供真实 Star 历史；
- 结论：**不需要新增表 / 迁移**，只需一个只读聚合接口与一张报表页面。

## 2. 方案总览

```
admin /asset-report
  → GET /api/asset-report?months=12（登录态）
    → edge 读取当前用户数据：
       ├─ my_repositories（id / platform / stars / forks / language /
       │                    category_id / created_at / pushed_at / archived）
       ├─ categories（分类名映射）
       └─ trending_snapshots（收藏仓库近 N 天 Star 快照，按 repo_id 分片）
    → 纯函数 buildAssetReport：
       ├─ summary：收录量 / Star / Fork / 分类覆盖 / 语言数 / 近 7·30·90·365 天新增
       ├─ volume：按收录月份的新增、累计仓库、新增 Star、累计 Star、平台构成、峰值月
       ├─ categories：分类分布（含「未分类」）、占比、Star、平均 Star、主要语言
       ├─ languages：语言分布（复用 M6-04 normalizeLanguage 口径）
       ├─ starTrend：复用 M7-05 buildStarTrends（scope=my）得到真实快照趋势与覆盖率
       └─ insights：确定性文案（增长 / 分类集中度 / 未分类 / Star 集中度 / 快照覆盖）
  → admin 渲染 KPI 卡、收录量柱线图、分类分布条形榜、Star 趋势面积图、
    分类明细表、Top Movers、洞察列表；支持 6 / 12 / 24 个月窗口与 CSV 导出
```

设计原则：

1. **只读聚合、不新增表 / 迁移**：全部来自既有 D1 表，避免迁移编号治理冲突；
2. **用户隔离**：所有 SQL 带 `user_id = ?`；分类与快照均通过当前用户仓库关联；
3. **真实与估算分离**：`starTrend` 只展示有快照的仓库（不补零、不伪造），
   `volume.cumulativeStars` 明确标注为「按收录月份的当前 Star 存量」；
4. **纯函数可测**：聚合、月份窗口、分类分组、洞察全部在 `edge/src/asset-report/aggregate.ts`；
5. **口径复用**：语言归一复用 `tech-stack/aggregate.ts`，Star 趋势复用 `insights/star-trends.ts`，
   保证与 M6-04 / M7-05 页面数字一致；
6. **空态友好**：没有收藏时返回结构化空态，页面展示引导而不是空白。

## 3. 接口契约

### 3.1 `GET /api/asset-report`（登录态）

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `months` | 6 / 12 / 24 | 12 | 收录量窗口（含当前月向前 N 个月）；非法值回退 12 |

未登录返回 `401 {error:"unauthorized"}`。

响应字段：

| 字段 | 说明 |
| --- | --- |
| `period.months` / `startDate` / `endDate` | 报表窗口（UTC 月份边界） |
| `summary.totalRepos` / `totalStars` / `totalForks` / `avgStars` | 收录总量与 Star / Fork 汇总 |
| `summary.categoryCount` / `categorizedRepos` / `uncategorizedRepos` / `categoryCoverage` | 分类覆盖 |
| `summary.languageCount` / `withLanguage` / `platformCount` | 语言与平台覆盖 |
| `summary.addedLast7d` / `addedLast30d` / `addedLast90d` / `addedLast365d` | 近期新增 |
| `summary.growthRate30d` | 近 30 天新增 ÷ 30 天前存量（0–100，一位小数） |
| `summary.topCategory` / `topLanguage` / `topPlatform` | 最大分类 / 语言 / 平台 |
| `summary.starTrendCoverage` | 有 Star 快照的收藏占比（0–100） |
| `volume.months[]` | `month` / `added` / `cumulative` / `starsAdded` / `cumulativeStars` |
| `volume.recent` | 与 summary 的近期新增一致，便于图表直接消费 |
| `volume.peakMonth` | `month` / `added`（无数据为 null） |
| `volume.platforms[]` | `platform` / `label` / `repoCount` / `share` |
| `categories[]` | `id` / `name` / `repoCount` / `starCount` / `share` / `avgStars` / `topLanguage` |
| `languages[]` | `name` / `repoCount` / `starCount` / `share` |
| `starTrend.available` | 是否有可用快照 |
| `starTrend.period` / `summary` / `series` / `topMovers` / `languages` | 复用 M7-05 `buildStarTrends(scope=my)` 结构 |
| `insights[]` | `kind` / `title` / `description`，最多 5 条 |
| `generatedAt` | ISO 时间 |

## 4. 文件清单

- 新增 `edge/src/asset-report/aggregate.ts`（纯函数聚合）
- 新增 `edge/src/routes/asset-report.ts`（登录态只读路由）
- 修改 `edge/src/index.ts`（挂载 `/api/asset-report`）
- 新增 `edge/scripts/asset-report.test.mjs`（聚合 + 路由测试）
- 新增 `admin/src/features/asset-report/api.ts`（DTO / 演示数据 / 请求封装）
- 新增 `admin/src/features/asset-report/utils.ts`（格式化、图表几何、CSV 导出）
- 新增 `admin/src/features/asset-report/components/volume-chart.tsx`
- 新增 `admin/src/features/asset-report/components/star-chart.tsx`
- 新增 `admin/src/features/asset-report/index.tsx`（报表页）
- 新增 `admin/src/features/asset-report/asset-report.test.ts`
- 新增 `admin/src/routes/_authenticated/asset-report/index.tsx`
- 修改 `admin/src/components/layout/data/sidebar-data.ts`（开源资产 → 资产报表）
- 文档：本计划、`docs/README.md`、`docs/architecture/overview.md`、`docs/requirements/backlog.md`、
  `docs/planning/roadmap.md`、`docs/planning/task-planning.md`、`admin/README.md`、`edge/README.md`

## 5. 验证计划

```bash
cd edge && npm run typecheck && npm test
cd admin && npm run lint && npm run build && npm run test
cd vps && .venv/bin/pytest -q
git diff --check
```

## 6. 边界

- 本需求**不新增 D1 表 / 迁移、不改 VPS**；只做 edge 只读聚合与 admin 报表页；
- Star 趋势沿用 M7-05 的快照口径：只有上过热榜的收藏仓库有历史，页面明确展示覆盖率；
- 收录量趋势按 UTC 自然月统计，与精选报告的周期口径保持一致（见 Q32）；
- 报表导出为浏览器端 CSV（收录量 / 分类分布两张表），不新增服务端导出接口。

## 7. 交付结果（2026-10-22）

- 新增 `GET /api/asset-report`（登录态，`months=6|12|24`，只读 D1 聚合）；
- 新增 admin `/asset-report` 页面：KPI、收录量柱线图、分类分布、Star 快照趋势、分类明细、
  Top Movers、洞察与 CSV 导出；
- 复用 M6-04 语言归一与 M7-05 Star 趋势聚合，无新增表 / 迁移；
- 测试与文档同步结果见验收报告。
