/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The copilot's transitions (B§5 — `Sheet Spec.md` §5 rows 10–13): what the
 * runner's results do to the state, the ⇥ walk over pending fills (first
 * press arms the next target, the next writes it and arms the following),
 * ⏎ taking the next suggestion, ⌘⏎ / ⌘⇧⏎ the row fill and everything, the
 * esc rungs (a selected proposal → the row fill → every suggestion), ⌫
 * rejecting the armed fill or the selected proposal — and the memory of what
 * was rejected. Pure functions over the machine state.
 *
 * @packageDocumentation
 */

import {
    same,
    type CellRef, type PendingFill, type PendingRow, type SheetEffect, type SheetEvent, type SheetMachineCtx, type SheetUiState, type Suggestions, type Transition,
} from "./sheet-types.js";

const none = (s: SheetUiState): Transition => ({ state: s, effects: [] });

/** The pending fills in column order — the order ⇥ walks. */
export function fillOrder(sugg: Suggestions | null, ctx: SheetMachineCtx): { key: string; c: number }[] {
    if (sugg === null || ctx.columnOf === undefined) return [];
    const out: { key: string; c: number }[] = [];
    for (const key of sugg.fill.keys()) {
        const c = ctx.columnOf(key);
        if (c !== undefined) out.push({ key, c });
    }
    return out.sort((a, b) => a.c - b.c);
}

/** The anchor's row-space index, if it is still on the sheet. */
export function anchorRow(sugg: Suggestions | null, ctx: SheetMachineCtx): number | undefined {
    return sugg === null || ctx.rowOf === undefined ? undefined : ctx.rowOf(sugg.anchorId);
}

/** The one cell a ⇥ press writes next — exactly one, ever: the armed fill, else the first (last, walking back). */
export function nextTargetOf(s: SheetUiState, ctx: SheetMachineCtx, back = false): (CellRef & { key: string }) | null {
    const order = fillOrder(s.sugg, ctx);
    if (order.length === 0) return null;
    const r = anchorRow(s.sugg, ctx);
    if (r === undefined) return null;
    if (s.armed !== null && s.armed.r === r) {
        const hit = order.find((o) => o.c === s.armed!.c);
        if (hit !== undefined) return { r, c: hit.c, key: hit.key };
    }
    const o = back ? order[order.length - 1]! : order[0]!;
    return { r, c: o.c, key: o.key };
}

/** The suggestions minus one fill — `null` once nothing is pending. */
function withoutFill(sugg: Suggestions, key: string): Suggestions | null {
    const fill = new Map(sugg.fill);
    fill.delete(key);
    if (fill.size === 0 && sugg.rows.length === 0 && sugg.pending.length === 0) return null;
    return { ...sugg, fill };
}

/** The text a proposal's driver cell carries (its activity), for the messages. */
function driverText(cells: ReadonlyMap<string, { type: string; value: unknown }>, ctx: SheetMachineCtx): string {
    const cell = ctx.driverColumn !== undefined ? cells.get(ctx.driverColumn) : undefined;
    return cell !== undefined && cell.type === "String" ? (cell.value as string) : "";
}

/** Take one fill: write it, then arm the following target so the next ⇥ writes that one. */
export function takeFill(s: SheetUiState, ctx: SheetMachineCtx, key: string, back = false): Transition {
    const sugg = s.sugg;
    if (sugg === null) return none(s);
    const f = sugg.fill.get(key);
    const r = anchorRow(sugg, ctx);
    const c = ctx.columnOf?.(key);
    if (f === undefined || r === undefined || c === undefined) return none(s);
    const effects: SheetEffect[] = [{ t: "write.many", r, writes: [{ c, cell: f.cell }], source: "fill" }];
    let next: SheetUiState = { ...s, sugg: withoutFill(sugg, key), armed: null, gsel: null, msg: `Took ${key} — ${f.meta === "" ? "suggested" : f.meta}` };
    const nt = nextTargetOf(next, ctx, back);
    if (nt !== null) {
        next = { ...next, sel: { r: nt.r, c: nt.c }, selEnd: null, armed: { r: nt.r, c: nt.c } };
        effects.push({ t: "emit.select", r: nt.r, c: nt.c });
    }
    return { state: next, effects };
}

/** Fill the whole row in one step (⌘⏎, the gutter's →). */
export function fillRow(s: SheetUiState, ctx: SheetMachineCtx): Transition {
    const sugg = s.sugg;
    if (sugg === null || sugg.fill.size === 0) return none(s);
    const r = anchorRow(sugg, ctx);
    if (r === undefined) return none(s);
    const writes = fillOrder(sugg, ctx).map((o) => ({ c: o.c, cell: sugg.fill.get(o.key)!.cell }));
    if (writes.length === 0) return none(s);
    const rest: Suggestions | null = sugg.rows.length > 0 || sugg.pending.length > 0 ? { ...sugg, fill: new Map() } : null;
    const n = writes.length;
    return {
        state: { ...s, sugg: rest, armed: null, gsel: null, msg: `Filled ${n} cell${n === 1 ? "" : "s"} on row ${ctx.numberAt?.(r) ?? r + 1}` },
        effects: [{ t: "write.many", r, writes, source: "row" }],
    };
}

