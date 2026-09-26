/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { toEastTypeValue, type EastTypeValue } from "./type_of_type.js";
import type { EastType, ValueTypeOf } from "./types.js";
import { isVariant, variant } from "./containers/variant.js";
import { isFrozenValue } from "./frozen.js";
import type { ref } from "./containers/ref.js";
import { IRType, type AsyncFunctionIR, type FunctionIR } from "./ir.js";
import { EAST_CAPTURES_SYMBOL, EAST_IR_SYMBOL } from "./function_symbols.js";
import type { RuntimeContext } from "./compile.js";

/** Map of comparers for recursive types, keyed by recursive type id (bigint) */
type TypeContext = Map<bigint, any>;

/** Tracks (x,y) pairs previously/currently being compared */
type ValueContext = Map<any, Set<any>>;

/** Identity comparison that upgrades to deep value equality when BOTH
 *  operands are frozen — frozen collections are value types (the Blob
 *  precedent), and a mutable operand keeps identity semantics. The equality
 *  comparer is built on first frozen use, so unfrozen comparisons pay only
 *  the frozen checks; `eqCtx` carries the recursive-type registrations that
 *  let element back-references resolve during that deferred build. */
function frozenAwareIs(type: EastTypeValue, eqCtx: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean {
  let equal: ((x: any, y: any, ctx?: ValueContext) => boolean) | undefined;
  return (x: any, y: any, _ctx?: ValueContext) => {
    if (Object.is(x, y)) return true;
    if (isFrozenValue(x) && isFrozenValue(y)) {
      equal ??= equalFor(type, eqCtx);
      return equal(x, y);
    }
    return false;
  };
}

/**
 * Builds the East `Is` comparer for a type.
 *
 * Immutable types compare by value, mutable containers by identity — except
 * that two FROZEN Array/Set/Dict/Vector/Matrix operands compare by deep
 * value equality (a frozen collection is a value type; the Blob precedent).
 * A `Ref` always compares by identity, frozen or not.
 *
 * @param type - the compared type
 * @param typeCtx - recursive-type registry of `Is` comparers, keyed by
 *   wrapper id (shared across one build)
 * @param eqCtx - recursive-type registry of EQUALITY comparers, threaded to
 *   the deferred `equalFor` build the frozen path performs
 * @returns the comparer
 */
export function isFor(type: EastTypeValue, typeCtx?: TypeContext, eqCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean
export function isFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => boolean
export function isFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map(), eqCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => boolean {
  // Convert EastType to EastTypeValue if necessary
  if (!isVariant(type)) {
    type = toEastTypeValue(type as EastType);
  }

  if (type.type === "Never") {
    return (_x: unknown, _y: unknown, _ctx?: ValueContext) => { throw new Error(`Attempted to compare values of type .Never`) };
  } else if (type.type === "Null") {
    return (_x: null, _y: null, _ctx?: ValueContext) => true;
  } else if (type.type === "Boolean") {
    return (x: boolean, y: boolean, _ctx?: ValueContext) => x === y;
  } else if (type.type === "Integer") {
    return (x: bigint, y: bigint, _ctx?: ValueContext) => x === y;
  } else if (type.type === "Float") {
    return (x: number, y: number, _ctx?: ValueContext) => Number.isNaN(x) ? Number.isNaN(y) : x === y; // Note Object.is can fail for different NaN representations
  } else if (type.type === "String") {
    return (x: string, y: string, _ctx?: ValueContext) => x === y;
  } else if (type.type === "DateTime") {
    return (x: Date, y: Date, _ctx?: ValueContext) => x.valueOf() === y.valueOf();
  } else if (type.type === "Blob") {
    // in our type system blobs are immutable (i.e. not reference types), so we must compare by value here
    return (x: Uint8Array, y: Uint8Array, _ctx?: ValueContext) => {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (x[i] !== y[i]) return false;
      }
      return true;
    }
  } else if (type.type === "Ref") {
    // mutable types are compared by identity (a Ref is the explicit identity
    // cell — frozen or not, its meaningful relation is identity)
    return (x: any[], y: any, _ctx?: ValueContext) => Object.is(x, y);
  } else if (type.type === "Array") {
    // mutable arrays are compared by identity; frozen arrays by value
    return frozenAwareIs(type as EastTypeValue, eqCtx);
  } else if (type.type === "Vector") {
    // `is` compares mutable vectors by identity; frozen vectors by value
    return frozenAwareIs(type as EastTypeValue, eqCtx);
  } else if (type.type === "Matrix") {
    // `is` compares mutable matrices by identity; frozen matrices by value
    return frozenAwareIs(type as EastTypeValue, eqCtx);
  } else if (type.type === "Set") {
    // mutable sets are compared by identity; frozen sets by value
    return frozenAwareIs(type as EastTypeValue, eqCtx);
  } else if (type.type === "Dict") {
    // mutable dicts are compared by identity; frozen dicts by value
    return frozenAwareIs(type as EastTypeValue, eqCtx);
  } else if (type.type === "Struct") {
    // const field_comparers = type.value.map(({ name, type }) => [name, isFor(type, typeCtx)] as const);
    const field_comparers: [string, (x: any, y: any, ctx?: ValueContext) => boolean][] = [];
    const ret = (x: Record<string, any>, y: Record<string, any>, ctx?: ValueContext) => {
      // Fast path: reference equality
      if (x === y) return true;

      for (const [k, comparer] of field_comparers) {
        if (!comparer(x[k], y[k], ctx)) {
          return false;
        }
      }
      return true;
    }
    for (const field of type.value) {
      field_comparers.push([field.name, isFor(field.type, typeCtx, eqCtx)] as const);
    }
    return ret;
  } else if (type.type === "Variant") {
    const case_comparers: Record<string, (x: any, y: any, ctx?: ValueContext) => boolean> = {};
    const ret = (x: variant, y: variant, ctx?: ValueContext) => {
      // Fast path: reference equality
      if (x === y) return true;

      if (x.type !== y.type) return false;
      return case_comparers[x.type]!(x.value, y.value, ctx);
    };
    for (const { name, type: caseType } of type.value) {
      case_comparers[name] = isFor(caseType, typeCtx, eqCtx);
    }
    return ret;
  } else if (type.type === "Recursive" && (type.value as any).type === "wrapper") {
    // Recursive wrapper: register handler by id, build inner. The equality
    // context is registered up front (via equalFor's own wrapper handling) so
    // a nested container's deferred frozen-equality build can resolve
    // back-references to this wrapper.
    let inner: (x: any, y: any, ctx?: ValueContext) => boolean;
    const ret = (x: any, y: any, ctx?: ValueContext) => inner(x, y, ctx);
    typeCtx.set((type.value as any).value.id as bigint, ret);
    if (!eqCtx.has((type.value as any).value.id as bigint)) {
      equalFor(type, eqCtx);
    }
    inner = isFor((type.value as any).value.inner, typeCtx, eqCtx);
    return ret;
  } else if (type.type === "Recursive") {
    // Self-reference: look up by id
    const ret = typeCtx.get((type.value as any).value as bigint);
    if (ret === undefined) {
      throw new Error(`Internal error: Recursive type context not found`);
    }
    return ret;
  } else if (type.type === "Function") {
    throw new Error(`Attempted to compare values of type .Function`);
  } else if (type.type === "AsyncFunction") {
    throw new Error(`Attempted to compare values of type .AsyncFunction`);
  } else {
    throw new Error(`Unhandled type ${(type satisfies never as EastTypeValue).type}`);
  }
}

/**
 * Builds the East equality comparer for a type — structural value equality,
 * the `Equal` builtin's semantics.
 *
 * @remarks
 * Every pair of functions compares EQUAL: function equality is undecidable,
 * and for data the useful answer is to ignore them. Where a function's
 * identity matters — a render memo or a cache keyed by a value that carries
 * callbacks — use {@link equivalentFor}.
 *
 * @param type - the compared type
 * @param typeCtx - recursive-type registry of comparers, keyed by wrapper id
 *   (shared across one build)
 * @returns the comparer
 */
export function equalFor(type: EastTypeValue, typeCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean
export function equalFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => boolean
export function equalFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => boolean {
  // Convert EastType to EastTypeValue if necessary
  const typeValue = isVariant(type) ? type as EastTypeValue : toEastTypeValue(type);
  return equalForImpl(typeValue, typeCtx, "always");
}

/**
 * Builds a comparer that is {@link equalFor} everywhere except on functions,
 * where it looks inside: two function values are equivalent when they are the
 * same function, or when both are compiled East functions whose IR is equal
 * (the same node, or structurally equal) and whose captured values are
 * pairwise equivalent.
 *
 * @remarks
 * A host function — one carrying no East IR — is equivalent only to itself,
 * and a captured MUTABLE variable only to the same variable (two boxes are two
 * variables, whatever they hold right now). The comparison is sound, not
 * complete: equivalent functions compute the same results, while two
 * functions it calls different may still agree.
 *
 * Use it where a false "different" only costs work and a false "equal" costs
 * correctness: a render memo over a value carrying callbacks, or a cache keyed
 * by a value that carries the function it caches the output of. `equalFor`
 * treats all functions as equal and would serve such a cache stale.
 *
 * @param type - the compared type
 * @param typeCtx - recursive-type registry of comparers, keyed by wrapper id
 *   (shared across one build)
 * @returns the comparer
 *
 * @example
 * ```ts
 * const Counter = FunctionType([], IntegerType);
 * const makeCounter = East.compile(
 *   East.function([IntegerType], Counter, (_$, n) => East.function([], IntegerType, (_$2) => n)),
 *   [],
 * );
 * const equivalent = equivalentFor(Counter);
 * equivalent(makeCounter(1n), makeCounter(1n));   // true: same IR, equal captures
 * equivalent(makeCounter(1n), makeCounter(2n));   // false: the captured n differs
 * equalFor(Counter)(makeCounter(1n), makeCounter(2n));   // true: equalFor never looks inside
 * ```
 */
export function equivalentFor(type: EastTypeValue, typeCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean
export function equivalentFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => boolean
export function equivalentFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => boolean {
  // Convert EastType to EastTypeValue if necessary
  const typeValue = isVariant(type) ? type as EastTypeValue : toEastTypeValue(type);
  return equalForImpl(typeValue, typeCtx, "equivalent");
}

/** How the equality traversal treats Function / AsyncFunction values. */
type FunctionEquality = "always" | "equivalent";

/** The traversal behind {@link equalFor} and {@link equivalentFor}; `fns`
 *  decides only the function arms, so the two cannot drift apart. */
function equalForImpl(type: EastTypeValue, typeCtx: TypeContext, fns: FunctionEquality): (x: any, y: any, ctx?: ValueContext) => boolean {
  if (type.type === "Never") {
    return (_x: unknown, _y: unknown, _ctx?: ValueContext) => { throw new Error(`Attempted to compare values of type .Never`) };
  } else if (type.type === "Null") {
    return (_x: null, _y: null, _ctx?: ValueContext) => true;
  } else if (type.type === "Boolean") {
    return (x: boolean, y: boolean, _ctx?: ValueContext) => x === y;
  } else if (type.type === "Integer") {
    return (x: bigint, y: bigint, _ctx?: ValueContext) => x === y;
  } else if (type.type === "Float") {
    return (x: number, y: number, _ctx?: ValueContext) => Number.isNaN(x) ? Number.isNaN(y) : Object.is(x, y);
  } else if (type.type === "String") {
    return (x: string, y: string, _ctx?: ValueContext) => x === y;
  } else if (type.type === "DateTime") {
    return (x: Date, y: Date, _ctx?: ValueContext) => x.valueOf() === y.valueOf();
  } else if (type.type === "Blob") {
    return (x: Uint8Array, y: Uint8Array, _ctx?: ValueContext) => {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (x[i] !== y[i]) return false;
      }
      return true;
    }
  } else if (type.type === "Vector") {
    const elemEqual = equalForImpl(type.value, typeCtx, fns);
    return (x: any, y: any, _ctx?: ValueContext) => {
      if (Object.is(x, y)) return true;
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (!elemEqual(x[i], y[i])) return false;
      }
      return true;
    };
  } else if (type.type === "Matrix") {
    const elemEqual = equalForImpl(type.value, typeCtx, fns);
    return (x: any, y: any, _ctx?: ValueContext) => {
      if (Object.is(x, y)) return true;
      if (x.rows !== y.rows || x.cols !== y.cols) return false;
      const xd = x.data;
      const yd = y.data;
      for (let i = 0; i < xd.length; i++) {
        if (!elemEqual(xd[i], yd[i])) return false;
      }
      return true;
    };
  } else if (type.type === "Ref") {
    let value_comparer: (x: any, y: any, ctx?: ValueContext) => boolean;
    const ret = (x: ref<any>, y: ref<any>, ctx?: ValueContext) => {
      // Fast path
      if (Object.is(x, y)) return true;

      // Create context if needed (top-level call)
      if (!ctx) {
        ctx = new Map();
      }

      // Check if we've visited this pair
      const xSet = ctx.get(x);
      if (xSet?.has(y)) {
        return true; // Cycle - we're re-encountering this pair
      }

      // Mark as visited
      let visitedSet = ctx.get(x);
      if (!visitedSet) {
        visitedSet = new Set();
        ctx.set(x, visitedSet);
      }
      visitedSet.add(y);

      // Now do the actual comparison
      return value_comparer(x.value, y.value, ctx);
    };
    value_comparer = equalForImpl(type.value as EastTypeValue, typeCtx, fns);
    return ret;
  } else if (type.type === "Array") {
    let value_comparer: (x: any, y: any, ctx?: ValueContext) => boolean;
    const ret = (x: any[], y: any[], ctx?: ValueContext) => {
      // Fast path
      if (Object.is(x, y)) return true;

      // Create context if needed (top-level call)
      if (!ctx) {
        ctx = new Map();
      }

      // Check if we've visited this pair
      const xSet = ctx.get(x);
      if (xSet?.has(y)) {
        return true; // Cycle - we're re-encountering this pair
      }

      // Mark as visited
      let visitedSet = ctx.get(x);
      if (!visitedSet) {
        visitedSet = new Set();
        ctx.set(x, visitedSet);
      }
      visitedSet.add(y);

      // Now do the actual comparison
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (!value_comparer(x[i], y[i], ctx)) {
          return false;
        }
      }
      return true;
    };
    value_comparer = equalForImpl(type.value as EastTypeValue, typeCtx, fns);
    return ret;
  } else if (type.type === "Set") {
    return (x: Set<any>, y: Set<any>, _ctx?: ValueContext) => {
      if (x.size !== y.size) return false;
      for (const xk of x) {
        if (!y.has(xk)) return false;
      }
      return true;
    }
  } else if (type.type === "Dict") {
    let value_comparer: (x: any, y: any, ctx?: ValueContext) => boolean;
    const ret = (x: Map<any, any>, y: any, ctx?: ValueContext) => {
      // Fast path
      if (Object.is(x, y)) return true;

      // Create context if needed (top-level call)
      if (!ctx) {
        ctx = new Map();
      }

      // Check if we've visited this pair
      const xSet = ctx.get(x);
      if (xSet?.has(y)) {
        return true; // Cycle - we're re-encountering this pair
      }

      // Mark as visited
      let visitedSet = ctx.get(x);
      if (!visitedSet) {
        visitedSet = new Set();
        ctx.set(x, visitedSet);
      }
      visitedSet.add(y);

      // Now do the actual comparison
      if (x.size !== y.size) return false;
      for (const [xk, xv] of x) {
        if (!y.has(xk)) return false;
        const yv = y.get(xk);
        if (!value_comparer(xv, yv, ctx)) return false;
      }
      return true;
    }
    value_comparer = equalForImpl(type.value.value, typeCtx, fns);
    return ret;
  } else if (type.type === "Struct") {
    const field_comparers: [string, (x: any, y: any, ctx?: ValueContext) => boolean][] = [];
    const ret = (x: Record<string, any>, y: Record<string, any>, ctx?: ValueContext) => {
      // Fast path: reference equality
      if (x === y) return true;

      // Check for cycles (needed for recursive types that can create circular references)
      if (!ctx) {
        ctx = new Map();
      }

      // Check if we've visited this pair
      const xSet = ctx.get(x);
      if (xSet?.has(y)) {
        return true; // Cycle - we're re-encountering this pair
      }

      // Mark as visited
      let visitedSet = ctx.get(x);
      if (!visitedSet) {
        visitedSet = new Set();
        ctx.set(x, visitedSet);
      }
      visitedSet.add(y);

      // Compare fields
      for (const [k, comparer] of field_comparers) {
        if (!comparer(x[k], y[k], ctx)) {
          return false;
        }
      }
      return true;
    }
    for (const field of type.value) {
      field_comparers.push([field.name, equalForImpl(field.type, typeCtx, fns)] as const);
    }
    return ret;
  } else if (type.type === "Variant") {
    const case_comparers: Record<string, (x: any, y: any, ctx?: ValueContext) => boolean> = {};
    const ret = (x: variant, y: variant, ctx?: ValueContext) => {
      // Fast path: reference equality
      if (x === y) return true;

      if (x.type !== y.type) return false;

      // Check for cycles (needed for recursive types)
      if (!ctx) {
        ctx = new Map();
      }

      const xSet = ctx.get(x);
      if (xSet?.has(y)) {
        return true; // Cycle
      }

      let visitedSet = ctx.get(x);
      if (!visitedSet) {
        visitedSet = new Set();
        ctx.set(x, visitedSet);
      }
      visitedSet.add(y);

      return case_comparers[x.type]!(x.value, y.value, ctx);
    };
    for (const { name, type: caseType } of type.value) {
      case_comparers[name] = equalForImpl(caseType, typeCtx, fns);
    }
    return ret;
  } else if (type.type === "Recursive" && (type.value as any).type === "wrapper") {
    let inner: (x: any, y: any, ctx?: ValueContext) => boolean;
    const ret = (x: any, y: any, ctx?: ValueContext) => inner(x, y, ctx);
    typeCtx.set((type.value as any).value.id as bigint, ret);
    inner = equalForImpl((type.value as any).value.inner, typeCtx, fns);
    return ret;
  } else if (type.type === "Recursive") {
    const ret = typeCtx.get((type.value as any).value as bigint);
    if (ret === undefined) {
      throw new Error(`Internal error: Recursive type context not found`);
    }
    return ret;
  } else if (type.type === "Function" || type.type === "AsyncFunction") {
    if (fns === "always") {
      return (_x: any, _y: any, _ctx?: ValueContext) => {
        return true; // Functions are always considered equal
      }
    }
    return functionsEquivalent;
  } else {
    throw new Error(`Unhandled type ${(type satisfies never as EastTypeValue).type}`);
  }
}


