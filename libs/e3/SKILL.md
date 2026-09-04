---
name: e3
description: "East Execution Engine (e3) - durable dataflow execution for East programs. Use when: (1) Authoring e3 packages with @elaraai/e3 (e3.input, e3.task, e3.customTask, e3.function, e3.ui, e3.package, e3.export), (2) Bounded-memory dataflow over huge collection datasets (e3.partitionTask, e3.streamTask), (3) Running e3 CLI commands (e3 repo, e3 workspace, e3 package, e3 dataset, e3 task, e3 dataflow run, e3 call, e3 watch, e3 auth), (4) Working with workspaces and packages, (5) Content-addressable caching and reactive dataflow execution, (6) Calling functions authored in python, or in another node package, from a task (East.importFunction — a workspace member is exported and linked by e3.export itself; { functions } / --functions for one built elsewhere)."
---

# East Execution Engine (e3)

e3 is a durable dataflow execution engine for East programs with content-addressable caching. It is the platform's **Compute** layer — and East + e3 solutions are decision-oriented: a dataflow exists to put auditable evidence behind a business decision, not to move data for its own sake.

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

```typescript
// src/index.ts
import { East, StringType } from '@elaraai/east';
import e3 from '@elaraai/e3';

// Define an input
const name = e3.input('name', StringType, 'World');

// Define a task
const greet = e3.task(
  'greet',
  [name],
  East.function([StringType], StringType, ($, n) =>
    East.str`Hello, ${n}!`
  )
);

// Bundle and export
const pkg = e3.package('hello', '1.0.0', greet);
await e3.export(pkg, '/tmp/hello.zip');
export default pkg;
```

```bash
# Create repository
e3 repo create .

# Deploy the package zip (imports + creates workspace + deploys)
e3 workspace deploy . dev --from-zip /tmp/hello.zip
# …or deploy straight from the TypeScript source (no manual export/zip):
e3 workspace deploy . dev --from-source ./src/index.ts

# Execute dataflow
e3 dataflow run . dev

# Get result (flat path: <ws>.<name>)
e3 dataset get . dev.greet
```

## Decision Tree

```
Task → What do you need?
│
├─ Authoring a package (SDK)
│   ├─ Input dataset        → e3.input(name, type, default?)
│   ├─ Record (audited state)→ e3.record(name, type, initial)
│   ├─ Mutation (reducer)    → e3.mutation(name, record, fn)
│   ├─ East function task   → e3.task(name, [inputs], fn, config?)
│   ├─ Huge input, per-row / per-entity / reduce → e3.partitionTask(name, spec, fn)
│   ├─ Huge input, one-pass fold / re-key / ingest → e3.streamTask(name, spec, fn)
│   ├─ Shell command task   → e3.customTask(name, [inputs], outputType, cmd)
│   ├─ Named function (RPC) → e3.function(name, fn, config?)
│   ├─ Chain task outputs   → secondTask([firstTask.output], ...)
│   ├─ Bundle               → e3.package(name, version, ...items)
│   ├─ Export to zip        → e3.export(pkg, zipPath, { functions? })
│   └─ Call a fn authored in python, or in another node package → East.importFunction(pkg, name, FunctionType) in the task body — a package of the
│       uv or npm workspace is exported and linked by e3.export itself (no manual step); { functions } / --functions only for a manifest built elsewhere
│
├─ Repository
│   ├─ Create               → e3 repo create <repo>
│   ├─ Status / inspect     → e3 repo status <repo>
│   ├─ List repos on server → e3 repo list <server-url>
│   └─ Garbage collect      → e3 repo gc <repo> [--dry-run]
│
├─ Package operations
│   ├─ Import from zip      → e3 package import <repo> <zip>
│   ├─ Export to zip        → e3 package export <repo> <pkg> <zip>
│   ├─ List                 → e3 package list <repo>
│   └─ Remove               → e3 package remove <repo> <pkg>
│
├─ Workspace
│   ├─ Deploy (import+create+deploy) → e3 workspace deploy <repo> <ws> --from-zip <zip>
│   ├─ Deploy from TS source         → e3 workspace deploy <repo> <ws> --from-source <src.ts> [--functions <manifest…>]
│   ├─ Deploy already-imported pkg   → e3 workspace deploy <repo> <ws> <pkg>[@<ver>]
│   ├─ List workspaces               → e3 workspace list <repo>
│   ├─ Inspect                       → e3 workspace status <repo> <ws>
│   ├─ Export as package             → e3 workspace export <repo> <ws> <zip>
│   └─ Remove                        → e3 workspace remove <repo> <ws>
│
├─ Running the dataflow
│   └─ Execute all tasks    → e3 dataflow run <repo> <ws> [--force] [--concurrency <n>] [-v]
│
├─ Datasets (read / write values)
│   ├─ Read a value         → e3 dataset get <repo> <ws.name> [-f east|json|beast2]
│   ├─ Write a value        → e3 dataset set <repo> <ws.name> <file>
│   ├─ List all paths       → e3 dataset list <repo> <ws> [-l]
│   ├─ Status (kind/type)   → e3 dataset status <repo> <ws.name>
│   └─ Search               → e3 dataset find <repo> <ws> <pattern>
│
├─ Records (audited mutable state — mutations only, no raw set)
│   ├─ Apply a mutation     → e3 mutate <repo> <record.mutation> [args...] -w <ws>
│   ├─ Commit history       → e3 history <repo> <record> -w <ws> [--limit n] [--from hash]
│   └─ Compact history      → e3 compact <repo> <record> -w <ws>
│
├─ Tasks (inspect / logs)
│   ├─ List with status     → e3 task list <repo> <ws>
│   └─ View / follow logs   → e3 task logs <repo> <ws.task> [-n <lines>] [--all] [--follow]
│
├─ Development workflow
│   ├─ Watch + auto-deploy  → e3 watch <src.ts> <repo> <ws> [--start]
│   ├─ Ad-hoc task run      → e3 run <repo> <pkg.task> [inputs...] -o <output>
│   ├─ Call a function      → e3 call <repo> <pkg.fn> [args...] [-o <output>]
│   └─ Convert formats      → e3 convert [input] --from <fmt> --to <fmt>
│
└─ Remote servers / auth
    ├─ Log in               → e3 auth login <server>
    ├─ Status               → e3 auth status
    └─ Use remote repo      → e3 <cmd> http://server/repos/my-repo
```

