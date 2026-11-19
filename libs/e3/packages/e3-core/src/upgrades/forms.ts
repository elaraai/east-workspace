/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How a repository upgrade step tells a stored record's form: by the type its
 * beast2 header names, which a decode refuses when it differs from the type
 * the decode reads.
 *
 * @packageDocumentation
 */

import {
  decodeBeast2For, isTypeValueEqual, readBeast2Type, toEastTypeValue, type EastType, type EastTypeValue, type ValueTypeOf,
} from '@elaraai/east';

/**
 * Whether stored bytes' header names a form's type.
 *
 * @param bytes - A stored record's bytes
 * @param type - The form's type
 * @returns Whether the header names it; false for bytes whose header does not
 *   read
 */
export function isStoredForm(bytes: Uint8Array, type: EastTypeValue): boolean {
  try {
    return isTypeValueEqual(readBeast2Type(bytes), type);
  } catch {
    return false;
  }
}

/**
 * Reads stored records in one form.
 *
 * @param type - The form's type
 * @returns A reader of a stored record's bytes: the record, or `null` for bytes
 *   of any other form, or that do not decode
 *
 * @example
 * ```ts
 * const earlier = storedFormReader(DataflowStateWithForceTasksType);
 * const state = earlier(stored.bytes);
 * if (state !== null) await stored.replace(encodeWith(carried(state)));
 * ```
 */
export function storedFormReader<T extends EastType>(type: T): (bytes: Uint8Array) => ValueTypeOf<T> | null {
  const form = toEastTypeValue(type);
  const decode = decodeBeast2For(type);
  return (bytes) => {
    if (!isStoredForm(bytes, form)) return null;
    try {
      return decode(bytes) as ValueTypeOf<T>;
    } catch {
      return null;
    }
  };
}
