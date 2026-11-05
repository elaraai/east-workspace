# Flowchart Records Spec

*e3-ui · Flowchart · design.* The visual spec is `Flowchart Records Spec.html`, beside this file: it decides how the details look — the state card, the transition label, the legend and the inspector. This file decides the rest: the authoring examples and the API (§2), the types, refusals and payload (§3), and every behaviour, those the visual spec does not draw among them. Where the two differ on a look, the visual spec wins; on anything else, this file does. Every behaviour is a numbered rule, R1–R42 (§5); the user's rulings and the design's decisions D1–D24 are §8; the tasks, §9.

Today the Flowchart draws one flow of a dictionary of flows, each flow kept whole in one record entry or handed over as data. This proposal draws one flowchart over the app's own records, as the Schematic does: a record of states and a record of transitions, each row the app's own type with its fields mapped to the Flowchart's roles, each read through its source of the rail so the indexes narrow both; and beside them two small records, the lanes and the decisions. On top of that, the app can put structured details on each state and transition — figures, tag lists in its own colours, time-in-state histograms over its own bins and axis, and short lists — in one ordered array, drawn on the cards and labels and shown in full in the inspector.

**Spec** for the epic · Four kinds: **states, transitions, lanes, decisions** · The Flow types and the Flows tab: **removed** · **19** rulings · **24** design decisions

- **Records.** States and transitions are each a keyed record of the app's. `Flowchart.states` and `Flowchart.transitions` map their fields to the Flowchart's roles — a state's label, lane and place; a transition's ends and decision — and every other field is the app's, edited in the inspector's form.
- **The rail.** Each is read through its source of the one `Slice.bindRecords`, named `states` and `transitions`, so each index's choices narrow it — hidden, or dimmed as context — and a preset narrows both at once: one record holding many flows shows one.
- **Lanes and decisions.** Two small records, read whole: the lanes as columns in their order, the decisions as the diamonds on the transitions that name them. Bound with `Record.bind`, a lane is added and renamed on the canvas and a decision edited in the inspector.
- **Everything kept.** States and transitions are read complete, page by page through their sources, as the Schematic reads its links: every row the narrowing keeps is drawn, with no cap and no banner.
- **Details.** One ordered array of typed reads on each kind — `figure`, `histogram`, `list`, `tags` — drawn on the card or the label in its order and in full in the inspector, each where its `show` says; tag lists in the app's colours, and in the legend where it asks.
- **Library.** The Steps, Transitions and Lanes tabs list each kind's cards, rows of records the app keeps — a lane's card adds a lane where it lands; an author's tab drops onto any kind. The Flows tab goes, with `Flowchart.over` and the Flow types.

## 1. The visual spec

`Flowchart Records Spec.html`, beside this file, is the visual spec. It draws what changes — the state card, the transition label and the inspector — and spells out each part's looks under it, in the design system's tokens and pixels. The frame, toolbar, footer, lanes, routing and Issues stay as they are. The numbers are made up.

> **The visual spec** draws the depot's Sort and Hold lanes, read only, from four records of the app's, in four parts: **In the frame**, **State card**, **Transition label** and **Inspector**. **selected** chooses what the inspector shows — a state, a transition or nothing — **bars** the histograms' `scale`, band or linear, and **theme** light or dark. In the frame, click a state, a label, the diamond or the canvas, and the inspector follows.

1. **In the frame.** The Flowchart in its frame, as a host places it: today's toolbar — Find state, LR · TD, and the freshness chip, the app's `freshness` (*evidence-2026.06 · Jun 30*) — the canvas, the inspector's pane and the footer. Four states, four transitions and a decision, with the legend under them.
2. **The state card.** A state the app gives details draws as a card 272 wide and as tall as what it shows: its head, a rule, then the reads the app puts on the canvas, in its order. A figure is one line: its label, its value and its unit. A tag list sits beside its label, wrapping to three lines, then +n. A histogram draws the app's bins as bars over an axis naming the app's ticks. A list draws its top items, each a name, a bar and its share. Three cards: as drawn, selected, and one with no details row, whose every read says *no data*. A state without details keeps today's card.
3. **The transition label.** The evidence line, and the transition's details as lines under it — a figure a line, a list its top items, three lines at most — placed as today, with cards side by side keeping the widest label and 24 between them, so no label lands on a card. A decision's diamond keeps the middle, and its label steps beside it. Four links between two card heads: planned, observed, selected, and with a decision. Strokes, dashes, weights, rings, arrowheads, the diamond and the badge stay as today.
4. **The legend.** Under today's rows, a row for each read the cards and labels draw, and beside them the tag list the app adds to it, each tag in its colours.
5. **The inspector.** Between the head and the form, the reads the app shows there, in its order and in full, those it draws nowhere else among them: figures in the stats grid; every tag; the histogram on the app's axis, with a caption saying where half and nine in ten of its counts fall, or the bin under the pointer; a list's first 8 items, then Show n more. A state's transitions grouped In, Out and In place, each with its volume; a transition's Evidence last; with nothing selected, the four records counted, and each one's last save.

**The depot's choices, drawn.** The visual spec's depot shows its flags alone of its tag lists on the card, its equipment and shifts only in the inspector, and its flags in three palettes — danger, warning and info — at the default look, subtle: a 6% wash of the palette on a 1px rule of it, its text in the palette's text step; its other tags are neutral. These are an app's choices drawn, not fixed looks: what a card shows is the app's `details` and each read's `show`, and a tag's colours are its definition's `colorPalette` and `variant`, as a Tag takes them (§2). The depot example below shows its equipment and shifts on the card too, and gives its tags palettes and variants of their own; each draws as the visual spec's flags do, and §4 and §5 say how.

What stays as it is: the toolbar and its fold ladder, the freshness chip, the footer, the lanes, routing, channels and handles, the evidence weights and badges' look, the decision diamonds, Find state, LR · TD, hover dimming, the shared form, read only, a kind's own Details, Issues and its words, the inspector's hint, and every gesture the canvas takes today but a key changed once saved.

What goes: the Flows tab, and with it opening, renaming, duplicating and deleting a flow; the props `record`, `data`, `flow` and `onApply`; `Flowchart.over`, `Flowchart.values` and `Flowchart.value`; `Flowchart.Types.Flows`, `Flow`, `State`, `Link`, `Lane` and `Trigger`; a flow's description; a saved row's key changed in the form; and `inspector={{ state, transition }}` — a kind's own Details moves onto its kind, and `inspector` stays a switch, on unless it is `false`.

## 2. Authoring

Four props carry the app's records, each a kind as the Schematic's are: `states={Flowchart.states(binding, { … })}`, `transitions={Flowchart.transitions(binding, { … })}`, `lanes={Flowchart.lanes(binding, { … })}` and `decisions={Flowchart.decisions(binding, { … })}`. Each binding is a record of the app's keyed by String, its rows the app's own type; no record of the app's holds a type of the Flowchart's.

A role is a field of the row where a gesture writes it or it names another row's key — a state's `label`, `lane` and `order`; a transition's `from`, `to` and `decision`; a lane's `label` and `order`; a decision's `queue` — so the editor checks the field's name and type against the row. Every other role is an accessor over the row and its key — a state's `members`, a transition's `kind` and `evidence`, a decision's `label`, `letter`, `owner` and `outcomes` — turned into one function, as the Schematic's are. A gesture writes only its roles' fields; the inspector's form edits the rest.

How a kind is bound says how it is read and whether it is edited: `Record.bind(record)`, editable and read whole, or beside it `entries: Data.bindPaged(record)`, read through the kind's source of the rail; `Data.bind(record)`, read only and whole; or `Data.bindPaged(record)` alone, read only, through its source. Anything else is refused, naming the form to use. A state or a transition read through its source is read complete — page by page, every row the narrowing keeps — so the canvas always draws the whole flowchart the rail chooses, never a window of it. Lanes and decisions are small records, read whole.

The rail is one `Slice.bindRecords`. Its sources named `states` and `transitions` are each `Data.bindPaged(record, { indexes })` over that kind's own record, and each index's choices narrow that kind; other sources are named by the lists of cards that follow them. `narrowed` says what a narrowing does: `"hide"`, the default — a row it leaves out is never read, and a transition whose end it hides leaves the canvas — or `"dim"` — every row is read, and those left out are drawn as context and selected by no path. A preset may narrow both sources at once: a record holding many flows, each row naming its flow, shows one through a preset over the field both share.

A state or a transition takes `details`: `Flowchart.details(binding, { details: [ … ] })` over the app's rows keyed as the kind's are, read only, and bound as the kind is read — `Data.bind` whole beside a kind read whole, `Data.bindPaged` by the drawn rows' keys beside one read through its source. Four reads name fields of the details' row:

- `Flowchart.histogram(field, { unit, label?, counts?, bins?, scale?, ticks?, show? })` — a Dict from a duration to its count, both numbers, the durations in `"minutes"`, `"hours"` or `"days"`; or, beside `bins`, an Array of counts, one a bin. `bins` are the app's own edges, ascending and spaced as it likes — a literal, or an Array the app binds; left out, every row's edges merged. `scale` takes the Chart's words for how the axis spaces them: `"band"`, a bar a bin whatever its span (the default), or `"linear"`, each bar as wide as its span. `ticks` lists the edges the axis names — a number, printed as a duration, or `{ at, label }` in the app's words. The card's bars on their axis; the inspector's chart.
- `Flowchart.list(field, { label?, unit?, top?, show? }, draw?)` — a Dict from an item's name to a number, or to a struct whose `draw` says which number is the value, and a note. Lines on a card, under the list's title, or under a transition's evidence; the inspector's list.
- `Flowchart.figure(field, { label?, unit?, show? })` — a number, or an Option of one. A line on the card or the label — its label, and its value; the inspector's stats.
- `Flowchart.tags(field, { label?, colors?, legend?, show? })` — an Array or a Set of strings: the row's tags. `colors` gives each tag its look as a Tag takes it — `{ colorPalette, variant }`, east-ui's `ColorSchemeType` and `StyleVariantType` — first defined, first shown; a literal, or an Array the app binds. A tag with none is neutral and subtle. `legend` lists the defined tags in the canvas's legend, under the read's label. On a card, a list beside its label — tag lists one after another sharing a label column — its tags wrapping to three lines; the inspector shows every tag.

Each kind's `details` is one array of reads, any mix of the four, drawn in its order: on a state's card; on a transition's label — figures and lists, as lines under its evidence; and, in full, in the inspector. Each read's `show` says where it shows: `"all"`, the default — on the canvas and in the inspector; `"canvas"` — on the card or the label alone; or `"inspector"` — in the inspector alone. On the wire it is a variant, as the Schematic's `narrowed` carries its `show`. Every element is a read made by one of the four; none names another. The details' row type never reaches the payload: `Flowchart.details` turns the reads into one function from the row to a fixed type.

#### Example — Minimal (records · read only)

The depot's states, transitions and lanes, three records read whole, and one histogram on every state's card.

```tsx
// The depot's states, transitions and lanes: three records of the app's, keyed by String. A state's key is
// its code; a transition names its ends by their keys, and a state its lane by the lane's.
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
        ["CH*", { name: "Sort chutes (class)", phase: "sort", seq: 1, slots: some(14n), flow: "Parcels" }],
        ["HLD", { name: "Held", phase: "hold", seq: 1, slots: none, flow: "Parcels" }],
        ["CLR", { name: "Cleared", phase: "hold", seq: 2, slots: none, flow: "Parcels" }],
        // … a row per state, the returns flow's beside the parcels'
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
        ["l7", { src: "HLD", dst: "CLR", kind: variant("planned", null), trigger: some("customs"), volume: some(8350), n: some(186n), at: some(new Date("2026-06-30T00:00:00Z")), flow: "Parcels" }],
        // … a row per transition
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

// The time each parcel spent in each state, keyed as the states are: its parcels counted into bins by how
// long they stayed, each key a bin's lower edge, in hours.
export const StateDwell = StructType({ hours: DictType(FloatType, IntegerType) });
export const stateDwell = e3.input("flowchart_depot_dwell", DictType(StringType, StateDwell), variant("value", new Map([
    ["ARV", { hours: new Map([[0, 7752n], [0.25, 6092n], [0.5, 2769n], [1, 1108n], [2, 554n], [4, 185n]]) }],
    ["HLD", { hours: new Map([[0.25, 84n], [0.5, 167n], [1, 418n], [2, 752n], [4, 1169n], [8, 1417n],
        [12, 1253n], [24, 1336n], [48, 1002n], [96, 501n], [168, 251n]]) }],
    // … a row per state
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
```

#### Example — The depot, in full (records · Slice · editing)

