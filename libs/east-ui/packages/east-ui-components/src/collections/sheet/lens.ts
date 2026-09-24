/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lens (B§8, `Sheet Spec.md` §3.8 / §6.3) — the slice's narrowing DRAWN
 * over the sheet rather than applied to it: a row the narrowing matches is
 * a hit and keeps its row number; the rows either side of a hit are its
 * context; anything explicitly revealed shows too; everything else
 * collapses into a band the planner can open a little at a time.
 *
 * The narrowing is decided by the slice engine itself (`sliceMatches` —
 * filters, cohorts, search, string fields by value and `text` fields
 * through their projection), run over a HOST-SHAPED record the sheet
 * rebuilds from each wire row: every column's cell decoded to its field's
 * value by the column's static type, so a `Link` reads as the link value a
 * `text` projection (`Sheet.link.print`) expects and an `Option` field
 * comes back wrapped. A field with no column is absent from the record and
 * reads as blank to the lens.
 *
 * On a grouped sheet (#740) a group is a hit when its title matches or any
 * of its lines does; the lens then works on the lines, and a search also
 * matches a line through its sub rows' printed text (#844).
 *
 * Pure: no React, no DOM. Reveals are ROW POSITIONS (the source offset), so
 * they survive paging and persist into a view.
 *
 * @packageDocumentation
 */

import { none, some } from "@elaraai/east";
import { sliceMatches } from "@elaraai/east-ui/internal";
import { TITLE_KEY, printLinkText, subRowText, type SheetColumnMeta } from "./model.js";
import type { LensContext, SliceStateValue } from "./sheet-types.js";
import type { SheetCellValue, SheetLineValue, SheetRowValue } from "./values.js";

/** The slice engine's config — the bound slice's, live (`boundSliceConfig`). */
export type LensConfig = Parameters<typeof sliceMatches>[1];

/** The band steps — each press of a band control reaches further; past the end, all of it. */
export const LENS_STEPS: readonly number[] = [1, 3, 10];

/**
 * Whether a narrowing is active — the slice's own rule (`isActive`): a
 * range, a filter, an active cohort, or a search with something in it.
 *
 * @param state - The slice state, `undefined` without a bound slice
 * @returns `true` when the lens has something to draw
 */
export function narrowingActive(state: SliceStateValue | undefined): boolean {
    if (state === undefined) return false;
    if (state.range.type === "some") return true;
    if (state.filters.length > 0) return true;
    if (state.activeCohorts.size > 0) return true;
    return state.search.type === "some" && state.search.value.trim() !== "";
}

/** The `.east` type value's tag, or `undefined` for an untyped test column. */
function typeTag(t: unknown): string | undefined {
    return t !== null && typeof t === "object" && "type" in t ? String((t as { type: unknown }).type) : undefined;
}

/** Whether a type value is an `Option` — a variant of exactly `some` and `none`. */
function isOptionType(t: unknown): boolean {
    if (typeTag(t) !== "Variant") return false;
    const cases = (t as { value: { name: string }[] }).value;
    return Array.isArray(cases) && cases.length === 2 && cases.some((c) => c.name === "some") && cases.some((c) => c.name === "none");
}

/**
 * A cell decoded to its field's runtime value, by the column's static type:
 * a bare primitive is the cell's value; an `Option` field wraps it (`none`
 * for a blank); a `Link` field is the link value, a `String` field under a
 * link column its printed text, a member-array field the link's members.
 */
function fieldValue(cell: SheetCellValue | undefined, dataType: unknown): unknown {
    const option = isOptionType(dataType);
    const inner = option ? (dataType as { value: { name: string; type: unknown }[] }).value.find((c) => c.name === "some")?.type : dataType;
    if (cell === undefined || cell.type === "Null") return option ? none : undefined;
    let v: unknown = cell.value;
    if (cell.type === "Link") {
        const tag = typeTag(inner);
        const link = cell.value;
        if (tag === "String") v = printLinkText(link);
        else if (tag === "Array") v = link.from.length > 0 ? link.from : link.to;
    }
    return option ? some(v) : v;
}

/**
 * The host-shaped record the slice engine reads for a wire row — one entry
 * per column, its cell decoded to the field's value.
 *
 * @param row - The wire row
 * @param columns - The declared columns (their keys and static types)
 * @returns The record `sliceMatches` narrows
 */
export function matchRecord(row: SheetRowValue, columns: readonly SheetColumnMeta[]): Record<string, unknown> {
    return matchCells(row.cells, columns);
}

/**
 * The host-shaped record over a set of cells — a row's, or one line's. A
 * date column's instant also rides BARE under `<key>At`: the slice's range
 * and its datetime predicates read the record raw, and the column's own
 * field may be an `Option`.
 */
function matchCells(cells: ReadonlyMap<string, SheetCellValue>, columns: readonly SheetColumnMeta[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const meta of columns) {
        out[meta.key] = fieldValue(cells.get(meta.key), meta.raw.dataType);
        if (meta.kind === "date") {
            const c = cells.get(meta.key);
            out[`${meta.key}At`] = c !== undefined && c.type === "DateTime" ? c.value : undefined;
        }
    }
    return out;
}

/** Whether a wire row is a group (#740): it carries lines, or the band's title cell. */
function isGroupRow(row: SheetRowValue): boolean {
    return row.lines.length > 0 || row.cells.has(TITLE_KEY);
}

/** The String cells under no column — a group's band facts, a line's rule cells (its detail) — which the search reads too. */
function extraFacts(cells: ReadonlyMap<string, SheetCellValue>, columns: readonly SheetColumnMeta[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, c] of cells) {
        if (k === TITLE_KEY || c.type !== "String" || columns.some((m) => m.key === k)) continue;
        out[k] = c.value;
    }
    return out;
}

