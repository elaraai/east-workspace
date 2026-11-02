/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Review of PR #1397: the drafts of a kind read by area (#1393) over what its
 * window holds. A draft the narrowing leaves out waits in its session, hidden
 * — the default — as every kind's does (`drafted.ts`, SKILL.md's Narrowing);
 * and a rack a draft unplaced is the Backlog's wherever the view goes, until
 * Save. Issues checks every unsaved change wherever it is drawn — or drawn
 * nowhere, a draft the hidden narrowing leaves out, its line saying which
 * choice hides it, as the shared hidden pick words it, and Go to issue
 * clearing that choice and selecting it once it draws (ruled 27 Oct 2026,
 * "Checked in view, said so"). Each test fails on the code under review.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin, and each card the tests press answers at
 * its centre.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { at, cameraOf, card, fitted, layOutCanvas, near, tap, unsaved, zoomInto } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The camera the canvas fits a 28 × 14 m drawing with. */
const CAM = fitted(28, 14);

const printText = printFor(StringType);
const compareString = compareFor(StringType);

/** The rail's key over the floor. */
const FLOOR = "schematic.review.drafts";

/** The racks' record, as its dataset's requests name it. */
const RACKS_DATASET = `records.${ex.schematicRacks.name}`;

/**
 * The data centre's racks read by area — their source lists their area index and the one led by owner, beside the one by
 * name — editable through their patch door; the floor's areas, read whole; the Backlog and the Index; and the inspector:
 * as `schematic-area-library.dom.test.tsx`'s floor, with the inspector.
 */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const areas = $.let(Data.bind(ex.schematicAreas));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_area", "schematic_racks_by_owner_area", "schematic_racks_by_name"] }),
            search: ["name"],
            fields: { name: { label: "Rack" }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] } },
        },
    }));
    return Schematic({
        id: "reviewDrafts",
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries, sublabel: (r) => r.model,
            }),
        },
        zones: { areas: Schematic.zones(areas, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name" }) },
        library: [Schematic.library.backlog(), Schematic.library.index()],
    });
}))) };

/** The floor, a narrowed-out rack drawn as context (`narrowed="dim"`): as {@link floor} otherwise. */
const dimFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const areas = $.let(Data.bind(ex.schematicAreas));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_area", "schematic_racks_by_owner_area", "schematic_racks_by_name"] }),
            search: ["name"],
            fields: { name: { label: "Rack" }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] } },
        },
    }));
    return Schematic({
        id: "reviewDraftsDim",
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        narrowed: "dim",
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries, sublabel: (r) => r.model,
            }),
        },
        zones: { areas: Schematic.zones(areas, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name" }) },
        library: [Schematic.library.backlog(), Schematic.library.index()],
    });
}))) };

/** The floor with the racks' templates, its Templates tab beside the Index: as {@link floor} otherwise, a rack a template makes among its racks. */
const templatesFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const rackTemplates = $.let(Data.bind(ex.schematicRackTemplates));
    const areas = $.let(Data.bind(ex.schematicAreas));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_area", "schematic_racks_by_owner_area", "schematic_racks_by_name"] }),
            search: ["name"],
            fields: { name: { label: "Rack" }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] } },
        },
        rackTemplates: { source: Data.bindPaged(ex.schematicRackTemplates, { indexes: ["schematic_rack_templates_by_group"] }), fields: { group: { label: "Group", hints: ["Racks", "Half racks"] } } },
    }));
    return Schematic({
        id: "reviewDraftsTemplates",
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries, sublabel: (r) => r.model,
                templates: Schematic.templates(rackTemplates.read(), { name: (t) => t.name, group: (t) => some(t.group), values: (t) => t.values, source: "rackTemplates" }),
            }),
        },
        zones: { areas: Schematic.zones(areas, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name" }) },
        library: [Schematic.library.templates(), Schematic.library.index()],
    });
}))) };

/** Where each card the tests press sits, by key and centre in metres. */
const CENTRES: readonly (readonly [key: string, x: number, y: number])[] = [["A01", 2.4, 2.9], ["A02", 6.0, 2.9], ["A03", 9.6, 2.9]];

