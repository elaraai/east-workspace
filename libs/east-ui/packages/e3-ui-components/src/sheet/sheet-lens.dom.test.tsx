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
 * one failed run that says so, the footer's line why, never a match the index
 * does not hold. A key
 * search lands on a row the lens hides and opens it, and starts afresh with
 * each narrowing of the rows; the runs the planner opened are kept by their
 * rows' keys, across a revision that moves them and in a saved view. Over the
 * example's record on e3 itself (#1376).
 */

import { afterEach, beforeEach, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, IntegerType, StringType, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Data, Sheet } from "@elaraai/e3-ui/internal";
import { RecordSlicesChromeType, RecordSliceWhereType, Reactive, Slice, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-records";
import type { E3Request } from "../e3-web.test-utils.js";
import { frameScrolls } from "./frame.test-utils.js";
import { act, settle, sheetHarness } from "./frame/harness.test-utils.js";
import { setSheetRowRenderProbe } from "./Rows.js";
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

test("the hit check: a segment whose rows disagree with where e3 placed the narrowing's is one failed run that says so, with a Retry — never a match the index does not hold — until the record moves and it is read again", async () => {
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
    // The first segment, from the first row: one failed run, said once in its first row in view with a Retry, and the
    // footer's line with why — the record changed (#1398, CL11). None of its rows is drawn — the one said Ready least
    // of all — and the count line is e3's count.
    expect(failed()!.dataset["failed"]).toBe("0");
    expect([...failed()!.querySelectorAll("[data-loading-failed-message]")].map((said) => said.textContent)).toEqual(["Couldn't read rows 1–1,144"]);
    expect(failed()!.querySelector("[data-loading-retry]")).not.toBeNull();
    const line = ui.container.querySelector('[data-frame-slot="footer"] [data-footer-line]')!;
    expect([line.hasAttribute("data-failed"), line.getAttribute("title")]).toEqual([true, "the record changed while they were read"]);
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

/** The flagged rows of the benchmark's record, drawn over it: a sheet whose rows source narrows them to the flag. */
const flaggedRows = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.let(Slice.bindRecords("test.lens.turns", {
        rows: {
            source: Data.bindPaged(ex.lensBenchRows, { indexes: [ex.lensBenchByGroup, ex.lensBenchByFlag] }),
            fields: { group: { label: "Group" }, flag: { label: "Flag" } }, initial: { flag: [true] },
        },
    }));
    return Sheet({ slice: { slice }, columns: { group: Sheet.column.integer(ex.LensBenchRow, { header: "Group" }) } });
}))) };

