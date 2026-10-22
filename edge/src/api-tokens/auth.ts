/**
 * 个人 API 令牌鉴权（M8-05）
 *
 * - `Authorization: Bearer ofp_…` 解析令牌，按 sha-256 查 api_tokens；
 * - 已撤销 / 已过期 / 用户不存在均视为无效；
 * - last_used_at 按分钟节流写回，避免每个请求都写 D1；
 * - scope 校验：read / write，会话登录态默认拥有全部权限。
 */
import type { Context } from 'hono';
import type { Env, UserRow, Variables } from '../types';
import { first, run } from '../db';
import { sha256Hex } from '../security/crypto';
import {
  hasScope,
  isApiTokenFormat,
  parseScopes,
  type ApiTokenRow,
  type ApiTokenScope,
} from './helpers';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export interface ApiTokenAuth {
  user: UserRow;
  token: ApiTokenRow;
}

/** 从请求头解析 Bearer 令牌并返回用户；无效返回 null。 */
export async function resolveApiTokenAuth(c: AppContext): Promise<ApiTokenAuth | null> {
  const header = (c.req.header('Authorization') ?? '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = (match[1] ?? '').trim();
  if (!isApiTokenFormat(token)) return null;

  const hash = await sha256Hex(token);
  const row = await first<ApiTokenRow>(
    c.env.DB,
    'SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL',
    [hash]
  );
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

  const user = await first<UserRow>(c.env.DB, 'SELECT * FROM users WHERE id = ?', [
    row.user_id,
  ]);
  if (!user) return null;

  // 最近使用时间按分钟节流，避免每个请求都写 D1。
  await run(
    c.env.DB,
    `UPDATE api_tokens
        SET last_used_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (last_used_at IS NULL OR last_used_at < datetime('now', '-1 minute'))`,
    [row.id]
  );

  return { user, token: row };
}

/**
 * 校验当前请求是否具备 scope。
 * - 未登录：401 unauthorized；
 * - 会话登录：放行；
 * - 令牌登录：缺少 scope 时 403 insufficient_scope。
 */
export function requireApiScope(
  c: AppContext,
  scope: ApiTokenScope
): Response | null {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const token = c.get('apiToken');
  if (!token) return null;
  if (!hasScope(parseScopes(token.scopes), scope)) {
    return c.json(
      {
        error: 'insufficient_scope',
        required: scope,
        granted: parseScopes(token.scopes),
      },
      403
    );
  }
  return null;
}
