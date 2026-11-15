/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Sheet's `optimise` contract (#1409, east-workspace#1622): the request —
 * the run and the rail's narrowing, and over one entry's rows the entry's key —
 * and the answer, a patch of the rows the sheet's Save reaches; the prop held
 * to the record the sheet is handed, in each form that takes one, and refused
 * on a sheet handed none, whatever Save it was given (rule 5); the drafts rule
 * as it is evaluated; the payload's `optimise`; and the shop's optimiser over its work
 * orders, read through their status index: every Ready order with no due date
 * given one, in key order, and set Scheduled, answered as a patch.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, DictType, East, EastTypeType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, compareFor,
    diffFor, equalFor, fromEastTypeValue, isTypeEqual, none, printFor, printType, some, variant, type BlockBuilder, type EastIR, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Editing, Slice } from "@elaraai/east-ui";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { Data, Func, FuncBindingType, Record, Sheet, SheetOptimiseBindingType, SheetPayloadType, sheetOptimiseBinding } from "@elaraai/e3-ui/internal";
import { indexEntries } from "../index-entries.js";
import { refusingPlatform } from "../refusing-platform.js";
import * as ex from "./optimise.examples.js";

describeEast("Sheet — the optimiser's example (#1409, #1622)", test => {
    Assert.examples(test, { sheetOptimise: ex.sheetOptimise });
}, { platformFns: TestImpl });

type Order = ValueTypeOf<typeof ex.OptimiseWorkOrder>;
const byString = compareFor(StringType);
const COLUMNS = {
    reference: Sheet.column.text(ex.OptimiseWorkOrder, { header: "Reference" }),
    job: Sheet.column.text(ex.OptimiseWorkOrder, { header: "Job" }),
    due: Sheet.column.date(ex.OptimiseWorkOrder, { header: "Due" }),
};
/** The orders as the host's rows: an Array, each identified by its reference — which is then no column. */
const ORDERS: Order[] = [...ex.optimiseWorkOrderRows.values()];
const DATA_COLUMNS = { job: COLUMNS.job, due: COLUMNS.due };

