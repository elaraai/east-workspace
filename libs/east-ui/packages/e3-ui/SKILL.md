---
name: e3-ui
description: "e3 + UI bridge — build interactive, reactive decision surfaces as e3 tasks, authored as JSX. Use when: (1) Declaring UI tasks with ui() (e3 tasks of kind 'ui' producing a UIComponentType), (2) Binding reactive workspace data with Data.bind (read/write/has/commit/discard/status against e3.input / task defs) inside a <Reactive>{$ => …}</Reactive> block, (3) Staged vs direct edit modes and reviewing pending changes with the <Diff> tag, (4) Graph/ontology editing with the <Ontology> tag, (5) Calling named package functions (e3.function) RPC-style with Func.bind (call/read/status/error/pending/cancel), (6) Wiring a manifest (reads/writes + bound functions auto-derived from a UI task's IR), (7) Interactive causal-experiment surfaces ('did X change Y?') with the <Experiment> tag, generic over a bound dataset's row and driven by e3.function estimators, (8) The Decide loop — Decision.bind unions reasoning-task decision outputs into one handle (shared selection + commit gate), <DecisionQueue> (urgency-sorted queue with evidence/options/judgement/modify facets, Apply/Reject, grouping, an author-bound Slice scope) and <DecisionJournal> (the resolved read-back), (9) The Studio — Studio.component declares a self-contained East UI function (written exactly like a ui() body) with what the palette shows; the pages operators build are one record of Studio.Types.Pages with one patch write; <Studio.Builder> is the builder — the open page's canvas under one toolbar (its status, the history, Desktop · Tablet, Save as template, Preview and Publish), the palette of the listed components and the project's pages before it, the inspector of the selected placement after it, and the publish preview in its place — every gesture a draft, Apply one patch on the page, and a publish stamping each placement with the code it goes live with; <Studio.Library> is a project's templates and pages and where new pages start, opening pages in the builder; <Studio.Page> draws one page's live or draft layout with no chrome, (10) Rendering deployed surfaces in a React app with @elaraai/e3-ui-components — <E3Provider> (E3Config: apiUrl, repo, workspace, token, fetch), <ReactiveDatasetProvider> and <UITaskPreview> — over a server, or over an e3 running in the page (e3-web's createWebE3 and its e3.fetch), (11) Queries — operators build typed jq queries over the datasets a surface binds and save them to one record of Query.Types.Saved with one patch write; <Query.Builder> edits the open query as plain-word steps or as jq, checks it as it is edited, runs it on e3 as a one-shot call — or as a split call over the pieces of a dataset larger than one piece, its plan explained — and shows the result as a Table or a tree; <Query.Library> is the saved queries as a gallery of wireframes and where new queries start, opening them in the builder, (12) The Plan — <Plan>, the one planning canvas, always in its builder frame — one toolbar holding every control it has, the banners, the canvas, the footer's counts: heterogeneous rows on ONE shared { time | number | ordinal } axis from three sources — event kinds over records (Schedule.events placed on Schedule.resources, the kinds a Calendar takes), rows laid out by a series list over local data or a Data.bindPaged source and nested from the data's own structure, and read-only rows (Plan.over a dataset, hand-built rows) — with a series library, key search, links between runs or events, and an editing session — review verdicts, dropped cards and moved or resized runs, chips, tiles and marks as drafts with Undo / Redo and one checked Apply — its authoring vocabulary on `Plan` (Plan.axis, Plan.series.*, Plan.over, Plan.eventRef, the value builders), (13) The Sheet — <Sheet>, the one planning spreadsheet, always in its builder frame — one toolbar holding every control it has, the banners, the grid with its docked strip, the footer — its panes optional props: a library (templates, columns, the author's cards) and an inspector of the selected row's every field or the author's own; its rows from an e3 record bound with its patch door (the record's entries, one entry's rows or groups with loose rows between them, or a large record a window at a time — Apply one patch commit through the record) or the host's (an array, a bind handle, a Data.bindPaged source with a key search); typed columns (dates, quantities with units, register lookups, a directed link between register members, stamped codes), a blank tail that invites the next row, an East-function copilot that fills cells and proposes rows, a slice lens with saved-view tabs, groups with loose rows between them and read-only sub rows, drag and drop, Excel round-trip, and an editing session — drafts checked as they are made, Undo / Redo and one checked Apply — its authoring vocabulary on `Sheet` (Sheet.column.*, Sheet.register.*, Sheet.driver, Sheet.group, Sheet.subRows, Sheet.library.*, Sheet.field, Sheet.apply)."
---

# e3-ui — e3 + UI Bridge

`@elaraai/e3-ui` connects **east-ui** JSX tags to **e3** workspaces. You author a
decision surface as a first-class e3 **UI task** whose reads and writes against
workspace datasets are tracked in a manifest — so the engine knows what data the
UI depends on and can re-render reactively. With staged writes, `<Diff>` review,
and commit / discard, a view becomes a place a user commits a decision with its
evidence — not a read-only report.

The public surface is **JSX tags + platform helpers**, all from one import
(`@elaraai/e3-ui`): the e3-specific tags `<Diff>`, `<Ontology>`, `<Experiment>`, `<Plan>` and `<Sheet>`, the `Data` and `Func`
binding helpers, `Studio` and `Query` components, and the `ui()` task factory. Base UI tags (`<VStack>`, `<Text>`,
`<Stat>`, …) come from `@elaraai/east-ui`. The factories (`Diff.Root(…)`) are an
implementation detail under `@elaraai/e3-ui/internal` (also the e3-free,
browser-safe entry for render-only bundles).

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `mcp__plugin_east_east__search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `mcp__plugin_east_east__get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

## Quick Start

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { East, FloatType, variant } from '@elaraai/east';
import { Reactive, Slider, UIComponentType } from '@elaraai/east-ui';
import { ui, Data } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

const threshold = e3.input('threshold', FloatType, variant('value', 50.0));

// A UI task: reactive binding to a workspace dataset, no compute-time inputs.
const dashboard = ui('dashboard', [], East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const t = $.let(Data.bind(threshold));
        return <Slider value={t.read()} min={0} max={100} onChange={t.write} />;
    }}</Reactive>
)));
// Manifest auto-derived: reads [threshold], writes [threshold]
```

Deploy and run it like any e3 task; the workspace re-renders the component when
bound datasets change. The pragma `/** @jsxImportSource @elaraai/e3-ui */` makes
the file JSX-capable (byte-identical runtime to `@elaraai/east-ui`).

> `Data.bind` reads live **inside** the `<Reactive>{$ => …}</Reactive>` builder
> block — there is no inner `East.function`.

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Author a decision surface as an e3 task
    │   ├─ Reacts to workspace data only → ui(name, [], fn) + Data.bind
    │   └─ Also takes computed inputs     → ui(name, [input], fn) (fn receives values)
    │
    ├─ Read / write workspace datasets from the UI — Data.bind(dataset, options?)
    │   ├─ Read a value            → .read()
    │   ├─ Check if set            → .has()
    │   ├─ Write a value           → .write(v)
    │   ├─ Write + kick dataflow   → .writeAndStart(v)
    │   ├─ Current status (variant) → .status()  (e.g. .status().hasTag('stale'))
    │   ├─ The binding handle       → .binding   (pass to <Diff bindings={[…]} />)
    │   └─ Staged mode             → { mode: 'staged' } + .commit() / .discard()
    │
    ├─ Read a collection too large to hold whole — Data.bindPaged(dataset, options?)
    │   ├─ One window              → .page(offset, limit)  (none = in flight; some([]) = exhausted; a failure throws)
    │   ├─ Total elements          → .total()
    │   ├─ Key search              → .seek(query)          (none for an Array source)
    │   ├─ The snapshot it serves  → .revision()           (the content hash; re-fires when it moves)
    │   ├─ Show a confirmed write  → .refresh(none)        (or .refresh(some(hash)))
    │   └─ Through a record's index → { index: byStatus, join?: true }
    │       rows arrive in the INDEX's order as `{ik, key, value, row}`
    │
    ├─ Call a named package function (e3.function) from the UI — Func.bind(fn)
    │   ├─ Launch (fire-and-forget, sync-callback safe) → .call(args…)
    │   ├─ Last successful result   → .read()   (Option(O))
    │   ├─ Lifecycle (variant)      → .status() (idle|running|succeeded|failed|cancelled)
    │   ├─ Failure detail           → .error()  (Option — message/kind/stdout/stderr)
    │   ├─ Spinner boolean          → .pending()
    │   └─ Stop waiting             → .cancel() (client-side; server still finishes)
    │
    ├─ Review pending (staged) changes
    │   └─ <Diff bindings={[a.binding, b.binding, …]} />
    │
    ├─ Edit a graph / ontology dataset
    │   └─ <Ontology binding={view.binding} />   (OntologyType: NodeType / LinkType)
    │
    ├─ Offer components for operators to arrange on pages (Studio)
    │   ├─ Declare one — self-contained, like a ui() body   → Studio.component(key, meta, fn)
    │   ├─ Store the pages operators build                  → e3.record("pages", Studio.Types.Pages, new Map()) + e3.mutation.patch(pages)
    │   ├─ The builder: canvas, palette, inspector, preview → <Studio.Builder pages components project env? audience? rollout? id? />
    │   ├─ Templates, pages, and where new pages start      → <Studio.Library pages components project onOpen? id? />
    │   └─ Show one page, live or draft, with no chrome     → <Studio.Page pages components page version? />
    │
    ├─ Let users query the bound datasets and save their queries (typed jq)
    │   ├─ Store the queries they save                    → e3.record("queries", Query.Types.Saved, new Map()) + e3.mutation.patch(queries)
    │   ├─ Ship queries in the record, checked at build   → Query.value({ orders, customers }, [{ name, jq, description?, savedAt }])
    │   ├─ The builder: steps or jq, checked, run, saved  → <Query.Builder queries datasets query? id? />
    │   └─ The saved queries, and where new ones start    → <Query.Library queries datasets onOpen? id? />
    │
    ├─ Run the Decide loop over reasoning-task decisions
    │   ├─ Union the bound decision views into one handle → Decision.bind([Contract]?, { decisions, judgements })
    │   ├─ The queue (triage → understand → judge → apply) → <DecisionQueue handle={handle} …/>
    │   ├─ The resolved read-back (Decide↔Trust seam)       → <DecisionJournal handle={handle} />
    │   └─ Scope the queue (author-owned, Table pattern)    → Slice.bind over Decision.Types.Decision, rows = handle.queue()
    │
    ├─ Draw what is scheduled on ONE shared axis — the Plan (see The Plan below)
    │   ├─ Rows derived from data by a series list            → <Plan axis={…} data={…} series={[…]} />
    │   ├─ Event kinds over records, on resource rows         → <Plan axis={…} resources={{ presses: Schedule.resources(…) }} events={{ job: Schedule.events(record, {…}) }} />
    │   ├─ Read-only rows: a dataset's, or hand-built         → rows={[Plan.over(data, [series…]), Plan.chart({…})]}
    │   ├─ Its axis: time, number or ordinal                  → Plan.axis / Plan.axis.number / Plan.axis.ordinal
    │   ├─ Rows, nested by what the data holds                → Plan.series.span / buckets / chart / heat / table / cards / events / group / section / views / rows
    │   ├─ Data too large to hold whole                       → data={paged}, a Data.bindPaged handle
    │   ├─ A link between two runs, or two events             → Plan.link({ from: Plan.ref(…), fromRun, … }) / Plan.link({ from: Plan.eventRef(kind, key), … })
    │   └─ Verdicts, dropped cards and moves as drafts        → a series' review / edit + editing={{ onUpdate | onApply }}
    │
    ├─ Let planners type rows in place — the Sheet, in its frame (see The Sheet below)
    │   ├─ An e3 record edited as a sheet                     → <Sheet record={…} columns={{…}} /> (record = Record.bind(r, [patch]))
    │   │   ├─ One entry's rows, groups or loose rows          → entry={{ key, rows: "field", id: "id" }} (+ group)
    │   │   └─ A large record, a window at a time             → window={Data.bindPaged(r)}
    │   ├─ The host's rows                                    → <Sheet data={…} id="id" columns={{…}} />
    │   ├─ Its panes, each optional                           → library={[Sheet.library.rows(), Sheet.library.columns(), Sheet.library.tab(…)]} · inspector (+ fields)
    │   ├─ Its columns, registers and the driver               → Sheet.column.* / Sheet.register.* / Sheet.driver
    │   ├─ Groups, loose rows between them, read-only sub rows → Sheet.group / Sheet.Types.Entry / Sheet.subRows
    │   ├─ Data too large to hold whole                        → data={paged}, a Data.bindPaged handle
    │   └─ Drafts checked as they are made, one checked Apply  → onUpdate | onApply, ready, newRow
    │
    ├─ Render deployed surfaces in a React app (@elaraai/e3-ui-components)
    │   ├─ Which e3, and how requests reach it → <E3Provider config={{ apiUrl, repo, workspace, token, fetch }}>
    │   ├─ The bindings' adapters              → <ReactiveDatasetProvider> inside it
    │   ├─ A deployed ui() task, by name       → <UITaskPreview task="…" />
    │   └─ e3 running in the page, no server   → apiUrl and fetch from e3-web's createWebE3
    │
    └─ Let a user ask "did X change Y?" against a dataset and trust the answer
        └─ <Experiment data configs … />   (generic over the row; runs e3.functions)
```

## Core Concepts

### `ui(name, inputs, fn, options?)`

Wraps `e3.task()` with `kind: "ui"` and a **manifest** auto-derived from the IR:
- **Compute-time reads** — every dataset in `inputs` (the runner passes their
  values to `fn` as positional args).
- **Reactive reads** — every `Data.bind(dataset).read()` / `.has()` in the IR.
- **Reactive writes** — every `Data.bind(dataset).write()` in the IR.
- **Bound functions** — every `Func.bind(fn)` in the IR.

`fn` returns `UIComponentType`, exactly: `ui()`'s signature takes no other
function, and refuses one cast past it when the task is defined, naming the
task and the type. A task is rendered by its `ui` role alone. Default runner
is `['east-c', 'run']`.

> `Data.bind` takes the def itself (`e3.input(...)` or a task), so the bound
> path and value type are captured at IR-build time by construction.

### `Data.bind(dataset, options?)`

A workspace-scoped reactive binding to a dataset — pass the `e3.input` def
(or an `e3.task`, which binds its output dataset). Handle methods:

| Method | Meaning |
|---|---|
| `.read()` | current value (type `T`); tracks the dependency so `<Reactive>` re-renders |
| `.has()` | whether the dataset is set |
| `.write(v)` | set the value |
| `.writeAndStart(v)` | set the value and start the dataflow |
| `.status()` | binding status variant (e.g. `.status().hasTag('stale')`) |
| `.commit()` | apply staged edits (staged mode) |
| `.discard()` | drop staged edits (staged mode) |
| `.binding` | the binding handle to pass to `<Diff bindings={[…]} />` |

**Modes** (`options.mode`):
- `'direct'` (default) — each `write()` immediately mutates the destination.
- `'staged'` — `write()` accumulates a patch; `commit()` applies it, `discard()`
  drops it.

### `Data.bindPaged(dataset, options?)`

A read-only, WINDOWED binding for a collection too large to hold whole — the
paged sibling of `Data.bind`. There is no `write` / `commit`: a window is not a
value you can diff or stage.

| Method | Meaning |
|---|---|
| `.page(offset, limit)` **❗** | one window; `none` while in flight, `some([])` at exhaustion; a failed fetch throws its reason |
| `.total()` | the source's element count, once any window has landed |
| `.seek(query)` **❗** | where a key query lands in the source's row order; `none` for an Array source, which has no key order to search |
| `.revision()` | `Option<String>` — the snapshot every window and search is read from: the dataset's content hash (a record's state hash through an index); `none` while it is found or while the dataset has no value |
| `.refresh(target)` | move the source: `some(hash)` to that snapshot, `none` to the dataset's current one; returns at once |

