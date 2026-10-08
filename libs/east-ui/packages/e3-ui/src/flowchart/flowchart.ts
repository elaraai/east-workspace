/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Flowchart>` (#1244) — the tag: one form per source of flows — a record of
 * flows by name, or the host's flows or flow, `data`'s type picking its form —
 * each form's props typed (`Flowchart Builder Spec.md` §4.1, decision 3). A
 * record always holds flows by name (ruled 2026-10-07). Over one flow the
 * library lists every tab but the Flows tab (#1246, FB16) — its templates and
 * the author's tabs, each over its own rows (#1248). No form takes a callback
 * for an edit: the gestures are the editing session's, which Save commits
 * (#1247, FB24). Its payload and every refusal are `payload.ts`'s, and its
 * library's tabs and their refusals `library.ts`'s.
 *
 * @packageDocumentation
 */

import type { StringType, SubtypeExprOrValue } from "@elaraai/east";
import type { UIElement } from "@elaraai/east-ui";
import type { FlowchartSliceOptions } from "./canvas.js";
import type { FlowchartLibraryTab, FlowchartOneFlowLibraryTab } from "./library.js";
import {
    FlowchartComponent,
    createFlowchartPayload,
    type FlowchartBindHandle,
    type FlowchartCommon,
    type FlowchartFlowApplyType,
    type FlowchartFlowsApplyType,
    type FlowchartRecordHandle,
} from "./payload.js";
import type { FlowchartFlowType, FlowchartFlowsType } from "./types.js";

/**
 * `<Flowchart record={flows} flow="Inbound parcels" />` — a record of flows
 * by name, bound with its patch mutation: the canvas shows `flow`, opened
 * first, else the first flow by name. A lone flow is a record of one entry.
 * Every gesture is a draft of the open flow's editing session, and Save
 * commits the drafts as one patch through the record's patch mutation.
 */
export function FlowchartTag(
    props: {
        record: FlowchartRecordHandle;
        /** Over many flows, the one opened first. */
        flow?: SubtypeExprOrValue<StringType>;
        /** The library pane's tabs, in order, each a `Flowchart.library.*` call; left out, or empty, no library pane. */
        library?: readonly FlowchartLibraryTab[];
    } & FlowchartCommon,
): UIElement;
/**
 * `<Flowchart data={flows} />` — the host's flows by name: a value, an
 * expression or a bind handle. Read only unless the host commits its edits
 * through `onApply`: then every gesture is a draft, and Save hands the host
 * one patch of the flows, the open flow's insert, update or delete by name.
 */
export function FlowchartTag(
    props: {
        data: SubtypeExprOrValue<FlowchartFlowsType> | FlowchartBindHandle<FlowchartFlowsType>;
        /** Over many flows, the one opened first. */
        flow?: SubtypeExprOrValue<StringType>;
        /** The host's commit: one patch of the flows, answered as the editing session's Save is. */
        onApply?: SubtypeExprOrValue<FlowchartFlowsApplyType>;
        /** The library pane's tabs, in order, each a `Flowchart.library.*` call; left out, or empty, no library pane. */
        library?: readonly FlowchartLibraryTab[];
    } & FlowchartSliceOptions & FlowchartCommon,
): UIElement;
/**
 * `<Flowchart data={Flowchart.over(states, { … })} />` — the host's one flow:
 * a value, an expression or a bind handle, `Flowchart.over` building it from
 * the host's tables. Read only unless the host commits its edits through
 * `onApply`: then every gesture is a draft, and Save hands the host one patch
 * of the flow. Its library lists no Flows tab: one flow has none to list.
 */
export function FlowchartTag(
    props: {
        data: SubtypeExprOrValue<FlowchartFlowType> | FlowchartBindHandle<FlowchartFlowType>;
        /** The host's commit: one patch of the flow, answered as the editing session's Save is. */
        onApply?: SubtypeExprOrValue<FlowchartFlowApplyType>;
        /** The library pane's tabs, in order — every tab but the Flows tab; left out, or empty, no library pane. */
        library?: readonly FlowchartOneFlowLibraryTab[];
    } & FlowchartSliceOptions & FlowchartCommon,
): UIElement;
export function FlowchartTag(props: object): UIElement {
    return FlowchartComponent.Root(createFlowchartPayload(props));
}

/** The type of `<Flowchart>` as a tag: every form its props take. */
export type FlowchartTagType = typeof FlowchartTag;
