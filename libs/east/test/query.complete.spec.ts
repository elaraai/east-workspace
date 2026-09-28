/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Completions and the type as jq sees it (#922 K1, K2): completions at
 * scripted cursors over the shared fixture, with their kinds, details, warnings
 * and replacement ranges; and describeJqType's text for an order and the
 * fixture's root. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { completeJq, describeJqType, plainKind, FloatType, OptionType, type CompleteJqOptions } from "../src/index.js";
import { FixtureRoot, Order } from "./query.fixture.js";

/** Values a summary of the orders would give, for the value slots. */
const VALUES: CompleteJqOptions["values"] = (path, prefix) =>
  (path === "$c" ? ["C01", "C02", "C03"] : path === ".customer_id" ? ["C01", "C02", "C06"] : [])
    .filter(value => value.startsWith(prefix))
    .map((value, i) => ({ value, count: 10 - i }));

interface Cursor {
  /** The text, with the cursor at `|`. */
  at: string;
  root?: boolean;
  /** The labels offered, in order; `!` after one marks `warn`. */
  labels: string[];
  kind?: string;
  /** The first item's detail. */
  detail?: string;
  /** The first item's doc. */
  doc?: string;
  /** The first item's insert. */
  insert?: string;
  /** The replacement's range, as the text it covers. */
  replaces?: string;
}

const CURSORS: readonly Cursor[] = [
  { at: ".|", root: true, labels: ["bom", "byId", "cells", "customers", "forecast", "model", "orders"], kind: "dataset", detail: "Struct{children: Array<…>, cost: Float, sku: String}", doc: "record", replaces: "" },
  { at: ".or|", root: true, labels: ["orders"], kind: "dataset", insert: "orders", replaces: "or" },
  { at: ".o|rders", root: true, labels: ["orders"], replaces: "o" },
  { at: ".|", labels: ["bom", "byId", "cells", "customers", "forecast", "model", "orders"], kind: "field" },
  { at: ".orders[0].|", labels: ["customer_id", "discount", "id", "lines", "status", "total"], kind: "field", detail: "Option<String>", doc: "text, sometimes missing" },
  { at: ".orders[0].to|", labels: ["total"], detail: "Option<Float>", replaces: "to" },
  { at: ".orders[] | .|", labels: ["customer_id", "discount", "id", "lines", "status", "total"], detail: "String", doc: "text" },
  { at: ".orders[] | select(.st|", labels: ["status"], detail: "Variant{cancelled, pending, shipped}", doc: "one of" },
  { at: ".orders[] | select(.status.|", labels: ["type", "value"], doc: "case name: cancelled, pending, shipped" },
  { at: ".orders[] | select(.status.type == \"|", labels: ["cancelled", "pending", "shipped"], kind: "case", detail: "case of Variant{cancelled, pending, shipped}", insert: "cancelled\"", replaces: "" },
  { at: ".orders[] | select(.status.type == \"sh|", labels: ["shipped"], insert: "shipped\"", replaces: "sh" },
  { at: ".orders[] | select(\"p|\" == .status.type)", labels: [] },
  { at: ".orders[] | .status.value.|", labels: ["date!", "reason!"], detail: "Option<DateTime>", doc: "only when .status.type == \"shipped\"" },
  { at: ".orders[] | select(.status.type == \"shipped\") | .status.value.|", labels: ["date"], detail: "DateTime", doc: "date" },
  { at: ".orders[] | if .status.type == \"cancelled\" then .status.value.|", labels: ["reason"], detail: "String" },
  { at: ".orders[] | select(.customer_id == \"C0|", labels: ["C01", "C02", "C06"], kind: "value", detail: "10 in data", insert: "C01\"", replaces: "C0" },
  { at: ".customers as $c | $c[\"C|", labels: ["C01", "C02", "C03"], kind: "key", insert: "C01\"", replaces: "C" },
  { at: ".customers as $c | $c[\"C01\"].|", labels: ["name", "region", "tier"], detail: "Option<String>" },
  { at: ".customers as $cust | .orders[] | $|", labels: ["$cust"], kind: "variable", detail: "Dict<String, Struct{name: String, region: String, tier: Variant{gold, standard}}>", insert: "cust", replaces: "" },
  { at: ".customers as $cust | .orders[] as $o | $c|", labels: ["$cust"], replaces: "c" },
  { at: ".orders | sel|", labels: ["select"], kind: "builtin", detail: "select(f)", insert: "select(", replaces: "sel" },
  { at: ".orders | lengt|", labels: ["length"], insert: "length" },
  { at: ".orders | length|", labels: [] },
  { at: ".orders | first|", labels: [] },
  { at: "def rev: 1; .orders | rev|", labels: ["reverse"] },
  { at: "def rev: 1; .orders | re|", labels: ["recurse", "repeat", "rev", "reverse"] },
  { at: ".orders | map(.lines[] | .|", labels: ["price", "qty", "sku"], detail: "Float" },
  { at: ".forecast.regions.|", labels: ["["], kind: "key", doc: "look up by String key", insert: "[" },
  { at: "if .orders[0].discount then .orders[0].st|", labels: ["status"] },
  { at: "reduce .orders[] as $o (0; . + $o.to|", labels: ["total"], detail: "Float" },
  { at: ".orders[] | {id, t: .to|", labels: ["total"] },
  { at: ".bom.children[0].|", labels: ["children", "cost", "sku"], detail: "Option<Array<Struct{children: Array<…>, cost: Float, sku: String}>>" },
  { at: ".orders[] | |", labels: [] },
];

describe("completeJq (K1)", () => {
  test("covers 30 cursors", () => assert.ok(CURSORS.length >= 30));
  for (const cursor of CURSORS) {
    test(cursor.at, () => {
      // The cursor is the last `|`: a pipe in the program comes before it.
      const at = cursor.at.lastIndexOf("|");
      const text = cursor.at.slice(0, at) + cursor.at.slice(at + 1);
      const done = completeJq(text, at, FixtureRoot, { root: cursor.root === true, values: VALUES });
      if (cursor.labels.length === 0) {
        assert.ok(done === null || done.items.length === 0, `${cursor.at} offers ${done?.items.map(i => i.label).join(", ")}`);
        return;
      }
      assert.ok(done !== null, `${cursor.at} offers nothing`);
      assert.deepEqual(done.items.map(i => `${i.label}${i.warn === true ? "!" : ""}`), cursor.labels);
      const first = done.items[0]!;
      if (cursor.kind !== undefined) assert.equal(first.kind, cursor.kind);
      if (cursor.detail !== undefined) assert.equal(first.detail, cursor.detail);
      if (cursor.doc !== undefined) assert.equal(first.doc, cursor.doc);
      if (cursor.insert !== undefined) assert.equal(first.insert, cursor.insert);
      assert.equal(done.to, at);
      if (cursor.replaces !== undefined) assert.equal(text.slice(done.from, done.to), cursor.replaces);
    });
  }

  test("offers at most 40 items", () => {
    const done = completeJq(".orders | s", 11, FixtureRoot);
    assert.ok(done !== null && done.items.length <= 40 && done.items.length > 0);
    const all = completeJq(".orders | a", 11, FixtureRoot);
    assert.ok(all !== null && all.items.every(i => i.label.startsWith("a")));
  });
});

const ORDER_DESCRIPTION = [
  ".  Struct{customer_id, discount, id, lines, status, total}",
  "  .customer_id  String",
  "  .discount  Option<Float>",
  "  .id  Integer",
  "  .lines  Array<Struct{…}>",
  "    .lines[]  Struct{price, qty, sku}",
  "      .lines[].price  Float",
  "      .lines[].qty  Integer",
  "      .lines[].sku  String",
  "  .status  Variant{cancelled, pending, shipped}",
  "    .status.type  \"cancelled\" | \"pending\" | \"shipped\"",
  "    .status.value  Struct{reason} (when cancelled)",
  "      .status.value.reason  String (when cancelled)",
  "    .status.value  Struct{date} (when shipped)",
  "      .status.value.date  DateTime (when shipped)",
  "  .total  Float",
].join("\n");
const ROOT_DESCRIPTION = [
  ".  Struct{bom, byId, cells, customers, forecast, model, orders}",
  "  .bom  Struct{children, cost, sku}",
  "    .bom.children  Array<Struct{…}>",
  "      .bom.children[]  (recursive: .bom)",
  "    .bom.cost  Float",
  "    .bom.sku  String",
  "  .byId  Dict<Integer, Struct{…}>",
  "    .byId[<Integer>]  Struct{customer_id, discount, id, lines, status, total}",
  "      .byId[<Integer>].customer_id  String",
  "      .byId[<Integer>].discount  Option<Float>",
  "      .byId[<Integer>].id  Integer",
  "      .byId[<Integer>].lines  Array<Struct{…}>",
  "        .byId[<Integer>].lines[]  Struct{price, qty, sku}",
  "          .byId[<Integer>].lines[].price  Float",
  "          .byId[<Integer>].lines[].qty  Integer",
  "          .byId[<Integer>].lines[].sku  String",
  "      .byId[<Integer>].status  Variant{cancelled, pending, shipped}",
  "        .byId[<Integer>].status.type  \"cancelled\" | \"pending\" | \"shipped\"",
  "        .byId[<Integer>].status.value  Struct{reason} (when cancelled)",
  "          .byId[<Integer>].status.value.reason  String (when cancelled)",
  "        .byId[<Integer>].status.value  Struct{date} (when shipped)",
  "          .byId[<Integer>].status.value.date  DateTime (when shipped)",
  "      .byId[<Integer>].total  Float",
  "  .cells  Dict<Struct{…}, Float>",
  "    .cells[<Struct{region: String, week: Integer}>]  Float",
  "  .customers  Dict<String, Struct{…}>",
  "    .customers[<String>]  Struct{name, region, tier}",
  "      .customers[<String>].name  String",
  "      .customers[<String>].region  String",
  "      .customers[<String>].tier  Variant{gold, standard}",
  "        .customers[<String>].tier.type  \"gold\" | \"standard\"",
  "  .forecast  Struct{regions}",
  "    .forecast.regions  Dict<String, Struct{…}>",
  "      .forecast.regions[<String>]  Struct{weekly}",
  "        .forecast.regions[<String>].weekly  Array<Float>",
  "          .forecast.regions[<String>].weekly[]  Float",
  "  .model  Function([Struct{price: Float, region: String}], Float)",
  "  .orders  Array<Struct{…}>",
  "    .orders[]  Struct{customer_id, discount, id, lines, status, total}",
  "      .orders[].customer_id  String",
  "      .orders[].discount  Option<Float>",
  "      .orders[].id  Integer",
  "      .orders[].lines  Array<Struct{…}>",
  "        .orders[].lines[]  Struct{price, qty, sku}",
  "          .orders[].lines[].price  Float",
  "          .orders[].lines[].qty  Integer",
  "          .orders[].lines[].sku  String",
  "      .orders[].status  Variant{cancelled, pending, shipped}",
  "        .orders[].status.type  \"cancelled\" | \"pending\" | \"shipped\"",
  "        .orders[].status.value  Struct{reason} (when cancelled)",
  "          .orders[].status.value.reason  String (when cancelled)",
  "        .orders[].status.value  Struct{date} (when shipped)",
  "          .orders[].status.value.date  DateTime (when shipped)",
  "      .orders[].total  Float",
].join("\n");


describe("describeJqType (K2)", () => {
  test("an order", () => assert.equal(describeJqType(Order), ORDER_DESCRIPTION));
  test("the fixture's root", () => assert.equal(describeJqType(FixtureRoot), ROOT_DESCRIPTION));
  test("stops at maxDepth", () => {
    assert.equal(describeJqType(Order, { maxDepth: 0 }), ".  Struct{customer_id, discount, id, lines, status, total}");
  });
  test("plain kinds", () => {
    assert.equal(plainKind(OptionType(FloatType)), "number, sometimes missing");
    assert.equal(plainKind(Order), "record");
  });
});
