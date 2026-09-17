/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @remarks
 */

import {
  type EastType,
  type RecursiveTypeMarker,
  type ValueTypeOf,
  NullType,
  BooleanType,
  IntegerType,
  FloatType,
  StringType,
  DateTimeType,
  BlobType,
  ArrayType,
  SetType,
  DictType,
  StructType,
  VariantType,
  OptionType,
  RecursiveType,
  FunctionType,
  RefType,
  VectorType,
  MatrixType,
} from "./types.js";
import { matrix } from "./containers/matrix.js";
import { SortedSet } from "./containers/sortedset.js";
import { SortedMap } from "./containers/sortedmap.js";
import { compareFor } from "./comparison.js";
import { isVariant, variant } from "./containers/variant.js";
import { printType } from "./types.js";
import { printFor } from "./serialization/east.js";
import { toEastTypeValue, EastTypeType, EastTypeValueType, type EastTypeValue } from "./type_of_type.js";
import { ref } from "./containers/ref.js";
import { BufferWriter } from "./serialization/binary-utils.js";
import { writeTypeSection } from "./serialization/beast2/v5/type-section.js";
import { fnv1a64 } from "./serialization/beast2/shared.js";

/** Deterministic PRNG state (mulberry32). The fuzz output is a cross-runtime
 * REPLAY corpus: east-c and east-py compliance and the eager-replay pins all
 * key on the generated suite names, so generation must reproduce byte-for-byte
 * across exports. Reseed with {@link seedFuzz}; mint a fresh corpus by bumping
 * the seed deliberately, never by reverting to `Math.random`. */
let fuzzState = 0xea57 | 0;

