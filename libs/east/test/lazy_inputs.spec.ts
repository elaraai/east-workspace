/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lazy-input builtin sweep (#510): every East program must behave identically
 * whether its collection inputs are decoded eagerly or opened lazily
 * (`openBeast2LazyFor`) — the contract the east-node runner's default-on lazy
 * input opening relies on.
 *
 * Each corpus case is an East function taking Array/Set/Dict parameters,
 * executed twice — once with inputs decoded from a small-batch paged blob,
 * once with the same blob opened under the runners' policy: lazily when the
 * shape gate ({@link isBeast2LazySafe}) allows it, eagerly otherwise —
 * asserting result equality, error equality, and post-call input-state
 * equality (for mutating bodies). The examples suite cannot serve as this
 * corpus: examples inline all data inside zero-argument functions, so
 * laziness has no input boundary to enter through.
 *
 * A completeness gate closes the loop: the builtins mentioned in the swept
 * IR of cases whose inputs GENUINELY opened lazily must include every
 * registry builtin that takes a collection input, so a new collection
 * builtin cannot land without lazy coverage — and a case the gate routes to
 * eager cannot fake it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  East, Expr, equalFor, IRType, toJSONFor, some, none,
  encodeBeast2PagedFor, decodeBeast2For, openBeast2LazyFor, isBeast2LazySafe,
  ArrayType, SetType, DictType, IntegerType, FloatType, StringType, NullType, StructType, OptionType,
  type EastType,
} from "../src/index.js";
import { Builtins, type BuiltinName } from "../src/builtins.js";

/** Multi-segment even for tiny corpus collections, so segment boundaries
 *  and fence lookups are exercised, not just the single-segment fast path. */
const SWEEP_BATCH = { batchSize: 2 };

/** Builtins whose only collection input is a compile-time literal the fluent
 *  surface constructs itself (datetime format tokens parsed from a format
 *  string) — no runtime collection value can reach them, so laziness cannot
 *  either. */
const UNREACHABLE_BY_VALUE: ReadonlySet<string> = new Set([
  "DateTimePrintFormat",
  "DateTimeParseFormat",
]);

/** Builtins whose only collection input is inherently mutable-nested
 *  (Array-of-Array / Array-of-Vector), which the shape gate ALWAYS routes to
 *  the eager decode — by policy no lazy value can reach them. They are still
 *  swept for gate-policy equivalence by `corpus.matrixBridges`. */
const UNREACHABLE_BY_GATE: ReadonlySet<string> = new Set([
  "MatrixFromArray",
  "MatrixFromRows",
]);

type FnShape = { type: string; inputs: EastType[]; output: EastType };

/** Positions of top-level Array/Set/Dict parameters — the inputs laziness
 *  can enter through. */
function collectionInputPositions(inputs: readonly EastType[]): number[] {
  const positions: number[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const t = inputs[i] as { type?: string };
    if (t && (t.type === "Array" || t.type === "Set" || t.type === "Dict")) positions.push(i);
  }
  return positions;
}

/** Every registry builtin taking a top-level collection input — the audit
 *  set the sweep must cover. */
function auditBuiltins(): BuiltinName[] {
  const names: BuiltinName[] = [];
  for (const [name, sig] of Object.entries(Builtins)) {
    if (UNREACHABLE_BY_VALUE.has(name) || UNREACHABLE_BY_GATE.has(name)) continue;
    const takesCollection = sig.inputs.some((input) => {
      const t = input as { type?: string };
      return typeof input === "object" && (t.type === "Array" || t.type === "Set" || t.type === "Dict");
    });
    if (takesCollection) names.push(name as BuiltinName);
  }
  return names;
}

/** Collects the builtin names an IR mentions, walking the IR's JSON form
 *  (`Builtin` nodes carry the name in their `builtin` field). */
function builtinsMentioned(irJson: unknown, into: Set<string>): void {
  if (Array.isArray(irJson)) {
    for (const item of irJson) builtinsMentioned(item, into);
    return;
  }
  if (irJson && typeof irJson === "object") {
    const rec = irJson as Record<string, unknown>;
    if (typeof rec.builtin === "string") into.add(rec.builtin);
    for (const value of Object.values(rec)) builtinsMentioned(value, into);
  }
}

