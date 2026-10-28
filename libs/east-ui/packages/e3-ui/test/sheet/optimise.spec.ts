/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Sheet's `optimise` contract (#1409, #1411, `Optimise Spec.md` §4, §5):
 * the request and result types over the sheet's rows and its source's key,
 * the prop's refusals over a record and over the host's rows, the payload's
 * `optimise`, and the shop's optimiser over its work orders: every order with
 * no due date given one, in key order, and set Scheduled.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, IntegerType, NullType, OptionType, StringType, StructType, isTypeEqual, some, type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Func, FuncBindingType, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as ex from "./optimise.examples.js";

describeEast("Sheet — the optimiser's example (#1409)", test => {
    Assert.examples(test, { sheetOptimise: ex.sheetOptimise });
}, { platformFns: TestImpl });

const Request = Sheet.Types.OptimiseRequest(ex.OptimiseWorkOrder);
const Result = Sheet.Types.OptimiseResult(ex.OptimiseWorkOrder);
type Request = ValueTypeOf<typeof Request>;
type Order = ValueTypeOf<typeof ex.OptimiseWorkOrder>;
const COLUMNS = {
    reference: Sheet.column.text(ex.OptimiseWorkOrder, { header: "Reference" }),
    job: Sheet.column.text(ex.OptimiseWorkOrder, { header: "Job" }),
    due: Sheet.column.date(ex.OptimiseWorkOrder, { header: "Due" }),
};
/** The orders as the host's rows: an Array, each identified by its reference — which is then no column. */
const ORDERS: Order[] = [...ex.optimiseWorkOrderRows.values()];
const DATA_COLUMNS = { job: COLUMNS.job, due: COLUMNS.due };

/** What `build` throws inside a block, as a sheet's factory runs; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

/** A sheet over the work orders' record, with the props given beside its rows and columns. */
function overRecord($: BlockBuilder<NullType>, change: Readonly<Record<string, unknown>> = {}): unknown {
    const orders = $.let(Record.bind(ex.optimiseWorkOrders, [ex.optimiseWorkOrdersPatch]));
    return Sheet.Payload({ record: orders, columns: COLUMNS, ...change } as never);
}
/** A sheet over the orders as an array, identified by their reference, with the props given beside them. */
function overData($: BlockBuilder<NullType>, change: Readonly<Record<string, unknown>> = {}): unknown {
    const rows = $.const(ORDERS, ArrayType(ex.OptimiseWorkOrder));
    return Sheet.Payload({ data: rows, id: "reference", columns: DATA_COLUMNS, ...change } as never);
}

describe("the types (§5.1)", () => {
    test("OptimiseRequest(R, K?) is the run and the rows by key — String unless given; OptimiseResult(R, K?) the rows", () => {
        assert.ok(isTypeEqual(Request, StructType({ run: IntegerType, rows: DictType(StringType, ex.OptimiseWorkOrder) })));
        assert.ok(isTypeEqual(Result, StructType({ rows: DictType(StringType, ex.OptimiseWorkOrder) })));
        assert.ok(isTypeEqual(Sheet.Types.OptimiseRequest(ex.OptimiseWorkOrder, StringType), Request));
        assert.ok(isTypeEqual(Sheet.Types.OptimiseRequest(ex.OptimiseWorkOrder, IntegerType), StructType({ run: IntegerType, rows: DictType(IntegerType, ex.OptimiseWorkOrder) })));
        assert.ok(isTypeEqual(Sheet.Types.OptimiseResult(ex.OptimiseWorkOrder, IntegerType), StructType({ rows: DictType(IntegerType, ex.OptimiseWorkOrder) })));
        assert.equal(isTypeEqual(Sheet.Types.OptimiseRequest(ex.OptimiseWorkOrder, IntegerType), Request), false);
    });

    test("the payload carries the optimiser's binding, or none (§5.2)", () => {
        assert.ok(isTypeEqual(SheetPayloadType.fields.optimise, OptionType(FuncBindingType)));
    });
});

