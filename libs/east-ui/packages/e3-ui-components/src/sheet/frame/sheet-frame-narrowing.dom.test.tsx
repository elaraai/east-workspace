/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet's narrowing (#1345): one rail over its `Slice.bindRecords`, each
 * source narrowing every place its records appear — the `rows` source the grid,
 * which draws its narrowing over the record's orders as the lens (#1349); each
 * templates list's source the Rows tab's cards of that list; an author's tab
 * the source it names — each tab counting what it shows and saying so when its
 * sources empty it, with their Clear filters; a saved view holding every
 * source's narrowing and restoring it; a draft the narrowing hides kept and
 * saved by its original key; the folds a view keeps (#857), over a record's
 * rows; and a sheet that opens on a view opening at the top of its narrowing,
 * over the stress sheet's two thousand jobs (#1349). Over the workshop's records on e3 itself (`harness.test-utils.tsx`,
 * #1376), the sheet in a Reactive root as a ui task draws it, the rail written
 * as its chips write it. That no function holds the whole slice is e3-ui's one
 * guard over every builder's examples (#1356). A filter change builds nothing
 * again: the sheet's body runs no more, and no payload is decoded (#1354).
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ArrayType, East, SortedMap, StringType, compareFor, equalFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Data, Record, Sheet } from "@elaraai/e3-ui/internal";
import { Reactive, RecordSlicesChromeType, Slice, State, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { act, programOf, settle, sheetHarness, slot, tabs } from "./harness.test-utils.js";
import { frameScrolls } from "../frame.test-utils.js";
import { countBuilds } from "../../shared/builds.test-utils.js";

/** A frame tall enough to draw every order of the workshop, its lines open, at once. */
const h = sheetHarness({ frame: 2000 });

/** The rail's key: the sheet's and the test's writes share it. */
const KEY = "sheet_narrowing_dom";
/** The orders' record, as its dataset's requests name it. */
const ORDERS = `records.${ex.sheetWorkshopOrders.name}`;
/** The orders' commits, newest first, by the mutation that made each. */
const commits = async () => (await h.history(ex.sheetWorkshopOrders)).commits.map((c) => c.mutation);
const print = printFor(StringType);
const stringEqual = equalFor(StringType);
type View = ValueTypeOf<typeof Sheet.Types.RecordView>;

/** The rail's sources: the orders — the sheet's rows — and the operation and order templates, each a record of its own. */
const sources = () => ({
    rows: {
        source: Data.bindPaged(ex.sheetWorkshopOrders, { indexes: [ex.sheetWorkshopOrdersByStatus] }), label: "Orders",
        fields: { status: { label: "Status", hints: ["PLANNED", "RELEASED", "ON HOLD"] } },
    },
    rowTemplates: {
        source: Data.bindPaged(ex.sheetWorkshopOperationTemplates, { indexes: [ex.sheetWorkshopOperationTemplatesByGroup] }), label: "Operation templates",
        fields: { group: { label: "Group", hints: ["Operations", "Dispatch"] } },
    },
    groupTemplates: {
        source: Data.bindPaged(ex.sheetWorkshopOrderTemplates, { indexes: [ex.sheetWorkshopOrderTemplatesByGroup] }), label: "Order templates",
        fields: { group: { label: "Group", hints: ["Orders"] } },
    },
});

/**
 * The workshop's orders under one rail, the two templates lists following its
 * sources and an author's tab of the operation templates following one — in
 * a Reactive root, as a ui task draws it. A narrowing written to the rail is
 * read where the rows are read: the grid draws its `rows` source's narrowing as
 * it stands over the orders, and nothing builds the sheet again (#1354).
 */
const sheet = (opts: { views?: readonly View[]; activeView?: string } = {}) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const orders = $.let(Record.bind(ex.sheetWorkshopOrders, [ex.sheetWorkshopOrdersPatch]));
    const operations = $.let(Data.bind(ex.sheetWorkshopOperationTemplates));
    const orderTemplates = $.let(Data.bind(ex.sheetWorkshopOrderTemplates));
    const views = $.let(State.bind([ArrayType(Sheet.Types.RecordView)], `${KEY}.views`, [...(opts.views ?? [])]));
    const slice = $.let(Slice.bindRecords(KEY, sources()));
    return Sheet({
        slice: { slice }, name: "narrowing", views, ...(opts.activeView === undefined ? {} : { activeView: some(opts.activeView) }),
        group: Sheet.group(ex.WorkshopOrder, "ops", { title: "name" }),
        columns: {
            activity: Sheet.column.text(ex.WorkshopOperation, { header: "Activity" }),
            notes: Sheet.column.text(ex.WorkshopOperation, { header: "Notes" }),
        },
        templates: [
            Sheet.templates(operations.read(), { name: (t) => t.name, group: (t) => some(t.group),
                values: (t) => Sheet.patch(ex.WorkshopOperation, { activity: t.activity }), source: "rowTemplates" }),
            Sheet.templates(orderTemplates.read(), { name: (t) => t.name, group: (t) => some(t.group),
                values: (t) => Sheet.patch(ex.WorkshopOrder, { status: "PLANNED", ops: t.ops }), source: "groupTemplates" }),
        ],
        library: [
            Sheet.library.rows(),
            Sheet.library.tab(operations.read(), { name: "Operations", key: (_t, k) => k, label: (t) => t.name, source: "rowTemplates" }),
        ],
        onApply: Record.onApply(orders, { keyed: true }),
    });
}))) });

