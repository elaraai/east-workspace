/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Function object types for e3.
 *
 * An `e3.function` is a named, typed function stored in a package and
 * invoked by name with argument values over the CLI and HTTP API. Unlike
 * a task it is not wired to datasets, not part of the dataflow graph, and
 * triggers no recomputation.
 *
 * The function object stores its signature explicitly so `describe` and
 * arity/type validation work from the small function object without
 * loading the IR bundle, and so dynamic callers (CLI literal parsing,
 * non-TS clients) have the types they need to encode arguments.
 */

import { StructType, StringType, ArrayType, EastTypeType, OptionType, ValueTypeOf, decodeBeast2For } from '@elaraai/east';
import { RunnerType } from './runner.js';

/**
 * Function object stored in the object store, referenced by name from
 * `PackageObject.functions`.
 */
export const FunctionObjectType = StructType({
  /** Hash of the encoded EastIR bundle (encodeEastIR), as a task's program is. */
  bodyIr: StringType,
  /** Positional parameter types — the IR's signature, surfaced for arity/type
   *  validation and `describe` without decoding the whole IR. */
  inputTypes: ArrayType(EastTypeType),
  /** Return type — used to decode the result `value` blob client-side. */
  outputType: EastTypeType,
  /** Author-chosen runtime: a stock runner runs the function as a unit, and a
   *  `custom` one runs its command with `run`'s arguments. */
  runner: RunnerType,
  /**
   * Hash of an `EnvironmentSpecType` object the function executes in;
   * `none` ⇒ the stock runtime image.
   */
  environment: OptionType(StringType),
});
export type FunctionObjectType = typeof FunctionObjectType;

export type FunctionObject = ValueTypeOf<typeof FunctionObjectType>;

const decodeCurrentFunction = decodeBeast2For(FunctionObjectType);

/**
 * Decode a `FunctionObject` from BEAST2 bytes.
 *
 * @remarks
 * A package-borne wire, so it changes by hard cutover: a package exported by
 * an older SDK is re-exported with the current one, and this says so.
 *
 * @param data - the stored bytes
 * @returns the function object
 * @throws {Error} When the bytes are not a current function object — a
 *   package exported by an older SDK, which is re-exported with the current
 *   one.
 */
export function decodeFunctionObject(data: Uint8Array): FunctionObject {
  try {
    return decodeCurrentFunction(data);
  } catch (err) {
    throw new Error(
      `the function object does not decode: the package was exported by an older e3 SDK — re-export it with the current one ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}
