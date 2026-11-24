---
name: e3-ui
description: "Builds interactive decision surfaces as e3 UI tasks (ui()) authored in east-ui JSX and bound to workspace data: Data.bind and Data.bindPaged for datasets, Record.bind for records and their mutations, Func.bind for e3.function calls, staged edits applied or discarded together. Provides the planning builders Plan, Sheet, Calendar, Roster, Allocation, Flowchart and Schematic, the Record table over a system of records, plus Ontology, the Decide loop (Decision.bind, DecisionQueue, DecisionJournal), the Studio page builder, saved jq queries (Query.Builder), and rendering deployed surfaces in a React app (E3Provider). Use when a UI reads or writes e3 workspace data or runs as an e3 task; components with no e3 data are east-ui's."
---

# e3-ui — e3 + UI bridge

`@elaraai/e3-ui` connects **east-ui** JSX tags to **e3** workspaces. A decision
surface is an e3 **UI task** whose reads and writes of workspace data are
recorded in a manifest derived from its IR, so the engine knows what the UI
depends on and re-renders it when that data changes. With staged writes and
commit / discard, a view is where a user commits a decision with its evidence.

Everything comes from one import, `@elaraai/e3-ui`: the `ui()` task factory, the
bindings (`Data`, `Record`, `Func`, `Decision`, `Slice.bindRecords`), the e3
tags (`<Ontology>`, `<Plan>`, `<Sheet>`, `<Record>`, `<Calendar>`,
`<Roster>`, `<Allocation>`, `<Flowchart>`, `<Schematic>`, `<DecisionQueue>`,
`<DecisionJournal>`) and the `Studio` and `Query` components. Base tags
(`<VStack>`, `<Text>`, `<Stat>`, …) come from `@elaraai/east-ui`.

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

For e3-ui, search with `package: "e3-ui"`. Each builder's examples hold the
full package side (records, indexes, mutations) beside the JSX, so its
smallest one is the place to start; the Start from column of the builders
table below gives each one's id for `get_east_example`. A prop's full
contract is in its doc comment; the build refuses a wrong shape with an error
that names the fix.

## Quick Start

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { East, FloatType, variant } from '@elaraai/east';
import { Reactive, Slider, UIComponentType } from '@elaraai/east-ui';
import { ui, Data } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

const threshold = e3.input('threshold', FloatType, variant('value', 50.0));

