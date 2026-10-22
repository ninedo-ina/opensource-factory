/**
 * 仓库引用解析：`owner/repo` 或 GitHub / Gitee URL。
 * 与 edge/src/api-tokens/helpers.ts 的规则保持一致（CLI 零依赖，单独实现）。
 */

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,63})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

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

/** @param {unknown} value */
export function parseRepoFullName(value) {
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

/** @param {unknown} raw */
export function parseRepoUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const platform = host === 'github.com' ? 'github' : host === 'gitee.com' ? 'gitee' : null;
  if (!platform) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  let owner;
  let name;
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

/** @param {unknown} value */
export function parseRepoReference(value) {
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
