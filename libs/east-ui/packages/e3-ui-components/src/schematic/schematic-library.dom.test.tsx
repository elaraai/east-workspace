/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's library on e3 itself (#1389, `Schematic Builder Spec.md` §8,
 * SC4, SC27): the start pane holding the tabs `library` lists, in its order,
 * each with its count, its rail counting the backlog; the Templates tab's
 * cards — every kind's, under its kind and its group — following their
 * templates' sources (`3 of 5`), a narrowing that leaves none of a source's
 * saying so above the rest, with Clear filters; an author's tab following the
 * source it names; the Backlog listing every item kind's rows with no
 * position, another session's change moving it, and a narrowing that empties
 * it saying so (SC4); the Index nesting the zones, flying to a zone, selecting
 * it and listing its items, marking the zone the viewport is in, and its keys;
 * the Layers tab's Isolate, Lock, Hide and Show all, which the canvas obeys —
 * a locked layer's entities never select — persisting under the Schematic's
 * `id` (SC27); a click selecting a card and a second letting it go; and each
 * tab's search finding within that tab alone.
 */

import { expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
    ArrayType, East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Schematic, schematicKeys } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { SchematicLayerViewType } from "./layers-view.js";
import { schematicMessages as m } from "./messages.js";
import { card, layOutCanvas, tap } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The data centre's px a metre: its 28 × 14 m drawing fitted to the canvas's 1080 × 540 px. */
const PPU = 1080 / 28;

/** Longer than a fly takes (350 ms): run on the test's clock, it lands. */
const FLY_MS = 400;

/** One animation frame, and a little over. */
const FRAME_MS = 20;

const printText = printFor(StringType);
const printRefs = printFor(ArrayType(Schematic.Types.Ref));
const compareString = compareFor(StringType);
const layerViewEqual = equalFor(SchematicLayerViewType);

/** An entity's id, as the canvas and the library's cards name it. */
const id = (kind: string, key: string) => entityId({ kind, key });

/** Reads what the data centre's host keeps of the selection: its State, read through East. */
const readKeptSelection = East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
    return kept.read();
}), getRegisteredPlatformImplementations());

/** What the data centre's host keeps of the selection, as East prints it. */
const keptSelection = () => printRefs(readKeptSelection());

/** Mounts the data centre, and waits until its racks are drawn. */
async function dataCentre() {
    const ui = await h.mount(ex.schematicDataCentre);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A05")).not.toBeNull());
    return ui;
}

// ── The pane, its tabs and their cards ──────────────────────────────────────

/** The library pane. */
const pane = (container: HTMLElement) => slot(container, "start");

/** The pane's tabs, as their row draws them: each its name and its count. */
const tabs = (container: HTMLElement) => [...pane(container).querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);

/** Opens a tab, by its name. */
async function openTab(container: HTMLElement, name: string) {
    const tab = [...pane(container).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    await act(async () => { fireEvent.click(tab); });
    await settle();
}

/** The open tab's panel. */
const panel = (container: HTMLElement) => pane(container).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** A panel's group heads: each its label and its count. */
const heads = (container: HTMLElement) => [...panel(container).querySelectorAll("[data-library-head]")]
    .map((head) => [head.children[0]!.textContent, head.children[1]!.textContent]);

/** A card's body: its name and the line under it — the card's block that is not its icon's tile. */
const bodyOf = (el: Element) => [...el.children].find((child) => child.tagName === "DIV" && child.querySelector(":scope > svg") === null)!;

/** The open panel's cards, in order: each its key, its name and the line under it, its icon, and whether it is picked. */
const cards = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")].map((el) => {
    const body = bodyOf(el);
    const svg = [...el.children].find((child) => child.tagName === "DIV" && child.querySelector(":scope > svg") !== null)?.querySelector("svg");
    return {
        key: el.getAttribute("data-library-item"),
        label: body.children[0]!.textContent,
        meta: body.children[1]?.textContent ?? null,
        icon: svg === undefined || svg === null ? null : `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`,
        picked: el.hasAttribute("data-placed"),
    };
});