## SDK Reference (@elaraai/e3)

### e3.input(name, type, defaultValue?)

Define an input dataset. Addressed from the CLI as `<ws>.${name}` (storage path `<ws>/inputs/${name}` is internal).

```typescript
const name = e3.input('name', StringType, 'default');
const count = e3.input('count', IntegerType);
```

### e3.task(name, inputs, fn, config?)

Define a task that runs an East function.

Task inputs (every task kind) decode **deeply frozen** on every runtime —
mutating one raises `cannot mutate a frozen value (task inputs are
immutable) — copy first`; derive changed values from `.copy()`. Indexed
beast2 collection inputs open **lazily** once they reach 64 MiB on the wire
(`EAST_LAZY_INPUT_BYTES` tunes; a streamTask's `stream` input opens lazily
at any size): size, iteration and keyed gets are then served per segment
with no whole decode. The only element shapes that still decode whole are
those carrying a `Ref` or a function; any operation the pager cannot serve
hydrates once, transparently. Full mechanics under e3.streamTask below.

Datasets stay inputs — the lazy open is already there, and only a dataset
takes part in the dataflow's hashing and reactivity. Two in-expression
opens give the same frozen, pager-served value for data that is NOT a
dataset: `FileSystem.openBeast(T, path)` (the std family — every stock
runner, so a python-authored function using it links into an east-c task)
for a beast2 collection file on the runner's disk — a reference table, a
file another tool wrote — and `blob.openBeast(T)` for bytes already in
hand: a `BlobType` dataset, a `Fetch.getBytes` result. Neither is watched
by the dataflow, so anything a task should react to is still an input.

```typescript
// Default runner is east-node + @elaraai/east-node-std — every e3 project
// already has Node, so this resolves with no extra setup.
const greet = e3.task(
  'greet',
  [name],  // dependencies (inputs or other task outputs)
  East.function([StringType], StringType, ($, n) =>
    East.str`Hello, ${n}!`
  )
);

// Override with a typed runner (autocomplete + typo-safe on stock runners and
// platforms; use `{ custom: 'name' }` for non-stock platforms; `runtime:
// 'custom'` is the argv escape hatch).
const pyTask = e3.task(
  'py_task',
  [input],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'east-py', platforms: ['east-py-std', 'east-py-datascience'] } }
);

// east-c — native binary, lowest overhead, no Python or Node runtime needed
// past the spawn itself.
const fast = e3.task(
  'fast',
  [input],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'east-c', platforms: ['east-c-std'] } }
);

