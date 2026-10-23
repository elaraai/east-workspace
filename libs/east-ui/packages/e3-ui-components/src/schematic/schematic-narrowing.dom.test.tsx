/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's narrowing on e3 itself (#1392, `Schematic Builder Spec.md`
 * §10.2, §10.3, SC17, SC18): one `Slice.bindRecords`, each source narrowing its
 * kind everywhere it appears. Hidden — the default — a choice leaves the
 * canvas, the drawing's counts, the Index, the Backlog, the inspector's Choosers
 * and what an item is joined to the racks it holds, and a run or a feed whose
 * racks it hides goes with them. Dimmed (`narrowed="dim"`), the racks it leaves
 * out draw as context — faded, greyed and taking no tap — out of every list and
 * count, a draft among them drawn where its draft has it; every rack is read
 * once, whatever the choice. A match's emphasis rings its card, and `fit` flies
 * the camera to the matches as they change. A choice builds the Schematic no
 * more (#1354): its body runs no more, and no payload is decoded.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin, and each card the tests press answers at
 * its centre.
 */

import { expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
    ArrayType, East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant, type EastIR, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { countBuilds, type UIProgram } from "../shared/builds.test-utils.js";
import { at, card, drawingCounts, fitted, layOutCanvas, near, tap, unsaved } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The camera the canvas fits a 28 × 14 m drawing with — the data centre's. */
const CAM = fitted(28, 14);

/** Longer than a fly takes (350 ms): run on the test's clock, it lands. */
const FLY_MS = 400;

const printText = printFor(StringType);
const printRefs = printFor(ArrayType(Schematic.Types.Ref));
const compareString = compareFor(StringType);

/**
 * Where each card the tests press sits, by kind, key and centre in metres. The power distribution units, whose 1.2 m holds
 * no card's words at Fit, draw as their pins, which the canvas hits itself (#1393).
 */
const CENTRES: readonly (readonly [kind: string, key: string, x: number, y: number])[] = [
    ["racks", "A01", 2.4, 2.9], ["racks", "A02", 6.0, 2.9], ["racks", "A03", 9.6, 2.9], ["racks", "A04", 13.2, 2.9], ["racks", "A05", 16.8, 2.9],
    ["network", "MMR-1", 24.2, 2.9], ["network", "ODF-1", 8.4, 9.6],
];

/** The canvas. */
const canvasOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** Lets each card answer at its centre, as a page would hit it, and the canvas everywhere else on it. */
function hits(c: HTMLElement) {
    const canvas = canvasOf(c);
    const found = CENTRES.flatMap(([kind, key, x, y]) => {
        const el = card(c, kind, key);
        return el === null ? [] : [[el, x, y] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y]) => near(CAM, px, py, x, y))?.[0]
        ?? (px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvas : null));
}

/** Mounts a Schematic — a program compiled from it, counted, in its place — and waits until its racks are drawn and laid out for a press. */
async function open(example: { fn: { toIR(): unknown } }, program?: UIProgram) {
    const ui = await h.mount(example, program === undefined ? {} : { program });
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    hits(ui.container);
    fireEvent.pointerEnter(canvasOf(ui.container));
    return ui;
}

// ── The rail's narrowing, as the rail writes it ─────────────────────────────

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** A choice of values of one field. */
const choose = (field: string, ...values: string[]): Where => new SortedMap([[field, variant("values", values.map((value) => printText(value)))]], compareString);

/** No choice. */
const NOTHING: Where = new SortedMap([], compareString);

/** Writes a source's narrowing, as the rail does. */
async function narrow(key: string, where: Where) {
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

/** The racks' record, as its dataset's requests name it. */
const RACKS_DATASET = `records.${ex.schematicRacks.name}`;

/** Each read of the racks' entries, by the index it reads through — the record's own entries naming none. */
const rackReads = () => [...h.requests("page", RACKS_DATASET), ...h.requests("runs", RACKS_DATASET)].map((request) => request.query.get("index") ?? "");

// ── What the frame shows ────────────────────────────────────────────────────

/** The library pane. */
const library = (c: HTMLElement) => slot(c, "start");
/** The library's tabs, as their row draws them. */
const libraryTabs = (c: HTMLElement) => [...library(c).querySelectorAll('[role="tab"]')].map((t) => t.textContent);
/** The library's open panel. */
const libraryPanel = (c: HTMLElement) => library(c).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** Opens a library tab, by its name. */
async function openLibraryTab(c: HTMLElement, name: string) {
    const tab = [...library(c).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    await act(async () => { fireEvent.click(tab); });
    await settle();
}

/** The Index's rows as a reader meets them: each indented by its level, its name, its open mark and its count. */
const indexRows = (c: HTMLElement) => [...libraryPanel(c).querySelectorAll<HTMLElement>('[role="treeitem"]')].map((row) => {
    const pad = "  ".repeat(Number(row.getAttribute("aria-level")) - 1);
    const expanded = row.getAttribute("aria-expanded");
    const count = row.querySelector("[data-index-count]")?.textContent;
    return `${pad}${row.querySelector("[data-index-name]")!.textContent}${expanded === "true" ? " ▾" : expanded === "false" ? " ▸" : ""}${count === undefined ? "" : ` ${count}`}`;
});

/** Opens an Index zone's row by its chevron, the camera where it is. */
async function openZone(c: HTMLElement, name: string) {
    const row = [...libraryPanel(c).querySelectorAll<HTMLElement>('[role="treeitem"]')].find((r) => r.querySelector("[data-index-name]")!.textContent === name)!;
    await act(async () => { fireEvent.click(row.querySelector("button")!); });
    await settle();
}

/** The open panel's cards' keys. */
const libraryCards = (c: HTMLElement) => [...libraryPanel(c).querySelectorAll("[data-library-item]")].map((el) => el.getAttribute("data-library-item"));

/** The open panel's empty state: its title and its action, or `null` while it shows none. */
const emptyState = (c: HTMLElement) => {
    const empty = libraryPanel(c).querySelector<HTMLElement>("[data-library-empty]");
    return empty === null ? null : [within(empty).getByRole("heading").textContent, empty.querySelector("button")?.textContent ?? null];
};

/** The inspector's open panel. */
const inspector = (c: HTMLElement) => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** What Details shows. */
const showing = (c: HTMLElement) => inspector(c).querySelector("[data-schematic-inspector]")?.getAttribute("data-schematic-inspector") ?? null;
/** What an item is joined to, as Details lists it, by the entities' ids. */
const joins = (c: HTMLElement) => [...inspector(c).querySelectorAll("[data-inspector-join]")].map((el) => el.getAttribute("data-inspector-join"));

/** The words of each choice a Chooser in Details offers, by its section and its field. */
async function offered(c: HTMLElement, section: string, field: string): Promise<string[]> {
    const trigger = inspector(c).querySelector<HTMLElement>(`[data-inspector-fields="${section}"] [data-field="${field}"] [data-scope=select][data-part=trigger]`)!;
    await act(async () => { fireEvent.click(trigger); });
    const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    const words = within(listbox).getAllByRole("option").map((option) => option.textContent ?? "");
    await act(async () => { fireEvent.keyDown(listbox, { key: "Escape" }); });
    await settle();
    return words;
}

/** Reads what the data centre's host keeps of the selection: its State, read through East. */
const readKeptSelection = East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
    return kept.read();
}), getRegisteredPlatformImplementations());

