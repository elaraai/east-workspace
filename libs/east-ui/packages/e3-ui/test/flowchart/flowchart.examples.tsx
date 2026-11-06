/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SetType, StringType, StructType, VariantType,
    example, none, some, variant,
} from "@elaraai/east";
import { Badge, Box, Fields, Reactive, Slice, State, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Flowchart, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The Flowchart's examples (#1500, `Flowchart Records Spec.md` §2): one
// flowchart over the app's records — its states and its transitions, and
// beside them its lanes and its decisions, each a record of the app's keyed by
// String, its rows the app's own type and its fields mapped to the
// Flowchart's roles. No record here holds a type of the Flowchart's.
//
// - `flowchartDwell`, the front door: the states, the transitions and the
//   lanes, three records read whole, read only, and each state's time in
//   state on its card — one histogram, read from the app's own rows;
// - `flowchartDepot`, the depot in full: the states and the transitions read
//   through their sources of the rail and edited through their patch doors, a
//   preset narrowing both to one flow; the lanes and the decisions read
//   whole; both kinds' details on the cards, the labels, the legend and the
//   inspector, read by the drawn rows' keys; the services the rail picks
//   weighing the states' details, each read their own figures hold added up
//   by kind; and the library's Steps, Transitions, Lanes and Owners tabs, each
//   list of cards following its own source;
// - `flowchartDepotEditing`, the four records bound editable and read whole,
//   and the app's check on a drafted state;
// - `flowchartDepotDimmed`, the rail's choices drawn as context: every row
//   read through its source, those the narrowing leaves out faded, and the
//   states' details read by key, opening weighed by one service: Held's time
//   in state its international parcels' own, and the returns' states, which
//   hold none, saying no data;
// - `flowchartDepotPhone`, the depot at a phone's width: its cards keep their
//   bars and lines, and the canvas pans a lane at a time;
// - `flowchartDepotTopDown`, the depot read only and top down, its minimap
//   drawn, no pane, and each selection and traced path heard by the host;
// - `flowchartWording`, the depot in its own words (#1516): each kind named by
//   its own `name`, and `vocabulary` naming a transition's planned and
//   observed kinds;
// - `flowchartFlagColors`, each state's flags as tags on its card and in the
//   legend, their looks read from the app's own data;
// - `flowchartTicketMinutes`, a support desk's minutes in state on each card,
//   counted into the app's own uneven bins, the axis naming the edges it lists;
// - `flowchartTicketMinutesLinear`, the same bins drawn to scale: each bar as
//   wide as its span and as tall as its count over it.
//
// Each binds its records from e3, so the showcase draws each on e3-web. A
// flowchart fills its parent, as a ui task's page fills the window: each
// example gives it a box of its own height, and its own `name`, which keeps
// its viewer's state apart on a page showing them all. Every figure is made
// up.
// ============================================================================

// The depot's states, transitions, lanes and decisions: four records of the app's, keyed by String. A state's key
// is its code; a transition names its ends by their keys and its decision by the decision's, and a state its lane by
// the lane's.
export const DepotState = StructType({
    name: StringType,                         // what its card calls it
    phase: StringType,                        // the lane it stands in, by the lane's key
    seq: FloatType,                           // its place in its lane
    slots: OptionType(IntegerType),           // a class of interchangeable states: the ×N badge
    flow: StringType,                         // the flow it belongs to: one record holds the depot's flows
});
export const DepotTransition = StructType({
    src: StringType,                          // the state it leaves, by its key
    dst: StringType,                          // the state it enters
    kind: VariantType({ planned: NullType, observed: NullType }),
    trigger: OptionType(StringType),          // the decision that governs it, by its key
    volume: OptionType(FloatType),            // the parcels measured on it
    n: OptionType(IntegerType),               // the moves behind them
    at: OptionType(DateTimeType),             // when they were measured
    flow: StringType,
});
export const DepotLane = StructType({ label: StringType, seq: FloatType });
export const DepotDecision = StructType({ name: StringType, owner: StringType });

export const depotStates = e3.record("flowchart_depot_states", DictType(StringType, DepotState), {
    initial: new Map([
        ["ARV", { name: "Arrived", phase: "intake", seq: 1, slots: none, flow: "Parcels" }],
        ["SCN", { name: "Scanned", phase: "intake", seq: 2, slots: none, flow: "Parcels" }],
        ["IND", { name: "Inducted", phase: "induct", seq: 1, slots: none, flow: "Parcels" }],
        ["LBL", { name: "Relabelled", phase: "induct", seq: 2, slots: none, flow: "Parcels" }],
        ["CH*", { name: "Sort chutes (class)", phase: "sort", seq: 1, slots: some(14n), flow: "Parcels" }],
        ["SRD", { name: "Sorted", phase: "sort", seq: 2, slots: none, flow: "Parcels" }],
        ["HLD", { name: "Held", phase: "hold", seq: 1, slots: none, flow: "Parcels" }],
        ["CLR", { name: "Cleared", phase: "hold", seq: 2, slots: none, flow: "Parcels" }],
        ["LDD", { name: "Loaded", phase: "dispatch", seq: 1, slots: none, flow: "Parcels" }],
        ["DSP", { name: "Dispatched", phase: "dispatch", seq: 2, slots: none, flow: "Parcels" }],
        // The returns flow's states, beside the parcels'.
        ["RCV", { name: "Received", phase: "intake", seq: 3, slots: none, flow: "Returns" }],
        ["INS", { name: "Inspected", phase: "hold", seq: 3, slots: none, flow: "Returns" }],
        ["RSD", { name: "Resent", phase: "dispatch", seq: 3, slots: none, flow: "Returns" }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
    indexes: (index) => ({
        flowchart_states_by_flow: index.on(["flow"]),
        flowchart_states_by_lane: index.on(["flow", "phase"]),
    }),
});
export const depotTransitions = e3.record("flowchart_depot_transitions", DictType(StringType, DepotTransition), {
    initial: new Map([
        ["l1", { src: "ARV", dst: "SCN", kind: variant("planned", null), trigger: none, volume: some(18460), n: some(412n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l2", { src: "SCN", dst: "IND", kind: variant("planned", null), trigger: none, volume: some(18390), n: some(409n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        // In place: parcels inducted again, counted but not weighed.
        ["l3", { src: "IND", dst: "IND", kind: variant("observed", null), trigger: none, volume: none, n: some(2n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l4", { src: "IND", dst: "CH*", kind: variant("planned", null), trigger: some("route"), volume: some(17350), n: some(386n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l5", { src: "CH*", dst: "SRD", kind: variant("planned", null), trigger: none, volume: some(18210), n: some(405n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l6", { src: "SRD", dst: "HLD", kind: variant("planned", null), trigger: none, volume: some(8420), n: some(188n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l7", { src: "HLD", dst: "CLR", kind: variant("planned", null), trigger: some("customs"), volume: some(8350), n: some(186n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l8", { src: "CLR", dst: "LDD", kind: variant("planned", null), trigger: none, volume: some(8240), n: some(183n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l9", { src: "LDD", dst: "DSP", kind: variant("planned", null), trigger: none, volume: some(17030), n: some(378n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        // Its far end names a state no row is keyed by: drawn as a ghost, and listed in Issues.
        ["l10", { src: "DSP", dst: "DLV", kind: variant("planned", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" }],
        // Observed, not planned: parcels relabelled before they are sorted.
        ["l11", { src: "IND", dst: "LBL", kind: variant("observed", null), trigger: none, volume: some(980), n: some(22n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l12", { src: "LBL", dst: "CH*", kind: variant("observed", null), trigger: none, volume: some(975), n: some(22n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["l13", { src: "SRD", dst: "LDD", kind: variant("planned", null), trigger: none, volume: some(8790), n: some(195n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        ["r1", { src: "RCV", dst: "INS", kind: variant("planned", null), trigger: none, volume: some(640), n: some(15n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Returns" }],
        ["r2", { src: "INS", dst: "RSD", kind: variant("planned", null), trigger: none, volume: some(610), n: some(14n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Returns" }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
    indexes: (index) => ({
        flowchart_transitions_by_flow: index.on(["flow"]),
    }),
});
export const depotLanes = e3.record("flowchart_depot_lanes", DictType(StringType, DepotLane), {
    initial: new Map([
        ["intake", { label: "Intake", seq: 1 }], ["induct", { label: "Induct", seq: 2 }], ["sort", { label: "Sort", seq: 3 }],
        ["hold", { label: "Hold", seq: 4 }], ["dispatch", { label: "Dispatch", seq: 5 }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
export const depotDecisions = e3.record("flowchart_depot_decisions", DictType(StringType, DepotDecision), {
    initial: new Map([["route", { name: "route", owner: "sort-planner" }], ["customs", { name: "customs", owner: "customs-desk" }]]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

// Two records a flowchart can bind beside the depot's: its lanes as the sort plan fixes them, whose door refuses every
// change; and its decisions with the states queued at each.
/** The depot's lanes as the sort plan fixes them: the same lanes, which no Save changes. */
export const depotFixedLanes = e3.record("flowchart_depot_fixed_lanes", DictType(StringType, DepotLane), {
    initial: new Map([
        ["intake", { label: "Intake", seq: 1 }], ["induct", { label: "Induct", seq: 2 }], ["sort", { label: "Sort", seq: 3 }],
        ["hold", { label: "Hold", seq: 4 }], ["dispatch", { label: "Dispatch", seq: 5 }],
    ]),
    mutations: (mutation) => ({
        // A checked door: it refuses every change, naming why — what a Save over these lanes is answered.
        patch: mutation.reduce(East.function([DictType(StringType, DepotLane), PatchType(DictType(StringType, DepotLane))], DictType(StringType, DepotLane), ($, lanes, _patch) => {
            $.error("the lanes are fixed by the sort plan");
            return lanes;
        })),
    }),
});
/** A decision with the states queued at it, by key: a state's Del takes its key out of the queue. */
export const DepotQueuedDecision = StructType({ name: StringType, owner: StringType, queue: ArrayType(StringType) });
export const depotQueuedDecisions = e3.record("flowchart_depot_queued_decisions", DictType(StringType, DepotQueuedDecision), {
    initial: new Map([
        ["route", { name: "route", owner: "sort-planner", queue: ["IND", "SRD"] }],
        ["customs", { name: "customs", owner: "customs-desk", queue: ["HLD"] }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

// What one service's parcels did in a state: the same figures as the state's own, for that service alone.
export const ServiceEvidence = StructType({
    flags: SetType(StringType),                       // what the app's task flags this service's parcels with
    parcels: IntegerType,                             // its parcels through the state
    waiting: IntegerType,                             // still in it when measured
    hours: ArrayType(IntegerType),                    // its parcels by time in state: a count a bin, in the bins' order
    exceptions: DictType(StringType, IntegerType),    // its parcels by what went wrong
});
// What the depot measured in each state and on each transition: the app's own rows, keyed as the states and
// the transitions are, written by its evidence task through each record's door.
export const StateEvidence = StructType({
    flags: SetType(StringType),                       // what the app's task flags the state with
    equipment: SetType(StringType),                   // what handles parcels there
    shifts: SetType(StringType),                      // the shifts that staff it
    parcels: IntegerType,                             // through the state
    waiting: IntegerType,                             // still in it when measured
    hours: ArrayType(IntegerType),                    // parcels by time in state: a count a bin, in the bins' order
    service: DictType(StringType, IntegerType),       // parcels by service
    exceptions: DictType(StringType, IntegerType),    // parcels by what went wrong
    byService: DictType(StringType, ServiceEvidence), // each service's own: Standard, Priority, Economy, International
});
export const MoveEvidence = StructType({
    region: DictType(StringType, IntegerType),
    service: DictType(StringType, IntegerType),
    origins: DictType(StringType, StructType({ parcels: IntegerType, late: IntegerType })),
});
// What the evidence task last wrote, made up: a row a state but Dispatched, whose card says no data. Each row
// files each service's own figures apart, which add up to its own: their parcels are its Service list's counts,
// their waiting adds to its waiting, their hours bin by bin to its hours, their exceptions by name to its
// exceptions, and their flags join to its flags. The returns take no international parcels: their states hold no
// International entry.
export const stateEvidence = e3.record("flowchart_depot_state_evidence", DictType(StringType, StateEvidence), {
    initial: new Map([
        ["ARV", {
            flags: new Set<string>(), equipment: new Set(["Conveyor"]), shifts: new Set(["Early", "Late", "Night"]),
            parcels: 18460n, waiting: 60n,
            hours: [5538n, 6277n, 3692n, 1846n, 738n, 369n, 0n, 0n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 10337n], ["Priority", 4615n], ["Economy", 2400n], ["International", 1108n]]),
            exceptions: new Map([["Late arrival", 52n], ["Damaged packaging", 11n]]),
            byService: new Map([
                ["Standard", { flags: new Set<string>(), parcels: 10337n, waiting: 33n, hours: [3005n, 3534n, 2118n, 1062n, 417n, 201n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Late arrival", 26n], ["Damaged packaging", 6n]]) }],
                ["Priority", { flags: new Set<string>(), parcels: 4615n, waiting: 15n, hours: [1735n, 1637n, 788n, 316n, 100n, 39n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Late arrival", 11n], ["Damaged packaging", 3n]]) }],
                ["Economy", { flags: new Set<string>(), parcels: 2400n, waiting: 8n, hours: [589n, 781n, 528n, 298n, 132n, 72n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Late arrival", 12n], ["Damaged packaging", 1n]]) }],
                ["International", { flags: new Set<string>(), parcels: 1108n, waiting: 4n, hours: [209n, 325n, 258n, 170n, 89n, 57n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Late arrival", 3n], ["Damaged packaging", 1n]]) }],
            ]),
        }],
        ["SCN", {
            flags: new Set(["Fragile"]), equipment: new Set(["Scanner", "Conveyor"]), shifts: new Set(["Early", "Late", "Night"]),
            parcels: 18390n, waiting: 35n,
            hours: [7723n, 5701n, 2759n, 1471n, 552n, 184n, 0n, 0n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 10298n], ["Priority", 4598n], ["Economy", 2391n], ["International", 1103n]]),
            exceptions: new Map([["Unreadable label", 61n], ["Damaged packaging", 9n]]),
            byService: new Map([
                ["Standard", { flags: new Set(["Fragile"]), parcels: 10298n, waiting: 20n, hours: [4236n, 3228n, 1584n, 842n, 309n, 99n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Unreadable label", 34n], ["Damaged packaging", 5n]]) }],
                ["Priority", { flags: new Set<string>(), parcels: 4598n, waiting: 9n, hours: [2307n, 1411n, 555n, 237n, 70n, 18n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Unreadable label", 15n], ["Damaged packaging", 2n]]) }],
                ["Economy", { flags: new Set<string>(), parcels: 2391n, waiting: 4n, hours: [860n, 739n, 409n, 245n, 101n, 37n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Unreadable label", 8n], ["Damaged packaging", 1n]]) }],
                ["International", { flags: new Set<string>(), parcels: 1103n, waiting: 2n, hours: [320n, 323n, 211n, 147n, 72n, 30n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Unreadable label", 4n], ["Damaged packaging", 1n]]) }],
            ]),
        }],
        ["IND", {
            flags: new Set(["Oversize", "Fragile"]), equipment: new Set(["Conveyor", "Scanner"]), shifts: new Set(["Early", "Late"]),
            parcels: 18390n, waiting: 120n,
            hours: [2207n, 4781n, 5517n, 3310n, 1655n, 736n, 184n, 0n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 10482n], ["Priority", 4414n], ["Economy", 2391n], ["International", 1103n]]),
            exceptions: new Map([["Missort", 22n]]),
            byService: new Map([
                ["Standard", { flags: new Set(["Oversize", "Fragile"]), parcels: 10482n, waiting: 68n, hours: [1183n, 2685n, 3191n, 1939n, 964n, 419n, 101n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 13n]]) }],
                ["Priority", { flags: new Set<string>(), parcels: 4414n, waiting: 29n, hours: [750n, 1367n, 1303n, 635n, 254n, 88n, 17n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 5n]]) }],
                ["Economy", { flags: new Set(["Oversize"]), parcels: 2391n, waiting: 16n, hours: [209n, 533n, 715n, 489n, 274n, 135n, 36n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 3n]]) }],
                ["International", { flags: new Set<string>(), parcels: 1103n, waiting: 7n, hours: [65n, 196n, 308n, 247n, 163n, 94n, 30n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 1n]]) }],
            ]),
        }],
        ["LBL", {
            flags: new Set(["At risk"]), equipment: new Set(["Label printer", "Scanner"]), shifts: new Set(["Late"]),
            parcels: 980n, waiting: 15n,
            hours: [20n, 59n, 137n, 255n, 273n, 157n, 59n, 20n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 471n], ["Priority", 294n], ["Economy", 137n], ["International", 78n]]),
            exceptions: new Map([["Unreadable label", 712n], ["Address check", 268n]]),
            byService: new Map([
                ["Standard", { flags: new Set<string>(), parcels: 471n, waiting: 7n, hours: [9n, 25n, 63n, 123n, 135n, 78n, 29n, 9n, 0n, 0n, 0n, 0n], exceptions: new Map([["Unreadable label", 342n], ["Address check", 129n]]) }],
                ["Priority", { flags: new Set(["At risk"]), parcels: 294n, waiting: 5n, hours: [10n, 27n, 53n, 83n, 74n, 34n, 10n, 3n, 0n, 0n, 0n, 0n], exceptions: new Map([["Unreadable label", 214n], ["Address check", 80n]]) }],
                ["Economy", { flags: new Set<string>(), parcels: 137n, waiting: 2n, hours: [1n, 5n, 15n, 33n, 41n, 27n, 11n, 4n, 0n, 0n, 0n, 0n], exceptions: new Map([["Unreadable label", 99n], ["Address check", 38n]]) }],
                ["International", { flags: new Set<string>(), parcels: 78n, waiting: 1n, hours: [0n, 2n, 6n, 16n, 23n, 18n, 9n, 4n, 0n, 0n, 0n, 0n], exceptions: new Map([["Unreadable label", 57n], ["Address check", 21n]]) }],
            ]),
        }],
        ["CH*", {
            flags: new Set(["At risk"]), equipment: new Set(["Conveyor", "Scanner"]), shifts: new Set(["Early", "Late", "Night", "Weekend"]),
            parcels: 18290n, waiting: 140n,
            hours: [1463n, 4024n, 6218n, 4024n, 1646n, 732n, 183n, 0n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 10425n], ["Priority", 4390n], ["Economy", 2378n], ["International", 1097n]]),
            exceptions: new Map([["Missort", 41n], ["Chute full", 26n]]),
            byService: new Map([
                ["Standard", { flags: new Set<string>(), parcels: 10425n, waiting: 80n, hours: [776n, 2242n, 3579n, 2350n, 960n, 418n, 100n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 23n], ["Chute full", 15n]]) }],
                ["Priority", { flags: new Set(["At risk"]), parcels: 4390n, waiting: 34n, hours: [512n, 1186n, 1519n, 801n, 262n, 92n, 18n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 10n], ["Chute full", 6n]]) }],
                ["Economy", { flags: new Set<string>(), parcels: 2378n, waiting: 18n, hours: [134n, 438n, 787n, 583n, 268n, 132n, 36n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 5n], ["Chute full", 3n]]) }],
                ["International", { flags: new Set<string>(), parcels: 1097n, waiting: 8n, hours: [41n, 158n, 333n, 290n, 156n, 90n, 29n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 3n], ["Chute full", 2n]]) }],
            ]),
        }],
        ["SRD", {
            flags: new Set(["Fragile"]), equipment: new Set(["Conveyor"]), shifts: new Set(["Early", "Late"]),
            parcels: 17210n, waiting: 50n,
            hours: [861n, 2065n, 4303n, 4818n, 3098n, 1377n, 516n, 172n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 9981n], ["Priority", 4303n], ["Economy", 2065n], ["International", 861n]]),
            exceptions: new Map([["Missort", 14n], ["Damaged packaging", 6n]]),
            byService: new Map([
                ["Standard", { flags: new Set(["Fragile"]), parcels: 9981n, waiting: 29n, hours: [441n, 1128n, 2467n, 2852n, 1863n, 827n, 305n, 98n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 8n], ["Damaged packaging", 3n]]) }],
                ["Priority", { flags: new Set<string>(), parcels: 4303n, waiting: 12n, hours: [341n, 701n, 1230n, 1141n, 598n, 213n, 63n, 16n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 3n], ["Damaged packaging", 2n]]) }],
                ["Economy", { flags: new Set<string>(), parcels: 2065n, waiting: 6n, hours: [63n, 183n, 453n, 591n, 434n, 218n, 90n, 33n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 2n], ["Damaged packaging", 1n]]) }],
                ["International", { flags: new Set<string>(), parcels: 861n, waiting: 3n, hours: [16n, 53n, 153n, 234n, 203n, 119n, 58n, 25n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missort", 1n]]) }],
            ]),
        }],
        ["HLD", {
            flags: new Set(["Customs", "Hazmat", "At risk", "Cold chain", "Oversize"]), equipment: new Set(["Forklift", "X-ray", "Scanner"]), shifts: new Set(["Early", "Late"]),
            parcels: 1080n, waiting: 70n,
            hours: [0n, 11n, 22n, 54n, 97n, 151n, 183n, 162n, 173n, 130n, 65n, 32n],
            service: new Map([["Standard", 335n], ["Priority", 130n], ["Economy", 76n], ["International", 539n]]),
            exceptions: new Map([["Missing documents", 412n], ["Duty unpaid", 236n], ["Address check", 98n], ["Damaged packaging", 44n]]),
            byService: new Map([
                ["Standard", { flags: new Set(["Oversize"]), parcels: 335n, waiting: 22n, hours: [0n, 4n, 9n, 22n, 39n, 57n, 63n, 50n, 45n, 29n, 12n, 5n], exceptions: new Map([["Missing documents", 28n], ["Duty unpaid", 11n], ["Address check", 30n], ["Damaged packaging", 14n]]) }],
                ["Priority", { flags: new Set(["At risk", "Cold chain"]), parcels: 130n, waiting: 8n, hours: [0n, 5n, 8n, 15n, 22n, 26n, 23n, 14n, 10n, 5n, 2n, 0n], exceptions: new Map([["Missing documents", 11n], ["Duty unpaid", 4n], ["Address check", 12n], ["Damaged packaging", 5n]]) }],
                ["Economy", { flags: new Set(["Hazmat", "Oversize"]), parcels: 76n, waiting: 5n, hours: [0n, 1n, 1n, 3n, 7n, 11n, 14n, 12n, 12n, 9n, 4n, 2n], exceptions: new Map([["Missing documents", 7n], ["Duty unpaid", 3n], ["Address check", 7n], ["Damaged packaging", 3n]]) }],
                ["International", { flags: new Set(["Customs"]), parcels: 539n, waiting: 35n, hours: [0n, 1n, 4n, 14n, 29n, 57n, 83n, 86n, 106n, 87n, 47n, 25n], exceptions: new Map([["Missing documents", 366n], ["Duty unpaid", 218n], ["Address check", 49n], ["Damaged packaging", 22n]]) }],
            ]),
        }],
        ["CLR", {
            flags: new Set(["Customs"]), equipment: new Set(["Label printer", "Scanner", "X-ray"]), shifts: new Set(["Early", "Late"]),
            parcels: 18170n, waiting: 18n,
            hours: [1817n, 3634n, 4542n, 3634n, 2180n, 1454n, 727n, 182n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 10175n], ["Priority", 4361n], ["Economy", 2362n], ["International", 1272n]]),
            exceptions: new Map([["Duty refund", 12n]]),
            byService: new Map([
                ["Standard", { flags: new Set<string>(), parcels: 10175n, waiting: 10n, hours: [943n, 1989n, 2575n, 2097n, 1257n, 823n, 397n, 94n, 0n, 0n, 0n, 0n], exceptions: new Map([["Duty refund", 4n]]) }],
                ["Priority", { flags: new Set<string>(), parcels: 4361n, waiting: 4n, hours: [663n, 1122n, 1166n, 762n, 367n, 193n, 74n, 14n, 0n, 0n, 0n, 0n], exceptions: new Map([["Duty refund", 2n]]) }],
                ["Economy", { flags: new Set<string>(), parcels: 2362n, waiting: 3n, hours: [159n, 377n, 551n, 506n, 342n, 253n, 137n, 37n, 0n, 0n, 0n, 0n], exceptions: new Map([["Duty refund", 1n]]) }],
                ["International", { flags: new Set(["Customs"]), parcels: 1272n, waiting: 1n, hours: [52n, 146n, 250n, 269n, 214n, 185n, 119n, 37n, 0n, 0n, 0n, 0n], exceptions: new Map([["Duty refund", 5n]]) }],
            ]),
        }],
        ["LDD", {
            flags: new Set(["Hazmat", "Oversize"]), equipment: new Set(["Forklift", "Scanner"]), shifts: new Set(["Early", "Late", "Night"]),
            parcels: 17030n, waiting: 210n,
            hours: [681n, 1362n, 2725n, 4088n, 3747n, 2384n, 1362n, 511n, 170n, 0n, 0n, 0n],
            service: new Map([["Standard", 9707n], ["Priority", 4087n], ["Economy", 2214n], ["International", 1022n]]),
            exceptions: new Map([["Vehicle late", 140n], ["Overweight", 31n]]),
            byService: new Map([
                ["Standard", { flags: new Set(["Oversize"]), parcels: 9707n, waiting: 120n, hours: [334n, 717n, 1515n, 2358n, 2205n, 1407n, 792n, 288n, 91n, 0n, 0n, 0n], exceptions: new Map([["Vehicle late", 75n], ["Overweight", 18n]]) }],
                ["Priority", { flags: new Set<string>(), parcels: 4087n, waiting: 50n, hours: [286n, 493n, 835n, 1043n, 782n, 401n, 181n, 53n, 13n, 0n, 0n, 0n], exceptions: new Map([["Vehicle late", 31n], ["Overweight", 7n]]) }],
                ["Economy", { flags: new Set(["Hazmat", "Oversize"]), parcels: 2214n, waiting: 27n, hours: [49n, 119n, 282n, 495n, 522n, 375n, 239n, 98n, 35n, 0n, 0n, 0n], exceptions: new Map([["Vehicle late", 26n], ["Overweight", 4n]]) }],
                ["International", { flags: new Set<string>(), parcels: 1022n, waiting: 13n, hours: [12n, 33n, 93n, 192n, 238n, 201n, 150n, 72n, 31n, 0n, 0n, 0n], exceptions: new Map([["Vehicle late", 8n], ["Overweight", 2n]]) }],
            ]),
        }],
        ["RCV", {
            flags: new Set(["Fragile"]), equipment: new Set(["Scanner"]), shifts: new Set(["Weekend"]),
            parcels: 640n, waiting: 25n,
            hours: [64n, 115n, 154n, 141n, 90n, 51n, 19n, 6n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 435n], ["Priority", 128n], ["Economy", 77n]]),
            exceptions: new Map([["Missing documents", 18n]]),
            byService: new Map([
                ["Standard", { flags: new Set(["Fragile"]), parcels: 435n, waiting: 17n, hours: [39n, 75n, 104n, 98n, 64n, 37n, 14n, 4n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missing documents", 12n]]) }],
                ["Priority", { flags: new Set<string>(), parcels: 128n, waiting: 5n, hours: [19n, 29n, 33n, 25n, 13n, 6n, 2n, 1n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missing documents", 4n]]) }],
                ["Economy", { flags: new Set<string>(), parcels: 77n, waiting: 3n, hours: [6n, 11n, 17n, 18n, 13n, 8n, 3n, 1n, 0n, 0n, 0n, 0n], exceptions: new Map([["Missing documents", 2n]]) }],
            ]),
        }],
        ["INS", {
            flags: new Set(["At risk", "Customs"]), equipment: new Set(["X-ray"]), shifts: new Set(["Early"]),
            parcels: 640n, waiting: 30n,
            hours: [0n, 13n, 38n, 77n, 128n, 154n, 115n, 64n, 38n, 13n, 0n, 0n],
            service: new Map([["Standard", 435n], ["Priority", 128n], ["Economy", 77n]]),
            exceptions: new Map([["Damaged packaging", 27n]]),
            byService: new Map([
                ["Standard", { flags: new Set(["Customs"]), parcels: 435n, waiting: 20n, hours: [0n, 7n, 23n, 49n, 86n, 106n, 81n, 46n, 27n, 10n, 0n, 0n], exceptions: new Map([["Damaged packaging", 18n]]) }],
                ["Priority", { flags: new Set(["At risk"]), parcels: 128n, waiting: 6n, hours: [0n, 5n, 12n, 21n, 29n, 30n, 18n, 8n, 4n, 1n, 0n, 0n], exceptions: new Map([["Damaged packaging", 6n]]) }],
                ["Economy", { flags: new Set<string>(), parcels: 77n, waiting: 4n, hours: [0n, 1n, 3n, 7n, 13n, 18n, 16n, 10n, 7n, 2n, 0n, 0n], exceptions: new Map([["Damaged packaging", 3n]]) }],
            ]),
        }],
        ["RSD", {
            flags: new Set<string>(), equipment: new Set(["Scanner"]), shifts: new Set(["Early"]),
            parcels: 610n, waiting: 0n,
            hours: [122n, 183n, 159n, 85n, 43n, 18n, 0n, 0n, 0n, 0n, 0n, 0n],
            service: new Map([["Standard", 415n], ["Priority", 122n], ["Economy", 73n]]),
            exceptions: new Map<string, bigint>(),
            byService: new Map([
                ["Standard", { flags: new Set<string>(), parcels: 415n, waiting: 0n, hours: [78n, 123n, 110n, 60n, 31n, 13n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map<string, bigint>() }],
                ["Priority", { flags: new Set<string>(), parcels: 122n, waiting: 0n, hours: [32n, 41n, 29n, 13n, 5n, 2n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map<string, bigint>() }],
                ["Economy", { flags: new Set<string>(), parcels: 73n, waiting: 0n, hours: [12n, 19n, 20n, 12n, 7n, 3n, 0n, 0n, 0n, 0n, 0n, 0n], exceptions: new Map<string, bigint>() }],
            ]),
        }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
    // Each service's own figures, a range of the index by the service's name: what the rail's picks read.
    indexes: (index) => ({ flowchart_evidence_by_service: index.entries("byService") }),
});
// A row a transition with a volume: the in-place one and the one to Delivered have none, and their labels keep their evidence alone.
export const moveEvidence = e3.record("flowchart_depot_move_evidence", DictType(StringType, MoveEvidence), {
    initial: new Map([
        ["l1", {
            region: new Map([["Metro", 8491n], ["Regional", 6092n], ["Remote", 2769n], ["Overseas", 1108n]]),
            service: new Map([["Standard", 10337n], ["Priority", 4615n], ["Economy", 2400n], ["International", 1108n]]),
            origins: new Map([["Air hub", { parcels: 5350n, late: 84n }], ["Harbour hub", { parcels: 4377n, late: 135n }], ["Rail yard", { parcels: 2233n, late: 27n }], ["Depot 02", { parcels: 1680n, late: 20n }], ["Depot 05", { parcels: 1349n, late: 9n }], ["Depot 07", { parcels: 995n, late: 13n }], ["Depot 11", { parcels: 730n, late: 4n }], ["City counter", { parcels: 619n, late: 7n }], ["Partner pickup", { parcels: 508n, late: 11n }], ["Returns desk", { parcels: 354n, late: 2n }], ["Locker bank", { parcels: 265n, late: 0n }]]),
        }],
        ["l2", {
            region: new Map([["Metro", 8459n], ["Regional", 6069n], ["Remote", 2759n], ["Overseas", 1103n]]),
            service: new Map([["Standard", 10298n], ["Priority", 4598n], ["Economy", 2391n], ["International", 1103n]]),
            origins: new Map([["Air hub", { parcels: 5330n, late: 84n }], ["Harbour hub", { parcels: 4361n, late: 134n }], ["Rail yard", { parcels: 2224n, late: 26n }], ["Depot 02", { parcels: 1674n, late: 20n }], ["Depot 05", { parcels: 1343n, late: 9n }], ["Depot 07", { parcels: 991n, late: 13n }], ["Depot 11", { parcels: 727n, late: 4n }], ["City counter", { parcels: 617n, late: 7n }], ["Partner pickup", { parcels: 507n, late: 11n }], ["Returns desk", { parcels: 352n, late: 2n }], ["Locker bank", { parcels: 264n, late: 0n }]]),
        }],
        ["l4", {
            region: new Map([["Metro", 8153n], ["Regional", 5726n], ["Remote", 2603n], ["Overseas", 868n]]),
            service: new Map([["Standard", 9889n], ["Priority", 4164n], ["Economy", 2256n], ["International", 1041n]]),
            origins: new Map([["Air hub", { parcels: 5029n, late: 79n }], ["Harbour hub", { parcels: 4114n, late: 127n }], ["Rail yard", { parcels: 2099n, late: 25n }], ["Depot 02", { parcels: 1579n, late: 19n }], ["Depot 05", { parcels: 1267n, late: 8n }], ["Depot 07", { parcels: 935n, late: 12n }], ["Depot 11", { parcels: 686n, late: 4n }], ["City counter", { parcels: 582n, late: 6n }], ["Partner pickup", { parcels: 478n, late: 10n }], ["Returns desk", { parcels: 332n, late: 2n }], ["Locker bank", { parcels: 249n, late: 0n }]]),
        }],
        ["l5", {
            region: new Map([["Metro", 8376n], ["Regional", 6009n], ["Remote", 2732n], ["Overseas", 1093n]]),
            service: new Map([["Standard", 10380n], ["Priority", 4370n], ["Economy", 2367n], ["International", 1093n]]),
            origins: new Map([["Air hub", { parcels: 5277n, late: 83n }], ["Harbour hub", { parcels: 4318n, late: 133n }], ["Rail yard", { parcels: 2203n, late: 26n }], ["Depot 02", { parcels: 1657n, late: 20n }], ["Depot 05", { parcels: 1330n, late: 9n }], ["Depot 07", { parcels: 981n, late: 13n }], ["Depot 11", { parcels: 720n, late: 4n }], ["City counter", { parcels: 611n, late: 7n }], ["Partner pickup", { parcels: 502n, late: 11n }], ["Returns desk", { parcels: 349n, late: 2n }], ["Locker bank", { parcels: 262n, late: 0n }]]),
        }],
        ["l6", {
            region: new Map([["Metro", 1179n], ["Regional", 758n], ["Remote", 421n], ["Overseas", 6062n]]),
            service: new Map([["Standard", 2610n], ["Priority", 1010n], ["Economy", 589n], ["International", 4211n]]),
            origins: new Map([["Air hub", { parcels: 2441n, late: 38n }], ["Harbour hub", { parcels: 1997n, late: 62n }], ["Rail yard", { parcels: 1018n, late: 12n }], ["Depot 02", { parcels: 766n, late: 9n }], ["Depot 05", { parcels: 615n, late: 4n }], ["Depot 07", { parcels: 454n, late: 6n }], ["Depot 11", { parcels: 333n, late: 2n }], ["City counter", { parcels: 282n, late: 3n }], ["Partner pickup", { parcels: 232n, late: 5n }], ["Returns desk", { parcels: 161n, late: 1n }], ["Locker bank", { parcels: 121n, late: 0n }]]),
        }],
        ["l7", {
            region: new Map([["Metro", 1169n], ["Regional", 752n], ["Remote", 418n], ["Overseas", 6011n]]),
            service: new Map([["Standard", 2589n], ["Priority", 1002n], ["Economy", 585n], ["International", 4174n]]),
            origins: new Map([["Air hub", { parcels: 2420n, late: 38n }], ["Harbour hub", { parcels: 1980n, late: 61n }], ["Rail yard", { parcels: 1010n, late: 12n }], ["Depot 02", { parcels: 760n, late: 9n }], ["Depot 05", { parcels: 610n, late: 4n }], ["Depot 07", { parcels: 450n, late: 6n }], ["Depot 11", { parcels: 330n, late: 2n }], ["City counter", { parcels: 280n, late: 3n }], ["Partner pickup", { parcels: 230n, late: 5n }], ["Returns desk", { parcels: 160n, late: 1n }], ["Locker bank", { parcels: 120n, late: 0n }]]),
        }],
        ["l8", {
            region: new Map([["Metro", 3296n], ["Regional", 2472n], ["Remote", 1154n], ["Overseas", 1318n]]),
            service: new Map([["Standard", 4120n], ["Priority", 1813n], ["Economy", 989n], ["International", 1318n]]),
            origins: new Map([["Air hub", { parcels: 2388n, late: 37n }], ["Harbour hub", { parcels: 1954n, late: 60n }], ["Rail yard", { parcels: 997n, late: 12n }], ["Depot 02", { parcels: 750n, late: 9n }], ["Depot 05", { parcels: 602n, late: 4n }], ["Depot 07", { parcels: 444n, late: 6n }], ["Depot 11", { parcels: 326n, late: 2n }], ["City counter", { parcels: 276n, late: 3n }], ["Partner pickup", { parcels: 227n, late: 5n }], ["Returns desk", { parcels: 158n, late: 1n }], ["Locker bank", { parcels: 118n, late: 0n }]]),
        }],
        ["l9", {
            region: new Map([["Metro", 8003n], ["Regional", 5620n], ["Remote", 2555n], ["Overseas", 852n]]),
            service: new Map([["Standard", 9876n], ["Priority", 4258n], ["Economy", 2044n], ["International", 852n]]),
            origins: new Map([["Air hub", { parcels: 4936n, late: 78n }], ["Harbour hub", { parcels: 4038n, late: 124n }], ["Rail yard", { parcels: 2060n, late: 24n }], ["Depot 02", { parcels: 1550n, late: 18n }], ["Depot 05", { parcels: 1244n, late: 8n }], ["Depot 07", { parcels: 918n, late: 12n }], ["Depot 11", { parcels: 673n, late: 4n }], ["City counter", { parcels: 571n, late: 6n }], ["Partner pickup", { parcels: 469n, late: 10n }], ["Returns desk", { parcels: 326n, late: 2n }], ["Locker bank", { parcels: 245n, late: 0n }]]),
        }],
        ["l11", {
            region: new Map([["Metro", 294n], ["Regional", 274n], ["Remote", 216n], ["Overseas", 196n]]),
            service: new Map([["Standard", 471n], ["Priority", 294n], ["Economy", 137n], ["International", 78n]]),
            origins: new Map([["Air hub", { parcels: 283n, late: 4n }], ["Harbour hub", { parcels: 232n, late: 7n }], ["Rail yard", { parcels: 119n, late: 1n }], ["Depot 02", { parcels: 89n, late: 1n }], ["Depot 05", { parcels: 72n, late: 0n }], ["Depot 07", { parcels: 53n, late: 1n }], ["Depot 11", { parcels: 39n, late: 0n }], ["City counter", { parcels: 33n, late: 0n }], ["Partner pickup", { parcels: 27n, late: 1n }], ["Returns desk", { parcels: 19n, late: 0n }], ["Locker bank", { parcels: 14n, late: 0n }]]),
        }],
        ["l12", {
            region: new Map([["Metro", 292n], ["Regional", 273n], ["Remote", 215n], ["Overseas", 195n]]),
            service: new Map([["Standard", 467n], ["Priority", 293n], ["Economy", 137n], ["International", 78n]]),
            origins: new Map([["Air hub", { parcels: 281n, late: 4n }], ["Harbour hub", { parcels: 231n, late: 7n }], ["Rail yard", { parcels: 118n, late: 1n }], ["Depot 02", { parcels: 89n, late: 1n }], ["Depot 05", { parcels: 71n, late: 0n }], ["Depot 07", { parcels: 53n, late: 1n }], ["Depot 11", { parcels: 39n, late: 0n }], ["City counter", { parcels: 33n, late: 0n }], ["Partner pickup", { parcels: 27n, late: 1n }], ["Returns desk", { parcels: 19n, late: 0n }], ["Locker bank", { parcels: 14n, late: 0n }]]),
        }],
        ["l13", {
            region: new Map([["Metro", 4570n], ["Regional", 2989n], ["Remote", 1055n], ["Overseas", 176n]]),
            service: new Map([["Standard", 5450n], ["Priority", 2285n], ["Economy", 1055n]]),
            origins: new Map([["Air hub", { parcels: 2549n, late: 40n }], ["Harbour hub", { parcels: 2084n, late: 64n }], ["Rail yard", { parcels: 1063n, late: 13n }], ["Depot 02", { parcels: 800n, late: 9n }], ["Depot 05", { parcels: 642n, late: 4n }], ["Depot 07", { parcels: 474n, late: 6n }], ["Depot 11", { parcels: 347n, late: 2n }], ["City counter", { parcels: 295n, late: 3n }], ["Partner pickup", { parcels: 242n, late: 5n }], ["Returns desk", { parcels: 168n, late: 1n }], ["Locker bank", { parcels: 126n, late: 0n }]]),
        }],
        ["r1", {
            region: new Map([["Metro", 371n], ["Regional", 192n], ["Remote", 77n]]),
            service: new Map([["Standard", 397n], ["Priority", 128n], ["Economy", 77n], ["International", 38n]]),
            origins: new Map([["Air hub", { parcels: 187n, late: 3n }], ["Harbour hub", { parcels: 152n, late: 5n }], ["Rail yard", { parcels: 77n, late: 1n }], ["Depot 02", { parcels: 58n, late: 1n }], ["Depot 05", { parcels: 47n, late: 0n }], ["Depot 07", { parcels: 34n, late: 0n }], ["Depot 11", { parcels: 25n, late: 0n }], ["City counter", { parcels: 21n, late: 0n }], ["Partner pickup", { parcels: 18n, late: 0n }], ["Returns desk", { parcels: 12n, late: 0n }], ["Locker bank", { parcels: 9n, late: 0n }]]),
        }],
        ["r2", {
            region: new Map([["Metro", 354n], ["Regional", 183n], ["Remote", 73n]]),
            service: new Map([["Standard", 378n], ["Priority", 122n], ["Economy", 73n], ["International", 37n]]),
            origins: new Map([["Air hub", { parcels: 175n, late: 3n }], ["Harbour hub", { parcels: 145n, late: 4n }], ["Rail yard", { parcels: 74n, late: 1n }], ["Depot 02", { parcels: 56n, late: 1n }], ["Depot 05", { parcels: 45n, late: 0n }], ["Depot 07", { parcels: 33n, late: 0n }], ["Depot 11", { parcels: 24n, late: 0n }], ["City counter", { parcels: 20n, late: 0n }], ["Partner pickup", { parcels: 17n, late: 0n }], ["Returns desk", { parcels: 12n, late: 0n }], ["Locker bank", { parcels: 9n, late: 0n }]]),
        }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

// The library's cards, records the app's users keep: each a name, a group and the values a new row takes — a state's
// every field but its lane and its place, a transition's every field but its ends.
export const StepCard = StructType({
    name: StringType,
    group: StringType,
    values: StructType({ name: StringType, slots: OptionType(IntegerType), flow: StringType }),
});
export const MoveCard = StructType({
    name: StringType,
    group: StringType,
    values: StructType({
        kind: VariantType({ planned: NullType, observed: NullType }), trigger: OptionType(StringType),
        volume: OptionType(FloatType), n: OptionType(IntegerType), at: OptionType(DateTimeType), flow: StringType,
    }),
});
export const stepCards = e3.record("flowchart_step_cards", DictType(StringType, StepCard), {
    initial: new Map([
        ["scan", { name: "Scan point", group: "Intake", values: { name: "Scan point", slots: none, flow: "Parcels" } }],
        ["chutes", { name: "Sort chutes", group: "Sort", values: { name: "Sort chutes", slots: some(12n), flow: "Parcels" } }],
        ["desk", { name: "Exception desk", group: "Hold", values: { name: "Exception desk", slots: none, flow: "Parcels" } }],
    ]),
    indexes: (index) => ({ flowchart_step_cards_by_group: index.on(["group"]) }),
});
export const moveCards = e3.record("flowchart_move_cards", DictType(StringType, MoveCard), {
    initial: new Map([
        ["planned", { name: "Planned", group: "Kinds",
            values: { kind: variant("planned", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" } }],
        ["reroute", { name: "Observed reroute", group: "Kinds",
            values: { kind: variant("observed", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" } }],
        ["routed", { name: "Routed by the sort plan", group: "Decisions",
            values: { kind: variant("planned", null), trigger: some("route"), volume: none, n: none, at: none, flow: "Parcels" } }],
    ]),
    indexes: (index) => ({ flowchart_move_cards_by_group: index.on(["group"]) }),
});
// The Lanes tab's cards: one dropped between two lanes adds a lane there, from its values — a lane's every field but its place.
export const LaneCard = StructType({ name: StringType, group: StringType, values: StructType({ label: StringType }) });
export const laneCards = e3.record("flowchart_lane_cards", DictType(StringType, LaneCard), {
    initial: new Map([
        ["returns", { name: "Returns", group: "Lanes", values: { label: "Returns" } }],
        ["check", { name: "Quality check", group: "Lanes", values: { label: "Quality check" } }],
    ]),
    indexes: (index) => ({ flowchart_lane_cards_by_group: index.on(["group"]) }),
});
// The people who own the depot's decisions: an owner's card dropped on a decision's diamond makes them its owner.
export const DecisionOwner = StructType({ name: StringType, desk: StringType });
export const decisionOwners = e3.input("flowchart_decision_owners", DictType(StringType, DecisionOwner), variant("value", new Map([
    ["sp", { name: "sort-planner", desk: "Sort office" }],
    ["cd", { name: "customs-desk", desk: "Customs" }],
    ["ns", { name: "night-supervisor", desk: "Night shift" }],
])));

// The time each parcel spent in each state, keyed as the states are: its parcels counted into bins by how
// long they stayed, each key a bin's lower edge, in hours.
export const StateDwell = StructType({ hours: DictType(FloatType, IntegerType) });
export const stateDwell = e3.input("flowchart_depot_dwell", DictType(StringType, StateDwell), variant("value", new Map([
    ["ARV", { hours: new Map([[0, 7752n], [0.25, 6092n], [0.5, 2769n], [1, 1108n], [2, 554n], [4, 185n]]) }],
    ["SCN", { hours: new Map([[0, 9195n], [0.25, 5517n], [0.5, 2391n], [1, 920n], [2, 367n]]) }],
    ["IND", { hours: new Map([[0, 2207n], [0.25, 4781n], [0.5, 5517n], [1, 3310n], [2, 1655n], [4, 736n], [8, 184n]]) }],
    ["LBL", { hours: new Map([[0.25, 59n], [0.5, 137n], [1, 255n], [2, 273n], [4, 157n], [8, 79n], [12, 20n]]) }],
    ["CH*", { hours: new Map([[0, 1457n], [0.25, 4007n], [0.5, 6192n], [1, 4007n], [2, 1639n], [4, 728n], [8, 180n]]) }],
    ["SRD", { hours: new Map([[0, 861n], [0.25, 2065n], [0.5, 4303n], [1, 4818n], [2, 3098n], [4, 1377n], [8, 516n], [12, 172n]]) }],
    ["HLD", { hours: new Map([[0.25, 84n], [0.5, 167n], [1, 418n], [2, 752n], [4, 1169n], [8, 1417n],
        [12, 1253n], [24, 1336n], [48, 1002n], [96, 501n], [168, 251n]]) }],
    ["CLR", { hours: new Map([[0, 824n], [0.25, 1648n], [0.5, 2060n], [1, 1648n], [2, 989n], [4, 659n], [8, 330n], [12, 82n]]) }],
    ["LDD", { hours: new Map([[0, 681n], [0.25, 1362n], [0.5, 2725n], [1, 4088n], [2, 3747n], [4, 2384n], [8, 1362n], [12, 511n], [24, 170n]]) }],
    // Dispatched has no row: the app counts no time in it once a parcel has left, and its card says no data.
    ["RCV", { hours: new Map([[0, 64n], [0.25, 115n], [0.5, 154n], [1, 141n], [2, 90n], [4, 51n], [8, 19n], [12, 6n]]) }],
    ["INS", { hours: new Map([[0.25, 12n], [0.5, 37n], [1, 73n], [2, 122n], [4, 146n], [8, 110n], [12, 61n], [24, 37n], [48, 12n]]) }],
    ["RSD", { hours: new Map([[0, 122n], [0.25, 183n], [0.5, 159n], [1, 85n], [2, 43n], [4, 18n]]) }],
])));

export const flowchartDwell = example({
    keywords: ["Flowchart", "Flowchart.states", "Flowchart.transitions", "Flowchart.lanes", "records", "Data.bind", "read only",
        "details", "Flowchart.details", "Flowchart.histogram", "time in state", "histogram", "card", "minimal"],
    description: "The depot's states, transitions and lanes, three records of the app's read whole, read only, each state's time in state drawn on its card — one histogram, read from the app's own rows",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Data.bind(depotStates));
            const transitions = $.let(Data.bind(depotTransitions));
            const lanes = $.let(Data.bind(depotLanes));
            const dwell = $.let(Data.bind(stateDwell));
            return (
                <Box height="600px">
                    <Flowchart
                        states={Flowchart.states(states, {
                            label: "name", lane: "phase", order: "seq",
                            // Keyed as the states are, and read as they are: whole.
                            details: Flowchart.details(dwell, {
                                details: [Flowchart.histogram("hours", { unit: "hours", label: "Time in state" })],
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, { from: "src", to: "dst" })}
                        lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
                        name="dwell"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartDepot = example({
    keywords: [
        "Flowchart", "Flowchart.states", "Flowchart.transitions", "Flowchart.lanes", "Flowchart.decisions", "Flowchart.details",
        "Flowchart.templates", "Flowchart.library", "Flowchart.library.lanes", "Flowchart.library.tab", "Flowchart.patch", "Record.bind", "Data.bindPaged",
        "Slice.bindRecords", "presets", "records", "entries", "details", "Flowchart.tags", "Flowchart.histogram", "Flowchart.list",
        "Flowchart.figure", "show", "tag lists", "colorPalette", "legend", "bins", "ticks", "inspector", "editing", "Save",
        "source", "weigh", "weighed", "index.entries", "picks", "byService",
    ],
    description: "A parcel depot's flowchart over four records of the app's: its states and transitions read through their sources of the rail and edited through their patch doors, a preset narrowing both to one flow; its lanes and decisions, small records read whole; each state's details on its card in the app's order — its parcels, its flags, equipment and shifts as tag lists in the app's colours, two of them in the legend, its time in state over the app's bins and its top services — each transition's top region under its evidence, and every read in full in the inspector; the Steps, Transitions and Lanes tabs listing each kind's cards, and an owners tab whose card dropped on a decision makes it the decision's owner; and the services the rail picks weighing the states' details, their own figures added up by kind — the parcels, still in state, flags, time in state and exceptions — while the equipment, the shifts and the Service list draw the state's own",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The states and the transitions: editable through their patch doors, read through their sources of the rail.
            const states = $.let(Record.bind(depotStates));
            const stateEntries = $.let(Data.bindPaged(depotStates));
            const transitions = $.let(Record.bind(depotTransitions));
            const transitionEntries = $.let(Data.bindPaged(depotTransitions));
            // The lanes and the decisions: small records, read whole.
            const lanes = $.let(Record.bind(depotLanes));
            const decisions = $.let(Record.bind(depotDecisions));
            // The details, read by the drawn rows' keys, as their kinds are read through their sources. The states'
            // evidence is bound once, its entries index listed: the rail's evidence source, and the details its picks weigh.
            const evidence = $.let(Data.bindPaged(stateEvidence, { indexes: ["flowchart_evidence_by_service"] }));
            const moveRows = $.let(Data.bindPaged(moveEvidence));
            const steps = $.let(Data.bind(stepCards));
            const moves = $.let(Data.bind(moveCards));
            const laneRows = $.let(Data.bind(laneCards));
            const owners = $.let(Data.bind(decisionOwners));
            // One rail: the states and the transitions by their flow — the states by their lane too — and each list of
            // cards by its group. The flowchart opens on the parcels' flow; a preset picks a flow for both at once.
            const slice = $.let(Slice.bindRecords("flowchart.depot", {
                states: {
                    source: Data.bindPaged(depotStates, { indexes: ["flowchart_states_by_flow", "flowchart_states_by_lane"] }),
                    icon: { prefix: "fas", name: "circle-nodes" },
                    // Each field the rail offers is one an index answers: the flow, and the lane after it.
                    fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] }, phase: { label: "Lane" } },
                    initial: { flow: ["Parcels"] },
                },
                transitions: {
                    source: Data.bindPaged(depotTransitions, { indexes: ["flowchart_transitions_by_flow"] }),
                    icon: { prefix: "fas", name: "arrow-right-long" },
                    fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
                    initial: { flow: ["Parcels"] },
                },
                // Each service's own figures: the services picked weigh the states' details, and narrow no row.
                evidence: {
                    source: evidence,
                    icon: { prefix: "fas", name: "boxes-stacked" },
                    fields: { byService: { label: "Service", hints: ["Standard", "Priority", "Economy", "International"] } },
                },
                stepCards: { source: Data.bindPaged(stepCards, { indexes: ["flowchart_step_cards_by_group"] }), fields: { group: { label: "Group" } } },
                moveCards: { source: Data.bindPaged(moveCards, { indexes: ["flowchart_move_cards_by_group"] }), fields: { group: { label: "Group" } } },
                laneCards: { source: Data.bindPaged(laneCards, { indexes: ["flowchart_lane_cards_by_group"] }), fields: { group: { label: "Group" } } },
            }, { presets: [
                { id: "parcels", name: "Parcels", where: { states: { flow: ["Parcels"] }, transitions: { flow: ["Parcels"] } } },
                { id: "returns", name: "Returns", where: { states: { flow: ["Returns"] }, transitions: { flow: ["Returns"] } } },
            ] }));
            return (
                <Box height="640px">
                    <Flowchart
                        slice={{ slice }}
                        states={Flowchart.states(states, {
                            name: "State", icon: "circle-nodes", entries: stateEntries,
                            label: "name", lane: "phase", order: "seq",
                            members: (s) => s.slots,
                            // Drawn in this order on each state's card and in the inspector, each where its show says — "all" unless given.
                            // The services the rail picks weigh each read their figures hold, added up by kind; the equipment, the
                            // shifts and the Service list, which they lack, draw the state's own.
                            details: Flowchart.details(evidence, {
                                source: "evidence",
                                details: [
                                    Flowchart.figure("parcels", { label: "Parcels", unit: "parcels" }),
                                    Flowchart.figure("waiting", { label: "Still in state", show: "inspector" }),
                                    // each tag's look, as a Tag takes it — first defined, first shown
                                    Flowchart.tags("flags", {
                                        label: "Flags",
                                        colors: {
                                            "Hazmat": { colorPalette: "danger", variant: "solid" },
                                            "At risk": { colorPalette: "warning", variant: "subtle" },
                                            "Customs": { colorPalette: "brand", variant: "outline" },
                                            "Oversize": { colorPalette: "orange", variant: "subtle" },
                                            "Fragile": { colorPalette: "purple", variant: "subtle" },
                                            "Cold chain": { colorPalette: "info", variant: "subtle" },
                                        },
                                        legend: true,                   // the legend lists them, under "Flags"
                                    }),
                                    Flowchart.tags("equipment", {
                                        label: "Equipment",
                                        colors: {
                                            "Conveyor": { colorPalette: "teal" },          // subtle unless given
                                            "Scanner": { colorPalette: "blue" },
                                            "Forklift": { colorPalette: "gray", variant: "outline" },
                                            "Label printer": { colorPalette: "purple", variant: "outline" },
                                            "X-ray": { colorPalette: "info", variant: "outline" },
                                        },
                                        legend: true,
                                    }),
                                    Flowchart.tags("shifts", {
                                        label: "Shifts",
                                        colors: {
                                            "Early": { colorPalette: "yellow" },
                                            "Late": { colorPalette: "orange" },
                                            "Night": { colorPalette: "purple", variant: "solid" },
                                            "Weekend": { colorPalette: "gray" },
                                        },
                                    }),
                                    // the app's bins, in hours — a quarter hour apiece at first, then hours, days and a
                                    // week — a bar each whatever its span, on an axis naming 1h, 12h, 2d and 1w
                                    Flowchart.histogram("hours", {
                                        unit: "hours", label: "Time in state", counts: "parcels",
                                        bins: [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 96, 168],
                                        ticks: [1, 12, 48, 168],
                                    }),
                                    Flowchart.list("service", { label: "Service", top: 2, unit: "parcels" }),
                                    Flowchart.list("exceptions", { label: "Exceptions", unit: "parcels", show: "inspector" }),
                                ],
                            }),
                            // the Steps tab's cards: a card dropped on a lane adds a state there, from its values
                            templates: Flowchart.templates(steps.read(), {
                                name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards",
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, {
                            name: "Transition", icon: "arrow-right-long", entries: transitionEntries,
                            from: "src", to: "dst", decision: "trigger",
                            kind: (t) => t.kind,
                            evidence: (t) => some({ volume: t.volume, count: t.n, measuredAt: t.at, unit: some("parcels") }),
                            // Evidence shows them, so the form leaves them out.
                            fields: { volume: Fields.hidden(), n: Fields.hidden(), at: Fields.hidden() },
                            // The label draws the region under its evidence; the inspector shows all three.
                            details: Flowchart.details(moveRows, {
                                details: [
                                    Flowchart.list("region", { label: "Region", top: 1, unit: "parcels" }),
                                    Flowchart.list("service", { label: "Service", unit: "parcels", show: "inspector" }),
                                    // a Dict of structs: its draw says which number is the value, and a note
                                    Flowchart.list("origins", { label: "Origin", unit: "parcels", show: "inspector" },
                                        (o) => ({ value: o.parcels, note: some(East.str`${o.late} late`) })),
                                ],
                            }),
                            // the Transitions tab's cards: a card dropped on a transition gives it its values
                            templates: Flowchart.templates(moves.read(), {
                                name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "moveCards",
                            }),
                        })}
                        lanes={Flowchart.lanes(lanes, {
                            label: "label", order: "seq",
                            // the Lanes tab's cards: one dropped between two lanes adds a lane there, from its values
                            templates: Flowchart.templates(laneRows.read(), {
                                name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "laneCards",
                            }),
                        })}
                        decisions={Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) })}
                        library={[
                            Flowchart.library.states(),             // Steps: the states' cards, by group
                            Flowchart.library.transitions(),        // Transitions: the transitions' cards
                            Flowchart.library.lanes(),              // Lanes: the lanes' cards
                            Flowchart.library.tab(owners.read(), {
                                name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
                                // its patch is over a decision's row: dropped on a diamond, the card sets the decision's owner
                                drop: (o) => Flowchart.patch(DepotDecision, { owner: o.name }),
                            }),
                        ]}
                        freshness={{ label: "evidence-2026.06", date: new Date("2026-06-30T00:00:00Z") }}
                        name="depot"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartDepotEditing = example({
    keywords: ["Flowchart", "records", "Record.bind", "editing", "Save", "undo", "add lane", "add state", "move", "rename",
        "Connect", "Del", "keys", "ready", "patch door"],
    description: "The depot's four records bound editable and read whole: a lane added and renamed, a state added in its lane's editor and moved between two others, a transition connected, a state deleted with the transitions naming it, a drafted state held back until it names its flow, and Save writing each record through its own patch door",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Record.bind(depotStates));
            const transitions = $.let(Record.bind(depotTransitions));
            const lanes = $.let(Record.bind(depotLanes));
            const decisions = $.let(Record.bind(depotDecisions));
            return (
                <Box height="600px">
                    <Flowchart
                        states={Flowchart.states(states, {
                            label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
                            // The app's check on a drafted state: Save waits until it names its flow, and Issues says why.
                            ready: (s) => s.flow.equal("").ifElse(
                                () => variant("incomplete", [{ field: "flow", message: "Give the state its flow" }]),
                                () => variant("ready", null),
                            ),
                        })}
                        transitions={Flowchart.transitions(transitions, { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind })}
                        lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
                        decisions={Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) })}
                        name="depotEditing"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartDepotDimmed = example({
    keywords: ["Flowchart", "Slice.bindRecords", "narrowed", "dim", "Data.bindPaged", "read only", "records", "context",
        "source", "weigh", "weighed", "index.entries", "initial", "no data"],
    description: "The depot's states and transitions read only through their sources of the rail, the narrowing drawn as context: every row read, the states and transitions it leaves out faded and selected by no path, their details read by key and weighed by the one service the rail opens on — Held's time in state its international parcels' own, and the returns' states, which hold none, saying no data",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Read only, through their sources: bound with Data.bindPaged alone.
            const states = $.let(Data.bindPaged(depotStates));
            const transitions = $.let(Data.bindPaged(depotTransitions));
            const lanes = $.let(Data.bind(depotLanes));
            // The states' evidence, its entries index listed: the rail's evidence source, and the details its picks weigh.
            const evidence = $.let(Data.bindPaged(stateEvidence, { indexes: ["flowchart_evidence_by_service"] }));
            // The parcels' Hold lane in focus: an index on the flow and the lane answers the two together. The international
            // parcels' own figures weigh the details: the one service picked.
            const slice = $.let(Slice.bindRecords("flowchart.depotDimmed", {
                states: {
                    source: Data.bindPaged(depotStates, { indexes: ["flowchart_states_by_flow", "flowchart_states_by_lane"] }),
                    fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] }, phase: { label: "Lane" } },
                    initial: { flow: ["Parcels"], phase: ["hold"] },
                },
                transitions: {
                    source: Data.bindPaged(depotTransitions, { indexes: ["flowchart_transitions_by_flow"] }),
                    fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
                },
                evidence: {
                    source: evidence,
                    fields: { byService: { label: "Service", hints: ["Standard", "Priority", "Economy", "International"] } },
                    initial: { byService: ["International"] },
                },
            }));
            return (
                <Box height="640px">
                    <Flowchart
                        slice={{ slice }}
                        narrowed="dim"
                        states={Flowchart.states(states, {
                            label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
                            // Time in state weighed by the service picked; the Service list, which the entries lack, the state's own mix.
                            details: Flowchart.details(evidence, {
                                source: "evidence",
                                details: [
                                    Flowchart.histogram("hours", { unit: "hours", label: "Time in state", counts: "parcels",
                                        bins: [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 96, 168], ticks: [1, 12, 48, 168] }),
                                    Flowchart.list("service", { label: "Service", top: 2 }),
                                ],
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, { from: "src", to: "dst", kind: (t) => t.kind })}
                        lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
                        name="depotDimmed"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartDepotPhone = example({
    keywords: ["Flowchart", "records", "details", "mobile", "phone", "narrow", "390px", "Find state", "inspector"],
    description: "The depot's flowchart at a phone's width: cards keep their bars and lines and the canvas pans; Find state selects a state, the inspector shows its reads and its form, and its lane is chosen there",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Record.bind(depotStates));
            const transitions = $.let(Record.bind(depotTransitions));
            const lanes = $.let(Data.bind(depotLanes));
            const stateRows = $.let(Data.bind(stateEvidence));
            return (
                <Box width="390px" maxWidth="100%" height="720px">
                    <Flowchart
                        states={Flowchart.states(states, {
                            label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
                            details: Flowchart.details(stateRows, {
                                details: [
                                    Flowchart.histogram("hours", { unit: "hours", label: "Time in state", counts: "parcels",
                                        bins: [0, 0.25, 0.5, 1, 2, 4, 8, 12, 24, 48, 96, 168], ticks: [1, 12, 48, 168] }),
                                    Flowchart.list("service", { label: "Service", top: 2 }),
                                ],
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, { from: "src", to: "dst", kind: (t) => t.kind })}
                        lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
                        name="depotPhone"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartDepotTopDown = example({
    keywords: ["Flowchart", "orientation", "TD", "top down", "minimap", "legend", "readOnly", "read only", "inspector={false}", "no pane",
        "onSelectState", "onSelectLink", "onSelectTrigger", "onTracePath", "selection", "trace", "State.bind", "records"],
    description: "The depot's four records shown read only and top down — its lanes stacked down the canvas, the minimap drawn and the legend left out, with no inspector and no library — the host hearing each state, transition and decision selected and each path traced by an ⌥-click, and showing what it heard last",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Bound editable, shown read only: `readOnly` turns every gesture off, whatever the bindings could write.
            const states = $.let(Record.bind(depotStates));
            const transitions = $.let(Record.bind(depotTransitions));
            const lanes = $.let(Record.bind(depotLanes));
            const decisions = $.let(Record.bind(depotDecisions));
            // What the host heard last: the viewer's own, kept under its key.
            const heardBind = $.let(State.bind([StringType], "flowchart_depot_heard", ""));
            const heard = $.let(heardBind.read());
            const onSelectState = $.const(East.function([StringType], NullType, ($2, key) => { $2(heardBind.write(East.str`onSelectState: ${key}`)); }));
            const onSelectLink = $.const(East.function([StringType], NullType, ($2, key) => { $2(heardBind.write(East.str`onSelectLink: ${key}`)); }));
            const onSelectTrigger = $.const(East.function([StringType], NullType, ($2, key) => { $2(heardBind.write(East.str`onSelectTrigger: ${key}`)); }));
            const onTracePath = $.const(East.function([StringType], NullType, ($2, key) => { $2(heardBind.write(East.str`onTracePath: ${key}`)); }));
            return (
                <VStack align="stretch" gap="3">
                    <Badge colorPalette="brand" variant="outline">
                        {East.equal(heard.length(), 0n).ifElse((_$2) => "Select a state, a transition or a decision", (_$2) => heard)}
                    </Badge>
                    <Box height="640px">
                        <Flowchart
                            states={Flowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots })}
                            transitions={Flowchart.transitions(transitions, { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind })}
                            lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
                            decisions={Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) })}
                            orientation="TD"
                            minimap
                            legend={false}
                            readOnly
                            inspector={false}
                            onSelectState={onSelectState}
                            onSelectLink={onSelectLink}
                            onSelectTrigger={onSelectTrigger}
                            onTracePath={onTracePath}
                            name="depotTopDown"
                        />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartWording = example({
    keywords: ["Flowchart", "name", "vocabulary", "planned", "observed", "words", "Flowchart.states", "Flowchart.transitions",
        "Flowchart.lanes", "Flowchart.decisions", "Flowchart.library", "Slice.bindRecords", "records"],
    description: "The depot in its own words (#1516): each kind named by its own `name` — a stop, a hop, a stage and a choice — and `vocabulary` naming a transition's planned and observed kinds, wherever the flowchart draws them: its tabs, canvas, legend, inspector, footer, find box and refusals",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Record.bind(depotStates));
            const stateEntries = $.let(Data.bindPaged(depotStates));
            const transitions = $.let(Record.bind(depotTransitions));
            const transitionEntries = $.let(Data.bindPaged(depotTransitions));
            const lanes = $.let(Record.bind(depotLanes));
            const decisions = $.let(Record.bind(depotDecisions));
            const steps = $.let(Data.bind(stepCards));
            const moves = $.let(Data.bind(moveCards));
            const laneRows = $.let(Data.bind(laneCards));
            // The rail is the app's to word: each source's label, and its fields'.
            const slice = $.let(Slice.bindRecords("flowchart.wording", {
                states: {
                    source: Data.bindPaged(depotStates, { indexes: ["flowchart_states_by_flow"] }), label: "Stops",
                    fields: { flow: { label: "Route", hints: ["Parcels", "Returns"] } },
                    initial: { flow: ["Parcels"] },
                },
                transitions: {
                    source: Data.bindPaged(depotTransitions, { indexes: ["flowchart_transitions_by_flow"] }), label: "Hops",
                    fields: { flow: { label: "Route", hints: ["Parcels", "Returns"] } },
                    initial: { flow: ["Parcels"] },
                },
                stepCards: { source: Data.bindPaged(stepCards, { indexes: ["flowchart_step_cards_by_group"] }), label: "Stop cards", fields: { group: { label: "Group" } } },
                moveCards: { source: Data.bindPaged(moveCards, { indexes: ["flowchart_move_cards_by_group"] }), label: "Hop cards", fields: { group: { label: "Group" } } },
                laneCards: { source: Data.bindPaged(laneCards, { indexes: ["flowchart_lane_cards_by_group"] }), label: "Stage cards", fields: { group: { label: "Group" } } },
            }));
            return (
                <Box height="640px">
                    <Flowchart
                        slice={{ slice }}
                        // Each kind's name is the app's word for it, which the flowchart says wherever it speaks of one.
                        states={Flowchart.states(states, {
                            name: "Stop", entries: stateEntries,
                            label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
                            templates: Flowchart.templates(steps.read(), {
                                name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards",
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, {
                            name: "Hop", entries: transitionEntries,
                            from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind,
                            templates: Flowchart.templates(moves.read(), {
                                name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "moveCards",
                            }),
                        })}
                        lanes={Flowchart.lanes(lanes, {
                            name: "Stage", label: "label", order: "seq",
                            templates: Flowchart.templates(laneRows.read(), {
                                name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "laneCards",
                            }),
                        })}
                        decisions={Flowchart.decisions(decisions, { name: "Choice", label: (d) => d.name, owner: (d) => some(d.owner) })}
                        // What no kind names: a transition's two kinds.
                        vocabulary={{ planned: "Designed", observed: "Seen" }}
                        // The Steps tab keeps its name; the Hops and Stages tabs are named by their kinds.
                        library={[Flowchart.library.states(), Flowchart.library.transitions(), Flowchart.library.lanes()]}
                        name="wording"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// The app's own tag looks, kept as data its users edit: a row a tag, the first ranked first.
export const flagColors = e3.input("flowchart_depot_flag_colors", ArrayType(Flowchart.Types.TagColor), variant("value", [
    { tag: "Hazmat", colorPalette: variant("danger", null), variant: variant("solid", null) },
    { tag: "At risk", colorPalette: variant("warning", null), variant: variant("subtle", null) },
    { tag: "Customs", colorPalette: variant("brand", null), variant: variant("outline", null) },
]));

export const flowchartFlagColors = example({
    keywords: ["Flowchart", "details", "Flowchart.tags", "tags", "colors", "colorPalette", "StyleVariant", "legend", "Data.bind"],
    description: "Each state's flags as tags on its card and in the legend, their looks read from the app's own data",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Data.bind(depotStates));
            const transitions = $.let(Data.bind(depotTransitions));
            const lanes = $.let(Data.bind(depotLanes));
            const stateRows = $.let(Data.bind(stateEvidence));
            const looks = $.let(Data.bind(flagColors));
            return (
                <Box height="600px">
                    <Flowchart
                        states={Flowchart.states(states, {
                            label: "name", lane: "phase", order: "seq",
                            details: Flowchart.details(stateRows, {
                                details: [Flowchart.tags("flags", { label: "Flags", colors: looks.read(), legend: true })],
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, { from: "src", to: "dst" })}
                        lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
                        name="flagColors"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// A support desk's tickets: the states they pass through, the transitions between them, and the minutes
// each spent in each state. The app's task counts each state's tickets into the app's own bins — minutes at
// first, then hours, a shift and a day — an Array of counts, one a bin, keyed as the states are.
export const DeskState = StructType({ name: StringType, stage: StringType });
export const DeskTransition = StructType({ from: StringType, to: StringType });
export const DeskStage = StructType({ label: StringType, seq: IntegerType });
export const deskStates = e3.input("flowchart_desk_states", DictType(StringType, DeskState), variant("value", new Map([
    ["NEW", { name: "New", stage: "open" }], ["TRI", { name: "Triaged", stage: "open" }],
    ["WIP", { name: "In progress", stage: "work" }], ["WAI", { name: "Waiting on customer", stage: "work" }],
    ["RES", { name: "Resolved", stage: "close" }],
])));
export const deskTransitions = e3.input("flowchart_desk_transitions", DictType(StringType, DeskTransition), variant("value", new Map([
    ["t1", { from: "NEW", to: "TRI" }], ["t2", { from: "TRI", to: "WIP" }], ["t3", { from: "WIP", to: "WAI" }],
    ["t4", { from: "WAI", to: "WIP" }], ["t5", { from: "WIP", to: "RES" }],
])));
export const deskStages = e3.input("flowchart_desk_stages", DictType(StringType, DeskStage), variant("value", new Map([
    ["open", { label: "Open", seq: 1n }], ["work", { label: "Work", seq: 2n }], ["close", { label: "Close", seq: 3n }],
])));
export const TicketMinutes = StructType({ minutes: ArrayType(IntegerType) });
export const ticketMinutes = e3.input("flowchart_ticket_minutes", DictType(StringType, TicketMinutes), variant("value", new Map([
    ["NEW", { minutes: [140n, 96n, 120n, 64n, 30n, 22n, 9n, 4n, 2n, 1n, 0n, 0n] }],
    ["TRI", { minutes: [62n, 88n, 131n, 90n, 41n, 25n, 12n, 6n, 3n, 1n, 0n, 0n] }],
    ["WIP", { minutes: [3n, 8n, 41n, 96n, 120n, 150n, 132n, 88n, 40n, 18n, 9n, 4n] }],
    ["WAI", { minutes: [0n, 1n, 2n, 6n, 9n, 14n, 30n, 58n, 74n, 66n, 41n, 22n] }],
    // A resolved ticket stays resolved: the app counts no time in it, so its row is absent and its card says no data.
])));

export const flowchartTicketMinutes = example({
    keywords: ["Flowchart", "details", "Flowchart.histogram", "bins", "scale", "band", "linear", "ticks", "axis", "minutes", "time in state"],
    description: "A support desk's flowchart with each state's minutes in state on its card, counted into the app's own uneven bins — a bar a bin — and the axis naming the edges the app lists, the last two in its own words",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Data.bind(deskStates));
            const transitions = $.let(Data.bind(deskTransitions));
            const stages = $.let(Data.bind(deskStages));
            const minutes = $.let(Data.bind(ticketMinutes));
            return (
                <Box height="560px">
                    <Flowchart
                        states={Flowchart.states(states, {
                            label: "name", lane: "stage",
                            details: Flowchart.details(minutes, {
                                details: [Flowchart.histogram("minutes", {
                                    unit: "minutes",
                                    label: "Time in state",
                                    counts: "tickets",
                                    // The edges, in minutes: an Array of counts is a bin each, in this order.
                                    bins: [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440],
                                    // A bar a bin, whatever its span — the default; "linear" draws them to scale.
                                    scale: "band",
                                    // The edges the axis names besides 0: 5m and 1h printed from the unit,
                                    // the last two in the app's own words.
                                    ticks: [5, 60, { at: 480, label: "a shift" }, { at: 1440, label: "a day" }],
                                })],
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, { from: "from", to: "to" })}
                        lanes={Flowchart.lanes(stages, { label: "label", order: "seq" })}
                        name="ticketMinutes"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartTicketMinutesLinear = example({
    keywords: ["Flowchart", "details", "Flowchart.histogram", "bins", "scale", "linear", "to scale", "ticks", "axis", "minutes", "time in state"],
    description: "The support desk's minutes in state drawn to scale: the same uneven bins, each bar as wide as its span and as tall as its count over it — so its area is its count — the open last bin as wide as the one before it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Data.bind(deskStates));
            const transitions = $.let(Data.bind(deskTransitions));
            const stages = $.let(Data.bind(deskStages));
            const minutes = $.let(Data.bind(ticketMinutes));
            return (
                <Box height="560px">
                    <Flowchart
                        states={Flowchart.states(states, {
                            label: "name", lane: "stage",
                            details: Flowchart.details(minutes, {
                                details: [Flowchart.histogram("minutes", {
                                    unit: "minutes",
                                    label: "Time in state",
                                    counts: "tickets",
                                    bins: [0, 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440],
                                    // Each bar as wide as its span: the first hour is a sliver, the shift and the day most of the axis.
                                    scale: "linear",
                                    // The same ticks: to scale, 5m and 1h crowd 0 at the start and are left out.
                                    ticks: [5, 60, { at: 480, label: "a shift" }, { at: 1440, label: "a day" }],
                                })],
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, { from: "from", to: "to" })}
                        lanes={Flowchart.lanes(stages, { label: "label", order: "seq" })}
                        name="ticketMinutesLinear"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
