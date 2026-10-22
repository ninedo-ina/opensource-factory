# 开放 API 使用指南（M8-05 / REQ-202610-0974）

开放 API 为个人用户提供**可自助创建、可撤销、可过期**的令牌，让 CLI、脚本、Raycast / 快捷指令等
第三方工具在不携带浏览器 Cookie 的情况下访问自己的收藏数据。

> 当前版本：`v1`（路径前缀 `/api/open/v1`）。破坏性变更会发布 `v2`，不会原地修改 `v1` 契约。

## 1. 创建令牌

1. 登录 admin，进入 **设置 → 开放 API**（`/settings/api`）；
2. 填写备注（建议按工具区分，如「CLI 工具」「Raycast」）；
3. 选择权限：
   - **只读**（`read`）：读取收藏、分类、标签、推荐、热榜与统计；
   - **读写**（`write`）：在只读之上允许 `POST /api/open/v1/repos` 收藏仓库；
4. 选择有效期（30 / 90 / 180 / 365 天或永不过期，默认 90 天）；
5. 创建后**立即复制明文令牌**——它只显示一次，服务端只保存 SHA-256 摘要。

令牌格式：`ofa_` + 64 位小写十六进制，例如 `ofa_0123…`（示例已截断）。

> 安全建议：把令牌放进环境变量或密码管理器，不要提交到 Git；不同工具使用不同令牌，泄露时可单独撤销。

## 2. 鉴权

所有 `/api/open/v1/*` 请求都使用 Bearer 头：

```bash
export OPENFACTORY_TOKEN='ofa_…'
curl -sS https://<edge-host>/api/open/v1/me \
  -H "Authorization: Bearer $OPENFACTORY_TOKEN"
```

响应：

```json
{
  "apiVersion": "v1",
  "user": { "id": "u_xxx", "login": "octocat", "name": "Octo Cat", "avatarUrl": "…" },
  "token": {
    "id": "oat_…",
    "label": "CLI 工具",
    "hint": "ofa_…a1b2",
    "scopes": ["read"],
    "createdAt": "2026-10-22T00:00:00.000Z",
    "lastUsedAt": null,
    "expiresAt": "2027-01-20T00:00:00.000Z",
    "revokedAt": null,
    "status": "active"
  }
}
```

错误码：

| HTTP | `error` | 含义 |
| --- | --- | --- |
| 401 | `unauthorized` | 未带令牌 / 格式错误 / 已撤销 / 已过期 / 用户不存在 |
| 403 | `insufficient_scope` | 只读令牌调用了写接口（`required: "write"`） |
| 429 | `rate_limited` | 超过令牌维度配额，响应带 `Retry-After` |
| 400 | `invalid_*` | 参数非法（仓库地址、日期、状态、查询词等） |
| 409 | `repo_owned_by_other_user` | 该仓库已被其他用户收藏（当前实例以 `owner/repo` 为主键） |

## 3. 端点

### 3.1 账户

| 方法 | 路径 | 作用域 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/open/v1/me` | read | 当前用户与令牌信息 |

### 3.2 收藏

| 方法 | 路径 | 作用域 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/open/v1/repos` | read | 收藏列表，支持 `q` / `category` / `tag` / `language` / `sort` / `limit` / `offset` |
| GET | `/api/open/v1/repos/:owner/:name` | read | 单个收藏详情（仅本人） |
| POST | `/api/open/v1/repos` | write | 收藏仓库；body 支持 `fullName` 或 `url`，可选 `description` / `language` / `stars` / `forks` / `platform` |

列表参数：

- `q`：名称 / `owner/repo` / 描述 / 摘要模糊匹配；
- `category`：分类 id；
- `tag`：标签名（精确匹配）；
- `language`：语言（不区分大小写）；
- `sort`：`stars`（默认）/ `updated` / `name`；
- `limit`：1~200，默认 50；`offset`：默认 0。

列表响应：