// Custom argv (e.g. wrapping east-py with uv):
const wrapped = e3.task(
  'wrapped',
  [input],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] } }
);

// Chain tasks via .output
const shout = e3.task(
  'shout',
  [greet.output],
  East.function([StringType], StringType, ($, s) => s.toUpperCase())
);
```

#### Calling a project-owned (custom) platform function

To call your OWN native code (a TS/Node lib, or Python like numpy) that East
can't express, use a `{ custom: '<name>' }` platform entry. The `<name>` is how
the runner finds your code — and it differs by runtime:

- **east-node**: `<name>` is your project's **own scoped package name** (e.g.
  `@elaraai/my-project`). east-node-cli loads its `./platform` default export (a
  `PlatformFunction[]`) by self-reference.
- **east-py**: `<name>` is the Python **module** name (e.g. `platform_module`).
  `east-py run -p <name>` imports it and reads its top-level `platform` list.

```typescript
// TS-East fn implemented in this package's ./platform export
const buffered = e3.task('buffered', [qty.output, factor],
  East.function([IntegerType, FloatType], IntegerType, ($, q, f) => applyBuffer(q, f)),
  { runner: { runtime: 'east-node', platforms: [{ custom: '@elaraai/my-project' }] } });

// Python fn implemented in platform_module/ (+ stock east-py-std)
const forecast = e3.task('forecast', [history],
  East.function([ArrayType(FloatType)], FloatType, ($, h) => forecastDemand(h)),
  { runner: { runtime: 'east-py', platforms: [{ custom: 'platform_module' }, 'east-py-std'] } });
```

The platform-function name string must be the dotted `"<project>.<fn>"` and must
byte-match between the East declaration and the implementation. To AUTHOR the
implementation and wire it (the `./platform` export, the Python package, the
`--platform` scaffold), see the **east-project** skill (and **east** for
`East.platform(...).implement(...)`, **east-py** for `@platform_function`).

#### Calling a function authored in python (or another package) — `East.importFunction`

When the logic is East-expressible but written in python (with east-py's
`East.function`) — or in another node package of the project — do not wrap it
as a platform function: import it. The task refers to the function by package
and name with its declared type; at `e3.export` the reference is resolved and
the function's IR is embedded, so the deployed task is pure IR that runs on
any runner — no python at run time, no runner, platform or environment to
declare. The reference is all you write: a package of the project's uv
workspace is found the way a `{ custom }` platform is (by name, in the
governing `uv.lock`), its root module's `east_functions` exported in its own
environment (`east-py export-functions`, run from the project's `.venv` or
`east-py` on PATH — `EAST_PY` names it outright) and linked, per export; a
package of the npm workspace is found in the governing lockfile by its
`package.json` name, and the `eastFunctions` of its BUILT `./functions` export
exported with `east-node export-functions` (the project's own
`@elaraai/east-node-cli`, else PATH — `EAST_NODE` names it outright). Only
the functions a task imports are exported, with the providers of that task's
runner: a sibling function's platform call never fails a task that does not
use it, and two tasks on different runners each link their own export.

```python
# packages/pricing/src/pricing/__init__.py — the package's root module
from east import East, FloatType, IntegerType, StringType, StructType
Row = StructType([("sku", StringType), ("qty", IntegerType), ("price", FloatType)])
score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * r.price)
east_functions = {"score": score}
```

```typescript
import { East, FunctionType, FloatType, ArrayType } from '@elaraai/east';

const score = East.importFunction('pricing', 'score', FunctionType([RowType], FloatType));
const total = e3.task('total', [rows],
  East.function([ArrayType(RowType)], FloatType, ($, rs) => rs.map(($, r) => score(r)).sum()));

await e3.export(pkg, '/tmp/app.zip');          // finds `pricing`, exports it, links
// e3 workspace deploy . dev --from-source src/index.ts
```

```typescript
// packages/node/api/src/functions.ts — the member's "./functions" export (built: dist/functions.js)
export const scale = East.function([ArrayType(FloatType), FloatType], ArrayType(FloatType),
  ($, values, factor) => values.map(($, v) => v.multiply(factor)));
export const eastFunctions = { scale };

// the app: the member's npm name, the function, its exact type — no runner, no environment
const scale = East.importFunction('@shop/api', 'scale', FunctionType([ArrayType(FloatType), FloatType], ArrayType(FloatType)));
const scaled = e3.task('scaled', [series, factor],
  East.function([ArrayType(FloatType), FloatType], ArrayType(FloatType), ($, s, f) => scale(s, f)));
