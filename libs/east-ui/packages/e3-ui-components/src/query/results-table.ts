/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run's result as a Table (#938, `Query Editor Spec.md` §4.11): the rows a
 * result gives and their columns, the words a cell shows where the Table
 * words a value rather than shows it — a list by its size, a record by its
 * first fields, a case with its payload, a missing value as "—" — and the
 * value east-ui-components' Table renderer shows, built here, in the browser,
 * from the decoded result.
 *
 * The Table and the CSV download read the same rows ({@link resultRows}) and
 * word a cell through the same {@link cellText}, so the two never differ.
 *
 * @packageDocumentation
 */

import {
    BlobType, BooleanType, NullType, SortedMap, StringType,
    compareFor, isPrimitiveType, none, printFor, some, toEastTypeValue, variant,
    type ArrayType, type EastType, type SetType, type StructType, type ValueTypeOf, type VariantType, type VectorType,
    type matrix, type option, type ref,
} from "@elaraai/east";
import type { Table } from "@elaraai/east-ui/internal";
import type { TableColumnValue, TableRootValue } from "@elaraai/east-ui-components";
import { baseType, optionPayload, singular, unwrapRecursive } from "./steps/shape.js";
import { human, isIdName, plural, type QueryWords } from "./model/words.js";

/** One row of a Table: its cells by column key, where it sits, and whether it starts folded. */
type TableRow = ValueTypeOf<typeof Table.Types.Row>;

/** One cell of a Table: a primitive value, under its own tag. */
type TableCell = ValueTypeOf<typeof Table.Types.Cell>;

/**
 * A run's result, decoded: its East type and its value.
 *
 * @remarks
 * The type is the one the run's self-describing beast2 answer carries: `T`
 * for a query giving one value, `Option<T>` for none or one, `Array<T>` for
 * many.
 *
 * @property type - The result's East type
 * @property value - The decoded value, of that type
 */
export interface DecodedResult {
    /** The result's East type: `T`, `Option<T>` or `Array<T>`, as the run gave it. */
    readonly type: EastType;
    /** The decoded value, of that type. */
    readonly value: unknown;
}

/**
 * A column of a result's rows.
 *
 * @property key - The key each row holds the column's value under
 * @property type - The column's East type
 * @property field - The field the column reads; `undefined` for the one column of a result that is not records
 */
export interface ResultColumn {
    /** The key each row holds the column's value under: a record's field name, or `value`. */
    readonly key: string;
    /** The column's East type: the field's, or the type of the values a result that is not records gives. */
    readonly type: EastType;
    /**
     * The field the column reads, whose name names a list's items in it
     * (`3 lines`); `undefined` for the one `value` column of a result that is
     * not records, whose lists' items are `items`.
     */
    readonly field: string | undefined;
}

/**
 * A result's rows, as the Table shows them and the CSV writes them.
 *
 * @property columns - The columns, in order
 * @property rows - The rows, each a struct value keyed by column key
 */
export interface ResultRows {
    /** The columns, in order: a record's fields, in declared order, or the one `value` column. */
    readonly columns: readonly ResultColumn[];
    /** The rows, each a struct value keyed by column key: a record itself, or `{ value }`. */
    readonly rows: readonly unknown[];
}

/** The key of the one column a result that is not records gives. */
const VALUE_KEY = "value";

/** How many of a record's fields its summary shows, at most. */
const SUMMARY_FIELDS = 3;

/** The kinds a summary leaves out of a record's: collections and records, which say little in a few words. */
const NESTED_KINDS: ReadonlySet<EastType["type"]> = new Set(["Array", "Set", "Vector", "Matrix", "Dict", "Struct"]);

/** Cells keyed in East's order of their keys. */
const compareKeys = compareFor(StringType);

/** How East prints the values a summary shows as East prints them. */
const printBoolean = printFor(BooleanType);
const printNull = printFor(NullType);
const printBlob = printFor(BlobType);

// ─── Rows and columns ────────────────────────────────────────────────────────

