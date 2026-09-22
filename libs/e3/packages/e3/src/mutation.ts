/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Mutation definitions for e3 packages — the write half of the record
 * machinery (CQRS; `e3.function` is the read half).
 *
 * There are three write forms and they all commit the same thing: a mutation
 * delta, the primary's and every index's changes addressed by key, which the
 * engine applies segment by segment. They differ in how the author says what
 * changed — a reducer over the whole state, a body writing through an `edit`
 * capability, or a patch sent by whoever made the edit — and so in what a
 * write costs.
 *
 * All three are pure East: purity is what makes retry-on-conflict safe, since
 * the compare-and-swap loop can re-run against fresher state with no
 * observable side effects.
 */

import type {
  AsyncFunctionExpr,
  CallableFunctionExpr,
  EastType,
  FunctionExpr,
  PatchTypeOf,
} from '@elaraai/east';
import {
  AsyncEastIR, EastTypeType, Expr, NullType, PatchType, equalFor, printType, toEastTypeValue, walkIR,
} from '@elaraai/east';
import { editTypeOf } from '@elaraai/e3-types';
import type { MutationDef, RecordDef } from './types.js';
import { hasKeyedDelta } from './record-programs.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

// Structural East-type equality, the same primitive the redeploy type-change
// guard uses (e3-core workspaces.ts): compare the encoded EastTypeValues.
const typeValueEqual = equalFor(EastTypeType);
const sameEastType = (a: EastType, b: EastType): boolean =>
  typeValueEqual(toEastTypeValue(a), toEastTypeValue(b));

/** The shared guards: a synchronous, platform-free body whose leading
 *  parameter is the record's state. Returns the body's signature. */
function checkBody(
  surface: string, name: string, rec: RecordDef, fn: { toIR(): unknown },
): { inputs: EastType[]; output: EastType } {
  if (!name) {
    throw new Error(`e3.${surface} requires a non-empty name`);
  }
  const ir = fn.toIR();
  if (ir instanceof AsyncEastIR) {
    throw new Error(
      `e3.${surface} '${name}' body must be a synchronous East function — ` +
      `an async body implies platform IO, which the compare-and-swap retry ` +
      `loop cannot safely re-run against fresher state.`,
    );
  }
  // A *sync* platform call is an ordinary FunctionIR, so the async check above
  // doesn't catch it — walk the whole body (walkIR descends into nested
  // closures, loop bodies and collection-op lambdas).
  walkIR((ir as { ir: never }).ir, (node) => {
    if (node.type === 'Platform') {
      throw new Error(
        `e3.${surface} '${name}' body must not call platform functions ` +
        `(found '${node.value.name}') — the compare-and-swap retry loop re-runs ` +
        `the mutation, so a platform call makes the committed record ` +
        `non-deterministic across retries.`,
      );
    }
  });
  const signature = Expr.type(fn as unknown as Expr<any>) as { inputs: EastType[]; output: EastType };
  if (signature.inputs.length < 1 || !sameEastType(rec.type, signature.inputs[0]!)) {
    const got = signature.inputs.length ? printType(signature.inputs[0]!) : 'no parameters';
    throw new Error(
      `e3.${surface} '${name}' body's first parameter must be the record's ` +
      `state type ${printType(rec.type)}, but got ${got}.`,
    );
  }
  return signature;
}

/** Refuses a form whose delta cannot be addressed by key. An Array record's
 *  patch is positional and a scalar's is a whole replace, so neither can be
 *  applied segment by segment — and both are exactly what the `reduce` form
 *  already handles by writing the state whole. */
function checkKeyed(surface: string, name: string, rec: RecordDef): void {
  if (!hasKeyedDelta(rec.type)) {
    throw new Error(
      `e3.${surface} '${name}' writes a delta addressed by key, so it needs a ` +
      `Dict or Set record — '${rec.name}' holds ${printType(rec.type)}. Use ` +
      `e3.mutation, whose reducer returns the whole state.`,
    );
  }
}