function random(): number {
  fuzzState = (fuzzState + 0x6d2b79f5) | 0;
  let t = Math.imul(fuzzState ^ (fuzzState >>> 15), 1 | fuzzState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Reseeds the fuzz generator's deterministic random stream.
 *
 * Call at the start of a generation run so the produced types and values are
 * reproducible regardless of what consumed the stream before.
 *
 * @param seed - the stream seed; equal seeds reproduce equal output
 */
export function seedFuzz(seed: number): void {
  fuzzState = seed | 0;
}

/**
 * Generates a random primitive East type.
 */
function randomPrimitiveType(): EastType {
  const r = random() * 7;
  if (r < 1) return NullType;
  if (r < 2) return BooleanType;
  if (r < 3) return IntegerType;
  if (r < 4) return FloatType;
  if (r < 5) return StringType;
  if (r < 6) return DateTimeType;
  return BlobType;
}

/** Options for {@link randomType}. */
export interface RandomTypeOptions {
  /** Recursive types at the top level (default `true`). */
  includeRecursive?: boolean;
  /** Function types (default `true`). */
  includeFunctions?: boolean;
  /**
   * Recursion below the top level (default `false`): a closed recursive type
   * as a field, element or case at any depth; a recursive type shared by
   * several fields of one struct (so `Array<T>` may be reached before `T`,
   * the shape whose beast2 type table was not canonical — #770); and
   * recursive bodies drawn at random rather than from the fixed patterns of
   * {@link randomRecursiveType}, nested recursive types included.
   */
  nestedRecursive?: boolean;
  /**
   * `EastTypeType` as a leaf (default `false`): a type whose values are type
   * values — the shape every IR annotation and every e3 dataset type
   * travels as. Values are random values of that variant, generated like any
   * other recursive variant's.
   */
  includeTypeValues?: boolean;
}

/** The options a child position inherits: no top-level-only kinds. */
function childOptions(options: RandomTypeOptions): RandomTypeOptions {
  return {
    includeRecursive: false,
    includeFunctions: false,
    nestedRecursive: options.nestedRecursive ?? false,
    includeTypeValues: options.includeTypeValues ?? false,
  };
}

/**
 * Generates a random East type for fuzz testing.
 *
 * @param depth - Current nesting depth (used internally to limit recursion)
 * @param options - Configuration options
 * @returns A randomly generated {@link EastType}
 *
 * @remarks
 * Types are kept reasonably simple to avoid generating huge nested structures:
 * - Maximum nesting depth of 3 levels
 * - Higher chance of primitives at deeper levels
 * - Sets and Dicts use {@link StringType} keys (immutability constraint)
 * - Structs have 0-4 random fields
 * - Variants have 1-3 random cases, with 30% chance of {@link OptionType}
 * - Recursive types include linked lists, trees, and option-wrapped patterns
 *   (and, with `nestedRecursive`, random bodies, nested and shared recursion)
 * - Function types have 0-3 arguments with random input/output types
 *
 * The random stream is consumed identically whatever the options, except by
 * the branches an option enables, so an existing corpus keeps its shapes when
 * a new option stays off.
 */
export function randomType(
  depth: number = 0,
  options: RandomTypeOptions = {}
): EastType {
  const { includeRecursive = true, includeFunctions = true, nestedRecursive = false, includeTypeValues = false } = options;
  const child = childOptions(options);

  // Limit nesting to avoid stack overflow and keep tests fast
  const maxDepth = 3;

  // Higher chance of primitives at deeper levels
  const primitiveWeight = depth >= maxDepth ? 0.9 : 0.5;

  if (random() < primitiveWeight) {
    if (includeTypeValues && random() < 0.15) return EastTypeType;
    return randomPrimitiveType();
  }

  // Complex type - weights adjusted based on options
  let totalWeight = 7; // Array, Set, Dict, Struct, Variant, Vector, Matrix
  if (includeRecursive && depth === 0) totalWeight += 1; // Recursive only at top level
  if (includeFunctions) totalWeight += 1;
  const nestedWeight = nestedRecursive ? (depth === 0 ? 2 : 1) : 0; // closed leaf (+ shared struct at the top)

  const r = random() * (totalWeight + nestedWeight);

  if (r < 1) {
    // Array
    return ArrayType(randomType(depth + 1, child));
  } else if (r < 2) {
    // Set (keys must be immutable)
    return SetType(StringType);
  } else if (r < 3) {
    // Dict (keys must be immutable)
    return DictType(StringType, randomType(depth + 1, child));
  } else if (r < 4) {
    // Struct with 0-4 fields
    const fieldCount = Math.floor(random() * 5);
    const fields: Record<string, EastType> = {};
    for (let i = 0; i < fieldCount; i++) {
      fields[`field${i}`] = randomType(depth + 1, child);
    }
    return StructType(fields);
  } else if (r < 5) {
    // Variant
    if (random() < 0.3) {
      // Option type (common variant pattern)
      return OptionType(randomType(depth + 1, child));
    } else {
      // Custom variant with 1-3 cases
      const caseCount = 1 + Math.floor(random() * 3);
      const cases: Record<string, EastType> = {};
      for (let i = 0; i < caseCount; i++) {
        cases[`case${i}`] = randomType(depth + 1, child);
      }
      return VariantType(cases);
    }
  } else if (r < 6) {
    // Vector with random numeric element type
    const elemTypes = [FloatType, IntegerType, BooleanType];
    return VectorType(elemTypes[Math.floor(random() * elemTypes.length)]!);
  } else if (r < 7) {
    // Matrix with random numeric element type
    const elemTypes = [FloatType, IntegerType, BooleanType];
    return MatrixType(elemTypes[Math.floor(random() * elemTypes.length)]!);
  } else if (r < 8 && includeRecursive && depth === 0) {
    // Recursive type at the top level
    return randomRecursiveType({ randomBody: nestedRecursive });
  } else if (r < totalWeight && includeFunctions) {
    // Function type
    return randomFunctionType();
  } else if (r < totalWeight + 1) {
    // A closed recursive type as a leaf below the top level
    return randomRecursiveType({ randomBody: true });
  } else {
    // One recursive type shared by several fields
    return randomSharedRecursiveType();
  }
}

/**
 * Generates a random recursive type pattern.
 *
 * @param options - `randomBody` (default `false`) draws the body at random
 *   half of the time instead of from the fixed patterns below: a struct or
 *   variant whose self-references sit under Array, Option, Dict, Ref or a
 *   struct, with a nested closed recursive type or a type value as a leaf
 *   now and then, and always with a terminating path.
 * @returns A randomly generated {@link RecursiveType}
 *
 * @remarks
 * Generates common recursive patterns:
 * - Linked list: `rec t. <nil: Null, cons: (head: T, tail: t)>`
 * - Tree: `rec t. (value: T, children: Array<t>)`
 * - Option chain: `rec t. (value: T, next: Option<t>)`
 * - Binary tree: `rec t. <leaf: T, node: (left: t, right: t)>`
 * - Nested variant: `rec t. <a: T, b: (inner: t)>`
 */
export function randomRecursiveType(options: { randomBody?: boolean } = {}): EastType {
  if (options.randomBody && random() < 0.5) {
    return RecursiveType((self) => randomRecursiveBody(self));
  }
  const innerType = randomPrimitiveType();
  const pattern = Math.floor(random() * 5);

  switch (pattern) {
    case 0:
      // Linked list: rec t. <nil: Null, cons: (head: T, tail: t)>
      return RecursiveType((self) =>
        VariantType({
          nil: NullType,
          cons: StructType({ head: innerType, tail: self }),
        })
      );

    case 1:
      // Tree with children array: rec t. (value: T, children: Array<t>)
      return RecursiveType((self) =>
        StructType({
          value: innerType,
          children: ArrayType(self),
        })
      );

    case 2:
      // Option chain: rec t. (value: T, next: Option<t>)
      return RecursiveType((self) =>
        StructType({
          value: innerType,
          next: OptionType(self),
        })
      );

    case 3:
      // Binary tree: rec t. <leaf: T, node: (left: t, right: t)>
      return RecursiveType((self) =>
        VariantType({
          leaf: innerType,
          node: StructType({ left: self, right: self }),
        })
      );

    case 4:
    default:
      // Nested variant with ref: rec t. <done: T, more: Ref<t>>
      return RecursiveType((self) =>
        VariantType({
          done: innerType,
          more: RefType(self),
        })
      );
  }
}

/** A leaf of a random recursive body: a primitive, a small non-recursive
 *  compound, and — unless the leaf must terminate the value — a nested
 *  closed recursive type or a type value now and then. */
function randomRecursiveLeaf(terminal: boolean): EastType {
  const r = random();
  if (r < 0.55) return randomPrimitiveType();
  if (r < 0.70) return ArrayType(randomPrimitiveType());
  if (r < 0.80 || terminal) return StructType({ id: IntegerType, label: StringType });
  if (r < 0.90) return randomRecursiveType(); // nested recursion, SCC size 1
  return EastTypeType;
}

/**
 * A random body for a recursive type: a struct whose self-references sit
 * under Array, Option or Dict (all of which can be empty), or a variant with
 * at least one case that does not recurse. Either way every value has a
 * finite spelling, so {@link randomValueFor} terminates.
 */
function randomRecursiveBody(self: RecursiveTypeMarker): EastType {
  const viaContainer = (): EastType => {
    const r = random();
    if (r < 0.4) return ArrayType(self);
    if (r < 0.7) return OptionType(self);
    if (r < 0.85) return DictType(StringType, self);
    return ArrayType(StructType({ key: StringType, node: self }));
  };
  if (random() < 0.5) {
    // Struct body: 1-3 fields, at least one recursing through a container.
    const fieldCount = 1 + Math.floor(random() * 3);
    const recursing = Math.floor(random() * fieldCount);
    const fields: Record<string, EastType> = {};
    for (let i = 0; i < fieldCount; i++) {
      fields[`f${i}`] = i === recursing || random() < 0.3 ? viaContainer() : randomRecursiveLeaf(false);
    }
    return StructType(fields);
  }
  // Variant body: 2-4 cases, the first terminal, the rest recursing directly
  // or through a struct, a Ref, or a container.
  const caseCount = 2 + Math.floor(random() * 3);
  const cases: Record<string, EastType | RecursiveTypeMarker> = {};
  cases["end"] = randomRecursiveLeaf(true);
  for (let i = 1; i < caseCount; i++) {
    const r = random();
    cases[`c${i}`] = r < 0.25 ? self
      : r < 0.45 ? StructType({ left: self, right: self })
      : r < 0.6 ? RefType(self)
      : r < 0.8 ? viaContainer()
      : randomRecursiveLeaf(false);
  }
  return VariantType(cases);
}

/**
 * A struct that names one recursive type from several fields — bare, under
 * Array, Option and Dict — in random order, so the type may be reached first
 * through a container and only then itself.
 *
 * @returns A {@link StructType} over one random {@link RecursiveType}
 */
export function randomSharedRecursiveType(): EastType {
  const rec = randomRecursiveType({ randomBody: true });
  const shapes: EastType[] = [rec, ArrayType(rec), OptionType(rec), DictType(StringType, rec), ArrayType(ArrayType(rec))];
  // Fisher–Yates over the deterministic stream, then take 2-4 of them.
  for (let i = shapes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shapes[i], shapes[j]] = [shapes[j]!, shapes[i]!];
  }
  const fieldCount = 2 + Math.floor(random() * 3);
  const fields: Record<string, EastType> = {};
  for (let i = 0; i < fieldCount; i++) fields[`f${i}`] = shapes[i]!;
  return StructType(fields);
}

/**
 * Generates a random function type.
 *
 * @returns A randomly generated {@link FunctionType}
 *
 * @remarks
 * Functions have 0-3 arguments with random primitive or simple types.
 * Output types are also kept simple to avoid excessive nesting.
 */
export function randomFunctionType(): EastType {
  const argCount = Math.floor(random() * 4);
  const args: EastType[] = [];

  for (let i = 0; i < argCount; i++) {
    // Use simple types for arguments to keep things manageable
    const argType = random() < 0.7
      ? randomPrimitiveType()
      : ArrayType(randomPrimitiveType());
    args.push(argType);
  }

  // Output type - also keep simple
  const outputType = random() < 0.7
    ? randomPrimitiveType()
    : StructType({
        result: randomPrimitiveType(),
        status: BooleanType,
      });

  return FunctionType(args, outputType);
}

/**
 * Check if a type contains any `.Recursive n` back-references.
 * A type without recursive refs is "terminal" - it won't cause infinite recursion.
 * @internal
 */
function containsRecursive(type: EastTypeValue): boolean {
  switch (type.type) {
    case "Recursive":
      return true;
    case "Ref":
    case "Array":
      return containsRecursive(type.value);
    case "Set":
      return containsRecursive(type.value);
    case "Dict":
      return containsRecursive(type.value.key) || containsRecursive(type.value.value);
    case "Struct":
      return type.value.some(f => containsRecursive(f.type));
    case "Variant":
      return type.value.some(c => containsRecursive(c.type));
    case "Vector":
    case "Matrix":
    default:
      // Primitives, vectors, matrices, functions don't contain recursive refs
      return false;
  }
}

/**
 * Context for generating values of recursive types.
 * Uses explicit depth passing (not shared mutable state) for correct recursion tracking.
 * @internal
 */
interface RecursiveValueContext {
  /** Map of value generators for recursive back-references, keyed by type id. */
  generators: Map<bigint, (depth: number) => any>;
  /** Maximum recursion depth before forcing termination */
  maxDepth: number;
}

/**
 * Internal helper that generates random values with explicit depth passing.
 * Returns a function that takes depth and produces a value.
 *
 * This design passes depth explicitly through all generators, avoiding the bug
 * where shared mutable depth state was incorrectly restored after generating
 * sibling fields in structs.
 * @internal
 */
function buildValueGenerator(
  type: EastTypeValue,
  ctx: RecursiveValueContext
): (depth: number) => any {
  if (type.type === "Never") {
    throw new Error("Cannot generate values for Never type");
  } else if (type.type === "Null") {
    return () => null;
  } else if (type.type === "Boolean") {
    return () => random() < 0.5;
  } else if (type.type === "Integer") {
    return () => BigInt(Math.floor(random() * 200) - 100);
  } else if (type.type === "Float") {
    return () => {
      const r = random();
      if (r < 0.05) return NaN;
      if (r < 0.10) return Infinity;
      if (r < 0.15) return -Infinity;
      if (r < 0.20) return 0.0;
      if (r < 0.25) return -0.0;
      return random() * 200 - 100;
    };
  } else if (type.type === "String") {
    return () => {
      const length = Math.floor(random() * 20);
      if (length === 0) return "";
      return random().toString(36).substring(2, 2 + length);
    };
  } else if (type.type === "DateTime") {
    return () => {
      const year2025 = new Date("2025-01-01T00:00:00.000Z").valueOf();
      const oneYear = 1000 * 60 * 60 * 24 * 365;
      return new Date(year2025 + Math.floor(random() * oneYear));
    };
  } else if (type.type === "Blob") {
    return () => {
      const length = Math.floor(random() * 100);
      const arr = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        arr[i] = Math.floor(random() * 256);
      }
      return arr;
    };
  } else if (type.type === "Ref") {
    // Create function shell, push, recurse, pop - like apply.ts pattern
    let valueGen: (depth: number) => any;
    const ret = (depth: number) => ref(valueGen(depth));
    valueGen = buildValueGenerator(type.value, ctx);
    return ret;
  } else if (type.type === "Array") {
    let itemGen: (depth: number) => any;
    const ret = (depth: number) => {
      const maxLen = depth >= ctx.maxDepth ? 0 : Math.max(1, 5 - depth);
      const length = Math.floor(random() * (maxLen + 1));
      return Array.from({ length }, () => itemGen(depth));
    };
    itemGen = buildValueGenerator(type.value, ctx);
    return ret;
  } else if (type.type === "Set") {
    // SortedSet, not Set: every East-created Set is ordered by East's total
    // order (compile.ts) and east-c's btrees sort unconditionally. A plain
    // insertion-ordered Set is a value no runtime can hold, and it serializes
    // to bytes that differ from the same value's canonical encoding.
    const keyComparer = compareFor(type.value);
    let itemGen: (depth: number) => any;
    const ret = (depth: number) => {
      const maxLen = depth >= ctx.maxDepth ? 0 : 5;
      const length = Math.floor(random() * (maxLen + 1));
      const set = new SortedSet<any>(undefined, keyComparer);
      for (let i = 0; i < length; i++) {
        set.add(itemGen(depth));
      }
      return set;
    };
    itemGen = buildValueGenerator(type.value, ctx);
    return ret;
  } else if (type.type === "Dict") {
    const keyComparer = compareFor(type.value.key);
    let keyGen: (depth: number) => any;
    let valueGen: (depth: number) => any;
    const ret = (depth: number) => {
      const maxLen = depth >= ctx.maxDepth ? 0 : 5;
      const length = Math.floor(random() * (maxLen + 1));
      const dict = new SortedMap<any, any>(undefined, keyComparer);
      for (let i = 0; i < length; i++) {
        dict.set(keyGen(depth), valueGen(depth));
      }
      return dict;
    };
    keyGen = buildValueGenerator(type.value.key, ctx);
    valueGen = buildValueGenerator(type.value.value, ctx);
    return ret;
  } else if (type.type === "Struct") {
    let fieldGens: Array<{ name: string; gen: (depth: number) => any }>;
    const ret = (depth: number) => {
      const obj: Record<string, any> = {};
      for (const { name, gen } of fieldGens) {
        obj[name] = gen(depth);
      }
      return obj;
    };
    fieldGens = type.value.map(({ name, type: fieldType }) => ({
      name,
      gen: buildValueGenerator(fieldType, ctx),
    }));
    return ret;
  } else if (type.type === "Variant") {
    let caseInfos: Array<{ name: string; gen: (depth: number) => any; isTerminal: boolean }>;
    const ret = (depth: number) => {
      const terminalCases = caseInfos.filter((c) => c.isTerminal);
      const nonTerminalCases = caseInfos.filter((c) => !c.isTerminal);

      let chosen: (typeof caseInfos)[number];
      if (depth >= ctx.maxDepth && terminalCases.length > 0) {
        chosen = terminalCases[Math.floor(random() * terminalCases.length)]!;
      } else if (terminalCases.length > 0 && nonTerminalCases.length > 0) {
        const terminalProb = Math.min(0.3 + depth * 0.2, 0.9);
        if (random() < terminalProb) {
          chosen = terminalCases[Math.floor(random() * terminalCases.length)]!;
        } else {
          chosen = nonTerminalCases[Math.floor(random() * nonTerminalCases.length)]!;
        }
      } else {
        chosen = caseInfos[Math.floor(random() * caseInfos.length)]!;
      }

      return variant(chosen.name, chosen.gen(depth));
    };
    caseInfos = type.value.map(({ name, type: caseType }) => ({
      name,
      gen: buildValueGenerator(caseType, ctx),
      isTerminal: !containsRecursive(caseType),
    }));
    return ret;
  } else if (type.type === "Recursive" && (type.value as any).type === "wrapper") {
    // Recursive wrapper: register by id, build inner
    let inner: any;
    const ret = (...args: any[]) => inner(...args);
    ctx.generators.set((type.value as any).value.id as bigint, ret);
    inner = buildValueGenerator((type.value as any).value.inner, ctx);
    return ret;
  } else if (type.type === "Recursive") {
    // Look up the generator by type id
    const id = (type.value as any).value as bigint;
    const generator = ctx.generators.get(id);
    if (!generator) {
      throw new Error(`Recursive generator not found for id ${id}`);
    }
    // Return a generator that calls the captured recursive generator with depth+1
    return (depth: number) => generator(depth + 1);
  } else if (type.type === "Function") {
    let outputGen: (depth: number) => any;
    const ret = (depth: number) => {
      return (..._args: any[]) => outputGen(depth);
    };
    outputGen = buildValueGenerator(type.value.output, ctx);
    return ret;
  } else if (type.type === "AsyncFunction") {
    let outputGen: (depth: number) => any;
    const ret = (depth: number) => {
      return (..._args: any[]) => Promise.resolve(outputGen(depth));
    };
    outputGen = buildValueGenerator(type.value.output, ctx);
    return ret;
  } else if (type.type === "Vector") {
    const elemType = type.value;
    return () => {
      const length = Math.floor(random() * 10);
      if (elemType.type === "Float") {
        const arr = new Float64Array(length);
        for (let i = 0; i < length; i++) {
          const r = random();
          if (r < 0.05) arr[i] = NaN;
          else if (r < 0.10) arr[i] = Infinity;
          else if (r < 0.15) arr[i] = -Infinity;
          else arr[i] = random() * 200 - 100;
        }
        return arr;
      } else if (elemType.type === "Integer") {
        const arr = new BigInt64Array(length);
        for (let i = 0; i < length; i++) arr[i] = BigInt(Math.floor(random() * 200) - 100);
        return arr;
      } else {
        const arr = new Uint8ClampedArray(length);
        for (let i = 0; i < length; i++) arr[i] = random() < 0.5 ? 1 : 0;
        return arr;
      }
    };
  } else if (type.type === "Matrix") {
    const elemType = type.value;
    return () => {
      const rows = Math.floor(random() * 5);
      const cols = rows === 0 ? 0 : Math.floor(random() * 5);
      const totalLen = rows * cols;
      if (elemType.type === "Float") {
        const data = new Float64Array(totalLen);
        for (let i = 0; i < totalLen; i++) {
          const r = random();
          if (r < 0.05) data[i] = NaN;
          else if (r < 0.10) data[i] = Infinity;
          else if (r < 0.15) data[i] = -Infinity;
          else data[i] = random() * 200 - 100;
        }
        return matrix(data, rows, cols);
      } else if (elemType.type === "Integer") {
        const data = new BigInt64Array(totalLen);
        for (let i = 0; i < totalLen; i++) data[i] = BigInt(Math.floor(random() * 200) - 100);
        return matrix(data, rows, cols);
      } else {
        const data = new Uint8ClampedArray(totalLen);
        for (let i = 0; i < totalLen; i++) data[i] = random() < 0.5 ? 1 : 0;
        return matrix(data, rows, cols);
      }
    };
  } else {
    throw new Error(`Unhandled type: ${printType(type)}`);
  }
}

