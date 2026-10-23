/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What the Schematic's footer says while it reads, on e3 itself (#1398, CL3,
 * CL4; `Schematic Builder Spec.md` §6.3, §6.5): the shared loading line, in a
 * kind's noun, on the frame's one reveal clock.
 *
 * - **A window in flight** — a zoom into cells not read — is `Loading racks…`
 *   once the reveal's delay has passed, main busy meanwhile, and the line goes
 *   once the window lands.
 * - **A new narrowing in flight** is `Filtering racks…`, the last window
 *   standing in until its rows land.
 * - **A read that fails** is `Couldn't read racks`, its reason the line's
 *   title, with Retry; Retry, the fault gone, asks e3 again and the line goes.
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
import { card, cameraOf, layOutCanvas, zoomInto } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

const compareString = compareFor(StringType);

/** The rail's key over the floor. */
const FLOOR = "schematic.loading";

/** The racks' record, as its datasets' requests name it. */
const RACKS = `records.${ex.schematicRacks.name}`;

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

/** The footer's loading line. */
const lineOf = (container: HTMLElement) => slot(container, "footer").querySelector<HTMLElement>("[data-footer-line]")!;

/** The racks' canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** A zoom into the cage's corner, at a finer level than Fit's: a window of cells not read. */
const intoCorner = (container: HTMLElement) => zoomInto(canvasOf(container), cameraOf(container), { minX: 1, minY: 2, maxX: 5, maxY: 4 });

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** Writes the racks' narrowing, as the rail does. */
async function narrow(where: Where) {
    const key = `${FLOOR}.racks`;
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

test("a window in flight is `Loading racks…` in the footer's line once the reveal's delay has passed, main busy meanwhile, and the line goes once it lands (#1398, CL3, CL4)", async () => {
    const { container } = await open();
    expect(lineOf(container).hasAttribute("data-idle")).toBe(true);
    const held = h.e3.hold(windowRead);
    await intoCorner(container);
    await held.holding;
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(lineOf(container).getAttribute("data-loading-line")).toBe("loading"));
    expect(lineOf(container).querySelector("[data-line-text]")!.textContent).toBe("Loading racks…");
    // The racks Fit drew stand in meanwhile.
    expect(card(container, "racks", "A01")).not.toBeNull();
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
    expect(slot(container, "main").getAttribute("aria-busy")).toBe("false");
});

test("a new narrowing in flight is `Filtering racks…`, the last window standing in until its rows land (#1398, CL3)", async () => {
    const { container } = await open();
    // The narrowing's answer of the window's rows, held on its way to e3.
    const held = h.e3.hold((request) => request.dataset === RACKS && request.kind === "within");
    await narrow(new SortedMap<string, ValueTypeOf<typeof RecordSliceChoiceType>>([["name", variant("prefix", "A01")]], compareString));
    await held.holding;
    await waitFor(() => expect(lineOf(container).querySelector("[data-line-text]")?.textContent).toBe("Filtering racks…"));
    expect(card(container, "racks", "A03")).not.toBeNull();
    await act(async () => { held.release(); });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    expect(card(container, "racks", "A01")).not.toBeNull();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true));
});

test("a window whose read fails is `Couldn't read racks` in the footer's line, its reason the line's title, with Retry; Retry, the fault gone, asks e3 again and the line goes (#1398, CL3)", async () => {
    const { container } = await open();
    const stop = h.e3.fail(windowRead, { status: 500, type: "internal", message: "the store is down" });
    await intoCorner(container);
    await waitFor(() => expect(lineOf(container).hasAttribute("data-failed")).toBe(true), { timeout: 15_000 });
    expect(lineOf(container).querySelector("[data-line-text]")!.textContent).toBe("Couldn't read racks");
    expect(lineOf(container).getAttribute("title")).toContain("the store is down");
    stop();
    const before = h.requests().filter(windowRead).length;
    await act(async () => { fireEvent.click(lineOf(container).querySelector("[data-line-retry]")!); });
    await settle();
    await waitFor(() => expect(lineOf(container).hasAttribute("data-idle")).toBe(true), { timeout: 15_000 });
    expect(h.requests().filter(windowRead).length).toBeGreaterThan(before);
});
