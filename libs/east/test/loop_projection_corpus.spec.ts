/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The loop projection corpus (#1112): loops over a paged input, each with the
 * projection its body admits, and the piece programs of #1093's benchmark
 * queries.
 *
 * A compiled `$.for` over a lazy Array or Dict decodes each segment to the
 * struct fields its body reads of the loop's value variable, as east-c's paged
 * loop does (`east_beast2_projection_for_loop`). Every runtime must infer the
 * same projection from the same body, or decline it alike. TypeScript pins
 * each loop's projection here, runs it over its input opened lazily and decoded
 * whole, and checks that the two answers agree and that its segments were
 * decoded projected — or whole, where it declines.
 *
 * The benchmark's piece programs each run inside a function that collects what
 * they emit, over the shared fixture's datasets opened lazily. Their loops
 * project, but for three that build or keep the whole row: revenue by region
 * widens every order (`. + {region: …}`) and keeps each group's first order,
 * the sorted top 100 keeps each row it may emit, and a re-keyed join's pieces
 * send each order whole. Each decodes whole until the translator builds and
 * keeps only the fields later steps read (#1141, #1142).
 *
 * Under EXPORT_TEST_IR (`make test-export`) the cases are written beside the
 * compliance IR, to <dir>/loop_projection/, where east-c's
 * test_loop_projection_corpus and east-py's test_loop_projection_corpus.py
 * read them: east-c must infer each loop's projection, and both must give each
 * answer and decode as many segments projected and whole. */

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ArrayType, BlobType, DateTimeType, DictType, EastTypeType, FloatType, IntegerType, NullType, OptionType, SetType,
  StringType, StructType, VariantType,
  East, SortedMap, SortedSet, beast2PagedLoopStats, checkJq, compareFor, encodeBeast2For, encodeBeast2SegmentsFor,
  encodeEastIR, equalFor, none, openBeast2LazyFor, printFor, some, splitJq, toEastTypeValue, variant,
  type EastType, type FunctionExpr, type ValueTypeOf,
} from "../src/index.js";
import { fromEastTypeValue, type EastTypeValue } from "../src/type_of_type.js";
import { isTypeValueEqual } from "../src/type_value_equal.js";
import { loopProjectionType } from "../src/serialization/beast2/v5/project.js";
import { Customer, Order, queryFixture } from "./query.fixture.js";

/** A loop over a paged input, the projection its body admits, and its answer. */
const LoopCaseType = StructType({
  name: StringType,
  fn: BlobType,
  input: BlobType,
  projected: OptionType(EastTypeType),
  result: BlobType,
  segments: IntegerType,
});

/** A piece program run over paged inputs, what it emitted, and the segments its loops decoded projected and whole. */
const PieceCaseType = StructType({
  name: StringType,
  fn: BlobType,
  inputs: ArrayType(BlobType),
  result: BlobType,
  projected: IntegerType,
  whole: IntegerType,
});

const loopCases: ValueTypeOf<typeof LoopCaseType>[] = [];
const pieceCases: ValueTypeOf<typeof PieceCaseType>[] = [];

const printType = printFor(EastTypeType);

/** Rows per segment: several segments, even for the corpus's few rows. */
const PER_SEGMENT = 4;

/** A collection cut into segments of {@link PER_SEGMENT}, as e3 stores one cut small. */
function paged(type: EastType, value: unknown): Uint8Array {
  const t = type as { type: string };
  const items = t.type === "Array" ? [...(value as unknown[])] : t.type === "Set" ? [...(value as Set<unknown>)] : [...(value as Map<unknown, unknown>)];
  const batches: unknown[] = [];
  for (let i = 0; i < items.length; i += PER_SEGMENT) {
    const chunk = items.slice(i, i + PER_SEGMENT);
    batches.push(t.type === "Dict" ? new Map(chunk as [unknown, unknown][]) : t.type === "Set" ? new Set(chunk) : chunk);
  }
  return encodeBeast2SegmentsFor(type)(batches as never);
}

/** Runs `fn` over `inputs` opened lazily and frozen, as e3 opens a task's inputs: its answer, and the segments its loops decoded. */
function runLazily(fn: FunctionExpr<any[], any>, inputs: readonly { type: EastType; blob: Uint8Array }[]): { result: unknown; projected: number; whole: number } {
  const compiled = fn.toIR().compile([]) as (...args: unknown[]) => unknown;
  const opened = inputs.map(({ type, blob }) => openBeast2LazyFor(type, { frozen: true })(blob));
  const before = beast2PagedLoopStats();
  const result = compiled(...opened);
  const after = beast2PagedLoopStats();
  return { result, projected: after.segmentsProjected - before.segmentsProjected, whole: after.segmentsWhole - before.segmentsWhole };
}

/** The function's output type. */
function outputOf(fn: FunctionExpr<any[], any>): EastTypeValue {
  return ((fn.toIR().ir as any).value.type as { value: { output: EastTypeValue } }).value.output;
}

/** The loop over the function's first parameter: the first `$.for` its body runs. */
function pagedLoop(fn: FunctionExpr<any[], any>): { body: any; target: string } {
  const ir = fn.toIR().ir as any;
  const param = ir.value.parameters[0].value.name as string;
  const body = ir.value.body;
  const statements = body.type === "Block" ? body.value.statements : [body];
  for (const s of statements) {
    if ((s.type === "ForArray" || s.type === "ForDict") && (s.type === "ForArray" ? s.value.array : s.value.dict).value.name === param) {
      return { body: s.value.body, target: s.value.value.value.name };
    }
  }
  throw new Error("the function runs no loop over its first parameter");
}

// ─── Loops ───────────────────────────────────────────────────────────────────

const Item = StructType({ sku: StringType, qty: IntegerType, price: FloatType });
const Status = VariantType({ open: NullType, shipped: DateTimeType });
const Address = StructType({ city: StringType, zip: StringType });
const Row = StructType({
  id: IntegerType,
  region: StringType,
  total: FloatType,
  lines: ArrayType(Item),
  tags: DictType(StringType, Item),
  status: Status,
  address: Address,
  flags: SetType(StringType),
});
const Rows = ArrayType(Row);
const ByKey = DictType(StringType, Row);

const rows: ValueTypeOf<typeof Row>[] = Array.from({ length: 30 }, (_, i) => ({
  id: BigInt(i),
  region: ["north", "south", "east"][i % 3]!,
  total: i * 2.5,
  lines: Array.from({ length: i % 4 }, (_, j) => ({ sku: `s${i}-${j}`, qty: BigInt(j + 1), price: (i + j) * 0.5 })),
  tags: new SortedMap(Array.from({ length: i % 3 }, (_, j) => [`t${j}`, { sku: `t${i}-${j}`, qty: BigInt(j), price: j * 1.5 }] as [string, ValueTypeOf<typeof Item>]), compareFor(StringType)),
  status: i % 2 === 0 ? variant("open", null) : variant("shipped", new Date(Date.UTC(2026, 0, 1 + i))),
  address: { city: `city${i % 5}`, zip: `${1000 + i}` },
  flags: new SortedSet(i % 2 === 0 ? ["even"] : ["odd", "x"], compareFor(StringType)),
}));
const byKey = new SortedMap(rows.map(r => [`k${String(r.id).padStart(2, "0")}`, r] as [string, ValueTypeOf<typeof Row>]), compareFor(StringType));

/** A helper the loops call on the row, and on one of its fields. */
const totalOf = East.function([Row], FloatType, ($, x) => x.total);
const cityOf = East.function([Address], StringType, ($, a) => a.city);
const same = East.function([Row], Row, ($, x) => x);
/** The row's type with a wider status, which a row is cast to when a helper takes it. */
const WideRow = StructType({
  id: IntegerType,
  region: StringType,
  total: FloatType,
  lines: ArrayType(Item),
  tags: DictType(StringType, Item),
  status: VariantType({ cancelled: StringType, open: NullType, shipped: DateTimeType }),
  address: Address,
  flags: SetType(StringType),
});
const wideTotalOf = East.function([WideRow], FloatType, ($, x) => x.total);

/** The loops, each with the root type narrowed to what it reads, or `null` where it decodes whole. */
const LOOPS: readonly { name: string; root: EastType; fn: FunctionExpr<any[], any>; projected: EastType | null }[] = [
  {
    name: "a field",
    root: Rows,
    fn: East.function([Rows], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, r) => { $.assign(acc, acc.add(r.total)); });
      return acc;
    }),
    projected: ArrayType(StructType({ total: FloatType })),
  },
  {
    name: "two fields, in the wire's order",
    root: Rows,
    fn: East.function([Rows], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, r) => {
        $.if(East.equal(r.region, "north"), ($) => { $.assign(acc, acc.add(r.total)); });
      });
      return acc;
    }),
    projected: ArrayType(StructType({ region: StringType, total: FloatType })),
  },
  {
    name: "a nested struct's field",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => {
        $.if(East.equal(r.address.city, "city1"), ($) => { $.assign(n, n.add(1n)); });
      });
      return n;
    }),
    projected: ArrayType(StructType({ address: StructType({ city: StringType }) })),
  },
  {
    name: "a nested struct bound whole",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => {
        const a = $.let(r.address);
        $.assign(n, n.add(a.zip.length()));
      });
      return n;
    }),
    projected: ArrayType(StructType({ address: Address })),
  },
  {
    name: "an inner loop",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => { $.for(r.lines, ($, l) => { $.assign(n, n.add(l.qty)); }); });
      return n;
    }),
    projected: ArrayType(StructType({ lines: ArrayType(StructType({ qty: IntegerType })) })),
  },
  {
    name: "an inner loop over a dict's values",
    root: Rows,
    fn: East.function([Rows], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, r) => { $.for(r.tags, ($, t) => { $.assign(acc, acc.add(t.price)); }); });
      return acc;
    }),
    projected: ArrayType(StructType({ tags: DictType(StringType, StructType({ price: FloatType })) })),
  },
  {
    name: "a size",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => { $.assign(n, n.add(r.lines.size())); });
      return n;
    }),
    projected: ArrayType(StructType({ lines: ArrayType(StructType({})) })),
  },
  {
    name: "a size and an inner loop",
    root: Rows,
    fn: East.function([Rows], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, r) => {
        $.assign(acc, acc.add(r.lines.size().toFloat()));
        $.for(r.lines, ($, l) => { $.assign(acc, acc.add(l.price)); });
      });
      return acc;
    }),
    projected: ArrayType(StructType({ lines: ArrayType(StructType({ price: FloatType })) })),
  },
  {
    name: "an inner element read whole",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const kept = $.let([], ArrayType(Item));
      $.for(xs, ($, r) => { $.for(r.lines, ($, l) => { $(kept.pushLast(l)); }); });
      return kept.size();
    }),
    projected: ArrayType(StructType({ lines: ArrayType(Item) })),
  },
  {
    name: "a variant matched",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => {
        $.match(r.status, { shipped: ($) => { $.assign(n, n.add(1n)); } });
      });
      return n;
    }),
    projected: ArrayType(StructType({ status: Status })),
  },
  {
    name: "a set read",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => { $.if(r.flags.has("x"), ($) => { $.assign(n, n.add(1n)); }); });
      return n;
    }),
    projected: ArrayType(StructType({ flags: SetType(StringType) })),
  },
  {
    name: "a helper given the row",
    root: Rows,
    fn: East.function([Rows], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, r) => { $.assign(acc, acc.add(totalOf(r))); });
      return acc;
    }),
    projected: ArrayType(StructType({ total: FloatType })),
  },
  {
    name: "a helper given the row cast to a wider type",
    root: Rows,
    fn: East.function([Rows], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, r) => { $.assign(acc, acc.add(wideTotalOf(r))); });
      return acc;
    }),
    projected: ArrayType(StructType({ total: FloatType })),
  },
  {
    name: "a helper given a field",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => { $.assign(n, n.add(cityOf(r.address).length())); });
      return n;
    }),
    projected: ArrayType(StructType({ address: StructType({ city: StringType }) })),
  },
  {
    name: "a helper that gives the row back",
    root: Rows,
    fn: East.function([Rows], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, r) => { $.assign(acc, acc.add(same(r).total)); });
      return acc;
    }),
    projected: null,
  },
  {
    name: "the row read whole",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const kept = $.let([], Rows);
      $.for(xs, ($, r) => { $(kept.pushLast(r)); });
      return kept.size();
    }),
    projected: null,
  },
  {
    name: "every field read",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => {
        const id = $.let(r.id);
        const region = $.let(r.region);
        const total = $.let(r.total);
        const lines = $.let(r.lines);
        const tags = $.let(r.tags);
        const status = $.let(r.status);
        const address = $.let(r.address);
        const flags = $.let(r.flags);
        $.assign(n, n.add(id).add(region.length()).add(lines.size()).add(tags.size()).add(flags.size()).add(address.zip.length()));
        $.if(East.greater(total, 10.0), ($) => { $.assign(n, n.add(1n)); });
        $.match(status, { open: ($) => { $.assign(n, n.add(1n)); } });
      });
      return n;
    }),
    projected: null,
  },
  {
    name: "a while loop and a condition",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => {
        const i = $.let(0n);
        $.while(East.less(i, r.lines.size()), ($) => { $.assign(i, i.add(1n)); });
        $.if(East.greater(r.total, 10.0), ($) => { $.assign(n, n.add(i)); });
      });
      return n;
    }),
    projected: ArrayType(StructType({ total: FloatType, lines: ArrayType(StructType({})) })),
  },
  {
    name: "a try and its catch",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => {
        $.try(($) => { $.assign(n, n.add(r.lines.get(2n).qty)); })
          .catch(($, _message, _stack) => { $.assign(n, n.add(r.id)); });
      });
      return n;
    }),
    projected: ArrayType(StructType({ id: IntegerType, lines: ArrayType(Item) })),
  },
  {
    name: "an inner element put in a struct",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const Kept = StructType({ line: Item, id: IntegerType });
      const kept = $.let([], ArrayType(Kept));
      $.for(xs, ($, r) => { $.for(r.lines, ($, l) => { $(kept.pushLast(East.value({ line: l, id: r.id }, Kept))); }); });
      return kept.size();
    }),
    projected: ArrayType(StructType({ id: IntegerType, lines: ArrayType(Item) })),
  },
  {
    name: "fields in an array",
    root: Rows,
    fn: East.function([Rows], IntegerType, ($, xs) => {
      const n = $.let(0n);
      $.for(xs, ($, r) => {
        const pair = $.let(East.value([r.id, r.id.add(1n)], ArrayType(IntegerType)));
        $.assign(n, n.add(pair.size()));
      });
      return n;
    }),
    projected: ArrayType(StructType({ id: IntegerType })),
  },
  {
    name: "a dict's values",
    root: ByKey,
    fn: East.function([ByKey], FloatType, ($, d) => {
      const acc = $.let(0.0);
      $.for(d, ($, v) => { $.assign(acc, acc.add(v.total)); });
      return acc;
    }),
    projected: DictType(StringType, StructType({ total: FloatType })),
  },
  {
    name: "a dict's keys, and a field of its values",
    root: ByKey,
    fn: East.function([ByKey], IntegerType, ($, d) => {
      const n = $.let(0n);
      $.for(d, ($, v, k) => { $.assign(n, n.add(k.length()).add(v.id)); });
      return n;
    }),
    projected: DictType(StringType, StructType({ id: IntegerType })),
  },
  {
    name: "a dict's values read whole",
    root: ByKey,
    fn: East.function([ByKey], IntegerType, ($, d) => {
      const kept = $.let([], Rows);
      $.for(d, ($, v) => { $(kept.pushLast(v)); });
      return kept.size();
    }),
    projected: null,
  },
];