test("a view meeting more segments of matches than one turn of reads takes reads them all, a turn at a time, and draws every match — no band left reading", async () => {
    // A hundred thousand rows, one flagged every five thousand: a record segment holds at most 4,096 rows, so each of
    // the twenty flagged rows is in a segment of its own, and the view, two thousand pixels tall, meets every one.
    const BENCH = `records.${ex.lensBenchRows.name}`;
    const stored = new Map<string, ValueTypeOf<typeof ex.LensBenchRow>>();
    for (let i = 0; i < 100_000; i++) stored.set(`R${String(i).padStart(6, "0")}`, { group: BigInt(i % 10), flag: i % 5_000 === 0 });
    await h.patch(ex.lensBenchRows, stored);
    const placements = h.e3.answers((request) => request.kind === "place" && request.dataset === BENCH);
    const ui = await h.mount(flaggedRows, { storageKey: "sheet-lens-turns" });
    const rows = () => [...ui.container.querySelectorAll<HTMLElement>('[data-frame-slot="main"] [data-slot="row"][data-row-id]')];
    const flagged = Array.from({ length: 20 }, (_x, i) => i * 5_000);
    await waitFor(() => expect(rows().map((r) => r.dataset["rowId"])).toEqual(flagged.map((p) => `R${String(p).padStart(6, "0")}`)), { timeout: 20_000 });
    await settle();
    // Every match at its number, marked, and no band left reading: the segments past the first turn were read in the next.
    expect(rows().map((r) => r.querySelector('[data-slot="gutterNumber"]')!.textContent)).toEqual(flagged.map((p) => String(p + 1)));
    expect(rows().every((r) => r.querySelector('[data-slot="gutterNumber"]')!.hasAttribute("data-hit"))).toBe(true);
    expect(ui.container.querySelector('[data-frame-slot="main"] [data-slot="band"][data-band="reading"]')).toBeNull();
    expect(ui.container.querySelector('[data-slot="toolbarCount"]')?.textContent).toBe("20 matches");
    // e3 placed the matches in twenty segments: more than one turn reads.
    const segments = placements.flatMap((answer) => (JSON.parse(new TextDecoder().decode(answer.body)) as { segments: { rows: number }[] }).segments)
        .filter((segment) => segment.rows > 0);
    expect(segments.length).toBe(20);
    expect(segments.length).toBeGreaterThan(LENS_BUDGET);
    // No row asked of twice, and never the record whole, a row by its key or the narrowing's runs.
    const asked = h.requests("within", BENCH).map(keysOf);
    expect(new Set(asked.flat()).size).toBe(asked.flat().length);
    expect([h.requests("read", BENCH), h.requests("rows", BENCH), h.requests("runs", BENCH)]).toEqual([[], [], []]);
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
    await waitFor(() => expect(ui.row("JOB-10001")?.querySelector('[data-slot="cell"][data-selected]') ?? null).not.toBeNull(), { timeout: 5_000 });
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

/** The orders scheduled: every third, from the second. */
const SCHEDULED: Where = new Map([["status", variant("values", [printString("Scheduled")])]]);

/** The toolbar's Search Records box, the text typed into it a key at a time, and the lines its list shows. */
function searchRecords(container: HTMLElement) {
    const box = () => container.querySelector<HTMLElement>('[data-part="dataset-key-search"]')!;
    const input = () => box().querySelector<HTMLInputElement>("input")!;
    const type = async (text: string) => {
        for (const key of text) {
            const typed = input().value + key;
            await userEvent.type(input(), key);
            await waitFor(() => expect(input().value).toBe(typed));
        }
    };
    const clear = async () => { await act(async () => { fireEvent.click(box().querySelector("button[aria-label='Clear search']")!); }); };
    // The box's list: the listbox its input controls, its lines as they read.
    const lines = () => {
        const list = document.getElementById(input().getAttribute("aria-controls") ?? "");
        return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => option.textContent);
    };
    return { box, input, type, clear, lines };
}

test("Search Records lists the rows its key finds wherever they are — on screen, far off, and those the narrowing hides, marked — and takes the ring to a far one the narrowing holds (#1398, CL10)", async () => {
    const ui = await setup();
    await waitFor(() => expect(ui.ids().slice(0, 3)).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]));
    await settle();
    const search = searchRecords(ui.container);
    // On screen: the head of the thousand orders it finds, each a line — the ones Ready drawn, the others marked.
    await search.type("JOB-10");
    await waitFor(() => expect(search.box().textContent).toMatch(/1,000 matches/), { timeout: 5_000 });
    await waitFor(() => expect(search.lines().slice(0, 4)).toEqual(["JOB-10000", "JOB-10001 · hidden by the filters", "JOB-10002 · hidden by the filters", "JOB-10003"]), { timeout: 5_000 });
    expect(search.lines()).toHaveLength(20);
    // Far off, where the lens has read nothing: its lines all the same.
    await search.clear();
    await search.type("JOB-2");
    await waitFor(() => expect(search.box().textContent).toMatch(/10,000 matches/), { timeout: 5_000 });
    await waitFor(() => expect(search.lines().slice(0, 3)).toEqual(["JOB-20000 · hidden by the filters", "JOB-20001 · hidden by the filters", "JOB-20002"]), { timeout: 5_000 });
    // A far one the narrowing holds: the ring lands on it, at its number.
    await search.clear();
    await search.type("JOB-20002");
    await waitFor(() => expect(search.lines()).toEqual(["JOB-20002"]), { timeout: 5_000 });
    fireEvent.keyDown(search.input(), { key: "Enter" });
    await waitFor(() => expect(ui.row("JOB-20002")?.querySelector('[data-slot="cell"][data-selected]') ?? null).not.toBeNull(), { timeout: 10_000 });
    expect(ui.row("JOB-20002")!.querySelector('[data-slot="gutterNumber"]')!.textContent).toBe("10003");
    // Never the record whole.
    expect(h.requests("read", ORDERS)).toEqual([]);
});

/** Where the view rests as the sheet saved it, under its storage key: the row at its top, by its key, and the px into it. */
const restedAt = (): { key: string; offset: number } | undefined => {
    for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("sheet-lens-test")) continue;
        const stored = JSON.parse(localStorage.getItem(key)!) as { anchor?: { key: string; offset: number } | null };
        if (stored.anchor !== undefined && stored.anchor !== null) return { key: stored.anchor.key, offset: stored.anchor.offset };
    }
    return undefined;
};

