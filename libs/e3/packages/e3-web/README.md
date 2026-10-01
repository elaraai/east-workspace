# @elaraai/e3-web

e3 running entirely in a browser: a repository kept in the page's own storage, with no server. This package is e3's third backend, beside the local one and e3-cloud. It keeps e3's records in IndexedDB, its objects in the origin private file system (OPFS), and its locks with Web Locks, runs every East program on a pool of Web Workers, and answers e3's whole API in the page: paged dataset reads and key search, function calls, one-shot and split calls, record mutations, deploys, uploads, imports and exports, and dataflow runs.

## Installation

```bash
npm install @elaraai/e3-web
```

## Using it

An app runs e3 in three scripts: the page, the e3 worker, and the unit workers the e3 worker starts.

```typescript
// unit.worker.ts — where East programs run. east-web-std answers for east-node-std's
// platform functions, and e3's own reach the e3 worker; an app adds its own packages
// with serveUnits({ platforms })
import { serveUnits } from '@elaraai/e3-web/units';
serveUnits();
```

```typescript
// e3.worker.ts — e3 itself: its storage, its orchestrator, its runner and its API
import { serveE3 } from '@elaraai/e3-web/worker';
serveE3({
  units: () => new Worker(new URL('./unit.worker.ts', import.meta.url), { type: 'module' }),
});
```

```typescript
// main.ts — the page
import { createWebE3 } from '@elaraai/e3-web';
import {
  repoList, repoCreate, packageImport, workspaceCreate, workspaceDeploy, dataflowExecute,
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

A page that renders e3-ui surfaces gives e3-ui-components the same two things, `apiUrl` and `fetch`, in its `E3Config`. `<ReactiveDatasetProvider>` installs the adapters `Data.bind`, `Data.bindPaged`, `Func.bind` and `Record.bind` resolve through, and `<UITaskPreview>` renders a deployed `ui()` task; every request they make goes through `e3.fetch`, and is answered in the page:

```tsx
// main.tsx — a deployed ui() task, every request it makes answered in the page
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { system } from '@elaraai/east-ui-components';
import { E3Provider, ReactiveDatasetProvider, UITaskPreview } from '@elaraai/e3-ui-components';
import { createWebE3 } from '@elaraai/e3-web';

const e3 = await createWebE3(new Worker(new URL('./e3.worker.ts', import.meta.url), { type: 'module' }));

createRoot(document.getElementById('root')!).render(
  <ChakraProvider value={system}>
    <E3Provider config={{ apiUrl: e3.apiUrl, repo: 'default', workspace: 'main', fetch: e3.fetch }}>
      <ReactiveDatasetProvider>
        <UITaskPreview task="dashboard" />
      </ReactiveDatasetProvider>
    </E3Provider>
  </ChakraProvider>,
);
```

## The page: `createWebE3`

`createWebE3` connects the page to its e3 worker. It gives the page `e3.fetch`, which the worker answers, and `e3.apiUrl`, the URL e3's client and e3-ui-components are given with it. No request reaches the network.

| Member | What it is |
|---|---|
| `apiUrl` | `https://e3-web.invalid`. Its origin is reserved, so a request that bypasses `e3.fetch` fails at once rather than reaching the network |
| `fetch` | The global `fetch`'s signature, answered by the worker: the `fetch` of e3-api-client's `RequestOptions` and e3-ui-components' `E3Config` |
| `persisted` | Whether the browser keeps the worker's repositories through storage pressure |
| `close()` | Terminates the worker, or, over a port, tells the e3 at its other end that the page has closed, which closes it, and closes the port. Every request pending rejects, naming the close, and every later one is refused |

How it behaves:

- **Boot.** The page says hello, and `createWebE3` resolves once the worker answers that it is ready, however long after its boot the page connects. If the worker's boot fails, `createWebE3` rejects with the boot's message, and the worker is closed. A browser that lacks an API e3 keeps repositories with fails this way, and the message names the API.
- **Requests.** `e3.fetch` posts each request's method, URL, every header and body to the worker, and resolves to a `Response` made of the worker's answer. It answers only `apiUrl`'s origin: any other is refused with a `TypeError` that names it, and nothing is posted. It follows no redirect.
- **Bodies** cross whole between the page and the worker, as `ArrayBuffer`s transferred rather than copied. The caller's own body is copied once, as `fetch` copies it, and stays the caller's.
- **Aborts.** A request's signal aborts it. The promise rejects with an `AbortError`, and the signal of the `Request` the worker's handler holds aborts too.
- **Failures.** A request the worker answers with no response, because its handler threw, rejects with a `TypeError` carrying what failed, as `fetch` rejects a network failure. An error the app answers with a response, a 500 say, is that response.
- **A worker that stops.** The worker may be terminated by other code, close itself, raise an error it does not catch, or send a message the page cannot read. Then every request pending rejects, naming what happened, and every later one is refused. The page learns that the worker has stopped through a Web Lock the worker holds while it lives, since no event tells it.
- **Over a port.** The page holds a Web Lock of its own while it is connected, and the e3 at the other end waits on it: the e3 closes once the page has gone, its tab closed, as it does when `close()` tells it. A browser's port says nothing as it closes.
- **Persistence.** When the worker keeps repositories past the page, `createWebE3` asks `navigator.storage.persist()`, which only a page can ask, and `persisted` is the browser's answer. An app that asks at a moment of its own choosing gives `requestPersistence: false`, since Firefox asks its user. `persisted` is then `navigator.storage.persisted()`'s answer.

The page and the worker speak `e3.fetch`'s protocol, a few messages over the worker's `postMessage`. The same messages work over a `MessagePort`, which is how the protocol is tested in Node.

## The e3 worker: `serveE3`

`serveE3`, from `@elaraai/e3-web/worker`, runs e3 in the worker and serves it to the page. It boots, in order:

1. the storage (`openWebStorage`): refused, naming the API, in a browser that lacks one, and `createWebE3` rejects with the refusal;
2. the state store every dataflow run keeps its state in (`WebStateStore`);
3. the unit pool, which starts unit workers from `units`, and each repository's runner over it (`WebTaskRunner`);
4. the orchestrator (`LocalOrchestrator`, as the local server runs it), which records a split task's own execution under the tab's session;
5. the transfer backend (`WebTransferBackend`), which records the jobs and commits a closed tab left failed, never running them again, and forgets what is past its retention while the tab lives;
6. the app: e3-api-server's own route factories, mounted as the local server mounts them over many repositories, beside e3-web's byte endpoints for uploads and downloads.

Every request the page's `e3.fetch` posts is answered by the app, and so is every request a unit's e3 platform functions make.

| Option | Default | Effect |
|---|---|---|
| `units` | — | Starts a unit worker: a Web Worker whose script calls `serveUnits()` |
| `access` | by roles, or `any` | The grant each request's caller holds for what it supplies to run — a one-shot, a split call, a function call naming its own runner. As the local server grants it: by the caller's roles (`oneShotAccessByRoles()`) when `identify` says who calls, and `any` when nothing does, the page being single-tenant then, as a server without auth is |
| `identify` | none | Who calls: the identity (`{ sub, email?, roles }`) of each request's caller, which `access` reads and the record routes commit as. A request to a repository whose caller it does not identify is answered 401, as a server's auth answers one it cannot verify: `Unauthorized: Missing Bearer token`, `Unauthorized: Invalid token`, or `Unauthorized: <why>` when it throws. With none, the page's one caller may do everything |
| `persist` | `true` | `false` keeps repositories in memory, gone with the page, and needs neither IndexedDB, OPFS nor Web Locks |
| `name` | `'e3'` | What the storage is named after. Two e3 workers of one name share their repositories, in one tab or several |
| `wholeIntakeLimit` | 256 MiB | The largest delivery one intake unit takes in whole. One that is not a whole number of bytes, zero or more, fails the boot, naming it |
| `transferPartBytes` | 8 MiB | The size of every part of a dataset upload but the last |
| `transferCommitWaitMs` | 5 000 | How long a dataset commit waits for its upload to be verified before it answers `processing` for the client to poll |
| `transferExportRoundBytes` | 16 MiB | The most bytes of a package's zip one round of an export writes before the worker answers what waits, the page's requests, and writes the next |

```typescript
// e3.worker.ts — callers known by their tokens, and granted by their roles
import { serveE3, oneShotAccessByRoles } from '@elaraai/e3-web/worker';

serveE3({
  units: () => new Worker(new URL('./unit.worker.ts', import.meta.url), { type: 'module' }),
  identify: (request) => callerOf(request.headers.get('authorization')),
  access: oneShotAccessByRoles(),
});
```

