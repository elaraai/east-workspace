/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise in the Sheet (#1409, #1418; `Optimise Spec.md` §5.1, §9.5, R25):
 * the current tab's rows as the run's request — every entry as the session
 * holds it, base plus every unapplied draft, by its key — and the result
 * landed on the rows as one edit: the diff by key recorded as one step of the
 * session (`session.record`, origin `optimise`), each row answered lifted
 * into its draft and projected to the wire row the source would show for it
 * (`editing.project`), and the operations the landing draws per cell — a
 * blank given a value an add, a value changed a change, a value cleared a
 * remove — kept until Apply.
 *
 * @packageDocumentation
 */

import { SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, none, some, variant, type EastType } from "@elaraai/east";
import { Sheet, SheetOptimiseRequestTypeFor, SheetOptimiseResultTypeFor } from "@elaraai/e3-ui/internal";
import { diffOptimiseRows, optimiseIdOf, optimiseKeyOf } from "../shared/func/optimise-diff.js";
import type { OptimiseCounts } from "../shared/func/use-optimise.js";
import { liftDraft, normalizeDraft } from "./draft-values.js";
import { NULL_CELL, cellIsBlank, countNoun, lineId } from "./model.js";
import type { EntryUpdate, EntryVersion, Origin, Placement } from "./transactions.js";
import type { SheetCellValue, SheetNounValue, SheetRootValue, SheetRowValue } from "./values.js";
import type { SheetWords } from "./words.js";

/** The rows by key, as the request and the result carry them. */
type Rows = SortedMap<unknown, unknown>;

/** The run's request: the run's number, and the current tab's rows by key, as the session holds them. */
export interface SheetOptimiseRequest {
    readonly run: bigint;
    readonly rows: Rows;
}

/** The run's answer: the rows by key, complete. */
export interface SheetOptimiseResult {
    readonly rows: Rows;
}

/** What a run did to one cell (R25): a blank given a value, a value changed, or a value cleared. */
export type SheetCellOp = "add" | "chg" | "del";

/** What a run left on one row — an entry's own cells, a band's, or a line's — until Apply, and the run that did it. */
export interface SheetRowOps {
    /** The row's own operation: a row the run added, or one it changed. */
    readonly op: "add" | "chg";
    /** Each cell the run changed, by column key. */
    readonly cells: ReadonlyMap<string, SheetCellOp>;
    /** Each changed cell as it stood before the run, by column key: the provenance's `Was …`. */
    readonly previous: ReadonlyMap<string, SheetCellValue>;
    /** The run's number, formatted: the provenance's `run #n`. */
    readonly run: string;
}

/** A row's marks as its row draws them. */
export type SheetRowMarks = SheetRowOps;

/**
 * What the runs left on the sheet's rows (R17): each row's operations by its
 * id — an entry's or a band's under the entry's id, a line's under
 * `lineId(group, key)` — a later run's over an earlier's on the same row.
 */
export interface SheetOptimised {
    readonly rows: ReadonlyMap<string, SheetRowOps>;
}

/** The sheet's optimiser's types: the request and the result over the sheet's rows and its source's key. */
export interface SheetOptimiseTypes {
    readonly request: EastType;
    readonly result: EastType;
    /** The sheet's row type: its entries'. */
    readonly rowType: EastType;
    /** The source's key type: a record's own, else `String` — an Array source's rows keyed by their id field. */
    readonly keyType: EastType;
}

/** The kind the diff names the sheet's rows by: one record, every row. */
const ROWS = "rows";

const sameCell = equalFor(Sheet.Types.Cell);
const decodeWire = decodeBeast2For(Sheet.Types.Row);

/**
 * The request and result types over the sheet's rows: what the bound
 * optimiser is called with, as the tag held it to.
 *
 * @param editing - The sheet's editing declaration: its entry and key types
 * @returns The types
 */
export function sheetOptimiseTypes(editing: Pick<SheetRootValue["editing"], "entryType" | "keyType">): SheetOptimiseTypes {
    const rowType = fromEastTypeValue(editing.entryType) as EastType;
    const keyType = editing.keyType.type === "some" ? fromEastTypeValue(editing.keyType.value) as EastType : StringType;
    return { request: SheetOptimiseRequestTypeFor(rowType, keyType), result: SheetOptimiseResultTypeFor(rowType, keyType), rowType, keyType };
}

/**
 * The run's scope, as the eye, the footer line and the banner name it (§10):
 * the tab's rows counted in the sheet's own words — `8 work orders`, a
 * grouped sheet's `3 plans`.
 *
 * @param n - How many rows the tab holds
 * @param noun - A grouped sheet's word for a group; `undefined` on a flat sheet
 * @param rowsNoun - What the rail counts a flat sheet's rows in — `work orders`, else `rows`
 * @param words - The sheet's words
 * @returns The scope's label
 */
export function sheetOptimisePeriod(n: number, noun: SheetNounValue | undefined, rowsNoun: string, words: SheetWords): string {
    return noun !== undefined ? countNoun(n, noun, words) : words.m.countNoun({ n, count: words.number(n), noun: rowsNoun, nouns: rowsNoun });
}

/**
 * The run's request (R1, R25, O3, O5): the run's number, and the current tab's
 * rows by key as the session holds them — base plus every unapplied draft. A
 * draft with a field still missing has no row to send: it is left out, and
 * so untouched by the answer.
 *
 * @param entries - The tab's rows: its entries, the local layer applied
 * @param versionOf - An entry's version as it stands: the session's, else the source's; `undefined` while its page is not in
 * @param draftType - The entries' draft type
 * @param keyType - The source's key type
 * @param run - The run's number
 * @returns The request
 */
export function sheetOptimiseRequest(entries: readonly SheetRowValue[], versionOf: (id: string) => EntryVersion | undefined, draftType: EastType, keyType: EastType, run: number): SheetOptimiseRequest {
    const keyOf = optimiseKeyOf(keyType);
    const rows: Rows = new SortedMap([], compareFor(keyType) as (a: unknown, b: unknown) => number);
    for (const entry of entries) {
        const version = versionOf(entry.id);
        if (version?.draft === undefined) continue;
        const key = keyOf(entry.id);
        if (key === undefined) continue;
        const { domain } = normalizeDraft(draftType, version.draft, entry.id);
        if (domain === undefined) continue;
        rows.set(key, domain);
    }
    return { run: BigInt(run), rows };
}

/** What a landing is made over. */
export interface SheetLanding {
    /** The sheet's editing declaration: its row projection. */
    readonly editing: Pick<SheetRootValue["editing"], "project">;
    readonly types: SheetOptimiseTypes;
    /** The entries' draft type. */
    readonly draftType: EastType;
    /** Whether the source is keyed: a new row takes its key's place; else it lands at the end. */
    readonly keyed: boolean;
    /** The request the result answers. */
    readonly request: SheetOptimiseRequest;
    readonly result: SheetOptimiseResult;
    /** The step's label — `Elara run #7`. */
    readonly label: string;
    /** The run's number, formatted, for the provenance. */
    readonly runText: string;
    /** An entry's version as it stands: the session's, else the source's — absent for a row the sheet does not hold. */
    readonly versionOf: (id: string) => EntryVersion;
    /** Records the versions as one transaction of the session; answers whether it did. */
    readonly record: (updates: readonly EntryUpdate[], origin: Origin, label: string) => boolean;
    /** What earlier runs left on the rows, still the session's drafts. */
    readonly before?: SheetOptimised | undefined;
}

/**
 * The cells a row's wire changed between two versions, and each as it stood.
 *
 * @param before - The row's cells before the run; `undefined` for a row it added
 * @param after - Its cells after
 * @returns Each changed cell's operation and its former value
 */
function cellOps(before: ReadonlyMap<string, SheetCellValue> | undefined, after: ReadonlyMap<string, SheetCellValue>): Pick<SheetRowOps, "cells" | "previous"> {
    const cells = new Map<string, SheetCellOp>();
    const previous = new Map<string, SheetCellValue>();
    for (const key of new Set([...(before?.keys() ?? []), ...after.keys()])) {
        const was = before?.get(key) ?? NULL_CELL;
        const now = after.get(key) ?? NULL_CELL;
        if (sameCell(was, now)) continue;
        cells.set(key, cellIsBlank(was) ? "add" : cellIsBlank(now) ? "del" : "chg");
        previous.set(key, was);
    }
    return { cells, previous };
}

/**
 * What a run left on one entry's rows: its own cells — a row's, a band's —
 * and each of its lines' by the line's id, a new line's every cell an add.
 *
 * @param marks - Where the rows' marks are kept
 * @param before - The entry's wire row before the run; `undefined` for one it added
 * @param after - Its wire row after
 * @param run - The run's number, formatted
 */
function markRows(marks: Map<string, SheetRowOps>, before: SheetRowValue | undefined, after: SheetRowValue, run: string): void {
    const own = cellOps(before?.cells, after.cells);
    if (own.cells.size > 0 || before === undefined) marks.set(after.id, { op: before === undefined ? "add" : "chg", ...own, run });
    for (const line of after.lines) {
        const was = before?.lines.find((l) => l.key === line.key);
        const ops = cellOps(was?.cells, line.cells);
        if (ops.cells.size > 0 || was === undefined) marks.set(lineId(after.id, line.key), { op: was === undefined ? "add" : "chg", ...ops, run });
    }
}

/**
 * The result landed (R7, R8, R10, R25, §12): diffed against the request by
 * key and recorded as one step of the session, origin `optimise` — each row
 * answered lifted into its draft, its wire row the source's projection of it;
 * a row the request held and the result does not, removed; a new row placed
 * at its key's place on a keyed source, else at the end. A result equal to
 * the request records nothing and leaves what earlier runs left as it is
 * (R10); one that changes rows lays its marks over theirs.
 *
 * @param args - What the landing is made over
 * @returns What the run counted, and what the runs have left on the rows — unchanged by a run that changed nothing; `undefined` for a result the session would not take
 */
export function landSheetOptimise(args: SheetLanding): { counts: OptimiseCounts; optimised: SheetOptimised | undefined } | undefined {
    const { editing, types, draftType, keyed, request, result, label, runText, versionOf, record, before: earlier } = args;
    const diff = diffOptimiseRows(ROWS, types.rowType, optimiseIdOf(types.keyType), request.rows, result.rows);
    const encodeEntry = encodeBeast2For(types.rowType) as (entry: unknown) => Uint8Array;
    const project = (row: unknown, id: string): SheetRowValue => decodeWire(editing.project(encodeEntry(row), id)) as SheetRowValue;
    // A new row's place: its key's on a keyed source, else after every row the sheet holds.
    const place: Placement = keyed ? some(variant("keyOrder", null)) : some(variant("ordered", variant("end", null)));
    const updates: EntryUpdate[] = [];
    const marks = new Map<string, SheetRowOps>();
    for (const [key, op] of diff.ops) {
        const id = key.slice(ROWS.length + 1);
        const before = versionOf(id);
        if (op.op === "del") {
            updates.push({ id, before, after: { draft: undefined, wire: undefined, place: none } });
            continue;
        }
        const wire = project(op.row, id);
        const after: EntryVersion = { draft: liftDraft(draftType, op.row), wire, place: op.op === "add" ? place : before.place };
        updates.push({ id, before, after });
        markRows(marks, op.op === "add" ? undefined : before.wire, wire, runText);
    }
    if (updates.length === 0) return { counts: diff.counts, optimised: undefined };
    if (!record(updates, "optimise", label)) return undefined;
    return { counts: diff.counts, optimised: { rows: new Map([...(earlier?.rows ?? []), ...marks]) } };
}
