import { describe, expect, it, mock } from 'bun:test';
import { MatcherService } from './matcher';
import { logger } from '../utils/logger';
import type { KeywordSub, Post } from '../types';

const basePost: Post = {
    post_id: 1,
    title: 'ncloud server',
    memo: '',
    category: 'tech',
    creator: 'tester',
    push_status: 0,
    pub_date: new Date().toISOString(),
};

function createMatcher(keyword: string, strict = 0) {
    const dbService = {
        getAllKeywordSubs: () => [{ id: 1, keyword1: keyword, keyword1_strict: strict }],
        getBaseConfig: () => ({ only_title: 0 }),
    };
    return new MatcherService(dbService as any, null);
}

function createMatcherWithSubscriptions(subscriptions: KeywordSub[]) {
    const dbService = {
        getAllKeywordSubs: () => subscriptions,
        getBaseConfig: () => ({ only_title: 0 }),
    };
    return new MatcherService(dbService as any, null);
}

describe('MatcherService strict keyword matching', () => {
    it('does not match strict keywords inside longer words', () => {
        const matcher = createMatcher('nc', 1);
        expect(matcher.checkPostMatches(basePost)).toHaveLength(0);
    });

    it('matches strict keywords case-insensitively as standalone tokens', () => {
        const matcher = createMatcher('nc', 1);
        expect(matcher.checkPostMatches({ ...basePost, title: 'NC server' })).toHaveLength(1);
    });

    it('keeps regular keywords as contains matching', () => {
        const matcher = createMatcher('nc', 0);
        expect(matcher.checkPostMatches(basePost)).toHaveLength(1);
    });

    it('matches source-scoped subscriptions only for the same RSS source', () => {
        const matcher = createMatcherWithSubscriptions([
            { id: 1, keyword1: 'ncloud', rss_source_id: 1 },
            { id: 2, keyword1: 'ncloud', rss_source_id: 2 },
            { id: 3, keyword1: 'ncloud' },
        ]);

        const matches = matcher.checkPostMatches({ ...basePost, rss_source_id: 1 });

        expect(matches.map((match) => match.subscription?.id)).toEqual([1, 3]);
    });

    it('does not match source-scoped subscriptions when post source is unknown', () => {
        const matcher = createMatcherWithSubscriptions([
            { id: 1, keyword1: 'ncloud', rss_source_id: 1 },
            { id: 2, keyword1: 'ncloud' },
        ]);

        const matches = matcher.checkPostMatches(basePost);

        expect(matches.map((match) => match.subscription?.id)).toEqual([2]);
    });
});

describe('MatcherService RSS subscription toggle', () => {
    it('pushes new posts directly when source subscriptions are disabled', async () => {
        const originalFeishuLogger = logger.feishu;
        logger.feishu = mock(() => {});
        const updates: any[] = [];
        const dbService = {
            getBaseConfig: () => ({
                only_title: 0,
                stop_push: 0,
                feishu_app_id: 'app-id',
                feishu_chat_id: 'chat-id',
            }),
            getUnpushedPosts: () => [{ ...basePost, rss_source_id: 2, rss_source_name: 'Direct feed' }],
            getAllKeywordSubs: () => [],
            getAllRSSSources: () => [{
                id: 2,
                name: 'Direct feed',
                url: 'https://example.com/rss',
                enabled: 1,
                subscription_enabled: 0,
            }],
            batchUpdatePostPushStatus: mock((items: any[]) => updates.push(...items)),
        };
        const feishuService = { pushPost: mock(async () => true) };
        const matcher = new MatcherService(dbService as any, feishuService as any);

        try {
            const result = await matcher.processUnpushedPosts();

            expect(feishuService.pushPost).toHaveBeenCalledWith(expect.objectContaining({ post_id: 1 }), undefined);
            expect(updates).toEqual([expect.objectContaining({ pushStatus: 1, rssSourceId: 2 })]);
            expect(result.pushed).toBe(1);
        } finally {
            logger.feishu = originalFeishuLogger;
        }
    });

    it('does not directly push unmatched posts when source subscriptions are enabled', async () => {
        const updates: any[] = [];
        const dbService = {
            getBaseConfig: () => ({ only_title: 0, stop_push: 0 }),
            getUnpushedPosts: () => [{ ...basePost, rss_source_id: 2 }],
            getAllKeywordSubs: () => [],
            getAllRSSSources: () => [{
                id: 2,
                name: 'Subscribed feed',
                url: 'https://example.com/rss',
                enabled: 1,
                subscription_enabled: 1,
            }],
            batchUpdatePostPushStatus: mock((items: any[]) => updates.push(...items)),
        };
        const matcher = new MatcherService(dbService as any, null);

        const result = await matcher.processUnpushedPosts();

        expect(updates).toEqual([expect.objectContaining({ pushStatus: 2, rssSourceId: 2 })]);
        expect(result.skipped).toBe(1);
    });
});
