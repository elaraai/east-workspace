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
import { East, IntegerType, ArrayType, decodeBeast2For } from '@elaraai/east';
import {
  RecordObjectType,
  MutationObjectType,
  decodePackageObject,
} from '@elaraai/e3-types';
import { record, recordsTree } from './record.js';
import { mutation } from './mutation.js';
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

describe('e3.record / e3.mutation', () => {
  it('record() mounts a non-writable dataset at .records.<name> with the initial value', () => {
    const counter = record('counter', IntegerType, 0n);
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

  it('mutation() derives the extra arg types from the reducer signature', () => {
    const counter = record('counter', IntegerType, 0n);
    const increment = mutation(
      'increment',
      counter,
      East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))
    );
    assert.strictEqual(increment.kind, 'mutation');
    assert.strictEqual(increment.record, counter);
    // [state, by] -> extra args = [by]
    assert.strictEqual(increment.argTypes.length, 1);
  });

  it('package() folds mutations onto their record', () => {
    const counter = record('counter', IntegerType, 0n);
    const increment = mutation(
      'increment',
      counter,
      East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))
    );
    // Pass only the mutation; its record is pulled in transitively.
    const pkg = package_('c', '1.0.0', increment);
    assert.ok(pkg.records.counter, 'record registered');
    assert.ok(pkg.records.counter.mutations.increment, 'mutation folded onto record');
    assert.ok(pkg.contents.includes(counter), 'record dataset in contents');
  });

  it('preserves a record’s mutations when its package is imported into another', () => {
    const counter = record('counter', IntegerType, 0n);
    const increment = mutation(
      'increment',
      counter,
      East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))
    );
    const inner = package_('inner', '1.0.0', counter, increment);
    assert.ok(inner.records.counter.mutations.increment, 'inner package folds the mutation');

    // Importing `inner` must NOT clobber the record's assembled mutations: the
    // record arrives both as a bare dataset (in `contents`) and as an already-
    // assembled record (in `records`), and the assembly loop must merge, not
    // rebuild from the bare `{}`.
    const outer = package_('outer', '1.0.0', inner);
    assert.ok(outer.records.counter, 'imported record registered on the outer package');
    assert.ok(
      outer.records.counter.mutations.increment,
      'imported record keeps its mutation (would be dropped before the fix)'
    );
    assert.deepStrictEqual(
      Object.keys(outer.records.counter.mutations),
      ['increment'],
      'exactly the imported mutation survives'
    );
  });

  it('rejects an async reducer body at definition time', () => {
    const counter = record('counter', IntegerType, 0n);
    // Async bodies break CAS-retry safety; the typed overload rejects them at
    // compile time, and the cast checks the runtime guard for dynamic callers.
    assert.throws(
      () => mutation('bad', counter, East.asyncFunction([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)) as never),
      /pure, synchronous|async/i,
    );
  });

  it('rejects a sync platform call in the reducer body at definition time', () => {
    const counter = record('counter', IntegerType, 0n);
    // A sync platform call (time/random/io) is an ordinary FunctionIR, so the
    // async check misses it — the body walk must reject it: the CAS retry loop
    // re-runs the reducer, so a platform result is non-deterministic.
    assert.throws(
      () => mutation('bad', counter, East.function([IntegerType, IntegerType], IntegerType,
        ($, state, by) => state.add(East.platform('time_now', [], IntegerType)()).add(by))),
      /must not call platform functions/,
    );
  });

  it('rejects a sync platform call buried inside a collection lambda', () => {
    const counter = record('counter', IntegerType, 0n);
    // The walk must descend into closure bodies, not just the top level.
    assert.throws(
      () => mutation('bad', counter, East.function([IntegerType, IntegerType], IntegerType,
        ($, state, by) => {
          $.let(East.value([1n, 2n], ArrayType(IntegerType))
            .map(($, x) => x.add(East.platform('time_now', [], IntegerType)())));
          return state.add(by);
        })),
      /must not call platform functions/,
    );
  });

  describe('export round-trip', () => {
    let tmp: string;
    before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-rec-')); });
    after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

    it('writes a RecordObject + MutationObject and a writable:false structure leaf', async () => {
      const counter = record('counter', IntegerType, 0n);
      const increment = mutation(
        'increment',
        counter,
        East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))
      );
      const pkg = package_('counters', '1.0.0', counter, increment);
      const zip = path.join(tmp, 'counters.zip');
      await export_(pkg, zip);

      const entries = await readZip(zip);
      const pkgHash = entries.get('packages/counters/1.0.0')!.toString().trim();
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

      // structure leaf at .records.counter is non-writable
      const structure = pkgObject.data.structure;
      assert.strictEqual(structure.type, 'struct');
      const recordsNode = (structure.value as Map<string, any>).get('records');
      const leaf = (recordsNode.value as Map<string, any>).get('counter');
      assert.strictEqual(leaf.type, 'value');
      assert.strictEqual(leaf.value.writable, false);

      // the record's initial state ref is present
      assert.ok(pkgObject.data.refs.get('records/counter'), 'record initial-state ref present');
    });
  });
});