/** A card of the open panel, by its key. */
const libraryCard = (container: HTMLElement, key: string) => panel(container).querySelector<HTMLElement>(`[data-library-item=${JSON.stringify(key)}]`)!;

/** The open panel's empty state — its icon, its title, the line under it and its action — or `null` while it shows none. */
const emptyState = (container: HTMLElement) => {
    const empty = panel(container).querySelector<HTMLElement>("[data-library-empty]");
    if (empty === null) return null;
    const title = within(empty).getByRole("heading");
    const svg = empty.querySelector("svg");
    return [
        svg === null ? null : `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`,
        title.textContent, title.nextElementSibling?.textContent ?? null, empty.querySelector("button")?.textContent ?? null,
    ];
};

/** Types in the open panel's search box, by its name. */
async function search(container: HTMLElement, text: string, name = "Search library") {
    await act(async () => { fireEvent.change(within(panel(container)).getByRole("textbox", { name }), { target: { value: text } }); });
    await settle();
}

// ── The rail's narrowing, as the rail writes it ─────────────────────────────

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** The data centre's rack templates' narrowing, and its racks', as the rail keeps them. */
const RACK_TEMPLATES = "ex.schematicDataCentre.rackTemplates";
const RACKS = "ex.schematicDataCentre.racks";

/** A choice of values of one field. */
const choose = (field: string, ...values: string[]): Where => new SortedMap([[field, variant("values", values.map((value) => printText(value)))]], compareString);

/** Writes a source's narrowing, as the rail does. */
async function narrow(key: string, where: Where) {
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

/** Presses the open panel's Clear filters. */
async function clearFilters(container: HTMLElement) {
    await act(async () => { fireEvent.click(within(panel(container)).getByRole("button", { name: "Clear filters" })); });
    await settle();
}

// ── The pane (§8) ───────────────────────────────────────────────────────────

test("the library holds the tabs `library` lists, in its order, each with its count; collapsed, its rail counts the backlog", async () => {
    const { container } = await dataCentre();
    expect(tabs(container)).toEqual(["Templates 5", "Backlog 2", "Index 5", "Layers 4", "Owners 3"]);
    await act(async () => { fireEvent.click(within(pane(container)).getByRole("button", { name: `Collapse ${m.libraryPane()}` })); });
    await settle();
    const rail = pane(container).querySelector(`[title='${m.libraryPane()}']`)!;
    expect([...rail.children].map((part) => part.textContent)).toEqual(["", "2", m.libraryPane()]);
    expect(rail.querySelector("svg")!.getAttribute("data-icon")).toBe("layer-group");
});

// ── Templates (§8, §4.6) ────────────────────────────────────────────────────

test("the Templates tab lists every kind's templates in its record's key order, each its name over its kind's, under its kind and its group", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Templates");
    expect(heads(container)).toEqual([["Rack · Half racks", "1"], ["Rack · Racks", "2"], ["Fibre run · network", "2"]]);
    expect(cards(container)).toEqual([
        { key: id("racks", "half"), label: "Half rack · 4 kW", meta: "Rack", icon: "fas server", picked: false },
        { key: id("racks", "r42"), label: "42U rack · 8 kW", meta: "Rack", icon: "fas server", picked: false },
        { key: id("racks", "r48"), label: "48U rack · 12 kW", meta: "Rack", icon: "fas server", picked: false },
        { key: id("fibre", "oob"), label: "Out-of-band management", meta: "Fibre run", icon: "fas bolt", picked: false },
        { key: id("fibre", "uplink"), label: "Uplink · 100G", meta: "Fibre run", icon: "fas bolt", picked: false },
    ]);
    // Every template drags onto the canvas (#1390); a click picks one, and a click on it lets it go.
    expect(cards(container).map((c) => libraryCard(container, c.key!).hasAttribute("data-draggable"))).toEqual([true, true, true, true, true]);
    await act(async () => { fireEvent.click(libraryCard(container, id("racks", "r42"))); });
    await waitFor(() => expect(cards(container).filter((c) => c.picked).map((c) => c.key)).toEqual([id("racks", "r42")]));
    await act(async () => { fireEvent.click(libraryCard(container, id("fibre", "oob"))); });
    await waitFor(() => expect(cards(container).filter((c) => c.picked).map((c) => c.key)).toEqual([id("fibre", "oob")]));
    await act(async () => { fireEvent.click(libraryCard(container, id("fibre", "oob"))); });
    await waitFor(() => expect(cards(container).filter((c) => c.picked)).toEqual([]));
});

