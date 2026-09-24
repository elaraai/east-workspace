/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { AnalyzedIR } from "../analyze.js";
import { builtin_evaluators } from "./builtins/index.js";
import { compile_internal } from "./ir.js";
import { BreakException, ContinueException, EAST_CAPTURES_SYMBOL, EAST_IR_SYMBOL, EAST_SOURCE_MAP_SYMBOL, getContextValue, ReturnException, type RuntimeContext } from "./runtime.js";
import { variant } from "../containers/variant.js";
import { EastError } from "../error.js";
import type { AsyncFunctionIR, BuiltinIR, CallAsyncIR, CallIR, FunctionIR, IR, PlatformIR } from "../ir.js";
import type { Location, SourceMap } from "../location.js";
import type { PlatformFunction } from "../platform.js";
import type { EastTypeValue } from "../type_of_type.js";

/** Compiles the function definitions, calls, and builtin and platform calls. */
export function compile_functions(ir: AnalyzedIR<FunctionIR | AsyncFunctionIR | CallIR | CallAsyncIR | BuiltinIR | PlatformIR>, ctx: Record<string, EastTypeValue>, platform: Record<string, (...args: any[]) => any>, asyncPlatformFns: Set<string>, platformDef: PlatformFunction[], compilingNodes: Set<IR>, source_map: SourceMap | null): (ctx: RuntimeContext) => any {
  if (ir.type === "Function") {
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
