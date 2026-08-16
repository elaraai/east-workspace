/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Table's paged-source loader (#576) — the POSITIONAL sibling of the
 * Plan's.
 *
 * Both walk the same window plan (`planWindows`, the shared machinery) and both
 * read inside a tracked evaluation, because `page()` is a reactive platform
 * read: `none` while a window is in flight, and the channel notifies when it
 * lands. What differs is only the collection, which is the whole point of
 * parameterising the row-source contract on it: a Table window is an
 * `Array<Dict<String, Cell>>` in STREAM order, so windows CONCATENATE in offset
 * order, where the Plan's keyed windows merge by key.
 *
 * Exhaustion comes from `total()`, never from an empty window — the same
 * source-element contract the Plan learned the hard way (#567 D2). A window
 * that maps to zero rows says nothing about the source.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import { Table } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { planWindows, type RowRange } from "../paged-window-store.js";

type TableRootValue = ValueTypeOf<typeof Table.Types.Root>;
/** The decoded `paged` arm — the source at the Table's own row collection. */
export type TablePagedSourceValue = Extract<TableRootValue["rows"], { type: "paged" }>["value"];
/** One decoded table row — the column-keyed cell dict. */
export type TableRowValue = ValueTypeOf<typeof Table.Types.Root>["rows"] extends never ? never
    : Map<string, ValueTypeOf<typeof Table.Types.Cell>>;

/** Source elements requested per window. */
export const TABLE_PAGE_SIZE = 200;

/**
 * Windows the dense prefix may span (#581).
 *
 * The runtime retains a bounded number of DECODED windows across all paged
 * sources; a reader that asks for more than that in one pass is asking the
 * cache to hold more than it can. The prefix therefore stops here and the
 * chrome reports the shortfall (`N loaded of M`) rather than silently walking
 * off the end.
 *
 * This cap is the interim bound. #577 replaces the Plan's dense prefix with
 * viewport-shaped demand, at which point the budget is a retention policy
 * rather than a ceiling on how far the reader may go.
 */
const MAX_PREFIX_WINDOWS = 20;


export interface TablePagedRows {
    /** The loaded rows, in stream order. */
    rows: TableRowValue[];
    /** The source's total ELEMENT count, once known. */
    total: number | undefined;
    /** Source elements whose window has landed. */
    loadedElements: number;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** Why the source could not be read, when it could not be. */
    error: string | undefined;
}

const IDLE: TablePagedRows = { rows: [], total: undefined, loadedElements: 0, loading: false, error: undefined };

/** One line naming why a source read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Stream a paged source's windows into table rows.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline table; idles)
 * @param wanted - The source-element range the viewport is asking for
 * @returns The loaded rows + totals + loading state
 */
export function useTablePagedRows(
    source: TablePagedSourceValue | undefined,
    wanted?: RowRange,
): TablePagedRows {
    const wantedEnd = wanted?.end;

    const read = useCallback((): TablePagedRows => {
        if (source === undefined) return IDLE;
        let total: number | undefined;
        let error: string | undefined;
        try {
            const t = source.total();
            if (t.type === "some") total = Number(t.value);
        } catch (err) {
            console.error("[Table] paged source total failed:", err);
            error = readFailure(err);
        }
        // The row model is dense (TanStack indexes rows positionally), so the
        // table keeps a CONTIGUOUS prefix exactly as the Plan does. Sparse,
        // viewport-shaped demand is tracked separately.
        const end = wantedEnd ?? total ?? TABLE_PAGE_SIZE;
        const range: RowRange = { start: 0, end: Math.max(end, TABLE_PAGE_SIZE) };
        const plan = planWindows(range, TABLE_PAGE_SIZE, total, 1);
        const needed = plan.needed.slice(0, MAX_PREFIX_WINDOWS);
        const rows: TableRowValue[] = [];
        let loading = false;
        let loadedElements = 0;
        for (const w of needed) {
            let win: ReturnType<TablePagedSourceValue["page"]>;
            try {
                win = source.page(BigInt(w * TABLE_PAGE_SIZE), BigInt(TABLE_PAGE_SIZE));
            } catch (err) {
                console.error("[Table] paged source page failed:", err);
                error ??= readFailure(err);
                break;
            }
            if (win.type !== "some") {
                // In flight. Stop here: the prefix must stay contiguous, or a
                // later window's rows would land at the wrong indices.
                loading = true;
                break;
            }
            // Stream order — windows CONCATENATE at their offsets.
            for (const row of win.value) rows.push(row as TableRowValue);
            loadedElements += TABLE_PAGE_SIZE;
        }
        if (total !== undefined) loadedElements = Math.min(loadedElements, total);
        return { rows, total, loadedElements, loading, error };
    }, [source, wantedEnd]);

    const { result } = useTrackedEvaluation(read);
    // A read that threw still has to reach the surface as a REASON — an empty
    // table would claim the source is empty (#567 D10).
    return result.ok ? result.value : { ...IDLE, error: readFailure(result.error) };
}
