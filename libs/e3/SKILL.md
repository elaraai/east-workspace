---
name: e3
description: "East Execution Engine (e3): durable, content-addressed dataflow for East programs. Use when (1) authoring a package with @elaraai/e3 — e3.input, e3.task, e3.streamTask with e3.output and e3.partition (bounded memory, work split over an input), e3.customTask, e3.function, e3.package, e3.export, East.importFunction; (2) records — audited state written only through mutations (e3.record with mutation.reduce/edit/patch), their indexes (index.on/key/keys, interval, area, series, summary, nested) and migrations (migration.value/rows/rekey); (3) the e3 CLI — repo, package, workspace, dataset, task, dataflow run, run, call, mutate, seed, history, watch, convert, auth, and the cores and memory a run may use; (4) driving e3 from code (@elaraai/e3-api-client, @elaraai/e3-core, e3-api-server); (5) caching, reactive re-runs and garbage collection; (6) delegating task bodies to a rack (e3 rack); (7) e3 in a browser with @elaraai/e3-web. UI tasks are e3-ui's ui()."
---

# East Execution Engine (e3)

e3 runs East programs as a durable dataflow over content-addressed data: every
value is an object named by its hash, every task execution is cached by its
inputs, and a change re-runs only what it reaches. It is the platform's
**Compute** layer — and East + e3 solutions are decision-oriented: a dataflow
exists to put auditable evidence behind a business decision, not to move data
for its own sake.

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

Tested e3 packages (inputs, tasks, stream tasks and partitions, custom tasks,
functions, records with their mutations and migrations) are in the index too:
search with `package: "e3"`.

Nothing is injected for you; the search is the step.

## Quick Start

```typescript
// src/index.ts
import { East, StringType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';

const name = e3.input('name', StringType, variant('value', 'World'));
const greet = e3.task('greet', [name],
  East.function([StringType], StringType, ($, n) => East.str`Hello, ${n}!`));

const pkg = e3.package('hello', '1.0.0', greet);   // dependencies are collected
await e3.export(pkg, '/tmp/hello.zip');
export default pkg;
```

```bash
e3 repo create .
e3 workspace deploy . dev --from-source ./src/index.ts   # or --from-zip /tmp/hello.zip
e3 dataflow run . dev
e3 dataset get . dev.greet                               # flat path: <ws>.<name>
```

## Decision Tree

```
What do you need?
├─ Author a package (@elaraai/e3)
│   ├─ An input dataset          → e3.input(name, type, source?)   source: variant('value', v) | variant('file', path)
│   ├─ A task — two questions: does the output fit in memory, can the work be split over an input? (see "Which task?")
│   │   ├─ Fits, built in one pass       → e3.task(name, [inputs], fn, config?) — returns the output
│   │   ├─ Too large, or built as you go → e3.streamTask(name, { inputs, output }, fn) — emits into e3.output.array | set | dict | fold
│   │   └─ Split over an input, in pieces → wrap that input: e3.partition(dataset, { by? })
│   ├─ A shell command           → e3.customTask(name, [inputs], outputType, command)
│   ├─ A named function (RPC)    → e3.function(name, fn, config?) — called by name, persists nothing
│   ├─ Audited state             → e3.record(name, type, { initial?, indexes?, mutations?, migrations? }), declared whole
│   │   ├─ Its writes            → mutations: (mutation) => ({ name: mutation.reduce | edit | patch })
│   │   ├─ An order to page in   → indexes: (index) => ({ name: index.on([...fields]) | index.key(fn) | index.keys(fn) }) (reference/record-indexes.md)
│   │   ├─ Read by a time window or a 2D window → index.interval | index.area
│   │   ├─ Read a block of keys over time tiles, or their totals → index.series | index.summary
│   │   └─ Read what rows nest (jobs, a value a day, child rows, trees) a tile at a time, with totals and subtotals
│   │       → index.nested({ collections, tile, summary? })
│   ├─ A record's type changes   → migrations: (migration) => [migration.value | rows | rekey(name, fn), …], in order (reference/record-migrations.md)
│   ├─ A UI task                 → ui(name, [inputs], fn) from @elaraai/e3-ui (the e3-ui skill)
│   ├─ A function written in python or another node package → East.importFunction(pkg, name, FunctionType) in the body
│   └─ Bundle and export         → e3.package(name, version, ...items); e3.export(pkg, zipPath)
├─ Operate it from the shell     → the e3 CLI (reference/cli.md): deploy, run, read and write datasets, mutate records, gc
├─ Delegate local task bodies to a rack → e3 rack enroll + policy; dataflow run --rack, watch --start --rack (reference/rack.md)
└─ Drive it from code
    ├─ A server, over HTTP       → @elaraai/e3-api-client (reference/from-code.md)
    ├─ A local repository        → @elaraai/e3-core
    ├─ Serve repositories        → e3-api-server --repos <dir>, or createServer()
    └─ e3 in a browser, no server → @elaraai/e3-web: serveUnits, serveE3, createWebE3 (reference/browser.md)
```