`serveE3(options, port)` serves over a `MessagePort` instead of the worker's own scope, and closes once its page has gone: the page's `close()` tells it, the Web Lock the page holds while it is connected is freed as its tab closes, or the port closes where the platform says so, as Node's does and a browser's does not. Its unit workers are terminated and its storage closed, which frees its session. That is how e3's Node test pass runs it, with units in its own thread (`inProcessUnits()`).

## e3's own platform functions, in a unit

A task may call e3's own platform functions, e3-api-client's `Platform`, to reach the e3 it runs in. Every unit worker serves them, bound to the e3 worker that started it: the e3 worker hands each unit worker a port, and answers what comes over it with its own app. A task lists them under e3-api-client's name, and passes `https://e3-web.invalid` as the URL:

```typescript
import e3 from '@elaraai/e3';
import { ArrayType, East, StringType } from '@elaraai/east';
import { Platform } from '@elaraai/e3-api-client';

const repo = e3.input('repo', StringType);
const workspaces = e3.task('workspaces', [repo], East.asyncFunction([StringType], ArrayType(StringType), ($, name) => {
  const found = $.let(Platform.workspaceList('https://e3-web.invalid', name, ''));
  return found.map(($, workspace) => workspace.name);
}), { runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std', { custom: '@elaraai/e3-api-client' }] } });
```

A URL on any other origin is refused rather than fetched. The token a program passes is sent as the request's bearer token, as it is sent to a server, so `identify` knows the caller. Once the pool lets a unit worker go — its run aborted or timed out, or the worker stopped — what the e3 was answering for it is given up: a one-shot it was waiting on is stopped, its own worker terminated.

## Transfers: `WebTransferBackend`

`WebTransferBackend` implements e3-core's `TransferBackend`, all seven of its stores. Its URLs are e3-web's own byte endpoints, root-relative, which the routes resolve against `https://e3-web.invalid`, so they too are answered in the page.

| Store | What it does |
|---|---|
| Dataset uploads | Each part is staged whole in OPFS, sized by its bytes. The commit copies the parts into one buffer of the upload's size, hashes it once, and stores it as the object it hashes to — refused, with nothing written, when a part is missing or that is not the upload's hash — then adopts it (`datasetAdoptObject`), a collection taken in by intake units on the runner |
| Dataset downloads | A download URL is served once, from the object store |
| Package import | The zip a client uploads is staged in OPFS, and the job reads it as a `ZipSource`, by ranges |
| Package export | The job writes its zip through e3-core's portable sink a round at a time, each round's bytes a blob, the next round going on from where the last stopped. A workspace's export holds the workspace's lock across its rounds, so nothing changes it between them. An export that fails removes its rounds |
| Deploy, gc, split call | Run through e3-core's shared handlers, on the repository's runner |

Every job's status is a record, polled as the local server's is. A job, and an upload's commit, records the tab's session until it ends. What a closed tab left unfinished is never run again: the next tab to start over the same storage records it failed — "its tab closed before it finished" — and removes what it staged, since the client that knew of it closed with the tab, and the repository may have changed since. What a tab that lives runs is left to it. A job or a commit asked for twice at once runs once.

