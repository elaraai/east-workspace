/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas body as the virtualizer sees it: the items (rows, gap bands, the
 * unloaded runs of a paged source, failed windows), their exact heights and
 * identities, where a search or the diagnostics chip asks it to scroll, and
 * the viewport reported back to the paging driver.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import {
    bodyItemKey, elideForFocus, firstDiagnosticItem, placeFailures, rowHeight,
    type PlanBodyItem, type PlanDerived, type PlanFocusCtx, type PlanRowIndex, type VisibleRow,
} from "../model.js";
import { planGeometry } from "../geometry.js";
import { appendAll } from "../reductions.js";
import type { RowKey } from "../plan-state.js";
import type { PlanController, PlanNavAlign, PlanPagingSnapshot, PlanScrollTarget } from "../controller/index.js";
import type { PlanPagedBlock, PlanRowOrigin } from "../controller/paging.js";

/** The body items, and what the frame measures and keys them by. */
export interface PlanBody {
    items: readonly PlanBodyItem[];
    /** The exact height of every item — the frame's sizes AND what each item
     *  renders at (#812). */
    heights: readonly number[];
    /** Each item's identity, so a row keeps its instance wherever it moves. */
    itemKey: (i: number) => string;
}

/**
 * The body's items — BLOCK AFTER BLOCK (#823), each block's rows in stream
 * order: a paged block's resident windows as one slab between its bands, with
 * each failed window's band in its seam, and a fixed block's rows once.
 *
 * @remarks
 * A paged block's bands stand for its unloaded windows, sized by its own
 * ledger, so the rows that replace one occupy the same space and nothing below
 * it moves (#577). A block nested under a section's header draws nothing —
 * no rows, no bands — while that header is collapsed or hidden, as its rows
 * would not. Under a links focus each block's run of unrelated rows elides on
 * its own (R1): a gap never spans two blocks, inline or paged.
 *
 * @param visible - The visible rows
 * @param index - The row index
 * @param blocks - A paged canvas's blocks (`[]` inline — nothing unloaded)
 * @param origin - Which block and window each paged row came from
 * @param focusCtx - Which row is focused
 * @returns The items
 */
export function planBodyItems(
    visible: readonly VisibleRow[],
    index: PlanRowIndex,
    blocks: readonly PlanPagedBlock[],
    origin: ReadonlyMap<string, PlanRowOrigin>,
    focusCtx: PlanFocusCtx | undefined,
): PlanBodyItem[] {
    // A block's rows are contiguous in the stream, so its visible rows are too.
    const perBlock = new Map<number, VisibleRow[]>();
    for (const v of visible) {
        const list = perBlock.get(v.row.block);
        if (list !== undefined) list.push(v);
        else perBlock.set(v.row.block, [v]);
    }
    // R1 at scale — the links-focus body elides runs of unrelated rows into
    // gap bands (a lone straggler keeps its rail; see `elideForFocus`).
    const itemsOf = (rows: readonly VisibleRow[]): PlanBodyItem[] => (focusCtx?.kind === "links"
        ? elideForFocus(rows, index, focusCtx)
        : rows.map((row) => ({ kind: "row", row })));
    const out: PlanBodyItem[] = [];
    if (blocks.length === 0) {
        // Inline: the blocks one after another, nothing unloaded.
        for (const rows of perBlock.values()) appendAll(out, itemsOf(rows));
        return out;
    }
    const visibleByKey = new Map(visible.map((v) => [v.row.key, v]));
    const windowOf = (key: RowKey): number | undefined => origin.get(key)?.w;
    for (const b of blocks) {
        // Under a header that is folded or hidden, the block draws nothing.
        if (b.parent !== undefined) {
            const header = visibleByKey.get(b.parent);
            if (header === undefined || header.collapsed) continue;
        }
        // A window whose read failed is ONE band where its rows would be
        // (#811) — every other window keeps landing around it.
        const core = placeFailures(itemsOf(perBlock.get(b.index) ?? []), b.failures, windowOf);
        if (b.head !== undefined) out.push({ kind: "band", band: b.head });
        appendAll(out, core);
        if (b.tail !== undefined) out.push({ kind: "band", band: b.tail });
    }
    return out;
}

/**
 * The body items and their geometry.
 *
 * @param visible - The visible rows
 * @param index - The row index
 * @param derived - The derivations (heights read them)
 * @param paging - The paged source's blocks and where each row came from (inline: idle)
 * @param focusCtx - Which row is focused
 * @param heightCtx - The same, with the expand clamp
 * @param dense - The declared density
 * @param chartsExpanded - The user's expanded chart rows
 * @returns The body
 */
