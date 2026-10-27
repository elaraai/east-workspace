/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { AnalyzedIR } from "../analyze.js";
import { compile_ir } from "./ir.js";
import { asStatement, ControlSignal, escapesOf, loopReads, NO_ESCAPES } from "./flow.js";
import { lazyReadErrorAt, lockForIteration, type RuntimeContext, unlockForIteration } from "./runtime.js";
import { variant } from "../containers/variant.js";
import { EastError } from "../error.js";
import type { BreakIR, ContinueIR, ErrorIR, ForArrayIR, ForDictIR, ForSetIR, IfElseIR, IR, MatchIR, ReturnIR, TryCatchIR, WhileIR } from "../ir.js";
import type { Location, SourceMap } from "../location.js";
import type { PlatformFunction } from "../platform.js";
import { loopWalk } from "../serialization/beast2/v5/lazy.js";
import { type ArrayTypeValue, type DictTypeValue, type EastTypeValue, expandTypeValue, type SetTypeValue } from "../type_of_type.js";

/**
 * Compiles the errors, try/catch, branches, loops, and early exits.
 *
 * Each runs its children as statements, and gives back a `return`, `continue`
 * or `break` one of them gives — a loop acting on those that name it — so
 * control flow is never thrown here (`flow.ts`).
 */