## Authoring a package

### Inputs — `e3.input(name, type, source?)`

A dataset at `.inputs.<name>`, addressed `<ws>.<name>` from the CLI. The third
argument is a source variant — a bare value is refused:

| Source | Meaning |
|---|---|
| `variant('value', v)` | Inline, carried in the package. |
| `variant('file', path)` | A beast2 file on the machine that **deploys**. The package carries the path (relative paths resolve against the working directory at export); deploy takes the file in as the value. |
| omitted | Unassigned until something sets it. |

```typescript
const name  = e3.input('name', StringType, variant('value', 'default'));
const count = e3.input('count', IntegerType);
const table = e3.input('table', ArrayType(RowType), variant('file', './deliveries/TABLE.beast2'));
```

An inline value is a small constant written in the source. Rows computed on
the host as the package is built — a `Map` filled in a loop, a generated
array — would ride the package as a snapshot, so a dataset that is generated
or large is made where data is made: a task's output (an `e3.task` over a
small authored count, as e3-ui's paged examples generate their rows), a
`file` source, or a record.

A `file` source:
- is checked against the declared type at `e3.export` (drift is a build error
  naming the input and the first differing field) and again at deploy, before
  the workspace is touched;
- is hashed first, so a delivery the store already holds costs that one read;
- is taken in without being read whole or modified — so replace a delivery with
  a new file, never edit it in place. A collection is taken in on the runners —
  east-c, or east-node where there is no east-c — in pieces of its segments, as
  many at once as the budget allows: each row is walked, the bytes the Writer
  writes for it kept as they stand and any other row written again, so the
  delivery is stored as the Writer's value whichever writer wrote it, and a new
  delivery stores only the segments that changed. A deploy or an upload
  stopped part way takes up again from the pieces it finished. Any other value
  is taken in by reflink, hard link or one copy;
- may hold no segment of more than 64 MiB, the most a collection is read in at
  once. A value encoded whole is one such segment, and so can be a segment of
  wide rows from an older Writer, which bounded a segment by its element count
  alone; either is refused, naming the fix: write it again with a current
  Writer, whose segments stay under 8 MiB;
- is read on the machine that runs `e3 workspace deploy`, local repository or
  not: against a server the CLI checks every delivery first, then streams each
  after the deploy. A deploy made through the API leaves it unset;
  `--skip-file-sources` defers it and prints the
  `e3 dataset set <repo> <ws>.<name> --from-file <path>` that completes each.

Every door into a dataset — `dataset set`, the API, the transfer, a file
adopt — refuses bytes whose type is not **exactly** the declared type, since
runners decode by it.

### Tasks — `e3.task(name, inputs, fn, config?)`

Runs an East function once, as one unit, and returns its output at
`.tasks.<name>.output`; chain tasks with `task.output`. A collection it returns
is written segment by segment, but the body builds it whole: an output too large
to hold is emitted instead (`e3.streamTask`). `config` is
`{ runner?, environment?, role? }` — `role` is what e3-ui's `ui()` sets.

