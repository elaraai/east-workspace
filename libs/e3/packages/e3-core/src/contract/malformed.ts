/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Names that cannot be one path segment, and hashes and ids that are not of
 * the forms e3 writes, which every store refuses before it reads or writes
 * anything, and the refusal the suites expect of each: an `InvalidNameError`
 * naming its kind and the value, whose message says why (`checkName`), or what
 * the form is (`checkHash`, `checkId`).
 */

import { nameProblem, type HashKind, type IdKind, type NamedKind } from '@elaraai/e3-types';

/** Names of each kind that cannot be one path segment: an empty one, one that
 *  is a path of its own, one that holds a separator, and — a workspace's — one
 *  that holds what joins the parts of its locks' names. */
export const MALFORMED_NAMES: Readonly<Record<NamedKind, readonly string[]>> = {
  'repository': ['', '..', 'a/b'],
  'workspace': ['', '..', 'a/b', 'main#dataflow', 'a~b'],
  'package': ['', '..', '../pkg'],
  'package version': ['', '..', '1/0'],
  'lock': ['', '..', 'a/b'],
};

/** Strings that are no SHA-256 in lowercase hex: one that is no hash, one in
 *  uppercase, and one of a hash's length that climbs out of its directory. */
export const MALFORMED_HASHES: readonly string[] = ['not-a-hash', 'A'.repeat(64), `../${'a'.repeat(61)}`];

/** Strings that are no UUIDv7: one that is no id, a UUIDv4, and a UUIDv7
 *  behind a step out of its directory. */
export const MALFORMED_IDS: readonly string[] = ['not-an-id', '0190a0b0-0000-4000-8000-000000000000', '../0190a0b0-0000-7000-8000-000000000000'];

/** What a refusal of a name, a hash or an id is, for `assert.rejects`. */
export interface Refusal {
  readonly name: 'InvalidNameError';
  readonly kind: NamedKind | HashKind | IdKind;
  readonly value: string;
  readonly message: string;
}

/**
 * A store's refusal of a name that cannot be one path segment.
 *
 * @param kind - What the name names
 * @param value - The name the store was given
 * @returns The refusal's name, kind, value and message
 */
export function nameRefusal(kind: NamedKind, value: string): Refusal {
  return { name: 'InvalidNameError', kind, value, message: `the ${kind} name ${JSON.stringify(value)} ${nameProblem(kind, value)}` };
}

/**
 * A store's refusal of a hash that is not a SHA-256 in lowercase hex.
 *
 * @param kind - What the hash names
 * @param value - The hash the store was given
 * @returns The refusal's name, kind, value and message
 */
export function hashRefusal(kind: HashKind, value: string): Refusal {
  return { name: 'InvalidNameError', kind, value, message: `the ${kind} ${JSON.stringify(value)} is not a SHA-256 in lowercase hex` };
}

/**
 * A store's refusal of an id that is not a UUIDv7.
 *
 * @param kind - What the id names
 * @param value - The id the store was given
 * @returns The refusal's name, kind, value and message
 */
export function idRefusal(kind: IdKind, value: string): Refusal {
  return { name: 'InvalidNameError', kind, value, message: `the ${kind} ${JSON.stringify(value)} is not a UUIDv7` };
}