/** The canvas. */
const canvasOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** Lets each card answer at its centre at Fit, as a page would hit it, and the canvas everywhere else on it. */
function hits(c: HTMLElement) {
    const canvas = canvasOf(c);
    const found = CENTRES.flatMap(([key, x, y]) => {
        const el = card(c, "racks", key);
        return el === null ? [] : [[el, x, y] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y]) => near(CAM, px, py, x, y))?.[0]
        ?? (px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvas : null));
}

/** Mounts a floor — the hidden one by default — waits until its racks are drawn, and lets its cards answer a press. */
async function open(example: { fn: { toIR(): unknown } } = floor) {
    const ui = await h.mount(example);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    await settle();
    hits(ui.container);
    fireEvent.pointerEnter(canvasOf(ui.container));
    return ui;
}

/** The racks' searches through the area index the window reads through: one a window. */
const windowSearches = () => h.requests("find", RACKS_DATASET).filter((request) => request.query.get("index") === "schematic_racks_by_area").length;

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** Writes a source's narrowing — the racks' unless another is named — as the rail does. */
async function narrow(where: Where, key = `${FLOOR}.racks`) {
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

/** The library's open panel. */
const panel = (c: HTMLElement) => slot(c, "start").querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** The Backlog's cards' keys, in order. */
const backlogKeys = (c: HTMLElement) => [...panel(c).querySelectorAll<HTMLElement>("[data-library-item]")].map((el) => el.getAttribute("data-library-item"));

/** A rack's id, as the canvas and the Backlog's cards name it. */
const rack = (key: string) => entityId({ kind: "racks", key });

/** The inspector's open panel. */
const inspector = (c: HTMLElement) => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** The view of Details whose heading an element is — its home, where the keyboard lands — or `null` for any other element. */
const homeOf = (el: Element | null): string | null => (el?.hasAttribute("data-focus-home") === true
    ? el.closest("[data-schematic-inspector]")?.getAttribute("data-schematic-inspector") ?? null : null);

test("hidden — the default — a rack a draft moved that a new choice leaves out waits in its session, drawn nowhere, as every kind's draft does", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    // A01, Harbour Labs', moved down into the clear floor below its row: a draft.
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name: "Move" })); });
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(CAM, 2.4, 2.9) });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(CAM, 2.4, 5.0) });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, ...at(CAM, 2.4, 5.0) });
    });
    await settle();
    expect(unsaved(container)).toBe(true);
    // Northwind Media's racks chosen: Harbour Labs' A02 goes, and so does A01, its draft waiting in its session.
    await narrow(new SortedMap([["owner", variant("values", [printText("Northwind Media")])]], compareString));
    await waitFor(() => expect(card(container, "racks", "A02")).toBeNull(), { timeout: 5_000 });
    expect(card(container, "racks", "A03")).not.toBeNull();
    expect(card(container, "racks", "A01")).toBeNull();
    expect(unsaved(container)).toBe(true);
});

test("dimmed, a rack a draft moved off its window that a new choice leaves out draws as context where its draft has it, as every kind's does", async () => {
    const { container } = await open(dimFloor);
    const canvas = canvasOf(container);
    // A01, Harbour Labs', moved across the floor into the Network room: a draft.
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name: "Move" })); });
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(CAM, 2.4, 2.9) });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(CAM, 23.0, 9.6) });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, ...at(CAM, 23.0, 9.6) });
    });
    await settle();
    expect(unsaved(container)).toBe(true);
    // A zoom into the Network room: its window holds none of the cage, A01's stored place, and A01 draws where its draft has it.
    const before = windowSearches();
    await zoomInto(canvas, cameraOf(container), { minX: 20, minY: 8, maxX: 26, maxY: 12 });
    await waitFor(() => expect(windowSearches()).toBeGreaterThan(before), { timeout: 5_000 });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A01")).not.toBeNull(), { timeout: 5_000 });
    expect(card(container, "racks", "A01")!.hasAttribute("data-context")).toBe(false);
    // Northwind Media's racks chosen: A01 is Harbour Labs', and draws as context, its draft unsaved.
    await narrow(new SortedMap([["owner", variant("values", [printText("Northwind Media")])]], compareString));
    await waitFor(() => expect(card(container, "racks", "A01")?.hasAttribute("data-context")).toBe(true), { timeout: 5_000 });
    expect(unsaved(container)).toBe(true);
});

