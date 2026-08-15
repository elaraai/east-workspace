/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged-source loader (`Plan Data Interface.md` §3.7/§3.8) — streams the
 * derived source's windows into the canvas as a sequential prefix: page k is
 * requested at source offset `k × PAGE_SIZE`; a `some` window appends its
 * canvas rows (the series pipeline already ran inside the stored `page`
 * function), an EMPTY window means the source is exhausted, and `none` means
 * the bind impl is still fetching — the loader retries (and the P-c2 impl's
 * reactive tracker re-renders the canvas when the window lands). The
 * ordering contract (§3.7 — series membership and groupBy keys contiguous)
 * makes a loaded prefix a valid canvas at every step; totals/aggregates
 * refine as windows land.
 */

import { useEffect, useMemo, useState } from "react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";

type PlanRootValue = ValueTypeOf<typeof Plan.Types.Root>;
type PlanRowValue = ValueTypeOf<typeof Plan.Types.Row>;
/** The decoded `source` arm — the derived paged handle at the canvas-row type. */
export type PlanPagedSourceValue = Extract<PlanRootValue["rows"], { type: "paged" }>["value"];

/** Source elements requested per window. */
export const PLAN_PAGE_SIZE = 200;
/** Retry delay while a window resolves `none` (the impl is fetching). */
const RETRY_MS = 250;

export interface PlanPagedRows {
    /** The loaded canvas rows (a contiguous prefix, in source order). */
    rows: ReadonlyArray<PlanRowValue>;
    /** The source's total element count, once known. */
    total: number | undefined;
    /** Whether more windows remain (loading or not yet requested). */
    loading: boolean;
}

/**
 * Stream a paged source's windows into canvas rows.
 *
 * @param source - The decoded `source` arm (undefined ⇒ inline canvas; the hook idles)
 * @returns The loaded row prefix + totals + loading state
 */
export function usePlanPagedRows(source: PlanPagedSourceValue | undefined): PlanPagedRows {
    const [state, setState] = useState<{ pages: PlanRowValue[][]; nextPage: number; done: boolean }>(
        { pages: [], nextPage: 0, done: false },
    );

    // A new source restarts the stream (the interactive-state reset rule).
    useEffect(() => {
        setState({ pages: [], nextPage: 0, done: false });
    }, [source]);

    const total = useMemo(() => {
        if (source === undefined) return undefined;
        try {
            const t = source.total();
            return t.type === "some" ? Number(t.value) : undefined;
        } catch (err) {
            console.error("[Plan] paged source total failed:", err);
            return undefined;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- total() is a getter on the decoded handle; re-read as windows land (the impl may learn the total late)
    }, [source, state.nextPage]);

    useEffect(() => {
        if (source === undefined || state.done) return;
        const offset = state.nextPage * PLAN_PAGE_SIZE;
        if (total !== undefined && offset >= total) {
            setState((s) => (s.done ? s : { ...s, done: true }));
            return;
        }
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const attempt = () => {
            if (cancelled) return;
            let win: ReturnType<PlanPagedSourceValue["page"]>;
            try {
                win = source.page(BigInt(offset), BigInt(PLAN_PAGE_SIZE));
            } catch (err) {
                console.error("[Plan] paged source page failed:", err);
                setState((s) => ({ ...s, done: true }));
                return;
            }
            if (win.type === "some") {
                const rows = win.value;
                setState((s) => ({
                    pages: [...s.pages, rows],
                    nextPage: s.nextPage + 1,
                    // An EMPTY window ⇒ the source is exhausted (loading is
                    // `none`, never an empty `some`).
                    done: rows.length === 0,
                }));
            } else {
                timer = setTimeout(attempt, RETRY_MS);
            }
        };
        attempt();
        return () => {
            cancelled = true;
            if (timer !== undefined) clearTimeout(timer);
        };
    }, [source, state.nextPage, state.done, total]);

    const rows = useMemo(() => state.pages.flat(), [state.pages]);
    return { rows, total, loading: source !== undefined && !state.done };
}
