/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A mutation's arguments, which its declaration lists by position.
 *
 * A mutation's program is called as the runner calls every write — `(State,
 * …Args, Emit) → Null`, with as many arguments as the mutation declares — and
 * calls the author's function with them. East names a function's parameters
 * where its code is written, so the two places a program meets the arguments
 * by position are made here: the program's entry, which hands them on as one
 * struct, `{ arg0, arg1, … }`, and the author's function, called with that
 * struct's fields. Everything between is ordinary East over the struct.
 *
 * Like the readers (`record-keys.ts`), the region East's rules cannot check is
 * marked so.
 *
 * @packageDocumentation
 */
import { East, NullType, StructType, type EastType, type ExprType, type FunctionExpr } from '@elaraai/east';
import { functionAt, type IndexFunction } from './record-guards.js';

/** A mutation's arguments as one struct, by position: `{ arg0, arg1, … }`. */
export type ArgumentsType = StructType<Record<string, EastType>>;

/**
 * The struct a mutation's arguments are handed on in.
 *
 * @param argTypes - The arguments' types, in order
 * @returns `{ arg0, arg1, … }`
 */
export function argumentsType(argTypes: readonly EastType[]): ArgumentsType {
  return StructType(Object.fromEntries(argTypes.map((type, at) => [`arg${at}`, type])));
}

/* eslint-disable east/east-rules -- a mutation's arguments, by position: East names a function's parameters only where its code is written */

/**
 * A mutation's program as the runner calls it, `(State, …Args, Emit) → Null`:
 * the state, the arguments as one struct, and the emit, handed to `write`.
 *
 * @param stateType - The record's state type
 * @param argTypes - The arguments' types, in order
 * @param emitType - The delta's emit
 * @param write - `(State, Args, Emit) → Null`
 * @returns The program
 */
export function programOverArguments(
  stateType: EastType, argTypes: readonly EastType[], emitType: EastType, write: FunctionExpr<[EastType, ArgumentsType, EastType], NullType>,
): FunctionExpr<EastType[], NullType> {
  return East.function([stateType, ...argTypes, emitType], NullType, ($, ...params) => {
    const writeFn = $.const(write);
    const args = Object.fromEntries(argTypes.map((_, at) => [`arg${at}`, params[at + 1]!]));
    $(writeFn(params[0]!, args as never, params[params.length - 1]!));
  });
}

/**
 * The author's function called with the struct of its arguments: `(State,
 * Args, …after) → output`, which calls `fn(state, args.arg0, …, …after)`.
 *
 * @param fn - The author's function, `(State, …Args, …after) → output`
 * @param stateType - The record's state type
 * @param argTypes - The arguments' types, in order
 * @param after - What the function takes after them: an `edit` body's capability
 * @param output - What it returns
 * @returns The function over the struct
 * @throws {Error} When `fn` is not the East function of that signature
 */
export function callWithArguments(
  fn: IndexFunction, stateType: EastType, argTypes: readonly EastType[], after: readonly EastType[], output: EastType,
): FunctionExpr<EastType[], EastType> {
  const call = functionAt(fn, [stateType, ...argTypes, ...after], output);
  return East.function([stateType, argumentsType(argTypes), ...after], output, ($, state, args, ...rest) => {
    const callFn = $.const(call);
    const fields = args as unknown as Readonly<Record<string, ExprType<EastType>>>;
    return callFn(state, ...argTypes.map((_, at) => fields[`arg${at}`]!), ...rest);
  });
}

/* eslint-enable east/east-rules */