test("each kind's templates follow their source: the tab counts what it shows (`3 of 5`), and a narrowing that leaves none of a source's says so above the rest, with Clear filters", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Templates");
    await narrow(RACK_TEMPLATES, choose("group", "Half racks"));
    await waitFor(() => expect(tabs(container)[0]).toBe("Templates 3 of 5"));
    expect(cards(container).map((c) => c.key)).toEqual([id("racks", "half"), id("fibre", "oob"), id("fibre", "uplink")]);
    expect(emptyState(container)).toBeNull();
    // A group no rack template is in: the fibre runs' templates show on, under the narrowing's words and its Clear filters.
    await narrow(RACK_TEMPLATES, choose("group", "Blade chassis"));
    await waitFor(() => expect(tabs(container)[0]).toBe("Templates 2 of 5"));
    expect(cards(container).map((c) => c.key)).toEqual([id("fibre", "oob"), id("fibre", "uplink")]);
    expect(emptyState(container)).toEqual(["fas box-open", "No templates match the filters", "Change or clear the filters to see more templates.", "Clear filters"]);
    await clearFilters(container);
    await waitFor(() => expect(tabs(container)[0]).toBe("Templates 5"));
    expect(emptyState(container)).toBeNull();
});

// ── An author's tab (§8) ────────────────────────────────────────────────────

/** The racks as an author's tab of their own, following the racks' source of the rail by the record's keys, beside the network frames. */
const racksTab = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const frames = $.let(Data.bind(ex.schematicFrames));
    const racks = $.let(Data.bind(ex.schematicRacks));
    const slice = $.let(Slice.bindRecords("schematic.library.racks", {
        racks: { source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByOwner] }), fields: { owner: { label: "Owner" } } },
    }));
    return Schematic({
        id: "racksTab",
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: { network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }) },
        library: [Schematic.library.tab(racks.read(), { name: "Racks", icon: "server", label: (r) => r.name, meta: (r) => some(r.owner), group: (r) => r.hall, source: "racks" })],
    });
}))) };

test("an author's tab lists its rows' cards, and follows the source it names: `2 of 7` while the rail narrows it, its own words with Clear filters when it leaves none", async () => {
    const { container } = await h.mount(racksTab);
    await settle();
    await waitFor(() => expect(tabs(container)).toEqual(["Racks 7"]));
    expect(heads(container)).toEqual([["Cage A", "7"]]);
    // Its cards set nothing where they land — the tab gives no `drop` — so none drags (#1390).
    expect(panel(container).querySelector("[data-draggable]")).toBeNull();
    expect(cards(container).map((c) => [c.key, c.label, c.meta, c.icon])).toEqual([
        ["A01", "A01", "Harbour Labs", "fas server"], ["A02", "A02", "Harbour Labs", "fas server"], ["A03", "A03", "Northwind Media", "fas server"],
        ["A04", "A04", "Northwind Media", "fas server"], ["A05", "A05", "Elmway College", "fas server"], ["A06", "A06", "Elmway College", "fas server"],
        // A rack no one owns: its card has no line under its name.
        ["A07", "A07", null, "fas server"],
    ]);
    await narrow("schematic.library.racks.racks", choose("owner", "Harbour Labs"));
    await waitFor(() => expect(tabs(container)).toEqual(["Racks 2 of 7"]));
    expect(cards(container).map((c) => c.key)).toEqual(["A01", "A02"]);
    await narrow("schematic.library.racks.racks", choose("owner", "Nobody"));
    await waitFor(() => expect(tabs(container)).toEqual(["Racks 0 of 7"]));
    expect(emptyState(container)).toEqual(["fas box-open", "No racks match the filters", "Change or clear the filters to see more racks.", "Clear filters"]);
    await clearFilters(container);
    await waitFor(() => expect(tabs(container)).toEqual(["Racks 7"]));
});