```json
{
  "items": [
    {
      "id": "acme/demo",
      "fullName": "acme/demo",
      "description": "演示仓库",
      "summary": "中文摘要",
      "language": "TypeScript",
      "stars": 100,
      "forks": 10,
      "category": "AI",
      "tags": ["ai", "typescript"],
      "updatedAt": "2026-10-20T00:00:00.000Z",
      "url": "https://github.com/acme/demo",
      "health": { "status": "active", "score": 88 },
      "license": { "spdx": "MIT", "name": "MIT License", "level": "permissive" }
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "hasMore": false
}
```

收藏示例：

```bash
curl -sS -X POST https://<edge-host>/api/open/v1/repos \
  -H "Authorization: Bearer $OPENFACTORY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/acme/demo","description":"演示","language":"TypeScript","stars":100}'
```

同一用户重复收藏返回 `200` + `created: false`；仓库已属于其他用户返回 `409`。

### 3.3 分类与标签

| 方法 | 路径 | 作用域 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/open/v1/categories` | read | 分类（含当前用户仓库计数）与标签云（Top 100） |

### 3.4 推荐与热榜

| 方法 | 路径 | 作用域 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/open/v1/recommendations` | read | 推荐列表，`status=new\|saved\|dismissed\|pushed\|all`，分页同收藏 |
| GET | `/api/open/v1/trending` | read | 公开热榜，`date=YYYY-MM-DD` / `language` / `limit`；默认最新快照 |

### 3.5 搜索与统计

| 方法 | 路径 | 作用域 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/open/v1/search` | read | 关键词检索，`q` 必填（1~200 字符），`scope=my\|trending\|all`，`language`，`limit` |
| GET | `/api/open/v1/stats` | read | 收藏总数 / Star 总数 / 语言 / 分类 / 标签分布 |

搜索示例：

```bash
curl -sS 'https://<edge-host>/api/open/v1/search?q=vector&scope=all&limit=10' \
  -H "Authorization: Bearer $OPENFACTORY_TOKEN"
```

## 4. 配额与限流

- 每个令牌默认 **120 次/分钟**（固定窗口），可通过 Worker 变量 `OPEN_API_RATE_PER_MINUTE` 调整；
- 响应头：`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`（Unix 秒）；
- 超限返回 `429 { "error": "rate_limited", "retryAfterSeconds": n }` 与 `Retry-After`；
- 开放 API 仍叠加全局 read / write 限流桶（按用户或 IP），两层同时生效；
- 每个用户最多保留 **20 个有效令牌**，撤销后不计入上限。

## 5. 令牌生命周期

- **最近使用**：每次成功鉴权后按分钟节流更新 `last_used_at`，可在设置页查看；
- **撤销**：设置页点击撤销，立即生效（后续请求 401），不可恢复；
- **过期**：到期后自动失效，返回 401；过期令牌仍保留在列表中便于排查；
- **轮换**：建议先创建新令牌、切换工具、确认可用后再撤销旧令牌。

## 6. 数据边界

- 所有收藏 / 分类 / 推荐 / 统计查询都强制 `user_id = 当前令牌用户`；
- 热榜为公开数据，不包含任何用户私有信息；
- 令牌只存摘要，接口与日志都不回显明文；`hint` 仅保留尾号 4 位；
- 当前作用域只有 `read` / `write` 两档；更细的资源级作用域见
  [open-questions.md](../requirements/open-questions.md) Q35。

## 7. 实现位置

| 层 | 文件 |
| --- | --- |
| 迁移 | `edge/migrations/0021_open_api_tokens.sql` |
| 纯函数 | `edge/src/open-api/helpers.ts` |
| 路由 / 鉴权 | `edge/src/routes/open-api.ts` |
| 挂载 | `edge/src/index.ts`（`/api/open/tokens`、`/api/open/v1`） |
| admin 页面 | `admin/src/features/open-api/`、`admin/src/routes/_authenticated/settings/api.tsx` |
| 测试 | `edge/scripts/open-api.test.mjs`、`admin/src/features/open-api/open-api.test.ts` |