/** What the data centre's host keeps of the selection, as East prints it. */
const keptSelection = () => printRefs(readKeptSelection());

/** An entity's id, as the canvas names it. */
const id = (kind: string, key: string) => printFor(Schematic.Types.Ref)({ kind, key });

// ── Hidden (§10.2, §10.3) ───────────────────────────────────────────────────

/** The rail's key over the floor whose narrowed-out racks are hidden. */
const HIDDEN = "schematic.narrowing.hidden";

/**
 * The data centre's floor, its racks read through their source of the rail by
 * owner, a narrowed-out rack hidden — the default: the frames, the power
 * distribution units, the areas, the fibre runs and the power feeds read
 * whole, the Backlog and the Index in its library, and the inspector.
 */
const hiddenFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const pdus = $.let(Data.bind(ex.schematicPdus));
    const areas = $.let(Data.bind(ex.schematicAreas));
    const fibre = $.let(Record.bind(ex.schematicFibre, [ex.schematicFibrePatch]));
    const feeds = $.let(Record.bind(ex.schematicFeeds, [ex.schematicFeedsPatch]));
    const slice = $.let(Slice.bindRecords(HIDDEN, {
        racks: { source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByOwner] }), fields: { owner: { label: "Owner" } } },
    }));
    const ends = { rack: "racks", frame: "network" } as const;
    return Schematic({
        id: "hidden",
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
            pdus: Schematic.items(pdus, { name: "Power distribution unit", icon: "plug", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
        zones: {
            areas: Schematic.zones(areas, {
                name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name",
                pattern: (a) => a.kind.match({ room: (_$2) => Schematic.outline(), cold: (_$2) => Schematic.hatch(), hot: (_$2) => Schematic.hatch() }),
            }),
        },
        links: { fibre: Schematic.links(fibre, { name: "Fibre run", icon: "bolt", via: "path", from: { field: "from", of: ends }, to: { field: "to", of: ends } }) },
        nets: { feeds: Schematic.nets(feeds, { name: "Power feed", icon: "plug-circle-bolt", sources: { field: "supply", of: "pdus" }, destinations: { field: "racks", of: "racks" } }) },
        library: [Schematic.library.backlog(), Schematic.library.index()],
    });
}))) };

