/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Named function definitions for e3 packages.
 *
 * `e3.function` declares a named, typed function stored in a package and
 * invoked by name with argument values over the CLI (`e3 call`) and HTTP
 * API. It is e3's "stored procedure" / RPC method: not part of the dataflow
 * graph, and its result is returned inline to the caller — nothing durable
 * is written by a call. A function may declare inputs, as a stream task
 * does: datasets of the workspace a call reads, each pinned at its hash,
 * beside the arguments its caller passes.
 */

import { validateEnvironmentDecl, type EnvironmentDecl } from './environment.js';
import type {
  AsyncFunctionExpr,
  AsyncFunctionType,
  BlockBuilder,
  CallableAsyncFunctionExpr,
  CallableFunctionExpr,
  EastType,
  ExprType,
  FunctionExpr,
  FunctionType,
  SubtypeExprOrValue,
} from '@elaraai/east';
import { East, Expr } from '@elaraai/east';
import type { DatasetDef, DataTreeDef, FunctionDef, PartitionDef, TaskDef } from './types.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';
import { refusePartitioned, type InputExprs } from './task.js';

/** The expression a function's body receives for each argument. */
type ArgExprs<T extends readonly EastType[]> = {
  [K in keyof T]: ExprType<T[K]>;
};

/**
 * The declaration half of a function with inputs ({@link function_}'s
 * `(name, spec, fn)` form); the body comes last as the `fn` argument.
 *
 * @typeParam Inputs - The datasets a call reads from its workspace
 * @typeParam Args - The types of the arguments a caller passes
 * @typeParam Output - The return type
 */
export interface FunctionSpec<
  Inputs extends readonly DatasetDef[],
  Args extends EastType[],
  Output extends EastType,
> {
  /** The datasets each call reads from the workspace it runs in, in the
   *  body's parameter order before the arguments: an input, a task's output
   *  or a record of the package. Each is read as it is stored as the call
   *  starts, pinned at its hash: one after another, waiting for no run, so a
   *  call during a run may read one before the run rewrites it and another
   *  after. */
  readonly inputs: [...Inputs];
  /** The types of the arguments a caller passes, after the inputs. */
  readonly args: [...Args];
  /** The return type. */
  readonly output: Output;
  /** Runtime the body runs on; defaults to {@link DEFAULT_RUNNER}. A stock
   *  runtime: the `custom` one takes no inputs. */
  readonly runner?: FunctionRunner;
  /** Execution environment declaration, as for a task. */
  readonly environment?: EnvironmentDecl;
  /** Build the body with `East.asyncFunction`, for platform calls that are
   *  async; a sync `East.function` otherwise. */
  readonly async?: boolean;
}

/**
 * Defines a named function that reads the workspace as well: the `inputs` it
 * declares, as a stream task declares them, beside the `args` its caller
 * passes.
 *
 * The body's parameters are the inputs, in `inputs` order, then the
 * arguments, in `args` order: the SDK builds the East function from their
 * types, an async one with `async: true`. An input is what a task takes — an
 * input, a task's output or a record of the package — and `e3.package`
 * collects each with what it depends on. The function is still no node of
 * the dataflow: nothing reruns when an input changes.
 *
 * A call through a workspace reads each input as it is stored as the call
 * starts, pinned at its hash, and its result names each path and hash. The
 * inputs are read one after another, waiting for no run, so a call during a
 * run may read one input before the run rewrites it and another after. The
 * caller passes the arguments alone. An input not assigned — one nothing has
 * set, a task's output no run has produced since the deploy — makes the call
 * `invalid`, naming it, and nothing runs. The package route, which has no
 * workspace, refuses such a function.
 *
 * @typeParam Name - Function name (literal type)
 * @typeParam Inputs - The datasets a call reads
 * @typeParam Args - The argument types a caller passes
 * @typeParam Output - Return type
 * @param name - Function name (unique within the package)
 * @param spec - The inputs, the argument types and the return type, and the
 *   runner, environment and `async` ({@link FunctionSpec})
 * @param fn - The body: given the inputs, then the arguments, it returns the
 *   result
 * @returns A FunctionDef to pass to `e3.package`
 * @throws {Error} When the name is empty or the runner is not a known one, an
 *   input is marked with `e3.partition` (a call runs as one unit), or the
 *   runner is the `custom` runtime with inputs.
 *
 * @example
 * ```ts
 * const prices = e3.input('prices', DictType(StringType, FloatType));
 *
 * const quote = e3.function('quote', {
 *   inputs: [prices],
 *   args: [ArrayType(OrderLineType)],
 *   output: FloatType,
 * }, ($, prices, lines) => lines.sum(($, line) => prices.get(line.sku).multiply(line.quantity.toFloat())));
 *
 * // Called through a workspace, with the order alone:
 * //   e3 call . -w dev quote '[(sku="bolt", quantity=4)]'
 * const pkg = e3.package('planning', '1.0.0', quote);
 * ```
 */
export function function_<
  Name extends string,
  Inputs extends readonly DatasetDef[],
  Args extends EastType[],
  Output extends EastType,
