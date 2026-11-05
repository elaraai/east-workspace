/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart (#1498): the state-transition flowchart over the app's own
 * records, e3-ui's as the Plan, the Sheet and the Schematic are.
 * `<Flowchart>` declares its kinds over the app's records — its states, and
 * beside them its transitions, lanes and decisions, each record's fields
 * mapped to the Flowchart's roles — and returns its payload through the
 * `Flowchart` carrier, which e3-ui-components' renderer draws in its builder
 * frame and edits through its editing session.
 *
 * - `types.ts` — the value types its accessors return and its canvas
 *   carries, and the kinds' wire (`Flowchart.Types.*`).
 * - `kinds.ts` — `Flowchart.states`, `transitions`, `lanes` and
 *   `decisions`: each role's check, the binding a kind's read takes, and the
 *   closed functions over beast2 bytes.
 * - `details.ts` — `Flowchart.details` and its four reads, `Flowchart.figure`,
 *   `.histogram`, `.list` and `.tags`: a state's or a transition's details
 *   over the app's rows, read as the kind is.
 * - `templates.ts` — `Flowchart.templates`, a kind's cards read from a
 *   record.
 * - `library.ts` — `Flowchart.library`, the library pane's tabs, and their
 *   wire.
 * - `canvas.ts` — the canvas: what the Flowchart draws with besides its kinds.
 * - `payload.ts` — the payload, its carrier, the shared keys, the props and
 *   their refusals.
 * - `flowchart.ts` — the tag.
 *
 * @packageDocumentation
 */

import { SchedulePatchTypeFor, schedulePatch } from "../schedule/patch.js";
import { FlowchartCanvasType } from "./canvas.js";
import { flowchartDetails, flowchartFigure, flowchartHistogram, flowchartList, flowchartTags } from "./details.js";
import { FlowchartTag, type FlowchartTagType } from "./flowchart.js";
import { flowchartDecisions, flowchartLanes, flowchartStates, flowchartTransitions } from "./kinds.js";
import { FlowchartKindTabWireType, FlowchartLibraryFactories, FlowchartLibraryTabType, type FlowchartLibrary } from "./library.js";
import { FlowchartComponent, FlowchartPayloadType, createFlowchartPayload } from "./payload.js";
import { flowchartTemplates } from "./templates.js";
import {
    FlowchartDecisionEntryType, FlowchartDecisionKindType, FlowchartDecisionRolesType, FlowchartDetailRowType, FlowchartDetailsType, FlowchartEvidenceType,
    FlowchartFreshnessType, FlowchartLaneEntryType, FlowchartLaneKindType, FlowchartLaneRolesType, FlowchartLaneWriteType, FlowchartLinkKindType,
    FlowchartNarrowedType, FlowchartOrientationType, FlowchartReadType, FlowchartShowType, FlowchartStateEntryType, FlowchartStateKindType,
    FlowchartStateRolesType, FlowchartStateWriteType, FlowchartTagColorType, FlowchartTemplateType, FlowchartTransitionEntryType,
    FlowchartTransitionKindType, FlowchartTransitionRolesType, FlowchartTransitionWriteType,
} from "./types.js";

export { FlowchartTag, type FlowchartTagType } from "./flowchart.js";
export {
    FlowchartCanvasType,
    buildCanvas,
    type FlowchartCanvasOptions,
    type FlowchartFreshnessInput,
    type FlowchartOrientationLiteral,
} from "./canvas.js";
export {
    FLOWCHART_DEF,
    flowchartDecisions,
    flowchartLanes,
    flowchartStates,
    flowchartTransitions,
    isFlowchartKind,
    type FlowchartBinding,
    type FlowchartDecisions,
    type FlowchartDecisionsSpec,
    type FlowchartKeyField,
    type FlowchartKeysField,
    type FlowchartKindDeclaration,
    type FlowchartKindSort,
    type FlowchartLanes,
    type FlowchartLanesSpec,
    type FlowchartOrderField,
    type FlowchartStates,
    type FlowchartStatesSpec,
    type FlowchartTextField,
    type FlowchartTransitions,
    type FlowchartTransitionsSpec,
    type FlowchartValuesOf,
    type FlowchartWholeBinding,
} from "./kinds.js";
export {
    FLOWCHART_DETAILS,
    FlowchartDetailsBrand,
    FlowchartReadBrand,
    flowchartDetails,
    flowchartFigure,
    flowchartHistogram,
    flowchartList,
    flowchartTags,
    isFlowchartDetails,
    type FlowchartBarScale,
    type FlowchartDetails,
    type FlowchartDetailsBinding,
    type FlowchartDetailsSpec,
    type FlowchartDurationUnit,
    type FlowchartFigureField,
    type FlowchartHistogramField,
    type FlowchartHistogramOptions,
    type FlowchartLabelDraws,
    type FlowchartLegendOnCanvas,
    type FlowchartListField,
    type FlowchartListItem,
    type FlowchartRead,
    type FlowchartReadKind,
    type FlowchartShow,
    type FlowchartTagColor,
    type FlowchartTagsField,
    type FlowchartTick,
    type FlowchartTransitionDetailsSpec,
} from "./details.js";
export {
    FLOWCHART_TEMPLATES,
    checkedFlowchartTemplates,
    flowchartTemplates,
    isFlowchartTemplates,
    type FlowchartTemplates,
    type FlowchartTemplatesSpec,
} from "./templates.js";
export {
    FlowchartKindTabWireType,
    FlowchartLibraryCardType,
    FlowchartLibraryFactories,
    FlowchartLibraryTabType,
    buildFlowchartLibrary,
    flowchartTabSources,
    libraryLanes,
    libraryStates,
    libraryTab,
    libraryTransitions,
    type FlowchartAuthorTab,
    type FlowchartCardKind,
    type FlowchartKindTab,
    type FlowchartKindTabOptions,
    type FlowchartLibrary,
    type FlowchartLibraryContext,
    type FlowchartLibraryKind,
    type FlowchartLibraryRows,
    type FlowchartLibraryTab,
    type FlowchartTabConfig,
} from "./library.js";
export {
    FlowchartComponent,
    FlowchartPayloadType,
    createFlowchartPayload,
    flowchartKeys,
    type FlowchartProps,
} from "./payload.js";

/** The East types a Flowchart is written with — `Flowchart.Types`. */
export interface FlowchartTypes {
    /** A transition's evidence: its volume, its count, when it was measured and its unit ({@link FlowchartEvidenceType}). */
    Evidence: typeof FlowchartEvidenceType;
    /** A transition's kind — planned | observed ({@link FlowchartLinkKindType}). */
    Kind: typeof FlowchartLinkKindType;
    /** The canvas's orientation — LR | TD ({@link FlowchartOrientationType}). */
    Orientation: typeof FlowchartOrientationType;
    /** The toolbar's freshness chip ({@link FlowchartFreshnessType}). */
    Freshness: typeof FlowchartFreshnessType;
    /** `Patch(R)` — a patch over a kind's row type, every field an `Option` ({@link SchedulePatchTypeFor}). */
    Patch: typeof SchedulePatchTypeFor;
    /**
     * A tag's look — its palette and variant, the pair a Tag takes — for an app that keeps its tags' looks as data
     * ({@link FlowchartTagColorType}).
     */
    TagColor: typeof FlowchartTagColorType;
}

/** The East types a Flowchart is written with. */
const TYPES: FlowchartTypes = {
    Evidence: FlowchartEvidenceType,
    Kind: FlowchartLinkKindType,
    Orientation: FlowchartOrientationType,
    Freshness: FlowchartFreshnessType,
    Patch: SchedulePatchTypeFor,
    TagColor: FlowchartTagColorType,
};

/**
 * The type of the {@link Flowchart} namespace: `<Flowchart>`, its kinds, its
 * cards, its patches, its library's tabs and its East types.
 */
export interface FlowchartNamespace extends FlowchartTagType {
    /** The states, over the app's record ({@link flowchartStates}). */
    states: typeof flowchartStates;
    /** The transitions between them, over the app's record ({@link flowchartTransitions}). */
    transitions: typeof flowchartTransitions;
    /** The lanes, the canvas's columns, over a small record of the app's ({@link flowchartLanes}). */
    lanes: typeof flowchartLanes;
    /** The decisions, over a small record of the app's ({@link flowchartDecisions}). */
    decisions: typeof flowchartDecisions;
    /** A state's or a transition's details, over the app's rows keyed as the kind's are, read only ({@link flowchartDetails}). */
    details: typeof flowchartDetails;
    /** A details' figure: a number, or an Option of one ({@link flowchartFigure}). */
    figure: typeof flowchartFigure;
    /** A details' histogram: a Dict from a duration to its count, or an Array of counts beside the app's bins ({@link flowchartHistogram}). */
    histogram: typeof flowchartHistogram;
    /** A details' list: a Dict from an item's name to a number, or to a struct its draw reads ({@link flowchartList}). */
    list: typeof flowchartList;
    /** A details' tags: an Array or a Set of strings, in the app's looks ({@link flowchartTags}). */
    tags: typeof flowchartTags;
    /** A kind's cards, read from a record ({@link flowchartTemplates}). */
    templates: typeof flowchartTemplates;
    /** A patch over a kind's row type: what an author's card dropped on a row sets ({@link schedulePatch}). */
    patch: typeof schedulePatch;
    /** The library pane's tabs, each a factory `library` lists ({@link FlowchartLibrary}). */
    library: FlowchartLibrary;
    /** The East types a Flowchart is written with ({@link FlowchartTypes}). */
    Types: FlowchartTypes;
}

/** The namespace's members — everything `Flowchart` carries beside the tag itself. */
const MEMBERS = {
    states: flowchartStates,
    transitions: flowchartTransitions,
    lanes: flowchartLanes,
    decisions: flowchartDecisions,
    details: flowchartDetails,
    figure: flowchartFigure,
    histogram: flowchartHistogram,
    list: flowchartList,
    tags: flowchartTags,
    templates: flowchartTemplates,
    patch: schedulePatch,
    library: FlowchartLibraryFactories,
    Types: TYPES,
};

/**
 * `<Flowchart>` — one state-transition flowchart over the app's own records:
 * its states as cards in ordered lanes (the layout derived, no coordinates),
 * H/V-routed transitions between them, the decisions that govern them as
 * lettered diamonds, and evidence-weighted strokes. The selection — a state,
 * a transition, a decision, a lane by its header, or several states — and the
 * pointer-highlight grammar are built in, and the inspector shows what is
 * selected.
 *
 * @remarks
 * - **Its kinds** are the app's records (R1): `states`, and beside them
 *   `transitions`, `lanes` and `decisions` — `Flowchart.states(record, { … })`
 *   and the rest — whose roles are the record's fields where a gesture
 *   writes them or they name another row's key (a state's `label`, `lane`
 *   and `order`; a transition's `from`, `to` and `decision`; a lane's `label`
 *   and `order`; a decision's `queue`), and accessors over a row and its key
 *   for the rest (R2). A role naming a field the row lacks, or one of another
 *   type, is a type error naming the fields that fit. No record of the app's
 *   holds a type of the Flowchart's.
 * - **How a kind is bound follows how it is read** (R3): a state or a
 *   transition `Record.bind(record)`, its record declaring `patch:
 *   mutation.patch()`, to edit it — read whole, or through its source of the
 *   slice with `entries: Data.bindPaged(record)` beside it — `Data.bind`,
 *   read only and whole, or `Data.bindPaged` alone, read only, through its
 *   source; a lane or a decision `Record.bind` or `Data.bind`, read whole.
 * - **Its details** (R18–R21): a state or a transition takes `details`,
 *   `Flowchart.details(binding, { details: [ … ] })` over the app's rows keyed
 *   as the kind's are, read only and bound as the kind is read — four reads,
 *   `Flowchart.figure`, `.histogram`, `.list` and `.tags`, in one array drawn
 *   in its order on the cards and labels and shown in full in the inspector,
 *   each where its `show` says.
 * - **Its narrowing** (R4) is one `Slice.bindRecords`, `slice={{ slice:
 *   Slice.bindRecords(key, { … }) }}`, its rail on the toolbar: its sources
 *   named `states` and `transitions` — each `Data.bindPaged(record, { indexes
 *   })` over that kind's own record — narrow that kind, and each other source
 *   the cards list or the author's tab that names it. A preset may narrow
 *   both at once: a record holding many flows shows one through a preset over
 *   the field both share. `narrowed="dim"` draws what the narrowing leaves
 *   out as context.
 * - **Its edits** are its editing session's: every gesture — "+ LANE", a
 *   lane's rename, the "+ STATE" ghost, a state's rename or move across lanes
 *   or between two cards, a handle dragged to another state, Del, a card
 *   dropped from the library, and every edit the inspector makes — writes
 *   only its roles' fields, one transaction the history item undoes and
 *   redoes, and Save writes each record through its own patch door.
 * - **Its library** (R14): the Steps, Transitions and Lanes tabs
 *   (`Flowchart.library.states()`, `.transitions()`, `.lanes()`) list each
 *   kind's cards — `Flowchart.templates(rows, { name, values, source })` on
 *   the kind — and `Flowchart.library.tab(rows, { … })` the app's own, its
 *   `drop` a `Flowchart.patch(R, { … })` over one kind's row type.
 * - **Its inspector** is on unless `inspector={false}`: Details shows what is
 *   selected through its kind's form, or its kind's own `inspector`, and
 *   Issues what holds Save off.
 * - **The host hears** the selection (`onSelectState`, `onSelectLink`,
 *   `onSelectTrigger`) and a traced path (`onTracePath`), and vetoes a
 *   connection with `canConnect`.
 * - It fills the box it is given and draws no border: give it a box of its
 *   own height.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Flowchart } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * // The depot's states, transitions and lanes: three records of the app's, keyed by String, each row its own type.
 * export const DepotState = StructType({
 *     name: StringType,                         // what its card calls it
 *     phase: StringType,                        // the lane it stands in, by the lane's key
 *     seq: FloatType,                           // its place in its lane
 *     slots: OptionType(IntegerType),           // a class of interchangeable states: the ×N badge
 *     flow: StringType,                         // the flow it belongs to: one record holds the depot's flows
 * });
 * export const DepotTransition = StructType({
 *     src: StringType,                          // the state it leaves, by its key
 *     dst: StringType,                          // the state it enters
 *     kind: VariantType({ planned: NullType, observed: NullType }),
 *     trigger: OptionType(StringType),          // the decision that governs it, by its key
 *     volume: OptionType(FloatType),            // the parcels measured on it
 *     n: OptionType(IntegerType),               // the moves behind them
 *     at: OptionType(DateTimeType),             // when they were measured
 *     flow: StringType,
 * });
 * export const DepotLane = StructType({ label: StringType, seq: FloatType });
 * export const depotStates = e3.record("flowchart_depot_states", DictType(StringType, DepotState), {
 *     initial: new Map([
 *         ["ARV", { name: "Arrived", phase: "intake", seq: 1, slots: none, flow: "Parcels" }],
 *         ["SCN", { name: "Scanned", phase: "intake", seq: 2, slots: none, flow: "Parcels" }],
 *         ["IND", { name: "Inducted", phase: "induct", seq: 1, slots: none, flow: "Parcels" }],
 *         ["LBL", { name: "Relabelled", phase: "induct", seq: 2, slots: none, flow: "Parcels" }],
 *         ["CH*", { name: "Sort chutes (class)", phase: "sort", seq: 1, slots: some(14n), flow: "Parcels" }],
 *         ["SRD", { name: "Sorted", phase: "sort", seq: 2, slots: none, flow: "Parcels" }],
 *         ["HLD", { name: "Held", phase: "hold", seq: 1, slots: none, flow: "Parcels" }],
 *         ["CLR", { name: "Cleared", phase: "hold", seq: 2, slots: none, flow: "Parcels" }],
 *         ["LDD", { name: "Loaded", phase: "dispatch", seq: 1, slots: none, flow: "Parcels" }],
 *         ["DSP", { name: "Dispatched", phase: "dispatch", seq: 2, slots: none, flow: "Parcels" }],
 *         // The returns flow's states, beside the parcels'.
 *         ["RCV", { name: "Received", phase: "intake", seq: 3, slots: none, flow: "Returns" }],
 *         ["INS", { name: "Inspected", phase: "hold", seq: 3, slots: none, flow: "Returns" }],
 *         ["RSD", { name: "Resent", phase: "dispatch", seq: 3, slots: none, flow: "Returns" }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 *     indexes: (index) => ({
 *         flowchart_states_by_flow: index.on(["flow"]),
 *         flowchart_states_by_lane: index.on(["flow", "phase"]),
 *     }),
 * });
 * export const depotTransitions = e3.record("flowchart_depot_transitions", DictType(StringType, DepotTransition), {
 *     initial: new Map([
 *         ["l1", { src: "ARV", dst: "SCN", kind: variant("planned", null), trigger: none, volume: some(18460), n: some(412n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l2", { src: "SCN", dst: "IND", kind: variant("planned", null), trigger: none, volume: some(18390), n: some(409n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         // In place: parcels inducted again, counted but not weighed.
 *         ["l3", { src: "IND", dst: "IND", kind: variant("observed", null), trigger: none, volume: none, n: some(2n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l4", { src: "IND", dst: "CH*", kind: variant("planned", null), trigger: some("route"), volume: some(17350), n: some(386n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l5", { src: "CH*", dst: "SRD", kind: variant("planned", null), trigger: none, volume: some(18210), n: some(405n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l6", { src: "SRD", dst: "HLD", kind: variant("planned", null), trigger: none, volume: some(8420), n: some(188n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l7", { src: "HLD", dst: "CLR", kind: variant("planned", null), trigger: some("customs"), volume: some(8350), n: some(186n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l8", { src: "CLR", dst: "LDD", kind: variant("planned", null), trigger: none, volume: some(8240), n: some(183n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l9", { src: "LDD", dst: "DSP", kind: variant("planned", null), trigger: none, volume: some(17030), n: some(378n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         // Its far end names a state no row is keyed by: drawn as a ghost, and listed in Issues.
 *         ["l10", { src: "DSP", dst: "DLV", kind: variant("planned", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" }],
 *         // Observed, not planned: parcels relabelled before they are sorted.
 *         ["l11", { src: "IND", dst: "LBL", kind: variant("observed", null), trigger: none, volume: some(980), n: some(22n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l12", { src: "LBL", dst: "CH*", kind: variant("observed", null), trigger: none, volume: some(975), n: some(22n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["l13", { src: "SRD", dst: "LDD", kind: variant("planned", null), trigger: none, volume: some(8790), n: some(195n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
 *         ["r1", { src: "RCV", dst: "INS", kind: variant("planned", null), trigger: none, volume: some(640), n: some(15n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Returns" }],
 *         ["r2", { src: "INS", dst: "RSD", kind: variant("planned", null), trigger: none, volume: some(610), n: some(14n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Returns" }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 *     indexes: (index) => ({
 *         flowchart_transitions_by_flow: index.on(["flow"]),
 *     }),
 * });
 * export const depotLanes = e3.record("flowchart_depot_lanes", DictType(StringType, DepotLane), {
 *     initial: new Map([
 *         ["intake", { label: "Intake", seq: 1 }], ["induct", { label: "Induct", seq: 2 }], ["sort", { label: "Sort", seq: 3 }],
 *         ["hold", { label: "Hold", seq: 4 }], ["dispatch", { label: "Dispatch", seq: 5 }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 *
 * // The time each parcel spent in each state, keyed as the states are: its parcels counted into bins by how
 * // long they stayed, each key a bin's lower edge, in hours.
 * export const StateDwell = StructType({ hours: DictType(FloatType, IntegerType) });
 * export const stateDwell = e3.input("flowchart_depot_dwell", DictType(StringType, StateDwell), variant("value", new Map([
 *     ["ARV", { hours: new Map([[0, 7752n], [0.25, 6092n], [0.5, 2769n], [1, 1108n], [2, 554n], [4, 185n]]) }],
 *     ["SCN", { hours: new Map([[0, 9195n], [0.25, 5517n], [0.5, 2391n], [1, 920n], [2, 367n]]) }],
 *     ["IND", { hours: new Map([[0, 2207n], [0.25, 4781n], [0.5, 5517n], [1, 3310n], [2, 1655n], [4, 736n], [8, 184n]]) }],
 *     ["LBL", { hours: new Map([[0.25, 59n], [0.5, 137n], [1, 255n], [2, 273n], [4, 157n], [8, 79n], [12, 20n]]) }],
 *     ["CH*", { hours: new Map([[0, 1457n], [0.25, 4007n], [0.5, 6192n], [1, 4007n], [2, 1639n], [4, 728n], [8, 180n]]) }],
 *     ["SRD", { hours: new Map([[0, 861n], [0.25, 2065n], [0.5, 4303n], [1, 4818n], [2, 3098n], [4, 1377n], [8, 516n], [12, 172n]]) }],
 *     ["HLD", { hours: new Map([[0.25, 84n], [0.5, 167n], [1, 418n], [2, 752n], [4, 1169n], [8, 1417n],
 *         [12, 1253n], [24, 1336n], [48, 1002n], [96, 501n], [168, 251n]]) }],
 *     ["CLR", { hours: new Map([[0, 824n], [0.25, 1648n], [0.5, 2060n], [1, 1648n], [2, 989n], [4, 659n], [8, 330n], [12, 82n]]) }],
 *     ["LDD", { hours: new Map([[0, 681n], [0.25, 1362n], [0.5, 2725n], [1, 4088n], [2, 3747n], [4, 2384n], [8, 1362n], [12, 511n], [24, 170n]]) }],
 *     // Dispatched has no row: the app counts no time in it once a parcel has left, and its card says no data.
 *     ["RCV", { hours: new Map([[0, 64n], [0.25, 115n], [0.5, 154n], [1, 141n], [2, 90n], [4, 51n], [8, 19n], [12, 6n]]) }],
 *     ["INS", { hours: new Map([[0.25, 12n], [0.5, 37n], [1, 73n], [2, 122n], [4, 146n], [8, 110n], [12, 61n], [24, 37n], [48, 12n]]) }],
 *     ["RSD", { hours: new Map([[0, 122n], [0.25, 183n], [0.5, 159n], [1, 85n], [2, 43n], [4, 18n]]) }],
 * ])));
 *
 * const flowchartDwell = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const states = $.let(Data.bind(depotStates));
 *         const transitions = $.let(Data.bind(depotTransitions));
 *         const lanes = $.let(Data.bind(depotLanes));
 *         const dwell = $.let(Data.bind(stateDwell));
 *         return (
 *             <Box height="600px">
 *                 <Flowchart
 *                     states={Flowchart.states(states, {
 *                         label: "name", lane: "phase", order: "seq",
 *                         // Keyed as the states are, and read as they are: whole.
 *                         details: Flowchart.details(dwell, {
 *                             details: [Flowchart.histogram("hours", { unit: "hours", label: "Time in state" })],
 *                         }),
 *                     })}
 *                     transitions={Flowchart.transitions(transitions, { from: "src", to: "dst" })}
 *                     lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
 *                     name="dwell"
 *                 />
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
    /** Creates the Flowchart's payload alone — what `<Flowchart>` returns through the `Flowchart` carrier ({@link createFlowchartPayload}). */
    Payload: typeof createFlowchartPayload;
    /** The `Flowchart` carrier ({@link FlowchartComponent}). */
    Component: typeof FlowchartComponent;
    /** The East types a Flowchart is written with, and its payload's. */
    Types: FlowchartTypes & {
        /** The renderer's payload ({@link FlowchartPayloadType}). */
        Payload: typeof FlowchartPayloadType;
        /** What the canvas draws with besides its kinds ({@link FlowchartCanvasType}). */
        Canvas: typeof FlowchartCanvasType;
        /** The states, closed over their record ({@link FlowchartStateKindType}). */
        StateKind: typeof FlowchartStateKindType;
        /** The transitions ({@link FlowchartTransitionKindType}). */
        TransitionKind: typeof FlowchartTransitionKindType;
        /** The lanes ({@link FlowchartLaneKindType}). */
        LaneKind: typeof FlowchartLaneKindType;
        /** The decisions ({@link FlowchartDecisionKindType}). */
        DecisionKind: typeof FlowchartDecisionKindType;
        /** A state's roles, as its kind reads them from the app's row ({@link FlowchartStateRolesType}). */
        StateRoles: typeof FlowchartStateRolesType;
        /** A transition's roles ({@link FlowchartTransitionRolesType}). */
        TransitionRoles: typeof FlowchartTransitionRolesType;
        /** A lane's roles ({@link FlowchartLaneRolesType}). */
        LaneRoles: typeof FlowchartLaneRolesType;
        /** A decision's roles ({@link FlowchartDecisionRolesType}). */
        DecisionRoles: typeof FlowchartDecisionRolesType;
        /** What a gesture writes of a state's roles ({@link FlowchartStateWriteType}). */
        StateWrite: typeof FlowchartStateWriteType;
        /** What a gesture writes of a transition's roles ({@link FlowchartTransitionWriteType}). */
        TransitionWrite: typeof FlowchartTransitionWriteType;
        /** What a gesture writes of a lane's roles ({@link FlowchartLaneWriteType}). */
        LaneWrite: typeof FlowchartLaneWriteType;
        /** A stored state: its roles and its row's bytes ({@link FlowchartStateEntryType}). */
        StateEntry: typeof FlowchartStateEntryType;
        /** A stored transition ({@link FlowchartTransitionEntryType}). */
        TransitionEntry: typeof FlowchartTransitionEntryType;
        /** A stored lane ({@link FlowchartLaneEntryType}). */
        LaneEntry: typeof FlowchartLaneEntryType;
        /** A stored decision ({@link FlowchartDecisionEntryType}). */
        DecisionEntry: typeof FlowchartDecisionEntryType;
        /** One card ({@link FlowchartTemplateType}). */
        Template: typeof FlowchartTemplateType;
        /** How a narrowed-out row draws ({@link FlowchartNarrowedType}). */
        Narrowed: typeof FlowchartNarrowedType;
        /** One tab of the library ({@link FlowchartLibraryTabType}). */
        LibraryTab: typeof FlowchartLibraryTabType;
        /** A kind's tab on the wire ({@link FlowchartKindTabWireType}). */
        KindTab: typeof FlowchartKindTabWireType;
        /** A kind's details on the wire: its reads, and its rows' values ({@link FlowchartDetailsType}). */
        Details: typeof FlowchartDetailsType;
        /** One read, described ({@link FlowchartReadType}). */
        Read: typeof FlowchartReadType;
        /** Where a read shows ({@link FlowchartShowType}). */
        Show: typeof FlowchartShowType;
        /** What a details row holds: one value a read ({@link FlowchartDetailRowType}). */
        DetailRow: typeof FlowchartDetailRowType;
    };
}