A finished job's status, and a finished commit's, stays readable for a poll for ten minutes, and a record nothing finished or fetched is forgotten after a day, with what it staged; a tab that lives forgets them every ten minutes (`WebTransferBackend`'s `retention`). gc sweeps what a transfer staged once its record is gone.

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
- **Records** are IndexedDB records: refs, dataset refs (whose `writeIf` compares the revision each write mints), executions, runs, logs, lock states, gc's notes and the transfers' jobs. A change that reads a record and writes it back is one transaction, so it loses no other tab's write.
- **Logs** are a record per append, keyed by the byte of the log it starts at. A read cuts its window from the few records it covers, however many appends the log took.
- **Locks** are Web Locks, held by the tab's session. A lock's holder is a `process` holder with pid 0 and the session's id as its `bootId`. `isHolderAlive` asks Web Locks whether that session is alive. Two tabs take locks as two processes over one local repository do, and a closed tab's locks are free.
- **gc** runs over it as over any backend: holding the repository still, or beside running work, in steps. Its `gcSweepBackend` removes what a tab closed mid-write left.

## The runner

`WebTaskRunner` implements e3-core's `TaskRunner`. It runs every unit — a task, a piece or a merge of a split task, a function call, an intake — on a worker of a `UnitPool`, with East's `executeUnit`, the code east-node's `exec` runs. `serveE3` makes the pool and a runner for each repository; a host of its own makes them itself:

```typescript
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

// east-node-std's platform functions, answered by east-web-std's, e3's own, and an app's own package
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
| A unit whose worker stops on its own — closes itself, which no event says | Fails the unit, naming it, and gives its place to the next: the pool learns of it through the Web Lock each unit worker holds while it lives |
| A custom task, or a task on the custom runtime | Records it `error`: "a browser runs no commands" |
| A platform package its worker does not serve | Fails the unit, naming the package |
| A platform function no package provides (FileSystem, Env) | Fails the unit, naming the function |

An execution recorded `running` can still finish while the session of the tab that owns it lives: its Web Lock is held. A run whose tab closed is reported as the local server reports a run whose process died — its task `stale-running`, under pid 0, and its workspace free — and the next run is served the units that finished from the execution cache. Memory is not measured, so no record names a peak, and the pool's width is the only budget.

| Option | Default | Effect |
|---|---|---|
| `UnitPool` `units` | — | Starts a unit worker |
| `UnitPool` `width` | `navigator.hardwareConcurrency` | The most units that run at once |
| `UnitPool` `connect` | none | Makes the services each worker is handed as it starts: a port, which a platform package given as a function reaches, and what ends the host's side once the pool lets the worker go. `serveE3`'s serves e3's API over the port |
| `UnitPool` `startTimeoutMs` | 60 000 | How long a worker may take to start serving units |
| `WebTaskRunner` `wholeIntakeLimit` | 256 MiB | The largest delivery one intake unit takes in whole |

## What a browser cannot do

Each of these fails with a message naming it, and none is a partial answer:

- **Commands.** Custom tasks and command bodies are recorded `error`: a browser runs no commands.
- **Platform functions with no browser meaning.** east-web-std provides no FileSystem, Env or large-JSON reader, and east-node-io and everything Python have no browser equivalent. A unit calling one fails, naming the function.
- **Segments on demand.** A unit's inputs are staged whole into its worker, and the unit's `fetch` is false. The runner protocol's `fetch` waits for a segment synchronously, which a browser worker can do only on a `SharedArrayBuffer`, and a page has one only when it is cross-origin isolated, which GitHub Pages cannot give. A task over a large input splits it into pieces (`e3.partition`), as it bounds a unit's memory anywhere. An upload that cannot be cut into pieces is refused above `wholeIntakeLimit`, naming the fix.
- **Memory budget.** Memory is not measured: the pool is sized by cores, there is no memory budget, and records carry no peak memory.
- **The CLI.** The e3 CLI drives e3 over HTTP, which an in-page e3 does not serve.

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

Each adapter's implementations answer alike. A records transaction's work awaits only its own operations, because IndexedDB commits a transaction as soon as it has nothing to do. Every implementation refuses work that awaits anything else. Locks are queued as Web Locks queue them. A file is read in slices of its adapter's read size, each 1 MiB (`FILE_READ_CHUNK`) but the last, unless the adapter is made with another (`readChunk`), whatever chunks a stream of the file would come in. An open that would upgrade an IndexedDB database, or a deletion, that another connection holds up is refused, naming why, once that connection has not closed in five seconds (`blockedMs`), rather than waited on for ever; one closing as it was asked, its last transactions finishing, lets it through.

The adapters need a secure context (`https:`, or `http://localhost`). They have been tested in Chromium.

## Tests

Every shared API suite of `@elaraai/e3-api-tests` — repository, packages, workspaces, datasets, dataset pages, dataset transfer, dataflow, functions with one-shot and split calls, records, keyed records, record deploys, package transfer and platform — passes against e3-web twice, as an admin and in its reader cases as a reader, with the global `fetch` refusing every request that does not go through `e3.fetch`:

- in Node, `serveE3` over a `MessageChannel`, in-memory repositories and units in the test's own thread (`libs/e3/test/integration`'s `web-compliance.spec.ts`);
- in Chromium, the suites in Node and each of their requests forwarded into a page running e3 over IndexedDB, OPFS, Web Workers and Web Locks (`e3-api.ts`, in parts, a spec file and a browser each).

