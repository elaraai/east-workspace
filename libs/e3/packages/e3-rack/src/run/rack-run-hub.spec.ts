/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A rack's run through a real hub: `openRackRunner` grants the tasks a rack's
 * run can run whole as one run lease, which a test agent that hosts runs
 * takes up and runs with e3-core's own loop over a replica in its store,
 * answering the origin's asks as the origin's loop reaches each task. The
 * cases are the run's own (`rack-run.spec.ts`), with a hub, a session and the
 * agent between the two loops.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ArrayType, DictType, East, IntegerType, NullType, SortedMap, StringType, compareFor, decodeBeast2For, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, LocalTaskRunner, dataflowExecute, dataflowGetGraph, dataflowResolveInputHashes,
  inputsHash, packageImport, repoInit, uuidv7, workspaceCreate, workspaceDeploy, workspaceSetDataset,
  type StorageBackend, type TaskExecuteOptions, type TaskResult,
} from '@elaraai/e3-core';
import { SyncDescriptionType, type SyncDescription } from '@elaraai/e3-types';
import { RackHub } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import type { RackLeaseGrant } from '../protocol/rack-wire.js';
import { readRackRun } from '../protocol/task-envelope.js';
import { TestRackAgent, type TestRackAgentOptions } from '../testing/test-rack-agent.js';
import { DEFAULT_RACK_POLICY, setMode, type RackPolicy } from '../routing/policy.js';
import { openRackRunner } from '../runner/rack-runner.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

