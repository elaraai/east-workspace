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

import { type Decision, type UrgencyKind } from './types.js';

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