/** Structural IR equality, built on first use. */
let irEqual: ((x: any, y: any) => boolean) | undefined;

/** Pairwise IR verdicts. A function value's IR is final once the value
 *  exists, so a verdict holds for the pair's lifetime — and a value decoded
 *  afresh on every change, whose functions carry fresh-but-equal IR, pays one
 *  structural walk per pair instead of one per comparison. */
const irVerdicts = new WeakMap<object, WeakMap<object, boolean>>();

/** Whether two function IR nodes are the same node or structurally equal. */
function irEquivalent(x: object, y: object): boolean {
  if (x === y) return true;
  let row = irVerdicts.get(x);
  const known = row?.get(y);
  if (known !== undefined) return known;
  irEqual ??= equalFor(IRType);
  const verdict = irEqual(x, y);
  if (row === undefined) {
    row = new WeakMap();
    irVerdicts.set(x, row);
  }
  row.set(y, verdict);
  return verdict;
}

/** Per-IR capture comparers — a function's captured variables and their
 *  types are fixed by its IR. */
const captureComparers = new WeakMap<object, readonly (readonly [string, (x: any, y: any, ctx?: ValueContext) => boolean])[]>();

function captureComparersOf(ir: FunctionIR | AsyncFunctionIR): readonly (readonly [string, (x: any, y: any, ctx?: ValueContext) => boolean])[] {
  let comparers = captureComparers.get(ir);
  if (comparers === undefined) {
    comparers = ir.value.captures.map(c => [c.value.name, equivalentFor(c.value.type)] as const);
    captureComparers.set(ir, comparers);
  }
  return comparers;
}

