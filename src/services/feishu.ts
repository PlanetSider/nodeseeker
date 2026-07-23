import { DatabaseService } from './database';
import { AITranslationService } from './aiTranslation';
import { logger } from '../utils/logger';
import { getCleanupCutoffDate, parseCleanupDuration } from '../utils/cleanup';
import type { KeywordSub, Post, RSSSource } from '../types';

interface FeishuApiResponse<T = unknown> {
    code: number;
    msg: string;
    data?: T;
    tenant_access_token?: string;
    expire?: number;
}

export interface FeishuMessageEvent {
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
}

interface FeishuCardActionValue {
    action?: string;
    mode?: 'add' | 'add_all' | 'delete';
    source_id?: number;
    keywords?: string[];
    strict?: number[];
    keyword?: string;
}

export interface FeishuCardActionEvent {
    context?: { open_chat_id?: string; open_message_id?: string };
    operator?: { open_id?: string; openId?: string };
    action?: {
        value?: unknown;
        tag?: string;
    };
    raw?: {
        operator?: { open_id?: string };
        action?: FeishuCardActionValue;
    };
}

type FeishuCard = Record<string, unknown>;
type CommandReply = string | { card: FeishuCard };

const API_BASE = 'https://open.feishu.cn/open-apis';
const processedEvents = new Map<string, number>();
const FEISHU_TEXT_CHUNK_SIZE = 3500;

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

    async sendLongMessage(receiveId: string, text: string, receiveIdType = 'chat_id'): Promise<boolean> {
        const chunks = this.splitMessage(text);
        for (const chunk of chunks) {
            const sent = await this.sendMessage(receiveId, chunk, receiveIdType);
            if (!sent) return false;
        }
        return true;
    }

    async sendCard(receiveId: string, card: FeishuCard, receiveIdType = 'chat_id'): Promise<boolean> {
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
                    msg_type: 'interactive',
                    content: JSON.stringify(card),
                }),
            });
            const result = await response.json() as FeishuApiResponse;
            if (!response.ok || result.code !== 0) {
                throw new Error(result.msg || `HTTP ${response.status}`);
            }
            return true;
        } catch (error) {
            logger.error('发送飞书卡片失败:', error);
            return false;
        }
    }

    async pushPost(post: Post, matchedSub?: KeywordSub): Promise<boolean> {
        const config = this.dbService.getBaseConfig();
        if (!config?.feishu_chat_id || config.stop_push === 1) return false;

        const keywords = [matchedSub?.keyword1, matchedSub?.keyword2, matchedSub?.keyword3]
            .filter((keyword) => keyword?.trim())
            .join(' + ');
        const sourceName = post.rss_source_id
            ? this.dbService.getRSSSourceById(post.rss_source_id)?.name
            : undefined;
        const details = [
            keywords && `🎯 ${keywords}`,
            matchedSub?.creator && `👤 ${matchedSub.creator}`,
            matchedSub?.category && `🗂️ ${this.getCategoryName(matchedSub.category)}`,
            (sourceName || post.rss_source_name || matchedSub?.rss_source_name) && `📡 ${sourceName || post.rss_source_name || matchedSub?.rss_source_name}`,
        ].filter(Boolean).join('  ');
        const translated = await new AITranslationService(this.dbService).translatePost(post);
        const postContent = translated
            ? `${translated.title}\n\n${translated.content}`
            : post.title;
        const link = post.link || `https://www.nodeseek.com/post-${post.post_id}-1`;
        const text = `${details}\n\n${postContent}\n${link}`;
        const success = await this.sendLongMessage(config.feishu_chat_id, text);

        if (success) {
            this.dbService.updatePostPushStatus(post.post_id, 3, matchedSub?.id, new Date().toISOString(), post.rss_source_id);
        }
        return success;
    }

    private splitMessage(text: string): string[] {
        if (text.length <= FEISHU_TEXT_CHUNK_SIZE) return [text];
        const chunks: string[] = [];
        let remaining = text;
        while (remaining.length > FEISHU_TEXT_CHUNK_SIZE) {
            let splitAt = remaining.lastIndexOf('\n\n', FEISHU_TEXT_CHUNK_SIZE);
            if (splitAt < FEISHU_TEXT_CHUNK_SIZE * 0.5) {
                splitAt = remaining.lastIndexOf('\n', FEISHU_TEXT_CHUNK_SIZE);
            }
            if (splitAt < FEISHU_TEXT_CHUNK_SIZE * 0.5) splitAt = FEISHU_TEXT_CHUNK_SIZE;
            chunks.push(remaining.slice(0, splitAt).trimEnd());
            remaining = remaining.slice(splitAt).trimStart();
        }
        if (remaining) chunks.push(remaining);
        return chunks.map((chunk, index) => chunks.length > 1 ? `(${index + 1}/${chunks.length})\n${chunk}` : chunk);
    }

    async handleMessageEvent(payload: FeishuMessageEvent, eventId?: string): Promise<void> {
        if (eventId && this.isDuplicateEvent(eventId)) return;

        const message = payload.message;
        const senderOpenId = payload.sender?.sender_id?.open_id;
        if (!message?.chat_id || !senderOpenId || message.message_type !== 'text') return;

        let text = '';
        try {
            text = JSON.parse(message.content || '{}').text?.trim() || '';
        } catch {
            return;
        }
        const cleanText = text.replace(/@_user_\d+/g, '').trim();
        const commandText = cleanText.split(/\s+/)[0]?.trim();
        if (!commandText.startsWith('/')) return;

        const reply = await this.executeCommand(commandText.toLowerCase(), cleanText.split(/\s+/).slice(1), {
            chatId: message.chat_id,
            senderOpenId,
            chatType: message.chat_type || '',
        });
        if (typeof reply === 'string') {
            await this.sendMessage(message.chat_id, reply);
        } else if (reply?.card) {
            await this.sendCard(message.chat_id, reply.card);
        }
    }

    async handleCardAction(payload: FeishuCardActionEvent): Promise<Record<string, unknown> | undefined> {
        const value = (payload.action?.value || payload.raw?.action) as FeishuCardActionValue | undefined;
        const operatorOpenId = payload.operator?.open_id || payload.operator?.openId || payload.raw?.operator?.open_id;
        const config = this.dbService.getBaseConfig();
        if (!value || value.action !== 'rss_subscription_toggle') return undefined;
        if (!operatorOpenId || config?.feishu_user_open_id !== operatorOpenId) {
            return { toast: { type: 'error', content: '您没有权限修改订阅' } };
        }

        if (value.mode === 'add' || value.mode === 'add_all') {
            const keywords = (value.keywords || []).filter(Boolean).slice(0, 3);
            if (keywords.length === 0) return { toast: { type: 'error', content: '关键词不能为空' } };
            if (value.mode === 'add_all') {
                this.addAllSourceSubscription(keywords, value.strict || []);
                return {
                    toast: { type: 'success', content: '已应用于全部来源' },
                    card: this.buildAddSourceCard(keywords, value.strict || []),
                };
            }
            const sourceId = Number(value.source_id);
            const source = this.dbService.getRSSSourceById(sourceId);
            if (!source) return { toast: { type: 'error', content: 'RSS 来源不存在' } };
            this.addSourceSubscription(keywords, value.strict || [], sourceId);
            return {
                toast: { type: 'success', content: `已应用于 ${source.name}` },
                card: this.buildAddSourceCard(keywords, value.strict || []),
            };
        }

        if (value.mode === 'delete' && value.keyword) {
            const sourceId = Number(value.source_id);
            const source = this.dbService.getRSSSourceById(sourceId);
            if (!source) return { toast: { type: 'error', content: 'RSS 来源不存在' } };
            this.removeKeywordFromSource(value.keyword, sourceId);
            return {
                toast: { type: 'success', content: `已取消 ${source.name} 的监控` },
                card: this.buildDeleteSourceCard(value.keyword),
            };
        }

        return undefined;
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
    ): Promise<CommandReply> {
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
                return this.createAddSubscriptionCard(args);
            case '/del':
                return this.createDeleteSubscriptionCard(args);
            case '/post':
                return this.listRecentPosts();
            case '/clear':
                return this.clearPosts(args);
            default:
                return `未知命令：${command}\n发送 /help 查看可用命令。`;
        }
    }

    private listSubscriptions(): string {
        const subscriptions = this.dbService.getAllKeywordSubs();
        if (subscriptions.length === 0) return '暂无订阅，使用 /add 关键词1 关键词2 添加。';
        const lines = subscriptions.map((sub, index) => {
            const keywords = [1, 2, 3]
                .map((keywordIndex) => {
                    const keyword = sub[`keyword${keywordIndex}` as keyof KeywordSub] as string | undefined;
                    const strict = sub[`keyword${keywordIndex}_strict` as keyof KeywordSub] === 1;
                    return keyword ? `${keyword}${strict ? ' [严格]' : ''}` : '';
                })
                .filter(Boolean)
                .join(' + ');
            const source = sub.rss_source_names?.length ? `  来源:${sub.rss_source_names.join('、')}` : '  来源:全部';
            return `${index + 1}. ID:${sub.id}  ${keywords || sub.creator || sub.category}${source}`;
        });
        return `当前订阅列表：\n\n${lines.join('\n')}\n\n使用 /del 订阅ID 删除。`;
    }

    private createAddSubscriptionCard(args: string[]): CommandReply {
        const parsed = this.parseKeywords(args);
        if (typeof parsed === 'string') return parsed;
        if (this.dbService.getAllRSSSources().length === 0) return '暂无启用的 RSS 来源，请先在网页端添加并启用来源。';
        return { card: this.buildAddSourceCard(parsed.keywords, parsed.strict) };
    }

    private createDeleteSubscriptionCard(args: string[]): CommandReply {
        if (args.length !== 1) return '请提供一个关键词。用法：/del 关键词';

        const id = Number.parseInt(args[0], 10);
        if (Number.isInteger(id) && String(id) === args[0]) {
            return this.dbService.deleteKeywordSub(id) ? `订阅 ${id} 删除成功。` : `订阅 ${id} 不存在。`;
        }

        const keyword = args[0].trim();
        const sourceIds = this.getKeywordSourceIds(keyword);
        if (sourceIds.size === 0) return `关键词「${keyword}」当前没有按 RSS 来源设置的监控。`;
        return { card: this.buildDeleteSourceCard(keyword) };
    }

    private parseKeywords(args: string[]): { keywords: string[]; strict: number[] } | string {
        if (args.length === 0) return '请提供关键词。用法：/add 关键词1 -y 关键词2';
        const keywords: string[] = [];
        const strict: number[] = [];
        for (const arg of args) {
            if (arg.toLowerCase() === '-y') {
                if (keywords.length === 0) return '-y 必须跟在需要严格匹配的关键词后面。';
                strict[keywords.length - 1] = 1;
                continue;
            }
            if (keywords.length < 3) {
                keywords.push(arg);
                strict.push(0);
            }
        }
        return keywords.length > 0
            ? { keywords, strict }
            : '请提供关键词。用法：/add 关键词1 -y 关键词2';
    }

    private addSourceSubscription(keywords: string[], strict: number[], sourceId: number): void {
        const exists = this.dbService.getAllKeywordSubs().some((sub) =>
            this.subscriptionCoversSource(sub, sourceId)
            && [sub.keyword1, sub.keyword2, sub.keyword3].every((keyword, index) => (keyword || '') === (keywords[index] || ''))
            && [sub.keyword1_strict, sub.keyword2_strict, sub.keyword3_strict].every((value, index) => (value || 0) === (strict[index] || 0))
        );
        if (exists) return;

        this.dbService.createKeywordSub({
            keyword1: keywords[0],
            keyword2: keywords[1],
            keyword3: keywords[2],
            keyword1_strict: strict[0] || 0,
            keyword2_strict: strict[1] || 0,
            keyword3_strict: strict[2] || 0,
            rss_source_ids: [sourceId],
        });
    }

    private addAllSourceSubscription(keywords: string[], strict: number[]): void {
        const exists = this.dbService.getAllKeywordSubs().some((sub) =>
            this.getSubscriptionSourceIds(sub).length === 0
            && [sub.keyword1, sub.keyword2, sub.keyword3].every((keyword, index) => (keyword || '') === (keywords[index] || ''))
            && [sub.keyword1_strict, sub.keyword2_strict, sub.keyword3_strict].every((value, index) => (value || 0) === (strict[index] || 0))
        );
        if (exists) return;

        this.dbService.createKeywordSub({
            keyword1: keywords[0],
            keyword2: keywords[1],
            keyword3: keywords[2],
            keyword1_strict: strict[0] || 0,
            keyword2_strict: strict[1] || 0,
            keyword3_strict: strict[2] || 0,
            rss_source_ids: [],
        });
    }

    private getSubscriptionSourceIds(sub: KeywordSub): number[] {
        return sub.rss_source_ids?.length ? sub.rss_source_ids : (sub.rss_source_id ? [sub.rss_source_id] : []);
    }

    private subscriptionCoversSource(sub: KeywordSub, sourceId: number): boolean {
        const sourceIds = this.getSubscriptionSourceIds(sub);
        return sourceIds.length === 0 || sourceIds.includes(sourceId);
    }

    private removeKeywordFromSource(keyword: string, sourceId: number): void {
        const normalized = keyword.toLowerCase();
        const subscriptions = this.dbService.getAllKeywordSubs().filter((sub) =>
            this.subscriptionCoversSource(sub, sourceId)
            && [sub.keyword1, sub.keyword2, sub.keyword3].some((value) => value?.toLowerCase() === normalized)
        );

        for (const sub of subscriptions) {
            if (this.getSubscriptionSourceIds(sub).length === 0) {
                this.dbService.deleteKeywordSub(sub.id!);
                for (const source of this.dbService.getAllRSSSources(true)) {
                    const removeFromSource = source.id === sourceId;
                    this.createSourceScopedCopy(sub, source.id!, removeFromSource ? normalized : undefined);
                }
                continue;
            }

            const remaining = [
                { value: sub.keyword1, strict: sub.keyword1_strict },
                { value: sub.keyword2, strict: sub.keyword2_strict },
                { value: sub.keyword3, strict: sub.keyword3_strict },
            ].filter((item) => item.value && item.value.toLowerCase() !== normalized);

            if (remaining.length === 0 && !sub.creator && !sub.category) {
                this.dbService.deleteKeywordSub(sub.id!);
                continue;
            }

            this.dbService.updateKeywordSub(sub.id!, {
                keyword1: remaining[0]?.value || '',
                keyword2: remaining[1]?.value || '',
                keyword3: remaining[2]?.value || '',
                keyword1_strict: remaining[0]?.strict || 0,
                keyword2_strict: remaining[1]?.strict || 0,
                keyword3_strict: remaining[2]?.strict || 0,
            });
        }
    }

    private createSourceScopedCopy(sub: KeywordSub, sourceId: number, excludedKeyword?: string): void {
        const remaining = [
            { value: sub.keyword1, strict: sub.keyword1_strict },
            { value: sub.keyword2, strict: sub.keyword2_strict },
            { value: sub.keyword3, strict: sub.keyword3_strict },
        ].filter((item) => item.value && item.value.toLowerCase() !== excludedKeyword);
        if (remaining.length === 0 && !sub.creator && !sub.category) return;

        const copy = {
            keyword1: remaining[0]?.value,
            keyword2: remaining[1]?.value,
            keyword3: remaining[2]?.value,
            keyword1_strict: remaining[0]?.strict || 0,
            keyword2_strict: remaining[1]?.strict || 0,
            keyword3_strict: remaining[2]?.strict || 0,
            creator: sub.creator,
            category: sub.category,
            rss_source_ids: [sourceId],
        };
        const exists = this.dbService.getAllKeywordSubs().some((existing) =>
            this.getSubscriptionSourceIds(existing).length === 1
            && this.getSubscriptionSourceIds(existing)[0] === sourceId
            && [existing.keyword1, existing.keyword2, existing.keyword3]
                .every((value, index) => (value || '') === ([copy.keyword1, copy.keyword2, copy.keyword3][index] || ''))
            && (existing.creator || '') === (copy.creator || '')
            && (existing.category || '') === (copy.category || '')
        );
        if (!exists) this.dbService.createKeywordSub(copy);
    }

    private getKeywordSourceIds(keyword: string): Set<number> {
        const normalized = keyword.toLowerCase();
        const subscriptions = this.dbService.getAllKeywordSubs().filter((sub) =>
            [sub.keyword1, sub.keyword2, sub.keyword3].some((value) => value?.toLowerCase() === normalized));
        if (subscriptions.some((sub) => this.getSubscriptionSourceIds(sub).length === 0)) {
            return new Set(this.dbService.getAllRSSSources(true).map((source) => source.id!));
        }
        return new Set(subscriptions.flatMap((sub) => this.getSubscriptionSourceIds(sub)));
    }

    private buildAddSourceCard(keywords: string[], strict: number[]): FeishuCard {
        const sources = this.dbService.getAllRSSSources();
        const matchingSubscriptions = this.dbService.getAllKeywordSubs()
            .filter((sub) => [sub.keyword1, sub.keyword2, sub.keyword3]
                .every((keyword, index) => (keyword || '') === (keywords[index] || ''))
                && [sub.keyword1_strict, sub.keyword2_strict, sub.keyword3_strict]
                    .every((value, index) => (value || 0) === (strict[index] || 0)));
        const allSelected = matchingSubscriptions.some((sub) => this.getSubscriptionSourceIds(sub).length === 0);
        const selected = allSelected
            ? new Set(sources.map((source) => source.id!))
            : new Set(matchingSubscriptions.flatMap((sub) => this.getSubscriptionSourceIds(sub)));
        const description = keywords.map((keyword, index) => `${keyword}${strict[index] ? ' [严格]' : ''}`).join(' + ');
        return this.buildSourceCard('选择 RSS 来源', `关键词：**${description}**\n\n点击“全部来源”或一个/多个来源应用监控。`, sources, (source) => ({
            text: selected.has(source.id!) ? `已应用 · ${source.name}` : source.name,
            type: selected.has(source.id!) ? 'primary' : 'default',
            value: {
                action: 'rss_subscription_toggle',
                mode: 'add',
                source_id: source.id,
                keywords,
                strict,
            },
        }), {
            text: allSelected ? '已应用 · 全部来源' : '全部来源',
            type: allSelected ? 'primary' : 'default',
            value: {
                action: 'rss_subscription_toggle',
                mode: 'add_all',
                keywords,
                strict,
            },
        });
    }

    private buildDeleteSourceCard(keyword: string): FeishuCard {
        const sourceIds = this.getKeywordSourceIds(keyword);
        const sources = this.dbService.getAllRSSSources(true).filter((source) => sourceIds.has(source.id!));
        const content = sources.length > 0
            ? `关键词：**${keyword}**\n\n点击来源取消对应监控。`
            : `关键词：**${keyword}**\n\n已取消所有按来源设置的监控。`;
        return this.buildSourceCard('取消 RSS 监控', content, sources, (source) => ({
            text: `取消 · ${source.name}`,
            type: 'danger',
            value: {
                action: 'rss_subscription_toggle',
                mode: 'delete',
                source_id: source.id,
                keyword,
            },
        }));
    }

    private buildSourceCard(
        title: string,
        content: string,
        sources: RSSSource[],
        createButton: (source: RSSSource) => { text: string; type: string; value: Record<string, unknown> },
        firstButton?: { text: string; type: string; value: Record<string, unknown> },
    ): FeishuCard {
        const firstAction = firstButton ? [{
            tag: 'action',
            actions: [{
                tag: 'button',
                text: { tag: 'plain_text', content: firstButton.text },
                type: firstButton.type,
                value: firstButton.value,
            }],
        }] : [];
        return {
            config: { wide_screen_mode: true, update_multi: true },
            header: { title: { tag: 'plain_text', content: title }, template: 'blue' },
            elements: [
                { tag: 'markdown', content },
                ...firstAction,
                ...sources.map((source) => {
                    const button = createButton(source);
                    return {
                        tag: 'action',
                        actions: [{
                            tag: 'button',
                            text: { tag: 'plain_text', content: button.text },
                            type: button.type,
                            value: button.value,
                        }],
                    };
                }),
            ],
        };
    }

    private listRecentPosts(): string {
        const posts = this.dbService.getRecentPosts(10);
        if (posts.length === 0) return '暂无文章数据。';
        return `最近 10 条文章：\n\n${posts.map((post, index) => `${index + 1}. ${post.title}\n${post.link || `https://www.nodeseek.com/post-${post.post_id}-1`}`).join('\n')}`;
    }

    private clearPosts(args: string[]): string {
        const duration = parseCleanupDuration(args[0]);
        if (!duration) return '用法：/clear 30d 或 /clear 2m（也支持 30天、2月）。';

        try {
            const result = this.dbService.cleanupPostsBefore(
                getCleanupCutoffDate(duration.amount, duration.unit)
            );
            return `清理完成：删除 ${result.deletedCount} 条文章，数据库 ${result.databaseSizeBeforeMb.toFixed(2)} M → ${result.databaseSizeAfterMb.toFixed(2)} M。`;
        } catch (error) {
            return `清理失败：${error}`;
        }
    }

    private getHelpText(): string {
        return [
            'NodeSeek RSS 飞书机器人命令：',
            '/start - 绑定当前用户和会话',
            '/getme - 查看绑定信息',
            '/list - 查看订阅列表',
            '/add 关键词1 -y 关键词2 - 打开卡片选择一个或多个 RSS 来源',
            '/del 关键词 - 打开卡片选择要取消监控的 RSS 来源',
            '/del 订阅ID - 直接删除指定订阅（兼容旧用法）',
            '/post - 查看最近 10 条文章',
            '/clear 30d 或 /clear 2m - 清理指定时间以前的文章',
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
