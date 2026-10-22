# M1 验收报告 · 端到端走查 + 性能抽样 + 文档同步

> 需求：REQ-202610-0907（M1-15）｜ 验收日期：2026-10-22
>
> 验收分支：`feat/req-202610-0907-m1-acceptance`（基于 `feat/req-202610-0746-writeback` @ `9e6c105`）
>
> 工作树：`/opt/workspace/opensource-factory-req0907`
>
> 原始报告：[acceptance-m1-report.md](./acceptance-m1-report.md) · [acceptance-m1-report.json](./acceptance-m1-report.json)

## 1. 结论

本轮在本地 D1 + mock VPS 环境完成 M1 主链路端到端走查：**20 项断言全部 PASS，0 GAP，0 FAIL，0 SKIP**；四类关键查询 P95 均低于 300ms 预算（最高 47.3ms）。M1-09/10/11/12 与 M1-08 的核心链路已在验收分支上实际运行通过。

真实 GitHub OAuth、Cloudflare D1、VPS 生产部署仍依赖人工凭据，未在本轮覆盖；M1-13（README 摘要）与 M1-14（admin 真实接口）已在各自需求分支完成并通过分支测试，但未合入本验收分支，详见 §3。

## 2. 验收环境与方法

- 数据集：1 个测试用户 / 5 个分类 / 5 个标签 / 1200 个仓库 / 25 条热榜 / 10 条推荐；
- 运行时：`wrangler dev`（本地 D1，迁移 0001~0006 全量应用）+ Node 内置 HTTP mock VPS；
- 请求方式：真实 HTTP，携带种子会话 Cookie；性能抽样在预热后顺序执行 200 次，统计 P50 / P95 / Max；
- 通过标准：`--strict` 模式下 GAP 也视为失败；性能预算 P95 < 300ms。

## 3. M1 验收矩阵

| 编号 | 验收点 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| M1-01 | 本机运行环境与部署基线 | ⏭️ SKIP | 仓库暂无 deploy/systemd 基线；本机运行环境不在本轮代码验收范围 |
| M1-02 | D1 创建与迁移应用 | ✅ PASS | 本地 D1 依次应用 0001~0006 全部成功；远端 D1 待 Cloudflare 凭据（Q3） |
| M1-03 | GitHub OAuth 登录全链路 | ⏭️ SKIP | 需要真实 OAuth App 凭据；本地以种子会话验证登录态与 401 分支 |
| M1-04 | 会话安全加固 / 登出 | ✅ PASS | `/api/auth/logout` 204，随后 `/api/auth/me` 401 |
| M1-05 | Starred 全量同步 | ⏭️ SKIP | VPS `github_service` 基线存在；真实 GitHub 分页 / 限流需凭据，未做线上联调 |
| M1-06 | 自有 / 组织仓库同步 | ⏭️ SKIP | 同上，过滤策略未做真实账号验证 |
| M1-07 | 增量同步策略 | ⏭️ SKIP | 同上，需真实 `pushed_at` / star 数据验证 |
| M1-08 | 同步任务状态回传与可视化 | ✅ PASS | mock VPS 入队返回 taskId；`GET /api/tasks` 返回 success；admin 任务页已集成 |
| M1-09 | 分类树 CRUD | ✅ PASS | 树字段完整；新建 / 编辑 / 删除通过；分类 E2E 13 项全过 |
| M1-10 | 标签体系 CRUD | ✅ PASS | 新建 / 列表通过；`repo_tags` 触发器维护 `tags.count` |
| M1-11 | 组合筛选与排序 | ✅ PASS | 关键词 + 分类（含子分类）+ 语言 + stars 升序 + limit=20 全部生效 |
| M1-12 | 秒级检索优化 | ✅ PASS | 20k 行基准：P95 0.44~1.71ms；验收抽样 P95 38.9~47.3ms，均 < 300ms |
| M1-13 | README 摘要接入同步流程 | ⚠️ PARTIAL | 分支 `feat/req-202610-0905-readme-summary-sync` @ `da7321c`；`tests/test_summary_pipeline.py` 8 passed；未合入验收分支 |
| M1-14 | admin 关闭演示模式 / 真实接口 | ⚠️ PARTIAL | 分支 `feat/req-202610-0906-admin-real-api` @ `cf6f393`；admin 12 文件 / 87 用例通过；未合入验收分支 |
| M1-15 | M1 验收与文档同步 | ✅ PASS | 本报告 + 计划 + 脚本 + 数据模型 / Schema / 任务计划 / 需求池 / 周期 / 路线图同步 |
| M1-16 | 数据一致性巡检 | ❌ GAP | 尚无对账工具实现（0908 分支未产出代码） |

