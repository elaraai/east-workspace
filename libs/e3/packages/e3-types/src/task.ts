/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task object types for e3.
 *
 * A task object defines a complete executable unit: the command IR that
 * generates the exec args, where to read inputs from, and where to write output.
 *
 * Task objects are stored in the object store and referenced by packages.
 * They are content-addressed, enabling deduplication and memoization.
 *
 * Input and output types are inferred from the package's structure at the
 * specified paths - the task just references locations, not types.
 */

import { StructType, StringType, ArrayType, BlobType, OptionType, ValueTypeOf, decodeBeast2For, none } from '@elaraai/east';
import { TreePathType } from './structure.js';
import { RunnerType } from './runner.js';

/**
 * Task object stored in the object store.
 *
 * A task is a complete executable unit that reads from input dataset paths
 * and writes to an output dataset path. The commandIr is evaluated at runtime
 * to produce the exec args.
 *
 * @remarks
 * - `commandIr`: Hash of East IR object that produces exec args
 *   - IR signature: (inputs: Array<String>, output: String) -> Array<String>
 *   - `inputs` are paths to staged input .beast2 files
 *   - `output` is the path where output should be written
 *   - Returns array of strings to exec (e.g., ["sh", "-c", "python ..."])
 * - `inputs`: Paths to input datasets in the data tree
 * - `output`: Path to the output dataset in the data tree
 *
 * Types are not stored in the task - they are inferred from the package's
 * structure at the specified paths. This keeps tasks simple and avoids
 * redundant type information.
 *
 * @example
 * ```ts
 * import { variant } from '@elaraai/east';
 *
 * // Task with command IR that generates: ["sh", "-c", "python script.py <input> <output>"]
 * const task: TaskObject = {
 *   commandIr: '5e7a3b...',  // hash of compiled IR
 *   inputs: [
 *     [variant('field', 'inputs'), variant('field', 'sales')],
 *   ],
 *   output: [variant('field', 'tasks'), variant('field', 'train'), variant('field', 'output')],
 * };
 * ```
 */
export const TaskObjectType = StructType({
  /** Hash of East IR that generates exec args: (inputs, output) -> Array<String> */
  commandIr: StringType,
  /** Input paths: where to read each input dataset from the data tree */
  inputs: ArrayType(TreePathType),
  /** Output path: where to write the output dataset in the data tree */
  output: TreePathType,
  /** Task kind: "data" (default), "ui", or future extensions. None for old packages. */
  kind: OptionType(StringType),
  /** Opaque extension metadata (beast2-encoded). Interpreted by the kind-specific consumer. */
  metadata: OptionType(BlobType),
  /**
   * The task's runner, as routing metadata (symmetric with
   * FunctionObject.runner). For `custom` runners, `commandIr` remains
   * authoritative for execution — the wire command is informational.
   *
   * NOTE: added as a hard cutover (no dual decoder) — packages exported by
   * older SDKs must be re-exported.
   */
  runner: RunnerType,
  /**
   * Hash of an {@link EnvironmentSpecType} object the task executes in;
   * `none` ⇒ the stock runtime image. Appended LAST (BEAST2 encodes struct
   * fields positionally) with a legacy dual decoder — see
   * {@link decodeTaskObject}.
   */
  environment: OptionType(StringType),
});
export type TaskObjectType = typeof TaskObjectType;

export type TaskObject = ValueTypeOf<typeof TaskObjectType>;

/**
 * The pre-`environment` task object wire shape, kept only so
 * {@link decodeTaskObject} can read tasks exported before execution
 * environments existed.
 */
const PreEnvironmentTaskObjectType = StructType({
  commandIr: StringType,
  inputs: ArrayType(TreePathType),
  output: TreePathType,
  kind: OptionType(StringType),
  metadata: OptionType(BlobType),
  runner: RunnerType,
});

const decodeCurrentTask = decodeBeast2For(TaskObjectType);
const decodePreEnvironmentTask = decodeBeast2For(PreEnvironmentTaskObjectType);

/**
 * Decode a `TaskObject` from BEAST2 bytes, tolerating the pre-`environment`
 * wire format (dual-decode migration, like {@link decodePackageObject}).
 *
 * Every task-read path — local AND cloud — must use this instead of
 * `decodeBeast2For(TaskObjectType)` directly. Older bytes decode with
 * `environment` defaulted to `none`.
 */
export function decodeTaskObject(data: Uint8Array): TaskObject {
  try {
    return decodeCurrentTask(data);
  } catch (err) {
    try {
      const legacy = decodePreEnvironmentTask(data);
      return { ...legacy, environment: none };
    } catch {
      throw err; // no known shape — surface the current-format error
    }
  }
}
