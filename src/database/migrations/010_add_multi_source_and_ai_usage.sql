ALTER TABLE rss_sources ADD COLUMN ai_translation_enabled INTEGER NOT NULL DEFAULT 0;

UPDATE rss_sources
SET ai_translation_enabled = 1
WHERE id IN (SELECT rss_source_id FROM ai_translation_sources)
  AND (SELECT enabled FROM ai_translation_config WHERE id = 1) = 1;

CREATE TABLE IF NOT EXISTS keyword_sub_sources (
  keyword_sub_id INTEGER NOT NULL,
  rss_source_id INTEGER NOT NULL,
  PRIMARY KEY (keyword_sub_id, rss_source_id)
);

INSERT OR IGNORE INTO keyword_sub_sources (keyword_sub_id, rss_source_id)
SELECT id, rss_source_id FROM keywords_sub WHERE rss_source_id IS NOT NULL;

ALTER TABLE ai_translation_config ADD COLUMN prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_translation_config ADD COLUMN completion_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_translation_config ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;
