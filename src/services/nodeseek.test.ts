import { afterEach, describe, expect, it, mock } from 'bun:test';
import { NodeSeekService } from './nodeseek';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createDatabaseMock() {
    return {
        getBaseConfig: mock(() => ({ rss_proxy: '' })),
    };
}

describe('NodeSeekService', () => {
    it('extracts the title, author, category, and formatted post body', () => {
        const service = new NodeSeekService(createDatabaseMock() as any);
        const post = service.parsePostHtml(`
            <html>
                <head>
                    <meta property="og:title" content="完整标题">
                    <meta name="author" content="alice">
                    <meta property="article:section" content="tech">
                </head>
                <body>
                    <div class="post-content">
                        <p><strong>第一段</strong></p>
                        <ul><li>列表项</li></ul>
                    </div>
                </body>
            </html>
        `, 123);

        expect(post).toEqual({
            postId: 123,
            title: '完整标题',
            creator: 'alice',
            category: 'tech',
            content: '**第一段**\n\n-   列表项',
            link: 'https://www.nodeseek.com/post-123-1',
        });
    });

    it('fetches the canonical post URL and reuses the configured proxy', async () => {
        const database = createDatabaseMock();
        database.getBaseConfig = mock(() => ({ rss_proxy: 'http://127.0.0.1:7890' }));
        const requests: Array<{ url: string; proxy?: string }> = [];
        globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit & { proxy?: string }) => {
            requests.push({ url: input.toString(), proxy: init?.proxy });
            return new Response('<div class="post-content">完整正文</div>', { status: 200 });
        }) as typeof fetch;

        const post = await new NodeSeekService(database as any, 1000).fetchPost(456);

        expect(post.postId).toBe(456);
        expect(post.content).toBe('完整正文');
        expect(requests).toEqual([expect.objectContaining({
            url: 'https://www.nodeseek.com/post-456-1',
            proxy: 'http://127.0.0.1:7890',
        })]);
    });

    it('rejects pages without a readable post body', () => {
        const service = new NodeSeekService(createDatabaseMock() as any);
        expect(() => service.parsePostHtml('<html><title>Only title</title></html>', 789))
            .toThrow('网页中没有找到帖子正文');
    });
});
