/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Read the first candidate and the active flow, never the whole record. */
import { decodeBeast2For, some, none, type option } from "@elaraai/east";
import { Flowchart } from "@elaraai/e3-ui/internal";
import type { FlowchartValue, FlowchartFlowValue } from "./model.js";

/** Paged record source decoded from the component's payload. */
export type FlowchartPagedRecord = Extract<FlowchartValue["source"], { type: "paged" }>["value"];
const decode = decodeBeast2For(Flowchart.Types.Flow);

/** A confirmed primary-key read, distinct from a list entry absent from the current query. */
export function readFlow(source: FlowchartPagedRecord, name: string): option<option<FlowchartFlowValue>> {
    const read = source.entry(name);
    return read.type === "none" ? none : some(read.value.type === "none" ? none : some(decode(read.value.value)));
}

/** The initial candidate and active flow, with loading and list counts. */
export function readFlowWindow(source: FlowchartPagedRecord, selected: string | undefined): {
    many: true;
    flows: Map<string, FlowchartFlowValue>;
    loading: boolean;
    pendingName: string | undefined;
    count: number | undefined;
} {
    if (source.chrome.type === "some" && source.chrome.value.slice.sourceId !== source.recordId) {
        throw new Error("Flowchart: the window and Slice must read the bound flows record");
    }
    const revision = source.window.revision();
    const count = source.window.total();
    const first = source.window.page(0n, 1n);
    const name = selected ?? (first.type === "some" ? first.value[0]?.name : undefined);
    const active = name === undefined ? some(none) : readFlow(source, name);
    const flows = new Map<string, FlowchartFlowValue>();
    if (first.type === "some") for (const row of first.value) flows.set(row.name, row.flow);
    if (name !== undefined && active.type === "some" && active.value.type === "some") flows.set(name, active.value.value);
    return {
        many: true as const, flows,
        loading: revision.type === "none" || (name === undefined ? first.type === "none" : active.type === "none"),
        pendingName: active.type === "none" ? name : undefined,
        count: count.type === "some" ? Number(count.value) : undefined,
    };
}
