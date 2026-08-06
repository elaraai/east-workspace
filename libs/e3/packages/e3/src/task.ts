/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task definitions for e3 packages.
 *
 * Tasks are organized under `.tasks.${name}` with:
 * - `.tasks.${name}.function_ir` - The compiled IR (private)
 * - `.tasks.${name}.output` - The output dataset (public)
 */

import type { AsyncFunctionExpr, BlockBuilder, CallableAsyncFunctionExpr, CallableFunctionExpr, DictType, EastType, ExprType, FunctionExpr, FunctionIR, NeverType, SetType, SubtypeExprOrValue } from '@elaraai/east';
import { Expr, variant, some, none, ArrayType, StringType, NullType, FunctionType, StructType, East, IRType, EastIR, AsyncEastIR, encodeEastIR, toEastTypeValue, isTypeValueEqual } from '@elaraai/east';
import { TASK_KIND_PARTITION, TASK_KIND_STREAM, encodePartitionTaskMetadata, encodeStreamTaskMetadata } from '@elaraai/e3-types';
import type { DatasetDef, DataTreeDef, TaskDef } from './types.js';
import { DEFAULT_RUNNER, runnerToCommand, type Runner } from './runner.js';
import { validateEnvironmentDecl, type EnvironmentDecl } from './environment.js';

/**
 * Helper type to extract East types from DatasetDef array.
 * Preserves tuple structure when T is a tuple.
 */
type ExtractDatasetTypes<T extends readonly DatasetDef[]> = {
  [K in keyof T]: T[K] extends DatasetDef<infer U> ? U : never;
} & EastType[];

/**
 * Singleton tree definition for `.tasks`.
 *
 * All task subtrees are children of this tree.
 */
export const tasksTree: DataTreeDef = {
  kind: 'datatree',
  name: 'tasks',
  path: [variant('field', 'tasks')],
  deps: new Set(),
};

/**
 * Creates a subtree for a task at `.tasks.${name}`.
 *
 * @param name - Task name
 * @returns A DataTreeDef for the task's subtree
 */
function createTaskTree(name: string): DataTreeDef {
  return {
    kind: 'datatree',
    name,
    path: [variant('field', 'tasks'), variant('field', name)],
    deps: new Set([tasksTree]),
  };
}

/**
 * Creates a function_ir dataset for a task at `.tasks.${name}.function_ir`.
 *
 * @param name - Task name
 * @param taskTree - The task's subtree
 * @param ir - The compiled function IR
 * @returns A DatasetDef for the function IR (private, not typed)
 */
function createFunctionIRDataset(name: string, taskTree: DataTreeDef, eastIR: EastIR<any, any> | AsyncEastIR<any, any>): DatasetDef {
  return {
    kind: 'dataset',
    name: 'function_ir',
    path: [variant('field', 'tasks'), variant('field', name), variant('field', 'function_ir')],
    type: IRType,
    // Store the full EastIR/AsyncEastIR bundle so export.ts can use encodeEastIR
    // and preserve source_map into the beast2 blob.
    default: eastIR as any,
    writable: false,
    deps: new Set([...taskTree.deps, taskTree]),
  };
}

/**
 * Creates an output dataset for a task at `.tasks.${name}.output`.
 *
 * @param name - Task name
 * @param taskTree - The task's subtree
 * @param outputType - The East type of the output
 * @returns A DatasetDef for the output
 */
function createOutputDataset<Name extends string, Output extends EastType>(
  name: Name,
  taskTree: DataTreeDef,
  outputType: Output,
): DatasetDef<Output, [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>]> {
  return {
    kind: 'dataset',
    name: 'output',
    path: [variant('field', 'tasks'), variant('field', name), variant('field', 'output')],
    type: outputType,
    writable: false,
    deps: new Set([...taskTree.deps, taskTree]),
  };
}

/**
 * Collects all dependencies for a task.
 *
 * Walks the dependency graph to include:
 * - The task's subtree and its contents (function_ir, output)
 * - All input datasets and their dependencies
 */
