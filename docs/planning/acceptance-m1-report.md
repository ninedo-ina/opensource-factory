# M1 验收报告（自动生成）

- 生成时间：2026-10-22T05:06:20.143Z
- 分支 / 提交：feat/req-202610-0907-m1-acceptance / bd12068
- 运行环境：linux x64 · Node v22.23.1
- 数据规模：1200 个仓库 / 5 个分类 / 5 个标签 / 25 条热榜 / 10 条推荐
- 判定口径：PASS 通过 · GAP 能力未集成（阻塞） · FAIL 行为错误 · SKIP 跳过

## 检查结果

| # | 检查 | 结果 | 说明 | 耗时 |
| --- | --- | --- | --- | --- |
| M1-A01 | 健康检查 /healthz | PASS | 200 {"status":"ok"} | 26.3ms |
| M1-A02 | 未登录访问 /api/auth/me 返回 401 | PASS | 401 unauthorized | 14.4ms |
| M1-A03 | 种子会话登录态 /api/auth/me | PASS | 200 tester | 46.3ms |
| M1-B01 | 仓库列表返回当前用户数据 | PASS | 100 条 | 43.3ms |
| M1-B02 | 仓库列表默认分页上限（M1-12） | PASS | 100 条（≤200） | 40.0ms |
| M1-B03 | limit=5 精确返回 5 条（M1-12） | PASS | 5 条 | 26.6ms |
| M1-B04 | 关键字筛选 q=支付 | PASS | 100 条命中 | 39.9ms |
| M1-B05 | 分类筛选 categoryId=cat-pay | PASS | 100 条 | 39.2ms |
| M1-B06 | LIKE 通配符转义 q=%（M1-12） | PASS | 0 条（未放大） | 28.5ms |
| M1-B07 | 组合筛选 + 排序 + 分页（M1-11） | PASS | 20 条，stars 5→100 升序 | 32.5ms |
| M1-C01 | 分类列表与树字段（M1-09） | PASS | 5 个分类，树字段完整 | 32.5ms |
| M1-C02 | 分类写操作 CRUD（M1-09） | PASS | 新建 / 编辑 / 删除通过 | 108.9ms |
| M1-C03 | 标签写操作（M1-10） | PASS | 标签新建 / 列表通过 | 51.2ms |
| M1-D01 | 仪表盘统计 /api/dashboard/stats | PASS | totalRepos=1200 | 43.7ms |
| M1-D02 | 热榜列表 /api/trending | PASS | 20 条 | 18.2ms |
| M1-D03 | 推荐列表 /api/recommendations | PASS | 10 条 | 29.9ms |
| M1-E01 | 同步触发 /api/sync → mock VPS | PASS | taskId=m1-e2e-task-1 | 38.1ms |
| M1-E02 | 同步任务查询 /api/tasks（M1-08） | PASS | 任务状态 success | 59.8ms |
| M1-P01 | 性能抽样 P95 < 300ms | PASS | 仓库列表 limit=100 P95 39.0ms；关键字检索 q=支付 P95 38.9ms；分类筛选 cat-pay P95 40.1ms；仪表盘统计 P95 47.3ms | 165.3ms |
| M1-F01 | 登出 /api/auth/logout 清除会话 | PASS | 204 → 401 | 44.6ms |

## 性能抽样（预算 P95 < 300ms）

| 场景 | 样本数 | P50 | P95 | Max | 结果 |
| --- | --- | --- | --- | --- | --- |
| `/api/repos?limit=100` | 200 | 31.5ms | 39.0ms | 50.7ms | PASS |
| `/api/repos?q=%E6%94%AF%E4%BB%98` | 200 | 31.8ms | 38.9ms | 47.8ms | PASS |
| `/api/repos?categoryId=cat-pay` | 200 | 32.6ms | 40.1ms | 51.0ms | PASS |
| `/api/dashboard/stats` | 200 | 35.4ms | 47.3ms | 68.1ms | PASS |

## 汇总

- PASS：20
- GAP：0
- FAIL：0
- SKIP：0
- 结论：全部通过

