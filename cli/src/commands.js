/**
 * 子命令实现。
 *
 * 每个命令接收统一的 ctx：
 *   { client, config, configFile, apiUrl, flags, positionals, out, saveConfig, clearToken, makeClient }
 * 命令只负责业务编排，参数校验失败抛 UsageError，接口失败抛 ApiError。
 */
import { UsageError, boolFlag, intFlag, stringFlag } from './args.js';
import { maskToken, normalizeApiUrl } from './config.js';
import { parseRepoReference } from './repo.js';
import {
  formatMe,
  formatRecommendations,
  formatRepoDetail,
  formatRepoList,
  formatTrending,
  printJson,
} from './format.js';

function requireRepo(ctx) {
  const raw = ctx.positionals[0] ?? stringFlag(ctx.flags, 'repo');
  if (!raw) throw new UsageError('请提供仓库：owner/repo 或 GitHub / Gitee URL');
  const repo = parseRepoReference(raw);
  if (!repo) throw new UsageError(`无法识别的仓库引用：${raw}`);
  return repo;
}

function jsonMode(ctx) {
  return boolFlag(ctx.flags, 'json');
}

function limitOf(ctx, fallback = 50) {
  return intFlag(ctx.flags, 'limit', fallback);
}

export async function login(ctx) {
  const token = stringFlag(ctx.flags, 'token') || ctx.positionals[0] || '';
  if (!token) {
    throw new UsageError(
      '请提供个人令牌：of login --token ofp_…\n令牌在后台「设置 → 开放 API」创建，明文只显示一次。'
    );
  }
  if (!/^ofp_[a-f0-9]{48}$/.test(token)) {
    throw new UsageError('令牌格式不正确：应为 ofp_ 开头的 48 位十六进制字符串');
  }
  const client = ctx.makeClient({ token });
  const me = await client.get('/api/v1/me');
  ctx.saveConfig({ apiUrl: ctx.apiUrl, token });
  if (jsonMode(ctx)) {
    printJson(ctx.out, { ok: true, user: me.user, token: me.token });
    return;
  }
  ctx.out(`已登录为 ${me.user.login}${me.user.name ? `（${me.user.name}）` : ''}`);
  ctx.out(`令牌：${me.token?.hint ?? maskToken(token)}    已保存到 ${ctx.configFile}`);
}

export async function logout(ctx) {
  ctx.clearToken();
  if (jsonMode(ctx)) {
    printJson(ctx.out, { ok: true });
    return;
  }
  ctx.out('已清除本地令牌。');
}

export async function whoami(ctx) {
  const me = await ctx.client.get('/api/v1/me');
  if (jsonMode(ctx)) {
    printJson(ctx.out, me);
    return;
  }
  ctx.out(formatMe(me));
}

export async function list(ctx) {
  const payload = await ctx.client.get('/api/v1/repos', {
    q: stringFlag(ctx.flags, 'q'),
    language: stringFlag(ctx.flags, 'language'),
    category: stringFlag(ctx.flags, 'category'),
    tag: stringFlag(ctx.flags, 'tag'),
    limit: limitOf(ctx),
    offset: intFlag(ctx.flags, 'offset', 0),
  });
  if (jsonMode(ctx)) {
    printJson(ctx.out, payload);
    return;
  }
  ctx.out(formatRepoList(payload));
}

export async function search(ctx) {
  const query = ctx.positionals.join(' ').trim() || stringFlag(ctx.flags, 'q');
  if (!query) throw new UsageError('用法：of search <关键词>');
  const payload = await ctx.client.get('/api/v1/search', {
    q: query,
    limit: limitOf(ctx, 20),
  });
  if (jsonMode(ctx)) {
    printJson(ctx.out, payload);
    return;
  }
  if (!payload.items?.length) {
    ctx.out(`没有找到与「${query}」匹配的收藏。`);
    return;
  }
  ctx.out(`搜索「${query}」：${payload.count} 条结果`);
  ctx.out(formatRepoList({ items: payload.items, total: payload.count }));
}

