import { DatabaseService } from './database';
import { logger } from '../utils/logger';
import type { AITranslationConfig, Post, TranslatedPostContent } from '../types';

interface ChatCompletionResponse {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
}

export class AITranslationService {
    constructor(private dbService: DatabaseService) {}

    async translatePost(post: Post): Promise<TranslatedPostContent | null> {
        const config = this.dbService.getAITranslationConfig();
        if (
            config.enabled !== 1
            || !post.rss_source_id
            || !config.rss_source_ids.includes(post.rss_source_id)
            || !config.api_url
            || !config.model
        ) return null;

        return this.requestTranslation(post, config);
    }

    async testConfig(config: AITranslationConfig): Promise<TranslatedPostContent | null> {
        return this.requestTranslation({
            post_id: 0,
            title: 'Hello world',
            memo: 'This is an AI translation connection test.',
            category: '',
            creator: '',
            push_status: 0,
            pub_date: new Date().toISOString(),
        }, config);
    }

    private async requestTranslation(post: Post, config: AITranslationConfig): Promise<TranslatedPostContent | null> {
        try {
            const response = await fetch(config.api_url, {
                method: 'POST',
                signal: AbortSignal.timeout(30000),
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        { role: 'system', content: config.prompt },
                        {
                            role: 'user',
                            content: `${JSON.stringify({ title: post.title, content: post.memo })}\n\nReturn only valid JSON with string fields "title" and "content".`,
                        },
                    ],
                }),
            });
            const result = await response.json() as ChatCompletionResponse;
            if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);

            const rawContent = result.choices?.[0]?.message?.content?.trim();
            if (!rawContent) throw new Error('模型未返回翻译内容');
            const parsed = JSON.parse(rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Partial<TranslatedPostContent>;
            if (!parsed.title || typeof parsed.content !== 'string') throw new Error('模型返回格式不正确');
            return { title: parsed.title, content: parsed.content };
        } catch (error) {
            logger.error(`AI 翻译失败: ${post.title}`, error);
            return null;
        }
    }
}
