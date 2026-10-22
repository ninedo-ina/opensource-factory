/**
 * CLI 主流程：解析参数 → 组装上下文 → 分发命令 → 统一错误处理。
 * 通过 deps 注入 IO / 配置 / 客户端，方便单测。
 */
import { readFileSync } from 'node:fs';

import { UsageError, boolFlag, parseArgs, stringFlag } from './args.js';
import {
  DEFAULT_API_URL,
  clearToken as clearStoredToken,
  configPath,
  loadConfig,
  normalizeApiUrl,
  saveConfig as saveStoredConfig,
} from './config.js';
import { ApiError, createClient } from './client.js';
import { COMMANDS } from './commands.js';
import { GENERAL_HELP, helpFor } from './help.js';

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();

/**
 * @param {string[]} argv
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   out?: (line: string) => void,
 *   err?: (line: string) => void,
 *   config?: Record<string, string|undefined>,
 *   client?: import('./client.js').ApiClient,
 *   fetchImpl?: typeof fetch,
 * }} [deps]
 * @returns {Promise<number>} 退出码
 */
export async function run(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = deps.err ?? ((line) => process.stderr.write(`${line}\n`));

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`错误：${error.message}`);
      return 2;
    }
    throw error;
  }

  const { command, positionals, flags } = parsed;

  if (boolFlag(flags, 'version')) {
    out(`of ${VERSION}`);
    return 0;
  }

  if (!command) {
    out(GENERAL_HELP);
    return 0;
  }

  if (boolFlag(flags, 'help')) {
    out(helpFor(command));
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    err(`未知命令：${command}`);
    err('运行 `of --help` 查看可用命令。');
    return 2;
  }

  const storedConfig = deps.config ?? loadConfig(env);
  const apiUrl = normalizeApiUrl(stringFlag(flags, 'url') || env.OF_API_URL || storedConfig.apiUrl || DEFAULT_API_URL);
  const token = env.OF_TOKEN || storedConfig.token || '';
  const file = configPath(env);

  const makeClient = ({ token: overrideToken } = {}) =>
    createClient({ baseUrl: apiUrl, token: overrideToken ?? token, fetchImpl: deps.fetchImpl });

  const ctx = {
    env,
    flags,
    positionals,
    config: storedConfig,
    configFile: file,
    apiUrl,
    out,
    client: deps.client ?? makeClient(),
    makeClient,
    saveConfig: (next) => saveStoredConfig(next, env),
    clearToken: () => clearStoredToken(env),
  };

  if (!deps.client && !token && command !== 'login' && command !== 'config') {
    err('尚未登录。请先运行 `of login --token ofp_…`（令牌在后台「设置 → 开放 API」创建）。');
    return 2;
  }

  try {
    await handler(ctx);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err(`错误：${error.message}`);
      return 2;
    }
    if (error instanceof ApiError) {
      if (error.status === 401) {
        err('认证失败：令牌无效或已过期。请重新运行 `of login --token ofp_…`。');
      } else if (error.status === 403) {
        err(`权限不足：${error.message}（请使用具备对应 scope 的令牌）`);
      } else if (error.status === 0) {
        err(error.message);
      } else {
        err(`请求失败（HTTP ${error.status}）：${error.message}`);
      }
      return 1;
    }
    err(`发生错误：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