Four records: the states and transitions read through their sources of the rail and edited through their patch doors, a preset narrowing both to one flow; the lanes and decisions read whole; both kinds' details in the order drawn — the card's figure, three labelled tag lists, bars over the app's bins and lines; the label's line; two of the tag lists in the legend; every read in the inspector, those shown only there among them — and the library's Steps, Transitions, Lanes and Owners tabs. The visual spec draws this depot, its flags alone of its tag lists on the card and its tags in three palettes; the reads it leaves to the inspector draw on the card by the same rules (§1).

```tsx
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

// The library's cards, records the app's users keep: each a name, a group and the values a new row takes —
// a state's every field but its lane and its place, a transition's every field but its ends.
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

export const flowchartDepot = example({
    keywords: [
        "Flowchart", "Flowchart.states", "Flowchart.transitions", "Flowchart.lanes", "Flowchart.decisions", "Flowchart.details",
        "Flowchart.templates", "Flowchart.library", "Flowchart.library.lanes", "Flowchart.library.tab", "Flowchart.patch", "Record.bind", "Data.bindPaged",
        "Slice.bindRecords", "presets", "records", "entries", "details", "Flowchart.tags", "Flowchart.histogram", "Flowchart.list",
        "Flowchart.figure", "show", "tag lists", "colorPalette", "legend", "bins", "ticks", "inspector", "editing", "Save",
    ],
    description: "A parcel depot's flowchart over four records of the app's: its states and transitions read through their sources of the rail and edited through their patch doors, a preset narrowing both to one flow; its lanes and decisions, small records read whole; each state's details on its card in the app's order — its parcels, its flags, equipment and shifts as tag lists in the app's colours, two of them in the legend, its time in state over the app's bins and its top services — each transition's top region under its evidence, and every read in full in the inspector; the Steps, Transitions and Lanes tabs listing each kind's cards, and an owners tab whose card dropped on a decision makes it the decision's owner",
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
            // The details, read by the drawn rows' keys, as their kinds are read through their sources.
            const stateRows = $.let(Data.bindPaged(stateEvidence));
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
                            details: Flowchart.details(stateRows, {
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
```

#### Example — Editing (records · gestures · Save)

The four records bound editable and read whole: what each gesture writes, in which record, and Save writing each through its own patch door.

One history spans the four records, each a session of its own. A gesture writes only its roles' fields: a new lane, a rename, a new state from its lane's editor, a move between two cards, Connect, and Del with the transitions that name what it deletes. Save sends each record's changes as a request of its own; a refusal keeps that record's drafts and leaves the others' commits standing. The app's `ready` holds a drafted state back until it names its flow.

```tsx
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

// What each gesture writes, in which record — only its roles' fields, every other field as it was:
//
//   + LANE            lanes        a lane keyed lane-6, its label "Lane 6", its seq one past the last
//   rename a lane     lanes        its label
//   × on a lane       lanes        deletes it: offered while no state the flowchart holds stands in it
//   + STATE           states       the lane's editor gives its key and its name; its phase the lane; its seq one past
//                                  the lane's last; every other field its type's default — flow "", which ready holds back
//   move              states       its phase, where it lands across lanes; its seq, the middle of the two it lands between
//   rename            states       its name
//   Connect           transitions  a key minted unique, never drawn; its src and dst; every other field its type's default
//   Del a state       states       the state
//                     transitions  every transition the flowchart holds naming it
//   the form          the record of what is selected: the fields no role writes — a state's slots and flow
//   Save              each record through its own patch door, a request of its own; a refusal keeps that record's
//                     drafts and leaves the others' commits standing
```

#### Example — Tag colours from the app's data (details · tags · legend)

The flags' looks kept as data the app's users edit; the tags on each card and in the legend.

The looks are the app's: a literal, as the depot example gives them, or an Array of `Flowchart.Types.TagColor` the app binds — each a tag, its `colorPalette` and its `variant`, the first ranked first. A tag no definition names draws neutral and subtle, and the legend leaves it out.

```tsx
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
```

#### Example — The app's bins and axis (details · histogram · scale)

Minutes in each state of a support desk's flowchart, counted into the app's own uneven bins: a bar a bin, and the axis naming the edges the app lists.

The bins are the app's — minutes at first, then hours, a shift and a day — and its task counts each state's tickets into them, an Array of counts, one a bin. `scale: "band"` draws a bar a bin whatever its span; `"linear"` draws the same bins to scale, each bar as wide as its span and as tall as its count over that span. The axis names the first edge and the `ticks`: a number printed as a duration, or the app's own words.

```tsx
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
    ["WIP", { minutes: [3n, 8n, 41n, 96n, 120n, 150n, 132n, 88n, 40n, 18n, 9n, 4n] }],
    // … a row per state
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
```

#### Example — The same bins to scale (details · histogram · linear)

The desk's minutes in state over the same bins and ticks, drawn to scale (ruling 12): each bar as wide as its span and as tall as its count over it, so the first half hour, which holds most of the tickets, is a spike at the axis's start (R26).

```tsx
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
```

#### Example — Narrowed and dimmed (Slice · dim · read only)

The rail's choices drawn as context: every row read through its source, those the narrowing leaves out faded and selected by no path.

Under `narrowed="dim"` each kind reads every row through its source, never its narrowing, so a choice reads nothing again; the narrowing's shown keys say which rows draw as themselves. Until a kind's rows land the canvas keeps what it drew; a failed read is said once, in a box at the canvas's top-left, and the footer's loading line says what is read.

```tsx
export const flowchartDepotDimmed = example({
    keywords: ["Flowchart", "Slice.bindRecords", "narrowed", "dim", "Data.bindPaged", "read only", "records", "context"],
    description: "The depot's states and transitions read only through their sources of the rail, the narrowing drawn as context: every row read, the states and transitions it leaves out faded and selected by no path, their details read by key",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // Read only, through their sources: bound with Data.bindPaged alone.
            const states = $.let(Data.bindPaged(depotStates));
            const transitions = $.let(Data.bindPaged(depotTransitions));
            const lanes = $.let(Data.bind(depotLanes));
            const stateRows = $.let(Data.bindPaged(stateEvidence));
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
                        name="depotDimmed"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
```

#### Example — At a phone's width (390px)

Cards keep their size and the canvas pans, one lane at a time, the pager stepping it (R40); Find state selects, and the inspector shows the state's reads and its form.

```tsx
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
```

#### Example — Read only and top down (orientation · minimap · the host's handlers)

The lanes stack down the canvas, the minimap is drawn and the legend left out, with no inspector and no library. The records are bound editable and shown read only: `readOnly` turns every gesture off, whatever the bindings could write. The host hears each state, transition and decision selected and each path traced by an ⌥-click, and shows what it heard last.

```tsx
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
```

## 3. The kinds, the reads and their types

The kinds follow the Schematic's `kinds.ts`: each is a frozen description over the app's row `R`, its field roles typed over `R`, so the editor checks a field's name and type — a role naming a field that isn't there, or holds another type, is a type error naming the fields that fit — and a kind closes the record behind East functions over its rows' bytes, which the renderer calls and never decodes the row for. The reads follow the Plan's `Plan.items` and `Plan.values`: each names a field of the details' row, a mapped type decides which fields fit, and the read is a frozen description behind a phantom brand whose row type is inferred where it is placed.

