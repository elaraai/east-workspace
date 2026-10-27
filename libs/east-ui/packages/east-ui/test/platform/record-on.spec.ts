/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A generated index's `on` (#1432): its leading values printed by East as one
 * literal of the key's `on` — no leading field, a String with a quote in it, a
 * variant case and an Option among them — read off the binding's index key
 * types, each index's printer made once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, IntegerType, NullType, OptionType, StringType, StructType, VariantType } from "@elaraai/east";
import { recordOnPrinter, recordOnPrinters, recordOnTypeOf } from "../../src/platform/slice/record-on.js";

test("an `on` is printed by East: each leading value parsed at its field's type, the struct printed at `on`'s", () => {
    assert.equal(recordOnPrinter(StructType({}))([]), "()", "no leading field");
    assert.equal(recordOnPrinter(StructType({ hall: StringType }))(['"H\\"1"']), '(hall="H\\"1")', "a String with a quote in it");
    assert.equal(recordOnPrinter(StructType({ state: VariantType({ late: NullType, held: NullType }) }))([".late"]), "(state=.late)", "a variant case");
    assert.equal(recordOnPrinter(StructType({ owner: OptionType(StringType) }))(['.some "Kim"']), '(owner=.some "Kim")', "an Option");
    assert.equal(recordOnPrinter(StructType({ owner: OptionType(StringType) }))([".none"]), "(owner=.none)");
    assert.equal(recordOnPrinter(StructType({ hall: StringType, floor: IntegerType }))(['"H1"', "2"]), '(hall="H1", floor=2)', "in the index's order");
});

test("an `on` refuses leading values that are not its fields', naming why", () => {
    assert.throws(() => recordOnPrinter(StructType({ hall: StringType }))([]), /led by 1 field names 0 leading values/);
    assert.throws(() => recordOnPrinter(StructType({}))(['"H1"']), /led by 0 fields names 1 leading value/);
    assert.throws(() => recordOnPrinter(StructType({ floor: IntegerType }))(['"two"']), /'floor' is not a value of its field/);
});

test("each generated index's printer is read off the binding's index key types, made once; a plain index's key holds no `on`", () => {
    const Area = StructType({ on: StructType({ hall: StringType }), area: IntegerType });
    const Interval = StructType({ on: StructType({}), node: IntegerType, at: OptionType(DateTimeType) });
    const Plain = StructType({ hall: StringType, floor: IntegerType });
    assert.equal(recordOnTypeOf(Area), Area.fields.on);
    assert.equal(recordOnTypeOf(Plain), undefined, "a plain index's fields are the row's own");
    assert.equal(recordOnTypeOf(StringType), undefined);
    const printers = recordOnPrinters({ primary: StringType, by_hall_area: Area, by_time: Interval, by_hall_floor: Plain });
    assert.equal(printers("by_hall_area")(['"H1"']), '(hall="H1")');
    assert.equal(printers("by_time")([]), "()");
    assert.equal(printers("by_hall_area"), printers("by_hall_area"), "made once an index");
    assert.throws(() => printers("by_hall_floor"), /'by_hall_floor' is no generated index: its key holds no on/);
    assert.throws(() => printers("by_nothing"), /'by_nothing' is no generated index/);
});