Task inputs, on every runtime (a mutation's state included):
- are **deeply frozen**: mutating one raises `cannot mutate a frozen value (task
  inputs are immutable) — copy first`; derive a changed value from `.copy()`;
- open **lazily**, whatever their size: size, iteration and keyed gets read a
  segment at a time, with the same semantics, and an operation that needs the
  whole value decodes it once, when it first does. A runner's `decode: 'whole'`
  decodes every input before the program runs instead — for a program whose
  reads land at random across more segments than the runner keeps, which `-v`
  names in the task's log. Only elements carrying a `Ref` or a function decode
  whole either way.

Data that is not a dataset opens the same way inside a body —
`FileSystem.openBeast(T, path)` for a beast2 file on the runner's disk,
`blob.openBeast(T)` for bytes in hand — but the dataflow does not watch it:
anything a task should react to is an input.

| `config.runner` | Runs on |
|---|---|
| omitted | `{ runtime: 'east-node', platforms: ['@elaraai/east-node-std'] }` — every project has Node |
| `{ runtime: 'east-py', platforms: ['east-py-std', 'east-py-io', 'east-py-datascience'] }` | Python |
| `{ runtime: 'east-c', platforms: ['east-c-std'] }` | native, the lowest overhead |
| `{ runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] }` | any command: e3 appends `run`'s arguments (`-i <input>` each, `-o <output>`, the program's file) |

Platform names are typed per runtime — a typo, or another runtime's platform, is
a compile error; `{ custom: '<name>' }` names your own. A stock runtime is handed
one unit file (`exec <unit>`), and takes `decode: 'lazy' | 'whole'` (`'lazy'`
when omitted): how its units read their inputs — the unit's `decode`, as every
runner's `run --decode` takes it. It is the runner's, so a task, each piece of a
split task, a function, a mutation, a migration and an index build all read
their inputs as their runner says, and changing it re-runs the task.

```typescript
const greet = e3.task('greet', [name],
  East.function([StringType], StringType, ($, n) => East.str`Hello, ${n}!`));
const shout = e3.task('shout', [greet.output],
  East.function([StringType], StringType, ($, s) => s.upperCase()),
  { runner: { runtime: 'east-c', platforms: ['east-c-std'] } });
```

#### Your own code: platform functions, imported functions, environments

- **A project-owned platform function** (native code East cannot express): list
  `{ custom: '<name>' }` in the runner's platforms. For east-node the name is
  your package's **scoped name** (its `./platform` export, a
  `PlatformFunction[]`); for east-py, the Python **module** (its top-level
  `platform` list). The function's declared name, `"<project>.<fn>"`, must
  byte-match its implementation. Authoring and wiring: the **east-project**,
  **east** (`East.platform(...).implement(...)`) and **east-py**
  (`@platform_function`) skills.
- **An East function written in python, or in another node package**:
  `East.importFunction(pkg, name, FunctionType(...))` in the body. `e3.export`
  resolves it and embeds its IR, so the task is pure IR on any runner, its
  locations kept so an error or a profile names the function's own lines (so
  moving them re-runs the task: **Caching**, below). A uv
  workspace member is found by name in `uv.lock`, and its root module's
  `east_functions` dict is exported with `east-py export-functions` (`EAST_PY`
  when set, else the project's `.venv`, else PATH); an npm member is found by
  its `package.json` name, and its built `./functions` export's `eastFunctions`
  is exported with `east-node export-functions` (`EAST_NODE`). Each member is
  exported in one process however many tasks import from it, the members side
  by side, as many at once as the export has cores (a deploy's `-j`,
  `e3.export`'s `cores`). A python member's manifests are kept in
  `node_modules/.cache/e3/functions` under the directory the export runs in,
  keyed on its sources and those of the local packages it depends on, the
  workspace's `uv.lock` and `pyproject.toml`, the east-py exporting it and the
  functions and providers each manifest is for, so a redeploy whose python has
  not changed runs no export; deleting the directory clears it, and a node
  member is exported every time. A package built elsewhere is passed as its
  manifest — `{ functions: [...] }` / `--functions` — which wins. The declared
  type must equal the exported one exactly, and each platform function it calls
  must be provided by the task's runner, by name or by family (`east-py-std` ≡
  `@elaraai/east-node-std` ≡ `east-c-std`; `east-py-io` ≡ `@elaraai/east-node-io`).
- **Environments** are derived at export from each `{ custom }` platform: the
  providing workspace package's closure (`pyproject.toml` + `uv.lock` + sdists,
  or `package.json` + lockfile + `npm pack`) is captured into the package and
  materialized per repository, so the task runs where your tree never was. With
  platform code split into packages (`create-e3 --python-packages=a,b`), editing
  one re-runs only its tasks. An explicit `environment` overrides the
  derivation: `{ python: { project } }`, `{ node: { project } }`,
  `{ tools: { files: [...] } }` (prebuilt binaries on PATH, such as a C runner)
  or `{ image: { digest: 'repo@sha256:<64 hex>' } }` (cloud; a tag is refused).

