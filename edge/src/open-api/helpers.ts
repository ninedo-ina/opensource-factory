/**
 * 开放 API（M8-05）纯函数：
 * - 个人令牌生成 / 格式校验 / 尾号提示；
 * - 作用域（read / write）归一化与判断；
 * - 过期天数归一化；
 * - 收藏仓库参数解析与归一化。
 *
 * 不依赖 Hono / D1，便于 node:test 直接覆盖。
 */

export type OpenApiScope = 'read' | 'write';
export type RepoPlatform = 'github' | 'gitee';

export interface ParsedRepo {
  platform: RepoPlatform;
  owner: string;
  name: string;
  fullName: string;
  url: string;
}

export interface NormalizedBookmarkRepo extends ParsedRepo {
  id: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
}

export type NormalizeBookmarkResult =
  | { ok: true; repo: NormalizedBookmarkRepo }
  | { ok: false; error: string };

const PLATFORM_HOSTS: Record<RepoPlatform, string> = {
  github: 'github.com',
  gitee: 'gitee.com',
};

/** GitHub 保留的一级路径，避免把设置 / 市场 / 话题页误判成仓库。 */
const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'customer-stories',
  'dashboard',
  'enterprise',
  'events',
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

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,63})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

function trimString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeCount(value: unknown): number {
  const num =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? '').replace(/[,_\s]/g, ''), 10);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(Math.floor(num), 2_000_000_000);
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

/** 从 GitHub / Gitee 仓库页 URL 解析仓库；非仓库页返回 null。 */
export function parseRepoUrl(raw: unknown): ParsedRepo | null {
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
    host === PLATFORM_HOSTS.github
      ? 'github'
      : host === PLATFORM_HOSTS.gitee
        ? 'gitee'
        : null;
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
    url: `https://${PLATFORM_HOSTS[platform]}/${parsed.fullName}`,
  };
}

/** 归一化收藏请求体；字段非法时返回可读错误。 */
export function normalizeBookmarkPayload(body: unknown): NormalizeBookmarkResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const input = body as Record<string, unknown>;

  const fromUrl = parseRepoUrl(input.url);
  const fromFullName = parseRepoFullName(input.fullName ?? input.repo ?? input.id);
  if (!fromUrl && !fromFullName) {
    return { ok: false, error: 'invalid_repo' };
  }

  const platformInput =
    typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : '';
  const platform = (platformInput || fromUrl?.platform || 'github') as RepoPlatform;
  if (platform !== 'github' && platform !== 'gitee') {
    return { ok: false, error: 'invalid_platform' };
  }

  if (
    fromUrl &&
    fromFullName &&
    fromUrl.fullName.toLowerCase() !== fromFullName.fullName.toLowerCase()
  ) {
    return { ok: false, error: 'repo_url_mismatch' };
  }
  if (fromUrl && fromUrl.platform !== platform) {
    return { ok: false, error: 'platform_url_mismatch' };
  }

  const base = fromUrl ?? fromFullName;
  if (!base) return { ok: false, error: 'invalid_repo' };

  return {
    ok: true,
    repo: {
      platform,
      owner: base.owner,
      name: base.name,
      fullName: base.fullName,
      id: base.fullName,
      url: `https://${PLATFORM_HOSTS[platform]}/${base.fullName}`,
      description: trimString(input.description, 500),
      language: trimString(input.language, 40),
      stars: normalizeCount(input.stars),
      forks: normalizeCount(input.forks),
    },
  };
}

// ── 令牌 ────────────────────────────────────────────────────────

export const OPEN_API_TOKEN_PREFIX = 'ofa_';
export const OPEN_API_DEFAULT_EXPIRY_DAYS = 90;
export const OPEN_API_MAX_TOKENS = 20;
export const OPEN_API_SCOPES: OpenApiScope[] = ['read', 'write'];

/** 生成个人令牌：ofa_ + 64 位十六进制随机串。 */
export function generateOpenApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return (
    OPEN_API_TOKEN_PREFIX +
    [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}

/** 令牌格式校验（只接受本系统生成的 ofa_ 前缀）。 */
export function isOpenApiTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && /^ofa_[0-9a-f]{64}$/.test(token);
}

