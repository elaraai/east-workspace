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
import { randomBytes } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DictType, East, IntegerType, SortedMap, StringType, compareFor, none, variant } from '@elaraai/east';
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

/** Takes an object the replica's run gives the origin, whole or as a stream, into a repository. */
function held(storage: StorageBackend, repo: string, bytes: Uint8Array | AsyncIterable<Uint8Array>): Promise<string> {
  return bytes instanceof Uint8Array ? storage.objects.write(repo, bytes) : storage.objects.writeStream(repo, bytes);
}

/** A local runner that counts what it executes. */
class Counting extends LocalTaskRunner {
  calls = 0;
  override execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    this.calls++;
    return super.execute(storage, taskHash, inputHashes, options);
  }
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
        assert.equal(await held(storage, origin, bytes), hash);
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
  return { storage, origin, replica, expected, description, written, haves: () => haves, side, open, ask };
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

/** A local runner that holds each result until `count` executions have one, then gives them all at once. */
class Together extends LocalTaskRunner {
  private readonly held: Array<() => void> = [];
  constructor(repo: string, private readonly count: number) {
    super(repo);
  }
  override async execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    const result = await super.execute(storage, taskHash, inputHashes, options);
    await new Promise<void>((resolve) => {
      this.held.push(resolve);
      if (this.held.length === this.count) for (const release of this.held) release();
    });
    return result;
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

  it('writes an object outputs that end at once share once, each answer waiting on that write', async (t) => {
    const a = e3.input('a', IntegerType, variant('value', 1n));
    const same = Array.from({ length: 4 }, (_, i) => e3.task(`same_${i}`, [a], add));
    const r = await rig(t, e3.package('chain', '1.0.0', a, ...same));
    // An origin whose writes are slow, as one through a hub is: each output
    // ends while the first write is in flight
    const written: string[] = [];
    const slow: ReplicaRunOrigin = {
      objects: originObjects(r.storage, r.origin, r.description),
      have: (hashes) => r.storage.objects.touch(r.origin, hashes),
      write: async (objects) => {
        await delay(200);
        for (const [hash, bytes] of objects) {
          assert.equal(await held(r.storage, r.origin, bytes), hash);
          written.push(hash);
        }
      },
    };
    const run = replicaRunOpen({ storage: r.storage, repo: r.replica, runner: new Together(r.replica, same.length), origin: slow, width: same.length });
    await run.grant({ description: r.description, force: false });
    const output = r.expected.get('same_0')!.outputHash;
    for (const answer of await Promise.all(same.map((task) => r.ask(run, task.name)))) {
      assert.ok(answer.kind === 'done' && answer.state === 'success' && answer.outputHash === output, JSON.stringify(answer));
    }
    assert.deepEqual(written.filter((hash) => hash === output), [output], 'the output they share was written once');
    assert.equal(new Set(written).size, written.length, 'as was every object');
  });

  it('starts no run when it is cancelled while its grant is being made', async (t) => {
    const r = await rig(t, chain());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: ReplicaRunOrigin = { ...r.side, objects: { read: async (hashes) => { await gate; return r.side.objects.read(hashes); } } };
    const runner = new Counting(r.replica);
    const run = replicaRunOpen({ storage: r.storage, repo: r.replica, runner, origin: slow, width: 4 });
    const granting = run.grant({ description: r.description, force: false });
    const cancelling = run.cancel();
    release();
    await granting;
    await cancelling;
    assert.equal(runner.calls, 0, 'nothing ran');
    assert.equal((await r.ask(run, 'first')).kind, 'unknown');
  });

  it('resolves its cancel only once what it was writing to the origin is written, and removes its workspace', async (t) => {
    const r = await rig(t, chain());
    let began = 0;
    let done = 0;
    const slow: ReplicaRunOrigin = {
      ...r.side,
      write: async (objects) => {
        began++;
        await delay(200);
        await r.side.write(objects);
        done++;
      },
    };
    const run = replicaRunOpen({ storage: r.storage, repo: r.replica, runner: new LocalTaskRunner(r.replica), origin: slow, width: 4 });
    await run.grant({ description: r.description, force: false });
    for (let i = 0; i < 300 && began === 0; i++) await delay(10);
    assert.ok(began > 0, 'a write is under way');
    await run.cancel();
    assert.equal(done, began, 'every write it began was done when its cancel resolved');
    assert.deepEqual((await r.storage.refs.workspaceList(r.replica)).filter((name) => name.startsWith('replica-')), [], 'its workspace is gone');
  });

  it('answers from the execution it settled a task with, not a later one in its repository', async (t) => {
    const r = await rig(t, chain());
    const run = r.open();
    await run.grant({ description: r.description, force: false });
    const settled = await r.ask(run, 'first');
    assert.ok(settled.kind === 'done' && settled.state === 'success');
    // Another run of the repository then fails the task over the same inputs
    const { taskHash, inputsHash: inHash } = r.expected.get('first')!;
    const latest = await r.storage.refs.executionGetLatest(r.replica, taskHash, inHash);
    assert.ok(latest?.type === 'success');
    const executionId = uuidv7();
    await r.storage.refs.executionWrite(r.replica, taskHash, inHash, executionId, variant('failed', {
      executionId, inputHashes: latest.value.inputHashes, startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: none, unit: false,
    }));
    const again = await r.ask(run, 'first');
    assert.ok(again.kind === 'done' && again.state === 'success' && again.outputHash === settled.outputHash, JSON.stringify(again));
    await run.cancel();
  });