/**
 * A result's rows and columns, as the Table shows them (`Query Editor
 * Spec.md` §4.11).
 *
 * @param result - the decoded result: its type, and its value
 * @returns the columns, in order, and the rows, each a struct value keyed by
 *   column key
 *
 * @remarks
 * - **Records.** An array or a set of records — a recursive element read as
 *   its node — is one row per element and one column per field, in declared
 *   order; a record is one row.
 * - **An option.** `none` is no rows, with the columns its payload would
 *   give; `some` is its payload's rows.
 * - **Anything else.** An array, a set or a vector of other values is one
 *   row per value — a vector's numbers or booleans, as East reads them out of
 *   it — and any other value one row, in one `value` column: each row is
 *   `{ value }`.
 *
 * @example
 * ```ts
 * const { columns, rows } = resultRows({ type: ArrayType(Order), value: orders });
 * // columns: customer_id, discount, id, lines, status, total — one row per order
 *
 * resultRows({ type: IntegerType, value: 40n });
 * // columns: value — rows: [{ value: 40n }]
 * ```
 */
export function resultRows(result: DecodedResult): ResultRows {
    return { columns: columnsOf(result.type), rows: rowsOf(result.type, result.value) };
}

/**
 * The columns a value of a type gives: an option's payload's, a record's
 * fields, an array's or a set's records' fields, or one `value` column.
 *
 * @param type - the type
 * @returns the columns, in order
 */
function columnsOf(type: EastType): ResultColumn[] {
    const payload = optionPayload(type);
    if (payload !== undefined) return columnsOf(payload);
    const t = unwrapRecursive(type);
    if (t.type === "Array" || t.type === "Set" || t.type === "Vector") {
        const element = elementOf(t);
        const record = recordOf(element);
        return record === undefined ? [valueColumn(element)] : fieldColumns(record);
    }
    return t.type === "Struct" ? fieldColumns(t) : [valueColumn(type)];
}

/**
 * The rows a value of a type gives, in the order {@link columnsOf} reads them.
 *
 * @param type - the type
 * @param value - the value
 * @returns the rows, each a struct value keyed by column key
 */
function rowsOf(type: EastType, value: unknown): readonly unknown[] {
    const payload = optionPayload(type);
    if (payload !== undefined) {
        const option = value as option<unknown>;
        return option.type === "some" ? rowsOf(payload, option.value) : [];
    }
    const t = unwrapRecursive(type);
    if (t.type === "Array" || t.type === "Set" || t.type === "Vector") {
        // A set iterates in East's order of its keys.
        const items = t.type === "Array" ? value as readonly unknown[]
            : t.type === "Set" ? [...value as ReadonlySet<unknown>]
            : vectorItems(t, value);
        return recordOf(elementOf(t)) === undefined ? items.map(item => ({ [VALUE_KEY]: item })) : items;
    }
    return t.type === "Struct" ? [value] : [{ [VALUE_KEY]: value }];
}

/** An array's, a set's or a vector's element type. */
function elementOf(type: ArrayType | SetType | VectorType): EastType {
    return (type.type === "Array" ? type.value : type.type === "Set" ? type.key : type.element) as EastType;
}

/**
 * A vector's elements as East values, as East's own `VectorToArray` reads
 * them out: a vector of numbers holds them as they are, and a vector of
 * booleans holds each as a byte, 0 for false.
 */
function vectorItems(type: VectorType, value: unknown): readonly unknown[] {
    switch (unwrapRecursive(type.element as EastType).type) {
        case "Boolean": return Array.from(value as Uint8ClampedArray, byte => byte !== 0);
        case "Integer": return Array.from(value as BigInt64Array);
        default: return Array.from(value as Float64Array);
    }
}

/** The record an element is, read through its recursive wrapper; `undefined` when it is no record. */
function recordOf(element: EastType): StructType | undefined {
    const node = unwrapRecursive(element);
    return node.type === "Struct" ? node : undefined;
}

/** A record's fields, as columns, in declared order. */
function fieldColumns(record: StructType): ResultColumn[] {
    return Object.entries(record.fields as Record<string, EastType>).map(([name, type]) => ({ key: name, type, field: name }));
}

/** The one column of a result that is not records. */
function valueColumn(type: EastType): ResultColumn {
    return { key: VALUE_KEY, type, field: undefined };
}

// ─── A cell's words ──────────────────────────────────────────────────────────

