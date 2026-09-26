/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The guards a record's declarations share. A mutation, an index and a
 * migration each run an author's function where the data is, again and again,
 * and each must give the same result every time it runs.
 *
 * @packageDocumentation
 */

import type { EastType } from '@elaraai/east';
import { AsyncEastIR, EastTypeType, equalFor, toEastTypeValue, walkIR } from '@elaraai/east';

// Structural East-type equality, the same primitive the redeploy type-change
// guard uses (e3-core workspaces.ts): compare the encoded EastTypeValues.
const typeValueEqual = equalFor(EastTypeType);

/**
 * Whether two East types are the same type.
 *
 * @param a - One type
 * @param b - The other
 * @returns Whether their type values are equal
 */
export function sameEastType(a: EastType, b: EastType): boolean {
  return typeValueEqual(toEastTypeValue(a), toEastTypeValue(b));
}

/**
 * Refuses an author's function that is async or reaches a platform function.
 *
 * @remarks
 * An async function implies platform IO. A synchronous platform call is an
 * ordinary function IR, so the whole body is walked for one: `walkIR` descends
 * into nested closures, loop bodies and collection-op lambdas.
 *
 * @param subject - The function as the error names it, such as
 *   `e3.mutation.reduce 'place' body`
 * @param fn - The function
 * @param why - Why the declaration refuses each, which ends its error
 * @throws {Error} When the function is async, or calls a platform function.
 */
export function checkPure(subject: string, fn: { toIR(): unknown }, why: { async: string; platform: string }): void {
  const ir = fn.toIR();
  if (ir instanceof AsyncEastIR) {
    throw new Error(`${subject} must be a synchronous East function — ${why.async}`);
  }
  walkIR((ir as { ir: never }).ir, (node) => {
    if (node.type === 'Platform') {
      throw new Error(`${subject} must not call platform functions (found '${node.value.name}') — ${why.platform}`);
    }
  });
}
