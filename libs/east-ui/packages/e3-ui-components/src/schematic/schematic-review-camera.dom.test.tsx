/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Review of PR #1397: what a camera move must leave alone over a kind read by
 * area (#1393) — the selection, the camera itself under `fit`, and the
 * drawing's counts — and a key the canvas takes from a button inside the
 * frame while the pointer rests over it. Each test states the behaviour the
 * Schematic's docs give, and fails on the code under review.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin, and each card the tests press answers at
 * its centre.
 */

import { expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import {
    ArrayType, East, NullType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { at, cameraOf, card, drawingCounts, fitted, layOutCanvas, near, tap, zoomInto } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The camera the canvas fits a 28 × 14 m drawing with. */
const CAM = fitted(28, 14);

/** Longer than a fly takes (350 ms): run on the test's clock, it lands. */
const FLY_MS = 400;

const printText = printFor(StringType);
const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);

/** The rail's key over the floor. */
const FLOOR = "schematic.review.camera";

/** The racks' record, as its dataset's requests name it. */
const RACKS = `records.${ex.schematicRacks.name}`;

/** Where the floor's host keeps the whole selection, as `onSelect` hears it. */
const KEPT = "schematic.review.camera.selected";

/**
 * The data centre's racks read by area, read only — their source lists their area index, one led by owner, and one by
 * name — the network frames and the fibre runs between them read whole, and the inspector: as
 * `schematic-window-reads.dom.test.tsx`'s floor, a narrowed-out rack hidden, the host keeping the whole selection
 * `onSelect` hears in a State of its own.
 */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bindPaged(ex.schematicRacks));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const fibre = $.let(Data.bind(ex.schematicFibre));
    const selected = $.let(State.bind([ArrayType(Schematic.Types.Ref)], KEPT, []));
    const onSelect = $.const(East.function([ArrayType(Schematic.Types.Ref)], NullType, ($2, refs) => {
        $2(selected.write(refs));
    }));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByArea, ex.schematicRacksByOwnerArea, ex.schematicRacksByName] }),
            search: ["name"],
            fields: { name: { label: "Rack" }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] } },
        },
    }));
    return Schematic({
        id: "reviewCamera",
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        onSelect,
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
        links: {
            fibre: Schematic.links(fibre, {
                name: "Fibre run", icon: "bolt", from: { field: "from", of: { rack: "racks", frame: "network" } }, to: { field: "to", of: { rack: "racks", frame: "network" } },
            }),
        },
    });
}))) };

/** The floor, a narrowed-out rack dimmed and the camera flown to the matches as the narrowing changes: as {@link floor} otherwise. */
const fitFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bindPaged(ex.schematicRacks));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByArea, ex.schematicRacksByOwnerArea, ex.schematicRacksByName] }),
            search: ["name"],
            fields: { name: { label: "Rack" }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] } },
        },
    }));
    return Schematic({
        id: "reviewFit",
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        narrowed: { show: "dim", fit: true },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
    });
}))) };

const keptEqual = equalFor(ArrayType(Schematic.Types.Ref));

/** Reads what the floor's host keeps of the selection: its State, read through East. */
const readKept = East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], KEPT, []));
    return kept.read();
}), getRegisteredPlatformImplementations());

/** What the inspector's Details titles the item it shows; `null` while it shows no item. */
const detailsTitle = (c: HTMLElement) => slot(c, "end")
    .querySelector("[role='tabpanel']:not([hidden]) [data-schematic-inspector='item'] [data-inspector-title]")?.textContent ?? null;

/** The item's own fields as Details shows them: whether its section is there, read — not its placeholders, nor that it has no row. */
const detailsRead = (c: HTMLElement) => {
    const shown = slot(c, "end").querySelector("[role='tabpanel']:not([hidden]) [data-schematic-inspector='item']");
    const fields = shown?.querySelector("[data-inspector-fields='row']");
    return fields !== null && fields !== undefined && !fields.hasAttribute("data-pending") && shown?.querySelector("[data-inspector-fact='row-none']") === null;
};

