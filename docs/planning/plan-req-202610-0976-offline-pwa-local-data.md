# 实施计划 · REQ-202610-0976 离线可用（PWA 缓存 + 本地数据）

> 需求：REQ-202610-0976（backlog M8-07）｜ 分支：`feat/req-202610-0976-offline-pwa-local-data`
> 依赖：M8-01 PWA 与移动端适配（REQ-202610-0970，基线 `47610b8`）
> 目标：断网时仍能打开控制台，查看本地缓存的收藏、分类、仪表盘、热榜与推荐数据；
> 离线收藏操作进入本地队列，恢复联网后自动回放，并给出清晰的「离线数据 / 待同步」提示。

## 1. 现状与缺口

- M8-01 已提供 Web App Manifest、Service Worker App Shell 预缓存、离线兜底页与离线横幅；
- Service Worker 明确跳过 `/api/*`，因此断网后页面壳能打开，但所有数据请求失败，
  各页面回退到内置演示数据（`MOCK_*`），展示的不是用户自己的收藏；
- 会话检查 `fetchCurrentUser()` 在断网时返回 `null`，`AuthenticatedLayout` 会跳转登录页，
  离线时根本无法进入控制台；
- 收藏 / 取消收藏等写操作在断网时直接报错，没有本地暂存与恢复联网后的补偿；
- 本地缓存没有用户隔离、容量展示与清理入口，不符合隐私边界要求。

## 2. 方案总览

```
首次在线访问
  → 页面请求核心只读接口（仓库 / 分类 / 仪表盘 / 热榜 / 推荐）
  → fetchWithOffline：网络成功 → 返回数据 + 写入 IndexedDB 快照（按用户隔离）
断网访问
  → Service Worker 返回 App Shell
  → 会话检查失败但处于离线：读取本地保存的最近用户 → 允许进入
  → fetchWithOffline 网络失败 → 读取 IndexedDB 快照 → 页面展示真实收藏（标注同步时间）
  → 收藏操作失败 → 写入 mutations 队列 → 提示「已离线收藏，联网后自动同步」
恢复联网
  → online 事件 / 启动时 flush → 顺序回放队列 → 成功删除、4xx 丢弃并提示
  → 刷新页面数据并写入新快照
```

设计原则：

1. **只缓存白名单只读接口**：仅核心 GET 数据进入 IndexedDB，认证 / 内部接口 / 写接口不缓存；
2. **按用户隔离**：快照键包含用户 id，退出登录时清空该用户本地数据与运行时缓存；
3. **不缓存鉴权响应到 Cache Storage**：Service Worker 继续跳过 `/api/*`，本地数据只存 IndexedDB；
4. **渐进增强**：IndexedDB 不可用（隐私模式 / 旧浏览器）时退化为原有演示数据兜底，不阻塞主流程；
5. **可观测可清理**：设置页展示缓存数据集、同步时间、占用空间与待同步操作，支持一键清理。

## 3. 本地数据模型（IndexedDB `of-offline` v1）

| 对象仓库 | 主键 | 字段 | 用途 |
| --- | --- | --- | --- |
| `snapshots` | `key` | `key` / `userId` / `path` / `data` / `savedAt` / `version` | 只读接口快照 |
| `mutations` | `id` | `id` / `userId` / `path` / `method` / `body` / `label` / `createdAt` | 离线写队列 |

- 快照键：`of:v1:<userId>:<path>`，`userId` 缺省为 `anonymous`；
- 版本号 `OFFLINE_CACHE_VERSION = 1`，升级时旧记录按版本忽略并清理；
- 快照上限：单条 `data` 序列化后超过 512KB 不写入，避免大响应撑爆存储；
- 队列上限：100 条，超出时拒绝并提示先联网同步。

## 4. 缓存范围

| 数据集 | 接口 | 说明 |
| --- | --- | --- |
| 我的仓库 | `GET /api/repos` | 离线核心：收藏列表与健康度 / License |
| 分类与标签 | `GET /api/categories` | 分类树与标签云 |
| 仪表盘 | `GET /api/dashboard/stats`、`GET /api/trending?limit=5` | 首页统计与最近热榜 |
| 热榜 | `GET /api/trending?...`、日期 / 语言选项 | 按查询串分别缓存 |
| 推荐 | `GET /api/recommendations?...`、统计 | 推荐列表与统计 |

