---
name: e3
description: "East Execution Engine (e3) - durable dataflow execution for East programs. Use when: (1) Authoring e3 packages with @elaraai/e3 (e3.input, e3.task, e3.customTask, e3.function, e3.ui, e3.package, e3.export), (2) Bounded-memory dataflow over huge collection datasets (e3.streamTask emitting into e3.output.array/set/dict/fold, its work split over an input with e3.partition), (3) Records — audited state written only through mutations (e3.record, e3.mutation.reduce/edit/patch, e3.recordIndex) and migrated between package versions (e3.migration.value/rows/rekey), (4) Running e3 CLI commands (e3 repo, e3 workspace, e3 package, e3 dataset, e3 task, e3 dataflow run, e3 call, e3 mutate, e3 history, e3 watch, e3 auth), (5) Working with workspaces and packages, and the cores and memory a run may use (-j, --memory), (6) Content-addressable caching and reactive dataflow execution, (7) Calling functions authored in python, or in another node package, from a task (East.importFunction — a workspace member is exported and linked by e3.export itself; { functions } / --functions for one built elsewhere)."
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
import { East, StringType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';

// Define an input (its initial value is a source: inline, or a file)
const name = e3.input('name', StringType, variant('value', 'World'));

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
│   ├─ Input dataset        → e3.input(name, type, source?) — variant('value', v) | variant('file', path)
│   ├─ Record (audited state)→ e3.record(name, type, initial)
│   ├─ Mutation (reducer)    → e3.mutation.reduce(name, record, fn) — sees the whole state
│   ├─ Mutation (lazy write) → e3.mutation.edit(name, record, fn) — (state, …args, edit) => Null
│   ├─ Mutation (client diff)→ e3.mutation.patch(record) — the argument IS the change
│   ├─ Secondary index       → e3.recordIndex(name, record, { key | keys, value? })
│   ├─ A record's type changes between versions → e3.migration.value | rows | rekey(name, record, fn, { after? })
│   ├─ A task: does the output fit in memory, and can the work be split over an input?
│   │   ├─ Fits, built in one pass           → e3.task(name, [inputs], fn, config?) — returns the output
│   │   ├─ Too large to hold, or built as you go → e3.streamTask(name, { inputs, output }, fn) — emits into e3.output.array | set | dict | fold
│   │   └─ Split over an input, in pieces    → wrap that streamTask input: e3.partition(dataset, { by? })
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
│   └─ Garbage collect      → e3 repo gc <repo> [--dry-run] [--keep-runs <n>] [--keep-days <d>] — old runs and executions, then what nothing names
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
│   ├─ …a record that changed type   → [--schema migrate|fail|reset] [--allow-drop-records] [--plan] (see e3.migration)
│   ├─ List workspaces               → e3 workspace list <repo>
│   ├─ Inspect                       → e3 workspace status <repo> <ws>
│   ├─ Export as package             → e3 workspace export <repo> <ws> <zip>
│   └─ Remove                        → e3 workspace remove <repo> <ws>
│
├─ Running the dataflow
│   └─ Execute all tasks    → e3 dataflow run <repo> <ws> [--force] [-j <n>] [--memory <size>] [-v]
│
├─ Datasets (read / write values)
│   ├─ Read a value         → e3 dataset get <repo> <ws.name> [-f east|json|beast2]
│   ├─ Write a value        → e3 dataset set <repo> <ws.name> <file>
│   ├─ Adopt a .beast2 file  → e3 dataset set <repo> <ws.name> --from-file <path> (a segment at a time, never read whole)
│   ├─ List all paths       → e3 dataset list <repo> <ws> [-l]
│   ├─ Status (kind/type)   → e3 dataset status <repo> <ws.name>
│   └─ Search               → e3 dataset find <repo> <ws> <pattern>
│
├─ Records (audited mutable state — mutations only, no raw set)
│   ├─ Apply a mutation     → e3 mutate <repo> <record.mutation> [args...] -w <ws>
│   ├─ Commit history       → e3 history <repo> <record> -w <ws> [--limit n] [--from hash] [--delta]
│   ├─ Rebuild an index     → e3 reindex <repo> <record> -w <ws> [--index <name>]
│   └─ Compact history      → e3 compact <repo> <record> -w <ws>
│
├─ Tasks (inspect / logs)
│   ├─ List with status     → e3 task list <repo> <ws>
│   └─ View / follow logs   → e3 task logs <repo> <ws.task> [-n <lines>] [--all] [--follow] [--execution <taskHash>/<inputsHash>/<executionId>]
│
├─ Development workflow
│   ├─ Watch + auto-deploy  → e3 watch <src.ts> <repo> <ws> [--start] [--schema <policy>]
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

### e3.input(name, type, source?)

Define an input dataset. Addressed from the CLI as `<ws>.${name}` (storage path `<ws>/inputs/${name}` is internal).

The third argument is always a **source variant** — there is no bare-value form:

| Source | Meaning |
|---|---|
| `variant('value', v)` | An inline value, carried in the package. |
| `variant('file', path)` | A beast2 file on the machine that **deploys** the package. The package carries only the path; deploy takes the file into the object store as the value it holds — a collection a segment at a time, as the store's own segment objects; any other value by reflink, hard link or one kernel copy. Never read whole, never modified. Relative paths resolve against the working directory at export. |
| omitted | Unassigned until something sets it. |

```typescript
const name = e3.input('name', StringType, variant('value', 'default'));
const count = e3.input('count', IntegerType);
// A large delivery — the file IS the value: a new delivery under the same path
// is a new hash, so only its consumers re-run (and a stream task split over it
// re-runs only the pieces whose rows changed).
const table = e3.input('table', ArrayType(RowType), variant('file', './deliveries/TABLE.beast2'));
```

A `file` source is checked twice against the declared type: at `e3.export`
(a schema drift is a build error naming the input and the first differing
field) and at deploy, before the workspace is touched (a missing or drifted
delivery fails the deploy with the previous deployment intact). A collection
delivery may be in any layout a beast2 writer produces — segmented or encoded
whole, indexed or not — so long as no segment of it is larger than a collection
is read in at once (64 MiB): a large value encoded whole is one such segment,
refused with a message to write it segmented, the Writer's default. The store
cuts a delivery into its own segments, so a new delivery that differs from the
last in a few rows stores only the segments around them, and the same bytes
delivered again are not read a second time. Any other value's object may be a
hard link to the file, so replace a delivery with a new file rather than
editing it in place.

A `file` source is read on the machine that runs `e3 workspace deploy`, local
repository or not. Against a server — a package spec, `--from-zip` or
`--from-source` alike — the CLI checks every delivery before it touches the
remote workspace, then streams each over the transfer protocol after the
deploy (an unchanged delivery costs a round trip, not its bytes). The server
never opens a path, so a deploy made straight through the API leaves those
inputs unset. `--skip-file-sources` deploys without reading them and prints the
`e3 dataset set <repo> <ws>.<name> --from-file <path>` that completes each.

Every door into a dataset — `e3 dataset set`, the API `PUT`, the transfer
commit, a file adopt — checks the bytes' wire type **equals** the declared type
(not merely assignable: runners decode by the declared type) and refuses a
mismatch before writing anything, with the same one-line message everywhere.


### e3.task(name, inputs, fn, config?)

Define a task that runs an East function once, as one unit, and returns its
output. A collection it returns is written segment by segment, but the body
builds it whole: an output too large to hold is emitted instead
(`e3.streamTask`, below).

Task inputs (every task kind, a mutation's state included) decode **deeply
frozen** on every runtime — mutating one raises `cannot mutate a frozen value
(task inputs are immutable) — copy first`; derive changed values from
`.copy()`, and frozen collections compare by value under `East.is`. Collection
inputs open **lazily** once they reach 64 MiB (`EAST_LAZY_INPUT_BYTES` sets the
threshold, `0` decodes every input whole): size, iteration and keyed gets are
served a segment at a time, with no whole decode, and semantics are the same
either way, so the threshold is a memory knob, not a behaviour toggle. The only
element shapes that still decode whole are those carrying a `Ref` or a
function; an operation the pager cannot serve reads the value whole once,
transparently.

Datasets stay inputs — the lazy open is already there, and only a dataset
takes part in the dataflow's hashing and reactivity. A large table delivered as
a beast2 file becomes a dataset with `e3.input(name, T, variant('file', path))`
(above), not a String path plus an open inside the body. Two in-expression
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

// Custom argv (e.g. wrapping east-py with uv). e3 runs the command with `run`'s
// arguments appended — `-i <input>` for each input, `-o <output>`, then the
// program's file — where a stock runner is handed one unit file (`exec <unit>`).
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
  East.function([StringType], StringType, ($, s) => s.upperCase())
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

### e3.streamTask(name, spec, fn)

A stream task **emits** its output instead of returning it, into an output
kind that fixes `emit`'s signature and how the parts of the output combine.
Emission order is free: the runner sorts a set or a dict in runs of bounded
size and merges them, so a body never builds its output, and its memory does
not grow with the output.

```typescript
const events = e3.input('events', ArrayType(EventType));

// Global sequential state (running balances, event replay): with no
// partitioned input, the task is one unit with exact left-to-right semantics.
const balances = e3.streamTask('balances', {
  inputs: [events],
  output: e3.output.array(BalanceType),
}, ($, events, emit) => {
  const balance = $.let(0.0);
  $.for(events, ($, event) => {
    $.assign(balance, balance.add(event.amount));
    $(emit({ at: event.at, balance }));
  });
});

// A producer has no inputs: it loops over platform sources and emits, in any
// order — a keyed output is sorted for it.
const ingest = e3.streamTask('ingest', {
  inputs: [],
  output: e3.output.dict(StringType, RowType),
}, ($, emit) => { /* fetch pages, $(emit(row.id, row)) each */ });
```

| Output kind | `emit` | The parts combine by |
|---|---|---|
| `e3.output.array(T)` | `emit(t)` | concatenation: emission order within a unit, units in input order |
| `e3.output.set(T)` | `emit(t)` | union: an element emitted twice is held once |
| `e3.output.dict(K, V, { merge? })` | `emit(k, v)` | key: a key emitted more than once folds with `merge($, key, a, b)`, in input order; without `merge` a repeated key fails the task, naming it |
| `e3.output.fold(T, { zero, combine })` | `emit(t)` | every value emitted, folded with `combine($, a, b)` from `zero` in input order; the output is the result |

Spec fields: `inputs` (datasets, in the body's parameter order; an input
wrapped in `e3.partition` is one the work is split over, below), `output` (an
output kind), `runner` (a stock runtime — the `custom` one runs only a program
that returns its output) and `environment`. The body takes the inputs, then
`emit`, and returns nothing.

### e3.partition(dataset, { by? }) — split the work over an input

Wrap a stream task's input in `e3.partition` and the body runs once per
**piece** of it, each piece a unit of its own — cached on its own, and run in
parallel under the budget — typed as the whole dataset: a key range of a Set or
Dict, a position range of an Array. The pieces' outputs combine as the output
kind says. Pieces are cut where the content says, most of them 64 to 100 MiB of
stored bytes, so an append or an insertion re-runs only the pieces it reaches;
the rest are served from the cache.

```typescript
const sales = e3.input('sales', DictType(SaleKeyType, SaleType));
const rates = e3.input('rates', DictType(StringType, FloatType));

// Per-key totals — a re-key, since the output key is not the input's: a key
// emitted more than once, in a piece or across pieces, folds with `merge`.
const bySku = e3.streamTask('by_sku', {
  inputs: [e3.partition(sales), rates],   // `rates` reaches every piece whole, lazily when large
  output: e3.output.dict(StringType, FloatType, { merge: ($, _sku, a, b) => a.add(b) }),
}, ($, sales, rates, emit) => {
  $.for(sales, ($, sale, key) => {
    $(emit(key.sku, sale.amount.multiply(rates.get(sale.currency))));
  });
});

// Huge → small: a fold.
const revenue = e3.streamTask('revenue', {
  inputs: [e3.partition(sales)],
  output: e3.output.fold(FloatType, { zero: 0.0, combine: ($, a, b) => a.add(b) }),
}, ($, sales, emit) => {
  $.for(sales, ($, sale) => { $(emit(sale.amount)); });
});

// Per entity, in order: rows whose `by` fields are equal are never split across
// pieces, so each piece holds whole accounts, in key order.
// (postings: a Dict keyed by { account, at, id })
const statements = e3.streamTask('statements', {
  inputs: [e3.partition(postings, { by: ['account'] })],
  output: e3.output.array(StatementLineType),
}, ($, postings, emit) => { /* a running balance per account */ });

// Reconcile two same-keyed datasets: both partitioned, cut at the same keys.
const delta = e3.streamTask('delta', {
  inputs: [e3.partition(today), e3.partition(yesterday)],
  output: e3.output.dict(SaleKeyType, FloatType),
}, ($, today, yesterday, emit) => { /* compare the two pieces */ });
```

- `by` names leading key fields, in order: `['account']`, or `['account', 'at.day']`, whose last entry reads the first field of `at`. It is data, checked against the key type when the task is defined.
- Two or more partitioned inputs are cut at the same keys, so they must be Sets or Dicts whose keys, or whose `by` fields, have the same types.
- An input not wrapped reaches every piece whole, opened lazily when large, so a keyed get reads only the segments it reaches. A change to it re-runs every piece.
- **The author's contract**, the only one: `merge` and `combine` are associative, `zero` is an identity of `combine`, and a partitioned body's combined result does not depend on where its input was cut.
- Refused when the task is defined, naming it: `e3.partition` on an `e3.task` input or of a value that is not a collection, a `by` naming anything but leading key fields, and co-partitioned inputs with no common key.

#### Which task?

Two questions: does the output fit in memory, and can the work be split over
an input?

| Workload | Use |
|----------|-----|
| The output fits in memory, computed in one pass | `e3.task` |
| Global sequential state: running balances, replay, simulation | `e3.streamTask` with no partitioned input |
| Ingest from external sources | `e3.streamTask` with no inputs, emitting in any order |
| Row-local derive, clean or validate over a huge input | `e3.partition` it and emit each row kept (`e3.output.array`, or a `dict` keyed as the input) |
| Enrich against a small reference, or sparse keyed reads of another huge dataset | `e3.partition` the big input, and pass the other unwrapped |
| Aggregate huge → small (KPIs, counts, top-k) | `e3.partition` + `e3.output.fold` |
| Per-key totals, latest per key, entity rollups, a re-key (shuffle) | `e3.partition` + `e3.output.dict` with `merge` (a Set: `e3.output.set`) |
| Per entity, sequential within it, parallel across entities | `e3.partition(dataset, { by: [<leading key fields>] })` |
| Reconcile two same-keyed huge datasets | two `e3.partition` inputs |
| ML training, or work East cannot express | `e3.customTask` |

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

### e3.record(name, type, initialValue) + e3.mutation.reduce(name, record, fn)

A **record** is audited, mutable root state — e3's system of record. Unlike a
value (blind replace), a record is `writable: false` and changes only through
typed **mutations**: pure East reducers `(State, ...Args) => State` run
server-side under compare-and-swap. The state parameter is a frozen task
input — derive the new state from `state.copy()` (or build it fresh) rather
than mutating in place. Every mutation appends a commit
(parent, state, mutation, args, actor, at); deploy mints a `$init` genesis from
`initialValue`, and a redeploy keeps committed state and history, running the
record's migrations the workspace has not applied (`e3.migration`, below). A
record is a dataset (mounted at `.records.${name}`), so tasks read it and react
to it like any input — its version vector carries the commit hash, so even an
identical-state mutation still triggers downstream.

```typescript
const counter = e3.record('counter', IntegerType, 0n);
const increment = e3.mutation.reduce(
  'increment', counter,
  // reducer: (state, ...args) => newState; in/out type == the record type
  East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)),
);
const pkg = e3.package('counters', '1.0.0', counter, increment);
```

Mutations are the only writer — a raw `e3 dataset set` on a record path is
rejected. Apply with `e3 mutate`, inspect with `e3 history`, drop history with
`e3 compact` (see CLI).

### The three write forms

Every form commits the same thing — a **mutation delta**, the record's and each
index's changes addressed by key — which the engine applies by rewriting only
the segments those keys fall in. They differ in how the author says what
changed, and so in what a write costs.

| Form | Body | Reach for it when |
|---|---|---|
| `e3.mutation.reduce(name, rec, fn)` | `(state, …args) => state` | the rule is over the whole state, or the record is small |
| `e3.mutation.edit(name, rec, fn)` | `(state, …args, edit) => Null` | server-side logic touches a few entries of a large record |
| `e3.mutation.patch(rec, name?)` | none — the argument is `PatchType(state)` | an interactive edit from a view, or an integration that sends diffs |

`edit` and `patch` write a delta addressed by key, so they take a Dict or Set
record; any other record takes `reduce`, whose reducer returns the whole state.

A reducer sees the whole state, so its cost in the runner is the record's size
however little it changes. An **edit** body reads the state lazily and writes
through `edit.set(key, value)` / `edit.delete(key)` / `edit.update(key, patch)`,
so the body decodes only the entries it reads and the commit rewrites only the
segments its keys fall in. The record still reaches the runner as a stream of
its segments: a write moves the record's bytes, one segment at a time, but
never holds them. Repeated edits of one key fold; a `set` of the value a row
already holds changes nothing; and a `delete` or `update` of a key the record
does not hold is a conflict naming the key — the caller's view of the record is
stale. A **patch** mutation has no body at all — on a record with no index
nothing runs, which makes it the form to use for interactive latency at any
record size.

```typescript
const PlanType = StructType({
  title: StringType, owner: StringType, status: StringType,
  due: DateTimeType, resources: SetType(StringType),
});
const plans = e3.record('plans', DictType(StringType, PlanType), new Map());

// `edit` is typed from the record: edit.set(key, row), edit.delete(key),
// edit.update(key, patch) — each checked against the record's key and row.
const reschedule = e3.mutation.edit('reschedule', plans,
  East.function([plans.type, StringType, DateTimeType, e3.mutation.editType(plans.type)], NullType,
    ($, state, id, due, edit) => {
      const plan = $.let(state.get(id));       // one segment decoded, not the record
      $(edit.set(id, { title: plan.title, owner: plan.owner, status: plan.status, due, resources: plan.resources }));
    }));

const pkg = e3.package('planning', '1.0.0', plans, reschedule, e3.mutation.patch(plans));
```

`e3.mutation.editType(recordType)` is the edit capability's type — the struct of three
East functions an edit body declares as its last parameter.

Costs are counted in segments. A Dict or Set record is cut into segments by
key, and the cut weighs each entry's encoded size as well as counting it: narrow
rows share a segment with many others, while rows that carry large blobs or big
nested collections get segments of a few rows, down to one row each. Reading or
rewriting a row costs its segment, so a one-row edit stays cheap however wide
the rows are. A view that pages a record still reads every field of each row it
shows, so keep a bulky payload the view does not display in a second record
keyed the same way.

### e3.recordIndex(name, record, spec)

A record is paged and searched in its primary key order and nothing else. An
index is a **second canonical collection whose sort order IS the query order**,
stored and read exactly like the record, and maintained inside the same commit —
so a view by an attribute of the row, or by a related entity a row names many
of, is a page rather than a scan.

An index is declared over a Dict record. Declare exactly one of `key` (one
entry per row) or `keys` (a `Set` return: one
entry per element, so a row naming five resources appears under five keys; an
empty set is a row the index does not carry). An optional `value` projection is
what a view renders from the index alone, without touching the record.

```typescript
const StatusKeyType = StructType({ status: StringType, due: DateTimeType });

const byStatus = e3.recordIndex('by_status', plans, {
  key:   East.function([StringType, PlanType], StatusKeyType,
           ($, k, v) => ({ status: v.status, due: v.due })),
  value: East.function([StringType, PlanType], StringType, ($, k, v) => v.title),
});
const byResource = e3.recordIndex('by_resource', plans, {
  keys: East.function([StringType, PlanType], SetType(StringType), ($, k, v) => v.resources),
});

const pkg = e3.package('planning', '1.0.0', plans, byStatus, byResource);
```

The functions must be pure and synchronous: an index is maintained on every
commit and rebuilt on demand, and the two must agree to the byte. `primary` is
reserved — it names the record's own collection wherever an index is selected.
Read through one by passing `index=<name>` to a dataset page, or rebuild one
with `e3 reindex`.

A deploy reconciles indexes by itself — one the package declares and the state
does not hold is BUILT, one the state holds and the package does not is
DROPPED, one that matches is kept and nothing runs — and says which as it goes.
A build is a stream task split over the record: each piece emits its entries,
and the pieces' outputs merge by key range, so a build over a record of any size
holds a piece at a time. Every unit is an ordinary cached execution, so
rebuilding over an unchanged record runs nothing at all.

### e3.migration.value | rows | rekey(name, record, fn, config?)

A record's type changes between package versions only through migrations:
steps a deploy runs over each workspace's state, in order, recording each by
its name so it runs once per workspace. Each step names the one before it with
`after`, and `e3.package` folds a record's steps into one chain — passing the
last step passes the chain. The last step must leave the record as its
declared type.

| Form | Function | Runs as |
|---|---|---|
| `e3.migration.value` | `(Old) => New`, over any record | one unit, whose runner opens the state lazily |
| `e3.migration.rows` | a Dict's rows, `(K, V1) => V2` with the keys unchanged, or an Array's elements, `(T1) => T2` in order | a task split over the state: a piece at a time, in parallel, each piece cached |
| `e3.migration.rekey` | a Dict's entries, `(K1, V1) => { key: K2, value: V2 }`, or a Set's elements, `(T1) => T2` | the same split task, its pieces' outputs merged by key. Two rows of a Dict landing on one key fail the deploy, naming it; two Set elements landing on one are one element |

```typescript
const RowV1Type = StructType({ title: StringType });
const RowV2Type = StructType({ title: StringType, owner: StringType });
const plans = e3.record('plans', DictType(StringType, RowV2Type), new Map());

const addOwner = e3.migration.rows('add_owner', plans,
  East.function([StringType, RowV1Type], RowV2Type,
    ($, id, row) => ({ title: row.title, owner: 'unassigned' })));
// A later version adds its step after this one: e3.migration.value('…', plans, fn, { after: addOwner })

const pkg = e3.package('planning', '2.0.0', plans, addOwner);
```

Each function is pure, synchronous East, as a mutation's is: a step runs again
in every workspace that has not applied it. A step's name is an identifier,
unique on its record, and identifies the step once it is applied — so moving
its code, or re-exporting the package with a newer e3, does not run it again,
and an edit to an applied step's body is not detected.

**What a deploy does with each record**, decided before it writes anything:

| The workspace holds | Against the package's chain | The deploy |
|---|---|---|
| no state | — | mints `$init` from the initial value; the whole chain counts as applied |
| state | every step applied, the type unchanged | keeps it, with a `$deploy` commit when the package changed |
| state | a proper prefix applied | runs the rest, a `$migrate:<name>` commit each |
| state | every step applied, but the type changed | refused: a type change needs a migration, or `--schema=reset` |
| state | applied steps the chain does not start with | refused, naming the steps applied and the steps declared |
| a record the package no longer declares | — | refused unless `--allow-drop-records` |

`--schema <policy>` on `e3 workspace deploy` and `e3 watch` says what to do
with a record that cannot be kept as it is: `migrate` (the default), `fail`
(run no migration, and refuse), or `reset` (reset it to the package's initial
value, with a `$reset` commit). `--plan` prints what the deploy would do to
each record and index, and writes nothing: from a zip or a source it imports
nothing, reading the package from the zip where it is, and a server, which
plans only a package it holds, refuses one — `e3 package import` the zip, then
plan the package by name. The steps run before the deploy
writes, so a failed step leaves the workspace as it was, and a deploy run again
is served the steps that finished from the execution cache while their code has
not moved. `e3 watch` fails on a type change, naming `--schema=reset`.

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
e3 repo gc <repo> [--dry-run] [--keep-runs <n>] [--keep-days <d>]  # Drop old runs and executions, then what nothing names
e3 repo list <server-url>         # List repositories on a server
```

`repo gc` bounds the history a repository keeps before it removes what nothing
names. It keeps each workspace's last 10 runs (`--keep-runs`), every run from
the last 7 days (`--keep-days`) and the run its current state came from, with
every execution those runs used; every execution a workspace's current state is
served from, so a re-run stays cached; every execution from the last 7 days;
and whatever is running. `--dry-run` reports what would go.

### Package

```bash
e3 package import <repo> <zipPath>       # Import from .zip
e3 package export <repo> <pkg> <zipPath> # Export to .zip
e3 package list <repo>                   # List packages
e3 package remove <repo> <pkg>           # Remove package
```

A zip names the release of e3 that exported it, and an import refuses a zip a
newer release exported, naming that release: import it with an e3 at least as
new as the SDK that exported it.

### Workspace

```bash
e3 workspace create <repo> <name>                     # Create workspace
e3 workspace deploy <repo> <ws> <pkg>[@<ver>]         # Deploy an imported package
e3 workspace deploy <repo> <ws> --from-zip <zip>      # Import + create + deploy in one shot
e3 workspace deploy <repo> <ws> --from-source <src.ts> # Bundle TS source + import + create + deploy
e3 workspace deploy <repo> <ws> --from-source <src.ts> --functions <manifest…>  # … plus manifests of imported packages built elsewhere (workspace ones resolve themselves)
e3 workspace deploy <repo> <ws> … --skip-file-sources  # Any mode: leave `file`-source inputs unset (prints the dataset set that completes each)
e3 workspace deploy <repo> <ws> … --schema <policy>     # A record that cannot be kept as it is: migrate (default), fail, or reset
e3 workspace deploy <repo> <ws> … --allow-drop-records  # Drop a record the package no longer declares, with its state and history
e3 workspace deploy <repo> <ws> … --plan                # Say what the deploy would do to each record and index; write nothing
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
e3 dataset set <repo> <ws.name> --from-file <path.beast2>  # streamed SHA-256, header checked; a collection re-cut a segment at a time (bytes seen before cost their hash), anything else linked/copied
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
e3 history <repo> <record> -w <ws> [--limit <n>] [--from <hash>] [--delta]  # commit chain, newest first (--from pages; --delta counts what each commit changed, per target)
e3 reindex <repo> <record> -w <ws> [--index <name>]   # rebuild a secondary index from the record (all of them by default)
e3 compact <repo> <record> -w <ws>                    # collapse history to a $compact root (state preserved)
```

```bash
e3 mutate . counter.increment 5.east -w main   # state += 5
e3 mutate . plans.patch ./edit.beast2 -w main  # a patch mutation's one argument IS the change
e3 history . counter -w main --limit 10
e3 history . plans -w main --delta             # …with +inserts ~updates -deletes per target
```

### Task

```bash
e3 task list <repo> <ws>                    # List tasks with execution status
e3 task logs <repo> <ws.task>               # Last 200 lines of a task's logs
e3 task logs <repo> <ws.task> -n 50         # Last 50 lines
e3 task logs <repo> <ws.task> --all         # The whole log
e3 task logs <repo> <ws.task> --follow      # Tail, then follow live output
e3 task logs <repo> <ws.task> --execution <taskHash>/<inputsHash>/<executionId>   # One execution's own log — a piece or merge unit, as a split task's log names it on its `piece n/N …` or `merge level …` line (local repositories)
```

### Dataflow

```bash
e3 dataflow run <repo> <ws> [--filter <p>] [-j <n>] [--memory <size>] [--force] [-v]
```

After a successful run the output paths are printed in flat form, ready to read with `e3 dataset get`.

**`-j` / `--jobs <n>` and `--memory <size>`** are the budget of the runner
processes e3 spawns. `-j` is its cores: the runners in flight at once, a task
or a unit each — the pieces and merge units of split tasks alike. `--memory` is
the memory they may reserve between them, as `8G` or `512M`. Defaults:
`E3_JOBS` and `E3_MEMORY`, else what e3 may use (the CPUs of its affinity mask,
capped by a cgroup quota; the cgroup's `memory.max` or physical memory, less a
reserve for e3 and the OS). A unit of a split task reserves the largest peak a
unit of its stage has reached in the run, so a stage runs its first unit alone
and then fans out; on Linux and macOS a guard stops the newest such unit when
the runners together pass the budget, and runs it again once there is room.
`e3 watch`, `e3 run`, `e3 call`, `e3 mutate`, `e3 reindex` and `e3 workspace
deploy` take the same flags for a local repository; against a server they are
refused, since it runs the work under its own budget (`e3-api-server -j` /
`--memory`).

**`E3_SCRATCH_DIR`** names the directory a local run's per-execution scratch
directories (inputs marshalled, the output written before it is stored) are
created under — `<repo>/tmp/scratch` when unset, on the object store's own
disk. Set it only to move scratch to another disk: one on tmpfs holds each
output in memory until it is stored. A scratch directory left by a dead process
is removed by the next run or `e3 repo gc`.

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
e3 watch <source.ts> <repo> <ws> [--start] [--schema <policy>] [-j <n>] [--memory <size>] [--abort-on-change] [--functions <manifest…>]   # source file first
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
| `@elaraai/e3` | SDK: e3.input, e3.task, e3.streamTask, e3.record, e3.package, e3.export |
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
    ├── repository.beast2  # The repository record: the release that last wrote it, and the upgrades a newer e3 applies on open
    ├── objects/        # Content-addressed objects: values, segments, manifests, programs
    ├── packages/       # Package refs
    ├── workspaces/     # Each workspace's state and dataset refs
    ├── dataflows/      # Run records
    ├── executions/     # Execution attempts: status, owner, logs
    ├── locks/          # Locks and their holders
    └── tmp/            # Scratch and staged uploads
```

## Caching

Tasks are cached by content hash. Re-runs only when:
- Task's East function IR changes
- Input values change

A stream task split over an input is cached a unit at a time: each piece is
its own content-addressed execution, and so is each merge of their outputs, so a
re-run after an append or an insertion runs only the pieces it touched and the
merges they reach. Pieces are cut by content, so an insertion in the middle
moves only the pieces around it.

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
