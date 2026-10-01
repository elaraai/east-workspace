/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 in Chromium, as an app's pages run it: e3's own platform functions
 * called from a unit worker, a dataflow interrupted by closing its page, the
 * Web Locks it holds across runs whose unit workers are terminated, what a
 * terminated unit worker asked of it given up, and an e3 served over a port
 * closed once its page has gone, which a browser's port does not say.
 *
 * Each case drives pages running e3 (`e3.page.ts`) from Node, through e3's
 * client and a fetch forwarded into the page. The packages are exported here,
 * in Node, with e3's SDK, and imported through e3's API, as an app imports
 * the zip its build exported.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  ArrayType,
  East,
  IntegerType,
  NullType,
  OptionType,
  StringType,
  decodeBeast2For,
  encodeBeast2For,
  encodeEastIR,
  equalFor,
  none,
  some,
  variant,
} from '@elaraai/east';
import {
  ApiError,
  Platform,
  dataflowExecute,
  dataflowExecuteLaunch,
  datasetGet,
  datasetSet,
  oneShotExecute,
  packageImport,
  repoCreate,
  taskLogs,
  workspaceCreate,
  workspaceDeploy,
  workspaceStatus,
  type RequestOptions,
  type WorkspaceStatusResult,
} from '@elaraai/e3-api-client';
import { ExecuteResultType, OneShotRequestType, type OneShotRequest, type RunnerValue } from '@elaraai/e3-types';
import { assertDataflowSucceeded } from '@elaraai/e3-api-tests';
import { WEB_E3_ORIGIN } from '../bridge/protocol.js';
import { E3_PLATFORM } from '../execution/e3-platform.js';
import { ADMIN_TOKEN } from '../testing/callers.js';
import { HOLD_PLATFORM, test_hold } from '../testing/hold-platform.js';
import {
  FIXTURE_VERSION,
  HELD_PACKAGE,
  PLATFORM_PACKAGE,
  RowsType,
  buildE3Fixtures,
  heldOutput,
  heldRows,
} from '../testing/e3-fixtures.js';
import type { E3PageOptions } from './e3.page.js';
import { forwardInto } from './e3-forward.js';
import { Harness, type HarnessPage } from './harness.js';

const entries = {
  e3: fileURLToPath(new URL('./e3.page.js', import.meta.url)),
  'e3-worker': fileURLToPath(new URL('./e3.worker.js', import.meta.url)),
  'e3-unit-worker': fileURLToPath(new URL('./e3-unit.worker.js', import.meta.url)),
  'e3-port-worker': fileURLToPath(new URL('./e3-port.worker.js', import.meta.url)),
  'e3-client-worker': fileURLToPath(new URL('./e3-client.worker.js', import.meta.url)),
};

const REPO = 'default';
const WORKSPACE = 'main';

/** The piece size the held task is planned with: each of its input's
 *  segments a piece. */
const PIECE_BYTES = 64;

/** A line the engine writes to a split task's log as a piece settles. */
const PIECE_LINE = /^piece (\d+)\/(\d+) (completed|cached|failed|cancelled) /;

/** The pieces a split task's log says settled, by how. */
interface Pieces {
  /** How many pieces the task has, or `null` before any settled */
  readonly total: number | null;
  /** The pieces that ran, by number */
  readonly completed: number[];
  /** The pieces served from the execution cache, by number */
  readonly cached: number[];
}

/** What a split task's log says of its pieces. */
function piecesOf(log: string): Pieces {
  let total: number | null = null;
  const completed: number[] = [];
  const cached: number[] = [];
  for (const line of log.split('\n')) {
    const match = PIECE_LINE.exec(line);
    if (match === null) continue;
    total = Number(match[2]);
    if (match[3] === 'completed') completed.push(Number(match[1]));
    if (match[3] === 'cached') cached.push(Number(match[1]));
  }
  return { total, completed, cached };
}

