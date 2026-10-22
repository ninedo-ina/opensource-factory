# OpenFactory CLI 使用手册（M8-06 / REQ-202610-0975）

`of` 是 OpenFactory 的零依赖命令行工具，用于查询收藏、搜索、收藏 / 取消收藏、查看热榜与推荐。
底层调用开放 API `/api/v1/*`，使用个人令牌鉴权（M8-05）。

## 1. 前置条件

| 项 | 要求 |
| --- | --- |
| Node.js | ≥ 18（使用内置 `fetch`） |
| 令牌 | 后台 **设置 → 开放 API** 创建，格式 `ofp_` + 48 位十六进制 |
| 网络 | 能访问 edge API（生产为 `https://api.<domain>`） |

令牌只保存 SHA-256 摘要；明文仅在创建时显示一次。令牌等同密码，禁止提交到 Git 或贴到聊天工具。

## 2. 安装与登录

```bash
cd cli
npm link            # 全局命令 of
# 或：node bin/of.js --help

of config set url https://api.example.com
of login --token ofp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
of whoami
```

`of login` 会先调用 `GET /api/v1/me` 校验令牌，成功后才写入配置。

## 3. 命令

```bash
of list [--q 关键词] [--language TypeScript] [--category 工具] [--tag cli]
        [--limit 50] [--offset 0] [--json]
of search <关键词> [--limit 20] [--json]
of show <owner/repo|URL> [--json]
of add <owner/repo|URL> [--stars 70000] [--language Zig] [--description "..."] [--json]
of remove <owner/repo|URL> --yes [--json]
of trending [--language Go] [--limit 20] [--json]
of recommend [--status new|saved|dismissed|all] [--limit 20] [--json]
```

- `add` 幂等：已收藏时更新元数据并返回 `created: false`；仓库已被其他用户收藏时返回 409。
- `remove` 必须显式传 `--yes`，避免误删。
- 所有查询命令支持 `--json`，输出结构与 `/api/v1` 响应一致，便于 `jq` 等工具处理。

## 4. 配置与环境变量

| 优先级 | 来源 |
| --- | --- |
| 1 | 命令行 `--url` / `--token` |
| 2 | `OF_API_URL` / `OF_TOKEN` |
| 3 | `~/.config/openfactory/config.json` |

- 配置文件权限 `0600`，目录 `0700`；`OF_CONFIG_DIR` 可覆盖目录（测试 / 多环境隔离）。
- `of config` 查看当前配置（令牌脱敏）；`of config unset token` 删除令牌但保留地址。
- 退出码：`0` 成功、`1` 请求失败、`2` 参数 / 用法错误（含未登录）。

## 5. 令牌与权限

| scope | 能力 |
| --- | --- |
| `read` | `/me`、收藏列表 / 详情、搜索、热榜、推荐 |
| `write` | 收藏 / 取消收藏（同时包含 read） |

- 每个用户最多 20 个有效令牌；设置页可随时撤销，撤销后立即失效。
- `last_used_at` 按分钟节流更新，设置页可见。
- 管理接口 `/api/tokens` 只接受会话 Cookie：Bearer 令牌不能创建 / 撤销令牌。

## 6. 故障排查

| 现象 | 处理 |
| --- | --- |
| `尚未登录` | `of login --token …`，或设置 `OF_TOKEN` |
| `认证失败：令牌无效或已过期` | 在设置页确认令牌未撤销，重新创建并登录 |
| `权限不足` | 令牌缺 `write`，重新创建时勾选写入 |
| `无法连接` | 检查 `of config` 的 API 地址与网络 |
| `HTTP 409 repo_owned_by_other_user` | 该仓库已被其他用户收藏；当前实例按 `my_repositories.id` 唯一 |

## 7. 实现位置

| 端 | 文件 |
| --- | --- |
| CLI | `cli/`（`bin/of.js` + `src/*`，零运行时依赖） |
| 令牌管理 | `edge/src/routes/api-tokens.ts`、`edge/src/api-tokens/*` |
| 开放 API | `edge/src/routes/v1.ts` |
| 数据表 | `edge/migrations/0021_api_tokens.sql` |
| 后台页面 | `admin/src/features/api-tokens/`、`/settings/api-tokens` |
