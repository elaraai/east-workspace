# e3 User Guide

Usage guide for e3 (East Execution Engine) - a durable, content-addressable execution engine for East programs.

e3 provides git-like task management with cryptographic content addressing, allowing you to define dataflow pipelines that execute across multiple runtimes (Node.js, Python, Julia).

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
e3 watch . dev ./src/index.ts --start
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

A computation that reads input datasets and produces an output dataset. Tasks are defined with `e3.task()` using an East function, or `e3.customTask()` for shell commands.

### Dataflow

The DAG of tasks and their dependencies. When you run `e3 dataflow run`, tasks execute in dependency order. Cached results are reused when inputs haven't changed.

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
// is a new hash, so only its consumers re-run — and a partitionTask over it
// re-runs only the partitions whose slices changed.
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
    East.str`${greeting.toUpperCase()}!!!`
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

### `e3.partitionTask(name, spec, fn)`

Defines a task over huge collection datasets with bounded memory. e3 carves
the partitioned input(s) into key-range slices (deterministically, from the
dataset's segment index and the `targetPartitionBytes` knob), runs the body
once per partition as an ordinary content-addressed execution — parallel,
and memoized per partition — and assembles the one output dataset: shards
splice in partition order, keyed partials merge by key on the task's runner
when `merge` is given, or partials fold pairwise when `combine` is given. The
dataflow graph sees one task with one output, exactly like `e3.task`.

```typescript
import { DictType, StringType, IntegerType } from '@elaraai/east';

const sales = e3.input('sales', DictType(SaleKeyType, SaleType));

// Row-local transform: each execution returns its shard of the output.
const cleaned = e3.partitionTask('cleaned', {
  partitions: [sales],
  output: DictType(SaleKeyType, SaleType),
}, ($, slice) => slice.filter(($, sale) => East.greater(sale.qty, 0n)));

// Aggregate to a small result: with `combine`, each execution returns a
// partial and the partials fold pairwise (combine must be associative).
const totals = e3.partitionTask('totals', {
  partitions: [sales],
  by: (_$, key) => key.sku,   // rows with equal by(key) never split apart
  output: DictType(StringType, IntegerType),
  combine: ($, a, b) => {
    const acc = $.let(a.copy());   // partials are frozen inputs — fold into a copy
    $(acc.mergeAll(b, ($, v1, v2) => v1.add(v2), ($, _k) => 0n));
    $.return(acc);
  },
}, ($, slice) => /* aggregate the slice */ ...);

// Keyed partials that may share keys: `merge` folds a key present in two
// partials (it must be associative). The task's runner merges the partials
// whose key ranges overlap with its `merge` command — one pass over sorted
// partials, as a tree of merge executions — and the results splice with the
// partials no other reaches; the orchestrator never decodes them. Every merge
// unit is cached, so an append re-runs the changed partitions plus the merges
// they reach. A Set output takes `merge: 'union'`.
const latest = e3.partitionTask('latest', {
  partitions: [events],
  output: DictType(StringType, EventType),
  merge: ($, _key, a, b) => East.greater(a.at, b.at).ifElse(($) => a, ($) => b),
}, ($, slice) => /* per-partition latest-by-entity */ ...);
```

The body's parameters are the partition slices (each typed as its dataset's
own collection type), then any ordinary `inputs` in order. `by` must read a
leading prefix of every partitioned dataset's key — the key itself, one
leading field, or a struct of leading fields in order — and is validated
when the task is built. Two or more `partitions` entries co-partition
same-keyed Dict/Set datasets at shared boundary keys (the reconcile/delta
shape). Without `combine` or `merge`, Dict/Set shard key ranges must ascend
disjointly in partition order — key-preserving and monotone re-keying
transforms qualify; anything else fails at splice naming the offending
partitions, and is what `merge` is for. `merge` and `combine` are mutually
exclusive, and `merge` is refused on an Array output.

A `merge` function takes the key and two values, typed as the output's own key
and value, and must be associative: a key's values may fold in any grouping,
though never out of partition order. It runs on the task's runner through its
`merge` command, so it needs a stock runtime — the `custom` runtime is refused
— of this release: an older runner has no `merge` command. The merge command
is built at export and carried in the package. A large output is merged in
parallel: the partials that overlap are cut into key ranges of about
`targetPartitionBytes`, each merged by its own unit, which reads just that
range of every partial (the runner's `merge --range`; nothing is copied or
re-encoded to make a range). The ranges are planned from the partials alone,
so the output is a deterministic function of the inputs — the same hash on
every machine, whatever `--jobs` — and the merge units' results are stored
like any execution output, which is what lets a re-run re-merge only what
changed.

Memoization is append-friendly: appends and tail-localized changes leave
earlier slices byte-identical, so their executions are served from the
cache; a mid-key-space insertion re-runs partitions from the insertion
point on.

### `e3.streamTask(name, spec, fn)`

Defines a one-pass streaming task: the runner feeds the `stream` input in
canonical order and the body writes its output incrementally through the
`emit` capability. State is ordinary `$.let` locals — exact left-fold
semantics, no parallelism, and any input change re-runs the whole pass.
Runs on every stock runtime: the output always streams through `emit`, and
every runner feeds the `stream` input lazily with O(segment) decoded memory
(segment-fed iteration and keyed reads; any other operation on it decodes
the whole value once). Task inputs decode deeply frozen on every runtime:
mutating one raises `cannot mutate a frozen value (task inputs are
immutable) — copy first` — derive changed values from `.copy()`.

