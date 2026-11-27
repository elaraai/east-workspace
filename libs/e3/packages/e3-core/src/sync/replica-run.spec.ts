/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A replica's run, granted a selection and asked for each task's result by
 * the identity a plain run of the same package computes (a third repository's,
 * standing in for the origin's own run): its results, what it gives its
 * origin before it answers, its hand-backs, failures and logs, a forced run,
 * and a cancel.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DictType, East, IntegerType, SortedMap, compareFor, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { SyncSelection } from '@elaraai/e3-types';
import { dataflowGetGraph, dataflowResolveInputHashes } from '../dataflow.js';
import { dataflowExecute } from '../execution/local-orchestrator.js';
import { LocalTaskRunner } from '../execution/LocalTaskRunner.js';
import type { TaskExecuteOptions, TaskResult } from '../execution/interfaces.js';
import { inputsHash } from '../executions.js';
import { touchReachable } from '../gc-graph.js';
import { packageImport } from '../package-files.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { LocalStorage } from '../storage/local/LocalBackend.js';
import { createTempDir, createTestRepo, gated, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';
import { syncDescribe } from './describe.js';
import { originObjects } from './replica.js';
import { replicaRunOpen, type ReplicaRun, type ReplicaRunAnswer, type ReplicaRunOrigin } from './replica-run.js';

const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));

const all = (names: readonly string[]): SyncSelection => variant('partial', {
  tasks: [...names], binds: { paths: [], functions: [], records: [], pages: [] }, records: [],
});

/** `a -> first -> second -> third`, `second` given or an `add`. */
function chain(second?: (first: ReturnType<typeof e3.task>) => ReturnType<typeof e3.task>): Parameters<typeof e3.export>[0] {
  const a = e3.input('a', IntegerType, variant('value', 1n));
  const first = e3.task('first', [a], add);
  const middle = second?.(first) ?? e3.task('second', [first.output], add);
  return e3.package('chain', '1.0.0', a, first, middle, e3.task('third', [middle.output], add));
}

/** What a task is asked by, and what a plain run of it made. */
interface Expected {
  readonly taskHash: string;
  readonly inputsHash: string;
  readonly outputHash: string | null;
}

/**
 * An origin with a package deployed and nothing run, a replica repository, and
 * a reference repository where the same package ran plainly. The origin's side
 * of the run writes straight onto the origin's store, and counts.
 */
async function rig(t: TestContext, pkg: Parameters<typeof e3.export>[0]) {
  const origin = createTestRepo();
  const replica = createTestRepo();
  const reference = createTestRepo();
  const dir = createTempDir();
  t.after(() => {
    for (const repo of [origin, replica, reference]) removeTestRepo(repo);
    removeTempDir(dir);
  });
  const storage: StorageBackend = new LocalStorage();
  const zip = join(dir, 'pkg.zip');
  await e3.export(pkg, zip);
  for (const repo of [origin, reference]) {
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'ws');
    await workspaceDeploy(storage, repo, 'ws', 'chain', '1.0.0');
  }
  await dataflowExecute(storage, reference, 'ws');

  const graph = await dataflowGetGraph(storage, reference, 'ws');
  const expected = new Map<string, Expected>();
  for (const task of graph.tasks) {
    const inputs = await dataflowResolveInputHashes(storage, reference, 'ws', task);
    const inHash = inputs.every((hash) => hash !== null) ? inputsHash(inputs as string[]) : 'e'.repeat(64);
    const status = await storage.refs.executionGetLatest(reference, task.hash, inHash);
    expected.set(task.name, { taskHash: task.hash, inputsHash: inHash, outputHash: status?.type === 'success' ? status.value.outputHash : null });
  }

  const description = await syncDescribe(storage, origin, 'ws', all(graph.tasks.map((task) => task.name)));
  const written: string[] = [];
  let haves = 0;
  const side: ReplicaRunOrigin = {
    objects: originObjects(storage, origin, description),
    have: (hashes) => {
      haves++;
      return storage.objects.touch(origin, hashes);
    },
    write: async (objects) => {
      for (const [hash, bytes] of objects) {
        assert.equal(await storage.objects.write(origin, bytes), hash);
        written.push(hash);
      }
    },
  };
  const open = (runner: LocalTaskRunner = new LocalTaskRunner(replica)): ReplicaRun =>
    replicaRunOpen({ storage, repo: replica, runner, origin: side, width: 4 });
  const ask = (run: ReplicaRun, name: string, onLog?: (stream: 'stdout' | 'stderr', text: string) => void): Promise<ReplicaRunAnswer> => {
    const { taskHash, inputsHash: inHash } = expected.get(name)!;
    return run.ask({ taskName: name, taskHash, inputsHash: inHash, ...(onLog !== undefined && { onLog }) });
  };
  return { storage, origin, replica, expected, description, written, haves: () => haves, open, ask };
}

