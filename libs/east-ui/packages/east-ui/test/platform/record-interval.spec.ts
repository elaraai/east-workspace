/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The interval index's planner (#1432): its marker names its start and end by
 * role and reads back as itself; its searches of the key's own fields name
 * the leading values as one `on`, `[on, 0]` its every start and
 * `[on, 0, start]` an exact one; and a window's ranges bound the key
 * flattened, the leading values one by one, whatever `on` is printed as.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, StringType, StructType, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "../../src/contracts/source.js";
import { intervalMarkerFields, intervalQueries, readIntervalMarker } from "../../src/platform/slice/record-interval.js";
import { recordOnPrinter } from "../../src/platform/slice/record-on.js";

type Query = ValueTypeOf<typeof SeekQueryType>;
const interval = { from: "start", to: "end", optional: false };
const UNLED = recordOnPrinter(StructType({}));
const BY_PRESS = recordOnPrinter(StructType({ press: StringType }));
const printInstant = printFor(DateTimeType);
const window = variant("range", { from: printInstant(new Date(Date.UTC(2026, 9, 5))), to: printInstant(new Date(Date.UTC(2026, 9, 12))) });

test("an interval marker names its start and end by role, and reads back as itself", () => {
    for (const marker of [{ from: "start", to: "end" }, { from: "at", to: "at" }, { from: "from=x", to: "to" }]) {
        assert.deepEqual(readIntervalMarker(intervalMarkerFields(marker)), marker);
    }
    assert.deepEqual(intervalMarkerFields({ from: "start", to: "end" }), ["from=start", "to=end"]);
    for (const names of [["from=start"], ["to=end"], ["from=a", "from=b", "to=c"], ["start", "to=end"], ["=start", "to=end"], ["at=start", "to=end"]]) {
        assert.equal(readIntervalMarker(names), undefined, names.join(", "));
    }
});

test("its starts are one search of `[on, 0]`, an exact start `[on, 0, start]`: the leading values one `on` literal", () => {
    assert.deepEqual(intervalQueries(['"P-1"'], undefined, interval, BY_PRESS), [variant("fields", { values: ['(press="P-1")', "0"], prefix: none })]);
    assert.deepEqual(intervalQueries([], undefined, interval, UNLED), [variant("fields", { values: ["()", "0"], prefix: none })], "led by no field");
    const at = printInstant(new Date(Date.UTC(2026, 9, 5, 8)));
    assert.deepEqual(intervalQueries(['"P-1"'], variant("values", [at, at]), interval, BY_PRESS),
        [variant("fields", { values: ['(press="P-1")', "0", at], prefix: none })], "each start once");
});

test("a window's ranges bound the key flattened, the leading values one by one: its starts, then each ancestor's carry-ins", () => {
    const led = intervalQueries(['"P-1"'], window, interval, BY_PRESS);
    const unled = intervalQueries([], window, interval, UNLED);
    const range = (query: Query) => {
        assert.equal(query.type, "range");
        return query.type === "range" ? query.value : { from: [], to: [] };
    };
    assert.deepEqual(range(led[0]!), { from: ['"P-1"', "0", window.value.from], to: ['"P-1"', "0", window.value.to] }, "the starts inside it first");
    assert.ok(led.length > 1 && led.length <= 55, `at most 54 carry-ins: ${led.length - 1}`);
    assert.ok(led.every(query => range(query).from[0] === '"P-1"' && range(query).to[0] === '"P-1"'), "every range under its press, a leaf");
    // The same ranges led by no field, the press's leaf gone: no range names an `on`.
    assert.deepEqual(unled.map(query => [range(query).from, range(query).to]), led.map(query => [range(query).from.slice(1), range(query).to.slice(1)]));
    assert.deepEqual(intervalQueries(['"P-1"'], window, interval, recordOnPrinter(StructType({ press: StringType }))), led, "whatever its printer");
});

test("a window it cannot plan is refused, naming why", () => {
    assert.throws(() => intervalQueries([], variant("prefix", "2026"), interval, UNLED), /Choose a time range for interval overlap/);
    assert.throws(() => intervalQueries([], variant("range", { from: window.value.to, to: window.value.from }), interval, UNLED), /end must be after its start/);
    assert.throws(() => intervalQueries([], variant("range", { from: "monday", to: window.value.to }), interval, UNLED), /valid DateTime range endpoints/);
});
