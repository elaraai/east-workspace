/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The e3 worker: where e3 itself runs in a browser — its storage, its
 * orchestrator, its runner and its API. An app's e3 worker script calls
 * {@link serveE3}, and its page connects with `createWebE3` from
 * `@elaraai/e3-web`.
 *
 * This entry (`@elaraai/e3-web/worker`) reaches nothing of Node: its routes
 * are e3-api-server's portable entry, and its logic e3-core's.
 *
 * @example
 * ```ts
 * // e3.worker.ts
 * import { serveE3 } from '@elaraai/e3-web/worker';
 * serveE3({
 *   units: () => new Worker(new URL('./unit.worker.ts', import.meta.url), { type: 'module' }),
 * });
 * ```
 *
 * @packageDocumentation
 */

import { LocalOrchestrator, type TaskRunner } from '@elaraai/e3-core/portable';
import { oneShotAccessByRoles, type OneShotAccess } from '@elaraai/e3-api-server/portable';
import { createWebApp, type Identify } from './app.js';
import { serveBridge, type BridgeBoot, type BridgeEndpoint } from './bridge/worker.js';
import { UnitPool, type UnitConnection } from './execution/pool.js';
import type { UnitWorker } from './execution/protocol.js';
import { WebTaskRunner, wholeIntakeLimitOf } from './execution/WebTaskRunner.js';
import { WebStateStore } from './storage/WebStateStore.js';
import { openWebStorage, type WebStorage } from './storage/WebStorage.js';
import { WebTransferBackend } from './transfer/WebTransferBackend.js';

export type { Identify } from './app.js';
export type { BridgeEndpoint } from './bridge/worker.js';
export type { UnitWorker } from './execution/protocol.js';
export { oneShotAccessByRoles, type Identity, type OneShotAccess } from '@elaraai/e3-api-server/portable';

/**
 * How {@link serveE3} runs e3.
 */
export interface ServeE3Options {
  /**
   * Starts a unit worker: a dedicated Web Worker whose script calls
   * `serveUnits()` from `@elaraai/e3-web/units`. The e3 worker starts as many
   * as the machine has cores, and runs every unit of every task on them.
   */
  readonly units: () => UnitWorker;
  /**
   * The grant each request's caller holds for what it supplies to run — a
   * one-shot, a split call, a function call naming its own runner. Unless
   * given, it is the local server's: by the caller's roles
   * (`oneShotAccessByRoles()`) when {@link identify} says who calls, as a
   * server with auth grants; and `any` when nothing does, since the page is
   * then single-tenant, as a server without auth is.
   */
  readonly access?: OneShotAccess;
  /**
   * Who calls: the identity of each request's caller, from the request, which
   * {@link access} and the record routes read — a mutation commits as it, and
   * compaction needs an elevated role. A request to a repository whose caller
   * it does not identify is answered 401, as a server's auth answers one it
   * cannot verify. Unset, no request has one: the page's one caller, who may
   * do everything.
   */
  readonly identify?: Identify;
  /**
   * Whether repositories outlive the page: kept in IndexedDB, OPFS and Web
   * Locks (`true`, unless given), or in memory, starting fresh on every load
   * (`false`), which needs none of them.
   */
  readonly persist?: boolean;
  /**
   * What the storage is named after: `e3` unless given. Two e3 workers of one
   * name, in one tab or two, share their repositories.
   */
  readonly name?: string;
  /**
   * The largest delivery one intake unit takes in whole, in bytes:
   * `WebTaskRunner`'s default, 256 MiB, unless given. A unit holds its
   * delivery in memory, so an upload that cannot be cut into pieces is
   * refused above it. One that is not a whole number of bytes, zero or more,
   * is refused as the e3 boots.
   */
  readonly wholeIntakeLimit?: number;
  /**
   * The size of every part of a dataset upload but the last, in bytes:
   * 8 MiB unless given, since a part crosses from the page whole.
   */
  readonly transferPartBytes?: number;
  /**
   * How long a dataset commit waits for its upload to be verified before it
   * answers `processing` for the client to poll, in milliseconds: the routes'
   * default, 5 s, unless given; 0 answers `processing` at once.
   */
  readonly transferCommitWaitMs?: number;
  /**
   * The most bytes of a package's zip one round of an export writes before
   * the e3 worker answers what waits — the page's requests — and writes the
   * next: 16 MiB unless given.
   */
  readonly transferExportRoundBytes?: number;
}

/** What closes an e3 the e3 worker runs, once its page has gone. */
interface Running {
  readonly boot: BridgeBoot;
  close(): Promise<void>;
}

