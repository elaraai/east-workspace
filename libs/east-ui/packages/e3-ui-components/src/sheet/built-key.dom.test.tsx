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
 * under is refused, and the footer says why, in the danger tone — a lane the
 * sheet draws marked where it stands, again each time it is refused; and Save
 * writes each lane under the key it builds. And a sheet over a record whose rows hold their own key
 * in a field (`keyField`, east-workspace#1705): docks keyed by number, a dock
 * typed into the blank row holding its key in its number from the first. And
 * docks keyed by a variant, as a composite record keys its rows, paged from
 * the rail's `rows` source (east-workspace#1696): the narrowing shows the rows
 * it keeps, and a typed cell is saved under its row's own key. And lanes keyed
 * by the number their row builds, paged from the rail's `rows` source: a lane
 * a typed slot moves stands where it stood, under its new key, until its
 * source reads it again.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DictType, East, IntegerType, SortedMap, StringType, StructType, VariantType, compareFor, equalFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { editingMessages } from "@elaraai/east-ui-components";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
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

/** A dock: its number, which its key is held in too (`keyField`), and a note. */
const Dock = StructType({ no: IntegerType, note: StringType });
/** The docks: one whose row holds its key, and one saved before its row did. */
const docks = e3.record("key_field_docks", DictType(IntegerType, Dock), {
    initial: new Map([[1n, { no: 1n, note: "North" }], [2n, { no: 0n, note: "South" }]]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** A dock's key as a composite record keys its rows: a variant of the source each came from. */
const Sourced = VariantType({ erp: StringType, own: StringType });
const D1 = variant("erp", "D-1"), D2 = variant("own", "D-2");
/** The docks again, keyed by the source each came from, and filed by their note: what the rail narrows them through. */
const sourcedDocks = e3.record("sourced_docks", DictType(Sourced, Dock), {
    initial: new SortedMap<ValueTypeOf<typeof Sourced>, ValueTypeOf<typeof Dock>>([[D1, { no: 1n, note: "North" }], [D2, { no: 2n, note: "South" }]], compareFor(Sourced)),
    indexes: (index) => ({
        sourced_docks_by_note: index.on(["note"]),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** Lanes again, keyed by the number their aisle and their slot build, and filed by their aisle: what the rail pages them through. */
const pagedLanes = e3.record("built_key_paged_lanes", DictType(IntegerType, Lane), {
    initial: new Map([
        [101n, { aisle: 1n, slot: 1n, note: "Bulk" }], [102n, { aisle: 1n, slot: 2n, note: "Picks" }], [103n, { aisle: 1n, slot: 3n, note: "Returns" }],
        [201n, { aisle: 2n, slot: 1n, note: "Dock" }],
    ]),
    indexes: (index) => ({
        built_key_paged_lanes_by_aisle: index.on(["aisle"]),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const h = sheetHarness({ modules: { "sheet/built-key": { lanes, docks, sourcedDocks, pagedLanes } }, frame: 2000 });
const laneEqual = equalFor(Lane);
const dockEqual = equalFor(Dock);
const printLanes = printFor(lanes.type);
const printDocks = printFor(docks.type);
const printSourced = printFor(Sourced);

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

/** The docks, each holding its key in its number: a new dock is one past the largest. */
const docksKeyed = East.function([], SheetPayloadType, ($) => {
    const held = $.let(Record.bind(docks));
    return Sheet.Payload({
        record: held, name: "docksKeyed", keyField: "no",
        columns: {
            no: Sheet.column.integer(Dock, { header: "No" }),
            note: Sheet.column.text(Dock, { header: "Note" }),
        },
    });
});

/**
 * The docks keyed by their source, paged from the rail's `rows` source, which opens on the South docks: saved through
 * their record. A variant's key is made by the app's own rule, which this sheet gives none of: it adds no rows.
 */
const docksSourced = East.function([], SheetPayloadType, ($) => {
    const held = $.let(Record.bind(sourcedDocks));
    const slice = $.const(Slice.bindRecords("test.sheet.sourcedDocks", {
        rows: { source: Data.bindPaged(sourcedDocks, { indexes: ["sourced_docks_by_note"] }), fields: { note: { label: "Note", hints: ["North", "South"] } }, initial: { note: ["South"] } },
    }));
    return Sheet.Payload({
        record: held, name: "docksSourced", slice: { slice }, edits: { insertRows: false },
        columns: {
            no: Sheet.column.integer(Dock, { header: "No" }),
            note: Sheet.column.text(Dock, { header: "Note" }),
        },
    });
});

/** The lanes keyed by the number their row builds, paged from the rail's `rows` source through their aisle's index: it adds no rows. */
const lanesPaged = East.function([], SheetPayloadType, ($) => {
    const held = $.let(Record.bind(pagedLanes));
    const slice = $.const(Slice.bindRecords("test.sheet.pagedLanes", {
        rows: { source: Data.bindPaged(pagedLanes, { indexes: ["built_key_paged_lanes_by_aisle"] }), fields: { aisle: { label: "Aisle" } } },
    }));
    return Sheet.Payload({
        record: held, name: "lanesPaged", slice: { slice }, edits: { insertRows: false },
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
/** The footer's message's tone; `null` where it has none. */
const tone = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="footerMessage"]')?.getAttribute("data-tone") ?? null;
/** The rows marked as refused, each by its key and the refusal's turn. */
const refused = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-slot="row"][data-refused]')].map((row) => [row.getAttribute("data-row-id"), row.getAttribute("data-refused")]);
/** What takes the pastes. */
const card = (c: HTMLElement) => c.querySelector("[data-sheet-card]")!;

/** Cells pasted from a cell on, as a person types them. */
async function paste(c: HTMLElement, at: HTMLElement, words: string): Promise<void> {
    fireEvent.mouseDown(at, { button: 0 });
    await act(async () => { fireEvent.paste(card(c), { clipboardData: { getData: () => words } }); });
    await settle();
}

/** A press of one of the history's buttons, by its name, and what it leads to settled. */
async function press(c: HTMLElement, name: string): Promise<void> {
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name })); });
    await settle();
}

/** The blank row's cell under a column. */
const blank = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-slot="row"][data-blank] [data-key="${key}"]`)!;
/** The key of the row the ring is on; `null` where it is on none. */
const ringOn = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="cell"][data-selected]')?.closest<HTMLElement>('[data-slot="row"]')?.getAttribute("data-row-id") ?? null;
/** A row's cell under a column, by the row's key: a key East prints with quotes in it, a variant's, quoted as CSS reads it. */
const cellOf = (c: HTMLElement, id: string, key: string) => c.querySelector<HTMLElement>(`[data-slot="row"][data-row-id=${JSON.stringify(id)}] [data-key="${key}"]`)!;

test("ruling 6 — a lane typed into the blank row stands under the key its row builds at once, a cell not typed yet read as empty, and moves as its cells are filled, the ring with it; one that builds a key another stands under is refused, saying so in the danger tone, a lane the sheet draws marked where it stands; and Save writes each under the key it builds", async () => {
    const { container: c } = await h.mountPayload(lanesKeyed, { storageKey: "sheet-built-key" });
    await waitFor(() => expect(ids(c)).toEqual(["101", "102"]));
    // A whole lane typed: aisle 2, slot 5.
    await paste(c, blank(c, "aisle"), "2\t5\tDock");
    expect(ids(c)).toEqual(["101", "102", "205"]);
    // Aisle 1's first slot is another lane's: none is added.
    await paste(c, blank(c, "aisle"), "1\t1\tAgain");
    expect(said(c)).toBe('Another row is keyed "101" already');
    expect(ids(c)).toEqual(["101", "102", "205"]);
    // The footer says so in the danger tone; the lane refused is none the sheet draws, so no row is marked — never the
    // lane that holds the key.
    expect([tone(c), refused(c)]).toEqual(["refused", []]);
    // A slot typed over that builds another lane's key: the lane keeps its slot and its key, and is marked where it
    // stands — and again, on the other turn, as it is refused again, so its flash starts over.
    await paste(c, cellOf(c, "102", "slot"), "1");
    expect([said(c), tone(c), ids(c), cellOf(c, "102", "slot").textContent]).toEqual(['Another row is keyed "101" already', "refused", ["101", "102", "205"], "2"]);
    expect(refused(c)).toEqual([["102", "0"]]);
    await paste(c, cellOf(c, "102", "slot"), "1");
    expect(refused(c)).toEqual([["102", "1"]]);
    // The next gesture taken says its own words, and the mark and the tone go with the refusal's.
    await paste(c, cellOf(c, "102", "note"), "Picks");
    await paste(c, cellOf(c, "102", "note"), "Picking");
    expect([tone(c), refused(c)]).toEqual([null, []]);
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
    // Undo puts the lane back under the key it had, and Redo under the other again: the ring with it both ways.
    await press(c, editingMessages.undo());
    expect([ids(c), ringOn(c)]).toEqual([["101", "102", "207", "304"], "304"]);
    await press(c, editingMessages.redo());
    expect([ids(c), ringOn(c)]).toEqual([["4", "101", "102", "207"], "4"]);
    await paste(c, cellOf(c, "4", "aisle"), "3");
    expect(ids(c)).toEqual(["101", "102", "207", "304"]);
    expect(ringOn(c)).toBe("304");
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
    await waitFor(async () => expect([...(await h.read(lanes)).keys()]).toEqual([101n, 102n, 207n, 304n]));
    const saved = await h.read(lanes);
    expect([laneEqual(saved.get(207n)!, { aisle: 2n, slot: 7n, note: "Dock" }), laneEqual(saved.get(304n)!, { aisle: 3n, slot: 4n, note: "Returns" }),
        laneEqual(saved.get(102n)!, { aisle: 1n, slot: 2n, note: "Picking" })], printLanes(saved)).toEqual([true, true, true]);
});

test("ruling 1 — holding its key in a field (`keyField`), a dock typed into the blank row holds its own key in its number at once, though only its note was typed, and Save writes it so; a dock whose field never held its key keeps what it holds", async () => {
    const { container: c } = await h.mountPayload(docksKeyed, { storageKey: "sheet-key-field" });
    await waitFor(() => expect(ids(c)).toEqual(["1", "2"]));
    await paste(c, blank(c, "note"), "East");
    expect(ids(c)).toEqual(["1", "2", "3"]);
    expect([cellOf(c, "3", "no").textContent, cellOf(c, "2", "no").textContent]).toEqual(["3", "0"]);
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
    await waitFor(async () => expect([...(await h.read(docks)).keys()]).toEqual([1n, 2n, 3n]));
    const saved = await h.read(docks);
    expect([dockEqual(saved.get(3n)!, { no: 3n, note: "East" }), dockEqual(saved.get(2n)!, { no: 0n, note: "South" })], printDocks(saved)).toEqual([true, true]);
});

test("#1696 — over docks keyed by a variant, as a composite record keys its rows, the rail's `rows` source pages the rows its narrowing keeps, and a typed cell is saved under its row's own key", async () => {
    const { container: c } = await h.mountPayload(docksSourced, { storageKey: "sheet-sourced-docks" });
    // The rail opens on the South docks: the North one is not drawn.
    await waitFor(() => expect(ids(c)).toEqual([printSourced(D2)]));
    await paste(c, cellOf(c, printSourced(D2), "no"), "22");
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
    await waitFor(async () => expect((await h.read(sourcedDocks)).get(D2)?.no).toBe(22n));
    const saved = await h.read(sourcedDocks);
    expect([saved.size, dockEqual(saved.get(D2)!, { no: 22n, note: "South" }), dockEqual(saved.get(D1)!, { no: 1n, note: "North" })]).toEqual([2, true, true]);
});

test("ruling 16 — over lanes paged from the rail's `rows` source, a lane a typed slot moves under the key it builds stands where it stood, under its new key — never at the rows' end — and is one lane still; Undo puts it back, and a Save writes it under its key, read back in that key's place", async () => {
    const { container: c } = await h.mountPayload(lanesPaged, { storageKey: "sheet-built-key-paged" });
    await waitFor(() => expect(ids(c)).toEqual(["101", "102", "103", "201"]));
    // Aisle 1's second lane goes to slot 9: under 109, in the place it stood in — its source has still to read it there.
    await paste(c, cellOf(c, "102", "slot"), "9");
    expect(ids(c)).toEqual(["101", "109", "103", "201"]);
    expect([cellOf(c, "109", "slot").textContent, cellOf(c, "109", "note").textContent]).toEqual(["9", "Picks"]);
    await press(c, editingMessages.undo());
    expect(ids(c)).toEqual(["101", "102", "103", "201"]);
    await press(c, editingMessages.redo());
    expect(ids(c)).toEqual(["101", "109", "103", "201"]);
    // Moved on again, it is the same lane still, in the same place.
    await paste(c, cellOf(c, "109", "slot"), "7");
    expect(ids(c)).toEqual(["101", "107", "103", "201"]);
    // Every order the lanes are drawn in from the Save on, and the lane the ring is on in each.
    const drawn: string[] = [];
    const watch = new MutationObserver(() => { drawn.push(`${ids(c).join(" ")} | ${ringOn(c)}`); });
    watch.observe(c, { subtree: true, childList: true, attributes: true });
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() })); });
    await waitFor(async () => expect([...(await h.read(pagedLanes)).keys()]).toEqual([101n, 103n, 107n, 201n]));
    const saved = await h.read(pagedLanes);
    expect(laneEqual(saved.get(107n)!, { aisle: 1n, slot: 7n, note: "Picks" }), printFor(pagedLanes.type)(saved)).toBe(true);
    // Read again, it stands in its key's place — and the ring, which was on it, is on it still: never on the lane that
    // took the place it stood in.
    await waitFor(() => expect(ids(c)).toEqual(["101", "103", "107", "201"]));
    expect(ringOn(c)).toBe("107");
    watch.disconnect();
    // Saved and not yet read again, it stood where it was typed: never at the rows' end for that one read, the lanes
    // under the ring changing places with it.
    expect([...new Set(drawn)]).toEqual(["101 107 103 201 | 107", "101 103 107 201 | 107"]);
});
