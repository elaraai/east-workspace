/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { BuiltinName } from "../builtins.js";
import { variant } from "../containers/variant.js";
import { EastError, InternalError, LazyReadError } from "../error.js";
import type { Location, SourceMap } from "../location.js";
import type { PlatformFunction } from "../platform.js";
import { printFor } from "../serialization/east.js";
import { type EastTypeValue, EastTypeValueType } from "../type_of_type.js";

/* The pieces every compiled closure and builtin shares: the context values
 * variables live in, the control-flow exceptions, the iteration locks, and
 * the call into a compiled East function a builtin makes. */

export const printTypeValue = printFor(EastTypeValueType) as (type: EastTypeValue) => string;

/**
 * Symbol used to attach source IR to compiled functions.
 * This enables serialization of free functions (functions with no captures).
 */
export const EAST_IR_SYMBOL = Symbol.for("east.ir");

/**
 * Symbol used to attach capture values to compiled functions.
 * This enables serialization of closures (functions with captures).
 */
export const EAST_CAPTURES_SYMBOL = Symbol.for("east.captures");

/**
 * Symbol used to attach source map to compiled functions.
 * Enables encoding location stacks into beast2 source_map_section.
 */
export const EAST_SOURCE_MAP_SYMBOL = Symbol.for("east.source_map");

// =============================================================================
// Context Value Types - for variables in execution context
// =============================================================================

/**
 * Context values are stored as variants to distinguish regular values from boxed mutable captures.
 * - variant("value", x): regular immutable or non-captured mutable variable
 * - variant("boxed", x): mutable captured variable (box enables shared mutation across closures)
 */
export type ContextValue<T = unknown> =
  | variant<"value", T>
  | variant<"boxed", T>;

/** Runtime context mapping variable names to their wrapped values */
export type RuntimeContext = Record<string, ContextValue>;

/** Determines if a variable requires boxing (mutable + captured) */
export function requiresBoxing(variable: { mutable: boolean; captured: boolean }): boolean {
  return variable.mutable && variable.captured;
}

/** Get a context value, throwing InternalError if missing */
export function getContextValue(ctx: RuntimeContext, name: string): ContextValue {
  const value = ctx[name];
  if (value === undefined) {
    throw new InternalError(`Variable '${name}' not found in runtime context`);
  }
  return value;
}

// =============================================================================

/** @internal The frozen-mutation error message — identical across the TS, C
 * and Python runtimes (compliance-tested), so a body that mutates a frozen
 * task input fails the same way everywhere. */
export const FROZEN_MESSAGE = "cannot mutate a frozen value (task inputs are immutable) — copy first";

/** @internal Track iteration locks to prevent concurrent modification */
export const iterationLocks = new WeakMap<any, number>();

/** @internal Lock a collection for iteration (prevents size/keyset modifications) */
export const lockForIteration = (obj: any) => {
  iterationLocks.set(obj, (iterationLocks.get(obj) || 0) + 1);
};

/** @internal Unlock a collection after iteration */
export const unlockForIteration = (obj: any) => {
  const count = iterationLocks.get(obj) || 0;
  if (count > 1) {
    iterationLocks.set(obj, count - 1);
  } else {
    iterationLocks.delete(obj);
  }
};

/** @internal An exception throw for the purpose of early function return */
export class ReturnException {
  constructor(public value: any) {}
}

/** @internal An exception throw for the purpose of early loop continue */
export class ContinueException {
  constructor(public label: string) {}
}

/** @internal An exception throw for the purpose of early loop break */
export class BreakException {
  constructor(public label: string) {}
}

/** Used to call a compiled function with the given arguments and handle errors within builtin functions */
export function call_function(loc_id: bigint, source_map: SourceMap | null, compiled_f: (...args: any[]) => any, ...args: any[]): any {
  try {
    return compiled_f(...args);
  } catch (e: unknown) {
    if (e instanceof ReturnException) {
      return e.value;
    } else if (e instanceof EastError) {
      // TODO: push loc_id to EastError once SourceMap resolution is wired up
      throw(e);
    } else if (e instanceof ContinueException) {
      throw new Error(`continue failed to find label ${e.label} at loc_id ${loc_id}`)
    } else if (e instanceof BreakException) {
      throw new Error(`break failed to find label ${e.label} at loc_id ${loc_id}`)
    } else {
      throw(e);
    }
  }
}

/** @internal The error a node that reads collections throws for `e`: a read a
 * lazy input served that failed becomes an East error at this node's
 * location, where east-c raises it, so a program can catch it; anything else
 * is thrown as it is. */
export function lazyReadErrorAt(e: unknown, loc_id: bigint, source_map: SourceMap | null): unknown {
  return e instanceof LazyReadError
    ? new EastError(e.message, { location: (source_map?.resolve(loc_id) ?? []) as Location[], cause: e })
    : e;
}

/** Builds a builtin's implementation from its node: its location and source map, for
 *  its errors, the platform, and its type parameters. */
export type BuiltinEvaluator = (loc_id: bigint, source_map: SourceMap | null, platformDef: PlatformFunction[], ...arg_types: any[]) => (...args: any[]) => any;

/** A domain's builtins, keyed by name. */
export type BuiltinEvaluators = Partial<Record<BuiltinName, BuiltinEvaluator>>;
