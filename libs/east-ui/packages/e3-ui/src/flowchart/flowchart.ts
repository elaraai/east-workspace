/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Flowchart>` (#1500) — the tag: one flowchart over the app's records — its
 * states, and beside them its transitions, lanes and decisions, each kind's
 * fields mapped to the Flowchart's roles (`Flowchart Records Spec.md` R1) —
 * its narrowing through one `Slice.bindRecords`, its library's tabs and its
 * inspector. Its payload and every refusal are `payload.ts`'s, its kinds'
 * `kinds.ts`'s, and its library's tabs and their refusals `library.ts`'s.
 *
 * @packageDocumentation
 */

import type { UIElement } from "@elaraai/east-ui";
import { FlowchartComponent, createFlowchartPayload, type FlowchartProps } from "./payload.js";

/**
 * `<Flowchart states={Flowchart.states(record, { … })} transitions={…} lanes={…} />`
 * — one flowchart drawn from the app's records: its states in their lanes,
 * the transitions between them and the decisions that govern them, each
 * kind's fields mapped to the Flowchart's roles (R1).
 *
 * @param props - The Flowchart's props ({@link FlowchartProps})
 * @returns The Flowchart: the `Flowchart` carrier over its payload
 */
export function FlowchartTag(props: FlowchartProps): UIElement {
    return FlowchartComponent.Root(createFlowchartPayload(props));
}

/** The type of `<Flowchart>` as a tag. */
export type FlowchartTagType = typeof FlowchartTag;