function collectDeps(
  taskTree: DataTreeDef,
  outputDataset: DatasetDef,
  inputs: DatasetDef[],
): Set<DataTreeDef | DatasetDef | TaskDef> {
  const deps = new Set<DataTreeDef | DatasetDef | TaskDef>();

  // Include tasksTree
  deps.add(tasksTree);

  // Include the task's subtree
  deps.add(taskTree);

  // Include all input datasets and their deps
  for (const input of inputs) {
    for (const dep of input.deps) {
      deps.add(dep);
    }
    deps.add(input);
  }

  // Include the output dataset (after inputs, so it comes last in topological order)
  deps.add(outputDataset);

  return deps;
}

/**
 * Defines a task that runs an East function to produce an output dataset.
 *
 * Tasks read from input datasets and produce an output dataset.
 * When input datasets change, the task re-runs automatically.
 *
 * Task structure:
 * - `.tasks.${name}.function_ir` - The compiled IR (private)
 * - `.tasks.${name}.output` - The output dataset
 *
 * @typeParam Name - Task name (literal type)
 * @typeParam Inputs - Input dataset types
 * @typeParam Output - Output type
 * @param name - Task name
 * @param inputs - Input datasets to read from
 * @param fn - Implementation function
 * @returns A TaskDef with `.output` for chaining
 * 
 * @see {@link customTask} for defining tasks with custom command logic (e.g. performing non-East operations).
 *
 * @example
 * ```ts
 * const input_name = e3.input('name', StringType, 'World');
 *
 * const say_hello = e3.task(
 *   'say_hello',
 *   [input_name],
 *   ($, name) => str`Hello, ${name}!`
 * );
 *
 * // Use output in another task
 * const use_greeting = e3.task(
 *   'use_greeting',
 *   [say_hello.output],
 *   ($, greeting) => ...
 * );
 * ```
 */
export function task<Name extends string, Inputs extends readonly DatasetDef[], Output extends EastType>(
  name: Name,
  inputs: [...Inputs],
  fn: FunctionExpr<ExtractDatasetTypes<Inputs>, Output>
    | CallableFunctionExpr<ExtractDatasetTypes<Inputs>, Output>
    | AsyncFunctionExpr<ExtractDatasetTypes<Inputs>, Output>
    | CallableAsyncFunctionExpr<ExtractDatasetTypes<Inputs>, Output>,
  config?: { runner?: Runner, kind?: string, metadata?: Uint8Array, environment?: EnvironmentDecl },
): TaskDef<Output, [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>]>;
export function task(
  name: string,
  inputs: DatasetDef[],
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: { runner?: Runner, kind?: string, metadata?: Uint8Array, environment?: EnvironmentDecl },
): TaskDef {
  if (config?.environment) validateEnvironmentDecl(config.environment, name);
  // Keep the full EastIR bundle (IR + source_map) so we don't drop the
  // source map before it reaches the beast2 encoder in export.ts.
  const eastIR = fn.toIR();
  const outputType = Expr.type(fn as Expr<any>).output as EastType;

  // Create the task's subtree at .tasks.${name}
  const taskTree = createTaskTree(name);

  // Create the function_ir dataset (private, holds the IR bundle)
  const functionIRDataset = createFunctionIRDataset(name, taskTree, eastIR);

  // The first input is the FunctionIR to execute
  const input_datasets = [
    functionIRDataset,
    ...inputs
  ];

  // Create the output dataset
  const output = createOutputDataset(name, taskTree, outputType);

  // Resolve the typed Runner to argv at task-definition time. The variant is
  // SDK-only metadata: it never reaches the IR or the wire — only the
  // resolved string array does, baked in as an East constant below. Default
  // is east-node + east-node-std (every e3 project has Node already).
  const argvPrefix = runnerToCommand(config?.runner ?? DEFAULT_RUNNER);

  // Build the command IR. At task-execution time this East function is
  // evaluated with the staged input/output paths and returns the final argv.
  const commandFn = East.function(
    [ArrayType(StringType), StringType],
    ArrayType(StringType),
    ($, input_paths, output_path) => {
      const command = $.let(argvPrefix, ArrayType(StringType));

      // Function argument paths
      const i = $.let(1n);
      $.while(East.less(i, input_paths.size()), $ => {
        $(command.pushLast("-i"));
        $(command.pushLast(input_paths.get(i)));
        $.assign(i, i.add(1n));
      });

      // Output path
      $(command.pushLast('-o'))
      $(command.pushLast(output_path))

      // Function IR is the first input
      $(command.pushLast(input_paths.get(0n)))

      $.return(command);
    }
  );

  const taskDef: TaskDef = {
    kind: 'task',
    name,
    // Keep the full EastIR bundle so export.ts can encode with source map.
    command: commandFn.toIR() as EastIR<[string[], string], string[]>,
    inputs: input_datasets,
    output,
    deps: collectDeps(taskTree, output, input_datasets),
    taskKind: config?.kind,
    metadata: config?.metadata,
    runner: config?.runner ?? DEFAULT_RUNNER,
    environment: config?.environment,
  };

  // Add the task to the output's deps so downstream tasks collect this task's deps
  output.deps.add(taskDef);

  return taskDef;
}

