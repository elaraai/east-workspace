/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Named function definitions for e3 packages.
 *
 * `e3.function` declares a named, typed function stored in a package and
 * invoked by name with argument values over the CLI (`e3 call`) and HTTP
 * API. It is e3's "stored procedure" / RPC method: not wired to datasets,
 * not part of the dataflow graph, and its result is returned inline to the
 * caller — nothing durable is written by a call.
 */

import type {
  AsyncFunctionExpr,
  CallableAsyncFunctionExpr,
  CallableFunctionExpr,
  EastType,
  FunctionExpr,
} from '@elaraai/east';
import { Expr } from '@elaraai/east';
import type { FunctionDef } from './types.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

/**
 * Defines a named function stored in a package.
 *
 * The body is an ordinary East function (sync or async); its signature IS
 * the parameter list — `inputTypes` / `outputType` are inferred from the
 * East function, so there is no separate type array to keep in sync.
 *
 * Unlike a task, a function creates no dataset tree nodes and no command IR:
 * its body IR is stored directly as a content object, its signature lives on
 * the function object, and the executor builds the runner argv directly at
 * call time (which is what enables a request-time runner override).
 *
 * @typeParam Name - Function name (literal type)
 * @typeParam Inputs - Positional parameter types
 * @typeParam Output - Return type
 * @param name - Function name (unique within the package)
 * @param fn - The East function body. Pure compute — no dataset reads; may
 *   be async (platform calls / IO).
 * @param config - Optional runner selection. Only the known runtimes are
 *   allowed — including `custom` (symmetric with tasks; the command must
 *   speak the runner CLI convention, see {@link FunctionRunner}).
 * @returns A FunctionDef to pass to `e3.package`
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
export function function_<Name extends string, Inputs extends EastType[], Output extends EastType>(
  name: Name,
  fn: FunctionExpr<Inputs, Output>
    | CallableFunctionExpr<Inputs, Output>
    | AsyncFunctionExpr<Inputs, Output>
    | CallableAsyncFunctionExpr<Inputs, Output>,
  config?: { runner?: FunctionRunner },
): FunctionDef<Inputs, Output>;
export function function_(
  name: string,
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: { runner?: FunctionRunner },
): FunctionDef {
  if (!name) {
    throw new Error('e3.function requires a non-empty name');
  }

  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);

  // Keep the full EastIR bundle (IR + source map) so export.ts can encode
  // with encodeEastIR and preserve source locations.
  const eastIR = fn.toIR();
  const fnType = Expr.type(fn as Expr<any>) as { inputs: EastType[]; output: EastType };

  return {
    kind: 'function',
    name,
    body: eastIR as any,
    inputTypes: fnType.inputs,
    outputType: fnType.output,
    runner,
  };
}
