-- 为每个关键词增加严格匹配标记，1=严格匹配，0=普通包含匹配
ALTER TABLE keywords_sub ADD COLUMN keyword1_strict INTEGER DEFAULT 0;
ALTER TABLE keywords_sub ADD COLUMN keyword2_strict INTEGER DEFAULT 0;
ALTER TABLE keywords_sub ADD COLUMN keyword3_strict INTEGER DEFAULT 0;
