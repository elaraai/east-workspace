# e3 backend seams

e3 runs over more than one backend. The local one keeps a repository in a
directory, runs tasks as processes on the machine, and serves the API from one
process; e3-cloud keeps its own storage, runs on its own compute, and serves
the same API from many instances. This document says how an e3 mechanism
reaches a backend, so that another backend implements what is its own and
shares the rest: the logic, the routes and the tests.

## The rule

- **A mechanism goes through the interfaces a backend implements.** It
  reaches storage, locks, compute, execution state and jobs only through the
  seams below, never through the local backend's files, processes or memory.
- **Shared logic never lives under `storage/local/`**, nor in the local
  runner or the local server's wiring. Those hold what is the local backend's
  alone.
- **A store's tests are a contract suite every backend runs, and a route's
  are e3-api-tests**, which every server runs.

## The seams

| Seam | Declared in | What it gives | e3's implementations |
|---|---|---|---|
| `StorageBackend` | e3-core `storage/interfaces.ts` | objects, and whether placing one is a link on this machine or a download, and their re-reference; refs, the repository record among them; locks; logs; the repository lifecycle and gc's primitives, for gc beside running work too; dataset refs; the backend's own upgrade steps | `LocalStorage`, `InMemoryStorage` |
| `TaskRunner` | e3-core `execution/interfaces.ts` | runs a task, a unit of a split task, or a detached call; takes a delivered collection in, or a run of its segments, through an intake unit, and says the largest delivery it takes in whole; says whether an execution recorded `running` can still finish | `LocalTaskRunner`, and `MockTaskRunner` for tests |
| `ExecutionStateStore` | e3-core `dataflow/state-store/interfaces.ts` | a dataflow run's state and its events | `FileStateStore`, `InMemoryStateStore` |
| `DataflowOrchestrator` | e3-core `dataflow/orchestrator/interfaces.ts` | starts, polls, cancels and resumes a run | `LocalOrchestrator`, over the storage, state store and runner it is given |
| `TransferBackend` | e3-core `transfer/interfaces.ts` | uploads and downloads, an upload's commit, and the jobs that outlast a request: import, export, deploy, gc, split calls | `InMemoryTransferBackend`, the local server's |
| The route factories | e3-api-server `routes/`, `middleware/repository.ts` | every route, and the gate a request to a repository passes; who may run what through one-shot, and load through a function call's runner override (`OneShotAccess`) | `createServer` mounts them over the local seams |

**What only a backend knows is a method it implements**, never a check in
shared code. Whether an execution can still finish is
`TaskRunner.executionAlive` — which the execution cache's probe asks too,
through the liveness a driver is given (`ExecuteOptions.executionAlive`,
`SplitTaskDriver.executionAlive`), so a probe never judges a unit running on
another host by the processes of the host that probes; whether a lock's holder
is alive, `LockService.isHolderAlive`; what gc sweeps beside objects and
records, `RepoStore.gcSweepBackend`; a change to one backend's layout, a step
in `StorageBackend.upgrades`; how an upload's bytes are taken in,
`DatasetUploadStore.commit`; where a delivery's rows are walked and written
again, `TaskRunner.intake`, and the largest delivery it takes in whole,
`TaskRunner.wholeIntakeLimit`; whether placing an object costs a download,
`ObjectStore.placement`; what a caller may run through one-shot, or load
through a function call's runner override, the grant the one-shot and function
routes' `OneShotAccess` gives it, which e3-core's `oneShotExecute` and the
function handlers apply; whether an object was written or re-referenced
since a sweep noted it unreachable, which every write and `ObjectStore.touch`
— a batch of objects at a time — record, and `RepoStore.gcDeleteUnreachable`
deletes by: on a store that keeps versions, the version the note stood over
and any older, never one a write stored after the delete.

