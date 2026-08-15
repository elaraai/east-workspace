/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged-source loader — streams a `PagedSourceType`'s windows into canvas
 * rows.
 *
 * # The reads run INSIDE a tracked evaluation
 *
 * `page()` / `total()` are reactive platform reads: they register the window's
 * channel as a dependency and return `none` while the fetch is in flight, and
 * the channel notifies when it settles. That only works where dependency
 * tracking is enabled — {@link useTrackedEvaluation}. Reading from an effect
 * instead registers nothing, so nothing ever notifies and the only thing that
 * makes a landed window appear is a timer. This hook reads during evaluation
 * and has no poll (#567 D5); StrictMode's double render is likewise harmless,
 * because a repeated read of the same window is a cache hit rather than a
 * second fetch (#567 D7).
 *
 * # Windows merge into ONE keyed collection
 *
 * A window is a `Dict<String, PlanRow>` (#568), so accumulating windows is a
 * merge by key, not an append: a row a later window re-emits — a group parent
 * every window synthesizes — replaces the earlier copy instead of appearing
 * twice, and the merged collection stays in canonical key order however the
 * windows interleave. That is the renderer half of the IR's composition
 * policy; the amplification it used to produce (15 rows / 3 windows → 39
 * visible lines) is now unconstructable.
 *
 * # Exhaustion comes from `total()`, never from an empty window
 *
 * The empty-window-means-exhausted rule is a SOURCE-element contract, and the
 * rows here are CANVAS rows: the series pipeline filters, so a window of source
 * elements matching nothing yields zero canvas rows while the source still has
 * plenty left. Treating that as the end silently dropped every later window
 * (#567 D2 — measured: a 600-element source halted at 200 rows, `loading`
 * false, no error). The window count comes from `total()` instead, which
 * counts source elements — the only number that means what the walk needs.
 *
 * # A source that cannot be READ is not an empty canvas
 *
 * There is no offline stand-in for `Data.bindPaged` — paging is a server
 * capability (segment fences, exact totals, key search), so a bound canvas
 * rendered outside a workspace has nothing to read from. Logging that to the
 * console and returning zero rows renders a blank axis that looks like an empty
 * dataset (#567 D10): the failure is reported here so the canvas can say why.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import { SortedMap, StringType, compareFor, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { planWindows, type RowRange } from "../paged-window-store.js";

type PlanRootValue = ValueTypeOf<typeof Plan.Types.Root>;
type PlanRowValue = ValueTypeOf<typeof Plan.Types.Row>;
/** The decoded `paged` arm — the derived source at the canvas-row type. */
export type PlanPagedSourceValue = Extract<PlanRootValue["rows"], { type: "paged" }>["value"];

/** Source elements requested per window. */
export const PLAN_PAGE_SIZE = 200;

/** East's own total order on the row keys — never JS `<` (the collection is
 *  sorted by East's ordering, and the merged prefix must match it). */
const ROW_KEY_ORDER = compareFor(StringType);

/** One line naming why a source read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export interface PlanPagedRows {
    /** The loaded canvas rows, in canonical key order. */
    rows: ReadonlyArray<PlanRowValue>;
    /** The source's total ELEMENT count, once known — not the canvas-row
     *  count, since a series can emit any number of rows per element. */
    total: number | undefined;
    /** Source elements whose window has landed. */
    loadedElements: number;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** Why the source could not be read, when it could not be — the canvas
     *  renders this instead of a blank axis. */
    error: string | undefined;
}

const IDLE: PlanPagedRows = { rows: [], total: undefined, loadedElements: 0, loading: false, error: undefined };

/**
 * Stream a paged source's windows into canvas rows.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline canvas; idles)
 * @param wanted - The source-element range the canvas is asking for
 * @returns The loaded rows + totals + loading state
 */
export function usePlanPagedRows(
    source: PlanPagedSourceValue | undefined,
    wanted?: RowRange,
): PlanPagedRows {
    // The canvas keeps a CONTIGUOUS prefix: its model layer (indexRows /
    // visibleRows / derivePlan) walks a dense row array, so a hole would drop a
    // parent's children rather than render a placeholder. Demand therefore
    // grows from 0 to whatever the viewport has reached. Bounding the prefix
    // itself needs sparse placeholder rows in the model layer (tracked
    // separately); meanwhile the RUNTIME caps its decoded-window cache, which
    // is where the bytes actually live.
    const wantedEnd = wanted?.end;

    const read = useCallback((): PlanPagedRows => {
        if (source === undefined) return IDLE;
        let total: number | undefined;
        let error: string | undefined;
        try {
            const t = source.total();
            if (t.type === "some") total = Number(t.value);
        } catch (err) {
            console.error("[Plan] paged source total failed:", err);
            error = readFailure(err);
        }
        // With no viewport signal the canvas asks for the whole source: its
        // model layer needs a dense prefix, and stopping at an arbitrary
        // margin would hide rows with nothing to reveal them. Narrowing this
        // to the visible range needs `VirtualRows` to surface its window and
        // the model layer to tolerate holes — the sparse-placeholder work.
        const end = wantedEnd ?? total ?? PLAN_PAGE_SIZE;
        const range: RowRange = { start: 0, end: Math.max(end, PLAN_PAGE_SIZE) };
        const plan = planWindows(range, PLAN_PAGE_SIZE, total, 1);
        const merged = new SortedMap<string, PlanRowValue>(undefined, ROW_KEY_ORDER);
        let loading = false;
        let loadedElements = 0;
        for (const w of plan.needed) {
            let win: ReturnType<PlanPagedSourceValue["page"]>;
            try {
                win = source.page(BigInt(w * PLAN_PAGE_SIZE), BigInt(PLAN_PAGE_SIZE));
            } catch (err) {
                console.error("[Plan] paged source page failed:", err);
                error ??= readFailure(err);
                break;
            }
            if (win.type !== "some") {
                // In flight. Stop here: the prefix must stay contiguous, so a
                // later window's rows cannot be appended across the hole.
                loading = true;
                break;
            }
            // Merged by key, last wins: a row this window re-emits replaces
            // the earlier copy rather than duplicating it.
            for (const [key, row] of win.value) merged.set(key, row);
            loadedElements += PLAN_PAGE_SIZE;
            // An empty window means this WINDOW produced no canvas rows — it
            // says nothing about the source, whose length `total` governs.
        }
        if (total !== undefined) loadedElements = Math.min(loadedElements, total);
        return { rows: [...merged.values()], total, loadedElements, loading, error };
    }, [source, wantedEnd]);

    const { result } = useTrackedEvaluation(read);
    // A read that threw past the per-call catches still has to reach the canvas
    // as a REASON — an empty canvas would claim the source is empty.
    return result.ok ? result.value : { ...IDLE, error: readFailure(result.error) };
}
