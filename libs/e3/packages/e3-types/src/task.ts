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

import { StructType, StringType, ArrayType, BlobType, BooleanType, IntegerType, OptionType, ValueTypeOf, decodeBeast2For, encodeBeast2For, none } from '@elaraai/east';
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

// =============================================================================
// Partition / stream task kinds
// =============================================================================

/** Task kind of a partitioned task — the orchestrator carves its partitioned
 *  input(s) into key-range slices, runs each slice as an ordinary
 *  content-addressed execution, and assembles the output by splice or by
 *  combining partials. The spec rides {@link TaskObjectType}'s `metadata`
 *  slot as a beast2-encoded {@link PartitionTaskMetadataType}. */
export const TASK_KIND_PARTITION = 'partition';

/** Task kind of a streaming task — one execution whose runner feeds the
 *  stream input lazily and writes the output incrementally through an `emit`
 *  capability. The spec rides {@link TaskObjectType}'s `metadata` slot as a
 *  beast2-encoded {@link StreamTaskMetadataType}. */
export const TASK_KIND_STREAM = 'stream';

/**
 * Metadata of a {@link TASK_KIND_PARTITION} task.
 *
 * The task's wire `inputs` are laid out `[function_ir, ...partitions,
 * ...inputs]`, so `partitions` counts how many entries after the function IR
 * are partitioned datasets; the rest are ordinary (broadcast) inputs that
 * hash into every partition execution's identity.
 *
 * `by` and `combine` are carried as `encodeEastIR` bundles (capture-free IR +
 * its source map), not as FunctionType values or object-store hashes: IR is
 * how executable code travels everywhere on the e3 wire (`commandIr`,
 * `function_ir`, `bodyIr`), a FunctionType value could smuggle captures the
 * orchestrator must not evaluate, and inline bytes stay reachable where a
 * hash inside an opaque metadata blob would be invisible to GC.
 */
export const PartitionTaskMetadataType = StructType({
  /** Number of partitioned inputs (wire input indices `1..1+partitions`). */
  partitions: IntegerType,
  /** `encodeEastIR` bundle of the boundary-alignment projection
   *  `(Key) -> Projection`; `none` when partitioning is free per row/segment. */
  by: OptionType(BlobType),
  /** `encodeEastIR` bundle of the associative fold `(Out, Out) -> Out`;
   *  `none` in splice mode (shards concatenate). */
  combine: OptionType(BlobType),
  /** Target carved-slice size in wire bytes — the only sizing knob. */
  targetPartitionBytes: IntegerType,
});
export type PartitionTaskMetadataType = typeof PartitionTaskMetadataType;

export type PartitionTaskMetadata = ValueTypeOf<typeof PartitionTaskMetadataType>;

/** Encode a {@link PartitionTaskMetadataType} value for `TaskObject.metadata`. */
export const encodePartitionTaskMetadata: (value: PartitionTaskMetadata) => Uint8Array =
  encodeBeast2For(PartitionTaskMetadataType);

/** Decode a `TaskObject.metadata` blob of a {@link TASK_KIND_PARTITION} task. */
export const decodePartitionTaskMetadata: (data: Uint8Array) => PartitionTaskMetadata =
  decodeBeast2For(PartitionTaskMetadataType);

/**
 * Metadata of a {@link TASK_KIND_STREAM} task.
 *
 * The task's wire `inputs` are laid out `[function_ir, stream?, ...inputs]`;
 * the compiled body takes one trailing `emit` parameter beyond the wire
 * inputs, and the runner writes the `-o` file from the emit sink instead of
 * the body's (Null) return value.
 */
export const StreamTaskMetadataType = StructType({
  /** Whether wire input index 1 is the streamed input (producer tasks have
   *  no streamed input). */
  stream: BooleanType,
  /** The output collection kind the emit sink writes: `"array"`, `"set"`, or
   *  `"dict"` — element/key/value types come from the body IR's emit
   *  parameter. */
  emit: StringType,
});
export type StreamTaskMetadataType = typeof StreamTaskMetadataType;

export type StreamTaskMetadata = ValueTypeOf<typeof StreamTaskMetadataType>;

/** Encode a {@link StreamTaskMetadataType} value for `TaskObject.metadata`. */
export const encodeStreamTaskMetadata: (value: StreamTaskMetadata) => Uint8Array =
  encodeBeast2For(StreamTaskMetadataType);

/** Decode a `TaskObject.metadata` blob of a {@link TASK_KIND_STREAM} task. */
export const decodeStreamTaskMetadata: (data: Uint8Array) => StreamTaskMetadata =
  decodeBeast2For(StreamTaskMetadataType);
