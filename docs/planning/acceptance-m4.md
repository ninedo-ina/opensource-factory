# M4 验收报告 · 定向推送（双端走查 + 性能抽样 + 回顾）

> 需求：REQ-202610-0938（M4-09）｜ 验收日期：2026-10-22
>
> 验收分支：`feat/req-202610-0938-m4-acceptance`（基于 `main` @ `72c9840`）
>
> 工作树：`/opt/workspace/opensource-factory-req0938`
>
> 原始报告：[acceptance-m4-vps-report.md](./acceptance-m4-vps-report.md) · [acceptance-m4-vps-report.json](./acceptance-m4-vps-report.json) · [acceptance-m4-edge-report.md](./acceptance-m4-edge-report.md) · [acceptance-m4-edge-report.json](./acceptance-m4-edge-report.json)

## 1. 结论

本轮完成 M4 定向推送全链路验收：**26 项断言全部 PASS，0 GAP，0 FAIL，0 SKIP**。

- VPS 侧 10 项：每日评估、推送策略、Bark / Telegram / Email 投递、偏好时间窗口、推送记录与回执、列表性能；
- edge 侧 16 项：站内通知中心（惰性物化 / 幂等 / 已读 / 忽略 / 分页 / 内部推送去重 / 用户隔离）、推送偏好（默认值 / 保存回读 / 校验 / 内部读取）；
- 性能：VPS 推送记录列表 P95 19.1ms，edge 通知列表 P95 49.9ms，均远低于 300ms 预算；
- 全量检查：VPS pytest 341 passed、edge typecheck 通过 / 43 用例、admin lint / build 通过 / 107 用例。

真实 Bark / Telegram / SMTP / Cloudflare 生产凭据联调与 Celery beat 长跑观察未覆盖，列入遗留。

## 2. 验收环境与方法

- VPS：临时 SQLite（`DATABASE_URL` 指向临时文件）+ FastAPI `TestClient` + `CELERY_TASK_ALWAYS_EAGER=1`；Bark / Telegram / Email 全部注入假客户端，不访问网络；
- edge：`wrangler dev`（本地 D1，迁移 0001~0011 全量应用），种入 2 个用户 / 5 条推荐（3 条 `pushed`、1 条 `new`、1 条他人）；
- 请求方式：VPS 走 TestClient 真实路由，edge 走真实 HTTP（种子会话 Cookie + `X-Internal-Token`）；
- 性能抽样：预热后顺序执行 100 次，统计 P50 / P95 / Max；通过标准 `--strict` 下 GAP 也视为失败，性能预算 P95 < 300ms。

## 3. M4 验收矩阵

| 编号 | 验收点 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| M4-01 | 每日评估任务（质量分 + 匹配度阈值） | ✅ PASS | VPS M4-01：`quality_score=0.568`、状态 `qualified`；`test_recommendation_eval` 覆盖阈值 / 跳过 / 失败隔离 |
| M4-02 | 站内通知中心（edge + admin） | ✅ PASS | edge M4-02-01~10：401、本人 2 + 全局 1 物化、重复读取幂等、未读计数、筛选分页、单条已读、忽略联动 `dismissed`、read-all、内部推送 dedupe、用户隔离；VPS M4-02S 校验 `pushed` 数据源；admin `/notifications` 由 lint / build / 107 用例覆盖 |
| M4-03 | Bark 通道 | ✅ PASS | VPS M4-03：假客户端 `sent=1`、`bark_sent_at` 写入；`test_push_channels` 覆盖失败重试 / dry-run / 幂等 |
| M4-04 | Telegram 通道 | ✅ PASS | VPS M4-04：假客户端 `sent=1`、`items=1`、`parts=1`；`test_telegram` 覆盖 HTML 摘要 / 分片 / 429 退避 |
| M4-05 | Email 通道（SMTP） | ✅ PASS | VPS M4-05：假 sender `sent=1`、收件人脱敏；`test_email_channel` 覆盖 STARTTLS / SSL / 重试 / 同日幂等 |
| M4-06 | 推送偏好设置（时间 / 阈值 / 通道开关） | ✅ PASS | edge M4-06-01~05：默认值、保存回读（07:30 Asia/Tokyo、bark/email 开启）、4 类非法输入 400、内部单用户 / 批量读取、未登录 401；VPS M4-06：时区时间窗口与双阈值筛选 |
| M4-07 | 推送去重与静默策略 | ✅ PASS | VPS M4-07A/07B：策略预演命中 `duplicate_repo`、`daily_push` 写 `prepared` 事件；`test_push_policy` 覆盖静默 / 跨通道去重 / 每日上限 |
| M4-08 | 推送记录与回执（送达状态） | ✅ PASS | VPS M4-08：列表 3 条、统计、详情、`delivered` 回执、迟到回执不降级、目标脱敏；`test_push_records` 全量用例 |
| M4-09 | M4 验收与回顾 | ✅ PASS | 本报告 + 计划 + 双端脚本 + 文档同步 |

