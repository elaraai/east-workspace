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

import { StructType, StringType, ArrayType, BlobType, BooleanType, IntegerType, OptionType, ValueTypeOf, decodeBeast2For, encodeBeast2For, none, variant } from '@elaraai/east';
import type { EastTypeValue, FunctionIR } from '@elaraai/east';
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
  /**
   * `encodeEastIR` bundle of the per-key merge `(Key, Value, Value) -> Value`
   * for a Dict output; `none` otherwise.
   *
   * Its presence (or {@link mergeSets}) selects the MERGE-TREE assembly:
   * partials whose key ranges overlap are merged by the task's own runner, in
   * a tree of stream executions whose emit sink folds equal keys with this
   * function (`--merge`); disjoint partials are spliced; the orchestrator
   * never decodes a partial. Appended LAST (BEAST2 encodes struct fields
   * positionally) with a dual decoder — see {@link decodePartitionTaskMetadata}.
   */
  merge: OptionType(BlobType),
  /** Whether a Set output assembles by the merge tree, keeping one of equal
   *  elements (`--union`). The Set twin of {@link merge}, which needs no
   *  function. Appended LAST. */
  mergeSets: BooleanType,
});
export type PartitionTaskMetadataType = typeof PartitionTaskMetadataType;

export type PartitionTaskMetadata = ValueTypeOf<typeof PartitionTaskMetadataType>;

/**
 * The pre-`merge` partition metadata wire shape, kept only so
 * {@link decodePartitionTaskMetadata} can read tasks exported before the
 * segment-merge assembly existed.
 */
const PreMergePartitionTaskMetadataType = StructType({
  partitions: IntegerType,
  by: OptionType(BlobType),
  combine: OptionType(BlobType),
  targetPartitionBytes: IntegerType,
});

/** Encode a {@link PartitionTaskMetadataType} value for `TaskObject.metadata`. */
export const encodePartitionTaskMetadata: (value: PartitionTaskMetadata) => Uint8Array =
  encodeBeast2For(PartitionTaskMetadataType);

const decodeCurrentPartitionMetadata = decodeBeast2For(PartitionTaskMetadataType);
const decodePreMergePartitionMetadata = decodeBeast2For(PreMergePartitionTaskMetadataType);

/**
 * Decode a `TaskObject.metadata` blob of a {@link TASK_KIND_PARTITION} task,
 * tolerating the pre-`merge` wire format (dual-decode migration).
 *
 * @param data - the metadata blob
 * @returns the decoded metadata, with `merge`/`mergeSets` defaulted off for
 *   older bytes
 */
export function decodePartitionTaskMetadata(data: Uint8Array): PartitionTaskMetadata {
  try {
    return decodeCurrentPartitionMetadata(data);
  } catch (err) {
    try {
      return { ...decodePreMergePartitionMetadata(data), merge: none, mergeSets: false };
    } catch {
      throw err; // no known shape — surface the current-format error
    }
  }
}

/**
 * Metadata of a {@link TASK_KIND_STREAM} task.
 *
 * The task's wire `inputs` are laid out `[function_ir, merge_ir?, stream?,
 * ...inputs]` — `merge_ir` only in `function` merge mode; the compiled body
 * takes one trailing `emit` parameter beyond the wire inputs, and the runner
 * writes the `-o` file from the emit sink instead of the body's (Null) return
 * value.
 */
export const StreamTaskMetadataType = StructType({
  /** Whether the first input after the IRs is the streamed input (producer
   *  tasks have no streamed input). */
  stream: BooleanType,
  /** The output collection kind the emit sink writes: `"array"`, `"set"`, or
   *  `"dict"` — element/key/value types come from the body IR's emit
   *  parameter. */
  emit: StringType,
  /**
   * How the emit sink treats equal keys, a `StreamMergeMode`: `"none"` —
   * a duplicate key is an error; `"function"` — wire input 1 is the merge IR
   * `(K, V, V) -> V`, folding equal Dict keys; `"union"` — equal Set elements
   * collapse. Appended LAST (BEAST2 encodes struct fields positionally) with a
   * dual decoder — see {@link decodeStreamTaskMetadata}.
   */
  merge: StringType,
});
export type StreamTaskMetadataType = typeof StreamTaskMetadataType;

