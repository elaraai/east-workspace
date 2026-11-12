/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic beside another session's removal or change of a rack under
 * its drafts (#1599), on e3 itself: the checks every builder runs
 * (`shared/remote-rows.test-utils.ts`), and what the canvas draws of the rack
 * read at every change of the page.
 *
 * Over the conflicts example's racks — a record the canvas reads whole — the
 * canvas and its session read the record in the one read, so no read is held.
 * Over racks read through their source of the slice, one owner's chosen — so
 * the source's rows are a part of the record — the session reads a rack its
 * drafts hold by its key once the source's rows, read again, no longer hold
 * it: there the session's read is held while the canvas's own rows land. The
 * racks read by area run the same checks in
 * `schematic-review-drafts.dom.test.tsx`, over its floor.
 *
 * - A rack moved here that another session removes stands as drafted, a
 *   conflict to choose: kept, the next Save puts it back; let go, it leaves.
 *   Read through its source, it stands while the source's rows are read again
 *   without it and the session has yet to read it: taken for a rack the
 *   narrowing hides, it left the canvas until the session's read landed.
 * - A rack removed here that another session changes stays off the canvas, a
 *   conflict to choose, its card naming the rack: kept, the next Save removes
 *   it; let go, it is back as the other session left it.
 * - A rack removed here and by another session is nothing to choose and
 *   nothing to save, and is never drawn again.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant } from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import type { E3Request } from "../e3-web.test-utils.js";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { removedHere, removedOnBothSides, removedThere } from "../shared/remote-rows.test-utils.js";
import { at, card, fitted, layOutCanvas } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });
const printText = printFor(StringType);
const compareString = compareFor(StringType);

// jsdom lays nothing out: the canvas is given the box a page would give it, and each floor's extent fits it.
const canvasLayout = layOutCanvas();

/** The rail's key over the floor whose racks are read through their source. */
const SOURCED = "schematic.remote.sourced";

/**
 * The data centre's racks read through their source of the rail by owner, a narrowed-out rack hidden — the default —
 * and edited through their patch door: as `schematic-narrowing.dom.test.tsx`'s hidden floor, its racks alone.
 */
const sourcedFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const slice = $.let(Slice.bindRecords(SOURCED, {
        racks: { source: Data.bindPaged(ex.schematicRacks, { indexes: ["schematic_racks_by_owner"] }), fields: { owner: { label: "Owner" } } },
    }));
    return Schematic({
        id: "remoteSourced",
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries }) },
    });
}))) };

/** A floor the checks run over rack A03 of: what is mounted, where its canvas draws, and its racks' record as another session writes it. */
interface Floor {
    /** What is mounted. */
    readonly example: Parameters<typeof h.mount>[0];
    /** The racks' record, as its dataset's requests name it. */
    readonly dataset: string;
    /** The camera the canvas fits the floor's extent with. */
    readonly cam: ReturnType<typeof fitted>;
    /** Where rack A03 is moved to here: open floor, clear of every other card. */
    readonly to: readonly [x: number, y: number];
    /** Whether the record holds rack A03 now. */
    readonly held: () => Promise<boolean>;
    /** Another session's removal of rack A03, the page then settled. */
    readonly removal: () => Promise<void>;
}

/** A floor over a record of racks. */
function floorOf<R extends typeof ex.schematicConflictRacks | typeof ex.schematicRacks>(example: Floor["example"], record: R, cam: Floor["cam"], to: Floor["to"]): Floor {
    const read = () => h.read(record as typeof ex.schematicRacks);
    return {
        example, dataset: `records.${record.name}`, cam, to,
        held: async () => (await read()).has("A03"),
        removal: async () => {
            const racks = await read();
            racks.delete("A03");
            await h.patch(record as typeof ex.schematicRacks, racks);
            await settle();
        },
    };
}

/** The hall of the conflicts example: its racks read whole. */
const HALL = floorOf(ex.schematicConflicts, ex.schematicConflictRacks, fitted(18, 12), [13.0, 2.9]);
/** The data centre's racks read through their source of the slice. */
const FLOOR = floorOf(sourcedFloor, ex.schematicRacks, fitted(28, 14), [9.6, 5.0]);

/** Rack A03 on either floor: where it stands, 3.2 m wide and 60 px tall. */
const A03 = [9.6, 2.9] as const;

/** A pointer event on the canvas at a world point. */
function pointer(floor: Floor, canvas: Element, type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number) {
    fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerUp" ? 0 : 1, ...at(floor.cam, x, y) });
}

/** A floor mounted, its racks drawn, rack A03 answering a press anywhere in its box, and the pointer over the canvas. */
async function mounted(floor: Floor): Promise<{ container: HTMLElement; canvas: HTMLElement }> {
    const { container } = await h.mount(floor.example);
    await settle();
    await waitFor(() => expect(card(container, "racks", "A03")).not.toBeNull());
    canvasLayout.hits((px, py) => {
        const el = card(container, "racks", "A03");
        const { clientX, clientY } = at(floor.cam, A03[0], A03[1]);
        return el !== null && Math.abs(px - clientX) <= (3.2 * floor.cam.ppu) / 2 && Math.abs(py - clientY) <= 30 ? el : null;
    });
    const canvas = container.querySelector<HTMLElement>("[data-schematic-canvas]")!;
    fireEvent.pointerEnter(canvas);
    return { container, canvas };
}

/** One owner's racks chosen on the sourced floor's rail, as the rail writes it: the source's rows are then a part of the record. */
async function chosen(container: HTMLElement, owner: string): Promise<void> {
    const key = `${SOURCED}.racks`;
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    const where = new SortedMap([["owner", variant("values", [printText(owner)])]], compareString);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
    // A01 is another owner's: it leaves, and A03 stays.
    await waitFor(() => expect([card(container, "racks", "A01"), card(container, "racks", "A03") !== null]).toEqual([null, true]), { timeout: 5_000 });
    await settle();
}

