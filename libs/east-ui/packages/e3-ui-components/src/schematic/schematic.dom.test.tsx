/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic over the app's records, on e3 itself (#1386): each example
 * mounted as the showcase mounts it, its kinds' records read through e3-web —
 * whole, or through their source of the slice — and drawn: each item a card
 * named by its kind and key, an unplaced row drawn nowhere, a record another
 * session changes redrawn. The mount also proves the renderer's hook graph
 * sound (a memo reading state declared later crashes every mount, #179).
 */

import { beforeEach, afterEach, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it —
// 45 px a world unit for the 18 × 12 floor, 38.6 for the 28 × 14 data centre,
// the camera at rest — so each item is wide enough to draw as its card.
beforeEach(() => {
    for (const [name, px] of [["clientWidth", 1080], ["clientHeight", 540]] as const) {
        Object.defineProperty(HTMLElement.prototype, name, {
            configurable: true,
            get(this: HTMLElement) { return this.hasAttribute("data-schematic-canvas") ? px : 0; },
        });
    }
});

afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

/** An item's card, by its kind and key. */
const card = (container: HTMLElement, kind: string, key: string) =>
    container.querySelector<HTMLElement>(`[data-card-key=${JSON.stringify(entityId({ kind, key }))}]`);

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
    expect(container.querySelector("[data-schematic]")?.hasAttribute("aria-busy")).toBe(false);
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
    // The navigator lists the areas, which hold the racks inside them.
    expect(container.textContent).toContain("Cage A");
});
