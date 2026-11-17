/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataflow loop's contract for a run that follows its inputs, over a
 * backend: each case replays an interleaving of a run a step at a time, on a
 * runner that holds each task until the case lets it go, so nothing waits on
 * a clock but the one case of a deploy's intent, which the loop asks for once
 * a second.
 *
 * Every result lands; a task whose inputs moved while it ran runs once more;
 * a change travels a step at a time, each task starting in the pass that
 * made it ready; a task that reads several results reads them all as of one
 * commit of each record, a catch-up run making what the execution cache does
 * not hold there, once for every task that reads it; a start that finds a
 * run in flight wakes it; a deploy that announces itself stops it; and a run
 * resumed by another orchestrator decides each task again.
 */

import { it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DictType, East, IntegerType, StringType, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { PackageObjectType, RecordCommitType } from '@elaraai/e3-types';
import type { CatchUpPhase } from '../dataflow.js';
import type { OrchestratorStartOptions } from '../dataflow/orchestrator/interfaces.js';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
import type { DeferReason } from '../dataflow/types.js';
import { acquireForDeploy, deployIntentLock } from '../deploy-lock.js';
import { DataflowAbortedError, WorkspaceLockError } from '../errors.js';
import { GatedTaskRunner } from '../execution/GatedTaskRunner.js';
import { LocalOrchestrator } from '../execution/local-orchestrator.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { inputsHash } from '../executions.js';
import { packageImport } from '../package-files.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { datasetWrite, workspaceSetDataset } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCreate, workspaceGetPackage } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import type { BackendContext, BackendSetup } from './setup.js';

/** A directory for a test's own files, removed when the test ends. */
function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The store a case's runs keep their state in: the one the backend's setup
 *  gives, or one in memory. */
function stateStoreOf(context: BackendContext): ExecutionStateStore {
  return context.stateStore ?? new InMemoryStateStore();
}

/** A task's output over its inputs, as the cases' runner names it: the
 *  workspace's value then says which run made it. */
const made = (task: string, ...inputs: string[]): string => `${task}<${inputs.join('+')}>`;

/**
 * A runner that holds every task of a package until its case lets it go, and
 * then answers an output named by the task and the inputs it ran on
 * ({@link made}), recording the success in the execution cache as a runner
 * does.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param tasks - Each task's hash, by name
 * @returns The runner
 */
function gatedRunner(storage: StorageBackend, repo: string, tasks: ReadonlyMap<string, string>): GatedTaskRunner {
  const mock = new MockTaskRunner();
  for (const [name, taskHash] of tasks) {
    mock.setResult(taskHash, async (inputs) => {
      const executionId = uuidv7();
      const outputHash = made(name, ...inputs);
      await storage.refs.executionWrite(repo, taskHash, inputsHash(inputs), executionId, variant('success', {
        executionId, inputHashes: inputs, outputHash, startedAt: new Date(), completedAt: new Date(),
        peakBytes: none, plan: none, unit: false,
      }));
      return { state: 'success', cached: false, outputHash, executionId };
    });
  }
  return new GatedTaskRunner(mock, tasks.keys());
}

/**
 * What a run tells its caller, as lines a command prints them, and a wait for
 * one of them.
 */
class RunLines {
  readonly lines: string[] = [];
  private waiting: Array<() => void> = [];

  private say(line: string): void {
    this.lines.push(line);
    for (const tell of this.waiting.splice(0)) tell();
  }

  /** The callbacks a run's start takes. */
  readonly callbacks: Pick<OrchestratorStartOptions, 'onTaskStart' | 'onTaskComplete' | 'onCatchUp' | 'onTaskDeferred' | 'onTaskInvalidated'> = {
    onTaskStart: (name) => this.say(`[START] ${name}`),
    onTaskComplete: (result) => this.say(result.state === 'success'
      ? `[${result.cached ? 'CACHED' : 'DONE'}] ${result.name}`
      : `[${result.state.toUpperCase()}] ${result.name}`),
    onCatchUp: (task: string, forTask: string, phase: CatchUpPhase) =>
      this.say(phase.state === 'started' ? `[CATCH-UP] ${task} for ${forTask}` : `[DONE] ${task} for ${forTask}`),
    onTaskDeferred: (name: string, reason: DeferReason) => this.say(`[DEFER] ${name}: ${reason.input} through ${reason.through.join(', ')}`),
    onTaskInvalidated: (name, reason) => this.say(`[DUE] ${name}: ${reason}`),
  };

  /** Resolves once the line has been said `times` times. */
  async said(line: string, times = 1): Promise<void> {
    while (this.lines.filter((each) => each === line).length < times) {
      await new Promise<void>((resolve) => { this.waiting.push(resolve); });
    }
  }

  /** The lines but those saying why a task is due, which a command does not print. */
  get printed(): string[] {
    return this.lines.filter((line) => !line.startsWith('[DUE]'));
  }
}

/** The tree path of input `name`. */
const inputPath = (name: string) => [variant('field', 'inputs'), variant('field', name)];

/** The hash a workspace's dataset holds. */
async function held(storage: StorageBackend, repo: string, path: string): Promise<string | null> {
  const ref = await storage.datasets.read(repo, 'ws', path);
  return ref?.type === 'value' ? ref.value.hash : null;
}

/** Each task's hash in the package deployed to `ws`, by name. */
async function deployedTasks(storage: StorageBackend, repo: string): Promise<Map<string, string>> {
  const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'ws')).hash));
  return new Map(deployed.tasks);
}