>(
  name: Name,
  spec: FunctionSpec<Inputs, Args, Output>,
  fn: ($: BlockBuilder<Output>, ...params: [...InputExprs<Inputs>, ...ArgExprs<Args>]) => SubtypeExprOrValue<NoInfer<Output>> | void,
): FunctionDef<Args, Output>;
/**
 * Defines a named function stored in a package.
 *
 * The body is an ordinary East function (sync or async); its signature IS
 * the argument list — `argTypes` / `outputType` are inferred from the East
 * function, so there is no separate type array to keep in sync. It reads
 * nothing of the workspace: a function that does declares `inputs`, in the
 * `(name, spec, fn)` form.
 *
 * Unlike a task, a function creates no dataset tree nodes and no command IR:
 * its body IR is stored directly as a content object, its signature lives on
 * the function object, and the executor builds the runner argv directly at
 * call time (which is what enables a request-time runner override).
 *
 * @typeParam Name - Function name (literal type)
 * @typeParam Args - The argument types: the East function's parameters
 * @typeParam Output - Return type
 * @param name - Function name (unique within the package)
 * @param fn - The East function body. Pure compute — no dataset reads; may
 *   be async (platform calls / IO).
 * @param config - Optional runner selection. Only the known runtimes are
 *   allowed — including `custom` (symmetric with tasks; the command must
 *   speak the runner CLI convention, see {@link FunctionRunner}).
 * @returns A FunctionDef to pass to `e3.package`
 * @throws {Error} When the name is empty or the runner is not a known one.
 *
 * @example
 * ```ts
 * const forecast = e3.function(
 *   'forecast',
 *   East.function([IntegerType, FloatType], FloatType, ($, periods, growthRate) => {
 *     ...
 *   }),
 *   { runner: { runtime: 'east-py', platforms: ['east-py-datascience'] } },
 * );
 *
 * const pkg = e3.package('planning', '1.0.0', forecast);
 * ```
 */
export function function_<Name extends string, Args extends EastType[], Output extends EastType>(
  name: Name,
  fn: FunctionExpr<Args, Output>
    | CallableFunctionExpr<Args, Output>
    | AsyncFunctionExpr<Args, Output>
    | CallableAsyncFunctionExpr<Args, Output>,
  config?: { runner?: FunctionRunner, environment?: EnvironmentDecl },
): FunctionDef<Args, Output>;
export function function_(
  name: string,
  second: FunctionExpr<EastType[], EastType> | AsyncFunctionExpr<EastType[], EastType> | FunctionSpec<DatasetDef[], EastType[], EastType>,
  third?: { runner?: FunctionRunner, environment?: EnvironmentDecl } | (($: BlockBuilder<EastType>, ...params: Expr[]) => unknown),
): FunctionDef {
  if (!name) {
    throw new Error('e3.function requires a non-empty name');
  }
  if (second instanceof Expr) {
    const config = third as { runner?: FunctionRunner, environment?: EnvironmentDecl } | undefined;
    return define(name, second, [], config?.runner, config?.environment);
  }

  const spec = second;
  const inputs = spec.inputs as readonly (DatasetDef | PartitionDef)[];
  refusePartitioned(`e3.function '${name}'`, inputs, 'and a call runs as one unit');
  const datasets = inputs as readonly DatasetDef[];
  if (datasets.length > 0 && spec.runner?.runtime === 'custom') {
    throw new Error(
      `e3.function '${name}': the custom runtime takes no inputs — ` +
      `read them on a stock runtime (east-node, east-py, east-c), or pass them as arguments`
    );
  }

  // East gives the body an expression of each parameter's type: the inputs',
  // in the spec's order, then the arguments'.
  const body = third as ($: BlockBuilder<EastType>, ...params: Expr[]) => unknown;
  const parameters: EastType[] = [...datasets.map((d) => d.type), ...spec.args];
  const bodyFn = spec.async === true
    ? East.asyncFunction(parameters, spec.output, ($, ...params) => body($, ...params) as never)
    : East.function(parameters, spec.output, ($, ...params) => body($, ...params) as never);
  return define(name, bodyFn, datasets, spec.runner, spec.environment);
}

/**
 * The definition of a function: its body's IR and signature, the inputs it
 * reads, which come first among its parameters, and what they depend on.
 */
function define(
  name: string,
  fn: FunctionExpr<EastType[], EastType> | AsyncFunctionExpr<EastType[], EastType>,
  inputs: readonly DatasetDef[],
  runner: FunctionRunner | undefined,
  environment: EnvironmentDecl | undefined,
): FunctionDef {
  const resolved = runner ?? DEFAULT_RUNNER;
  if (environment) validateEnvironmentDecl(environment, name);
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(resolved);

  // Keep the full EastIR bundle (IR + source map) so export.ts can encode
  // with encodeEastIR and preserve source locations.
  const eastIR = fn.toIR();
  const fnType = Expr.type<FunctionType<EastType[], EastType> | AsyncFunctionType<EastType[], EastType>>(fn);

  const deps = new Set<DataTreeDef | DatasetDef | TaskDef>();
  for (const input of inputs) {
    for (const dep of input.deps) deps.add(dep);
    deps.add(input);
  }

  return {
    kind: 'function',
    name,
    body: eastIR,
    inputs,
    argTypes: fnType.inputs.slice(inputs.length),
    outputType: fnType.output,
    runner: resolved,
    environment,
    deps,
  };
}
