-- 数据质量治理（M9-05 / REQ-202610-0982）
-- 扫描记录 + 按用户的问题台账；重复扫描按 (user_id, repo_id, issue_key) 幂等更新。

CREATE TABLE IF NOT EXISTS data_quality_scans (
    id TEXT PRIMARY KEY,                       -- dq_ + 12 位随机串
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'local' CHECK (mode IN ('local', 'hybrid')),
    scanned INTEGER NOT NULL DEFAULT 0,
    issue_count INTEGER NOT NULL DEFAULT 0,
    critical_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    info_count INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 100,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    broken_link_count INTEGER NOT NULL DEFAULT 0,
    metadata_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_data_quality_scans_user
    ON data_quality_scans (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_quality_issues (
    id TEXT PRIMARY KEY,                       -- 稳定 id：user + repo + issue_key 摘要
    user_id TEXT NOT NULL,
    scan_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    issue_key TEXT NOT NULL,                   -- missing_metadata:description / duplicate:<cluster>:<repo> / broken_link:url
    type TEXT NOT NULL CHECK (type IN ('duplicate', 'broken_link', 'missing_metadata', 'stale_metadata')),
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    field TEXT,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    suggestion TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ignored', 'fixed')),
    detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_quality_issues_user_repo_key
    ON data_quality_issues (user_id, repo_id, issue_key);
CREATE INDEX IF NOT EXISTS idx_data_quality_issues_user_status
    ON data_quality_issues (user_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_data_quality_issues_scan
    ON data_quality_issues (scan_id);