不缓存：`/api/auth/*`、`/api/*/health/refresh` 等写接口、内部令牌接口、任何非 GET 请求。

## 5. 离线写队列

- 可排队操作：热榜收藏 / 取消收藏（`POST|DELETE /api/trending/:owner/:name/favorite`）、
  推荐收藏（`POST /api/recommendations/:id/save`）；
- 入队条件：`navigator.onLine === false` 或请求抛出网络错误（`TypeError`）；
- 回放：按 `createdAt` 顺序逐条调用 `apiFetch`；成功删除；4xx 视为业务失败删除并计数；
  网络错误立即停止，保留剩余队列等待下次；
- 幂等性：收藏接口本身按仓库 + 用户幂等，重复回放不会产生重复收藏；
- UI：离线横幅显示待同步数量；离线数据页提供「立即同步」；恢复联网自动回放并 toast。

## 6. 会话与退出

- `fetchCurrentUser()` 成功时把最小用户信息写入 `localStorage`（`of.offline.user`），
  仅用于断网时恢复界面身份，不包含任何令牌；
- `AuthenticatedLayout` 在 `fetchCurrentUser()` 失败且 `navigator.onLine === false` 时，
  读取本地用户并放行；在线失败仍按原逻辑跳转登录；
- 退出登录：清空 IndexedDB（快照 + 队列）、本地用户、内存状态，并通知 Service Worker
  清理运行时缓存，避免共用设备串号。

## 7. 文件清单

- 新增 `admin/src/lib/offline-cache.ts`（纯函数：键、白名单、错误判定、文案与统计）
- 新增 `admin/src/lib/offline-db.ts`（IndexedDB 读写、快照 / 队列、容量估算）
- 新增 `admin/src/lib/offline-fetch.ts`（在线优先 + 快照兜底 + 写快照）
- 新增 `admin/src/lib/offline-mutations.ts`（队列、回放、online 监听）
- 新增 `admin/src/stores/offline-store.ts`（同步时间 / 缓存命中 / 待同步数量）
- 新增 `admin/src/features/offline/`（离线数据页：数据集、同步时间、容量、队列、清理）
- 新增 `admin/src/routes/_authenticated/offline/index.tsx`
- 修改 `admin/src/lib/api.ts`（用户快照）、`components/layout/authenticated-layout.tsx`（离线会话）
- 修改 `components/pwa/pwa-provider.tsx`（离线横幅显示缓存时间与待同步数量）
- 修改 `components/sign-out-dialog.tsx`（退出清理本地数据）
- 修改核心 feature api：repos / categories / dashboard / trending / recommend 使用 `fetchWithOffline`
- 修改 `admin/public/sw.js`（缓存版本升级、清理消息）
- 修改 `components/layout/data/sidebar-data.ts`（系统 → 离线数据）
- 文档：本计划、admin README、架构总览、backlog、roadmap、task-planning、open-questions

## 8. 验证

```bash
cd admin && npm run lint && npm run build && npm run test
cd edge && npm run typecheck
cd vps && .venv/bin/pytest -q
```

- 新增 `offline-cache.test.ts`：缓存键、白名单、错误判定、时间与容量文案；
- 新增 `offline-db.test.ts`：快照读写 / 列表 / 清理、队列入队 / 回放顺序 / 上限（浏览器 IndexedDB）；
- 新增 `features/offline/offline.test.ts`：数据集标签、统计汇总、格式化；
- 手工：生产构建后 DevTools 断网刷新，确认可进入控制台、看到缓存数据与离线提示；
  离线收藏后恢复联网，确认队列清空且收藏落库。

## 9. 边界与风险

- 本期只缓存核心只读数据，搜索 / 建议 / 监控等长尾页面离线时仍回退演示数据；
- 本地数据保存在浏览器 IndexedDB，清浏览器站点数据会一并清除；不做跨设备同步；
- 离线队列只覆盖收藏类幂等操作，分类增删改等管理操作离线时仍要求联网；
- Service Worker 更新后旧缓存由版本号清理；IndexedDB 结构升级需提升数据库版本并迁移；
- 共用设备场景依赖「退出登录即清理」；未退出时同一浏览器用户可看到自己的缓存，属预期行为。