/**
 * Take the proposals up to `upTo` (inclusive) — the row fill first, then the
 * rows in order; the rest re-anchor on the last row inserted so the next one
 * is already waiting (B§5.2).
 */
export function takeProposals(s: SheetUiState, ctx: SheetMachineCtx, upTo: number): Transition {
    const sugg = s.sugg;
    if (sugg === null) return none(s);
    const r = anchorRow(sugg, ctx);
    if (r === undefined) return none(s);
    let next = s;
    const effects: SheetEffect[] = [];
    if (sugg.fill.size > 0) {
        const filled = fillRow(s, ctx);
        next = filled.state;
        effects.push(...filled.effects);
    }
    const rows: readonly PendingRow[] = sugg.rows.slice(0, Math.max(0, upTo + 1));
    const rest: readonly PendingRow[] = sugg.rows.slice(rows.length);
    if (rows.length === 0) return { state: { ...next, gsel: null }, effects };
    effects.push({ t: "insert.rows", anchorR: r, rows, rest });
    const label = driverText(rows[0]!.cells, ctx);
    return {
        state: {
            ...next, sugg: null, armed: null, gsel: null, selEnd: null,
            msg: `Took ${label === "" ? "the suggested row" : label}${rest.length > 0 ? " — next one suggested below" : ""}`,
        },
        effects,
    };
}

/** Reject a proposal — and remember the pairing so it is not offered after that driver value again. */
export function rejectProposal(s: SheetUiState, ctx: SheetMachineCtx, i: number): Transition {
    const sugg = s.sugg;
    const row = sugg?.rows[i];
    if (sugg === null || sugg === undefined || row === undefined) return none(s);
    const r = anchorRow(sugg, ctx);
    const from = r !== undefined ? ctx.driverKeyAt?.(r) ?? "" : "";
    const to = driverText(row.cells, ctx);
    const follows = new Set(s.rejected.follows);
    if (from !== "" && to !== "") follows.add(`${from}>${to}`);
    const rows = sugg.rows.filter((_x, n) => n !== i);
    const rest: Suggestions | null = rows.length > 0 || sugg.fill.size > 0 || sugg.pending.length > 0 ? { ...sugg, rows } : null;
    return {
        state: {
            ...s, gsel: null, sugg: rest, rejected: { ...s.rejected, follows },
            msg: `Rejected — ${to === "" ? "that row" : to} will not be suggested after ${from === "" ? "this" : from} again`,
        },
        effects: [],
    };
}

/** Dismiss one fill — remembered per row and key. */
export function rejectFill(s: SheetUiState, ctx: SheetMachineCtx, key: string): Transition {
    const sugg = s.sugg;
    if (sugg === null || !sugg.fill.has(key)) return none(s);
    const fills = new Set(s.rejected.fills);
    fills.add(`${sugg.anchorId}|${key}`);
    void ctx;
    return {
        state: { ...s, sugg: withoutFill(sugg, key), armed: null, rejected: { ...s.rejected, fills }, msg: `Dismissed — ${key} will not be suggested again on this row` },
        effects: [],
    };
}

/** The runner's result lands — for an anchor still on the sheet. */
export function applyReady(s: SheetUiState, ctx: SheetMachineCtx, anchorId: string, sugg: Suggestions | null): Transition {
    if (ctx.rowOf?.(anchorId) === undefined) return none(s);
    if (sugg !== null && sugg.anchorId !== anchorId) return none(s);
    if (s.sugg === null && sugg === null) return none(s);
    // The armed target survives when the new result still fills that cell.
    const next: SheetUiState = { ...s, sugg, gsel: null };
    const keep = s.armed !== null && nextTargetOf(next, ctx) !== null && same(s.armed, nextTargetOf(next, ctx));
    return { state: keep ? next : { ...next, armed: null }, effects: [] };
}

