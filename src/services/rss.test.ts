import { describe, expect, it } from 'bun:test';
import { RSSService } from './rss';
import type { RSSItem } from '../types';

const baseItem: RSSItem = {
    title: 'Example title',
    link: 'https://www.nodeseek.com/post-12345-1',
    pubDate: new Date().toUTCString(),
    creator: 'tester',
    category: 'tech',
    contentSnippet: 'body',
    content: 'body',
    guid: 'https://www.nodeseek.com/post-12345-1',
};

function createRSSService() {
    return Object.create(RSSService.prototype) as any;
}

describe('RSSService post id extraction', () => {
    it('extracts NodeSeek post ids from links', () => {
        const service = createRSSService();
        expect(service.extractPostId(baseItem)).toBe(12345);
    });

    it('extracts LowEndTalk discussion ids from links', () => {
        const service = createRSSService();
        expect(service.extractPostId({
            ...baseItem,
            link: 'https://lowendtalk.com/discussion/219421/sota-models-begin-their-attack-on-open-weight-models',
            guid: '219421@/discussions',
        })).toBe(219421);
    });

    it('extracts LowEndTalk discussion ids from GUID when link is unavailable', () => {
        const service = createRSSService();
        expect(service.extractPostId({
            ...baseItem,
            link: '',
            guid: '219409@/discussions',
        })).toBe(219409);
    });

    it('falls back to a stable hash for feeds without numeric ids', () => {
        const service = createRSSService();
        const item = {
            ...baseItem,
            link: 'https://example.com/posts/hello-world',
            guid: 'hello-world-guid',
        };
        expect(service.extractPostId(item)).toBe(service.extractPostId(item));
        expect(service.extractPostId(item)).toBeGreaterThan(0);
    });
});
