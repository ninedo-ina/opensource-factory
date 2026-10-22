/**
 * 个人开放 API 令牌管理（M8-05）
 *
 * 仅接受浏览器会话（of_session Cookie）：
 *   GET    /api/tokens       当前用户令牌列表（含已撤销）
 *   POST   /api/tokens       创建令牌（明文只返回一次）
 *   DELETE /api/tokens/:id   撤销令牌
 *
 * CLI 使用 Bearer 令牌访问 /api/v1/*，不能用令牌管理令牌。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import { all, first, run } from '../db';
import { getSessionUser } from '../auth';
import { sha256Hex } from '../security/crypto';
import {
  generateApiToken,
  generateApiTokenId,
  normalizeScopes,
  normalizeTokenLabel,
  toApiTokenDto,
  tokenHint,
  type ApiTokenRow,
} from '../api-tokens/helpers';

const tokens = new Hono<{ Bindings: Env; Variables: Variables }>();

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const MAX_ACTIVE_TOKENS = 20;

async function requireSession(c: AppContext) {
  const user = await getSessionUser(c);
  if (!user) return { user: null, denied: c.json({ error: 'session_required' }, 401) };
  return { user, denied: null };
}

async function readJson(c: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

tokens.get('/', async (c) => {
  const { user, denied } = await requireSession(c);
  if (denied) return denied;

  const rows = await all<ApiTokenRow>(
    c.env.DB,
    `SELECT * FROM api_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100`,
    [user!.id]
  );
  return c.json({ items: rows.map(toApiTokenDto) });
});

tokens.post('/', async (c) => {
  const { user, denied } = await requireSession(c);
  if (denied) return denied;

  const body = await readJson(c);
  if (body === null) return c.json({ error: 'invalid_body' }, 400);

  const active = await first<{ n: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL',
    [user!.id]
  );
  if ((active?.n ?? 0) >= MAX_ACTIVE_TOKENS) {
    return c.json(
      { error: 'too_many_tokens', message: `每个用户最多保留 ${MAX_ACTIVE_TOKENS} 个有效令牌` },
      400
    );
  }

  const token = generateApiToken();
  const tokenHash = await sha256Hex(token);
  const row: ApiTokenRow = {
    id: generateApiTokenId(),
    user_id: user!.id,
    label: normalizeTokenLabel(body.label),
    token_hash: tokenHash,
    hint: tokenHint(token),
    scopes: normalizeScopes(body.scopes).join(' '),
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
  };

  await run(
    c.env.DB,
    `INSERT INTO api_tokens
       (id, user_id, label, token_hash, hint, scopes, created_at, last_used_at, revoked_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    [
      row.id,
      row.user_id,
      row.label,
      row.token_hash,
      row.hint,
      row.scopes,
      row.created_at,
    ]
  );

  // 明文只在这里返回一次，服务端不保存。
  return c.json({ token, item: toApiTokenDto(row) }, 201);
});

tokens.delete('/:id', async (c) => {
  const { user, denied } = await requireSession(c);
  if (denied) return denied;

  const result = await run(
    c.env.DB,
    `UPDATE api_tokens
        SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [c.req.param('id'), user!.id]
  );
  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ ok: true });
});

export default tokens;
