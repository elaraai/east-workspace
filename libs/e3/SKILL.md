---
name: e3
description: "East Execution Engine (e3) - durable, content-addressed dataflow for East programs. Use when: (1) authoring a package with @elaraai/e3 (e3.input, e3.task, e3.streamTask with e3.output and e3.partition for bounded memory and work split over an input, e3.customTask, e3.function, e3.package, e3.export, East.importFunction), (2) records - audited state written only through mutations, declared whole in one e3.record(name, type, { initial, indexes, mutations, migrations }) call: mutation.reduce/edit/patch; index.on/key/keys, index.interval / index.area for reads by a time window or a 2D window, index.series / index.summary for a block of keys over a span of time tiles and their totals, and index.nested for what a record's rows nest — jobs, a value a day, child rows, trees — filed item by item, with totals and parents' subtotals; and migrated between versions (migration.value/rows/rekey, in order), (3) the e3 CLI (repo, package, workspace, dataset, task, dataflow run, run, call, mutate, seed, history, reindex, compact, watch, convert, auth) and the cores and memory a run may use (-j, --memory), (4) driving e3 from code: @elaraai/e3-api-client against a server, @elaraai/e3-core on a local repository, e3-api-server, (5) caching, reactive re-runs and garbage collection, (6) delegating local task bodies to a rack: e3 rack enroll/policy, dataflow run --rack, watch --start --rack, optional e3-api-server --rack, (7) e3 in a browser, no server: @elaraai/e3-web (serveUnits, serveE3, createWebE3) and what a browser cannot do. UI tasks are e3-ui's ui()."
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
│   ├─ Audited state             → e3.record(name, type, { initial?, indexes?, mutations?, migrations? }), declared whole
│   │   ├─ Its writes            → mutations: (mutation) => ({ name: mutation.reduce | edit | patch })
│   │   ├─ An order to page in   → indexes: (index) => ({ name: index.on([...fields]) | index.key(fn) | index.keys(fn) })
│   │   ├─ Read by a time window or a 2D window → index.interval | index.area
│   │   ├─ Read a block of keys over time tiles, or their totals → index.series | index.summary
│   │   └─ Read what rows nest (jobs, a value a day, child rows, trees) a tile at a time, with totals and subtotals
│   │       → index.nested({ collections, tile, summary? })
│   ├─ A record's type changes   → migrations: (migration) => [migration.value | rows | rekey(name, fn), …], in order
│   ├─ A UI task                 → ui(name, [inputs], fn) from @elaraai/e3-ui (the e3-ui skill)
│   ├─ A function written in python or another node package → East.importFunction(pkg, name, FunctionType) in the body
│   └─ Bundle and export         → e3.package(name, version, ...items); e3.export(pkg, zipPath)
├─ Operate it from the shell     → the e3 CLI (below): deploy, run, read and write datasets, mutate records, gc
├─ Delegate local task bodies to a rack → e3 rack enroll + policy; dataflow run --rack, watch --start --rack
└─ Drive it from code
    ├─ A server, over HTTP       → @elaraai/e3-api-client
    ├─ A local repository        → @elaraai/e3-core
    ├─ Serve repositories        → e3-api-server --repos <dir>, or createServer()
    └─ e3 in a browser, no server → @elaraai/e3-web: serveUnits, serveE3, createWebE3 ("Running e3 in a browser")
