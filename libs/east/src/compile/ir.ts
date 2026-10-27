/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { AnalyzedIR } from "../analyze.js";
import { compile_constructors } from "./constructors.js";
import { compile_control } from "./control.js";
import { asStatement, asValue, ControlSignal, escapesOf, NO_ESCAPES, withControlFlow } from "./flow.js";
import { compile_functions } from "./functions.js";
import { getContextValue, requiresBoxing, type RuntimeContext } from "./runtime.js";
import { variant } from "../containers/variant.js";
import type { IR } from "../ir.js";
import { get_current_source_map, type SourceMap } from "../location.js";
import type { PlatformFunction } from "../platform.js";
import type { EastTypeValue } from "../type_of_type.js";

// Captured once per top-level compile; all closures share the same SourceMap.
let _compile_source_map: SourceMap | null = null;

/** Compile `IR` into a JavaScript function using a closure-compiler technique.
* This should execute faster than a simple tree-walking interpreter, but slower than hand-written Javascript.
*
* A "context" of the current variables in scope is given. For toplevel function IR, provide `{}`.
* A "platform" is provided with JavaScript functions to perform effects, like logging. If no effects are needed, simply provide `{}`.
*
* A `return`, `continue` or `break` gives a signal in place of a value, which
* the statements around it give back to the function or loop it is for
* (`flow.ts`): a function compiled from the IR gives its value, never a signal.
* What can leave each node is worked out once, as the compile starts.
*
* @internal
*/
export function compile_internal(ir: AnalyzedIR, ctx: Record<string, EastTypeValue>, platform: Record<string, (...args: any[]) => any>, asyncPlatformFns: Set<string>, platformDef: PlatformFunction[], fresh_ctx: boolean = true, compilingNodes: Set<IR> = new Set()): (ctx: RuntimeContext) => any {
  return withControlFlow(ir, () => compile_ir(ir, ctx, platform, asyncPlatformFns, platformDef, fresh_ctx, compilingNodes));
}

