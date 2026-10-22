# 实施计划 · REQ-202610-0975 CLI 工具（命令行查询 / 收藏）

> 需求：REQ-202610-0975（backlog M8-06）｜ 分支：`feat/req-202610-0975-cli-tool`
> 依赖：M8-05 开放 API（个人令牌，平台仍为 pending）
> 目标：提供可在终端使用的 `of` 命令，完成登录、查询收藏、搜索、查看详情、收藏 / 取消收藏、热榜与推荐查看。

## 1. 现状与缺口

- 收藏库、搜索、热榜、推荐能力都已落在 edge，但只接受浏览器会话 Cookie；
- M8-05 开放 API（个人令牌）尚未实现，CLI 没有可用的长期凭据；
- 终端用户无法在不打开后台的情况下快速查询自己的收藏，也无法把「收藏一个仓库」接进脚本；
- 现有 `admin` 的 API 响应面向页面，字段较多，不适合直接作为命令行契约。

## 2. 方案总览

```
of（Node.js CLI，零运行时依赖）
  ├─ 读取 ~/.config/openfactory/config.json（0600）
  ├─ Authorization: Bearer ofp_…
  └─ edge /api/v1/*（版本化只读 / 写入契约）
        ├─ GET    /api/v1/me
        ├─ GET    /api/v1/repos?q=&language=&category=&tag=&limit=&offset=
        ├─ GET    /api/v1/repos/:owner/:name
        ├─ POST   /api/v1/repos            # 收藏（幂等）
        ├─ DELETE /api/v1/repos/:owner/:name
        ├─ GET    /api/v1/search?q=
        ├─ GET    /api/v1/trending
        └─ GET    /api/v1/recommendations

admin 设置 → 开放 API（/settings/api-tokens）
  ├─ GET    /api/tokens       会话登录态，列出个人令牌
  ├─ POST   /api/tokens       创建令牌（明文只返回一次）
  └─ DELETE /api/tokens/:id   撤销令牌
```

设计原则：

1. **令牌只存摘要**：`api_tokens.token_hash` 存 SHA-256，明文只在创建时返回一次；
2. **作用域最小化**：`read` / `write` 两个 scope，读接口只要求 `read`，收藏 / 取消要求 `write`；
3. **版本化契约**：CLI 只依赖 `/api/v1/*`，不耦合后台页面字段；
4. **零依赖 CLI**：只使用 Node.js 18+ 内置模块（`fetch` / `readline` / `fs`），降低安装与供应链成本；
5. **可脚本化**：所有命令支持 `--json`，错误走 stderr 与非零退出码；
6. **离线可测**：CLI 单测注入 `fetch`，edge 路由单测使用 fake D1，不依赖网络。

## 3. 数据模型

`api_tokens`（D1 迁移 `0021_api_tokens.sql`）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 令牌 id |
| `user_id` | TEXT | 用户 id |
| `label` | TEXT | 展示名称（默认「CLI 令牌」） |
| `token_hash` | TEXT UNIQUE | SHA-256 摘要 |
| `hint` | TEXT | 脱敏提示（如 `ofp_ab12…cd34`） |
| `scopes` | TEXT | 空格分隔的 scope，默认 `read write` |
| `created_at` | TEXT | 创建时间 |
| `last_used_at` | TEXT | 最近使用（按分钟节流更新） |
| `revoked_at` | TEXT | 撤销时间 |
| `expires_at` | TEXT | 预留过期时间，当前为空 |

索引：`(user_id, created_at DESC)`；每用户最多 20 个有效令牌。

## 4. 接口契约