/**
 * Deploys a chain of three tasks over one input to workspace `ws`: `clean`
 * over `sales`, `forecast` over what `clean` writes, and `report` over what
 * `forecast` writes.
 */
async function deployChain(t: TestContext, { storage, repo }: BackendContext): Promise<Map<string, string>> {
  const sales = e3.input('sales', IntegerType, variant('value', 1n));
  const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
  const clean = e3.task('clean', [sales], add);
  const forecast = e3.task('forecast', [clean.output], add);
  const report = e3.task('report', [forecast.output], add);
  const zip = join(scratch(t), 'chain.zip');
  await e3.export(e3.package('chain', '1.0.0', sales, clean, forecast, report), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'ws');
  await workspaceDeploy(storage, repo, 'ws', 'chain', '1.0.0');
  return deployedTasks(storage, repo);
}

/**
 * Deploys a task of its own input beside a chain of two over another, to
 * workspace `ws`: `slow` over `a`, `quick` over `b`, and `after` over what
 * `quick` writes.
 */
async function deployBeside(t: TestContext, { storage, repo }: BackendContext): Promise<Map<string, string>> {
  const a = e3.input('a', IntegerType, variant('value', 1n));
  const b = e3.input('b', IntegerType, variant('value', 2n));
  const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
  const slow = e3.task('slow', [a], add);
  const quick = e3.task('quick', [b], add);
  const after = e3.task('after', [quick.output], add);
  const zip = join(scratch(t), 'beside.zip');
  await e3.export(e3.package('beside', '1.0.0', a, b, slow, quick, after), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'ws');
  await workspaceDeploy(storage, repo, 'ws', 'beside', '1.0.0');
  return deployedTasks(storage, repo);
}

const OrdersType = DictType(StringType, IntegerType);

/**
 * Deploys two tasks over a record and a plain input, and one over both their
 * results, to workspace `ws`: `forecast` and `capacity` each read the record
 * `orders` and the input `rates`, and `plan` reads what both write.
 *
 * @param readers - `2` for a second task over both results, `budget`
 */
async function deployCombined(t: TestContext, { storage, repo }: BackendContext, readers: 1 | 2 = 1): Promise<Map<string, string>> {
  const orders = e3.record('orders', OrdersType, { initial: new Map() });
  const rates = e3.input('rates', IntegerType, variant('value', 1n));
  const size = East.function([OrdersType, IntegerType], IntegerType, ($, rows, rate) => rows.size().multiply(rate));
  const sum = East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b));
  const forecast = e3.task('forecast', [orders, rates], size);
  const capacity = e3.task('capacity', [orders, rates], size);
  const plan = e3.task('plan', [forecast.output, capacity.output], sum);
  const both = readers === 2 ? [plan, e3.task('budget', [forecast.output, capacity.output], sum)] : [plan];
  const zip = join(scratch(t), 'combined.zip');
  await e3.export(e3.package('combined', '1.0.0', orders, rates, forecast, capacity, ...both), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'ws');
  await workspaceDeploy(storage, repo, 'ws', 'combined', '1.0.0');
  return deployedTasks(storage, repo);
}

/**
 * Deploys a task over a record, and one over the record and that task's
 * result, beside a task of its own input, to workspace `ws`: `clean` reads
 * the record `orders`, `check` reads `orders` and what `clean` writes, and
 * `slow` reads the input `rates`.
 */
async function deployChecked(t: TestContext, { storage, repo }: BackendContext): Promise<Map<string, string>> {
  const orders = e3.record('orders', OrdersType, { initial: new Map() });
  const rates = e3.input('rates', IntegerType, variant('value', 1n));
  const clean = e3.task('clean', [orders], East.function([OrdersType], IntegerType, ($, rows) => rows.size()));
  const check = e3.task('check', [orders, clean.output], East.function([OrdersType, IntegerType], IntegerType, ($, rows, cleaned) => rows.size().add(cleaned)));
  const slow = e3.task('slow', [rates], East.function([IntegerType], IntegerType, ($, rate) => rate.add(1n)));
  const zip = join(scratch(t), 'checked.zip');
  await e3.export(e3.package('checked', '1.0.0', orders, rates, clean, check, slow), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'ws');
  await workspaceDeploy(storage, repo, 'ws', 'checked', '1.0.0');
  return deployedTasks(storage, repo);
}

/**
 * Deploys two tasks over a record, and one over both their results, to
 * workspace `ws`: `left` and `right` each read the record `orders`, and
 * `both` reads what the two write. The run takes `both` before `left` where
 * both are ready, by name.
 */
