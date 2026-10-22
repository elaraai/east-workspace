/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The lens over a record (#1349, B§8): the Sheet's `rows` source's narrowing
 * drawn over its record's 50,000 work orders, in the record's order — each
 * match at its row number, the rows either side of it as the context switch
 * says, gaps of their exact size over the rest that open 1 · 3 · 10 · all, and
 * the count line — read from where e3 places the narrowing's rows and the
 * segments near the view alone: never the record whole, never a row by its
 * key. A segment whose rows disagree with where e3 placed the narrowing's is
 * one failed band that says so, never a match the index does not hold. A key
 * search lands on a row the lens hides and opens it, and starts afresh with
 * each narrowing of the rows; the runs the planner opened are kept by their
 * rows' keys, across a revision that moves them and in a saved view. Over the
 * example's record on e3 itself (#1376).
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, IntegerType, StringType, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Data } from "@elaraai/e3-ui/internal";
import { RecordSlicesChromeType, RecordSliceWhereType, Slice, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-records";
import type { E3Request } from "../e3-web.test-utils.js";
import { frameScrolls } from "./frame.test-utils.js";
import { act, settle, sheetHarness } from "./frame/harness.test-utils.js";
import { LENS_BUDGET } from "./use-lens.js";

const h = sheetHarness({ modules: { "sheet/sheet-records": ex }, frame: 2000 });
/** The work orders' record, as its dataset's requests name it. */
const ORDERS = `records.${ex.indexedWorkOrders.name}`;
let restoreScroll = () => {};
beforeEach(() => { restoreScroll = frameScrolls(); });
afterEach(() => { restoreScroll(); });

const printInteger = printFor(IntegerType);
const printString = printFor(StringType);
type Where = ValueTypeOf<typeof RecordSliceWhereType>;

/** The example's rail, bound under its key as the sheet binds it: what a test writes a narrowing through. */
const rail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({
    slice: Slice.bindRecords("ex.sheetRecordIndexes", {
        rows: {
            source: Data.bindPaged(ex.indexedWorkOrders, { indexes: [ex.indexedWorkByStatusDue, ex.indexedWorkByDue, ex.indexedWorkByJob, ex.indexedWorkByQuantity, ex.indexedWorkByUrgent, ex.indexedWorkByTag] }),
            fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
            range: "due", search: ["job"], initial: { status: ["Ready"] },
        },
    }, { presets: [{ id: "ready", name: "Ready", where: { rows: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { rows: { urgent: [true] } } }] }),
}))), getRegisteredPlatformImplementations());

/** Writes the `rows` source's narrowing, as the rail's chips write it. */
async function narrow(where: Where): Promise<void> {
    const part = rail().slice.parts[0]!.slice;
    await act(async () => { part.write({ where, preset: none, resolution: none }); });
    await settle();
}
/** The orders of one quantity: every 24th, from the seventh. */
const QUANTITY_700: Where = new Map([["quantity", variant("values", [printInteger(700n)])]]);
/** The orders ready, as the example opens: every third, from the first. */
const READY: Where = new Map([["status", variant("values", [printString("Ready")])]]);
/** A membership read's entry keys, `(ik=…, k=…)`, as its body names them. */
const keysOf = (request: E3Request) => (JSON.parse(new TextDecoder().decode(request.body)) as { keys: string[] }).keys;
/** How many of the narrowing's rows a placement's answer placed. */
const placedOf = (body: Uint8Array) => (JSON.parse(new TextDecoder().decode(body)) as { placed: number }).placed;