```

A package built elsewhere — published, or another repo — is passed as its
manifest instead: `east-py export-functions pricing -o pricing.functions.beast2
-p east-py-std` (`east-node export-functions dist/functions.js -o
api.functions.beast2 -p @elaraai/east-node-std`) where it lives, then
`{ functions: ['./pricing.functions.beast2'] }` / `--functions`; an explicit
manifest wins for its package. A referenced package that is neither is an
export error naming the import. A `create-e3` package scaffold ships both
crossings per python and node member — the platform function and an East
function the app imports this way (the **e3-create** skill).

The declared type must equal the exported type exactly (a mismatch fails the
export naming both). The imported function's platform calls are checked
against the task's runner: the manifest names the package providing each
(derived from the task's runner when e3 exports the package itself, `-p`
when you do), and the runner must list it — by name, or a stock package of
the same family (`east-py-std` ≡ `@elaraai/east-node-std` ≡ `east-c-std`,
`east-py-io` ≡ `@elaraai/east-node-io`). The other direction — a TypeScript
function for python — is `east-node export-functions` / `East.exportFunctions`
(see **east**); the contract is `docs/conventions/EAST_CODEGEN.md` §6.

#### Execution environments — auto-derived from the platform reference

A `{ custom: <name> }` platform only runs where its implementation is installed.
e3 handles this for you: at `e3.export` it **derives the task's environment from
the platform reference** — it resolves `<name>` to the workspace package that
provides it and captures that package's dependency closure (`pyproject.toml` +
`uv.lock` + sdists for python; `package.json` + lockfile + `npm pack` for node)
into the exported package as content-addressed objects. **No `environment` field
is needed.** The runner materializes the closure into a per-repo cache before
spawning (warm after first use), so the package runs on repos/machines that never
saw your working tree.

```typescript
// e3 derives the environment from { custom: 'pricing' } — captures the
// packages/python/pricing closure. No `environment` field.
const forecast = e3.task('forecast', [history],
  East.function([ArrayType(FloatType)], FloatType, ($, h) => forecastDemand(h)),
  { runner: { runtime: 'east-py', platforms: [{ custom: 'pricing' }, 'east-py-std'] } });
```

**Per-package change detection.** Split platform code into separate workspace
packages — scaffold with `create-e3 --python-packages=pricing,forecasting`
(`--node-packages=…` → npm members, `--c-packages=…` → native binaries via a
`tools` env; see the **east-project** skill). Each package is its own captured
environment, so editing one package changes only its tasks' hashes: e3 re-runs
only those tasks and serves the rest from the cache — even across a redeploy, and
alongside the reactive re-run when an input or record changes. A task calling
several packages captures the union of their closures.

**Explicit `environment` (override).** Pass an `environment` to override the
derivation — it is the only way to reach `tools` (attach prebuilt binaries, e.g.
a compiled C runner) or a pinned container `image`, or to point at a specific
project directory:

```typescript
{ environment: { tools: { files: ['./native/solver/build/solver'] } } } // prebuilt C binary
{ environment: { image: { digest: 'repo@sha256:<64 hex>' } } }          // cloud only
{ environment: { python: { project: 'packages/python/pricing' } } }      // explicit dir
```

Environments resolve at `e3.export` time (missing lockfile or failed build ⇒
export error; a mutable `image` tag is rejected at definition time). A task whose
platforms are all stock (no local `{ custom }` package) runs on the stock runtime
image, as before.

### e3.partitionTask(name, spec, fn)

Define a task over huge collection datasets with bounded memory: e3 carves
the partitioned input(s) into key-range slices, runs `fn` once per partition
as an ordinary content-addressed execution (parallel, memoized per
partition), and assembles the output — shards splice in partition order, or
partials fold pairwise when `combine` is given. One task node, one output
dataset; the dataflow graph is unchanged.

```typescript
const sales = e3.input('sales', DictType(SaleKeyType, SaleType));
const rates = e3.input('rates', DictType(StringType, FloatType));

// Row-local transform: each execution returns its shard; shards splice.
const cleaned = e3.partitionTask('cleaned', {
  partitions: [sales],
  inputs: [rates],                       // ordinary inputs, passed to every partition
  output: DictType(SaleKeyType, SaleType),
}, ($, slice, rates) => slice.filter(($, sale) => East.greater(sale.qty, 0n)));