/**
 * Runs e3 in this e3 worker, and serves it to the page: what an app's e3
 * worker script calls, once.
 *
 * @remarks
 * It boots, in order:
 * - the storage (`openWebStorage`), which a browser that lacks IndexedDB,
 *   OPFS or Web Locks refuses, naming the API: the page's `createWebE3`
 *   rejects with that refusal. Not persisted, it needs none of them;
 * - the state store every dataflow run keeps its state in (`WebStateStore`);
 * - the unit pool, which starts unit workers from {@link ServeE3Options.units}
 *   and hands each a port to this e3, and each repository's runner over it
 *   (`WebTaskRunner`);
 * - the orchestrator (`LocalOrchestrator`), which records a split task's own
 *   execution under the tab's session, as the runner records every other;
 * - the transfer backend (`WebTransferBackend`), which records what a closed
 *   tab left — a job, or an upload's commit — failed, naming why, and never
 *   runs it again, and forgets what is past its retention while the tab
 *   lives;
 * - the app: e3-api-server's routes over all of it (`createWebApp`).
 *
 * Every request the page's `e3.fetch` posts is then answered by the app, and
 * so is every request a unit's e3 platform functions make, over its worker's
 * port; once the pool lets a unit worker go, what the e3 was answering for it
 * is given up. The page is told whether the repositories outlive it.
 *
 * Over a `MessagePort`, the e3 closes once its page has gone: the page's
 * `e3.close()` tells it, the Web Lock the page holds while it is connected is
 * freed — its tab closed — or the port closes, where the platform says so (a
 * browser's port does not). Its unit workers are terminated, and its storage
 * closed, which frees the tab's session for the next.
 *
 * @param options - The unit workers, who may run what, and how the
 *   repositories are kept
 * @param endpoint - What the page's messages come over: this worker's global
 *   scope unless given, or a `MessagePort`
 *
 * @example
 * ```ts
 * // e3.worker.ts — repositories in memory, gone with the page
 * import { serveE3 } from '@elaraai/e3-web/worker';
 * serveE3({
 *   units: () => new Worker(new URL('./unit.worker.ts', import.meta.url), { type: 'module' }),
 *   persist: false,
 * });
 * ```
 */
export function serveE3(options: ServeE3Options, endpoint?: BridgeEndpoint): void {
  const running = start(options);
  // A boot that failed is the page's to hear: the bridge tells it.
  running.catch(() => undefined);
  serveBridge(async () => (await running).boot, endpoint, {
    // The page has gone: the e3 it was served goes with it. A boot that
    // failed has nothing to close, and a close that fails has no one to tell.
    onEnd: () => {
      running.then((e3) => e3.close()).catch(() => undefined);
    },
  });
}

/**
 * Boots the e3 the worker runs.
 *
 * @throws {Error} When the storage cannot be opened — a browser API it keeps
 *   repositories with is missing, named — or a seam refuses its options: a
 *   whole-intake limit that is not a whole number of bytes, say.
 */
async function start(options: ServeE3Options): Promise<Running> {
  // The runners are made as repositories need them: what they would refuse is
  // refused here, before anything opens.
  const wholeIntakeLimit = wholeIntakeLimitOf(options.wholeIntakeLimit);
  const persist = options.persist ?? true;
  const storage: WebStorage = await openWebStorage({ persist, ...(options.name !== undefined && { name: options.name }) });
  try {
    const locks = storage.adapters.locks;
    const stateStore = new WebStateStore(storage.adapters.records);

    // Each unit worker's port to this e3, which its e3 platform functions
    // reach the app through: served by the bridge, as the page is, but with no
    // lifelines — the pool ends it as it lets the worker go, which gives up
    // what the e3 was answering for it.
    const connections = new Set<UnitConnection>();
    const pool = new UnitPool({
      units: options.units,
      connect: () => {
        const { port1, port2 } = new MessageChannel();
        const bridge = serveBridge(() => Promise.resolve({ fetch: (request: Request) => app.fetch(request), persist }), port1, { lifelines: false });
        const connection: UnitConnection = {
          port: port2,
          close: () => {
            if (!connections.delete(connection)) return;
            bridge.end();
            port1.close();
          },
        };
        connections.add(connection);
        return connection;
      },
    });

    const runners = new Map<string, TaskRunner>();
    const getRunner = (repo: string): TaskRunner => {
      let runner = runners.get(repo);
      if (runner === undefined) {
        runner = new WebTaskRunner({ repo, pool, locks, wholeIntakeLimit });
        runners.set(repo, runner);
      }
      return runner;
    };

    // A split task's own execution is recorded under the tab's session, as
    // the runner records every unit's, so the next tab judges it by whether
    // this one lives.
    const owner = { pid: 0n, pidStartTime: 0n, bootId: locks.session };
    const orchestrator = new LocalOrchestrator(stateStore, { owner: () => Promise.resolve(owner) });

    const transfer = new WebTransferBackend({
      storage,
      getRunner,
      ...(options.transferPartBytes !== undefined && { partBytes: options.transferPartBytes }),
      ...(options.transferExportRoundBytes !== undefined && { exportRoundBytes: options.transferExportRoundBytes }),
    });

    const app = createWebApp({
      storage,
      transfer,
      getRunner,
      orchestrator,
      stateStore,
      width: pool.width,
      // Who may run what a caller supplies, as the local server grants it:
      // by roles where callers are known, and to the one caller otherwise.
      access: options.access ?? (options.identify !== undefined ? oneShotAccessByRoles() : () => 'any'),
      ...(options.identify !== undefined && { identify: options.identify }),
      ...(options.transferCommitWaitMs !== undefined && { commitWaitMs: options.transferCommitWaitMs }),
    });

    // What a closed tab left — its jobs and its commits — is recorded failed,
    // and what is past its retention forgotten, from here on.
    await transfer.start();

    return {
      boot: { fetch: (request: Request) => app.fetch(request), persist },
      close: async () => {
        await transfer.close();
        // Every worker let go, and the services each was handed ended.
        pool.close();
        for (const connection of [...connections]) connection.close();
        await storage.close();
      },
    };
  } catch (err) {
    await storage.close();
    throw err;
  }
}