```ts
// e3-ui/src/flowchart/kinds.ts — the kinds over the app's records, as schematic/kinds.ts types the Schematic's.
// Each takes a binding of a Dict<String, R>: Record.bind(record), editable — read whole, or through its source
// beside entries: Data.bindPaged(record); Data.bind(record), read only and whole; or Data.bindPaged(record) alone,
// read only, through its source. Lanes and decisions take the first and the third alone: they are read whole.

/** Fields of R a name fits: a String, or an Option of one. */
export type FlowchartTextField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends StringType | OptionType<StringType> ? K : never;
}[keyof R["fields"] & string];

/** Fields of R that name a row of another kind by its key: a String — or, for a decision, an Option of one. */
export type FlowchartKeyField<R extends StructType, Optional extends boolean = false> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends (Optional extends true ? StringType | OptionType<StringType> : StringType) ? K : never;
}[keyof R["fields"] & string];

/** Fields of R that name several states by their keys: a decision's queue, an Array or a Set of Strings. */
export type FlowchartKeysField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends ArrayType<StringType> | SetType<StringType> ? K : never;
}[keyof R["fields"] & string];

/** Fields of R that place a row: a state's among its lane's, a Float; a lane's among the lanes, an Integer or a Float. */
export type FlowchartOrderField<R extends StructType, N extends EastType = FloatType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends N ? K : never;
}[keyof R["fields"] & string];

/** R with the fields its roles write left out: the values a card gives a new row. */
export type FlowchartValuesOf<R extends StructType, F extends string> = StructType<Omit<R["fields"], F>>;

/** An accessor over a row and its key, turned into one function (shared/reify.ts). */
type Accessor<R extends StructType, T extends EastType> = (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<T>;

export interface FlowchartStatesSpec<R extends StructType, L extends string, O extends string> {
    name?: string;                                          // what one is called: "State" unless given
    icon?: string;                                          // a Font Awesome solid icon's name
    label: FlowchartTextField<R>;                           // the card's name: a rename writes it
    lane?: L & FlowchartKeyField<R>;                        // its lane, by key: a move across lanes writes it
    order?: O & FlowchartOrderField<R>;                     // its place in its lane: a move between two cards writes it
    members?: Accessor<R, OptionType<IntegerType>>;         // a class of states: the ×N badge
    entries?: unknown;                                      // Data.bindPaged(record): read through the states source
    details?: FlowchartDetails<StructType, FlowchartDetailsSpec<StructType>>;
    templates?: FlowchartTemplates<FlowchartValuesOf<R, L | O>>;   // the Steps tab's cards
    fields?: FieldHints<R["fields"]>;                       // the form over the fields no role writes
    ready?: Accessor<R, typeof EditingReadinessType>;       // the app's check on a drafted state
    inspector?: RowInspector<R>;                            // its own Details, in the form's place
}

export interface FlowchartTransitionsSpec<R extends StructType, F extends string, T extends string, D extends string> {
    name?: string;                                          // "Transition" unless given
    icon?: string;
    from: F & FlowchartKeyField<R>;                         // the state it leaves, by key: Connect writes both ends
    to: T & FlowchartKeyField<R>;                           // the state it enters
    decision?: D & FlowchartKeyField<R, true>;              // the decision that governs it, by key
    kind?: Accessor<R, FlowchartLinkKindType>;              // planned or observed: planned unless given
    evidence?: Accessor<R, OptionType<FlowchartEvidenceType>>;   // the label's evidence line and the stroke's weight
    entries?: unknown;                                      // Data.bindPaged(record): read through the transitions source
    details?: FlowchartDetails<StructType, FlowchartTransitionDetailsSpec>;
    templates?: FlowchartTemplates<FlowchartValuesOf<R, F | T>>;   // the Transitions tab's cards
    fields?: FieldHints<R["fields"]>;
    ready?: Accessor<R, typeof EditingReadinessType>;
    inspector?: RowInspector<R>;
}

export interface FlowchartLanesSpec<R extends StructType, O extends string> {
    name?: string;                                          // "Lane" unless given
    label: FlowchartTextField<R>;                           // its header: + LANE and a rename write it
    order?: O & FlowchartOrderField<R, IntegerType | FloatType>;   // the lanes' order: + LANE writes one past the last
    templates?: FlowchartTemplates<FlowchartValuesOf<R, O>>;         // the Lanes tab's cards
    fields?: FieldHints<R["fields"]>;
    inspector?: RowInspector<R>;
}

export interface FlowchartDecisionsSpec<R extends StructType> {
    name?: string;                                          // "Decision" unless given
    label: Accessor<R, StringType>;
    letter?: Accessor<R, OptionType<StringType>>;           // the diamond's letter: the label's first unless given
    owner?: Accessor<R, OptionType<StringType>>;
    outcomes?: Accessor<R, OptionType<StringType>>;         // its outcomes' summary line
    queue?: FlowchartKeysField<R>;                          // the states queued at it, by key: Del takes a deleted state out
    fields?: FieldHints<R["fields"]>;
    inspector?: RowInspector<R>;
}

export declare function states<R extends StructType, const L extends string = never, const O extends string = never>(
    binding: FlowchartBinding<R>, spec: FlowchartStatesSpec<R, L, O>): FlowchartStates<R>;
export declare function transitions<R extends StructType, const F extends string, const T extends string, const D extends string = never>(
    binding: FlowchartBinding<R>, spec: FlowchartTransitionsSpec<R, F, T, D>): FlowchartTransitions<R>;
export declare function lanes<R extends StructType, const O extends string = never>(binding: FlowchartWholeBinding<R>, spec: FlowchartLanesSpec<R, O>): FlowchartLanes<R>;
export declare function decisions<R extends StructType>(binding: FlowchartWholeBinding<R>, spec: FlowchartDecisionsSpec<R>): FlowchartDecisions<R>;

/** A kind's cards: rows of a record the app keeps, read with Data.bind, each a name, a group and the values a new
 *  row takes; source names the rail's source the list follows. */
export declare function templates<C extends StructType, V extends StructType>(
    rows: SubtypeExprOrValue<DictType<StringType, C>>,
    spec: {
        name: Accessor<C, StringType>;
        group?: Accessor<C, OptionType<StringType>>;
        values: Accessor<C, V>;
        source: string;
    },
): FlowchartTemplates<V>;

/** What an author's card sets on the row of a kind's it is dropped on: some of the row's fields. */
export declare function patch<R extends StructType>(row: R, fields: { [K in keyof R["fields"]]?: SubtypeExprOrValue<R["fields"][K]> }): FlowchartPatch<R>;

/** The Steps, Transitions and Lanes tabs, listing each kind's cards; and an author's tab over any rows, its drop a patch
 *  over a kind's row — a state's, a transition's, a lane's or a decision's — landing on a row of that kind. */
export declare const library: {
    states(options?: { name?: string; icon?: string }): FlowchartLibraryTab;            // "Steps" unless given
    transitions(options?: { name?: string; icon?: string }): FlowchartLibraryTab;       // "Transitions" unless given
    lanes(options?: { name?: string; icon?: string }): FlowchartLibraryTab;             // "Lanes" unless given
    tab<T extends EastType>(rows: SubtypeExprOrValue<DictType<StringType, T> | ArrayType<T>>, options: {
        name: string; icon?: string; source?: string;
        label: (row: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
        meta?: (row: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
        group?: (row: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
        drop?: (row: ExprType<T>, key: ExprType<StringType>) => FlowchartPatch<StructType>;   // left out, its cards are read, never dragged
    }): FlowchartLibraryTab;
};

// The tag's props. Kept from today: name, readOnly, orientation, legend, minimap, freshness, canConnect,
// onSelectState, onSelectLink, onSelectTrigger, onTracePath, and vocabulary's planned and observed. Removed:
// record, data, flow, onApply; inspector's { state, transition } — a kind's own Details is its kind's inspector;
// and vocabulary's flow, lane, state, transition and decision — a kind's noun is its own name (ruling 18).
export interface FlowchartRecordsProps {
    states: FlowchartStates<StructType>;
    transitions?: FlowchartTransitions<StructType>;
    lanes?: FlowchartLanes<StructType>;
    decisions?: FlowchartDecisions<StructType>;
    slice?: { slice: RecordSlices; affordances?: SliceAffordances };   // Slice.bindRecords, its sources states and transitions
    narrowed?: "hide" | "dim";                                         // "hide" unless given
    library?: FlowchartLibraryTab[];
    inspector?: boolean;                                               // the end pane: on unless false
    vocabulary?: { planned?: string; observed?: string };              // a transition's kinds: Planned, Observed unless given
}

// e3-ui/src/flowchart/details.ts — the reads, typed over the details' row R, as plan/reads.ts types
// Plan.items and Plan.values.

/** Fields of R a figure reads: a number, or an Option of one. */
export type FlowchartFigureField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends IntegerType | FloatType | OptionType<IntegerType | FloatType> ? K : never;
}[keyof R["fields"] & string];

/** Fields of R a histogram reads: a Dict from a duration to its count, both numbers — or, beside the app's bins, an Array of counts, one a bin. */
export type FlowchartHistogramField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends DictType<IntegerType | FloatType, IntegerType | FloatType> | ArrayType<IntegerType | FloatType> ? K : never;
}[keyof R["fields"] & string];

/** Fields of R a list reads: a Dict from an item's name to a number, or to a struct its draw reads. */
export type FlowchartListField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends DictType<StringType, IntegerType | FloatType | StructType> ? K : never;
}[keyof R["fields"] & string];

/** Fields of R a tags read reads: an Array or a Set of strings. */
export type FlowchartTagsField<R extends StructType> = {
    [K in keyof R["fields"] & string]: R["fields"][K] extends ArrayType<StringType> | SetType<StringType> ? K : never;
}[keyof R["fields"] & string];

/** An item of the list at F: what its draw is handed. */
export type FlowchartListItem<R extends StructType, F extends FlowchartListField<R>> =
    R["fields"][F] extends DictType<StringType, infer V> ? V : never;

/** The unit a histogram's durations are in; the axis prints them as 15m, 4h, 2d, 1w. */
export type FlowchartDurationUnit = "minutes" | "hours" | "days";

/** How the bars space the bins along the axis, in the Chart's words for its x scales (ChartScaleLiteral):
 *  "band", a bar a bin whatever its span; "linear", each bar as wide as its span. */
export type FlowchartBarScale = "band" | "linear";

/** An edge the axis names: a number, printed as a duration in the unit, or the app's own words. */
export type FlowchartTick = number | { at: number; label: string };

/** What a histogram takes beside its field. */
export interface FlowchartHistogramOptions {
    unit: FlowchartDurationUnit;
    label?: string;
    counts?: string;                                       // what is counted: "parcels"
    bins?: SubtypeExprOrValue<ArrayType<FloatType>>;      // the app's edges, ascending, any spacing: a literal, or bound
    scale?: FlowchartBarScale;                             // "band" unless given
    ticks?: ReadonlyArray<FlowchartTick>;                  // the edges the axis names, besides the first
}

/** A tag's look, as a Tag takes it: east-ui's ColorSchemeType and StyleVariantType. */
export interface FlowchartTagColor {
    colorPalette: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    variant?: SubtypeExprOrValue<StyleVariantType> | StyleVariantLiteral;    // subtle unless given
}

/** Where a read shows — "all", the default: on the canvas, a state's card or a transition's label, and in the
 *  inspector; "canvas": there alone; "inspector": in the inspector alone. A variant on the wire, as the Schematic
 *  carries its narrowed.show ("hide" | "dim"). */
export type FlowchartShow = "all" | "canvas" | "inspector";

/** A read: a frozen description behind a phantom brand — the row R it reads, its kind K, where it shows (W) and,
 *  for tags, whether the legend lists them (L). */
export type FlowchartReadKind = "figure" | "histogram" | "list" | "tags";
export declare const FlowchartReadBrand: unique symbol;
export type FlowchartRead<R extends StructType, K extends FlowchartReadKind, W extends FlowchartShow = FlowchartShow, L extends boolean = false> =
    { readonly [FlowchartReadBrand]: { row: R; kind: K; show: W; legend: L } };

// R is inferred where the read is placed — in a Flowchart.details array — so a field name is checked
// against the row it reads; W is the show given, "all" unless given.
export declare function figure<R extends StructType, F extends FlowchartFigureField<R>, const W extends FlowchartShow = "all">(
    field: F,
    options?: { label?: string; unit?: string; show?: W },
): FlowchartRead<R, "figure", W>;

export declare function histogram<R extends StructType, F extends FlowchartHistogramField<R>, const W extends FlowchartShow = "all">(
    field: F,
    // an Array of counts is a bin each: beside one, the bins are required
    options: FlowchartHistogramOptions & { show?: W } & (R["fields"][F] extends ArrayType<IntegerType | FloatType> ? { bins: SubtypeExprOrValue<ArrayType<FloatType>> } : unknown),
): FlowchartRead<R, "histogram", W>;

export declare function list<R extends StructType, F extends FlowchartListField<R>, const W extends FlowchartShow = "all">(
    field: F,
    options?: { label?: string; unit?: string; top?: 1 | 2 | 3; show?: W },   // top: the card's or label's lines
    draw?: (item: ExprType<FlowchartListItem<R, F>>, name: ExprType<StringType>, row: ExprType<R>) => {
        value: SubtypeExprOrValue<IntegerType | FloatType>;
        note?: SubtypeExprOrValue<OptionType<StringType>>;
    },
): FlowchartRead<R, "list", W>;

export declare function tags<R extends StructType, F extends FlowchartTagsField<R>, const W extends FlowchartShow = "all", const L extends boolean = false>(
    field: F,
    options?: {
        label?: string;
        // first defined, first shown: a literal, or an Array the app binds (Flowchart.Types.TagColor)
        colors?: Record<string, FlowchartTagColor> | SubtypeExprOrValue<ArrayType<FlowchartTagColorType>>;
        legend?: L;                                   // list the defined tags in the canvas's legend — tags on the canvas only
        show?: W;
    },
): FlowchartRead<R, "tags", W, L>;

/** The refusal's words as a type, as plan/nested.ts carries them: unknown unless a tags read in the legend
 *  shows in the inspector alone. */
export type FlowchartLegendOnCanvas<S> = S extends { details: ReadonlyArray<infer D> }
    ? [Extract<D, FlowchartRead<StructType, "tags", "inspector", true>>] extends [never] ? unknown
        : { "Only tags on the canvas go in the legend — show them on the canvas, or drop legend": never }
    : unknown;

/** One kind's details over the app's rows, keyed as the kind's are, read only: Data.bind(record), read whole
 *  beside a kind read whole, or Data.bindPaged(record), read by the drawn rows' keys beside one read through
 *  its source. */
export declare function details<R extends StructType, const S extends FlowchartDetailsSpec<R>>(
    binding: FlowchartDetailsBinding<R>,
    spec: S & FlowchartLegendOnCanvas<S>,
): FlowchartDetails<R, S>;

export interface FlowchartDetailsSpec<R extends StructType> {
    // Every read, any mix of the four, in the order drawn — on a state's card or a transition's label, and in
    // the inspector — each where its show says.
    details: ReadonlyArray<FlowchartRead<R, FlowchartReadKind, FlowchartShow, boolean>>;
}

/** A transition's: its label draws lines — figures and lists — so a tags or a histogram read shows in the
 *  inspector alone, a type error otherwise, with the words "A transition's label draws lines: a figure or a
 *  list — give the histogram show: "inspector"". */
export interface FlowchartTransitionDetailsSpec {
    details: ReadonlyArray<FlowchartRead<StructType, "figure" | "list"> | FlowchartRead<StructType, "tags" | "histogram", "inspector">>;
}
```

### What the editor and the tag say

As the Schematic's kinds and the Plan's nested reads do, a mistake is a type error, and where a plain type error would not say why, the type carries the words; what only the built value shows is refused as the Flowchart is built, in the tag's words.

| Written | Refused with |
|---|---|
| Flowchart.states(states, { label: "slots" }) | `slots` is an Option of an Integer: a type error naming the fields that fit — `"name"`, `"phase"`, `"flow"`. |
| Flowchart.transitions(t, { from: "volume", … }) | `from` names a state by its key, a String: a type error naming the fields that fit — `"src"`, `"dst"`, `"flow"`. |
| order: "name" | `order` is a Float field on a state, an Integer or a Float on a lane: a type error naming those that fit — `"seq"`. |
| states: { lane: "phase" } and no lanes | *A state's lane names a lane — give lanes={Flowchart.lanes(…)}, or drop lane* |
| lanes={…} and no lane on the states | *The lanes are columns: give the states their lane* |
| transitions: { decision: "trigger" } and no decisions | *A transition's decision names a decision — give decisions={Flowchart.decisions(…)}, or drop decision* |
| Flowchart.states(Data.bind(r), { entries: … }) | *entries reads beside Record.bind: bind the states with Record.bind(record), or bind Data.bindPaged(record) alone to read them through their source, read only* |
| Flowchart.states(states.read(), …) | *The states are a record of the app's: bind Record.bind(record) to edit them, Data.bind(record) to read them whole, or Data.bindPaged(record) to read them through their source* |
| Slice.bindRecords(k, { lanes: … }) | *The lanes are read whole: drop the lanes source* — the same for `decisions`. |
| entries: Data.bindPaged(r) and no states source | *The states are read through their source of the slice: give a source named states, Data.bindPaged(record, { indexes }) over the states' record, or drop entries* |
| details: Flowchart.details(Record.bind(r), …) | *Details are read only: bind them with Data.bind(record), or Data.bindPaged(record) beside a kind read through its source* |
| details: Flowchart.details(Data.bind(r), …) beside entries | *The states are read through their source, so their details are read by key: bind them with Data.bindPaged(record)* |
| record={flows} | A type error: the Flowchart takes no `record`, `data`, `flow` or `onApply`. Its records are its kinds. |
| Flowchart.histogram("service", …) | `service` is keyed by a String: a type error naming the fields that fit — `"hours"`. |
| Flowchart.list("origins", { label: "Origin" }) | `origins` holds structs: *Flowchart.list: "origins" holds structs — give a draw, (item) => ({ value: item.parcels })* |
| transitions: … details: [Flowchart.histogram(…)] | *A transition's label draws lines: a figure or a list — give the histogram show: "inspector"*; the same for tags |
| transitions: … two lists, top: 2 each | Refused when the Flowchart is built: *A transition's label draws three lines at most under its evidence, and these draw 4 — give one show: "inspector", or lower its top* |
| Flowchart.list("region", { top: 5 }) | A type error: `top` is 1, 2 or 3 — the inspector lists every item. |
| Flowchart.tags("service", …) | `service` is a Dict: a type error naming the fields that fit, an Array or a Set of strings — `"flags"`. |
| colors: { Hazmat: { colorPalette: "crimson" } } | A type error: `colorPalette` is one of east-ui's colour schemes — `"danger"`, `"red"`, `"brand"`, … |
| Flowchart.histogram("hours", { unit: "hours" }) | `hours` is an Array of counts: *Flowchart.histogram: "hours" is an Array of counts — give the bins it counts in, bins: [0, …]* |
| bins: [0, 12, 4] | Refused when the Flowchart is built: *The bins' edges ascend — 12, then 4*. Bins the app binds are checked as they land: Issues names them, and the bars are drawn absent. |
| Flowchart.tags("shifts", { legend: true, show: "inspector" }) | A type error: *Only tags on the canvas go in the legend — show them on the canvas, or drop legend* |
| show: "inspector" beside inspector={false} | Refused when the Flowchart is built: *The inspector's reads have no pane — drop inspector={false}, or show them on the canvas* |

