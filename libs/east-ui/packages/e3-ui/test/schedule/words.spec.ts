/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The number the Allocation's and the Roster's pure functions write
 * (`scheduleNumberText`): a whole number without a decimal point, any other as
 * East prints it — one printer, so the two builders' words agree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { East } from "@elaraai/east";
import { allocationQuantityText, scheduleNumberText } from "@elaraai/e3-ui/internal";

const number = East.compile(scheduleNumberText, []);
const quantity = East.compile(allocationQuantityText, []);

test("a whole number prints without a decimal point; any other as East prints it", () => {
    assert.deepEqual([21, 0, -4, 1500, 12.5, 0.75, -2.5].map(value => number(value)), ["21", "0", "-4", "1500", "12.5", "0.75", "-2.5"]);
});

test("the Allocation's quantities print their number through it", () => {
    assert.deepEqual([quantity(21, "m³"), quantity(12.5, "m³"), quantity(21, "")], ["21 m³", "12.5 m³", "21"]);
});
