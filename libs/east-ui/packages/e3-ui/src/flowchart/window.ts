/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `flows` source of a flowchart's slice (#1340, #1346): the Flows tab
 * pages the flows its rail narrows the record to, in its index's order, each
 * row keeping the record's primary key — its name — as the flow's identity;
 * the open flow is read by that key, whatever the narrowing; and the tab's own
 * search reads a narrowing of its own through the source's part.
 *
 * @packageDocumentation
 */
import {
    ArrayType, BlobType, East, IntegerType, OptionType, StringType, StructType, FunctionType,
    isTypeEqual, none, printType, some, type ExprType,
} from "@elaraai/east";
import { buildRowSource, resolveRowSource, PinnedSourceType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { FlowchartFlowType } from "./types.js";

/** A list entry retains the record's primary key even when sorted by an index. */
export const FlowchartEntryType = StructType({ name: StringType, flow: FlowchartFlowType });
/** The normalized, snapshot-pinned list of flows. */
export const FlowchartWindowType = PinnedSourceType(ArrayType(FlowchartEntryType));
/** Read by primary identity: outer none is pending; inner none is confirmed absence. */
export const FlowchartReadEntryType = FunctionType([StringType], OptionType(OptionType(BlobType)));
/**
 * A page of the flows a narrowing holds (#1340, ruling 11): the Flows tab's
 * own search — the rail's choices and the search's text — read through the
 * `flows` source's `pageWhere`, never the rail's state; `none` while it is read.
 */
export const FlowchartSearchType = FunctionType([RecordSliceWhereType, IntegerType, IntegerType], OptionType(ArrayType(FlowchartEntryType)));

/** An indexed window's entry, as the `flows` source serves it: the flow's name, and its row joined. */
type FlowEntry = StructType<{ key: StringType; row: OptionType<FlowchartFlowType> }>;

/** The `flows` source's part, as the flowchart reads it: a page of a narrowing, and a flow by its name. */
type FlowsPart = ExprType<StructType<{
    pageWhere: FunctionType<[typeof RecordSliceWhereType, IntegerType, IntegerType], OptionType<ArrayType<FlowEntry>>>;
    readEntry: typeof FlowchartReadEntryType;
}>>;

/**
 * The `flows` source's reads, over the source as the payload's block bound
 * it (#1356): a function captures what it reads, so each holds the `flows`
 * source alone, never the whole slice.
 *
 * @param part - The `flows` source's part of the slice, bound: its `pageWhere`, a narrowing's page, the rail's state unchanged, and its `readEntry`, a flow by its name, whatever the narrowing
 * @param rows - Its narrowed data — `Slice.rows(slice, "flows")` — bound
 * @returns The Flows tab's window, the read of a flow by its name, and the tab's search's page
 * @throws {Error} When the source pages anything but a record of flows by name, its rows joined
 * @internal
 */
export function flowchartWindow(part: ExprType<StructType>, rows: ExprType<StructType>) {
    const resolved = resolveRowSource(rows, "Flowchart.slice's flows");
    const joined = resolved.kind === "ordered" && resolved.elementType.type === "Struct" ? resolved.elementType.fields.row : undefined;
    const flows = resolved.kind === "ordered" && resolved.pinned && isTypeEqual(resolved.keyType, StringType)
        && joined?.type === "Variant" && joined.cases.some !== undefined && isTypeEqual(joined.cases.some, FlowchartFlowType);
    if (!flows) {
        throw new Error(`Flowchart: \`slice\`'s \`flows\` source pages a record of flows by name, Flowchart.Types.Flows, its rows joined — Data.bindPaged(record, { indexes }) over the record \`record\` binds — and this one pages ${printType(resolved.collectionType)}`);
    }
    const entries = (collection: ExprType<ArrayType<FlowEntry>>) => collection.map((_$, entry) => ({ name: entry.key, flow: entry.row.unwrap("some") }));
    const window = buildRowSource(resolved, ArrayType(FlowchartEntryType), (collection) => entries(collection as unknown as ExprType<ArrayType<FlowEntry>>)).unwrap("pinned");
    const search = East.function([RecordSliceWhereType, IntegerType, IntegerType], OptionType(ArrayType(FlowchartEntryType)), ($, where, offset, limit) => {
        const page = $.const((part as unknown as FlowsPart).pageWhere);
        const result = $.let(none, OptionType(ArrayType(FlowchartEntryType)));
        const found = $.let(page(where, offset, limit));
        $.match(found, { some: ($2, held) => { $2.assign(result, some(entries(held))); } });
        return result;
    });
    return { window, entry: (part as unknown as FlowsPart).readEntry, search };
}
