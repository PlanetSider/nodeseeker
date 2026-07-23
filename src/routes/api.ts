import { Hono } from 'hono';
import { z } from 'zod';
import { DatabaseService } from '../services/database';
import { AuthService } from '../services/auth';
import { RSSService } from '../services/rss';
import { FeishuService } from '../services/feishu';
import { feishuConnectionService } from '../services/feishuConnection';
import { MatcherService } from '../services/matcher';
import { AITranslationService } from '../services/aiTranslation';
import { createValidationMiddleware, createQueryValidationMiddleware, createParamValidationMiddleware } from '../utils/validation';
import { createSuccessResponse, createErrorResponse } from '../utils/helpers';
import {
    baseConfigUpdateSchema,
    keywordSubSchema,
    keywordSubUpdateSchema,
    paginationSchema,
    idParamSchema
} from '../utils/validation';
import type { ContextVariables } from '../types';
import { getCleanupCutoffDate } from '../utils/cleanup';

type Variables = ContextVariables & {
    authService: AuthService;
    jwtPayload: any;
}

export const apiRoutes = new Hono<{ Variables: Variables }>();

function createSafeConfig(config: any) {
    const { password, feishu_app_secret, ...safeConfig } = config;
    delete safeConfig['feishu_verification' + '_token'];
    return {
        ...safeConfig,
        has_feishu_app_secret: !!feishu_app_secret,
    };
}

const cleanupSchema = z.object({
    amount: z.coerce.number().int().positive('清理数量必须是正整数'),
    unit: z.enum(['days', 'months'])
});

const rssSourceSchema = z.object({
    name: z.string().trim().min(1, 'RSS 源名称不能为空').max(50),
    url: z.string().url('RSS 源地址格式不正确'),
    enabled: z.union([
        z.number().int().min(0).max(1),
        z.boolean().transform(value => value ? 1 : 0),
    ]).default(1),
});

const rssSourceUpdateSchema = rssSourceSchema.partial();

const aiTranslationSchema = z.object({
    enabled: z.union([z.number().int().min(0).max(1), z.boolean().transform(value => value ? 1 : 0)]).optional(),
    api_url: z.union([z.string().url('AI API 地址格式不正确'), z.literal('')]).optional(),
    api_key: z.string().optional(),
    model: z.string().trim().max(100).optional(),
    prompt: z.string().max(10000).optional(),
    rss_source_ids: z.array(z.number().int().positive()).optional(),
});

// 公开路由（无需认证）
apiRoutes.get('/posts', createQueryValidationMiddleware(paginationSchema), async (c) => {
    try {
        const query = c.get('validatedQuery');
        const dbService = c.get('dbService');

        // 解析 pushStatusIn 参数（格式: "1,3"）
        let pushStatusIn: number[] | undefined;
        if (query.pushStatusIn) {
            pushStatusIn = query.pushStatusIn.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
        }

        const result = dbService.getPostsWithPagination(
            query.page,
            query.limit,
            {
                pushStatus: query.pushStatus,
                pushStatusIn,
                pushStatusNot: query.pushStatusNot,
                creator: query.creator,
                category: query.category,
                search: query.search,
                subId: query.subId
            }
        );

        return c.json(createSuccessResponse(result));
    } catch (error) {
        return c.json(createErrorResponse(`获取文章列表失败: ${error}`), 500);
    }
});

// 获取图表统计数据（公开接口，无需认证）
apiRoutes.get('/stats/charts', async (c) => {
    try {
        const daysStr = c.req.query('days');
        const days = daysStr !== undefined ? parseInt(daysStr, 10) : 7;
        const validDays = isNaN(days) ? 7 : Math.max(-1, Math.min(365, days));

        const dbService = c.get('dbService');
        const last24hStats = dbService.getLast24HoursPostStats();
        const categoryStats = dbService.getCategoryDistribution(validDays);

        return c.json(createSuccessResponse({ hourly: last24hStats, category: categoryStats }));
    } catch (error) {
        return c.json(createErrorResponse(`获取图表数据失败: ${error}`), 500);
    }
});