export function usePlanBody(
    visible: readonly VisibleRow[],
    index: PlanRowIndex,
    derived: PlanDerived,
    paging: PlanPagingSnapshot,
    focusCtx: PlanFocusCtx | undefined,
    heightCtx: PlanFocusCtx | undefined,
    dense: boolean,
    chartsExpanded: ReadonlySet<RowKey>,
): PlanBody {
    const { blocks, origin } = paging;
    const items = useMemo<readonly PlanBodyItem[]>(
        () => planBodyItems(visible, index, blocks, origin, focusCtx),
        [focusCtx, visible, index, blocks, origin]);
    // The height SIGNATURE (#812): a row's kind, the density, a chart's toggle,
    // a focus and the expand clamp all reach it, so any of them changing a
    // height re-measures the frame — and a selection, which reaches none of
    // its inputs, re-measures nothing.
    const heights = useMemo(() => items.map((item) => {
        if (item.kind === "gap") return planGeometry(dense).gap;
        if (item.kind === "band") return Math.max(1, item.band.px);
        if (item.kind === "failed") return item.failure.px;
        return rowHeight(item.row, dense, chartsExpanded, heightCtx, derived);
    }), [items, dense, chartsExpanded, heightCtx, derived]);
    const itemKey = useCallback((i: number): string => {
        const item = items[i];
        return item !== undefined ? bodyItemKey(item) : `i:${i}`;
    }, [items]);
    return { items, heights, itemKey };
}

/**
 * Where the frame is asked to scroll: a key search's target row — resolved
 * against the VISIBLE body (a match inside a collapsed group has no row to
 * scroll to), and only once it has loaded — the first skipped row the
 * diagnostics chip seeks (#811), or the item a keyboard move went to (#819).
 * The latest request wins: a new search takes the viewport back, and each
 * chip click or keyboard move carries a nonce, so it scrolls there again after
 * the user has moved away.
 *
 * @param items - The body items
 * @param index - The row index
 * @param derived - The derivations (their diagnostic rows)
 * @param scroll - Who owns the request, and its target
 * @returns The item to scroll to, how to align it, the re-request nonce, and the first skipped item
 */
export function usePlanScrollTarget(
    items: readonly PlanBodyItem[],
    index: PlanRowIndex,
    derived: PlanDerived,
    scroll: PlanScrollTarget,
): { toIndex: number | undefined; align: PlanNavAlign | "center"; nonce: number | undefined; firstSkipped: number | undefined } {
    const { targetKey } = scroll;
    const searchIndex = useMemo(() => {
        if (targetKey === undefined) return undefined;
        const i = items.findIndex((it) => it.kind === "row" && it.row.row.key === targetKey);
        return i >= 0 ? i : undefined;
    }, [items, targetKey]);
    const navKey = scroll.nav?.key;
    const navIndex = useMemo(() => {
        if (navKey === undefined) return undefined;
        const i = items.findIndex((it) => bodyItemKey(it) === navKey);
        return i >= 0 ? i : undefined;
    }, [items, navKey]);
    const firstSkipped = useMemo(
        () => firstDiagnosticItem(items, index, derived.diagnostics),
        [items, index, derived.diagnostics]);
    switch (scroll.owner) {
        case "skipped":
            return { toIndex: firstSkipped, align: "center", nonce: scroll.skippedSeq, firstSkipped };
        case "nav":
            // A pinned row is not in the body: it never scrolls away.
            return { toIndex: navIndex, align: scroll.nav?.align ?? "auto", nonce: scroll.nav?.seq, firstSkipped };
        case "search":
            return { toIndex: searchIndex, align: "center", nonce: undefined, firstSkipped };
    }
}

/**
 * The frame's range signal, in the paging driver's terms: which ROW (or which
 * band) the viewport sits on. The item under the viewport CENTER when the
 * frame can resolve one (the live scroll offset — inside one huge band item
 * only the center pixel can say where the thumb is, #612), else the middle of
 * the mounted range. No body-layout knowledge crosses into the driver.
 *
 * @param items - The body items
 * @param controller - Where the viewport is reported
 * @returns The frame's `onRangeChange`
 */
export function usePlanRangeReport(items: readonly PlanBodyItem[], controller: PlanController) {
    return useCallback((
        range: { startIndex: number; endIndex: number },
        isScrolling: boolean,
        center?: { index: number; withinPx: number },
    ) => {
        const mid = Math.floor((range.startIndex + range.endIndex) / 2);
        const item = items[center?.index ?? mid] ?? items[range.startIndex];
        if (item === undefined) return;
        if (item.kind === "band") {
            // `withinPx` is measured from the band's own top — the one origin
            // its block's ledger can place exactly, whatever the resident rows
            // above it rendered at.
            controller.reportViewport({ kind: "band", block: item.band.block, at: item.band.at, px: center?.withinPx }, isScrolling);
        } else if (item.kind === "row") {
            controller.reportViewport({ kind: "row", key: item.row.row.key }, isScrolling);
        } else if (item.kind === "failed") {
            // A failed window's band names its own block and window (#811).
            controller.reportViewport({ kind: "window", block: item.failure.block, w: item.failure.w }, isScrolling);
        }
        // A links-focus gap band names no window — the demand stays where it is.
    }, [items, controller]);
}