export function customTask<Name extends string, Inputs extends Array<DatasetDef>, Output extends EastType>(
  name: Name,
  inputs: Inputs,
  outputType: Output,
  command: ($: BlockBuilder<StringType>, input_paths: ExprType<ArrayType<StringType>>, output_path: ExprType<StringType>) => Expr<StringType> | void,
  config?: { environment?: EnvironmentDecl },
): TaskDef<Output, [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>]> {
  if (config?.environment) validateEnvironmentDecl(config.environment, name);

  // Create the task's subtree at .tasks.${name}
  const taskTree = createTaskTree(name);

  // Create the output dataset
  const output = createOutputDataset(name, taskTree, outputType);

  // Build the user's bash script string
  const bashCommandFn = East.function(
    [ArrayType(StringType), StringType],
    StringType,
    command
  );

  // Build the command to execute this in bash
  const commandFn = East.function(
    [ArrayType(StringType), StringType],
    ArrayType(StringType),
    ($, input_paths, output_path) => ["bash", "-c", bashCommandFn(input_paths, output_path)]
  );

  const taskDef: TaskDef<Output, [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>]> = {
    kind: 'task',
    name,
    // Keep the full EastIR bundle so export.ts can encode with source map.
    command: commandFn.toIR() as EastIR<[string[], string], string[]>,
    inputs,
    output,
    deps: collectDeps(taskTree, output, inputs),
    environment: config?.environment,
  };

  // Add the task to the output's deps so downstream tasks collect this task's deps
  output.deps.add(taskDef);

  return taskDef;
}

// =============================================================================
// Partitioned tasks
// =============================================================================

/** The task-output path tuple for task `Name`. */
type TaskOutputPath<Name extends string> = [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>];

/** The expression parameters a body callback receives for a dataset tuple. */
type DatasetExprs<T extends readonly DatasetDef[]> = {
  [K in keyof T]: T[K] extends DatasetDef<infer U> ? ExprType<U> : never;
};

/** The key type a partitioned collection is carved by: Dict keys, Set
 *  elements, or Array elements. */
type CollectionKeyType<T> =
  T extends DictType<infer K, any> ? K :
  T extends SetType<infer E> ? E :
  T extends ArrayType<infer E> ? E :
  never;

/** The per-dataset key types of a partition tuple. */
type PartitionKeyTypes<Ps extends readonly DatasetDef[]> = {
  [K in keyof Ps]: Ps[K] extends DatasetDef<infer T> ? CollectionKeyType<T> : never;
};

/** Field-wise intersection of two key types: for struct keys, the fields
 *  present in both with the identical East type; otherwise the types must
 *  agree exactly. */
type IntersectKeys<A, B> =
  A extends StructType<infer FA> ? B extends StructType<infer FB>
    ? StructType<{ [F in keyof FA & keyof FB as FA[F] extends FB[F] ? (FB[F] extends FA[F] ? F : never) : never]: FA[F] }>
    : never
  : A extends B ? (B extends A ? A : never) : never;

/** The strict field-wise intersection of every partitioned dataset's key
 *  type — what a co-partitioned `by` projection receives. */