async function setup() {
    const ui = await h.mount(ex.sheetRecordIndexes, { storageKey: "sheet-lens-test" });
    const main = () => ui.container.querySelector<HTMLElement>('[data-frame-slot="main"]')!;
    const rows = () => [...main().querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')];
    const row = (id: string) => main().querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"]`);
    const ids = () => rows().map((r) => r.dataset["rowId"]);
    const numbers = () => rows().map((r) => r.querySelector('[data-slot="gutterNumber"]')!.textContent);
    const hits = () => rows().map((r) => r.querySelector('[data-slot="gutterNumber"]')!.hasAttribute("data-hit"));
    const gaps = () => [...main().querySelectorAll<HTMLElement>('[data-slot="band"][data-band="lens"]')];
    const hidden = () => gaps().map((g) => g.dataset["hidden"]);
    const count = () => ui.container.querySelector('[data-slot="toolbarCount"]')?.textContent;
    const context = async (n: 0 | 1 | 3) => {
        fireEvent.mouseDown(ui.container.querySelector<HTMLElement>(`[data-slot="contextOption"][data-context="${n}"]`)!, { button: 0 });
        await settle();
    };
    const press = async (gap: HTMLElement, where: "top" | "bottom" | "all") => {
        fireEvent.mouseDown(gap.querySelector<HTMLElement>(`[data-slot="bandControl"][data-where="${where}"]`)!, { button: 0 });
        await settle();
    };
    const tab = (id: string) => ui.container.querySelector<HTMLElement>(`[data-slot="tab"][data-tab="${id}"]`)!;
    return { ...ui, main, rows, row, ids, numbers, hits, gaps, hidden, count, context, press, tab };
}

test("it opens on its narrowing: each match at its row number, the rows between in gaps of their size, the count line — read from where e3 places the narrowing's rows and the segments near the view, never the record whole nor a row by its key", async () => {
    const placements = h.e3.answers((request) => request.kind === "place" && request.dataset === ORDERS);
    const ui = await setup();
    await waitFor(() => expect(ui.ids().slice(0, 3)).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]));
    await settle();
    // Ready is every third order: each drawn at its place in the record, marked a match, the two between a gap.
    expect(ui.numbers().slice(0, 3)).toEqual(["1", "4", "7"]);
    expect(ui.hits().slice(0, 3)).toEqual([true, true, true]);
    expect(ui.hidden().slice(0, 3)).toEqual(["2", "2", "2"]);
    expect(ui.count()).toBe("16,667 matches");
    expect(ui.main().querySelector("[data-sheet]")!.hasAttribute("data-lens")).toBe(true);
    // What it read: the narrowing's bounds in its index, its placement, and which of the segments' rows near the view
    // the narrowing holds — no row sought by its key.
    expect(h.requests("read", ORDERS)).toEqual([]);
    const finds = h.requests("find", ORDERS);
    expect(finds.flatMap((request) => request.searches)).toEqual([{ fields: ['"Ready"'] }]);
    // The placement a window at a time, each asked once: the windows' answers place the narrowing's 16,667 rows
    // between them.
    const place = h.requests("place", ORDERS).length;
    expect(place).toBeGreaterThan(0);
    expect(placements.length).toBe(place);
    expect(placements.reduce((sum, answer) => sum + placedOf(answer.body), 0)).toBe(16_667);
    // The segments near the view a page each — far short of the record's 25 — and one ask each of which of their
    // rows the narrowing holds: no row asked of twice.
    const pages = h.requests("page", ORDERS).length;
    const asked = h.requests("within", ORDERS).map(keysOf);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThanOrEqual(pages);
    expect(pages).toBeLessThanOrEqual(LENS_BUDGET);
    expect(new Set(asked.flat()).size).toBe(asked.flat().length);
    expect([h.requests("runs", ORDERS), h.requests("rows", ORDERS)]).toEqual([[], []]);
});

test("the hit check: a segment whose rows disagree with where e3 placed the narrowing's is one failed band that says so, with a Retry — never a match the index does not hold — until the record moves and it is read again", async () => {
    // e3's answer of which of the first segment's rows are Ready, altered once on its way back: JOB-10001, Scheduled, said Ready.
    const said = 'k="JOB-10001")';
    let altered = false;
    h.e3.fail((request) => !altered && request.kind === "within" && request.dataset === ORDERS && keysOf(request).some((key) => key.endsWith(said)), {
        alter: (body, request) => {
            altered = true;
            const answer = JSON.parse(new TextDecoder().decode(body)) as { within: boolean[] };
            answer.within[keysOf(request).findIndex((key) => key.endsWith(said))] = true;
            return new TextEncoder().encode(JSON.stringify(answer));
        },
    });
    const ui = await setup();
    const failed = () => ui.main().querySelector<HTMLElement>('[data-slot="band"][data-band="failed"]');
    await waitFor(() => expect(failed()).not.toBeNull(), { timeout: 10_000 });
    await settle();
    expect(altered).toBe(true);
    // The first segment, from the first row: one band saying the record changed, with a Retry. None of its rows is
    // drawn — the one said Ready least of all — and the count line is e3's count.
    expect(failed()!.dataset["failed"]).toBe("0");
    expect(failed()!.textContent).toContain("the record changed while they were read");
    expect(failed()!.querySelector('[data-slot="retry"]')).not.toBeNull();
    expect([ui.row("JOB-10000"), ui.row("JOB-10001")]).toEqual([null, null]);
    expect(ui.count()).toBe("16,667 matches");
    // Another session changes an order at the record's end: at the new revision the segment is placed and read again,
    // and drawn.
    const before = await h.read(ex.indexedWorkOrders);
    const next = new Map(before);
    next.set("JOB-59999", { ...before.get("JOB-59999")!, operations: [] });
    await h.patch(ex.indexedWorkOrders, next);
    await waitFor(() => expect(ui.ids().slice(0, 3)).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]), { timeout: 10_000 });
    expect(failed()).toBeNull();
    expect(ui.numbers().slice(0, 3)).toEqual(["1", "4", "7"]);
    expect(ui.hits().slice(0, 3)).toEqual([true, true, true]);
    expect(ui.row("JOB-10001")).toBeNull();
});

