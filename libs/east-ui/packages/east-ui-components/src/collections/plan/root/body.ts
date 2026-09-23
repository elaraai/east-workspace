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
import type { PlanController, PlanPagingSnapshot, PlanScrollTarget } from "../controller/index.js";

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
 * The body items and their geometry.
 *
 * @param visible - The visible rows
 * @param index - The row index
 * @param derived - The derivations (heights read them)
 * @param paging - The paged source's residency (inline: idle)
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
    const { failures, origin, head, tail } = paging;
    // R1 at scale — the links-focus body elides runs of unrelated rows into
    // gap bands (a lone straggler keeps its rail; see `elideForFocus`).
    const items = useMemo<readonly PlanBodyItem[]>(() => {
        const rowItems: PlanBodyItem[] = focusCtx?.kind === "links"
            ? elideForFocus(visible, index, focusCtx)
            : visible.map((row) => ({ kind: "row", row }));
        // A window whose read failed is ONE band where its rows would be
        // (#811) — every other window keeps landing around it.
        const core = placeFailures(rowItems, failures, origin);
        // The unloaded remainder of a paged source, above and below (#577).
        // Each band is sized by the ledger, so the rows that replace it occupy
        // the same space and nothing below moves.
        if (head === undefined && tail === undefined) return core;
        const out: PlanBodyItem[] = [];
        if (head !== undefined) out.push({ kind: "band", band: head });
        appendAll(out, core);
        if (tail !== undefined) out.push({ kind: "band", band: tail });
        return out;
    }, [focusCtx, visible, index, failures, origin, head, tail]);
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
 * scroll to), and only once it has loaded — or the first skipped row the
 * diagnostics chip seeks (#811). The latest request wins: a new search takes
 * the viewport back, and the chip's nonce lets it scroll there again after the
 * user has moved away.
 *
 * @param items - The body items
 * @param index - The row index
 * @param derived - The derivations (their diagnostic rows)
 * @param scroll - Who owns the request, and the search's target row
 * @returns The item to scroll to, the re-request nonce, and the first skipped item
 */
export function usePlanScrollTarget(
    items: readonly PlanBodyItem[],
    index: PlanRowIndex,
    derived: PlanDerived,
    scroll: PlanScrollTarget,
): { toIndex: number | undefined; nonce: number | undefined; firstSkipped: number | undefined } {
    const { targetKey } = scroll;
    const searchIndex = useMemo(() => {
        if (targetKey === undefined) return undefined;
        const i = items.findIndex((it) => it.kind === "row" && it.row.row.key === targetKey);
        return i >= 0 ? i : undefined;
    }, [items, targetKey]);
    const firstSkipped = useMemo(
        () => firstDiagnosticItem(items, index, derived.diagnostics),
        [items, index, derived.diagnostics]);
    return scroll.owner === "skipped"
        ? { toIndex: firstSkipped, nonce: scroll.skippedSeq, firstSkipped }
        : { toIndex: searchIndex, nonce: undefined, firstSkipped };
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
            // the ledger can place exactly, whatever the resident rows above
            // it rendered at.
            controller.reportViewport({ kind: "band", at: item.band.at, px: center?.withinPx }, isScrolling);
        } else if (item.kind === "row") {
            controller.reportViewport({ kind: "row", key: item.row.row.key }, isScrolling);
        } else if (item.kind === "failed") {
            // A failed window's band names its own window (#811).
            controller.reportViewport({ kind: "window", w: item.failure.w }, isScrolling);
        }
        // A links-focus gap band names no window — the demand stays where it is.
    }, [items, controller]);
}