// ── The Backlog (§8, SC4) ───────────────────────────────────────────────────

test("the Backlog lists every item kind's rows with no position under its kind, each its label, its kind's name and its second line; another session's change moves it (SC4)", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Backlog");
    expect(heads(container)).toEqual([["Rack", "2"]]);
    expect(cards(container)).toEqual([
        { key: id("racks", "A06"), label: "A06", meta: "Rack · 48U · 12 kW", icon: "fas server", picked: false },
        { key: id("racks", "A07"), label: "A07", meta: "Rack · 42U · 8 kW", icon: "fas server", picked: false },
    ]);
    // Its rows draw nothing on the canvas.
    expect(card(container, "racks", "A06")).toBeNull();
    // Another session places A06 in the clear floor of the cold aisle, and takes A05 off the floor: A06 draws, A05 joins the backlog.
    const racks = await h.read(ex.schematicRacks);
    await h.patch(ex.schematicRacks, new Map([
        ...racks, ["A06", { ...racks.get("A06")!, x: some(6.0), y: some(6.6) }], ["A05", { ...racks.get("A05")!, x: none, y: none }],
    ]));
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([id("racks", "A05"), id("racks", "A07")]));
    expect(tabs(container)[1]).toBe("Backlog 2");
    await waitFor(() => expect(card(container, "racks", "A06")).not.toBeNull());
    expect(card(container, "racks", "A05")).toBeNull();
});

test("while the rail narrows the racks, the Backlog lists the rows the narrowing holds; one that leaves it none says so, with Clear filters (SC4)", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Backlog");
    await narrow(RACKS, choose("owner", "Elmway College"));
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([id("racks", "A06")]));
    expect(tabs(container)[1]).toBe("Backlog 1");
    await narrow(RACKS, choose("owner", "Harbour Labs"));
    await waitFor(() => expect(cards(container)).toEqual([]));
    expect(emptyState(container)).toEqual(["fas box-open", "No items match the filters", "Change or clear the filters to see more items.", "Clear filters"]);
    await clearFilters(container);
    await waitFor(() => expect(cards(container).map((c) => c.key)).toEqual([id("racks", "A06"), id("racks", "A07")]));
});

// ── A tab's search (ruling 11) ──────────────────────────────────────────────

test("a tab's search finds within that tab alone: the other tabs, the canvas and the rail are as they were", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Templates");
    await search(container, "half");
    expect(cards(container).map((c) => c.key)).toEqual([id("racks", "half")]);
    await search(container, "fibre");
    expect(cards(container).map((c) => c.key)).toEqual([id("fibre", "oob"), id("fibre", "uplink")]);
    await openTab(container, "Backlog");
    expect((within(panel(container)).getByRole("textbox", { name: "Search library" }) as HTMLInputElement).value).toBe("");
    expect(cards(container).map((c) => c.key)).toEqual([id("racks", "A06"), id("racks", "A07")]);
    await search(container, "42U");
    expect(cards(container).map((c) => c.key)).toEqual([id("racks", "A07")]);
    await openTab(container, "Index");
    expect((within(panel(container)).getByRole("textbox", { name: m.indexSearch() }) as HTMLInputElement).value).toBe("");
    // The canvas draws every rack, and no source of the rail is narrowed.
    expect(["A01", "A02", "A03", "A04", "A05"].map((key) => card(container, "racks", key) !== null)).toEqual([true, true, true, true, true]);
    expect(decodeBeast2For(RecordSliceStateType)(StateRuntime.getStore().read(RACK_TEMPLATES)!).where.size).toBe(0);
    await openTab(container, "Templates");
    expect(cards(container).map((c) => c.key)).toEqual([id("fibre", "oob"), id("fibre", "uplink")]);
});