/** An async provider settled — merged when its anchor and key are still pending. */
export function applyLanded(s: SheetUiState, e: Extract<SheetEvent, { t: "suggest.landed" }>): Transition {
    const sugg = s.sugg;
    if (sugg === null || sugg.anchorId !== e.anchorId || !sugg.pending.includes(e.key)) return none(s);
    const pending = sugg.pending.filter((k) => k !== e.key);
    let fill: ReadonlyMap<string, PendingFill> = sugg.fill;
    let rows = sugg.rows;
    if (e.key !== "rows" && e.fill !== undefined && e.fill !== null && !s.rejected.fills.has(`${sugg.anchorId}|${e.key}`)) {
        const cur = fill.get(e.key);
        // An earlier provider that lands outranks a later one's fill (first that yields wins, by position).
        if (cur === undefined || e.fill.index < cur.index) {
            const next = new Map(fill);
            next.set(e.key, e.fill);
            fill = next;
        }
    }
    if (e.key === "rows" && e.rows !== undefined && e.rows.length > 0 && rows.length === 0) rows = e.rows;
    const next: Suggestions | null = fill.size === 0 && rows.length === 0 && pending.length === 0 ? null : { ...sugg, fill, rows, pending };
    return { state: { ...s, sugg: next }, effects: [] };
}

/** The anchor became a real row: the suggestions follow its new id. */
export function rekeySuggest(s: SheetUiState, from: string, to: string): SheetUiState {
    if (s.sugg === null || s.sugg.anchorId !== from) return s;
    const fills = new Set<string>();
    for (const f of s.rejected.fills) fills.add(f.startsWith(`${from}|`) ? `${to}|${f.slice(from.length + 1)}` : f);
    return { ...s, sugg: { ...s.sugg, anchorId: to }, rejected: { ...s.rejected, fills } };
}

/** Every suggestion dropped. */
export function clearSuggest(s: SheetUiState): SheetUiState {
    if (s.sugg === null && s.armed === null && s.gsel === null) return s;
    return { ...s, sugg: null, armed: null, gsel: null };
}

/** The rows changed: a suggestion whose anchor left the sheet goes with it; the proposal selection clamps. */
export function afterRowsChanged(s: SheetUiState, ctx: SheetMachineCtx): SheetUiState {
    if (s.sugg === null) return s.gsel === null ? s : { ...s, gsel: null };
    if (anchorRow(s.sugg, ctx) === undefined) return { ...s, sugg: null, armed: null, gsel: null };
    if (s.gsel !== null && s.gsel >= s.sugg.rows.length) return { ...s, gsel: null };
    return s;
}

/** The esc rungs the copilot adds: a selected proposal → the row fill (rows stay) → everything. `null` = nothing to drop. */
export function escSuggest(s: SheetUiState): Transition | null {
    if (s.gsel !== null) return { state: { ...s, gsel: null, msg: "Deselected — esc again dismisses every suggestion" }, effects: [] };
    if (s.sugg === null) return null;
    if (s.sugg.fill.size > 0 && s.sugg.rows.length > 0) {
        return { state: { ...s, sugg: { ...s.sugg, fill: new Map() }, armed: null, msg: "Row fill dismissed — esc again for the suggested rows" }, effects: [] };
    }
    return { state: { ...s, sugg: null, armed: null, selEnd: null }, effects: [] };
}

/**
 * The sheet keys the copilot claims while something is pending (B§6): ⇥ walks
 * the fills then takes rows, ⏎ takes the next suggestion, ⌘⏎ the row fill,
 * ⌘⇧⏎ everything, ⌫ rejects the armed fill or the selected proposal. `null`
 * hands the key back to the sheet.
 */
export function suggestKey(s: SheetUiState, e: Extract<SheetEvent, { t: "key" }>, ctx: SheetMachineCtx): Transition | null {
    if (e.key === "Tab") {
        const nt = nextTargetOf(s, ctx, e.shift);
        if (nt !== null) {
            const onIt = s.armed !== null && same(s.armed, nt) && same(s.sel, nt);
            if (onIt) return takeFill(s, ctx, nt.key, e.shift);
            return {
                state: { ...s, sel: { r: nt.r, c: nt.c }, selEnd: null, armed: { r: nt.r, c: nt.c }, gsel: null },
                effects: [{ t: "emit.select", r: nt.r, c: nt.c }, { t: "scroll.to", r: nt.r }],
            };
        }
        if (s.sugg !== null && s.sugg.rows.length > 0) return takeProposals(s, ctx, 0);
        return null;
    }
    if (e.key === "Enter") {
        if (e.meta && e.shift) return s.sugg === null ? none(s) : takeProposals(s, ctx, s.sugg.rows.length - 1);
        if (e.meta) return s.sugg !== null && s.sugg.fill.size > 0 ? fillRow(s, ctx) : none(s);
        if (s.gsel !== null) return takeProposals(s, ctx, s.gsel);
        if (s.sugg !== null && s.sugg.fill.size > 0) return fillRow(s, ctx);
        if (s.sugg !== null && s.sugg.rows.length > 0) return takeProposals(s, ctx, 0);
        return null;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.meta) {
        if (s.gsel !== null) return rejectProposal(s, ctx, s.gsel);
        if (s.armed !== null) {
            const nt = nextTargetOf(s, ctx);
            if (nt !== null && same(s.sel, nt) && same(s.armed, nt)) return rejectFill(s, ctx, nt.key);
        }
        return null;
    }
    return null;
}
