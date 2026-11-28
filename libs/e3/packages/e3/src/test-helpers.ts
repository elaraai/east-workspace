/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Test helpers for the e3 SDK's specs: East values written as East prints
 * them and read by its parser, an assertion over decoded East values, the
 * seeded stream a spec draws its rows from, and what every index's spec asks
 * of its programs — the entries a build emits, the delta a write emits, and
 * that the one maintains what the other rebuilds. The SDK's own modules never
 * import this one; its specs do.
 */

import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, SortedMap, StructType, compareFor, encodeBeast2PagedFor, equalFor, parseFor, printFor, printType, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { buildMutationProgram, indexBuildProgram } from './record-programs.js';
import type { MutationDef, RecordDef, RecordIndexDef } from './types.js';

// A seeded stream of numbers in [0, 1) (mulberry32), the same rows on every
// run of a spec that draws them: East's own, which its fuzz generator draws from
export { randomStream as seededStream } from '@elaraai/east/internal';

/**
 * A value written as East prints one, read by East's parser.
 *
 * @param type - The value's type
 * @param text - The value, as East prints it
 * @returns The value
 * @throws {Error} When the text is no value of the type, naming the type and why
 */
export function parsed<T extends EastType>(type: T, text: string): ValueTypeOf<T> {
  const read = parseFor(type)(text);
  if (!read.success) throw new Error(`not a ${printType(type)}: ${read.error}`);
  return read.value;
}

/**
 * An instant written as East prints one, read by East's parser.
 *
 * @param text - The instant, as East prints it: `2026-10-05T00:00:00.000`
 * @returns The instant
 * @throws {Error} When the text is no instant East reads, saying why
 */
export function at(text: string): ValueTypeOf<typeof DateTimeType> {
  return parsed(DateTimeType, text);
}

/**
 * Asserts an East value equals the one expected, by its type, printing both
 * as East prints them when it does not.
 *
 * @param type - The values' type
 * @param actual - The value a spec read
 * @param expected - The value it expects
 * @param what - What the value is, for the failure's first line
 * @throws {AssertionError} When the two differ
 */
export function assertEast<T extends EastType>(type: T, actual: unknown, expected: ValueTypeOf<T>, what: string): void {
  if (equalFor(type)(actual as ValueTypeOf<T>, expected)) return;
  const print = printFor(type);
  assert.fail(`${what}:\n  got      ${print(actual as ValueTypeOf<T>)}\n  expected ${print(expected)}`);
}

/**
 * The entries an index's build program emits for a record's rows: each entry's
 * key, `{ ik, k }`, and what it carries, in the order the program reads the
 * rows.
 *
 * @param recordType - The record's state type
 * @param def - The index, as its record builds it
 * @param rows - The record's rows
 * @returns Each entry and its value
 */
export function indexEntries(recordType: EastType, def: RecordIndexDef, rows: unknown): [unknown, unknown][] {
  const out: [unknown, unknown][] = [];
  const run = indexBuildProgram(recordType, def).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
  run(rows, (entry, value) => {
    out.push([entry, value]);
    return null;
  });
  return out;
}

/** One entry of a write's delta: the target it changes — `primary`, or an index's name — its key there, and its op. */
export interface WrittenChange {
  readonly target: string;
  readonly key: unknown;
  readonly op: variant<string, unknown>;
}

/**
 * The delta a record's write emits for the record going from one state to
 * another, the patch between them East's own diff: each entry's target, its
 * key there and its op.
 *
 * @param rec - The record, as its package assembles it
 * @param patch - Its `patch` mutation
 * @param before - The state the record holds
 * @param after - The state the write leaves
 * @returns The delta's entries, in the order the program emits them
 */
export function writtenDelta(rec: RecordDef, patch: MutationDef, before: unknown, after: unknown): WrittenChange[] {
  const state: EastType = rec.type;
  const diff = East.compile(East.patchesFor(state).diff, []) as (a: unknown, b: unknown) => unknown;
  const run = buildMutationProgram(rec, patch).compile([]) as (
    state: unknown, patch: unknown, emit: (key: variant<string, unknown>, op: variant<string, variant<string, unknown>>) => null) => unknown;
  const changes: WrittenChange[] = [];
  run(before, diff(before, after), (key, op) => {
    changes.push({ target: key.type, key: key.value, op: op.value });
    return null;
  });
  return changes;
}

/**
 * Holds each of a record's indexes of entries, as a write of `before` to
 * `after` maintains it, to what a rebuild of `after` emits, and that the write
 * changes each: byte for byte, as e3 stores a collection, each entry's bytes
 * its own — a rebuild hands every entry of a row the one value, and a write's
 * updates hand each its own copy, which a whole-value encoding would tell
 * apart.
 *
 * @param rec - The record, a Dict, as its package assembles it
 * @param patch - Its `patch` mutation
 * @param indexes - Its indexes of entries: every kind but a summary
 * @param before - The state the record holds
 * @param after - The state the write leaves
 * @throws {AssertionError} When an index is left unchanged, or as maintained differs from its rebuild, naming it
 */
export function assertMaintainedIsRebuilt(rec: RecordDef, patch: MutationDef, indexes: readonly RecordIndexDef[], before: unknown, after: unknown): void {
  const state: EastType = rec.type;
  if (state.type !== 'Dict') throw new Error(`an index is over a Dict record, and '${rec.name}' holds ${printType(state)}`);
  const changes = writtenDelta(rec, patch, before, after);
  for (const index of indexes) {
    const rowKey: EastType = state.key;
    const keyType: EastType = StructType({ ik: index.keyType, k: rowKey });
    const collection: EastType = DictType(keyType, index.valueType);
    const order = compareFor(keyType) as (a: unknown, b: unknown) => 1 | 0 | -1;
    const entries = (rows: unknown): SortedMap<unknown, unknown> => new SortedMap<unknown, unknown>(indexEntries(rec.type, index, rows), order);
    const held = entries(before);
    const rebuilt = entries(after);
    const ops = new SortedMap<unknown, unknown>(changes.filter((change) => change.target === index.name).map((change) => [change.key, change.op]), order);
    assert.ok(ops.size > 0, `${index.name}: the write changes it`);
    const apply = East.compile(East.patchesFor(collection).apply, []) as (value: unknown, patch: unknown) => unknown;
    const maintained = apply(held, variant('patch', ops));
    const encode = encodeBeast2PagedFor(collection) as (value: unknown) => Uint8Array;
    assert.deepEqual(encode(maintained), encode(rebuilt), `${index.name}: maintained is rebuilt, byte for byte`);
  }
}
