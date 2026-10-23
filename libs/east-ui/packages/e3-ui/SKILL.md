---
name: e3-ui
description: "e3 + UI bridge — build interactive, reactive decision surfaces as e3 tasks, authored as JSX. Use when: (1) Declaring UI tasks with ui() (e3 tasks of kind 'ui' producing a UIComponentType), (2) Binding reactive workspace data with Data.bind (read/write/has/commit/discard/status against e3.input / task defs) inside a <Reactive>{$ => …}</Reactive> block, (3) Staged vs direct edit modes and reviewing pending changes with the <Diff> tag, (4) Graph/ontology editing with the <Ontology> tag, (5) Calling named package functions (e3.function) RPC-style with Func.bind (call/read/status/error/pending/cancel), (6) Wiring a manifest (reads/writes + bound functions auto-derived from a UI task's IR), (7) Interactive causal-experiment surfaces ('did X change Y?') with the <Experiment> tag, generic over a bound dataset's row and driven by e3.function estimators, (8) The Decide loop — Decision.bind unions reasoning-task decision outputs into one handle (shared selection + commit gate), <DecisionQueue> (urgency-sorted queue with evidence/options/judgement/modify facets, Apply/Reject, grouping, an author-bound Slice scope) and <DecisionJournal> (the resolved read-back), (9) The Studio — Studio.component declares a self-contained East UI function (written exactly like a ui() body) with what the palette shows; the pages operators build are one record of Studio.Types.Pages with one patch write; <Studio.Builder> is the builder — the open page's canvas under one toolbar (its status, the history, Desktop · Tablet, Save as template, Preview and Publish), the palette of the listed components and the project's pages before it, the inspector of the selected placement after it, and the publish preview in its place — every gesture a draft, Save one patch on the page, and a publish stamping each placement with the code it goes live with; <Studio.Library> is a project's templates and pages and where new pages start, opening pages in the builder; <Studio.Page> draws one page's live or draft layout with no chrome, (10) Rendering deployed surfaces in a React app with @elaraai/e3-ui-components — <E3Provider> (E3Config: apiUrl, repo, workspace, token, fetch), <ReactiveDatasetProvider> and <UITaskPreview> — over a server, or over an e3 running in the page (e3-web's createWebE3 and its e3.fetch), (11) Queries — operators build typed jq queries over the datasets a surface binds and save them to one record of Query.Types.Saved with one patch write; <Query.Builder> edits the open query as plain-word steps or as jq, checks it as it is edited, runs it on e3 as a one-shot call — or as a split call over the pieces of a dataset larger than one piece, its plan explained — and shows the result as a Table or a tree; <Query.Library> is the saved queries as a gallery of wireframes and where new queries start, opening them in the builder, (12) The Plan — <Plan>, the one planning canvas, always in its builder frame — one toolbar holding every control it has, the banners, the canvas, the footer's counts: heterogeneous rows on ONE shared { time | number | ordinal } axis from three sources — event kinds over records (Schedule.events placed on Schedule.resources, the kinds a Calendar takes), rows laid out by a series list over local data or a Data.bindPaged source and nested from the data's own structure, and read-only rows (Plan.over a dataset, hand-built rows) — its panes optional props — a library (every event kind's templates, the backlog by when it is due, the series a viewer shows and hides, and cards of the author's own whose drop sets a Schedule.patch) and an inspector of what is selected (one event, several, a row at a bucket, or the window's counts; an event kind's own inspector in place of its form) — with one Slice.bindRecords rail (its rows, each event kind, resource kind and templates record a source, one window; an event kind on paged resources read a cell at a time through a series index and shaded from a summary index zoomed out), key search, links between runs or events, and an editing session — dropped cards and moved or resized runs, chips, tiles and marks as drafts with Undo / Redo and one checked Save — its authoring vocabulary on `Plan` (Plan.axis, Plan.series.*, Plan.over, Plan.eventRef, Plan.library.*, the value builders), (13) The Sheet — <Sheet>, the one planning spreadsheet, always in its builder frame — one toolbar holding every control it has, the banners, the grid with its docked strip, the footer — its panes optional props: a library (templates, columns, the author's cards) and an inspector of the selected row's every field or the author's own; its rows from an e3 record bound with its patch door (the record's entries, one entry's rows or groups with loose rows between them, or a large record a window at a time — Save one patch commit through the record) or the host's (an array, a bind handle, a Data.bindPaged source with a key search), or the `rows` source of its one Slice.bindRecords rail — the record's rows, the source's narrowing drawn over them as the lens (each match at its row number, context rows either side, gaps of their size over the rest, e3 placing the matches from the index) — the rail narrowing its templates records too; typed columns (dates, quantities with units, register lookups, a directed link between register members, stamped codes), a blank tail that invites the next row, an East-function copilot that fills cells and proposes rows, saved-view tabs over every source's narrowing, groups with loose rows between them and read-only sub rows, drag and drop, Excel round-trip, and an editing session — drafts checked as they are made, Undo / Redo and one checked Save — its authoring vocabulary on `Sheet` (Sheet.column.*, Sheet.register.*, Sheet.driver, Sheet.group, Sheet.subRows, Sheet.library.*, Sheet.field, Sheet.apply). (14) Calendar — the record-backed scheduling builder in e3-ui: Calendar, Resources and Timeline layouts, bound resource and template records, the event record’s unscheduled backlog, one Slice.bindRecords rail — a source per event kind, resource kind and templates record, one date window — shared Toolbar/Library/FieldForm/EditSession behavior, and explicit agenda/card actions below 480px. BuilderFrame remains internal. (15) Roster — weekly staffing over the app's own records: its duties a Schedule.events kind (start, end, resource, shift, group, position?, activity?, hours?), its people and agencies Schedule.resources kinds, its weeks Schedule.periods for Publish, its cover Roster.targets, and its shifts, groups, positions, activities and proposals read through Roster.* accessors; Shifts and People layouts; pure coverage/rules over the duty row type; the app's pay in its own codes, asked a person at a time; Find fixes on the app's fit e3.function (Func.bind, Roster.fit(R)); the week's duties read through the slice's duty source; one Slice.bindRecords rail over the duties, targets, people and activities; one history over a session per record, Save per record and Publish saving first, then the week's status; and explicit mobile actions. (16) The Flowchart — <Flowchart>, the state-transition flowchart, always in its builder frame — one toolbar (find state, LR · TD, the freshness chip, the rail of its one Slice.bindRecords, and where it edits the history item), the canvas filling main, the footer's counts: states as nodes in ordered phase lanes (the layout derived, no coordinates), H/V-routed transitions, decision triggers and evidence-weighted links, over an e3 record of flows by name (Flowchart.Types.Flows, its value written with Flowchart.values and checked at build — a lone flow is a record of one entry) or the host's flows or one flow (data, the value's type picking the arm — Flowchart.over builds one flow from the host's own tables with row mappers); its library pane's Flows tab (Flowchart.library.flows()) lists the flows by name — over a record those its rail's `flows` source narrows it to, counted — and opens one, the open flow kept under the flowchart's name, and '+ New flow' starts one, beside state and transition templates, templates records (Flowchart.library.states / transitions), and the author's own cards (Flowchart.library.tab), each following the source of the rail it names, and each card dropped on the canvas — a state template onto a lane, a transition template onto a transition, an author's card where its drop's type says, ⏎ on a card onto the selection; every gesture on the canvas — '+ LANE', a lane renamed (a double-click on its header) or deleted, a state added, edited, moved or deleted, a handle dragged to connect, Del on the selection — one transaction of the open flow's editing session, each flow keeping its own drafts, with Undo / Redo and one checked Save through the record's patch mutation or the host's onApply; its inspector pane, on by default (inspector={false} takes it away) — Details for the state, transition, decision, lane (a click on its header) or several states selected, or the open flow, each through the shared form, a state's or a transition's own Details in its place with inspector={{ state, transition }}, and Issues, each selecting what it names; with selection and path tracing — its types on Flowchart.Types, a row patch from Flowchart.patch. (17) The Allocation — <Allocation>, a day's arrivals booked into timed lane slots and each bin's quantity allocated to resources with room and time for its hold, always in its builder frame, as a Timeline (lanes, links, resource rows) or a Table (a row per slot), over the app's own records: its bins an instant Schedule.events kind (at, resource, arrival, quantity, parts, hold, kind?), its lanes and resources Schedule.resources kinds (offset; min, max, note, hold, jobs), what it books from Allocation.arrivals (each arrival's values a booked bin's own fields), and its days Schedule.periods for Publish — one history over the bins' and the days' sessions, every gesture a draft, Save per record and Publish saving first, then the day's status — the app's fit an e3.function bound with Func.bind (a place or a take question about the drafted day, FitRequest(R) over the bin row type, built on Allocation.answer / fit / lookahead), split loads and Find a fit, the app's bin fields as columns and its own check over CheckContext(R), one Slice.bindRecords rail over the day's bins, its lanes, resources and arrivals, the shared Library, Inspector and session, explicit-action cards below 480px, and pure loads / candidates / check / slots over Day(R) a task runs too. (18) The Schematic — <Schematic>, the 2D world-coordinate drawing of the app's own records: a kind per record, keyed by String, its fields mapped to the Schematic's roles and its shapes made by accessors over the row's own fields — items (Schematic.items: a centre, a box, a footprint drawn about the centre, a label, a status, a meter, a figure), zones (Schematic.zones: a box, outlined or hatched, a geometry about its centre), links between two items (Schematic.links: from and to naming item slots) and nets joining many to many (Schematic.nets: sources and destinations) — each kind editable bound with its patch door (Record.bind) or read only (Data.bind), read whole or complete through its source of one Slice.bindRecords rail (entries: Data.bindPaged), its details a record keyed as it is (Schematic.details), its templates a record (Schematic.templates), its layers the app's rows (Schematic.layers), the library's tabs over every kind (Schematic.library.templates() / backlog() / index() / layers() / tab), each card dropped on the canvas — an item template adds an item at the point, a backlog row is placed there, a link or net template gives a link or a net of its kind its values, an author's card sets its Schematic.patch's fields, ⏎ onto the selection or at the view's centre — the inspector opted into: Details through the shared form over each kind's fields and its details', an item's position, a link's ends and a net's sides, and Issues, each selecting what it names; a camera with a minimap, selection by a tap, Shift and the marquee, and every gesture — Move, Connect and a Shift session growing a net, an end retargeted, a net extended, Del — one step of one history over a session per record it writes, with Undo / Redo and Save sending each record's changes through its patch door, canConnect answering each pair with none or the refusal's words; onSelect hears the whole selection, each entity by its kind's slot and its key — its shapes and types on Schematic (Schematic.circle / polyline / polygon / rect about the anchor, outline / hatch, solid / dashed, Schematic.patch, Schematic.Types)."
---

# e3-ui — e3 + UI Bridge

`@elaraai/e3-ui` connects **east-ui** JSX tags to **e3** workspaces. You author a
decision surface as a first-class e3 **UI task** whose reads and writes against
workspace datasets are tracked in a manifest — so the engine knows what data the
UI depends on and can re-render reactively. With staged writes, `<Diff>` review,
and commit / discard, a view becomes a place a user commits a decision with its
evidence — not a read-only report.