### 4.1 令牌管理（会话登录态）

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/tokens` | GET | 列出当前用户令牌（含已撤销，最多 100 条） |
| `/api/tokens` | POST | 创建令牌 `{label?, scopes?}`，返回 `{token, item}` |
| `/api/tokens/:id` | DELETE | 撤销令牌 |

令牌管理接口只接受 `of_session` Cookie；用 Bearer 令牌调用返回 401 `session_required`。

### 4.2 开放 API（Bearer）

- `Authorization: Bearer ofp_<48 hex>`；
- 401 `unauthorized`：缺失 / 无效 / 已撤销；
- 403 `insufficient_scope`：令牌缺少所需 scope；
- 404 `not_found`：仓库不在当前用户收藏中。

`GET /api/v1/repos` 返回：

```json
{
  "total": 12,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": "owner/repo",
      "fullName": "owner/repo",
      "description": "…",
      "summary": "…",
      "language": "TypeScript",
      "stars": 128,
      "forks": 12,
      "category": "AI/LLM",
      "tags": ["llm"],
      "url": "https://github.com/owner/repo",
      "updatedAt": "2026-10-22T08:00:00Z",
      "createdAt": "2026-10-01 08:00:00"
    }
  ]
}
```

`POST /api/v1/repos` 请求：

```json
{
  "repo": "owner/repo 或 https://github.com/owner/repo",
  "description": "可选",
  "language": "可选",
  "stars": 0,
  "forks": 0
}
```

`GET /api/v1/trending` 与 `GET /api/v1/recommendations` 返回精简 DTO，字段见 `docs/guides/cli.md`。

## 5. CLI 命令

| 命令 | 说明 |
| --- | --- |
| `of login --url <edge> --token <token>` | 校验令牌并写入配置 |
| `of logout` | 清除本地令牌 |
| `of whoami` | 查看当前用户与令牌信息 |
| `of list [query]` | 列出 / 筛选收藏（`--language` / `--category` / `--tag` / `--limit` / `--offset`） |
| `of search <query>` | 收藏库关键词搜索 |
| `of show <repo>` | 查看仓库详情 |
| `of add <repo>` | 收藏仓库（默认从 GitHub API 补全元数据，`--no-fetch` 可关闭） |
| `of remove <repo> --yes` | 取消收藏 |
| `of trending` | 热榜（`--language` / `--limit`） |
| `of recommend` | 推荐（`--limit` / `--status`） |
| `of config get/set` | 查看 / 修改 `apiUrl`、`defaultLimit` |

全局参数：`--json`、`--no-color`、`--api-url`、`--token`、`--help`、`--version`。
退出码：0 成功；1 运行错误；2 用法错误。

## 6. 交付物

| 文件 | 说明 |
| --- | --- |
| `edge/migrations/0021_api_tokens.sql` | 个人令牌表 |
| `edge/src/api-tokens/helpers.ts` | 令牌生成 / 归一化 / DTO / 仓库引用解析（纯函数） |
| `edge/src/api-tokens/auth.ts` | Bearer 解析、令牌查询、last_used 节流 |
| `edge/src/routes/api-tokens.ts` | `/api/tokens` 管理接口 |
| `edge/src/routes/v1.ts` | `/api/v1/*` 开放 API |
| `edge/src/index.ts` / `types.ts` | 挂载路由、初始化 `apiToken` 上下文 |
| `edge/scripts/api-tokens.test.mjs` | 纯函数 + 路由鉴权 / scope / 收藏用例 |
| `cli/` | `of` CLI（bin / src / test / README） |
| `admin/src/features/api-tokens/*` + 路由 | 设置页令牌管理、一次性明文展示、CLI 指引 |
| `docs/guides/cli.md` | 安装、登录、命令、JSON 输出、退出码 |
| 文档 | 本计划、架构总览、数据模型、D1 schema、backlog、roadmap、task-planning、open-questions、README |

## 7. 测试与验收

| 层 | 用例 |
| --- | --- |
| edge 纯函数 | 令牌格式 / 生成、label 归一化、scope 归一化、仓库引用解析、DTO 脱敏 |
| edge 路由 | 未登录 401、会话创建 / 列表 / 撤销、Bearer me、scope 403、收藏幂等、跨用户 409、查询筛选、热榜 / 推荐 |
| CLI 单元 | 参数解析、配置读写 / 权限、URL 归一化、表格格式化、仓库引用解析、HTTP 错误映射、命令分发（注入 fetch） |
| admin | 令牌格式化 / CLI 命令生成 / 演示数据单测；lint / build / Vitest |
| 回归 | edge `npm run typecheck` + `npm test`；admin `npm run lint/build/test`；vps `pytest -q`；`cli npm test` |

验收标准：

1. 后台可创建 / 复制 / 撤销个人令牌，明文只展示一次；
2. `of login` 能校验令牌并保存 0600 配置；
3. `of list` / `of search` / `of show` 只返回当前用户收藏；
4. `of add` 能收藏 GitHub 仓库且重复执行幂等，`of remove` 能取消；
5. `of trending` / `of recommend` 输出可读表格，`--json` 可被脚本解析；
6. 未登录 / 无效令牌 / 缺少 scope 均有明确错误；
7. 三端与 CLI 检查全绿，文档同步。

## 8. 风险与后续

- **M8-05 平台仍 pending**：本期实现最小可用的个人令牌与 `/api/v1` 契约，作为 CLI 的依赖基线；后续 M8-05 若扩展 OAuth / 配额，可在同一张表上增量演进；
- **跨用户重复收藏**：`my_repositories.id` 仍是全局主键，同一仓库被他人收藏时返回 409（沿用 Q31 口径）；
- **GitHub 元数据**：本期 `of add` 不调用 GitHub API，只写入用户显式传入的 `--stars` / `--language` / `--description`；
  需要自动补全时由后续同步任务或 M8-05 扩展，避免 CLI 受匿名限流影响；
- **令牌撤销**：撤销立即生效；CLI 本地配置不会自动清除，需重新 `of login`；
- **Windows**：配置文件权限位在 Windows 上无效，但路径与命令可用；本期以 Linux / macOS 为主。

## 9. 实施结果（2026-10-22）

- 新增 D1 迁移 `0021_api_tokens.sql` 与 `docs/assets/d1-schema.sql` 同步；
- edge 新增 `/api/tokens` 管理接口与 `/api/v1/*` 开放 API（Bearer `ofp_` 令牌、`read` / `write` scope）；
- 新增 `cli/` 零依赖 Node.js CLI（`of`），覆盖登录、查询、搜索、详情、收藏、取消、热榜、推荐与配置；
- admin 新增「设置 → 开放 API」页面，支持创建 / 一次性复制 / 撤销令牌与 CLI 指引；
- 测试结果：edge `npm run typecheck` 通过、`npm test` 191/191；CLI `npm test` 37/37；admin `npm run lint` / `npm run build` 通过、`npm run test` 231/231（34 个文件）；vps `pytest -q` 532/532；
- 上线待办：部署前执行 D1 migration 0021，并部署 edge / admin；CLI 通过 npm link 或 `npx` 本地安装。
