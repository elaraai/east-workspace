---
name: e3-ui
description: "e3 + UI bridge — build interactive, reactive decision surfaces as e3 tasks, authored as JSX. Use when: (1) Declaring UI tasks with ui() (e3 tasks of kind 'ui' producing a UIComponentType), (2) Binding reactive workspace data with Data.bind (read/write/has/commit/discard/status against e3.input / task defs) inside a <Reactive>{$ => …}</Reactive> block, (3) Staged vs direct edit modes and reviewing pending changes with the <Diff> tag, (4) Graph/ontology editing with the <Ontology> tag, (5) Calling named package functions (e3.function) RPC-style with Func.bind (call/read/status/error/pending/cancel), (6) Wiring a manifest (reads/writes + bound functions auto-derived from a UI task's IR), (7) Interactive causal-experiment surfaces ('did X change Y?') with the <Experiment> tag, generic over a bound dataset's row and driven by e3.function estimators."
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
    └─ Let a user ask "did X change Y?" against a dataset and trust the answer
        └─ <Experiment data spec estimate … />   (generic over the row; runs e3.functions)
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

### `<Experiment data spec estimate … />`

An interactive **causal-experiment** surface: an end user asks *"did X change
Y?"* against a bound dataset and reads a derived, trustworthy answer across three
tabs (Answer / Can we trust it? / How much?). Generic over the dataset's row
(like `<Table>`), it stages an `ExperimentSpec` and runs developer-supplied
`e3.function`s on **Run**, deriving every word / colour / bar from the returned
numbers — nothing is authored. **Commit** appends the result to the journal.

| Prop | Binding | Meaning |
|---|---|---|
| `data` | `Data.bind(dataset)` | the rows to experiment on (`Array<Struct<Row>>`) |
| `spec` | `Data.bind(spec, { mode: 'staged' })` | the staged `ExperimentSpec` the surface reads / writes |
| `estimate` | `Func.bind(fn)` | **required** — `(rows, spec) → ExperimentResult` (Answer tab) |
| `refute` | `Func.bind(fn)` | optional — `(rows, spec) → RefuteResult` (trust tab) |
| `dose` | `Func.bind(fn)` | optional — `(rows, spec, feature) → DoseResult` (dose tab) |
| `journal` | `Data.bind(dataset)` | optional committed-experiment log; **Commit** appends |
| `columns` | — | per-column display config keyed by the row's fields (like `<Table>`), e.g. `{ bond_strength: { unit: 'MPa' } }` |
| `readonly` | — | render without Run / Commit / edit affordances |
| `defaultTab` | — | initial tab: `'answer'` (default) \| `'trust'` \| `'dose'` |

```tsx
<Reactive>{$ => {
    const data     = $.let(Data.bind(batchesInput));
    const spec     = $.let(Data.bind(experimentSpecInput, { mode: 'staged' }));
    const journal  = $.let(Data.bind(experimentJournalInput));
    const estimate = $.let(Func.bind(estimateFn));   // (rows, spec) → ExperimentResult
    const refute   = $.let(Func.bind(refuteFn));     // (rows, spec) → RefuteResult
    const dose     = $.let(Func.bind(doseFn));       // (rows, spec, feature) → DoseResult
    return (
        <Experiment data={data} spec={spec} estimate={estimate} refute={refute} dose={dose}
            journal={journal} columns={{ bond_strength: { unit: 'MPa' } }} />
    );
}}</Reactive>
```

The render-contract value types are reached via `Experiment.Types.*`
(`Experiment.Types.Spec` / `.Result` / …, like `Table.Types.*`).

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
