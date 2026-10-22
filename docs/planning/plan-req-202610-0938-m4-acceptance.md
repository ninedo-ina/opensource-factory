# 实施计划 · REQ-202610-0938 · M4 验收与回顾

> 文档编号：PL-REQ-0938 ｜ 维护人：fntp ｜ 创建日期：2026-10-22
>
> 关联需求：`docs/requirements/backlog.md` · M4-09（M4 · 定向推送）｜ 依赖：M4-01~08

## 1. 目标与范围

把 M4 已完成的 8 个能力整合到一条可重复执行的验收分支，分别用真实 HTTP（edge / D1）与 FastAPI TestClient（VPS / SQLite）走查定向推送全链路，抽样核对关键接口性能，并把结果、差距、回顾结论与复跑方式固化为文档。

范围：

- 验收对象：
  - VPS：每日评估（质量分 + 匹配度双门槛）、Bark / Telegram / Email 投递、推送偏好解析与时间窗口、去重 / 静默 / 每日上限、推送记录 / 统计 / 详情 / 回执与目标脱敏；
  - edge：站内通知中心（`pushed` 推荐惰性物化、已读 / 忽略、未读计数、筛选分页、内部推送去重）、推送偏好（默认值、保存回读、参数校验、内部按用户读取）；
- 集成对象：M4 并行需求分支 0931（通知中心）、0932（Bark）、0933（Telegram）、0934（Email）、0935（推送偏好）、0936（去重与静默）、0937（推送记录与回执）；
- 不在本轮范围：真实 Bark / Telegram / SMTP / Cloudflare 生产凭据联调、真实定时调度器长跑观察。

## 2. 实施步骤

1. 从 `origin/main`（`72c9840`）拉出 `feat/req-202610-0938-m4-acceptance` 工作树；
2. 按依赖顺序 `git merge --no-ff` 集成 0931 → 0932 → 0933 → 0934 → 0935 → 0936 → 0937，解决 `docs/architecture/overview.md`、`vps/README.md`、`docs/planning/task-planning.md` 等文档冲突，保留各分支能力超集；
3. 修复集成暴露的回归：推荐服务测试替身字段缺失、`recommend.py` 缺少 `json` 导入、`feedbackExcluded` 汇总键丢失、`repo_vectors` 测试 DDL 缺时间列、M3-07 幂等断言被合并覆盖；
4. 新增 `vps/scripts/m4_acceptance.py`：临时 SQLite + `TestClient`，注入 Bark / Telegram / Email 假客户端，按 M4-01/02S/03/04/05/06/07/08/P 分组断言，支持 `--strict` 与 Markdown / JSON 报告；
5. 新增 `edge/scripts/m4-acceptance.mjs`：自动应用本地 D1 迁移（0001~0011）、种入 5 条推荐 / 2 个用户、启动 `wrangler dev`，按 M4-02 / M4-06 / P 分组断言，支持 `--strict` 与报告输出；
6. 跑三端检查：vps pytest，edge typecheck / `npm test` / M4 验收，admin lint / build / test；
7. 生成验收报告，更新任务计划、需求池、路线图与文档索引。

## 3. 验收矩阵

| 编号 | 验收点 | 覆盖方式 |
| --- | --- | --- |
| M4-01 | 每日评估任务（质量分 + 匹配度阈值） | VPS 脚本 M4-01：评估写入 `quality_score` / `quality_detail`，状态转 `qualified`；`test_recommendation_eval` 全量用例 |
| M4-02 | 站内通知中心（edge + admin） | edge 脚本 M4-02-01~10：惰性物化、幂等、未读计数、筛选分页、已读 / 忽略、内部推送去重、用户隔离；VPS 脚本 M4-02S 校验 `pushed` 数据源 |
| M4-03 | Bark 通道 | VPS 脚本 M4-03：假客户端投递、`bark_sent_at` 写入；`test_push_channels` |
| M4-04 | Telegram 通道 | VPS 脚本 M4-04：假客户端每日摘要、分片；`test_telegram` |
| M4-05 | Email 通道（SMTP） | VPS 脚本 M4-05：假 sender、收件人脱敏；`test_email_channel` |
| M4-06 | 推送偏好设置 | edge 脚本 M4-06-01~05（默认值 / 保存回读 / 校验 / 内部读取）；VPS 脚本 M4-06（解析 / 时区时间窗口 / 双阈值筛选） |
| M4-07 | 推送去重与静默策略 | VPS 脚本 M4-07A/07B：策略预演、事件账本、`daily_push` 过策略；`test_push_policy` |
| M4-08 | 推送记录与回执 | VPS 脚本 M4-08：列表 / 统计 / 详情 / 回执 / 迟到回执不降级 / 目标脱敏；`test_push_records` |
| M4-09 | M4 验收与回顾 | 本计划 + 验收报告 + 双端脚本 + 文档同步 |

## 4. 交付物

- `vps/scripts/m4_acceptance.py`（可重复执行，支持 `--strict`、`--report-md`、`--report-json`）；
- `edge/scripts/m4-acceptance.mjs`（可重复执行，支持 `--strict`、`--report-md`、`--report-json`、`--keep`）；
- `docs/planning/acceptance-m4.md`（验收结论、矩阵与回顾）；
- `docs/planning/acceptance-m4-vps-report.md` / `.json`、`docs/planning/acceptance-m4-edge-report.md` / `.json`（脚本生成的原始报告）；
- M4 七个分支的集成代码与回归修复；
- 文档同步：backlog / task-planning / roadmap / docs README / vps README。

## 5. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 七个分支同时改 `docs/architecture/overview.md` / `vps/README.md` | 按依赖顺序合并，冲突处保留能力超集并去重章节编号 |
| 合并回退既有能力（M3 反馈闭环 / 摘要抽检） | 合并后立即跑全量 pytest，按失败用例恢复被覆盖的断言与实现 |
| VPS 推送依赖外网（Bark / Telegram / SMTP） | 验收脚本注入假客户端，只验证业务链路与落库，不访问网络 |
| edge 本地 D1 迁移与真实环境差异 | 脚本全量应用 0001~0011，使用独立 `--persist-to` 目录，结束即清理 |
| 真实凭据缺失 | 双端脚本覆盖本地契约；真实通道联调列入遗留 |