`Data.bindPaged` is how paged data reaches a component. Pass the handle as a
`<Plan>`, `<Table>` or `<Sheet>`'s `data`: the component recognises it by its
East type (east-ui's `Paged.Types.PinnedSource`) and pages it, and nothing else
produces a paged source — a collection already in hand is local data, passed
inline. The def is an `e3.input`, an `e3.record`, or an `e3.task`, whose output
it binds. A dataset too large to hold whole is made where data is made — a task
that generates or loads its rows — never written into the package as an
input's value:

```tsx
// Package side: the rows come from a task, from a small authored count.
// const units = e3.task('units', [unitCountInput], generateUnits);   // Dict<String, UnitRow>
<Reactive>{$ => {
    const paged = $.let(Data.bindPaged(units));
    return <Plan axis={axis} data={paged} series={series} />;
}}</Reactive>
```

Every window, total and search belongs to ONE snapshot, so rows from two
snapshots never sit side by side. The source follows its dataset: when a
dataflow run or another user's write changes it, the source moves to the new
snapshot, and the windows still on screen are fetched again from it — `page`
reads `none` for each until it lands, so a view holds its last frame while
`revision()` has changed. Call `refresh` from an event handler after a write the
view confirmed, to show it without waiting for the move. A failed fetch throws
rather than reading `none`, so wrap the read in `$.try` to render the failure;
a read a couple of seconds later fetches it again. A request that can never
succeed — a dataset that is not a collection, an index the record does not
declare — keeps throwing until the source moves.

**Through a record's index** (`options.index`) the window is the INDEX's order
rather than the record's, and each row carries what a view needs to render
without touching the record:

```tsx
const queue = $.let(Data.bindPaged(plans, { index: byStatus }));
// rows: Array<{ ik: StatusKey, key: PlanKey, value: Projection, row: Option<Plan> }>
<Table data={queue} columns={{
    ik:    { header: "Status", value: (ik) => ik.status },
    value: { header: "Plan" },
}} />
```

Pass the `e3.recordIndex` DECLARATION, not its name: the window's type — the
index key and the covering projection — comes from it, so the rows are checked
at compile time. `join: true` reads each entry's row from the record too;
leaving it off is the point of a covering projection, since the view then
touches the index's segments and none of the record's.

`.seek` takes a `from..to` range as well as a key or prefix, bounding a leading
prefix of the key's flattened fields — `late, 3..ok` over a `{status, due}`
index key — which is what a time window or a status band asks for. A range
names at least one end; open at both it names no run, and the seek refuses it.
In the search box quoting is the escape: a quoted value is exact, and a `..`
inside it is text, so `"../config"` finds that key rather than a range.

### `Func.bind(fn)`

A workspace-scoped call handle for a named package function
(`e3.function`) — e3's RPC method. `call(args…)` launches fire-and-forget
(safe in sync `onClick` handlers); the outcome arrives reactively:

| Method | Meaning |
|---|---|
| `.call(args…)` | launch with these args; latest-wins if one is already running |
| `.read()` | `Option(Output)` — last successful result |
| `.status()` | `idle` \| `running` \| `succeeded` \| `failed` \| `cancelled` |
| `.error()` | `Option` of failure detail (message, kind, stdout/stderr) |
| `.pending()` | true while a call is in flight |
| `.cancel()` | stop waiting (client-side; the server still finishes) |
| `.binding` | descriptor (`{ name }`) |

All handles bound to the same function share one tracked channel — one
component can launch while another renders the spinner. Functions are
**bounded** RPC (server deadline + result-size limit); long compute
belongs in dataflow tasks (`writeAndStart`). Pass the `e3.function` def —
name, parameter types and return type all come from it, so the binding
cannot drift from the deployed signature.

```tsx
// Package side, in scope at authoring time:
// const forecastFn = e3.function('forecast', East.function([IntegerType, FloatType], FloatType, …));
<Reactive>{$ => {
    const forecast = $.let(Func.bind(forecastFn));
    const run = $.const(East.function([], NullType, $ => { $(forecast.call(12n, 1.05)); }));
    return (
        <VStack gap="3">
            <Button onClick={run} loading={forecast.pending()}>Run forecast</Button>
            <Stat label="Forecast" value={East.print(forecast.read())} />
        </VStack>
    );
}}</Reactive>
```

### `<Diff bindings={[…]} />`

Renders a review of pending changes for any combination of bindings — the
staged-mode companion for "review before apply" UX. Pass the `.binding`
accessors.

### `<Ontology binding={view.binding} />`

A graph editor (`NodeType` / `LinkType` / `OntologyType`) bound to a dataset, for
editing typed node/link graphs. Stack a `<Diff>` beside it to surface the pending
node/link patch.

### `<Experiment data configs … />`

An interactive **causal-experiment** surface: an end user asks *"did X change
Y?"* against a bound dataset and reads a derived, plain-language answer across
up to four tabs (The answer / Can we trust it? / How much? / Prove it). Generic
over the dataset's row (like `<Table>`). The bound `configs` list holds the
**questions** — each a full `ExperimentConfig` plus an optional precomputed
`result`/`design`; selecting one seeds the working config. **Run** calls the
single bound `experiment` function; the verdict-first headline, every word,
colour and bar are derived from the returned numbers — nothing is authored.
**Commit** appends to the journal.

| Prop | Binding | Meaning |
|---|---|---|
| `data` | `Data.bind(dataset)` | the rows to experiment on (`Array<Struct<Row>>`) |
| `configs` | `Data.bind(dataset)` | **required** — the questions (`Array<Experiment.Types.Configuration>`); each may carry a precomputed `result` and/or `design` |
| `experiment` | `Func.bind(fn)` | optional universal estimator — `(rows, config) → ExperimentResult`; omit when every question is precomputed |
| `design` | `Func.bind(fn)` | optional — `(rows, config, result, designConfig) → ExperimentDesign` (the "Prove it" trial recipe) |
| `journal` | `Data.bind(dataset)` | optional committed-experiment log; **Commit** appends |
| `columns` | — | per-column display config keyed by the row's fields (like `<Table>`), e.g. `{ bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true } }` — labels drive every sentence the surface speaks |
| `subject` | — | the domain noun for a row: `'batch'` (auto-pluralised) or `{ one, many }`; replaces the neutral `record(s)` |
| `readonly` | — | render without Run / Commit / edit affordances |
| `defaultTab` | — | initial tab: `'answer'` (default) \| `'trust'` \| `'dose'` \| `'validate'` |

```tsx
<Reactive>{$ => {
    const data       = $.let(Data.bind(batchesInput));
    const configs    = $.let(Data.bind(experimentConfigsInput));   // the questions
    const journal    = $.let(Data.bind(experimentJournalInput));
    const experiment = $.let(Func.bind(experimentFn));  // (rows, config) → ExperimentResult
    return (
        <Experiment data={data} configs={configs} experiment={experiment} journal={journal}
            columns={{ bond_strength: { label: 'Bond strength', unit: 'MPa', higherIsBetter: true } }}
            subject="batch" />
    );
}}</Reactive>
```

The render-contract value types are reached via `Experiment.Types.*`
(`Experiment.Types.Config` / `.Configuration` / `.Result` / `.Design` /
`.Verdict` / …, like `Table.Types.*`); the result's honesty `verdict`
(`causal` / `modest` / `adjustment_insufficient` /
`non_identifiable_positivity` / `not_estimable`) drives the headline, and the
two refusal verdicts (`adjusted = none`) render explanatory zones instead of a
number.

### The Decide loop — `Decision.bind` + `<DecisionQueue>` + `<DecisionJournal>`

Reasoning tasks emit decisions as `Array<Decision.Types.Decision>` datasets
(built with `Decision.make` / `Decision.option` / `Decision.reference` /
`Decision.judgement`). `Decision.bind` unions the bound views into **one
per-surface handle** — it owns what no single binding can: the union +
write-routing by case id, the shared case **selection** (every component on
the handle stays in sync by construction), and the derived per-case **commit
gate**. The operator's staged contribution is a judgements dict bound the
same way.

```tsx
const roster     = $.let(Data.bind(rosterDecisions, { mode: 'direct' }));   // source ⊕ patch view
const orders     = $.let(Data.bind(orderDecisions,  { mode: 'direct' }));
const judgements = $.let(Data.bind(judgementsInput, { mode: 'staged' }));
const handle     = $.let(Decision.bind([RosterConstraint], { decisions: [roster, orders], judgements }));
```

The optional type token is the solution's **constraint contract** (a by-name
`VariantType` shared with the reasoning task, which `$.matchTag`s injected
constraints fully typed); omit it for the default primitive op-variant.
Handle methods: `queue()` (the unioned cases) · `selected()` / `select(id)` /
`clearSelection()` · `decision()` · `update(d)` (probe edit through the owning
patch) · `judgement(id)` / `answer(id, promptId, answer)` /
`addKnowledge(id, text)` / `inject(id, constraint)` · `resolve(id, verdict)`
(verdict + removal + selection clear) · `commitState(id)` (gated / blocked /
handoff / ready).

**`<DecisionQueue handle={handle} …/>`** — *the* Decide surface: one queue over
the handle's cases, urgency-sorted with the routine tail collapsed; selecting a
row expands one facet at a time beneath it; Apply / Reject resolve through the
handle.

| Prop | Meaning |
|---|---|
| `handle` | **required** — the `Decision.bind` handle |
| `heading` | header label (e.g. `"Decisions waiting"`) |
| `modify` | per-kind probe editor `(decision, update) => UIComponent` — the Modify facet; `update(edited)` writes back through the owning binding |
| `evidence` | per-decision canvas `(decision) => UIComponent` inside the Evidence facet |
| `defaultExpanded` | the case shown expanded before any selection (an `Option` — derive from bound data, e.g. a `firstMap`) |
| `defaultFacet` / `facets` | which facet opens first (`'evidence'` default) / include-list of data facets (`modify` stays callback-gated) |
| `onApply` / `onReject` | side-effect hooks fired with the decision on resolve |
| `slice` | author-bound slice handle over the queue (see below) — narrowing applies before the urgency sort whether or not a rail mounts |
| `affordances` | rail affordances when `slice` is set (default `["filter", "search"]`; `brush` rejected) |
| `groups` / `groupBy` / `collapsible` | Group-by toolbar: custom label → `(decision) => String` accessors atop built-in Urgency / Kind / None; which opens first; collapsible heads |
| `maxHeight` / `density` | pinned-header scroll cap / density preset |

**The queue's scope is an ordinary author-owned slice** (the `Table` pattern —
you own the key and config, so scopes are per-surface over one shared handle,
and shareable with any other component). Bind it over the decision envelope
with the handle's own union as the rows feed:

```tsx
const cfg = Slice.config(Decision.Types.Decision, {
    fields: { kind: { label: 'Kind' }, title: { label: 'Title' }, value: { label: 'Value' } },
    searchFieldIds: ['kind', 'title'],
});
const slice = $.let(Slice.bind([Decision.Types.Decision], 'ops.queue.slice', cfg,
    Slice.state({ filters: [variant('string', { fieldId: 'kind', op: variant('eq', 'roster') })] }),
    handle.queue(), none));
return <DecisionQueue handle={handle} heading="Decisions waiting" slice={slice} />;
```

Pass `affordances={[]}` to keep the seeded narrowing with **no** rail — an
invisible author scope.

**`<DecisionJournal handle={handle} />`** — the resolved-cases read-back (the
Decide↔Trust seam): every staged judgement whose verdict is set, newest first —
the exact complement of the queue. Options: `heading`, `maxHeight`.

### Studio components — `Studio.component(key, meta, fn)`

A Studio component is **self-contained**: an East UI function written exactly
like a `ui()` body, which binds its own data, sets up its own slices and returns
its UI. Operators arrange components on pages and never rebind or reconfigure
them, so different data is a different component, and a component's next
version is a deploy.

`Studio.component` returns a `Studio.Types.Component` struct, the way
`Slice.config` returns a slice config. Call it at module scope or inside an
East function.

```tsx
export const salesCount = Studio.component("sales_count", {
    name: "Sales", category: "Display", icon: "receipt", span: 4n,
    description: "Sales recorded so far",
}, East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const sales = $.let(Data.bind(salesDaily));
        return <Stat label="Sales" value={sales.read().size()} />;
    }}</Reactive>
)));
```

| `meta` | Meaning |
|---|---|
| `name`, `category`, `icon` | **required** — the palette card's name, the group it sits in, a Font Awesome solid icon |
| `span` | the span a new placement takes, in columns of 12 (default `12n`) |
| `description` | what it shows — the inspector's text, under its lock |
| `frame` | `"card"` (default) draws a tile frame; `"none"` renders bare |
| `tags` / `collections` | the palette's Filter facets |
| `deprecated` | hidden from the palette; placements keep rendering |

Two fields are derived from `fn`, never written:
- `reads` — the datasets, functions and records its code binds (`deriveManifest`
  over `fn`); the palette card's meta line and the inspector's data list.
- `fingerprint` — a SHA-256 of `fn`'s IR in canonical form. The same code
  fingerprints the same wherever it is written; any change to the code changes
  it.

A surface lists the components it offers with `$.let([...])`, in palette order,
and hands the list to the Studio's components, which draw each placement by
calling its component's function:
- The surface's `ui()` manifest is the union of its listed components' reads:
  every dataset they bind is reachable, and nothing else.
- State and Slice keys inside a component are the component's own, so two
  placements of it share them.
- A placement whose component the list does not hold is a placeholder naming its
  key; a key two listed components share is an error naming it.

### Studio pages — `Studio.Types.Pages`

The Studio exports the pages record's type; a solution declares its storage like
any record, with one write, a patch:

```ts
export const pages      = e3.record("pages", Studio.Types.Pages, new Map());
export const pagesPatch = e3.mutation.patch(pages);
```

The builder and the page library bind it with `Record.bind(pages, [pagesPatch])`;
a published page reads it with `Data.bind(pages)`. The type never depends on the
components, so a deploy that adds, changes or removes one runs no migration.

- `Studio.Types.Pages` is `Dict<Key, Entry>`. A `Key` is `{ project, page }`. An
  `Entry` is a `page` — `{ draft, live }`, `live` being `none` until the first
  publish, else `{ version, page }` — or a `template`, a layout new pages start from.
- A `Page` is `{ title, cells }`, and a `Cell` is `{ key, row, span, height,
  align, title, component, fingerprint }`: a component's key, where it sits on the
  SnapGrid (rows in the order their keys first appear), and its component's
  fingerprint when it was placed, stamped anew each time the page publishes — so
  a live version's cells hold the code each went live with.

Every operator action is one patch commit, computed in East as the diff of the
one entry it writes: the builder's Apply (the page's draft cells), its Publish
(the live version becomes the draft, numbered one up — 1 the first time — each
placement stamped with its component's fingerprint) and its Save as template;
the page library's new page (a template's cells, or none for Blank grid). A
patch carries what it changes as it was, so a write drafted on a stale page is a
`conflict`, refused in the words of the screen that wrote it, and nothing is
overwritten.

### The builder — `<Studio.Builder>`

The builder as one component: the open page's canvas under one toolbar, the
palette before it, the inspector after it, and the publish preview, which
Preview and Publish open in the canvas's place. Its writes are patches, so it
takes the record bound with its patch:

```tsx
export const builder = ui("builder", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const components = $.let([kpiRail, revenueTrend, breakdownBars]);
        const record     = $.let(Record.bind(pages, [pagesPatch]));
        return <Studio.Builder pages={record} components={components} project="Ops console"
            env="Staging" audience="Field ops · 24 users" rollout="Immediate" />;
    }}</Reactive>
)));
```

- **The canvas.** The open page's draft cells on the SnapGrid's editing canvas —
  a template's cells when a template is open — each placement its component's
  own UI, framed or bare. Every move, resize, drop and removal, and every
  layout edit the inspector asks for, is a draft; the history item undoes,
  redoes, discards and applies, and ⌘Z / Ctrl+Z undo from anywhere in the
  builder. Apply is one patch commit on the page; a save another write beat is
  refused, and the history item says the source changed. The selection bar
  names the selected placement: its component's icon and name, its key and
  what its code reads.
- **The toolbar**, one row: the page's status — `Draft` with an open ring until
  its first publish, `Live` while its draft is its live layout, `Live · edited`
  once they differ, `Template` for a template — the grid chip and the time of
  the last save; the width readout, the zoom, the history item, Desktop ·
  Tablet, Save as template, Preview and Publish.
- **Save as template** names a template in a popover hanging from its button —
  offering "<page> template" — and saves the open page, as last saved: one
  commit. A name the project holds is refused as it is typed, and one another
  write took first is refused in the popover. While a template is open it is
  disabled.
- **The palette**, a pane of two tabs before the canvas. Components: every
  listed component but the deprecated, by category, with a search and a Filter
  menu over category, tags and collections; a card shows the component's icon,
  its name, the datasets its code reads and a lock, and drags onto the canvas as
  a placement at its component's span, storing its fingerprint. The component
  the canvas has selected is drawn placed, `ON CANVAS · ×N`, unsaved drafts
  counted; a click selects its first placement. Pages: the project's pages in
  key order with their status (`LIVE · Vn`, `DRAFT · Vn LIVE` or `DRAFT`); a
  click opens one.
- **The inspector**, the pane after the canvas: the selected placement's name
  and its component's key, with a warning when the component's code changed
  since the page went live; what its code reads, as keypaths
  (`.inputs.sales_daily`); its description, under a lock; and its layout — its
  span, held to its row's room, its row, its height (Auto or a preset in px)
  and where it sits in a taller row. Each edit is one gesture of the canvas's
  session. With nothing selected it says so.
- **The panes** collapse to rails: the palette's shows its icon, the number of
  components and its name; the inspector's its icon — in the brand while a
  placement is selected — the placement's span (`8/12`) and its name.
- **The publish preview**, in the canvas's place: a bar — "● Preview", Desktop ·
  Tablet · Mobile (the page 1440, 1024 or 390 px wide at most), the Env pill,
  and Exit, back to the canvas with its drafts as they were; the page as it will
  publish, its unsaved drafts in place; and an aside — "Ready to publish", the
  version it replaces and the one it becomes (`v3 → v4`), the changes since,
  each placement added, removed, moved or resized; a banner saying the
  components' logic is unchanged, or naming those whose code changed since the
  live version; the Audience and Rollout rows; Save as draft, the canvas's
  Apply; and Publish, which applies the canvas's drafts first, then commits the
  publish. A page never published is its first version, one live as it stands
  is up to date, and a template is not published.

The page open in the builder begins as the project's first; a `<Studio.Library>`
with the same `id` opens pages in it. The builder fills its parent's height and
draws no border around itself, so a host frames it or places it bare.

| Prop | Meaning |
|---|---|
| `pages` | **required** — the record bound with its patch: `Record.bind(pages, [pagesPatch])` |
| `components` | **required** — the components the surface lists, in palette order |
| `project` | **required** — the project whose pages it opens |
| `env` | where the preview publishes to — its Env pill, and "Publish vN to <env>"; omitted, neither names one |
| `audience` / `rollout` | who sees a published page, and when — the preview's rows; omitted, no row |
| `id` | names the builder — needed only when one surface holds two, and then given to the page library that opens its pages |

### The page library — `<Studio.Library>`

A project's templates and pages, and where new pages start: a component of its
own, apart from the builder, headerless with one toolbar. A new page is one
commit, so it takes the record bound with its patch:

```tsx
<Reactive>{$ => {
    const components = $.let([kpiRail, revenueTrend, breakdownBars]);
    const record     = $.let(Record.bind(pages, [pagesPatch]));
    return <Studio.Library pages={record} components={components} project="Ops console" />;
}}</Reactive>
```