// Reduce to a small result: each execution returns a partial; partials fold.
const totals = e3.partitionTask('totals', {
  partitions: [sales],
  by: (_$, key) => key.sku,              // rows with equal by(key) never split
  output: DictType(StringType, IntegerType),
  combine: ($, a, b) => {
    const acc = $.let(a.copy());         // partials are frozen inputs — fold into a copy
    $(acc.mergeAll(b, ($, v1, v2) => v1.add(v2), ($, _k) => 0n));
    $.return(acc);
  },
}, ($, slice) => /* per-partition aggregation of `slice` */ ...);

// Co-partition two same-keyed datasets (reconcile / delta): 2+ entries in
// `partitions` carve at shared boundary keys; each execution receives the
// matching key-range slice of each.
const delta = e3.partitionTask('delta', {
  partitions: [today, yesterday],
  output: DictType(SaleKeyType, FloatType),
}, ($, todaySlice, yesterdaySlice) => ...);
```

Spec fields: `partitions` (1+ huge Dict/Set/Array inputs; 2+ co-partition and
must all be Dict or all Set — and when their key types differ, the effective
boundary projection, implicit or explicit, must still follow every dataset's
own key field order, validated at build time), `by` (boundary alignment —
must read a leading prefix of every partitioned dataset's key: the key
itself, a leading field, a nested leading-field path like `key.a.b` where
each step is the first field of its level, or a struct literal of leading
fields in declared order; validated at build time, any other body rejected),
`inputs` (ordinary broadcast inputs — any change re-runs all partitions),
`output` (a collection unless `combine` is given — splice mode assembles the
output from shards), `combine` (associative fold; its presence is the whole
mode switch), `targetPartitionBytes` (the only sizing knob, default 256
MiB), `runner`, `environment`.

Splice-mode contract: Array shards concatenate freely; Dict/Set shard key
ranges must ascend disjointly in partition order (key-preserving and monotone
re-keys qualify). A violation fails the task at splice naming the offending
partitions — deliberately a runtime check, not build-time: whether an
arbitrary body preserves key order is undecidable from types, and a static
rule would false-reject permitted monotone re-keys. A PARALLEL huge→huge
re-key needs `combine`, `customTask`, or future shuffle support (a one-pass
re-key fits `streamTask` — its sink accepts any emission order). Partition memoization is append-friendly: appends and
tail-localized changes re-run only the affected partitions, while a
mid-key-space insertion re-runs partitions from the insertion point on.

### e3.streamTask(name, spec, fn)

Define a one-pass streaming task: the runner feeds the `stream` input in
canonical order and the body writes the output incrementally through the
`emit` capability — exact left-fold semantics, no parallelism and no
partial recompute. Omit `stream` for a producer (platform-function
ingest). Runs on every stock runtime: the output always streams through
`emit`, and every runner feeds the `stream` input lazily with O(segment)
decoded memory (segment-fed iteration and keyed reads; any other operation
on it decodes the whole value once). Ordinary indexed collection inputs of
any task open the same way by default once they reach 64 MiB on the wire —
`EAST_LAZY_INPUT_BYTES` overrides the threshold, `0` forces eager decodes —
and semantics are identical either way, so the threshold is a memory knob,
not a behavior toggle. Every input — including a mutation reducer's state —
decodes deeply frozen: task inputs are immutable, so mutating one raises
`cannot mutate a frozen value (task inputs are immutable) — copy first`
(`.copy()` first to derive a changed value), and frozen collections
compare by value under `East.is`. Frozen is also what makes lazy serving
safe for any element shape — only element types carrying a `Ref` or a
function decode whole, on every runtime.

```typescript
const events = e3.input('events', ArrayType(EventType));

// Global sequential state (running balances, event replay):
const balances = e3.streamTask('balances', {
  stream: events,
  output: ArrayType(BalanceType),
}, ($, events, emit) => {
  const balance = $.let(0.0);
  $.for(events, ($, event) => {
    $.assign(balance, balance.add(event.amount));
    $(emit({ at: event.at, balance }));
  });
});