```python
# packages/pricing/src/pricing/__init__.py — the member's root module
score = East.function([Row], FloatType, lambda b, r: r.qty.to_float() * r.price)
east_functions = {"score": score}
```

```typescript
const score = East.importFunction('pricing', 'score', FunctionType([RowType], FloatType));
const total = e3.task('total', [rows],
  East.function([ArrayType(RowType)], FloatType, ($, rs) => rs.map(($, r) => score(r)).sum()));
```

### Stream tasks — `e3.streamTask(name, spec, fn)`

A stream task **emits** its output instead of returning it, so its memory does
not grow with its output: emission order is free, and the runner sorts a set or
a dict in bounded runs and merges them. `spec` is `inputs` (datasets, in the
body's parameter order, some wrapped in `e3.partition`), `output` (an output
kind), `runner` (a stock runtime; `custom` is refused) and `environment`. The
body takes the inputs, then `emit`, and returns nothing. With no partitioned
input it is one unit with exact left-to-right semantics; a producer has no
inputs and emits what it reads from platform functions.

| Output kind | `emit` | The parts combine by |
|---|---|---|
| `e3.output.array(T)` | `emit(t)` | concatenation: emission order within a unit, units in input order |
| `e3.output.set(T)` | `emit(t)` | union: an element emitted twice is held once |
| `e3.output.dict(K, V, { merge? })` | `emit(k, v)` | key: a key emitted more than once folds with `merge($, key, a, b)`, in input order; without `merge` it fails the task, naming the key |
| `e3.output.fold(T, { zero, combine })` | `emit(t)` | every value, folded with `combine($, a, b)` from `zero`, in input order |

```typescript
const balances = e3.streamTask('balances', {
  inputs: [events],                          // no partitioned input: one unit, in order
  output: e3.output.array(FloatType),
}, ($, events, emit) => {
  const balance = $.let(0.0);
  $.for(events, ($, event) => {
    $.assign(balance, balance.add(event.amount));
    $(emit(balance));
  });
});

const ingest = e3.streamTask('ingest', {
  inputs: [],                                // a producer: emits in any order
  output: e3.output.dict(StringType, RowType, {
    merge: ($, _id, a, b) => East.greater(a.at, b.at).ifElse(($) => a, ($) => b),   // the latest row wins
  }),
}, ($, emit) => { /* page through a platform source, $(emit(row.id, row)) each */ });
```

### Splitting the work — `e3.partition(dataset, { by? })`

Wrap a stream task's input in `e3.partition` and the body runs once per
**piece** of it: each piece is a unit of its own — cached on its own, run in
parallel under the budget — typed as the whole dataset (a key range of a Set or
Dict, a position range of an Array), and the pieces' outputs combine as the
output kind says. Pieces are cut by content, at sizes that follow what the
input weighs — one piece within 16 MiB, tens of pieces for mid-size data, and
most holding 64 to 100 MiB from 2 GiB — so an append or an insertion re-runs
only the pieces it reaches. Under the local budget's guard (Linux, macOS) a
stage starts all its units at once, each reserving the task's last peak, or the
first time what the largest piece holds of its rows decoded, as its program
reads them.
An input not wrapped reaches every piece whole, opened lazily as every input is
(a keyed get reads only its segments); a change to it re-runs every piece.

