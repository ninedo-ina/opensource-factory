# 实施计划 · REQ-202610-0907 · M1 验收（端到端走查 + 性能抽样 + 文档同步）

> 文档编号：PL-REQ-0907 ｜ 维护人：fntp ｜ 创建日期：2026-10-22
>
> 关联需求：`docs/requirements/backlog.md` · M1-15（M1 · 资产同步闭环）｜ 依赖：M1-14

## 1. 目标与范围

把 M1 已完成的能力整合到一条可重复执行的验收分支，用真实 HTTP 请求完成端到端走查，抽样核对关键接口性能，并把结果、差距与复跑方式固化为文档。

范围：

- 验收对象：edge API（鉴权、仓库、分类、标签、仪表盘、热榜、推荐、同步任务）；
- 集成对象：M1 并行需求分支 0900（同步任务）、0901（分类树）、0902（标签）、0903（组合筛选）、0904（检索优化）；
- 不在本轮范围：真实 GitHub OAuth / Cloudflare D1 / VPS 生产部署（依赖人工凭据），以及 0905（README 摘要）、0906（admin 真实接口）的整分支合并（见 §5 风险）。

## 2. 实施步骤

1. 从 `origin/feat/req-202610-0746-writeback`（9e6c105）拉出 `feat/req-202610-0907-m1-acceptance` 工作树；
2. 新增 `edge/scripts/m1-acceptance.mjs`：自动应用本地 D1 迁移、种入 1200 仓库固定数据集、启动 wrangler dev 与 mock VPS，按 M1-A/B/C/D/E/F/P 分组执行断言；
3. 逐个集成 0900~0904 的 edge / admin 改动，迁移文件统一重编号（0002~0006），解决 `repos.ts`、`types.ts`、`index.ts` 等交汇文件冲突；
4. 为 M1-11 增加组合筛选 + 排序 + 分页断言，为 M1-12 保留 P95 预算断言（< 300ms）；
5. 跑三端检查：admin lint / build / test，edge typecheck / 脚本测试 / 分类 E2E / 检索基准 / M1 验收，vps pytest；
6. 生成验收报告，更新任务计划、需求池、开发周期、路线图与数据模型文档。

## 3. 验收矩阵

| 编号 | 验收点 | 覆盖方式 |
| --- | --- | --- |
| M1-02 | 本地 D1 迁移 | 迁移 0001~0006 全量应用 |
| M1-04 | 会话登出 | `/api/auth/logout` 204 → `/me` 401 |
| M1-08 | 同步任务状态 | mock VPS `/api/tasks/sync` + `/api/tasks` 查询 |
| M1-09 | 分类树 CRUD | 树字段 + 新建 / 编辑 / 删除 + 分类 E2E 13 项 |
| M1-10 | 标签体系 | 新建 / 列表 / 计数触发器 |
| M1-11 | 组合筛选排序 | 关键词 + 分类 + 语言 + stars 升序 + limit |
| M1-12 | 检索性能 | 索引命中 + P95 < 300ms（20k 行基准与验收抽样） |
| M1-15 | 验收交付 | 本计划 + 验收报告 + 文档同步 |

M1-01/03/05/06/07/13/14/16 的覆盖状态与原因见 `acceptance-m1.md` §3。

## 4. 交付物

- `edge/scripts/m1-acceptance.mjs`（可重复执行的验收脚本，支持 `--strict`、`--report-md`、`--report-json`）；
- `docs/planning/acceptance-m1.md`（验收结论与矩阵）；
- `docs/planning/acceptance-m1-report.md`（脚本生成的原始报告）；
- 三端代码集成与迁移（0002_sync_tasks、0003_category_tree_index、0004_search_indexes、0005_tag_count_triggers、0006_repo_filter_indexes）；
- 文档同步：data-model / d1-schema / task-planning / backlog / dev-cycle / roadmap / docs README。

## 5. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 并行分支迁移编号冲突 | 按合并顺序重编号为 0002~0006，索引重名项去重 |
| 0903 与 0904 同时改 `repos.ts` | 以 0903 查询构建器为骨架，保留 0904 的列裁剪、limit/offset 与 LIKE 转义 |
| 0906 admin 真实接口与 0900~0903 admin 改动大面积冲突 | 不整分支合并；在验收报告中记录其分支自测结果，留待后续统一联调 |
| 真实外部凭据缺失 | 用本地 D1 + mock VPS 覆盖链路；真实 OAuth / GitHub 同步标记为 SKIP 并列入遗留 |
