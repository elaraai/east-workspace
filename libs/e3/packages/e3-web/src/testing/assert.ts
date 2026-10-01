/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Assertions a case asserts with wherever it runs: in Node, and in a page,
 * which has no `node:assert`.
 *
 * A failed assertion throws an {@link AssertionError} naming what it expected
 * and what it found; a case run in a page fails its Node-side test with that
 * message.
 *
 * @packageDocumentation
 */

/**
 * An assertion that did not hold.
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/** A value as a failed assertion's message names it. */
export function render(value: unknown): string {
  if (value instanceof Uint8Array) return `bytes[${[...value].join(',')}]`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return `[${value.map(render).join(', ')}]`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'object' && value !== null) {
    return `{ ${Object.entries(value).map(([key, field]) => `${key}: ${render(field)}`).join(', ')} }`;
  }
  return `${value as string}`;
}

/** Whether two values are the same in structure: primitives the same value,
 *  bytes the same bytes, arrays and plain objects the same members. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((byte, i) => byte === b[i]);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((member, i) => same(member, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return same(aKeys, bKeys) && aKeys.every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** A failed assertion's message: what it says, and what it found. */
function explain(what: string, message?: string): string {
  return message === undefined ? what : `${message}: ${what}`;
}

/**
 * Asserts two values are the same value, as `Object.is` has it.
 *
 * @param actual - What was found
 * @param expected - What was expected
 * @param message - What the assertion is of
 * @throws {AssertionError} When they are not
 */
export function equal<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(explain(`expected ${render(expected)}, found ${render(actual)}`, message));
  }
}

/**
 * Asserts two values are the same in structure: bytes the same bytes, arrays
 * and plain objects the same members.
 *
 * @param actual - What was found
 * @param expected - What was expected
 * @param message - What the assertion is of
 * @throws {AssertionError} When they are not
 */
export function deepEqual<T>(actual: T, expected: T, message?: string): void {
  if (!same(actual, expected)) {
    throw new AssertionError(explain(`expected ${render(expected)}, found ${render(actual)}`, message));
  }
}

/**
 * Asserts a value holds.
 *
 * @param value - What was found
 * @param message - What the assertion is of
 * @throws {AssertionError} When it does not
 */
export function ok(value: unknown, message?: string): asserts value {
  if (!value) throw new AssertionError(explain(`expected a value that holds, found ${render(value)}`, message));
}

/** What a failure is expected to be. */
export interface Expected {
  /** Its name: `TypeError`, `RecordsTransactionError`, … */
  readonly name?: string;
  /** What its message holds */
  readonly message?: RegExp;
}

/** Checks a failure is what was expected. */
function matches(err: unknown, expected: Expected, message?: string): void {
  const { name, message: text } = err instanceof Error ? err : { name: undefined, message: `${err as string}` };
  if (expected.name !== undefined && name !== expected.name) {
    throw new AssertionError(explain(`expected a ${expected.name}, found ${render(err)}`, message));
  }
  if (expected.message !== undefined && !expected.message.test(text)) {
    throw new AssertionError(explain(`expected a failure matching ${String(expected.message)}, found ${render(err)}`, message));
  }
}

/**
 * Asserts work fails: a function that throws, or whose promise rejects.
 *
 * @param work - The work
 * @param expected - What the failure is
 * @param message - What the assertion is of
 * @throws {AssertionError} When the work succeeds, or fails otherwise
 */
export async function rejects(work: () => unknown, expected: Expected = {}, message?: string): Promise<void> {
  try {
    await work();
  } catch (err) {
    matches(err, expected, message);
    return;
  }
  throw new AssertionError(explain(`expected a failure${expected.name === undefined ? '' : ` (${expected.name})`}, and it succeeded`, message));
}

/**
 * Asserts a function throws, there and then.
 *
 * @param work - The function
 * @param expected - What it throws
 * @param message - What the assertion is of
 * @throws {AssertionError} When it returns, or throws otherwise
 */
export function throws(work: () => unknown, expected: Expected = {}, message?: string): void {
  try {
    work();
  } catch (err) {
    matches(err, expected, message);
    return;
  }
  throw new AssertionError(explain(`expected it to throw${expected.name === undefined ? '' : ` a ${expected.name}`}, and it returned`, message));
}
