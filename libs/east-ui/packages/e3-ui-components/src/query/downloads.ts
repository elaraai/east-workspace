/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Downloads (#938) — a run's result saved as a file (`Query Editor Spec.md`
 * §4.11), named after the query (`top-shipped-orders-2026.csv`):
 *
 * - **CSV** ("table"): the rows the Table shows, one row per output, through
 *   East's CSV (`encodeCsvFor` over the row type, RFC 4180 quoting): a value
 *   CSV holds as itself — a number, a date, text, an option of one — and a
 *   nested value as the words the Table shows for it;
 * - **BEAST2** ("typed"): the result with its type, self-describing.
 *
 * Each goes through east-ui-components' `downloadFile`, the save the
 * `Download` platform functions use.
 *
 * @packageDocumentation
 */

import { OptionType, StringType, StructType, encodeBeast2For, encodeCsvFor, none, some, type EastType, type option } from "@elaraai/east";
import { downloadFile } from "@elaraai/east-ui-components";
import { countWords, type QueryWords } from "./model/words.js";
import { resultFileName, type DownloadFormat } from "./results.js";
import { cellText, resultRows } from "./results-table.js";
import type { RunOutput, RunState } from "./run.js";
import { optionPayload } from "./steps/shape.js";

/** The types a CSV cell holds as itself. */
const CSV_KINDS: ReadonlySet<string> = new Set(["Never", "Null", "Boolean", "Integer", "Float", "String", "DateTime", "Blob"]);

/** How a column goes into the CSV: as itself, as its words, or an option of its payload's words. */
type CsvColumn = { readonly type: EastType; readonly words: "none" | "value" | "payload" };

/** A column as the CSV holds it: its own type where CSV holds it, else its words — an option's payload's too. */
function csvColumn(type: EastType): CsvColumn {
    if (CSV_KINDS.has(type.type)) return { type, words: "none" };
    const payload = optionPayload(type);
    if (payload !== undefined) return CSV_KINDS.has(payload.type) ? { type, words: "none" } : { type: OptionType(StringType), words: "payload" };
    return { type: StringType, words: "value" };
}

/**
 * A result's rows as CSV: one row per output, its header the fields' names.
 *
 * @param output - the run's result
 * @param words - the words, for a nested value
 * @returns the CSV's bytes, UTF-8
 */
export function resultCsv(output: RunOutput, words: QueryWords): Uint8Array {
    const { columns, rows } = resultRows({ type: output.type, value: output.value });
    const shaped = columns.map(c => ({ ...c, csv: csvColumn(c.type) }));
    const RowType = StructType(Object.fromEntries(shaped.map(c => [c.key, c.csv.type])));
    const cells = rows.map(row => Object.fromEntries(shaped.map((c): [string, unknown] => {
        const value = (row as Readonly<Record<string, unknown>>)[c.key];
        switch (c.csv.words) {
            case "none":
                return [c.key, value];
            case "value":
                return [c.key, cellText(c.type, value, words, c.field) ?? ""];
            case "payload": {
                const held = value as option<unknown>;
                return [c.key, held.type === "some" ? some(cellText(optionPayload(c.type)!, held.value, words, c.field) ?? "") : none];
            }
        }
    })));
    return encodeCsvFor(RowType)(cells as never);
}

/**
 * A result with its type, self-describing beast2: what the run returned.
 *
 * @param output - the run's result
 * @returns the bytes
 */
export function resultBeast2(output: RunOutput): Uint8Array {
    return encodeBeast2For(output.type)(output.value as never);
}

/**
 * Downloads a run's result, and says so.
 *
 * @param run - the run, answered with a result
 * @param format - CSV or BEAST2
 * @param name - the query's name: the file's
 * @param words - the words
 * @returns the note the results show after it; `undefined` when the run has no result
 */
export function downloadResult(run: RunState, format: DownloadFormat, name: string, words: QueryWords): string | undefined {
    if (run.status !== "done" || run.output === undefined) return undefined;
    const output = run.output;
    const file = `${resultFileName(name)}.${format === "csv" ? "csv" : "beast2"}`;
    if (format === "csv") downloadFile(file, "text/csv;charset=utf-8", resultCsv(output, words));
    else downloadFile(file, "application/octet-stream", resultBeast2(output));
    // One row per output, as the CSV writes them.
    const n = resultRows({ type: output.type, value: output.value }).rows.length;
    const shape = run.plan.shape;
    const count = shape?.kind === "rows" ? countWords(shape, n, words) : words.messages.rowCount({ count: words.formatters.number(n), n });
    return words.messages.downloaded({ format, file, count });
}
