/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A rack's run through a real hub: `openRackRunner` grants the tasks a rack's
 * run can run whole as one run lease, which a test agent that hosts runs
 * takes up and runs with e3-core's own loop over a replica in its store,
 * answering the origin's asks as the origin's loop reaches each task.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArrayType, DictType, East, IntegerType, SortedMap, compareFor, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, LocalTaskRunner, dataflowExecute, dataflowGetGraph, dataflowResolveInputHashes,
  inputsHash, packageImport, repoInit, uuidv7, workspaceCreate, workspaceDeploy,
  type StorageBackend, type TaskExecuteOptions, type TaskResult,
} from '@elaraai/e3-core';
import { RackHub } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent, type TestRackAgentOptions } from '../testing/test-rack-agent.js';
import { DEFAULT_RACK_POLICY, setMode } from '../routing/policy.js';
import { openRackRunner } from '../runner/rack-runner.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
type Pkg = Parameters<typeof e3.export>[0];

/** `a -> first -> second -> third`, `second` given or an `add`. */
function chain(second?: (first: ReturnType<typeof e3.task>) => ReturnType<typeof e3.task>): Pkg {
  const a = e3.input('a', IntegerType, variant('value', 1n));
  const first = e3.task('first', [a], add);
  const middle = second?.(first) ?? e3.task('second', [first.output], add);
  return e3.package('flow', '1.0.0', a, first, middle, e3.task('third', [middle.output], add));
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

/** A hub of its own, a repository with a package deployed, and how a test enrolls racks and runs the dataflow. */
async function fixture(pkg: Pkg, hubOptions: { visibilityMs?: number } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'e3rh-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const hub = new RackHub({ foreground: true, home, leaseWindowMs: 40, ...hubOptions });
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
  const policy = setMode({ ...DEFAULT_RACK_POLICY, enabled: true }, 'auto');

  /** Enrolls a rack and starts it, noting each lease it claims. */
  const agent = async (as: Pick<TestRackAgentOptions, 'rackRuns' | 'runRunner' | 'capacity'> = {}) => {
    const mint = await client.enroll();
    const peer = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, {
      certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined, capacity: 4,
      timings: { heartbeatMs: 200, extendMs: 100 }, ...as,
    });
    cleanup.push(() => peer.close());
    const claims: string[] = [];
    const claim = peer.claim.bind(peer);
    peer.claim = async () => {
      const grant = await claim();
      if (grant !== null) claims.push(grant.leaseId);
      return grant;
    };
    peer.start();
    return { peer, claims };
  };

  /** One run of the dataflow, with the rack the policy and the fleet give it. */
  const runOnce = async () => {
    const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'rack run test', budget, policy, home, waitForRackMs: 0 });
    const started = Date.now();
    const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
    const handle = await orchestrator.start(storage, repo, 'dev', { runner: rack.runner, width: budget.cores + rack.rackSlots });
    try {
      await orchestrator.wait(handle).catch(() => undefined);
    } finally {
      await rack.close();
    }
    return { rack, status: await orchestrator.getStatus(handle), ms: Date.now() - started, described: rack.describe() };
  };
  const identity = async (name: string) => {
    const task = (await dataflowGetGraph(storage, repo, 'dev')).tasks.find((each) => each.name === name)!;
    const inputs = await dataflowResolveInputHashes(storage, repo, 'dev', task);
    return { taskHash: task.hash, inputsHash: inputsHash(inputs as string[]) };
  };
  const attempts = async (name: string): Promise<string[]> => {
    const { taskHash, inputsHash: inHash } = await identity(name);
    return (await storage.refs.executionListAttempts(repo, taskHash, inHash)).map(({ status }) => status?.type ?? 'none');
  };
  const outputOf = async (name: string): Promise<string | null> => {
    const ref = await storage.datasets.read(repo, 'dev', `tasks/${name}/output`);
    return ref?.type === 'value' ? ref.value.hash : null;
  };
  return { home, hub, repo, storage, budget, agent, runOnce, identity, attempts, outputOf };
}

describe('a rack\'s run through a hub', { concurrency: false }, () => {
  it('runs a chain on a rack that hosts runs, in one lease, with nothing run here, and the cache holds what it made', async () => {
    const f = await fixture(chain());
    const hosting = await f.agent({ rackRuns: true });
    const plain = await f.agent();
    const { status, described } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.match(described, /3 tasks granted a rack's run/);
    assert.equal(hosting.claims.length, 1, 'one lease for the run');
    assert.deepEqual(plain.claims, [], 'a rack that hosts no run claims nothing of it');
    assert.equal(f.budget.peak, 0, 'nothing ran here');
    for (const name of ['first', 'second', 'third']) {
      assert.deepEqual(await f.attempts(name), ['success']);
      const { taskHash, inputsHash: inHash } = await f.identity(name);
      const [attempt] = await f.storage.refs.executionListAttempts(f.repo, taskHash, inHash);
      assert.match((await f.storage.logs.read(f.repo, taskHash, inHash, attempt!.executionId, 'stderr')).data, /e3: on its rack: ran \d+ ms/);
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
    assert.equal(hosting.claims.length, 1);
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

  it('runs here a task its rack hands back, and the one below it', async () => {
    const f = await fixture(chain());
    await f.agent({ rackRuns: true, runRunner: (repo) => new Steered(repo, 'second', () => Promise.resolve({
      state: 'error', cached: false, executionId: uuidv7(), error: 'no room on its rack', handedBack: 'no-room',
    })) });
    const { status } = await f.runOnce();
    assert.equal(status.state, 'completed');
    assert.deepEqual(await f.attempts('first'), ['success']);
    assert.deepEqual(await f.attempts('second'), ['interrupted', 'success']);
    assert.deepEqual(await f.attempts('third'), ['interrupted', 'success']);
  });

  it('records a failure on the rack as the task\'s verdict, with the log the rack wrote', async () => {
    const f = await fixture(chain((first) => e3.task('second', [first.output], East.function([IntegerType], IntegerType, ($, x) => $.let([], ArrayType(IntegerType)).get(x)))));
    await f.agent({ rackRuns: true });
    const { status } = await f.runOnce();
    assert.equal(status.state, 'failed');
    assert.deepEqual(await f.attempts('second'), ['failed']);
    assert.equal(await f.outputOf('third'), null);
    assert.equal(f.budget.peak, 0, 'nothing ran here');
    const { taskHash, inputsHash: inHash } = await f.identity('second');
    const [attempt] = await f.storage.refs.executionListAttempts(f.repo, taskHash, inHash);
    assert.ok((await f.storage.logs.read(f.repo, taskHash, inHash, attempt!.executionId, 'stderr')).size > 0, 'the rack\'s log of it is here');
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
});