// Session 中间件
const sessionMiddleware = async (c: any, next: any) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json(createErrorResponse('请提供有效的认证token'), 401);
    }

    const sessionId = authHeader.substring(7);
    const authService = c.get('authService');

    // 获取客户端IP地址用于验证
    const ipAddress = c.req.header('x-forwarded-for') ||
                     c.req.header('x-real-ip') ||
                     c.env?.CF_CONNECTING_IP ||
                     '127.0.0.1';

    const verification = await authService.verifySession(sessionId, ipAddress);
    if (!verification.valid) {
        return c.json(createErrorResponse(verification.message || 'Session无效'), 401);
    }

    // 设置session数据和向后兼容的payload
    c.set('sessionData', verification.sessionData);
    c.set('jwtPayload', verification.payload);
    await next();
};

// 应用Session中间件到所有后续API路由
apiRoutes.use('*', sessionMiddleware);

// 获取基础配置
apiRoutes.get('/config', async (c) => {
    try {
        const dbService = c.get('dbService');
        const config = dbService.getBaseConfig();

        if (!config) {
            return c.json(createErrorResponse('配置不存在'), 404);
        }

        return c.json(createSuccessResponse(createSafeConfig(config)));
    } catch (error) {
        return c.json(createErrorResponse(`获取配置失败: ${error}`), 500);
    }
});

// 更新基础配置
apiRoutes.put('/config', createValidationMiddleware(baseConfigUpdateSchema), async (c) => {
    try {
        const validatedData = c.get('validatedData');
        const dbService = c.get('dbService');

        const config = dbService.updateBaseConfig(validatedData);

        if (!config) {
            return c.json(createErrorResponse('更新配置失败'), 500);
        }

        if (validatedData.feishu_app_id !== undefined || validatedData.feishu_app_secret !== undefined) {
            await feishuConnectionService.sync(dbService);
        }

        return c.json(createSuccessResponse(createSafeConfig(config), '配置更新成功'));
    } catch (error) {
        return c.json(createErrorResponse(`更新配置失败: ${error}`), 500);
    }
});

// 获取订阅列表
apiRoutes.get('/subscriptions', createQueryValidationMiddleware(paginationSchema), async (c) => {
    try {
        const dbService = c.get('dbService');
        const subscriptions = dbService.getAllKeywordSubs();

        return c.json(createSuccessResponse(subscriptions));
    } catch (error) {
        return c.json(createErrorResponse(`获取订阅列表失败: ${error}`), 500);
    }
});

// 添加订阅
apiRoutes.post('/subscriptions', createValidationMiddleware(keywordSubSchema), async (c) => {
    try {
        const validatedData = c.get('validatedData');
        const dbService = c.get('dbService');

        if (validatedData.rss_source_id && !dbService.getRSSSourceById(validatedData.rss_source_id)) {
            return c.json(createErrorResponse('RSS 源不存在'), 400);
        }

        const subscription = dbService.createKeywordSub(validatedData);

        return c.json(createSuccessResponse(subscription, '订阅添加成功'), 201);
    } catch (error) {
        return c.json(createErrorResponse(`添加订阅失败: ${error}`), 500);
    }
});

// 更新订阅
apiRoutes.put('/subscriptions/:id',
    createParamValidationMiddleware(idParamSchema),
    createValidationMiddleware(keywordSubUpdateSchema),
    async (c) => {
        try {
            const { id } = c.get('validatedParams');
            const validatedData = c.get('validatedData');
            const dbService = c.get('dbService');

            if (validatedData.rss_source_id && !dbService.getRSSSourceById(validatedData.rss_source_id)) {
                return c.json(createErrorResponse('RSS 源不存在'), 400);
            }

            const subscription = dbService.updateKeywordSub(id, validatedData);

            if (!subscription) {
                return c.json(createErrorResponse('订阅不存在'), 404);
            }

            return c.json(createSuccessResponse(subscription, '订阅更新成功'));
        } catch (error) {
            return c.json(createErrorResponse(`更新订阅失败: ${error}`), 500);
        }
    }
);

