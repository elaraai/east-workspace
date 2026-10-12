/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Paged flow records: preserve index order in the list and primary identity in edits. */
import {
    ArrayType, BlobType, East, OptionType, StringType, StructType, FunctionType,
    isTypeEqual, none, some, variant, type ExprType,
} from "@elaraai/east";
import {
    buildRowSource, resolveRowSource, PinnedSourceType,
    RecordSliceChromeType, recordSliceChrome, type RecordSliceChromeOptions,
} from "@elaraai/east-ui/internal";
import { FlowchartFlowType, FlowchartFlowsType } from "./types.js";

/** A list entry retains the record's primary key even when sorted by an index. */
export const FlowchartEntryType = StructType({ name: StringType, flow: FlowchartFlowType });
/** The normalized, snapshot-pinned list of flows. */
export const FlowchartWindowType = PinnedSourceType(ArrayType(FlowchartEntryType));
/** Read by primary identity: outer none is pending; inner none is confirmed absence. */
export const FlowchartReadEntryType = FunctionType([StringType], OptionType(OptionType(BlobType)));
/** The shared record filter controls, independent of the list's current query. */
export const FlowchartRecordChromeType = OptionType(RecordSliceChromeType);

/**
 * Normalize a record window without reading the whole record.
 * @param window - Data.bindPaged(record), or Slice.rows of its record slice
 * @param slice - Shared record Slice controls; required for an indexed window
 * @returns The window, primary-key reader and optional Slice chrome
 * @throws {Error} When the window does not contain complete, pinned flow entries
 * @internal
 */
export function flowchartWindow(window: unknown, slice: RecordSliceChromeOptions | undefined) {
    const resolved = resolveRowSource(window, "Flowchart");
    const joined = resolved.kind === "ordered" && resolved.elementType.type === "Struct"
        ? resolved.elementType.fields.row : undefined;
    const indexed = resolved.kind === "ordered" && isTypeEqual(resolved.keyType, StringType)
        && joined?.type === "Variant" && joined.cases.some !== undefined
        && isTypeEqual(joined.cases.some, FlowchartFlowType);
    if (resolved.kind === "inline" || !resolved.pinned
        || (!isTypeEqual(resolved.collectionType, FlowchartFlowsType) && !indexed)) {
        throw new Error("Flowchart: `window` must page complete flows from the bound record — Data.bindPaged(record), or Slice.rows(recordSlice) with joined rows");
    }
    if (indexed && slice === undefined) {
        throw new Error("Flowchart: an indexed `window` needs slice={{ slice: recordSlice }} so Save confirms changes by their original record IDs");
    }
    const rowsType = ArrayType(FlowchartEntryType);
    const source = buildRowSource(resolved, rowsType, (collection) => {
        if (!indexed) return (collection as ExprType<FlowchartFlowsType>).toArray((_$, flow, name) => ({ name, flow }));
        const rows = collection as ExprType<ArrayType<StructType<{
            key: StringType; row: OptionType<FlowchartFlowType>;
        }>>>;
        return rows.map((_$, entry) => ({ name: entry.key, flow: entry.row.unwrap("some") }));
    }).unwrap("pinned");
    const chrome = slice === undefined ? undefined : recordSliceChrome(slice);
    const entry = chrome !== undefined ? chrome.slice.readEntry
        : East.function([StringType], OptionType(OptionType(BlobType)), ($, name) => {
            const src = $.const(source);
            const answer = $.let(none, OptionType(OptionType(BlobType)));
            $.match(src.seek, { some: ($, seek) => {
                $.match(seek(variant("key", East.print(name))), { some: ($, found) => {
                    $.if(found.found.not(), ($) => { $.assign(answer, some(none)); });
                    $.if(found.found, ($) => {
                        $.match(src.page(found.row, 1n), { some: ($, rows) => {
                            const flow = $.let(none, OptionType(BlobType));
                            $.for(rows, ($, row) => {
                                $.if(row.name.equal(name), ($) => { $.assign(flow, some(East.Blob.encodeBeast(row.flow, "v2"))); });
                            });
                            $.assign(answer, some(flow));
                        } });
                    });
                } });
            } });
            return answer;
        });
    return { window: source, entry, chrome: chrome === undefined ? none : some(chrome) };
}