/** The {@link equivalentFor} function arm (see there for the rules). */
function functionsEquivalent(x: any, y: any, ctx?: ValueContext): boolean {
  if (x === y) return true;
  const xir = x?.[EAST_IR_SYMBOL] as FunctionIR | AsyncFunctionIR | undefined;
  const yir = y?.[EAST_IR_SYMBOL] as FunctionIR | AsyncFunctionIR | undefined;
  // A host function carries no IR: its identity is all there is to compare.
  if (xir === undefined || yir === undefined) return false;
  if (!irEquivalent(xir, yir)) return false;
  // A free function (EastIR.compile's wrapper) carries no captures at all.
  const xcaptures = x[EAST_CAPTURES_SYMBOL] as RuntimeContext | undefined;
  const ycaptures = y[EAST_CAPTURES_SYMBOL] as RuntimeContext | undefined;
  for (const [name, equivalent] of captureComparersOf(xir)) {
    const xv = xcaptures?.[name];
    const yv = ycaptures?.[name];
    if (xv === yv) continue;
    if (xv === undefined || yv === undefined) return false;
    // A captured mutable variable is a shared box: two boxes are two
    // variables, whatever they hold right now.
    if (xv.type === "boxed" || yv.type === "boxed") return false;
    if (!equivalent(xv.value, yv.value, ctx)) return false;
  }
  return true;
}