/** The keys a read by key asks for, each as East prints it. */
const keysOf = (request: E3Request): readonly string[] =>
    (request.body === undefined ? undefined : (JSON.parse(new TextDecoder().decode(request.body)) as { keys?: string[] }).keys) ?? [];

/** What the shared checks take of the Schematic, over rack A03 of a floor. */
const rack = (floor: Floor, container: HTMLElement) => ({
    e3: h.e3, container,
    // Read whole, the canvas and its session read the racks in the one read: none is held. Read through their source, the
    // session reads the rack by key only once the source's rows hold it no more: the canvas's reads lead it.
    reads: () => false,
    // The session's read of the rack its drafts hold, by its key.
    byKey: (request: E3Request) => request.dataset === floor.dataset && request.kind === "rows" && keysOf(request).includes(printText("A03")),
    drawn: () => card(container, "racks", "A03") !== null,
    theirRemoval: floor.removal,
    held: floor.held,
    name: "A03",
});

/** A tool picked from the toolbar. */
const tool = (container: HTMLElement, name: string) => () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name })); };
/** The rack moved here into the open floor. */
const move = (floor: Floor, container: HTMLElement, canvas: HTMLElement) => [
    tool(container, "Move"),
    async () => {
        await act(async () => {
            pointer(floor, canvas, "pointerDown", A03[0], A03[1]);
            pointer(floor, canvas, "pointerMove", floor.to[0], floor.to[1]);
            pointer(floor, canvas, "pointerUp", floor.to[0], floor.to[1]);
        });
    },
];
/** The rack removed here: selected, then Del with the pointer over the canvas. */
const remove = (floor: Floor, container: HTMLElement, canvas: HTMLElement) => [
    tool(container, "Select"),
    () => { pointer(floor, canvas, "pointerDown", A03[0], A03[1]); pointer(floor, canvas, "pointerUp", A03[0], A03[1]); },
    () => { fireEvent.keyDown(window, { key: "Delete" }); },
];
/** Where the canvas places the rack's card, and what the card says: the look its draft has. */
const look = (container: HTMLElement) => () => {
    const el = card(container, "racks", "A03");
    return el === null ? null : [el.getAttribute("style"), el.textContent];
};

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the rack leaves and nothing is left to save", "source"]] as const)(
    "a rack moved here that another session removes stands as drafted while the racks are read again, a conflict to choose: %s", async (_ends, choice) => {
        const { container, canvas } = await mounted(HALL);
        await removedThere({ ...rack(HALL, container), change: move(HALL, container, canvas), look: look(container) }, choice);
    });

test.each([["kept, the next Save removes it", "draft"], ["let go, the rack is back as the other session left it", "source"]] as const)(
    "a rack removed here that another session changed stays off the canvas while the racks are read again, a conflict to choose, its card naming the rack: %s", async (_ends, choice) => {
        const { container, canvas } = await mounted(HALL);
        await removedHere({
            ...rack(HALL, container), remove: remove(HALL, container, canvas),
            // Its load read again by another session: no part of where it stands.
            theirChange: async () => {
                const racks = await h.read(ex.schematicConflictRacks);
                racks.set("A03", { ...racks.get("A03")!, kw: 6.5 });
                await h.patch(ex.schematicConflictRacks, racks);
                await settle();
            },
        }, choice);
    });

test("a rack removed here and by another session is nothing to choose and nothing to save, and the canvas never draws it again — nor while its racks, standing from before the other session's write, are read again", async () => {
    const { container, canvas } = await mounted(HALL);
    await removedOnBothSides({ ...rack(HALL, container), remove: remove(HALL, container, canvas) });
});

// ── The racks read through their source of the slice, one owner's chosen ────

test.each([["kept, the next Save puts it back as drafted", "draft"], ["let go, the rack leaves and nothing is left to save", "source"]] as const)(
    "read through its source, a rack moved here that another session removes stands as drafted while the source's rows are read again without it and its session has yet to read it by key — never taken for a rack the narrowing hides: %s", async (_ends, choice) => {
        const { container, canvas } = await mounted(FLOOR);
        await chosen(container, "Northwind Media");
        await removedThere({ ...rack(FLOOR, container), change: move(FLOOR, container, canvas), look: look(container) }, choice, "rows");
    });

test.each([["kept, the next Save removes it", "draft"], ["let go, the rack is back as the other session left it", "source"]] as const)(
    "read through its source, a rack removed here that another session changed stays off the canvas, a conflict to choose, its card naming the rack: %s", async (_ends, choice) => {
        const { container, canvas } = await mounted(FLOOR);
        await chosen(container, "Northwind Media");
        await removedHere({
            ...rack(FLOOR, container), remove: remove(FLOOR, container, canvas),
            // Its model read again by another session: no part of where it stands, nor of whose it is.
            theirChange: async () => {
                const racks = await h.read(ex.schematicRacks);
                racks.set("A03", { ...racks.get("A03")!, model: "42U · 10 kW" });
                await h.patch(ex.schematicRacks, racks);
                await settle();
            },
        }, choice);
    });

test("read through its source, a rack removed here and by another session is nothing to choose and nothing to save, and the canvas never draws it again", async () => {
    const { container, canvas } = await mounted(FLOOR);
    await chosen(container, "Northwind Media");
    await removedOnBothSides({ ...rack(FLOOR, container), remove: remove(FLOOR, container, canvas) });
});