// Producer (no stream input): loop over platform sources and emit — in any
// order, so keyed ingest can emit a Dict directly as rows arrive.
const ingest = e3.streamTask('ingest', {
  output: DictType(StringType, RowType),
}, ($, emit) => { /* fetch pages, $(emit(row.id, row)) each */ });
```

`emit` is `emit(key, value)` for Dict outputs and `emit(element)` for
Array/Set outputs, called in **any order**: ascending Set/Dict emission
streams straight to the output file, and out-of-order emission is sorted by
the sink (bounded-memory spill/merge, reported on stderr when it engages)
before the output is finalized — the stored dataset is always the canonical
collection, so a re-keying producer emits as it reads. Duplicate Dict keys /
Set elements are a runtime error.

#### Which task kind?

| Workload | Use |
|----------|-----|
| Fits in memory | `e3.task` |
| Row-local derive/clean/validate over a huge input | `partitionTask` |
| Enrich against small references | `partitionTask` + `inputs` |
| Enrich against another huge dataset (sparse keyed reads) | `partitionTask` + huge `inputs` entry (opened lazily) |
| Aggregate huge → small (KPIs, counts, top-k) | `partitionTask` + `combine` |
| Per-entity sequential, parallel across entities | `partitionTask` + `by` |
| Reconcile/delta two same-keyed huge datasets | `partitionTask`, 2+ `partitions` |
| Global sequential state (running balances, replay, simulation) | `streamTask` |
| Ingest from external sources | `streamTask` (no `stream`) |
| Filter/sample huge → still-big | `partitionTask` |
| Re-key huge → huge, one pass | `streamTask` (emit in any order; the sink sorts) |
| Re-key huge → huge, parallel (shuffle) | not yet — `combine`, `customTask`, or re-key upstream |
| ML training / genuinely non-East work | `customTask` |

### e3.customTask(name, inputs, outputType, command)

Define a task that runs a shell command.

```typescript
const process = e3.customTask(
  'process',
  [rawData],
  StringType,
  ($, input_paths, output_path) =>
    East.str`python script.py -i ${input_paths.get(0n)} -o ${output_path}`
);
```

### e3.function(name, fn, config?)

Define a named function: invoked by name with argument values (CLI `e3 call`
or HTTP API), result returned inline. Unlike a task it is NOT wired to
datasets, not part of the dataflow graph, and a call persists nothing —
e3's "stored procedure". The signature is inferred from the East function.

```typescript
const add = e3.function(
  'add',
  East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
);

// Runner selection — same typed Runner as tasks, including `{ custom: 'name' }`
// platform entries for a project-owned platform (only the `runtime: 'custom'`
// argv form is rejected for functions on the wire).
const forecast = e3.function(
  'forecast',
  East.function([IntegerType, FloatType], FloatType, ($, periods, rate) => ...),
  { runner: { runtime: 'east-py', platforms: ['east-py-datascience'] } }
);

const pkg = e3.package('planning', '1.0.0', someTask, add, forecast);
```

Use a task when the result should be a dataset others react to; use a
function for on-demand compute returned to the caller. Calls are
synchronous and bounded — the server enforces a wall-clock deadline and
results are capped at 1 MB inline; long compute and bigger outputs belong
in a task.

### e3.record(name, type, initialValue) + e3.mutation(name, record, fn)

A **record** is audited, mutable root state — e3's system of record. Unlike a
value (blind replace), a record is `writable: false` and changes only through
typed **mutations**: pure East reducers `(State, ...Args) => State` run
server-side under compare-and-swap. The state parameter is a frozen task
input — derive the new state from `state.copy()` (or build it fresh) rather
than mutating in place. Every mutation appends a commit
(parent, state, mutation, args, actor, at); deploy mints a `$init` genesis from
`initialValue`, and a redeploy preserves committed state + history (a type
change is rejected before any write). A record is a dataset (mounted at
`.records.${name}`), so tasks read it and react to it like any input — its
version vector carries the commit hash, so even an identical-state mutation
still triggers downstream.

```typescript
const counter = e3.record('counter', IntegerType, 0n);
const increment = e3.mutation(
  'increment', counter,
  // reducer: (state, ...args) => newState; in/out type == the record type
  East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)),
);
const pkg = e3.package('counters', '1.0.0', counter, increment);
```

Mutations are the only writer — a raw `e3 dataset set` on a record path is
rejected. Apply with `e3 mutate`, inspect with `e3 history`, drop history with
`e3 compact` (see CLI).

### e3.package(name, version, ...items)

Bundle into a package. Dependencies are collected automatically.

```typescript
const pkg = e3.package('myapp', '1.0.0', finalTask);
```

### e3.export(pkg, zipPath, options?)

Export package to a .zip file. Every `East.importFunction` in the package's
tasks, functions and mutations is resolved and embedded as pure IR after an
exact type check and a runner check of its platform dependencies: a package
of the uv or npm workspace is exported by the export itself;
`options.functions` lists manifests (paths, or decoded values) for packages
built elsewhere, and wins for its package.

```typescript
await e3.export(pkg, '/tmp/myapp.zip');
await e3.export(pkg, '/tmp/myapp.zip', { functions: ['./pricing.functions.beast2'] });
```

## CLI Reference

Every command that takes `<repo>` accepts a local path or an `http(s)://` URL — transport is detected from the argument. Where the `<repo>` positional is optional it falls back to `$E3_REPO`, then `.`.