```typescript
// sales: Dict<{ sku, id }, { amount, currency }>. A re-key: a key emitted in
// several pieces folds with `merge`. `rates` reaches every piece whole.
const bySku = e3.streamTask('by_sku', {
  inputs: [e3.partition(sales), rates],
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

// Per entity, in order. postings: Dict<{ account, at, id }, Float>. Rows whose
// `by` fields are equal are never split across pieces, and a piece iterates in
// key order, so each account's rows arrive together, oldest first.
const statements = e3.streamTask('statements', {
  inputs: [e3.partition(postings, { by: ['account'] })],
  output: e3.output.array(StatementLineType),   // { account, at, balance }
}, ($, postings, emit) => {
  const account = $.let('');
  const balance = $.let(0.0);
  $.for(postings, ($, amount, key) => {
    $.if(East.notEqual(key.account, account), ($) => {   // the next account starts from zero
      $.assign(account, key.account);
      $.assign(balance, 0.0);
    });
    $.assign(balance, balance.add(amount));
    $(emit({ account: key.account, at: key.at, balance }));
  });
});

// Reconcile two same-keyed datasets: both partitioned, so cut at the same keys.
const change = e3.streamTask('change', {
  inputs: [e3.partition(today), e3.partition(yesterday)],   // both Dict<SaleKey, Float>
  output: e3.output.dict(SaleKeyType, FloatType),
}, ($, today, yesterday, emit) => {
  $.for(today, ($, amount, key) => {
    $(emit(key, amount.subtract(yesterday.get(key, ($, _key) => 0.0))));
  });
});
```

- `by` names leading key fields, in order: `['account']`, or
  `['account', 'at.day']`, whose last entry reads the first field of `at`.
- Two or more partitioned inputs are cut at the same keys, so they must be Sets
  or Dicts whose keys, or `by` fields, have the same types.
- **The author's contract, the only one:** `merge` and `combine` are
  associative, `zero` is an identity of `combine`, and a partitioned body's
  combined result does not depend on where its input was cut.
- Refused when the task is defined, naming it: `e3.partition` on an `e3.task`
  input; a partitioned input that is not a collection; `by` on an Array, or
  naming anything but leading key fields; co-partitioned inputs with no common
  key.

#### Which task?

| Workload | Use |
|---|---|
| The output fits in memory, computed in one pass | `e3.task` |
| Global sequential state: running balances, replay, simulation | `e3.streamTask` with no partitioned input |
| Ingest from external sources | `e3.streamTask` with no inputs |
| Row-local derive, clean or validate over a huge input | `e3.partition` it; emit each row kept (`e3.output.array`, or a `dict` keyed as the input) |
| Enrich against a small reference, or sparse keyed reads of another huge dataset | `e3.partition` the big input; pass the other unwrapped |
| Aggregate huge → small (KPIs, counts, top-k) | `e3.partition` + `e3.output.fold` |
| Per-key totals, latest per key, a re-key (shuffle) | `e3.partition` + `e3.output.dict` with `merge` (a Set: `e3.output.set`) |
| Per entity: sequential within it, parallel across entities | `e3.partition(dataset, { by: [<leading key fields>] })` |
| Reconcile two same-keyed huge datasets | two `e3.partition` inputs |
| ML training, or work East cannot express | a platform function, or `e3.customTask` |

### Custom tasks, functions, packages

| Definition | What it is |
|---|---|
| `e3.customTask(name, inputs, outputType, command, { environment? })` | A task that runs a bash script: `command($, inputPaths, outputPath)` builds it from the staged beast2 input files, and it writes the output as a beast2 file. |
| `e3.function(name, fn, { runner?, environment? })` | A named function, called by name with arguments (`e3 call`, the API) and its result returned inline: not in the dataflow, and a call persists nothing. An argument is a value, or in a call through a workspace one of its datasets, read where it is stored. A server bounds a call by a timeout and a 1 MiB result, so long work belongs in a task. A `custom` runner must speak the runner CLI (`<command> -i <arg>… -o <out> <ir>`). |
| `e3.package(name, version, ...items)` | Bundles the items and everything they depend on — pass the last tasks, records and functions; a package passed in contributes its contents. The name and version must be valid file names. |
| `e3.export(pkg, zipPath, { functions?, cores? })` | Writes the package zip, resolving every `East.importFunction` (a workspace package is exported by the export itself, `cores` packages at once, the CPUs by default; `functions` lists manifests built elsewhere). |