### What the payload carries

```ts
// e3-ui/src/flowchart/payload.ts — FlowchartPayloadType over the kinds. Its source (record, paged, data), the
// open flow and every Flow type go. Each kind is closed behind East functions over its rows' bytes, as the
// Schematic's are (SchematicItemKindType, SchematicLinkKindType), so no row type of the app's reaches the payload.
states: FlowchartStateKindType,
transitions: OptionType(FlowchartTransitionKindType),
lanes: OptionType(FlowchartLaneKindType),
decisions: OptionType(FlowchartDecisionKindType),
narrowed: VariantType({ hide: NullType, dim: NullType }),
library: ArrayType(FlowchartLibraryTabType),   // states, transitions, lanes, tab — no flows
inspector: BooleanType,                         // the end pane: a kind's own Details is its kind's
vocabulary: StructType({ planned: StringType, observed: StringType }),   // a transition's kinds, resolved

// What every kind carries, as the Schematic's RecordSideFields and KindFields: its name and icon; whether it is
// editable; its session over the record's patch door; the record read by key, where it is read through its
// source; its commits, newest first; its form over the fields no role writes; its own Details; the app's ready;
// set — an author's card's fields written into a row — and the row type.
FlowchartKindFields = {
    name: StringType, icon: StringType,
    editable: BooleanType, editing: OptionType(EditingType), entries: OptionType(ScheduleEntriesType),
    history: OptionType(HistoryType), fields: ArrayType(FieldSpecType), inspector: OptionType(RowInspectorType),
    ready: OptionType(ReadyType), set: FunctionType([BlobType, ArrayType(ScheduleFieldWriteType)], OptionType(BlobType)),
    rowType: EastTypeType,
};

FlowchartStateKindType = StructType({
    ...FlowchartKindFields,
    rows: FunctionType([], OptionType(DictType(StringType, FlowchartStateEntryType))),  // read whole, or complete through its source
    rowsOf: FunctionType([BlobType], DictType(StringType, FlowchartStateEntryType)),   // rows read by key through the states' source — a hidden end's, Find's
    read: FunctionType([BlobType, StringType], FlowchartStateRolesType),               // a drafted row's roles
    write: FunctionType([BlobType, FlowchartStateWriteType], OptionType(BlobType)),    // a gesture's roles written in
    create: FunctionType([FlowchartStateWriteType, OptionType(BlobType)], OptionType(BlobType)),   // its roles, over a card's values or its type's defaults
    laneField: OptionType(StringType),   // the field naming its lane: a conflict on it named by the lane's label, never its key
    details: OptionType(FlowchartDetailsType),
    templates: ArrayType(FlowchartTemplateType),
    templatesSource: OptionType(StringType),
});
FlowchartStateRolesType = StructType({ label: StringType, lane: OptionType(StringType), order: OptionType(FloatType), members: OptionType(IntegerType) });
FlowchartStateWriteType = StructType({ label: OptionType(StringType), lane: OptionType(StringType), order: OptionType(FloatType) });   // none: as it was

FlowchartTransitionKindType = StructType({
    ...FlowchartKindFields,
    rows: FunctionType([], OptionType(DictType(StringType, FlowchartTransitionEntryType))),
    read: FunctionType([BlobType, StringType], FlowchartTransitionRolesType),
    write: FunctionType([BlobType, FlowchartTransitionWriteType], OptionType(BlobType)),   // its ends and its decision
    create: FunctionType([FlowchartTransitionWriteType, OptionType(BlobType)], OptionType(BlobType)),
    fromField: StringType, toField: StringType,   // the fields naming its ends: a conflict on one named by its state's label
    decisionField: OptionType(StringType),        // the field naming its decision: a conflict on it named by the decision's label
    details: OptionType(FlowchartDetailsType),
    templates: ArrayType(FlowchartTemplateType),
    templatesSource: OptionType(StringType),
});
FlowchartTransitionRolesType = StructType({
    from: StringType, to: StringType, decision: OptionType(StringType),
    kind: FlowchartLinkKindType, evidence: OptionType(FlowchartEvidenceType),
});
// none: as it was; a decision's some(none) clears it, as a decision's Del does.
FlowchartTransitionWriteType = StructType({ from: OptionType(StringType), to: OptionType(StringType), decision: OptionType(OptionType(StringType)) });

// Lanes and decisions: read whole, so no entries and no read by key.
FlowchartLaneKindType = StructType({
    ...FlowchartKindFields,
    rows: FunctionType([], OptionType(DictType(StringType, FlowchartLaneEntryType))),
    read: FunctionType([BlobType, StringType], StructType({ label: StringType, order: OptionType(FloatType) })),
    write: FunctionType([BlobType, FlowchartLaneWriteType], OptionType(BlobType)),      // its label, its order
    create: FunctionType([FlowchartLaneWriteType, OptionType(BlobType)], OptionType(BlobType)),   // over a card's values or its type's defaults
    templates: ArrayType(FlowchartTemplateType),
    templatesSource: OptionType(StringType),
});
// none: as it was, or the card's. An Integer order takes a whole number alone: write and create give none for another.
FlowchartLaneWriteType = StructType({ label: OptionType(StringType), order: OptionType(FloatType) });
FlowchartDecisionKindType = StructType({
    ...FlowchartKindFields,
    rows: FunctionType([], OptionType(DictType(StringType, FlowchartDecisionEntryType))),
    read: FunctionType([BlobType, StringType], StructType({
        label: StringType, letter: OptionType(StringType), owner: OptionType(StringType),
        outcomes: OptionType(StringType), queue: ArrayType(StringType),
    })),
    unqueue: OptionType(FunctionType([BlobType, StringType], OptionType(BlobType))),    // a state's key taken out of its queue
});

// The details on a kind: each read described once, and the rows' values, read as the kind is — whole, or by
// the drawn rows' keys through the paged read named.
FlowchartDetailsType = StructType({
    reads: ArrayType(StructType({ show: FlowchartShowType, read: FlowchartReadType })),   // every read, in the details' order
    rows: OptionType(FunctionType([], OptionType(DictType(StringType, BlobType)))),        // read whole, beside a kind read whole
    paged: OptionType(StringType),                                                         // read by key, beside one read through its source
    values: FunctionType([BlobType], FlowchartDetailRowType),                              // a row's values, one a read
});
// Where a read shows: its show, "all" unless given — carried as the Schematic carries its narrowed.show.
FlowchartShowType = VariantType({ all: NullType, canvas: NullType, inspector: NullType });
FlowchartReadType = VariantType({
    figure: StructType({ label: StringType, unit: OptionType(StringType) }),
    histogram: StructType({
        label: StringType,
        unit: VariantType({ minutes: NullType, hours: NullType, days: NullType }),
        counts: OptionType(StringType),
        bins: OptionType(ArrayType(FloatType)),                     // the app's edges; none: every row's edges, merged
        scale: VariantType({ band: NullType, linear: NullType }),   // ChartScaleType's words, without time
        ticks: OptionType(ArrayType(StructType({ at: FloatType, label: OptionType(StringType) }))),   // none: round durations
    }),
    list: StructType({ label: StringType, unit: OptionType(StringType), top: IntegerType }),
    tags: StructType({
        label: StringType,
        colors: ArrayType(FlowchartTagColorType),  // first defined, first shown
        legend: BooleanType,                       // listed in the canvas's legend
    }),
});
// A tag's look: east-ui's ColorSchemeType and StyleVariantType — the pair a Tag takes.
// Exposed as Flowchart.Types.TagColor, for an app that keeps its looks as data.
FlowchartTagColorType = StructType({ tag: StringType, colorPalette: ColorSchemeType, variant: StyleVariantType });

// What a details row holds: one value a read, in the reads' order.
FlowchartDetailRowType = ArrayType(VariantType({
    figure: OptionType(FloatType),
    histogram: ArrayType(StructType({ from: FloatType, count: FloatType })),   // a bin's lower edge, and what it counts
    list: ArrayType(StructType({ name: StringType, value: FloatType, note: OptionType(StringType) })),
    tags: ArrayType(StringType),
}));
```

## 4. Geometry and drawing

|  | Today | Proposed — the visual spec's depot | The rule |
|---|---|---|---|
| **Card** | 116 × 40 | 272 × 216–283 | 272 wide where the details draw on the card; as tall as what it shows, drawn and measured before the layout places it: its head (56 — the label over the key, 4 apart, 12 in from either side), a 1px rule, then each read it shows, in the details' order, 12 apart inside 12 of padding — a figure's line (16); a tag list beside its label, 15 a line and 4 between lines; a title (14) over bars (28) and their axis (12), 4 apart, or over a list's rows (16, 4 apart); *no data* (16) under a title, or in a figure's or a tag list's place. Nothing drawn on the card, no change. |
| **Row pitch, left to right** | 96 | 339, 320 | Each row as tall as its tallest card, its cards centred in it, and 56 between rows. |
| **Lane width, left to right** | ≥ 166 | 426 | The card's width and the gap: the widest label's width and 24, so a label fits between two cards side by side — at least 50, today's. |
| **Lane height, top down** | 112 | 381 | The tallest card and 72, and 26 for each line a label adds. |
| **Row pitch, top down** | 168–260 | 426 | The card's width and the gap: the widest label's width and 24, at least 52 — and, as today, wider where the width allows, up to 144. |
| **Ghost** | 116 × 40 | 272 × 40 | The card's width and 40, centred in its slot: it has no row, so no reads. |
| **Label** | h 18 | h 31 | 18, and 13 a line; its width the longest line's (5.8 a character and 14). |
| **Legend** | pad 122 | pad 210 | The legend's height: 22 a row more for each figure, band and line the cards and labels draw. Its groups of tags stand beside the rows, one over another (ruling 17), 12 apart, so they add height only past the rows'. |

- **Order.** The lanes in their `order`, else by key; each lane's states in theirs, else by key — the order e3 returns a record in, kept under every index the rail picks, though a page of a source comes in its index's order. A state naming no lane stands in a last band, *No lane*; with no lanes record, one band holds every state, as today's does.
- **Figures.** A figure is a line where the details put it: its label, and its value in the app's locale with its unit; a value the row lacks, or a row there is none of, says *no data*. On a label, a line under the evidence; in the inspector, figures side by side share the stats grid.
- **Bars.** One flowchart's histograms share bins — the app's `bins`, else every row's edges merged — so a bar is the same span on every card. On a band axis, the default, a bar is a bin, equal widths whatever its span, as the reference mock draws them; on a linear axis each bar is as wide as its span and as tall as its count over that span, so its area is its count, the open last bin as wide as the one before it. Each card is scaled to its own tallest bar: 28 high on a card, 2 apart on a 1px rule; 64 high across the inspector's pane, where the bar under the pointer or focus darkens. Under a card's bars, as under the inspector's, the axis names the first edge and the edges the app lists; the legend names the read, its range and its scale.
- **Lines.** On a card, each list under its title: its top items by value, each a row — its name, a bar 56 wide filled to its share of the list's total, and the share. On a label, each its name and its share. A name ellipsizes; a share never does. A list with no items says *none*.
- **Tags.** Each tags read is a list beside its label, tag lists one after another sharing a label column: the row's tags in the order their looks are defined, then the rest in the row's order, wrapping — three lines at most, then +n, its title naming the rest. A tag is the design system's Tag — 20 high in the inspector, 15 on a card and in the legend — in its definition's `colorPalette` and `variant`. The visual spec draws the default, subtle: in a palette, a 6% wash of it on a 1px rule of it, its text in the palette's text step; with no definition, or in gray or neutral, the Tag's own look — `--paper-3` on a 1px `--rule`, its fill `--paper` on a selected card. Any other variant takes the Tag recipe's look for it, at that size. A list with no tags says *none*; a row there is none of, *no data*.
- **Legend.** Under today's rows, a row for each figure, band and line the cards and labels draw, in the details' order — its mark, then the read's label and what it shows: *Parcels · a figure on each card*, *Time in state · 0 to 1w+, a bar a bin* (*to scale* on a linear axis), *Service · top 2, by share*, *Region · top 1, under the evidence* — and beside them, one over another, a group for each tag list the app adds: its label, then its defined tags the cards show, in the order defined, at the card's size.
- **Sides.** Each link leaves and enters its cards by the sides it does today: they are chosen over a box of the card's width and today's 40, centred where the card is, and the route meets the card's own sides. Chosen over the card itself, a card taller than it is wide would send a link between lanes out of its top or bottom, through the card beside it.
- **Labels.** Today's placer over the label's box: on each segment, longest first, at its middle, a third and two thirds; then steps across the longest segment off its middle, 22 to 112px, 18 apart. A decision's diamond keeps the middle, and its label steps beside it, as today's keeps a label off a diamond. Three changes keep a label off the cards: two cards side by side keep the widest label's width and 24 between them, since between cards taller than the steps reach a label stepped off a short segment still lands on a card; the same steps are tried off every other segment, longest first; and the last resort is the place tried that covers least of the cards, then of the other labels. Today's last resort is a fixed place under the segment's middle, which in the depot example puts two labels on cards at canvas widths of 800, 1,062 and 1,200px.
- **Inspector.** After the head, the reads it shows, in the details' order: figures side by side sharing the stats grid; every other read under its title, its total beside it — a tag list's count, a histogram's sum in its `counts`, a list's in its `unit`; then the row's form, or the kind's own Details; then a state's Transitions — In, Out and In place, each line its volume — or a transition's Evidence.

