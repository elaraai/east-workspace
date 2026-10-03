/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Summaries (#922 K3): summaryProgram(T) checks to SummaryType for every
 * fixture type, and again after every stage of the query editor's saved
 * queries, written as their canonical jq (`Query Editor Spec.md` §4.7). Its
 * outputs over the fixture are tested where queries run (`query.spec.ts`). */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ArrayType, SetType, StringType, SummaryType, checkJq, isTypeEqual, printType, summaryProgram, type EastType } from "../src/index.js";
import { Cell, Customer, FixtureRoot, Forecast, Line, Model, ModelInput, Order, Part, Status, Tier } from "./query.fixture.js";

const FIXTURE_TYPES: Readonly<Record<string, EastType>> = { Cell, Customer, FixtureRoot, Forecast, Line, Model, ModelInput, Order, Part, Status, Tier };

/** The mock's saved and recent queries (`qe-engine.js`'s EXAMPLES), as their canonical jq. */
const SAVED_QUERIES: Readonly<Record<string, string>> = {
  "top-orders": [
    ".customers as $customers",
    "| .orders",
    "| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})",
    "| map({order: .id, customer: .name, region, total, shipped: .status.value.date})",
    "| sort_by(-.total)",
    "| .[:10]",
  ].join("\n"),
  "rev-region": [
    ".customers as $customers",
    "| .orders",
    "| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))",
    "| map(. + {region: $customers[.customer_id].region})",
    "| group_by(.region)",
    "| map({region: .[0].region, revenue: (map(.total) | add), orders: length})",
    "| sort_by(-.revenue)",
    "| .[:3]",
  ].join("\n"),
  "monthly": [
    ".orders",
    "| map(select(.status.type == \"shipped\"))",
    "| map(. + {ship_month: (.status.value.date | strftime(\"%Y-%m\"))})",
    "| group_by(.ship_month)",
    "| map({ship_month: .[0].ship_month, revenue: (map(.total) | add), orders: length})",
    "| sort_by(.ship_month)",
  ].join("\n"),
  "big-nodisc": [
    ".orders",
    "| map(select(.total >= 1000 and .discount == null))",
    "| map({id, customer_id, total, status})",
    "| sort_by(-.total)",
  ].join("\n"),
  "sku-qty": [
    ".orders",
    "| [.[] | . as $order | .lines[] | . + {order_id: $order.id}]",
    "| group_by(.sku)",
    "| map({sku: .[0].sku, units: (map(.qty) | add), orders: (map(.order_id) | unique | length)})",
    "| sort_by(-.units)",
  ].join("\n"),
  "bom-cost": [
    ".bom",
    "| [recurse(.children[]) | {cost, sku}]",
    "| {total_cost: (map(.cost) | add), parts: length, dearest: (map(.cost) | max)}",
  ].join("\n"),
  "demand": [
    ".model",
    "| [range(10.0; 12.25; 0.5) as $p | {price: $p, demand: call(.; {price: $p, region: \"NSW\"})}]",
  ].join("\n"),
  "cancelled": [
    ".orders",
    "| map(select(.status.type == \"cancelled\"))",
    "| length",
  ].join("\n"),
  "gold": [
    ".customers as $customers",
    "| .orders",
    "| map(. + {name: $customers[.customer_id].name, tier: $customers[.customer_id].tier.type})",
    "| map(select(.status.type != \"cancelled\" and (.tier == \"gold\" or .total >= 1500)))",
    "| map({id, customer: .name, tier, total})",
  ].join("\n"),
};

/** Asserts a program checks against a type to exactly SummaryType. */
function assertSummary(program: string, input: EastType, label: string): void {
  const checked = checkJq(program, input);
  assert.deepEqual(checked.diagnostics.map(d => d.message), [], label);
  assert.ok(checked.elementType !== null && isTypeEqual(checked.elementType, SummaryType),
    `${label}: ${checked.elementType === null ? "no type" : printType(checked.elementType)}`);
  assert.equal(checked.multiplicity, "one", label);
}

describe("summaryProgram (K3)", () => {
  for (const [name, type] of Object.entries(FIXTURE_TYPES)) {
    test(`${name}, and an array of them, check to SummaryType`, () => {
      assertSummary(summaryProgram(type), type, name);
      assertSummary(summaryProgram(ArrayType(type)), ArrayType(type), `Array<${name}>`);
    });
  }

  test("a set, and a type with no leaves, check to SummaryType", () => {
    assertSummary(summaryProgram(SetType(StringType)), SetType(StringType), "Set<String>");
    assertSummary(summaryProgram(Model), Model, "a function");
  });

  for (const [name, program] of Object.entries(SAVED_QUERIES)) {
    test(`after every stage of the saved query ${name}`, () => {
      const checked = checkJq(program, FixtureRoot);
      assert.deepEqual(checked.diagnostics.map(d => d.message), [], name);
      assert.ok(checked.stages.length > 0);
      for (const stage of checked.stages) {
        const prefix = program.slice(0, stage.to);
        assertSummary(`${prefix} | ${summaryProgram(stage.type)}`, FixtureRoot, `${name} after ${program.slice(stage.from, stage.to)}`);
      }
    });
  }

  test("summarises an order's leaves: its scalars, cases and their payloads, and lists", () => {
    const program = summaryProgram(ArrayType(Order));
    for (const path of [".customer_id", ".discount", ".id", ".lines", ".lines[].price", ".lines[].qty", ".lines[].sku", ".status.type",
      ".status.value.date", ".status.value.reason", ".total"]) {
      assert.ok(program.includes(`{key: "${path}", value: `), path);
    }
    assert.ok(program.includes("select(.type == \"shipped\")"), "a case's payload is counted where the case holds");
  });

  test("keeps at most maxLeaves leaves, shallowest first", () => {
    const program = summaryProgram(ArrayType(Order), { maxLeaves: 3 });
    assert.deepEqual([...program.matchAll(/\{key: "(\.[^"]*)", value: /g)].map(m => m[1]), [".customer_id", ".discount", ".id"]);
    assertSummary(program, ArrayType(Order), "three leaves");
  });
});
