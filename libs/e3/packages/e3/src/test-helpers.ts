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
import { DateTimeType, equalFor, parseFor, printFor, printType, type EastType, type ValueTypeOf } from '@elaraai/east';

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
