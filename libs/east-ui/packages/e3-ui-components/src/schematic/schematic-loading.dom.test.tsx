/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What the Schematic shows while it reads, on e3 itself (#1398, CL2–CL4,
 * CL11; `Schematic Builder Spec.md` §6.3, §6.5): the shared loading line in
 * the footer, in a kind's noun, the region wash over the area its reads have
 * not drawn yet, the placeholders of a card's and the inspector's unread
 * details, and a failure said once on the canvas — each on the frame's one
 * reveal clock.
 *
 * - **A window in flight** — a zoom into cells not read — is `Loading racks
 *   in view` once the reveal's delay has passed, main busy meanwhile, and the
 *   line goes once the window lands. A zoom in washes nothing: the racks drawn
 *   stand in.
 * - **A pan into cells not read** washes the area the drawing does not cover,
 *   under the grid; a rack read before stands in, real, and one not read draws
 *   nowhere until the window lands.
 * - **A window the view leaves before it lands** is dropped (CL6): each of its
 *   requests is aborted on its way to e3.
 * - **A window's rows land before their details**: a rack new to the window
 *   holds its bar's place, a placeholder, never an empty bar, and one drawn
 *   before keeps its own; the line is `Loading details for 1 rack`.
 * - **A selected rack's details read again** — another session's commit —
 *   are its form's fields in the inspector, each its label over a placeholder,
 *   until their row lands; its card keeps the bar it was drawn with.
 * - **A new narrowing in flight** is `Filtering racks…`, the last window
 *   standing in until its rows land.
 * - **A read that fails** is said once on the canvas — `Couldn't read this
 *   area`, at the top-left in view of the area it failed reading, with Retry —
 *   and in the line, `Couldn't read racks in view`, its reason the line's
 *   title, with Retry; Retry, the fault gone, asks e3 again and both go.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType, type RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { card, cameraOf, layOutCanvas, tap, zoomInto } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const { hits } = layOutCanvas();

const compareString = compareFor(StringType);

/** The rail's key over the floor. */
const FLOOR = "schematic.loading";

/** The racks' record, as its datasets' requests name it. */
const RACKS = `records.${ex.schematicRacks.name}`;

/** The racks' loads' record: their details. */
const LOADS = `records.${ex.schematicRackLoads.name}`;

/** The data centre's racks read by area, read only, their loads as details beside them, and the network frames read whole. */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bindPaged(ex.schematicRacks));
    const loads = $.let(Data.bindPaged(ex.schematicRackLoads));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByArea, ex.schematicRacksByOwnerArea, ex.schematicRacksByName] }),
            search: ["name"],
            fields: { name: { label: "Rack" }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] } },
        },
    }));
    return Schematic({
        id: "loading",
        extent: { width: 28, height: 14 },
        slice: { slice },
        inspector: true,
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
                details: Schematic.details(loads, { meter: (l) => ({ value: l.kw, max: l.capacity }) }),
            }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
    });
}))) };

/** Mounts the floor, and waits until its racks are drawn. */
async function open() {
    const ui = await h.mount(floor);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    await settle();
    return ui;
}

/** The racks' window reads: its cells' searches and their runs' entries. */
const windowRead = (request: E3Request) => request.dataset === RACKS && (request.kind === "find" || request.kind === "runs");

/** The racks' details' reads: their rows by a window's runs, and a row by its key — its search and its page. */
const detailsRead = (request: E3Request) => request.dataset === LOADS && (request.kind === "rows" || request.kind === "find" || request.kind === "page");

/** The footer's loading line. */
const lineOf = (container: HTMLElement) => slot(container, "footer").querySelector<HTMLElement>("[data-footer-line]")!;

/** The line's words. */
const lineText = (container: HTMLElement) => lineOf(container).querySelector("[data-line-text]")?.textContent;

/** The racks' canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** The layer of the area the reads have not drawn yet, and how many boxes it washes. */
const unreadOf = (container: HTMLElement) => canvasOf(container).querySelector<HTMLElement>("[data-schematic-unread]")!;

/** A zoom into the cage's corner, at a finer level than Fit's: a window of cells not read, inside the reach Fit drew. */
const intoCorner = (container: HTMLElement) => zoomInto(canvasOf(container), cameraOf(container), { minX: 1, minY: 2, maxX: 5, maxY: 4 });

/**
 * From the corner, a fly to the cage's far end, at the same zoom: a window past the reach the corner's drawing holds —
 * A03, A04 and A05, the corner's window holding A01 to A04, so A05 alone new to it.
 */
