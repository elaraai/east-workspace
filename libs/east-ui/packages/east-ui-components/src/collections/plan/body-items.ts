/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas body's items and the link graph they are gathered by (split out
 * of `model.ts`, #815): the R1 family closure and the gap bands that elide a
 * links focus, the unloaded bands of a paged source (#577), the error bands of
 * failed windows (#811), and each item's identity (#812).
 *
 * @packageDocumentation
 */

import type { PlanFocusCtx, PlanLinkValue, PlanRowIndex, VisibleRow } from "./model.js";
import type { RowKey } from "./plan-state.js";
import type { PlanRowDiagnostic } from "./derive.js";
import { ancestorsOf } from "./row-tree.js";
import { rowKeyOf } from "./row-key.js";

// ── The R1 link graph (renderer-derived over the decoded `links` edges) ─────

/** Every row key any link edge touches — the rows that grow the `links` control.
 *  A link names its ends by row id (#822); the graph keys by their text. */
export function linkedRowKeys(links: readonly PlanLinkValue[]): ReadonlySet<RowKey> {
    const out = new Set<RowKey>();
    for (const l of links) { out.add(rowKeyOf(l.fromRow)); out.add(rowKeyOf(l.toRow)); }
    return out;
}

/** One elided run in a links focus — replaces N consecutive unrelated rows. */
export interface FocusGap {
    /** Stable key (the first elided row's key). */
    key: string;
    /** The first elided row — where keyboard focus lands when the gap is
     *  opened and its rows come back (#819). */
    first: RowKey;
    /** Data rows hidden inside the run (collapsed subtrees counted through). */
    rows: number;
    /** Group bands hidden inside the run. */
    groups: number;
    /** Pessimistic status tone across the hidden rows (undefined ⇒ quiet). */
    tone: string | undefined;
}

/**
 * A run of source elements that is NOT resident (#577), rendered as one band.
 *
 * Its height comes from the window ledger, so the band and the rows that
 * replace it occupy exactly the same space — scrolling in loads content without
 * moving anything below it, and eviction puts the band back with nothing
 * shifting either.
 */
export interface PlanBand {
    at: "head" | "tail";
    /** First source element the band covers. */
    from: number;
    /** Last source element the band covers (inclusive). */
    to: number;
    /** The band's pixel height. */
    px: number;
}

/**
 * A resident window whose read FAILED (#811) — one error band where the
 * window's rows would be, carrying the reason and a Retry.
 *
 * The failure belongs to its window: every other window keeps landing and
 * rendering around it.
 */
export interface PlanWindowFailure {
    /** The window index. */
    w: number;
    /** First source element the window covers. */
    from: number;
    /** Last source element the window covers (inclusive). */
    to: number;
    /** The band's pixel height — the window's ledger slot, floored so the
     *  reason and the Retry stay legible in a short last window. */
    px: number;
    /** Why the read failed. */
    error: string;
}

/** One line of the canvas body: a row, the R2 developer render, an elided run
 *  (R1), an unloaded run of the source (#577), or a window whose read failed
 *  (#811).
 *
 *  The R2 developer render is NOT an item here — it renders inside the
 *  focused row, which grows to hold it (see {@link PlanFocusCtx.renderPx}).
 *  Expand focus still stays inside the virtualizer either way; putting the
 *  render in the row is what lets the GUTTER grow with it. */
export type PlanBodyItem =
    | { kind: "row"; row: VisibleRow }
    | { kind: "gap"; gap: FocusGap }
    | { kind: "band"; band: PlanBand }
    | { kind: "failed"; failure: PlanWindowFailure };

/**
 * A body item's identity (#812) — its row's key, its gap's first row, its
 * band's end, its failed window — prefixed by kind, so no two items of a body
 * share one. The virtualizer keys rows by it, so a row keeps its component
 * instance when a collapse, a focus or a landing window moves it; keyed by
 * index, the instance at a moved row's old index was handed whichever row now
 * sat there.
 *
 * @param item - The body item
 * @returns Its key, unique within one body
 */
export function bodyItemKey(item: PlanBodyItem): string {
    switch (item.kind) {
        case "row": return rowItemKey(item.row.row.key);
        case "gap": return `g:${item.gap.key}`;
        case "band": return `b:${item.band.at}`;
        case "failed": return `f:${item.failure.w}`;
    }
}

/**
 * A ROW's item key — what {@link bodyItemKey} gives its body item, and a
 * pinned row (which the body does not hold) goes by too (#819).
 *
 * @param key - The row key
 * @returns Its item key
 */
export function rowItemKey(key: RowKey): string {
    return `r:${key}`;
}

/**
 * Place each failed window's band where its rows would be (#811): after the
 * last row that came from an EARLIER window, or first when none did.
 *
 * @remarks
 * Windows serve source elements in key order and the stream concatenates them
 * in window order (#822), so a window's rows sit between its neighbours' — its
 * band goes in the seam. A row every window re-serves (a hand-built row, a
 * section header) is attributed to the FIRST window that served it
 * (`originOf`), so it anchors no later seam. (Several series each place a
 * block per window, so a failed window there marks the seam of the last block
 * only — the per-block ledger of #823 is what gives each block its own.)
 *
 * @param items - The body items, rows in visible order
 * @param failures - The failed windows
 * @param origin - Which window each resident row came from
 * @returns The items with a `failed` band placed per failure (the same array
 *   when there are none)
 */
export function placeFailures(
    items: readonly PlanBodyItem[],
    failures: readonly PlanWindowFailure[],
    origin: ReadonlyMap<RowKey, number>,
): readonly PlanBodyItem[] {
    if (failures.length === 0) return items;
    // Item index a failure's band goes AFTER (−1: before every item).
    const after = new Map<number, PlanWindowFailure[]>();
    for (const f of [...failures].sort((a, b) => a.w - b.w)) {
        let at = -1;
        items.forEach((it, i) => {
            if (it.kind !== "row") return;
            const w = origin.get(it.row.row.key);
            if (w !== undefined && w < f.w) at = i;
        });
        const list = after.get(at);
        if (list !== undefined) list.push(f);
        else after.set(at, [f]);
    }
    const out: PlanBodyItem[] = [];
    for (const f of after.get(-1) ?? []) out.push({ kind: "failed", failure: f });
    items.forEach((it, i) => {
        out.push(it);
        for (const f of after.get(i) ?? []) out.push({ kind: "failed", failure: f });
    });
    return out;
}

/**
 * The body item the diagnostics chip seeks to (#811): the first diagnostic
 * row in body order — or, when a collapsed group hides it, that group's band.
 *
 * @param items - The body items, in order
 * @param index - The row-tree index
 * @param diagnostics - The diagnostic rows (`PlanDerived.diagnostics`)
 * @returns The item index, or `undefined` when no diagnostic row is reachable
 */
export function firstDiagnosticItem(
    items: readonly PlanBodyItem[],
    index: PlanRowIndex,
    diagnostics: ReadonlyMap<RowKey, PlanRowDiagnostic>,
): number | undefined {
    if (diagnostics.size === 0) return undefined;
    const holders = ancestorsOf(index, new Set(diagnostics.keys()));
    for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (it.kind !== "row") continue;
        const key = it.row.row.key;
        if (diagnostics.has(key) || (it.row.collapsed && holders.has(key))) return i;
    }
    return undefined;
}

/** Status severity rank — higher is worse; gaps wear the worst hidden tone. */
const TONE_RANK: Record<string, number> = { info: 1, neutral: 1, success: 0, warning: 2, danger: 3 };

/**
 * Elide a links-focus row list for scale (R1): family rows and the focus keep
 * full height; a group keeps its wayfinding band ONLY while its subtree holds
 * family; every other row is elidable. A lone elidable data row stays an 11px
 * rail (today's rhythm); any longer run — including family-less group bands
 * and their subtrees — coalesces into ONE double-height gap band, so a
 * thousand-tank canvas gathers to family + a handful of bands.
 */
export function elideForFocus(
    vis: ReadonlyArray<VisibleRow>,
    index: PlanRowIndex,
    focus: PlanFocusCtx,
): PlanBodyItem[] {
    const kept = (key: RowKey): boolean => key === focus.key || (focus.family?.has(key) ?? false);
    // "Does this group's subtree hold family?" precomputed as the kept keys'
    // ancestor set — O(family × depth), not a per-row downward recursion
    // (#616; the same fix as `visibleRows`' reveal test).
    const keptAncestors = ancestorsOf(index, new Set([focus.key, ...(focus.family ?? [])]));
    const subtreeHasFamily = (key: RowKey): boolean => keptAncestors.has(key);
    const subtreeDataRows = (key: RowKey): number =>
        (index.children.get(key) ?? []).reduce(
            (n, c) => n + (c.kind.type === "group" ? 0 : 1) + subtreeDataRows(c.key), 0);
    const worse = (a: string | undefined, b: string | undefined): string | undefined =>
        b === undefined ? a : a === undefined || (TONE_RANK[b] ?? 0) > (TONE_RANK[a] ?? 0) ? b : a;

    const out: PlanBodyItem[] = [];
    let run: VisibleRow[] = [];
    const flush = () => {
        if (run.length === 0) return;
        if (run.length === 1 && run[0]!.row.kind.type !== "group") {
            out.push({ kind: "row", row: run[0]! });
        } else {
            const gap: FocusGap = { key: `gap-${run[0]!.row.key}`, first: run[0]!.row.key, rows: 0, groups: 0, tone: undefined };
            for (const v of run) {
                if (v.row.kind.type === "group") {
                    gap.groups += 1;
                    // A collapsed elided group hides its whole subtree —
                    // count those rows through, they're part of the gap.
                    if (v.collapsed) gap.rows += subtreeDataRows(v.row.key);
                } else {
                    gap.rows += 1;
                }
                gap.tone = worse(gap.tone, v.row.status.type === "some" ? v.row.status.value.type : undefined);
            }
            out.push({ kind: "gap", gap });
        }
        run = [];
    };
    for (const v of vis) {
        const isGroup = v.row.kind.type === "group";
        const keep = kept(v.row.key) || (isGroup && subtreeHasFamily(v.row.key));
        if (keep) {
            flush();
            out.push({ kind: "row", row: v });
        } else {
            run.push(v);
        }
    }
    flush();
    return out;
}

/** A focused row's transitive family over the link graph. */
export interface LinkFamily {
    /** Rows reaching the focus via edges (any depth). */
    upstream: ReadonlySet<RowKey>;
    /** Rows reachable from the focus via edges (any depth). */
    downstream: ReadonlySet<RowKey>;
    /** Union of both (the full-height set, focus excluded). */
    all: ReadonlySet<RowKey>;
}

/**
 * Derive the focused row's transitive upstream + downstream family — the
 * links-focus gather set (R1). Any depth, wherever the rows live; a row
 * reachable both ways lands in both sets (rendered as the `LINKED` tag).
 */
export function deriveLinkFamily(links: readonly PlanLinkValue[], key: RowKey): LinkFamily {
    const fwd = new Map<RowKey, RowKey[]>();
    const rev = new Map<RowKey, RowKey[]>();
    for (const l of links) {
        const from = rowKeyOf(l.fromRow);
        const to = rowKeyOf(l.toRow);
        (fwd.get(from) ?? fwd.set(from, []).get(from)!).push(to);
        (rev.get(to) ?? rev.set(to, []).get(to)!).push(from);
    }
    const walk = (edges: ReadonlyMap<RowKey, RowKey[]>): Set<RowKey> => {
        const seen = new Set<RowKey>();
        const queue = [key];
        while (queue.length > 0) {
            const k = queue.pop()!;
            for (const next of edges.get(k) ?? []) {
                if (next === key || seen.has(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
        return seen;
    };
    const downstream = walk(fwd);
    const upstream = walk(rev);
    return { upstream, downstream, all: new Set([...upstream, ...downstream]) };
}