/** One line's record: its group's facts, its own facts and its cells. */
function lineRecord(group: SheetRowValue, line: SheetLineValue, columns: readonly SheetColumnMeta[]): Record<string, unknown> {
    return { ...extraFacts(group.cells, columns), ...extraFacts(line.cells, columns), ...matchCells(line.cells, columns) };
}

/** The search query, lower-cased; `""` when there is none. */
function queryOf(state: SliceStateValue): string {
    return state.search.type === "some" ? state.search.value.trim().toLowerCase() : "";
}

/** Whether a line's sub rows answer the query — the query in one sub row's printed text. */
function subRowsMatch(line: SheetLineValue, q: string): boolean {
    return q !== "" && line.subRows.some((s) => subRowText(s).toLowerCase().includes(q));
}

/** A line with no value in the range field never answers a date window (the engine lets a record without the field through). */
function lineCanHit(state: SliceStateValue, config: LensConfig, record: Record<string, unknown>): boolean {
    if (state.range.type !== "some") return true;
    const field = (config as unknown as { rangeFieldId: { type: string; value?: string } }).rangeFieldId;
    return field.type !== "some" || field.value === undefined || record[field.value] !== undefined;
}

/**
 * A line's hit: its record matches — or, when the search matches its sub
 * rows, its record matches everything else the narrowing asks — and a
 * window has a date to answer it with.
 */
function lineHitOf(state: SliceStateValue, config: LensConfig, group: SheetRowValue, line: SheetLineValue, columns: readonly SheetColumnMeta[], now: Date): boolean {
    const record = lineRecord(group, line, columns);
    if (!lineCanHit(state, config, record)) return false;
    if (hitOf(state, config, record, now)) return true;
    return subRowsMatch(line, queryOf(state)) && hitOf({ ...state, search: none } as SliceStateValue, config, record, now);
}

/** The record a group's TITLE matches through: the title under its own key and the group's facts, every line field absent. */
function titleRecord(row: SheetRowValue, columns: readonly SheetColumnMeta[]): Record<string, unknown> {
    const title = row.cells.get(TITLE_KEY);
    return { ...extraFacts(row.cells, columns), [TITLE_KEY]: title !== undefined && title.type === "String" ? title.value : "" };
}

/** A title never answers a date range: a range narrows LINES. */
function titleCanHit(state: SliceStateValue): boolean {
    return state.range.type !== "some";
}

/** One record's hit, fail-closed. */
function hitOf(state: SliceStateValue, config: LensConfig, record: Record<string, unknown>, now: Date): boolean {
    try {
        return sliceMatches(state as never, config, record, now);
    } catch (err) {
        console.error("[Sheet] the lens could not match a row:", err);
        return false;
    }
}

/**
 * Whether the narrowing matches each row — the hits.
 *
 * @param state - The slice state
 * @param config - The bound slice's config
 * @param rows - The resident real rows, in sheet order
 * @param columns - The declared columns
 * @param now - The clock a datetime preset resolves against
 * @returns One flag per row
 */
