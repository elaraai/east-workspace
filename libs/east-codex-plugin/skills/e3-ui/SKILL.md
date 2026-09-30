---
name: e3-ui
description: "e3 + UI bridge — build interactive, reactive decision surfaces as e3 tasks, authored as JSX. Use when: (1) Declaring UI tasks with ui() (e3 tasks of kind 'ui' producing a UIComponentType), (2) Binding reactive workspace data with Data.bind (read/write/has/commit/discard/status against e3.input / task defs) inside a (Reactive){$ =) …}(/Reactive) block, (3) Staged vs direct edit modes and reviewing pending changes with the (Diff) tag, (4) Graph/ontology editing with the (Ontology) tag, (5) Calling named package functions (e3.function) RPC-style with Func.bind (call/read/status/error/pending/cancel), (6) Wiring a manifest (reads/writes + bound functions auto-derived from a UI task's IR), (7) Interactive causal-experiment surfaces ('did X change Y?') with the (Experiment) tag, generic over a bound dataset's row and driven by e3.function estimators, (8) The Decide loop — Decision.bind unions reasoning-task decision outputs into… See the detailed scope below."
---

## Detailed skill scope

e3 + UI bridge — build interactive, reactive decision surfaces as e3 tasks, authored as JSX. Use when: (1) Declaring UI tasks with ui() (e3 tasks of kind 'ui' producing a UIComponentType), (2) Binding reactive workspace data with Data.bind (read/write/has/commit/discard/status against e3.input / task defs) inside a <Reactive>{$ => …}</Reactive> block, (3) Staged vs direct edit modes and reviewing pending changes with the <Diff> tag, (4) Graph/ontology editing with the <Ontology> tag, (5) Calling named package functions (e3.function) RPC-style with Func.bind (call/read/status/error/pending/cancel), (6) Wiring a manifest (reads/writes + bound functions auto-derived from a UI task's IR), (7) Interactive causal-experiment surfaces ('did X change Y?') with the <Experiment> tag, generic over a bound dataset's row and driven by e3.function estimators, (8) The Decide loop — Decision.bind unions reasoning-task decision outputs into one handle (shared selection + commit gate), <DecisionQueue> (urgency-sorted queue with evidence/options/judgement/modify facets, Apply/Reject, grouping, an author-bound Slice scope) and <DecisionJournal> (the resolved read-back), (9) The Studio — Studio.component declares a self-contained East UI function (written exactly like a ui() body) with what the palette shows; the pages operators build are one record of Studio.Types.Pages with one patch write; <Studio.Builder> is the builder — the open page's canvas under one toolbar (its status, the history, Desktop · Tablet, Save as template, Preview and Publish), the palette of the listed components and the project's pages before it, the inspector of the selected placement after it, and the publish preview in its place — every gesture a draft, Apply one patch on the page, and a publish stamping each placement with the code it goes live with; <Studio.Library> is a project's templates and pages and where new pages start, opening pages in the builder; <Studio.Page> draws one page's live or draft layout with no chrome.

# e3-ui — e3 + UI Bridge

`@elaraai/e3-ui` connects **east-ui** JSX tags to **e3** workspaces. You author a
decision surface as a first-class e3 **UI task** whose reads and writes against
workspace datasets are tracked in a manifest — so the engine knows what data the
UI depends on and can re-render reactively. With staged writes, `<Diff>` review,
and commit / discard, a view becomes a place a user commits a decision with its
evidence — not a read-only report.

The public surface is **JSX tags + platform helpers**, all from one import
(`@elaraai/e3-ui`): the e3-specific tags `<Diff>`, `<Ontology>` and `<Experiment>`, the `Data` and `Func`
binding helpers, `Studio` components, and the `ui()` task factory. Base UI tags (`<VStack>`, `<Text>`,
`<Stat>`, …) come from `@elaraai/east-ui`. The factories (`Diff.Root(…)`) are an
implementation detail under `@elaraai/e3-ui/internal` (also the e3-free,
browser-safe entry for render-only bundles).

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `get_east_example`
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
    ├─ Run the Decide loop over reasoning-task decisions
    │   ├─ Union the bound decision views into one handle → Decision.bind([Contract]?, { decisions, judgements })
    │   ├─ The queue (triage → understand → judge → apply) → <DecisionQueue handle={handle} …/>
    │   ├─ The resolved read-back (Decide↔Trust seam)       → <DecisionJournal handle={handle} />
    │   └─ Scope the queue (author-owned, Table pattern)    → Slice.bind over Decision.Types.Decision, rows = handle.queue()
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

`fn` must return a `UIComponentType`. Default runner is `['east-c', 'run']`.

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
- a diff's values.

Numbers follow the viewer's locale, and every date prints its UTC day. A host sets the locale by wrapping the app in `<I18nProvider locale="de-DE">`, re-exported from `@elaraai/east-ui-components`; the browser's language stands in otherwise.

A value that is data prints bare: every digit, never grouped, with the locale's decimal separator (a year stays `2026`). That covers a constraint's number and a diff's integer. A declared spec, such as a decision's `format`, prints as the east-ui skill's Formats branch describes.

## Examples

Tested examples live in `test/*.examples.tsx`:
- `data.examples.tsx` — `Data.bind` read/write/has, staged vs direct.
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

## Related skills

- **e3** — workspaces, tasks, `e3.input`, dataflow execution (the engine `ui()`
  builds on).
- **east-ui** — the JSX component library (`<Reactive>`, `<Slider>`, `<Stat>`, …)
  that `ui()` renders.
- **east** — the language used inside `East.function` bodies.
- **east-ontology** — the `<Ontology>` editor's node/link model and the workshop
  method for building one.
- **east-design** — decide where a decision surface fits in the overall solution.
- **e3-ui-cli** — screenshot a surface from the terminal: `e3-ui shot
  --from-source` renders a zero-input `ui()` task; `--from-task` renders a
  deployed task's computed output.
