/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The hidden pick: a row the Sheet's `rows` source's narrowing hides is reached
 * by clearing the filters that hide it, over the example's 50,000 work orders
 * on e3 itself (#1376). Search Records' line for such a row names the choices
 * that hide it as the rail words them — each choice alone asked of e3 through
 * the record's indexes, one request a choice, for the hidden rows the box
 * lists and no others, and never again at the same revision and narrowing; a
 * choice no index lets stand alone asked with the one before it, as the rail
 * holds it, and named and cleared with the one that hides the row — and says
 * `· hidden by the filters` until e3 has said. A pick of it clears just those
 * choices, every other one kept — every choice, before e3 has said — as a
 * change of the rail like any other, and the ring lands on the row at its row
 * number. Go to issue on a draft row the narrowing hides says and does the
 * same.
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, East, StringType, equalFor, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Data, Record, Sheet } from "@elaraai/e3-ui/internal";
import { RecordSliceChoiceType, RecordSlicesChromeType, RecordSliceWhereType, Reactive, Slice, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-records";
import type { E3Request } from "../e3-web.test-utils.js";
import { frameScrolls } from "./frame.test-utils.js";
import { act, settle, sheetHarness, slot } from "./frame/harness.test-utils.js";

const h = sheetHarness({ modules: { "sheet/sheet-records": ex }, frame: 2000 });
/** The work orders' record, as its dataset's requests name it. */
const ORDERS = `records.${ex.indexedWorkOrders.name}`;
let restoreScroll = () => {};
beforeEach(() => { restoreScroll = frameScrolls(); });
afterEach(() => { restoreScroll(); });

type Where = ValueTypeOf<typeof RecordSliceWhereType>;
type Choice = ValueTypeOf<typeof RecordSliceChoiceType>;
const printString = printFor(StringType);
const printDate = printFor(DateTimeType);
const whereEqual = equalFor(RecordSliceWhereType);

/** The `rows` source as the example declares it: the rail's fields over the work orders' indexes. */
const ROWS = {
    source: Data.bindPaged(ex.indexedWorkOrders, { indexes: [ex.indexedWorkByStatusDue, ex.indexedWorkByDue, ex.indexedWorkByJob, ex.indexedWorkByQuantity, ex.indexedWorkByUrgent, ex.indexedWorkByTag] }),
    fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
    range: "due", search: ["job"], initial: { status: ["Ready"] },
} as const;
/** The example's presets. */
const PRESETS = { presets: [{ id: "ready", name: "Ready", where: { rows: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { rows: { urgent: [true] } } }] };

/** The example's rail, bound under its key as the sheet binds it: what a test writes a narrowing through, and reads it back from. */
const rail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({
    slice: Slice.bindRecords("ex.sheetRecordIndexes", { rows: ROWS }, PRESETS),
}))), getRegisteredPlatformImplementations());
/** The `rows` source's part of the rail. */
const rows = () => rail().slice.parts[0]!.slice;

/** Writes the `rows` source's narrowing, as the rail's chips write it. */
async function narrow(where: Where): Promise<void> {
    await act(async () => { rows().write({ where, preset: none, resolution: none }); });
    await settle();
}

/** A status chosen, as the rail's chip chooses it. */
const status = (word: string): Choice => variant("values", [printString(word)]);
/** Due in October's first thirty days — the orders fall due over ninety days from the first. */
const EARLY: Choice = variant("range", { from: printDate(new Date("2026-10-01T00:00:00Z")), to: printDate(new Date("2026-10-31T00:00:00Z")) });
/**
 * The orders scheduled and due early, both choices on the index by status and due, either one standing alone: order
 * `JOB-1000n` is Ready, Scheduled or Done by n's remainder by three, and due n × 37 days on, less whole ninety-day runs —
 * so of the first ten, those Ready or Done that fall due early are hidden by Status alone, the Scheduled falling due
 * later by Due alone, and the rest by both.
 */
const SCHEDULED_EARLY: Where = new Map([["status", status("Scheduled")], ["due", EARLY]]);

