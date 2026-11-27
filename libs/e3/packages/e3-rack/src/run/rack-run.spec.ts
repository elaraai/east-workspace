/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A run of which a rack's run runs part, both loops in one process, with no
 * hub: the origin's loop over its repository with the origin's body, and the
 * rack's run over a second repository with its own runner, its origin's side
 * straight onto the origin's store.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArrayType, DictType, East, IntegerType, SortedMap, compareFor, none, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { SyncDescription } from '@elaraai/e3-types';
import {
  Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, LocalTaskRunner, dataflowExecute, dataflowGetGraph, dataflowResolveInputHashes,
  inputsHash, originObjects, packageImport, packageRead, repoInit, replicaRunOpen, uuidv7, workspaceCreate, workspaceDeploy, workspaceSetDataset,
  type ExecutionIds, type ExecutionResult, type ReplicaRun, type StorageBackend, type TaskBodyRequest, type TaskExecuteOptions, type TaskResult,
} from '@elaraai/e3-core';
import { DEFAULT_RACK_POLICY, setMode, type RackPolicy } from '../routing/policy.js';
import type { EligibilityEvaluator } from '../routing/eligibility.js';
import { openRackRun } from './rack-run.js';
import { createRackRunBody } from './run-body.js';
import { rackRunSelection } from './selection.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
const A = [variant('field', 'inputs'), variant('field', 'a')];
const AUTO: RackPolicy = setMode({ ...DEFAULT_RACK_POLICY, enabled: true }, 'auto');

type Pkg = Parameters<typeof e3.export>[0];

/** `a -> first -> second -> third`, `second` given or an `add`, and beside them `other` over `b`. */
function chain(second?: (first: ReturnType<typeof e3.task>) => ReturnType<typeof e3.task>): Pkg {
  const a = e3.input('a', IntegerType, variant('value', 1n));
  const b = e3.input('b', IntegerType, variant('value', 10n));
  const first = e3.task('first', [a], add);
  const middle = second?.(first) ?? e3.task('second', [first.output], add);
  return e3.package('flow', '1.0.0', a, first, middle, e3.task('third', [middle.output], add), b, e3.task('other', [b], add));
}

/** A local runner whose `execute` of one task does as it is told. */
class Steered extends LocalTaskRunner {
  constructor(repo: string, private readonly taskHash: string, private readonly instead: (options: TaskExecuteOptions | undefined, run: () => Promise<TaskResult>) => Promise<TaskResult>) {
    super(repo, new Budget({ cores: 4, memory: 1024 ** 3 }, { sampler: null }));
  }
  override execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    const run = () => super.execute(storage, taskHash, inputHashes, options);
    return taskHash === this.taskHash ? this.instead(options, run) : run();
  }
}

/** A local runner that notes each task it executed, rather than served. */
class Recording extends LocalTaskRunner {
  readonly executed: string[] = [];
  override async execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    const result = await super.execute(storage, taskHash, inputHashes, options);
    if (!result.cached) this.executed.push(options?.taskName ?? taskHash);
    return result;
  }
}

interface RigOptions {
  readonly policy?: RackPolicy;
  /** The rack's run's runner, made over the replica's repository */
  readonly replicaRunner?: (replica: string, tasks: ReadonlyMap<string, string>) => LocalTaskRunner;
  /** The rack's run itself, in place of a replica's */
  readonly run?: () => ReplicaRun;
  /** The body for what the rack's run is not granted */
  readonly inner?: (request: TaskBodyRequest, local: (ids?: ExecutionIds) => Promise<ExecutionResult>) => Promise<ExecutionResult>;
}