/** Compiles one node of the IR a {@link compile_internal} call was given — its
* root, or a node under it — within that call's compile, which knows what
* control flow can leave each node.
*
* @internal
*/
export function compile_ir(ir: AnalyzedIR, ctx: Record<string, EastTypeValue>, platform: Record<string, (...args: any[]) => any>, asyncPlatformFns: Set<string>, platformDef: PlatformFunction[], fresh_ctx: boolean = true, compilingNodes: Set<IR> = new Set()): (ctx: RuntimeContext) => any {
  // Capture source map from the active scope on first call
  if (fresh_ctx) _compile_source_map = get_current_source_map();
  const source_map = _compile_source_map;

  // The IR is checked prior to compilation, so we can assume it's valid here.
  // The compiler needs to take care that Promises are properly awaited, so most IR nodes need both sync and async implementations.
  // We assume unnecessary `async` functions degrade performance but unnecessary `await`s are not too bad, so while we could be more "specific" in our awaits we do not bother

  if (ir.type === "Value") {
    const v = ir.value.value.value;
    return (_ctx: RuntimeContext) => v;
  } else if (ir.type === "Variable") {
    const name = ir.value.name;
    // All context values are variants - read via .value
    return (ctx: RuntimeContext) => getContextValue(ctx, name).value;
  } else if (ir.type === "Let") {
    const compiled_statement = asStatement(ir.value.value, compile_ir(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes));
    const name = ir.value.variable.value.name;
    ctx[name] = ir.value.variable.value.type;
    const boxed = requiresBoxing(ir.value.variable.value);
    if (escapesOf(ir.value.value) !== NO_ESCAPES) {
      // A value a control statement leaves binds nothing: its signal is the statement's.
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          const value: unknown = await compiled_statement(ctx);
          if (value instanceof ControlSignal) return value;
          ctx[name] = boxed ? variant("boxed", value) : variant("value", value);
          return null;
        };
      } else {
        return (ctx: RuntimeContext) => {
          const value: unknown = compiled_statement(ctx);
          if (value instanceof ControlSignal) return value;
          ctx[name] = boxed ? variant("boxed", value) : variant("value", value);
          return null;
        };
      }
    } else if (ir.value.isAsync) {
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
    const compiled_statement = asStatement(ir.value.value, compile_ir(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes));
    const boxed = requiresBoxing(ir.value.variable.value);
    if (escapesOf(ir.value.value) !== NO_ESCAPES) {
      // A value a control statement leaves assigns nothing: its signal is the statement's.
      const assign = (ctx: RuntimeContext, value: unknown): null => {
        if (boxed) {
          getContextValue(ctx, name).value = value;
        } else {
          while (!Object.hasOwn(ctx, name)) ctx = Object.getPrototypeOf(ctx);
          ctx[name] = variant("value", value);
        }
        return null;
      };
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          const value: unknown = await compiled_statement(ctx);
          return value instanceof ControlSignal ? value : assign(ctx, value);
        };
      } else {
        return (ctx: RuntimeContext) => {
          const value: unknown = compiled_statement(ctx);
          return value instanceof ControlSignal ? value : assign(ctx, value);
        };
      }
    } else if (boxed) {
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
    return compile_ir(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, fresh_ctx, compilingNodes);
  } else if (ir.type === "UnwrapRecursive") {
    // in dynamically typed runtimes like Javascript, this is a no-op
    // (for statically typed runtimes this assists in e.g. typing a reference or pointer)
    return compile_ir(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, fresh_ctx, compilingNodes);
  } else if (ir.type === "WrapRecursive") {
    // in dynamically typed runtimes like Javascript, this is a no-op
    // (for statically typed runtimes this assists in e.g. typing a heap allocation)
    return compile_ir(ir.value.value, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes);
  } else if (ir.type === "Block") {
    // A statement before the last that a control statement leaves ends the
    // block: its signal is the block's, as the last statement's is anyway.
    let leaves = false;
    for (let i = 0; i < ir.value.statements.length - 1; i++) {
      if (escapesOf(ir.value.statements[i]) !== NO_ESCAPES) leaves = true;
    }
    // The pattern of creating a new context (e.g. a function) and then immediately invoking a block (e.g. as the function body) is very common.
    // Here we avoid creating a second context when possible, as an optimization.
    if (fresh_ctx) {
      const compiled_statements: ((ctx: RuntimeContext) => any)[] = [];
      for (const statement of ir.value.statements) {
        const compiled_statement = asStatement(statement, compile_ir(statement, ctx, platform, asyncPlatformFns, platformDef, true, compilingNodes));
        compiled_statements.push(compiled_statement);
      }
      if (ir.value.isAsync) {
        if (leaves) {
          return async (ctx: RuntimeContext) => {
            let ret = null;
            for (const statement of compiled_statements) {
              ret = await statement(ctx);
              if (ret instanceof ControlSignal) return ret;
            }
            return ret;
          };
        } else {
          return async (ctx: RuntimeContext) => {
            let ret = null;
            for (const statement of compiled_statements) {
              ret = await statement(ctx);
            }
            return ret;
          };
        }
      } else {
        if (leaves) {
          return (ctx: RuntimeContext) => {
            let ret = null;
            for (const statement of compiled_statements) {
              ret = statement(ctx);
              if (ret instanceof ControlSignal) return ret;
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
      }
    } else {
      const ctx2 = Object.create(ctx);
      const compiled_statements: ((ctx: RuntimeContext) => any)[] = [];
      for (const statement of ir.value.statements) {
        const compiled_statement = asStatement(statement, compile_ir(statement, ctx2, platform, asyncPlatformFns, platformDef, true, compilingNodes));
        compiled_statements.push(compiled_statement);
      }
      if (ir.value.isAsync) {
        if (leaves) {
          return async (ctx: RuntimeContext) => {
            const ctx2 = Object.create(ctx);
            let ret = null;
            for (const statement of compiled_statements) {
              ret = await statement(ctx2);
              if (ret instanceof ControlSignal) return ret;
            }
            return ret;
          };
        } else {
          return async (ctx: RuntimeContext) => {
            const ctx2 = Object.create(ctx);
            let ret = null;
            for (const statement of compiled_statements) {
              ret = await statement(ctx2);
            }
            return ret;
          };
        }
      } else {
        if (leaves) {
          return (ctx: RuntimeContext) => {
            const ctx2 = Object.create(ctx);
            let ret = null;
            for (const statement of compiled_statements) {
              ret = statement(ctx2);
              if (ret instanceof ControlSignal) return ret;
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
    }
  } else if (ir.type === "GetField") {
    const struct = asValue(ir.value.struct, compile_ir(ir.value.struct, ctx, platform, asyncPlatformFns, platformDef, false, compilingNodes));
    const field = ir.value.field;
    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => (await struct(ctx))[field];
    } else {
      return (ctx: RuntimeContext) => struct(ctx)[field];
    }
  } else if (ir.type === "Error" || ir.type === "TryCatch" || ir.type === "IfElse" || ir.type === "Match" || ir.type === "While" || ir.type === "ForArray" || ir.type === "ForSet" || ir.type === "ForDict" || ir.type === "Return" || ir.type === "Continue" || ir.type === "Break") {
    return compile_control(ir, ctx, platform, asyncPlatformFns, platformDef, compilingNodes, source_map);
  } else if (ir.type === "Function" || ir.type === "AsyncFunction" || ir.type === "Call" || ir.type === "CallAsync" || ir.type === "Builtin" || ir.type === "Platform") {
    return compile_functions(ir, ctx, platform, asyncPlatformFns, platformDef, compilingNodes, source_map);
  } else if (ir.type === "Struct" || ir.type === "Variant" || ir.type === "NewRef" || ir.type === "NewArray" || ir.type === "NewSet" || ir.type === "NewDict" || ir.type === "NewVector" || ir.type === "NewMatrix") {
    return compile_constructors(ir, ctx, platform, asyncPlatformFns, platformDef, compilingNodes, source_map);
  } else {
    throw new Error(`Unhandled IR type ${(ir satisfies never as IR).type} at loc_id ${(ir as IR).value.loc_id}`); // The `satisfies never` here ensures that this branch is unreachable if all IR types are handled
  }
}
