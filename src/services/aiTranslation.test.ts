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
        getRSSSourceById: mock((id: number) => ({
            id,
            name: 'Source',
            url: 'https://example.com/rss',
            enabled: 1,
            subscription_enabled: 1,
            ai_translation_enabled: 1,
        })),
        recordAITranslationUsage: mock(() => {}),
    };
}

describe('AITranslationService', () => {
    it('translates posts from selected RSS sources with chat completions payload', async () => {
        const requests: any[] = [];
        globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
            requests.push(JSON.parse(init!.body!.toString()));
            return Response.json({
                choices: [{ message: { content: JSON.stringify({ title: '你好世界', content: '这是一段正文。' }) } }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            });
        }) as typeof fetch;
        const database = createDatabaseMock();

        const result = await new AITranslationService(database as any).translatePost(post);

        expect(result).toEqual({ title: '你好世界', content: '这是一段正文。' });
        expect(requests[0].model).toBe('test-model');
        expect(requests[0].messages[1].content).toContain('Hello world');
        expect(database.recordAITranslationUsage).toHaveBeenCalledWith(10, 5, 15);
    });

    it('accepts OpenAI-compatible base URLs for translation tests', async () => {
        const urls: string[] = [];
        globalThis.fetch = mock(async (input: RequestInfo | URL) => {
            urls.push(input.toString());
            return Response.json({
                choices: [{ message: { content: JSON.stringify({ title: '你好世界', content: '这是一段正文。' }) } }],
            });
        }) as typeof fetch;

        await new AITranslationService(createDatabaseMock({ api_url: 'https://example.com/v1' }) as any).translatePost(post);

        expect(urls).toEqual(['https://example.com/v1/chat/completions']);
    });

    it('skips translation when the RSS source is not selected', async () => {
        globalThis.fetch = mock(async () => Response.json({})) as typeof fetch;

        const database = createDatabaseMock();
        database.getRSSSourceById = mock(() => ({
            id: 2,
            name: 'Source',
            url: 'https://example.com/rss',
            enabled: 1,
            subscription_enabled: 1,
            ai_translation_enabled: 0,
        }));

        const result = await new AITranslationService(database as any).translatePost(post);

        expect(result).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('falls back to original push flow when model output is invalid', async () => {
        logger.error = mock(() => {});
        globalThis.fetch = mock(async () => Response.json({ choices: [{ message: { content: 'not-json' } }] })) as typeof fetch;

        const result = await new AITranslationService(createDatabaseMock() as any).translatePost(post);

        expect(result).toBeNull();
    });

    it('handles null JSON error responses without throwing a TypeError', async () => {
        const logError = mock(() => {});
        logger.error = logError;
        globalThis.fetch = mock(async () => Response.json(null, { status: 502, statusText: 'Bad Gateway' })) as typeof fetch;

        const result = await new AITranslationService(createDatabaseMock() as any).translatePost(post);

        expect(result).toBeNull();
        expect(logError).toHaveBeenCalledWith(
            'AI 翻译失败: Hello world',
            expect.objectContaining({ message: 'HTTP 502 Bad Gateway' }),
        );
    });

    it('reports plain-text API errors', async () => {
        const logError = mock(() => {});
        logger.error = logError;
        globalThis.fetch = mock(async () => new Response('upstream unavailable', { status: 503 })) as typeof fetch;

        const result = await new AITranslationService(createDatabaseMock() as any).translatePost(post);

        expect(result).toBeNull();
        expect(logError).toHaveBeenCalledWith(
            'AI 翻译失败: Hello world',
            expect.objectContaining({ message: 'upstream unavailable' }),
        );
    });

    it('exposes translation errors to end-to-end tests', async () => {
        globalThis.fetch = mock(async () => new Response('invalid model', { status: 400 })) as typeof fetch;
        const config = createDatabaseMock().getAITranslationConfig();

        await expect(new AITranslationService(createDatabaseMock() as any).translateWithConfig(post, config as any))
            .rejects.toThrow('invalid model');
    });

    it('adds endpoint guidance for empty 404 responses', async () => {
        globalThis.fetch = mock(async () => new Response('', { status: 404, statusText: 'Not Found' })) as typeof fetch;
        const config = createDatabaseMock({ api_url: 'https://example.com/v1' }).getAITranslationConfig();

        await expect(new AITranslationService(createDatabaseMock() as any).translateWithConfig(post, config as any))
            .rejects.toThrow('AI API 地址返回 404');
    });
});
