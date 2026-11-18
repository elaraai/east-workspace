/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio visual's records (#1671): a records table's page as the Table
 * shows it — its columns in their well order, headed by its source's labels,
 * its numbers in their fields' formats — and what it holds of how many
 * (TBL-1, TBL-5); a viewer's sort, which its program sorts every row by; the
 * rows under any visual, without its grouping — what its tile's Show rows
 * lists and Export CSV writes (TIL-2); and records as CSV.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { ArrayType, StructType, none, some, variant, type EastType } from "@elaraai/east";
import type { ColumnSort, TableRootValue } from "@elaraai/east-ui-components";
import { resultCsv } from "../../query/downloads.js";
import type { QueryWords } from "../../query/model/words.js";
import { rowsTable, type ResultColumn } from "../../query/results-table.js";
import type { VisualAnswered } from "../../query/visual/ask.js";
import type { ClickedGroup } from "../../query/visual/clicks.js";
import { recordsKey, type PrintSource } from "../../query/visual/print.js";
import type { StudioMessages } from "../messages.js";
import { columnHead, visualWords, type Visual, type VisualSource, type VisualView } from "./values.js";

/** A records table's view: its columns, the field its rows are sorted by, and which way. */
export type RecordsView = Extract<Extract<VisualView, { type: "table" }>["value"], { type: "records" }>["value"];

/**
 * A visual's records table, while it is one.
 *
 * @param visual - The visual
 * @returns Its columns, its sort and which way; `undefined` for any other view
 */
export function recordsOf(visual: Visual): RecordsView | undefined {
    const view = visual.view;
    return view.type === "table" && view.value.type === "records" ? view.value.value : undefined;
}

/**
 * A viewer's sort of a records table: the field every row is sorted by, and
 * which way — its program's, so a page is a page of all the rows in that
 * order, never one page reordered.
 *
 * @property field - The field
 * @property descending - Whether the greatest comes first
 */
export interface RecordsSort {
    /** The field. */
    readonly field: string;
    /** Whether the greatest comes first. */
    readonly descending: boolean;
}

/**
 * A records answer's columns as the Table heads and prints them: each the
 * column its program answers at its place (`c0`), headed by its field's label
 * — a currency field's code after it — its numbers in its field's format.
 *
 * @param records - The records table
 * @param answer - Its answer: each column's East type
 * @param source - Its source: the fields' labels and formats
 * @param m - The Studio's words
 * @returns The columns, in the table's order; one the answer has no type for left out
 */
export function recordsColumns(records: RecordsView, answer: VisualAnswered, source: VisualSource, m: StudioMessages): ResultColumn[] {
    return records.columns.flatMap((field, i): ResultColumn[] => {
        const key = recordsKey(i);
        const type = answer.columns.get(key);
        if (type === undefined) return [];
        const { header, format } = columnHead(source, field, m);
        return [{ key, type, field, header, format }];
    });
}

/**
 * A records table's page, as its tile draws it.
 *
 * @property table - The page's rows as the Table's value
 * @property first - Its first row's place, from 1; 0 for a page with none
 * @property last - Its last row's place
 * @property total - How many rows there are in all
 * @property clicked - The group a row stands for, by its place on the page: its first column's value (TBL-6)
 */
export interface RecordsModel {
    /** The page's rows as the Table's value. */
    readonly table: TableRootValue;
    /** Its first row's place, from 1; 0 for a page with none. */
    readonly first: number;
    /** Its last row's place. */
    readonly last: number;
    /** How many rows there are in all. */
    readonly total: number;
    /** The group a row stands for, by its place on the page (TBL-6): its first column's value; `undefined` for a row the page does not hold. */
    readonly clicked: (rowIndex: number) => readonly ClickedGroup[] | undefined;
}

/**
 * A records table's page, from its answer (TBL-1): its rows in the Table — an
 * absent value in words (NFR-5) — and where they stand among every row.
 *
 * @param records - The records table
 * @param answer - The page's answer
 * @param offset - The page's first row, from 0
 * @param source - Its source
 * @param words - The words: the query builder's, and the viewer's formatters
 * @param m - The Studio's words
 * @returns The page
 */
export function recordsModel(records: RecordsView, answer: VisualAnswered, offset: number, source: VisualSource, words: QueryWords, m: StudioMessages): RecordsModel {
    const rows = answer.rows.length;
    const [first] = recordsColumns(records, answer, source, m);
    return {
        table: rowsTable(recordsColumns(records, answer, source, m), answer.rows, visualWords(words, m)),
        first: rows === 0 ? 0 : offset + 1,
        last: offset + rows,
        total: answer.groups,
        clicked: (rowIndex) => {
            const row = answer.rows[rowIndex];
            return row === undefined || first === undefined || first.field === undefined ? undefined
                : [{ group: { field: first.field, bucket: none }, key: row[first.key], type: first.type }];
        },
    };
}

/**
 * A records visual sorted as its viewer sorts it: its rows by that field,
 * either way; its own sort where the viewer sorts none.
 *
 * @param visual - The visual, a records table
 * @param sort - The viewer's sort; `undefined` keeps its own
 * @returns The visual its program prints
 */