/**
 * Internal helper to handle RecursiveType before conversion.
 * Sets up the context stack and builds the value generator.
 *
 * The key insight: we create the generator function first, register it in the
 * context stack, then build the inner generator. This allows the inner generator
 * to find the outer generator via de Bruijn index lookup when it hits a
 * `.Recursive n` back-reference.
 * @internal
 */
function randomValueForRecursive(
  innerNode: EastType,
  ctx: RecursiveValueContext
): () => any {
  // The inner generator - will be set after building
  let innerGen: ((depth: number) => any) | null = null;

  // Create the self-referential generator
  // This will be called when we hit a .Recursive n back-reference
  const selfGenerator = (depth: number): any => {
    if (!innerGen) {
      throw new Error("Internal error: recursive generator not initialized");
    }

    // Hard limit to prevent stack overflow
    if (depth > ctx.maxDepth + 5) {
      throw new Error("Fuzz value generation exceeded max recursion depth");
    }

    return innerGen(depth);
  };

  // Push BEFORE building the inner generator so .Recursive can find it

  // Convert inner node to EastTypeValue with recursive context
  // Pass empty stack - the type structure will build up the stack naturally
  // as it recurses. When self-references (RecursiveType pointing back) are hit,
  // they'll find the struct in the stack and return .Recursive indices.
  const innerTypeValue = toEastTypeValue(innerNode, [], true);

  // Build the inner generator
  innerGen = buildValueGenerator(innerTypeValue, ctx);

  // Pop after building (generator is now self-contained via closure)

  // Return a function that starts generation at depth 0
  return () => selfGenerator(0);
}

