export type CleanupUnit = 'days' | 'months';

export function getCleanupCutoffDate(amount: number, unit: CleanupUnit, now: Date = new Date()): Date {
    const cutoff = new Date(now);
    if (unit === 'days') {
        cutoff.setDate(cutoff.getDate() - amount);
        return cutoff;
    }

    const targetDay = cutoff.getDate();
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth() - amount);
    const lastDayOfTargetMonth = new Date(
        cutoff.getFullYear(),
        cutoff.getMonth() + 1,
        0
    ).getDate();
    cutoff.setDate(Math.min(targetDay, lastDayOfTargetMonth));
    return cutoff;
}

export function parseCleanupDuration(value?: string): { amount: number; unit: CleanupUnit } | null {
    const match = value?.trim().toLowerCase().match(/^(\d+)\s*(d|m|天|月)$/);
    if (!match) return null;

    const amount = Number.parseInt(match[1], 10);
    if (amount <= 0) return null;

    return {
        amount,
        unit: match[2] === 'm' || match[2] === '月' ? 'months' : 'days'
    };
}
