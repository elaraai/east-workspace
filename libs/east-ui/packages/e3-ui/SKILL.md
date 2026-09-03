---
name: e3-ui
description: "e3 + UI bridge — build interactive, reactive decision surfaces as e3 tasks, authored as JSX. Use when: (1) Declaring UI tasks with ui() (e3 tasks of kind 'ui' producing a UIComponentType), (2) Binding reactive workspace data with Data.bind (read/write/has/commit/discard/status against e3.input / task defs) inside a <Reactive>{$ => …}</Reactive> block, (3) Staged vs direct edit modes and reviewing pending changes with the <Diff> tag, (4) Graph/ontology editing with the <Ontology> tag, (5) Calling named package functions (e3.function) RPC-style with Func.bind (call/read/status/error/pending/cancel), (6) Wiring a manifest (reads/writes + bound functions auto-derived from a UI task's IR), (7) Interactive causal-experiment surfaces ('did X change Y?') with the <Experiment> tag, generic over a bound dataset's row and driven by e3.function estimators, (8) The Decide loop — Decision.bind unions reasoning-task decision outputs into one handle (shared selection + commit gate), <DecisionQueue> (urgency-sorted queue with evidence/options/judgement/modify facets, Apply/Reject, grouping, an author-bound Slice scope) and <DecisionJournal> (the resolved read-back)."
---

# e3-ui — e3 + UI Bridge

`@elaraai/e3-ui` connects **east-ui** JSX tags to **e3** workspaces. You author a
decision surface as a first-class e3 **UI task** whose reads and writes against
workspace datasets are tracked in a manifest — so the engine knows what data the
UI depends on and can re-render reactively. With staged writes, `<Diff>` review,
and commit / discard, a view becomes a place a user commits a decision with its
evidence — not a read-only report.

The public surface is **JSX tags + platform helpers**, all from one import
(`@elaraai/e3-ui`): the e3-specific tags `<Diff>`, `<Ontology>` and `<Experiment>`, the `Data` and `Func`
binding helpers, and the `ui()` task factory. Base UI tags (`<VStack>`, `<Text>`,
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
import { East, FloatType } from '@elaraai/east';
import { Reactive, Slider, UIComponentType } from '@elaraai/east-ui';
import { ui, Data } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

const threshold = e3.input('threshold', FloatType, 50.0);

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
