# 实施计划 · REQ-202610-0984 M9 验收与回顾

> 需求：REQ-202610-0984（backlog M9-07）｜ 分支：`feat/req-202610-0984-m9-acceptance`
> 依赖：M9-01~06；本轮实际可集成的已交付分支为 M9-01~04
> 目标：把 M9「数据资产与洞察」已交付能力按依赖顺序集成到一条验收分支，产出可复跑的验收脚本、
> 验收报告与缺口登记，并同步项目文档；不虚报未交付能力。

## 1. 现状与范围

| 需求 | 交付状态 | 验收方式 |
| --- | --- | --- |
| M9-01 个人技术画像（REQ-202610-0978） | 分支 `af36647` 已交付 | 聚合纯函数 / 路由 / admin 页面 / 测试静态检查 |
| M9-02 资产报表（REQ-202610-0979） | 分支 `7207528` 已交付 | 聚合口径 / Star 快照 / 路由 / admin 报表页检查 |
| M9-03 数据导入（REQ-202610-0980） | 分支 `638e1b6` 已交付 | 三格式解析 / 预览-执行-历史接口 / 迁移 / admin 页面检查 |
| M9-04 全量导出与归档（REQ-202610-0981） | 分支 `e68a12e` 已交付 | `openfactory.archive.v1` / ZIP 构建 / 路由 / admin 页面检查 |
| M9-05 数据质量治理（REQ-202610-0982） | 平台 pending，未合入 | 缺口（GAP），登记再验收条件 |
| M9-06 数据保留与隐私策略（REQ-202610-0983） | 平台 pending，未合入 | 缺口（GAP），登记再验收条件 |
| M9-07 M9 验收与回顾 | 本任务 | 验收脚本 + 报告 + 文档同步 |

验收分支基于 M8 验收 tip `4d061dd` 拉出，依次合并 `af36647` / `7207528` / `638e1b6` / `e68a12e`。
M9-05/06 在其他工作树中仍处于开发中且平台状态为 `pending`，本轮不合并、不预判，
统一登记 GAP，待平台状态与分支交付后再补验收。

## 2. 实现方案

### 2.1 分支集成

1. `git merge --no-ff af36647`（M9-01，个人技术画像）；
2. `git merge --no-ff 7207528`（M9-02，资产报表）；
3. `git merge --no-ff 638e1b6`（M9-03，数据导入）；
4. `git merge --no-ff e68a12e`（M9-04，全量导出与归档）。

冲突处理原则：代码按能力并集合并；文档以 M8 验收后的最新版本为基线，M9 内容在验收收尾时统一补齐，
避免各分支基于旧版文档互相覆盖。

### 2.2 一致性整理

- **迁移编号**：M8 已占用 `0021` / `0022`；M9-03 的 `0022_data_import.sql` 与
  `0022_extension_tokens.sql` 重号，顺延为 `0023_data_import.sql`，同步 `docs/assets/d1-schema.sql`、
  `docs/architecture/data-model.md` 与计划文档引用；
- **迭代编号**：M8 使用 `IT-0064`~`IT-0071`；M9 按交付顺序占用 `IT-0072`~`IT-0078`，
  M9-05/06 标注平台 pending；
- **路由生成物**：`admin/src/routeTree.gen.ts` 在合并后由 `vite build` 重新生成，不手改；
- **架构文档**：`overview.md` 保留 M9-01~04 章节并补验收入口，`data-model.md` 补 `import_runs` 表。

### 2.3 验收脚本

新增 `vps/scripts/m9_acceptance.py`（仅标准库 + 项目自身模块），覆盖：

- M9-01：`buildTechProfile` 纯函数（空态 / 语言 / 框架 / 趋势 / 活跃度）、路由登录态与 months 归一、
  admin 页面与侧边栏入口；
- M9-02：`buildAssetReport` 纯函数（收录量 / 分类 / 语言 / Star 快照趋势 / 覆盖率）、
  `months=6|12|24` 归一、路由挂载、admin 报表页；
- M9-03：`openfactory.import` 三格式解析、预览 / 执行 / 历史三接口、`import_runs` 迁移与 D1 schema、
  admin 导入页；
- M9-04：`openfactory.archive.v1` manifest、ZIP / JSON 双格式、summary / manifest / 下载三接口、
  admin 归档页；
- 跨切面：edge 路由挂载、admin 路由树、迁移编号唯一、文档状态；M9-05/06 缺口登记。

### 2.4 文档与报告

- `docs/planning/acceptance-m9.md`：验收范围、环境、结论、缺口与人工复核项；
- `docs/planning/acceptance-m9-report.md` / `.json`：脚本生成的原始结果；
- `docs/requirements/backlog.md`：M9-01~04 标记 ✅、M9-05/06 保持 pending、M9-07 标记 ✅；
- `docs/planning/roadmap.md`、`task-planning.md`、`open-questions.md` 与各 README 同步。

## 3. 验证

```bash
cd vps && .venv/bin/pytest -q
cd vps && python scripts/m9_acceptance.py --report-md docs/planning/acceptance-m9-report.md \
    --report-json docs/planning/acceptance-m9-report.json
cd edge && npm run typecheck && npm test
cd admin && npm run lint && npm run build && npm run test
```

重活统一走 `bacs-heavy`；全部通过后提交并推送需求分支，发送平台完成回调。
