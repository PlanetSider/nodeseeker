import { describe, expect, it } from 'bun:test';
import { keywordSubSchema, keywordSubUpdateSchema } from './validation';

describe('keyword subscription validation', () => {
    it('preserves multiple RSS source IDs when creating subscriptions', () => {
        expect(keywordSubSchema.parse({ keyword1: 'vps', rss_source_ids: [1, '2'] }).rss_source_ids).toEqual([1, 2]);
    });

    it('allows clearing all RSS source restrictions when updating subscriptions', () => {
        expect(keywordSubUpdateSchema.parse({ rss_source_ids: [] }).rss_source_ids).toEqual([]);
    });
});
