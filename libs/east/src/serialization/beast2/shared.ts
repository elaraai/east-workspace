/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Version-agnostic beast2 building blocks shared by the v4 and v5 codecs:
 * decode options, the IRType singleton, the check of a blob's type against
 * the one a decode was asked for, the "no IR attached" diagnostic, and the
 * decoded-function compile glue. Wire-format-specific code lives in `v4/` and
 * `v5/`; this module must stay format-neutral.
 */

import { toEastTypeValue, type EastTypeValue } from "../../type_of_type.js";
import { getTypeId } from "../../types.js";
import { EAST_IR_SYMBOL, EAST_CAPTURES_SYMBOL, EAST_SOURCE_MAP_SYMBOL, ReturnException, compile_internal, type RuntimeContext } from "../../compile.js";
import { printTypeValue } from "../../compile/runtime.js";
import { IRType, type FunctionIR, type AsyncFunctionIR } from "../../ir.js";
import type { AnalyzedIR } from "../../analyze.js";
import { markAsync } from "../../analyze_async.js";
import type { PlatformFunction } from "../../platform.js";
import { SourceMap, with_source_map } from "../../location.js";

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

/** Header types found to read as the types decodes were asked for. A header's
 *  type is one object per type section, which the section read caches, so
 *  repeated decodes of one schema compare it once. */
const matchedTypes = new WeakMap<object, WeakSet<object>>();

/**
 * Refuses a blob whose header names a type its body does not read as: the
 * type a decode was asked for.
 *
 * @remarks
 * A decode reads the body by the asked type, and the encoding is positional —
 * a variant's tag is its case's position. So the header's type must be the
 * asked type, or a subtype of it, as East's subtyping has it, whose tags line
 * up: it may differ only where a variant of the asked type has further cases
 * after all of the header's, or where the header's is `Never`, which no value
 * has. A `none` then reads as any `Option`, and `some` alone, read as an
 * `Option`, is refused rather than misread. A collection's element types must
 * be the asked ones, as East's subtyping has them, since a program can write
 * to a collection, and so must a function's signature. Recursive types
 * compare up to how their wrappers are named, or repeated, as a table an
 * earlier TypeScript wrote repeats a wrapper inside its own unfolding.
 *
 * @param wire - the type the blob's header names
 * @param asked - the type the decode was asked for
 * @throws {Error} When the header's type does not read as the asked type, naming both
 */
export function checkDecodeType(wire: EastTypeValue, asked: EastTypeValue): void {
  if (wire === asked || matchedTypes.get(wire)?.has(asked)) return;
  if (!readsAs(wire, asked, { wire: new Map(), asked: new Map(), assumed: [] }, false)) {
    throw new Error(`beast2: cannot decode a blob of type ${printTypeValue(wire)} as ${printTypeValue(asked)}`);
  }
  let matched = matchedTypes.get(wire);
  if (matched === undefined) matchedTypes.set(wire, matched = new WeakSet());
  matched.add(asked);
}

/** One {@link readsAs} walk. */
interface ReadsAsWalk {
  /** The header's recursive wrappers the walk has entered, by the id its refs name. */
  readonly wire: Map<bigint, EastTypeValue>;
  /** The asked type's recursive wrappers the walk has entered, by id. */
  readonly asked: Map<bigint, EastTypeValue>;
  /** The pairs in progress through a recursive type, each read exactly or
   *  not: a pair met again inside itself holds, since a recursive type is
   *  its own unfolding. */
  readonly assumed: [wire: EastTypeValue, asked: EastTypeValue, exact: boolean][];
}

/** The wrapper a recursive type is: itself, entered into `scope`, or the one
 *  its ref names. */
function wrapperOf(type: Extract<EastTypeValue, { type: "Recursive" }>, scope: Map<bigint, EastTypeValue>): EastTypeValue | undefined {
  if (type.value.type === "ref") return scope.get(type.value.value);
  scope.set(type.value.value.id, type);
  return type;
}

/** Whether a body written as `wire` reads as `asked` — `exact`ly inside a
 *  collection or a function's signature. */