type PartitionByKey<Ps extends readonly DatasetDef[]> =
  PartitionKeyTypes<Ps> extends readonly [infer Only] ? Only :
  PartitionKeyTypes<Ps> extends readonly [infer A, ...infer Rest] ? IntersectKeysAll<A, Rest> :
  never;

/** Folds {@link IntersectKeys} over the remaining key types. */
type IntersectKeysAll<A, Rest> =
  Rest extends readonly [] ? A :
  Rest extends readonly [infer B, ...infer More] ? IntersectKeysAll<IntersectKeys<A, B>, More> :
  never;

/**
 * The declaration half of {@link partitionTask} — everything structural about
 * the task; the body comes last as the `fn` argument.
 *
 * @typeParam Partitions - The partitioned (huge, co-partitioned) input datasets
 * @typeParam Inputs - The ordinary input datasets
 * @typeParam Output - The output dataset's East type
 */
export interface PartitionTaskSpec<
  Partitions extends readonly [DatasetDef, ...DatasetDef[]],
  Inputs extends readonly DatasetDef[],
  Output extends EastType,
> {
  /** One or more huge collection inputs, carved into shared key-range
   *  partitions. Two or more entries co-partition: all must be Dict or all
   *  Set roots with a shared key space. */
  readonly partitions: [...Partitions];
  /** Boundary-alignment projection: rows with equal `by(key)` never split
   *  across partitions. Must read a leading prefix of every partitioned
   *  dataset's key — the identity, one leading field, or a struct of leading
   *  fields in order — so aligned runs stay contiguous in canonical order. */
  readonly by?: ($: BlockBuilder<NeverType>, key: ExprType<PartitionByKey<Partitions>>) => unknown;
  /** Ordinary inputs, passed whole to every partition execution (small ⇒
   *  broadcast; huge + indexed ⇒ opened lazily by the runner). Any change to
   *  them re-runs all partitions. */
  readonly inputs?: [...Inputs];
  /** The output dataset's East type. */
  readonly output: Output;
  /** Associative fold merging two partials into one. When present, each
   *  partition execution returns a partial of the output and partials fold
   *  pairwise in a fixed tree order; when absent, each execution returns its
   *  shard of the output and the shards splice in partition order. */
  readonly combine?: ($: BlockBuilder<Output>, a: ExprType<Output>, b: ExprType<Output>) => SubtypeExprOrValue<Output> | void;
  /** Target carved-slice size in wire bytes. Defaults to 256 MiB. */
  readonly targetPartitionBytes?: number;
  /** Runtime the body runs on; defaults to {@link DEFAULT_RUNNER}. */
  readonly runner?: Runner;
  /** Execution environment declaration, as for {@link task}. */
  readonly environment?: EnvironmentDecl;
}

/** Default carved-slice byte target for {@link partitionTask}. */
const DEFAULT_TARGET_PARTITION_BYTES = 256 * 1024 * 1024;

/** The East key type a collection dataset is carved by. */
function collectionKeyType(name: string, dataset: DatasetDef): EastType {
  const type = dataset.type as EastType & { key?: EastType; value?: EastType };
  switch (type.type) {
    case 'Dict': return type.key!;
    case 'Set': return type.key!;
    case 'Array': return type.value!;
    default:
      throw new Error(`partitionTask '${name}': partitioned dataset '${dataset.name}' must be a collection (Array, Set or Dict), got ${type.type}`);
  }
}

/** Extracts the leading-prefix field path a `by` projection reads: `[]` for
 *  the identity, `[f]` for one field, `[f1..fn]` for a struct of fields in
 *  declaration order — or `null` for any other shape. */
function projectionFieldPrefix(ir: FunctionIR): string[] | null {
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

  const body = unwrap(ir.value.body as any);
  if (isParam(body)) return [];
  const single = fieldOf(body);
  if (single !== null) return [single];
  if (body.type === 'Struct') {
    const fields: string[] = [];
    for (const { value } of body.value.fields) {
      const f = fieldOf(unwrap(value));
      if (f === null) return null;
      fields.push(f);
    }
    return fields;
  }
  return null;
}

