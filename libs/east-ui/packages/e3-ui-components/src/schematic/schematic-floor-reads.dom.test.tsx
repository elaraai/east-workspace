/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The floor of twenty thousand racks read by area, on e3 itself (#1393,
 * `Schematic Builder Spec.md` §10.4, SC22, SC36), counted in the request log:
 * its racks read through their source's area indexes, their loads as details,
 * its halls read whole, and uplinks from the front of Hall 1 to the front of
 * Hall 5, 300 m across the floor.
 *
 * - **At Fit** (SC36) every rack is in view, past the 5,000 a window draws: the
 *   canvas shades their density from the area index's counts — no rack's row
 *   read — and the footer says how many it shades and that zooming in draws
 *   them; a narrowing no area index leads is named there, not applied. A tap
 *   on the density zooms into it.
 * - **A drawn link's far end** off the window (SC22) is read by key, all of a
 *   window's in one request: zoomed into Hall 1's front, the uplinks' ends in
 *   Hall 5.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic-records";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { card, cameraOf, layOutCanvas, tap, zoomInto } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic-records": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

const printText = printFor(StringType);
const compareString = compareFor(StringType);

/** The rail's key over the floor. */
const FLOOR = "schematic.floor.reads";

/** The racks' record, as its dataset's requests name it. */
const RACKS = `records.${ex.schematicStressRacks.name}`;

/** Longer than a fly takes (350 ms): run on the test's clock, it lands. */
const FLY_MS = 400;

/** The floor: its racks read by area, their loads as details, its halls, and the uplinks across it. */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bindPaged(ex.schematicStressRacks));
    const loads = $.let(Data.bindPaged(ex.schematicStressRackLoads));
    const halls = $.let(Data.bind(ex.schematicStressHalls));
    const uplinks = $.let(Data.bind(ex.schematicStressUplinks));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicStressRacks, { indexes: [ex.schematicStressRacksByArea, ex.schematicStressRacksByHallArea, ex.schematicStressRacksByModel] }),
            fields: { hall: { label: "Hall" }, model: { label: "Model" } },
        },
    }));
    return Schematic({
        id: "floorReads",
        extent: { width: 382, height: 254 },
        scaleUnit: "m",
        slice: { slice },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
                details: Schematic.details(loads, { meter: (l) => ({ value: l.kw, max: l.capacity }) }),
            }),
        },
        zones: { halls: Schematic.zones(halls, { name: "Hall", icon: "warehouse", x: "x", y: "y", width: "w", height: "h", label: "name" }) },
        links: { uplinks: Schematic.links(uplinks, { name: "Uplink", icon: "bolt", from: { field: "from", of: "racks" }, to: { field: "to", of: "racks" } }) },
    });
}))) };

/** What the footer says of the racks drawn as their density; `undefined` while it says nothing of them. */
const densityNotice = (container: HTMLElement) => slot(container, "footer").querySelector("[data-density-cell]")?.textContent ?? undefined;

/** Mounts the floor, and waits until it shades the racks' density at Fit. */
async function open() {
    const ui = await h.mount(floor);
    await settle();
    await waitFor(() => expect(densityNotice(ui.container)).toBeDefined(), { timeout: 10_000 });
    await settle();
    return ui;
}

/** The racks' canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** A batch read's body, as the request log holds it: the JSON naming the keys it reads. */
const bodyOf = (request: E3Request) => JSON.parse(new TextDecoder().decode(request.body)) as { keys?: string[] };

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** Writes the racks' narrowing, as the rail does. */
async function narrow(where: Where) {
    const key = `${FLOOR}.racks`;
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

test("at Fit the canvas shades every rack's density from the area index's counts, no rack's row read, and the footer says how many and that zooming in draws them (SC36)", async () => {
    const { container } = await open();
    expect(densityNotice(container)).toBe("Density: 20,000 racks — zoom in to draw them");
    // Counted, not read: no run of the racks' entries, no page of their rows, no read of the record whole.
    expect(h.requests("runs", RACKS)).toEqual([]);
    expect(h.requests("page", RACKS).filter((request) => Number(request.query.get("limit")) > 1)).toEqual([]);
    expect(h.requests("read", RACKS)).toEqual([]);
    expect(h.requests("find", RACKS).every((request) => request.query.get("index") === ex.schematicStressRacksByArea.name)).toBe(true);
    expect(card(container, "racks", "R100000")).toBeNull();
});

test("a narrowing no area index leads is named in the footer, the density not applying it (SC36)", async () => {
    const { container } = await open();
    await narrow(new SortedMap([["model", variant("values", [printText("42U · 8 kW")])]], compareString));
    await waitFor(() => expect(densityNotice(container)).toContain("the filters not applied"));
});

test("a tap on the density zooms into it (SC36)", async () => {
    const { container } = await open();
    const before = cameraOf(container).ppu;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        await tap(canvasOf(container), cameraOf(container), 40, 6);
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
    } finally {
        vi.useRealTimers();
    }
    await settle();
    expect(cameraOf(container).ppu).toBeGreaterThan(before * 1.5);
});

test("zoomed into Hall 1's front, the uplinks' far ends in Hall 5 are read by key, all of them in one request (SC22)", async () => {
    const { container } = await open();
    const before = h.requests("rows", RACKS).length;
    await zoomInto(canvasOf(container), cameraOf(container), { minX: 2, minY: 2, maxX: 9, maxY: 6 });
    // The window there read, the racks drawn — the footer saying no more of their density — and their uplinks' far ends read.
    await waitFor(() => expect(densityNotice(container)).toBeUndefined(), { timeout: 10_000 });
    await waitFor(() => expect(h.requests("rows", RACKS).length).toBe(before + 1), { timeout: 10_000 });
    const keys = bodyOf(h.requests("rows", RACKS).at(-1)!).keys ?? [];
    expect([...keys].sort(compareString)).toEqual(["R100400", "R100401", "R100402", "R100403"].map((key) => printText(key)));
    expect(h.requests("read", RACKS)).toEqual([]);
});