export function lensHits(state: SliceStateValue, config: LensConfig, rows: readonly SheetRowValue[], columns: readonly SheetColumnMeta[], now: Date = new Date()): boolean[] {
    return rows.map((row) => {
        // A group is a hit when its title matches, or any of its lines does.
        if (isGroupRow(row)) {
            if (titleCanHit(state) && hitOf(state, config, titleRecord(row, columns), now)) return true;
            return row.lines.some((line) => lineHitOf(state, config, row, line, columns, now));
        }
        return hitOf(state, config, matchRecord(row, columns), now);
    });
}

/**
 * Whether a group's TITLE matches on its own — every line then shows.
 *
 * @param state - The slice state
 * @param config - The bound slice's config
 * @param group - The group row
 * @param columns - The declared line columns
 * @param now - The clock a datetime preset resolves against
 * @returns `true` when the title matches
 */
export function lensTitleHit(state: SliceStateValue, config: LensConfig, group: SheetRowValue, columns: readonly SheetColumnMeta[] = [], now: Date = new Date()): boolean {
    return isGroupRow(group) && titleCanHit(state) && hitOf(state, config, titleRecord(group, columns), now);
}

/**
 * Whether the narrowing matches each LINE of a group (#740) — the brand line
 * numbers under a matched band.
 *
 * @param state - The slice state
 * @param config - The bound slice's config
 * @param group - The group row
 * @param columns - The declared line columns
 * @param now - The clock a datetime preset resolves against
 * @returns One flag per line
 */
export function lensLineHits(state: SliceStateValue, config: LensConfig, group: SheetRowValue, columns: readonly SheetColumnMeta[], now: Date = new Date()): boolean[] {
    return group.lines.map((line) => lineHitOf(state, config, group, line, columns, now));
}

/**
 * Which of a hit line's SUB ROWS the search answers through (#844): the
 * query in the sub row's printed text, case-insensitive. A filter, a cohort
 * or a range never picks a sub row.
 *
 * @param state - The slice state
 * @param group - The group row
 * @param lineHits - The group's line hits ({@link lensLineHits})
 * @returns Per line, one flag per sub row
 */
export function lensSubRowHits(state: SliceStateValue, group: SheetRowValue, lineHits: readonly boolean[]): boolean[][] {
    const q = queryOf(state);
    return group.lines.map((line, j) => line.subRows.map((s) => q !== "" && lineHits[j] === true && subRowText(s).toLowerCase().includes(q)));
}

/**
 * The rows the lens shows: every hit, `context` rows either side of each,
 * and every revealed position.
 *
 * @param hits - One flag per resident row
 * @param positions - Each resident row's source position
 * @param context - The band width
 * @param reveals - Revealed positions
 * @returns One flag per resident row
 */
export function lensVisible(hits: readonly boolean[], positions: readonly number[], context: LensContext, reveals: ReadonlySet<number>): boolean[] {
    const out = new Array<boolean>(hits.length).fill(false);
    hits.forEach((hit, i) => {
        if (!hit) return;
        for (let d = -context; d <= context; d++) {
            const j = i + d;
            if (j >= 0 && j < out.length) out[j] = true;
        }
    });
    positions.forEach((p, i) => { if (reveals.has(p)) out[i] = true; });
    return out;
}

/** One collapsed run of hidden rows between two visible ones (or an end of the resident rows). */
export interface LensGap {
    /** Anchored on the bounding HITS' positions, so a band keeps its identity as context is revealed. */
    key: string;
    /** The first hidden row's position. */
    from: number;
    /** The last hidden row's position. */
    to: number;
    /** `to - from + 1`. */
    hidden: number;
    /** No visible row above (the run starts the sheet). */
    first: boolean;
    /** No visible row below (the run ends the sheet). */
    last: boolean;
}

/**
 * The hidden runs between the visible rows.
 *
 * @param hits - One flag per resident row
 * @param visible - One flag per resident row
 * @param positions - Each resident row's source position
 * @returns The gaps, in order, each keyed by the hits that bound it
 */
