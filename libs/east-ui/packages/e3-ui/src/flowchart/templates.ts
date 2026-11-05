/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Flowchart.templates(rows, spec)` (#1501, `Flowchart Records Spec.md` R14,
 * D8): the cards a kind's library tab lists. Cards are records (#1340,
 * ruling 9), as the Schematic's are: the rows are a record of the app's, read
 * whole through `Data.bind(record).read()`, and each card is one of its rows,
 * its key the record's key. A list names its source of the Flowchart's
 * `Slice.bindRecords`, whose shown keys narrow its cards.
 *
 * - A state's card gives every field of the row but its lane and its order:
 *   dropped on a lane, it adds a state there.
 * - A transition's gives every field but its ends: dropped on a transition,
 *   it gives it its values, its ends kept.
 * - A lane's gives every field but its order: dropped between two lanes, or at
 *   the band row's tail, it adds a lane there.
 *
 * Each accessor is reified once and called per row.
 *
 * @packageDocumentation
 */

import {
    ArrayType, East, Expr, OptionType, StringType, isTypeEqual, none, printType,
    type DictType, type EastType, type ExprType, type FunctionType, type StructType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { FlowchartTemplateType } from "./types.js";

/** Identifies a list of cards read from a record. */
export const FLOWCHART_TEMPLATES: unique symbol = Symbol("Flowchart.templates");

/**
 * A kind's cards, read from a record (see the module docs).
 *
 * @typeParam V - The values' type: the row's fields less what a drop writes
 */
export interface FlowchartTemplates<V extends StructType> {
    /** Identifies the declaration. */
    readonly [FLOWCHART_TEMPLATES]: true;
    /** The type of each card's values. */
    readonly valuesType: V;
    /** The cards, each its values encoded at their own type. */
    readonly items: ExprType<ArrayType<FlowchartTemplateType>>;
    /** The Flowchart's `Slice.bindRecords` source over the cards' record, whose shown keys narrow them. */
    readonly source: string | undefined;
}

/**
 * How each row of a cards record shows, and what it makes.
 *
 * @typeParam C - The cards record's row type
 * @typeParam V - The values' type
 */
export interface FlowchartTemplatesSpec<C extends EastType, V extends StructType> {
    /** The card's name. */
    name: (row: ExprType<C>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** The tab's group it sits under. */
    group?: (row: ExprType<C>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /**
     * Every field of the row the card makes but what a drop writes: a state's every field but its lane and its order,
     * a transition's every field but its ends, a lane's every field but its order.
     */
    values: (row: ExprType<C>, key: ExprType<StringType>) => ExprType<V>;
    /**
     * The Flowchart's `Slice.bindRecords` source over the cards' record (`stepCards`): its shown keys narrow the cards,
     * each card's key its record's key. A list naming no source of the slice is refused, naming the change.
     */
    source: string;
}

/**
 * Declares a kind's cards over a record's rows (see the module docs).
 *
 * @typeParam C - The cards record's row type
 * @typeParam V - The values' struct type
 * @param rows - The cards, keyed by String: a record's rows, `Data.bind(record).read()`
 * @param spec - Each card's name and group, its values, and its source of the slice
 * @returns The cards, which a kind's `templates` takes
 * @throws {Error} When the rows are not a Dict keyed by String, or `values` returns no struct
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Box, Fields, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Flowchart, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * // The depot's four records, and the records of the cards its library lists: each list of cards follows its own
 * // source of the rail, as the states and the transitions follow theirs.
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
 * export const DepotDecision = StructType({ name: StringType, owner: StringType });
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
 * export const depotDecisions = e3.record("flowchart_depot_decisions", DictType(StringType, DepotDecision), {
 *     initial: new Map([["route", { name: "route", owner: "sort-planner" }], ["customs", { name: "customs", owner: "customs-desk" }]]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 * // What the depot measured in each state and on each transition: the app's own rows, keyed as the states and
 * // the transitions are, written by its evidence task through each record's door.
 * export const StateEvidence = StructType({
 *     flags: SetType(StringType),                       // what the app's task flags the state with
 *     equipment: SetType(StringType),                   // what handles parcels there
 *     shifts: SetType(StringType),                      // the shifts that staff it
 *     parcels: IntegerType,                             // through the state
 *     waiting: IntegerType,                             // still in it when measured
 *     hours: ArrayType(IntegerType),                    // parcels by time in state: a count a bin, in the bins' order
 *     service: DictType(StringType, IntegerType),       // parcels by service
 *     exceptions: DictType(StringType, IntegerType),    // parcels by what went wrong
 * });
 * export const MoveEvidence = StructType({
 *     region: DictType(StringType, IntegerType),
 *     service: DictType(StringType, IntegerType),
 *     origins: DictType(StringType, StructType({ parcels: IntegerType, late: IntegerType })),
 * });
 * // What the evidence task last wrote, made up: a row a state but Dispatched, whose card says no data.
 * export const stateEvidence = e3.record("flowchart_depot_state_evidence", DictType(StringType, StateEvidence), {
 *     initial: new Map([
 *         ["ARV", {
 *             flags: new Set<string>(), equipment: new Set(["Conveyor"]), shifts: new Set(["Early", "Late", "Night"]),
 *             parcels: 18460n, waiting: 60n,
 *             hours: [5538n, 6277n, 3692n, 1846n, 738n, 369n, 0n, 0n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 10337n], ["Priority", 4615n], ["Economy", 2400n], ["International", 1108n]]),
 *             exceptions: new Map([["Late arrival", 52n], ["Damaged packaging", 11n]]),
 *         }],
 *         ["SCN", {
 *             flags: new Set(["Fragile"]), equipment: new Set(["Scanner", "Conveyor"]), shifts: new Set(["Early", "Late", "Night"]),
 *             parcels: 18390n, waiting: 35n,
 *             hours: [7723n, 5701n, 2759n, 1471n, 552n, 184n, 0n, 0n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 10298n], ["Priority", 4598n], ["Economy", 2391n], ["International", 1103n]]),
 *             exceptions: new Map([["Unreadable label", 61n], ["Damaged packaging", 9n]]),
 *         }],
 *         ["IND", {
 *             flags: new Set(["Oversize", "Fragile"]), equipment: new Set(["Conveyor", "Scanner"]), shifts: new Set(["Early", "Late"]),
 *             parcels: 18390n, waiting: 120n,
 *             hours: [2207n, 4781n, 5517n, 3310n, 1655n, 736n, 184n, 0n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 10482n], ["Priority", 4414n], ["Economy", 2391n], ["International", 1103n]]),
 *             exceptions: new Map([["Missort", 22n]]),
 *         }],
 *         ["LBL", {
 *             flags: new Set(["At risk"]), equipment: new Set(["Label printer", "Scanner"]), shifts: new Set(["Late"]),
 *             parcels: 980n, waiting: 15n,
 *             hours: [20n, 59n, 137n, 255n, 273n, 157n, 59n, 20n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 471n], ["Priority", 294n], ["Economy", 137n], ["International", 78n]]),
 *             exceptions: new Map([["Unreadable label", 712n], ["Address check", 268n]]),
 *         }],
 *         ["CH*", {
 *             flags: new Set(["At risk"]), equipment: new Set(["Conveyor", "Scanner"]), shifts: new Set(["Early", "Late", "Night", "Weekend"]),
 *             parcels: 18290n, waiting: 140n,
 *             hours: [1463n, 4024n, 6218n, 4024n, 1646n, 732n, 183n, 0n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 10425n], ["Priority", 4390n], ["Economy", 2378n], ["International", 1097n]]),
 *             exceptions: new Map([["Missort", 41n], ["Chute full", 26n]]),
 *         }],
 *         ["SRD", {
 *             flags: new Set(["Fragile"]), equipment: new Set(["Conveyor"]), shifts: new Set(["Early", "Late"]),
 *             parcels: 17210n, waiting: 50n,
 *             hours: [861n, 2065n, 4303n, 4818n, 3098n, 1377n, 516n, 172n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 9981n], ["Priority", 4303n], ["Economy", 2065n], ["International", 861n]]),
 *             exceptions: new Map([["Missort", 14n], ["Damaged packaging", 6n]]),
 *         }],
 *         ["HLD", {
 *             flags: new Set(["Customs", "Hazmat", "At risk", "Cold chain", "Oversize"]), equipment: new Set(["Forklift", "X-ray", "Scanner"]), shifts: new Set(["Early", "Late"]),
 *             parcels: 1080n, waiting: 70n,
 *             hours: [0n, 11n, 22n, 54n, 97n, 151n, 183n, 162n, 173n, 130n, 65n, 32n],
 *             service: new Map([["Standard", 335n], ["Priority", 130n], ["Economy", 76n], ["International", 539n]]),
 *             exceptions: new Map([["Missing documents", 412n], ["Duty unpaid", 236n], ["Address check", 98n], ["Damaged packaging", 44n]]),
 *         }],
 *         ["CLR", {
 *             flags: new Set(["Customs"]), equipment: new Set(["Label printer", "Scanner", "X-ray"]), shifts: new Set(["Early", "Late"]),
 *             parcels: 18170n, waiting: 18n,
 *             hours: [1817n, 3634n, 4542n, 3634n, 2180n, 1454n, 727n, 182n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 10175n], ["Priority", 4361n], ["Economy", 2362n], ["International", 1272n]]),
 *             exceptions: new Map([["Duty refund", 12n]]),
 *         }],
 *         ["LDD", {
 *             flags: new Set(["Hazmat", "Oversize"]), equipment: new Set(["Forklift", "Scanner"]), shifts: new Set(["Early", "Late", "Night"]),
 *             parcels: 17030n, waiting: 210n,
 *             hours: [681n, 1362n, 2725n, 4088n, 3747n, 2384n, 1362n, 511n, 170n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 9707n], ["Priority", 4087n], ["Economy", 2214n], ["International", 1022n]]),
 *             exceptions: new Map([["Vehicle late", 140n], ["Overweight", 31n]]),
 *         }],
 *         ["RCV", {
 *             flags: new Set(["Fragile"]), equipment: new Set(["Scanner"]), shifts: new Set(["Weekend"]),
 *             parcels: 640n, waiting: 25n,
 *             hours: [64n, 115n, 154n, 141n, 90n, 51n, 19n, 6n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 397n], ["Priority", 128n], ["Economy", 77n], ["International", 38n]]),
 *             exceptions: new Map([["Missing documents", 18n]]),
 *         }],
 *         ["INS", {
 *             flags: new Set(["At risk", "Customs"]), equipment: new Set(["X-ray"]), shifts: new Set(["Early"]),
 *             parcels: 640n, waiting: 30n,
 *             hours: [0n, 13n, 38n, 77n, 128n, 154n, 115n, 64n, 38n, 13n, 0n, 0n],
 *             service: new Map([["Standard", 397n], ["Priority", 128n], ["Economy", 77n], ["International", 38n]]),
 *             exceptions: new Map([["Damaged packaging", 27n]]),
 *         }],
 *         ["RSD", {
 *             flags: new Set<string>(), equipment: new Set(["Scanner"]), shifts: new Set(["Early"]),
 *             parcels: 610n, waiting: 0n,
 *             hours: [122n, 183n, 159n, 85n, 43n, 18n, 0n, 0n, 0n, 0n, 0n, 0n],
 *             service: new Map([["Standard", 378n], ["Priority", 122n], ["Economy", 73n], ["International", 37n]]),
 *             exceptions: new Map<string, bigint>(),
 *         }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 * // A row a transition with a volume: the in-place one and the one to Delivered have none, and their labels keep their evidence alone.
 * export const moveEvidence = e3.record("flowchart_depot_move_evidence", DictType(StringType, MoveEvidence), {
 *     initial: new Map([
 *         ["l1", {
 *             region: new Map([["Metro", 8491n], ["Regional", 6092n], ["Remote", 2769n], ["Overseas", 1108n]]),
 *             service: new Map([["Standard", 10337n], ["Priority", 4615n], ["Economy", 2400n], ["International", 1108n]]),
 *             origins: new Map([["Air hub", { parcels: 5350n, late: 84n }], ["Harbour hub", { parcels: 4377n, late: 135n }], ["Rail yard", { parcels: 2233n, late: 27n }], ["Depot 02", { parcels: 1680n, late: 20n }], ["Depot 05", { parcels: 1349n, late: 9n }], ["Depot 07", { parcels: 995n, late: 13n }], ["Depot 11", { parcels: 730n, late: 4n }], ["City counter", { parcels: 619n, late: 7n }], ["Partner pickup", { parcels: 508n, late: 11n }], ["Returns desk", { parcels: 354n, late: 2n }], ["Locker bank", { parcels: 265n, late: 0n }]]),
 *         }],
 *         ["l2", {
 *             region: new Map([["Metro", 8459n], ["Regional", 6069n], ["Remote", 2759n], ["Overseas", 1103n]]),
 *             service: new Map([["Standard", 10298n], ["Priority", 4598n], ["Economy", 2391n], ["International", 1103n]]),
 *             origins: new Map([["Air hub", { parcels: 5330n, late: 84n }], ["Harbour hub", { parcels: 4361n, late: 134n }], ["Rail yard", { parcels: 2224n, late: 26n }], ["Depot 02", { parcels: 1674n, late: 20n }], ["Depot 05", { parcels: 1343n, late: 9n }], ["Depot 07", { parcels: 991n, late: 13n }], ["Depot 11", { parcels: 727n, late: 4n }], ["City counter", { parcels: 617n, late: 7n }], ["Partner pickup", { parcels: 507n, late: 11n }], ["Returns desk", { parcels: 352n, late: 2n }], ["Locker bank", { parcels: 264n, late: 0n }]]),
 *         }],
 *         ["l4", {
 *             region: new Map([["Metro", 8153n], ["Regional", 5726n], ["Remote", 2603n], ["Overseas", 868n]]),
 *             service: new Map([["Standard", 9889n], ["Priority", 4164n], ["Economy", 2256n], ["International", 1041n]]),
 *             origins: new Map([["Air hub", { parcels: 5029n, late: 79n }], ["Harbour hub", { parcels: 4114n, late: 127n }], ["Rail yard", { parcels: 2099n, late: 25n }], ["Depot 02", { parcels: 1579n, late: 19n }], ["Depot 05", { parcels: 1267n, late: 8n }], ["Depot 07", { parcels: 935n, late: 12n }], ["Depot 11", { parcels: 686n, late: 4n }], ["City counter", { parcels: 582n, late: 6n }], ["Partner pickup", { parcels: 478n, late: 10n }], ["Returns desk", { parcels: 332n, late: 2n }], ["Locker bank", { parcels: 249n, late: 0n }]]),
 *         }],
 *         ["l5", {
 *             region: new Map([["Metro", 8376n], ["Regional", 6009n], ["Remote", 2732n], ["Overseas", 1093n]]),
 *             service: new Map([["Standard", 10380n], ["Priority", 4370n], ["Economy", 2367n], ["International", 1093n]]),
 *             origins: new Map([["Air hub", { parcels: 5277n, late: 83n }], ["Harbour hub", { parcels: 4318n, late: 133n }], ["Rail yard", { parcels: 2203n, late: 26n }], ["Depot 02", { parcels: 1657n, late: 20n }], ["Depot 05", { parcels: 1330n, late: 9n }], ["Depot 07", { parcels: 981n, late: 13n }], ["Depot 11", { parcels: 720n, late: 4n }], ["City counter", { parcels: 611n, late: 7n }], ["Partner pickup", { parcels: 502n, late: 11n }], ["Returns desk", { parcels: 349n, late: 2n }], ["Locker bank", { parcels: 262n, late: 0n }]]),
 *         }],
 *         ["l6", {
 *             region: new Map([["Metro", 1179n], ["Regional", 758n], ["Remote", 421n], ["Overseas", 6062n]]),
 *             service: new Map([["Standard", 2610n], ["Priority", 1010n], ["Economy", 589n], ["International", 4211n]]),
 *             origins: new Map([["Air hub", { parcels: 2441n, late: 38n }], ["Harbour hub", { parcels: 1997n, late: 62n }], ["Rail yard", { parcels: 1018n, late: 12n }], ["Depot 02", { parcels: 766n, late: 9n }], ["Depot 05", { parcels: 615n, late: 4n }], ["Depot 07", { parcels: 454n, late: 6n }], ["Depot 11", { parcels: 333n, late: 2n }], ["City counter", { parcels: 282n, late: 3n }], ["Partner pickup", { parcels: 232n, late: 5n }], ["Returns desk", { parcels: 161n, late: 1n }], ["Locker bank", { parcels: 121n, late: 0n }]]),
 *         }],
 *         ["l7", {
 *             region: new Map([["Metro", 1169n], ["Regional", 752n], ["Remote", 418n], ["Overseas", 6011n]]),
 *             service: new Map([["Standard", 2589n], ["Priority", 1002n], ["Economy", 585n], ["International", 4174n]]),
 *             origins: new Map([["Air hub", { parcels: 2420n, late: 38n }], ["Harbour hub", { parcels: 1980n, late: 61n }], ["Rail yard", { parcels: 1010n, late: 12n }], ["Depot 02", { parcels: 760n, late: 9n }], ["Depot 05", { parcels: 610n, late: 4n }], ["Depot 07", { parcels: 450n, late: 6n }], ["Depot 11", { parcels: 330n, late: 2n }], ["City counter", { parcels: 280n, late: 3n }], ["Partner pickup", { parcels: 230n, late: 5n }], ["Returns desk", { parcels: 160n, late: 1n }], ["Locker bank", { parcels: 120n, late: 0n }]]),
 *         }],
 *         ["l8", {
 *             region: new Map([["Metro", 3296n], ["Regional", 2472n], ["Remote", 1154n], ["Overseas", 1318n]]),
 *             service: new Map([["Standard", 4120n], ["Priority", 1813n], ["Economy", 989n], ["International", 1318n]]),
 *             origins: new Map([["Air hub", { parcels: 2388n, late: 37n }], ["Harbour hub", { parcels: 1954n, late: 60n }], ["Rail yard", { parcels: 997n, late: 12n }], ["Depot 02", { parcels: 750n, late: 9n }], ["Depot 05", { parcels: 602n, late: 4n }], ["Depot 07", { parcels: 444n, late: 6n }], ["Depot 11", { parcels: 326n, late: 2n }], ["City counter", { parcels: 276n, late: 3n }], ["Partner pickup", { parcels: 227n, late: 5n }], ["Returns desk", { parcels: 158n, late: 1n }], ["Locker bank", { parcels: 118n, late: 0n }]]),
 *         }],
 *         ["l9", {
 *             region: new Map([["Metro", 8003n], ["Regional", 5620n], ["Remote", 2555n], ["Overseas", 852n]]),
 *             service: new Map([["Standard", 9876n], ["Priority", 4258n], ["Economy", 2044n], ["International", 852n]]),
 *             origins: new Map([["Air hub", { parcels: 4936n, late: 78n }], ["Harbour hub", { parcels: 4038n, late: 124n }], ["Rail yard", { parcels: 2060n, late: 24n }], ["Depot 02", { parcels: 1550n, late: 18n }], ["Depot 05", { parcels: 1244n, late: 8n }], ["Depot 07", { parcels: 918n, late: 12n }], ["Depot 11", { parcels: 673n, late: 4n }], ["City counter", { parcels: 571n, late: 6n }], ["Partner pickup", { parcels: 469n, late: 10n }], ["Returns desk", { parcels: 326n, late: 2n }], ["Locker bank", { parcels: 245n, late: 0n }]]),
 *         }],
 *         ["l11", {
 *             region: new Map([["Metro", 294n], ["Regional", 274n], ["Remote", 216n], ["Overseas", 196n]]),
 *             service: new Map([["Standard", 471n], ["Priority", 294n], ["Economy", 137n], ["International", 78n]]),
 *             origins: new Map([["Air hub", { parcels: 283n, late: 4n }], ["Harbour hub", { parcels: 232n, late: 7n }], ["Rail yard", { parcels: 119n, late: 1n }], ["Depot 02", { parcels: 89n, late: 1n }], ["Depot 05", { parcels: 72n, late: 0n }], ["Depot 07", { parcels: 53n, late: 1n }], ["Depot 11", { parcels: 39n, late: 0n }], ["City counter", { parcels: 33n, late: 0n }], ["Partner pickup", { parcels: 27n, late: 1n }], ["Returns desk", { parcels: 19n, late: 0n }], ["Locker bank", { parcels: 14n, late: 0n }]]),
 *         }],
 *         ["l12", {
 *             region: new Map([["Metro", 292n], ["Regional", 273n], ["Remote", 215n], ["Overseas", 195n]]),
 *             service: new Map([["Standard", 467n], ["Priority", 293n], ["Economy", 137n], ["International", 78n]]),
 *             origins: new Map([["Air hub", { parcels: 281n, late: 4n }], ["Harbour hub", { parcels: 231n, late: 7n }], ["Rail yard", { parcels: 118n, late: 1n }], ["Depot 02", { parcels: 89n, late: 1n }], ["Depot 05", { parcels: 71n, late: 0n }], ["Depot 07", { parcels: 53n, late: 1n }], ["Depot 11", { parcels: 39n, late: 0n }], ["City counter", { parcels: 33n, late: 0n }], ["Partner pickup", { parcels: 27n, late: 1n }], ["Returns desk", { parcels: 19n, late: 0n }], ["Locker bank", { parcels: 14n, late: 0n }]]),
 *         }],
 *         ["l13", {
 *             region: new Map([["Metro", 4570n], ["Regional", 2989n], ["Remote", 1055n], ["Overseas", 176n]]),
 *             service: new Map([["Standard", 5450n], ["Priority", 2285n], ["Economy", 1055n]]),
 *             origins: new Map([["Air hub", { parcels: 2549n, late: 40n }], ["Harbour hub", { parcels: 2084n, late: 64n }], ["Rail yard", { parcels: 1063n, late: 13n }], ["Depot 02", { parcels: 800n, late: 9n }], ["Depot 05", { parcels: 642n, late: 4n }], ["Depot 07", { parcels: 474n, late: 6n }], ["Depot 11", { parcels: 347n, late: 2n }], ["City counter", { parcels: 295n, late: 3n }], ["Partner pickup", { parcels: 242n, late: 5n }], ["Returns desk", { parcels: 168n, late: 1n }], ["Locker bank", { parcels: 126n, late: 0n }]]),
 *         }],
 *         ["r1", {
 *             region: new Map([["Metro", 371n], ["Regional", 192n], ["Remote", 77n]]),
 *             service: new Map([["Standard", 397n], ["Priority", 128n], ["Economy", 77n], ["International", 38n]]),
 *             origins: new Map([["Air hub", { parcels: 187n, late: 3n }], ["Harbour hub", { parcels: 152n, late: 5n }], ["Rail yard", { parcels: 77n, late: 1n }], ["Depot 02", { parcels: 58n, late: 1n }], ["Depot 05", { parcels: 47n, late: 0n }], ["Depot 07", { parcels: 34n, late: 0n }], ["Depot 11", { parcels: 25n, late: 0n }], ["City counter", { parcels: 21n, late: 0n }], ["Partner pickup", { parcels: 18n, late: 0n }], ["Returns desk", { parcels: 12n, late: 0n }], ["Locker bank", { parcels: 9n, late: 0n }]]),
 *         }],
 *         ["r2", {
 *             region: new Map([["Metro", 354n], ["Regional", 183n], ["Remote", 73n]]),
 *             service: new Map([["Standard", 378n], ["Priority", 122n], ["Economy", 73n], ["International", 37n]]),
 *             origins: new Map([["Air hub", { parcels: 175n, late: 3n }], ["Harbour hub", { parcels: 145n, late: 4n }], ["Rail yard", { parcels: 74n, late: 1n }], ["Depot 02", { parcels: 56n, late: 1n }], ["Depot 05", { parcels: 45n, late: 0n }], ["Depot 07", { parcels: 33n, late: 0n }], ["Depot 11", { parcels: 24n, late: 0n }], ["City counter", { parcels: 20n, late: 0n }], ["Partner pickup", { parcels: 17n, late: 0n }], ["Returns desk", { parcels: 12n, late: 0n }], ["Locker bank", { parcels: 9n, late: 0n }]]),
 *         }],
 *     ]),
 *     mutations: (mutation) => ({ patch: mutation.patch() }),
 * });
 * export const StepCard = StructType({
 *     name: StringType,
 *     group: StringType,
 *     values: StructType({ name: StringType, slots: OptionType(IntegerType), flow: StringType }),
 * });
 * export const MoveCard = StructType({
 *     name: StringType,
 *     group: StringType,
 *     values: StructType({
 *         kind: VariantType({ planned: NullType, observed: NullType }), trigger: OptionType(StringType),
 *         volume: OptionType(FloatType), n: OptionType(IntegerType), at: OptionType(DateTimeType), flow: StringType,
 *     }),
 * });
 * export const stepCards = e3.record("flowchart_step_cards", DictType(StringType, StepCard), {
 *     initial: new Map([
 *         ["scan", { name: "Scan point", group: "Intake", values: { name: "Scan point", slots: none, flow: "Parcels" } }],
 *         ["chutes", { name: "Sort chutes", group: "Sort", values: { name: "Sort chutes", slots: some(12n), flow: "Parcels" } }],
 *         ["desk", { name: "Exception desk", group: "Hold", values: { name: "Exception desk", slots: none, flow: "Parcels" } }],
 *     ]),
 *     indexes: (index) => ({ flowchart_step_cards_by_group: index.on(["group"]) }),
 * });
 * export const moveCards = e3.record("flowchart_move_cards", DictType(StringType, MoveCard), {
 *     initial: new Map([
 *         ["planned", { name: "Planned", group: "Kinds",
 *             values: { kind: variant("planned", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" } }],
 *         ["reroute", { name: "Observed reroute", group: "Kinds",
 *             values: { kind: variant("observed", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" } }],
 *         ["routed", { name: "Routed by the sort plan", group: "Decisions",
 *             values: { kind: variant("planned", null), trigger: some("route"), volume: none, n: none, at: none, flow: "Parcels" } }],
 *     ]),
 *     indexes: (index) => ({ flowchart_move_cards_by_group: index.on(["group"]) }),
 * });
 * export const LaneCard = StructType({ name: StringType, group: StringType, values: StructType({ label: StringType }) });
 * export const laneCards = e3.record("flowchart_lane_cards", DictType(StringType, LaneCard), {
 *     initial: new Map([
 *         ["returns", { name: "Returns", group: "Lanes", values: { label: "Returns" } }],
 *         ["check", { name: "Quality check", group: "Lanes", values: { label: "Quality check" } }],
 *     ]),
 *     indexes: (index) => ({ flowchart_lane_cards_by_group: index.on(["group"]) }),
 * });
 * export const DecisionOwner = StructType({ name: StringType, desk: StringType });
 * export const decisionOwners = e3.input("flowchart_decision_owners", DictType(StringType, DecisionOwner), variant("value", new Map([
 *     ["sp", { name: "sort-planner", desk: "Sort office" }],
 *     ["cd", { name: "customs-desk", desk: "Customs" }],
 *     ["ns", { name: "night-supervisor", desk: "Night shift" }],
 * ])));
 *
 * const flowchartDepot = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         // The states and the transitions: editable through their patch doors, read through their sources of the rail.
 *         const states = $.let(Record.bind(depotStates));
 *         const stateEntries = $.let(Data.bindPaged(depotStates));
 *         const transitions = $.let(Record.bind(depotTransitions));
 *         const transitionEntries = $.let(Data.bindPaged(depotTransitions));
 *         // The lanes and the decisions: small records, read whole.
 *         const lanes = $.let(Record.bind(depotLanes));
 *         const decisions = $.let(Record.bind(depotDecisions));
 *         // The details, read by the drawn rows' keys, as their kinds are read through their sources.
 *         const stateRows = $.let(Data.bindPaged(stateEvidence));
 *         const moveRows = $.let(Data.bindPaged(moveEvidence));
 *         const steps = $.let(Data.bind(stepCards));
 *         const moves = $.let(Data.bind(moveCards));
 *         const laneRows = $.let(Data.bind(laneCards));
 *         const owners = $.let(Data.bind(decisionOwners));
 *         // One rail: the states and the transitions by their flow — the states by their lane too — and each list of
 *         // cards by its group. The flowchart opens on the parcels' flow; a preset picks a flow for both at once.
 *         const slice = $.let(Slice.bindRecords("flowchart.depot", {
 *             states: {
 *                 source: Data.bindPaged(depotStates, { indexes: ["flowchart_states_by_flow", "flowchart_states_by_lane"] }),
 *                 icon: { prefix: "fas", name: "circle-nodes" },
 *                 // Each field the rail offers is one an index answers: the flow, and the lane after it.
 *                 fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] }, phase: { label: "Lane" } },
 *                 initial: { flow: ["Parcels"] },
 *             },
 *             transitions: {
 *                 source: Data.bindPaged(depotTransitions, { indexes: ["flowchart_transitions_by_flow"] }),
 *                 icon: { prefix: "fas", name: "arrow-right-long" },
 *                 fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
 *                 initial: { flow: ["Parcels"] },
 *             },
 *             stepCards: { source: Data.bindPaged(stepCards, { indexes: ["flowchart_step_cards_by_group"] }), fields: { group: { label: "Group" } } },
 *             moveCards: { source: Data.bindPaged(moveCards, { indexes: ["flowchart_move_cards_by_group"] }), fields: { group: { label: "Group" } } },
 *             laneCards: { source: Data.bindPaged(laneCards, { indexes: ["flowchart_lane_cards_by_group"] }), fields: { group: { label: "Group" } } },
 *         }, { presets: [
 *             { id: "parcels", name: "Parcels", where: { states: { flow: ["Parcels"] }, transitions: { flow: ["Parcels"] } } },
 *             { id: "returns", name: "Returns", where: { states: { flow: ["Returns"] }, transitions: { flow: ["Returns"] } } },
 *         ] }));
 *         return (
 *             <Box height="640px">
 *                 <Flowchart
 *                     slice={{ slice }}
 *                     states={Flowchart.states(states, {
 *                         name: "State", icon: "circle-nodes", entries: stateEntries,
 *                         label: "name", lane: "phase", order: "seq",
 *                         members: (s) => s.slots,
 *                         // Drawn in this order on each state's card and in the inspector, each where its show says — "all" unless given.
 *                         details: Flowchart.details(stateRows, {
 *                             details: [
 *                                 Flowchart.figure("parcels", { label: "Parcels", unit: "parcels" }),
 *                                 Flowchart.figure("waiting", { label: "Still in state", show: "inspector" }),
 *                                 // each tag's look, as a Tag takes it — first defined, first shown
 *                                 Flowchart.tags("flags", {
 *                                     label: "Flags",
 *                                     colors: {
 *                                         "Hazmat": { colorPalette: "danger", variant: "solid" },
 *                                         "At risk": { colorPalette: "warning", variant: "subtle" },
 *                                         "Customs": { colorPalette: "brand", variant: "outline" },
 *                                         "Oversize": { colorPalette: "orange", variant: "subtle" },
 *                                         "Fragile": { colorPalette: "purple", variant: "subtle" },
 *                                         "Cold chain": { colorPalette: "info", variant: "subtle" },
 *                                     },
 *                                     legend: true,                   // the legend lists them, under "Flags"
 *                                 }),
 *                                 Flowchart.tags("equipment", {
 *                                     label: "Equipment",
 *                                     colors: {
 *                                         "Conveyor": { colorPalette: "teal" },          // subtle unless given
 *                                         "Scanner": { colorPalette: "blue" },
 *                                         "Forklift": { colorPalette: "gray", variant: "outline" },
 *                                         "Label printer": { colorPalette: "purple", variant: "outline" },
 *                                         "X-ray": { colorPalette: "info", variant: "outline" },
 *                                     },
 *                                     legend: true,
 *                                 }),
 *                                 Flowchart.tags("shifts", {
 *                                     label: "Shifts",
 *                                     colors: {
 *                                         "Early": { colorPalette: "yellow" },
 *                                         "Late": { colorPalette: "orange" },
 *                                         "Night": { colorPalette: "purple", variant: "solid" },
 *                                         "Weekend": { colorPalette: "gray" },
 *                                     },
 *                                 }),
 *                                 // the app's bins, in hours — a quarter hour apiece at first, then hours, days and a
 *                                 // week — a bar each whatever its span, on an axis naming 1h, 12h, 2d and 1w
 *                                 Flowchart.histogram("hours", {
 *                                     unit: "hours", label: "Time in state", counts: "parcels",
 *                                     bins: [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 96, 168],
 *                                     ticks: [1, 12, 48, 168],
 *                                 }),
 *                                 Flowchart.list("service", { label: "Service", top: 2, unit: "parcels" }),
 *                                 Flowchart.list("exceptions", { label: "Exceptions", unit: "parcels", show: "inspector" }),
 *                             ],
 *                         }),
 *                         // the Steps tab's cards: a card dropped on a lane adds a state there, from its values
 *                         templates: Flowchart.templates(steps.read(), {
 *                             name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards",
 *                         }),
 *                     })}
 *                     transitions={Flowchart.transitions(transitions, {
 *                         name: "Transition", icon: "arrow-right-long", entries: transitionEntries,
 *                         from: "src", to: "dst", decision: "trigger",
 *                         kind: (t) => t.kind,
 *                         evidence: (t) => some({ volume: t.volume, count: t.n, measuredAt: t.at, unit: some("parcels") }),
 *                         // Evidence shows them, so the form leaves them out.
 *                         fields: { volume: Fields.hidden(), n: Fields.hidden(), at: Fields.hidden() },
 *                         // The label draws the region under its evidence; the inspector shows all three.
 *                         details: Flowchart.details(moveRows, {
 *                             details: [
 *                                 Flowchart.list("region", { label: "Region", top: 1, unit: "parcels" }),
 *                                 Flowchart.list("service", { label: "Service", unit: "parcels", show: "inspector" }),
 *                                 // a Dict of structs: its draw says which number is the value, and a note
 *                                 Flowchart.list("origins", { label: "Origin", unit: "parcels", show: "inspector" },
 *                                     (o) => ({ value: o.parcels, note: some(East.str`${o.late} late`) })),
 *                             ],
 *                         }),
 *                         // the Transitions tab's cards: a card dropped on a transition gives it its values
 *                         templates: Flowchart.templates(moves.read(), {
 *                             name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "moveCards",
 *                         }),
 *                     })}
 *                     lanes={Flowchart.lanes(lanes, {
 *                         label: "label", order: "seq",
 *                         // the Lanes tab's cards: one dropped between two lanes adds a lane there, from its values
 *                         templates: Flowchart.templates(laneRows.read(), {
 *                             name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "laneCards",
 *                         }),
 *                     })}
 *                     decisions={Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) })}
 *                     library={[
 *                         Flowchart.library.states(),             // Steps: the states' cards, by group
 *                         Flowchart.library.transitions(),        // Transitions: the transitions' cards
 *                         Flowchart.library.lanes(),              // Lanes: the lanes' cards
 *                         Flowchart.library.tab(owners.read(), {
 *                             name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
 *                             // its patch is over a decision's row: dropped on a diamond, the card sets the decision's owner
 *                             drop: (o) => Flowchart.patch(DepotDecision, { owner: o.name }),
 *                         }),
 *                     ]}
 *                     freshness={{ label: "evidence-2026.06", date: new Date("2026-06-30T00:00:00Z") }}
 *                     name="depot"
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function flowchartTemplates<C extends EastType, V extends StructType>(
    rows: SubtypeExprOrValue<DictType<StringType, C>>, spec: FlowchartTemplatesSpec<C, V>,
): FlowchartTemplates<V> {
    const source = East.value(rows) as ExprType<DictType<StringType, C>>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict" || !isTypeEqual(type.key as EastType, StringType)) {
        throw new Error(`Flowchart.templates: the cards are a record's rows, keyed by String — a Dict, Data.bind(record).read() — and these are ${printType(type)}`);
    }
    const rowType = type.value as C;
    const values = East.function([rowType, StringType], undefined, (_$, row, key) => spec.values(row, key));
    const valuesType = (Expr.type(values as unknown as Expr) as FunctionType).output as V;
    if (valuesType.type !== "Struct") {
        throw new Error("Flowchart.templates: `values` returns a struct, every field of the row the card makes but what a drop writes");
    }
    const describe = East.function([rowType, StringType], FlowchartTemplateType, ($, row, key) => {
        const initial = $.const(values);
        return {
            key,
            name: spec.name(row, key),
            group: spec.group === undefined ? East.value(none, OptionType(StringType)) : spec.group(row, key),
            values: East.Blob.encodeBeast(initial(row as never, key) as ExprType<EastType>, "v2"),
        };
    });
    const items = source.toArray(($, row, key) => {
        const card = $.const(describe);
        return card(row as never, key);
    });
    return { [FLOWCHART_TEMPLATES]: true, valuesType, items, source: spec.source };
}

