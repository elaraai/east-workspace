/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's rows (#1182, `Sheet Builder Spec.md` SB13–SB17): the root over a
 * record's whole Dict, read in key order — its rows, its keyed session, a row
 * read by its key — and the refusals that keep an author's inline Dict out;
 * then `recordRows`, the two ways a record's rows reach a sheet, and what
 * each refuses. How an Apply lands in a record runs in e3-ui-components'
 * `sheet-record-rows` spec, against the record runtime.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, AsyncFunctionType, BooleanType, DateTimeType, DictType, East, EastTypeType, Expr, IntegerType, NullType, OptionType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, equalFor, isTypeEqual, none, toEastTypeValue, variant, type BlockBuilder, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { Data, Record, Sheet, createSheetPayloadWith, recordRows, type SheetInternalOptions } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";

const JobType = StructType({ task: StringType, qty: IntegerType });
const COLUMNS = {
    task: Sheet.column.text(JobType, { header: "Task" }),
    qty: Sheet.column.integer(JobType, { header: "Qty" }),
};

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const BY_TEXT = new SortedMap([["J-0002", { task: "Edge banding", qty: 3n }], ["J-0001", { task: "Panel cutting", qty: 48n }]], compareFor(StringType));
const BY_NUMBER = new SortedMap([[10n, { task: "Spray finish", qty: 2n }], [9n, { task: "Assembly", qty: 1n }]], compareFor(IntegerType));
const BY_DAY = new SortedMap([[new Date("2026-10-06T00:00:00Z"), { task: "Delivery", qty: 1n }]], compareFor(DateTimeType));

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
const schemaEqual = equalFor(EastTypeType);
const textJobs = DictType(StringType, JobType);
const numberJobs = DictType(IntegerType, JobType);
const dayJobs = DictType(DateTimeType, JobType);

/** A sheet over the jobs keyed by text, read in key order, compiled. */
const textSheet = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const jobs = $.const(BY_TEXT, textJobs);
    return createSheetPayloadWith(jobs, COLUMNS, {}, { keyOrdered: true });
}), []);
/** A sheet over jobs keyed by number: its new rows' keys named by `newRowId`. */
const numberSheet = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const jobs = $.const(BY_NUMBER, numberJobs);
    const next = $.const(East.function([], StringType, (_$) => "11"));
    return createSheetPayloadWith(jobs, COLUMNS, { newRowId: next }, { keyOrdered: true });
}), []);
/** A sheet over jobs keyed by day, which takes no new rows. */
const daySheet = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const jobs = $.const(BY_DAY, dayJobs);
    return createSheetPayloadWith(jobs, COLUMNS, { edits: { insertRows: false } }, { keyOrdered: true });
}), []);

const ids = (root: Root): string[] => {
    if (root.rows.type !== "inline") assert.fail(`expected inline rows, got ${root.rows.type}`);
    return root.rows.value.map((row) => row.id);
};
const decodeJob = decodeBeast2For(JobType);
const jobEqual = equalFor(JobType);