```typescript
import { ArrayType } from '@elaraai/east';

const events = e3.input('events', ArrayType(EventType));

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
```

`emit(key, value)` writes one Dict entry, `emit(element)` one Array/Set
element. An Array output stores its elements in emission order. A Set or
Dict output must be emitted in ascending key order (East's total order): the
runner writes the output in one pass, segment by segment, with one open batch
in memory whatever the output's size, and an out-of-order key fails the task
with the same message on every runtime — `beast2 v5: Dict key emitted out of
order: 1 after 2 — Set/Dict emissions must ascend in East order`. Duplicate
Dict keys / Set elements are a runtime error unless `merge` folds them. Omit
`stream` for a producer task whose body loops over platform-function sources
(paginated APIs, database cursors) and emits.

With `merge`, equal keys that arrive together fold instead of failing: a Dict
output takes a function of the key and two values, and adjacent equal keys
fold left in emission order; a Set output takes `'union'`, and adjacent equal
elements collapse to the first. The ascending contract stands — `merge` is
for a stream whose equal keys are grouped — and the stored dataset is exactly
what the folded emissions would write. Keys that collide across the stream,
or arrive out of order, are a `partitionTask` with `merge`:

```typescript
import { ArrayType, DictType, FloatType, IntegerType, StringType, StructType } from '@elaraai/east';

// (a) Grouped input, one pass: payments sorted by account fold to per-account
//     totals — equal keys arrive together, and the accounts ascend.
const payments = e3.input('payments', ArrayType(PaymentType));   // sorted by account
const accountTotals = e3.streamTask('account_totals', {
  stream: payments,
  output: DictType(StringType, FloatType),
  merge: (_$, _account, a, b) => a.add(b),
}, ($, payments, emit) => {
  $.for(payments, ($, payment) => {
    $(emit(payment.account, payment.amount));
  });
});

// (b) A re-key — the output key is not the input's order — is a partitionTask:
//     each partition builds its slice's Dict (toDict folds the keys that
//     collide inside the slice) and `merge` folds the keys that collide across
//     partitions, on the task's runner.
const sales = e3.input('sales', DictType(SaleKeyType, SaleType));
const bySku = e3.partitionTask('by_sku', {
  partitions: [sales],
  output: DictType(StringType, IntegerType),
  merge: (_$, _sku, a, b) => a.add(b),
}, ($, slice) => slice.toDict(
  ($, _sale, key) => key.sku,
  ($, sale, _key) => sale.qty,
  ($, a, b, _sku) => a.add(b),
));

// (c) An ingest that cannot page in key order emits pairs in arrival order,
//     and a partitionTask over the pairs re-keys them.
const PairType = StructType({ key: StringType, value: RowType });
const pairs = e3.streamTask('ingest_pairs', {
  output: ArrayType(PairType),
}, ($, emit) => { /* fetch pages, $(emit({ key: row.id, value: row })) each */ });
const rows = e3.partitionTask('rows', {
  partitions: [pairs.output],
  output: DictType(StringType, RowType),
  merge: ($, _id, a, b) => East.greater(a.at, b.at).ifElse(($) => a, ($) => b),
}, ($, slice) => slice.toDict(
  ($, pair, _i) => pair.key,
  ($, pair, _i) => pair.value,
  ($, a, b, _id) => East.greater(a.at, b.at).ifElse(($) => a, ($) => b),
));
```

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
e3 repo gc <repo> [--dry-run]     # Remove unreferenced objects
```

The `repo remove` command will refuse to remove a repository that contains workspaces unless the `-r` (`--recursive`) flag is provided. With `-r`, all workspaces are removed before the repository is deleted.

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
e3 workspace export <repo> <ws> <zip>                        # Export workspace as a package
e3 workspace list <repo>                                     # List workspaces
e3 workspace remove <repo> <ws>                              # Remove workspace
e3 workspace status <repo> <ws>                              # Detailed status (tasks, datasets, locks)
```

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
backlog there is. A partitioned task's log is the orchestrator's account of its
units — the partitions and merge units, each an execution of its own, named by
`<taskHash>/<inputsHash>/<executionId>` in the `[PART]` / `[MERGE]` /
`[COMBINE]` lines — and `--execution` shows one unit's own runner output.

### Dataflow Commands

```bash
e3 dataflow run <repo> <ws> [--filter <pattern>] [-j <n>] [--force] [-v]
```

`-j` / `--jobs <n>` is the run's one budget of parallelism: the runner processes
e3 keeps in flight at once, across the dataflow's tasks and the partitions and
merge units of its partitioned tasks alike (every runner takes one slot, first
come first served, whatever launched it). It defaults to the CPUs available to
e3 — its affinity mask, capped by a cgroup quota — or to `E3_JOBS` when set.

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
Summary: 2 executed, 0 cached
Outputs:
  dev.greet  String  14 B
  dev.shout  String  16 B
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
e3 watch <source.ts> <repo> <ws> [--start] [-j <n>] [--abort-on-change]
```

The source file is the first argument — that's the thing you're editing, the rest is plumbing. `-j` is the jobs budget of the runs `--start` launches, as for `e3 dataflow run`.

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

Changing one task doesn't invalidate unrelated tasks. A `partitionTask` is
also cached per partition and, with `merge`, per merge unit (the runner's
`merge` command over a group of partials). Use `--force` to bypass cache:

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
