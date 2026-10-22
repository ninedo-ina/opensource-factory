-- 个人开放 API 令牌（REQ-202610-0975 / M8-05 依赖）
-- 令牌仅保存 sha-256 摘要；明文只在创建时返回一次。
CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'CLI 令牌',
    token_hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'read write',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    revoked_at TEXT,
    expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user
    ON api_tokens (user_id, created_at DESC);