describe("loop projection corpus — loops", () => {
  for (const c of LOOPS) {
    test(c.name, () => {
      const root = toEastTypeValue(c.root);
      const { body, target } = pagedLoop(c.fn);
      const inferred = loopProjectionType(body, target, root);
      const expected = c.projected === null ? null : toEastTypeValue(c.projected);
      assert.ok(inferred === null ? expected === null : expected !== null && isTypeValueEqual(inferred, expected),
        `inferred ${inferred === null ? "whole" : printType(inferred)}, expected ${expected === null ? "whole" : printType(expected)}`);

      const value = c.root.type === "Array" ? rows : byKey;
      const blob = paged(c.root, value);
      const segments = Math.ceil(rows.length / PER_SEGMENT);
      const eager = (c.fn.toIR().compile([]) as (x: unknown) => unknown)(value);
      const lazy = runLazily(c.fn, [{ type: c.root, blob }]);
      assert.ok(equalFor(outputOf(c.fn))(lazy.result, eager), "the lazy input's answer is the eager one's");
      assert.deepEqual([lazy.projected, lazy.whole], expected === null ? [0, segments] : [segments, 0]);

      loopCases.push({
        name: c.name,
        fn: encodeEastIR(c.fn.toIR()),
        input: blob,
        projected: expected === null ? none : some(expected),
        result: encodeBeast2For(outputOf(c.fn))(eager as never),
        segments: BigInt(segments),
      });
    });
  }
});