/** The rail as a test writes it: the same sources under the sheet's key, each part's controls as the toolbar's chips use them. */
const rail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({ slice: Slice.bindRecords(KEY, sources()) }))),
    getRegisteredPlatformImplementations());
/** The rail's parts, bound once: a source's part by its name. */
function railParts() {
    const chrome = rail();
    return (source: string) => chrome.slice.parts.find((part) => stringEqual(part.source, source))!.slice;
}

/** The order bands the grid draws, by key, in order. */
const bands = (container: HTMLElement) => [...slot(container, "main")!.querySelectorAll<HTMLElement>('[data-slot="row"][data-band-row]')].map((band) => band.dataset["rowId"]);
/** An order's band. */
const band = (container: HTMLElement, id: string) => slot(container, "main")!.querySelector<HTMLElement>(`[data-slot="row"][data-band-row][data-row-id="${id}"]`);
/** The library's tabs, as they read: each name and its count. */
const libraryTabs = (container: HTMLElement) => tabs(slot(container, "start")!);
/** The library's open panel. */
const panel = (container: HTMLElement) => slot(container, "start")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
/** The open panel's cards' names, in order. */
const cardNames = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")]
    .map((card) => [...card.children].find((el) => el.tagName === "DIV" && el.querySelector(":scope > svg") === null)!.children[0]!.textContent);