## 4. 端到端走查明细（20 项）

| 分组 | 断言 | 结果 |
| --- | --- | --- |
| A 鉴权 | `/healthz`、未登录 401、种子会话登录态 | 3 PASS |
| B 仓库 | 列表、默认分页 ≤200、limit=5、关键字、分类、LIKE 转义、组合筛选排序分页 | 7 PASS |
| C 分类 / 标签 | 树字段、分类 CRUD、标签 CRUD | 3 PASS |
| D 仪表盘 / 热榜 / 推荐 | 统计、热榜 20 条、推荐 10 条 | 3 PASS |
| E 同步 | `/api/sync` → mock VPS、`/api/tasks` 状态 | 2 PASS |
| F 会话 | 登出 204 → 401 | 1 PASS |
| P 性能 | 四类查询 P95 < 300ms | 1 PASS |

## 5. 性能抽样

| 场景 | P50 | P95 | Max | 预算 |
| --- | ---: | ---: | ---: | ---: |
| 仓库列表 limit=100 | 31.5ms | 39.0ms | 50.7ms | < 300ms |
| 关键字检索 q=支付 | 31.8ms | 38.9ms | 47.8ms | < 300ms |
| 分类筛选 cat-pay | 32.6ms | 40.1ms | 51.0ms | < 300ms |
| 仪表盘统计 | 35.4ms | 47.3ms | 68.1ms | < 300ms |

补充：`npm run perf:search` 在 20000 仓库 / 50 用户数据集上验证索引命中（无临时排序），P95 0.44~1.71ms。

## 6. 集成分支与提交

| 需求 | 分支 | 提交 | 集成内容 |
| --- | --- | --- | --- |
| M1-08 | `feat/req-202610-0900-sync-task-status` | `188402f` | sync_tasks 表、edge `/api/tasks`、admin 任务页 |
| M1-09 | `feat/req-202610-0901-category-tree` | `24cc826` | 分类树 CRUD、移动 / 环检测、admin 分类页 |
| M1-10 | `feat/req-202610-0902-tags-crud` | `7d5293c` | 标签 CRUD / 合并 / 计数触发器、admin 标签页 |
| M1-11 | `feat/req-202610-0903-repo-filter-sort` | `f76d2ea` | 组合筛选 / 排序查询构建器、admin 筛选栏 |
| M1-12 | `feat/req-202610-0904-search-perf` | `80fb325` | 复合索引、limit/offset、LIKE 转义、检索基准 |

迁移编号在集成时统一为：`0002_sync_tasks`、`0003_category_tree_index`、`0004_search_indexes`、`0005_tag_count_triggers`、`0006_repo_filter_indexes`；0903 与 0904 重名的索引已去重。

## 7. 检查结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| admin lint | `cd admin && npm run lint` | ✅ 0 error |
| admin build | `cd admin && npm run build` | ✅ tsc + vite 通过 |
| admin test | `cd admin && npm run test` | ✅ 14 文件 / 105 用例 |
| edge typecheck | `cd edge && npm run typecheck` | ✅ 0 error |
| edge 脚本测试 | `cd edge && npm run test:scripts` | ✅ 23 用例 |
| 分类 E2E | `cd edge && npm run test:categories` | ✅ 13 项 |
| 检索基准 | `cd edge && npm run perf:search` | ✅ 索引命中，P95 在预算内 |
| M1 验收 | `cd edge && npm run test:m1 -- --strict` | ✅ 20 PASS / 0 GAP / 0 FAIL |
| vps pytest | `cd vps && .venv/bin/pytest -q` | ✅ 24 passed |

## 8. 复跑方式

```bash
cd edge
npm run test:m1 -- --strict \
  --report-md docs/planning/acceptance-m1-report.md \
  --report-json docs/planning/acceptance-m1-report.json
```

脚本自动选择空闲端口、创建临时 D1 目录并在结束时清理；`--keep` 可保留 D1 目录用于排查。

## 9. 遗留与后续

1. **真实凭据联调**：GitHub OAuth（M1-03）、Cloudflare D1（M1-02 远端）、VPS 生产部署（M1-01/05~07）需人工提供凭据后补做；
2. **M1-13 合入**：0905 分支的摘要流水线需与 0900~0904 的 VPS 改动统一合并后再跑全量 pytest；
3. **M1-14 合入**：0906 分支的 admin 真实接口改造与 0900~0903 admin 页面存在交叉，建议单独迭代统一联调；
4. **M1-16**：数据一致性巡检工具尚未实现，建议在真实 D1 可用后立项。