// ─── The benchmark's piece programs ──────────────────────────────────────────

const Shipment = StructType({ carrier: StringType, days: IntegerType });
const Orders = ArrayType(Order);
const Customers = DictType(StringType, Customer);
const Shipments = DictType(IntegerType, Shipment);
/** The benchmark's root (e3-ui-cli's `query-bench.ts`): its orders, customers and shipments, over the shared fixture. */
const BenchRoot = StructType({ orders: Orders, customers: Customers, shipments: Shipments });
const fixture = queryFixture();
const bench: Record<string, unknown> = {
  orders: fixture.orders,
  customers: fixture.customers,
  shipments: new SortedMap(fixture.orders.map(o => [o.id, { carrier: ["dhl", "ups", "fedex"][Number(o.id % 3n)]!, days: o.id % 7n }] as [bigint, ValueTypeOf<typeof Shipment>]), compareFor(IntegerType)),
};
/** The total the selective queries keep above: here a quarter of the fixture's orders pass. */
const THRESHOLD = [...fixture.orders].map(o => o.total).sort((a, b) => b - a)[Math.floor(fixture.orders.length / 4)]!;

/** #1093's benchmark queries, as e3-ui-cli's `query-bench.ts` holds them, and how each piece's paged loop decodes. */
const QUERIES: readonly { id: string; program: string; whole?: string }[] = [
  { id: "q1", program: ".orders | map(.total) | add" },
  { id: "q2", program: ".orders | {n: length, total: (map(.total) | add), any_big: any(.total > 2000), all_lines: all(.lines | length > 0)}" },
  {
    id: "q3", program: ".customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, n: length})",
    whole: "it widens every order, and keeps each group's first (#1141, #1142)",
  },
  { id: "q4", program: ".orders | map(.customer_id) | unique" },
  { id: "q5", program: "reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)" },
  { id: "q6", program: `.orders | map(select(.total > ${THRESHOLD})) | map(.id)` },
  { id: "q6t", program: `.orders | map(select(.total > ${THRESHOLD})) | sort_by(-.total) | .[:100] | map(.id)`, whole: "it keeps each row it may emit whole (#1141)" },
  { id: "q7", program: ".shipments as $s | .orders | map({carrier: $s[.id].carrier, total}) | group_by(.carrier) | map({carrier: .[0].carrier, revenue: map(.total) | add, n: length})" },
];

