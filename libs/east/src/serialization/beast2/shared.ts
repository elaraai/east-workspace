/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Version-agnostic beast2 building blocks shared by the v4 and v5 codecs:
 * decode options, the IRType singleton, the "no IR attached" diagnostic, and
 * the decoded-function compile glue. Wire-format-specific code lives in
 * `v4/` and `v5/`; this module must stay format-neutral.
 */

import { toEastTypeValue, type EastTypeValue } from "../../type_of_type.js";
import { EAST_IR_SYMBOL, EAST_CAPTURES_SYMBOL, EAST_SOURCE_MAP_SYMBOL, ReturnException, compile_internal, type RuntimeContext } from "../../compile.js";
import { IRType, type FunctionIR, type AsyncFunctionIR } from "../../ir.js";
import type { AnalyzedIR } from "../../analyze.js";
import type { PlatformFunction } from "../../platform.js";
import type { SourceMap } from "../../location.js";

/** Options accepted by every beast2 decode entry point. */
export type Beast2DecodeOptions = {
  platform?: PlatformFunction[];
  /** Decode the value frozen: every container, struct, variant and scalar
   *  wrapper is deeply immutable from construction (no post-walk), mutating
   *  builtins throw, and frozen collections compare as value types under
   *  `Is`. This is how runners decode task inputs. Captured values inside
   *  decoded Function values stay mutable — a closure owns its own state.
   *  Defaults to `false`. */
  frozen?: boolean;
};

/** The IRType schema as an EastTypeValue — module-level singleton shared by
 *  the function encoders/decoders of both codec versions. */
export const irTypeValue = toEastTypeValue(IRType);

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;

/**
 * Computes the FNV-1a 64-bit hash of a byte array.
 *
 * Used as the v5 well-known type section's content hash (shared
 * byte-for-byte across the TS, C, and Python runtimes) and as the key of the
 * type-table section caches (#417).
 *
 * @param bytes - the bytes to hash
 * @returns the 64-bit hash
 */
export function fnv1a64(bytes: Uint8Array): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]!);
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return hash;
}

// Shared empty set for compile_internal's compilingNodes parameter (avoids per-call allocation)
const EMPTY_SET = new Set<any>();

/**
 * Build a safe, bounded description of a value that reached the Function encoder
 * with no compiled IR, for the "no IR attached" diagnostic.
 *
 * The encoder expects a function carrying {@link EAST_IR_SYMBOL}; when that symbol
 * is absent the *value itself* is suspect (it may not even be a function — a
 * non-function in a `FunctionType` slot lands here too — and it may be a Proxy or
 * carry a throwing `toString`). Every inspection is therefore either total
 * (`typeof`, `Object.prototype.toString`) or guarded, so the diagnostic can never
 * throw and mask the real failure.
 *
 * @param value - the value found where an East function with IR was expected
 * @returns a single-line, length-bounded description
 */
export function describeNoIrValue(value: unknown): string {
  const kind = typeof value;                                 // total — never throws
  const tag = Object.prototype.toString.call(value);         // safe [[Class]]; no user code
  const parts: string[] = [`typeof=${kind}`, `tag=${tag}`];
  try {
    if (kind === "function") {
      const name = (value as { name?: unknown }).name;
      if (typeof name === "string" && name) parts.push(`name=${name}`);
      // Built-in toString (not the possibly-overridden value.toString) → the source text.
      const src = Function.prototype.toString.call(value as () => unknown).replace(/\s+/g, " ");
      parts.push(`source=${src.length > 160 ? `${src.slice(0, 160)}…` : src}`);
      parts.push(`hasCaptures=${(value as Record<symbol, unknown>)[EAST_CAPTURES_SYMBOL] !== undefined}`);
      parts.push(`hasSourceMap=${(value as Record<symbol, unknown>)[EAST_SOURCE_MAP_SYMBOL] !== undefined}`);
    } else if (value !== null && value !== undefined) {
      const ctorName = (value as { constructor?: { name?: unknown } }).constructor?.name;
      if (typeof ctorName === "string") parts.push(`constructor=${ctorName}`);
    }
  } catch {
    parts.push("(preview unavailable)");
  }
  return parts.join(" ");
}

/** Platform bindings threaded through a decode pass, pre-resolved from
 *  {@link Beast2DecodeOptions} so per-function compiles don't re-derive them. */
export interface PlatformDecodeContext {
  platform: PlatformFunction[];
  platformFns: Record<string, any>;
  asyncPlatformFns: Set<string>;
}

/**
 * Resolves decode options into the platform bindings used when compiling
 * decoded functions.
 *
 * @param options - decode options carrying the platform function list
 * @returns the pre-resolved platform context
 */
export function buildPlatformContext(options?: Beast2DecodeOptions): PlatformDecodeContext {
  const platform = options?.platform ?? [];
  return {
    platform,
    platformFns: Object.fromEntries(platform.map(fn => [fn.name, fn.fn])),
    asyncPlatformFns: new Set(platform.filter(fn => fn.type === 'async').map(fn => fn.name)),
  };
}

/**
 * Compiles a decoded Function/AsyncFunction IR into a callable and attaches the
 * re-serialization symbols ({@link EAST_IR_SYMBOL}, {@link EAST_CAPTURES_SYMBOL},
 * {@link EAST_SOURCE_MAP_SYMBOL}). This is the codec-independent tail of function
 * decoding — the caller has already decoded the IR and its capture values.
 *
 * @param ir - the decoded Function or AsyncFunction IR
 * @param isAsync - whether the declared type is AsyncFunction
 * @param captureContext - decoded capture values keyed by capture name
 * @param typeContext - capture types keyed by capture name
 * @param platformCtx - pre-resolved platform bindings
 * @param sourceMap - the source map to attach, if the blob carried one
 * @returns the compiled callable with re-serialization symbols attached
 */
export function finishDecodedFunction(
  ir: FunctionIR | AsyncFunctionIR,
  isAsync: boolean,
  captureContext: RuntimeContext,
  typeContext: Record<string, EastTypeValue>,
  platformCtx: PlatformDecodeContext,
  sourceMap: SourceMap | null,
): (...inputs: any[]) => any {
  // Compile IR to callable function — mutate in place to avoid object spread allocations
  (ir.value as any).isAsync = isAsync;
  const compiled = compile_internal(ir as any as AnalyzedIR, typeContext, platformCtx.platformFns, platformCtx.asyncPlatformFns, platformCtx.platform, true, EMPTY_SET);
  const rawFn = compiled(captureContext);

  const fn = isAsync
    ? async (...inputs: any[]) => {
        try { return await rawFn(...inputs); }
        catch (e) { if (e instanceof ReturnException) return e.value; throw e; }
      }
    : (...inputs: any[]) => {
        try { return rawFn(...inputs); }
        catch (e) { if (e instanceof ReturnException) return e.value; throw e; }
      };

  // Attach IR, captures, and source map for re-serialization
  Object.defineProperty(fn, EAST_IR_SYMBOL, { value: ir, writable: false, enumerable: false, configurable: false });
  Object.defineProperty(fn, EAST_CAPTURES_SYMBOL, { value: captureContext, writable: false, enumerable: false, configurable: false });
  if (sourceMap) {
    Object.defineProperty(fn, EAST_SOURCE_MAP_SYMBOL, { value: sourceMap, writable: false, enumerable: false, configurable: false });
  }

  return fn;
}