// ── The Index (§8) ──────────────────────────────────────────────────────────

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

/** The Index's tree. */
const treeOf = (container: HTMLElement) => panel(container).querySelector<HTMLElement>('[role="tree"]')!;

/** The row the tree points at, by its name. */
const activeRow = (container: HTMLElement) => {
    const at = treeOf(container).getAttribute("aria-activedescendant");
    return at === null ? undefined : panel(container).ownerDocument.getElementById(at)?.querySelector("[data-index-name]")?.textContent;
};

/** Runs a test's camera on a clock of its own: the fly and each paint land as it moves on. */
async function onTheTestsClock(run: (frames: (ms: number) => Promise<void>) => Promise<void>) {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        await run((ms) => act(async () => { vi.advanceTimersByTime(ms); }));
    } finally {
        vi.useRealTimers();
    }
}

/** Presses a layer's Isolate, Lock or Show in the Layers tab. */
async function layerToggle(container: HTMLElement, layer: string, toggle: "isolate" | "lock" | "show") {
    await act(async () => { fireEvent.click(panel(container).querySelector(`[data-schematic-layer="${layer}"] [data-layer-toggle="${toggle}"]`)!); });
    await settle();
}

test("the Index nests the zones by containment, each counting its items; the items in no zone after them; a hatched aisle holds none", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Index");
    expect(indexRows(container)).toEqual([
        "Cage A ▸ 7", "Cold aisle A · 1.2 m", "Hot aisle A · 1.0 m", "Meet-me room ▸ 1", "Network room ▸ 1", "CRAH-1", "CRAH-2", "CRAH-3", "ODF-1",
    ]);
    // Each row says where it stands among the rows beside it, as the rows scroll out.
    expect(["aria-posinset", "aria-setsize"].map((name) => indexRow(container, "Meet-me room").getAttribute(name))).toEqual(["4", "9"]);
});

test("a zone's row flies to the zone, selects it and lists its items, and the zone the viewport is in is marked; a locked layer's zone is flown to and never selected (SC27)", async () => {
    const { container, getByRole } = await dataCentre();
    await openTab(container, "Index");
    await onTheTestsClock(async (frames) => {
        // The structure layer's zones are locked by its author: Cage A is flown to and opened, and not selected.
        await act(async () => { fireEvent.click(indexRow(container, "Cage A")); });
        await frames(FLY_MS);
        await settle();
        expect(indexRows(container)).toEqual([
            "Cage A ▾ 7", "  A01", "  A02", "  A03", "  A04", "  A05", "  PDU-A", "  PDU-B",
            "Cold aisle A · 1.2 m", "Hot aisle A · 1.0 m", "Meet-me room ▸ 1", "Network room ▸ 1", "CRAH-1", "CRAH-2", "CRAH-3", "ODF-1",
        ]);
        await waitFor(() => expect(indexRow(container, "Cage A").hasAttribute("data-current")).toBe(true));
        expect(indexRow(container, "Cage A").getAttribute("aria-current")).toBe("location");
        expect(keptSelection()).toBe(printRefs([]));
        expect(indexRow(container, "Cage A").hasAttribute("data-selected")).toBe(false);
        // Its chevron closes it, the camera staying where it is.
        await act(async () => { fireEvent.click(indexRow(container, "Cage A").querySelector("button")!); });
        await settle();
        expect(indexRows(container)[0]).toBe("Cage A ▸ 7");
        expect(indexRow(container, "Cage A").hasAttribute("data-current")).toBe(true);
        // Unlocked in the Layers tab, the meet-me room is flown to and selected; the viewport is in it.
        await openTab(container, "Layers");
        await layerToggle(container, "structure", "lock");
        await openTab(container, "Index");
        await act(async () => { fireEvent.click(indexRow(container, "Meet-me room")); });
        await frames(FLY_MS);
        await settle();
        await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "areas", key: "mmr" }])));
        await waitFor(() => expect(indexRow(container, "Meet-me room").hasAttribute("data-selected")).toBe(true));
        expect(indexRow(container, "Meet-me room").hasAttribute("data-current")).toBe(true);
        expect(indexRow(container, "Cage A").hasAttribute("data-current")).toBe(false);
        expect(indexRows(container)).toEqual([
            "Cage A ▸ 7", "Cold aisle A · 1.2 m", "Hot aisle A · 1.0 m", "Meet-me room ▾ 1", "  MMR-1", "Network room ▸ 1", "CRAH-1", "CRAH-2", "CRAH-3", "ODF-1",
        ]);
        // An item's row flies to the item and selects it.
        await act(async () => { fireEvent.click(indexRow(container, "MMR-1")); });
        await frames(FLY_MS);
        await settle();
        await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "network", key: "MMR-1" }])));
        expect(card(container, "network", "MMR-1")?.hasAttribute("data-selected")).toBe(true);
        // Fit, the whole floor in view: no zone is.
        await act(async () => { fireEvent.click(getByRole("button", { name: "Fit" })); });
        await frames(FRAME_MS);
        await settle();
        await waitFor(() => expect(panel(container).querySelector("[data-current]")).toBeNull());
    });
});