/**
 * Defines a partitioned task: e3 carves the huge partitioned input(s) into
 * key-range slices, runs `fn` once per partition as an ordinary
 * content-addressed execution (parallel, memoized per partition), and
 * assembles the output — by splicing shards in partition order, or by
 * folding partials pairwise when `combine` is given.
 *
 * `fn` always returns the output type: without `combine` each execution
 * returns its *shard* of the output (Array shards concatenate freely;
 * Dict/Set shard key ranges must ascend disjointly in partition order — any
 * key-preserving or monotone re-keying transform qualifies, and a violation
 * fails the task at splice naming the offending partitions); with `combine`
 * each execution returns a *partial* and the partials fold.
 *
 * Parameter order is fixed and fully typed: the partition slices first (in
 * declared order, each typed as its dataset's own collection type), then the
 * ordinary `inputs` in order.
 *
 * @typeParam Name - Task name (literal type)
 * @typeParam Partitions - Partitioned input dataset defs
 * @typeParam Inputs - Ordinary input dataset defs
 * @typeParam Output - Output type
 * @param name - Task name
 * @param spec - The declaration: partitioned inputs, alignment, output type,
 *   combine mode, sizing, runner and environment
 * @param fn - Implementation body, run once per partition
 * @returns A TaskDef with `.output` for chaining
 * @throws {Error} When a partitioned dataset is not a collection, partitions
 *   mix collection kinds (or include Arrays) under co-partitioning, key
 *   types cannot align, or `by` does not read a leading prefix of every
 *   partitioned dataset's key.
 *
 * @example
 * ```ts
 * const sales = e3.input('sales', DictType(StringType, SaleType));
 *
 * const cleaned = e3.partitionTask('cleaned', {
 *   partitions: [sales],
 *   output: DictType(StringType, SaleType),
 * }, ($, slice) => slice.filter(($, sale) => East.greater(sale.qty, 0n)));
 * ```
 */
export function partitionTask<
  Name extends string,
  const Partitions extends readonly [DatasetDef, ...DatasetDef[]],
  const Inputs extends readonly DatasetDef[] = [],
  Output extends EastType = EastType,