## 4. 端到端走查明细（26 项）

| 分组 | 断言 | 结果 |
| --- | --- | --- |
| VPS · 评估 / 策略 | 每日评估、策略预演、`daily_push` 过策略写账本 | 3 PASS |
| VPS · 通道 | Bark 投递、Telegram 摘要、Email 摘要 | 3 PASS |
| VPS · 偏好 / 记录 | 偏好时间窗口与阈值、记录列表 / 统计 / 详情 / 回执 / 脱敏 | 2 PASS |
| VPS · 数据源 / 性能 | `pushed` 推荐数据源、推送记录列表 P95 | 2 PASS |
| edge · 通知中心 | 401、物化、幂等、未读计数、筛选分页、单条已读、忽略联动、全部已读、内部 dedupe、用户隔离 | 10 PASS |
| edge · 推送偏好 | 默认值、保存回读、参数校验、内部读取、未登录 | 5 PASS |
| edge · 性能 | 通知列表 P95 | 1 PASS |

## 5. 性能抽样

| 场景 | 样本数 | P50 | P95 | Max | 预算 |
| --- | ---: | ---: | ---: | ---: | ---: |
| VPS 推送记录列表 `/api/push/records?pageSize=20` | 100 | 12.8ms | 19.1ms | 20.5ms | < 300ms |
| edge 通知列表 `/api/notifications?limit=20`（64 条通知） | 100 | 39.4ms | 49.9ms | 54.9ms | < 300ms |

## 6. 集成分支与提交

| 需求 | 分支 | 合并提交 | 集成内容 |
| --- | --- | --- | --- |
| M4-02 | `feat/req-202610-0931-notification-center` | `6776ec8` | 迁移 0010 + `/api/notifications` + 内部推送 / 同步 + admin 通知页 |
| M4-03 | `feat/req-202610-0932-bark-channel` | `7a6105b` | Bark 客户端、09:05 投递任务、状态 / 测试 / 手动投递接口 |
| M4-04 | `feat/req-202610-0933-telegram-channel` | `9963972` | Telegram HTML 摘要、分片、429 退避、状态 / 测试接口 |
| M4-05 | `feat/req-202610-0934-email-channel` | `05a4e64` | SMTP STARTTLS / SSL、重试、同日幂等、状态 / 测试接口 |
| M4-06 | `feat/req-202610-0935-push-preferences` | `b92d8bb` | 迁移 0011 + `/api/push-preferences` + VPS 每 10 分钟按偏好推送 |
| M4-07 | `feat/req-202610-0936-push-dedupe-silence` | `ca4fcf0` | `push_events` 账本、静默 / 跨通道去重 / 每日上限、重试任务 |
| M4-08 | `feat/req-202610-0937-push-records` | `ffa395e` | `push_deliveries` / `push_receipts`、列表 / 统计 / 详情 / 回执接口 |
| 回归修复 | `feat/req-202610-0938-m4-acceptance` | `de792c1` | 恢复 M3 反馈闭环汇总键与测试断言、修复合并引入的导入 / DDL 问题 |

## 7. 检查结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| VPS pytest | `cd vps && pytest -q` | ✅ 341 passed / 10 warnings |
| VPS M4 验收 | `python scripts/m4_acceptance.py --strict` | ✅ 10 PASS / 0 GAP / 0 FAIL |
| edge typecheck | `cd edge && npm run typecheck` | ✅ 0 error |
| edge 单元测试 | `cd edge && npm test` | ✅ 43 pass / 0 fail |
| edge M4 验收 | `cd edge && npm run test:m4 -- --strict` | ✅ 16 PASS / 0 GAP / 0 FAIL |
| admin lint | `cd admin && npm run lint` | ✅ 0 error |
| admin build | `cd admin && npm run build` | ✅ tsc + vite 通过 |
| admin test | `cd admin && npm run test` | ✅ 16 文件 / 107 用例 |