/**
 * Defines a mutation that writes a record by reducing its whole state.
 *
 * The reducer is an ordinary East function whose first parameter is the
 * current state and whose return is the new state — both the record's type,
 * enforced at compile time by the shared `T`. The extra parameter types are
 * read off the function's signature, so there is nothing to keep in sync.
 *
 * The body must be a pure, synchronous East function (no platform IO): purity
 * is what lets the compare-and-swap loop re-run the reducer against fresher
 * state safely. Async reducers and any platform call are rejected at definition
 * time. The state parameter is a frozen task input — derive the new state
 * from a `.copy()` (or build it fresh) rather than mutating in place, which
 * raises the uniform copy-first runtime error.
 *
 * The reducer sees the whole state, so its cost in the runner is the record's
 * size however little it changes; only its WRITE is proportional to what it
 * touched. {@link editMutation} is the form whose cost is the entries it
 * touches end to end.
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
 *   East.function([OrdersType, OrderType], OrdersType, ($, state, order) => {
 *     $.if(state.has(order.id), $ => $.error(East.str`duplicate order ${order.id}`));
 *     const next = $.let(state.copy());
 *     $(next.insert(order.id, order));
 *     return next;
 *   }));
 *
 * const pkg = e3.package('planning', '1.0.0', orders, placeOrder);
 * ```
 */
export function mutation<Name extends string, T extends EastType, Args extends EastType[]>(
  name: Name,
  rec: RecordDef<T>,
  fn: FunctionExpr<[T, ...Args], T> | CallableFunctionExpr<[T, ...Args], T>,
  config?: { runner?: FunctionRunner },
): MutationDef<Name, T, Args>;
export function mutation(
  name: string,
  rec: RecordDef,
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: { runner?: FunctionRunner },
): MutationDef {
  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);

  const signature = checkBody('mutation', name, rec, fn);
  // The reducer is (state, ...args) => state: the return must be the record's
  // state type too. The typed overload enforces this at compile time, but a
  // dynamic / cast caller could pass a mismatched function — and because
  // MutationObject omits the output type (it IS the record type), a mismatch
  // would be silently undetectable downstream.
  if (!sameEastType(rec.type, signature.output)) {
    throw new Error(
      `e3.mutation '${name}' reducer must return the record's state type ` +
      `${printType(rec.type)}, but returns ${printType(signature.output)}.`,
    );
  }

  return {
    kind: 'mutation',
    name,
    record: rec,
    form: 'reduce',
    // Keep the full EastIR bundle (IR + source map) so export.ts can encode
    // with encodeEastIR and preserve source locations.
    body: fn.toIR() as MutationDef['body'],
    fn: fn as CallableFunctionExpr<any, any>,
    // The extra parameter types are everything after the leading state parameter.
    argTypes: signature.inputs.slice(1),
    runner,
  };
}

/**
 * Defines a mutation that writes a record through an `edit` capability — the
 * lazy write.
 *
 * The body is `(state, ...args, edit) => Null`. It reads the state it is given
 * — lazily, so a body that looks at ten entries of a two-million-entry record
 * decodes the segments those ten live in and nothing else — and writes through
 * `edit.set(key, value)`, `edit.delete(key)` and `edit.update(key, patch)`. It
 * never returns a state, which is what lets the whole mutation cost the
 * entries it touched rather than the record's size.
 *
 * Repeated edits of one key fold: `set` after anything is that `set`; `update`
 * after `set` applies to the set value; `update` after `update` composes;
 * `delete` after anything is `delete`. A `delete` or `update` of a key the
 * record does not hold fails the mutation naming the key, exactly as applying
 * such a patch would.
 *
 * The purity rules of {@link mutation} apply unchanged.
 *
 * @typeParam Name - Mutation name (literal type)
 * @typeParam T - The owning record's state type (a Dict)
 * @typeParam Args - The EXTRA positional parameter types (between the state and the edit)
 * @typeParam E - The edit capability's struct type, `editTypeOf(T)`
 * @param name - Mutation name (unique within the record)
 * @param rec - The record this mutation writes
 * @param fn - The body `(state, ...args, edit) => null`
 * @param config - Optional runner selection (known runtimes only)
 * @returns A MutationDef to pass to `e3.package`
 *
 * @example
 * ```ts
 * const plans = e3.record('plans', DictType(StringType, PlanType), new Map());
 * const EditPlans = e3.editTypeOf(plans.type);
 *
 * const reschedule = e3.editMutation('reschedule', plans,
 *   East.function([plans.type, StringType, DateTimeType], NullType, ($, state, id, due) => {
 *     const plan = $.let(state.get(id));
 *     $(edit.set(id, { ...plan, due }));
 *   }));
 * ```
 */