/**
 * A piece program run as a unit runs it, but in a function that collects what
 * it emits: its inputs, then `emit`, called with a function that appends what
 * it is given — the one value, or a key and its value — to an array the
 * function returns.
 */
function collecting(piece: FunctionExpr<any[], any>): { fn: FunctionExpr<any[], any>; inputs: EastType[] } {
  const type = (piece.toIR().ir as any).value.type.value as { inputs: EastTypeValue[] };
  const inputs = type.inputs.slice(0, -1).map(t => fromEastTypeValue(t));
  const emitInputs = (type.inputs.at(-1) as any).value.inputs.map((t: EastTypeValue) => fromEastTypeValue(t)) as EastType[];
  const Pair = emitInputs.length === 1 ? null : StructType({ key: emitInputs[0]!, value: emitInputs[1]! });
  const Emitted = Pair ?? emitInputs[0]!;
  const fn = East.function(inputs, ArrayType(Emitted), ($, ...data) => {
    const out = $.let([], ArrayType(Emitted));
    const emit = East.function(emitInputs, NullType, ($, ...args) => {
      $(out.pushLast(Pair === null ? args[0]! : East.value({ key: args[0]!, value: args[1]! }, Pair)));
    });
    $((piece as any)(...data, emit));
    return out;
  });
  return { fn: fn as FunctionExpr<any[], any>, inputs };
}

