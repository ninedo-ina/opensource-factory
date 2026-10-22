# 实施计划 · REQ-202610-0978 个人技术画像（语言 / 框架分布、活跃度）

> 需求：REQ-202610-0978（backlog M9-01）｜ 分支：`feat/req-202610-0978-tech-profile`
> 依赖：M1-05 Starred 全量同步（已落地，`my_repositories` 具备 `language` / `stars` / `created_at` / `pushed_at`）
> 基线：`0641ef5`（M8 集成分支，含 M6-04 技术栈图谱与 M7 全部洞察能力）

## 1. 现状与缺口

- M6-04 技术栈图谱已提供语言 / 框架聚合与语言 × 框架关系图，但定位是「技术栈结构」，
  不回答「我的收藏活跃度如何」「我更像单栈深耕还是多语言探索」「最近半年收藏节奏怎样」；
- 仪表盘只有收藏总数与待办数量，没有个人维度的画像视图；
- M7-05 Star 趋势只覆盖上过热榜的仓库，无法反映全部收藏的活跃度；
- 现有数据已足够：`my_repositories` 有语言、Star、Fork、`created_at`、`pushed_at`、健康度与分类，
  `repo_tags` / `tags` 可用于框架识别，**不需要新增表或迁移**。

## 2. 方案总览

```
admin /tech-profile
  → GET /api/tech-profile?months=12（登录态）
    → edge 读取当前用户数据：
       ├─ my_repositories（id / name / language / stars / forks / description /
       │                    readme_summary / created_at / pushed_at / health_status / category）
       ├─ categories（分类名映射）
       └─ repo_tags JOIN tags（框架识别输入）
    → 纯函数 buildTechProfile：
       ├─ summary：收藏 / Star / Fork / 语言 / 框架 / 分类 / 活跃仓库 / 活跃度分 / 画像类型
       ├─ languages：仓库数、Star、占比、平均 Star
       ├─ frameworks：仓库数、Star、占比、关联语言、分类
       ├─ activity：近 N 月收藏趋势（新增 / 累计）、7/30/90/365 天新增、
       │             pushed_at 活跃分桶、活跃仓库占比、连续活跃月、峰值月
       ├─ topRepos：Star Top 5（语言 / 健康度 / 最近推送）
       └─ insights：确定性文案（主导语言 / 框架偏好 / 收藏节奏 / 活跃度提醒）
  → admin 渲染画像卡、统计卡、语言分布条、框架分布、收藏趋势柱状图、
    活跃度分桶、Top 仓库表与洞察列表
```

设计原则：

1. **只读聚合、不新增表 / 迁移**：全部来自既有 D1 表，避免与迁移编号治理冲突；
2. **用户隔离**：所有 SQL 带 `user_id = ?`，分类与标签查询均通过当前用户仓库关联；
3. **复用 M6-04 口径**：语言归一与框架识别直接复用 `tech-stack/aggregate.ts` 的
   `normalizeLanguage` / `matchFrameworks`，保证「技术栈图谱」与「技术画像」数字一致；
4. **纯函数可测**：聚合、活跃度评分、画像类型、洞察全部在 `edge/src/tech-profile/aggregate.ts`，
   不依赖 D1 / 网络，node:test 直接覆盖；
5. **确定性洞察**：不依赖 LLM，文案由实际数据生成，测试可稳定断言；
6. **空态友好**：没有收藏时返回结构化空态，admin 展示引导而不是空白页。

## 3. 接口契约

### 3.1 `GET /api/tech-profile`（登录态）

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `months` | 1–24 | 12 | 收藏趋势窗口（含当前月向前 N 个月） |

未登录返回 `401 {error:"unauthorized"}`；`months` 非法时回退 12。

响应：

