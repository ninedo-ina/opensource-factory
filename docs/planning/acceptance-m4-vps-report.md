# M4 验收原始报告

> 需求：REQ-202610-0938（M4-09）｜生成时间：2026-10-22T09:53:34+00:00
> 分支：`feat/req-202610-0938-m4-acceptance` @ `ffa395e`

## 汇总

- 断言：10 项 · PASS 10 · FAIL 0 · GAP 0 · SKIP 0
- 性能：P50 12.8ms · P95 19.1ms · Max 20.5ms（预算 < 300ms）

## 断言明细

| 编号 | 验收点 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| M4-01 | 每日评估写入质量分并产出 qualified | PASS | quality=0.568 · status=qualified |
| M4-07A | 推送策略预演与事件账本 | PASS | policy=on · duplicate_repo 命中 |
| M4-07B | daily_push 通过策略并写事件账本 | PASS | pushed=1 · event=prepared |
| M4-03 | Bark 通道投递与状态接口（假客户端） | PASS | sent=1 · bark_sent_at 已写入 |
| M4-04 | Telegram 每日摘要（假客户端） | PASS | sent=1 · items=1 · parts=1 |
| M4-05 | Email 每日摘要（假 sender） | PASS | sent=1 · items=1 · recipient=masked |
| M4-06 | 推送偏好解析、时间窗口与阈值筛选 | PASS | 09:00 到期 · 阈值 0.35 生效 |
| M4-08 | 推送记录列表 / 统计 / 详情 / 回执与脱敏 | PASS | records=3 · receipt=delivered · late=no-downgrade |
| M4-02S | 站内通知中心数据源（pushed 推荐） | PASS | pushed 推荐已就绪（edge 侧由 m4-acceptance.mjs 走查） |
| M4-P01 | 推送记录列表性能 P95 < 300ms | PASS | P50=12.8ms · P95=19.1ms · Max=20.5ms · n=100 |