export async function show(ctx) {
  const repo = requireRepo(ctx);
  const payload = await ctx.client.get(
    `/api/v1/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
  );
  if (jsonMode(ctx)) {
    printJson(ctx.out, payload);
    return;
  }
  ctx.out(formatRepoDetail(payload));
}

export async function add(ctx) {
  const repo = requireRepo(ctx);
  const body = { repo: repo.fullName };
  const stars = intFlag(ctx.flags, 'stars', 0);
  if (stars > 0) body.stars = stars;
  const language = stringFlag(ctx.flags, 'language');
  if (language) body.language = language;
  const description = stringFlag(ctx.flags, 'description');
  if (description) body.description = description;

  const payload = await ctx.client.post('/api/v1/repos', body);
  if (jsonMode(ctx)) {
    printJson(ctx.out, payload);
    return;
  }
  ctx.out(
    payload.created
      ? `已收藏 ${payload.repo?.fullName ?? repo.fullName}`
      : `${payload.repo?.fullName ?? repo.fullName} 已在收藏中（已更新元数据）`
  );
}

export async function remove(ctx) {
  const repo = requireRepo(ctx);
  if (!boolFlag(ctx.flags, 'yes') && !boolFlag(ctx.flags, 'force')) {
    throw new UsageError(`确认取消收藏 ${repo.fullName}？请加 --yes 后重试。`);
  }
  const payload = await ctx.client.delete(
    `/api/v1/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
  );
  if (jsonMode(ctx)) {
    printJson(ctx.out, payload);
    return;
  }
  ctx.out(`已取消收藏 ${repo.fullName}`);
}

export async function trending(ctx) {
  const payload = await ctx.client.get('/api/v1/trending', {
    language: stringFlag(ctx.flags, 'language'),
    limit: limitOf(ctx, 20),
  });
  if (jsonMode(ctx)) {
    printJson(ctx.out, payload);
    return;
  }
  ctx.out(formatTrending(payload));
}

export async function recommend(ctx) {
  const payload = await ctx.client.get('/api/v1/recommendations', {
    status: stringFlag(ctx.flags, 'status'),
    limit: limitOf(ctx, 20),
  });
  if (jsonMode(ctx)) {
    printJson(ctx.out, payload);
    return;
  }
  ctx.out(formatRecommendations(payload));
}

export async function config(ctx) {
  const [action, key, value] = ctx.positionals;
  if (!action) {
    const token = ctx.config.token;
    if (jsonMode(ctx)) {
      printJson(ctx.out, {
        apiUrl: ctx.apiUrl,
        configFile: ctx.configFile,
        token: token ? maskToken(token) : null,
        tokenSource: ctx.env.OF_TOKEN ? 'env' : token ? 'file' : null,
      });
      return;
    }
    ctx.out(`API 地址：${ctx.apiUrl}`);
    ctx.out(`配置文件：${ctx.configFile}`);
    ctx.out(`令牌：${token ? maskToken(token) : '未配置'}${ctx.env.OF_TOKEN ? '（来自 OF_TOKEN）' : ''}`);
    return;
  }

  if (action === 'get' && key === 'url') {
    ctx.out(ctx.apiUrl);
    return;
  }

  if (action === 'set') {
    if (key === 'url') {
      const url = normalizeApiUrl(value ?? '');
      if (!url) throw new UsageError('用法：of config set url <地址>');
      ctx.saveConfig({ ...ctx.config, apiUrl: url });
      ctx.out(`API 地址已设置为 ${url}`);
      return;
    }
    if (key === 'token') {
      const token = (value ?? '').trim();
      if (!token) throw new UsageError('用法：of config set token <ofp_…>');
      ctx.saveConfig({ ...ctx.config, token });
      ctx.out(`令牌已保存（${maskToken(token)}）`);
      return;
    }
  }

  if (action === 'unset' && key === 'token') {
    ctx.clearToken();
    ctx.out('已删除本地令牌。');
    return;
  }

  throw new UsageError('用法：of config [get url | set url <地址> | set token <令牌> | unset token]');
}

export const COMMANDS = {
  login,
  logout,
  whoami,
  list,
  search,
  show,
  add,
  remove,
  trending,
  recommend,
  config,
};
