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

    return {
        config,
        getBaseConfig: mock(() => config),
        updateBaseConfig: mock((updates: Record<string, unknown>) => Object.assign(config, updates)),
        getAllKeywordSubs: mock(() => []),
        getRecentPosts: mock(() => []),
        createKeywordSub: mock(() => ({ id: 1 })),
        deleteKeywordSub: mock(() => true),
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
});
