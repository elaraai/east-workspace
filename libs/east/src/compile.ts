/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { type BuiltinName } from "./builtins.js";
import { type IR } from "./ir.js";
import { compareFor, equalFor, greaterEqualFor, greaterFor, isFor, lessEqualFor, lessFor, notEqualFor } from "./comparison.js";
import { diffFor } from "./patch/diff.js";
import { applyFor } from "./patch/apply.js";
import { composeFor } from "./patch/compose.js";
import { invertFor } from "./patch/invert.js";
import { ConflictError } from "./patch/index.js";
import { printFor, parseFor } from "./serialization/east.js";
import { variant, type option } from "./containers/variant.js";
import { isFrozenValue } from "./frozen.js";
import { EastError, InternalError } from "./error.js";
import type { Location } from "./location.js";
import { get_current_source_map, type SourceMap } from "./location.js";
import { SortedSet } from "./containers/sortedset.js";
import { SortedMap } from "./containers/sortedmap.js";
import { BufferWriter } from "./serialization/binary-utils.js";
import { decodeBeast2For, decodeBeastFor, encodeBeast2For, encodeBeastFor, fromJSONFor, toJSONFor, decodeCsvFor, encodeCsvFor, openBeast2LazyFor, isBeast2LazySafe, readBeast2Extents, readBeast2Type, type Beast2Extents } from "./serialization/index.js";
import { formatDateTime } from "./datetime_format/print.js";
import { parseDateTimeFormatted } from "./datetime_format/parse.js";
import type { DateTimeFormatToken } from "./datetime_format/types.js";
import { EastTypeValueType, isTypeValueEqual, type EastTypeValue, expandTypeValue, type DictTypeValue, type SetTypeValue, type ArrayTypeValue } from "./type_of_type.js";
import type { AnalyzedIR } from "./analyze.js";
import { ref } from "./containers/ref.js";
import { matrix } from "./containers/matrix.js";
import type { PlatformFunction } from "./platform.js";

