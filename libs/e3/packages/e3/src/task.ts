/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task definitions for e3 packages.
 *
 * A task reads datasets and writes one output, the dataset at
 * `.tasks.${name}.output`: {@link task} returns it, {@link streamTask} emits
 * it into an output kind, and {@link customTask} runs a command that writes
 * it. The program a task runs is named by the task object export writes, not
 * held in the data tree.
 */

import type { AsyncFunctionExpr, BlockBuilder, CallableAsyncFunctionExpr, CallableFunctionExpr, EastType, ExprType, FunctionExpr } from '@elaraai/east';
import { Expr, variant, ArrayType, StringType, NullType, East, EastIR, isTypeValueEqual, printType, toEastTypeValue } from '@elaraai/east';
import type { TaskRole } from '@elaraai/e3-types';
import type { DatasetDef, DataTreeDef, OutputDef, PartitionDef, TaskDef } from './types.js';
import { DEFAULT_RUNNER, type Runner } from './runner.js';
import { validateEnvironmentDecl, type EnvironmentDecl } from './environment.js';

/**
 * Helper type to extract East types from DatasetDef array.
 * Preserves tuple structure when T is a tuple.
 */
type ExtractDatasetTypes<T extends readonly DatasetDef[]> = {
  [K in keyof T]: T[K] extends DatasetDef<infer U> ? U : never;
} & EastType[];

