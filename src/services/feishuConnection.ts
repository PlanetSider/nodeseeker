import * as Lark from '@larksuiteoapi/node-sdk';
import { DatabaseService } from './database';
import { FeishuService } from './feishu';
import { logger } from '../utils/logger';

export class FeishuConnectionService {
    private wsClient: Lark.WSClient | null = null;
    private credentials = '';

    async sync(dbService: DatabaseService): Promise<void> {
        const config = dbService.getBaseConfig();
        const appId = config?.feishu_app_id?.trim();
        const appSecret = config?.feishu_app_secret?.trim();

        if (!appId || !appSecret) {
            this.stop();
            logger.feishu('未配置 App ID 或 App Secret，跳过长连接');
            return;
        }

        const credentials = `${appId}:${appSecret}`;
        const currentState = this.wsClient?.getConnectionStatus().state;
        if (
            this.credentials === credentials &&
            (currentState === 'connected' || currentState === 'connecting' || currentState === 'reconnecting')
        ) return;

        this.stop();
        this.credentials = credentials;
        const service = new FeishuService(dbService, appId, appSecret);
        const eventDispatcher = new Lark.EventDispatcher({
            loggerLevel: Lark.LoggerLevel.warn,
        }).register({
            'im.message.receive_v1': async (data: any) => {
                try {
                    await service.handleMessageEvent(data);
                } catch (error) {
                    logger.error('处理飞书长连接消息失败:', error);
                }
            },
            'card.action.trigger': async (data: any) => {
                try {
                    return await service.handleCardAction(data);
                } catch (error) {
                    logger.error('处理飞书卡片操作失败:', error);
                    return { toast: { type: 'error', content: '操作失败，请重试' } };
                }
            },
        });

        this.wsClient = new Lark.WSClient({
            appId,
            appSecret,
            domain: Lark.Domain.Feishu,
            loggerLevel: Lark.LoggerLevel.warn,
            autoReconnect: true,
            handshakeTimeoutMs: 15000,
            wsConfig: { pingTimeout: 10 },
            onReady: () => logger.feishu('飞书长连接已建立'),
            onReconnecting: () => logger.warn('飞书长连接断开，正在重连'),
            onReconnected: () => logger.feishu('飞书长连接已恢复'),
            onError: (error) => logger.error('飞书长连接失败:', error),
        });

        try {
            await this.wsClient.start({ eventDispatcher });
            logger.feishu('飞书长连接客户端已启动');
        } catch (error) {
            this.stop();
            logger.error('启动飞书长连接失败:', error);
            throw error;
        }
    }

    stop(): void {
        if (this.wsClient) {
            this.wsClient.close({ force: true });
            this.wsClient = null;
            logger.feishu('飞书长连接已关闭');
        }
        this.credentials = '';
    }

    getStatus() {
        return this.wsClient?.getConnectionStatus() || {
            state: 'idle' as const,
            reconnectAttempts: 0,
        };
    }
}

export const feishuConnectionService = new FeishuConnectionService();