test("a narrowing keeps the row at the top of the view where it was, by its key — drawn already, or read where it is — when the narrowing holds it, and else starts at the top (#1398, CL8)", async () => {
    const ui = await setup();
    await waitFor(() => expect(ui.ids().slice(0, 3)).toEqual(["JOB-10000", "JOB-10003", "JOB-10006"]));
    await settle();
    const frame = () => ui.main().querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
    /** Where a row is drawn among the rows: its virtual row's place. */
    const topOf = (id: string) => Number(/translateY\(([-\d.]+)px\)/.exec((ui.row(id)!.closest<HTMLElement>("[data-index]")!).style.transform)![1]);
    /** The view at rest with a row at its top, `px` into it. */
    const rest = async (id: string, px: number) => {
        await act(async () => { frame().scrollTop = topOf(id) + px; frame().dispatchEvent(new Event("scroll")); });
        await waitFor(() => expect(restedAt()).toEqual({ key: `row:${id}`, offset: px }), { timeout: 5_000 });
        await settle();
    };
    // JOB-10054 is Ready and of quantity 700: at the top, 5 px into it.
    await rest("JOB-10054", 5);
    await narrow(QUANTITY_700);
    await waitFor(() => expect(ui.ids().slice(0, 3)).toEqual(["JOB-10006", "JOB-10030", "JOB-10054"]));
    await settle();
    // Drawn already under the new narrowing: where it was, the px into it kept.
    await waitFor(() => expect(frame().scrollTop - topOf("JOB-10054")).toBe(5), { timeout: 5_000 });
    expect(restedAt()).toEqual({ key: "row:JOB-10054", offset: 5 });
    // Ready again holds it too: it stays where it was, the Ready row after it — of another quantity — drawn below it.
    await narrow(READY);
    await waitFor(() => expect(ui.ids()).toContain("JOB-10057"));
    await settle();
    await waitFor(() => expect(frame().scrollTop - topOf("JOB-10054")).toBe(5), { timeout: 5_000 });
    // Far down, where a new narrowing's lens reads nothing at first: JOB-35014 — Ready, of quantity 700 — sought and put
    // at the top, 7 px into it.
    const search = searchRecords(ui.container);
    await search.type("JOB-35014");
    await waitFor(() => expect(search.lines()).toEqual(["JOB-35014"]), { timeout: 5_000 });
    fireEvent.keyDown(search.input(), { key: "Enter" });
    await waitFor(() => expect(ui.row("JOB-35014")).not.toBeNull(), { timeout: 10_000 });
    await settle();
    await search.clear();
    await rest("JOB-35014", 7);
    const pages = h.requests("page", ORDERS).length;
    await narrow(QUANTITY_700);
    // The lens reads where the row is, and puts it back where it was.
    await waitFor(() => expect(ui.row("JOB-35014")).not.toBeNull(), { timeout: 10_000 });
    await settle();
    await waitFor(() => expect(frame().scrollTop - topOf("JOB-35014")).toBe(7), { timeout: 5_000 });
    expect(restedAt()).toEqual({ key: "row:JOB-35014", offset: 7 });
    expect(h.requests("page", ORDERS).length).toBeGreaterThan(pages);
    // A narrowing that does not hold it — the orders scheduled — starts at the top.
    await narrow(SCHEDULED);
    await waitFor(() => expect(ui.ids().slice(0, 2)).toEqual(["JOB-10001", "JOB-10004"]));
    await settle();
    await waitFor(() => expect(frame().scrollTop).toBe(0));
    expect(h.requests("read", ORDERS)).toEqual([]);
});

test("a window landing beside the rows in view draws none of them again: a landing draws only the rows it brings (#1398, CL9)", async () => {
    // The record's own rows, its All tab, read a segment at a time: every segment past the first held on the wire.
    const isLater = (request: E3Request) => request.kind === "page" && request.dataset === ORDERS && Number(request.query.get("offset") ?? 0) > 0;
    const later = h.e3.hold(isLater);
    const ui = await setup();
    fireEvent.mouseDown(ui.tab("all"), { button: 0 });
    await settle();
    await waitFor(() => expect(ui.ids().slice(0, 3)).toEqual(["JOB-10000", "JOB-10001", "JOB-10002"]));
    // Down to the first segment's last whole window — elements 800–999 — the window after it, which the second segment
    // holds, on the wire below them.
    const frame = ui.main().querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
    const rowPx = parseFloat(ui.row("JOB-10000")!.style.minHeight);
    await act(async () => { frame.scrollTop = 1000 * rowPx - 2000 + 3 * rowPx; frame.dispatchEvent(new Event("scroll")); });
    await waitFor(() => expect(ui.row("JOB-10999")).not.toBeNull(), { timeout: 10_000 });
    await later.holding;
    await settle();
    expect(ui.row("JOB-11000")).toBeNull();
    const drawn = new Set(ui.rows().map((row) => Number(row.getAttribute("data-row"))));
    const rendered: number[] = [];
    setSheetRowRenderProbe((r, copy) => { if (!copy) rendered.push(r); });
    try {
        const landed = h.e3.answers(isLater);
        await act(async () => { later.release(); });
        // The second segment lands, and the window below the rows in view with it: its rows join below them.
        await waitFor(() => expect(landed.length).toBeGreaterThan(0), { timeout: 10_000 });
        await waitFor(() => expect(ui.row("JOB-11000")).not.toBeNull(), { timeout: 10_000 });
        await settle();
        // None of the rows that were drawn is drawn again: the landing drew only the rows it brought.
        expect(drawn.size).toBeGreaterThan(0);
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.filter((r) => drawn.has(r))).toEqual([]);
    } finally {
        setSheetRowRenderProbe(undefined);
    }
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