test("a rack a draft unplaced is the Backlog's wherever the view goes, until Save", async () => {
    const { container } = await open();
    // A01 tapped and unplaced in Details: the Backlog lists it first, among the rows in hand, before the pages' A06 and A07.
    await tap(canvasOf(container), CAM, 2.4, 2.9);
    await waitFor(() => expect(inspector(container).querySelector('[data-inspector-action="unplace"]')).not.toBeNull());
    await act(async () => { fireEvent.click(inspector(container).querySelector<HTMLElement>('[data-inspector-action="unplace"]')!); });
    await settle();
    await waitFor(() => expect(backlogKeys(container)).toEqual([rack("A01"), rack("A06"), rack("A07")]));
    expect(unsaved(container)).toBe(true);
    // A zoom into the floor's far corner, its window read: the Backlog still lists A01, its draft unsaved.
    const before = windowSearches();
    await zoomInto(canvasOf(container), cameraOf(container), { minX: 22, minY: 10, maxX: 26, maxY: 12 });
    await waitFor(() => expect(windowSearches()).toBeGreaterThan(before), { timeout: 5_000 });
    await settle();
    await settle();
    expect(unsaved(container)).toBe(true);
    expect(backlogKeys(container)).toEqual([rack("A01"), rack("A06"), rack("A07")]);
});

test("Unplace in Details keeps the keyboard in the frame: the button it was pressed on goes, and the focus lands on the heading of the view drawn in its place, never on the page's body", async () => {
    const { container } = await open();
    await tap(canvasOf(container), CAM, 2.4, 2.9);
    await waitFor(() => expect(inspector(container).querySelector('[data-inspector-action="unplace"]')).not.toBeNull());
    const unplace = inspector(container).querySelector<HTMLElement>('[data-inspector-action="unplace"]')!;
    unplace.focus();
    expect(document.activeElement).toBe(unplace);
    await act(async () => { fireEvent.click(unplace); });
    await settle();
    await waitFor(() => expect(backlogKeys(container)).toContain(rack("A01")));
    expect(document.activeElement).not.toBe(document.body);
    // Nothing is selected now: the drawing's heading holds the keyboard, naming what Details shows.
    expect(homeOf(document.activeElement)).toBe("drawing");
});

test("Delete in Details keeps the keyboard in the inspector: the button it was pressed on goes, and the focus lands on the heading of the view drawn in its place, never on the page's body", async () => {
    const { container } = await open();
    await tap(canvasOf(container), CAM, 2.4, 2.9);
    await waitFor(() => expect(inspector(container).querySelector('[data-inspector-action="delete"]')).not.toBeNull());
    const remove = inspector(container).querySelector<HTMLElement>('[data-inspector-action="delete"]')!;
    remove.focus();
    expect(document.activeElement).toBe(remove);
    await act(async () => { fireEvent.click(remove); });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A01")).toBeNull());
    await waitFor(() => expect(inspector(container).querySelector("[data-schematic-inspector='drawing']")).not.toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(slot(container, "end").contains(document.activeElement)).toBe(true);
    expect(homeOf(document.activeElement)).toBe("drawing");
});

/** Opens a tab of the library, by its name. */
async function openTab(c: HTMLElement, name: string) {
    const found = [...slot(c, "start").querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (found === undefined) throw new Error(`no library tab ${name}`);
    await act(async () => { fireEvent.click(found); });
    await settle();
}

/** The Index's rows as a reader meets them: each indented by its level, its name, its open mark and its count. */
const indexRows = (c: HTMLElement) => [...panel(c).querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => {
    const pad = "  ".repeat(Number(row.getAttribute("aria-level")) - 1);
    const expanded = row.getAttribute("aria-expanded");
    const count = row.querySelector("[data-index-count]")?.textContent;
    return `${pad}${row.querySelector("[data-index-name]")!.textContent}${expanded === "true" ? " ▾" : expanded === "false" ? " ▸" : ""}${count === undefined ? "" : ` ${count}`}`;
});

/** Opens an Index zone's row by its chevron. */
async function openZone(c: HTMLElement, name: string) {
    const row = [...panel(c).querySelectorAll<HTMLElement>('[role="treeitem"]')].find((r) => r.querySelector("[data-index-name]")!.textContent === name)!;
    await act(async () => { fireEvent.click(row.querySelector("button")!); });
    await settle();
}

test("the Index lists a rack read by area where its draft has it, as it lists the drafted rows of a kind read whole", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    // A01 moved out of Cage A into the Network room: a draft.
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name: "Move" })); });
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(CAM, 2.4, 2.9) });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(CAM, 23.0, 9.6) });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, ...at(CAM, 23.0, 9.6) });
    });
    await settle();
    expect(unsaved(container)).toBe(true);
    // Cage A and the Network room opened: Cage A holds A02 to A05, and the Network room A01, as the canvas draws them.
    await openTab(container, "Index");
    await openZone(container, "Cage A");
    await openZone(container, "Network room");
    await waitFor(() => expect(indexRows(container)).toEqual([
        "Cage A ▾ 4", "  A02", "  A03", "  A04", "  A05", "Cold aisle A · 1.2 m ▸", "Hot aisle A · 1.0 m ▸", "Meet-me room ▸", "Network room ▾ 1", "  A01",
    ]), { timeout: 5_000 });
});