In Chromium, specs also show that a task calling e3's own `Platform.workspaceList` from a unit worker lists the workspaces of the e3 in its page; that a dataflow interrupted by closing its page is reported by the next page as the local server reports a run whose process died, and that a new run there is served the pieces that finished from the execution cache; that the Web Locks the origin holds stay bounded across runs whose unit workers are terminated, a port a unit worker was handed holding none; that a one-shot a terminated unit was waiting on is stopped; and that an e3 served over a port closes, freeing its session, when its page closes its connection and when the page has gone. Every Chromium case ends asserting its page raised nothing, the harness keeping every error a page raised, a call reporting it or not. In Node, specs show `serveE3`'s boot, its refusal naming a missing API or a whole-intake limit it cannot use, its close with the page, a caller it does not know answered 401 and a reader's one-shot granted by roles, the in-process host clearing a terminated unit's timers, the forwarding fetch giving up in the page what Node aborted, every browser bundle naming none of Node's globals and warning of nothing, and the transfer backend's jobs: an export written a round at a time into the zip one round writes, holding its workspace across its rounds; what a closed tab left recorded failed, with what it staged removed, and what a live tab runs left to it; a job or a commit asked for twice at once run once; retention, and gc's sweep of what a transfer staged; and gc as a job. `libs/e3/test/integration`'s `dataset-transfer-parts.spec.ts` runs the byte endpoints' checks against the local server and e3-web alike.

`e3.fetch`'s contract runs twice: in Node, over a `MessageChannel`, and in Chromium, over a dedicated worker. Both times the worker answers with a plain handler. The contract covers:

- a round trip with a body each way, each transferred;
- a streamed body;
- headers, a header given twice among them;
- status and status text;
- empty bodies;
- a handler that throws;
- aborts before and during handling;
- a foreign origin refused;
- `close()`, and a worker that stops, with requests pending and after;
- a boot refused, naming the missing API;
- a page that connects after the worker booted, ready or refused;
- `persisted`.

In Chromium, specs also show a 64 MiB body each way, transferred, a worker that closes itself or raises an error mid-request, `persisted` as the browser answers, and the harness keeping an error a page raised after its last call.

Every contract suite a storage backend runs passes over `WebStorage` and `WebStateStore` in Node, over the in-memory adapters. The adapters' contract runs in Node over the in-memory adapters, and in Chromium over IndexedDB, OPFS and Web Locks. In Chromium, specs across pages show that:

- two tabs never hold one lock exclusively at once;
- a closed tab's locks are free, and its session has ended;
- what one tab writes, the tab after a reload reads;
- a repository one tab writes through the stores is read after a reload and by another tab, and gc collects only what nothing names;
- another tab sees who holds a workspace's lock while its holder lives, and can take the lock once the holder's tab has closed;
- a repository opened with `persist: false` is gone after a reload;
- a page whose OPFS cannot move a file is refused a persisted storage, which names the missing API and creates nothing;
- an IndexedDB database another connection holds open, and does not close, is refused to a deletion, naming why.

`WebTaskRunner`'s cases run in Node over workers in the test's own thread (`inProcessUnits`), and in Chromium over Web Workers, IndexedDB, OPFS and Web Locks. They run tasks of every output kind, a split task through its pieces and merges, failing, cancelled and refused tasks, function calls within their limits and past each, a one-shot, a split call, a record mutation, an intake, and the liveness of executions other tabs own. In Chromium, a call whose program never yields its thread is ended by terminating its worker, and one whose worker closes itself fails, its place going to the next. The tasks the cases run are a package written with e3's SDK, which the specs export in Node and hand to the page as data: the SDK is a dev dependency, and nothing a browser bundles reaches it.

In Chromium, east-node-std's compliance suite also passes over `@elaraai/east-web-std`, the browser's platform functions: every East test of its Console, Crypto, Fetch, Path, Random and Time modules. The spec reads the suite from `EAST_NODE_STD_IR`, or `/tmp/east-node-std`, where `make -C libs/east-node test-export-std` exports it, and its Fetch tests call httpbin on `:8085`, which the workspace root's `make services-up` starts.

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