/** An equality closure for `type`, or null when the type has no East
 *  equality (function-valued outputs). */
function safeEqual(type: EastType): ((a: unknown, b: unknown) => boolean) | null {
  try {
    return equalFor(type) as (a: unknown, b: unknown) => boolean;
  } catch {
    return null;
  }
}

/** One swept unit: an East function expression plus its plain-value inputs.
 *  `expectLazy: false` marks a case whose collection inputs the shape gate
 *  must route to the eager decode (mutable-nested element shapes). */
type SweepCase = {
  label: string;
  fn: unknown;
  inputs: unknown[];
  expectLazy?: boolean;
};

/** Runs one case on eager and gate-policy inputs and asserts observational
 *  equivalence. The "lazy" side applies exactly the runners' policy —
 *  {@link isBeast2LazySafe} decides lazy vs eager per input — and the case's
 *  builtins count toward coverage only when its inputs really opened lazily,
 *  so a case the gate routes to eager cannot fake lazy coverage. */
async function sweep(c: SweepCase, mentioned: Set<string>): Promise<void> {
  const fnType = Expr.type(c.fn as never) as FnShape;
  assert.ok(fnType.type === "Function" || fnType.type === "AsyncFunction", `${c.label}: fn must be an East function`);
  const positions = collectionInputPositions(fnType.inputs);
  assert.ok(positions.length > 0, `${c.label}: corpus cases must take at least one collection input`);
  assert.equal(c.inputs.length, fnType.inputs.length, `${c.label}: input arity`);

  const wantLazy = c.expectLazy ?? true;
  const eagerArgs = [...c.inputs];
  const lazyArgs = [...c.inputs];
  for (const i of positions) {
    const t = fnType.inputs[i]!;
    const blob = encodeBeast2PagedFor(t, SWEEP_BATCH)(c.inputs[i] as never);
    eagerArgs[i] = decodeBeast2For(t)(blob);
    // The runner policy: lazy only for shape-gate-safe types. A corpus case
    // whose eligibility does not match its declared intent has silently
    // stopped (or started) covering the lazy path — fail loudly instead.
    const lazySafe = isBeast2LazySafe(t);
    assert.equal(lazySafe, wantLazy,
      `${c.label}: input ${i} lazy-eligibility (${lazySafe}) must match the case's intent (${wantLazy})`);
    lazyArgs[i] = lazySafe ? openBeast2LazyFor(t)(blob) : decodeBeast2For(t)(blob);
  }

  const ir = (c.fn as { toIR(): { ir: unknown; compile(platform: never[]): (...args: unknown[]) => unknown } }).toIR();
  const compiled = ir.compile([]);

  let eagerResult: unknown, eagerError: unknown;
  try {
    eagerResult = await compiled(...eagerArgs);
  } catch (err) {
    eagerError = err;
  }
  let lazyResult: unknown, lazyError: unknown;
  try {
    lazyResult = await compiled(...lazyArgs);
  } catch (err) {
    lazyError = err;
  }

  if (eagerError !== undefined || lazyError !== undefined) {
    assert.ok(eagerError !== undefined && lazyError !== undefined,
      `${c.label}: one path threw and the other did not (eager: ${(eagerError as Error)?.message}, lazy: ${(lazyError as Error)?.message})`);
    assert.equal((lazyError as Error).message, (eagerError as Error).message,
      `${c.label}: lazy and eager must throw the same error`);
  } else {
    const eq = safeEqual(fnType.output);
    if (eq) assert.ok(eq(lazyResult, eagerResult), `${c.label}: lazy result must equal the eager result`);
  }
  // Mutating bodies must leave lazy inputs in the same state as eager ones.
  for (const i of positions) {
    const eq = safeEqual(fnType.inputs[i]!);
    if (eq) assert.ok(eq(lazyArgs[i], eagerArgs[i]), `${c.label}: input ${i} post-call state must match`);
  }

  // Coverage counts only cases whose inputs genuinely opened lazily — the
  // completeness gate must key on a lazy value reaching the builtins, not
  // on builtin names merely appearing in swept IR.
  if (wantLazy) builtinsMentioned(toJSONFor(IRType)(ir.ir as never), mentioned);
}