## 5. Rules

Each rule names where it lives and what tests it. R1 to R17 are the records; R18 to R41 the details and the drawing; R42 the zoom.

#### R1 — One flowchart over the app's records

The Flowchart draws one flowchart from four records of the app's, each a `Dict<String, R>` of its own row type: its states and its transitions, and beside them its lanes and its decisions. No record of the app's holds a type of the Flowchart's: each kind closes its record behind East functions over its rows' bytes — its rows with their roles, `write`, `create`, `set` and a read by key — which the renderer calls without decoding the row. The props `record`, `data`, `flow` and `onApply`, `Flowchart.over`, `values` and `value`, and the Flow types are gone.

*Where:* e3-ui `flowchart/kinds.ts`, `payload.ts`. *Tested by:* `flowchart.spec.ts`: the examples build and decode; the package exports no Flow type.

#### R2 — Roles

A role is a field of the row where a gesture writes it or it names another row's key: a state's `label`, `lane` and `order`; a transition's `from`, `to` and `decision`; a lane's `label` and `order`; a decision's `queue`. Each is checked against the row's type, and a field that isn't there, or holds another type, is a type error naming the fields that fit. Every other role is an accessor over the row and its key, turned into one function (`shared/reify.ts`): a state's `members`; a transition's `kind` and `evidence`; a decision's `label`, `letter`, `owner` and `outcomes`.

*Where:* e3-ui `kinds.ts`. *Tested by:* type assertions in `flowchart.spec.ts`.

#### R3 — Bindings

A state or a transition binds `Record.bind(record)`, editable and read whole — or, beside `entries: Data.bindPaged(record)`, read through its source; `Data.bind(record)`, read only and whole; or `Data.bindPaged(record)` alone, read only, through its source. A lane or a decision binds `Record.bind` or `Data.bind`, and is read whole. Anything else is refused as the Flowchart is built, naming the form to use; so are a state's `lane` with no `lanes`, a transition's `decision` with no `decisions`, and `lanes` beside states that name none.

*Where:* e3-ui `kinds.ts`, `index.ts`. *Tested by:* `flowchart.spec.ts`: each refusal's words.

#### R4 — The rail

The slice is one `Slice.bindRecords`, read only through `recordSources(…).bind($)`. Its sources named `states` and `transitions` are each `Data.bindPaged(record, { indexes })` over that kind's own record, and each index's choices narrow that kind; a kind read through its source needs one. A source named `lanes` or `decisions` is refused: they are read whole. Every other source is named by a list of cards or a tab that follows it. A preset may narrow both kinds at once: a record holding many flows shows one through a preset over the field both share.

*Where:* e3-ui `index.ts`; the renderer's `sources.ts`. *Tested by:* `flowchart.spec.ts`; `record-sources-captures.spec.ts`: no function captures the whole slice.

#### R5 — Read complete

A kind read through its source is read page by page until done — every row its narrowing keeps, four pages in flight at most (`PagedScan`) — with no cap and no banner, and never by a complete read of its record; a kind read whole is read once. The first read is the frame's cold load; after it, a new narrowing keeps what the canvas drew, busy, while the footer's loading line says what is read, and a failed read is said once, in a box at the canvas's top-left, with Retry.

*Where:* the renderer's `read.ts`, `footer.tsx`. *Tested by:* `flowchart-records.dom.test.tsx` on e3: 2,000 states narrowed and drawn whole, the request log holding pages and no complete read; a delayed and a failing read.

#### R6 — Hide and dim

`narrowed` is `"hide"` unless given: a row the narrowing leaves out is never read. A transition kept whose end the states' narrowing leaves out has that end read by key, every such end in one request: found, the transition is hidden with it; absent, the end is drawn as a ghost and listed in Issues. Under `"dim"` each kind reads every row through its source, never its narrowing, so a choice reads no row again; the narrowing's shown keys say which rows draw as themselves, and the rest draw faded, selected by no path.

*Where:* the renderer's `read.ts`, `model.ts`, `canvas.tsx`. *Tested by:* `flowchart-narrowing.dom.test.tsx`: under both, a transition whose end is hidden and one whose end is absent.

#### R7 — Order

The lanes stand in their `order`, else by key; each lane's states in theirs, else by key — the order e3 returns a record in, kept under every index the rail picks, though a page of a source comes in its index's order. Without an `order`, a move within a lane is not offered. A state whose lane names no lane stands in a last band, *No lane*, and is listed in Issues; with no lanes given, one band holds every state, as today's does.

*Where:* the renderer's `model.ts`. *Tested by:* `model.test.ts`: the same order under two indexes; a missing lane; no lanes.

#### R8 — Gestures write their roles

Each gesture writes its roles' fields alone, every other field as it was, in the record of what it touches: + LANE a lane keyed `lane-<n>` and labelled `Lane <n>`, its order one past the last; a lane's rename its label; × a lane, offered while no state the flowchart holds stands in it; + STATE a state from its lane's editor — its key and its label, its lane, its order one past the lane's last, every other field its type's default; a move its lane and, dropped between two cards, the middle of their orders; a rename its label; Duplicate the row after itself under its key made unique; Connect a transition — its ends, every other field its type's default; a decision's Del clears it from the transitions the flowchart holds; the form the fields no role writes.

*Where:* the renderer's `edits.ts`. *Tested by:* `edits.test.ts`; `flowchart-editing.dom.test.tsx` on e3: each gesture's commit holds its roles' fields alone.

#### R9 — Keys

A saved row's key is fixed: the form prints it. A new state's key is typed in its lane's editor, as today, or is `state-<n>` for a card dropped, and a duplicate's is its key with `-2`, `-3`, … after it; a new lane's is `lane-<n>`; each is the viewer's to change in the form until Save. A new transition's key is minted unique (`crypto.randomUUID()`) and never drawn: a transition is named by its ends everywhere. A kind read whole knows every key it holds; one read through its source asks e3 for its new keys by key before Save, all in one request, and a key e3 holds already is an issue holding Save off.

*Where:* the renderer's `edits.ts`, `session.ts`. *Tested by:* `flowchart-editing.dom.test.tsx`: a new key that a state the narrowing hides holds keeps Save off, and changing it in the form clears it.

#### R10 — Del's reach

A state's Del deletes it, every transition the flowchart holds naming it, and its key from each decision's `queue`; a transition the narrowing hides that names it is left, and Issues lists it, an unresolved end, once it is read. Several states deleted together are one step.

*Where:* the renderer's `edits.ts`. *Tested by:* `edits.test.ts`; `flowchart-editing.dom.test.tsx`.

#### R11 — Drafts out of view

A draft the narrowing hides waits in its record's session by its original key, whatever the narrowing, the page cache or a remount: Issues lists it with the choices hiding it, Go to issue clears just those (the shared hidden pick), and Save writes it with the rest. A new row draws whatever the narrowing.

*Where:* the renderer's `session.ts`, as the Schematic's `drafted.ts`. *Tested by:* `flowchart-narrowing.dom.test.tsx`: a hidden draft saved, and read back after a remount.

#### R12 — Save

One history spans the four records, each a session of its own, a gesture across them one step. Save sends each record's changes through its own patch door, a request of its own; a refusal keeps that record's drafts and leaves the others' commits standing; the shared Save notice says which rows left the narrowing. A kind's `ready` checks a drafted row: `incomplete` or `invalid` holds Save off, and Issues says why.

*Where:* the renderer's `session.ts` over `shared/schedule/editing.ts`. *Tested by:* `flowchart-editing.dom.test.tsx`: undo and redo across records, a refused Save beside another record's commit, a `ready` refusal.

#### R13 — Read only

A kind bound with `Data.bind`, or `Data.bindPaged` alone, takes no gesture: read-only states take no + STATE, move, rename, Duplicate or Del; read-only transitions no Connect or Del; read-only lanes no + LANE, rename or ×; read-only decisions no Del; and no card lands on a read-only kind. `readOnly` makes every kind read only, and the form prints a read-only row's fields.

*Where:* the renderer's `edits.ts`, `canvas.tsx`, `inspector.tsx`. *Tested by:* `flowchart.dom.test.tsx`.

#### R14 — The library