### Repository

```bash
e3 repo create <repo>             # Create a new repository
e3 repo create <repo> --exist-ok  # Create, or succeed quietly if it already exists
e3 repo status <repo>             # Show repository status
e3 repo remove <repo> [-r]        # Remove a repository (-r to remove workspaces first)
e3 repo gc <repo> [--dry-run]     # Garbage collect unreferenced objects
e3 repo list <server-url>         # List repositories on a server
```

### Package

```bash
e3 package import <repo> <zipPath>       # Import from .zip
e3 package export <repo> <pkg> <zipPath> # Export to .zip
e3 package list <repo>                   # List packages
e3 package remove <repo> <pkg>           # Remove package
```

### Workspace

```bash
e3 workspace create <repo> <name>                     # Create workspace
e3 workspace deploy <repo> <ws> <pkg>[@<ver>]         # Deploy an imported package
e3 workspace deploy <repo> <ws> --from-zip <zip>      # Import + create + deploy in one shot
e3 workspace deploy <repo> <ws> --from-source <src.ts> # Bundle TS source + import + create + deploy
e3 workspace deploy <repo> <ws> --from-source <src.ts> --functions <manifest…>  # … plus manifests of imported packages built elsewhere (workspace ones resolve themselves)
e3 workspace export <repo> <ws> <zipPath>             # Export workspace as a package
e3 workspace list <repo>                              # List workspaces
e3 workspace status <repo> <ws>                       # Detailed status (tasks, datasets, locks)
e3 workspace remove <repo> <ws>                       # Remove workspace
```

### Dataset

Paths use the flat form `<ws>.<name>`. The resolver maps `<name>` to its storage location (input or task output) automatically — no `.tasks.X.output` / `.inputs.X` ceremony. Typos get `did you mean` suggestions.

```bash
e3 dataset get <repo> <ws.name> [-f east|json|beast2]
e3 dataset set <repo> <ws.name> <file> [--type <spec>] [--type-file <path>]
e3 dataset list <repo> <ws> [-l]            # List dataset paths (-l adds columns)
e3 dataset status <repo> <ws.name>          # Kind/type/status/size for one dataset
e3 dataset find <repo> <ws> <pattern>       # Substring or glob (`*`, `?`) match
```

```bash
e3 dataset get . dev.name      # an input
e3 dataset get . dev.greet     # a task output
e3 dataset set . dev.name data.east
```

### Records

Audited mutable state: a record is written only through its mutations (a raw
`dataset set` is rejected). `--workspace` is required — records are
workspace-scoped live state. Read the current value with `dataset get` like any
dataset.

```bash
e3 mutate <repo> <record.mutation> [args...] -w <ws> [-v]  # apply a mutation; args = .east literals or .beast2/.json/.east files; -v = runner timing/perf (local)
e3 history <repo> <record> -w <ws> [--limit <n>] [--from <hash>]  # commit chain, newest first (--from pages)
e3 compact <repo> <record> -w <ws>                    # collapse history to a $compact root (state preserved)
```

```bash
e3 mutate . counter.increment 5.east -w main   # state += 5
e3 history . counter -w main --limit 10
```

### Task

```bash
e3 task list <repo> <ws>                    # List tasks with execution status
e3 task logs <repo> <ws.task>               # Last 200 lines of a task's logs
e3 task logs <repo> <ws.task> -n 50         # Last 50 lines
e3 task logs <repo> <ws.task> --all         # The whole log
e3 task logs <repo> <ws.task> --follow      # Tail, then follow live output
```

### Dataflow

```bash
e3 dataflow run <repo> <ws> [--filter <p>] [--concurrency <n>] [--force] [-v]
```

After a successful run the output paths are printed in flat form, ready to read with `e3 dataset get`.