export type StreamTaskMetadata = ValueTypeOf<typeof StreamTaskMetadataType>;

/**
 * The pre-`merge` stream metadata wire shape, kept only so
 * {@link decodeStreamTaskMetadata} can read tasks exported before folding
 * emit sinks existed.
 */
const PreMergeStreamTaskMetadataType = StructType({
  stream: BooleanType,
  emit: StringType,
});

/** Encode a {@link StreamTaskMetadataType} value for `TaskObject.metadata`. */
export const encodeStreamTaskMetadata: (value: StreamTaskMetadata) => Uint8Array =
  encodeBeast2For(StreamTaskMetadataType);

const decodeCurrentStreamMetadata = decodeBeast2For(StreamTaskMetadataType);
const decodePreMergeStreamMetadata = decodeBeast2For(PreMergeStreamTaskMetadataType);

/**
 * Decode a `TaskObject.metadata` blob of a {@link TASK_KIND_STREAM} task,
 * tolerating the pre-`merge` wire format (dual-decode migration).
 *
 * @param data - the metadata blob
 * @returns the decoded metadata, with `merge` defaulted to `"none"` for older
 *   bytes
 */
export function decodeStreamTaskMetadata(data: Uint8Array): StreamTaskMetadata {
  try {
    return decodeCurrentStreamMetadata(data);
  } catch (err) {
    try {
      return { ...decodePreMergeStreamMetadata(data), merge: 'none' };
    } catch {
      throw err; // no known shape — surface the current-format error
    }
  }
}

// =============================================================================
// Partition plan
// =============================================================================

/**
 * The plan of a partitioned execution (issue #770): the partitioned inputs,
 * where each partition starts in every one of them, and the carved slices.
 *
 * @remarks
 * `partitionTaskExecute` writes it to the object store once every partition
 * has run, and points the `plan` sidecar of the execution's
 * `(taskHash, inputsHash)` directory at it, so a re-plan or a resume that
 * computes the same `partitions`/`boundaries`/`splits` reuses the slices
 * instead of carving them again.
 */
export const PartitionPlanType = StructType({
  /** Partitioned input hashes, wire order. */
  partitions: ArrayType(StringType),
  /** First segment index of each partition of the primary; boundaries[0] = 0. */
  boundaries: ArrayType(IntegerType),
  /** Per secondary (partitions[1..]): the split point of every partition plus the end; length boundaries.length + 1. */
  splits: ArrayType(ArrayType(StructType({ seg: IntegerType, offset: IntegerType }))),
  /** slices[input][partition] object hashes; empty until carved. */
  slices: ArrayType(ArrayType(StringType)),
});
export type PartitionPlanType = typeof PartitionPlanType;

export type PartitionPlan = ValueTypeOf<typeof PartitionPlanType>;

/** Encode a {@link PartitionPlanType} value for the object store. */
export const encodePartitionPlan: (value: PartitionPlan) => Uint8Array =
  encodeBeast2For(PartitionPlanType);

/** Decode a {@link PartitionPlanType} object. */
export const decodePartitionPlan: (data: Uint8Array) => PartitionPlan =
  decodeBeast2For(PartitionPlanType);

// =============================================================================
// Partition `by` projections
// =============================================================================

/**
 * The shape a partition task's `by` projection reads, as extracted from its
 * IR by {@link partitionProjectionShape}.
 *
 * - `fields`: the identity (`names: []`), or a leading prefix of the key's
 *   top-level fields — one field, or a struct literal of fields in declared
 *   order. Validated against each dataset's top-level key field order.
 * - `path`: a nested leading-field path (`key.a.b`, two or more steps).
 *   Validated per step: each must read the FIRST field of its level's
 *   struct, which is what keeps the projection monotone in canonical key
 *   order.
 */
export interface ProjectionShape {
  /** Top-level fields (or the identity), or a nested first-field path. */
  kind: 'fields' | 'path';
  /** The fields read, in order; empty for the identity. */
  names: string[];
}

