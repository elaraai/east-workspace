/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The patch type of a record's rows, whose type its declaration gives.
 *
 * A write program's row type is the record's, known only as the program is
 * built, and TypeScript cannot compute the patch of a type it does not know:
 * it recurses without end. So a row's patch type is East's own, made from the
 * type's runtime form; the patch functions over it are East's too,
 * `East.patchesFor(type)`.
 *
 * @packageDocumentation
 */
import { PatchType, toEastTypeValue, type EastType } from '@elaraai/east';

/**
 * The patch type of a type known only at run time: East's own, made from the
 * type's runtime form, as a generic factory makes it.
 *
 * @param type - The type
 * @returns `PatchType(type)`
 */
export function patchTypeOf(type: EastType): EastType {
  return PatchType(toEastTypeValue(type));
}
