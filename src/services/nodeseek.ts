import { htmlToMarkdown, htmlToReadableText } from '../utils/content';
import { logger } from '../utils/logger';
import type { DatabaseService } from './database';

export interface NodeSeekPost {
    postId: number;
    title: string;
    creator: string;
    category: string;
    content: string;
    link: string;
}

const NODESEEK_BASE_URL = 'https://www.nodeseek.com';
const DEFAULT_TIMEOUT_MS = 30000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36';

export class NodeSeekService {
    constructor(
        private dbService: DatabaseService,
        private timeoutMs = Number(process.env.RSS_TIMEOUT) || DEFAULT_TIMEOUT_MS,
    ) {}

    async fetchPost(postId: number): Promise<NodeSeekPost> {
        if (!Number.isInteger(postId) || postId <= 0) {
            throw new Error('帖子编号必须是正整数');
        }

        const link = `${NODESEEK_BASE_URL}/post-${postId}-1`;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();

        try {
            timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
            const fetchOptions: RequestInit & { proxy?: string } = {
                signal: controller.signal,
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                },
            };
            const proxy = this.dbService.getBaseConfig()?.rss_proxy?.trim();
            if (proxy) fetchOptions.proxy = proxy;

            const response = await fetch(link, fetchOptions);
            if (!response.ok) {
                throw new Error(`网站返回 HTTP ${response.status}`);
            }

            const html = await response.text();
            return this.parsePostHtml(html, postId, link);
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`访问 NodeSeek 超时（${this.timeoutMs}ms）`);
            }
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`获取 NodeSeek 帖子 ${postId} 失败:`, error);
            throw new Error(`获取 NodeSeek 帖子失败：${message}`);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    parsePostHtml(html: string, postId: number, link = `${NODESEEK_BASE_URL}/post-${postId}-1`): NodeSeekPost {
        const title = this.firstNonEmpty([
            this.extractMeta(html, 'property', 'og:title'),
            this.extractMeta(html, 'name', 'twitter:title'),
            this.extractElementText(html, 'h1'),
            this.extractElementText(html, 'title'),
        ]) || `NodeSeek 帖子 ${postId}`;

        const creator = this.firstNonEmpty([
            this.extractMeta(html, 'name', 'author'),
            this.extractMeta(html, 'property', 'article:author'),
            ...[
                'a[href*="/user/"]',
                '[class*="username"]',
                '[class*="user-name"]',
                '[class*="author"]',
            ].map((selector) => this.extractElementText(html, selector)),
        ]);

        const category = this.firstNonEmpty([
            this.extractMeta(html, 'property', 'article:section'),
            this.extractMeta(html, 'name', 'category'),
            this.extractElementText(html, '[class*="category"]'),
        ]);

        const contentHtml = this.firstNonEmpty([
            ...[
                '[class*="post-content"]',
                '[class*="post-body"]',
                '[class*="topic-content"]',
                '[class*="message-content"]',
                'article',
                'main',
            ].map((selector) => this.extractElementHtml(html, selector)),
        ]);
        const content = contentHtml ? htmlToMarkdown(contentHtml) : '';
        if (!content) {
            throw new Error('网页中没有找到帖子正文，可能是页面结构已变化或需要登录');
        }

        return { postId, title, creator, category, content, link };
    }

    private extractMeta(html: string, attribute: string, value: string): string {
        const tags = html.match(/<meta\b[^>]*>/gi) || [];
        for (const tag of tags) {
            const attributeValue = tag.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
            if (attributeValue?.toLowerCase() !== value.toLowerCase()) continue;
            const content = tag.match(/content\s*=\s*["']([\s\S]*?)["']/i)?.[1] || '';
            if (content) return this.cleanText(content);
        }
        return '';
    }

    private extractElementText(html: string, selector: string): string {
        const elementHtml = this.extractElementHtml(html, selector);
        return elementHtml ? this.cleanText(htmlToReadableText(elementHtml)) : '';
    }

    private extractElementHtml(html: string, selector: string): string {
        if (typeof HTMLRewriter === 'undefined') return '';

        const marker = `__NODESEEK_${Math.random().toString(36).slice(2)}__`;
        const startMarker = `${marker}_START`;
        const endMarker = `${marker}_END`;
        let matched = false;

        const transformed = new HTMLRewriter()
            .on(selector, {
                element: (element) => {
                    if (matched) return;
                    matched = true;
                    element.before(startMarker);
                    element.onEndTag((endTag) => endTag.after(endMarker));
                },
            })
            .transform(html);
        const start = transformed.indexOf(startMarker);
        const end = transformed.indexOf(endMarker, start + startMarker.length);
        if (start < 0 || end < 0) return '';
        return transformed.slice(start + startMarker.length, end);
    }

    private cleanText(value: string): string {
        return value.replace(/\s+/g, ' ').trim();
    }

    private firstNonEmpty(values: string[]): string {
        return values.map((value) => value.trim()).find(Boolean) || '';
    }
}