/** east-node's own `console_log`, which a task may call on a rack. */
const log = East.platform('console_log', [StringType], NullType);
const add = East.function([IntegerType], IntegerType, ($, x) => {
  $(log(East.str`adding one to ${x}`));
  return x.add(1n);
});
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
  constructor(repo: string, private readonly taskName: string, private readonly instead: (options: TaskExecuteOptions | undefined, run: () => Promise<TaskResult>) => Promise<TaskResult>) {
    super(repo);
  }
  override execute(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    const run = () => super.execute(storage, taskHash, inputHashes, options);
    return options?.taskName === this.taskName ? this.instead(options, run) : run();
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

/** Whether a lease is a rack's run's. */
const isRun = (grant: RackLeaseGrant): boolean => readRackRun(JSON.parse(grant.eventJson)) !== undefined;

/** The tasks a run lease granted its rack's run, by the verdicts its event carries. */
const granted = (grant: RackLeaseGrant | undefined): string[] =>
  Object.keys((grant === undefined ? undefined : readRackRun(JSON.parse(grant.eventJson)))?.verdicts ?? {}).sort();

interface FixtureOptions {
  /** The repository's rack policy: every task a rack may run, unless given */
  readonly policy?: RackPolicy;
  /** How long a rack may be quiet before the hub gives its leases to another, in ms */
  readonly visibilityMs?: number;
}

/** A hub of its own, a repository with a package deployed, and how a test enrolls racks and runs the dataflow. */
async function fixture(pkg: Pkg, options: FixtureOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'e3rh-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const hub = new RackHub({ foreground: true, home, leaseWindowMs: 40, ...(options.visibilityMs !== undefined && { visibilityMs: options.visibilityMs }) });
  assert(await hub.start());
  cleanup.push(() => hub.stop());
  const client = new HubClient(home);
  const repo = join(home, 'repo');
  assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const zip = join(home, 'package.zip');
  await e3.export(pkg, zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'dev');
  await workspaceDeploy(storage, repo, 'dev', 'flow', '1.0.0');
  const budget = new Budget({ cores: 1, memory: 512 * 1024 ** 2 }, { sampler: null });
  const policy = options.policy ?? AUTO;

  /** Enrolls a rack and starts it, noting each lease it is granted. */
  const agent = async (as: Pick<TestRackAgentOptions, 'rackRuns' | 'runRunner' | 'capacity'> = {}) => {
    const mint = await client.enroll();
    const peer = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, {
      certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined, capacity: 4,
      timings: { heartbeatMs: 200, extendMs: 100 }, ...as,
    });
    cleanup.push(() => peer.close());
    const grants: RackLeaseGrant[] = [];
    const claim = peer.claim.bind(peer);
    peer.claim = async () => {
      const grant = await claim();
      if (grant !== null) grants.push(grant);
      return grant;
    };
    peer.start();
    return { peer, grants };
  };

  /** One run of the dataflow, with the rack the policy and the fleet give it. */
  const runOnce = async (start: { cancelWhen?: () => Promise<void> } = {}) => {
    const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'rack run test', budget, policy, home, waitForRackMs: 0 });
    const started = Date.now();
    const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
    const handle = await orchestrator.start(storage, repo, 'dev', { runner: rack.runner, width: budget.cores + rack.rackSlots });
    if (start.cancelWhen !== undefined) void start.cancelWhen().then(() => orchestrator.cancel(handle));
    try {
      await orchestrator.wait(handle).catch(() => undefined);
    } finally {
      await rack.close();
    }
    return { status: await orchestrator.getStatus(handle), ms: Date.now() - started, described: rack.describe() };
  };
  const identity = async (name: string) => {
    const task = (await dataflowGetGraph(storage, repo, 'dev')).tasks.find((each) => each.name === name)!;
    const inputs = await dataflowResolveInputHashes(storage, repo, 'dev', task);
    return { taskHash: task.hash, inputsHash: inputsHash(inputs as string[]) };
  };
  /** How each attempt at a task over its current inputs ended, oldest first. */
  const attempts = async (name: string): Promise<string[]> => {
    const { taskHash, inputsHash: inHash } = await identity(name);
    return (await storage.refs.executionListAttempts(repo, taskHash, inHash)).map(({ status }) => status?.type ?? 'none');
  };
  const outputOf = async (name: string): Promise<string | null> => {
    const ref = await storage.datasets.read(repo, 'dev', `tasks/${name}/output`);
    return ref?.type === 'value' ? ref.value.hash : null;
  };
  /** What a task's latest attempt over its current inputs wrote, in a repository: the origin's unless given. */
  const logs = async (name: string, at = repo): Promise<{ stdout: string; stderr: string }> => {
    const { taskHash, inputsHash: inHash } = await identity(name);
    const last = (await storage.refs.executionListAttempts(at, taskHash, inHash)).at(-1);
    assert.ok(last !== undefined, `${name} has an attempt there`);
    const read = async (stream: 'stdout' | 'stderr') => (await storage.logs.read(at, taskHash, inHash, last.executionId, stream, { limit: 1 << 20 })).data;
    return { stdout: await read('stdout'), stderr: await read('stderr') };
  };
  /** The description a run lease's rack's run was granted, as the origin wrote it. */
  const description = async (grant: RackLeaseGrant): Promise<SyncDescription> => {
    const run = readRackRun(JSON.parse(grant.eventJson));
    assert.ok(run !== undefined, 'a run lease');
    return decodeBeast2For(SyncDescriptionType)(await storage.objects.read(repo, run.description));
  };
  return { home, hub, repo, storage, budget, agent, runOnce, identity, attempts, outputOf, logs, description };
}