/** What a pick of each of the first ten orders clears, under {@link SCHEDULED_EARLY}, as its line says it. */
const BY_STATUS = "hidden by Status: Scheduled — picking it clears that filter";
const BY_DUE = "hidden by Due: Oct 1 – Oct 31 — picking it clears that filter";
const BY_BOTH = "hidden by Status: Scheduled; Due: Oct 1 – Oct 31 — picking it clears those filters";
/** The first ten orders' lines in Search Records, each the filters that hide it. */
const FIRST_TEN = [BY_STATUS, BY_DUE, BY_BOTH, BY_STATUS, BY_DUE, BY_STATUS, BY_BOTH, BY_DUE, BY_STATUS, BY_BOTH]
    .map((said, n) => `JOB-1000${n} · ${said}`);

/** A membership read's body: the index whose runs it asks of, and the entry keys `(ik=…, k=…)` it asks. */
const withinOf = (request: E3Request) => JSON.parse(new TextDecoder().decode(request.body)) as { index: string; keys: string[] };
/** The order an entry key names: its record key. */
const orderOf = (entry: string) => /k="([^"]+)"\)$/.exec(entry)![1];

/** Mounts the example, and narrows its rows. */
async function setup(where: Where) {
    const ui = await h.mount(ex.sheetRecordIndexes, { storageKey: "sheet-hidden-pick" });
    const view = sheetView(ui.container);
    await waitFor(() => expect(view.ids()[0]).toBe("JOB-10000"));
    await narrow(where);
    return { ...ui, ...view };
}