>(
  name: Name,
  spec: PartitionTaskSpec<Partitions, Inputs, Output>,
  fn: (
    $: BlockBuilder<Output>,
    ...args: [...DatasetExprs<Partitions>, ...DatasetExprs<Inputs>]
  ) => SubtypeExprOrValue<Output> | void,
): TaskDef<Output, TaskOutputPath<Name>> {
  const partitions = spec.partitions as readonly DatasetDef[];
  const inputs = (spec.inputs ?? []) as readonly DatasetDef[];
  const output = spec.output as EastType;

  // Partitioned inputs must be collections; co-partitioning is restricted to
  // Dict/Set roots (a shared key space must exist for boundary alignment —
  // an Array has none).
  const keyTypes = partitions.map((p) => collectionKeyType(name, p));
  const kinds = partitions.map((p) => (p.type as EastType).type);
  if (partitions.length > 1) {
    const first = kinds[0]!;
    if (first === 'Array' || kinds.some((k) => k !== first)) {
      throw new Error(
        `partitionTask '${name}': co-partitioning is restricted to Dict/Set roots sharing a key space — ` +
        `got [${kinds.join(', ')}]. Partition one dataset and access the others as ordinary inputs, or re-key upstream.`
      );
    }
  }

  // The `by` parameter type: a single partition's own key, or the strict
  // field-wise intersection of every key struct under co-partitioning.
  let byParamType: EastType;
  if (partitions.length === 1) {
    byParamType = keyTypes[0]!;
  } else if (keyTypes.every((k) => k.type === 'Struct')) {
    const first = keyTypes[0]! as EastType & { fields: Record<string, EastType> };
    const shared: Record<string, EastType> = {};
    for (const [field, fieldType] of Object.entries(first.fields)) {
      const everywhere = keyTypes.every((k) => {
        const other = (k as EastType & { fields: Record<string, EastType> }).fields[field];
        return other !== undefined && isTypeValueEqual(toEastTypeValue(other), toEastTypeValue(fieldType));
      });
      if (everywhere) shared[field] = fieldType;
    }
    if (Object.keys(shared).length === 0) {
      throw new Error(`partitionTask '${name}': co-partitioned key types share no identically-typed fields — the datasets have no common key space`);
    }
    byParamType = StructType(shared);
  } else {
    const first = toEastTypeValue(keyTypes[0]!);
    if (!keyTypes.every((k) => isTypeValueEqual(toEastTypeValue(k), first))) {
      throw new Error(`partitionTask '${name}': co-partitioned key types must be identical (or share struct fields) for boundary alignment`);
    }
    byParamType = keyTypes[0]!;
  }

  // Reify `by` and validate the leading-prefix soundness condition per
  // dataset: struct keys sort lexicographically by declared field order, so
  // the projection must read a leading prefix of each dataset's OWN order.
  let byIr: Uint8Array | undefined;
  if (spec.by !== undefined) {
    const byFn = East.function([byParamType], undefined, spec.by as any);
    const bundle = byFn.toIR();
    const prefix = projectionFieldPrefix(bundle.ir as FunctionIR);
    if (prefix === null) {
      throw new Error(
        `partitionTask '${name}': \`by\` must project a leading prefix of the partition key — ` +
        `the key itself, one leading field, or a struct of leading fields in order`
      );
    }
    if (prefix.length > 0) {
      for (let i = 0; i < partitions.length; i++) {
        const keyType = keyTypes[i]!;
        if (keyType.type !== 'Struct') {
          throw new Error(
            `partitionTask '${name}': \`by\` reads key fields, but partitioned dataset '${partitions[i]!.name}' has a non-struct key (${keyType.type}) — use the identity projection`
          );
        }
        const order = Object.keys((keyType as EastType & { fields: Record<string, EastType> }).fields);
        const misaligned = prefix.length > order.length || prefix.some((f, j) => order[j] !== f);
        if (misaligned) {
          throw new Error(
            `partitionTask '${name}': \`by\` projects (${prefix.join(', ')}), which is not a leading prefix of ` +
            `partitioned dataset '${partitions[i]!.name}' key field order (${order.join(', ')})`
          );
        }
      }
    }
    byIr = encodeEastIR(bundle);
  }

  // Reify `combine` as a free East function (Out, Out) -> Out.
  let combineIr: Uint8Array | undefined;
  if (spec.combine !== undefined) {
    const combineFn = East.function([output, output], output, spec.combine as any);
    combineIr = encodeEastIR(combineFn.toIR());
  }

  const targetPartitionBytes = spec.targetPartitionBytes ?? DEFAULT_TARGET_PARTITION_BYTES;
  if (!Number.isInteger(targetPartitionBytes) || targetPartitionBytes <= 0) {
    throw new Error(`partitionTask '${name}': targetPartitionBytes must be a positive integer, got ${spec.targetPartitionBytes}`);
  }

  const bodyFn = East.function(
    [...partitions.map((p) => p.type), ...inputs.map((i) => i.type)] as EastType[],
    output,
    fn as any,
  );

  const metadata = encodePartitionTaskMetadata({
    partitions: BigInt(partitions.length),
    by: byIr !== undefined ? some(byIr) : none,
    combine: combineIr !== undefined ? some(combineIr) : none,
    targetPartitionBytes: BigInt(targetPartitionBytes),
  });

  return task(
    name,
    [...partitions, ...inputs] as DatasetDef[],
    bodyFn as any,
    {
      kind: TASK_KIND_PARTITION,
      metadata,
      ...(spec.runner !== undefined && { runner: spec.runner }),
      ...(spec.environment !== undefined && { environment: spec.environment }),
    },
  ) as TaskDef<Output, TaskOutputPath<Name>>;
}

// =============================================================================
// Streaming tasks
// =============================================================================

/** The `emit` capability's function type for an output collection: Dict
 *  outputs emit `(key, value)`, Array/Set outputs emit `(element)`. */
