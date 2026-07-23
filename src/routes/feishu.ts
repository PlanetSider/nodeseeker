import { Hono } from 'hono';
import { FeishuService } from '../services/feishu';
import { createErrorResponse } from '../utils/helpers';
import { logger } from '../utils/logger';
import type { ContextVariables } from '../types';

export const feishuRoutes = new Hono<{ Variables: ContextVariables }>();

// 飞书开放平台会直接访问此端点，不经过登录认证。
feishuRoutes.post('/events', async (c) => {
    try {
        const dbService = c.get('dbService');
        const config = dbService.getBaseConfig();
        if (!config?.feishu_app_id || !config.feishu_app_secret) {
            return c.json(createErrorResponse('飞书应用未配置'), 400);
        }
        const service = new FeishuService(dbService, config.feishu_app_id, config.feishu_app_secret);
        const result = await service.handleEvent(await c.req.json());
        return c.json(result);
    } catch (error) {
        logger.error('处理飞书事件失败:', error);
        return c.json(createErrorResponse(`处理飞书事件失败: ${error}`), 400);
    }
});