test("its reads follow the view: scrolled to the record's end, it reads the segments there, a page and an ask each, and draws the last match at its number", async () => {
    const ui = await setup();
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10000"));
    await settle();
    const before = { pages: h.requests("page", ORDERS).length, within: h.requests("within", ORDERS).length };
    const frame = ui.main().querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
    await act(async () => {
        frame.scrollTop = frame.scrollHeight;
        frame.dispatchEvent(new Event("scroll"));
    });
    // The last Ready order is the 49,999th row.
    await waitFor(() => expect(ui.row("JOB-59998")).not.toBeNull(), { timeout: 10_000 });
    await settle();
    expect(ui.row("JOB-59998")!.querySelector('[data-slot="gutterNumber"]')!.textContent).toBe("49999");
    expect(ui.row("JOB-59998")!.querySelector('[data-slot="gutterNumber"]')!.hasAttribute("data-hit")).toBe(true);
    const pages = h.requests("page", ORDERS).length - before.pages;
    const within = h.requests("within", ORDERS).length - before.within;
    expect(pages).toBeGreaterThan(0);
    expect(pages).toBeLessThanOrEqual(LENS_BUDGET);
    expect(within).toBeLessThanOrEqual(pages);
    expect(h.requests("read", ORDERS)).toEqual([]);
});

test("the context switch shows the rows either side of each match; a gap's controls open 1, 3, then the rest of it, keeping their reach while rows open inside it", async () => {
    const ui = await setup();
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10000"));
    await narrow(QUANTITY_700);
    // Quantity 700 is every 24th order, from the seventh: 2,084 of them.
    await waitFor(() => expect(ui.ids().slice(0, 3)).toEqual(["JOB-10006", "JOB-10030", "JOB-10054"]));
    expect(ui.numbers().slice(0, 3)).toEqual(["7", "31", "55"]);
    expect(ui.hidden().slice(0, 3)).toEqual(["6", "23", "23"]);
    expect(ui.count()).toBe("2,084 matches");
    await ui.context(1);
    await waitFor(() => expect(ui.ids().slice(0, 6)).toEqual(["JOB-10005", "JOB-10006", "JOB-10007", "JOB-10029", "JOB-10030", "JOB-10031"]));
    expect(ui.hits().slice(0, 6)).toEqual([false, true, false, false, true, false]);
    expect(ui.hidden().slice(0, 3)).toEqual(["5", "21", "21"]);
    expect(ui.count()).toMatch(/^2,084 matches · [\d,]+ context$/);
    await ui.context(3);
    await waitFor(() => expect(ui.hidden().slice(0, 3)).toEqual(["3", "17", "17"]));
    expect(ui.ids().slice(0, 7)).toEqual(["JOB-10003", "JOB-10004", "JOB-10005", "JOB-10006", "JOB-10007", "JOB-10008", "JOB-10009"]);
    // The second gap, rows 11–27: from its top, one, then three; from its bottom, one; then all of it.
    await ui.press(ui.gaps()[1]!, "top");
    await waitFor(() => expect(ui.row("JOB-10010")).not.toBeNull());
    expect(ui.hidden()[1]).toBe("16");
    await ui.press(ui.gaps()[1]!, "top");
    await waitFor(() => expect(ui.hidden()[1]).toBe("13"));
    expect(["JOB-10011", "JOB-10012", "JOB-10013"].every((id) => ui.row(id) !== null)).toBe(true);
    await ui.press(ui.gaps()[1]!, "bottom");
    await waitFor(() => expect(ui.hidden()[1]).toBe("12"));
    expect(ui.row("JOB-10026")).not.toBeNull();
    await ui.press(ui.gaps()[1]!, "all");
    await waitFor(() => expect(ui.ids().slice(0, 31)).toEqual(Array.from({ length: 31 }, (_x, i) => `JOB-${10003 + i}`)));
    // The context switch starts the reveals afresh.
    await ui.context(0);
    await waitFor(() => expect(ui.hidden().slice(0, 2)).toEqual(["6", "23"]));
});