/** Where each card the tests press sits, by kind, key and centre in metres. */
const CENTRES: readonly (readonly [kind: string, key: string, x: number, y: number])[] = [
    ["racks", "A01", 2.4, 2.9], ["racks", "A05", 16.8, 2.9], ["network", "MMR-1", 24.2, 2.9],
];

/** The canvas. */
const canvasOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** Lets each card answer at its centre at Fit, as a page would hit it, and the canvas everywhere else on it. */
function hits(c: HTMLElement) {
    const canvas = canvasOf(c);
    const found = CENTRES.flatMap(([kind, key, x, y]) => {
        const el = card(c, kind, key);
        return el === null ? [] : [[el, x, y] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y]) => near(CAM, px, py, x, y))?.[0]
        ?? (px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvas : null));
}

/** Mounts a floor, waits until its racks are drawn, and lets its cards answer a press. */
async function open(example: { fn: { toIR(): unknown } }) {
    const ui = await h.mount(example);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    await settle();
    hits(ui.container);
    fireEvent.pointerEnter(canvasOf(ui.container));
    return ui;
}

/** The racks' runs read through the area index the window reads through: one a window. */
const windowReads = () => h.requests("runs", RACKS).filter((request) => request.query.get("index") === ex.schematicRacksByArea.name).length;

/** Zooms into a world box, and waits until the window it reads has landed. */
async function zoomAndLand(container: HTMLElement, box: { minX: number; minY: number; maxX: number; maxY: number }) {
    const before = windowReads();
    await zoomInto(canvasOf(container), cameraOf(container), box);
    await waitFor(() => expect(windowReads()).toBeGreaterThan(before), { timeout: 5_000 });
    await settle();
}

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** Writes the racks' narrowing, as the rail does. */
async function narrow(where: Where) {
    const key = `${FLOOR}.racks`;
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

/** Whether each of some cards draws selected. */
const selectedCards = (c: HTMLElement, cards: readonly (readonly [string, string])[]) => cards.map(([kind, key]) => card(c, kind, key)?.hasAttribute("data-selected") ?? null);

test("a zoom lets go of nothing selected: a rack read by area that the zoomed window no longer holds stays selected, as a frame read whole does", async () => {
    const { container, getByRole } = await open(floor);
    const canvas = canvasOf(container);
    // A05 tapped, MMR-1 added with Shift: both selected.
    await tap(canvas, CAM, 16.8, 2.9);
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, shiftKey: true, ...at(CAM, 24.2, 2.9) });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, shiftKey: true, ...at(CAM, 24.2, 2.9) });
    });
    await waitFor(() => expect(selectedCards(container, [["racks", "A05"], ["network", "MMR-1"]])).toEqual([true, true]));
    // A zoom into the cage's left corner, around A01: its window holds neither A05 nor any rack but A01.
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    // Fit again: the floor's window draws A05 once more. Nothing but a camera move happened: both are still selected.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        await act(async () => { fireEvent.click(getByRole("button", { name: "Fit" })); });
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
    } finally {
        vi.useRealTimers();
    }
    await settle();
    await waitFor(() => expect(card(container, "racks", "A05")).not.toBeNull(), { timeout: 5_000 });
    expect(selectedCards(container, [["racks", "A05"], ["network", "MMR-1"]])).toEqual([true, true]);
});

test("a zoom is heard by no onSelect: what the host keeps of the selection stays as the tap left it, the rack off the window", async () => {
    const { container } = await open(floor);
    await tap(canvasOf(container), CAM, 16.8, 2.9);
    await waitFor(() => expect(keptEqual(readKept(), [{ kind: "racks", key: "A05" }])).toBe(true));
    // A zoom into the cage's left corner, around A01: its window holds no A05.
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    expect(card(container, "racks", "A05")).toBeNull();
    await settle();
    expect(keptEqual(readKept(), [{ kind: "racks", key: "A05" }])).toBe(true);
});

