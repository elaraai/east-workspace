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
//   lanes, three records read whole, read only;
// - `flowchartDepot`, the depot in full: the states and the transitions read
//   through their sources of the rail and edited through their patch doors, a
//   preset narrowing both to one flow; the lanes and the decisions read
//   whole; and the library's Steps, Transitions, Lanes and Owners tabs, each
//   list of cards following its own source;
// - `flowchartDepotEditing`, the four records bound editable and read whole,
//   and the app's check on a drafted state;
// - `flowchartDepotDimmed`, the rail's choices drawn as context: every row
//   read through its source, those the narrowing leaves out faded;
// - `flowchartDepotPhone`, the depot at a phone's width;
// - `flowchartDepotTopDown`, the depot read only and top down, its minimap
//   drawn, no pane, and each selection and traced path heard by the host;
// - `flowchartWording`, the depot in its own words (#1516): each kind named by
//   its own `name`, and `vocabulary` naming a transition's planned and
//   observed kinds;
// - `flowchartFlagColors`, each state's flags as tags on its card and in the
//   legend, their looks read from the app's own data;
// - `flowchartTicketMinutes`, a support desk's minutes in state on each card,
//   counted into the app's own uneven bins, the axis naming the edges it lists.
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
});
export const MoveEvidence = StructType({
    region: DictType(StringType, IntegerType),
    service: DictType(StringType, IntegerType),
    origins: DictType(StringType, StructType({ parcels: IntegerType, late: IntegerType })),
});
export const stateEvidence = e3.record("flowchart_depot_state_evidence", DictType(StringType, StateEvidence), {
    initial: new Map(),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
export const moveEvidence = e3.record("flowchart_depot_move_evidence", DictType(StringType, MoveEvidence), {
    initial: new Map(),
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

export const flowchartDwell = example({
    keywords: ["Flowchart", "Flowchart.states", "Flowchart.transitions", "Flowchart.lanes", "records", "Data.bind", "read only", "minimal"],
    description: "The depot's states, transitions and lanes, three records of the app's read whole, read only: each state in its lane, in the order its seq gives, and the transitions routed between them",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Data.bind(depotStates));
            const transitions = $.let(Data.bind(depotTransitions));
            const lanes = $.let(Data.bind(depotLanes));
            return (
                <Box height="600px">
                    <Flowchart
                        states={Flowchart.states(states, { label: "name", lane: "phase", order: "seq" })}
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
        "Flowchart", "Flowchart.states", "Flowchart.transitions", "Flowchart.lanes", "Flowchart.decisions",
        "Flowchart.templates", "Flowchart.library", "Flowchart.library.lanes", "Flowchart.library.tab", "Flowchart.patch", "Record.bind", "Data.bindPaged",
        "Slice.bindRecords", "presets", "records", "entries", "inspector", "editing", "Save",
    ],
    description: "A parcel depot's flowchart over four records of the app's: its states and transitions read through their sources of the rail and edited through their patch doors, a preset narrowing both to one flow; its lanes and decisions, small records read whole; the Steps, Transitions and Lanes tabs listing each kind's cards, and an owners tab whose card dropped on a decision makes it the decision's owner",
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
                    fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] }, phase: { label: "Lane" } },
                    initial: { flow: ["Parcels"] },
                },
                transitions: {
                    source: Data.bindPaged(depotTransitions, { indexes: ["flowchart_transitions_by_flow"] }),
                    icon: { prefix: "fas", name: "arrow-right-long" },
                    fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
                    initial: { flow: ["Parcels"] },
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
    keywords: ["Flowchart", "Slice.bindRecords", "narrowed", "dim", "Data.bindPaged", "read only", "records", "context"],
    description: "The depot's states and transitions read only through their sources of the rail, the narrowing drawn as context: every row read, the states and transitions it leaves out faded and selected by no path",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Read only, through their sources: bound with Data.bindPaged alone.
            const states = $.let(Data.bindPaged(depotStates));
            const transitions = $.let(Data.bindPaged(depotTransitions));
            const lanes = $.let(Data.bind(depotLanes));
            // The parcels' Hold lane in focus: an index on the flow and the lane answers the two together.
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
            }));
            return (
                <Box height="640px">
                    <Flowchart
                        slice={{ slice }}
                        narrowed="dim"
                        states={Flowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots })}
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
    keywords: ["Flowchart", "records", "mobile", "phone", "390px", "pane strip", "second row", "history", "narrow", "lanes", "lane pager",
        "Flowchart.library.states", "Slice.bindRecords", "Find state", "inspector"],
    description: "The depot's flowchart in a phone's 390-wide frame, its states, transitions and lanes bound editable: the toolbar over its second row — the history at 44px — and the canvas the frame's whole width with two lanes in view (narrow), ‹ › stepping through them; the rail narrowing the Steps tab's cards by their group, and the library and the inspector a strip of views along the bottom edge; Find state selects a state, the inspector shows its form, and its lane is chosen there",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Record.bind(depotStates));
            const transitions = $.let(Record.bind(depotTransitions));
            const lanes = $.let(Record.bind(depotLanes));
            const steps = $.let(Data.bind(stepCards));
            // One rail: the Steps tab's cards by their group, through the source the tab names.
            const slice = $.let(Slice.bindRecords("flowchart.depotPhone", {
                stepCards: {
                    source: Data.bindPaged(stepCards, { indexes: ["flowchart_step_cards_by_group"] }), label: "Steps", icon: { prefix: "fas", name: "box" },
                    fields: { group: { label: "Group" } },
                },
            }));
            return (
                <Box width="390px" maxWidth="100%" height="720px">
                    <Flowchart
                        slice={{ slice }}
                        states={Flowchart.states(states, {
                            label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
                            templates: Flowchart.templates(steps.read(), {
                                name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards",
                            }),
                        })}
                        transitions={Flowchart.transitions(transitions, { from: "src", to: "dst", kind: (t) => t.kind })}
                        lanes={Flowchart.lanes(lanes, { label: "label", order: "seq" })}
                        library={[Flowchart.library.states()]}
                        narrow={{ lanes: 2 }}
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