function readsAs(wire: EastTypeValue, asked: EastTypeValue, walk: ReadsAsWalk, exact: boolean): boolean {
  if (wire === asked) return true;
  const wireId = getTypeId(wire);
  if (wireId !== undefined && wireId === getTypeId(asked)) return true;
  if (wire.type === "Recursive" || asked.type === "Recursive") {
    const w = wire.type === "Recursive" ? wrapperOf(wire, walk.wire) : wire;
    const a = asked.type === "Recursive" ? wrapperOf(asked, walk.asked) : asked;
    if (w === undefined || a === undefined) return false;
    if (walk.assumed.some(([pw, pa, pe]) => pw === w && pa === a && pe === exact)) return true;
    walk.assumed.push([w, a, exact]);
    try {
      return readsAs(
        w.type === "Recursive" && w.value.type === "wrapper" ? w.value.value.inner : w,
        a.type === "Recursive" && a.value.type === "wrapper" ? a.value.value.inner : a,
        walk, exact);
    } finally {
      walk.assumed.pop();
    }
  }
  if (wire.type === "Never") return !exact || asked.type === "Never";
  if (wire.type !== asked.type) return false;
  switch (wire.type) {
    case "Null": case "Boolean": case "Integer": case "Float":
    case "String": case "DateTime": case "Blob":
      return true;
    case "Ref": case "Array": case "Set": case "Vector": case "Matrix":
      return readsAs(wire.value, (asked as typeof wire).value, walk, true);
    case "Dict": {
      const other = (asked as typeof wire).value;
      return readsAs(wire.value.key, other.key, walk, true) && readsAs(wire.value.value, other.value, walk, true);
    }
    case "Struct": case "Variant": {
      const mine: { name: string; type: EastTypeValue }[] = wire.value;
      const theirs: { name: string; type: EastTypeValue }[] = (asked as typeof wire).value;
      // A variant's tags are its cases' positions: the header's cases must be
      // the asked variant's first ones.
      if ((wire.type === "Struct" || exact) ? mine.length !== theirs.length : mine.length > theirs.length) return false;
      return mine.every((entry, i) => entry.name === theirs[i]!.name && readsAs(entry.type, theirs[i]!.type, walk, exact));
    }
    case "Function": case "AsyncFunction": {
      const other = (asked as typeof wire).value;
      return wire.value.inputs.length === other.inputs.length
        && wire.value.inputs.every((input: EastTypeValue, i: number) => readsAs(input, other.inputs[i]!, walk, true))
        && readsAs(wire.value.output, other.output, walk, true);
    }
  }
}

/** FNV-1a 64-bit offset basis, as its high and low 32-bit words. */
const FNV_OFFSET_HIGH = 0xcbf29ce4;
const FNV_OFFSET_LOW = 0x84222325;
/** The FNV-1a 64-bit prime is 2^40 + 0x1b3: a hash times it is the hash times
 *  0x1b3 plus the hash shifted up 40 bits, which is what lets it run in 32-bit
 *  words. */
const FNV_PRIME_LOW = 0x1b3;

/**
 * Computes the FNV-1a 64-bit hash of a byte array.
 *
 * Used as the v5 well-known type section's content hash (shared
 * byte-for-byte across the TS, C, and Python runtimes) and as the key of the
 * type-table section caches (#417).
 *
 * @remarks
 * Computed in two 32-bit words rather than one BigInt: the low word times
 * 0x1b3 stays under 2^41, so its carry into the high word is exact in a
 * double, and the prime's 2^40 term reaches the high word as the low word
 * shifted up 8.
 *
 * @param bytes - the bytes to hash
 * @returns the 64-bit hash
 */