export function compile_control(ir: AnalyzedIR<ErrorIR | TryCatchIR | IfElseIR | MatchIR | WhileIR | ForArrayIR | ForSetIR | ForDictIR | ReturnIR | ContinueIR | BreakIR>, ctx: Record<string, EastTypeValue>, platform: Record<string, (...args: any[]) => any>, asyncPlatformFns: Set<string>, platformDef: PlatformFunction[], compilingNodes: Set<IR>, source_map: SourceMap | null): (ctx: RuntimeContext) => any {
  // A child run as a statement: a signal a node under it threw is given back.
  const statement = (child: AnalyzedIR, child_ctx: Record<string, EastTypeValue>, fresh_ctx: boolean) =>
    asStatement(child, compile_ir(child, child_ctx, platform, asyncPlatformFns, platformDef, fresh_ctx, compilingNodes));

  if (ir.type === "Error") {
    const message_compiled = statement(ir.value.message, ctx, false);
    const err_location = source_map?.resolve(ir.value.loc_id) as Location[] ?? [];
    if (escapesOf(ir.value.message) !== NO_ESCAPES) {
      // A message a control statement leaves raises nothing: the signal leaves the error too.
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          const message = await message_compiled(ctx);
          if (message instanceof ControlSignal) return message;
          throw new EastError(message, { location: err_location });
        };
      } else {
        return (ctx: RuntimeContext) => {
          const message = message_compiled(ctx);
          if (message instanceof ControlSignal) return message;
          throw new EastError(message, { location: err_location });
        };
      }
    } else if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => { throw new EastError(await message_compiled(ctx), { location: err_location }); };
    } else {
      return (ctx: RuntimeContext) => { throw new EastError(message_compiled(ctx), { location: err_location }); };
    }
  } else if (ir.type === "TryCatch") {
    const try_body = statement(ir.value.try_body, Object.create(ctx), true);

    const new_ctx = Object.create(ctx);
    const message_name = ir.value.message.value.name;
    const stack_name = ir.value.stack.value.name;
    new_ctx[message_name] = ir.value.message.value.type;
    new_ctx[stack_name] = ir.value.stack.value.type;
    const catch_body = statement(ir.value.catch_body, new_ctx, true);

    // Don't include finally unless necessary (Value nodes are effect free)
    const finally_body = ir.value.finally_body.type === "Value" ? undefined : statement(ir.value.finally_body, Object.create(ctx), true);
    // A signal the finally gives leaves in place of what the try or the catch
    // gave, or threw, as a control statement thrown from the finally did.
    const finally_leaves = finally_body !== undefined && escapesOf(ir.value.finally_body) !== NO_ESCAPES;

    // The try and the catch give back a signal as their value, so East's catch
    // never sees one: it catches East's errors alone.
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
            const left = await finally_body(Object.create(ctx));
            if (finally_leaves && left instanceof ControlSignal) return left;
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
            const left = finally_body(Object.create(ctx));
            if (finally_leaves && left instanceof ControlSignal) return left;
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
    let predicateLeaves = false;
    for (const { predicate, body } of ir.value.ifs) {
      if (predicate.value.isAsync) {
        asyncPredicate = true;
      }
      if (escapesOf(predicate) !== NO_ESCAPES) {
        predicateLeaves = true;
      }
      ifs.push({
        predicate: statement(predicate, ctx, false),
        body: statement(body, Object.create(ctx), true),
      });
    }
    const else_body = statement(ir.value.else_body, Object.create(ctx), true);

    if (predicateLeaves) {
      // A predicate a control statement leaves gives its signal in place of a branch's value.
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          for (const { predicate, body } of ifs) {
            const p: unknown = await predicate(ctx);
            if (p instanceof ControlSignal) return p;
            if (p) {
              return await body(Object.create(ctx));
            }
          }
          return await else_body(Object.create(ctx));
        };
      } else {
        return (ctx: RuntimeContext) => {
          for (const { predicate, body } of ifs) {
            const p: unknown = predicate(ctx);
            if (p instanceof ControlSignal) return p;
            if (p) {
              return body(Object.create(ctx));
            }
          }
          return else_body(Object.create(ctx));
        };
      }
    } else if (ir.value.isAsync) {
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
    const compiled_variant = statement(ir.value.variant, ctx, false);
    const compiled_cases: Record<string, (ctx: RuntimeContext) => any> = {};
    const data_names: Record<string, string> = {};

    for (const { case: k, variable, body } of ir.value.cases) {
      const ctx2 = Object.create(ctx);
      const data_name = variable.value.name;
      data_names[k] = data_name;
      ctx2[data_name] = variable.value.type;
      compiled_cases[k] = statement(body, ctx2, true);
    }

    if (escapesOf(ir.value.variant) !== NO_ESCAPES) {
      // A variant a control statement leaves gives its signal in place of a case's value.
      if (ir.value.isAsync) {
        return async (ctx: RuntimeContext) => {
          const v: variant | ControlSignal = await compiled_variant(ctx);
          if (v instanceof ControlSignal) return v;
          const ctx2: RuntimeContext = Object.create(ctx);
          ctx2[data_names[v.type]!] = variant("value", v.value);
          return await compiled_cases[v.type]!(ctx2);
        };
      } else {
        return (ctx: RuntimeContext) => {
          const v: variant | ControlSignal = compiled_variant(ctx);
          if (v instanceof ControlSignal) return v;
          const ctx2: RuntimeContext = Object.create(ctx);
          ctx2[data_names[v.type]!] = variant("value", v.value);
          return compiled_cases[v.type]!(ctx2);
        };
      }
    } else if (ir.value.isAsync) {
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
    const compiled_predicate = statement(ir.value.predicate, ctx, false);
    const ctx2 = Object.create(ctx);
    const compiled_body = statement(ir.value.body, ctx2, true);
    const label = ir.value.label.name;
    // Whether the predicate can give a signal, which leaves the loop; and
    // whether the body can give one but its own `continue`, which the loop
    // must act on: its own `break` stops it, and any other leaves it.
    const predicate_leaves = escapesOf(ir.value.predicate) !== NO_ESCAPES;
    const reads = loopReads(ir.value.body, label);

    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        for (;;) {
          const p: unknown = await compiled_predicate(ctx);
          if (predicate_leaves && p instanceof ControlSignal) return p;
          if (!p) return null;
          const ctx2 = Object.create(ctx);
          const r: unknown = await compiled_body(ctx2);
          if (reads && r instanceof ControlSignal) {
            if (r.kind === "return" || r.label !== label) return r;
            if (r.kind === "break") return null;
          }
        }
      };
    } else {
      return (ctx: RuntimeContext) => {
        for (;;) {
          const p: unknown = compiled_predicate(ctx);
          if (predicate_leaves && p instanceof ControlSignal) return p;
          if (!p) return null;
          const ctx2 = Object.create(ctx);
          const r: unknown = compiled_body(ctx2);
          if (reads && r instanceof ControlSignal) {
            if (r.kind === "return" || r.label !== label) return r;
            if (r.kind === "break") return null;
          }
        }
      };
    }
  } else if (ir.type === "ForArray") {
    const value_type = (expandTypeValue(ir.value.array.value.type) as ArrayTypeValue).value;
    const compiled_array = statement(ir.value.array, ctx, false);
    const ctx2 = Object.create(ctx);
    const key_name = ir.value.key.value.name;
    const value_name = ir.value.value.value.name;
    ctx2[key_name] = variant("Integer", null);
    ctx2[value_name] = value_type;
    const compiled_body = statement(ir.value.body, ctx2, true);
    const label = ir.value.label.name;
    const loc_id = ir.value.loc_id;
    // As a While's: whether the array can give a signal, and whether the loop must act on what its body gives.
    const array_leaves = escapesOf(ir.value.array) !== NO_ESCAPES;
    const reads = loopReads(ir.value.body, label);

    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const array = await compiled_array(ctx);
        if (array_leaves && array instanceof ControlSignal) return array;
        lockForIteration(array);
        try {
          for (const [key, value] of array.entries()) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", BigInt(key));
            ctx2[value_name] = variant("value", value);
            const r: unknown = await compiled_body(ctx2);
            if (reads && r instanceof ControlSignal) {
              if (r.kind === "return" || r.label !== label) return r;
              if (r.kind === "break") break;
            }
          }
          return null;
        } catch (e: unknown) {
          throw lazyReadErrorAt(e, loc_id, source_map);
        } finally {
          unlockForIteration(array);
        }
      };
    } else {
        return (ctx: RuntimeContext) => {
        const array = compiled_array(ctx);
        if (array_leaves && array instanceof ControlSignal) return array;
        lockForIteration(array);
        try {
          for (const [key, value] of array.entries()) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", BigInt(key));
            ctx2[value_name] = variant("value", value);
            const r: unknown = compiled_body(ctx2);
            if (reads && r instanceof ControlSignal) {
              if (r.kind === "return" || r.label !== label) return r;
              if (r.kind === "break") break;
            }
          }
          return null;
        } catch (e: unknown) {
          throw lazyReadErrorAt(e, loc_id, source_map);
        } finally {
          unlockForIteration(array);
        }
      };
    }
  } else if (ir.type === "ForSet") {
    const key_type = (expandTypeValue(ir.value.set.value.type) as SetTypeValue).value;
    const compiled_set = statement(ir.value.set, ctx, false);
    const ctx2 = Object.create(ctx);
    const key_name = ir.value.key.value.name;
    ctx2[key_name] = key_type;
    const compiled_body = statement(ir.value.body, ctx2, true);
    const label = ir.value.label.name;
    const loc_id = ir.value.loc_id;
    // As a While's: whether the set can give a signal, and whether the loop must act on what its body gives.
    const set_leaves = escapesOf(ir.value.set) !== NO_ESCAPES;
    const reads = loopReads(ir.value.body, label);

    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const set = await compiled_set(ctx);
        if (set_leaves && set instanceof ControlSignal) return set;
        lockForIteration(set);
        try {
          for (const key of loopWalk(set)) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", key);
            const r: unknown = await compiled_body(ctx2);
            if (reads && r instanceof ControlSignal) {
              if (r.kind === "return" || r.label !== label) return r;
              if (r.kind === "break") break;
            }
          }
          return null;
        } catch (e: unknown) {
          throw lazyReadErrorAt(e, loc_id, source_map);
        } finally {
          unlockForIteration(set);
        }
      };
    } else {
        return (ctx: RuntimeContext) => {
        const set = compiled_set(ctx);
        if (set_leaves && set instanceof ControlSignal) return set;
        lockForIteration(set);
        try {
          for (const key of loopWalk(set)) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", key);
            const r: unknown = compiled_body(ctx2);
            if (reads && r instanceof ControlSignal) {
              if (r.kind === "return" || r.label !== label) return r;
              if (r.kind === "break") break;
            }
          }
          return null;
        } catch (e: unknown) {
          throw lazyReadErrorAt(e, loc_id, source_map);
        } finally {
          unlockForIteration(set);
        }
      };
    }
  } else if (ir.type === "ForDict") {
    const key_type = (expandTypeValue(ir.value.dict.value.type) as DictTypeValue).value.key;
    const value_type = (expandTypeValue(ir.value.dict.value.type) as DictTypeValue).value.value;
    const compiled_dict = statement(ir.value.dict, ctx, false);
    const ctx2 = Object.create(ctx);
    const key_name = ir.value.key.value.name;
    const value_name = ir.value.value.value.name;
    ctx2[key_name] = key_type;
    ctx2[value_name] = value_type;
    const compiled_body = statement(ir.value.body, ctx2, true);
    const label = ir.value.label.name;
    const loc_id = ir.value.loc_id;
    // As a While's: whether the dict can give a signal, and whether the loop must act on what its body gives.
    const dict_leaves = escapesOf(ir.value.dict) !== NO_ESCAPES;
    const reads = loopReads(ir.value.body, label);

    if (ir.value.isAsync) {
      return async (ctx: RuntimeContext) => {
        const dict = await compiled_dict(ctx);
        if (dict_leaves && dict instanceof ControlSignal) return dict;
        lockForIteration(dict);
        try {
          for (const [key, value] of loopWalk<[unknown, unknown]>(dict)) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", key);
            ctx2[value_name] = variant("value", value);
            const r: unknown = await compiled_body(ctx2);
            if (reads && r instanceof ControlSignal) {
              if (r.kind === "return" || r.label !== label) return r;
              if (r.kind === "break") break;
            }
          }
          return null;
        } catch (e: unknown) {
          throw lazyReadErrorAt(e, loc_id, source_map);
        } finally {
          unlockForIteration(dict);
        }
      };
    } else {
        return (ctx: RuntimeContext) => {
        const dict = compiled_dict(ctx);
        if (dict_leaves && dict instanceof ControlSignal) return dict;
        lockForIteration(dict);
        try {
          for (const [key, value] of loopWalk<[unknown, unknown]>(dict)) {
            const ctx2: RuntimeContext = Object.create(ctx);
            ctx2[key_name] = variant("value", key);
            ctx2[value_name] = variant("value", value);
            const r: unknown = compiled_body(ctx2);
            if (reads && r instanceof ControlSignal) {
              if (r.kind === "return" || r.label !== label) return r;
              if (r.kind === "break") break;
            }
          }
          return null;
        } catch (e: unknown) {
          throw lazyReadErrorAt(e, loc_id, source_map);
        } finally {
          unlockForIteration(dict);
        }
      };
    }
  } else if (ir.type === "Return") {
    const compiled_value = statement(ir.value.value, ctx, false);
    // A value a control statement leaves gives its signal in place of the return's.
    const value_leaves = escapesOf(ir.value.value) !== NO_ESCAPES;
    if (ir.value.isAsync) {
      if (value_leaves) {
        return async (ctx: RuntimeContext) => {
          const value: unknown = await compiled_value(ctx);
          return value instanceof ControlSignal ? value : new ControlSignal("return", "", value);
        };
      } else {
        return async (ctx: RuntimeContext) => new ControlSignal("return", "", await compiled_value(ctx));
      }
    } else {
      if (value_leaves) {
        return (ctx: RuntimeContext) => {
          const value: unknown = compiled_value(ctx);
          return value instanceof ControlSignal ? value : new ControlSignal("return", "", value);
        };
      } else {
        return (ctx: RuntimeContext) => new ControlSignal("return", "", compiled_value(ctx));
      }
    }
  } else if (ir.type === "Continue") {
    const signal = new ControlSignal("continue", ir.value.label.name, null);
    return (_ctx: RuntimeContext) => signal;
  } else if (ir.type === "Break") {
    const signal = new ControlSignal("break", ir.value.label.name, null);
    return (_ctx: RuntimeContext) => signal;
  } else {
    throw new Error(`Unhandled IR type ${(ir satisfies never as IR).type} at loc_id ${(ir as IR).value.loc_id}`); // The `satisfies never` here ensures that this branch is unreachable if all IR types are handled
  }
}
