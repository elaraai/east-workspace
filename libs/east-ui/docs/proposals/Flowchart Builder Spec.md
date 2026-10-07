# Flowchart Builder — design

Epic #1240.

The e3-ui `Flowchart`: the state-transition flowchart moves from east-ui to
e3-ui, and is laid out in `BuilderFrame` as the Sheet, the Plan, Studio's
builder and the query builder are: one toolbar holding every control the
flowchart has, a library (the record's flows, the state and transition
templates, cards of the author's own), the open flow on the canvas in main, and
an inspector for what is selected.

It is one component, `<Flowchart>`: it renders in its frame wherever it is used,
its library and inspector are optional props, and its flows come from an e3
record bound with its patch mutation, or are the host's (`data`). It reuses
what the Plan and Sheet builders built (epic #1175): the frame, the shared
toolbar and its items, the editing session and its history item, the
`Library`, `NamePopover`, `Fields` and `FieldForm`, the drag layer, and
`Record.onApply`. Nothing the canvas draws changes.

## 0. The files

| File | What it is |
|---|---|
| `Flowchart Builder Spec.md` | This design. |
| `Flowchart Spec.html`, `Flowchart Spec.png` | The canvas itself, unchanged in grammar: lanes, state cards, H/V transitions, decision diamonds, evidence badges, the legend, the minimap, hover cards. Its words and data move to the parcel depot (decision 9). |
| `Sheet Builder Spec.md`, `Plan Builder Spec.md` | The builders this follows, part for part: the frame, the toolbar, the session, the library's tabs, the inspector's form, drag and drop. |
| `Query Editor Spec.md` | The library tab of a record's documents, one open at a time, and `NamePopover` for a new one. |

There is no hi-fi mock of the builder. The canvas looks as `Flowchart Spec.html`
has it, the frame, library and inspector as the Sheet's and the Calendar's. An
agent measures either in a headless browser, through its DOM, and never reads a
screenshot.

## 1. Summary

- **What.** `<Flowchart>` is the flowchart in its frame: lanes, states,
  transitions planned and observed, decision triggers, evidence-weighted
  strokes, the ↻ in-place badge, unresolved ghosts, hover cards, the legend and
  the minimap, as the east-ui `<Flowchart>` had them. Around it go a library
  and an inspector, each an optional prop, and drag and drop.
- **Where.** The Flowchart moves to e3 whole. Its wire types, factories, JSX
  tag, examples and skill text go to e3-ui (`libs/east-ui/packages/e3-ui/src/flowchart/`),
  on one carrier, `Flowchart`. Its React renderer, with its DOM tests, goes to
  e3-ui-components (`src/flowchart/`), which registers it. Its slot recipe
  stays in east-ui-components' theme, and the shared parts it imports reach it
  through `@elaraai/east-ui-components/internal`.
- **Flows.** `record={…}`, a `Record.bind` handle bound with its patch
  mutation, whose type is either `Flowchart.Types.Flows` — a `Dict` of whole
  flowcharts, by name, the usual case — or `Flowchart.Types.Flow`, one
  flowchart. The type decides (decision 3). Over a `Dict`, the library's Flows
  tab lists every flow and opens one on the canvas, as the query builder's
  Library tab opens a saved query. Or `data={…}`: the host's value, read only
  unless the host gives `onApply`.
- **Draws.** `BuilderFrame`: one toolbar (find state, LR · TD, the slice's rail
  over host data, the history item with Apply); the library in the start pane,
  the tabs `library` lists, none when it lists none; the open flow's canvas in
  main; the inspector (Details · Issues) in the end pane when given
  `inspector`; the footer's counts.
- **Built in.** Undo, redo and discard; Apply as one checked commit through the
  record's patch mutation; every canvas gesture as one transaction (a state
  added, edited, moved or deleted; a transition connected, retyped or deleted;
  a lane added, renamed or deleted; a decision edited); drag and drop (a state
  template onto a lane, a transition template onto a transition); the
  inspector's form for every state, transition, decision and lane. The app wires
  none of it.
- **Keeps.** Everything today's flowchart draws, and its pointer grammar: the
  dim ladder, hover cards, selection, ⌥-click trace, drag-to-connect from any
  handle, the `canConnect` veto, the duplicate pulse, cross-lane moves, the
  "+ STATE" ghost and the inline editor, "+ LANE", LR · TD.

## 2. Decisions

1. **The Flowchart moves to e3 whole**: its wire types, factories, tag,
   examples, specs and skill text to e3-ui, and its renderer with its tests to
   e3-ui-components, on one carrier, `Flowchart`. east-ui loses its arm;
   east-ui-components keeps only the slot recipe in its theme and the shared
   parts, exported through `/internal`. As the Sheet's and the Plan's did
   (#1177, #1179).
2. **One Flowchart, always in its frame**, as `<Sheet>` and `<Plan>` are
   (#1216, #1191): its library and inspector are optional props, no prop no
   pane. A flowchart with neither is its toolbar, its canvas and its footer. It
   fills the box it is given and scrolls its own canvas.
3. **The flows are a record's** (ruled 2026-10-07, "One flow per record
   entry"), its type `Flowchart.Types.Flows` (`Dict<String, Flow>`, by name) or
   `Flowchart.Types.Flow` (one flow). One prop takes either, and the record's
   type picks the arm at build, by East's type machinery (`isTypeEqual`) and the
   tag's overloads — never a second prop (the user, 2026-10-07: "we could always
   make the type be Dict<FlowchartType> | FlowchartType … you could do type
   inference"). Many flows are the usual case (the user: "its rare that … there
   would ever be a single flowchart"). Apply is one commit of the open flow, so a
   state and the transitions that point at it always commit together.
4. **The record holds the Flowchart's own types**, as the query builder's record
   holds `Query.Types.Saved`: a flow is `{ description, lanes, states, links,
   triggers }` of today's row types. Today's mappers from an app's own tables
   live on as `Flowchart.over(…)`, which builds one `Flow` from them (§4.3), as
   `Plan.over` builds rows over data.
5. **A Flows tab, as the query builder's Library tab** (the user, 2026-10-07:
   "we need the library tab showing all flowchart values in the record … and I
   can view a single one"): `Flowchart.library.flows()` lists every flow in the
   record; a click opens it on the canvas. The open flow is shared by the
   flowchart's `name` in the UI store, as the query builder shares its open query
   by `id`. "+ New flow" names one in a `NamePopover`.
6. **Templates come from bound data** (the user, 2026-10-07: "they should come
   from bound data"), unlike the Sheet's code-only templates:
   `Flowchart.library.states(rows, { … })` and
   `Flowchart.library.transitions(rows, { … })` read their cards from an array
   or a dictionary the app binds, as `Sheet.library.tab` does, each card's `drop`
   the `Flowchart.patch` it applies.
7. **A state template adds a state** (ruled 2026-10-07, "Templates, as the
   Sheet's"): dropped on a lane, it inserts a state seeded with the template's
   fields where it lands. The canvas draws it as it draws every state.
8. **A transition template retypes a transition** (ruled 2026-10-07, "Connect,
   then retype"): the connect gesture makes a transition of the default type
   (planned, no decision); a transition card dropped on a transition, or the
   inspector, sets its kind, its decision and its other fields.
9. **Sample data is a parcel depot** (ruled 2026-10-07): parcels through intake,
   sort, hold, load and dispatch, delivered or returned; decisions such as route
   and customs check; volumes in parcels — in the examples, tests, the showcase,
   docs, the mock and its PNG alike. Nothing names a client or a client's trade.
10. **The session is the shared `Editing` session**, its rows the flows by name:
    every gesture is one transaction over the open flow, the history item undoes,
    redoes, discards and applies, and Apply commits through `Record.onApply`.
    Each flow keeps its own drafts until applied or discarded, as each of a
    Sheet's entries does.
11. **The inspector's form is `Fields`** (#1147), as the Sheet's and the Plan's
    are, over the Flowchart's own types: a state's, a transition's, a decision's
    and a lane's fields, each by the shared input its type takes.
12. **Every example uses bound sources** (§2a), and runs on e3-web in the
    showcase.
13. **The flowchart's name is `name`**: its open flow's UI store key, its
    viewer state, its library's drag-source id and its drop target.
14. **No new hi-fi mock**: the canvas follows `Flowchart Spec.html` (re-themed,
    decision 9), and the frame, library and inspector the Sheet's.

## 2a. Example data idiom

Every example binds its data from e3, so it runs on e3-web in the showcase:
`e3.input` and `e3.record` declarations at module scope, with small literal
defaults, bound in the East body with `Data.bind` or `Record.bind`. Writes go
through a record's patch mutation. Never `State.bind` for data, and never an
inline collection as a component's data; `State` holds only a viewer's own
state.

A record of flows ships with its flows through `Flowchart.values(…)`, and a
record of one flow with it through `Flowchart.value(…)` (§4.3), each checked
when the package builds. Templates are rows of the app's own
types in an `e3.input` or an `e3.record`.

An example seeds what its panes read, so none is empty: several flows in the
record, state and transition templates in the library, a flow with a decision,
an observed transition, a state class, an in-place transition and an
unresolved one, and a draft the Issues tab lists.

## 3. The authoring surface

### 3.1 The records an app declares

```ts
// records.ts
import { ArrayType, BooleanType, IntegerType, OptionType, StringType, StructType, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Flowchart } from "@elaraai/e3-ui";

// The depot's flows, by name: each a whole flowchart.
export const flows      = e3.record("depot_flows", Flowchart.Types.Flows, Flowchart.values({
    "Inbound parcels": {
        description: "From the trailer to the van",
        lanes:  [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }],
        states: [{ key: "ARV", label: "Arrived", lane: "intake" }, { key: "SCN", label: "Scanned", lane: "intake" },
                 { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n }, { key: "LDD", label: "Loaded", lane: "load" }],
        links:  [{ from: "ARV", to: "SCN" }, { from: "SCN", to: "CH*", trigger: "route" }, { from: "CH*", to: "LDD" }],
        triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
    },
    "Returns": { lanes: [/* … */], states: [/* … */], links: [/* … */] },
}));
export const flowsPatch = e3.mutation.patch(flows);

// One flow, for an app that has only one.
export const handover      = e3.record("handover", Flowchart.Types.Flow, Flowchart.value({ lanes: [], states: [], links: [] }));
export const handoverPatch = e3.mutation.patch(handover);

// The templates: the app's own rows, read only.
export const StepRow = StructType({ code: StringType, name: StringType, kind: StringType, slots: OptionType(IntegerType) });
export const steps   = e3.input("step_templates", ArrayType(StepRow), variant("value", []));
export const MoveRow = StructType({ name: StringType, observed: BooleanType, decision: OptionType(StringType) });
export const moves   = e3.input("transition_templates", ArrayType(MoveRow), variant("value", []));
```

`Flowchart.values` and `Flowchart.value` fill what a literal leaves out (`description`, a state's
`label`, `members` and `notes`, a link's `key`, `kind`, `trigger` and
`evidence`, a lane's `label`, `triggers`) and refuses at build what would not
draw or commit (§4.4).

### 3.2 The smallest flowchart

```tsx
// handover.tsx
import { East } from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Flowchart, Record, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const handoverUi = ui("handover", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const flow = $.let(Record.bind(d.handover, [d.handoverPatch]));
        return <Box height="560px"><Flowchart record={flow} /></Box>;
    }}</Reactive>
)));
```

That is a working editor over one flow: "+ LANE", the "+ STATE" ghost, drag to
connect, double-click to edit, drag across lanes, Del to delete. Every gesture
is a draft the history item undoes, and Apply commits the drafts as one patch
through `handoverPatch`. It lists no `library` and is given no `inspector`, so
it has neither pane: the toolbar, the canvas and the footer.

### 3.3 The depot's flows

```tsx
// depot.tsx
import { East, StringType, some, variant } from "@elaraai/east";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui";
import { Data, Flowchart, Record, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const depot = ui("depot_flows", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const flows = $.let(Record.bind(d.flows, [d.flowsPatch]));
        const steps = $.let(Data.bind(d.steps));
        const moves = $.let(Data.bind(d.moves));
        return (
            <Flowchart
                record={flows}
                flow="Inbound parcels"
                library={[
                    Flowchart.library.flows(),
                    // Step types: a card dropped on a lane adds a state seeded with what its drop sets.
                    Flowchart.library.states(steps.read(), {
                        name: "Steps", icon: "box",
                        key: s => s.code, label: s => s.name, meta: s => some(s.kind), group: s => s.kind,
                        drop: s => Flowchart.patch(Flowchart.Types.State, { key: s.code, label: s.name, members: s.slots }),
                    }),
                    // Transition types: a card dropped on a transition retypes it.
                    Flowchart.library.transitions(moves.read(), {
                        name: "Transitions", icon: "arrow-right",
                        key: m => m.name, label: m => m.name,
                        drop: m => Flowchart.patch(Flowchart.Types.Link, {
                            kind: m.observed.ifElse(() => some(variant("observed", null)), () => some(variant("planned", null))),
                            trigger: m.decision,
                        }),
                    }),
                ]}
                inspector
                stateHover={East.function([StringType], UIComponentType, (_$, key) => <Text>{key}</Text>)}
                name="depot"
            />
        );
    }}</Reactive>
)));
```

The Flows tab lists "Inbound parcels", "Returns" and every other flow in the
record; a click opens one on the canvas, keeping each flow's drafts. "+ New
flow" asks for a name and opens an empty flow, which Apply inserts.

### 3.4 A flow from the host's tables

An app whose flow is computed — transitions mined from scans, narrowed by a
slice — builds one `Flow` from its own tables, with today's mappers, and shows it
read only:

```tsx
const scans = $.let(Data.bind(d.scanTransitions));
const slice = $.let(Slice.bind([d.ScanRow], "depot.scans", cfg, Slice.state({}), scans.read(), none));
<Flowchart
    data={Flowchart.over(states, {
        state: s => ({ key: s.code, label: s.name, lane: s.phase }),
        links: Slice.rows([d.ScanRow], slice),
        link:  l => ({ from: l.src, to: l.dst, kind: l.kind, evidence: { volume: l.parcels, unit: "parcels" } }),
        lanes: d.LANES,
    })}
    slice={slice} affordances={["filter", "search"]}
    freshness={{ label: "scans-2026.09" }}
/>
```

| | `record` | `data` |
|---|---|---|
| Takes | `Record.bind(rec, [patch])`, `rec` of `Flowchart.Types.Flows` or `Flowchart.Types.Flow` | a value, an expression or a bind handle of either type |
| Many flows | The Flows tab lists them; `flow` opens one first | The same, read from the value |
| Edits | The session; Apply through the record's patch mutation | Read only; with `onApply`, the session and the host's commit |
| A slice | No | `slice` narrows what the host builds (`Flowchart.over` over `Slice.rows`) |

## 4. The options

### 4.1 `<Flowchart>`'s props

| Prop | Takes | What it does |
|---|---|---|
| `record` | `Record.bind(rec, [patch])` | The flows the canvas shows and Apply commits to. `rec`'s type is `Flowchart.Types.Flows` or `Flowchart.Types.Flow`; the type picks the arm. A flowchart takes `record` or `data`, never both. |
| `data` | `Flowchart.Types.Flows` or `Flowchart.Types.Flow`: a value, an expression or a bind handle | The host's flows: read only, unless `onApply` is given. |
| `onApply` | `(patch) => Editing.Types.ApplyResult`, async | Over `data`, the host's commit: one patch of the value, as a record's would be. |
| `flow` | String | Over many flows, the one opened first. A flow opened later, from the Flows tab, takes its place. Refused over one flow. |
| `library` | `Flowchart.library.*` calls | The library's tabs, in order (§4.2); left out, or `[]`, no library pane. |
| `inspector` | `true` | The inspector pane (§9.9); left out, no inspector pane. |
| `orientation`, `minimap`, `legend`, `density`, `freshness` | as today's | Unchanged. LR · TD is the viewer's, kept under `name`. |
| `stateHover`, `linkHover`, `triggerHover` | as today's | Unchanged: dev-defined hover cards by key. |
| `onSelectState`, `onSelectLink`, `onSelectTrigger`, `onTracePath` | as today's | Unchanged: told after the canvas selects. |
| `canConnect` | as today's | Unchanged: vetoes a pair before the draft snaps. |
| `slice`, `affordances` | as today's | Over `data` only (§3.4); its rail is toolbar items. |
| `readOnly` | Boolean | No gesture edits, no drop lands, the inspector shows and edits nothing, the history item is gone. Selection and hover stay. |
| `name` | string | Names the flowchart when a surface holds two (decision 13). |

`linkMode`, `onCreateLink`, `onDeleteLink`, `onAddLane`, `onRenameLane`,
`onDeleteLane`, `onAddState`, `onEditState`, `onMoveState`, `height` and
`maxHeight` go (§11).

### 4.2 `Flowchart.library`: the library's tabs

```ts
library={[
    Flowchart.library.flows(),                              // every flow in the record; a click opens it
    Flowchart.library.states(rows, {                        // state templates, from bound rows
        name?, icon?, key, label, meta?, group?,
        drop: (row, key) => Flowchart.patch(Flowchart.Types.State, { … }),
    }),
    Flowchart.library.transitions(rows, {                   // transition templates, from bound rows
        name?, icon?, key, label, meta?, group?,
        drop: (row, key) => Flowchart.patch(Flowchart.Types.Link, { … }),
    }),
    Flowchart.library.tab(rows, {                           // the author's own cards
        name, icon?, key, label, meta?, group?,
        drop?: (row, key) => Flowchart.patch(Flowchart.Types.State | Link | Lane | Trigger, { … }),
    }),
]}
```

Each data tab reads its rows as `Sheet.library.tab` does: an `Array<T>` or a
`Dict<String, T>`, with accessors `(row, key) => …`, a key that repeats keeping
its first card. `states`' and `transitions`' names default to `States` and
`Transitions`. A `states` drop is the new state's fields over its defaults; a
`transitions` drop sets fields on the transition it lands on; a `tab` drop's
type picks what it lands on: a state, a transition, a lane or a decision.

### 4.3 `Flowchart.value`, `Flowchart.values` and `Flowchart.over`

- `Flowchart.value(flow)` — one flow's literal value, `Flowchart.Types.Flow`: it
  fills the literal's Options and checks it (§4.4) when the package builds.
- `Flowchart.values({ [name]: flow })` — a record of flows' literal value,
  `Flowchart.Types.Flows`, each flow as `Flowchart.value` builds it: a record's
  value, as `Query.value` is one.
- `Flowchart.over(states, { state?, links, link?, lanes, lane?, triggers?, trigger? })`
  — one `Flow` built from an app's own tables with today's mappers, unchanged
  (`FlowchartConfig`'s table fields). It is an East expression of
  `Flowchart.Types.Flow`.
- `Flowchart.patch(T, { … })` — a patch over a flow's row type (`State`,
  `Link`, `Lane`, `Trigger`), as `Sheet.patch` is over a row.

### 4.4 Build-time refusals

Each names the prop and the remedy:
- both `record` and `data`, or neither; `onApply` over a record; `flow` over
  one flow; `slice` or `affordances` over a record;
- a record whose type is neither `Flowchart.Types.Flows` nor
  `Flowchart.Types.Flow`, or one not bound with its patch mutation;
- `"brush"` among the affordances (today's);
- a library that lists a tab twice (an author's by its name), `flows()` over
  one flow, a data tab whose rows are neither an Array nor a `Dict<String, T>`,
  a `states` drop over another type than `Flowchart.Types.State`, a
  `transitions` drop over another type than `Flowchart.Types.Link` or one that
  sets `key`, `from` or `to`, and a `tab` drop over none of the four row types;
- in `Flowchart.value` and `Flowchart.values`: two states, links, lanes or
  decisions of one key in a flow, a state naming no lane the flow has, a link
  naming a decision the flow doesn't have.

A link naming a state the flow doesn't have is not refused: it draws as today's
unresolved ghost, and the Issues tab lists it.

## 5. The East types

### 5.1 What an app author meets

```ts
Flowchart.Types.Flow  = StructType({
    description: OptionType(StringType),            // one sentence: the Flows card's line
    lanes:    ArrayType(Flowchart.Types.Lane),
    states:   ArrayType(Flowchart.Types.State),
    links:    ArrayType(Flowchart.Types.Link),
    triggers: ArrayType(Flowchart.Types.Trigger),
});
Flowchart.Types.Flows = DictType(StringType, Flowchart.Types.Flow);   // by name
```

`State`, `Link`, `Lane`, `Trigger`, `Evidence`, `Kind` and `Orientation` keep
their names and their types. The event types (`LinkCreateEvent`,
`LaneRenameEvent`, `StateAddEvent`, `StateEditEvent`, `StateMoveEvent`) and
`LinkMode` go with the callbacks that took them.

### 5.2 What the renderer receives: the payload

The payload holds the flows' source and a whole `FlowchartRootType` of today's
canvas options, rather than a copy of their parts: a component made of parts
reuses the parts' interface types.

```ts
FlowchartPayloadType = StructType({
    canvas:    FlowchartCanvasType,                    // today's root, less the tables and the callbacks that go: the drawing options, hover, selection, canConnect, slice
    source:    VariantType({                           // where the flows come from; the arm the type picked
        flows: StructType({ read, history, commit }),  //   a record of many flows, bound with its patch: Record.bind's handle
        flow:  StructType({ read, history, commit }),  //   a record of one flow
        data:  StructType({ value: VariantType({ flows: …, flow: … }), onApply: OptionType(…) }),
    }),
    open:      OptionType(StringType),                 // the flow opened first, over many
    library:   ArrayType(FlowchartLibraryTabType),     // the tabs, in order; none, no pane
    inspector: BooleanType,                            // the end pane
    readOnly:  BooleanType,
    name:      OptionType(StringType),
});

FlowchartLibraryTabType = VariantType({
    flows:       NullType,
    states:      FlowchartCardsType,                   // each card's fields: the State patch it sets, as cells of the state's fields
    transitions: FlowchartCardsType,                   // the Link patch it sets
    tab:         StructType({ name: StringType, lands: OptionType(VariantType({ state, transition, lane, decision })), cards: … }),
});

FlowchartComponent = EastUI.component("Flowchart", FlowchartPayloadType, { optional: true });
```

The flow types' child writes the exact field types, by these rules: a card crosses the
closed payload as the fields its drop sets (as the Sheet's author cards do), and
the record handle crosses as the query builder's `QueriesHandleType` does.

### 5.3 The inspector's forms

| Selected | Its form (`Fields`), and what else Details shows |
|---|---|
| A state | `key` (text: a new key rekeys its transitions and the decisions' queues, one transaction), `label`, `lane` (a select over the flow's lanes), `members` (a number, Set and Clear), `notes`. Its transitions in and out, each a link that selects it. Duplicate, Delete. |
| A transition | `from` and `to` (selects over the flow's states), `kind` (Planned · Observed), `trigger` (a select over the flow's decisions, and none), `key`. Its evidence read only: volume and unit, count, when measured. Delete. |
| A decision (a diamond) | `key`, `label`, `letter`, `owner`, `queue` (tags over the flow's states), `outcomes`. The transitions it governs, each a link. Delete (cleared from those transitions). |
| A lane (its header) | `key` (a new key moves its states with it), `label`. Its states' count. Delete, while it holds no state. |
| Several | Their count; move the states to a lane; delete them. |
| Nothing | Over many flows, the open flow: its name (a new name renames the flow, one transaction), `description`, Duplicate, Delete. Its counts (lanes, states, transitions planned · observed · unresolved, decisions), the last save and who made it, and three hints. |

Each field is `FieldForm`'s (#1147, #1220): the shared `Field` around the shared
input its East type takes.

## 6. What moves

| Today | After | Notes |
|---|---|---|
| east-ui `Flowchart`: the IR in `src/collections/flowchart/` and the tag in `src/runtime/collections/flowchart.ts` | e3-ui `Flowchart` in `src/flowchart/` | `Flowchart.Types` keeps its row types; the root becomes the payload's `canvas` (§5.2). |
| `<Flowchart>`, the `Flowchart` arm of `UIComponentType` | e3-ui's `<Flowchart>`, in its frame, on the `Flowchart` carrier | An app changes its import, passes its flow as `data` (`Flowchart.over(…)` over its tables) or binds a record, and gives the flowchart a box of its own height. |
| east-ui-components `collections/flowchart/` (`index.tsx`, `layout.ts`, `model.ts`, `connect.ts` and their tests) | e3-ui-components `src/flowchart/` | Moved with `git mv`, then split into parts: the toolbar's items, the canvas, the footer. `layout.ts`, `model.ts` and `connect.ts` move unchanged. The slot recipe stays in east-ui-components' theme. |
| east-ui's Flowchart spec and examples, the skill text | e3-ui's | The showcase's Flowchart page moves to the e3 section, as the Plan's and the Sheet's did. |

## 7. Layout in BuilderFrame

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ⌕ find state   LR | TD   scans-2026.09 ●            Filter Search   2 issues ↶ ↷ ✕ Apply │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ banners: an Apply's conflict or refusal · the record changed under your drafts            │
├──────────────┬──────────────────────────────────────────────────────────┬────────────────┤
│ LIBRARY      │  INTAKE        SORT            LOAD            + LANE    │ INSPECTOR      │
│ Flows        │  ┌─────┐       ┌──────┐◇R     ┌─────┐                   │ Details·Issues │
│ Steps        │  │ ARV │──────▶│ CH*  │──────▶│ LDD │                   │ a state: its   │
│ Transitions  │  └─────┘       │ ×12  │       └─────┘                   │ fields (Fields)│
│ search       │  ┌─────┐       └──────┘                                  │ a transition   │
│ cards (drag) │  │ SCN │ ↻ 2   legend ▢                       minimap ▢ │ a decision ·…  │
├──────────────┴──────────────────────────────────────────────────────────┴────────────────┤
│ footer: Inbound parcels · 4 states · 3 transitions · 2 planned · 1 observed · saved 14:02 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Holds |
|---|---|
| Toolbar | Every control the flowchart has, as items of the shared `Toolbar` (§7.1). Today's eyebrow becomes these items. |
| Banners | An Apply's conflict and refusal; the record changing under pending drafts; a write whose outcome is unknown; a `flow` the record doesn't hold. |
| Start pane "Library" | The tabs `library` lists (§9.7); none, no pane. |
| Main | The open flow's canvas, as today: lanes, states, transitions, diamonds, badges, the legend and the minimap over it, hover cards. Over many flows with none open — an empty record — the shared empty state and "+ New flow". |
| End pane "Inspector" | Details · Issues (§9.9) when given `inspector`; none, no pane. |
| Footer | Today's counts, prefixed by the open flow's name over many, with the pending changes and, over a record, the last save (`saved 14:02`). |

The panes are `BuilderFrame`'s: pinned beside main while main keeps 480px,
overlaid with a rail and a scrim at 560px and narrower, and slid off main
during a drag. On a phone the canvas scrolls both ways under them. The
flowchart fills its parent and draws no border. Every style is a slot recipe's.

### 7.1 The toolbar's items

| Item | Side | Under width pressure |
|---|---|---|
| Find state: a search over the open flow's states by key and label; a pick selects the state and scrolls it into view | start | Folds to its icon, which opens the box in the edit popover (the shared key-search item's form) |
| LR · TD | start | Folds to one chip naming the orientation, a menu of both |
| The freshness chip | start | Goes |
| The slice's rail, over `data` with `slice` | end | Folds first, through `useSliceToolbarItems` |
| The history item: status · issues · Undo · Redo · Discard · Apply | end | Folds last, to its buttons; gone over read-only data |

On a touch screen every control in the row keeps its size and is a 44px tap
target by its box or by its halo (`coarseHitArea`), never by growing the row.

## 8. Anatomy

- **The canvas** is `Flowchart Spec.html`'s, unchanged: cards 116×40 r6, 7px
  rings, 12px arrowheads, the dim ladder, the 400ms hover card.
- **The frame, the panes, the library's cards and the inspector** are the
  Sheet's (`Sheet Builder Spec.md` §8): the library 272px and the inspector
  320px open, 44px as rails; each tab a `Library`, its search band 44px; cards
  the Library's compact card; the shared empty state.
- **A Flows card**: the flow's name 13px 600, and under it its description, or
  its counts in mono 10px (`4 lanes · 9 states · 11 transitions`); the open
  flow is placed; a flow with pending drafts carries a Pending chip.
- **A state card**: a grip, the template's label, its meta in mono 10px, the
  tab's icon in its tile, grouped by `group`.
- **A transition card**: a grip, a 28px swatch of the stroke its drop gives
  (solid ink, or dashed info for observed; a diamond with the decision's letter
  when it sets one), its label, its meta.
- **The inspector**: as the Sheet's, its head naming what is selected in mono
  caps (`STATE · SRT`, `TRANSITION · SRT → LDD`, `DECISION · R`, `LANE ·
  SORT`).

## 9. Behaviour

Every rule is numbered. Each sub-issue lists the rules it owns, and each rule
has a test there. Today's canvas behaviour keeps holding.

### 9.1 The corpus (owner: the corpus moves to the parcel depot)

- **FB1.** Every Flowchart example, spec, DOM test, showcase spec and doc, and
  `Flowchart Spec.html` with its PNG, speaks of the parcel depot (decision 9):
  one count-asserted substitution maps every code, lane, state, decision, unit
  and word the same way in every file, a scan afterwards finds none of the batch
  plant's words, and the PNG is captured again from the re-themed mock.

### 9.2 The move to e3-ui (owner: the Flowchart moves to e3)

- **FB2.** The moved flowchart takes every prop the east-ui `<Flowchart>` took
  and draws the same canvas, on the `Flowchart` carrier; east-ui's arm leaves
  `UIComponentType`, and east-ui and east-ui-components export nothing of the
  Flowchart but its recipe.
- **FB3.** Every Flowchart spec, example, DOM test and responsive spec passes
  after the move, the examples on the showcase's e3 page.

### 9.3 Types and factories (owner: the flow types and the payload)

- **FB4.** `Flowchart.Types.Flow` and `Flowchart.Types.Flows` are §5.1's;
  `Flowchart.value` and `Flowchart.values` build them from literals and refuse
  §4.4's cases; `Flowchart.over` builds one `Flow` from an app's tables with
  today's mappers; `Flowchart.patch` builds a patch over a row type.
- **FB5.** `<Flowchart>` takes `record` or `data` and §4.1's props; the source's
  type picks the arm, by `isTypeEqual`, and the tag's overloads type the props
  of each; every case of §4.4 is refused at build, naming the prop and the
  remedy.
- **FB6.** The payload is `FlowchartPayloadType` (§5.2) on the `Flowchart`
  carrier.

### 9.4 Frame and toolbar (owner: the frame and the toolbar)

- **FB7.** The flowchart is a `BuilderFrame` wherever it is used: toolbar,
  banners, the library as its start pane when `library` lists tabs, main, the
  inspector as its end pane when given `inspector`, the footer. It fills its
  parent and draws no border.
- **FB8.** The toolbar is one row of the shared `Toolbar`, its items in §7.1's
  order; the canvas draws no eyebrow of its own.
- **FB9.** Under width pressure the rail folds first, then the freshness chip,
  LR · TD to its chip, find state to its icon, and the history item last. No
  item wraps, scrolls or moves to a second row; on a phone and on a touch screen
  the row holds every item, each a 44px target by its box or its halo.
- **FB10.** The footer is today's counts, prefixed by the open flow's name over
  many flows, with the pending changes and, over a record, the last save.
- **FB11.** The panes are `BuilderFrame`'s, their open tab and collapsed state
  kept under `name`; the canvas scrolls both ways inside main.

### 9.5 Flows from a record (owner: the flows and the Flows tab)

- **FB12.** Over many flows the canvas shows the open flow: `flow`, else the
  first by name, else none; the open flow is held in the UI store under the
  flowchart's `name`, so a remount keeps it.
- **FB13.** `Flowchart.library.flows()` lists every flow in the record by name,
  each card its name and its description or counts, the open one placed, one
  with drafts marked Pending; a click opens it; the tab's search reads names and
  descriptions.
- **FB14.** "+ New flow" opens a `NamePopover` anchored to it; a name the record
  holds is refused there with the reason; a new name opens an empty flow, one
  lane, as a draft insert that Apply commits and Discard drops.
- **FB15.** Each flow keeps its own session: opening another keeps the drafts of
  the one left, and the history item, Apply and Discard act on the open flow.
- **FB16.** Over one flow there is no Flows tab, and the canvas shows the flow.

### 9.6 Editing, undo and Apply (owner: the editing)

- **FB17.** Every gesture is one transaction of the shared `Editing` session
  over the open flow: a state added (the "+ STATE" ghost, a template drop),
  edited (the inline editor, the inspector), moved across lanes, deleted (Del,
  the inspector) with its transitions; a transition connected, retyped (a
  template drop, the inspector) or deleted; a lane added, renamed, deleted; a
  decision edited or deleted; a bulk edit; a flow renamed or its description
  edited.
- **FB18.** A state's new key rekeys its transitions' ends and the decisions'
  queues in the same transaction; a lane's new key moves its states with it.
- **FB19.** A lane holding states can't be deleted: its × and the inspector's
  Delete are off, saying why (`Move its 3 states first`).
- **FB20.** Connecting makes a transition of the default type — planned, no
  decision, no evidence — keyed `<from>→<to>`, made unique; the `canConnect`
  veto, the in-place drop and the duplicate pulse hold as today.
- **FB21.** The history item shows the session's status, the issue count, Undo,
  Redo, Discard and Apply. ⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in the
  frame, never while typing in an input: a field being typed into keeps its own
  undo.
- **FB22.** Apply is on when the open flow has a change and no blocking issue
  (two of one key). It sends one commit: over many flows,
  `Record.onApply(record, { keyed: true })` with the open flow's insert, update
  or delete by name; over one flow, one patch of the record's value through its
  patch mutation, checked against the value the edits began from; over `data`,
  the host's `onApply`.
- **FB23.** A conflict or a refusal keeps every draft and shows its banner; a
  write with no answer turns Apply into Retry, which resends the same request.
  After a commit the drafts retire once the flow reads back as the commit left
  it; the record changing under pending drafts makes the session out of date,
  with Discard in its banner.
- **FB24.** Each callback today's flowchart took for an edit is gone; the
  gestures are the session's (§11).

### 9.7 The library pane (owner: the library)

- **FB25.** The library holds the tabs `library` lists, in its order, each with
  its count and a search. Collapsed, it is a rail with the first tab's count.
- **FB26.** `Flowchart.library.states(rows, …)` and `transitions(rows, …)` list
  one card per row, read as `Sheet.library.tab` reads its rows; each card is a
  drag source; a click selects it, a click on the selected card lets it go.
- **FB27.** `Flowchart.library.tab(rows, …)` lists the author's cards, a drag
  source when it declares a `drop`.
- **FB28.** An empty tab says so in the shared empty state: `No flows`,
  `No templates`, `Nothing in <name>`, or `No matches`.
- **FB29.** `library` is optional: left out or `[]`, no start pane; a tab listed
  twice is refused at build, naming it.

### 9.8 Drag and drop (owner: drag and drop)

- **FB30.** A drag starts after 4px; its ghost is the card, captioned with where
  it lands, or in red why it can't, on the shared drag layer (`LibraryRef`,
  `CellRef`) as the Sheet's and Studio's are.
- **FB31.** A state card dropped on a lane inserts a state in that lane, at the
  row the pointer is over (after the states above it), seeded with its drop's
  fields over a state's defaults; its key is the drop's when the flow doesn't
  hold it, else that key made unique (`HLD-2`), else a minted one. The new state
  is selected. One `drop` transaction. Refused outside a lane, and over a
  read-only flowchart.
- **FB32.** A transition card dropped on a transition sets its drop's fields on
  it, one `drop` transaction; the transition under the pointer takes the brand
  wash. Refused anywhere but a transition (`Drop onto a transition`).
- **FB33.** An author's card lands where its drop's type says — a state, a
  transition, a lane's header, a decision's diamond — and sets its fields;
  refused elsewhere, naming where it lands.
- **FB34.** ⏎ on a card does what a drop on the selection would: a state card
  adds a state after the selected state in its lane (in the first lane with
  nothing selected); a transition card retypes the selected transition; an
  author's card sets its fields on what is selected, when its type fits. Where
  it would be refused, the footer says why. On a touch screen a tap on a
  selected card does the same, so no edit needs a precise drag.

### 9.9 The inspector (owner: the inspector)

- **FB35.** The inspector has two tabs, Details and Issues, Issues with its
  count. Collapsed, it is a rail with its icon and the issue count.
- **FB36.** Details shows §5.3's view of what is selected, every field through
  `Fields`; an edit is one transaction, a field the drafts changed is tinted
  against the record.
- **FB37.** Issues lists every issue of the open flow: a transition naming a
  missing state, a state naming a missing lane, two of one key, a decision's
  queue naming a missing state, an Apply's conflict or refusal. A click selects
  what it names. Two of one key blocks Apply; the rest are warnings.
- **FB38.** Over read-only data or with `readOnly`, Details shows every field
  and edits none.

### 9.10 Showcase and docs (owner: the showcase and docs)

- **FB39.** The depot's flows (§3.3) run on e3-web in the showcase with the
  record and the templates seeded, and Apply commits to the record.
- **FB40.** The examples are few and full (`EXAMPLES_AUTHORING.md` §8): between
  them every pane combination (none, a library, an inspector, both), one flow
  and many, `data` with a slice, and every canvas feature.
- **FB41.** Responsive specs measure the frame, the toolbar's fold order at
  desktop and phone widths, both themes, the panes, a state and a transition
  dropped, a move, and Apply; the e3-ui skill documents `<Flowchart>` with
  tested examples, and the plugin indexes are regenerated.

## 10. Drag and drop, as a table

| Drag | Onto | Does | Refused when |
|---|---|---|---|
| A state card | a lane, at the row under the pointer | Inserts a state there, seeded by the card's drop (FB31) | outside a lane; read only |
| A transition card | a transition | Sets the drop's fields on it (FB32) | anywhere else; read only |
| An author's card | a state, a transition, a lane's header or a diamond, by its drop's type | Sets its fields (FB33) | anywhere else |
| A state, by its card | another lane | Moves it there (today's gesture, now a transaction) | read only |
| A handle | a state | Connects (today's gesture, now a transaction, FB20) | `canConnect` vetoes; read only |

## 11. What changes from today's Flowchart, and what is lost

| Today | `<Flowchart>` | Why, and what is lost |
|---|---|---|
| A flowchart with its own eyebrow and footer | In its frame: the eyebrow's controls are the toolbar's items, the footer the frame's | A component has one toolbar. Nothing is lost. |
| `height`, `maxHeight` | The flowchart fills the box it is given | A host gives it a box of its own height. |
| Four tables and mappers as the component's props | A record of flows, or `data` built by `Flowchart.over` with the same mappers | The mappers are kept; an app's tables reach the canvas through one `Flow`. |
| A callback per edit (`onAddState`, `onCreateLink`, …) and `linkMode` | The session, Apply through the record, or the host's `onApply` | A host no longer hears each gesture; it commits once. A `connect`-only canvas that reports but never adds is `data` with `onApply`. |
| Deleting a lane with states, which then fell into the last lane | Refused until its states are moved | No state moves without the planner moving it. |
| Click-to-drill into a host's `Drawer` | The inspector; `onSelect*` still tells the host | Nothing is lost. |
| One flowchart | Many flows in a record, one open | New. |
| No library, no inspector | Flows, state and transition templates from bound data, the author's tabs; Details · Issues | New. |

## 12. Wires

- **UI.** east-ui's `Flowchart` arm leaves `UIComponentType`; packages are
  re-exported (`WIRE_MIGRATION.md`). `<Flowchart>` rides one `EastUI.component`
  carrier, `Flowchart`.
- **Stored state.** New: `Flowchart.Types.Flow` and `Flowchart.Types.Flows` are
  a record's type, so they are a stored form from their first release.

## 13. The sub-issues, in landing order

1. The spec (this file, #1241).
2. The corpus moves to the parcel depot (FB1, #1242).
3. The Flowchart moves to e3 (FB2, FB3, #1243).
4. The flow types and the payload (FB4–FB6, #1244).
5. The frame and the toolbar (FB7–FB11, #1245).
6. The flows and the Flows tab (FB12–FB16, #1246).
7. Editing, undo and Apply (FB17–FB24, #1247).
8. The library: state and transition templates, the author's tabs (FB25–FB29, #1248).
9. Drag and drop (FB30–FB34, #1249).
10. The inspector (FB35–FB38, #1250).
11. The showcase on e3-web, the examples, the skill (FB39–FB41, #1251).

The frame, the Flows tab, the editing, the library and the inspector are pushed
together, so the builder first appears with its panes full of the examples'
seeded records.
