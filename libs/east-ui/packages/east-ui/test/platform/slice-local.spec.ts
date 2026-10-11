/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { ArrayType, East, IntegerType, StringType, StructType } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { Assert, describeEast, TestImpl } from "@elaraai/east-node-std";
import * as ex from "./slice-local.examples.js";

describeEast("Typed local Slice", test => {
    Assert.examples(test, { sliceLocalRows: ex.sliceLocalRows });
}, { platformFns: TestImpl });

// These calls are checked by tsc and never evaluated. The inferred row type
// must reject invalid options instead of widening to accommodate them.
const typeChecks = () => {
    const Row = StructType({ customer: StringType, quantity: IntegerType });
    const rows = East.value([], ArrayType(Row));
    // @ts-expect-error An undeclared field cannot be offered.
    Slice.bind("bad.field", rows, { fields: { missing: {} } });
    // @ts-expect-error A String is not a range field.
    Slice.bind("bad.range", rows, { range: "customer" });
    // @ts-expect-error Integer predicates take bigints or Integer expressions.
    Slice.bind("bad.value", rows, { initial: { quantity: { gte: "10" } } });
    // @ts-expect-error Arrays in hand cannot use the record arm.
    Slice.bindRecord("bad.record", rows);
};
void typeChecks;