/**
 * The words a result's cell shows for a value the Table words rather than
 * shows as itself (`Query Editor Spec.md` §4.11): a nested value summarised,
 * and a missing one.
 *
 * @param type - the value's East type
 * @param value - the value
 * @param words - the words
 * @param field - the field the value sits in, whose name names a list's
 *   items: a column's `field`; `undefined` for the one `value` column, whose
 *   lists' items are `items`
 * @returns the words; `undefined` for a primitive value — Null, Boolean,
 *   Integer, Float, String, DateTime, Blob, under any options — which a cell
 *   holds as itself
 *
 * @remarks
 * - **Missing.** An option's `none` is the missing word, "—"; its `some` is
 *   its payload's words. A recursive value is its node's.
 * - **A list** (an array, a set, a vector) is its size and its items, named
 *   after its field: "1 line", "3 lines"; "3 items" where no field names
 *   them. **A lookup table** is "1 entry", "8 entries"; **a grid** its shape,
 *   "3 × 4".
 * - **A record** is up to its first three fields that are neither a
 *   collection nor a record, missing ones left out, joined " · ".
 * - **A case** is its name; with a payload, "{case} · {payload}" — a record
 *   payload's every field, missing ones left out; a Null payload, the case
 *   alone. **A calculation** is "function".
 * - **Inside a summary**, a number prints in the viewer's language through
 *   the words' formatters, exactly: an ID field's as written, a whole number
 *   grouped, any other with every digit (§9 — never rounded); a DateTime as
 *   its date and time, and a Boolean, a Null and a Blob as East prints them.
 *
 * @example
 * ```ts
 * cellText(ArrayType(Line), lines, words, "lines");            // "3 lines"
 * cellText(Status, variant("shipped", { date }), words, "status"); // "shipped · Jun 1, 2026, 14:00"
 * cellText(OptionType(FloatType), none, words, "discount");     // "—"
 * cellText(FloatType, 1234.5, words, "total");                  // undefined: the cell holds 1234.5
 * ```
 */
export function cellText(type: EastType, value: unknown, words: QueryWords, field: string | undefined): string | undefined {
    const payload = optionPayload(type);
    if (payload !== undefined) {
        const option = value as option<unknown>;
        return option.type === "some" ? cellText(payload, option.value, words, field) : words.messages.resultMissing();
    }
    if (isPrimitiveType(unwrapRecursive(type))) return undefined;
    return summaryText(type, value, words, field) ?? words.messages.resultMissing();
}

/**
 * A value's text inside a summary: a primitive printed, a nested value in
 * words.
 *
 * @param type - the value's East type
 * @param value - the value
 * @param words - the words
 * @param field - the field the value sits in, if any
 * @returns the text; `undefined` for a missing value, which a summary leaves out
 */
function summaryText(type: EastType, value: unknown, words: QueryWords, field: string | undefined): string | undefined {
    const payload = optionPayload(type);
    if (payload !== undefined) {
        const option = value as option<unknown>;
        return option.type === "some" ? summaryText(payload, option.value, words, field) : undefined;
    }
    const t = unwrapRecursive(type);
    const f = words.formatters;
    const m = words.messages;
    const id = field !== undefined && isIdName(field);
    switch (t.type) {
        case "Never": return undefined;
        case "Null": return printNull(value as null);
        case "Boolean": return printBoolean(value as boolean);
        case "Integer": return id ? f.bare(value as bigint) : f.number(value as bigint);
        case "Float": return id ? f.bare(value as number) : f.float(value as number);
        case "String": return value as string;
        case "DateTime": return f.dateTime(value as Date);
        case "Blob": return printBlob(value as Uint8Array);
        case "Ref": return summaryText(t.value as EastType, (value as ref<unknown>).value, words, field);
        case "Array": return listText((value as readonly unknown[]).length, words, field);
        case "Set": return listText((value as ReadonlySet<unknown>).size, words, field);
        // A typed array of its numbers or booleans.
        case "Vector": return listText((value as ArrayLike<unknown>).length, words, field);
        case "Matrix": {
            const grid = value as matrix;
            return m.resultGrid({ rows: f.number(grid.rows), cols: f.number(grid.cols) });
        }
        case "Dict": {
            const n = (value as ReadonlyMap<unknown, unknown>).size;
            return m.resultEntries({ count: f.number(n), n });
        }
        case "Struct": return recordText(t, value, words);
        case "Variant": return caseText(t, value, words);
        case "Recursive": return summaryText(t.node as EastType, value, words, field);
        case "Function": case "AsyncFunction": return m.resultFunction();
    }
}

