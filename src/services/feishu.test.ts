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

function getPostContent(request: { body: any }): { title: string; text: string } {
    const content = JSON.parse(request.body.content).zh_cn;
    return {
        title: content.title,
        text: content.content.flat().map((element: { text?: string }) => element.text || '').join(''),
    };
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
        }, {
            id: 1,
            keyword1: 'Example',
            creator: 'tester',
            category: 'tech',
            rss_source_name: 'NodeSeek',
        });

        expect(sent).toBe(true);
        const messageRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        expect(messageRequest!.body.msg_type).toBe('post');
        expect(getPostContent(messageRequest!).text).toBe([
            '正文：',
            '🎯 Example  📡 Custom',
            '👤 tester  🗂️ 技术',
            'Body',
            '[查看原文](https://www.nodeseek.com/post-123-1)',
        ].join('\n'));
    });

    it('includes the original post body when AI translation is unavailable', async () => {
        const database = createDatabaseMock();
        database.config.feishu_chat_id = 'oc_chat';
        database.config.feishu_user_open_id = 'ou_user';
        const requests = mockFeishuFetch();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        const sent = await service.pushPost({
            post_id: 456,
            title: 'Original title',
            memo: 'Original post body',
            category: 'tech',
            creator: 'tester',
            push_status: 0,
            rss_source_id: 1,
            pub_date: new Date().toISOString(),
        });

        expect(sent).toBe(true);
        const messageRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        const message = getPostContent(messageRequest!);
        expect(message.title).toBe('Original title');
        expect(message.text).toContain('👤 tester');
        expect(message.text).toContain('🗂️ 技术');
        expect(message.text).toContain('Original post body');
    });

    it('includes the NodeSeek post number below the author row', async () => {
        const database = createDatabaseMock();
        database.config.feishu_chat_id = 'oc_chat';
        const requests = mockFeishuFetch();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        const sent = await service.pushPost({
            post_id: 987,
            title: 'NodeSeek post',
            memo: 'Post body',
            category: 'tech',
            creator: 'author',
            push_status: 0,
            rss_source_id: 1,
            link: 'https://www.nodeseek.com/post-987-1',
            pub_date: new Date().toISOString(),
        });

        expect(sent).toBe(true);
        const messageRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        const message = getPostContent(messageRequest!);
        expect(message.text).toContain('👤 author  🗂️ 技术\n🆔 帖子编号：987');
    });

    it('does not add a NodeSeek post number for other link formats', async () => {
        const database = createDatabaseMock();
        database.config.feishu_chat_id = 'oc_chat';
        const requests = mockFeishuFetch();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        await service.pushPost({
            post_id: 988,
            title: 'Other post',
            memo: 'Post body',
            category: 'tech',
            creator: 'author',
            push_status: 0,
            rss_source_id: 2,
            link: 'https://lowendtalk.com/discussion/988/topic',
            pub_date: new Date().toISOString(),
        });

        const messageRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        expect(getPostContent(messageRequest!).text).not.toContain('🆔 帖子编号');
    });

    it('renders original HTML as Markdown in Feishu posts', async () => {
        const database = createDatabaseMock();
        database.config.feishu_chat_id = 'oc_chat';
        const requests = mockFeishuFetch();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        const sent = await service.pushPost({
            post_id: 789,
            title: 'Formatted post',
            memo: 'Fallback body',
            content_html: '<p><strong>Important</strong></p><ul><li>First</li><li>Second</li></ul><p><a href="https://example.com/docs">Docs</a></p>',
            category: 'tech',
            creator: 'tester',
            push_status: 0,
            rss_source_id: 1,
            pub_date: new Date().toISOString(),
        });

        expect(sent).toBe(true);
        const messageRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        const message = getPostContent(messageRequest!);
        expect(message.text).toContain('**Important**');
        expect(message.text).toContain('-   First');
        expect(message.text).toContain('[Docs](https://example.com/docs)');
    });

    it('splits long rich posts without truncating text or breaking emoji', async () => {
        const database = createDatabaseMock();
        const requests = mockFeishuFetch();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');
        const longMarkdown = `${'段落内容🙂'.repeat(900)}\n\n结尾`;

        const sent = await service.sendLongPost('oc_chat', 'Long post', longMarkdown);

        expect(sent).toBe(true);
        const postRequests = requests.filter((request) => request.body?.msg_type === 'post');
        expect(postRequests.length).toBeGreaterThan(1);
        expect(postRequests.map((request) => getPostContent(request).text).join('')).toBe(longMarkdown);
        expect(getPostContent(postRequests[0]).title).toContain('(1/');
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
