/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A composite record's source the dataflow loads (§4.4, §7.8): a load node of
 * each run, after the task that writes its feed. Its commit is a change of the
 * record, whose readers run after it in the same run; the record's slots
 * answer a delivery it holds already; a load that cannot run holds its
 * record's readers; one that fails leaves its run going; and its commit runs
 * outside the run's lock on its state. On the real runner, a load runs its
 * program. A case that needs a step to happen while another runs holds it — a
 * task's execution at a gated runner, a commit's call at a held store — so no
 * case waits on a clock.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { StringType, encodeBeast2For, equalFor, parseFor, printFor, variant, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { DatasetRefType, VersionVectorType, type TreePath } from '@elaraai/e3-types';
import { dataflowGetGraph } from './dataflow.js';
import type { OrchestratorStartOptions } from './dataflow/orchestrator/interfaces.js';
import type { DeferReason, FinalizeResult, InputWait } from './dataflow/types.js';
import { DataflowAbortedError, ObjectNotFoundError } from './errors.js';
import type { TaskRunner } from './execution/interfaces.js';
import { LocalOrchestrator } from './execution/local-orchestrator.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { packageImport } from './package-files.js';
import { recordHistory, recordMutate, recordSystemCommit } from './records.js';
import { pruneHistory } from './history.js';
import { sourceExecution, sourceLoadSlots } from './record-slots.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { workspaceGetDataset, workspaceSetDataset } from './trees.js';
import { workspaceBundleExport, workspaceBundleImport } from './workspace-bundle.js';
import { workspaceCreate, workspaceDeploy } from './workspaces.js';
import {
  ErpDeliveryType, GatedTaskRunner, SourcedOrderType, bookFed, createTempDir, createTestRepo, fedOrders, gated, overriding, removeTempDir,
  removeTestRepo, sourceLoaded, withStores,
} from './test-helpers.js';

const WS = 'main';
const AS_OF = '2026-11-02T03:00:00.000';
/** The ref `orders` is held in. */
const ORDERS_REF = 'records/orders';
const inputPath = (name: string): TreePath => [variant('field', 'inputs'), variant('field', name)];
const ERP_ROWS = inputPath('erp_rows');
const WMS_ROWS = inputPath('wms_rows');
const ERP_EXTRACT = inputPath('erp_extract');
/** A task's output, by the task's name. */
const outputOf = (task: string): TreePath => [variant('field', 'tasks'), variant('field', task), variant('field', 'output')];
const FORECAST = outputOf('forecast');
const parseVersions = parseFor(VersionVectorType);
const sameVersions = equalFor(VersionVectorType);

type Book = ValueTypeOf<typeof ErpDeliveryType>;
type Orders = Record<string, readonly [string, bigint]>;
const book = (orders: Orders): Book => new Map(Object.entries(orders).map(([id, [customer, qty]]) => [id, { customer, qty }]));

/** How a run tells a wait: its kind and input, and what it waits for. */
function waitWords(wait: InputWait): string {
  switch (wait.kind) {
    case 'unset': return `unset ${wait.input}`;
    case 'package': return `package ${wait.input}`;
    case 'pending': return `pending ${wait.input} (${wait.sources.join(', ')})`;
    case 'upstream': return `upstream ${wait.input} (${wait.task})`;
  }
}

/** Why a run deferred a task, as the spec's lines say it: the reason's kind, and what it names. */
function deferWords(reason: DeferReason): string {
  switch (reason.kind) {
    case 'plain': return `plain ${reason.input} through ${reason.through.join(', ')}`;
    case 'forgotten': return `forgotten ${reason.record}.${reason.source} (${reason.roots.join(', ')})`;
    case 'carried': return `carried ${reason.root} (${reason.records.map((record, at) => `${record}.${reason.sources[at]}`).join(', ')})`;
    case 'feed': return `feed ${reason.input} (${reason.record}.${reason.source})`;
  }
}

/** Lets every execution of a task the gate holds run on, and every one after. */
function releaseAll(gate: GatedTaskRunner, task: string): void {
  gate.pass(task);
  while (gate.holding(task) > 0) gate.release(task);
}

/** A run under way: what it tells its caller, a line each, and its end. */
interface Started {
  /** What it told, in order */
  readonly lines: string[];
  /** Each node's error, by name, as it told it */
  readonly errors: Map<string, string>;
  /** Settles once it has told the line */
  until(line: string): Promise<void>;
  /** Its end */
  readonly done: Promise<FinalizeResult>;
}

/** What a run of the workspace's dataflow is started with. */
type StartOptions = Pick<OrchestratorStartOptions, 'force' | 'filter' | 'signal' | 'shouldYield'> & {
  /** The runner its tasks run on: the spec's own when omitted */
  readonly runner?: TaskRunner;
  /** The storage it goes through: the spec's own when omitted */
  readonly storage?: StorageBackend;
  /** The repository and the workspace it runs: the spec's own when omitted */
  readonly at?: { readonly repo: string; readonly ws: string };
};

describe('a source the dataflow loads', () => {
  let repo: string;
  let dir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;

  beforeEach(() => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage();
    runner = new LocalTaskRunner(repo);
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  /** Deploys the fed orders, as asked, to the workspace. */
  async function deployed(options: Parameters<typeof fedOrders>[0] = {}): Promise<void> {
    const zip = join(dir, 'fed.zip');
    await e3.export(fedOrders(options).pkg(), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, WS);
    await workspaceDeploy(storage, repo, WS, 'fed', '1.0.0', { runner });
  }

  /** Sets an input of the ERP's or the warehouse's rows. */
  const setRows = (path: TreePath, orders: Orders) => workspaceSetDataset(storage, repo, WS, path, book(orders), ErpDeliveryType);

  /** Delivers the warehouse's book, as `e3 load` does. */
  const deliverWms = (orders: Orders) => sourceLoaded(storage, runner, repo, WS, 'orders', 'wms', { type: ErpDeliveryType, value: book(orders) }, AS_OF);

  /** A save of one of the solution's own orders, as a person makes it. */
  async function save(id: string, customer: string, qty: bigint): Promise<void> {
    const saved = await recordMutate(storage, runner, repo, WS, 'orders', 'plan',
      [encodeBeast2For(StringType)(id), encodeBeast2For(SourcedOrderType)({ customer, qty })], { actor: 'ada@example.com' });
    assert.equal(saved.kind, 'committed');
  }

  /** Starts a run of the workspace's dataflow, which tells its steps a line each. */
  function start(options: StartOptions = {}): Started {
    const lines: string[] = [];
    const errors = new Map<string, string>();
    const awaited: Array<{ readonly line: string; readonly told: () => void }> = [];
    const tell = (line: string): void => {
      lines.push(line);
      for (const each of awaited.filter((waiting) => waiting.line === line)) {
        awaited.splice(awaited.indexOf(each), 1);
        each.told();
      }
    };
    const { runner: on = runner, storage: over = storage, at = { repo, ws: WS }, ...rest } = options;
    const orchestrator = new LocalOrchestrator();
    const done = orchestrator.start(over, at.repo, at.ws, {
      ...rest,
      runner: on,
      onTaskStart: (name) => tell(`start ${name}`),
      onTaskComplete: (task) => {
        if (task.error !== undefined) errors.set(task.name, task.error);
        tell(`${task.state === 'success' ? (task.cached ? 'cached' : 'done') : task.state} ${task.name}`);
      },
      onTaskWaiting: (name, waits) => tell(`wait ${name}: ${waits.map(waitWords).join(', ')}`),
      onTaskInvalidated: (name, reason) => tell(`due ${name}: ${reason}`),
      onTaskDeferred: (name, reason) => tell(`defer ${name}: ${deferWords(reason)}`),
    }).then((handle) => orchestrator.wait(handle));
    return {
      lines,
      errors,
      until: (line) => lines.includes(line) ? Promise.resolve() : new Promise<void>((told) => { awaited.push({ line, told }); }),
      done,
    };
  }

  /** Runs the workspace's dataflow to its end. */
  async function run(options: StartOptions = {}) {
    const started = start(options);
    const result = await started.done;
    return { result, lines: started.lines, errors: started.errors, told: started.lines.join('\n') };
  }

  /** How many times a run told a line. */
  const count = (lines: readonly string[], line: string): number => lines.filter((each) => each === line).length;

  /** The commits of `orders` that loads wrote, newest first, each by its source and who wrote it. */
  const loads = async (): Promise<string[]> => (await recordHistory(storage, repo, WS, 'orders'))
    .filter(({ commit }) => commit.mutation.startsWith('$load:'))
    .map(({ commit }) => `${commit.mutation} ${commit.actor}`);

  /**
   * The storage a run goes through, its first call of `method` on the ref of
   * `orders` once armed held until the test lets it go: a load's commit's read
   * of the record's head, after its first check of its stop, or its write,
   * after its last. Nothing else in a run makes either call on the record.
   */
  function holdingOrders(method: 'readVersioned' | 'writeIf') {
    const reached = gated<void>();
    const allowed = gated<void>();
    let armed = false;
    const hold = async (path: string): Promise<void> => {
      if (!armed || path !== ORDERS_REF) return;
      armed = false;
      reached.open();
      await allowed.opened;
    };
    const datasets = overriding(storage.datasets, method === 'readVersioned'
      ? {
        readVersioned: async (...args: Parameters<StorageBackend['datasets']['readVersioned']>) => {
          await hold(args[2]);
          return storage.datasets.readVersioned(...args);
        },
      }
      : {
        writeIf: async (...args: Parameters<StorageBackend['datasets']['writeIf']>) => {
          await hold(args[2]);
          return storage.datasets.writeIf(...args);
        },
      });
    return {
      storage: withStores(storage, { datasets }),
      arm: (): void => { armed = true; },
      reached: reached.opened,
      allow: (): void => allowed.open(),
    };
  }

  /** Deploys the book-fed orders, as asked, to the workspace. */
  async function deployedBook(options: Parameters<typeof bookFed>[0] = {}): Promise<void> {
    const zip = join(dir, 'book.zip');
    await e3.export(bookFed(options), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, WS);
    await workspaceDeploy(storage, repo, WS, 'book', '1.0.0', { runner });
  }

  /** A workspace of the book-fed orders, its first run done: each fed source has delivered once, from the book's `SO-1`. */
  async function loadedBook(): Promise<void> {
    await deployedBook();
    const { result, told } = await run();
    assert.equal(result.success, true, told);
  }

  /** Writes an order into the ERP's book, as the ERP's own feed would. */
  async function putBook(id: string, customer: string, qty: bigint): Promise<void> {
    const put = await recordMutate(storage, runner, repo, WS, 'erp_book', 'put',
      [encodeBeast2For(StringType)(id), encodeBeast2For(SourcedOrderType)({ customer, qty })], { actor: 'erp:feed' });
    assert.equal(put.kind, 'committed');
  }

  /** A record's ref: its hash and its version vector. */
  async function refOf(record: string, over: StorageBackend = storage, at = { repo, ws: WS }): Promise<{ hash: string; versions: Map<string, string> }> {
    const ref = await over.datasets.read(at.repo, at.ws, `records/${record}`);
    if (ref === null || ref.type !== 'value') assert.fail(`record ${record} holds no state`);
    return ref.value;
  }

  /** A workspace whose ERP has delivered once, `SO-1`, by a run, beside the warehouse's `W-1`. */
  async function loadedOnce(options: Parameters<typeof fedOrders>[0] = {}): Promise<void> {
    await deployed(options);
    await deliverWms({ 'W-1': ['Cedar', 7n] });
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n] });
    const { result, told } = await run();
    assert.equal(result.success, true, told);
  }

  it('R51, R27, R28 — loads its feed after the task that writes it, commits once, and runs the record\'s readers after the commit, in the same run', async () => {
    await deployed();
    await deliverWms({ 'W-1': ['Cedar', 7n] });
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n] });

    const { result, lines, told } = await run();
    assert.equal(result.success, true, told);
    // forecast waits for erp's first delivery, told once (ruling 32), and runs once the load commits
    assert.equal(count(lines, 'wait forecast: pending .records.orders (erp)'), 1, told);
    const at = (line: string): number => lines.indexOf(line);
    assert.ok(at('done combine_erp') >= 0 && at('done combine_erp') < at('start orders.erp'), told);
    assert.ok(at('start orders.erp') < at('done orders.erp') && at('done orders.erp') < at('done forecast'), told);
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:wms cli:test'], 'one commit, by the dataflow');
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 3n, 'P-1, the warehouse\'s W-1 and the ERP\'s SO-1');
  });

  it('R10 — answers a load whose record holds its feed\'s delivery already from the record\'s slots: nothing runs, and nothing commits', async () => {
    await loadedOnce();

    const { result, lines, told } = await run();
    assert.equal(result.success, true, told);
    assert.ok(lines.includes('cached orders.erp') && !lines.includes('start orders.erp'), told);
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:wms cli:test']);
  });

  it('R51 — loads a feed that moved, commits it, and runs the readers again on the record it left', async () => {
    await loadedOnce();

    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });
    const { result, lines, told } = await run();
    assert.equal(result.success, true, told);
    assert.ok(lines.indexOf('done orders.erp') < lines.indexOf('done forecast'), told);
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:erp system:dataflow', '$load:wms cli:test']);
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 4n);
  });

  it('a load its record\'s slots answer is asked, as it lands, whether its feed moved while it was prepared: it loads the feed\'s new value in the same run', async () => {
    // The ERP has delivered SO-1, and its input holds the package's value again; two tasks beside have rows to run on
    const setExtract = (orders: Orders) => workspaceSetDataset(storage, repo, WS, ERP_EXTRACT, book(orders), ErpDeliveryType);
    await deployed({ feed: 'packaged', beside: true });
    await deliverWms({ 'W-1': ['Cedar', 7n] });
    await setExtract({ 'SO-1': ['Acme', 5n] });
    await setRows(ERP_ROWS, { 'A-1': ['Ash', 1n] });
    await setRows(WMS_ROWS, { 'B-1': ['Bay', 1n] });
    const first = await run();
    assert.equal(first.result.success, true, first.told);
    await setExtract({ 'SO-0': ['Placeholder', 0n] });
    await setRows(ERP_ROWS, { 'A-2': ['Ash', 2n] });
    await setRows(WMS_ROWS, { 'B-2': ['Bay', 2n] });

    // The run reads the feed's ref twice once the input is set: the look that finds it moved, under the run's lock,
    // and then the load, as it is prepared. The load's read is held, after the store has answered it
    const reached = gated<void>();
    const allowed = gated<void>();
    let readsUntilHeld = Infinity;
    const datasets = overriding(storage.datasets, {
      read: async (...args: Parameters<StorageBackend['datasets']['read']>) => {
        const ref = await storage.datasets.read(...args);
        if (args[2] === 'inputs/erp_extract' && --readsUntilHeld === 0) {
          reached.open();
          await allowed.opened;
        }
        return ref;
      },
    });
    const gate = new GatedTaskRunner(runner, ['combine_erp', 'combine_wms']);
    const running = start({ runner: gate, storage: withStores(storage, { datasets }) });
    await Promise.all([gate.launched('combine_erp'), gate.launched('combine_wms')]);
    await running.until('wait orders.erp: package .inputs.erp_extract');

    // Someone sets the input to the delivery the record holds: a landing's look releases the load, whose read is held
    await setExtract({ 'SO-1': ['Acme', 5n] });
    readsUntilHeld = 2;
    releaseAll(gate, 'combine_erp');
    await reached.opened;
    // The feed moves on, and another landing's look finds it: the load is about to launch, and is passed by
    await setExtract({ 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });
    releaseAll(gate, 'combine_wms');
    await running.until('done combine_wms');
    allowed.open();
    const result = await running.done;
    const { lines } = running;
    const told = lines.join('\n');

    assert.equal(result.success, true, told);
    assert.ok(lines.includes('cached orders.erp'), `answered by the slots, from the feed as it read it\n${told}`);
    assert.ok(lines.includes('due orders.erp: its inputs moved while it ran'), told);
    assert.deepEqual((await loads()).filter((each) => each.startsWith('$load:erp')), ['$load:erp system:dataflow', '$load:erp system:dataflow'],
      'the feed\'s new value is loaded in the same run');
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 4n, 'P-1, W-1, SO-1 and SO-2');
  });

  it('a run\'s record names no fed record among its outputs: a load node writes a root, whose version the run\'s inputs hold', async () => {
    await loadedOnce();
    await save('P-2', 'Dane', 1n);
    const { result, told } = await run();
    assert.equal(result.success, true, told);

    const record = await storage.refs.dataflowRunGetLatest(repo, WS);
    assert.ok(record !== null && record.outputVersions.type === 'some', 'the run is recorded');
    assert.deepEqual([...record.outputVersions.value.keys()].sort(), ['.tasks.combine_erp.output', '.tasks.forecast.output'], told);
    assert.equal(record.inputVersions.get('.records.orders'), (await refOf('orders')).versions.get('.records.orders'), 'the record\'s head, with the save');
  });

  it('R52 — a load whose feed has no value waits, and the record\'s readers wait with it on the load', async () => {
    await deployed();
    const { result, lines, told } = await run();
    assert.equal(result.success, true, told);
    assert.equal(result.waiting, 3, told);
    assert.ok(lines.includes('wait combine_erp: unset .inputs.erp_rows'), told);
    assert.ok(lines.includes('wait orders.erp: unset .tasks.combine_erp.output'), told);
    assert.ok(lines.includes('wait forecast: upstream .records.orders (orders.erp)'), told);
  });

  it('R52 — a load whose feed input holds its package\'s value waits until someone sets it, its readers with it, after a first delivery as before it', async () => {
    await deployed({ feed: 'packaged' });
    await deliverWms({ 'W-1': ['Cedar', 7n] });
    const waiting = await run();
    // §4.4's listing: the load first, then the readers it holds
    assert.deepEqual(waiting.lines.filter((line) => line.startsWith('wait ')), [
      'wait orders.erp: package .inputs.erp_extract',
      'wait forecast: upstream .records.orders (orders.erp)',
    ], waiting.told);
    assert.deepEqual(await loads(), ['$load:wms cli:test'], 'the placeholder is never loaded');

    await workspaceSetDataset(storage, repo, WS, ERP_EXTRACT, book({ 'SO-1': ['Acme', 5n] }), ErpDeliveryType);
    const loaded = await run();
    assert.equal(loaded.result.success, true, loaded.told);
    assert.ok(loaded.lines.indexOf('done orders.erp') < loaded.lines.indexOf('done forecast'), loaded.told);
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 3n);

    // Set back to the package's value: the load waits again, and so do the readers it holds
    await workspaceSetDataset(storage, repo, WS, ERP_EXTRACT, book({ 'SO-0': ['Placeholder', 0n] }), ErpDeliveryType);
    const again = await run();
    assert.ok(again.lines.includes('wait orders.erp: package .inputs.erp_extract'), again.told);
    assert.ok(again.lines.includes('wait forecast: upstream .records.orders (orders.erp)'), again.told);
  });

  it('R68 — a redeploy keeps the value someone set in an input that feeds a load, under the default policy, saying so, and the load is answered by its slots', async () => {
    await deployed({ feed: 'packaged' });
    await deliverWms({ 'W-1': ['Cedar', 7n] });
    await workspaceSetDataset(storage, repo, WS, ERP_EXTRACT, book({ 'SO-1': ['Acme', 5n] }), ErpDeliveryType);
    await run();
    const set = await storage.datasets.read(repo, WS, 'inputs/erp_extract');

    const plans: string[] = [];
    await workspaceDeploy(storage, repo, WS, 'fed', '1.0.0', {
      runner, onInputPlan: (plan) => plans.push(`${plan.input} ${plan.action.type === 'retained' ? `retained ${plan.action.value.load}` : plan.action.type}`),
    });
    assert.deepEqual(plans.filter((plan) => plan.startsWith('inputs/erp_extract')), ['inputs/erp_extract retained orders.erp']);
    const kept = await storage.datasets.read(repo, WS, 'inputs/erp_extract');
    assert.ok(set !== null && kept !== null && equalFor(DatasetRefType)(kept, set), 'the value someone set is kept');
    const { lines, told } = await run();
    assert.ok(lines.includes('cached orders.erp'), told);
  });

  it('R54 — a load that fails says so, the record keeps its last commit, and a run whose load stands failed at its end ends failed, naming it, with nothing skipped', async () => {
    await loadedOnce({ failsOn: 'SO-9' });
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-9': ['Nobody', 1n] });

    const failed = await run();
    assert.equal(failed.result.success, false, failed.told);
    assert.deepEqual([failed.result.failed, failed.result.skipped], [1, 0], 'no node depends on a load: none is skipped');
    assert.ok(failed.lines.includes('failed orders.erp'), failed.told);
    assert.match(failed.errors.get('orders.erp') ?? '', /the ERP sent order SO-9, which no order book holds/, failed.told);
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:wms cli:test'], 'the record keeps its last commit');

    // The next run tries the load once more: the feed's next output loads
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });
    const loaded = await run();
    assert.equal(loaded.result.success, true, loaded.told);
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:erp system:dataflow', '$load:wms cli:test']);
  });

  it('R54, ruling 27 — a load that fails leaves its run going: told at once, every other task follows edits, and once its feed moves it loads again, and the run ends completed', async () => {
    await loadedOnce({ failsOn: 'SO-9' });
    await save('P-2', 'Dane', 1n);
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-9': ['Nobody', 1n] });

    const gate = new GatedTaskRunner(runner, ['forecast']);
    const running = start({ runner: gate });
    await gate.launched('forecast');                      // on orders as it stands, with the save
    await running.until('failed orders.erp');             // told as it fails, while forecast runs
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });
    releaseAll(gate, 'forecast');                         // its result lands: the run looks, and the feed moved
    const result = await running.done;
    const { lines } = running;
    const told = lines.join('\n');

    assert.equal(result.success, true, `ruling 27: no fault stands at its end\n${told}`);
    assert.equal(result.failed, 0, told);
    assert.ok(lines.indexOf('failed orders.erp') < lines.indexOf('done forecast'), told);
    assert.ok(lines.includes('due orders.erp: its feed moved since its load failed'), told);
    assert.equal(count(lines, 'start orders.erp'), 2, told);
    assert.ok(lines.lastIndexOf('done orders.erp') < lines.lastIndexOf('done forecast'), 'the readers run after the load\'s commit');
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:erp system:dataflow', '$load:wms cli:test']);
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 5n, 'P-1, P-2, W-1, SO-1 and SO-2');
  });

  it('R53 — a feed that moves while its load runs: the load\'s commit stands, and it runs again on the feed\'s new output', async () => {
    await loadedOnce();
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });

    const gate = new GatedTaskRunner(runner, ['orders.erp']);
    const running = start({ runner: gate });
    await gate.launched('orders.erp');
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n], 'SO-3': ['Cedar', 4n] });
    releaseAll(gate, 'orders.erp');
    const result = await running.done;
    const told = running.lines.join('\n');

    assert.equal(result.success, true, told);
    assert.equal(count(running.lines, 'done orders.erp'), 2, told);
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:erp system:dataflow', '$load:erp system:dataflow', '$load:wms cli:test'],
      'the load made from SO-1 and SO-2 commits, and the one from all three after it');
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 5n);
  });

  it('R17 — a rollback that changes the source\'s entries while its load runs: the load starts again, saying why, and commits on the head the rollback left', async () => {
    await deployed();
    const wms = await deliverWms({ 'W-1': ['Cedar', 7n] });
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n] });
    await run();
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });

    const gate = new GatedTaskRunner(runner, ['orders.erp']);
    const running = start({ runner: gate });
    await gate.launched('orders.erp');
    // Back past the ERP's last load: its entries change, and its delivery is forgotten
    const rolled = await recordSystemCommit(storage, runner, repo, WS, 'orders', { name: '$rollback', target: { commit: wms.commit }, actor: 'ops@example.com' });
    assert.equal(rolled.kind, 'committed');
    releaseAll(gate, 'orders.erp');
    const result = await running.done;
    const told = running.lines.join('\n');

    assert.equal(result.success, true, told);
    assert.ok(running.lines.includes('due orders.erp: the entries of source \'erp\' changed under its load'), told);
    assert.equal(count(running.lines, 'start orders.erp'), 2, told);
    const chain = (await recordHistory(storage, repo, WS, 'orders')).map(({ commit }) => commit.mutation);
    assert.deepEqual(chain.slice(0, 3), ['$load:erp', '$rollback', '$load:erp'], 'one commit, on the rollback');
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 4n);
  });

  it('R55 — two loads of one record each commit on their own, and a reader running when both land runs once more, for both', async () => {
    await deployed({ wms: 'fed' });
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n] });
    await setRows(WMS_ROWS, { 'W-1': ['Cedar', 7n] });
    const first = await run();
    assert.equal(first.result.success, true, first.told);
    await save('P-2', 'Dane', 1n);
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });
    await setRows(WMS_ROWS, { 'W-1': ['Cedar', 7n], 'W-2': ['Elm', 3n] });

    const gate = new GatedTaskRunner(runner, ['forecast', 'orders.erp', 'orders.wms']);
    const running = start({ runner: gate });
    await Promise.all([gate.launched('forecast'), gate.launched('orders.erp'), gate.launched('orders.wms')]);
    releaseAll(gate, 'orders.wms');
    await running.until('done orders.wms');
    releaseAll(gate, 'orders.erp');
    await running.until('done orders.erp');
    releaseAll(gate, 'forecast');
    const result = await running.done;
    const told = running.lines.join('\n');

    assert.equal(result.success, true, told);
    assert.equal(count(running.lines, 'start forecast'), 2, `once on the save, and once more for both loads\n${told}`);
    const loaded = await loads();
    assert.equal(loaded.length, 4);
    assert.deepEqual(loaded.slice(0, 2), ['$load:erp system:dataflow', '$load:wms system:dataflow'], 'a commit each');
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 6n);
  });

  it('R56 — a load\'s commit runs outside the run\'s lock on its state: another task\'s result lands while the commit is under way', async () => {
    await loadedOnce();
    await save('P-2', 'Dane', 1n);
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });

    const held = holdingOrders('writeIf');
    const gate = new GatedTaskRunner(runner, ['forecast', 'orders.erp']);
    const running = start({ runner: gate, storage: held.storage });
    await Promise.all([gate.launched('forecast'), gate.launched('orders.erp')]);
    held.arm();
    releaseAll(gate, 'orders.erp');
    await held.reached;                                   // the load's commit writes, held
    releaseAll(gate, 'forecast');
    await running.until('done forecast');                 // forecast's result lands meanwhile
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:wms cli:test'], 'the commit has not written');
    held.allow();
    const result = await running.done;
    const told = running.lines.join('\n');

    assert.equal(result.success, true, told);
    assert.equal(count(running.lines, 'start forecast'), 2, 'once more, on the load\'s commit');
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:erp system:dataflow', '$load:wms cli:test']);
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 5n);
  });

  it('R56 — a yield stops a load\'s commit under way before its write, and waits for it; the next run loads the feed, its work from the cache, and commits once', async () => {
    await loadedOnce();
    await save('P-2', 'Dane', 1n);
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });

    const held = holdingOrders('readVersioned');
    const gate = new GatedTaskRunner(runner, ['forecast', 'orders.erp']);
    const asked = gated<void>();
    let yieldNow = false;
    const running = start({
      runner: gate, storage: held.storage, shouldYield: () => {
        if (yieldNow) asked.open();
        return yieldNow;
      },
    });
    await Promise.all([gate.launched('forecast'), gate.launched('orders.erp')]);
    held.arm();
    releaseAll(gate, 'orders.erp');
    await held.reached;                                   // the load's commit reads the record's head, held
    yieldNow = true;
    releaseAll(gate, 'forecast');                         // its result lands, and the loop's next pass yields
    await asked.opened;
    held.allow();
    const yielded = await running.done;

    assert.equal(yielded.yielded, true, running.lines.join('\n'));
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:wms cli:test'], 'nothing written after the yield');
    const next = await run();
    assert.equal(next.result.success, true, next.told);
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:erp system:dataflow', '$load:wms cli:test'], 'committed once');
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 5n);
  });

  it('R56 — a cancel stops a load\'s commit under way before its write: nothing commits, and the run ends cancelled', async () => {
    await loadedOnce();
    await setRows(ERP_ROWS, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 1n] });

    const held = holdingOrders('readVersioned');
    const gate = new GatedTaskRunner(runner, ['orders.erp']);
    const stop = new AbortController();
    const running = start({ runner: gate, storage: held.storage, signal: stop.signal });
    await gate.launched('orders.erp');
    held.arm();
    releaseAll(gate, 'orders.erp');
    await held.reached;
    stop.abort();
    held.allow();
    await assert.rejects(running.done, DataflowAbortedError);
    assert.deepEqual(await loads(), ['$load:erp system:dataflow', '$load:wms cli:test'], 'nothing committed');
  });

  it('R57 — a filter on a reader loads nothing, a filter on the load runs it and its feed, and a forced load runs past the slots and commits only a delta that changes something', async () => {
    await loadedOnce();

    const reader = await run({ filter: 'forecast' });
    assert.ok(!reader.lines.some((line) => line.endsWith(' orders.erp')), reader.told);
    const load = await run({ filter: 'orders.erp' });
    assert.ok(load.lines.includes('cached combine_erp') && load.lines.includes('cached orders.erp'), load.told);
    assert.ok(!load.lines.some((line) => line.endsWith(' forecast')), load.told);

    // Forced, while the warehouse delivers: the ERP's delta changes nothing, so
    // nothing commits, and the record holds the ERP's delivery as before
    const gate = new GatedTaskRunner(runner, ['orders.erp']);
    const forcing = start({ runner: gate, force: ['orders.erp'] });
    await gate.launched('orders.erp');
    await deliverWms({ 'W-1': ['Cedar', 7n], 'W-2': ['Elm', 3n] });
    releaseAll(gate, 'orders.erp');
    const forced = await forcing.done;
    const told = forcing.lines.join('\n');
    assert.equal(forced.success, true, told);
    assert.deepEqual(forcing.lines.filter((line) => line.endsWith(' orders.erp')), ['start orders.erp', 'done orders.erp'],
      `run once, past the slots; the warehouse's commit since leaves the ERP's delivery held\n${told}`);
    assert.deepEqual(await loads(), ['$load:wms cli:test', '$load:erp system:dataflow', '$load:wms cli:test'], 'the ERP\'s delta changed nothing: no commit');
    assert.equal(await workspaceGetDataset(storage, repo, WS, FORECAST), 4n, 'forecast ran on the warehouse\'s delivery');
  });

  it('R29 — a fed load\'s commit names the versions its feed was made from, as East prints them; a delivery `e3 load` sent names none', async () => {
    await loadedOnce();
    const { versions } = await refOf('orders');
    const rows = await storage.datasets.read(repo, WS, 'inputs/erp_rows');
    if (rows === null || rows.type !== 'value') assert.fail('erp_rows holds no value');
    const feed = new Map([['.inputs.erp_rows', rows.value.hash]]);
    const slot = versions.get(sourceLoadSlots('erp').feed);
    assert.equal(slot, printFor(VersionVectorType)(feed), 'printed through East');
    const read = parseVersions(slot ?? '');
    assert.ok(read.success && sameVersions(read.value, feed), 'and read back through East');
    assert.equal(versions.get(sourceLoadSlots('wms').feed), undefined, 'the warehouse\'s delivery came from no feed');
  });

  it('R42 — a task that reads a fed record and its feed\'s upstream reads the upstream as the record\'s delivery was made from it, while the load runs, and again once it commits', async () => {
    await loadedBook();
    await save('P-2', 'Dane', 1n);
    await putBook('SO-2', 'Birch', 4n);

    const gate = new GatedTaskRunner(runner, ['orders.erp']);
    const running = start({ runner: gate });
    await gate.launched('orders.erp');
    await running.until('done reconcile');
    // The book is read where orders' ERP entries came from: one order, beside orders' three
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('reconcile')), 103n, running.lines.join('\n'));
    releaseAll(gate, 'orders.erp');
    const result = await running.done;
    const told = running.lines.join('\n');

    assert.equal(result.success, true, told);
    assert.equal(count(running.lines, 'done reconcile'), 2, told);
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('reconcile')), 204n, 'the book\'s two orders, beside orders\' four, once the load committed');
  });

  it('carries the versions the feed was made from in the run while its output is the record\'s delivery: a reader of the record and the feed\'s upstream reads the upstream as it is now', async () => {
    await loadedBook();
    // An order the ERP's feed leaves out: the book moves, and the delivery stays as it was
    await putBook('SO-0', 'Nobody', 0n);
    const { result, lines, told } = await run();

    assert.equal(result.success, true, told);
    assert.ok(lines.includes('cached orders.erp') && !lines.includes('start orders.erp'), told);
    assert.deepEqual((await loads()).filter((each) => each.startsWith('$load:erp')), ['$load:erp system:dataflow'], 'no second load');
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('reconcile')), 202n, `the book as it is now, beside orders\n${told}`);
  });

  it('R44 — a rollback that forgets a fed delivery defers a reader of the record and its feed\'s upstream until the load commits again, saying so; a reader of the record alone runs on it', async () => {
    await loadedBook();
    await putBook('SO-2', 'Birch', 4n);
    await run();
    const history = (await recordHistory(storage, repo, WS, 'orders')).filter(({ commit }) => commit.mutation === '$load:erp');
    const first = history.at(-1)!.hash;
    const rolled = await recordSystemCommit(storage, runner, repo, WS, 'orders', { name: '$rollback', target: { commit: first }, actor: 'ops@example.com' });
    assert.equal(rolled.kind, 'committed');

    // The load runs again, its work from the cache, and its commit's write is held
    const held = holdingOrders('writeIf');
    held.arm();
    const running = start({ storage: held.storage });
    await held.reached;
    await running.until('defer reconcile: forgotten .records.orders.erp (.records.erp_book)');
    // forecast reads orders alone, as the rollback left it: as it stood after the first load
    await running.until('cached forecast');
    held.allow();
    const result = await running.done;
    const { lines } = running;
    const told = lines.join('\n');

    assert.equal(result.success, true, told);
    assert.equal(count(lines, 'defer reconcile: forgotten .records.orders.erp (.records.erp_book)'), 1, `told once\n${told}`);
    assert.ok(lines.includes('start orders.erp') && lines.includes('cached orders.erp'), `the load ran again, from the cache\n${told}`);
    assert.ok(lines.indexOf('cached forecast') < lines.indexOf('cached orders.erp'), 'forecast ran on orders as the rollback left it');
    const reconciled = Math.max(lines.lastIndexOf('done reconcile'), lines.lastIndexOf('cached reconcile'));
    assert.ok(lines.indexOf('cached orders.erp') < reconciled, `reconcile ran once the load committed\n${told}`);
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('reconcile')), 203n);
  });

  it('R45 — two fed records carrying different versions of one upstream defer their reader until the loads catch up, saying so', async () => {
    await loadedBook();
    await putBook('SO-2', 'Birch', 4n);

    const gate = new GatedTaskRunner(runner, ['orders.erp']);
    const running = start({ runner: gate });
    await gate.launched('orders.erp');
    await running.until('defer audit: carried .records.erp_book (.records.orders.erp, .records.invoices.erp)');
    releaseAll(gate, 'orders.erp');
    const result = await running.done;
    const told = running.lines.join('\n');

    assert.equal(result.success, true, told);
    assert.ok(running.lines.indexOf('done orders.erp') < running.lines.lastIndexOf('done audit'), told);
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('audit')), 302n, 'orders\' three, beside invoices\' two');
  });

  it('R45 — a fed record read beside the input that feeds it defers its reader once the input moved, until the load commits the new value, saying so', async () => {
    await deployedBook({ feed: 'extract' });
    await setRows(ERP_EXTRACT, { 'SO-1': ['Acme', 5n] });
    const first = await run();
    assert.equal(first.result.success, true, first.told);
    await setRows(ERP_EXTRACT, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 4n] });

    const gate = new GatedTaskRunner(runner, ['orders.erp']);
    const running = start({ runner: gate });
    await gate.launched('orders.erp');
    await running.until('defer check: feed .inputs.erp_extract (.records.orders.erp)');
    releaseAll(gate, 'orders.erp');
    const result = await running.done;
    const told = running.lines.join('\n');

    assert.equal(result.success, true, told);
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('check')), 203n, 'the input\'s two orders, beside orders\' three');
  });

  it('ruling 29 — a reader only a load\'s commit would decide waits on that load where the run\'s filter leaves the load out, and the run ends', async () => {
    await deployedBook({ feed: 'extract' });
    await setRows(ERP_EXTRACT, { 'SO-1': ['Acme', 5n] });
    const first = await run();
    assert.equal(first.result.success, true, first.told);
    await setRows(ERP_EXTRACT, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 4n] });

    // The filter loads nothing (R57): check waits on the load, and says so
    const { result, lines, told } = await run({ filter: 'check' });
    assert.equal(result.success, true, told);
    assert.deepEqual(lines, ['wait check: upstream .records.orders (orders.erp)']);
    assert.equal(result.waiting, 1, told);

    // The next run loads the input, and check runs on the record it leaves
    const loaded = await run();
    assert.equal(loaded.result.success, true, loaded.told);
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('check')), 203n, 'the input\'s two orders, beside orders\' three');
  });

  it('ruling 29 — a reader deferred until a load commits waits on the load once it fails: the run ends failed, naming the load, and the reader runs once the load commits', async () => {
    await deployedBook({ feed: 'extract', failsOn: 'SO-9' });
    await setRows(ERP_EXTRACT, { 'SO-1': ['Acme', 5n] });
    const first = await run();
    assert.equal(first.result.success, true, first.told);
    await setRows(ERP_EXTRACT, { 'SO-1': ['Acme', 5n], 'SO-9': ['Nobody', 1n] });

    const failed = await run();
    assert.equal(failed.result.success, false, failed.told);
    assert.deepEqual([failed.result.failed, failed.result.waiting], [1, 1], failed.told);
    const at = (line: string): number => failed.lines.indexOf(line);
    assert.ok(at('failed orders.erp') >= 0 && at('failed orders.erp') < at('wait check: upstream .records.orders (orders.erp)'), failed.told);
    assert.match(failed.errors.get('orders.erp') ?? '', /the ERP sent order SO-9/, failed.told);

    await setRows(ERP_EXTRACT, { 'SO-1': ['Acme', 5n], 'SO-2': ['Birch', 4n] });
    const loaded = await run();
    assert.equal(loaded.result.success, true, loaded.told);
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('check')), 203n);
  });

  it('ruling 30 — a version a fed record carries that the store no longer holds is read as unknown: a reader of the record and that upstream is deferred until the load commits', async () => {
    await loadedBook();
    const cut = (await refOf('erp_book')).versions.get('.records.erp_book')!;
    await putBook('SO-2', 'Birch', 4n);

    // A compaction cut the book's earlier commit and a sweep took it: the store holds it no more
    const isCut = (hash: string): boolean => equalFor(StringType)(hash, cut);
    const objects = overriding(storage.objects, {
      touch: async (...args: Parameters<StorageBackend['objects']['touch']>) => {
        const held = await storage.objects.touch(...args);
        return args[1].map((hash, at) => !isCut(hash) && held[at] === true);
      },
      read: async (...args: Parameters<StorageBackend['objects']['read']>) => {
        if (isCut(args[1])) throw new ObjectNotFoundError(cut);
        return storage.objects.read(...args);
      },
    });
    const gate = new GatedTaskRunner(runner, ['orders.erp']);
    const running = start({ runner: gate, storage: withStores(storage, { objects }) });
    await gate.launched('orders.erp');
    // orders still holds the delivery made from the commit that is gone: nothing says which book it holds
    await running.until('defer reconcile: forgotten .records.orders.erp (.records.erp_book)');
    releaseAll(gate, 'orders.erp');
    const result = await running.done;
    const told = running.lines.join('\n');

    assert.equal(result.success, true, told);
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('reconcile')), 203n, `the book's two orders, beside orders' three\n${told}`);
  });

  it('ruling 31 — one record\'s sources holding deliveries made from different versions of an upstream: a reader of the record alone runs, and one that reads the upstream too is deferred until the slower load catches up, naming the two', async () => {
    await deployedBook({ feed: 'twice' });
    const first = await run();
    assert.equal(first.result.success, true, first.told);
    await putBook('SO-2', 'Birch', 4n);

    // erp's load commits from the book's new order while inv's is held: the two sources carry different versions of the book
    const gate = new GatedTaskRunner(runner, ['orders.inv']);
    const running = start({ runner: gate });
    await gate.launched('orders.inv');
    await running.until('defer reconcile: carried .records.erp_book (.records.orders.erp, .records.orders.inv)');
    await running.until('done forecast');
    releaseAll(gate, 'orders.inv');
    const result = await running.done;
    const { lines } = running;
    const told = lines.join('\n');

    assert.equal(result.success, true, told);
    assert.ok(!lines.some((line) => line.startsWith('defer forecast')), `forecast reads orders alone, and is never deferred\n${told}`);
    assert.ok(lines.indexOf('done orders.erp') < lines.indexOf('done forecast') && lines.indexOf('done forecast') < lines.indexOf('done orders.inv'),
      `it ran on the record as erp's commit left it\n${told}`);
    assert.equal(await workspaceGetDataset(storage, repo, WS, outputOf('reconcile')), 205n, 'the book\'s two orders, beside orders\' five');
  });

  it('F45 — a workspace made from a bundle holds each fed load\'s execution its record names, and answers its loads [CACHED]', async () => {
    await loadedOnce();
    const into = createTestRepo();
    try {
      const made = new LocalStorage();
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      await Promise.all([workspaceBundleExport(storage, repo, WS, writable), workspaceBundleImport(made, into, 'copy', readable)]);
      const at = { repo: into, ws: 'copy' };

      const node = (await dataflowGetGraph(made, into, 'copy')).tasks.find((task) => task.name === 'orders.erp')!;
      const execution = sourceExecution((await refOf('orders', made, at)).versions, 'erp');
      assert.ok(execution !== null, 'the record names its load\'s execution');
      const status = await made.refs.executionGet(into, node.hash, execution.inputsHash, execution.executionId);
      assert.equal(status?.type, 'success', 'and the bundle carried it');

      const { result, lines, told } = await run({ storage: made, runner: new LocalTaskRunner(into), at });
      assert.equal(result.success, true, told);
      assert.ok(lines.includes('cached orders.erp') && !lines.includes('start orders.erp'), told);
    } finally {
      removeTestRepo(into);
    }
  });

  it('R59 — history\'s prune keeps a load node\'s current execution, the one its record\'s slot names, though no run it keeps names it', async () => {
    await loadedOnce();
    // The workspace's current run names no load
    const filtered = await run({ filter: 'forecast' });
    assert.equal(filtered.result.success, true, filtered.told);
    const node = (await dataflowGetGraph(storage, repo, WS)).tasks.find((task) => task.name === 'orders.erp')!;
    const execution = sourceExecution((await refOf('orders')).versions, 'erp');
    assert.ok(execution !== null, 'the record names its load\'s execution');

    await pruneHistory(storage, repo, { keepRuns: 0, keepDays: 0, dryRun: false }, Date.now() + 1);
    const status = await storage.refs.executionGet(repo, node.hash, execution.inputsHash, execution.executionId);
    assert.equal(status?.type, 'success', 'the load\'s execution is kept');
    const { lines, told } = await run();
    assert.ok(lines.includes('cached orders.erp'), told);
  });
});
