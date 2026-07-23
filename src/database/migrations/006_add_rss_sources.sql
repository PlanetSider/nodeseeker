-- 命名 RSS 源；现有单源配置迁移为默认源
CREATE TABLE IF NOT EXISTS rss_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO rss_sources (name, url, enabled)
SELECT 'NodeSeek', COALESCE(NULLIF(rss_url, ''), 'https://rss.nodeseek.com/'), 1
FROM base_config
WHERE NOT EXISTS (SELECT 1 FROM rss_sources);

ALTER TABLE posts ADD COLUMN rss_source_id INTEGER DEFAULT NULL;
ALTER TABLE keywords_sub ADD COLUMN rss_source_id INTEGER DEFAULT NULL;

UPDATE posts
SET rss_source_id = (SELECT id FROM rss_sources ORDER BY id LIMIT 1)
WHERE rss_source_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_rss_source_id ON posts(rss_source_id);
CREATE INDEX IF NOT EXISTS idx_keywords_sub_rss_source_id ON keywords_sub(rss_source_id);
