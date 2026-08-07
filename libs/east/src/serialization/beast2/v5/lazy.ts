/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lazy pager-backed collection values.
 *
 * {@link openBeast2LazyFor} opens an indexed v5 collection blob as an
 * ordinary East runtime value — a `SortedMap`, `SortedSet`, or array — whose
 * cheap operations are served from the blob's segment index without decoding
 * the whole collection:
 *
 * - `size` / `length` come from the index (O(1)),
 * - iteration streams one decoded segment at a time (O(segment) memory),
 * - keyed lookups (`get` / `has`, Array index reads) decode one segment via
 *   the fence index,
 *
 * and every other operation — mutation, set algebra, range iteration —
 * transparently hydrates the container (the whole-decode that would have
 * happened anyway) and then behaves exactly like the eager value. Object
 * identity is stable across hydration, so host-side iteration locks and
 * freezes keyed on the value keep working.
 *
 * This is what lets a task runner open a huge collection input lazily: a
 * body that only iterates it once, or reads a few keys, never pays the whole
 * decode — while a body that does anything else gets the eager value's exact
 * semantics.
 */

import { type EastTypeValue } from "../../../type_of_type.js";
import type { EastType, ValueTypeOf } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap } from "../../../containers/sortedmap.js";
import { SortedSet } from "../../../containers/sortedset.js";
import { type Beast2DecodeOptions } from "../shared.js";
import { asTypeValue } from "./type-section.js";
import { isSegmentedRoot } from "./codec.js";
import { Beast2Pages } from "./stream.js";

/** The canonical-order violation error, matching the eager decoders. */
function disjointError(kind: "Set" | "Dict", i: number): Error {
  return new Error(`beast2 v5: segments ${i - 1} and ${i} are not disjoint ascending ${kind === "Dict" ? "key" : "element"} ranges — the wire must hold the canonical value (corrupt or pre-contract blob)`);
}

/** Streams a Dict blob's entries segment by segment in canonical order,
 *  validating the cross-segment ascent the eager decoder enforces. */
function* lazyDictEntries<K, V>(pages: Beast2Pages, cmp: (a: K, b: K) => number): Generator<[K, V]> {
  let prev: K | undefined;
  let has = false;
  for (let i = 0; i < pages.segmentCount; i++) {
    const segment = pages.segment(i) as Map<K, V>;
    for (const [k, v] of segment) {
      if (has && cmp(prev as K, k) >= 0) throw disjointError("Dict", i);
      prev = k;
      has = true;
      yield [k, v];
    }
  }
}

/** Streams a Set blob's elements segment by segment in canonical order,
 *  validating the cross-segment ascent the eager decoder enforces. */
function* lazySetKeys<K>(pages: Beast2Pages, cmp: (a: K, b: K) => number): Generator<K> {
  let prev: K | undefined;
  let has = false;
  for (let i = 0; i < pages.segmentCount; i++) {
    const segment = pages.segment(i) as Set<K>;
    for (const k of segment) {
      if (has && cmp(prev as K, k) >= 0) throw disjointError("Set", i);
      prev = k;
      has = true;
      yield k;
    }
  }
}

/**
 * A {@link SortedMap} served lazily from an indexed blob.
 *
 * Reads (`size`, `get`, `has`, whole-collection iteration, `minKey`,
 * `maxKey`) are answered from the pager; anything else hydrates first. Not
 * constructed directly — see {@link openBeast2LazyFor}.
 */
class LazySortedMap<K, V> extends SortedMap<K, V> {
  private hydrated = false;

  constructor(private readonly pages: Beast2Pages, private readonly cmp: (a: K, b: K) => number) {
    super(undefined, cmp);
  }