## 8. 回顾（Retrospective）

### 8.1 做得好的

1. **按依赖顺序合并**：0931（通知中心）→ 0932/0933/0934（三通道）→ 0935（偏好）→ 0936（策略）→ 0937（记录），每次合并后立即跑 pytest，问题在当次暴露；
2. **能力超集合并**：`push.py` 同时保留 Bark / Telegram / Email / 策略 / 记录接口，`overview.md` 的 3.14~3.18 按能力分段，无重复章节；
3. **双端验收脚本可复跑**：VPS 脚本用临时 SQLite + 假客户端，edge 脚本自动迁移 + 临时 D1 + 自动选端口，均支持 `--strict` 与 Markdown / JSON 报告；
4. **性能预算前置**：两个脚本都把 P95 < 300ms 作为硬断言，而不是事后人工观察。

### 8.2 集成暴露的问题（已修复）

| 问题 | 影响 | 修复 |
| --- | --- | --- |
| `recommendation_service.py` 合并丢失 `feedbackExcluded` 汇总键 | `test_generate_*` 抛 `KeyError`，M3-07 回归 | 恢复 `generate_daily_recommendations` 中的 `feedbackExcluded` 汇总 |
| `recommend.py` 合并丢失 `import json` | `/api/recommend/evaluations/{run_id}` 详情抛 `NameError` | 补回 `import json` |
| M3-07 幂等测试断言被旧分支覆盖为 `>= 1` | 反馈闭环“已忽略不刷新”行为失去保护 | 恢复 `updated == 0` / `expired == 2` 并加注释 |
| `test_vector_index.py` 手工 DDL 缺 `created_at` / `updated_at` | 全量套件按顺序执行时报 `no such column` | 补两列默认值，与 ORM 模型一致 |
| 测试替身 `FakeEmbedding` 无 `model_name` / `backend` | 推荐服务直接取属性时 `AttributeError` | 增加 `_service_model_name` / `_service_backend` 的 `getattr` 回退 |
| `overview.md` 出现重复 `3.10` 章节与重复 push records API 行 | 文档自相矛盾，读者无法判断权威接口 | 章节重排为 3.14~3.18，API 表去重为一组 |

### 8.3 经验与改进

1. **合并后必须跑全量套件**：本次 5 个回归都只在全量 pytest 下暴露（单文件测试全绿），后续合并清单把“全量 pytest”列为硬门禁；
2. **测试 DDL 要与迁移同步**：手工建表的测试容易漏列，建议抽公共 `create_repo_vectors_table()` 工厂；
3. **验收脚本注意配置缓存**：VPS `get_settings()` 是 `lru_cache`，脚本切换 `TELEGRAM_ENABLED` / `EMAIL_ENABLED` 前必须 `cache_clear()`，否则通道一直返回 `disabled`；
4. **文档冲突按能力分段合并**：并行分支各自追加章节时，先按能力编号排序再去重，比逐段保留更不容易留下重复编号。

### 8.4 遗留与后续

1. **真实凭据联调**：Bark device key、Telegram bot token、SMTP 账号、Cloudflare D1 远端迁移需人工提供，脚本只覆盖假客户端；
2. **定时调度长跑**：验收使用 `CELERY_TASK_ALWAYS_EAGER=1`，beat 在真实时钟下的 09:00 / 09:05 触发与重试窗口未观察；
3. **服务商回执回调**：`/api/push/receipts` 已支持 accepted / delivered / bounced / failed，但尚未接入真实服务商 webhook；
4. **admin 通知页浏览器 E2E**：当前由 lint / build / 组件测试覆盖，未做 Playwright 级走查，可并入 M5 上线硬化。

## 9. 复跑方式

```bash
# VPS 侧（10 项）
cd vps
python scripts/m4_acceptance.py --strict \
  --report-md ../docs/planning/acceptance-m4-vps-report.md \
  --report-json ../docs/planning/acceptance-m4-vps-report.json

# edge 侧（16 项）
cd edge
npm run test:m4 -- --strict \
  --report-md docs/planning/acceptance-m4-edge-report.md \
  --report-json docs/planning/acceptance-m4-edge-report.json
```

两个脚本都会自动准备临时数据库并在结束时清理；edge 脚本支持 `--keep` 保留本地 D1 目录用于排查。
