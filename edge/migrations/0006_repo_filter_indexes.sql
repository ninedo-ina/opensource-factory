-- 0006_repo_filter_indexes.sql — 仓库列表组合筛选 / 排序补充索引（REQ-202610-0903）
-- D1 / SQLite：以 user_id 为前缀，覆盖按更新时间 / 语言的常用组合。
-- Star 与分类排序已由 0004_search_indexes.sql 的复合索引覆盖，此处不重复创建。

CREATE INDEX IF NOT EXISTS idx_my_repositories_user_updated
  ON my_repositories (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_my_repositories_user_language
  ON my_repositories (user_id, language);
