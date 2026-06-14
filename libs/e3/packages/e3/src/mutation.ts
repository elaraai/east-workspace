/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Mutation definitions for e3 packages — the write half of the record
 * machinery (CQRS; `e3.function` is the read half).
 *
 * A mutation is a pure East reducer `(State, ...Args) => State` that runs
 * server-side, where the record's data is, in a compare-and-swap retry loop.
 * Purity is what makes retry-on-conflict safe: the loop can re-run the reducer
 * against fresher state with no observable side effects.
 */

import type {
  AsyncFunctionExpr,
  CallableAsyncFunctionExpr,
  CallableFunctionExpr,
  EastType,
  FunctionExpr,
} from '@elaraai/east';
import { Expr } from '@elaraai/east';
import type { MutationDef, RecordDef } from './types.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

/**
 * Defines a mutation that writes a record.
 *
 * The reducer is an ordinary East function whose first parameter is the
 * current state and whose return is the new state — both the record's type,
 * enforced at compile time by the shared `T`. The extra parameter types are
 * read off the function's signature, so there is nothing to keep in sync.
 *
 * The body must be pure (no platform IO); an async/IO reducer is rejected so
 * the compare-and-swap loop can safely re-run it against fresher state.
 *
 * @typeParam Name - Mutation name (literal type)
 * @typeParam T - The owning record's state type
 * @typeParam Args - The EXTRA positional parameter types (after the state)
 * @param name - Mutation name (unique within the record)
 * @param rec - The record this mutation writes
 * @param fn - The reducer `(state, ...args) => state`
 * @param config - Optional runner selection (known runtimes only, like e3.function)
 * @returns A MutationDef to pass to `e3.package`
 *
 * @example
 * ```ts
 * const orders = e3.record('orders', OrdersType, new Map());
 *
 * const placeOrder = e3.mutation('place_order', orders,
 *   East.function([OrdersType, OrderType], OrdersType, ($, state, order) =>
 *     state.has(order.id).ifElse(
 *       $ => $.error(East.str`duplicate order ${order.id}`),
 *       $ => state.insert(order.id, order),
 *     )));
 *
 * const pkg = e3.package('planning', '1.0.0', orders, placeOrder);
 * ```
 */
export function mutation<Name extends string, T extends EastType, Args extends EastType[]>(
  name: Name,
  rec: RecordDef<T>,
  fn: FunctionExpr<[T, ...Args], T>
    | CallableFunctionExpr<[T, ...Args], T>
    | AsyncFunctionExpr<[T, ...Args], T>
    | CallableAsyncFunctionExpr<[T, ...Args], T>,
  config?: { runner?: FunctionRunner },
): MutationDef<T, Args>;
export function mutation(
  name: string,
  rec: RecordDef,
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: { runner?: FunctionRunner },
): MutationDef {
  if (!name) {
    throw new Error('e3.mutation requires a non-empty name');
  }

  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);

  // Keep the full EastIR bundle (IR + source map) so export.ts can encode
  // with encodeEastIR and preserve source locations.
  const eastIR = fn.toIR();
  const fnType = Expr.type(fn as Expr<any>) as { inputs: EastType[]; output: EastType };
  // The reducer is (state, ...args) => state; the extra parameter types are
  // everything after the leading state parameter.
  const argTypes = fnType.inputs.slice(1);

  return {
    kind: 'mutation',
    name,
    record: rec,
    body: eastIR as MutationDef['body'],
    argTypes,
    runner,
  };
}