const toFarEnd = (container: HTMLElement) => zoomInto(canvasOf(container), cameraOf(container), { minX: 12, minY: 2, maxX: 16, maxY: 4 });

/**
 * A gesture whose window is read, the read let land: the canvas tells the reader where it rests a moment after its
 * camera stops, and the next gesture must find the window this one reads drawn.
 */
async function landed(container: HTMLElement, gesture: () => Promise<void>) {
    const read = h.e3.hold(windowRead);
    await gesture();
    await read.holding;
    await act(async () => { read.release(); });
    await settle();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
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

test("a window in flight is `Loading racks in view` in the footer's line once the reveal's delay has passed, main busy meanwhile, and the line goes once it lands; a zoom in washes nothing (#1398, CL3, CL4)", async () => {
    const { container } = await open();
    expect(lineOf(container).hasAttribute("data-idle")).toBe(true);
    const held = h.e3.hold(windowRead);
    await intoCorner(container);
    await held.holding;
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(lineOf(container).getAttribute("data-loading-line")).toBe("loading"));
    expect(lineText(container)).toBe("Loading racks in view");
    // The racks Fit drew stand in meanwhile: the corner lies inside the reach they were read over, and nothing is washed.
    expect(card(container, "racks", "A01")).not.toBeNull();
    expect(unreadOf(container).getAttribute("data-schematic-unread")).toBe("0");
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
});

