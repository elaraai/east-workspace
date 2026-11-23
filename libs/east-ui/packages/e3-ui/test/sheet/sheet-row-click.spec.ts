/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A click on a row (east-workspace#1727): the root carries the app's
 * `onRowClick`, held to the rows' key type — a `data` sheet's String ids, a
 * record's own keys, an Integer and a struct among them, and a grouped sheet's
 * groups — and the grid's click, the row by its id, reaches it with the row's
 * key read back from the id, the line's place and the column as the grid gives
 * them. A function over a click of another key type is refused, naming the type
 * the rows are keyed by.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import {
    ArrayType, DictType, East, IntegerType, NullType, OptionType, RefType, SortedMap, StringType, StructType, compareFor, none, ref, some,
} from "@elaraai/east";
import { Sheet, createSheetRootWith } from "@elaraai/e3-ui/internal";
import * as ex from "./sheet-row-click.examples.js";

// ── The fixtures, at module scope: the East bodies below bind them with `$.const`.
const JobType = StructType({ id: StringType, task: StringType, qty: IntegerType });
const JOBS = [{ id: "a", task: "Routing", qty: 2n }, { id: "b", task: "Spray", qty: 1n }];
const TASK = { task: Sheet.column.text(JobType, { header: "Task" }) };

/** A record's jobs, keyed by a number and by a struct of their bay and their slot. */
const KeyedJob = StructType({ task: StringType, qty: IntegerType });
const KEYED = { task: Sheet.column.text(KeyedJob, { header: "Task" }) };
const BY_NUMBER = new SortedMap([[42n, { task: "Routing", qty: 2n }]], compareFor(IntegerType));
const SlotKey = StructType({ bay: StringType, slot: IntegerType });
const BY_SLOT = new SortedMap([[{ bay: "B2", slot: 3n }, { task: "Spray", qty: 1n }]], compareFor(SlotKey));

/** Plans, each a group of lines. */
const LineType = StructType({ task: StringType });
const PlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) });
const PLANS = [{ id: "p1", name: "Week 8", lines: [{ task: "Cut" }, { task: "Drill" }] }];

/** A click as `data`'s rows hear it — their keys their String ids — kept once heard. */
const HeardText = OptionType(Sheet.Types.RowClick(StringType));

