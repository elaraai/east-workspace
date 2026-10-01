# @elaraai/e3-web

e3 running entirely in a browser: a repository kept in the page's own storage, with no server. This package is e3's third backend, beside the local one and e3-cloud. It keeps e3's records in IndexedDB, its objects in the origin private file system (OPFS), and its locks with Web Locks.

It is being built in steps. This release holds e3's storage backend for the browser, `WebStorage`, and `WebStateStore`, where a dataflow run keeps its state, both over four storage adapters; and e3's runner for the browser, `WebTaskRunner`, which runs every East program on a pool of Web Workers. The e3 that runs a repository in the page comes in a later release.

## Installation

```bash
npm install @elaraai/e3-web
```

## The storage backend

`openWebStorage` opens `WebStorage`, which implements every method of e3-core's `StorageBackend`, so e3-core's portable logic (`@elaraai/e3-core/portable`) runs over it as it runs over a local repository:

```typescript
import { openWebStorage, WebStateStore } from '@elaraai/e3-web';
import { LocalOrchestrator, repoGc, repositoryOpen } from '@elaraai/e3-core/portable';

const storage = await openWebStorage();   // IndexedDB, OPFS and Web Locks, named `e3`
if (!(await storage.repos.exists('default'))) await storage.repos.create('default');
await repositoryOpen(storage, 'default');

const hash = await storage.objects.write('default', new TextEncoder().encode('an object'));
await repoGc(storage, 'default');          // holds the repository still, through Web Locks

// A dataflow run keeps its state in the same IndexedDB database
const orchestrator = new LocalOrchestrator(new WebStateStore(storage.adapters.records));
```

| Option | Default | Effect |
|---|---|---|
| `persist` | `true` | `false` keeps everything in memory: the page starts with no repositories on every load |
| `name` | `'e3'` | The IndexedDB database, the OPFS directory (`/<name>/blobs`, `/<name>/files`) and the Web Locks prefix (`<name>:`). Storages of one name share their repositories, in one tab or several |

A persisted storage first checks that the page has every API it keeps repositories with: IndexedDB, `navigator.storage.getDirectory`, `FileSystemFileHandle.createWritable` and `move`, and Web Locks. If one is missing, `openWebStorage` refuses before it opens anything, names the API, and suggests `persist: false`, which keeps repositories in memory instead.

How the backend keeps things:

- **Objects** are OPFS files, named by their SHA-256 in a catalogue of records. `readRange` reads a page of an object without reading the rest of it. Placing an object at a path copies its bytes (`placement` is `download`).
- **Records** are IndexedDB records: refs, dataset refs (whose `writeIf` compares the revision each write mints), executions, runs, logs, lock states and gc's notes. A change that reads a record and writes it back is one transaction, so it loses no other tab's write.
- **Logs** are a record per append, keyed by the byte of the log it starts at. A read cuts its window from the few records it covers, however many appends the log took.
- **Locks** are Web Locks, held by the tab's session. A lock's holder is a `process` holder with pid 0 and the session's id as its `bootId`. `isHolderAlive` asks Web Locks whether that session is alive. Two tabs take locks as two processes over one local repository do, and a closed tab's locks are free.
- **gc** runs over it as over any backend: holding the repository still, or beside running work, in steps. Its `gcSweepBackend` removes what a tab closed mid-write left.

## The runner

`WebTaskRunner` implements e3-core's `TaskRunner`. It runs every unit — a task, a piece or a merge of a split task, a function call, an intake — on a worker of a `UnitPool`, with East's `executeUnit`, the code east-node's `exec` runs. The pool starts its workers from the app's factory: Web Workers whose script calls `serveUnits()` from `@elaraai/e3-web/units`.

```typescript
// e3.worker.ts — where e3 runs: the storage, and a runner over a pool of unit workers
import { openWebStorage, UnitPool, WebTaskRunner } from '@elaraai/e3-web';

const storage = await openWebStorage();
const pool = new UnitPool({
  units: () => new Worker(new URL('./unit.worker.js', import.meta.url), { type: 'module' }),
});
const runner = new WebTaskRunner({ repo: 'default', pool, locks: storage.adapters.locks });
const result = await runner.execute(storage, taskHash, inputHashes);
```