**`-v` / `--verbose`** forwards `-v` to each task's runner so it prints a
timing/perf block (Load / Compile / Execute / Output / Total + Peak RSS) — identical
across east-node, east-py and east-c — to the task's logs (`e3 task logs <repo>
<ws.task>`). Pure runtime toggle: it never changes task hashes or caching, so a
cached task stays cached with or without it (add `--force` to see the block for
an already-cached task). Same flag on `e3 run`, `e3 call`, and `e3 mutate` —
against **local and remote** repos (remote carries it as a `?verbose=1` query
param; a server's `e3 task logs` / the call response surfaces the block).

### Ad-hoc Run

```bash
e3 run <repo> <pkg.task> [inputs...] -o <output> [-v]  # task spec uses dots: pkg.task or pkg@1.0.0.task
```

### Call (named functions)

```bash
e3 call <repo> <pkg.fn> [args...] [-o out.beast2] [-v]  # function spec uses dots: pkg.fn or pkg@1.0.0.fn
e3 call <repo> -w <ws> <fn> [args...]                 # against a workspace's deployed package
```

Each argument is an `.east` literal (`5`, `"hello"`, `[1.0, 2.0]`) or a
`.beast2`/`.json`/`.east` file path, parsed against the declared parameter
type. The decoded result prints to stdout (or `-o` writes raw beast2).
Calls are graph-free: no datasets read or written, repository unchanged.

### Watch

```bash
e3 watch <source.ts> <repo> <ws> [--start] [--abort-on-change] [--functions <manifest…>]   # source file first
```

### Utilities

```bash
e3 convert [input] [--from <fmt>] [--to <fmt>] [-o <output>]
e3 completion install            # Detect $SHELL and wire up tab completion
e3 completion {bash|zsh|fish}    # Print the raw completion script
```

### Authentication (for remote servers)

```bash
e3 auth login <server>            # Log in using OAuth2 Device Flow
e3 auth logout <server>           # Log out and clear credentials
e3 auth status                    # List all saved credentials
e3 auth token <server>            # Print access token (for curl/debugging)
e3 auth whoami [server]           # Show current identity
```

### Remote URLs

All commands accept HTTP URLs instead of local paths:

```bash
# Start a server
e3-api-server --repos ./repos --port 3000

# Use remote repository
e3 repo create http://localhost:3000/repos/my-repo
e3 workspace list http://localhost:3000/repos/my-repo
e3 package import http://localhost:3000/repos/my-repo ./pkg.zip
```

## Development Workflow

### Watch Mode (recommended)

```bash
e3 watch ./src/index.ts . dev --start
```

Auto-compiles, deploys, and runs on file changes.

### Manual Workflow

```bash
npm run build && npm run main
e3 workspace deploy . dev --from-zip /tmp/pkg.zip
e3 dataflow run . dev
```

## Packages

| Package | Description |
|---------|-------------|
| `@elaraai/e3` | SDK: e3.input, e3.task, e3.package, e3.export |
| `@elaraai/e3-types` | Shared type definitions |
| `@elaraai/e3-core` | Core library (workspaces, execution, caching) |
| `@elaraai/e3-cli` | CLI tool |
| `@elaraai/e3-api-client` | HTTP client for remote servers |
| `@elaraai/e3-api-server` | REST API server |

## Project Structure

```
my-project/
├── package.json
├── tsconfig.json
├── pyproject.toml      # For Python runner
├── src/
│   └── index.ts        # Package definition
└── repo/               # Repository (created by e3 repo create)
    ├── objects/        # Content-addressable object store
    ├── packages/       # Package metadata
    └── workspaces/     # Workspace state
```

## Caching

Tasks are cached by content hash. Re-runs only when:
- Task's East function IR changes
- Input values change

A `partitionTask` is additionally memoized per partition: each carved slice
is its own content-addressed execution, so appends and tail-localized input
changes re-run only the affected partitions.

Use `--force` to bypass: `e3 dataflow run . dev --force`

## Related skills

- **east** — the language for task bodies (`e3.task` runs an `East.function`).
- **e3-create** — scaffold an e3 project: the `npm create @elaraai/e3` flags (`--runners`, `--platform`, `--python/node/c-packages`, `--ui`) and what each generates.
- **east-project** — drive the scaffolded project's build / deploy / run / watch / test lifecycle.
- **east-ui** + **e3-ui** — author dashboards and decision surfaces as `ui()` tasks bound to workspace datasets.
- **east-py-datascience** — ML / optimization tasks; set a Python runner (`{ runner: { runtime: 'east-py', platforms: ['east-py-datascience'] } }`).
- **east-py** — author Python `@platform_function`s that a `{ custom: '<pkg>' }` east-py task calls (the per-package Python environment e3 auto-derives).
- **east-node-io** / **east-node-std** — pull databases, storage, files, and HTTP into tasks; author your own east-node platform fns for `{ custom }` node-package tasks.
- **east-design** / **east-ontology** — plan the dataflow and model the business before building.
