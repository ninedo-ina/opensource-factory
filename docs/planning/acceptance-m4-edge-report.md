# M4 验收报告 · edge 侧（自动生成）

- 生成时间：2026-10-22T09:54:35.446Z
- 分支 / 提交：feat/req-202610-0938-m4-acceptance / ffa395e
- 运行环境：linux x64 · Node v22.23.1
- 数据规模：5 条推荐（3 条 pushed、1 条 new、1 条他人）/ 2 个测试用户
- 判定口径：PASS 通过 · GAP 能力未集成（阻塞） · FAIL 行为错误 · SKIP 跳过

## 检查结果

| # | 检查 | 结果 | 说明 | 耗时 |
| --- | --- | --- | --- | --- |
| M4-02-01 | 通知接口未登录返回 401 | PASS | 401 unauthorized | 33.0ms |
| M4-02-02 | pushed 推荐惰性物化为通知（本人 2 + 全局 1） | PASS | 3 条 · 未读 3 | 50.4ms |
| M4-02-03 | 重复读取不重复物化（幂等） | PASS | total 保持 3 | 92.1ms |
| M4-02-04 | 未读计数接口与列表一致 | PASS | unread=3 | 46.1ms |
| M4-02-05 | 状态筛选与分页（limit / offset / hasMore） | PASS | unread 3 · 2+1 分页 | 164.0ms |
| M4-02-06 | 单条已读：状态与 readAt 生效 | PASS | read · unread 3 → 2 | 137.6ms |
| M4-02-07 | 忽略通知：从列表移除并联动推荐 dismissed | PASS | dismissed · 推荐联动 · 404 边界 | 166.1ms |
| M4-02-08 | 全部已读清空未读计数 | PASS | updated=1 · unread=0 | 54.9ms |
| M4-02-09 | 内部推送接口：令牌校验 + dedupeKey 幂等 | PASS | created 1 → 0 · skipped 1 | 91.8ms |
| M4-02-10 | 内部同步推荐：按用户物化且用户隔离 | PASS | created=2 · 用户隔离 | 77.4ms |
| M4-06-01 | 未保存时返回默认偏好 | PASS | 09:00 · 0.35 / 0.55 · 仅站内 | 24.4ms |
| M4-06-02 | 保存偏好后回读一致 | PASS | 07:30 Asia/Tokyo · bark/email 开启 | 81.8ms |
| M4-06-03 | 非法参数返回 400 与中文提示 | PASS | 4 类非法输入 → 400 | 138.4ms |
| M4-06-04 | 内部接口按用户读取与批量列表 | PASS | 单用户 / 未知回退 / 批量命中 | 65.4ms |
| M4-06-05 | 偏好接口未登录返回 401 | PASS | GET / PUT 均 401 | 31.9ms |
| M4-P01 | 性能抽样 P95 < 300ms | PASS | P50 39.4ms / P95 49.9ms · 64 条通知 | 49.9ms |

## 性能抽样（预算 P95 < 300ms）

| 场景 | 样本数 | P50 | P95 | Max | 结果 |
| --- | --- | --- | --- | --- | --- |
| `/api/notifications?limit=20` | 100 | 39.4ms | 49.9ms | 54.9ms | PASS |

## 汇总

- PASS：16
- GAP：0
- FAIL：0
- SKIP：0
- 结论：全部通过