describe("`optimise` (§4): Func.bind of an e3.function from OptimiseRequest(R, K?) to OptimiseResult(R, K?), refused otherwise naming the rows", () => {
    test("the shop's optimiser is taken over the record, and over the host's rows, whose ids are Strings; without the prop the sheet builds as before", () => {
        assert.equal(refusal(($) => overRecord($, { optimise: Func.bind(ex.setDueDates) })), "");
        assert.equal(refusal(($) => overData($, { optimise: Func.bind(ex.setDueDates) })), "");
        assert.equal(refusal(($) => overRecord($)), "");
    });

    test("one bound over other rows, or over the rows under another key, is refused naming both", () => {
        const Other = StructType({ reference: StringType, grade: StringType });
        const otherRows = e3.function("sheet_optimise_spec_other_rows", East.function([Sheet.Types.OptimiseRequest(Other)], Sheet.Types.OptimiseResult(Other), (_$, req) => ({ rows: req.rows })));
        assert.match(refusal(($) => overRecord($, { optimise: Func.bind(otherRows) })),
            /^Sheet: `optimise` is bound over rows \.Struct \[.*grade.*\], and the sheet's rows are \.Struct \[.*quantity.*\] — bind an optimiser over Sheet\.Types\.OptimiseRequest of the sheet's row type$/);
        // A record keyed by Integer: its rows are keyed so, and an optimiser over String keys is refused naming the keys.
        const numbered = e3.record("optimise_spec_numbered_orders", DictType(IntegerType, ex.OptimiseWorkOrder), new Map());
        const numberedPatch = e3.mutation.patch(numbered);
        assert.match(refusal(($) => {
            const orders = $.let(Record.bind(numbered, [numberedPatch]));
            return Sheet.Payload({ record: orders, columns: COLUMNS, edits: { insertRows: false }, optimise: Func.bind(ex.setDueDates) } as never);
        }), /^Sheet: `optimise` is bound over rows \.Struct \[.*\], and the sheet's rows are \.Struct \[.*\], \.Integer — bind an optimiser over Sheet\.Types\.OptimiseRequest of the sheet's row type$/);
        const byNumber = e3.function("sheet_optimise_spec_by_number", East.function([Sheet.Types.OptimiseRequest(ex.OptimiseWorkOrder, IntegerType)], Sheet.Types.OptimiseResult(ex.OptimiseWorkOrder, IntegerType), (_$, req) => ({ rows: req.rows })));
        assert.match(refusal(($) => overRecord($, { optimise: Func.bind(byNumber) })),
            /^Sheet: `optimise` is bound over rows \.Struct \[.*\] keyed by \.Integer, and the sheet's rows are \.Struct \[.*\] — bind an optimiser over Sheet\.Types\.OptimiseRequest of the sheet's row type$/);
    });

    test("one asking or answering another type is refused naming it, and a value that is no Func.bind handle naming the signature", () => {
        const answersText = e3.function("sheet_optimise_spec_answers_text", East.function([Request], StringType, () => "nothing"));
        assert.match(refusal(($) => overRecord($, { optimise: Func.bind(answersText) })), /^Sheet: `optimise` answers \.String, not Sheet\.Types\.OptimiseResult\(\.Struct \[/);
        const asksText = e3.function("sheet_optimise_spec_asks_text", East.function([StringType], Result, () => ({ rows: new Map() })));
        assert.match(refusal(($) => overRecord($, { optimise: Func.bind(asksText) })), /^Sheet: `optimise` asks \.String, not Sheet\.Types\.OptimiseRequest\(\.Struct \[/);
        assert.match(refusal(($) => overRecord($, { optimise: East.value("sheet_set_due_dates") })),
            /^Sheet: `optimise` is Func\.bind of the app's e3\.function from Sheet\.Types\.OptimiseRequest\(R, K\?\) to Sheet\.Types\.OptimiseResult\(R, K\?\), R the sheet's row type and K its source's key type — String, and left out, unless the rows are a record's keyed otherwise — the period's rows in, the same rows out, complete$/);
    });
});

describe("the shop's optimiser over its work orders (§3.1)", () => {
    const request: Request = { run: 1n, rows: ex.optimiseWorkOrderRows };
    const optimise = East.compile(ex.sheetOptimiseBody, []);

    test("every order with a due date stays as it is; each with none is due a day after the latest, one after another in key order, and Scheduled", () => {
        const result = optimise(request);
        assert.deepEqual([...result.rows.keys()], [...request.rows.keys()]);
        for (const [key, order] of request.rows) {
            if (order.due.type === "some") assert.deepEqual(result.rows.get(key), order, key);
        }
        assert.deepEqual(["WO-1005", "WO-1007", "WO-1008"].map((key) => [result.rows.get(key)!.status, result.rows.get(key)!.due]), [
            ["Scheduled", some(new Date("2026-10-10T00:00:00Z"))], ["Scheduled", some(new Date("2026-10-11T00:00:00Z"))], ["Scheduled", some(new Date("2026-10-12T00:00:00Z"))],
        ]);
        assert.deepEqual([result.rows.get("WO-1005")!.job, result.rows.get("WO-1005")!.quantity], ["Cut panels", 800n], "the order's other fields are kept");
    });

    test("orders all due are returned as they are", () => {
        const scheduled = optimise(request).rows;
        assert.deepEqual([...optimise({ run: 2n, rows: scheduled }).rows], [...scheduled]);
    });
});
