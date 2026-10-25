/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The work orders Plan on e3 itself (`planRecordIndexes`, #1344, #1039): the
 * Sheet's 50,000 work orders a paged resource kind, narrowed through the
 * rail's `orders` source over their indexes, and their operations a record of
 * their own placed on them, read a cell at a time through their series index.
 * What each request asked is read from the harness's request log
 * (`h.requests`).
 *
 * - It opens on the narrowing's orders a window at a time — the window on
 *   screen and the two read ahead, through the status/due index — and the
 *   operations' cells of the orders around the rows in view: never either
 *   record whole, nor a window of operations.
 * - A scroll reads only the blocks it brings in: within the windows read, the
 *   cells of the orders it brings into view; past them, the windows there and
 *   the cells of the orders around the view then — never of the rows mounted
 *   at the edge of the run it rested in while those windows were read.
 * - A rail choice pages the narrowed orders through the index, never a window
 *   of every order filtered by key, and the rail counts them.
 * - A move drafts the operation in the operations kind's session, kept while
 *   the rail hides its order, through Undo and Redo and a remount; Save
 *   commits it through the operations' patch door by its key, and a remount
 *   reads it back.
 *
 * jsdom lays nothing out: the bounded frame's geometry is stubbed, its
 * `scrollTo` moving `scrollTop` as a browser's does, as the halls example's
 * tests stub it (`frame/plan-series-halls.dom.test.tsx`).
 */

import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor, within, type RenderResult } from "@testing-library/react";
import {
    DateTimeType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, parseFor, printFor, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-records";
import * as sheet from "@elaraai/e3-ui/examples/sheet/sheet-records";
import type { TreePath } from "@elaraai/e3-types";
import { searched, type E3Request } from "../e3-web.test-utils.js";
import { PLAN_GEOMETRY } from "./geometry.js";
import { rowKeyOf } from "./model.js";
import { carrySaid } from "./plan-move.test-utils.js";
import { act, el, entry, planHarness, rowAt, settle, slot } from "./frame/harness.test-utils.js";

const h = planHarness({ "plan/plan-records": ex, "sheet/sheet-records": sheet });

type Order = ValueTypeOf<typeof sheet.IndexedWork>;
type Operation = ValueTypeOf<typeof ex.PlanOperation>;

/** The first fortnight of October 2026: the window the Plan opens on, and the Due range its orders open narrowed to. */
const FIRST = new Date("2026-10-01T00:00:00Z");
const FORTNIGHT = new Date("2026-10-15T00:00:00Z");

/** The rail's key: each source's state kept under `${KEY}.${source}`. */
const KEY = "ex.planRecordIndexes";

// ── The records, and what the Plan asks e3 of them ───────────────────────────

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The work orders' record and the operations', as e3's requests name them. */
const ORDERS = pathText(sheet.indexedWorkOrders.path as TreePath);
const OPERATIONS = pathText(ex.planOperations.path as TreePath);
/** The orders' status/due index; the operations' interval index and series index. */
const BY_STATUS_DUE = sheet.indexedWorkByStatusDue;
const BY_TIME = ex.planOperationsByTime;
const SERIES = ex.planOperationsByWorkWeek;

/** How many orders a cell holds: a block of fifty of the narrowing's, in its index's order. */
const BLOCK = 50;
/** A work order's row height, at the default density: a two-line gutter, its status the second line. */
const ROW_PX = PLAN_GEOMETRY.default.rowStacked;

const text = printFor(StringType);
const parseString = parseFor(StringType);
const compareString = compareFor(StringType);
const compareDate = compareFor(DateTimeType);
const stringEqual = equalFor(StringType);
const operationEqual = equalFor(ex.PlanOperation);

/**
 * What the work orders' record was asked, from its `since`-th request on: each
 * request's kind and the index it reads through — the record's own entries
 * when it names none — a page's window, a search's size.
 */
const ordersAsked = (since = 0) => h.requests().slice(since).filter((r) => r.dataset === ORDERS && r.kind !== "dataset-status")
    .map((r) => {
        const index = r.query.get("index") ?? "record";
        if (r.kind === "page") return `page ${index} ${r.query.get("offset")}+${r.query.get("limit")}`;
        if (r.kind === "find") return `find ${index} ${r.searches.length}`;
        return `${r.kind} ${index}`;
    });

/** Whether a request reads the operations through an index — their own entries, with none named. */
const through = (index: { readonly name: string } | undefined) => (r: E3Request) =>
    r.dataset === OPERATIONS && (r.query.get("index") ?? undefined) === index?.name;

/** What the operations' series index was asked, from its `since`-th request on: a batch of cells' searches as `find` and its size, their entries as `runs`. */
const seriesAsked = (since = 0) => h.requests().slice(since).filter(through(SERIES))
    .map((r) => (r.kind === "find" ? `find ${r.searches.length}` : r.kind));

/**
 * The work orders whose cells the series index was searched for, from the
 * `since`-th request on: each search's last field, the order's key as the
 * index files it.
 */
function searchedOrders(since = 0): Set<string> {
    const out = new Set<string>();
    for (const request of h.requests().slice(since).filter(through(SERIES))) {
        if (request.kind !== "find") continue;
        for (const search of request.searches) {
            const field = "fields" in search ? search.fields.at(-1) : undefined;
            const order = field === undefined ? undefined : parseString(field);
            if (order?.success === true) out.add(order.value);
        }
    }
    return out;
}

/** The work orders as e3 holds them, read as another planner would: no request of the Plan's. */
const storedOrders = async () => (await h.read(sheet.indexedWorkOrders)) as ReadonlyMap<string, Order>;
/** The operations as e3 holds them now. */
const storedOperations = async () => (await h.read(ex.planOperations)) as ReadonlyMap<string, Operation>;

/**
 * The keys of the orders of some statuses due over a range, in the status/due
 * index's order: by status, then by when each is due, then by key.
 *
 * @param statuses - The statuses
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @returns The orders' keys
 */
async function ordersOf(statuses: readonly string[], from: Date, to: Date): Promise<string[]> {
    const all = [...(await storedOrders())];
    const due = (order: Order) => compareDate(order.due, from) >= 0 && compareDate(order.due, to) < 0;
    return [...statuses].sort(compareString).flatMap((status) => all
        .filter(([, order]) => stringEqual(order.status, status) && due(order))
        .sort(([ka, a], [kb, b]) => compareDate(a.due, b.due) || compareString(ka, kb))
        .map(([key]) => key));
}

/**
 * Where a status's orders due from a date start in the status/due index: how
 * many orders it files before them.
 *
 * @param status - The status
 * @param from - The date
 * @returns The place
 */
async function placeOf(status: string, from: Date): Promise<number> {
    let at = 0;
    for (const [, order] of await storedOrders()) {
        const byStatus = compareString(order.status, status);
        if (byStatus < 0 || (byStatus === 0 && compareDate(order.due, from) < 0)) at += 1;
    }
    return at;
}

// ── The rail, as the store keeps it ──────────────────────────────────────────

const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
type State = ValueTypeOf<typeof RecordSliceStateType>;

/**
 * The orders' statuses chosen, written as the rail writes them: the Due range
 * they open on kept.
 *
 * @param statuses - The statuses chosen
 */
async function chooseStatuses(statuses: readonly string[]) {
    const was = decodeState(getStore().read(`${KEY}.orders`)!);
    const where: State["where"] = new SortedMap([...was.where], compareString);
    where.set("status", variant("values", statuses.map((status) => text(status))));
    await act(async () => { getStore().write(`${KEY}.orders`, encodeState({ ...was, preset: none, where })); });
    await settle();
}

// ── What the canvas draws ────────────────────────────────────────────────────

/** A work order's row. */
const orderRow = (key: string) => entry("orders.span", key);
/** An operation's bar on its work order's row. */
const bar = (c: HTMLElement, operation: string, order: string) => c.querySelector<HTMLElement>(`${rowAt(orderRow(order))} ${el("data-run", "operation", operation)}`);
/** An element's name: its title, its times, its state. */
const named = (node: HTMLElement | null) => node?.getAttribute("aria-label") ?? null;
/** The work orders' rows the canvas has mounted, in order, each as its id's text. */
const orderRows = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll<HTMLElement>("[data-plan-row]")]
    .map((row) => row.getAttribute("data-plan-row")!)
    .filter((id) => id.includes("orders.span"));