Each kind's cards are `Flowchart.templates(rows, { name, group?, values, source })` on the kind: rows of a record of the app's bound with `Data.bind`, the list following its source of the rail. `Flowchart.library.states()` is the Steps tab of the states' cards — one dropped on a lane adds a state there from its values, keyed `state-<n>`, its order between the cards it lands between; `Flowchart.library.transitions()` is the Transitions tab — one dropped on a transition gives it its values, its ends kept; `Flowchart.library.lanes()` is the Lanes tab — one dropped between two lanes, or at the band row's tail, adds a lane there from its values, keyed `lane-<n>`, its order between the lanes it lands between. `Flowchart.library.tab(rows, { …, drop })` is the app's own tab: its `drop` a `Flowchart.patch(R, { … })` over one kind's row type, which names the kind its cards land on (the shared `buildScheduleTab`, as the Schematic's tabs are). There is no Flows tab.

*Where:* e3-ui `library.ts`; the renderer's `library.tsx`, `drop.ts`. *Tested by:* `flowchart-library.dom.test.tsx` on e3: each card dropped and saved.

#### R15 — Nothing selected

The inspector names the flowchart, as the Schematic's names its drawing: the lanes, states, transitions and decisions it holds, counted; planned · observed · unresolved; and each record's last save and who made it, from its commits.

*Where:* the renderer's `inspector.tsx`. *Tested by:* `flowchart-inspector.dom.test.tsx`.

#### R16 — A row in the inspector, and Issues

A row selected shows its key, printed; its role fields under the role's word — a state's Label and Lane, a transition's From, To and Decision — edited through the same edits as the canvas's, a lane chosen from the lanes and an end from the states; and its kind's form over the fields no role writes, by the kind's `fields` hints — or, given, its kind's own `inspector` in the form's place. Issues lists an end no state is keyed by, a state whose lane names no lane, a transition whose decision names none, a waiting draft with the choices hiding it, a `ready` refusal and a new key e3 holds; each selects what it names.

*Where:* the renderer's `inspector.tsx`, `issues.ts`. *Tested by:* `flowchart-inspector.dom.test.tsx`; `issues.test.ts`.

#### R17 — Find state and the narrow layout

Find state searches the states drawn by key and label and, by key through e3, those the narrowing hides: a hidden pick clears just its choices and selects the state once it is drawn. Below 480px of main nothing drags: the inspector carries the gestures — a state's lane, a transition's ends — through the same edits, and Save stays reachable with a state selected.

*Where:* the renderer's `find.ts`, `index.tsx`. *Tested by:* `find.test.ts`; the showcase's `flowchart-records.spec.ts` at 390 and 360px and in a 294px parent.

#### R18 — The app's rows, read only

`details` on a state or a transition reads the app's rows keyed as the kind's are, through `Flowchart.details`, read only: no gesture writes them, and no type of the Flowchart's enters a record of the app's.

*Where:* e3-ui `flowchart/details.ts`, `payload.ts`. *Tested by:* `flowchart.spec.ts`.

#### R19 — Read as the kind is

Beside a kind read whole, the details bind `Data.bind(record)`, read whole; beside one read through its source, `Data.bindPaged(record)`, read by the keys of the rows drawn, every key in one request. Any other binding is refused, naming the one to use.

*Where:* e3-ui `details.ts`; the renderer's `details.ts`. *Tested by:* `flowchart.spec.ts`; `flowchart-details.dom.test.tsx`: the request log holding the drawn rows' keys alone.

#### R20 — Named, typed reads

`figure`, `histogram`, `list` and `tags` name a field of the row; its type decides what fits; a misfit is a type error naming what fits, or the refusal's words.

*Where:* e3-ui `details.ts`. *Tested by:* type assertions in the spec.

#### R21 — One array, in order

Each kind's `details` is one array of reads, any mix of the four, drawn in its order on a state's card or a transition's label and shown in full, in the same order, in the inspector; each read's `show` says where it shows — `"all"` unless given, `"canvas"` or `"inspector"`. Every element is a read; none names another. A transition's label draws lines — figures and lists — so its tags and histograms take `show: "inspector"`: a type error otherwise, with its words.

*Where:* e3-ui `details.ts`. *Tested by:* type assertions in the spec.

#### R22 — Card size

272 wide where the details draw on the card, 116 without. A card is as tall as what it shows — its head, a rule, then its details in the app's order, each its own block, 12 apart — drawn at its width and measured before the layout places it. Left to right, each row is as tall as its tallest card, its cards centred in it; top down, the lanes are as tall as the tallest card. A ghost is the card's width and 40, centred in its slot. Pitch, lane height, channels and labels follow.

*Where:* `layout.ts`, `canvas.tsx`. *Tested by:* `layout.test.ts` over mixed heights; responsive invariant.

#### R23 — Sides as today

Each link's sides are chosen as today's, over a box of the card's width and today's 40, centred on its card, and its route meets the card's own sides; channels between lanes leave room for the cards' real sizes. A card taller than it is wide never turns a link out of its top or bottom into the card beside it.

*Where:* `layout.ts`. *Tested by:* `layout.test.ts`: every depot link's sides as today's, in both orientations, and no route across a card.

#### R24 — Room for labels

Where the details draw on the cards, two cards side by side — lanes left to right, a lane's cards top down — keep the widest label's width and 24 between them: between cards taller than the placer's steps reach, a label on a short segment has no place off the cards. Today's 50 and 52 stay the least.

*Where:* `layout.ts`. *Tested by:* `layout.test.ts`: no label of the depot example on a card, in both orientations.

#### R25 — Figures

A figure is a line where the details put it: its label, and its value in the app's locale with its unit; a value the row lacks, or a row there is none of, says *no data*. On a transition's label, a line under the evidence. In the inspector, figures side by side share the stats grid.

*Where:* `canvas.tsx`, `inspector.tsx`. *Tested by:* DOM test.

#### R26 — Bars

The flowchart's bins — the app's `bins`, else every row's edges merged — so a bar is the same span on every card. `scale` `"band"`, the default: a bar a bin, equal widths, whatever its span; `"linear"`: each bar as wide as its span and as tall as its count over that span, so its area is its count, the open last bin as wide as the one before it. Bars stand 2 apart; on a linear axis a bar too thin for that draws flush with its neighbours, a pixel wide at least, and every wider bar keeps its 2 (ruling 13). Each card scaled to its own tallest bar, the axis under it.

*Where:* the renderer's `details.ts`, `canvas.tsx`. *Tested by:* the details model's unit tests over both scales; DOM test.

#### R27 — Counts into bins

A Dict's durations count in the bin that holds them, one under the first edge in the first; an Array's counts are a bin each, in the bins' order, and a row with another number of them is listed in Issues, its bars drawn absent. Edges ascend: refused when built, and bins the app binds are checked as they land.

*Where:* the renderer's `details.ts`. *Tested by:* `details.test.ts`.

#### R28 — The axis

Under a card's bars and the inspector's alike, the axis names the first edge and the app's `ticks` — a number printed from the unit, the last edge's ending in +, its bin open; or `{ at, label }`, the app's words as given — and without `ticks`, round durations it has room for. On a band axis a tick between two edges sits as far across its bin; a tick that would go past the axis's end ends there, and a tick too close to its neighbour is left out — never the first edge's, and the last only where it meets the first.

*Where:* `canvas.tsx`, `inspector.tsx`. *Tested by:* DOM test at the card's width, the pane's and a phone's: no tick on another or past the axis.

#### R29 — Lines

On a card, each list under its title; on a label, its lines under the evidence. The list's top items by value — `top`, 2 on a card and 1 on a label unless given, at most 3 — on a card each its name, a bar 56 wide filled to its share of the list's total, and the share; on a label, its name and its share. A name ellipsizes; a share never does. A list with no items says *none*.

*Where:* `canvas.tsx`. *Tested by:* DOM test; responsive invariant.

#### R30 — Tags

Each tags read on the card is a list beside its label, in the details' order, tag lists one after another sharing a label column: the row's tags in the order their looks are defined, then the rest in the row's order, wrapping — three lines at most, then +n, its title naming the rest; a list with none says *none*. Each tag 15 high, in its definition's `colorPalette` and `variant`. Subtle, the default, is a 6% wash of its palette on a 1px rule of it, its text in the palette's text step — and, in gray or neutral or for a tag with no definition, the Tag's own look, its fill `--paper` on a selected card; any other variant is the Tag recipe's look for it, in its definition's palette — solid filled with it, outline on one 1px rule of it — as every Tag given a palette draws (ruling 14). A transition's label draws none.

*Where:* `canvas.tsx`; the `flowchart` recipe's tag-list slots over the tag recipe. *Tested by:* DOM test; responsive invariant: no tag cut, three lines a list at most.

#### R31 — The legend's tags

Each of the card's tags reads with `legend` is a group beside the legend's rows, the groups one over another (ruling 17), 12 apart as a card's reads are, the first level with the rows: its label, drawn from the start, before any of its tags show (ruling 16), then the defined tags the cards show, in the order defined, each at the card's size and in its look; a tag no definition names is left out. A tags read with `show: "inspector"` takes no `legend`: a type error.

*Where:* `canvas.tsx`. *Tested by:* DOM test.

#### R32 — A transition's label

Its evidence line, then its details' lines in order — a figure one, a list its top — three at most, refused when built past them; its box sized by its lines. Placed as today, then by today's steps off every other segment; where no place is clear, the place tried that covers least of the cards, then of the labels — never today's fixed place under the middle, which can cover cards. A decision's diamond keeps the middle, and its label steps beside it. An in-place transition draws no label: its lines are the inspector's.

*Where:* `layout.ts`, `canvas.tsx`. *Tested by:* `layout.test.ts`: no label of the depot example on a card at 800, 1,062 and 1,200px.

#### R33 — No row

A state with no details row draws each of its reads with *no data*; a transition with none keeps its evidence line alone. The inspector says *no data* under Details, where the reads would go.

*Where:* `canvas.tsx`. *Tested by:* DOM test.

#### R34 — Not landed, or failed

Until its row lands a card draws a placeholder where its reads go, as the inspector's fields do; a failed read is said once, in a box at the canvas's top-left; the footer's loading line says what is read.

*Where:* `canvas.tsx`, `footer.tsx`. *Tested by:* DOM test with a delayed and a failing binding.

#### R35 — The inspector's order

The head; the reads it shows — `show` `"all"` or `"inspector"` — in the details' order, in full, figures side by side sharing the stats grid; the row's form or the kind's own Details; then a state's Transitions or a transition's Evidence.

*Where:* `inspector.tsx`. *Tested by:* `flowchart-inspector.dom.test.tsx`.

#### R36 — The inspector's reads

Figures in the stats grid, each its value and its unit, small and muted as on a card, under it where the column has no room (ruling 15); tags, every one, 20 high, wrapping; a histogram on the app's axis, 64 high, with a caption saying where half and nine in ten of its counts fall, or the bin under the pointer or focus, which darkens; a list's first 8 items, then Show n more, and Show fewer once open. Each read but the figures stands under its title, its total beside it.

*Where:* `inspector.tsx`. *Tested by:* DOM test.

#### R37 — A state's transitions

Grouped In, Out and In place, each line with its evidence volume.

*Where:* `inspector.tsx`. *Tested by:* DOM test.

#### R38 — Issues of the details

Counts the bins do not hold, and bins the app binds whose edges do not ascend, are listed in Issues, naming the row and the read. A details row keyed as no row drawn is no issue and draws nothing: the narrowing leaves rows out, and the app keeps rows for what it measures.

*Where:* `issues.ts`. *Tested by:* `issues.test.ts`.

#### R39 — Selection and hover

A card with details, hovered, is `--paper-2`; selected, `--paper-3` in a 1px `--ink` edge, its ×n count and neutral tags on `--paper`, and its bars `--brand-d`, as on every card. A selected transition's label lines are `--brand-dd`. As today, hover dims what it doesn't touch.

*Where:* `canvas.tsx`. *Tested by:* DOM test.

#### R40 — Narrow widths

Cards keep their size and the canvas pans; the inspector's histogram spans the pane; nothing joins the toolbar. On a phone, where the details draw on the cards, the lane pager shows one lane at a time: its window holds only the lanes whose cards fit whole, counted at the card's width and 16 — 288 — so a phone's 390 holds one, whatever `narrow.lanes` asks, and the readout says *Lanes 1 of 3*. A lane keeps its width, the card's and the room R24 keeps for labels, so each step brings its card to the window's middle, and the labels between two lanes are a swipe away, never on a card. Zoomed out (R42), the window holds as many whole lanes as fit, and each step moves a lane's zoomed width.

*Where:* recipes; the renderer's `canvas.tsx`, `lane-pager.tsx`. *Tested by:* responsive at 390, 360 and 294px: one lane in the window, its card whole and centred after each step, and no label on a card.

#### R41 — Words

Numbers in the app's locale; durations from the unit — 15m, 4h, 2d, 1w — and the last bin open-ended, 1w+; the app's own words where its ticks give them. A read with nothing to show says *no data*, and a tag list or a list with no items *none*. A histogram's caption says *Half within 4h · nine in ten within 2d* — *over 1w* where its counts reach the open bin — or, for the bin under the pointer, *4h – 8h · 236 parcels · 22%*, the last bin *1w or more*.

*Where:* `messages.ts`. *Tested by:* unit test.

#### R42 — Zoom

Zoom out, Zoom in and Fit stand after LR · TD: the Schematic's strip, one part both draw, each button titled with its name and drawn with Font Awesome's minus, plus and expand. The Flowchart opens at the cards' own size, as it always has, and a big flowchart scrolls; the zoom is the viewer's while the flowchart is open, never remembered, as the scroll is not. Fit puts the whole flowchart in view — its lanes, + LANE and the legend — never past the cards' own size, so a flowchart that fits already stands at Fit. Each click zooms ×1.5 and brings what is selected to the view's middle, where Find and Go to bring it; with nothing selected, it zooms about the view's middle (ruling 20). Zoom out goes down to Fit, Zoom in up to the cards' own size, each off at its end — both, on a flowchart that fits — and Fit can be clicked at any zoom.

Everything the canvas draws scales — cards, transitions and their labels, decisions, lanes and their headers, + STATE, + LANE and the legend — while the minimap, the lane pager and a failed read's box keep their size. At any zoom the lanes fill main as they do at the cards' size: the layout is computed for main's size over the zoom. Fit is taken from the layout's own size, the size it draws at with no room to fill. A zoom stays as rows land, lanes come and go and main resizes; a zoom Fit or Zoom out put at Fit keeps the whole flowchart in view as it changes, and a zoom below a new Fit comes up to it. A drop, a move, a new transition and + STATE land where the pointer is; Find, a drop and Go to scroll their state to the view's middle at the zoom it stands at, and leave the zoom as it is; the wheel scrolls.

The strip folds last, into Find's View, with LR · TD where a rail folds it there; a flowchart with nothing to find keeps its strip. On a phone the View is a button beside Search Records, holding the strip — and LR · TD where a rail folds it there — which leave the row, as the Schematic's tools and zoom do. Zoomed out, a phone's lane window holds as many whole lanes as fit: each lane keeps its width at the cards' size, the pager steps its zoomed width and counts the whole lanes in view, and a lane is centred only while it is wider than the window.

*Where:* `shared/schedule/zoom.tsx`; the renderer's `canvas.tsx`, `layout.ts` (`layoutExtent`), `lane-pager.tsx`, `toolbar.tsx` and `index.tsx`; the `flowchart` recipe. *Tested by:* DOM tests — the strip's words, its bounds and its clicks, its fold, and on a phone the View holding it; the canvas opening at the cards' own size, a step each way, Fit, and a flowchart that fits standing at Fit; a layout test of the layout's own size; responsive — the whole flowchart inside main at Fit, the cards at the zoom's scale, the view's middle held across a zoom and a selected state brought to it, a drop, a move and a new transition landing where the pointer is zoomed out, the ladder with the strip, and on a phone the View holding the strip and the pager stepping a zoomed lane.

## 6. The reference mock against the Flowchart

The reference mock is evidence for what to show, not for how the Flowchart behaves. Where they differ, the Flowchart's existing behaviour stands unless this proposal changes it.

#### 1. A node is a wide box listing its quantity, a histogram of how long things stayed, and several breakdowns as small tables.

- **The Flowchart today:** A 116 × 40 card: its code, its label, a ×N and an ↻ n badge.
- **This design:** The card widens to 272 and grows to what it shows: the app's details in its order — figures, tag lists beside their labels, histograms' bars, lists' top lines. The inspector shows them in full, with those the app shows only there.
- **What follows:** Cards as big as their reads; a row is as tall as its tallest card, and the canvas pans.

#### 2. An edge's label carries its quantity and a breakdown.

- **The Flowchart today:** One evidence line: volume · count.
- **This design:** The evidence line, then up to three lines: its figures and lists' top items, in the app's order.
- **What follows:** Labels grow taller; cards side by side keep room for them, and the placer moves a label along its segment, or off it, to keep it clear.

#### 3. Selecting a node opens a drawer over the canvas with its tables.

- **The Flowchart today:** Selection shows the inspector's Details in the frame's end pane.
- **This design:** Details gains the reads; no drawer.
- **What follows:** The canvas is never covered; on a phone the pane is BuilderFrame's.

#### 4. A row of category toggles reweights the whole graph.

- **The Flowchart today:** Find state, LR · TD, the freshness chip, the rail and history.
- **This design:** No new control: a category is an index the app declares over a field its states and transitions share, and its choices narrow both through the rail.
- **What follows:** What a category shows is the app's to keep in its records and their indexes; the Flowchart draws what the rail keeps.

#### 5. Selection dims what it does not touch.

- **The Flowchart today:** Hover dims; selection highlights.
- **This design:** Unchanged; the inspector's In and Out name the neighbours.
- **What follows:** No new viewer state to keep.

#### 6. A table per lane sums its nodes, and notes sit under the canvas.

- **The Flowchart today:** A lane is a band with a header.
- **This design:** Not proposed: a lane is a row of the app's lanes record, and its totals stay the app's.
- **What follows:** Lane totals are the app's to show beside the Flowchart, or a later proposal's.

#### 7. Histogram bins are the app's own and uneven, a bar each, the axis naming a few edges.

- **The Flowchart today:** No histograms.
- **This design:** The app's bins, as edges in a unit: a bar each whatever its span (band, the default) or to scale (linear), and the axis naming the edges the app lists, in its words where it gives them.
- **What follows:** Any binning and the axis the app chooses; the flowchart's cards share bins.

#### 8. Every node shows its numbers.

- **The Flowchart today:** States show no number.
- **This design:** The figures the app puts in a card's details, each a line; the rest in the inspector alone.
- **What follows:** The app chooses what a card says at a glance; the inspector holds the rest.

## 7. What it reuses

- **The Schematic's kinds** (`schematic/kinds.ts`) — roles as named fields or turned accessors, the binding forms and their refusals' words, each kind closed behind East functions over its rows' bytes: its rows with their roles, `write`, `create`, `set`, a read by key, its form and its `ready`; keys minted unique; the values a card gives a new row.
- **The rail's plumbing** — `recordSources(…).bind($)`, each source bound once; `FollowSources`; `PagedScan` for a complete read, four pages in flight at most; the narrowing's shown keys; and the shared hidden pick, for Find state and Go to issue.
- **Sessions per record** — `shared/schedule/editing.ts`' one history over a session a record, `shared/schedule/records.ts`' rows kept at their revision, Save through each record's patch door, the Save notice, and the drafts a narrowing hides waiting in their sessions (the Schematic's `drafted.ts`).
- **The Schematic's inspector** — nothing selected: the counts, and each record's last save and who made it (`authorOf`); Issues over every unsaved change, drawn or waiting.
- **BuilderFrame**, the toolbar items and the Dock pane — unchanged; the details add nothing to the toolbar, and the zoom (R42) its strip.
- **The Schematic's zoom** — its strip of Zoom out, Zoom in and Fit, lifted into `shared/schedule/zoom.tsx`, which both draw; and its View, Find's popover holding it, a button of its own beside Search Records on a phone (R42).
- **The Flowchart's model, layout, router and label placer** — assembled from the kinds' rows instead of a flow; the card's and each label's size become inputs.
- **FieldForm and the shared field renderers** — each kind's form over the fields no role writes, and the fields printed read only.
- **The `flowchartInspector` recipe** — its head, stats grid, fact, link and issue parts; new slots beside them for the tags, the histogram and the list. The card's reads are new slots of the `flowchart` recipe.
- **East-ui's look types and the Tag's recipe** — `ColorSchemeType` and `StyleVariantType`, the pair a Tag takes for its look, so an app colours a tag on a card, in the legend or in the inspector as it colours a Tag. The visual spec's sizes, and its subtle and neutral looks, are the `flowchart` recipes' tag slots; every other variant is the Tag recipe's.
- **The phone's lane pager** (`lane-pager.tsx`) — its window, readout and steps, counting lanes at the card's width.
- **The Chart's scale words** — `"band"` and `"linear"`, as east-ui's `ChartScaleType` names a chart's x scales — for how the bars space the bins; and explicit ticks, as a chart axis's `tickValues` places them.
- **`rowInspector`** — a kind's own Details, now on its kind.
- **`shared/reify.ts`** — the accessors, as one function from the row.
- **The Plan's reads** (`plan/reads.ts`) — named fields, frozen descriptions, phantom brands, the row inferred where a read is placed; and its refusal words as types (`plan/nested.ts`).
- **The Schematic's details rules** — bound as their kind is read, a placeholder until they land, a failed read said once.
- **The footer's shared loading line**, and the app's formatters for every number and date.