/** Options for {@link randomValueFor}. */
export interface RandomValueOptions {
  /** Depth at which containers empty out and variants take a terminal case
   *  (default 5). A replay corpus keeps this low so many types fit. */
  maxDepth?: number;
}

/**
 * Creates a function that generates random values of a given type.
 *
 * @typeParam T - The {@link EastType} to generate values for
 * @param type - The type to generate values for
 * @returns A function that returns a new random value each time it's called
 * @throws When the type is {@link NeverType} or {@link FunctionType}
 *
 * @remarks
 * Generates diverse test values for each type:
 * - Floats include special values (NaN, ±Infinity, ±0.0)
 * - Integers range from -100 to 100 (as bigint)
 * - Strings use random alphanumeric sequences (0-20 chars)
 * - DateTimes are within one year of 2025-01-01
 * - Collections have 0-4 elements (kept small for performance)
 * - Variants randomly select one of their cases
 * - Recursive types generate finite values with depth limiting
 */
export function randomValueFor(type: EastTypeValue, options?: RandomValueOptions): () => any;
export function randomValueFor<T extends EastType>(type: T, options?: RandomValueOptions): () => ValueTypeOf<T>;
export function randomValueFor(type: EastTypeValue | EastType, options: RandomValueOptions = {}): () => any {
  const ctx: RecursiveValueContext = {
    generators: new Map(),
    maxDepth: options.maxDepth ?? 5, // Limit recursion depth to avoid huge values
  };

  // Check if this is an EastType (not yet converted)
  if (!isVariant(type)) {
    if (type === EastTypeType) {
      const gen = buildValueGenerator(EastTypeValueType, ctx);
      return () => gen(0);
    }
    // Handle RecursiveType specially before conversion
    if (type.type === "Recursive") {
      return randomValueForRecursive(type.node, ctx);
    }
    // Convert other EastTypes to EastTypeValue
    const typeValue = toEastTypeValue(type);
    const gen = buildValueGenerator(typeValue, ctx);
    return () => gen(0);
  }

  const gen = buildValueGenerator(type, ctx);
  return () => gen(0);
}

