/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A kind read by area, as e3 itself sees its reads (#1393, `Schematic Builder
 * Spec.md` §10.4, SC18, SC20–SC22), counted in the request log: the data
 * centre's racks read through their source's area index, their loads as
 * details, beside the network frames read whole and the fibre runs between
 * them.
 *
 * - **A window** (SC20) is one search of its cells' counts and one read of
 *   their runs, the rows read from the index alone — no page of the record's
 *   rows and no read of it whole. A zoom that keeps the view inside the
 *   window's margin reads nothing; a pan past it searches only the cells it
 *   adds.
 * - **Its details** (SC21) are one read of the loads by the runs of the cells
 *   it read, no key sent.
 * - **A narrowing its area index doesn't lead** (SC18) is one `within` of the
 *   window's rows, and draws only the racks it holds.
 *
 * A drawn link's far end off the window (SC22) is the floor of twenty
 * thousand racks' to show: here every rack is filed in a cell any window over
 * the cage reaches (`schematic-floor-reads.dom.test.tsx`).
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
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import { card, cameraOf, layOutCanvas, zoomInto } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

const compareString = compareFor(StringType);

/** The rail's key over the floor. */
const FLOOR = "schematic.window.reads";

/** The racks' and their loads' records, as their datasets' requests name them. */
const RACKS = `records.${ex.schematicRacks.name}`;
const LOADS = `records.${ex.schematicRackLoads.name}`;

/**
 * The data centre's racks read by area, read only — their source lists their area index, one led by owner, and one by
 * name — their loads as details, read by key beside them; the network frames read whole; and the fibre runs.
 */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bindPaged(ex.schematicRacks));
    const loads = $.let(Data.bindPaged(ex.schematicRackLoads));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const fibre = $.let(Data.bind(ex.schematicFibre));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: {
            source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByArea, ex.schematicRacksByOwnerArea, ex.schematicRacksByName] }),
            search: ["name"],
            fields: { name: { label: "Rack" }, owner: { label: "Owner", hints: ["Harbour Labs", "Northwind Media", "Elmway College"] } },
        },
    }));
    return Schematic({
        id: "windowReads",
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
                details: Schematic.details(loads, { meter: (l) => ({ value: l.kw, max: l.capacity }) }),
            }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
        links: {
            fibre: Schematic.links(fibre, {
                name: "Fibre run", icon: "bolt",
                from: { field: "from", of: { rack: "racks", frame: "network" } },
                to: { field: "to", of: { rack: "racks", frame: "network" } },
            }),
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

/** The racks' requests through an index, by kind: those of the area index the window reads through. */
const throughArea = (kind: E3Request["kind"]) => h.requests(kind, RACKS).filter((request) => request.query.get("index") === ex.schematicRacksByArea.name);

/** The racks' canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** A pan of the canvas by a drag on its empty floor, in px, as a viewer drags it. */
async function pan(canvas: HTMLElement, dx: number, dy: number) {
    const at = { clientX: 540, clientY: 270 };
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: at.clientX + dx / 2, clientY: at.clientY + dy / 2 });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: at.clientX + dx, clientY: at.clientY + dy });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: at.clientX + dx, clientY: at.clientY + dy });
    });
    await settle();
}

/** A batch read's body, as the request log holds it: the JSON naming what it reads — the keys, or the runs they are read by. */
const bodyOf = (request: E3Request) => JSON.parse(new TextDecoder().decode(request.body)) as { keys?: string[]; keysOf?: unknown };

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** Writes the racks' narrowing, as the rail does. */
async function narrow(where: Where) {
    const key = `${FLOOR}.racks`;
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

test("a window is one search of its cells and one read of their runs, from the index alone; a zoom inside its margin reads nothing, and a pan into new cells searches only those (SC20)", async () => {
    const { container } = await open();
    // The window at Fit: its cells' runs read once, through the area index; no page of the record's rows, no read of it whole.
    expect(throughArea("runs")).toHaveLength(1);
    expect(h.requests("page", RACKS).filter((request) => Number(request.query.get("limit")) > 1)).toEqual([]);
    expect(h.requests("read", RACKS)).toEqual([]);
    const fitted = throughArea("find").length;
    // A zoom that keeps the view inside the window's margin and at least half its size: nothing read.
    await zoomInto(canvasOf(container), cameraOf(container), { minX: 2, minY: 1, maxX: 24, maxY: 12 });
    await settle();
    expect(throughArea("find")).toHaveLength(fitted);
    expect(throughArea("runs")).toHaveLength(1);
    // A zoom into the cage's corner: a window at a finer level, its cells searched in one request and their runs read in one.
    await zoomInto(canvasOf(container), cameraOf(container), { minX: 1, minY: 2, maxX: 5, maxY: 4 });
    await waitFor(() => expect(throughArea("runs")).toHaveLength(2), { timeout: 5_000 });
    expect(throughArea("find")).toHaveLength(fitted + 1);
    // A pan at that zoom, past the window's margin: only the cells it adds are searched — none the zoomed window found.
    const found = new Set(throughArea("find")[fitted]!.searches.map((search) => JSON.stringify(search)));
    await pan(canvasOf(container), -400, 0);
    await waitFor(() => expect(throughArea("find")).toHaveLength(fitted + 2), { timeout: 5_000 });
    const added = throughArea("find")[fitted + 1]!.searches;
    expect(added.length).toBeGreaterThan(0);
    expect(added.length).toBeLessThan(found.size);
    for (const search of added) expect(found.has(JSON.stringify(search))).toBe(false);
    expect(h.requests("read", RACKS)).toEqual([]);
});

test("a window's details are one read of the loads by the runs its cells were read by, no key sent (SC21)", async () => {
    await open();
    const rows = h.requests("rows", LOADS);
    expect(rows.length).toBeGreaterThan(0);
    for (const request of rows) expect([bodyOf(request).keys, bodyOf(request).keysOf === undefined]).toEqual([undefined, false]);
    expect(h.requests("read", LOADS)).toEqual([]);
});

test("a window under a narrowing its area index doesn't lead is one `within` of its rows, and draws only the racks it holds (SC18, D28)", async () => {
    const { container } = await open();
    const before = h.requests("within", RACKS).length;
    await narrow(new SortedMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>([["name", variant("prefix", "A01")]], compareString));
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    expect(card(container, "racks", "A01")).not.toBeNull();
    expect(h.requests("within", RACKS).length).toBe(before + 1);
    expect(h.requests("read", RACKS)).toEqual([]);
});
