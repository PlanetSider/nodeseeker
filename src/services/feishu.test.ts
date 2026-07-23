import { afterEach, describe, expect, it, mock } from 'bun:test';
import { FeishuService } from './feishu';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function mockFeishuFetch(requests: Array<{ url: string; body: any }> = []) {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        requests.push({ url, body: init?.body ? JSON.parse(init.body.toString()) : null });
        if (url.includes('tenant_access_token')) {
            return Response.json({ code: 0, msg: 'ok', tenant_access_token: 'token', expire: 7200 });
        }
        return Response.json({ code: 0, msg: 'ok' });
    }) as typeof fetch;
    return requests;
}

function createDatabaseMock() {
    const config = {
        username: 'admin',
        password: 'secret',
        stop_push: 0,
        only_title: 0,
    };

    const sources = [
        { id: 1, name: 'NodeSeek', url: 'https://rss.nodeseek.com/', enabled: 1 },
        { id: 2, name: 'Custom', url: 'https://example.com/rss', enabled: 1 },
    ];
    const subscriptions: any[] = [];
    let nextSubscriptionId = 1;

    return {
        config,
        sources,
        subscriptions,
        getBaseConfig: mock(() => config),
        updateBaseConfig: mock((updates: Record<string, unknown>) => Object.assign(config, updates)),
        getAllKeywordSubs: mock(() => subscriptions),
        getAllRSSSources: mock((includeDisabled = false) => sources.filter((source) => includeDisabled || source.enabled === 1)),
        getRSSSourceById: mock((id: number) => sources.find((source) => source.id === id) || null),
        getAITranslationConfig: mock(() => ({ api_url: '', model: '', prompt: '', rss_source_ids: [] })),
        updatePostPushStatus: mock(() => {}),
        getRecentPosts: mock(() => []),
        createKeywordSub: mock((sub: Record<string, unknown>) => {
            const created = { id: nextSubscriptionId++, ...sub };
            subscriptions.push(created);
            return created;
        }),
        updateKeywordSub: mock((id: number, updates: Record<string, unknown>) => {
            const subscription = subscriptions.find((sub) => sub.id === id);
            return subscription ? Object.assign(subscription, updates) : null;
        }),
        deleteKeywordSub: mock((id: number) => {
            const index = subscriptions.findIndex((sub) => sub.id === id);
            if (index === -1) return false;
            subscriptions.splice(index, 1);
            return true;
        }),
    };
}