| 字段 | 说明 |
| --- | --- |
| `summary.totalRepos` / `totalStars` / `totalForks` | 收藏总数 / Star 合计 / Fork 合计 |
| `summary.languageCount` / `frameworkCount` / `categoryCount` | 语言 / 框架 / 分类数量 |
| `summary.withLanguage` / `withFramework` | 有语言 / 识别出框架的仓库数 |
| `summary.activeRepos` / `staleRepos` / `archivedRepos` | 90 天内推送 / 超过 180 天未推送 / 归档仓库数 |
| `summary.activeRatio` | 活跃仓库占比（0–100，一位小数） |
| `summary.activityScore` | 活跃度分（0–100 整数，口径见 §3.2） |
| `summary.activityLevel` | `high` / `medium` / `low` |
| `summary.profileType` | 画像类型：`多语言探索者` / `单栈深耕者` / `全栈实践者` / `均衡开发者` |
| `summary.topLanguage` / `topFramework` | 仓库数最多的语言 / 框架（并列按 Star、名称稳定排序） |
| `languages[]` | `name` / `repoCount` / `starCount` / `share` / `avgStars` |
| `frameworks[]` | `name` / `category` / `repoCount` / `starCount` / `share` / `languages[]` |
| `categories[]` | `name` / `repoCount` / `share`（未分类归入「未分类」） |
| `activity.periodMonths` | 趋势窗口月数 |
| `activity.months[]` | `month`（YYYY-MM）/ `added` / `cumulative` |
| `activity.recent` | `last7d` / `last30d` / `last90d` / `last365d` 新增收藏数 |
| `activity.pushBuckets[]` | `key`（`7d`/`30d`/`90d`/`180d`/`365d`/`older`/`unknown`）/ `label` / `repoCount` / `share` |
| `activity.activeRatio` | 90 天内推送仓库占比（0–100） |
| `activity.peakMonth` | `month` / `added`（无数据为 null） |
| `activity.streakMonths` | 截至当前月（或上一个有新增的月）连续有新增收藏的月数 |
| `activity.firstCollectedAt` / `latestCollectedAt` | 最早 / 最近入库时间（ISO，缺失为 null） |
| `topRepos[]` | `id` / `name` / `url` / `language` / `stars` / `forks` / `pushedAt` / `healthStatus` |
| `insights[]` | `kind`（`language` / `framework` / `activity` / `rhythm` / `diversity`）/ `title` / `description` |
| `generatedAt` | ISO 时间戳 |

### 3.2 活跃度口径

- **活跃仓库**：`pushed_at` 距生成时间 ≤ 90 天；**沉寂仓库**：> 180 天；`archived = 1` 单列；
- **活跃度分** = 活跃仓库占比 × 50% + 近 90 天新增收藏占比 × 30% + 近 6 个月有新增收藏的月份占比 × 20%，
  四舍五入为 0–100 整数；`>= 70` 为 `high`，`>= 40` 为 `medium`，否则 `low`；
- **画像类型**：
  - 语言数 ≥ 6 且第一语言占比 < 40% → `多语言探索者`；
  - 第一语言占比 ≥ 60% → `单栈深耕者`；
  - 框架数 ≥ 6 且第一框架占比 < 30% → `全栈实践者`；
  - 其余 → `均衡开发者`；
- **收藏趋势**：按 `created_at` 的 UTC 月份聚合，窗口内补零，`cumulative` 为窗口起点前的累计 + 当月新增；
- **连续活跃月**：从当前月开始向前数，遇到第一个无新增的月停止；当前月无新增时从上一个有新增的月开始计。

## 4. 页面

`/tech-profile`（侧边栏「开源资产 → 技术画像」）：

- 画像卡：画像类型、活跃度分与等级、一句话摘要；
- 统计卡：收藏总数 / Star 合计 / 语言数 / 框架数 / 活跃仓库占比；
- 语言分布条（Top 8 + 其他折叠）与框架卡片（分类、关联语言、仓库数）；
- 收藏趋势柱状图（近 12 个月，新增 / 累计）；
- 活跃度分桶（7 天 / 30 天 / 90 天 / 180 天 / 一年内 / 更早 / 未知）与最近新增统计；
- Top 收藏表（Star 排序）与确定性洞察列表；
- 空态：无收藏时展示「先去同步收藏」引导与演示数据兜底（仅演示模式）。

## 5. 文件清单