describe("a record's whole Dict, read in key order", () => {
    test("its rows sit in key order, each row's id its key's text (SB13)", () => {
        assert.deepEqual(ids(textSheet()), ["J-0001", "J-0002"]);
        // Any other key is its `.east` printing, in the key type's own order.
        assert.deepEqual(ids(numberSheet()), ["9", "10"]);
        assert.deepEqual(ids(daySheet()), ["2026-10-06T00:00:00.000"]);
    });

    test("its session is keyed: the key type, the Dict its snapshot, a row read by its key, no flat moves", () => {
        const root = textSheet();
        const key = root.editing.keyType;
        if (key.type !== "some") assert.fail("expected a key type");
        assert.ok(schemaEqual(key.value, toEastTypeValue(StringType)));
        const snapshot = root.editing.snapshot;
        if (snapshot.type !== "some") assert.fail("expected the Dict as the session's snapshot");
        assert.ok(equalFor(textJobs)(decodeBeast2For(textJobs)(snapshot.value), BY_TEXT));
        const read = root.editing.readEntry("J-0002", 0n);
        if (read.type !== "some") assert.fail("expected J-0002 read by its key");
        assert.ok(jobEqual(decodeJob(read.value), BY_TEXT.get("J-0002")!));
        assert.equal(root.editing.readEntry("J-0003", 0n).type, "none");
        assert.equal(root.editing.edits.moveRows.type, "none");
        assert.equal(root.editing.idField.type, "none", "a keyed source needs no id field: its key is the id");
    });

    test("a key of another type is read from its text, and text that names no key reads nothing", () => {
        const root = numberSheet();
        const read = root.editing.readEntry("10", 1n);
        if (read.type !== "some") assert.fail("expected 10 read by its key");
        assert.ok(jobEqual(decodeJob(read.value), BY_NUMBER.get(10n)!));
        assert.equal(root.editing.readEntry("ten", 0n).type, "none");
        const key = root.editing.keyType;
        if (key.type !== "some") assert.fail("expected a key type");
        assert.ok(schemaEqual(key.value, toEastTypeValue(IntegerType)));
    });

    test("an author's inline Dict is still refused, and key order reads only a Dict", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            const jobs = $.const(BY_TEXT, textJobs);
            $(Sheet.Root(jobs as never, COLUMNS, {} as never));
        }), /a dictionary's rows sit in key order, not the planner's/);
        assert.throws(() => East.function([], NullType, ($) => {
            const jobs = $.const([...BY_TEXT.values()], ArrayType(JobType));
            $(createSheetPayloadWith(jobs, COLUMNS, {}, { keyOrdered: true }));
        }), /a key-ordered sheet reads a Dict — a record's entries, in key order — and this source holds/);
    });

    test("a key that is not a String needs `newRowId` to name a new row", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            const jobs = $.const(BY_NUMBER, numberJobs);
            $(createSheetPayloadWith(jobs, COLUMNS, {}, { keyOrdered: true }));
        }), /the rows are keyed by \.Integer, and a new row's key is minted only for a String key — pass `newRowId`/);
    });

    test("a keyed Apply takes the session's keyed batch, and no onApply or onUpdate beside it", () => {
        const applied = East.asyncFunction([Editing.Types.ChangeSet(JobType, StringType)], Editing.Types.ApplyResult,
            (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));
        const keyed = (internal: SheetInternalOptions, options: object = {}) => East.function([], NullType, ($) => {
            const jobs = $.const(BY_TEXT, textJobs);
            $(createSheetPayloadWith(jobs, COLUMNS, options, { keyOrdered: true, ...internal }));
        });
        keyed({ applyKeyed: applied });
        const positional = East.asyncFunction([Editing.Types.ChangeSet(JobType)], Editing.Types.ApplyResult,
            (_$, _batch) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));
        assert.throws(() => keyed({ applyKeyed: positional }), /a keyed Apply must be an East function over this sheet's keyed batch, ChangeSet\(R, K\)/);
        assert.throws(() => keyed({ applyKeyed: applied }, { onApply: positional }), /a sheet over a record commits through the record — it takes no onApply or onUpdate of its own/);
    });
});

