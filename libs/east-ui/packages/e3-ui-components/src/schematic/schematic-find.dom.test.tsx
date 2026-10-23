/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Find on e3 itself (#1404, `Schematic Builder Spec.md` §6.1): every item
 * kind's record sought by key, never what the canvas draws. The racks, read
 * through their source of the rail, are sought in their record's own order
 * through e3 — a find of it, and no whole read — and a frame, read whole, in
 * its rows. A rack the rail hides is listed `hidden`: its pick flies to where it
 * stands, selects nothing, and the footer says so, with Clear filters, which
 * shows it and selects it. A rack with no position says it is in the Backlog.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { card, layOutCanvas } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

const printText = printFor(StringType);
const compareString = compareFor(StringType);

/** The rail's key over the floor Find searches. */
const FLOOR = "schematic.find.floor";

/** Longer than a fly takes (350 ms): run on the test's clock, it lands. */
const FLY_MS = 400;

/**
 * The data centre's floor, its racks read through their source of the rail by owner, a narrowed-out rack hidden — the
 * default — and the frames, read whole, beside them.
 */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const slice = $.let(Slice.bindRecords(FLOOR, {
        racks: { source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByOwner] }), fields: { owner: { label: "Owner" } } },
    }));
    return Schematic({
        id: "find",
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
    });
}))) };

/** Mounts the floor, and waits until its racks are drawn. */
async function open() {
    const ui = await h.mount(floor);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    return ui;
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

/** The racks' record, as its dataset's requests name it. */
const RACKS_DATASET = `records.${ex.schematicRacks.name}`;

/** Find's box, in the toolbar's row. */
const findBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;

/** Types into Find's box, a key at a time, as a person does. */
async function typeIntoFind(c: HTMLElement, text: string) {
    const input = findBox(c).querySelector<HTMLInputElement>("input")!;
    for (const key of text) {
        const typed = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(typed));
    }
}

/** Find's list, its lines as they read. */
const lines = () => [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);

/** What the footer says of where Find's last pick landed; `null` while it says nothing. */
const foundNotice = (c: HTMLElement) => slot(c, "footer").querySelector<HTMLElement>("[data-schematic-found]");

test("Find seeks the racks' record through its source — a find of it, and no whole read — and a frame read whole in its rows (#1404)", async () => {
    const { container } = await open();
    const before = h.requests("find", RACKS_DATASET).length;
    await typeIntoFind(container, "A0");
    // Every rack of the record, in its keys' order — the two with no position among them — and nothing the canvas drew.
    await waitFor(() => expect(lines()).toEqual([
        "A01 · Rack", "A02 · Rack", "A03 · Rack", "A04 · Rack", "A05 · Rack", "A06 · Rack · no position", "A07 · Rack · no position",
    ]), { timeout: 5_000 });
    expect(h.requests("find", RACKS_DATASET).length).toBeGreaterThan(before);
    expect(h.requests("read", RACKS_DATASET)).toEqual([]);
    // A frame, read whole: found in its rows.
    await act(async () => { fireEvent.click(findBox(container).querySelector("button[aria-label='Clear search']")!); });
    await typeIntoFind(container, "MMR");
    await waitFor(() => expect(lines()).toEqual(["MMR-1 · Network frame"]), { timeout: 5_000 });
});

test("a rack the rail hides is listed hidden; its pick flies where it stands and selects nothing, the footer saying so, and Clear filters shows it and selects it (#1404)", async () => {
    const { container } = await open();
    const layer = () => card(container, "racks", "A01")?.parentElement ?? null;
    await narrow(new SortedMap([["owner", variant("values", [printText("Harbour Labs")])]], compareString));
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    const fitted = Number(layer()!.style.getPropertyValue("--cam-ppu"));
    await typeIntoFind(container, "A03");
    await waitFor(() => expect(lines()).toEqual(["A03 · Rack · hidden"]), { timeout: 5_000 });
    const input = findBox(container).querySelector<HTMLInputElement>("input")!;
    // The camera flies over animation frames: the test runs them on a clock of its own, so it lands however busy the
    // machine running it is.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() => expect(foundNotice(container)?.textContent).toBe("A03 is hidden by the filters Clear filters"));
        await act(async () => { vi.advanceTimersByTime(FLY_MS); });
    } finally {
        vi.useRealTimers();
    }
    // The camera has flown in to where it stands, and nothing is drawn there selected.
    expect(Number(layer()!.style.getPropertyValue("--cam-ppu"))).toBeGreaterThan(fitted * 1.5);
    expect(card(container, "racks", "A03")).toBeNull();
    expect(container.querySelector("[data-card-key][data-selected]")).toBeNull();
    // Clear filters: the racks all draw again, A03 selected, and the footer says nothing of it.
    await act(async () => { fireEvent.click(foundNotice(container)!.querySelector("button")!); });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A03")?.hasAttribute("data-selected")).toBe(true));
    expect(foundNotice(container)).toBeNull();
});

test("a rack with no position says it is in the Backlog (#1404)", async () => {
    const { container } = await open();
    await typeIntoFind(container, "A06");
    await waitFor(() => expect(lines()).toEqual(["A06 · Rack · no position"]), { timeout: 5_000 });
    fireEvent.keyDown(findBox(container).querySelector<HTMLInputElement>("input")!, { key: "Enter" });
    await waitFor(() => expect(foundNotice(container)?.textContent).toBe("A06 has no position: it is in the Backlog"));
    expect(foundNotice(container)!.querySelector("button")).toBeNull();
});