/**
 * Extracts the shape a `by` projection reads — see {@link ProjectionShape} —
 * or `null` for any other (unaccepted) shape.
 *
 * @param ir - the projection's function IR, `(Key) -> Projection`
 * @returns the shape, or `null` when the body is not an accepted projection
 */
export function partitionProjectionShape(ir: FunctionIR): ProjectionShape | null {
  const param = ir.value.parameters[0]?.value.name;
  if (param === undefined) return null;

  // Chase wrappers to the expression the body evaluates to.
  const unwrap = (node: any): any => {
    for (;;) {
      if (node.type === 'Block') {
        const statements = node.value.statements;
        if (statements.length === 0) return node;
        node = statements[statements.length - 1];
      } else if (node.type === 'Return') {
        node = node.value.value;
      } else if (node.type === 'As' || node.type === 'WrapRecursive' || node.type === 'UnwrapRecursive') {
        node = node.value.value;
      } else {
        return node;
      }
    }
  };

  const isParam = (node: any): boolean => node.type === 'Variable' && node.value.name === param;
  const fieldOf = (node: any): string | null =>
    node.type === 'GetField' && isParam(unwrap(node.value.struct)) ? node.value.field as string : null;
  // Walks a GetField chain down to the parameter: `key.a.b` → ['a', 'b'].
  const pathOf = (node: any): string[] | null => {
    const path: string[] = [];
    let cur = node;
    while (cur.type === 'GetField') {
      path.unshift(cur.value.field as string);
      cur = unwrap(cur.value.struct);
    }
    return isParam(cur) && path.length > 0 ? path : null;
  };

  const body = unwrap(ir.value.body as any);
  if (isParam(body)) return { kind: 'fields', names: [] };
  const chain = pathOf(body);
  if (chain !== null) {
    // A one-step chain is a top-level field read — the `fields` family.
    return chain.length === 1 ? { kind: 'fields', names: chain } : { kind: 'path', names: chain };
  }
  if (body.type === 'Struct') {
    const fields: string[] = [];
    for (const { value } of body.value.fields) {
      const f = fieldOf(unwrap(value));
      if (f === null) return null;
      fields.push(f);
    }
    return { kind: 'fields', names: fields };
  }
  return null;
}

/**
 * The East type of a projected key — the type {@link projectKey} values have,
 * and the one to build their comparator for: the key type itself for the
 * identity, a struct of the named leading fields in declared order, or the
 * type at the end of a nested first-field path.
 *
 * @param shape - the projection's shape
 * @param keyType - the partitioned dataset's key type
 * @returns the projected key type
 * @throws {Error} When the shape reads a field the key type does not have.
 *
 * @example
 * ```ts
 * const cmp = compareFor(projectedKeyType(shape, keyTypeValue));
 * cmp(projectKey(shape, a), projectKey(shape, b));
 * ```
 */
export function projectedKeyType(shape: ProjectionShape, keyType: EastTypeValue): EastTypeValue {
  if (shape.names.length === 0) return keyType;
  const fieldType = (level: EastTypeValue, name: string): EastTypeValue => {
    const field = level.type === 'Struct' ? level.value.find((f) => f.name === name) : undefined;
    if (field === undefined) {
      throw new Error(`partition projection reads field '${name}' of a key level that has no such field`);
    }
    return field.type as EastTypeValue;
  };
  if (shape.kind === 'path') return shape.names.reduce(fieldType, keyType);
  return variant('Struct', shape.names.map((name) => ({ name, type: fieldType(keyType, name) })));
}

/**
 * Projects a partition key through a `by` shape, without compiling the
 * projection: the key itself for the identity, a struct of the named leading
 * fields built field by field in declared order, or the value at the end of a
 * nested first-field path.
 *
 * @param shape - the projection's shape
 * @param key - a key of the partitioned dataset
 * @returns the projected key, a value of {@link projectedKeyType}
 */
export function projectKey(shape: ProjectionShape, key: unknown): unknown {
  if (shape.names.length === 0) return key;
  if (shape.kind === 'path') {
    return shape.names.reduce((level, name) => (level as Record<string, unknown>)[name], key);
  }
  const projected: Record<string, unknown> = {};
  for (const name of shape.names) projected[name] = (key as Record<string, unknown>)[name];
  return projected;
}
