/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The copilot runner (`Sheet Spec.md` §6.2 — B§5): providers run against the
 * row AS IT WOULD BE if the open editor committed, over the bridged WIRE
 * functions of §4.8 — the runner never sees the host's row type. Per column,
 * the first provider that yields wins, by position; owned rows are skipped;
 * nothing lands in an occupied cell; a fill the planner dismissed on that row
 * is not asked for again; results are memoised per (anchor, provisional row,
 * column, provider). Fills CHAIN in column order — a later column's providers
 * (and the proposers) see the earlier columns' fills as if taken, the
 * prototype's `row.start || fill.start`: the end derives from a predicted
 * start, the notes phrase and the tank count read the predicted volume. A synchronous provider answers inline; an asynchronous
 * one is returned as work the component tracks (`suggest-async.ts`) — a
 * later synchronous provider answers meanwhile, and an earlier asynchronous
 * one that lands replaces it (first that yields wins, still by position).
 * Proposers run the same way once per anchor, their rows capped at `ahead`,
 * never into an occupied slot, minus the follower pairings the planner
 * rejected.
 *
 * @packageDocumentation
 */

import { cellIsBlank, rawCellText, type SheetKind } from "./model.js";
import type { PendingFill, PendingRow, Rejections, Suggestions } from "./sheet-types.js";
import type { SheetCellValue, SheetContextValue, SheetRowValue } from "./values.js";

/** The copilot's latency per kind (B§3): deterministic kinds fire fast, the rest wait for a pause in typing. */
export const LATENCY_MS = { instant: 150, idle: 1100 } as const;

/** One provider on the wire — the compiled closure and its arm. */
export interface WireProvider {
    type: "sync" | "async";
    value: (ctx: SheetContextValue) => unknown;
}

/** One column's fill providers. */
export interface FillColumn {
    key: string;
    kind: SheetKind;
    editable: boolean;
    providers: readonly WireProvider[];
}

/** What one run reads. */
export interface SuggestInput {
    /** The anchor — a real row's id, or a blank row's synthetic id. */
    anchorId: string;
    /** The provisional anchor row (the open editor's value applied). */
    row: SheetRowValue;
    /** The column being edited — not filled, unless it is a link (predicted into). */
    skipKey: string | undefined;
    columns: readonly FillColumn[];
    proposers: readonly WireProvider[];
    /** At most this many proposed rows. */
    ahead: number;
    /** The slot below the anchor is occupied — never propose into it. */
    nextBusy: boolean;
    /** The anchor's driver key (the rejected-follower pairings). */
    driverKey: string | undefined;
    driverColumn: string | undefined;
    rejected: Rejections;
    /** The wire context over a row — the provisional anchor, or the anchor with one cell blanked. */
    contextOf: (row: SheetRowValue) => SheetContextValue;
    memo: SuggestMemo;
}

/** An async provider's settled result. */
export type AsyncResult = { kind: "fill"; fill: PendingFill | null } | { kind: "rows"; rows: PendingRow[] };

/** An async provider the component tracks — delivered only while its generation is current. */
export interface AsyncWork {
    /** The column key, or `"rows"`. */
    key: string;
    index: number;
    run: () => Promise<AsyncResult>;
}

/** One run's outcome. */
export interface SuggestOutcome {
    sugg: Suggestions | null;
    async: AsyncWork[];
}

/** The memo — settled results and in-flight promises per (anchor, provisional row, column, provider). */
export class SuggestMemo {
    private readonly map = new Map<string, unknown>();
    get(key: string): unknown { return this.map.get(key); }
    has(key: string): boolean { return this.map.has(key); }
    set(key: string, value: unknown): void {
        if (this.map.size > 4000) this.map.clear();
        this.map.set(key, value);
    }
    clear(): void { this.map.clear(); }
}

/** A row with one cell replaced. */
function withCell(row: SheetRowValue, key: string, cell: SheetCellValue): SheetRowValue {
    const cells = new Map(row.cells);
    cells.set(key, cell);
    return { ...row, cells };
}

/** A row's cells, printed — the memo's notion of "the same provisional row". */
export function hashRow(row: SheetRowValue): string {
    const parts: string[] = [];
    for (const [k, c] of row.cells) parts.push(`${k}=${c.type}:${rawCellText(c)}`);
    return parts.join("|");
}

/** The fill an East `Option<Fill>` value carries. */
function fillOf(out: unknown, index: number): PendingFill | null {
    const o = out as { type: string; value: { value: SheetCellValue; meta: string } } | null | undefined;
    if (o === null || o === undefined || o.type !== "some") return null;
    if (cellIsBlank(o.value.value)) return null;
    return { cell: o.value.value, meta: o.value.meta, index };
}

/** The rows an East `Array<Proposal>` value carries. */
function rowsOf(out: unknown): PendingRow[] {
    const list = out as readonly { cells: ReadonlyMap<string, SheetCellValue>; meta: string }[] | null | undefined;
    if (list === null || list === undefined || !Array.isArray(list)) return [];
    return list.map((p) => ({ cells: p.cells, meta: p.meta }));
}

/** The provider's East result — thrown errors read as nothing, with a diagnostic. */
function callSync(p: WireProvider, ctx: SheetContextValue, where: string): unknown {
    try {
        return p.value(ctx);
    } catch (err) {
        console.error(`[Sheet] ${where} failed:`, err);
        return null;
    }
}