/** The task-output path tuple for task `Name`. */
type TaskOutputPath<Name extends string> = [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>];

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
): DatasetDef<Output, TaskOutputPath<Name>> {
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
 * - The task's subtree and its output
 * - All input datasets and their dependencies
 */
function collectDeps(
  taskTree: DataTreeDef,
  outputDataset: DatasetDef,
  inputs: readonly DatasetDef[],
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
 * When input datasets change, the task re-runs automatically. The function
 * runs once, as one unit: a large input opens lazily, and a collection it
 * returns is written segment by segment.
 *
 * Task structure:
 * - `.tasks.${name}.output` - The output dataset
 *
 * @typeParam Name - Task name (literal type)
 * @typeParam Inputs - Input dataset types
 * @typeParam Output - Output type
 * @param name - Task name
 * @param inputs - Input datasets to read from
 * @param fn - Implementation function
 * @param config - The runner the function runs on (default
 *   {@link DEFAULT_RUNNER}), the environment it runs in, and its role: a data
 *   task (the default), or a UI task with the data its surface reads
 * @returns A TaskDef with `.output` for chaining
 * @throws {Error} When an input is marked with `e3.partition`, which only
 *   {@link streamTask} takes.
 *
 * @see {@link streamTask} for an output emitted instead of returned, and work
 * split over an input.
 * @see {@link customTask} for defining tasks with custom command logic (e.g. performing non-East operations).
 *
 * @example
 * ```ts
 * const input_name = e3.input('name', StringType, variant('value', 'World'));
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
  config?: { runner?: Runner, environment?: EnvironmentDecl, role?: TaskRole },
): TaskDef<Output, TaskOutputPath<Name>>;
export function task(
  name: string,
  inputs: DatasetDef[],
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: { runner?: Runner, environment?: EnvironmentDecl, role?: TaskRole },
): TaskDef {
  if (config?.environment) validateEnvironmentDecl(config.environment, name);
  for (const input of inputs as readonly (DatasetDef | PartitionDef)[]) {
    if (input.kind === 'partition') {
      throw new Error(
        `task '${name}': input '${input.dataset.name}' is marked with e3.partition, which only e3.streamTask takes — ` +
        `pass the dataset itself`
      );
    }
  }

  const taskTree = createTaskTree(name);
  const output = createOutputDataset(name, taskTree, Expr.type(fn as Expr<any>).output as EastType);

  const taskDef: TaskDef = {
    kind: 'task',
    name,
    // Keep the full EastIR bundle (IR + source map) so export.ts can encode
    // it with its source map.
    body: { kind: 'east', program: fn.toIR() },
    inputs,
    output,
    role: config?.role ?? variant('data', null),
    deps: collectDeps(taskTree, output, inputs),
    runner: config?.runner ?? DEFAULT_RUNNER,
    environment: config?.environment,
  };

  // Add the task to the output's deps so downstream tasks collect this task's deps
  output.deps.add(taskDef);

  return taskDef;
}

/**
 * Defines a task that runs a command rather than East: a bash script built
 * from the staged input paths and the path the output must be written to.
 *
 * @typeParam Name - Task name (literal type)
 * @typeParam Inputs - Input dataset types
 * @typeParam Output - Output type
 * @param name - Task name
 * @param inputs - Input datasets, staged as beast2 files
 * @param outputType - The East type of the beast2 file the command writes
 * @param command - Builds the bash script from the input paths and the output path
 * @param config - The environment the command runs in
 * @returns A TaskDef with `.output` for chaining
 */
export function customTask<Name extends string, Inputs extends Array<DatasetDef>, Output extends EastType>(
  name: Name,
  inputs: Inputs,
  outputType: Output,
  command: ($: BlockBuilder<StringType>, input_paths: ExprType<ArrayType<StringType>>, output_path: ExprType<StringType>) => Expr<StringType> | void,
  config?: { environment?: EnvironmentDecl },
): TaskDef<Output, TaskOutputPath<Name>> {
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

  const taskDef: TaskDef<Output, TaskOutputPath<Name>> = {
    kind: 'task',
    name,
    // Keep the full EastIR bundle so export.ts can encode with source map.
    body: { kind: 'command', command: commandFn.toIR() as EastIR<[string[], string], string[]> },
    inputs,
    output,
    role: variant('data', null),
    deps: collectDeps(taskTree, output, inputs),
    environment: config?.environment,
  };

  // Add the task to the output's deps so downstream tasks collect this task's deps
  output.deps.add(taskDef);

  return taskDef;
}

// =============================================================================
// Streaming tasks
// =============================================================================

/**
 * Marks an input of a {@link streamTask} as one its work may be split over.
 *
 * The body receives one piece of the dataset, typed as the whole: a key range
 * of a Set or Dict, or a position range of an Array. Pieces are cut where the
 * content says, so an insertion re-cuts only the pieces around it. Rows whose
 * `by` fields are equal are never split across pieces.
 *
 * `by` names leading key fields, in order — `['account']`, or
 * `['account', 'at.day']`, whose last entry reads the first field of `at`. Two
 * or more partitioned inputs are cut at the same keys, so they must be Sets or
 * Dicts whose keys, or whose `by` fields, have the same types. {@link
 * streamTask} checks all of this against the dataset, naming the task.
 *
 * @typeParam T - The dataset's East type
 * @param dataset - The dataset
 * @param config - `by`, the fields rows are grouped by
 * @returns The marked input, to pass in a stream task's `inputs`
 *
 * @example
 * ```ts
 * const totals = e3.streamTask('totals', {
 *   inputs: [e3.partition(sales, { by: ['account'] }), rates],
 *   output: e3.output.dict(StringType, FloatType, { merge: ($, account, a, b) => a.add(b) }),
 * }, ($, sales, rates, emit) => {
 *   $.for(sales, ($, sale, key) => {
 *     $(emit(key.account, sale.amount.multiply(rates.get(sale.currency))));
 *   });
 * });
 * ```
 */
export function partition<T extends EastType>(dataset: DatasetDef<T>, config?: { by?: string[] }): PartitionDef<T> {
  return { kind: 'partition', dataset, by: [...(config?.by ?? [])] };
}

/** The expression a stream task's body receives for each input. */
type InputExprs<T extends readonly (DatasetDef | PartitionDef)[]> = {
  [K in keyof T]:
    T[K] extends PartitionDef<infer U> ? ExprType<U> :
    T[K] extends DatasetDef<infer U> ? ExprType<U> :
    never;
};

/**
 * The declaration half of {@link streamTask}; the body comes last as the `fn`
 * argument.
 *
 * @typeParam Inputs - The inputs, some marked with {@link partition}
 * @typeParam Output - The output kind
 */
export interface StreamTaskSpec<
  Inputs extends readonly (DatasetDef | PartitionDef)[],
  Output extends OutputDef,
> {
  /** The inputs, in the body's parameter order. An input wrapped in
   *  {@link partition} is one the work may be split over; the others reach
   *  every piece whole, opened lazily when large. Empty for a producer. */
  readonly inputs: [...Inputs];
  /** The output kind — `e3.output.array`, `set`, `dict` or `fold`. It fixes
   *  `emit`'s signature and how the parts of the output combine. */
  readonly output: Output;
  /** Runtime the body runs on; defaults to {@link DEFAULT_RUNNER}. A stock
   *  runtime: the `custom` one runs only a program that returns its output. */
  readonly runner?: Runner;
  /** Execution environment declaration, as for {@link task}. */
  readonly environment?: EnvironmentDecl;
}

/** The key a Set or Dict is cut by; an Array, cut by position, has none. */
function collectionKey(type: EastType): EastType | undefined {
  const collection = type as EastType & { key?: EastType };
  return collection.type === 'Set' || collection.type === 'Dict' ? collection.key : undefined;
}

/**
 * Checks a stream task's partitioned inputs against their datasets: each is a
 * collection, each `by` names leading key fields, and co-partitioned inputs
 * are Sets or Dicts cut by fields of the same types.
 */
function checkPartitions(name: string, partitions: readonly PartitionDef[]): void {
  const cuts: { input: string; types: EastType[] }[] = [];
  for (const { dataset, by } of partitions) {
    const where = `streamTask '${name}': partitioned input '${dataset.name}'`;
    const type = dataset.type as EastType;
    if (type.type !== 'Array' && type.type !== 'Set' && type.type !== 'Dict') {
      throw new Error(`${where} must be a collection (Array, Set or Dict), got ${type.type}`);
    }
    const key = collectionKey(type);
    if (key === undefined) {
      if (by.length > 0) throw new Error(`${where} is an Array, cut by position, so it has no key for \`by\` to name`);
      continue;
    }
    if (by.length === 0) {
      cuts.push({ input: dataset.name, types: [key] });
      continue;
    }
    if (key.type !== 'Struct') {
      throw new Error(`${where} has a ${key.type} key, which has no fields for \`by\` to name`);
    }
    const fields = (key as EastType & { fields: Record<string, EastType> }).fields;
    const order = Object.keys(fields);
    const types = by.map((entry, i) => {
      const [head, ...path] = entry.split('.');
      if (order[i] !== head || (path.length > 0 && i !== by.length - 1)) {
        throw new Error(
          `${where}: \`by\` (${by.join(', ')}) must name leading key fields in order — the key's fields are ` +
          `(${order.join(', ')}), and only the last entry may read into one, as 'at.day' does`
        );
      }
      let level = fields[head!]!;
      for (const step of path) {
        const levelFields = level.type === 'Struct' ? Object.keys((level as EastType & { fields: Record<string, EastType> }).fields) : [];
        if (levelFields[0] !== step) {
          throw new Error(
            `${where}: \`by\` path '${entry}' reads '${step}', which is not the first field of ` +
            `${level.type === 'Struct' ? `(${levelFields.join(', ')})` : `a ${level.type}`} — rows sort by a struct's first field, so only it groups them`
          );
        }
        level = (level as EastType & { fields: Record<string, EastType> }).fields[step]!;
      }
      return level;
    });
    cuts.push({ input: dataset.name, types });
  }

  if (partitions.length < 2) return;
  if (cuts.length < partitions.length) {
    throw new Error(
      `streamTask '${name}': co-partitioned inputs are cut at the same keys, so each must be a Set or a Dict — ` +
      `partition one input and pass the others whole`
    );
  }
  const [first, ...rest] = cuts;
  for (const other of rest) {
    const same = other.types.length === first!.types.length &&
      other.types.every((t, i) => isTypeValueEqual(toEastTypeValue(t), toEastTypeValue(first!.types[i]!)));
    if (!same) {
      throw new Error(
        `streamTask '${name}': co-partitioned inputs '${first!.input}' and '${other.input}' have no common key — ` +
        `they are cut by (${first!.types.map((t) => printType(t)).join(', ')}) and (${other.types.map((t) => printType(t)).join(', ')}); ` +
        `give each a \`by\` naming fields of the same types`
      );
    }
  }
}

