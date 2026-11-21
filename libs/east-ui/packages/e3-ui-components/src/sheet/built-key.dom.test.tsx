/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A sheet over a record whose rows' keys the app builds from them (`key`,
 * east-workspace#1709), in a browser, on e3: lanes keyed by a number their
 * aisle and their slot build. A lane typed into the blank row stands under
 * the key its row builds at once — a cell not typed yet read as empty — and
 * moves as its cells are filled; one that builds a key another lane stands
 * under is refused, and the footer says why; and Save writes each lane under
 * the key it builds.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DictType, East, IntegerType, StringType, StructType, equalFor, printFor } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { act, settle, sheetHarness, slot } from "./frame/harness.test-utils.js";

/** A lane: its aisle and its slot, which its key is built from, and a note. */
const Lane = StructType({ aisle: IntegerType, slot: IntegerType, note: StringType });
/** The lanes, keyed by aisle and slot as one number: aisle 1's first two. */
const lanes = e3.record("built_key_lanes", DictType(IntegerType, Lane), {
    initial: new Map([[101n, { aisle: 1n, slot: 1n, note: "Bulk" }], [102n, { aisle: 1n, slot: 2n, note: "Picks" }]]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const h = sheetHarness({ modules: { "sheet/built-key": { lanes } }, frame: 2000 });
const laneEqual = equalFor(Lane);
const printLanes = printFor(lanes.type);

/** The lanes, each keyed by the number its aisle and its slot build. */
const lanesKeyed = East.function([], SheetPayloadType, ($) => {
    const held = $.let(Record.bind(lanes));
    return Sheet.Payload({
        record: held, name: "lanesKeyed",
        key: (lane: { aisle: { multiply: (by: bigint) => { add: (n: unknown) => unknown } }; slot: unknown }) => lane.aisle.multiply(100n).add(lane.slot),
        columns: {
            aisle: Sheet.column.integer(Lane, { header: "Aisle" }),
            slot: Sheet.column.integer(Lane, { header: "Slot" }),
            note: Sheet.column.text(Lane, { header: "Note" }),
        },
    });
});

/** The sheet's rows, by their keys, in order. */
const ids = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-slot="row"][data-row-id]')].map((row) => row.getAttribute("data-row-id"));
/** The footer's message. */
const said = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="footerMessage"]')?.textContent;
/** What takes the pastes. */
const card = (c: HTMLElement) => c.querySelector("[data-sheet-card]")!;

/** Cells pasted from a cell on, as a person types them. */
async function paste(c: HTMLElement, at: HTMLElement, words: string): Promise<void> {
    fireEvent.mouseDown(at, { button: 0 });
    await act(async () => { fireEvent.paste(card(c), { clipboardData: { getData: () => words } }); });
    await settle();
}

/** The blank row's cell under a column. */
const blank = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-slot="row"][data-blank] [data-key="${key}"]`)!;
/** The key of the row the ring is on; `null` where it is on none. */
const ringOn = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="cell"][data-selected]')?.closest<HTMLElement>('[data-slot="row"]')?.getAttribute("data-row-id") ?? null;
/** A lane's cell under a column. */
const cellOf = (c: HTMLElement, id: string, key: string) => c.querySelector<HTMLElement>(`[data-slot="row"][data-row-id="${id}"] [data-key="${key}"]`)!;

test("ruling 6 — a lane typed into the blank row stands under the key its row builds at once, a cell not typed yet read as empty, and moves as its cells are filled, the ring with it; one that builds a key another stands under is refused, saying so; and Save writes each under the key it builds", async () => {
    const { container: c } = await h.mountPayload(lanesKeyed, { storageKey: "sheet-built-key" });
    await waitFor(() => expect(ids(c)).toEqual(["101", "102"]));
    // A whole lane typed: aisle 2, slot 5.
    await paste(c, blank(c, "aisle"), "2\t5\tDock");
    expect(ids(c)).toEqual(["101", "102", "205"]);
    // Aisle 1's first slot is another lane's: none is added.
    await paste(c, blank(c, "aisle"), "1\t1\tAgain");
    expect(said(c)).toBe('Another row is keyed "101" already');
    expect(ids(c)).toEqual(["101", "102", "205"]);
    // Its aisle alone typed: the key an empty slot builds — then its slot, and the lane moves under the key it builds.
    await paste(c, blank(c, "aisle"), "3");
    expect(ids(c)).toEqual(["101", "102", "205", "300"]);
    await paste(c, cellOf(c, "300", "slot"), "4");
    expect(ids(c)).toEqual(["101", "102", "205", "304"]);
    await paste(c, cellOf(c, "304", "note"), "Returns");
    // A slot typed over moves a lane that stood under its key.
    await paste(c, cellOf(c, "205", "slot"), "7");
    expect(ids(c)).toEqual(["101", "102", "207", "304"]);
    // A lane that moves up the sheet takes the ring with it: the next cell typed is its own.
    await paste(c, cellOf(c, "304", "aisle"), "0");
    expect(ids(c)).toEqual(["4", "101", "102", "207"]);
    expect(ringOn(c)).toBe("4");
    await paste(c, cellOf(c, "4", "aisle"), "3");
    expect(ids(c)).toEqual(["101", "102", "207", "304"]);
    expect(ringOn(c)).toBe("304");
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
    await waitFor(async () => expect([...(await h.read(lanes)).keys()]).toEqual([101n, 102n, 207n, 304n]));
    const saved = await h.read(lanes);
    expect([laneEqual(saved.get(207n)!, { aisle: 2n, slot: 7n, note: "Dock" }), laneEqual(saved.get(304n)!, { aisle: 3n, slot: 4n, note: "Returns" })], printLanes(saved)).toEqual([true, true]);
});