/**
 * Runs a fuzz test over a generic function parameterized by a type.
 *
 * @param fn - Factory function that takes a type and returns a test function for values of that type
 * @param n_types - Number of random types to test
 * @param n_samples - Number of random values to test per type
 * @returns `true` if all tests passed, `false` if any failed
 *
 * @remarks
 * For each randomly generated type:
 * 1. Creates a test function using the provided factory
 * 2. Generates random values of that type
 * 3. Runs the test function on each value
 * 4. Reports any failures to stderr with type, value, and error details
 *
 * Attempts to generate unique types (up to 100 attempts per type) to maximize
 * test coverage. Prints summary statistics showing success/failure counts.
 *
 * @example
 * ```ts
 * import { printFor, parseFor } from "./serialization/east.js";
 *
 * // Test that serialization and parsing work
 * await fuzzerTest(
 *   (type) => async (value) => {
 *     const parse = parseFor(type);
 *     const result = parse(serialized);
 *     if (!result.success) {
 *       throw new Error(`Parse failed: ${result.error}`);
 *     }
 *   },
 *   100,  // test 100 random types
 *   10    // with 10 random values each
 * );
 * ```
 */
export async function fuzzerTest(
  fn: (type: EastType) => (value: any) => Promise<void>,
  n_types: number = 100,
  n_samples: number = 10,
  options: RandomTypeOptions = {}
): Promise<boolean> {
  // Default: include recursive types but NOT functions (can't generate values for functions)
  const { includeRecursive = true, includeFunctions = false, nestedRecursive = false, includeTypeValues = false } = options;

  let n_type_success = 0;
  let n_type_fail = 0;
  const type_cache = new Set<string>();

  for (let i = 0; i < n_types; i++) {
    let n_success = 0;
    let n_fail = 0;

    // Generate a unique random type
    let type: EastType;
    let attempts = 0;
    while (true) {
      type = randomType(0, { includeRecursive, includeFunctions, nestedRecursive, includeTypeValues });
      const typeStr = printType(type);
      if (!type_cache.has(typeStr)) {
        type_cache.add(typeStr);
        break;
      }
      attempts++;
      if (attempts > 100) {
        // Give up and allow duplicates
        break;
      }
    }

    const type_fn = fn(type);
    const randomValue = randomValueFor(type);
    const print = printFor(type);

    for (let j = 0; j < n_samples; j++) {
      const value = randomValue();
      try {
        await type_fn(value);
        n_success++;
      } catch (e) {
        n_fail++;
        console.error(`    Test failed for type ${printType(type)}`);
        console.error(`    Value: ${print(value)}`);
        console.error(`    Error: ${(e as any)?.stack ?? e}`);
      }
    }

    if (n_fail > 0) {
      n_type_fail++;
      console.error(`  FAILED: ${n_success}/${n_samples} samples passed for type ${printType(type)}`);
    } else {
      n_type_success++;
    }
  }

  if (n_type_fail > 0) {
    console.error(`FAILED: ${n_type_success}/${n_types} types passed`);
    return false;
  } else {
    return true;
  }
}


