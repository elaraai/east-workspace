/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a Record's select column ticks (east-workspace#1737): the example
 * (`recordTicks`); the Record handing its sheet the app's `onTick` — held to
 * a Set of the record's keys, each read back from its row's id — and none
 * unless given; and the refusal of a function over a Set of another type.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, IntegerType, NullType, RefType, SetType, SortedSet, StringType, StructType, compareFor, equalFor, printFor, ref } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Data, Record, RecordPayloadType } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { refusingPlatform } from "../refusing-platform.js";
import * as ex from "./record-ticks.examples.js";

describeEast("Record — the rows it ticks (east-workspace#1737)", test => {
    Assert.examples(test, { recordTicks: ex.recordTicks });
}, { platformFns: TestImpl });

/** A bench, keyed by its number. */
const Bench = StructType({ name: StringType });
const benches = e3.record("record_ticks_benches", DictType(IntegerType, Bench), {
    initial: new Map([[1n, { name: "Assembly 1" }], [7n, { name: "Finishing" }]]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The benches' columns. */
const BENCH_COLUMNS = { name: Record.column.title(Bench, { header: "Bench" }) };

const Benches = SetType(IntegerType);
const benchesEqual = equalFor(Benches);
const printBenches = printFor(Benches);

describe("the Record's ticks (east-workspace#1737)", () => {
    test("hands its sheet onTick at the record's key type: an Integer-keyed record's ticked rows arrive as the Integers their ids are the text of", () => {
        // Over a window, the payload is built — and the ticks heard — without reading the record.
        const heard = East.compile(East.function([], Benches, ($) => {
            const keys = $.let(ref(new SortedSet<bigint>(undefined, compareFor(IntegerType))), RefType(Benches));
            const onTick = $.const(East.function([Benches], NullType, ($2, ticked) => { $2(keys.update(ticked)); }));
            const payload = $.const(Record.Payload({ record: Record.bind(benches), window: Data.bindPaged(benches), columns: BENCH_COLUMNS, onTick }));
            $(payload.sheet.onTick.unwrap("some")(East.value(new SortedSet(["7", "1"], compareFor(StringType)), SetType(StringType))));
            return keys.get();
        }), refusingPlatform)();
        assert.ok(benchesEqual(heard, new SortedSet([1n, 7n], compareFor(IntegerType))), `heard benches ${printBenches(heard)}`);
    });

    test("hands its sheet no onTick unless given", () => {
        const payload = East.compile(East.function([], RecordPayloadType, (_$) => Record.Payload({
            record: Record.bind(benches), window: Data.bindPaged(benches), columns: BENCH_COLUMNS,
        })), refusingPlatform)();
        assert.equal(payload.sheet.onTick.type, "none");
    });

    test("refuses a function over a Set of another type, naming the record's key type", () => {
        assert.throws(() => East.function([], RecordPayloadType, ($) => {
            const overText = $.const(East.function([SetType(StringType)], NullType, (_$2, _keys) => null));
            return Record.Payload({
                record: Record.bind(benches), window: Data.bindPaged(benches), columns: BENCH_COLUMNS,
                onTick: overText as never,
            });
        }), /^Error: Record: `onTick` hears the ticked rows' keys — East\.function\(\[SetType\(K\)\], NullType, …\), K the rows' key type, here \.Integer$/);
    });
});
