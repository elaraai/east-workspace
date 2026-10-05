/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet.Builder>`'s library pane (#1186, `Sheet Builder Spec.md` §8,
 * SB32–SB37), over the builder's examples and their seeded records
 * (`builder.test-utils.tsx`): the three tabs with their counts and the rail;
 * each tab's cards — the templates by group with what they set, the
 * register members by where they come from, the columns with their kind and
 * eye; the searches; a member's click narrowing the sheet through the slice,
 * or selecting the card without one; a column hidden and shown, kept per
 * viewer across a remount, and still matched by the lens; and the empty
 * states.
 */

import { test, expect } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ArrayType, East, StringType, StructType } from "@elaraai/east";
import { Record, Sheet, SheetBuilderPayloadType } from "@elaraai/e3-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet-builder";
import { builderHarness, mount, mountPayload, settle, slot, tabs, type Payload } from "./builder.test-utils.js";

builderHarness();

/** A crew, for a register whose members have aliases. */
const Crew = StructType({ code: StringType, name: StringType, aliases: ArrayType(StringType) });

/** The jobs builder with one column and a crews register: no driver, no slice, no templates. */
const crewsPayload = East.compile(East.function([], SheetBuilderPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
    const crews = $.let([
        { code: "C1", name: "Bench crew", aliases: ["benches"] },
        { code: "C2", name: "Finishing crew", aliases: ["paint shop"] },
    ], ArrayType(Crew));
    return Sheet.BuilderPayload({
        record: jobs,
        columns: { task: Sheet.column.text(ex.BuilderJob, { header: "Task" }) },
        registers: { crews: Sheet.register.members(crews, { kind: "crew", key: (c) => c.code, label: (c) => c.name, aliases: (c) => c.aliases }) },
        id: "crews",
    });
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

/** A panel's cards, in order: each card's name, the line under it, and what trails it — its tag, or its glyph's words. */
const cards = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")].map((card) => {
    const body = card.querySelector(":scope > div")!;
    const trailing = card.querySelector(":scope > div:last-child:not(:first-of-type)");
    const trail = trailing === null ? null : [...trailing.children].map((el) => el.getAttribute("aria-label") ?? el.textContent).join(" ");
    return [body.children[0]!.textContent, body.children[1]?.textContent ?? null, trail];
});

/** A card of the open tab, by its name. */
const cardNamed = (container: HTMLElement, name: string) => {
    const card = [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")]
        .find((c) => c.querySelector(":scope > div")!.children[0]!.textContent === name);
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

test("the library has three tabs, Rows, Registers and Columns, each with its count; collapsed, it is a rail with the templates' count (SB32)", async () => {
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    // Eleven templates; nine activities, twelve machines, five families, three statuses; six columns.
    expect(tabs(pane(container))).toEqual(["Rows 11", "Registers 29", "Columns 6"]);
    fireEvent.click(within(pane(container)).getByRole("button", { name: "Collapse Library" }));
    await settle();
    expect(pane(container).hasAttribute("data-collapsed")).toBe(true);
    expect(within(pane(container)).getByText("11")).toBeTruthy();
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

test("Registers lists the driver's members first, then each register's by register and kind — label, meta and kind (SB34)", async () => {
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    await openTab(container, "Registers");
    expect(heads(container)).toEqual([["Activity · driver", "9"], ["machines · machine", "12"], ["machines · family", "5"], ["statuses · status", "3"]]);
    const all = cards(container);
    // A driver member: its label, its meta, and its kind as its tag.
    expect(all[0]).toEqual(["Panel cutting", "panels", "activity"]);
    // A register's members, in its order (the machines record's, by code): label, then meta and kind; a family's
    // meta says its kind already; a status carries its tone.
    expect(all.slice(9, 11)).toEqual([["A701", "assembly bench · machine", null], ["A702", "assembly bench · machine", null]]);
    expect(all.slice(21, 23)).toEqual([["assembly bench", "family", null], ["edge bander", "family", null]]);
    expect(all.slice(26)).toEqual([["PLANNED", "status", "neutral tone"], ["RELEASED", "status", "info tone"], ["ON HOLD", "status", "warning tone"]]);
    expect(cardNamed(container, "ON HOLD").querySelector('[role="img"]')!.getAttribute("data-tone")).toBe("warning");
});

test("the Registers search reads keys, labels and aliases (SB34)", async () => {
    const { container } = mountPayload(crewsPayload());
    await settle();
    await openTab(container, "Registers");
    expect(cards(container).map(([name]) => name)).toEqual(["Bench crew", "Finishing crew"]);
    await search(container, "paint");
    expect(cards(container).map(([name]) => name)).toEqual(["Finishing crew"]);
    await search(container, "c1");
    expect(cards(container).map(([name]) => name)).toEqual(["Bench crew"]);
    await search(container, "finishing");
    expect(cards(container).map(([name]) => name)).toEqual(["Finishing crew"]);
});

test("with a slice, a member's click narrows the sheet to the rows that name it through the slice's search; a click on it again lets go (SB35)", async () => {
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    await openTab(container, "Registers");
    const toolbar = slot(container, "toolbar")!;
    expect(toolbar.querySelector('[data-slot="toolbarCount"]')).toBeNull();
    fireEvent.click(cardNamed(container, "Edge banding"));
    await settle();
    // Four orders band their edges: four matches, each a hit line.
    expect(toolbar.querySelector('[data-slot="toolbarCount"]')!.textContent).toBe("4 matches");
    expect(slot(container, "main")!.querySelectorAll('[data-slot="gutterNumber"][data-hit]')).toHaveLength(4);
    expect(cardNamed(container, "Edge banding").hasAttribute("data-placed")).toBe(true);
    fireEvent.click(cardNamed(container, "Edge banding"));
    await settle();
    expect(toolbar.querySelector('[data-slot="toolbarCount"]')).toBeNull();
    expect(cardNamed(container, "Edge banding").hasAttribute("data-placed")).toBe(false);
});

test("without a slice, a member's click selects its card, and a click on it again lets it go (SB35)", async () => {
    const { container } = mountPayload(crewsPayload());
    await settle();
    await openTab(container, "Registers");
    fireEvent.click(cardNamed(container, "Bench crew"));
    await settle();
    expect(cardNamed(container, "Bench crew").hasAttribute("data-placed")).toBe(true);
    expect(cardNamed(container, "Finishing crew").hasAttribute("data-placed")).toBe(false);
    fireEvent.click(cardNamed(container, "Finishing crew"));
    await settle();
    expect([cardNamed(container, "Bench crew"), cardNamed(container, "Finishing crew")].map((card) => card.hasAttribute("data-placed"))).toEqual([false, true]);
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

test("a hidden column is still what the lens matches: hiding Activity, a member's click still narrows to its rows (SB36)", async () => {
    const { container } = mount(ex.sheetBuilderWorkshop);
    await settle();
    await openTab(container, "Columns");
    fireEvent.click(cardNamed(container, "Activity"));
    await settle();
    expect(headerKeys(container)).not.toContain("activity");
    await openTab(container, "Registers");
    fireEvent.click(cardNamed(container, "Edge banding"));
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

test("an empty tab says so: No templates, No registers, or No matches naming the search (SB37)", async () => {
    const { container } = mount(ex.sheetBuilder);
    await settle();
    await openTab(container, "Rows");
    expect(emptyState(container)).toEqual(["No templates", "This sheet offers no rows or groups to drag in."]);
    await openTab(container, "Registers");
    expect(emptyState(container)).toEqual(["No registers", "This sheet declares no driver and no registers."]);
    await openTab(container, "Columns");
    expect(emptyState(container)).toBeNull();
    await search(container, "zz");
    expect(emptyState(container)).toEqual(["No matches", 'Nothing matches "zz".']);
});
