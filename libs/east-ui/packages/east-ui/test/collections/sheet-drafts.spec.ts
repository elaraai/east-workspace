/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, IntegerType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { Sheet, UIComponentType } from "@elaraai/east-ui/internal";

const Row = StructType({ id: StringType, qty: IntegerType, note: OptionType(StringType), hidden: ArrayType(StringType) });
const Draft = Sheet.Types.Draft(Row);
const wire = { id: "a", owned: false, cells: new Map([["qty", variant("Integer", 5n)]]), lines: [], band: none, subRows: [] };
const encodeWire = encodeBeast2For(Sheet.Types.Row);
const source = East.value([{ id: "a", qty: 1n, note: none, hidden: ["keep"] }], ArrayType(Row));
const view = East.function([], UIComponentType, () => Sheet.Root(source, {
    qty: Sheet.column.integer(Row), note: Sheet.column.text(Row),
}, { id: "id" })).toIR().compile([])();
if (view.type !== "Sheet") throw new Error("Expected Sheet");
const editing = view.value.editing;
const base = { id: variant("value", "a"), qty: variant("value", 1n), note: variant("value", none), hidden: variant("value", ["keep"]) };

test("the factory's draft decoder preserves hidden fields and explicit optional none", () => {
    const out = decodeBeast2For(Draft)(editing.decode(encodeWire(wire), some(encodeBeast2For(Draft)(base)), none));
    assert.deepEqual(out, { ...base, qty: variant("value", 5n) });
});
test("a new row keeps omitted fields missing instead of inventing defaults", () => {
    const out = decodeBeast2For(Draft)(editing.decode(encodeWire(wire), none, none));
    assert.deepEqual(out, { id: variant("value", "a"), qty: variant("value", 5n), note: variant("missing", null), hidden: variant("missing", null) });
});
test("clearing a required value keeps a missing draft, and mismatched input keeps its text", () => {
    const encodeBase = some(encodeBeast2For(Draft)(base));
    const cleared = { ...wire, cells: new Map([["qty", variant("Null", null)]]) };
    assert.equal(decodeBeast2For(Draft)(editing.decode(encodeWire(cleared), encodeBase, none)).qty.type, "missing");
    const bad = { ...wire, cells: new Map([["qty", variant("String", "several")]]) };
    assert.deepEqual(decodeBeast2For(Draft)(editing.decode(encodeWire(bad), encodeBase, none)).qty, variant("invalid", "several"));
});