**gc beside running work holds nothing.** A backend whose runs last days
cannot hold a repository still for its gc, so gc given a retention window
(`repoGc`'s `retention`, `repoGcStep`) takes no lock. An object goes only once
it has stayed unreachable for the window, measured from the note of the first
sweep that saw it so (`RepoStore.gcNoteUnreachable`), and only by a delete
conditional on that note (`gcDeleteUnreachable`), which a write or a touch
clears. So shared code that roots an object it did not write — an import
skipping one the store holds, an adoption the memo answers, a restored
record's state, a split call's object argument — touches it first, with
everything it names (`touchReachable`): a level of the graph at a time, a batch
of objects per `touch`, which a store may settle as one request. A store whose
delete moves an object aside for a moment, as the local one's does, may answer
a read right after a touch that found the object with nothing, so what shared
code reads right after its touch it reads once more before it takes the object
for gone (`readTouched`). What an
execution still running reads is a root, as a success's output is
(`executionStatusRoots`), since a unit reads its inputs' segments as it goes.
The run goes in steps a host spreads over invocations: each returns the next
as an East value (`GcStepType`), and the `RepoStore` keeps the mark between
them (`gcRunWrite`). The mark reads many objects at once (`concurrency`), and a
host whose invocations have a time limit bounds each mark step (`markMs`): the
mark goes on in `marking` steps, each keeping a generation of the run's parts
of its own, so a step run again starts from what it started from. The sweep
leaves unnoted what was written after the run began, which a later run notes
if it is unreachable then, so a busy repository pays no note and clear for
each new object. The object scan (`gcScanObjects`) changes nothing, so a dry
run writes nothing, and a delete by gc holding the repository still
(`gcDeleteObjects`) takes each object's note with it.

**gc decides only on what it read.** Only an object's absence
(`ObjectNotFoundError`) says the object names nothing; a host that drives gc's
mark itself (`markReachable`) reads through `gcObjectReaders`, which keeps that
rule. An execution record that reads but does not decode is answered by
`RefStore.executionGet` with `ExecutionCorruptError`, which the history's prune
takes for a record that keeps no output, and prunes as it does any other; any
other failure stops the prune, and gc with it. The ref-store suite pins the
error.

**A unit downloads what it reads.** Where placing an object is a download, a
stock runner's collections are staged without their segments, the unit says so
(its `fetch`), and a `SegmentFetcher` places each segment as the runner asks
for it — the runner protocol's segments on demand (`UnitType` in
`@elaraai/east`), which every stock runner speaks. It reads ahead of a runner
that asks for a manifest's segments in order, a window that doubles while the
asks stay in order, so a scan waits on a request per window rather than per
segment. A placement ahead of the runner that the store fails is left to the
runner's own ask, and a placement the runner asked for is tried again, a few
times, before the runner is told why, so a store that throttles a burst fails
no unit. An intake's piece of a delivery the store holds is staged as a blob
of its own, by ranged reads. Where placing is a link, both stage as they
always have: everything, by links.

**What a poll reads lives in a store, never in a process.** A request may
reach any instance of a server, so a job's status is its `TransferBackend`
store's, and a run's state the `ExecutionStateStore`'s, not a map in the
process that started it.

**Work that lasts as long as a repository or a zip is large runs as a job.**
The transfer backend files it and dispatches it to the compute it chooses, and
the client polls; no route holds it in the request — nor a transfer init, which
adopts only what takes nothing in (`datasetAdoptKnown`) and leaves a
collection the store holds whole to the upload's commit. A split call, a
caller's program over a dataset's pieces, is such a job
(`SplitCallStore`, `handleProcessSplitCall`): its record holds hashes, never
values, so a store with small records keeps it, and whether a `platform_free`
caller may poll it (`platformFree`). So is its explain, a job that plans the
call's pieces (`explain`), since planning stores every piece. So is the
re-reference of what an `object` argument names, an earlier call's output of
thousands of segments, say: the launch checks only the argument's own object
and records which arguments are objects (`objects`), and the job re-references
the rest before it runs (`splitCallReference`).

**A job over compute with a time limit hands over between calls.** Each job's
processor takes a signal its caller aborts at the deadline, and a call stopped
so leaves its job `processing` for the next: a deploy is served the steps that
finished from the execution cache; an import (`handleProcessImport`) reads a
zip from a `ZipSource` by ranges, writes its package ref last, and the next
call reads only the objects the store does not hold — a zip that does not read
is refused as `PackageInvalidError`, and a read the source fails is raised as
the source raised it, so a host that retries a round's transient failures
tells the two apart; an export (`handleProcessExport`) writes its zip to a
stream, such as a multipart upload, and stops with an `ExportStoppedError`
whose `PackageZipCheckpoint` — an East value, kept as beast2 — the next call
resumes from (`packageZipCheckpointWithin` finds where, from the bytes the
destination holds), and a workspace's export, whose resume is refused once the
workspace has changed, is held across its calls by the workspace lock its host
takes and passes it (`ProcessExportDeps.lock`), as a deploy's is
(`ProcessDeployDeps.lock`); an intake (`datasetAdoptObject`) takes a signal and progress, and the
next adopt takes in only the pieces the memo does not hold; a split call
(`handleProcessSplitCall`) is served the units that finished from the
execution cache, within what is left of its timeout, one budget counted from
its launch — so a host that runs it in rounds sets the one-shot routes'
`ceilings.timeoutMs` to the whole job's budget. An import and an export hold
the repository's running work (`withRunningWork`) through each call, as every
write that stores objects before a ref names them does, so gc holding the
repository still, and an upgrade, wait for the call; a checkpoint names the
release that wrote it, so an export whose calls straddle a new release starts
again.

**A route factory takes its seams as arguments.** Each is exported from
e3-api-server and given the storage, a repository's identifier from its name,
and, as it needs them, the transfer backend, each repository's runner, for
the dataflow routes each repository's orchestrator and state store
(`DataflowSeams`), and for the one-shot and function routes the host's
`OneShotAccess`, which gives each request's caller a grant — `any`,
`platform_free` or `none` — from the host's own auth: a one-shot runs by it,
and a function call's runner override is held to it, while a plain call runs
the function on its own runner for any caller. `createServer` is the local server's wiring: it builds the
local seams and mounts the factories. Another host mounts the same factories
with its own. A route answers for the repository in its URL alone: a job,
upload or run of another repository is not found through it. The repository
gate holds no request: while a repository owes an upgrade that waits on work
running in it, it answers `503` with `Retry-After`, and lets that work's
dataflow cancel and poll through, so the work can always be stopped. A host
whose requests have a time limit, which a step may outlast, passes the gate
`applyUpgrades: false`: no request applies a step, the gate answers `503` until
the host's own job has applied them — by an open there (`repositoryOpen`) — and
tells the host each time through `onUpgradePending`.

