/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { isRecordNarrowing } from "./view-state.js";
import type { SheetSavedView } from "./values.js";

interface Count { count: number | undefined; error?: string }

/** Exact indexed counts for saved tabs; pending counts never become resident-row counts. */
export function useRecordViewCounts(slice: ValueTypeOf<RecordSliceBindType> | undefined, views: readonly SheetSavedView[]) {
    const read = useCallback(() => {
        const counts = new Map<string, Count>();
        if (slice === undefined) return { total: undefined, counts };
        const total = slice.total();
        for (const view of views) {
            if (!isRecordNarrowing(view.narrowing)) continue;
            try {
                const count = slice.countWhere(view.narrowing.where);
                counts.set(view.id, { count: count.type === "some" ? Number(count.value) : undefined });
            } catch (error) {
                counts.set(view.id, { count: undefined, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return { total: total.type === "some" ? Number(total.value) : undefined, counts };
    }, [slice, views]);
    return useTrackedEvaluation(read).result;
}
