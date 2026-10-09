/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas root's view of the controller's state (#815) — the UI facts it
 * lays the body out from, reconciled against the rows it renders NOW — and
 * the visible rows and derived numbers kept by identity, so a row whose facts
 * did not move keeps its memo.
 *
 * @packageDocumentation
 */

import { useRef } from "react";
import { reconciledUi, type PlanReconcileModel, type PlanSnapshot } from "../controller/index.js";
import type { PlanGrain, RowKey } from "../plan-state.js";
import { stableDerived, type PlanDerived, type VisibleRow } from "../model.js";

/** The UI facts the canvas root lays the body out from. Selection is not one:
 *  each row reads its own (`usePlanRowState`), so a click renders two rows. */
export interface PlanUiView {
    grain: PlanGrain;
    collapsed: ReadonlySet<RowKey>;
    chartsExpanded: ReadonlySet<RowKey>;
    focus: { kind: "links" | "expand"; key: RowKey } | null;
}

/**
 * The root's UI view of a snapshot — the store as a reconcile against the
 * rendered rows leaves it. A new value's FIRST render therefore draws with
 * its vanished rows' focus / collapse already gone and its fresh declared
 * collapse already applied, and the controller's `setValue` commits the same
 * transition afterwards without changing what was drawn.
 *
 * @param snap - The controller's snapshot
 * @param model - The rows the canvas renders now
 * @returns The view
 */
export function uiViewOf(snap: PlanSnapshot, model: PlanReconcileModel): PlanUiView {
    const ui = reconciledUi(snap.store, model);
    return { grain: ui.grain, collapsed: ui.collapsed, chartsExpanded: ui.chartsExpanded, focus: ui.focus };
}

function sameSet(a: ReadonlySet<RowKey>, b: ReadonlySet<RowKey>): boolean {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const k of a) if (!b.has(k)) return false;
    return true;
}

/** Two views say the same thing — compared by CONTENT, so a store that moved
 *  to what the view already showed renders nothing. */
export function sameUiView(a: PlanUiView, b: PlanUiView): boolean {
    return a.grain === b.grain
        && (a.focus === b.focus || (a.focus !== null && b.focus !== null
            && a.focus.kind === b.focus.kind && a.focus.key === b.focus.key))
        && sameSet(a.collapsed, b.collapsed)
        && sameSet(a.chartsExpanded, b.chartsExpanded);
}

/**
 * The visible rows, each kept by IDENTITY while its row value, depth and
 * collapse are unchanged — so a paged window landing (which re-derives the
 * list) hands every row already on screen the object it had, and its memo
 * holds (#815).
 *
 * @param visible - This render's visible rows
 * @returns The same rows, previous objects reused where nothing moved
 */
export function useStableVisible(visible: readonly VisibleRow[]): readonly VisibleRow[] {
    const prev = useRef<{ from: readonly VisibleRow[]; out: readonly VisibleRow[]; byKey: Map<RowKey, VisibleRow> } | null>(null);
    const last = prev.current;
    if (last !== null && last.from === visible) return last.out;
    const byKey = new Map<RowKey, VisibleRow>();
    const out = visible.map((v) => {
        const old = last?.byKey.get(v.row.key);
        const kept = old !== undefined && old.row === v.row && old.depth === v.depth && old.collapsed === v.collapsed ? old : v;
        byKey.set(v.row.key, kept);
        return kept;
    });
    prev.current = { from: visible, out, byKey };
    return out;
}

/**
 * The derived numbers, each row's entries kept by IDENTITY while their
 * content holds ({@link stableDerived}) — so a re-derivation that moved one
 * row's numbers renders that row, not every row with a derived entry.
 *
 * @param derived - This render's derivation
 * @returns The same numbers, previous entries reused where nothing moved
 */
export function useStableDerived(derived: PlanDerived): PlanDerived {
    const prev = useRef<{ from: PlanDerived; out: PlanDerived } | null>(null);
    const last = prev.current;
    if (last !== null && last.from === derived) return last.out;
    const out = stableDerived(last?.out, derived);
    prev.current = { from: derived, out };
    return out;
}
