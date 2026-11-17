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
import type { TableRootValue } from "@elaraai/east-ui-components";
import { resultCsv } from "../../query/downloads.js";
import type { QueryWords } from "../../query/model/words.js";
import { rowsTable, type ResultColumn } from "../../query/results-table.js";
import type { VisualAnswered } from "../../query/visual/ask.js";
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
    return {
        table: rowsTable(recordsColumns(records, answer, source, m), answer.rows, visualWords(words, m)),
        first: rows === 0 ? 0 : offset + 1,
        last: offset + rows,
        total: answer.groups,
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
    // Each field once, at its first column: the answer's key for it, and its type.
    const named: { readonly field: string; readonly key: string; readonly type: EastType }[] = [];
    records.columns.forEach((field, i) => {
        const type = answer.columns.get(recordsKey(i));
        if (type !== undefined && !named.some((column) => column.field === field)) named.push({ field, key: recordsKey(i), type });
    });
    const type = ArrayType(StructType(named.map((column) => [column.field, column.type] as const)));
    const value = answer.rows.map((row) => Object.fromEntries(named.map((column) => [column.field, row[column.key]])));
    return resultCsv({ type, value, counts: undefined, total: undefined, truncated: false, paged: undefined }, words);
}
