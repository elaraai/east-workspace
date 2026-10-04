/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Splitting a query over a dataset's pieces (#941). Each rule's piece
 * program, merge and final function, encoded and decoded as a runner reads
 * them, and run over the shared fixture cut into pieces and assembled as e3
 * assembles them, give what the one unit gives, empty pieces included (N1);
 * each split's explanation, and each reason a query stays one unit, is pinned
 * (N1's golden plans), with the reads that prune (N2's names); the programs
 * encode to the same bytes each time, which e3's cache keys a unit on; and a
 * piece's runtime error names its place in the jq. A piece that folds its
 * rows by key in a table gives the same answer however often it flushes the
 * table, and whether or not it bypasses it, with keys few and all different,
 * and sends each key once per flush until the table holds a key too many
 * (#1093). The first rows of a sort, a dict's entries as rows, a join of two
 * dicts cut at the same keys — by either one's keys — and a join re-keyed
 * first, the re-key call's rows each key's in input order, give what the one
 * unit gives too, and their golden plans are pinned (#942, O3). */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ArrayType, DictType, EastError, EastTypeType, FloatType, IntegerType, SortedMap, SortedSet, StringType, StructType,
  checkJq, compareFor, decodeEastIR, encodeEastIR, equalFor, printFor, splitJq, toEastTypeValue, translateJq,
  type EastType, type FunctionExpr, type JqSplit, type JqSplitCall, type JqRange, type SplitJqOptions, type ValueTypeOf,
} from "../src/index.js";
import { FixtureRoot, Order, queryFixture } from "./query.fixture.js";

const fixture = queryFixture() as unknown as Record<string, unknown>;

/** A function as a runner gets it: its IR encoded, decoded and compiled. */
function asRun(fn: FunctionExpr<any[], any>): (...args: unknown[]) => unknown {
  return decodeEastIR(encodeEastIR(fn.toIR())).compile([]) as (...args: unknown[]) => unknown;
}

/** A collection cut into `k` pieces in order, as ranges of its rows: some empty when `k` is more than its rows. */
function cut(value: unknown, type: EastType, k: number): unknown[] {
  const t = type.type === "Recursive" ? type.node as EastType : type;
  if (t.type === "Array") {
    const rows = value as unknown[];
    return Array.from({ length: k }, (_, i) => rows.slice(Math.floor(i * rows.length / k), Math.floor((i + 1) * rows.length / k)));
  }
  const key = (t as { key: EastType }).key;
  const entries = t.type === "Dict" ? [...(value as SortedMap<unknown, unknown>).entries()] : [...(value as SortedSet<unknown>)].map(k2 => [k2, null] as const);
  return Array.from({ length: k }, (_, i) => {
    const part = entries.slice(Math.floor(i * entries.length / k), Math.floor((i + 1) * entries.length / k));
    return t.type === "Dict" ? new SortedMap(part as [unknown, unknown][], compareFor(key)) : new SortedSet(part.map(([k2]) => k2), compareFor(key));
  });
}

/**
 * A dict cut at fences, as e3 cuts datasets partitioned together: its
 * entries below the first fence, then from each fence up to the next, then
 * from the last on; padded with empty pieces to `k`.
 */
function cutAt(value: unknown, type: EastType, fences: readonly unknown[], k: number): unknown[] {
  const key = ((type.type === "Recursive" ? type.node : type) as { key: EastType }).key;
  const compare = compareFor(key);
  const entries = [...(value as SortedMap<unknown, unknown>).entries()];
  return Array.from({ length: k }, (_, i) => {
    if (i > fences.length) return new SortedMap([], compare);
    const lo = i === 0 ? undefined : fences[i - 1];
    const hi = i === fences.length ? undefined : fences[i];
    return new SortedMap(entries.filter(([k2]) => (lo === undefined || compare(k2, lo) >= 0) && (hi === undefined || compare(k2, hi) < 0)), compare);
  });
}

/** The fences that cut a dict into `k` pieces of its entries, as `cut` cuts it: the first key of each piece but the first, up to its last key. */
function fencesOf(value: unknown, k: number): unknown[] {
  const keys = [...(value as SortedMap<unknown, unknown>).keys()];
  const fences: unknown[] = [];
  for (let i = 1; i < k; i++) {
    const at = Math.floor(i * keys.length / k);
    if (at >= keys.length) break;
    fences.push(keys[at]);
  }
  return fences;
}

/** A split call's parts, as {@link runCall} runs them. */
interface Call {
  readonly inputs: readonly { name: string; type: EastType }[];
  readonly output: JqSplitCall["output"];
  piece(): FunctionExpr<any[], any>;
  then(): FunctionExpr<any[], any> | null;
}

/**
 * A split call run as e3 runs it: each piece's program over its piece of every
 * partitioned input — the one cut into `pieces`, or several cut at the same
 * keys, `fencesBy`'s — and the other inputs whole, the pieces' outputs
 * assembled by the output kind — an array concatenated, a set united in
 * East's order, a dict's equal keys merged in input order, a fold combined
 * from its zero, a piece at a time and then across them — and the final
 * function over the assembled output and the inputs.
 */
function runCall(call: Call, values: Readonly<Record<string, unknown>>, partitioned: readonly string[], pieces: number, fencesBy = partitioned[0]!): unknown {
  const args = call.inputs.map(input => values[input.name]);
  const fences = partitioned.length > 1 ? fencesOf(values[fencesBy], pieces) : undefined;
  const parts = new Map(partitioned.map(name => {
    const input = call.inputs.find(i => i.name === name)!;
    return [name, fences === undefined ? cut(values[name], input.type, pieces) : cutAt(values[name], input.type, fences, pieces)] as const;
  }));
  const piece = asRun(call.piece());
  const emitted = Array.from({ length: pieces }, (_, p) => {
    const out: unknown[][] = [];
    piece(...call.inputs.map((input, i) => parts.has(input.name) ? parts.get(input.name)![p] : args[i]), (...emit: unknown[]) => { out.push(emit); return null; });
    return out;
  });
  const output = call.output;
  let assembled: unknown;
  switch (output.kind) {
    case "array":
      assembled = emitted.flatMap(part => part.map(([row]) => row));
      break;
    case "set":
      assembled = new SortedSet(emitted.flatMap(part => part.map(([row]) => row)), compareFor((output.type as any).key));
      break;
    case "dict": {
      const merge = asRun(output.merge());
      const dict = new SortedMap<unknown, unknown>([], compareFor((output.type as any).key));
      for (const part of emitted) for (const [key, value] of part) dict.set(key, dict.has(key) ? merge(key, dict.get(key), value) : value);
      assembled = dict;
      break;
    }
    case "fold": {
      const combine = asRun(output.combine());
      const partials = emitted.map(part => part.reduce((acc: unknown, [value]) => combine(acc, value), output.zero));
      assembled = partials.reduce((acc: unknown, value) => combine(acc, value), output.zero);
      break;
    }
  }
  const then = call.then();
  return then === null ? assembled : asRun(then)(assembled, ...args);
}

/** A split over some data — the shared fixture's by default — cut into pieces, with what it partitions with its dataset cut at the same keys, the fences `fencesBy`'s. */
function runSplit(split: JqSplitCall, pieces: number, data: Readonly<Record<string, unknown>> = fixture, fencesBy = split.over): unknown {
  return runCall(split, data, [split.over, ...split.copartitioned], pieces, fencesBy);
}

/**
 * A split's re-keyed join run as the planner runs it (#942): the re-key call
 * over the dataset cut into pieces, and the join call over its output and the
 * joined dict cut at the same keys, the fences the re-keyed rows' or the
 * dict's.
 */
function runRekey(split: JqSplitCall, pieces: number, data: Readonly<Record<string, unknown>> = fixture, fencesBy: "rows" | "joined" = "rows"): unknown {
  const rekey = split.rekey!;
  const rekeyed = runCall({ inputs: [split.inputs.find(i => i.name === split.over)!], output: rekey.output, piece: rekey.piece, then: () => null }, data, [split.over], pieces);
  const join = { inputs: rekey.inputs, output: split.output, piece: rekey.joinPiece, then: rekey.joinThen };
  return runCall(join, { ...data, [split.over]: rekeyed }, [split.over, rekey.name], pieces, fencesBy === "rows" ? split.over : rekey.name);
}

/** Whether two East values of a type are equal, Floats to within rounding: a sum's grouping changes its last bits. */
function close(type: EastType, a: unknown, b: unknown): boolean {
  const t = type.type === "Recursive" ? type.node as EastType : type;
  switch (t.type) {
    case "Float": {
      const x = a as number;
      const y = b as number;
      return equalFor(t)(x, y) || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
    }
    case "Array": {
      const xs = a as unknown[];
      const ys = b as unknown[];
      return xs.length === ys.length && xs.every((x, i) => close(t.value as EastType, x, ys[i]));
    }
    case "Struct":
      return Object.entries(t.fields as Record<string, EastType>).every(([name, field]) => close(field, (a as any)[name], (b as any)[name]));
    case "Variant": {
      const x = a as { type: string; value: unknown };
      const y = b as { type: string; value: unknown };
      return x.type === y.type && close((t.cases as Record<string, EastType>)[x.type]!, x.value, y.value);
    }
    case "Dict": {
      const x = [...(a as SortedMap<unknown, unknown>).entries()];
      const y = [...(b as SortedMap<unknown, unknown>).entries()];
      const sameKey = equalFor(t.key as EastType);
      return x.length === y.length && x.every(([k, v], i) => sameKey(k, y[i]![0]) && close(t.value as EastType, v, y[i]![1]));
    }
    default:
      return equalFor(type)(a as never, b as never);
  }
}

/** A query checked against a root: the fixture's, by default. */
function checked(program: string, root: EastType = FixtureRoot) {
  const result = checkJq(program, root, { root: true });
  assert.ok(result.program !== null, `${program}: ${result.diagnostics.map(d => d.message).join(" ")}`);
  return result;
}

/** A query's split, its multiplicity's limit as the builder sends it. */
function split(program: string, maxOutputs = 1000, root: EastType = FixtureRoot): JqSplit {
  const c = checked(program, root);
  return splitJq(c, c.multiplicity === "many" ? { maxOutputs } : {});
}

// ─── Two dicts keyed alike, for the joins cut at the same keys (#942) ───────

/** A store's stock on hand and its prices, each by SKU, and order lines by SKU: the shared fixture has no two dicts keyed alike. */
const StockRoot = StructType({
  stock: DictType(StringType, IntegerType),
  prices: DictType(StringType, FloatType),
  lines: ArrayType(StructType({ sku: StringType, qty: IntegerType })),
});

/** 37 SKUs in stock, every third unpriced, and 19 priced with none in stock; 60 lines over all of them. */
const stockData: Readonly<Record<string, unknown>> = (() => {
  const compare = compareFor(StringType);
  const sku = (i: number): string => `S${String(i).padStart(3, "0")}`;
  const stock = new SortedMap<string, bigint>(Array.from({ length: 37 }, (_, i) => [sku(i * 2), BigInt((i * 7) % 11)] as const), compare);
  const prices = new SortedMap<string, number>([
    ...Array.from({ length: 37 }, (_, i) => i).filter(i => i % 3 !== 0).map((i): [string, number] => [sku(i * 2), ((i * 37) % 100) / 4 + 0.1]),
    ...Array.from({ length: 19 }, (_, i): [string, number] => [sku(i * 4 + 1), i + 0.5]),
  ], compare);
  const lines = Array.from({ length: 60 }, (_, i) => ({ sku: sku((i * 13) % 80), qty: BigInt(1 + (i % 4)) }));
  return { stock, prices, lines };
})();

// ─── Equivalence ──────────────────────────────────────────────────────────

/** Queries the pieces must agree with the one unit on: every combine, every leaf, every row step. */
const SPLITS: readonly string[] = [
  // The rows concatenated, and what runs once over them.
  ".orders | map(select(.status.type == \"shipped\")) | sort_by(-.total) | .[:5] | map(.id)",
  ".orders | map(.lines) | flatten | map(.sku)",
  "[.orders[] | select(.total > 1000) | .id]",
  ".orders | [.[] | .lines[] | .sku]",
  ".orders | [.[] | . as $o | .lines[] | {order: $o.id, sku}]",
  ".customers as $c | .orders | map({id, region: $c[.customer_id].region})",
  ".orders | map(select(.total > 500)) | {counts: [length], result: .[:1000]}",
  ".orders | map(select(.total > 100)) | .[] | .id",
  // Totals.
  ".orders | map(.total) | add",
  ".orders | map(.lines | length) | add",
  ".orders | map(.customer_id) | add",
  ".orders | map(.lines) | add | length",
  ".orders | map(.discount) | add",
  ".orders | map(select(.total > 500)) | length",
  ".orders | min_by(.total) | .id",
  ".orders | max_by(.customer_id) | .id",
  ".orders | min_by(.lines[].qty) | .id",
  ".orders | map(.total) | min",
  ".orders | map(.total) | max",
  ".orders | map(.total) | first",
  ".orders | map(.total) | last",
  ".orders | map(.total) | .[0]",
  ".orders | map(.total) | .[-1]",
  ".orders | any(.total > 3000)",
  ".orders | all(.total > 10)",
  ".orders | map(.total > 1000) | any",
  ".orders | map(.customer_id) | unique | length",
  ".orders | {n: length, total: (map(.total) | add), mean: (map(.total) | add / length)}",
  ".orders | if length > 0 then (map(.total) | max) else 0 end",
  ".orders | map(select(.total > 100)) | {big: (map(.total) | max // 0), first: (.[0].id // 0)}",
  ".byId | map(.total) | add",
  ".cells | add",
  // Groups.
  ".orders | group_by(.customer_id) | map({customer: .[0].customer_id, revenue: map(.total) | add, n: length})",
  ".customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, mean: (map(.total) | add / length), lo: (map(.total) | min), hi: (map(.total) | max), skus: (map(.lines[].sku) | unique | length)})",
  ".orders | group_by(.status.type) | map({status: .[0].status.type, ids: map(.id)})",
  ".orders | group_by(.customer_id) | map(sort_by(.total) | .[0].id)",
  ".orders | group_by(.customer_id) | map(length) | add",
  ".orders | group_by(.customer_id) | map(max_by(.total) | .id)",
  // Distinct rows, and the first of each key.
  ".orders | map(.customer_id) | unique",
  "[.orders[] | .lines[] | .sku] | unique",
  ".orders | unique_by(.customer_id) | map(.id)",
  // A reduce into a dict.
  "reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)",
  ".orders | reduce .[] as $o ({}; .[$o.customer_id] = $o.id)",
  "reduce .orders[] as $o ({}; .[$o.customer_id] += 1)",
  // The first rows of a sort (#942): ties kept in input order, as the one unit's stable sort keeps them.
  ".orders | sort_by(.customer_id) | .[:7] | map(.id)",
  ".orders | map(select(.total > 100)) | sort_by(.status.type, .customer_id) | .[2:6] | map(.id)",
  ".orders | sort_by(.lines | length) | .[0].id",
  ".orders | map(.customer_id) | sort | first",
  ".orders | sort_by(.total) | .[:0]",
  ".orders | sort_by(.total) | .[:100] | length",
  ".byId | map(.total) | sort | .[3]",
  "[.orders[] | .lines[] | .sku] | sort | .[:4]",
  "[.orders[] | .lines[] | {sku, qty}] | sort_by(.qty) | .[:3]",
  ".customers as $c | .orders | sort_by($c[.customer_id].name) | .[:5] | map(.id)",
  // The entries of a dict as rows (#942).
  ".byId | to_entries | map(select(.value.total > 1000) | .key)",
  "[.customers | to_entries[] | {id: .key, name: .value.name}]",
  ".byId | to_entries | map(.value.total) | add",
];

describe("a split query gives what the one unit gives (N1)", () => {
  for (const program of SPLITS) {
    test(program, () => {
      const c = checked(program);
      const options = c.multiplicity === "many" ? { maxOutputs: 1000 } : {};
      const s = splitJq(c, options);
      assert.equal(s.kind, "split", s.kind === "whole" ? `${s.reason.code} ${s.reason.name}` : "");
      if (s.kind !== "split") return;
      const translation = translateJq(c, options);
      assert.deepEqual(s.inputs.map(i => i.name), translation.inputs.map(i => i.name), "the inputs, in the translation's order");
      assert.ok(equalFor(EastTypeType)(toEastTypeValue(s.resultType), toEastTypeValue(translation.resultType)), "the result type, the translation's");
      const expected = asRun(translation.fn())(...translation.inputs.map(i => fixture[i.name!]));
      // One piece, a few, more pieces than rows: some empty.
      for (const pieces of [1, 2, 3, 7, 64]) {
        const got = runSplit(s, pieces);
        assert.ok(close(translation.resultType, got, expected), `${pieces} pieces: ${printFor(translation.resultType)(got as never)} is not ${printFor(translation.resultType)(expected as never)}`);
      }
    });
  }

  test("a many query's final function keeps the limit and one more, as the translation does", () => {
    const program = ".orders | map(select(.total > 100)) | .[] | .id";
    const s = split(program, 5);
    assert.ok(s.kind === "split");
    const ids = runSplit(s, 3) as bigint[];
    assert.equal(ids.length, 6);
    const translation = translateJq(checked(program), { maxOutputs: 5 });
    assert.ok(close(translation.resultType, ids, asRun(translation.fn())(fixture.orders)));
  });

  test("rows that are the query's result need no final function", () => {
    const s = split(".orders | map(.id)");
    assert.ok(s.kind === "split" && s.output.kind === "array");
    assert.equal(s.then(), null);
  });

  test("a piece holding more rows than twice those a sort keeps, and 64, cuts them back on the way (#942)", () => {
    // `[.orders[] | .lines[] | {sku, qty}] | sort_by(.qty) | .[:3]`, above, keeps 3: one piece of every line cuts back at 70.
    const lines = (fixture.orders as ValueTypeOf<typeof Order>[]).flatMap(order => order.lines);
    assert.ok(lines.length > 2 * 3 + 64, `${lines.length} lines`);
  });
});

// ─── The piece's table (#1093) ────────────────────────────────────────────

/** Whether a split's pieces fold their rows by key in a table: every output that combines by key but a grouping that keeps its rows. */
function foldsInPiece(s: JqSplitCall): boolean {
  const c = s.stages.combine;
  return c.kind === "distinct" || c.kind === "distinct_by" || c.kind === "reduce" || (c.kind === "group" && c.totals !== null);
}

/** Queries whose pieces fold by key: the equivalence queries' — keys few, the eight customers and SKUs — and keys all different, the order ids. */
const TABLES: readonly string[] = [
  ...SPLITS.filter(program => {
    const s = split(program);
    return s.kind === "split" && foldsInPiece(s);
  }),
  ".orders | group_by(.id) | map({id: .[0].id, revenue: map(.total) | add, n: length})",
  ".orders | map(.id) | unique",
  ".orders | unique_by(.id) | map(.total)",
  "reduce .orders[] as $o ({}; .[$o.id | tostring] += $o.total)",
];

/** The table's flushes: the defaults, flushes forced every few rows with no bypass, the bypass forced at the first key, flushes then a bypass within one, and the share's own. */
const FLUSHES: readonly SplitJqOptions[] = [
  {},
  ...[1, 2, 3, 7].flatMap(flushRows => [{ flushRows, bypassRatio: 1 }, { flushRows, bypassRatio: 0 }]),
  { flushRows: 7, bypassRatio: 0.8 },
  { flushRows: 64 },
];

/** What one piece sends: its program run over a part of the dataset, the arguments of each send in order. */
function sent(s: JqSplitCall, part: unknown): unknown[][] {
  const out: unknown[][] = [];
  asRun(s.piece())(...s.inputs.map(input => input.name === s.over ? part : fixture[input.name]), (...args: unknown[]) => { out.push(args); return null; });
  return out;
}

/** The number of different customers among some orders. */
function customers(orders: readonly ValueTypeOf<typeof Order>[]): number {
  return new SortedSet(orders.map(order => order.customer_id), compareFor(StringType)).size;
}

/**
 * What a piece that folds orders by customer sends, as its table works: each
 * customer once per flush of `flushRows` orders and at the end, until an
 * order's customer makes the flush's customers more than `bypassRatio` of its
 * orders; that order sends the table on, and each order after it goes on its
 * own.
 */
function sends(orders: readonly ValueTypeOf<typeof Order>[], flushRows: number, bypassRatio: number): number {
  const most = Math.floor(bypassRatio * flushRows);
  let count = 0;
  let flush: ValueTypeOf<typeof Order>[] = [];
  for (let at = 0; at < orders.length; at++) {
    flush.push(orders[at]!);
    if (customers(flush) > most) return count + customers(flush) + orders.length - at - 1;
    if (flush.length === flushRows) {
      count += customers(flush);
      flush = [];
    }
  }
  return count + customers(flush);
}

describe("a piece's table gives what the one unit gives, however it flushes (#1093)", () => {
  test("the queries that fold by key in their pieces include every kind of table, keys few and all different", () => {
    const kinds = new SortedSet(TABLES.map(program => (split(program) as JqSplitCall).stages.combine.kind), compareFor(StringType));
    assert.deepEqual([...kinds], ["distinct", "distinct_by", "group", "reduce"]);
  });

  for (const program of TABLES) {
    test(program, () => {
      const c = checked(program);
      const limit = c.multiplicity === "many" ? { maxOutputs: 1000 } : {};
      const translation = translateJq(c, limit);
      const expected = asRun(translation.fn())(...translation.inputs.map(i => fixture[i.name!]));
      for (const flushes of FLUSHES) {
        const s = splitJq(c, { ...limit, ...flushes });
        assert.ok(s.kind === "split" && foldsInPiece(s));
        for (const pieces of [1, 2, 3, 7, 64]) {
          const got = runSplit(s, pieces);
          assert.ok(close(translation.resultType, got, expected),
            `flushRows ${flushes.flushRows ?? "default"}, bypassRatio ${flushes.bypassRatio ?? "default"}, ${pieces} pieces: ${printFor(translation.resultType)(got as never)} is not ${printFor(translation.resultType)(expected as never)}`);
        }
      }
    });
  }

  const byCustomer = ".orders | group_by(.customer_id) | map({customer: .[0].customer_id, revenue: map(.total) | add})";
  const orders = fixture.orders as ValueTypeOf<typeof Order>[];

  test("a piece sends each key once, with fewer rows than a flush", () => {
    const s = split(byCustomer);
    assert.ok(s.kind === "split");
    assert.equal(sent(s, orders).length, 8);
    assert.equal(customers(orders), 8);
  });

  test("a piece sends each key once per flush, until its table holds a key too many", () => {
    // Every kind of table, keyed by the orders' customers.
    const keyedByCustomer = [
      byCustomer,
      ".orders | map(.customer_id) | unique",
      ".orders | unique_by(.customer_id) | map(.id)",
      "reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)",
    ];
    for (const program of keyedByCustomer) {
      for (const flushRows of [1, 2, 3, 7, 32, 64]) {
        for (const bypassRatio of [0, 0.5, 0.8, 1]) {
          const s = splitJq(checked(program), { flushRows, bypassRatio });
          assert.ok(s.kind === "split");
          assert.equal(sent(s, orders).length, sends(orders, flushRows, bypassRatio), `${program}: flushRows ${flushRows}, bypassRatio ${bypassRatio}`);
        }
        // The share's own, when none is given: 1/32 of a flush's rows.
        const s = splitJq(checked(program), { flushRows });
        assert.ok(s.kind === "split");
        assert.equal(sent(s, orders).length, sends(orders, flushRows, 1 / 32), `${program}: flushRows ${flushRows}, the share's own`);
      }
    }
    // Seven orders a flush: 5, 5, 5, 6, 5 and 4 customers. With no bypass, each
    // flush sends its customers, 30 in all. A share of 0.8 allows 5 keys in 7
    // rows: the fourth flush's sixth customer, on its last order, sends the
    // table on, and the last 12 orders go on their own. Forced, the first order
    // sends the table on, and the other 39 go on their own. The share's own
    // allows 2 keys in 64 rows: the third order's customer, the third, sends
    // the table on.
    assert.equal(sends(orders, 7, 1), 30);
    assert.equal(sends(orders, 7, 0.8), 33);
    assert.equal(sends(orders, 7, 0), 40);
    assert.equal(sends(orders, 64, 1 / 32), 40);
    // Keys all different bypass at the first key too many, and every row is sent.
    const ids = splitJq(checked(".orders | unique_by(.id) | map(.total)"), { flushRows: 7, bypassRatio: 0.8 });
    assert.ok(ids.kind === "split");
    assert.equal(sent(ids, orders).length, orders.length);
  });

  test("a piece's empty part sends nothing", () => {
    for (const program of TABLES) {
      const s = split(program);
      assert.ok(s.kind === "split");
      const part = cut(fixture[s.over], s.inputs.find(input => input.name === s.over)!.type, 64)[0];
      assert.deepEqual(sent(s, part), [], program);
    }
  });

  test("a flush of fewer than one row, or a share outside 0 to 1, is refused", () => {
    for (const flushes of [{ flushRows: 0 }, { flushRows: 2.5 }, { bypassRatio: -0.1 }, { bypassRatio: 1.5 }, { bypassRatio: Number.NaN }]) {
      const s = splitJq(checked(byCustomer), flushes);
      assert.ok(s.kind === "split");
      assert.throws(() => s.piece(), RangeError);
    }
  });
});

// ─── Joins (#942) ─────────────────────────────────────────────────────────

/** Joins over the stock root whose pieces read the other dict only at the row's key: it is cut at the same keys. */
const COPARTITIONED: readonly (readonly [program: string, dict: string])[] = [
  [".prices as $p | .stock | to_entries | map({sku: .key, worth: (.value * ($p[.key] // 0))})", "prices"],
  [".prices as $p | .stock | to_entries | map(.value * ($p[.key] // 0)) | add", "prices"],
  [".prices as $p | [.stock | to_entries[] | .key as $k | select($p | has($k) | not) | $k]", "prices"],
  [".prices as $p | .stock | to_entries | map(select(.value > 3)) | map({sku: .key, worth: (.value * ($p[.key] // 0))}) | sort_by(-.worth) | .[:4]", "prices"],
  [".stock as $s | .prices | to_entries | map(select($s[.key] == null) | .key)", "stock"],
];

/** Joins over the fixture whose pieces read the customers only at the order's customer, with a combine the rows' order cannot change: re-keyed. */
const REKEYED: readonly string[] = [
  ".customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, n: length})",
  ".customers as $c | .orders | map($c[.customer_id].region) | unique",
  ".customers as $c | .orders | map(select($c[.customer_id].tier.type == \"gold\") | .total) | add",
  ".customers as $c | reduce .orders[] as $o ({}; .[$c[$o.customer_id].region // \"?\"] += $o.total)",
  ".customers as $c | .orders | map({tier: $c[.customer_id].tier.type, total}) | group_by(.tier) | map({tier: .[0].tier, hi: (map(.total) | max), n: length})",
];

/** Joins that are not re-keyed: a combine that keeps the rows' order, a lookup not at a field of the row, the dict read whole. */
const NOT_REKEYED: readonly string[] = [
  ".customers as $c | .orders | map({id, region: $c[.customer_id].region})",
  ".customers as $c | .orders | map(. + {name: $c[.customer_id].name}) | group_by(.name) | map(.[0].id)",
  ".customers as $c | .orders | map($c[.customer_id + \"\"].region) | unique",
  ".customers as $c | .orders | map({n: ($c | length), r: $c[.customer_id].region}) | unique",
];

describe("joins: cut at the same keys, or re-keyed (#942)", () => {
  for (const [program, dict] of COPARTITIONED) {
    test(`cut at the same keys: ${program}`, () => {
      const c = checked(program, StockRoot);
      const options = c.multiplicity === "many" ? { maxOutputs: 1000 } : {};
      const s = splitJq(c, options);
      assert.ok(s.kind === "split", s.kind === "whole" ? `${s.reason.code} ${s.reason.name}` : "");
      assert.deepEqual([s.copartitioned, s.broadcast, s.rekey], [[dict], [], null]);
      const translation = translateJq(c, options);
      const expected = asRun(translation.fn())(...translation.inputs.map(i => stockData[i.name!]));
      // Cut by either dict's keys, as e3 cuts by the one that weighs more.
      for (const fencesBy of [s.over, dict]) {
        for (const pieces of [1, 2, 3, 7, 64]) {
          const got = runSplit(s, pieces, stockData, fencesBy);
          assert.ok(close(translation.resultType, got, expected), `${pieces} pieces by ${fencesBy}: ${printFor(translation.resultType)(got as never)} is not ${printFor(translation.resultType)(expected as never)}`);
        }
      }
    });
  }

  for (const program of REKEYED) {
    test(`re-keyed: ${program}`, () => {
      const c = checked(program);
      const s = splitJq(c);
      assert.ok(s.kind === "split" && s.rekey !== null, s.kind === "whole" ? `${s.reason.code} ${s.reason.name}` : "no re-key");
      assert.deepEqual([s.rekey.name, s.broadcast, s.copartitioned], ["customers", ["customers"], []]);
      const translation = translateJq(c);
      const expected = asRun(translation.fn())(...translation.inputs.map(i => fixture[i.name!]));
      for (const pieces of [1, 2, 3, 7, 64]) {
        // Re-keyed, cut by the re-keyed rows' keys or the customers'; and the split that reads the customers whole.
        for (const fencesBy of ["rows", "joined"] as const) {
          const got = runRekey(s, pieces, fixture, fencesBy);
          assert.ok(close(translation.resultType, got, expected), `re-keyed, ${pieces} pieces by the ${fencesBy}: ${printFor(translation.resultType)(got as never)} is not ${printFor(translation.resultType)(expected as never)}`);
        }
        assert.ok(close(translation.resultType, runSplit(s, pieces), expected), `${pieces} pieces, the customers whole`);
      }
    });
  }

  for (const program of NOT_REKEYED) {
    test(`not re-keyed: ${program}`, () => {
      const s = split(program);
      assert.ok(s.kind === "split");
      assert.deepEqual([s.rekey, s.broadcast], [null, ["customers"]]);
    });
  }

  test("the re-key call's rows are each key's in input order, whatever its table does", () => {
    const s = split(REKEYED[0]!);
    assert.ok(s.kind === "split" && s.rekey !== null);
    const orders = fixture.orders as ValueTypeOf<typeof Order>[];
    const expected = new SortedMap<string, bigint[]>([], compareFor(StringType));
    for (const order of orders) expected.set(order.customer_id, [...(expected.get(order.customer_id) ?? []), order.id]);
    for (const flushes of FLUSHES) {
      const r = splitJq(checked(REKEYED[0]!), flushes);
      assert.ok(r.kind === "split" && r.rekey !== null);
      for (const pieces of [1, 3, 64]) {
        const rekeyed = runCall({ inputs: [r.inputs.find(i => i.name === "orders")!], output: r.rekey.output, piece: r.rekey.piece, then: () => null }, fixture, ["orders"], pieces) as SortedMap<string, ValueTypeOf<typeof Order>[]>;
        const ids = new SortedMap([...rekeyed.entries()].map(([k, rows]) => [k, rows.map(row => row.id)] as const), compareFor(StringType));
        assert.ok(equalFor(DictType(StringType, ArrayType(IntegerType)))(ids, expected), `flushRows ${flushes.flushRows ?? "default"}, bypassRatio ${flushes.bypassRatio ?? "default"}, ${pieces} pieces`);
      }
    }
  });
});

// ─── The programs ─────────────────────────────────────────────────────────

describe("the programs", () => {
  test("encode to the same bytes each time, which e3's cache keys a unit on", () => {
    for (const program of SPLITS) {
      const a = split(program);
      const b = split(program);
      assert.ok(a.kind === "split" && b.kind === "split");
      assert.deepEqual(encodeEastIR(a.piece().toIR()), encodeEastIR(b.piece().toIR()), `${program}: the piece program`);
      const [ta, tb] = [a.then(), b.then()];
      assert.deepEqual(ta === null ? null : encodeEastIR(ta.toIR()), tb === null ? null : encodeEastIR(tb.toIR()), `${program}: the final function`);
      if (a.output.kind === "dict" && b.output.kind === "dict") assert.deepEqual(encodeEastIR(a.output.merge().toIR()), encodeEastIR(b.output.merge().toIR()), `${program}: the merge`);
      if (a.output.kind === "fold" && b.output.kind === "fold") assert.deepEqual(encodeEastIR(a.output.combine().toIR()), encodeEastIR(b.output.combine().toIR()), `${program}: the combine`);
    }
    // A re-keyed join's programs too (#942).
    for (const program of REKEYED) {
      const a = split(program);
      const b = split(program);
      assert.ok(a.kind === "split" && b.kind === "split" && a.rekey !== null && b.rekey !== null);
      assert.deepEqual(encodeEastIR(a.rekey.piece().toIR()), encodeEastIR(b.rekey.piece().toIR()), `${program}: the re-key piece program`);
      assert.deepEqual(encodeEastIR(a.rekey.output.merge().toIR()), encodeEastIR(b.rekey.output.merge().toIR()), `${program}: the re-key merge`);
      assert.deepEqual(encodeEastIR(a.rekey.joinPiece().toIR()), encodeEastIR(b.rekey.joinPiece().toIR()), `${program}: the join piece program`);
      const [ta, tb] = [a.rekey.joinThen(), b.rekey.joinThen()];
      assert.deepEqual(ta === null ? null : encodeEastIR(ta.toIR()), tb === null ? null : encodeEastIR(tb.toIR()), `${program}: the join's final function`);
    }
  });

  test("a piece's runtime error names its place in the jq, as the one unit's does", () => {
    const program = ".orders | map(.lines | length) | map(10 / (. - .)) | add";
    const s = split(program);
    assert.ok(s.kind === "split");
    const thrown = (run: () => unknown): EastError => {
      try { run(); } catch (e) { if (e instanceof EastError) return e; throw e; }
      throw new Error("the query raises no error");
    };
    const inPiece = thrown(() => runSplit(s, 2));
    const translation = translateJq(checked(program));
    const inUnit = thrown(() => asRun(translation.fn())(fixture.orders));
    assert.equal(inPiece.eastMessage, "Division by zero");
    assert.deepEqual(inPiece.location[0], inUnit.location[0]);
    assert.deepEqual(inPiece.location[0], { filename: "jq", line: 1n, column: 38n });
  });
});

// ─── Explanations (N1's golden plans) ─────────────────────────────────────

/** A split's explanation, or the reason a query stays one unit, as one line of text. */
function explained(program: string, root: EastType = FixtureRoot): string {
  const s = split(program, 1000, root);
  const text = (range: JqRange | null): string => range === null ? "-" : `«${program.slice(range.from, range.to)}»`;
  const pruning = s.pruning.length === 0 ? "" : ` · pruning ${s.pruning.map(p => `${p.kind} ${p.name} ${text(p.range)}`).join(", ")}`;
  if (s.kind === "whole") return `whole: ${s.reason.code}${s.reason.name === null ? "" : ` ${s.reason.name}`} ${text(s.reason.range)}${pruning}`;
  const c = s.stages.combine;
  const totals = (list: readonly { range: JqRange; rule: string }[]): string => list.map(t => `${t.rule} ${text(t.range)}`).join(", ");
  const combine = c.kind === "concat" ? "concat"
    : c.kind === "totals" ? `totals [${totals(c.totals)}]`
    : c.kind === "group" ? `group by ${text(c.key)} ${c.totals === null ? "rows collected" : `[${totals(c.totals)}]`}`
    : c.kind === "distinct" ? "distinct"
    : c.kind === "distinct_by" ? `first of each ${text(c.key)}`
    : c.kind === "reduce" ? `reduce by ${text(c.key)}, ${c.update}`
    : `first ${c.rows} of ${text(c.range)} by ${c.key === null ? "the row" : text(c.key)}`;
  const broadcast = s.broadcast.length === 0 ? "" : ` · whole in every piece: ${s.broadcast.join(", ")}`;
  const copartitioned = s.copartitioned.length === 0 ? "" : ` · cut at the same keys: ${s.copartitioned.join(", ")}`;
  const rekey = s.rekey === null ? "" : ` · or re-keyed on ${text(s.rekey.key)} against ${s.rekey.name}`;
  return `split ${s.over} into ${s.output.kind}: piece ${text(s.stages.piece)} · ${combine} · then ${text(s.stages.then)}${broadcast}${copartitioned}${rekey}${pruning}`;
}

/** Each rule and each reason, and the explanation it gives. */
const GOLDEN: readonly (readonly [program: string, explanation: string])[] = [
  // Each rule.
  [".orders | map(select(.total > 500)) | sort_by(-.total) | .[:5]",
    "split orders into fold: piece «.orders | map(select(.total > 500))» · first 5 of «sort_by(-.total) | .[:5]» by «-.total» · then «.[:5]»"],
  [".orders | map(select(.total > 500)) | sort_by(-.total) | map(.id)",
    "split orders into array: piece «.orders | map(select(.total > 500))» · concat · then «sort_by(-.total) | map(.id)»"],
  [".orders | sort_by(.total) | .[0].id", "split orders into fold: piece «.orders» · first 1 of «sort_by(.total) | .[0].id» by «.total» · then «.[0].id»"],
  [".orders | map(.customer_id) | sort | first", "split orders into fold: piece «.orders | map(.customer_id)» · first 1 of «sort | first» by the row · then «first»"],
  [".orders | map(.id)", "split orders into array: piece «.orders | map(.id)» · concat · then -"],
  ["[.orders[] | select(.total > 1000) | .id]", "split orders into array: piece «[.orders[] | select(.total > 1000) | .id]» · concat · then -"],
  [".orders | map(.total) | add", "split orders into fold: piece «.orders | map(.total)» · totals [add «add»] · then -"],
  [".orders | map(select(.total > 500)) | length", "split orders into fold: piece «.orders | map(select(.total > 500))» · totals [count «length»] · then -"],
  [".orders | {n: length, mean: (map(.total) | add / length)}",
    "split orders into fold: piece «.orders» · totals [count «length», add «map(.total) | add», count «map(.total) | add / length»] · then -"],
  [".orders | min_by(.total) | .id", "split orders into fold: piece «.orders» · totals [min «min_by(.total)»] · then «.id»"],
  [".orders | map(.total) | max", "split orders into fold: piece «.orders | map(.total)» · totals [max «max»] · then -"],
  [".orders | map(.total) | first", "split orders into fold: piece «.orders | map(.total)» · totals [first «first»] · then -"],
  [".orders | map(.total) | .[-1]", "split orders into fold: piece «.orders | map(.total)» · totals [last «.[-1]»] · then -"],
  [".orders | any(.total > 3000)", "split orders into fold: piece «.orders» · totals [any «any(.total > 3000)»] · then -"],
  [".orders | all(.total > 10)", "split orders into fold: piece «.orders» · totals [all «all(.total > 10)»] · then -"],
  [".orders | map(.customer_id) | unique | length", "split orders into set: piece «.orders | map(.customer_id)» · distinct · then «length»"],
  [".orders | {customers: (map(.customer_id) | unique | length)}", "split orders into fold: piece «.orders» · totals [union «map(.customer_id) | unique»] · then -"],
  [".orders | group_by(.customer_id) | map({customer: .[0].customer_id, revenue: map(.total) | add})",
    "split orders into dict: piece «.orders» · group by «.customer_id» [first «.[0]», add «map(.total) | add»] · then -"],
  [".orders | group_by(.customer_id) | map(sort_by(.total) | .[0].id)",
    "split orders into dict: piece «.orders» · group by «.customer_id» rows collected · then -"],
  [".orders | unique_by(.customer_id) | map(.id)", "split orders into dict: piece «.orders» · first of each «.customer_id» · then «map(.id)»"],
  ["reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)",
    "split orders into dict: piece «reduce .orders[]» · reduce by «$o.customer_id», add · then -"],
  [".orders | reduce .[] as $o ({}; .[$o.customer_id] = $o.id)", "split orders into dict: piece «.orders» · reduce by «$o.customer_id», replace · then -"],
  [".customers as $c | .orders | map($c[.customer_id].region) | unique",
    "split orders into set: piece «.orders | map($c[.customer_id].region)» · distinct · then - · whole in every piece: customers · or re-keyed on «.customer_id» against customers"],
  [".customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add})",
    "split orders into dict: piece «.orders | map(. + {region: $c[.customer_id].region})» · group by «.region» [first «.[0]», add «map(.total) | add»] · then - · whole in every piece: customers · or re-keyed on «.customer_id» against customers"],
  [".customers as $c | .orders | map({id, region: $c[.customer_id].region})",
    "split orders into array: piece «.orders | map({id, region: $c[.customer_id].region})» · concat · then - · whole in every piece: customers"],
  [".byId | to_entries | map(select(.value.total > 1000) | .key)", "split byId into array: piece «.byId | to_entries | map(select(.value.total > 1000) | .key)» · concat · then -"],
  [".orders | map(.lines) | flatten | map(.qty) | add", "split orders into fold: piece «.orders | map(.lines) | flatten | map(.qty)» · totals [add «add»] · then -"],
  // Each reason a query stays one unit.
  [".orders | length", "whole: no_stream orders - · pruning count orders «.orders | length»"],
  [".byId[1010] | .total", "whole: no_stream - · pruning seek byId «.byId[1010]»"],
  [".byId | has(1010)", "whole: no_stream byId - · pruning seek byId «.byId | has(1010)»"],
  [".forecast", "whole: no_stream forecast -"],
  ["{revenue: (.orders | map(.total) | add)}", "whole: nested «.orders | map(.total) | add»"],
  [".orders[] | .id", "whole: stops_early orders - · pruning stop orders «.orders[]»"],
  // Ordered early stop stays one lazy unit until e3 can cancel a split call's units (#942).
  ["first(.orders[] | select(.total > 1000)) | .id", "whole: stops_early first «first(.orders[] | select(.total > 1000))»"],
  ["limit(3; .orders[] | select(.total > 100)) | .id", "whole: stops_early limit «limit(3; .orders[] | select(.total > 100))»"],
  ["[limit(3; .orders[])]", "whole: nested «.orders[]»"],
  [".orders | .[0:3]", "whole: position slice «.[0:3]»"],
  [".orders | first", "whole: position first «first»"],
  [".orders | sort_by(.total) | reverse", "whole: every_row sort_by «sort_by(.total)»"],
  [".orders | foreach .[] as $o (0; . + 1)", "whole: state foreach «foreach .[] as $o (0; . + 1)»"],
  [".model as $m | .orders | map(call($m; {price: .total, region: \"NSW\"}))", "whole: calls «call($m; {price: .total, region: \"NSW\"})»"],
  [".orders as $all | .orders | map(.total / ($all | length))", "whole: reads_again orders «.orders as $all | .orders | map(.total / ($all | length))»"],
  [".orders | group_by(.lines) | map(length)", "whole: key «.lines»"],
  ["def big: .total > 1000; .orders | map(select(big))", "whole: shape «def big: .total > 1000; .orders | map(select(big))»"],
];

/** Joins of two dicts keyed alike, over the stock root (#942, O3). */
const GOLDEN_STOCK: readonly (readonly [program: string, explanation: string])[] = [
  [".prices as $p | .stock | to_entries | map(.value * ($p[.key] // 0)) | add",
    "split stock into fold: piece «.stock | to_entries | map(.value * ($p[.key] // 0))» · totals [add «add»] · then - · cut at the same keys: prices"],
  [".prices as $p | [.stock | to_entries[] | .key as $k | select($p | has($k) | not) | $k]",
    "split stock into array: piece «[.stock | to_entries[] | .key as $k | select($p | has($k) | not) | $k]» · concat · then - · cut at the same keys: prices"],
  // Read whole: at a key that is not the row's, or whole.
  [".prices as $p | .stock | to_entries | map(.value * ($p[.key + \"x\"] // 0)) | add",
    "split stock into fold: piece «.stock | to_entries | map(.value * ($p[.key + \"x\"] // 0))» · totals [add «add»] · then - · whole in every piece: prices"],
  [".prices as $p | .stock | to_entries | map(.value * ($p | length)) | add",
    "split stock into fold: piece «.stock | to_entries | map(.value * ($p | length))» · totals [add «add»] · then - · whole in every piece: prices"],
];

describe("explanations: golden plans for each rule and each reason (N1, O3)", () => {
  for (const [program, expected] of GOLDEN) {
    test(program, () => assert.equal(explained(program), expected));
  }
  for (const [program, expected] of GOLDEN_STOCK) {
    test(program, () => assert.equal(explained(program, StockRoot), expected));
  }
});