```typescript
const process = e3.customTask('process', [rawData], StringType,
  ($, inputPaths, outputPath) => East.str`python script.py -i ${inputPaths.get(0n)} -o ${outputPath}`);
const add = e3.function('add',
  East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b)));
await e3.export(e3.package('tools', '1.0.0', process, add), '/tmp/tools.zip');
```

### Records — audited state, written only through mutations

`e3.record(name, type, { initial?, indexes?, mutations?, migrations? })` is a
dataset at `.records.<name>` that tasks read and react to like any input, but
that only its **mutations** write:
a raw `dataset set` is refused. A mutation is pure, synchronous East — no async
body and no platform call, since the compare-and-swap retry runs it again
against fresher state — named by an identifier. Each commit records its parent,
the state, the mutation, its arguments, the actor and the time. Deploy mints a
`$init` commit from the initial value, and a redeploy keeps state and history.
A large initial value is given as a function that makes it —
`initial: () => East.compile(generate, [])(50_000n)` — called once, as the
package is exported, never where the declaration is only read (a page binding
the record). The record's version vector carries the commit hash, so even a
mutation that leaves the state unchanged triggers downstream tasks.

Declared with no initial value, a record is **unassigned** until its first
state is committed — `e3 seed <repo> <record> <file.beast2> -w <ws>` from a
beast2 file, or a host's file intake — which is then its `$init`: the deploy
writes no commit for it, its dependents wait as they wait on an unset input —
a run leaves them waiting, counts them (`Waiting:`) and goes on without them —
and a mutation on it is refused until then. So a record whose first state is
data that arrives after the deploy — a customer list, a reference table —
never runs its dependents on an empty value first.

A record is **declared whole**: its type, its initial value and its parts, in
one call, never added to after. Each part comes from a builder the call hands
its declaration, typed by the record's type: `indexes` gets `index` and returns
the indexes by name, `mutations` gets `mutation` and returns the mutations by
name, and `migrations` gets `migration` and returns its steps in order. Each is
checked where the record is declared, every refusal naming the record and the
part, and the record carries each by its name — `plans.mutations.add_plan`,
`plans.indexes.by_due` — which a package, a binding (`Record.bind(plans)`,
`Data.bindPaged(plans, { indexes: ['by_due'] })`) and TypeScript all read.

| Form | Body | Use it when |
|---|---|---|
| `mutation.reduce(fn)` | `(state, …args) => state`, over the whole state | the rule is over the whole state, or the record is small; any record type |
| `mutation.edit(fn)` | `(state, …args, edit) => Null`: reads lazily, writes through `edit.set(k, v)`, `edit.delete(k)`, `edit.update(k, patch)` | server-side logic touches a few entries of a large Dict or Set record |
| `mutation.patch()` | none: the argument is a `PatchType(state)` | a view's save, or an integration sending diffs; on a record without indexes no program runs at all |

Every form commits a delta addressed by key, rewriting only the segments it
touches (a `reduce` of a record that is not a Dict or Set writes it whole), and
takes `{ runner? }`. In an `edit`, repeated edits of one key fold, a `set` of the
value a row already holds changes nothing, and a `delete` or `update` of a key
the record does not hold is a conflict naming the key: the caller's view of the
record is stale. `e3.mutation.editType(recordType)` is the type of `edit`. A
mutation is named by its key, an identifier; a part's functions are typed by the
record's type, so name the type (`PlansType`) to write them, in the declaration
or beside it.