test("the Index's keys: the tree is one stop pointing at its active row — ↑ ↓ move, → opens a zone and goes in, ← goes up and closes it, Enter flies", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Index");
    const tree = treeOf(container);
    expect(tree.getAttribute("tabindex")).toBe("0");
    expect(panel(container).querySelectorAll('[role="treeitem"][tabindex]')).toHaveLength(0);
    const key = async (name: string) => { await act(async () => { fireEvent.keyDown(tree, { key: name }); }); await settle(); };
    expect(activeRow(container)).toBe("Cage A");
    await key("ArrowRight");
    expect(indexRows(container)[0]).toBe("Cage A ▾ 7");
    expect(activeRow(container)).toBe("Cage A");
    await key("ArrowRight");
    expect(activeRow(container)).toBe("A01");
    await key("ArrowDown");
    await key("ArrowDown");
    expect(activeRow(container)).toBe("A03");
    await key("ArrowLeft");
    expect(activeRow(container)).toBe("Cage A");
    await key("ArrowLeft");
    expect(indexRows(container)[0]).toBe("Cage A ▸ 7");
    await key("End");
    expect(activeRow(container)).toBe("ODF-1");
    await key("ArrowUp");
    expect(activeRow(container)).toBe("CRAH-3");
    // Enter does the row's click: CRAH-3 is flown to and selected.
    await onTheTestsClock(async (frames) => {
        await key("Enter");
        await frames(FLY_MS);
        await settle();
        await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "cooling", key: "CRAH-3" }])));
    });
    expect(indexRow(container, "CRAH-3").hasAttribute("data-selected")).toBe(true);
    await key("Home");
    expect(activeRow(container)).toBe("Cage A");
});

test("the Index's search keeps the items whose label, key or kind's name holds it, under their zones, opened — and says so when it keeps none", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Index");
    await search(container, "pdu", m.indexSearch());
    expect(indexRows(container)).toEqual(["Cage A ▾ 7", "  PDU-A", "  PDU-B"]);
    // A kind's name: the cooling units, in no zone.
    await search(container, "cooling unit", m.indexSearch());
    expect(indexRows(container)).toEqual(["CRAH-1", "CRAH-2", "CRAH-3"]);
    await search(container, "zz", m.indexSearch());
    expect(indexRows(container)).toEqual([]);
    expect(emptyState(container)).toEqual(["fas box-open", 'No items match "zz"', null, null]);
    await search(container, "", m.indexSearch());
    expect(indexRows(container)).toHaveLength(9);
});

// ── Layers (§8, SC27) ───────────────────────────────────────────────────────