export { isTypeValueEqual };
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
function getContextValue(ctx: RuntimeContext, name: string): ContextValue {
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
const FROZEN_MESSAGE = "cannot mutate a frozen value (task inputs are immutable) — copy first";

/** @internal Track iteration locks to prevent concurrent modification */
const iterationLocks = new WeakMap<any, number>();

/** @internal Lock a collection for iteration (prevents size/keyset modifications) */
const lockForIteration = (obj: any) => {
  iterationLocks.set(obj, (iterationLocks.get(obj) || 0) + 1);
};

/** @internal Unlock a collection after iteration */
const unlockForIteration = (obj: any) => {
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
class ContinueException {
  constructor(public label: string) {}
}

/** @internal An exception throw for the purpose of early loop break */
class BreakException {
  constructor(public label: string) {}
}

/** Compile `IR` into a JavaScript function using a closure-compiler technique.
* This should execute faster than a simple tree-walking interpreter, but slower than hand-written Javascript.
*
* A "context" of the current variables in scope is given. For toplevel function IR, provide `{}`.
* A "platform" is provided with JavaScript functions to perform effects, like logging. If no effects are needed, simply provide `{}`.
*
* @internal
*/
// Captured once per top-level compile; all closures share the same SourceMap.
let _compile_source_map: SourceMap | null = null;

export function compile_internal(ir: AnalyzedIR, ctx: Record<string, EastTypeValue>, platform: Record<string, (...args: any[]) => any>, asyncPlatformFns: Set<string>, platformDef: PlatformFunction[], fresh_ctx: boolean = true, compilingNodes: Set<IR> = new Set()): (ctx: RuntimeContext) => any {
  // Capture source map from the active scope on first call
  if (fresh_ctx) _compile_source_map = get_current_source_map();
  const source_map = _compile_source_map;

  // The IR is checked prior to compilation, so we can assume it's valid here.
  // The compiler needs to take care that Promises are properly awaited, so most IR nodes need both sync and async implementations.
  // We assume unnecessary `async` functions degrade performance but unnecessary `await`s are not too bad, so while we could be more "specific" in our awaits we do not bother

  if (ir.type === "Value") {
    const v = ir.value.value.value;
    return (_ctx: RuntimeContext) => v;
  } else if (ir.type === "Error") {
    const message_compiled = compile_internal(ir.value.message, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    if (ir.value.isAsync) {
      const err_location = source_map?.resolve(ir.value.loc_id) as Location[] ?? [];
      return async (ctx: RuntimeContext) => { throw new EastError(await message_compiled(ctx), { location: err_location }); };
    } else {
      const err_location = source_map?.resolve(ir.value.loc_id) as Location[] ?? [];
      return (ctx: RuntimeContext) => { throw new EastError(message_compiled(ctx), { location: err_location }); };
    }
  } else if (ir.type === "TryCatch") {
    const try_body = compile_internal(ir.value.try_body, Object.create(ctx), platform, asyncPlatformFns, platformDef, true, compilingNodes);

    const new_ctx = Object.create(ctx);
    const message_name = ir.value.message.value.name;
    const stack_name = ir.value.stack.value.name;
    new_ctx[message_name] = ir.value.message.value.type;
    new_ctx[stack_name] = ir.value.stack.value.type;
    const catch_body = compile_internal(ir.value.catch_body, new_ctx, platform, asyncPlatformFns, platformDef, true, compilingNodes);

    // Don't include finally unless necessary (Value nodes are effect free)
    const finally_body = ir.value.finally_body.type === "Value" ? undefined : compile_internal(ir.value.finally_body, Object.create(ctx), platform, asyncPlatformFns, platformDef, true, compilingNodes);

    if (ir.value.isAsync) {
      if (finally_body === undefined) {
        return async (ctx: RuntimeContext) => {
          try {
            return await try_body(Object.create(ctx))
          } catch (e) {
            if (e instanceof EastError) {
              const new_ctx: RuntimeContext = Object.create(ctx);
              new_ctx[message_name] = variant("value", e.message);
              new_ctx[stack_name] = variant("value", e.location.map(l => ({ filename: l.filename, line: l.line, column: l.column })));
              return await catch_body(new_ctx);
            } else {
              throw(e);
            }
          }
        }
      } else {
        return async (ctx: RuntimeContext) => {
          try {
            return await try_body(Object.create(ctx))
          } catch (e) {
            if (e instanceof EastError) {
              const new_ctx: RuntimeContext = Object.create(ctx);
              new_ctx[message_name] = variant("value", e.message);
              new_ctx[stack_name] = variant("value", e.location.map(l => ({ filename: l.filename, line: l.line, column: l.column })));
              return await catch_body(new_ctx);
            } else {
              throw(e);
            }
          } finally {
            await finally_body(Object.create(ctx));
          }
        }
      }
    } else {
      if (finally_body === undefined) {
        return (ctx: RuntimeContext) => {
          try {
            return try_body(Object.create(ctx))
          } catch (e) {
            if (e instanceof EastError) {
              const new_ctx: RuntimeContext = Object.create(ctx);
              new_ctx[message_name] = variant("value", e.message);
              new_ctx[stack_name] = variant("value", e.location.map(l => ({ filename: l.filename, line: l.line, column: l.column })));
              return catch_body(new_ctx);
            } else {
              throw(e);
            }
          }
        }
      } else {
        return (ctx: RuntimeContext) => {
          try {
            return try_body(Object.create(ctx))
          } catch (e) {
            if (e instanceof EastError) {
              const new_ctx: RuntimeContext = Object.create(ctx);
              new_ctx[message_name] = variant("value", e.message);
              new_ctx[stack_name] = variant("value", e.location.map(l => ({ filename: l.filename, line: l.line, column: l.column })));
              return catch_body(new_ctx);
            } else {
              throw(e);
            }
          } finally {
            finally_body(Object.create(ctx));
          }
        }
      }
    }
  } else if (ir.type === "Variable") {
    const name = ir.value.name;
    // All context values are variants - read via .value
    return (ctx: RuntimeContext) => getContextValue(ctx, name).value;
  } else if (ir.type === "Let") {
    const compiled_statement = compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const name = ir.value.variable.value.name;
    ctx[name] = ir.value.variable.value.type;
    const boxed = requiresBoxing(ir.value.variable.value);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        ctx[name] = boxed
          ? variant("boxed", await compiled_statement(ctx))
          : variant("value", await compiled_statement(ctx));
        return null;
      };
    } else {
      return (ctx: RuntimeContext) => {
        ctx[name] = boxed
          ? variant("boxed", compiled_statement(ctx))
          : variant("value", compiled_statement(ctx));
        return null;
      };
    }
  } else if (ir.type === "Assign") {
    const name = ir.value.variable.value.name;
    const compiled_statement = compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    if (requiresBoxing(ir.value.variable.value)) {
      // Boxed variables: mutate in place via .value
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          getContextValue(ctx, name).value = await compiled_statement(ctx);
          return null;
        };
      } else {
        return (ctx: RuntimeContext) => {
          getContextValue(ctx, name).value = compiled_statement(ctx);
          return null;
        };
      }
    } else {
      // Non-boxed variables: replace the variant
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          const value = await compiled_statement(ctx);
          // We need to check in which prototype the variable lives
          while (!Object.hasOwn(ctx, name)) ctx = Object.getPrototypeOf(ctx);
          ctx[name] = variant("value", value);
          return null;
        };
      } else {
        return (ctx: RuntimeContext) => {
          const value = compiled_statement(ctx);
          // We need to check in which prototype the variable lives
          while (!Object.hasOwn(ctx, name)) ctx = Object.getPrototypeOf(ctx);
          ctx[name] = variant("value", value);
          return null;
        };
      }
    }
  } else if (ir.type === "As") {
    // in dynamically typed runtimes like Javascript, this is a no-op
    // (for statically typed runtimes this assists in unifying types in branches)
    return compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, fresh_ctx, compilingNodes);
  } else if (ir.type === "UnwrapRecursive") {
    // in dynamically typed runtimes like Javascript, this is a no-op
    // (for statically typed runtimes this assists in e.g. typing a reference or pointer)
    return compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, fresh_ctx, compilingNodes);
  } else if (ir.type === "WrapRecursive") {
    // in dynamically typed runtimes like Javascript, this is a no-op
    // (for statically typed runtimes this assists in e.g. typing a heap allocation)
    return compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
  } else if (ir.type === "Function") {
    // Compile-time type context for body compilation
    const typeCtx: Record<string, EastTypeValue> = {};
    for (const variable of ir.value.captures) {
      typeCtx[variable.value.name] = variable.value.type;
    }
    for (const parameter of ir.value.parameters) {
      typeCtx[parameter.value.name] = parameter.value.type;
    }

    const compiled_body = compile_internal(ir.value.body, typeCtx, platform, asyncPlatformFns, platformDef, true, compilingNodes);

    const capture_names = ir.value.captures.map(v => v.value.name);
    const parameter_names = ir.value.parameters.map(v => v.value.name);

    // Store original IR for potential serialization
    const originalIR = ir;

    return (ctx: RuntimeContext) => {
      // Runtime context for captured values
      const captureCtx: RuntimeContext = {};
      for (const name of capture_names) {
        captureCtx[name] = getContextValue(ctx, name);
      }

      const fn = (...args: any) => {
        const fnCtx: RuntimeContext = { ...captureCtx };
        parameter_names.forEach((name, i) => fnCtx[name] = variant("value", args[i]));
        return compiled_body(fnCtx);
      };

      // Attach IR to function for serialization support
      Object.defineProperty(fn, EAST_IR_SYMBOL, {
        value: originalIR,
        writable: false,
        enumerable: false,
        configurable: false
      });

      // Attach capture values for serialization support
      Object.defineProperty(fn, EAST_CAPTURES_SYMBOL, {
        value: captureCtx,
        writable: false,
        enumerable: false,
        configurable: false
      });

      // Propagate source map from enclosing compilation scope
      if (source_map) {
        Object.defineProperty(fn, EAST_SOURCE_MAP_SYMBOL, {
          value: source_map,
          writable: false,
          enumerable: false,
          configurable: false
        });
      }

      return fn;
    }
  } else if (ir.type === "AsyncFunction") {
    // Compile-time type context for body compilation
    const typeCtx: Record<string, EastTypeValue> = {};
    for (const variable of ir.value.captures) {
      typeCtx[variable.value.name] = variable.value.type;
    }
    for (const parameter of ir.value.parameters) {
      typeCtx[parameter.value.name] = parameter.value.type;
    }

    const compiled_body = compile_internal(ir.value.body, typeCtx, platform, asyncPlatformFns, platformDef, true, compilingNodes);

    const capture_names = ir.value.captures.map(v => v.value.name);
    const parameter_names = ir.value.parameters.map(v => v.value.name);

    // Store original IR for potential serialization
    const originalIR = ir;

    return (ctx: RuntimeContext) => {
      // Runtime context for captured values
      const captureCtx: RuntimeContext = {};
      for (const name of capture_names) {
        captureCtx[name] = getContextValue(ctx, name);
      }

      const fn = (...args: any) => {
        const fnCtx: RuntimeContext = { ...captureCtx };
        parameter_names.forEach((name, i) => fnCtx[name] = variant("value", args[i]));
        return compiled_body(fnCtx); // Promise can pass through in tail position
      };

      // Attach IR to function for serialization support
      Object.defineProperty(fn, EAST_IR_SYMBOL, {
        value: originalIR,
        writable: false,
        enumerable: false,
        configurable: false
      });

      // Attach capture values for serialization support
      Object.defineProperty(fn, EAST_CAPTURES_SYMBOL, {
        value: captureCtx,
        writable: false,
        enumerable: false,
        configurable: false
      });

      // Propagate source map from enclosing compilation scope
      if (source_map) {
        Object.defineProperty(fn, EAST_SOURCE_MAP_SYMBOL, {
          value: source_map,
          writable: false,
          enumerable: false,
          configurable: false
        });
      }

      return fn;
    }
  } else if (ir.type === "Call") {
    const compiled_f = compile_internal(ir.value.function, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const compiled_args = ir.value.arguments.map(argument => compile_internal(argument, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes));
    const loc_id = ir.value.loc_id;

    if (ir.value.isAsync) {
      // need to await the arguments
      return async (ctx: RuntimeContext) => {
        try {
          const args: any[] = [];
          for (const compiled_arg of compiled_args) {
            args.push(await compiled_arg(ctx));
          }
          return compiled_f(ctx)(...args);
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
      };
    } else {
      return (ctx: RuntimeContext) => {
        try {
          return compiled_f(ctx)(...compiled_args.map(arg => arg(ctx)));
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
    }
  } else if (ir.type === "CallAsync") {
    const compiled_f = compile_internal(ir.value.function, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const compiled_args = ir.value.arguments.map(argument => compile_internal(argument, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes));
    const loc_id = ir.value.loc_id;

    return async (ctx: RuntimeContext) => {
      try {
        const args: any[] = [];
        for (const compiled_arg of compiled_args) {
          args.push(await compiled_arg(ctx));
        }
        return await compiled_f(ctx)(...args);
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
    };
  } else if (ir.type === "IfElse") {
    const ifs: {
      predicate: (ctx: any) => boolean | Promise<boolean>,
      body: (ctx: any) => any
    }[] = [];
    let asyncPredicate = false;
    for (const { predicate, body } of ir.value.ifs) {
      if (predicate.value.isAsync) {
        asyncPredicate = true;
      }
      ifs.push({
        predicate: compile_internal(predicate, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes),
        body: compile_internal(body, Object.create(ctx), platform, asyncPlatformFns, platformDef, true, compilingNodes),
      });
    }
    const else_body = compile_internal(ir.value.else_body, Object.create(ctx), platform, asyncPlatformFns, platformDef, true, compilingNodes);

    if (ir.value.isAsync) {
      if (asyncPredicate) {
        return async (ctx: RuntimeContext) => {
          for (const { predicate, body } of ifs) {
            if (await predicate(ctx)) {
              return await body(Object.create(ctx));
            }
          }
          return await else_body(Object.create(ctx));
        };
      } else {
        return async (ctx: RuntimeContext) => {
          for (const { predicate, body } of ifs) {
            if (predicate(ctx) as boolean) {
              return await body(Object.create(ctx));
            }
          }
          return await else_body(Object.create(ctx));
        };
      }
    } else {
      return (ctx: RuntimeContext) => {
        for (const { predicate, body } of ifs) {
          if (predicate(ctx) as boolean) {
            return body(Object.create(ctx));
          }
        }
        return else_body(Object.create(ctx));
      };
    }
  } else if (ir.type === "Match") {
    const compiled_variant = compile_internal(ir.value.variant, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const compiled_cases: Record<string, (ctx: RuntimeContext) => any> = {};
    const data_names: Record<string, string> = {};

    for (const { case: k, variable, body } of ir.value.cases) {
      const ctx2 = Object.create(ctx);
      const data_name = variable.value.name;
      data_names[k] = data_name;
      ctx2[data_name] = variable.value.type;
      compiled_cases[k] = compile_internal(body, ctx2, platform, asyncPlatformFns, platformDef, true, compilingNodes);
    }

    if (ir.value.isAsync) {
      if (ir.value.variant.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          const v: variant = await compiled_variant(ctx);
          const ctx2: RuntimeContext = Object.create(ctx);
          ctx2[data_names[v.type]!] = variant("value", v.value);
          return await compiled_cases[v.type]!(ctx2);
        };
      } else {
        return async (ctx: RuntimeContext) => {
          const v: variant = compiled_variant(ctx);
          const ctx2: RuntimeContext = Object.create(ctx);
          ctx2[data_names[v.type]!] = variant("value", v.value);
          return await compiled_cases[v.type]!(ctx2);
        };
      }
    } else {
      return (ctx: RuntimeContext) => {
        const v: variant = compiled_variant(ctx);
        const ctx2: RuntimeContext = Object.create(ctx);
        ctx2[data_names[v.type]!] = variant("value", v.value);
        return compiled_cases[v.type]!(ctx2);
      };
    }
  } else if (ir.type === "While") {
    const compiled_predicate = compile_internal(ir.value.predicate, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const ctx2 = Object.create(ctx);
    const compiled_body = compile_internal(ir.value.body, ctx2, platform, asyncPlatformFns, platformDef, true, compilingNodes);
    const label = ir.value.label.name;

    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        while (await compiled_predicate(ctx)) {
          try {
            const ctx2 = Object.create(ctx);
            await compiled_body(ctx2);
          } catch (e: unknown) {
            if (e instanceof ContinueException && e.label === label) {
              continue;
            } else if (e instanceof BreakException && e.label === label) {
              break;
            } else {
              throw e;
            }
          }
        }
        return null;
      };
    } else {
      return (ctx: RuntimeContext) => {
        while (compiled_predicate(ctx)) {
          try {
            const ctx2 = Object.create(ctx);
            compiled_body(ctx2);
          } catch (e: unknown) {
            if (e instanceof ContinueException && e.label === label) {
              continue;
            } else if (e instanceof BreakException && e.label === label) {
              break;
            } else {
              throw e;
            }
          }
        }
        return null;
      };
    }
  } else if (ir.type === "ForArray") {
    const value_type = (expandTypeValue(ir.value.array.value.type) as ArrayTypeValue).value;
    const compiled_array = compile_internal(ir.value.array, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const ctx2 = Object.create(ctx);
    const key_name = ir.value.key.value.name;
    const value_name = ir.value.value.value.name;
    ctx2[key_name] = variant("Integer", null);
    ctx2[value_name] = value_type;
    const compiled_body = compile_internal(ir.value.body, ctx2, platform, asyncPlatformFns, platformDef, true, compilingNodes);
    const label = ir.value.label.name;

    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const array = await compiled_array(ctx);
        lockForIteration(array);
        try {
          for (const [key, value] of array.entries()) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", BigInt(key));
            ctx2[value_name] = variant("value", value);
            try {
              await compiled_body(ctx2);
            } catch (e: unknown) {
              if (e instanceof ContinueException && e.label === label) {
                continue;
              } else if (e instanceof BreakException && e.label === label) {
                break;
              } else {
                throw e;
              }
            }
          }
          return null;
        } finally {
          unlockForIteration(array);
        }
      };
    } else {
        return (ctx: RuntimeContext) => {
        const array = compiled_array(ctx);
        lockForIteration(array);
        try {
          for (const [key, value] of array.entries()) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", BigInt(key));
            ctx2[value_name] = variant("value", value);
            try {
              compiled_body(ctx2);
            } catch (e: unknown) {
              if (e instanceof ContinueException && e.label === label) {
                continue;
              } else if (e instanceof BreakException && e.label === label) {
                break;
              } else {
                throw e;
              }
            }
          }
          return null;
        } finally {
          unlockForIteration(array);
        }
      };
    }
  } else if (ir.type === "ForSet") {
    const key_type = (expandTypeValue(ir.value.set.value.type) as SetTypeValue).value;
    const compiled_set = compile_internal(ir.value.set, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const ctx2 = Object.create(ctx);
    const key_name = ir.value.key.value.name;
    ctx2[key_name] = key_type;
    const compiled_body = compile_internal(ir.value.body, ctx2, platform, asyncPlatformFns, platformDef, true, compilingNodes);
    const label = ir.value.label.name;

    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const set = await compiled_set(ctx);
        lockForIteration(set);
        try {
          for (const key of set) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", key);
            try {
              await compiled_body(ctx2);
            } catch (e: unknown) {
              if (e instanceof ContinueException && e.label === label) {
                continue;
              } else if (e instanceof BreakException && e.label === label) {
                break;
              } else {
                throw e;
              }
            }
          }
          return null;
        } finally {
          unlockForIteration(set);
        }
      };
    } else {
        return (ctx: RuntimeContext) => {
        const set = compiled_set(ctx);
        lockForIteration(set);
        try {
          for (const key of set) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", key);
            try {
              compiled_body(ctx2);
            } catch (e: unknown) {
              if (e instanceof ContinueException && e.label === label) {
                continue;
              } else if (e instanceof BreakException && e.label === label) {
                break;
              } else {
                throw e;
              }
            }
          }
          return null;
        } finally {
          unlockForIteration(set);
        }
      };
    }
  } else if (ir.type === "ForDict") {
    const key_type = (expandTypeValue(ir.value.dict.value.type) as DictTypeValue).value.key;
    const value_type = (expandTypeValue(ir.value.dict.value.type) as DictTypeValue).value.value;
    const compiled_dict = compile_internal(ir.value.dict, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const ctx2 = Object.create(ctx);
    const key_name = ir.value.key.value.name;
    const value_name = ir.value.value.value.name;
    ctx2[key_name] = key_type;
    ctx2[value_name] = value_type;
    const compiled_body = compile_internal(ir.value.body, ctx2, platform, asyncPlatformFns, platformDef, true, compilingNodes);
    const label = ir.value.label.name;

    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const dict = await compiled_dict(ctx);
        lockForIteration(dict);
        try {
          for (const [key, value] of dict) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", key);
            ctx2[value_name] = variant("value", value);
            try {
              await compiled_body(ctx2);
            } catch (e: unknown) {
              if (e instanceof ContinueException && e.label === label) {
                continue;
              } else if (e instanceof BreakException && e.label === label) {
                break;
              } else {
                throw e;
              }
            }
          }
          return null;
        } finally {
          unlockForIteration(dict);
        }
      };
    } else {
        return (ctx: RuntimeContext) => {
        const dict = compiled_dict(ctx);
        lockForIteration(dict);
        try {
          for (const [key, value] of dict) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", key);
            ctx2[value_name] = variant("value", value);
            try {
              compiled_body(ctx2);
            } catch (e: unknown) {
              if (e instanceof ContinueException && e.label === label) {
                continue;
              } else if (e instanceof BreakException && e.label === label) {
                break;
              } else {
                throw e;
              }
            }
          }
          return null;
        } finally {
          unlockForIteration(dict);
        }
      };
    }
  } else if (ir.type === "Block") {
    // The pattern of creating a new context (e.g. a function) and then immediately invoking a block (e.g. as the function body) is very common.
    // Here we avoid creating a second context when possible, as an optimization.
    if (fresh_ctx) {
      const compiled_statements: ((ctx: RuntimeContext) => any)[] = [];
      for (const statement of ir.value.statements) {
        const compiled_statement = compile_internal(statement, ctx, platform, asyncPlatformFns, platformDef, true, compilingNodes);
        compiled_statements.push(compiled_statement);
      }
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          let ret = null;
          for (const statement of compiled_statements) {
            ret = await statement(ctx);
          }
          return ret;
        };
      } else {
        return (ctx: RuntimeContext) => {
          let ret = null;
          for (const statement of compiled_statements) {
            ret = statement(ctx);
          }
          return ret;
        };
      }
    } else {
      const ctx2 = Object.create(ctx);
      const compiled_statements: ((ctx: RuntimeContext) => any)[] = [];
      for (const statement of ir.value.statements) {
        const compiled_statement = compile_internal(statement, ctx2, platform, asyncPlatformFns, platformDef, true, compilingNodes);
        compiled_statements.push(compiled_statement);
      }
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          const ctx2 = Object.create(ctx);
          let ret = null;
          for (const statement of compiled_statements) {
            ret = await statement(ctx2);
          }
          return ret;
        };
      } else {
          return (ctx: RuntimeContext) => {
          const ctx2 = Object.create(ctx);
          let ret = null;
          for (const statement of compiled_statements) {
            ret = statement(ctx2);
          }
          return ret;
        }
      }
    }
  } else if (ir.type === "GetField") {
    const struct = compile_internal(ir.value.struct, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    const field = ir.value.field;
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => (await struct(ctx))[field];
    } else {
      return (ctx: RuntimeContext) => struct(ctx)[field];
    }
  } else if (ir.type === "Struct") {
    const fields = ir.value.fields.map(f => {
      return compile_internal(f.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    });
    const keys = ir.value.fields.map(f => f.name);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const fs: [string, any][] = [];
        for (const [i, a] of fields.entries()) {
          fs.push([keys[i]!, await a(ctx)]);
        }
        return Object.fromEntries(fs);
      };
    } else {
      return (ctx: RuntimeContext) => Object.fromEntries(fields.map((a, i) => [keys[i]!, a(ctx)]));
    }
  } else if (ir.type === "Variant") {
    const k = ir.value.case;
    const v = compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => variant(k, await v(ctx));
    } else {
      return (ctx: RuntimeContext) => variant(k, v(ctx));
    }
  } else if (ir.type === "NewRef") {
    const value = compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => ref(await value(ctx));
    } else {
      return (ctx: RuntimeContext) => ref(value(ctx));
    }
  } else if (ir.type === "NewArray") {
    const values = ir.value.values.map(a => {
      return compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)
    });
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        let vals: any[] = [];
        for (const a of values) {
          vals.push(await a(ctx));
        }
        return vals;
      }
    } else {
      return (ctx: RuntimeContext) => values.map(a => a(ctx));
    }
  } else if (ir.type === "NewSet") {
    const values = ir.value.values.map(a => {
      return compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)
    });
    const keyComparer = compareFor(ir.value.type.value);
    if (ir.value.isAsync) {
      return (ctx: RuntimeContext) => {
        const keys: any[] = [];
        for (const a of values) {
          keys.push(a(ctx));
        }
        return new SortedSet(keys, keyComparer);
      }
    } else {
      return (ctx: RuntimeContext) => new SortedSet(values.map(a => a(ctx)), keyComparer);
    }
  } else if (ir.type === "NewDict") {
    const values = ir.value.values.map(({key, value}) => {
      return [compile_internal(key, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes), compile_internal(value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)] as const;
    });
    const keyComparer = compareFor(ir.value.type.value.key);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const entries: [any, any][] = [];
        for (const [k, v] of values) {
          entries.push([await k(ctx), await v(ctx)]);
        }
        return new SortedMap(entries, keyComparer);
      }
    } else {
      return (ctx: RuntimeContext) => new SortedMap(values.map(([k, v]) => [k(ctx), v(ctx)]), keyComparer);
    }
  } else if (ir.type === "NewVector") {
    const elementType = ir.value.type.value; // element EastTypeValue
    const values = ir.value.values.map(a => {
      return compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)
    });
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const vals: any[] = [];
        for (const a of values) {
          vals.push(await a(ctx));
        }
        return createTypedArray(elementType, vals);
      }
    } else {
      return (ctx: RuntimeContext) => {
        const vals = values.map(a => a(ctx));
        return createTypedArray(elementType, vals);
      }
    }
  } else if (ir.type === "NewMatrix") {
    const elementType = ir.value.type.value;
    const rows = Number(ir.value.rows);
    const cols = Number(ir.value.cols);
    const values = ir.value.values.map(a => {
      return compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)
    });
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const vals: any[] = [];
        for (const a of values) {
          vals.push(await a(ctx));
        }
        return matrix(createTypedArray(elementType, vals), rows, cols);
      }
    } else {
      return (ctx: RuntimeContext) => {
        const vals = values.map(a => a(ctx));
        return matrix(createTypedArray(elementType, vals), rows, cols);
      }
    }
  } else if (ir.type === "Return") {
    const compiled_value = compile_internal(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        throw new ReturnException(await compiled_value(ctx));
      };
    } else {
      return (ctx: RuntimeContext): any => {
        throw new ReturnException(compiled_value(ctx));
      };
    }
  } else if (ir.type === "Continue") {
    const label = ir.value.label;
    return (_ctx: RuntimeContext): any => {
      throw new ContinueException(label.name);
    };
  } else if (ir.type === "Break") {
    const label = ir.value.label;
    return (_ctx: RuntimeContext): any => {
      throw new BreakException(label.name);
    };
  } else if (ir.type === "Builtin") {
    let argsAsync = false;
    const args = ir.value.arguments.map((a, _i) => {
      if (a.value.isAsync) {
        argsAsync = true;
      }

      return compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)
    });

    // Special optimization for regex builtins with literal pattern/flags
    const loc_id = ir.value.loc_id;
    if ((ir.value.builtin === "RegexContains" || ir.value.builtin === "RegexIndexOf" || ir.value.builtin === "RegexReplace") &&
    ir.value.arguments[1]?.type === "Value" &&
    ir.value.arguments[2]?.type === "Value") {
      if (ir.value.arguments[1].value.value.type !== "String") {
        throw new Error(`Regex builtin pattern argument must be String literal at loc_id ${ir.value.arguments[1].value.loc_id}`);
      }
      if (ir.value.arguments[2].value.value.type !== "String") {
        throw new Error(`Regex builtin flags argument must be String literal at loc_id ${ir.value.arguments[2].value.loc_id}`);
      }

      // Compile regex once at closure compilation time
      const pattern = ir.value.arguments[1].value.value.value as string;
      const flags = ir.value.arguments[2].value.value.value as string;
      const textArg = args[0]!; // Already compiled text argument

      if (ir.value.builtin === "RegexContains") {
        const compiledRegex = new RegExp(pattern, flags);
        return (ctx: RuntimeContext) => compiledRegex.test(textArg(ctx));
      } else if (ir.value.builtin === "RegexIndexOf") {
        const compiledRegex = new RegExp(pattern, flags);
        return (ctx: RuntimeContext) => {
          const text = textArg(ctx);
          const codeUnitIndex = text.search(compiledRegex);
          if (codeUnitIndex === -1) return -1n;

          // Convert code unit index to codepoint index
          let codepointIndex = 0;
          let codeUnitPos = 0;
          for (const char of text) {
            if (codeUnitPos === codeUnitIndex) {
              return BigInt(codepointIndex);
            }
            codeUnitPos += char.length;
            codepointIndex++;
          }
          return -1n;
        };
      } else { // RegexReplace
        // Precompile regex with global flag for replaceAll semantics
        const globalFlags = flags.includes('g') ? flags : flags + 'g';
        const compiledRegex = new RegExp(pattern, globalFlags);

        // Check if replacement is also constant for full optimization
        if (ir.value.arguments[3]?.type === "Value") {
          if (ir.value.arguments[3].value.value.type !== "String") {
            throw new Error(`RegexReplace builtin replacement argument must be String literal at loc_id ${ir.value.arguments[3].value.loc_id}`);
          }

          // FULL OPTIMIZATION: Pattern, flags, and replacement are all constant
          const replacement = ir.value.arguments[3].value.value.value as string;

          // Validate replacement string: only allow $$, $1-$9, and $<
          // This is stricter than JavaScript's native behavior but provides clear, consistent semantics
          // and avoids backend-specific features like $&, $`, $'
          let i = 0;
          while (i < replacement.length) {
            const char = replacement[i]!;
            if (char === '$') {
              i += char.length;
              let char2 = replacement[i];
              if (char2 === undefined) {
                return (_ctx: RuntimeContext) => { throw new EastError(`invalid regex replacement string: unescaped $ at end of string`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] }) };
              } else if (char2 === '$') {
                i += 1;
              } else if (char2 >= '1' && char2 <= '9') {
                i += 1;
                char2 = replacement[i];
                while (char2 !== undefined && char2 >= '0' && char2 <= '9') {
                  i += 1;
                  char2 = replacement[i];
                }
              } else if (char2 === '<') {
                // Scan until closing >
                i += 1;
                const init_i = i;
                char2 = replacement[i];
                while (true) {
                  if (char2 === undefined) {
                    return (_ctx: RuntimeContext) => { throw new EastError(`invalid regex replacement string: unterminated group name in $<...>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] }) };
                  }
                  if (char2 === '>') {
                    break;
                  }
                  if (!((char2 >= '0' && char2 <= '9') || (char2 >= 'a' && char2 <= 'z') || (char2 >= 'A' && char2 <= 'Z') || char2 === '_')) {
                    return (_ctx: RuntimeContext) => { throw new EastError(`invalid regex replacement string: invalid character ${JSON.stringify(char2)} in group name in $<...>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] }) };
                  }
                  i += 1;
                  char2 = replacement[i];
                }
                if (i === init_i) {
                  return (_ctx: RuntimeContext) => { throw new EastError(`invalid regex replacement string: empty group name in $<>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] }) };
                }
                i += 1; // for closing >
              } else {
                return (_ctx: RuntimeContext) => { throw new EastError(`invalid regex replacement string: unescaped $ at $${char2}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] }) };
              }
            } else {
              i += char.length;
            }
          }

          return (ctx: RuntimeContext) => {
            const text = textArg(ctx);
            return text.replaceAll(compiledRegex, replacement);
          };
        } else {
          // PARTIAL OPTIMIZATION: Pattern and flags constant, replacement dynamic
          const replacementArg = args[3]!;
          return (ctx: RuntimeContext) => {
            const text = textArg(ctx);
            const replacement = replacementArg(ctx);

            // Validate replacement string: only allow $$, $1-$9, and $<
            // This is stricter than JavaScript's native behavior but provides clear, consistent semantics
            // and avoids backend-specific features like $&, $`, $'
            let i = 0;
            while (i < replacement.length) {
              const char = replacement[i]!;
              if (char === '$') {
                i += char.length;
                let char2 = replacement[i];
                if (char2 === undefined) {
                  throw new EastError(`invalid regex replacement string: unescaped $ at end of string`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
                } else if (char2 === '$') {
                  i += 1;
                } else if (char2 >= '1' && char2 <= '9') {
                  i += 1;
                  char2 = replacement[i];
                  while (char2 !== undefined && char2 >= '0' && char2 <= '9') {
                    i += 1;
                    char2 = replacement[i];
                  }
                } else if (char2 === '<') {
                  // Scan until closing >
                  i += 1;
                  const init_i = i;
                  char2 = replacement[i];
                  while (true) {
                    if (char2 === undefined) {
                      throw new EastError(`invalid regex replacement string: unterminated group name in $<...>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
                    }
                    if (char2 === '>') {
                      break;
                    }
                    if (!((char2 >= '0' && char2 <= '9') || (char2 >= 'a' && char2 <= 'z') || (char2 >= 'A' && char2 <= 'Z') || char2 === '_')) {
                      throw new EastError(`invalid regex replacement string: invalid character ${JSON.stringify(char2)} in group name in $<...>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
                    }
                    i += 1;
                    char2 = replacement[i];
                  }
                  if (i === init_i) {
                    throw new EastError(`invalid regex replacement string: empty group name in $<>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
                  }
                  i += 1; // for closing >
                } else {
                  throw new EastError(`invalid regex replacement string: unescaped $ at $${char2}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
                }
              } else {
                i += char.length;
              }
            }
            return text.replaceAll(compiledRegex, replacement);
          };
        }
      }
    }

    const evaluator = builtin_evaluators[ir.value.builtin](ir.value.loc_id, source_map, platformDef, ...ir.value.type_parameters);
    if (argsAsync) {
      return async (ctx: RuntimeContext) => {
        const args_resolved: any[] = [];
        for (const a of args) {
          args_resolved.push(await a(ctx));
        }
        return evaluator(...args_resolved);
      }
    } else {
      return (ctx: RuntimeContext) => evaluator(...args.map(a => a(ctx)));
    }
  } else if (ir.type === "Platform") {
    const loc_id = ir.value.loc_id;
    let argsAsync = false;
    const args = ir.value.arguments.map(a => {
      if (a.value.isAsync) {
        argsAsync = true;
      }

      return compile_internal(a, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes)
    });

    // Look up platform function definition to check if generic
    const platformFn = platformDef.find(p => p.name === ir.value.name);

    const typeParams = ir.value.type_parameters ?? [];

    // Get evaluator - for generic functions, call factory with type params
    let evaluator: (...args: any[]) => any;
    if (typeParams.length > 0 && platformFn?.type_parameters && platformFn.type_parameters.length > 0) {
      // Generic platform function - fn is a factory that takes type params
      if (!platformFn.fn) {
        // Missing generic platform function - create stub that throws at runtime
        const name = ir.value.name;
        evaluator = () => {
          throw new EastError(`Platform function '${name}' is not available`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        };
      } else {
        evaluator = platformFn.fn(...typeParams);
      }
    } else {
      // Non-generic - use platform map for backwards compatibility
      const platformEvaluator = platform[ir.value.name];
      if (platformEvaluator === undefined) {
        // Missing platform function - create stub that throws at runtime
        const name = ir.value.name;
        evaluator = () => {
          throw new EastError(`Platform function '${name}' is not available`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        };
      } else {
        evaluator = platformEvaluator;
      }
    }

    if (argsAsync) {
      return async (ctx: RuntimeContext) => {
        const args_resolved: any[] = [];
        for (const a of args) {
          args_resolved.push(await a(ctx));
        }
        return evaluator(...args_resolved); // evaluator can return Promise unconditionally in tail position if the platform function is async
      }
    } else {
      return (ctx: RuntimeContext) => evaluator(...args.map(a => a(ctx))); // evaluator can return Promise unconditionally in tail position if the platform function is async
    }
  } else {
    throw new Error(`Unhandled IR type ${(ir satisfies never as IR).type} at loc_id ${(ir as IR).value.loc_id}`); // The `satisfies never` here ensures that this branch is unreachable if all IR types are handled
  }
}

/** Used to call a compiled function with the given arguments and handle errors within builtin functions */
function call_function(loc_id: bigint, source_map: SourceMap | null, compiled_f: (...args: any[]) => any, ...args: any[]): any {
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


/** Allocates an empty TypedArray of the given length for a given element type */
function allocateTypedArray(elementType: EastTypeValue, length: number): Float64Array | BigInt64Array | Uint8ClampedArray {
  if (elementType.type === "Float") return new Float64Array(length);
  if (elementType.type === "Integer") return new BigInt64Array(length);
  if (elementType.type === "Boolean") return new Uint8ClampedArray(length);
  throw new Error(`Unsupported vector element type: ${elementType.type}`);
}

/** Wraps to East's 64-bit Integer semantics */
function wrapI64(x: bigint): bigint {
  return BigInt.asIntN(64, x);
}

/** Throws unless the vector/matrix element type parameter is Float or Integer */
function requireNumericElem(builtin: string, T: EastTypeValue, loc_id: bigint, source_map: SourceMap | null): "Float" | "Integer" {
  if (T.type !== "Float" && T.type !== "Integer") {
    throw new EastError(`${builtin} requires Float or Integer elements`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
  return T.type;
}

/** Throws the shared length-mismatch error for elementwise vector operands */
function requireSameLength(a: { length: number }, b: { length: number }, loc_id: bigint, source_map: SourceMap | null): void {
  if (a.length !== b.length) {
    throw new EastError(`Vector length mismatch (${a.length} vs ${b.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
}

/** Throws the shared dimension-mismatch error for elementwise matrix operands */
function requireSameDims(a: matrix, b: matrix, loc_id: bigint, source_map: SourceMap | null): void {
  if (a.rows !== b.rows || a.cols !== b.cols) {
    throw new EastError(`Matrix dimension mismatch (${a.rows}x${a.cols} vs ${b.rows}x${b.cols})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
}

/** Validates the sparse-accumulator invariant: parallel lengths and strictly ascending indices */
function requireSparse(ix: BigInt64Array, v: { length: number }, loc_id: bigint, source_map: SourceMap | null): void {
  if (ix.length !== v.length) {
    throw new EastError(`Sparse index and value lengths differ (${ix.length} vs ${v.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
  }
  for (let i = 1; i < ix.length; i++) {
    if (ix[i]! <= ix[i - 1]!) {
      throw new EastError(`Sparse index vector must be strictly ascending`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
  }
}

/** Creates the appropriate TypedArray for a given element type */
function createTypedArray(elementType: EastTypeValue, values: any[]): Float64Array | BigInt64Array | Uint8ClampedArray {
  if (elementType.type === "Float") {
    const arr = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) arr[i] = values[i];
    return arr;
  } else if (elementType.type === "Integer") {
    const arr = new BigInt64Array(values.length);
    for (let i = 0; i < values.length; i++) arr[i] = values[i];
    return arr;
  } else if (elementType.type === "Boolean") {
    const arr = new Uint8ClampedArray(values.length);
    for (let i = 0; i < values.length; i++) arr[i] = values[i] ? 1 : 0;
    return arr;
  } else {
    throw new Error(`Unsupported vector element type: ${elementType.type}`);
  }
}

/** @internal */
const builtin_evaluators: Record<BuiltinName, (loc_id: bigint, source_map: SourceMap | null, platformDef: PlatformFunction[], ...arg_types: any[]) => (...args: any[]) => any> = {
  Is: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => isFor(T),
  Equal: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => equalFor(T),
  NotEqual: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => notEqualFor(T),
  Less: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => lessFor(T),
  LessEqual: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => lessEqualFor(T),
  Greater: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => greaterFor(T),
  GreaterEqual: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => greaterEqualFor(T),
  Diff: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => diffFor(T),
  ApplyPatch: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const apply = applyFor(T);
    return (base: any, patch: any) => {
      try {
        return apply(base, patch);
      } catch (e) {
        if (e instanceof ConflictError) {
          throw new EastError(e.message, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
        throw e;
      }
    };
  },
  ComposePatch: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const compose = composeFor(T);
    return (first: any, second: any) => {
      try {
        return compose(first, second);
      } catch (e) {
        if (e instanceof ConflictError) {
          throw new EastError(e.message, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
        throw e;
      }
    };
  },
  InvertPatch: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => invertFor(T),
  BooleanNot: (_loc_id: bigint, _source_map: SourceMap | null) => (x: boolean) => !x,
  BooleanOr: (_loc_id: bigint, _source_map: SourceMap | null) => (x: boolean, y: boolean) => x || y,
  BooleanAnd: (_loc_id: bigint, _source_map: SourceMap | null) => (x: boolean, y: boolean) => x && y,
  BooleanXor: (_loc_id: bigint, _source_map: SourceMap | null) => (x: boolean, y: boolean) => x !== y,
  
  IntegerToFloat: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => Number(x),
  IntegerNegate: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => BigInt.asIntN(64, -x),
  IntegerAdd: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint, y: bigint) => BigInt.asIntN(64, x + y),
  IntegerSubtract: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint, y: bigint) => BigInt.asIntN(64, x - y),
  IntegerMultiply: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint, y: bigint) => BigInt.asIntN(64, x * y),
  IntegerDivide: (loc_id: bigint, source_map: SourceMap | null) => (x: bigint, y: bigint) => {
    if (y === 0n) throw new EastError("Division by zero", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    return BigInt.asIntN(64, x / y);
  },
  IntegerRemainder: (loc_id: bigint, source_map: SourceMap | null) => (x: bigint, y: bigint) => {
    if (y === 0n) throw new EastError("Division by zero", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    return x % y;
  },
  IntegerPow: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint, y: bigint) => y >= 0n ? BigInt.asIntN(64, x ** y) : 0n,
  IntegerAbs: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => BigInt.asIntN(64, x < 0n ? -x : x),
  IntegerSign: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => x > 0n ? 1n : x < 0n ? -1n : 0n,
  IntegerLog: (_loc_id: bigint, _source_map: SourceMap | null) => (value: bigint, base: bigint) => {
    if (value === 0n) return 0n;
    if (base <= 1n) return 0n; // Invalid base
    
    let abs_value = value < 0n ? -value : value;
    let result = 0n;
    
    while (abs_value >= base) {
      abs_value = abs_value / base;
      result = result + 1n;
    }
    
    return result;
  },
  
  FloatToInteger: (loc_id: bigint, source_map: SourceMap | null) => (x: number) => {
    if (Number.isNaN(x)) throw new EastError("Cannot convert NaN to integer", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    if (x >= 9223372036854775808) throw new EastError("Float too high to convert to integer", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    if (x < -9223372036854775808) throw new EastError("Float too low to convert to integer", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    if (!Number.isInteger(x)) { throw new EastError("Cannot convert non-integer float to integer", { location: (source_map?.resolve(loc_id) ?? []) as Location[] }); }
    return BigInt(x);
  },
  FloatNegate: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => -x,
  FloatAdd: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x + y,
  FloatSubtract: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x - y,
  FloatMultiply: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x * y,
  FloatDivide: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x / y,
  FloatRemainder: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x % y,
  FloatPow: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x ** y,
  FloatAbs: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number) => x < 0 ? -x : x,
  FloatSign: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number) => x > 0 ? 1 : x < 0 ? -1 : 0, // What sign is NaN?
  FloatSqrt: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.sqrt(value),
  FloatLog: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.log(value),
  FloatExp: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.exp(value),
  FloatSin: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.sin(value),
  FloatCos: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.cos(value),
  FloatTan: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.tan(value),
  
  Print: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    return printFor(T);
  },
  Parse: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const p = parseFor(T);
    return (x: string) => {
      const result = p(x);
      if (result.success) {
        return result.value;
      } else {
        throw new EastError(`Failed to parse ${printTypeValue(T)} at ${result.position}: ${result.error}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  StringConcat: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, y: string) => x + y,
  StringRepeat: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, y: bigint) => y > 0n ? x.repeat(Number(y)) : "",
  StringLength: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => {
    let len = 0;
    for (const _ of x) len++;
    return BigInt(len);
  },
  StringSubstring: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, from: bigint, to: bigint) => {
    // Convert bigint indices to numbers, handle forgiving semantics like JavaScript
    let fromNum = Number(from);
    let toNum = Number(to);
    
    // Handle negative indices and lengths (forgiving semantics)
    if (fromNum < 0) fromNum = 0;
    if (toNum < 0) toNum = 0;
    if (fromNum > toNum) {
      toNum = fromNum;
    }
    
    // Convert codepoint indices to code unit indices
    let codeUnitFrom = 0;
    let codeUnitTo = 0;
    let codepointIndex = 0;
    
    for (const char of x) {
      if (codepointIndex === fromNum) {
        codeUnitFrom = codeUnitTo;
      }
      if (codepointIndex === toNum) {
        break;
      }
      codeUnitTo += char.length;
      codepointIndex++;
    }
    
    // If 'from' is beyond string length, return empty string
    if (fromNum >= codepointIndex) return "";
    
    // If 'to' is beyond string length, use string end
    if (toNum > codepointIndex) {
      codeUnitTo = x.length;
    }
    
    return x.substring(codeUnitFrom, codeUnitTo);
  },
  StringUpperCase: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.toUpperCase(),
  StringLowerCase: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.toLowerCase(),
  StringSplit: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, delimiter: string) => {
    if (delimiter === "") {
      if (x === "") {
        // Split always returns at least one element
        return [""];
      } else {
        // Split into individual codepoints
        return [...x];
      }
    }
    return x.split(delimiter);
  },
  StringTrim: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.trim(),
  StringTrimStart: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.trimStart(),
  StringTrimEnd: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string) => x.trimEnd(),
  StringStartsWith: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, prefix: string) => x.startsWith(prefix),
  StringEndsWith: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, suffix: string) => x.endsWith(suffix),
  StringContains: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, substring: string) => x.includes(substring),
  StringIndexOf: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, substring: string) => {
    const codeUnitIndex = x.indexOf(substring);
    if (codeUnitIndex === -1) return -1n;
    
    // Special case for empty substring - it's always found at position 0
    if (substring === "") return BigInt(codeUnitIndex);
    
    // Convert code unit index to codepoint index
    let codepointIndex = 0;
    let codeUnitPos = 0;
    for (const char of x) {
      if (codeUnitPos === codeUnitIndex) {
        return BigInt(codepointIndex);
      }
      codeUnitPos += char.length;
      codepointIndex++;
    }
    return -1n;
  },
  StringReplace: (_loc_id: bigint, _source_map: SourceMap | null) => (x: string, searchValue: string, replaceValue: string) => {
    // Replace all occurrences (like JavaScript's string.replaceAll with string)
    return x.replaceAll(searchValue, replaceValue);
  },
  RegexContains: (_loc_id: bigint, _source_map: SourceMap | null) => (text: string, pattern: string, flags: string) => {
    const regex = new RegExp(pattern, flags);
    return regex.test(text);
  },
  RegexIndexOf: (_loc_id: bigint, _source_map: SourceMap | null) => (text: string, pattern: string, flags: string) => {
    const regex = new RegExp(pattern, flags);
    const codeUnitIndex = text.search(regex);
    if (codeUnitIndex === -1) return -1n;

    // Convert code unit index to codepoint index
    let codepointIndex = 0;
    let codeUnitPos = 0;
    for (const char of text) {
      if (codeUnitPos === codeUnitIndex) {
        return BigInt(codepointIndex);
      }
      codeUnitPos += char.length;
      codepointIndex++;
    }
    return -1n;
  },
  RegexReplace: (loc_id: bigint, source_map: SourceMap | null) => (text: string, pattern: string, flags: string, replacement: string) => {
    // Ensure global flag is set for replaceAll semantics
    const globalFlags = flags.includes('g') ? flags : flags + 'g';
    const regex = new RegExp(pattern, globalFlags);

    // Validate replacement string: only allow $$, $1-$9, and $<
    // This is stricter than JavaScript's native behavior but provides clear, consistent semantics
    // and avoids backend-specific features like $&, $`, $'
    let i = 0;
    while (i < replacement.length) {
      const char = replacement[i]!;
      if (char === '$') {
        i += char.length;
        let char2 = replacement[i];
        if (char2 === undefined) {
          throw new EastError(`invalid regex replacement string: unescaped $ at end of string`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        } else if (char2 === '$') {
          i += 1;
        } else if (char2 >= '1' && char2 <= '9') {
          i += 1;
          char2 = replacement[i];
          while (char2 !== undefined && char2 >= '0' && char2 <= '9') {
            i += 1;
            char2 = replacement[i];
          }
        } else if (char2 === '<') {
          // Scan until closing >
          i += 1;
          const init_i = i;
          char2 = replacement[i];
          while (true) {
            if (char2 === undefined) {
              throw new EastError(`invalid regex replacement string: unterminated group name in $<...>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
            }
            if (char2 === '>') {
              break;
            }
            if (!((char2 >= '0' && char2 <= '9') || (char2 >= 'a' && char2 <= 'z') || (char2 >= 'A' && char2 <= 'Z') || char2 === '_')) {
              throw new EastError(`invalid regex replacement string: invalid character ${JSON.stringify(char2)} in group name in $<...>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
            }
            i += 1;
            char2 = replacement[i];
          }
          if (i === init_i) {
            throw new EastError(`invalid regex replacement string: empty group name in $<>`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
          }
          i += 1; // for closing >
        } else {
          throw new EastError(`invalid regex replacement string: unescaped $ at $${char2}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
      } else {
        i += char.length;
      }
    }
    return text.replaceAll(regex, replacement);
  },
  StringEncodeUtf8: (_loc_id: bigint, _source_map: SourceMap | null) => {
    // do not add BOM for UTF-8
    const encoder = new TextEncoder();
    return (x: string) => {
      return encoder.encode(x);
    };
  },
  StringEncodeUtf16: (_loc_id: bigint, _source_map: SourceMap | null) => {
    // always use little-endian with BOM (most common in practice)
    return (x: string) => {
      const buffer = new BufferWriter();
      buffer.writeUint8(0xFF);
      buffer.writeUint8(0xFE);
      for (let i = 0; i < x.length; i++) {
        const codeUnit = x.charCodeAt(i);
        buffer.writeUint16LE(codeUnit);
      }
      return buffer.toUint8Array();
    };
  },
  StringParseJSON: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const fromJSON = fromJSONFor(type);
    return (x: string) => {
      let parsed: any;
      try {
        parsed = JSON.parse(x);
      } catch (e: unknown) {
        throw new EastError(`Failed to parse JSON: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      try {
        return fromJSON(parsed);
      } catch (e: unknown) {
        throw new EastError(`Failed to convert JSON to ${printTypeValue(type)}: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  StringPrintJSON: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const toJSON = toJSONFor(type);
    return (x: any) => JSON.stringify(toJSON(x));
  },
  
  DateTimeGetYear: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCFullYear()),
  DateTimeGetMonth: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCMonth() + 1), // JavaScript months are 0-based, East uses 1-based
  DateTimeGetDayOfMonth: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCDate()),
  DateTimeGetHour: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCHours()),
  DateTimeGetMinute: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCMinutes()),
  DateTimeGetSecond: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCSeconds()),
  DateTimeGetDayOfWeek: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => {
    const jsDay = date.getUTCDay(); // JavaScript: 0=Sunday, 1=Monday, ..., 6=Saturday
    return BigInt(jsDay === 0 ? 7 : jsDay); // ISO 8601: 1=Monday, 2=Tuesday, ..., 7=Sunday
  },
  DateTimeGetMillisecond: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getUTCMilliseconds()),
  DateTimeAddMilliseconds: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date, milliseconds: bigint) => new Date(date.getTime() + Number(milliseconds)),
  DateTimeDurationMilliseconds: (_loc_id: bigint, _source_map: SourceMap | null) => (date1: Date, date2: Date) => BigInt(date1.getTime() - date2.getTime()),
  DateTimeToEpochMilliseconds: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date) => BigInt(date.getTime()),
  DateTimeFromEpochMilliseconds: (_loc_id: bigint, _source_map: SourceMap | null) => (milliseconds: bigint) => new Date(Number(milliseconds)),
  DateTimeFromComponents: (_loc_id: bigint, _source_map: SourceMap | null) => (year: bigint, month: bigint, day: bigint, hour: bigint, minute: bigint, second: bigint, millisecond: bigint) => {
    const y = Number(year);
    const date = new Date(Date.UTC(y, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(millisecond)));
    // `Date.UTC` applies JavaScript's legacy two-digit-year rule, remapping a
    // year of 0-99 to 1900-1999. East years mean what they say (east-c sets
    // `tm_year = year - 1900` and does no remapping), so undo it — on the
    // ROLLED year, since an out-of-range month or day may have carried into
    // it and the normalisation is part of the contract.
    if (y >= 0 && y <= 99) date.setUTCFullYear(date.getUTCFullYear() - 1900);
    return date;
  },
  DateTimePrintFormat: (_loc_id: bigint, _source_map: SourceMap | null) => (date: Date, tokens: DateTimeFormatToken[]) => {
    return formatDateTime(date, tokens);
  },
  DateTimeParseFormat: (loc_id: bigint, source_map: SourceMap | null) => (str: string, tokens: DateTimeFormatToken[]) => {
    const result = parseDateTimeFormatted(str, tokens);
    if (result.success) {
      return result.value;
    } else {
      throw new EastError(`Failed to parse datetime at position ${result.position}: ${result.error}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
  },

  BlobSize: (_loc_id: bigint, _source_map: SourceMap | null) => (data: Uint8Array) => BigInt(data.length),
  BlobGetUint8: (loc_id: bigint, source_map: SourceMap | null) => (data: Uint8Array, index: bigint) => {
    const i = Number(index);
    if (i < 0 || i >= data.length) {
      throw new EastError(`Blob index ${index} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      return BigInt(data[i]!);
    }
  },
  BlobDecodeUtf8: (loc_id: bigint, source_map: SourceMap | null) => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return (data: Uint8Array) => {
      try {
        return decoder.decode(data);
      } catch {
        throw new EastError("Blob is not valid UTF-8", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    };
  },
  BlobDecodeUtf16: (loc_id: bigint, source_map: SourceMap | null) => {
    const decoder_be = new TextDecoder('utf-16be', { fatal: true });
    const decoder_le = new TextDecoder('utf-16le', { fatal: true });
    return (data: Uint8Array) => {
      try {
        if (data.length >= 2) {
          // Check for BOM
          if (data[0] === 0xFE && data[1] === 0xFF) {
            // Big-endian BOM
            return decoder_be.decode(data.subarray(2));
          } else if (data[0] === 0xFF && data[1] === 0xFE) {
            // Little-endian BOM
            return decoder_le.decode(data.subarray(2));
          }
        }
        // No BOM, default to little-endian (not unicode spec compliant, but more common in practice)
        return decoder_le.decode(data);
      } catch {
        throw new EastError("Blob is not valid UTF-16", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    };
  },
  BlobEncodeBeast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const encodeBeast = encodeBeastFor(type);
    return (value: any) => {
      return encodeBeast(value);
    }
  },
  BlobDecodeBeast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const decodeBeast = decodeBeastFor(type);
    return (data: Uint8Array) => {
      try {
        return decodeBeast(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to decode Beast data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  BlobEncodeBeast2: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], type: EastTypeValue) => {
    const encodeBeast2 = encodeBeast2For(type);
    return (value: any) => {
      return encodeBeast2(value);
    }
  },
  BlobDecodeBeast2: (loc_id: bigint, source_map: SourceMap | null, platformDef: PlatformFunction[], type: EastTypeValue) => {
    const decodeBeast2 = decodeBeast2For(type, { platform: platformDef });
    return (data: Uint8Array) => {
      try {
        return decodeBeast2(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to decode Beast2 data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  BlobOpenBeast2: (loc_id: bigint, source_map: SourceMap | null, platformDef: PlatformFunction[], type: EastTypeValue) => {
    // The frozen lazy open a runner gives a task input, at the expression
    // level. The header names the wire type (both container versions), and
    // paging or decoding by any other type would read garbage, so a mismatch
    // is an error rather than a decode by the declared type. Whatever cannot
    // page — a v4 container, an index-less blob, cross-segment aliasing, a
    // gated element shape — decodes whole, frozen, with the same semantics.
    // The whole decoder is built on first use: a paged blob never needs it.
    let whole: ((data: Uint8Array) => unknown) | null = null;
    const open = openBeast2LazyFor(type, { platform: platformDef, frozen: true });
    const lazySafe = isBeast2LazySafe(type, { frozen: true });
    return (data: Uint8Array) => {
      try {
        // One geometry read answers everything the open needs: the wire
        // type, whether an index exists (it throws otherwise) and whether
        // the segments are self-contained.
        let extents: Beast2Extents | null = null;
        try {
          extents = readBeast2Extents(data);
        } catch {
          extents = null;
        }
        const wire = extents !== null ? extents.typeValue : readBeast2Type(data);
        if (!isTypeValueEqual(wire, type)) {
          throw new Error(`beast2: cannot open a blob of type ${printTypeValue(wire)} as ${printTypeValue(type)}`);
        }
        if (lazySafe && extents !== null && extents.selfContained) return open(data);
        whole ??= decodeBeast2For(type, { platform: platformDef, frozen: true });
        return whole(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to open Beast2 data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    };
  },
  BlobDecodeCsv: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], structType: EastTypeValue, _configType: EastTypeValue) => {
    return (data: Uint8Array, config: any) => {
      try {
        const decoder = decodeCsvFor(structType, config);
        return decoder(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to decode CSV data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  ArrayEncodeCsv: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], structType: EastTypeValue, _configType: EastTypeValue) => {
    return (data: any[], config: any) => {
      try {
        const encoder = encodeCsvFor(structType, config);
        return encoder(data);
      } catch (e: unknown) {
        throw new EastError(`Failed to encode CSV data: ${(e as Error).message}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },

  RefGet: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (ref: ref<any>) => {
    return ref.value;
  },
  RefUpdate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (ref: ref<any>, value: any) => {
    if (isFrozenValue(ref)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    ref.value = value;
    return null;
  },
  RefMerge: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (ref: ref<any>, value: any, merger: (existing: any, value: any) => any) => {
    if (isFrozenValue(ref)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const new_value = call_function(loc_id, source_map,merger, ref.value, value);
    ref.value = new_value;
    return null;
  },
  
  ArrayGenerate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (size: bigint, f: (i: bigint) => any) => {
    const result: any[] = [];
    for (let i = 0n; i < size; i += 1n) {
      const v = call_function(loc_id, source_map,f, i);
      result.push(v);
    }
    return result;
  },
  ArrayRange: (_loc_id: bigint, _source_map: SourceMap | null) => (start: bigint, end: bigint, step: bigint) => {
    const result: any[] = [];
    if (step === 0n) {
      return result; // empty array
    } else if (step > 0n) {
      for (let i = start; i < end; i += step) {
        result.push(i);
      }
    } else { // step < 0
      for (let i = start; i > end; i += step) {
        result.push(i);
      }
    }
    return result;
  },
  ArrayLinspace: (_loc_id: bigint, _source_map: SourceMap | null) => (start: number, end: number, size: bigint) => {
    const result: any[] = [];
    if (size <= 0n) {
      return result; // empty array
    } else if (size === 1n) {
      return [start];
    } else {
      const step = (end - start) / Number(size - 1n);
      for (let i = 0n; i < size; i += 1n) {
        result.push(start + Number(i) * step);
      }
    }
    return result;
  },
  ArraySize: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => BigInt(array.length),
  ArrayHas: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint) => {
    const i = Number(key);
    return i >= 0 && i < array.length;
  },
  ArrayGet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint) => {
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      throw new EastError(`Array index ${key} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      return array[i];
    }
  },
  ArrayGetOrDefault: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint, defaultFn: (key: bigint) => any) => {
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      return call_function(loc_id, source_map,defaultFn, key);
    } else {
      return array[i];
    }
  },
  ArrayTryGet: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint) => {
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      return variant("none", null);
    } else {
      return variant("some", array[i]);
    }
  },
  ArrayUpdate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint, value: any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      throw new EastError(`Array index ${key} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      array[i] = value;
      return null;
    }
  },
  ArrayMerge: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], key: bigint, value: any, merger: (existing: any, value: any, key: bigint) => any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const i = Number(key);
    if (i < 0 || i >= array.length) {
      throw new EastError(`Array index ${key} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      const new_value = call_function(loc_id, source_map,merger, array[i], value, key);
      array[i] = new_value;
      return null;
    }
  },
  ArrayPushLast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], value: any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.push(value);
    return null;
  },
  ArrayPopLast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if (array.length === 0) {
      throw new EastError("Cannot pop from empty Array", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      return array.pop();
    }
  },
  ArrayPushFirst: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], value: any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.unshift(value);
    return null;
  },
  ArrayPopFirst: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if (array.length === 0) {
      throw new EastError("Cannot pop from empty Array", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    } else {
      return array.shift();
    }
  },
  ArrayAppend: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], other: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.push(...other);
    return null;
  },
  ArrayPrepend: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], other: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.unshift(...other);
    return null;
  },
  ArrayMergeAll: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], other: any[], merger: (v1: any, v2: any, key: bigint) => any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(array);
    lockForIteration(other);
    try {
      for (let i = 0; i < other.length; i++) {
        const key = BigInt(i);
        if (i < array.length) {
          const new_value = call_function(loc_id, source_map,merger, array[i], other[i], key);
          array[i] = new_value;
        } else {
          throw new EastError(`Array index ${key} out of bounds`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
      }
    } finally {
      unlockForIteration(other);
      unlockForIteration(array);
    }
    return null;
  },
  ArrayClear: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.length = 0;
    return null;
  },
  ArraySortInPlace: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => (array: any[], by: (a: any) => any) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(array);
    try {
      const cmp = compareFor(T2);
      array.sort((a, b) => {
        const projectedA = call_function(loc_id, source_map,by, a);
        const projectedB = call_function(loc_id, source_map,by, b);
        return cmp(projectedA, projectedB);
      });
    } finally {
      unlockForIteration(array);
    }
    return null;
  },
  ArrayReverseInPlace: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    if (isFrozenValue(array)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(array) || 0) > 0) {
      throw new EastError("Cannot modify Array during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    array.reverse();
    return null;
  },
  ArraySort: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => (array: any[], by: (a: any) => any) => {
    const cmp = compareFor(T2);
    const newArray = [...array];
    newArray.sort((a, b) => {
      const projectedA = call_function(loc_id, source_map,by, a);
      const projectedB = call_function(loc_id, source_map,by, b);
      return cmp(projectedA, projectedB);
    });
    return newArray;
  },
  ArrayReverse: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    const newArray = [...array];
    newArray.reverse();
    return newArray;
  },
  ArrayIsSorted: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], by: (a: any) => any) => {
      if (array.length < 2) return true;

      lockForIteration(array);
      try {
        let projectedPrev = call_function(loc_id, source_map,by, array[0]!);

        for (let i = 1; i < array.length; i++) {
          const projectedCurr = call_function(loc_id, source_map,by, array[i]);

          if (cmp(projectedPrev, projectedCurr) > 0) {
            return false;
          }

          projectedPrev = projectedCurr;
        }
      } finally {
        unlockForIteration(array);
      }
      return true;
    };
  },
  ArrayFindSortedFirst: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], key: any, by: (a: any) => any) => {
      let low = 0;
      let high = array.length;

      lockForIteration(array);
      try {
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const projectedMid = call_function(loc_id, source_map,by, array[mid]!);

          if (cmp(projectedMid, key) < 0) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }
      } finally {
        unlockForIteration(array);
      }

      return BigInt(low);
    };
  },
  ArrayFindSortedLast: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], key: any, by: (a: any) => any) => {
      let low = 0;
      let high = array.length;

      lockForIteration(array);
      try {
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const projectedMid = call_function(loc_id, source_map,by, array[mid]!);

          if (cmp(projectedMid, key) <= 0) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }
      } finally {
        unlockForIteration(array);
      }

      return BigInt(low);
    };
  },
  ArrayFindSortedRange: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], key: any, by: (a: any) => any) => {
      let lo = -1;
      let hi = array.length;
      
      lockForIteration(array);
      try {
        // Main search loop - find any equal element or determine the range doesn't exist
        while (lo < hi - 1) {
          const mid = Math.floor((lo + hi) / 2);
          const projectedMid = call_function(loc_id, source_map,by, array[mid]!);

          const cmpResult = cmp(projectedMid, key);
          if (cmpResult < 0) {
            lo = mid;
          } else if (cmpResult > 0) {
            hi = mid;
          } else {
            // Found an equal element! Now find the first and last positions
            // within the constrained range

            // Find first position in range [max(lo, -1), mid]
            let firstLo = Math.max(lo, -1);
            let firstHi = mid + 1;

            while (firstLo < firstHi - 1) {
              const firstMid = Math.floor((firstLo + firstHi) / 2);
              const projectedFirst = call_function(loc_id, source_map,by, array[firstMid]!);

              if (cmp(projectedFirst, key) < 0) {
                firstLo = firstMid;
              } else {
                firstHi = firstMid;
              }
            }

            // Find last position in range [mid, min(hi, array.length)]
            let lastLo = mid - 1;
            let lastHi = Math.min(hi, array.length);

            while (lastLo < lastHi - 1) {
              const lastMid = Math.floor((lastLo + lastHi) / 2);
              const projectedLast = call_function(loc_id, source_map,by, array[lastMid]!);

              if (cmp(projectedLast, key) <= 0) {
                lastLo = lastMid;
              } else {
                lastHi = lastMid;
              }
            }

            return { start: BigInt(firstLo + 1), end: BigInt(lastLo + 1) };
          }
        }
      } finally {
        unlockForIteration(array);
      }

      // No equal element found - return empty range
      return { start: BigInt(lo + 1), end: BigInt(lo + 1) };
    };
  },
  ArrayFindFirst: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue, T2: EastTypeValue) => {
    const cmp = compareFor(T2);
    return (array: any[], value: any, by: (a: any) => any) => {
      lockForIteration(array);
      try {
        for (let i = 0; i < array.length; i++) {
          const projected = call_function(loc_id, source_map,by, array[i]);
          if (cmp(projected, value) === 0) {
            return variant("some", BigInt(i));
          }
        }
        return variant("none", null);
      } finally {
        unlockForIteration(array);
      }
    };
  },
  ArrayConcat: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (a1: any[], a2: any[]) => {
    return [...a1, ...a2];
  },
  ArraySlice: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], start: bigint, end: bigint) => {
    const startNum = Number(start);
    const endNum = Number(end);
    return array.slice(startNum, endNum);
  },
  ArrayGetKeys: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], keys: bigint[], onMissing: (key: bigint) => any) => {
    return keys.map(k => {
      const i = Number(k);
      if (i < 0 || i >= array.length) {
        return call_function(loc_id, source_map,onMissing, k);
      } else {
        return array[i];
      }
    });
  },
  ArrayForEach: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      array.forEach((x, i) => {
        return call_function(loc_id, source_map,f, x, BigInt(i));
      });
      return null;
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayCopy: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[]) => {
    return [...array];
  },
  ArrayMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      return array.map((x, i) => {
        return call_function(loc_id, source_map,f, x, BigInt(i));
      });
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayFilter: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      return array.filter((x, i) => {
        return call_function(loc_id, source_map,f, x, BigInt(i));
      });
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayFilterMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      const result: any[] = [];
      for (let i = 0; i < array.length; i++) {
        const v: option<any> = call_function(loc_id, source_map,f, array[i], BigInt(i));
        if (v.type === "some") {
          result.push(v.value);
        }
      }
      return result;
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayFirstMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], f: (x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      for (let i = 0; i < array.length; i++) {
        const v: option<any> = call_function(loc_id, source_map,f, array[i], BigInt(i));
        if (v.type === "some") {
          return v;
        }
      }
      return variant("none", null);
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], init: any, f: (acc: any, x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      return array.reduce((acc, x, i) => {
        return call_function(loc_id, source_map,f, acc, x, BigInt(i));
      }, init);
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayScan: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], init: any, f: (acc: any, x: any, i: bigint) => any) => {
    lockForIteration(array);
    try {
      const result: any[] = [];
      let acc = init;
      for (let i = 0; i < array.length; i++) {
        acc = call_function(loc_id, source_map,f, acc, array[i], BigInt(i));
        result.push(acc);
      }
      return result;
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayMapReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _T2: EastTypeValue) => (array: any[], mapFn: (x: any, i: bigint) => any, reduceFn: (x: any, y:any) => any) => {
    if (array.length === 0) {
      throw new EastError("Cannot reduce empty array with no initial value", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(array);
    try {
      let acc = call_function(loc_id, source_map,mapFn, array[0], 0n);
      for (let i = 1; i < array.length; i++) {
        const mapped = call_function(loc_id, source_map,mapFn, array[i], BigInt(i));
        acc = call_function(loc_id, source_map,reduceFn, acc, mapped);
      }
      return acc;
    } finally {
      unlockForIteration(array);
    }
  },
  ArrayStringJoin: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[]) => (x: string[], y:string) => x.join(y),
  ArrayToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, T2: EastTypeValue) => {
    const compare = compareFor(T2);
    return (array: any[], f: (x: any, i: bigint) => any) => {
      lockForIteration(array);
      try {
        const result = new SortedSet([], compare);
        for (let i = 0; i < array.length; i++) {
          const v = call_function(loc_id, source_map,f, array[i], BigInt(i));
          result.add(v);
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
  ArrayToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, K2: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (array: any[], keyFn: (v: any, i: bigint) => any, valueFn: (v: any, i: bigint) => any, onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(array);
      try {
        for (let i = 0; i < array.length; i++) {
          const v = array[i];
          const k = call_function(loc_id, source_map,keyFn, v, BigInt(i));
          let val = call_function(loc_id, source_map,valueFn, v, BigInt(i));
          const existing = result.get(k);
          if (existing === undefined) {
            result.set(k, val);
          } else {
            val = call_function(loc_id, source_map,onConflict, existing, val, k);
            result.set(k, val);
          }
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
  ArrayFlattenToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (array: any[], fn: (value: any) => any[]) => {
    return array.flatMap(v => {
      return call_function(loc_id, source_map,fn, v);
    });
  },
  ArrayFlattenToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (array: any[], fn: (value: any) => any[]) => {
      const result = new SortedSet([], compare);
      lockForIteration(array);
      try {
        for (const v of array) {
          const subset = call_function(loc_id, source_map,fn, v);
          for (const k of subset) {
            result.add(k);
          }
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
  ArrayFlattenToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, K2: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (array: any[], fn: (value: any) => any[], onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(array);
      try {
        for (const v of array) {
          const subdict = call_function(loc_id, source_map,fn, v);
          for (const [k, val] of subdict.entries()) {
            const existing = result.get(k);
            if (existing === undefined) {
              result.set(k, val);
            } else {
              const new_val = call_function(loc_id, source_map,onConflict, existing, val, k);
              result.set(k, new_val);
            }
          }
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },
  ArrayGroupFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (array: any[], keyFn: (v: any, i: bigint) => any, init: (k: any) => any, folder: (acc: any, v: any, i: bigint) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(array);
      try {
        for (let i = 0; i < array.length; i++) {
          const v = array[i];
          const k = call_function(loc_id, source_map,keyFn, v, BigInt(i));
          let existing = result.get(k);
          if (existing === undefined) {
            existing = call_function(loc_id, source_map,init, k);
          }
          const new_val = call_function(loc_id, source_map,folder, existing, v, BigInt(i));
          result.set(k, new_val);
        }
        return result;
      } finally {
        unlockForIteration(array);
      }
    }
  },

  SetGenerate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const keyComparer = compareFor(K);
    return (size: bigint, keyFn: (i: bigint) => any, onConflict: (key: any) => null) => {
      const result = new SortedSet([], keyComparer);
      for (let i = 0n; i < size; i += 1n) {
        const k = call_function(loc_id, source_map,keyFn, i);
        if (result.has(k)) {
          call_function(loc_id, source_map,onConflict, k);
        } else {
          result.add(k);
        }
      }
      return result;
    }
  },
  SetSize: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>) => BigInt(s.size),
  SetHas: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>, key: any) => s.has(key),
  SetInsert: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const print = printFor(K);
    return (s: Set<any>, key: any) => {
      if (isFrozenValue(s)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(s) || 0) > 0) {
        throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const size_before = s.size;
      s.add(key);
      if (s.size === size_before) {
        throw new EastError(`Set already contains key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      return null;
    }
  },
  SetTryInsert: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>, key: any) => {
    if (isFrozenValue(s)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(s) || 0) > 0) {
      throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const size_before = s.size;
    s.add(key);
    return s.size > size_before;
  },
  SetDelete: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const print = printFor(K);
    return (s: Set<any>, key: any) => {
      if (isFrozenValue(s)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(s) || 0) > 0) {
        throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if (!s.delete(key)) {
        throw new EastError(`Set does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      return null;
    }
  },
  SetTryDelete: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>, key: any) => {
    if (isFrozenValue(s)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(s) || 0) > 0) {
      throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    return s.delete(key);
  },
  SetClear: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s: Set<any>) => {
    if (isFrozenValue(s)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(s) || 0) > 0) {
      throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    s.clear();
    return null
  },
  SetUnionInPlace: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => {
    if (isFrozenValue(s1)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(s1) || 0) > 0) {
      throw new EastError("Cannot modify Set during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    s2.forEach(v => s1.add(v));
    return null;
  },
  SetUnion: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.union(s2),
  SetIntersect: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.intersection(s2),
  SetDiff: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.difference(s2),
  SetSymDiff: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.symmetricDifference(s2),
  SetIsSubset: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.isSubsetOf(s2),
  SetIsDisjoint: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue) => (s1: Set<any>, s2: Set<any>) => s1.isDisjointFrom(s2),
  SetCopy: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const compare = compareFor(K);
    return (s: SortedSet<any>) => {
      return new SortedSet([...s], compare);
    }
  },
  SetForEach: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, f: (x: any) => any) => {
    lockForIteration(s);
    try {
      s.forEach(x => {
        call_function(loc_id, source_map,f, x);
      });
      return null;
    } finally {
      unlockForIteration(s);
    }
  },
  SetFilter: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue) => {
    const compare = compareFor(K);
    return (s: SortedSet<any>, f: (x: any) => any) => {
      const result = new SortedSet([], compare);
      lockForIteration(s);
      try {
        s.forEach(x => {
          const keep = call_function(loc_id, source_map,f, x);
          if (keep) {
            result.add(x);
          }
        });
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetFilterMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K);
    return (s: SortedSet<any>, f: (k: any) => option<any>) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        s.forEach(k => {
          const v2: option<any> = call_function(loc_id, source_map,f, k);
          if (v2.type === "some") {
            result.set(k, v2.value);
          }
        });
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetFirstMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: SortedSet<any>, f: (k: any) => any) => {
    lockForIteration(s);
    try {
      for (const k of s) {
        const v: option<any> = call_function(loc_id, source_map,f, k);
        if (v.type === "some") {
          return v;
        }
      }
      return variant("none", null);
    } finally {
      unlockForIteration(s);
    }
  },
  SetMapReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: SortedSet<any>, mapFn: (k: any) => any, reduceFn: (x: any, y: any) => any) => {
    if (s.size === 0) {
      throw new EastError("Cannot reduce empty set with no initial value", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(s);
    try {
      const iterator = s[Symbol.iterator]();
      const first = iterator.next().value;
      let acc = call_function(loc_id, source_map,mapFn, first);
      for (const k of iterator) {
        const mapped = call_function(loc_id, source_map,mapFn, k);
        acc = call_function(loc_id, source_map,reduceFn, acc, mapped);
      }
      return acc;
    } finally {
      unlockForIteration(s);
    }
  },
  SetMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K);
    return (s: SortedSet<any>, f: (x: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        s.forEach(x => {
          const v = call_function(loc_id, source_map,f, x);
          result.set(x, v);
        });
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, f: (acc: any, x: any) => any, init: any) => {
    let acc = init;
    lockForIteration(s);
    try {
      for (const x of s) {
        acc = call_function(loc_id, source_map,f, acc, x);
      }
      return acc;
    } finally {
      unlockForIteration(s);
    }
  },
  SetScan: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, f: (acc: any, x: any) => any, init: any) => {
    const result: any[] = [];
    let acc = init;
    lockForIteration(s);
    try {
      for (const x of s) {
        acc = call_function(loc_id, source_map,f, acc, x);
        result.push(acc);
      }
      return result;
    } finally {
      unlockForIteration(s);
    }
  },
  SetToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, valueFn: (key: any) => any) => {
    const ret = [];
    lockForIteration(s);
    try {
      for (const k of s) {
        const v = call_function(loc_id, source_map,valueFn, k);
        ret.push(v);
      }
      return ret;
    } finally {
      unlockForIteration(s);
    }
  },
  SetToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: SortedSet<any>, f: (x: any) => any) => {
      const result = new SortedSet([], compare);
      lockForIteration(s);
      try {
        for (const x of s) {
          const v = call_function(loc_id, source_map,f, x);
          result.add(v);
        };
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: Set<any>, keyFn: (key: any) => any, valueFn: (key: any) => any, onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        for (const k of s) {
          const k2 = call_function(loc_id, source_map,keyFn, k);
          let v2 = call_function(loc_id, source_map,valueFn, k);
          const existing = result.get(k2);
          if (existing !== undefined) {
            v2 = call_function(loc_id, source_map,onConflict, existing, v2, k2);
            result.set(k2, v2);
          } else {
            result.set(k2, v2);
          }
        }
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetFlattenToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _T2: EastTypeValue) => (s: Set<any>, fn: (value: any) => any[]) => {
    const ret = [];
    lockForIteration(s);
    try {
      for (const k of s) {
        const subarray = call_function(loc_id, source_map,fn, k);
        ret.push(...subarray);
      }
      return ret;
    } finally {
      unlockForIteration(s);
    }
  },
  SetFlattenToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: Set<any>, fn: (value: any) => any[]) => {
      const result = new SortedSet([], compare);
      lockForIteration(s);
      try {
        for (const k of s) {
          const subset = call_function(loc_id, source_map,fn, k);
          for (const k2 of subset) {
            result.add(k2);
          }
        }
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetFlattenToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: Set<any>, fn: (value: any) => any[], onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        for (const k of s) {
          const subdict = call_function(loc_id, source_map,fn, k);
          for (const [k2, v2] of subdict.entries()) {
            const existing = result.get(k2);
            if (existing === undefined) {
              result.set(k2, v2);
            } else {
              const new_v2 = call_function(loc_id, source_map,onConflict, existing, v2, k2);
              result.set(k2, new_v2);
            }
          }
        }
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },
  SetGroupFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, K2: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (s: Set<any>, keyFn: (k: any) => any, init: (k2: any) => any, folder: (acc: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(s);
      try {
        for (const k of s) {
          const k2 = call_function(loc_id, source_map,keyFn, k);
          let existing = result.get(k2);
          if (existing === undefined) {
            existing = call_function(loc_id, source_map,init, k2);
          }
          const new_val = call_function(loc_id, source_map,folder, existing, k);
          result.set(k2, new_val);
        }
        return result;
      } finally {
        unlockForIteration(s);
      }
    }
  },

  DictGenerate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const keyComparer = compareFor(K);
    return (size: bigint, keyFn: (i: bigint) => any, valueFn: (i: bigint) => any, onConflict: (v1: any, v2: any, key: any) => any) => {
      const result = new SortedMap([], keyComparer);
      for (let i = 0n; i < size; i += 1n) {
        const k = call_function(loc_id, source_map,keyFn, i);
        const v = call_function(loc_id, source_map,valueFn, i);
        const existing = result.get(k);
        if (existing !== undefined) {
          const v2 = call_function(loc_id, source_map,onConflict, existing, v, k);
          result.set(k, v2);
        } else {
          result.set(k, v);
        }
      }
      return result;
    }
  },
  DictSize: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>) => BigInt(d.size),
  DictHas: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any) => d.has(key),
  DictGet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any) => {
      const result = d.get(key);
      if (result === undefined) {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      } else {
        return result;
      }
    }
  },
  DictGetOrDefault: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any, onMissingFn: (key: any) => any) => {
    const result = d.get(key);
    if (result === undefined) {
      return call_function(loc_id, source_map,onMissingFn, key);
    } else {
      return result;
    }
  },
  DictTryGet: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any) => {
    const result = d.get(key);
    if (result === undefined) {
      return variant("none", null);
    } else {
      return variant("some", result);
    }
  },
  DictInsert: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any, value: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(d) || 0) > 0) {
        throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const existing = d.get(key);
      if (existing !== undefined) {
        throw new EastError(`Dict already contains key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      } else {
        d.set(key, value);
      }
      return null;
    }
  },
  DictGetOrInsert: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any, onMissing: (key: any) => any) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const existing = d.get(key);
    if (existing === undefined) {
      const newValue = call_function(loc_id, source_map,onMissing, key);
      d.set(key, newValue);
      return newValue;
    } else {
      return existing;
    }
  },
  DictInsertOrUpdate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any, value: any, onConflictFn: (existing: any, newValue: any, key: any) => any) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const existing = d.get(key);
    if (existing !== undefined) {
      const result = call_function(loc_id, source_map,onConflictFn, existing, value, key);
      d.set(key, result);
    } else {
      d.set(key, value);
    }
    return null;
  },
  DictUpdate: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any, value: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if (d.has(key)) {
        d.set(key, value);
        return null;
      } else {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
  },
  DictSwap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any, value: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let existing = d.get(key);
      if (existing === undefined) {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      d.set(key, value);
      return existing;
    };
  },
  DictMerge: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any, value: any, mergeFn: (existing: any, value: any, key: any) => any, initialFn: (key: any) => any) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    let existing = d.get(key);
    if (existing === undefined) {
      existing = call_function(loc_id, source_map,initialFn, key);
    }
    const new_value = call_function(loc_id, source_map,mergeFn, existing, value, key);
    d.set(key, new_value);
    return null;
  },
  DictDelete: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(d) || 0) > 0) {
        throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const existed = d.delete(key);
      if (!existed) {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      return null;
    }
  },
  DictTryDelete: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>, key: any) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    return d.delete(key);
  },
  DictPop: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const print = printFor(K);
    return (d: Map<any, any>, key: any) => {
      if (isFrozenValue(d)) {
        throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      if ((iterationLocks.get(d) || 0) > 0) {
        throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const existing = d.get(key);
      if (existing === undefined) {
        throw new EastError(`Dict does not contain key ${print(key)}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      } else {
        d.delete(key);
        return existing;
      }
    };
  },
  DictClear: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d: Map<any, any>) => {
    if (isFrozenValue(d)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    d.clear();
    return null;
  },
  DictUnionInPlace: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d1: Map<any, any>, d2: Map<any, any>, onConflict: (v1: any, v2: any, key: any) => any) => {
    if (isFrozenValue(d1)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d1) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    d2.forEach((v2, k) => {
      const v1 = d1.get(k);
      if (v1 === undefined) {
        d1.set(k, v2);
      } else {
        const new_value = call_function(loc_id, source_map,onConflict, v1, v2, k);
        d1.set(k, new_value);
      }
    });
    return null;
  },
  DictMergeAll: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue) => (d1: SortedMap<any, any>, d2: SortedMap<any, any>, mergeFn: (v1: any, v2: any, key: any) => any, initialFn: (key: any) => any) => {
    if (isFrozenValue(d1)) {
      throw new EastError(FROZEN_MESSAGE, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if ((iterationLocks.get(d1) || 0) > 0) {
      throw new EastError("Cannot modify Dict during iteration", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    d2.forEach((v2, k) => {
      let v1 = d1.get(k);
      if (v1 === undefined) {
        v1 = call_function(loc_id, source_map,initialFn, k);
      }
      const new_value = call_function(loc_id, source_map,mergeFn, v1, v2, k);
      d1.set(k, new_value);
    });
    return null;
  },
  DictKeys: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: Map<any, any>) => {
      return new SortedSet([...d.keys()], compare);
    }
  },
  DictGetKeys: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>, keys: SortedSet<any>, onMissing: (key: any) => any) => {
      const result = new SortedMap([], compare);
      for (const k of keys) {
        const v = d.get(k);
        if (v !== undefined) {
          result.set(k, v);
        } else {
          const new_v = call_function(loc_id, source_map,onMissing, k);
          result.set(k, new_v);
        }
      }
      return result;
    }
  },
  DictForEach: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2) => (d: Map<any, any>, f: (k: any, v: any) => any) => {
    lockForIteration(d);
    try {
      d.forEach((v, k) => {
        call_function(loc_id, source_map,f, v, k);
      });
      return null;
    } finally {
      unlockForIteration(d);
    }
  },
  DictCopy: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>) => {
      return new SortedMap([...d], compare);
    }
  },
  DictMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>, f: (v: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const v2 = call_function(loc_id, source_map,f, v, k);
          result.set(k, v2);
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFilter: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>, f: (v: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const keep = call_function(loc_id, source_map,f, v, k);
          if (keep) {
            result.set(k, v);
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFilterMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K);
    return (d: SortedMap<any, any>, f: (v: any, k: any) => option<any>) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const v2: option<any> = call_function(loc_id, source_map,f, v, k);
          if (v2.type === "some") {
            result.set(k, v2.value);
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFirstMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, f: (v: any, k: any) => option<any>) => {
    lockForIteration(d);
    try {
      for (const [k, v] of d) {
        const result: option<any> = call_function(loc_id, source_map,f, v, k);
        if (result.type === "some") {
          return result;
        }
      }
      return variant("none", null);
    } finally {
      unlockForIteration(d);
    }
  },
  DictMapReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, mapFn: (v: any, k: any) => any, reduceFn: (x: any, y: any) => any) => {
    if (d.size === 0) {
      throw new EastError("Cannot reduce empty dictionary with no initial value", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    lockForIteration(d);
    try {
      const iterator = d[Symbol.iterator]();
      const first = iterator.next().value!;
      let acc = call_function(loc_id, source_map,mapFn, first[1], first[0]);
      for (const [k, v] of iterator) {
        const mapped = call_function(loc_id, source_map,mapFn, v, k);
        acc = call_function(loc_id, source_map,reduceFn, acc, mapped);
      }
      return acc;
    } finally {
      unlockForIteration(d);
    }
  },
  DictReduce: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, f: (acc: any, v: any, k: any) => any, init: any) => {
    let acc = init;
    lockForIteration(d);
    try {
      for (const [k, v] of d) {
        acc = call_function(loc_id, source_map,f, acc, v, k);
      }
      return acc;
    } finally {
      unlockForIteration(d);
    }
  },
  DictScan: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, f: (acc: any, v: any, k: any) => any, init: any) => {
    const result: any[] = [];
    let acc = init;
    lockForIteration(d);
    try {
      for (const [k, v] of d) {
        acc = call_function(loc_id, source_map,f, acc, v, k);
        result.push(acc);
      }
      return result;
    } finally {
      unlockForIteration(d);
    }
  },
  DictToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, valueFn: (v: any, k: any) => any) => {
    const ret = [];
    lockForIteration(d);
    try {
      for (const [k, v] of d) {
        const v2 = call_function(loc_id, source_map,valueFn, v, k);
        ret.push(v2);
      }
      return ret;
    } finally {
      unlockForIteration(d);
    }
  },
  DictToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: SortedMap<any, any>, fn: (v: any, k: any) => any) => {
      const result = new SortedSet([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const k2 = call_function(loc_id, source_map,fn, v, k);
          result.add(k2);
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: Map<any, any>, keyFn: (v: any, k: any) => any, valueFn: (v: any, k: any) => any, onConflict: (v1: any, v2: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d) {
          const k2 = call_function(loc_id, source_map,keyFn, v, k);
          const v2 = call_function(loc_id, source_map,valueFn, v, k);
          const existing = result.get(k2);
          if (existing !== undefined) {
            const v3 = call_function(loc_id, source_map,onConflict, existing, v2, k2);
            result.set(k2, v3);
          } else {
            result.set(k2, v2);
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFlattenToArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, _T2: EastTypeValue) => (d: Map<any, any>, fn: (key: any, value: any) => any[]) => {
    const ret = [];
    lockForIteration(d);
    try {
      for (const [k, v] of d.entries()) {
        const subarray = call_function(loc_id, source_map,fn, v, k);
        for (const item of subarray) {
          ret.push(item);
        }
      }
      return ret;
    } finally {
      unlockForIteration(d);
    }
  },
  DictFlattenToSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: Map<any, any>, fn: (key: any, value: any) => any[]) => {
      const result = new SortedSet([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d.entries()) {
          const subset = call_function(loc_id, source_map,fn, v, k);
          for (const k2 of subset) {
            result.add(k2);
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictFlattenToDict: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue, _V2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: Map<any, any>, fn: (key: any, value: any) => any[], onConflict: (v1: any, v2: any, k: any) => null) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d.entries()) {
          const subdict = call_function(loc_id, source_map,fn, v, k);
          for (const [k2, v2] of subdict.entries()) {
            const existing = result.get(k2);
            if (existing === undefined) {
              result.set(k2, v2);
            } else {
              const new_v2 = call_function(loc_id, source_map,onConflict, existing, v2, k2);
              result.set(k2, new_v2);
            }
          }
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },
  DictGroupFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _K: EastTypeValue, _V: EastTypeValue, K2: EastTypeValue, _T2: EastTypeValue) => {
    const compare = compareFor(K2);
    return (d: Map<any, any>, keyFn: (v: any, k: any) => any, init: (k2: any) => any, folder: (acc: any, v: any, k: any) => any) => {
      const result = new SortedMap([], compare);
      lockForIteration(d);
      try {
        for (const [k, v] of d.entries()) {
          const k2 = call_function(loc_id, source_map,keyFn, v, k);
          let existing = result.get(k2);
          if (existing === undefined) {
            existing = call_function(loc_id, source_map,init, k2);
          }
          const new_val = call_function(loc_id, source_map,folder, existing, v, k);
          result.set(k2, new_val);
        }
        return result;
      } finally {
        unlockForIteration(d);
      }
    }
  },

  // Vector builtins
  VectorLength: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray) => BigInt(vec.length),

  VectorGet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, idx: bigint) => {
    const i = Number(idx);
    if (i < 0 || i >= vec.length) {
      throw new EastError(`Vector index ${idx} out of bounds (length ${vec.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    if (vec instanceof Uint8ClampedArray) return vec[i]! !== 0;
    return vec[i]!;
  },

  VectorSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, idx: bigint, value: any) => {
    const i = Number(idx);
    if (i < 0 || i >= vec.length) {
      throw new EastError(`Vector index ${idx} out of bounds (length ${vec.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const result = vec.slice() as typeof vec;
    if (result instanceof Uint8ClampedArray) {
      result[i] = value ? 1 : 0;
    } else {
      (result as any)[i] = value;
    }
    return result;
  },

  VectorSlice: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, start: bigint, end: bigint) => {
    const s = Number(start);
    const e = Number(end);
    if (s < 0 || e > vec.length || s > e) {
      throw new EastError(`Vector slice [${start}, ${end}) out of bounds (length ${vec.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    return vec.slice(s, e);
  },

  VectorConcat: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
    const result = allocateTypedArray(T, a.length + b.length);
    result.set(a as any);
    result.set(b as any, a.length);
    return result;
  },

  VectorFromArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (arr: any[]) => {
    return createTypedArray(T, arr);
  },

  VectorToArray: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray) => {
    if (vec instanceof Uint8ClampedArray) {
      return Array.from(vec, v => v !== 0);
    }
    if (vec instanceof BigInt64Array) {
      const result: bigint[] = [];
      for (let i = 0; i < vec.length; i++) result.push(vec[i]!);
      return result;
    }
    return Array.from(vec);
  },

  VectorToMatrix: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, rows: bigint, cols: bigint) => {
    const r = Number(rows);
    const c = Number(cols);
    if (r * c !== vec.length) {
      throw new EastError(`Cannot reshape vector of length ${vec.length} to matrix ${r}×${c}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    return matrix(vec.slice() as any, r, c);
  },

  VectorZeros: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (len: bigint) => {
    return allocateTypedArray(T, Number(len));
  },

  VectorOnes: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (len: bigint) => {
    const arr = allocateTypedArray(T, Number(len));
    arr.fill((arr instanceof BigInt64Array ? 1n : 1) as never);
    return arr;
  },

  VectorFill: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (len: bigint, value: any) => {
    const n = Number(len);
    if (T.type === "Float") {
      const arr = new Float64Array(n);
      arr.fill(value);
      return arr;
    } else if (T.type === "Integer") {
      const arr = new BigInt64Array(n);
      arr.fill(value);
      return arr;
    } else {
      const arr = new Uint8ClampedArray(n);
      arr.fill(value ? 1 : 0);
      return arr;
    }
  },

  VectorMap: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, U: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, f: (elem: any, idx: bigint) => any) => {
    const len = vec.length;
    const results: any[] = [];
    for (let i = 0; i < len; i++) {
      const elem = vec instanceof Uint8ClampedArray ? (vec[i]! !== 0) : vec[i]!;
      results.push(call_function(loc_id, source_map,f, elem, BigInt(i)));
    }
    return createTypedArray(U, results);
  },

  VectorFold: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, _U: EastTypeValue) => (vec: Float64Array | BigInt64Array | Uint8ClampedArray, init: any, f: (acc: any, elem: any, idx: bigint) => any) => {
    let acc = init;
    for (let i = 0; i < vec.length; i++) {
      const elem = vec instanceof Uint8ClampedArray ? (vec[i]! !== 0) : vec[i]!;
      acc = call_function(loc_id, source_map,f, acc, elem, BigInt(i));
    }
    return acc;
  },

  // Vector elementwise arithmetic + reductions. Reductions fold in index
  // order, left to right — part of the cross-runtime contract, since a
  // reassociated float sum gives a different last bit.
  VectorScale: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorScale", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array, alpha: any) => {
      if (elem === "Float") {
        const result = new Float64Array(v.length);
        for (let i = 0; i < v.length; i++) result[i] = (v[i] as number) * alpha;
        return result;
      }
      const result = new BigInt64Array(v.length);
      for (let i = 0; i < v.length; i++) result[i] = wrapI64((v[i] as bigint) * alpha);
      return result;
    };
  },
  VectorSum: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorSum", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array) => {
      if (elem === "Float") {
        let acc = 0;
        for (let i = 0; i < v.length; i++) acc += v[i] as number;
        return acc;
      }
      let acc = 0n;
      for (let i = 0; i < v.length; i++) acc = wrapI64(acc + (v[i] as bigint));
      return acc;
    };
  },
  VectorAddScaled: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorAddScaled", T, loc_id, source_map);
    return (a: Float64Array | BigInt64Array, b: Float64Array | BigInt64Array, alpha: any) => {
      requireSameLength(a, b, loc_id, source_map);
      if (elem === "Float") {
        const result = new Float64Array(a.length);
        for (let i = 0; i < a.length; i++) result[i] = (a[i] as number) + alpha * (b[i] as number);
        return result;
      }
      const result = new BigInt64Array(a.length);
      for (let i = 0; i < a.length; i++) result[i] = wrapI64((a[i] as bigint) + wrapI64(alpha * (b[i] as bigint)));
      return result;
    };
  },
  VectorMul: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorMul", T, loc_id, source_map);
    return (a: Float64Array | BigInt64Array, b: Float64Array | BigInt64Array) => {
      requireSameLength(a, b, loc_id, source_map);
      if (elem === "Float") {
        const result = new Float64Array(a.length);
        for (let i = 0; i < a.length; i++) result[i] = (a[i] as number) * (b[i] as number);
        return result;
      }
      const result = new BigInt64Array(a.length);
      for (let i = 0; i < a.length; i++) result[i] = wrapI64((a[i] as bigint) * (b[i] as bigint));
      return result;
    };
  },
  VectorAddScalar: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorAddScalar", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array, c: any) => {
      if (elem === "Float") {
        const result = new Float64Array(v.length);
        for (let i = 0; i < v.length; i++) result[i] = (v[i] as number) + c;
        return result;
      }
      const result = new BigInt64Array(v.length);
      for (let i = 0; i < v.length; i++) result[i] = wrapI64((v[i] as bigint) + c);
      return result;
    };
  },
  VectorDot: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorDot", T, loc_id, source_map);
    return (a: Float64Array | BigInt64Array, b: Float64Array | BigInt64Array) => {
      requireSameLength(a, b, loc_id, source_map);
      if (elem === "Float") {
        let acc = 0;
        for (let i = 0; i < a.length; i++) acc += (a[i] as number) * (b[i] as number);
        return acc;
      }
      let acc = 0n;
      for (let i = 0; i < a.length; i++) acc = wrapI64(acc + wrapI64((a[i] as bigint) * (b[i] as bigint)));
      return acc;
    };
  },
  VectorMax: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorMax", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array) => {
      if (v.length === 0) {
        throw new EastError("Cannot reduce empty Vector", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let best = v[0]!;
      for (let i = 1; i < v.length; i++) {
        if (less(best, v[i]!)) best = v[i]!;
      }
      return best;
    };
  },
  VectorMin: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorMin", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array) => {
      if (v.length === 0) {
        throw new EastError("Cannot reduce empty Vector", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let best = v[0]!;
      for (let i = 1; i < v.length; i++) {
        if (less(v[i]!, best)) best = v[i]!;
      }
      return best;
    };
  },
  VectorArgMax: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorArgMax", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array) => {
      if (v.length === 0) {
        throw new EastError("Cannot reduce empty Vector", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let bestIdx = 0;
      for (let i = 1; i < v.length; i++) {
        if (less(v[bestIdx]!, v[i]!)) bestIdx = i;
      }
      return BigInt(bestIdx);
    };
  },
  VectorArgMin: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorArgMin", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array) => {
      if (v.length === 0) {
        throw new EastError("Cannot reduce empty Vector", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      let bestIdx = 0;
      for (let i = 1; i < v.length; i++) {
        if (less(v[i]!, v[bestIdx]!)) bestIdx = i;
      }
      return BigInt(bestIdx);
    };
  },
  VectorMean: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    requireNumericElem("VectorMean", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array) => {
      let acc = 0;
      for (let i = 0; i < v.length; i++) acc += Number(v[i]!);
      return acc / v.length;
    };
  },
  VectorCumSum: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorCumSum", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array) => {
      if (elem === "Float") {
        const result = new Float64Array(v.length);
        let acc = 0;
        for (let i = 0; i < v.length; i++) {
          acc += v[i] as number;
          result[i] = acc;
        }
        return result;
      }
      const result = new BigInt64Array(v.length);
      let acc = 0n;
      for (let i = 0; i < v.length; i++) {
        acc = wrapI64(acc + (v[i] as bigint));
        result[i] = acc;
      }
      return result;
    };
  },
  VectorAbs: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorAbs", T, loc_id, source_map);
    return (v: Float64Array | BigInt64Array) => {
      if (elem === "Float") {
        const result = new Float64Array(v.length);
        for (let i = 0; i < v.length; i++) {
          const x = v[i] as number;
          result[i] = x < 0 ? -x : x;
        }
        return result;
      }
      const result = new BigInt64Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const x = v[i] as bigint;
        result[i] = wrapI64(x < 0n ? -x : x);
      }
      return result;
    };
  },
  VectorClamp: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorClamp", T, loc_id, source_map);
    const less = lessFor(T);
    return (v: Float64Array | BigInt64Array, lo: any, hi: any) => {
      const result = elem === "Float" ? new Float64Array(v.length) : new BigInt64Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const x = v[i]!;
        (result as any)[i] = less(x, lo) ? lo : less(hi, x) ? hi : x;
      }
      return result;
    };
  },

  // Vector gather/scatter and sorted search
  VectorGather: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (v: Float64Array | BigInt64Array | Uint8ClampedArray, idx: BigInt64Array) => {
    const result = allocateTypedArray(T, idx.length);
    for (let j = 0; j < idx.length; j++) {
      const i = Number(idx[j]!);
      if (i < 0 || i >= v.length) {
        throw new EastError(`Vector index ${idx[j]} out of bounds (length ${v.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      result[j] = v[i]! as never;
    }
    return result;
  },
  VectorScatterAdd: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("VectorScatterAdd", T, loc_id, source_map);
    return (dst: Float64Array | BigInt64Array, idx: BigInt64Array, src: Float64Array | BigInt64Array) => {
      requireSameLength(idx, src, loc_id, source_map);
      const result = dst.slice() as Float64Array | BigInt64Array;
      for (let j = 0; j < idx.length; j++) {
        const i = Number(idx[j]!);
        if (i < 0 || i >= dst.length) {
          throw new EastError(`Vector index ${idx[j]} out of bounds (length ${dst.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
        }
        if (elem === "Float") {
          (result as Float64Array)[i] = ((result as Float64Array)[i]!) + (src[j] as number);
        } else {
          (result as BigInt64Array)[i] = wrapI64(((result as BigInt64Array)[i]!) + (src[j] as bigint));
        }
      }
      return result;
    };
  },
  VectorSearchSorted: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const less = lessFor(T);
    const readElem = T.type === "Boolean"
      ? (v: any, i: number) => v[i] !== 0
      : (v: any, i: number) => v[i];
    return (haystack: Float64Array | BigInt64Array | Uint8ClampedArray, needles: Float64Array | BigInt64Array | Uint8ClampedArray) => {
      const result = new BigInt64Array(needles.length);
      for (let j = 0; j < needles.length; j++) {
        const needle = readElem(needles, j);
        let lo = 0;
        let hi = haystack.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (less(readElem(haystack, mid), needle)) {
            lo = mid + 1;
          } else {
            hi = mid;
          }
        }
        result[j] = BigInt(lo);
      }
      return result;
    };
  },

  // Vector masks and selection (comparisons use East's total order)
  VectorEq: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const equal = equalFor(T);
    const readElem = T.type === "Boolean"
      ? (v: any, i: number) => v[i] !== 0
      : (v: any, i: number) => v[i];
    return (a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
      requireSameLength(a, b, loc_id, source_map);
      const result = new Uint8ClampedArray(a.length);
      for (let i = 0; i < a.length; i++) result[i] = equal(readElem(a, i), readElem(b, i)) ? 1 : 0;
      return result;
    };
  },
  VectorLt: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const less = lessFor(T);
    const readElem = T.type === "Boolean"
      ? (v: any, i: number) => v[i] !== 0
      : (v: any, i: number) => v[i];
    return (a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
      requireSameLength(a, b, loc_id, source_map);
      const result = new Uint8ClampedArray(a.length);
      for (let i = 0; i < a.length; i++) result[i] = less(readElem(a, i), readElem(b, i)) ? 1 : 0;
      return result;
    };
  },
  VectorGt: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const greater = greaterFor(T);
    const readElem = T.type === "Boolean"
      ? (v: any, i: number) => v[i] !== 0
      : (v: any, i: number) => v[i];
    return (a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
      requireSameLength(a, b, loc_id, source_map);
      const result = new Uint8ClampedArray(a.length);
      for (let i = 0; i < a.length; i++) result[i] = greater(readElem(a, i), readElem(b, i)) ? 1 : 0;
      return result;
    };
  },
  VectorSelect: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (mask: Uint8ClampedArray, a: Float64Array | BigInt64Array | Uint8ClampedArray, b: Float64Array | BigInt64Array | Uint8ClampedArray) => {
    requireSameLength(mask, a, loc_id, source_map);
    requireSameLength(a, b, loc_id, source_map);
    const result = allocateTypedArray(T, mask.length);
    for (let i = 0; i < mask.length; i++) result[i] = (mask[i] !== 0 ? a[i]! : b[i]!) as never;
    return result;
  },
  VectorCompress: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (mask: Uint8ClampedArray, v: Float64Array | BigInt64Array | Uint8ClampedArray) => {
    requireSameLength(mask, v, loc_id, source_map);
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 0) count++;
    }
    const result = allocateTypedArray(T, count);
    let j = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 0) result[j++] = v[i]! as never;
    }
    return result;
  },
  VectorCountTrue: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[]) => (mask: Uint8ClampedArray) => {
    let count = 0n;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 0) count += 1n;
    }
    return count;
  },

  // Sparse accumulators: parallel (ix, v) with strictly ascending ix.
  // Entries absent from a side are structurally absent, not explicit zeros:
  // an A-only entry passes through unscaled, a B-only entry contributes
  // alpha*vB even when alpha is NaN or infinite.
  SparseAxpy: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("SparseAxpy", T, loc_id, source_map);
    return (ixA: BigInt64Array, vA: Float64Array | BigInt64Array, ixB: BigInt64Array, vB: Float64Array | BigInt64Array, alpha: any) => {
      requireSparse(ixA, vA, loc_id, source_map);
      requireSparse(ixB, vB, loc_id, source_map);
      let count = 0;
      let i = 0;
      let j = 0;
      while (i < ixA.length && j < ixB.length) {
        const a = ixA[i]!;
        const b = ixB[j]!;
        if (a < b) i++;
        else if (b < a) j++;
        else { i++; j++; }
        count++;
      }
      count += (ixA.length - i) + (ixB.length - j);
      const outIx = new BigInt64Array(count);
      const outV = elem === "Float" ? new Float64Array(count) : new BigInt64Array(count);
      i = 0;
      j = 0;
      let k = 0;
      while (i < ixA.length && j < ixB.length) {
        const a = ixA[i]!;
        const b = ixB[j]!;
        if (a < b) {
          outIx[k] = a;
          (outV as any)[k] = vA[i]!;
          i++;
        } else if (b < a) {
          outIx[k] = b;
          (outV as any)[k] = elem === "Float" ? alpha * (vB[j] as number) : wrapI64(alpha * (vB[j] as bigint));
          j++;
        } else {
          outIx[k] = a;
          (outV as any)[k] = elem === "Float"
            ? (vA[i] as number) + alpha * (vB[j] as number)
            : wrapI64((vA[i] as bigint) + wrapI64(alpha * (vB[j] as bigint)));
          i++;
          j++;
        }
        k++;
      }
      for (; i < ixA.length; i++, k++) {
        outIx[k] = ixA[i]!;
        (outV as any)[k] = vA[i]!;
      }
      for (; j < ixB.length; j++, k++) {
        outIx[k] = ixB[j]!;
        (outV as any)[k] = elem === "Float" ? alpha * (vB[j] as number) : wrapI64(alpha * (vB[j] as bigint));
      }
      return { ix: outIx, v: outV };
    };
  },
  SparseFromPairs: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("SparseFromPairs", T, loc_id, source_map);
    return (ix: BigInt64Array, v: Float64Array | BigInt64Array) => {
      if (ix.length !== v.length) {
        throw new EastError(`Sparse index and value lengths differ (${ix.length} vs ${v.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      // Stable: order by (index, original position) so equal indices
      // accumulate in input order and the float result is deterministic.
      const order = new Array<number>(ix.length);
      for (let i = 0; i < ix.length; i++) order[i] = i;
      order.sort((p, q) => {
        const a = ix[p]!;
        const b = ix[q]!;
        if (a < b) return -1;
        if (a > b) return 1;
        return p - q;
      });
      let count = 0;
      for (let i = 0; i < order.length; i++) {
        if (i === 0 || ix[order[i]!]! !== ix[order[i - 1]!]!) count++;
      }
      const outIx = new BigInt64Array(count);
      const outV = elem === "Float" ? new Float64Array(count) : new BigInt64Array(count);
      let k = -1;
      for (let i = 0; i < order.length; i++) {
        const p = order[i]!;
        if (i === 0 || ix[p]! !== outIx[k]!) {
          k++;
          outIx[k] = ix[p]!;
          (outV as any)[k] = v[p]!;
        } else {
          (outV as any)[k] = elem === "Float"
            ? ((outV as Float64Array)[k]!) + (v[p] as number)
            : wrapI64(((outV as BigInt64Array)[k]!) + (v[p] as bigint));
        }
      }
      return { ix: outIx, v: outV };
    };
  },
  SparseFilterGt: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("SparseFilterGt", T, loc_id, source_map);
    const greater = greaterFor(T);
    return (ix: BigInt64Array, v: Float64Array | BigInt64Array, threshold: any) => {
      requireSparse(ix, v, loc_id, source_map);
      let count = 0;
      for (let i = 0; i < v.length; i++) {
        if (greater(v[i]!, threshold)) count++;
      }
      const outIx = new BigInt64Array(count);
      const outV = elem === "Float" ? new Float64Array(count) : new BigInt64Array(count);
      let k = 0;
      for (let i = 0; i < v.length; i++) {
        if (greater(v[i]!, threshold)) {
          outIx[k] = ix[i]!;
          (outV as any)[k] = v[i]!;
          k++;
        }
      }
      return { ix: outIx, v: outV };
    };
  },

  // Matrix builtins
  MatrixRows: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any) => BigInt(m.rows),

  MatrixCols: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any) => BigInt(m.cols),

  MatrixGet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any, row: bigint, col: bigint) => {
    const r = Number(row);
    const c = Number(col);
    if (r < 0 || r >= m.rows || c < 0 || c >= m.cols) {
      throw new EastError(`Matrix index (${row}, ${col}) out of bounds (${m.rows}×${m.cols})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const val = m.data[r * m.cols + c];
    if (m.data instanceof Uint8ClampedArray) return val !== 0;
    return val;
  },

  MatrixSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any, row: bigint, col: bigint, value: any) => {
    const r = Number(row);
    const c = Number(col);
    if (r < 0 || r >= m.rows || c < 0 || c >= m.cols) {
      throw new EastError(`Matrix index (${row}, ${col}) out of bounds (${m.rows}×${m.cols})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const data = m.data.slice() as typeof m.data;
    if (data instanceof Uint8ClampedArray) {
      data[r * m.cols + c] = value ? 1 : 0;
    } else {
      data[r * m.cols + c] = value;
    }
    return matrix(data, m.rows, m.cols);
  },

  MatrixGetRow: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any, row: bigint) => {
    const r = Number(row);
    if (r < 0 || r >= m.rows) {
      throw new EastError(`Matrix row ${row} out of bounds (${m.rows} rows)`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const start = r * m.cols;
    return m.data.slice(start, start + m.cols);
  },

  MatrixGetCol: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (m: any, col: bigint) => {
    const c = Number(col);
    if (c < 0 || c >= m.cols) {
      throw new EastError(`Matrix column ${col} out of bounds (${m.cols} cols)`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const result = allocateTypedArray(T, m.rows);
    for (let r = 0; r < m.rows; r++) result[r] = m.data[r * m.cols + c] as never;
    return result;
  },

  MatrixToVector: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any) => {
    return m.data.slice();
  },

  MatrixFromArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (arr: any[][]) => {
    if (arr.length === 0) {
      return matrix(createTypedArray(T, []), 0, 0);
    }
    const rows = arr.length;
    const cols = arr[0]!.length;
    for (let i = 1; i < rows; i++) {
      if (arr[i]!.length !== cols) {
        throw new EastError(`Jagged array: row 0 has ${cols} columns but row ${i} has ${arr[i]!.length}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
    const flat: any[] = [];
    for (const row of arr) {
      flat.push(...row);
    }
    return matrix(createTypedArray(T, flat), rows, cols);
  },

  MatrixToArray: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any) => {
    const result: any[][] = [];
    for (let r = 0; r < m.rows; r++) {
      const row: any[] = [];
      for (let c = 0; c < m.cols; c++) {
        const val = m.data[r * m.cols + c];
        row.push(m.data instanceof Uint8ClampedArray ? val !== 0 : val);
      }
      result.push(row);
    }
    return result;
  },

  MatrixTranspose: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (m: any) => {
    const result = allocateTypedArray(T, m.rows * m.cols);
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        result[c * m.rows + r] = m.data[r * m.cols + c] as never;
      }
    }
    return matrix(result, m.cols, m.rows);
  },

  MatrixZeros: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (rows: bigint, cols: bigint) => {
    return matrix(allocateTypedArray(T, Number(rows) * Number(cols)), Number(rows), Number(cols));
  },

  MatrixOnes: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (rows: bigint, cols: bigint) => {
    const data = allocateTypedArray(T, Number(rows) * Number(cols));
    data.fill((data instanceof BigInt64Array ? 1n : 1) as never);
    return matrix(data, Number(rows), Number(cols));
  },

  MatrixFill: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (rows: bigint, cols: bigint, value: any) => {
    const r = Number(rows);
    const c = Number(cols);
    const n = r * c;
    if (T.type === "Float") {
      const data = new Float64Array(n);
      data.fill(value);
      return matrix(data, r, c);
    } else if (T.type === "Integer") {
      const data = new BigInt64Array(n);
      data.fill(value);
      return matrix(data, r, c);
    } else {
      const data = new Uint8ClampedArray(n);
      data.fill(value ? 1 : 0);
      return matrix(data, r, c);
    }
  },

  MatrixMapElements: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, U: EastTypeValue) => (m: any, f: (elem: any, row: bigint, col: bigint) => any) => {
    const results: any[] = [];
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const val = m.data[r * m.cols + c];
        const elem = m.data instanceof Uint8ClampedArray ? val !== 0 : val;
        results.push(call_function(loc_id, source_map,f, elem, BigInt(r), BigInt(c)));
      }
    }
    return matrix(createTypedArray(U, results), m.rows, m.cols);
  },

  MatrixMapRows: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, U: EastTypeValue) => (m: any, f: (row: any, idx: bigint) => any) => {
    const resultRows: any[] = [];
    for (let r = 0; r < m.rows; r++) {
      const start = r * m.cols;
      const rowVec = m.data.slice(start, start + m.cols);
      const resultRow = call_function(loc_id, source_map,f, rowVec, BigInt(r));
      resultRows.push(resultRow);
    }
    if (resultRows.length === 0) {
      return matrix(allocateTypedArray(U, 0), 0, 0);
    }
    const newCols = resultRows[0].length;
    const data = allocateTypedArray(U, m.rows * newCols);
    for (let r = 0; r < m.rows; r++) {
      data.set(resultRows[r] as any, r * newCols);
    }
    return matrix(data, m.rows, newCols);
  },

  MatrixToRows: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any): (Float64Array | BigInt64Array | Uint8ClampedArray)[] => {
    const rows: (Float64Array | BigInt64Array | Uint8ClampedArray)[] = [];
    for (let r = 0; r < m.rows; r++) {
      rows.push(m.data.slice(r * m.cols, (r + 1) * m.cols));
    }
    return rows;
  },

  MatrixFromRows: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (arr: any[]) => {
    if (arr.length === 0) {
      return matrix(allocateTypedArray(T, 0), 0, 0);
    }
    const cols = arr[0].length;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].length !== cols) {
        throw new EastError(`Jagged rows: row 0 has ${cols} columns but row ${i} has ${arr[i].length}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
    const data = allocateTypedArray(T, arr.length * cols);
    for (let r = 0; r < arr.length; r++) data.set(arr[r] as any, r * cols);
    return matrix(data, arr.length, cols);
  },

  // Matrix elementwise arithmetic + reductions. Sums accumulate in ascending
  // index order (row-major for whole-matrix walks, ascending row for column
  // sums, ascending column within each row for row sums and vec-mul) — the
  // same left-to-right contract as the Vector reductions.
  MatrixScale: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixScale", T, loc_id, source_map);
    return (m: matrix, alpha: any) => {
      const src = m.data;
      if (elem === "Float") {
        const data = new Float64Array(src.length);
        for (let i = 0; i < src.length; i++) data[i] = (src[i] as number) * alpha;
        return matrix(data, m.rows, m.cols);
      }
      const data = new BigInt64Array(src.length);
      for (let i = 0; i < src.length; i++) data[i] = wrapI64((src[i] as bigint) * alpha);
      return matrix(data, m.rows, m.cols);
    };
  },
  MatrixAddScaled: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixAddScaled", T, loc_id, source_map);
    return (a: matrix, b: matrix, alpha: any) => {
      requireSameDims(a, b, loc_id, source_map);
      const ad = a.data;
      const bd = b.data;
      if (elem === "Float") {
        const data = new Float64Array(ad.length);
        for (let i = 0; i < ad.length; i++) data[i] = (ad[i] as number) + alpha * (bd[i] as number);
        return matrix(data, a.rows, a.cols);
      }
      const data = new BigInt64Array(ad.length);
      for (let i = 0; i < ad.length; i++) data[i] = wrapI64((ad[i] as bigint) + wrapI64(alpha * (bd[i] as bigint)));
      return matrix(data, a.rows, a.cols);
    };
  },
  MatrixMulElementwise: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixMulElementwise", T, loc_id, source_map);
    return (a: matrix, b: matrix) => {
      requireSameDims(a, b, loc_id, source_map);
      const ad = a.data;
      const bd = b.data;
      if (elem === "Float") {
        const data = new Float64Array(ad.length);
        for (let i = 0; i < ad.length; i++) data[i] = (ad[i] as number) * (bd[i] as number);
        return matrix(data, a.rows, a.cols);
      }
      const data = new BigInt64Array(ad.length);
      for (let i = 0; i < ad.length; i++) data[i] = wrapI64((ad[i] as bigint) * (bd[i] as bigint));
      return matrix(data, a.rows, a.cols);
    };
  },
  MatrixRowSums: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixRowSums", T, loc_id, source_map);
    return (m: matrix) => {
      const src = m.data;
      if (elem === "Float") {
        const result = new Float64Array(m.rows);
        for (let r = 0; r < m.rows; r++) {
          let acc = 0;
          for (let c = 0; c < m.cols; c++) acc += src[r * m.cols + c] as number;
          result[r] = acc;
        }
        return result;
      }
      const result = new BigInt64Array(m.rows);
      for (let r = 0; r < m.rows; r++) {
        let acc = 0n;
        for (let c = 0; c < m.cols; c++) acc = wrapI64(acc + (src[r * m.cols + c] as bigint));
        result[r] = acc;
      }
      return result;
    };
  },
  MatrixColSums: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixColSums", T, loc_id, source_map);
    return (m: matrix) => {
      const src = m.data;
      if (elem === "Float") {
        const result = new Float64Array(m.cols);
        for (let c = 0; c < m.cols; c++) {
          let acc = 0;
          for (let r = 0; r < m.rows; r++) acc += src[r * m.cols + c] as number;
          result[c] = acc;
        }
        return result;
      }
      const result = new BigInt64Array(m.cols);
      for (let c = 0; c < m.cols; c++) {
        let acc = 0n;
        for (let r = 0; r < m.rows; r++) acc = wrapI64(acc + (src[r * m.cols + c] as bigint));
        result[c] = acc;
      }
      return result;
    };
  },
  MatrixVecMul: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixVecMul", T, loc_id, source_map);
    return (m: matrix, v: Float64Array | BigInt64Array) => {
      if (v.length !== m.cols) {
        throw new EastError(`MatrixVecMul dimension mismatch (${m.rows}x${m.cols} vs length ${v.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const src = m.data;
      if (elem === "Float") {
        const result = new Float64Array(m.rows);
        for (let r = 0; r < m.rows; r++) {
          let acc = 0;
          for (let c = 0; c < m.cols; c++) acc += (src[r * m.cols + c] as number) * (v[c] as number);
          result[r] = acc;
        }
        return result;
      }
      const result = new BigInt64Array(m.rows);
      for (let r = 0; r < m.rows; r++) {
        let acc = 0n;
        for (let c = 0; c < m.cols; c++) acc = wrapI64(acc + wrapI64((src[r * m.cols + c] as bigint) * (v[c] as bigint)));
        result[r] = acc;
      }
      return result;
    };
  },
}

/** @internal */
export function applyTypeParameters(t: EastTypeValue | string, params: Map<string, EastTypeValue>): EastTypeValue {
  if (typeof(t) === "string") {
    let ret = params.get(t);
    if (ret === undefined) {
      throw new Error(`Unable to find type parameter ${JSON.stringify(t)}`);
    }
    return ret;
  } else if (t.type === "Null" || t.type === "Boolean" || t.type === "Integer" || t.type === "Float" || t.type === "String" || t.type === "DateTime" || t.type ==="Blob" || t.type === "Never") {
    return t;
  } else if (t.type === "Ref") {
    return variant("Ref", applyTypeParameters(t.value, params));
  } else if (t.type === "Array") {
    return variant("Array", applyTypeParameters(t.value, params));
  } else if (t.type === "Set") {
    return variant("Set", applyTypeParameters(t.value, params));
  } else if (t.type === "Dict") {
    return variant("Dict", { key: applyTypeParameters(t.value.key, params), value: applyTypeParameters(t.value.value, params) });
  } else if (t.type === "Struct") {
    return variant("Struct", t.value.map(({ name, type }) => ({ name, type: applyTypeParameters(type, params) })));
  } else if (t.type === "Variant") {
    return variant("Variant", t.value.map(({ name, type }) => ({ name, type: applyTypeParameters(type, params) })));
  } else if (t.type === "Recursive") {
    return t;
  } else if (t.type === "Function") {
    return variant("Function", { inputs: t.value.inputs.map(i => applyTypeParameters(i, params)), output: applyTypeParameters(t.value.output, params) } );
  } else if (t.type === "AsyncFunction") {
    return variant("AsyncFunction", { inputs: t.value.inputs.map(i => applyTypeParameters(i, params)), output: applyTypeParameters(t.value.output, params) } );
  } else if (t.type === "Vector") {
    return variant("Vector", applyTypeParameters(t.value, params));
  } else if (t.type === "Matrix") {
    return variant("Matrix", applyTypeParameters(t.value, params));
  } else {
    throw new Error(`Unhandled type ${((t satisfies never) as EastTypeValue).type}`)
  }
}