export function fnv1a64(bytes: Uint8Array): bigint {
  let high = FNV_OFFSET_HIGH;
  let low = FNV_OFFSET_LOW;
  for (let i = 0; i < bytes.length; i++) {
    low = (low ^ bytes[i]!) >>> 0;
    const product = low * FNV_PRIME_LOW;
    high = (Math.imul(high, FNV_PRIME_LOW) + Math.floor(product / 0x100000000) + (low << 8)) >>> 0;
    low = product >>> 0;
  }
  return (BigInt(high) << 32n) | BigInt(low);
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

/** The platform list of a decode given none: one list, so that such decodes
 *  share their compiled bodies ({@link CompiledBodies}). */
const NO_PLATFORM = Object.freeze([]) as unknown as PlatformFunction[];

/** At most this many compiled bodies are kept per platform list, the least
 *  recently used going first: the print works Plan's payload compiles 552,
 *  the operations Calendar's 352 (#1353). */
export const COMPILED_BODY_LIMIT = 4096;

/**
 * The bodies compiled against one platform list, by their functions' content
 * key (#1353): a decoded function whose key is here runs the body already
 * compiled, over its own captures, so a payload holding a body at many places
 * compiles it once, and decoding it again compiles nothing.
 *
 * @remarks
 * A compiled body is the closure tree the compiler builds from an IR. It
 * takes its variables when it runs, a literal it returns is a primitive, and
 * it binds the platform's functions as it compiles — so one body serves every
 * function of its content under one platform list, and a changed list compiles
 * again ({@link compiledBodiesFor}).
 *
 * @internal
 */
export class CompiledBodies {
  /** The bodies by content key, the least recently used first. */
  private readonly bodies = new Map<string, (ctx: RuntimeContext) => any>();
  /** The list's entries these compiled against, in order. */
  private readonly entries: readonly PlatformFunction[];
  private compiles = 0;

  /** @param platform - the platform list the bodies compile against */
  constructor(platform: readonly PlatformFunction[]) {
    this.entries = [...platform];
  }

  /**
   * Whether `platform` holds the entries these bodies compiled against.
   *
   * @param platform - the list a decode was given
   * @returns whether it holds the same platform functions, in order
   */
  compiledAgainst(platform: readonly PlatformFunction[]): boolean {
    if (platform.length !== this.entries.length) return false;
    for (let i = 0; i < platform.length; i++) {
      if (platform[i] !== this.entries[i]) return false;
    }
    return true;
  }

  /**
   * The body of the functions of content `key`, compiled the first time it is
   * asked for.
   *
   * @param key - the functions' content key
   * @param compile - compiles the body
   * @returns the compiled body
   */
  bodyFor(key: string, compile: () => (ctx: RuntimeContext) => any): (ctx: RuntimeContext) => any {
    const held = this.bodies.get(key);
    if (held !== undefined) {
      this.bodies.delete(key);
      this.bodies.set(key, held);
      return held;
    }
    const body = compile();
    this.compiles++;
    this.bodies.set(key, body);
    if (this.bodies.size > COMPILED_BODY_LIMIT) this.bodies.delete(this.bodies.keys().next().value!);
    return body;
  }

  /** How many bodies are kept. */
  get size(): number {
    return this.bodies.size;
  }

  /** How many bodies have been compiled. */
  get compiled(): number {
    return this.compiles;
  }
}

/** The compiled bodies of each platform list, while the list lives. */
const compiledBodiesOf = new WeakMap<readonly PlatformFunction[], CompiledBodies>();

/**
 * The bodies compiled against a platform list: kept with the list, and started
 * afresh once the list holds other functions.
 *
 * @param platform - the list a decode was given
 * @returns its compiled bodies
 * @internal
 */
export function compiledBodiesFor(platform: readonly PlatformFunction[]): CompiledBodies {
  const held = compiledBodiesOf.get(platform);
  if (held !== undefined && held.compiledAgainst(platform)) return held;
  const fresh = new CompiledBodies(platform);
  compiledBodiesOf.set(platform, fresh);
  return fresh;
}

/** Platform bindings threaded through a decode pass, pre-resolved from
 *  {@link Beast2DecodeOptions} so per-function compiles don't re-derive them. */
export interface PlatformDecodeContext {
  platform: PlatformFunction[];
  platformFns: Record<string, any>;
  asyncPlatformFns: Set<string>;
  /** The bodies compiled against `platform`, which a keyed function compiles once into (#1353); found
   *  when the decode meets its first keyed function, so a decode of data pays nothing for them. */
  compiled?: CompiledBodies;
}

/**
 * Resolves decode options into the platform bindings used when compiling
 * decoded functions.
 *
 * @param options - decode options carrying the platform function list
 * @returns the pre-resolved platform context
 */
export function buildPlatformContext(options?: Beast2DecodeOptions): PlatformDecodeContext {
  const platform = options?.platform ?? NO_PLATFORM;
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
 * @remarks
 * Before the IR compiles, its nodes are marked with whether each awaits
 * ({@link markAsync}): the compiler reads it, and the IR's wire does not carry
 * it, so a body compiled without it would run every statement synchronously,
 * and a statement after an awaited call would read its promise (#1207). The
 * IR is not checked again, as a build checked it: over a UI payload's types
 * that would make a decode ten to forty times slower. A platform function the
 * decode was not given is stubbed by the compiler, so the value decodes
 * wherever it is read, and only a call needs the platform.
 *
 * A function with a content key runs the body compiled for its key under the
 * decode's platform list, compiling it only the first time (#1353,
 * {@link CompiledBodies}). It keeps the IR it was decoded with, unmarked when
 * its body was compiled before: that IR is what it re-encodes and compares as,
 * so a decode then an encode gives back the bytes it was read from.
 *
 * @param ir - the decoded Function or AsyncFunction IR, whose nodes are marked in place when it compiles
 * @param isAsync - whether the declared type is AsyncFunction
 * @param captureContext - decoded capture values keyed by capture name
 * @param typeContext - capture types keyed by capture name
 * @param platformCtx - pre-resolved platform bindings
 * @param sourceMap - the source map to attach, if the blob carried one
 * @param key - the function's content key: its IR's and its stream's source map's, when the codec keys it
 * @returns the compiled callable with re-serialization symbols attached
 */
export function finishDecodedFunction(
  ir: FunctionIR | AsyncFunctionIR,
  isAsync: boolean,
  captureContext: RuntimeContext,
  typeContext: Record<string, EastTypeValue>,
  platformCtx: PlatformDecodeContext,
  sourceMap: SourceMap | null,
  key?: string,
): (...inputs: any[]) => any {
  const compile = () => {
    markAsync(ir, platformCtx.asyncPlatformFns);
    // The compile snapshots the AMBIENT source map (compile_internal's
    // fresh_ctx), so it must run under the map the blob carried: that is the
    // map the IR's loc_ids index, and the only one that makes a runtime error
    // inside the decoded function name its authoring site. Outside a scope the
    // ambient map is null — or, decoding inside a build, that build's map,
    // against which the blob's ids mean nothing. A blob without a map compiles
    // under an empty one for the same reason (#626). A key holds the map, so a
    // body compiled under one serves only functions read under its like.
    return with_source_map(sourceMap ?? new SourceMap(), () =>
      compile_internal(ir as AnalyzedIR, typeContext, platformCtx.platformFns, platformCtx.asyncPlatformFns, platformCtx.platform, true, EMPTY_SET));
  };
  const compiled = key === undefined ? compile() : (platformCtx.compiled ??= compiledBodiesFor(platformCtx.platform)).bodyFor(key, compile);
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
