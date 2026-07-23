import { DatabaseService } from './database';
import { logger } from '../utils/logger';
import type { AITranslationConfig, Post, TranslatedPostContent } from '../types';

interface ChatCompletionResponse {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
    message?: string;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
    };
}

export class AITranslationService {
    constructor(private dbService: DatabaseService) {}

    async translatePost(post: Post): Promise<TranslatedPostContent | null> {
        const config = this.dbService.getAITranslationConfig();
        const source = post.rss_source_id ? this.dbService.getRSSSourceById(post.rss_source_id) : null;
        if (
            source?.ai_translation_enabled !== 1
            || !config.api_url
            || !config.model
        ) return null;

        try {
            return await this.requestTranslation(post, config);
        } catch (error) {
            logger.error(`AI 翻译失败: ${post.title}`, error);
            return null;
        }
    }

    async translateWithConfig(post: Post, config: AITranslationConfig): Promise<TranslatedPostContent> {
        return this.requestTranslation(post, config);
    }

    private async requestTranslation(post: Post, config: AITranslationConfig): Promise<TranslatedPostContent> {
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
        const responseText = await response.text();
        let result: ChatCompletionResponse | null = null;
        try {
            result = responseText ? JSON.parse(responseText) as ChatCompletionResponse | null : null;
        } catch {
            // Some OpenAI-compatible gateways return plain-text errors.
        }

        if (!response.ok) {
            const plainError = responseText.trim();
            const errorMessage = result?.error?.message
                || result?.message
                || (plainError && plainError !== 'null' ? plainError : '')
                || `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
            throw new Error(errorMessage);
        }

        const rawContent = result?.choices?.[0]?.message?.content?.trim();
        if (!rawContent) throw new Error('模型未返回翻译内容');
        const parsed = JSON.parse(rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Partial<TranslatedPostContent>;
        if (!parsed.title || typeof parsed.content !== 'string') throw new Error('模型返回格式不正确');
        const promptTokens = result?.usage?.prompt_tokens ?? result?.usage?.input_tokens ?? 0;
        const completionTokens = result?.usage?.completion_tokens ?? result?.usage?.output_tokens ?? 0;
        const totalTokens = result?.usage?.total_tokens ?? (promptTokens + completionTokens);
        this.dbService.recordAITranslationUsage(promptTokens, completionTokens, totalTokens);
        return { title: parsed.title, content: parsed.content };
    }
}
