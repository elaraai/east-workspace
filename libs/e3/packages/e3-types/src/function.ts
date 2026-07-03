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

import { StructType, StringType, ArrayType, EastTypeType, OptionType, ValueTypeOf, decodeBeast2For, none } from '@elaraai/east';
import { RunnerType } from './runner.js';

/**
 * Function object stored in the object store, referenced by name from
 * `PackageObject.functions`.
 */
export const FunctionObjectType = StructType({
  /** Hash of the encoded EastIR bundle (encodeEastIR), like a task's commandIr object. */
  bodyIr: StringType,
  /** Positional parameter types — the IR's signature, surfaced for arity/type
   *  validation and `describe` without decoding the whole IR. */
  inputTypes: ArrayType(EastTypeType),
  /** Return type — used to decode the result `value` blob client-side. */
  outputType: EastTypeType,
  /** Author-chosen runtime; resolved to argv by runnerToArgv. One of the known
   *  runtime tags — there is no raw-argv runner for functions. */
  runner: RunnerType,
  /**
   * Hash of an `EnvironmentSpecType` object the function executes in;
   * `none` ⇒ the stock runtime image. Appended LAST (BEAST2 encodes struct
   * fields positionally) with a legacy dual decoder — see
   * {@link decodeFunctionObject}.
   */
  environment: OptionType(StringType),
});
export type FunctionObjectType = typeof FunctionObjectType;

export type FunctionObject = ValueTypeOf<typeof FunctionObjectType>;

/**
 * The pre-`environment` function object wire shape, kept only so
 * {@link decodeFunctionObject} can read functions exported before execution
 * environments existed.
 */
const PreEnvironmentFunctionObjectType = StructType({
  bodyIr: StringType,
  inputTypes: ArrayType(EastTypeType),
  outputType: EastTypeType,
  runner: RunnerType,
});

const decodeCurrentFunction = decodeBeast2For(FunctionObjectType);
const decodePreEnvironmentFunction = decodeBeast2For(PreEnvironmentFunctionObjectType);

/**
 * Decode a `FunctionObject` from BEAST2 bytes, tolerating the
 * pre-`environment` wire format (dual-decode migration, like
 * `decodePackageObject`).
 *
 * Every function-read path — local AND cloud — must use this instead of
 * `decodeBeast2For(FunctionObjectType)` directly. Older bytes decode with
 * `environment` defaulted to `none`.
 */
export function decodeFunctionObject(data: Uint8Array): FunctionObject {
  try {
    return decodeCurrentFunction(data);
  } catch (err) {
    try {
      const legacy = decodePreEnvironmentFunction(data);
      return { ...legacy, environment: none };
    } catch {
      throw err; // no known shape — surface the current-format error
    }
  }
}