/** An origin with a package deployed and a replica repository beside it. */
async function rig(pkg: Pkg, options: RigOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'e3rr-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const origin = join(home, 'origin');
  const replica = join(home, 'replica');
  assert(repoInit(origin).success);
  assert(repoInit(replica).success);
  const storage = new LocalStorage();
  const zip = join(home, 'pkg.zip');
  await e3.export(pkg, zip);
  await packageImport(storage, origin, zip);
  await workspaceCreate(storage, origin, 'dev');
  await workspaceDeploy(storage, origin, 'dev', 'flow', '1.0.0');
  const tasks = (await packageRead(storage, origin, 'flow', '1.0.0')).tasks;
  const budget = new Budget({ cores: 1, memory: 512 * 1024 ** 2 }, { sampler: null });
  const grants: SyncDescription[] = [];
  const asked: string[] = [];

  const open = (description: SyncDescription): Promise<ReplicaRun> => {
    grants.push(description);
    const run = options.run?.() ?? replicaRunOpen({
      storage, repo: replica, width: 8,
      runner: options.replicaRunner?.(replica, tasks) ?? new LocalTaskRunner(replica, new Budget({ cores: 4, memory: 1024 ** 3 }, { sampler: null })),
      origin: {
        objects: originObjects(storage, origin, description),
        have: (hashes) => storage.objects.touch(origin, hashes),
        write: async (objects) => {
          for (const [, bytes] of objects) await (bytes instanceof Uint8Array ? storage.objects.write(origin, bytes) : storage.objects.writeStream(origin, bytes));
        },
      },
    });
    return Promise.resolve({
      grant: (grant) => run.grant(grant),
      ask: (ask) => { asked.push(ask.taskName); return run.ask(ask); },
      cancel: () => run.cancel(),
    });
  };

  /** One run of the origin's dataflow, the rack's run granted what it is. */
  const runOnce = async (start: { force?: boolean | string[]; filter?: string; cancelWhen?: () => Promise<void> } = {}) => {
    const rack = await openRackRun({
      repoPath: origin, workspace: 'dev', storage, policy: options.policy ?? AUTO, budget, open,
      ...(start.force !== undefined && { force: start.force }),
      ...(start.filter !== undefined && { filter: start.filter }),
      ...(options.inner !== undefined && { inner: options.inner }),
    });
    let mostInFlight = 0;
    let watching = true;
    const watch = (async () => {
      while (watching) {
        mostInFlight = Math.max(mostInFlight, budget.inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    })();
    const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
    const handle = await orchestrator.start(storage, origin, 'dev', {
      runner: rack.runner, width: budget.cores + rack.rackSlots,
      ...(start.force !== undefined && { force: start.force }),
      ...(start.filter !== undefined && { filter: start.filter }),
    });
    if (start.cancelWhen !== undefined) void start.cancelWhen().then(() => orchestrator.cancel(handle));
    try {
      await orchestrator.wait(handle).catch(() => undefined);
    } finally {
      watching = false;
      await watch;
      await rack.close();
    }
    return { rack, status: await orchestrator.getStatus(handle), mostInFlight };
  };

  /** A task's inputs at the origin, as its run found them. */
  const identity = async (name: string): Promise<{ taskHash: string; inputsHash: string }> => {
    const task = (await dataflowGetGraph(storage, origin, 'dev')).tasks.find((each) => each.name === name)!;
    const inputs = await dataflowResolveInputHashes(storage, origin, 'dev', task);
    return { taskHash: task.hash, inputsHash: inputsHash(inputs as string[]) };
  };
  /** How each attempt at a task over its current inputs ended, oldest first. */
  const attempts = async (name: string): Promise<string[]> => {
    const { taskHash, inputsHash: inHash } = await identity(name);
    return (await storage.refs.executionListAttempts(origin, taskHash, inHash)).map(({ status }) => status?.type ?? 'none');
  };
  const outputOf = async (name: string): Promise<string | null> => {
    const ref = await storage.datasets.read(origin, 'dev', `tasks/${name}/output`);
    return ref?.type === 'value' ? ref.value.hash : null;
  };
  return { storage, origin, replica, tasks, budget, grants, asked, runOnce, identity, attempts, outputOf };
}

const granted = (description: SyncDescription | undefined): string[] => [...(description?.package.tasks.keys() ?? [])].sort();

describe('a run a rack\'s run runs part of', { concurrency: false }, () => {
  it('runs a chain wholly on the rack\'s side: one grant, an ask a task, no grant of the origin\'s budget, every output set', async () => {
    const r = await rig(chain());
    const { status, mostInFlight, rack } = await r.runOnce();
    assert.equal(status.state, 'completed');
    assert.deepEqual(granted(r.grants[0]), ['first', 'other', 'second', 'third']);
    assert.equal(r.grants.length, 1);
    assert.deepEqual([...r.asked].sort(), ['first', 'other', 'second', 'third']);
    assert.equal(rack.rackSlots, 4);
    assert.equal(mostInFlight, 0, 'nothing ran here');
    for (const name of ['first', 'second', 'third', 'other']) {
      assert.ok(await r.outputOf(name) !== null, `${name}'s output is set`);
      assert.deepEqual(await r.attempts(name), ['success'], `${name} has one attempt, the rack's`);
    }

    // The origin's cache holds what the rack's run made: a plain run executes nothing
    const plain = new Recording(r.origin);
    const again = await dataflowExecute(r.storage, r.origin, 'dev', { runner: plain });
    assert.equal(again.success, true);
    assert.deepEqual(plain.executed, []);
  });

  it('grants fifty independent tasks at once, each asked for once', async () => {
    const a = e3.input('a', IntegerType, variant('value', 1n));
    const many = Array.from({ length: 50 }, (_, i) => e3.task(`t${String(i).padStart(2, '0')}`, [a], add));
    const r = await rig(e3.package('flow', '1.0.0', a, ...many));
    const { status, rack } = await r.runOnce();
    assert.equal(status.state, 'completed');
    assert.equal(r.grants.length, 1);
    assert.equal(r.grants[0]!.package.tasks.size, 50);
    assert.equal(rack.rackSlots, 50);
    assert.equal(r.asked.length, 50);
    assert.equal(new Set(r.asked).size, 50);
  });

  it('takes a split task whole: the origin plans nothing, and its output is a plain run\'s', async () => {
    const pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    process.env.E3_TEST_PIECE_BYTES = '64';
    cleanup.push(() => {
      if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
      else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
      return Promise.resolve();
    });
    const Rows = DictType(IntegerType, IntegerType);
    const split = (): Pkg => {
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
      return e3.package('flow', '1.0.0', rows, total, e3.task('report', [total.output], add));
    };
    const r = await rig(split());
    const { status } = await r.runOnce();
    assert.equal(status.state, 'completed');
    const { taskHash, inputsHash: inHash } = await r.identity('total');
    const recorded = await r.storage.refs.executionGetLatest(r.origin, taskHash, inHash);
    assert.ok(recorded?.type === 'success');
    assert.deepEqual(recorded.value.plan, none, 'the origin\'s record names no plan');
    assert.equal(await r.storage.refs.executionPlanRead(r.origin, taskHash, inHash), null, 'nor a plan pointer');

    const plain = await rig(split());
    assert.equal((await dataflowExecute(plain.storage, plain.origin, 'dev')).success, true);
    assert.equal(await r.outputOf('total'), await plain.outputOf('total'));
    assert.equal(await r.outputOf('report'), await plain.outputOf('report'));
  });

  it('grants on a re-run exactly the tasks below a changed input', async () => {
    const r = await rig(chain());
    await r.runOnce();
    await workspaceSetDataset(r.storage, r.origin, 'dev', A, 5n, IntegerType);
    const { status } = await r.runOnce();
    assert.equal(status.state, 'completed');
    assert.deepEqual(granted(r.grants[1]), ['first', 'second', 'third']);
  });

  it('grants the tasks below one the origin ran, described by the output it made', async () => {
    const r = await rig(chain());
    assert.equal((await dataflowExecute(r.storage, r.origin, 'dev', { filter: 'first' })).success, true);
    const first = await r.outputOf('first');
    const { status } = await r.runOnce();
    assert.equal(status.state, 'completed');
    assert.deepEqual(granted(r.grants[0]), ['other', 'second', 'third']);
    const edge = r.grants[0]!.datasets.get('tasks/first/output');
    assert.ok(edge?.type === 'value' && edge.value.hash === first);
  });

  it('runs a task its rack hands back here, and the one below it, each under a new attempt after one interrupted', async () => {
    const r = await rig(chain(), {
      replicaRunner: (replica, tasks) => new Steered(replica, tasks.get('second')!, () => Promise.resolve({
        state: 'error', cached: false, executionId: uuidv7(), error: 'no room on its rack', handedBack: 'no-room',
      })),
    });
    const { status, mostInFlight } = await r.runOnce();
    assert.equal(status.state, 'completed');
    assert.deepEqual(await r.attempts('first'), ['success']);
    assert.deepEqual(await r.attempts('second'), ['interrupted', 'success']);
    assert.deepEqual(await r.attempts('third'), ['interrupted', 'success']);
    assert.ok(mostInFlight > 0, 'they ran here');
  });

  it('records a failure on the rack as the task\'s verdict, with its log, and runs it again here only as the policy says', async () => {
    const fails = (first: ReturnType<typeof e3.task>) =>
      e3.task('second', [first.output], East.function([IntegerType], IntegerType, ($, x) => $.let([], ArrayType(IntegerType)).get(x)));
    const r = await rig(chain(fails));
    const { status, mostInFlight } = await r.runOnce();
    assert.equal(status.state, 'failed');
    assert.deepEqual(await r.attempts('second'), ['failed']);
    assert.equal(await r.outputOf('third'), null, '`third` did not run');
    assert.equal(mostInFlight, 0, 'nothing ran here');
    // Its log here is the rack's
    const { taskHash, inputsHash: inHash } = await r.identity('second');
    const [here] = await r.storage.refs.executionListAttempts(r.origin, taskHash, inHash);
    const [there] = await r.storage.refs.executionListAttempts(r.replica, taskHash, inHash);
    const logOf = async (repo: string, id: string) => (await r.storage.logs.read(repo, taskHash, inHash, id, 'stderr', { limit: 1 << 20 })).data;
    const rackLog = await logOf(r.replica, there!.executionId);
    assert.ok(rackLog.length > 0, 'the task wrote to stderr on the rack');
    assert.equal(await logOf(r.origin, here!.executionId), rackLog);

    const retrying = await rig(chain(fails), { policy: { ...AUTO, retryTaskFailuresLocally: true } });
    const again = await retrying.runOnce();
    assert.equal(again.status.state, 'failed');
    assert.deepEqual(await retrying.attempts('second'), ['interrupted', 'failed'], 'it ran again here, and failed again');
  });

  it('cancels the rack\'s run, and what it runs, when the origin\'s run is cancelled', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    let stopped = false;
    const r = await rig(chain(), {
      replicaRunner: (replica, tasks) => new Steered(replica, tasks.get('second')!, (options) => new Promise((resolve) => {
        started();
        options?.signal?.addEventListener('abort', () => {
          stopped = true;
          resolve({ state: 'error', cached: false, executionId: uuidv7(), error: 'cancelled: the run was aborted', cancelled: true });
        }, { once: true });
      })),
    });
    const { status } = await r.runOnce({ cancelWhen: () => running });
    assert.equal(status.state, 'cancelled');
    for (let i = 0; i < 100 && !stopped; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(stopped, true, 'the rack\'s runner saw its signal abort');
  });

  it('runs everything here when its rack\'s run is lost', async () => {
    const r = await rig(chain(), {
      run: () => ({
        grant: () => Promise.resolve(),
        ask: () => Promise.reject(new Error('its rack went away')),
        cancel: () => Promise.resolve(),
      }),
    });
    const { status } = await r.runOnce();
    assert.equal(status.state, 'completed');
    for (const name of ['first', 'second', 'third']) assert.deepEqual(await r.attempts(name), ['interrupted', 'success']);
  });

  it('opens no rack\'s run when the cache answers everything', async () => {
    const r = await rig(chain());
    await r.runOnce();
    const { rack } = await r.runOnce();
    assert.equal(r.grants.length, 1);
    assert.equal(rack.rackSlots, 0);
    assert.match(rack.unattached ?? '', /no task/);
  });

  it('keeps a task its rack cannot run here, with the tasks below it, through the inner body', async () => {
    const throughInner: string[] = [];
    const r = await rig(chain((first) => e3.customTask('second', [first.output], IntegerType, ($, inputs, output) => East.str`cp ${inputs.get(0n)} ${output}`)), {
      inner: (request, local) => {
        if (request.role === 'task' && request.options.taskName !== undefined) throughInner.push(request.options.taskName);
        return local();
      },
    });
    const { status } = await r.runOnce();
    assert.equal(status.state, 'completed');
    assert.deepEqual(granted(r.grants[0]), ['first', 'other']);
    assert.deepEqual(throughInner.sort(), ['second', 'third']);
  });

  it('selects no split task whose merges the policy keeps here, nor one below it', async () => {
    const pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    process.env.E3_TEST_PIECE_BYTES = '64';
    cleanup.push(() => {
      if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
      else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
      return Promise.resolve();
    });
    const rows = e3.input('rows', DictType(IntegerType, IntegerType), variant('value', new SortedMap(
      Array.from({ length: 800 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType))));
    const total = e3.streamTask('total', {
      inputs: [e3.partition(rows)],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, rows, emit) => {
      $.for(rows, ($, value) => {
        $(emit(value));
      });
    });
    const start = e3.input('start', IntegerType, variant('value', 1n));
    const r = await rig(e3.package('flow', '1.0.0', rows, total, e3.task('report', [total.output], add), start, e3.task('plain', [start], add)));
    const merging = (local: boolean) => ({
      evaluateTask: () => Promise.resolve({ eligible: true as const, tier: 'node' as const, size: 'large' as const, timeoutMinutes: 60, memoryLimit: null, gpu: false, environment: null }),
      keepsMergesHere: () => local,
    }) as unknown as EligibilityEvaluator;
    const kept = await rackRunSelection(r.storage, r.origin, 'dev', { evaluator: merging(true), hostBound: false });
    assert.deepEqual([...kept.tasks].sort(), ['plain'], 'a task that is not split is the rack\'s all the same');
    const taken = await rackRunSelection(r.storage, r.origin, 'dev', { evaluator: merging(false), hostBound: false });
    assert.deepEqual([...taken.tasks].sort(), ['plain', 'report', 'total']);
  });

  it('selects no task of a tier the rack that would take the run up does not boot, nor one below it', async () => {
    const r = await rig(chain());
    const evaluator = {
      evaluateTask: (_storage: StorageBackend, _repo: string, _hash: string, name: string) => Promise.resolve({
        eligible: true as const, tier: name === 'second' ? 'py' as const : 'node' as const, size: 'large' as const, timeoutMinutes: 60, memoryLimit: null, gpu: false,
        environment: null,
      }),
      keepsMergesHere: () => false,
    } as unknown as EligibilityEvaluator;
    const selection = await rackRunSelection(r.storage, r.origin, 'dev', { evaluator, hostBound: false, tiers: new Set(['node']) });
    assert.deepEqual([...selection.tasks].sort(), ['first', 'other']);
  });

  it('says a body with nothing to wrap stops its units, as a runner with no body does, and one that wraps a body as that body says', () => {
    const run = { grant: () => Promise.resolve(), ask: () => Promise.resolve({ kind: 'unknown' as const }), cancel: () => Promise.resolve() };
    assert.equal(createRackRunBody({ run, selected: new Set(), retryTaskFailuresLocally: false }).stopsUnits, true);
    const inner = Object.assign(() => Promise.reject(new Error('unused')), { stopsUnits: false });
    assert.equal(createRackRunBody({ run, selected: new Set(), retryTaskFailuresLocally: false, inner }).stopsUnits, false);
  });

  it('selects no task whose verdict declares an environment, nor one below it', async () => {
    const r = await rig(chain());
    const evaluator = {
      evaluateTask: (_storage: StorageBackend, _repo: string, _hash: string, name: string) => Promise.resolve({
        eligible: true as const, tier: 'node' as const, size: 'large' as const, timeoutMinutes: 60, memoryLimit: null, gpu: false,
        environment: name === 'second' ? 'e'.repeat(64) : null,
      }),
      keepsMergesHere: () => false,
    } as unknown as EligibilityEvaluator;
    const selection = await rackRunSelection(r.storage, r.origin, 'dev', { evaluator, hostBound: false });
    assert.deepEqual([...selection.tasks].sort(), ['first', 'other']);
    const bound = await rackRunSelection(r.storage, r.origin, 'dev', { evaluator, hostBound: true });
    assert.deepEqual(bound.tasks, [], 'and none when the run\'s processes are bound to this host');
  });
});
