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
import { StringType, encodeBeast2For, variant, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { TreePath } from '@elaraai/e3-types';
import type { OrchestratorStartOptions } from './dataflow/orchestrator/interfaces.js';
import type { FinalizeResult, InputWait } from './dataflow/types.js';
import { DataflowAbortedError } from './errors.js';
import type { TaskRunner } from './execution/interfaces.js';
import { LocalOrchestrator } from './execution/local-orchestrator.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { packageImport } from './package-files.js';
import { recordHistory, recordMutate, recordSystemCommit } from './records.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { workspaceGetDataset, workspaceSetDataset } from './trees.js';
import { workspaceCreate, workspaceDeploy } from './workspaces.js';
import {
  ErpDeliveryType, GatedTaskRunner, SourcedOrderType, createTempDir, createTestRepo, fedOrders, gated, overriding, removeTempDir,
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
const FORECAST: TreePath = [variant('field', 'tasks'), variant('field', 'forecast'), variant('field', 'output')];

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
    const { runner: on = runner, storage: over = storage, ...rest } = options;
    const orchestrator = new LocalOrchestrator();
    const done = orchestrator.start(over, repo, WS, {
      ...rest,
      runner: on,
      onTaskStart: (name) => tell(`start ${name}`),
      onTaskComplete: (task) => {
        if (task.error !== undefined) errors.set(task.name, task.error);
        tell(`${task.state === 'success' ? (task.cached ? 'cached' : 'done') : task.state} ${task.name}`);
      },
      onTaskWaiting: (name, waits) => tell(`wait ${name}: ${waits.map(waitWords).join(', ')}`),
      onTaskInvalidated: (name, reason) => tell(`due ${name}: ${reason}`),
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
    // forecast waits for erp's first delivery, and runs once the load commits
    assert.ok(lines.includes('wait forecast: pending .records.orders (erp)'), told);
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
});
