# 实施计划 · REQ-202610-0974 开放 API（个人令牌）

> 需求：REQ-202610-0974（backlog M8-05）｜ 分支：`feat/req-202610-0974-open-api`
> 依赖：M5-05 接口限流与安全加固（已落地）
> 目标：为个人用户提供可自助创建的 API 令牌，让 CLI / 脚本 / 第三方工具在**不携带浏览器会话**的情况下
> 只读访问自己的收藏、分类、标签、推荐与公开热榜，并可写入收藏。

## 1. 现状与缺口

- 现有 edge API 全部依赖 `of_session` Cookie（GitHub OAuth 会话），CLI / 脚本无法直接调用；
- M8-02 浏览器扩展已有 `extension_tokens`，但作用域仅限「查询是否收藏 / 一键收藏」，
  且表名与接口都绑定扩展场景，不适合作为通用开放 API；
- M8-06 CLI 工具、M8-04 快捷入口都依赖 M8-05 的开放 API 基线；
- 现有 `rate_limit_counters` 与 `policyFor` 只覆盖会话 / IP 维度，需要为令牌维度补充配额。

## 2. 方案总览

```
admin 设置 → 开放 API（Cookie 会话）
  → GET    /api/open/tokens        令牌列表（不含明文）
  → POST   /api/open/tokens        创建令牌（明文仅返回一次）
  → DELETE /api/open/tokens/:id    撤销令牌

CLI / 脚本（Authorization: Bearer ofa_…）
  → GET  /api/open/v1/me                 令牌与用户信息
  → GET  /api/open/v1/repos              收藏列表（搜索 / 分类 / 标签 / 语言 / 分页）
  → GET  /api/open/v1/repos/:owner/:name 收藏详情
  → POST /api/open/v1/repos              收藏仓库（需 write 作用域）
  → GET  /api/open/v1/categories         分类与标签
  → GET  /api/open/v1/recommendations    推荐列表
  → GET  /api/open/v1/trending           公开热榜
  → GET  /api/open/v1/search             收藏 / 热榜关键词检索
  → GET  /api/open/v1/stats              收藏统计概览
```

设计原则：

1. **令牌只存摘要**：明文 `ofa_` + 64 位十六进制只在创建时返回一次，D1 仅存 SHA-256；
2. **最小作用域**：`read`（只读）与 `write`（收藏写入，隐含 read），所有 SQL 强制 `user_id = ?`；
3. **可撤销 / 可过期**：支持 30 / 90 / 180 / 365 天或永不过期，撤销立即生效；
4. **独立配额**：令牌维度固定窗口限流（默认 120 次/分钟），与全局 read/write 桶叠加；
5. **不依赖 VPS / LLM**：全部为 D1 只读聚合或既有写路径，VPS 不可用时仍可用；
6. **公开数据边界**：热榜为公开数据，其余接口只返回令牌所属用户的数据。

## 3. 数据模型

D1 迁移 `0021_open_api_tokens.sql`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | `oat_` + 16 位十六进制 |
| `user_id` | TEXT | 所属用户 |
| `label` | TEXT | 备注（默认「开放 API」，≤60 字） |
| `token_hash` | TEXT UNIQUE | SHA-256 摘要 |
| `hint` | TEXT | 尾号提示，如 `ofa_…a1b2` |
| `scopes` | TEXT | 逗号分隔：`read` / `write` |
| `expires_at` | TEXT | ISO 时间；NULL 表示永不过期 |
| `created_at` / `last_used_at` / `revoked_at` | TEXT | 生命周期字段 |

索引：`(user_id, created_at DESC)`。

## 4. 接口契约