/** The ids' texts of some orders' rows, in order. */
const rowsOf = (keys: readonly string[]) => keys.map((key) => rowKeyOf(orderRow(key)));
/** The rail's summary of what its narrowings hide. */
const summary = (c: HTMLElement) => slot(c, "toolbar")!.querySelector("[data-record-slices-summary]")?.textContent ?? null;
/** The footer's count of the changes waiting on Save. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;
/** A button of the history item, by the shared messages' words. */
const history = (c: HTMLElement, name: string) => within(slot(c, "toolbar")!).getByRole("button", { name }) as HTMLButtonElement;

/** JOB-10000's cutting, a day on from the first of October: where the move puts it. */
const MOVED = /^Cut panels, Oct 2, 2026, 06:00 – Oct 2, 2026, 14:00/;

/** Clicks a control, as a pointer does, and lets what it starts settle. */
async function press(node: Element) {
    await act(async () => {
        fireEvent.mouseDown(node, { button: 0 });
        fireEvent.click(node);
    });
    await settle();
}

/** Presses a key on the focused element — it bubbles to the canvas — and lets what it starts settle. */
async function key(name: string) {
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: name }); });
    await settle();
}

/** The bounded frame the canvas scrolls its rows in. */
const frameOf = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
/** Scrolls the frame, as a wheel does: the canvas reads on intent once the view comes to rest. */
async function scrollRows(c: HTMLElement, top: number) {
    await act(async () => {
        const frame = frameOf(c);
        frame.scrollTop = top;
        fireEvent.scroll(frame);
    });
}