- **The toolbar**, one row: the search "Search N pages and M templates…", which
  narrows both rows by title; Sort · Name, A to Z (the record's key order) or
  Z to A; the Pages row's Grid · List; and "+ New page in <project>".
- **The pane**: the projects the record holds and the surface's own, the shown
  one in the brand; the project's pages, each with its status dot — ● live,
  ○ draft — the one open in the builder in the strong ink; the legend at its
  foot. A project's click shows it; a page's click opens it in the builder.
- **Templates**: Blank grid — the blank page — then the project's templates,
  four across, each a wireframe of its layout, its title and what it places
  ("KPI rail ×2 · Revenue trend"); a click starts a new page from it.
- **Pages**: two across, each with its wireframe at its start, its title and
  status, how many components it places, and "Open in builder →", which opens
  it in the builder and calls `onOpen`; a dashed card last starts a new page.
- **A new page** takes a name the project does not hold and a template, or
  Blank grid, in a popover hanging from the New page button — a template's
  card and the dashed card open it there too, their template picked. It is one
  commit; a name another write took first is refused in the popover.

The project shown, the search, the order, the Pages row's layout and the
popover are its own; the page it opens is the builder's, shared by `id`. It
draws no border around itself.

| Prop | Meaning |
|---|---|
| `pages` | **required** — the record bound with its patch: `Record.bind(pages, [pagesPatch])` |
| `components` | **required** — the components the surface lists — what a template's line names |
| `project` | **required** — the project it shows first |
| `onOpen` | told when a page opens in the builder, with its key — the host shows the builder |
| `id` | names the builder whose open page it writes — needed only when one surface holds two builders |

### One page — `<Studio.Page>`

One page with no chrome, as everyone else sees it: its layout on the SnapGrid,
each placement its component's own UI. It reads the record's value and never
writes it, so a surface built from it holds the record's path and its listed
components' reads, and no write.

```tsx
export const opsConsole = ui("ops_console", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const components = $.let([kpiRail, revenueTrend, breakdownBars]);
        const all        = $.let(Data.bind(pages));
        return <Studio.Page pages={all.read()} components={components}
            page={{ project: "Ops console", page: "Overview" }} />;
    }}</Reactive>
)));
```

| Prop | Meaning |
|---|---|
| `pages` | **required** — the record's value: `Data.bind(pages).read()`, or a bound record's `read()` |
| `components` | **required** — the components the surface lists |
| `page` | **required** — the page's `{ project, page }` key |
| `version` | `"live"` (default), the published layout, or `"draft"`, the layout as last saved; a template draws its cells either way |

- A frameless component (`frame: "none"`) renders bare; every other placement is
  a tile.
- A page with no live version, and a key the record does not hold, each draw a
  placeholder that says so.
- Under a narrow container the tiles stack in row order.
- A chart that fills (`<Chart height="fill">`) takes a sized tile's height, and
  its natural height in a tile sized by its content.
- The page draws no border around itself; a solution places it in a layout of
  its own.

### Queries — `<Query.Builder>` and `<Query.Library>`

Operators build **typed jq queries** over the datasets a surface binds — as steps
in plain words or as jq — see them checked as they edit, run them to read the
result, and save them. A solution declares one record of saved queries, with
one write, a patch:

```ts
export const queries      = e3.record("queries", Query.Types.Saved, new Map());
export const queriesPatch = e3.mutation.patch(queries);
```

`Query.Types.Saved` is `Dict<String, SavedQuery>`, by name. A saved query is
`{ name, description, program, root, saved_at }`: its program as written (a
`JqType` tree, never text to re-parse), the `{ name, path }` of each data source
it reads, an optional one-sentence description — none shows a sentence
generated from its steps — and when it was saved. It saves only once it checks.
It holds no types: they are what checking its program against its data sources
gives. The type never depends on the data sources, so adding one runs no
migration.

To ship queries in the record, write its value with `Query.value(sources,
queries)`: each query inline, checked against the data sources when the package
builds, as the builder checks a query it saves. The sources are named as a
query reads them, each the dataset or task `Data.bind` takes:

```ts
export const queries = e3.record("queries", Query.Types.Saved, Query.value({ orders, customers }, [
    { name: "Big orders", jq: ".orders | map(select(.total >= 1000))", savedAt: new Date("2026-10-01T09:00:00Z") },
    { name: "Orders by region", jq: ".customers as $c | .orders | group_by($c[.customer_id].region) | map(length)",
      description: "How many orders each region placed.", savedAt: new Date("2026-10-01T09:00:00Z") },
]));
```

A query that does not check fails the build with the checker's words, as do two
queries of one name and a description over 140 characters. A query's root is
the data sources it reads, in the order given.

```tsx
export const builder = ui("query_builder", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const orders    = $.let(Data.bindPaged(d.orders));   // large: paged, never loaded whole
        const customers = $.let(Data.bind(d.customers));
        const saved     = $.let(Record.bind(d.queries, [d.queriesPatch]));
        return <Query.Builder queries={saved} datasets={{ orders, customers }} />;
    }}</Reactive>
)));

export const library = ui("query_library", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const orders    = $.let(Data.bindPaged(d.orders));
        const customers = $.let(Data.bind(d.customers));
        const saved     = $.let(Record.bind(d.queries, [d.queriesPatch]));
        return <Query.Library queries={saved} datasets={{ orders, customers }} />;
    }}</Reactive>
)));
```

`datasets` is the **root**: a query on this surface reads `.orders` and
`.customers`, and nothing else. Each name must be a jq identifier and each
value a `Data.bind`, `Data.bindPaged` or `Record.bind` handle; a surface handed
none, or a name jq can't read, is refused when it is built. The surface's
manifest follows: the record, its patch and each bound source.

**`<Query.Builder>`** is the builder: one toolbar (the history item, Copy jq,
Save… and Run ⌘⏎); a pane with three tabs — **Query** (the steps, each a card of
plain-word slots with its checked shape after it, or the jq in an editor with
completions and a problems panel; Visual · jq at the top), **Datasets** (the
bound data sources — a click starts a new query on one) and **Library** (this
viewer's recent runs and the saved queries — a click opens one); the results
beside it, a Table or a tree with Download (CSV, BEAST2); and a status line.

- Every edit is checked at once, in the browser, and is one undoable gesture of
  the history item; Save (Apply) commits the query as one patch of its one entry,
  and a save drafted on a changed entry is a conflict, never an overwrite.
- **Run** checks and translates the query in the browser and runs it on e3 as a
  **one-shot call** over the data sources it reads — or, when the dataset it
  works through weighs more than one piece (16 MiB), as a **split call** over
  that dataset's pieces, which e3 runs as a job of pieces and merges —
  platform-free either way, so a reader can run it. The results' footer says
  which ("One call", "Split call · 24 pieces"), and a click explains the plan:
  the path and why, what each piece runs, how the pieces combine and what runs
  once after them. Opening a saved query runs it; editing never does. Nothing
  else reads data but a slot's summary, and a run's dataset status before it
  plans.

| Prop | Meaning |
|---|---|
| `queries` | **required** — the record bound with its patch: `Record.bind(queries, [queriesPatch])` |
| `datasets` | **required** — the data sources a query may read, by the names it reads them: `{ orders, customers }` |
| `query` | the saved query it opens first, by name; omitted, a new query on the first data source |
| `id` | names the builder — needed only when one surface holds two, and then given to the library that opens queries in it |

**`<Query.Library>`** is the saved queries, and where new queries start: one
toolbar (the search over names, descriptions and data sources; Sort · Recent or
Name; Grid · List; "+ New query on <data source>"); a pane of the data sources
with their counts, and Recent; and a gallery, each card a wireframe of its query
— its source and a bar per step — with its name, its description, "orders · 5
steps · up to 10 orders · saved Tue" and "Open in builder →". It reads no
dataset: a card draws a query, never its data. A query opens in the builder that
shares its `id`, and its card drags onto it. A query whose data sources aren't
bound here says why and doesn't open.

| Prop | Meaning |
|---|---|
| `queries` | **required** — the record bound with its patch |
| `datasets` | **required** — the same data sources the builder reads |
| `onOpen` | told a query's name when it opens one in the builder — the host shows the builder |
| `id` | names the builder whose open query it writes — needed only when one surface holds two builders |

Neither draws a border around itself; each fills its parent's height.

### The Plan — `<Plan>`

`<Plan>` is the planning canvas, and there is one (#1191): ONE shared axis —
time, number or ordinal (#631) — over heterogeneous rows (state-runs,
allocation lanes, chart measures, heat, bucketed numerals, shift chips, event
marks), each named by a typed id, with slice / key-search / series-library /
review chrome, an editing session (every verdict, dropped card, move and
resize a draft, #880 / #825) and paged sources. It renders in its builder
frame wherever it is used (#1193): one toolbar holding every control it draws
outside its canvas, the banners, the canvas in main, and the footer. Its rows
come from three sources, in this order down the canvas:

- **event kinds over records** — `resources`, the rows, and `events`, the
  kinds placed on them: `Schedule`'s, the very values a Calendar takes, each
  kind a record of its own bound with its patch mutation;
- **`data` and its `series`** (or `pick`) — a keyed source's entries, laid out
  by the series list and nested from the data's own structure, on any axis; a
  `Data.bindPaged` handle is its `data` as readily as a collection in hand;
- **`rows`** — hand-built rows and `Plan.over(data, [series…])`, read only.

A Gantt is a Plan with span rows, a Planner a Plan with bucket rows, an
AlignedStack a Plan mixing chart / heat / table rows on the shared axis
(#571). Reach for it for anything scheduled on ONE shared axis — calendar
time, a numbered day / shift / distance, or an ordered list of phases — with
mixed row kinds, nesting to any depth, a paged source, rows addressed by
stable ids, or events kept in records of their own.

The tag and its authoring vocabulary — `Plan.axis`, `Plan.series.*`,
`Plan.children`, `Plan.ref`, `Plan.over`, `Plan.eventRef`, the value and cell
builders, `Plan.Types` — come from `@elaraai/e3-ui`, its event and resource
kinds from `Schedule`, and the tags around it from `@elaraai/east-ui`. It
moved here from east-ui (#1177) and is one tag (#1191): a surface that wrote
east-ui's `<Plan>`, or `<Plan.View>`, imports `Plan` from `@elaraai/e3-ui` and
writes `<Plan>`, its props as they were. Its words in React —
`PlanMessagesProvider` and `planMessages` — are `@elaraai/e3-ui-components`'.

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { Plan } from '@elaraai/e3-ui';
// … the series list and the axis, as below …
return <Plan axis={axis} data={rows} series={series} />;
```

```
<Plan axis={Plan.axis({…})} data={rows} series={[Plan.series.span(Row, {…}), …]} /> — the planning canvas: ONE shared axis — { time | number | ordinal } (#631): a UTC window ÷ resolution, a numeric window ÷ step, or an ordinal list = n bucket columns — over heterogeneous rows — the eight row kinds: span state-runs, bucket allocation lanes, chart measures, heat cells, bucketed table numerals, cards shift chips, event marks, and group strips — sliced, searched, picked and reviewed as one surface. Rows derive from `data` through `series` as an ordered STREAM (#822): the series list IS the layout (one contiguous block per series, top to bottom), a parent is followed by its subtree, and hierarchy comes only from the data's own nesting — never from a field value. Every row carries a typed id, `Plan.Types.RowId` = { series, path } (the series that made it and the entry keys that lead to it; `Plan.ref` builds one), which every callback reports and `links` address. Nothing behaves differently because `data` is inline or paged
├─ The frame (#1193): ONE toolbar holding every control the Plan draws outside its canvas, in this order — the slice's narrowing (cohort · filter · search), the scope badge, the key search, GROUP · RESOURCE, the slice's range, WEEK · DAY, the diagnostics; at its end the summary line, the review's summary with Reject all · Rerun · Approve all, and the history item (a Plan with none of them has no toolbar). It is one row at every width: the rail folds first, then the summary shortens and the review's summary goes, the resolution and the grain fold into their one-chip menus, the summary hides, the review's buttons fold into one Review menu, the key search into its icon (which opens the box in a popover, the focus in it), and the history item last, to its buttons; on a touch screen every control there is a 44px tap target. The banners — an Apply's conflict, a refusal, an unknown outcome with Retry, a source out of date with Discard. Main — the canvas: the horizon, the ruler, pinned rows and the rows. The footer — the counts: the event kinds' events in the window, their backlog, the changes pending, the events to review, and when an event kind's record was last saved; then the author's `footer` and the transport line. ⌘Z undoes and ⇧⌘Z redoes from anywhere in the frame; a field being typed into keeps its own undo. The Plan draws no border
├─ Props:
│   ├─ axis (required) — ONE of three kinds; every element instant on the canvas must ride its arm. The kind is also a TYPE: `Plan.axis.number(…)` fixes the tag's `K`, every builder result carries the kind its instants' STATIC types imply (a `DateTimeType` accessor ⇒ `"time"`, a `FloatType` field ⇒ `"number"`, `Plan.at.ordinal(…)` ⇒ `"ordinal"`), a series collects its elements' kinds, and a series (or literal row) on another arm FAILS TO COMPILE at the tag — no wire change, the brand is phantom. Kind-erased values (a stored record, an `Expr<Plan.Types.Instant>`, an East-mapped element list, a `$.let`-bound axis or `$.const`-bound series list, chart rows) constrain nothing at compile time and are held to the axis at render — a row on another arm is a render-time diagnostic naming the row and the arm, never a silent misplacement. Plan.axis({ window?, resolution, resolutions?, now?, format? }) — the TIME shorthand (= Plan.axis.time): half-open [min, max) UTC window; omit window ⇒ the bound slice's datetime range — there is NO fit to the data (#822): a canvas that neither states a window nor binds a slice is refused, at build when the axis is written in the tag, else as the render-time NO WINDOW diagnostic (a bound or stored axis); `resolutions` lists the WEEK/DAY segment options; `now` draws the observed/plan divider; `format` overrides tick labels (date tokens; defaults: week ⇒ "W27", day ⇒ "MON"); at a resolution coarser than a row's data a bucket shows ONE value per row — the fold of those in it (#824) · Plan.axis.number({ window?, step, now?, format? }) — a numeric window ÷ `step` (bucket edges on whole steps; omit window ⇒ the bound slice's float / integer range, under the same no-fit rule; `format` a Chart.format.* spec; no resolution segment — step IS the declaration) · Plan.axis.ordinal({ values, now? }) — the declared values ARE the buckets, in order (the list is the window: no slice range, no brush, the window keys idle; an unlisted value positions nowhere; an interval END names its LAST bucket, inclusive)
│   ├─ data (required unless `events` or `rows` — a Plan with no rows from any source is refused at build) — a KEYED collection: a `Dict<K, R>` value/expression for the inline arm, or a `$.let`-bound `Data.bindPaged(…)` handle for a WINDOWED arm, recognised by its East type: `pinned` when it names its snapshot, which `editing.onApply` needs; `paged` when it is the shape a UI exported before `revision` / `refresh`, which names none. Any key type `K` — a row's path starts with its entry's key, a String as it is, any other key as its `.east` text (`3`, `(hall="H1", bin=3)`) — and any entry type `R`: a struct, a `RecursiveType` node, or a collection (a `groupToDicts` group). A positional collection is refused — key it at the call site with `rows.toDict((_$, r) => r.id)`. A paged canvas pages by PARENTS (#823): a window is N top-level entries, each with its whole subtree, so a parent never straddles two windows and its bands, means, subtotals and member count are exact — nest children in the source, and group a flat paged source in its dataflow (a group is one entry holding its members; a parent is bounded by a page). Each top-level series is a BLOCK, exactly as inline: a paged canvas pages every block on its own over the same windows (its own bands and resident run; one read of a window serves every block), draws a section's header and hand-built rows once (FIXED blocks), and rebases only the block a far jump lands in; a window landing above the rows in view at a height its estimate missed moves the scroll, never the rows. A paged source may serve SHORT windows (e3 trims pages of wide entries to a byte budget) and the canvas still reads WHOLE ones — its derived source re-requests what a trimmed page left out. When the source's `revision()` moves (`Data.bindPaged` follows each write to its dataset), the canvas re-reads its resident windows at the new snapshot IN PLACE: the rows on screen stay until theirs land (no remount, no empty frame), the scroll position holds, and a standing key search is cleared (its hit named a row of the old snapshot)
│   ├─ series (required unless `pick`) — the row recipes over `data`; the list IS the layout (#822): each series contributes one contiguous block, top to bottom in declared order, its rows in source order, each parent followed by its subtree. Data series: Plan.series.span/buckets/chart/heat/table/cards/events(Row, { key, title, subtitle?, icon?, keyType?, match?, label, id?, stacked?, sub?, value?, status?, approval?, review?, expand?, children?, collapsed?, edit?, …kind fields }) — every accessor receives (entry, key); a `RecursiveType` entry arrives as its node. What a gesture WRITES is declared on the series (#880): `review: { verdict: "approval" }` names the entry's `ApprovalStateType` field a verdict drafts (the row shows it as its approval; `approval` only SHOWS a verdict the canvas cannot change — give one or the other), and `edit: { items: "jobs", create: (drop, entry, key) => item }` (span / buckets / cards / events) names the entry's `Array` field a dropped card joins and builds the item from the `Plan.Types.Drop` — see `editing`. Naming the item's `String` key field and its instant fields as well — `edit: { items: "jobs", key: "key", start: "start", end: "end" }` (span / cards) or `{ items, key, at }` (buckets / events) — makes its runs, chips, tiles and marks MOVE, and its runs and chips RESIZE (#825): an element's key is its item's key — its identity across every row it can move to, since a row's list keeps its keys unique (a card or a move that would repeat one is refused, the drag showing ⊘) — an instant field is a `DateTime`, a `Float` / `Integer` (number axis), a `String` (ordinal) or a `Plan.Types.Instant`, and `create` becomes optional. `children` nests, to any depth: a bare accessor `(r) => r.children` walks more of THIS series (a recursive entry's own children), `Plan.children(of, [series…])` steps down to a child collection of another entry type (an `Array` in data order, a `Dict` in key order — its series laid out like a top-level list), an array of step-downs gives several child collections in order (a gesture on a nested row writes back through them, so where a series below takes gestures they read a FIELD of the entry — `r => r.children`, `Plan.children(r => r.presses, …)` — or are the entry itself, `g => g`; a computed collection is refused at build); `collapsed: true | (r, k) => …` is a parent's initial state. A parent derives exactly, because its whole subtree rides in its entry: span bands over the subtree's runs (`rollup` "union" | "byStatus" | "sum"; a band sums its runs' quantities unit by unit — the unit rides each `Plan.quantity`), a heat parent with no cells of its own the children's per-bucket `aggregate` (default "mean") painted on its `scale` ({ min?, max?, warnAt? }; default the scale its members share), a table parent with no values per-position subtotals (`aggregate` default "sum", `format`) — each summarising what its children SHOW, their values already folded to the resolution · Plan.series.group(Row, { key, title, label, children, summaryAggregate?, summary?, collapsed? }) — one strip PER ENTRY, its members the entry's children (derived member count; collapsed it rests as its summary strip — explicit `summary` cells OR a `summaryAggregate` of the members' heat cells, never both) · Plan.series.section(Row, { key, title, collapsed?, meta?, value?, status?, summary?, summaryAggregate? }, [series…]) — a fixed titled block over series (it adds no path segment; its header's id is `Plan.sectionRef(key, …parentPath)`) · Plan.series.views(Row, { key, title, match?, children?, collapsed? }, [series…]) — ONE entity shown several ways: one row per member series per entry, ADJACENT and in declared order (a member's own `match` decides whether its row shows; members declare no `children`), the entry's children following its view rows under the first — more of the views' own entries too (a bare accessor), each drawn as the members' rows, to any depth, a span member's `rollup` rolling them up — and a seek on the entry landing on its first view row · Plan.series.rows(Row, identity, rows) — hand-built rows (the kind factories below) placed as one block. Series keys are unique across the WHOLE series tree — a repeat is a build-time Error naming both sites (a list bound as an East value is checked at render: a repeated id draws as a row diagnostic, never a silent drop). There is no `groupBy`: to group a flat source, reshape it first — inline, one `groupToDicts` in the canvas function (`rows.groupToDicts(($, r) => r.hall, ($, _r, k) => k)`, entries `Dict<String, Row>` whose key is the group); a paged source in the dataflow. A source keyed by another type (`Dict<Integer, R>`) works with series whose accessors ignore the key; one that reads it declares `keyType` and, bound as a list, types it `Plan.Types.Series(R, KeyType)`
│   ├─ pick (optional, exclusive with `series`) — Plan.pick(key, allSeries, { hidden? }): the bound series library — the toolbar has no Series button (#1193): the library pane's Series tab (#1195) lists the series by title, subtitle and kind icon in the list's order (that order is the canvas layout); hidden series drop from the canvas (a hidden section, group or views takes its whole block); there are no row counts (#822 — a count means something only with every entry in hand); a pick is STATE, so the Plan must sit inside a <Reactive>
│   ├─ resources + events (optional) — event kinds over records (#1191), `Schedule`'s — the very values a Calendar takes: `resources={{ presses: Schedule.resources(rows, { name, icon, label, … }) }}` are the rows events are placed on, in this order, and `events={{ job: Schedule.events(Record.bind(jobs, [jobsPatch]), { name, icon, title, start, end | at, resource: { field, of }, … }) }}` the kinds, each a record of its own committed through its patch mutation. Their rows come first, then `data`'s, then `rows`'. Each resource kind is a block (#1192): every resource a row per way the kinds placed on it draw — bars, tiles, chips, marks, in that order — then its `measures`, under its `group` strips and nested by its `parent`; a row's id is `entry { series: "<slot>.<draw>", path: [group?, …parents, key] }`, an element's key its event's `Schedule.Types.EventRef` as East prints it, and an event no resource holds draws on its kind's Unassigned row after every resource kind. The rows are read over the window the canvas draws, and read again when a record commits. An event is scheduled in time, so event kinds on a number or ordinal axis are refused at build, naming the axis and the kinds (an axis held in a variable is refused in the same words as the Plan is evaluated); `resources` without `events`, and a kind's `resource` naming a slot `resources` has not, are refused too. `applyMode` ("batch" default | "auto") says when the kinds' drafts go — `data`'s session takes `editing.mode` — and `date` the date brought into view first
│   ├─ rows (optional) — read-only rows after the event kinds' and `data`'s: hand-built rows (`Plan.chart({ … })`, `Plan.span({ … })`, …) and `Plan.over(data, [series…])`, series over a dataset — a keyed collection, or a `Data.bind` handle over one — which refuses a series declaring `review` or `edit` at build (a Plan's edits go through its event kinds and `data`'s session). Each is a FIXED block, drawn once on a paged canvas; a `pinned` row sits under the ruler. Their instants ride the axis's arm, or the tag fails to compile
│   ├─ links (optional) — [Plan.link({ key, from: Plan.ref(series, …path), fromRun, to: Plan.ref(…), toRun, quantity?: Plan.quantity(34, { unit: "k sheets" }) })] run-edge quantity ribbons, their ends named by row id (a `views` entry's chart row and its span row are two different ends); an end may instead be an event — `from: Plan.eventRef(kind, key)`, no `fromRun` — drawn wherever the event is, and a link naming a kind `events` has not is refused at build (one whose kind is not known there — a list held in a variable or built in East, or an event end held in a variable — as the Plan is evaluated); rows an edge touches grow the links-focus control (gathers the transitive upstream/downstream family; unrelated rows collapse to 11px rails / ⋯ gap bands — never removed). A ribbon's share of the family's largest quantity sets its ink, and the quantity's caption — its `text`, else its value through its `format`, then its unit — prints on it and is its tooltip; a link with no quantity draws faintest and says nothing. A click on a ribbon reports the `link` element ref ({ key, from, to }) and opens the root's popover for it
│   ├─ popover / hover (optional) — generalized element resolvers fn(Plan.Types.ElementRef) => Option<UIComponent> over EVERY element (run / event / chip / mark / cell refs, each carrying the row's id — compare with `East.equal(ev.row, Plan.ref(…))` — and link refs { key, from, to }, a ribbon belonging to no one row); resolved lazily at click/hover time — a `none` result opens nothing
│   ├─ expandRender / expandGutter (optional) — the R2 expand-in-place renders fn(Plan.Types.RowId) => UIComponent for rows declaring `expand` (per-row DATA: `{ height?: "168px", axis?: "keep" | "dim" | "off" }` — the render's height, and whether the shared grid + now-line run through it, wash to 40%, or hide inside that row); the focused row GROWS to hold the render (its marks keep their band at the top, its gutter cell grows with it and takes `expandGutter`); every other data row compresses to a 16px strip — never removed: bars / tiles / chips shrink to 7px marks, chart and table rows re-encode as a tone strip, event marks keep their silhouette; a strip click or Esc returns
│   ├─ review (optional) — the review chrome ({ columnLabel?, summary?, onRerun?, rerunLabel? }): the decision column, and the toolbar's review item (#1193) — the `summary`, then Reject all · Rerun · Approve all; on a row short of room the summary goes, then the buttons fold into one Review menu. A verdict is a DRAFT of the `editing` session, never a callback (#880): the reviewed series names the field it writes (`review: { verdict: "approval" }`), Approve / Reject on a row and Approve all / Reject all in the toolbar are ONE gesture each (the "all" forms draft every row the canvas HOLDS that takes a verdict — paged, the loaded rows, and the button says so: "Approve 200 loaded"), and the pressed button is the drafted field drawn again. Without `editing` the buttons are disabled and the toolbar has no batch; a row whose series only shows `approval` draws it pressed, both buttons disabled. `onRerun` changes no data, so it stays a callback. The removed `onApprove` / `onReject` / `onApproveAll` / `onRejectAll` throw at build, naming the replacement
│   ├─ editing (optional) — the editing session (#880), the Sheet's (#879) over the source's TOP-LEVEL entries: { onApply? | onUpdate?, onPatch?, mode?, ready? }. Every verdict, dropped card, move and resize drafts the entry its row came from (a gesture on a nested row drafts the entry its whole subtree rides in), drawn at once where it was made — the entry's rows derived again, marked pending, or incomplete / invalid while a check refuses that entry — each gesture ONE undoable transaction. The history item (issues · Undo · Redo · Discard · Apply, and its status line) ends the frame's toolbar; ⌘Z / Ctrl+Z undo, ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y redo. `onApply` fn(Editing.Types.ChangeSet(R, K)) => Editing.Types.ApplyResult (sync or async) commits one checked batch against the base the drafts began from — the inline `Dict`'s snapshot, or a paged source's revision (a paged `onApply` needs the source's `revision` and `refresh`): a batch against a source that moved is refused, never rebased, and a banner says "Source changed — review or discard these drafts"; an Apply that throws leaves the outcome unknown, and the banner's "Retry request" resends the SAME request (dedupe by its `requestId`); drafts retire only when the source reads back at the committed revision. `onUpdate` fn(Dict<K, R>) => Null is the inline adapter instead (exclusive with `onApply`): pass `data={handle}` and `onUpdate={handle.write}`, and each batch applies with `Editing.apply` over the handle's LATEST `Dict` and writes the whole result once — idempotent across retries. `onPatch` fn(Plan.Types.PatchEvent(R)) => Null hears every gesture (origin verdict / drop / move / resize / undo / redo / discard). `mode` "batch" (default — Apply sends) | "auto" (each ready gesture goes at once). `ready` fn(R, K) => Editing.Types.Readiness checks a drafted entry — a refusal names the entry and holds Apply (a check that throws refuses its own entry only). Without `editing` the canvas takes no gesture
│   ├─ slice + affordances (optional) — bound slice chrome (default ["cohort","filter","search","range","resolution","brush","summary"]): the slice's range (`datetime` on a time axis, the field's `float` / `integer` on a number axis) / resolution IS the window + resolution source of truth (axis seeds the unbound case; an ordinal axis has no range arm; the window widens outward to whole periods). A slice range is CLOSED (both ends inclusive) and the window half-open, so the canvas writes `[min, max)` as the range ending at the last value before `max` on the field's own lattice — an integer's `max − 1`, a datetime's millisecond before, a float's next double down — and reads it back whole (#949): seed an integer range `{ from: 1n, to: 8n }` for the eight steps 1–8 (the range chip reads `1–8`), a datetime one ending the millisecond before the window's end (`week(39n).addMilliseconds(-1n)`); `brush` mounts the horizon band on time and number axes — an OVERVIEW of the range field in whole periods, one histogram bar each, with a lens joining its window to the plot's edges (drag its body to slide the window, an edge to resize it, empty track to draw one — every snapped step APPLIES live, so the canvas re-renders honestly mid-gesture and the release commits), `resolution` the WEEK/DAY segment (time axis, slice-bound only), `summary` the count line. On a PAGED canvas, narrowing affordances are scope-badged ("loaded rows only") and `search` becomes a KEY SEARCH over the source's `seek` — the toolbar's search box, folding to its icon on a row short of room; the jump REBASES residency at the match (windows in between are never fetched); the query is a whole-key literal, a prefix, leading struct fields, or a `from..to` RANGE over a leading prefix of the key's flattened fields (`late, 3..ok`), which is what a time window or a status band asks for — quoting is the escape: a quoted value is exact and a `..` inside it is text (`"../config"`)
│   ├─ grain (optional) — initial grain "resource" (default) | "group" (root groups collapse to summary strips); the `g` key cycles it, and a canvas with a root group mounts the toolbar's GROUP · RESOURCE segment for it — slice or no slice (#632; the narrow layout's tabs own the grain there); onGrainChange observes
│   ├─ ui (optional) — the interaction state, held by the HOST (#824): State.bind([Plan.Types.UiState], key, Plan.uiState({ selected?, collapsed?, expanded?, charts?, focus? })) — the canvas draws it from its first frame, takes every outside write (a selection, rows folded or opened, charts expanded) and writes the user's own actions back, once per action; `collapsed` / `expanded` list the rows folded / opened AGAINST their declaration (a row in neither follows it; in both, folded); `focus` is a REQUEST — the canvas opens the rows it nests under, scrolls it to the top of the view, makes it the tab stop (DOM focus stays put) and writes `focus: none` back; a paged row it has not loaded is opened by its window, or sought by its entry's key where the source can seek. Bound, the canvas persists no toggles of its own under its `storageKey`
│   ├─ id + sources + canDrop (optional) — DnD TARGET (the shared grammar): Library cards `add` onto rows whose series declares `edit` — span / buckets / events / cards only (chart / heat / table render DERIVED values, and section headers and group strips are wayfinding — they register no cell) — and only with `editing`: a drop is a DRAFT of the session (#880), its item built by the series' `create` from the `Plan.Types.Drop` ({ from: { library, key }, row, at, duplicate } — `at` the start of the bucket it landed in, on the axis arm). `canDrop` sees the drag grammar's `add`: its `into.row` is the row id's canonical TEXT — key host tables by `East.print(Plan.ref(series, …path))`, or read it back with `row.parse(Plan.Types.RowId)`; slot = the bucket start instant per the axis arm — time: Z-less ISO (`slot.parse(DateTimeType)`), number: a decimal (`slot.parse(FloatType)`), ordinal: the value; drop verdicts resolve LIVE where the drag rests — `canDrop` is asked of the event a drop there would deliver (an `add`'s `duplicate` is whether Alt is held), renders the ⊘ stage, and is asked again before the drop becomes a draft — and the landing band previews WHERE the card lands. A moved or resized element (#825) is vetoed the same way: `canDrop` sees the grammar's `move` ({ from, to } cells, `from.event` the element's key) or `resize` ({ event, edge }). The canvas's own elements move with or without an `id` — only a card needs it. A card held at a bounded canvas's edge scrolls it to the rows beyond; by keyboard (#608) → / ← step onto a row and along its buckets and ↑ / ↓ between rows, each bucket announced ("Poster run is over H1-P03, Week of Jul 6, 2026."). `onDrag` is removed (#880) and throws at build. With event kinds, `canDrop` may instead be fn(Schedule.Types.Candidate) => Option<String>, vetting an event kind's drop with its message on the ghost, as the Calendar's — the arm is read from the function's type
│   ├─ onSelect / onElementClick / onGroupToggle (optional) — row selection, ONE element callback and section toggles; payloads are row ids + element keys + instants, never indices: onSelect the `Plan.Types.RowId`; onElementClick a `Plan.Types.ElementRef` — the SAME ref the popover resolver receives, its arm the element kind (run { row, run } · event { row, event } · mark { row, mark } · chip { row, chip } · cell { row, at } — `at` a Plan.Types.Instant on the axis arm, a folded bucket's start · link { key, from, to }), so `ref.match({ run: …, link: … }, …)` handles the kinds it cares about; onGroupToggle { row, expanded } for any row with children
│   ├─ footer (optional) — [{ text, tone?, end? }] status-footer items, in the frame's footer after its counts; a paged canvas adds the transport line ("N loaded of M · Loading…", counted in source ELEMENTS); until the source is exhausted a TOP-LEVEL section's member count prints `~`-marked (its members are entries the windows share out) — every other parent's numbers are exact, its subtree riding whole in one entry
│   └─ style (optional) — { height ("fill" fills the parent) and maxHeight — the whole Plan's, its frame's, the canvas filling main and scrolling its own rows; with neither, a host that gives the Plan a height bounds it the same way, and one that gives none lets it grow with its rows — density ("compact" ⇒ dense 24px rows), gutterWidth ("168px", CSS px) }; a bounded canvas pins the PARENT of the rows in view under its header — with its ancestors' path on a deep tree — once the parent's own row scrolls off, inline and paged (a click goes to it, #823)
├─ Narrow (below 480px of CONTAINER width — a phone, a splitter pane, a task preview; §10): the same definition reflows to a review tool — the frame's toolbar keeps its items, folded to fit (the GROUP · RESOURCE segment leaves: the tabs own the grain), no horizon brush, and Groups · Rows · Measures tabs (the `<Tabs>` line grammar, counts as plain numerals) over ONE slice, then the card list with the shared ruler as its sticky first row (a separator per bucket, labels thinned to what fits): Groups = the group grain as hottest-first strip cards (tap opens its rows) — the LANDING only when it is a map (three or more groups, or any strip); Rows = every data row as a card SECTIONED by group (a section header scopes to that group; `← All rows` returns) with the gutter identity as the card head and the row's plot — the same kind renderer — as the body on the shared window; Measures = chart rows full-width at expanded density; tap selects, a second tap on an `expand` row drills it in place (~148px; neighbours keep their size), a two-finger horizontal drag pans the window; a bounded `height` pins the header and scrolls the list; a paged source shows its resident prefix. Wrap a Plan in `<Box width="360px">` to see it on a desktop page
├─ Keyboard (#819): the body is a TREEGRID with ONE tab stop that roves between its rows — every row, group band, ⋯ gap band and paged-window band (loading or failed) is a `row` with aria-level / aria-expanded / aria-selected and an `aria-rowindex` that stays exact under virtualization, collapse and paging · ↑ / ↓ step, Home / End go to the first / last, PgUp / PgDn move a viewport · → opens a closed section (a group band, a nesting parent, an `expandable` chart) and steps into an open one's first child; ← closes an open one, else steps to the parent · Enter does the row's click (select; a group band toggles; a rail, strip or ⋯ band returns from the row focus) · Space toggles the section / chart · a step onto an UNLOADED band asks the source for that window and moves on to the row once it lands (Home / End reach the source's own first / last row) · Tab walks the row's widgets — its controls, its elements in time order, tabbables in the expand render, its review buttons — then leaves the canvas; ← / → (Home / End) step between elements in time order; Enter / Space on an element does its click (the popover, the row's selection, the element callback) · Esc ladder, one rung per press: popover → element back to its row → brush → focus → deselect · n recenters the window on `now` · [ / ] pan one period · g cycles the grain — window keys are SLICE writes, so an unbound canvas idles them · with `editing`, ⌘Z / Ctrl+Z undo the last gesture and ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y redo it (#880) · with `editing`, Space on a movable element picks it up (#825): ← / → move it one bucket, Shift+← / → its end and Alt+← / → its start, ↑ / ↓ carry it to the nearest row above / below that takes it, Space / Enter drop it, Esc / Tab cancel — each step said in the canvas's live region · the toolbar's GROUP · RESOURCE and WEEK · DAY segments are radio groups: one tab stop each, ← / → (Home / End) move and pick
├─ Screen readers (#819): a polite live region says what changed — a selection, a section or chart opening / closing, a row focus coming or going, the grain, the resolution, each window a paged source lands ("Loaded elements 201–400 of 5,000", counted in source elements like the transport line); every element is named in words — label, span or bucket ("Week of Jul 6, 2026"), state, tone — a chart row reads as an image with a min / max / last summary per layer, and colour-only cells (heat depth, booked weight, segment composition, compressed strips) carry their value as text; narrow, the Groups · Rows · Measures tabs are a real tablist (arrow keys, one tabpanel each)
├─ Localization (#820): every word the canvas says itself — toolbar, ruler, footer, diagnostics, bands, narrow tabs and cards, review buttons, the history bar (the table carries the editing session's words, #880), element names, live-region announcements — comes from ONE typed message table, and every number and date it prints is in the LOCALE: react-aria's `<I18nProvider locale="de-DE">` above the app sets it (the browser's language otherwise), and derived numbers ("2.234,5 k sheets"), ruler ticks ("MO · DI"), the words a reader hears ("29. Juni 2026") and a Chart.format.* axis all follow it. Host React code overrides any subset of the words for a subtree with `<PlanMessagesProvider messages={GERMAN}>` (@elaraai/e3-ui-components; `planMessages` is the English table — each message a function of named, already-formatted parameters, plus the raw `n` for plurals; define the overrides ONCE, not per render — providers nest). What the AUTHOR wrote is data and never translated: labels, footer items, and a date `format` pattern on the axis (East tokens, as written); the label a patch event carries to the host stays in English, as the Sheet's does
└─ Factories:
    ├─ Plan.axis({ … }) = Plan.axis.time / Plan.axis.number({ window?, step, now?, format? }) / Plan.axis.ordinal({ values, now? }) — the shared axis declaration, one of three kinds (Plan.Types.Axis); Plan.at.time(d) / Plan.at.number(n) / Plan.at.ordinal(s) build ONE INSTANT explicitly (Plan.Types.Instant) — needed only for element RECORDS written as data (a Plan.Types.HeatCell array, a stored Plan.Types.Run): every element builder below takes a Date / number / string, or a DateTime / Float / Integer / String expression, and wraps it to the arm by its type, so a `start: r.start` DateTime accessor and a `day: FloatType` field both need nothing written
    ├─ Plan.series.* — the data-driven row series (see `series` above); Plan.Types.Series(Row) is one series' East type over `Dict<String, Row>` entries, Plan.Types.Series(Row, KeyType) over another key type
    ├─ Plan.children(of, [series…]) — a step down from an entry to a child collection of another entry type (`of(entry, key)` returns an `Array` or a `Dict`), for a series' `children`
    ├─ Plan.ref(series, …path) / Plan.sectionRef(series, …path) — a row's id (Plan.Types.RowId = entry { series, path } | section { series, path }): `Plan.ref("presses", "H1-P03")`, a nested row `Plan.ref("rollup", "Contract A", "H1-P03")`, a `views` member's row by the MEMBER's key; for links, `East.equal` comparisons in resolvers, and host tables keyed by `East.print(id)` (an id is a variant — it cannot be a Dict key itself)
    ├─ Plan.run({ key, start, end, label, quantity?, state, status?, moved?, icon? }) — one state-run bar (state: "actual"|"in-progress"|"confirmed"|"estimated"|"added"|"recommended"|"removed"|"rejected"; `quantity` is ONE Plan.quantity — the bar prints its caption after the label and a parent's rollup band sums it with its siblings' in the same unit; status "warning" draws the stuck ring; runs past the window mask-fade, never fabricate an end)
    ├─ Plan.quantity(value, { unit?, format?, text? }) — a quantity (Plan.Types.Quantity): `value` is what sums, weighs and compares, `unit` what a rollup sums by (sheets never add to hours), `format` a Format.* spec printing the value in the viewer's locale, `text` a caption printed instead (the value still sums) — a run's and a link's `quantity`
    ├─ Plan.event({ key, at, lane?, label?, icon?, state, tone?, color?, colorPalette?, stretch?, content?, animation? }) — one bucket tile (label omitted ⇒ the resting ✓ / dashed `plan` chip; lane omitted in a laned row spans the full cell — the mixed grammar)
    ├─ Plan.lane({ key, label? }) / Plan.marker({ at, lane?, status?, message }) — bucket sub-slot lanes + cell status rings (status defaults "danger"; message = the tooltip)
    ├─ Plan.chip({ key, from, to, label, state, icon? }) — one cards shift chip; Plan.mark({ key, at, kind, icon?, label? }) — one event mark (kind: "milestone" | "exception" | Plan.markKind.decision(applied))
    ├─ Plan.decision({ key, at, applied }) / Plan.port({ at, label? }) — span-row decision diamonds (◇ pending / ◆ applied) + quantity in/out ports
    ├─ Plan.heatCells(cells, { min?, max?, warnAt?, fold?, format? }) / Plan.weightCells(cells, { fold?, format? }) / Plan.segmentCells(cells, { fold?, format? }) + Plan.segment({ fill, weight, label? }) — the three heat-row cell arms (colour depth / booked-vs-free bars / compositions); `fold` is what a coarser bucket shows of the cells in it (heat and weight "mean", segments "sum"; "sum" | "mean" | "min" | "max" | "last" | "count"), `format` a Format.* spec for the values the arm prints — a heat cell without a `label` prints its value only through a declared `format`, and the words a reader hears for a weight or a segment share follow it
    ├─ Plan.tableCells(rawCells) / Plan.tableSeries({ cells, format?, tone?, strong?, rollup?, fold? }) — bucketed numerals (a raw cell's `at` wraps by its field type — DateTime / Float / Integer / String / an instant) (multi-series per row, style declared once per position; explicit text/tone overrides via PlanTableCellType values); a series folds by `fold` (default "sum"), and `Plan.series.table`'s `fold` declares it for its `cells`
    ├─ Plan.layer(chartLayer, { axis?, breach?, series?, fold? }) + Plan.fixed("120px") — chart rows consume Chart.Line/Column/Area/Scatter/Band/ref* builder results AS DATA on the shared scale (the x accessor's static type picks the arm — DateTimeType ⇒ time, Float/Integer ⇒ number, String ⇒ ordinal — and must match the canvas axis at render; Chart.Bar is a build-time error on every kind); Plan.layer adds the y-axis side, breach threshold, stack series and the fold a coarser bucket shows (columns "sum", lines and areas "mean"; scatter and band layers draw every point)
    ├─ Plan.span/buckets/chart/heat/table/cards/events/group({ key, label, id?, sub?, value?, meta?, stacked?, swatches?, collapsed?, pinned?, height?, status?, approval?, expand?, …kind fields, rows? }) — literal kind factories returning row STREAMS (the row, then its nested `rows:` in order; parents DECLARE rollup/aggregate and the renderer derives the numbers); ride them beside data-driven series via Plan.series.rows — a hand-built row's id is that series' key plus the factory `key`s that lead to it (`Plan.ref("works", "shutdown", "elec")`), so keys must be unique among siblings (a repeat draws as a DUPLICATE ID row diagnostic)
    ├─ Plan.link({ key, from, fromRun, to, toRun, quantity? }) — one link-graph edge; `key` is what a ribbon click's `link` ref names it by, `from` / `to` are row ids (`Plan.ref`) with their runs, or events (`Plan.eventRef`) with none, `quantity` a Plan.quantity
    ├─ Plan.eventRef(kind, key) — an event of one of the Plan's event kinds, named for a link's end (Plan.Types.RunRef) · Plan.over(data, [series…]) — series over a dataset, read only, for `rows` (#1191)
    ├─ Plan.uiState({ selected?, collapsed?, expanded?, charts?, focus? }) — the seed of a bound `ui` state (Plan.Types.UiState): rows named by id (`Plan.ref`), omitted fields empty
    └─ Plan.Types.PatchEvent(R) — what `editing.onPatch` receives for entries of `R` · Plan.Types.Drop ({ from: { library, key }, row: RowId, at: Instant, duplicate }) — what an `edit.create` builds its item from · Plan.Types.Gesture (verdict(ApprovalState) | drop(Drop) | move(Move)) and Plan.Types.RowEdits ({ verdict, drop, move: Option<MoveEdits> } — the gestures a row takes) · Plan.Types.Move ({ key, from: RowId, to: RowId, start, end } — a moved or resized element, #825) — the editing wire (#880); the session's contracts are the shared `Editing.Types.*` (ChangeSet(R, K), ApplyResult, Readiness)
```

#### The series list is the layout, the data is the hierarchy (#822)

A canvas is `data` plus a list of series, and the list IS the layout: one
block per series, top to bottom, each parent followed by its subtree. Nesting
comes only from what an entry holds — a recursive entry's own children, or a
step down into a child collection — so a parent's bands, means and subtotals
are exact, and the canvas reads the same inline or paged. There is no
`groupBy`: to group a flat source, reshape it first.

```tsx
// Grouping is a DATA step: one groupToDicts makes each hall an entry holding its rows.
const halls = $.let(rows.groupToDicts(($, r) => r.hall, ($, _r, k) => k));
const HallGroup = DictType(StringType, HallRow);
const series = $.const([
    // One strip PER HALL; its rows stepped down into, laid out like a top-level list.
    Plan.series.group(HallGroup, {
        key: "halls", title: "Halls",
        label: (_g, hall) => hall,
        summaryAggregate: "mean",
        children: Plan.children((g) => g, [
            Plan.series.span(HallRow, {
                key: "hall-jobs", title: "Jobs",
                match: r => r.jobs.size().greater(0n),
                label: r => r.label,
                runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.ticket, state: j.state })),
            }),
            Plan.series.heat(HallRow, {
                key: "hall-load", title: "Load",
                match: r => r.cells.size().greater(0n),
                label: r => r.label,
                cells: r => Plan.heatCells(r.cells, { min: 0, max: 100 }),
            }),
        ]),
    }),
], ArrayType(Plan.Types.Series(HallGroup)));
// <Plan axis={axis} data={halls} series={series} />
```

A recursive entry nests to whatever depth the data has, and every parent
derives its numbers from its subtree:

```tsx
const OrderRow = RecursiveType((self) => StructType({
    name: StringType, act: ArrayType(RawCell), children: DictType(StringType, self),
}));
Plan.series.table(OrderRow, {
    key: "orders", title: "Orders", label: r => r.name,
    cells: r => Plan.tableCells(r.act),           // a parent carries no values of its own…
    children: r => r.children, aggregate: "sum",  // …and shows its subtree's subtotal, at every depth
    format: Format.Number({ maximumFractionDigits: 0n }),
})
```

One entity shown several ways is a `views` series: each entry gets one row per
member series, side by side, and each row has its own id:

```tsx
Plan.series.views(OpsRow, { key: "presses", title: "Presses", match: r => r.pick.equal("presses") }, [
    Plan.series.span(OpsRow,  { key: "press-jobs",   title: "Press jobs",          label: r => r.label,
        runs: r => r.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })) }),
    Plan.series.chart(OpsRow, { key: "press-util",   title: "Press · utilisation", label: r => r.label, layers: r => [Chart.Line(r.points, { x: p => p.week, y: p => p.pct })] }),
    Plan.series.table(OpsRow, { key: "press-sheets", title: "Press · sheets",      label: r => r.label, cells: r => r.nums }),
])
// a click on p03's utilisation row reports Plan.ref("press-util", "p03")
```

| Signature | Description | Example |
| --- | --- | --- |
| **Layout and nesting** | | |
| `series={[s1, s2, …]}` | The list is the layout: one block per series, top to bottom; a pick's list order is the same layout. | `planTargetState` |
| `children: (r, k) => r.children` | More of this series: a `RecursiveType` entry, to any depth. A parent's span bands (`rollup`, summed per quantity unit), heat `aggregate` (on its `scale`) or table subtotals (`aggregate`, `format`) derive from its subtree. | `planTableRows`, `planSpanRows`, `planHeatRows` |
| `children: Plan.children(of: (r, k) => Array \| Dict, series: Series[])` | A step down to a child collection of another type, laid out like a top-level list; an array of step-downs gives several collections, in order. | `planSeriesData`, `planGroupedRows` |
| `Plan.series.group(G, { key, title, label, children, summaryAggregate?, summary?, collapsed? })` **❗** | One strip per entry, its members the entry's children; the removed `by` form throws. | `planGroupedRows`, `planNarrow` |
| `rows.groupToDicts(($, r) => r.hall, ($, _r, k) => k)` | Grouping is a data step; a paged source is grouped in its dataflow. | `planGroupedRows`, `planFill` |
| `Plan.series.section(R, { key, title, collapsed?, meta?, value?, status?, summaryAggregate? }, members: Series[])` | A fixed titled block over series; it adds no path segment. | `planTargetState`, `planLibraryDnd` |
| `Plan.series.views(R, { key, title, match?, children?, collapsed? }, members: Series[])` **❗** | One row per member per entry, adjacent; the entry's children follow under the first view row, and a seek lands there. A member may not declare `children`. Its children may be more of its own entries (a bare accessor), each drawn as the members' rows; a span member's `rollup` rolls them up. | `planLibraryDnd`, `planFill` |
| `Plan.series.rows(R, { key, title }, [Plan.span({ key, label, rows? }), …])` | Hand-built rows as one block; a row's id is the series key plus the factory keys to it. | `planLiteralRows` |
| **Paged sources (#823)** | | |
| `data={paged}` — a `Data.bindPaged(…)` handle **❗** | Parents are the page unit: a window is N top-level entries with their whole subtrees, so nest children in the source and group a flat source in its dataflow. | `dataBindPagedPlan` |
| several series over one paged source | Each series is a block that pages on its own — its own bands and resident run — and one read of a window serves every block; a section's header and hand-built rows are fixed blocks, drawn once. | `dataBindPagedBlocks` |
| **Identity** | | |
| `Plan.ref(series: String, ...path: String[]): RowId` | A row's typed id, for links, `East.equal` in resolvers, and host tables keyed by `East.print(id)`. | `planSpanRows`, `planRowDrop` |
| `Plan.sectionRef(series: String, ...path: String[]): RowId` | A section header's id, at its parent's path. | — |
| `onSelect` / `expandRender` / `expandGutter`: `fn(Plan.Types.RowId)`; element refs, `onGroupToggle`, a drop (`Plan.Types.Drop`): `{ row: RowId, … }` | Every callback names a row by its id. | `planVariants`, `planExpand`, `planRowDrop` |
| series keys unique across the whole tree **❗** | A repeated key is a build-time error naming both series; a repeated run-time id draws a DUPLICATE ID row diagnostic. | — |
| **Window** | | |
| `Plan.axis({ window: { min, max }, … })` or `slice={{ slice }}` **❗** | The window is stated, or it is the bound slice's range. A canvas with neither is refused, and nothing fits the axis to the data. | `planTargetState`, `planNumberAxis` |

A paged canvas pages by parents, block by block (#823): a window holds its
entries whole, so every parent derives exactly, and each top-level series is a
block paging on its own over the same windows — the canvas draws exactly as it
does inline. Group a flat paged source in the dataflow that produces it, so a
group arrives as one entry holding its members.

Removed with #822: `groupBy` on span / heat / table; `Plan.series.group(R, {
by })` and the static `group(R, chrome, children)` form (use `section`);
`keyPrefix` / `keySuffix` (use `views`); numbered keys to force a layout
(order the series list); fit-to-data; and `Plan.pick`'s `data` counts.

#### Values, folds, one element callback and a bound ui state (#824)

A quantity is ONE value — the number, its unit and how it prints — so a bar's
caption and a rollup's total can never disagree. Values fold to the axis's
resolution: weekly cells on a MONTH axis show one cell per month per row, and
every cell builder, table series and chart layer says how (`fold`). Every
element click is one callback over the same ref the popover resolver receives,
and the interaction state can live with the host.

```tsx
Plan.run({ key: j.key, start: j.start, end: j.end, label: j.ticket, state: j.state,
    quantity: Plan.quantity(j.sheets, { unit: "k sheets", format: Format.Number({ maximumFractionDigits: 0n }) }) })
Plan.heatCells(r.load, { min: 0, max: 100, fold: "max", format: Format.Number({ maximumFractionDigits: 0n }) })

// The host holds what is selected, folded, opened and expanded; a write brings a row into view.
const ui = $.let(State.bind([Plan.Types.UiState], "ops.plan.ui", Plan.uiState({ collapsed: [Plan.ref("halls", "Hall 3")] })));
const goTo = $.const(East.function([Plan.Types.RowId], NullType, ($, id) => {
    const s = $.let(ui.read());
    $(ui.write(East.value({ selected: some(id), collapsed: s.collapsed, expanded: s.expanded, charts: s.charts, focus: some(id) }, Plan.Types.UiState)));
}));
// One callback for every element; a partial match answers only the arms it names.
const picked = $.let(State.bind([StringType], "ops.plan.picked", ""));
const onElementClick = $.const(East.function([Plan.Types.ElementRef], NullType, ($, ref) => {
    $.match(ref, {
        run: ($, r) => { $(picked.write(East.str`run ${r.run} on ${East.print(r.row)}`)); },
        link: ($, l) => { $(picked.write(East.str`link ${l.key}: ${l.from.run} → ${l.to.run}`)); },
    });
}));
// <Plan axis={axis} data={halls} series={series} ui={ui} onElementClick={onElementClick} />
```

| Signature | Description | Example |
| --- | --- | --- |
| `Plan.quantity(value: Float, { unit?: String, format?: Format.*, text?: String }): Quantity` | A run's or a link's quantity: its caption is `text`, else the value through `format`, then its unit; rollup bands sum it unit by unit. | `planSeriesData`, `planSpanRows` |
| `fold?: "sum" \| "mean" \| "min" \| "max" \| "last" \| "count"` | What a coarser bucket shows of a row's values in it: heat and weight `mean`, segments, table numerals and columns `sum`, lines and areas `mean`. One value in a bucket keeps its own instant, label and text. | `planFold` |
| `onElementClick: fn(Plan.Types.ElementRef) => Null` | Every element kind — run, event, mark, chip, cell, link — through one callback; the arm says which. | `planVariants` |
| `ui: State.bind([Plan.Types.UiState], key, Plan.uiState({ … }))` | The host's selection, folds, opens, expanded charts and a `focus` request the canvas spends; the user's actions are written back. | `planUiState` |
| `Plan.link({ key, from, fromRun, to, toRun, quantity? })` | A ribbon keyed for its click ref, weighed and captioned by its quantity. | `planSpanRows` |

Removed with #824: `qty` and the string `quantity` on a run (one
`Plan.quantity`); the span series' `unit` (a quantity carries its unit); the
five element callbacks `onRunClick` / `onEventClick` / `onMarkClick` /
`onChipClick` / `onCellClick` (`onElementClick`); a link's `label` (its
quantity's caption); and a group strip given both `summary` and
`summaryAggregate` (refused at build).

#### Every change is a draft (#880)

The Plan's editing session is the Sheet's (#879), over the source's TOP-LEVEL
entries. A review verdict, a dropped card and a moved or resized element are
gestures, never callbacks:
each drafts the entry its row came from — at any depth, since the whole
subtree rides in its entry — the canvas draws the draft at once by deriving
the entry's rows again, and Apply sends every draft as one checked batch. The
series says what a gesture writes; the root says where the batch goes.

```tsx
// A LIVE handle over the halls: the canvas reads it, and Apply writes it.
const halls = $.let(State.bind([DictType(StringType, Hall)], "ops.plan.halls", seed));
// The author's check over one drafted hall; a refusal names the press and holds Apply.
const ready = $.const(East.function([Hall, StringType], Editing.Types.Readiness, ($, hall, _key) => {
    const crowded = $.let(hall.presses.filter((_$, p) => p.jobs.size().greater(4n)));
    const result = $.let(variant("ready", null), Editing.Types.Readiness);
    $.if(crowded.size().greater(0n), ($) => {
        $.assign(result, variant("invalid", crowded.toArray((_$, p, k) => ({
            field: "jobs", message: East.str`${k} holds ${East.print(p.jobs.size())} jobs — at most 4`,
        }))));
    });
    return result;
}));
// Every gesture as it is made — a verdict, a drop, an undo.
const last = $.let(State.bind([StringType], "ops.plan.last", ""));
const onPatch = $.const(East.function([Plan.Types.PatchEvent(Hall)], NullType, ($, event) => {
    $(last.write(East.str`${event.origin.getTag()} · ${event.label}`));   // verdict · Approve P03
}));
<Plan axis={axis} data={halls} id="ops-plan" sources={["jobs"]}
    series={[Plan.series.span(Hall, {
        key: "halls", title: "Halls", label: h => h.name, runs: _h => [],
        // A gesture on a press writes back into its hall through this FIELD.
        children: Plan.children(h => h.presses, [
            Plan.series.span(Press, {
                key: "presses", title: "Presses", label: (_p, k) => k,
                runs: p => p.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
                review: { verdict: "approval" },            // Approve / Reject draft `approval`
                edit: {                                      // a dropped card joins `jobs`; a run moves and resizes
                    items: "jobs", key: "key", start: "start", end: "end",
                    create: (drop, p) => ({
                        key: East.str`${drop.from.key}-${East.print(p.jobs.size())}`, label: drop.from.key,
                        start: drop.at.unwrap("time"), end: drop.at.unwrap("time").addWeeks(2n),
                        state: variant("proposed", variant("added", null)),
                    }),
                },
            }),
        ]),
    })]}
    review={{ summary: <Text>SAVED · 2 PENDING</Text> }}
    editing={{ onUpdate: halls.write, onPatch, ready }} />
```

| Signature | Description | Example |
| --- | --- | --- |
| **What a gesture writes (on the series)** | | |
| `review: { verdict: F }` — `F` an `ApprovalStateType` field of the entry **❗** | Approve / Reject on a row draft the entry with `F` set, and the row shows `F` as its approval; Approve all / Reject all draft every row the canvas holds that takes a verdict, as ONE gesture. A misnamed field, or `approval` beside it, fails the build. | `planReview`, `planEditing` |
| `edit: { items: F, create: (drop: Plan.Types.Drop, entry, key) => Item }` — `F` an `Array<Item>` field; span / buckets / cards / events **❗** | A library card dropped on a row joins `F` as `create`'s item: `drop.from` is the card, `drop.at` the start of the bucket it landed in, on the axis arm. A misnamed field fails the build. | `planRowDrop`, `planEditing` |
| `edit: { items: F, key: K, start: S, end: E }` (span / cards) or `{ items: F, key: K, at: A }` (buckets / events) **❗** | A run, chip, tile or mark moves by its body, and a run or chip resizes by either end, with the pointer, a touch or the keyboard (#825). It moves in whole buckets; Shift moves one finer unit (a day under a week, an hour under a day, 15 minutes under an hour). Onto another row whose items are the same type, the item leaves its list for that row's, as one gesture over both entries. `K` is the item's `String` key field, since an element's key is its item's key — and its identity across every row it can move to: a row's list keeps its keys unique, so a card or a move that would repeat one is refused (⊘ while dragging); `S`, `E` and `A` are instant fields (`DateTime`; `Float` / `Integer` on a number axis; `String` on an ordinal one; `Plan.Types.Instant`). `create` becomes optional. A field a move cannot write fails the build. | `planEditing` |
| `children: r => r.kids` / `Plan.children(r => r.kids, …)` / `Plan.children(g => g, …)` **❗** | A gesture below an entry writes back through its `children`, so where a series below takes gestures they read a FIELD of the entry or are the entry itself; a computed collection fails the build. | `planEditing` |
| **The session (on the root)** | | |
| `editing={{ onUpdate: handle.write }}` with `data={handle}` **❗** | The inline adapter: Apply applies the batch with `Editing.apply` over the handle's latest `Dict` and writes it once — idempotent across retries. It needs the handle itself as `data`. | `planReview`, `planRowDrop`, `planEditing` |
| `editing={{ onApply: fn(Editing.Types.ChangeSet(R, K)) => Editing.Types.ApplyResult }}` **❗** | The host's transaction, sync or async, checked against the base the drafts began from. A paged source needs `revision` and `refresh`; the host applies atomically, dedupes by `requestId` and returns the committed revision. | — |
| `onPatch: fn(Plan.Types.PatchEvent(R)) => Null` | One call per gesture, and per undo, redo and discard. | `planEditing`, `planRowDrop` |
| `ready: fn(R, K) => Editing.Types.Readiness` | The author's check over a drafted entry: a refusal marks the rows the draft changed and holds Apply; a check that throws refuses its own entry only. | `planEditing` |
| `mode: "batch" \| "auto"` | Apply sends the batch (default), or each ready gesture goes at once. | — |
| `canDrop: fn(DragEventType) => Boolean` | Vets the event a drop where the drag rests would deliver — its `duplicate` whether Alt is held — showing the ⊘ stage, and again before it becomes a draft. A move is vetoed as the grammar's `move` or `resize` (#825), and a refusal is announced. | `planRowDrop`, `planEditing` |

- **Drawn where made.** A drafted entry's rows are derived again, exactly as
  Apply will leave them. A row the draft changed carries the Sheet's mark:
  pending, or incomplete / invalid while a check refuses its entry — each
  entry marked for its own issues. The narrow layout's cards carry the same marks.
- **One gesture, one transaction.** The history item ends the frame's toolbar:
  issues · Undo · Redo · Discard · Apply, and its status line. ⌘Z / Ctrl+Z
  undo; ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y redo.
- **The base is the source's.** An inline `Dict` is checked by its snapshot, a
  paged source by its revision. A batch against a source that moved is
  refused, never rebased: a banner says "Source changed — review or discard
  these drafts".
  An Apply whose outcome is unknown retries the SAME request ("Retry
  request"), and drafts retire only once the source reads back at the
  committed revision ("Applied — loading the confirmed revision…").
- **Paged.** Approve all covers the loaded rows, and its button says how many
  ("Approve 200 loaded").
- **Moves (#825).** A move along its row, or a resize, drafts the item's
  instants in place. A move to another row takes the item out of its list
  and appends it to the target row's, and a batch that takes an item and
  places it nowhere is refused whole. The row under the drag draws a landing
  band with the proposed span, and the ghost carries the element's label and
  span. The narrow layout takes no moves.
- **No session, no gesture.** Without `editing` the decision buttons are
  disabled, the toolbar has no batch and no history item, no card lands and
  nothing moves. Rerun changes no data, so it stays a callback.

Removed with #880: review `onApprove` / `onReject` / `onApproveAll` /
`onRejectAll` (a series' `review.verdict`) and the root's `onDrag` (a series'
`edit`). Each throws at build, naming its replacement.

#### Event kinds, read-only rows and links between events (#1191)

Beside `data`, a Plan takes event kinds over records — `Schedule`'s, the very
values a Calendar takes. `resources` are the rows; each kind in `events` is a
record of its own, bound with its patch mutation, and each of its events sits
on the resource it names. `rows` adds read-only rows: hand-built ones, and
series over a dataset with `Plan.over`. A link names an event by its kind and
key, never its row: a draft can move the event, and the link follows it.

```tsx
const presses = $.let(Record.bind(planPrintPresses, []));
const jobs    = $.let(Record.bind(planLinkJobs, [planLinkJobsPatch]));
const stock   = $.let(Data.bind(planLinkStock));
<Plan axis={axis}
    resources={{ presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall }) }}
    events={{ job: Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state", quantity: { field: "sheets", unit: "sheets" },
    }) }}
    rows={[Plan.over(stock, [
        Plan.series.table(PrintStock, { key: "stock", title: "Paper stock", label: s => s.name, cells: s => Plan.tableCells(weekly(s.weekly)) }),
    ])]}
    links={[Plan.link({ key: "covers", from: Plan.eventRef("job", "J-2001"), to: Plan.eventRef("job", "J-2002"),
        quantity: Plan.quantity(12000.0, { unit: "covers" }) })]} />
```

| Signature | Description | Example |
| --- | --- | --- |
| `resources: { [slot]: Schedule.resources(rows, { name, icon, label, … }) }` + `events: { [slot]: Schedule.events(Record.bind(r, [patch]), { name, icon, title, start, end \| at, resource: { field, of }, … }) }` **❗** | Event kinds over records, on the resources' rows, ahead of `data`'s. `resources` without `events`, or a `resource` naming a slot `resources` has not, fails the build. | `planEvents`, `planPrintWorks` |
| event kinds on `Plan.axis.number` / `Plan.axis.ordinal` **❗** | Refused at build, naming the axis and the kinds: an event is scheduled in time. An axis held in a variable is refused in the same words as the Plan is evaluated. | — |
| `data`, beside `events` or `rows` | Optional: a Plan of event kinds, or of `rows` alone, needs none. A Plan with no rows from any source fails the build. | `planEvents` |
| `rows: [Plan.chart({ …, pinned? }), Plan.over(…), …]` | Read-only rows after the event kinds' and `data`'s, each a fixed block; a pinned one sits under the ruler. | `planPrintWorks`, `planEventLinks` |
| `Plan.over(data: Dict \| Data.bind handle, series: Series[])` **❗** | Series over a dataset, read only: a series declaring `review` or `edit` fails the build, naming `Schedule.events`. | `planEventLinks` |
| `Plan.eventRef(kind: String, key: String): Plan.Types.RunRef` | An event for a link's end, wherever it draws; `Plan.link` takes it without `fromRun` / `toRun`. A link naming a kind `events` has not fails the build — or, when its kind is not known there (a list held in a variable or built in East, an event end held in a variable), is refused as the Plan is evaluated. | `planEventLinks` |
| `canDrop: fn(Schedule.Types.Candidate) => Option<String>` | An event kind's drop veto, its message on the ghost, as the Calendar's; a `fn(DragEventType) => Boolean` vets drops on `data`'s rows instead. | — |
| `applyMode: "batch" \| "auto"`, `date` | When the event kinds' drafts go, and the date brought into view first. | — |

Removed with #1191: `<Plan.View>` (`<Plan>`).

#### How event kinds draw (#1192)

Each resource kind is a block of rows, ahead of `data`'s. Every resource has a
row per way the kinds placed on it draw — bars, tiles, chips, marks, in that
order, kinds that draw alike sharing one — then its `measures`, each applied
to the resource's row. Its first row carries the resource's label, sub line,
value and status; the others name the kinds that draw that way. A kind with
`group` sits under its group strips, and one with `parent` nests each resource
under the one it names, to any depth, the parent's bars rolling its children's
up. Each element is an event in the window, wearing its kind's icon, its
lifecycle with its verdict shown (an approved proposal confirmed, a declined
one rejected), its quantity, its lane and its status's warning ring. A
reviewed kind's row carries its events' verdict in the decision column:
pending while any awaits a call, else rejected if any was declined, else
approved.

The rows are read over the window the canvas draws and the periods it lays
out beyond each edge, from the records as they stand, and read again when one
commits. A commit that changes none of them redraws nothing, and a read that
fails leaves the last rows standing and says why on the toolbar. Beside a
paged `data` they lead every window, drawn once.

| Signature | Description | Example |
| --- | --- | --- |
| a row's id: `entry { series: "<slot>.<draw>", path: [group?, …parents, key] }` | A resource's rows, by its kind's slot and the way they draw (`presses.span`, `presses.marks`). A measure row's id is the measure's key and the resource's path, a strip's `"<slot>.group"` and its group. Selection, collapse, links and focus address them. | `planPrintWorks` |
| an element's key: `East.print(Schedule.Types.EventRef { kind, key })` | Unique on a row the kinds that draw alike share; a popover, an element click and a link's event end name the event by it. | `planEventLinks` |
| the Unassigned rows: `entry { series: "<kind>.unassigned", path: [draw] }` | An event whose resource is none, or names one its kind does not have, draws on its kind's Unassigned row, after every resource kind. | — |
| `Plan.link({ from: Plan.eventRef(kind, key), … })` | The link meets the event wherever it draws: a bar's or a chip's end, a tile's bucket, a mark's instant. | `planEventLinks` |
| a resource kind no event kind is placed on, with no `measures` **❗** | Refused at build: it would draw no rows. | — |
| a key the event rows take (`<slot>`, `<slot>.<draw>`, `<slot>.group`, `<kind>.unassigned`) that a measure, a `data` series or a `Plan.over` series has **❗** | Refused at build, naming both: a row's id is its series' key and its path. | — |

#### The frame (#1193)

`<Plan>` renders in its builder frame wherever it is used: the toolbar, the
banners, the canvas in main and the footer, and the panes its props ask for —
the library with `library` (#1195), the inspector with `inspector` (#1197);
with neither there is no pane. It draws no border, so a host frames it or
places it bare.

| Signature | Description | Example |
| --- | --- | --- |
| the toolbar | Every control the Plan draws outside its canvas, one row at every width: the rail folds first, then the Plan's own steps; the review's buttons fold into one menu and the key search into its icon; the history item folds last. | `planTargetState`, `planEditing` |
| the banners | An Apply's conflict, a refusal, an unknown outcome with Retry, a source out of date with Discard; each leaves when what it reports does. | `planEditing` |
| the footer | The counts — the event kinds' events in the window, their backlog, the changes pending, the events to review, and the last save of an event kind's record — then the author's `footer` and the transport line. | `planPrintWorks` |
| `style={{ height: "fill" }}` / `maxHeight` | The whole Plan's: the canvas fills main and scrolls its own rows. | `planFill` |
| a host's height, and no `style.height` | The canvas fills main and scrolls there; a host that gives none lets it grow with its rows. | — |

Removed with #1193: the canvas's own toolbar row and its review foot (the
frame's toolbar holds their items), the Series button (the library pane's
Series tab, #1195) and the narrow layout's chip row (its items are the
toolbar's).

### The Sheet — `<Sheet>`

`<Sheet>` is the planning spreadsheet, and there is one: it renders in its
builder frame wherever it is used — one toolbar holding every control the
sheet has, the banners, the grid in main with its strip docked under it, and
the footer — and its panes are optional props: `library`, before the grid,
and `inspector`, after it. No prop, no pane. Its rows come from one of two
sources:

- `record` — an e3 record bound with its patch door: its entries, one entry's
  rows or groups, or a large record a window at a time. Apply is one patch
  commit through the record, and the footer gives the record's last save.
- `data` — the host's rows: an array, a whole-value bind handle (`State.bind`,
  `Data.bind`) or a paged source (`Data.bindPaged`). Edits reach the host
  through `onApply`, `onUpdate` and `onPatch`; with none of them the sheet is
  read only.

Its columns are typed — a date, a quantity with its unit, an integer, text, a
register lookup, reference or enum, a set of register members, a directed
`from > to` LINK between register members as a typed value, a stamped
read-only code, a custom parse / print pair — with a blank tail that invites
the next row, typed parsing with a docked candidate strip, a copilot that
fills cells and proposes whole rows from author East functions, a lens over a
bound slice's narrowing with saved-view tabs, drag and drop, Excel
round-tripping, and a key search over a paged source. Every change is a draft
of an editing session, checked as it is made and applied as one checked
batch. Where east-ui's `<Table>` displays rows, the Sheet is where a planner
types them: reach for it when the rows are authored in place and written back.

The tag and its authoring vocabulary — `Sheet.column.*`, `Sheet.register.*`,
`Sheet.driver`, `Sheet.link.*`, `Sheet.patch`, `Sheet.group`, `Sheet.subRows`,
`Sheet.library.*`, `Sheet.field`, `Sheet.apply`, `Sheet.Types` — come from
`@elaraai/e3-ui`, and the tags around it from `@elaraai/east-ui`. It moved
here from east-ui (#1179), and `<Sheet.View>` and `<Sheet.Builder>` are one
component now (#1216): a surface that wrote either writes `<Sheet>`, a
builder's `id` is its `name`, and the sheet fills the box it is given —
`style` holds only `gutterWidth`. Its words in React — `SheetMessagesProvider`
and `sheetMessages` — are `@elaraai/e3-ui-components`'.

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { Box, Reactive } from '@elaraai/east-ui';
import { Record, Sheet } from '@elaraai/e3-ui';
// Package side: export const jobs = e3.record("jobs", DictType(StringType, Job), new Map([…]));
//               export const jobsPatch = e3.mutation.patch(jobs);
<Reactive>{$ => {
    const record = $.let(Record.bind(jobs, [jobsPatch]));
    return (
        <Box height="560px">
            <Sheet record={record} columns={{
                task:  Sheet.column.text(Job, { header: "Task", width: "240px" }),
                start: Sheet.column.date(Job, { header: "Start", width: "96px" }),
                qty:   Sheet.column.quantity(Job, { header: "Qty", width: "96px" }),
            }} />
        </Box>
    );
}}</Reactive>
```

```
<Sheet record={Record.bind(r, [patch])} | data={rows} id="id" columns={{ start: Sheet.column.date(Row, {…}), qty: Sheet.column.quantity(Row, Driver, {…}), … }} library?={[…]} inspector? /> — the planning SPREADSHEET in its builder frame: typed columns over its rows (date · quantity + unit · integer · text · register lookup / reference / enum · a set of register members · a directed `from > to` LINK between register members as a TYPED value · stamped read-only codes · a custom parse / print pair), a blank tail that invites the next row, typed parsing with a docked candidate strip (nothing ever floats over the grid), a copilot that fills cells and proposes whole rows from author East functions, a lens over a bound slice's narrowing (hits keep their row numbers, the rest collapse into context bands) with saved-view tabs, drag and drop, Excel round-tripping, and a key search over a paged source. Declared the way east-ui's Table and the Plan are: every per-row fact is an accessor, the builders take the row type FIRST, and nothing at the author's side is addressed by a string name
├─ The frame: ONE toolbar holding every control the sheet has, in this order — the view tabs, the context switch, the match count, the key search, the slice's rail, the scope badge and the history item (a sheet with none of them, read only with no slice, has no toolbar); the banners — an Apply's conflict naming its rows and who changed the record last, a refusal with its reason, an unknown outcome and a failed confirmation read each with Retry, the out-of-date notice with Discard, and an `entry` the record does not hold; main — the grid, filling the room the panes leave and scrolling its own rows, the strip docked under it; the footer — the sheet's, and over a record its last save. ⌘Z undoes and ⇧⌘Z / ⌘Y redo from anywhere in the frame; a field being typed into keeps its own undo. The sheet fills its parent and draws no border: give it a box of its own height
├─ Rows — ONE of two sources (both, or neither, is refused):
│   ├─ record — `Record.bind(r, [e3.mutation.patch(r)])` over a `Dict` record: its entries are the rows, in key order, each row's id its key's text (any key type: a non-String key by its `.east` text). `window={Data.bindPaged(r)}` reads the same record a window at a time. `entry={{ key, rows: F, id: I }}` is one entry's Array field `F`, in its own order, each row identified by the `String` field `I`; each entry keeps its own drafts, and a key the record does not hold opens empty and read only, named in a banner. With `group`, the entry's field holds groups, or `Sheet.Types.Entry(P, "lines")` entries with loose rows between them (`id` then names a field of both types); a record of groups is grouped the same way. Apply is ONE patch commit, checked against what each row was when its edit began, confirmed by the rows the record reads back. Over a record `id`, `onApply` and `onUpdate` are refused (the record identifies and commits its rows); `entry` and `window` need a record
│   └─ data — the host's rows: an `Array<R>` value / expression or a `$.let`-bound whole-value handle (`State.bind` / `Data.bind`) for the INLINE arm; a paged source for a WINDOWED arm — a `$.let`-bound `Data.bindPaged(…)` handle, recognised by its East type: `pinned` when it names its snapshot, which `onApply` needs, `paged` when it is the shape a UI exported before `revision` / `refresh`, which names none — positional (`Array<R>` windows) or keyed (`Dict<String, R>` windows; the key is the row id). When a pinned source's `revision()` moves (`Data.bindPaged` follows each write to its dataset), the sheet re-reads its resident windows at the new snapshot IN PLACE: the rows on screen stay until theirs land (no remount, no empty frame), the scroll position and row heights hold, and a standing key search is cleared. A failure stays where it happened: a window the source cannot read is ONE band where its rows would be — the elements it covers, the reason and a Retry — while the windows around it keep working and the rows after it keep their numbers; a `total()` or `revision()` that throws is said on the footer's transport line with a Retry while the rows stay; only a source that fails before anything lands replaces the grid, with a Retry. A row that throws while it draws is a one-row diagnostic. A `Dict` inline is refused (a sorted map would sit rows in key order, not the planner's) — a record's entries come through `record`. `id` (required on a positional source) names the `String` field that identifies a row; over entries of groups and loose rows, a field of BOTH types
├─ Props:
│   ├─ columns (required) — keyed by the row's fields and checked per key (a key that is not a field, a date under a `String` field, a builder over another row type: type errors): Sheet.column.text(R, cfg) · date(R, { base?, format?, level?, actual? }) — the common date field (`dd / mm / yyyy` segments); pasted text takes the B§3 grammar (`+3d`, `4d` from `base`, `fri`, ISO, `d/m[/yy]`); `level: r => …` reads each row's date at a Sheet.Types.DateLevel ("week" | "day" | "range" | "time" — no shifts: a host with shifts uses a `custom` kind) and `actual: r => Option<DateTime>` is when the work really happened (the cell then prints it with its difference, the wanted date becoming the cell's detail) · quantity(R, cfg) or quantity(R, D, { uom: d => d.uom, format? }) — a float with the DRIVER row's unit in the common number field, in the viewer's language (#852): the cell groups (1,234.5 — German 1.234,5; through `format` when declared), the edit box and copy are bare (1234.5 — German 1234,5), typed and pasted text reads the viewer's separators (pasted `1.2k` / `1.2m`, German `1,5k`, still parse; a typed quantity rounds to a whole number), and ⏎ on an unchanged edit box writes nothing · integer(R, cfg) · lookup(R, { options? }) — the DRIVER column only (scored candidates from its register) · reference(R, register, cfg) — a lookup over a flat member list · enum(R, register, { options? }) — an upper-cased register word with a valence dot · set(R, register, { members?, multiple?, store? }) — comma members, the link grammar without an arrow · link(R, D, register, { to? | from?, members, multiple?, sides?, arity?, check?, store?, options? }) — `from > to`, the split cell; `members: [{ kind, identified?, countable?, resolvesTo?, ranged? }]` — `ranged` offers and prints runs of consecutive codes as one range. `options` (enum / lookup / link) is fn(Sheet.Types.DraftContext(R, D)) => Option<Array<String>> — the member keys the row is OFFERED (`none` = the whole register; typed text still resolves against the whole register) · stamped(R, { owner? }) — read-only, skipped by paste and clear · custom(R, { accepts, parse, print }) — an author parse / print pair over the field's payload. Every kind takes { header, sub, width, editable?, fill?, detail? } (`header` + `sub` are the two header lines; `fill` = providers, the first that yields wins; `detail: r => String | Option<String>` is the text the hover and the strip show beyond the value); text / date / quantity / integer also take `value: r => …` for a derived READ-ONLY projection on any field. A set / link column sits on a `Sheet.Types.Link` field, an `Array<Sheet.Types.Member>` field (the other half named by `to` / `from`), or a `String` field the grammar parses on read and prints on commit per `store` ("asTyped" | "canonical" — the register's labels)
│   ├─ group (optional) — Sheet.group(P, "lines", { title, sub?, cells?, folded?, noun? }): the rows are GROUPS whose lines live in one `Array<L>` field; `columns` are declared over `L`; `cells` = band cells (Sheet.group.cell.*) keyed by the line column they sit under; `noun: { singular, plural }` is the word the renderer prints for a group (omitted, the sheet says its own in the viewer's language — "group" / "groups" in English, #861). LOOSE rows between the groups (#846): rows of Sheet.Types.Entry(P, "lines") entries — each `variant("group", P)` or `variant("row", L)` — and a row entry draws as a plain row: no band or rail, numbered in the groups' sequence, its own cells. The seam above a band or beside a loose row inserts a loose row (a line's seam and a group's blank line still insert a line); loose rows delete, paste and count on their own ("2 groups · 3 lines · 3 loose rows"), fold-all passes them by and no band sticks over them. A new line there gets its `id` field minted unless `newRow` supplies one; drafts, checks and the change set carry the entry (a draft is `variant("group", …)` or `variant("row", …)`, a loose row's DraftContext has `group: none`)
│   ├─ subRows (optional) — Sheet.subRows(R, { arrayField: (item, row) => Sheet.subRow({ code?, name, chips?, facets?, id? }) }): READ-ONLY rows under each line (a flat row) that share none of its columns — keyed like `columns` by the array fields of the type the columns are built over (a grouped sheet: the line type), key order = display order; `facets` is a label → String | Option<String> record (a `none` drops out); the renderer owns the tree, the `{line}.{n}` index, folding and search
│   ├─ driver (optional) — Sheet.driver(column, rows, { key, label, aliases?, meta? }): the `lookup` column whose member decides what the row does; its rows are the register and its row type `D` is what a quantity's `uom`, a link's `sides` and every copilot function (`ctx.driver`) read
│   ├─ registers (optional) — { name: Sheet.register.members(rows, { kind, key, label, aliases?, meta?, parent?, tone? }) | Sheet.register.concat([…]) }: the lookup tables reference / enum / set / link columns resolve against; accessors receive `(value, key)` (a `Dict<String, T>` register reads its key as the second argument; an Array's key is its index); duplicate keys fold, first wins — so a family kind ("CNC router" from every router) declares one member per distinct value
│   ├─ owned (optional) — accessor r => Bool: rows the upstream system owns — no copilot, stamped columns read-only
│   ├─ suggest (optional) — { ahead?, triggers?, ghost?, propose: [fn] }: the copilot's row proposers — East functions (sync, or async for a model call) over Sheet.Types.DraftContext(R, D) — current draft row and neighbours, rowIndex, driver: Option<D> and today; draft fields are missing | value(T) | invalid(String), so guard with hasTag("value") before unwrap("value") — returning Array<Sheet.Types.Proposal(R)> ({ patch: Sheet.patch(R, { … }), meta }); a column's `fill` providers are the same shape returning Option<Sheet.Types.Fill(T)> ({ value, meta }). The first that yields wins; fills CHAIN in column order (a later column sees the earlier fills as if taken); an async one shows a pending chip in the strip and the newest context wins; a rejected fill / proposal is remembered for the session
│   ├─ slice + affordances (optional) — bound slice chrome on the toolbar (default ["search"]; filter / cohort allowed; brush / legend / breakdown refused — no axis, no series): the sheet NEVER narrows — it draws the narrowing as the LENS: hits keep brand row numbers, ±0 / ±1 / ±3 context rows show either side, the rest collapse into bands whose pill opens 1 · 3 · 10 · all rows at a time, the count reads `n matches · m context`, no blank tail. The lens matches every declared column, the ones a viewer hid too. A Link column is searched through `Slice.config`'s `text` projection (`stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) }`); a field the slice narrows on must be a COLUMN of the sheet. Over a paged source the lens is scope-badged "loaded rows only" and a keyed source's `search` becomes a KEY SEARCH over `seek` (the jump rebases residency and, once the match's window is in, lands the ring on the match and scrolls to it — until then the jump owns the viewport, so a scroll report from where the sheet was cannot undo it; a match whose window cannot be read shows its failed band instead). The ring, a range and an open editor stay on their rows as windows land around them
│   ├─ views / activeView (optional) — `views` is a whole-value bind handle of Array<Sheet.Types.View> (`State.bind` keeps them per viewer, `Data.bind` shares them): saved views = slice-state snapshots plus the lens's context and reveals, evaluated live as TABS — the pinned whole-sheet tab, `+ TAB` snapshot (named from the query), live match counts, the dirty dot when the slice drifts from the tab, ⏎ update / esc revert, × or middle-click close, double-click rename, drag reorder; every change lands at once and is written back through the handle (`onViewsChange` is refused); `activeView` opens a tab and is followed when the host moves it
│   ├─ onUpdate (optional, `data` only, INLINE arm) — fn(Array<R>) => Null over a LIVE data bind handle: reads the latest collection, checks the batch base and writes the complete result once. Hidden fields survive. Pass data={rows} and onUpdate={rows.write}; a captured array is refused for this adapter
│   ├─ onPatch / onApply (optional) — onPatch: fn(Sheet.Types.PatchEvent(E)) => Null observes one draft gesture including incomplete values (either source); onApply (`data` only): sync/async fn(Sheet.Types.ChangeSet(E)) => Sheet.Types.ApplyResult persists a complete checked batch. Paged writes require revision/refresh, atomic host application and request-id deduplication
│   ├─ applyMode (optional) — "batch" (default: the history item's Apply sends the batch) | "auto" (each ready gesture goes at once, through the same acknowledgement path)
│   ├─ newRow / newGroup / ready (optional) — newRow: fn(NewRow) => Patch(R) supplies defaults, including hidden fields; newGroup: fn(NewGroup) => Patch(G) a new group's; ready.row: fn(Draft(R), DraftContext(R, D)) => Readiness adds business rules; ready.group: fn(DraftGroup(G, "rows")) => Readiness checks grouped drafts. Required fields and valid parsing are always checked; optional absence becomes none
│   ├─ edits (optional) — insertRows / removeRows gate structure independently of cell edits; insertGroups / removeGroups require grouping. moveRows: "none" | "within" | "between" and moveGroups say what a grip may move. Keyed top-level creation uses key order; positional insertion uses gutter buttons, the selection strip or Alt+Insert / Alt+Shift+Insert
│   ├─ onSelect / selection (optional) — the ring reported as { rowId, line, key }; give `selection` and the ring is CONTROLLED (follows the value, scrolls into view, every move still reports)
│   ├─ newRowId (optional) — fn() => String minting inserted rows' ids (else the renderer mints one); over a record keyed by a non-String key, the new row's key as its `.east` text — required there unless `edits` inserts no row
│   ├─ readOnly / blanks / density (optional) — the whole sheet read-only · padding rows below the last real one (default 18; typing into one INSERTS a row after the last real one — blanks are padding, never rows) · row rhythm
│   ├─ footer (optional) — [{ text, tone? }] counts; a paged source adds the transport line ("N loaded of M · Loading…")
│   ├─ style (optional) — { gutterWidth } — the sheet fills the box it is given and scrolls its own rows there
│   └─ name (optional) — names the sheet when a surface holds two: its panes' open tab and collapsed state, the columns a viewer hides, its library's drag source and its drop target are kept under it
├─ Panes — optional props, each its own; the examples show every combination (none, a library, an inspector, both):
│   ├─ library (optional) — the start pane's tabs, in order, each a `Sheet.library.*` call: `rows()` — the templates, by their group, each card saying what it sets; `columns()` — the declared columns, each with its kind and an eye that hides it from the grid per viewer (the last shown stays; the lens still matches a hidden one; a sheet whose library lists no Columns tab hides none); `tab(data, { name, icon?, key, label, meta?, group?, drop? })` — the author's own cards from an Array or a `Dict<String, T>` (its key the accessors' second argument), searched by key, label and meta; `drop: (row, key) => Sheet.patch(R | G, …)` sets a row's fields where a card lands, or a band's when the patch is over the group type. Left out, or empty, no library pane (SB59). Collapsed, the pane is a rail with the templates' count
│   ├─ templates (optional) — { rows?: [{ key, name, group?, values: Sheet.patch(R, …) }], groups?: [{ …, values: Sheet.patch(P, …) }] }: the Rows tab's cards; a dropped card is `newRow`'s (`newGroup`'s) defaults with the template's fields over them; a key repeated, or a group template on a flat sheet, is refused
│   ├─ inspector (optional) — given alone (`inspector`, `inspector={true}`): the end pane's Details shows the selected row's every field — through its column's kind, or by its type (a field no column shows included) — tinted where it differs from what the source holds, each edit ONE transaction; several rows selected, a column set across them as one step; a band, the group's own fields, Add line, Duplicate and Delete with its lines; Issues lists the batch's issues by row, each going to its cell (over a paged source, sought by its key). `inspector={East.function([R, FunctionType([R], NullType)], UIComponentType, ($, row, update) => …)}` — the author's own Details for a complete row (SB58), passed through untouched and called where Details draws; `update(edited)` is one transaction; a row whose draft is still incomplete shows the form. With nothing selected, Details counts the rows, the pending drafts and the issues, and over a record says the last commit and who made it. Left out, no inspector pane
│   └─ fields / groupFields (optional, with `inspector`) — the inspector form's hints by field — `Sheet.field.*`, east-ui's `Fields`: a label, a help line, an editor, read only or hidden; a column's kind is its field's default (SB10). Given without an inspector they are refused
├─ Drag and drop: a template lands on the seam it is dropped on — a row beside a row, a line in the group under the pointer, a group between groups, or, on a keyed source, where its key sorts; an author's card sets its patch's fields on the row or band it lands on; a row's, a line's or a band's grip moves it, as `edits` allows (a keyed source's rows and groups have no grip). The ghost's caption says where, and turns red where a drop is refused; ⏎ on a card does what a drop below the ring would; each drop is one transaction. On a coarse pointer a frame too narrow for the touch gutter beside the first column folds it (#1215): each row's actions go into one 44px row-actions button — the row's grip and its menu
├─ Keyboard (B§6): arrows / ⇧arrows (↓ on the last row appends — not under a lens or an unexhausted paged source) · ⇥ / ⇧⇥ walk the copilot's fills, then take rows, then move · ⏎ takes the next suggestion, else edits with the value selected (F2 too); a printable key seeds a fresh edit · ⌘⏎ fills the row (one undo step), ⌘⇧⏎ takes everything · esc ladder, one rung per press: editor → chip selection → selected proposal → row fill → every suggestion → range → dirty tab revert → the whole sheet · ⌫ clears cells (never a stamped one) or deletes whole selected rows · ⌘C / ⌘V round-trip with Excel (a link cell as two columns) · ⌘/ and ⌘F focus the search in the toolbar. In a link editor: `,` resolves a member, `>` hops From → To, ⇥ takes the ghost → a predicted chip → hops → commits right, ⌫ pops the last chip
├─ Localization (#861): every word the sheet says itself — the toolbar and the view tabs, the header, the rows, bands and gap pills, the strip and the editor, the footer and the history item, the banners, the panes, the insertion chips, and the message each gesture leaves — comes from ONE typed message table, its counts in the LOCALE react-aria's `<I18nProvider locale="de-DE">` sets (the browser's language otherwise). Host React code overrides any subset of the words for a subtree with `<SheetMessagesProvider messages={GERMAN}>` (@elaraai/e3-ui-components; `sheetMessages` is the English table — each message a function of named, already-formatted parameters, plus the raw `n` for plurals; define the overrides ONCE, not per render — providers nest). The message a gesture leaves is kept as data and worded as it shows, so a new table re-words it. What the AUTHOR wrote is data and never translated: headers and subs, a group's `noun`, register labels and metas, lock tags, footer items, library tab names; the date and link GRAMMARS keep their forms (day-first dates, `TBC`, `N x kind`), and the issues a patch event carries to the host stay in English (the sheet shows them in its words)
└─ Factories:
    ├─ Sheet.column.text / date / quantity / integer / lookup / reference / enum / set / link / stamped / custom(R, …) — the column builders (see `columns`); Sheet.driver(column, rows, accessors) — the driver; Sheet.register.members(rows, accessors) / Sheet.register.concat([…]) — registers
    ├─ Sheet.link.parse(text, members) / Sheet.link.print(link) — the link grammar as East functions (`R2140, Bay 2 > 4 x CNC router`: codes and aliases, ranges `R2140-45`, counted `N x kind`, `TBC`, free text kept as a `text` member — never a refusal) · Sheet.link.arity(half, implied) — how many members a half should hold, `implied: fn(Context(R, D)) => Option<Sheet.Types.Counted>` (the strip reads "n × kind implied · k named") · Sheet.link.check.exists() and author checks fn(Sheet.Types.CheckContext(R)) => Option<String> — a `some(message)` FLAGS the member (warn chip + title), never blocks
    ├─ Sheet.patch(R, { field: value, … }) — a row patch (omitted fields `none`): a proposal's row, where the runner writes only the fields with editable columns, a template's values, a card's drop, or the explicit defaults `newRow` / `newGroup` return for a new row, hidden fields included (a field left `none` starts missing)
    ├─ Sheet.subRows(R, sources) / Sheet.subRow({ code?, name, chips?, facets?, id? }) — sub rows (see `subRows`); a left-out `code` / `id` is "", `chips` / `facets` []
    ├─ Sheet.library.rows() / columns() / tab(data, config) — the library's tabs; Sheet.field.* — the inspector's hints (east-ui's `Fields`)
    ├─ Sheet.apply(E, idField) — the checked batch applier as an East function: fn(entries, Sheet.Types.ChangeSet(E), revision: Option<String>) => Sheet.Types.Applied(E) — the base (snapshot or revision) is checked first, then the whole batch applies or none of it does (`conflict` says why); `E` is the row struct or a Sheet.Types.Entry(G, "rows") union of groups and ungrouped rows. Request deduplication stays with the host's `onApply`. It IS east-ui's shared `Editing.apply` (#879); a keyed Dict source applies with `Editing.apply(DictType(K, E))` — entries addressed by key, placed `keyOrder`
    └─ Sheet.Types.DraftContext(R, D) / Draft(R) / Fill(T) / Patch(R) / Proposal(R) / PatchEvent(E) / ChangeSet(E) / Applied(E) / Entry(G, "rows") / ApplyResult / Readiness / CheckContext(R) — typed contracts for providers, drafts, checked application and checks; grouped contexts use (G, "rows", D). The transaction and draft types are east-ui's shared editing contract's (`Editing.Types.*`, #879) under their Sheet names — the same values. Sheet.Types.Link / Member / Cell / Row / Line / SubRow / Facet / DateLevel / Noun / View / Selection / Counted / Sides / RegisterMember are shared value and wire types.
```

#### Drafts and checked application

The row's `StructType` defines completeness, including fields without columns.
Columns define editing and parsing. Missing optional fields normalize to `none`;
missing required fields and invalid text block the entire batch. Optional
`ready.row` / `ready.group` business rules cannot bypass these automatic checks.

```tsx
<Sheet data={jobs} id="id"
    columns={{ task: Sheet.column.text(JobType), qty: Sheet.column.integer(JobType) }}
    onUpdate={jobs.write} />
```

Here `jobs` is a live `State.bind` or `Data.bind` handle over `ArrayType(JobType)`.
`onUpdate` reads the latest collection when applying, checks the original batch
base and writes once. Use `onPatch` for a journal of individual gestures,
including incomplete drafts, and `onApply` for host transactions. A paged host
must atomically check its revision, deduplicate the request id and return the
committed revision. An append-only journal is not an application acknowledgement.
An unknown outcome retries the same frozen request.

A record's rows are `record`'s: the sheet reads them and commits through the
record's patch door, every example sheet that writes is bound this way (#1180).
Rows that are the host's but kept in an e3 record — one entry's Array field,
read and shaped before the sheet sees them — commit through `Record.onApply`
over that entry's rows:

```tsx
// Package side: export const plans = e3.record("plans", DictType(StringType, Plan), new Map([["week", { jobs: [] }]]));
//               export const plansPatch = e3.mutation.patch(plans);
const record = $.let(Record.bind(plans, [plansPatch]));
const jobs = $.let(record.read().get("week").jobs);
const onApply = $.const(Record.onApply(record, {
    entry: "week",
    get: East.function([Plan], ArrayType(JobType), (_$, plan) => plan.jobs),
    set: East.function([Plan, ArrayType(JobType)], Plan, (_$, _plan, next) => ({ jobs: next })),
    idField: "id",
}));
<Sheet data={jobs} id="id" columns={{ /* … */ }} onApply={onApply} />
```

The batch is checked against the rows the edit began from, and the patch
reaches the entry's rows and nothing else of it; groups, and entries of groups
and loose rows, commit the same way. A record's own entries as the rows,
`Record.onApply(record)`, page in key order instead (`recordSheetApply`).

The transaction contract is every editable collection's, not the Sheet's alone
(#879): east-ui's `Editing.apply` and `Editing.Types.*` — `ChangeSet`,
`PatchEvent`, `Readiness`, `Origin`, `Draft`, `Entry` and the rest — are the
very values `Sheet.apply` and `Sheet.Types.*` name, and the Plan's session is
the same one: a gesture's `origin` names its `resize`, `drop` and review
`verdict` too. A keyed `Dict` source applies with
`Editing.apply(DictType(K, E))`: each change names its entry by key (a
`String` key as it is, any other key by its `.east` text), and a new entry is
placed `keyOrder`. The east-ui skill documents the contract.

**Draft and editing contracts**

| Signature | Description | Example |
| --- | --- | --- |
| `Sheet.Types.Draft(R)` | Each field is missing / value(T) / invalid(String). | `sheetWeeks` |
| `Sheet.Types.DraftContext(R, D)` | Current draft row, neighbours and optional driver; grouped overload `(G, "rows", D)`. | `sheetWorkshop` |
| `newRow: fn(NewRow) => Patch(R)` | Explicit defaults for newly inserted drafts, including required hidden fields. | `sheetBatches` |
| `ready.row: fn(Draft(R), DraftContext(R)) => Readiness` | Synchronous business checks alongside mandatory schema checks. | `sheetWeeks` |
| `onPatch: fn(PatchEvent(E)) => Null` | Draft contents, placement, origin and readiness once per gesture. | `sheetWeeks` |
| `onApply: fn(ChangeSet(E)) => ApplyResult` | Complete checked batch; supports async callbacks and safe retries. `Record.onApply` commits it to an e3 record. | `sheetVariants`, `recordSheetApply` |
| `Sheet.apply(E, "id")` | Applies a checked batch to a collection: the whole batch, or a conflict saying why. | `sheetApplyBatch` |
| `Editing.apply(E, "id")` / `Editing.apply(DictType(K, E))` | The shared applier (#879) — an Array by its identity field, or a keyed Dict by key (`Editing.Types.ChangeSet(E, K)`). | `editingApplyBatch`, `editingApplyKeyed` (east-ui) |
| `Sheet.Types.Entry(G, "rows")` | Groups with their rows beside ungrouped rows, as one union; `Sheet.apply`, `DraftEntry` and `PatchEvent` take it. | `sheetApplyEntries` |
| rows of `Sheet.Types.Entry(G, "rows")` + `group={Sheet.group(G, "rows", …)}` | Loose rows between the groups: a row entry is a plain row of the line type; `id` names a `String` field of both types. | `sheetLoose` |
| `edits: { insertRows?, removeRows?, insertGroups?, removeGroups?, moveRows?, moveGroups? }` | Structure permissions; group flags require grouping; keyed top-level movement is refused. The grips move rows, lines and groups as these allow. | `sheetPaged`, `sheetBatches` |

Providers receive drafts: test `field.hasTag("value")` before reading
`field.unwrap("value")`. They can fill a row before its remaining fields are
complete. Constructors can supply hidden fields; copilot patches target editable
columns. Typing, paste, fill, drops and accepted suggestions share the
transaction path and Undo/Redo.

#### Sub rows and column rules

Sub rows show a line's own records (operations, bookings) without giving them
columns; column rules say what a cell offers, how deep a date reads, and what a
cell says beyond its value. Rule accessors (`level`, `actual`, `detail`) run in
the row projection, so they follow the host's rows, not an open edit.

| Signature | Description | Example |
| --- | --- | --- |
| `subRows={Sheet.subRows(L, { field: (item, row) => Sheet.subRow({…}) })}` | Read-only sub rows per array field, in key order; a variant source matches arm by arm. | `sheetBatches` |
| `Sheet.group(P, "lines", { title, noun: { singular, plural } })` | The host's word for a group; omitted, the sheet says its own in the viewer's language. | `sheetBatches` |
| `options: fn(DraftContext(R, D)) => Option<Array<String>>` | enum / lookup / link: the members a row is offered; `none` = all. | `sheetWeeks` |
| `date(R, { level: r => DateLevel, actual: r => Option<DateTime> })` | Read the date at the row's level; print the actual once it happened. | `sheetWeeks` |
| `detail: r => String \| Option<String>` | Text the hover and the strip show beyond the cell's value. | `sheetWeeks` |
| `members: [{ kind, identified: true, ranged: true }]` | Offer and print runs of consecutive codes as one range. | `sheetWeeks` |

#### The rows, the panes and the frame

| Signature | Description | Example |
| --- | --- | --- |
| **The rows** | | |
| `record: Record.bind(r, [e3.mutation.patch(r)])` **❗** | A `Dict` record bound with its patch door; its entries are the rows, in key order. | `sheetBasic` |
| `window: Data.bindPaged(r)` **❗** | The same record's entries, a window at a time; never with `entry`. | `sheetPaged` |
| `entry: { key, rows: F, id: I }` **❗** | One entry's Array field `F`, in its own order; `I` a `String` field of its rows. | `sheetWeeks` |
| `entry` + `group: Sheet.group(P, "lines", …)` | `F` holds groups, or `Sheet.Types.Entry(P, "lines")` entries, loose rows between the groups. | `sheetBatches`, `sheetLoose` |
| `group` over the record's entries | Each entry a group, its lines its Array field. | `sheetWorkshop` |
| `data` + `id` (+ `onApply` / `onUpdate`) | The host's rows: an array, a bind handle or a paged source. | `sheetVariants`, `sheetStress` |
| `record` with `data`, or neither; `id` / `onApply` / `onUpdate` over a record; `entry` / `window` with `data` **❗** | Refused, naming the prop and the fix. | — |
| **The panes** | | |
| `library: [Sheet.library.rows(), Sheet.library.columns(), Sheet.library.tab(data, { name, key, label, drop?, … })]` **❗** | The start pane's tabs, in order; none, no pane. A tab's `drop` patch over the row type lands on rows, over the group type on bands. | `sheetLibrary`, `sheetWorkshop` |
| `templates: { rows?: [{ key, name, group?, values: Sheet.patch(R, …) }], groups?: […Sheet.patch(P, …)] }` **❗** | The Rows tab's cards; a key repeated, or a group template on a flat sheet, is refused. | `sheetWorkshop`, `sheetBatches` |
| `inspector` | The end pane: Details for what is selected, its every field, and Issues. | `sheetWorkshop`, `sheetBatches` |
| `inspector: fn(R, fn(R) => Null) => UIComponentType` **❗** | The author's own Details for a complete row; a row still missing a field shows the form. | `sheetWeeks` |
| `fields: { f: Sheet.field.readonly() \| Sheet.field.hidden() \| … }` / `groupFields` **❗** | The inspector form's hints, by field; refused without an inspector. | `sheetWorkshop`, `sheetBatches` |
| **The frame** | | |
| `views: State.bind([ArrayType(Sheet.Types.View)], key, [])` **❗** | The saved views, as a bind handle; `onViewsChange` is refused. | `sheetWorkshop`, `sheetStress` |
| `name: String` | Names the sheet when a surface holds two; its panes' state, the columns hidden, its drag source and its drop target follow it. | every example but `sheetBasic` |

Removed with #1216: `<Sheet.View>` and `<Sheet.Builder>` (both `<Sheet>`), a
builder's `id` (`name`), `onViewsChange` (`views` is a bind handle) and
`style.height` / `maxHeight` (the sheet fills its box).

## Rendering surfaces in an app — `<E3Provider>`

A deployed `ui()` task renders in a React app through
`@elaraai/e3-ui-components`. `<E3Provider config>` says which e3 the app talks
to, and how its requests reach it. `<ReactiveDatasetProvider>`, inside it,
installs the adapters `Data.bind`, `Data.bindPaged`, `Func.bind` and
`Record.bind` resolve through, for the config's workspace, and renders its
children once they are in. `<UITaskPreview task>` fetches a `ui()` task's
output and renders it, preloading what its manifest reads and polling it.

| `E3Config` | Meaning |
|---|---|
| `apiUrl` | **required** — the e3 API's base URL |
| `repo` | the repository; `"default"` when omitted |
| `workspace` | the workspace the bindings read and write |
| `token` | a bearer token, or `null`; every request reads it afresh, so it may rotate |
| `fetch` | the `fetch` every request goes through (`RequestOptions.fetch`), the global one when omitted. A host that answers e3's API itself gives its own: an e3 running in the page. It may change, as the token may |

`E3Provider` also takes a `queryClient`, to share a TanStack Query cache with
the app; it makes its own otherwise.

Over an e3 running in the page (e3-web: the **e3** skill), `apiUrl` and
`fetch` are the ones `createWebE3` gives, and no request reaches the network:

```tsx
// main.tsx — a deployed ui() task, every request it makes answered in the page
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { system } from '@elaraai/east-ui-components';
import { E3Provider, ReactiveDatasetProvider, UITaskPreview } from '@elaraai/e3-ui-components';
import { createWebE3 } from '@elaraai/e3-web';

const e3 = await createWebE3(new Worker(new URL('./e3.worker.ts', import.meta.url), { type: 'module' }));

createRoot(document.getElementById('root')!).render(
  <ChakraProvider value={system}>
    <E3Provider config={{ apiUrl: e3.apiUrl, repo: 'default', workspace: 'main', fetch: e3.fetch }}>
      <ReactiveDatasetProvider>
        <UITaskPreview task="dashboard" />
      </ReactiveDatasetProvider>
    </E3Provider>
  </ChakraProvider>,
);
```

## Key Patterns

### Staged commit / discard

```tsx
<Reactive>{$ => {
    const t = $.let(Data.bind(threshold, { mode: 'staged' }));
    const value = $.let(t.read());
    const commit  = $.const(East.function([], NullType, $ => { $(t.commit()); }));
    const discard = $.const(East.function([], NullType, $ => { $(t.discard()); }));
    return (
        <VStack gap="3">
            <Slider value={value} min={0} max={100} onChange={t.write} />
            <HStack gap="2">
                <Button variant="outline" onClick={discard}>Discard</Button>
                <Button variant="solid" onClick={commit}>Apply</Button>
            </HStack>
            <Diff bindings={[t.binding]} />
        </VStack>
    );
}}</Reactive>
```

### Disable controls on stale data

```tsx
<Slider
    value={t.read()}
    onChangeEnd={t.writeAndStart}
    disabled={t.status().hasTag('stale')}
/>
```

### Numbers, dates and the locale

Every e3-ui surface prints through east-ui's one formatter:
- the queue's values and deadlines;
- the journal's times and the constraint chips;
- the experiment's effects and its journal;
- a dataset preview's counts and sizes;
- a diff's values;
- the Plan's and the Sheet's numbers, counts and dates.

Numbers follow the viewer's locale, and every date prints its UTC day. A host sets the locale by wrapping the app in `<I18nProvider locale="de-DE">`, re-exported from `@elaraai/east-ui-components`; the browser's language stands in otherwise.

A value that is data prints bare: every digit, never grouped, with the locale's decimal separator (a year stays `2026`). That covers a constraint's number and a diff's integer. A declared spec, such as a decision's `format`, prints as the east-ui skill's Formats branch describes.

## Examples

Tested examples live in `test/*.examples.tsx`:
- `data.examples.tsx` — `Data.bind` read/write/has, staged vs direct;
  `Data.bindPaged` under a Plan, a Table and a Sheet — the large ones over
  rows an `e3.task` generates — a snapshot's revision, and a record read
  through its index.
- `func.examples.tsx` — `Func.bind` call/status/cancel, shared channels.
- `diff.examples.tsx` — reviewing pending changes with `<Diff>`.
- `ontology.examples.tsx` — graph/ontology editing with `<Ontology>`.
- `experiment/experiment.examples.tsx` — causal-experiment surface with `<Experiment>`.
- `decision/queue.examples.tsx` — `<DecisionQueue>` facets, probe editors, the
  author-bound slice scope, grouping.
- `decision/journal.examples.tsx` — `<DecisionJournal>` read-back.
- `decision/loop.examples.tsx` — the full loop: two task outputs unioned by one
  `Decision.bind` handle, queue + journal in lockstep.
- `studio/component.examples.tsx` — `Studio.component`: a self-contained
  component placed twice on a page, the two placements sharing its state.
- `studio/page.examples.tsx` — `<Studio.Page>`: a page's live layout with no
  chrome.
- `studio/studio.examples.tsx` — the Studio as a solution writes it: the data
  its components read, the components, the pages record, and the three surfaces
  it mounts — `<Studio.Builder>`, `<Studio.Library>` and a published
  `<Studio.Page>`.
- `plan/plan.examples.tsx` — `<Plan>` over `data`: every row kind, nesting from the
  data, the time, number and ordinal axes, folds, links, the series library,
  review, the editing session (drops, moves and resizes) and the narrow
  layout; the bound paged Plans are `data.examples.tsx`'s.
- `plan/plan-events.examples.tsx` — `<Plan>` over event kinds: the smallest
  (`planEvents`); the print works — presses and crews by hall, jobs as bars
  with review, stops as marks, shifts as chips, every kind's templates, a
  utilisation row under each press and a pinned chart (`planPrintWorks`); and
  links between events beside a read-only table over a dataset
  (`planEventLinks`).
- `sheet/sheet.examples.tsx` — `<Sheet>`, each in its frame, its rows bound
  from e3: the smallest sheet over a record; the configurator over the host's
  rows, committed through `onApply`; two thousand rows a task generates, read
  only, with the lens and saved views over them; a library of the author's own
  cards; the workshop's orders, the flagship (groups, the driver and
  registers, the link grammar, the copilot's fills and proposers, readiness,
  templates, the library, the inspector, the lens and views); one week's rows
  with every column kind and its rules, a journal and the author's own
  inspector; one day's batches dragged and moved, with sub rows; loose rows
  between work packages; and a record read a window at a time. Between them,
  every pane combination: none, a library, an inspector, and both. A sheet
  paged from a dataset is `data.examples.tsx`'s, and one over a record's own
  entries through `Record.onApply` `record.examples.tsx`'s `recordSheetApply`.
- `sheet/sheet-link.examples.ts` — the link grammar: `Sheet.link.parse` and
  `Sheet.link.print`.
- `sheet/sheet-transactions.examples.ts` — `Sheet.apply` over rows, and over
  entries of groups and loose rows.
- `query/query.examples.tsx` — queries as a solution writes them: the shared
  fixture's datasets; the saved queries record, its value seven queries from
  `Query.value`; the builder open on three of them and over an empty record; an
  order history the package's tasks generate, with its own saved queries and a
  builder whose runs are split calls; and the library.

## Related skills

- **e3** — workspaces, tasks, `e3.input`, dataflow execution (the engine `ui()`
  builds on), and e3-web, which runs e3 in the page.
- **east-ui** — the JSX component library (`<Reactive>`, `<Slider>`, `<Stat>`, …)
  that `ui()` renders.
- **east** — the language used inside `East.function` bodies.
- **east-ontology** — the `<Ontology>` editor's node/link model and the workshop
  method for building one.
- **east-design** — decide where a decision surface fits in the overall solution.
- **e3-ui-cli** — screenshot a surface from the terminal: `e3-ui shot
  --from-source` renders a zero-input `ui()` task; `--from-task` renders a
  deployed task's computed output.
