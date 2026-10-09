/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, PatchType, StringType, StructType,
    example, none, some, variant,
} from "@elaraai/east";
import { Badge, Box, Button, Configurator, Editing, HStack, Reactive, Slice, State, Switch, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Flowchart, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The Flowchart's examples (#1251): the one `<Flowchart>`, each in its frame —
// one toolbar holding every control the flowchart has, the banners, the open
// flow's canvas in main, the footer, and the panes it is given. The slots of
// EXAMPLES_AUTHORING.md §8, few and full (FB40):
//
// - `flowchartFlows`, the front door: a record of the depot's flows by name,
//   and its Flows tab (§3.1);
// - `flowchartVariants`, THE configurator: the legend, the minimap and read
//   only as axes over the host's flows (`data`), which its `onApply` commits,
//   the selection and a traced path heard in its aside;
// - `flowchartLibrary`, the depot's flows (§3.3): the Flows tab, the step and
//   transition templates and the decisions' owners, each card dropped on the
//   canvas;
// - `flowchartDepot`, a flow from the host's tables (§3.4): decisions,
//   evidence, a state class, an in-place transition and an unresolved one,
//   narrowed by a slice, read only;
// - `flowchartHandover`, the host's one flow, top down, with no pane;
// - `flowchartDetail`, a record's one flow edited on the canvas, a
//   connection veto, and a state's and a transition's own Details.
//
// Its panes are optional props, and the examples show each combination: none
// (`flowchartHandover`), a library (`flowchartVariants`), an inspector
// (`flowchartDepot`, read only; `flowchartDetail`, its own Details), and both
// (`flowchartFlows`, `flowchartLibrary`). Between them, one flow
// (`flowchartHandover`, `flowchartDepot`, `flowchartDetail`) and many
// (`flowchartFlows`, `flowchartVariants`, `flowchartLibrary`).
//
// Every flowchart binds its flows from e3, so each runs on e3-web in the
// showcase (§2a): a record of flows written with `Flowchart.values`, whose
// patch mutation every Save commits through; an input of one flow written
// with `Flowchart.value`; or the host's tables, each an input. `State` holds
// only what the viewer owns: the configurator's axes and what it heard.
//
// A flowchart fills its parent, as a ui task's page fills the window: each
// example gives it a box of its own height. One page shows them all, so every
// flowchart but the first is named (`name`), and keeps its viewer's state
// apart.
// ============================================================================

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

// A lone flow, edited on the canvas: a record of flows with one entry, bound
// with its patch mutation.
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

// The depot's own tables (§3.4), each an input of the app's own rows: its
// steps by phase, the transitions mined from its scans — what the slice
// narrows — and its decisions. `Flowchart.over` builds one flow from them.
export const DepotState = StructType({ code: StringType, name: StringType, phase: StringType, slots: OptionType(IntegerType) });
export const depotStates = e3.input("flowchart_depot_states", ArrayType(DepotState), variant("value", [
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
]));
export const ScanTransition = StructType({
    id: StringType, src: StringType, dst: StringType, kind: Flowchart.Types.Kind,
    trigger: OptionType(StringType), parcels: OptionType(FloatType), n: OptionType(IntegerType),
    at: DateTimeType, service: StringType, units: ArrayType(StringType),
});
export const scanTransitions = e3.input("flowchart_depot_scans", ArrayType(ScanTransition), variant("value", [
    { id: "l1", src: "ARV", dst: "SCN", kind: variant("planned", null), trigger: none, parcels: some(18460.0), n: some(412n), at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: ["C"] },
    { id: "l2", src: "SCN", dst: "IND", kind: variant("planned", null), trigger: none, parcels: some(7720.0), n: some(171n), at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: ["C"] },
    { id: "l3", src: "IND", dst: "IND", kind: variant("planned", null), trigger: none, parcels: none, n: some(2n), at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: ["C"] },
    { id: "l4", src: "IND", dst: "CH*", kind: variant("planned", null), trigger: some("route"), parcels: some(17350.0), n: some(386n), at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: ["C", "T"] },
    { id: "l5", src: "CH*", dst: "SRD", kind: variant("planned", null), trigger: none, parcels: some(17210.0), n: some(383n), at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: ["T"] },
    { id: "l6", src: "SRD", dst: "HLD", kind: variant("observed", null), trigger: none, parcels: some(1080.0), n: some(24n), at: new Date("2026-06-30T00:00:00Z"), service: "express", units: ["T"] },
    { id: "l7", src: "HLD", dst: "CLR", kind: variant("planned", null), trigger: some("customs"), parcels: some(8350.0), n: some(186n), at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: ["T"] },
    { id: "l8", src: "CLR", dst: "LDD", kind: variant("planned", null), trigger: none, parcels: some(8240.0), n: some(183n), at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: ["T"] },
    { id: "l9", src: "LDD", dst: "DSP", kind: variant("planned", null), trigger: none, parcels: some(8160.0), n: some(181n), at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: [] },
    { id: "l10", src: "DSP", dst: "DLV", kind: variant("planned", null), trigger: none, parcels: none, n: none, at: new Date("2026-06-30T00:00:00Z"), service: "standard", units: [] },
]));
export const DepotDecision = StructType({ id: StringType, name: StringType, who: StringType });
export const depotDecisions = e3.input("flowchart_depot_decisions", ArrayType(DepotDecision), variant("value", [
    { id: "route", name: "route", who: "sort-planner" },
    { id: "customs", name: "customs", who: "customs-desk" },
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
 * THE Flowchart configurator — ONE live flowchart in its frame; every axis is
 * an expression-fed prop on that single instance: the legend, the minimap and
 * read only. Its flows are the host's (`data`): the depot's flows, read from
 * their e3 record, and Save hands `onApply` the session's request id with the
 * open flow's patch, which it commits through the record's patch mutation
 * under that id and answers with what e3 said — committed, refused, out of
 * time or beaten by another write. A write that got no answer throws, so the
 * session's Retry sends the same request id again, and e3 answers it with the
 * first write's commit rather than writing twice (#1275). The host hears what is selected — a
 * state, a transition, a decision — and a path ⌥-clicked in the reactive
 * aside, so it is given no inspector; its library is the Flows tab over the
 * host's flows. Its panes are fixed when it is built, so they are no axis
 * here. The configurator's axes are the viewer's own state.
 */
export const flowchartVariants = example({
    keywords: ["Flowchart", "configurator", "Configurator", "legend", "minimap", "readOnly", "read only", "onSelectState", "onSelectLink", "onSelectTrigger", "onTracePath", "selection", "trace", "callbacks", "data", "onApply", "commit", "requestId", "request id", "Retry", "Record.bind", "commit.patch", "Editing.Types.ApplyResult", "Flows tab", "Flowchart.library.flows", "many flows", "inspector={false}", "library", "Switch", "State", "Reactive"],
    description: "Flowchart configurator — the legend, the minimap and read only, each expression-fed into one live flowchart in its frame over the host's flows by name (data, from the depot's e3 record), its Flows tab over them, Save committed by the host's onApply through the record's patch mutation under the session's request id, a Retry safe to repeat; onSelectState, onSelectLink, onSelectTrigger and onTracePath heard in the aside, with no inspector",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
            // The host's commit: the open flow's patch through the record's patch mutation under the session's request id, e3's outcome as Save's answer.
            const onApply = $.const(East.asyncFunction([StringType, PatchType(Flowchart.Types.Flows)], Editing.Types.ApplyResult, ($2, requestId, patch) => {
                const outcome = $2.let(flows.commit.patch(requestId, patch));
                const answer = $2.let(variant("rejected", [{ entry: "", row: none, field: none, message: "The write was refused" }]), Editing.Types.ApplyResult);
                $2.match(outcome, {
                    committed: ($3, done) => { $3.assign(answer, variant("applied", { revision: some(done.stateHash) })); },
                    invalid: ($3, refused) => { $3.assign(answer, variant("rejected", [{ entry: "", row: none, field: none, message: refused.message }])); },
                    failed: ($3, refused) => { $3.assign(answer, variant("rejected", [{ entry: "", row: none, field: none, message: East.str`The write failed: ${refused.stderr}` }])); },
                    timed_out: ($3, refused) => { $3.assign(answer, variant("rejected", [{ entry: "", row: none, field: none, message: East.str`The write ran out of time after ${refused.ms} ms and wrote nothing` }])); },
                    conflict: ($3, lost) => {
                        const why = $3.let(lost.detail.match({ some: (_$4, detail) => detail, none: (_$4) => "Another write changed the flows first" }));
                        $3.assign(answer, variant("conflict", [{ entry: "", row: none, field: none, message: why }]));
                    },
                    // No answer: it may have committed, so the session's Retry sends the same request id, which resolves to that commit.
                    transport: ($3, lost) => { $3.error(East.str`The write got no answer, so it may have committed — retry to find out: ${lost.message}`); },
                });
                return answer;
            }));

            const legendBind   = $.let(State.bind([BooleanType], "flowchart_variants_legend", true));
            const minimapBind  = $.let(State.bind([BooleanType], "flowchart_variants_minimap", false));
            const readOnlyBind = $.let(State.bind([BooleanType], "flowchart_variants_readonly", false));
            const heardBind    = $.let(State.bind([StringType], "flowchart_variants_heard", ""));

            const legendOn = $.let(legendBind.read());
            const minimapOn = $.let(minimapBind.read());
            const readOnly = $.let(readOnlyBind.read());
            const heard = $.let(heardBind.read());

            const onLegend   = $.const(East.function([BooleanType], NullType, ($2, next) => { $2(legendBind.write(next)); }));
            const onMinimap  = $.const(East.function([BooleanType], NullType, ($2, next) => { $2(minimapBind.write(next)); }));
            const onReadOnly = $.const(East.function([BooleanType], NullType, ($2, next) => { $2(readOnlyBind.write(next)); }));

            // What the host hears: a state, a transition or a decision selected, and a path ⌥-clicked.
            const onSelectState   = $.const(East.function([StringType], NullType, ($2, key) => { $2(heardBind.write(East.str`onSelectState: ${key}`)); }));
            const onSelectLink    = $.const(East.function([StringType], NullType, ($2, key) => { $2(heardBind.write(East.str`onSelectLink: ${key}`)); }));
            const onSelectTrigger = $.const(East.function([StringType], NullType, ($2, key) => { $2(heardBind.write(East.str`onSelectTrigger: ${key}`)); }));
            const onTracePath     = $.const(East.function([StringType], NullType, ($2, key) => { $2(heardBind.write(East.str`onTracePath: ${key}`)); }));

            return (
                <Configurator
                    controls={[
                        Configurator.Slot("Canvas",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={legendOn} label="Legend" onChange={onLegend} />
                                <Switch checked={minimapOn} label="Minimap" onChange={onMinimap} />
                                <Switch checked={readOnly} label="Read-only" onChange={onReadOnly} />
                            </HStack>),
                    ]}
                    preview={
                        <Box width="100%" height="480px">
                            <Flowchart
                                data={flows.read()}
                                flow="Inbound parcels"
                                onApply={onApply}
                                library={[Flowchart.library.flows()]}
                                inspector={false}
                                legend={legendOn}
                                minimap={minimapOn}
                                readOnly={readOnly}
                                onSelectState={onSelectState}
                                onSelectLink={onSelectLink}
                                onSelectTrigger={onSelectTrigger}
                                onTracePath={onTracePath}
                                name="variants"
                            />
                        </Box>
                    }
                    aside={{
                        label: "Heard · Reactive",
                        body: (
                            <Badge colorPalette="brand" variant="outline">
                                {East.equal(heard.length(), 0n).ifElse((_$2) => "Select a state, a transition or a decision", (_$2) => heard)}
                            </Badge>
                        ),
                    }}
                    spec={[
                        Configurator.Spec("Legend", legendOn.ifElse((_$2) => "shown", (_$2) => "hidden")),
                        Configurator.Spec("Minimap", minimapOn.ifElse((_$2) => "shown", (_$2) => "hidden")),
                        Configurator.Spec("Read only", readOnly.ifElse((_$2) => "yes", (_$2) => "no")),
                        Configurator.Spec("Flows", East.str`${flows.read().size()} by name`),
                    ]}
                />
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

/**
 * A flow from the host's tables (§3.4) — the depot's steps by phase, the
 * transitions mined from its scans and its decisions, each an e3 input of the
 * app's own rows, built into one flow by `Flowchart.over` through their row
 * mappers and shown read only: decision triggers, evidence-weighted links, a
 * ×14 state class, an ↻ in-place loop and an unresolved ghost. A bound slice
 * narrows the transitions the flow is built from, its rail at the toolbar's
 * end, and the freshness chip names the evidence. Its one pane is the
 * inspector, every field of what is selected printed, its Issues the
 * unresolved transition.
 */
export const flowchartDepot = example({
    keywords: ["Flowchart", "Flowchart.over", "data", "states", "links", "lanes", "tables", "row mappers", "minimal", "planned", "observed", "triggers", "evidence", "slice", "Slice.rows", "Data.bind", "e3.input", "scans", "inspector", "Details", "Issues", "read only", "state class", "in-place", "unresolved", "freshness"],
    description: "Parcel-depot flowchart over the host's tables, each an e3 input bound with Data.bind and built into one flow by Flowchart.over, read only — decision triggers, evidence-weighted links, a ×14 state class, an ↻ in-place loop, an unresolved ghost, a bound slice narrowing the transitions, the freshness chip, and the inspector showing the selected state, transition or decision read only, its Issues the unresolved transition",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const states = $.let(Data.bind(depotStates));
            const scans = $.let(Data.bind(scanTransitions));
            const decisions = $.let(Data.bind(depotDecisions));
            const cfg = Slice.config(ScanTransition, {
                fields: {
                    service: { label: "Service" },
                    src: { label: "From" },
                    dst: { label: "To" },
                },
                searchFieldIds: ["src", "dst"],
            });
            const slice = $.let(Slice.bind([ScanTransition], "flowchart-depot", cfg, Slice.state({}), scans.read(), none));
            return (
                <Box height="600px">
                    <Flowchart
                        data={Flowchart.over(states.read(), {
                            state: s => ({ key: s.code, label: s.name, lane: s.phase, members: s.slots }),
                            links: Slice.rows([ScanTransition], slice),
                            link: l => ({
                                key: l.id, from: l.src, to: l.dst, kind: l.kind, trigger: l.trigger,
                                evidence: { volume: l.parcels, count: l.n, measuredAt: some(l.at), unit: "parcels" },
                            }),
                            lanes: [
                                { key: "intake", label: "Intake" }, { key: "induct", label: "Induct" },
                                { key: "sort", label: "Sort" }, { key: "hold", label: "Hold" },
                                { key: "dispatch", label: "Dispatch" },
                            ],
                            triggers: decisions.read(),
                            trigger: t => ({ key: t.id, label: t.name, owner: t.who }),
                        })}
                        slice={slice} affordances={["filter", "search"]}
                        freshness={{ label: "evidence-2026.06", date: new Date("2026-06-30T00:00:00Z") }}
                        name="scans"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * One flow of the host's — the hand-over from the last scan to the door — an
 * input of one flow, its value written with `Flowchart.value`, bound with
 * `Data.bind` and shown read only, top down. It is given no pane: no
 * library, and `inspector={false}` — its toolbar, its canvas and its footer.
 */
export const flowchartHandover = example({
    keywords: ["Flowchart", "data", "Flow", "Flowchart.value", "Data.bind", "one flow", "e3.input", "read only", "orientation", "TD", "top down", "inspector={false}", "no pane", "toolbar", "footer"],
    description: "One flow of the host's — the hand-over from the last scan to the door — an input bound with Data.bind and shown read only, top down, with no pane: its toolbar, its canvas and its footer",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const handover = $.let(Data.bind(handoverFlow));
            return (
                <Box height="500px">
                    <Flowchart data={handover} orientation="TD" inspector={false} name="handover" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * A record's one flow, edited, with its own Details (#1247, #1250): the
 * collections, a record of flows with one entry bound with its patch
 * mutation. Every gesture on the canvas is a draft of its editing session —
 * "+ LANE", a lane's header renamed and its ×, the "+ STATE" ghost, a state
 * double-clicked into its editor or dragged across lanes, a handle dragged to
 * another state, Del on the selection — which the history item undoes,
 * redoes and discards, and Save commits as one patch through the record's
 * patch mutation. `canConnect` keeps every transition out of the booking: a
 * draft never snaps onto BKD from another state. The inspector shows a
 * state's own Details — its key and label, its lane, and a button that gives
 * it one more member — and a transition's own — its ends, its kind, and a
 * button that marks it observed — each in place of its kind's form, each
 * button's `update` one transaction of the flow's session. A decision's and a
 * lane's Details are their forms, and Issues lists the flow's issues.
 */
export const flowchartDetail = example({
    keywords: ["Flowchart", "record", "Record.bind", "one flow", "one entry", "lone flow", "editing", "builder", "Save", "undo", "redo", "history", "+ LANE", "+ STATE", "connect", "canConnect", "Del", "rename", "move", "authoring", "interactive", "edit", "inspector", "Details", "own Details", "update", "one transaction", "state", "transition", "Button", "Issues"],
    description: "A record's one flow — the collections, from the booking to the depot's door — edited on the canvas: + LANE, lane rename and ×, the + STATE ghost, double-click edit, cross-lane drag, handle-drag connecting and Del, each a draft the history item undoes and Save commits through the record's patch mutation, a canConnect veto keeping transitions out of the booking; and the inspector's own Details by kind — a state's, whose button gives it one more member, and a transition's, whose button marks it observed — each in place of its form, each button's update one transaction",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const flows = $.let(Record.bind(collectionFlows, [collectionFlowsPatch]));
            // The connection veto: nothing comes back to the booking, though a
            // drop on BKD from BKD is its in-place transition.
            const canConnect = $.const(East.function([StringType, StringType], BooleanType,
                (_$2, from, to) => East.equal(to, "BKD").not().or(() => East.equal(from, to))));
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
                    <Flowchart record={flows} canConnect={canConnect} inspector={{ state, transition }} name="detail" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