  it('gives an ask no log of an execution an earlier process left recorded running', async (t) => {
    const r = await rig(t, chain((first) => e3.customTask('second', [first.output], IntegerType,
      ($, inputs, output) => East.str`printf 'fresh\n' && cp ${inputs.get(0n)} ${output}`)));
    const { taskHash, inputsHash: inHash } = r.expected.get('second')!;
    const stale = uuidv7();
    await r.storage.refs.executionWrite(r.replica, taskHash, inHash, stale, variant('running', {
      executionId: stale, inputHashes: [], startedAt: new Date(Date.now() - 3600_000), pid: 1n, pidStartTime: 0n, bootId: 'gone', unit: false,
    }));
    await r.storage.logs.append(r.replica, taskHash, inHash, stale, 'stdout', 'stale\n');
    const run = r.open();
    await run.grant({ description: r.description, force: false });
    const seen: string[] = [];
    const answered = await r.ask(run, 'second', (stream, text) => { if (stream === 'stdout') seen.push(text); });
    assert.equal(answered.kind, 'done');
    assert.equal(seen.join(''), 'fresh\n');
    await run.cancel();
  });

  it('writes again what a write that failed left, and answers', async (t) => {
    const r = await rig(t, chain());
    let failing = true;
    const flaky: ReplicaRunOrigin = {
      ...r.side,
      write: async (objects) => {
        if (failing) {
          failing = false;
          throw new Error('the hub hiccuped');
        }
        await r.side.write(objects);
      },
    };
    const run = replicaRunOpen({ storage: r.storage, repo: r.replica, runner: new LocalTaskRunner(r.replica), origin: flaky, width: 4 });
    await run.grant({ description: r.description, force: false });
    for (const name of ['first', 'second', 'third']) {
      const answer = await r.ask(run, name);
      assert.ok(answer.kind === 'done' && answer.state === 'success', `${name}: ${JSON.stringify(answer)}`);
      assert.equal(await touchReachable(r.storage, r.origin, [answer.outputHash!]), true, `the origin holds ${name}'s output`);
    }
    await run.cancel();
  });

  it('answers a task whose log cannot be read to its end, without its log', async (t) => {
    const r = await rig(t, chain());
    const logs = new Proxy(r.storage.logs, {
      get: (target, key) => (key === 'read' ? () => Promise.reject(new Error('the log store is down')) : Reflect.get(target, key, target) as unknown),
    });
    const storage = new Proxy(r.storage, { get: (target, key) => (key === 'logs' ? logs : Reflect.get(target, key, target) as unknown) });
    const run = replicaRunOpen({ storage, repo: r.replica, runner: new LocalTaskRunner(r.replica), origin: r.side, width: 4 });
    await run.grant({ description: r.description, force: false });
    const answer = await r.ask(run, 'first', () => undefined);
    assert.ok(answer.kind === 'done' && answer.state === 'success', JSON.stringify(answer));
    await run.cancel();
  });

  it('leaves no listener on an ask\'s signal once the ask has settled', async (t) => {
    const r = await rig(t, chain());
    const run = r.open();
    await run.grant({ description: r.description, force: false });
    const controller = new AbortController();
    for (const name of ['first', 'second', 'third']) {
      const { taskHash, inputsHash: inHash } = r.expected.get(name)!;
      await run.ask({ taskName: name, taskHash, inputsHash: inHash, signal: controller.signal });
    }
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await run.cancel();
  });

  it('gives the origin an output too large for one write as a stream of its own', async (t) => {
    // Random, so that it is stored at about its size: 24 MiB of base64, over 16 MiB stored
    const big = randomBytes(18 * 1024 * 1024).toString('base64');
    const text = e3.input('text', StringType, variant('value', big));
    const grow = e3.task('grow', [text], East.function([StringType], StringType, ($, value) => value.concat('!')));
    const r = await rig(t, e3.package('chain', '1.0.0', text, grow));
    const streamed: string[] = [];
    const watching: ReplicaRunOrigin = {
      ...r.side,
      write: async (objects) => {
        for (const [hash, bytes] of objects) if (!(bytes instanceof Uint8Array)) streamed.push(hash);
        await r.side.write(objects);
      },
    };
    const run = replicaRunOpen({ storage: r.storage, repo: r.replica, runner: new LocalTaskRunner(r.replica), origin: watching, width: 4 });
    await run.grant({ description: r.description, force: false });
    const answer = await r.ask(run, 'grow');
    assert.ok(answer.kind === 'done' && answer.state === 'success', JSON.stringify(answer));
    assert.equal(answer.outputHash, r.expected.get('grow')!.outputHash);
    assert.deepEqual(streamed, [answer.outputHash], 'its output went as a stream');
    assert.equal(await touchReachable(r.storage, r.origin, [answer.outputHash]), true);
    await run.cancel();
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