/** Each layer's row as the Layers tab draws it: its name, its count, and which of Isolate, Lock and Show are on. */
const layerRows = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-schematic-layer]")].map((row) => {
    const on = (toggle: string) => row.querySelector(`[data-layer-toggle="${toggle}"]`)!.getAttribute("aria-pressed") === "true";
    const marks = [on("isolate") ? "isolated" : "", on("lock") ? "locked" : "", on("show") ? "" : "hidden"].filter((mark) => mark !== "");
    return [row.children[1]!.textContent, row.children[2]!.textContent, ...marks].join(" ");
});

/** The data centre's layer choices as the UI store keeps them under its `id`; `undefined` before the viewer makes one. */
const storedLayerView = () => {
    const bytes = StateRuntime.getStore().read(schematicKeys("dataCentre").layers);
    return bytes === undefined ? undefined : decodeBeast2For(SchematicLayerViewType)(bytes);
};

/** Layer choices, as the store keeps them. */
const layerView = (shown: Array<[string, boolean]>, locked: Array<[string, boolean]>, isolated: string | undefined) => ({
    shown: new SortedMap(shown, compareString), locked: new SortedMap(locked, compareString), isolated: isolated === undefined ? none : some(isolated),
});

test("the Layers tab lists each layer in its order with how many entities it holds; Hide, Isolate and Show all show and hide them on the canvas and in the Index, and Show all ends an isolation (SC27)", async () => {
    const { container } = await dataCentre();
    await openTab(container, "Layers");
    expect(layerRows(container)).toEqual(["Structure 3 locked", "Power 9", "Cooling 5", "Network 9"]);
    expect(panel(container).querySelector("[data-layers-show-all]")).toBeNull();
    // Hide Power: the racks and the power distribution units leave the canvas, and the Index; Show all offers itself.
    await layerToggle(container, "power", "show");
    expect(layerRows(container)).toEqual(["Structure 3 locked", "Power 9 hidden", "Cooling 5", "Network 9"]);
    await waitFor(() => expect(card(container, "racks", "A01")).toBeNull());
    expect(card(container, "network", "MMR-1")).not.toBeNull();
    // Isolate Network: it alone shows — Power's own choice kept beneath it.
    await layerToggle(container, "network", "isolate");
    expect(layerRows(container)).toEqual(["Structure 3 locked hidden", "Power 9 hidden", "Cooling 5 hidden", "Network 9 isolated"]);
    // Every zone is on a hidden layer: the network frames are in none.
    await openTab(container, "Index");
    expect(indexRows(container)).toEqual(["CORE-1", "MMR-1", "ODF-1"]);
    await openTab(container, "Layers");
    // Show all: every layer shows, the isolation ended; the author's lock stands.
    await act(async () => { fireEvent.click(panel(container).querySelector("[data-layers-show-all]")!); });
    await settle();
    expect(layerRows(container)).toEqual(["Structure 3 locked", "Power 9", "Cooling 5", "Network 9"]);
    await waitFor(() => expect(card(container, "racks", "A01")).not.toBeNull());
    expect(panel(container).querySelector("[data-layers-show-all]")).toBeNull();
    expect(layerViewEqual(storedLayerView()!, layerView([], [], undefined))).toBe(true);
});