export function lensGaps(hits: readonly boolean[], visible: readonly boolean[], positions: readonly number[]): LensGap[] {
    const n = hits.length;
    const out: LensGap[] = [];
    const hitBefore = (i: number): number => { for (let k = i; k >= 0; k--) if (hits[k]) return positions[k]!; return -1; };
    const hitAfter = (i: number): number => { for (let k = i; k < n; k++) if (hits[k]) return positions[k]!; return -2; };
    let i = 0;
    while (i < n) {
        if (visible[i]) { i++; continue; }
        const start = i;
        while (i < n && !visible[i]) i++;
        const end = i - 1;
        const first = start === 0;
        const last = end === n - 1;
        out.push({
            key: `${hitBefore(start - 1)}_${hitAfter(end + 1)}`,
            from: positions[start]!, to: positions[end]!, hidden: end - start + 1, first, last,
        });
    }
    return out;
}

/**
 * The reach of a band control on its next press — the step at its press
 * count, capped to the run.
 *
 * @param steps - The presses so far, by `${key}:${where}`
 * @param key - The band's key
 * @param where - The control
 * @param hidden - The run's size
 * @returns How many rows the next press reveals
 */
export function nextReach(steps: ReadonlyMap<string, number>, key: string, where: "top" | "bottom" | "both", hidden: number): number {
    const step = LENS_STEPS[steps.get(`${key}:${where}`) ?? 0];
    return step === undefined ? hidden : Math.min(step, hidden);
}

/**
 * The positions a band control reveals, and the steps after the press —
 * the prototype's `expandGap`: from the top, from the bottom, both ends
 * (half each), or all of it; a press past the last step opens the run.
 *
 * @param steps - The presses so far
 * @param key - The band's key
 * @param from - The run's first position
 * @param to - The run's last position
 * @param where - The control
 * @returns The positions to reveal and the updated steps
 */
export function revealStep(
    steps: ReadonlyMap<string, number>,
    key: string,
    from: number,
    to: number,
    where: "top" | "bottom" | "both" | "all",
): { positions: number[]; steps: Map<string, number> } {
    const range = (a: number, b: number): number[] => {
        const out: number[] = [];
        for (let p = Math.max(a, from); p <= Math.min(b, to); p++) out.push(p);
        return out;
    };
    const hidden = to - from + 1;
    const next = new Map(steps);
    if (where === "all") return { positions: range(from, to), steps: next };
    const pressed = steps.get(`${key}:${where}`) ?? 0;
    next.set(`${key}:${where}`, pressed + 1);
    const step = LENS_STEPS[pressed];
    if (step === undefined || step >= hidden) return { positions: range(from, to), steps: next };
    if (where === "top") return { positions: range(from, from + step - 1), steps: next };
    if (where === "bottom") return { positions: range(to - step + 1, to), steps: next };
    const half = Math.max(1, Math.ceil(step / 2));
    return { positions: [...range(from, from + half - 1), ...range(to - half + 1, to)], steps: next };
}

/** The `n matches · m context` line, empty without a lens. */
export function lensCount(hits: readonly boolean[], visible: readonly boolean[]): string {
    const n = hits.filter(Boolean).length;
    const shown = visible.filter(Boolean).length;
    const ctx = shown - n;
    return `${n} match${n === 1 ? "" : "es"}${ctx > 0 ? ` · ${ctx} context` : ""}`;
}

/** A view's name from its query (B§8): the query to 16 characters, else `view n`. */
export function viewName(query: string, seq: number): string {
    const q = query.trim();
    if (q === "") return `view ${seq}`;
    return q.length > 16 ? `${q.slice(0, 15)}…` : q;
}

/**
 * The tabs that stay visible when `folded` of them must hide under width
 * pressure (B§8): the first ones in order, the active tab always kept — it
 * takes the last visible slot when it would otherwise fold. The hidden tabs
 * ride the `+n` menu, in order.
 *
 * @param views - Every view, in order
 * @param active - The active view's id (`null` = the whole sheet)
 * @param folded - How many tabs must hide
 * @returns The visible and the hidden views
 */
export function foldTabs<T extends { id: string }>(views: readonly T[], active: string | null, folded: number): { visible: T[]; hidden: T[] } {
    const keep = Math.max(0, views.length - Math.max(0, folded));
    const activeIdx = active === null ? -1 : views.findIndex((v) => v.id === active);
    if (activeIdx < 0 || activeIdx < keep) return { visible: views.slice(0, keep), hidden: views.slice(keep) };
    const head = views.slice(0, Math.max(0, keep - 1));
    return { visible: [...head, views[activeIdx]!], hidden: views.filter((_v, i) => i >= head.length && i !== activeIdx) };
}
