/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Sheet's narrowing (#1345): one rail over its `Slice.bindRecords`, each
 * source filtering every place its records appear — the `rows` source the
 * grid, which pages what it narrows to; each templates list's source the Rows
 * tab's cards of that list; an author's tab the source it names — each tab
 * counting what it shows and saying so when its sources empty it, with their
 * Clear filters; a saved view holding every source's narrowing and restoring
 * it; a draft the narrowing hides kept and saved by its original key; the
 * folds a view keeps (#857), over a record's rows; and the lens switched off
 * until #1349. Over the workshop's records in memory and their paging service
 * (`harness.test-utils.tsx`), the sheet in a Reactive root as a ui task draws
 * it, the rail written as its chips write it.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ArrayType, East, SortedMap, StringType, compareFor, decodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Data, Record, Sheet } from "@elaraai/e3-ui/internal";
import { Reactive, RecordSlicesChromeType, Slice, State, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { WORKSPACE, act, mount, settle, sheetHarness, slot, tabs } from "./harness.test-utils.js";

const harness = sheetHarness();

/** The rail's key: the sheet's and the test's writes share it. */
const KEY = "sheet_narrowing_dom";
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
 * a Reactive root, so a narrowing written to the rail builds the sheet again
 * over the rows its `rows` source pages now.
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

test("a record-bound Sheet narrowed by its `rows` source shows no lens controls and lists only the rows it narrows to (#1345, #1349)", async () => {
    const { container } = mount(sheet());
    const part = railParts();
    await waitFor(() => expect(bands(container)[0]).toBe("WO-2201"));
    await act(async () => { part("rows").choose("status", [print("ON HOLD")]); });
    await waitFor(() => expect(bands(container)).toEqual(["WO-2204"]));
    // No lens: no context switch, no count line, no band standing for the rows the narrowing leaves out.
    expect(slot(container, "main")!.querySelector("[data-sheet]")!.hasAttribute("data-lens")).toBe(false);
    expect(container.querySelector('[data-slot="contextSwitch"], [data-slot="contextOption"], [data-slot="toolbarCount"]')).toBeNull();
    expect(container.querySelector('[data-slot="band"]')).toBeNull();
    // Its lines are the matching order's alone, numbered as its own.
    const lines = [...slot(container, "main")!.querySelectorAll<HTMLElement>('[data-slot="row"][data-group-id]')];
    expect(new Set(lines.map((line) => line.dataset["groupId"]))).toEqual(new Set(["WO-2204"]));
});

test("each source filters only its own places: the templates' sources the Rows tab's cards of their lists and the tab that names one, the `rows` source the grid (#1345)", async () => {
    const { container } = mount(sheet());
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
    const { container } = mount(sheet());
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
    const { container } = mount(sheet());
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
    const { container, getByRole } = mount(sheet());
    const part = railParts();
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
    const stored = decodeBeast2For(ex.sheetWorkshopOrders.type)(harness.cache.read(WORKSPACE, ex.sheetWorkshopOrders.path)!);
    expect(stored.get("WO-2201")!.ops[0]!.notes).toBe("Rush");
    const { commits } = await harness.memory.history(WORKSPACE, ex.sheetWorkshopOrders.name, undefined);
    expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
});

test("folds left on a view come back when the sheet opens on it again (#857)", async () => {
    const planned: View = {
        id: "planned", name: "PLANNED", context: 0n, reveals: [], folds: new Map(),
        narrowing: new SortedMap([["rows", { where: new Map([["status", variant("values", [print("PLANNED")])]]), preset: none, resolution: none }]], compareFor(StringType)),
    };
    let ui = mount(sheet({ views: [planned], activeView: "planned" }));
    const view = () => ui.container.querySelector("[data-sheet]")!.getAttribute("data-view");
    await waitFor(() => expect(view()).toBe("planned"));
    await waitFor(() => expect(band(ui.container, "WO-2202")).not.toBeNull());
    expect(band(ui.container, "WO-2202")!.hasAttribute("data-folded")).toBe(false);
    // WO-2202 folds on the view, and the sheet goes before the view is ever left.
    fireEvent.mouseDown(band(ui.container, "WO-2202")!.querySelector('[data-slot="fold"]')!, { button: 0 });
    expect(band(ui.container, "WO-2202")!.hasAttribute("data-folded")).toBe(true);
    ui.unmount();
    ui = mount(sheet({ views: [planned], activeView: "planned" }));
    await waitFor(() => expect(view()).toBe("planned"));
    await waitFor(() => expect(band(ui.container, "WO-2202")?.hasAttribute("data-folded")).toBe(true));
});
