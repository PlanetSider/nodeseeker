import { DatabaseService } from './database';
import { logger } from '../utils/logger';
import type { KeywordSub, Post } from '../types';

interface FeishuApiResponse<T = unknown> {
    code: number;
    msg: string;
    data?: T;
    tenant_access_token?: string;
    expire?: number;
}

interface FeishuMessageEvent {
    schema?: string;
    token?: string;
    challenge?: string;
    header?: {
        event_id?: string;
        event_type?: string;
        token?: string;
    };
    event?: {
        sender?: {
            sender_id?: { open_id?: string };
            sender_type?: string;
        };
        message?: {
            chat_id?: string;
            chat_type?: string;
            content?: string;
            message_type?: string;
        };
    };
}

const API_BASE = 'https://open.feishu.cn/open-apis';
const processedEvents = new Map<string, number>();

export class FeishuService {
    private accessToken?: string;
    private accessTokenExpiresAt = 0;

    constructor(
        private dbService: DatabaseService,
        private appId: string,
        private appSecret: string,
    ) {}

    private async getAccessToken(): Promise<string> {
        if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
            return this.accessToken;
        }

        const response = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
        });
        const result = await response.json() as FeishuApiResponse;
        if (!response.ok || result.code !== 0 || !result.tenant_access_token) {
            throw new Error(result.msg || `HTTP ${response.status}`);
        }

        this.accessToken = result.tenant_access_token;
        this.accessTokenExpiresAt = Date.now() + Math.max((result.expire || 7200) - 300, 60) * 1000;
        return this.accessToken;
    }

    async testConnection(): Promise<boolean> {
        try {
            await this.getAccessToken();
            return true;
        } catch (error) {
            logger.error('飞书应用连接失败:', error);
            return false;
        }
    }

    async sendMessage(receiveId: string, text: string, receiveIdType = 'chat_id'): Promise<boolean> {
        try {
            const token = await this.getAccessToken();
            const response = await fetch(`${API_BASE}/im/v1/messages?receive_id_type=${receiveIdType}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({
                    receive_id: receiveId,
                    msg_type: 'text',
                    content: JSON.stringify({ text }),
                }),
            });
            const result = await response.json() as FeishuApiResponse;
            if (!response.ok || result.code !== 0) {
                throw new Error(result.msg || `HTTP ${response.status}`);
            }
            return true;
        } catch (error) {
            logger.error('发送飞书消息失败:', error);
            return false;
        }
    }

    async pushPost(post: Post, matchedSub: KeywordSub): Promise<boolean> {
        const config = this.dbService.getBaseConfig();
        if (!config?.feishu_chat_id || config.stop_push === 1) return false;

        const keywords = [matchedSub.keyword1, matchedSub.keyword2, matchedSub.keyword3]
            .filter((keyword) => keyword?.trim())
            .join(' + ');
        const details = [
            keywords && `🎯 ${keywords}`,
            matchedSub.creator && `👤 ${matchedSub.creator}`,
            matchedSub.category && `🗂️ ${this.getCategoryName(matchedSub.category)}`,
        ].filter(Boolean).join('  ');
        const text = `${details}\n\n${post.title}\nhttps://www.nodeseek.com/post-${post.post_id}-1`;
        const success = await this.sendMessage(config.feishu_chat_id, text);

        if (success) {
            this.dbService.updatePostPushStatus(post.post_id, 3, matchedSub.id, new Date().toISOString());
        }
        return success;
    }

    async handleEvent(payload: FeishuMessageEvent): Promise<{ challenge?: string }> {
        const config = this.dbService.getBaseConfig();
        const token = payload.header?.token || payload.token;
        if (!config?.feishu_verification_token || token !== config.feishu_verification_token) {
            throw new Error('飞书事件 Verification Token 校验失败');
        }
        if (payload.challenge) return { challenge: payload.challenge };
        if (payload.header?.event_type !== 'im.message.receive_v1') return {};

        const eventId = payload.header.event_id;
        if (eventId && this.isDuplicateEvent(eventId)) return {};

        const message = payload.event?.message;
        const senderOpenId = payload.event?.sender?.sender_id?.open_id;
        if (!message?.chat_id || !senderOpenId || message.message_type !== 'text') return {};

        let text = '';
        try {
            text = JSON.parse(message.content || '{}').text?.trim() || '';
        } catch {
            return {};
        }
        const cleanText = text.replace(/@_user_\d+/g, '').trim();
        const commandText = cleanText.split(/\s+/)[0]?.trim();
        if (!commandText.startsWith('/')) return {};

        const reply = await this.executeCommand(commandText.toLowerCase(), cleanText.split(/\s+/).slice(1), {
            chatId: message.chat_id,
            senderOpenId,
            chatType: message.chat_type || '',
        });
        if (reply) await this.sendMessage(message.chat_id, reply);
        return {};
    }

    private isDuplicateEvent(eventId: string): boolean {
        const now = Date.now();
        for (const [id, timestamp] of processedEvents) {
            if (now - timestamp > 10 * 60 * 1000) processedEvents.delete(id);
        }
        if (processedEvents.has(eventId)) return true;
        processedEvents.set(eventId, now);
        return false;
    }

    private async executeCommand(
        command: string,
        args: string[],
        sender: { chatId: string; senderOpenId: string; chatType: string },
    ): Promise<string> {
        const config = this.dbService.getBaseConfig();
        if (!config) return '系统尚未初始化，请先在网页端完成初始化。';

        if (command === '/help') return this.getHelpText();
        if (command === '/start') {
            if (config.feishu_user_open_id && config.feishu_user_open_id !== sender.senderOpenId) {
                return '绑定失败：系统已绑定其他飞书用户，请由原用户发送 /unbind，或在网页端解除绑定。';
            }
            this.dbService.updateBaseConfig({
                feishu_chat_id: sender.chatId,
                feishu_user_open_id: sender.senderOpenId,
                bound_user_name: sender.senderOpenId,
            });
            return `绑定成功。后续推送将发送到当前${sender.chatType === 'group' ? '群聊' : '会话'}。\n\n${this.getHelpText()}`;
        }
        if (!config.feishu_user_open_id || config.feishu_user_open_id !== sender.senderOpenId) {
            return '您没有权限使用此命令，请先发送 /start 绑定。';
        }

        switch (command) {
            case '/stop':
                this.dbService.updateBaseConfig({ stop_push: 1 });
                return '已停止推送，发送 /resume 可恢复。';
            case '/resume':
                this.dbService.updateBaseConfig({ stop_push: 0 });
                return '已恢复推送。';
            case '/unbind':
                this.dbService.updateBaseConfig({
                    feishu_chat_id: '',
                    feishu_user_open_id: '',
                    bound_user_name: '',
                    bound_user_username: '',
                });
                return '绑定已解除。如需重新绑定，请发送 /start。';
            case '/getme':
                return `飞书 Open ID：${sender.senderOpenId}\n会话 Chat ID：${sender.chatId}\n绑定状态：已绑定`;
            case '/list':
                return this.listSubscriptions();
            case '/add':
                return this.addSubscription(args);
            case '/del':
                return this.deleteSubscription(args);
            case '/post':
                return this.listRecentPosts();
            default:
                return `未知命令：${command}\n发送 /help 查看可用命令。`;
        }
    }

    private listSubscriptions(): string {
        const subscriptions = this.dbService.getAllKeywordSubs();
        if (subscriptions.length === 0) return '暂无订阅，使用 /add 关键词1 关键词2 添加。';
        const lines = subscriptions.map((sub, index) => {
            const keywords = [sub.keyword1, sub.keyword2, sub.keyword3].filter(Boolean).join(' + ');
            return `${index + 1}. ID:${sub.id}  ${keywords || sub.creator || sub.category}`;
        });
        return `当前订阅列表：\n\n${lines.join('\n')}\n\n使用 /del 订阅ID 删除。`;
    }

    private addSubscription(args: string[]): string {
        if (args.length === 0) return '请提供关键词。用法：/add 关键词1 关键词2 关键词3';
        try {
            const sub = this.dbService.createKeywordSub({
                keyword1: args[0],
                keyword2: args[1],
                keyword3: args[2],
            });
            return `订阅添加成功。ID:${sub.id}，关键词：${args.slice(0, 3).join(' + ')}`;
        } catch (error) {
            return `添加订阅失败：${error}`;
        }
    }

    private deleteSubscription(args: string[]): string {
        const id = Number.parseInt(args[0], 10);
        if (!Number.isInteger(id)) return '请提供数字订阅 ID。用法：/del 订阅ID';
        return this.dbService.deleteKeywordSub(id) ? `订阅 ${id} 删除成功。` : `订阅 ${id} 不存在。`;
    }

    private listRecentPosts(): string {
        const posts = this.dbService.getRecentPosts(10);
        if (posts.length === 0) return '暂无文章数据。';
        return `最近 10 条文章：\n\n${posts.map((post, index) => `${index + 1}. ${post.title}\nhttps://www.nodeseek.com/post-${post.post_id}-1`).join('\n')}`;
    }

    private getHelpText(): string {
        return [
            'NodeSeek RSS 飞书机器人命令：',
            '/start - 绑定当前用户和会话',
            '/getme - 查看绑定信息',
            '/list - 查看订阅列表',
            '/add 关键词1 关键词2 关键词3 - 添加订阅',
            '/del 订阅ID - 删除订阅',
            '/post - 查看最近 10 条文章',
            '/stop - 停止推送',
            '/resume - 恢复推送',
            '/unbind - 解除绑定',
            '/help - 查看帮助',
        ].join('\n');
    }

    private getCategoryName(category: string): string {
        const names: Record<string, string> = {
            daily: '日常', tech: '技术', info: '情报', review: '测评', trade: '交易',
            carpool: '拼车', promotion: '推广', life: '生活', dev: 'Dev', photo: '贴图',
            expose: '曝光', sandbox: '沙盒',
        };
        return names[category] || category;
    }
}