async function deployTwoSided(t: TestContext, { storage, repo }: BackendContext): Promise<Map<string, string>> {
  const orders = e3.record('orders', OrdersType, { initial: new Map() });
  const size = East.function([OrdersType], IntegerType, ($, rows) => rows.size());
  const left = e3.task('left', [orders], size);
  const right = e3.task('right', [orders], size);
  const both = e3.task('both', [left.output, right.output], East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b)));
  const zip = join(scratch(t), 'two-sided.zip');
  await e3.export(e3.package('two-sided', '1.0.0', orders, left, right, both), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'ws');
  await workspaceDeploy(storage, repo, 'ws', 'two-sided', '1.0.0');
  return deployedTasks(storage, repo);
}

/**
 * An object that answers as `target` does, but for the members given: a
 * storage with one of its parts stood in for. Every other member is the
 * target's own, a method bound to it.
 */
function standIn<T extends object>(target: T, members: Partial<Record<keyof T, unknown>>): T {
  return new Proxy(target, {
    get: (of, name) => {
      if (Object.hasOwn(members, name)) return (members as Record<string | symbol, unknown>)[name];
      const member: unknown = Reflect.get(of, name);
      return typeof member === 'function' ? (member as (...args: unknown[]) => unknown).bind(of) : member;
    },
  });
}

/** A call a case holds back: `reached` settles once the call has its answer
 *  in hand, which its caller is handed only when the case opens it. */
interface HeldCall {
  readonly reached: Promise<void>;
  open(): void;
}

/**
 * A storage a case paces: each call of its `refs` and `datasets` goes to the
 * backend's own at once, and the answer of one the case holds
 * ({@link PacedStorage.hold}) is kept back until the case opens it. So a case
 * places a read or a write of the run's between two steps of its own, where
 * nothing else orders them.
 */
interface PacedStorage {
  readonly storage: StorageBackend;
  /** Holds the next call of `part`'s `method` whose arguments `when` accepts. */
  hold(part: 'refs' | 'datasets', method: string, when: (args: readonly unknown[]) => boolean): HeldCall;
}

function pacedStorage(storage: StorageBackend): PacedStorage {
  const holds: Array<{ part: string; method: string; when: (args: readonly unknown[]) => boolean; reached: () => void; opened: Promise<void>; taken: boolean }> = [];
  const paced = <P extends object>(part: 'refs' | 'datasets', target: P): P => new Proxy(target, {
    get: (of, name) => {
      const member: unknown = Reflect.get(of, name);
      if (typeof member !== 'function') return member;
      const call = (member as (...args: unknown[]) => unknown).bind(of);
      if (!holds.some((each) => !each.taken && each.part === part && each.method === name)) return call;
      return async (...args: unknown[]): Promise<unknown> => {
        const answer = await call(...args);
        const held = holds.find((each) => !each.taken && each.part === part && each.method === name && each.when(args));
        if (held === undefined) return answer;
        held.taken = true;
        held.reached();
        await held.opened;
        return answer;
      };
    },
  });
  return {
    storage: standIn(storage, { refs: paced('refs', storage.refs), datasets: paced('datasets', storage.datasets) }),
    hold(part, method, when) {
      let reached!: () => void;
      let open!: () => void;
      const reaching = new Promise<void>((resolve) => { reached = resolve; });
      const opened = new Promise<void>((resolve) => { open = resolve; });
      holds.push({ part, method, when, reached, opened, taken: false });
      return { reached: reaching, open };
    },
  };
}

/** The record `orders` as its ref stands: its head commit and its state. */
async function ordersHead(storage: StorageBackend, repo: string): Promise<{ commit: string; state: string }> {
  const ref = await storage.datasets.read(repo, 'ws', 'records/orders');
  assert.ok(ref?.type === 'value', 'the record holds a state');
  return { commit: ref.value.versions.get('.records.orders')!, state: ref.value.hash };
}

/**
 * Commits an edit of the record `orders`, as a mutation's commit leaves the
 * store: a new state, a commit that names it and its parent, and the record's
 * ref naming both.
 *
 * @returns The commit and its state
 */
async function commitOrders(storage: StorageBackend, repo: string, rows: ReadonlyArray<[string, bigint]>): Promise<{ commit: string; state: string }> {
  const head = await ordersHead(storage, repo);
  const state = await datasetWrite(storage, repo, new Map(rows), OrdersType);
  const commit = await storage.objects.write(repo, encodeBeast2For(RecordCommitType)({
    parent: some(head.commit), state, mutation: 'edit', args: none, actor: 'test', at: new Date(), delta: none,
  }));
  await storage.datasets.write(repo, 'ws', 'records/orders', variant('value', { hash: state, versions: new Map([['.records.orders', commit]]) }));
  return { commit, state };
}

/**
 * Registers the cases of a run that follows its inputs, in the suite its
 * caller describes ({@link dataflowTests}).
 *
 * @param setup - Makes a fresh backend and a repository in it for each test,
 *   and the store the runs keep their state in, when the backend gives one
 */
