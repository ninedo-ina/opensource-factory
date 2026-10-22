# 实施计划 · REQ-202610-0958 主题聚类与自动标签

> 需求：REQ-202610-0958（backlog M6-11）｜ 分支：`feat/req-202610-0958-theme-clustering`
> 依赖：M3-02 向量化管线（`repo_vectors`）｜ 基线：`v1.0.0` @ `53ab76f`

## 1. 现状与缺口

- M3-02 已把收藏库与热榜编码为 `repo_vectors`（`source + repo_id` 联合主键），M3-04 已提供
  语义检索，但收藏库仍只能按分类 / 标签逐条浏览，没有「这批仓库自然聚成哪些主题」的视图；
- 标签依赖人工维护，新收藏的仓库往往没有标签，难以批量整理；
- 主题聚类是**只读计算 + 显式写标签**：聚类不落库，标签必须由用户确认后写入，避免自动改坏
  现有标签体系；
- VPS 本地镜像不承担多租户隔离，用户范围由 edge 按 D1 `user_id` 过滤后传入。

## 2. 方案总览

```
admin /themes（主题聚类页）
  → POST /api/themes/cluster（登录态）
      ↓ edge 读取 D1 my_repositories + repo_tags / tags（仅当前 user_id）
      ├─ 1. 调 VPS POST /api/themes/cluster（X-Internal-Token）
      │      → 读取 repo_vectors（source=my，仅传入的 repoIds）
      │      → 余弦相似度贪心聚类 + 簇合并
      │      → 关键词抽取 → 主题名 / 建议标签 / 凝聚度
      ├─ 2. 用 D1 仓库行二次水合，丢弃非当前用户 / 已删除仓库
      └─ 3. VPS 不可达时 edge 本地按语言 + 关键词兜底（mode=keyword）
  → POST /api/themes/apply（登录态）
      → 校验 tag 与 repoIds 均属于当前用户
      → upsert tags + repo_tags（幂等），返回实际新增数
```

设计原则：

1. **只读聚类、显式写标签**：聚类结果不新增表、不落库；标签写入需用户点击「应用」；
2. **账号隔离**：edge 先按 `user_id` 取仓库，VPS 只接收当前用户的 `repoIds`，返回后再过滤一次；
3. **纯函数可测**：聚类 / 关键词 / 标签规范化放在 `vps/app/services/theme_clustering.py` 与
   `edge/src/themes/helpers.ts`，测试不依赖网络与模型；
4. **优雅降级**：VPS 不可用 / 向量缺失时，edge 用语言 + 关键词规则给出保守主题，页面不空白；
5. **零迁移**：复用 `repo_vectors`（VPS）与 `tags` / `repo_tags`（D1），不新增表与列。

## 3. 接口契约

### 3.1 `POST /api/themes/cluster`（edge，需登录）

请求：

```json
{
  "minSimilarity": 0.55,
  "minClusterSize": 2,
  "maxClusters": 12
}
```

响应：

```json
{
  "mode": "vector",
  "generatedAt": "2026-10-22T11:30:00.000Z",
  "stats": {
    "totalRepos": 24,
    "clusteredRepos": 18,
    "themeCount": 4,
    "coverage": 75,
    "vectorized": 22,
    "model": "BAAI/bge-m3",
    "backend": "sentence-transformers"
  },
  "themes": [
    {
      "id": "theme-1a2b3c4d5e6f",
      "name": "AI / LLM",
      "keywords": ["ai", "llm", "agent"],
      "suggestedTags": ["ai", "llm"],
      "repoCount": 5,
      "cohesion": 0.81,
      "repos": [
        {
          "id": "owner/repo",
          "name": "repo",
          "description": "…",
          "summary": "…",
          "language": "TypeScript",
          "stars": 128,
          "tags": ["ai"]
        }
      ]
    }
  ],
  "unclustered": [{ "id": "owner/solo", "name": "solo", "reason": "singleton" }],
  "thresholds": { "minSimilarity": 0.55, "minClusterSize": 2, "maxClusters": 12 }
}
```

- `mode`：`vector`（VPS 向量聚类）/ `keyword`（edge 本地兜底）；
- `coverage`：已聚类仓库 / 当前用户仓库总数（0–100，一位小数）；
- `unclustered.reason`：`no_vector` / `singleton` / `dim_mismatch` / `overflow`；
- 未登录 `401 {error:"unauthorized"}`；0 仓库返回空主题与全 0 统计。

### 3.2 `POST /api/themes/apply`（edge，需登录）

```json
{ "tag": "ai", "repoIds": ["owner/repo"] }
```

- tag 归一化后 1–40 字符；repoIds 最多 200 条；
- 只写入当前用户仓库；`tags` 不存在则创建，`repo_tags` 幂等插入，`tags.count` 重算；
- 响应 `{ "tag": "ai", "applied": 3, "skipped": 0, "total": 3 }`。

