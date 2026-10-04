---
name: e3
description: "East Execution Engine (e3) - durable, content-addressed dataflow for East programs. Use when: (1) authoring a package with @elaraai/e3 (e3.input, e3.task, e3.streamTask with e3.output and e3.partition for bounded memory and work split over an input, e3.customTask, e3.function, e3.package, e3.export, East.importFunction), (2) records - audited state written only through mutations (e3.record, e3.mutation.reduce/edit/patch, e3.recordIndex) and migrated between versions (e3.migration.value/rows/rekey), (3) the e3 CLI (repo, package, workspace, dataset, task, dataflow run, run, call, mutate, history, reindex, compact, watch, convert, auth) and the cores and memory a run may use (-j, --memory), (4) driving e3 from code: @elaraai/e3-api-client against a server, @elaraai/e3-core on a local repository, e3-api-server, (5) caching, reactive re-runs and garbage collection, (6) e3 in a browser, no server: @elaraai/e3-web (serveUnits, serveE3, createWebE3) and what a browser cannot do. UI tasks are e3-ui's ui()."
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
│   ├─ Audited state             → e3.record + e3.mutation.reduce | edit | patch, e3.recordIndex
│   ├─ A record's type changes   → e3.migration.value | rows | rekey(name, record, fn, { after? })
│   ├─ A UI task                 → ui(name, [inputs], fn) from @elaraai/e3-ui (the e3-ui skill)
│   ├─ A function written in python or another node package → East.importFunction(pkg, name, FunctionType) in the body
│   └─ Bundle and export         → e3.package(name, version, ...items); e3.export(pkg, zipPath)
├─ Operate it from the shell     → the e3 CLI (below): deploy, run, read and write datasets, mutate records, gc
└─ Drive it from code
    ├─ A server, over HTTP       → @elaraai/e3-api-client
    ├─ A local repository        → @elaraai/e3-core
    ├─ Serve repositories        → e3-api-server --repos <dir>, or createServer()
    └─ e3 in a browser, no server → @elaraai/e3-web: serveUnits, serveE3, createWebE3 ("Running e3 in a browser")
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
  resolves it and embeds its IR, so the task is pure IR on any runner. A uv
  workspace member is found by name in `uv.lock`, and its root module's
  `east_functions` dict is exported with `east-py export-functions` (from the
  project's `.venv`, else `EAST_PY` or PATH); an npm member is found by its
  `package.json` name, and its built `./functions` export's `eastFunctions` is
  exported with `east-node export-functions` (`EAST_NODE`). A package built
  elsewhere is passed as its manifest — `{ functions: [...] }` / `--functions` —
  which wins. The declared type must equal the exported one exactly, and each
  platform function it calls must be provided by the task's runner, by name or
  by family (`east-py-std` ≡ `@elaraai/east-node-std` ≡ `east-c-std`;
  `east-py-io` ≡ `@elaraai/east-node-io`).
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
output kind says. Pieces are cut by content, most holding 64 to 100 MiB of
stored bytes, so an append or an insertion re-runs only the pieces it reaches.
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
| `e3.function(name, fn, { runner?, environment? })` | A named function, called by name with arguments (`e3 call`, the API) and its result returned inline: not in the dataflow, and a call persists nothing. A server bounds a call by a timeout and a 1 MiB result, so long work belongs in a task. A `custom` runner must speak the runner CLI (`<command> -i <arg>… -o <out> <ir>`). |
| `e3.package(name, version, ...items)` | Bundles the items and everything they depend on — pass the last tasks, records and functions; a package passed in contributes its contents. The name and version must be valid file names. |
| `e3.export(pkg, zipPath, { functions? })` | Writes the package zip, resolving every `East.importFunction` (a workspace package is exported by the export itself; `functions` lists manifests built elsewhere). |

```typescript
const process = e3.customTask('process', [rawData], StringType,
  ($, inputPaths, outputPath) => East.str`python script.py -i ${inputPaths.get(0n)} -o ${outputPath}`);
const add = e3.function('add',
  East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b)));
await e3.export(e3.package('tools', '1.0.0', process, add), '/tmp/tools.zip');
```

### Records — audited state, written only through mutations

`e3.record(name, type, initialValue)` is a dataset at `.records.<name>` that
tasks read and react to like any input, but that only its **mutations** write:
a raw `dataset set` is refused. A mutation is pure, synchronous East — no async
body and no platform call, since the compare-and-swap retry runs it again
against fresher state — named by an identifier. Each commit records its parent,
the state, the mutation, its arguments, the actor and the time. Deploy mints a
`$init` commit from the initial value, and a redeploy keeps state and history.
The record's version vector carries the commit hash, so even a mutation that
leaves the state unchanged triggers downstream tasks.

| Form | Body | Use it when |
|---|---|---|
| `e3.mutation.reduce(name, rec, fn)` | `(state, …args) => state`, over the whole state | the rule is over the whole state, or the record is small; any record type |
| `e3.mutation.edit(name, rec, fn)` | `(state, …args, edit) => Null`: reads lazily, writes through `edit.set(k, v)`, `edit.delete(k)`, `edit.update(k, patch)` | server-side logic touches a few entries of a large Dict or Set record |
| `e3.mutation.patch(rec, name = 'patch')` | none: the argument is a `PatchType(state)` | a view's save, or an integration sending diffs; on a record without indexes no program runs at all |

Every form commits a delta addressed by key, rewriting only the segments it
touches (a `reduce` of a record that is not a Dict or Set writes it whole), and
takes `{ runner? }`. In an `edit`, repeated edits of one key fold, a `set` of the
value a row already holds changes nothing, and a `delete` or `update` of a key
the record does not hold is a conflict naming the key: the caller's view of the
record is stale. `e3.mutation.editType(recordType)` is the type of `edit`.

```typescript
const PlanType = StructType({
  title: StringType, owner: StringType, due: DateTimeType, resources: SetType(StringType),
});
const plans = e3.record('plans', DictType(StringType, PlanType), new Map());

const addPlan = e3.mutation.reduce('add_plan', plans,
  East.function([plans.type, StringType, PlanType], plans.type, ($, state, id, plan) => {
    const next = $.let(state.copy());          // the state is frozen: copy first
    $(next.insert(id, plan));
    return next;
  }));

const reschedule = e3.mutation.edit('reschedule', plans,
  East.function([plans.type, StringType, DateTimeType, e3.mutation.editType(plans.type)], NullType,
    ($, state, id, due, edit) => {
      const plan = $.let(state.get(id));       // decodes one segment, not the record
      $(edit.set(id, { title: plan.title, owner: plan.owner, due, resources: plan.resources }));
    }));
```

Costs count in segments: a Dict or Set record is cut by key and by each entry's
encoded size, so wide rows get segments of a few rows and a one-row edit stays
cheap. A view reads every field of the rows it shows, so keep a bulky payload it
does not display in a second record keyed the same way.

#### Secondary indexes — `e3.recordIndex(name, record, { key | keys, value? })`

A second collection over a Dict record, in another sort order, maintained in the
same commit, so a view by an attribute is a page rather than a scan. `key`
gives one entry per row; `keys` returns a Set, one entry per element (a row
naming five resources appears five times, an empty set not at all); `value` is a
projection a view renders without touching the record. The functions are pure
and synchronous, since an index maintained commit by commit must equal its
rebuild to the byte. The name is an identifier, never `primary` (the record's own
order). Read through one with `index=<name>` on a page or key search; `e3
reindex` rebuilds. A deploy builds an index the package declares and the state
lacks, drops one it no longer declares, and runs nothing for the rest; a build
is a split task over the record.

```typescript
const byOwner = e3.recordIndex('by_owner', plans, {
  key:   East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.owner),
  value: East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.title),
});
const byResource = e3.recordIndex('by_resource', plans, {
  keys: East.function([StringType, PlanType], SetType(StringType), ($, _id, plan) => plan.resources),
});
const pkg = e3.package('planning', '1.0.0',
  plans, addPlan, reschedule, e3.mutation.patch(plans), byOwner, byResource);
```

#### Migrations — how a record's type changes

| Form | Function | Runs as |
|---|---|---|
| `e3.migration.value(name, rec, fn, { after? })` | `(Old) => New`, over any record | one unit; its runner opens the state lazily |
| `e3.migration.rows(name, rec, fn, { after? })` | a Dict's rows, `(K, V1) => V2` with the keys kept, or an Array's elements, `(T1) => T2` | a task split over the state: a piece at a time, in parallel, each piece cached |
| `e3.migration.rekey(name, rec, fn, { after? })` | a Dict's entries, `(K1, V1) => { key: K2, value: V2 }`, or a Set's elements, `(T1) => T2` | the same split task, its pieces merged by key: two Dict rows landing on one key fail the deploy, naming it; two Set elements are one |

A record's steps are one chain: each names the step before it with `after` (a
step of the same record, leaving it as this step's input type), passing the last
step passes the chain, and the last step leaves the record as its declared type.
A step's name is an identifier, unique on the record, and a workspace records the
steps it has applied by name — so moving a step's code, or re-exporting it with a
newer e3, does not run it again, and an edit to an applied step's body is not
detected. The functions are pure, synchronous East.

```typescript
const RowV1Type = StructType({ title: StringType });
const RowV2Type = StructType({ title: StringType, owner: StringType });
const plans = e3.record('plans', DictType(StringType, RowV2Type), new Map());

const addOwner = e3.migration.rows('add_owner', plans,
  East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: 'unassigned' })));
// The next version adds its step after this one: e3.migration.value('…', plans, fn, { after: addOwner })
const pkg = e3.package('planning', '2.0.0', plans, addOwner);
```

What a deploy does with each record, decided before it writes anything:

| The workspace holds | Against the package's chain | The deploy |
|---|---|---|
| no state | — | mints `$init`; the whole chain counts as applied |
| state | every step applied, the type unchanged | keeps it, with a `$deploy` commit when the package changed |
| state | a proper prefix applied | runs the rest, a `$migrate:<name>` commit each |
| state | every step applied, but the type changed | refused: a type change needs a migration, or `--schema reset` |
| state | applied steps the chain does not start with | refused, naming the steps applied and those declared |
| a record the package no longer declares | — | refused unless `--allow-drop-records` |

`--schema <policy>` on `e3 workspace deploy` and `e3 watch`: `migrate` (the
default), `fail` (run no migration; refuse) or `reset` (reset the record to its
initial value, with a `$reset` commit). `--plan` prints what the deploy would do
to each record and index and writes nothing — from a zip or a source it imports
nothing, and a server plans only a package it holds. The steps run before the
deploy writes: a failed step leaves the workspace as it was, and a deploy run
again is served the steps that finished from the cache.

## The e3 CLI

Every `<repo>` is a local path or a server URL, `http(s)://<host>/repos/<name>`;
where `[repo]` is optional it defaults to `$E3_REPO`, then `.`. Dataset paths are
flat, `<ws>.<name>` — an input or a task output, with "did you mean" suggestions;
a task is `<ws>.<task>` and a mutation `<record>.<mutation>`.

| Command | Does |
|---|---|
| **Repositories** | |
| `e3 repo create [repo] [--exist-ok]` | Create one (`--exist-ok`: succeed if it exists). |
| `e3 repo status [repo]` · `e3 repo remove [repo] [-r]` | Show objects, packages, workspaces · remove (`-r`: its workspaces first). |
| `e3 repo gc [repo] [--dry-run] [--keep-runs <n>] [--keep-days <d>] [--min-age <ms>]` | Drop old run history, then what nothing names (below). |
| `e3 repo list <server>` | The repositories a server holds. |
| **Packages** | |
| `e3 package import [repo] <zip>` · `export [repo] <pkg[@ver]> <zip>` | Import · export (`--quiet`: errors only). |
| `e3 package list [repo]` · `remove [repo] <pkg[@ver]>` | |
| **Workspaces** | |
| `e3 workspace create [repo] <ws>` · `list [repo]` · `status [repo] <ws>` · `remove [repo] <ws>` | `status` shows tasks, datasets and locks. |
| `e3 workspace deploy [repo] <ws> <pkg[@ver]>` | Deploy an imported package. |
| `… --from-zip <zip>` · `… --from-source <src.ts> [--functions <manifest…>]` | Import the zip (or bundle the source) and deploy, creating the workspace. |
| `… [--schema <policy>] [--allow-drop-records] [--plan] [--skip-file-sources] [-j <n>] [--memory <size>] [--quiet]` | A record's policy and `file` sources; says how far it has got (below), `--quiet` aside. `-j`: the `file` sources taken in at once, and the runner processes their intake units, the migrations and the index builds run on; `--memory`: what those may reserve (local). |
| `e3 workspace export [repo] <ws> <zip> [--name <n>] [--version <v>]` | The workspace's state as a package. |
| **Datasets** | |
| `e3 dataset get [repo] <ws.name> [-f east\|json\|beast2]` | Print a value. |
| `e3 dataset set [repo] <ws.name> <file> [--type <spec> \| --type-file <path>]` | Write from `.east`, `.beast2`, `.json` or `.csv` (JSON and CSV need the type). |
| `e3 dataset set [repo] <ws.name> --from-file <path.beast2> [-j <n>] [--memory <size>]` | Take a beast2 file in as the value, as a deploy takes a `file` source in, saying how far it has got; `-j`, `--memory`: the budget its intake units run under (local). |
| `e3 dataset list [repo] <ws> [-l]` · `status [repo] <ws.name>` · `find [repo] <ws> <pattern>` | Paths (`-l`: kind, type, status, size) · one dataset · by substring or glob. |
| **Running** | |
| `e3 dataflow run [repo] <ws> [--filter <task>] [--force \| --force-task <task>…] [-j <n>] [--memory <size>] [-v]` | Run what is stale, then print the outputs' paths. `--filter`: one task, by its exact name, and the tasks it depends on. `--force`: re-run every task the run runs (under `--filter`, its task); `--force-task`, repeated for each: re-run the tasks it names, whose dependents re-run when an output changes. A task the graph lacks, or one `--filter` leaves out, refuses the run. |
| `e3 task list [repo] <ws>` | Tasks with their execution status. |
| `e3 task logs [repo] <ws.task> [-n <lines>] [--all] [--follow] [--execution <task>/<inputs>/<id>]` | The last 200 lines by default; `--execution`: one unit's log, as a split task's log names it (local). |
| `e3 run <repo> <pkg[@ver].task> [inputs.beast2…] -o <out> [--force] [-v] [-j <n>] [--memory <size>]` | Run one task ad hoc. |
| `e3 call <repo> <pkg[@ver].fn> [args…] [-o <out.beast2>] [-j <n>] [--memory <size>] [-v]` · `e3 call <repo> -w <ws> <fn> [args…]` | Call a function; each argument is an `.east` literal or a `.beast2`/`.json`/`.east` file. |
| **Records** (`-w <ws>` required) | |
| `e3 mutate <repo> <record.mutation> [args…] -w <ws> [-j <n>] [--memory <size>] [-v]` | Apply a mutation. |
| `e3 history <repo> <record> -w <ws> [--limit <n>] [--from <hash>] [--delta]` | Commits, newest first (`--delta`: what each changed, per target; local). |
| `e3 reindex <repo> <record> -w <ws> [--index <name>] [-j <n>] [--memory <size>]` · `e3 compact <repo> <record> -w <ws>` | Rebuild indexes (local) · collapse the history to a `$compact` root, the state kept. |
| **Development** | |
| `e3 watch <src.ts> <repo> <ws> [--start] [--schema <p>] [--abort-on-change] [--functions <manifest…>] [-j <n>] [--memory <size>]` | Redeploy on each change (and run, with `--start`). |
| `e3 convert [input] [--from <f>] [--to <f>] [--type <spec>] [-o <out>]` | Convert between `.east`, `.json` and `.beast2`. |
| `e3 completion install [--shell <s>]` · `uninstall` · `bash` \| `zsh` \| `fish` | Shell completion. |
| **Servers** | |
| `e3 auth login <server> [--no-browser]` · `logout <server>` · `status` · `token <server>` · `whoami [server]` | OAuth2 device flow; credentials per server (`token` prints one for curl). |

**The budget.** `-j`/`--jobs <n>` is the cores — runner processes in flight, a
task or a unit each — and `--memory <size>` (`8G`, `512M`) what they may reserve
between them. The defaults are `E3_JOBS` and `E3_MEMORY`, else what e3 may use:
its CPU affinity capped by a cgroup quota, and the cgroup's `memory.max` or
physical memory, less a reserve. A unit of a split task reserves the largest
peak a unit of its stage has reached in the run, so a stage runs its first unit
alone and then fans out; on Linux and macOS a guard stops the newest unit when
the runners together pass the budget, and runs it again once it fits. A deploy
takes its `file` sources in `-j` at a time, their pieces' intake units running
under the same budget. The commands that run East — `workspace deploy`,
`dataset set --from-file`, `dataflow run`, `run`, `call`, `mutate`, `reindex`
and `watch` — take the flags for a local repository; against a server the CLI
refuses them, since the server runs the work under its own budget
(`e3-api-server -j`, `--memory`).

**A deploy says how far it has got**, on stderr. Each `file` source prints a
line once it is in: its size, time and rate, and how it was taken in
(`unchanged, already in the store`, `taken in by east-c`, or `carried` for a
value that is not a collection), with why the first time a runner fell back to
another. A terminal also keeps a live line for the files in flight, with their
pieces, the rate and the time left across them. Against a server, the deploy line
says what the job is doing, such as migrating a record or building an index;
the deliveries then upload a few at a time, each printing a line once it is in,
and the live line says what the server's commit is doing with each in flight.
While a deploy runs, its lock carries the same progress for `e3-ui` or any
client to read (`workspaceLockStatus`). A workspace deployed for the first time
has no status until its deploy ends, so the lock is the only place to see it.

**`-v`** passes `-v` to the runners, which print to the task's logs, identically
on every runtime, how each input was read — opened lazily, and what reading it
came to, or decoded whole, and the resident memory that added — and a timing
and peak-memory block. It never changes hashes or caching (add `--force` to see
it for a cached task), and works against a server.
**`E3_SCRATCH_DIR`** moves a local run's per-execution scratch directories
(default `<repo>/tmp/scratch`, on the object store's disk; on tmpfs, outputs sit
in memory until stored).

**`repo gc`** keeps each workspace's last 10 runs (`--keep-runs`), every run
from the last 7 days (`--keep-days`) and the run its current state came from,
with every execution those runs used; every execution a workspace's current
state is served from, so a re-run stays cached; every execution from the last 7
days; and whatever is running. It then removes the objects nothing names, and
staging files older than `--min-age` (60 s). `--dry-run` reports what would go.

A package zip names the release of e3 that exported it, and an import refuses a
zip a newer release exported, naming that release: import it with an e3 at least
as new as the SDK that exported it. A dataset upload names the transfer protocol
its e3 speaks, and a server refuses one that speaks another, naming both
releases and which of them to upgrade.

## Driving e3 from code

**`@elaraai/e3-api-client`** talks to a server over HTTP. Every call is
`(url, repo, …, options)`, `options` being
`{ token: string | null, retry?, verbose?, fetch? }` (`e3 auth token <server>`
prints a token); `fetch` is the `fetch` every request of the call goes
through, the global one unless given — an in-page e3's `e3.fetch` (below).
Dataset paths are `TreePath`s — an input definition's `.path`, for one. A
request a workspace's lock refuses throws `ApiError` `workspace_locked`,
naming the holder: its pid, boot id, command and when it took the lock.

| Area | Functions |
|---|---|
| Repositories | `repoList(url, opts)`, `repoCreate(url, name, opts)`, `repoRemove(url, name, opts)`, `repoStatus(url, repo, opts)`, `repoRecord` (its release and upgrades), `repoGc(url, repo, gcRequest, opts)` — a job it polls; `repoGcStart` and `repoGcStatus` apart |
| Packages | `packageList(url, repo, opts)`, `packageGet(url, repo, name, version, opts)`, `packageImport(url, repo, zipBytes, opts)`, `packageExport(url, repo, name, version, opts)` → zip bytes, `packageRemove` |
| Workspaces | `workspaceList`, `workspaceCreate(url, repo, ws, opts)`, `workspaceGet`, `workspaceStatus`, `workspaceLockStatus(url, repo, ws, opts)` → what holds the workspace and how far it says it has got (a deploy's files and records), or `null`, `workspaceRemove`, `workspaceDeploy(url, repo, ws, 'pkg@ver', opts, { schema?, allowDropRecords?, plan?, onProgress? })` — a job it polls, whose progress while `deploying` is the deploy's own, `workspaceExport(url, repo, ws, opts, { name?, version? })` → zip bytes |
| Datasets | `datasetGet(url, repo, ws, path, opts)` → `{ data, hash, size }` (a collection downloads as its segments), `datasetGetStream`, `datasetGetPage(…, window, opts)`, `datasetFindKey(…, query, opts)`, `datasetSet(url, repo, ws, path, beast2Bytes, opts)`, `datasetSetStream(url, repo, ws, path, { size, hash, slice }, opts, { onCommitProgress? })` — a file of any size, the server's commit saying how far it has taken it in, `datasetList`, `datasetListAt`, `datasetListRecursive`, `datasetListWithStatus`, `datasetGetStatus` |
| Runs and tasks | `dataflowExecute(url, repo, ws, { force?, filter? }, opts, { pollInterval?, timeout? })` → the result (or `dataflowExecuteLaunch` and `dataflowExecutePoll`) — `force` is `true` or the names of the tasks to re-run, `filter` one task's exact name, `dataflowCancel` — with nothing running, `dataflow_error` ("No active execution for this workspace"), `dataflowGraph`, `dataflowBudget`, `taskList`, `taskGet`, `taskExecutionList`, `taskLogs(url, repo, ws, task, { stream?, offset?, limit? }, opts)` |
| Functions | `functionList`, `functionDescribe`, `functionCall(url, repo, pkg, version, fn, { args, runner, limits }, opts)` — the function runs on its own runner for any caller (`runner: none`); a runner the call names is never `custom`, and loads a platform package the function's does not only for an elevated caller; `workspaceFunctionList`, `…Describe`, `…Call(url, repo, ws, fn, request, opts)`; `oneShotExecute` — a reader runs a platform-free one (stock runner, `platforms: []`, no platform call), and its result names the datasets it read (`inputs`); `splitCall(url, repo, ws, { bodyIr, args, output, then, runner, limits }, opts, { onProgress? })` — a program over a dataset's pieces, as a job it polls, under the same rule (or `splitCallLaunch`, `splitCallStatus` and `splitCallExplain`) |
| Records | `workspaceRecordDescribe`, `workspaceRecordMutate(url, repo, ws, record, mutation, { args, actor, limits }, opts, idempotencyKey?)`, `workspaceRecordHistory(url, repo, ws, record, limit, opts, from?)`, `workspaceRecordCompact` |
| From East | `Platform` and the `platform_*` functions (`platform_dataset_get`, `platform_dataflow_execute`, …): the same calls as platform functions, for an East program that drives a server |

**`@elaraai/e3-core`** does the same on a local repository, given a storage
backend (`new LocalStorage()`) and the repository's path; work that runs East
takes a runner, `new LocalTaskRunner(repo)`.

| Area | Functions |
|---|---|
| Repositories | `repoInit(path)`, `repoFind(startPath?)`, `repositoryOpen(storage, repo)` (checks the repository and applies the upgrades it owes), `repositoryUpgradeStep(storage, repo, { budgetMs, waitMs? })` → `{ owed }` — a host's job applies them so, a part per run under its time limit, each part taking a step up where the last stopped, `repoGc(storage, repo, { dryRun?, minAge?, keepRuns?, keepDays?, retention? })` — holding the repository still, or, with `retention: { windowMs }`, beside running work: an object goes once unreachable for the window and not written or re-referenced since; `repoGcStep(storage, repo, step, { windowMs, … })` runs that one step at a time, each returning the next (`GcStepType`) |
| Packages | `packageImport(storage, repo, zipPath)`, `packageExport(storage, repo, name, version, zipPath)`, `packageList`, `packageRemove` |
| Workspaces | `workspaceCreate(storage, repo, ws)`, `workspaceDeploy(storage, repo, ws, pkgName, pkgVersion, options?)` (`runner`: its migrations, index builds and intake units; `sourceConcurrency`: the `file` sources taken in at once; `onSourceProgress`, `onDeployProgress`: how far it has got), `workspaceExport(storage, repo, ws, zipPath, name?, version?)`, `workspaceStatus(storage, runner, repo, ws)`, `workspaceLockStatus(storage, repo, ws)`, `workspaceRemove` |
| Datasets | `workspaceGetDataset(storage, repo, ws, treePath)`, `workspaceSetDataset(storage, repo, ws, treePath, value, type)`, `datasetAdoptFile(storage, repo, ws, treePath, file, { runner, onProgress? })` → `{ hash, size, segments, rows, taken, runners? }`, `taken` being `known`, `carried` or `taken` (by the `runners` named) |
| Runs | `dataflowExecute(storage, repo, ws, options?)`; `LocalOrchestrator` to start, poll and cancel a run |
| Records | `recordMutate(storage, runner, repo, ws, record, mutation, args, { actor })`, `recordHistory`, `recordDescribe`, `recordCompact`, `recordReindex` |

`@elaraai/e3-core/test` exports the contract suites another storage backend runs
over itself.

**`e3-api-server`** serves repositories: `--repos <dir>` (each subdirectory a
repository) or `--repo <path>` (one, served as `default`), `-p`/`--port` (3000),
`-H`/`--host` (localhost), `--cors`, `-j`/`--memory` (the server's budget, for
every run and call it serves and every upload it takes in), and auth — `--oidc`, a built-in provider for `e3
auth login` (`--token-expiry`, `--refresh-token-expiry`), or an external JWT
issuer (`--auth-key`, `--auth-issuer`, `--auth-audience`). In code,
`createServer({ reposDir | singleRepoPath, port, host, … })` starts one, and its
route factories mount on another host.

## Running e3 in a browser — `@elaraai/e3-web`

e3-web runs e3 entirely in a page, with no server: a repository kept in the
browser's own storage (records in IndexedDB, objects in OPFS, locks through
Web Locks), every East program on a pool of Web Workers, and e3's whole API
answered in the page by e3-api-server's own routes. An app is three scripts:

```typescript
// unit.worker.ts — where East programs run: east-web-std answers for east-node-std's
// platform functions, and e3's own (e3-api-client's Platform) reach the e3 worker
import { serveUnits } from '@elaraai/e3-web/units';
serveUnits();
```

```typescript
// e3.worker.ts — e3 itself: its storage, orchestrator, runner and API
import { serveE3 } from '@elaraai/e3-web/worker';
serveE3({
  units: () => new Worker(new URL('./unit.worker.ts', import.meta.url), { type: 'module' }),
});
```

```typescript
// main.ts — the page: e3-api-client's calls, every one answered by the e3 worker
import { createWebE3 } from '@elaraai/e3-web';
import {
  dataflowExecute, packageImport, repoCreate, repoList, workspaceCreate, workspaceDeploy,
} from '@elaraai/e3-api-client';

const e3 = await createWebE3(new Worker(new URL('./e3.worker.ts', import.meta.url), { type: 'module' }));
const opts = { token: null, fetch: e3.fetch };

// The first visit makes the repository; later visits find it where they left it.
if (!(await repoList(e3.apiUrl, opts)).includes('default')) {
  await repoCreate(e3.apiUrl, 'default', opts);
  // The package zip e3.export wrote at build time, served beside the page
  const zip = new Uint8Array(await (await fetch('/sales-planning-1.0.0.zip')).arrayBuffer());
  const { name, version } = await packageImport(e3.apiUrl, 'default', zip, opts);
  await workspaceCreate(e3.apiUrl, 'default', 'main', opts);
  await workspaceDeploy(e3.apiUrl, 'default', 'main', `${name}@${version}`, opts);
  await dataflowExecute(e3.apiUrl, 'default', 'main', {}, opts);
}
```

`e3.apiUrl` is `https://e3-web.invalid`, an origin reserved so that a request
sent without `e3.fetch` fails rather than reaching the network, and
`e3.fetch`, the global `fetch`'s signature, is answered by the e3 worker. Both
go to e3-api-client (`RequestOptions.fetch`) and to e3-ui-components'
`<E3Provider>` (`E3Config.fetch`: the **e3-ui** skill). An app's own platform
package is served beside the standard ones:
`serveUnits({ platforms: { '@acme/pricing': PricingPlatform } })`.

| `serveE3` option | Default | Effect |
|---|---|---|
| `units` | — | starts a unit worker: a Web Worker whose script calls `serveUnits()` |
| `persist` | `true` | `false` keeps repositories in memory, gone with the page |
| `name` | `'e3'` | the storage's name: e3 workers of one name share their repositories, in one tab or several |
| `identify` | none | each request's caller, `{ sub, email?, roles }`, from the request; a request to a repository whose caller it does not identify is answered 401. None: the page's one caller may do everything |
| `access` | `oneShotAccessByRoles()` with `identify`, else `any` | the grant a caller holds for a one-shot, a split call, or a function call naming its own runner |
| `wholeIntakeLimit` | 256 MiB | the largest delivery one intake unit takes in whole |

What works is the API, as the local server answers it: every API suite of
e3-api-tests passes against it in Chromium, as an admin and, in its reader
cases, as a reader. Paged reads and key search, function calls, one-shot and
split calls, record mutations, deploys that migrate records or build indexes,
uploads, package import and export, gc, and dataflow runs — tasks in parallel
up to the pool's width (the cores), split tasks in pieces, re-run reactively.
A repository outlives a reload, and two tabs share an origin's repositories as
two processes share a directory. A closed tab's locks are free; a run it left
is taken as one whose process died, the next run served what finished from
the cache; and a job or an upload's commit it left is recorded failed, never
run again.

What a browser cannot do — each fails naming it, never a partial answer:

- **Commands.** A custom task, or a task on the `custom` runtime, is recorded
  `error`: "a browser runs no commands".
- **Platform functions with no browser meaning.** east-web-std has no
  FileSystem, Env or large-JSON reader, and east-node-io and the python
  packages have no browser equivalent: a unit calling one fails naming the
  function, and one listing a package its worker does not serve fails naming
  the package.
- **Segments on demand.** A unit's inputs are staged whole into its worker:
  waiting for a segment needs a cross-origin isolated page, which GitHub Pages
  cannot give. Split a large input into pieces with `e3.partition`, which
  bounds a unit's memory anywhere; a delivery that cannot be cut into pieces
  is refused above `wholeIntakeLimit`, naming the fix.
- **A memory budget.** Memory is not measured: the pool is as wide as the
  cores, there is no `--memory`, and no record names a peak.
- **The CLI.** `e3` drives e3 over HTTP, which an in-page e3 does not serve.

## A local repository

```
repo/
├── repository.beast2  # the release that last wrote it, and the upgrades it has had
├── repository-upgrade.beast2  # while an upgrade is under way: where its last part stopped
├── metadata.beast2    # its name and status
├── objects/           # content-addressed: values, segments, manifests, programs
├── packages/          # package refs
├── workspaces/        # each workspace's state, dataset refs, and its latest run's state and events
├── dataflows/         # run records
├── executions/        # execution attempts: status, owner, logs
├── adoptions/         # the manifest each delivered file, or piece of one, became
├── locks/             # locks, their holders, and how far each says it has got
├── gc/                # gc beside running work: unreachable notes, a stepped run's parts
├── envs/              # built execution environments
└── tmp/               # scratch and staged uploads
```

An e3 opening a repository an older release wrote applies the upgrades it has
not had, in place; one a newer e3 upgraded is refused, naming that release.

**Caching.** An execution is keyed by its task — program, runner and
environment — and its inputs' hashes, so a task re-runs only when one of those
changes (`--force` bypasses the cache, and `--force-task <task>` for the tasks
it names: a task whose code e3 cannot see changed, such as a platform
function's, or one reading data from outside e3). A change to an input re-runs its
consumers, even during a run. A split task is cached a unit at a time: each piece
and each merge is its own execution, and pieces are cut by content, so an append
or an insertion re-runs only the pieces it reaches and the merges above them.

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