  /** Decodes every segment into the underlying B-tree once. */
  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const [k, v] of lazyDictEntries<K, V>(this.pages, this.cmp)) {
      super.set(k, v);
    }
  }

  override get size(): number {
    return this.hydrated ? super.size : this.pages.elementCount;
  }

  override get(key: K): V | undefined {
    if (this.hydrated) return super.get(key);
    if (this.pages.elementCount === 0) return undefined;
    return this.pages.get(key as never) as V | undefined;
  }

  override has(key: K): boolean {
    return this.hydrated ? super.has(key) : this.get(key) !== undefined;
  }

  override set(key: K, value: V): this {
    this.hydrate();
    return super.set(key, value);
  }

  override delete(key: K): boolean {
    this.hydrate();
    return super.delete(key);
  }

  override clear(): void {
    // Skip decoding just to discard it — an empty tree plus the hydrated
    // flag IS the cleared state.
    if (Object.isFrozen(this)) {
      throw new TypeError("Cannot modify frozen SortedMap");
    }
    this.hydrated = true;
    super.clear();
  }

  override forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    if (this.hydrated) {
      super.forEach(callbackfn, thisArg);
      return;
    }
    for (const [k, v] of lazyDictEntries<K, V>(this.pages, this.cmp)) {
      callbackfn.call(thisArg, v, k, this);
    }
  }

  override minKey(): K | undefined {
    if (this.hydrated) return super.minKey();
    if (this.pages.elementCount === 0) return undefined;
    return this.pages.fence(0) as K;
  }

  override maxKey(): K | undefined {
    if (this.hydrated) return super.maxKey();
    const n = this.pages.segmentCount;
    if (n === 0) return undefined;
    let last: K | undefined;
    for (const k of (this.pages.segment(n - 1) as Map<K, V>).keys()) last = k;
    return last;
  }

  override keys(firstKey?: K): MapIterator<K> {
    if (!this.hydrated && firstKey === undefined) {
      const pages = this.pages;
      const cmp = this.cmp;
      return Iterator.from((function* () {
        for (const [k] of lazyDictEntries<K, V>(pages, cmp)) yield k;
      })()) as MapIterator<K>;
    }
    this.hydrate();
    return super.keys(firstKey);
  }

  override values(firstKey?: K): MapIterator<V> {
    if (!this.hydrated && firstKey === undefined) {
      const pages = this.pages;
      const cmp = this.cmp;
      return Iterator.from((function* () {
        for (const [, v] of lazyDictEntries<K, V>(pages, cmp)) yield v;
      })()) as MapIterator<V>;
    }
    this.hydrate();
    return super.values(firstKey);
  }

  override entries(firstKey?: K): MapIterator<[K, V]> {
    if (!this.hydrated && firstKey === undefined) {
      return Iterator.from(lazyDictEntries<K, V>(this.pages, this.cmp)) as MapIterator<[K, V]>;
    }
    this.hydrate();
    return super.entries(firstKey);
  }

  override [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }
}

/**
 * A {@link SortedSet} served lazily from an indexed blob.
 *
 * Reads (`size`, `has`, whole-collection iteration, `minKey`, `maxKey`) are
 * answered from the pager; anything else — including the set-algebra methods,
 * which walk the underlying B-tree directly — hydrates first. Not
 * constructed directly — see {@link openBeast2LazyFor}.
 */
class LazySortedSet<K> extends SortedSet<K> {
  private hydrated = false;

  constructor(private readonly pages: Beast2Pages, private readonly cmp: (a: K, b: K) => number) {
    super(undefined, cmp);
  }

  /** Decodes every segment into the underlying B-tree once. */
  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const k of lazySetKeys<K>(this.pages, this.cmp)) {
      super.add(k);
    }
  }

  override get size(): number {
    return this.hydrated ? super.size : this.pages.elementCount;
  }

  override has(key: K): boolean {
    if (this.hydrated) return super.has(key);
    if (this.pages.elementCount === 0) return false;
    return this.pages.get(key as never) !== undefined;
  }

  override add(key: K): this {
    this.hydrate();
    return super.add(key);
  }

  override delete(key: K): boolean {
    this.hydrate();
    return super.delete(key);
  }

  override clear(): void {
    // Skip decoding just to discard it — an empty tree plus the hydrated
    // flag IS the cleared state.
    if (Object.isFrozen(this)) {
      throw new TypeError("Cannot modify frozen SortedSet");
    }
    this.hydrated = true;
    super.clear();
  }

  override forEach(callbackfn: (value: K, value2: K, set: Set<K>) => void, thisArg?: unknown): void {
    if (this.hydrated) {
      super.forEach(callbackfn, thisArg);
      return;
    }
    for (const k of lazySetKeys<K>(this.pages, this.cmp)) {
      callbackfn.call(thisArg, k, k, this);
    }
  }

  override union<U>(other: ReadonlySetLike<U>): SortedSet<K | U> {
    this.hydrate();
    return super.union(other);
  }

  override intersection<U>(other: ReadonlySetLike<U>): SortedSet<K & U> {
    this.hydrate();
    return super.intersection(other);
  }

  override difference<U>(other: ReadonlySetLike<U>): SortedSet<K> {
    this.hydrate();
    return super.difference(other);
  }

  override symmetricDifference<U>(other: ReadonlySetLike<U>): SortedSet<K | U> {
    this.hydrate();
    return super.symmetricDifference(other);
  }

  override isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
    this.hydrate();
    return super.isSubsetOf(other);
  }

  override isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
    this.hydrate();
    return super.isSupersetOf(other);
  }

  override isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
    this.hydrate();
    return super.isDisjointFrom(other);
  }

  override minKey(): K | undefined {
    if (this.hydrated) return super.minKey();
    if (this.pages.elementCount === 0) return undefined;
    return this.pages.fence(0) as K;
  }

  override maxKey(): K | undefined {
    if (this.hydrated) return super.maxKey();
    const n = this.pages.segmentCount;
    if (n === 0) return undefined;
    let last: K | undefined;
    for (const k of this.pages.segment(n - 1) as Set<K>) last = k;
    return last;
  }

  override keys(firstKey?: K): SetIterator<K> {
    if (!this.hydrated && firstKey === undefined) {
      return Iterator.from(lazySetKeys<K>(this.pages, this.cmp)) as SetIterator<K>;
    }
    this.hydrate();
    return super.keys(firstKey);
  }

  override values(firstKey?: K): SetIterator<K> {
    return this.keys(firstKey);
  }

  override entries(firstKey?: K): SetIterator<[K, K]> {
    if (!this.hydrated && firstKey === undefined) {
      const pages = this.pages;
      const cmp = this.cmp;
      return Iterator.from((function* () {
        for (const k of lazySetKeys<K>(pages, cmp)) yield [k, k] as [K, K];
      })()) as SetIterator<[K, K]>;
    }
    this.hydrate();
    return super.entries(firstKey);
  }

  override [Symbol.iterator](): SetIterator<K> {
    return this.keys();
  }
}