## 8. Rulings, and the design's decisions

### Ruled

1. **One flowchart over records.** A record of states and a record of transitions, each a Dict of the app's rows, and the rail's index choices narrowing both. The Flows tab goes; the Steps and Transitions tabs stay. — *Ruled 3 Nov 2026*
2. **Everything kept.** Each of states and transitions read through its source of the rail, page by page until done, with no cap and no banner, as the Schematic reads its kinds without an area index and its links; the lanes as columns, each lane's states in the order e3 returns them. — *Ruled 3 Nov 2026*
3. **Lanes and decisions are small records.** Each a keyed record of the app's, read whole beside the states and transitions; a state names its lane by key, and a transition its decision by key; editable as today when bound for editing — *rename a lane on the canvas, add one from the Library, edit a decision in the inspector*. — *Ruled 3 Nov 2026*
4. **One ordered array of details.** `details: []`, any mix of the reads, drawn in its order. — *Ruled 3 Nov 2026*
5. **Where a read shows is a variant.** Not a boolean: built as `show: "all" | "canvas" | "inspector"`, a variant on the wire. — *Ruled 3 Nov 2026*
6. **No mixed-type arrays.** As no other component takes them: each read is one typed description, and a kind's `details` one array of them. — *Ruled 3 Nov 2026*
7. **Bars on an x axis.** A card's bars carry their axis, as the inspector's do. — *Ruled 3 Nov 2026*
8. **Several labelled tag lists.** Each with the app's own colours, and in the legend where the app asks. — *Asked for*
9. **The app's bar scales, and bigger cards.** The app's bins and axis, and cards sized to what they show. — *Asked for*
10. **One pull request.** The records and the details land together, in one pull request. — *Ruled 4 Nov 2026*
11. **The visual spec decides the look; the code design stays.** `Flowchart Records Spec.html` replaces the hi-fi mock as the visual spec, and decides how the details look. The authoring examples, the API, the types, refusals and payload stay as they are, and a tag's colours stay the app's to define, through its `colorPalette` and `variant`. — *Ruled 4 Nov 2026*
12. **A to-scale example.** `flowchartTicketMinutesLinear` draws the support desk's bins to scale beside the band example, so the browser check measures bars on both scales. — *Ruled 4 Nov 2026*
13. **Thin bars drawn to scale.** On a linear axis, a bar too thin for the 2 between bars draws flush with its neighbours, a pixel wide at least; every wider bar keeps its 2. — *Ruled 4 Nov 2026*
14. **Tag colours.** Every Tag given a palette draws in it, solid and outline included: the design system's Tag is fixed, where it drew every solid tag in the brand and every outline in the chip's grey. A Tag given none keeps its look. — *Ruled 4 Nov 2026*
15. **Units in the inspector.** A figure in the inspector shows its unit after its value, small and muted as on a card. — *Ruled 4 Nov 2026*
16. **The legend's tag groups.** A group for each tag list given `legend`, its label drawn even before any of its tags show. — *Ruled 4 Nov 2026*
17. **The legend's tag groups stack.** Beside the rows, the groups stand one over another, where each had stood beside the last with empty room under it. — *Ruled 5 Nov 2026*
18. **Kinds name themselves.** A kind's `name` — `Flowchart.states(record, { …, name: "Stop" })` — is the app's word for it, which the Flowchart says wherever it speaks of one: its tabs, canvas, legend, inspector, footer, find box and refusals. `vocabulary` keeps only the words no kind names, a transition's two kinds: `vocabulary={{ planned?, observed? }}`. One way to name each thing, as the Schematic's kinds are named. — *Ruled 5 Nov 2026*
19. **Zoom.** Zoom out, Zoom in and Fit, the Schematic's strip as it is: Fit puts the whole flowchart in view, Zoom out stops at Fit and Zoom in at the cards' own size, each click ×1.5 about the view's middle. The Flowchart opens at the cards' own size, as today, and the zoom is not remembered, as the scroll is not. As on the Schematic, the strip folds with LR · TD into the popover of a phone's row, and zoomed out more lanes fit in view, the lane pager stepping by the zoomed lane's width. In this pull request. — *Ruled 5 Nov 2026*
20. **Zoom towards the selection.** With a state selected, each click of Zoom in or Zoom out zooms, then brings it to the view's middle, as finding a state does; a selected link, lane or several states the same way. With nothing selected, the view's middle stays put. The Flowchart only, for now: the Schematic's zoom stays about the view's middle. — *Ruled 5 Nov 2026*
21. **Lane names a little bigger.** A lane's name draws at 12px, the size of a card's state code, where it drew at 10px, the spacing between its letters scaled to match; its × stays just past the name's end. — *Ruled 5 Nov 2026*
22. **The rail's picks weigh the details, by kind.** A Dict field of a source's rows — each state's services, in the depot's evidence — sits on the rail, and keys picked there weigh the details of every kind that names the source. Each card still draws one row a state, its counts its picked entries' own, added up by kind with no code from the app: a figure adds, a histogram adds bin by bin, a list adds by name and tags join; a read given `weigh: false` — a share, an average — keeps the row's own. A state holding none of the picks keeps its card, its weighed reads saying *no data*. e3 files the field entry by entry (`index.entries`), so the Flowchart reads only the picked keys' entries, and never a row a category. The depot's own examples show it, in this pull request. — *Ruled 5 Nov 2026*

### The design's decisions

The design takes D1 to D24, each naming what it leaves; the user's rulings above are theirs.

