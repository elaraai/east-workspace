/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Test helpers for the e3 SDK's specs: East values written as East prints
 * them and read by its parser, an assertion over decoded East values, and the
 * seeded stream a spec draws its rows from. The SDK's own modules never import
 * this one; its specs do.
 */

import assert from 'node:assert/strict';
import {
  DateTimeType, StringType, compareFor, equalFor, isVariant, parseFor, printFor, printType, toEastTypeValue,
  type EastType, type ValueTypeOf, type variant,
} from '@elaraai/east';
import { DELTA_CONFLICT, mutationDeltaType } from '@elaraai/e3-types';
import { deltaTargets } from './record-programs.js';
import type { RecordDef } from './types.js';

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
 * A delta's key or op, as the variant it is: the target it is of, and what it
 * carries.
 *
 * @param part - A key or an op a write's program emitted
 * @returns The variant
 * @throws {AssertionError} When it is no variant
 */
export function partOf(part: unknown): variant {
  assert.ok(isVariant(part), 'a delta entry is a variant of its target');
  return part;
}

/** One entry a write's program emitted: the target it changes, its key there, and its op. */
export interface Emitted {
  /** `primary`, an index's name, or the conflict. */
  readonly target: string;
  /** The key, as East prints it at the target's key type. */
  readonly key: string;
  /** The key's value. */
  readonly keyValue: unknown;
  /** The target's op — `insert`, `delete`, `update`, `add` — or a conflict's Null. */
  readonly op: unknown;
  /** What went stale, in words, for the conflict's entry. */
  readonly conflict?: string;
}

/**
 * The delta a record's program wrote, read from the `(key, op)` pairs it
 * emitted: sorted by the delta's key as the runner sorts them, each key
 * printed by East at its target's key type.
 *
 * @param rec - The record the program writes
 * @param pairs - What the program emitted, in the order it emitted it
 * @returns The delta's entries, in the delta's order
 * @throws {AssertionError} When a key is emitted twice — the delta is a dict with no merge — or names no target of the
 *   record's
 */
export function deltaOf(rec: RecordDef, pairs: ReadonlyArray<readonly [unknown, unknown]>): Emitted[] {
  const targets = deltaTargets(rec.type, Object.values(rec.indexes));
  const compare = compareFor(toEastTypeValue(mutationDeltaType(targets).key));
  const out = [...pairs].sort(([a], [b]) => compare(a, b));
  for (let i = 1; i < out.length; i++) {
    assert.notEqual(compare(out[i - 1]![0], out[i]![0]), 0, 'the delta is a dict with no merge: no key is emitted twice');
  }
  const printers = new Map(targets.map((target) => [target.name, printFor(toEastTypeValue(target.keyType))]));
  printers.set(DELTA_CONFLICT, printFor(toEastTypeValue(StringType)));
  return out.map(([key, op]) => {
    const { type: target, value } = partOf(key);
    const print = printers.get(target);
    assert.ok(print !== undefined, `the delta's targets name '${target}'`);
    const conflict: string | undefined = target === DELTA_CONFLICT ? value : undefined;
    return { target, key: print(value), keyValue: value, op: partOf(op).value, ...(conflict !== undefined && { conflict }) };
  });
}

/**
 * The conflict a delta names, if it names one: it sorts first.
 *
 * @param out - A delta's entries, in the delta's order
 * @returns What went stale, in words; undefined for a delta that names none
 */
export function conflictOf(out: readonly Emitted[]): string | undefined {
  return out[0]?.conflict;
}

/**
 * A delta's `target:key=op` lines, which is what the apply keys on: each
 * entry's target, its key as East prints it, and its op's case.
 *
 * @param out - A delta's entries, in the delta's order
 * @returns One line an entry
 */
export function shape(out: readonly Emitted[]): string[] {
  return out.map((entry) => `${entry.target}:${entry.key}=${partOf(entry.op).type}`);
}
