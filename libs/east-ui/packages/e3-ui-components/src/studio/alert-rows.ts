/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An alert's rows, as the Table shows them (#1674): the rows of its visual
 * that meet its condition — Now, in its editor, and the rows a firing kept,
 * under its banner's Show rows. Each column stands under its field's name, as
 * the condition's rows say it — `mean margin` — and its numbers print as the
 * visual's own tables print them (`visual/values.ts`), never every digit of a
 * float: a value in its own format, else its field's — a currency's amounts
 * grouped, one of no format grouped to two decimals at most — and a records
 * table's column in its field's, one of no format exactly, as its table
 * prints it.
 *
 * One number is said closer than a tile says it: a share, to two decimals. The
 * rows are what a condition is read against, and a tile's whole percents would
 * say `19%` of a row that is under 19%.
 *
 * A number printed whole is also what lets a narrow Table — the builder's
 * inspector's — stand a row's columns side by side: a number's column is never
 * cut, so a float's every digit took the room of two columns.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { none, some, variant, type option } from "@elaraai/east";
import type { TableRootValue, TickFormatOpt, ValueFormat } from "@elaraai/east-ui-components";
import type { QueryWords } from "../query/model/words.js";
import { resultRows, rowsTable, type DecodedResult, type ResultColumn } from "../query/results-table.js";
import type { AlertField } from "../query/visual/alert.js";
import { visualValues } from "../query/visual/print.js";
import type { StudioMessages } from "./messages.js";
import { recordsOf } from "./visual/records-table.js";
import { columnHead, valueFieldFormat, valueUnit, type Visual, type VisualSource } from "./visual/values.js";

/** A share as an alert's rows say it: a percent to two decimals — `18.65%`. */
const SHARE_FORMAT: TickFormatOpt = variant("percent", { minimumFractionDigits: none, maximumFractionDigits: some(2n), signDisplay: none });

/** Whether a declared format is a share's. */
function isShare(declared: option<ValueFormat>): boolean {
    return declared.type === "some" && declared.value.type === "percent";
}

/**
 * How one field of an alert's rows prints: a value as a table prints a value,
 * a records table's column as it prints a field, a share closer; a group's key
 * and an extra as they are.
 *
 * @param field - The field, as the alert's rows hold it
 * @param visual - The visual
 * @param source - Its source: the fields' formats
 * @param m - The Studio's words
 * @returns Its numbers' format; `undefined` prints them as they are
 */
function formatOf(field: AlertField, visual: Visual, source: VisualSource, m: StudioMessages): TickFormatOpt {
    switch (field.kind) {
        case "value": {
            const value = visualValues(visual.view)[field.index];
            if (value === undefined) return undefined;
            return isShare(valueFieldFormat(value, source)) ? SHARE_FORMAT : valueUnit(value, source).format;
        }
        case "column": {
            const id = recordsOf(visual)?.columns[field.index];
            if (id === undefined) return undefined;
            return isShare(source.fields.find((listed) => listed.id === id)?.format ?? none) ? SHARE_FORMAT : columnHead(source, id, m).format;
        }
        case "group": case "extra":
            return undefined;
    }
}

/**
 * The columns of an alert's rows, each with its numbers' format: a column the
 * alert's fields name, in its field's; any other as it is.
 *
 * @param columns - The rows' columns, as their type gives them
 * @param visual - The alert's visual; `undefined` for one its page no longer holds
 * @param source - Its source, as the surface lists it; `undefined` for one it does not
 * @param fields - The fields of the rows the alert checks (`printAlert`, `alertRowsStage`)
 * @param m - The Studio's words
 * @returns The columns, in order
 */
export function alertRowColumns(
    columns: readonly ResultColumn[], visual: Visual | undefined, source: VisualSource | undefined, fields: readonly AlertField[], m: StudioMessages,
): ResultColumn[] {
    return columns.map((column): ResultColumn => {
        const field = fields.find((held) => held.name === column.key);
        const format = field === undefined || visual === undefined || source === undefined ? undefined : formatOf(field, visual, source, m);
        return { ...column, format };
    });
}

/**
 * An alert's rows as the Table's value, in {@link alertRowColumns}: with no
 * visual or no source to read the formats from, each number as it is.
 *
 * @param rows - The rows, decoded: an Array of one struct of the alert's fields — a check's answer, or what a firing kept
 * @param visual - The alert's visual; `undefined` for one its page no longer holds
 * @param source - Its source, as the surface lists it; `undefined` for one it does not
 * @param fields - The fields of the rows the alert checks
 * @param words - The words: the query builder's, and the viewer's formatters
 * @param m - The Studio's words
 * @returns The Table's value
 *
 * @example
 * ```tsx
 * const printed = printAlert(visual, read, state, condition);
 * const table = alertRowsTable({ type: ArrayType(StructType([...answer.columns])), value: answer.rows }, visual, source, printed.fields, words, m);
 * return <EastChakraTable value={table} storageKey="studio.alert.now" tile />;
 * ```
 */
export function alertRowsTable(
    rows: DecodedResult, visual: Visual | undefined, source: VisualSource | undefined, fields: readonly AlertField[], words: QueryWords, m: StudioMessages,
): TableRootValue {
    const read = resultRows(rows);
    return rowsTable(alertRowColumns(read.columns, visual, source, fields, m), read.rows, words);
}