describe('a rack\'s run through a hub', { concurrency: false }, () => {
  it('runs a chain on a rack that hosts runs, in one lease, nothing run here, each task\'s log the rack\'s, and the cache holds what it made', async () => {
    const f = await fixture(chain());
    const hosting = await f.agent({ rackRuns: true });
    const plain = await f.agent();
    const { status, described } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.match(described, /4 tasks granted a rack's run/);
    assert.equal(hosting.grants.length, 1, 'one lease for the run');
    assert.deepEqual(granted(hosting.grants[0]), ['first', 'other', 'second', 'third']);
    assert.deepEqual(plain.grants, [], 'a rack that hosts no run claims nothing of it');
    assert.equal(f.budget.peak, 0, 'nothing ran here');
    for (const name of ['first', 'second', 'third', 'other']) {
      assert.deepEqual(await f.attempts(name), ['success']);
      const here = await f.logs(name);
      const there = await f.logs(name, hosting.peer.repo);
      assert.match(here.stdout, /adding one to \d+/);
      assert.equal(here.stdout, there.stdout, `what ${name} printed on its rack is its log here`);
      assert.match(here.stderr, /e3: on its rack: ran \d+ ms/);
    }
    const recording = new Recording(f.repo);
    assert.equal((await dataflowExecute(f.storage, f.repo, 'dev', { runner: recording })).success, true);
    assert.deepEqual(recording.executed, [], 'a plain run executes nothing');
  });

  it('runs fifty independent tasks in one lease', async (t) => {
    const a = e3.input('a', IntegerType, variant('value', 1n));
    const many = Array.from({ length: 50 }, (_, i) => e3.task(`t${String(i).padStart(2, '0')}`, [a], add));
    const f = await fixture(e3.package('flow', '1.0.0', a, ...many));
    const hosting = await f.agent({ rackRuns: true, capacity: 8 });
    const { status, ms } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.equal(hosting.grants.length, 1);
    assert.equal(granted(hosting.grants[0]).length, 50);
    assert.equal(f.budget.peak, 0, 'nothing ran here');
    t.diagnostic(`fifty tasks through the hub in ${ms} ms`);
  });

  it('takes a split task whole through the hub: the origin plans nothing, and its output is a plain run\'s', async () => {
    const pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    process.env.E3_TEST_PIECE_BYTES = '64';
    cleanup.push(() => {
      if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
      else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
      return Promise.resolve();
    });
    const split = (): Pkg => {
      const rows = e3.input('rows', DictType(IntegerType, IntegerType), variant('value', new SortedMap(
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
    const f = await fixture(split());
    await f.agent({ rackRuns: true });
    const { status } = await f.runOnce();
    assert.equal(status.state, 'completed');
    const { taskHash, inputsHash: inHash } = await f.identity('total');
    const recorded = await f.storage.refs.executionGetLatest(f.repo, taskHash, inHash);
    assert.ok(recorded?.type === 'success');
    assert.deepEqual(recorded.value.plan, none);
    assert.equal(await f.storage.refs.executionPlanRead(f.repo, taskHash, inHash), null);

    const plain = await fixture(split());
    assert.equal((await dataflowExecute(plain.storage, plain.repo, 'dev')).success, true);
    assert.equal(await f.outputOf('total'), await plain.outputOf('total'));
    assert.equal(await f.outputOf('report'), await plain.outputOf('report'));
  });

  it('grants on a re-run exactly the tasks below a changed input, in a lease of its own', async () => {
    const f = await fixture(chain());
    const hosting = await f.agent({ rackRuns: true });
    await f.runOnce();
    await workspaceSetDataset(f.storage, f.repo, 'dev', A, 5n, IntegerType);
    const { status } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.equal(hosting.grants.length, 2);
    assert.deepEqual(granted(hosting.grants[1]), ['first', 'second', 'third']);
    assert.equal(f.budget.peak, 0, 'nothing ran here');
  });

  it('grants the tasks below one the origin ran, described by the output it made', async () => {
    const f = await fixture(chain());
    const hosting = await f.agent({ rackRuns: true });
    assert.equal((await dataflowExecute(f.storage, f.repo, 'dev', { filter: 'first' })).success, true);
    const first = await f.outputOf('first');
    const { status } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.deepEqual(granted(hosting.grants[0]), ['other', 'second', 'third']);
    const edge = (await f.description(hosting.grants[0]!)).datasets.get('tasks/first/output');
    assert.ok(edge?.type === 'value' && edge.value.hash === first);
  });

  it('runs here a task its rack hands back, and the one below it, each under a new attempt after one interrupted', async () => {
    const f = await fixture(chain());
    await f.agent({ rackRuns: true, runRunner: (repo) => new Steered(repo, 'second', () => Promise.resolve({
      state: 'error', cached: false, executionId: uuidv7(), error: 'no room on its rack', handedBack: 'no-room',
    })) });
    const { status } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.deepEqual(await f.attempts('first'), ['success']);
    assert.deepEqual(await f.attempts('other'), ['success']);
    assert.deepEqual(await f.attempts('second'), ['interrupted', 'success']);
    assert.deepEqual(await f.attempts('third'), ['interrupted', 'success']);
    assert.ok(f.budget.peak > 0, 'they ran here');
  });

  it('records a failure on the rack as the task\'s verdict, its log the rack\'s, and runs it again here only as the policy says', async () => {
    const fails = (first: ReturnType<typeof e3.task>) =>
      e3.task('second', [first.output], East.function([IntegerType], IntegerType, ($, x) => $.let([], ArrayType(IntegerType)).get(x)));
    const f = await fixture(chain(fails));
    const hosting = await f.agent({ rackRuns: true });
    const { status } = await f.runOnce();
    assert.equal(status.state, 'failed');
    assert.deepEqual(await f.attempts('second'), ['failed']);
    assert.equal(await f.outputOf('third'), null, '`third` did not run');
    assert.equal(f.budget.peak, 0, 'nothing ran here');
    const here = await f.logs('second');
    const there = await f.logs('second', hosting.peer.repo);
    assert.ok(there.stderr.length > 0, 'the task wrote to stderr on its rack');
    assert.equal(here.stderr, there.stderr, 'its log here is the rack\'s');

    const retrying = await fixture(chain(fails), { policy: { ...AUTO, retryTaskFailuresLocally: true } });
    await retrying.agent({ rackRuns: true });
    const again = await retrying.runOnce();
    assert.equal(again.status.state, 'failed');
    assert.deepEqual(await retrying.attempts('second'), ['interrupted', 'failed'], 'it ran again here, and failed again');
  });

  it('cancels the rack\'s run, and what it runs, when the origin\'s run is cancelled', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    let stopped = false;
    const f = await fixture(chain());
    await f.agent({ rackRuns: true, runRunner: (repo) => new Steered(repo, 'second', (options) => new Promise((resolve) => {
      started();
      options?.signal?.addEventListener('abort', () => {
        stopped = true;
        resolve({ state: 'error', cached: false, executionId: uuidv7(), error: 'cancelled: the run was aborted', cancelled: true });
      }, { once: true });
    })) });
    const { status } = await f.runOnce({ cancelWhen: () => running });
    assert.equal(status.state, 'cancelled');
    for (let i = 0; i < 100 && !stopped; i++) await delay(20);
    assert.equal(stopped, true, 'the rack\'s runner saw its signal abort');
  });

  it('runs here every task not yet answered when its rack goes away mid-run', async () => {
    const f = await fixture(chain(), { visibilityMs: 300 });
    let reached!: () => void;
    const holding = new Promise<void>((resolve) => { reached = resolve; });
    const { peer } = await f.agent({ rackRuns: true, runRunner: (repo) => new Steered(repo, 'second', (options) => new Promise((resolve) => {
      reached();
      options?.signal?.addEventListener('abort', () => resolve({ state: 'error', cached: false, executionId: uuidv7(), error: 'cancelled', cancelled: true }), { once: true });
    })) });
    void holding.then(() => peer.close());
    const { status } = await f.runOnce();
    assert.equal(status.state, 'completed');
    // `first` was answered from the rack, or, its answer still on its way
    // as the rack went away, here
    assert.ok(['success', 'interrupted,success'].includes((await f.attempts('first')).join(',')));
    assert.deepEqual(await f.attempts('second'), ['interrupted', 'success']);
    assert.deepEqual(await f.attempts('third'), ['interrupted', 'success']);
  });

  it('grants no rack\'s run when the cache answers everything', async () => {
    const f = await fixture(chain());
    const hosting = await f.agent({ rackRuns: true });
    await f.runOnce();
    const { status, described } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.equal(hosting.grants.length, 1, 'none for the second run');
    assert.doesNotMatch(described, /granted a rack's run/);
  });

  it('runs here a task no rack may run, and the task below it on the rack under a lease of its own', async () => {
    const f = await fixture(chain((first) => e3.customTask('second', [first.output], IntegerType, ($, inputs, output) => East.str`cp ${inputs.get(0n)} ${output}`)));
    const hosting = await f.agent({ rackRuns: true });
    const { status } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.equal(hosting.grants.length, 2, 'the run\'s lease, and `third`\'s');
    assert.deepEqual(granted(hosting.grants.find(isRun)), ['first', 'other']);
    assert.ok(f.budget.peak > 0, '`second` ran here');
    assert.match((await f.logs('third')).stdout, /e3: running on rack/);
  });
});
