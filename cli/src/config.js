/**
 * CLI 配置读写。
 *
 * 位置（优先级从高到低）：
 *   1. `OF_CONFIG_DIR` 环境变量
 *   2. `XDG_CONFIG_HOME/openfactory`
 *   3. `~/.config/openfactory`
 *
 * 文件权限 0600；令牌只存本地，不上传、不打印。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_API_URL = 'http://localhost:8787';
export const CONFIG_FILE_NAME = 'config.json';

/** @param {NodeJS.ProcessEnv} [env] */
export function resolveConfigDir(env = process.env) {
  if (env.OF_CONFIG_DIR) return path.resolve(env.OF_CONFIG_DIR);
  if (env.XDG_CONFIG_HOME) return path.join(path.resolve(env.XDG_CONFIG_HOME), 'openfactory');
  return path.join(os.homedir(), '.config', 'openfactory');
}

/** @param {NodeJS.ProcessEnv} [env] */
export function configPath(env = process.env) {
  return path.join(resolveConfigDir(env), CONFIG_FILE_NAME);
}

/**
 * 读取配置；文件不存在或损坏时返回空对象（不抛错，保证 CLI 可用）。
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(env = process.env) {
  const file = configPath(env);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      apiUrl: typeof parsed.apiUrl === 'string' ? parsed.apiUrl : undefined,
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * 保存配置（合并写入），权限 0600。
 * @param {Record<string, unknown>} config
 * @param {NodeJS.ProcessEnv} [env]
 */
export function saveConfig(config, env = process.env) {
  const dir = resolveConfigDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, CONFIG_FILE_NAME);
  const payload = {
    apiUrl: config.apiUrl,
    token: config.token,
    updatedAt: new Date().toISOString(),
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // 某些文件系统不支持 chmod，忽略
  }
  return file;
}

/** 清空令牌但保留 API 地址。 */
export function clearToken(env = process.env) {
  const config = loadConfig(env);
  const next = { ...config };
  delete next.token;
  return saveConfig(next, env);
}

/** 令牌脱敏展示。 */
export function maskToken(token) {
  if (typeof token !== 'string' || !token) return '';
  if (token.length <= 10) return `${token.slice(0, 2)}…`;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/** 归一化 API 地址：去尾部斜杠，缺协议时补 https://。 */
export function normalizeApiUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let url = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}