/** Opens a library tab, by its name. */
async function openTab(container: HTMLElement, name: string) {
    const tab = [...slot(container, "start")!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    fireEvent.click(tab);
    await settle();
}

/** A view tab of the toolbar's, by its id. */
const viewTab = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-slot="tab"][data-tab="${id}"]`)!;

test("a record-bound Sheet draws its `rows` source's narrowing over the orders as the lens, a filtered spreadsheet: the matching orders alone, one after another at their numbers, their lines marked, nothing between them, and the count line the matches (#1345, #1349)", async () => {
    const { container } = await h.mount(sheet());
    const part = railParts();
    const main = () => slot(container, "main")!;
    const root = () => main().querySelector<HTMLElement>("[data-sheet]")!;
    const number = (id: string) => band(container, id)!.querySelector('[data-slot="gutterNumber"]')!.textContent;
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2201"));
    // Nothing narrows the orders: no lens, and no count line.
    expect(root().hasAttribute("data-lens")).toBe(false);
    expect(container.querySelector('[data-slot="toolbarCount"]')).toBeNull();
    await act(async () => { part("rows").choose("status", [print("ON HOLD")]); });
    await waitFor(() => expect(bands(container)).toEqual(["WO-2204"]));
    expect(root().hasAttribute("data-lens")).toBe(true);
    expect(container.querySelector('[data-slot="toolbarCount"]')!.textContent).toBe("1 match");
    // The match keeps its number, the fourth order's; nothing stands for the orders the narrowing leaves out.
    expect(number("WO-2204")).toBe("4");
    expect(main().querySelectorAll('[data-slot="band"]')).toHaveLength(0);
    // Its lines are the matching order's alone, each marked a match.
    const lines = [...main().querySelectorAll<HTMLElement>('[data-slot="row"][data-group-id]')];
    expect(new Set(lines.map((line) => line.dataset["groupId"]))).toEqual(new Set(["WO-2204"]));
    expect(lines.every((line) => line.querySelector('[data-slot="gutterNumber"]')!.hasAttribute("data-hit"))).toBe(true);
    // The toolbar offers no control over the lens: no rows shown beside the matches.
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    // Two statuses: their orders one after another, each at its own number.
    await act(async () => { part("rows").choose("status", [print("ON HOLD"), print("PLANNED")]); });
    await waitFor(() => expect(bands(container)).toEqual(["WO-2202", "WO-2203", "WO-2204", "WO-2205", "WO-2206"]));
    expect(["WO-2202", "WO-2203", "WO-2204", "WO-2205", "WO-2206"].map(number)).toEqual(["2", "3", "4", "5", "6"]);
    expect(container.querySelector('[data-slot="toolbarCount"]')!.textContent).toBe("5 matches");
    expect(main().querySelectorAll('[data-slot="band"]')).toHaveLength(0);
    // Cleared: every order, no lens.
    await act(async () => { part("rows").clearAll(); });
    await waitFor(() => expect(bands(container)).toEqual(["WO-2201", "WO-2202", "WO-2203", "WO-2204", "WO-2205", "WO-2206"]));
    expect(root().hasAttribute("data-lens")).toBe(false);
});

test("each source filters only its own places: the templates' sources the Rows tab's cards of their lists and the tab that names one, the `rows` source the grid (#1345)", async () => {
    const { container } = await h.mount(sheet());
    const part = railParts();
    await waitFor(() => expect(libraryTabs(container)).toEqual(["Rows 11", "Operations 8"]));
    await act(async () => { part("rowTemplates").choose("group", [print("Dispatch")]); });
    await waitFor(() => expect(libraryTabs(container)).toEqual(["Rows 5 of 11", "Operations 2 of 8"]));
    await openTab(container, "Rows");
    // The operation templates the source shows, and every order template: their source narrows nothing.
    expect(cardNames(container)).toEqual(["Delivery", "Wrapping", "Kitchen order", "Vanity unit", "Wardrobe order"]);
    await openTab(container, "Operations");
    expect(cardNames(container)).toEqual(["Delivery", "Wrapping"]);
    // The grid is the `rows` source's alone, and the rows source narrows nothing in the library.
    expect(bands(container)[0]).toBe("WO-2201");
    await act(async () => { part("rows").choose("status", [print("PLANNED")]); });
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2202"));
    expect(bands(container)).not.toContain("WO-2201");
    expect(libraryTabs(container)).toEqual(["Rows 5 of 11", "Operations 2 of 8"]);
});

test("a tab its sources empty says so, with Clear filters for those sources alone; one that empties some of its lists says so above the rest (#1345)", async () => {
    const { container } = await h.mount(sheet());
    const part = railParts();
    await waitFor(() => expect(libraryTabs(container)).toEqual(["Rows 11", "Operations 8"]));
    await openTab(container, "Rows");
    await act(async () => {
        part("rows").choose("status", [print("PLANNED")]);
        part("rowTemplates").choose("group", [print("Nowhere")]);
    });
    // No operation template shows: the tab says so above the order templates, whose source narrows nothing.
    await waitFor(() => expect(libraryTabs(container)).toEqual(["Rows 3 of 11", "Operations 0 of 8"]));
    const said = panel(container).querySelector<HTMLElement>("[data-library-empty]")!;
    expect(within(said).getByText("No templates match the filters")).toBeTruthy();
    expect(cardNames(container)).toEqual(["Kitchen order", "Vanity unit", "Wardrobe order"]);
    // Both lists emptied: the tab is.
    await act(async () => { part("groupTemplates").choose("group", [print("Nowhere")]); });
    await waitFor(() => expect(libraryTabs(container)[0]).toBe("Rows 0 of 11"));
    expect(cardNames(container)).toEqual([]);
    await act(async () => { fireEvent.click(within(panel(container).querySelector<HTMLElement>("[data-library-empty]")!).getByRole("button", { name: "Clear filters" })); });
    await settle();
    await waitFor(() => expect(libraryTabs(container)).toEqual(["Rows 11", "Operations 8"]));
    // Its sources' choices cleared; the rows source keeps its own.
    expect([part("rowTemplates").read().where.size, part("groupTemplates").read().where.size, part("rows").read().where.size]).toEqual([0, 0, 1]);
    expect(bands(container)[0]).toBe("WO-2202");
});

test("a saved view holds every source's narrowing, and restores it: the rows the grid shows, and the Rows tab's cards; the narrowing moved off it, its tab is dirty (#1345)", async () => {
    const { container } = await h.mount(sheet());
    const part = railParts();
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2201"));
    await act(async () => {
        part("rows").choose("status", [print("PLANNED")]);
        part("rowTemplates").choose("group", [print("Dispatch")]);
    });
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2202"));
    // + TAB snapshots the narrowing — both sources'.
    fireEvent.mouseDown(container.querySelector('[data-slot="tabAdd"]')!, { button: 0 });
    await settle();
    expect(viewTab(container, "view-1").hasAttribute("data-active")).toBe(true);
    await waitFor(() => expect(viewTab(container, "view-1").querySelector('[data-slot="tabCount"]')!.textContent).toBe("4"));
    // The whole sheet clears every source.
    fireEvent.mouseDown(viewTab(container, "all"), { button: 0 });
    await settle();
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2201"));
    expect([part("rows").read().where.size, part("rowTemplates").read().where.size]).toEqual([0, 0]);
    await waitFor(() => expect(libraryTabs(container)[0]).toBe("Rows 11"));
    // The view again: every source's narrowing comes back.
    fireEvent.mouseDown(viewTab(container, "view-1"), { button: 0 });
    await settle();
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2202"));
    await waitFor(() => expect(libraryTabs(container)[0]).toBe("Rows 5 of 11"));
    expect(viewTab(container, "view-1").hasAttribute("data-dirty")).toBe(false);
    // Another status chosen on the rail: the view no longer holds the narrowing, and its tab says so.
    await act(async () => { part("rows").choose("status", [print("RELEASED")]); });
    await waitFor(() => expect(viewTab(container, "view-1").hasAttribute("data-dirty")).toBe(true));
    await waitFor(() => expect(bands(container)).toEqual(["WO-2201"]));
});

test("a draft the narrowing hides is kept, and saved by its original key (#1345)", async () => {
    const { container, getByRole } = await h.mount(sheet());
    const part = railParts();
    const deployed = await commits();
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2201"));
    // WO-2201's first line: its notes typed.
    fireEvent.doubleClick(slot(container, "main")!.querySelector('[data-slot="row"][data-group-id="WO-2201"][data-line="0"] [data-key="notes"]')!);
    await settle();
    fireEvent.input(container.querySelector('[data-slot="editorInput"]')!, { target: { value: "Rush" } });
    await settle();
    fireEvent.keyDown(container.querySelector('[data-slot="editorInput"]')!, { key: "Enter" });
    await settle();
    // The rail hides it: WO-2201 is RELEASED. Its draft stays.
    await act(async () => { part("rows").choose("status", [print("PLANNED")]); });
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2202"));
    expect(bands(container)).not.toContain("WO-2201");
    const save = getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.mouseDown(save, { button: 0 });
    fireEvent.click(save);
    await waitFor(() => expect((getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true));
    await settle();
    // Saved by its key: one patch, the hidden order's line as it was typed.
    const stored = await h.read(ex.sheetWorkshopOrders);
    expect(stored.get("WO-2201")!.ops[0]!.notes).toBe("Rush");
    expect(await commits()).toEqual(["patch", ...deployed]);
});

test("folds left on a view come back when the sheet opens on it again (#857)", async () => {
    const planned: View = {
        id: "planned", name: "PLANNED", folds: new Map(),
        narrowing: new SortedMap([["rows", { where: new Map([["status", variant("values", [print("PLANNED")])]]), preset: none, resolution: none }]], compareFor(StringType)),
    };
    let ui = await h.mount(sheet({ views: [planned], activeView: "planned" }));
    const view = () => ui.container.querySelector("[data-sheet]")!.getAttribute("data-view");
    await waitFor(() => expect(view()).toBe("planned"));
    await waitFor(() => expect(band(ui.container, "WO-2202")).not.toBeNull());
    expect(band(ui.container, "WO-2202")!.hasAttribute("data-folded")).toBe(false);
    // WO-2202 folds on the view, and the sheet goes before the view is ever left.
    fireEvent.mouseDown(band(ui.container, "WO-2202")!.querySelector('[data-slot="fold"]')!, { button: 0 });
    expect(band(ui.container, "WO-2202")!.hasAttribute("data-folded")).toBe(true);
    ui.unmount();
    ui = await h.mount(sheet({ views: [planned], activeView: "planned" }));
    await waitFor(() => expect(view()).toBe("planned"));
    await waitFor(() => expect(band(ui.container, "WO-2202")?.hasAttribute("data-folded")).toBe(true));
});

test("a sheet that opens on a saved view opens at the top of its narrowing, never at the end of the band the lens draws there before it has read the rows (#1349)", async () => {
    const restore = frameScrolls();
    try {
        // The stress sheet opens on its SPRAYING view. Its first rows are the record's first Spraying jobs, one after
        // another in the record's order: its keys'.
        const jobs = await h.read(ex.sheetStressJobs);
        const keys = [...jobs.keys()].sort(compareFor(StringType));
        const top = keys.filter((key) => stringEqual(jobs.get(key)!.activity, "Spraying")).slice(0, 3);
        expect(top).toHaveLength(3);
        const { container } = await h.mount(ex.sheetStress, { storageKey: "sheet-stress-open" });
        const main = () => slot(container, "main")!;
        const ids = () => [...main().querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')].map((row) => row.dataset["rowId"]);
        await waitFor(() => expect(main().querySelector("[data-sheet]")!.getAttribute("data-view")).toBe("spraying"));
        await waitFor(() => expect(ids().slice(0, top.length)).toEqual(top));
        await settle();
        // At the top: the lens's first layout, a band where its rows were still to be read, far taller than the frame,
        // never scrolled to its end.
        expect(main().querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!.scrollTop).toBe(0);
        expect(ids().slice(0, top.length)).toEqual(top);
    } finally {
        restore();
    }
});

test("a choice on the rail builds the sheet no more: the grid's rows and the Rows tab's cards follow it over the payload it mounted with (#1354)", async () => {
    const builds = countBuilds("Sheet", programOf(sheet()));
    try {
        const { container } = await h.mount(sheet(), { program: builds.program });
        const part = railParts();
        await waitFor(() => expect(libraryTabs(container)).toEqual(["Rows 11", "Operations 8"]));
        await waitFor(() => expect(bands(container)[0]).toBe("WO-2201"));
        const mounted = [builds.runs, builds.decodes];
        expect(Math.min(...mounted)).toBeGreaterThan(0);
        await act(async () => { part("rows").choose("status", [print("ON HOLD")]); });
        await waitFor(() => expect(bands(container)).toEqual(["WO-2204"]));
        await act(async () => { part("rowTemplates").choose("group", [print("Dispatch")]); });
        await waitFor(() => expect(libraryTabs(container)).toEqual(["Rows 5 of 11", "Operations 2 of 8"]));
        await act(async () => { part("rows").clearAll(); });
        await waitFor(() => expect(bands(container)[0]).toBe("WO-2201"));
        expect([builds.runs, builds.decodes], "no choice runs the body again or decodes a payload").toEqual(mounted);
    } finally {
        builds.restore();
    }
});

test("a choice keeps the rows on screen, the grid busy and the footer saying so, until the lens has read the narrowing's rows near the view; then its rows (#1354, #1349, #1398)", async () => {
    const { container } = await h.mount(sheet());
    const part = railParts();
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2201"));
    const main = () => slot(container, "main")!;
    const line = () => slot(container, "footer")!.querySelector<HTMLElement>("[data-footer-line]")!;
    const shown = bands(container);
    // Every read of which orders a narrowing holds, held on its way to e3 from now until let land.
    const windows = h.e3.hold((request) => request.kind === "within" && request.dataset === ORDERS);
    await act(async () => { part("rows").choose("status", [print("ON HOLD")]); });
    await settle();
    // The lens's read of which orders near the view the narrowing holds is on the wire: the last rows stand in,
    // and the frame's main, which they are in, says it is busy — the frame live, nothing covering it.
    expect(windows.held).toBeGreaterThan(0);
    expect(bands(container)).toEqual(shown);
    expect(main().getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[data-builder-frame][aria-busy="true"]')).toBeNull();
    // Once the wait passes its reveal, the footer's loading line says what is read, in what the rail counts the rows in (CL3).
    await waitFor(() => expect(line().querySelector("[data-line-text]")?.textContent).toBe("Filtering orders…"));
    await act(async () => { windows.release(); });
    await waitFor(() => expect(bands(container)).toEqual(["WO-2204"]));
    await waitFor(() => expect(main().getAttribute("aria-busy")).toBe("false"));
    // The line goes once its hold is over: nothing is in flight.
    await waitFor(() => expect(line().hasAttribute("data-idle")).toBe(true));
});
