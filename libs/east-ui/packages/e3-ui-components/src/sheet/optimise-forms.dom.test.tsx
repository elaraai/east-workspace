/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Optimise in the Sheet's other forms that save to a record
 * (east-workspace#1622, rule 5), on e3 — the record's own entries are
 * `optimise.dom.test.tsx`'s:
 *
 * - **A rail's rows** — `slice` with `record` beside it: the request carries
 *   the rail's narrowing by its source's name, as a read of the source carries
 *   it; the shop's optimiser reads the orders itself, so its answer changes
 *   orders the narrowing leaves out, which the sheet draws none of — they land
 *   as unsaved edits all the same, and Save commits them. Over 50,000 orders
 *   read a window at a time, an answer changes an order the sheet does not
 *   hold: it is read by its key before the answer lands (rule 8).
 * - **One entry's rows** — `record` with `entry`: the request carries the
 *   entry's key; the function reads that entry's rows, the sheet's unsaved
 *   edit of them laid over the record as a draft, and answers a patch of those
 *   rows by their id; Save writes the entry, and no other. Another entry
 *   picked while the call is out stops the run, as another tab does (O4): its
 *   answer is of the first entry's rows. An answer that changes a row whose
 *   own edit is not finished is refused, naming the row as the sheet draws it
 *   (rule 11).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ArrayType, DictType, East, NullType, SortedMap, StringType, StructType, compareFor, printFor } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Reactive, Slice, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateImpl, StateRuntime, UIStore, editingMessages } from "@elaraai/east-ui-components";
import { Data, Func, Record, Sheet } from "@elaraai/e3-ui/internal";
import * as opt from "@elaraai/e3-ui/examples/sheet/optimise";
import * as records from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { act, e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { readsRow } from "../e3-web.test-utils.js";
import { fitCalls } from "../shared/func/fit-calls.test-utils.js";
import "./frame/index.js";

/** A week's plan: its orders, one entry's rows, each identified by its reference. */
const WeekPlan = StructType({ week: StringType, orders: ArrayType(opt.OptimiseWorkOrder) });
const WeekPlans = DictType(StringType, WeekPlan);
/** The orders of one week's plan by their reference: what an optimiser over that entry's rows answers a patch of. */
const PlanOrders = DictType(StringType, opt.OptimiseWorkOrder);
const ORDERS = [...opt.optimiseWorkOrderRows.values()];
/** Two weeks' plans: the first four orders in one week, the last four — three of them Ready — in the next. */
const weekPlans = e3.record("sheet_test_week_plans", WeekPlans, {
    initial: new SortedMap([
        ["2026-W41", { week: "2026-W41", orders: ORDERS.slice(0, 4) }],
        ["2026-W42", { week: "2026-W42", orders: ORDERS.slice(4) }],
    ], compareFor(StringType)),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
/**
 * A week's optimiser, on e3: every Ready order of the week it is asked of is set Scheduled. It reads that week's plan by
 * the entry's key the request carries, the sheet's unsaved edits of the plans laid over them; the answer is the change of
 * that week's orders, by their reference.
 */
const scheduleWeek = e3.function("sheet_test_schedule_week", {
    inputs: [weekPlans],
    drafts: [weekPlans],
    args: [Sheet.Types.OptimiseRequest({ entry: StringType })],
    output: Sheet.Types.OptimiseResult(PlanOrders),
}, ($, plans, request) => {
    const before = $.let(new Map(), PlanOrders);
    const after = $.let(new Map(), PlanOrders);
    $.for(plans.get(request.entry).orders, ($2, order) => {
        $2.if(East.equal(order.status, "Ready"), ($3) => {
            $3(before.insert(order.reference, order));
            $3(after.insert(order.reference, { reference: order.reference, job: order.job, status: "Scheduled", due: order.due, quantity: order.quantity }));
        });
    });
    return { rows: East.diff(before, after) };
});

const COLUMNS = {
    job: Sheet.column.text(opt.OptimiseWorkOrder, { header: "Job", width: "180px" }),
    status: Sheet.column.text(opt.OptimiseWorkOrder, { header: "Status", width: "120px" }),
    due: Sheet.column.date(opt.OptimiseWorkOrder, { header: "Due", width: "144px" }),
    quantity: Sheet.column.integer(opt.OptimiseWorkOrder, { header: "Quantity", width: "112px" }),
};

/** The second week's orders, an entry's rows, with the week's optimiser. */
const overEntry = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const plans = $.let(Record.bind(weekPlans));
    const optimise = $.let(Func.bind(scheduleWeek));
    return Sheet({ record: plans, entry: { key: "2026-W42", rows: "orders", id: "reference" }, name: "sheetOptimiseWeek", optimise, columns: COLUMNS, edits: { insertRows: false } });
}))) };

