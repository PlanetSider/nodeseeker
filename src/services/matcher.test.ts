import { describe, expect, it } from 'bun:test';
import { MatcherService } from './matcher';
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