describe("lazy inputs — builtin corpus sweep (#510)", () => {
  const covered = new Set<string>();

  const Arr = ArrayType(IntegerType);
  const Tags = SetType(StringType);
  const IntSet = SetType(IntegerType);
  const Table = DictType(IntegerType, StringType);
  const Row = StructType({ id: IntegerType, name: StringType });
  const NestedTable = DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) }));
  const NestedRows = ArrayType(StructType({ inner: ArrayType(IntegerType) }));
  const nums: bigint[] = [5n, 1n, 4n, 2n, 3n, 9n, 8n, 7n, 6n, 0n];
  const sortedNums: bigint[] = [0n, 1n, 2n, 3n, 4n, 4n, 5n, 6n, 7n, 8n];
  const tags = new Set(["alpha", "beta", "carrot", "delta", "echo", "fig", "grape"]);
  const intSet = new Set([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
  const table = new Map<bigint, string>(Array.from({ length: 9 }, (_, i) => [BigInt(i), `row-${i}`]));
  const nestedTable = new Map<bigint, { xs: bigint[] }>([
    [1n, { xs: [1n, 2n] }], [2n, { xs: [3n] }], [3n, { xs: [] }], [4n, { xs: [4n] }],
  ]);
  const nestedRows: { inner: bigint[] }[] = [{ inner: [5n] }, { inner: [] }, { inner: [9n, 10n] }];

  const corpus: SweepCase[] = [
    {
      label: "corpus.arrayReads",
      fn: East.function([Arr], ArrayType(IntegerType), ($, a) => {
        const out = $.let([], ArrayType(IntegerType));
        $(out.pushLast(a.size()));
        $(out.pushLast(a.get(3n)));
        $(out.pushLast(a.get(99n, (_$, _i) => -1n)));
        $(out.pushLast(Expr.match(a.tryGet(2n), { some: (_$, v) => v, none: () => -1n })));
        $(out.pushLast(a.has(4n).ifElse(() => 1n, () => 0n)));
        $(out.append(a.getKeys([0n, 2n, 4n])));
        return out;
      }),
      inputs: [nums],
    },
    {
      label: "corpus.arrayTransforms",
      fn: East.function([Arr], ArrayType(IntegerType), ($, a) => {
        const out = $.let([], ArrayType(IntegerType));
        $(out.append(a.sort()));
        $(out.append(a.reverse()));
        $(out.append(a.slice(2n, 5n)));
        $(out.append(a.filter((_$, x) => x.greater(4n))));
        $(out.append(a.map((_$, x) => x.multiply(2n))));
        $(out.append(a.concat([77n, 78n])));
        $(out.append(a.copy()));
        $(out.pushLast(a.reduce((_$, acc, x) => acc.add(x), 0n)));
        $(out.pushLast(a.mapReduce((_$, x) => x.multiply(2n), (_$, p, q) => p.add(q))));
        $(out.append(a.scan((_$, acc, x) => acc.add(x), 0n)));
        return out;
      }),
      inputs: [nums],
    },
    {
      label: "corpus.arraySearches",
      fn: East.function([Arr, Arr], ArrayType(StringType), ($, a, sorted) => {
        const out = $.let([], ArrayType(StringType));
        $(out.pushLast(East.print(a.isSorted())));
        $(out.pushLast(East.print(sorted.isSorted())));
        $(out.pushLast(East.print(sorted.findSortedFirst(4n))));
        $(out.pushLast(East.print(sorted.findSortedLast(4n))));
        $(out.pushLast(East.print(sorted.findSortedRange(4n))));
        $(out.pushLast(East.print(a.findFirst(4n))));
        $(out.pushLast(East.print(a.findFirst(999n))));
        return out;
      }),
      inputs: [nums, sortedNums],
    },
    {
      label: "corpus.arrayCombinators",
      fn: East.function([Arr], ArrayType(StringType), ($, a) => {
        const out = $.let([], ArrayType(StringType));
        $(out.pushLast(East.print(a.filterMap((_$, x) => East.equal(x.remainder(2n), 1n).ifElse(() => some(East.print(x)), () => none)))));
        $(out.pushLast(East.print(a.firstMap((_$, x) => x.greater(3n).ifElse(() => some(East.print(x)), () => none)))));
        $(out.pushLast(East.print(a.groupReduce((_$, x, _i) => x.remainder(2n), (_$, _k) => 0n, (_$, acc, x, _i) => acc.add(x)))));
        $(out.pushLast(East.print(a.toSet())));
        $(out.pushLast(East.print(a.toDict())));
        $(out.pushLast(East.print(a.toDict((_$, x, _i) => East.print(x)))));
        $(out.pushLast(East.print(a.flatMap((_$, x) => East.Array.range(0n, x.remainder(3n))))));
        $(out.pushLast(East.print(a.flattenToSet((_$, x) => East.Array.range(x.multiply(10n), x.multiply(10n).add(2n)).toSet()))));
        $(out.pushLast(East.print(a.flattenToDict((_$, x) => East.Array.range(0n, x.remainder(3n)).toDict((_$, y, _i) => East.str`${x}:${y}`)))));
        return out;
      }),
      inputs: [nums],
    },
    {
      label: "corpus.arrayMutations",
      fn: East.function([Arr, Arr], Arr, ($, a, other) => {
        $(a.merge(0n, East.value(10n), (_$, existing, value) => existing.add(value)));
        $(a.mergeAll(other, (_$, existing, value) => existing.add(value)));
        $(a.pushLast(100n));
        $(a.pushFirst(-100n));
        $(a.update(0n, -200n));
        const _popped = $.let(a.popLast());
        const _shifted = $.let(a.popFirst());
        $(a.prepend([-5n, -6n]));
        $(a.sortInPlace());
        $(a.reverseInPlace());
        return a;
      }),
      inputs: [nums, nums.map((n) => n * 3n)],
    },
    {
      label: "corpus.setAlgebra",
      fn: East.function([Tags, Tags], ArrayType(StringType), ($, s, other) => {
        const out = $.let([], ArrayType(StringType));
        $(out.append(s.union(other).toArray()));
        $(out.append(s.intersection(other).toArray()));
        $(out.append(s.difference(other).toArray()));
        $(out.append(s.symmetricDifference(other).toArray()));
        $(out.pushLast(East.print(s.isSubsetOf(other))));
        $(out.pushLast(East.print(s.isDisjointFrom(other))));
        $(out.pushLast(East.print(s.size())));
        $(out.pushLast(East.print(s.has("carrot"))));
        return out;
      }),
      inputs: [tags, new Set(["carrot", "delta", "xray"])],
    },
    {
      label: "corpus.setCombinators",
      fn: East.function([Tags, IntSet], ArrayType(StringType), ($, s, ints) => {
        const out = $.let([], ArrayType(StringType));
        $(out.pushLast(East.print(s.copy())));
        $(out.pushLast(East.print(s.map((_$, x) => x.concat("!")))));
        $(out.pushLast(East.print(s.filter((_$, x) => x.contains("a")))));
        $(out.pushLast(East.print(s.filterMap((_$, x) => x.contains("e").ifElse(() => some(x.concat("?")), () => none)))));
        $(out.pushLast(East.print(s.firstMap((_$, x) => x.contains("r").ifElse(() => some(x), () => none)))));
        $(out.pushLast(East.print(s.mapReduce((_$, x) => x, (_$, p, q) => p.concat(q)))));
        $(out.pushLast(East.print(s.reduce((_$, acc, x) => acc.concat(x), ""))));
        $(out.pushLast(East.print(s.toSet((_$, x) => x.concat("#")))));
        $(out.pushLast(East.print(s.toDict((_$, x) => x))));
        $(out.pushLast(East.print(ints.flattenToArray((_$, x) => East.Array.range(0n, x.remainder(3n))))));
        $(out.pushLast(East.print(ints.flattenToSet((_$, x) => East.Array.range(x.multiply(10n), x.multiply(10n).add(2n)).toSet()))));
        $(out.pushLast(East.print(ints.flattenToDict((_$, x) => East.Array.range(0n, x.remainder(3n)).toDict((_$, y, _i) => East.str`${x}:${y}`)))));
        $(out.pushLast(East.print(ints.groupReduce((_$, x) => x.remainder(2n), (_$, _k) => 0n, (_$, acc, x) => acc.add(x)))));
        $(out.pushLast(East.print(s.scan((_$, acc, x) => acc.concat(x), ""))));
        return out;
      }),
      inputs: [tags, intSet],
    },
    {
      label: "corpus.setMutations",
      fn: East.function([Tags, Tags], Tags, ($, s, other) => {
        $(s.insert("zz"));
        $(s.delete("alpha"));
        $(s.tryInsert("beta"));
        $(s.tryDelete("nope"));
        $(s.unionInPlace(other));
        return s;
      }),
      inputs: [tags, new Set(["m1", "m2"])],
    },
    {
      label: "corpus.dictReads",
      fn: East.function([Table], ArrayType(StringType), ($, d) => {
        const out = $.let([], ArrayType(StringType));
        $(out.pushLast(East.print(d.size())));
        $(out.pushLast(d.get(3n)));
        $(out.pushLast(d.get(99n, () => "missing")));
        $(out.pushLast(Expr.match(d.tryGet(2n), { some: (_$, v) => v, none: () => "none" })));
        $(out.pushLast(East.print(d.has(4n))));
        $(out.append(d.keys().toArray((_$, k) => East.print(k))));
        $(out.pushLast(East.print(d.getKeys(new Set([2n, 3n])))));
        return out;
      }),
      inputs: [table],
    },
    {
      label: "corpus.dictCombinators",
      fn: East.function([Table], ArrayType(StringType), ($, d) => {
        const out = $.let([], ArrayType(StringType));
        $(out.append(d.map((_$, v) => v.concat("!")).toArray()));
        $(out.append(d.filter((_$, _v, k) => East.equal(k.remainder(2n), 0n)).toArray()));
        $(out.append(d.toArray((_$, v, k) => East.str`${k}=${v}`)));
        $(out.pushLast(d.reduce((_$, acc, v) => acc.concat(v), "")));
        $(out.pushLast(East.print(d.copy())));
        $(out.pushLast(East.print(d.filterMap((_$, v, k) => East.equal(k.remainder(2n), 1n).ifElse(() => some(v), () => none)))));
        $(out.pushLast(East.print(d.firstMap((_$, v, _k) => v.contains("3").ifElse(() => some(v), () => none)))));
        $(out.pushLast(East.print(d.mapReduce((_$, v, _k) => v, (_$, p, q) => p.concat(q)))));
        $(out.pushLast(East.print(d.toSet((_$, _v, k) => k))));
        $(out.pushLast(East.print(d.toDict((_$, _v, k) => k.multiply(2n)))));
        $(out.pushLast(East.print(d.flattenToArray((_$, v, _k) => [v, v]))));
        $(out.pushLast(East.print(d.flattenToSet((_$, _v, k) => East.Array.range(k.multiply(10n), k.multiply(10n).add(2n)).toSet()))));
        $(out.pushLast(East.print(d.flattenToDict((_$, v, k) => East.Array.range(0n, k.remainder(3n)).toDict((_$, y, _i) => East.str`${k}:${y}`)))));
        $(out.pushLast(East.print(d.groupReduce((_$, _v, k) => k.remainder(2n), (_$, _k) => "", (_$, acc, v, _k) => acc.concat(v)))));
        $(out.pushLast(East.print(d.scan((_$, acc, v, _k) => acc.concat(v), ""))));
        return out;
      }),
      inputs: [table],
    },
    {
      label: "corpus.dictMutations",
      fn: East.function([Table, Table], Table, ($, d, other) => {
        $(d.insert(100n, "inserted"));
        $(d.update(0n, "updated"));
        $(d.insertOrUpdate(1n, "upserted", (_$, a, b, _k) => a.concat(b)));
        const _got = $.let(d.getOrInsert(50n, (_$, _k) => "defaulted"));
        const _old = $.let(d.swap(3n, "swapped"));
        $(d.merge(0n, "+m", (_$, existing, value) => existing.concat(value)));
        const _popped = $.let(d.pop(4n));
        $(d.delete(2n));
        $(d.tryDelete(999n));
        $(d.unionInPlace(other, (_$, v1, v2) => v1.concat(v2)));
        $(d.mergeAll(other, (_$, v1, v2) => v1.concat(v2), () => "dflt"));
        return d;
      }),
      inputs: [table, new Map<bigint, string>([[1n, "-u1"], [200n, "-u2"]])],
    },
    {
      label: "corpus.clears",
      fn: East.function([Arr, Tags, Table], NullType, ($, a, s, d) => {
        $(a.clear());
        $(s.clear());
        $(d.clear());
        return null;
      }),
      inputs: [nums, tags, table],
    },
    {
      label: "corpus.forEachSinks",
      fn: East.function([Arr, Tags, Table], ArrayType(StringType), ($, a, s, d) => {
        const sink = $.let([], ArrayType(StringType));
        $(a.forEach((_$, x) => sink.pushLast(East.print(x))));
        $(s.forEach((_$, x) => sink.pushLast(x)));
        $(d.forEach((_$, v, _k) => sink.pushLast(v)));
        return sink;
      }),
      inputs: [nums, tags, table],
    },
    {
      label: "corpus.vectorBridges",
      fn: East.function([ArrayType(FloatType)], ArrayType(StringType), ($, fa) => {
        const out = $.let([], ArrayType(StringType));
        $(out.pushLast(East.print(East.Vector.fromArray(fa))));
        return out;
      }),
      inputs: [[1.5, 2.5, -3.5, 4.0]],
    },
    {
      // Matrix bridges take Array-of-Array / Array-of-Vector inputs — shapes
      // the gate always opens eagerly (see UNREACHABLE_BY_GATE). This case
      // pins the policy equivalence for them regardless.
      label: "corpus.matrixBridges",
      expectLazy: false,
      fn: East.function([ArrayType(ArrayType(FloatType))], ArrayType(StringType), ($, nested) => {
        const out = $.let([], ArrayType(StringType));
        $(out.pushLast(East.print(East.Matrix.fromArray(nested))));
        $(out.pushLast(East.print(East.Matrix.fromRows(nested.map((_$, row) => East.Vector.fromArray(row))))));
        return out;
      }),
      inputs: [[[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]],
    },
    {
      label: "corpus.stringJoinAndCsv",
      fn: East.function([ArrayType(StringType), ArrayType(Row)], ArrayType(StringType), ($, words, rows) => {
        const out = $.let([], ArrayType(StringType));
        $(out.pushLast(words.stringJoin(", ")));
        $(out.pushLast(East.print(rows.encodeCsv())));
        return out;
      }),
      inputs: [
        ["alpha", "beta", "gamma", "delta", "epsilon"],
        [{ id: 1n, name: "a" }, { id: 2n, name: "b" }, { id: 3n, name: "c" }, { id: 4n, name: "d" }],
      ],
    },
    {
      label: "corpus.arrayFindFirstRawIR",
      // findFirst() lowers to firstMap at the fluent surface, so the
      // ArrayFindFirst builtin is reachable only from replayed IR — build the
      // node directly; its interpreter walks the array by index reads under
      // the iteration lock, exactly the lazy-served path worth pinning.
      fn: East.function([Arr], OptionType(IntegerType), ($, a) => {
        const by = East.function([IntegerType], IntegerType, (_$, v) => v.multiply(2n));
        return Expr.fromAst({
          ast_type: "Builtin",
          type: OptionType(IntegerType),
          loc_id: 0,
          builtin: "ArrayFindFirst",
          type_parameters: [IntegerType, IntegerType],
          arguments: [Expr.ast(a), Expr.ast(East.value(8n)), Expr.ast(by)],
        } as never) as never;
      }),
      inputs: [nums],
    },
    {
      label: "corpus.errorParity",
      fn: East.function([Arr, Table], NullType, ($, a, d) => {
        const _row = $.let(a.get(9999n));
        const _val = $.let(d.get(9999n));
        return null;
      }),
      inputs: [nums, table],
    },
    {
      // The item-5 regression trap: element shapes that transitively contain
      // a mutable container. East's runtime is reference-semantic for nested
      // containers, so writes through a read-out element must land in the
      // input — the shape gate routes these inputs to the EAGER decode.
      // Opened lazily instead (i.e. if the gate ever weakens), the writes
      // would land on throwaway pager decodes and the result and post-call
      // input-state assertions here would fail.
      label: "corpus.nestedElementMutation",
      expectLazy: false,
      fn: East.function([NestedTable, NestedRows], IntegerType, ($, d, a) => {
        const row = $.let(d.get(1n));
        $(row.xs.pushLast(42n));    // write through a read-out Dict value
        const el = $.let(a.get(0n));
        $(el.inner.pushLast(7n));   // write through a read-out Array element
        return d.get(1n).xs.size().add(a.get(0n).inner.size());
      }),
      inputs: [nestedTable, nestedRows],
    },
  ];

  test("every corpus case is lazy/eager equivalent", async () => {
    for (const c of corpus) {
      await sweep(c, covered);
    }
  });

  test("coverage gate: every collection builtin is exercised under laziness", () => {
    const audit = auditBuiltins();
    const missing = audit.filter((name) => !covered.has(name));
    assert.deepEqual(missing, [],
      `collection builtins with no lazy-input coverage — add a corpus case: ${missing.join(", ")}`);
  });
});

describe("lazy inputs — iteration semantics (#510)", () => {
  const Table = DictType(IntegerType, StringType);
  const table = new Map<bigint, string>(Array.from({ length: 10 }, (_, i) => [BigInt(i), `row-${i}`]));
  const tableBlob = encodeBeast2PagedFor(Table, SWEEP_BATCH)(table);
  const openers = [
    ["eager", decodeBeast2For(Table)],
    ["lazy", openBeast2LazyFor(Table)],
  ] as const;

  test("mutating a dict inside its own loop throws the canonical error, lazy and eager alike", () => {
    const fn = East.function([Table], NullType, ($, d) => {
      $.for(d, (_$, _value, _key) => d.insert(999n, "x"));
      return null;
    });
    const compiled = fn.toIR().compile([]);
    for (const [label, open] of openers) {
      assert.throws(() => compiled(open(tableBlob)), /Cannot modify Dict during iteration/, label);
    }
  });

  test("mutating between passes hydrates transparently and is visible to the next pass", () => {
    const fn = East.function([Table], ArrayType(IntegerType), ($, d) => {
      const seen = $.let([], ArrayType(IntegerType));
      $.for(d, (_$, _value, key) => seen.pushLast(key));
      $(d.insert(999n, "added"));
      $.for(d, (_$, _value, key) => seen.pushLast(key));
      return seen;
    });
    const compiled = fn.toIR().compile([]);
    const results = openers.map(([, open]) => compiled(open(tableBlob)) as bigint[]);
    assert.equal(results[0]!.length, 21, "10 first-pass + 11 second-pass keys");
    assert.deepEqual(results[1], results[0], "lazy pass order equals eager pass order");
  });

  test("hydration mid-loop keeps the in-flight iteration yielding the canonical sequence", () => {
    const Tags = SetType(StringType);
    const tags = new Set(Array.from({ length: 9 }, (_, i) => `tag-${i}`));
    const blob = encodeBeast2PagedFor(Tags, SWEEP_BATCH)(tags);
    const fn = East.function([Tags, Tags], ArrayType(StringType), ($, s, other) => {
      const seen = $.let([], ArrayType(StringType));
      $.for(s, ($, k) => {
        // isSubsetOf hydrates the lazy set on the first iteration — the loop
        // must keep yielding from the immutable pages regardless.
        const _hydrating = $.let(s.isSubsetOf(other));
        $(seen.pushLast(k));
      });
      return seen;
    });
    const compiled = fn.toIR().compile([]);
    const other = new Set(["tag-0"]);
    const eager = compiled(decodeBeast2For(Tags)(blob), other) as string[];
    const lazy = compiled(openBeast2LazyFor(Tags)(blob), other) as string[];
    assert.equal(eager.length, 9);
    assert.deepEqual(lazy, eager, "mid-loop hydration must not disturb the sequence");
  });
});