test("hidden — the default — a choice leaves the canvas and the counts the racks it holds, and a run or a feed whose racks it hides goes with them (§10.2, SC17)", async () => {
    const { container } = await open(hiddenFloor);
    expect(drawingCounts(container)).toEqual({ racks: "5", network: "3", pdus: "2", zones: "5", links: "6", nets: "2" });
    await narrow(`${HIDDEN}.racks`, choose("owner", "Harbour Labs"));
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    expect(["A01", "A02", "A04", "A05"].map((key) => card(container, "racks", key) !== null)).toEqual([true, true, false, false]);
    // u1, u2 and u2m run from Harbour Labs' racks, and x1 joins two frames: they stand. u3 and u4 go with their racks,
    // and so does feed B, whose racks are all hidden; feed A still feeds A01 and A02.
    expect(drawingCounts(container)).toEqual({ racks: "2", network: "3", pdus: "2", zones: "5", links: "4", nets: "1" });
    // Let back in, every rack draws again.
    await narrow(`${HIDDEN}.racks`, NOTHING);
    await waitFor(() => expect(card(container, "racks", "A03")).not.toBeNull());
    expect(drawingCounts(container)).toEqual({ racks: "5", network: "3", pdus: "2", zones: "5", links: "6", nets: "2" });
});

test("hidden, the Index and the Backlog list only what the narrowing holds, and the inspector's Choosers and what an item is joined to offer only what it shows (§10.2, SC17)", async () => {
    const { container } = await open(hiddenFloor);
    await narrow(`${HIDDEN}.racks`, choose("owner", "Elmway College"));
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    // The Index: Cage A holds Elmway College's placed rack and the units.
    await openLibraryTab(container, "Index");
    expect(indexRows(container)[0]).toBe("Cage A ▸ 3");
    await openZone(container, "Cage A");
    expect(indexRows(container).slice(0, 4)).toEqual(["Cage A ▾ 3", "  A05", "  PDU-A", "  PDU-B"]);
    // The Backlog: Elmway College's unplaced rack, A06; A07, which no one owns, is narrowed out.
    expect(libraryTabs(container)[0]).toBe("Backlog 1");
    await openLibraryTab(container, "Backlog");
    expect(libraryCards(container)).toEqual([id("racks", "A06")]);
    // Northwind Media's racks: none unplaced — the Backlog says so, with Clear filters.
    await narrow(`${HIDDEN}.racks`, choose("owner", "Northwind Media"));
    await waitFor(() => expect(libraryCards(container)).toEqual([]));
    expect(emptyState(container)).toEqual(["No items match the filters", "Clear filters"]);
    // u3 runs from A03, Northwind Media's: its ends' Choosers offer Northwind Media's racks and the frames, nothing the narrowing hides.
    await tap(canvasOf(container), CAM, 9.6, 6.0);
    await waitFor(() => expect(showing(container)).toBe("link"));
    expect(await offered(container, "ends", "from")).toEqual(["A03 · Rack", "A04 · Rack", "CORE-1 · Network frame", "MMR-1 · Network frame", "ODF-1 · Network frame"]);
    // The Esc that closed the Chooser's list was the list's: the run stays selected.
    expect(showing(container)).toBe("link");
    // ODF-1, where u3 ends, tapped: it is selected, though the run's end is a handle there. It is joined to the runs of
    // the racks the narrowing holds: u3 and u4; u1, u2 and u2m go with Harbour Labs' racks.
    await tap(canvasOf(container), CAM, 8.4, 9.6);
    await waitFor(() => expect(showing(container)).toBe("item"));
    expect(joins(container)).toEqual([id("fibre", "u3"), id("fibre", "u4")]);
});