The public surface is **JSX tags + platform helpers**, all from one import
(`@elaraai/e3-ui`): the e3-specific tags `<Diff>`, `<Ontology>`, `<Experiment>`, `<Plan>`, `<Sheet>`, `<Calendar>`, `<Roster>`, `<Allocation>`, `<Flowchart>` and `<Schematic>`, the `Data` and `Func`
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
    │   ├─ Narrow its rows, event kinds, resources, templates → slice={{ slice: Slice.bindRecords(key, { rows?, job?, presses?, jobTemplates? }) }} (one window; Schedule.templates(rows, { …, source }))
    │   ├─ Event kinds over records too large to read whole   → a kind's source over its interval index (range: "start") + Schedule.events(record, { entries }); with no rail, { window, backlogWindow, entries }; Schedule.resources(Data.bindPaged(record), {…})
    │   ├─ …read a cell at a time, shaded when zoomed out     → the kind's source lists e3.recordIndex.series + e3.recordIndex.summary beside its interval index (its resources paged)
    │   ├─ A link between two runs, or two events             → Plan.link({ from: Plan.ref(…), fromRun, … }) / Plan.link({ from: Plan.eventRef(kind, key), … })
    │   ├─ Its library pane: templates, backlog, series, cards → library={[Plan.library.events(), Plan.library.backlog(), Plan.library.series(), Plan.library.tab(rows, {…})]}
    │   ├─ Its inspector pane: what is selected               → inspector (+ an event kind's own: Schedule.events(record, { inspector }))
    │   ├─ Event kinds dragged: templates, backlog, moves     → built in with resources + events (+ library); canDrop={fn(Schedule.Types.Candidate) => Option<String>}
    │   ├─ Overlap warnings, without dropping overlapping events → Schedule.events(record, { overlaps: "warn" | "allow" }); the chip selects the first pair
    │   ├─ Save each changed event kind through its patch door → applyMode="batch" (default); "auto" commits each ready gesture
    │   └─ Dropped cards and moves as drafts                  → a series' edit + editing={{ onUpdate | onApply }}
    │
    ├─ Let planners type rows in place — the Sheet, in its frame (see The Sheet below)
    │   ├─ An e3 record edited as a sheet                     → <Sheet record={…} columns={{…}} /> (record = Record.bind(r, [patch]))
    │   │   ├─ One entry's rows, groups or loose rows          → entry={{ key, rows: "field", id: "id" }} (+ group)
    │   │   └─ A large record, a window at a time             → window={Data.bindPaged(r)}
    │   ├─ The host's rows                                    → <Sheet data={…} id="id" columns={{…}} />
    │   ├─ Narrow its rows and templates — one rail          → slice={{ slice: Slice.bindRecords(key, { rows, rowTemplates, … }) }} (the record's rows, `rows`' narrowing drawn over them as the lens; Sheet.templates(rows, { …, source }))
    │   ├─ Its panes, each optional                           → library={[Sheet.library.rows(), Sheet.library.columns(), Sheet.library.tab(…)]} · inspector (+ fields)
    │   ├─ Its columns, registers and the driver               → Sheet.column.* / Sheet.register.* / Sheet.driver
    │   ├─ Groups, loose rows between them, read-only sub rows → Sheet.group / Sheet.Types.Entry / Sheet.subRows
    │   ├─ Data too large to hold whole                        → data={paged}, a Data.bindPaged handle
    │   └─ Drafts checked as they are made, one checked Save   → onUpdate | onApply, ready, newRow
    │
    ├─ Draw a state-transition or process flow — the Flowchart (see The Flowchart below)
    │   ├─ An e3 record of flows by name                              → <Flowchart record={…} flow="…" /> (record = Record.bind(r, [patch]), r of Flowchart.Types.Flows)
    │   ├─ The record's value, written as literals                    → Flowchart.values({ [name]: { lanes, states, links, triggers? } }) (a lone flow: one entry)
    │   ├─ One flow of the host's, an input's value                   → <Flowchart data={Data.bind(input)} /> (the input's value Flowchart.value({ … }))
    │   ├─ One flow from the app's own tables                         → <Flowchart data={Flowchart.over(states, { state, links, link, lanes, triggers?, trigger? })} />
    │   ├─ Decision triggers and evidence on the transitions          → a flow's triggers, a link's trigger / evidence
    │   ├─ Selection and ⌥-click path tracing                         → onSelect*, onTracePath (a click on a lane's header selects the lane)
    │   ├─ Its inspector: what is selected, and the open flow's issues → on by default (inspector={false} takes it away); a state's or a transition's own Details → inspector={{ state, transition }}
    │   ├─ Its frame: find state, LR · TD, the rail, the footer       → in its frame wherever it is used; give it a box of its own height
    │   ├─ The flows listed by name, one opened, new ones started     → library={[Flowchart.library.flows()]} (the open flow kept under `name`)
    │   ├─ Narrow its flows, templates and tabs — one rail            → slice={{ slice: Slice.bindRecords(key, { flows?, steps?, … }) }} (`flows` over the same record, counted in the Flows tab)
    │   ├─ State and transition templates, the author's own cards     → library={[…, Flowchart.library.states(templates.read(), {…, source }), Flowchart.library.transitions(templates.read(), {…, source }), Flowchart.library.tab(rows, {…})]} (templates records, each naming its source of the rail)
    │   ├─ A card dropped on the canvas, or ⏎ on it                   → a state template onto a lane, a transition template onto a transition, an author's card where its drop's type says; ⏎ onto the selection
    │   └─ Edit a flow: lanes, states, transitions — Undo, one Save   → record={…}, or data={…} + onApply (every canvas gesture a draft; canConnect vetoes a pair)
    │
    ├─ Draw the app's records at world coordinates — a floor, a site — the Schematic (see The Schematic below)
    │   ├─ A kind per record, under its slot                   → <Schematic extent={{ width, height }} items={{ racks: Schematic.items(record, { name, icon, x, y, label, … }) }} zones={{ … }} links={{ … }} nets={{ … }} />
    │   ├─ Editable, or read only                              → Record.bind(record, [e3.mutation.patch(record)]) · Data.bind(record)
    │   ├─ Every gesture one step: Undo, Save per record       → built in over an editable kind: Move, Connect (Shift grows a net), an end retargeted, a net extended, Del
    │   ├─ Narrow its kinds and templates — one rail           → slice={{ slice: Slice.bindRecords(key, { <a kind's slot>: { source: Data.bindPaged(record, { indexes }) }, … }) }} (+ the kind's entries: Data.bindPaged(record)) · narrowed="dim"
    │   ├─ Shapes from the row's own fields                    → footprint: (u) => some(Schematic.circle(u.radius)) · a zone's geometry: (a) => some(Schematic.polygon(a.corners))
    │   ├─ What a card draws from another record               → Schematic.items(…, { details: Schematic.details(record, { status, meter, metric, sublabel }) })
    │   ├─ The layers, from the app's record                   → layers={Schematic.layers(systems.read(), { label, order?, tone?, color?, visible?, locked?, opacity? })}
    │   ├─ Templates, the backlog, the index, the layers       → Schematic.templates(rows, { …, source }) · library={[Schematic.library.templates(), .backlog(), .index(), .layers()]}
    │   ├─ A card dropped on the canvas, or ⏎ on it            → an item template adds an item at the point, a backlog row is placed there, a link or net template onto one of its kind; an author's card onto an entity: Schematic.library.tab(rows, { …, drop: (r) => Schematic.patch(R, { … }) }); ⏎ onto the selection
    │   ├─ The inspector, a kind's form and its own Details    → inspector · Schematic.items(record, { …, fields?: { f: Fields.* }, ready?: (row, key) => Readiness, inspector?: East.function([R, FunctionType([R], NullType)], UIComponentType, …) })
    │   └─ What the host hears, and the connect veto           → onSelect={fn(Array<Schematic.Types.Ref>)} · canConnect={fn(Schematic.Types.Candidate) → Option<String>}
    │
    ├─ Staff a week's shifts from the app's own duties — the Roster (see Roster below)
    │   ├─ The duties: the app's record, a span kind                 → events={{ duty: Schedule.events(Record.bind(duties, [dutiesPatch]), { start, end, resource: { field, of }, shift, group, position?, activity?, hours? }) }}
    │   ├─ Who is rostered                                           → resources={{ people: Schedule.resources(staff.read(), { name, icon, label, group, … }), agencies? }}
    │   ├─ The lists it reads, over the app's rows                   → Roster.shifts / groups / positions / activities / proposals(rows, { … })
    │   ├─ Publish, and the targets: the app's weeks and cover       → periods={Schedule.periods(Record.bind(weeks, [weeksPatch]), { every: "week", status, dismissed? })} · targets={Roster.targets(Record.bind(cover, [coverPatch]), { day, group, shift, positions, hours })}
    │   ├─ Costs in the app's own pay codes                          → pay={fn(Roster.Types.PayRequest(R)) → Roster.Types.Pay} currency="…"
    │   ├─ Who fits a Find fix: the app's fit, on e3                 → fit={Func.bind(e3.function)} from Roster.Types.FitRequest(R) to FitResult, over Roster.answer(R) + Roster.fit(R)
    │   ├─ Narrow its duties, targets, people and activities         → slice={{ slice: Slice.bindRecords(key, { duty: { source, range: "start" }, targets?, people?, activities? }) }}
    │   └─ The week's figures in a task                              → Roster.coverage / check / weekHours / rest (R)
    │
    ├─ Book a day's arrivals into lane slots, each bin on its resources — the Allocation (see Allocation below)
    │   ├─ The bins: the app's record, an instant kind               → events={{ bin: Schedule.events(Record.bind(bins, [binsPatch]), { at, resource: { field, of: "<lanes>" }, arrival, quantity: { field, unit }, parts: { field, of: "<resources>" }, hold, kind? }) }}
    │   ├─ The lanes and the resources                               → resources={{ <lanes>: Schedule.resources(rows, { name, icon, label, offset? }), <resources>: Schedule.resources(rows, { name, icon, label, min, max, … }) }}
    │   ├─ What it books from                                        → arrivals={Allocation.arrivals(rows, { label, quantity, hold, kind?, values?, … })}
    │   ├─ Publish: the app's days                                   → periods={Schedule.periods(Record.bind(days, [daysPatch]), { every: "day", status })}
    │   ├─ Who fits where: the app's fit, on e3                      → fit={Func.bind(e3.function)} from Allocation.Types.FitRequest(R) to FitResult, over Allocation.answer(R) + Allocation.fit (+ Allocation.lookahead(R))
    │   ├─ Narrow its bins, lanes, resources and arrivals — one rail → slice={{ slice: Slice.bindRecords(key, { bin: { source, range: "at" }, <lanes>?, <resources>?, arrivals? }) }}
    │   ├─ Its panes                                                 → library={[Allocation.library.arrivals(), Allocation.library.resources()]} · inspector (+ the bin kind's own inspector)
    │   ├─ The app's bin fields on the board, and its own issues     → columns={[{ key, label, text }]} · check={fn(CheckContext(R)) → Array<Issue>}
    │   └─ The board's figures in a task                             → Allocation.loads / candidates / check / slots (R)
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

### Indexed records and shared Slice

Declare field indexes with `e3.recordIndex(name, record, { on: [fields...] })`,
or computed indexes with `key` / `keys`. Their existing declared key types
supply the controls; do not redeclare those types in Slice. A scalar computed
key uses the index name as its field; a Struct key supplies named fields in
key order. `keys` accepts a scalar or a single-field Struct and permits one
exact member, keeping pages and counts unique by primary ID. Arbitrary
compound fan-out remains available through `{ index }`; Slice refuses it.
`Data.bindPaged(record, { indexes: [declarations...] })` carries their field/key
types and joins rows by default. The indexes a binding lists carry one
projection, or each carries the whole row — as an area index does — or
nothing: one that carries the row is read without a join, the others with one,
and any other mix is refused at build, naming the index.

**A builder narrows through `Slice.bindRecords` alone** (#1340): one rail on
its toolbar, `Slice.bindRecords(key, { [source]: { source:
Data.bindPaged(record, { indexes }), label?, icon?, fields, range?, search?,
initial? } }, { presets? })`, passed as `slice={{ slice, affordances?,
persist? }}`. Each source is named after what it narrows and filters every
place its records appear — the main area, the Choosers and the Library tab
that lists them; the Sheet's `rows` source draws its narrowing over the
record's rows as the lens instead (#1349) — and the builder reads each
source's keys itself. Every
source with a `range` shares the builder's one time window. Calculations —
coverage, costs, loads, checks, totals — read every record, whatever the
rail hides. Refused at build, each naming the change: `Slice.bind`, a single
`Slice.bindRecord`, a source the builder does not take,
`data={Slice.rows(slice)}` or `window={Slice.rows(slice)}`, the Roster's
`visiblePeople`, and an event kind's own `slice` or `filter`. Every
builder has moved: the Allocation, the Roster, the Calendar, the Plan, the
Sheet, the Flowchart and the Schematic.

Templates are records: each templates list reads a templates record and names
its source of the rail (`source`), and a list written in the code is refused.
A record a builder reads whole beside its pages — a templates list, the
resources a check reads — binds with `Data.bind`: a UI task's manifest
preloads it, but never a record `Record.bind` reads beside `Data.bindPaged`,
whose `read()` then fails on e3. `Record.bind` stays the mutation door a Save
commits through. east-ui's own Table, Library and charts keep
`Slice.bind`. Existing single-index `Data.bindPaged(record, { index, join })`
remains separate.

Controls come from indexed field types: unit Variant/Boolean/hints become choice
chips; Strings use prefix suggestions; numbers/dates use typed ranges; Options
add Unset; Sets permit one exact member. Counts are exact original-record counts,
pending until known. The rail's summary names, in each source's own words, the
sources a narrowing hides rows of (`2 of 30 print job events`), and nothing while
none does; folded, its Filters popover heads each source's fields with the
source's count, as a Library tab counts — `6`, or `2 of 30` while narrowed
(#1358). Only a supported path through one index can combine choices.
Never filter resident pages or materialize a record to discover its choices.
Local arrays use `Slice.bind(key, rows, options?)`; neither arm needs a type
argument for `Slice.rows(slice)`.

Calendar event windows preserve overlap with `[from, to)`, including carry-in
and whole-window spans. Declare an interval index, `e3.recordIndex.interval(name,
record, { on?, from: "start", to: "end" })` (optional leading `on` fields), name
the event kind's source after its slot with `range: "start"` (`job: { source:
Data.bindPaged(jobs, { indexes: [jobsByTime] }), range: "start" }`), and give
the kind `entries: Data.bindPaged(jobs)` for its original-key reads. A kind
narrowed through its source takes no `window` or `backlogWindow`. Do not
replace it with a start-only query or guessed lookback. Optional missing ends
are instants; an instant at `from` is included and one at `to` is excluded.
Backlog remains part of the same authoritative record.

A **window over a drawing** — the rows whose box meets a viewport — reads
through an area index (`e3.recordIndex.area`, the **e3** skill) listed in a
source's binding: `Data.bindPaged(racks, { indexes: [racksByArea,
racksByHallArea] })`. A read of the source takes the viewport as a `window`
choice, `variant("window", { minX, minY, maxX, maxY })` in world units, under
the index's `__area` field of its `where` (a source's `pageWhere` and
`countWhere`), beside exact choices of the fields the index leads with. The
record slice plans it as at most 266 searches a combination of those choices,
sent in one request, and reads every row whose box meets the viewport grown by
an eighth of its larger side, each once — beside rows of the searched cells
that it misses, which the reader draws or not. `variant("values", ["-1"])`
under `__area` is the unplaced clause: the rows not yet placed, on an index
whose `x` and `y` are Options. The window is the reader's, never the rail's:
`Slice.bindRecord` offers no `__area` field, and a window under any other
field is refused. A read no listed area index serves — choices beside the
window no area index is led by exactly, a range or a prefix beside it, or more
than one value of a Set field, which would read a row twice — is refused,
naming why. An area index carries its rows,
so a window reads the index alone, without a join, each entry's `value` its
row.

Sessions retain original-key drafts across paging, narrowing and remount in the
same UI store. Save includes hidden edits and confirms primary rows at the
committed revision. A saved row leaving the narrowing produces footer feedback;
moving off a resident page does not. Slice persistence saves query state, not
unsaved drafts. The Roster and the Allocation keep a session for each record
they write — the Roster's duties, weeks and targets, the Allocation's bins and
days — under one history: Save sends each record's drafts as its own request,
and their figures read every person, resource and event of the period,
whatever the rail shows.

Search examples: `planRecordIndexes`, `sheetRecordIndexes`,
`calendarRecordIndexes`, `rosterRecordIndexes`, their Mobile counterparts,
and `flowchartRecordIndexes` (scalar, compound and membership computed keys).
Each shows its full reactive bindings and JSX inline.

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
const slice = $.let(Slice.bind('ops.queue.slice', handle.queue(), {
    fields: { kind: { label: 'Kind' }, title: { label: 'Title' }, value: { label: 'Value' } },
    search: ['kind', 'title'],
    initial: { kind: ['roster'] },
}));
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
one entry it writes: the builder's Save (the page's draft cells), its Publish
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
  redoes, discards and saves, and ⌘Z / Ctrl+Z undo from anywhere in the
  builder. Save is one patch commit on the page; a save another write beat is
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
  live version; the Audience and Rollout rows; Save as draft, which saves the
  canvas's drafts; and Publish, which saves them first, then commits the
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
  the history item; Save commits the query as one patch of its one entry,
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
marks), each named by a typed id, with one rail (`Slice.bindRecords`,
#1344), a key search and a series library, an editing session (every dropped
card, move and resize a draft, #880 / #825) and paged sources. It renders in its builder
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
<Plan axis={Plan.axis({…})} data={rows} series={[Plan.series.span(Row, {…}), …]} /> — the planning canvas: ONE shared axis — { time | number | ordinal } (#631): a UTC window ÷ resolution, a numeric window ÷ step, or an ordinal list = n bucket columns — over heterogeneous rows — the eight row kinds: span state-runs, bucket allocation lanes, chart measures, heat cells, bucketed table numerals, cards shift chips, event marks, and group strips — sliced, searched and picked as one surface. Rows derive from `data` through `series` as an ordered STREAM (#822): the series list IS the layout (one contiguous block per series, top to bottom), a parent is followed by its subtree, and hierarchy comes only from the data's own nesting — never from a field value. Every row carries a typed id, `Plan.Types.RowId` = { series, path } (the series that made it and the entry keys that lead to it; `Plan.ref` builds one), which every callback reports and `links` address. Nothing behaves differently because `data` is inline or paged
├─ The frame (#1193): ONE toolbar holding every control the Plan draws outside its canvas, in this order — the rail of its one `Slice.bindRecords` (each source's field chips and the presets, #1344), the key search, Expand/Collapse all, the shared date navigator (on a number axis the leading source's range is a chip of the rail), the configured resolution, the diagnostics; at its end the rail's summary, naming each source a narrowing hides rows of in its own words (#1358), the overlaps chip and the history item (a Plan with none of them has no toolbar). It is one row at every width: the rail folds first, its summary after every step of it, then the date navigator compacts, the resolution folds into a menu and Expand/Collapse all keeps its icon, the key search folds into its icon (which opens the box in a popover, the focus in it), then the time-axis view controls — the fold toggle, the resolution and the overlaps chip — share the date popover, one move, and the history item folds last, to its buttons; on a touch screen every control there is a 44px tap target. The banners — each session's, an event kind's titled with its name (#1194): a Save's conflict, a refusal, an unknown outcome with Retry, a source out of date with Discard. Main — the canvas: the horizon, the ruler, pinned rows and the rows. The footer — the counts: the event kinds' events in the window, their backlog, the changes pending and when an event kind's record was last saved; then the author's `footer`, the transport line, and after a Save what left each source's narrowing (`1 print job event left this view`). ⌘Z undoes and ⇧⌘Z redoes from anywhere in the frame; a field being typed into keeps its own undo. The Plan draws no border
├─ Props:
│   ├─ axis (required) — ONE of three kinds; every element instant on the canvas must ride its arm. The kind is also a TYPE: `Plan.axis.number(…)` fixes the tag's `K`, every builder result carries the kind its instants' STATIC types imply (a `DateTimeType` accessor ⇒ `"time"`, a `FloatType` field ⇒ `"number"`, `Plan.at.ordinal(…)` ⇒ `"ordinal"`), a series collects its elements' kinds, and a series (or literal row) on another arm FAILS TO COMPILE at the tag — no wire change, the brand is phantom. Kind-erased values (a stored record, an `Expr<Plan.Types.Instant>`, an East-mapped element list, a `$.let`-bound axis or `$.const`-bound series list, chart rows) constrain nothing at compile time and are held to the axis at render — a row on another arm is a render-time diagnostic naming the row and the arm, never a silent misplacement. Plan.axis({ window?, resolution, resolutions?, now?, format? }) — the TIME shorthand (= Plan.axis.time): half-open [min, max) UTC window; omit window ⇒ the range the sources of its `slice` hold — there is NO fit to the data (#822): a canvas that neither states a window nor has a source holding a range is refused, at build when the axis is written in the tag, else as the render-time NO WINDOW diagnostic (a bound or stored axis); `resolutions` lists the WEEK/DAY segment options; `now` draws the observed/plan divider; `format` overrides tick labels (date tokens; defaults: week ⇒ "W27", day ⇒ "MON"); at a resolution coarser than a row's data a bucket shows ONE value per row — the fold of those in it (#824) · Plan.axis.number({ window?, step, now?, format? }) — a numeric window ÷ `step` (bucket edges on whole steps; omit window ⇒ the leading source's float / integer range, under the same no-fit rule; `format` a Chart.format.* spec; no resolution segment — step IS the declaration) · Plan.axis.ordinal({ values, now? }) — the declared values ARE the buckets, in order (the list is the window: no source's range holds it, no brush, the window keys idle; an unlisted value positions nowhere; an interval END names its LAST bucket, inclusive)
│   ├─ data (required unless `events`, `rows` or `slice`'s `rows` source, which gives the rows and refuses `data` beside it — a Plan with no rows from any source is refused at build) — a KEYED collection: a `Dict<K, R>` value/expression for the inline arm, or a `$.let`-bound `Data.bindPaged(…)` handle for a WINDOWED arm, recognised by its East type: `pinned` when it names its snapshot, which `editing.onApply` needs; `paged` when it is the shape a UI exported before `revision` / `refresh`, which names none. Any key type `K` — a row's path starts with its entry's key, a String as it is, any other key as its `.east` text (`3`, `(hall="H1", bin=3)`) — and any entry type `R`: a struct, a `RecursiveType` node, or a collection (a `groupToDicts` group). A positional collection is refused — key it at the call site with `rows.toDict((_$, r) => r.id)`. A paged canvas pages by PARENTS (#823): a window is N top-level entries, each with its whole subtree, so a parent never straddles two windows and its bands, means, subtotals and member count are exact — nest children in the source, and group a flat paged source in its dataflow (a group is one entry holding its members; a parent is bounded by a page). Each top-level series is a BLOCK, exactly as inline: a paged canvas pages every block on its own over the same windows (its own bands and resident run; one read of a window serves every block), draws a section's header and hand-built rows once (FIXED blocks), and rebases only the block a far jump lands in; a window landing above the rows in view at a height its estimate missed moves the scroll, never the rows. A paged source may serve SHORT windows (e3 trims pages of wide entries to a byte budget) and the canvas still reads WHOLE ones — its derived source re-requests what a trimmed page left out. When the source's `revision()` moves (`Data.bindPaged` follows each write to its dataset), the canvas re-reads its resident windows at the new snapshot IN PLACE: the rows on screen stay until theirs land (no remount, no empty frame), the scroll position holds, and a standing key search is asked again at the new snapshot, the view where it is (its matches named rows of the old one, #1199) — a match its box shows kept while the new snapshot holds it in place, else its query shown again
│   ├─ series (required unless `pick`) — the row recipes over `data`; the list IS the layout (#822): each series contributes one contiguous block, top to bottom in declared order, its rows in source order, each parent followed by its subtree. Data series: Plan.series.span/buckets/chart/heat/table/cards/events(Row, { key, title, subtitle?, icon?, keyType?, match?, label, id?, stacked?, sub?, value?, status?, expand?, children?, collapsed?, edit?, …kind fields }) — every accessor receives (entry, key); a `RecursiveType` entry arrives as its node. What a gesture WRITES is declared on the series (#880): `edit: { items: "jobs", create: (drop, entry, key) => item }` (span / buckets / cards / events) names the entry's `Array` field a dropped card joins and builds the item from the `Plan.Types.Drop` — see `editing`. Naming the item's `String` key field and its instant fields as well — `edit: { items: "jobs", key: "key", start: "start", end: "end" }` (span / cards) or `{ items, key, at }` (buckets / events) — makes its runs, chips, tiles and marks MOVE, and its runs and chips RESIZE (#825): an element's key is its item's key — its identity across every row it can move to, since a row's list keeps its keys unique (a card or a move that would repeat one is refused, the drag showing ⊘) — an instant field is a `DateTime`, a `Float` / `Integer` (number axis), a `String` (ordinal) or a `Plan.Types.Instant`, and `create` becomes optional. `children` nests, to any depth: a bare accessor `(r) => r.children` walks more of THIS series (a recursive entry's own children), `Plan.children(of, [series…])` steps down to a child collection of another entry type (an `Array` in data order, a `Dict` in key order — its series laid out like a top-level list), an array of step-downs gives several child collections in order (a gesture on a nested row writes back through them, so where a series below takes gestures they read a FIELD of the entry — `r => r.children`, `Plan.children(r => r.presses, …)` — or are the entry itself, `g => g`; a computed collection is refused at build); `collapsed: true | (r, k) => …` is a parent's initial state. A parent derives exactly, because its whole subtree rides in its entry: span bands over the subtree's runs (`rollup` "union" | "byStatus" | "sum"; a band sums its runs' quantities unit by unit — the unit rides each `Plan.quantity`), a heat parent with no cells of its own the children's per-bucket `aggregate` (default "mean") painted on its `scale` ({ min?, max?, warnAt? }; default the scale its members share), a table parent with no values per-position subtotals (`aggregate` default "sum", `format`) — each summarising what its children SHOW, their values already folded to the resolution · Plan.series.group(Row, { key, title, label, children, summaryAggregate?, summary?, collapsed? }) — one strip PER ENTRY, its members the entry's children (derived member count; collapsed it rests as its summary strip — explicit `summary` cells OR a `summaryAggregate` of the members' heat cells, never both) · Plan.series.section(Row, { key, title, collapsed?, meta?, value?, status?, summary?, summaryAggregate? }, [series…]) — a fixed titled block over series (it adds no path segment; its header's id is `Plan.sectionRef(key, …parentPath)`) · Plan.series.views(Row, { key, title, match?, children?, collapsed? }, [series…]) — ONE entity shown several ways: one row per member series per entry, ADJACENT and in declared order (a member's own `match` decides whether its row shows; members declare no `children`), the entry's children following its view rows under the first — more of the views' own entries too (a bare accessor), each drawn as the members' rows, to any depth, a span member's `rollup` rolling them up — and a seek on the entry landing on its first view row · Plan.series.rows(Row, identity, rows) — hand-built rows (the kind factories below) placed as one block. Series keys are unique across the WHOLE series tree — a repeat is a build-time Error naming both sites (a list bound as an East value is checked at render: a repeated id draws as a row diagnostic, never a silent drop). There is no `groupBy`: to group a flat source, reshape it first — inline, one `groupToDicts` in the canvas function (`rows.groupToDicts(($, r) => r.hall, ($, _r, k) => k)`, entries `Dict<String, Row>` whose key is the group); a paged source in the dataflow. A source keyed by another type (`Dict<Integer, R>`) works with series whose accessors ignore the key; one that reads it declares `keyType` and, bound as a list, types it `Plan.Types.Series(R, KeyType)`
│   ├─ pick (optional, exclusive with `series`) — Plan.pick(key, allSeries, { hidden? }): the bound series library — the toolbar has no Series button (#1193): the library pane's Series tab (#1195, when `library` lists `Plan.library.series()`) lists the series by title, subtitle and kind icon in the list's order (that order is the canvas layout); hidden series drop from the canvas (a hidden section, group or views takes its whole block); there are no row counts (#822 — a count means something only with every entry in hand); a pick is STATE, so the Plan must sit inside a <Reactive>
│   ├─ resources + events (optional) — event kinds over records (#1191), `Schedule`'s — the very values a Calendar takes: `resources={{ presses: Schedule.resources(rows, { name, icon, label, … }) }}` are the rows events are placed on, in this order — `rows` a `Dict`, or a `Data.bindPaged` read of one, which pages the kind (#1199, see Large records, a window at a time) — and `events={{ job: Schedule.events(Record.bind(jobs, [jobsPatch]), { name, icon, title, start, end | at, resource: { field, of }, … }) }}` the kinds, each a record of its own committed through its patch mutation. Their rows come first, then `data`'s, then `rows`'. Each resource kind is a block (#1192): every resource a row per way the kinds placed on it draw — bars, tiles, chips, marks, in that order — then its `measures`, under its `group` strips and nested by its `parent`; a row's id is `entry { series: "<slot>.<draw>", path: [group?, …parents, key] }`, an element's key its event's `Schedule.Types.EventRef` as East prints it, and an event no resource holds draws on its kind's Unassigned row after every resource kind. The rows are read over the window the canvas draws, and read again when a record commits. Each kind is a session over its record, under ONE history with `data`'s (#1194): every gesture one transaction, drawn as Save would leave it; Undo and Redo (the history item, ⌘Z / ⇧⌘Z / ⌘Y anywhere in the frame but a field being typed into) step through the gestures in the order they were made, whatever their kind; Discard drops every kind's drafts; Save commits each kind with a change as one patch through its patch mutation, checked against what its drafts began from — one kind's conflict, refusal or unanswered write (Save turns into Retry, the same request) leaving the others' commits, each kind's banner titled with its name. Their events drag (#1196), each gesture one step of that history: a template from the library's Events tab, or an unscheduled event from its Backlog tab, drops on a resource's row at the bucket under the pointer — the template's event made under a new key for its duration (from its `at` on a day or longer) and selected, the backlog event scheduled for its own; an element moves along its row or onto another resource's row, writing the resource field, a selected element moving the selection with it, and a bar's or a chip's edge resizes it, never shorter than one snap; an event dropped on the Backlog tab is unscheduled (a kind whose times are Options); the ghost says what lands where (`Brochure run · Press A1 · Mon, Oct 12, 2026`) or, in red, why not (`Needs presses`, `canDrop`'s message); and an element of an event its drafts changed wears the brand tint in a brand border. An event is scheduled in time, so event kinds on a number or ordinal axis are refused at build, naming the axis and the kinds (an axis held in a variable is refused in the same words as the Plan is evaluated); `resources` without `events`, and a kind's `resource` naming a slot `resources` has not, are refused too. `applyMode` ("batch" default | "auto") says when the kinds' drafts go — on Save, or each ready gesture as it lands; `data`'s session takes `editing.mode` — and `date` the date brought into view first
│   ├─ rows (optional) — read-only rows after the event kinds' and `data`'s: hand-built rows (`Plan.chart({ … })`, `Plan.span({ … })`, …) and `Plan.over(data, [series…])`, series over a dataset — a keyed collection, or a `Data.bind` handle over one — which refuses a series declaring `edit` at build (a Plan's edits go through its event kinds and `data`'s session). Each is a FIXED block, drawn once on a paged canvas; a `pinned` row sits under the ruler. Their instants ride the axis's arm, or the tag fails to compile
│   ├─ library (optional, #1195) — the start pane's tabs, in order, each a `Plan.library.*` call: `events()` — every event kind's templates, under the kind's name and then the template's group; `backlog()` — every event kind's unscheduled events, grouped by when they are due (this week, overdue included; next week; later; no date — UTC weeks from the axis's `now`, else from when the Plan mounted); `series()` — `Pick.Panel`'s list of what a viewer can hide, in the order the canvas draws it: each resource kind and its measures, the event kinds, `data`'s picked series and the Plan's `rows` — hidden per viewer under the Plan's `id`, and only while the tab is listed; `tab(rows, { name, icon?, label, meta?, group?, drop?, source? })` — a card per row of a `Dict<K, R>` (accessors `(row, key)`), searched by key, label and meta, a click selecting one, following the rail's `source` it names by its rows' keys (#1344); each card drags onto the rows of `data` whose series makes an item of a card (`edit.create`), the Plan taking its own panel's cards with no `id` or `sources` (#1259), and with `drop: (row, key) => Schedule.patch(KindRowType, …)` onto an event, the patch's type naming the event kind it lands on — the patch set on the event under the pointer as one step (#1196), refused between events and on another kind's. The Backlog tab reads every kind's drafts, so a card scheduled leaves it and an event unscheduled joins it at once. Left out, or empty, no library pane. Collapsed, the pane is a rail with the backlog's count, or the first tab's. A tab listed twice, the Events or Backlog tab with no event kinds, the Series tab with nothing to hide, and a `drop` over no event kind's row type (or one two kinds share) are refused at build, naming the tab
│   ├─ inspector (optional, #1197) — the end pane: what is selected on the canvas. An event kind's element — a bar, tile, chip or mark — selects its event and its row on a click, Shift / ⌘ / Ctrl adding it to the selection or taking it out, and wears the brand's ring while it is selected; a row's name or plot selects the row, the plot's click naming the bucket under the pointer; Esc clears it all. One event shows its kind, title, when it runs and status, its facts (resource, start and end or its instant, lane, state, quantity), its kind's form over `fields` — or the kind's own inspector, `Schedule.events(record, { …, inspector: (row, update) => UIComponentType })`, in its place — then Duplicate and Delete; several, how many, each kind's count, the list and the bulk edit (state, resource, a shift of a day or an hour); a row, its resource's name, lines and group, its events in the window and its measures at the named bucket; nothing, the window's counts and three hints. Its edits are each one transaction of the Plan's history (#1194): a field of the form — tinted while the record holds it otherwise — the kind's own inspector's `update`, Duplicate (copies under new keys, then selected), Delete, and the bulk edit over every selected event that takes it, across kinds. Refused on a Plan with no event kinds
│   ├─ links (optional) — [Plan.link({ key, from: Plan.ref(series, …path), fromRun, to: Plan.ref(…), toRun, quantity?: Plan.quantity(34, { unit: "k sheets" }) })] run-edge quantity ribbons, their ends named by row id (a `views` entry's chart row and its span row are two different ends); an end may instead be an event — `from: Plan.eventRef(kind, key)`, no `fromRun` — drawn wherever the event is, and a link naming a kind `events` has not is refused at build (one whose kind is not known there — a list held in a variable or built in East, or an event end held in a variable — as the Plan is evaluated); rows an edge touches carry the links-focus control, always shown at the end of the row's gutter line and pressed while its focus is open (it gathers the transitive upstream/downstream family; unrelated rows collapse to 11px rails / ⋯ gap bands — never removed). In the focus each link is an arrow out of its source's end and into its destination's start, each as it draws — a bar at least the narrowest, a chip and a tile's cell in by their inset, a mark across its glyph: an S where the gap between them allows, else a loopback between the rows; on one row a feed, or a runoff. Nothing of it leaves the plot: a destination at the plot's start is entered from above or below, a source at its end lifts off its edge, an end past the window lands in a dashed slot on the plot's edge, and an end out of view meets the view's edge in a stub. Its quantity's third of the family's largest sets its weight — 2, 4 or 8, and 1.5 with no quantity — over a casing of the paper, and the quantity's caption — its `text`, else its value through its `format`, then its unit — prints on a paper knockout and is its tooltip; a link with no quantity says nothing. A click on a link reports the `link` element ref ({ key, from, to }) and opens the root's popover for it
│   ├─ popover / hover (optional) — generalized element resolvers fn(Plan.Types.ElementRef) => Option<UIComponent> over EVERY element (run / event / chip / mark / cell refs, each carrying the row's id — compare with `East.equal(ev.row, Plan.ref(…))` — and link refs { key, from, to }, a ribbon belonging to no one row); resolved lazily at click/hover time — a `none` result opens nothing
│   ├─ expandRender / expandGutter (optional) — the R2 expand-in-place renders fn(Plan.Types.RowId) => UIComponent for rows declaring `expand` (per-row DATA: `{ height?: "168px", axis?: "keep" | "dim" | "off" }` — the render's height, and whether the shared grid + now-line run through it, wash to 40%, or hide inside that row); the focused row GROWS to hold the render (its marks keep their band at the top, its gutter cell grows with it and takes `expandGutter`); every other data row compresses to a 16px strip — never removed: bars / tiles / chips shrink to 7px marks, chart and table rows re-encode as a tone strip, event marks keep their silhouette; a strip click or Esc returns
│   ├─ editing (optional) — the editing session (#880), the Sheet's (#879) over the source's TOP-LEVEL entries: { onApply? | onUpdate?, onPatch?, mode?, ready? }. Every dropped card, move and resize drafts the entry its row came from (a gesture on a nested row drafts the entry its whole subtree rides in), drawn at once where it was made — the entry's rows derived again, marked pending, or incomplete / invalid while a check refuses that entry — each gesture ONE undoable transaction. The history item (issues · Undo · Redo · Discard · Save, and its status line) ends the frame's toolbar; ⌘Z / Ctrl+Z undo, ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y redo. `onApply` fn(Editing.Types.ChangeSet(R, K)) => Editing.Types.ApplyResult (sync or async) commits one checked batch against the base the drafts began from — the inline `Dict`'s snapshot, or a paged source's revision (a paged `onApply` needs the source's `revision` and `refresh`): a batch against a source that moved is refused, never rebased, and a banner says "Source changed — review or discard these drafts"; a Save that throws leaves the outcome unknown, and the banner's "Retry request" resends the SAME request (dedupe by its `requestId`); drafts retire only when the source reads back at the committed revision. `onUpdate` fn(Dict<K, R>) => Null is the inline adapter instead (exclusive with `onApply`): pass `data={handle}` and `onUpdate={handle.write}`, and each batch applies with `Editing.apply` over the handle's LATEST `Dict` and writes the whole result once — idempotent across retries. `onPatch` fn(Plan.Types.PatchEvent(R)) => Null hears every gesture (origin drop / move / resize / undo / redo / discard). `mode` "batch" (default — Save sends) | "auto" (each ready gesture goes at once). `ready` fn(R, K) => Editing.Types.Readiness checks a drafted entry — a refusal names the entry and holds Save (a check that throws refuses its own entry only). Without `editing` the canvas takes no gesture
│   ├─ slice (optional, #1344) — slice={{ slice: Slice.bindRecords(key, { rows?, <an event kind's slot>?, <a resource kind's slot>?, <a templates list's or a tab's source>? }, { presets? }), affordances?, persist? }}: ONE rail on the toolbar (affordances default ["fields","presets","summary","brush"]), each source named after what it narrows. `rows` gives the canvas its rows, paged from it in its index's order — `data` beside it is refused — edits reaching the record through `editing.onApply` (`Record.onApply(record, { keyed: true })`), the session the record's, a Save that takes rows out of the narrowing said in the footer. A source named after an event kind's slot reads that kind's events in the window and its backlog through its interval index (`e3.recordIndex.interval(name, jobs, { on?, from: "start", to: "end" })`, `range: "start"`), the kind giving `entries: Data.bindPaged(record)` for its reads by key; a draft of an event its narrowing does not hold never shows, and Save sends it. Listing a series index and a summary index beside the interval index (#1039), a kind placed on a paged resource kind is read a cell at a time — the events of the resources around the rows in view over the tiles the window touches, two requests a change — and shaded from the summary past what it draws (see Large records below). One named after a resource kind's slot narrows that kind's rows and the bulk edit's Chooser, which keeps the resources the selected events are on — over resources read whole and keyed by String. One a templates list (`Schedule.templates(rows, { …, source })`) or a library tab names narrows that tab's cards: each tab counts what it shows (`Customers 6 of 16`) and, emptied, says so with Clear filters; the Backlog counts `N of M`, its Clear filters keeping the window. Every source holding a range of the axis's arm holds ONE window — on a time axis the date navigator's, the leading source's range editor its Range panel and every source's range out of the rail; on a number axis the leading source's range a chip of the rail: the date navigator, the horizon brush, `[` / `]` / `n` and the resolution write each source, and a record's resolution only re-buckets, fetching nothing. `brush` mounts the horizon band on time and number axes: an OVERVIEW of the sources' range in whole periods, with a lens joining its window to the plot's edges (drag its body to slide the window, an edge to resize it, empty track to draw one), committing once a gesture, with no histogram; `resolution` the WEEK/DAY segment (time axis); `summary` the rail's counts. Calculations — the footer's counts, the overlaps — read every event the kinds read. Refused at build, each naming the change: the bare handle, `Slice.bind`, a single `Slice.bindRecord`, a source nothing names, `data` beside `rows`, a paged resource kind or one keyed otherwise than by String as a source, a kind's own `slice` or `filter`, and a templates list written in the code or naming no source. With a `rows` source there is no key search: the rail narrows the rows. On a PAGED `data` the toolbar's KEY SEARCH seeks over the source's `seek` — the box, folding to its icon on a row short of room; the jump REBASES residency at the match (windows in between are never fetched); the query is a whole-key literal, a prefix, leading struct fields, or a `from..to` RANGE over a leading prefix of the key's flattened fields (`late, 3..ok`), which is what a time window or a status band asks for — quoting is the escape: a quoted value is exact and a `..` inside it is text (`"../config"`)
│   ├─ grain (optional) — initial grain "resource" (default) | "group" (root groups collapse to summary strips); the `g` key cycles it, and a canvas with a root group mounts the toolbar's GROUP · RESOURCE segment for it — slice or no slice (#632; the narrow layout's tabs own the grain there); onGrainChange observes
│   ├─ ui (optional) — the interaction state, held by the HOST (#824): State.bind([Plan.Types.UiState], key, Plan.uiState({ selected?, collapsed?, expanded?, charts?, focus? })) — the canvas draws it from its first frame, takes every outside write (a selection, rows folded or opened, charts expanded) and writes the user's own actions back, once per action; `collapsed` / `expanded` list the rows folded / opened AGAINST their declaration (a row in neither follows it; in both, folded); `focus` is a REQUEST — the canvas opens the rows it nests under, scrolls it to the top of the view, makes it the tab stop (DOM focus stays put) and writes `focus: none` back; a paged row it has not loaded is opened by its window, or sought by its entry's key where the source can seek. Bound, the canvas persists no toggles of its own under its `storageKey`
│   ├─ id + sources + canDrop (optional) — DnD TARGET (the shared grammar): cards — an author's tab's in the Plan's own library panel (`Plan.library.tab`, #1259), or a Library's beside the Plan, which reaches it by its `id` when `sources` lists the Library — `add` onto rows whose series declares `edit` — span / buckets / events / cards only (chart / heat / table render DERIVED values, and section headers and group strips are wayfinding — they register no cell) — and only with `editing`: a drop is a DRAFT of the session (#880), its item built by the series' `create` from the `Plan.Types.Drop` ({ from: { library, key }, row, at, duplicate } — `at` the start of the bucket it landed in, on the axis arm). `canDrop` sees the drag grammar's `add`: its `into.row` is the row id's canonical TEXT — key host tables by `East.print(Plan.ref(series, …path))`, or read it back with `row.parse(Plan.Types.RowId)`; slot = the bucket start instant per the axis arm — time: Z-less ISO (`slot.parse(DateTimeType)`), number: a decimal (`slot.parse(FloatType)`), ordinal: the value; drop verdicts resolve LIVE where the drag rests — `canDrop` is asked of the event a drop there would deliver (an `add`'s `duplicate` is whether Alt is held), renders the ⊘ stage, and is asked again before the drop becomes a draft — and the landing band previews WHERE the card lands. A moved or resized element (#825) is vetoed the same way: `canDrop` sees the grammar's `move` ({ from, to } cells, `from.event` the element's key) or `resize` ({ event, edge }). The canvas's own elements, and its own panel's cards, need no `id` — only a Library beside the Plan does. A card held at a bounded canvas's edge scrolls it to the rows beyond; by keyboard (#608) → / ← step onto a row and along its buckets and ↑ / ↓ between rows, each bucket announced ("Poster run is over H1-P03, Week of Jul 6, 2026."). `onDrag` is removed (#880) and throws at build. With event kinds, `canDrop` may instead be fn(Schedule.Types.Candidate) => Option<String>, vetting an event kind's drop with its message on the ghost, as the Calendar's — the arm is read from the function's type; it is asked where a drag rests and again of the drop, `from` the template's key, the backlog event's or the moved event's (#1196)
│   ├─ onSelect / onElementClick / onGroupToggle (optional) — row selection, ONE element callback and section toggles; payloads are row ids + element keys + instants, never indices: onSelect the `Plan.Types.RowId`; onElementClick a `Plan.Types.ElementRef` — the SAME ref the popover resolver receives, its arm the element kind (run { row, run } · event { row, event } · mark { row, mark } · chip { row, chip } · cell { row, at } — `at` a Plan.Types.Instant on the axis arm, a folded bucket's start · link { key, from, to }), so `ref.match({ run: …, link: … }, …)` handles the kinds it cares about; onGroupToggle { row, expanded } for any row with children
│   ├─ footer (optional) — [{ text, tone?, end? }] status-footer items, in the frame's footer after its counts; a paged canvas adds the transport line ("N loaded of M · Loading…", counted in source ELEMENTS); until the source is exhausted a TOP-LEVEL section's member count prints `~`-marked (its members are entries the windows share out) — every other parent's numbers are exact, its subtree riding whole in one entry
│   └─ style (optional) — { height ("fill" fills the parent) and maxHeight — the whole Plan's, its frame's, the canvas filling main and scrolling its own rows; with neither, a host that gives the Plan a height bounds it the same way, and one that gives none lets it grow with its rows — density ("compact" ⇒ dense 24px rows), gutterWidth ("168px", CSS px) }; a bounded canvas pins the PARENT of the rows in view under its header — with its ancestors' path on a deep tree — once the parent's own row scrolls off, inline and paged (a click goes to it, #823)
├─ Narrow (below 480px of CONTAINER width — a phone, a splitter pane, a task preview; §10): the same definition reflows to a review tool — the frame's toolbar keeps its items, folded to fit (the GROUP · RESOURCE segment leaves: the tabs own the grain), no horizon brush, and Groups · Rows · Measures tabs (the `<Tabs>` line grammar, counts as plain numerals) over ONE slice, then the card list with the shared ruler as its sticky first row (a separator per bucket, labels thinned to what fits): Groups = the group grain as hottest-first strip cards (tap opens its rows) — the LANDING only when it is a map (three or more groups, or any strip); Rows = every data row as a card SECTIONED by group (a section header scopes to that group; `← All rows` returns) with the gutter identity as the card head and the row's plot — the same kind renderer — as the body on the shared window; Measures = chart rows full-width at expanded density; tap selects, a second tap on an `expand` row drills it in place (~148px; neighbours keep their size), a two-finger horizontal drag pans the window; a bounded `height` pins the header and scrolls the list; a paged source shows its resident prefix. Wrap a Plan in `<Box width="360px">` to see it on a desktop page
├─ Keyboard (#819): the body is a TREEGRID with ONE tab stop that roves between its rows — every row, group band, ⋯ gap band and paged-window band (loading or failed) is a `row` with aria-level / aria-expanded / aria-selected and an `aria-rowindex` that stays exact under virtualization, collapse and paging · ↑ / ↓ step, Home / End go to the first / last, PgUp / PgDn move a viewport · → opens a closed section (a group band, a nesting parent, an `expandable` chart) and steps into an open one's first child; ← closes an open one, else steps to the parent · Enter does the row's click (select; a group band toggles; a rail, strip or ⋯ band returns from the row focus) · Space toggles the section / chart · a step onto an UNLOADED band asks the source for that window and moves on to the row once it lands (Home / End reach the source's own first / last row) · Tab walks the row's widgets — its controls, its elements in time order, tabbables in the expand render — then leaves the canvas; ← / → (Home / End) step between elements in time order; Enter / Space on an element does its click (the popover, the selection — an event kind's element selects its event, Shift+Enter adds it, #1197 — the element callback) · Esc ladder, one rung per press: popover → element back to its row → brush → focus → deselect (the row, its bucket and the events at once) · n recenters the window on `now` · [ / ] pan one period · g cycles the grain — window keys write the window into the sources holding it, so a canvas whose slice holds no range idles them · with `editing`, ⌘Z / Ctrl+Z undo the last gesture and ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y redo it (#880) · with `editing`, Space on a movable element picks it up (#825): ← / → move it one bucket, Shift+← / → its end and Alt+← / → its start, ↑ / ↓ carry it to the nearest row above / below that takes it, Space / Enter drop it, Esc / Tab cancel — each step said in the canvas's live region; an event kind's element is carried the same way (#1196), ↑ / ↓ along the rows its kind draws on, a refusal said with why · the toolbar's GROUP · RESOURCE and WEEK · DAY segments are radio groups: one tab stop each, ← / → (Home / End) move and pick
├─ Screen readers (#819): a polite live region says what changed — a selection, a section or chart opening / closing, a row focus coming or going, the grain, the resolution, each window a paged source lands ("Loaded elements 201–400 of 5,000", counted in source elements like the transport line); every element is named in words — label, span or bucket ("Week of Jul 6, 2026"), state, tone — a chart row reads as an image with a min / max / last summary per layer, and colour-only cells (heat depth, booked weight, segment composition, compressed strips) carry their value as text; narrow, the Groups · Rows · Measures tabs are a real tablist (arrow keys, one tabpanel each)
├─ Localization (#820): every word the canvas says itself — toolbar, ruler, footer, diagnostics, bands, narrow tabs and cards, the history bar (the table carries the editing session's words, #880), element names, live-region announcements — comes from ONE typed message table, and every number and date it prints is in the LOCALE: react-aria's `<I18nProvider locale="de-DE">` above the app sets it (the browser's language otherwise), and derived numbers ("2.234,5 k sheets"), ruler ticks ("MO · DI"), the words a reader hears ("29. Juni 2026") and a Chart.format.* axis all follow it. Host React code overrides any subset of the words for a subtree with `<PlanMessagesProvider messages={GERMAN}>` (@elaraai/e3-ui-components; `planMessages` is the English table — each message a function of named, already-formatted parameters, plus the raw `n` for plurals; define the overrides ONCE, not per render — providers nest). What the AUTHOR wrote is data and never translated: labels, footer items, and a date `format` pattern on the axis (East tokens, as written); the label a patch event carries to the host stays in English, as the Sheet's does
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
    ├─ Plan.span/buckets/chart/heat/table/cards/events/group({ key, label, id?, sub?, value?, meta?, stacked?, swatches?, collapsed?, pinned?, height?, status?, expand?, …kind fields, rows? }) — literal kind factories returning row STREAMS (the row, then its nested `rows:` in order; parents DECLARE rollup/aggregate and the renderer derives the numbers); ride them beside data-driven series via Plan.series.rows — a hand-built row's id is that series' key plus the factory `key`s that lead to it (`Plan.ref("works", "shutdown", "elec")`), so keys must be unique among siblings (a repeat draws as a DUPLICATE ID row diagnostic)
    ├─ Plan.link({ key, from, fromRun, to, toRun, quantity? }) — one link-graph edge; `key` is what a ribbon click's `link` ref names it by, `from` / `to` are row ids (`Plan.ref`) with their runs, or events (`Plan.eventRef`) with none, `quantity` a Plan.quantity
    ├─ Plan.eventRef(kind, key) — an event of one of the Plan's event kinds, named for a link's end (Plan.Types.RunRef) · Plan.over(data, [series…]) — series over a dataset, read only, for `rows` (#1191)
    ├─ Plan.library.events() / backlog() / series() / tab(rows, config) — the library pane's tabs (#1195, see `library`) · Schedule.patch(R, { field: value, … }) — a patch over an event kind's row type (Schedule.Types.Patch(R): every field an `Option`, the fields left out `none`), what an author's card dropped on an event sets
    ├─ Plan.uiState({ selected?, collapsed?, expanded?, charts?, focus? }) — the seed of a bound `ui` state (Plan.Types.UiState): rows named by id (`Plan.ref`), omitted fields empty
    └─ Plan.Types.PatchEvent(R) — what `editing.onPatch` receives for entries of `R` · Plan.Types.Drop ({ from: { library, key }, row: RowId, at: Instant, duplicate }) — what an `edit.create` builds its item from · Plan.Types.Gesture (drop(Drop) | move(Move)) and Plan.Types.RowEdits ({ drop, move: Option<MoveEdits> } — the gestures a row takes) · Plan.Types.Move ({ key, from: RowId, to: RowId, start, end } — a moved or resized element, #825) — the editing wire (#880); the session's contracts are the shared `Editing.Types.*` (ChangeSet(R, K), ApplyResult, Readiness)
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
| `children: (r, k) => r.children` | More of this series: a `RecursiveType` entry, to any depth. A parent's span bands (`rollup`, summed per quantity unit), heat `aggregate` (on its `scale`) or table subtotals (`aggregate`, `format`) derive from its subtree. | `planTargetState`, `planMeasures` |
| `children: Plan.children(of: (r, k) => Array \| Dict, series: Series[])` | A step down to a child collection of another type, laid out like a top-level list; an array of step-downs gives several collections, in order. | `planTargetState` |
| `Plan.series.group(G, { key, title, label, children, summaryAggregate?, summary?, collapsed? })` **❗** | One strip per entry, its members the entry's children; the removed `by` form throws. | `planTargetState` |
| `rows.groupToDicts(($, r) => r.hall, ($, _r, k) => k)` | Grouping is a data step; a paged source is grouped in its dataflow. | `planTargetState` |
| `Plan.series.section(R, { key, title, collapsed?, meta?, value?, status?, summaryAggregate? }, members: Series[])` | A fixed titled block over series; it adds no path segment. | `planTargetState` |
| `Plan.series.views(R, { key, title, match?, children?, collapsed? }, members: Series[])` **❗** | One row per member per entry, adjacent; the entry's children follow under the first view row, and a seek lands there. A member may not declare `children`. Its children may be more of its own entries (a bare accessor), each drawn as the members' rows; a span member's `rollup` rolls them up. | `planTargetState` |
| `Plan.series.rows(R, { key, title }, [Plan.span({ key, label, rows? }), …])` | Hand-built rows as one block; a row's id is the series key plus the factory keys to it. | `planTargetState` |
| **Paged sources (#823)** | | |
| `data={paged}` — a `Data.bindPaged(…)` handle **❗** | Parents are the page unit: a window is N top-level entries with their whole subtrees, so nest children in the source and group a flat source in its dataflow. | `dataBindPagedPlan` |
| several series over one paged source | Each series is a block that pages on its own — its own bands and resident run — and one read of a window serves every block; a section's header and hand-built rows are fixed blocks, drawn once. | `dataBindPagedBlocks` |
| **Identity** | | |
| `Plan.ref(series: String, ...path: String[]): RowId` | A row's typed id, for links, `East.equal` in resolvers, and host tables keyed by `East.print(id)`. | `planTargetState`, `planRowDrop` |
| `Plan.sectionRef(series: String, ...path: String[]): RowId` | A section header's id, at its parent's path. | `planTargetState` |
| `onSelect` / `expandRender` / `expandGutter`: `fn(Plan.Types.RowId)`; element refs, `onGroupToggle`, a drop (`Plan.Types.Drop`): `{ row: RowId, … }` | Every callback names a row by its id. | `planVariants`, `planTargetState`, `planRowDrop` |
| series keys unique across the whole tree **❗** | A repeated key is a build-time error naming both series; a repeated run-time id draws a DUPLICATE ID row diagnostic. | — |
| **Window** | | |
| `Plan.axis({ window: { min, max }, … })` or a source of `slice={{ slice }}` holding a `range` **❗** | The window is stated, or it is the range its sources hold (#1344). A canvas with neither is refused, and nothing fits the axis to the data. | `planTargetState`, `planNumberAxis` |

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
| `Plan.quantity(value: Float, { unit?: String, format?: Format.*, text?: String }): Quantity` | A run's or a link's quantity: its caption is `text`, else the value through `format`, then its unit; rollup bands sum it unit by unit. | `planTargetState` |
| `fold?: "sum" \| "mean" \| "min" \| "max" \| "last" \| "count"` | What a coarser bucket shows of a row's values in it: heat and weight `mean`, segments, table numerals and columns `sum`, lines and areas `mean`. One value in a bucket keeps its own instant, label and text. | `planMeasures` |
| `onElementClick: fn(Plan.Types.ElementRef) => Null` | Every element kind — run, event, mark, chip, cell, link — through one callback; the arm says which. | `planVariants` |
| `ui: State.bind([Plan.Types.UiState], key, Plan.uiState({ … }))` | The host's selection, folds, opens, expanded charts and a `focus` request the canvas spends; the user's actions are written back. | `planTargetState` |
| `Plan.link({ key, from, fromRun, to, toRun, quantity? })` | A ribbon keyed for its click ref, weighed and captioned by its quantity. | `planTargetState` |

Removed with #824: `qty` and the string `quantity` on a run (one
`Plan.quantity`); the span series' `unit` (a quantity carries its unit); the
five element callbacks `onRunClick` / `onEventClick` / `onMarkClick` /
`onChipClick` / `onCellClick` (`onElementClick`); a link's `label` (its
quantity's caption); and a group strip given both `summary` and
`summaryAggregate` (refused at build).

#### Every change is a draft (#880)

The Plan's editing session is the Sheet's (#879), over the source's TOP-LEVEL
entries. A dropped card and a moved or resized element are gestures, never
callbacks: each drafts the entry its row came from — at any depth, since the
whole subtree rides in its entry — the canvas draws the draft at once by
deriving the entry's rows again, and Save sends every draft as one checked
batch. The series says what a gesture writes; the root says where the batch
goes.

```tsx
// A LIVE handle over the halls: the canvas reads it, and Save writes it.
const halls = $.let(State.bind([DictType(StringType, Hall)], "ops.plan.halls", seed));
// The author's check over one drafted hall; a refusal names the press and holds Save.
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
// Every gesture as it is made — a drop, a move, an undo.
const last = $.let(State.bind([StringType], "ops.plan.last", ""));
// The palette: the Plan's own library panel, a card per job template.
const templates = $.let(Data.bind(jobTemplates));
const onPatch = $.const(East.function([Plan.Types.PatchEvent(Hall)], NullType, ($, event) => {
    $(last.write(East.str`${event.origin.getTag()} · ${event.label}`));   // drop · Drop brochure on P03
}));
<Plan axis={axis} data={halls}
    library={[Plan.library.tab(templates.read(), { name: "Jobs", label: t => t.name })]}   // a card drags onto a press
    series={[Plan.series.span(Hall, {
        key: "halls", title: "Halls", label: h => h.name, runs: _h => [],
        // A gesture on a press writes back into its hall through this FIELD.
        children: Plan.children(h => h.presses, [
            Plan.series.span(Press, {
                key: "presses", title: "Presses", label: (_p, k) => k,
                runs: p => p.jobs.map((_$, j) => Plan.run({ key: j.key, start: j.start, end: j.end, label: j.label, state: j.state })),
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
    editing={{ onUpdate: halls.write, onPatch, ready }} />
```

| Signature | Description | Example |
| --- | --- | --- |
| **What a gesture writes (on the series)** | | |
| `edit: { items: F, create: (drop: Plan.Types.Drop, entry, key) => Item }` — `F` an `Array<Item>` field; span / buckets / cards / events **❗** | A library card dropped on a row joins `F` as `create`'s item: `drop.from` is the card, `drop.at` the start of the bucket it landed in, on the axis arm. A misnamed field fails the build. | `planRowDrop` |
| `edit: { items: F, key: K, start: S, end: E }` (span / cards) or `{ items: F, key: K, at: A }` (buckets / events) **❗** | A run, chip, tile or mark moves by its body, and a run or chip resizes by either end, with the pointer, a touch or the keyboard (#825). It moves in whole buckets; Shift moves one finer unit (a day under a week, an hour under a day, 15 minutes under an hour). Onto another row whose items are the same type, the item leaves its list for that row's, as one gesture over both entries. `K` is the item's `String` key field, since an element's key is its item's key — and its identity across every row it can move to: a row's list keeps its keys unique, so a card or a move that would repeat one is refused (⊘ while dragging); `S`, `E` and `A` are instant fields (`DateTime`; `Float` / `Integer` on a number axis; `String` on an ordinal one; `Plan.Types.Instant`). `create` becomes optional. A field a move cannot write fails the build. | `planRowDrop` |
| `children: r => r.kids` / `Plan.children(r => r.kids, …)` / `Plan.children(g => g, …)` **❗** | A gesture below an entry writes back through its `children`, so where a series below takes gestures they read a FIELD of the entry or are the entry itself; a computed collection fails the build. | `planRowDrop` |
| **The session (on the root)** | | |
| `editing={{ onUpdate: handle.write }}` with `data={handle}` **❗** | The inline adapter: Save applies the batch with `Editing.apply` over the handle's latest `Dict` and writes it once — idempotent across retries. It needs the handle itself as `data`. | Inline adapter shown above; the record-backed `planRowDrop` uses `Record.onApply` |
| `editing={{ onApply: fn(Editing.Types.ChangeSet(R, K)) => Editing.Types.ApplyResult }}` **❗** | The host's transaction, sync or async, checked against the base the drafts began from. A paged source needs `revision` and `refresh`; the host applies atomically, dedupes by `requestId` and returns the committed revision. | `planRowDrop` (`Record.onApply`) |
| `onPatch: fn(Plan.Types.PatchEvent(R)) => Null` | One call per gesture, and per undo, redo and discard. | `planRowDrop` |
| `ready: fn(R, K) => Editing.Types.Readiness` | The author's check over a drafted entry: a refusal marks the rows the draft changed and holds Save; a check that throws refuses its own entry only. | `planRowDrop` |
| `mode: "batch" \| "auto"` | Save sends the batch (default), or each ready gesture goes at once. | `planRowDrop` (batch); auto mode is exercised by `plan-editing.spec.ts` |
| `canDrop: fn(DragEventType) => Boolean` | Vets the event a drop where the drag rests would deliver — its `duplicate` whether Alt is held — showing the ⊘ stage, and again before it becomes a draft. A move is vetoed as the grammar's `move` or `resize` (#825), and a refusal is announced. | `planRowDrop` |

- **Drawn where made.** A drafted entry's rows are derived again, exactly as
  Save will leave them. A row the draft changed carries the Sheet's mark:
  pending, or incomplete / invalid while a check refuses its entry — each
  entry marked for its own issues. The narrow layout's cards carry the same marks.
- **One gesture, one transaction.** The history item ends the frame's toolbar:
  issues · Undo · Redo · Discard · Save, and its status line. ⌘Z / Ctrl+Z
  undo; ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y redo.
- **The base is the source's.** An inline `Dict` is checked by its snapshot, a
  paged source by its revision. A batch against a source that moved is
  refused, never rebased: a banner says "Source changed — review or discard
  these drafts".
  A Save whose outcome is unknown retries the SAME request ("Retry
  request"), and drafts retire only once the source reads back at the
  committed revision ("Saved — loading the confirmed revision…").
- **Moves (#825).** A move along its row, or a resize, drafts the item's
  instants in place. A move to another row takes the item out of its list
  and appends it to the target row's, and a batch that takes an item and
  places it nowhere is refused whole. The row under the drag draws a landing
  band with the proposed span, and the ghost carries the element's label and
  span. The narrow layout takes no moves.
- **No session, no gesture.** Without `editing` the toolbar has no history
  item, no card lands and nothing moves.

Removed with #880: the root's `onDrag` (a series' `edit`), which throws at
build, naming its replacement.

Removed with #1260: approving and rejecting. A Plan's changes are drafts of
its session, saved together, so the root's `review` (its decision column, its
summary and Rerun, Approve all and Reject all), a series' `review` and
`approval`, a hand-built row's `approval` and `Schedule.events`' `review` role
are gone, with the verdict buttons on a row and in the inspector. Each throws
at build, naming the removal. The history item's commit is Save.

#### `Schedule`: the kinds every builder shares

Bind records inside the example's own `Reactive` body. Resources and templates
can come from bound records; the backlog is the event record's unscheduled rows.
`Schedule` declares field roles and accessors. The internal renderer owns the
frame, Slice toolbar, shared fields, drag layer and editing session.

Every builder takes the app's own records through these declarations (#1365):
what it writes is the app's record, its fields mapped to the builder's roles
(`Schedule.events`); what it reads comes from the app's rows through
accessors (`Schedule.resources`); and what it publishes is a record of the
app's too, its status a field the app maps (`Schedule.periods`). The Calendar
and Plan take Plan's roles, the Roster and the Allocation their own beside
them, and a builder takes no notice of the roles it has no use for, so one
record of duties drives a Calendar and a Roster at once. A role names a field
of the row: its type is checked when the code compiles and again at build,
refused naming the role, the field and its type (`` `shift` names a String
field — "unpaidBreak" holds .Float ``). A gesture writes only the fields its
roles map; every other field of the row reads back as it was, and a new row's
unmapped fields hold their type's default.

| API / option | Meaning | Tested example |
| --- | --- | --- |
| `Schedule.resources(rows, { name, icon, label, meta? })` | Keyed resources; accessors receive `(row, key)`. `meta` is an optional second line. Use `Record.bind(record, []).read()` for a resource record. | `planEvents`, `planPrintWorks` |
| Resource `group`, `parent` | Plan groups resources by the group label, and nests a resource under the optional key of its parent in the same kind. `group` is also a Roster person's home group and an Allocation resource's group. | `planPrintWorks` |
| Resource `sub`, `value`, `status`, `collapsed` | Plan's gutter subtitle, value and status; initial collapse is a Boolean or accessor. | `planPrintWorks` |
| Resource `rollup`, `measures` | Parent bands use `union` (default), `byStatus` or `sum`. Measures are read-only `Plan.series.heat`, `table` or `chart` rows over the resource type, with unique keys and no children. | `planPrintWorks` |
| Resource `position`, `skills`, `contract`, `agency`, `trainer`, `trainee`, `usual` | The Roster's people (#1367): a person's default position (String), the skills they hold (`Set<String>`), their contracted weekly hours (Float), whether they are a named agency worker, train others or need a trainer beside them (Booleans), and their usual shift (`Option<String>`). | `rosterWarehouse` |
| Resource `offset` · `min`, `max`, `note`, `hold`, `jobs` | The Allocation's lanes: how far past each slot's start a lane's bins are booked (a TimeStep). Its resources: their range in the quantity's unit (Floats, required by the Allocation), a line about the next job (`Option<String>`), how long a reservation is held (a TimeStep) and their other work (`Array<Allocation.Types.Job>`). | `allocationKilnYard` |
| a resource accessor returning another type **❗** | Each accessor is reified once and held to the type it returns: one returning another is refused at build, naming what it returns (`` "People": `contract` returns a Float, a person's contracted weekly hours — and this one returns .String ``). | — |
| `Schedule.events(record, { name, icon, title?, start, end, … })` | A record bound with its patch mutation; `title` names a String field, and `start`/`end` name matching DateTime or Option<DateTime> fields. `title` is optional: the Calendar and Plan draw it and refuse a kind without one; the Roster and the Allocation draw a duty and a bin by their roles. | `planEvents` |
| Event `shift`, `group`, `position?`, `activity?`, `hours?` | The Roster's roles (#1367): String fields naming a duty's shift, the group it is rostered in and the position it holds; an `Option<String>` its one activity; and an accessor `(row, key) => Float`, the hours it counts — its length when omitted. See the Roster below. | `rosterWarehouse`, `rosterMinimal` |
| Event `arrival`, `parts: { field, of }`, `hold`, `kind?` | The Allocation's roles (#1367): an `Option<String>` naming the arrival a bin books (`none`, a reservation); a `Dict<String, Float>`, its quantity on each resource of the slot `of` names; a TimeStep, how long a resource holds it; and an `Option<String>`, what it goes with. With Plan's `quantity` and an instant's `at`. See the Allocation below. | `allocationKilnYard`, `allocationMinimal` |
| roles of both builders on one kind, or two roles naming one field **❗** | Refused at build, naming them: a kind is the Roster's duties or the Allocation's bins, and a builder writes each of its roles into a field of its own. | — |
| Event `at`, `draw` | An instant uses `at` instead of start/end and defaults to `marks`; it may draw `buckets`. Intervals default to `span`, and may draw `buckets`, `cards` or `marks`. | `planPrintWorks`, `planEventLinks` |
| Event `resource: { field, of }` | A String/Option<String> field targets one resource slot. A variant field maps each case to a resource slot, such as bay or van. | `planPrintWorks` |
| Event `state`, `quantity: { field, unit?, format? }`, `lane` | Plan's lifecycle field (confirmed when omitted), Float quantity with its unit/format, and String lane for bucket tiles. | `planPrintWorks` |
| Event `status: { field, cases }` | A non-Option variant field with one `{ label, tone, ring }` per case; warning status rings the element. | `planPrintWorks` |
| Event `overlaps: "warn" \| "allow"` | Warn is the default. Allow permits parallel events. Both preserve every event; warnings never remove or truncate overlaps. | `planPrintWorks` |
| Event `backlog: { duration, due? }` | Option times allow unscheduled rows. Accessors derive their duration and optional due date from `(row, key)`. | `planEvents`, `planPrintWorks` |
| Event `templates` | `Schedule.templates(rows, { name, group?, at?, duration, values, source })` (`Calendar.templates` in a Calendar) over a templates record, its `source` the rail's source that narrows its cards; `values` supplies the fields other than time and resource, and an instant kind's templates omit `duration`. The Calendar and the Plan refuse a list written in the code (#1343, #1344). | `calendarOperations`, `planPrintWorks` |
| Event `fields`, `Schedule.field.*` | The shared `Fields` vocabulary: `text`, `number`, `select`, `tags`, `checklist`, `reference`, `readonly`, `hidden`; other editors derive from the field type. | `planEvents`, `planPrintWorks` |
| Event `ready`, `inspector` | Readiness returns `Editing.Types.Readiness` and can hold Save. A custom inspector receives the typed row and its session writer. | `planPrintWorks` |
| Event source, `entries` | The builder's `Slice.bindRecords` narrows a kind through a source named after its slot, over an interval index: its events in the window and its backlog read through it (the Calendar, #1343; the Plan, #1344), and the Roster's week of duties and the Allocation's day of bins, the range their own navigation writes (#1368, #1371). `entries: Data.bindPaged(record)` supplies original-key reads for editing. A kind's own `slice` and `filter` are refused at build, naming the change. See Indexed records and shared Slice above. | `calendarRecordIndexes`, `calendarOperations`, `planPrintWorks`, `planWindows`, `rosterWindowed`, `allocationWindowed` |
| Event `window`, `backlogWindow`, `entries` | The separate single-index paging form, described under Large records below. A kind narrowed through a source of its builder's rail takes neither `window` nor `backlogWindow`. | `calendarWindowed` |
| `Schedule.periods(Record.bind(r, [patch]), { every, status: { field, draft, published }, dismissed?, entries? })` **❗** | What a builder publishes (#1367): the app's record of periods, `Dict<DateTime, P>`, a row each keyed by its start — a UTC midnight, a week's first day by the builder's week start for `"week"`, or a `"day"`. `status.field` names a variant field of `P`, not an Option, and `draft` and `published` two of its cases; the published case holds `Null` or `{ at: DateTime }`. `dismissed`, the Roster's, names a `Set<String>` field: the proposals a week dismissed. `entries: Data.bindPaged(r)` reads the periods by key — the period, the one before it, the open picker's span, each one key search and one page — else the record is read whole. Without `periods`, a builder has no status chip and no Publish. | `rosterWarehouse`, `rosterWindowed`, `allocationKilnYard`, `allocationWindowed` |

A period whose status is the published case is read-only in every layout,
phones included, and so is one in a case that is neither, its chip naming the
case; a period with no row is Not started. Publish saves the period's drafts
first, and once every record reads back as saved writes the published case —
the time in `at` when the case holds one — and saves the period: a Save that
fails leaves the period a draft with its drafts kept, so a published period
never sits over unsaved rows. A period row the builder makes holds its type's
default in every field it doesn't map. Refused at build, each naming the
option: a record not bound with its patch mutation, not keyed by DateTime, or
whose rows are no structs; an `every` that is neither `"week"` nor `"day"`; a
`status.field` the row lacks, that is no variant or that is an Option; a
`status.draft` or `status.published` that is no case of it (`` `status.published`
names a case of "state" (cancelled, issued, open) — and it names "sent" ``), or
both naming one; a published case holding anything else; a `dismissed` that is
no `Set<String>` field; and `entries` that is not the record's own entries.

`Schedule.Types` exposes the same contracts to every builder:

| Type | Value |
| --- | --- |
| `ResourceRef`, `EventRef` | `{ kind, key }`: the slot name and the original key's text. |
| `Status`, `StatusCases(VariantType)` | `{ label, tone, ring }`, and one such status per variant case. |
| `Clock` | `{ hour, minute }`, both Integers. |
| `Duration` | The shared time-step variant: minutes, hours, days, weeks or months, with a Float amount. |
| `Candidate` | `kind`, `from` (template/backlog/event key), `start`, `end`, optional `resource`; the Plan's drop veto receives this. |
| `Patch(RowType)` | Every field optional; `Schedule.patch` constructs the patch. An omitted field stays unchanged; `none` supplied for an Option field clears it. |
| `Fit`, `Refusal` | One verdict of an app's fit — `fits { score, why, warn }`, or `refused` with its `Refusal` (`{ group, reason, measure }`) — the Roster's and the Allocation's alike. |

Event kinds default to batch Save. For automatic commits, set
`applyMode="auto"` on the same `<Plan>` with its bound resources and events:

```tsx
<Plan resources={resources} events={events} axis={axis} applyMode="auto" />
```

Each ready gesture commits through its kind's patch mutation. This does not change the separate data-series session's
`editing.mode`. Auto mode is covered by `plan-events.spec.ts` and
`plan-builder-editing.dom.test.tsx`; the showcase examples demonstrate batch Save.

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
| `Plan.over(data: Dict \| Data.bind handle, series: Series[])` **❗** | Series over a dataset, read only: a series declaring `edit` fails the build, naming `Schedule.events`. | `planEventLinks` |
| `Plan.eventRef(kind: String, key: String): Plan.Types.RunRef` | An event for a link's end, wherever it draws; `Plan.link` takes it without `fromRun` / `toRun`. A link naming a kind `events` has not fails the build — or, when its kind is not known there (a list held in a variable or built in East, an event end held in a variable), is refused as the Plan is evaluated. | `planEventLinks` |
| `canDrop: fn(Schedule.Types.Candidate) => Option<String>` | An event kind's drop veto, its message on the ghost, as the Calendar's — asked where a drag rests and again of the drop (#1196), its `from` the template's key, the backlog event's or the moved event's, its start, end and resource where the drop would put it; a `fn(DragEventType) => Boolean` vets drops on `data`'s rows instead. | `planPrintWorks` |
| `applyMode: "batch" \| "auto"`, `date` | When the event kinds' drafts go — on Save, each kind with a change as one patch through its patch mutation, checked against what its drafts began from, or each ready gesture as it lands (#1194) — and the date brought into view first. | `planPrintWorks` (`date`, batch Save); auto mode described above |

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
lifecycle, its quantity, its lane and its status's warning ring.

The rows are read over the window the canvas draws and the periods it lays
out beyond each edge, from the records as they stand, and read again when one
commits. A commit that changes none of them redraws nothing, and a read that
fails leaves the last rows standing and says why on the toolbar. Beside a
paged `data` they lead every window, drawn once.

| Signature | Description | Example |
| --- | --- | --- |
| a row's id: `entry { series: "<slot>.<draw>", path: [group?, …parents, key] }` | A resource's rows, by its kind's slot and the way they draw (`presses.span`, `presses.marks`). A measure row's id is the measure's key and the resource's path, a strip's `"<slot>.group"` and its group. Selection, collapse, links and focus address them. | `planPrintWorks` |
| an element's key: `East.print(Schedule.Types.EventRef { kind, key })` | Unique on a row the kinds that draw alike share; a popover, an element click and a link's event end name the event by it. | `planEventLinks` |
| the Unassigned rows: `entry { series: "<kind>.unassigned", path: [draw] }` | An event whose resource is none, or names one its kind does not have, draws on its kind's Unassigned row, after every resource kind. | `planEvents` |
| `Plan.link({ from: Plan.eventRef(kind, key), … })` | The link meets the event where it draws: a bar's end (a run shorter than the narrowest bar draws the narrowest), a chip's, in by the cell inset, a tile's cell, in its lane, and a mark's glyph. `planEventLinks` draws every way a link can, one link each. | `planEventLinks` |
| a resource kind no event kind is placed on, with no `measures` **❗** | Refused at build: it would draw no rows. | — |
| a key the event rows take (`<slot>`, `<slot>.<draw>`, `<slot>.group`, `<kind>.unassigned`) that a measure, a `data` series or a `Plan.over` series has **❗** | Refused at build, naming both: a row's id is its series' key and its path. | — |

#### Overlap feedback

With `overlaps: "warn"`, each overlapping event wears the shared warning ring.
The toolbar chip after the summary counts pairs; selecting it selects the first
pair in time order and brings its row into view, expanding its ancestors. The
inspector lists the selected event's pairs or the selected resource's pairs.
`planEvents` and `planPrintWorks` demonstrate this. Overlapping events are kept.

Bucket cells also preserve their events when space is short: they draw only
whole tiles, followed by a `+n` menu listing those that do not fit. Choosing a
menu item performs the same action as selecting that tile (`planTargetState`).

#### The frame (#1193)

`<Plan>` renders in its builder frame wherever it is used: the toolbar, the
banners, the canvas in main and the footer, and the panes its props ask for —
the library with `library` (#1195), the inspector with `inspector` (#1197);
with neither there is no pane. It draws no border, so a host frames it or
places it bare.

| Signature | Description | Example |
| --- | --- | --- |
| the toolbar | Every control the Plan draws outside its canvas, one row at every width: the rail of its one `Slice.bindRecords` folds first, its summary after every step of it, then the Plan's own steps and the key search into its icon; the fold toggle, the resolution and the overlaps chip into the date navigator's View, one move; the history item folds last. | `planTargetState`, `planRowDrop`, `planPrintWorks` |
| the banners | Each session's — `data`'s, and each event kind's titled with its name (#1194): a Save's conflict, a refusal, an unknown outcome with Retry, a source out of date with Discard; each leaves when what it reports does, and one kind's leaves the other kinds' commits standing. | `planRowDrop`, `planPrintWorks` |
| the footer | The counts — the event kinds' events in the window, their backlog, the changes pending and the last save of an event kind's record — then the author's `footer` and the transport line. | `planPrintWorks` |
| `style={{ height: "fill" }}` / `maxHeight` | The whole Plan's: the canvas fills main and scrolls its own rows. | `planTargetState` |
| a host's height, and no `style.height` | The canvas fills main and scrolls there; a host that gives none lets it grow with its rows. | — |

Removed with #1193: the canvas's own toolbar row (the frame's toolbar holds
its items) and its review foot, the Series button (the library pane's
Series tab, #1195) and the narrow layout's chip row (its items are the
toolbar's).

Removed with #1344: the local Slice — `Slice.bind`, the bare `slice={slice}`
handle and a single `Slice.bindRecord` (one `Slice.bindRecords`), and
`data={Slice.rows(slice)}` (the `rows` source of `slice={{ slice }}`) — with
its cohort, filter and search chips, the scope badge, the summary line's
local count, the brush's histogram and its live per-step writes (a record's
query moves once a gesture), a resolution's rewrite of the window (it
re-buckets) and templates written in the code (`Schedule.templates` over a
record). Each form still written is refused at build, naming the change.

#### The library pane (#1195)

`library` lists the start pane's tabs, in order, each a `Plan.library.*`
call; left out, or empty, there is no library pane. Its cards are what a
planner drags onto the canvas — an author's tab's onto the rows of `data`
that make an item of a card (#1259), the event kinds' onto their resources
(#1196) — and its Series tab is what a viewer shows and hides.

```tsx
// What the Plan reads whole binds with Data.bind: the customers, and the job templates — a record of their own.
const customers = $.let(Data.bind(planPrintCustomers));
const jobTemplates = $.let(Data.bind(planPrintJobTemplates));
// One rail (#1344): the templates' and the customers' sources narrow their tabs.
const slice = $.let(Slice.bindRecords("ops.plan", {
    jobTemplates: { source: Data.bindPaged(planPrintJobTemplates, { indexes: [jobTemplatesByGroup] }), fields: { group: { label: "Job templates" } } },
    customers: { source: Data.bindPaged(planPrintCustomers, { indexes: [customersByDistrict] }), fields: { district: { label: "District" } } },
}));
<Plan axis={axis} slice={{ slice }}
    resources={{ presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall }) }}
    events={{ job: Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
        templates: Schedule.templates(jobTemplates.read(), {   // a templates record, following its source of the rail
            name: t => t.name, group: t => some(t.group), duration: t => variant("hours", t.hours), values: t => t.values, source: "jobTemplates",
        }),
    }) }}
    library={[
        Plan.library.events(),       // every kind's templates
        Plan.library.backlog(),      // every kind's unscheduled events, by when they are due
        Plan.library.series(),       // what a viewer shows and hides
        Plan.library.tab(customers.read(), {   // the author's own cards
            name: "Customers", icon: "building",
            label: c => c.name, meta: c => some(c.trade), group: c => c.district,
            drop: c => Schedule.patch(PrintJob, { customer: c.name }),   // what a card dropped on a job sets
            source: "customers",                                         // the rail's source it follows
        }),
    ]} />
```

| Signature | Description | Example |
| --- | --- | --- |
| `Plan.library.events()` **❗** | Every event kind's templates, under the kind's name and then the template's `group` (`Print job · Jobs`). A card is its kind's icon, its name and `Print job · 6 h · presses`: its kind, how long it runs (an instant kind's runs no time) and the resource kinds it is placed on. Dropped on a resource's row it makes its event there (#1196). Each kind's list follows its source of the rail (#1344): the tab counts what it shows (`Events 8 of 12`) and, when the rail leaves a list none, says so with Clear filters for it. Refused on a Plan with no event kinds. | `planEvents`, `planPrintWorks` |
| `Plan.library.backlog()` **❗** | Every event kind's unscheduled events (a kind with Option times and a `backlog`), grouped by when they are due: Due this week (overdue included), Due next week, Later, No date — UTC weeks, from the Monday of the week the axis's `now` is in, else the week the Plan mounted in. A card is `6 h · Press A · due Fri 16` (`Unassigned` on no resource). It is read again as a kind's record commits, with every kind's drafts in place (#1196): a card dropped on a resource's row is scheduled and leaves it, an event dropped on the tab is unscheduled and joins it. Collapsed, the pane's rail counts it. A kind narrowed through its source (#1344) shows its narrowing's backlog, the tab counting `N of M` — what shows beside the stored events the choices hide — and its Clear filters keeping the window. Refused on a Plan with no event kinds. | `planEvents`, `planPrintWorks` |
| `Plan.library.series()` **❗** | `Pick.Panel`'s list in the order the canvas draws: each resource kind and its measures, the event kinds, `data`'s series when they are picked (`pick`), and the Plan's `rows` — a hand-built row by its key, a `Plan.over` series by its own. Hiding an event kind hides its elements everywhere, its Unassigned row and any row only it draws on with them (a resource's first row is its own, and stays); a resource kind its rows; a measure, or one of `rows`, its rows — a `Plan.over` series' nested series with it. `data`'s series hide through their pick. The rest are kept per viewer under the Plan's `id`, and only while the library lists this tab. Refused on a Plan with nothing a viewer can hide. | `planPrintWorks` |
| `Plan.library.tab(rows: Dict<K, R>, { name, icon?, label, meta?, group?, drop?, source? })` **❗** | `source` names the rail's source it follows, by its rows' keys (`Customers 6 of 16`, #1344). A card per row, its rows read as `Schedule.resources` reads them, accessors `(row, key)`: its label, its meta, the tab's icon, grouped by `group`, searched by key, label and meta. A click selects a card, and a click on the selected card lets it go. A key of another type than String is its card's key as East prints it. Its cards drag onto the rows of `data` whose series makes an item of a card (`edit.create`) — the drop's `from.key` the card's key, so `canDrop` and `create` read it as a Library card's — and the Plan takes them with no `id` or `sources` (#1259). | `planEvents`, `planPrintWorks`, `planRowDrop` |
| `drop: (row, key) => Schedule.patch(KindRowType, { … })` **❗** | With it, each card drags onto an event too, while one of the patch's kind is on the canvas. What a card dropped on an event sets (#1196): the patch's type names the event kind it lands on, so a patch over no kind's row type, or over one two kinds share, is refused at build, naming the tab. Dropped on the event under the pointer it sets the patch's fields as one step (`Harbour Arts Society → Spring catalogue` on the ghost); refused between events (`Drop a customer onto an event`) and on another kind's (`Stops take no customer`). | `planEvents`, `planPrintWorks` |
| `Schedule.patch(R, { field: value, … })` / `Schedule.Types.Patch(R)` | A patch over an event kind's row type: every field an `Option`, each field left out `none`; one set to `none` clears an Option field. | `planEvents` |
| a tab listed twice — an author's by its name **❗** | Refused at build, naming it. | — |

The pane is the frame's start pane, 272px open: its open tab and whether it
is collapsed are kept per viewer under the Plan's `id`, and below 560px of
frame it opens from its rail over the canvas. On a touch screen the Series
tab's search is a 44px field.

#### The inspector pane (#1197)

`inspector` gives the Plan its end pane: what is selected on the canvas. A
click on an event's element — a bar, a tile, a chip or a mark of an event
kind's rows — selects the event and its row, and the element wears the brand's
ring; Shift, ⌘ or Ctrl adds an event to the selection or takes it out. A click
on a row's name selects the row, and one on its plot names the bucket under the
pointer too. Esc clears it all. An event kind may give its own inspector for
one event, in place of the form over its `fields`:

```tsx
// A stop's own inspector: its title, and its kind on a segment — `update` writes the edited stop back.
const inspectStop = $.const(East.function([PrintStop, FunctionType([PrintStop], NullType)], UIComponentType, ($, stop, update) => {
    const setKind = $.const(East.function([StringType], NullType, ($2, picked) => {
        const kind = $2.const(picked.equal("service").ifElse(
            () => East.value(variant("service", null), PrintStop.fields.kind),
            () => East.value(variant("plate_change", null), PrintStop.fields.kind)));
        $2(update({ title: stop.title, at: stop.at, press: stop.press, kind }));
    }));
    return <SegmentGroup value={stop.kind.getTag()} onChange={setKind} size="sm"
        items={[SegmentGroup.Item("plate_change", "Plate change"), SegmentGroup.Item("service", "Service")]} />;
}));
<Plan axis={axis} resources={{ presses: … }}
    events={{
        job: Schedule.events(jobs, { …, fields: { customer: Schedule.field.text({ label: "Customer" }) } }),
        stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at",
            resource: { field: "press", of: "presses" }, inspector: inspectStop }),
    }}
    inspector />
```

| Signature | Description | Example |
| --- | --- | --- |
| `inspector` (`inspector={true}`) **❗** | The end pane, 320px. One event: its kind, its title, when it runs and its status; its resource, its start and end or its instant, its lane, its state and its quantity; its kind's form over `fields`, the fields its roles read left to their own lines; Duplicate and Delete; an overlaps banner lists this event's pairs. Several: how many, each kind's count, the list, and the bulk edit — the state, the resource, a shift of a day or an hour. A row: its resource's name, its lines and its group, its events in the window — how many, their hours, their quantities by unit — its overlapping pairs, and its measures at the bucket a click on its plot named; an Unassigned row, its kind's events on no resource; any other row, what it draws at that bucket. Nothing: the window's events, hours and backlog, and three hints. Collapsed, a rail naming what is selected. Refused on a Plan with no event kinds; `false`, or left out, no pane. | `planPrintWorks` |
| `Schedule.events(record, { …, inspector: fn(R, fn(R) => Null) => UIComponentType })` **❗** | The kind's own inspector for one event, in place of its form, over the event's row; `update(edited)` writes the edited event back. Passed through untouched, called only where the pane draws it. A function over another row type, or with no writer, fails the build. Plan and Calendar use it when their optional `inspector` pane is present; read-only Calendar never calls its editing callback. | `planPrintWorks` |
| the edits | Each one transaction of the Plan's history (#1194): a field of the kind's form, tinted while the record holds it otherwise; the kind's own inspector's `update`; Duplicate — each copy under a new key (a `String` key `-2`, `-3`, … after its own, an `Integer` key past the largest; a kind keyed otherwise has none), the copies then selected; Delete; and the bulk edit across kinds — the state, the resource (each event placed on that resource's kind), a shift of a day or an hour. They are off while a selected event's kind is saving or its record is not yet read. | `planPrintWorks` |

The pane is the frame's end pane: whether it is collapsed is kept per viewer
under the Plan's `id`, and below 560px of frame it opens from its rail over
the canvas.

#### Drag and drop over event kinds (#1196)

The event kinds' drags are built in: a Plan given `resources` and `events`
takes them, and its `library` gives the cards. Each is one step of the Plan's
one history (#1194), which Undo takes back. A drag starts after 4px and snaps
to the resolution; its ghost says what lands where, or — red — why it can't.
The panes slide off main while it lasts, and nothing drags in the narrow
layout.

| Signature | Description | Example |
| --- | --- | --- |
| a template card → a resource's row | Makes an event of its kind at the bucket under the pointer — from the template's `at` on a day or longer — for the template's duration, under a new key (a String key the template's, made unique: `brochure-2`), selected. Any of a resource's rows takes it: a stop's template on a press's bars lands on the press. Refused on a resource of a kind its kind is not placed on (`Needs presses`), or where `canDrop` refuses. | `planPrintWorks` |
| a backlog card → a resource's row | Schedules its event at the bucket under the pointer for its own duration, on the row's resource. The same refusals. | `planPrintWorks` |
| a bar, tile, chip or mark → along its row, or another resource's | Moves its event — across rows writing the resource field. A selected element moves the selection with it: the others by the same units, those on its resource onto the row's. Refused onto a resource of a kind it is not placed on. | `planPrintWorks` |
| a bar's or a chip's edge → along the axis | Resizes it, never shorter than one snap. | `planPrintWorks` |
| an event → the Backlog tab | Unschedules it: its times none, its resource kept. Refused for a kind whose times are no Options (`Stops have no backlog`). No trash zone shows. | `planPrintWorks` |
| an author's card → an event of its patch's kind | Sets the fields the patch sets on the event, as one step. Refused anywhere but an event, or on another kind's. | `planPrintWorks`, `planEvents` |
| an element of an event its drafts changed | Wears the brand tint in a brand border (a mark, the tint's ring), in both themes. | `planPrintWorks` |

#### Large records, a window at a time (#1199)

A record too large to read whole is read a window at a time: an event kind
through its record's indexes, and a resource kind paged as the canvas
scrolls. An event kind narrowed through its source of the Plan's slice
(#1344) reads its window and its backlog through the source's interval index,
as `planWindows`' jobs do; what follows is the form for a kind with no rail
(`calendarWindowed`). An event kind given `window` — a paged read of a day index over its
record, keyed by `Schedule.days` — reads only the days the canvas draws;
given `backlogWindow`, a paged read of an index keyed by
`Schedule.unscheduled`, its backlog; and given `entries`, a paged read of the
record's own entries, one event by its key. A resource kind given its
resources as a paged read pages them, 200 to a window, the key search seeking
one. Neither record is ever read whole: not to draw, not to edit, not to save.

```tsx
// Package side: the jobs record and its two indexes (e3.recordIndex), each keyed by Schedule's own function.
// export const jobsByDay   = e3.recordIndex("jobs_by_day", jobs, { keys: … Schedule.days(start, end) … });
// export const unscheduled = e3.recordIndex("jobs_unscheduled", jobs, { keys: … Schedule.unscheduled(job.start, job.due) … });
<Reactive>{$ => {
    const presses = $.let(Data.bindPaged(pressesTask));            // a window of presses at a time
    const jobs    = $.let(Record.bind(jobsRecord, [jobsPatch]));
    const days    = $.let(Data.bindPaged(jobsRecord, { index: jobsByDay, join: true }));
    const backlog = $.let(Data.bindPaged(jobsRecord, { index: unscheduled, join: true }));
    const entries = $.let(Data.bindPaged(jobsRecord));              // one job by its key
    return <Plan axis={axis}
        resources={{ presses: Schedule.resources(presses, { name: "Presses", icon: "print", label: p => p.name, sub: p => some(p.hall) }) }}
        events={{ job: Schedule.events(jobs, {
            name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
            resource: { field: "press", of: "presses" },
            backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
            window: days, backlogWindow: backlog, entries,
        }) }} />;
}}</Reactive>
```

| Signature | Description | Example |
| --- | --- | --- |
| `Schedule.events(record, { …, window: Data.bindPaged(record, { index, join: true }) })` **❗** | The kind's events over the days the canvas draws, read through a day index keyed by `Schedule.days` (a scheduled event filed under every day it runs into): the first day sought and the index's pages read from it; a pan seeks the day it brings in. An event filed under several days draws once, and the drafts draw over the window. Refused at build: an index of another record, or keyed otherwise; a `window` over Option times without `backlogWindow`; a `window` without `entries`; and either beside a source of the rail. An index read without `join: true` is refused as it is read. | `calendarWindowed` |
| `backlogWindow: Data.bindPaged(record, { index, join: true })` **❗** | The kind's backlog — the library's Backlog tab and the footer's count — read through an index keyed by `Schedule.unscheduled`. Refused on a kind whose times are plain `DateTime`s. | `calendarWindowed` |
| `entries: Data.bindPaged(record)` **❗** | The record's own entries: one event by its key — the inspector's, a gesture's before its first draft, a Save's read back, a conflict's — its key sought and a one-row page read. Required beside `window` or a source of the rail, refused without either. The kind's editing is a session over the record's revision: each change checked by the record against what it began from, and a Save's conflict naming each event another write moved, read by its key at the record's new revision, with who changed the record last. | `planWindows` |
| `Schedule.resources(Data.bindPaged(record), { name, icon, label, … })` **❗** | A resource kind paged as the canvas scrolls: a window of resources at a time, the events on them drawn with them, the key search seeking a resource by its key, its types its page's `Dict`'s. Its resources keyed by `String`, with no `group` or `parent`; one paged kind per Plan, and none beside a paged `data`. A link's end on its rows is named by the row's id; the inspector and the backlog's cards name a resource once it is read by its key. An event on a resource it does not have draws on no row, and the bulk edit offers none of its resources. The Calendar refuses a paged read: it reads a kind's resources whole. | `planWindows` |
| `Schedule.resources(rows, { window })` **❗** | Gone (#1199): refused at build, naming the paged form. | — |
| a `ui()` task over them | A record bound with `Record.bind` and read with `Data.bindPaged` too is in its manifest's `records` and `pages`, never its `paths`: it is never preloaded or polled whole. | `planWindows` |

A key search stands as the canvas reads new rows: a pan, a draft or a commit
to the jobs reads the presses' windows again over the same snapshot, and the
search keeps its text, its matches and the view. Only a new snapshot of the
presses asks it again, there.

#### A cell at a time, shaded zoomed out (#1039)

An event kind placed on a paged resource kind reads only the events of the
resources around the rows in view when its source lists a **series index** of
its record beside the interval index, and a **summary index** with it
(`planSeries`). A series index files each event under its resource and each
time tile it touches, carrying its row; a summary holds, under each resource
and tile, how many events touch it and the milliseconds of it they cover (the
**e3** skill). Nothing else in the Plan changes:

```tsx
// Package side, beside the interval index:
// export const jobsByPressWeek = e3.recordIndex.series("jobs_by_press_week", jobs, { key: "press", from: "start", to: "end", tile: "week" });
// export const jobsByPressMonth = e3.recordIndex.summary("jobs_by_press_month", jobs, { key: "press", from: "start", to: "end", tile: "month" });
const slice = $.let(Slice.bindRecords("ops.plan", {
    job: { source: Data.bindPaged(jobs, { indexes: [jobsByTime, jobsByPressWeek, jobsByPressMonth] }), range: "start" },
}));
```

A **cell** is the events of a block of fifty of the paged kind's resources in
one tile. The Plan wants the blocks meeting the rows in view and twenty-five
resources either side, by the tiles the range it reads touches — its window
and the periods laid out beyond each edge — and one tile either side: every
wanted cell's searches in one request, which counts its entries before one is
read, and the entries of the cells it does not hold in one more. A pan or a
scroll within the cells it holds reads nothing, and a commit reads the wanted
cells again, the old standing in until they land. The rail's window and its
exact count stay the interval index's.

| Signature | Description | Example |
| --- | --- | --- |
| a source listing `e3.recordIndex.series` + `e3.recordIndex.summary` beside the interval index **❗** | The kind read a cell at a time, two requests a change. A long event is in every tile it touches and draws once; the drafts draw where they place their events, read or not; a link's event end the cells do not hold is read by its key, in one read. | `planSeries` |
| past 10,000 events in the cells wanted | The summary's cells instead, at the largest of its tiles that divides the canvas's bucket — a day, an ISO week (which divides no month), a month, a quarter or a year — each resource's share of each bucket booked for bars and chips, how many events touch it for tiles and marks. With none that divides it, the events over the window while the rail's exact count of them is within the budget; past it the rows are hatched, and a banner names how many events there are and the resolution that shades them. A kind placed on resources read whole whose source lists a summary shades past the budget the same way, the rail's exact count deciding. | `planSeries` |
| a narrowing | A series index led by the narrowed fields serves it exactly; any other field is asked of the cells' events in one read. A summary shades a narrowing only when led by its fields. | `planSeries` |
| the footer and the inspector | The window's events counted exactly from the source, as the rail counts them; their hours and overlaps over the rows drawn — "Hours in view" — and the backlog read whole through the source's unset start. | `planSeries` |
| a series index without a summary; an index filed by another field than the kind's resource field, or over other times than its own; a series index for a kind placed on resources read whole, or on none; two series or two summaries of one tile over the same fields **❗** | Refused as the payload builds, each naming the change. | — |

### The Sheet — `<Sheet>`

`<Sheet>` is the planning spreadsheet, and there is one: it renders in its
builder frame wherever it is used — one toolbar holding every control the
sheet has, the banners, the grid in main with its strip docked under it, and
the footer — and its panes are optional props: `library`, before the grid,
and `inspector`, after it. No prop, no pane. Its rows come from one of three
sources:

- `record` — an e3 record bound with its patch door: its entries, one entry's
  rows or groups, or a large record a window at a time. Save is one patch
  commit through the record, and the footer gives the record's last save.
- `data` — the host's rows: an array, a whole-value bind handle (`State.bind`,
  `Data.bind`) or a paged source (`Data.bindPaged`). Edits reach the host
  through `onApply`, `onUpdate` and `onPatch`; with none of them the sheet is
  read only.
- the **`rows` source of its `slice`** — `slice={{ slice: Slice.bindRecords(key,
  { rows, … }) }}` (#1345): the source's record's rows, every one in the
  record's order, each row's id its record key. While the source narrows them
  the sheet draws the narrowing over them as the **lens** (#1349): each match
  at its row number, the rows either side of it, and a gap of its exact size
  over every other run of rows. Save commits through
  `onApply={Record.onApply(record, { keyed: true })}` by original primary key.

Its columns are typed — a date, a quantity with its unit, an integer, text, a
register lookup, reference or enum, a set of register members, a directed
`from > to` LINK between register members as a typed value, a stamped
read-only code, a custom parse / print pair — with a blank tail that invites
the next row, typed parsing with a docked candidate strip, a copilot that
fills cells and proposes whole rows from author East functions, one rail over
its `Slice.bindRecords` — its rows, whose narrowing it draws as the lens, its
templates records and the tabs that name a source — with saved-view tabs, drag
and drop, Excel round-tripping, and a key search over a paged source. Every change is a draft
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
<Sheet record={Record.bind(r, [patch])} | data={rows} id="id" | slice={{ slice: Slice.bindRecords(key, { rows, … }) }} columns={{ start: Sheet.column.date(Row, {…}), qty: Sheet.column.quantity(Row, Driver, {…}), … }} library?={[…]} inspector? /> — the planning SPREADSHEET in its builder frame: typed columns over its rows (date · quantity + unit · integer · text · register lookup / reference / enum · a set of register members · a directed `from > to` LINK between register members as a TYPED value · stamped read-only codes · a custom parse / print pair), a blank tail that invites the next row, typed parsing with a docked candidate strip (nothing ever floats over the grid), a copilot that fills cells and proposes whole rows from author East functions, one rail over its Slice.bindRecords with the LENS — the `rows` source's narrowing drawn over the record's rows, each match at its row number (#1349) — and saved-view tabs over every source's narrowing, drag and drop, Excel round-tripping, and a key search over a paged source. Declared the way east-ui's Table and the Plan are: every per-row fact is an accessor, the builders take the row type FIRST, and nothing at the author's side is addressed by a string name
├─ The frame: ONE toolbar holding every control the sheet has, in this order — the view tabs, the lens's context switch and its count line (while the `rows` source narrows the rows, #1349), the key search, the rail over its `Slice.bindRecords` and its summary (each source a narrowing hides rows of, named in its own words, #1358), the scope badge and the history item (a sheet with none of them, read only with no slice, has no toolbar). It is one row at every width: the rail folds first, then its summary, then the sheet's own steps — the tabs into `+n`, the count line, the context switch's label, the strip closing up as the context switch goes — then the key search into its icon (which opens the box in a popover, the focus in it) and the view tabs into one chip naming the open view, its menu every view, `+ TAB` and the open view's close (#1221); where the sheet has a key search, the chip folds last into the search's popover, its views over the box (#1345); and the history item last, to its buttons; on a touch screen every control there is a 44px tap target. The banners — a Save's conflict naming its rows and who changed the record last, a refusal with its reason, an unknown outcome and a failed confirmation read each with Retry, the out-of-date notice with Discard, each source the library follows whose narrowing could not be read, with Retry, and an `entry` the record does not hold; main — the grid, filling the room the panes leave and scrolling its own rows, the strip docked under it; the footer — the sheet's, over a record its last save, and over the slice's `rows` source the rows a Save took out of the narrowing. ⌘Z undoes and ⇧⌘Z / ⌘Y redo from anywhere in the frame; a field being typed into keeps its own undo. The sheet fills its parent and draws no border: give it a box of its own height
├─ Rows — ONE of three sources (two, or none, is refused):
│   ├─ record — `Record.bind(r, [e3.mutation.patch(r)])` over a `Dict` record: its entries are the rows, in key order, each row's id its key's text (any key type: a non-String key by its `.east` text). `window={Data.bindPaged(r)}` reads the same record a window at a time. `entry={{ key, rows: F, id: I }}` is one entry's Array field `F`, in its own order, each row identified by the `String` field `I`; each entry keeps its own drafts, and a key the record does not hold opens empty and read only, named in a banner. With `group`, the entry's field holds groups, or `Sheet.Types.Entry(P, "lines")` entries with loose rows between them (`id` then names a field of both types); a record of groups is grouped the same way. Save is ONE patch commit, checked against what each row was when its edit began, confirmed by the rows the record reads back. Over a record `id`, `onApply` and `onUpdate` are refused (the record identifies and commits its rows); `entry` and `window` need a record
│   ├─ data — the host's rows: an `Array<R>` value / expression or a `$.let`-bound whole-value handle (`State.bind` / `Data.bind`) for the INLINE arm; a paged source for a WINDOWED arm — a `$.let`-bound `Data.bindPaged(…)` handle, recognised by its East type: `pinned` when it names its snapshot, which `onApply` needs, `paged` when it is the shape a UI exported before `revision` / `refresh`, which names none — positional (`Array<R>` windows) or keyed (`Dict<String, R>` windows; the key is the row id). When a pinned source's `revision()` moves (`Data.bindPaged` follows each write to its dataset), the sheet re-reads its resident windows at the new snapshot IN PLACE: the rows on screen stay until theirs land (no remount, no empty frame), the scroll position and row heights hold, and a standing key search is cleared. A failure stays where it happened: a window the source cannot read is ONE band where its rows would be — the elements it covers, the reason and a Retry — while the windows around it keep working and the rows after it keep their numbers; a `total()` or `revision()` that throws is said on the footer's transport line with a Retry while the rows stay; only a source that fails before anything lands replaces the grid, with a Retry. A row that throws while it draws is a one-row diagnostic. A `Dict` inline is refused (a sorted map would sit rows in key order, not the planner's) — a record's entries come through `record`. `id` (required on a positional source) names the `String` field that identifies a row; over entries of groups and loose rows, a field of BOTH types
│   └─ the `rows` source of `slice` — slice={{ slice: Slice.bindRecords(key, { rows: { source: Data.bindPaged(r, { indexes }), fields, range?, search? }, … }) }} (#1345): the source's record's rows, every one in the record's order, each row's id its record key, a grouped sheet's groups its records; while the source narrows them, the sheet draws the narrowing over them as the LENS (#1349) — each match at its row number, its number marked; `context` rows either side of it, the toolbar's context switch (0 · 1 · 3); and every other run of rows a gap of its exact size, whose controls open 1 · 3 · 10 · all from its top, its bottom or both. e3 places the narrowing's rows from its index alone, and the lens reads only the record's segments that hold matches near the view — a page and one ask of which of its rows the narrowing holds, each — so a gap over rows with no match reads nothing, whatever the record's size; a stretch still being read or placed is one band that says so. The count line says `n matches · m context`, n e3's count. A segment whose rows disagree with where e3 placed the narrowing's is one failed band saying the record changed, with a Retry — never a match the index does not hold. The rows the planner opened stay open across a revision that moves them, found again by their rows' keys. A grouped sheet's lens narrows its groups: a matching group's every line shows. Edits through `onApply={Record.onApply(record, { keyed: true })}`, a Save that takes rows out of the narrowing said in the footer; the key search seeks in the record's order, and under the lens opens the row it lands on. `record`, `data`, `window` and `entry` beside it are refused, each naming the change
├─ Props:
│   ├─ columns (required) — keyed by the row's fields and checked per key (a key that is not a field, a date under a `String` field, a builder over another row type: type errors): Sheet.column.text(R, cfg) · date(R, { base?, format?, level?, actual? }) — the common date field (`dd / mm / yyyy` segments); pasted text takes the B§3 grammar (`+3d`, `4d` from `base`, `fri`, ISO, `d/m[/yy]`); `level: r => …` reads each row's date at a Sheet.Types.DateLevel ("week" | "day" | "range" | "time" — no shifts: a host with shifts uses a `custom` kind) and `actual: r => Option<DateTime>` is when the work really happened (the cell then prints it with its difference, the wanted date becoming the cell's detail) · quantity(R, cfg) or quantity(R, D, { uom: d => d.uom, format? }) — a float with the DRIVER row's unit in the common number field, in the viewer's language (#852): the cell groups (1,234.5 — German 1.234,5; through `format` when declared), the edit box and copy are bare (1234.5 — German 1234,5), typed and pasted text reads the viewer's separators (pasted `1.2k` / `1.2m`, German `1,5k`, still parse; a typed quantity rounds to a whole number), and ⏎ on an unchanged edit box writes nothing · integer(R, cfg) · lookup(R, { options? }) — the DRIVER column only (scored candidates from its register) · reference(R, register, cfg) — a lookup over a flat member list · enum(R, register, { options? }) — an upper-cased register word with a valence dot · set(R, register, { members?, multiple?, store? }) — comma members, the link grammar without an arrow · link(R, D, register, { to? | from?, members, multiple?, sides?, arity?, check?, store?, options? }) — `from > to`, the split cell; `members: [{ kind, identified?, countable?, resolvesTo?, ranged? }]` — `ranged` offers and prints runs of consecutive codes as one range. `options` (enum / lookup / link) is fn(Sheet.Types.DraftContext(R, D)) => Option<Array<String>> — the member keys the row is OFFERED (`none` = the whole register; typed text still resolves against the whole register) · stamped(R, { owner? }) — read-only, skipped by paste and clear · custom(R, { accepts, parse, print }) — an author parse / print pair over the field's payload. Every kind takes { header, sub, width, editable?, fill?, detail? } (`header` + `sub` are the two header lines; `fill` = providers, the first that yields wins; `detail: r => String | Option<String>` is the text the hover and the strip show beyond the value); text / date / quantity / integer also take `value: r => …` for a derived READ-ONLY projection on any field. A set / link column sits on a `Sheet.Types.Link` field, an `Array<Sheet.Types.Member>` field (the other half named by `to` / `from`), or a `String` field the grammar parses on read and prints on commit per `store` ("asTyped" | "canonical" — the register's labels)
│   ├─ group (optional) — Sheet.group(P, "lines", { title, sub?, cells?, folded?, noun? }): the rows are GROUPS whose lines live in one `Array<L>` field; `columns` are declared over `L`; `cells` = band cells (Sheet.group.cell.*) keyed by the line column they sit under; `noun: { singular, plural }` is the word the renderer prints for a group (omitted, the sheet says its own in the viewer's language — "group" / "groups" in English, #861). LOOSE rows between the groups (#846): rows of Sheet.Types.Entry(P, "lines") entries — each `variant("group", P)` or `variant("row", L)` — and a row entry draws as a plain row: no band or rail, numbered in the groups' sequence, its own cells. The seam above a band or beside a loose row inserts a loose row (a line's seam and a group's blank line still insert a line); loose rows delete, paste and count on their own ("2 groups · 3 lines · 3 loose rows"), fold-all passes them by and no band sticks over them. A new line there gets its `id` field minted unless `newRow` supplies one; drafts, checks and the change set carry the entry (a draft is `variant("group", …)` or `variant("row", …)`, a loose row's DraftContext has `group: none`)
│   ├─ subRows (optional) — Sheet.subRows(R, { arrayField: (item, row) => Sheet.subRow({ code?, name, chips?, facets?, id? }) }): READ-ONLY rows under each line (a flat row) that share none of its columns — keyed like `columns` by the array fields of the type the columns are built over (a grouped sheet: the line type), key order = display order; `facets` is a label → String | Option<String> record (a `none` drops out); the renderer owns the tree, the `{line}.{n}` index, folding and search
│   ├─ driver (optional) — Sheet.driver(column, rows, { key, label, aliases?, meta? }): the `lookup` column whose member decides what the row does; its rows are the register and its row type `D` is what a quantity's `uom`, a link's `sides` and every copilot function (`ctx.driver`) read
│   ├─ registers (optional) — { name: Sheet.register.members(rows, { kind, key, label, aliases?, meta?, parent?, tone? }) | Sheet.register.concat([…]) }: the lookup tables reference / enum / set / link columns resolve against; accessors receive `(value, key)` (a `Dict<String, T>` register reads its key as the second argument; an Array's key is its index); duplicate keys fold, first wins — so a family kind ("CNC router" from every router) declares one member per distinct value
│   ├─ owned (optional) — accessor r => Bool: rows the upstream system owns — no copilot, stamped columns read-only
│   ├─ suggest (optional) — { ahead?, triggers?, ghost?, propose: [fn] }: the copilot's row proposers — East functions (sync, or async for a model call) over Sheet.Types.DraftContext(R, D) — current draft row and neighbours, rowIndex, driver: Option<D> and today; draft fields are missing | value(T) | invalid(String), so guard with hasTag("value") before unwrap("value") — returning Array<Sheet.Types.Proposal(R)> ({ patch: Sheet.patch(R, { … }), meta }); a column's `fill` providers are the same shape returning Option<Sheet.Types.Fill(T)> ({ value, meta }). The first that yields wins; fills CHAIN in column order (a later column sees the earlier fills as if taken); an async one shows a pending chip in the strip and the newest context wins; a rejected fill / proposal is remembered for the session
│   ├─ slice (optional) — slice={{ slice: Slice.bindRecords(key, { rows?, <a templates list's source>…, <a tab's source>… }, { presets? }), affordances?, persist? }} (#1345): ONE rail on the toolbar over its sources — `rows` narrows the sheet's rows (above), each templates list's source its cards in the Rows tab, and an author's tab's source that tab's cards; a sheet over `record` or `data` takes a slice of templates sources alone. The bare handle, `Slice.bind`, a single `Slice.bindRecord`, a source nothing names, `affordances` / `persist` outside `slice` and the `brush` affordance (the sheet has no axis) are refused, each naming the change. While `rows` narrows the rows, the sheet draws the narrowing over the record's rows as the lens (above, #1349). Over a keyed paged source the key search seeks over `seek` (the jump rebases residency and, once the match's window is in, lands the ring on the match and scrolls to it — until then the jump owns the viewport, so a scroll report from where the sheet was cannot undo it; a match whose window cannot be read shows its failed band instead). The ring, a range and an open editor stay on their rows as windows land around them
│   ├─ views / activeView (optional) — `views` is a whole-value bind handle of Array<Sheet.Types.RecordView> (`State.bind` keeps them per viewer, `Data.bind` shares them): saved views, each every source's narrowing by the source's name (#1345), with the lens's context and the rows the planner opened, by their first and last rows' keys (`Sheet.Types.Reveal`, #1349), as TABS — the pinned whole-sheet tab, which clears every source, `+ TAB` snapshot (named from the sources' searches), each tab's count its `rows` narrowing's through the record's index, the dirty dot when the rail drifts from the tab, × or middle-click close, double-click rename, drag reorder — on a row short of room, one chip naming the open view, its menu every view, `+ TAB` and the open view's close (#1221), and with a key search last folded into its popover (#1345); every change lands at once and is written back through the handle (`onViewsChange` is refused); `activeView` opens a tab and is followed when the host moves it. The tabs show on a sheet with a `rows` source; a sheet without one takes `views` and shows none
│   ├─ onUpdate (optional, `data` only, INLINE arm) — fn(Array<R>) => Null over a LIVE data bind handle: reads the latest collection, checks the batch base and writes the complete result once. Hidden fields survive. Pass data={rows} and onUpdate={rows.write}; a captured array is refused for this adapter
│   ├─ onPatch / onApply (optional) — onPatch: fn(Sheet.Types.PatchEvent(E)) => Null observes one draft gesture including incomplete values (either source); onApply (`data` only): sync/async fn(Sheet.Types.ChangeSet(E)) => Sheet.Types.ApplyResult persists a complete checked batch. Paged writes require revision/refresh, atomic host application and request-id deduplication
│   ├─ applyMode (optional) — "batch" (default: the history item's Save sends the batch) | "auto" (each ready gesture goes at once, through the same acknowledgement path)
│   ├─ newRow / newGroup / ready (optional) — newRow: fn(NewRow) => Patch(R) supplies defaults, including hidden fields; newGroup: fn(NewGroup) => Patch(G) a new group's; ready.row: fn(Draft(R), DraftContext(R, D)) => Readiness adds business rules; ready.group: fn(DraftGroup(G, "rows")) => Readiness checks grouped drafts. Required fields and valid parsing are always checked; optional absence becomes none
│   ├─ edits (optional) — insertRows / removeRows gate structure independently of cell edits; insertGroups / removeGroups require grouping. moveRows: "none" | "within" | "between" and moveGroups say what a grip may move. Keyed top-level creation uses key order; positional insertion uses gutter buttons, the selection strip or Alt+Insert / Alt+Shift+Insert
│   ├─ onSelect / selection (optional) — the ring reported as { rowId, line, key }; give `selection` and the ring is CONTROLLED (follows the value, scrolls into view, every move still reports)
│   ├─ newRowId (optional) — fn() => String minting inserted rows' ids (else the renderer mints one); over a record keyed by a non-String key, the new row's key as its `.east` text — required there unless `edits` inserts no row
│   ├─ readOnly / blanks / density (optional) — the whole sheet read-only · padding rows below the last real one (default 18; typing into one INSERTS a row after the last real one — blanks are padding, never rows) · row rhythm
│   ├─ footer (optional) — [{ text, tone? }] counts; a paged source adds the transport line ("N loaded of M · Loading…")
│   ├─ style (optional) — { gutterWidth } — the sheet fills the box it is given and scrolls its own rows there
│   └─ name (optional) — names the sheet when a surface holds two: its panes' open tab and collapsed state, the columns a viewer hides, its library's drag source and its drop target are kept under it
├─ Panes — optional props, each its own; the examples show every combination (none, a library, an inspector, both):
│   ├─ library (optional) — the start pane's tabs, in order, each a `Sheet.library.*` call: `rows()` — the templates, by their group, each card saying what it sets, each list following its source of the rail — the tab counting what it shows (`Rows 5 of 11`) and, when its sources leave it none, saying so with Clear filters for them; `columns()` — the declared columns, each with its kind and an eye that hides it from the grid per viewer (the last shown stays; a sheet whose library lists no Columns tab hides none); `tab(data, { name, icon?, key, label, meta?, group?, drop?, source? })` — the author's own cards from an Array or a `Dict<String, T>` (its key the accessors' second argument), searched by key, label and meta, following the rail's `source` it names as the Rows tab does; `drop: (row, key) => Sheet.patch(R | G, …)` sets a row's fields where a card lands, or a band's when the patch is over the group type. Left out, or empty, no library pane (SB59). Collapsed, the pane is a rail with the templates' count
│   ├─ templates (optional) — Sheet.templates(templates.read(), { name, group?, values, source }), or a list of them: templates RECORDS (#1345), bound with `Data.bind`, one card per row in the record's key order, each list naming its source of `slice` — a grouped sheet's row templates and group templates two records and two sources, a group template's `values` over the group type; a dropped card is `newRow`'s (`newGroup`'s) defaults with the template's fields over them. A list written in the code, one naming no source of the slice or one it lacks, one naming `rows`, two naming one source, and values over another type are refused, each naming the change
│   ├─ inspector (optional) — given alone (`inspector`, `inspector={true}`): the end pane's Details shows the selected row's every field — through its column's kind, or by its type (a field no column shows included) — tinted where it differs from what the source holds, each edit ONE transaction; several rows selected, a column set across them as one step; a band, the group's own fields, Add line, Duplicate and Delete with its lines; Issues lists the batch's issues by row, each going to its cell (over a paged source, sought by its key). `inspector={East.function([R, FunctionType([R], NullType)], UIComponentType, ($, row, update) => …)}` — the author's own Details for a complete row (SB58), passed through untouched and called where Details draws; `update(edited)` is one transaction; a row whose draft is still incomplete shows the form. With nothing selected, Details counts the rows, the pending drafts and the issues, and over a record says the last commit and who made it. Left out, no inspector pane
│   └─ fields / groupFields (optional, with `inspector`) — the inspector form's hints by field — `Sheet.field.*`, east-ui's `Fields`: a label, a help line, an editor, read only or hidden; a column's kind is its field's default (SB10). Given without an inspector they are refused
├─ Drag and drop: a template lands on the seam it is dropped on — a row beside a row, a line in the group under the pointer, a group between groups, or, on a keyed source, where its key sorts; an author's card sets its patch's fields on the row or band it lands on; a row's, a line's or a band's grip moves it, as `edits` allows (a keyed source's rows and groups have no grip). The ghost's caption says where, and turns red where a drop is refused; ⏎ on a card does what a drop below the ring would; each drop is one transaction. On a coarse pointer a frame too narrow for the touch gutter beside the first column folds it (#1215): each row's actions go into one 44px row-actions button — the row's grip and its menu
├─ Keyboard (B§6): arrows / ⇧arrows (↓ on the last row appends — on a flat sheet, once a paged source is exhausted) · ⇥ / ⇧⇥ walk the copilot's fills, then take rows, then move · ⏎ takes the next suggestion, else edits with the value selected (F2 too); a printable key seeds a fresh edit · ⌘⏎ fills the row (one undo step), ⌘⇧⏎ takes everything · esc ladder, one rung per press: editor → chip selection → selected proposal → row fill → every suggestion → range → dirty tab revert → the whole sheet · ⌫ clears cells (never a stamped one) or deletes whole selected rows · ⌘C / ⌘V round-trip with Excel (a link cell as two columns) · ⌘/ and ⌘F reach the key search — its box, or, folded to its icon, the box in its popover, opened (#1221) — else the row's first search box. In a link editor: `,` resolves a member, `>` hops From → To, ⇥ takes the ghost → a predicted chip → hops → commits right, ⌫ pops the last chip
├─ Localization (#861): every word the sheet says itself — the toolbar and the view tabs, the header, the rows, bands and gap pills, the strip and the editor, the footer and the history item, the banners, the panes, the insertion chips, and the message each gesture leaves — comes from ONE typed message table, its counts in the LOCALE react-aria's `<I18nProvider locale="de-DE">` sets (the browser's language otherwise). Host React code overrides any subset of the words for a subtree with `<SheetMessagesProvider messages={GERMAN}>` (@elaraai/e3-ui-components; `sheetMessages` is the English table — each message a function of named, already-formatted parameters, plus the raw `n` for plurals; define the overrides ONCE, not per render — providers nest). The message a gesture leaves is kept as data and worded as it shows, so a new table re-words it. What the AUTHOR wrote is data and never translated: headers and subs, a group's `noun`, register labels and metas, lock tags, footer items, library tab names; the date and link GRAMMARS keep their forms (day-first dates, `TBC`, `N x kind`), and the issues a patch event carries to the host stay in English (the sheet shows them in its words)
└─ Factories:
    ├─ Sheet.column.text / date / quantity / integer / lookup / reference / enum / set / link / stamped / custom(R, …) — the column builders (see `columns`); Sheet.driver(column, rows, accessors) — the driver; Sheet.register.members(rows, accessors) / Sheet.register.concat([…]) — registers
    ├─ Sheet.link.parse(text, members) / Sheet.link.print(link) — the link grammar as East functions (`R2140, Bay 2 > 4 x CNC router`: codes and aliases, ranges `R2140-45`, counted `N x kind`, `TBC`, free text kept as a `text` member — never a refusal) · Sheet.link.arity(half, implied) — how many members a half should hold, `implied: fn(Context(R, D)) => Option<Sheet.Types.Counted>` (the strip reads "n × kind implied · k named") · Sheet.link.check.exists() and author checks fn(Sheet.Types.CheckContext(R)) => Option<String> — a `some(message)` FLAGS the member (warn chip + title), never blocks
    ├─ Sheet.patch(R, { field: value, … }) — a row patch (omitted fields `none`): a proposal's row, where the runner writes only the fields with editable columns, a template's values, a card's drop, or the explicit defaults `newRow` / `newGroup` return for a new row, hidden fields included (a field left `none` starts missing)
    ├─ Sheet.subRows(R, sources) / Sheet.subRow({ code?, name, chips?, facets?, id? }) — sub rows (see `subRows`); a left-out `code` / `id` is "", `chips` / `facets` []
    ├─ Sheet.library.rows() / columns() / tab(data, config) — the library's tabs; Sheet.templates(rows, { name, group?, values, source }) — a templates record's cards for the Rows tab (#1345); Sheet.field.* — the inspector's hints (east-ui's `Fields`)
    ├─ Sheet.apply(E, idField) — the checked batch applier as an East function: fn(entries, Sheet.Types.ChangeSet(E), revision: Option<String>) => Sheet.Types.Applied(E) — the base (snapshot or revision) is checked first, then the whole batch applies or none of it does (`conflict` says why); `E` is the row struct or a Sheet.Types.Entry(G, "rows") union of groups and ungrouped rows. Request deduplication stays with the host's `onApply`. It IS east-ui's shared `Editing.apply` (#879); a keyed Dict source applies with `Editing.apply(DictType(K, E))` — entries addressed by key, placed `keyOrder`
    └─ Sheet.Types.DraftContext(R, D) / Draft(R) / Fill(T) / Patch(R) / Proposal(R) / PatchEvent(E) / ChangeSet(E) / Applied(E) / Entry(G, "rows") / ApplyResult / Readiness / CheckContext(R) — typed contracts for providers, drafts, checked application and checks; grouped contexts use (G, "rows", D). The transaction and draft types are east-ui's shared editing contract's (`Editing.Types.*`, #879) under their Sheet names — the same values. Sheet.Types.Link / Member / Cell / Row / Line / SubRow / Facet / DateLevel / Noun / RecordView / Reveal / Selection / Counted / Sides / RegisterMember are shared value and wire types.
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
the same one: a gesture's `origin` names its `resize` and `drop` too. A keyed `Dict` source applies with
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
| `data` + `id` (+ `onApply` / `onUpdate`) | The host's rows: an array, a bind handle or a paged source. | `sheetVariants` |
| `slice={{ slice: Slice.bindRecords(key, { rows, … }) }}` + `onApply={Record.onApply(record, { keyed: true })}` **❗** | The `rows` source's record's rows, in the record's order, each row's id its record key (#1345); `record`, `data`, `window` and `entry` beside it are refused. | `sheetWorkshop`, `sheetStress`, `sheetRecordIndexes` |
| the lens: the `rows` source narrowed **❗** | Its narrowing drawn over the record's rows (#1349): each match at its row number, `context` rows either side (0 · 1 · 3), a gap of its exact size over every other run, opening 1 · 3 · 10 · all, and the count line — e3 placing the matches from the index, the lens reading only the segments near the view. The rows opened are kept by their keys, in a view too. | `sheetRecordIndexes` |
| `record` with `data`, or neither; `id` / `onApply` / `onUpdate` over a record; `entry` / `window` with `data` **❗** | Refused, naming the prop and the fix. | — |
| **The panes** | | |
| `library: [Sheet.library.rows(), Sheet.library.columns(), Sheet.library.tab(data, { name, key, label, drop?, … })]` **❗** | The start pane's tabs, in order; none, no pane. A tab's `drop` patch over the row type lands on rows, over the group type on bands. | `sheetLibrary`, `sheetWorkshop` |
| `templates: [Sheet.templates(rows, { name, group?, values, source }), …]` **❗** | The Rows tab's cards, each list a templates record naming its source of `slice` (#1345); a list written in the code, or one naming no source, `rows` or another list's source, is refused. | `sheetWorkshop`, `sheetBatches` |
| `inspector` | The end pane: Details for what is selected, its every field, and Issues. | `sheetWorkshop`, `sheetBatches` |
| `inspector: fn(R, fn(R) => Null) => UIComponentType` **❗** | The author's own Details for a complete row; a row still missing a field shows the form. | `sheetWeeks` |
| `fields: { f: Sheet.field.readonly() \| Sheet.field.hidden() \| … }` / `groupFields` **❗** | The inspector form's hints, by field; refused without an inspector. | `sheetWorkshop`, `sheetBatches` |
| **The frame** | | |
| the toolbar | Every control the sheet has, one row at every width: the rail folds first, then its summary, then the sheet's own steps, then the key search into its icon and the view tabs into one chip (#1221) — with a key search, last into its popover (#1345); the history item folds last. ⌘F reaches the key search in either form. | `sheetWorkshop`, `sheetPaged` |
| `views: State.bind([ArrayType(Sheet.Types.RecordView)], key, [])` **❗** | The saved views, each every source's narrowing by name (#1345), as a bind handle; `onViewsChange` is refused. | `sheetWorkshop`, `sheetStress` |
| `name: String` | Names the sheet when a surface holds two; its panes' state, the columns hidden, its drag source and its drop target follow it. | every example but `sheetBasic` |

Removed with #1216: `<Sheet.View>` and `<Sheet.Builder>` (both `<Sheet>`), a
builder's `id` (`name`), `onViewsChange` (`views` is a bind handle) and
`style.height` / `maxHeight` (the sheet fills its box).

Removed with #1345: the bare `slice={slice}`, `data={Slice.rows(slice)}` and
`window={Slice.rows(slice)}` (the `rows` source of `slice={{ slice }}`),
`affordances` and `persist` outside `slice`, `Slice.bind` and a single
`Slice.bindRecord` (`Slice.bindRecords`), `Sheet.Types.View`
(`Sheet.Types.RecordView`) and templates written in the code (`Sheet.templates`
over a record) — each refused at build, naming the change.

Changed with #1349: the `rows` source's rows are its record's, every one in the
record's order, the source's narrowing drawn over them as the lens — where they
were the narrowing's rows alone, in its index's order — and a saved view's
`reveals` are `Sheet.Types.Reveal`s, the rows the planner opened by their
first and last rows' keys, where they were row positions. An application's own
record of saved views changes type with it.

### The Flowchart — `<Flowchart>`

`<Flowchart>` is the state-transition flowchart: states as nodes in ORDERED
phase lanes — its layout derived from the lanes and the links, never from
coordinates — H/V-routed transition arrows, optional per-link decision
triggers (lettered diamonds) and evidence-weighted strokes. The dim-ladder
highlight and the selection grammar are built in, and what is selected shows
in its inspector. Where the Schematic (below) places items at world
coordinates, the Flowchart lays its states out itself, for reading a process
flow.

There is one Flowchart, and it renders in its builder frame wherever it is
used (#1245): one toolbar — find state, LR · TD, the freshness chip, the rail
of its one `Slice.bindRecords` (#1346), and where it edits the history item —
the canvas in main, filling it and scrolling both ways inside it, and the
footer's counts: over many flows the open flow's name first, where it edits
the changes waiting on Save, and over a record its last save. Its library
pane, when `library` lists a tab, holds the tabs it lists, in its order: the
Flows tab (#1246), state and transition templates — templates records — and
the author's own cards (#1248, below), each following the source of the rail
it names (#1346), whose cards drop on the canvas (#1249, below). Its
inspector, on by default, is the end pane: what is selected, through its form,
and the open flow's issues (#1250, below). It fills the box it is given and
draws no border: give it a box of its own height.

Its flows come from one of two sources:

- **`record`** — an e3 record of `Flowchart.Types.Flows`, flows by name, bound
  with its patch mutation: `Record.bind(r, [e3.mutation.patch(r)])`. The usual
  case: the canvas shows the flow opened last, else `flow`, else the first flow
  by name. A record always holds flows by name — `e3.mutation.patch` writes
  only keyed records — so a lone flow is a record of one entry, or the host's
  `data`; a record of one flow is refused at build.
- **`data`** — the host's flows by name or one flow, the value's type picking
  the arm: a value, an expression or a bind handle (`Data.bind`).
  `Flowchart.over(states, { … })` builds one flow from the app's own tables
  through their row mappers; nothing narrows the host's flows (#1346). Read
  only, unless the host gives `onApply`, its commit of the
  flowchart's edits: one patch of the value — over flows by name the open
  flow's insert, update or delete by name, never the whole value replaced;
  over one flow, the flow's own patch — answered as Save is.

A flow is `{ description, lanes, states, links, triggers }` of the row types
(`Flowchart.Types.Flow`). `Flowchart.values({ [name]: flow })` and
`Flowchart.value(flow)` write a dataset's value as literals, filling what a
literal leaves out and refusing at build what would not draw or commit: two
lanes, states, links or decisions of one key, a state naming a lane the flow
does not have, a link naming a decision it does not have. A link naming a
state the flow does not have is kept — it draws as the unresolved ghost.

Every edit is a draft of the open flow's editing session (#1247), each flow
keeping its own: over a record, and over `data` given `onApply`, the canvas's
gestures are its — "+ LANE" at the band row's tail, a lane's header
double-clicked to rename it in place (a click selects the lane, as the user
ruled on 2026-10-08: "a click on a lane's header selects the lane, and a double-click renames it in place, as a state's double-click opens its editor"), its × (off while the lane holds states, its tooltip saying why), the
"+ STATE" ghost under a hovered lane, a state double-clicked into its editor
(a new key rekeys its transitions' ends and the decisions' queues) or dragged
across lanes, a handle dragged to another state (`canConnect` vetoes a pair;
a drop on the state it left is its ↻ in-place transition), and Del on the
selection: a state (with its transitions), several states, a transition, a
decision, or a lane that holds none — and every edit the inspector makes. Each
is ONE transaction the history item undoes and redoes — ⌘Z, ⇧⌘Z or ⌘Y from
anywhere in the frame but a field being typed into — and Save sends the open
flow's drafts as one commit. Two lanes, states, keyed transitions or decisions
of one key hold Save off, the history item counting the issue. The flowchart
takes no callback for an edit.

The tag and its types — `Flowchart.Types` — come from `@elaraai/e3-ui`, and
the tags around it from `@elaraai/east-ui`. It moved here from east-ui
(#1243), and its tables became a flow (#1244): a surface that wrote east-ui's
`<Flowchart states={…} links={…} lanes={…} />` passes the same tables and
mappers to `Flowchart.over`, as `data`.

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { East } from '@elaraai/east';
import { Box, Reactive, UIComponentType } from '@elaraai/east-ui';
import { Flowchart, Record } from '@elaraai/e3-ui';
import e3 from '@elaraai/e3';

// The depot's flows, by name: each written as a literal, checked when the package builds.
export const depotFlows = e3.record("depot_flows", Flowchart.Types.Flows, Flowchart.values({
    "Inbound parcels": {
        description: "From the trailer to the van",
        lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }],
        states: [
            { key: "ARV", label: "Arrived", lane: "intake" },
            { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
            { key: "LDD", label: "Loaded", lane: "load" },
        ],
        links: [{ from: "ARV", to: "CH*", trigger: "route" }, { from: "CH*", to: "LDD" }],
        triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
    },
}));
export const depotFlowsPatch = e3.mutation.patch(depotFlows);

const flowchart = East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
        return (
            <Box height="480px">
                <Flowchart record={flows} flow="Inbound parcels" library={[Flowchart.library.flows()]} />
            </Box>
        );
    }}</Reactive>
));
```

One flow from the app's own tables, each an e3 input, through their row
mappers — read only, as the host gives no `onApply`:

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, East, StringType, StructType, variant } from '@elaraai/east';
import { Box, Reactive, UIComponentType } from '@elaraai/east-ui';
import { Data, Flowchart } from '@elaraai/e3-ui';
import e3 from '@elaraai/e3';

// The app's own tables: its steps by phase, and the moves between them.
export const Step = StructType({ code: StringType, name: StringType, phase: StringType });
export const steps = e3.input("steps", ArrayType(Step), variant("value", [
    { code: "ARV", name: "Arrived", phase: "intake" },
    { code: "SRT", name: "Sorting", phase: "sort" },
    { code: "LDD", name: "Loaded", phase: "dispatch" },
]));
export const Move = StructType({ src: StringType, dst: StringType, kind: Flowchart.Types.Kind });
export const moves = e3.input("moves", ArrayType(Move), variant("value", [
    { src: "ARV", dst: "SRT", kind: variant("planned", null) },
    { src: "SRT", dst: "LDD", kind: variant("observed", null) },
]));

const flowchart = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const states = $.let(Data.bind(steps));
        const links = $.let(Data.bind(moves));
        return (
            <Box height="500px">
                <Flowchart
                    data={Flowchart.over(states.read(), {
                        state: s => ({ key: s.code, label: s.name, lane: s.phase }),
                        links: links.read(), link: l => ({ from: l.src, to: l.dst, kind: l.kind }),
                        lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "dispatch", label: "Dispatch" }],
                    })}
                    name="steps"
                />
            </Box>
        );
    }}</Reactive>
));
```

The host's flows, edited, and committed by the host: Save hands `onApply` the
session's request id and one patch of the flows — the open flow's insert,
update or delete by name — which the host commits through a record's patch
mutation under that id, answering with what e3 said (`flowchartVariants` maps
every outcome). A write that got no answer throws, so the session's Retry sends
the same request id again, and e3 answers it with the first write's commit
rather than writing twice (#1275):

```tsx
const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
const onApply = $.const(East.asyncFunction([StringType, PatchType(Flowchart.Types.Flows)], Editing.Types.ApplyResult, ($2, requestId, patch) => {
    const outcome = $2.let(flows.commit.patch(requestId, patch));
    const answer = $2.let(variant("rejected", [{ entry: "", row: none, field: none, message: "The write was refused" }]), Editing.Types.ApplyResult);
    $2.match(outcome, {
        committed: ($3, done) => { $3.assign(answer, variant("applied", { revision: some(done.stateHash) })); },
        // invalid, failed and timed_out → rejected with their words; conflict → conflict
        transport: ($3, lost) => { $3.error(East.str`The write got no answer, so it may have committed — retry to find out: ${lost.message}`); },
    });
    return answer;
}));
<Flowchart data={flows.read()} flow="Inbound parcels" onApply={onApply} library={[Flowchart.library.flows()]} inspector={false} name="host" />
```

```
<Flowchart record={…} | data={…} /> — state-transition flowchart in its builder frame: states as nodes in ORDERED phase lanes (layout derived — no coordinates), H/V-routed transition arrows, optional per-link decision triggers (lettered diamonds); dim-ladder highlight built in; the inspector, on by default, shows what is selected
├─ The frame (#1245): ONE toolbar holding every control the flowchart has — find state (a search over the open flow's states by key and by label; a pick selects the state and scrolls it into view), LR · TD, the freshness chip, at its end the rail of its one `Slice.bindRecords` and its summary, naming each source a narrowing hides rows of in its own words (#1346, #1358), and where it edits the history item (#1246, #1247: the open flow's session — its status, its issues, Undo, Redo, Discard and Save). It is one row at every width: the rail folds first, its summary after every step of it, then the freshness chip goes, LR · TD folds into one chip naming the orientation (its menu both) and find state's box into its icon (which opens the box in a popover, the focus in it) — with a rail, LR · TD then folds into that popover, its View, one move, so a phone's row keeps the rail and Save — and the history item last, to its buttons; on a touch screen every control there is a 44px tap target. The banners — the open flow's session's: a Save's conflict or refusal, an unknown outcome and a failed confirmation read, each with Retry, and the source changed under its drafts, with Discard; a source of the rail whose narrowing could not be read, with Retry; and a `flow` the flowchart doesn't hold, named with the flow shown in its place (`Gone isn't a flow here — showing Inbound parcels`) until the viewer opens a flow or the record gains that name. Main — the canvas, filling it and scrolling both ways inside it, its lanes running main's whole height; over flows by name with none — an empty record — the shared empty state, with "+ New flow" where it edits. The footer — the counts: over many flows the open flow's name first, the transitions and their planned · observed · unresolved split, where it edits the changes waiting on Save (`3 pending` — each lane, state, transition and decision the drafts add, change or remove), and over a record its last save. The start pane is `library`'s, an optional prop; the end pane is the inspector, on by default. The flowchart fills its parent and draws no border: give it a box of its own height
├─ Its flows — ONE of two sources (both, or neither, is refused):
│   ├─ record — Record.bind(r, [e3.mutation.patch(r)]): r of Flowchart.Types.Flows, flows by name (the canvas opens the flow the viewer opened last, kept in the UI store under `name`; else `flow`; else the first by name). Each flow keeps its own session (#1246): its drafts stay while another flow is open, and Save sends the open flow's as ONE patch through the record's patch mutation — `Record.onApply(record, { keyed: true })`, the flow's insert, update or delete by name; the drafts retire once the record reads it back. A record always holds flows by name — e3's patch mutation writes only keyed records — so a lone flow is a record of one entry, or `data`; a record of one flow is refused
│   └─ data — a value, an expression or a bind handle of Flowchart.Types.Flows (+ `flow`) or Flowchart.Types.Flow, the value's type picking the arm; read only unless given onApply (async, (String, PatchType(the value's type)) → Editing.Types.ApplyResult — `East.asyncFunction([StringType, PatchType(T)], Editing.Types.ApplyResult, ($, requestId, patch) => …)`), the host's commit: Save hands it the session's request id — the same again on a Retry, so a host that keys its write by it (`commit.patch(requestId, patch)`) writes once (#1275) — and one patch of the value — over flows by name the open flow's insert, update or delete by name, never the whole value replaced; over one flow the flow's own patch — and the drafts retire once the host's value holds what it was handed
├─ Flowchart.over(states, { state?, links, link?, lanes, lane?, triggers?, trigger? }) — one Flowchart.Types.Flow from the app's tables:
│   ├─ states + links + lanes (required) — the three tables (lanes accept a literal [{ key, label? }] array; array order = band order)
│   ├─ state / link / lane / trigger (optional) — row mappers to { key, label?, lane, members?, notes? } / { key?, from, to, kind?, trigger?, evidence? } / { key, label? } / { key, label, letter?, owner?, queue?, outcomes? }; omit when rows are already Flowchart.Types.*
│   └─ triggers (optional) — decision registry; a link's `trigger` names one (0..1 per link ⇒ the lettered diamond at the longest-run midpoint; clicking it highlights governed links)
├─ Flowchart.values({ [name]: flow }) / Flowchart.value(flow) — a dataset's value as literals { description?, lanes, states, links, triggers? }, Options filled, checked at build (two of one key; a state naming no lane the flow has; a link naming a decision it does not have)
├─ A flow's rows:
│   ├─ link `kind` "planned" (solid, default) | "observed" (dashed 5/4); DERIVED marks: a from/to ref with no state row ⇒ the neg-dashed ghost "No state row" node (unresolved, counted in the footer); from == to folds to the `↻ n` badge (never routed); `members` ⇒ the ×N state-class badge
│   └─ link `evidence` { volume?, count?, measuredAt?, unit? } — stroke weight (log 1.6 / 2 / 2.5 px, floor 1.4) + paper-filled run badges whose chrome inherits the link class (imported, never hand-authored)
├─ Props:
│   ├─ orientation (optional) — "LR" (default) | "TD" initial; the toolbar's LR · TD toggles it (view state, never a filter chip; TD swaps the handle axes) — the viewer's pick kept in the UI store under `name`, so a remount keeps it, the payload's value showing until they pick (#1246); freshness (optional) — the toolbar's chip { label, date? }
│   ├─ legend / minimap (optional) — legend default true (reserves canvas space); minimap auto at ≥ 25 states, drawn in main's corner over the canvas, where it stays while the canvas scrolls
│   ├─ slice (optional, #1346) — slice={{ slice: Slice.bindRecords(key, { flows?, <a templates list's source>…, <a tab's source>… }, { presets? }), affordances?, persist? }}: ONE rail at the toolbar's end. Over `record`, its `flows` source — `Data.bindPaged(record, { indexes })` over the same record — narrows the Flows tab, which pages what it narrows the record to, in its index's order, and counts it (`Flows 683 of 2,048`); without one the tab lists the record read whole. When the rail leaves no flow the tab says so (`No flows match the filters`), with Clear filters for `flows` alone; its own search finds a flow by name within the narrowing, never writing the rail (`Search 683 flows by name…`, `680 hidden by filter · Show all`), and says so when the rail's choices block it, naming the filters to clear. The open flow is read by its name whatever the narrowing, its drafts kept, Pending again once it shows; a Save that takes it out of the narrowing confirms by primary reads and says so in the footer (`1 flow left this view`). Each templates list's source narrows that list's cards (`Steps 2 of 5`), and an author's tab's its cards by the key its `key` gives, each with the shared empty state. Over `data` nothing narrows the flows: the slice holds only the sources its lists and tabs name. Refused, each naming the change: `window`, the bare handle, `Slice.bind`, a single `Slice.bindRecord`, a source nothing names, `affordances` outside `slice`, the `brush`, and a `flows` source over `data` (`flowchartRecordIndexes`, `flowchartLibrary`)
│   ├─ onSelectState / onSelectLink / onSelectTrigger / onTracePath (optional) — click / ⌥-click callbacks (entity keys); Esc restores everything instantly
│   ├─ canConnect (optional) — fn(from, to) => Boolean: vetoes a pair BEFORE the connect draft snaps, and fails OPEN
│   ├─ readOnly (optional) — no gesture edits — no "+ LANE", lane ×, ghost, connect, move, Del, "+ New flow" or history item — the selection and hover staying (inspecting isn't editing), the inspector printing every field and editing none; feed it a permission or published-mode flag
│   ├─ library (optional, #1246) — the start pane's tabs, in order, each a `Flowchart.library.*` call: `flows()` — every flow by name, over a record or `data`'s flows by name, each card its name and under it its description, or with none its counts (`4 lanes · 9 states · 11 transitions`), the open flow's card placed and a flow with drafts marked Pending; a click opens a flow; the tab's search reads names and descriptions; where the flowchart edits, "+ New flow" under the cards names a new flow in a popover hanging from it — a name the flowchart holds refused there, with the reason — and opens it with one lane, a draft insert Save commits and Discard drops; `states(templates.read(), { name?, icon?, source, label, meta?, group?, drop })` (#1248, #1346) — state templates: a templates RECORD, a `Dict<String, T>` bound with `Data.bind`, one card per row in the record's key order, each keyed by the record's key (the accessors' second argument), following its `source` of the rail — its label, its meta under it and the tab's icon, grouped by `group`, searched by key, label and meta, each card a drag source that a click selects and a second click lets go; `drop: (row, key) => Flowchart.patch(Flowchart.Types.State, …)` is the fields of the state a card dropped on a lane adds; unnamed, the tab is `States`, in the flowchart's words; `transitions(templates.read(), { …, source, drop })` — transition templates, the same, `drop` a `Flowchart.patch(Flowchart.Types.Link, …)` that retypes the transition a card lands on — its kind, its decision and its other fields, never its key, from or to (refused as the tab's cards are read); unnamed, `Transitions`; `tab(rows, { name, icon?, key, label, meta?, group?, drop?, source? })` — the author's own cards from an Array or a `Dict<String, T>`, following the rail's `source` it names by the key its `key` gives, each a drag source when the tab declares `drop`, the patch's type naming what a card lands on (`State` a state, `Link` a transition, `Lane` a lane's header, `Trigger` a decision); what a dropped card does is the Drag and drop branch's, below (#1249). An empty tab says so in the shared empty state — `No flows`, `No templates`, `Nothing in <name>`, and `No matches` for a search that hides every card. Left out, or empty, no library pane; collapsed, the pane is a rail with the first tab's count. `flows()` over one flow (`data` of Flowchart.Types.Flow), a tab listed twice (the Flows tab or a template tab, or two of the author's tabs of one name), a data tab's rows of neither an Array nor a `Dict<String, T>`, a templates list written in the code, naming no source of the slice or one it lacks, naming `flows`, or given a `key`, the state and transition templates naming one source, and a `drop` over another row's patch than its tab's are refused at build, naming the tab
│   ├─ inspector (optional, #1250) — the frame's end pane, ON BY DEFAULT: left out, or `true`, it shows — pinned beside main with room, over main from its rail without — and `inspector={false}` takes it away. Its tabs Details and Issues, Issues with its count; collapsed, a rail with its icon, the issue count and what is selected. Details shows what is selected, every field through the shared form (east-ui's `Fields`, each by the input its type takes), each edit ONE transaction of the open flow's session, a field the drafts changed tinted and the head's chip Pending (New for a row the record holds none of): a state — key (a new key rekeys its transitions' ends and the decisions' queues), label, lane, members (Set and Clear), notes; its transitions in and out, each a link that selects it; Duplicate and Delete — an end no state stands for saying so, with its transitions, Delete taking them away; a transition — from and to, kind, decision (or none), key; its evidence read only (volume and unit, count, when measured); Delete; a decision — key, label, letter, owner, queue (tags over the flow's states), outcomes; the transitions it governs; Delete, clearing it from them; a lane, which a click on its header selects — key (a new key moves its states), label; how many states it holds; Delete, off while it holds any, saying why; several states (a shift-click puts one in or takes it out) — how many, a lane every one moves to, Delete; nothing — the open flow: over many flows its name (a new name renames it, one transaction, refused for a name the flowchart holds) and description, Duplicate and Delete, over one its description; its counts, its transitions' planned · observed · unresolved split, over a record its last save and who made it, and three hints. A key or a name left empty is refused, the footer saying why. `inspector={{ state?, transition? }}` gives a state or a transition the author's own Details in place of its form — `East.function([Flowchart.Types.State, FunctionType([Flowchart.Types.State], NullType)], UIComponentType, ($, state, update) => …)`, `Flowchart.Types.Link`'s for a transition — `update(edited)` writing the edited row back as ONE transaction (read only, nothing); every other kind's Details are its form. Issues lists the open flow's issues — two of one key, which hold Save off; a state naming a lane the flow has none of; a transition naming a state it has none of; a decision's queue naming one; a Save's conflict or refusal — each a click selecting what it names. Read only — over `data` with no `onApply`, or with `readOnly` — Details shows every field and edits none; name (optional) — names the flowchart when a surface holds two: its open flow, LR · TD, its panes' open tab and collapsed state are kept under it
│   └─ No `height`, `maxHeight` or `density`: the flowchart fills the box it is given and draws at one rhythm, the spec's 116×40 cards in their lanes — each is refused at build
├─ Editing (#1247) — over a record, and over `data` given `onApply`, every gesture is ONE transaction of the open flow's session: "+ LANE" (Font Awesome's plus over its word, at the band row's tail) adds a lane keyed `lane-<n>`, labelled `Lane <n>`; a lane's header, double-clicked, is renamed in place (⏎ / blur commits, Esc cancels) — a click selects the lane, as the user ruled on 2026-10-08: "a click on a lane's header selects the lane, and a double-click renames it in place, as a state's double-click opens its editor"; a lane's × (Font Awesome's xmark beside its header) deletes it — off while it holds states, its tooltip saying why (`Move its 2 states first`); the "+ STATE" ghost (Font Awesome's plus) under a hovered lane opens the inline editor (key, then label; ⏎ commits, Esc dismisses) and adds the state at the end of its lane; a state double-clicked opens the same editor — a new key rekeys its transitions' ends and the decisions' queues in the same transaction; a state dragged across lanes moves (candidate bands highlight); a handle dragged to a state connects them — a transition of the default type (planned, no decision, no evidence) keyed `<from>→<to>`, made unique — the drop on the source its ↻ in-place transition, a drop that would repeat one pulsing it; Del (or Backspace) in the canvas deletes the selection — a state with its transitions, several states, a transition, a decision, cleared from the transitions it governs, or a lane that holds no state — never in a field being typed into. ⌘Z undoes and ⇧⌘Z / ⌘Y redo from anywhere in the frame but a field. Save is on while the open flow has a change and no two lanes, states, keyed transitions or decisions share a key; a Save's conflict or refusal keeps every draft under its banner, and a write with no answer turns Save into Retry, which resends the same request
├─ Drag and drop (#1249) — a library card carried over the canvas (picked up after 4px; on a touch screen after a 300ms hold): the ghost's caption says where it lands — `after CH* in Sort`, `at the start of Sort`, `in Hold`, `onto CH* → LDD` — or, red, why it can't: `Drop onto a lane`, `Drop onto a transition`, `Drop onto a state`, `Drop onto a lane's header`, `Drop onto a decision`, `The flowchart is read only`. A state template dropped on a lane adds a state there, at the row under the pointer — after the states above it — the lane washed in the brand's tint and a brand line where it lands: seeded with its drop's fields over a state's defaults, in that lane, its key the drop's where the flow doesn't hold it, else made unique (`HLD-2`), else minted (`state-<n>`), and selected. A transition template dropped on a transition retypes it — the transition taking the brand wash — its key and its ends kept. An author's card sets its fields on what its drop's type names: a state, a transition, a lane by its header, a decision by its diamond (a new key followed as an edit's is — a state's into its transitions' ends and the decisions' queues, a lane's by its states, a decision's onto the transitions it governs). ⏎ on a card does what a drop on the canvas's selection would — a state template after the selected state, in its lane, at the end of a selected lane, or at the end of the first lane with nothing selected; any other card on what is selected, when it lands there — a lane's card on the lane its header selected — and where that is refused the footer says why; on a touch screen a tap on the selected card does the same, the card staying selected. Each drop is ONE transaction of the open flow's session; the library pane over main slides off it while a card is carried
└─ Factories: Flowchart.values / Flowchart.value / Flowchart.over / Flowchart.patch(T, { … }) (a row patch over State | Link | Lane | Trigger, every field an Option) / Flowchart.library.flows() / states(templates, cfg) / transitions(templates, cfg) / tab(rows, cfg) (the library's tabs); closed-set fields are typed values via Flowchart.Types.* — Flow, Flows, State, Link, Lane, Trigger, Evidence, Kind, Orientation, Patch(T)
```

| Signature | Description | Example |
| --- | --- | --- |
| `<Flowchart record={…} flow="…" />`, `Flowchart.values({ … })` | A record of flows by name, bound with its patch mutation; the canvas shows the flow opened last, else `flow`, else the first by name — a `flow` it doesn't hold named in a banner above main. LR · TD is the viewer's, kept under `name`. | `flowchartFlows` |
| `<Flowchart record={flows} slice={{ slice: Slice.bindRecords(key, { flows: { source: Data.bindPaged(flowsRecord, { indexes }), … } }) }} />` **❗** | The Flows tab pages and counts what the `flows` source narrows the record to (#1346): only nearby cards mount; the open flow and its drafts keep their original name outside the narrowing; the tab's own search finds a flow by name within it; Find state searches the open graph. | `flowchartRecordIndexes` |
| `library={[Flowchart.library.flows()]}` **❗** | The library pane's Flows tab (#1246): every flow by name — its description or its counts, the open one placed, one with drafts Pending — a click opening it, the open flow kept under `name`; where it edits, "+ New flow" opens a new flow, a draft insert Save commits through the record's patch mutation. Each flow keeps its own drafts. | `flowchartFlows` |
| `library={[…, Flowchart.library.states(templates.read(), {…, source }), Flowchart.library.transitions(templates.read(), {…, source }), Flowchart.library.tab(rows, {…})]}` **❗** | The library's template and author's tabs (#1248): a templates list is a templates record, one card per row keyed by the record's key, an author's tab an Array or a `Dict<String, T>` — each following the source of the rail it names (#1346) — its label, its meta and the tab's icon, grouped and searched; each template card a drag source, and an author's when its tab declares a `drop`, whose patch's type names what it lands on; a click selects a card, a second lets it go. | `flowchartLibrary` |
| a library card dropped on the canvas, or ⏎ on it **❗** | Drag and drop (#1249): a state template adds a state on the lane at the row under the pointer, its key the drop's, made unique or minted; a transition template retypes the transition it lands on; an author's card sets its fields on what its drop's type names. ⏎ drops a card on the canvas's selection, and on a touch screen a tap on the selected card does too; refused, the ghost — or, for ⏎, the footer — says why. Each drop is one transaction. | `flowchartLibrary` |
| `<Flowchart data={Data.bind(input)} />`, `Flowchart.value({ … })` | One flow of the host's, an input's value, read only. | `flowchartHandover` |
| `<Flowchart data={Flowchart.over(states, { state, links, link, lanes })} />` | One flow from the app's own tables — each an e3 input — through their row mappers. | `flowchartDepot` |
| `<Flowchart data={flows} onApply={…} />` **❗** | The host's flows by name, or one flow, edited: Save hands `onApply` the session's request id and one patch of the value — over flows by name the open flow's insert, update or delete by name, over one flow the flow's own patch — which the host commits, through a record's patch mutation under that id (`commit.patch(requestId, patch)`) or as it keeps them, answering with what happened; a write with no answer throws, and the Retry hands the same id (#1275). Over flows by name the Flows tab lists them and "+ New flow" starts one. | `flowchartVariants` |
| `Flowchart.over`'s `triggers` + `trigger`, a link's `trigger` / `evidence`, `freshness` | Decision diamonds, evidence-weighted strokes and badges, and the freshness chip on the toolbar. | `flowchartDepot` |
| the frame (#1245) | One toolbar — find state, LR · TD, the freshness chip, the rail and its summary — one row at every width, the rail folding first, its summary after every step of it, then the chip, LR · TD into its chip and find state into its icon, and with a rail LR · TD into find state's popover; the canvas filling main, scrolling both ways; the footer's counts, the open flow's name first over many, the last save over a record. | `flowchartDepot`, `flowchartFlows`, `flowchartRecordIndexes` |
| `<Flowchart record={…} canConnect={…} />` **❗** | Editing (#1247): every gesture on the canvas — "+ LANE", a lane renamed or deleted, the "+ STATE" ghost, a state edited (rekeying its transitions) or moved, a handle dragged to connect, Del on the selection — one transaction of the open flow's session; Undo, Redo and Discard, and one checked Save through the record's patch mutation. `canConnect` vetoes a pair. A record's lone flow is its one entry. Over `data`, the same with `onApply`, handed the session's request id with its patch — the same id on a Retry (#1275). | `flowchartDetail`, `flowchartFlows` |
| `inspector` (on by default) / `inspector={false}` **❗** | The end pane (#1250): Details for what is selected through the shared form — a state, a transition, a decision, a lane its header selects, several states, or the open flow — each edit one transaction, tinted against the record; Issues, each a click selecting what it names. `false` takes it away. Read only, every field printed. | `flowchartDepot`, `flowchartFlows`; `false`: `flowchartHandover`, `flowchartVariants` |
| `inspector={{ state, transition }}` **❗** | A state's or a transition's own Details, in place of its form: an East function over the row and its writer, `update(edited)` one transaction of the open flow's session. | `flowchartDetail` |
| `onSelectState` / `onSelectLink` / `onSelectTrigger` / `onTracePath` | What the host hears, after the canvas selects: a state's key, a transition's, a decision's, and a transition ⌥-clicked. | `flowchartVariants` |
| `legend` / `minimap` / `readOnly` | The legend, on by default; the minimap, shown from 25 states unless given, in main's corner over the canvas; read only — no gesture, no drop, no history item, every field printed. Each a Boolean or an expression the host changes. | `flowchartVariants` |
| `orientation="TD"` | Opens top down; after that LR · TD on the toolbar is the viewer's, kept under `name`. | `flowchartHandover` |
| `name` | Names the flowchart when a surface holds two: its open flow, LR · TD, its panes' open tab and collapsed state, its library's cards and its drop target are kept under it. | every example but `flowchartFlows` |
| `record` and `data` together, or neither; `onApply` over a record; `window`, the bare slice handle, `Slice.bind`, a single `Slice.bindRecord`, a source nothing names, `affordances` outside `slice`, and a `flows` source over `data` (#1346); a templates list written in the code, naming no source, naming `flows` or given a `key`, and the two templates lists naming one source; `flow` over one flow; a record of one flow, or of another type, or bound without its patch mutation; `affordances: ["brush"]`; `states=`, `links=`, … on the tag; `height` / `maxHeight`; a callback for an edit (`onAddState`, `onCreateLink`, …) or `linkMode`; `Flowchart.library.flows()` over one flow; a tab listed twice — the Flows tab or a template tab, or two of the author's tabs of one name; a data tab's rows of neither an Array nor a `Dict<String, T>`; a `drop` over another row's patch than its tab's; a `library` that is not a list of `Flowchart.library.*` calls; a hover card's prop — `stateHover`, `linkHover`, `triggerHover`; an `inspector` neither a Boolean nor `{ state, transition }`; a kind's own Details over another row, or returning no UI; and `density` **❗** | Refused at build, each naming the prop and the remedy; a transition card whose `drop` sets its transition's key, from or to is refused as the tab's cards are read. | — |
| `Flowchart.patch(Flowchart.Types.State, { key: "HLD", label: some("Held") })` | A patch over one of a flow's rows: the fields it sets, the rest `none`. | `flowchartLibrary` |

Between the examples, every pane combination: none (`flowchartHandover`), a
library (`flowchartVariants`), an inspector (`flowchartDepot`, read only;
`flowchartDetail`, its own Details), and both (`flowchartFlows`,
`flowchartLibrary`, `flowchartRecordIndexes`). The indexed example has 2,048 flows
narrowed through its rail's `flows` source — by description, computed state
count, lane, decision owner and name — with the Flows tab's own search by name
within the narrowing, paging and original-ID Save. A composite
description/state-count index lets those two filters combine, and a
description/name index lets the tab's search find within a description; lane
and owner use exact membership.

Removed with #1245: the canvas's eyebrow (its controls are the toolbar's
items) and `height` / `maxHeight` (the flowchart fills its box).

Removed with #1247: a callback per edit — `onCreateLink`, `onDeleteLink`,
`onAddLane`, `onRenameLane`, `onDeleteLane`, `onAddState`, `onEditState`,
`onMoveState` — and `linkMode`, with the event types they took
(`Flowchart.Types.LinkCreateEvent`, `LaneRenameEvent`, `StateAddEvent`,
`StateEditEvent`, `StateMoveEvent`, `LinkMode`): the gestures are the
session's, and each prop is refused at build, naming the remedy. A host that
heard each gesture commits once, through `onApply`.

Removed with #1250: the hover cards — `stateHover`, `linkHover` and
`triggerHover` — each refused at build naming the inspector, which shows what
is selected (ruled by the user on 2026-10-08); and a click on a lane's header
renaming it: a click selects the lane, and a double-click renames it in
place.

Removed with #1251: `density`, which the canvas never drew by — it draws at
one rhythm, the spec's 116×40 cards in their lanes (ruled by the user on
2026-10-09) — refused at build.

Removed with #1346: `window={Slice.rows(slice)}` (the `flows` source of
`slice={{ slice }}`), the slice over the host's tables and its footer readout
(`N links · narrowed from M · −%`), `affordances` outside `slice`, templates
read from an Array or an input (templates records) and a templates list's
`key` — each refused at build, naming the change.

### The Schematic — `<Schematic>`

`<Schematic>` is the 2D world-coordinate drawing of the app's own records:
placed items (racks, cooling units, power distribution units), zones (halls,
cages, hot and cold aisles), links between two items (fibre runs) and nets
joining many to many (a power distribution unit feeding a row of racks), each
where its row places it and the canvas scaled to fit the extent. Where the
Flowchart lays its states out itself, the Schematic draws what the records
place.

It stores nothing in a shape of its own (#1386): each kind is a record of the
app's, keyed by String, its fields mapped to the Schematic's roles —
`Schematic.items`, `zones`, `links` and `nets`, each under a slot of its
sort's prop. A role names a field of the row: its type is checked when the
code compiles and again at build, refused naming the role, the field and its
type (`` `x` names a Float field, or an Option of one — "name" holds .String ``).
A role the app computes — a second line, a meter, a tone — is an accessor
`(row, key) => …`, reified once and called per row. A shape is one too
(#1401): a footprint, or a zone's geometry, is built from the row's own fields
with `Schematic.circle`, `polygon`, `polyline` or `rect`, so no field of the
app's record holds a type of the Schematic's — a shape role naming a field is
refused, naming the accessor to write. The layers are the app's rows as well,
read through `Schematic.layers` as the Roster reads its lists, an entity's
`layer` field naming one by its record's key. A gesture writes only the
fields its roles map: every other field of the row reads back as it was.

A kind's binding says whether it is editable and how it is read; any other
binding is refused, naming the one to use:

| Read | Editable | Read only |
| --- | --- | --- |
| whole | `Record.bind(record, [e3.mutation.patch(record)])` | `Data.bind(record)` |
| complete, through its source of the slice | `Record.bind(…)` + `entries: Data.bindPaged(record)` | `Data.bindPaged(record)` |

A source of `slice={{ slice: Slice.bindRecords(key, { … }) }}` named after a
kind's slot reads that kind through it — `Data.bindPaged(record, { indexes })`
over the kind's record — every row of its narrowing; an indexed read is the
source, never the kind's record. A kind's details (`Schematic.details`) are
bound as their kind is read: whole beside a kind read whole, by key beside one
read through its source. Bound with their patch door —
`Record.bind(record, [e3.mutation.patch(record)])`, with `entries:
Data.bindPaged(record)` beside a kind read through its source — the inspector
edits them beside their kind's row; `Data.bind` or `Data.bindPaged` alone
reads them only.

The canvas draws each kind's rows: an item at its centre, as a card or a
marker by the zoom, its footprint about its centre; a zone in its box,
outlined or hatched, its shape about the box's centre; a link routed between
its ends, two of one pair fanning into lanes; a net as a bus. Its links and
nets draw in the Plan's and the Allocation's links look (#1403): cased in the
paper, in the muted ink or their style's tone, each ending on the edges of the
items it joins where they draw at the zoom — a card's side, a labelled pin's
edge, a dot's rim — a link's head where it arrives at its `to` item and a
net's on each of its destination legs, a caption — its `label` and its
`metric`, `uplink · 100G` — on a knockout at its middle from the label zoom;
the one under the pointer lit, and a selected one, in the strong ink, their
ends ringed. An item kind
whose `x` and `y` are Options keeps its rows with no position as its backlog,
drawn nowhere. A record another session commits is drawn again. `onSelect`
hears the whole selection after each change — items, zones, links and nets
alike, each a `Schematic.Types.Ref`, `{ kind, key }`, and `[]` once it is
cleared — one call a change, however many entities it selects, and none for a
change that leaves the selection as it was. Its frame came with #1387: one
toolbar — the rail of its `slice`, the tools, the zoom and Fit, Find, the
steps and, where it edits, the history item — over the canvas, and the
footer, which says only what is live (below); its library pane with #1389, its
inspector with #1391, its
narrowing with #1392 and Find over every item kind's record with #1404
(below).

Its narrowing (#1392) is the one rail of its `slice`, each source narrowing
its kind wherever the kind appears: on the canvas, in the library's Backlog,
its Index and the templates the source names, in the inspector's Choosers and
what an item is joined to, and in the drawing's counts; a link or a net draws
only while its ends do. By default a row the narrowing leaves out is hidden:
its kind reads only what its narrowing holds. With `narrowed="dim"`, or
`{ show: "dim", … }`, the kind reads every row through its source, never the
narrowing, so a choice reads no row again, and a row the narrowing leaves out
draws as context — faded to `opacity` (0.35), drained of colour while
`desaturate` (on by default), a bare marker with `dot` — as do a link to one
and a net whose members on a side are all context. Context takes no tap, no
marquee, no step and no drop, and leaves every list and count but Find's.
Whatever `show` is, `emphasis` rings each match — `halo`, or `pulse`, which
breathes — `frame` boxes the matches, and `fit` flies the camera to them as
they change. Which rows match is each source's shown keys, never a predicate
over the rows, and a choice builds the Schematic no more.

Find (#1404) seeks every item kind's record by key, never what the canvas
draws, as the Sheet's Search Records seeks its record: a kind read through
its source is sought through e3 in its record's own order — a find of its keys
and a page of the rows its list shows, never the record read whole — and a
kind read whole in its rows. Its box takes a key's start, a quoted key or a
range, keys case-sensitive, and asks again as what its lines say moves — a
record, a narrowing, the layers — never as the canvas reads a window. A pick
shows the item's key in the box and its place among the matches (`3 of 7`),
and Next and Previous step on from it, each showing its match; asked again,
the box keeps a match wherever the matches still hold it. Each line reads
the item's key, its label where it is not its key, its kind's name and what
keeps it off the canvas: `hidden` (`dimmed` under `narrowed="dim"`) where the
rail's filters leave it out, `on a hidden layer`, or `no position`. A pick
flies to an item drawn as itself and selects it; to one the canvas doesn't
show as itself it flies to where it stands, selects nothing, and the footer
says why — `A07 is hidden by the filters`, with Clear filters, which clears
its kind's source's choices and selects it once it draws; `A06 has no
position: it is in the Backlog`. In a toolbar's row the box is 28px, as every
builder's key search is there.

The footer says only what is live, and nothing while nothing is (ruled 23 Oct
2026): a kind drawn as its density in place of items — a kind read by area
(#1393) past the rows a window draws — how many rows it shades in the view and
that zooming in draws them (`Density: 20,000 racks — zoom in to draw them`,
`about` that many where the view cuts a cell, `the filters not applied` under a
narrowing its area index doesn't lead); why the last gesture was refused; each
Save's notice of what left a source's narrowing; and where Find's last pick
landed off the canvas. The drawing's counts and each record's last save are the
inspector's Details', and whether changes wait on Save the history's.

The library (#1389) is the frame's start pane, 272px open, holding the tabs
`library` lists, in its order, each with its count; its open tab and whether
it is collapsed are kept per viewer under the Schematic's `id`, collapsed it
is a rail counting the backlog (else the first tab's cards), and below 560px
of frame it opens from its rail over the canvas:

- **Templates** — every kind's templates, item, link and net kinds alike, each
  card its template's name over its kind's, grouped by its kind and then its
  template's `group`. Each kind's list follows the source its templates record
  names: the tab counts what it shows (`3 of 5`) and, when the rail leaves a
  list none, says so above the rest, with Clear filters.
- **Backlog** — every item kind's rows with no position, the drafts in place,
  each card its label, its kind's name and its second line, grouped by its
  kind. A kind read through its source lists the rows its narrowing holds, and
  a narrowing that leaves none says so, with Clear filters.
- **Index** — the zones nested by containment, each counting the items it
  holds, its nested zones' among them; an open zone lists its items, then its
  nested zones, and the items in no zone come last; a hatched zone is an
  annotation, holding none. A zone's row flies to the zone, selects it and
  opens it; an item's flies to the item and selects it; the zone the viewport
  is in is marked. Its search keeps the items whose label, key or kind's name
  holds it, under their zones. The tree is one tab stop — ↑ ↓ Home End move,
  → opens a zone or goes in, ← closes it or goes up, Enter does a row's click
  — and only the rows in view are mounted.
- **Layers** — each layer in its order: its swatch in its colour token, else
  its tone, its name and how many entities it holds, with Isolate, Lock and
  Show or Hide, and Show all while a layer is hidden (the layers its author
  hides at first among them; the locks stay). The viewer's choices are kept
  under the Schematic's `id`, over the author's defaults: a hidden layer's
  entities never draw, and a locked one's never select — a tap, the marquee
  and the steps pass them by, and Find and the Index fly to them and select
  nothing — and locking a layer lets go of what is selected on it.
- **An author's tab** — its cards, each its label and its meta, grouped by its
  `group`, following the source of the rail it names (`Racks 2 of 7`).

A card tab's search finds within that tab alone, never writing the rail; a
click picks a card and a second lets it go.

The cards drop on the canvas (#1390) through the shared drag engine, as the
Flowchart's do, each drop one step of the history and the ghost's caption
saying where the card lands, or why it can't:

- **An item template** lands at the drop point: a new item, its key minted
  unique, its `x` and `y` the point's and every other field the template's
  `values`. The point is written at the screen's resolution, so the caption
  says what is written, after the zone holding it (`Cage A · 12.00, 1.00 m`).
  The item is selected.
- **A backlog row** lands at the drop point, its `x` and `y` written, and is
  selected.
- **A link or a net template** lands on a link or a net of its kind: its
  `values` over the row, never its ends, its sides or its key (`onto A03 →
  ODF-1`).
- **An author's card** — a tab whose `drop` is `(row) => Schematic.patch(R, {
  … })` — lands on an entity of the kind whose row type is `R` and sets those
  fields (`onto A03`). A tab without `drop` doesn't drag.
- **⏎ on a card** drops it on the selection — an author's card on every
  selected entity of its kind, one step — or a template or a backlog row at
  the view's centre; on a touch screen, a tap on the selected card does the
  same and leaves it selected. Refused, the footer says why.

A drop is refused — the caption red, the cursor not allowed — outside the
drawing (`Outside the drawing`), with no entity of the card's kind under it
(`Drop onto a rack`), or on a kind bound read only (`Racks are read only`); a
locked layer's entities and a hatched zone take no drop, and an item's card
covers the zones and links beneath it. The canvas marks where a card lands:
the zone holding the point tinted, a link's or a net's line washed, a ring
round the marker or the point, and a card in the brand. A drop that changes
nothing records nothing. While a link or net template is picked in the
library, Connect draws that kind's links with its values.

Every gesture is one step of one history over a session per record it writes
(#1388) — each kind bound with its patch door, and each such kind's details —
as the Roster's and the Allocation's are:

- **Move** — the tool, over an editable item kind — drags the item under the
  pointer, or the selection with it when the item is selected, by the mouse
  or a touch, every centre kept within the extent; Esc mid-drag puts it back.
- **Connect** — the tool, over an editable link kind, its menu picking the
  kind (the first, until the viewer picks) — drags from an item onto another:
  a link of that kind between them. Shift held on the next drag grows them
  into a net of the first editable net kind whose sides take their items —
  the first drag's two items one each side, an item joined from a member
  downstream, one joined into a member upstream, a member never changing side
  — which absorbs the links the drags drew; with no such kind, each drag adds
  a link. A Shift-drag from a selected link's end starts the session with
  that link.
- A selected link's **end** drags onto another item, retargeting that end;
  with Connect, a Shift-drag from a selected net's member onto an item
  **extends** the net's destinations.
- **Del** (or Backspace) deletes the selection: a link or a net; a net's leg,
  its item taken off that side, the net deleted once a side holds none; and
  items, with every link and every net leg naming one. Refused, in the
  footer's words, when a link or a net bound read only names an item it
  would delete (`A01 isn't deleted: Fibre run u1 names it, and is read only`).

`canConnect` is asked of each pair a draft would join, as a
`Schematic.Types.Candidate` — the slot of the link or net kind the gesture
writes, and its two items — and answers `none`, which allows it, or the
refusal's words; a pair whose end or side holds no item of that slot is
refused the same way (`Fibre run can't end at PDU-B`). A refused draft never
snaps: the item rings danger, the draft says why in the drag caption, and
letting go records nothing. A gesture writes only the fields its roles map —
an item's `x` and `y`, a link's ends, a net's sides — every other field of the
row as it was; a new link or net is made under a key minted unique
(`crypto.randomUUID()`), its other fields its type's default. The canvas draws
the drafts where Save would leave them; a draft of a row the rail's narrowing
leaves out waits in its session until the rail lets it back, and a new row
draws always. Undo and Redo — the history item, or ⌘Z, ⇧⌘Z and ⌘Y anywhere in
the frame but a field being typed into — step through the gestures in the
order they were made, whatever their kind; Discard drops every draft; Save
sends each record's changes as its own request through its patch door,
checked against what its drafts began from: one record's conflict or refusal
keeps its drafts under a banner titled with its kind's name, the others'
commits standing, and a write with no answer turns Save into Retry, which
resends the same request. After a Save the footer says what left each kind's
narrowing. A kind bound read only, and every
kind under `readOnly`, takes no gesture; with nothing editable there is no
history item.

The inspector (#1391), given `inspector`, is the frame's end pane, 320px open:
its tabs Details and Issues, Issues with its count; collapsed, a rail counting
the issues and naming what is selected. Whether it is collapsed, and its open
tab, are kept per viewer under the Schematic's `id`, and below 560px of frame
it opens from its rail over the canvas. Enter, or a double-click on an
entity, opens what is selected in Details. Details draws each field through
the shared form, by the input its type takes — a field the drafts changed
tinted, the head's chip Pending (New for a row its record holds none of):

- **An item** — its kind's form over the fields no role writes (the kind's
  `fields`, `Fields` hints over its row), or the kind's own `inspector` in its
  place; its details record's form, or the details' own; its position, `x`
  and `y`, with Unplace where the kind keeps a backlog; Delete; and what it is
  joined to, each link and net a control that selects it.
- **A zone** — its form.
- **A link** — its ends, each a Chooser over the items of the slots its role
  names, and its form; Delete.
- **A net** — its sides, each tags over its slot's items' keys, a side never
  emptied (Delete takes the net), and its form; Delete. **A net's leg** — the
  stub a tap selected — its item, and Remove, which takes it off its side.
- **Several** — how many of each kind, and Delete.
- **Nothing** — the drawing's counts, and each record's last save with who
  made it.

Every edit is one step of the history: a field through its record, an own
Details' `update(edited)` with the whole row, a position, the ends or the
sides through the kind's roles, and Delete as Del. Read only — a kind bound
read only, or `readOnly` — every field is printed and none edits, an own
Details giving way to the form. Issues lists the drawing's issues — an item
outside the drawing, a shape reaching past its box, a colour naming no theme
colour, a link or a net naming an item no kind holds — and its sessions': a
drafted row the kind's `ready` refuses, which holds Save, and a Save refused
or in conflict. Each issue selects what it names and flies to it.

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { DictType, East, FloatType, StringType, StructType } from '@elaraai/east';
import { Box, Reactive, UIComponentType } from '@elaraai/east-ui';
import { Data, Schematic } from '@elaraai/e3-ui';
import e3 from '@elaraai/e3';

// The app's racks: a record keyed by String — each rack's centre, box, name, model and power.
export const FloorRack = StructType({ name: StringType, x: FloatType, y: FloatType, w: FloatType, h: FloatType, model: StringType, kw: FloatType, capacity: FloatType });
export const floorRacks = e3.record("floor_racks", DictType(StringType, FloorRack), new Map([
    ["A01", { name: "A01", x: 2.4, y: 2.9, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 5.2, capacity: 8.0 }],
    ["A02", { name: "A02", x: 6.0, y: 2.9, w: 3.2, h: 1.2, model: "42U · 8 kW", kw: 7.4, capacity: 8.0 }],
]));

const floor = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const racks = $.let(Data.bind(floorRacks));   // read only, and read whole
        return (
            <Box height="440px">
                <Schematic id="floor" extent={{ width: 18, height: 12 }} scaleUnit="m"
                    items={{ racks: Schematic.items(racks, {
                        name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
                        sublabel: (r) => r.model,
                        meter: (r) => ({ value: r.kw, max: r.capacity }),
                    }) }} />
            </Box>
        );
    }}</Reactive>
));
```

A floor over several records, its racks editable and read through their
source of the rail, their loads a details record keyed as they are, edited in
the inspector, their templates a record of their own, its cooling units round by their own radius,
its fibre trunks a net kind a Shift session grows runs into, its layers a
record of systems, its tenants an author's tab whose cards set a rack's owner,
what is selected kept by the host and a run between two frames refused in the
veto's words (`schematicDataCentre`):

```tsx
// Inside Reactive: the racks through their patch door, read by key beside their source of the rail.
const racks = $.let(Record.bind(dcRacks, [dcRacksPatch]));
const rackEntries = $.let(Data.bindPaged(dcRacks));            // one rack by its key
const loads = $.let(Record.bind(dcRackLoads, [dcRackLoadsPatch]));  // the racks' loads, edited in the inspector
const loadEntries = $.let(Data.bindPaged(dcRackLoads));        // by key, beside a kind read through its source
const frames = $.let(Data.bind(dcFrames));
const cooling = $.let(Record.bind(dcCooling, [dcCoolingPatch]));
const areas = $.let(Data.bind(dcAreas));                       // read only, and read whole
const fibre = $.let(Record.bind(dcFibre, [dcFibrePatch]));
const trunks = $.let(Record.bind(dcTrunks, [dcTrunksPatch]));  // none yet: a Shift session grows one
const systems = $.let(Data.bind(dcSystems));                   // the layers: a record of the app's
const rackTemplates = $.let(Data.bind(dcRackTemplates));
const owners = $.let(Data.bind(dcOwners));                     // the tenants: an author's tab whose cards set a rack's owner
// coolingDetails: a cooling unit's own Details — East.function([DcCooling, FunctionType([DcCooling], NullType)], UIComponentType, …)
// The whole selection after each change, each entity by its kind's slot and key, kept where the app reads it.
const selected = $.let(State.bind([ArrayType(Schematic.Types.Ref)], "ops.floor.selected", []));
const onSelect = $.const(East.function([ArrayType(Schematic.Types.Ref)], NullType, ($2, refs) => { $2(selected.write(refs)); }));
// Two frames are joined by a cross-connect, never a fibre run: the veto's words refuse the pair.
const canConnect = $.const(East.function([Schematic.Types.Candidate], OptionType(StringType), ($2, candidate) => {
    const reason = $2.let(none, OptionType(StringType));
    $2.if(candidate.from.kind.equal("network").and(() => candidate.to.kind.equal("network")), ($3) => {
        $3.assign(reason, some("Two frames are joined by a cross-connect"));
    });
    return reason;
}));
// One rail: the racks by name, hall and owner, and their templates by group.
const slice = $.let(Slice.bindRecords("ops.floor", {
    racks: { source: Data.bindPaged(dcRacks, { indexes: [racksByName, racksByHall, racksByOwner] }), search: ["name", "owner"],
        fields: { name: { label: "Rack" }, hall: { label: "Hall", hints: ["Cage A"] }, owner: { label: "Owner", hints: ["Harbour Labs"] } } },
    rackTemplates: { source: Data.bindPaged(dcRackTemplates, { indexes: [rackTemplatesByGroup] }), fields: { group: { label: "Group", hints: ["Racks"] } } },
}));
<Schematic id="floor" inspector extent={{ width: 28, height: 14 }} scaleUnit="m" slice={{ slice }} narrowed="dim"
    onSelect={onSelect} canConnect={canConnect}
    items={{
        racks: Schematic.items(racks, {
            name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system", entries: rackEntries,
            details: Schematic.details(loads, {                   // what each card draws from the rack's load
                entries: loadEntries,
                meter: (l) => ({ value: l.kw, max: l.capacity }),
                status: { field: "alarm", cases: {
                    ok: { label: "OK", tone: variant("success", null), ring: false },
                    hot: { label: "Hot", tone: variant("danger", null), ring: false },
                } },
            }),
            templates: Schematic.templates(rackTemplates.read(), {  // every field of a rack but x and y
                name: (t) => t.name, group: (t) => some(t.group), values: (t) => t.values, source: "rackTemplates",
            }),
        }),
        network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system" }),
        cooling: Schematic.items(cooling, {
            name: "Cooling unit", icon: "fan", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
            footprint: (c) => some(Schematic.circle(c.radius)),    // a circle of the unit's own radius, about its centre
            inspector: coolingDetails,                             // its own Details, in place of its form
        }),
    }}
    zones={{ areas: Schematic.zones(areas, {
        name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
        pattern: (a) => a.kind.match({                             // outlined or hatched by what the area is
            room: (_$) => Schematic.outline(), cold: (_$) => Schematic.hatch({ tone: "brand" }), hot: (_$) => Schematic.hatch({ tone: "warning" }),
        }),
    }) }}
    links={{ fibre: Schematic.links(fibre, {
        name: "Fibre run", icon: "bolt", layer: "system", via: "path",   // an Array of { x, y } Floats field
        from: { field: "from", of: { rack: "racks", frame: "network" } }, to: { field: "to", of: { rack: "racks", frame: "network" } },
        label: (f) => f.label,
        style: (f) => f.cable.match({ fibre: (_$) => Schematic.solid(), logical: (_$) => Schematic.dashed() }),
    }) }}
    nets={{ trunks: Schematic.nets(trunks, {                      // racks to a frame: what a Shift session grows its runs into
        name: "Fibre trunk", icon: "diagram-project", layer: "system",
        sources: { field: "racks", of: "racks" }, destinations: { field: "frames", of: "network" },   // Array<String> fields of keys
        label: (t) => t.label,
    }) }}
    layers={Schematic.layers(systems.read(), {                    // a layer per system, an entity's `layer` naming it by key
        label: (s) => s.label, color: (s) => some(s.colour), order: (s) => s.order, locked: (s) => s.fixed, opacity: (s) => s.dim,
    })}
    library={[Schematic.library.templates(), Schematic.library.backlog(), Schematic.library.index(), Schematic.library.layers(),
        Schematic.library.tab(owners.read(), {                     // a card dropped on a rack sets its owner
            name: "Owners", icon: "building", label: (o) => o.name, meta: (o) => some(o.contact),
            drop: (o) => Schematic.patch(DcRack, { owner: o.name }),
        })]} />
```

```
<Schematic extent={{ width, height }} items={{ <slot>: Schematic.items(record, { … }) }} /> — the 2D world-coordinate drawing of the app's own records: a kind per record, under its slot
├─ Props:
│   ├─ extent (required) — the drawing's world bounds, { width, height }, each a positive number of world units; the canvas fits them
│   ├─ items (required) — the item kinds, by slot, one at least: Schematic.items(record, { name, icon, x, y, label, width?, height?, footprint?, layer?, sublabel?, metric?, meter?, status?, tone?, color?, weight?, fillOpacity?, details?, templates?, entries?, fields?, inspector?, ready? }) — `x` and `y` Float fields, the item's centre, or both Options of Float: a row with neither has no position, the kind's backlog, drawn nowhere; `width` and `height` Float fields, its box about its centre; `footprint` an accessor `(row, key) => Option<Schematic.Types.Geometry>` built from the row's own fields with Schematic.circle / polygon / polyline / rect, drawn about its centre, refused without the box or naming a field; `label` a String field, or an accessor; `icon` a Font Awesome solid icon, or an accessor; `layer` a String field naming a layer by its record's key; `status: { field, cases }` a variant field, a Status per case; `fields` the inspector form's hints over the fields no role writes (`Fields`); `inspector` the kind's own Details, fn(R, fn(R) => Null) => UIComponentType, in place of its form; `ready` the app's check of a drafted row, fn(R, String) => Editing.Types.Readiness, its refusal listed in Issues and holding Save — each typed over the kind's own row; the rest accessors `(row, key) => …`
│   ├─ zones (optional) — the zone kinds, by slot: Schematic.zones(record, { name, icon, x, y, width, height, label, pattern?, geometry?, layer?, tone?, color?, fillOpacity?, weight?, details?, entries?, fields?, inspector?, ready? }) — `x`, `y`, `width` and `height` the Float fields of its box, its top-left corner and its size; `pattern` an accessor, outline (the default) or hatch — a hatched zone is an annotation, holding no items and taking no tap; `geometry` an accessor `(row, key) => Option<Schematic.Types.Geometry>` built from the row's own fields, drawn about its box's centre, refused naming a field. A zone takes no templates and no gesture on the canvas
│   ├─ links (optional) — the link kinds, by slot: Schematic.links(record, { name, icon, from: { field, of }, to: { field, of }, via?, label?, metric?, style?, route?, layer?, details?, templates?, entries?, fields?, inspector?, ready? }) — an end is a String field holding a key of the item slot `of` names, or a variant of String cases with an item slot per case (`of: { rack: "racks", frame: "network" }`) — never an Option: a link has both its ends; `via` an `Array` of `{ x, y }` Floats field, its waypoints
│   ├─ nets (optional) — the net kinds, by slot: Schematic.nets(record, { name, icon, sources: { field, of }, destinations: { field, of }, via?, label?, metric?, style?, route?, layer?, details?, templates?, … }) — each side a `Set<String>` or `Array<String>` field of keys of the item slot `of` names; drawn as a bus — a header bar over each side of many members, a stub per member, the trunk between them, a dot only where a tap joins a bar
│   ├─ scaleUnit (optional) — the scale bar's unit
│   ├─ slice (optional) — slice={{ slice: Slice.bindRecords(key, { <a kind's slot>?, <a templates list's or a tab's source>? }, { presets? }), affordances?, persist? }}: ONE rail, each source named after what it narrows — a kind's slot, that kind, read complete through it; a templates list's or a tab's, its cards. The brush is refused: a 2D canvas has no axis
│   ├─ narrowed (optional) — how a row the narrowing leaves out draws: "hide" (the default — its kind reads only what its narrowing holds), "dim" (its kind reads every row; what the narrowing leaves out draws as context), or { show, opacity? (0.35), desaturate? (on), dot?, emphasis?: "halo" | "pulse", frame?, fit? } — `emphasis`, `frame` and `fit` take the matches whatever `show` is
│   ├─ layers (optional) — Schematic.layers(rows, { label, order?, tone?, color?, visible?, locked?, opacity? }): the app's own rows, a `Dict` keyed by String (a record's `read()`), each row a layer under its key, through accessors `(row, key) => …` as the Roster's lists are — in their `order`, lowest first, then key order; `color` an Option of a theme colour token over `tone`; `visible`, `locked` and `opacity` the author's defaults, which the viewer's choices in the Layers tab override. An entity's `layer` field names one by its key; a locked layer's entities never select, a hidden one's never draw
│   ├─ library (optional) — the library pane's tabs, in order, each over every kind as the Calendar's are: Schematic.library.templates() (every kind's templates, each kind's under its name) · backlog() (every item kind's rows with no position, each kind's under its name) · index() (the zones, with zone kinds) · layers() (with layers) · tab(rows, { name, icon?, label, meta?, group?, drop?, source? }) (`drop` a `Schematic.patch(R, …)` over one kind's row type: the fields a card dropped on an entity of that kind sets); each listed once
│   ├─ inspector (optional) — `inspector` (true) shows the end pane, 320px: Details of what is selected and Issues (below); left out, or `false`, no pane, as the Plan's. A kind's own Details is its kind's `inspector`, its details' their own `inspector`
│   ├─ readOnly / grid / minimap / id (optional) — every kind read only, taking no gesture; the metric grid (on); the minimap (from 25 items); `id` keeps the Schematic's panes, layers and tools apart when one surface holds two, as the Plan's does
│   ├─ canConnect (optional) — fn(Schematic.Types.Candidate) => Option<String>: asked of each pair a connect drag would join — `{ kind, from, to }`, the slot of the link or net kind it writes and its two items, each a `Schematic.Types.Ref` — before the draft snaps; `none` allows it, and words refuse it — the draft says them in its caption, and letting go records nothing; a veto that throws allows the pair and logs it
│   └─ onSelect (optional) — fn(Array<Schematic.Types.Ref>) => Null: the whole selection after each change — items, zones, links and nets alike, each { kind: its slot, key: its row's key }, `[]` once cleared — one call a change, none for a change that leaves it as it was
├─ Editing (#1388) — every gesture ONE step of one history over a session per record it writes, each kind bound with its patch door and each such kind's details: Move (the tool, over an editable item kind) drags the item under the pointer, or the selection with it, every centre kept within the extent, Esc mid-drag putting it back; Connect (the tool, over an editable link kind, its menu picking the kind) drags from an item onto another, a link of that kind, and Shift held on the next drag grows the drags into a net of the first editable net kind whose sides take their items, absorbing their links (with none, each drag adds a link); a selected link's end drags onto another item; with Connect, a Shift-drag from a selected net's member extends its destinations; Del or Backspace deletes the selection — a link, a net, a net's leg, items with every link and net leg naming one — refused in the footer's words where a link or a net bound read only names an item it would delete. An end or a side holding no item of a slot refuses the pair as `canConnect` does (`Fibre run can't end at PDU-B`). A gesture writes only the fields its roles map; a new link's or net's key is minted unique (`crypto.randomUUID()`), its other fields their type's defaults. The canvas draws the drafts where Save would leave them; a draft of a row the narrowing leaves out waits in its session, and a new row draws always. The history item ends the toolbar — Undo, Redo, Discard and Save, and ⌘Z, ⇧⌘Z and ⌘Y anywhere in the frame but a field being typed into; Save sends each record's changes as its own request through its patch door, one record's conflict or refusal kept under a banner titled with its kind's name while the others' commits stand, a write with no answer turning Save into Retry, the same request. After a Save the footer says what left each kind's narrowing
├─ Drops (#1390) — each card dropped on the canvas ONE step of the history, the ghost's caption saying where it lands or why it can't: an item template adds an item at the point (its key minted, its `x` and `y` the point's at the screen's resolution, every other field the template's `values`), selected; a backlog row is placed at the point, selected; a link or net template gives a link or a net of its kind its `values`, never its ends, sides or key; an author's card sets its `drop`'s `Schematic.patch` on an entity of that patch's kind. ⏎ on a card — on a touch screen a tap on the selected card — drops it on the selection (an author's card on every selected entity of its kind) or a template or backlog row at the view's centre, refused in the footer's words. Refused outside the drawing, with no entity of the card's kind under it, or on a kind bound read only; a locked layer's entities and a hatched zone take none, and an item's card covers the zones and links beneath it. A picked link or net template gives Connect its values
├─ Inspector (#1391) — the end pane, its tabs Details and Issues (Issues with its count), opened on Details by Enter or a double-click on an entity: Details through the shared form, each field by the input its type takes, a field the drafts changed tinted and the head's chip Pending (New for a row its record holds none of) — an item's kind's form over the fields no role writes, or the kind's own `inspector`, its details' form or own Details, its position (`x`, `y`) and Unplace (a kind with a backlog), Delete, and what it is joined to, each selecting it; a zone's form; a link's ends as Choosers over the items of their slots, its form, Delete; a net's sides as tags over its slot's keys (a side never emptied: Delete takes the net), its form, Delete; a net's leg, its item and Remove; several, how many of each kind, and Delete; nothing, the drawing's counts and each record's last save with who made it — each edit ONE step of the history; read only, every field printed. Issues: an item outside the drawing, a shape past its box, a colour naming no theme colour, a link or net naming an item no kind holds, a drafted row `ready` refuses (holding Save), a Save refused or in conflict — each selecting what it names
├─ Narrowing (#1392) — each source of the rail narrows its kind on the canvas, in the Backlog, the Index and the templates it names, in the inspector's Choosers and what an item is joined to, and in the drawing's counts; a link or a net draws only while its ends do. Hidden by default; dimmed, its kind reads every row and draws what the narrowing leaves out as context — faded, greyed or a bare marker, a link to it and a net all of whose members on a side are it among it — which selects by no path and counts nowhere. A match — a row its source's shown keys hold — wears `emphasis` (a ring on its card or marker, an edge on a zone, a halo under a link's or a net's line), `frame` boxes two or more, and `fit` flies the camera to them as they change. A draft the narrowing leaves out waits in its session, hidden, or draws where its draft has it, dimmed; Save sends it either way
└─ Factories:
    ├─ Schematic.items / zones / links / nets(record, config) — the kinds · Schematic.details(record, { status?, meter?, metric?, sublabel?, fields?, inspector?, entries? }) — a kind's details · Schematic.templates(rows, { name, group?, icon?, values, source }) — a kind's templates record, `values` every field but what a drop places · Schematic.layers(rows, config) — the layers
    ├─ Schematic.circle(r) / .polyline(verts, { width? }) / .polygon(verts) / .rect() — geometry about the entity's anchor, each vertex an offset from it: the row's own points, `{ x, y }` (no bulge) or `{ x, y, bulge }`; a radius and a width a Float of the row's
    ├─ Schematic.outline() / .hatch() — zone patterns · Schematic.solid() / .dashed() — link and net styles
    └─ Schematic.patch(R, { … }) — a patch over a kind's row type, what an author's card dropped on an entity sets · Schematic.Types.* — the value types the accessors return, and what the host hears (Ref, Candidate)
```

| Signature | Description | Example |
| --- | --- | --- |
| `items={{ racks: Schematic.items(Data.bind(racks), { name, icon, x, y, width?, height?, label, … }) }}` **❗** | An item kind over the app's record, read only and read whole; its card's second line and bar from accessors. A role naming a field the row lacks, or one of another type, is refused, naming the role, the field and its type. | `schematicFloor` |
| `Schematic.items(Record.bind(r, [patch]), { …, entries: Data.bindPaged(r) })` + a source of `slice` named after its slot **❗** | Editable, read complete through its source. `Data.bind` there, or a `Record.bind` without `entries`, is refused, naming the binding to use. | `schematicDataCentre` |
| `x` / `y` Options of Float | The rows with no position are the kind's backlog: drawn nowhere, and listed by `Schematic.library.backlog()`. | `schematicDataCentre` |
| `slice={{ slice: Slice.bindRecords(key, { racks: { source: Data.bindPaged(racks, { indexes }) }, … }) }}` · `narrowed="dim"` **❗** | One rail (#1392): each source narrows its kind everywhere it appears — the canvas, the Backlog, the Index, the templates it names, the inspector's Choosers and the drawing's counts — a link or a net only while its ends draw. Hidden by default, the kind reading only its narrowing; `dim` reads every row and draws what the narrowing leaves out as context, faded and greyed, never selected. `emphasis`, `frame` and `fit` take the matches whatever `show` is. | `schematicDataCentre` |
| `footprint: (u) => some(Schematic.circle(u.radius))` + `width` / `height`; `Schematic.polygon` / `.circle` / `.polyline` **❗** | An accessor over the row's own fields, returning an `Option<Schematic.Types.Geometry>`: geometry about the item's centre, or a zone's `geometry` about its box's centre, each vertex an offset from it — the row's own `{ x, y }` points, or `{ x, y, bulge }`. A footprint without the box, and a shape role naming a field, are refused, naming the accessor to write. | `schematicShapes`, `schematicDataCentre` |
| `zones={{ areas: Schematic.zones(…, { x, y, width, height, label, pattern?, geometry? }) }}`, `pattern: (a) => a.kind.match({ … })`, `Schematic.outline()` / `.hatch()` | Zones in their boxes under the items, outlined or hatched by what the row says it is. | `schematicShapes`, `schematicDataCentre` |
| `links={{ fibre: Schematic.links(…, { from: { field, of }, to: { field, of }, via? }) }}`, `Schematic.solid()` / `.dashed()` | Links between items, routed orthogonally, two of one pair fanning into lanes, in the shared links look: each from its `from` item's edge to its `to` item's, its head there, in the links' muted ink or its style's tone; an end of a variant field takes its slot from its case. | `schematicDataCentre` |
| `nets={{ feeds: Schematic.nets(…, { sources: { field, of }, destinations: { field, of } }) }}` | A bus joining many items to many. | `schematicDataCentre` |
| a kind bound with its patch door — `Record.bind(record, [e3.mutation.patch(record)])` **❗** | Every gesture one step of one history over a session per record (#1388): Move, Connect, Shift growing a net of the first editable net kind that takes its items, an end retargeted, a net extended, Del; Undo, Redo and Discard; Save sending each record's changes through its patch door, one refused leaving the others' commits standing. A gesture writes only the fields its roles map, a new row under a minted key. | `schematicDataCentre` |
| `details: Schematic.details(record, { status?, meter?, metric?, sublabel?, fields?, inspector?, entries? })` **❗** | A record keyed as its kind is, its roles drawn on the cards; a role given by the kind too is refused. Bound with its patch door — `entries` beside it where the kind is read through its source — the inspector edits it beside the kind's row. | `schematicDataCentre` |
| `templates: Schematic.templates(rows, { name, group?, values, source })` **❗** | A templates record, its `source` one of the slice's; `values` gives every field but what a drop places — an item's `x` and `y`, a link's ends, a net's sides. A list written in the code is refused. | `schematicDataCentre` |
| `library={[Schematic.library.templates(), .backlog(), .index(), .layers(), .tab(rows, {…})]}` **❗** | The library pane's tabs, each over every kind as the Calendar's are, each checked against the kinds: Templates and Backlog are refused when no kind has any, naming the change. The frame's start pane draws them, each with its count, each card tab following its source of the rail (#1389). | `schematicDataCentre` |
| the Layers tab's Isolate, Lock, Show or Hide and Show all | The viewer's layer choices, kept under the Schematic's `id` over the author's defaults: a hidden layer's entities never draw, a locked one's never select. | `schematicDataCentre` |
| a template's or a backlog row's card dropped on the canvas **❗** | One step (#1390): an item template adds an item at the point, its key minted, selected; a backlog row is placed there, selected; a link or net template gives a link or a net of its kind its values, never its ends, sides or key. The caption says where (`Cage A · 12.00, 1.00 m`, `onto A03 → ODF-1`), or why not (`Outside the drawing`, `Drop onto a fibre run`, `Racks are read only`). | `schematicDataCentre` |
| `Schematic.library.tab(owners.read(), { name, label, meta?, drop: (o) => Schematic.patch(DcRack, { owner: o.name }) })` **❗** | An author's card dropped on an entity of the patch's kind sets those fields, one step; ⏎ — on a touch screen a tap on the selected card — sets them on every selected entity of that kind. A tab without `drop` doesn't drag. | `schematicDataCentre` |
| `layers={Schematic.layers(rows, { label, order?, tone?, color?, visible?, locked?, opacity? })}` **❗** | The layers, the app's own rows in their `order`, then key order, each keyed by its row's key; an accessor of another type, and a list written in the code, are refused, naming them. | `schematicShapes`, `schematicDataCentre` |
| `color` / `tone` / `fillOpacity` / `weight` | Colour overrides on an item's footprint, a zone and a layer — a theme colour token or a tone. | `schematicShapes` |
| `inspector` · a kind's `fields`, `ready` and own `inspector` **❗** | The inspector pane, opted into as the Plan's is (#1391): Details — an item's form and its details', its position and Unplace, what it is joined to; a zone's form; a link's ends as Choosers; a net's sides as tags, a leg's Remove; several and Delete; with nothing selected the drawing's counts and saves — each edit one step; and Issues, each selecting what it names. `fields` hints a kind's form, `ready` checks a drafted row, and a kind's own `inspector` is its Details in place of its form. `inspector={{ <slot>: … }}` is refused, naming the kind's `inspector`. | `schematicDataCentre` |
| `onSelect={fn(Array<Schematic.Types.Ref>) => Null}` | The whole selection after each change, items, zones, links and nets alike, each `{ kind, key }`; `[]` once cleared. | `schematicDataCentre` |
| `canConnect={fn(Schematic.Types.Candidate) => Option<String>}` | A connect drag's candidate, `{ kind, from, to }`: `none` lets it snap, and words refuse it — the draft says them in its caption, and letting go records nothing; a veto that throws allows the pair. | `schematicDataCentre` |
| `id="floor"` | Keeps the Schematic's panes, layers and tools apart when one surface holds two. | every example |

Removed with #1401, each still written refused at build, naming its
replacement: `name` (`id`); `inspector={{ <slot>: Details }}` (the kind's own
`inspector`); `Schematic.library.templates(slot)` and `unplaced(slot)`
(`templates()` and `backlog()`, over every kind); `onSelectionChange`,
`onZoneSelectionChange` and `onSelectLink` (`onSelect`, the whole selection);
`onViewportChange` (the canvas reads its own window); `onItemOpen` (Enter or a
double-click opens the selection in the inspector's Details); `selectZoomFocus`
(a tap selects in place; Find, the Index tab and the arrow keys fly); a
`layers` list written in the code (`Schematic.layers` over the app's rows);
and a `footprint` or a `geometry` naming a field that holds
`Schematic.Types.Geometry` (an accessor over the row's own fields). The
selection, zone selection and viewport event types are gone, and
`canConnect` hears a `Schematic.Types.Candidate` where it heard two
references.

Removed with #1386, each still written refused at build, naming its
replacement: rows and their mappers — `items` as rows with `item`, and `zone`,
`link` and `net` — (kinds over the app's records, by slot); `onMoveItem`,
`onCreateLink`, `onEditLink`, `onDeleteLink` and `onEditNet` (the editing
session's gestures: bind a kind with its patch door to edit it); `linkMode`;
`readOnlyLinks` and `readOnlyItems` (a kind bound read only); the hover cards
`itemHover`, `zoneHover` and `linkHover` (the inspector); `affordances`
outside `slice`; the slice's effect props `sliceHidden`, `sliceOpacity`,
`sliceDesaturate`, `sliceDot`, `sliceEmphasis`, `sliceFrame` and
`sliceFrameFit` (`narrowed`); `sliceSelectField`; `selectionMode` (a tap
selects, Shift extends it, and the marquee boxes); `navigator` (the library's
Index tab); `height` and `maxHeight` (the Schematic fills the box it is given);
and `onSelectZone` (`onSelect`, over the whole selection since #1401). A prop
the Schematic doesn't take is refused, naming those it does.

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
- `plan/plan.examples.tsx` — `planTargetState` combines all row kinds,
  nesting, links, bound UI state, the series library, one rail whose
  deliveries source narrows its Deliveries tab and holds the window, and a
  narrow layout; `planMeasures` combines charts, heat, tables and resolution
  folds, its weeks source holding the window; `planRowDrop` edits nested
  record entries through one session; `planVariants`, `planNumberAxis` (its
  orders source on the integer arm), `planOrdinalAxis` and `slicePlanChrome`
  (the `rows` source of its rail) retain their distinct axis, configuration
  and Slice examples.
- `plan/plan-events.examples.tsx` — `planEvents` is the smallest builder,
  with a bound backlog, a customer-card tab and an Unassigned row.
  `planPrintWorks` covers grouped presses and crews, nested bindery resources,
  jobs, stops, shifts and plates, deliveries assigned to a bay or van, lanes,
  status, readiness, overlap rules, linked events, measures and stock, under
  one rail — the jobs and the shifts through their interval indexes, their
  range the one window, the presses, the customers and each kind's templates
  record. Its library and inspector use the shared frame and Save session.
  `planEventLinks` keeps the individual link-routing cases.
- `plan/plan-windows.examples.tsx` — `<Plan>` over records too large to read
  whole (`planWindows`): 2,000 presses a task generates, paged as the canvas
  scrolls, and the jobs narrowed through the rail's `job` source over their
  interval index — the window and the backlog — and read by key through their
  own entries, edited and saved without the record read whole; and the same
  Plan reading its jobs a cell at a time through their series index, shaded
  from their summary zoomed out (`planSeries`).
- `plan/plan-records.examples.tsx` — the Sheet's 50,000 work orders on a Plan
  (`planRecordIndexes`, `planRecordIndexesMobile`): the `rows` source of its
  one rail gives the canvas its rows, paged from it, its Due range the window,
  each move saved through `Record.onApply` by the order's key.
- `sheet/sheet.examples.tsx` — `<Sheet>`, each in its frame, its rows bound
  from e3: the smallest sheet over a record; the configurator over the host's
  rows, committed through `onApply`; two thousand jobs of a record, read only,
  the narrowing its rail makes through the record's indexes drawn over them as
  the lens, with saved views; a library of the author's own cards; the workshop's orders, the flagship
  (groups, the driver and registers, the link grammar, the copilot's fills and
  proposers, readiness, one rail over the orders and two templates records,
  the library, the inspector and views); one week's rows with every column
  kind and its rules, a journal and the author's own inspector; one day's
  batches dragged and moved, with sub rows and templates records; loose rows
  between work packages; and a record read a window at a time. Between them,
  every pane combination: none, a library, an inspector, and both. A sheet
  paged from a dataset is `data.examples.tsx`'s, and one over a record's own
  entries through `Record.onApply` `record.examples.tsx`'s `recordSheetApply`.
- `sheet/sheet-records.examples.tsx` — the lens over 50,000 work orders
  (`sheetRecordIndexes`, `sheetRecordIndexesMobile`): the `rows` source of the
  sheet's rail narrows them through the record's indexes, and the sheet draws
  the narrowing over the record's rows, read a segment at a time near the view,
  each Save through `Record.onApply` by the order's key.
- `sheet/sheet-link.examples.ts` — the link grammar: `Sheet.link.parse` and
  `Sheet.link.print`.
- `sheet/sheet-transactions.examples.ts` — `Sheet.apply` over rows, and over
  entries of groups and loose rows.
- `flowchart/flowchart.examples.tsx` — `<Flowchart>`, each in its frame, in
  a box of its own height, its flows bound from e3: a record of the depot's
  flows by name, its value from `Flowchart.values`, with its Flows tab
  (`flowchartFlows`); the configurator — the legend, the minimap and read only
  over the host's flows, Save committed by the host's `onApply` through the
  record's patch mutation, and what is selected heard in its aside
  (`flowchartVariants`); the depot's flows with the library — the Flows tab,
  step and transition templates from templates records, and the author's own
  cards from a record of roles, the rail narrowing each through the source it
  names, each card dropped on the canvas (`flowchartLibrary`); a flow from the
  host's tables, each an input — decision triggers, evidence, a ×14 state
  class, an in-place loop, an unresolved ghost and its inspector, read only,
  nothing narrowing it (`flowchartDepot`); a record of 2,048 flows, its rail's `flows` source
  narrowing the Flows tab, which counts it and searches it by name
  (`flowchartRecordIndexes`); one flow of the host's, an input's value from
  `Flowchart.value`, top down with no pane (`flowchartHandover`); and a
  record's one flow edited on the canvas — every gesture a draft, Save one
  commit, a `canConnect` veto — with a state's and a transition's own Details
  (`flowchartDetail`). Between them, every pane combination: none, a library,
  an inspector, and both.
- `schematic/schematic.examples.tsx` — `<Schematic>` over the app's records:
  one hall's racks, read only and read whole, each card's second line and
  power meter from its row (`schematicFloor`); footprints and zone shapes
  built by accessors from the rows' own fields and drawn about their anchors
  — a unit's outline corners and a tower's radius about each unit's centre,
  a hall's corners and a duct bank's arcing band about each area's box centre
  — with theme colour tokens, tones and layers from a systems record
  (`schematicShapes`); and a data centre floor over several records — racks
  editable and read through their source of the rail, their loads as details
  on each card, edited in the inspector, network frames, round cooling units with their own Details,
  power distribution units, halls, cages and aisles outlined or hatched by
  what they are, fibre runs between racks and frames, solid or dashed by
  their cable, a run between two frames refused in the veto's words, power
  feeds and fibre trunks as nets — no trunk until a Shift session grows one —
  every gesture a step of one history and Save per record, rack and fibre
  templates records, the racks with no position, the whole selection kept by
  the host, the inspector, and the library's tabs over every kind
  (`schematicDataCentre`).
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

## Calendar — a schedule over bound records

Import `Calendar` from `@elaraai/e3-ui`. Its renderer is in
`@elaraai/e3-ui-components`; BuilderFrame is internal. The former east-ui
heatmap Calendar and its `scale`/`totals`/`footer` helpers have been removed.

Bind each event record with its patch mutation inside `Reactive`, then give
`Calendar.events` the names of its title, start, end and resource fields.
Bind what the Calendar reads whole — its resource records and its templates
records — with `Data.bind`, which keeps them loaded beside its pages.
`Calendar.resources` and `Calendar.templates` read their dictionaries, so
record updates change the labels and available templates reactively. Backlog
rows belong to the event record: optional start/end fields with no schedule,
plus `backlog` duration and due-date accessors. Scheduling and returning to
backlog update that same row; they never copy it into another record.

Its `slice` is one `Slice.bindRecords` (#1343), a source named after each
event kind's slot, each resource kind's slot, and each templates record or tab
that names one. An event kind's source reads its record through an interval
index, with `range: "start"`, and the kind gives `entries`, the record's own
entries, beside it:

```tsx
// Package side: jobsByTime = e3.recordIndex.interval("jobs_by_time", jobs, { from: "start", to: "end" }),
// jobsByStatusTime the same `on: ["status"]`, machinesByArea `on: ["area"]`, jobTemplatesByGroup `on: ["group"]`.
// Inside Reactive: jobs has optional start/end and a machine reference.
const machines = $.let(Data.bind(d.machines));
const templates = $.let(Data.bind(d.jobTemplates));
const jobs = $.let(Record.bind(d.jobs, [d.jobsPatch]));
const jobIndex = $.let(Data.bindPaged(d.jobs, { indexes: [d.jobsByTime, d.jobsByStatusTime] }));
const jobEntries = $.let(Data.bindPaged(d.jobs));
const machineIndex = $.let(Data.bindPaged(d.machines, { indexes: [d.machinesByArea] }));
const templateIndex = $.let(Data.bindPaged(d.jobTemplates, { indexes: [d.jobTemplatesByGroup] }));
// One rail, a source per record, each named after what it narrows.
const slice = $.let(Slice.bindRecords("ops.calendar", {
    job: { source: jobIndex, fields: { status: { label: "Status" }, start: { label: "Dates" } }, range: "start" },
    machines: { source: machineIndex, fields: { area: { label: "Area" } } },
    jobTemplates: { source: templateIndex, fields: { group: { label: "Template" } } },
}));
return <Calendar slice={{ slice }}
    resources={{ machines: Calendar.resources(machines.read(), {
        name: "Machines", icon: "gears", label: machine => machine.name,
    }) }}
    events={{ job: Calendar.events(jobs, {
        name: "Job", icon: "industry", title: "title", start: "start", end: "end",
        resource: { field: "machine", of: "machines" }, entries: jobEntries,
        backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
        templates: Calendar.templates(templates.read(), {
            name: row => row.name, group: row => some(row.group),
            duration: row => variant("hours", row.hours), values: row => row.values,
            source: "jobTemplates",
        }),
    }) }}
    library={[Calendar.library.templates(), Calendar.library.backlog()]}
    inspector />;
```

The runnable examples `calendarQuickstart`, `calendarOperations`,
`calendarMinimal`, `calendarMobile`, `calendarWindowed`, `calendarReadOnly`,
`calendarCustomInspector`, `calendarRecordIndexes` and
`calendarRecordIndexesMobile` include their record declarations and seeds.
Search those names in the example index. Their bindings become the UI task's
read/write manifest.

| Signature | Description | Example |
| --- | --- | --- |
| `<Calendar events resources? slice? library? inspector? view? hours? week? density? now? readOnly? canDrop? onSelect? id? />` **❗** | One shared frame: a toolbar with the time navigator, the rail over its `Slice.bindRecords` and its summary, and the history; the schedule; the shared footer rail. Calendar day/week/month, Resources day, Timeline day/week/month. Panes are optional. Empty event maps, invalid working hours and duplicate library tab names are refused. | `calendarOperations`, `calendarMinimal` |
| `Calendar.events(record, config)` **❗** | `Schedule.events`: span fields, resource references, status cases, shared `field` editors, `ready`, custom `inspector`, overlap policy and record patch writes. Narrowed through its source of `slice`, named after its slot, it gives `entries: Data.bindPaged(record)` beside it for its original-key reads. A kind's own `slice` or `filter`, and `window` / `backlogWindow` beside a source, are refused, naming the change. Whole-row edits use one EditSession per kind and one shared EditHistory. | `calendarOperations` |
| `slice={{ slice: Slice.bindRecords(key, { [kind]: { source, fields, range: "start" }, [resources]: …, [templates]: … }), affordances?, persist? }}` **❗** | One rail, a source per record (#1343). An event kind's reads its events in the window and its backlog through an interval index, as one, so a draft moves an event between them by its times alone. A resource kind's narrows its columns, the timeline's rows and the resource Choosers, which keep a placement's own resource and the resources an event's fields name. A templates list's and an app tab's narrow their cards. One date window: the first event source with a range leads, its range the time navigator's Range panel, never a chip of the rail, and navigation writes the window into every event source. Overlaps, checks and commands read every event and every resource. `Slice.bind`, a single `Slice.bindRecord` and a source nothing names are refused. | `calendarOperations`, `calendarRecordIndexes` |
| `Calendar.resources(rows, config)` | `Schedule.resources` over a dictionary, usually a record bound with `Data.bind`; the Calendar reads resource kinds whole, and refuses a paged read. | `calendarOperations` |
| `Calendar.templates(rows, { name, group?, at?, duration, values, source })` **❗** | A templates record, bound with `Data.bind`, its `source` the rail's source over it, whose shown keys filter the Templates tab; typed `values` supplies exactly the event fields other than its scheduling roles. A list written in the code, one naming no source of the slice, and templates on a Calendar with no slice are refused, naming the change. Template changes do not rewrite existing event rows. | `calendarOperations` |
| `Calendar.library.templates()` / `.backlog()` / `.tab(rows, { …, source? })` **❗** | Shared Library cards and search, each tab following its sources: it counts what it shows (`5 of 6`) and, when the rail leaves it none, says so with Clear filters for them. The Backlog counts `N of M`, what its kinds' narrowing shows beside the stored events their choices hide; its Clear filters keeps each window. An author's tab names the source it follows (`source`) and may apply `Calendar.patch(RowType, fields)` to a compatible selected event. Invalid or ambiguous patch row types, and a `source` the slice lacks, are refused. | `calendarOperations` |
| the summary and the footer | The rail's summary names each source a narrowing hides rows of, in its own words (`6 of 10 production events`), and folded, the Filters popover heads each source's fields with its count (`4`, `6 of 10`, #1358); the window's own event count shows only with no slice. After a Save, a notice per event kind says, in its words, what left its narrowing. | `calendarOperations` |
| `Calendar.days(start, end)` / `.unscheduled(start, due)` | UTC half-open day keys and the unscheduled index key, for a kind with no source of `slice`: supply paged `window`, `backlogWindow` when applicable, and `entries` for selection and draft baselines by key. | `calendarWindowed` |
| `readOnly` | Same layouts, filters, selection and overlaps, without sessions, mutation actions or editing callbacks. | `calendarReadOnly` |
| Narrow layout | Below 480px of main-panel width, chronological agenda cards replace the grid. Create, Schedule, Move, Resize, Duplicate, Delete, Return to backlog and author-card actions use shared anchored forms and the same commands as desktop gestures. No dragging. Desktop view, date, filters, selection and drafts survive resizing. | `calendarMobile` |

`canDrop` refuses a proposed placement before it becomes a draft. `ready`
validates the resulting row and may block Save. Unknown commit outcomes,
conflicts, Undo/Redo/Discard and draft restoration use the shared editing
contract. Date/time fields are UTC. A narrowed kind keeps its drafts by
original key: an edit the rail hides still saves, and a draft its narrowing
does not hold shows in neither the window nor the backlog. A source's counts
are exact counts of original records; a kind read through a day index
(`window`) counts the window it has loaded.


## Roster — weekly staffing over the app's own records

Import `Roster` from `@elaraai/e3-ui`; the renderer is in e3-ui-components.
One `<Roster>` owns its internal BuilderFrame. It stores nothing in a shape of
its own (#1365): it writes the app's duties through the duty kind's roles
(`Schedule.events`), reads its people and agencies (`Schedule.resources`),
publishes its weeks (`Schedule.periods`) and writes its cover targets
(`Roster.targets`), each the app's own record bound with its patch mutation;
its shifts, groups, positions, activities and proposals are read from the
app's rows through accessors. What the Roster reads whole binds with
`Data.bind`. Coverage, pay, checks and fits read every duty of the week, every
person and every activity, whatever the rail shows.

The smallest roster — duties with their times, shift and team; staff; shift
times; teams:

```tsx
// Module level: the app's own duties; its workers (name, team), shift times (name, code, starts, hours, order) and teams likewise.
export const Duty = StructType({ person: StringType, start: DateTimeType, end: DateTimeType, shift: StringType, team: StringType });
export const duties = e3.record("duties", DictType(StringType, Duty), new Map());
export const dutiesPatch = e3.mutation.patch(duties);
// Inside Reactive:
const rota = $.let(Record.bind(duties, [dutiesPatch]));
const staff = $.let(Data.bind(workers));
const times = $.let(Data.bind(shiftTimes));
const groups = $.let(Data.bind(teams));
return <Roster
    events={{ duty: Schedule.events(rota, {
        name: "Duty", icon: "user-clock",
        start: "start", end: "end", resource: { field: "person", of: "people" },
        shift: "shift", group: "team",
    }) }}
    resources={{ people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: w => w.name, group: w => w.team }) }}
    shifts={Roster.shifts(times.read(), { label: s => s.name, code: s => s.code, start: s => s.starts, hours: s => s.hours, order: s => s.order })}
    groups={Roster.groups(groups.read(), { label: t => t.name })} />;
```

The warehouse's roster over its own records — its duties, the weeks of its
rota, its cover targets and suggestions, staff and an agency — with its pay,
its check, Publish, one rail and its fit (`rosterWarehouse`):

```tsx
// Module level: the warehouse's duty, WarehouseDuty — who (a staff key, or an agency's), start, end, shift, team, role, task,
// unpaidBreak, agreed, costCentre and note — and its records: rosterDuties (with rosterDutiesByTime), rosterWeeks, rosterCover, ….
// Inside Reactive: what the Roster writes, each through its patch door.
const rota = $.let(Record.bind(rosterDuties, [rosterDutiesPatch]));
const entries = $.let(Data.bindPaged(rosterDuties));                                     // one duty by its key
const byTime = $.let(Data.bindPaged(rosterDuties, { indexes: [rosterDutiesByTime] }));   // e3.recordIndex.interval(…, { from: "start", to: "end" })
const weeks = $.let(Record.bind(rosterWeeks, [rosterWeeksPatch]));
const cover = $.let(Record.bind(rosterCover, [rosterCoverPatch]));
// What it reads whole — every person and activity is the calculation scope — and their indexes for the rail.
const people = $.let(Data.bind(rosterStaff));
const acts = $.let(Data.bind(rosterActivities));
const staffIndex = $.let(Data.bindPaged(rosterStaff, { indexes: [rosterStaffByTeamName, rosterStaffBySkill] }));
const actIndex = $.let(Data.bindPaged(rosterActivities, { indexes: [rosterActivitiesByGroup] }));
const slice = $.let(Slice.bindRecords("ops.roster", {
    // The week's duties: the Roster's navigation writes the range; no chip picks the week.
    duty: { source: byTime, range: "start" },
    people: { source: staffIndex, search: ["name", "skills"], fields: { team: { label: "Group" }, skills: { label: "Skill" } } },
    activities: { source: actIndex, fields: { group: { label: "Group" } } },
}));
// firms, times, teams, roles and ideas: the agencies, shift times, teams, positions and suggestions, each Data.bind.
const fit = $.let(Func.bind(rosterStaffFit));   // the app's fit, below
// pay and check: below.
return <Roster week={{ start: "sunday" }} slice={{ slice }} fit={fit} pay={pay} currency="AUD" check={check} inspector
    events={{ duty: Schedule.events(rota, {
        name: "Duty", icon: "user-clock", entries,
        start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
        shift: "shift", group: "team", position: "role", activity: "task",
        // The hours a duty counts: its length less its unpaid break.
        hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
        fields: { costCentre: Schedule.field.text({ label: "Cost centre" }), note: Schedule.field.text({ label: "Note" }) },
    }) }}
    resources={{
        people: Schedule.resources(people.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team,
            position: p => p.position, skills: p => p.skills, contract: p => p.contract, agency: p => p.agency,
            trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual }),
        agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
    }}
    periods={Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" })}
    targets={Roster.targets(cover, { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" })}
    shifts={Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order })}
    groups={Roster.groups(teams.read(), { label: t => t.label, order: t => t.order })}
    positions={Roster.positions(roles.read(), { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order })}
    activities={Roster.activities(acts.read(), { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order })}
    proposals={Roster.proposals(ideas.read(), { person: s => s.person, day: s => s.day, group: s => s.team, shift: s => s.shift, reason: s => s.why })}
    rules={{ rest: 10.0 }}
    library={[Roster.library.people(), Roster.library.activities(), Roster.library.tab(roles.read(), {
        name: "Positions", icon: "id-badge", label: p => p.label, meta: p => some(p.code),
        drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }),   // a card dropped on a duty sets its own field
    })]} />;
```

Pay is the app's, in its own pay codes (#1368): an East function over one
person's duties for the week, or one agency's requests, that returns each
duty's cost by code. The Roster asks it a person at a time, again only for the
people whose duties changed, and totals what it answers by duty, slot, day,
week, person and code. The app's check is given those costs and each duty's
own row:

```tsx
// Ordinary time up to the person's contracted hours in the week, OT1 past them, and an agency's hours at its own rate.
const rateRows = $.let(Data.bind(rosterPayRates));
const rates = $.const(rateRows.read());
const pay = $.const(East.function([Roster.Types.PayRequest(WarehouseDuty)], Roster.Types.Pay, ($2, req) => {
    const out = $2.let(new Map(), Roster.Types.Pay);
    const zero = $2.const(0.0, FloatType);
    const agency = $2.let(true, BooleanType);
    const contract = $2.let(0.0, FloatType);
    $2.match(req.who, { person: ($3, key) => {
        $3.if(req.context.people.has(key), ($4) => {
            const person = $4.const(req.context.people.get(key));
            $4.assign(agency, person.agency);
            $4.assign(contract, person.contract);
        });
    } });
    const worked = $2.let(0.0, FloatType);
    // The week's duties in time order, so the contract's hours run out where they do.
    const ordered = $2.const(req.duties.toArray(($3, duty, key) => ({ key, duty })).sort(($3, d) => d.duty.start));
    $2.for(ordered, ($3, d) => {
        const costs = $3.let(new Map(), DictType(StringType, FloatType));
        $3.if(agency, ($4) => {
            $4(costs.insert("AGENCY", d.duty.hours.multiply(rates.get("AGENCY", () => 0.0))));
        }).else(($4) => {
            const ordinary = $4.const(East.max(East.min(d.duty.hours, contract.subtract(worked)), zero));
            const over = $4.const(d.duty.hours.subtract(ordinary));
            $4(costs.insert("ORD", ordinary.multiply(rates.get("ORD", () => 0.0))));
            $4.if(East.greater(over, 0.0), ($5) => { $5(costs.insert("OT1", over.multiply(rates.get("OT1", () => 0.0)))); });
        });
        $3.assign(worked, worked.add(d.duty.hours));
        $3(out.insert(d.key, costs));
    });
    return out;
}));
// The app's check sees the pay too: overtime on a duty nobody has agreed — a field of the warehouse's own row.
const check = $.const(East.function([Roster.Types.CheckContext(WarehouseDuty)], ArrayType(Roster.Types.Issue), ($2, cx) => {
    const issues = $2.let([], ArrayType(Roster.Types.Issue));
    $2.for(cx.week.assignments, ($3, a, id) => {
        const costs = $3.const(cx.pay.get(id, () => East.value(new Map(), DictType(StringType, FloatType))));
        $3.if(costs.has("OT1").and(() => East.notEqual(a.row.agreed, some(true))), ($4) => {
            $4(issues.pushLast({ kind: variant("breach", null), tone: variant("info", null),
                title: "Overtime not agreed", detail: East.str`${a.row.team} · ${a.row.shift}`,
                slot: some(a.slot), assignment: some(id), flag: some("OT"), fix: none }));
        });
    });
    return issues;
}));
```

A Find fix (Find a lead, a trainer, skilled staff) asks the app's fit — an
`e3.function` bound with `Func.bind`, the Allocation's contract — who fits the
issue's need on its slot, over the drafted week and every person, whatever
the rail shows. The People tab shows its fits among what the rail shows, best
first, each card with the fit's reason, under a chip that clears it; the
renderer decides no one itself. A fit builds on the ready-made rule, over the
app's duty row type:

```tsx
// Module level: the warehouse's fit, on e3 — the ready-made rule, then the most spare contract hours first.
export const rosterStaffFit = e3.function("roster_staff_fit", East.function([Roster.Types.FitRequest(WarehouseDuty)], Roster.Types.FitResult, ($, req) => {
    const answer = $.const(Roster.answer(WarehouseDuty));
    const rule = $.const(Roster.fit(WarehouseDuty));
    const weekHours = $.const(Roster.weekHours(WarehouseDuty));
    const hours = $.const(weekHours(req.week, req.context));
    return answer(req, East.function([Roster.Types.FitRequest(WarehouseDuty), Roster.Types.Person], Roster.Types.Fit, ($2, request, person) => {
        const verdict = $2.const(rule(request, person));
        $2.match(verdict, { refused: ($3) => { $3.return(verdict); } });
        const fits = $2.const(verdict.unwrap("fits"));
        return variant("fits", { score: person.contract.subtract(hours.get(person.key, () => 0.0)), why: fits.why, warn: fits.warn });
    }));
}));
```

| Signature | Description | Example |
| --- | --- | --- |
| **Builder and records** | | |
| `<Roster events resources shifts groups periods? targets? positions? activities? proposals? pay? currency? rules? check? fit? slice? library? inspector? view? week? density? chipSkills? requirements? readOnly? id? />` **❗** | Shifts day/week and People week. Refused at build, each naming the change: a removed prop (below); `events` holding other than one kind; `resources` other than `people` and `agencies`; a duty kind whose resource names no `people`; a resource kind read a page at a time; a `people` kind with no `group`; `positions` beside a duty kind with no `position` role; `pay` without `currency`; a `pay`, a `check` or a `fit` over another row type; and a library tab listed twice. The renderer validates live configuration. | `rosterWarehouse`, `rosterMinimal` |
| `events={{ duty: Schedule.events(Record.bind(duties, [patch]), { start, end, resource, shift, group, position?, activity?, hours?, fields?, inspector?, ready?, entries? }) }}` **❗** | Exactly one kind, the duties: a span kind of plain DateTime times, keyed by String. `resource` names a `people` key, or a variant whose cases name `people` and `agencies`: a person, or an agency asked to send someone. `hours` is what a duty counts for coverage, skill hours, contract hours, rest and pay; its length when omitted. The inspector shows a duty's times, position and activity, then the kind's form over the fields no role writes (`fields` hints) or the kind's own `inspector`; `ready` is the app's check on a draft. | `rosterWarehouse`, `rosterCustomInspector` |
| `resources={{ people: Schedule.resources(rows, { name, icon, label, group, position?, skills?, contract?, agency?, trainer?, trainee?, usual? }), agencies?: Schedule.resources(rows, { name, icon, label }) }}` | Every person and agency, read whole: the calculation scope. A person's key is what a duty's resource holds; `group` is their home group. | `rosterWarehouse` |
| `periods={Schedule.periods(Record.bind(weeks, [patch]), { every: "week", status, dismissed?, entries? })}` | The app's weeks, each keyed by its first day by the Roster's week start: the status chip, Publish and the picker's Published · Draft · Not started. `dismissed` keeps the proposals a week rejected; without it, a proposal offers Accept only. Without `periods`, no Publish. | `rosterWarehouse`, `rosterPublished` |
| `targets={Roster.targets(Record.bind(cover, [patch]), { day, group, shift, positions, hours, inspector?, entries? })}` **❗** | The app's cover targets, a row per slot, which its forecast fills: `day` a DateTime (a UTC midnight), `group` and `shift` Strings, `positions` an Integer, `hours` a `Dict<String, Float>` by activity. A slot with no row has no target; a target edit on one inserts a row under a minted key, its other fields their type's default. `inspector` is the app's own form for one target. | `rosterWarehouse`, `rosterCustomInspector` |
| `Roster.shifts(rows, { label, code, start, hours, order? })` · `Roster.groups(rows, { label, order? })` · `Roster.positions(rows, { label, code, lead, order? })` **❗** | The lists the Roster reads over the app's rows, each a `Dict` keyed by String, in its `order`, then key order. A shift's `start` is a `Schedule.Types.Clock` and its `hours` what a new duty runs and a skill holder's capacity; a position that leads satisfies the lead rule, which needs the duty kind's `position` role. An accessor returning another type is refused, naming what it returns. | `rosterWarehouse`, `rosterMinimal` |
| `Roster.activities(rows, { label, code?, group?, order? })` | Every activity from a keyed activities record (`Roster.Types.Activity` rows, or the app's own through the accessors): a group's skills are the activities of that group, and an activity of no group is a duty every group may assign. Coverage and checks read every one. | `rosterWarehouse` |
| `Roster.proposals(rows, { person, day, group, shift, reason })` | The app's suggestions, a person for a slot, each keyed by its row's key: Accept places the duty and keeps the key in the week's `dismissed`, one step; Reject keeps it there alone. A stale or already rostered proposal is hidden. | `rosterWarehouse` |
| `slice={{ slice: Slice.bindRecords(key, { <duty slot>?, targets?, people?, activities?, <a tab's source>? }) }}` **❗** | One rail. The duty kind's source reads the week's duties through an interval index from `start` to `end`, `range: "start"`, the range the Roster's own navigation writes — no chip picks the week — the kind given `entries`; `targets` reads the week's targets the same way, `Roster.targets` given `entries`; `people` narrows the grid's and the People layout's people, the People tab and the person choices; `activities` the Activities tab and the activity choices. Without the duty source the duties are read whole. Coverage, pay and rules read every duty of the week and every person; filters never drop hidden drafts from Save. | `rosterWarehouse`, `rosterWindowed`, `rosterRecordIndexes` |
| **Pay, checks and fits** | | |
| `pay={fn(Roster.Types.PayRequest(R)) => Roster.Types.Pay}` + `currency` **❗** | The app's pay in its own codes: asked once per person with that person's duties for the week — `{ who, start, duties, context }` — and once per agency with its requests, each duty's cost by code back; asked again only for those whose duties, or whose duties' rows, changed. The Roster sums the costs by duty, slot, day, week, person and code, printed in `currency`; a call that throws is a warning banner naming the person, whose duties show no cost. Without `pay`, no costs show. | `rosterWarehouse` |
| `check={fn(Roster.Types.CheckContext(R)) => Array<Roster.Types.Issue>}` | The app's issues after the built-in ones, over `{ start, week, context, coverage, pay }`: each assignment carries its duty's own row (`a.row`), so a check reads the app's own fields. | `rosterWarehouse` |
| `fit={Func.bind(fn: FunctionDef<[Roster.Types.FitRequest(R)], Roster.Types.FitResult>)}` **❗** | The app's fit, beside `check`. A Find fix asks it who fits its issue's need on its slot, over the drafted week and the complete staff, whatever the rail shows; the People tab shows its fits among what the rail shows, best first, each card with the fit's reason, under a `Find · Leads` chip that clears it. One question is in flight at a time, answers are kept by question and drafts, and a find asks again when the drafts change. While asked, the fix reads `Finding…`; a failure is a warning banner, `Fits couldn't be checked`, with Retry. Omitted, no Find fix is offered, though `Roster.check` still reports the issue. A fit bound over another row type is refused, naming both. | `rosterWarehouse`, `rosterRecordIndexes` |
| **Library and inspector** | | |
| `Roster.library.people()` / `.activities()` | Shared Library cards, avatars, search and explicit placement, each tab following its source of the rail: it counts what it shows and, emptied, says so with Clear filters. Neither has a filter of its own: leads, trainers, agency and skill are rail fields of the staff record, and a Find fix's result — the app's fit's answer — is shown in the People tab, with a chip that clears it. Named staff and unnamed agency requests stay distinct. | `rosterWarehouse`, `rosterMobile` |
| `Roster.library.tab(rows, { name, icon?, label, meta?, group?, drop?, source? })` **❗** | Reified typed card accessors over a bound dictionary, following the rail's `source` it names. `drop(row, key)` returns `Schedule.patch(DutyRowType, { … })`: the duty's own fields a card dropped on it sets, as Plan's tabs do. A card never replaces a duty's person. A `source` the slice lacks is refused. | `rosterWarehouse` |
| `inspector` | The end pane: a duty's times, position and activity, its kind's form or own `inspector`, and its costs by code; a slot's coverage and its targets, or `Roster.targets`' `inspector`. Every edit is a command of the same session as a drag or a card's action. | `rosterWarehouse`, `rosterCustomInspector` |
| **Domain functions and values** | | |
| `Roster.Types.{Week(R), Assignment(R), PayRequest(R), CheckContext(R), FitRequest(R), Pay, Status, Slot, Who, Requirements, Requirement, Person, Activity, Group, Skill, Shift, Position, Agency, Rules, Context, Coverage, CoverageLine, Proposal, Issue, Fix, Need, FitResult, Fit, Refusal, Clock}` | The Roster's reading of the app's rows, carried in requests and stored nowhere. Each `(R)` is a constructor of the app's duty row type: the same `R`, the same East type. An `Assignment(R)` is `{ slot, who, position, activity, start, end, hours, row }`, `row` the duty's own; a `Week(R)` `{ status, assignments, requirements, dismissed }`, its status Schedule's period status (`draft`, `published { at }` or `other`). `Pay` is duty key → pay code → cost. A `Need` (leads, trainers, a skill) is a Find fix's; a `FitResult` `{ need, slot, people: Dict<String, Fit> }` echoes its question. `Fit` and `Refusal` are `Schedule.Types`', the Allocation's too. | `rosterWarehouse`, `rosterCoverage` |
| `Roster.coverage(R): (week, context, pay) => Dict<Slot, Coverage>` | Positions, named people, permanent, agency and requested hours — each duty's own hours — skill capacity and assigned hours, leads and trainers for every configured slot; its cost the app's pay summed, zero without it. Requests fill positions but never supply skills or a lead. | `rosterCoverage` |
| `Roster.check(R): (week, context) => Array<Issue>` | The built-in checks: missing lead, double booking, within-week rest, trainee without trainer, skill compatibility, open positions and skill gaps, each with its fix — a rest breach's moves the duty to another shift of its day, or to a later start. | `rosterChecks` |
| `Roster.fit(R): (request, person) => Fit` | The ready-made rule: refused `Not a lead` / `Not a trainer` / `Not skilled` without the need, `Rostered` that day, `Rest too short` (its measure the rest); else it fits, scored by spare contract hours this week and a week's 168 more in the slot's group, its reason `Dispatch · 14 h spare` or `from Inbound · 2 h over contract`. | `rosterFitTrainer` |
| `Roster.answer(R): (request, rule: (FitRequest(R), Person) → Fit) => FitResult` | A verdict per person of the complete staff from a rule, the need and the slot echoed: an `e3.function` fit's body. | `rosterAnswerLeads` |
| `Roster.weekHours(R): (week, context) => Dict<String, Float>` / `Roster.rest(R): (assignment, id, week, context) => Rest` | Each person's hours for the week, each duty's own; and a duty's rest before and after it, measured between the duties' own times. An agency's request has none. | `rosterWeeklyHours`, `rosterRest` |

A duty's day is the UTC day whose shift start is nearest its start, and its
week the week holding that day. The Roster draws a duty's own times wherever
they differ from its shift's (`05:00–15:00` on the 06:00–14:00 shift) and
gives them no name and no worth — the app's `pay` does. Editing them keeps a
duty within 12 hours of its shift's start, its end after its start. A move to
another slot moves `start` and `end` with it, kept where they stood against
the shift's start, and writes `shift` and `group`: a move and back leaves them
as they were. A new duty runs its slot's shift, its other fields their type's
default, under a key minted unique (`crypto.randomUUID()`); Copy previous week
copies each duty of the week before at its shift's own times, its other fields
as they were. A duty whose shift or group isn't configured, or that names no
one, is listed in Issues and kept as stored, never placed.

Every gesture is one step of one history over the duties', the weeks' and the
targets' sessions: accepting a proposal records the duty and the dismissal
together. Save sends each record's changes as its own request; a conflict or a
refusal keeps that record's drafts and leaves the others' commits standing,
and a lost response retries the same request. Drafts of every week stay in
their sessions, and Save includes them. Publish saves first, then writes the
week's status once every record reads back as saved; a failed save leaves the
week a draft, its drafts kept. A published week is read-only in every layout.
Below 480px of **main** width, Shifts and People use cards with explicit
Assign/Move/Edit/Remove/Restore/Request/Accept/Reject/target actions and no
drag. The `rosterMobile` example demonstrates the complete inline authoring
pattern.

Removed with #1368, each still written refused at build, naming its
replacement: `weeks` and `window` (`events={{ <slot>: Schedule.events(…) }}`
and `periods`, the week's duties read through the slice's duty source);
`people={Roster.people(…)}` and `agencies` as `Roster.Types.Agency` values
(`resources={{ people, agencies }}`, `Schedule.resources` kinds); `groups`,
`shifts` and `positions` as Roster values (`Roster.groups`, `Roster.shifts`,
`Roster.positions` over the app's rows); `forecast` (`targets={Roster.targets(…)}`,
a record of the app's that its forecast fills); proposals as
`Roster.Types.Proposal` values (`Roster.proposals`); `inspector={{
assignment, requirement }}` (the duty kind's own `inspector`, and
`Roster.targets`' `inspector`); `Roster.patch` in a tab's `drop`
(`Schedule.patch(DutyRowType, …)`); `costs` (`pay`, the app's East function in
its own codes, and `currency`); and an assignment's `offset`, `overtime` and
`agreed`, `rules.agree` and the agree issue and fix (the duty's own times and
fields, the app's `pay` and its `check`). `Roster.Types.Weeks` and
`Roster.Types.Costs` are gone: an app's weeks record becomes its own duties,
weeks and targets records. `visiblePeople` and `duties` stay refused (#1342).

The runnable examples `rosterMinimal`, `rosterWarehouse`, `rosterMobile`,
`rosterPeople`, `rosterWeek`, `rosterWindowed`, `rosterPublished`,
`rosterCustomInspector`, `rosterRecordIndexes` and `rosterRecordIndexesMobile`
include their record declarations and seeds; `rosterCoverage`, `rosterChecks`,
`rosterWeeklyHours`, `rosterRest`, `rosterFitTrainer` and `rosterAnswerLeads`
run the pure functions over a small staff. Search those names in the example
index.

## Allocation — a day's arrivals booked into lane slots, each bin on its resources

Import `Allocation` from `@elaraai/e3-ui`; the renderer is in
e3-ui-components, and its BuilderFrame is internal. One `<Allocation>` books a
day's arrivals into timed lane slots — each lane takes a bin every `every`, an
hour by default, at its offset past it — and allocates each bin's quantity to
the resources with room and time for its hold, as a Timeline (the lane grid,
the link channel and the resource rows) or a Table (a row per slot, in time
bands). It stores nothing in a shape of its own (#1365): it writes the app's
bins through the bin kind's roles (`Schedule.events`, an instant kind), reads
its lanes and resources (`Schedule.resources`) and what it books from
(`Allocation.arrivals`), and publishes the app's days (`Schedule.periods`).
Every gesture is a draft; Save sends each record's changes, and Publish saves,
then writes the day published, read only from then on. Issues never block
either. Fits, checks and totals read every lane, arrival and resource, and
every bin of the day, whatever the rail shows.

The smallest board — bins with only the board's roles, the bays, the kilns and
the day's loads:

```tsx
// Module level: the app's own bins; its loads (code, m3, dryingDays), kilns and bays are records of its own too.
export const Bin = StructType({
    bay: StringType, at: DateTimeType, load: OptionType(StringType),
    m3: FloatType, kilns: DictType(StringType, FloatType), dryFor: TimeStepType,
});
export const bins = e3.record("bins", DictType(StringType, Bin), new Map());
export const binsPatch = e3.mutation.patch(bins);
// Inside Reactive:
const rows = $.let(Record.bind(bins, [binsPatch]));
const loads = $.let(Data.bind(arrivals));
const yard = $.let(Data.bind(kilns));
const bays = $.let(Data.bind(yardBays));
const fit = $.let(Func.bind(binFit));   // an e3.function from Allocation.Types.FitRequest(Bin), as the yard's fit below is over its own bins
return <Allocation fit={fit}
    events={{ bin: Schedule.events(rows, {
        name: "Bin", icon: "box",
        at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
        quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
    }) }}
    resources={{
        bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
        kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
    }}
    arrivals={Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) })} />;
```

The kiln yard's board over its own records — bins with the yard's spec and
grade beside the board's roles, the days it publishes, a check over the bins'
own fields, one rail and its library (`allocationKilnYard`):

```tsx
// Inside Reactive: what the board writes, each through its patch door.
const bins = $.let(Record.bind(kilnBins, [kilnBinsPatch]));
const entries = $.let(Data.bindPaged(kilnBins));                                   // one bin by its key
const byTime = $.let(Data.bindPaged(kilnBins, { indexes: [kilnBinsByTime] }));     // e3.recordIndex.interval(…, { from: "at", to: "at" })
const days = $.let(Record.bind(yardDays, [yardDaysPatch]));
// What it reads whole — every bay, kiln and load is the calculation scope — and their indexes for the rail.
const yard = $.let(Data.bind(kilns));
const loads = $.let(Data.bind(arrivals));
const bays = $.let(Data.bind(yardBays));
const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
const loadIndex = $.let(Data.bindPaged(arrivals, { indexes: [arrivalsBySpec] }));
// One rail, a source named after each slot it narrows.
const slice = $.let(Slice.bindRecords("ops.allocation", {
    bin: { source: byTime, range: "at" },     // the day's bins: the board's navigation writes the range
    bays: { source: bayIndex, fields: { area: { label: "Area" } } },
    kilns: { source: kilnIndex, fields: { group: { label: "Kiln group" } } },
    arrivals: { source: loadIndex, fields: { spec: { label: "Spec" } } },
}));
const fit = $.let(Func.bind(yardFit));
// The yard's check reads its own fields: a bin measured off its booked spec is flagged, never refused.
const check = $.const(East.function([Allocation.Types.CheckContext(KilnBin)], ArrayType(Allocation.Types.Issue), ($2, cx) => {
    const issues = $2.let([], ArrayType(Allocation.Types.Issue));
    $2.for(cx.plan.bins, ($3, bin, id) => {
        $3.match(bin.arrival, { some: ($4, code) => {
            $4.if(East.notEqual(bin.row.specBooked, bin.row.specMeasured), ($5) => {
                $5(issues.pushLast({ kind: variant("custom", "Spec mismatch"), tone: variant("neutral", null),
                    title: East.str`${code} · bin ${id}`,
                    detail: East.str`Spec booked ${bin.row.specBooked} · measured ${bin.row.specMeasured} · ${bin.lane} ${bin.at.printFormatted("HH:mm")}`,
                    bin: some(id), resource: none, flag: some("≠ spec"), fix: none }));
            });
        } });
    });
    return issues;
}));
return <Allocation title="Kiln loading" fit={fit} check={check} slice={{ slice }} inspector
    library={[Allocation.library.arrivals(), Allocation.library.resources()]}
    view={{ layout: "timeline", date: new Date("2027-05-11T00:00:00Z") }}
    events={{ bin: Schedule.events(bins, {
        name: "Bin", icon: "box", entries,
        at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
        quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
        fields: { specMeasured: Schedule.field.text({ label: "Spec measured" }), instruction: Schedule.field.text({ label: "Loading instruction" }) },
    }) }}
    resources={{
        bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
        kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group, note: k => k.note,
            min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
    }}
    arrivals={Allocation.arrivals(loads.read(), {
        label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec), due: l => some(l.due),
        // A booked bin's own fields: the ones no role maps.
        values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
    })}
    periods={Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } })}
    columns={[
        { key: "spec", label: "Spec", text: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => b.specMeasured, () => East.str`booked ${b.specBooked} · measured ${b.specMeasured}`),
            tone: b => East.equal(b.specBooked, b.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
    ]} />;
```

The board computes no fit of its own. `fit` is the app's `e3.function`, bound
with `Func.bind`, from `Allocation.Types.FitRequest(R)` — the plan day, the day
as drafted with each bin's own row, one question, and every arrival and
resource — to `Allocation.Types.FitResult`. A question is a **place** — a bin
or an arrival, with the quantity being placed: a verdict per resource — or a
**take** — a resource: a verdict per bin, per arrival the day has not booked,
and one for reserving an empty slot. The answer echoes its question, and every
rank, refusal and reason the board shows is its. A fit builds on the
ready-made parts, over the app's bin row type:

```tsx
// Module level: the built-in rules, then a greedy look-ahead over the day's other loads.
export const yardFit = e3.function("yard_fit", East.function([Allocation.Types.FitRequest(KilnBin)], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(KilnBin));
    const rule = $.const(Allocation.fit);
    const ahead = $.const(Allocation.lookahead(KilnBin));
    return answer(req, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, (_$2, c) => ahead(req, c, rule)),
        "ranked by load, kind and spare days, and what it leaves for the day's other loads");
}));
```

| Signature | Description | Example |
| --- | --- | --- |
| **Builder and records** | | |
| `<Allocation events resources arrivals fit periods? every? check? columns? slice? rules? library? inspector? view? horizon? title? readOnly? labels? table? id? />` **❗** | One toolbar row at every width — the day's navigator, its picker marking each day Published · Draft · Not started; Table · Timeline; the status chip; the focus; the rail and its count; the issues; the history and Publish — folding into one View in the narrowest frame; then the Timeline or the Table, the panes the props ask for, and the footer's legend. Refused at build, each naming the change: a removed prop (below); `events` holding other than one kind; a bin kind with no lane or no parts; a resource kind that is neither the lanes' nor the resources'; resources read a page at a time or keyed by anything but String; a resources kind with no `min` or `max`; `arrivals` not from `Allocation.arrivals`, and its `values` of another struct than the bin kind's own fields; `periods` not from `Schedule.periods`; a `fit` bound over another row type, naming both; a `check` of another type; a library tab or a column given twice; an empty label; and Table bands that don't start at 0 and rise within the day. | `allocationMinimal`, `allocationKilnYard`, `allocationTable` |
| `events={{ bin: Schedule.events(Record.bind(bins, [patch]), { at, resource: { field, of }, arrival, quantity: { field, unit? }, parts: { field, of }, hold, kind?, fields?, inspector?, ready?, entries? }) }}` **❗** | Exactly one kind, the bins: an instant kind keyed by String. A bin's UTC day is its plan day, and a batch's bins follow one minute apart. `resource` names its lane, a String key of the lanes' kind; `arrival` the arrival it books, `none` a reservation; `quantity`'s unit shows everywhere a quantity does; `parts` holds its quantity on each resource of the slot `of` names, empty while it is not linked; `hold` and `kind` are kept from booking. The inspector shows the kind's form over the fields no role writes (`fields` hints), or the kind's own `inspector`. | `allocationKilnYard`, `allocationCustomBin` |
| `resources={{ <lanes>: Schedule.resources(rows, { name, icon, label, offset? }), <resources>: Schedule.resources(rows, { name, icon, label, min, max, group?, meta?, note?, hold?, jobs? }) }}` **❗** | The lanes' kind under the slot the bin kind's `resource.of` names, each lane taking a bin each `every` at its `offset` past it, in key order; the resources' kind under the slot its `parts.of` names, each with its range in the quantity's unit. `jobs` is a resource's other work: one covering the day's start makes it busy, the first after it is its next job; `hold` is how long a reservation on it is checked for. Both are read whole and keyed by String. | `allocationKilnYard` |
| `arrivals={Allocation.arrivals(rows: Dict<String, R>, { label, quantity, hold, kind?, meta?, due?, window?, details?, values? })}` **❗** | Every arrival the day may book, each accessor `(row, key) => …`. Booking one writes the bin's roles — `arrival` its key, `quantity`, `kind` and `hold` from these accessors, `parts` empty, `at` and the lane where it is booked — and `values`' struct into the row's other fields: the bin kind's fields no role maps, held to them at build. Without `values` they take their type's default, as a reservation's always do. `due` before the day makes it overdue. | `allocationKilnYard` |
| `periods={Schedule.periods(Record.bind(days, [patch]), { every: "day", status, entries? })}` | The app's days, each keyed by its UTC midnight: the status chip, Publish and the picker's Published · Draft · Not started. A published day is read only under its banner; navigation, the rail, the focus, links and the inspector still work. Without `periods`, no status chip and no Publish. | `allocationKilnYard`, `allocationPublished`, `allocationNoPublish` |
| `slice={{ slice: Slice.bindRecords(key, { <bin slot>?, <lanes>?, <resources>?, arrivals? }) }}` **❗** | One rail in both layouts. The bin kind's source reads the day's bins through an interval index from `at` to `at`, `range: "at"`, the range the board's own navigation writes — no chip picks the day — the kind given `entries`; without it the bins are read whole. The lanes', the resources' and `arrivals` each narrow every place their rows appear — the Timeline's lanes and rows, the Table's rows, the Choosers and the Library's tabs (`Resources 10 of 33`) — and the board reads each one's keys itself. The summary counts the day's bins too (`26 of 33 bin events`). The bare handle, `Slice.bind`, a single `Slice.bindRecord`, a source of another name and one keyed otherwise than by String are refused. | `allocationKilnYard`, `allocationTable`, `allocationWindowed` |
| `check={fn(Allocation.Types.CheckContext(R)) => Array<Allocation.Types.Issue>}` **❗** | The app's issues, after the built-in ones wherever issues show, over `{ day, plan, context, loads }`: each bin carries its own row (`bin.row`), so a check reads the app's own fields. An issue's `flag` marks its bin's card (`≠ spec`); a neutral or info issue is listed, not counted. | `allocationKilnYard` |
| `columns={[{ key, label, text: fn(R) => String, tone?: fn(R) => Option<StatusToken>, table? }]}` **❗** | The app's bin fields as Table columns after the quantity, and as the inspector's rows, each over the bin's own row; `table: false` shows one in the inspector only. | `allocationKilnYard` |
| `labels={{ lane?, arrival?, resource?, quantity? }}` **❗** | The board's nouns everywhere it writes them, each `"Bay"` or `{ one, other?, article? }`; Lane, Arrival, Resource and `QTY` by default. | `allocationLabels` |
| `table={{ bands: [{ from, label? }] }}` **❗** | The Table's time bands, each from its hour to the next band's, the last to midnight; four by default. | `allocationLabels` |
| `rules={{ under }}` · `every` · `view={{ layout, date }}` · `horizon={{ before, after }}` · `title` · `readOnly` · `id` | Whether the built-in rules warn under a resource's minimum (true); the slot spacing; the first layout and day, then kept under `id`; the Timeline's resource axis around the day (3 days before, 10 after); the summary's heading; no edits; storage keys when a surface holds two boards. | `allocationKilnYard` |
| **Library and inspector** | | |
| `Allocation.library.arrivals()` / `.resources()` **❗** | The start pane's tabs, in order — Arrivals: overdue, ready around now, removed from the plan, allocated; Resources: free, loading and busy today. Each card drags onto the board, or a click picks it and a click on a free lane hour books it; each tab follows its source of the rail. A tab listed twice is refused. | `allocationKilnYard` |
| `inspector` **❗** | The end pane, Details and Issues: what is selected — a bin with its Assigned to, each part's quantity, `Split…` (the remainder, or with none some of its largest part), its other fits and the kind's form, or the bin kind's own `inspector` (`update(edited)` one draft); a reservation; a free slot with what it can book and reserve; a resource — or the day's summary; and the day's issues, each with its fix. | `allocationKilnYard`, `allocationCustomBin` |
| **The fit** | | |
| `fit={Func.bind(fn: FunctionDef<[Allocation.Types.FitRequest(R)], Allocation.Types.FitResult>)}` **❗** | Required. The board asks for its active subject — the selected bin, a picked arrival, what a drag, a Chooser or Find a fit is for — and again when the drafts change, one question in flight at a time. While an answer is pending no verdict shows and a drop waits; a failure is the banner `Fits couldn't be checked`, with Retry. A fit bound over another row type than the bin kind's is refused, naming both types. | `allocationMinimal`, `allocationFitRule` |
| `Allocation.answer(R): (FitRequest(R), fit: fn(Candidate) => Fit, basis: String) => FitResult` | The question's candidates, each given a verdict by `fit`: a place's by resource, a take's by bin, by arrival and for reserving. `basis` is the answer's words for how it ranks. An app's fit's body. | `allocationAnswerPlace`, `allocationAnswerTake` |
| `Allocation.fit: (Candidate) => Fit` | The built-in rules, in order: busy (`busy until Fri 14`), a hold past the next job (`gap too short · next job Wed 19`), over max (`over max by 4 m³`), a reservation on a full resource (`full · …`). Else it fits, scored by its fill of the max, +0.25 beside a bin of its kind, −0.1 beside only others, −0.5 under the min and −0.04 a spare day up to six; its reason the spare days and the load it leaves (`1 d spare to Fri 21 · leaves 20 m³ · takes 10–24`), warning `under min` when `rules.under`. | `allocationRules` |
| `Allocation.candidates(R): (FitRequest(R)) => Array<Candidate>` | A place's subject on every resource, in key order; a take's every bin (its unallocated quantity, with its part there), every arrival the day has not booked, then a reservation. | `allocationRules` |
| `Allocation.lookahead(R): (FitRequest(R), Candidate, fit: fn(Candidate) => Fit) => Fit` | A greedy look-ahead: it places the candidate, then the day's unbooked arrivals largest first, each on its best fit, and lowers the score by one for each left with nowhere to go (`· leaves 1 load with no fit`); a refusal passes through. | `allocationLookahead` |
| a rule over the ready-made fit | An `e3.function` that refuses what the app refuses, then gives `Allocation.fit`'s verdict: the board's ranks and reasons are its. | `allocationFitRule` |
| **Domain functions and values** | | |
| `Allocation.loads(R): (day, Day(R), Context) => Dict<String, Load>` | Every resource's fill, bins, hold and state on the day: free, loading or busy. | `allocationDayLoads` |
| `Allocation.check(R): (day, Day(R), Context) => Array<Issue>` | The built-in checks — Not linked, Partly allocated, Overlaps the next job, Over max, and Under minimum when `rules.under` — each with its fix; the app's `check` follows them wherever issues show. | `allocationChecks` |
| `Allocation.slots(R): (day, Day(R), Context) => Array<Slot>` | The day's lane slots, one per lane per `every`, in time then lane order, each free, booked or reserved, with its bins; a booking takes the first free one. | `allocationSlots` |
| `Allocation.Types.{Lane, Status, Bin(R), Day(R), Interval, Job, Detail, Arrival, Resource, Rules, Context, LoadState, Load, Candidate, Refusal, Fit, FitAsk, FitRequest(R), FitResult, Fix, IssueKind, Issue, CheckContext(R), SlotStatus, Slot, Layout}` | The board's reading of the app's rows, carried in requests and stored nowhere. A type over a bin is a constructor of the app's bin row type: the same `R`, the same East type. A bin is `{ lane, at, arrival, quantity, kind, hold, parts, row }`, its roles beside the app's row, `parts` its quantity on each resource, empty while it is not linked; a reservation books no arrival. A day is `{ status, bins }`, its status Schedule's period status. `FitAsk` is `place { subject: bin \| arrival, quantity }` or `take { resource }`, and `FitResult` `{ ask, resources, bins, arrivals, reserve, basis }`. `Fit` and `Refusal` are `Schedule.Types`', the Roster's too. | `allocationKilnYard`, `allocationAnswerTake` |

Every gesture — a drop, a Chooser's choice, a lane or a time step, a quantity,
a split, a fix, Back to Arrivals, Revert — is one step of one history over the
bins' and the days' sessions. Discard drops every draft; Save sends each
record's changes as its own request, and a write with no answer retries the
same request. A changed bin's row is written through the bin kind's roles,
every other field as it was; a new one's under a key minted unique
(`crypto.randomUUID()`), a booking's other fields its arrival's `values` and a
reservation's their defaults. Drafts of every day stay in their sessions, and
Save includes them. Publish saves first, then writes the day's status once
every record reads back as saved; a failed save leaves the day a draft, its
drafts kept. A bin's quantity may be split across resources: each part is its
own link, and what the parts leave is unallocated — a Partly allocated issue,
whose Find a fit asks the fit for the remainder and shows its fits in the
Library's Resources tab, best first, each with the fit's reason, under a chip
that clears it (`allocationSplit`). `Split…` is on every bin with something to
split: it places the remainder, or, on a bin wholly on its resources, takes a
quantity off its largest part — half of it by default — onto the resource
chosen, one step (`allocationKilnYard`). Below 480px of main the Timeline is a
card per resource and the Table a card per row, every action explicit — Book
an arrival…, Move, Split…, Unlink and Back to Arrivals; Book…, Reserve…,
Allocate… and a whole bin's Split… — the same commands, the pickers in
anchored popovers, and nothing drags (`allocationMobile`).

Removed with #1371, each still written refused at build, naming its
replacement: `days` and `window` (`events={{ <slot>: Schedule.events(…) }}`
and `periods`, the day's bins read through the slice's bin source);
`Allocation.Types.Days(V)` and the bin values `V` (the app's own bins and days
records — `Bin(R)` and `Day(R)` carry the app's row as `row` where they
carried `values`); `events={Allocation.events(…)}` and `Allocation.events`
(`arrivals={Allocation.arrivals(…)}`); `Allocation.lanes` and
`Allocation.resources`, and `lanes` and `resources` as values
(`resources={{ <lanes>, <resources> }}`, `Schedule.resources` kinds under the
app's own slots); `publish={false}` (leave `periods` out); `quantity={{ unit
}}` (the `quantity` role's `unit`); `inspector={{ bin }}` (the bin kind's own
`inspector`); and `labels.event` and `Allocation.library.events()`
(`labels.arrival`, "Arrival" by default, and the Arrivals tab,
`Allocation.library.arrivals()`). `Allocation.Types.Event` is
`Allocation.Types.Arrival`, and `events` is `arrivals` in the context, the
fit's ask and its result. The Allocation had shipped in no release, so no
app's record moves.

The runnable examples `allocationMinimal`, `allocationKilnYard`,
`allocationTable`, `allocationLabels`, `allocationPublished`,
`allocationNoPublish`, `allocationSplit`, `allocationWindowed`,
`allocationMobile`, `allocationCustomBin` and `allocationFitRule` include their
record declarations and seeds; `allocationDayLoads`, `allocationRules`,
`allocationAnswerPlace`, `allocationAnswerTake`, `allocationLookahead`,
`allocationChecks` and `allocationSlots` run the pure functions over a small
yard. Search those names in the example index.