test("a locked layer's entities never select — by a tap, the steps or the Index — and the viewer's choices persist under the Schematic's id (SC27)", async () => {
    const first = await dataCentre();
    const { container } = first;
    const canvasOf = () => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;
    await openTab(container, "Layers");
    await layerToggle(container, "power", "lock");
    expect(layerRows(container)).toEqual(["Structure 3 locked", "Power 9 locked", "Cooling 5", "Network 9"]);
    await waitFor(() => expect(card(container, "racks", "A01")!.hasAttribute("data-locked")).toBe(true));
    // A tap on A01's card, clear of the run leaving its centre, falls through it to the floor and selects nothing;
    // a tap on MMR-1, a network frame, selects it.
    const at = (x: number, y: number) => (px: number, py: number) => Math.hypot(px - x * PPU, py - y * PPU) < 4;
    canvasLayout.hits((px, py) => (at(1.2, 2.9)(px, py) ? card(container, "racks", "A01") : at(24.2, 2.9)(px, py) ? card(container, "network", "MMR-1") : null));
    fireEvent.pointerEnter(canvasOf());
    await tap(canvasOf(), PPU, 1.2, 2.9);
    await settle();
    expect(keptSelection()).toBe(printRefs([]));
    expect(card(container, "racks", "A01")!.hasAttribute("data-selected")).toBe(false);
    await tap(canvasOf(), PPU, 24.2, 2.9);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "network", key: "MMR-1" }])));
    // The Index flies to A01 and leaves the selection as it was.
    await openTab(container, "Index");
    await onTheTestsClock(async (frames) => {
        await act(async () => { fireEvent.click(indexRow(container, "Cage A")); });
        await frames(FLY_MS);
        await act(async () => { fireEvent.click(indexRow(container, "A01")); });
        await frames(FLY_MS);
        await settle();
    });
    expect(keptSelection()).toBe(printRefs([{ kind: "network", key: "MMR-1" }]));
    // The choices are kept under the Schematic's id, as an East value: mounted again, Power is still locked.
    expect(layerViewEqual(storedLayerView()!, layerView([], [["power", true]], undefined))).toBe(true);
    first.unmount();
    const again = await dataCentre();
    await openTab(again.container, "Layers");
    expect(layerRows(again.container)).toEqual(["Structure 3 locked", "Power 9 locked", "Cooling 5", "Network 9"]);
    expect(card(again.container, "racks", "A01")!.hasAttribute("data-locked")).toBe(true);
    // Locking a layer lets go of what is selected on it: unlock Power, select A01 by a tap, lock it again.
    await layerToggle(again.container, "power", "lock");
    const canvas = again.container.querySelector<HTMLElement>("[data-schematic-canvas]")!;
    canvasLayout.hits((px, py) => (Math.hypot(px - 2.4 * PPU, py - 2.9 * PPU) < 4 ? card(again.container, "racks", "A01") : null));
    fireEvent.pointerEnter(canvas);
    await tap(canvas, PPU, 2.4, 2.9);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A01" }])));
    await layerToggle(again.container, "power", "lock");
    await waitFor(() => expect(keptSelection()).toBe(printRefs([])));
});

/** A Schematic of the systems layers whose author hides one at first: Show all shows it too. */
const hiddenAtFirst = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const frames = $.let(Data.bind(ex.schematicFrames));
    const cooling = $.let(Data.bind(ex.schematicCooling));
    const systems = $.let(Data.bind(ex.schematicSystems));
    return Schematic({
        id: "hiddenAtFirst",
        extent: { width: 28, height: 14 },
        items: {
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system" }),
            cooling: Schematic.items(cooling, { name: "Cooling unit", icon: "fan", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system" }),
        },
        layers: Schematic.layers(systems.read(), { label: (s) => s.label, order: (s) => s.order, visible: (s) => East.notEqual(s.label, "Cooling") }),
        library: [Schematic.library.layers()],
    });
}))) };

test("a layer its author hides at first starts hidden; Show all shows it, writing the viewer's choice over the author's (SC27)", async () => {
    const { container } = await h.mount(hiddenAtFirst);
    await settle();
    await waitFor(() => expect(card(container, "network", "MMR-1")).not.toBeNull());
    expect(layerRows(container)).toEqual(["Structure 0", "Power 0", "Cooling 3 hidden", "Network 3"]);
    expect(card(container, "cooling", "CRAH-1")).toBeNull();
    await act(async () => { fireEvent.click(panel(container).querySelector("[data-layers-show-all]")!); });
    await settle();
    expect(layerRows(container)).toEqual(["Structure 0", "Power 0", "Cooling 3", "Network 3"]);
    await waitFor(() => expect(card(container, "cooling", "CRAH-1")).not.toBeNull());
    const stored = decodeBeast2For(SchematicLayerViewType)(StateRuntime.getStore().read(schematicKeys("hiddenAtFirst").layers)!);
    expect(layerViewEqual(stored, layerView([["cooling", true]], [], undefined))).toBe(true);
});
