# 实施计划 · REQ-202610-0984 M9 验收与回顾

> 需求：REQ-202610-0984（backlog M9-07）｜ 分支：`feat/req-202610-0984-m9-acceptance`
> 依赖：M9-01~06；本轮实际集成 M9-01~06 全部六个已交付分支
> 目标：把 M9「数据资产与洞察」已交付能力按依赖顺序集成到一条验收分支，产出可复跑的验收脚本、
> 验收报告与缺口登记，并同步项目文档；不虚报未交付能力。

## 1. 现状与范围

| 需求 | 交付状态 | 验收方式 |
| --- | --- | --- |
| M9-01 个人技术画像（REQ-202610-0978） | 分支 `af36647` 已交付 | 聚合纯函数 / 路由 / admin 页面 / 测试静态检查 |
| M9-02 资产报表（REQ-202610-0979） | 分支 `7207528` 已交付 | 聚合口径 / Star 快照 / 路由 / admin 报表页检查 |
| M9-03 数据导入（REQ-202610-0980） | 分支 `638e1b6` 已交付 | 三格式解析 / 预览-执行-历史接口 / 迁移 / admin 页面检查 |
| M9-04 全量导出与归档（REQ-202610-0981） | 分支 `e68a12e` 已交付 | `openfactory.archive.v1` / ZIP 构建 / 路由 / admin 页面检查 |
| M9-05 数据质量治理（REQ-202610-0982） | 分支 `f37170c` 已交付 | 质量规则 / 扫描接口 / 迁移 / VPS 链接检测与对账检查 |
| M9-06 数据保留与隐私策略（REQ-202610-0983） | 分支 `f6b1e90` 已交付 | 策略 / 导出 / 删除 / 每日清理 / 迁移 / admin 隐私页检查 |
| M9-07 M9 验收与回顾 | 本任务 | 验收脚本 + 报告 + 文档同步 |

验收分支基于 M8 验收 tip `4d061dd` 拉出，依次合并 `af36647` / `7207528` / `638e1b6` /
`e68a12e` / `f37170c` / `f6b1e90`。M9-06 分支在验收开始前完成提交，因此本轮不登记 GAP，
M9-01~06 全部纳入验收。

## 2. 实现方案

### 2.1 分支集成

1. `git merge --no-ff af36647`（M9-01，个人技术画像）；
2. `git merge --no-ff 7207528`（M9-02，资产报表）；
3. `git merge --no-ff 638e1b6`（M9-03，数据导入）；
4. `git merge --no-ff e68a12e`（M9-04，全量导出与归档）；
5. `git merge --no-ff f37170c`（M9-05，数据质量治理）；
6. `git merge --no-ff f6b1e90`（M9-06，数据保留与隐私策略）。

冲突处理原则：代码按能力并集合并；文档以 M8 验收后的最新版本为基线，M9 内容在验收收尾时统一补齐，
避免各分支基于旧版文档互相覆盖。

### 2.2 一致性整理

- **迁移编号**：M8 已占用 `0021` / `0022`；M9-03 原 `0022_data_import.sql` 顺延为
  `0023_data_import.sql`，M9-05 原 `0023_data_quality.sql` 顺延为 `0024_data_quality.sql`，
  M9-06 原 `0023_privacy_lifecycle.sql` 顺延为 `0025_privacy_lifecycle.sql`，同步
  `docs/assets/d1-schema.sql`、`docs/architecture/data-model.md`、README 与计划文档引用；
- **迭代编号**：M8 使用 `IT-0064`~`IT-0071`；M9 按交付顺序占用 `IT-0072`~`IT-0078`；
- **问题编号**：各分支重复的 Q36 / Q37 顺延为 Q37 技术画像、Q38 导入冲突、Q39 归档加密、
  Q40 数据质量、Q41 保留期策略；
- **路由生成物**：`admin/src/routeTree.gen.ts` 在合并后由 `vite build` 重新生成，不手改；
- **架构文档**：`overview.md` M9 章节统一为 3.36~3.41，`data-model.md` 为 3.27~3.29。

### 2.3 验收脚本

新增 `vps/scripts/m9_acceptance.py`（仅标准库 + 项目自身模块），覆盖：

- M9-01：`buildTechProfile` 纯函数（空态 / 语言 / 框架 / 趋势 / 活跃度）、路由登录态与 months 归一、
  admin 页面与侧边栏入口；
- M9-02：`buildAssetReport` 纯函数（收录量 / 分类 / 语言 / Star 快照趋势 / 覆盖率）、
  `months=6|12|24` 归一、路由挂载、admin 报表页；
- M9-03：JSON / CSV / 书签 HTML 三格式解析、预览 / 执行 / 历史三接口、`import_runs` 迁移与
  D1 schema、admin 导入页；
- M9-04：`openfactory.archive.v1` manifest、ZIP / JSON 双格式、summary / manifest / 下载三接口、
  admin 归档页；
- M9-05：质量规则 / 扫描 / 补全 / 忽略 / 恢复接口、迁移 `0024`、VPS 链接状态与对账纯函数实跑；
- M9-06：隐私策略 / 个人数据导出 / 账号删除 / D1 + VPS 保留清理、迁移 `0025`、admin 隐私页；
- 跨切面：edge 路由挂载、admin 路由树、M9 迁移编号唯一、文档状态与 M9-06 合并状态。

### 2.4 文档与报告

- `docs/planning/acceptance-m9.md`：验收范围、环境、结论、缺口与人工复核项；
- `docs/planning/acceptance-m9-report.md` / `.json`：脚本生成的原始结果；
- `docs/requirements/backlog.md`：M9-01~07 全部标记 ✅；
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