/**
 * A short, process-independent name for a type: the FNV-1a-64 hash of its
 * canonical beast2 type section (#770), as 16 hex digits. `printType` embeds
 * the ids of recursive types, which depend on what a process built first, so
 * it cannot name a case in a corpus replayed elsewhere.
 *
 * @param type - the type to name
 * @returns 16 hex digits, equal for structurally equal types
 */
export function typeFingerprint(type: EastType): string {
  const writer = new BufferWriter();
  writeTypeSection(type, writer);
  return fnv1a64(writer.toUint8Array()).toString(16).padStart(16, "0");
}

/** One generated type with sample values of it — a replay-corpus case. */
export interface FuzzValueCase<T extends EastType = EastType> {
  /** The randomly generated East type */
  type: T;
  /** `printType(type)`, unique within one generation */
  typeName: string;
  /** {@link typeFingerprint} of the type — stable across processes */
  fingerprint: string;
  /** Sample values of `type` */
  values: ValueTypeOf<T>[];
}

/** Options for {@link generateFuzzValues}. */
export interface FuzzValuesOptions extends RandomTypeOptions {
  /** Number of distinct types to generate (default 50) */
  numTypes?: number;
  /** Number of sample values per type (default 3) */
  numSamples?: number;
  /** Depth at which sample values stop nesting (default 5; see
   *  {@link RandomValueOptions}) */
  valueDepth?: number;
  /** Seed for the deterministic random stream (default `0xea57`). The cases
   *  form a cross-runtime replay corpus, so generation must reproduce across
   *  exports — mint a fresh corpus by bumping the seed deliberately. */
  seed?: number;
}