// 删除订阅
apiRoutes.delete('/subscriptions/:id', createParamValidationMiddleware(idParamSchema), async (c) => {
    try {
        const { id } = c.get('validatedParams');
        const dbService = c.get('dbService');

        const success = dbService.deleteKeywordSub(id);

        if (!success) {
            return c.json(createErrorResponse('订阅不存在'), 404);
        }

        return c.json(createSuccessResponse(null, '订阅删除成功'));
    } catch (error) {
        return c.json(createErrorResponse(`删除订阅失败: ${error}`), 500);
    }
});

// 手动抓取 RSS
apiRoutes.post('/rss/fetch', async (c) => {
    try {
        const dbService = c.get('dbService');
        const rssService = new RSSService(dbService);

        const body = await c.req.json().catch(() => ({}));
        const sourceId = body.rss_source_id ? Number(body.rss_source_id) : undefined;
        if (sourceId && !dbService.getRSSSourceById(sourceId)) {
            return c.json(createErrorResponse('RSS 源不存在'), 404);
        }
        const result = await rssService.manualUpdate(sourceId);

        if (result.success) {
            return c.json(createSuccessResponse(result.data, result.message));
        } else {
            return c.json(createErrorResponse(result.message), 500);
        }
    } catch (error) {
        return c.json(createErrorResponse(`RSS 抓取失败: ${error}`), 500);
    }
});

// 手动推送文章
apiRoutes.post('/posts/:postId/push/:subId',
    createParamValidationMiddleware(z.object({
        postId: z.coerce.number().int().positive(),
        subId: z.coerce.number().int().positive()
    })),
    async (c) => {
        try {
            const { postId, subId } = c.get('validatedParams');
            const dbService = c.get('dbService');
            const config = dbService.getBaseConfig();

            if (!config?.feishu_app_id || !config.feishu_app_secret) {
                return c.json(createErrorResponse('未配置飞书应用'), 400);
            }

            const feishuService = new FeishuService(dbService, config.feishu_app_id, config.feishu_app_secret);
            const matcherService = new MatcherService(dbService, feishuService);

            const result = await matcherService.manualPushPost(postId, subId);

            if (result.success) {
                return c.json(createSuccessResponse(null, result.message));
            } else {
                return c.json(createErrorResponse(result.message), 400);
            }
        } catch (error) {
            return c.json(createErrorResponse(`手动推送失败: ${error}`), 500);
        }
    }
);

// 获取统计信息
apiRoutes.get('/stats', async (c) => {
    try {
        const dbService = c.get('dbService');
        const stats = dbService.getComprehensiveStats();

        return c.json(createSuccessResponse(stats));
    } catch (error) {
        return c.json(createErrorResponse(`获取统计信息失败: ${error}`), 500);
    }
});


// 验证 RSS 源
apiRoutes.get('/rss/validate', async (c) => {
    try {
        const dbService = c.get('dbService');
        const rssService = new RSSService(dbService);

        const sourceId = c.req.query('rss_source_id');
        const result = await rssService.validateRSSSource(sourceId ? Number(sourceId) : undefined);

        return c.json(createSuccessResponse(result));
    } catch (error) {
        return c.json(createErrorResponse(`验证 RSS 源失败: ${error}`), 500);
    }
});

// 获取匹配统计
apiRoutes.get('/match-stats', async (c) => {
    try {
        const dbService = c.get('dbService');
        const config = dbService.getBaseConfig();

        const feishuService = config?.feishu_app_id && config.feishu_app_secret
            ? new FeishuService(dbService, config.feishu_app_id, config.feishu_app_secret)
            : null;
        const matcherService = new MatcherService(dbService, feishuService);

        const stats = matcherService.getMatchStats();

        return c.json(createSuccessResponse(stats));
    } catch (error) {
        return c.json(createErrorResponse(`获取匹配统计失败: ${error}`), 500);
    }
});

