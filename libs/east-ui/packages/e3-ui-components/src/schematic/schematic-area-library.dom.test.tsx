/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The library of a kind read by area on e3 itself (#1393, `Schematic Builder
 * Spec.md` §8, §10.4, D51): the racks read a window at a time through their
 * source's area index, so no read holds their rows with no position whole. The
 * Backlog pages them through the area index's unplaced clause, never reading
 * the record whole, and counts what it lists; a choice of owners, which an
 * area index leads, narrows the pages exactly (`1 of 2`); a choice no area
 * index leads is asked of each page's rows, and a row it leaves out draws as
 * context, faded and never dragged. ⏎ on a row places it at the view's centre,
 * where it draws while its draft waits, the Backlog drawing it as context; and
 * Save writes it, the Backlog then listing it no more.
 *
 * The Index (D52) reads the racks itself: an open zone's by its box through
 * the area index, counted once read, and its search's through the racks'
 * source's `search` fields, each under the zone it is in.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { card, layOutCanvas } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

const printText = printFor(StringType);
const compareString = compareFor(StringType);

/** The rail's key over the floor. */
const FLOOR = "schematic.area.floor";

/** The racks' source of the rail, as the store keeps its narrowing. */
const RACKS = `${FLOOR}.racks`;

/** The racks' record, as its dataset's requests name it. */
const RACKS_DATASET = `records.${ex.schematicRacks.name}`;

/**
 * The data centre's racks read by area — their source lists their area index and the one led by owner, beside the one by
 * name — editable through their patch door; the floor's areas, read whole; and a library of the Backlog.
 */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const areas = $.let(Data.bind(ex.schematicAreas));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByArea, ex.schematicRacksByOwnerArea, ex.schematicRacksByName] }),
            search: ["name"],
            fields: { name: { label: "Rack" }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] } },
        },
    }));
    return Schematic({
        id: "areaLibrary",
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

/** Mounts the floor, waits until its racks are drawn, and opens the Backlog. */
async function open() {
    const ui = await h.mount(floor);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    return ui;
}

/** The library pane. */
const pane = (container: HTMLElement) => slot(container, "start");

/** The Backlog's tab, as its row draws it: its name and its count. */
const tab = (container: HTMLElement) => pane(container).querySelector('[role="tab"]')?.textContent;

/** Opens a tab of the library, by its name. */
async function openTab(container: HTMLElement, name: string) {
    const found = [...pane(container).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (found === undefined) throw new Error(`no library tab ${name}`);
    await act(async () => { fireEvent.click(found); });
    await settle();
}

/** The open panel. */
const panel = (container: HTMLElement) => pane(container).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** The Backlog's cards, in order: each its key, whether it draws as context, and whether it drags. */
const cards = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")].map((el) => ({
    key: el.getAttribute("data-library-item"),
    context: el.hasAttribute("data-filtered"),
    drags: el.hasAttribute("data-draggable"),
}));

/** A card of the Backlog, by its key. */
const backlogCard = (container: HTMLElement, key: string) => panel(container).querySelector<HTMLElement>(`[data-library-item=${JSON.stringify(key)}]`)!;

/** A rack's id, as the canvas and the Backlog's cards name it. */
const rack = (key: string) => entityId({ kind: "racks", key });

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** Writes the racks' narrowing, as the rail does. */
async function narrow(where: Where) {
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(RACKS)!);
    await act(async () => { store.write(RACKS, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

test("a kind read by area pages its Backlog through its area index's unplaced clause, counting what it lists, and never reads its record whole (#1393, D51)", async () => {
    const { container } = await open();
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([rack("A06"), rack("A07")]));
    expect(tab(container)).toBe("Backlog 2");
    expect(cards(container).map((c) => [c.context, c.drags])).toEqual([[false, true], [false, true]]);
    // Its rows draw nothing on the canvas; the pages were read through the area index, and the record never whole.
    expect(card(container, "racks", "A06")).toBeNull();
    expect(h.requests("read", RACKS_DATASET)).toEqual([]);
    const indexes = h.requests(undefined, RACKS_DATASET).map((request) => request.query.get("index"));
    expect(indexes).toContain(ex.schematicRacksByArea.name);
});

test("a choice of owners, which an area index leads, narrows the pages exactly: `1 of 2` (#1393, D51)", async () => {
    const { container } = await open();
    await waitFor(() => expect(tab(container)).toBe("Backlog 2"));
    await narrow(new SortedMap([["owner", variant("values", [printText("Elmway College")])]], compareString));
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([rack("A06")]));
    expect(tab(container)).toBe("Backlog 1 of 2");
    expect(h.requests(undefined, RACKS_DATASET).map((request) => request.query.get("index"))).toContain(ex.schematicRacksByOwnerArea.name);
});

test("a choice no area index leads is asked of each page's rows: a row it leaves out draws as context, faded and never dragged (#1393, D51, D28)", async () => {
    const { container } = await open();
    await waitFor(() => expect(tab(container)).toBe("Backlog 2"));
    const before = h.requests("within", RACKS_DATASET).length;
    await narrow(new SortedMap([["name", variant("prefix", "A07")]], compareString));
    await waitFor(() => expect(cards(container).map((c) => [c.key, c.context, c.drags])).toEqual([[rack("A06"), true, false], [rack("A07"), false, true]]));
    // The list is the unplaced clause's, whatever a choice no area index leads leaves out: its count is every row it lists.
    expect(tab(container)).toBe("Backlog 2");
    expect(h.requests("within", RACKS_DATASET).length).toBeGreaterThan(before);
});

test("⏎ on a row places it at the view's centre, where it draws while its draft waits, the Backlog drawing it as context; Save writes it, and the Backlog lists it no more (#1393, D51, SC13)", async () => {
    const { container } = await open();
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([rack("A06"), rack("A07")]));
    const a06 = backlogCard(container, rack("A06"));
    a06.focus();
    await act(async () => { fireEvent.keyDown(a06, { key: "Enter", code: "Enter" }); });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A06")).not.toBeNull());
    await waitFor(() => expect(cards(container).map((c) => [c.key, c.context])).toEqual([[rack("A06"), true], [rack("A07"), false]]));
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: editingMessages.apply() })); });
    await settle();
    // Saved: A06 holds the centre the drop gave it, and the Backlog lists A07 alone.
    const saved = await h.read(ex.schematicRacks);
    expect([saved.get("A06")!.x.type, saved.get("A06")!.y.type]).toEqual(["some", "some"]);
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([rack("A07")]));
    expect(tab(container)).toBe("Backlog 1");
    expect(card(container, "racks", "A06")).not.toBeNull();
});


// ── The Index (§8, D52) ─────────────────────────────────────────────────────

/** The Index's rows as a reader meets them: each indented by its level, its name, its open mark and its count. */
const indexRows = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => {
    const pad = "  ".repeat(Number(row.getAttribute("aria-level")) - 1);
    const expanded = row.getAttribute("aria-expanded");
    const count = row.querySelector("[data-index-count]")?.textContent;
    return `${pad}${row.querySelector("[data-index-name]")!.textContent}${expanded === "true" ? " ▾" : expanded === "false" ? " ▸" : ""}${count === undefined ? "" : ` ${count}`}`;
});

/** An Index row, by its name. */
const indexRow = (container: HTMLElement, name: string) => [...panel(container).querySelectorAll<HTMLElement>('[role="treeitem"]')]
    .find((row) => row.querySelector("[data-index-name]")!.textContent === name)!;

/** The area index the racks' window reads through, as a request names it. */
const byArea = (request: { readonly query: URLSearchParams }) => request.query.get("index") === ex.schematicRacksByArea.name;

test("an open zone lists the racks its box holds, read through the area index — no read of the record whole — counted once read (#1393, D52)", async () => {
    const { container } = await open();
    await openTab(container, "Index");
    // No window holds every rack: a zone counts none before its box is read, and opens to read it.
    expect(indexRows(container)).toEqual(["Cage A ▸", "Cold aisle A · 1.2 m ▸", "Hot aisle A · 1.0 m ▸", "Meet-me room ▸", "Network room ▸"]);
    const before = h.requests(undefined, RACKS_DATASET).filter(byArea).length;
    await act(async () => { fireEvent.click(indexRow(container, "Cage A").querySelector("button")!); });
    await waitFor(() => expect(indexRows(container)).toEqual([
        "Cage A ▾ 5", "  A01", "  A02", "  A03", "  A04", "  A05", "Cold aisle A · 1.2 m ▸", "Hot aisle A · 1.0 m ▸", "Meet-me room ▸", "Network room ▸",
    ]));
    expect(h.requests(undefined, RACKS_DATASET).filter(byArea).length).toBeGreaterThan(before);
    expect(h.requests("read", RACKS_DATASET)).toEqual([]);
    // A zone whose box holds no rack, opened, says so: no count, nothing to open.
    await act(async () => { fireEvent.click(indexRow(container, "Meet-me room").querySelector("button")!); });
    await waitFor(() => expect(indexRows(container)).toContain("Meet-me room"));
});

test("the Index's search finds the racks through their source's search fields, each under the zone it is in; one with no position is the Backlog's (#1393, D52)", async () => {
    const { container } = await open();
    await openTab(container, "Index");
    await act(async () => { fireEvent.change(within(panel(container)).getByRole("textbox", { name: "Search items" }), { target: { value: "A0" } }); });
    await waitFor(() => expect(indexRows(container)).toEqual(["Cage A ▾", "  A01", "  A02", "  A03", "  A04", "  A05"]));
    await act(async () => { fireEvent.change(within(panel(container)).getByRole("textbox", { name: "Search items" }), { target: { value: "A03" } }); });
    await waitFor(() => expect(indexRows(container)).toEqual(["Cage A ▾", "  A03"]));
    expect(h.requests("read", RACKS_DATASET)).toEqual([]);
});
