/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas body's items and the link graph they are gathered by (split out
 * of `model.ts`, #815): the R1 family closure and the role bands a links focus
 * gathers it under, the unloaded bands of a paged source (#577), the error
 * bands of failed windows (#811), and each item's identity (#812).
 *
 * @packageDocumentation
 */

import type { PlanFocusCtx, PlanLinkValue, PlanRowIndex, PlanRowValue, VisibleRow } from "./model.js";
import type { RowKey } from "./plan-state.js";
import type { PlanRowDiagnostic } from "./derive.js";
import { ancestorsOf } from "./row-tree.js";
import { rowKeyOf } from "./row-key.js";
import { appendAll } from "./reductions.js";

// ── The R1 link graph (renderer-derived over the decoded `links` edges) ─────

/** Every row key any link edge touches — the rows that grow the `links` control.
 *  A link names its ends by run ref (#824), each carrying its row's id (#822);
 *  the graph keys by the ids' text. */
export function linkedRowKeys(links: readonly PlanLinkValue[]): ReadonlySet<RowKey> {
    const out = new Set<RowKey>();
    for (const l of links) { out.add(rowKeyOf(l.from.row)); out.add(rowKeyOf(l.to.row)); }
    return out;
}

/**
 * A row's part in a links focus (#1680's review): the focused row itself, a row
 * only upstream of it, a row only downstream of it, or a row both — linked.
 */
export type PlanFocusRole = "upstream" | "focused" | "linked" | "downstream";

/** The roles a links focus gathers its rows under, in the order their bands stand: upstream, the focused row, the rows
 *  linked both ways, downstream. */
export const PLAN_FOCUS_ROLES: readonly PlanFocusRole[] = ["upstream", "focused", "linked", "downstream"];

/**
 * A band of a links focus's body (#1680's review): a role's, over the rows it
 * gathers, or the one every other row folds into.
 */
export interface PlanFocusBand {
    /** Its role, or `others` for the band the rows the focus does not gather fold into. */
    role: PlanFocusRole | "others";
    /**
     * The rows it stands for: a role's family rows wherever the canvas draws them — under the band, pinned above the
     * body, or not held, folded into the others' band — or the other data rows (their groups' bands not counted).
     */
    count: number;
    /** Whether its rows show under it: a role's always do, the others' once the band is opened. */
    open: boolean;
}

/** A row a links focus gathers under its role's band (#1680's review). */
export interface PlanGathered {
    /** Its role. */
    readonly role: PlanFocusRole;
    /** The labels of the rows it nests under, outermost first — its sub line says them, which tells two rows of one
     *  name apart. Empty for a row at the top. */
    readonly path: readonly string[];
}

/**
 * A run of source elements that is NOT resident (#577), rendered as one band.
 *
 * Its height comes from the window ledger, so the band and the rows that
 * replace it occupy exactly the same space — scrolling in loads content without
 * moving anything below it, and eviction puts the band back with nothing
 * shifting either. Each paged block has its own (#823): its rows' share of the
 * elements the band covers.
 */
export interface PlanBand {
    /** The block the band belongs to (#823). */
    block: number;
    at: "head" | "tail";
    /** First source element the band covers. */
    from: number;
    /** Last source element the band covers (inclusive). */
    to: number;
    /** The band's pixel height. */
    px: number;
    /** Which of its elements are loading (#1082): from the first element of
     *  the first window it covers that is in flight to the last element of
     *  the last (inclusive), when any is. A band far from every window in
     *  flight is loading nothing — it says how many elements it holds. */
    loading?: { from: number; to: number } | undefined;
}

/**
 * A resident window whose read FAILED (#811) — one error band where the
 * window's rows would be, carrying the reason and a Retry.
 *
 * The failure belongs to its window: every other window keeps landing and
 * rendering around it. One read serves every block (#823), so a failed window
 * is a band in each block that holds it.
 */
export interface PlanWindowFailure {
    /** The block the band stands in (#823). */
    block: number;
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

/** One line of the canvas body: a row, a links focus's band (#1680's review),
 *  an unloaded run of the source (#577, one per paged block's end — #823), or a
 *  window whose read failed (#811).
 *
 *  The R2 developer render is NOT an item here — it renders inside the
 *  focused row, which grows to hold it (see {@link PlanFocusCtx.renderPx}).
 *  Expand focus still stays inside the virtualizer either way; putting the
 *  render in the row is what lets the GUTTER grow with it. */
export type PlanBodyItem =
    | { kind: "row"; row: VisibleRow }
    | { kind: "focus"; band: PlanFocusBand }
    | { kind: "band"; band: PlanBand }
    | { kind: "failed"; failure: PlanWindowFailure };

/**
 * A body item's identity (#812) — its row's key, a links focus band's role,
 * its band's block and end, its failed window's block and window — prefixed by
 * kind, so no two items of a body share one. The virtualizer keys rows by it,
 * so a row keeps its component instance when a collapse, a focus or a landing
 * window moves it; keyed by index, the instance at a moved row's old index was
 * handed whichever row now sat there.
 *
 * @param item - The body item
 * @returns Its key, unique within one body
 */
export function bodyItemKey(item: PlanBodyItem): string {
    switch (item.kind) {
        case "row": return rowItemKey(item.row.row.key);
        case "focus": return focusBandKey(item.band.role);
        case "band": return `b:${item.band.block}:${item.band.at}`;
        case "failed": return `f:${item.failure.block}:${item.failure.w}`;
    }
}

/**
 * A links focus band's item key (#1680's review) — what {@link bodyItemKey}
 * gives it, and what a gathered row's ← steps to.
 *
 * @param role - The band's role
 * @returns Its item key
 */
export function focusBandKey(role: PlanFocusRole | "others"): string {
    return `l:${role}`;
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
 * A block's windows serve its entries in key order and its rows concatenate
 * them in window order (#823), so a window's rows sit between its neighbours'
 * — its band goes in the seam. Called once per block, over that block's items.
 *
 * @param items - One block's body items, rows in visible order
 * @param failures - That block's failed windows
 * @param windowOf - Which window a resident row came from
 * @returns The items with a `failed` band placed per failure (the same array
 *   when there are none)
 */
export function placeFailures(
    items: readonly PlanBodyItem[],
    failures: readonly PlanWindowFailure[],
    windowOf: (key: RowKey) => number | undefined,
): readonly PlanBodyItem[] {
    if (failures.length === 0) return items;
    // Item index a failure's band goes AFTER (−1: before every item).
    const after = new Map<number, PlanWindowFailure[]>();
    for (const f of [...failures].sort((a, b) => a.w - b.w)) {
        let at = -1;
        items.forEach((it, i) => {
            if (it.kind !== "row") return;
            const w = windowOf(it.row.row.key);
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

/**
 * A row's role in a links focus (#1680's review): `focused` for the focused
 * row, `linked` for one both upstream and downstream of it, else `upstream` or
 * `downstream` — `undefined` for a row the focus does not gather.
 *
 * @param family - The focused row's family ({@link deriveLinkFamily})
 * @param focus - The focused row
 * @param key - The row
 * @returns Its role
 */
export function focusRoleOf(family: LinkFamily, focus: RowKey, key: RowKey): PlanFocusRole | undefined {
    if (key === focus) return "focused";
    const up = family.upstream.has(key);
    const down = family.downstream.has(key);
    return up && down ? "linked" : up ? "upstream" : down ? "downstream" : undefined;
}

/**
 * Whether a links focus gathers a row: the focused row, or one of its family.
 *
 * @param focus - The row focus
 * @param key - The row
 * @returns Whether a links focus gathers it — `false` under any other focus
 */
export function focusGathers(focus: PlanFocusCtx, key: RowKey): boolean {
    return focus.kind === "links" && (key === focus.key || (focus.links?.family.all.has(key) ?? false));
}

/** The labels of the rows a row nests under, outermost first. */
function pathOf(index: PlanRowIndex, row: PlanRowValue): string[] {
    const path: string[] = [];
    for (let p = row.parent; p.type === "some";) {
        const parent = index.byKey.get(p.value);
        if (parent === undefined) break;
        path.unshift(parent.gutter.label);
        p = parent.parent;
    }
    return path;
}

/**
 * A links focus's body (#1680's review): its family gathered under one band
 * per role — upstream, the focused row, linked (only where a row is both),
 * downstream — each 26px, in the open group band's look, its rows under it in
 * stream order at one level, wherever they sit and however their sections are
 * folded; then ONE band every other row folds into, which opens in place.
 *
 * @remarks
 * A role with no rows keeps its band, which says so — the Linked band alone
 * stands only for a family that has one. A gathered row says the rows it nests
 * under on its sub line, which tells two rows of one name apart, and opens
 * nothing: its subtree is the other rows'. Pinned rows draw above the body, and
 * a row under one draws nowhere — neither is gathered. A role's band counts its
 * family's rows wherever the canvas draws them: the rows under it, a pinned row
 * of the family, and a row the canvas does not hold but has placed — one of a
 * paged source's evicted windows — whose links end at the others' band while
 * it is folded, where that row is. The others' band counts every other data row
 * the canvas holds, folded or not; opened, it holds the body's own items for
 * them — their groups, the unloaded runs of a paged source and its failed
 * windows among them — as they draw with no focus.
 *
 * @param index - The row index
 * @param focus - The focused row
 * @param family - Its family ({@link deriveLinkFamily})
 * @param others - Whether the others' band is open, and the items it holds when it is
 * @param placed - Whether the canvas has placed a row it does not hold (a paged source's evicted window's); none, inline
 * @returns The body's items
 */
export function focusBodyItems(
    index: PlanRowIndex,
    focus: RowKey,
    family: LinkFamily,
    others: { readonly open: boolean; readonly items: readonly PlanBodyItem[] },
    placed: (key: RowKey) => boolean = () => false,
): PlanBodyItem[] {
    const byRole = new Map<PlanFocusRole, VisibleRow[]>(PLAN_FOCUS_ROLES.map((role) => [role, []]));
    const counts = new Map<PlanFocusRole, number>(PLAN_FOCUS_ROLES.map((role) => [role, 0]));
    const counted = (role: PlanFocusRole) => counts.set(role, counts.get(role)! + 1);
    let otherRows = 0;
    // A pinned row, and every row under one, draws outside the body.
    const outside = new Set<RowKey>();
    for (const row of index.rows) {
        const role = focusRoleOf(family, focus, row.key);
        if (row.pinned || (row.parent.type === "some" && outside.has(row.parent.value))) {
            outside.add(row.key);
            // A pinned row of the family draws above the body; a row under one, nowhere.
            if (row.pinned && role !== undefined) counted(role);
            continue;
        }
        // A row whose parent is nowhere in the stream draws nowhere (`visibleRows`).
        if (!index.depth.has(row.key)) continue;
        if (role === undefined) {
            if (row.kind.type !== "group") otherRows += 1;
            continue;
        }
        counted(role);
        byRole.get(role)!.push({ row, depth: 1, collapsed: false, gathered: { role, path: pathOf(index, row) } });
    }
    // A row of the family the canvas has placed but does not hold: folded with the others, where its links end.
    for (const key of family.all) {
        if (!index.byKey.has(key) && placed(key)) counted(focusRoleOf(family, focus, key)!);
    }
    const out: PlanBodyItem[] = [];
    for (const role of PLAN_FOCUS_ROLES) {
        const count = counts.get(role)!;
        if (role === "linked" && count === 0) continue;
        out.push({ kind: "focus", band: { role, count, open: true } });
        for (const row of byRole.get(role)!) out.push({ kind: "row", row });
    }
    out.push({ kind: "focus", band: { role: "others", count: otherRows, open: others.open } });
    if (others.open) appendAll(out, others.items);
    return out;
}

/**
 * The rows a links focus's role bands count, as its caption counts them
 * (#1680's review): only upstream, both ways, only downstream.
 *
 * @param items - The body's items
 * @returns Each role's count — `undefined` for a body with no links focus
 */
export function focusRoleCounts(items: readonly PlanBodyItem[]): { upstream: number; linked: number; downstream: number } | undefined {
    const counts = { upstream: 0, linked: 0, downstream: 0 };
    let focused = false;
    for (const item of items) {
        if (item.kind !== "focus") continue;
        focused = true;
        const role = item.band.role;
        if (role === "upstream" || role === "linked" || role === "downstream") counts[role] = item.band.count;
    }
    return focused ? counts : undefined;
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
 * reachable both ways lands in both sets (gathered under the Linked band).
 */
export function deriveLinkFamily(links: readonly PlanLinkValue[], key: RowKey): LinkFamily {
    const fwd = new Map<RowKey, RowKey[]>();
    const rev = new Map<RowKey, RowKey[]>();
    for (const l of links) {
        const from = rowKeyOf(l.from.row);
        const to = rowKeyOf(l.to.row);
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