// 获取飞书应用状态
apiRoutes.get('/feishu/status', async (c) => {
    try {
        const dbService = c.get('dbService');
        const config = dbService.getBaseConfig();

        const statusData = {
            configured: !!(config?.feishu_app_id && config.feishu_app_secret),
            connected: feishuConnectionService.getStatus().state === 'connected',
            connection: feishuConnectionService.getStatus(),
            bound: !!(config?.feishu_chat_id && config.feishu_user_open_id),
            config: {
                has_app_id: !!config?.feishu_app_id,
                has_app_secret: !!config?.feishu_app_secret,
                has_chat_id: !!config?.feishu_chat_id,
                bound_user_name: config?.bound_user_name || null,
                stop_push: config?.stop_push === 1,
                last_check_time: new Date().toISOString()
            }
        };

        if (!config?.feishu_app_id || !config.feishu_app_secret) {
            return c.json(createSuccessResponse(statusData, '飞书应用未配置'));
        }

        return c.json(createSuccessResponse(statusData, statusData.connected ? '飞书长连接正常' : `飞书长连接状态: ${statusData.connection.state}`));
    } catch (error) {
        return c.json(createErrorResponse(`获取 Bot 状态失败: ${error}`), 500);
    }
});

// 测试飞书连接，可在保存前使用表单中的凭据
apiRoutes.post('/feishu/test', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const dbService = c.get('dbService');
        const config = dbService.getBaseConfig();
        const appId = body.app_id || config?.feishu_app_id;
        const appSecret = body.app_secret || config?.feishu_app_secret;
        const chatId = body.chat_id || config?.feishu_chat_id;
        if (!appId || !appSecret) return c.json(createErrorResponse('请填写 App ID 和 App Secret'), 400);

        const service = new FeishuService(dbService, appId, appSecret);
        if (!await service.testConnection()) return c.json(createErrorResponse('飞书应用凭据无效'), 400);
        const messageSent = chatId ? await service.sendMessage(chatId, 'NodeSeeker 飞书推送测试成功') : false;
        return c.json(createSuccessResponse({ connected: true, message_sent: messageSent },
            chatId ? (messageSent ? '连接成功，测试消息已发送' : '连接成功，但测试消息发送失败') : '连接成功，尚未绑定会话'));
    } catch (error) {
        return c.json(createErrorResponse(`测试连接失败: ${error}`), 500);
    }
});

// 解除用户绑定
apiRoutes.post('/feishu/unbind', async (c) => {
    try {
        const dbService = c.get('dbService');
        
        const config = dbService.updateBaseConfig({
            feishu_chat_id: '',
            feishu_user_open_id: '',
            bound_user_name: '',
            bound_user_username: ''
        });

        if (!config) {
            return c.json(createErrorResponse('解除绑定失败'), 500);
        }

        return c.json(createSuccessResponse(null, '用户绑定已解除'));
    } catch (error) {
        return c.json(createErrorResponse(`解除绑定失败: ${error}`), 500);
    }
});

// 发送测试消息
apiRoutes.post('/feishu/send-test', createValidationMiddleware(z.object({
    message: z.string().optional()
})), async (c) => {
    try {
        const { message } = c.get('validatedData');
        const dbService = c.get('dbService');
        const config = dbService.getBaseConfig();

        if (!config?.feishu_app_id || !config.feishu_app_secret) {
            return c.json(createErrorResponse('飞书应用未配置'), 400);
        }

        if (!config.feishu_chat_id) {
            return c.json(createErrorResponse('用户未绑定'), 400);
        }

        const service = new FeishuService(dbService, config.feishu_app_id, config.feishu_app_secret);
        const testMessage = message || `NodeSeeker 测试消息\n时间：${new Date().toLocaleString('zh-CN')}`;
        const result = await service.sendMessage(config.feishu_chat_id, testMessage);

        if (result) {
            return c.json(createSuccessResponse(null, '测试消息发送成功'));
        } else {
            return c.json(createErrorResponse('消息发送失败'), 400);
        }
    } catch (error) {
        return c.json(createErrorResponse(`发送测试消息失败: ${error}`), 500);
    }
});