export function dataflowFollowCases(setup: BackendSetup): void {
  it('lands every result, runs a task once more when its inputs moved while it ran, and lets a change travel a step at a time', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const v1 = (await held(storage, repo, 'inputs/sales'))!;
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });

    // clean runs on the input as the run found it; forecast starts on its result
    assert.deepEqual((await runner.launched('clean')).inputHashes, [v1]);
    runner.release('clean');
    assert.deepEqual((await runner.launched('forecast')).inputHashes, [made('clean', v1)]);

    // An edit lands while forecast runs, and its writer's start wakes the
    // run: clean is idle, so it starts on the edit at once
    await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), 5n, IntegerType);
    const v2 = (await held(storage, repo, 'inputs/sales'))!;
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), true, 'the run took the wake');
    assert.deepEqual((await runner.launched('clean')).inputHashes, [v2]);

    // clean's next result lands while forecast still runs on the one before:
    // forecast is not stopped, and report, which has no result yet, waits
    runner.release('clean');
    await lines.said('[DONE] clean', 2);
    assert.equal(await held(storage, repo, 'tasks/clean/output'), made('clean', v2));
    assert.deepEqual([runner.holding('forecast'), runner.holding('report')], [1, 0]);

    // forecast's result lands, made from the input as it was: its output is
    // written, report runs on it, and forecast runs once more on clean's next
    runner.release('forecast');
    assert.deepEqual((await runner.launched('forecast')).inputHashes, [made('clean', v2)]);
    assert.deepEqual((await runner.launched('report')).inputHashes, [made('forecast', made('clean', v1))]);
    assert.equal(await held(storage, repo, 'tasks/forecast/output'), made('forecast', made('clean', v1)), 'the result landed, though its input had moved');

    runner.release('report');
    await lines.said('[DONE] report');
    assert.equal(runner.holding('report'), 0, 'report is not due until forecast\'s next result lands');

    // forecast's next result lands: report is due, and runs on it
    runner.release('forecast');
    assert.deepEqual((await runner.launched('report')).inputHashes, [made('forecast', made('clean', v2))]);
    runner.release('report');

    // No task is due, ready or in flight: the run ends
    const result = await orchestrator.wait(handle);
    assert.equal(result.success, true);
    assert.deepEqual([result.executed, result.cached, result.reexecuted], [3, 0, 3], 'each task counted once, each run once more');
    assert.deepEqual(lines.printed, [
      '[START] clean',
      '[DONE] clean',
      '[START] forecast',
      '[START] clean',
      '[DONE] clean',
      '[DONE] forecast',
      '[START] forecast',
      '[START] report',
      '[DONE] report',
      '[DONE] forecast',
      '[START] report',
      '[DONE] report',
    ]);
    assert.equal(await held(storage, repo, 'tasks/report/output'), made('report', made('forecast', made('clean', v2))));
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), false, 'a run that has ended takes no wake');
  });

  it('takes in an edit no start follows as its next task lands, and wakes no run started with a filter', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), false, 'no run is in flight');

    const filtered = await orchestrator.start(storage, repo, 'ws', { runner, filter: 'forecast' });
    await runner.launched('clean');
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), false, 'a filtered run leaves the edit\'s other readers out');
    runner.release('clean');
    await runner.launched('forecast');
    runner.release('forecast');
    await orchestrator.wait(filtered);

    const v1 = (await held(storage, repo, 'inputs/sales'))!;
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, force: true });
    await runner.launched('clean');
    runner.release('clean');
    await runner.launched('forecast');
    // The edit is written with no start after it: nothing looks until forecast lands
    await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), 7n, IntegerType);
    const v2 = (await held(storage, repo, 'inputs/sales'))!;
    assert.equal(runner.holding('clean'), 0);
    runner.release('forecast');
    assert.deepEqual((await runner.launched('clean')).inputHashes, [v2], 'found as forecast landed');
    assert.notEqual(v1, v2);

    // Let the rest of the run through: clean, and report, which runs on the
    // result of forecast that landed
    await runner.launched('report');
    for (const name of tasks.keys()) runner.pass(name);
    runner.release('clean');
    runner.release('report');
    assert.equal((await orchestrator.wait(handle)).success, true);
    assert.equal(await held(storage, repo, 'tasks/report/output'), made('report', made('forecast', made('clean', v2))));
  });

  it('runs a task that reads two results as of the commit its older input came from: the other read there from the cache, or made there by a catch-up run', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployCombined(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const rates = (await held(storage, repo, 'inputs/rates'))!;
    const c0 = await ordersHead(storage, repo);
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    const edit = async (rows: ReadonlyArray<[string, bigint]>): Promise<{ commit: string; state: string }> => {
      const commit = await commitOrders(storage, repo, rows);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), true);
      return commit;
    };

    // Both start on the record as the run found it
    assert.deepEqual((await runner.launched('forecast')).inputHashes, [c0.state, rates]);
    assert.deepEqual((await runner.launched('capacity')).inputHashes, [c0.state, rates]);

    // People edit: capacity, the faster, lands and runs again on each edit,
    // while forecast still runs on the commit it started on
    const c1 = await edit([['a', 1n]]);
    runner.release('capacity');
    assert.deepEqual((await runner.launched('capacity')).inputHashes, [c1.state, rates]);
    const c2 = await edit([['a', 1n], ['b', 2n]]);

    // forecast lands, made from c0, and starts again on c2. plan reads it,
    // and capacity as of c0 too: capacity's result at c0 is the one it holds
    runner.release('forecast');
    assert.deepEqual((await runner.launched('forecast')).inputHashes, [c2.state, rates]);
    assert.deepEqual((await runner.launched('plan')).inputHashes, [made('forecast', c0.state, rates), made('capacity', c0.state, rates)]);
    runner.release('plan');
    await lines.said('[DONE] plan');

    // capacity moves past c2 without ever running on it: it lands c1, and
    // starts on c3
    const c3 = await edit([['a', 1n], ['b', 2n], ['c', 3n]]);
    runner.release('capacity');
    assert.deepEqual((await runner.launched('capacity')).inputHashes, [c3.state, rates]);
    assert.equal(runner.holding('plan'), 0, 'plan would still read both as of c0: it is not due');
    runner.release('capacity');
    await lines.said('[DONE] capacity', 3);

    // forecast lands, made from c2. plan runs as of c2, the older of its
    // inputs' commits: capacity never ran there, so it runs there once
    runner.release('forecast');
    assert.deepEqual((await runner.launched('forecast')).inputHashes, [c3.state, rates], 'forecast runs once more, on the newest');
    assert.deepEqual((await runner.launched('capacity')).inputHashes, [c2.state, rates], 'the catch-up run reads the record at c2, from its history');
    await lines.said('[CATCH-UP] capacity for plan');
    assert.equal(runner.holding('plan'), 0, 'plan waits for the catch-up run');
    runner.release('capacity');
    assert.deepEqual((await runner.launched('plan')).inputHashes, [made('forecast', c2.state, rates), made('capacity', c2.state, rates)]);
    assert.equal(await held(storage, repo, 'tasks/capacity/output'), made('capacity', c3.state, rates), 'the catch-up run wrote nothing to the workspace');

    // The rest of the run: forecast's c3 result lands, and plan runs as of
    // c3, where both its inputs now stand
    runner.release('plan');
    await lines.said('[DONE] plan', 2);
    runner.release('forecast');
    assert.deepEqual((await runner.launched('plan')).inputHashes, [made('forecast', c3.state, rates), made('capacity', c3.state, rates)]);
    runner.release('plan');

    const result = await orchestrator.wait(handle);
    assert.equal(result.success, true);
    assert.equal(result.executed, 3, 'the counts are per task, and count no catch-up run');
    assert.deepEqual(lines.printed.filter((line) => line.includes('for plan')), ['[CATCH-UP] capacity for plan', '[DONE] capacity for plan']);
    assert.equal(lines.lines.some((line) => line.startsWith('[DEFER]')), false, 'no task waited for its inputs to agree');
    const run = await storage.refs.dataflowRunGet(repo, 'ws', result.runId);
    assert.deepEqual([...run!.taskExecutions.get('plan')!.outputVersions].sort(), [['.inputs.rates', rates], ['.records.orders', c3.commit]],
      'the run records the versions plan\'s result was made from');
  });

  it('makes a result two tasks read at one commit with one catch-up run: the second waits for the run in flight, and nothing runs twice', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployCombined(t, context, 2);
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const rates = (await held(storage, repo, 'inputs/rates'))!;
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    const edit = async (rows: ReadonlyArray<[string, bigint]>): Promise<{ commit: string; state: string }> => {
      const commit = await commitOrders(storage, repo, rows);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), true);
      return commit;
    };
    // The readers, in the order the run takes its ready tasks
    const readers = ['budget', 'plan'];
    const landBoth = async (times: number): Promise<void> => {
      for (const reader of readers) {
        runner.release(reader);
        await lines.said(`[DONE] ${reader}`, times);
      }
    };

    // forecast's result moves to c1 while capacity's goes from c0 to c2, and
    // both readers have run on c0
    await runner.launched('forecast');
    await runner.launched('capacity');
    const c1 = await edit([['a', 1n]]);
    runner.release('forecast');
    await runner.launched('forecast');
    await edit([['a', 1n], ['b', 2n]]);
    runner.release('capacity');
    await runner.launched('capacity');
    for (const reader of readers) await runner.launched(reader);
    await landBoth(1);
    runner.release('forecast');
    await runner.launched('forecast');
    runner.release('capacity');

    // Each reader reads both as of c1, where capacity never ran: one
    // catch-up run makes it, for the first to ask, and the other waits for it
    assert.deepEqual((await runner.launched('capacity')).inputHashes, [c1.state, rates]);
    await lines.said('[CATCH-UP] capacity for budget');
    assert.deepEqual([runner.holding('capacity'), runner.holding('plan'), runner.holding('budget')], [1, 0, 0]);
    runner.release('capacity');
    const read = [made('forecast', c1.state, rates), made('capacity', c1.state, rates)];
    for (const reader of readers) assert.deepEqual((await runner.launched(reader)).inputHashes, read, reader);
    assert.equal(runner.holding('capacity'), 0, 'no second catch-up run was launched');
    assert.equal((await storage.refs.executionListIds(repo, tasks.get('capacity')!, inputsHash([c1.state, rates]))).length, 1,
      'capacity ran once at c1');
    assert.deepEqual(lines.printed.filter((line) => line.startsWith('[CATCH-UP]')), ['[CATCH-UP] capacity for budget']);

    // The rest of the run: forecast lands on c2, where capacity stands
    await landBoth(2);
    runner.release('forecast');
    for (const reader of readers) await runner.launched(reader);
    await landBoth(3);
    assert.equal((await orchestrator.wait(handle)).success, true);
  });

  it('starts a task in the pass that made it ready: what reads a result the cache answered starts while another task runs', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployBeside(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    // A run of quick alone records its execution: the cache answers it next
    const filtered = await orchestrator.start(storage, repo, 'ws', { runner, filter: 'quick' });
    await runner.launched('quick');
    runner.release('quick');
    assert.equal((await orchestrator.wait(filtered)).executed, 1);

    const lines = new RunLines();
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    await runner.launched('slow');
    // quick is answered by the cache, and after starts on it at once: it does
    // not wait for slow, the one task in flight, to land
    await runner.launched('after');
    assert.deepEqual([runner.holding('slow'), runner.holding('quick')], [1, 0]);
    assert.deepEqual(lines.printed, ['[CACHED] quick', '[START] slow', '[START] after']);
    runner.release('after');
    await lines.said('[DONE] after');
    runner.release('slow');
    const result = await orchestrator.wait(handle);
    assert.deepEqual([result.success, result.executed, result.cached], [true, 2, 1]);
  });

  it('fails a task whose catch-up run failed, naming the run\'s task and the commit', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployCombined(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const stateStore = stateStoreOf(context);
    const orchestrator = new LocalOrchestrator(stateStore);
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    const edit = async (rows: ReadonlyArray<[string, bigint]>): Promise<{ commit: string; state: string }> => {
      const commit = await commitOrders(storage, repo, rows);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), true);
      return commit;
    };

    // forecast's result is of c1, and capacity's of c0 and then c2: plan
    // reads both as of c1, where capacity never ran
    await runner.launched('forecast');
    await runner.launched('capacity');
    const c1 = await edit([['a', 1n]]);
    runner.release('forecast');
    await runner.launched('forecast');
    await edit([['a', 1n], ['b', 2n]]);
    runner.release('capacity');
    await runner.launched('capacity');
    await runner.launched('plan');
    runner.release('plan');
    await lines.said('[DONE] plan');
    runner.release('capacity');
    await lines.said('[DONE] capacity', 2);
    runner.release('forecast');
    await lines.said('[CATCH-UP] capacity for plan');
    await runner.launched('forecast');
    await runner.launched('capacity');
    runner.fail('capacity', 'the capacity model did not converge');

    await lines.said('[ERROR] plan');
    runner.release('forecast');
    const result = await orchestrator.wait(handle);
    assert.equal(result.success, false);
    const ended = await stateStore.read(repo, 'ws', handle.id);
    assert.deepEqual(ended?.tasks.get('plan')?.error, some(
      `the catch-up run of 'capacity' at .records.orders ${c1.commit.slice(0, 8)}, .inputs.rates ${(await held(storage, repo, 'inputs/rates'))!.slice(0, 8)} ` +
      'failed: the capacity model did not converge'));
    assert.equal(ended?.tasks.get('capacity')?.status, 'completed', 'capacity itself did not fail');
  });

  it('defers a task whose inputs read a plain input at two values until they agree, saying so once', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployCombined(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const stateStore = stateStoreOf(context);
    const orchestrator = new LocalOrchestrator(stateStore);
    const orders = await ordersHead(storage, repo);
    const r1 = (await held(storage, repo, 'inputs/rates'))!;
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });

    await runner.launched('forecast');
    await runner.launched('capacity');
    runner.release('capacity');
    await lines.said('[DONE] capacity');

    // Someone sets the input while forecast runs: capacity runs on the new
    // value first, and lands
    await workspaceSetDataset(storage, repo, 'ws', inputPath('rates'), 2n, IntegerType);
    const r2 = (await held(storage, repo, 'inputs/rates'))!;
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), true);
    assert.deepEqual((await runner.launched('capacity')).inputHashes, [orders.state, r2]);
    runner.release('capacity');
    await lines.said('[DONE] capacity', 2);

    // forecast lands, made from the old value: plan's inputs read the input
    // at two values, and a plain input keeps no earlier one to read
    runner.release('forecast');
    assert.deepEqual((await runner.launched('forecast')).inputHashes, [orders.state, r2]);
    await lines.said('[DEFER] plan: .inputs.rates through forecast, capacity');
    assert.equal(runner.holding('plan'), 0);

    // forecast lands on the new value: they agree, and plan runs
    runner.release('forecast');
    assert.deepEqual((await runner.launched('plan')).inputHashes, [made('forecast', orders.state, r2), made('capacity', orders.state, r2)]);
    runner.release('plan');
    assert.equal((await orchestrator.wait(handle)).success, true);
    assert.equal(lines.lines.filter((line) => line.startsWith('[DEFER]')).length, 1, 'told once');
    assert.notEqual(r1, r2);
    const events = await stateStore.getEventsSince(repo, 'ws', handle.id, 0);
    assert.equal(events.filter((event) => event.type === 'task_deferred').length, 1, 'and recorded once');
  });

  it('stops a run within about a second of a deploy announcing itself: its results stand, it says why, and the deploy takes the workspace', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const stateStore = stateStoreOf(context);
    const orchestrator = new LocalOrchestrator(stateStore);
    const v1 = (await held(storage, repo, 'inputs/sales'))!;
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    // The wait is taken while the run is in flight, and its rejection is the
    // case's to assert
    const waited = orchestrator.wait(handle);
    waited.catch(() => undefined);
    await runner.launched('clean');
    runner.release('clean');
    await runner.launched('forecast');

    // The deploy takes the workspace only once the run has let it go: a run
    // that never stopped would refuse it once the deploy's own wait was over
    const deploy = await acquireForDeploy(storage, repo, 'ws');
    try {
      await assert.rejects(waited, (err: unknown) => {
        assert.ok(err instanceof DataflowAbortedError, `a DataflowAbortedError, not ${String(err)}`);
        assert.equal(err.reason, 'a deploy of ws started');
        assert.deepEqual(err.partialResults?.map((each) => [each.name, each.state]), [['clean', 'success']], 'the tasks with a result in the run');
        return true;
      });
      assert.deepEqual(lines.printed, ['[START] clean', '[DONE] clean', '[START] forecast', '[CANCELLED] forecast']);
      assert.equal(await held(storage, repo, 'tasks/clean/output'), made('clean', v1), 'the result it landed stands');

      const ended = await stateStore.read(repo, 'ws', handle.id);
      assert.equal(ended?.status, 'cancelled');
      assert.deepEqual(ended?.error, some('a deploy of ws started'));
      const events = await stateStore.getEventsSince(repo, 'ws', handle.id, 0);
      const cancelled = events.find((event) => event.type === 'execution_cancelled');
      assert.ok(cancelled?.type === 'execution_cancelled');
      assert.deepEqual(cancelled.value.reason, some('a deploy of ws started'));
      assert.equal((await storage.refs.dataflowRunGetLatest(repo, 'ws'))?.status.type, 'cancelled');

      // While the deploy holds the workspace, nothing starts
      await assert.rejects(orchestrator.start(storage, repo, 'ws', { runner }), WorkspaceLockError);
    } finally {
      await deploy.release();
    }

    // The next run finds what the stopped one landed
    for (const name of tasks.keys()) runner.pass(name);
    const next = await orchestrator.wait(await orchestrator.start(storage, repo, 'ws', { runner }));
    assert.equal(next.success, true);
    assert.equal(next.cached, 1, 'clean is answered by the execution the stopped run recorded');
  });

  it('keeps every result of a run that yields with a task due again, and decides each task again once another orchestrator resumes it', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const stateStore = stateStoreOf(context);
    const first = new LocalOrchestrator(stateStore);
    const v1 = (await held(storage, repo, 'inputs/sales'))!;
    let yielding = false;
    const handle = await first.start(storage, repo, 'ws', { runner, shouldYield: () => yielding });

    // clean landed on v1 and runs again on an edit, forecast runs on its v1
    // result: the run yields with both in flight
    await runner.launched('clean');
    runner.release('clean');
    await runner.launched('forecast');
    await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), 9n, IntegerType);
    const v2 = (await held(storage, repo, 'inputs/sales'))!;
    yielding = true;
    assert.equal(await first.wake(storage, repo, 'ws'), true);
    assert.equal((await first.wait(handle)).yielded, true);

    const yielded = await stateStore.read(repo, 'ws', handle.id);
    assert.equal(yielded?.status, 'running');
    assert.deepEqual([yielded?.tasks.get('clean')?.status, yielded?.tasks.get('clean')?.outputHash], ['pending', some(made('clean', v1))],
      'clean is due again, and keeps the result it landed');
    assert.equal(await held(storage, repo, 'tasks/clean/output'), made('clean', v1));

    // Another orchestrator, as another process is, takes the run up: the
    // tasks the first left in flight are decided again
    const second = new LocalOrchestrator(stateStore);
    const resumed = await second.resume(storage, repo, 'ws', handle.id, { runner });
    for (const name of tasks.keys()) runner.pass(name);
    for (const name of ['clean', 'forecast', 'report']) while (runner.holding(name) > 0) runner.release(name);
    const result = await second.wait(resumed);
    assert.equal(result.success, true);
    assert.equal(await held(storage, repo, 'tasks/clean/output'), made('clean', v2));
    assert.equal(await held(storage, repo, 'tasks/report/output'), made('report', made('forecast', made('clean', v2))));
    const run = await storage.refs.dataflowRunGet(repo, 'ws', result.runId);
    assert.deepEqual([...run!.taskExecutions.keys()].sort(), ['clean', 'forecast', 'report'], 'the run\'s record covers both incarnations');
  });

  it('asks a change\'s readers again once the look that found it has failed: a wake that failed loses no edit', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChecked(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const c0 = await ordersHead(storage, repo);
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });

    // clean and check land on the record as the run found it, and slow keeps
    // the run in flight
    await runner.launched('slow');
    assert.deepEqual((await runner.launched('clean')).inputHashes, [c0.state]);
    runner.release('clean');
    assert.deepEqual((await runner.launched('check')).inputHashes, [c0.state, made('clean', c0.state)]);
    runner.release('check');
    await lines.said('[DONE] check');

    // An edit commits, and the look its writer's start asks for fails once it
    // has found the edit: check reads the record and a result made from it, so
    // asking whether it is due reads the store, which is down
    const c1 = await commitOrders(storage, repo, [['a', 1n]]);
    const down = standIn(storage, {
      refs: standIn(storage.refs, { workspaceRead: () => Promise.reject(new Error('the store went away')) }),
    });
    assert.equal(await orchestrator.wake(down, repo, 'ws'), false, 'a look that failed hands nothing over');

    // The run asks again by itself, with no second wake: both run on the edit
    assert.deepEqual((await runner.launched('clean')).inputHashes, [c1.state]);
    runner.release('clean');
    assert.deepEqual((await runner.launched('check')).inputHashes, [c1.state, made('clean', c1.state)]);
    runner.release('check');
    runner.release('slow');
    assert.equal((await orchestrator.wait(handle)).success, true);
    assert.equal(await held(storage, repo, 'tasks/check/output'), made('check', c1.state, made('clean', c1.state)));
  });

  it('takes no wake once a deploy has announced itself: a start is refused, naming the deploy, and the run stops', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const handle = await orchestrator.start(storage, repo, 'ws', { runner });
    const waited = orchestrator.wait(handle);
    waited.catch(() => undefined);
    await runner.launched('clean');
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), true, 'the run in flight takes a wake');

    // A deploy announces itself, and waits for the run to let the workspace go
    const intent = await storage.locks.acquire(repo, deployIntentLock('ws'), variant('deployment', null));
    assert.ok(intent !== null);
    try {
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), false, 'the run takes nothing in for a deploy that waits');
      await assert.rejects(orchestrator.start(storage, repo, 'ws', { runner }), (err: unknown) => {
        assert.ok(err instanceof WorkspaceLockError, `a WorkspaceLockError, not ${String(err)}`);
        assert.match(err.message, /^Workspace 'ws' is locked by a deploy/);
        return true;
      });
      await assert.rejects(waited, (err: unknown) => err instanceof DataflowAbortedError && err.reason === 'a deploy of ws started');
    } finally {
      await intent.release();
    }
  });

  it('launches no catch-up run for a result that lands while a task that reads it is resolved: the task waits for the run in flight', async (t) => {
    const context = await setup(t);
    const { repo } = context;
    const paced = pacedStorage(context.storage);
    const storage = paced.storage;
    const tasks = await deployTwoSided(t, context);
    const runner = gatedRunner(context.storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    const edit = async (rows: ReadonlyArray<[string, bigint]>): Promise<{ commit: string; state: string }> => {
      const commit = await commitOrders(storage, repo, rows);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), true);
      return commit;
    };

    // left's result moves to c1 while right's goes from c0 to c2, and both
    // has run on c0
    await runner.launched('left');
    await runner.launched('right');
    const c1 = await edit([['a', 1n]]);
    runner.release('left');
    assert.deepEqual((await runner.launched('left')).inputHashes, [c1.state]);
    const c2 = await edit([['a', 1n], ['b', 2n]]);
    runner.release('right');
    assert.deepEqual((await runner.launched('right')).inputHashes, [c2.state]);
    await runner.launched('both');
    runner.release('both');
    await lines.said('[DONE] both');
    runner.release('right');
    await lines.said('[DONE] right', 2);

    // An edit puts the record back as it was at c1: right runs on it, over
    // the very inputs both will read it at
    const c3 = await edit([['a', 1n]]);
    assert.equal(c3.state, c1.state);
    assert.deepEqual((await runner.launched('right')).inputHashes, [c1.state]);
    const read = inputsHash([c1.state]);
    const cache = (task: string) => (args: readonly unknown[]): boolean => args[1] === tasks.get(task) && args[2] === read;

    // left lands on c1, and both is resolved as of c1: right's result there
    // is not its last, and the execution cache has none yet
    const asked = paced.hold('refs', 'executionListIds', cache('right'));
    const landing = paced.hold('datasets', 'write', (args) => args[2] === 'tasks/right/output');
    const next = paced.hold('refs', 'executionListIds', cache('left'));
    try {
      runner.release('left');
      await asked.reached;

      // right's run over those inputs ends while both is still resolved, and
      // its result is landing as the cache's answer, none, reaches both
      runner.release('right');
      await landing.reached;
      asked.open();

      // The run has gone on to left, the next task it takes: both waits for
      // right's run, which is still in flight until its result has landed
      await next.reached;
      assert.deepEqual(lines.printed.filter((line) => line.startsWith('[CATCH-UP]')), [], 'no catch-up run was launched for the result that is landing');
    } finally {
      asked.open();
      next.open();
      landing.open();
    }

    assert.deepEqual((await runner.launched('both')).inputHashes, [made('left', c1.state), made('right', c1.state)]);
    assert.equal(runner.holding('right'), 0);
    assert.equal((await context.storage.refs.executionListIds(repo, tasks.get('right')!, read)).length, 1, 'right ran once over those inputs');
    for (const name of tasks.keys()) runner.pass(name);
    runner.release('both');
    assert.equal((await orchestrator.wait(handle)).success, true);
    assert.deepEqual(lines.printed.filter((line) => line.startsWith('[CATCH-UP]')), []);
  });
}