describe("recordRows — the two ways a record's rows reach a sheet", () => {
    const jobs = e3.record("sheet_record_jobs", textJobs, new Map());
    const jobsPatch = e3.mutation.patch(jobs);
    const PlanRowType = StructType({ id: StringType, task: StringType, qty: IntegerType });
    const WeekType = StructType({ starts: DateTimeType, rows: ArrayType(PlanRowType) });
    const plans = e3.record("sheet_record_plans", DictType(StringType, WeekType), new Map());
    const plansPatch = e3.mutation.patch(plans);
    const planColumns = { task: Sheet.column.text(PlanRowType, { header: "Task" }), qty: Sheet.column.integer(PlanRowType, { header: "Qty" }) };

    /** Run `build` inside a bound handle's block, as a builder's factory runs. */
    function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
        let out: T | undefined;
        East.function([], NullType, ($) => { out = build($); });
        return out!;
    }
    const typeOf = (e: unknown): EastType => Expr.type(e as Expr) as EastType;

    test("the entries: the record read whole, in key order, its batches handed to Record.onApply keyed (SB13, SB16)", () => {
        inBlock(($) => {
            const record = $.let(Record.bind(jobs, [jobsPatch]));
            const rows = recordRows(record);
            assert.equal(rows.data, record);
            assert.equal(rows.internal.keyOrdered, true);
            assert.ok(isTypeEqual(typeOf(rows.internal.applyKeyed),
                AsyncFunctionType([Editing.Types.ChangeSet(JobType, StringType)], Editing.Types.ApplyResult)));
            assert.ok(isTypeEqual(typeOf(rows.internal.sourceId), StringType), "the session's source is the record");
            assert.ok(isTypeEqual(typeOf(createSheetPayloadWith(rows.data, COLUMNS, rows.options, rows.internal)), Sheet.Types.Root));
        });
    });

    test("the entries a window at a time: a keyed paged source, committed the same way", () => {
        inBlock(($) => {
            const record = $.let(Record.bind(jobs, [jobsPatch]));
            const page = $.let(Data.bindPaged(jobs));
            const rows = recordRows(record, { window: page });
            assert.equal(rows.internal.keyOrdered, undefined, "a paged Dict is keyed already");
            assert.ok(rows.internal.applyKeyed !== undefined);
            assert.ok(isTypeEqual(typeOf(createSheetPayloadWith(rows.data, COLUMNS, rows.options, rows.internal)), Sheet.Types.Root));
        });
    });

    test("one entry's rows: its Array field, identified by `id`, committed as one diff of that entry (SB15, SB16)", () => {
        inBlock(($) => {
            const record = $.let(Record.bind(plans, [plansPatch]));
            const rows = recordRows(record, { entry: { key: "2026-W42", rows: "rows", id: "id" } });
            assert.equal(rows.options.id, "id");
            assert.ok(isTypeEqual(typeOf(rows.options.onApply), AsyncFunctionType([Editing.Types.ChangeSet(PlanRowType)], Editing.Types.ApplyResult)));
            assert.ok(isTypeEqual(typeOf(rows.data), ArrayType(PlanRowType)));
            assert.ok(isTypeEqual(typeOf(rows.options.readOnly), BooleanType), "read-only while the record does not hold the entry");
            assert.ok(isTypeEqual(typeOf(rows.missing), OptionType(StringType)), "the key the frame's banner names");
            assert.ok(isTypeEqual(typeOf(createSheetPayloadWith(rows.data, planColumns, rows.options, rows.internal)), Sheet.Types.Root));
        });
    });

    test("refuses a record that is not a Dict, one bound without its patch door, and window with entry", () => {
        const counter = e3.record("sheet_record_counter", IntegerType, 0n);
        const bump = e3.mutation.reduce("bump", counter, East.function([IntegerType], IntegerType, (_$, n) => n.add(1n)));
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(counter, [bump])))),
            /`record` must be a Dict — its entries, or one entry's rows, are the sheet's rows — and this record holds \.Integer/);
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(jobs, [])))),
            /"patch" is not bound as this record's patch door/);
        assert.throws(() => inBlock(($) => {
            const record = $.let(Record.bind(plans, [plansPatch]));
            return recordRows(record, { entry: { key: "2026-W42", rows: "rows", id: "id" }, window: $.let(Data.bindPaged(plans)) });
        }), /`window` pages the record's entries, and with `entry` the rows are one entry's field, read whole — pass one or the other/);
    });

    test("refuses a window over another collection, and an entry whose rows or id the entry type does not have", () => {
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(jobs, [jobsPatch])), { window: $.let(Data.bindPaged(plans)) })),
            /`window` must page the record's entries — Data.bindPaged\(record\) over the same record — and this one serves/);
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(plans, [plansPatch])), { entry: { key: "2026-W42", rows: "starts", id: "id" } })),
            /`entry.rows` must name an Array field of the record's entries — "starts" is a DateTime field/);
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(plans, [plansPatch])), { entry: { key: "2026-W42", rows: "rows", id: "qty" } })),
            /`entry.id` must name a String field of the rows `rows` holds — "qty" is not one of/);
        assert.throws(() => inBlock(($) => recordRows($.let(Record.bind(jobs, [jobsPatch])), { entry: { key: "J-0001", rows: "task", id: "id" } })),
            /`entry.rows` must name an Array field of the record's entries — "task" is a String field/);
    });
});
