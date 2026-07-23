CREATE TABLE IF NOT EXISTS ai_translation_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  api_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT 'Translate the title and content into Chinese. Preserve names, URLs, and technical terms. Return JSON with title and content fields.',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ai_translation_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS ai_translation_sources (
  rss_source_id INTEGER PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
