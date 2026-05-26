---
name: e3-ui
description: "e3 + UI bridge — build interactive, reactive dashboards as e3 tasks. Use when: (1) Creating UI tasks with ui() (e3 tasks of kind 'ui' producing a UIComponentType), (2) Reactive workspace data with Data.bind (read/write/has/commit/discard against dataset paths), (3) Staged vs direct edit modes and reviewing pending changes with Diff, (4) Graph/ontology editing with Ontology, (5) Data manifests (reads/writes metadata derived from a UI task's IR)."
---

# e3-ui — e3 + UI Bridge

`@elaraai/e3-ui` connects **east-ui** components to **e3** workspaces. It lets you author a dashboard as a first-class e3 **UI task** whose reads and writes against workspace datasets are tracked in a manifest, so the engine knows what data the UI depends on and can re-render reactively. This is the platform's **decision-surface** layer: with staged writes, `Diff` review, and commit / discard, a view becomes a place a user commits a decision with its evidence — not a read-only report.

Two entry points:
- `@elaraai/e3-ui` — render-side, browser-safe: `Data`, `Diff`, `Ontology`, `DataManifestType`.
- `@elaraai/e3-ui/ui` — author-side: the `ui()` task factory (pulls in `@elaraai/e3`, Node-only).

## Quick Start

```typescript
import e3 from '@elaraai/e3';
import { ui, Data } from '@elaraai/e3-ui/ui';
import { FloatType, East } from '@elaraai/east';
import { Reactive, Slider, UIComponentType } from '@elaraai/east-ui';

const threshold = e3.input('threshold', FloatType, 50.0);

// A UI task: reactive binding to a workspace dataset, no compute-time inputs.
const dashboard = ui('dashboard', [], East.function([], UIComponentType, (_$) =>
  Reactive.Root(East.function([], UIComponentType, $ => {
    const t = $.let(Data.bind([FloatType], threshold.path));
    return Slider.Root($.let(t.read()), { onChange: t.write });
  }))
));
// Manifest auto-derived: reads [threshold], writes [threshold]
```

Deploy and run it like any e3 task; the workspace re-renders the component when bound datasets change.

## Decision Tree: What Do You Need?

```
Task → What do you need?
    │
    ├─ Author a dashboard as an e3 task
    │   ├─ Component that reacts to workspace data → ui(name, [], fn) + Data.bind
    │   └─ Component that also takes computed inputs → ui(name, [input], fn) (fn receives values)
    │
    ├─ Read / write workspace datasets from the UI
    │   ├─ Read a value           → Data.bind([T], path).read()
    │   ├─ Check if set           → Data.bind([T], path).has()
    │   ├─ Write a value          → Data.bind([T], path).write(v)
    │   └─ Stage edits, then apply → mode: 'staged' + .commit() / .discard() / .pending()
    │
    ├─ Review pending (staged) changes → Diff
    │
    └─ Edit a graph / ontology dataset → Ontology (OntologyType)
```

## Core Concepts

### `ui(name, inputs, fn, options?)`

Wraps `e3.task()` with `kind: "ui"` and a **manifest** auto-derived from the IR:
- **Compute-time reads** — every dataset in `inputs` (the runner passes their values to `fn` as positional args).
- **Reactive reads** — every `Data.bind(path).read()` / `.has()` in the IR.
- **Reactive writes** — every `Data.bind(path).write()` in the IR.

`fn` must return a `UIComponentType`. Default runner is `['east-c', 'run']`.

> Paths in `Data.bind` must be JS-side constants captured at IR-build time — typically `e3.input(name, T).path`. Dynamic paths throw at derive time.

### `Data.bind([T], path, options?)`

A workspace-scoped reactive binding to the dataset at `path`. Handle methods:

| Method | Meaning |
|---|---|
| `.read()` | current value (type `T`) |
| `.has()` | whether the dataset is set |
| `.write(v)` | set the value |
| `.commit()` | apply staged edits (staged mode) |
| `.discard()` | drop staged edits (staged mode) |
| `.pending()` | whether there are uncommitted staged edits |

**Modes** (`options.mode`):
- `'direct'` — each `write()` immediately mutates the destination (triggers the workspace dataflow).
- `'staged'` — `write()` accumulates a patch; `commit()` applies it, `discard()` drops it.

### `Diff`

Renders a review of pending changes for any combination of bindings — the staged-mode companion for "review before apply" UX.

### `Ontology`

A graph editor (`NodeType` / `LinkType` / `OntologyType`) bound to a dataset, for editing typed node/link graphs.

### Manifest

`DataManifestType` / `deriveManifest(fn)` / `encodeManifest` / `decodeManifest` — the reads/writes metadata. `ui()` derives and encodes it for you; use these directly only for advanced/custom task wiring.

## Examples

Tested examples live in `test/*.examples.ts`:
- `data.examples.ts` — `Data.bind` read/write/has, staged vs direct.
- `diff.examples.ts` — reviewing pending changes.
- `ontology.examples.ts` — graph/ontology editing.

## Packages

| Import | Use |
|---|---|
| `@elaraai/e3-ui` | Render-side (browser-safe): `Data`, `Diff`, `Ontology`, `DataManifestType` |
| `@elaraai/e3-ui/ui` | Author-side: `ui()` task factory (depends on `@elaraai/e3`) |

## Related skills

- **e3** — workspaces, tasks, `e3.input`, dataflow execution (the engine `ui()` builds on).
- **east-ui** — the component library (`Reactive`, `Slider`, `Stat`, `Text`, …) that `ui()` renders.
- **east** — the language used inside `East.function` bodies.
- **east-ontology** — the `Ontology` editor's node/link model and the workshop method for building one.
- **east-design** — decide where a decision surface fits in the overall solution.