describe('FeishuService', () => {
    it('handles the start binding command from Feishu long connection messages', async () => {
        const database = createDatabaseMock();
        const requests = mockFeishuFetch();

        const service = new FeishuService(database as any, 'app-id', 'app-secret');
        await service.handleMessageEvent({
            sender: { sender_id: { open_id: 'ou_user' } },
            message: {
                chat_id: 'oc_chat',
                chat_type: 'p2p',
                message_type: 'text',
                content: JSON.stringify({ text: '/start' }),
            },
        }, 'event-1');

        expect(database.updateBaseConfig).toHaveBeenCalledWith(expect.objectContaining({
            feishu_chat_id: 'oc_chat',
            feishu_user_open_id: 'ou_user',
        }));
        expect(requests.some((request) => request.url.includes('/im/v1/messages'))).toBe(true);
        const messageRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        expect(JSON.parse(messageRequest!.body.content).text).toContain('绑定成功');
    });

    it('ignores duplicated long connection events', async () => {
        const database = createDatabaseMock();
        mockFeishuFetch();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');
        const event = {
            sender: { sender_id: { open_id: 'ou_user' } },
            message: {
                chat_id: 'oc_chat',
                chat_type: 'p2p',
                message_type: 'text',
                content: JSON.stringify({ text: '/start' }),
            },
        };

        await service.handleMessageEvent(event, 'duplicate-event');
        await service.handleMessageEvent(event, 'duplicate-event');

        expect(database.updateBaseConfig).toHaveBeenCalledTimes(1);
    });

    it('splits long Feishu text messages without dropping content', async () => {
        const database = createDatabaseMock();
        const requests = mockFeishuFetch();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');
        const longText = '完整翻译正文'.repeat(900);

        const sent = await service.sendLongMessage('oc_chat', longText);

        expect(sent).toBe(true);
        const messageTexts = requests
            .filter((request) => request.url.includes('/im/v1/messages'))
            .map((request) => JSON.parse(request.body.content).text as string);
        expect(messageTexts.length).toBeGreaterThan(1);
        expect(messageTexts.map((text) => text.replace(/^\(\d+\/\d+\)\n/, '')).join('')).toBe(longText);
    });

    it('shows the actual RSS source when pushing translated posts', async () => {
        const database = createDatabaseMock();
        database.config.feishu_chat_id = 'oc_chat';
        database.config.feishu_user_open_id = 'ou_user';
        const requests = mockFeishuFetch();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        const sent = await service.pushPost({
            post_id: 123,
            title: 'Example title',
            memo: 'Body',
            category: 'tech',
            creator: 'tester',
            push_status: 0,
            rss_source_id: 2,
            pub_date: new Date().toISOString(),
        }, { id: 1, keyword1: 'Example', rss_source_name: 'NodeSeek' });

        expect(sent).toBe(true);
        const messageRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        expect(JSON.parse(messageRequest!.body.content).text).toContain('📡 Custom');
    });

    it('sends an RSS source card for /add and applies strict keywords on click', async () => {
        const database = createDatabaseMock();
        const requests = mockFeishuFetch();
        database.config.feishu_user_open_id = 'ou_user';
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        await service.handleMessageEvent({
            sender: { sender_id: { open_id: 'ou_user' } },
            message: {
                chat_id: 'oc_chat',
                chat_type: 'p2p',
                message_type: 'text',
                content: JSON.stringify({ text: '/add nc -y vps' }),
            },
        }, 'strict-add-event');

        const cardRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        expect(cardRequest!.body.msg_type).toBe('interactive');
        const card = JSON.parse(cardRequest!.body.content);
        expect(card.header.title.content).toBe('选择 RSS 来源');
        expect(card.elements.filter((element: any) => element.tag === 'action')).toHaveLength(3);
        expect(card.elements.find((element: any) => element.tag === 'action').actions[0].text.content).toBe('全部来源');

        const result = await service.handleCardAction({
            operator: { open_id: 'ou_user' },
            action: {
                value: {
                    action: 'rss_subscription_toggle',
                    mode: 'add',
                    source_id: 2,
                    keywords: ['nc', 'vps'],
                    strict: [1, 0],
                },
            },
        });

        expect(database.createKeywordSub).toHaveBeenCalledWith(expect.objectContaining({
            keyword1: 'nc',
            keyword1_strict: 1,
            keyword2: 'vps',
            keyword2_strict: 0,
            rss_source_ids: [2],
        }));
        expect(result?.toast).toEqual(expect.objectContaining({ type: 'success' }));
    });

    it('applies /add keywords to all RSS sources from the card', async () => {
        const database = createDatabaseMock();
        database.config.feishu_user_open_id = 'ou_user';
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        const result = await service.handleCardAction({
            operator: { open_id: 'ou_user' },
            action: { value: {
                action: 'rss_subscription_toggle',
                mode: 'add_all',
                keywords: ['vps'],
                strict: [1],
            } },
        });

        expect(database.createKeywordSub).toHaveBeenCalledWith(expect.objectContaining({
            keyword1: 'vps',
            keyword1_strict: 1,
            rss_source_ids: [],
        }));
        expect(result?.toast).toEqual({ type: 'success', content: '已应用于全部来源' });
        const card = result?.card as any;
        expect(card.elements.find((element: any) => element.tag === 'action').actions[0].text.content)
            .toBe('已应用 · 全部来源');
    });

    it('can apply one keyword to multiple RSS sources from the card', async () => {
        const database = createDatabaseMock();
        database.config.feishu_user_open_id = 'ou_user';
        const service = new FeishuService(database as any, 'app-id', 'app-secret');
        const action = (sourceId: number) => service.handleCardAction({
            operator: { open_id: 'ou_user' },
            action: { value: {
                action: 'rss_subscription_toggle',
                mode: 'add',
                source_id: sourceId,
                keywords: ['vps'],
                strict: [0],
            } },
        });

        await action(1);
        await action(2);

        expect(database.subscriptions.map((sub) => sub.rss_source_ids?.[0] || sub.rss_source_id)).toEqual([1, 2]);
    });

    it('shows monitored RSS sources for /del keyword and removes a selected source', async () => {
        const database = createDatabaseMock();
        const requests = mockFeishuFetch();
        database.config.feishu_user_open_id = 'ou_user';
        database.subscriptions.push(
            { id: 1, keyword1: 'vps', keyword1_strict: 0, rss_source_id: 1 },
            { id: 2, keyword1: 'vps', keyword1_strict: 0, rss_source_id: 2 },
        );
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        await service.handleMessageEvent({
            sender: { sender_id: { open_id: 'ou_user' } },
            message: {
                chat_id: 'oc_chat',
                chat_type: 'p2p',
                message_type: 'text',
                content: JSON.stringify({ text: '/del vps' }),
            },
        }, 'delete-card-event');

        const cardRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        const card = JSON.parse(cardRequest!.body.content);
        expect(card.header.title.content).toBe('取消 RSS 监控');
        expect(card.elements.filter((element: any) => element.tag === 'action')).toHaveLength(2);

        const result = await service.handleCardAction({
            operator: { open_id: 'ou_user' },
            action: { value: {
                action: 'rss_subscription_toggle',
                mode: 'delete',
                source_id: 1,
                keyword: 'vps',
            } },
        });

        expect(database.subscriptions.map((sub) => sub.rss_source_ids?.[0] || sub.rss_source_id)).toEqual([2]);
        expect((result?.card as any).elements.filter((element: any) => element.tag === 'action')).toHaveLength(1);
    });

    it('rejects card actions from users other than the bound Feishu user', async () => {
        const database = createDatabaseMock();
        database.config.feishu_user_open_id = 'ou_user';
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        const result = await service.handleCardAction({
            operator: { open_id: 'ou_other' },
            action: { value: {
                action: 'rss_subscription_toggle',
                mode: 'add',
                source_id: 1,
                keywords: ['vps'],
            } },
        });

        expect(database.createKeywordSub).not.toHaveBeenCalled();
        expect(result?.toast).toEqual(expect.objectContaining({ type: 'error' }));
    });

    it('converts an all-source subscription when one source is cancelled', async () => {
        const database = createDatabaseMock();
        database.config.feishu_user_open_id = 'ou_user';
        database.subscriptions.push({ id: 1, keyword1: 'vps', keyword1_strict: 0 });
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        await service.handleCardAction({
            operator: { open_id: 'ou_user' },
            action: { value: {
                action: 'rss_subscription_toggle',
                mode: 'delete',
                source_id: 1,
                keyword: 'vps',
            } },
        });

        expect(database.subscriptions.map((sub) => sub.rss_source_ids?.[0] || sub.rss_source_id)).toEqual([2]);
        expect(database.subscriptions[0].keyword1).toBe('vps');
    });
});
