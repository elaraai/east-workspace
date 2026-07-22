/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { type ValueTypeOf } from "./types.js";
import type { AsyncFunctionIR, FunctionIR } from "./ir.js";
import { compile_internal, ReturnException, EAST_IR_SYMBOL, EAST_SOURCE_MAP_SYMBOL } from "./compile.js";
import type { PlatformFunction } from "./platform.js";
import { analyzeIR } from "./analyze.js";
import { with_source_map, type SourceMap } from "./location.js";

/** A helper class wrapping East's "intermediate representation" (IR) for a free function.
 * The IR can be serialized and saved, or compiled so that the function can be executed.
 */
export class EastIR<Inputs extends any[], Output extends any> {
  public source_map: SourceMap | null = null;
  constructor(public ir: FunctionIR) {
    if (ir.type !== "Function") {
      throw new Error(`Expected function expression, got a ${ir.type}`)
    }
    if (ir.value.captures.length !== 0) {
      throw new Error(`Expected free function, without captured variables`)
    }
  }

  /** Compile the function for execution in JavaScript using a closure-compiler technique.
   * Platform functions must be provided for the function to evaluate.
   *
   * @param platform - Array of platform function implementations
   */
  compile(platform: PlatformFunction[]): (...inputs: { [K in keyof Inputs]: ValueTypeOf<Inputs[K]> }) => ValueTypeOf<Output> {
    // Analyse the IR under this IR's map: the analyzer names offending nodes
    // by loc_id, which only resolves to a source location while the map that
    // interned it is active.
    const analyze_fn = () => analyzeIR(this.ir, platform);
    const analyzed_ir = this.source_map
      ? with_source_map(this.source_map, analyze_fn)
      : analyze_fn();

    // compile the function (with no variables in environment)
    const platformFns = Object.fromEntries(platform.map(fn => [fn.name, fn.fn]));
    const asyncPlatformFns = new Set<string>();

    // compile_internal reads the active SourceMap via get_current_source_map.
    // Activate the map stored on this IR so loc_ids resolve against the map
    // that was populated during East.function() body execution.
    const compile_fn = () => compile_internal(analyzed_ir, {}, platformFns, asyncPlatformFns, platform);
    const compiled_expr = this.source_map
      ? with_source_map(this.source_map, compile_fn)
      : compile_fn();

    // instantiate the function (with no environment)
    const instantiated_function = compiled_expr({});

    // Return sync wrapper
    const wrapper = (...inputs: any[]) => {
      try {
        return instantiated_function(...inputs)
      } catch (e: unknown) {
        if (e instanceof ReturnException) {
          return e.value;
        } else {
          throw e;
        }
      }
    };

    // Attach IR and source map to wrapper for serialization support
    Object.defineProperty(wrapper, EAST_IR_SYMBOL, {
      value: this.ir,
      writable: false,
      enumerable: false,
      configurable: false
    });
    if (this.source_map) {
      Object.defineProperty(wrapper, EAST_SOURCE_MAP_SYMBOL, {
        value: this.source_map,
        writable: false,
        enumerable: false,
        configurable: false
      });
    }

    return wrapper;
  }
}

/** A helper class wrapping East's "intermediate representation" (IR) for a free async function.
 * The IR can be serialized and saved, or compiled so that the function can be executed.
 */
export class AsyncEastIR<Inputs extends any[], Output extends any> {
  public source_map: SourceMap | null = null;
  constructor(public ir: AsyncFunctionIR) {
    if (ir.type !== "AsyncFunction") {
      throw new Error(`Expected async function expression, got a ${ir.type}`)
    }
    if (ir.value.captures.length !== 0) {
      throw new Error(`Expected free async function, without captured variables`)
    }
  }

  /** Compile the async function for execution in JavaScript using a closure-compiler technique.
   * Platform functions must be provided for the function to evaluate, which may return `Promise`s.
   * The compiled function itself returns a `Promise`.
   *
   * @param platform - Array of platform function implementations
   */
  compile(platform: PlatformFunction[]): (...inputs: { [K in keyof Inputs]: ValueTypeOf<Inputs[K]> }) => Promise<ValueTypeOf<Output>> {
    // Analyse the IR under this IR's map: the analyzer names offending nodes
    // by loc_id, which only resolves to a source location while the map that
    // interned it is active.
    const analyze_fn = () => analyzeIR(this.ir, platform);
    const analyzed_ir = this.source_map
      ? with_source_map(this.source_map, analyze_fn)
      : analyze_fn();

    // compile the function (with no variables in environment)
    const platformFns = Object.fromEntries(platform.map(fn => [fn.name, fn.fn]));
    const asyncPlatformFns = new Set(
      platform.filter(fn => fn.type === 'async').map(fn => fn.name)
    );

    const compile_fn = () => compile_internal(analyzed_ir, {}, platformFns, asyncPlatformFns, platform);
    const compiled_expr = this.source_map
      ? with_source_map(this.source_map, compile_fn)
      : compile_fn();

    // instantiate the function (with no environment)
    const instantiated_function = compiled_expr({});

    // Return async wrapper
    const wrapper = async (...inputs: any[]) => {
      try {
        return await instantiated_function(...inputs)
      } catch (e: unknown) {
        if (e instanceof ReturnException) {
          return e.value;
        } else {
          throw e;
        }
      }
    };

    // Attach IR and source map to wrapper for serialization support
    Object.defineProperty(wrapper, EAST_IR_SYMBOL, {
      value: this.ir,
      writable: false,
      enumerable: false,
      configurable: false
    });
    if (this.source_map) {
      Object.defineProperty(wrapper, EAST_SOURCE_MAP_SYMBOL, {
        value: this.source_map,
        writable: false,
        enumerable: false,
        configurable: false
      });
    }

    return wrapper;
  }
}
