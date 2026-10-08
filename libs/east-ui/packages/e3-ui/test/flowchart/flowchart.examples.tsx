/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Box, Button, Reactive, Slice, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Flowchart, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// The depot's flows, by name: each a whole flowchart, written as literals and
// checked when the package builds.
export const depotFlows = e3.record("flowchart_depot_flows", Flowchart.Types.Flows, Flowchart.values({
    "Inbound parcels": {
        description: "From the trailer to the van",
        lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }],
        states: [
            { key: "ARV", label: "Arrived", lane: "intake" },
            { key: "SCN", label: "Scanned", lane: "intake" },
            { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
            { key: "LDD", label: "Loaded", lane: "load" },
        ],
        links: [
            { from: "ARV", to: "SCN" },
            { from: "SCN", to: "CH*", trigger: "route" },
            { from: "CH*", to: "LDD" },
            { from: "SCN", to: "SCN", kind: "observed" },
        ],
        triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
    },
    "Returns": {
        description: "From the counter back to the sender",
        lanes: [{ key: "counter", label: "Counter" }, { key: "check", label: "Check" }, { key: "out", label: "Out" }],
        states: [
            { key: "RCV", label: "Received", lane: "counter" },
            { key: "INS", label: "Inspected", lane: "check" },
            { key: "RSD", label: "Resent", lane: "out" },
        ],
        links: [{ from: "RCV", to: "INS" }, { from: "INS", to: "RSD" }, { from: "INS", to: "BIN", kind: "observed" }],
    },
}));
export const depotFlowsPatch = e3.mutation.patch(depotFlows);

// A record of one flow, edited on the canvas: a lone flow is a record of flows
// with one entry, bound with its patch mutation.
export const collectionFlows = e3.record("flowchart_collection_flows", Flowchart.Types.Flows, Flowchart.values({
    "Collections": {
        description: "From the booking to the depot's door",
        lanes: [{ key: "book", label: "Book" }, { key: "van", label: "Van" }, { key: "depot", label: "Depot" }],
        states: [
            { key: "BKD", label: "Booked", lane: "book" },
            { key: "CLD", label: "Collected", lane: "van" },
            { key: "RCV", label: "Received", lane: "depot" },
        ],
        links: [{ key: "BKD→CLD", from: "BKD", to: "CLD" }, { key: "CLD→RCV", from: "CLD", to: "RCV" }],
    },
}));
export const collectionFlowsPatch = e3.mutation.patch(collectionFlows);

// One flow, for an app that has only one: the host's, read only.
export const handoverFlow = e3.input("flowchart_handover", Flowchart.Types.Flow, variant("value", Flowchart.value({
    description: "From the last scan to the driver's signature",
    lanes: [{ key: "load", label: "Load" }, { key: "road", label: "Road" }, { key: "door", label: "Door" }],
    states: [
        { key: "LDD", label: "Loaded", lane: "load" },
        { key: "DSP", label: "Dispatched", lane: "road" },
        { key: "DLV", label: "Delivered", lane: "door" },
        { key: "RTN", label: "Returned", lane: "door" },
    ],
    links: [
        { from: "LDD", to: "DSP" },
        { from: "DSP", to: "DLV", trigger: "attempt" },
        { from: "DSP", to: "RTN", kind: "observed", trigger: "attempt" },
    ],
    triggers: [{ key: "attempt", label: "attempt", owner: "driver" }],
})));