/** Start an async provider once — the promise is memoised so a re-run re-attaches instead of restarting it. */
function startAsync<T>(memo: SuggestMemo, key: string, run: () => Promise<T>, where: string, fallback: T): Promise<T> {
    const known = memo.get(key);
    if (known instanceof Promise) return known as Promise<T>;
    const p = Promise.resolve()
        .then(run)
        .catch((err: unknown) => {
            console.error(`[Sheet] ${where} failed:`, err);
            return fallback;
        })
        .then((res) => { memo.set(key, res); return res; });
    memo.set(key, p);
    return p;
}

/** Run the copilot once for an anchor. */
export function runSuggest(input: SuggestInput): SuggestOutcome {
    const { row, memo } = input;
    if (row.owned) return { sugg: null, async: [] };
    const fill = new Map<string, PendingFill>();
    const async: AsyncWork[] = [];
    const pending = new Set<string>();
    // The row as the providers see it: the anchor, plus the fills found so far (they chain in column order).
    let provisional = row;
    let provisionalHash: string | undefined;
    let provisionalCtx: SheetContextValue | undefined;
    const hash = () => (provisionalHash ??= hashRow(provisional));
    const context = () => (provisionalCtx ??= input.contextOf(provisional));
    const chain = (key: string, cell: SheetCellValue) => {
        provisional = withCell(provisional, key, cell);
        provisionalHash = undefined;
        provisionalCtx = undefined;
    };

    for (const col of input.columns) {
        if (!col.editable || col.providers.length === 0) continue;
        const predictedInto = col.kind === "link" || col.kind === "set";
        if (col.key === input.skipKey && !predictedInto) continue;
        if (input.rejected.fills.has(`${input.anchorId}|${col.key}`)) continue;
        const occupied = !cellIsBlank(row.cells.get(col.key));
        // The edited link column is predicted into: its providers see the row with that cell blank.
        if (occupied && !(predictedInto && col.key === input.skipKey)) continue;
        let ctxFor: SheetContextValue | undefined;
        const ctx = () => {
            if (ctxFor !== undefined) return ctxFor;
            if (occupied) {
                const cells = new Map(provisional.cells);
                cells.set(col.key, { type: "Null", value: null } as SheetCellValue);
                ctxFor = input.contextOf({ ...provisional, cells });
            } else ctxFor = context();
            return ctxFor;
        };
        const found = (out: PendingFill) => {
            fill.set(col.key, out);
            if (!occupied) chain(col.key, out.cell);
        };
        for (let i = 0; i < col.providers.length; i++) {
            const p = col.providers[i]!;
            const where = `fill provider #${i + 1} on column "${col.key}"`;
            const mk = `${input.anchorId}${hash()}${col.key}${i}`;
            if (p.type === "sync") {
                let out: PendingFill | null;
                if (memo.has(mk)) out = memo.get(mk) as PendingFill | null;
                else {
                    out = fillOf(callSync(p, ctx(), where), i);
                    memo.set(mk, out);
                }
                if (out !== null) { found(out); break; }
                continue;
            }
            const known = memo.get(mk);
            if (known !== undefined && !(known instanceof Promise)) {
                const out = known as PendingFill | null;
                if (out !== null) { found(out); break; }
                continue;
            }
            const promise = startAsync<PendingFill | null>(memo, mk, () => Promise.resolve(p.value(ctx())).then((o) => fillOf(o, i)), where, null);
            pending.add(col.key);
            async.push({ key: col.key, index: i, run: () => promise.then((f) => ({ kind: "fill", fill: f })) });
        }
    }

    let rows: PendingRow[] = [];
    if (!input.nextBusy && input.proposers.length > 0 && input.ahead > 0) {
        const admit = (list: PendingRow[]): PendingRow[] => list
            .filter((r) => {
                const cell = input.driverColumn !== undefined ? r.cells.get(input.driverColumn) : undefined;
                const to = cell !== undefined && cell.type === "String" ? (cell.value as string) : "";
                return !(input.driverKey !== undefined && to !== "" && input.rejected.follows.has(`${input.driverKey}>${to}`));
            })
            .slice(0, input.ahead);
        for (let i = 0; i < input.proposers.length; i++) {
            const p = input.proposers[i]!;
            const where = `proposer #${i + 1}`;
            const mk = `${input.anchorId}${hash()}rows${i}`;
            if (p.type === "sync") {
                let out: PendingRow[];
                if (memo.has(mk)) out = memo.get(mk) as PendingRow[];
                else {
                    out = rowsOf(callSync(p, context(), where));
                    memo.set(mk, out);
                }
                const kept = admit(out);
                if (kept.length > 0) { rows = kept; break; }
                continue;
            }
            const known = memo.get(mk);
            if (known !== undefined && !(known instanceof Promise)) {
                const kept = admit(known as PendingRow[]);
                if (kept.length > 0) { rows = kept; break; }
                continue;
            }
            const promise = startAsync<PendingRow[]>(memo, mk, () => Promise.resolve(p.value(context())).then(rowsOf), where, []);
            pending.add("rows");
            async.push({ key: "rows", index: i, run: () => promise.then((list) => ({ kind: "rows", rows: admit(list) })) });
        }
    }

    if (fill.size === 0 && rows.length === 0 && pending.size === 0) return { sugg: null, async };
    return { sugg: { anchorId: input.anchorId, fill, rows, pending: [...pending] }, async };
}
