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

import type { AsyncFunctionExpr, BlockBuilder, CallableAsyncFunctionExpr, CallableFunctionExpr, EastType, ExprType, FunctionExpr } from '@elaraai/east';
import { Expr, variant, ArrayType, StringType, East, IRType, EastIR, AsyncEastIR } from '@elaraai/east';
import type { DatasetDef, DataTreeDef, TaskDef } from './types.js';

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
  config?: { runner?: string[], kind?: string, metadata?: Uint8Array },
): TaskDef<Output, [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>]>;
export function task(
  name: string,
  inputs: DatasetDef[],
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: { runner?: string[], kind?: string, metadata?: Uint8Array },
): TaskDef {
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

  // Build the command for our east-py runner
  const commandFn = East.function(
    [ArrayType(StringType), StringType],
    ArrayType(StringType),
    ($, input_paths, output_path) => {
      const command = $.let(config?.runner ?? ['east-py', 'run', '-p', 'east-py-std', '-p', 'east-py-io', '-p', 'east-py-datascience'], ArrayType(StringType));

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
  _config?: object,
): TaskDef<Output, [variant<'field', 'tasks'>, variant<'field', Name>, variant<'field', 'output'>]> {

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
  };

  // Add the task to the output's deps so downstream tasks collect this task's deps
  output.deps.add(taskDef);

  return taskDef;
}
