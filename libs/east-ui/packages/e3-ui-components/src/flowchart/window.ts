/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record of flows paged through its slice's `flows` source (#1346): the
 * first flow the rail narrows the record to, and the open flow, read by its
 * name whatever the narrowing — never the whole record.
 *
 * @packageDocumentation
 */
import { StringType, decodeBeast2For, equalFor, some, none, type option, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import type { FlowchartValue, FlowchartFlowValue } from "./model.js";

/** Paged record source decoded from the component's payload. */
export type FlowchartPagedRecord = Extract<FlowchartValue["source"], { type: "paged" }>["value"];
const decode = decodeBeast2For(Flowchart.Types.Flow);
const idEqual = equalFor(StringType);

/** A confirmed primary-key read, distinct from a list entry absent from the current query. */
export function readFlow(source: FlowchartPagedRecord, name: string): option<option<FlowchartFlowValue>> {
    const read = source.entry(name);
    return read.type === "none" ? none : some(read.value.type === "none" ? none : some(decode(read.value.value)));
}

/**
 * The first flow the rail narrows the record to, and the open flow, read by
 * its name, with whether either is still being read.
 *
 * @param source - The paged record
 * @param selected - The open flow's name, if one is open
 * @param flows - The slice's `flows` source's part: it pages the record `record` binds
 * @returns The flows read, by name, whether the reads are pending, and the open flow's name while its read is
 * @throws {Error} When the `flows` source pages another record than the one `record` binds
 */
export function readFlowWindow(source: FlowchartPagedRecord, selected: string | undefined, flows: ValueTypeOf<RecordSliceBindType> | undefined): {
    many: true;
    flows: Map<string, FlowchartFlowValue>;
    loading: boolean;
    pendingName: string | undefined;
} {
    if (flows !== undefined && !idEqual(flows.sourceId, source.recordId)) {
        throw new Error("Flowchart: the slice's `flows` source pages another record than `record` binds — page the same record: Data.bindPaged(record, { indexes })");
    }
    const revision = source.window.revision();
    const first = source.window.page(0n, 1n);
    const name = selected ?? (first.type === "some" ? first.value[0]?.name : undefined);
    const active = name === undefined ? some(none) : readFlow(source, name);
    const read = new Map<string, FlowchartFlowValue>();
    if (first.type === "some") for (const row of first.value) read.set(row.name, row.flow);
    if (name !== undefined && active.type === "some" && active.value.type === "some") read.set(name, active.value.value);
    return {
        many: true as const, flows: read,
        loading: revision.type === "none" || (name === undefined ? first.type === "none" : active.type === "none"),
        pendingName: active.type === "none" ? name : undefined,
    };
}