/**
 * Generates distinct random types with sample values of each, for suites
 * that replay one corpus on every runtime. Types whose values cannot be
 * generated within the depth limit are skipped; generation stops after
 * three attempts per requested type.
 *
 * @param options - how many types and samples, the seed, and the type kinds
 * @returns the generated cases, in generation order
 */
export function generateFuzzValues(options: FuzzValuesOptions = {}): FuzzValueCase[] {
  const { numTypes = 50, numSamples = 3, seed = 0xea57, valueDepth = 5, ...typeOptions } = options;
  seedFuzz(seed);
  const cases: FuzzValueCase[] = [];
  const seen = new Set<string>();
  const maxAttempts = numTypes * 3;
  for (let attempts = 0; cases.length < numTypes && attempts < maxAttempts; attempts++) {
    const type = randomType(0, typeOptions);
    const typeName = printType(type);
    if (seen.has(typeName)) continue;
    const generate = randomValueFor(type, { maxDepth: valueDepth });
    const values: any[] = [];
    try {
      for (let j = 0; j < numSamples; j++) {
        let value: any;
        let retries = 0;
        for (;;) {
          try { value = generate(); break; }
          catch (e) {
            if (!(e as Error).message?.includes("max recursion depth") || ++retries >= 20) throw e;
          }
        }
        values.push(value);
      }
    } catch (e) {
      if ((e as Error).message?.includes("max recursion depth")) continue;
      throw e;
    }
    seen.add(typeName);
    cases.push({ type, typeName, fingerprint: typeFingerprint(type), values });
  }
  return cases;
}