/** The page's state of the week the viewer picked: whose orders the sheet edits. */
const PICKED_WEEK = "test.sheetOptimiseWeek.picked";
/** The week the viewer picked — the second at first — its orders an entry's rows, with the week's optimiser. */
const overPicked = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const plans = $.let(Record.bind(weekPlans));
    const optimise = $.let(Func.bind(scheduleWeek));
    const picked = $.let(State.bind([StringType], PICKED_WEEK, "2026-W42"));
    return Sheet({ record: plans, entry: { key: picked.read(), rows: "orders", id: "reference" }, name: "sheetOptimisePicked", optimise, columns: COLUMNS, edits: { insertRows: false } });
}))) };
/** The viewer picks the first week. */
const pickFirstWeek = East.function([], NullType, ($) => {
    const picked = $.const(State.bind([StringType], PICKED_WEEK, "2026-W42"));
    $(picked.write("2026-W41"));
}).toIR().compile(StateImpl);

/** The orders through a rail narrowed to the Scheduled ones, the orders' record handed beside it, with the shop's optimiser. */
const overRail = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const orders = $.let(Record.bind(opt.optimiseWorkOrders));
    const slice = $.let(Slice.bindRecords("test.sheetOptimiseRail", {
        rows: {
            source: Data.bindPaged(opt.optimiseWorkOrders, { indexes: ["optimise_work_orders_by_status"] }),
            fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] } }, initial: { status: ["Scheduled"] },
        },
    }));
    const optimise = $.let(Func.bind(opt.setDueDates));
    return Sheet({ slice: { slice }, record: orders, name: "sheetOptimiseRail", optimise, columns: COLUMNS, edits: { insertRows: false } });
}))) };

/** The 50,000 work orders by their reference. */
const IndexedOrders = DictType(StringType, records.IndexedWork);
/** The last of the 50,000 work orders, Scheduled as generated: far past any window a sheet narrowed to the Ready ones reads. */
const LAST = "JOB-59999";
/**
 * An optimiser over the 50,000 work orders, on e3: the last order is set Done. It reads that order by its key, the
 * sheet's unsaved edits of the orders laid over them; the answer is its change alone.
 */
const closeLastOrder = e3.function("sheet_test_close_last_order", {
    inputs: [records.indexedWorkOrders],
    drafts: [records.indexedWorkOrders],
    args: [Sheet.Types.OptimiseRequest()],
    output: Sheet.Types.OptimiseResult(IndexedOrders),
}, ($, orders, _request) => {
    const before = $.let(new Map(), IndexedOrders);
    const after = $.let(new Map(), IndexedOrders);
    const order = $.const(orders.get(LAST));
    $(before.insert(LAST, order));
    $(after.insert(LAST, { reference: order.reference, job: order.job, status: "Done", due: order.due, quantity: order.quantity, urgent: order.urgent, tags: order.tags }));
    return { rows: East.diff(before, after) };
});

/** The 50,000 work orders through a rail narrowed to the Ready ones, read a window at a time, the orders' record handed beside it. */
const overPaged = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const orders = $.let(Record.bind(records.indexedWorkOrders));
    const slice = $.let(Slice.bindRecords("test.sheetOptimisePaged", {
        rows: {
            source: Data.bindPaged(records.indexedWorkOrders, { indexes: ["by_status_due"] }),
            fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] } }, initial: { status: ["Ready"] },
        },
    }));
    const optimise = $.let(Func.bind(closeLastOrder));
    return Sheet({
        slice: { slice }, record: orders, name: "sheetOptimisePaged", optimise, edits: { insertRows: false },
        columns: {
            job: Sheet.column.text(records.IndexedWork, { header: "Job", width: "180px" }),
            status: Sheet.column.text(records.IndexedWork, { header: "Status", width: "120px" }),
        },
    });
}))) };

const h = e3Harness({ "sheet/optimise": opt, "sheet/sheet-records": records, "sheet/optimise-forms": { weekPlans, scheduleWeek, closeLastOrder } });
const weekCalls = fitCalls(h, { request: Sheet.Types.OptimiseRequest({ entry: StringType }), result: Sheet.Types.OptimiseResult(PlanOrders) });
const railCalls = fitCalls(h, { request: Sheet.Types.OptimiseRequest(), result: Sheet.Types.OptimiseResult(opt.OptimiseWorkOrders) });