test("a pan into cells not read washes the area the drawing does not cover, under the grid and every item drawn, once revealed — a rack read before standing in, one not read drawn nowhere — and the wash goes as the window lands (#1398, CL2, CL4)", async () => {
    const { container } = await open();
    await landed(container, () => intoCorner(container));
    const held = h.e3.hold(windowRead);
    await toFarEnd(container);
    await held.holding;
    // One box: the far end's reach, which the corner's does not meet.
    await waitFor(() => expect(unreadOf(container).getAttribute("data-schematic-unread")).toBe("1"));
    const wash = unreadOf(container).querySelector<HTMLElement>("[data-loading-wash]")!;
    expect(wash.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(wash.hasAttribute("data-unrevealed")).toBe(false));
    // The lowest layer: the grid, the paint and the cards draw over it.
    const paint = canvasOf(container).querySelector("canvas")!;
    const cards = canvasOf(container).querySelector("[data-schematic-cards]")!;
    expect(unreadOf(container).compareDocumentPosition(paint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(unreadOf(container).compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A04, read with the corner's window, stands in, real; A05, not read, draws nowhere: nothing implies its position.
    expect(card(container, "racks", "A04")).not.toBeNull();
    expect(card(container, "racks", "A05")).toBeNull();
    expect(lineText(container)).toBe("Loading racks in view");
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A05")).not.toBeNull());
    expect(unreadOf(container).getAttribute("data-schematic-unread")).toBe("0");
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
});

test("a window the view leaves before it lands is dropped: each of its requests is aborted on its way to e3, and the window the view came back to draws as it was (#1398, CL6)", async () => {
    const { container } = await open();
    await landed(container, () => intoCorner(container));
    const held = h.e3.hold(windowRead);
    const before = h.requests().length;
    await toFarEnd(container);
    await held.holding;
    // The far end's window, on its way: none of its requests given up.
    const far = h.requests().slice(before).filter(windowRead);
    expect(far.length).toBeGreaterThan(0);
    expect(far.some((request) => request.signal.aborted)).toBe(false);
    // Back at the corner before it lands: nothing reads the far end's cells any more, and every request for them is aborted.
    await intoCorner(container);
    await settle();
    await waitFor(() => expect(far.every((request) => request.signal.aborted)).toBe(true));
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
    expect(card(container, "racks", "A01")).not.toBeNull();
});

test("a window's rows draw while their details are read: a rack new to it holds its bar's place, a placeholder, never an empty bar, one drawn before keeps its own, and the line says how many wait (#1398, CL2, CL3)", async () => {
    const { container } = await open();
    await landed(container, () => intoCorner(container));
    const held = h.e3.hold(detailsRead);
    await toFarEnd(container);
    await held.holding;
    await waitFor(() => expect(card(container, "racks", "A05")).not.toBeNull());
    const a05 = card(container, "racks", "A05")!;
    // New to the window, its title real and its bar a placeholder in the bar's place: nothing says 0%, as A05's load is.
    expect(a05.querySelector("[data-card-label]")!.textContent).toBe("A05");
    expect(a05.querySelector("[data-meter][data-pending] [data-shape='fill']")).not.toBeNull();
    expect(a05.querySelector("[data-meter]:not([data-pending])")).toBeNull();
    // A04, read with the corner's window, keeps the bar it was drawn with while the window's details are read again.
    expect(card(container, "racks", "A04")!.querySelector("[data-meter]:not([data-pending])")).not.toBeNull();
    // The rows landed: nothing is washed, and the line counts the racks whose details wait.
    expect(unreadOf(container).getAttribute("data-schematic-unread")).toBe("0");
    await waitFor(() => expect(lineText(container)).toBe("Loading details for 1 rack"));
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A05")!.querySelector("[data-meter]:not([data-pending])")).not.toBeNull());
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
});

test("a selected rack's details read again — another session's commit — are its form's fields in the inspector, each its label over a placeholder, until their row lands; its card keeps the bar it was drawn with (#1398, CL2)", async () => {
    const { container } = await open();
    hits(() => card(container, "racks", "A05"));
    const pane = slot(container, "end");
    // Another session changes the racks' loads: their rows, by the window's runs and by key, read again, held on their way.
    const held = h.e3.hold(detailsRead);
    const loads = await h.read(ex.schematicRackLoads);
    await h.patch(ex.schematicRackLoads, new Map([...loads, ["A05", { ...loads.get("A05")!, kw: 6.0 }]]));
    await held.holding;
    await tap(canvasOf(container), cameraOf(container), 16.8, 2.9);
    await settle();
    await waitFor(() => expect(pane.querySelector("[data-inspector-fields='details'][data-pending]")).not.toBeNull());
    const details = pane.querySelector<HTMLElement>("[data-inspector-fields='details']")!;
    const fields = [...details.querySelectorAll("[data-field]")];
    expect(fields.map((field) => field.getAttribute("data-field"))).toEqual(["kw", "capacity", "alarm"]);
    expect(fields.every((field) => field.querySelector("[data-shape]") !== null)).toBe(true);
    expect(details.querySelector("input")).toBeNull();
    // The card's bar stands in, as it was drawn: a new revision's read marks nothing it has read.
    expect(card(container, "racks", "A05")!.querySelector("[data-meter]:not([data-pending])")).not.toBeNull();
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(pane.querySelector("[data-inspector-fields='details']:not([data-pending]) input")).not.toBeNull());
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
});

test("a new narrowing in flight is `Filtering racks…`, the last window standing in until its rows land (#1398, CL3)", async () => {
    const { container } = await open();
    // The narrowing's answer of the window's rows, held on its way to e3.
    const held = h.e3.hold((request) => request.dataset === RACKS && request.kind === "within");
    await narrow(new SortedMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>([["name", variant("prefix", "A01")]], compareString));
    await held.holding;
    await waitFor(() => expect(lineText(container)).toBe("Filtering racks…"));
    expect(card(container, "racks", "A03")).not.toBeNull();
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    expect(card(container, "racks", "A01")).not.toBeNull();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
});

test("a window whose read fails is said once on the canvas — `Couldn't read this area` at the top-left in view of the area it failed reading, with Retry — and in the line, its reason the title; Retry asks e3 again and both go (#1398, CL3, CL11)", async () => {
    const { container } = await open();
    const stop = h.e3.fail(windowRead, { status: 500, type: "internal", message: "the store is down" });
    await intoCorner(container);
    await waitFor(() => expect(lineOf(container).hasAttribute("data-failed")).toBe(true), { timeout: 15_000 });
    expect(lineText(container)).toBe("Couldn't read racks in view");
    expect(lineOf(container).getAttribute("title")).toContain("the store is down");
    // The corner lies in the reach Fit drew: the area it failed reading is its whole reach, whose top-left in view is the canvas's.
    const box = canvasOf(container).querySelector<HTMLElement>("[data-loading-failed-box]")!;
    expect([box.querySelector("[data-loading-failed-message]")!.textContent, box.style.top, box.style.left]).toEqual(["Couldn't read this area", "16px", "16px"]);
    // Said once: no banner says it too, and the racks drawn stay.
    expect(slot(container, "banners")?.querySelector("[data-schematic-banner]") ?? null).toBeNull();
    expect(card(container, "racks", "A01")).not.toBeNull();
    stop();
    const before = h.requests().filter(windowRead).length;
    await act(async () => { fireEvent.click(box.querySelector("[data-loading-retry]")!); });
    await settle();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true), { timeout: 15_000 });
    expect(h.requests().filter(windowRead).length).toBeGreaterThan(before);
    expect(canvasOf(container).querySelector("[data-loading-failed-box]")).toBeNull();
});