### 4.1 令牌管理（Cookie 会话）

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/open/tokens` | GET | 当前用户令牌列表，最多 100 条，不含 `token_hash` |
| `/api/open/tokens` | POST | 创建令牌：`label` / `scopes`（`read` / `write`）/ `expiresInDays`（0 = 永不过期，默认 90） |
| `/api/open/tokens/:id` | DELETE | 撤销令牌（软删 `revoked_at`） |

创建响应：`{ token: "ofa_…", item: { id, label, hint, scopes, expiresAt, … } }`，明文只出现一次。
单用户最多 20 个有效令牌，超出返回 `400 too_many_tokens`。

### 4.2 开放 API（Bearer）

统一响应错误：`401 unauthorized` / `401 token_expired` / `403 insufficient_scope` / `429 rate_limited`。

| 端点 | 方法 | 作用域 | 参数 |
| --- | --- | --- | --- |
| `/api/open/v1/me` | GET | read | — |
| `/api/open/v1/repos` | GET | read | `q` / `category` / `tag` / `language` / `sort=stars\|updated\|name` / `limit` / `offset` |
| `/api/open/v1/repos/:owner/:name` | GET | read | — |
| `/api/open/v1/repos` | POST | write | `fullName` 或 `url`，可选 `description` / `language` / `stars` / `forks` / `platform` |
| `/api/open/v1/categories` | GET | read | — |
| `/api/open/v1/recommendations` | GET | read | `status=new\|saved\|dismissed\|pushed\|all` / `limit` / `offset` |
| `/api/open/v1/trending` | GET | read | `date` / `language` / `limit` |
| `/api/open/v1/search` | GET | read | `q`（必填）/ `scope=my\|trending\|all` / `language` / `limit` |
| `/api/open/v1/stats` | GET | read | — |

分页响应统一 `{ items, total, limit, offset, hasMore }`（列表类）。

## 5. 交付物

| 文件 | 说明 |
| --- | --- |
| `edge/migrations/0021_open_api_tokens.sql` | 令牌表与索引 |
| `edge/src/open-api/helpers.ts` | 令牌生成 / 作用域 / 过期 / 仓库参数纯函数 |
| `edge/src/routes/open-api.ts` | 令牌管理 + `/api/open/v1/*` 路由与 Bearer 中间件 |
| `edge/src/index.ts` | 挂载 `/api/open/tokens` 与 `/api/open/v1` |
| `edge/src/types.ts` | `OpenApiTokenRow` 与 Variables 扩展 |
| `edge/scripts/open-api.test.mjs` | 纯函数与路由契约用例 |
| `admin/src/features/open-api/` | 令牌管理页、API 封装、演示数据、工具函数与 Vitest |
| `admin/src/routes/_authenticated/settings/api.tsx` | 文件式路由 |
| `admin/src/features/settings/index.tsx` + `sidebar-data.ts` | 设置导航入口 |
| `docs/guides/open-api.md` | 使用指南（鉴权 / 作用域 / 端点 / 示例 / 配额） |
| `docs/architecture/overview.md` / `data-model.md` / `assets/d1-schema.sql` | 接口边界与数据模型同步 |
| `docs/requirements/backlog.md` / `planning/roadmap.md` / `planning/task-planning.md` | M8-05 状态与交付记录 |

## 6. 测试与验收

| 层 | 用例 |
| --- | --- |
| edge 纯函数 | 令牌格式 / 尾号、作用域归一化、过期天数、仓库 fullName / URL 解析 |
| edge 路由 | 未带令牌 401、无效 / 过期令牌 401、read 令牌写收藏 403、write 令牌收藏、令牌创建仅返回一次明文、撤销、用户隔离、限流响应头 |
| admin 单元 | 作用域 / 状态文案、日期格式化、过期判断、演示数据筛选 |
| 回归 | edge `npm run typecheck` + `npm test`；admin `npm run lint` + `npm run build` + `npm run test`；vps `pytest -q` |

验收标准：

1. 设置页可创建 / 复制 / 撤销令牌，明文只展示一次；
2. 使用 `Authorization: Bearer ofa_…` 可读取本人收藏、分类、推荐、统计，并可按关键词检索；
3. `write` 令牌可收藏仓库，重复收藏幂等，他人已收藏返回 409；
4. 无令牌 / 过期 / 撤销令牌返回 401，只读令牌写操作返回 403；
5. 令牌维度限流生效并返回 `X-RateLimit-*`；
6. 三端检查全绿，文档同步更新。

## 7. 风险与后续

- **令牌泄露**：只存摘要、支持撤销与过期；后续可加 IP 白名单 / 最后使用地点审计；
- **作用域粒度**：当前 read / write 两档，后续可按资源拆分为 `repos:read`、`recommendations:read` 等；
- **公开 API 稳定性**：`/api/open/v1` 作为版本化契约，破坏性变更走 v2；
- **跨用户重复收藏**：沿用现有 `my_repositories` 以 `owner/repo` 为主键的限制，他人已收藏返回 409（open-questions Q31）。
