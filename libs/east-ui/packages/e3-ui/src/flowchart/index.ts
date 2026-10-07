/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart (#1243, #1244): the state-transition flowchart, e3-ui's as the
 * Plan (#1177) and the Sheet (#1179) are. `<Flowchart>` takes its flows from
 * an e3 record of flows by name, or from the host — flows by name, or one
 * flow — and returns its payload through the `Flowchart` carrier, which
 * e3-ui-components' renderer draws.
 *
 * - `types.ts` — the flow, the record of flows, and the row, closed-set and
 *   event types (`Flowchart.Types.*`).
 * - `values.ts` — `Flowchart.value` and `Flowchart.values`, a record's value
 *   written as literals and checked when the package builds.
 * - `over.ts` — `Flowchart.over`, one flow from an app's own tables.
 * - `patch.ts` — `Flowchart.patch`, a patch over one of a flow's rows.
 * - `canvas.ts` — the canvas: what the flowchart draws its flow with.
 * - `payload.ts` — the payload, its carrier, the props and their refusals.
 * - `flowchart.ts` — the tag.
 *
 * @packageDocumentation
 */

import { FlowchartTag, type FlowchartTagType } from "./flowchart.js";
import { FlowchartCanvasType } from "./canvas.js";
import { flowchartOver } from "./over.js";
import { FlowchartPatchTypeFor, flowchartPatch } from "./patch.js";
import {
    FlowchartCardType,
    FlowchartComponent,
    FlowchartDataType,
    FlowchartDecisionCardType,
    FlowchartFlowsHandleType,
    FlowchartLandsType,
    FlowchartLaneCardType,
    FlowchartLibraryTabType,
    FlowchartPayloadType,
    FlowchartSourceType,
    FlowchartStateCardType,
    FlowchartTransitionCardType,
    createFlowchartPayload,
} from "./payload.js";
import {
    FlowchartEvidenceType,
    FlowchartFlowType,
    FlowchartFlowsType,
    FlowchartFreshnessType,
    FlowchartLaneRenameEventType,
    FlowchartLaneType,
    FlowchartLinkCreateEventType,
    FlowchartLinkKindType,
    FlowchartLinkModeType,
    FlowchartLinkType,
    FlowchartOrientationType,
    FlowchartStateAddEventType,
    FlowchartStateEditEventType,
    FlowchartStateMoveEventType,
    FlowchartStateType,
    FlowchartTriggerType,
} from "./types.js";
import { flowchartValue, flowchartValues } from "./values.js";

export { FlowchartTag, type FlowchartTagType } from "./flowchart.js";
export {
    FlowchartCanvasType,
    buildCanvas,
    type FlowchartCanvasOptions,
    type FlowchartSliceOptions,
    type FlowchartFreshnessInput,
    type FlowchartOrientationLiteral,
    type FlowchartLinkModeLiteral,
} from "./canvas.js";
export {
    flowchartOver,
    type RowElement,
    type FlowchartTables,
    type FlowchartStateFields,
    type FlowchartLinkFields,
    type FlowchartLaneFields,
    type FlowchartTriggerFields,
    type FlowchartEvidenceFields,
    type FlowchartLaneLiteral,
} from "./over.js";
export { FlowchartPatchTypeFor, flowchartPatch, type FlowchartRowType, type FlowchartPatchOf, type FlowchartPatchInput } from "./patch.js";
export {
    FlowchartCardType,
    FlowchartComponent,
    FlowchartDataType,
    FlowchartDecisionCardType,
    FlowchartFlowApplyType,
    FlowchartFlowsApplyType,
    FlowchartFlowsHandleType,
    FlowchartHistoryType,
    FlowchartLandsType,
    FlowchartLaneCardType,
    FlowchartLibraryTabType,
    FlowchartPayloadType,
    FlowchartSourceType,
    FlowchartStateCardType,
    FlowchartTransitionCardType,
    createFlowchartPayload,
    type FlowchartBindHandle,
    type FlowchartCommon,
    type FlowchartRecordHandle,
} from "./payload.js";
export {
    flowchartValue,
    flowchartValues,
    type FlowchartFlowInput,
    type FlowchartLaneInput,
    type FlowchartStateInput,
    type FlowchartLinkInput,
    type FlowchartEvidenceInput,
    type FlowchartTriggerInput,
    type FlowchartLinkKindLiteral,
} from "./values.js";

/** The East types a flowchart is written with — `Flowchart.Types`. */
export interface FlowchartTypes {
    /** One flow: its lanes, states, transitions and decisions, and a sentence about it ({@link FlowchartFlowType}). */
    Flow: typeof FlowchartFlowType;
    /** A record of flows, by name ({@link FlowchartFlowsType}). */
    Flows: typeof FlowchartFlowsType;
    /** One state node ({@link FlowchartStateType}). */
    State: typeof FlowchartStateType;
    /** One transition ({@link FlowchartLinkType}). */
    Link: typeof FlowchartLinkType;
    /** One ordered phase band ({@link FlowchartLaneType}). */
    Lane: typeof FlowchartLaneType;
    /** One decision trigger ({@link FlowchartTriggerType}). */
    Trigger: typeof FlowchartTriggerType;
    /** Imported link evidence ({@link FlowchartEvidenceType}). */
    Evidence: typeof FlowchartEvidenceType;
    /** Link kind — planned | observed ({@link FlowchartLinkKindType}). */
    Kind: typeof FlowchartLinkKindType;
    /** Canvas orientation — LR | TD ({@link FlowchartOrientationType}). */
    Orientation: typeof FlowchartOrientationType;
    /** Link-authoring mode — draw | connect ({@link FlowchartLinkModeType}). */
    LinkMode: typeof FlowchartLinkModeType;
    /** Eyebrow freshness chip ({@link FlowchartFreshnessType}). */
    Freshness: typeof FlowchartFreshnessType;
    /** Link-creation event ({@link FlowchartLinkCreateEventType}). */
    LinkCreateEvent: typeof FlowchartLinkCreateEventType;
    /** Lane-rename event ({@link FlowchartLaneRenameEventType}). */
    LaneRenameEvent: typeof FlowchartLaneRenameEventType;
    /** State-add event ({@link FlowchartStateAddEventType}). */
    StateAddEvent: typeof FlowchartStateAddEventType;
    /** State-edit event ({@link FlowchartStateEditEventType}). */
    StateEditEvent: typeof FlowchartStateEditEventType;
    /** State-move event ({@link FlowchartStateMoveEventType}). */
    StateMoveEvent: typeof FlowchartStateMoveEventType;
    /** `Patch(R)` — a patch over one of a flow's rows, every field an `Option` ({@link FlowchartPatchTypeFor}). */
    Patch: typeof FlowchartPatchTypeFor;
}

/** The East types a flowchart is written with. */
const TYPES: FlowchartTypes = {
    Flow: FlowchartFlowType,
    Flows: FlowchartFlowsType,
    State: FlowchartStateType,
    Link: FlowchartLinkType,
    Lane: FlowchartLaneType,
    Trigger: FlowchartTriggerType,
    Evidence: FlowchartEvidenceType,
    Kind: FlowchartLinkKindType,
    Orientation: FlowchartOrientationType,
    LinkMode: FlowchartLinkModeType,
    Freshness: FlowchartFreshnessType,
    LinkCreateEvent: FlowchartLinkCreateEventType,
    LaneRenameEvent: FlowchartLaneRenameEventType,
    StateAddEvent: FlowchartStateAddEventType,
    StateEditEvent: FlowchartStateEditEventType,
    StateMoveEvent: FlowchartStateMoveEventType,
    Patch: FlowchartPatchTypeFor,
};

/**
 * The type of the {@link Flowchart} namespace: `<Flowchart>`, the values and
 * patches a flowchart is written with, and its East types.
 */
export interface FlowchartNamespace extends FlowchartTagType {
    /** One flow's value — written as a literal and checked when the package builds ({@link flowchartValue}). */
    value: typeof flowchartValue;
    /** A record of flows' value, by name — each flow written as a literal and checked when the package builds ({@link flowchartValues}). */
    values: typeof flowchartValues;
    /** One flow built from an app's own tables, through their row mappers ({@link flowchartOver}). */
    over: typeof flowchartOver;
    /** A patch over one of a flow's rows ({@link flowchartPatch}). */
    patch: typeof flowchartPatch;
    /** The East types a flowchart is written with ({@link FlowchartTypes}). */
    Types: FlowchartTypes;
}

/** The namespace's members — everything `Flowchart` carries beside the tag itself. */
const MEMBERS = {
    value: flowchartValue,
    values: flowchartValues,
    over: flowchartOver,
    patch: flowchartPatch,
    Types: TYPES,
};

/**
 * `<Flowchart>` — the state-transition flowchart: states as nodes in ordered
 * phase lanes (the layout derived, no coordinates), H/V-routed transitions,
 * decision triggers (lettered diamonds) and evidence-weighted strokes. Hover
 * cards, the selection and the pointer-highlight grammar are built in.
 *
 * @remarks
 * - **Its flows** are an e3 record's (`record`): `Flowchart.Types.Flows`,
 *   flows by name, bound with its patch mutation, the canvas showing `flow`,
 *   else the first by name. A record always holds flows by name (ruled
 *   2026-10-07: e3's patch mutation writes only keyed records), so a lone flow
 *   is a record of one entry. Or they are the host's (`data`): flows by name
 *   or one flow — a value, an expression or a bind handle — the value's type
 *   picking the arm, one prop taking either; `Flowchart.over` builds one flow
 *   from the host's own tables through their row mappers, and `slice`
 *   narrows what it builds.
 * - **A dataset's value** is written as literals with `Flowchart.values`
 *   (flows by name) or `Flowchart.value` (one flow), checked when the package
 *   builds.
 * - **Interaction** is opt-in per channel: selection (`onSelectState`,
 *   `onSelectLink`, `onSelectTrigger`), path tracing (`onTracePath`), link
 *   authoring (`linkMode`, `onCreateLink`, `onDeleteLink`, `canConnect`) and
 *   lane and state editing (`onAddLane`, `onRenameLane`, `onDeleteLane`,
 *   `onAddState`, `onEditState`, `onMoveState`).
 * - **Refused when the surface is built**, each naming the prop and the
 *   remedy: flows from both `record` and `data`, or neither; `onApply`,
 *   `slice` or `affordances` over a record; `flow` over one flow; a record of
 *   one flow, or of another type, or not bound with its patch mutation;
 *   `"brush"` among the affordances.
 *
 * The closed-set fields in data (`kind`, `orientation`, `linkMode`) are typed
 * variant values, `Flowchart.Types.*`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Flowchart, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const depotFlows = e3.record("flowchart_depot_flows", Flowchart.Types.Flows, Flowchart.values({
 *     "Inbound parcels": {
 *         description: "From the trailer to the van",
 *         lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }],
 *         states: [
 *             { key: "ARV", label: "Arrived", lane: "intake" },
 *             { key: "SCN", label: "Scanned", lane: "intake" },
 *             { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
 *             { key: "LDD", label: "Loaded", lane: "load" },
 *         ],
 *         links: [
 *             { from: "ARV", to: "SCN" },
 *             { from: "SCN", to: "CH*", trigger: "route" },
 *             { from: "CH*", to: "LDD" },
 *             { from: "SCN", to: "SCN", kind: "observed" },
 *         ],
 *         triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
 *     },
 *     "Returns": {
 *         description: "From the counter back to the sender",
 *         lanes: [{ key: "counter", label: "Counter" }, { key: "check", label: "Check" }, { key: "out", label: "Out" }],
 *         states: [
 *             { key: "RCV", label: "Received", lane: "counter" },
 *             { key: "INS", label: "Inspected", lane: "check" },
 *             { key: "RSD", label: "Resent", lane: "out" },
 *         ],
 *         links: [{ from: "RCV", to: "INS" }, { from: "INS", to: "RSD" }, { from: "INS", to: "BIN", kind: "observed" }],
 *     },
 * }));
 * export const depotFlowsPatch = e3.mutation.patch(depotFlows);
 *
 * const flowchart = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
 *         return <Box height="480px"><Flowchart record={flows} flow="Inbound parcels" /></Box>;
 *     }}</Reactive>
 * ));
 * ```
 */
export const Flowchart: FlowchartNamespace = Object.assign(FlowchartTag, MEMBERS);

/**
 * The type of the internal Flowchart namespace — the public one, the payload
 * the tag returns through its carrier, the carrier the renderer registers
 * against, and the payload's own East types.
 */
export interface FlowchartInternalNamespace extends FlowchartNamespace {
    /** Creates the flowchart's payload alone — what `<Flowchart>` returns through the `Flowchart` carrier ({@link createFlowchartPayload}). */
    Payload: typeof createFlowchartPayload;
    /** The `Flowchart` carrier ({@link FlowchartComponent}). */
    Component: typeof FlowchartComponent;
    /** The East types a flowchart is written with, and its payload's. */
    Types: FlowchartTypes & {
        /** The renderer's payload ({@link FlowchartPayloadType}). */
        Payload: typeof FlowchartPayloadType;
        /** What the canvas draws its flow with ({@link FlowchartCanvasType}). */
        Canvas: typeof FlowchartCanvasType;
        /** Where the flows come from ({@link FlowchartSourceType}). */
        Source: typeof FlowchartSourceType;
        /** The host's flows ({@link FlowchartDataType}). */
        Data: typeof FlowchartDataType;
        /** A record of flows, bound ({@link FlowchartFlowsHandleType}). */
        FlowsHandle: typeof FlowchartFlowsHandleType;
        /** One tab of the library ({@link FlowchartLibraryTabType}). */
        LibraryTab: typeof FlowchartLibraryTabType;
        /** An author's tab's cards, by what they land on ({@link FlowchartLandsType}). */
        Lands: typeof FlowchartLandsType;
        /** A card that drops nothing ({@link FlowchartCardType}). */
        Card: typeof FlowchartCardType;
        /** A state template's card ({@link FlowchartStateCardType}). */
        StateCard: typeof FlowchartStateCardType;
        /** A transition template's card ({@link FlowchartTransitionCardType}). */
        TransitionCard: typeof FlowchartTransitionCardType;
        /** An author's card that lands on a lane ({@link FlowchartLaneCardType}). */
        LaneCard: typeof FlowchartLaneCardType;
        /** An author's card that lands on a decision ({@link FlowchartDecisionCardType}). */
        DecisionCard: typeof FlowchartDecisionCardType;
    };
}

/** `<Flowchart>`, for the internal namespace: the tag, on an object of its own, so the public `Flowchart` carries none of the internal members. */
function FlowchartInternalTag(props: object): ReturnType<FlowchartTagType> {
    return (FlowchartTag as (p: object) => ReturnType<FlowchartTagType>)(props);
}

/**
 * The internal Flowchart namespace — `@elaraai/e3-ui/internal`'s `Flowchart`:
 * the public one, `Flowchart.Payload`, the `Flowchart` carrier and the
 * payload's types, for the renderer and the tests.
 *
 * @internal
 */
export const FlowchartInternal: FlowchartInternalNamespace = Object.assign(FlowchartInternalTag as FlowchartTagType, MEMBERS, {
    Payload: createFlowchartPayload,
    Component: FlowchartComponent,
    Types: {
        ...TYPES,
        Payload: FlowchartPayloadType,
        Canvas: FlowchartCanvasType,
        Source: FlowchartSourceType,
        Data: FlowchartDataType,
        FlowsHandle: FlowchartFlowsHandleType,
        LibraryTab: FlowchartLibraryTabType,
        Lands: FlowchartLandsType,
        Card: FlowchartCardType,
        StateCard: FlowchartStateCardType,
        TransitionCard: FlowchartTransitionCardType,
        LaneCard: FlowchartLaneCardType,
        DecisionCard: FlowchartDecisionCardType,
    },
});