// ── Dimmed (§10.3) ──────────────────────────────────────────────────────────

/** The data centre's racks' narrowing, as the rail keeps it. */
const RACKS = "ex.schematicDataCentre.racks";

test("dimmed, the racks a choice leaves out draw as context — faded, greyed, taking no tap — and leave every list and count; every rack is read once, whatever the choice (§10.3, SC18)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    expect(drawingCounts(container)).toEqual({ racks: "5", network: "3", cooling: "3", pdus: "2", zones: "5", links: "6", nets: "2" });
    // Every rack read: the record's own entries, read once — never through the owner index, which no choice narrows yet.
    const read = rackReads();
    expect(read.length).toBeGreaterThan(0);
    expect(read.filter((index) => index === ex.schematicRacksByOwner.name)).toEqual([]);
    await narrow(RACKS, choose("owner", "Harbour Labs"));
    await waitFor(() => expect(card(container, "racks", "A03")?.hasAttribute("data-context")).toBe(true));
    // Northwind Media's and Elmway College's racks: context, greyed, faded to the look's 0.35; Harbour Labs' as themselves.
    for (const key of ["A03", "A04", "A05"]) {
        const el = card(container, "racks", key)!;
        expect([el.hasAttribute("data-context"), el.hasAttribute("data-desaturate"), el.style.getPropertyValue("--schematic-context-opacity")]).toEqual([true, true, "0.35"]);
    }
    for (const key of ["A01", "A02"]) expect(card(container, "racks", key)!.hasAttribute("data-context")).toBe(false);
    // Context counts nowhere: Harbour Labs' racks, their runs and the frames' cross-connect, and feed A.
    expect(drawingCounts(container)).toEqual({ racks: "2", network: "3", cooling: "3", pdus: "2", zones: "5", links: "4", nets: "1" });
    // The choice read the narrowing's keys through the owner index, and no rack again.
    await waitFor(() => expect(rackReads().some((index) => index === ex.schematicRacksByOwner.name)).toBe(true));
    expect(rackReads().filter((index) => index !== ex.schematicRacksByOwner.name)).toEqual(read);
    // A tap on A03's card selects nothing: it is context. A01's selects it.
    await tap(canvas, CAM, 9.6, 2.9);
    await settle();
    expect(keptSelection()).toBe(printRefs([]));
    await tap(canvas, CAM, 2.4, 2.9);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A01" }])));
    // The Index lists Harbour Labs' racks and the units in Cage A.
    await openLibraryTab(container, "Index");
    await openZone(container, "Cage A");
    expect(indexRows(container).slice(0, 5)).toEqual(["Cage A ▾ 4", "  A01", "  A02", "  PDU-A", "  PDU-B"]);
    // The Backlog: no rack of Harbour Labs' is unplaced.
    expect(libraryTabs(container)[1]).toBe("Backlog 0");
    // ODF-1 is joined to Harbour Labs' racks' runs alone.
    await tap(canvas, CAM, 8.4, 9.6);
    await waitFor(() => expect(showing(container)).toBe("item"));
    expect(joins(container)).toEqual([id("fibre", "u1"), id("fibre", "u2"), id("fibre", "u2m")]);
    // Let back in: no context, every count as it was.
    await narrow(RACKS, NOTHING);
    await waitFor(() => expect(card(container, "racks", "A03")!.hasAttribute("data-context")).toBe(false));
    // Nothing selected, Details shows the drawing's counts.
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    await settle();
    expect(drawingCounts(container)).toEqual({ racks: "5", network: "3", cooling: "3", pdus: "2", zones: "5", links: "6", nets: "2" });
});

