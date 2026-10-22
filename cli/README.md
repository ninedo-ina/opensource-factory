# OpenFactory CLI（`of`）

零依赖的 OpenFactory 命令行工具：查询收藏、搜索、收藏 / 取消收藏、查看热榜与推荐。

- 依赖：Node.js ≥ 18（使用内置 `fetch`）
- 鉴权：个人开放 API 令牌（`ofp_` 开头），在后台 **设置 → 开放 API** 创建
- 令牌只保存在本地配置文件（权限 0600），不会上传或打印

## 安装

```bash
cd cli
npm link          # 全局安装 `of`
# 或者不安装，直接运行：
node bin/of.js --help
```

## 快速开始

```bash
# 1. 配置 API 地址（生产环境替换为实际 Worker 地址）
of config set url https://api.example.com

# 2. 登录（令牌明文只显示一次）
of login --token ofp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 3. 常用查询
of whoami
of list --language TypeScript --limit 20
of search rust
of show oven-sh/bun
of trending --language Go
of recommend --status new --limit 10

# 4. 收藏 / 取消收藏
of add https://github.com/oven-sh/bun --stars 70000 --language Zig
of remove oven-sh/bun --yes
```

## 命令

| 命令 | 说明 |
| --- | --- |
| `of login --token <ofp_…>` | 校验令牌并保存到本地 |
| `of logout` | 清除本地令牌 |
| `of whoami` | 查看当前用户与令牌信息 |
| `of list` | 列出收藏（`--q/--language/--category/--tag/--limit/--offset`） |
| `of search <关键词>` | 在收藏中搜索 |
| `of show <owner/repo\|URL>` | 查看仓库详情 |
| `of add <owner/repo\|URL>` | 收藏仓库（幂等） |
| `of remove <owner/repo\|URL> --yes` | 取消收藏 |
| `of trending` | 今日热榜（`--language/--limit`） |
| `of recommend` | 推荐列表（`--status new\|saved\|dismissed\|all`） |
| `of config` | 查看 / 修改本地配置 |

所有查询命令都支持 `--json`，便于脚本处理。

## 配置

| 优先级 | 来源 |
| --- | --- |
| 1 | 命令行 `--url` / `--token` |
| 2 | 环境变量 `OF_API_URL` / `OF_TOKEN` |
| 3 | 配置文件 `~/.config/openfactory/config.json`（`OF_CONFIG_DIR` 可覆盖） |

```bash
of config                    # 查看（令牌脱敏）
of config set url <地址>
of config set token <ofp_…>
of config unset token
```

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 请求失败（网络 / 401 / 403 / 服务端错误） |
| 2 | 参数或用法错误（含未登录） |

## 开发

```bash
npm test
```
