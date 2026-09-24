/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { AnalyzedIR } from "../analyze.js";
import { compile_internal } from "./ir.js";
import { BreakException, ContinueException, lockForIteration, ReturnException, type RuntimeContext, unlockForIteration } from "./runtime.js";
import { variant } from "../containers/variant.js";
import { EastError } from "../error.js";
import type { BreakIR, ContinueIR, ErrorIR, ForArrayIR, ForDictIR, ForSetIR, IfElseIR, IR, MatchIR, ReturnIR, TryCatchIR, WhileIR } from "../ir.js";
import type { Location, SourceMap } from "../location.js";
import type { PlatformFunction } from "../platform.js";
import { type ArrayTypeValue, type DictTypeValue, type EastTypeValue, expandTypeValue, type SetTypeValue } from "../type_of_type.js";

/** Compiles the errors, try/catch, branches, loops, and early exits. */
export function compile_control(ir: AnalyzedIR<ErrorIR | TryCatchIR | IfElseIR | MatchIR | WhileIR | ForArrayIR | ForSetIR | ForDictIR | ReturnIR | ContinueIR | BreakIR>, ctx: Record<string, EastTypeValue>, platform: Record<string, (...args: any[]) => any>, asyncPlatformFns: Set<string>, platformDef: PlatformFunction[], compilingNodes: Set<IR>, source_map: SourceMap | null): (ctx: RuntimeContext) => any {
  if (ir.type === "Error") {
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
  } else {
    throw new Error(`Unhandled IR type ${(ir satisfies never as IR).type} at loc_id ${(ir as IR).value.loc_id}`); // The `satisfies never` here ensures that this branch is unreachable if all IR types are handled
  }
}