/** A local runner over a repository whose `execute` of one task does as it is told. */
class Steered extends LocalTaskRunner {
  constructor(repo: string, private readonly taskHash: string, private readonly instead: (options: TaskExecuteOptions | undefined, run: () => Promise<TaskResult>) => Promise<TaskResult>) {
    super(repo);
  }
  override execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    const run = () => super.execute(storage, taskHash, inputHashes, options);
    return taskHash === this.taskHash ? this.instead(options, run) : run();
  }
}

describe('a replica\'s run', { concurrency: false }, () => {
  it('answers each task of a chain with the output a plain run makes, which the origin holds whole before the answer arrives', async (t) => {
    const r = await rig(t, chain());
    const run = r.open();
    await run.grant({ description: r.description, force: false });
    for (const name of ['first', 'second', 'third']) {
      const answer = await r.ask(run, name);
      assert.ok(answer.kind === 'done' && answer.state === 'success', `${name}: ${JSON.stringify(answer)}`);
      assert.equal(answer.outputHash, r.expected.get(name)!.outputHash, `${name}'s output`);
      assert.equal(await touchReachable(r.storage, r.origin, [answer.outputHash!]), true, `the origin holds ${name}'s output whole`);
      assert.ok(answer.durationMs >= 0 && answer.startedAtMs > 0);
    }
    t.diagnostic(`the origin was written ${r.written.length} objects, after ${r.haves()} asks of what it holds`);
  });

  it('answers a task alike whether it is asked before its run reaches it or after the run has ended', async (t) => {
    const r = await rig(t, chain());
    const run = r.open();
    await run.grant({ description: r.description, force: false });
    const early = await r.ask(run, 'third');
    const late = await r.ask(run, 'third');
    assert.deepEqual(late, early);
    assert.equal(early.kind, 'done');
  });

  it('answers an ask over other inputs unknown, once the task has settled', async (t) => {
    const r = await rig(t, chain());
    const gate = gated<void>();
    const run = r.open(new Steered(r.replica, r.expected.get('second')!.taskHash, async (_options, execute) => {
      await gate.opened;
      return execute();
    }));
    await run.grant({ description: r.description, force: false });
    let settled = false;
    const other = run.ask({ taskName: 'second', taskHash: r.expected.get('second')!.taskHash, inputsHash: 'f'.repeat(64) })
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, 'not before `second` has settled');
    gate.open();
    assert.deepEqual(await other, { kind: 'unknown' });
    assert.equal((await r.ask(run, 'second')).kind, 'done');
  });

  it('answers a task its runner handed back with the reason, the task below it unknown, and the one above done', async (t) => {
    const r = await rig(t, chain());
    const run = r.open(new Steered(r.replica, r.expected.get('second')!.taskHash, () => Promise.resolve({
      state: 'error', cached: false, executionId: uuidv7(), error: 'no room on its rack', handedBack: 'no-room',
    })));
    await run.grant({ description: r.description, force: false });
    assert.deepEqual(await r.ask(run, 'second'), { kind: 'handed-back', reason: 'no-room' });
    assert.deepEqual(await r.ask(run, 'third'), { kind: 'unknown' });
    assert.equal((await r.ask(run, 'first')).kind, 'done');
  });

  it('answers a task that failed with its exit code, and the task below it unknown', async (t) => {
    const r = await rig(t, chain((first) => e3.customTask('second', [first.output], IntegerType, () => East.str`exit 1`)));
    const run = r.open();
    await run.grant({ description: r.description, force: false });
    const failed = await r.ask(run, 'second');
    assert.ok(failed.kind === 'done' && failed.state === 'failed', JSON.stringify(failed));
    assert.equal(failed.exitCode, 1);
    assert.deepEqual(await r.ask(run, 'third'), { kind: 'unknown' });
  });

  it('gives an ask its task\'s log from the first byte, each byte once, whether it asked before the task started or after it ended', async (t) => {
    const r = await rig(t, chain((first) => e3.customTask('second', [first.output], IntegerType,
      ($, inputs, output) => East.str`printf 'one\ntwo\nthree\n' && cp ${inputs.get(0n)} ${output}`)));
    const run = r.open();
    await run.grant({ description: r.description, force: false });
    const before: string[] = [];
    const answered = await r.ask(run, 'second', (stream, text) => { if (stream === 'stdout') before.push(text); });
    assert.equal(answered.kind, 'done');
    const after: string[] = [];
    await r.ask(run, 'second', (stream, text) => { if (stream === 'stdout') after.push(text); });
    assert.equal(before.join(''), 'one\ntwo\nthree\n');
    assert.equal(after.join(''), 'one\ntwo\nthree\n');
  });

  it('answers a task a second run forces only by an execution that run started', async (t) => {
    const r = await rig(t, chain());
    const first = r.open();
    await first.grant({ description: r.description, force: false });
    const once = await r.ask(first, 'second');
    assert.equal(once.kind, 'done');

    const grantedAt = Date.now();
    const again = r.open();
    await again.grant({ description: r.description, force: true });
    const twice = await r.ask(again, 'second');
    assert.ok(twice.kind === 'done' && once.kind === 'done');
    assert.ok(twice.startedAtMs >= grantedAt, 'a new execution');
    assert.equal(twice.outputHash, once.outputHash);
  });

  it('answers every ask waiting unknown once it is cancelled, and stops what it runs', async (t) => {
    const r = await rig(t, chain());
    let stopped = false;
    const run = r.open(new Steered(r.replica, r.expected.get('first')!.taskHash, (options) => new Promise((resolve) => {
      options?.signal?.addEventListener('abort', () => {
        stopped = true;
        resolve({ state: 'error', cached: false, executionId: uuidv7(), error: 'cancelled: the run was aborted', cancelled: true });
      }, { once: true });
    })));
    await run.grant({ description: r.description, force: false });
    const waiting = r.ask(run, 'first');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await run.cancel();
    assert.deepEqual(await waiting, { kind: 'unknown' });
    for (let i = 0; i < 50 && !stopped; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(stopped, true, 'the runner saw its signal abort');
  });

  it('answers a split task with the output a plain run makes, and gives the origin no plan', async (t) => {
    const pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    process.env.E3_TEST_PIECE_BYTES = '64';
    t.after(() => {
      if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
      else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
    });
    const Rows = DictType(IntegerType, IntegerType);
    const rows = e3.input('rows', Rows, variant('value', new SortedMap(
      Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType))));
    const total = e3.streamTask('total', {
      inputs: [e3.partition(rows)],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, rows, emit) => {
      $.for(rows, ($, value) => {
        $(emit(value));
      });
    });
    const r = await rig(t, e3.package('chain', '1.0.0', rows, total, e3.task('report', [total.output], add)));
    const run = r.open();
    await run.grant({ description: r.description, force: false });
    const answer = await r.ask(run, 'total');
    assert.ok(answer.kind === 'done' && answer.state === 'success', JSON.stringify(answer));
    assert.equal(answer.outputHash, r.expected.get('total')!.outputHash);
    const { taskHash, inputsHash: inHash } = r.expected.get('total')!;
    const recorded = await r.storage.refs.executionGetLatest(r.replica, taskHash, inHash);
    assert.ok(recorded?.type === 'success' && recorded.value.plan.type === 'some', 'the replica planned the task');
    assert.ok(!r.written.includes(recorded.value.plan.value), 'and gave the origin no plan');
    assert.equal((await r.ask(run, 'report')).kind, 'done');
  });
});
