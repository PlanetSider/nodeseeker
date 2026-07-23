import { describe, expect, it } from 'bun:test';
import { getCleanupCutoffDate, parseCleanupDuration } from './cleanup';

describe('cleanup duration helpers', () => {
    it('parses day and month duration formats', () => {
        expect(parseCleanupDuration('30d')).toEqual({ amount: 30, unit: 'days' });
        expect(parseCleanupDuration('2月')).toEqual({ amount: 2, unit: 'months' });
    });

    it('handles month cutoffs without overflowing short months', () => {
        const cutoff = getCleanupCutoffDate(1, 'months', new Date('2024-03-31T00:00:00.000Z'));
        expect(cutoff.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    });
});