/** A week's plan: its orders, one entry's rows, identified by their reference. */
const WeekPlan = StructType({ week: StringType, orders: ArrayType(ex.OptimiseWorkOrder) });
const weekPlans = e3.record("optimise_spec_week_plans", DictType(StringType, WeekPlan), {
    initial: new Map(),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
/** The orders of one week's plan by their reference: what an optimiser over that entry's rows answers a patch of. */
const PlanOrders = DictType(StringType, ex.OptimiseWorkOrder);

/** What `build` throws inside a block, as a sheet's factory runs; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

/**
 * A sheet over the work orders' record, with the props given beside its rows and columns. It adds no orders: a new
 * one's status and quantity, which no column shows, would have nothing to set them.
 */
function overRecord($: BlockBuilder<NullType>, change: Readonly<Record<string, unknown>> = {}): unknown {
    const orders = $.let(Record.bind(ex.optimiseWorkOrders));
    return Sheet.Payload({ record: orders, columns: COLUMNS, edits: { insertRows: false }, ...change } as never);
}
/** A sheet over one week's orders, an entry's rows, with the props given beside them. */
function overEntry($: BlockBuilder<NullType>, change: Readonly<Record<string, unknown>> = {}): unknown {
    const plans = $.let(Record.bind(weekPlans));
    return Sheet.Payload({ record: plans, entry: { key: "2026-W41", rows: "orders", id: "reference" }, columns: DATA_COLUMNS, edits: { insertRows: false }, ...change } as never);
}
/** A sheet over the orders as an array, identified by their reference, with the props given beside them. */
function overData($: BlockBuilder<NullType>, change: Readonly<Record<string, unknown>> = {}): unknown {
    const rows = $.const(ORDERS, ArrayType(ex.OptimiseWorkOrder));
    return Sheet.Payload({ data: rows, id: "reference", columns: DATA_COLUMNS, edits: { insertRows: false }, ...change } as never);
}
/** A sheet over the rows of its slice's `rows` source, the orders' record handed beside the rail, with the props given beside them. */
function overSlice($: BlockBuilder<NullType>, change: Readonly<Record<string, unknown>> = {}): unknown {
    const orders = $.let(Record.bind(ex.optimiseWorkOrders));
    const slice = $.let(Slice.bindRecords("spec.sheetOptimise", {
        rows: { source: Data.bindPaged(ex.optimiseWorkOrders, { indexes: ["optimise_work_orders_by_status"] }), fields: { status: { label: "Status" } } },
    }));
    return Sheet.Payload({ slice: { slice }, record: orders, columns: COLUMNS, edits: { insertRows: false }, ...change } as never);
}
/** The same rail's rows read only: the sheet is handed no record. */
function overSliceAlone($: BlockBuilder<NullType>, change: Readonly<Record<string, unknown>> = {}): unknown {
    const slice = $.let(Slice.bindRecords("spec.sheetOptimise.alone", {
        rows: { source: Data.bindPaged(ex.optimiseWorkOrders, { indexes: ["optimise_work_orders_by_status"] }), fields: { status: { label: "Status" } } },
    }));
    return Sheet.Payload({ slice: { slice }, columns: COLUMNS, ...change } as never);
}

describe("the types (#1622)", () => {
    test("OptimiseRequest() is the run and each rail source's narrowing, and no row; over one entry's rows the entry's key too", () => {
        assert.ok(isTypeEqual(Sheet.Types.OptimiseRequest(), StructType({ run: IntegerType, slice: DictType(StringType, RecordSliceWhereType) })));
        assert.ok(isTypeEqual(Sheet.Types.OptimiseRequest({ entry: IntegerType }),
            StructType({ run: IntegerType, slice: DictType(StringType, RecordSliceWhereType), entry: IntegerType })));
        assert.throws(() => (Sheet.Types.OptimiseRequest as (options: unknown) => unknown)(ex.OptimiseWorkOrder), {
            message: "Sheet.Types.OptimiseRequest: takes nothing, or { entry: K } over one entry's rows, K the record's key type",
        });
    });

    test("OptimiseResult(D) is a patch of the rows the sheet saves, D their type by key, and refuses a type that is no Dict", () => {
        assert.ok(isTypeEqual(Sheet.Types.OptimiseResult(ex.OptimiseWorkOrders), StructType({ rows: PatchType(ex.OptimiseWorkOrders) })));
        assert.throws(() => Sheet.Types.OptimiseResult(ex.OptimiseWorkOrder as unknown as DictType<EastType, EastType>), {
            message: `Sheet.Types.OptimiseResult: is given ${printType(ex.OptimiseWorkOrder)} — it takes the type of the rows the sheet saves, ` +
                "a Dict of rows by key: the record's own type, or over one entry's rows DictType(StringType, Row)",
        });
    });

    test("the payload carries the optimiser — its binding, the record, the rows' type and the entry's key — or none", () => {
        assert.ok(isTypeEqual(SheetPayloadType.fields.optimise, OptionType(SheetOptimiseBindingType)));
        assert.ok(isTypeEqual(SheetOptimiseBindingType, StructType({
            binding: FuncBindingType, record: StringType, rows: EastTypeType, entry: OptionType(StructType({ type: EastTypeType, key: BlobType })),
        })));
    });
});

describe("rule 5: `optimise` is held to the record the sheet is handed, in each form that takes one", () => {
    test("the shop's optimiser is taken over the record, alone and beside a rail whose `rows` source pages it; without the prop each form builds as before", () => {
        assert.equal(refusal(($) => overRecord($, { optimise: Func.bind(ex.setDueDates) })), "");
        assert.equal(refusal(($) => overSlice($, { optimise: Func.bind(ex.setDueDates) })), "");
        assert.equal(refusal(($) => overRecord($)), "");
        assert.equal(refusal(($) => overData($)), "");
        assert.equal(refusal(($) => overSlice($)), "");
        assert.equal(refusal(($) => overSliceAlone($)), "");
    });

    test("over one entry's rows it asks the entry's key, and answers a patch of those rows by their identity field", () => {
        const weekOrders = e3.function("sheet_optimise_spec_week_orders", {
            inputs: [weekPlans], drafts: [weekPlans], args: [Sheet.Types.OptimiseRequest({ entry: StringType })], output: Sheet.Types.OptimiseResult(PlanOrders),
        }, ($) => {
            const held = $.const(new Map(), PlanOrders);
            return { rows: East.diff(held, held) };
        });
        assert.equal(refusal(($) => overEntry($, { optimise: Func.bind(weekOrders) })), "");
        // One asking no entry is refused, naming the request with the entry's key
        assert.equal(refusal(($) => overEntry($, { optimise: Func.bind(ex.setDueDates) })),
            `Sheet: \`optimise\` asks ${printType(Sheet.Types.OptimiseRequest())}, not Sheet.Types.OptimiseRequest({ entry: ${printType(StringType)} }) — ` +
            "a request carries the period in view, the run's number and the page's narrowing, and no row: the function reads what it needs from the workspace");
    });

    test("on a sheet handed no record it is refused, naming the Save it was given: there is no draft to send", () => {
        const own = East.asyncFunction([Editing.Types.ChangeSet(ex.OptimiseWorkOrder)], Editing.Types.ApplyResult,
            (_$) => East.value(variant("applied", { revision: none }), Editing.Types.ApplyResult));
        const beside = (prop: string) => `Sheet: \`optimise\` beside \`${prop}\` — the optimiser is sent the sheet's unsaved edits as a draft of the record the ` +
            `sheet saves to, and \`${prop}\` is the host's own function over \`data\`, which has none: hand the sheet the record, record={Record.bind(record)}, ` +
            "which it saves through itself, or leave `optimise` out";
        assert.equal(refusal(($) => overData($, { onApply: own, optimise: Func.bind(ex.setDueDates) })), beside("onApply"));
        // A Save that Record.onApply made is handed over as a function like any other: the sheet is handed no record by it
        assert.equal(refusal(($) => {
            const orders = $.let(Record.bind(ex.optimiseWorkOrders));
            return overData($, { onApply: Record.onApply(orders), optimise: Func.bind(ex.setDueDates) });
        }), beside("onApply"));
        assert.equal(refusal(($) => {
            const live = $.let(Data.bind(e3.input("sheet_optimise_spec_orders", ArrayType(ex.OptimiseWorkOrder))));
            return Sheet.Payload({ data: live, id: "reference", columns: DATA_COLUMNS, onUpdate: live.write, edits: { insertRows: false }, optimise: Func.bind(ex.setDueDates) } as never);
        }), beside("onUpdate"));
        const noRecord = "Sheet: `optimise` is sent the sheet's unsaved edits as a draft of the record the sheet saves to, and this sheet is handed no record — " +
            "hand it one: record={Record.bind(record)}, its record declaring patch: mutation.patch()";
        assert.equal(refusal(($) => overData($, { optimise: Func.bind(ex.setDueDates) })), noRecord);
        // A rail's rows with no record beside them are read only, and have no draft either
        assert.equal(refusal(($) => overSliceAlone($, { optimise: Func.bind(ex.setDueDates) })), noRecord);
    });

    test("one answering a patch of other rows, or asking the rows themselves, is refused naming what it answers or asks; a value that is no Func.bind handle naming the signature", () => {
        const Other = DictType(StringType, StructType({ reference: StringType, grade: StringType }));
        const otherRows = e3.function("sheet_optimise_spec_other_rows", { inputs: [], args: [Sheet.Types.OptimiseRequest()], output: Sheet.Types.OptimiseResult(Other) }, ($) => {
            const held = $.const(new Map(), Other);
            return { rows: East.diff(held, held) };
        });
        assert.equal(refusal(($) => overRecord($, { optimise: Func.bind(otherRows) })),
            `Sheet: \`optimise\` answers ${printType(Sheet.Types.OptimiseResult(Other))}, not Sheet.Types.OptimiseResult(${printType(ex.OptimiseWorkOrders)}) — ` +
            "a patch of each record the Sheet edits");
        const AsksRows = StructType({ run: IntegerType, rows: ex.OptimiseWorkOrders });
        const asksRows = e3.function("sheet_optimise_spec_asks_rows", { inputs: [], args: [AsksRows], output: Sheet.Types.OptimiseResult(ex.OptimiseWorkOrders) }, ($) => {
            const held = $.const(new Map(), ex.OptimiseWorkOrders);
            return { rows: East.diff(held, held) };
        });
        assert.equal(refusal(($) => overRecord($, { optimise: Func.bind(asksRows) })),
            `Sheet: \`optimise\` asks ${printType(AsksRows)}, not Sheet.Types.OptimiseRequest() — ` +
            "a request carries the period in view, the run's number and the page's narrowing, and no row: the function reads what it needs from the workspace");
        assert.equal(refusal(($) => overRecord($, { optimise: East.value("sheet_set_due_dates") })),
            "Sheet: `optimise` is Func.bind of the app's e3.function from Sheet.Types.OptimiseRequest() to Sheet.Types.OptimiseResult(D), D the type of the rows the " +
            `sheet saves — here ${printType(ex.OptimiseWorkOrders)} — the period in view and the page's narrowing in, a patch of each record the Sheet edits out`);
    });
});

describe("rule 4: the record the sheet is handed, held as the page is evaluated", () => {
    /**
     * The Sheet's `optimise` binding over the record it is handed, evaluated as the page is: the check its tag makes,
     * alone — the payload around it reads the rows as it is evaluated, which a spec reads from no e3.
     */
    function evaluated(def: unknown): ValueTypeOf<typeof FuncBindingType> {
        return carried(def).binding;
    }

    /** The optimiser as the payload carries it, over the record the sheet is handed. */
    function carried(def: unknown): ValueTypeOf<typeof SheetOptimiseBindingType> {
        return East.compile(East.function([], SheetOptimiseBindingType, ($) => {
            const orders = $.let(Record.bind(ex.optimiseWorkOrders));
            const optimise = $.let(Func.bind(def as never));
            return sheetOptimiseBinding(optimise, { record: orders.binding.name, rows: ex.OptimiseWorkOrders, entry: undefined }, undefined);
        }), refusingPlatform)();
    }

    test("the shop's optimiser lists the orders it reads, and its binding names them", () => {
        const binding = evaluated(ex.setDueDates);
        assert.ok(equalFor(FuncBindingType)(binding, { name: "sheet_set_due_dates", drafts: ["optimise_work_orders"], reads: ["optimise_work_orders"] }),
            printFor(FuncBindingType)(binding));
    });

    test("the payload carries the record the sheet saves to and the type of the rows its Save reaches, and no entry over the record's own entries", () => {
        const optimiser = carried(ex.setDueDates);
        assert.ok(equalFor(StringType)(optimiser.record, "optimise_work_orders"), optimiser.record);
        assert.ok(isTypeEqual(fromEastTypeValue(optimiser.rows), ex.OptimiseWorkOrders));
        assert.equal(optimiser.entry.type, "none");
    });

    test("one that reads the orders and does not list them in `drafts` fails the page, naming the record", () => {
        const undrafted = e3.function("sheet_optimise_spec_undrafted", {
            inputs: [e3.index(ex.optimiseWorkOrders.indexes.optimise_work_orders_by_status)], args: [Sheet.Types.OptimiseRequest()], output: Sheet.Types.OptimiseResult(ex.OptimiseWorkOrders),
        }, ($) => {
            const held = $.const(new Map(), ex.OptimiseWorkOrders);
            return { rows: East.diff(held, held) };
        });
        assert.equal(refusal(($) => overRecord($, { optimise: Func.bind(undrafted) })), "", "built, it stands: the record is named by a value");
        assert.throws(() => evaluated(undrafted), (error: Error) => error.message.includes(
            "Sheet: `optimise` is the function 'sheet_optimise_spec_undrafted', which reads the record 'optimise_work_orders' that the Sheet edits " +
            "and does not list it in `drafts` — it would plan around edits it cannot see: list it, drafts: [optimise_work_orders], beside the function's inputs"));
    });
});

describe("the shop's optimiser over its work orders, read through their status index", () => {
    const optimise = (ex.setDueDates.body as EastIR<EastType[], EastType>).compile([]) as unknown as
        (byStatus: unknown, orders: unknown, request: unknown) => { rows: unknown };
    const run = (held: SortedMap<string, Order>) =>
        optimise(indexEntries(ex.optimiseWorkOrders, ex.optimiseWorkOrders.indexes.optimise_work_orders_by_status, held).entries, held, { run: 1n, slice: new Map() }).rows;
    const patchOf = diffFor(ex.OptimiseWorkOrders);
    const samePatch = equalFor(PatchType(ex.OptimiseWorkOrders));
    const printPatch = printFor(PatchType(ex.OptimiseWorkOrders));
    const rows = ex.optimiseWorkOrderRows;

    test("each Ready order with no due date is due a day after the latest Scheduled one, one after another in key order, and Scheduled; the answer is their change alone", () => {
        const scheduled = (key: string, due: Date): Order => ({ ...rows.get(key)!, status: "Scheduled", due: some(due) });
        const expected = patchOf(
            new SortedMap(["WO-1005", "WO-1007", "WO-1008"].map((key) => [key, rows.get(key)!] as const), byString),
            new SortedMap([
                ["WO-1005", scheduled("WO-1005", new Date("2026-10-10T00:00:00Z"))], ["WO-1007", scheduled("WO-1007", new Date("2026-10-11T00:00:00Z"))],
                ["WO-1008", scheduled("WO-1008", new Date("2026-10-12T00:00:00Z"))],
            ], byString));
        const answer = run(rows);
        assert.ok(samePatch(answer as never, expected), printPatch(answer as never));
    });

    test("orders all due are answered with a patch that changes nothing", () => {
        const due = new SortedMap([...rows].filter(([, order]) => order.due.type === "some"), byString);
        const answer = run(due);
        assert.ok(samePatch(answer as never, patchOf(new SortedMap([], byString), new SortedMap([], byString))), printPatch(answer as never));
    });

    test("a done order's due date is no matter: only the Scheduled orders set where the Ready ones start", () => {
        const late = new SortedMap<string, Order>([...rows, ["WO-1009", { reference: "WO-1009", job: "Inspect", status: "Done", due: some(new Date("2026-12-01T00:00:00Z")), quantity: 1n }]], byString);
        assert.ok(samePatch(run(late) as never, run(rows) as never));
    });
});
