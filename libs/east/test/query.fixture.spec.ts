/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The shared query fixture (#875 §Acceptance, #919 T2 and T3): the values the
 * query editor's mock shows, and the checked-in bytes every runtime reads. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ArrayType, DateTimeType, FloatType, IntegerType, StringType,
  compareFor, decodeBeast2For, equalFor, equivalentFor, parseFor, printFor,
  type ValueTypeOf,
} from "../src/index.js";
import { Cell, FixtureRoot, Order, Part, queryFixture, queryFixtureBytes } from "./query.fixture.js";
import { assertFixtureCurrent } from "./query.corpus.js";

const FIXTURE_FILE = new URL("../../test/fixtures/query-fixture.beast2", import.meta.url);

const equalFloat = equalFor(FloatType);
const equalString = equalFor(StringType);

/**
 * Reads East's text for a DateTime.
 *
 * @param text - the DateTime as East prints it
 * @returns the instant
 */
function timeAt(text: string): Date {
  const read = parseFor(DateTimeType)(text);
  if (!read.success) throw new Error(`not an East DateTime: ${text}`);
  return read.value;
}

/**
 * Counts the parts of a bill of materials.
 *
 * @param part - the top part
 * @returns how many parts it holds, itself included
 */
function countParts(part: ValueTypeOf<typeof Part>): number {
  return 1 + part.children.reduce((sum, child) => sum + countParts(child), 0);
}

describe("query fixture", () => {
  const fixture = queryFixture();

  test("40 orders with ids 1001–1040, in id order", () => {
    const ids = Array.from({ length: 40 }, (_, i) => BigInt(1001 + i));
    assert.ok(equalFor(ArrayType(IntegerType))(fixture.orders.map(order => order.id), ids));
  });

  test("seed 875 ships 23 orders, leaves 14 pending and cancels 3", () => {
    const counts: Record<ValueTypeOf<typeof Order>["status"]["type"], number> = { cancelled: 0, pending: 0, shipped: 0 };
    for (const order of fixture.orders) counts[order.status.type] += 1;
    assert.deepEqual(counts, { cancelled: 3, pending: 14, shipped: 23 });
  });

  test("order 1035 totals 2,381.61, for customer C06", () => {
    const order = fixture.byId.get(1035n);
    assert.ok(order !== undefined);
    assert.ok(equalFloat(order.total, 2381.61));
    assert.ok(equalString(order.customer_id, "C06"));
  });

  test("shipped orders ship on the hour, 08:00–16:00 UTC, from 2025-10-01 to 2026-09-19", () => {
    const compareTime = compareFor(DateTimeType);
    const printTime = printFor(DateTimeType);
    const first = timeAt("2025-10-01T08:00:00.000");
    const last = timeAt("2026-09-19T16:00:00.000");
    for (const order of fixture.orders) {
      if (order.status.type !== "shipped") continue;
      const date = order.status.value.date;
      assert.ok(compareTime(first, date) <= 0 && compareTime(date, last) <= 0, `order ${order.id} ships out of range`);
      assert.match(printTime(date), /T(0[89]|1[0-6]):00:00\.000$/, `order ${order.id} ships off the hour`);
    }
  });

  test("the bill of materials holds PUMP-A's 12 parts", () => {
    assert.ok(equalString(fixture.bom.sku, "PUMP-A"));
    assert.equal(countParts(fixture.bom), 12);
  });

  test("the model gives 1200 units at $10 in NSW, and a base of 300 elsewhere", () => {
    assert.ok(equalFloat(fixture.model({ price: 10.0, region: "NSW" }), 1200.0));
    assert.ok(equalFloat(fixture.model({ price: 10.0, region: "NT" }), 300.0));
    // 1200 × 1.2^−1.4, to the cent.
    assert.ok(equalFloat(fixture.model({ price: 12.0, region: "NSW" }), Math.round(1200 * Math.pow(1.2, -1.4) * 100) / 100));
  });

  test("byId holds the orders by id, and cells the forecast by region and week", () => {
    assert.ok(equalFor(ArrayType(Order))([...fixture.byId.values()], fixture.orders));
    assert.equal(fixture.cells.size, 40);
    for (const [region, { weekly }] of fixture.forecast.regions) {
      weekly.forEach((demand, week) => {
        const cell: ValueTypeOf<typeof Cell> = { region, week: BigInt(week + 1) };
        const flattened = fixture.cells.get(cell);
        assert.ok(flattened !== undefined && equalFloat(flattened, demand), `cells[{region: ${region}, week: ${week + 1}}]`);
      });
    }
  });

  test("every draw is the same fixture", () => {
    assert.ok(equivalentFor(FixtureRoot)(queryFixture(), fixture));
  });

  test("the checked-in bytes are current", () => {
    assertFixtureCurrent("query-fixture.beast2", new Uint8Array(readFileSync(FIXTURE_FILE)), queryFixtureBytes());
  });

  test("the checked-in bytes decode to the fixture, and their model runs", () => {
    const decoded = decodeBeast2For(FixtureRoot)(new Uint8Array(readFileSync(FIXTURE_FILE)));
    assert.ok(equivalentFor(FixtureRoot)(decoded, fixture));
    assert.ok(equalFloat(decoded.model({ price: 10.0, region: "NSW" }), 1200.0));
  });
});
