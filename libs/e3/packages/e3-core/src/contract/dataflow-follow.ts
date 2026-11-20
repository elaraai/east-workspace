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
import { join } from 'node:path';
import { DictType, East, IntegerType, StringType, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { PackageObjectType, RecordCommitType } from '@elaraai/e3-types';
import type { CatchUpPhase } from '../dataflow.js';
import type { OrchestratorStartOptions } from '../dataflow/orchestrator/interfaces.js';
import type { DeferReason } from '../dataflow/types.js';
import { acquireWorkspaceExclusive, workspaceIntentLock } from '../deploy-lock.js';
import { DataflowAbortedError, ObjectNotFoundError, RecordDeployRefusedError, WorkspaceLockError, WorkspaceNotFoundError } from '../errors.js';
import { GatedTaskRunner } from '../execution/GatedTaskRunner.js';
import { LocalOrchestrator } from '../execution/local-orchestrator.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { inputsHash } from '../executions.js';
import { readTestPieceBytesFrom } from '../execution/pieces.js';
import { packageImport } from '../package-files.js';
import type { ExecutionStateStore } from '../dataflow/state-store/interfaces.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { datasetWrite, workspaceSetDataset } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCopy, workspaceCreate, workspaceGetPackage, workspaceGetState, workspaceRemove } from '../workspaces.js';
import { workspaceDeploy, workspaceExport } from '../workspace-files.js';
import type { BackendContext, BackendSetup } from './setup.js';
import { inputPath, scratch, stateStoreOf } from './support.js';

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
    // A unit of a split task makes its part from what it reads, and is
    // recorded as a runner records it: under the task's own identity when it
    // is the task's own execution, and as a unit otherwise
    mock.setUnitResult(taskHash, async (unit) => {
      const executionId = uuidv7();
      const outputHash = made(name, ...unit.inputs);
      await storage.refs.executionWrite(repo, taskHash, inputsHash(unit.inputs), executionId, variant('success', {
        executionId, inputHashes: unit.inputs, outputHash, startedAt: new Date(), completedAt: new Date(),
        peakBytes: none, plan: none, unit: !unit.own,
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
 * @param options - `split`: `capacity` counts the record's rows a piece at a
 *   time, a task whose work is split over the record, run as the units of its
 *   stages. `late`: `budget` reads an input `late` too, which nothing sets
 *   until the case does: it waits until then
 */
async function deployCombined(
  t: TestContext,
  { storage, repo }: BackendContext,
  readers: 1 | 2 = 1,
  options: { split?: boolean; late?: boolean } = {},
): Promise<Map<string, string>> {
  const orders = e3.record('orders', OrdersType, { initial: new Map() });
  const rates = e3.input('rates', IntegerType, variant('value', 1n));
  const size = East.function([OrdersType, IntegerType], IntegerType, ($, rows, rate) => rows.size().multiply(rate));
  const sum = East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b));
  const forecast = e3.task('forecast', [orders, rates], size);
  const capacity = options.split === true
    ? e3.streamTask('capacity', {
      inputs: [e3.partition(orders), rates],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, rows, rate, emit) => {
      $.for(rows, ($) => {
        $(emit(rate));
      });
    })
    : e3.task('capacity', [orders, rates], size);
  const plan = e3.task('plan', [forecast.output, capacity.output], sum);
  const late = e3.input('late', IntegerType);
  const budget = options.late === true
    ? e3.task('budget', [forecast.output, capacity.output, late], East.function([IntegerType, IntegerType, IntegerType], IntegerType, ($, a, b, c) => a.add(b).add(c)))
    : e3.task('budget', [forecast.output, capacity.output], sum);
  const both = readers === 2 ? [plan, budget] : [plan];
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
 *
 * @param options - `probe`: a task `zz` over an input `probe` too, which the
 *   run takes after every other where several are ready, by name: once it is
 *   launched, the run has decided each task due beside it
 */
async function deployTwoSided(t: TestContext, { storage, repo }: BackendContext, options: { probe?: boolean } = {}): Promise<Map<string, string>> {
  const orders = e3.record('orders', OrdersType, { initial: new Map() });
  const size = East.function([OrdersType], IntegerType, ($, rows) => rows.size());
  const left = e3.task('left', [orders], size);
  const right = e3.task('right', [orders], size);
  const both = e3.task('both', [left.output, right.output], East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b)));
  const probe = e3.input('probe', IntegerType, variant('value', 1n));
  const zz = e3.task('zz', [probe], East.function([IntegerType], IntegerType, ($, x) => x.add(1n)));
  const zip = join(scratch(t), 'two-sided.zip');
  await e3.export(e3.package('two-sided', '1.0.0', orders, left, right, both, ...(options.probe === true ? [probe, zz] : [])), zip);
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
 * Brings a run over the combined package ({@link deployCombined}) to where it
 * decides `plan`, whose inputs read the input `rates` at two values:
 * `capacity` has landed on the input's new value and `forecast` on its old
 * one, and `forecast` runs again on the new. Deciding a deferral reads whether
 * `rates` is a record's from the store, and that read's answer is kept back
 * until the case opens `deciding`.
 *
 * @returns The run, what it tells its caller, and what `plan` reads once
 *   `forecast` has landed on the new value
 */
async function decidingPlan(t: TestContext, context: BackendContext): Promise<{
  orchestrator: LocalOrchestrator;
  handle: Awaited<ReturnType<LocalOrchestrator['start']>>;
  runner: GatedTaskRunner;
  lines: RunLines;
  stateStore: ExecutionStateStore;
  deciding: HeldCall;
  agreed: string[];
}> {
  const { repo } = context;
  const paced = pacedStorage(context.storage);
  const storage = paced.storage;
  const tasks = await deployCombined(t, context);
  const runner = gatedRunner(context.storage, repo, tasks);
  const lines = new RunLines();
  const stateStore = stateStoreOf(context);
  const orchestrator = new LocalOrchestrator(stateStore);
  const orders = await ordersHead(storage, repo);
  const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });

  await runner.launched('forecast');
  await runner.launched('capacity');
  runner.release('capacity');
  await lines.said('[DONE] capacity');
  await workspaceSetDataset(storage, repo, 'ws', inputPath('rates'), 2n, IntegerType);
  const r2 = (await held(storage, repo, 'inputs/rates'))!;
  assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
  await runner.launched('capacity');
  runner.release('capacity');
  await lines.said('[DONE] capacity', 2);

  // forecast lands, made from the old value, and runs again: plan is decided
  const deciding = paced.hold('refs', 'workspaceRead', () => true);
  runner.release('forecast');
  await runner.launched('forecast');
  await deciding.reached;
  return { orchestrator, handle, runner, lines, stateStore, deciding, agreed: [made('forecast', orders.state, r2), made('capacity', orders.state, r2)] };
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
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id, 'the run took the wake');
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
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), null, 'a run that has ended takes no wake');
  });

  it('takes in an edit no start follows as its next task lands, and wakes no run started with a filter', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), null, 'no run is in flight');

    const filtered = await orchestrator.start(storage, repo, 'ws', { runner, filter: 'forecast' });
    await runner.launched('clean');
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), null, 'a filtered run leaves the edit\'s other readers out');
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

  it('serves a task due again from the cache where it ran before, though the workspace holds a result it made since: an input set back is no new work', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    // Nothing is held: each task runs as it is launched, and its execution is recorded
    const runner = gatedRunner(storage, repo, tasks);
    for (const name of tasks.keys()) runner.pass(name);
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const run = async () => orchestrator.wait(await orchestrator.start(storage, repo, 'ws', { runner }));
    const v1 = (await held(storage, repo, 'inputs/sales'))!;
    assert.equal((await run()).executed, 3);
    await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), 5n, IntegerType);
    assert.equal((await run()).executed, 3);

    // sales set back: each task's result there is in the cache, though the workspace holds the one made at 5
    await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), 1n, IntegerType);
    assert.equal(await held(storage, repo, 'inputs/sales'), v1);
    const back = await run();
    assert.deepEqual([back.success, back.executed, back.cached], [true, 0, 3], 'no task ran again');
    assert.equal(await held(storage, repo, 'tasks/report/output'), made('report', made('forecast', made('clean', v1))),
      'each result is the one made at the first value');
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
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
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
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
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
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
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

  it('leaves a task as another path settled it when the catch-up run it waited for fails: one skipped for its producer\'s failure is not failed too', async (t) => {
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
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
      return commit;
    };

    // forecast's result moves to c1 while capacity's goes from c0 to c2, and plan runs on c0
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

    // An edit makes capacity due, and its own run starts on c3; then forecast lands c1, and plan, reading both as of
    // c1, waits for a catch-up run of capacity there: both of capacity's runs are in flight
    const c3 = await edit([['a', 1n], ['b', 2n], ['c', 3n]]);
    assert.deepEqual((await runner.launched('capacity')).inputHashes, [c3.state, (await held(storage, repo, 'inputs/rates'))!]);
    runner.release('forecast');
    await lines.said('[CATCH-UP] capacity for plan');
    assert.deepEqual((await runner.launched('capacity')).inputHashes, [c1.state, (await held(storage, repo, 'inputs/rates'))!]);

    // capacity's own run fails first, and plan, which reads it, is skipped; then the catch-up run fails too
    runner.fail('capacity', 'the capacity model did not converge');
    await lines.said('[SKIPPED] plan');
    runner.fail('capacity', 'the capacity model did not converge');
    await runner.launched('forecast');
    runner.release('forecast');

    const result = await orchestrator.wait(handle);
    assert.deepEqual([result.success, result.failed, result.skipped], [false, 1, 1], 'capacity failed, and plan was skipped: counted once each');
    assert.deepEqual(lines.printed.filter((line) => line.endsWith(' plan') && !line.startsWith('[START]') && !line.startsWith('[DONE]')),
      ['[CATCH-UP] capacity for plan', '[SKIPPED] plan'], 'plan is told skipped, and never failed');
    assert.equal((await stateStore.read(repo, 'ws', handle.id))?.tasks.get('plan')?.status, 'skipped');
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
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
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

  it('decides a task again when a result it reads lands while its deferral is decided: none is deferred for a disagreement already gone', async (t) => {
    const context = await setup(t);
    const { orchestrator, handle, runner, lines, deciding, agreed } = await decidingPlan(t, context);
    const ended = orchestrator.wait(handle);
    ended.catch(() => undefined);

    // forecast lands on the new value while plan is decided on the old: its
    // inputs agree now, and nothing is left to land and un-defer it
    try {
      runner.release('forecast');
      await lines.said('[DONE] forecast', 2);
    } finally {
      deciding.open();
    }

    // plan is decided again, and runs; a run that deferred it would end stuck
    const launched = await Promise.race([runner.launched('plan'), ended.then(() => null)]);
    assert.deepEqual(launched?.inputHashes, agreed);
    runner.release('plan');
    assert.equal((await ended).success, true);
    assert.deepEqual(lines.lines.filter((line) => line.startsWith('[DEFER]')), [], 'plan was never deferred');
  });

  it('leaves a task skipped that a failure upstream skipped while its deferral was decided', async (t) => {
    const context = await setup(t);
    const { orchestrator, handle, runner, lines, stateStore, deciding } = await decidingPlan(t, context);

    // forecast fails while plan is decided: plan is skipped, and stays so
    try {
      runner.fail('forecast', 'the model did not converge');
      await lines.said('[SKIPPED] plan');
    } finally {
      deciding.open();
    }
    const result = await orchestrator.wait(handle);
    assert.deepEqual([result.success, result.failed, result.skipped], [false, 1, 1]);
    assert.equal((await stateStore.read(context.repo, 'ws', handle.id))?.tasks.get('plan')?.status, 'skipped');
    assert.deepEqual(lines.lines.filter((line) => line.startsWith('[DEFER]')), [], 'plan was not deferred over its skip');
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
    const deploy = await acquireWorkspaceExclusive(storage, repo, 'ws', variant('deployment', null));
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

  it('stops a run for an export, a copy onto its workspace and a removal as for a deploy, saying which started, and each takes the workspace', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    await workspaceCreate(storage, repo, 'other');
    await workspaceDeploy(storage, repo, 'other', 'chain', '1.0.0');
    const runner = gatedRunner(storage, repo, tasks);
    const stateStore = stateStoreOf(context);
    const orchestrator = new LocalOrchestrator(stateStore);

    /** A run on a new value of sales is stopped while clean runs by what `take` starts. A copy onto the workspace and
     *  its removal take its runs and their states with it, once the run has let it go */
    const stopFor = async (sales: bigint, started: string, take: () => Promise<unknown>, keepsRuns: boolean): Promise<void> => {
      await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), sales, IntegerType);
      const lines = new RunLines();
      const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
      const waited = orchestrator.wait(handle);
      waited.catch(() => undefined);
      await runner.launched('clean');

      // It takes the workspace only once the run has let it go
      const taking = take();
      await assert.rejects(waited, (err: unknown) => {
        assert.ok(err instanceof DataflowAbortedError, `a DataflowAbortedError, not ${String(err)}`);
        assert.equal(err.reason, `${started} started`);
        return true;
      });
      assert.deepEqual(lines.printed, ['[START] clean', '[CANCELLED] clean'], started);
      await taking;
      if (keepsRuns) assert.deepEqual((await stateStore.read(repo, 'ws', handle.id))?.error, some(`${started} started`));
    };

    await stopFor(10n, 'an export of ws', () => workspaceExport(storage, repo, 'ws', join(scratch(t), 'ws.zip')), true);
    await stopFor(11n, 'a copy onto ws', () => workspaceCopy(storage, repo, 'other', 'ws'), false);
    const copied = await storage.datasets.read(repo, 'other', 'inputs/sales');
    assert.ok(copied?.type === 'value');
    assert.equal(await held(storage, repo, 'inputs/sales'), copied.value.hash, 'ws holds what other does');
    await stopFor(12n, 'a removal of ws', () => workspaceRemove(storage, repo, 'ws'), false);
    assert.equal(await workspaceGetState(storage, repo, 'ws'), null, 'the removal took the workspace');
  });

  it('counts a task due again by the result it holds: a run stopped while the task runs again records the results that stand, as its stop says them', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const stateStore = stateStoreOf(context);
    const orchestrator = new LocalOrchestrator(stateStore);
    const handle = await orchestrator.start(storage, repo, 'ws', { runner });
    const waited = orchestrator.wait(handle);
    waited.catch(() => undefined);

    // clean lands, and runs again on an edit while forecast runs on its first result
    await runner.launched('clean');
    runner.release('clean');
    await runner.launched('forecast');
    await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), 5n, IntegerType);
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
    await runner.launched('clean');

    // A deploy stops the run: clean's first result stands, and both the stop and the run's record count it
    const deploy = await acquireWorkspaceExclusive(storage, repo, 'ws', variant('deployment', null));
    try {
      await assert.rejects(waited, (err: unknown) => {
        assert.ok(err instanceof DataflowAbortedError, `a DataflowAbortedError, not ${String(err)}`);
        assert.deepEqual(err.partialResults?.map((each) => [each.name, each.state]), [['clean', 'success']]);
        return true;
      });
      const run = await storage.refs.dataflowRunGet(repo, 'ws', handle.id);
      assert.deepEqual([run?.summary.completed, run?.summary.reexecuted], [1n, 1n], 'the record counts the result that stands, and that it was due again');
      assert.equal((await stateStore.read(repo, 'ws', handle.id))?.executed, 1n);
    } finally {
      await deploy.release();
    }
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
    assert.equal(await first.wake(storage, repo, 'ws'), handle.id);
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

  it('ends a split catch-up run for good when its run yields mid-stage: no run takes it up, so its plan is let go, and its record says why', async (t) => {
    // Pieces of 16 to 256 stored bytes: a record of thousands of rows, stored in several segments, is cut a piece a
    // segment
    readTestPieceBytesFrom(() => '64');
    t.after(() => readTestPieceBytesFrom(() => process.env.E3_TEST_PIECE_BYTES));
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployCombined(t, context, 1, { split: true });
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const stateStore = stateStoreOf(context);
    const first = new LocalOrchestrator(stateStore);
    const rates = (await held(storage, repo, 'inputs/rates'))!;
    const rows = (count: number): Array<[string, bigint]> => Array.from({ length: count }, (_, i) => [`k${String(i).padStart(5, '0')}`, BigInt(i)]);
    await commitOrders(storage, repo, rows(5));
    let yielding = false;
    const handle = await first.start(storage, repo, 'ws', { runner, ...lines.callbacks, shouldYield: () => yielding });
    const edit = async (count: number): Promise<{ commit: string; state: string }> => {
      const commit = await commitOrders(storage, repo, rows(count));
      assert.equal(await first.wake(storage, repo, 'ws'), handle.id);
      return commit;
    };

    // forecast's result moves to c1, and capacity's, whose own runs go straight through from here, to c2
    await runner.launched('forecast');
    await runner.launched('capacity');
    runner.pass('capacity');
    const c1 = await edit(8000);
    runner.release('forecast');
    assert.deepEqual((await runner.launched('forecast')).inputHashes, [c1.state, rates]);
    await edit(8001);
    runner.release('forecast');
    await runner.launched('forecast');
    runner.release('capacity');
    await lines.said('[DONE] capacity', 2);

    // plan ran on c0; it reads both as of c1, where capacity never ran, and a catch-up run of it starts, its first unit
    // held
    runner.hold('capacity');
    await runner.launched('plan');
    runner.release('plan');
    await lines.said('[CATCH-UP] capacity for plan');
    await runner.launched('capacity');

    // The run yields while the catch-up run is mid-stage
    yielding = true;
    await first.wake(storage, repo, 'ws');
    assert.equal((await first.wait(handle)).yielded, true);

    // No run takes a catch-up run up: it ended for good, its plan let go, and its record says why
    const inHash = inputsHash([c1.state, rates]);
    const ended = await storage.refs.executionGetLatest(repo, tasks.get('capacity')!, inHash);
    assert.ok(ended?.type === 'cancelled', `the catch-up run ended, not left mid-stage: ${ended?.type}`);
    assert.equal(ended.value.reason.message,
      'cancelled: the run yielded, and no run takes a catch-up run up again: the resumed run makes it again where a task still reads it');
    assert.equal(await storage.refs.executionPlanRead(repo, tasks.get('capacity')!, inHash), null, 'its plan is not rooted');

    // Another orchestrator takes the run up, and it completes: plan is decided again where its inputs stand
    for (const name of tasks.keys()) runner.pass(name);
    for (const name of tasks.keys()) while (runner.holding(name) > 0) runner.release(name);
    const second = new LocalOrchestrator(stateStore);
    assert.equal((await second.wait(await second.resume(storage, repo, 'ws', handle.id, { runner }))).success, true);
  });

  it('reads a record as of the oldest commit its inputs name that the store still holds: one a compaction cut and gc swept is passed over', async (t) => {
    const context = await setup(t);
    const { repo } = context;
    // Once a commit is named gone, the store holds it no more: a compaction cut it from the record's history, and gc
    // swept it
    let gone: string | null = null;
    const storage = standIn(context.storage, {
      objects: standIn(context.storage.objects, {
        read: (...args: Parameters<StorageBackend['objects']['read']>) =>
          (gone !== null && args[1] === gone ? Promise.reject(new ObjectNotFoundError(gone)) : context.storage.objects.read(...args)),
        touch: async (...args: Parameters<StorageBackend['objects']['touch']>) =>
          (await context.storage.objects.touch(...args)).map((held, at) => held && args[1][at] !== gone),
      }),
    });
    const tasks = await deployChecked(t, context);
    const runner = gatedRunner(context.storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const c0 = await ordersHead(context.storage, repo);
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    // A task's next launch, or the run's end before it, which fails the case
    const ended = orchestrator.wait(handle).then(() => {
      throw new Error('the run ended first');
    });
    ended.catch(() => undefined);
    const launched = (task: string): ReturnType<GatedTaskRunner['launched']> => Promise.race([runner.launched(task), ended]);

    // clean runs on c0, and slow keeps the run in flight. An edit commits c1, and c0 is gone
    await runner.launched('slow');
    assert.deepEqual((await runner.launched('clean')).inputHashes, [c0.state]);
    const c1 = await commitOrders(context.storage, repo, [['a', 1n]]);
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
    gone = c0.commit;

    // clean lands on c0 and runs again on c1. check reads the record directly at c1, and clean's result at c0, which
    // it passes over: it waits for clean's run on c1, and reads both there
    runner.release('clean');
    assert.deepEqual((await launched('clean')).inputHashes, [c1.state]);
    runner.release('clean');
    assert.deepEqual((await launched('check')).inputHashes, [c1.state, made('clean', c1.state)]);
    for (const name of tasks.keys()) runner.pass(name);
    runner.release('check');
    runner.release('slow');
    assert.equal((await orchestrator.wait(handle)).success, true);
  });

  it('takes in what was edited while it yielded before it decides a task again: a resumed run runs each task on the edit', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const stateStore = stateStoreOf(context);
    const first = new LocalOrchestrator(stateStore);
    let yielding = false;
    const handle = await first.start(storage, repo, 'ws', { runner, shouldYield: () => yielding });

    // The run yields while clean runs on the input as the run found it, and the input is edited meanwhile
    await runner.launched('clean');
    yielding = true;
    await first.wake(storage, repo, 'ws');
    assert.equal((await first.wait(handle)).yielded, true);
    await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), 9n, IntegerType);
    const edited = (await held(storage, repo, 'inputs/sales'))!;

    // Another orchestrator takes the run up: clean runs on the edit
    const second = new LocalOrchestrator(stateStore);
    const resumed = await second.resume(storage, repo, 'ws', handle.id, { runner });
    assert.deepEqual((await runner.launched('clean')).inputHashes, [edited], 'the resumed run decides clean on the edit');
    for (const name of tasks.keys()) runner.pass(name);
    for (const name of tasks.keys()) while (runner.holding(name) > 0) runner.release(name);
    assert.equal((await second.wait(resumed)).success, true);
    assert.equal(await held(storage, repo, 'tasks/report/output'), made('report', made('forecast', made('clean', edited))));
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
    assert.equal(await orchestrator.wake(down, repo, 'ws'), null, 'a look that failed hands nothing over');

    // The run asks again by itself, with no second wake: both run on the edit
    assert.deepEqual((await runner.launched('clean')).inputHashes, [c1.state]);
    runner.release('clean');
    assert.deepEqual((await runner.launched('check')).inputHashes, [c1.state, made('clean', c1.state)]);
    runner.release('check');
    runner.release('slow');
    assert.equal((await orchestrator.wait(handle)).success, true);
    assert.equal(await held(storage, repo, 'tasks/check/output'), made('check', c1.state, made('clean', c1.state)));
  });

  it('asks each task that holds a result as it resumes: the readers a look left unasked when the run yielded are not lost with it', async (t) => {
    const context = await setup(t);
    const { repo } = context;
    const paced = pacedStorage(context.storage);
    const storage = paced.storage;
    const tasks = await deployChecked(t, context);
    const runner = gatedRunner(context.storage, repo, tasks);
    const lines = new RunLines();
    const stateStore = stateStoreOf(context);
    const first = new LocalOrchestrator(stateStore);
    let yielding = false;
    const handle = await first.start(storage, repo, 'ws', { runner, shouldYield: () => yielding, ...lines.callbacks });

    // clean and check land on the record as the run found it, and slow's
    // input is edited while it runs
    await runner.launched('slow');
    await runner.launched('clean');
    runner.release('clean');
    await runner.launched('check');
    runner.release('check');
    await lines.said('[DONE] check');
    await workspaceSetDataset(storage, repo, 'ws', inputPath('rates'), 2n, IntegerType);
    const r2 = (await held(storage, repo, 'inputs/rates'))!;
    assert.equal(await first.wake(storage, repo, 'ws'), handle.id);

    // slow lands and is due again: the run is part way through a pass,
    // asking the cache for slow over the edit
    const preparing = paced.hold('refs', 'executionListIds', (args) => args[1] === tasks.get('slow') && args[2] === inputsHash([r2]));
    runner.release('slow');
    await preparing.reached;
    let c1: Awaited<ReturnType<typeof commitOrders>>;
    try {
      // An edit of the record commits, and the look its writer's start asks
      // for fails once it has taken the edit in: check is asked first, which
      // reads the store, and clean is never asked
      c1 = await commitOrders(storage, repo, [['a', 1n]]);
      const down = standIn(storage, {
        refs: standIn(storage.refs, { workspaceRead: () => Promise.reject(new Error('the store went away')) }),
      });
      assert.equal(await first.wake(down, repo, 'ws'), null, 'a look that failed hands nothing over');
      yielding = true;
    } finally {
      preparing.open();
    }

    // The run yields at the end of that pass, before it asks again: its
    // state holds the edit, and clean as it landed before it
    assert.equal((await first.wait(handle)).yielded, true);
    const yielded = await stateStore.read(repo, 'ws', handle.id);
    assert.deepEqual([yielded?.inputSnapshot.get('.records.orders'), yielded?.tasks.get('clean')?.status], [c1.commit, 'completed']);

    // Another orchestrator takes the run up. No look finds the edit, which
    // the snapshot holds: clean is asked as every task with a result is,
    // runs on the edit, and check after it
    const second = new LocalOrchestrator(stateStore);
    const resumed = await second.resume(storage, repo, 'ws', handle.id, { runner });
    for (const name of tasks.keys()) runner.pass(name);
    for (const name of tasks.keys()) while (runner.holding(name) > 0) runner.release(name);
    assert.equal((await second.wait(resumed)).success, true);
    assert.equal(await held(storage, repo, 'tasks/check/output'), made('check', c1.state, made('clean', c1.state)));
  });

  it('keeps a result that has landed though a read after it fails, run or answered by the cache: what the read was to ask is asked again, and the task is not failed', async (t) => {
    const context = await setup(t);
    const { repo } = context;
    // Armed as clean's result lands, the ref store refuses the input's next read: the look for changed inputs that follows
    let armed = false;
    let refused = 0;
    const storage = standIn(context.storage, {
      datasets: standIn(context.storage.datasets, {
        read: (...args: Parameters<StorageBackend['datasets']['read']>) => {
          if (armed && args[2] === 'inputs/sales') {
            armed = false;
            refused++;
            return Promise.reject(new Error('the ref store is throttling'));
          }
          return context.storage.datasets.read(...args);
        },
      }),
    });
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(context.storage, repo, tasks);
    for (const name of tasks.keys()) runner.pass(name);
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const run = async (): Promise<{ result: Awaited<ReturnType<LocalOrchestrator['wait']>>; lines: RunLines }> => {
      const lines = new RunLines();
      const handle = await orchestrator.start(storage, repo, 'ws', {
        runner,
        ...lines.callbacks,
        onTaskComplete: (completed) => {
          lines.callbacks.onTaskComplete?.(completed);
          if (completed.name === 'clean') armed = true;
        },
      });
      return { result: await orchestrator.wait(handle), lines };
    };

    // clean runs, and its result lands
    const ran = await run();
    assert.equal(refused, 1, 'the read after clean landed was refused');
    assert.deepEqual([ran.result.success, ran.result.executed, ran.result.failed], [true, 3, 0], 'clean is counted once, as it landed, and nothing failed');
    assert.deepEqual(ran.lines.printed.filter((line) => line.endsWith(' clean')), ['[START] clean', '[DONE] clean']);

    // Run again, the cache answers each task: the read after clean's answer is refused as well
    const answered = await run();
    assert.equal(refused, 2, 'the read after the cache answered clean was refused');
    assert.deepEqual([answered.result.success, answered.result.cached, answered.result.failed], [true, 3, 0]);
    assert.deepEqual(answered.lines.printed.filter((line) => line.endsWith(' clean')), ['[CACHED] clean']);
  });

  it('takes no wake once a task has failed: the run launches nothing more, so a start is refused rather than handed to it', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployBeside(t, context);
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });

    // quick fails while slow runs: the run winds down on slow, launching nothing more
    await runner.launched('slow');
    await runner.launched('quick');
    runner.fail('quick', 'the model did not converge');
    await lines.said('[FAILED] quick');

    // An edit of slow's input, and its writer's start: the run would never launch slow again
    await workspaceSetDataset(storage, repo, 'ws', inputPath('a'), 5n, IntegerType);
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), null, 'a run that launches nothing more takes no wake');

    runner.release('slow');
    const result = await orchestrator.wait(handle);
    assert.deepEqual([result.success, result.failed], [false, 1]);
    assert.equal(runner.holding('slow'), 0, 'slow was not launched again for the edit');
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
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id, 'the run in flight takes a wake');

    // A deploy announces itself, and waits for the run to let the workspace go
    const intent = await storage.locks.acquire(repo, workspaceIntentLock('ws'), variant('deployment', null));
    assert.ok(intent !== null);
    try {
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), null, 'the run takes nothing in for a deploy that waits');
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

  it('launches no run of a task over the inputs a catch-up run of it is running over: the task waits for it, unprepared, and the cache answers it', async (t) => {
    const context = await setup(t);
    const { repo } = context;
    const tasks = await deployTwoSided(t, context, { probe: true });
    // Each ask of the execution cache, by task and inputs: preparing a task asks it once
    const cacheAsks: Array<readonly [string, string]> = [];
    const storage = standIn(context.storage, {
      refs: standIn(context.storage.refs, {
        executionListIds: (...args: Parameters<StorageBackend['refs']['executionListIds']>) => {
          cacheAsks.push([args[1], args[2]]);
          return context.storage.refs.executionListIds(...args);
        },
      }),
    });
    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    const edit = async (rows: ReadonlyArray<[string, bigint]>): Promise<{ commit: string; state: string }> => {
      const commit = await commitOrders(storage, repo, rows);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
      return commit;
    };
    await runner.launched('zz');
    runner.release('zz');

    // left's result moves to c1 while right's goes from c0 to c2, and both runs on c0
    await runner.launched('left');
    await runner.launched('right');
    const c1 = await edit([['a', 1n]]);
    runner.release('left');
    assert.deepEqual((await runner.launched('left')).inputHashes, [c1.state]);
    await edit([['a', 1n], ['b', 2n]]);
    runner.release('right');
    await runner.launched('right');
    await runner.launched('both');
    runner.release('both');
    await lines.said('[DONE] both');
    runner.release('right');
    await lines.said('[DONE] right', 2);

    // left lands on c1, and runs on: both reads both as of c1, where right never ran, and a catch-up run of it starts
    runner.release('left');
    await lines.said('[CATCH-UP] right for both');
    assert.deepEqual((await runner.launched('right')).inputHashes, [c1.state]);

    // An edit puts the record back as it was at c1, and the probe moves: right is due, over the very inputs its
    // catch-up run reads, and zz, which the run decides after right, is due too
    const c4 = await commitOrders(storage, repo, [['a', 1n]]);
    assert.equal(c4.state, c1.state);
    await workspaceSetDataset(storage, repo, 'ws', inputPath('probe'), 2n, IntegerType);
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
    await runner.launched('zz');
    assert.equal(runner.holding('right'), 1, 'right waits for its catch-up run: no run of it beside it');

    // The loop makes a pass whenever something settles or a wake ends, and passes right by in each while its
    // catch-up run is in flight: zz lands, the probe moves again, and right is not prepared again
    const prepares = (): number => cacheAsks.filter(([task, inputs]) => task === tasks.get('right') && inputs === inputsHash([c1.state])).length;
    const prepared = prepares();
    runner.release('zz');
    await lines.said('[DONE] zz', 2);
    await workspaceSetDataset(storage, repo, 'ws', inputPath('probe'), 3n, IntegerType);
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
    await runner.launched('zz');
    assert.equal(prepares(), prepared, 'right waited unprepared through each pass');

    // The catch-up run lands, and right reads what it made from the cache: right ran once over those inputs
    runner.release('right');
    await lines.said('[DONE] right for both');
    await lines.said('[CACHED] right');
    assert.equal(prepares(), prepared + 1, 'prepared once more as the run settled, and answered');
    assert.equal((await context.storage.refs.executionListIds(repo, tasks.get('right')!, inputsHash([c1.state]))).length, 1);

    for (const name of tasks.keys()) runner.pass(name);
    for (const name of tasks.keys()) while (runner.holding(name) > 0) runner.release(name);
    assert.equal((await orchestrator.wait(handle)).success, true);
  });

  it('launches a split catch-up run once though it lands while another task that reads it is resolved: that task is resolved again', async (t) => {
    const context = await setup(t);
    const { repo } = context;
    const paced = pacedStorage(context.storage);
    const storage = paced.storage;
    const tasks = await deployCombined(t, context, 2, { split: true, late: true });
    const runner = gatedRunner(context.storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const rates = (await held(storage, repo, 'inputs/rates'))!;
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    const edit = async (rows: ReadonlyArray<[string, bigint]>): Promise<{ commit: string; state: string }> => {
      const commit = await commitOrders(storage, repo, rows);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
      return commit;
    };

    // forecast's result moves to c1 while capacity's, whose work is split, goes from c0 to c2; plan runs on c0, and
    // budget waits for its input late
    await runner.launched('forecast');
    await runner.launched('capacity');
    const c1 = await edit([['a', 1n]]);
    runner.release('forecast');
    assert.deepEqual((await runner.launched('forecast')).inputHashes, [c1.state, rates]);
    await edit([['a', 1n], ['b', 2n]]);
    runner.release('capacity');
    await runner.launched('capacity');
    await runner.launched('plan');
    runner.release('plan');
    await lines.said('[DONE] plan');
    runner.release('forecast');
    await runner.launched('forecast');
    runner.release('capacity');

    // plan reads both as of c1, where capacity never ran: a split catch-up run of it starts, its one unit the run's own
    await lines.said('[CATCH-UP] capacity for plan');
    const unit = await runner.launched('capacity');

    // late is set, and budget is resolved as of c1 too: its look in the execution cache is held while the catch-up run
    // lands
    const asked = paced.hold('refs', 'executionListIds', (args) => args[1] === tasks.get('capacity') && args[2] === inputsHash([c1.state, rates]));
    try {
      await workspaceSetDataset(storage, repo, 'ws', inputPath('late'), 1n, IntegerType);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
      await asked.reached;
      runner.release('capacity');
      await lines.said('[DONE] capacity for plan');
    } finally {
      asked.open();
    }

    // budget is resolved again, and reads what the catch-up run made: the run was launched once
    const budget = runner.launched('budget');
    try {
      await Promise.race([budget, lines.said('[CATCH-UP] capacity for budget')]);
      assert.deepEqual(lines.printed.filter((line) => line.startsWith('[CATCH-UP]')), ['[CATCH-UP] capacity for plan'], 'one catch-up run');
      const late = (await held(storage, repo, 'inputs/late'))!;
      assert.deepEqual((await budget).inputHashes, [made('forecast', c1.state, rates), made('capacity', ...unit.inputHashes), late]);
    } finally {
      for (const name of tasks.keys()) runner.pass(name);
      for (const name of tasks.keys()) while (runner.holding(name) > 0) runner.release(name);
    }
    assert.equal((await orchestrator.wait(handle)).success, true);
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
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
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

  it('decides a task again when the input it would wait on is set while it is prepared: a start handed to the run leaves no task waiting on what it set', async (t) => {
    const context = await setup(t);
    const { repo } = context;
    const paced = pacedStorage(context.storage);
    const storage = paced.storage;
    const tasks = await deployCombined(t, context, 2, { late: true });
    const runner = gatedRunner(context.storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const c0 = await ordersHead(storage, repo);
    const rates = (await held(storage, repo, 'inputs/rates'))!;
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });

    // forecast and capacity land on c0: budget waits for its input late, and
    // plan keeps the run in flight
    await runner.launched('forecast');
    await runner.launched('capacity');
    runner.release('forecast');
    runner.release('capacity');
    await runner.launched('plan');

    // An edit commits: both run on c1, and forecast lands there first, so
    // budget is decided again, as of c0, where capacity's result still is
    const c1 = await commitOrders(storage, repo, [['a', 1n]]);
    assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
    await runner.launched('forecast');
    await runner.launched('capacity');
    const preparing = paced.hold('refs', 'executionListIds', (args) => args[1] === tasks.get('forecast') && args[2] === inputsHash([c0.state, rates]));
    runner.release('forecast');
    await preparing.reached;
    try {
      // capacity lands on c1 while budget is prepared, so no result is left
      // to land that budget reads. Someone then sets late and starts: the
      // start is handed to the run, whose look takes late in and passes
      // budget by, as a task about to launch
      runner.release('capacity');
      await lines.said('[DONE] capacity', 2);
      await workspaceSetDataset(storage, repo, 'ws', inputPath('late'), 1n, IntegerType);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id, 'the run takes the change in');
    } finally {
      preparing.open();
    }

    // budget is not left waiting on the input the run took in, with nothing
    // left to release it: it runs, and the run ends with every task on c1
    const late = (await held(storage, repo, 'inputs/late'))!;
    for (const name of tasks.keys()) runner.pass(name);
    for (const name of tasks.keys()) while (runner.holding(name) > 0) runner.release(name);
    const result = await orchestrator.wait(handle);
    assert.deepEqual([result.success, result.waiting], [true, 0], 'no task waits');
    assert.equal(await held(storage, repo, 'tasks/budget/output'),
      made('budget', made('forecast', c1.state, rates), made('capacity', c1.state, rates), late));
  });

  it('launches no task a failure skipped while its launch waited its turn for the run\'s state: it stays skipped, and is counted once', async (t) => {
    const context = await setup(t);
    const { repo } = context;
    const paced = pacedStorage(context.storage);
    const storage = paced.storage;
    const tasks = await deployChain(t, context);
    const runner = gatedRunner(context.storage, repo, tasks);
    const lines = new RunLines();
    const stateStore = stateStoreOf(context);
    const orchestrator = new LocalOrchestrator(stateStore);
    const v1 = (await held(storage, repo, 'inputs/sales'))!;
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    // What the run has queued for its state has asked for it once a turn of the event loop has passed: no store is
    // read between the steps the case places
    const queued = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

    try {
      // An edit lands while clean runs. clean's result lands, made from the input as it was, and clean runs again:
      // forecast is ready on the result clean holds, and is prepared, its look in the execution cache held
      await runner.launched('clean');
      await workspaceSetDataset(storage, repo, 'ws', inputPath('sales'), 5n, IntegerType);
      assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id);
      const preparing = paced.hold('refs', 'executionListIds', (args) => args[1] === tasks.get('forecast') && args[2] === inputsHash([made('clean', v1)]));
      runner.release('clean');
      await runner.launched('clean');
      await preparing.reached;

      // A wake's look holds the run's state, its read of the input held, and clean fails: its failure waits its turn
      // behind the look. Then forecast, decided ready, asks for the run's state to start, behind the failure
      const look = paced.hold('datasets', 'read', (args) => args[2] === 'inputs/sales');
      const waking = orchestrator.wake(storage, repo, 'ws');
      try {
        await look.reached;
        runner.fail('clean', 'the source went away');
        await queued();
        preparing.open();
        await queued();
      } finally {
        preparing.open();
        look.open();
      }
      await waking;

      // The failure is applied first, and skips forecast: its launch, whose turn comes next, launches nothing
      const ended = orchestrator.wait(handle);
      assert.equal(await Promise.race([ended.then(() => null), runner.launched('forecast')]), null, 'forecast was skipped, and is not launched');
      const result = await ended;
      assert.deepEqual([result.success, result.executed, result.cached, result.failed, result.skipped], [false, 0, 0, 1, 2],
        'clean failed, forecast and report were skipped, each counted once');
      assert.deepEqual(lines.printed.filter((line) => line.endsWith(' forecast')), ['[SKIPPED] forecast'], 'forecast is told skipped, and never started');
      assert.equal((await stateStore.read(repo, 'ws', handle.id))?.tasks.get('forecast')?.status, 'skipped');
    } finally {
      // A run that launched what it should not have is let through to its end
      for (const name of tasks.keys()) runner.pass(name);
      for (const name of tasks.keys()) while (runner.holding(name) > 0) runner.release(name);
    }
  });

  it('stops no run for a deploy or a copy that is refused: a version no package has, a record the package cannot carry, a source no workspace has, and a source held whole', async (t) => {
    const context = await setup(t);
    const { storage, repo } = context;
    const tasks = await deployCombined(t, context);
    // A later version whose record `orders` is of another type, with no migration to carry it
    const names = DictType(StringType, StringType);
    const renamed = e3.record('orders', names, { initial: new Map() });
    const count = e3.task('forecast', [renamed], East.function([names], IntegerType, ($, rows) => rows.size()));
    const zip = join(scratch(t), 'combined-2.zip');
    await e3.export(e3.package('combined', '2.0.0', renamed, count), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'other');
    await workspaceDeploy(storage, repo, 'other', 'combined', '1.0.0');

    const runner = gatedRunner(storage, repo, tasks);
    const lines = new RunLines();
    const orchestrator = new LocalOrchestrator(stateStoreOf(context));
    const handle = await orchestrator.start(storage, repo, 'ws', { runner, ...lines.callbacks });
    await runner.launched('forecast');
    await runner.launched('capacity');
    // A run that stopped takes no wake: one in flight answers its own id
    const inFlight = async (after: string): Promise<void> => assert.equal(await orchestrator.wake(storage, repo, 'ws'), handle.id, `the run goes on after ${after}`);

    try {
      await assert.rejects(workspaceDeploy(storage, repo, 'ws', 'combined', '9.9.9'), { name: 'PackageNotFoundError' });
      await inFlight('a deploy of a version no package has');
      await assert.rejects(workspaceDeploy(storage, repo, 'ws', 'combined', '2.0.0'), RecordDeployRefusedError);
      await inFlight('a deploy the record refuses');
      await assert.rejects(workspaceCopy(storage, repo, 'nowhere', 'ws'), WorkspaceNotFoundError);
      await inFlight('a copy of a workspace that does not exist');
      const deploying = await acquireWorkspaceExclusive(storage, repo, 'other', variant('deployment', null));
      try {
        await assert.rejects(workspaceCopy(storage, repo, 'other', 'ws'), WorkspaceLockError);
      } finally {
        await deploying.release();
      }
      await inFlight('a copy of a workspace a deploy holds');
    } finally {
      for (const name of tasks.keys()) runner.pass(name);
      for (const name of tasks.keys()) while (runner.holding(name) > 0) runner.release(name);
    }
    assert.equal((await orchestrator.wait(handle)).success, true);
    assert.deepEqual(lines.printed.filter((line) => line.startsWith('[CANCELLED]')), [], 'no task was stopped');
  });
}
