/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic over the app's records, on e3 itself (#1386, #1401): each
 * example mounted as the showcase mounts it, its kinds' records read through
 * e3-web — whole, or through their source of the slice — and drawn: each item
 * a card named by its kind and key, an unplaced row drawn nowhere, a record
 * another session changes redrawn, and the shapes the kinds' accessors make
 * from each row's own fields; the data centre's host keeping the whole
 * selection, and its veto refusing a pair in its words. The mount also proves
 * the renderer's hook graph sound (a memo reading state declared later crashes
 * every mount, #179).
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { ArrayType, East, printFor } from "@elaraai/east";
import { State } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { at, cameraOf, card, drawingCounts, fitted, layOutCanvas, near, tap, zoomInto } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px, and fits each drawing
// inside it — 41 px a metre for the 18 × 12 m floor, 35.1 for the 28 × 14 m data centre — so a rack is wide enough to
// draw as its card.
const canvasLayout = layOutCanvas();

/** The camera the canvas fits the data centre's 28 × 14 m drawing with. */
const DATA_CENTRE = fitted(28, 14);

/** What the data centre's host keeps of the selection, as East prints it. */
const keptSelection = () => printFor(ArrayType(Schematic.Types.Ref))(East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
    return kept.read();
}), getRegisteredPlatformImplementations())());
/** References printed, as East prints an array of them. */
const printRefs = printFor(ArrayType(Schematic.Types.Ref));

test("the floor draws each rack of its record as a card named by its kind and key, its roles as the kind maps them", async () => {
    const { container } = await h.mount(ex.schematicFloor);
    await waitFor(() => expect(container.querySelectorAll("[data-card-key]")).toHaveLength(6));
    const a01 = card(container, "racks", "A01")!;
    expect(a01.textContent).toContain("A01");
    expect(a01.textContent).toContain("42U · 8 kW");
    // Its meter: 5.2 kW of 8.
    expect(a01.querySelector<HTMLElement>("[data-meter] > *")?.style.width).toBe("65%");
    // The record is read whole, as Data.bind reads it, and nothing is written.
    expect(h.requests("mutate")).toEqual([]);
    // Nothing in flight: main is not busy (#1398, CL12).
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
});

test("a rack another session moves is drawn where its record now places it", async () => {
    const { container } = await h.mount(ex.schematicFloor);
    await waitFor(() => expect(card(container, "racks", "B02")).not.toBeNull());
    const before = card(container, "racks", "B02")!.style.transform;
    const racks = await h.read(ex.schematicFloorRacks);
    const b02 = racks.get("B02")!;
    await h.patch(ex.schematicFloorRacks, new Map([...racks, ["B02", { ...b02, x: 12.0, y: 8.6 }]]));
    await waitFor(() => expect(card(container, "racks", "B02")!.style.transform).not.toBe(before));
    expect(card(container, "racks", "B02")!.style.transform).toContain("12");
});

test("the data centre draws each kind's rows — the racks through their source of the slice, never read whole — and draws no unplaced rack", async () => {
    const { container } = await h.mount(ex.schematicDataCentre);
    // The racks' source scans its narrowing a page at a time: settled, every page has landed.
    await settle();
    await waitFor(() => expect(card(container, "racks", "A01")).not.toBeNull());
    for (const key of ["A01", "A02", "A03", "A04", "A05"]) expect(card(container, "racks", key)).not.toBeNull();
    // A06 and A07 have no position: the kind's backlog, drawn nowhere.
    expect(card(container, "racks", "A06")).toBeNull();
    expect(card(container, "racks", "A07")).toBeNull();
    // The racks are read through their source — its key searches and pages — and never whole.
    expect(h.requests("read", "records.schematic_racks")).toEqual([]);
    expect(h.requests(undefined, "records.schematic_racks").length).toBeGreaterThan(0);
    // The drawing's Details counts the five racks drawn (#1391).
    await waitFor(() => expect(drawingCounts(container).racks).toBe("5"));
});

test("the data centre draws each cooling unit's footprint from the unit's own radius, about its centre (SC37)", async () => {
    const { container } = await h.mount(ex.schematicDataCentre);
    await settle();
    await waitFor(() => expect(card(container, "racks", "A01")).not.toBeNull());
    // A footprint draws with its item's card: at Fit CRAH-1's 1.4 m holds no card's words, so it draws as its pin;
    // zoomed in on it, its card.
    expect(card(container, "cooling", "CRAH-1")).toBeNull();
    const canvas = container.querySelector("[data-schematic-canvas]")!;
    await zoomInto(canvas, DATA_CENTRE, { minX: 1.0, minY: 10.5, maxX: 5.0, maxY: 13.5 });
    await waitFor(() => expect(card(container, "cooling", "CRAH-1")).not.toBeNull());
    // A cooling unit's footprint is a circle of its own `radius` about its centre: 0.9 m below CRAH-1's centre
    // (3.0, 11.9) is below its card, and past its 0.7 m, so a tap there selects nothing.
    const zoomed = cameraOf(container);
    await tap(canvas, zoomed, 3.0, 12.8);
    expect(card(container, "cooling", "CRAH-1")!.hasAttribute("data-selected")).toBe(false);
    // Another session gives the unit a 1.2 m radius: the same tap lands inside its footprint now.
    const units = await h.read(ex.schematicCooling);
    await h.patch(ex.schematicCooling, new Map([...units, ["CRAH-1", { ...units.get("CRAH-1")!, radius: 1.2 }]]));
    await tap(canvas, zoomed, 3.0, 12.8);
    await waitFor(() => expect(card(container, "cooling", "CRAH-1")!.hasAttribute("data-selected")).toBe(true));
});

test("the data centre's host keeps the whole selection, and its veto refuses a run between two frames in its words (D34)", async () => {
    const { container, getByRole } = await h.mount(ex.schematicDataCentre);
    await settle();
    await waitFor(() => expect(card(container, "network", "CORE-1")).not.toBeNull());
    const cards = { A05: card(container, "racks", "A05")!, MMR1: card(container, "network", "MMR-1")!, CORE1: card(container, "network", "CORE-1")! };
    // Each card answers at its centre, as a page would hit it.
    const centres: readonly (readonly [Element, number, number])[] = [[cards.A05, 16.8, 2.9], [cards.MMR1, 24.2, 2.9], [cards.CORE1, 23.2, 9.7]];
    canvasLayout.hits((x, y) => centres.find(([, cx, cy]) => near(DATA_CENTRE, x, y, cx, cy))?.[0] ?? null);
    const canvas = container.querySelector("[data-schematic-canvas]")!;
    // A tap on A05 selects it, and the host keeps the selection by the rack's kind and key.
    await tap(canvas, DATA_CENTRE, 16.8, 2.9);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A05" }])));
    // A run from the meet-me room's frame to the core: two frames, refused, the target ringed.
    fireEvent.click(getByRole("radio", { name: "Connect" }));
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(DATA_CENTRE, 24.2, 2.9) });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(DATA_CENTRE, 23.2, 9.7) });
    });
    await waitFor(() => expect(cards.CORE1.hasAttribute("data-forbidden")).toBe(true));
    // On to a rack: a frame and a rack, allowed.
    await act(async () => { fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(DATA_CENTRE, 16.8, 2.9) }); });
    await waitFor(() => expect(cards.CORE1.hasAttribute("data-forbidden")).toBe(false));
    expect(cards.A05.hasAttribute("data-forbidden")).toBe(false);
    await act(async () => { fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(DATA_CENTRE, 16.8, 2.9) }); });
});