/** `<Flowchart>`, for the internal namespace: the tag, on an object of its own, so the public `Flowchart` carries none of the internal members. */
function FlowchartInternalTag(props: Parameters<FlowchartTagType>[0]): ReturnType<FlowchartTagType> {
    return FlowchartTag(props);
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
        StateKind: FlowchartStateKindType,
        TransitionKind: FlowchartTransitionKindType,
        LaneKind: FlowchartLaneKindType,
        DecisionKind: FlowchartDecisionKindType,
        StateRoles: FlowchartStateRolesType,
        TransitionRoles: FlowchartTransitionRolesType,
        LaneRoles: FlowchartLaneRolesType,
        DecisionRoles: FlowchartDecisionRolesType,
        StateWrite: FlowchartStateWriteType,
        TransitionWrite: FlowchartTransitionWriteType,
        LaneWrite: FlowchartLaneWriteType,
        StateEntry: FlowchartStateEntryType,
        TransitionEntry: FlowchartTransitionEntryType,
        LaneEntry: FlowchartLaneEntryType,
        DecisionEntry: FlowchartDecisionEntryType,
        Template: FlowchartTemplateType,
        Narrowed: FlowchartNarrowedType,
        LibraryTab: FlowchartLibraryTabType,
        KindTab: FlowchartKindTabWireType,
        Details: FlowchartDetailsType,
        Read: FlowchartReadType,
        Show: FlowchartShowType,
        DetailRow: FlowchartDetailRowType,
    },
});