- **D1 — A saved row's key is fixed.** As the Schematic's: the form prints it. Today's rekey of a state or a lane goes — rewriting every transition naming a state would need transitions the narrowing hides. — *Taken: fixed*
- **D2 — A new row's key.** A state's typed in its lane's editor, as today; one dropped from the library `state-<n>`; a lane's `lane-<n>`, as today — each the viewer's to change in the form until Save. A transition's minted unique and never drawn: it is named by its ends everywhere. — *Taken: as described*
- **D3 — A new key e3 holds already.** Checked by key before Save, every new key in one request — an issue holding Save off — rather than learnt from a refused Save. — *Taken: checked*
- **D4 — Order.** Ruling 2 stacks each lane's states in the order e3 returns them. e3 returns a record by key, but a page of a source in the order of the index the rail picks, which would move a lane's states at every choice — so each lane's states stand by key, the record's order, under every index. An app that gives an optional `order` on the states (a Float) and the lanes (an Integer or a Float) places them by it instead, so a drop between two cards writes the middle of theirs; without it, a move within a lane is not offered. — *Taken: by key, or by order*
- **D5 — Adding a lane.** Ruling 3 adds a lane from the library: the lanes take cards as the states do, `Flowchart.templates` on the lanes, and `Flowchart.library.lanes()` lists them; one dropped between two lanes, or at the band row's tail, adds a lane there from its values, keyed `lane-<n>`, its order between theirs. + LANE stays on the canvas, as today, and a lane's label is renamed there. — *Taken: the library and the canvas*
- **D6 — Del's reach.** A state's Del deletes every transition the flowchart holds naming it, and its key in a decision's queue; one the transitions' narrowing hides is left, and Issues lists it once read — the Schematic's cascade. — *Taken: as the Schematic*
- **D7 — The far end of a transition.** Under `"hide"`, an end the states' narrowing leaves out is read by key, every such end in one request: found, the transition is hidden with it; absent, the ghost. — *Taken: read by key*
- **D8 — The library's cards.** On their kinds, as the Schematic's: `Flowchart.templates(rows, { name, group?, values, source })`, a state's values every field but its lane and its place, a transition's every field but its ends, a lane's every field but its place. — *Taken: on the kinds*
- **D9 — Many flows.** A field both records share — the flow's name — narrowed by a preset over the two sources, rather than a list of flows of the Flowchart's own. — *Taken: a preset*
- **D10 — Details are read only.** The app's measures, written by its tasks: bound `Data.bind` or `Data.bindPaged`, never edited in the inspector. — *Taken: read only*
- **D11 — The narrowing's default.** `"hide"`, as the Schematic's; `"dim"` where the app asks. — *Taken: hide*
- **D12 — A state with no lane.** Drawn in a last band, *No lane*, and listed in Issues. Today's draws it in the last lane, as though it stood there. — *Taken: a last band*
- **D13 — Card width.** 272 where the details draw on the card, near the reference mock's nodes, so a tag list holds three or four tags a line — or a width the app chooses. — *Taken: 272*
- **D14 — Card height.** Each card as tall as what it shows, a row as tall as its tallest — or one height for the flowchart, its fullest card's. — *Taken: each its own*
- **D15 — Where the reads sit.** After the head and before the form — or after the form, beside a transition's Evidence. — *Taken: after the head*
- **D16 — A state's transitions.** Grouped In, Out and In place, each line with its volume — or today's single list. — *Taken: grouped*
- **D17 — Histogram units.** Durations to start — minutes, hours, days — with other units (a weight, a count) later. — *Taken: durations first*
- **D18 — List fields.** Dicts only to start; an Array of structs with a `name` accessor later. — *Taken: Dicts first*
- **D19 — What a card shows.** The app's details, in its order, with no viewer switch in the toolbar. — *Taken: the app's*
- **D20 — Lanes.** No lane details for now; a lane's totals stay the app's, beside the Flowchart. — *Taken: not now*
- **D21 — Tags in the legend.** The defined tags the cards show, in the order defined — or every defined tag, shown or not. — *Taken: those shown*
- **D22 — Tags on a card.** Each list beside its label, its tags wrapping to three lines and then +n — or each list under its title, its tags across the card's full width; or every tag, however many lines it takes. — *Taken: beside, three lines*
- **D23 — Bar scales and the middle case.** Band, a bar a bin, as the default, and linear, to scale — a log axis later if an app asks; and `show`'s middle case named `"canvas"` rather than `"node"`, since a transition's details draw on its label. — *Taken: band and linear; canvas*
- **D24 — A phone's window.** Where the details draw on the cards, one lane at a time, each step bringing its card to the middle and the labels between two lanes a swipe away — or the lanes squeezed to the phone's width, the next lane's edge in view and the labels between them on the cards. — *Taken: one lane, its card in the middle*

## 9. Tasks

The work lands in one pull request (ruling 10): the records cutover first — tasks 1 to 6 — since removing the Flow types takes the renderer and the examples with it, then the details — tasks 7 to 10 — each part closed by task 11. The details look as the visual spec draws them (ruling 11). The zoom, task 12, follows (rulings 19 and 20), then the lane names, task 13 (ruling 21). The rail's picks weigh the details last (ruling 22): e3's entries index, task 14, then the Flowchart's weighing, task 15, then the depot's examples, task 16.

1. **The kinds** (e3-ui) — `Flowchart.states`, `transitions`, `lanes` and `decisions` over the app's records: their roles typed over the row, the binding forms and every refusal's words; each kind closed behind East functions over its rows' bytes — rows with their roles, `write`, `create`, `set`, a read by key, its form, its `ready` and its own Details; the slice's `states` and `transitions` sources through `recordSources`, and `narrowed`; the payload. `record`, `data`, `flow`, `onApply`, `Flowchart.over`, `values`, `value` and the Flow types removed.

   **Done when:** the minimal, depot, editing, dimmed, phone and top-down examples build and decode on e3-web; each refusal is a type error or the tag's words; nothing of the Flow types is left in the package.

2. **The library** (e3-ui and the renderer) — `Flowchart.templates` on the kinds; `Flowchart.library.states()`, `transitions()` and `lanes()` listing them, each following its source; `Flowchart.library.tab` with a `Flowchart.patch` over any kind's row; the Flows tab and its code removed.

   **Done when:** the library's DOM tests drop each card on e3 — a state from its values in the lane it lands in, a transition given a card's values, a lane added where it lands, an owner made a decision's — and nothing renders a Flows tab.

3. **Reading the records** (the renderer) — each kind read whole, or complete through its source (`PagedScan`); lanes and decisions whole; the far ends read by key under `"hide"`; `"dim"` from the source's shown keys; the model assembled from the kinds' rows with the drafts in place, in their order; the loading line, placeholders, a failed read said once.

   **Done when:** on e3, a 2,000-state record narrowed by the rail is read complete and drawn whole, the request log showing pages and no complete read of the record; hide and dim are tested with a transition whose end is hidden and one whose end is absent.

4. **Editing** (the renderer) — one history over a session a record; every gesture writing its roles' fields as R8 says; keys as R9; Del's reach; drafts a narrowing hides waiting in their sessions; Save through each record's patch door, a refusal keeping that record's drafts; read only per kind.

   **Done when:** the editing DOM tests on e3 cover each gesture, undo and redo across records, a refused Save of one record beside another's commit, a hidden draft saved, and Save and a remount reading back.

5. **The inspector, Issues and Find state** — nothing selected: the counts and each record's last save; a row's form over its kind's fields no role writes, or its own Details; Issues — an unresolved end, no lane, no decision, a waiting draft with its hiding choices, a `ready` refusal, a new key e3 holds; Find state over the states drawn and, by key through e3, those hidden, through the shared hidden pick.

   **Done when:** the inspector's DOM tests cover each view and each issue; Go to issue and Find's pick of a hidden state clear just its choices and select it once drawn.

6. **The narrow layout** — below 480px of main, as today: nothing drags, and Details carries the gestures — a state's lane, a transition's ends — through the same edits.

   **Done when:** the showcase's responsive suite at 390, 360 and a 294px parent, in both themes: Find, a state's form, a lane chosen, Save reachable with a state selected, and a remount.

7. **The reads** (e3-ui) — `Flowchart.details` with its one `details` array, drawn in order, and each read's `show`; `figure`, `histogram` with its `bins`, `scale` and `ticks`, `list`, and `tags` with its looks over east-ui's `ColorSchemeType` and `StyleVariantType`; the mapped field types and the refusal words; the payload's `details` on each kind; the tag colour and bins examples.

   **Done when:** the examples build and decode, and each refusal is a type error or the tag's words.

8. **The details model** (the renderer) — the details read as their kind is, matched to its rows by key; counted into the flowchart's bins — the app's, or every row's edges merged; each card sized; counts the bins don't hold listed in Issues.

   **Done when:** its unit tests cover the app's bins over a Dict and an Array, merged bins, a row with no details and a delayed and a failing binding.

9. **Layout over card sizes** — `computeLayout` takes the card's width, each card's height and each label's size; each row as tall as its tallest card; two cards side by side keeping the widest label's width and 24 between them; each link's sides chosen over a box of the card's width and today's 40, so no link's sides change; the placer works over label boxes, steps off every segment, and its last resort covers least of the cards; a decision's diamond keeps the middle, its label beside it; a phone's window counting lanes at the card's width, one lane at a time where the details draw on the cards, each step bringing its card to the middle.

   **Done when:** layout tests pass in both orientations over cards of mixed heights, every link of the depot example keeps today's sides and crosses no card, and its labels sit clear of the cards at 800, 1,062 and 1,200px, where today two do not; at 390, 360 and in a 294px parent, the window holds one lane, its card whole and centred after each step.

10. **Cards, labels, the legend and the inspector's reads** — each card drawn and measured before the layout places it: the reads it shows, in the app's order — figures, tag lists beside their labels, wrapping and folding at three lines, the bars and their axis on either scale, the lines — the label lines, the legend rows and its groups of tags, each tag in its definition's palette and variant; the inspector's reads in the details' order, the histogram's caption and the bin under the pointer or focus, lists with Show n more and Show fewer; In, Out and In place — every part in the visual spec's looks.

   **Done when:** DOM tests and a responsive invariant — every read inside its card, no tag cut, three lines a list at most, bars inside their band and ticks clear of each other on both scales, labels clear — pass in both themes at desktop and phone widths; the inspector's DOM tests cover each read, the order beside a kind's own Details, and read only; and a DOM check measures the depot's parts against the visual spec in both themes, with no screenshot — the card's head, rule, padding and read spacing; a figure's line; a tag's height, spacing and wrapping; the bars' height and spacing, and the axis; a list row's name, bar and share; *no data* and *none*; a label's lines; the legend's rows and tags; the inspector's tags, histogram, list rows, Show n more and Show fewer; and the hover and selected looks.

11. **Docs and the showcase** — the e3-ui skill and its CLAUDE.md, the renderer's CLAUDE.md, the API docs, the showcase's Flowchart page on e3, and the plugin index regenerated.

   **Done when:** the skill shows the minimal and depot examples, the index finds them, and the showcase's page draws each example on e3.

12. **Zoom** (the renderer) — the Schematic's zoom strip shared, and the Schematic drawing it; the Flowchart's strip, its words, its fold into Find's View and the phone's View; the canvas at a zoom — laid out for main's size over it, Fit from the layout's own size, and the pointer, Find's scroll, the drops and the lane pager through it; Zoom out and Zoom in towards what is selected (R42).

   **Done when:** DOM tests cover the strip's words and bounds — both off on a flowchart that fits — its steps and Fit, and on a phone the View holding it; the responsive suite measures the whole flowchart inside main at Fit, the cards at the zoom's scale, the view's middle held across a zoom and a selected state brought to it, a drop, a move and a new transition landing where the pointer is zoomed out, the ladder with the strip, and on a phone the View holding the strip and the pager stepping a zoomed lane.

13. **Lane names** (the renderer) — a lane's name at 12px, its look in the `flowchart` recipe and its place alone the renderer's, and its × placed past the longer name, level with it (ruling 21).

   **Done when:** a responsive check finds each lane's name at 12px, its × just past the name's end, clear of it and level with it, across the top in LR and down the side in TD.

14. **An entries index** (e3) — `index.entries(field)`: a row's Dict field filed entry by entry, `{ ik: the entry's key, k: the row's key } → its value`, a key's entries across the record one range; the lean rows kept beside it, `<index>_rows`, and the record's other indexes that carry nothing or the row carrying it with the field emptied; its build and its maintenance, the in-page one a binding previews a Save with too; its refusals in words; the definition's field and key type, for a binding and the rail (ruling 22).

   **Done when:** spec tests refuse each refusal in words, TypeScript refusing a field that is not a Dict where it is written; the e3-api-tests suite passes on every backend — the index built; maintained after a patch, an edit and a reduce, each time its rebuild's byte for byte; one key's range, read alone, holding every row's entry for it in key order; the lean rows and a page through another index holding the field empty — and no stored form changes.

15. **The rail's picks weigh the details** (e3-ui and the renderer) — a source's Dict field on the rail through its entries index, its keys listed, counted and picked; `Flowchart.details`' `source` and each read's `weigh`; the fold, built in East, adding a state's picked entries up by kind; the payload's `weighed`; the picked keys' ranges read page by page, *no data* for a state holding none of the picks, and the inspector's line naming the picks (R43–R46, ruling 22).

   **Done when:** e3-ui specs add each kind over the depot's types, keep the row's own under `weigh: false` and for a field the entries lack, and refuse each refusal in words; DOM tests on e3-web pick on the rail and measure the cards — every key picked drawing as no pick does, *no data*, a pick on the source's other field, the inspector's line — and the request log holds the picked keys' ranges and the rows by key, and no read of the record's own rows.

16. **The depot weighed by service** (the examples and docs) — the depot's evidence holding each service's own figures, made up to add up to the state's own, and its entries index; `flowchartDepot`'s rail offering the services, and `flowchartDepotDimmed` opening on International; the e3-ui skill, the API docs, the showcase and the plugin index (ruling 22).

   **Done when:** both examples build and decode on e3-web; the browser checks pick on the rail and measure in both themes — Sorted's parcels and bars with Standard and Priority picked, every service picked drawing as none, a returns state's weighed reads saying *no data* with International picked, the dimmed example opening on International, the inspector's line — and the index finds the weighing by its words.

Every figure on this page is made up: the depot's in the visual spec, and the examples'.
