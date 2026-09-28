/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Paged inputs stay paged (#923 E3). A translated query reads each root field
 * it uses as an input of its own, and streams become loops that stop early,
 * so over a lazily opened input it reads only the segments it needs: the
 * fixture's orders, written four to a segment and read through a range reader
 * that records every read. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ArrayType, DictType, FloatType, IntegerType, OptionType, SortedMap, compareFor, encodeBeast2SegmentsFor, equalFor, evaluateJq,
  isBeast2LazySafe, openBeast2LazyFor, printFor, readBeast2Extents, some, type Beast2SyncRangeReader, type EastType,
} from "../src/index.js";
import { FixtureRoot, Order, queryFixture } from "./query.fixture.js";

const Orders = ArrayType(Order);
const ById = DictType(IntegerType, Order);

/** Asserts two East values of a type are equal, as East compares them. */
function assertValue(type: EastType, actual: unknown, expected: unknown): void {
  const print = printFor(type);
  assert.ok(equalFor(type)(actual as never, expected as never), `${print(actual as never)} is not ${print(expected as never)}`);
}

/** A collection's blob, four elements to a segment and uncompressed, so a read's length says what it read. */
function segmented(type: EastType, items: readonly unknown[]): Uint8Array {
  const batches: unknown[] = [];
  for (let i = 0; i < items.length; i += 4) {
    const chunk = items.slice(i, i + 4);
    batches.push(type.type === "Dict" ? new SortedMap(chunk as [bigint, unknown][], compareFor(IntegerType)) : chunk);
  }
  return encodeBeast2SegmentsFor(type, { codec: "none" })(batches as never);
}

/** A lazily opened, frozen value over a blob, and every read made of the blob since `reset`. */
function opened(type: EastType, blob: Uint8Array): { value: unknown; reads: { offset: number; length: number }[]; reset(): void } {
  const reads: { offset: number; length: number }[] = [];
  const reader: Beast2SyncRangeReader = {
    size: blob.length,
    read(offset, length) {
      reads.push({ offset, length });
      return blob.subarray(offset, offset + length);
    },
  };
  assert.ok(isBeast2LazySafe(type, { frozen: true }), "the orders open lazily, frozen");
  const value = openBeast2LazyFor(type, { frozen: true })(reader);
  return { value, reads, reset: () => { reads.length = 0; } };
}

/**
 * The segments a set of reads decoded, by index: a read of exactly a
 * segment's frame. A lookup also probes segments for their fences, with reads
 * of a fixed prefix, which are not decodes.
 */
function decoded(blob: Uint8Array, reads: readonly { offset: number; length: number }[]): number[] {
  const extents = readBeast2Extents(blob);
  const whole: number[] = [];
  extents.offsets.forEach((offset, i) => {
    const length = (i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd) - offset;
    if (reads.some(r => r.offset === offset && r.length === length)) whole.push(i);
  });
  return whole;
}

describe("paged inputs stay paged (E3)", () => {
  const fixture = queryFixture();
  const ordersBlob = segmented(Orders, fixture.orders);
  const byIdBlob = segmented(ById, [...fixture.byId.entries()]);
  const run = (program: string, fields: Record<string, unknown>): unknown =>
    evaluateJq(program, { ...fixture, ...fields }, { inputType: FixtureRoot, root: true });

  test("the orders are ten segments", () => {
    assert.equal(readBeast2Extents(ordersBlob).offsets.length, 10);
  });

  test("first(.orders[]) reads only the first segment", () => {
    const orders = opened(Orders, ordersBlob);
    orders.reset();
    const first = run("first(.orders[]) | .id", { orders: orders.value });
    assertValue(OptionType(IntegerType), first, some(1001n));
    assert.deepEqual(decoded(ordersBlob, orders.reads), [0]);
  });

  test("limit(10; .orders[]) reads the three segments that hold the first ten", () => {
    const orders = opened(Orders, ordersBlob);
    orders.reset();
    const ids = run("[limit(10; .orders[]) | .id]", { orders: orders.value });
    assertValue(ArrayType(IntegerType), ids, [1001n, 1002n, 1003n, 1004n, 1005n, 1006n, 1007n, 1008n, 1009n, 1010n]);
    assert.deepEqual(decoded(ordersBlob, orders.reads), [0, 1, 2]);
  });

  test(".orders | length reads the index alone", () => {
    const orders = opened(Orders, ordersBlob);
    orders.reset();
    assertValue(IntegerType, run(".orders | length", { orders: orders.value }), 40n);
    assert.deepEqual(decoded(ordersBlob, orders.reads), []);
  });

  test(".byId[1017] reads the one segment that holds the key", () => {
    const byId = opened(ById, byIdBlob);
    // A dict's first lookup verifies its fences, probing each segment; they are known after it.
    run(".byId[1001]", { byId: byId.value });
    byId.reset();
    const found = run(".byId[1017] | .total", { byId: byId.value });
    assertValue(OptionType(FloatType), found, some(fixture.orders[16]!.total));
    assert.equal(byId.reads.length, 1);
    assert.deepEqual(decoded(byIdBlob, byId.reads), [4]);
  });

  test("a query over the customers never reads the orders", () => {
    const orders = opened(Orders, ordersBlob);
    orders.reset();
    assertValue(IntegerType, run(".customers | length", { orders: orders.value }), 8n);
    assert.deepEqual(orders.reads, []);
  });

  test("a query over the customers and the orders reads the orders only as far as it needs them", () => {
    const orders = opened(Orders, ordersBlob);
    orders.reset();
    const program = ".customers as $c | first(.orders[] | select($c[.customer_id].region == \"WA\")) | .id";
    const eager = evaluateJq(program, fixture, { inputType: FixtureRoot, root: true });
    const lazy = run(program, { orders: orders.value });
    assertValue(OptionType(IntegerType), lazy, eager);
    assert.ok(decoded(ordersBlob, orders.reads).length < 10, "not every segment was read");
  });
});