export function editMutation<Name extends string, T extends EastType, Args extends EastType[], E extends EastType>(
  name: Name,
  rec: RecordDef<T>,
  fn: FunctionExpr<[T, ...Args, E], NullType> | CallableFunctionExpr<[T, ...Args, E], NullType>,
  config?: { runner?: FunctionRunner },
): MutationDef<Name, T, Args>;
export function editMutation(
  name: string,
  rec: RecordDef,
  fn: FunctionExpr<any, any> | AsyncFunctionExpr<any, any>,
  config?: { runner?: FunctionRunner },
): MutationDef {
  const runner = config?.runner ?? DEFAULT_RUNNER;
  runnerToVariant(runner);
  checkKeyed('editMutation', name, rec);

  const signature = checkBody('editMutation', name, rec, fn);
  const editType = editTypeOf(rec.type);
  const last = signature.inputs[signature.inputs.length - 1];
  if (signature.inputs.length < 2 || last === undefined || !sameEastType(editType, last)) {
    throw new Error(
      `e3.editMutation '${name}' body's LAST parameter must be the edit ` +
      `capability ${printType(editType)} — e3.editTypeOf(record.type) — but got ` +
      `${last === undefined ? 'no parameters' : printType(last)}.`,
    );
  }
  if (!sameEastType(NullType, signature.output)) {
    throw new Error(
      `e3.editMutation '${name}' body writes through 'edit' and returns Null, ` +
      `but returns ${printType(signature.output)}. Use e3.mutation for a reducer ` +
      `that returns the whole state.`,
    );
  }

  return {
    kind: 'mutation',
    name,
    record: rec,
    form: 'edit',
    body: fn.toIR() as MutationDef['body'],
    fn: fn as CallableFunctionExpr<any, any>,
    // The extra parameters sit between the leading state and the trailing edit.
    argTypes: signature.inputs.slice(1, -1),
    runner,
  };
}

/**
 * Defines the mutation that applies a patch a client computed — one door for
 * interactive edits.
 *
 * There is no body: the argument IS the change, a `PatchType(State)` sent by
 * whoever made the edit. It is the only form whose cost is independent of the
 * record's size even on a cold process, because the touched keys are known
 * before anything runs — so it is what a view's save should call, and what an
 * integration sending diffs should call.
 *
 * On a record with no secondary index the patch IS the delta and no program
 * runs at all; with indexes, one run computes the index entries the change
 * moves, since that is user East and only a runner evaluates it.
 *
 * @typeParam Name - Mutation name (literal type)
 * @typeParam T - The owning record's state type (a Dict or a Set)
 * @param rec - The record this mutation writes
 * @param name - Mutation name; defaults to `patch`
 * @param config - Optional runner selection (known runtimes only)
 * @returns A MutationDef to pass to `e3.package`
 *
 * @example
 * ```ts
 * const plans = e3.record('plans', DictType(StringType, PlanType), new Map());
 * const pkg = e3.package('planning', '1.0.0', plans, e3.patchMutation(plans));
 * ```
 */
export function patchMutation<T extends EastType, Name extends string = 'patch'>(
  rec: RecordDef<T>,
  name?: Name,
  config?: { runner?: FunctionRunner },
): MutationDef<Name, T, [PatchTypeOf<T>]>;
export function patchMutation(
  rec: RecordDef,
  name: string = 'patch',
  config?: { runner?: FunctionRunner },
): MutationDef {
  if (!name) {
    throw new Error('e3.patchMutation requires a non-empty name');
  }
  const runner = config?.runner ?? DEFAULT_RUNNER;
  runnerToVariant(runner);
  checkKeyed('patchMutation', name, rec);

  return {
    kind: 'mutation',
    name,
    record: rec,
    form: 'patch',
    argTypes: [PatchType(rec.type)],
    runner,
  };
}