/**
 * Whether a kind's `templates` is a list of cards over a record.
 *
 * @param templates - What a kind was given
 * @returns Whether it is `Flowchart.templates`'
 */
export function isFlowchartTemplates(templates: unknown): templates is FlowchartTemplates<StructType> {
    return typeof templates === "object" && templates !== null && FLOWCHART_TEMPLATES in templates;
}

/**
 * Checks a kind's cards: `Flowchart.templates`', never a list written in the
 * code, their values of the type a drop of the kind takes.
 *
 * @param templates - What the kind was given
 * @param expected - The row's fields less what a drop writes
 * @param placed - The fields a drop writes, which the values leave out
 * @param where - The kind, as a refusal names it
 * @returns The cards on the wire, and the source they follow; `undefined` for a kind with no cards
 * @throws {Error} When they are not `Flowchart.templates`', or their values are of another type, naming both
 */
export function checkedFlowchartTemplates(templates: unknown, expected: StructType, placed: readonly string[], where: string):
    { readonly items: ExprType<ArrayType<FlowchartTemplateType>>; readonly source: string | undefined } | undefined {
    if (templates === undefined) return undefined;
    if (!isFlowchartTemplates(templates)) {
        throw new Error(`${where}: \`templates\` are records — Flowchart.templates(cards.read(), { name, values, source }) over a record of the app's, ` +
            "its source one of the slice's");
    }
    if (!isTypeEqual(templates.valuesType, expected)) {
        const named = placed.map((field) => `\`${field}\``);
        const but = named.length === 0 ? "" : ` but ${named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`}`;
        throw new Error(`${where}: its cards' \`values\` give every field of the row${but} — ${printType(expected)} — and these give ${printType(templates.valuesType)}`);
    }
    return { items: templates.items, source: templates.source };
}