export function notEqualFor(type: EastTypeValue, typeCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean
export function notEqualFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => boolean
export function notEqualFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => boolean {
  const equal = equalFor(type as any, typeCtx);
  return (x: any, y: any, ctx?: ValueContext) => !equal(x, y, ctx);

  // // Convert EastType to EastTypeValue if necessary
  // if (!isVariant(type)) {
  //   type = toEastTypeValue(type);
  // }

  // if (type.type === "Never") {
  //   return (_x: unknown, _y: unknown) => { throw new Error(`Attempted to compare values of type .Never`)};
  // } else if (type.type === "Null") {
  //   return (_x: null, _y: null) => false;
  // } else if (type.type === "Boolean") {
  //   return (x: boolean, y: boolean) => x !== y;
  // } else if (type.type === "Integer") {
  //   return (x: bigint, y: bigint) => x !== y;
  // } else if (type.type === "Float") {
  //   return (x: number, y: number) => Number.isNaN(x) ? !Number.isNaN(y) : !Object.is(x, y);
  // } else if (type.type === "String") {
  //   return (x: string, y: string) => x !== y;
  // } else if (type.type === "DateTime") {
  //   return (x: Date, y: Date) => x.valueOf() !== y.valueOf();
  // } else if (type.type === "Blob") {
  //   return (x: Uint8Array, y: Uint8Array) => {
  //     if (x.length !== y.length) return true;
  //     for (let i = 0; i < x.length; i++) {
  //       if (x[i] !== y[i]) return true;
  //     }
  //     return false;
  //   }
  // } else if (type.type === "Array") {
  //   const eq = equalFor(type as EastTypeValue, typeCtx);
  //   return (x: any[], y: any[], ctx?: ValueContext) => !eq(x, y, ctx);
  // } else if (type.type === "Set") {
  //   return (x: Set<any>, y: Set<any>) => {
  //     if (x.size !== y.size) return true;
  //     for (const xk of x) {
  //       if (!y.has(xk)) return true;
  //     }
  //     return false;
  //   }
  // } else if (type.type === "Dict") {
  //   const eq = equalFor(type as EastTypeValue, typeCtx);
  //   return (x: Map<any, any>, y: Map<any, any>, ctx?: ValueContext) => !eq(x, y, ctx);
  // } else if (type.type === "Struct") {
  //   const field_comparers: [string, (x: any, y: any, ctx?: ValueContext) => boolean][] = [];
  //   const ret = (x: Record<string, any>, y: Record<string, any>, ctx?: ValueContext) => {
  //     for (const [k, comparer] of field_comparers) {
  //       if (comparer(x[k], y[k], ctx)) return true;
  //     }
  //     return false;
  //   }
  //   typeCtx.push(ret);
  //   for (const field of type.value) {
  //     field_comparers.push([field.name, notEqualFor(field.type, typeCtx)] as const);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Variant") {
  //   const case_comparers: Record<string, (x: any, y: any, ctx?: ValueContext) => boolean> = {};
  //   const ret = (x: variant, y: variant, ctx?: ValueContext) => {
  //     if (x.type !== y.type) return true;
  //     return case_comparers[x.type]!(x.value, y.value, ctx);
  //   };
  //   typeCtx.push(ret);
  //   for (const { name, type: caseType } of type.value) {
  //     case_comparers[name] = notEqualFor(caseType, typeCtx);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Recursive") {
  //   const ret = typeCtx[typeCtx.length - Number(type.value.value)];
  //   if (ret === undefined) {
  //     throw new Error(`Internal error: Recursive type context not found`);
  //   }
  //   return ret;
  // } else if (type.type === "Function") {
  //   throw new Error(`Attempted to compare values of type .Function`);
  // } else {
  //   throw new Error(`Unhandled type ${(type satisfies never as EastTypeValue).type}`);
  // }
}

export function lessFor(type: EastTypeValue, typeCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean
export function lessFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => boolean
export function lessFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => boolean {
  const cmp = compareFor(type as any, typeCtx);
  return (x: any, y: any, ctx?: ValueContext) => cmp(x, y, ctx) === -1;

  // // Convert EastType to EastTypeValue if necessary
  // if (!isVariant(type)) {
  //   type = toEastTypeValue(type);
  // }

  // if (type.type === "Never") {
  //   return (_x: unknown, _y: unknown) => { throw new Error(`Attempted to compare values of type .Never`)};
  // } else if (type.type === "Null") {
  //   return (_x: null, _y: null) => false;
  // } else if (type.type === "Boolean") {
  //   return (x: boolean, y: boolean) => x < y;
  // } else if (type.type === "Integer") {
  //   return (x: bigint, y: bigint) => x < y;
  // } else if (type.type === "Float") {
  //   return (x: number, y: number) => {
  //     if (Number.isNaN(y)) return !Number.isNaN(x);
  //     if (Object.is(x, -0) && Object.is(y, 0)) return true;
  //     if (Object.is(x, 0) && Object.is(y, -0)) return false;
  //     return x < y;
  //   };
  // } else if (type.type === "String") {
  //   return (x: string, y: string) => x < y;
  // } else if (type.type === "DateTime") {
  //   return (x: Date, y: Date) => x.valueOf() < y.valueOf();
  // } else if (type.type === "Blob") {
  //   return (x: Uint8Array, y: Uint8Array) => {
  //     const length = x.length < y.length ? x.length : y.length;
  //     for (let i = 0; i < length; i++) {
  //       if (x[i]! < y[i]!) return true;
  //       if (x[i]! > y[i]!) return false;
  //     }
  //     return x.length < y.length;
  //   }
  // } else if (type.type === "Array") {
  //   const cmp = compareFor(type as EastTypeValue, typeCtx);
  //   return (x: any[], y: any[], ctx?: ValueContext) => cmp(x, y, ctx) === -1;
  // } else if (type.type === "Set") {
  //   const key_comparer = compareFor(type.value, []);
  //   return (x: Set<any>, y: Set<any>) => {
  //     // co-iterate the two sets (assume they are sorted)
  //     const yiterator = y.keys();
  //     for (const xk of x) {
  //       const yresult = yiterator.next();
  //       if (yresult.done) return false; // if y runs out first, x is greater than y
  //       const yk = yresult.value;
  //       const c = key_comparer(xk, yk);
  //       if (c !== 0) return c === -1;
  //     }
  //     // x ran out first, check if y has more elements
  //     return !yiterator.next().done;
  //   }
  // } else if (type.type === "Dict") {
  //   const cmp = compareFor(type as EastTypeValue, typeCtx);
  //   return (x: Map<any, any>, y: Map<any, any>, ctx?: ValueContext) => cmp(x, y, ctx) === -1;
  // } else if (type.type === "Struct") {
  //   const field_comparers: [string, (x: any, y: any, ctx?: ValueContext) => boolean][] = [];
  //   const ret = (x: Record<string, any>, y: Record<string, any>, ctx?: ValueContext) => {
  //     for (const [k, comparer] of field_comparers) {
  //       if (comparer(x[k], y[k], ctx)) return true;
  //       if (comparer(y[k], x[k], ctx)) return false;
  //     }
  //     return false;
  //   };
  //   typeCtx.push(ret);
  //   for (const field of type.value) {
  //     field_comparers.push([field.name, lessFor(field.type, typeCtx)] as const);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Variant") {
  //   const case_comparers: Record<string, (x: any, y: any, ctx?: ValueContext) => boolean> = {};
  //   const ret = (x: variant, y: variant, ctx?: ValueContext) => {
  //     if (x.type < y.type) return true;
  //     if (x.type > y.type) return false;
  //     return case_comparers[x.type]!(x.value, y.value, ctx);
  //   };
  //   typeCtx.push(ret);
  //   for (const { name, type: caseType } of type.value) {
  //     case_comparers[name] = lessFor(caseType, typeCtx);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Recursive") {
  //   const ret = typeCtx[typeCtx.length - Number(type.value.value)];
  //   if (ret === undefined) {
  //     throw new Error(`Internal error: Recursive type context not found`);
  //   }
  //   return ret;
  // } else if (type.type === "Function") {
  //   throw new Error(`Attempted to compare values of type .Function`);
  // } else {
  //   throw new Error(`Unhandled type ${(type satisfies never as EastTypeValue).type}`);
  // }
}

export function lessEqualFor(type: EastTypeValue, typeCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean
export function lessEqualFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => boolean
export function lessEqualFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => boolean {
  const cmp = compareFor(type as any, typeCtx);
  return (x: any, y: any, ctx?: ValueContext) => cmp(x, y, ctx) !== 1;

  // // Convert EastType to EastTypeValue if necessary
  // if (!isVariant(type)) {
  //   type = toEastTypeValue(type);
  // }

  // if (type.type === "Never") {
  //   return (_x: unknown, _y: unknown) => { throw new Error(`Attempted to compare values of type .Never`)};
  // } else if (type.type === "Null") {
  //   return (_x: null, _y: null) => true;
  // } else if (type.type === "Boolean") {
  //   return (x: boolean, y: boolean) => x <= y;
  // } else if (type.type === "Integer") {
  //   return (x: bigint, y: bigint) => x <= y;
  // } else if (type.type === "Float") {
  //   return (x: number, y: number) => Number.isNaN(y) ? true : x <= y;
  // } else if (type.type === "String") {
  //   return (x: string, y: string) => x <= y;
  // } else if (type.type === "DateTime") {
  //   return (x: Date, y: Date) => x.valueOf() <= y.valueOf();
  // } else if (type.type === "Blob") {
  //   return (x: Uint8Array, y: Uint8Array) => {
  //     const length = x.length < y.length ? x.length : y.length;
  //     for (let i = 0; i < length; i++) {
  //       if (x[i]! < y[i]!) return true;
  //       if (x[i]! > y[i]!) return false;
  //     }
  //     return x.length <= y.length;
  //   }
  // } else if (type.type === "Array") {
  //   const cmp = compareFor(type as EastTypeValue, typeCtx);
  //   return (x: any[], y: any[], ctx?: ValueContext) => cmp(x, y, ctx) <= 0;
  // } else if (type.type === "Set") {
  //   const key_comparer = compareFor(type.value, []);
  //   return (x: Set<any>, y: Set<any>) => {
  //     // co-iterate the two sets (assume they are sorted)
  //     const yiterator = y.keys();
  //     for (const xk of x) {
  //       const yresult = yiterator.next();
  //       if (yresult.done) return false; // if y runs out first, x is greater than y
  //       const yk = yresult.value;
  //       const c = key_comparer(xk, yk);
  //       if (c !== 0) return c === -1;
  //     }
  //     // x ran out first, x <= y if y has same size or more elements
  //     return true;
  //   }
  // } else if (type.type === "Dict") {
  //   const cmp = compareFor(type as EastTypeValue, typeCtx);
  //   return (x: Map<any, any>, y: Map<any, any>, ctx?: ValueContext) => cmp(x, y, ctx) <= 0;
  // } else if (type.type === "Struct") {
  //   const field_comparers: [string, (x: any, y: any, ctx?: ValueContext) => boolean][] = [];
  //   const ret = (x: Record<string, any>, y: Record<string, any>, ctx?: ValueContext) => {
  //     for (const [k, comparer] of field_comparers) {
  //       if (comparer(x[k], y[k], ctx)) return true;
  //       if (comparer(y[k], x[k], ctx)) return false;
  //     }
  //     return true;
  //   };
  //   typeCtx.push(ret);
  //   for (const field of type.value) {
  //     field_comparers.push([field.name, lessFor(field.type, typeCtx)] as const);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Variant") {
  //   const case_comparers: Record<string, (x: any, y: any, ctx?: ValueContext) => boolean> = {};
  //   const ret = (x: variant, y: variant, ctx?: ValueContext) => {
  //     if (x.type < y.type) return true;
  //     if (x.type > y.type) return false;
  //     return case_comparers[x.type]!(x.value, y.value, ctx);
  //   };
  //   typeCtx.push(ret);
  //   for (const { name, type: caseType } of type.value) {
  //     case_comparers[name] = lessEqualFor(caseType, typeCtx);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Recursive") {
  //   const ret = typeCtx[typeCtx.length - Number(type.value.value)];
  //   if (ret === undefined) {
  //     throw new Error(`Internal error: Recursive type context not found`);
  //   }
  //   return ret;
  // } else if (type.type === "Function") {
  //   throw new Error(`Attempted to compare values of type .Function`);
  // } else {
  //   throw new Error(`Unhandled type ${(type satisfies never as EastTypeValue).type}`);
  // }
}

export function greaterEqualFor(type: EastTypeValue, typeCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean
export function greaterEqualFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => boolean
export function greaterEqualFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => boolean {
  const cmp = compareFor(type as any, typeCtx);
  return (x: any, y: any, ctx?: ValueContext) => cmp(x, y, ctx) !== -1;

  // // Convert EastType to EastTypeValue if necessary
  // if (!isVariant(type)) {
  //   type = toEastTypeValue(type);
  // }

  // if (type.type === "Never") {
  //   return (_x: unknown, _y: unknown) => { throw new Error(`Attempted to compare values of type .Never`)};
  // } else if (type.type === "Null") {
  //   return (_x: null, _y: null) => true;
  // } else if (type.type === "Boolean") {
  //   return (x: boolean, y: boolean) => x >= y;
  // } else if (type.type === "Integer") {
  //   return (x: bigint, y: bigint) => x >= y;
  // } else if (type.type === "Float") {
  //   return (x: number, y: number) => Number.isNaN(x) ? true : x >= y;
  // } else if (type.type === "String") {
  //   return (x: string, y: string) => x >= y;
  // } else if (type.type === "DateTime") {
  //   return (x: Date, y: Date) => x.valueOf() >= y.valueOf();
  // } else if (type.type === "Blob") {
  //   return (x: Uint8Array, y: Uint8Array) => {
  //     const length = x.length < y.length ? x.length : y.length;
  //     for (let i = 0; i < length; i++) {
  //       if (x[i]! < y[i]!) return false;
  //       if (x[i]! > y[i]!) return true;
  //     }
  //     return x.length >= y.length;
  //   }
  // } else if (type.type === "Array") {
  //   const cmp = compareFor(type as EastTypeValue, typeCtx);
  //   return (x: any[], y: any[], ctx?: ValueContext) => cmp(x, y, ctx) >= 0;
  // } else if (type.type === "Set") {
  //   const key_comparer = compareFor(type.value, []);
  //   return (x: Set<any>, y: Set<any>) => {
  //     // co-iterate the two sets (assume they are sorted)
  //     const yiterator = y.keys();
  //     for (const xk of x) {
  //       const yresult = yiterator.next();
  //       if (yresult.done) return true; // if y is a prefix of x, x is greater than y
  //       const yk = yresult.value;
  //       const c = key_comparer(xk, yk);
  //       if (c !== 0) return c === 1;
  //     }
  //     // we know x.size >= y.size here
  //     return true;
  //   }
  // } else if (type.type === "Dict") {
  //   const cmp = compareFor(type as EastTypeValue, typeCtx);
  //   return (x: Map<any, any>, y: Map<any, any>, ctx?: ValueContext) => cmp(x, y, ctx) >= 0;
  // } else if (type.type === "Struct") {
  //   const field_comparers: [string, (x: any, y: any, ctx?: ValueContext) => boolean][] = [];
  //   const ret = (x: Record<string, any>, y: Record<string, any>, ctx?: ValueContext) => {
  //     for (const [k, comparer] of field_comparers) {
  //       if (comparer(x[k], y[k], ctx)) return true;
  //       if (comparer(y[k], x[k], ctx)) return false;
  //     }
  //     return true;
  //   };
  //   typeCtx.push(ret);
  //   for (const field of type.value) {
  //     field_comparers.push([field.name, greaterFor(field.type, typeCtx)] as const);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Variant") {
  //   const case_comparers: Record<string, (x: any, y: any, ctx?: ValueContext) => boolean> = {};
  //   const ret = (x: variant, y: variant, ctx?: ValueContext) => {
  //     if (x.type < y.type) return false;
  //     if (x.type > y.type) return true;
  //     return case_comparers[x.type]!(x.value, y.value, ctx);
  //   };
  //   typeCtx.push(ret);
  //   for (const { name, type: caseType } of type.value) {
  //     case_comparers[name] = greaterEqualFor(caseType, typeCtx);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Recursive") {
  //   const ret = typeCtx[typeCtx.length - Number(type.value.value)];
  //   if (ret === undefined) {
  //     throw new Error(`Internal error: Recursive type context not found`);
  //   }
  //   return ret;
  // } else if (type.type === "Function") {
  //   throw new Error(`Attempted to compare values of type .Function`);
  // } else {
  //   throw new Error(`Unhandled type ${(type satisfies never as EastTypeValue).type}`);
  // }
}

export function greaterFor(type: EastTypeValue, typeCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => boolean
export function greaterFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => boolean
export function greaterFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => boolean {
  const cmp = compareFor(type as any, typeCtx);
  return (x: any, y: any, ctx?: ValueContext) => cmp(x, y, ctx) === 1;

  // // Convert EastType to EastTypeValue if necessary
  // if (!isVariant(type)) {
  //   type = toEastTypeValue(type);
  // }

  // if (type.type === "Never") {
  //   return (_x: unknown, _y: unknown) => { throw new Error(`Attempted to compare values of type .Never`)};
  // } else if (type.type === "Null") {
  //   return (_x: null, _y: null) => false;
  // } else if (type.type === "Boolean") {
  //   return (x: boolean, y: boolean) => x > y;
  // } else if (type.type === "Integer") {
  //   return (x: bigint, y: bigint) => x > y;
  // } else if (type.type === "Float") {
  //   return (x: number, y: number) => Number.isNaN(x) ? !Number.isNaN(y) : x > y;
  // } else if (type.type === "String") {
  //   return (x: string, y: string) => x > y;
  // } else if (type.type === "DateTime") {
  //   return (x: Date, y: Date) => x.valueOf() > y.valueOf();
  // } else if (type.type === "Blob") {
  //   return (x: Uint8Array, y: Uint8Array) => {
  //     const length = x.length < y.length ? x.length : y.length;
  //     for (let i = 0; i < length; i++) {
  //       if (x[i]! < y[i]!) return false;
  //       if (x[i]! > y[i]!) return true;
  //     }
  //     return x.length > y.length;
  //   }
  // } else if (type.type === "Array") {
  //   const cmp = compareFor(type as EastTypeValue, typeCtx);
  //   return (x: any[], y: any[], ctx?: ValueContext) => cmp(x, y, ctx) === 1;
  // } else if (type.type === "Set") {
  //   const key_comparer = compareFor(type.value, []);
  //   return (x: Set<any>, y: Set<any>) => {
  //     // co-iterate the two sets (assume they are sorted)
  //     const yiterator = y.keys();
  //     for (const xk of x) {
  //       const yresult = yiterator.next();
  //       if (yresult.done) return true; // if y is a prefix of x, x is greater than y
  //       const yk = yresult.value;
  //       const c = key_comparer(xk, yk);
  //       if (c !== 0) return c === 1;
  //     }
  //     // we know x.size >= y.size here
  //     return x.size > y.size;
  //   }
  // } else if (type.type === "Dict") {
  //   const cmp = compareFor(type as EastTypeValue, typeCtx);
  //   return (x: Map<any, any>, y: Map<any, any>, ctx?: ValueContext) => cmp(x, y, ctx) === 1;
  // } else if (type.type === "Struct") {
  //   const field_comparers: [string, (x: any, y: any, ctx?: ValueContext) => boolean][] = [];
  //   const ret = (x: Record<string, any>, y: Record<string, any>, ctx?: ValueContext) => {
  //     for (const [k, comparer] of field_comparers) {
  //       if (comparer(x[k], y[k], ctx)) return true;
  //       if (comparer(y[k], x[k], ctx)) return false;
  //     }
  //     return false;
  //   };
  //   typeCtx.push(ret);
  //   for (const field of type.value) {
  //     field_comparers.push([field.name, greaterFor(field.type, typeCtx)] as const);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Variant") {
  //   const case_comparers: Record<string, (x: any, y: any, ctx?: ValueContext) => boolean> = {};
  //   const ret = (x: variant, y: variant, ctx?: ValueContext) => {
  //     if (x.type < y.type) return false;
  //     if (x.type > y.type) return true;
  //     return case_comparers[x.type]!(x.value, y.value, ctx);
  //   };
  //   typeCtx.push(ret);
  //   for (const { name, type: caseType } of type.value) {
  //     case_comparers[name] = greaterFor(caseType, typeCtx);
  //   }
  //   typeCtx.pop();
  //   return ret;
  // } else if (type.type === "Recursive") {
  //   const ret = typeCtx[typeCtx.length - Number(type.value.value)];
  //   if (ret === undefined) {
  //     throw new Error(`Internal error: Recursive type context not found`);
  //   }
  //   return ret;
  // } else if (type.type === "Function") {
  //   throw new Error(`Attempted to compare values of type .Function`);
  // } else {
  //   throw new Error(`Unhandled type ${(type satisfies never as EastTypeValue).type}`);
  // }
}

export function compareFor(type: EastTypeValue, typeCtx?: TypeContext): (x: any, y: any, ctx?: ValueContext) => 1 | 0 | -1
export function compareFor<T extends EastType>(type: T): (x: ValueTypeOf<T>, y: ValueTypeOf<T>) => 1 | 0 | -1
export function compareFor(type: EastTypeValue | EastType, typeCtx: TypeContext = new Map()): (x: any, y: any, ctx?: ValueContext) => 1 | 0 | -1 {
  // Convert EastType to EastTypeValue if necessary
  if (!isVariant(type)) {
    type = toEastTypeValue(type as EastType);
  }

  if (type.type === "Never") {
    return (_x: unknown, _y: unknown, _ctx?: ValueContext) => { throw new Error(`Attempted to compare values of type .Never`) };
  } else if (type.type === "Null") {
    return (_x: null, _y: null, _ctx?: ValueContext) => 0;
  } else if (type.type === "Boolean") {
    return (x: boolean, y: boolean, _ctx?: ValueContext) => x ? (y ? 0 : 1) : (y ? -1 : 0);
  } else if (type.type === "Integer") {
    return (x: bigint, y: bigint, _ctx?: ValueContext) => x < y ? -1 : (x > y ? 1 : 0);
  } else if (type.type === "Float") {
    return (x: number, y: number, _ctx?: ValueContext) => {
      if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : 1;
      if (Number.isNaN(y)) return -1;
      if (Object.is(x, -0) && Object.is(y, 0)) return -1;
      if (Object.is(x, 0) && Object.is(y, -0)) return 1;
      return x < y ? -1 : (x > y ? 1 : 0);
    };
  } else if (type.type === "String") {
    return (x: string, y: string, _ctx?: ValueContext) => x < y ? -1 : (x > y ? 1 : 0);
  } else if (type.type === "DateTime") {
    return (x: Date, y: Date, _ctx?: ValueContext) => x.valueOf() < y.valueOf() ? -1 : (x.valueOf() > y.valueOf() ? 1 : 0);
  } else if (type.type === "Blob") {
    return (x: Uint8Array, y: Uint8Array, _ctx?: ValueContext) => {
      const length = x.length < y.length ? x.length : y.length;
      for (let i = 0; i < length; i++) {
        if (x[i]! < y[i]!) return -1;
        if (x[i]! > y[i]!) return 1;
      }
      return x.length < y.length ? -1 : (x.length > y.length ? 1 : 0);
    }
  } else if (type.type === "Vector") {
    const elemCompare = compareFor(type.value, typeCtx);
    return (x: any, y: any, _ctx?: ValueContext) => {
      if (Object.is(x, y)) return 0;
      const length = x.length < y.length ? x.length : y.length;
      for (let i = 0; i < length; i++) {
        const cmp = elemCompare(x[i], y[i]);
        if (cmp !== 0) return cmp;
      }
      return x.length < y.length ? -1 : (x.length > y.length ? 1 : 0);
    };
  } else if (type.type === "Matrix") {
    const elemCompare = compareFor(type.value, typeCtx);
    return (x: any, y: any, _ctx?: ValueContext) => {
      if (Object.is(x, y)) return 0;
      // Compare by rows, cols, then data
      if (x.rows < y.rows) return -1;
      if (x.rows > y.rows) return 1;
      if (x.cols < y.cols) return -1;
      if (x.cols > y.cols) return 1;
      const xd = x.data;
      const yd = y.data;
      for (let i = 0; i < xd.length; i++) {
        const cmp = elemCompare(xd[i], yd[i]);
        if (cmp !== 0) return cmp;
      }
      return 0;
    };
  } else if (type.type === "Ref") {
    let value_comparer: (x: any, y: any, ctx?: ValueContext) => 1 | 0 | -1;
    const ret = (x: ref<any>, y: ref<any>, ctx?: ValueContext) => {
      // Fast path
      if (Object.is(x, y)) return 0;

      // Create context if needed (top-level call)
      if (!ctx) {
        ctx = new Map();
      }

      // Check if we've visited this pair
      const xSet = ctx.get(x);
      if (xSet?.has(y)) {
        return 0; // Cycle - we're re-encountering this pair
      }

      // Mark as visited
      let visitedSet = ctx.get(x);
      if (!visitedSet) {
        visitedSet = new Set();
        ctx.set(x, visitedSet);
      }
      visitedSet.add(y);

      // Now do the actual comparison
      return value_comparer(x.value, y.value, ctx);
    };
    value_comparer = compareFor(type.value, typeCtx);
    return ret;
  } else if (type.type === "Array") {
    let value_comparer: (x: any, y: any, ctx?: ValueContext) => 1 | 0 | -1;
    const ret = (x: any[], y: any[], ctx?: ValueContext) => {
      // Fast path
      if (Object.is(x, y)) return 0;

      // Create context if needed (top-level call)
      if (!ctx) {
        ctx = new Map();
      }

      // Check if we've visited this pair
      const xSet = ctx.get(x);
      if (xSet?.has(y)) {
        return 0; // Cycle - we're re-encountering this pair
      }

      // Mark as visited
      let visitedSet = ctx.get(x);
      if (!visitedSet) {
        visitedSet = new Set();
        ctx.set(x, visitedSet);
      }
      visitedSet.add(y);

      // Now do the actual comparison
      const length = x.length < y.length ? x.length : y.length;
      for (let i = 0; i < length; i++) {
        const c = value_comparer(x[i], y[i], ctx);
        if (c !== 0) return c;
      }
      return x.length > y.length ? 1 : x.length < y.length ? -1 : 0;
    };
    value_comparer = compareFor(type.value, typeCtx);
    return ret;
  } else if (type.type === "Set") {
    // Set keys cannot contain mutable containers, so no cycles possible
    const key_comparer = compareFor(type.value, typeCtx);
    return (x: Set<any>, y: Set<any>, _ctx?: ValueContext) => {
      // Fast path
      if (Object.is(x, y)) return 0;

      // co-iterate the two sets (assume they are sorted)
      const yiterator = y.keys();
      for (const xk of x) {
        const yresult = yiterator.next();
        if (yresult.done) return 1; // if y runs out first, x is greater than y
        const yk = yresult.value;
        const c = key_comparer(xk, yk); // keys are standalone, no ctx needed
        if (c !== 0) return c;
      }
      // x ran out first, compare sizes: if y has more elements, x < y
      return yiterator.next().done ? 0 : -1;
    };
  } else if (type.type === "Dict") {
    // Dict keys cannot contain mutable containers, but values can
    const key_comparer = compareFor(type.value.key, typeCtx);
    let value_comparer: (x: any, y: any, ctx?: ValueContext) => 1 | 0 | -1;
    const ret = (x: Map<any, any>, y: Map<any, any>, ctx?: ValueContext) => {
      // Fast path
      if (Object.is(x, y)) return 0;

      // Create context if needed (top-level call)
      if (!ctx) {
        ctx = new Map();
      }

      // Check if we've visited this pair
      const xSet = ctx.get(x);
      if (xSet?.has(y)) {
        return 0; // Cycle - we're re-encountering this pair
      }

      // Mark as visited
      let visitedSet = ctx.get(x);
      if (!visitedSet) {
        visitedSet = new Set();
        ctx.set(x, visitedSet);
      }
      visitedSet.add(y);

      // Now do the actual comparison
      // co-iterate the two maps (assume they are sorted by key)
      const yiterator = y.entries();
      for (const [xk, xv] of x) {
        const yresult = yiterator.next();
        if (yresult.done) return 1; // if y is a prefix of x, x is greater than y
        const [yk, yv] = yresult.value;
        const kc = key_comparer(xk, yk); // keys are standalone, no ctx needed
        if (kc !== 0) return kc;
        const vc = value_comparer(xv, yv, ctx); // values can have cycles
        if (vc !== 0) return vc;
      }
      // x ran out first, compare sizes: if y has more elements, x < y
      return yiterator.next().done ? 0 : -1;
    };
    value_comparer = compareFor(type.value.value, typeCtx);
    return ret;
  } else if (type.type === "Struct") {
    const field_comparers: [string, (x: any, y: any, ctx?: ValueContext) => 1 | 0 | -1][] = [];
    const ret = (x: Record<string, any>, y: Record<string, any>, ctx?: ValueContext) => {
      for (const [k, comparer] of field_comparers) {
        const c = comparer(x[k], y[k], ctx);
        if (c !== 0) return c;
      }
      return 0;
    };
    for (const field of type.value) {
      field_comparers.push([field.name, compareFor(field.type, typeCtx)] as const);
    }
    return ret;
  } else if (type.type === "Variant") {
    const case_comparers: Record<string, (x: any, y: any, ctx?: ValueContext) => 1 | 0 | -1> = {};
    const ret = (x: variant, y: variant, ctx?: ValueContext) => {
      if (x.type < y.type) return -1;
      if (x.type > y.type) return 1;

      return case_comparers[x.type]!(x.value, y.value, ctx);
    };
    for (const { name, type: caseType } of type.value) {
      case_comparers[name] = compareFor(caseType, typeCtx);
    }
    return ret;
  } else if (type.type === "Recursive" && (type.value as any).type === "wrapper") {
    let inner: (x: any, y: any, ctx?: ValueContext) => 0 | 1 | -1;
    const ret = (x: any, y: any, ctx?: ValueContext): 0 | 1 | -1 => inner(x, y, ctx);
    typeCtx.set((type.value as any).value.id as bigint, ret as any);
    inner = compareFor((type.value as any).value.inner, typeCtx);
    return ret;
  } else if (type.type === "Recursive") {
    const ret = typeCtx.get((type.value as any).value as bigint) as any;
    if (ret === undefined) {
      throw new Error(`Internal error: Recursive type context not found`);
    }
    return ret;
  } else if (type.type === "Function") {
    return (_x: any, _y: any, _ctx?: ValueContext | undefined) => {
      return 0; // Functions are always considered equal
    };
  } else if (type.type === "AsyncFunction") {
    return (_x: any, _y: any, _ctx?: ValueContext | undefined) => {
      return 0; // Functions are always considered equal
    };
  } else {
    throw new Error(`Unhandled type ${(type satisfies never as EastTypeValue).type}`);
  }
}