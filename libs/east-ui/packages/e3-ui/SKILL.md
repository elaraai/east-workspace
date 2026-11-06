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
    │   ├─ Recompute what reads it  → .start()  (a mutation commits but does not run the dataflow)
    │   ├─ Its commit history       → .history()
    │   └─ A builder's Save door    → Record.bind(record) on a record declaring mutation.patch()
    │
    ├─ Call a named package function (e3.function) from the UI — Func.bind(fn)
    │   ├─ Launch (fire-and-forget, sync-callback safe) → .call(args…)
    │   ├─ Last successful result   → .read()   (Option(O))
    │   ├─ Lifecycle (variant)      → .status() (idle|running|succeeded|failed|cancelled)
    │   ├─ Failure detail           → .error()  (Option — message/kind/stdout/stderr)
    │   ├─ Spinner boolean          → .pending()
    │   ├─ Stop the call            → .cancel() (asks the server to stop it; a later .call() supersedes one in flight the same way)
    │   └─ A function that reads workspace data too → e3.function(name, { inputs, args, output }, fn); .call(args…) takes the args alone
    │
    ├─ Edit a graph / ontology dataset
    │   └─ <Ontology value={view} />   (OntologyType: NodeType / LinkType)
    │
    ├─ Offer components for operators to arrange on pages (Studio)
    │   ├─ Declare one — self-contained, like a ui() body   → Studio.component(key, meta, fn)
    │   ├─ Store the pages operators build                  → e3.record("pages", Studio.Types.Pages, { initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }) })
    │   ├─ The builder: canvas, palette, inspector, preview → <Studio.Builder pages components project env? audience? rollout? id? />
    │   ├─ Templates, pages, and where new pages start      → <Studio.Library pages components project onOpen? id? />
    │   └─ Show one page, live or draft, with no chrome     → <Studio.Page pages components page version? />
    │
    ├─ Let users query the bound datasets and save their queries (typed jq)
    │   ├─ Store the queries they save                    → e3.record("queries", Query.Types.Saved, { initial: new Map(), mutations: (mutation) => ({ patch: mutation.patch() }) })
    │   ├─ Ship queries in the record, checked at build   → Query.value({ orders, customers }, [{ name, jq, description?, savedAt }])
    │   ├─ The builder: steps or jq, checked, run, saved  → <Query.Builder queries datasets query? id? />
    │   └─ The saved queries, and where new ones start    → <Query.Library queries datasets onOpen? id? />
    │
    ├─ Run the Decide loop over reasoning-task decisions
    │   ├─ Union the bound decision views into one handle → Decision.bind([Contract]?, { decisions, judgements })
    │   ├─ The queue (triage → understand → judge → apply) → <DecisionQueue handle={handle} …/>
    │   ├─ The resolved read-back                          → <DecisionJournal handle={handle} />
    │   └─ Scope the queue (author-owned, Table pattern)    → Slice.bind over Decision.Types.Decision, rows = handle.queue()
    │
    ├─ Draw what is scheduled on ONE shared axis — the Plan
    │   ├─ Rows derived from data by a series list            → <Plan axis={…} data={…} series={[…]} />
    │   ├─ Event kinds over records, on resource rows         → <Plan axis={…} resources={{ presses: Schedule.resources(…) }} events={{ job: Schedule.events(record, {…}) }} />
    │   ├─ Read-only rows: a dataset's, or hand-built         → rows={[Plan.over(data, [series…]), Plan.chart({…})]}
    │   ├─ Its axis: time, number or ordinal                  → Plan.axis / Plan.axis.number / Plan.axis.ordinal
    │   ├─ Rows, nested by what the data holds                → Plan.series.span / buckets / chart / heat / table / cards / events / group / section / views / rows
    │   ├─ Data too large to hold whole                       → data={paged}, a Data.bindPaged handle
    │   ├─ Narrow its rows, event kinds, resources, templates → slice={{ slice: Slice.bindRecords(key, { rows?, job?, presses?, jobTemplates? }) }} (Schedule.templates(rows, { …, source }))
    │   ├─ Event kinds over records too large to read whole   → the kind's source over its interval index (range: "start") + Schedule.events(record, { entries }); drawn within 10,000 events
    │   ├─ …on paged resources: read a cell at a time         → the kind's source lists index.series + index.summary beside its interval index
    │   ├─ A link between two runs, or two events             → Plan.link({ from: Plan.ref(…), fromRun, … }) / Plan.link({ from: Plan.eventRef(kind, key), … })
    │   ├─ Its library pane: templates, backlog, series, cards → library={[Plan.library.events(), Plan.library.backlog(), Plan.library.series(), Plan.library.tab(rows, {…})]}
    │   ├─ The app's own words for what it draws              → vocabulary={{ unassigned, backlog, rows, dueThisWeek, confirmed, … }}
    │   ├─ Its inspector pane: what is selected               → inspector (+ an event kind's own: Schedule.events(record, { inspector }))
    │   ├─ Drags of templates, backlog cards and events       → built in with resources + events (+ library); canDrop={fn(Schedule.Types.Candidate) => Option<String>}
    │   ├─ The app's optimiser over the window and the backlog → optimise={Func.bind(e3.function)} from Plan.Types.OptimiseRequest({ job: Job }, { presses: Press }) to Plan.Types.OptimiseResult({ job: Job })
    │   ├─ Overlap warnings, without dropping overlapping events → Schedule.events(record, { overlaps: "warn" | "allow" })
    │   └─ Dropped cards and moves of data rows as drafts      → a series' edit + editing={{ onUpdate | onApply }}
    │
    ├─ Let planners type rows in place — the Sheet
    │   ├─ An e3 record edited as a sheet                     → <Sheet record={…} columns={{…}} /> (record = Record.bind(r))
    │   │   ├─ One entry's rows, groups or loose rows          → entry={{ key, rows: "field", id: "id" }} (+ group)
    │   │   └─ A large record, a window at a time             → window={Data.bindPaged(r)}
    │   ├─ The host's rows                                    → <Sheet data={…} id="id" columns={{…}} />
    │   ├─ Narrow its rows and templates — one rail           → slice={{ slice: Slice.bindRecords(key, { rows, rowTemplates, … }) }} (Sheet.templates(rows, { …, source }))
    │   ├─ Its panes, each optional                           → library={[Sheet.library.rows(), Sheet.library.columns(), Sheet.library.tab(…)]} · inspector (+ fields)
    │   ├─ The app's own words for what it draws              → vocabulary={{ members, unassigned, source, destination, wanted, actual }}
    │   ├─ Its columns, registers and the driver              → Sheet.column.* / Sheet.register.* / Sheet.driver
    │   ├─ Groups, loose rows between them, read-only sub rows → Sheet.group / Sheet.Types.Entry / Sheet.subRows
    │   ├─ Data too large to hold whole                       → data={paged}, a Data.bindPaged handle
    │   ├─ The app's optimiser over the rows in view          → optimise={Func.bind(e3.function)} from Sheet.Types.OptimiseRequest(R) to Sheet.Types.OptimiseResult(R)
    │   ├─ On a phone: a column pinned, how many in view      → narrow={{ pin?: "<column>", columns?: 1 | 2 | 3 }} (none pinned, 2 in view by default)
    │   └─ Drafts checked as they are made, one checked Save  → onUpdate | onApply, ready, newRow
    │
    ├─ Keep a system of records — people, skills, certificates — the Record
    │   ├─ A record's rows, each field a typed cell           → <Record record={Record.bind(r)} columns={{ name: Record.column.title(R, {…}), … }} />
    │   ├─ Click-stepped states, two words, a checkbox        → Record.column.cycle(R, register, { scale? }) · toggle(R, { on, off }) · boolean(R, {…})
    │   ├─ Who, and the row's last change                     → Record.column.person(R, register, {…}) · audit(R, { mode }) on a Record.Types.Change field
    │   ├─ Time since a moment, to the viewer's clock         → days_since: Record.column.age(R, { since, unit?, stale? }), keyed by a name no field has
    │   ├─ Column groups over adjacent columns                → columnGroups={[{ label, columnKeys }]}
    │   └─ Narrow it — one rail — and Apply through the door  → slice={{ slice: Slice.bindRecords(key, { rows }) }} + onApply={Record.onApply(record, { keyed: true })}
    │
    ├─ Schedule bound records on a calendar — the Calendar
    │   ├─ Event records, with their backlog                  → <Calendar events={{ job: Calendar.events(Record.bind(jobs), { name, icon, title, start, end, resource: { field, of }, entries, backlog }) }} />
    │   ├─ Resources and templates, read whole                → resources={{ machines: Calendar.resources(Data.bind(r).read(), {…}) }} · Calendar.templates(rows, {…})
    │   ├─ The app's own words for what it draws              → vocabulary={{ backlog, templates, template, dueThisWeek, dueNextWeek, later, noDate, unscheduled, unassigned, resources }}
    │   ├─ Narrow it — one rail, one date window              → slice={{ slice: Slice.bindRecords(key, { job: { source, range: "start" }, machines?, jobTemplates? }) }}
    │   └─ The app's optimiser                                → optimise={Func.bind(e3.function)}
    │
    ├─ Draw a state-transition flow over the app's records — the Flowchart
    │   ├─ A kind per record: its states, transitions, lanes, decisions → <Flowchart states={Flowchart.states(record, { label, lane, order, members? })} transitions={Flowchart.transitions(record, { from, to, decision?, kind?, evidence? })} lanes={Flowchart.lanes(record, { label, order })} decisions={Flowchart.decisions(record, { label, owner? })} />
    │   ├─ Editable, or read only                              → Record.bind(record) · Data.bind(record) (lanes and decisions: small records, read whole)
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
    │   ├─ What the host hears, and the connect veto           → onSelectState · onSelectLink · onSelectTrigger · onTracePath (⌥-click) · canConnect={fn → Option<String>}
    │   ├─ Top down, a minimap, no legend, read only           → orientation="TD" · minimap · legend={false} · readOnly
    │   ├─ On a phone: how many lanes in view, ‹ › through them → narrow={{ lanes?: 1 | 2 | 3 }} (2 by default; one where the details draw on the cards)
    │   └─ Edit it: lanes, states, transitions, one Save       → each kind Record.bind(record) over a record declaring mutation.patch(); Save writes each through its patch door
    │
    ├─ Draw the app's records at world coordinates — a floor, a site — the Schematic
    │   ├─ A kind per record, under its slot                   → <Schematic extent={{ width, height }} items={{ racks: Schematic.items(record, { name, icon, x, y, label, … }) }} zones={{ … }} links={{ … }} nets={{ … }} />
    │   ├─ Editable, or read only                              → Record.bind(record) · Data.bind(record)
    │   ├─ Narrow its kinds and templates — one rail           → slice={{ slice: Slice.bindRecords(key, { <a kind's slot>: { source: Data.bindPaged(record, { indexes }) }, … }) }} (+ the kind's entries: Data.bindPaged(record))
    │   ├─ A floor too large to read whole: a window at a time → its source lists index.area({ x, y, width, height, at: "centre", cell }); past 5,000 rows in view, their density
    │   ├─ Shapes from the row's own fields                    → footprint: (u) => some(Schematic.circle(u.radius)) · a zone's geometry: (a) => some(Schematic.polygon(a.corners))
    │   ├─ What a card draws from another record               → Schematic.items(…, { details: Schematic.details(record, { status, meter, metric, sublabel }) })
    │   ├─ The layers, from the app's record                   → layers={Schematic.layers(systems.read(), { label, order?, tone?, color?, visible?, locked?, opacity? })}
    │   ├─ Templates, the backlog, the index, the layers       → Schematic.templates(rows, { …, source }) · library={[Schematic.library.templates(), .backlog(), .index(), .layers()]}
    │   ├─ The app's own words for what it draws               → vocabulary={{ templates, backlog, index, layer, zone, net, link, source, destination }}
    │   ├─ An author's card dropped onto an entity             → Schematic.library.tab(rows, { …, drop: (r) => Schematic.patch(R, { … }) })
    │   ├─ The inspector, a kind's form and its own Details    → inspector · Schematic.items(record, { …, fields?, ready?, inspector? })
    │   └─ What the host hears, and the connect veto           → onSelect={fn(Array<Schematic.Types.Ref>)} · canConnect={fn(Schematic.Types.Candidate) → Option<String>}
    │
    ├─ Staff a week's shifts from the app's own duties — the Roster
    │   ├─ The duties: the app's record, a span kind                  → events={{ duty: Schedule.events(Record.bind(duties), { start, end, resource: { field, of }, shift, group, position?, activity?, hours? }) }}
    │   ├─ Who is rostered                                            → resources={{ people: Schedule.resources(staff.read(), { name, icon, label, group, … }), agencies? }}
    │   ├─ The lists it reads, over the app's rows                    → Roster.shifts / groups / positions / activities / proposals(rows, { … })
    │   ├─ Publish, and the targets: the app's weeks and cover        → periods={Schedule.periods(Record.bind(weeks), { every: "week", status, dismissed? })} · targets={Roster.targets(Record.bind(cover), { day, group, shift, positions, hours })}
    │   ├─ Costs in the app's own pay codes                           → pay={fn(Roster.Types.PayRequest(R)) → Roster.Types.Pay} currency="…"
    │   ├─ Who fits a Find fix: the app's fit, on e3                  → fit={Func.bind(e3.function)} from Roster.Types.FitRequest(R) to FitResult, over Roster.answer(R) + Roster.fit(R)
    │   ├─ The app's optimiser over the week                          → optimise={Func.bind(e3.function)} from Roster.Types.OptimiseRequest(R) to Roster.Types.OptimiseResult(R)
    │   ├─ Narrow its duties, targets, people, activities, patterns   → slice={{ slice: Slice.bindRecords(key, { duty: { source, range: "start" }, targets?, people?, activities?, patterns? }) }}
    │   ├─ People by week or by month                                 → view={{ layout: "people", period: "week" | "month", date }}
    │   ├─ Offer only some layouts, no switch with one left           → views={["people"]} or views={expr of Array<Roster.Types.Layout>}
    │   ├─ The app's own words for who is on it                       → vocabulary={{ permanent: "Employees", agency: "Contractors", others: "Colleagues" }}; a fit's reason: Roster.fit(R, { notALead })
    │   ├─ The shifts' colours, and the app's week patterns           → Roster.shifts(rows, { …, color }) · patterns={Roster.patterns(rows, {…})} · library={[…, Roster.library.patterns()]}
    │   └─ The week's figures in a task                               → Roster.coverage / check / weekHours / rest (R)
    │
    ├─ Book a day's arrivals into lane slots, each bin on its resources — the Allocation
    │   ├─ The bins: the app's record, an instant kind                → events={{ bin: Schedule.events(Record.bind(bins), { at, resource: { field, of: "<lanes>" }, arrival, quantity: { field, unit }, parts: { field, of: "<resources>" }, hold, kind? }) }}
    │   ├─ The lanes and the resources                                → resources={{ <lanes>: Schedule.resources(rows, { name, icon, label, offset? }), <resources>: Schedule.resources(rows, { name, icon, label, min, max, … }) }}
    │   ├─ What it books from                                         → arrivals={Allocation.arrivals(rows, { label, quantity, hold, kind?, values?, … })}
    │   ├─ Publish: the app's days                                    → periods={Schedule.periods(Record.bind(days), { every: "day", status })}
    │   ├─ Who fits where: the app's fit, on e3                       → fit={Func.bind(e3.function)} from Allocation.Types.FitRequest(R) to FitResult, over Allocation.answer(R) + Allocation.fit (+ Allocation.lookahead(R))
    │   ├─ The app's optimiser over the day                           → optimise={Func.bind(e3.function)} from Allocation.Types.OptimiseRequest(R) to Allocation.Types.OptimiseResult(R)
    │   ├─ Narrow its bins, lanes, resources and arrivals — one rail  → slice={{ slice: Slice.bindRecords(key, { bin: { source, range: "at" }, <lanes>?, <resources>?, arrivals? }) }}
    │   ├─ Its panes                                                  → library={[Allocation.library.arrivals(), Allocation.library.resources()]} · inspector
    │   ├─ The app's own words for what it holds                      → labels={{ lane, arrival, resource, quantity, bin, reservation, reserved, priorJob, nextJob, hold, groups: { overdue, ready, removed, allocated, free, loading, busy } }}
    │   ├─ The app's bin fields on the board, and its own issues      → columns={[{ key, label, text }]} · check={fn(CheckContext(R)) → Array<Issue>}
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
`options`. Bindings
take the def itself (`e3.input`, `e3.task`, `e3.record`, `e3.function`), so the
path and type are fixed when the IR is built.

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

### `Record.bind(record, mutations?)`

The handle to an `e3.record`: `read()`, `mutate.<name>(args…)` for each
mutation named in the list (with `mutate.status()`, `pending()`, `error()`),
`start()` to run the dataflow over the new state, and `history()` for its
commits. Builders take `Record.bind(record)` of a record declaring
`patch: mutation.patch()` and commit every Save through it; a stale Save is a
conflict naming the entry, and nothing is overwritten. `Record.onApply(record,
{ keyed? })` adapts a record for a host's `onApply`.

### `Func.bind(fn)`

A call handle for an `e3.function`. `call(args…)` is fire-and-forget and safe
in a sync `onClick`, latest-wins; the outcome arrives reactively through
`read()`, `status()`, `error()` and `pending()`. All handles bound to one
function share one channel, so one component can launch while another shows the
spinner. A call is the server's: it outlives the request that starts it, and
runs until its timeout — the server's ceiling, ten minutes locally — however
long that is, so an optimiser of several minutes is called the same way; the
server keeps it for its lifetime, with its arguments, the inputs it read, its
value and its logs (the **e3** skill). `cancel()` asks the server to stop the
call, and `status()` reads `cancelled`; a `call` that supersedes one in flight
asks the server to stop that one. A result is at most 1 MiB: a large one
belongs in a task, read with `Data.bind`.

A function that declares `inputs` (`e3.function(name, { inputs, args, output },
fn)`, the **e3** skill) is bound the same way: its handle's `call` takes the
`args` alone, and each call reads the inputs from the workspace as they are
stored when it launches. The page binds none of them; an optimiser's eye
(`optimise={Func.bind(fn)}`) passes its request as the one argument while the
function reads its reference data as inputs. `e3-ui:func.examples.tsx:funcBindInputs`
is the example.

```tsx
<Reactive>{$ => {
    const forecast = $.let(Func.bind(forecastFn));   // e3.function('forecast', East.function([IntegerType, FloatType], FloatType, …))
    const run = $.const(East.function([], NullType, $ => { $(forecast.call(12n, 1.05)); }));
    return (
        <VStack gap="3">
            <Button onClick={run} loading={forecast.pending()}>Run forecast</Button>
            <Stat label="Forecast" value={East.print(forecast.read())} />
        </VStack>
    );
}}</Reactive>
```

## The builders

`<Plan>`, `<Sheet>`, `<Record>`, `<Calendar>`, `<Roster>`, `<Allocation>`,
`<Flowchart>` and `<Schematic>` share one contract:

- **Data is the app's own records.** Each builder maps roles onto the app's
  fields (`title: "title", start: "start", resource: { field, of }`) and
  stores nothing in a shape of its own. Editable data is
  `Record.bind(record)` over a record declaring `mutation.patch()`.
  `Schedule.events` / `resources` / `templates` / `periods` are the shared
  vocabulary for kinds of events and resources (Plan, Calendar, Roster,
  Allocation).
- **Every gesture is a draft.** Drags, drops, typed cells and form edits are
  steps of one editing session with Undo / Redo, saved with one checked Save
  through each record's patch door (or the host's `onApply`). Drafts survive
  paging, narrowing and remount.
- **It renders in its own frame**: one toolbar, the canvas, a footer, and the
  panes its props ask for (`library`, `inspector`). Give it a box with a height.
- **One rail narrows it**: `slice={{ slice: Slice.bindRecords(key, { … }) }}`,
  each source named after what it narrows (an event kind's slot, a resource
  kind's slot, `rows`, a templates list's `source`), each
  `Data.bindPaged(record, { indexes })` over that record's declared indexes.
  Sources with a `range` share the one time window. Calculations (coverage,
  costs, loads, checks) read every record, whatever the rail hides.
  Templates lists are records, each naming its rail `source`.
- **Large records are read through their indexes** (declared in the record,
  the **e3** skill): an event kind through an interval index
  (`index.interval({ from: "start", to: "end" })`) with `range: "start"` and
  `entries: Data.bindPaged(record)` for reads by key; events on paged
  resources a cell at a time through `index.series` + `index.summary`; a
  drawing a window at a time through `index.area`.
- **The app's optimiser**: `optimise={Func.bind(fn)}`, an `e3.function` from
  the builder's `Types.OptimiseRequest` to its `Types.OptimiseResult`; its
  answer lands as one undoable step.
- **Which views an instance offers**: a component that switches between views
  takes `views` — the Roster's, Calendar's and Allocation's layouts, the
  Ontology's display modes and `<Query.Builder>`'s
  Visual · jq (and `resultViews`, Table · Tree). Literal tags (`views={["people"]}`),
  variants of its `Types`, or an expression of an array of them, so a page's state
  can choose them as it runs. Left out, or empty as the page runs, every view; one
  left, no switch shows in any form of the toolbar; the component's own order
  stands. `e3-ui:roster.examples.tsx:rosterViews` wires a multi-select into it.
  `<DecisionQueue>`'s `facets` is the same.
- **Which periods an instance offers**: `viewPeriods` on `<Roster>` and
  `<Calendar>` does the same for Day · Week · Month. (A Plan's are its axis's
  `resolutions`.)
- **Misuse is refused at build**, naming the change — forms from earlier
  releases included — so read the error rather than guessing.

| Builder | What it draws | Start from |
|---|---|---|
| `<Plan>` | Heterogeneous rows on one time / number / ordinal axis: series over data, event kinds over records, read-only rows | `e3-ui:plan-events.examples.tsx:planEvents` (smallest), `e3-ui:plan.examples.tsx:planTargetState`, `e3-ui:plan-windows.examples.tsx:planWindows`, `e3-ui:plan-records.examples.tsx:planRecordIndexes` |
| `<Sheet>` | A planning spreadsheet over a record, the host's rows or a paged source: typed columns, registers, groups, copilot, Excel round-trip | `e3-ui:sheet.examples.tsx:sheetBasic` (smallest), `e3-ui:sheet.examples.tsx:sheetWorkshop`, `e3-ui:sheet.examples.tsx:sheetPaged`, `e3-ui:sheet-records.examples.tsx:sheetRecordIndexes` |
| `<Record>` | A system of records' rows as a table: the Sheet's kinds with title, person, boolean, toggle, cycle, age and audit; column groups, Add and Delete | `e3-ui:record.examples.tsx:recordBasic` (smallest), `e3-ui:record.examples.tsx:recordSkillsMatrix`, `e3-ui:record.examples.tsx:recordEveryKind` |
| `<Calendar>` | Calendar, Resources and Timeline layouts over event records with a backlog | `e3-ui:calendar.examples.tsx:calendarMinimal` (smallest), `e3-ui:calendar.examples.tsx:calendarOperations`, `e3-ui:calendar-records.examples.tsx:calendarRecordIndexes` |
| `<Roster>` | Weekly staffing: duties over people by shift, cover targets, pay, fit, publish | `e3-ui:roster.examples.tsx:rosterMinimal` (smallest), `e3-ui:roster.examples.tsx:rosterWarehouse`, `e3-ui:roster.examples.tsx:rosterPeople` |
| `<Allocation>` | A day's arrivals booked into lane slots, each bin on resources | `e3-ui:allocation.examples.tsx:allocationMinimal` (smallest), `e3-ui:allocation.examples.tsx:allocationKilnYard`, `e3-ui:allocation.examples.tsx:allocationFitRule` |
| `<Flowchart>` | States in ordered lanes, transitions and decisions, a record of the app's each, the app's details drawn on the cards and labels | `e3-ui:flowchart.examples.tsx:flowchartDwell` (smallest), `e3-ui:flowchart.examples.tsx:flowchartDepot`, `e3-ui:flowchart.examples.tsx:flowchartDepotEditing`, `e3-ui:flowchart.examples.tsx:flowchartTicketMinutes`, `e3-ui:flowchart.examples.tsx:flowchartDepotTopDown` |
| `<Schematic>` | Items, zones, links and nets at world coordinates | `e3-ui:schematic.examples.tsx:schematicFloor` (smallest), `e3-ui:schematic.examples.tsx:schematicDataCentre`, `e3-ui:schematic-records.examples.tsx:schematicRecordIndexes` |

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
  union of their reads.
- **Queries.** One `Query.Types.Saved` record with a patch mutation holds the
  saved jq queries; `Query.value(sources, queries)` ships some, checked at
  build. `<Query.Builder queries datasets />` edits a query as steps or jq,
  checks it, runs it on e3 (split over a large dataset's pieces) and saves it;
  `<Query.Library>` lists them. A split run's plan read-out says how many
  pieces it cut and how many units e3's cache served; `first(…)` and
  `limit(n; …)` over a dataset's rows split too, stopping once they have their
  rows; a run given up — a new run, or the builder going — cancels its split
  call's job; and a split answer too large for one, with no final step, is
  read a page at a time in the Table and the Tree.

## Rendering surfaces in an app — `<E3Provider>`

A deployed `ui()` task renders in a React app through
`@elaraai/e3-ui-components`: `<E3Provider config>` names the e3 and how
requests reach it, `<ReactiveDatasetProvider>` inside it installs the bindings'
adapters, and `<UITaskPreview task="…">` fetches and renders a task's output.

| `E3Config` | Meaning |
|---|---|
| `apiUrl` | **required** — the e3 API's base URL |
| `repo` | the repository; `"default"` when omitted |
| `workspace` | the workspace the bindings read and write |
| `token` | a bearer token, or `null`; read afresh for every request |
| `fetch` | the `fetch` requests go through; for an e3 running in the page, the one `createWebE3` gives (e3-web, the **e3** skill) |

`E3Provider` also takes a `queryClient` to share a TanStack Query cache. Wrap
the app in `<I18nProvider locale="…">` (re-exported from
`@elaraai/east-ui-components`) to set the locale every surface prints numbers
in; dates print in UTC.

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
                <Button variant="outline" onClick={discard} disabled={t.pending().not()}>Discard</Button>
                <Button variant="solid" onClick={commit} disabled={t.pending().not()}>Apply</Button>
            </HStack>
        </VStack>
    );
}}</Reactive>
```

### A record's mutation from a button

```tsx
<Reactive>{$ => {
    const r = $.let(Record.bind(counter, ["increment"]));
    const bump = $.const(East.function([], NullType, $ => { $(r.mutate.increment(1n)); }));
    return (
        <VStack gap="2">
            <Stat label="Counter" value={East.print(r.read())} />
            <Button onClick={bump} loading={r.mutate.pending()}>Increment</Button>
            <Text>{r.mutate.status().getTag()}</Text>
        </VStack>
    );
}}</Reactive>
```

### Disable controls on stale data

```tsx
<Slider value={t.read()} onChangeEnd={t.writeAndStart} disabled={t.status().hasTag('stale')} />
```

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