export type EmitOf<Out extends EastType> =
  Out extends DictType<infer K, infer V> ? FunctionType<[K, V], NullType> :
  Out extends SetType<infer E> ? FunctionType<[E], NullType> :
  Out extends ArrayType<infer E> ? FunctionType<[E], NullType> :
  never;

/**
 * The declaration half of {@link streamTask} — everything structural about
 * the task; the body comes last as the `fn` argument.
 *
 * @typeParam Stream - The streamed input dataset def, when present
 * @typeParam Inputs - The ordinary input datasets
 * @typeParam Output - The output collection's East type
 */
export interface StreamTaskSpec<
  Stream extends DatasetDef | undefined,
  Inputs extends readonly DatasetDef[],
  Output extends EastType,
> {
  /** The input the runner feeds through the body in canonical order with
   *  O(segment) memory. Omit entirely for a producer task (the body loops
   *  over platform-function sources and emits). */
  readonly stream?: Stream;
  /** Ordinary inputs, decoded whole. */
  readonly inputs?: [...Inputs];
  /** The output collection type. Dict/Set outputs must be emitted in
   *  strictly ascending (key) order — the streaming writer enforces the
   *  canonical-segment contract at runtime; Array outputs emit freely. */
  readonly output: Output;
  /** Runtime the body runs on; defaults to {@link DEFAULT_RUNNER}. Every
   *  stock runtime streams the output through `emit` and feeds the `stream`
   *  input lazily (segment-fed iteration and keyed reads at O(segment)
   *  decoded memory; any other operation on it decodes the whole value
   *  once). The `custom` runtime is rejected — its argv cannot carry the
   *  streaming flags. */
  readonly runner?: Runner;
  /** Execution environment declaration, as for {@link task}. */
  readonly environment?: EnvironmentDecl;
}

/** The body parameters of a {@link streamTask}: the stream value when
 *  declared, the ordinary inputs, then the `emit` capability. */
type StreamTaskArgs<
  Stream extends DatasetDef | undefined,
  Inputs extends readonly DatasetDef[],
  Output extends EastType,
> = Stream extends DatasetDef<infer S>
  ? [ExprType<S>, ...DatasetExprs<Inputs>, ExprType<EmitOf<Output>>]
  : [...DatasetExprs<Inputs>, ExprType<EmitOf<Output>>];

/**
 * Defines a streaming task: one execution whose runner feeds the `stream`
 * input segment-by-segment in canonical order (state is ordinary `$.let`
 * locals) and writes the output incrementally through the `emit` capability
 * — bounded memory at both ends, exact left-fold semantics, no parallelism
 * and no partial recompute.
 *
 * `emit` is a runner-implemented function value: `emit(key, value)` for Dict
 * outputs, `emit(element)` for Array/Set outputs. The streaming writer
 * re-batches emissions byte-adaptively; Dict/Set outputs must be emitted in
 * strictly ascending (key) order (the canonical-segment contract, enforced
 * at runtime), Array outputs emit freely. The body's return value is unused
 * — the output dataset is what `emit` wrote.
 *
 * With no `stream`, the task is a producer: its body loops over
 * platform-function sources (paginated APIs, database cursors) and emits.
 * A producer's real input is the outside world, so it follows the existing
 * integration-task conventions for re-run semantics — `emit` changes nothing
 * about that.
 *
 * @typeParam Name - Task name (literal type)
 * @typeParam Output - Output collection type
 * @typeParam Stream - Streamed input dataset def, when present
 * @typeParam Inputs - Ordinary input dataset defs
 * @param name - Task name
 * @param spec - The declaration: stream input, ordinary inputs, output
 *   collection type, runner and environment
 * @param fn - Implementation body; receives the stream value (when
 *   declared), the inputs, then `emit`, and returns nothing
 * @returns A TaskDef with `.output` for chaining
 * @throws {Error} When the output is not a collection type or the runner is
 *   the `custom` runtime.
 *
 * @example
 * ```ts
 * const events = e3.input('events', ArrayType(EventType));
 *
 * const balances = e3.streamTask('balances', {
 *   stream: events,
 *   output: ArrayType(BalanceType),
 * }, ($, events, emit) => {
 *   const balance = $.let(0.0);
 *   $.for(events, ($, event) => {
 *     $.assign(balance, balance.add(event.amount));
 *     $(emit({ at: event.at, balance }));
 *   });
 * });
 * ```
 */
