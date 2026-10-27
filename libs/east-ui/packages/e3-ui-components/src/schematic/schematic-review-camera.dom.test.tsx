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
import { East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
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

/** The rail's key over the floor. */
const FLOOR = "schematic.review.camera";

/** The racks' record, as its dataset's requests name it. */
const RACKS = `records.${ex.schematicRacks.name}`;

type Narrowed = "hide" | "dim" | { show: "hide" | "dim"; fit?: boolean };

/**
 * The data centre's racks read by area, read only — their source lists their area index, one led by owner, and one by
 * name — the network frames read whole, and the inspector: as `schematic-window-reads.dom.test.tsx`'s floor.
 */
const floorOf = (id: string, narrowed: Narrowed) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
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
        id,
        inspector: true,
        extent: { width: 28, height: 14 },
        slice: { slice },
        narrowed,
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
    });
}))) });

/** The floor, a narrowed-out rack hidden. */
const floor = floorOf("reviewCamera", "hide");

/** The floor, a narrowed-out rack dimmed and the camera flown to the matches as the narrowing changes. */
const fitFloor = floorOf("reviewFit", { show: "dim", fit: true });

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
    // stands as it was: nothing may fly the camera from where they put it.
    await zoomInto(canvasOf(container), cameraOf(container), { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    const zoomed = cameraOf(container);
    const before = windowReads();
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

test("the drawing's counts, nothing selected, stay as they are while a zoom moves the window of a kind read by area (§9)", async () => {
    const { container } = await open(floor);
    const atFit = drawingCounts(container);
    expect(atFit["racks"]).toBe("5");
    await zoomAndLand(container, { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    expect(drawingCounts(container)).toEqual(atFit);
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