export function sortedBy(visual: Visual, sort: RecordsSort | undefined): Visual {
    const view = visual.view;
    if (sort === undefined || view.type !== "table" || view.value.type !== "records") return visual;
    return { ...visual, view: variant("table", variant("records", { ...view.value.value, sort: some(sort.field), descending: sort.descending })) };
}

/**
 * The column a records table's rows are sorted by, as the Table names it, and
 * which way: what its program sorted, which the Table's head shows.
 *
 * @param records - The records table
 * @returns The column's key and its direction; `undefined` while it sorts by none of its columns
 */
export function recordsSorted(records: RecordsView): ColumnSort | undefined {
    if (records.sort.type === "none") return undefined;
    const at = records.columns.indexOf(records.sort.value);
    return at < 0 ? undefined : { columnKey: recordsKey(at), direction: records.descending ? "desc" : "asc" };
}

/**
 * The field a records table answers under a key, as the Table names a
 * column: what a sort of that column sorts by.
 *
 * @param records - The records table
 * @param key - The column's key (`c0`)
 * @returns The field; `undefined` for a key the table has no column under
 */
export function recordsField(records: RecordsView, key: string): string | undefined {
    return records.columns.find((_field, i) => recordsKey(i) === key);
}

/**
 * The rows under a visual, without its grouping (TIL-2): its source's
 * records, narrowed as the visual is — what its tile's Show rows lists and
 * Export CSV writes — each field its source lists, in order, newest first by
 * its date range.
 *
 * @param visual - The visual
 * @param source - Its source, as the surface lists it
 * @param read - Its source, as the printer reads it
 * @returns A records visual of its rows
 */
export function rowsVisual(visual: Visual, source: VisualSource, read: PrintSource): Visual {
    // A source listing no fields shows every field of its rows.
    const columns = source.fields.length > 0 ? source.fields.map((field) => field.id) : Object.keys(read.row.fields);
    return {
        ...visual,
        view: variant("table", variant("records", {
            columns,
            sort: read.range === undefined ? none : some(read.range),
            descending: read.range !== undefined,
        })),
    };
}

/** A records answer's column, under the name it is shown by. */
interface NamedColumn {
    /** Its name. */
    readonly name: string;
    /** The key the answer holds it under (`c0`). */
    readonly key: string;
    /** Its East type. */
    readonly type: EastType;
}

/**
 * A records answer's columns, each once, under a name: a column the answer
 * has no type for is left out, and one whose name an earlier column took.
 *
 * @param records - The records table
 * @param answer - Its answer: each column's East type
 * @param nameOf - A column's name, by its field and its place
 * @returns The columns, in the table's order
 */
function namedColumns(records: RecordsView, answer: VisualAnswered, nameOf: (field: string, at: number) => string): NamedColumn[] {
    const named: NamedColumn[] = [];
    records.columns.forEach((field, i) => {
        const type = answer.columns.get(recordsKey(i));
        const name = nameOf(field, i);
        if (type !== undefined && !named.some((column) => column.name === name)) named.push({ name, key: recordsKey(i), type });
    });
    return named;
}

/** An answer's rows as an Array of one struct of its named columns: the type, and the rows of it. */
function structRows(named: readonly NamedColumn[], answer: VisualAnswered): { readonly type: EastType; readonly value: Readonly<Record<string, unknown>>[] } {
    return {
        type: ArrayType(StructType(named.map((column) => [column.name, column.type] as const))),
        value: answer.rows.map((row) => Object.fromEntries(named.map((column) => [column.name, row[column.key]]))),
    };
}

/**
 * A records answer's rows as East values of one struct (TIL-2): each row its
 * columns under their source's labels — a label two fields share, under each
 * field's own name; a field shown twice, once — each value of its column's
 * own East type, so a value tree shows whatever a source's rows hold.
 *
 * @param records - The records table
 * @param answer - A page's answer: its rows, and each column's East type
 * @param source - Its source: the fields' labels
 * @returns The rows' type, an Array of the struct, and the rows of that type
 */
export function recordsRows(records: RecordsView, answer: VisualAnswered, source: VisualSource): { readonly type: EastType; readonly value: readonly Readonly<Record<string, unknown>>[] } {
    const labelOf = (field: string) => source.fields.find((listed) => listed.id === field)?.label ?? field;
    // A label is a column's name while no other field among the columns has it; a field shown twice is shown once.
    const shared = (label: string) => new Set(records.columns.filter((field) => labelOf(field) === label)).size > 1;
    return structRows(namedColumns(records, answer, (field) => (shared(labelOf(field)) ? field : labelOf(field))), answer);
}

/**
 * Records as CSV (TIL-2): the answer's rows, one a row, each column headed by
 * its field's name — a field shown twice, once — through the query builder's
 * CSV, so a nested value is the words the Table shows for it.
 *
 * @param records - The records table
 * @param answer - Its answer: every row asked
 * @param words - The words, for a nested value
 * @returns The CSV's bytes, UTF-8
 */
export function recordsCsv(records: RecordsView, answer: VisualAnswered, words: QueryWords): Uint8Array {
    const { type, value } = structRows(namedColumns(records, answer, (field) => field), answer);
    return resultCsv({ type, value, counts: undefined, total: undefined, truncated: false, paged: undefined }, words);
}