// A UI task: a reactive binding to a workspace dataset, no compute-time inputs.
const dashboard = ui('dashboard', [], East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const t = $.let(Data.bind(threshold));
        return <Slider value={t.read()} min={0} max={100} onChange={t.write} />;
    }}</Reactive>
)));
// Manifest derived from the IR: binds inputs.threshold
export default e3.package('dashboard', '1.0.0', dashboard);
```

Deploy and run it like any e3 task (`e3 workspace deploy`, `e3 dataflow run`);
the workspace re-renders the component when bound data changes.

- The pragma makes the file JSX-capable, and needs `"jsx": "react-jsx"` in the
  project's tsconfig (a scaffolded project has it). Without it, `tsx` compiles
  JSX to `React.createElement` and fails with `React is not defined`.
- Bindings live **inside** the `<Reactive>{$ => …}</Reactive>` block; there is
  no inner `East.function`.

## Decision Tree: What Do You Need?

Each leaf names the API; search the index for it to get a tested example.

```
Task → What do you need?
    │
    ├─ Author a decision surface as an e3 task
    │   ├─ Reacts to workspace data only → ui(name, [], fn) + bindings inside <Reactive>
    │   └─ Also takes computed inputs     → ui(name, [input], fn) (fn receives values)
    │
    ├─ Read / write a workspace dataset — Data.bind(dataset, options?)
    │   ├─ Read a value            → .read()
    │   ├─ Check if set            → .has()
    │   ├─ Write a value           → .write(v)
    │   ├─ Write + kick dataflow   → .writeAndStart(v)
    │   ├─ Current status (variant) → .status()  (e.g. .status().hasTag('stale'))
    │   ├─ The binding handle       → .binding   (its source and patch paths, and its mode)
    │   └─ Staged mode             → { mode: 'staged' } + .commit() / .discard(), .pending() while a change waits
    │
    ├─ Read a collection too large to hold whole — Data.bindPaged(dataset, options?)
    │   ├─ One window              → .page(offset, limit)  (none = in flight; some([]) = exhausted; a failure throws)
    │   ├─ Total elements          → .total()
    │   ├─ Key search              → .seek(query)          (none for an Array source)
    │   ├─ The snapshot it serves  → .revision()           (the content hash; re-fires when it moves)
    │   ├─ Show a confirmed write  → .refresh(none)        (or .refresh(some(hash)))
    │   └─ Through a record's index → { index: "by_status", join?: true }
    │       rows arrive in the INDEX's order as `{ik, key, value, row}`
    │
    ├─ Read a record and apply its mutations — Record.bind(record, [mutation names])
    │   ├─ Its current value        → .read()
    │   ├─ Apply a mutation         → .mutate.<name>(args…)
    │   ├─ The mutation's lifecycle → .mutate.status() / .pending() / .error()
    │   ├─ A mutation as a draft, not committed → .draft.<name>(args…) · a pending Save's: Record.toDraft(record, { keyed? })
    │   ├─ Recompute what reads it  → .start()  (a mutation commits but does not run the dataflow)
    │   ├─ Its commit history       → .history()
    │   └─ A builder's Save door    → Record.bind(record) on a record declaring mutation.patch()
    │
    ├─ Call a named package function (e3.function) from the UI — Func.bind(fn)
    │   ├─ Launch (fire-and-forget, sync-callback safe) → .call(args…)
    │   ├─ Last successful result   → .read()   (Option(O))
    │   ├─ Lifecycle (variant)      → .status() (idle|running|succeeded|failed|cancelled) · spinner boolean: .pending()
    │   ├─ Failure detail           → .error()  (Option — message/kind/stdout/stderr)
    │   ├─ Stop the call            → .cancel() (asks the server to stop it; a later .call() supersedes one in flight the same way)
    │   ├─ A function that reads workspace data too → e3.function(name, { inputs, args, output }, fn); .call(args…) takes the args alone
    │   └─ Ask over the page's unsaved edits, saving nothing → a function listing drafts: [record]; .call(args…, [drafts]) · .drafted() · .binding.drafts
    │
    ├─ Edit a graph / ontology dataset
    │   └─ <Ontology value={view} />   (OntologyType: NodeType / LinkType)
    │
    ├─ Offer components for operators to arrange on pages (Studio)
    │   ├─ Declare one — self-contained, like a ui() body   → Studio.component(key, meta, fn)
    │   ├─ Store the pages operators build                  → e3.record("pages", Studio.Types.Pages, { initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }), migrations: (migration) => [migration.rows("cell_content", Studio.migrations.cellContent)] })
    │   ├─ List the data a page's visuals may read          → sources={{ orders: Studio.source(handle, { name, icon, description?, fields?, range?, search?, split? }) }} on the builder and the page (range: a date field every row has, never an optional one)
    │   ├─ Seed a page: a component, a visual, a text block → a placement's content: Studio.visual.component(key) · Studio.visual.of("orders", Studio.visual.column({ x: Studio.visual.group("ordered_at", { bucket: "month" }), values: [Studio.visual.sum("revenue")] })) · Studio.visual.text(body, heading?)
    │   ├─ What a click on a visual does, and who follows it → Studio.visual.of(source, view, { click?: variant("select" | "filter" | "none", null) or variant("open", pageKey), follow?: { leader, from, to, empty: variant("all" | "prompt", null) } })
    │   ├─ Narrow one visual alone, or where readers start  → Studio.visual.of(source, view, { where: jq }) · a layout's filters: [{ key, source, where }], its starting filters
    │   ├─ Alerts: a condition on a visual's rows           → e3.record("alerts", Studio.Types.Alerts, { initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }) }); alerts={Record.bind(alerts)} on the builder and the page · <Studio.AlertBell alerts onOpen? /> in the host's bar
    │   ├─ The builder: canvas, palette, inspector, preview → <Studio.Builder pages components project sources? page? onOpen? alerts? env? audience? rollout? id? />
    │   ├─ Templates, pages, and where new pages start      → <Studio.Library pages components project onOpen page? />
    │   ├─ Open a page from the library in the builder      → hold the open page (a route's params, or State.bind([Studio.Types.Key], …)); give it to both as `page`, change it in `onOpen`
    │   └─ Show one page, live or draft, with no chrome     → <Studio.Page pages components page sources? version? onOpen? alerts? /> (onOpen: a click, or an alert, that opens a page)
    │
    ├─ Let users query the bound datasets and save their queries (typed jq)
    │   ├─ Store the queries they save                    → e3.record("queries", Query.Types.Saved, { initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }) })
    │   ├─ Ship queries in the record, checked at build   → Query.value({ orders, customers }, [{ name, jq, description?, savedAt }])
    │   ├─ The builder: steps or jq, checked, run, saved  → <Query.Builder queries datasets query? onOpen? id? />
    │   ├─ The saved queries, and where new ones start    → <Query.Library queries datasets onOpen query? id? />
    │   └─ Open a query from the library in the builder   → hold the open query (Query.Types.Open: Query.open.saved(name), Query.open.on(source)); give it to both as `query`, change it in `onOpen`
    │
    ├─ Run the Decide loop over reasoning-task decisions
    │   ├─ Union the bound decision views into one handle → Decision.bind([Contract]?, { decisions, judgements })
    │   ├─ The queue (triage → understand → judge → apply) → <DecisionQueue handle={handle} …/>
    │   ├─ The resolved read-back                          → <DecisionJournal handle={handle} />
    │   └─ Scope the queue (author-owned, Table pattern)    → Slice.bind over Decision.Types.Decision, rows = handle.queue()
    │
    ├─ Draw what is scheduled on ONE shared axis — the Plan
    │   ├─ Rows derived from data by a series list            → <Plan axis={…} data={…} series={[…]} />
    │   ├─ Event kinds over records, on the rows they land on → series={[Plan.series.resources(Row, { key: "presses", title, label, series? })]} events={{ job: Schedule.events(record, { resource: { field, of: "presses" } }) }} · rows of mixed kinds: Plan.series.kinds(Row, "what", { press: { title, label }, crew: false }), a case each, exhaustive
    │   ├─ Rows beneath a resource, and a kind landing on them → a kinds case's children: Plan.children("kinds", [Plan.series.resources(Kind, { key: "kinds", keyType, label, lanes })]) — or a list's rows beneath every resource: Plan.children.of(() => kinds.read(), [series…]) — + Schedule.events(record, { resource: { field, of: "press" }, child: { field: "kind", of: "kinds" }, lane: "half" }): each event on its kind's row, a lane for each case of a variant `lane` · row: false leaves a case's own row undrawn (one press's own page)
    │   ├─ One case of a variant field, on a single series    → Plan.series.chart(Row, { case: ["kind", "kpi"], label: (row, key, kpi) => kpi.name, … }): the rows holding the case, each accessor handed its value; match narrows them further
    │   ├─ Read-only rows: a dataset's, or hand-built         → rows={[Plan.over(data, [series…]), Plan.chart({…})]}
    │   ├─ Its axis: time, number or ordinal                  → Plan.axis / Plan.axis.number / Plan.axis.ordinal
    │   ├─ Rows, nested by what the data holds                → Plan.series.span / buckets / chart / heat / table / cards / events / group / section / views / rows
    │   ├─ Data too large to hold whole                       → data={paged}, a Data.bindPaged handle · an entry of hundreds of rows (a Plan.series.group's): paging={{ entries: 1 }}, a window one entry, only those near the view made
    │   ├─ Narrow its rows, event kinds, templates            → slice={{ slice: Slice.bindRecords(key, { rows?, job?, jobTemplates? }) }} (Schedule.templates(rows, { …, source })); the rows source narrows the resources, which are rows
    │   ├─ Event kinds over records too large to read whole   → the kind's source over its interval index (range: "start") + Schedule.events(record, { entries }), drawn within 10,000 events; over paged rows its source lists index.flatSeries + index.summary too, read a cell at a time · rows nested under a group (Plan.series.group): list index.flatSeries({ on: [group field], key: resource field, …, order: "time" }) — its last `on` field holds the group's key, and each event's that field its row's group — and a block of rows is one range a tile, whatever each row's history holds (its edge cases: the **e3** skill's record indexes reference)
    │   ├─ The horizon's bars over the rail's sources         → each source's Data.bindPaged(record, { indexes, totals: [its month, quarter and year totals] }) — index.totals({ from: <the source's range>, to, tile }) with no key: the bars read them a range of whole tiles at a time, never counting events; with none listed, no bars
    │   ├─ A link between two runs, or two events             → Plan.link({ from: Plan.ref(…), fromRun, … }) / Plan.link({ from: Plan.eventRef(kind, key), … })
    │   ├─ Links kept in a record: selected, edited, removed  → links={{ flow: Plan.links(Record.bind(flows), { name, icon, from: { field, of }, to: { field, of }, quantity? }) }}: each link a row, each end the key of an event — `of` an event kind's slot, or a slot per case of a variant field
    │   ├─ Links drawn by hand, and the connect veto          → built in beside a link kind bound with Record.bind: the toolbar's Connect tool, a drag from one event to another; canConnect={fn(Plan.Types.ConnectCandidate) => Option<String>} refuses a pair with its message
    │   ├─ Every kind's templates in one record                 → Schedule.templates(presets.read(), { case: ["values", "job"], name, values: (_preset, _key, job) => job, source: "templates" }): the rows whose variant field holds the kind's case, each accessor handed its value; one source of the rail for every kind
    │   ├─ An event kind's record keyed by any type            → nothing more to write: its events are named by their key as East prints it, saved under it, and a link's end or an optimiser's patch holds it in its own type
    │   ├─ Its library pane: templates, backlog, series, cards → library={[Plan.library.events(), Plan.library.backlog(), Plan.library.series(), Plan.library.tab(rows, {…})]}
    │   ├─ Which series show, and the viewer's own choice     → hidden={["utilisation"]}, the keys off to start: any series of `series`, nested or not, a member of a views or a case of a kinds · with Plan.library.series() the Series tab switches each alone, kept under id
    │   ├─ A run's, a tile's, a chip's or a mark's status      → its map's status: Plan.status("Over dwell", "warning"), its words and its tone · { ring: true } draws it as an open ring, as a tentative one · an Option of one passes as it is
    │   ├─ The app's own words for what it draws              → vocabulary={{ unassigned, backlog, rows, dueThisWeek, confirmed, … }}
    │   ├─ Its inspector pane: what is selected               → inspector (+ an event kind's own: Schedule.events(record, { inspector }))
    │   ├─ Drags of templates, backlog cards and events       → built in with event kinds (+ library); canDrop={fn(Plan.Types.Candidate) => Option<String>}, the one check of every drop, its message on the ghost
    │   ├─ Hold one event or item where it is: a lock, no move, form read only → Schedule.events(record, { locked: (row, key) => Boolean }) · a series item's map: locked
    │   ├─ A library tab whose cards make events, as templates do → Plan.library.tab(rows, { …, create: { kind: "<slot>", duration | at, values: (row) => ({ …the kind's row less its start, end and resource }) } })
    │   ├─ The app's optimiser over the window and the backlog → optimise={Func.bind(e3.function)} from Plan.Types.OptimiseRequest (the window, the zoom's unit, the run, the rail's narrowing; no row) to Plan.Types.OptimiseResult({ job: Jobs }), a patch of each kind's record
    │   ├─ Overlap warnings, without dropping overlapping events → Schedule.events(record, { overlaps: "warn" | "allow" })
    │   └─ Dropped cards and moves of data rows as drafts      → a series' edit + record={Record.bind(rows)}, the record its data is read from (+ onPatch, ready)
    │
    ├─ Let planners type rows in place — the Sheet
    │   ├─ An e3 record edited as a sheet                     → <Sheet record={…} columns={{…}} /> (record = Record.bind(r))
    │   │   ├─ One entry's rows, groups or loose rows          → entry={{ key, rows: "field", id: "id" }} (+ group)
    │   │   └─ A large record, a window at a time             → window={Data.bindPaged(r)}
    │   ├─ The host's rows                                    → <Sheet data={…} id="id" columns={{…}} />
    │   ├─ Narrow its rows and templates — one rail           → slice={{ slice: Slice.bindRecords(key, { rows, rowTemplates, … }) }} (Sheet.templates(rows, { …, source })); its `rows` source pages the record, and `record={…}` beside it saves
    │   ├─ Its panes, each optional                           → library={[Sheet.library.rows(), Sheet.library.columns(), Sheet.library.tab(…)]} · inspector (+ fields)
    │   ├─ The app's own words for what it draws              → vocabulary={{ members, unassigned, source, destination, wanted, actual }}
    │   ├─ Its columns, registers and the driver              → Sheet.column.* / Sheet.register.* / Sheet.driver
    │   ├─ Groups, loose rows between them, read-only sub rows → Sheet.group / Sheet.Types.Entry / Sheet.subRows
    │   ├─ Data too large to hold whole                       → data={paged}, a Data.bindPaged handle
    │   ├─ The app's optimiser over the rows in view          → optimise={Func.bind(e3.function)} from Sheet.Types.OptimiseRequest() — over one entry's rows OptimiseRequest({ entry: K }) — to Sheet.Types.OptimiseResult(Rows), a patch of the rows its Save reaches; over a record only
    │   ├─ On a phone: a column pinned, how many in view      → narrow={{ pin?: "<column>", columns?: 1 | 2 | 3 }} (none pinned, 2 in view by default)
    │   └─ Drafts checked as they are made, one checked Save  → onUpdate | onApply, ready, newRow
    │
    ├─ Keep a system of records — people, skills, certificates — the Record
    │   ├─ A record's rows, each field a typed cell           → <Record record={Record.bind(r)} columns={{ name: Record.column.title(R, {…}), … }} />
    │   ├─ Click-stepped states, two words, a checkbox        → Record.column.cycle(R, register, { scale? }) · toggle(R, { on, off }) · boolean(R, {…})
    │   ├─ A variant's cases, stepped in their order          → Record.column.cycle(R, Variant, { steps: [{ case, label, tone? }] })
    │   ├─ Who, and the row's last change                     → Record.column.person(R, register, {…}) · audit(R, { mode }) on a Record.Types.Change field
    │   ├─ Time since a moment, to the viewer's clock         → days_since: Record.column.age(R, { since, unit?, stale? }), keyed by a name no field has
    │   ├─ Column groups over adjacent columns                → columnGroups={[{ label, columnKeys }]}
    │   ├─ Columns from data: a member's each, a struct field's → any kind's { each: "<register>", groups?: "<register>" } over a Dict keyed by the member · { each: { field: "Header" } } · a field stored its own way: field, read, write, each given the day
    │   ├─ Words or a lock on a cell; a cell read off the row → mark: (…, day) → Option<Record.Types.Mark>, a note or a lock the grid won't edit · value: (row) => … on title, text, date, quantity, integer
    │   └─ Narrow it — one rail, the record beside it        → slice={{ slice: Slice.bindRecords(key, { rows }) }} + record={record} (the record its `rows` source pages; without it, read only)
    │
    ├─ Schedule bound records on a calendar — the Calendar
    │   ├─ Event records, with their backlog                  → <Calendar events={{ job: Calendar.events(Record.bind(jobs), { name, icon, title, start, end, resource: { field, of }, entries, backlog }) }} />
    │   ├─ Resources and templates, read whole                → resources={{ machines: Calendar.resources(Data.bind(r).read(), {…}) }} · Calendar.templates(rows, {…})
    │   ├─ The app's own words for what it draws              → vocabulary={{ backlog, templates, template, dueThisWeek, dueNextWeek, later, noDate, unscheduled, unassigned, resources }}
    │   ├─ Narrow it — one rail, one date window              → slice={{ slice: Slice.bindRecords(key, { job: { source, range: "start" }, machines?, jobTemplates? }) }}
    │   └─ The app's optimiser                                → optimise={Func.bind(e3.function)} from Calendar.Types.OptimiseRequest (the window in view and its kind, the run, the rail's narrowing; no row) to Calendar.Types.OptimiseResult({ job: Jobs })
    │
    ├─ Draw a state-transition flow over the app's records — the Flowchart
    │   ├─ A kind per record: its states, transitions, lanes, decisions → <Flowchart states={Flowchart.states(record, { label, lane, order, members? })} transitions={Flowchart.transitions(record, { from, to, decision?, kind?, evidence? })} lanes={Flowchart.lanes(record, { label, order })} decisions={Flowchart.decisions(record, { label, owner? })} />
    │   ├─ Editable, or read only                              → Record.bind(record) · Data.bind(record) (lanes and decisions: small records, read whole)
    │   ├─ Records keyed by any type a Dict takes              → a field naming a kind's row holds that kind's key type, checked at build · a new row's key: the kind's rowKey: (row) => … builds it from the row; without one, a String's is made up, an Integer's one past the largest, and any other's typed in the inspector before Save — an editable transition kind keyed so needs rowKey
    │   ├─ Narrow its states, transitions and cards — one rail → slice={{ slice: Slice.bindRecords(key, { states: { source: Data.bindPaged(record, { indexes }) }, transitions: { … }, <a cards list's source>? }, { presets? }) }} (+ the kind's entries: Data.bindPaged(record))
    │   ├─ What a narrowing leaves out: gone, or faded         → narrowed="hide" (the default) · narrowed="dim"
    │   ├─ What its cards and labels draw from the app's rows  → details: Flowchart.details(rows, { details: [Flowchart.figure(f), .tags(f), .histogram(f, { unit }), .list(f)] }) on Flowchart.states / .transitions — rows keyed as the kind's, bound as it is read (Data.bind, or Data.bindPaged beside a kind read through its source)
    │   ├─ …where each read shows, tags in the app's colours   → show: "all" (default) | "canvas" | "inspector" · Flowchart.tags(f, { colors: { Tag: { colorPalette, variant? } } or rows.read() of Flowchart.Types.TagColor, legend: true })
    │   ├─ …a histogram over the app's own bins and axis       → Flowchart.histogram(f, { unit, bins?: [edges…] (left out: every row's edges merged), scale?: "band" | "linear", ticks?: [n, { at, label }] })
    │   ├─ …weighed by what the rail picks of a Dict field     → Flowchart.details(evidence, { source: "evidence", details: [ … ] }) — evidence = Data.bindPaged(record, { indexes: [its index.entries("byService")] }), also the rail's source: Slice.bindRecords(key, { …, evidence: { source: evidence, fields: { byService: { label, hints } }, initial? } }) — a figure adds, a histogram adds bin by bin, a list adds by name, tags join; weigh: false keeps a share's own, and a field the entries lack draws the row's
    │   ├─ Each kind's cards, and the Steps, Transitions and Lanes tabs → Flowchart.templates(rows, { name, group?, values, source? }) on the kind · library={[Flowchart.library.states(), .transitions(), .lanes()]}
    │   ├─ The app's own words for what it draws              → each kind's own name: Flowchart.states(record, { …, name: "Stop" }) — its tabs, canvas, inspector, footer and Find say it · vocabulary={{ planned, observed }}, a transition's kinds
    │   ├─ An author's card dropped onto any kind's row        → Flowchart.library.tab(rows, { …, drop: (r) => Flowchart.patch(R, { … }) })
    │   ├─ The inspector, a kind's form and the app's check    → on by default (inspector={false} takes it away) · Flowchart.states(record, { …, fields?, ready? })
    │   ├─ What the host hears, and the connect veto           → onSelectState · onSelectLink · onSelectTrigger · onTracePath (⌥-click) · canConnect={fn → Option<String>}, each key as its text
    │   ├─ Top down, a minimap, no legend, read only           → orientation="TD" · minimap · legend={false} · readOnly
    │   ├─ On a phone: how many lanes in view, ‹ › through them → narrow={{ lanes?: 1 | 2 | 3 }} (2 by default; one where the details draw on the cards)
    │   └─ Edit it: lanes, states, transitions, one Save       → each kind Record.bind(record) over a record declaring mutation.patch(); Save writes each through its patch door
    │
    ├─ Draw the app's records at world coordinates — a floor, a site — the Schematic
    │   ├─ A kind per record, under its slot                   → <Schematic extent={{ width, height }} items={{ racks: Schematic.items(record, { name, icon, x, y, label, … }) }} zones={{ … }} links={{ … }} nets={{ … }} />
    │   ├─ Editable, or read only                              → Record.bind(record) · Data.bind(record)
    │   ├─ Records keyed by any type a Dict takes              → as the Flowchart's, new keys too — an item's typed, a link kind's or a net kind's rowKey; a link's end and a net's side hold their items' key type, a variant's each case its slot's
    │   ├─ A link or net drawn with no template: its fields    → the kind's values: (ends) => ({ … }), over Schematic.Types.Ends (a net's, Sides)
    │   ├─ Narrow its kinds and templates — one rail           → slice={{ slice: Slice.bindRecords(key, { <a kind's slot>: { source: Data.bindPaged(record, { indexes }) }, … }) }} (+ the kind's entries: Data.bindPaged(record))
    │   ├─ A floor too large to read whole: a window at a time → its source lists index.area({ x, y, width, height, at: "centre", cell }); past 5,000 rows in view, their density
    │   ├─ Shapes from the row's own fields                    → footprint: (u) => some(Schematic.circle(u.radius)) · a zone's geometry: (a) => some(Schematic.polygon(a.corners))
    │   ├─ What a card draws from another record               → Schematic.items(…, { details: Schematic.details(record, { status, meter, metric, sublabel }) })
    │   ├─ The layers, from the app's record                   → layers={Schematic.layers(systems.read(), { label, order?, tone?, color?, visible?, locked?, opacity? })}
    │   ├─ Templates, the backlog, the index, the layers       → Schematic.templates(rows, { …, source }) · library={[Schematic.library.templates(), .backlog(), .index(), .layers()]}
    │   ├─ The app's own words for what it draws               → vocabulary={{ templates, backlog, index, layer, zone, net, link, source, destination }}
    │   ├─ An author's card dropped onto an entity             → Schematic.library.tab(rows, { …, drop: (r) => Schematic.patch(R, { … }) })
    │   ├─ The inspector, a kind's form and its own Details    → inspector · Schematic.items(record, { …, fields?, ready?, inspector? })
    │   └─ What the host hears, and the connect veto           → onSelect={fn(Array<Schematic.Types.Ref>)} · canConnect={fn(Schematic.Types.Candidate) → Option<String>}, each key as its text
    │
    ├─ Staff a week's shifts from the app's own duties — the Roster
    │   ├─ The duties: the app's record, a span kind                  → events={{ duty: Schedule.events(Record.bind(duties), { start, end, resource: { field, of }, shift, group, position?, activity?, hours? }) }}
    │   ├─ Duties in no group yet: a roster in two steps              → group over an Option<String> field, none a duty in no group — on its person's row in People and in Shifts' No group band, counted in their hours, contract and rest and in no group's targets; a drop in a group's slot writes some(group), the optimiser's request and result carry none · in a check, a duty's place (Roster.Types.Place) and Roster.slotOf(place), none in no group · vocabulary={{ noGroup }}
    │   ├─ Who is rostered                                            → resources={{ people: Schedule.resources(staff.read(), { name, icon, label, group, … }), agencies? }}
    │   ├─ The lists it reads, over the app's rows                    → Roster.shifts / groups / positions / activities / proposals(rows, { … })
    │   ├─ Publish, and the targets: the app's weeks and cover        → periods={Schedule.periods(Record.bind(weeks), { every: "week", status, dismissed? })} · targets={Roster.targets(Record.bind(cover), { day, group, shift, positions, hours, needed? })}
    │   ├─ A slot's hours needed: the app's own                       → Roster.targets(…, { needed: (row, shiftHours) => row.heads.toFloat().multiply(shiftHours) }) — by default the sum of its hours; read again from a target edited before Save · every key of its hours draws a coverage line: the group's skills, the duties, then any other key, another group's skill under its own label with its holders
    │   ├─ Publish a day at a time: the app's days                    → periods={Schedule.periods(Record.bind(days), { every: "day", status, dismissed?, entries? })} — in Shifts' Day, Publish day writes the day in view; else Publish week, each day of the week that takes edits, as one request; a published day read-only in every layout and period while its week's other days take edits, a rejected proposal kept on its day's row
    │   ├─ A new duty's, target's and week's own fields               → values: (d) => ({ … }) on the duty kind, over Roster.Types.NewDuty · Roster.targets(…, { values }) · Schedule.periods(…, { values })
    │   ├─ Costs in the app's own pay codes                           → pay={fn(Roster.Types.PayRequest(R)) → Roster.Types.Pay} currency="…"
    │   ├─ Who fits a Find fix: the app's fit, on e3                  → fit={Func.bind(e3.function)} from Roster.Types.FitRequest to FitResult — asked the need, the slot and the page's scope, no row; the function lists the duties in drafts, reads the week through their index (Roster.window) and whom it asks about, and answers with Roster.answer() + Roster.fit() over a Roster.Types.FitContext() — over duties keyed by other than String, each given their key type: Roster.answer({ key: IntegerType })
    │   ├─ The app's optimiser over the period in view                → optimise={Func.bind(e3.function)} from Roster.Types.OptimiseRequest() — the day, the week or the month it shows, `period` its kind — to Roster.Types.OptimiseResult(Duties), a patch of the duties' record
    │   ├─ An optimiser that sees the week's edges                    → Roster.Types.OptimiseRequest({ edges: true }) — the request also names in `fixed` the edge duties the answer must leave: those of a week that takes no edit; its one patch may change a duty in the weeks either side; one that changes a fixed duty, or puts one in a week taking no edit or beyond them, is refused, naming the duty — duties keyed by other than String name their key type: { edges: true, key: IntegerType }
    │   ├─ Narrow its duties, targets, people, activities, patterns   → slice={{ slice: Slice.bindRecords(key, { duty: { source, range: "start" }, targets?, people?, activities?, patterns? }) }}
    │   ├─ The app's check, and a record it reads beside the duties   → check={fn(Roster.Types.CheckContext(R)) → Array<Roster.Types.Issue>} · the first step's rota as the slice's reference: { duty, reference: { source, range: "start" } }, check from CheckContext(R, P) — cx.reference: Dict<String, P>, the week's rows and 12 h either side, read through its interval index, never whole; nothing draws it, the rail offers none of it
    │   ├─ People by week or by month                                 → view={{ layout: "people", period: "week" | "month", date }}
    │   ├─ People in one list, no band over each group                → peopleBands={false} — ranked as a group's people are (leads, the rest, agency staff), every group's agency requests one row at its foot; a person keeps their home group for + Assign, a Find, the fit and the optimiser
    │   ├─ The cover targets over People by week or month             → on with targets: under each band its work requirement — a lane a shift its targets name, each day's hours rostered (requests included) of needed over a bar, by month a mark a day on the person marks' columns (short, requested, covered or no target), a lane opening to its skill rows, a day or a mark opening its slot in the inspector; one block over every group with peopleBands={false}; deep in a band's people its block stays under the header; on a phone a card a day before each band's people's cards, a line a shift · requirements={false} takes it away
    │   ├─ Offer only some layouts, no switch with one left           → views={["people"]} or views={expr of Array<Roster.Types.Layout>}
    │   ├─ The app's own words for who is on it                       → vocabulary={{ permanent: "Employees", agency: "Contractors", agencyShort: "contr", others: "Colleagues", requests: "Contractor requests", demand: "Hours needed" }} — agencyShort the agency badge in People and on a Shifts chip, requests its rows of agency requests, demand the People layout's work requirement; a fit's reason: Roster.fit({ notALead })
    │   ├─ The shifts' colours, and the app's week patterns           → Roster.shifts(rows, { …, color }) · patterns={Roster.patterns(rows, {…})} · library={[…, Roster.library.patterns()]}
    │   └─ The week's figures in a task                               → Roster.coverage / check / weekHours / rest (R)
    │
    ├─ Book a day's arrivals into lane slots, each bin on its resources — the Allocation
    │   ├─ The bins: the app's record, an instant kind                → events={{ bin: Schedule.events(Record.bind(bins), { at, resource: { field, of: "<lanes>" }, arrival, quantity: { field, unit }, parts: { field, of: "<resources>" }, hold, kind? }) }}
    │   ├─ A reservation's own fields                                 → the bin kind's values: (b) => ({ … }), over Allocation.Types.NewBin; a booked bin takes its arrival's values
    │   ├─ The lanes and the resources                                → resources={{ <lanes>: Schedule.resources(rows, { name, icon, label, offset? }), <resources>: Schedule.resources(rows, { name, icon, label, min, max, … }) }}
    │   ├─ What it books from                                         → arrivals={Allocation.arrivals(rows, { label, quantity, hold, kind?, values?, … })}
    │   ├─ Publish: the app's days, or its weeks                      → periods={Schedule.periods(Record.bind(days), { every: "day", status })} · or its weeks, { every: "week", … }, each keyed by its first day, week={{ start: "monday" | "sunday" }} — Publish week writes the week holding the day in view, and every day of a published week is read-only
    │   ├─ Who fits where: the app's fit, on e3                       → fit={Func.bind(e3.function)} from Allocation.Types.FitRequest() to FitResult() — asked the day, the question and the page's scope, no row; the function lists the bins in drafts, reads the day's through their index, and answers with Allocation.answer() + Allocation.fit() (+ Allocation.lookahead()) over an Allocation.Types.FitContext() — over bins keyed by other than String, each given their key type: FitRequest({ key: IntegerType })
    │   ├─ The app's optimiser over the day                           → optimise={Func.bind(e3.function)} from Allocation.Types.OptimiseRequest (the day, the run, the rail's narrowing; no row) to Allocation.Types.OptimiseResult(Bins), a patch of the bins' record
    │   ├─ Narrow its bins, lanes, resources and arrivals — one rail  → slice={{ slice: Slice.bindRecords(key, { bin: { source, range: "at" }, <lanes>?, <resources>?, arrivals? }) }}
    │   ├─ Its panes                                                  → library={[Allocation.library.arrivals(), Allocation.library.resources()]} · inspector
    │   ├─ The app's own words for what it holds                      → labels={{ lane, arrival, resource, quantity, bin, reservation, reserved, priorJob, nextJob, hold, groups: { overdue, ready, removed, allocated, free, loading, busy } }}
    │   ├─ The app's bin fields on the board, and its own issues      → columns={[{ key, label, text }]} · check={fn(CheckContext(R)) → Array<Issue>}
    │   ├─ A record the check reads beside the bins                   → the slice's reference: { bin, …, reference: { source, range } }, check from CheckContext(R, P) — cx.reference: Dict<String, P>, the day's rows, read through its interval index, never whole; nothing draws it
    │   └─ The board's figures in a task                              → Allocation.loads / candidates / check / slots (R)
    │
    ├─ Render deployed surfaces in a React app (@elaraai/e3-ui-components)
    │   ├─ Which e3, and how requests reach it → <E3Provider config={{ apiUrl, repo, workspace, token, fetch }}>
    │   ├─ The bindings' adapters              → <ReactiveDatasetProvider> inside it
    │   ├─ A deployed ui() task, by name       → <UITaskPreview task="…" />
    │   └─ e3 running in the page, no server   → apiUrl and fetch from e3-web's createWebE3
```

## Bindings

### `ui(name, inputs, fn, options?)`

Wraps `e3.task()` with a `ui` role and a **manifest** derived from the IR: the
datasets in `inputs` (their values passed to `fn`), every dataset, record and
paged source the body binds, and every `Func.bind`. `fn` returns
`UIComponentType` exactly. It runs on `east-c` by default; where only the Node
runner is installed, pass `{ runner: { runtime: "east-node" } }` as
`options`. Bindings take the def itself (`e3.input`, `e3.task`, `e3.record`,
`e3.function`), so the path and type are fixed when the IR is built.

### `Data.bind(dataset, options?)`

A reactive binding to an `e3.input` or a task's output. `read()` tracks the
dependency, so `<Reactive>` re-renders when it changes. Modes:
- `'direct'` (default): each `write()` mutates the dataset.
- `'staged'`: `write()` accumulates a patch; `commit()` applies it, `discard()`
  drops it, and `pending()` says whether a change waits.

A record a builder reads whole beside its pages (a templates list, the
resources a check reads) binds with `Data.bind`, which the manifest preloads.
`Record.bind` stays the door a Save commits through: the manifest never
preloads a record `Record.bind` reads beside `Data.bindPaged`, so its `read()`
fails on e3.

### `Data.bindPaged(dataset, options?)`

A read-only, windowed binding for a collection too large to hold whole, passed
as a `<Plan>`, `<Table>` or `<Sheet>`'s `data`; nothing else produces a paged
source. Every window, total and search belongs to one snapshot (`revision()`,
the content hash), and the source follows its dataset when a run or another
user moves it; `page` reads `none` for each window until the new one lands. A
failed fetch throws, so wrap a hand-read in `$.try`.

- A dataset too large to hold whole is made where data is made — a task that
  generates or loads its rows (bound as the task def) — never an input's
  inline value.
- Through a record's index (`{ index: "by_status" }`) the window is in the
  index's order and each row is `{ ik, key, value, row }`; `join: true` also
  reads the row. The index name and the row type are checked against the
  record's declaration.
- `.seek` takes a key, a prefix, or a `from..to` range over a leading prefix of
  the key's fields (`late, 3..ok`); quote a value to make it exact.
- `{ indexes: [...] }` lists several indexes for a `Slice.bindRecords` source.
- `{ indexes, totals: [...] }` names the record's totals a tile apart from them:
  summaries with no key (`index.totals({ from, to, tile })`, the **e3**
  skill), which a Plan's horizon reads over the source's range, under its
  narrowing. They count from the range's field and are led only by fields the
  rail offers or the scope holds. The build refuses a summary by key or another
  index in `totals`, a summary with no key among the `indexes`, and two at one
  tile over the same fields, each naming the fix.

### `Record.bind(record, mutations?)`

The handle to an `e3.record`: `read()`, `mutate.<name>(args…)` for each
mutation named in the list (with `mutate.status()`, `pending()`, `error()`),
`start()` to run the dataflow over the new state, and `history()` for its
commits. Builders take `Record.bind(record)` of a record declaring
`patch: mutation.patch()` and commit every Save through it; a stale Save is a
conflict naming the entry, and nothing is overwritten. A builder is handed the
record itself, beside a rail too (`slice` with `record`); `Record.onApply(record,
{ keyed? })` is a host's `onApply` over its own `data`: `.apply` with `.toDraft`.

### `Func.bind(fn)`

A call handle for an `e3.function`. `call(args…)` is fire-and-forget and safe
in a sync `onClick`, latest-wins; the outcome arrives reactively through
`read()`, `status()`, `error()` and `pending()`, on one channel for every
handle of the function. A call is the server's, kept for its lifetime (the
**e3** skill): it outlives its request and runs until its timeout — the
server's ceiling, ten minutes locally — so an optimiser of several minutes is
called the same way. `cancel()` asks the server to stop it, and `status()`
reads `cancelled`; a `call` that supersedes one in flight does the same. A
result is at most 1 MiB: a large one belongs in a task, read with `Data.bind`.

A function that declares `inputs` (`e3.function(name, { inputs, args, output },
fn)`, the **e3** skill) is bound the same way: its `call` takes the `args`
alone, each call reads the inputs as the workspace stores them when it launches,
and the page binds none (`e3-ui:func.examples.tsx:funcBindCall`, `funcBindInputs`).

A function that lists records in `drafts` (the **e3** skill) is asked over the
page's unsaved edits: its `call` takes drafts last, an Array (`[]`: as saved),
each a mutation's call, not committed: `record.draft.<name>(args…)`, or a
pending Save's from `Record.toDraft`. e3 lays them over what the function reads
and saves nothing. A draft that no longer fits its record ends the call
`conflict`, the function not run (`e3-ui:func.examples.tsx:funcBindDrafts`).

## The builders

`<Plan>`, `<Sheet>`, `<Record>`, `<Calendar>`, `<Roster>`, `<Allocation>`,
`<Flowchart>` and `<Schematic>` share one contract:

- **Data is the app's own records.** Each builder maps roles onto the app's
  fields (`title: "title"` or a function of the row, `start: "start"`,
  `resource: { field, of }`) and stores nothing of its own. Editable data is
  `Record.bind(record)` over a record declaring `mutation.patch()`.
  `Schedule.events` / `templates` / `periods` are the shared vocabulary for
  kinds of events (Plan, Calendar, Roster, Allocation), `Schedule.resources`
  for their resources but the Plan's, which are its rows.
- **Every gesture is a draft.** Drags, drops, typed cells and form edits are
  steps of one session with Undo / Redo, saved with one checked Save through
  each record's patch door (or the host's `onApply`), surviving paging,
  narrowing and remount. While a kind's `ready` refuses a draft, Save waits:
  the entry's panel shows the refusal over its form, the field ringed, an
  Issues tab lists it, and the history's warning button selects the entry.
  Save's menu holds Autosave, off unless `autosave` (a Boolean) begins it on.
- **A new row's key is decided the same way on every builder**, on what adds
  the row: the `<Sheet>` / `<Record>` tag, `Schedule.events`, `Roster.targets`,
  `Plan.links`, a Flowchart's or a Schematic's kind. `newKey` is the app's rule,
  an East function from the keys taken to a new one. `rowKey: (row) => …` builds it
  from the row: a row an edit changes the key of moves under it, and a key
  another row holds is refused on the page. Give one, never both. `keyField`
  names a field of the row that holds its key, which the builder writes and no
  role may. With none, a String key is made up and an Integer's is one past the
  largest (`e3-ui:record.examples.tsx:recordConflicts`, `recordBuiltKeys`,
  `recordStaffIds`, `e3-ui:calendar.examples.tsx:calendarBuiltKeys`).
- **It renders in its own frame**: one toolbar, the canvas, a footer, and the
  panes its props ask for (`library`, `inspector`). Give it a box with a height.
- **One rail narrows it**: `slice={{ slice: Slice.bindRecords(key, { … }) }}`,
  each source named after what it narrows (a kind's slot, `rows`, a templates
  list's `source`) over its record's indexes (`Data.bindPaged(record, { indexes })`);
  `range` sources share one window. Calculations read every row, hidden or not.
  A page for one press scopes a source (`scope: { press: [press] }`): every read
  and Search Records keep to the press, the rail has no control for it, a new event
  takes it; it lists `index.on(["press"])`, per field offered `index.on(["press", "crew"])`, and read by area `index.area({ on: ["press"], … })`.
- **Large records are read through their indexes** (declared in the record,
  the **e3** skill): an event kind through an interval index
  (`index.interval({ from: "start", to: "end" })`) with `range: "start"` and
  `entries: Data.bindPaged(record)` for reads by key; events on paged
  rows a cell at a time through `index.flatSeries` + `index.summary`; a
  drawing a window at a time through `index.area`.
- **The app's optimiser**: `optimise={Func.bind(fn)}`, an `e3.function` from
  the builder's `Types.OptimiseRequest` — the period in view, the run and the
  rail's narrowing, never a row — to its `Types.OptimiseResult`, a patch of each
  record it edits (`East.diff`). The function lists those records in `drafts`,
  reads them through their indexes, and its answer lands as one undoable step.
- **The app's fit** (the Roster's Find fix, the Allocation's board):
  `fit={Func.bind(fn)}` asks an `e3.function` the question and the page's
  scope, never a row; listing in `drafts` the records it reads that the builder
  edits, it answers over the unsaved edits. A subject it leaves out has no verdict.
- **Which views and periods an instance offers**: a component that switches
  between views takes `views` — the Roster's, Calendar's and Allocation's
  layouts, the Ontology's display modes and `<Query.Builder>`'s Visual · jq (and
  `resultViews`, Table · Tree). Literal tags (`views={["people"]}`), variants of
  its `Types`, or an expression of an array of them, so a page's state can
  choose them as it runs. Left out, or empty as the page runs, every view; one
  left, no switch shows in any form of the toolbar; the component's own order
  stands. `e3-ui:roster.examples.tsx:rosterViews` wires a multi-select into it.
  `<DecisionQueue>`'s `facets` is the same, and so is `viewPeriods` on `<Roster>`
  and `<Calendar>` for Day · Week · Month (a Plan's are its axis's `resolutions`).
- **Misuse is refused at build**, naming the change — forms from earlier
  releases included — so read the error rather than guessing.

| Builder | What it draws | Start from |
|---|---|---|
| `<Plan>` | Heterogeneous rows on one time / number / ordinal axis: series over data, event kinds over records landing on its rows, read-only rows | `e3-ui:plan-events.examples.tsx:planEvents` (smallest), `e3-ui:plan.examples.tsx:planTargetState`, `e3-ui:plan-windows.examples.tsx:planWindows`, `e3-ui:plan-records.examples.tsx:planRecordIndexes`, `e3-ui:plan-events.examples.tsx:planPrintWorksRecords` (the whole of it: one record of rows, five event kinds, a link kind, templates, an optimiser) |
| `<Sheet>` | A planning spreadsheet over a record, the host's rows or a paged source: typed columns, registers, groups, copilot, Excel round-trip | `e3-ui:sheet.examples.tsx:sheetBasic` (smallest), `e3-ui:sheet.examples.tsx:sheetWorkshop`, `e3-ui:sheet.examples.tsx:sheetPaged`, `e3-ui:sheet-records.examples.tsx:sheetRecordIndexes` |
| `<Record>` | A system of records' rows as a table: the Sheet's kinds with title, person, boolean, toggle, cycle, age and audit; column groups, columns from data, marks and locks, Add and Delete | `e3-ui:record.examples.tsx:recordBasic` (smallest), `e3-ui:record.examples.tsx:recordSkillsMatrix`, `e3-ui:record.examples.tsx:recordEveryKind`, `e3-ui:record.examples.tsx:recordFinishes`, `e3-ui:record.examples.tsx:recordHoursByProject` (columns from data), `e3-ui:record.examples.tsx:recordSkillHistory` (a dated history, read and written at the day) |
| `<Calendar>` | Calendar, Resources and Timeline layouts over event records with a backlog | `e3-ui:calendar.examples.tsx:calendarMinimal` (smallest), `e3-ui:calendar.examples.tsx:calendarOperations`, `e3-ui:calendar-records.examples.tsx:calendarRecordIndexes` |
| `<Roster>` | Weekly staffing: duties over people by shift, cover targets, pay, fit, publish, duties in no group yet | `e3-ui:roster.examples.tsx:rosterMinimal` (smallest), `e3-ui:roster.examples.tsx:rosterWarehouse`, `e3-ui:roster.examples.tsx:rosterPeople`, `e3-ui:roster.examples.tsx:rosterNoGroup` (in two steps) |
| `<Allocation>` | A day's arrivals booked into lane slots, each bin on resources | `e3-ui:allocation.examples.tsx:allocationMinimal` (smallest), `e3-ui:allocation.examples.tsx:allocationKilnYard`, `e3-ui:allocation.examples.tsx:allocationFitRule` |
| `<Flowchart>` | States in ordered lanes, transitions and decisions, a record of the app's each, the app's details drawn on the cards and labels | `e3-ui:flowchart.examples.tsx:flowchartDwell` (smallest), `e3-ui:flowchart.examples.tsx:flowchartDepot`, `e3-ui:flowchart.examples.tsx:flowchartDepotEditing`, `e3-ui:flowchart.examples.tsx:flowchartTicketMinutes`, `e3-ui:flowchart.examples.tsx:flowchartDepotTopDown`, `e3-ui:flowchart.examples.tsx:flowchartBakery` |
| `<Schematic>` | Items, zones, links and nets at world coordinates | `e3-ui:schematic.examples.tsx:schematicFloor` (smallest), `e3-ui:schematic.examples.tsx:schematicDataCentre`, `e3-ui:schematic-records.examples.tsx:schematicRecordIndexes`, `e3-ui:schematic.examples.tsx:schematicBakehouse` |

Field types matter: a `Sheet.column.quantity` sits on a `Float` field, a
`Sheet.column.date` on a `DateTime`, each `Option` of it allowed; an event's
start and end are `Option<DateTime>` when it can wait in the backlog. A
`Record.Types.Change` field is the solution's to write; the Record only reads it.

## Other surfaces

- **`<Ontology value={view} />`** edits a typed node / link graph
  (`OntologyType`), committing through the binding. The **east-ontology** skill
  builds the graph.
- **The Decide loop.** Reasoning tasks emit `Array<Decision.Types.Decision>`
  (`Decision.make` / `option` / `reference` / `judgement`).
  `Decision.bind([Contract]?, { decisions: [views…], judgements })` unions them
  into one handle owning the selection, the routing of writes by case and the
  commit gate; the judgements bind staged. `<DecisionQueue handle …/>` is the
  queue (`modify`, `evidence`, `facets`, `groups`, an author-bound `slice` from
  `Slice.bind(key, handle.queue(), {…})`); `<DecisionJournal handle />` is the
  resolved read-back.
- **The Studio.** `Studio.component(key, { name, category, icon, span?, … },
  fn)` declares a self-contained component written like a `ui()` body; the
  pages live in one `Studio.Types.Pages` record with a patch mutation.
  `<Studio.Builder>` and `<Studio.Library>` take `Record.bind(pages)`;
  `<Studio.Page>` takes `Data.bind(pages).read()`. Each takes the components
  as one `$.let([...])` list in palette order; the surface's manifest is the
  union of their reads. The open page is the host's: a builder shows the
  `page` it is given and calls `onOpen` when its palette asks for another, and
  the page library calls `onOpen` and opens nothing itself — the host
  navigates, or writes the State both read. A builder given no `page` holds
  its own; `page` without `onOpen` is refused when the surface is built.
  A placement holds `content` (`Studio.Types.Content`): a component's key, a
  visual — a KPI, a chart, a table, a list or a slicer over a source — or a
  text block. `Studio.visual` builds each with its defaults, for a record's
  seeds. A surface lists the sources its visuals may read as
  `sources={{ orders: Studio.source(handle, meta) }}`: the key is the name a
  query reads the source by, the handle a `Data.bind`, `Data.bindPaged` or
  `Record.bind` whose rows are an Array or a Dict of Structs, and `fields`,
  `range`, `search` and `split` name the row's own fields, checked when the
  surface is built. A visual's tile prints its jq programs and asks them on e3
  as `<Query.Builder>` runs a query — one call, or a split call over a large
  dataset's pieces — once a program and dataset hash however many tiles ask;
  it shows waiting, a well to fill, a field its source lacks, its source's
  error, "no data", or its answer drawn with east-ui's own parts — a KPI's
  value with its change, trend and goal; a chart (a pie is `Chart.Pie`); the
  records; a summary's heads over its groups, with the query's own totals; a
  pivot on the heat ramp; a list with its ranking bar. Records, a list, a
  summary and a pivot are read a page at a time under the tile's pager; a
  chart draws its first 500 groups and says how many it holds of how many.
  Its eyebrow names it — its placement's title, else its wells (`Revenue by
  month`) — and its menu shows its rows as a value tree in a popover, or
  exports them as CSV. `e3-ui:studio.examples.tsx:studioVisuals` is a page of
  every form. A click on a visual's row or mark selects (a list's and a
  table's, unless it says otherwise), filters the page (a chart's and a KPI's)
  or opens another page narrowed to it, which the page's `onOpen` is told. A
  filter is a chip on the page's rail, read by every visual of its source; one
  a click made keeps its placement (`from`), which marks the groups and is not
  narrowed. A reader starts with the layout's `filters`, its starting filters
  (the builder's rail sets them), to change or clear; a visual's own `where`
  narrows it alone, before them. A visual that `follow`s one whose click selects narrows to the
  selection, its eyebrow saying what; with nothing selected it shows every
  row (`all`) or asks for a pick (`prompt`): `e3-ui:studio.examples.tsx:studioClicks`.
  A visual whose filter reads `$now` ("in the last 7
  days") is asked for the page's minute, and again as it moves on. The calls run as the reader: a host that admits its
  readers only what their pages bind must admit their platform-free calls over
  those datasets. A text block draws. A pages record written before a placement
  held content is carried by listing `Studio.migrations.cellContent` as a rows
  step; a later kind of content ships a step of its own.
  `e3-ui:studio.examples.tsx:studioContent` holds all of it.
  Given `alerts={Record.bind(alerts)}` (a `Studio.Types.Alerts` record whose
  one mutation is a patch), each data visual's header carries a bell that sets
  alerts on it: a condition on its rows — its groups and values by name — with
  the rows that meet it now, kept with the page's filters as it was made; a
  visual of more than 200 rows takes none. In the builder the selected visual's
  Configure tab lists and sets them too; an alert is the record's, saved as it is
  written, never with the page's draft (`e3-ui:alerts.examples.tsx:studioAlertsBuilder`).
  A published page checks its project's alerts
  that are not paused, as it opens and as their data moves — one e3 call each,
  as a tile's — and writes each one's latest firing; `<Studio.AlertBell>` lists
  those firing, and opening one sets the page's filters to its own, tells
  `onOpen`, and the page draws a banner naming it, with its rows:
  `e3-ui:alerts.examples.tsx:studioAlertsPage`.
- **Queries.** One `Query.Types.Saved` record with a patch mutation holds the
  saved jq queries; `Query.value(sources, queries)` ships some, checked at
  build. `<Query.Builder queries datasets />` edits a query as steps or jq,
  checks it, runs it on e3 (split over a large dataset's pieces) and saves it;
  `<Query.Library>` lists them. Its steps say, beside the rest, a date in the
  last N hours, days or weeks, a group by several fields, and a ratio total
  (one field added up over another), each of which splits. A query may read
  `.now`, the minute it is asked: the root's last field — unless a data source
  is named `now` — given to the call as a value beside the datasets, and no
  data source of a saved query's root; `Query.value` checks a query that reads
  it, and an answer that read it is kept for that minute. The open query is the host's, as Studio's open
  page is: a `Query.Types.Open` — `Query.open.saved(name)`, or
  `Query.open.on(source)` for a new query — given to both as `query` and
  changed in `onOpen` (a builder's `query` takes a saved query's name too). A run of one program is a call the workspace
  keeps, as it keeps a function's (the **e3** skill): held to its own timeout,
  never a request's, and listed among the workspace's calls, naming no
  function. A split run's plan read-out says how many pieces it cut and how
  many units e3's cache served; `first(…)` and `limit(n; …)` over a dataset's
  rows split too, stopping once they have their rows; a run given up — a new
  run, or the builder going — cancels its call, or its split call's job; and a
  split answer too large for one, with no final step, is read a page at a time
  in the Table and the Tree.

## Rendering surfaces in an app — `<E3Provider>`

A deployed `ui()` task renders in a React app through
`@elaraai/e3-ui-components`: `<E3Provider config>` names the e3 and how
requests reach it, `<ReactiveDatasetProvider>` inside it installs the bindings'
adapters, and `<UITaskPreview task="…">` fetches and renders a task's output.

`E3Config` names the e3: `apiUrl` (**required**), `repo` (`"default"` when
omitted), `workspace`, `token` (a bearer token or `null`, read afresh for every
request) and `fetch` — for an e3 running in the page, the one `createWebE3`
gives (e3-web, the **e3** skill).

`E3Provider` also takes a `queryClient` to share a TanStack Query cache. Wrap
the app in `<I18nProvider locale="…">` (re-exported from
`@elaraai/east-ui-components`) to set the locale every surface prints numbers
in; dates print in UTC.

## Key Patterns

- **Staged commit / discard**: `Data.bind(d, { mode: 'staged' })`, with Apply
  calling `commit()` and Discard `discard()`, both off until `pending()`:
  `e3-ui:data.examples.tsx:dataBindStagedVariants`.
- **A record's mutation from a button**: `Record.bind(r, ["increment"])`, the
  button applying `r.mutate.increment(1n)` with `loading={r.mutate.pending()}`:
  `e3-ui:record.examples.tsx:recordBindMutate`.
- **Disable controls on stale data**: `disabled={t.status().hasTag('stale')}`.

## Related skills

- **e3** — inputs, tasks, records with their indexes and mutations, and the
  dataflow `ui()` builds on; e3-web runs e3 in the page.
- **east-ui** — the JSX components (`<Reactive>`, `<Table>`, `<Stat>`, …) a
  `ui()` task renders, their formats and status colours.
- **east** — the language inside `East.function` bodies.
- **east-ontology** — the `<Ontology>` editor's model and the workshop method.
- **east-design** — where a decision surface fits in the solution.
- **e3-ui-cli** — screenshot a surface (`e3-ui shot --from-source` /
  `--from-task`) and browse a repository in the terminal.