export function streamTask<
  Name extends string,
  Output extends EastType,
  const Stream extends DatasetDef | undefined = undefined,
  const Inputs extends readonly DatasetDef[] = [],
>(
  name: Name,
  spec: StreamTaskSpec<Stream, Inputs, Output>,
  fn: ($: BlockBuilder<NullType>, ...args: StreamTaskArgs<Stream, Inputs, Output>) => void,
): TaskDef<Output, TaskOutputPath<Name>> {
  if (spec.environment) validateEnvironmentDecl(spec.environment, name);
  const output = spec.output as EastType & { key?: EastType; value?: EastType };
  const inputs = (spec.inputs ?? []) as readonly DatasetDef[];

  let emitKind: 'array' | 'set' | 'dict';
  let emitType: EastType;
  switch (output.type) {
    case 'Dict':
      emitKind = 'dict';
      emitType = FunctionType([output.key!, output.value!], NullType);
      break;
    case 'Set':
      emitKind = 'set';
      emitType = FunctionType([output.key!], NullType);
      break;
    case 'Array':
      emitKind = 'array';
      emitType = FunctionType([output.value!], NullType);
      break;
    default:
      throw new Error(`streamTask '${name}': output must be a collection type (Array, Set or Dict), got ${output.type} — for small results use e3.task`);
  }

  const runner = spec.runner ?? DEFAULT_RUNNER;
  if (runner.runtime === 'custom') {
    throw new Error(`streamTask '${name}': the custom runtime cannot carry the streaming flags — use a stock runtime (east-node, east-py, east-c)`);
  }

  const paramTypes: EastType[] = [
    ...(spec.stream !== undefined ? [(spec.stream as DatasetDef).type] : []),
    ...inputs.map((i) => i.type),
    emitType,
  ];
  const bodyFn = East.function(paramTypes, NullType, fn as any);
  const eastIR = bodyFn.toIR();

  const taskTree = createTaskTree(name);
  const functionIRDataset = createFunctionIRDataset(name, taskTree, eastIR);
  const input_datasets = [
    functionIRDataset,
    ...(spec.stream !== undefined ? [spec.stream as DatasetDef] : []),
    ...inputs,
  ];
  const outputDataset = createOutputDataset(name, taskTree, output);

  // The command mirrors task()'s, with the streaming flags ahead of the
  // input list: the runner constructs the emit sink for the output kind and
  // feeds the flagged `-i` input (0-based; the stream is always the first
  // one) lazily instead of whole-decoding it.
  const argvPrefix = [
    ...runnerToCommand(runner),
    '--emit', emitKind,
    ...(spec.stream !== undefined ? ['--stream', '0'] : []),
  ];
  const commandFn = East.function(
    [ArrayType(StringType), StringType],
    ArrayType(StringType),
    ($, input_paths, output_path) => {
      const command = $.let(argvPrefix, ArrayType(StringType));
      const i = $.let(1n);
      $.while(East.less(i, input_paths.size()), $ => {
        $(command.pushLast('-i'));
        $(command.pushLast(input_paths.get(i)));
        $.assign(i, i.add(1n));
      });
      $(command.pushLast('-o'));
      $(command.pushLast(output_path));
      $(command.pushLast(input_paths.get(0n)));
      $.return(command);
    }
  );

  const metadata = encodeStreamTaskMetadata({
    stream: spec.stream !== undefined,
    emit: emitKind,
  });

  const taskDef: TaskDef = {
    kind: 'task',
    name,
    command: commandFn.toIR() as EastIR<[string[], string], string[]>,
    inputs: input_datasets,
    output: outputDataset,
    deps: collectDeps(taskTree, outputDataset, input_datasets),
    taskKind: TASK_KIND_STREAM,
    metadata,
    runner,
    ...(spec.environment !== undefined && { environment: spec.environment }),
  };
  outputDataset.deps.add(taskDef);

  return taskDef as TaskDef<Output, TaskOutputPath<Name>>;
}
