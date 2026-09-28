/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Output kinds for `e3.streamTask` — `e3.output.*`.
 *
 * A stream task's body emits its output instead of returning it, and the
 * output kind says what `emit` takes and how the parts of the output combine,
 * whichever unit emitted them. Emission order is free: the platform sorts sets
 * and dicts.
 */

import type { BlockBuilder, EastType, ExprType, SubtypeExprOrValue, ValueTypeOf } from '@elaraai/east';
import { ArrayType, DictType, East, FunctionType, NullType, SetType, isValueOf, printType } from '@elaraai/east';
import type { ArrayOutputDef, DictOutputDef, FoldOutputDef, SetOutputDef } from './types.js';

/**
 * An Array output: `emit(t)` appends an element. Parts concatenate: in
 * emission order within a unit, and units in input order.
 *
 * @typeParam T - The element type
 * @param type - The element type
 * @returns The output kind
 *
 * @example
 * ```ts
 * const balances = e3.streamTask('balances', {
 *   inputs: [events],
 *   output: e3.output.array(FloatType),
 * }, ($, events, emit) => {
 *   const balance = $.let(0.0);
 *   $.for(events, ($, event) => {
 *     $.assign(balance, balance.add(event.amount));
 *     $(emit(balance));
 *   });
 * });
 * ```
 */
function array<T extends EastType>(type: T): ArrayOutputDef<T> {
  return { kind: 'array', type: ArrayType(type), emit: FunctionType([type], NullType) };
}

/**
 * A Set output: `emit(t)` adds an element, and an element emitted twice is
 * held once. Parts combine by union.
 *
 * @typeParam T - The element type
 * @param type - The element type
 * @returns The output kind
 *
 * @example
 * ```ts
 * const accounts = e3.streamTask('accounts', {
 *   inputs: [e3.partition(events)],
 *   output: e3.output.set(StringType),
 * }, ($, events, emit) => {
 *   $.for(events, ($, event) => { $(emit(event.account)); });
 * });
 * ```
 */
function set<T extends EastType>(type: T): SetOutputDef<T> {
  return { kind: 'set', type: SetType(type), emit: FunctionType([type], NullType) };
}

/**
 * A Dict output: `emit(k, v)` adds an entry. Parts combine by key; the values
 * of a key emitted more than once fold with `merge`, in input order, and
 * without `merge` a repeated key fails the task, naming it.
 *
 * @typeParam K - The key type
 * @typeParam V - The value type
 * @param key - The key type
 * @param value - The value type
 * @param config - `merge`, an associative function of the key and two values
 * @returns The output kind
 *
 * @example
 * ```ts
 * const totals = e3.streamTask('totals', {
 *   inputs: [e3.partition(sales)],
 *   output: e3.output.dict(StringType, FloatType, { merge: ($, account, a, b) => a.add(b) }),
 * }, ($, sales, emit) => {
 *   $.for(sales, ($, sale) => { $(emit(sale.account, sale.amount)); });
 * });
 * ```
 */
function dict<K extends EastType, V extends EastType>(
  key: K,
  value: V,
  config?: { merge?: ($: BlockBuilder<V>, key: ExprType<K>, a: ExprType<V>, b: ExprType<V>) => SubtypeExprOrValue<V> | void },
): DictOutputDef<K, V> {
  return {
    kind: 'dict',
    type: DictType(key, value),
    emit: FunctionType([key, value], NullType),
    ...(config?.merge !== undefined && { merge: East.function([key, value, value], value, config.merge as any).toIR() }),
  };
}

/**
 * A fold output: every value `emit(t)` is given is folded with `combine`,
 * starting from `zero`, in input order, and the output is the result.
 *
 * @typeParam T - The folded value's type
 * @param type - The folded value's type
 * @param config - `zero`, an identity of `combine`; `combine`, associative
 * @returns The output kind
 * @throws {Error} When `zero` is not a value of `type`
 *
 * @example
 * ```ts
 * const revenue = e3.streamTask('revenue', {
 *   inputs: [e3.partition(sales)],
 *   output: e3.output.fold(FloatType, { zero: 0.0, combine: ($, a, b) => a.add(b) }),
 * }, ($, sales, emit) => {
 *   $.for(sales, ($, sale) => { $(emit(sale.amount)); });
 * });
 * ```
 */
function fold<T extends EastType>(
  type: T,
  config: {
    zero: ValueTypeOf<T>;
    combine: ($: BlockBuilder<T>, a: ExprType<T>, b: ExprType<T>) => SubtypeExprOrValue<T> | void;
  },
): FoldOutputDef<T> {
  if (!isValueOf(config.zero, type)) {
    throw new Error(`e3.output.fold: zero is not a value of ${printType(type)}`);
  }
  return {
    kind: 'fold',
    type,
    emit: FunctionType([type], NullType),
    zero: config.zero,
    combine: East.function([type, type], type, config.combine as any).toIR(),
  };
}

/**
 * The output kinds a stream task emits into: `array`, `set`, `dict` and
 * `fold`.
 */
export const output = { array, set, dict, fold };