async function press(node: Element | null) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const eye = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("[data-optimise-button]");
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")).getByRole("button", { name });
const marked = (c: HTMLElement) => c.querySelectorAll<HTMLElement>("[data-slot=cell][data-op]");
const cell = (c: HTMLElement, id: string, key: string) => c.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-slot=cell][data-key="${key}"]`)!;
const rowIds = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-slot=row][data-row-id]")].map(row => row.getAttribute("data-row-id"));
const banner = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-optimise-banner="${kind}"]`);
const body = (el: HTMLElement) => el.querySelector("[data-banner-body]")!.textContent;
const line = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-slot=footer] [data-footer-line]")!;
const said = (c: HTMLElement, kind: string) => waitFor(() => expect(banner(c, kind)).not.toBeNull(), { timeout: 10_000 });
const commits = async (record: { readonly name: string }) => (await h.history(record)).commits.map(commit => commit.mutation);
/** A String as East prints it: how a narrowing names a chosen value. */
const text = printFor(StringType);
/** The three orders with no due date, which the shop's optimiser schedules. */
const READY = ["WO-1005", "WO-1007", "WO-1008"];
/** Types a cell's new text in the row's editor, committed with ⏎. */
async function typeInto(target: Element, value: string) {
    await act(async () => { fireEvent.doubleClick(target); });
    await settle();
    const input = document.querySelector('[data-slot="editorInput"]')!;
    await act(async () => { fireEvent.input(input, { target: { value } }); });
    await settle();
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await settle();
}

describe("the eye in a Sheet over a rail's rows, the record beside the rail", () => {
    test("the request carries the rail's narrowing by its source's name; the answer changes orders the narrowing leaves out, which the sheet draws none of: they land as one edit all the same, and Save commits them", async () => {
        const { container } = await h.mount(overRail);
        // The rail keeps the Scheduled orders: the sheet holds no Ready one.
        await waitFor(() => expect(rowIds(container)).toEqual(["WO-1001", "WO-1002", "WO-1004", "WO-1006"]), { timeout: 10_000 });
        const deployed = await commits(opt.optimiseWorkOrders);
        expect(eye(container)!.disabled).toBe(false);
        await press(eye(container));
        await said(container, "done");
        const asked = railCalls.requests()[0]!;
        expect(Object.keys(asked).sort()).toEqual(["run", "slice"]);
        expect([...asked.slice].map(([source, where]) => [source, [...where].map(([field, by]) => [field, by.type, by.value])]))
            .toEqual([["rows", [["status", "values", [text("Scheduled")]]]]]);
        // The function reads the orders itself: the three Ready ones, no row of which the sheet draws.
        const answered = railCalls.answers()[0]!.rows;
        expect(answered.type === "patch" ? [...answered.value.keys()] : answered.type).toEqual(READY);
        expect([body(banner(container, "done")!), marked(container).length]).toEqual(["3 changes: 3 changed. Undo or apply them like any edit.", 0]);
        // One Undo takes the whole answer back, rows the sheet shows none of among it; Redo brings it back, and Save commits it.
        expect((history(container, editingMessages.apply()) as HTMLButtonElement).disabled).toBe(false);
        await press(history(container, editingMessages.undo()));
        expect((history(container, editingMessages.apply()) as HTMLButtonElement).disabled).toBe(true);
        await press(history(container, editingMessages.redo()));
        expect(await commits(opt.optimiseWorkOrders)).toEqual(deployed);
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits(opt.optimiseWorkOrders)).toEqual(["patch", ...deployed]), { timeout: 10_000 });
        const orders = await h.read(opt.optimiseWorkOrders);
        expect(READY.map(id => [orders.get(id)!.due.type, orders.get(id)!.status])).toEqual([["some", "Scheduled"], ["some", "Scheduled"], ["some", "Scheduled"]]);
        // Scheduled now, the three stand among the rail's rows.
        await waitFor(() => expect(rowIds(container)).toEqual(["WO-1001", "WO-1002", "WO-1004", "WO-1005", "WO-1006", "WO-1007", "WO-1008"]), { timeout: 10_000 });
    });
});

describe("a row the sheet does not hold (rule 8)", () => {
    test("over 50,000 orders read a window at a time, an answer that changes an order far past the windows read has it read by its key, then lands as one edit; Save commits it", async () => {
        const { container } = await h.mount(overPaged);
        await waitFor(() => expect(rowIds(container).length).toBeGreaterThan(0), { timeout: 20_000 });
        const deployed = await commits(records.indexedWorkOrders);
        const rowsBefore = h.requests("rows", `records.${records.indexedWorkOrders.name}`).length;
        await press(eye(container));
        await said(container, "done");
        // The order was read by its key, in one read, between the answer and its landing.
        const byKey = h.requests("rows", `records.${records.indexedWorkOrders.name}`).slice(rowsBefore);
        expect(byKey.filter(request => readsRow(request, text(LAST)))).toHaveLength(1);
        expect([body(banner(container, "done")!), (history(container, editingMessages.apply()) as HTMLButtonElement).disabled])
            .toEqual(["1 change: 1 changed. Undo or apply them like any edit.", false]);
        expect(await commits(records.indexedWorkOrders)).toEqual(deployed);
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits(records.indexedWorkOrders)).toEqual(["patch", ...deployed]), { timeout: 20_000 });
        expect((await h.read(records.indexedWorkOrders)).get(LAST)!.status).toBe("Done");
    });
});

