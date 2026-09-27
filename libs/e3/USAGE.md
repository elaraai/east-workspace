# e3 User Guide

Usage guide for e3 (East Execution Engine) - a durable, content-addressable execution engine for East programs.

e3 provides git-like task management with cryptographic content addressing, allowing you to define dataflow pipelines that execute across multiple runtimes (Node.js, Python and C).

---

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [SDK Reference](#sdk-reference)
- [CLI Reference](#cli-reference)
  - [Remote URLs](#remote-urls)
- [Project Setup](#project-setup)
- [Development Workflow](#development-workflow)
- [File Formats](#file-formats)

---

## Quick Start

### 1. Create a package

```typescript
// src/index.ts
import { East, IntegerType, StringType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';

// Define an input, initialised with an inline value
const name = e3.input('name', StringType, variant('value', 'World'));

// Define a task that uses the input
const greet = e3.task(
  'greet',
  [name],
  East.function([StringType], StringType, ($, n) =>
    East.str`Hello, ${n}!`
  )
);

// Bundle into a package
const pkg = e3.package('hello', '1.0.0', greet);

// Export for CLI import
await e3.export(pkg, '/tmp/hello.zip');
export default pkg;
```

### 2. Deploy and run

```bash
# Create a repository
e3 repo create .

# Import the package
e3 package import . /tmp/hello.zip

# Create a workspace and deploy
e3 workspace create . dev
e3 workspace deploy . dev hello@1.0.0

# Execute the dataflow
e3 dataflow run . dev

# Check the output
e3 dataset get . dev.greet
# Output: "Hello, World!"

# Change the input and re-run
e3 dataset set . dev.name name.east  # file containing: "Alice"
e3 dataflow run . dev
e3 dataset get . dev.greet
# Output: "Hello, Alice!"
```

### 3. Watch mode (development)

```bash
# Auto-deploy and run on file changes
e3 watch ./src/index.ts . dev --start
```

---

## Core Concepts

### Package

An immutable collection of inputs, tasks, and their compiled East IR. Created with `e3.package()` and exported to a `.zip` file.

### Workspace

A mutable environment where a package is deployed. Workspaces hold:
- Input dataset values (can be modified)
- Task outputs (computed by running tasks)
- Execution state and cache

### Task

A computation that reads input datasets and produces an output dataset. Tasks are defined with `e3.task()` using an East function that returns the output, `e3.streamTask()` for one that emits it — its work split over a large input with `e3.partition()` — or `e3.customTask()` for shell commands.

### Record

Audited state, written only through its mutations. Each mutation is a commit, and the record reads like any other dataset, so tasks react to it.

### Dataflow

The DAG of tasks and their dependencies. When you run `e3 dataflow run`, tasks execute in dependency order. Cached results are reused when inputs haven't changed.

[How runs work](docs/HOW_RUNS_WORK.md) follows one run over very large collections from start to finish: how its data moves, how its work is split and scheduled, and where records and functions fit.

### Content Addressing

All objects (IR, data, results) are stored by SHA256 hash. This enables:
- Automatic deduplication
- Cache invalidation when content changes
- Integrity verification

---

## SDK Reference

### `e3.input(name, type, source?)`

Defines an input dataset. CLI users address it as `<ws>.${name}`; the on-disk storage path is `<ws>/inputs/${name}` but you never have to type that — the resolver handles the mapping.

The third argument says where the initial value comes from, and is always a variant:

- `variant('value', v)` — an inline value, carried in the package.
- `variant('file', path)` — a beast2 file on the machine that deploys the package. Only the path travels in the package; `e3 workspace deploy` takes the file into the object store as the value it holds — a collection a segment at a time, stored as the store's own segment objects; any other value by a reflink, hard link or one kernel copy. The file is never read whole and never modified. Relative paths resolve against the working directory at export.
- omitted — unassigned until set.

```typescript
import { StringType, IntegerType, ArrayType, variant } from '@elaraai/east';

// With an inline initial value
const name = e3.input('name', StringType, variant('value', 'World'));

// Without one (must be set before running)
const count = e3.input('count', IntegerType);

// Complex types
const items = e3.input('items', ArrayType(StringType), variant('value', ['a', 'b', 'c']));

// A large delivery: the file IS the value. A new delivery under the same path
// is a new hash, so only its consumers re-run — and a stream task split over it
// re-runs only the pieces whose rows changed.
const table = e3.input('table', ArrayType(RowType), variant('file', './deliveries/TABLE.beast2'));
```

A `file` source is validated against the declared type at `e3.export` and
again at deploy, before the workspace is touched: a missing file, one that is
not beast2, or a header whose type differs from the declared one fails with the
input's name, both types and the first differing field.

A collection delivery may be in any layout a beast2 writer produces — segmented
or encoded whole, indexed or not — so long as no segment of it is larger than a
collection is read in at once (64 MiB); a large value encoded whole is one such
segment, and is refused with a message saying to write it segmented, the
Writer's default. The store cuts the delivery into its own segments, so a new
delivery that differs from the last in a few rows stores only the segments
around them, and the same bytes delivered again are not read a second time.
Any other value's object may be a hard link to the file, so publish a new file
rather than editing one in place.

The file is read on the machine that runs `e3 workspace deploy`, whichever
repository it deploys to. Against a remote repository — a package spec,
`--from-zip` or `--from-source` — the CLI checks every delivery before it
touches the remote workspace and streams each over the transfer protocol after
the deploy; an unchanged delivery costs a round trip, not its bytes. The server
never opens a path, so a deploy made straight through the API leaves those
inputs unset. `--skip-file-sources` deploys without reading them and prints the
`e3 dataset set <repo> <ws>.<name> --from-file <path>` that completes each.

A bare third argument (`e3.input('name', StringType, 'World')`) is refused at
definition time: once the type is `StringType`, a value and a path cannot be
told apart.

### `e3.task(name, inputs, fn, config?)`

Defines a task that runs an East function.

```typescript
import { East, IntegerType, StringType } from '@elaraai/east';

// Task with no inputs
const constant = e3.task(
  'constant',
  [],
  East.function([], IntegerType, ($) => {
    $.return(42n);
  })
);

// Task that depends on an input
const greet = e3.task(
  'greet',
  [name],  // input defined above
  East.function([StringType], StringType, ($, n) =>
    East.str`Hello, ${n}!`
  )
);

// Task that depends on another task's output
const shout = e3.task(
  'shout',
  [greet.output],
  East.function([StringType], StringType, ($, greeting) =>
    East.str`${greeting.upperCase()}!!!`
  )
);

// Default runner is east-node + @elaraai/east-node-std — every e3 project
// already has Node, so this resolves with no extra setup.

// Override with a typed runner — discriminated union of stock runtimes
// (east-py, east-node, east-c) plus a `custom` escape hatch for raw argv.
const pyTask = e3.task(
  'py_task',
  [someInput],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'east-py', platforms: ['east-py-std'] } }
);

// east-c — native binary, lowest overhead for pure compute.
const fast = e3.task(
  'fast',
  [someInput],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'east-c', platforms: ['east-c-std'] } }
);

// Same effect via the custom escape hatch (uv-wrapped east-py):
const wrapped = e3.task(
  'wrapped',
  [someInput],
  East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
  { runner: { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] } }
);
```

### `e3.streamTask(name, spec, fn)`

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

### `e3.partition(dataset, { by? })` — split the work over an input

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

### `e3.customTask(name, inputs, outputType, command)`

Defines a task that runs a shell command instead of an East function.

```typescript
import { East, StringType, ArrayType } from '@elaraai/east';

const processData = e3.customTask(
  'process',
  [rawData],
  StringType,
  ($, input_paths, output_path) =>
    East.str`python process.py -i ${input_paths.get(0n)} -o ${output_path}`
);
```

### `e3.function(name, fn, config?)`

Define a named function — invoked by name with argument values, result
returned inline to the caller. Unlike a task it is not wired to datasets and
is not part of the dataflow graph; calling it writes nothing to the
repository. Think "stored procedure" for on-demand compute.

```typescript
const add = e3.function(
  'add',
  East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))
);

const pkg = e3.package('myapp', '1.0.0', someTask, add);
```

The signature (parameter and return types) is inferred from the East
function. The optional `config.runner` selects a known runtime
(`east-node`, `east-py`, `east-c`) — the raw-argv `custom` runtime is not
available for functions. Results are returned inline and capped (1 MB by
default over the API); results that don't fit belong in a task output
dataset instead.

### Records: `e3.record`, `e3.mutation.*`, `e3.recordIndex`, `e3.migration.*`

A record is audited state: written only through its mutations, each a commit
(parent, state, mutation, arguments, actor, time), and read like any dataset at
`.records.<name>`, so tasks react to it.

```typescript
import { DictType, East, IntegerType, NullType, StringType, StructType } from '@elaraai/east';

const counter = e3.record('counter', IntegerType, 0n);
const increment = e3.mutation.reduce('increment', counter,
  East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)));

const PlanType = StructType({ title: StringType, owner: StringType });
const plans = e3.record('plans', DictType(StringType, PlanType), new Map());
const reassign = e3.mutation.edit('reassign', plans,
  East.function([plans.type, StringType, StringType, e3.mutation.editType(plans.type)], NullType,
    ($, state, id, owner, edit) => { $(edit.set(id, { title: state.get(id).title, owner })); }));
const byOwner = e3.recordIndex('by_owner', plans, {
  key: East.function([StringType, PlanType], StringType, ($, id, plan) => plan.owner),
});

const pkg = e3.package('planning', '1.0.0', counter, increment, plans, reassign, e3.mutation.patch(plans), byOwner);
```

- `e3.mutation.reduce(name, record, fn)` — `(state, ...args) => state`, over any record.
- `e3.mutation.edit(name, record, fn)` — `(state, ...args, edit) => Null`: the body reads the state lazily and writes through `edit.set`, `edit.delete` and `edit.update`, so a write costs the segments it touches. For Dict and Set records.
- `e3.mutation.patch(record, name?)` — no body: the argument is the change, a `PatchType` of the state. For Dict and Set records.
- `e3.recordIndex(name, record, { key | keys, value? })` — a second collection over a Dict record, in another order, maintained in the same commit; pages and key searches take it by name.
- `e3.migration.value | rows | rekey(name, record, fn, { after? })` — the steps a deploy runs when a record's type changes between package versions (`e3 workspace deploy`'s `--schema`, below).

Every function here is pure, synchronous East: a mutation runs again against
fresher state when its write conflicts, and an index or a migration runs again
wherever it is rebuilt or not yet applied.

### `e3.package(name, version, ...items)`

Bundles inputs and tasks into a package. Dependencies are collected automatically.

```typescript
// Only need to pass leaf tasks - dependencies are collected automatically
const pkg = e3.package('myapp', '1.0.0', finalTask);

// Or pass multiple items explicitly
const pkg = e3.package('myapp', '1.0.0',
  input1,
  input2,
  task1,
  task2
);
```

### `e3.export(pkg, zipPath)`

Exports a package to a `.zip` file for import into a repository.

```typescript
await e3.export(pkg, '/tmp/myapp.zip');
```

---

## CLI Reference

### Repository Commands

```bash
e3 repo create <repo>             # Create repository (local path or remote URL)
e3 repo remove <repo> [-r]        # Remove repository (-r to remove workspaces first)
e3 repo status <repo>             # Show repository status (packages, workspaces)
e3 repo gc <repo> [--dry-run] [--keep-runs <n>] [--keep-days <d>]   # Remove old history and unreferenced objects
```

The `repo remove` command will refuse to remove a repository that contains workspaces unless the `-r` (`--recursive`) flag is provided. With `-r`, all workspaces are removed before the repository is deleted.

`repo gc` bounds the history a repository keeps before it removes the objects
nothing names. It keeps each workspace's last 10 runs (`--keep-runs`), every
run from the last 7 days (`--keep-days`) and the run its current state came
from, with every execution those runs used; every execution a workspace's
current state is served from, so a re-run stays cached; every execution from
the last 7 days; and whatever is running. Every other execution — its record
and its logs — and run record goes, and the outputs only they kept go with
them. `--dry-run` reports what would go without deleting anything.

### Package Commands

```bash
e3 package import <repo> <zipPath>       # Import package from .zip
e3 package export <repo> <pkg> <zipPath> # Export package to .zip
e3 package list <repo>                   # List installed packages
e3 package remove <repo> <pkg>           # Remove a package
```

### Workspace Commands

```bash
e3 workspace create <repo> <name>                            # Create empty workspace
e3 workspace deploy <repo> <ws> <pkg>[@<ver>]                # Deploy a package
e3 workspace deploy <repo> <ws> --from-zip <path.zip>        # Import + create + deploy in one shot
e3 workspace deploy <repo> <ws> … --skip-file-sources        # Leave `file`-source inputs unset
e3 workspace deploy <repo> <ws> … --schema <policy>          # A record that cannot be kept as it is: migrate (default), fail, or reset
e3 workspace deploy <repo> <ws> … --allow-drop-records       # Drop a record the package no longer declares, with its state and history
e3 workspace deploy <repo> <ws> … --plan                     # Say what the deploy would do to each record and index; write nothing
e3 workspace export <repo> <ws> <zip>                        # Export workspace as a package
e3 workspace list <repo>                                     # List workspaces
e3 workspace remove <repo> <ws>                              # Remove workspace
e3 workspace status <repo> <ws>                              # Detailed status (tasks, datasets, locks)
```

A deploy decides what to do with each record before it writes anything. It
mints a new record's `$init` commit, keeps one whose migrations have all been
applied (with a `$deploy` commit when the package changed), and runs the
migrations a workspace has not applied, a `$migrate:<name>` commit each. A
record whose type changed with no migration, or whose applied steps the
package's chain does not start with, is refused, and so is a record the
package no longer declares, unless `--allow-drop-records`. `--schema fail`
runs no migration and refuses instead; `--schema reset` resets such a record to
the package's initial value, with a `$reset` commit. `--plan` prints the plan
and writes nothing.

### Dataset Commands

Dataset paths use the flat form `<ws>.<name>`. The CLI resolves `<name>` against the workspace's inputs and task outputs automatically — no `.tasks.X.output` or `.inputs.X` ceremony.

```bash
e3 dataset get <repo> <ws.name> [-f east|json|beast2]
e3 dataset set <repo> <ws.name> <file> [--type <spec>] [--type-file <path>]
e3 dataset set <repo> <ws.name> --from-file <path.beast2>   # Take a beast2 file in as the value
e3 dataset list <repo> <ws> [-l]                 # List paths (with -l for type/status/size table)
e3 dataset status <repo> <ws.name>               # Kind, type, status, size (+ segments/rows for a collection)
e3 dataset find <repo> <ws> <pattern>            # Substring or glob (`*`, `?`) match
```

Examples:

```bash
e3 dataset get . dev.name             # Read an input
e3 dataset get . dev.greet            # Read a task output
e3 dataset set . dev.name data.east   # Set an input from a file
e3 dataset set . dev.table --from-file ./deliveries/TABLE.beast2   # Re-point an input at a delivery
e3 dataset find . dev '*output*'      # Find names matching a glob
```

Every set checks the value's type **equals** the dataset's declared type —
not merely assignable, since runners decode by the declared type — and
refuses a mismatch before anything is written, naming the dataset, both types
and the first differing field. `--from-file` never holds the file whole: its
hash is streamed and its header checked by ranged reads; a collection is then
read a segment at a time and stored as the store's own segments — bytes the
store has taken before cost only their hash — and any other value enters the
object store by reflink, hard link or one kernel copy. Against a remote
repository the file is streamed through the transfer protocol and checked the
same way at the server's commit. `--type`/`--type-file` on a `.beast2` argument
is checked against the file's own header rather than silently overriding it.

The resolver gives `did you mean` suggestions on typos:

```
$ e3 dataset get . dev.gret
Error: 'dev.gret' not found in workspace 'dev'. Did you mean:
  dev.greet  (task-output)
```

`--type-file <path>` accepts a `.east` schema file in place of an inline `--type` string — handy when the type spec is too complex to escape on the shell.

### Record Commands

A record is written only through its mutations — a raw `dataset set` on one is
refused — and `-w` names the workspace that holds it. Read its state with
`dataset get`, like any dataset.

```bash
e3 mutate <repo> <record.mutation> [args...] -w <ws> [-v]    # Apply a mutation; args are .east literals or .beast2/.json/.east files
e3 history <repo> <record> -w <ws> [--limit <n>] [--from <hash>] [--delta]   # The commit chain, newest first (--delta: local repositories)
e3 reindex <repo> <record> -w <ws> [--index <name>]          # Rebuild an index from the record (every one by default)
e3 compact <repo> <record> -w <ws>                           # Collapse the history to a $compact root; the state is kept
```

### Task Commands

```bash
e3 task list <repo> <ws>                         # Tasks in workspace with execution status
e3 task logs <repo> <ws.task>                    # Last 200 lines of a task's logs
e3 task logs <repo> <ws.task> -n 50              # Last 50 lines
e3 task logs <repo> <ws.task> --all              # The whole log, however large
e3 task logs <repo> <ws.task> --follow           # Tail, then stream live output
e3 task logs <repo> <ws.task> --execution <taskHash>/<inputsHash>/<executionId>   # One execution's own log (local repositories)
```

Logs are shown from the end, since that is where a failure lands. When earlier
output was left out, a notice says so and how to get it; `--all` pages through
the whole log rather than holding it in memory. `--follow` picks up from the
current end of the log, so live output starts immediately regardless of how much
backlog there is. A split task's log is the account of its units: each piece
and merge unit is an execution of its own, named on its `piece n/N …` or
`merge level l/L unit u/U …` line by `task=<taskHash> inputs=<inputsHash>
execution=<executionId>`, and `--execution <taskHash>/<inputsHash>/<executionId>`
shows one unit's own runner output.

### Dataflow Commands

```bash
e3 dataflow run <repo> <ws> [--filter <pattern>] [-j <n>] [--memory <size>] [--force] [-v]
```

`-j` / `--jobs <n>` and `--memory <size>` are the budget of the runner processes
e3 spawns. `-j` is its cores: the runners in flight at once, across the
dataflow's tasks and the pieces and merge units of its split tasks alike (every runner takes one, first come first served, whatever launched it).
`--memory` is the memory those runners may reserve between them, as `8G` or
`512M`. They default to `E3_JOBS` and `E3_MEMORY`, else to what e3 may use: the
CPUs of its affinity mask, capped by a cgroup quota, and the cgroup's
`memory.max` or else physical memory, less a reserve for e3 and the OS.

A unit of a split task reserves the largest peak memory a unit of its stage
(its pieces, or one level of its merges) has reached in the run, so each stage
runs its first unit alone and then fans out. Anything else reserves nothing. On
Linux and macOS a guard stops the newest such unit when the runners together
pass the budget, and runs it again once there is room.

`e3 watch`, `e3 run`, `e3 call`, `e3 mutate`, `e3 reindex` and
`e3 workspace deploy` take the same two flags for a local repository. Against a
server they are refused: it runs the work under its own budget
(`e3-api-server -j` / `--memory`).

A local run gives every execution a scratch directory — its inputs are marshalled
there and its output written there before it is stored — inside the repository,
under `<repo>/tmp/scratch`, or under `E3_SCRATCH_DIR` when that is set. Inside
the repository it is on the object store's own filesystem, so an output never
waits in memory on a tmpfs temp directory, and one that is not a collection is
stored by a link rather than a copy. Each directory is named after its execution and the process that owns
it; one left behind by a process that died is removed by the next
`e3 dataflow run` or `e3 repo gc`.

`-v` / `--verbose` forwards `-v` to each task's runner so it prints a timing/perf
block (load, compile, execute, output, total + peak RSS) to the task's logs
(`e3 task logs <repo> <ws>.<task>`). It is a pure runtime toggle: it never
affects task hashes or caching, so a cached task stays cached whether or not you
pass it — combine with `--force` to see the block for an already-cached task. The
same flag works on `e3 run`, `e3 call`, and `e3 mutate`, against **local and
remote** repositories (remote sends it as a `?verbose=1` query param). All three
known runtimes (east-node, east-py, east-c) print the identical block.

After a successful run, the CLI prints the resolved task output paths so you can read them straight away without having to walk the tree:

```
Summary:
  Executed: 2
  Cached:   0
  Failed:   0
  Skipped:  0
  Duration: 412ms

Outputs:
  dev.greet  14 B
  dev.shout  16 B
```

### Ad-hoc Run

```bash
e3 run <repo> <pkg.task> <inputs...> -o <out>
e3 run <repo> <pkg@1.0.0.task> <in.beast2> -o <out.beast2> [-v]
```

Task spec uses dots: `pkg.task` (or `pkg@version.task`). Slashes are no longer accepted.

### Call (named functions)

```bash
e3 call <repo> <pkg.fn> [args...]            # call by package: pkg.fn or pkg@1.0.0.fn
e3 call <repo> -w <ws> <fn> [args...]        # call the workspace's deployed package
e3 call <repo> <pkg.fn> 2 3 -o sum.beast2    # write raw result to a file
e3 call <repo> <pkg.fn> 2 3 -v               # print the runner's timing/perf to stderr (local repos)
```

Arguments are `.east` literals (`5`, `"hello"`, `[1.0, 2.0]`) or paths to
`.beast2` / `.json` / `.east` files, parsed against the function's declared
parameter types. On success the decoded result prints to stdout; failures
(wrong arity, runtime error, timeout, over-size result) exit non-zero with
a diagnostic. Calls are graph-free — they trigger no dataflow and leave the
repository byte-for-byte unchanged.

### Watch / Live Development

```bash
e3 watch <source.ts> <repo> <ws> [--start] [--schema <policy>] [-j <n>] [--memory <size>] [--abort-on-change]
```

The source file is the first argument — that's the thing you're editing, the rest is plumbing. `-j` and `--memory` are the budget its deploys and the runs `--start` launches share, as for `e3 dataflow run`. `--schema` is the deploy's (`e3 workspace deploy`); a record whose type changes with no migration stops the watch, naming `--schema=reset`.

**Cancellation:** Press Ctrl-C in a running `e3 dataflow run` to abort it. In watch mode, `--abort-on-change` cancels in-flight runs when files change.

### Utilities

```bash
e3 convert [input] [--from <fmt>] [--to <fmt>] [-o <out>] [--type <spec>]
e3 completion install            # Detect $SHELL and wire up tab completion
e3 completion uninstall          # Undo
e3 completion {bash|zsh|fish}    # Print the raw script if you'd rather install it yourself
```

`e3 completion install` is the recommended way — it edits the right rc file once, idempotently. After install, restart your shell (or `source ~/.bashrc` / `source ~/.zshrc`).

Completion covers subcommands, flag names, format enums, workspace names, and dataset paths. Dynamic lookups go through a hidden `e3 __complete` handler.

### Authentication Commands

For remote servers that require authentication:

```bash
e3 auth login <server>            # OAuth2 device-flow login
e3 auth logout <server>           # Clear saved credentials
e3 auth status                    # List saved credentials
e3 auth token <server>            # Print access token (curl integration)
e3 auth whoami [server]           # Show current identity
```

The `e3 auth token` command is useful for debugging API calls with curl:

```bash
# Use token with curl
curl -H "Authorization: Bearer $(e3 auth token http://localhost:3000)" \
  http://localhost:3000/api/repos/my-repo/status
```

### Remote URLs

All commands that take a `<repo>` argument also accept HTTP URLs. Start a server with `e3-api-server`, then use the same CLI commands:

```bash
# Start a server (serves all repos under ./repos/)
e3-api-server --repos ./repos --port 3000

# All commands use the same URL format: http://server/repos/name
e3 repo create http://localhost:3000/repos/my-repo
e3 repo status http://localhost:3000/repos/my-repo
e3 repo remove http://localhost:3000/repos/my-repo

# Works the same for workspace and package commands
e3 workspace list http://localhost:3000/repos/my-repo
e3 workspace create http://localhost:3000/repos/my-repo dev
e3 package import http://localhost:3000/repos/my-repo ./pkg.zip
e3 workspace deploy http://localhost:3000/repos/my-repo dev myapp@1.0.0
```

**URL structure:**

```
User-facing URL:  http://localhost:3000/repos/my-repo
                  └──────────┬───────┘ └─────┬──────┘
                           origin      /repos/{name}

API endpoint:     http://localhost:3000/api/repos/my-repo/workspaces
                                        └─┬─┘
                                    inserted by CLI
```

The CLI automatically inserts `/api` when making requests. This keeps user-facing URLs clean (shareable, works in browser) while the server handles API routes under `/api/repos/...`.

---

## Project Setup

### TypeScript Project

```
my-e3-project/
├── package.json
├── tsconfig.json
├── pyproject.toml      # For Python runner (east-py)
├── src/
│   └── index.ts        # Package definition
└── repo/               # Repository (created by e3 repo create)
```

**package.json:**
```json
{
  "name": "my-e3-project",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "main": "node dist/index.js"
  },
  "dependencies": {
    "@elaraai/east": "^0.0.1-beta.11",
    "@elaraai/e3": "^0.0.2-beta.5"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

**pyproject.toml** (for Python runner):
```toml
[project]
name = "my-e3-project"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "east-py>=0.0.1b11",
    "east-py-std>=0.0.1b11",
]

[tool.uv]
dev-dependencies = []
```

### Makefile (recommended)

```makefile
WORKSPACE ?= dev
PACKAGE_NAME ?= myapp
PACKAGE_VERSION ?= 1.0.0

build:
	npm run build

package: build
	npm run main

import: package
	e3 package import . /tmp/pkg.zip

deploy: import
	e3 workspace create . $(WORKSPACE) || true
	e3 workspace deploy . $(WORKSPACE) $(PACKAGE_NAME)@$(PACKAGE_VERSION)

run: deploy
	e3 dataflow run . $(WORKSPACE)

all: run

clean:
	rm -rf dist /tmp/pkg.zip
```

---

## Development Workflow

### Watch Mode

The fastest development workflow uses `e3 watch`:

```bash
e3 watch ./src/index.ts . dev --start
```

This:
1. Compiles your TypeScript on save
2. Exports and imports the package
3. Deploys to the workspace
4. Executes the dataflow
5. Repeats when files change

Use `--abort-on-change` to cancel running executions when you save:

```bash
e3 watch ./src/index.ts . dev --start --abort-on-change
```

### Manual Workflow

```bash
# Build and export
npm run build && npm run main

# Deploy in one step
e3 workspace deploy . dev --from-zip /tmp/pkg.zip

# Run
e3 dataflow run . dev

# Check results
e3 workspace status . dev
e3 dataset get . dev.mytask
```

### Caching

Tasks are cached by content hash. A task only re-runs when:
- Its East function IR changes
- Any of its input values change

Changing one task doesn't invalidate unrelated tasks. A stream task split over
an input is also cached a unit at a time — each piece, and each merge of their
outputs — so a re-run after an append or an insertion runs only the pieces it
touched and the merges they reach. Use `--force` to bypass cache:

```bash
e3 dataflow run . dev --force
```

---

## File Formats

e3 supports three formats for data:

### .east (Human-Readable)

```east
42                      # Integer
"hello"                 # String
[1, 2, 3]              # Array
(name="Alice", age=30) # Struct
```

### .json

```json
{"type": "Integer", "value": "42"}
```

### .beast2 (Binary)

Compact binary format with self-describing types. Use for efficiency.

### Converting

```bash
e3 convert data.beast2                    # → .east (default)
e3 convert data.east --to beast2 -o out.beast2
e3 convert data.json --to east
```

---

## Tips

1. **Use watch mode** for fast iteration during development
2. **Let dependencies flow** - only pass leaf tasks to `e3.package()`, dependencies are collected automatically
3. **Check status** with `e3 workspace status . <ws>` to see task states
4. **View logs** with `e3 task logs . workspace.taskname` for debugging (add `--all` for the whole log)
5. **Use inputs** for values that change between runs, tasks for computations
