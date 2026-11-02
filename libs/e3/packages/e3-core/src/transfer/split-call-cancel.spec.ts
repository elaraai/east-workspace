/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A split call's job cancelled (#1104): written `cancelled` to its store, the
 * job finds it as it runs and stops its units, whose processes exit and whose
 * grants the budget takes back, and a relaunch is served the units that
 * finished from the cache. A job its caller's signal stops is handed over
 * instead, and stays `processing`. The units run on east-node.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ArrayType, East, FunctionType, IntegerType, NullType, encodeEastIR, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { PartitionProgress, SplitCallRequest, TreePath } from '@elaraai/e3-types';
import { packageImport } from '../package-files.js';
import { workspaceSetDataset } from '../trees.js';
import { workspaceDeploy } from '../workspace-files.js';
import { createTempDir, createTestRepo, processTree, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { Budget } from '../execution/budget.js';
import type { TaskRunner } from '../execution/interfaces.js';
import { LocalTaskRunner } from '../execution/LocalTaskRunner.js';
import { splitCallPrepare } from '../execution/splitCall.js';
import { InMemoryTransferBackend } from './InMemoryTransferBackend.js';
import { handleProcessSplitCall } from './process.js';

const WS = 'ws';
const NumbersType = ArrayType(IntegerType);
const NUMBERS: TreePath = [variant('field', 'inputs'), variant('field', 'numbers')];
const EmitInteger = FunctionType([IntegerType], NullType);

/** A split call over `numbers`, on east-node given no platform package. */
function over(body: { toIR(): unknown }): SplitCallRequest {
  return {
    bodyIr: encodeEastIR(body.toIR() as never),
    args: [{ arg: variant('dataset', NUMBERS), partition: some({ by: [] }) }],
    output: variant('array', null),
    then: none,
    runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
    limits: none,
  };
}

/** Counts for ever over every piece: only a cancel ends it. */
const spinning = over(East.function([NumbersType, EmitInteger], NullType, ($, _numbers, _emit) => {
  const count = $.let(0n);
  $.while(true, ($) => {
    $.assign(count, count.add(1n));
  });
}));

/** Emits each number, but counts for ever over the piece that holds the
 *  last, 7999: the stage's first unit, which may run alone, finishes. */
const spinningOverLast = over(East.function([NumbersType, EmitInteger], NullType, ($, numbers, emit) => {
  $.for(numbers, ($, n) => {
    $.if(East.equal(n, 7999n), ($) => {
      const count = $.let(0n);
      $.while(true, ($) => {
        $.assign(count, count.add(1n));
      });
    });
    $(emit(n));
  });
}));

/** The local runner, with every unit's progress heard. */
function tapped(inner: TaskRunner, heard: PartitionProgress[]): TaskRunner {
  return {
    execute: (storage, taskHash, inputHashes, options) => inner.execute(storage, taskHash, inputHashes, {
      ...options,
      onPartitionProgress: (progress) => {
        heard.push(progress);
        options?.onPartitionProgress?.(progress);
      },
    }),
    executeUnit: (storage, taskHash, unit, options) => inner.executeUnit(storage, taskHash, unit, options),
    executionAlive: (storage, taskHash, inHash, running) => inner.executionAlive(storage, taskHash, inHash, running),
    runDetached: (spec, options) => inner.runDetached(spec, options),
    wholeIntakeLimit: inner.wholeIntakeLimit,
    intake: (storage, spec, options) => inner.intake(storage, spec, options),
  };
}

/** Whether `holds` comes true within `ms`. */
async function until(holds: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

/** Whether process `pid` lives. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('a split call\'s job cancelled (#1104)', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let budget: Budget;
  let runner: TaskRunner;
  let heard: PartitionProgress[];
  let backend: InMemoryTransferBackend;
  let pieceBytes: string | undefined;
  /** The jobs a test filed. */
  const filed: string[] = [];

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
    budget = new Budget({ cores: 3, memory: 4 * 1024 ** 3 });
    heard = [];
    runner = tapped(new LocalTaskRunner(repo, budget), heard);
    backend = new InMemoryTransferBackend({ storage, getRepoPath: () => repo, getRunner: () => runner });
    pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    // Pieces of 16 to 256 stored bytes: a piece a segment, several of them.
    process.env.E3_TEST_PIECE_BYTES = '64';

    const zip = join(tempDir, 'numbers.zip');
    await e3.export(e3.package('numbers', '1.0.0', e3.input('numbers', NumbersType)), zip);
    await packageImport(storage, repo, zip);
    await workspaceDeploy(storage, repo, WS, 'numbers', '1.0.0');
    await workspaceSetDataset(storage, repo, WS, NUMBERS, Array.from({ length: 8000 }, (_, i) => BigInt(i)), NumbersType);
  });

  afterEach(async () => {
    // Nothing a test left runs on.
    for (const id of filed) {
      const job = await backend.splitCall.get(id);
      if (job?.status.type === 'processing') await backend.splitCall.updateStatus(id, variant('cancelled', null));
    }
    filed.length = 0;
    await until(() => budget.inFlight === 0, 15_000);
    if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
    else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Launches a call and files its job, as the one-shot routes do: its id. */
  async function file(request: SplitCallRequest): Promise<string> {
    const launched = await splitCallPrepare(storage, repo, WS, request, { grant: 'any' });
    if ('outcome' in launched) assert.fail(`the call was refused: ${launched.outcome.type}`);
    const id = globalThis.crypto.randomUUID();
    await backend.splitCall.create(id, {
      repo,
      workspace: WS,
      task: launched.task,
      inputs: [...launched.inputs],
      objects: launched.objects.map((index) => BigInt(index)),
      then: launched.then === null ? none : some(launched.then),
      limits: {
        timeoutMs: BigInt(launched.limits.timeoutMs),
        maxResultBytes: BigInt(launched.limits.maxResultBytes),
        maxLogBytes: BigInt(launched.limits.maxLogBytes),
      },
      read: launched.read,
      explain: false,
      platformFree: false,
      status: variant('processing', none),
      createdAt: new Date(),
    });
    filed.push(id);
    return id;
  }

  /** The pieces' units heard to finish, and how many pieces there are. */
  const finished = (): PartitionProgress[] => heard.filter((progress) => progress.phase === 'partition' && progress.state === 'completed');
  const pieces = (): number => heard.find((progress) => progress.phase === 'partition')?.total ?? 0;

  it('stops its units once it is cancelled: their processes exit, and the budget takes their grants back', { timeout: 120_000 }, async () => {
    const id = await file(spinning);
    await backend.splitCall.execute(id, repo);
    assert.ok(await until(() => budget.inFlight > 0, 60_000), 'a unit started');
    // The listing's own process has exited by the time it is read.
    const units = processTree(process.pid).slice(1).filter(alive);
    assert.ok(units.length > 0, 'its process runs');

    assert.equal(await backend.splitCall.updateStatus(id, variant('cancelled', null)), true, 'the cancel is written');
    assert.ok(await until(() => budget.inFlight === 0, 15_000), `the budget took every grant back: ${budget.inFlight} in flight`);
    assert.ok(await until(() => units.every((pid) => !alive(pid)), 15_000), `every unit's process exited: ${units.filter(alive).join(', ')}`);
    assert.equal((await backend.splitCall.get(id))?.status.type, 'cancelled', 'and the job stays cancelled');
    assert.equal(await backend.splitCall.updateStatus(id, variant('processing', none)), false, 'which no status write moves it from');
  });

  it('serves a relaunch the units that finished before the cancel from the cache', { timeout: 120_000 }, async () => {
    const first = await file(spinningOverLast);
    await backend.splitCall.execute(first, repo);
    assert.ok(await until(() => pieces() > 2 && finished().length === pieces() - 1, 60_000),
      `every piece but the one holding 7999 finished: ${finished().length} of ${pieces()}`);
    await backend.splitCall.updateStatus(first, variant('cancelled', null));
    assert.ok(await until(() => budget.inFlight === 0, 15_000), 'the piece holding 7999 was stopped');
    const total = pieces();

    heard.length = 0;
    const again = await file(spinningOverLast);
    await backend.splitCall.execute(again, repo);
    assert.ok(await until(() => finished().length === total - 1, 60_000), `the relaunch finished ${finished().length} of ${total - 1}`);
    assert.deepEqual(finished().filter((progress) => progress.cached !== true).map((progress) => progress.index), [],
      'every piece that finished before the cancel was served from the cache');
    await backend.splitCall.updateStatus(again, variant('cancelled', null));
  });

  it('is handed over, not cancelled, when its caller\'s signal stops it: it stays processing, and its units stop', { timeout: 120_000 }, async () => {
    const id = await file(spinning);
    const round = new AbortController();
    const handled = handleProcessSplitCall({ storage, splitCallStore: backend.splitCall, runner, signal: round.signal }, { id, repo });
    assert.ok(await until(() => budget.inFlight > 0, 60_000), 'the units started');
    const over = new Error('the round is over');
    round.abort(over);
    await assert.rejects(handled, (err) => err === over);
    assert.equal((await backend.splitCall.get(id))?.status.type, 'processing', 'the job is left for the next round');
    assert.ok(await until(() => budget.inFlight === 0, 15_000), 'and its units stopped');
  });
});