test("Details shows a rack read by area that the zoomed window no longer holds, read by its key (§4.5)", async () => {
    const { container } = await open(floor);
    await tap(canvasOf(container), CAM, 16.8, 2.9);
    await waitFor(() => expect([detailsTitle(container), detailsRead(container)]).toEqual(["A05", true]));
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    expect(card(container, "racks", "A05")).toBeNull();
    await settle();
    await waitFor(() => expect([detailsTitle(container), detailsRead(container)]).toEqual(["A05", true]));
});

test("a rack off the window is let go of once a read proves it gone: another session deletes it, and onSelect hears it", async () => {
    const { container } = await open(floor);
    await tap(canvasOf(container), CAM, 16.8, 2.9);
    await waitFor(() => expect(keptEqual(readKept(), [{ kind: "racks", key: "A05" }])).toBe(true));
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    expect(keptEqual(readKept(), [{ kind: "racks", key: "A05" }])).toBe(true);
    // Another session deletes A05: read again by its key at the revision that commit makes, it is gone.
    const racks = await h.read(ex.schematicRacks);
    await h.patch(ex.schematicRacks, new Map([...racks].filter(([key]) => !stringEqual(key, "A05"))));
    await waitFor(() => expect(keptEqual(readKept(), [])).toBe(true), { timeout: 5_000 });
    expect(detailsTitle(container)).toBeNull();
});

test("a rack off the window is let go of once a new choice leaves it out — asked of the narrowing by its row — and kept while one holds it", async () => {
    const { container } = await open(floor);
    await tap(canvasOf(container), CAM, 16.8, 2.9);
    await waitFor(() => expect(keptEqual(readKept(), [{ kind: "racks", key: "A05" }])).toBe(true));
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    // Elmway College's racks chosen: A05 is theirs, and stays selected, Details showing it.
    await narrow(new SortedMap([["owner", variant("values", [printText("Elmway College")])]], compareString));
    expect([keptEqual(readKept(), [{ kind: "racks", key: "A05" }]), detailsTitle(container)]).toEqual([true, "A05"]);
    // Northwind Media's chosen instead: A05 is let go of.
    await narrow(new SortedMap([["owner", variant("values", [printText("Northwind Media")])]], compareString));
    await waitFor(() => expect(keptEqual(readKept(), [])).toBe(true), { timeout: 5_000 });
    expect(detailsTitle(container)).toBeNull();
});

test("fit flies the camera when the narrowing changes, never as a zoom moves the window over a kind read by area (§10.3)", async () => {
    const { container } = await open(fitFloor);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        // Harbour Labs' and Elmway College's racks chosen, A01, A02 and A05: the camera flies to them, and their window lands.
        await narrow(new SortedMap([["owner", variant("values", [printText("Harbour Labs"), printText("Elmway College")])]], compareString));
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
        await settle();
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
        await settle();
    } finally {
        vi.useRealTimers();
    }
    // The viewer zooms in on the cage's left corner, around A01, whose window holds A01 to A04 but not A05. The narrowing
    // stands as it was: nothing may fly the camera from where they put it. Its window's read is counted from before the
    // zoom, as `zoomAndLand` counts it: on a busy machine the read starts before the zoom returns.
    const before = windowReads();
    await zoomInto(canvasOf(container), cameraOf(container), { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    const zoomed = cameraOf(container);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        await waitFor(() => expect(windowReads()).toBeGreaterThan(before), { timeout: 5_000 });
        await settle();
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
        await settle();
    } finally {
        vi.useRealTimers();
    }
    expect(cameraOf(container)).toEqual(zoomed);
});

test("fit flies to a narrowing's racks read by area as their area index finds them, the window off them: zoomed into A01's corner, Elmway College's A05 chosen (§10.3)", async () => {
    const { container } = await open(fitFloor);
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    expect(card(container, "racks", "A05")).toBeNull();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        await narrow(new SortedMap([["owner", variant("values", [printText("Elmway College")])]], compareString));
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
        await settle();
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
        await settle();
    } finally {
        vi.useRealTimers();
    }
    // A05, at 16.8, 2.9, in view: the camera flew to the box its area index's cells hold it in — an 8 m cell, its box 3.2 m wide.
    const cam = cameraOf(container);
    const [sx, sy] = [16.8 * cam.ppu + cam.tx, 2.9 * cam.ppu + cam.ty];
    expect([sx > 0 && sx < 1080, sy > 0 && sy < 540]).toEqual([true, true]);
});

