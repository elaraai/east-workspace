# Running e3 in a browser — `@elaraai/e3-web`

Part of the `e3` skill.

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
| `width` | the cores | the most units that run at once, and so the most unit workers, each with a heap of its own |
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