describeEast("Sheet — a click on a row (east-workspace#1727)", test => {
    Assert.examples(test, {
        sheetRowClickGrouped: ex.sheetRowClickGrouped,
    });

    test("the root carries the app's onRowClick when given, and none without it", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const onRowClick = $.const(East.function([Sheet.Types.RowClick(StringType)], NullType, (_$2, _click) => null));
        const given = $.const(Sheet.Root(rows, TASK, { id: "id", onRowClick }));
        const without = $.const(Sheet.Root(rows, TASK, { id: "id" }));
        $(Assert.equal(given.onRowClick.hasTag("some"), true));
        $(Assert.equal(without.onRowClick.hasTag("none"), true));
    });

    test("over data, a click is heard with the row's id as its key and the column clicked, at no place in a group", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const heard = $.let(ref(none), RefType(HeardText));
        const onRowClick = $.const(East.function([Sheet.Types.RowClick(StringType)], NullType, ($2, click) => { $2(heard.update(East.value(some(click), HeardText))); }));
        const root = $.const(Sheet.Root(rows, TASK, { id: "id", onRowClick }));
        $(root.onRowClick.unwrap("some")({ rowId: "b", index: none, column: some("task") }));
        $(Assert.equal(heard.get(), some({ key: "b", index: none, column: some("task") })));
        // A press on the row's number names no column.
        $(root.onRowClick.unwrap("some")({ rowId: "a", index: none, column: none }));
        $(Assert.equal(heard.get(), some({ key: "a", index: none, column: none })));
    });

    test("a bare lambda is built at the click of the rows' key type", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const heard = $.let(ref(none), RefType(HeardText));
        const root = $.const(Sheet.Root(rows, TASK, { id: "id", onRowClick: ($2, click) => { $2(heard.update(East.value(some(click), HeardText))); } }));
        $(root.onRowClick.unwrap("some")({ rowId: "a", index: none, column: some("task") }));
        $(Assert.equal(heard.get(), some({ key: "a", index: none, column: some("task") })));
    });

    test("over a record keyed by Integer, the key arrives as the Integer the row's id is the text of", $ => {
        const jobs = $.const(BY_NUMBER, DictType(IntegerType, KeyedJob));
        const heard = $.let(ref(0n), RefType(IntegerType));
        const onRowClick = $.const(East.function([Sheet.Types.RowClick(IntegerType)], NullType, ($2, click) => { $2(heard.update(click.key)); }));
        const root = $.const(createSheetRootWith(jobs, KEYED, { onRowClick }, { keyOrdered: true }));
        $(root.onRowClick.unwrap("some")({ rowId: "42", index: none, column: some("task") }));
        $(Assert.equal(heard.get(), 42n));
    });

    test("over a record keyed by a struct, the key arrives as the struct, read back from the text East prints it as", $ => {
        const jobs = $.const(BY_SLOT, DictType(SlotKey, KeyedJob));
        const heard = $.let(ref({ bay: "", slot: 0n }), RefType(SlotKey));
        const onRowClick = $.const(East.function([Sheet.Types.RowClick(SlotKey)], NullType, ($2, click) => { $2(heard.update(click.key)); }));
        const root = $.const(createSheetRootWith(jobs, KEYED, { onRowClick }, { keyOrdered: true }));
        // The row's id is its key's text, as the rows of a record keyed by a struct are identified.
        const id = $.const(East.print(East.value({ bay: "B2", slot: 3n }, SlotKey)));
        $(root.onRowClick.unwrap("some")({ rowId: id, index: none, column: none }));
        $(Assert.equal(heard.get(), { bay: "B2", slot: 3n }));
    });

    test("on a grouped sheet, a click is heard with its group's key, and on a line with the line's place among the group's lines", $ => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const heard = $.let(ref(none), RefType(HeardText));
        const onRowClick = $.const(East.function([Sheet.Types.RowClick(StringType)], NullType, ($2, click) => { $2(heard.update(East.value(some(click), HeardText))); }));
        const root = $.const(Sheet.Root(plans, { task: Sheet.column.text(LineType, { header: "Task" }) }, {
            id: "id", group: Sheet.group(PlanType, "lines", { title: "name" }), onRowClick,
        }));
        $(root.onRowClick.unwrap("some")({ rowId: "p1", index: some(1n), column: some("task") }));
        $(Assert.equal(heard.get(), some({ key: "p1", index: some(1n), column: some("task") })));
        // The group's own band: its title, at no line.
        $(root.onRowClick.unwrap("some")({ rowId: "p1", index: none, column: some("$title") }));
        $(Assert.equal(heard.get(), some({ key: "p1", index: none, column: some("$title") })));
    });
}, { platformFns: TestImpl });

describe("Sheet — onRowClick refused (east-workspace#1727)", () => {
    test("a function over a click keyed by another type is refused, naming the type the rows are keyed by", () => {
        assert.throws(() => East.function([], Sheet.Types.Root, ($) => {
            const jobs = $.const(BY_NUMBER, DictType(IntegerType, KeyedJob));
            const overText = $.const(East.function([Sheet.Types.RowClick(StringType)], NullType, (_$2, _click) => null));
            return createSheetRootWith(jobs, KEYED, { onRowClick: overText }, { keyOrdered: true });
        }), /^Error: Sheet: `onRowClick` hears a click on a row — East\.function\(\[Sheet\.Types\.RowClick\(K\)\], NullType, …\), K the rows' key type, here \.Integer$/);
    });

    test("a function that gives a value, or takes the selection, is refused the same way", () => {
        for (const fn of [
            East.function([Sheet.Types.RowClick(StringType)], StringType, (_$2, click) => click.key),
            East.function([Sheet.Types.Selection], NullType, (_$2, _selection) => null),
        ]) {
            assert.throws(() => East.function([], Sheet.Types.Root, ($) => {
                const rows = $.const(JOBS, ArrayType(JobType));
                return Sheet.Root(rows, TASK, { id: "id", onRowClick: fn as never });
            }), /^Error: Sheet: `onRowClick` hears a click on a row — .*, here \.String$/);
        }
    });
});