/** 令牌尾号提示，例如 ofa_…a1b2；绝不返回完整令牌。 */
export function tokenHint(token: string): string {
  const normalized = token.trim();
  return `${OPEN_API_TOKEN_PREFIX}…${normalized.slice(-4)}`;
}

/** 备注归一化：默认「开放 API」，最长 60 字。 */
export function normalizeTokenLabel(value: unknown): string {
  return trimString(value, 60) ?? '开放 API';
}

/** 稳定令牌 id：oat_ + 16 位十六进制。 */
export function generateOpenApiTokenId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return (
    'oat_' +
    [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}

/**
 * 作用域归一化：
 * - 接受数组或逗号分隔字符串；
 * - 只保留 read / write；
 * - write 隐含 read；
 * - 未提供时默认 read。
 */
export function normalizeScopes(value: unknown): OpenApiScope[] {
  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string') {
    raw = value.split(',');
  }
  const set = new Set<OpenApiScope>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const scope = item.trim().toLowerCase();
    if (scope === 'read' || scope === 'write') set.add(scope);
  }
  if (set.has('write')) set.add('read');
  if (set.size === 0) set.add('read');
  return OPEN_API_SCOPES.filter((scope) => set.has(scope));
}

/** 数据库中的 scopes 字符串 → 数组。 */
export function parseScopes(value: unknown): OpenApiScope[] {
  if (typeof value !== 'string') return [];
  return normalizeScopes(value);
}

/** 作用域判断：write 隐含 read。 */
export function hasScope(scopes: string | string[] | null | undefined, required: OpenApiScope): boolean {
  const list = Array.isArray(scopes) ? normalizeScopes(scopes) : parseScopes(scopes);
  if (list.includes(required)) return true;
  return required === 'read' && list.includes('write');
}

export function scopesToString(scopes: OpenApiScope[]): string {
  return scopes.join(',');
}

export type ExpiryResult =
  | { ok: true; days: number | null }
  | { ok: false; error: string };

/**
 * 过期天数归一化：
 * - 未提供 → 默认 90 天；
 * - 0 / null → 永不过期（days = null）；
 * - 1~365 的整数。
 */
export function normalizeExpiryDays(
  value: unknown,
  defaultDays: number = OPEN_API_DEFAULT_EXPIRY_DAYS
): ExpiryResult {
  if (value === undefined || value === '') {
    return { ok: true, days: defaultDays > 0 ? defaultDays : null };
  }
  if (value === null) return { ok: true, days: null };
  const num =
    typeof value === 'number' ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { ok: false, error: 'invalid_expires_in_days' };
  }
  if (num === 0) return { ok: true, days: null };
  if (num < 1 || num > 365) {
    return { ok: false, error: 'invalid_expires_in_days' };
  }
  return { ok: true, days: num };
}

/** 由天数计算过期时间；null 表示永不过期。 */
export function expiresAtFromDays(days: number | null, nowMs: number = Date.now()): string | null {
  if (days === null) return null;
  return new Date(nowMs + days * 24 * 3600 * 1000).toISOString();
}

export interface OpenApiTokenRowLike {
  id: string;
  user_id: string;
  label: string | null;
  hint: string;
  scopes: string | null;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** D1 行 → 前端 DTO（不含 token_hash）。 */
export function toOpenApiTokenDto(row: OpenApiTokenRowLike) {
  return {
    id: row.id,
    label: row.label ?? '开放 API',
    hint: row.hint,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    status: row.revoked_at ? ('revoked' as const) : ('active' as const),
  };
}

// ── 查询参数 ────────────────────────────────────────────────────

export function parseLimit(value: unknown, fallback = 50, max = 200): number {
  const num = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(num, max);
}

export function parseOffset(value: unknown, max = 10_000): number {
  const num = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(num, max);
}

export type RepoSort = 'stars' | 'updated' | 'name';

export function normalizeRepoSort(value: unknown): RepoSort {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'updated') return 'updated';
  if (raw === 'name') return 'name';
  return 'stars';
}