// The library's rows (#1248): each tab its own bound data, apart from the
// flows and from the other tabs — the step types an input's rows, the
// transition types a record's rows by name, and the roles that own a decision
// another input's.
export const StepTemplate = StructType({ code: StringType, name: StringType, kind: StringType, slots: OptionType(IntegerType) });
export const stepTemplates = e3.input("flowchart_step_templates", ArrayType(StepTemplate), variant("value", [
    { code: "ARV", name: "Arrived", kind: "Intake", slots: none },
    { code: "SCN", name: "Scanned", kind: "Intake", slots: none },
    { code: "CH*", name: "Sort chutes", kind: "Sort", slots: some(12n) },
    { code: "HLD", name: "Held", kind: "Hold", slots: none },
    { code: "LDD", name: "Loaded", kind: "Load", slots: none },
]));
export const MoveTemplate = StructType({ kind: Flowchart.Types.Kind, decision: OptionType(StringType), note: StringType });
export const moveTemplates = e3.record("flowchart_move_templates", DictType(StringType, MoveTemplate), new Map([
    ["Observed", { kind: variant("observed", null), decision: none, note: "Mined from the scans" }],
    ["Planned", { kind: variant("planned", null), decision: none, note: "The designed path" }],
    ["Routed", { kind: variant("planned", null), decision: some("route"), note: "Governed by the route decision" }],
]));
export const DecisionOwner = StructType({ role: StringType, name: StringType, desk: StringType });
export const decisionOwners = e3.input("flowchart_decision_owners", ArrayType(DecisionOwner), variant("value", [
    { role: "sort-planner", name: "Sort planner", desk: "Sort hall" },
    { role: "customs-desk", name: "Customs desk", desk: "Hold bay" },
]));

