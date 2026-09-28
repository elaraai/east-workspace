/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure grouping model behind the `DecisionQueue` Group-by toolbar — folds the
 * urgency-sorted rows into labelled sections for the active option (built-in
 * urgency / kind / none, or a custom accessor facet). React-free so the fold
 * is unit-testable without mounting the component.
 *
 * @packageDocumentation
 */

import { DateTimeType, FloatType, compareFor } from '@elaraai/east';
import { URGENCY_RANK, type Decision, type UrgencyKind } from './types.js';

const compareInstants = compareFor(DateTimeType);
const compareValues = compareFor(FloatType);

/**
 * The queue's order: by urgency (overdue → due → routine), then the nearest
 * deadline first — a row with none after every row with one — then the greater
 * value first. Deadlines and values compare as East compares them, so a `NaN`
 * value takes its one place in East's order rather than scrambling the sort.
 *
 * @param a - A row
 * @param b - Another row
 * @returns Negative when `a` comes first, positive when `b` does, else 0
 */
export function compareByUrgency(a: Decision, b: Decision): number {
    const rank = URGENCY_RANK[a.urgency.type] - URGENCY_RANK[b.urgency.type];
    if (rank !== 0) return rank;
    const da = a.deadline.type === 'some' ? a.deadline.value : undefined;
    const db = b.deadline.type === 'some' ? b.deadline.value : undefined;
    if (da !== undefined && db !== undefined) {
        const byDeadline = compareInstants(da, db);
        if (byDeadline !== 0) return byDeadline;
    } else if (da !== db) {
        return da === undefined ? 1 : -1;
    }
    return compareValues(b.value, a.value);
}

/** Section labels for the built-in urgency grouping. */
export const URGENCY_GROUP_LABEL: Record<UrgencyKind, string> = {
    overdue: 'Overdue',
    due: 'Due today',
    routine: 'Routine',
};

/** One Group-by toolbar option — a built-in key or a custom accessor facet. */
export interface GroupOption {
    key: string;
    label: string;
    accessor?: (d: Decision) => string;
}

/** One resolved queue section. */
export interface QueueGroup {
    label: string;
    decisions: Decision[];
    pastSla: number;
    total: number;
    /** Hosts the bulk Accept all (the urgency grouping's Routine section). */
    bulk: boolean;
}

/** Folds the sorted rows into sections for the active grouping. Rows arrive
 *  urgency-sorted, so first-appearance order gives Overdue → Due today →
 *  Routine for the built-in and stable insertion order for the rest. */
export function buildGroups(rows: Decision[], option: GroupOption): QueueGroup[] {
    if (option.key === 'none') {
        return [{ label: '', decisions: rows, pastSla: 0, total: 0, bulk: false }];
    }
    const labelFor = (d: Decision): string =>
        option.key === 'urgency' ? URGENCY_GROUP_LABEL[d.urgency.type]
            : option.key === 'kind' ? d.kind
                : option.accessor?.(d) ?? '';
    const out = new Map<string, QueueGroup>();
    for (const d of rows) {
        const label = labelFor(d);
        let group = out.get(label);
        if (group === undefined) {
            group = {
                label,
                decisions: [],
                pastSla: 0,
                total: 0,
                bulk: option.key === 'urgency' && d.urgency.type === 'routine',
            };
            out.set(label, group);
        }
        group.decisions.push(d);
        group.total += d.value;
        if (d.urgency.type === 'overdue') group.pastSla += 1;
    }
    return [...out.values()];
}
