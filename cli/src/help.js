/** CLI 帮助文本。 */

export const GENERAL_HELP = `OpenFactory CLI — 命令行查询 / 收藏开源项目

用法：
  of <command> [参数] [选项]

命令：
  login       使用个人令牌登录（令牌在后台「设置 → 开放 API」创建）
  logout      清除本地令牌
  whoami      查看当前登录用户与令牌信息
  list        列出我的收藏
  search      搜索我的收藏
  show        查看某个收藏仓库的详情
  add         收藏一个仓库
  remove      取消收藏
  trending    查看今日热榜
  recommend   查看推荐列表
  config      查看 / 修改本地配置

常用选项：
  --json              以 JSON 输出（便于脚本处理）
  --limit <n>         限制返回条数
  --language <lang>   按语言过滤
  -h, --help          查看帮助
  -v, --version       查看版本

示例：
  of login --token ofp_xxx
  of list --language TypeScript --limit 20
  of search rust --json
  of add https://github.com/oven-sh/bun
  of trending --language Go
  of recommend --status all --limit 10

环境变量：
  OF_API_URL     覆盖 API 地址（默认读取本地配置）
  OF_TOKEN       覆盖令牌（优先级高于配置文件）
  OF_CONFIG_DIR  覆盖配置目录（默认 ~/.config/openfactory）
`;

export const COMMAND_HELP = {
  login: `of login --token <ofp_…> [--url <api 地址>]

校验令牌并保存到本地配置（权限 0600）。令牌不会打印。
也可以先用 \`of config set url <地址>\` 设置 API 地址。`,
  logout: `of logout

删除本地保存的令牌，保留 API 地址。`,
  whoami: `of whoami [--json]

查看当前用户、令牌 hint 与 scope。`,
  list: `of list [--q <关键词>] [--language <语言>] [--category <分类>]
        [--tag <标签>] [--limit <n>] [--offset <n>] [--json]

列出当前用户的收藏仓库。`,
  search: `of search <关键词> [--limit <n>] [--json]

在当前用户的收藏中搜索（仓库名 / 描述 / 摘要）。`,
  show: `of show <owner/repo|URL> [--json]

查看单个收藏仓库详情。`,
  add: `of add <owner/repo|URL> [--stars <n>] [--language <语言>]
       [--description <描述>] [--json]

收藏仓库；重复收藏幂等。`,
  remove: `of remove <owner/repo|URL> --yes [--json]

取消收藏。为避免误删，必须显式传 --yes。`,
  trending: `of trending [--language <语言>] [--limit <n>] [--json]

查看今日热榜（最近一次快照）。`,
  recommend: `of recommend [--status new|saved|dismissed|all] [--limit <n>] [--json]

查看推荐列表。`,
  config: `of config                         查看当前配置（令牌脱敏）
of config get url                 读取 API 地址
of config set url <地址>          设置 API 地址
of config set token <ofp_…>       直接保存令牌（不校验）
of config unset token             删除令牌`,
};

/** @param {string} command */
export function helpFor(command) {
  return COMMAND_HELP[command] ?? GENERAL_HELP;
}