## Where the local backend's code lives

The local backend is `storage/local/` and the local runner (`execution/`) in
e3-core, and the local server's wiring in e3-api-server (`server.ts`,
`local-dataflow.ts`). A module there holds how the local backend does a thing
— keeps a record in a file, sweeps its staging files, judges a pid alive —
never a step every backend takes. gc's driver, the repository open and its
upgrades, pruning a run history, the lock running work takes: each lives in a
shared module and reaches the backend through its interfaces, whichever
backend it was first written for.

e3-core's `seams.spec.ts` holds the line. It fails when a shared module
imports the local backend, uses the machine's filesystem, judges a process
alive where it runs, or probes the execution cache without the liveness it was
given. The modules that may are listed in it, each with why — a zip given as a
file on the machine that runs the job, a delivered file an adoption takes in —
and an exception no longer needed fails too, so the list only shrinks.

It holds the portable entry to more. `@elaraai/e3-core/portable`
(`portable.ts`) is e3's logic with nothing of the machine it runs on: every
module it reaches, through every import — type-only, dynamic, re-exported —
imports only another of them, `@elaraai/east` and `@elaraai/e3-types`, and
names neither `Buffer` nor `process`. A package's zip is read and written
there, by every backend: from a `ZipSource` read by ranges, and to a WHATWG
`WritableStream` (`zip.ts`). What needs the machine is a module of the root
entry beside it — a file read and written here, a zip given as one or written
to a Node stream among them (`package-files.ts`, `workspace-files.ts`,
`store-collection-file.ts`, `dataset-adopt-file.ts`, `delivery-intake-file.ts`,
`transfer/process-files.ts`), and the `LocalOrchestrator` whose host is this
process (`execution/local-orchestrator.ts`) — and the root entry exports its
form of such an operation where the portable one refuses a file or a Node
stream, or names no runner. `portable.spec.ts` runs a dataflow, and a package
zip's import and export, through the entry in a process that loads no Node
module.

The walk is `portable-graph.ts`'s, which e3-core's test entry exports, and
e3-api-server's portable entry (`@elaraai/e3-api-server/portable`) is held to it
too: every route factory, the handlers and the repository gate, whose modules
import only one another, East, e3's types, e3-core's portable entry and Hono.
Its root entry adds what needs Node: the local server's wiring (`server.ts`,
`local-dataflow.ts`), its byte endpoints (`routes/data.ts`), which stage
uploads and downloads as files — a host serves those URLs itself — and auth.
Its `portable.spec.ts` mounts an app from the entry alone.

## Tests

**A store's behaviour is a contract suite.** The suites live in e3-core's
`src/contract/` and are exported from `@elaraai/e3-core/test`: one for each
store, one for the execution state store, and one for each mechanism built
over them — the repository open, gc, the execution cache's probe, the
workspace status, the dataflow loop.
Each takes a setup that makes a fresh backend for one test and registers its
cleanup with `t.after`; most take a `BackendSetup`, which gives a backend and
a repository created in it. gc's suite holds a backend to gc beside running
work too: a write in flight survives it, an object unreachable for less than
the window survives it, what an execution still running reads survives it, a
delete that races a re-reference leaves the object, and a mark spread over
steps reaches what one step does. A case that needs a record the store cannot
decode asks the setup to damage one (`BackendContext.damage`, a
`BackendDamage`), and is skipped by a setup that cannot; so a backend whose
records can be left so gives the hook, or the suite never holds it to
answering such a record with `ExecutionCorruptError`. e3-core runs every suite
over `LocalStorage` and `InMemoryStorage` (`stores.spec.ts` is the pattern),
and another backend runs them over its own by giving its own setup.

- A behaviour every backend must have is a case in the suite, not in one
  implementation's spec. A case only one implementation needs — the file
  state store retrying a rename — stays in that implementation's spec.
- The in-memory backend is held to the contract as any other: a stub that
  does nothing where the contract says something happens fails the suite.
- A change to a store's behaviour changes its suite, so every backend that
  runs it hears of the change.

**A route's behaviour is e3-api-tests.** Its suites drive a server through the
client and assert what a client sees: the status, the decoded answer, the
error it names. The local server runs them in e3's integration tests
(`api-compliance.spec.ts`), and e3-cloud against its own deployment, each
through its auth: as an admin, and as a reader whose token the harness
supplies (`TestConfig.getReaderToken`). Where
servers may differ in how they get there — where a short upload is caught,
say — a case accepts each.

## Adding or changing a seam

A mechanism another backend needs lands behind an interface a backend
implements, with its contract cases or e3-api-tests, in the change that adds
it. A PR that adds or changes a seam says what another backend must implement,
and which suites pin it.
