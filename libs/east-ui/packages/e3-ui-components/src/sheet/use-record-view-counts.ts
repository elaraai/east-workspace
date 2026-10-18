/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { SheetSavedView } from "./values.js";

interface Count { count: number | undefined; error?: string }

/**
 * Exact indexed counts for the saved tabs (#1345): each view's narrowing of
 * the `rows` source, counted through the record's indexes — the rows the tab
 * shows — and the whole record's for All. A view that holds no `rows`
 * narrowing counts every row. Pending counts never become resident-row counts.
 *
 * @param rows - The `rows` source's part of the sheet's slice; `undefined` with no `rows` source
 * @param views - The saved views
 * @returns The whole count, and each view's, by its id
 */
export function useRecordViewCounts(rows: ValueTypeOf<RecordSliceBindType> | undefined, views: readonly SheetSavedView[]) {
    const read = useCallback(() => {
        const counts = new Map<string, Count>();
        if (rows === undefined) return { total: undefined, counts };
        const total = rows.total();
        for (const view of views) {
            try {
                const count = rows.countWhere(view.narrowing.get("rows")?.where ?? new Map());
                counts.set(view.id, { count: count.type === "some" ? Number(count.value) : undefined });
            } catch (error) {
                counts.set(view.id, { count: undefined, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return { total: total.type === "some" ? Number(total.value) : undefined, counts };
    }, [rows, views]);
    return useTrackedEvaluation(read).result;
}