export const flowchartFlows = example({
    keywords: ["Flowchart", "record", "Flows", "Flowchart.values", "Record.bind", "flow", "many flows", "e3.record", "Flowchart.library.flows", "Flows tab", "New flow"],
    description: "A record of flows by name — the depot's inbound parcels and its returns — bound with its patch mutation, the inbound flow opened first and the Flows tab listing every flow",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
            return (
                <Box height="500px">
                    <Flowchart record={flows} flow="Inbound parcels" library={[Flowchart.library.flows()]} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The library (#1248): the Flows tab, then the step types, the transition
 * types and the roles that own a decision — each tab its own bound data,
 * apart from the flows and from the other tabs: an input's rows, a record's
 * rows by name, another input's. Each template card is a drag source, as is
 * each of the author's cards, whose tab declares a `drop`; a click selects a
 * card, and a click on the selected card lets it go.
 */
export const flowchartLibrary = example({
    keywords: ["Flowchart", "library", "Flowchart.library.states", "Flowchart.library.transitions", "Flowchart.library.tab", "templates", "state templates", "transition templates", "author's tab", "bound data", "Data.bind", "Record.bind", "drag", "cards", "Flowchart.patch"],
    description: "A record of flows with its library — the Flows tab, step types from an input's rows, transition types from a record's rows by name, and the author's own cards — each tab its own bound data, each card a drag source a click selects",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
            const steps = $.let(Data.bind(stepTemplates));
            const moves = $.let(Record.bind(moveTemplates, []));
            const owners = $.let(Data.bind(decisionOwners));
            return (
                <Box height="560px">
                    <Flowchart
                        record={flows}
                        flow="Inbound parcels"
                        name="depot"
                        library={[
                            Flowchart.library.flows(),
                            // Step types, an input's rows: a card dropped on a lane adds a state seeded with what its drop sets.
                            Flowchart.library.states(steps.read(), {
                                name: "Steps", icon: "box",
                                key: s => s.code, label: s => s.name, meta: s => some(s.code), group: s => s.kind,
                                drop: s => Flowchart.patch(Flowchart.Types.State, { key: s.code, label: some(s.name), members: s.slots }),
                            }),
                            // Transition types, a record's rows by name: a card dropped on a transition retypes it.
                            Flowchart.library.transitions(moves.read(), {
                                icon: "arrow-right",
                                key: (_m, name) => name, label: (_m, name) => name, meta: m => some(m.note),
                                drop: m => Flowchart.patch(Flowchart.Types.Link, { kind: some(m.kind), trigger: m.decision }),
                            }),
                            // The author's own cards: a role dropped on a decision owns it.
                            Flowchart.library.tab(owners.read(), {
                                name: "Owners", icon: "user-tie",
                                key: o => o.role, label: o => o.name, meta: o => some(o.desk),
                                drop: o => Flowchart.patch(Flowchart.Types.Trigger, { owner: some(o.role) }),
                            }),
                        ]}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartHandover = example({
    keywords: ["Flowchart", "data", "Flow", "Flowchart.value", "Data.bind", "one flow", "e3.input", "read only"],
    description: "One flow of the host's — the hand-over from the last scan to the door — an input bound with Data.bind and shown read only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const handover = $.let(Data.bind(handoverFlow));
            return <Box height="500px"><Flowchart data={handover} /></Box>;
        }}</Reactive>
    )),
    inputs: [],
});

export const flowchartMinimal = example({
    keywords: ["Flowchart", "Flowchart.over", "data", "states", "links", "lanes", "minimal", "planned", "observed"],
    description: "Minimal flowchart — one flow over the host's tables: six states across three phase lanes, one observed transition",
    fn: East.function([], UIComponentType, ($) => {
        const states = $.const([
            { code: "ARV", name: "Arrived", phase: "intake" },
            { code: "SCN", name: "Scanned", phase: "intake" },
            { code: "SRT", name: "Sorting", phase: "sort" },
            { code: "SRD", name: "Sorted", phase: "sort" },
            { code: "LDD", name: "Loaded", phase: "dispatch" },
            { code: "DSP", name: "Dispatched", phase: "dispatch" },
        ]);
        const planned = variant("planned", null);
        const observed = variant("observed", null);
        const links = $.const([
            { src: "ARV", dst: "SCN", kind: planned },
            { src: "SCN", dst: "SRT", kind: planned },
            { src: "SRT", dst: "SRD", kind: planned },
            { src: "SRD", dst: "LDD", kind: planned },
            { src: "LDD", dst: "DSP", kind: observed },
        ]);
        return (
            <Box height="500px">
                <Flowchart
                    data={Flowchart.over(states, {
                        state: s => ({ key: s.code, label: s.name, lane: s.phase }),
                        links, link: l => ({ from: l.src, to: l.dst, kind: l.kind }),
                        lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "dispatch", label: "Dispatch" }],
                    })}
                />
            </Box>
        );
    }),
    inputs: [],
});

export const flowchartDepot = example({
    keywords: ["Flowchart", "Flowchart.over", "triggers", "evidence", "slice", "inspector", "Details", "Issues", "read only", "state class", "in-place", "unresolved", "freshness"],
    description: "Parcel-depot flowchart over the host's tables, read only — decision triggers, evidence-weighted links, a ×14 state class, an ↻ in-place loop, an unresolved ghost, a bound slice narrowing the transitions, and the inspector showing the selected state, transition or decision read only, its Issues the unresolved transition",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const KindType = Flowchart.Types.Kind;
            const LinkRow = StructType({
                id: StringType, src: StringType, dst: StringType, kind: KindType,
                trigger: OptionType(StringType), parcels: OptionType(FloatType), n: OptionType(IntegerType),
                at: DateTimeType, service: StringType, units: ArrayType(StringType),
            });
            const states = $.const([
                { code: "ARV", name: "Arrived", phase: "intake", slots: none },
                { code: "SCN", name: "Scanned", phase: "intake", slots: none },
                { code: "IND", name: "Inducting", phase: "induct", slots: none },
                { code: "LBL", name: "Labelled", phase: "induct", slots: none },
                { code: "CH*", name: "Sort chutes (class)", phase: "sort", slots: some(14n) },
                { code: "SRD", name: "Sorted", phase: "sort", slots: none },
                { code: "HLD", name: "Held", phase: "hold", slots: none },
                { code: "CLR", name: "Cleared", phase: "hold", slots: none },
                { code: "LDD", name: "Loaded", phase: "dispatch", slots: none },
                { code: "DSP", name: "Dispatched", phase: "dispatch", slots: none },
            ], ArrayType(StructType({
                code: StringType, name: StringType, phase: StringType, slots: OptionType(IntegerType),
            })));
            const stamp = new Date("2026-06-30T00:00:00Z");
            const planned = variant("planned", null);
            const observed = variant("observed", null);
            const links = $.const([
                { id: "l1", src: "ARV", dst: "SCN", kind: planned, trigger: none, parcels: some(18460.0), n: some(412n), at: stamp, service: "standard", units: ["C"] },
                { id: "l2", src: "SCN", dst: "IND", kind: planned, trigger: none, parcels: some(7720.0), n: some(171n), at: stamp, service: "standard", units: ["C"] },
                { id: "l3", src: "IND", dst: "IND", kind: planned, trigger: none, parcels: none, n: some(2n), at: stamp, service: "standard", units: ["C"] },
                { id: "l4", src: "IND", dst: "CH*", kind: planned, trigger: some("route"), parcels: some(17350.0), n: some(386n), at: stamp, service: "standard", units: ["C", "T"] },
                { id: "l5", src: "CH*", dst: "SRD", kind: planned, trigger: none, parcels: some(17210.0), n: some(383n), at: stamp, service: "standard", units: ["T"] },
                { id: "l6", src: "SRD", dst: "HLD", kind: observed, trigger: none, parcels: some(1080.0), n: some(24n), at: stamp, service: "express", units: ["T"] },
                { id: "l7", src: "HLD", dst: "CLR", kind: planned, trigger: some("customs"), parcels: some(8350.0), n: some(186n), at: stamp, service: "standard", units: ["T"] },
                { id: "l8", src: "CLR", dst: "LDD", kind: planned, trigger: none, parcels: some(8240.0), n: some(183n), at: stamp, service: "standard", units: ["T"] },
                { id: "l9", src: "LDD", dst: "DSP", kind: planned, trigger: none, parcels: some(8160.0), n: some(181n), at: stamp, service: "standard", units: [] },
                { id: "l10", src: "DSP", dst: "DLV", kind: planned, trigger: none, parcels: none, n: none, at: stamp, service: "standard", units: [] },
            ], ArrayType(LinkRow));
            const cfg = Slice.config(LinkRow, {
                fields: {
                    service: { label: "Service" },
                    src: { label: "From" },
                    dst: { label: "To" },
                },
                searchFieldIds: ["src", "dst"],
            });
            const slice = $.let(Slice.bind([LinkRow], "flowchart-depot", cfg, Slice.state({}), links, none));
            const triggers = $.const([
                { id: "route", name: "route", who: "sort-planner" },
                { id: "customs", name: "customs", who: "customs-desk" },
            ]);
            return (
                <Box height="600px">
                    <Flowchart
                        data={Flowchart.over(states, {
                            state: s => ({ key: s.code, label: s.name, lane: s.phase, members: s.slots }),
                            links: Slice.rows([LinkRow], slice),
                            link: l => ({
                                key: l.id, from: l.src, to: l.dst, kind: l.kind, trigger: l.trigger,
                                evidence: { volume: l.parcels, count: l.n, measuredAt: some(l.at), unit: "parcels" },
                            }),
                            lanes: [
                                { key: "intake", label: "Intake" }, { key: "induct", label: "Induct" },
                                { key: "sort", label: "Sort" }, { key: "hold", label: "Hold" },
                                { key: "dispatch", label: "Dispatch" },
                            ],
                            triggers,
                            trigger: t => ({ key: t.id, label: t.name, owner: t.who }),
                        })}
                        slice={slice} affordances={["filter", "search"]}
                        freshness={{ label: "evidence-2026.06", date: stamp }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The flowchart as an editor (#1247): a record of one flow, every gesture on
 * the canvas a draft of its editing session — "+ LANE", a lane's header
 * renamed and its ×, the "+ STATE" ghost, a state double-clicked into its
 * editor or dragged across lanes, a handle dragged to another state, Del on
 * the selection — which the history item undoes, redoes and discards, and
 * Save commits as one patch through the record's patch mutation. `canConnect`
 * keeps every transition out of the booking: a draft never snaps onto BKD
 * from another state.
 */
export const flowchartBuilder = example({
    keywords: ["Flowchart", "record", "Record.bind", "editing", "builder", "Save", "undo", "redo", "history", "+ LANE", "+ STATE", "connect", "canConnect", "Del", "rename", "move", "authoring", "interactive", "edit"],
    description: "A record of one flow edited on the canvas — + LANE, lane rename and ×, the + STATE ghost, double-click edit, cross-lane drag, handle-drag connecting and Del — each gesture a draft the history item undoes, and Save one commit through the record's patch mutation; a canConnect veto keeps transitions out of the booking",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const flows = $.let(Record.bind(collectionFlows, [collectionFlowsPatch]));
            // The connection veto: nothing comes back to the booking, though a
            // drop on BKD from BKD is its in-place transition.
            const canConnect = $.const(East.function([StringType, StringType], BooleanType,
                (_$, from, to) => East.equal(to, "BKD").not().or(() => East.equal(from, to))));
            return (
                <Box height="420px">
                    <Flowchart record={flows} canConnect={canConnect} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The inspector's own Details, by kind (#1250): over the depot's record of
 * flows, a state's own Details — its key and label, its lane, and a button
 * that gives it one more member — and a transition's own — its ends, its
 * kind, and a button that marks it observed — each in place of its kind's
 * form. Each button's `update` is one transaction of the open flow's session,
 * which Undo takes back and Save commits. A decision's and a lane's Details
 * are their forms, and Issues lists the open flow's issues.
 */
export const flowchartDetail = example({
    keywords: ["Flowchart", "inspector", "Details", "own Details", "update", "one transaction", "state", "transition", "Button", "record", "Record.bind", "Issues"],
    description: "The inspector's own Details by kind, over a record of flows — a state's, whose button gives it one more member, and a transition's, whose button marks it observed — each in place of its form, each button's update one transaction of the open flow's session",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
            // A state's own Details: its key, its label and its lane, and one more member — the edited state goes back through `update`.
            const state = $.const(East.function([Flowchart.Types.State, FunctionType([Flowchart.Types.State], NullType)], UIComponentType, ($2, s, update) => {
                const label = $2.let(s.label.match({ none: () => s.key, some: (_$3, l) => l }));
                const members = $2.let(s.members.match({ none: () => 1n, some: (_$3, n) => n.add(1n) }));
                const grow = $2.const(East.function([], NullType, ($3) => {
                    // East has no struct spread: the state, rebuilt with its new members.
                    const edited = $3.const({ key: s.key, label: s.label, lane: s.lane, members: some(members), notes: s.notes }, Flowchart.Types.State);
                    $3(update(edited));
                }));
                return (
                    <VStack gap="2" align="stretch">
                        <Text fontFamily="mono" fontWeight="bold">{East.str`${s.key} · ${label}`}</Text>
                        <Text color="fg.muted">{East.str`In the ${s.lane} lane`}</Text>
                        <Button variant="outline" onClick={grow}>One more member</Button>
                    </VStack>
                );
            }));
            // A transition's own Details: its ends and its kind, and a mark of it observed — the edited transition goes back through `update`.
            const transition = $.const(East.function([Flowchart.Types.Link, FunctionType([Flowchart.Types.Link], NullType)], UIComponentType, ($2, l, update) => {
                const kind = $2.let(l.kind.match({ none: () => "planned", some: (_$3, k) => k.getTag() }));
                const observe = $2.const(East.function([], NullType, ($3) => {
                    const edited = $3.const({ key: l.key, from: l.from, to: l.to, kind: some(variant("observed", null)), trigger: l.trigger, evidence: l.evidence }, Flowchart.Types.Link);
                    $3(update(edited));
                }));
                return (
                    <VStack gap="2" align="stretch">
                        <Text fontFamily="mono" fontWeight="bold">{East.str`${l.from} → ${l.to}`}</Text>
                        <Text color="fg.muted">{East.str`Its kind: ${kind}`}</Text>
                        <Button variant="outline" onClick={observe}>Mark it observed</Button>
                    </VStack>
                );
            }));
            return (
                <Box height="560px">
                    <Flowchart record={flows} flow="Inbound parcels" name="detail" inspector={{ state, transition }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