// ==================== RSS 配置接口 ====================

// 获取 RSS 配置
apiRoutes.get('/rss/config', async (c) => {
    try {
        const dbService = c.get('dbService');
        const config = dbService.getBaseConfig();

        if (!config) {
            return c.json(createErrorResponse('配置不存在'), 404);
        }

        return c.json(createSuccessResponse({
            rss_interval_seconds: config.rss_interval_seconds || 60,
            rss_proxy: config.rss_proxy || '',
            sources: dbService.getAllRSSSources(true),
        }));
    } catch (error) {
        return c.json(createErrorResponse(`获取 RSS 配置失败: ${error}`), 500);
    }
});

// 更新 RSS 配置
apiRoutes.put('/rss/config', createValidationMiddleware(z.object({
    rss_interval_seconds: z.number().int().min(10).max(3600).optional(),
    rss_proxy: z.string().optional(),
})), async (c) => {
    try {
        const validatedData = c.get('validatedData');
        const dbService = c.get('dbService');

        // 更新数据库配置
        const config = dbService.updateBaseConfig(validatedData);

        if (!config) {
            return c.json(createErrorResponse('更新 RSS 配置失败'), 500);
        }

        return c.json(createSuccessResponse({
            rss_interval_seconds: config.rss_interval_seconds,
            rss_proxy: config.rss_proxy,
        }, 'RSS 配置更新成功'));
    } catch (error) {
        return c.json(createErrorResponse(`更新 RSS 配置失败: ${error}`), 500);
    }
});

// 重启 RSS 任务（在配置更新后调用）
apiRoutes.post('/rss/restart', async (c) => {
    try {
        const { schedulerService } = await import('../server');
        if (schedulerService) {
            schedulerService.restartRSSTask();
            return c.json(createSuccessResponse(null, 'RSS 任务已重启'));
        } else {
            return c.json(createErrorResponse('调度服务未启动'), 500);
        }
    } catch (error) {
        return c.json(createErrorResponse(`重启 RSS 任务失败: ${error}`), 500);
    }
});

// 测试 RSS 连接
apiRoutes.post('/rss/test-connection', createValidationMiddleware(z.object({
    rss_url: z.string().url().optional(),
    rss_source_id: z.number().int().positive().optional(),
})), async (c) => {
    try {
        const { rss_url, rss_source_id } = c.get('validatedData');
        const dbService = c.get('dbService');
        const rssService = new RSSService(dbService);

        // 如果传入了 url 则测试指定 url，否则测试当前配置
        const testUrl = rss_url;
        const result = testUrl 
            ? await rssService.validateRSSUrl(testUrl)
            : await rssService.validateRSSSource(rss_source_id);

        return c.json(createSuccessResponse(result, result.accessible ? 'RSS 源连接测试成功' : 'RSS 源连接测试失败'));
    } catch (error) {
        return c.json(createErrorResponse(`RSS 连接测试失败: ${error}`), 500);
    }
});

// 获取 RSS 源列表
apiRoutes.get('/rss/sources', async (c) => {
    try {
        const dbService = c.get('dbService');
        return c.json(createSuccessResponse(dbService.getAllRSSSources(true)));
    } catch (error) {
        return c.json(createErrorResponse(`获取 RSS 源失败: ${error}`), 500);
    }
});

// 添加 RSS 源
apiRoutes.post('/rss/sources', createValidationMiddleware(rssSourceSchema), async (c) => {
    try {
        const dbService = c.get('dbService');
        const source = dbService.createRSSSource(c.get('validatedData'));
        return c.json(createSuccessResponse(source, 'RSS 源添加成功'), 201);
    } catch (error) {
        return c.json(createErrorResponse(`添加 RSS 源失败: ${error}`), 400);
    }
});

