/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A click on a Record's row, and its selection (east-workspace#1727): the
 * examples (`recordRowClick`, `recordRowClickInteger`); the Record handing its
 * sheet the app's `onRowClick` — held to the record's key type, the key read
 * back from the row's id — and the Sheet's `onSelect` and `selection` as they
 * are; and the refusal of a function over a click of another key type.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { East, IntegerType, NullType, RefType, StringType, equalFor, none, printFor, ref, some } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Data, Record, RecordPayloadType, Sheet } from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
import * as ex from "./record-row-click.examples.js";

describeEast("Record — a click on a row (east-workspace#1727)", test => {
    Assert.examples(test, {
        recordRowClick: ex.recordRowClick,
        recordRowClickInteger: ex.recordRowClickInteger,
    });
}, { platformFns: TestImpl });

/** The benches' columns. */
const BENCH_COLUMNS = {
    name: Record.column.title(ex.RowClickBench, { header: "Bench" }),
    holds: Record.column.text(ex.RowClickBench, { header: "Holds" }),
};

const selectionEqual = equalFor(RecordPayloadType.fields.sheet.fields.selection);

describe("the Record's click and selection (east-workspace#1727)", () => {
    test("hands its sheet onRowClick at the record's key type: an Integer-keyed bench's key arrives as the Integer its row's id is the text of", () => {
        // Over a window, the payload is built — and the click heard — without reading the record.
        const heard = East.compile(East.function([], IntegerType, ($) => {
            const key = $.let(ref(0n), RefType(IntegerType));
            const onRowClick = $.const(East.function([Record.Types.RowClick(IntegerType)], NullType, ($2, click) => { $2(key.update(click.key)); }));
            const payload = $.const(Record.Payload({
                record: Record.bind(ex.recordRowClickBenches), window: Data.bindPaged(ex.recordRowClickBenches), columns: BENCH_COLUMNS, onRowClick,
            }));
            $(payload.sheet.onRowClick.unwrap("some")({ rowId: "7", index: none, column: some("name") }));
            return key.get();
        }), refusingPlatform)();
        assert.ok(equalFor(IntegerType)(heard, 7n), `heard bench ${printFor(IntegerType)(heard)}`);
    });

    test("hands its sheet the Sheet's onSelect and selection as they are, and no onRowClick unless given", () => {
        const payload = East.compile(East.function([], RecordPayloadType, ($) => {
            const onSelect = $.const(East.function([Sheet.Types.Selection], NullType, (_$2, _selection) => null));
            return Record.Payload({
                record: Record.bind(ex.recordRowClickBenches), window: Data.bindPaged(ex.recordRowClickBenches), columns: BENCH_COLUMNS,
                onSelect, selection: some({ rowId: some("7"), line: none, key: some("holds") }),
            });
        }), refusingPlatform)();
        assert.equal(payload.sheet.onSelect.type, "some");
        assert.ok(selectionEqual(payload.sheet.selection, some({ rowId: some("7"), line: none, key: some("holds") })));
        assert.equal(payload.sheet.onRowClick.type, "none");
    });

    test("refuses a function over a click keyed by another type, naming the record's key type", () => {
        assert.throws(() => East.function([], RecordPayloadType, ($) => {
            const overText = $.const(East.function([Record.Types.RowClick(StringType)], NullType, (_$2, _click) => null));
            return Record.Payload({
                record: Record.bind(ex.recordRowClickBenches), window: Data.bindPaged(ex.recordRowClickBenches), columns: BENCH_COLUMNS,
                onRowClick: overText as never,
            });
        }), /^Error: Record: `onRowClick` hears a click on a row — East\.function\(\[Record\.Types\.RowClick\(K\)\], NullType, …\), K the rows' key type, here \.Integer$/);
    });
});