/**
 * A list by its size and its items: "1 line", "3 lines", named after the
 * field holding it; "3 items" where no field does.
 *
 * @param n - how many items
 * @param words - the words
 * @param field - the field holding the list, if any
 * @returns the words
 */
function listText(n: number, words: QueryWords, field: string | undefined): string {
    return words.messages.resultList({ count: words.formatters.number(n), noun: field === undefined ? words.messages.itemsWord({ n }) : itemNoun(field, n) });
}

/**
 * What a list's items are called, from the field holding it: its singular for
 * one, and its plural — the field's own name when that is not a regular
 * plural, as `children` is not, since a list's field names its items
 * (`plainKind`'s `items`).
 *
 * @param field - the field's name
 * @param n - how many items
 * @returns the noun, in the count's number
 */
function itemNoun(field: string, n: number): string {
    const one = singular(field);
    if (n === 1) return human(one);
    return one === field ? human(field) : plural(human(one));
}

/**
 * A record in a summary: up to its first {@link SUMMARY_FIELDS} fields that
 * are neither a collection nor a record, missing ones left out.
 *
 * @param record - the record's type
 * @param value - the record
 * @param words - the words
 * @returns the fields' texts, joined
 */
function recordText(record: StructType, value: unknown, words: QueryWords): string {
    const fields = value as Readonly<Record<string, unknown>>;
    const parts = Object.entries(record.fields as Record<string, EastType>)
        .filter(([, type]) => !NESTED_KINDS.has(baseType(type).type))
        .slice(0, SUMMARY_FIELDS)
        .map(([name, type]) => summaryText(type, fields[name], words, name));
    return words.messages.resultJoin({ parts: parts.filter((part): part is string => part !== undefined) });
}

/**
 * A case in a summary: its name, then its payload — a record payload's every
 * field, missing ones left out; a Null payload adds nothing.
 *
 * @param type - the variant's type
 * @param value - the case
 * @param words - the words
 * @returns the case's name and its payload's texts, joined
 */
function caseText(type: VariantType, value: unknown, words: QueryWords): string {
    const chosen = value as variant<string, unknown>;
    const payload = (type.cases as Record<string, EastType>)[chosen.type];
    if (payload === undefined) return chosen.type;
    const node = unwrapRecursive(payload);
    if (node.type === "Null") return chosen.type;
    const parts = node.type === "Struct"
        ? Object.entries(node.fields as Record<string, EastType>).map(([name, fieldType]) => summaryText(fieldType, (chosen.value as Readonly<Record<string, unknown>>)[name], words, name))
        : [summaryText(payload, chosen.value, words, undefined)];
    return words.messages.resultJoin({ parts: [chosen.type, ...parts.filter((part): part is string => part !== undefined)] });
}

// ─── The Table ───────────────────────────────────────────────────────────────

/**
 * A run's result as the value east-ui-components' Table renderer shows
 * (`EastChakraTable`, `Query Editor Spec.md` §4.11): its rows inline,
 * virtualised, under a sticky header, filling the height of the box it is
 * placed in.
 *
 * @param result - the decoded result: its type, and its value
 * @param words - the words: the message table, and the viewer's formatters
 * @returns the Table's value
 *
 * @remarks
 * - **Rows and columns** are {@link resultRows}': one column per field of a
 *   record, headed by its name as a person reads it (`customer ID`), or one
 *   `value` column, headed by the message table's word.
 * - **A cell** holds a primitive value as itself, under its own tag — Null,
 *   Boolean, Integer, Float, String, DateTime, Blob; an option's present
 *   value is its payload. Every other value is a String cell of its words
 *   ({@link cellText}): "—" where it is missing, "3 lines" where it is nested.
 * - **Printing** is the renderer's: no column declares a format, so a number
 *   prints every digit, never grouped — an ID as written, a total exact
 *   (§9) — and a column whose present values are numbers is a number column,
 *   right-aligned in tabular mono, its missing "—" with them.
 *
 * @example
 * ```tsx
 * const { type, value } = decodeBeast2(result.outcome.value.result);
 * const table = resultTable({ type: fromEastTypeValue(type), value }, queryWords(useFormatters()));
 * return <EastChakraTable value={table} storageKey="query-results" />;
 * ```
 */