```typescript
// unit.worker.ts — where East programs run
import { serveUnits } from '@elaraai/e3-web/units';
import { PricingPlatform } from './pricing-platform.js';

// east-node-std's platform functions, answered by east-web-std's, and an app's own package
serveUnits({ platforms: { '@acme/pricing': PricingPlatform } });
```

| What it runs | What it does |
|---|---|
| A task, or a unit of a split task | Runs it on a worker, its inputs read from the store and handed over whole. It records the execution as the local runner does: its owner (the tab's session), `running`, and then `success`, `failed` (exit code 1), `error` or `cancelled` |
| A split task (`e3.partition`) | Runs its pieces and merges through e3-core's engine, as many at once as the pool is wide. A relaunch is served from the execution cache |
| What a unit's console writes | Appends it to the execution's logs, as it writes it. A failure ends stderr as east-node's `exec` writes it: `Error: <message>`, then its `  at file:line:col` lines |
| A function call (`runDetached`) | Answers its value inline, and writes nothing durable. Past `timeoutMs` its worker is terminated and replaced; past `maxResultBytes` it is `too_large`; each log keeps its last `maxLogBytes` |
| An intake | Takes a run of a delivery's segments in, read from the store by ranges. A delivery with no index is taken in whole, up to `wholeIntakeLimit` |
| An aborted run | Terminates its worker, which the pool replaces, and records the execution `cancelled` |
| A custom task, or a task on the custom runtime | Records it `error`: "a browser runs no commands" |
| A platform package its worker does not serve | Fails the unit, naming the package |
| A platform function no package provides (FileSystem, Env) | Fails the unit, naming the function |

An execution recorded `running` can still finish while the session of the tab that owns it lives: its Web Lock is held. Memory is not measured, so no record names a peak, and the pool's width is the only budget.

| Option | Default | Effect |
|---|---|---|
| `UnitPool` `units` | — | Starts a unit worker |
| `UnitPool` `width` | `navigator.hardwareConcurrency` | The most units that run at once |
| `UnitPool` `connect` | none | Makes the port each worker is handed as it starts: the services the host serves its units, which a platform package given as a function reaches |
| `UnitPool` `startTimeoutMs` | 60 000 | How long a worker may take to start serving units |
| `WebTaskRunner` `wholeIntakeLimit` | 256 MiB | The largest delivery one intake unit takes in whole |

## The storage adapters

e3-web keeps a repository over four small adapters, each with an implementation for the browser and one in memory:

| Adapter | Holds | In a browser | In memory (Node, `persist: false`) |
|---|---|---|---|
| `RecordsAdapter` | records, keyed and ordered, written in transactions | `openIndexedDbRecords` | `openMemoryRecords` |
| `BlobsAdapter` | blobs, read whole or by range | `OpfsBlobs` | `MemoryBlobs` |
| `LocksAdapter` | locks, exclusive and shared, held by a tab's session | `openWebLocks` | `MemoryLockSpace` |
| `FilesAdapter` | files named by path | `OpfsFiles` | `MemoryFiles`, or the machine's files: `NodeFiles` from `@elaraai/e3-web/node` |

```typescript
import { openIndexedDbRecords, OpfsBlobs, opfsDirectory, openWebLocks } from '@elaraai/e3-web';

const records = await openIndexedDbRecords('e3');
const blobs = new OpfsBlobs(await opfsDirectory('/e3/blobs'));
const locks = await openWebLocks();

// A compare-and-swap: transactions over one database run one after another, in any tab
await records.transact(async (tx) => {
  const current = await tx.get(['refs', 'main']);
  if (current === null) tx.put(['refs', 'main'], new TextEncoder().encode('first'));
});

// Blobs are written whole: a reader sees the old blob or the new one, never part of one
await blobs.write(['objects', 'ab12'], new TextEncoder().encode('an object'));
const head = await blobs.readRange(['objects', 'ab12'], 0, 2);

// A lock is held by the tab's session. When the tab closes, the lock is free,
// and another tab's `isAlive(locks.session)` answers false.
const hold = await locks.acquire('main', 'exclusive', { wait: true, timeout: 30_000 });
await hold?.release();
```

Each adapter's implementations answer alike. A records transaction's work awaits only its own operations, because IndexedDB commits a transaction as soon as it has nothing to do. Every implementation refuses work that awaits anything else. Locks are queued as Web Locks queue them.

The adapters need a secure context (`https:`, or `http://localhost`). They have been tested in Chromium.

## Tests

Every contract suite a storage backend runs passes over `WebStorage` and `WebStateStore` in Node, over the in-memory adapters. The adapters' contract runs in Node over the in-memory adapters, and in Chromium over IndexedDB, OPFS and Web Locks. In Chromium, specs across pages show that:

- two tabs never hold one lock exclusively at once;
- a closed tab's locks are free, and its session has ended;
- what one tab writes, the tab after a reload reads;
- a repository one tab writes through the stores is read after a reload and by another tab, and gc collects only what nothing names;
- another tab sees who holds a workspace's lock while its holder lives, and can take the lock once the holder's tab has closed;
- a repository opened with `persist: false` is gone after a reload;
- a page whose OPFS cannot move a file is refused a persisted storage, which names the missing API and creates nothing.

`WebTaskRunner`'s cases run in Node over workers in the test's own thread (`inProcessUnits`), and in Chromium over Web Workers, IndexedDB, OPFS and Web Locks. They run tasks of every output kind, a split task through its pieces and merges, failing, cancelled and refused tasks, function calls within their limits and past each, a one-shot, a split call, a record mutation, an intake, and the liveness of executions other tabs own. In Chromium, a call whose program never yields its thread is ended by terminating its worker. The tasks the cases run are a package written with e3's SDK, which the specs export in Node and hand to the page as data: the SDK is a dev dependency, and nothing a browser bundles reaches it.

The Chromium specs launch the executable `E3_UI_CHROMIUM_PATH` names, when it is set. Otherwise they launch Playwright's managed Chromium:

```bash
pnpm --filter @elaraai/e3-web exec playwright-core install --only-shell chromium
```

## Claude Code plugin

The East ecosystem also ships a [Claude Code](https://claude.com/claude-code) plugin — East language skills, example search, and preemptive diagnostics for East code — installed separately from the `elaraai` marketplace:

```text
# Inside Claude Code
/plugin marketplace add elaraai/east-workspace
/plugin install east@elaraai
```

```bash
# From a terminal
claude plugin marketplace add elaraai/east-workspace
claude plugin install east@elaraai
```

## License

BSL 1.1. See [LICENSE.md](./LICENSE.md).

### Ecosystem

- **[East](https://github.com/elaraai/east-workspace/tree/main/libs/east)**: Statically typed, expression-based language with serializable IR. Run portable logic across TypeScript, Python, C, and other runtimes.
  - [@elaraai/east](https://www.npmjs.com/package/@elaraai/east): Core language SDK with type system, expressions, and reference JS compiler

- **[e3 — East Execution Engine](https://github.com/elaraai/east-workspace/tree/main/libs/e3)**: Durable execution engine for running East pipelines at scale. Git-like content-addressable storage, automatic memoization, reactive dataflow, real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Object store, dataflow orchestrator, execution state
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 dataflow run`, `e3 watch`, `e3 task logs` commands
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 repositories
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories
  - [@elaraai/e3-api-tests](https://www.npmjs.com/package/@elaraai/e3-api-tests): Shared API compliance test suites
  - [@elaraai/e3-web](https://www.npmjs.com/package/@elaraai/e3-web): e3 running in a browser

## Links

- [East Language](https://github.com/elaraai/east-workspace/tree/main/libs/east)
- [Elara AI](https://elaraai.com/)
- [Issues](https://github.com/elaraai/east-workspace/issues)
- support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
