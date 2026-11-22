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
 * kept by nothing.
 *
 * What is kept follows the paging driver: before it reads its windows it says
 * which it holds (`retain`), and those are kept for as long as it names them,
 * however many — at each new revision it reads every one of them again, in
 * order, so a layer that kept fewer would keep none of them. Beside them — a
 * window the driver has let go, or one read before it has said anything — no
 * more than {@link KEPT_WINDOWS} are kept, the one asked longest ago going
 * first. Everything else is the source's own, passed through as it has it: its
 * count, its key search, its revision and its refresh, its narrowing, its
 * snapshot, and how it redraws a window standing in (#1599).
 *
 * @packageDocumentation
 */

import { IntegerType, StringType, equalFor, none, printFor, some } from "@elaraai/east";
import { getStore, trackKey, windowedSourceOf } from "@elaraai/east-ui-components/internal";
import type { PlanRootValue } from "../model.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import { ownRefresh, usePagedRoots, usePagedWrapper } from "./wrapped-source.js";

/** How many windows the layer keeps beside those its reader says it holds: the one asked longest ago is let go first. */
export const KEPT_WINDOWS = 8;

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
    /** Its offset, as East prints it: what the reader names a window it holds by. */
    readonly offset: string;
}

/** No window held: before a reader has said which it holds. */
const NONE_HELD: ReadonlySet<string> = new Set();

/** A source's redraw of a window standing in, as the layer passes it through. */
type Redraft = NonNullable<PlanPagedSourceValue["redraft"]>;

/**
 * The root with its paged rows read through the layer (see the module docs):
 * ONE wrapper per source, as the nested series' and the event kinds' are
 * (`wrapped-source.ts`).
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
    const wrapped = usePagedWrapper(paged, { pick }, (source, latest) => {
        // The windows the source gave, by their offset and size, the one asked last at the end.
        const kept = new Map<string, KeptWindow>();
        // The windows the reader says it holds, by their offsets: kept while it names them.
        let held = NONE_HELD;
        // Of the windows it does not hold, no more than the layer keeps beside them: the one asked longest ago goes first.
        const trim = (): void => {
            let loose = 0;
            for (const window of kept.values()) if (!held.has(window.offset)) loose += 1;
            for (const [at, window] of kept) {
                if (loose <= KEPT_WINDOWS) break;
                if (held.has(window.offset)) continue;
                kept.delete(at);
                loose -= 1;
            }
        };
        return {
            page: (offset, limit) => {
                const { src, pick } = latest();
                if (src === undefined) return none;
                // Which series show, read as the source's page reads it — the reader that asks follows a switch — at its
                // version now.
                if (pick !== undefined) trackKey(pick);
                const shown = pick === undefined ? 0 : getStore().getKeyVersion(pick);
                const place = printInteger(offset);
                const at = `${place}\u0000${printInteger(limit)}`;
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
                kept.set(at, { src, revision, query, picked: shown, window: read.value, offset: place });
                trim();
                return read;
            },
            // What the reader holds now: those kept while it names them, the rest as many as the layer keeps beside them.
            retain: (offsets) => {
                held = new Set(offsets.map((offset) => printInteger(offset)));
                trim();
            },
            // The source's own, where it has them: a pinned source stays pinned, a live one live.
            ...(source.revision === undefined ? {} : { revision: () => latest().src?.revision?.() ?? none }),
            ...(source.refresh === undefined ? {} : { refresh: ownRefresh(latest) }),
            ...(source.snapshot === undefined ? {} : { snapshot: () => latest().src?.snapshot?.() ?? none }),
            ...(source.redraft === undefined || source.redrafted === undefined ? {} : {
                redraft: (entries: Parameters<Redraft>[0]) => latest().src?.redraft?.(entries),
                redrafted: () => latest().src?.redrafted?.() ?? "",
            }),
        };
    });
    return usePagedRoots(value, data, wrapped);
}