```typescript
const PlanType = StructType({
  title: StringType, owner: StringType, due: DateTimeType, resources: SetType(StringType),
});
const PlansType = DictType(StringType, PlanType);

const plans = e3.record('plans', PlansType, {
  initial: new Map(),
  mutations: (mutation) => ({
    add_plan: mutation.reduce(East.function([PlansType, StringType, PlanType], PlansType, ($, state, id, plan) => {
      const next = $.let(state.copy());          // the state is frozen: copy first
      $(next.insert(id, plan));
      return next;
    })),
    reschedule: mutation.edit(East.function([PlansType, StringType, DateTimeType, e3.mutation.editType(PlansType)], NullType,
      ($, state, id, due, edit) => {
        const plan = $.let(state.get(id));       // decodes one segment, not the record
        $(edit.set(id, { title: plan.title, owner: plan.owner, due, resources: plan.resources }));
      })),
    patch: mutation.patch(),                     // a view's save
  }),
});
```

Costs count in segments: a Dict or Set record is cut by key and by each entry's
encoded size, so wide rows get segments of a few rows and a one-row edit stays
cheap. A view reads every field of the rows it shows, so keep a bulky payload it
does not display in a second record keyed the same way.

A record's indexes (`index.on` / `key` / `keys`, `interval`, `area`,
`series`, `summary`, `nested`) are in
[reference/record-indexes.md](reference/record-indexes.md), and its migrations
in [reference/record-migrations.md](reference/record-migrations.md).

## Caching

**Caching.** An execution is keyed by its task — program, runner and
environment — and its inputs' hashes, so a task re-runs only when one of those
changes (`--force` bypasses the cache, and `--force-task <task>` for the tasks
it names: a task whose code e3 cannot see changed, such as a platform
function's, or one reading data from outside e3). A task's program holds the
source locations of its body and of every function it embeds, an imported
python or node function's too, since its errors, a caught error's `stack` and
the closures it returns name them: an edit that moves one of those lines — a
comment or an import added above a function — re-runs the task. One that leaves
them where they were — another function, the end of a module, another package —
re-runs only the tasks whose environment it is in, their runner's `{ custom }`
packages. A change to an input re-runs its
consumers, even during a run. A split task is cached a unit at a time: each piece
and each merge is its own execution, and pieces are cut by content, so an append
or an insertion re-runs only the pieces it reaches and the merges above them.

## Reference files

Read the one a task needs; each holds its subject whole.

| File | Holds |
|---|---|
| [reference/record-indexes.md](reference/record-indexes.md) | Secondary indexes, interval and area indexes, series and summary indexes, nested series indexes |
| [reference/record-migrations.md](reference/record-migrations.md) | `migration.value` / `rows` / `rekey`, and how a record's type changes |
| [reference/cli.md](reference/cli.md) | Every `e3` command: repositories, packages, workspaces, datasets, tasks, runs, calls, records, watch, convert, auth, gc |
| [reference/from-code.md](reference/from-code.md) | `@elaraai/e3-api-client`, `@elaraai/e3-core`, `e3-api-server` |
| [reference/browser.md](reference/browser.md) | `@elaraai/e3-web`: serveUnits, serveE3, createWebE3, and what a browser cannot do |
| [reference/rack.md](reference/rack.md) | `e3 rack enroll` / `policy`, routing a run to a rack, `@elaraai/e3-rack` |
| [reference/repository.md](reference/repository.md) | A local repository's layout, and upgrades |

## Related skills

- **east** — the language task bodies are written in.
- **e3-ui** — UI tasks (`ui()`) and decision surfaces bound to workspace
  datasets, and rendering them in an app (`<E3Provider>`), over a server or an
  e3 in the page; **east-ui** — their components; **e3-ui-cli** — the terminal
  UI.
- **e3-create** — scaffold a project (`npm create @elaraai/e3`);
  **east-project** — its build, deploy, run and test lifecycle.
- **east-py** and **east-py-datascience** — python platform functions and ML
  tasks; **east-node-std** and **east-node-io** — Node platform functions for
  files, HTTP, databases and storage.
- **east-design** and **east-ontology** — plan the dataflow, and model the
  business, before building.
