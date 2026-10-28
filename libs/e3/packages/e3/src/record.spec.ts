/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yauzl from 'yauzl';
import {
  East, IntegerType, StringType, FloatType, ArrayType, DictType, SortedMap, StructType,
  compareFor, decodeBeast2For, decodeEastIR, isTypeValueEqual, toEastTypeValue,
} from '@elaraai/east';
import {
  RecordObjectType,
  MutationObjectType,
  decodeMigrationObject,
  decodePackageObject,
  decodeRecordObject,
} from '@elaraai/e3-types';
import { record, recordsTree } from './record.js';
import { package_ } from './package.js';
import { export_ } from './export.js';

async function readZip(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error('No zipfile'));
      const entries = new Map<string, Buffer>();
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) return reject(err);
          if (!readStream) return reject(new Error('No read stream'));
          const chunks: Buffer[] = [];
          readStream.on('data', (c) => chunks.push(c));
          readStream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zipfile.readEntry(); });
        });
      });
      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
    });
  });
}

function objectAt(entries: Map<string, Buffer>, hash: string): Buffer {
  const buf = entries.get(`objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`);
  if (!buf) throw new Error(`object ${hash} not in bundle`);
  return buf;
}

describe('e3.record and its mutations', () => {
  it('record() mounts a non-writable dataset at .records.<name> with the initial value', () => {
    const counter = record('counter', IntegerType, { initial: 0n });
    assert.strictEqual(counter.kind, 'dataset');
    assert.strictEqual(counter.recordKind, 'record');
    assert.strictEqual(counter.writable, false);
    assert.strictEqual(counter.default, 0n);
    assert.deepStrictEqual(
      counter.path.map((s) => (s.type === 'field' ? s.value : s.type)),
      ['records', 'counter']
    );
    assert.ok(counter.deps.has(recordsTree));
  });

  it('record() with no initial value declares a record that is unassigned until its first state is committed', () => {
    const customers = record('customers', DictType(StringType, IntegerType));
    assert.strictEqual(customers.recordKind, 'record');
    assert.ok(!('default' in customers), 'no initial value rides the package');
    assert.strictEqual(customers.writable, false);
    const pkg = package_('c', '1.0.0', customers);
    assert.ok(pkg.records.customers, 'declared on the package');
  });

  /** The counter's reducer: add what it is given. */
  const add = East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by));
  /** A counter whose one mutation, `bad`, reduces with the function given: refused or not as it is declared. */
  const counterWith = (fn: unknown) => () => record('counter', IntegerType, { initial: 0n, mutations: (mutation) => ({ bad: mutation.reduce(fn as never) }) });

  it('mutation.reduce derives the extra arg types from the reducer signature', () => {
    const counter = record('counter', IntegerType, { initial: 0n, mutations: (mutation) => ({ increment: mutation.reduce(add) }) });
    const increment = counter.mutations.increment;
    assert.strictEqual(increment.kind, 'mutation');
    assert.strictEqual(increment.record, counter);
    // [state, by] -> extra args = [by]
    assert.strictEqual(increment.argTypes.length, 1);
  });

  it('a package carries a record with its mutations', () => {
    const counter = record('counter', IntegerType, { initial: 0n, mutations: (mutation) => ({ increment: mutation.reduce(add) }) });
    const pkg = package_('c', '1.0.0', counter);
    assert.ok(pkg.records.counter, 'record registered');
    assert.ok(pkg.records.counter.mutations.increment, 'its mutation with it');
    assert.ok(pkg.contents.includes(counter), 'record dataset in contents');
  });

  it('preserves a record’s mutations when its package is imported into another', () => {
    const counter = record('counter', IntegerType, { initial: 0n, mutations: (mutation) => ({ increment: mutation.reduce(add) }) });
    const inner = package_('inner', '1.0.0', counter);
    assert.ok(inner.records.counter.mutations.increment, 'the inner package carries the mutation');
    // The record arrives both in `contents` and in `records`, and each is the record as declared.
    const outer = package_('outer', '1.0.0', inner);
    assert.ok(outer.records.counter, 'imported record registered on the outer package');
    assert.deepStrictEqual(Object.keys(outer.records.counter.mutations), ['increment'], 'exactly the imported mutation survives');
  });

  it('refuses a mutation name that is not an identifier, the names e3\'s own commits take among them', () => {
    const Tally = DictType(StringType, IntegerType);
    // A commit is named after its mutation, so '$reset' would read as a reset
    // in the record's history; 'a.b' could not be addressed as record.mutation.
    for (const name of ['$reset', '$migrate:x', 'set-status', 'a.b', '1st', '']) {
      assert.throws(() => record('counter', IntegerType, { mutations: (mutation) => ({ [name]: mutation.reduce(add) }) }),
        /^Error: e3\.record 'counter': mutation\.reduce requires a name that is an identifier/, name);
      assert.throws(() => record('tally', Tally, { mutations: (mutation) => ({ [name]: mutation.edit(add as never) }) }),
        /^Error: e3\.record 'tally': mutation\.edit requires a name that is an identifier/, name);
      assert.throws(() => record('tally', Tally, { mutations: (mutation) => ({ [name]: mutation.patch() }) }),
        /^Error: e3\.record 'tally': mutation\.patch requires a name that is an identifier/, name);
    }
    assert.strictEqual(record('counter', IntegerType, { mutations: (mutation) => ({ set_status: mutation.reduce(add) }) }).mutations.set_status.name, 'set_status');
    assert.strictEqual(record('tally', Tally, { mutations: (mutation) => ({ patch: mutation.patch() }) }).mutations.patch.name, 'patch');
  });

  it('rejects an async reducer body at definition time', () => {
    // Async bodies break CAS-retry safety; the typed builder rejects them at
    // compile time, and the cast checks the runtime guard for dynamic callers.
    assert.throws(counterWith(East.asyncFunction([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))), /pure, synchronous|async/i);
  });

  it('rejects a sync platform call in the reducer body at definition time', () => {
    // A sync platform call (time/random/io) is an ordinary FunctionIR, so the
    // async check misses it — the body walk must reject it: the CAS retry loop
    // re-runs the reducer, so a platform result is non-deterministic.
    assert.throws(counterWith(East.function([IntegerType, IntegerType], IntegerType,
      ($, state, by) => state.add(East.platform('time_now', [], IntegerType)()).add(by))), /must not call platform functions/);
  });

  it('rejects a sync platform call buried inside a collection lambda', () => {
    // The walk must descend into closure bodies, not just the top level.
    assert.throws(counterWith(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => {
      $.let(East.value([1n, 2n], ArrayType(IntegerType)).map(($, x) => x.add(East.platform('time_now', [], IntegerType)())));
      return state.add(by);
    })), /must not call platform functions/);
  });

  it('rejects a reducer whose state/return type does not match the record', () => {
    // The typed builder enforces state/return == record type at compile time;
    // a dynamic / cast caller bypasses that, so the definition-time guard must
    // still reject a mismatched reducer (here Integer record vs String reducer).
    assert.throws(counterWith(East.function([StringType, FloatType], StringType, ($, state, _by) => state)), /record's state type/);
  });

  describe('export round-trip', () => {
    let tmp: string;
    before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-rec-')); });
    after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    it('writes a RecordObject + MutationObject and a writable:false structure leaf', async () => {
      const counter = record('counter', IntegerType, {
        initial: 0n,
        mutations: (mutation) => ({
          increment: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
        }),
      });
      const pkg = package_('counters', '1.0.0', counter);
      const zip = path.join(tmp, 'counters.zip');
      await export_(pkg, zip);

      const entries = await readZip(zip);
      const pkgHash = decodeBeast2For(StringType)(entries.get('packages/counters/1.0.0.beast2')!);
      const pkgObject = decodePackageObject(objectAt(entries, pkgHash));

      // records map points at a RecordObject
      const recHash = pkgObject.records.get('counter');
      assert.ok(recHash, 'record in package object');
      const recObject = decodeBeast2For(RecordObjectType)(objectAt(entries, recHash!));
      assert.strictEqual(recObject.path, 'records/counter');

      // RecordObject points at a MutationObject with the derived arg types
      const mutHash = recObject.mutations.get('increment');
      assert.ok(mutHash, 'mutation in record object');
      const mutObject = decodeBeast2For(MutationObjectType)(objectAt(entries, mutHash!));
      assert.strictEqual(mutObject.argTypes.length, 1);
      assert.strictEqual(mutObject.form.type, 'reduce');

      // structure leaf at .records.counter is non-writable
      const structure = pkgObject.data.structure;
      assert.ok(structure.type === 'struct');
      const recordsNode = structure.value.get('records');
      assert.ok(recordsNode?.type === 'struct');
      const leaf = recordsNode.value.get('counter');
      assert.ok(leaf?.type === 'value');
      assert.strictEqual(leaf.value.writable, false);

      // the record's initial state ref is present
      assert.ok(pkgObject.data.refs.get('records/counter'), 'record initial-state ref present');
    });

    it('writes a record\'s migrations in chain order, a step split over the state with the program it runs', async () => {
      const RowV1Type = StructType({ title: StringType });
      const RowV2Type = StructType({ title: StringType, owner: StringType });
      const plans = record('plans', DictType(StringType, RowV2Type), {
        initial: new Map(),
        migrations: (migration) => [
          migration.value('normalize', East.function([DictType(StringType, RowV1Type)], DictType(StringType, RowV1Type), ($, old) => old)),
          migration.rows('add_owner',
            East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: 'unassigned' }))),
        ],
      });
      const zip = path.join(tmp, 'plans.zip');
      await export_(package_('planning', '2.0.0', plans), zip);

      const entries = await readZip(zip);
      const pkgHash = decodeBeast2For(StringType)(entries.get('packages/planning/2.0.0.beast2')!);
      const recObject = decodeRecordObject(objectAt(entries, decodePackageObject(objectAt(entries, pkgHash)).records.get('plans')!));
      assert.deepStrictEqual(recObject.migrations.map((step) => step.name), ['normalize', 'add_owner']);
      const [whole, split] = recObject.migrations.map((step) => decodeMigrationObject(objectAt(entries, step.migration)));

      assert.strictEqual(whole!.form.type, 'value');
      assert.strictEqual(whole!.programIr, '', 'a value step runs its own function, and names no program');
      objectAt(entries, whole!.bodyIr);

      assert.strictEqual(split!.form.type, 'rows');
      assert.ok(isTypeValueEqual(split!.from, toEastTypeValue(DictType(StringType, RowV1Type))));
      assert.ok(isTypeValueEqual(split!.to, toEastTypeValue(DictType(StringType, RowV2Type))));
      objectAt(entries, split!.bodyIr);
      // The program in the bundle is the one that runs: each row out under
      // its key, as the function rewrites it.
      const run = decodeEastIR(objectAt(entries, split!.programIr)).compile([]) as
        (piece: unknown, emit: (key: unknown, row: unknown) => null) => unknown;
      const out: unknown[][] = [];
      run(new SortedMap([['p1', { title: 'One' }]], compareFor(StringType)), (key, row) => {
        out.push([key, row]);
        return null;
      });
      assert.deepStrictEqual(out, [['p1', { title: 'One', owner: 'unassigned' }]]);
    });
  });
});
