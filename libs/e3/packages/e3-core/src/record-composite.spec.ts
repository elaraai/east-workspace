/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A composite record in a workspace: one record over several sources, each
 * the authority for its own entries. An external source's entries are written
 * only by its load, so a mutation, a patch or a call's draft that names one is
 * refused as `invalid`, naming the key and the source, and nothing is written
 * — on the patch door, where no program runs, and where the mutation's
 * program runs alike.
 *
 * And what its ref keeps of its external sources: which wait for a first
 * delivery once a source is handed to its load, or a migration makes the
 * record composite, and what a compaction leaves of a delivery. While one
 * waits, a task that reads the record, or an index of it, waits too, and a
 * function that declares it ends its call `invalid`.
 *
 * Each case is titled by the requirement of the design it checks.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import {
  DictType, East, IntegerType, NullType, PatchType, SortedMap, StringType, StructType, VariantType,
  compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, variant,
  type PatchTypeOf, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  ExecuteResultType, MutationObjectType, decodeRecordLoadObject, decodeTaskObject, type ExecuteResult, type FunctionDraft, type RecordSource,
} from '@elaraai/e3-types';
import type { InputWait } from './dataflow/types.js';
import { readDatasetWhole } from './dataset-open.js';
import { packageImport } from './package-files.js';
import { packageRead } from './packages.js';
import { EXTERNAL_SLOT, PENDING_SLOT, sourceLoadSlots } from './record-slots.js';
import { repoGc } from './gc.js';
import { readRecordState, recordCompact, recordDraftMutation, recordHistory, recordMutate, resolveRecord } from './records.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import type { StorageBackend } from './storage/interfaces.js';
import { LocalStorage } from './storage/local/index.js';
import { createTempDir, createTestRepo, ran, removeTempDir, removeTestRepo, sourceDelivered } from './test-helpers.js';
import { workspaceCreate, workspaceDeploy } from './workspaces.js';
import { workspaceStatus } from './workspaceStatus.js';
import { dataflowExecute } from './execution/local-orchestrator.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { MockTaskRunner } from './execution/MockTaskRunner.js';
import { functionCallRun, functionCallStart, functionCallStatus } from './execution/functionCall.js';
import { functionCallUnkept } from './execution/functionCallUnkept.js';

const REPO = 'r';
const WS = 'main';

const Order = StructType({ customer: StringType, qty: IntegerType });
/** A source's entries by its own key: what the ERP delivers, and what its load patches. */
const Entries = DictType(StringType, Order);
const OrdersKey = VariantType({ erp: StringType, own: StringType });
const Orders = DictType(OrdersKey, Order);
type OrderRow = ValueTypeOf<typeof Order>;
type OrderKey = ValueTypeOf<typeof OrdersKey>;
/** What one touched key of a patch of the orders carries, derived from the patch type. */
type OrderOp = Extract<ValueTypeOf<PatchTypeOf<typeof Orders>>, { type: 'patch' }>['value'] extends Map<OrderKey, infer Op> ? Op : never;

const encodeKey = encodeBeast2For(OrdersKey);
const encodeOrder = encodeBeast2For(Order);
const encodeString = encodeBeast2For(StringType);
const encodeInt = encodeBeast2For(IntegerType);
const encodePatch = encodeBeast2For(PatchType(Orders));
const decodeOrders = decodeBeast2For(Orders);
const sameOrders = equalFor(Orders);
const sameResult = equalFor(ExecuteResultType);

/** A record's ref in a workspace, once it holds a state: the state's hash, and its version vector. */
async function heldRef(storage: StorageBackend, repo: string, ws: string, record: string): Promise<{ hash: string; versions: Map<string, string> }> {
  const ref = await storage.datasets.read(repo, ws, `records/${record}`);
  if (ref === null || ref.type !== 'value') assert.fail(`record ${record} holds no state`);
  return ref.value;
}

/** A patch of the orders: each touched key's op. */
function ordersPatch(ops: Array<[OrderKey, OrderOp]>): Uint8Array {
  return encodePatch(variant('patch', new SortedMap<OrderKey, OrderOp>(ops, compareFor(OrdersKey))));
}

const acme: OrderRow = { customer: 'Acme', qty: 5n };
const birch: OrderRow = { customer: 'Birch', qty: 2n };
/** An order of the ERP's, as the design's refusal names it, and one of the solution's own. */
const ERP_ORDER: OrderKey = variant('erp', 'SO-1001');
const OWN_ORDER: OrderKey = variant('own', 'P-1');