/** Waits for a condition read through e3, failing with what it waits for. */
async function until<T>(read: () => Promise<T | null>, what: string, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await read();
    if (found !== null) return found;
    if (Date.now() > deadline) assert.fail(`waited ${ms / 1000} s for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A task's status in a workspace's status. */
function taskStatus(status: WorkspaceStatusResult, task: string): WorkspaceStatusResult['tasks'][number]['status'] {
  const found = status.tasks.find((info) => info.name === task);
  if (found === undefined) assert.fail(`the workspace has no task '${task}'`);
  return found.status;
}

const sameRows = equalFor(RowsType);
const samePid = equalFor(OptionType(IntegerType));

/** A one-shot's program that holds its unit worker's thread, in a page whose
 *  units hold. */
const holding = East.function([], NullType, ($) => {
  $(test_hold());
});

/** A one-shot's program that reaches the e3 it runs in — its unit worker
 *  connects to it — and then holds its unit worker's thread. */
const connectedHolding = East.asyncFunction([], NullType, ($) => {
  $(Platform.workspaceList(WEB_E3_ORIGIN, REPO, ADMIN_TOKEN));
  $(test_hold());
});

/** A one-shot's program that reaches the e3 it runs in, and answers. */
const connectedAnswering = East.asyncFunction([], IntegerType, ($) => {
  $(Platform.workspaceList(WEB_E3_ORIGIN, REPO, ADMIN_TOKEN));
  return 1n;
});

/** A one-shot's program that asks the e3 it runs in for a one-shot, through
 *  e3's own platform functions, and answers what it answered. */
const asking = East.asyncFunction([OneShotRequestType], ExecuteResultType, ($, request) =>
  Platform.oneShotExecute(WEB_E3_ORIGIN, REPO, WORKSPACE, request, ADMIN_TOKEN));

/** A runner given platform packages. */
function runnerWith(...platforms: string[]): RunnerValue {
  return variant('east_node', { platforms, decode: variant('lazy', null) });
}

/** A one-shot's limits: a timeout, and the rest as the e3's defaults. */
function timeout(ms: number): OneShotRequest['limits'] {
  return some({ timeoutMs: some(BigInt(ms)), maxResultBytes: none, maxLogBytes: none });
}

/** The Web Locks a page's origin holds, by name. */
function heldLocks(page: HarnessPage): Promise<string[]> {
  return page.call<string[]>('locks');
}

/** The lifelines among locks: a unit worker's, or a worker's of `e3.fetch`. */
function lifelines(locks: readonly string[], of: 'unit' | 'worker'): string[] {
  return locks.filter((name) => name.startsWith(`e3-web:${of}:`));
}

/** The session locks of a storage's name among locks. */
function sessions(locks: readonly string[], name: string): string[] {
  return locks.filter((lock) => lock.startsWith(`${name}:session:`));
}

/** Asserts a page has raised nothing since it opened, a call's answer saying
 *  so or not. */
function raisedNothing(page: HarnessPage): void {
  assert.deepEqual(page.raisedErrors.map((error) => error.stack ?? error.message), [], 'the page raised nothing');
}

describe('e3 in Chromium, as an app\'s pages run it', () => {
  let harness: Harness | undefined;
  let fixtures: Awaited<ReturnType<typeof buildE3Fixtures>>;
  /** The storages the cases kept, removed once they have run */
  const names: string[] = [];

  before(async () => {
    fixtures = await buildE3Fixtures();
    harness = await Harness.open({ entries });
  });

  after(async () => {
    try {
      // Every page that ran e3 is closed by now, and its connections with it.
      if (harness !== undefined && names.length > 0) {
        const cleaner = await harness.newPage('e3');
        for (const name of names) await cleaner.call('clear', name);
      }
    } finally {
      await harness?.close();
    }
  });

  /** Opens a page whose e3 keeps its repositories under a name. */
  async function openE3(name: string, hold: boolean): Promise<{ page: HarnessPage; opts: RequestOptions }> {
    if (!names.includes(name)) names.push(name);
    const page = await harness!.newPage('e3');
    const options: E3PageOptions = { name, hold, pieceBytes: PIECE_BYTES };
    await page.call('start', options);
    return { page, opts: { token: ADMIN_TOKEN, fetch: forwardInto(page) } };
  }

  /** Makes the repository and the workspace, and deploys a package to it. */
  async function deploy(opts: RequestOptions, zip: Uint8Array, pkg: string): Promise<void> {
    await repoCreate(WEB_E3_ORIGIN, REPO, opts);
    await packageImport(WEB_E3_ORIGIN, REPO, zip, opts);
    await workspaceCreate(WEB_E3_ORIGIN, REPO, WORKSPACE, opts);
    await workspaceDeploy(WEB_E3_ORIGIN, REPO, WORKSPACE, `${pkg}@${FIXTURE_VERSION}`, opts);
  }

  it('runs e3\'s own platform functions in a unit worker: Platform.workspaceList lists the workspaces of the e3 in its page', async () => {
    const { page, opts } = await openE3(`e3-web-platform-${crypto.randomUUID()}`, false);
    try {
      await deploy(opts, fixtures.platform, PLATFORM_PACKAGE);
      await workspaceCreate(WEB_E3_ORIGIN, REPO, 'other', opts);
      await datasetSet(WEB_E3_ORIGIN, REPO, WORKSPACE, [variant('field', 'inputs'), variant('field', 'repo')], encodeBeast2For(StringType)(REPO), opts);
      assertDataflowSucceeded(await dataflowExecute(WEB_E3_ORIGIN, REPO, WORKSPACE, {}, opts));
      const { data } = await datasetGet(WEB_E3_ORIGIN, REPO, WORKSPACE, [variant('field', 'tasks'), variant('field', 'workspaces'), variant('field', 'output')], opts);
      assert.deepEqual(decodeBeast2For(ArrayType(StringType))(data), [WORKSPACE, 'other'], 'the workspaces of the e3 the unit runs in');
      raisedNothing(page);
    } finally {
      // Closing the tab stops its e3 worker, and its units with it.
      await page.close();
    }
  });

  it('reports a dataflow interrupted by closing its page as the local server reports a run whose process died, and serves a new run the pieces that finished from the execution cache', async () => {
    const name = `e3-web-interrupted-${crypto.randomUUID()}`;
    const rowsPath = [variant('field', 'inputs'), variant('field', 'rows')];
    const outputPath = [variant('field', 'tasks'), variant('field', 'held'), variant('field', 'output')];

    // The first page runs the dataflow: every piece of the held task but its
    // last, which holds its unit worker, finishes. Then the page closes.
    const first = await openE3(name, true);
    let total: number;
    try {
      await deploy(first.opts, fixtures.held, HELD_PACKAGE);
      await datasetSet(WEB_E3_ORIGIN, REPO, WORKSPACE, rowsPath, encodeBeast2For(RowsType)(heldRows()), first.opts);
      await dataflowExecuteLaunch(WEB_E3_ORIGIN, REPO, WORKSPACE, {}, first.opts);
      const ran = await until(async () => {
        let log: string;
        try {
          log = (await taskLogs(WEB_E3_ORIGIN, REPO, WORKSPACE, 'held', { stream: 'stdout' }, first.opts)).data;
        } catch (err) {
          // Asked before the run has recorded the task's execution.
          if (err instanceof ApiError && err.code === 'execution_not_found') return null;
          throw err;
        }
        const pieces = piecesOf(log);
        return pieces.total !== null && pieces.completed.length === pieces.total - 1 ? pieces : null;
      }, 'every piece of the held task but the one that holds to finish');
      total = ran.total!;
      assert.ok(total > 1, `the held task was split into pieces: ${total}`);
      assert.deepEqual([...ran.completed].sort((a, b) => a - b), Array.from({ length: total - 1 }, (_, i) => i + 1),
        'the pieces that finished are every one but the last, which holds');
      // While its page lives, the task is in progress, under the tab's pid, 0.
      const running = taskStatus(await workspaceStatus(WEB_E3_ORIGIN, REPO, WORKSPACE, first.opts), 'held');
      if (running.type !== 'in-progress') assert.fail(`the running task is in progress while its page lives, not ${running.type}`);
      assert.ok(samePid(running.value.pid, some(0n)), 'under the tab\'s pid, 0');
      raisedNothing(first.page);
    } finally {
      // As a tab closes: its e3 worker and its unit workers stop, mid-run.
      await first.page.close();
    }

    // The next page reports it as the local server reports a task whose
    // process died: stale-running, under the pid it was recorded with — a
    // tab's, 0 — and nothing holds the workspace.
    const second = await openE3(name, false);
    try {
      const stale = await until(async () => {
        const status = await workspaceStatus(WEB_E3_ORIGIN, REPO, WORKSPACE, second.opts);
        return taskStatus(status, 'held').type === 'stale-running' ? status : null;
      }, 'the next page to report the held task stale-running');
      const held = taskStatus(stale, 'held');
      assert.ok(held.type === 'stale-running' && samePid(held.value.pid, some(0n)), 'recorded under a tab\'s pid, 0');
      assert.equal(stale.lock.type, 'none', 'nothing holds the workspace');

      // A new run is served the pieces that finished from the execution cache,
      // and runs the one that did not.
      assertDataflowSucceeded(await dataflowExecute(WEB_E3_ORIGIN, REPO, WORKSPACE, {}, second.opts));
      const rerun = piecesOf((await taskLogs(WEB_E3_ORIGIN, REPO, WORKSPACE, 'held', { stream: 'stdout' }, second.opts)).data);
      assert.equal(rerun.total, total, 'the new run planned the same pieces');
      assert.deepEqual([...rerun.cached].sort((a, b) => a - b), Array.from({ length: total - 1 }, (_, i) => i + 1),
        'the pieces that finished are served from the execution cache');
      assert.deepEqual(rerun.completed, [total], 'the piece that was running runs again, alone');
      const { data } = await datasetGet(WEB_E3_ORIGIN, REPO, WORKSPACE, outputPath, second.opts);
      assert.ok(sameRows(decodeBeast2For(RowsType)(data), heldOutput()), 'the task\'s output is every amount doubled');
      raisedNothing(second.page);
    } finally {
      await second.page.close();
    }
  });

  it('holds a bounded set of Web Locks across runs whose unit workers the pool terminates', async () => {
    const { page, opts } = await openE3(`e3-web-locks-${crypto.randomUUID()}`, true);
    try {
      await deploy(opts, fixtures.platform, PLATFORM_PACKAGE);
      // Each run's unit worker connects to the e3, over the port it was
      // handed, and holds until its timeout terminates it.
      const held: OneShotRequest = {
        bodyIr: encodeEastIR(connectedHolding.toIR()),
        args: [],
        runner: runnerWith(E3_PLATFORM, HOLD_PLATFORM),
        limits: timeout(1_000),
      };
      let first: string[] | null = null;
      for (let run = 1; run <= 6; run++) {
        const result = await oneShotExecute(WEB_E3_ORIGIN, REPO, WORKSPACE, held, opts);
        assert.equal(result.outcome.type, 'timed_out', `run ${run} held its unit worker past its timeout, which terminated it: ${result.stderr}`);
        // Its worker is gone once the browser has freed the worker's lifeline.
        const locks = await until(async () => {
          const now = await heldLocks(page);
          return lifelines(now, 'unit').length === 0 ? now : null;
        }, `run ${run}'s unit worker to have gone`);
        assert.equal(lifelines(locks, 'worker').length, 1, `after run ${run}, one worker of e3.fetch holds a lifeline — the page's e3 worker — and no port a unit worker was handed: ${locks.join(', ')}`);
        first ??= [...locks].sort();
        assert.deepEqual([...locks].sort(), first, `after run ${run}, the origin holds the locks it held after the first`);
      }
      // A unit worker that finishes stays, idle, connected to the e3: its port
      // holds no lifeline either.
      const quick: OneShotRequest = { bodyIr: encodeEastIR(connectedAnswering.toIR()), args: [], runner: runnerWith(E3_PLATFORM), limits: none };
      const answered = await oneShotExecute(WEB_E3_ORIGIN, REPO, WORKSPACE, quick, opts);
      assert.equal(answered.outcome.type, 'success', answered.stderr);
      const idle = await heldLocks(page);
      assert.equal(lifelines(idle, 'unit').length, 1, `a unit worker is idle: ${idle.join(', ')}`);
      assert.equal(lifelines(idle, 'worker').length, 1, `and only the page's e3 worker holds a lifeline of e3.fetch: ${idle.join(', ')}`);
      raisedNothing(page);
    } finally {
      await page.close();
    }
  });

  it('gives up, in the e3, what a unit worker the pool terminated was asking of it: the one-shot it was waiting on stops', async () => {
    const { page, opts } = await openE3(`e3-web-abandoned-${crypto.randomUUID()}`, true);
    try {
      await deploy(opts, fixtures.platform, PLATFORM_PACKAGE);
      assert.deepEqual(lifelines(await heldLocks(page), 'unit'), [], 'no unit worker runs yet');
      // The inner one-shot holds its unit worker, for longer than the case
      // waits; the outer one waits on it, and runs past its own timeout.
      const inner: OneShotRequest = { bodyIr: encodeEastIR(holding.toIR()), args: [], runner: runnerWith(HOLD_PLATFORM), limits: timeout(120_000) };
      const outer: OneShotRequest = {
        bodyIr: encodeEastIR(asking.toIR()),
        args: [variant('value', encodeBeast2For(OneShotRequestType)(inner))],
        runner: runnerWith(E3_PLATFORM),
        limits: timeout(3_000),
      };
      const asked = oneShotExecute(WEB_E3_ORIGIN, REPO, WORKSPACE, outer, opts);
      // An outer call that ends before both run says why.
      let early: string | null = null;
      void asked.then((ended) => {
        early = `${ended.outcome.type}: ${ended.stderr}`;
      }, (err: unknown) => {
        early = `rejected: ${err instanceof Error ? err.message : String(err)}`;
      });
      await until(async () => {
        const locks = await heldLocks(page);
        if (lifelines(locks, 'unit').length === 2) return true;
        if (early !== null) assert.fail(`the unit that asks ended before the one it asked for ran: ${early} (locks: ${locks.join(', ')})`);
        return null;
      }, 'the unit that asks, and the one it asked for, to run');
      const result = await asked;
      assert.equal(result.outcome.type, 'timed_out', 'the unit that asked ran past its timeout, and its worker was terminated');
      await until(async () => (lifelines(await heldLocks(page), 'unit').length === 0 ? true : null),
        'the one-shot the terminated unit asked for to stop, its worker terminated', 30_000);
      raisedNothing(page);
    } finally {
      await page.close();
    }
  });

  it('closes an e3 served over a port once its page closes its connection, as the page tells it, which a browser\'s port does not say: its session is freed', async () => {
    const name = `e3-web-port-${crypto.randomUUID()}`;
    names.push(name);
    const page = await harness!.newPage('e3');
    try {
      // With no lifeline, only the page's word closes the e3.
      await page.call('startOverPort', name, false);
      assert.equal(sessions(await heldLocks(page), name).length, 1, 'the e3 holds its session');
      await page.call('close');
      await until(async () => (sessions(await heldLocks(page), name).length === 0 ? true : null), 'the e3 to close, freeing its session', 30_000);
      raisedNothing(page);
    } finally {
      await page.close();
    }
  });

  it('closes an e3 served over a port once the page connected over it has gone, which nothing says: its session is freed', async () => {
    const name = `e3-web-gone-${crypto.randomUUID()}`;
    names.push(name);
    const page = await harness!.newPage('e3');
    try {
      await page.call('startClientOverPort', name);
      assert.equal(sessions(await heldLocks(page), name).length, 1, 'the e3 holds its session');
      await page.call('endClient');
      await until(async () => (sessions(await heldLocks(page), name).length === 0 ? true : null), 'the e3 to close, freeing its session', 30_000);
      raisedNothing(page);
    } finally {
      await page.close();
    }
  });
});