test("the drawing's counts, nothing selected, stay as they are while a zoom moves the window of a kind read by area (§9)", async () => {
    const { container } = await open(floor);
    const atFit = drawingCounts(container);
    expect(atFit["racks"]).toBe("5");
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    expect(drawingCounts(container)).toEqual(atFit);
});

/** What the drawing's Details says it does not count, each line; none while it counts everything. */
const uncounted = (c: HTMLElement) => [...slot(c, "end").querySelectorAll("[role='tabpanel']:not([hidden]) [data-inspector-uncounted]")].map((el) => el.textContent);

test("the drawing's links, nothing selected, are never counted from the window of the kind read by area they join: Details says it does not count them, wherever the view goes (§9)", async () => {
    const { container } = await open(floor);
    const words = ["Links not counted: what they join is read as the view moves"];
    expect([drawingCounts(container)["links"], uncounted(container)]).toEqual([undefined, words]);
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    expect([drawingCounts(container)["links"], uncounted(container)]).toEqual([undefined, words]);
});

/** What the inspector's Issues says it checks only in view, each line; none while it checks every row. */
const unchecked = (c: HTMLElement) => [...slot(c, "end").querySelectorAll("[role='tabpanel']:not([hidden]) [data-inspector-unchecked]")].map((el) => el.textContent);

test("Issues checks a kind read by area in the rows read around the view, and one line says its other rows are checked as the view reaches them (ruled 27 Oct 2026)", async () => {
    const { container } = await open(floor);
    const issues = [...slot(container, "end").querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.startsWith("Issues"));
    if (issues === undefined) throw new Error("the inspector has no Issues tab");
    await act(async () => { fireEvent.click(issues); });
    await settle();
    // The racks, read by area, are named; the frames, read whole, are checked every row.
    expect(unchecked(container)).toEqual(["Racks out of view are checked only as the view reaches them"]);
});

test("Space on a button of the frame is the button's, even while the pointer rests over the canvas", async () => {
    const { getByRole } = await open(floor);
    const fit = getByRole("button", { name: "Fit" });
    fit.focus();
    // `fireEvent` answers false when a listener prevented the key's default — the button's own activation.
    const pressed = fireEvent.keyDown(fit, { key: " ", code: "Space" });
    fireEvent.keyUp(fit, { key: " ", code: "Space" });
    expect(pressed).toBe(true);
});

test("Space on a tool's radio is the radio's, the tool held as it was; on the canvas itself it holds Select while it is down", async () => {
    const { container, getByRole } = await open(floor);
    const canvas = canvasOf(container);
    const marquee = getByRole("radio", { name: "Marquee" });
    await act(async () => { fireEvent.click(marquee); });
    expect(canvas.getAttribute("data-tool")).toBe("marquee");
    // The radio focused, the pointer over the canvas: Space is the radio's, and no tool is held for it.
    marquee.focus();
    let pressed = true;
    await act(async () => { pressed = fireEvent.keyDown(marquee, { key: " ", code: "Space" }); });
    expect([pressed, canvas.getAttribute("data-tool")]).toEqual([true, "marquee"]);
    await act(async () => { fireEvent.keyUp(marquee, { key: " ", code: "Space" }); });
    // The canvas focused: Space holds Select while it is down, and lets go as it comes up.
    canvas.focus();
    await act(async () => { pressed = fireEvent.keyDown(canvas, { key: " ", code: "Space" }); });
    expect([pressed, canvas.getAttribute("data-tool")]).toEqual([false, "select"]);
    await act(async () => { fireEvent.keyUp(canvas, { key: " ", code: "Space" }); });
    expect(canvas.getAttribute("data-tool")).toBe("marquee");
});
