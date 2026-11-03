/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Projected decoding (#1112): a value decodes to the kept fields of its whole
 * decode, at every type the fuzzer draws; a back-reference that crosses the
 * projection makes the decode throw, and a loop then decodes that segment
 * whole; and a compiled loop over a lazy collection decodes each segment to the
 * fields its body reads, and counts it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ArrayType, DictType, FloatType, IntegerType, SetType, StringType, StructType,
  type EastType,
} from "../../../types.js";
import { type EastTypeValue } from "../../../type_of_type.js";
import { isTypeValueEqual } from "../../../type_value_equal.js";
import { compareFor, equalFor } from "../../../comparison.js";
import { randomType, randomValueFor, seedFuzz } from "../../../fuzz.js";
import { East, SortedMap, SortedSet, ref, variant } from "../../../index.js";
import { encodeBeast2SegmentsFor, openBeast2LazyFor, Beast2Pages } from "../index.js";
import { asTypeValue } from "./type-section.js";
import { Beast2ProjectionAliasError } from "./codec.js";
import { beast2PagedLoopStats, buildProjectedSegmentDecoder, loopProjectionType } from "./project.js";

/** A deterministic stream of numbers in [0, 1) (mulberry32). */
function stream(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Field = { name: string; type: EastTypeValue };

/** A random narrowing of `type`, as a projection may make one: a subset of
 *  each struct's fields, and within variant payloads, array elements, ref
 *  contents and dict values, each narrowed in turn — or the type whole. */
function randomProjection(type: EastTypeValue, draw: () => number): EastTypeValue {
  if (draw() < 0.25) return type;
  switch (type.type) {
    case "Struct":
      return variant("Struct", (type.value as Field[])
        .filter(() => draw() < 0.5)
        .map((field) => ({ name: field.name, type: randomProjection(field.type, draw) }))) as EastTypeValue;
    case "Variant":
      return variant("Variant", (type.value as Field[])
        .map((c) => ({ name: c.name, type: randomProjection(c.type, draw) }))) as EastTypeValue;
    case "Array":
    case "Ref":
      return variant(type.type, randomProjection(type.value as EastTypeValue, draw)) as EastTypeValue;
    case "Dict": {
      const dict = type.value as { key: EastTypeValue; value: EastTypeValue };
      return variant("Dict", { key: dict.key, value: randomProjection(dict.value, draw) }) as EastTypeValue;
    }
    default:
      return type;
  }
}

/** What a projection keeps of a value decoded whole: the oracle. */
function keep(value: any, wire: EastTypeValue, proj: EastTypeValue): any {
  if (isTypeValueEqual(wire, proj)) return value;
  switch (wire.type) {
    case "Struct": {
      const fields = wire.value as Field[];
      const out: Record<string, unknown> = {};
      for (const field of proj.value as Field[]) {
        out[field.name] = keep(value[field.name], fields.find((f) => f.name === field.name)!.type, field.type);
      }
      return out;
    }
    case "Variant": {
      const cases = wire.value as Field[];
      const i = cases.findIndex((c) => c.name === value.type);
      return variant(value.type, keep(value.value, cases[i]!.type, (proj.value as Field[])[i]!.type));
    }
    case "Array":
      return (value as unknown[]).map((element) => keep(element, wire.value as EastTypeValue, proj.value as EastTypeValue));
    case "Ref":
      return ref(keep(value.value, wire.value as EastTypeValue, proj.value as EastTypeValue));
    case "Dict": {
      const dict = wire.value as { key: EastTypeValue; value: EastTypeValue };
      const narrow = (proj.value as { value: EastTypeValue }).value;
      return new SortedMap([...(value as Map<unknown, unknown>)].map(([k, v]) => [k, keep(v, dict.value, narrow)] as [unknown, unknown]), compareFor(dict.key));
    }
    default:
      throw new Error(`no projection narrows a ${wire.type}`);
  }
}

/** A row of 1 to 6 random fields, nested recursion included. */
function randomRow(draw: () => number): EastType {
  const fields: Record<string, EastType> = {};
  const n = 1 + Math.floor(draw() * 6);
  for (let i = 0; i < n; i++) {
    fields[`f${i}`] = randomType(1, { includeRecursive: false, includeFunctions: false, nestedRecursive: true });
  }
  return StructType(fields);
}

/** A collection's rows cut into segments of `per`, as the pager reads them. */
function segmented(type: EastType, rows: unknown[], per: number): Uint8Array {
  const batches: unknown[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    batches.push(type.type === "Dict" ? new Map(chunk as [unknown, unknown][]) : type.type === "Set" ? new Set(chunk) : chunk);
  }
  return encodeBeast2SegmentsFor(type)(batches as never);
}

describe("beast2 v5 projected decoding", () => {
  test("a segment decodes to the kept fields of its whole decode, at random types and projections", () => {
    seedFuzz(0x1112);
    const draw = stream(0x1112);
    let projected = 0;
    for (let n = 0; n < 150; n++) {
      const row = randomRow(draw);
      const dict = n % 3 === 2;
      const root: EastType = dict ? DictType(StringType, row) : ArrayType(row);
      const wire = asTypeValue(root);
      const rowValue = randomValueFor(row);
      let rows: unknown[] = Array.from({ length: 12 }, rowValue);
      if (dict) {
        const cmp = compareFor(StringType);
        const keyed = new Map<string, unknown>();
        rows.forEach((value, i) => keyed.set(`k${String(i).padStart(3, "0")}`, value));
        rows = [...keyed].sort((a, b) => cmp(a[0], b[0]));
      }
      const pages = new Beast2Pages(segmented(root, rows, 5), wire);
      const proj = variant(wire.type, dict
        ? { key: (wire.value as { key: EastTypeValue }).key, value: randomProjection(asTypeValue(row), draw) }
        : randomProjection(asTypeValue(row), draw)) as EastTypeValue;
      const decode = buildProjectedSegmentDecoder(wire, proj);
      const equal = equalFor(proj);
      for (let i = 0; i < pages.segmentCount; i++) {
        const whole = dict ? pages.segmentDisjoint(i) : pages.segment(i);
        const narrow = pages.segmentProjected(i, decode);
        assert.ok(equal(keep(whole, wire, proj), narrow), `case ${n}, segment ${i}: the projected decode differs from the kept fields`);
        projected++;
      }
    }
    assert.ok(projected >= 450);
  });

  test("a projection that does not narrow the wire type is refused", () => {
    const wire = asTypeValue(ArrayType(StructType({ a: IntegerType, b: SetType(StringType) })));
    const refuse = (proj: EastType) => assert.throws(() => buildProjectedSegmentDecoder(wire, asTypeValue(proj)), TypeError);
    refuse(ArrayType(StructType({ c: IntegerType })));
    refuse(ArrayType(StructType({ a: FloatType })));
    refuse(SetType(StructType({ a: IntegerType })));
    const keyed = asTypeValue(DictType(StructType({ k: IntegerType, j: IntegerType }), IntegerType));
    assert.throws(() => buildProjectedSegmentDecoder(keyed, asTypeValue(DictType(StructType({ k: IntegerType }), IntegerType))), TypeError);
  });
});

describe("beast2 v5 projection across a back-reference", () => {
  const Item = StructType({ x: IntegerType, y: IntegerType });
  const Row = StructType({ a: ArrayType(Item), b: ArrayType(Item), n: IntegerType });
  const Rows = ArrayType(Row);
  const wire = asTypeValue(Rows);
  /** Rows whose `a` and `b` are one array: `b` encodes as a reference to `a`. */
  const rows = Array.from({ length: 8 }, (_, i) => {
    const items = [{ x: BigInt(i), y: BigInt(-i) }, { x: BigInt(i + 1), y: 0n }];
    return { a: items, b: items, n: BigInt(i) };
  });
  const blob = segmented(Rows, rows, 3);
  const projectedAs = (proj: EastType): unknown[] => {
    const pages = new Beast2Pages(blob, wire);
    const decode = buildProjectedSegmentDecoder(wire, asTypeValue(proj));
    return Array.from({ length: pages.segmentCount }, (_, i) => pages.segmentProjected(i, decode)).flat();
  };

  test("a reference to a container a dropped field defined throws", () => {
    assert.throws(() => projectedAs(ArrayType(StructType({ b: ArrayType(Item) }))), Beast2ProjectionAliasError);
  });

  test("a reference to a container decoded to another shape throws", () => {
    assert.throws(() => projectedAs(ArrayType(StructType({ a: ArrayType(Item), b: ArrayType(StructType({ x: IntegerType })) }))), Beast2ProjectionAliasError);
    assert.throws(() => projectedAs(ArrayType(StructType({ a: ArrayType(StructType({ x: IntegerType })), b: ArrayType(StructType({ x: IntegerType })) }))), Beast2ProjectionAliasError);
  });

  test("a reference a dropped field holds is parsed past, and one between containers decoded whole resolves", () => {
    const narrow = projectedAs(ArrayType(StructType({ a: ArrayType(StructType({ x: IntegerType })), n: IntegerType }))) as { a: { x: bigint }[]; n: bigint }[];
    assert.deepEqual(narrow.map((r) => [r.n, r.a.map((item) => item.x)]), rows.map((r) => [r.n, r.a.map((item) => item.x)]));
    const kept = projectedAs(ArrayType(StructType({ a: ArrayType(Item), b: ArrayType(Item) }))) as { a: unknown; b: unknown }[];
    assert.ok(kept.every((r) => r.a === r.b), "the two fields stay one array");
  });

  test("a loop over such rows decodes the segments whole, and counts them", () => {
    const sum = East.function([Rows], IntegerType, ($, xs) => {
      const acc = $.let(0n);
      $.for(xs, ($, r) => { $.for(r.b, ($, item) => { $.assign(acc, acc.add(item.x)); }); });
      $.return(acc);
    }).toIR().compile([]) as (xs: unknown) => bigint;
    const lazy = openBeast2LazyFor(Rows, { frozen: true })(blob);
    const before = beast2PagedLoopStats();
    assert.equal(sum(lazy), sum(rows));
    const after = beast2PagedLoopStats();
    assert.deepEqual([after.segmentsProjected - before.segmentsProjected, after.segmentsWhole - before.segmentsWhole], [0, 3]);
  });
});

describe("beast2 v5 projected loops over lazy collections", () => {
  const Line = StructType({ sku: StringType, qty: IntegerType, price: FloatType });
  const Order = StructType({ id: IntegerType, customer: StringType, total: FloatType, lines: ArrayType(Line) });
  const Orders = ArrayType(Order);
  const ByCustomer = DictType(StringType, Order);
  const Customers = SetType(StringType);
  const orders = Array.from({ length: 40 }, (_, i) => ({
    id: BigInt(i),
    customer: `c${String(i).padStart(2, "0")}`,
    total: i * 1.25,
    lines: [{ sku: `s${i}`, qty: BigInt(i % 3), price: i * 0.5 }],
  }));
  const ordersBlob = segmented(Orders, orders, 6);
  const byCustomer = new SortedMap(orders.map((o) => [o.customer, o] as [string, typeof o]), compareFor(StringType));
  const byCustomerBlob = segmented(ByCustomer, [...byCustomer], 6);

  /** Runs `fn` over a frozen lazy value opened from `blob`, as a runner does,
   *  and gives its result and the segments its loops decoded. */
  function counted<R>(type: EastType, blob: Uint8Array, fn: (value: unknown) => R): { result: R; projected: number; whole: number } {
    const lazy = openBeast2LazyFor(type, { frozen: true })(blob);
    const before = beast2PagedLoopStats();
    const result = fn(lazy);
    const after = beast2PagedLoopStats();
    return { result, projected: after.segmentsProjected - before.segmentsProjected, whole: after.segmentsWhole - before.segmentsWhole };
  }

  test("an Array's rows decode to the fields the body reads", () => {
    const fn = East.function([Orders], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, o) => { $.assign(acc, acc.add(o.total)); });
      $.return(acc);
    });
    const compiled = fn.toIR().compile([]) as (xs: unknown) => number;
    assert.deepEqual(counted(Orders, ordersBlob, compiled), { result: compiled(orders), projected: 7, whole: 0 });
    const body = (fn.toIR().ir.value.body as any).value.statements[1];
    assert.ok(isTypeValueEqual(loopProjectionType(body.value.body, body.value.value.value.name, asTypeValue(Orders))!, asTypeValue(ArrayType(StructType({ total: FloatType })))));
  });

  test("a Dict's values decode to the fields the body reads, its keys whole", () => {
    const compiled = East.function([ByCustomer], StringType, ($, d) => {
      const acc = $.let("");
      $.for(d, ($, o, k) => { $.assign(acc, acc.concat(k).concat(o.lines.size().toString())); });
      $.return(acc);
    }).toIR().compile([]) as (d: unknown) => string;
    assert.deepEqual(counted(ByCustomer, byCustomerBlob, compiled), { result: compiled(byCustomer), projected: 7, whole: 0 });
  });

  test("a body that reads the row whole decodes every segment whole", () => {
    const compiled = East.function([Orders], IntegerType, ($, xs) => {
      const kept = $.let(East.value([], Orders));
      $.for(xs, ($, o) => { $(kept.pushLast(o)); });
      $.return(kept.size());
    }).toIR().compile([]) as (xs: unknown) => bigint;
    assert.deepEqual(counted(Orders, ordersBlob, compiled), { result: 40n, projected: 0, whole: 7 });
  });

  test("a Set's elements are its keys, and decode whole", () => {
    const customers = new SortedSet(orders.map((o) => o.customer), compareFor(StringType));
    const compiled = East.function([Customers], IntegerType, ($, s) => {
      const acc = $.let(0n);
      $.for(s, ($, c) => { $.assign(acc, acc.add(c.length())); });
      $.return(acc);
    }).toIR().compile([]) as (s: unknown) => bigint;
    assert.deepEqual(counted(Customers, segmented(Customers, [...customers], 6), compiled), { result: compiled(customers), projected: 0, whole: 7 });
  });

  test("a lazy value read whole loops over what it holds, and counts nothing", () => {
    const compiled = East.function([Orders], FloatType, ($, xs) => {
      const acc = $.let(0.0);
      $.for(xs, ($, o) => { $.assign(acc, acc.add(o.total)); });
      $.return(acc);
    }).toIR().compile([]) as (xs: unknown) => number;
    const lazy = openBeast2LazyFor(Orders, { frozen: true })(ordersBlob) as unknown[];
    assert.equal(lazy.slice(0, 1).length, 1); // an operation the pager cannot serve reads it whole
    const before = beast2PagedLoopStats();
    assert.equal(compiled(lazy), compiled(orders));
    assert.deepEqual(beast2PagedLoopStats(), before);
  });

  test("a projected row holds only the fields read, frozen as the input is", () => {
    const pages = new Beast2Pages(ordersBlob, asTypeValue(Orders), { frozen: true });
    const decode = buildProjectedSegmentDecoder(asTypeValue(Orders), asTypeValue(ArrayType(StructType({ total: FloatType }))));
    const segment = pages.segmentProjected(1, decode) as unknown[];
    assert.deepEqual(segment, orders.slice(6, 12).map((o) => ({ total: o.total })));
    assert.ok(Object.isFrozen(segment) && segment.every((row) => Object.isFrozen(row)));
  });
});