/** The sheet's rows as a test reads them. */
function sheetView(container: HTMLElement) {
    const main = () => container.querySelector<HTMLElement>('[data-frame-slot="main"]')!;
    const row = (id: string) => main().querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`);
    const ids = () => [...main().querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')].map((r) => r.dataset["rowId"]);
    /** The ring's cell on a row, if the ring is on it. */
    const ring = (id: string) => row(id)?.querySelector('[data-slot="cell"][data-selected]') ?? null;
    /** A row's number in its gutter. */
    const number = (id: string) => row(id)?.querySelector('[data-slot="gutterNumber"]')?.textContent;
    return { main, row, ids, ring, number };
}

/**
 * The toolbar's Search Records box: a query set in it at once, the box focused as a click focuses it — one query, so
 * the lines it lists are the only rows it reads — its lines, and Enter, which picks the first match.
 */
function searchRecords(container: HTMLElement) {
    const box = () => container.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
    const input = () => box().querySelector<HTMLInputElement>("input")!;
    const ask = async (text: string) => {
        await act(async () => { input().focus(); });
        await act(async () => { fireEvent.change(input(), { target: { value: text } }); });
    };
    const clear = async () => { await act(async () => { fireEvent.click(box().querySelector("button[aria-label='Clear search']")!); }); };
    const enter = async () => { await act(async () => { fireEvent.keyDown(input(), { key: "Enter" }); }); };
    // The box's list: the listbox its input controls, its lines as they read.
    const lines = () => {
        const list = document.getElementById(input().getAttribute("aria-controls") ?? "");
        return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => option.textContent);
    };
    return { box, input, ask, clear, enter, lines };
}

test("Search Records names the filters that hide a row the narrowing hides, as the rail words them — one of the two, or both", async () => {
    const ui = await setup(SCHEDULED_EARLY);
    // Scheduled and due early: the tenth order is the first of them.
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10010"));
    const search = searchRecords(ui.container);
    await search.ask("JOB-1000");
    await waitFor(() => expect(search.lines()).toEqual(FIRST_TEN), { timeout: 10_000 });
});

test("which filters hide the rows is asked of e3 for the hidden rows the box lists and no others — each choice alone, one request a choice — and never again at the same revision and narrowing", async () => {
    const ui = await setup(SCHEDULED_EARLY);
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10010"));
    await settle();
    const before = h.requests("within", ORDERS).length;
    const asked = () => h.requests("within", ORDERS).slice(before);
    const search = searchRecords(ui.container);
    await search.ask("JOB-1000");
    await waitFor(() => expect(search.lines()).toEqual(FIRST_TEN), { timeout: 10_000 });
    await settle();
    // Status alone through the index by status and due, Due alone through its own: one request each, asking of the ten
    // orders the box lists — every one hidden — and of nothing else. Which of them the narrowing holds the lens had read.
    const reads = asked().map(withinOf);
    expect(reads.map((read) => read.index).sort()).toEqual(["by_due", "by_status_due"]);
    const listed = Array.from({ length: 10 }, (_x, n) => `JOB-1000${n}`);
    for (const read of reads) expect(read.keys.map(orderOf)).toEqual(listed);
    // The same rows asked of again — the box cleared and the query asked again, then one of the ten alone: their lines
    // named at once, and nothing asked of e3 again.
    await search.clear();
    await search.ask("JOB-1000");
    await waitFor(() => expect(search.lines()).toEqual(FIRST_TEN), { timeout: 10_000 });
    await search.clear();
    await search.ask("JOB-10005");
    await waitFor(() => expect(search.lines()).toEqual([FIRST_TEN[5]]), { timeout: 10_000 });
    await settle();
    expect(asked()).toHaveLength(2);
});

test("a pick of a row the narrowing hides clears just the filters that hide it, the other kept, and the ring lands on the row at its row number — the record's own rows drawn once both are cleared", async () => {
    const ui = await setup(SCHEDULED_EARLY);
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10010"));
    const search = searchRecords(ui.container);
    /** Picks an order from the box once its line names what hides it. */
    const pick = async (id: string, said: string) => {
        await search.ask(id);
        await waitFor(() => expect(search.lines()).toEqual([`${id} · ${said}`]), { timeout: 10_000 });
        await search.enter();
        await waitFor(() => expect(ui.ring(id)).not.toBeNull(), { timeout: 10_000 });
        await settle();
    };
    // JOB-10000 is Ready and due on the first: Status hides it. Due stays, and the order shows first, at its number.
    await pick("JOB-10000", BY_STATUS);
    expect(whereEqual(rows().read().where, new Map([["due", EARLY]]))).toBe(true);
    expect(ui.number("JOB-10000")).toBe("1");
    expect(ui.ids()[0]).toBe("JOB-10000");
    // JOB-10001 is Scheduled and due on day 37: Due hides it. Status stays.
    await narrow(SCHEDULED_EARLY);
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10010"));
    await pick("JOB-10001", BY_DUE);
    expect(whereEqual(rows().read().where, new Map([["status", status("Scheduled")]]))).toBe(true);
    expect(ui.number("JOB-10001")).toBe("2");
    // JOB-10009 is Ready and due on day 63: both hide it, and with both cleared the record's own rows draw, it the tenth
    // — JOB-10008, Done, drawn before it.
    await narrow(SCHEDULED_EARLY);
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10010"));
    await pick("JOB-10009", BY_BOTH);
    expect(rows().read().where.size).toBe(0);
    expect(ui.number("JOB-10009")).toBe("10");
    const at = ui.ids().indexOf("JOB-10009");
    expect(ui.ids().slice(at - 1, at + 2)).toEqual(["JOB-10008", "JOB-10009", "JOB-10010"]);
});

test("a filter a pick clears is a change of the rail like any other: a saved view's tab is marked changed, and Esc on the sheet puts the filter back", async () => {
    const ui = await setup(SCHEDULED_EARLY);
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10010"));
    // + TAB: a view of the narrowing, open, as it saved it.
    fireEvent.mouseDown(ui.container.querySelector('[data-slot="tabAdd"]')!, { button: 0 });
    await settle();
    const tab = () => ui.container.querySelector<HTMLElement>('[data-slot="tab"][data-tab="view-1"]')!;
    expect(tab().hasAttribute("data-active")).toBe(true);
    expect(tab().hasAttribute("data-dirty")).toBe(false);
    const search = searchRecords(ui.container);
    await search.ask("JOB-10000");
    await waitFor(() => expect(search.lines()).toEqual([`JOB-10000 · ${BY_STATUS}`]), { timeout: 10_000 });
    await search.enter();
    await waitFor(() => expect(ui.ring("JOB-10000")).not.toBeNull(), { timeout: 10_000 });
    // Status cleared: the view no longer holds the narrowing, and its tab says so.
    await waitFor(() => expect(tab().hasAttribute("data-dirty")).toBe(true));
    expect(whereEqual(rows().read().where, new Map([["due", EARLY]]))).toBe(true);
    // Esc on the sheet: the view's narrowing again, Status with it, and its rows.
    fireEvent.keyDown(ui.main().querySelector('[role="grid"]')!, { key: "Escape" });
    await settle();
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10010"), { timeout: 10_000 });
    expect(whereEqual(rows().read().where, SCHEDULED_EARLY)).toBe(true);
    expect(tab().hasAttribute("data-dirty")).toBe(false);
});

test("until e3 has said which filters hide a row, its line says the filters do, and a pick of it clears every choice of the rows source", async () => {
    const ui = await setup(SCHEDULED_EARLY);
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10010"));
    await settle();
    // Which of the choices hide it, held on the wire: the lens has read which of the rows the narrowing holds already.
    const asking = h.e3.hold((request) => request.kind === "within" && request.dataset === ORDERS);
    const search = searchRecords(ui.container);
    await search.ask("JOB-10000");
    await waitFor(() => expect(asking.held).toBeGreaterThan(0), { timeout: 10_000 });
    await waitFor(() => expect(search.lines()).toEqual(["JOB-10000 · hidden by the filters"]), { timeout: 10_000 });
    await search.enter();
    // Every choice of the source cleared: the record's own rows, the ring on the order at its number.
    await waitFor(() => expect(ui.ring("JOB-10000")).not.toBeNull(), { timeout: 10_000 });
    expect(rows().read().where.size).toBe(0);
    expect(ui.number("JOB-10000")).toBe("1");
    await act(async () => { asking.release(); });
    await settle();
});

/** The `rows` source with no index by due alone: a Due choice stands only after a Status choice, on the index by status and due. */
const ROWS_DUE_FOLLOWS = {
    ...ROWS,
    source: Data.bindPaged(ex.indexedWorkOrders, { indexes: [ex.indexedWorkByStatusDue, ex.indexedWorkByJob, ex.indexedWorkByQuantity, ex.indexedWorkByUrgent, ex.indexedWorkByTag] }),
} as const;
/** That source's rail, bound under its key as the sheet binds it. */
const followsRail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({
    slice: Slice.bindRecords("test.sheetHiddenPick.dueFollows", { rows: ROWS_DUE_FOLLOWS }),
}))), getRegisteredPlatformImplementations());
const followsRows = () => followsRail().slice.parts[0]!.slice;
/** The work orders' sheet over that source. */
const dueFollows = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(ex.indexedWorkOrders, [ex.indexedWorkPatch]));
    const slice = $.let(Slice.bindRecords("test.sheetHiddenPick.dueFollows", { rows: ROWS_DUE_FOLLOWS }));
    return Sheet({
        name: "dueFollows", slice: { slice }, onApply: Record.onApply(record, { keyed: true }), edits: { insertRows: false },
        columns: {
            reference: Sheet.column.text(ex.IndexedWork, { header: "Reference" }),
            status: Sheet.column.text(ex.IndexedWork, { header: "Status" }),
            due: Sheet.column.date(ex.IndexedWork, { header: "Due" }),
        },
    });
}))) };

test("a choice that stands only after another — Due, with no index of its own — is asked with the choice before it, as the rail holds it: named beside the choice that hides the row and cleared with it, and alone where it alone hides the row", async () => {
    const ui = await h.mount(dueFollows, { storageKey: "sheet-hidden-pick-due-follows" });
    const view = sheetView(ui.container);
    await waitFor(() => expect(view.ids()[0]).toBe("JOB-10000"));
    const narrowFollows = async () => {
        await act(async () => { followsRows().write({ where: SCHEDULED_EARLY, preset: none, resolution: none }); });
        await settle();
        await waitFor(() => expect(view.ids()[0]).toBe("JOB-10010"));
        await settle();
    };
    await narrowFollows();
    const before = h.requests("within", ORDERS).length;
    const search = searchRecords(ui.container);
    await search.ask("JOB-1000");
    // JOB-10000, Ready and due early, and JOB-10002, Done and due late: Status hides each, and Due — which cannot stand
    // without it — goes with it. JOB-10001, Scheduled and due late: Due alone hides it.
    const withStatus = (id: string) => `${id} · hidden by Status: Scheduled — picking it clears that filter, and Due: Oct 1 – Oct 31 with it`;
    await waitFor(() => expect(search.lines().slice(0, 3)).toEqual([withStatus("JOB-10000"), `JOB-10001 · ${BY_DUE}`, withStatus("JOB-10002")]), { timeout: 10_000 });
    await settle();
    // Status alone, through the index by status and due; Due with Status before it is the narrowing itself, which the
    // lens has asked of these rows already.
    expect(h.requests("within", ORDERS).slice(before).map(withinOf).map((read) => read.index)).toEqual(["by_status_due"]);
    // A pick of JOB-10001 clears Due alone: Status stays, the order the second row.
    await search.clear();
    await search.ask("JOB-10001");
    await waitFor(() => expect(search.lines()).toEqual([`JOB-10001 · ${BY_DUE}`]), { timeout: 10_000 });
    await search.enter();
    await waitFor(() => expect(view.ring("JOB-10001")).not.toBeNull(), { timeout: 10_000 });
    expect(whereEqual(followsRows().read().where, new Map([["status", status("Scheduled")]]))).toBe(true);
    expect(view.number("JOB-10001")).toBe("2");
    // A pick of JOB-10000 clears Status, and Due with it: the record's own rows, the order the first.
    await narrowFollows();
    await search.ask("JOB-10000");
    await waitFor(() => expect(search.lines()).toEqual([withStatus("JOB-10000")]), { timeout: 10_000 });
    await search.enter();
    await waitFor(() => expect(view.ring("JOB-10000")).not.toBeNull(), { timeout: 10_000 });
    expect(followsRows().read().where.size).toBe(0);
    expect(view.number("JOB-10000")).toBe("1");
});

/** The work orders' sheet as the example declares it, given the inspector pane: its Issues tab, where an issue is gone to. */
const inspected = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.let(Record.bind(ex.indexedWorkOrders, [ex.indexedWorkPatch]));
    const slice = $.let(Slice.bindRecords("ex.sheetRecordIndexes", { rows: ROWS }, PRESETS));
    return Sheet({
        name: "inspected", slice: { slice }, inspector: true, onApply: Record.onApply(record, { keyed: true }), edits: { insertRows: false },
        columns: {
            reference: Sheet.column.text(ex.IndexedWork, { header: "Reference" }),
            status: Sheet.column.text(ex.IndexedWork, { header: "Status" }),
            due: Sheet.column.date(ex.IndexedWork, { header: "Due" }),
            quantity: Sheet.column.integer(ex.IndexedWork, { header: "Quantity" }),
        },
    });
}))) };

test("Go to issue on a draft row the narrowing hides: its line names the filter that hides it, and a click clears just that filter and puts the ring on the issue's cell", async () => {
    const ui = await h.mount(inspected, { storageKey: "sheet-hidden-pick-issue" });
    const view = sheetView(ui.container);
    await waitFor(() => expect(view.ids()[0]).toBe("JOB-10000"));
    // An unreadable quantity typed on the first order, Ready: a draft with an issue.
    fireEvent.doubleClick(view.row("JOB-10000")!.querySelector('[data-slot="cell"][data-key="quantity"]')!);
    await settle();
    const editor = view.main().querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(editor, { target: { value: "zz" } });
    await settle();
    fireEvent.keyDown(editor, { key: "Enter" });
    await settle();
    // Scheduled and due early: the order — Ready, due on the first — hidden by Status alone.
    await narrow(SCHEDULED_EARLY);
    await waitFor(() => expect(view.ids()[0]).toBe("JOB-10010"));
    const pane = slot(ui.container, "end")!;
    fireEvent.click(within(pane).getByRole("tab", { name: "Issues 1" }));
    await settle();
    const item = () => pane.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [data-inspector-issue]')!;
    await waitFor(() => expect(item().querySelector("[data-inspector-issue-hidden]")?.textContent).toBe(BY_STATUS), { timeout: 10_000 });
    expect(item().textContent).toBe(`JOB-10000 · QuantityInvalid input: zz${BY_STATUS}`);
    fireEvent.click(item());
    // Status cleared, Due kept; the order drawn first, at its number, the ring on its quantity.
    await waitFor(() => expect(view.ring("JOB-10000")?.getAttribute("data-key")).toBe("quantity"), { timeout: 10_000 });
    expect(whereEqual(rows().read().where, new Map([["due", EARLY]]))).toBe(true);
    expect(view.number("JOB-10000")).toBe("1");
});