// 更新 RSS 源
apiRoutes.put('/rss/sources/:id', createParamValidationMiddleware(idParamSchema), createValidationMiddleware(rssSourceUpdateSchema), async (c) => {
    try {
        const dbService = c.get('dbService');
        const { id } = c.get('validatedParams');
        const source = dbService.updateRSSSource(id, c.get('validatedData'));
        if (!source) return c.json(createErrorResponse('RSS 源不存在'), 404);
        return c.json(createSuccessResponse(source, 'RSS 源更新成功'));
    } catch (error) {
        return c.json(createErrorResponse(`更新 RSS 源失败: ${error}`), 400);
    }
});

// 删除 RSS 源
apiRoutes.delete('/rss/sources/:id', createParamValidationMiddleware(idParamSchema), async (c) => {
    try {
        const dbService = c.get('dbService');
        if (dbService.getAllRSSSources(true).length <= 1) {
            return c.json(createErrorResponse('至少需要保留一个 RSS 源'), 400);
        }

        const { id } = c.get('validatedParams');
        const success = dbService.deleteRSSSource(id);
        if (!success) return c.json(createErrorResponse('RSS 源不存在'), 404);
        return c.json(createSuccessResponse(null, 'RSS 源删除成功'));
    } catch (error) {
        return c.json(createErrorResponse(`删除 RSS 源失败: ${error}`), 500);
    }
});

// AI 翻译配置
apiRoutes.get('/ai-translation/config', async (c) => {
    try {
        const dbService = c.get('dbService');
        const config = dbService.getAITranslationConfig();
        return c.json(createSuccessResponse({
            ...config,
            api_key: undefined,
            has_api_key: !!config.api_key,
            sources: dbService.getAllRSSSources(true),
        }));
    } catch (error) {
        return c.json(createErrorResponse(`获取 AI 翻译配置失败: ${error}`), 500);
    }
});

apiRoutes.put('/ai-translation/config', createValidationMiddleware(aiTranslationSchema), async (c) => {
    try {
        const dbService = c.get('dbService');
        const data = c.get('validatedData');
        if (data.rss_source_ids) {
            const sources = dbService.getAllRSSSources(true);
            const validIds = new Set(sources.map((source) => source.id));
            if (data.rss_source_ids.some((id: number) => !validIds.has(id))) {
                return c.json(createErrorResponse('包含不存在的 RSS 来源'), 400);
            }
        }
        const config = dbService.updateAITranslationConfig(data);
        return c.json(createSuccessResponse({
            ...config,
            api_key: undefined,
            has_api_key: !!config.api_key,
        }, 'AI 翻译配置已保存'));
    } catch (error) {
        return c.json(createErrorResponse(`保存 AI 翻译配置失败: ${error}`), 500);
    }
});

apiRoutes.post('/ai-translation/test', createValidationMiddleware(aiTranslationSchema), async (c) => {
    try {
        const dbService = c.get('dbService');
        const stored = dbService.getAITranslationConfig();
        const data = c.get('validatedData');
        const config = {
            ...stored,
            ...data,
            api_key: data.api_key || stored.api_key,
        };
        if (!config.api_url || !config.model) return c.json(createErrorResponse('请填写 API URL 和模型'), 400);

        const translated = await new AITranslationService(dbService).testConfig(config);
        if (!translated) return c.json(createErrorResponse('模型调用失败，请检查 URL、API Key、模型和提示词'), 400);
        return c.json(createSuccessResponse(translated, 'AI 翻译测试成功'));
    } catch (error) {
        return c.json(createErrorResponse(`AI 翻译测试失败: ${error}`), 500);
    }
});

apiRoutes.post('/stats/cleanup', createValidationMiddleware(cleanupSchema), async (c) => {
    try {
        const { amount, unit } = c.get('validatedData');
        const dbService = c.get('dbService');
        const cutoffDate = getCleanupCutoffDate(amount, unit);
        const result = dbService.cleanupPostsBefore(cutoffDate);

        return c.json(createSuccessResponse(result, `已清理 ${amount}${unit === 'days' ? '天' : '个月'}以前的数据`));
    } catch (error) {
        return c.json(createErrorResponse(`清理数据失败: ${error}`), 500);
    }
});
