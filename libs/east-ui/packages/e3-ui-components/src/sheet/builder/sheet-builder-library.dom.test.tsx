/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet.Builder>`'s library pane (#1186, `Sheet Builder Spec.md` §8,
 * SB32, SB33, SB36, SB37, SB59, SB60), over the builder's examples and their
 * seeded records (`builder.test-utils.tsx`): the tabs the author's `library`
 * lists, in its order, each with its count, and no pane when it lists none;
 * the rail's count; the Rows tab's templates by group with what they set; an
 * author's tab's cards — label, meta, icon and group — its search, and a
 * click selecting a card; the columns with their kind and eye, a column
 * hidden and shown, kept per viewer across a remount and still matched by the
 * lens; and the empty states.
 */

import { test, expect } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ArrayType, East, StringType, StructType, some } from "@elaraai/east";
import { Record, Sheet, SheetBuilderPayloadType } from "@elaraai/e3-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-builder";
import { builderHarness, mount, mountPayload, settle, slot, tabs, type Payload } from "./builder.test-utils.js";

builderHarness();

/** A crew, for an author's tab. */
const Crew = StructType({ code: StringType, name: StringType, skill: StringType, team: StringType });

/** The crews, for an author's tab. */
const CREWS = [
    { code: "C1", name: "Bench crew", skill: "assembly", team: "Shop floor" },
    { code: "C2", name: "Finishing crew", skill: "spraying", team: "Finishing room" },
    { code: "C3", name: "Fitting crew", skill: "installing", team: "Shop floor" },
];
/** The jobs builder's one column. */
const TASK = { task: Sheet.column.text(ex.BuilderJob, { header: "Task" }) };

/** The jobs builder with a library of the templates, the crews — an author's tab whose card dropped on a job names its task — and the columns. */
const crewsPayload = East.compile(East.function([], SheetBuilderPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
    const crews = $.let(CREWS, ArrayType(Crew));
    return Sheet.BuilderPayload({ record: jobs, columns: TASK, id: "crews", library: [
        Sheet.library.rows(),
        Sheet.library.tab(crews, { name: "Crews", icon: "users", key: c => c.code, label: c => c.name, meta: c => some(c.skill), group: c => c.team,
            drop: c => Sheet.patch(ex.BuilderJob, { task: c.name }) }),
        Sheet.library.columns(),
    ] });
}), getRegisteredPlatformImplementations()) as unknown as () => Payload;
/** The jobs builder with a library of the columns alone. */
const columnsPayload = East.compile(East.function([], SheetBuilderPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
    return Sheet.BuilderPayload({ record: jobs, columns: TASK, id: "crews", library: [Sheet.library.columns()] });
}), getRegisteredPlatformImplementations()) as unknown as () => Payload;
/** The jobs builder with an author's tab with no rows, listed first, then no templates and the columns. */
const emptyPayload = East.compile(East.function([], SheetBuilderPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
    const crews = $.let([], ArrayType(Crew));
    return Sheet.BuilderPayload({ record: jobs, columns: TASK, id: "crews", library: [
        Sheet.library.tab(crews, { name: "Crews", key: c => c.code, label: c => c.name }), Sheet.library.rows(), Sheet.library.columns(),
    ] });
}), getRegisteredPlatformImplementations()) as unknown as () => Payload;

/** The library pane. */
const pane = (container: HTMLElement) => slot(container, "start")!;

/** Opens a library tab, by its name. */
async function openTab(container: HTMLElement, name: string) {
    const tab = [...pane(container).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    fireEvent.click(tab);
    await settle();
}

/** The open tab's panel. */
const panel = (container: HTMLElement) => pane(container).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** A panel's group heads: each label and its count. */
const heads = (container: HTMLElement) => [...panel(container).querySelectorAll("[data-library-head]")]
    .map((head) => [head.children[0]!.textContent, head.children[1]!.textContent]);

/** A card's body: its name and the line under it — the card's block that is not its icon tile. */
const bodyOf = (card: HTMLElement) => [...card.children].find((el) => el.tagName === "DIV" && el.querySelector(":scope > svg") === null)!;

/** A panel's cards, in order: each card's name, the line under it, and what trails it — its tag, or its glyph's words. */
const cards = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")].map((card) => {
    const body = bodyOf(card);
    const trailing = card.querySelector(":scope > div:last-child:not(:first-of-type)");
    const trail = trailing === null || trailing === body ? null : [...trailing.children].map((el) => el.getAttribute("aria-label") ?? el.textContent).join(" ");
    return [body.children[0]!.textContent, body.children[1]?.textContent ?? null, trail];
});

/** A card of the open tab, by its name. */
const cardNamed = (container: HTMLElement, name: string) => {
    const card = [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")]
        .find((c) => bodyOf(c).children[0]!.textContent === name);
    if (card === undefined) throw new Error(`no card ${name}`);
    return card;
};

/** Types in the open tab's search. */
async function search(container: HTMLElement, text: string) {
    await act(async () => { fireEvent.change(within(panel(container)).getByRole("textbox", { name: "Search library" }), { target: { value: text } }); });
}

/** The open tab's empty state: its title and the line under it, or `null` while cards show. */
const emptyState = (container: HTMLElement) => {
    const empty = panel(container).querySelector<HTMLElement>("[data-library-empty]");
    if (empty === null) return null;
    const title = within(empty).getByRole("heading");
    return [title.textContent, title.nextElementSibling?.textContent ?? null];
};

/** The columns the grid draws, by their header cells' keys. */
const headerKeys = (container: HTMLElement) => [...slot(container, "main")!.querySelectorAll<HTMLElement>('[data-slot="headerCell"]')].map((cell) => cell.dataset["key"]);

test("the library holds the tabs `library` lists, in its order, each with its count; collapsed, it is a rail with the templates' count (SB32)", async () => {
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    // Eleven templates; three statuses; six columns.
    expect(tabs(pane(container))).toEqual(["Rows 11", "Statuses 3", "Columns 6"]);
    fireEvent.click(within(pane(container)).getByRole("button", { name: "Collapse Library" }));
    await settle();
    expect(pane(container).hasAttribute("data-collapsed")).toBe(true);
    expect(within(pane(container)).getByText("11")).toBeTruthy();
});

test("a builder whose library lists no tab has no library pane (SB59)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    expect(container.querySelector("[data-builder-frame]")).not.toBeNull();
    expect(slot(container, "start")).toBeNull();
    // Main and the inspector are where they were.
    expect(slot(container, "main")!.querySelector('[data-sheet] [role="grid"]')).not.toBeNull();
    expect(tabs(slot(container, "end")!)).toEqual(["Details", "Issues 0"]);
});

test("without a Rows tab, the rail counts the first tab's cards", async () => {
    const { container } = mountPayload(columnsPayload());
    await settle();
    expect(tabs(pane(container))).toEqual(["Columns 1"]);
    fireEvent.click(within(pane(container)).getByRole("button", { name: "Collapse Library" }));
    await settle();
    expect(within(pane(container)).getByText("1")).toBeTruthy();
});

test("Rows lists the templates by group: each its name, and what it sets as the columns print it, or a group template's band cells and lines (SB33)", async () => {
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    await openTab(container, "Rows");
    expect(heads(container)).toEqual([["Operations", "6"], ["Dispatch", "2"], ["Orders", "3"]]);
    expect(cards(container)).toEqual([
        ["Panel cutting", "Panel cutting · 1 × beam saw", null],
        ["Edge banding", "Edge banding · 1 × edge bander", null],
        ["CNC routing", "CNC routing · 1 × CNC router", null],
        ["Sanding", "Sanding", null],
        ["Spray finish", "Spray finish · 1 × spray booth", null],
        ["Assembly", "Assembly", null],
        ["Wrapping", "Wrapping", null],
        ["Delivery", "Delivery", null],
        ["Kitchen order", "PLANNED · 4 lines", null],
        ["Wardrobe order", "PLANNED · 4 lines", null],
        ["Vanity unit", "PLANNED · 4 lines", null],
    ]);
    // The search reads a card's name, its group and what it sets.
    await search(container, "booth");
    expect(cards(container).map(([name]) => name)).toEqual(["Spray finish"]);
    await search(container, "dispatch");
    expect(cards(container).map(([name]) => name)).toEqual(["Wrapping", "Delivery"]);
});

test("an author's tab lists one card per row — its label, its meta, the tab's icon — grouped by its group (SB60)", async () => {
    const { container } = mountPayload(crewsPayload());
    await settle();
    expect(tabs(pane(container))).toEqual(["Rows 0", "Crews 3", "Columns 1"]);
    await openTab(container, "Crews");
    expect(heads(container)).toEqual([["Shop floor", "2"], ["Finishing room", "1"]]);
    expect(cards(container)).toEqual([
        ["Bench crew", "assembly", null],
        ["Fitting crew", "installing", null],
        ["Finishing crew", "spraying", null],
    ]);
    // Each card wears the tab's icon.
    expect(cardNamed(container, "Bench crew").querySelector('svg[data-icon="users"]')).not.toBeNull();
    // The workshop's statuses: a card per status, nothing under its name.
    cleanup();
    const workshop = mount(ex.sheetBuilderWorkshop);
    await settle();
    await openTab(workshop.container, "Statuses");
    expect(cards(workshop.container)).toEqual([["PLANNED", null, null], ["RELEASED", null, null], ["ON HOLD", null, null]]);
});

test("an author's tab's search reads each card's key, label and meta", async () => {
    const { container } = mountPayload(crewsPayload());
    await settle();
    await openTab(container, "Crews");
    await search(container, "spray");
    expect(cards(container).map(([name]) => name)).toEqual(["Finishing crew"]);
    await search(container, "c3");
    expect(cards(container).map(([name]) => name)).toEqual(["Fitting crew"]);
    await search(container, "bench");
    expect(cards(container).map(([name]) => name)).toEqual(["Bench crew"]);
});

test("a click on an author's card selects it, a click on another moves the selection, and a click on the selected card lets it go (SB60)", async () => {
    const { container } = mountPayload(crewsPayload());
    await settle();
    await openTab(container, "Crews");
    const placed = () => ["Bench crew", "Fitting crew", "Finishing crew"].map((name) => cardNamed(container, name).hasAttribute("data-placed"));
    fireEvent.click(cardNamed(container, "Bench crew"));
    await settle();
    expect(placed()).toEqual([true, false, false]);
    fireEvent.click(cardNamed(container, "Finishing crew"));
    await settle();
    expect(placed()).toEqual([false, false, true]);
    fireEvent.click(cardNamed(container, "Finishing crew"));
    await settle();
    expect(panel(container).querySelector("[data-placed]")).toBeNull();
});

test("Columns lists the columns in order with their kind and an eye; a hidden column leaves the grid with the band cells under it, and stays hidden for the viewer (SB36)", async () => {
    const first = mount(ex.sheetBuilderWorkshop);
    await settle();
    await openTab(first.container, "Columns");
    expect(cards(first.container)).toEqual([
        ["Activity", "lookup", "Shown — click to hide"],
        ["Start", "date", "Shown — click to hide"],
        ["End", "date", "Shown — click to hide"],
        ["Qty", "quantity", "Shown — click to hide"],
        ["Work centres", "link", "Shown — click to hide"],
        ["Notes", "text", "Shown — click to hide"],
    ]);
    const bandCells = (container: HTMLElement) => slot(container, "main")!.querySelectorAll('[data-slot="groupSummary"] [data-slot="cell"][data-key="end"]').length;
    expect(bandCells(first.container)).toBeGreaterThan(0);
    // The due date rides under End: hiding End takes the column and its band cells out of the grid.
    fireEvent.click(cardNamed(first.container, "End"));
    await settle();
    expect(headerKeys(first.container)).toEqual(["activity", "start", "qty", "machines", "notes"]);
    expect(bandCells(first.container)).toBe(0);
    const end = cardNamed(first.container, "End");
    expect(end.hasAttribute("data-filtered")).toBe(true);
    expect(end.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Hidden — click to show");
    expect(localStorage.getItem("sheet.builder.workshop.columns")).toBe(JSON.stringify(["end"]));
    first.unmount();

    // Kept for the viewer, under the builder's id.
    const again = mount(ex.sheetBuilderWorkshop);
    await settle();
    expect(headerKeys(again.container)).toEqual(["activity", "start", "qty", "machines", "notes"]);
    await openTab(again.container, "Columns");
    fireEvent.click(cardNamed(again.container, "End"));
    await settle();
    expect(headerKeys(again.container)).toEqual(["activity", "start", "end", "qty", "machines", "notes"]);
    expect(bandCells(again.container)).toBeGreaterThan(0);
    expect(localStorage.getItem("sheet.builder.workshop.columns")).toBe(JSON.stringify([]));
});

test("a hidden column is still what the lens matches: hiding Activity, the slice's search still narrows to its rows (SB36)", async () => {
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    await openTab(container, "Columns");
    fireEvent.click(cardNamed(container, "Activity"));
    await settle();
    expect(headerKeys(container)).not.toContain("activity");
    // The slice's search, in the frame's toolbar — ⌘F in the grid opens it — narrows to the four orders that band their edges.
    const grid = slot(container, "main")!.querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    fireEvent.keyDown(grid, { key: "f", metaKey: true });
    await settle();
    const searchBox = document.activeElement as HTMLInputElement;
    expect(slot(container, "toolbar")!.contains(searchBox)).toBe(true);
    await act(async () => { fireEvent.change(searchBox, { target: { value: "Edge banding" } }); });
    fireEvent.keyDown(searchBox, { key: "Enter" });
    await settle();
    expect(slot(container, "toolbar")!.querySelector('[data-slot="toolbarCount"]')!.textContent).toBe("4 matches");
    expect(slot(container, "main")!.querySelectorAll('[data-slot="gutterNumber"][data-hit]')).toHaveLength(4);
});

test("the last column shown stays, and its eye says so (SB36)", async () => {
    const { container } = mountPayload(crewsPayload());
    await settle();
    await openTab(container, "Columns");
    expect(cards(container)).toEqual([["Task", "text", "Shown — the last column shown stays"]]);
    fireEvent.click(cardNamed(container, "Task"));
    await settle();
    expect(headerKeys(container)).toEqual(["task"]);
    expect(cardNamed(container, "Task").hasAttribute("data-filtered")).toBe(false);
    expect(localStorage.getItem("sheet.builder.crews.columns")).toBe(JSON.stringify([]));
});

test("a store holding something other than a list of keys hides nothing", async () => {
    localStorage.setItem("sheet.builder.workshop.columns", JSON.stringify({ end: true }));
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    expect(headerKeys(container)).toEqual(["activity", "start", "end", "qty", "machines", "notes"]);
    cleanup();
    localStorage.setItem("sheet.builder.workshop.columns", JSON.stringify(["notes", 7, "end"]));
    const listed = mount(ex.sheetBuilderWorkshop);
    await settle();
    expect(headerKeys(listed.container)).toEqual(["activity", "start", "qty", "machines"]);
});

test("an empty tab says so: No templates, Nothing in an author's tab, or No matches naming the search (SB37)", async () => {
    const { container } = mountPayload(emptyPayload());
    await settle();
    // In the order `library` lists them: the author's tab first.
    expect(tabs(pane(container))).toEqual(["Crews 0", "Rows 0", "Columns 1"]);
    await openTab(container, "Rows");
    expect(emptyState(container)).toEqual(["No templates", "This sheet offers no rows or groups to drag in."]);
    await openTab(container, "Crews");
    expect(emptyState(container)).toEqual(["Nothing in Crews", "Crews lists nothing yet."]);
    await openTab(container, "Columns");
    expect(emptyState(container)).toBeNull();
    await search(container, "zz");
    expect(emptyState(container)).toEqual(["No matches", 'Nothing matches "zz".']);
});