/** Array method names that stream from the pager without hydrating. */
const LAZY_ARRAY_READS = new Set<PropertyKey>(["entries", "keys", "values", "forEach", Symbol.iterator]);

/** Builds a lazy Array value as a proxy over a real (initially empty)
 *  array: `length`, index reads and single-pass iteration are served from
 *  the pager; any other access hydrates the target array in place. The
 *  proxy IS the value, so identity-keyed host state (iteration locks,
 *  freezes) survives hydration. */
function lazyArray(pages: Beast2Pages): unknown[] {
  const target: unknown[] = [];
  let hydrated = false;
  const hydrate = (): void => {
    if (hydrated) return;
    hydrated = true;
    for (let i = 0; i < pages.segmentCount; i++) {
      // Element-by-element append — a spread (`push(...segment)`) passes the
      // segment as arguments and overflows the engine's argument limit on
      // ~100k+-element segments.
      for (const item of pages.segment(i) as unknown[]) target.push(item);
    }
  };
  function* elements(): Generator<unknown> {
    for (let i = 0; i < pages.segmentCount; i++) {
      yield* pages.segment(i) as unknown[];
    }
  }
  const lazyReads: Record<PropertyKey, unknown> = {
    [Symbol.iterator]: function* () { yield* elements(); },
    entries: function* () {
      let i = 0;
      for (const v of elements()) yield [i++, v] as [number, unknown];
    },
    keys: function* () {
      for (let i = 0; i < pages.elementCount; i++) yield i;
    },
    values: function* () { yield* elements(); },
    forEach: (callbackfn: (value: unknown, index: number, array: unknown[]) => void, thisArg?: unknown) => {
      let i = 0;
      for (const v of elements()) callbackfn.call(thisArg, v, i++, proxy);
    },
  };
  const proxy: unknown[] = new Proxy(target, {
    get(t, prop, receiver) {
      if (!hydrated) {
        if (prop === "length") return pages.elementCount;
        if (LAZY_ARRAY_READS.has(prop)) return lazyReads[prop];
        if (typeof prop === "string") {
          // Only canonical index strings are element reads — `""`, `"01"`,
          // `" 2"` or `"1e2"` are ordinary (absent) properties on an eager
          // array, and must stay so here.
          const row = Number(prop);
          if (Number.isInteger(row) && row >= 0 && String(row) === prop) {
            return row < pages.elementCount ? pages.element(row) : undefined;
          }
        }
        hydrate();
      }
      return Reflect.get(t, prop, receiver);
    },
    set(t, prop, value, receiver) {
      hydrate();
      return Reflect.set(t, prop, value, receiver);
    },
    has(t, prop) {
      hydrate();
      return Reflect.has(t, prop);
    },
    ownKeys(t) {
      hydrate();
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, prop) {
      hydrate();
      return Reflect.getOwnPropertyDescriptor(t, prop);
    },
    defineProperty(t, prop, attributes) {
      hydrate();
      return Reflect.defineProperty(t, prop, attributes);
    },
    deleteProperty(t, prop) {
      hydrate();
      return Reflect.deleteProperty(t, prop);
    },
  });
  return proxy;
}

