-- REQ-202610-0974 开放 API（个人令牌，M8-05）
-- 明文令牌只在创建时返回一次，服务端仅保存 SHA-256 摘要。

CREATE TABLE IF NOT EXISTS open_api_tokens (
    id TEXT PRIMARY KEY,                 -- oat_ + 16 位十六进制
    user_id TEXT NOT NULL,
    label TEXT,                          -- 备注，默认「开放 API」
    token_hash TEXT NOT NULL UNIQUE,     -- sha256(明文令牌)
    hint TEXT NOT NULL,                  -- 尾号提示，如 ofa_…a1b2
    scopes TEXT NOT NULL DEFAULT 'read', -- 逗号分隔：read / write（write 隐含 read）
    expires_at TEXT,                     -- ISO 时间；NULL 表示永不过期
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_open_api_tokens_user
    ON open_api_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_open_api_tokens_hash
    ON open_api_tokens (token_hash);
