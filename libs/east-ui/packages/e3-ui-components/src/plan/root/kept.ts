/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas's own paged rows, each window kept while what it is made from
 * holds (#1712, #1713): a layer of the canvas's composition (`../canvas.tsx`),
 * over the nested series' wrapper and under both readers of the windows — the
 * event kinds' wrapper, which the paging driver reads, and the cells' reader,
 * which lists the resources each window holds.
 *
 * A window is asked of the source under the layer again only when that source,
 * its revision or its narrowing moves, or the series the viewer shows: the
 * root's page function reads which show each time it makes a window
 * (`planShown`), and only the nested series' wrapper names that in its
 * revision. The layer reads the pick's state as that function does, each time
 * a window is asked, kept or not: a reader handed a kept window follows a
 * switch as it follows the source's own reads, and is read again when the
 * viewer switches a series (the cells' reader is so, its next window read
 * through the layer). New events read every window again — the event kinds' wrapper
 * names them in its revision — and the cells' reader reads each window it
 * wants each time it reads: both are handed what the source gave, so neither
 * makes a row again that would be the same, and the reader's keys, kept by the
 * rows' identity, hold too. A window in flight, or one whose read throws, is
 * kept by nothing; of more than {@link KEPT_WINDOWS}, the one asked longest ago
 * goes first. Everything else is the source's own, passed through as it has
 * it: its count, its key search, its revision and its refresh, its narrowing,
 * its snapshot, and how it redraws a window standing in (#1599).
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import { IntegerType, StringType, equalFor, equivalentFor, none, printFor, some, variant } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { getStore, trackKey, windowedSourceOf } from "@elaraai/east-ui-components/internal";
import type { PlanRootValue } from "../model.js";
import { windowedArm, type PlanPagedSourceValue } from "../use-plan-paging.js";

/** How many windows the layer keeps: the one asked longest ago is let go first. */
export const KEPT_WINDOWS = 8;

/** Whether two paged sources derive the same rows — the paging driver's test (#809). */
const pagedSourceEquivalent = equivalentFor(Plan.Types.Root.fields.rows.cases.paged);
const printInteger = printFor(IntegerType);
const stringEqual = equalFor(StringType);
/** Whether two of a source's texts are one: none being none. */
const sameText = (a: string | undefined, b: string | undefined): boolean => (a === undefined || b === undefined ? a === b : stringEqual(a, b));

/** A window a paged source gave: its blocks, and the entries it carried. */
type PagedWindow = Extract<ReturnType<PlanPagedSourceValue["page"]>, { type: "some" }>["value"];

/** A window the source under the layer gave, and what it was made under. */
interface KeptWindow {
    /** The source it was asked of: the same object, or it is asked again. */
    readonly src: PlanPagedSourceValue;
    /** That source's revision then. */
    readonly revision: string | undefined;
    /** That source's narrowing then, where it is a live one. */
    readonly query: string | undefined;
    /** The version of the series the viewer showed then: the pick's state's, in the store. */
    readonly picked: number;
    /** What it gave. */
    readonly window: PagedWindow;
}

/** A source's refresh, as the layer passes it through. */
type Refresh = NonNullable<PlanPagedSourceValue["refresh"]>;
/** A source's redraw of a window standing in, as the layer passes it through. */
type Redraft = NonNullable<PlanPagedSourceValue["redraft"]>;

/**
 * The root with its paged rows read through the layer (see the module docs):
 * ONE wrapper per source, as the nested series' and the event kinds' are — a
 * host function is equivalent only to itself, so a new wrapper would drop the
 * driver's windows.
 *
 * @param value - The latest root
 * @param data - Its data-stable twin
 * @param active - Whether the windows have readers that read them again over the same source — the event kinds'
 *   wrapper and the cells' reader, a Plan of event kinds' — where the layer keeps them; without, the roots are the ones
 *   given, read by the paging driver alone, which keeps its windows by the same texts
 * @returns The two roots the canvas draws
 */
export function usePlanKeptRoot(value: PlanRootValue, data: PlanRootValue, active: boolean): { value: PlanRootValue; data: PlanRootValue } {
    const paged: PlanPagedSourceValue | undefined = active ? windowedSourceOf(value.rows) : undefined;
    // The State key a pick's series are switched on and off under: the window function reads which are on as it makes a window.
    const pick = data.pick.type === "some" ? data.pick.value.key : undefined;
    const latest = useRef({ src: paged, pick });
    latest.current = { src: paged, pick };
    const wrapperOf = useRef<{ src: PlanPagedSourceValue; wrapped: PlanPagedSourceValue } | undefined>(undefined);
    const wrapped = useMemo((): PlanPagedSourceValue | undefined => {
        if (paged === undefined) return undefined;
        const prior = wrapperOf.current;
        if (prior !== undefined && pagedSourceEquivalent(prior.src, paged)) return prior.wrapped;
        // The windows the source gave, by their offset and size, the one asked last at the end.
        const kept = new Map<string, KeptWindow>();
        const next: PlanPagedSourceValue = {
            id: paged.id,
            page: (offset, limit) => {
                const { src, pick } = latest.current;
                if (src === undefined) return none;
                // Which series show, read as the source's page reads it — the reader that asks follows a switch — at its
                // version now.
                if (pick !== undefined) trackKey(pick);
                const shown = pick === undefined ? 0 : getStore().getKeyVersion(pick);
                const at = `${printInteger(offset)}\u0000${printInteger(limit)}`;
                const r = src.revision?.();
                const revision = r?.type === "some" ? r.value : undefined;
                const query = src.query?.();
                const held = kept.get(at);
                kept.delete(at);
                if (held !== undefined && Object.is(held.src, src) && sameText(held.revision, revision) && sameText(held.query, query)
                    && held.picked === shown) {
                    kept.set(at, held);
                    return some(held.window);
                }
                // A window in flight is kept by nothing, and one whose read throws throws on.
                const read = src.page(offset, limit);
                if (read.type !== "some") return read;
                kept.set(at, { src, revision, query, picked: shown, window: read.value });
                if (kept.size > KEPT_WINDOWS) kept.delete(kept.keys().next().value!);
                return read;
            },
            total: () => latest.current.src?.total() ?? none,
            seek: paged.seek.type === "some"
                ? some((query) => {
                    const s = latest.current.src?.seek;
                    return s !== undefined && s.type === "some" ? s.value(query) : none;
                })
                : none,
            // The source's own, where it has them: a pinned source stays pinned, a live one live.
            ...(paged.revision === undefined ? {} : { revision: () => latest.current.src?.revision?.() ?? none }),
            ...(paged.refresh === undefined ? {} : { refresh: (revision: Parameters<Refresh>[0]) => latest.current.src?.refresh?.(revision) ?? null }),
            ...(paged.query === undefined ? {} : { query: () => latest.current.src?.query?.() ?? "" }),
            ...(paged.snapshot === undefined ? {} : { snapshot: () => latest.current.src?.snapshot?.() ?? none }),
            ...(paged.redraft === undefined || paged.redrafted === undefined ? {} : {
                redraft: (entries: Parameters<Redraft>[0]) => latest.current.src?.redraft?.(entries),
                redrafted: () => latest.current.src?.redrafted?.() ?? "",
            }),
        };
        wrapperOf.current = { src: paged, wrapped: next };
        return next;
    }, [paged]);
    const shownData = useMemo(() => (wrapped === undefined ? data : { ...data, rows: variant(windowedArm(data.rows), wrapped) as PlanRootValue["rows"] }), [wrapped, data]);
    const shownValue = useMemo(() => (wrapped === undefined ? value : { ...value, rows: variant(windowedArm(value.rows), wrapped) as PlanRootValue["rows"] }), [wrapped, value]);
    return useMemo(() => ({ value: shownValue, data: shownData }), [shownValue, shownData]);
}