/** The words every door refuses a write of the ERP's order in. */
const refusal = (mutation: string): string =>
  `mutation '${mutation}' writes .erp "SO-1001", an entry of source 'erp', which only its load writes`;

// The ERP's whole order book, keyed by its own order id.
const loadErp = East.function([Entries, Entries], PatchType(Entries), (_$, delivery, current) => East.diff(current, delivery));

/**
 * A version of the package the cases with no process deploy: `notes`, a
 * composite with no index, so a patch of it is its own delta and no program
 * runs, and a function that lists it as a record a call may draft.
 *
 * In `1.0.0` the ERP's orders are entered by hand, and the record holds one;
 * `2.0.0` loads them. A workspace that deploys one after the other holds an
 * external source with rows, which waits for no first delivery.
 */
function notesPackage(version: '1.0.0' | '2.0.0'): ReturnType<typeof e3.package> {
  const notes = version === '1.0.0'
    ? e3.recordComposite('notes', Order, {
      sources: (source) => ({ erp: source.mutations(StringType), own: source.mutations(StringType) }),
      initial: { erp: new Map([['SO-1001', acme]]), own: new Map([['P-1', birch]]) },
      mutations: (mutation) => ({ patch: mutation.patch() }),
    })
    : e3.recordComposite('notes', Order, {
      sources: (source) => ({ erp: source.load(StringType, Entries, loadErp), own: source.mutations(StringType) }),
      initial: { own: new Map([['P-1', birch]]) },
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
  const count = e3.function('count', { inputs: [notes], drafts: [notes], args: [], output: IntegerType }, ($, notes) => notes.size());
  // Declares no input: its caller names the orders it is given
  const sized = e3.function('sized', { inputs: [], args: [Orders], output: IntegerType }, ($, given) => given.size());
  // A task over the record: every order, whichever source it is of
  const tally = e3.task('tally', [notes], East.function([Orders], IntegerType, ($, held) => held.size()));
  return e3.package('notes', version, notes, count, sized, tally);
}

/**
 * The package the cases on the real runner deploy: `orders`, loaded from the
 * ERP from its first deploy, with an index, so every write of it runs its
 * program.
 */
function ordersPackage(): ReturnType<typeof e3.package> {
  const orders = e3.recordComposite('orders', Order, {
    sources: (source) => ({ erp: source.load(StringType, Entries, loadErp), own: source.mutations(StringType) }),
    initial: { own: new Map([['P-1', birch]]) },
    indexes: (index) => ({ by_customer: index.on(['customer']) }),
    mutations: (mutation, { state, key, edit }) => ({
      // Each writes an entry by a key its caller passes
      plan: mutation.edit(East.function([state, StringType, Order, edit], NullType, ($, _orders, id, order, edit) => {
        $(edit.set(variant('own', id), order));
      })),
      // The capability over every key, which a body may still declare: e3 holds its writes to the record's own sources
      write: mutation.edit(East.function([state, key, Order, e3.mutation.editType(state)], NullType, ($, _orders, at, order, edit) => {
        $(edit.set(at, order));
      })),
      file: mutation.reduce(East.function([state, key, Order], state, ($, orders, at, order) => {
        const next = $.let(orders.copy());
        $(next.insertOrUpdate(at, order));
        return next;
      })),
      patch: mutation.patch(),
    }),
  });
  // Each reads the record through its index alone: a function, and a task
  const byCustomer = e3.index(orders.indexes.by_customer);
  const customers = e3.function('customers', { inputs: [byCustomer], args: [], output: IntegerType }, ($, entries) => entries.size());
  const served = e3.task('served', [byCustomer], East.function([byCustomer.type], IntegerType, ($, entries) => entries.size()));
  return e3.package('orders', '1.0.0', orders, customers, served);
}

/** The key of `book` once it is a composite: the source each order is of. */
const BookKey = VariantType({ erp: StringType, own: StringType, wms: StringType });
const Book = DictType(BookKey, Order);

/**
 * A version of the package whose record `book` becomes a composite from rows
 * it already holds.
 * - `1.0.0`: a record of the ERP's orders by their id, holding two
 * - `2.0.0`: a composite over `erp`, `wms` and `own`, each row put under `erp`
 *   by a `rekey` step, and indexed by customer
 * - `2.1.0`: `own` handed to a load of its own too
 */
function bookPackage(version: '1.0.0' | '2.0.0' | '2.1.0'): ReturnType<typeof e3.package> {
  if (version === '1.0.0') {
    return e3.package('book', version, e3.record('book', Entries, { initial: new Map([['SO-1001', acme], ['SO-1002', birch]]) }));
  }
  const book = version === '2.0.0'
    ? e3.recordComposite('book', Order, {
      sources: (source) => ({
        erp: source.load(StringType, Entries, loadErp), wms: source.load(StringType, Entries, loadErp), own: source.mutations(StringType),
      }),
      indexes: (index) => ({ by_customer: index.on(['customer']) }),
      migrations: (migration, { key }) => [
        migration.rekey('by_source', East.function([StringType, Order], StructType({ key, value: Order }),
          ($, id, order) => ({ key: variant('erp', id), value: order }))),
      ],
    })
    : e3.recordComposite('book', Order, {
      sources: (source) => ({
        erp: source.load(StringType, Entries, loadErp), wms: source.load(StringType, Entries, loadErp), own: source.load(StringType, Entries, loadErp),
      }),
      indexes: (index) => ({ by_customer: index.on(['customer']) }),
      migrations: (migration, { key }) => [
        migration.rekey('by_source', East.function([StringType, Order], StructType({ key, value: Order }),
          ($, id, order) => ({ key: variant('erp', id), value: order }))),
      ],
    });
  return e3.package('book', version, book);
}

describe('a composite record: an external entry is never written (no program runs for a patch of a record with no index)', () => {
  let dir: string;
  let storage: InMemoryStorage;
  let runner: MockTaskRunner;

  beforeEach(async () => {
    dir = createTempDir();
    storage = new InMemoryStorage();
    runner = new MockTaskRunner();
    runner.setDetachedResult(ran({ kind: 'success', value: encodeInt(0n) }));
    await storage.repos.create(REPO);
    // The ERP's order entered by hand, and then the source handed to its load
    for (const version of ['1.0.0', '2.0.0'] as const) {
      const zip = join(dir, `notes-${version}.zip`);
      await e3.export(notesPackage(version), zip);
      await packageImport(storage, REPO, zip);
      await workspaceDeploy(storage, REPO, WS, 'notes', version);
    }
  });

  afterEach(() => removeTempDir(dir));

  /** What the record holds, read whole. */
  const held = async (record: string): Promise<ValueTypeOf<typeof Orders>> =>
    decodeOrders(await readDatasetWhole(storage, REPO, (await readRecordState(storage, REPO, (await heldRef(storage, REPO, WS, record)).hash)).primary));
  const patch = (ops: Array<[OrderKey, OrderOp]>) =>
    recordMutate(storage, runner, REPO, WS, 'notes', 'patch', [ordersPatch(ops)], { actor: 'ada@example.com' });

  it('R4 — a patch that names an entry of an external source is refused as invalid, naming the key and the source, and nothing is written', async () => {
    const before = await storage.datasets.read(REPO, WS, 'records/notes');
    const commits = (await recordHistory(storage, REPO, WS, 'notes')).length;

    // $ e3 mutate . notes.patch '…' -w main
    // invalid: mutation 'patch' writes .erp "SO-1001", an entry of source 'erp', which only its load writes
    assert.deepEqual(await patch([[ERP_ORDER, variant('delete', acme)]]), { kind: 'invalid', message: refusal('patch') });
    // An insert of one is refused in the same words, before the state is asked whether it holds the entry
    assert.deepEqual(await patch([[ERP_ORDER, variant('insert', acme)]]), { kind: 'invalid', message: refusal('patch') });
    // And a patch of the solution's own entry beside it is refused whole
    assert.deepEqual(await patch([[ERP_ORDER, variant('delete', acme)], [variant('own', 'P-2'), variant('insert', acme)]]),
      { kind: 'invalid', message: refusal('patch') });

    assert.deepEqual(await storage.datasets.read(REPO, WS, 'records/notes'), before, 'the record stands where it stood');
    assert.equal((await recordHistory(storage, REPO, WS, 'notes')).length, commits, 'no commit joined its history');
    assert.equal(runner.getCalls().length, 0, 'and no program ran: the patch is its own delta');
  });

  it('R4 — a patch of the solution\'s own entries commits, as any record\'s does', async () => {
    const outcome = await patch([[variant('own', 'P-2'), variant('insert', acme)], [OWN_ORDER, variant('delete', birch)]]);
    assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
    assert.ok(sameOrders(await held('notes'), new SortedMap<OrderKey, OrderRow>([[ERP_ORDER, acme], [variant('own', 'P-2'), acme]], compareFor(OrdersKey))),
      'beside the ERP\'s order, which stands');
    assert.equal(runner.getCalls().length, 0, 'with no program');
  });

  it('R4 — a mutation that would write a record with sources whole is refused: its package mixes two builds', async () => {
    // What e3.recordComposite never exports, another exporter could write: a mutation that names no program
    const whole = await storage.objects.write(REPO, encodeBeast2For(MutationObjectType)({
      bodyIr: 'b'.repeat(64), argTypes: [], runner: variant('east_c', { platforms: [], decode: variant('lazy', null) }),
      form: variant('reduce', null), programIr: '', cases: none,
    }));
    const sources = new Map<string, RecordSource>([['erp', variant('load', 'c'.repeat(64))], ['own', variant('mutations', null)]]);
    assert.deepEqual(await recordDraftMutation(storage, REPO, { mutations: new Map([['rewrite', whole]]), indexes: new Map(), sources }, 'notes', 'rewrite', []),
      { invalid: 'mutation \'rewrite\' writes record \'notes\' whole, and the record has sources: re-export its package' });
    assert.deepEqual(await recordDraftMutation(storage, REPO, { mutations: new Map([['rewrite', whole]]), indexes: new Map(), sources: new Map() }, 'count', 'rewrite', []),
      { mutation: whole }, 'a record with no sources, and no index, is written whole as before');
  });

  it('R79 — a source handed to its load while it holds rows counts as delivered, and one handed over holding none waits for its first delivery', async () => {
    // The ERP's order was entered by hand, and the source then handed to its load
    const handed = (await heldRef(storage, REPO, WS, 'notes')).versions;
    assert.deepEqual([handed.has(PENDING_SLOT), handed.get(EXTERNAL_SLOT)], [false, 'erp'], 'its row is the load\'s now: nothing waits');
    assert.deepEqual((await recordHistory(storage, REPO, WS, 'notes')).map(({ commit }) => commit.mutation), ['$deploy', '$init']);

    // In another workspace the order is deleted first, as a solution source's entry may be
    const other = 'other';
    await workspaceDeploy(storage, REPO, other, 'notes', '1.0.0');
    const deleted = await recordMutate(storage, runner, REPO, other, 'notes', 'patch', [ordersPatch([[ERP_ORDER, variant('delete', acme)]])], { actor: 'ada@example.com' });
    assert.equal(deleted.kind, 'committed', JSON.stringify(deleted));
    await workspaceDeploy(storage, REPO, other, 'notes', '2.0.0');
    const emptied = (await heldRef(storage, REPO, other, 'notes')).versions;
    assert.deepEqual([emptied.get(PENDING_SLOT), emptied.get(EXTERNAL_SLOT)], ['erp', 'erp']);
  });

  it('R32 — a compaction empties the commit a source\'s last delivery names, and keeps the delivery', async () => {
    const applied = await sourceDelivered(storage, REPO, WS, 'records/notes', 'erp', '2026-11-02T03:00:00.000');
    const saved = await patch([[variant('own', 'P-2'), variant('insert', acme)]]);
    assert.equal(saved.kind, 'committed', JSON.stringify(saved));
    const slots = sourceLoadSlots('erp');
    const before = (await heldRef(storage, REPO, WS, 'notes')).versions;
    assert.equal(before.get(slots.commit), applied, 'a Save carries the delivery\'s slots as they are');

    const compacted = await recordCompact(storage, REPO, WS, 'notes', { actor: 'ada@example.com' });
    assert.equal(compacted.kind, 'committed', JSON.stringify(compacted));
    const after = (await heldRef(storage, REPO, WS, 'notes')).versions;
    assert.equal(after.get(slots.commit), '', 'the chain no longer holds the commit, and the slot names none');
    for (const slot of [slots.delivery, slots.load, slots.execution, slots.asOf, EXTERNAL_SLOT]) {
      assert.equal(after.get(slot), before.get(slot), `${slot} is carried`);
    }
    assert.deepEqual((await recordHistory(storage, REPO, WS, 'notes')).map(({ commit }) => commit.mutation), ['$compact']);
  });

  describe('while a record waits for a source\'s first delivery', () => {
    const LIMITS = { timeoutMs: 600_000, maxResultBytes: 1024, maxLogBytes: 64 };
    /** A workspace that deploys the loaded ERP source from the first: nothing has been delivered. */
    const FRESH = 'fresh';
    const waits = 'The function\'s input .records.notes waits for the first delivery of erp: a task reading it would wait too, and nothing ran';

    beforeEach(async () => {
      await workspaceDeploy(storage, REPO, FRESH, 'notes', '2.0.0');
      assert.equal((await heldRef(storage, REPO, FRESH, 'notes')).versions.get(PENDING_SLOT), 'erp');
    });

    it('R81 — a function that declares the record among its inputs ends its call invalid, naming the record and the sources yet to deliver, and nothing runs', async () => {
      const filed = await functionCallStart(storage, REPO, FRESH, 'count', { args: [], runner: none, limits: none, drafts: [] }, { caller: 'ada@example.com' });
      if (filed.call.state.type !== 'invalid') assert.fail(`the call was filed ${filed.call.state.type}`);
      assert.deepEqual(filed.call.state.value.diagnostics.map(({ message }) => message), [waits]);
      const unkept = await functionCallUnkept(storage, runner, REPO, FRESH, 'count', { args: [], drafts: [] }, { limits: LIMITS });
      if (unkept.outcome.type !== 'invalid') assert.fail(`the call ended ${unkept.outcome.type}`);
      assert.deepEqual(unkept.outcome.value.diagnostics.map(({ message }) => message), [waits], 'a call no store keeps is refused in the same words');
      assert.equal(runner.getDetachedCalls().length + runner.getCalls().length, 0, 'nothing ran');

      // The record holds its own entries all the while, and a Save of one commits
      const saved = await recordMutate(storage, runner, REPO, FRESH, 'notes', 'patch', [ordersPatch([[variant('own', 'P-2'), variant('insert', acme)]])], { actor: 'ada@example.com' });
      assert.equal(saved.kind, 'committed', JSON.stringify(saved));
      // In the workspace whose ERP source holds a row, the same call runs
      const ran = await functionCallUnkept(storage, runner, REPO, WS, 'count', { args: [], drafts: [] }, { limits: LIMITS });
      assert.equal(ran.outcome.type, 'success');
    });

    it('R27 — a task that reads the record waits, naming the sources yet to deliver, and the run goes on without it; it runs once the source has delivered', async () => {
      const tally = (await packageRead(storage, REPO, 'notes', '2.0.0')).tasks.get('tally')!;
      runner.setResult(tally, { state: 'success', cached: false, outputHash: 'tally-out' });
      const waiting: Array<[string, InputWait[]]> = [];
      const run = await dataflowExecute(storage, REPO, FRESH, { runner, onTaskWaiting: (task, waits) => waiting.push([task, waits]) });
      assert.deepEqual([run.success, run.executed, run.waiting], [true, 0, 1], JSON.stringify(run.tasks));
      assert.deepEqual(waiting, [['tally', [{ input: '.records.notes', kind: 'pending', sources: ['erp'] }]]]);
      assert.deepEqual(runner.getCalls(), [], 'nothing ran over the solution\'s own entries alone');
      const status = await workspaceStatus(storage, runner, REPO, FRESH);
      assert.deepEqual(status.tasks.find((task) => task.name === 'tally')?.status,
        { type: 'waiting', reason: 'record \'notes\' waits for the first delivery of erp' }, 'the status says so in the run\'s words');

      // The ERP delivers: the ref written as a load's commit leaves it, until a load does
      await sourceDelivered(storage, REPO, FRESH, 'records/notes', 'erp', '2026-11-02T03:00:00.000');
      const next = await dataflowExecute(storage, REPO, FRESH, { runner });
      assert.deepEqual([next.success, next.executed, next.waiting], [true, 1, 0], JSON.stringify(next.tasks));
      assert.deepEqual(runner.getCalls().map(({ taskHash, inputHashes }) => [taskHash, inputHashes]), [[tally, [(await heldRef(storage, REPO, FRESH, 'notes')).hash]]],
        'the task reads the record at the state it holds');

      // In the workspace whose ERP source was handed to its load holding a row, the task never waited
      const held = await dataflowExecute(storage, REPO, WS, { runner });
      assert.deepEqual([held.success, held.executed, held.waiting], [true, 1, 0], JSON.stringify(held.tasks));
    });

    it('R82 — a caller that names the record as a dataset argument reads it as it stands', async () => {
      const stood = await heldRef(storage, REPO, FRESH, 'notes');
      const notesPath = [variant('field', 'records'), variant('field', 'notes')];
      const result = await functionCallUnkept(storage, runner, REPO, FRESH, 'sized', { args: [variant('dataset', notesPath)], drafts: [] }, { limits: LIMITS });
      assert.equal(result.outcome.type, 'success', 'a person looking at the record sees their own entries before the first delivery');
      assert.deepEqual(runner.getDetachedCalls().map(({ args }) => args), [[{ dataset: stood.hash }]], 'the function is handed the record at the state it holds');
      assert.deepEqual(result.inputs.map(({ hash }) => hash), [stood.hash], 'which its result names');
    });
  });

  describe('a call\'s draft', () => {
    const LIMITS = { timeoutMs: 600_000, maxResultBytes: 1024, maxLogBytes: 64 };
    const draft = (...ops: Array<[OrderKey, OrderOp]>): FunctionDraft => ({ record: 'notes', mutation: 'patch', args: [ordersPatch(ops)] });
    /** A call a store keeps, run to its end: the job as it ended, and what it answers. */
    const kept = async (drafts: FunctionDraft[]) => {
      const filed = await functionCallStart(storage, REPO, WS, 'count', { args: [], runner: none, limits: none, drafts }, { caller: 'ada@example.com' });
      const { job, result } = await functionCallRun(storage, runner, REPO, WS, filed.call.id);
      if (job === null || result === null) assert.fail('the kept call answers its result');
      return { job, result };
    };
    const unkept = (drafts: FunctionDraft[]): Promise<ExecuteResult> =>
      functionCallUnkept(storage, runner, REPO, WS, 'count', { args: [], drafts }, { limits: LIMITS });
    /** The one diagnostic an invalid result carries. */
    const saidBy = (result: ExecuteResult): string => {
      if (result.outcome.type !== 'invalid') assert.fail(`the call ended ${result.outcome.type}`);
      assert.equal(result.outcome.value.diagnostics.length, 1);
      return result.outcome.value.diagnostics[0]!.message;
    };

    it('R84 — a draft that writes an external entry ends a kept call invalid in the Save\'s words, and its function does not run', async () => {
      const before = await storage.datasets.read(REPO, WS, 'records/notes');
      // A call that drafts the solution's own entry runs
      const ran = await kept([draft([variant('own', 'P-2'), variant('insert', acme)])]);
      assert.equal(ran.job.call.state.type, 'succeeded');
      assert.equal(runner.getDetachedCalls().length, 1);

      // The first draft fits; the second deletes the ERP's order
      const { job, result } = await kept([draft([variant('own', 'P-2'), variant('insert', acme)]), draft([ERP_ORDER, variant('delete', acme)])]);

      assert.equal(saidBy(result), `draft notes.patch (2 of 2): ${refusal('patch')}`, 'the draft, then the words a Save of it is refused in');
      assert.deepEqual(await patch([[ERP_ORDER, variant('delete', acme)]]), { kind: 'invalid', message: refusal('patch') }, 'as a Save of the edit is refused');
      if (job.call.state.type !== 'invalid') assert.fail(`the call ended ${job.call.state.type}`);
      assert.equal(job.call.state.value.diagnostics[0]!.message, saidBy(result), 'the kept call holds the same end');
      assert.equal(result.stderr, '', 'its outcome says it all');
      assert.equal(result.inputs.length + result.drafts.length, 0, 'and it names nothing read, as every invalid result does');
      assert.equal(job.call.drafts.length, 2, 'the kept call holds both its drafts: it was refused as it ran');
      assert.equal(runner.getDetachedCalls().length, 1, 'its function does not run');
      assert.equal(runner.getCalls().length, 0, 'nor any program');
      const status = await functionCallStatus(storage, REPO, job);
      assert.ok(status.type === 'completed' && sameResult(status.value, result), 'read back, the kept call answers the same');
      assert.deepEqual(await storage.datasets.read(REPO, WS, 'records/notes'), before, 'and nothing is saved');
    });

    it('R84 — a call no store keeps ends the same way, and answers as the kept call does', async () => {
      const drafts = [draft([ERP_ORDER, variant('delete', acme)])];
      const result = await unkept(drafts);
      assert.equal(saidBy(result), `draft notes.patch (1 of 1): ${refusal('patch')}`);
      assert.equal(runner.getDetachedCalls().length, 0, 'its function does not run');
      assert.equal((await storage.calls.list(REPO, WS, { limit: 10 })).calls.length, 0, 'and no call is filed');
      assert.ok(sameResult(result, (await kept(drafts)).result), 'the call a store keeps answers the same');
    });
  });
});

describe('a composite record: an external entry is never written (the mutation\'s program runs)', () => {
  let repo: string;
  let dir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;

  beforeEach(async () => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    runner = new LocalTaskRunner(repo);
    const zip = join(dir, 'orders.zip');
    await e3.export(ordersPackage(), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, WS);
    await workspaceDeploy(storage, repo, WS, 'orders', '1.0.0', { runner });
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  const mutate = (mutation: string, args: Uint8Array[]) =>
    recordMutate(storage, runner, repo, WS, 'orders', mutation, args, { actor: 'ada@example.com' });

  it('R4 — an edit, a reducer and a patch that write an entry of an external source are each refused as invalid, and nothing is written', async () => {
    const before = await storage.datasets.read(repo, WS, 'records/orders');

    // The record has an index, so its patch runs the program that maintains it
    assert.deepEqual(await mutate('patch', [ordersPatch([[ERP_ORDER, variant('insert', acme)]])]), { kind: 'invalid', message: refusal('patch') });
    // An edit through the capability over every key, and a reducer of the whole state
    assert.deepEqual(await mutate('write', [encodeKey(ERP_ORDER), encodeOrder(acme)]), { kind: 'invalid', message: refusal('write') });
    assert.deepEqual(await mutate('file', [encodeKey(ERP_ORDER), encodeOrder(acme)]), { kind: 'invalid', message: refusal('file') });

    assert.deepEqual(await storage.datasets.read(repo, WS, 'records/orders'), before, 'the record stands where it stood');
    assert.deepEqual((await recordHistory(storage, repo, WS, 'orders')).map(({ commit }) => commit.mutation), ['$reindex', '$init'],
      'no commit joined its history');
  });

  it('R4 — the same mutations write the solution\'s own entries, and the index with them', async () => {
    for (const [mutation, args] of [
      ['plan', [encodeString('P-2'), encodeOrder(acme)]],
      ['write', [encodeKey(variant('own', 'P-3')), encodeOrder(acme)]],
      ['file', [encodeKey(variant('own', 'P-4')), encodeOrder(birch)]],
      ['patch', [ordersPatch([[OWN_ORDER, variant('delete', birch)]])]],
    ] as const) {
      const outcome = await mutate(mutation, [...args]);
      assert.equal(outcome.kind, 'committed', `${mutation}: ${JSON.stringify(outcome)}`);
    }
    const state = await readRecordState(storage, repo, (await heldRef(storage, repo, WS, 'orders')).hash);
    const rows = decodeOrders(await readDatasetWhole(storage, repo, state.primary));
    assert.ok(sameOrders(rows, new SortedMap<OrderKey, OrderRow>([[variant('own', 'P-2'), acme], [variant('own', 'P-3'), acme], [variant('own', 'P-4'), birch]], compareFor(OrdersKey))));
    assert.ok(state.indexes.has('by_customer'), 'its index maintained by each write');
  });

  it('R81 — a function that reads an index of a record waiting for a first delivery ends its call invalid, as one that reads the record does', async () => {
    assert.equal((await heldRef(storage, repo, WS, 'orders')).versions.get(PENDING_SLOT), 'erp', 'loaded from its first deploy, erp has delivered nothing');
    const result = await functionCallUnkept(storage, runner, repo, WS, 'customers', { args: [], drafts: [] },
      { limits: { timeoutMs: 120_000, maxResultBytes: 1024 * 1024, maxLogBytes: 64 * 1024 } });
    if (result.outcome.type !== 'invalid') assert.fail(`the call ended ${result.outcome.type}`);
    assert.deepEqual(result.outcome.value.diagnostics.map(({ message }) => message),
      ['The function\'s input .records.orders waits for the first delivery of erp: a task reading it would wait too, and nothing ran']);
  });

  it('R83 — a task whose input is an index of a record waiting for a first delivery waits, as one that reads the record does, before the index is looked for', async () => {
    const waited = [['served', [{ input: '.records.orders', kind: 'pending', sources: ['erp'] }]]];
    const reason = { type: 'waiting', reason: 'record \'orders\' waits for the first delivery of erp' };
    /** A run of the workspace, and what it left waiting. */
    const run = async () => {
      const waiting: Array<[string, InputWait[]]> = [];
      const result = await dataflowExecute(storage, repo, WS, { runner, onTaskWaiting: (task, waits) => waiting.push([task, waits]) });
      return { result, waiting };
    };

    // The state holds the index, built at the deploy over the solution's own order: the task is not run on it
    const ref = await heldRef(storage, repo, WS, 'orders');
    assert.ok((await readRecordState(storage, repo, ref.hash)).indexes.has('by_customer'));
    const first = await run();
    assert.deepEqual([first.result.success, first.result.executed, first.result.waiting], [true, 0, 1], JSON.stringify(first.result.tasks));
    assert.deepEqual(first.waiting, waited);
    assert.deepEqual((await workspaceStatus(storage, runner, repo, WS)).tasks.find((task) => task.name === 'served')?.status, reason);

    // A state that holds no such index: the task still waits for the delivery, which is asked first
    const { primary } = await readRecordState(storage, repo, ref.hash);
    await storage.datasets.write(repo, WS, 'records/orders', variant('value', { ...ref, hash: primary }));
    try {
      assert.deepEqual((await run()).waiting, waited);
      assert.deepEqual((await workspaceStatus(storage, runner, repo, WS)).tasks.find((task) => task.name === 'served')?.status, reason);
    } finally {
      await storage.datasets.write(repo, WS, 'records/orders', variant('value', ref));
    }

    // The ERP delivers: the ref written as a load's commit leaves it, until a load does. The task runs over the index
    await sourceDelivered(storage, repo, WS, 'records/orders', 'erp', '2026-11-02T03:00:00.000');
    const next = await run();
    assert.deepEqual([next.result.success, next.result.executed, next.result.waiting], [true, 1, 0], JSON.stringify(next.result.tasks));
    const output = await storage.datasets.read(repo, WS, 'tasks/served/output');
    if (output?.type !== 'value') assert.fail('served wrote its output');
    assert.equal(decodeBeast2For(IntegerType)(await readDatasetWhole(storage, repo, output.value.hash)), 1n, 'one order, the solution\'s own');
  });

  it('R70 — a collection keeps what a composite\'s load runs: its load object, the task object it names, the load\'s program and its merge', async () => {
    const resolved = await resolveRecord(storage, repo, WS, 'orders');
    const erp = resolved?.sources.get('erp');
    if (erp?.type !== 'load') assert.fail('the deployed record names a load for its ERP source');
    const load = decodeRecordLoadObject(await storage.objects.read(repo, erp.value));
    const task = decodeTaskObject(await storage.objects.read(repo, load.task));
    if (task.body.type !== 'east' || task.output.kind.type !== 'dict' || task.output.kind.value.merge.type !== 'some') {
      assert.fail('a keyed load runs an East program whose pieces fold by its merge');
    }
    const named = { load: erp.value, task: load.task, program: task.body.value.program, merge: task.output.kind.value.merge.value };

    // Nothing but the package's record object names them: a sweep of everything unreached leaves each
    await repoGc(storage, repo, { minAge: 0 });
    for (const [what, hash] of Object.entries(named)) assert.ok(await storage.objects.exists(repo, hash), `the ${what} is kept`);
  });

  it('R78 — a migration that makes a record composite leaves a source it put rows under not waiting, and one it left none under waiting', async () => {
    // A workspace of its own: the record the others deploy is not this package's
    const books = 'books';
    await workspaceCreate(storage, repo, books);
    /** Export, import and deploy a version of `book`. */
    const deployBook = async (version: '1.0.0' | '2.0.0' | '2.1.0'): Promise<void> => {
      const zip = join(dir, `book-${version}.zip`);
      await e3.export(bookPackage(version), zip);
      await packageImport(storage, repo, zip);
      await workspaceDeploy(storage, repo, books, 'book', version, { runner });
    };
    const held = () => heldRef(storage, repo, books, 'book');

    await deployBook('1.0.0');
    await deployBook('2.0.0');
    assert.deepEqual((await recordHistory(storage, repo, books, 'book')).map(({ commit }) => commit.mutation), ['$reindex', '$migrate:by_source', '$init']);
    const migrated = await held();
    assert.deepEqual([migrated.versions.get(PENDING_SLOT), migrated.versions.get(EXTERNAL_SLOT)], ['wms', 'erp,wms'],
      'erp holds the rows carried over, and does not wait; wms holds none, and waits');
    const rows = decodeBeast2For(Book)(await readDatasetWhole(storage, repo, (await readRecordState(storage, repo, migrated.hash)).primary));
    assert.ok(equalFor(Book)(rows, new SortedMap<ValueTypeOf<typeof BookKey>, OrderRow>(
      [[variant('erp', 'SO-1001'), acme], [variant('erp', 'SO-1002'), birch]], compareFor(BookKey))), 'each row under the source that owns it');

    // A source handed to a load later, over a state that names its rows and an index: it holds no row, and waits too
    await deployBook('2.1.0');
    const handed = await held();
    assert.deepEqual([handed.versions.get(PENDING_SLOT), handed.versions.get(EXTERNAL_SLOT)], ['own,wms', 'erp,own,wms']);
  });
});