test("the Index lists a rack a gesture made in the zone it stands in, and none a draft deleted, over a kind read by area", async () => {
    const { container } = await open(templatesFloor);
    const canvas = canvasOf(container);
    // A02 tapped and deleted with Del: a draft.
    await tap(canvas, CAM, 6.0, 2.9);
    canvas.focus();
    await act(async () => { fireEvent.keyDown(canvas, { key: "Delete", code: "Delete" }); });
    await settle();
    expect(unsaved(container)).toBe(true);
    // A 42U rack's template entered: a new rack at the view's centre, in the cold aisle.
    await openTab(container, "Templates");
    const template = panel(container).querySelector<HTMLElement>(`[data-library-item=${JSON.stringify(entityId({ kind: "racks", key: "r42" }))}]`)!;
    template.focus();
    await act(async () => { fireEvent.keyDown(template, { key: "Enter", code: "Enter" }); });
    await settle();
    // Cage A and the cold aisle opened: Cage A holds A01, A03, A04 and A05, and the cold aisle the new rack, as the canvas draws them.
    await openTab(container, "Index");
    await openZone(container, "Cage A");
    await openZone(container, "Cold aisle A · 1.2 m");
    await waitFor(() => expect(indexRows(container)).toEqual([
        "Cage A ▾ 4", "  A01", "  A03", "  A04", "  A05", "Cold aisle A · 1.2 m ▾ 1", "  New 42U rack", "Hot aisle A · 1.0 m ▸", "Meet-me room ▸", "Network room ▸",
    ]), { timeout: 5_000 });
});

// ============================================================================
// Issues: every unsaved change, drawn or waiting in its session (ruled 27 Oct 2026, "Checked in view, said so")
// ============================================================================

