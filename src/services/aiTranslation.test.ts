import { afterEach, describe, expect, it, mock } from 'bun:test';
import { AITranslationService } from './aiTranslation';
import { logger } from '../utils/logger';
import type { Post } from '../types';

const originalFetch = globalThis.fetch;
const originalLoggerError = logger.error;

afterEach(() => {
    globalThis.fetch = originalFetch;
    logger.error = originalLoggerError;
});

const post: Post = {
    post_id: 1,
    title: 'Hello world',
    memo: 'This is a post body.',
    category: 'tech',
    creator: 'tester',
    push_status: 0,
    rss_source_id: 2,
    pub_date: new Date().toISOString(),
};

function createDatabaseMock(overrides: Record<string, unknown> = {}) {
    return {
        getAITranslationConfig: mock(() => ({
            enabled: 1,
            api_url: 'https://example.com/v1/chat/completions',
            api_key: 'secret',
            model: 'test-model',
            prompt: 'Translate to Chinese and return JSON.',
            rss_source_ids: [2],
            ...overrides,
        })),
    };
}

describe('AITranslationService', () => {
    it('translates posts from selected RSS sources with chat completions payload', async () => {
        const requests: any[] = [];
        globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
            requests.push(JSON.parse(init!.body!.toString()));
            return Response.json({
                choices: [{ message: { content: JSON.stringify({ title: '你好世界', content: '这是一段正文。' }) } }],
            });
        }) as typeof fetch;

        const result = await new AITranslationService(createDatabaseMock() as any).translatePost(post);

        expect(result).toEqual({ title: '你好世界', content: '这是一段正文。' });
        expect(requests[0].model).toBe('test-model');
        expect(requests[0].messages[1].content).toContain('Hello world');
    });

    it('skips translation when the RSS source is not selected', async () => {
        globalThis.fetch = mock(async () => Response.json({})) as typeof fetch;

        const result = await new AITranslationService(createDatabaseMock({ rss_source_ids: [1] }) as any).translatePost(post);

        expect(result).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('falls back to original push flow when model output is invalid', async () => {
        logger.error = mock(() => {});
        globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { content: 'not-json' } }] })) as typeof fetch;

        const result = await new AITranslationService(createDatabaseMock() as any).translatePost(post);

        expect(result).toBeNull();
    });
});