/** How many elements a collection holds. */
function sizeOf(value: unknown): number {
  return Array.isArray(value) ? value.length : (value as Map<unknown, unknown> | Set<unknown>).size;
}

describe("loop projection corpus — the benchmark's piece programs", () => {
  for (const q of QUERIES) {
    const split = splitJq(checkJq(q.program, BenchRoot, { root: true }));
    assert.equal(split.kind, "split", `${q.id} splits`);
    if (split.kind !== "split") continue;
    const programs: { name: string; piece: FunctionExpr<any[], any>; names: readonly string[]; data: Record<string, unknown>; whole?: string }[] = [
      { name: `${q.id} piece`, piece: split.piece(), names: split.inputs.map(i => i.name), data: bench, ...(q.whole !== undefined && { whole: q.whole }) },
    ];
    if (split.rekey !== null) {
      const rekey = split.rekey;
      programs.push({ name: `${q.id} re-key piece`, piece: rekey.piece(), names: [split.over], data: bench, whole: "it sends each order whole under its key (#1141)" });
      // The join call's dataset: each key's orders, as the re-key call assembles what its pieces send.
      const sent = (collecting(rekey.piece()).fn.toIR().compile([]) as (...args: unknown[]) => { key: unknown; value: unknown[] }[])(bench[split.over]);
      const rekeyed = new SortedMap<unknown, unknown[]>([], compareFor(rekey.keyType));
      for (const { key, value } of sent) rekeyed.set(key, [...(rekeyed.get(key) ?? []), ...value]);
      programs.push({
        name: `${q.id} join piece`, piece: rekey.joinPiece(), names: rekey.inputs.map(i => i.name), data: { ...bench, [split.over]: rekeyed },
        whole: "its rows are a key's orders, an Array, which no runtime narrows",
      });
    }
    for (const p of programs) {
      test(p.name, () => {
        const { fn, inputs } = collecting(p.piece);
        const blobs = p.names.map((name, i) => ({ type: inputs[i]!, blob: paged(inputs[i]!, p.data[name]) }));
        const eager = (fn.toIR().compile([]) as (...args: unknown[]) => unknown)(...p.names.map(name => p.data[name]));
        const lazy = runLazily(fn, blobs);
        assert.ok(equalFor(outputOf(fn))(lazy.result, eager), "the lazy inputs' emits are the eager ones'");
        const segments = Math.ceil(sizeOf(p.data[split.over]) / PER_SEGMENT);
        assert.deepEqual([lazy.projected, lazy.whole], p.whole === undefined ? [segments, 0] : [0, segments],
          p.whole === undefined ? "every segment of the dataset decodes projected" : `the dataset decodes whole: ${p.whole}`);
        pieceCases.push({
          name: p.name,
          fn: encodeEastIR(fn.toIR()),
          inputs: blobs.map(b => b.blob),
          result: encodeBeast2For(outputOf(fn))(eager as never),
          projected: BigInt(lazy.projected),
          whole: BigInt(lazy.whole),
        });
      });
    }
  }
});

after(() => {
  if (!process.env.EXPORT_TEST_IR) return;
  const dir = join(process.env.EXPORT_TEST_IR, "loop_projection");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "loops.beast2"), encodeBeast2For(ArrayType(LoopCaseType))(loopCases));
  writeFileSync(join(dir, "pieces.beast2"), encodeBeast2For(ArrayType(PieceCaseType))(pieceCases));
});