// Layout stand-ins: a 400px bounded frame over a tall scroll extent, its `scrollTo` moving `scrollTop` as a browser's does.
const VIEWPORT = 400;
const frameHeight = (node: Element): number | undefined => (node.getAttribute("data-virtual-rows") === "bounded" ? VIEWPORT : undefined);
const saved = {
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
    scrollTo: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo"),
};

/** What is logged as an error: the Plan's and the paged runtime's say what failed to read. */
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
    errors = vi.spyOn(console, "error");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return frameHeight(this) ?? 0; } });
    Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get(this: Element) { return frameHeight(this) ?? 0; } });
    Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get(this: Element) { return frameHeight(this) !== undefined ? 10_000_000 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true, writable: true,
        value(this: HTMLElement, arg: ScrollToOptions | number) {
            this.scrollTop = typeof arg === "number" ? arg : (arg.top ?? this.scrollTop);
            this.dispatchEvent(new Event("scroll"));
        },
    });
});
afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
    Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
    if (saved.scrollTo !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollTo", saved.scrollTo);
    else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    // Nothing failed to read, not even for a moment: no window, no search, no cell.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" "))
        .filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

// ============================================================================
// The work orders paged, their operations a cell at a time
// ============================================================================

describe("the work orders Plan: the orders a paged resource kind, their operations read a cell at a time", () => {
    test("opens on the narrowing's work orders a window at a time — the window on screen and the two read ahead, through the status/due index — and the operations' cells of the first fifty orders over the weeks the canvas reads: never either record whole, nor a window of operations", async () => {
        const { container: c } = await h.mount(ex.planRecordIndexes);
        await settle();
        const ready = await ordersOf(["Ready"], FIRST, FORTNIGHT);
        const start = await placeOf("Ready", FIRST);
        expect(ready).toHaveLength(2_778);
        // The narrowing's run of the status/due index found — Ready, due in the fortnight — the record's count read from
        // one entry, and the run's orders a window at a time from where it starts: the window on screen and the two read
        // ahead. Never the record whole, nor a window of every order.
        expect(ordersAsked()).toEqual([
            `find ${BY_STATUS_DUE.name} 1`, "page record 0+1",
            `page ${BY_STATUS_DUE.name} ${start}+200`, `page ${BY_STATUS_DUE.name} ${start + 200}+200`, `page ${BY_STATUS_DUE.name} ${start + 400}+200`,
        ]);
        // Its rows: the narrowing's orders in the index's order, each with its operation's bar, and the rail counts them.
        expect(orderRows(c).slice(0, 10)).toEqual(rowsOf(ready.slice(0, 10)));
        expect(named(bar(c, "JOB-10000-run", "JOB-10000"))).toMatch(/^Cut panels, Oct 1, 2026, 06:00 – Oct 1, 2026, 14:00/);
        expect(summary(c)).toContain("2,778 of 50,000 work orders");
        // The operations' cells: the first block — the narrowing's first fifty orders — over the five weeks the canvas
        // reads (those of 28 September and 5 and 12 October its range touches, 29 September to 17 October, and one either
        // side), their searches in one request and the entries of those holding any in one more.
        expect(seriesAsked()).toEqual([`find ${5 * BLOCK}`, "runs"]);
        expect(searchedOrders()).toEqual(new Set(ready.slice(0, BLOCK)));
        // The interval index serves the rail's count of the window's operations and the bounds of their dates — searches,
        // and pages of one entry — and the record's own entries its count, one entry: never a window of operations.
        expect(h.requests().filter(through(BY_TIME)).every((r) => r.kind === "find" || (r.kind === "page" && r.query.get("limit") === "1"))).toBe(true);
        expect(h.requests("page", OPERATIONS).filter(through(undefined)).map((r) => `${r.query.get("offset")}+${r.query.get("limit")}`)).toEqual(["0+1"]);
        expect([h.requests("read", ORDERS), h.requests("read", OPERATIONS)]).toEqual([[], []]);
    });

    test("a scroll reads only the blocks it brings in: to the hundredth order, within the windows read, the cells of the orders from the fifty-first to the hundred-and-fiftieth and no window; to the thousandth, past them, the windows there and the cells of the orders around the view alone — none of the rows mounted at the edge of the run it rested in", async () => {
        const { container: c } = await h.mount(ex.planRecordIndexes);
        await settle();
        const ready = await ordersOf(["Ready"], FIRST, FORTNIGHT);
        const start = await placeOf("Ready", FIRST);
        // Down to the hundredth order, inside the first window: the blocks around the rows in view, the second and the
        // third — none of the first — and no window of orders, which the first holds.
        const near = h.requests().length;
        await scrollRows(c, 100 * ROW_PX);
        await waitFor(() => expect(searchedOrders(near).size).toBeGreaterThan(0), { timeout: 10_000 });
        await settle();
        expect(seriesAsked(near)).toEqual([`find ${2 * 5 * BLOCK}`, "runs"]);
        expect(searchedOrders(near)).toEqual(new Set(ready.slice(BLOCK, 3 * BLOCK)));
        expect(ordersAsked(near)).toEqual([]);
        // Down to the thousandth order, in the sixth window — past the three read: the windows there, through the index,
        // then the cells of the blocks around the orders the view shows, the twentieth and the twenty-first, once their
        // rows are drawn — never those of the rows mounted at the edge of the run it rested in while its windows were read.
        const far = h.requests().length;
        const thousandth = ready[1000]!;
        await scrollRows(c, 1000 * ROW_PX);
        await waitFor(() => expect(bar(c, `${thousandth}-run`, thousandth)).not.toBeNull(), { timeout: 10_000 });
        await settle();
        const pages = ordersAsked(far);
        expect(pages).toContain(`page ${BY_STATUS_DUE.name} ${start + 1000}+200`);
        const windows = pages.map((page) => /^page by_status_due (\d+)\+200$/.exec(page)?.[1]).map((at) => (at === undefined ? NaN : Number(at)));
        expect(windows.every((at) => at >= start + 600 && (at - start) % 200 === 0), pages.join(", ")).toBe(true);
        expect(seriesAsked(far)).toEqual([`find ${2 * 5 * BLOCK}`, "runs"]);
        expect(searchedOrders(far)).toEqual(new Set(ready.slice(19 * BLOCK, 21 * BLOCK)));
        expect([h.requests("read", ORDERS), h.requests("read", OPERATIONS)]).toEqual([[], []]);
    });

    test("a rail choice pages the narrowed work orders through the index — the Scheduled orders due in the fortnight in place of the Ready, their run of the status/due index found and its orders a window at a time from where it starts — never a window of every order, nor the record whole; the rail counts them, and the cells read are their first block's", async () => {
        const { container: c } = await h.mount(ex.planRecordIndexes);
        await settle();
        const opened = h.requests().length;
        await chooseStatuses(["Scheduled"]);
        const scheduled = await ordersOf(["Scheduled"], FIRST, FORTNIGHT);
        const start = await placeOf("Scheduled", FIRST);
        await waitFor(() => expect(orderRows(c).slice(0, 10)).toEqual(rowsOf(scheduled.slice(0, 10))));
        await settle();
        expect(ordersAsked(opened)).toEqual([
            `find ${BY_STATUS_DUE.name} 1`,
            `page ${BY_STATUS_DUE.name} ${start}+200`, `page ${BY_STATUS_DUE.name} ${start + 200}+200`, `page ${BY_STATUS_DUE.name} ${start + 400}+200`,
        ]);
        expect(scheduled).toHaveLength(2_778);
        expect(summary(c)).toContain("2,778 of 50,000 work orders");
        // The first of them, due on the second of October, with its operation's bar there; the cells of their first block.
        expect(scheduled[0]).toBe("JOB-10073");
        await waitFor(() => expect(named(bar(c, "JOB-10073-run", "JOB-10073"))).toMatch(/^Edge band, Oct 2, 2026, 06:00 – Oct 2, 2026, 14:00/));
        expect(seriesAsked(opened)).toEqual([`find ${5 * BLOCK}`, "runs"]);
        expect(searchedOrders(opened)).toEqual(new Set(scheduled.slice(0, BLOCK)));
        expect(h.requests("read", ORDERS)).toEqual([]);
    });

    test("a move drafts the operation in the operations kind's session — kept while the rail hides its order, through Undo and Redo and a remount — and Save commits it through the operations' patch door by its key, the work orders untouched and neither record read whole; a remount reads it back from e3", async () => {
        let ui: RenderResult = await h.mount(ex.planRecordIndexes, { drag: true });
        await settle();
        const before = await storedOperations();
        // JOB-10000's cutting, a day on: the keyboard picks it up, carries it a bucket on and drops it.
        bar(ui.container, "JOB-10000-run", "JOB-10000")!.focus();
        for (const name of [" ", "ArrowRight", " "]) await key(name);
        expect(carrySaid(ui.container)).toMatch(/^Dropped Cut panels on JOB-10000/);
        expect(pending(ui.container)).toBe("1 pending");
        const drafted = named(bar(ui.container, "JOB-10000-run", "JOB-10000"));
        expect(drafted).toMatch(MOVED);
        // The orders done chosen in the Ready ones' place: JOB-10000's row leaves the canvas; its draft stays the session's,
        // and Undo and Redo walk it there.
        await chooseStatuses(["Done"]);
        await waitFor(() => expect(bar(ui.container, "JOB-10000-run", "JOB-10000")).toBeNull());
        expect(pending(ui.container)).toBe("1 pending");
        await press(history(ui.container, editingMessages.undo()));
        expect(pending(ui.container)).toBe("0 pending");
        await press(history(ui.container, editingMessages.redo()));
        expect(pending(ui.container)).toBe("1 pending");
        // The Ready ones again: drawn as drafted. Then hidden again, and the Plan mounted again: the draft is still waiting.
        await chooseStatuses(["Ready"]);
        await waitFor(() => expect(named(bar(ui.container, "JOB-10000-run", "JOB-10000"))).toBe(drafted));
        await chooseStatuses(["Done"]);
        ui.unmount();
        ui = await h.mount(ex.planRecordIndexes, { drag: true });
        await settle();
        expect(bar(ui.container, "JOB-10000-run", "JOB-10000")).toBeNull();
        expect(pending(ui.container)).toBe("1 pending");
        // Saved while its order is hidden, through the operations' patch door — one patch — and confirmed by the
        // operation's key; the orders untouched, and no Save notice: the operation stays in the dates on screen.
        const saving = h.requests().length;
        await press(history(ui.container, editingMessages.apply()));
        await waitFor(() => expect(pending(ui.container)).toBe("0 pending"));
        await settle();
        expect(h.requests("mutate", ex.planOperations.name).map((r) => r.name)).toEqual(["patch"]);
        expect(h.requests("mutate", sheet.indexedWorkOrders.name)).toEqual([]);
        expect(h.requests().slice(saving).some((r) => r.dataset === OPERATIONS && searched(r, undefined, text("JOB-10000-run")))).toBe(true);
        expect(ui.container.querySelector("[data-record-save-notice]")).toBeNull();
        const after = await storedOperations();
        const changed = [...after].filter(([at, operation]) => {
            const was = before.get(at);
            return was === undefined || !operationEqual(operation, was);
        }).map(([at]) => at);
        expect(changed).toEqual(["JOB-10000-run"]);
        expect(after.get("JOB-10000-run")).toEqual({ ...before.get("JOB-10000-run")!, start: new Date("2026-10-02T06:00:00Z"), end: new Date("2026-10-02T14:00:00Z") });
        expect(h.requests("read")).toEqual([]);
        // The Ready ones again, the Plan mounted once more: the operation drawn where it was saved, nothing waiting on
        // Save — its cells' entries read back from e3, their bounds at the committed revision found before and kept.
        await chooseStatuses(["Ready"]);
        ui.unmount();
        const remounted = h.requests().length;
        ui = await h.mount(ex.planRecordIndexes, { drag: true });
        await waitFor(() => expect(named(bar(ui.container, "JOB-10000-run", "JOB-10000"))).toMatch(MOVED));
        expect(pending(ui.container)).toBe("0 pending");
        expect(seriesAsked(remounted)).toEqual(["runs"]);
    });
});