```

## Rack delegation from a local repository

**Setup and routing**

| Signature | Description | Example |
| --- | --- | --- |
| `e3 rack enroll --listen <host:port> [--allow <ip,...>] [--advertise-url <origin>] [--label <label>] [--no-wait]` | Starts the user-wide hub and prints the source origin, the hub's certificate SHA-256, the matching release and a single-use token for the companion's hidden prompts. Waits for a new registration, not activation. Behind an SSH reverse tunnel, listen on the loopback and advertise the relay's origin. | `e3 rack enroll --listen 127.0.0.1:7331 --allow 127.0.0.1 --advertise-url https://relay.example:7401` |
| `e3 rack policy [repo] set <glob> rack\|local [--size <size>] [--timeout <min>] [--allow-host-access]` | First whole-task-name match wins; `*` and `?` are wildcards. Size: serverless, small, medium, large, xlarge. | `e3 rack policy . set 'train_*' rack --size large` |
| `e3 rack policy [repo] enable\|disable\|mode <opt-in\|auto>` | Enable/disable saved opt-in; `mode auto` selects eligible unmatched tasks. Defaults: disabled, opt-in. | `e3 rack policy . enable` |
| `e3 rack policy [repo] defaults [--no-spill] [--claim-timeout <sec>] [--retry-task-failures-locally]` | Defaults: large, 1440-minute timeout, spill on, 30-second claim recheck, no task-failure retry. | `e3 rack policy . defaults --no-spill` |
| `e3 rack policy [repo] show\|unset <glob>\|reset` | Inspect rules, remove an exact pattern, or delete the saved policy. | `e3 rack policy . show` |
| `e3 dataflow run <repo> <ws> --rack\|--no-rack\|--rack-only` | Select rack routing for this run; rack-only disables capacity spill but keeps infrastructure fallback. ❗ Refused for remote URLs. | `e3 dataflow run . dev --rack` |
| `e3 watch <source> <repo> <ws> --start --rack` | Reuses a rack session across watch runs and refreshes capacity; a second Ctrl-C stops the watch at once. ❗ `--rack` and `--rack-only` require `--start`. | `e3 watch src/main.ts . dev --start --rack` |
| `e3 rack status\|list\|remove <id-or-label>\|approve <id-or-label>\|stop` | Inspect fleet, revoke a rack, admit the boot a quarantined rack last reported, or stop the shared hub. Status never starts an absent hub. | `e3 rack status` |
| `e3 rack config [--listen <host:port>] [--allow <ip,...>] [--idle-exit <min>] [--advertise-url <origin>] [--tls\|--no-tls] [--require-approval\|--no-require-approval]` | Configure the shared listener (off by default; HTTPS with the hub's own certificate unless `--no-tls`); every rack and data URL is built on `--advertise-url` when set; zero idle-exit disables automatic shutdown; `--require-approval` quarantines a rack after each reboot until `e3 rack approve` admits it (enrollment admits the first boot). ❗ Plain HTTP only on the loopback or a private address, with `--allow`. | `e3 rack config --listen 10.0.0.5:7331` |

The local process owns graph planning, repository and cache. After a cache
miss, eligible plain task, map and merge bodies can execute on the rack; input
closures and every output object transfer by hash. The session verifies the
whole output graph before success. Placement never changes task/cache hashes.
Local bodies and fallback share the original cores/memory budget; rack bodies
use remote capacity. Calls, mutations and intake stay local. Stock runner
configurations qualify; commands, custom environments/platforms and unscannable
IR stay local. Host file/environment/network access stays local unless a rule
deliberately grants `--allow-host-access` and its resources exist on the rack.

The listener serves HTTPS with the hub's own self-signed certificate, made on
first use and kept in `hub-tls.beast2`; a rack pins it by its SHA-256, which
enrollment prints, so TLS runs end to end through any relay or tunnel. The
usual path is an SSH reverse tunnel from the developer machine to a relay the
rack reaches, with the hub on the loopback (`--allow 127.0.0.1`) and the relay's
origin advertised. Removing the certificate file, with the hub stopped, makes a
new one, which every worker must then pin again. `--no-tls` is for a TLS
terminator in front of the hub; the hub refuses plain HTTP on a wildcard or
public address, or without `--allow`. A listener on every address needs
`--advertise-url` to enroll.

The handoff targets a prepared independent worker VM with the matching verified
`e3-rack` release. Its `configure --allocation <host-provisioned-path>` prompts
for the source origin, the certificate SHA-256 for an HTTPS origin the hub
serves, the worker label and settings; `enroll --allocation <path>` prompts for
the one-time token. Origins, pins and credentials are encrypted together. A
plain-HTTP origin needs `--allow-vpn-http` on both commands and host
authorization for that exact endpoint, and belongs only on a path encrypted end
to end, such as an SSH tunnel, never across a VPN hub that decrypts traffic.
Never put a source address or token in worker command arguments or plaintext
files. The local mint intentionally displays its token; do not log that output.

Enrollment does not start services or authorize task claims. The local CLI
observes a new registration (optionally filtered by label); compare it with the
worker's result. Before a first heartbeat, status is `enrolled-not-started`.
After managed resume, a ready heartbeat advertises free plus occupied slots;
busy workers stay eligible. Fenced, draining or stopping workers withdraw their
capacity and show `unavailable`. After 45 seconds without a heartbeat, readiness
expires; lease polling cannot prolong it. Source boot approval, when required,
remains an additional gate. This advertisement does not authorize host resource
admission or removal of service/network quarantine.
Resources and mutable whole-GPU assignments belong to the host lifecycle, not
local enrollment flags. The companion accepts up to 32 mutually trusted sources
in one worker. After draining and stopping its services and sockets, use
`configure --allocation <path> --add-source`, confirm the shared trust boundary,
and enter the additional origin privately. It prints the new source UUID for
`enroll --allocation <path> --source <UUID>`; add `--allow-vpn-http` to both for a
plain-HTTP origin. All sources must be enrolled before startup. Each has its own identity,
client, cache and completion journal; actual execution shares one worker-wide
task/GPU limit. Per-source capacity reports are not additive reservations.
A worker is the trust boundary: a shared agent process can access all its
sources' credentials, so separate clients, and a cloud deployment and developer
hubs, need separate worker VMs. The hub keeps no task data; what a worker keeps
between tasks is its own policy, and an agent that keeps nothing works unchanged. Worker-local `source list --allocation <path>`
prints UUIDs/enrollment status; `--show-origins` adds origins only on a terminal.
After drain/stop and source-side revocation, `source remove` or `source reset`
with `--allocation <path> --source <UUID> --acknowledge-revocation` asks for UUID
confirmation. Reset prints a new UUID for fresh enrollment; old pending results
and caches stay in the retired namespace. Other sources and retained data are
preserved, and host endpoint policy must be reconciled before activation. The
flag acknowledges revocation; it does not revoke remotely.

Worker-local `registry status --allocation <path>` reports only whether encrypted
registry credentials are present; it can run while active and does not test access.
After drain/stop, `registry configure --allocation <path>` privately prompts for
username/token without re-entering settings. `registry clear --allocation <path>`
asks for the installation UUID and removes only the stored access. Both require
the same release, the writer lock and no unresolved enrollment/service transition;
they preserve current identities, rotations, settings, journals and cached data.
Credentials stay in the existing encrypted bundle, with no Docker login file.
A later activation receives them; services remain stopped and the next boot fenced.
Repeating configure with the same values or clear when absent does not write.
Clearing/replacing does not revoke a token remotely or purge cached images.

The companion's
`reconcile-services` applies a host-provided next allocation and service budgets
after a completed drain, with stopped units, the previous plan hash and exact
operation/boot binding. It retains ciphertext/journals and network quarantine;
it does not move a GPU, start a worker or change its executable release. For a
compatible release change, invoke the target verified executable's `switch-release`
with the same drain/plan bindings and unchanged resource budgets at the next
allocation generation. It checks both managed-state contracts, updates only the
runtime version in the current encrypted configuration, and preserves identities
and journals through interruption or downgrade. Both four-file releases must stay
available; a downgrade is a new operation, never a saved-state restore. Services
stay stopped and quarantined. If the selected release never resumed, the exact
recorded previous executable's `recover-release` binds the completed release
receipt, current plan and new operation at another generation increase. It
requires the original drain or a valid fenced journal with no operation at the
failed generation, verifies both releases' recorded hashes, and preserves current
credentials and journals. A prior resume attempt, even across reboot, refuses
recovery. General journal repair remains unfinished. Named host management, source aliases, network
activation, incompatible-state migrations and hardware acceptance remain
companion cloud #253 work. This and durable completion retry are implemented in
companion PR #254, separately from the original main protocol pin.

Policy is `<repo>/rack/policy.beast2`; hub state is `~/.e3/rack` (or
`E3_RACK_HOME`). A hub `dataflow run` starts exits after 15 idle minutes, and a
run waits up to 10 seconds for an enrolled rack to report healthy (with none
enrolled, or a policy that selects no task for a rack, it starts at once): run
`e3 rack hub` as a service, or set `--idle-exit 0`, for a hub racks can always
reach. A data URL lasts 15 minutes, which a transfer may use whole; an object is
at most 5 GiB. The control schema currently requires protocol 2 exactly.
Agents must report bundled e3 at least the project's release. Infrastructure
failure falls back locally with a separate execution attempt, as does an
attempt the rack stopped on its own; the run's own cancellation and the task's
timeout never do. One cancelled subscriber does not stop work shared by other
sessions of the same canonical repository and e3 release.

**Programmatic attachment** (`@elaraai/e3-rack`)

| Signature | Description | Example |
| --- | --- | --- |
| `openRackRunner({ repoPath, workspace, storage, label, budget?, settings?, policy?, rackOnly? })` | Opens a runner/session; preserve the caller's existing budget and process settings, use `rackSlots` to extend orchestrator width, and close in `finally`. | `const rack = await openRackRunner({ repoPath, workspace: 'dev', storage, label: 'run', budget });` |
| `createDataflowRunnerFactory(options?)` | Pass to `createServer({ dataflowRunner })`; one session per API dataflow, using the server's shared budget. Explicit server opt-in overrides policy.enabled; rules still apply. | `const server = await createServer({ reposDir: './repos', dataflowRunner: createDataflowRunnerFactory() });` |

The API server's optional rack package is needed only for
`e3-api-server --repos ./repos --rack`. Portable handlers receive a runner
factory and do not import hub code. Custom environments, remote function
delegation, automatic reconnect after hub restart and embedded UI integration
are deferred.

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
  locations kept so an error or a profile names the function's own lines. A uv
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
| `e3.function(name, fn, { runner?, environment? })` | A named function, called by name with arguments (`e3 call`, the API) and its result returned inline: not in the dataflow, and a call persists nothing. An argument is a value, or in a call through a workspace one of its datasets, read where it is stored. A server bounds a call by a timeout and a 1 MiB result, so long work belongs in a task. A `custom` runner must speak the runner CLI (`<command> -i <arg>… -o <out> <ir>`). |
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

#### Secondary indexes — `index.on([...fields])`, `index.key(fn)`, `index.keys(fn)`

A second collection over a Dict record, in another sort order, maintained in the
same commit, so a view by an attribute is a page rather than a scan.
`index.on([...])` names row fields in index order: one field uses its value as
the key, several use a Struct in that order, and a Set field gives an entry per
element. It also carries field metadata for `Data.bindPaged(record, { indexes })`
and `Slice.bindRecord` (see **e3-ui**). `index.key(fn)` gives one computed entry
per row; `index.keys(fn)` returns a Set, one entry per element (a row naming five
resources appears five times, an empty set not at all); the `value` option of
each is a projection a view renders without touching the record. The functions
are pure and synchronous, since an index maintained commit by commit must equal
its rebuild to the byte. Its name — its key in `indexes` — is an identifier,
never `primary` (the record's own order). Read through one with `index=<name>` on a page or key search; `e3
reindex` rebuilds. A deploy builds an index the package declares and the state
lacks, drops one it no longer declares, and runs nothing for the rest; a build
is a split task over the record.

```typescript
const plans = e3.record('plans', PlansType, {
  initial: new Map(),
  indexes: (index) => ({
    by_due: index.on(['due']),
    by_owner_due: index.on(['owner', 'due']),
    by_owner: index.key(East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.owner), {
      value: East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.title),
    }),
    by_resource: index.keys(East.function([StringType, PlanType], SetType(StringType), ($, _id, plan) => plan.resources)),
  }),
  mutations: (mutation) => ({ /* add_plan, reschedule, patch — above */ }),
});
const pkg = e3.package('planning', '1.0.0', plans);   // the record whole: its indexes and mutations with it
```

#### Interval and area indexes — `index.interval`, `index.area`

These indexes answer more than an order — as do the series and summary indexes
below — each with a builder method of its own whose keys the SDK generates.
Underneath each is an ordinary index — the same build,
mutation, storage, paging and `e3 reindex` — and the record Slice reads a
window through either (see **e3-ui**). Their generated keys are query
machinery: edits and sessions always target the record's primary key.

A generated key is a struct whose own fields are e3's: `on` holds the
declaration's leading fields, by their names, at their key types (a Set field's
element type) — a struct with no fields when it lists none — and the kind's own
parts sit beside it. So no name is reserved: a row may name a field anything,
`area`, `tile` and `__area` among them, and an index may be led by it.

| Index | Key | e3's parts |
|---|---|---|
| interval | `{ on, node, at }` | the tree node an entry is filed at; the instant it is ordered by, at the `from` field's type |
| area | `{ on, area }` | the cell's Morton code times 32 plus its level; −1 for a row not yet placed |
| series | `{ on, key, level, tile }` | the value of the field `key` names; the level an event is filed at, and the start of that level's tile (#1433) |
| summary | `{ on, key, tile }` | the value of the field `key` names; the tile's start |

A definition's `on` is the leading fields alone; its kind's options say the
rest (`events.indexes.by_time.interval`, `racks.indexes.racks_by_area.area`,
`jobs.indexes.jobs_by_press_week.series`).

**`index.interval({ on?, from, to })`** keeps events visible while they
overlap a selected time window. `from` and `to` are the row's DateTime or
Option<DateTime> fields; optional `on` fields are exact leading choices:

```typescript
const events = e3.record('events', EventsType, {
  initial: new Map(),
  indexes: (index) => ({
    by_time: index.interval({ from: 'start', to: 'end' }),
    by_status_time: index.interval({ on: ['status'], from: 'start', to: 'end' }),
  }),
});
```

Its key is `{ on, node, at }`. It stores at most three entries per event per
leading-field combination, independent of duration. The record Slice adapter resolves a half-open
`[from, to)` window with at most 55 disjoint bounded queries per exact prefix;
each matching original record occurs once, including events that started
earlier or span the whole window. It never scans the record or guesses a
maximum duration. An event ending at `from` is outside; an instant at `from`
is inside and one at `to` is outside. A missing or non-positive end is an
instant. A missing start remains selectable as Unset/backlog.

Use `on: ['start']` only when the intended query is **starts within**, since it
cannot preserve carry-in events. When both declarations are available, a Slice
range on the start field uses the interval declaration. The generated interval
keys are query machinery; record edits and sessions always target the original
primary key. Calendar's `Calendar.events(binding, { slice, entries, … })`
requires a matching interval declaration and the primary `entries` binding to
confirm saves even after an edit leaves the selected window.

**`index.area({ on?, x, y, width?, height?, at?, cell })`** reads the rows
whose box meets a 2D window — what a floor plan's viewport shows — the interval
index's twin:

```typescript
// RacksType: Dict<String, { hall: String, x: Option<Float>, y: Option<Float>, w: Float, h: Float }>
const racks = e3.record('racks', RacksType, {
  initial: new Map(),
  indexes: (index) => ({
    racks_by_area: index.area({ x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }),
    racks_by_hall_area: index.area({ on: ['hall'], x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }),
  }),
});
```

| Option | The box's |
|---|---|
| `x`, `y` | place: two Float fields, or two Option<Float> fields whose `none` is a row not yet placed |
| `width`, `height` | size: two Float fields, or neither for a point |
| `at` | `'corner'`, the default — `x`, `y` is the box's minimum corner, as a zone's is — or `'centre'`, as an item's is |
| `cell` | finest cell: its side in world units, about the smallest thing drawn — 0.01 for a floor in metres, 1 for one in millimetres. It is rounded down to a power of two, so the keys' arithmetic is exact on every runtime, and has no default: a wrong one costs a silent tenfold read |
| `on` | exact leading fields, as the interval index's; a Set field fans out |

Each option takes only the row's fields of its type, so a wrong one does not
compile, and the definition checks them again, naming the option, the field and
its type. The domain is the square ±`cell`·2²⁷ world units around zero
(±1,048 km at a 0.01 cell, which rounds to 2⁻⁷), in 29 levels. Each row is
filed once, under the deepest level whose cell is at least twice its box's
larger side, in the cell holding its box's centre: the key
`{ on, area: Integer }`. A row not yet placed files under `area` −1, which the
record Slice reads as the unplaced clause; one outside the domain, not finite,
or larger than half of it files under the root, which every window reads. The index **carries its rows**: each
entry's projection is the whole row, so a window reads the index alone and no
record segment, and it takes no `value`. The record Slice reads a viewport,
grown by an eighth of its larger side on each side, as at most 266 disjoint
searches per exact prefix, sent in one request, which together hold every row
whose box meets it, each once — beside rows of the cells searched that it
misses, which the reader draws or not.

#### Series and summary indexes — `index.series`, `index.summary`

What a planning board reads: the events on a block of keys — a Plan's
resources — over a span of time, and, zoomed out past what a screen can draw,
how busy each key is. Both file a row's event by the key it is on and by time
tiles — `day`, `week` (ISO, from Monday), `month`, `quarter` or `year`, in UTC,
half-open — the key before the time, so a key's entries over any span are
contiguous: a series index's `{ on, key, level, tile }`, a summary index's
`{ on, key, tile }`.

```typescript
// JobsType: Dict<String, { press: String, start: Option<DateTime>, end: Option<DateTime>, … }>
const jobs = e3.record('jobs', JobsType, {
  initial: new Map(),
  indexes: (index) => ({
    jobs_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
    jobs_by_press_month: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'month' }),
  }),
});
```

| Option | |
|---|---|
| `key` | the field naming what an event is on: any field but a Set |
| `from`, `to` | the event's start and end: DateTime or Option<DateTime> fields. A row with no start is filed nowhere; no end, or one at or before the start, is an instant |
| `tile` | a series index's finest level, and a summary index's tile: `day`, `week`, `month`, `quarter` or `year` |
| `on` | exact leading fields, before the key; a Set field fans out |

**A series index** is an ordinary index whose keys the SDK generates, and it
**carries its rows**, as the area index does. It files each event **once**, at
the finest level from its `tile` up to the year whose shortest tile holds the
event's length — a day, a week, 28 days, 90 days, 365 days — under that level's
tile holding its start; an instant at `tile`; past 365 days, under each year it
touches. An event filed at a level ends within the tile after the one holding
its start, so a reader reads a block of keys over any span from the index alone
as one range a key a level — that level's tiles from two before the span to one
after it — in one request, whatever the span's width. **A summary index** holds,
under each key and tile, `{ count, ms }`: how many rows touch the tile, and the
milliseconds of it they cover — a row's shares
add up to its length, and an instant's is none. Each entry stands for every row
of its key and names none, so its window's `key` is Null, a read of it joins
nothing, and a read that needs its rows — a joined read, a placement
(`datasetPlace`) or a membership read (`datasetWithin`) — is refused, naming the
index; the record's describe says it is a summary. A write
changes its totals by what its rows took away and gave — its program reads the
record, never the summary — and the apply adds that to each total, dropping one
whose count reaches zero; the totals are Integers, so a maintained summary is the
one `e3 reindex` sums, byte for byte, and a build split into pieces adds the
pieces' totals of a key. A change that would leave a total no rebuild sums — a
count below zero, or time with no row — fails the write, naming the total and
`e3 reindex`, which rebuilds it; a total past the largest Integer fails the
write or the build, naming a finer tile.

A series index files an event past a year under each year it touches, as many
as 4,096: one touching more is refused where it is written, naming it and its
span. A summary splits an event over its tiles, as many as 4,096 — eleven years
of days — and one touching more is refused the same way, naming the tile:
declare a coarser tile. Each option takes only the row's fields of its type, as
the area index's do, and the definition checks them again; a `value` is
refused, and so is an `on` field that is the key, the start or the end: the key
follows the leading fields, and the tiles are cut by the start and the end.

#### Nested series indexes — `index.nested`

What a planning board reads when a record's rows nest what it draws: a
machine's jobs and its load a day at a time, a hall's members, an assembly's
parts to any depth. One declaration a record lists every collection its rows
nest, each field with a builder saying what it holds. e3 files each item apart
from its row — once, by its collection, its row, its node and its time — keeps
each node's totals a summary tile at a time, and each parent's subtotals at
every level; and the record's other indexes carry the rows without those
collections, so a page of rows reads none of them and a window of items reads
no row.

```typescript
// MachinesType: Dict<String, { name, site, status, jobs: Dict<String, Job>, load: Dict<DateTime, Float> }>
const machines = e3.record('machines', MachinesType, {
  initial: new Map(),
  indexes: (index) => ({
    machines_in_time: index.nested({
      collections: {
        jobs: index.nested.items({ from: 'start', to: 'end' }),  // things people drag: by id, their times fields
        load: index.nested.values(),                              // a value per instant: keyed by the instant
      },
      tile: 'week',
      summary: 'month',
    }),
    machines_by_site: index.on(['site']),                         // pages each machine without its jobs and load
  }),
});
// Each member's load, and each hall's mean of its members', at every level from the day up.
const halls = e3.record('halls', HallsType, {
  indexes: (index) => ({
    halls_in_time: index.nested({
      collections: { members: index.nested.rows({ load: index.nested.values({ rollup: 'mean' }) }) },
      tile: 'day',
      summary: 'month',
    }),
  }),
});
// Parts to any depth, each part's jobs filed under every part above it too.
const assemblies = e3.record('assemblies', AssembliesType, {
  indexes: (index) => ({
    assemblies_in_time: index.nested({
      collections: {
        parts: index.nested.rows({
          jobs: index.nested.items({ from: 'start', to: 'end' }, { rollup: true }),
          parts: index.nested.recursive(),
        }),
      },
      tile: 'week',
      summary: 'month',
    }),
  }),
});
```

| Builder (`index.nested.…`) | A field holding |
|---|---|
| `items({ from, to })`, `items({ at })` | `Dict<String, Struct>`: things people drag, by id; their times are DateTime or Option<DateTime> fields — no start files an item nowhere, no end (or one at or before its start) makes it an instant. `{ rollup: true }` files each under every ancestor too |
| `values({ rollup? })` | `Dict<DateTime, V>`: a value per instant. `rollup` keeps every parent's subtotals |
| `rows({ … })` | `Dict<String, Struct>`: child rows, their own collections declared the same way |
| `recursive()` | `Dict<String, Self>`: more rows like the one listing it, to any depth |

TypeScript types `collections` field by field from the record's type alone: a
misnamed time, or a builder on the wrong kind of field, is an error where it is
written, and its message says what fits. The definition checks the same again,
in words, for a declaration TypeScript could not see. A record has one nested
series index, which takes no `on` and no `value`.

**What it files.** Every entry is keyed `{ collection, row, path, run, level,
tile, item }` (e3-types' `NestedEntryKeyType`): the collection's place, the
field names from the row down (`members` then `load`); the row's key; the Dict
keys from the row down to the node (`[]` for the row, `m-3` for a member); the
run; the level and tile; and the item. A place and a path are held as a key
holds a list, folded from the last: `.step (key="members", rest=.step
(key="load", rest=.end))`. Each run of a node is one contiguous range a level:

| Run | Holds |
|---|---|
| `items` | each item once, as a series index files an event — at the level its length fits, past a year under each year — carrying it (`.item .jobs (…)`); a value, and an `{ at }` item, at the declared tile alone |
| `totals` | where `summary` is declared, each node's `{ count, ms, values }` a summary tile at a time; for a Float or Integer collection, `values` is the sum, the least, the greatest and the last there, taken in key order |
| `subtotals(rollup)` | for `values({ rollup })`, every parent's subtotal by each rollup at each level from `tile` to the year, where a descendant's value touches the tile: a node holding values folds its own, a parent aggregates its children's, in key order |
| `subtree`, `subtreeTotals` | for `items(…, { rollup: true })`, each item under every ancestor too, `.under (path, id)`, and each ancestor's totals of them |

A rollup is `'sum'`, `'mean'` (a mean of means up the tree), `'min'`, `'max'`,
`'count'` (the leaf rows beneath that hold a value), a fold and an aggregate
named apart (`{ fold: 'last', aggregate: 'sum' }`, a balance), or several.

**Reading.** A reader searches the index's leading fields — `[collection, row,
path, run, level, tile]`, each as East prints it — as a range a row a level: a
block of fifty machines' jobs over three weeks is fifty times four ranges in one
`datasetFindKeys` request, and one `datasetGetRuns` read of the entries they
select, each job carried whole; a parent's week subtotals are one range; a
part's subtree is one range a level.

**The lean rows.** Beside a nested series index, every other index of the
record that carries nothing or the row carries the row without the listed
collections — each listed collection empty, child rows kept with theirs empty —
so a page of rows read without a join reads no nested item and no segment of
the record's own. An index with a `value` of its own carries its own. A
binding of the record's indexes lists the nested index by name beside any that
carry the lean rows — `Data.bindPaged(machines, { indexes: ['machines_by_site',
'machines_in_time'] })` (see **e3-ui**).

**Its span.** Beside every nested series index e3 keeps its span, an index of
the record's named `<index>_span` (e3-types' `nestedSpanName`), built with it
and never declared: under each collection's place and each month its items or
values touch (`NestedSpanKeyType`, `{ collection, tile }`), how many of them
touch it and the milliseconds of it its items cover, summed across the rows as a
summary index's totals are, and a month let go once nothing touches it. A
collection's first and last month held are its span across the record — what a
Plan's horizon covers for the series reading it — and its months' counts are
how much it holds in each, which the horizon's strip draws as its bars (see
**e3-ui**). Reading it is one search a collection, an exact match on its
place, and one read of the first and last entry of each. An index the record
declares under that name is refused.

**Writes.** A row a write updates by a patch is maintained by the patch: e3
walks it along the declaration — each collection's Dict patch, and each child
rows' — and compares the entries of only the items it names, with the totals of
the summary tiles they touch and the subtotals of the tiles they touch at each
level. A replace on the way, which a recursive type's patch always is, and an
inserted or deleted row are compared whole. Both ways give the same delta, and a maintained
index is the one `e3 reindex` rebuilds, byte for byte.

#### Migrations — how a record's type changes

| Form | Function | Runs as |
|---|---|---|
| `migration.value(name, fn)` | `(Old) => New`, over any record | one unit; its runner opens the state lazily |
| `migration.rows(name, fn)` | a Dict's rows, `(K, V1) => V2` with the keys kept, or an Array's elements, `(T1) => T2` | a task split over the state: a piece at a time, in parallel, each piece cached |
| `migration.rekey(name, fn)` | a Dict's entries, `(K1, V1) => { key: K2, value: V2 }`, or a Set's elements, `(T1) => T2` | the same split task, its pieces merged by key: two Dict rows landing on one key fail the deploy, naming it; two Set elements are one |

A record's steps are one chain: the list `migrations` returns, in order, each
step taking the record as the step before it leaves it, and the last leaving it
as its declared type — each checked where the record is declared.
A step's name is an identifier, unique on the record, and a workspace records the
steps it has applied by name — so moving a step's code, or re-exporting it with a
newer e3, does not run it again, and an edit to an applied step's body is not
detected. The functions are pure, synchronous East.

```typescript
const RowV1Type = StructType({ title: StringType });
const RowV2Type = StructType({ title: StringType, owner: StringType });
const plans = e3.record('plans', DictType(StringType, RowV2Type), {
  initial: new Map(),
  migrations: (migration) => [
    migration.rows('add_owner', East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: 'unassigned' }))),
    // The next version adds its step here, after this one.
  ],
});
const pkg = e3.package('planning', '2.0.0', plans);
```

What a deploy does with each record, decided before it writes anything:

| The workspace holds | Against the package's chain | The deploy |
|---|---|---|
| no state | — | mints `$init` from the initial value, the whole chain counted applied; declared with no initial value, leaves it unassigned (`unassigned`) for `e3 seed` |
| state | every step applied, the type unchanged | keeps it, with a `$deploy` commit when the package changed |
| state | a proper prefix applied | runs the rest, a `$migrate:<name>` commit each |
| state | every step applied, but the type changed | refused: a type change needs a migration, or `--schema reset` |
| state | applied steps the chain does not start with | refused, naming the steps applied and those declared |
| a record the package no longer declares | — | refused unless `--allow-drop-records` |

`--schema <policy>` on `e3 workspace deploy` and `e3 watch`: `migrate` (the
default), `fail` (run no migration; refuse) or `reset` (reset the record to its
initial value, with a `$reset` commit (`reset`); one declared with no initial
value goes back to unassigned (`unassign`), for `e3 seed` again). `--plan` prints what the deploy would do
to each record, index and input and writes nothing — from a zip or a source it
imports nothing, and a server plans only a package it holds. The steps run
before the deploy writes: a failed step leaves the workspace as it was, and a
deploy run again is served the steps that finished from the cache.

What a deploy does with each input — a dataset an `e3.input` declares, which
people set:

| The input now | Its type | The deploy |
|---|---|---|
| holds the value the deployed package gave it, or is new | — | the new package's value (`package`) |
| someone set it | — | the new package's value under `--inputs reset`, the default, and says it reset it (`reset`) |
| someone set it | the new package's | kept, under `--inputs keep-edited` (`keep`) |
| someone set it | changed | the new package's value, and says why (`reset`) |
| the deployed package took it from a file, and it holds a value | — | the new package's value under either policy, since a value set since cannot be told from the file's, and says so (`reset`) |
| the new package takes it from a file | — | its file, as every deploy does (`file`); a deploy that reads no file, a server's, leaves it unset for its client to send |
| the new package no longer declares it | — | gone, with its value (`drop`) |

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
| `e3 workspace copy [repo] <from> <to>` | Make `<to>` what `<from>` is now — its package and every input, record and task output, so nothing runs again — made, or replaced whole with its runs. It writes refs only, so its cost follows the number of datasets, never their size; a write to either afterwards leaves the other as it was. Refused while a dataflow runs in `<to>`. |
| `e3 workspace deploy [repo] <ws> <pkg[@ver]>` | Deploy an imported package. |
| `… --from-zip <zip>` · `… --from-source <src.ts> [--functions <manifest…>]` | Import the zip (or bundle the source) and deploy, creating the workspace. |
| `… [--schema <policy>] [--inputs <policy>] [--allow-drop-records] [--plan] [--skip-file-sources] [-j <n>] [--memory <size>] [--quiet]` | A record's policy, an input's, and `file` sources; says how far it has got (below), `--quiet` aside. `-j`: the `file` sources taken in at once, and the runner processes their intake units, the migrations and the index builds run on; `--memory`: what those may reserve (local). |
| `e3 workspace export [repo] <ws> <zip> [--name <n>] [--version <v>]` | The workspace's state as a package. |
| **Datasets** | |
| `e3 dataset get [repo] <ws.name> [-f east\|json\|beast2]` | Print a value. |
| `e3 dataset set [repo] <ws.name> <file> [--type <spec> \| --type-file <path>]` | Write from `.east`, `.beast2`, `.json` or `.csv` (JSON and CSV need the type). |
| `e3 dataset set [repo] <ws.name> --from-file <path.beast2> [-j <n>] [--memory <size>]` | Take a beast2 file in as the value, as a deploy takes a `file` source in, saying how far it has got; `-j`, `--memory`: the budget its intake units run under (local). |
| `e3 dataset list [repo] <ws> [-l]` · `status [repo] <ws.name>` · `find [repo] <ws> <pattern>` | Paths (`-l`: kind, type, status, size) · one dataset · by substring or glob. |
| **Running** | |
| `e3 dataflow run [repo] <ws> [--filter <task>] [--force \| --force-task <task>…] [-j <n>] [--memory <size>] [-v]` | Run what is stale, then print the outputs' paths. `--filter`: one task, by its exact name, and the tasks it depends on. `--force`: re-run every task the run runs (under `--filter`, its task); `--force-task`, repeated for each: re-run the tasks it names, whose dependents re-run when an output changes. A task the graph lacks, or one `--filter` leaves out, refuses the run. A task whose input nothing has set — an input never set, or a record declared with no initial value and not yet seeded — is left waiting, with its dependents (`[WAIT]`, `Waiting:`), and the run completes without them; they run once it is set. |
| `e3 task list [repo] <ws>` | Tasks with the status of each one's latest run. |
| `e3 task logs [repo] <ws.task> [-n <lines>] [--all] [--follow] [--execution <task>/<inputs>/<id>]` | The last 200 lines by default, of the latest attempt over the task's current inputs, or its latest run; `--follow` stays on that execution; `--execution`: one unit's log, as a split task's log names it (local). |
| `e3 run <repo> <pkg[@ver].task> [inputs.beast2…] -o <out> [--force] [-v] [-j <n>] [--memory <size>]` | Run one task ad hoc. |
| `e3 call <repo> <pkg[@ver].fn> [args…] [-o <out.beast2>] [-j <n>] [--memory <size>] [-v]` · `e3 call <repo> -w <ws> <fn> [args…]` | Call a function; each argument is an `.east` literal or a `.beast2`/`.json`/`.east` file, and with `-w` one written `@<keypath>` (`@.inputs.sales`) is that dataset of the workspace, pinned at its hash when the call starts. |
| **Records** (`-w <ws>` required) | |
| `e3 mutate <repo> <record.mutation> [args…] -w <ws> [-j <n>] [--memory <size>] [-v]` | Apply a mutation. |
| `e3 seed <repo> <record> <file.beast2> -w <ws> [-j <n>] [--memory <size>]` | Commit a record's first state from a beast2 file, as its `$init`: for a record declared with no initial value, unassigned until then (local). The file is taken in as a `file` source is, never read whole; a record that holds a state is refused. |
| `e3 history <repo> <record> -w <ws> [--limit <n>] [--from <hash>] [--delta]` | Commits, newest first (`--delta`: what each changed, per target — a summary's totals added to as `±n`; local). |
| `e3 reindex <repo> <record> -w <ws> [--index <name>] [-j <n>] [--memory <size>]` · `e3 compact <repo> <record> -w <ws>` | Rebuild indexes (local) · collapse the history to a `$compact` root, the state kept. |
| **Development** | |
| `e3 watch <src.ts> <repo> <ws> [--start] [--schema <p>] [--inputs <p>] [--abort-on-change] [--functions <manifest…>] [-j <n>] [--memory <size>]` | Redeploy on each change (and run, with `--start`). |
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
`dataset set --from-file`, `dataflow run`, `run`, `call`, `mutate`, `seed`,
`reindex` and `watch` — take the flags for a local repository; against a server the CLI
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
**Where a task's time goes.** `EAST_PROFILE=1` in the environment of a local
`e3 dataflow run` (or `run`, `call`, `mutate`) has the east-c and east-py
runners profile each unit — the runners inherit e3's environment — and the
task's log (`e3 task logs`) then ends with every East function and platform
function it called, by self time, with its calls and where it was written and
called: the python lines of a function `East.importFunction` linked in
included. Each input read lazily is an entry too, named as `-v` names it
(`input 1`): the time its reads spent decoding segments, a call each — keyed
reads at random beyond the segments the runner keeps, or a scan repeated,
which `-v`'s account counts — and not the reading function's own time.
`EAST_PROFILE_INTERVAL=300` adds the profile so far every five minutes while a
long task runs. east-node does not profile. Like `-v` it changes no hash: add
`--force` for a cached task.
**`E3_SCRATCH_DIR`** moves a local run's per-execution scratch directories
(default `<repo>/tmp/scratch`, on the object store's disk; on tmpfs, outputs sit
in memory until stored).

**`repo gc`** keeps each workspace's last 10 runs (`--keep-runs`), every run
from the last 7 days (`--keep-days`) and the run its current state came from,
with every execution those runs used; every execution a workspace's current
state is served from, so a re-run stays cached; every execution from the last 7
days; and whatever is still running. An attempt recorded running that the local
runner says cannot finish is recorded interrupted, and goes as any that ended.
It then removes the objects nothing names, and staging files older than
`--min-age` (60 s). `--dry-run` reports what would go.

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
| Workspaces | `workspaceList`, `workspaceCreate(url, repo, ws, opts)`, `workspaceCopy(url, repo, from, to, opts)` → the target, made or replaced whole, `workspaceGet`, `workspaceStatus(url, repo, ws, opts, { paths? })` — the whole workspace's, or the datasets named and the tasks producing them, `workspaceStatusSince(url, repo, ws, etag, opts, { paths? })` → `{ status, etag }`, or `null` while the status answered under `etag` is current (a poll sends the last answer's tag back; `null` asks in full), `workspaceLockStatus(url, repo, ws, opts)` → what holds the workspace and how far it says it has got (a deploy's files and records), or `null`, `workspaceRemove`, `workspaceDeploy(url, repo, ws, 'pkg@ver', opts, { schema?, inputs?, allowDropRecords?, plan?, onProgress? })` — a job it polls, whose progress while `deploying` is the deploy's own, answering what it did with each record, index and input, `workspaceExport(url, repo, ws, opts, { name?, version? })` → zip bytes. A poll's request takes `pollRequestOptions(opts)`: one attempt, its next poll being its retry |
| Datasets | `datasetGet(url, repo, ws, path, opts)` → `{ data, hash, size }` (a collection downloads as its segments), `datasetGetStream`, `datasetGetPage(…, window, opts)`, `datasetFindKey(…, query, opts)`, and several reads in one request (at most `DATASET_BATCH_MAX`, 10,000, each at one content hash, in a body of at most 16 MiB: a larger one is refused 413, `payload_too_large`): `datasetFindKeys(…, { queries, index?, hash? }, opts)` — key searches, `datasetGetRows(…, { keys, hash? }, opts)` — a Dict's rows by `.east` key, each with its position — or `datasetGetRows(…, { keysOf: { path, index, runs, hash }, hash? }, opts)`, by the keys the entries of some runs of another record's index name, which the server reads from the index so none is sent (a drawing's details for its window's cells), a stale `keysOf.hash` thrown as `RunsHashMismatchError` naming the record's content — and `datasetGetRuns(…, { runs, hash, index?, join? }, opts)` — the entries of several runs as one window, a rows or runs answer holding the first `count` the page budget reaches (by runs, of `runEntries`); and where a narrowing's rows sit in a record, from its index alone: `datasetPlace(…, { index, runs, offset?, limit?, hash }, opts)` → `{ segments, placed, runEntries, totalElements, hash }` — how many of the runs' entries each record segment holds (`{ segment, offset, count, rows }`), for the first `placed` of a window from `offset` (the next window from `offset + placed`), and `datasetWithin(…, { index, runs, keys, hash }, opts)` → `{ within, hash }` — whether each index entry key (`(ik=…, k=…)`) lies in one of the runs, `datasetSet(url, repo, ws, path, beast2Bytes, opts)`, `datasetSetStream(url, repo, ws, path, { size, hash, slice }, opts, { onCommitProgress? })` — a file of any size, the server's commit saying how far it has taken it in, `datasetList`, `datasetListAt`, `datasetListRecursive`, `datasetListWithStatus`, `datasetGetStatus` |
| Runs and tasks | `dataflowExecute(url, repo, ws, { force?, filter? }, opts, { pollInterval?, timeout? })` → the result (or `dataflowExecuteLaunch` and `dataflowExecutePoll`) — `force` is `true` or the names of the tasks to re-run, `filter` one task's exact name, `dataflowCancel` — with nothing running, `dataflow_error` ("No active execution for this workspace"), `dataflowGraph`, `dataflowBudget`, `taskList`, `taskGet`, `taskExecutionList(url, repo, ws, task, opts, { limit?, before? })` — a page of the task's runs, the latest first, each naming its `executionId`, the next page the runs `before` the last one's (100 a page unless `limit` says, 1,000 at most), `taskLogs(url, repo, ws, task, { stream?, offset?, limit?, execution? }, opts)` — a chunk of the log of the task's current execution, or of the one `execution` names (`{ inputsHash, executionId }`), the chunk naming its execution and whether it has `ended` |
| Functions | `functionList`, `functionDescribe`, `functionCall(url, repo, pkg, version, fn, { args, runner, limits }, opts)` — each argument `variant('value', beast2Bytes)`; the function runs on its own runner for any caller (`runner: none`); a runner the call names is never `custom`, and loads a platform package the function's does not only for an elevated caller; `workspaceFunctionList`, `…Describe`, `…Call(url, repo, ws, fn, request, opts)` — where an argument may also be `variant('dataset', path)`, a dataset of the workspace pinned at its hash, which the result names (`inputs`); `oneShotExecute` — a reader runs a platform-free one (stock runner, `platforms: []`, no platform call), and its result names the datasets it read (`inputs`); `splitCall(url, repo, ws, { bodyIr, args, output, then, runner, limits }, opts, { onProgress? })` — a program over a dataset's pieces, as a job it polls, under the same rule (or `splitCallLaunch`, `splitCallStatus` and `splitCallExplain`) |
| Records | `workspaceRecordDescribe`, `workspaceRecordMutate(url, repo, ws, record, mutation, { args, actor, limits }, opts, idempotencyKey?)`, `workspaceRecordHistory(url, repo, ws, record, limit, opts, from?)`, `workspaceRecordCompact` |
| From East | `Platform` and the `platform_*` functions (`platform_dataset_get`, `platform_dataflow_execute`, …): the same calls as platform functions, for an East program that drives a server |

**`@elaraai/e3-core`** does the same on a local repository, given a storage
backend (`new LocalStorage()`) and the repository's path; work that runs East
takes a runner, `new LocalTaskRunner(repo)`.

| Area | Functions |
|---|---|
| Repositories | `repoInit(path)`, `repoFind(startPath?)`, `repositoryOpen(storage, repo)` (checks the repository and applies the upgrades it owes), `repositoryUpgradeStep(storage, repo, { budgetMs, waitMs? })` → `{ owed }` — a host's job applies them so, a part per run under its time limit, each part taking a step up where the last stopped, `repoGc(storage, repo, { dryRun?, minAge?, keepRuns?, keepDays?, retention?, executionAlive? })` — holding the repository still, or, with `retention: { windowMs }`, beside running work: an object goes once unreachable for the window and not written or re-referenced since; given a runner's `executionAlive`, an attempt recorded running that cannot finish is recorded interrupted and pruned; `repoGcStep(storage, repo, step, { windowMs, pruneMs?, markMs?, concurrency?, executionAlive?, … })` runs that one step at a time, each returning the next (`GcStepType`), `pruneMs` and `markMs` bounding a prune step and a mark step for a host with a time limit |
| Packages | `packageImport(storage, repo, zipPath)`, `packageExport(storage, repo, name, version, zipPath)`, `packageList`, `packageRemove` |
| Workspaces | `workspaceCreate(storage, repo, ws)`, `workspaceCopy(storage, repo, from, to)`, `workspaceDeploy(storage, repo, ws, pkgName, pkgVersion, options?)` (`runner`: its migrations, index builds and intake units; `schema` and `inputs`: its policies; `onRecordPlan`, `onRecordIndex`, `onInputPlan`: what it decided; `sourceConcurrency`: the `file` sources taken in at once; `onSourceProgress`, `onDeployProgress`: how far it has got), `workspaceExport(storage, repo, ws, zipPath, name?, version?)`, `workspaceStatus(storage, runner, repo, ws)`, `workspaceStatusRevision(storage, repo, ws)` — a token that moves whenever the status might, which the API's `ETag` names, `workspaceLockStatus(storage, repo, ws)`, `workspaceListStates(storage, repo)` — every workspace with its state in one read of the store, `workspaceRemove(storage, repo, ws, { sweep? })` — the record and what a store removes at once go in one call, and the rest is swept in bounded batches unless `sweep: false` leaves them to `workspaceSweep(storage, repo, cursor?)`, which a host with a time limit runs from a job |
| Datasets | `workspaceGetDataset(storage, repo, ws, treePath)`, `workspaceSetDataset(storage, repo, ws, treePath, value, type)`, `datasetAdoptFile(storage, repo, ws, treePath, file, { runner, onProgress? })` → `{ hash, size, segments, rows, taken, runners? }`, `taken` being `known`, `carried` or `taken` (by the `runners` named); `deliveryAdoptStored(storage, repo, ws, { address, type }, sha256, { runner?, onProgress?, signal? })` — a delivery the store holds taken in as a stored value of the type, naming no dataset, for a record's first state |
| Runs | `dataflowExecute(storage, repo, ws, options?)`; `LocalOrchestrator` to start, poll and cancel a run |
| Records | `recordMutate(storage, runner, repo, ws, record, mutation, args, { actor })`, `recordHistory`, `recordDescribe`, `recordCompact`, `recordReindex`; `recordSystemCommit(storage, runner, repo, ws, record, { name, target, actor, args? })` — `$rollback` to a commit, `$restore` of a state at the record's migrations, and `$init` on a record declared with no initial value: its first state, from a stored value, with the whole chain applied |

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
├── running/           # an index of the attempts recorded running, by task: what a status reads
├── runs/              # an index of each task's runs, its units left out: what its history and logs read
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
