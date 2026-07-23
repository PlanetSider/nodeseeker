import { afterEach, describe, expect, it, mock } from 'bun:test';
import { FeishuService } from './feishu';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createDatabaseMock() {
    const config = {
        username: 'admin',
        password: 'secret',
        stop_push: 0,
        only_title: 0,
        feishu_verification_token: 'verification-token',
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
    it('responds to Feishu URL verification', async () => {
        const database = createDatabaseMock();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        const result = await service.handleEvent({
            token: 'verification-token',
            challenge: 'challenge-value',
        });

        expect(result).toEqual({ challenge: 'challenge-value' });
    });

    it('rejects events with an invalid verification token', async () => {
        const database = createDatabaseMock();
        const service = new FeishuService(database as any, 'app-id', 'app-secret');

        expect(service.handleEvent({ token: 'invalid', challenge: 'value' }))
            .rejects.toThrow('Verification Token');
    });

    it('moves the start binding command to Feishu messages', async () => {
        const database = createDatabaseMock();
        const requests: Array<{ url: string; body: any }> = [];
        globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            requests.push({ url, body: init?.body ? JSON.parse(init.body.toString()) : null });
            if (url.includes('tenant_access_token')) {
                return Response.json({ code: 0, msg: 'ok', tenant_access_token: 'token', expire: 7200 });
            }
            return Response.json({ code: 0, msg: 'ok' });
        }) as typeof fetch;

        const service = new FeishuService(database as any, 'app-id', 'app-secret');
        await service.handleEvent({
            header: {
                event_id: 'event-1',
                event_type: 'im.message.receive_v1',
                token: 'verification-token',
            },
            event: {
                sender: { sender_id: { open_id: 'ou_user' } },
                message: {
                    chat_id: 'oc_chat',
                    chat_type: 'p2p',
                    message_type: 'text',
                    content: JSON.stringify({ text: '/start' }),
                },
            },
        });

        expect(database.updateBaseConfig).toHaveBeenCalledWith(expect.objectContaining({
            feishu_chat_id: 'oc_chat',
            feishu_user_open_id: 'ou_user',
        }));
        expect(requests.some((request) => request.url.includes('/im/v1/messages'))).toBe(true);
        const messageRequest = requests.find((request) => request.url.includes('/im/v1/messages'));
        expect(JSON.parse(messageRequest!.body.content).text).toContain('绑定成功');
    });
});
