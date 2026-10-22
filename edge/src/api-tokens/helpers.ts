/**
 * 个人开放 API 令牌（M8-05 / M8-06 依赖）纯函数：
 * - 令牌生成与格式校验（`ofp_` + 48 位十六进制）；
 * - scope / label 归一化；
 * - DTO 脱敏（只返回 hint，不返回摘要）；
 * - 仓库引用解析（owner/repo、GitHub / Gitee URL）。
 *
 * 不依赖 Hono / D1，便于 node:test 直接覆盖。
 */

export const API_TOKEN_PREFIX = 'ofp_';
export const API_TOKEN_SCOPES = ['read', 'write'] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export interface ApiTokenRow {
  id: string;
  user_id: string;
  label: string;
  token_hash: string;
  hint: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

export interface ApiTokenDto {
  id: string;
  label: string;
  hint: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
}

export type RepoPlatform = 'github' | 'gitee';

export interface RepoReference {
  platform: RepoPlatform;
  owner: string;
  name: string;
  fullName: string;
  url: string;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,63})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** GitHub / Gitee 的一级保留路径，避免把设置页误判成仓库。 */
const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'collections',
  'contact',
  'dashboard',
  'enterprise',
  'explore',
  'features',
  'issues',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'readme',
  'search',
  'security',
  'settings',
  'site',
  'sponsors',
  'stars',
  'topics',
  'trending',
  'users',
  'watching',
]);

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 生成原始令牌（只在创建时返回一次）。 */
export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomHex(24)}`;
}

/** 生成令牌 id。 */
export function generateApiTokenId(): string {
  return `tok_${randomHex(8)}`;
}

/** 是否为合法的 API 令牌格式（不校验是否存在）。 */
export function isApiTokenFormat(value: unknown): value is string {
  return typeof value === 'string' && /^ofp_[a-f0-9]{48}$/.test(value);
}

/** 脱敏提示：保留前缀与首尾片段，例如 `ofp_ab12…cd34`。 */
export function tokenHint(token: string): string {
  if (!token.startsWith(API_TOKEN_PREFIX)) return 'ofp_…';
  const body = token.slice(API_TOKEN_PREFIX.length);
  return `${API_TOKEN_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
}

/** 归一化令牌名称：空白折叠、最长 60 字符、空值回退「CLI 令牌」。 */
export function normalizeTokenLabel(value: unknown): string {
  if (typeof value !== 'string') return 'CLI 令牌';
  const label = value.replace(/\s+/g, ' ').trim();
  return label ? label.slice(0, 60) : 'CLI 令牌';
}

/** 归一化 scope：只接受 read / write，去重并保持稳定顺序；空值默认两者。 */
export function normalizeScopes(value: unknown): ApiTokenScope[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,]+/)
      : [];
  const selected = new Set<string>();
  for (const item of raw) {
    if (typeof item === 'string') selected.add(item.trim().toLowerCase());
  }
  const scopes = API_TOKEN_SCOPES.filter((scope) => selected.has(scope));
  return scopes.length > 0 ? scopes : [...API_TOKEN_SCOPES];
}

/** 解析数据库中的 scope 字符串。 */
export function parseScopes(value: unknown): ApiTokenScope[] {
  if (typeof value !== 'string') return [];
  const set = new Set(value.split(/[\s,]+/).filter(Boolean));
  return API_TOKEN_SCOPES.filter((scope) => set.has(scope));
}

/** 是否具备指定 scope。 */
export function hasScope(scopes: ApiTokenScope[], scope: ApiTokenScope): boolean {
  return scopes.includes(scope);
}

/** 行 → DTO（不含 token_hash）。 */
export function toApiTokenDto(row: ApiTokenRow): ApiTokenDto {
  return {
    id: row.id,
    label: row.label,
    hint: row.hint,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
  };
}

/** 解析 owner/repo（允许前后空格与 .git 后缀）。 */
export function parseRepoFullName(
  value: unknown
): { owner: string; name: string; fullName: string } | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\.git$/i, '');
  const parts = cleaned.split('/');
  if (parts.length !== 2) return null;
  const owner = (parts[0] ?? '').trim();
  const name = (parts[1] ?? '').trim();
  if (!owner || !name) return null;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) return null;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return { owner, name, fullName: `${owner}/${name}` };
}

/** 解析 GitHub / Gitee 仓库 URL。 */
export function parseRepoUrl(raw: unknown): RepoReference | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const platform: RepoPlatform | null =
    host === 'github.com' ? 'github' : host === 'gitee.com' ? 'gitee' : null;
  if (!platform) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  let owner: string;
  let name: string;
  try {
    owner = decodeURIComponent(segments[0] ?? '');
    name = decodeURIComponent(segments[1] ?? '').replace(/\.git$/i, '');
  } catch {
    return null;
  }
  const parsed = parseRepoFullName(`${owner}/${name}`);
  if (!parsed) return null;
  return {
    platform,
    owner: parsed.owner,
    name: parsed.name,
    fullName: parsed.fullName,
    url: `https://${platform === 'github' ? 'github.com' : 'gitee.com'}/${parsed.fullName}`,
  };
}

/** 统一解析仓库引用：URL 或 owner/repo；默认 GitHub。 */
export function parseRepoReference(value: unknown): RepoReference | null {
  const fromUrl = parseRepoUrl(value);
  if (fromUrl) return fromUrl;
  const parsed = parseRepoFullName(value);
  if (!parsed) return null;
  return {
    platform: 'github',
    owner: parsed.owner,
    name: parsed.name,
    fullName: parsed.fullName,
    url: `https://github.com/${parsed.fullName}`,
  };
}

/** 归一化计数字段：非负整数，上限 20 亿。 */
export function normalizeCount(value: unknown): number {
  const num =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? '').replace(/[,_\s]/g, ''), 10);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(Math.floor(num), 2_000_000_000);
}

/** 归一化可选短文本。 */
export function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}