/**
 * Defines a stream task: a body that emits its output into an output kind
 * rather than returning it, over inputs its work may be split across.
 *
 * `emit` is the body's trailing parameter, and the output kind fixes its
 * signature: `emit(t)` for `array`, `set` and `fold`, `emit(k, v)` for
 * `dict`. Emission order is free — the platform sorts sets and dicts — and
 * the parts of the output combine as the kind says: concatenated for an
 * array, united for a set, by key for a dict (equal keys folding with its
 * `merge`), and folded with `combine` from `zero` for a fold.
 *
 * An input wrapped in {@link partition} is one the work may be split over:
 * the body runs once per piece, each piece typed as the whole dataset, and
 * the pieces' outputs combine by the output kind. The other inputs reach
 * every piece whole. With no partitioned input the task is one unit, with
 * exact left-to-right semantics; a producer has no inputs at all, and emits
 * what it reads from platform functions.
 *
 * The author's contract, the only one: `merge` and `combine` are associative,
 * `zero` is an identity of `combine`, and a partitioned body's combined
 * result does not depend on where its input was cut.
 *
 * @typeParam Name - Task name (literal type)
 * @typeParam Inputs - The inputs, some marked with {@link partition}
 * @typeParam Output - The output kind
 * @param name - Task name
 * @param spec - The inputs, the output kind, the runner and the environment
 * @param fn - The body; receives the inputs, then `emit`, and returns nothing
 * @returns A TaskDef with `.output` for chaining
 * @throws {Error} When the output is not an output kind, the runner is the
 *   `custom` runtime, a partitioned input is not a collection, a `by` names
 *   something other than leading key fields, or co-partitioned inputs have no
 *   common key.
 *
 * @example
 * ```ts
 * const sales = e3.input('sales', DictType(SaleKeyType, SaleType));
 *
 * const byAccount = e3.streamTask('by_account', {
 *   inputs: [e3.partition(sales)],
 *   output: e3.output.dict(StringType, FloatType, { merge: ($, account, a, b) => a.add(b) }),
 * }, ($, sales, emit) => {
 *   $.for(sales, ($, sale) => {
 *     $(emit(sale.account, sale.amount));
 *   });
 * });
 * ```
 */