test("a key search lands on a row the lens hides: it opens it, at its number, and the ring goes to it; another narrowing of the rows starts the search afresh", async () => {
    const ui = await setup();
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10000"));
    await narrow(QUANTITY_700);
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10006"));
    const search = ui.container.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
    const input = search.querySelector<HTMLInputElement>("input")!;
    for (const key of "JOB-10001") {
        const typed = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(typed));
    }
    await waitFor(() => expect(search.textContent).toMatch(/1 match/), { timeout: 5_000 });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(ui.row("JOB-10001")?.querySelector('[data-slot="cell"][data-selected]')).not.toBeNull(), { timeout: 5_000 });
    // Opened at its place in the record, no match: the gap before the first match is split around it.
    expect(ui.row("JOB-10001")!.querySelector('[data-slot="gutterNumber"]')!.textContent).toBe("2");
    expect(ui.row("JOB-10001")!.querySelector('[data-slot="gutterNumber"]')!.hasAttribute("data-hit")).toBe(false);
    expect(ui.hidden().slice(0, 2)).toEqual(["1", "4"]);
    // It sought the record's own order: the key, as the record's keys sort.
    expect(h.requests("find", ORDERS).some((request) => request.searches.some((s) => "prefix" in s || "key" in s))).toBe(true);
    // The orders ready again: the rows' narrowing moved, and the search starts afresh — no key, no match it stood on —
    // as it did over a narrowed source's own rows (#1345), though the record's rows are the same rows.
    await narrow(READY);
    await waitFor(() => expect(ui.ids().slice(0, 3)).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]));
    const fresh = ui.container.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
    expect(fresh.querySelector<HTMLInputElement>("input")!.value).toBe("");
    expect(fresh.textContent).not.toMatch(/\d+ of \d+/);
});

test("the runs the planner opened are kept by their rows' keys: a revision that moves them finds them again, and a saved view opens them where its keys are", async () => {
    const ui = await setup();
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10000"));
    await narrow(QUANTITY_700);
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10006"));
    // The first gap, rows 1–6, ends at the first match: its bottom control opens the row before it.
    await ui.press(ui.gaps()[0]!, "bottom");
    await waitFor(() => expect(ui.row("JOB-10005")).not.toBeNull());
    expect(ui.numbers().slice(0, 2)).toEqual(["6", "7"]);
    // Saved as a view: the run by its rows' keys.
    fireEvent.mouseDown(ui.container.querySelector('[data-slot="tabAdd"]')!, { button: 0 });
    await settle();
    expect(ui.tab("view-1").hasAttribute("data-active")).toBe(true);
    // Another session adds an order that sorts before it: every row after moves on one.
    const before = await h.read(ex.indexedWorkOrders);
    const first = before.get("JOB-10000")!;
    const next = new Map(before);
    next.set("JOB-100005", { ...first, reference: "JOB-100005", quantity: 100n });
    await h.patch(ex.indexedWorkOrders, next);
    await waitFor(() => expect(ui.numbers().slice(0, 2)).toEqual(["7", "8"]));
    expect(ui.ids().slice(0, 2)).toEqual(["JOB-10005", "JOB-10006"]);
    expect(ui.hits().slice(0, 2)).toEqual([false, true]);
    // The whole sheet, then the view again: its run opens where its keys are now.
    fireEvent.mouseDown(ui.tab("all"), { button: 0 });
    await settle();
    await waitFor(() => expect(ui.ids()[0]).toBe("JOB-10000"));
    fireEvent.mouseDown(ui.tab("view-1"), { button: 0 });
    await settle();
    await waitFor(() => expect(ui.ids().slice(0, 2)).toEqual(["JOB-10005", "JOB-10006"]));
    expect(ui.numbers().slice(0, 2)).toEqual(["7", "8"]);
});
