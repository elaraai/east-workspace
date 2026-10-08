/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart (#1243–#1250): the state-transition flowchart, e3-ui's as the
 * Plan (#1177) and the Sheet (#1179) are. `<Flowchart>` takes its flows from
 * an e3 record of flows by name, or from the host — flows by name, or one
 * flow — and returns its payload through the `Flowchart` carrier, which
 * e3-ui-components' renderer draws in its builder frame and edits through its
 * editing session.
 *
 * - `types.ts` — the flow, the record of flows, and the row and closed-set
 *   types (`Flowchart.Types.*`).
 * - `values.ts` — `Flowchart.value` and `Flowchart.values`, a record's value
 *   written as literals and checked when the package builds.
 * - `over.ts` — `Flowchart.over`, one flow from an app's own tables.
 * - `patch.ts` — `Flowchart.patch`, a patch over one of a flow's rows.
 * - `library.ts` — `Flowchart.library`, the library pane's tabs — the Flows
 *   tab, the state and transition templates and the author's tabs, each
 *   reading its own rows — and their wire.
 * - `canvas.ts` — the canvas: what the flowchart draws its flow with.
 * - `payload.ts` — the payload, its carrier, the shared keys, the props and
 *   their refusals.
 * - `flowchart.ts` — the tag.
 *
 * @packageDocumentation
 */

import { FlowchartTag, type FlowchartTagType } from "./flowchart.js";
import { FlowchartCanvasType } from "./canvas.js";
import {
    FlowchartCardType,
    FlowchartDecisionCardType,
    FlowchartLandsType,
    FlowchartLaneCardType,
    FlowchartLibraryFactories,
    FlowchartLibraryTabType,
    FlowchartStateCardType,
    FlowchartTransitionCardType,
    type FlowchartLibrary,
} from "./library.js";
import { flowchartOver } from "./over.js";
import { FlowchartPatchTypeFor, flowchartPatch } from "./patch.js";
import {
    FlowchartComponent,
    FlowchartDataType,
    FlowchartFlowsHandleType,
    FlowchartInspectorType,
    FlowchartPayloadType,
    FlowchartSessionApplyType,
    FlowchartSourceType,
    createFlowchartPayload,
} from "./payload.js";
import {
    FlowchartEvidenceType,
    FlowchartFlowType,
    FlowchartFlowsType,
    FlowchartFreshnessType,
    FlowchartLaneType,
    FlowchartLinkKindType,
    FlowchartLinkType,
    FlowchartOrientationType,
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
    FlowchartDecisionCardType,
    FlowchartLandsType,
    FlowchartLaneCardType,
    FlowchartLibraryFactories,
    FlowchartLibraryTabType,
    FlowchartStateCardType,
    FlowchartTransitionCardType,
    libraryFlows,
    libraryStates,
    libraryTab,
    libraryTransitions,
    type FlowchartAuthorTab,
    type FlowchartCardAccessors,
    type FlowchartFlowsTab,
    type FlowchartLibrary,
    type FlowchartLibraryRows,
    type FlowchartLibraryTab,
    type FlowchartOneFlowLibraryTab,
    type FlowchartStatesConfig,
    type FlowchartStatesTab,
    type FlowchartTabConfig,
    type FlowchartTransitionsConfig,
    type FlowchartTransitionsTab,
} from "./library.js";
export {
    FlowchartComponent,
    FlowchartDataType,
    FlowchartFlowApplyType,
    FlowchartFlowsApplyType,
    FlowchartFlowsHandleType,
    FlowchartHistoryType,
    FlowchartInspectorType,
    FlowchartPayloadType,
    FlowchartSessionApplyType,
    FlowchartSourceType,
    createFlowchartPayload,
    flowchartKeys,
    type FlowchartBindHandle,
    type FlowchartCommon,
    type FlowchartInspectorOptions,
    type FlowchartRecordHandle,
    type FlowchartRowInspector,
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
    /** The toolbar's freshness chip ({@link FlowchartFreshnessType}). */
    Freshness: typeof FlowchartFreshnessType;
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
    Freshness: FlowchartFreshnessType,
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
    /** The library pane's tabs, each a factory `library` lists ({@link FlowchartLibrary}). */
    library: FlowchartLibrary;
    /** The East types a flowchart is written with ({@link FlowchartTypes}). */
    Types: FlowchartTypes;
}

/** The namespace's members — everything `Flowchart` carries beside the tag itself. */
const MEMBERS = {
    value: flowchartValue,
    values: flowchartValues,
    over: flowchartOver,
    patch: flowchartPatch,
    library: FlowchartLibraryFactories,
    Types: TYPES,
};

/**
 * `<Flowchart>` — the state-transition flowchart: states as nodes in ordered
 * phase lanes (the layout derived, no coordinates), H/V-routed transitions,
 * decision triggers (lettered diamonds) and evidence-weighted strokes. The
 * selection — a state, a transition, a decision, a lane by its header, or
 * several states — and the pointer-highlight grammar are built in, and the
 * inspector shows what is selected.
 *
 * @remarks
 * - **Its frame**: it renders in its builder frame wherever it is used — one
 *   toolbar (find state, LR · TD, the freshness chip and, over `data`, the
 *   slice's rail; over a record, the history item), the canvas filling main
 *   and scrolling both ways inside it, and the footer's counts; a library pane
 *   when `library` lists tabs, and the inspector pane unless
 *   `inspector={false}`. It fills the box it is given and draws no border:
 *   give it a box of its own height.
 * - **Its inspector** (#1250, on by default, ruled by the user on
 *   2026-10-08): the end pane, Details and Issues — Issues with its count, and
 *   collapsed a rail with its icon and the issue count. Details shows what is
 *   selected through its form, every field by the shared input its type
 *   takes: a state (its key — a new one rekeying its transitions and the
 *   decisions' queues — label, lane, members and notes; its transitions in and
 *   out, each selecting it; Duplicate, Delete), a transition (its ends, its
 *   kind, its decision and its key; its evidence read only; Delete), a
 *   decision (its fields, its queue as tags over the flow's states; the
 *   transitions it governs; Delete), a lane — a click on its header selects
 *   it — (its key, which moves its states, and its label; its states' count;
 *   Delete while it holds none), several states (their count; moved to a
 *   lane, or deleted, together) or, with nothing selected, the open flow (its
 *   name and description — a new name renames it — Duplicate and Delete over
 *   many flows; its counts, its last save and who made it, and three hints).
 *   Each edit is one transaction, a field the drafts changed tinted against
 *   the record; read only, Details shows every field and edits none. Issues
 *   lists a transition naming a missing state, a state naming a missing lane,
 *   two of one key — which holds Save off — a decision's queue naming a
 *   missing state, and a Save's conflict or refusal, a click selecting what
 *   each names. `inspector={{ state, transition }}` gives a kind its own
 *   Details in place of its form: an East function over the row and its
 *   writer, `update` writing the edited row back as one transaction. The
 *   hover cards went: the inspector is where details live.
 * - **Its open flow**, over many flows: `flow`, else the first by name, until
 *   the viewer opens another — from the Flows tab
 *   (`Flowchart.library.flows()`), which lists every flow by name — kept in
 *   the UI store under its `name`, so a remount opens it again; a `flow` it
 *   doesn't hold is named in a banner above main. LR · TD is the viewer's
 *   too, kept under its `name`. Where it edits, "+ New flow" names a new
 *   flow, opened empty with one lane; each flow keeps its own drafts until
 *   the history item saves or discards them.
 * - **Its library** (#1248): the tabs `library` lists, in its order, each with
 *   its count and a search — the Flows tab; state templates
 *   (`Flowchart.library.states(rows, …)`) and transition templates
 *   (`Flowchart.library.transitions(rows, …)`), each card a drag source; and
 *   the author's own cards (`Flowchart.library.tab(rows, …)`), a drag source
 *   when the tab declares a `drop`. Each data tab reads its own rows — an
 *   input's or a record's, an Array or a `Dict<String, T>` — apart from the
 *   flows and from the other tabs. A click selects a card, and a click on the
 *   selected card lets it go; an empty tab says so in the shared empty state.
 * - **Its drops** (#1249): a card carried onto the canvas lands where its tab
 *   says — a state template on a lane, adding a state at the row under the
 *   pointer, its key the drop's, made unique or minted; a transition template
 *   on a transition, retyping it; an author's card on what its drop's type
 *   names — the ghost saying where, or, red, why not. ⏎ on a card drops it on
 *   the canvas's selection, and on a touch screen so does a tap on the
 *   selected card. Each drop is one transaction of the open flow's session.
 * - **Its edits** are its editing session's (#1247): over a record, and over
 *   `data` given `onApply`, every gesture — "+ LANE", a lane's header
 *   double-clicked into its rename (a click selects the lane, #1250) or its ×
 *   (off while the lane holds states), the "+ STATE" ghost, a state
 *   double-clicked into its editor (a new key rekeys its transitions and the
 *   decisions' queues) or dragged across lanes, a handle dragged to another
 *   state, Del on the selected state, states, transition, decision or empty
 *   lane, and every edit the inspector makes — is one transaction the history
 *   item undoes and redoes (⌘Z, ⇧⌘Z or ⌘Y anywhere in the frame but a field
 *   being typed into), and Save sends the open flow's drafts as one commit:
 *   through the record's patch mutation, or as one patch of `data`'s value to
 *   the host's `onApply`. Two lanes, states, transitions or decisions of one
 *   key hold Save off. The footer counts the changes waiting on Save.
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
 * - **The host hears** the selection (`onSelectState`, `onSelectLink`,
 *   `onSelectTrigger`) and a traced path (`onTracePath`), and vetoes a
 *   connection with `canConnect`.
 * - **Refused when the surface is built**, each naming the prop and the
 *   remedy: flows from both `record` and `data`, or neither; `onApply`,
 *   `slice` or `affordances` over a record; `flow` over one flow; a record of
 *   one flow, or of another type, or not bound with its patch mutation;
 *   `"brush"` among the affordances; `height` or `maxHeight`, which the box
 *   it fills sets; a callback for an edit (`onAddState`, `onCreateLink`, …)
 *   or `linkMode`, which the session's gestures replace; a hover card's
 *   builder (`stateHover`, `linkHover`, `triggerHover`), which the inspector
 *   replaces; an `inspector` of another kind than a Boolean or `{ state,
 *   transition }`, a key other than those two, or a kind's own Details of
 *   another type than `(Row, (Row) => Null) => UIComponentType`; a library
 *   that lists a tab twice — the Flows tab or a template tab, or two of the
 *   author's tabs of one name — or the Flows tab over one flow; a data tab
 *   whose rows are neither an Array nor a `Dict<String, T>`; a `states` drop
 *   over another type than a state's patch, a `transitions` drop over another
 *   than a transition's, and a `tab` drop over none of a flow's row types.
 *
 * The closed-set fields in data (`kind`, `orientation`) are typed variant
 * values, `Flowchart.Types.*`.
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
 *         return (
 *             <Box height="500px">
 *                 <Flowchart record={flows} flow="Inbound parcels" library={[Flowchart.library.flows()]} />
 *             </Box>
 *         );
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
        /** The editing session's Save, over a record or the host's flows ({@link FlowchartSessionApplyType}). */
        SessionApply: typeof FlowchartSessionApplyType;
        /** The inspector pane: each kind's own Details ({@link FlowchartInspectorType}). */
        Inspector: typeof FlowchartInspectorType;
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
        SessionApply: FlowchartSessionApplyType,
        Inspector: FlowchartInspectorType,
        LibraryTab: FlowchartLibraryTabType,
        Lands: FlowchartLandsType,
        Card: FlowchartCardType,
        StateCard: FlowchartStateCardType,
        TransitionCard: FlowchartTransitionCardType,
        LaneCard: FlowchartLaneCardType,
        DecisionCard: FlowchartDecisionCardType,
    },
});
