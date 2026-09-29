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
| `StorageBackend` | e3-core `storage/interfaces.ts` | objects; refs, the repository record among them; locks; logs; the repository lifecycle and gc's primitives; dataset refs; the backend's own upgrade steps | `LocalStorage`, `InMemoryStorage` |
| `TaskRunner` | e3-core `execution/interfaces.ts` | runs a task, a unit of a split task, or a detached call; takes a delivered collection in, or a run of its segments, through an intake unit; says whether an execution recorded `running` can still finish | `LocalTaskRunner`, and `MockTaskRunner` for tests |
| `ExecutionStateStore` | e3-core `dataflow/state-store/interfaces.ts` | a dataflow run's state and its events | `FileStateStore`, `InMemoryStateStore` |
| `DataflowOrchestrator` | e3-core `dataflow/orchestrator/interfaces.ts` | starts, polls, cancels and resumes a run | `LocalOrchestrator`, over the storage, state store and runner it is given |
| `TransferBackend` | e3-core `transfer/interfaces.ts` | uploads and downloads, an upload's commit, and the jobs that outlast a request: import, export, deploy, gc | `InMemoryTransferBackend`, the local server's |
| The route factories | e3-api-server `routes/`, `middleware/repository.ts` | every route, and the gate a request to a repository passes | `createServer` mounts them over the local seams |

**What only a backend knows is a method it implements**, never a check in
shared code. Whether an execution can still finish is
`TaskRunner.executionAlive`; whether a lock's holder is alive,
`LockService.isHolderAlive`; what gc sweeps beside objects and records,
`RepoStore.gcSweepBackend`; a change to one backend's layout, a step in
`StorageBackend.upgrades`; how an upload's bytes are taken in,
`DatasetUploadStore.commit`; where a delivery's rows are walked and written
again, `TaskRunner.intake`.

**What a poll reads lives in a store, never in a process.** A request may
reach any instance of a server, so a job's status is its `TransferBackend`
store's, and a run's state the `ExecutionStateStore`'s, not a map in the
process that started it.

**Work that lasts as long as a repository or a zip is large runs as a job.**
The transfer backend files it and dispatches it to the compute it chooses, and
the client polls; no route holds it in the request.

**A route factory takes its seams as arguments.** Each is exported from
e3-api-server and given the storage, a repository's identifier from its name,
and, as it needs them, the transfer backend, each repository's runner, and for
the dataflow routes each repository's orchestrator and state store
(`DataflowSeams`). `createServer` is the local server's wiring: it builds the
local seams and mounts the factories. Another host mounts the same factories
with its own.

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
imports the local backend, uses the machine's filesystem, or judges a process
alive where it runs. The modules that may are listed in it, each with why — a
zip read or written on the machine that runs the job, a delivered file an
adoption takes in — and an exception no longer needed fails too, so the list
only shrinks.

## Tests

**A store's behaviour is a contract suite.** The suites live in e3-core's
`src/contract/` and are exported from `@elaraai/e3-core/test`: one for each
store, one for the execution state store, and one for each mechanism built
over them — the repository open, gc, the workspace status, the dataflow loop.
Each takes a setup that makes a fresh backend for one test and registers its
cleanup with `t.after`; most take a `BackendSetup`, which gives a backend and
a repository created in it. e3-core runs every suite over `LocalStorage` and
`InMemoryStorage` (`stores.spec.ts` is the pattern), and another backend runs
them over its own by giving its own setup.

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
(`api-compliance.spec.ts`), and e3-cloud against its own deployment. Where
servers may differ in how they get there — where a short upload is caught,
say — a case accepts each.

## Adding or changing a seam

A mechanism another backend needs lands behind an interface a backend
implements, with its contract cases or e3-api-tests, in the change that adds
it. A PR that adds or changes a seam says what another backend must implement,
and which suites pin it.