describe("the eye in a Sheet over one entry's rows", () => {
    test("the request carries the entry's key; the function reads that entry's rows, an unsaved edit of them laid over the record as a draft, and its answer lands on them as one edit; Save writes the entry, and no other", async () => {
        const { container } = await h.mount(overEntry);
        await waitFor(() => expect(rowIds(container)).toEqual(["WO-1005", "WO-1006", "WO-1007", "WO-1008"]), { timeout: 10_000 });
        const deployed = await commits(weekPlans);
        // An order typed Scheduled and not saved: the function reads it so, and leaves it.
        await typeInto(cell(container, "WO-1005", "status"), "Scheduled");
        await press(eye(container));
        await said(container, "done");
        const asked = weekCalls.requests()[0]!;
        expect(Object.keys(asked).sort()).toEqual(["entry", "run", "slice"]);
        expect([asked.entry, asked.run, asked.slice.size]).toEqual(["2026-W42", 1n, 0]);
        expect(weekCalls.drafts()).toEqual([[{ record: weekPlans.name, mutation: "patch" }]]);
        const answered = weekCalls.answers()[0]!.rows;
        expect(answered.type === "patch" ? [...answered.value.keys()] : answered.type).toEqual(["WO-1007", "WO-1008"]);
        expect(body(banner(container, "done")!)).toBe("2 changes: 2 changed. Undo or apply them like any edit.");
        expect([...marked(container)].map(el => [el.closest("[data-row-id]")!.getAttribute("data-row-id"), el.getAttribute("data-key"), el.getAttribute("data-op")]))
            .toEqual([["WO-1007", "status", "chg"], ["WO-1008", "status", "chg"]]);
        // The call saved nothing; Save commits the typed edit and the answer as one patch of the week's entry.
        expect(await commits(weekPlans)).toEqual(deployed);
        await press(history(container, editingMessages.apply()));
        await waitFor(async () => expect(await commits(weekPlans)).toEqual(["patch", ...deployed]), { timeout: 10_000 });
        const plans = await h.read(weekPlans);
        expect(plans.get("2026-W42")!.orders.map(order => [order.reference, order.status]))
            .toEqual([["WO-1005", "Scheduled"], ["WO-1006", "Scheduled"], ["WO-1007", "Scheduled"], ["WO-1008", "Scheduled"]]);
        expect(plans.get("2026-W41")!.orders.map(order => order.status)).toEqual(ORDERS.slice(0, 4).map(order => order.status));
    });

    test("O4 — another entry picked while the call is out stops the run, as another tab does: the first entry's answer lands on no row of the next, and nothing is recorded", async () => {
        StateRuntime.initializeStore(new UIStore());
        const { container } = await h.mount(overPicked);
        await waitFor(() => expect(rowIds(container)).toEqual(["WO-1005", "WO-1006", "WO-1007", "WO-1008"]), { timeout: 10_000 });
        const hold = weekCalls.hold();
        await press(eye(container));
        await hold.holding;
        expect(weekCalls.requests()[0]!.entry).toBe("2026-W42");
        // The viewer picks the first week while the call is out: the run stops, as Stop stops it — the sheet kept, its
        // footer saying so.
        await act(async () => { pickFirstWeek(); });
        await settle();
        expect([eye(container)!.hasAttribute("data-running"), line(container).getAttribute("data-loading-line"), line(container).querySelector("[data-line-text]")!.textContent])
            .toEqual([false, "note", "Stopped · nothing changed"]);
        await waitFor(() => expect(rowIds(container)).toEqual(["WO-1001", "WO-1002", "WO-1003", "WO-1004"]), { timeout: 10_000 });
        // The second week's answer comes, late: nothing lands on the first week's rows, and nothing is recorded.
        hold.release();
        await settle();
        expect([marked(container).length, banner(container, "done"), (history(container, editingMessages.apply()) as HTMLButtonElement).disabled]).toEqual([0, null, true]);
    });

    test("rule 11 — an answer that changes a row whose own edit is not finished is refused whole, naming the row as the sheet draws it, its first text column's text — never by its key", async () => {
        const { container } = await h.mount(overEntry);
        await waitFor(() => expect(rowIds(container)).toEqual(["WO-1005", "WO-1006", "WO-1007", "WO-1008"]), { timeout: 10_000 });
        // WO-1005's quantity cleared, a value the row requires: the function reads it as saved, Ready, and changes it.
        await typeInto(cell(container, "WO-1005", "quantity"), "");
        await press(eye(container));
        await said(container, "fail");
        expect(body(banner(container, "fail")!)).toBe("Elara's answer changes Cut panels, whose edit is not finished. Nothing changed.");
        expect(marked(container)).toHaveLength(0);
    });
});