### 3.3 `POST /api/themes/cluster`（VPS 内部接口，`X-Internal-Token`）

请求：`repoIds`（≤500）、`minSimilarity`、`minClusterSize`、`maxClusters`。
响应：`themes[]` / `unclustered[]` / `stats` / `thresholds` / `model` / `backend` / `dim` / `tookMs`。

## 4. 聚类与命名规则

- **向量筛选**：只使用 `source=my` 且 `repo_id` 在请求列表内的向量；维度不一致的条目进入
  `dim_mismatch`，不参与聚类；
- **贪心聚类**：按 Star 降序，逐条与已有簇质心计算余弦，≥ `minSimilarity` 归入最相似簇，
  否则新建簇；随后对簇质心做一次合并，吸收贪心顺序带来的碎片；
- **簇规模**：小于 `minClusterSize` 的簇进入 `singleton`；按仓库数、Star 总数排序后截断
  `maxClusters`，其余进入 `overflow`；
- **主题名**：簇内文档频率高、全局文档频率低的词（英文词 + 中文 bigram，过滤停用词）取前 2 个，
  以 ` / ` 连接；无关键词时用主语言 + 「项目」；
- **建议标签**：关键词规范化为小写、空格转 `-`、去控制字符，取前 3 个，排除簇内全部仓库已有的标签；
- **凝聚度**：簇成员与质心的平均余弦，保留 3 位小数。

## 5. 代码改动

| 位置 | 内容 |
| --- | --- |
| `vps/app/services/theme_clustering.py` | 分词 / 关键词 / 贪心聚类 / 簇合并 / 主题构建 |
| `vps/app/api/themes.py` | 内部聚类接口与参数归一化 |
| `vps/app/schemas.py` | 主题聚类请求 / 响应模型 |
| `vps/app/config.py` / `runtime.py` / `.env.example` / `deploy/env/openfactory.env.example` | `THEME_*` 配置 |
| `vps/tests/test_theme_clustering.py` | 分词、聚类、合并、命名、标签、空数据、API 契约 |
| `edge/src/themes/helpers.ts` | 参数归一化、本地兜底聚类、标签规范化、统计 |
| `edge/src/routes/themes.ts` | 聚类代理、D1 水合、应用标签 |
| `edge/src/index.ts` | 挂载 `/api/themes` |
| `edge/scripts/themes-helpers.test.mjs` | 纯函数测试 |
| `admin/src/features/themes/api.ts` | DTO、请求封装、演示数据 |
| `admin/src/features/themes/utils.ts` | 主题排序、覆盖率、标签展示辅助 |
| `admin/src/features/themes/index.tsx` | 页面：统计卡、主题卡、关键词、仓库列表、应用标签 |
| `admin/src/features/themes/themes.test.ts` | 工具函数与演示数据测试 |
| `admin/src/routes/_authenticated/themes/index.tsx` | 文件式路由 |
| `admin/src/components/layout/data/sidebar-data.ts` | 「开源资产」新增「主题聚类」 |
| 文档 | 架构总览、数据模型、backlog、roadmap、task-planning、open-questions、三端 README |

## 6. 测试与验收

| 层 | 用例 |
| --- | --- |
| vps 单元 | 分词停用词、关键词排序、贪心聚类、簇合并、minClusterSize、maxClusters、维度不一致、空向量、建议标签去重、API 契约 |
| edge 单元 | 参数夹取、本地语言 / 关键词聚类、标签规范化、统计、空数据 |
| admin 单元 | 主题排序、覆盖率、标签候选、演示数据 |
| 构建 | vps pytest 全量；edge `npm run typecheck` + `npm test`；admin `npm run lint` + `npm run build` + `npm run test` |

验收标准：

1. 登录用户访问 `/themes` 能看到主题卡、关键词、仓库列表与建议标签；
2. 聚类只包含当前用户仓库；未登录 401；VPS 不可用时仍能显示语言级主题；
3. 点击建议标签后，所选主题下仓库实际获得该标签，重复点击幂等；
4. 0 仓库 / 0 主题显示空状态；
5. 三端检查全绿，文档同步更新。

## 7. 风险与后续

- **向量覆盖率**：新收藏仓库在向量化任务完成前只能进入 `no_vector`，页面展示覆盖率提示；
- **主题命名**：关键词启发式可能生硬，后续可接 LLM 生成主题名（M7-01）；
- **阈值敏感**：不同嵌入模型相似度分布不同，`THEME_MIN_SIMILARITY` 可在 `.env` 调整；
- **标签污染**：默认只给建议，用户确认后写入；批量应用前在 UI 展示将影响的仓库数；
- **规模**：单用户 ≤500 仓库、≤12 主题，O(n²) 对比可接受；组织级账号需改为离线聚类任务。
