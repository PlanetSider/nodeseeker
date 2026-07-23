-- 飞书自建应用凭据、事件校验 Token 和绑定目标
ALTER TABLE base_config ADD COLUMN feishu_app_id TEXT DEFAULT NULL;
ALTER TABLE base_config ADD COLUMN feishu_app_secret TEXT DEFAULT NULL;
ALTER TABLE base_config ADD COLUMN feishu_chat_id TEXT DEFAULT NULL;
ALTER TABLE base_config ADD COLUMN feishu_user_open_id TEXT DEFAULT NULL;