export function streamTask<
  Name extends string,
  const Inputs extends readonly (DatasetDef | PartitionDef)[],
  Output extends OutputDef,
>(
  name: Name,
  spec: StreamTaskSpec<Inputs, Output>,
  fn: ($: BlockBuilder<NullType>, ...args: [...InputExprs<Inputs>, ExprType<Output['emit']>]) => void,
): TaskDef<Output['type'], TaskOutputPath<Name>> {
  if (spec.environment) validateEnvironmentDecl(spec.environment, name);
  const outputKind = spec.output as OutputDef;
  if (!['array', 'set', 'dict', 'fold'].includes(outputKind?.kind)) {
    throw new Error(`streamTask '${name}': output is an output kind — e3.output.array, set, dict or fold`);
  }
  const runner = spec.runner ?? DEFAULT_RUNNER;
  if (runner.runtime === 'custom') {
    throw new Error(
      `streamTask '${name}': the custom runtime runs only a program that returns its output — ` +
      `use a stock runtime (east-node, east-py, east-c)`
    );
  }

  const inputs = spec.inputs as readonly (DatasetDef | PartitionDef)[];
  checkPartitions(name, inputs.filter((i): i is PartitionDef => i.kind === 'partition'));
  const datasets = inputs.map((i) => (i.kind === 'partition' ? i.dataset : i));
  const parameters: EastType[] = [...datasets.map((d) => d.type), outputKind.emit];

  const bodyFn = East.function(parameters, NullType, fn as any);

  const taskTree = createTaskTree(name);
  const output = createOutputDataset(name, taskTree, outputKind.type as EastType);
  const taskDef: TaskDef = {
    kind: 'task',
    name,
    body: { kind: 'east', program: bodyFn.toIR() },
    inputs,
    output,
    outputKind,
    role: variant('data', null),
    deps: collectDeps(taskTree, output, datasets),
    runner,
    environment: spec.environment,
  };
  output.deps.add(taskDef);

  return taskDef as TaskDef<Output['type'], TaskOutputPath<Name>>;
}