/** Opens one of the inspector's tabs, by its name. */
async function openInspectorTab(c: HTMLElement, name: string) {
    const found = [...slot(c, "end").querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (found === undefined) throw new Error(`no inspector tab ${name}`);
    await act(async () => { fireEvent.click(found); });
    await settle();
}

/** The Issues tab's rows: each what it names, what it says, whether it blocks, and the choices that hide its row — `null` where none does. */
const issueRows = (c: HTMLElement) => [...inspector(c).querySelectorAll("[data-inspector-issue]")].map((el) => [
    el.children[0]?.textContent, el.children[1]?.textContent, el.children[1]?.getAttribute("data-kind"),
    el.querySelector("[data-inspector-issue-hidden]")?.textContent ?? null,
]);

/** What Details shows, its panel open or not: its view — `item`, `link`, `drawing` — and the title it gives what is selected. */
const detailsHead = (c: HTMLElement) => {
    const view = slot(c, "end").querySelector("[data-schematic-inspector]");
    return [view?.getAttribute("data-schematic-inspector") ?? null, view?.querySelector("[data-inspector-title]")?.textContent ?? null];
};

/** Picks a choice of a Chooser in Details, by its section, its field and its words. */
async function choose(c: HTMLElement, section: string, key: string, option: string) {
    const trigger = inspector(c).querySelector<HTMLElement>(`[data-inspector-fields="${section}"] [data-field="${key}"] [data-scope=select][data-part=trigger]`)!;
    await act(async () => { fireEvent.click(trigger); });
    const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    await act(async () => { fireEvent.click(within(listbox).getByRole("option", { name: option })); });
    await settle();
}

/** Types a number field of Details' section, a key at a time — the shared input writes back on a frame — and commits it with ⏎. */
async function retypeNumber(c: HTMLElement, section: string, key: string, text: string) {
    const user = userEvent.setup();
    const input = within(inspector(c).querySelector<HTMLElement>(`[data-inspector-fields="${section}"] [data-field="${key}"]`)!).getByRole("spinbutton");
    await user.clear(input);
    await settle();
    for (const ch of text) {
        await user.type(input, ch);
        await settle();
        await act(async () => { for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    }
    await user.type(input, "{Enter}");
    await settle();
}

/** A01, tapped, moved past the floor's east edge in Details — its x 30 m on a floor 28 m wide: a draft Issues says is outside the drawing. */
async function pushOffTheFloor(c: HTMLElement) {
    await tap(canvasOf(c), CAM, 2.4, 2.9);
    await waitFor(() => expect(detailsHead(c)).toEqual(["item", "A01"]));
    await retypeNumber(c, "position", "x", "30");
    expect(unsaved(c)).toBe(true);
}

/** A source's narrowing — the racks' unless another is named — as the rail holds it. */
const whereOf = (key = `${FLOOR}.racks`): Where => decodeBeast2For(RecordSliceStateType)(StateRuntime.getStore().read(key)!).where;

/** Northwind Media's racks: A03 and A04 — never Harbour Labs' A01 and A02. */
const NORTHWIND: Where = new SortedMap([["owner", variant("values", [printText("Northwind Media")])]], compareString);

/** A01's issue once its draft has moved it past the floor's east edge. */
const A01_OUTSIDE = ["Rack · A01", "Outside the drawing", "warning"] as const;

/** What A01's issue says of the choice that hides it, as the shared hidden pick words it. */
const HIDDEN_BY_NORTHWIND = "hidden by Owner: Northwind Media — picking it clears that filter";

test("hidden, a rack a draft moved off the drawing that a new choice leaves out is listed in Issues still, its line naming the choice that hides it; Go to issue clears that choice and selects the rack once it draws", async () => {
    const { container } = await open();
    await pushOffTheFloor(container);
    await openInspectorTab(container, "Issues");
    expect(issueRows(container)).toEqual([[...A01_OUTSIDE, null]]);
    // Northwind Media's racks chosen: A01, Harbour Labs', waits in its session, drawn nowhere — its issue unsaved still.
    await narrow(NORTHWIND);
    await waitFor(() => expect(card(container, "racks", "A02")).toBeNull(), { timeout: 5_000 });
    await waitFor(() => expect(issueRows(container)).toEqual([[...A01_OUTSIDE, HIDDEN_BY_NORTHWIND]]), { timeout: 5_000 });
    expect(unsaved(container)).toBe(true);
    // Go to issue: just the owner's choice cleared, as the rail clears it, and A01 selected once the narrowing it leaves draws it.
    await act(async () => { fireEvent.click(inspector(container).querySelector("[data-inspector-issue]")!); });
    await settle();
    await waitFor(() => expect(whereOf().size).toBe(0));
    await waitFor(() => expect(detailsHead(container)).toEqual(["item", "A01"]), { timeout: 5_000 });
    expect(issueRows(container)).toEqual([[...A01_OUTSIDE, null]]);
    expect(unsaved(container)).toBe(true);
});

test("dimmed, the same draft draws as context where its draft has it, and Issues lists it with no line of a choice hiding it", async () => {
    const { container } = await open(dimFloor);
    await pushOffTheFloor(container);
    await openInspectorTab(container, "Issues");
    expect(issueRows(container)).toEqual([[...A01_OUTSIDE, null]]);
    // Northwind Media's racks chosen: Harbour Labs' A02 draws as context, and so does A01, where its draft has it.
    await narrow(NORTHWIND);
    await waitFor(() => expect(card(container, "racks", "A02")?.hasAttribute("data-context")).toBe(true), { timeout: 5_000 });
    await settle();
    expect(issueRows(container)).toEqual([[...A01_OUTSIDE, null]]);
});

test("a draft off the window is checked where its draft has it: a zoom away from the rack's stored place keeps its issue listed, and a choice leaving it out keeps it listed, its line naming that choice", async () => {
    const { container } = await open();
    await pushOffTheFloor(container);
    await openInspectorTab(container, "Issues");
    // A zoom into the Network room: its window holds none of the cage, A01's stored place, and A01's draft is still checked.
    const before = windowSearches();
    await zoomInto(canvasOf(container), cameraOf(container), { minX: 20, minY: 8, maxX: 26, maxY: 12 });
    await waitFor(() => expect(windowSearches()).toBeGreaterThan(before), { timeout: 5_000 });
    await settle();
    expect(issueRows(container)).toEqual([[...A01_OUTSIDE, null]]);
    // Northwind Media's racks chosen: A01 waits in its session, off the window, and its issue stays listed, saying what hides it.
    await narrow(NORTHWIND);
    await waitFor(() => expect(issueRows(container)).toEqual([[...A01_OUTSIDE, HIDDEN_BY_NORTHWIND]]), { timeout: 5_000 });
    expect(unsaved(container)).toBe(true);
});

/** The rail's key over the runs' floor. */
const RUNS = "schematic.review.runs";

/**
 * The data centre's racks — editable through their patch door — and its network frames, read whole, and the fibre runs
 * between them read complete through a source of their own, narrowed by their system and editable through their patch
 * door, with the inspector: a narrowed-out run hidden, the default.
 */
const runsFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const fibre = $.let(Record.bind(ex.schematicFibre, ["patch"]));
    const fibreEntries = $.let(Data.bindPaged(ex.schematicFibre));
    const slice = $.let(Slice.bindRecords(RUNS, {
        fibre: { source: Data.bindPaged(ex.schematicFibre, { indexes: ["schematic_fibre_by_system"] }), fields: { system: { label: "System", hints: ["network", "power"] } } },
    }));
    const ends = { field: "from", of: { rack: "racks", frame: "network" } } as const;
    return Schematic({
        id: "reviewRuns",
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
        links: { fibre: Schematic.links(fibre, { name: "Fibre run", icon: "bolt", via: "path", from: ends, to: { ...ends, field: "to" }, entries: fibreEntries }) },
    });
}))) };