export function resultTable(result: DecodedResult, words: QueryWords): TableRootValue {
    const { columns, rows } = resultRows(result);
    return {
        rows: variant("inline", rows.map((row): TableRow => ({
            cells: new SortedMap(columns.map((column): [string, TableCell] => [column.key, cellOf(column, row, words)]), compareKeys),
            depth: 0n,
            collapsed: false,
        }))),
        columns: columns.map(column => tableColumn(column, words)),
        frozen: [],
        columnGroups: none,
        footer: none,
        footerRows: none,
        expandedContent: none,
        interactive: none,
        columnResize: none,
        virtualization: some(true),
        density: none,
        rowStatus: none,
        pagination: none,
        selection: none,
        onCellClick: none,
        onCellDoubleClick: none,
        onRowClick: none,
        onRowDoubleClick: none,
        onRowSelectionChange: none,
        onSortChange: none,
        review: none,
        reviewStatus: none,
        reviewApproval: none,
        slice: none,
        style: some({
            // "fill" is the renderer's own word for the height of the box the table is placed in.
            height: some("fill"),
            maxHeight: none,
            variant: none,
            size: none,
            striped: none,
            stickyHeader: some(true),
            showColumnBorder: none,
            colorPalette: none,
            headerBackground: none,
            headerColor: none,
            borderColor: none,
            zebraBackground: none,
            hoverBackground: none,
            selectedBackground: none,
            selectedBorderColor: none,
            footerBackground: none,
            rowHeight: none,
            plotGutter: none,
        }),
    };
}

/**
 * A column of the Table: headed by its field's name as a person reads it, or
 * by the message table's word for the one `value` column, with no format, so
 * the renderer prints its cells exactly.
 *
 * @param column - the result's column
 * @param words - the words
 * @returns the Table's column
 */
function tableColumn(column: ResultColumn, words: QueryWords): TableColumnValue {
    return {
        key: column.key,
        dataType: toEastTypeValue(column.type),
        valueType: toEastTypeValue(cellType(column.type)),
        header: some(column.field === undefined ? words.messages.resultValue() : human(column.field)),
        width: none,
        minWidth: none,
        maxWidth: none,
        render: none,
        format: none,
        aggregate: none,
    };
}

/**
 * The kind of cell a column's present values make: a primitive's own, through
 * its options; String for every value the Table words.
 *
 * @param type - the column's type
 * @returns the cells' type
 */
function cellType(type: EastType): EastType {
    const payload = optionPayload(type);
    if (payload !== undefined) return cellType(payload);
    const t = unwrapRecursive(type);
    return isPrimitiveType(t) && t.type !== "Never" ? t : StringType;
}

/**
 * A row's cell in a column: its words where the Table words its value, else
 * the primitive value itself, under its own tag.
 *
 * @param column - the column
 * @param row - the row, a struct value keyed by column key
 * @param words - the words
 * @returns the cell
 */
function cellOf(column: ResultColumn, row: unknown, words: QueryWords): TableCell {
    return literalOf(column.type, (row as Readonly<Record<string, unknown>>)[column.key], words, column.field);
}

/**
 * A value as a cell: a String of its words where {@link cellText} words it,
 * else the primitive value under its own tag, read through its options.
 *
 * @param type - the value's East type
 * @param value - the value
 * @param words - the words
 * @param field - the field the value sits in, if any
 * @returns the cell
 */
function literalOf(type: EastType, value: unknown, words: QueryWords, field: string | undefined): TableCell {
    const text = cellText(type, value, words, field);
    if (text !== undefined) return variant("String", text);
    const payload = optionPayload(type);
    if (payload !== undefined) {
        // `cellText` words a missing value, so the option holds one here.
        const option = value as option<unknown>;
        return option.type === "some" ? literalOf(payload, option.value, words, field) : variant("String", words.messages.resultMissing());
    }
    const t = unwrapRecursive(type);
    switch (t.type) {
        case "Null": return variant("Null", null);
        case "Boolean": return variant("Boolean", value as boolean);
        case "Integer": return variant("Integer", value as bigint);
        case "Float": return variant("Float", value as number);
        case "String": return variant("String", value as string);
        case "DateTime": return variant("DateTime", value as Date);
        case "Blob": return variant("Blob", value as Uint8Array);
        // A Never value cannot exist; `cellText` worded every other kind.
        default: return variant("String", words.messages.resultMissing());
    }
}