test("dimmed, a draft the narrowing leaves out draws where its draft has it, as context, and Save sends it (SC23)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name: "Move" })); });
    // A03 moved down into the clear floor below its row.
    await act(async () => {
        fireEvent.pointerDown(canvasOf(container), { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(CAM, 9.6, 2.9) });
        fireEvent.pointerMove(canvasOf(container), { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(CAM, 9.6, 5.0) });
        fireEvent.pointerUp(canvasOf(container), { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, ...at(CAM, 9.6, 5.0) });
    });
    await settle();
    const moved = card(container, "racks", "A03")!.style.transform;
    await narrow(RACKS, choose("owner", "Harbour Labs"));
    await waitFor(() => expect(card(container, "racks", "A03")?.hasAttribute("data-context")).toBe(true));
    expect(card(container, "racks", "A03")!.style.transform).toBe(moved);
    expect(unsaved(container)).toBe(true);
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name: editingMessages.apply() })); });
    await settle();
    const saved = (await h.read(ex.schematicRacks)).get("A03")!;
    expect(saved.y.type === "some" ? saved.y.value : undefined).toBeCloseTo(5.0, 9);
});

// ── The matches: emphasis and fit (§10.3) ───────────────────────────────────

/** The rail's key over the floor whose matches are ringed and flown to. */
const RINGED = "schematic.narrowing.ringed";

/** The data centre's racks read through their source, dimmed, each match ringed by a halo and flown to as the narrowing changes. */
const ringedFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const slice = $.let(Slice.bindRecords(RINGED, {
        racks: { source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByOwner] }), fields: { owner: { label: "Owner" } } },
    }));
    return Schematic({
        id: "ringed",
        extent: { width: 28, height: 14 },
        slice: { slice },
        narrowed: { show: "dim", emphasis: "halo", fit: true },
        items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries }) },
    });
}))) };

test("a match's emphasis rings its card, and fit flies the camera to the matches as the narrowing changes — never while it narrows nothing (§10.3)", async () => {
    const { container } = await open(ringedFloor);
    const layer = () => container.querySelector<HTMLElement>("[data-card-key]")!.parentElement!;
    const zoom = () => Number(layer().style.getPropertyValue("--cam-ppu"));
    const atFit = zoom();
    expect(card(container, "racks", "A01")!.hasAttribute("data-emphasis")).toBe(false);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        await narrow(`${RINGED}.racks`, choose("owner", "Harbour Labs"));
        await waitFor(() => expect(card(container, "racks", "A01")?.getAttribute("data-emphasis")).toBe("halo"));
        expect(card(container, "racks", "A02")!.getAttribute("data-emphasis")).toBe("halo");
        expect(card(container, "racks", "A03")!.hasAttribute("data-emphasis")).toBe(false);
        // The camera flies in to A01 and A02, the floor's left end: some twice as close as the floor fitted whole.
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
        await settle();
        expect(zoom()).toBeGreaterThan(atFit * 1.5);
        // Cleared: no ring, and the camera stays where it was.
        const flown = zoom();
        await narrow(`${RINGED}.racks`, NOTHING);
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
        await settle();
        expect(card(container, "racks", "A01")!.hasAttribute("data-emphasis")).toBe(false);
        expect(zoom()).toBe(flown);
    } finally {
        vi.useRealTimers();
    }
});

// ── A choice rebuilds no builder (#1354) ────────────────────────────────────

/** An example's program, compiled. */
const programOf = (example: { fn: { toIR(): unknown } }): UIProgram =>
    (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());

test("a choice on the rail builds the Schematic no more, hidden or dimmed: the canvas and its lists follow it over the payload it mounted with (#1354)", async () => {
    for (const [floor, key, gone] of [[hiddenFloor, `${HIDDEN}.racks`, "null"], [ex.schematicDataCentre, RACKS, "context"]] as const) {
        const builds = countBuilds("Schematic", programOf(floor));
        try {
            const { container, unmount } = await open(floor, builds.program);
            const mounted = [builds.runs, builds.decodes];
            expect(Math.min(...mounted)).toBeGreaterThan(0);
            await narrow(key, choose("owner", "Harbour Labs"));
            await waitFor(() => expect(gone === "null" ? card(container, "racks", "A03") : card(container, "racks", "A03")?.getAttribute("data-context")).toBe(gone === "null" ? null : ""));
            await narrow(key, NOTHING);
            await waitFor(() => expect(card(container, "racks", "A03")?.hasAttribute("data-context")).toBe(false));
            expect([builds.runs, builds.decodes], "no choice runs the body again or decodes a payload").toEqual(mounted);
            unmount();
        } finally {
            builds.restore();
        }
    }
});