const stringEqual = equalFor(StringType);

test("hidden, a run a draft re-targeted that a choice of its own source leaves out is listed in Issues still — the rack another session deleted named, its line naming the choice — and Go to issue clears that choice and selects the run once it draws", async () => {
    const { container } = await open(runsFloor);
    // u3, from A03 to ODF-1, tapped on its line and re-targeted to MMR-1 in Details: a draft.
    await tap(canvasOf(container), CAM, 9.6, 6.0);
    await waitFor(() => expect(detailsHead(container)).toEqual(["link", "A03 → ODF-1"]));
    await choose(container, "ends", "to", "MMR-1 · Network frame");
    expect(unsaved(container)).toBe(true);
    // Another session deletes A03: the drafted run names a rack no rack holds.
    const racks = await h.read(ex.schematicRacks);
    await h.patch(ex.schematicRacks, new Map([...racks].filter(([key]) => !stringEqual(key, "A03"))));
    await openInspectorTab(container, "Issues");
    const missing = ["Fibre run · A03 → MMR-1", "Names Rack A03, which no rack holds", "warning"] as const;
    await waitFor(() => expect(issueRows(container)).toEqual([[...missing, null]]), { timeout: 5_000 });
    // The power system's runs chosen: none of them is, and u3 waits in its session, drawn nowhere — its issue listed still.
    await narrow(new SortedMap([["system", variant("values", [printText("power")])]], compareString), `${RUNS}.fibre`);
    await waitFor(() => expect(issueRows(container)).toEqual([[...missing, "hidden by System: power — picking it clears that filter"]]), { timeout: 5_000 });
    expect(unsaved(container)).toBe(true);
    // Go to issue: the system's choice cleared, and u3 selected once the narrowing it leaves draws it.
    await act(async () => { fireEvent.click(inspector(container).querySelector("[data-inspector-issue]")!); });
    await settle();
    await waitFor(() => expect(whereOf(`${RUNS}.fibre`).size).toBe(0));
    await waitFor(() => expect(detailsHead(container)).toEqual(["link", "A03 → MMR-1"]), { timeout: 5_000 });
    expect(unsaved(container)).toBe(true);
});