/**
 * Builds a curried lazy opener: `open(data)` returns an ordinary collection
 * value — a `SortedMap`, `SortedSet`, or array — backed by the blob's
 * segment index instead of a whole decode.
 *
 * Size, single-pass iteration, and keyed reads are served lazily with
 * O(segment) decoded memory; every other operation transparently hydrates
 * the value (equivalent to the whole decode) and proceeds with eager
 * semantics, so the lazy value is observationally identical to
 * `decodeBeast2For(type)(data)`.
 *
 * @param type - the collection type (Array/Set/Dict)
 * @param options - decode options (platform functions for decoded functions)
 * @returns a function opening a blob as a lazy collection value
 * @throws {TypeError} When `type` is not an Array, Set or Dict type.
 */
export function openBeast2LazyFor<T extends EastType>(type: T | EastTypeValue, options?: Beast2DecodeOptions): (data: Uint8Array) => ValueTypeOf<T> {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) {
    throw new TypeError(`beast2 v5 lazy values hold Array, Set or Dict roots, not ${typeValue.type}`);
  }
  return (data: Uint8Array) => {
    const pages = new Beast2Pages(data, typeValue, options);
    if (typeValue.type === "Array") {
      return lazyArray(pages) as ValueTypeOf<T>;
    }
    if (typeValue.type === "Set") {
      const cmp = compareFor((typeValue as any).value) as (a: unknown, b: unknown) => number;
      return new LazySortedSet(pages, cmp) as ValueTypeOf<T>;
    }
    const cmp = compareFor((typeValue as any).value.key) as (a: unknown, b: unknown) => number;
    return new LazySortedMap(pages, cmp) as ValueTypeOf<T>;
  };
}

/** Whether every value of `type` is value-semantic under the lazy contract:
 *  no East-mutable container (Array/Set/Dict/Ref) and no identity-compared
 *  or state-carrying kind (Vector/Matrix, whose `is()` is object identity;
 *  functions, whose captured environment can hold mutable state).
 *  Structs/variants/scalars compare by value and have no in-place mutation
 *  builtins, so a fresh pager-served decode of them is unobservable. */
function isLazySafeElement(type: EastTypeValue): boolean {
  switch (type.type) {
    case "Never":
    case "Null":
    case "Boolean":
    case "Integer":
    case "Float":
    case "String":
    case "DateTime":
    case "Blob":
      return true;
    case "Struct":
    case "Variant":
      return (type.value as { name: string; type: EastTypeValue }[]).every((f) => isLazySafeElement(f.type));
    case "Recursive":
      // A wrapper's content is checked once; a back-reference re-enters a
      // level already on the checked path, so it adds nothing new.
      return type.value.type === "wrapper" ? isLazySafeElement((type.value.value as { inner: EastTypeValue }).inner) : true;
    default:
      // Array/Set/Dict/Ref (mutation through a read-out element would be
      // dropped), Vector/Matrix (`is()` observes decode identity),
      // Function/AsyncFunction (captured mutable state) — eager only.
      return false;
  }
}

/**
 * Decides whether a collection type may be opened lazily
 * ({@link openBeast2LazyFor}) with eager-equivalent semantics.
 *
 * A lazy value serves element reads as fresh decodes from the blob, and
 * East's runtime is reference-semantic for nested containers — so an element
 * shape that East can mutate in place (transitively containing an Array, Set,
 * Dict or Ref) must be decoded eagerly, or writes through a read-out element
 * would be silently dropped. Vector/Matrix and function elements are also
 * excluded: `is()` compares them by object identity, which fresh decodes
 * (and hydration) would change, and a decoded closure re-creates any mutable
 * state it captured. Scalar, struct and variant element shapes are safe —
 * they compare by value and have no in-place mutation builtins.
 *
 * Runners consult this before opening a large input lazily; an unsafe shape
 * falls back to the eager whole decode (always correct, just not O(segment)).
 *
 * @param type - the candidate input type
 * @returns `true` when the type is an Array, Set or Dict whose element (and
 *   key) shapes make lazy opening observationally equivalent to the eager
 *   decode; `false` otherwise, including for non-collection roots
 *
 * @example
 * ```ts
 * isBeast2LazySafe(DictType(IntegerType, StructType({ id: IntegerType })));  // true
 * isBeast2LazySafe(DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) })));  // false — nested mutation
 * isBeast2LazySafe(StringType);  // false — not a collection root
 * ```
 */
export function isBeast2LazySafe(type: EastType | EastTypeValue): boolean {
  const typeValue = asTypeValue(type);
  if (!isSegmentedRoot(typeValue)) return false;
  if (typeValue.type === "Dict") {
    const dict = (typeValue as any).value as { key: EastTypeValue; value: EastTypeValue };
    return isLazySafeElement(dict.key) && isLazySafeElement(dict.value);
  }
  return isLazySafeElement((typeValue as any).value as EastTypeValue);
}