| 文件 | 说明 |
| --- | --- |
| `edge/src/tech-profile/aggregate.ts` | 语言 / 框架 / 活跃度 / 趋势 / 洞察纯函数 |
| `edge/src/routes/tech-profile.ts` | 登录态 `GET /api/tech-profile`，D1 只读查询 |
| `edge/src/index.ts` | 挂载 `/api/tech-profile` |
| `edge/scripts/tech-profile-helpers.test.mjs` | 聚合、活跃度、空态、排序与洞察用例 |
| `admin/src/features/tech-profile/api.ts` | DTO、演示数据、请求封装（`fetchWithFallback`） |
| `admin/src/features/tech-profile/utils.ts` | 格式化、语言折叠、趋势 / 分桶展示辅助 |
| `admin/src/features/tech-profile/index.tsx` | 技术画像页面 |
| `admin/src/features/tech-profile/tech-profile.test.ts` | 工具函数与演示数据用例 |
| `admin/src/routes/_authenticated/tech-profile/index.tsx` | 文件式路由 |
| `admin/src/components/layout/data/sidebar-data.ts` | 「开源资产 → 技术画像」入口 |
| `docs/planning/plan-req-202610-0978-tech-profile.md` | 本计划 |
| `docs/architecture/overview.md` | 3.35 技术画像流 + 接口边界 |
| `docs/requirements/backlog.md`、`docs/planning/roadmap.md`、`docs/planning/task-planning.md` | 需求 / 路线图 / 迭代状态 |
| `docs/requirements/open-questions.md` | Q36 收藏时间口径 |
| `docs/README.md`、`admin/README.md`、`edge/README.md` | 文档索引与接口说明 |

## 6. 测试与验收

| 层 | 用例 |
| --- | --- |
| edge 单元 | 空收藏、语言 / 框架聚合、占比与平均 Star、活跃度分档、画像类型、趋势补零 / 累计、推送分桶、连续活跃月、Top 仓库排序、洞察文案 |
| edge 类型 | `npm run typecheck` 0 error；`npm test` 全量通过 |
| admin 单元 | 数字 / 百分比 / 月份格式化、语言折叠、趋势最大值、分桶标签、演示数据完整性 |
| admin 构建 | `npm run lint` + `npm run build`（重新生成 `routeTree.gen.ts`）+ `npm run test` |
| 回归 | `vps pytest -q`（无 VPS 改动，确认基线不回归） |

验收标准：

1. 登录用户访问 `/tech-profile` 能看到画像类型、活跃度分、语言 / 框架分布与收藏趋势；
2. 没有收藏时页面展示空态引导，不出现空白页或报错；
3. 语言 / 框架口径与 `/tech-stack` 一致（同一批仓库数字可对齐）；
4. 所有查询只包含当前用户数据；未登录接口 401；
5. 三端检查全绿，文档同步更新。

## 7. 边界与待确认

- 本需求**不新增 D1 表 / 迁移、不改 VPS、不实现 M9-02 资产报表**；
- `created_at` 是 D1 入库时间，不是 GitHub 的 `starred_at`；首次全量同步会让趋势集中在同一个月，
  真实收藏时间需后续在同步链路补字段（登记 Q36）；
- 框架识别沿用 M6-04 的启发式词表，长尾框架可能漏识别，页面以「识别覆盖率」提示；
- 活跃度分是产品口径而非能力评价，权重集中在 `aggregate.ts` 常量，可调整并复跑。

## 8. 实施结果（2026-10-22）

- **edge**：新增 `src/tech-profile/aggregate.ts`（纯函数聚合，复用 M6-04 `normalizeLanguage` /
  `matchFrameworks` 与 `FRAMEWORK_CATALOG`）、`src/routes/tech-profile.ts`（登录态 D1 只读查询）、
  `GET /api/tech-profile` 挂载与 `scripts/tech-profile-helpers.test.mjs`（9 个 node:test 用例）；
- **admin**：新增 `features/tech-profile/{api,utils,index}.tsx` 与单测、路由
  `routes/_authenticated/tech-profile/index.tsx`、侧边栏「技术画像」入口；
  页面含 KPI、画像 / 活跃度卡、语言 / 框架 / 分类分布、月度收藏柱状图、推送分桶、Top 仓库与洞察；
- **数据**：无新表 / 迁移，仅读 `my_repositories`、`categories`、`repo_tags`、`tags`；
- **测试**：edge typecheck 通过、`npm test` 224/224；admin lint / build 通过、`npm run test`
  37 文件 259/259；vps `pytest -q` 549/549（基线回归）；
- **文档**：overview 3.35 + 接口表、backlog M9-01、roadmap、task-planning IT-0065、Q36、
  admin / edge README 已同步。
