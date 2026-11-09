/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic over records keyed by number and by text (#1549), on e3
 * itself: a bakehouse's floor (`schematic-keys.fixtures.ts`) — its ovens keyed
 * by number, its mixers by name. Every key travels as its text; the renderer
 * orders and seeks each kind's keys at its type, never by their texts, which
 * would put 10 before 2.
 *
 * - **Issues** lists the ovens past the floor's edge by their numbers: 2, 9,
 *   then 10.
 * - **The Backlog** holds the ovens with no position by their numbers: 3, 20,
 *   then 100.
 * - **Find**, over kinds keyed by two types, reads the text at String — a
 *   mixer's key by its start — and each oven's as typed: `10` is oven 10, and
 *   the start of mixer 10B's key; `2..11` the ovens from 2 up to 11 — among
 *   their rows where they are read whole, and in their record through e3 where
 *   the rail reads them.
 * - **A new row's key** is as its kind's key type makes it, each Saved under
 *   it: by number, one past the largest — a card's ⏎, Connect and a Shift-drag;
 *   built by the kind's `key` — a spot under its row and column, a pipe under
 *   its ends, a line under the mixers it feeds, a row moving as an edit
 *   changes what its key reads, its links with it — a Shift session growing
 *   its line where it moved (#1584) — and a key another row holds refusing
 *   the gesture, naming that row — as the rail's filters hiding a link that
 *   may name it does (#1580), and a Save of the links naming it in flight
 *   (#1584);
 *   by DateTime, a placeholder — Save waiting, Issues listing it, Connect
 *   from it refused — until the viewer types its key in the inspector, the
 *   placeholder waiting on as another session moves the record read through
 *   the rail; and by Blob, which no form types, none: the card off, saying why.
 * - **A key of several parts, a deleted row's key, a shift and a key stored
 *   apart from its fields** (#1581): a peg's row and column typed a part at a
 *   time, the peg waiting under its placeholder until Set key takes them
 *   whole; a key a peg deleted this session held taken again; two tiles keyed
 *   by their cells dragged one cell along together, West under East's key as
 *   East leaves it; and a spot stored under a key its column no longer builds,
 *   edited back to build it, staying under it.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin, so a pointer's client point is the
 * canvas's own; each card a test presses answers at its centre, and the canvas
 * everywhere else on it.
 */

import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    BlobType, DateTimeType, DictType, East, IntegerType, SortedMap, SortedSet, StringType, compareFor, equalFor, parseFor, printFor, some, variant,
} from "@elaraai/east";
import { Reactive, RecordSlicesChromeType, Slice, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { stubScrollIntoView } from "@elaraai/east-ui-components/testing";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as fx from "@elaraai/e3-ui/fixtures/schematic/schematic-keys";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { entityId, refOfId } from "./canvas/drawn.js";
import { at, card, drawingCounts, fitted, layOutCanvas, near, tap, unsaved } from "./schematic.test-utils.js";
import { schematicMessages } from "./messages.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic-keys.fixtures": fx }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();
stubScrollIntoView();

/** The camera the canvas fits the 28 × 14 m floor with. */
const CAM = fitted(fx.KEYED_FLOOR.width, fx.KEYED_FLOOR.height);

const m = schematicMessages;
const SAVE = editingMessages.apply();
const compareNumber = compareFor(IntegerType);
const compareText = compareFor(StringType);
const keyEqual = equalFor(StringType);

/** The ovens' record, as its dataset's requests name it. */
const OVENS = `records.${fx.keyedOvens.name}`;

/** The floor, read whole: its ovens and its mixers, the Backlog in the library, and the inspector. */
const floor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const ovens = $.let(Data.bind(fx.keyedOvens));
    const mixers = $.let(Data.bind(fx.keyedMixers));
    return Schematic({
        id: "keyed",
        inspector: true,
        extent: fx.KEYED_FLOOR,
        items: {
            ovens: Schematic.items(ovens, { name: "Oven", icon: "server", x: "x", y: "y", label: "name" }),
            mixers: Schematic.items(mixers, { name: "Mixer", icon: "network-wired", x: "x", y: "y", label: "name" }),
        },
        library: [Schematic.library.backlog()],
    });
}))) };

/** The floor, its ovens read through their source of the rail. */
const railedFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.let(Slice.bindRecords("schematic.keyed", {
        ovens: { source: Data.bindPaged(fx.keyedOvens, { indexes: ["schematic_keyed_ovens_by_name"] }) },
    }));
    const ovens = $.let(Data.bindPaged(fx.keyedOvens));
    const mixers = $.let(Data.bind(fx.keyedMixers));
    return Schematic({
        id: "keyedRail",
        extent: fx.KEYED_FLOOR,
        slice: { slice },
        items: {
            ovens: Schematic.items(ovens, { name: "Oven", icon: "server", x: "x", y: "y", label: "name" }),
            mixers: Schematic.items(mixers, { name: "Mixer", icon: "network-wired", x: "x", y: "y", label: "name" }),
        },
    });
}))) };

/** Mounts a floor and waits until an item on it is drawn: oven 11 unless given. */
async function open(example: { fn: { toIR(): unknown } }, kind = "ovens", key = "11"): Promise<HTMLElement> {
    const ui = await h.mount(example);
    await settle();
    await waitFor(() => expect(card(ui.container, kind, key)).not.toBeNull());
    await settle();
    return ui.container;
}

/** An oven's id, as the canvas and the Backlog's cards name it. */
const oven = (key: string): string => entityId({ kind: "ovens", key });

/** The inspector's open tab. */
const inspector = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** The library's open tab. */
const library = (c: HTMLElement): HTMLElement => slot(c, "start").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** The Issues tab's rows: each what it names, and what it says. */
const issueRows = (c: HTMLElement): (string | null)[][] => [...inspector(c).querySelectorAll("[data-inspector-issue]")]
    .map((el) => [el.children[0]?.textContent ?? null, el.children[1]?.textContent ?? null]);

/** The Backlog's cards, by id, in order. */
const backlogIds = (c: HTMLElement): (string | null)[] => [...library(c).querySelectorAll("[data-library-item]")].map((el) => el.getAttribute("data-library-item"));

/** Find's box, in the toolbar's row. */
const findBox = (c: HTMLElement): HTMLElement => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;

/** Types into Find's box, a key at a time, as a person does. */
async function typeIntoFind(c: HTMLElement, text: string): Promise<void> {
    const input = findBox(c).querySelector<HTMLInputElement>("input")!;
    for (const key of text) {
        const typed = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(typed));
    }
}

/** Clears Find's box, as its clear button does. */
async function clearFind(c: HTMLElement): Promise<void> {
    await act(async () => { fireEvent.click(findBox(c).querySelector("button[aria-label='Clear search']")!); });
    await settle();
}

/** Find's list, its lines as they read. */
const lines = (): (string | null)[] => [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);

test("Issues lists the ovens past the floor's edge by their numbers — 2, 9, then 10 — and the Backlog holds the ovens with no position by theirs: 3, 20, then 100 (#1549)", async () => {
    const c = await open(floor);
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((each) => each.textContent?.startsWith("Issues"));
    if (tab === undefined) throw new Error("the inspector holds no Issues tab");
    await act(async () => { fireEvent.click(tab); });
    await settle();
    await waitFor(() => expect(issueRows(c)).toEqual([
        ["Oven · Deck 2", "Outside the drawing"],
        ["Oven · Deck 9", "Outside the drawing"],
        ["Oven · Deck 10", "Outside the drawing"],
    ]));
    await waitFor(() => expect(backlogIds(c)).toEqual([oven("3"), oven("20"), oven("100")]));
});

test("read whole, Find over ovens keyed by number and mixers by name reads a mixer's key by its start and each oven's as typed: `10` is oven 10 and the start of mixer 10B's key; `2..11` the ovens from 2 up to 11, in their numbers' order (#1549)", async () => {
    const c = await open(floor);
    await typeIntoFind(c, "10");
    await waitFor(() => expect(lines()).toEqual(["10 · Deck 10 · Oven", "10B · Mixer"]), { timeout: 5_000 });
    await clearFind(c);
    // No oven's number starts so: the mixers alone.
    await typeIntoFind(c, "M");
    await waitFor(() => expect(lines()).toEqual(["M1 · Mixer", "M2 · Mixer"]), { timeout: 5_000 });
    await clearFind(c);
    await typeIntoFind(c, "2..11");
    await waitFor(() => expect(lines()).toEqual(["2 · Deck 2 · Oven", "3 · Deck 3 · Oven · no position", "9 · Deck 9 · Oven", "10 · Deck 10 · Oven"]), { timeout: 5_000 });
});

test("read through the rail, an oven is sought in its record through e3 at its number: `10` is oven 10, beside the start of mixer 10B's key (#1549)", async () => {
    const c = await open(railedFloor);
    const before = h.requests("find", OVENS).length;
    await typeIntoFind(c, "10");
    await waitFor(() => expect(lines()).toEqual(["10 · Deck 10 · Oven", "10B · Mixer"]), { timeout: 5_000 });
    expect(h.requests("find", OVENS).length).toBeGreaterThan(before);
    await clearFind(c);
    await typeIntoFind(c, "2..11");
    await waitFor(() => expect(lines()).toEqual(["2 · Deck 2 · Oven", "3 · Deck 3 · Oven · no position", "9 · Deck 9 · Oven", "10 · Deck 10 · Oven"]), { timeout: 5_000 });
});

// ============================================================================
// A new row's key (#1549)
// ============================================================================

/** The canvas. */
const canvasOf = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** Lets each card given answer at its centre — by kind, key and centre in metres — and the canvas everywhere else on it. */
function hits(c: HTMLElement, cards: readonly (readonly [kind: string, key: string, x: number, y: number])[]): void {
    const canvas = canvasOf(c);
    const found = cards.flatMap(([kind, key, x, y]) => {
        const el = card(c, kind, key);
        return el === null ? [] : [[el, x, y] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y]) => near(CAM, px, py, x, y))?.[0] ?? (px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvas : null));
    fireEvent.pointerEnter(canvas);
}

/** A pointer event on the canvas at a world point. */
function pointer(canvas: Element, type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number, shiftKey = false): void {
    fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerUp" ? 0 : 1, shiftKey, ...at(CAM, x, y) });
}

/** A drag on the canvas from one world point to another, let go there. */
async function drag(canvas: Element, from: readonly [number, number], to: readonly [number, number], shiftKey = false): Promise<void> {
    await act(async () => {
        pointer(canvas, "pointerDown", from[0], from[1], shiftKey);
        pointer(canvas, "pointerMove", to[0], to[1], shiftKey);
        pointer(canvas, "pointerUp", to[0], to[1], shiftKey);
    });
    await settle();
}

/** Picks a tool from the toolbar. */
async function tool(c: HTMLElement, name: string): Promise<void> {
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("radio", { name })); });
}

/** Clicks an element, as a pointer does, and lets the Schematic settle. */
async function click(el: Element): Promise<void> {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** Opens one of a pane's tabs, by its name: the library's (`start`) or the inspector's (`end`). */
async function openTab(c: HTMLElement, pane: "start" | "end", name: string): Promise<void> {
    const tab = [...slot(c, pane).querySelectorAll<HTMLElement>("[role='tab']")].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `) === true);
    if (tab === undefined) throw new Error(`no ${pane} tab ${name}`);
    await click(tab);
}

/** A card of the library's open tab, by its id. */
function libraryCard(c: HTMLElement, id: string): HTMLElement {
    const found = [...library(c).querySelectorAll<HTMLElement>("[data-library-item]")].find((el) => keyEqual(el.getAttribute("data-library-item") ?? "", id));
    if (found === undefined) throw new Error(`no card ${id}`);
    return found;
}

/** Presses ⏎ on a card, as the keyboard does. */
async function enter(el: HTMLElement): Promise<void> {
    el.focus();
    await act(async () => { fireEvent.keyDown(el, { key: "Enter", code: "Enter" }); });
    await settle();
}

/** Why the last gesture was refused, as the footer says it; `undefined` while nothing is. */
const refused = (c: HTMLElement): string | undefined => slot(c, "footer").querySelector("[data-schematic-refused]")?.textContent ?? undefined;

/** The history's Save. */
const saveButton = (c: HTMLElement): HTMLButtonElement => within(slot(c, "toolbar")).getByRole<HTMLButtonElement>("button", { name: SAVE });

/** Presses Save, and gives the records it wrote, each a request of its own, by name, in East's order. */
async function save(c: HTMLElement): Promise<string[]> {
    const from = h.requests("mutate").length;
    await click(saveButton(c));
    return h.requests("mutate").slice(from).map((request) => request.record ?? "").sort(compareText);
}

/** The item the canvas has selected, by its reference, once it draws one. */
async function selectedItem(c: HTMLElement): Promise<{ readonly kind: string; readonly key: string }> {
    return waitFor(() => {
        const id = c.querySelector("[data-card-key][data-selected]")?.getAttribute("data-card-key") ?? undefined;
        const ref = id === undefined ? undefined : refOfId(id);
        expect(ref).toBeDefined();
        return ref!;
    });
}

/** Whether an item's card is drawn selected. */
const isSelected = (c: HTMLElement, kind: string, key: string): boolean => card(c, kind, key)?.hasAttribute("data-selected") === true;

/** A section of Details, by its name: `key`, `row`, `ends`. */
const section = (c: HTMLElement, name: string): HTMLElement => inspector(c).querySelector<HTMLElement>(`[data-inspector-fields="${name}"]`)!;

/** A field of a section of Details, by its key. */
const field = (c: HTMLElement, name: string, key: string): HTMLElement => section(c, name).querySelector<HTMLElement>(`[data-field="${key}"]`)!;

/** Details' head: what it titles. */
const title = (c: HTMLElement): string | null => inspector(c).querySelector("[data-inspector-title]")?.textContent ?? null;

/**
 * Types a number field's new value, a key at a time — the shared input writes back on a frame — and commits it with ⏎: a
 * field holding no value yet, Not set, takes Set first.
 */
async function retypeNumber(c: HTMLElement, name: string, key: string, text: string): Promise<void> {
    const user = userEvent.setup();
    const set = field(c, name, key).querySelector<HTMLElement>("[data-field-set]");
    if (set !== null) await click(set);
    const input = within(field(c, name, key)).getByRole("spinbutton");
    await user.clear(input);
    await settle();
    for (const ch of text) {
        await user.type(input, ch);
        await settle();
        await act(async () => { for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    }
    await user.type(input, "{Enter}");
    await settle();
}

/** Picks a choice of a Chooser in Details, by its section, its field and its words. */
async function choose(c: HTMLElement, name: string, key: string, option: string): Promise<void> {
    const trigger = field(c, name, key).querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await act(async () => { fireEvent.click(trigger); });
    const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    await click(within(listbox).getByRole("option", { name: option }));
}

/**
 * A record's rows with some set, in its keys' order.
 *
 * @param rows - The rows, as e3 holds them
 * @param compare - The order of the record's keys
 * @param set - The rows set, each its key and its row
 * @returns The rows
 */
function withRows<K, V>(rows: ReadonlyMap<K, V>, compare: (a: K, b: K) => number, set: readonly (readonly [K, V])[]): SortedMap<K, V> {
    const out = new SortedMap<K, V>(rows, compare);
    for (const [key, row] of set) out.set(key, row);
    return out;
}

describe("a new row's key, as its kind's key type makes it (#1549)", () => {
    test("keyed by number, a card's ⏎ adds oven 101 — one past the ovens' largest, never their texts' — Connect a hose 11 and a Shift-drag a feed 11, each one past its kind's largest; and Save writes each under its key", async () => {
        const ovens = await h.read(fx.keyedOvens), hoses = await h.read(fx.keyedHoses), feeds = await h.read(fx.keyedFeeds);
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const slice = $.let(Slice.bindRecords("schematic.keyed.numbers", {
                floorCards: { source: Data.bindPaged(fx.floorCards, { indexes: ["schematic_floor_cards_by_name"] }) },
            }));
            const ovensBound = $.let(Record.bind(fx.keyedOvens));
            const mixers = $.let(Data.bind(fx.keyedMixers));
            const hosesBound = $.let(Record.bind(fx.keyedHoses));
            const feedsBound = $.let(Record.bind(fx.keyedFeeds));
            const cards = $.let(Data.bind(fx.floorCards));
            return Schematic({
                id: "keyedNumbers",
                extent: fx.KEYED_FLOOR,
                slice: { slice },
                items: {
                    ovens: Schematic.items(ovensBound, {
                        name: "Oven", icon: "server", x: "x", y: "y", label: "name",
                        templates: Schematic.templates(cards.read(), { name: (row) => row.name, values: (row) => row.values, source: "floorCards" }),
                    }),
                    mixers: Schematic.items(mixers, { name: "Mixer", icon: "network-wired", x: "x", y: "y", label: "name" }),
                },
                links: {
                    hoses: Schematic.links(hosesBound, {
                        name: "Hose", icon: "link", from: { field: "from", of: { oven: "ovens", mixer: "mixers" } }, to: { field: "to", of: { oven: "ovens", mixer: "mixers" } },
                    }),
                },
                nets: { feeds: Schematic.nets(feedsBound, { name: "Feed", icon: "plug", sources: { field: "supply", of: "ovens" }, destinations: { field: "fed", of: "mixers" } }) },
                library: [Schematic.library.templates()],
            });
        }))) });
        // The card's ⏎: an oven at the view's centre, 14 × 7 m, under one past 100.
        await openTab(c, "start", "Templates");
        await enter(libraryCard(c, entityId({ kind: "ovens", key: "spare" })));
        await waitFor(() => expect(isSelected(c, "ovens", "101")).toBe(true));
        // Oven 11 to M1: hose 11. Oven 101 to 10B: hose 12, past the one just drawn — and Shift-dragged on from oven 11 to
        // 10B, the session grows into feed 11, absorbing hose 12.
        const canvas = canvasOf(c);
        hits(c, [["ovens", "11", 4, 4], ["ovens", "101", 14, 7], ["mixers", "10B", 8, 10], ["mixers", "M1", 10, 3]]);
        await tool(c, "Connect");
        await drag(canvas, [4, 4], [10, 3]);
        await drag(canvas, [14, 7], [8, 10]);
        await drag(canvas, [4, 4], [8, 10], true);
        expect(await save(c)).toEqual([fx.keyedFeeds.name, fx.keyedHoses.name, fx.keyedOvens.name].sort(compareText));
        expect(printFor(fx.keyedOvens.type)(await h.read(fx.keyedOvens)))
            .toBe(printFor(fx.keyedOvens.type)(withRows(ovens, compareNumber, [[101n, { name: "Spare", x: some(14.0), y: some(7.0) }]])));
        expect(printFor(fx.keyedHoses.type)(await h.read(fx.keyedHoses)))
            .toBe(printFor(fx.keyedHoses.type)(withRows(hoses, compareNumber, [[11n, { from: variant("oven", 11n), to: variant("mixer", "M1"), bore: 0.0 }]])));
        expect(printFor(fx.keyedFeeds.type)(await h.read(fx.keyedFeeds)))
            .toBe(printFor(fx.keyedFeeds.type)(withRows(feeds, compareNumber, [[11n, { supply: new SortedSet([11n, 101n], compareNumber), fed: ["10B"], name: "" }]])));
    });

    test("keyed by row and column, as the spots' `key` builds them: a card building a key a spot holds is refused, naming it; one building a new key adds the spot under it; a column edited moves a spot under its new key, still selected, its rope with it; one building a key a spot holds is refused, naming it, the form showing the row again; and Save writes each under its key", async () => {
        const spots = await h.read(fx.placedSpots), ropes = await h.read(fx.keyedRopes);
        const spot = printFor(fx.SpotKey);
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const slice = $.let(Slice.bindRecords("schematic.keyed.spots", {
                spotCards: { source: Data.bindPaged(fx.spotCards, { indexes: ["schematic_spot_cards_by_name"] }) },
            }));
            const spotsBound = $.let(Record.bind(fx.placedSpots));
            const ropesBound = $.let(Record.bind(fx.keyedRopes));
            const cards = $.let(Data.bind(fx.spotCards));
            return Schematic({
                id: "keyedSpots",
                inspector: true,
                extent: fx.KEYED_FLOOR,
                slice: { slice },
                items: {
                    spots: Schematic.items(spotsBound, {
                        name: "Spot", icon: "pallet", x: "x", y: "y", label: "name", key: (row) => ({ row: row.row, col: row.col }),
                        templates: Schematic.templates(cards.read(), { name: (row) => row.name, values: (row) => row.values, source: "spotCards" }),
                    }),
                },
                links: { ropes: Schematic.links(ropesBound, { name: "Rope", icon: "link", from: { field: "from", of: "spots" }, to: { field: "to", of: "spots" } }) },
                library: [Schematic.library.templates()],
            });
        }))) }, "spots", spot({ row: 1n, col: 1n }));
        // Row 1, column 1 again: 1-1 holds it — refused, naming it, and nothing recorded.
        await openTab(c, "start", "Templates");
        await enter(libraryCard(c, entityId({ kind: "spots", key: "again" })));
        expect(refused(c)).toBe(m.keyRefused({ refusal: "taken", kind: "spot", name: "1-1" }));
        expect(refused(c)).toBe("A spot 1-1 is there already");
        expect(unsaved(c)).toBe(false);
        // Row 2, column 2: a spot under it, at the view's centre, selected.
        await enter(libraryCard(c, entityId({ kind: "spots", key: "corner" })));
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 2n, col: 2n }))).toBe(true));
        // 1-2's column edited to 3: the spot under (1, 3), still selected, and the rope along row 1 with it.
        const canvas = canvasOf(c);
        hits(c, [["spots", spot({ row: 1n, col: 2n }), 22, 3], ["spots", spot({ row: 2n, col: 1n }), 18, 10]]);
        await tap(canvas, CAM, 22, 3);
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 1n, col: 2n }))).toBe(true));
        await retypeNumber(c, "row", "col", "3");
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 1n, col: 3n }))).toBe(true));
        expect(card(c, "spots", spot({ row: 1n, col: 2n }))).toBeNull();
        // 2-1's column edited to 2: the new spot holds (2, 2) — refused, naming it, and its form shows 2-1's column again.
        await tap(canvas, CAM, 18, 10);
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 2n, col: 1n }))).toBe(true));
        await retypeNumber(c, "row", "col", "2");
        expect(refused(c)).toBe("A spot 2-2 is there already");
        expect(within(field(c, "row", "col")).getByRole<HTMLInputElement>("spinbutton").value).toBe("1");
        expect(isSelected(c, "spots", spot({ row: 2n, col: 1n }))).toBe(true);
        expect(await save(c)).toEqual([fx.keyedRopes.name, fx.placedSpots.name].sort(compareText));
        const placed = withRows(spots, compareFor(fx.SpotKey), [
            [{ row: 2n, col: 2n }, { name: "2-2", row: 2n, col: 2n, x: 14.0, y: 7.0 }],
            [{ row: 1n, col: 3n }, { name: "1-2", row: 1n, col: 3n, x: 22.0, y: 3.0 }],
        ]);
        placed.delete({ row: 1n, col: 2n });
        expect(printFor(fx.placedSpots.type)(await h.read(fx.placedSpots))).toBe(printFor(fx.placedSpots.type)(placed));
        expect(printFor(fx.keyedRopes.type)(await h.read(fx.keyedRopes)))
            .toBe(printFor(fx.keyedRopes.type)(withRows(ropes, compareNumber, [[1n, { from: { row: 1n, col: 1n }, to: { row: 1n, col: 3n }, note: "Along row 1" }]])));
    });

    test("keyed by row and column, the ropes read through the rail: while its filters hide the rope along row 1, a column edited is refused, saying so, and nothing is recorded — the rope would keep naming the old spot; the filters cleared, the same edit moves the spot and the rope with it, and Save writes both (#1580)", async () => {
        const spots = await h.read(fx.placedSpots), ropes = await h.read(fx.keyedRopes);
        const spot = printFor(fx.SpotKey);
        // The rail as a test writes it: the same source under the Schematic's key.
        const rail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({
            slice: Slice.bindRecords("schematic.keyed.railedRopes", {
                ropes: { source: Data.bindPaged(fx.keyedRopes, { indexes: ["schematic_keyed_ropes_by_note"] }), fields: { note: { label: "Note" } }, search: ["note"] },
            }),
        }))), getRegisteredPlatformImplementations());
        const ropesRail = () => rail().slice.parts.find((part) => keyEqual(part.source, "ropes"))!.slice;
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const slice = $.let(Slice.bindRecords("schematic.keyed.railedRopes", {
                ropes: { source: Data.bindPaged(fx.keyedRopes, { indexes: ["schematic_keyed_ropes_by_note"] }), fields: { note: { label: "Note" } }, search: ["note"] },
            }));
            const spotsBound = $.let(Record.bind(fx.placedSpots));
            const ropesBound = $.let(Record.bind(fx.keyedRopes));
            const ropeEntries = $.let(Data.bindPaged(fx.keyedRopes));
            return Schematic({
                id: "keyedRailedRopes",
                inspector: true,
                extent: fx.KEYED_FLOOR,
                slice: { slice },
                items: { spots: Schematic.items(spotsBound, { name: "Spot", icon: "pallet", x: "x", y: "y", label: "name", key: (row) => ({ row: row.row, col: row.col }) }) },
                links: { ropes: Schematic.links(ropesBound, { name: "Rope", icon: "link", from: { field: "from", of: "spots" }, to: { field: "to", of: "spots" }, entries: ropeEntries }) },
            });
        }))) }, "spots", spot({ row: 1n, col: 1n }));
        await waitFor(() => expect(drawingCounts(c)["links"]).toBe("1"));
        // A note no rope's starts with: the rope along row 1 hidden.
        await act(async () => { ropesRail().prefix("note", "Zz"); });
        await waitFor(() => expect(drawingCounts(c)["links"]).toBe("0"), { timeout: 10_000 });
        // 1-2's column edited to 3: refused, saying why, and the form shows its column again.
        const canvas = canvasOf(c);
        hits(c, [["spots", spot({ row: 1n, col: 2n }), 22, 3]]);
        await tap(canvas, CAM, 22, 3);
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 1n, col: 2n }))).toBe(true));
        await retypeNumber(c, "row", "col", "3");
        expect(refused(c)).toBe(m.keyRefused({ refusal: "unheld", name: "1-2", kind: "rope", why: "filtered" }));
        expect(refused(c)).toBe("1-2 isn't changed: the filters hide some ropes that may name it — clear them, then try again");
        expect(unsaved(c)).toBe(false);
        expect(within(field(c, "row", "col")).getByRole<HTMLInputElement>("spinbutton").value).toBe("2");
        // The filters cleared, nothing selected: the rope is back, and the same edit moves 1-2 under (1, 3), the rope with it.
        await act(async () => { ropesRail().clearAll(); });
        await tap(canvas, CAM, 2, 12);
        await waitFor(() => expect(drawingCounts(c)["links"]).toBe("1"), { timeout: 10_000 });
        hits(c, [["spots", spot({ row: 1n, col: 2n }), 22, 3]]);
        await tap(canvas, CAM, 22, 3);
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 1n, col: 2n }))).toBe(true));
        await retypeNumber(c, "row", "col", "3");
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 1n, col: 3n }))).toBe(true));
        expect(await save(c)).toEqual([fx.keyedRopes.name, fx.placedSpots.name].sort(compareText));
        const placed = withRows(spots, compareFor(fx.SpotKey), [[{ row: 1n, col: 3n }, { name: "1-2", row: 1n, col: 3n, x: 22.0, y: 3.0 }]]);
        placed.delete({ row: 1n, col: 2n });
        expect(printFor(fx.placedSpots.type)(await h.read(fx.placedSpots))).toBe(printFor(fx.placedSpots.type)(placed));
        expect(printFor(fx.keyedRopes.type)(await h.read(fx.keyedRopes)))
            .toBe(printFor(fx.keyedRopes.type)(withRows(ropes, compareNumber, [[1n, { from: { row: 1n, col: 1n }, to: { row: 1n, col: 3n }, note: "Along row 1" }]])));
    });

    test("keyed by row and column, a column edited while the ropes' Save is in flight is refused, saying so, and nothing is recorded — the rope along row 1 couldn't follow the spot; the Save landed, the same edit moves the spot and the rope with it (#1584)", async () => {
        const spots = await h.read(fx.placedSpots), ropes = await h.read(fx.keyedRopes);
        const spot = printFor(fx.SpotKey);
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const spotsBound = $.let(Record.bind(fx.placedSpots));
            const ropesBound = $.let(Record.bind(fx.keyedRopes));
            return Schematic({
                id: "keyedBusyRopes",
                inspector: true,
                extent: fx.KEYED_FLOOR,
                items: { spots: Schematic.items(spotsBound, { name: "Spot", icon: "pallet", x: "x", y: "y", label: "name", key: (row) => ({ row: row.row, col: row.col }) }) },
                links: { ropes: Schematic.links(ropesBound, { name: "Rope", icon: "link", from: { field: "from", of: "spots" }, to: { field: "to", of: "spots" } }) },
            });
        }))) }, "spots", spot({ row: 1n, col: 1n }));
        // A rope from 2-1 to 1-1: the ropes' one change, its Save held on its way to e3.
        const canvas = canvasOf(c);
        hits(c, [["spots", spot({ row: 1n, col: 1n }), 18, 3], ["spots", spot({ row: 1n, col: 2n }), 22, 3], ["spots", spot({ row: 2n, col: 1n }), 18, 10]]);
        await tool(c, "Connect");
        await drag(canvas, [18, 10], [18, 3]);
        const saving = h.e3.hold((request) => request.kind === "mutate" && request.record === fx.keyedRopes.name);
        await click(saveButton(c));
        await saving.holding;
        // 1-2's column edited to 3 meanwhile: refused, saying why, and the form shows its column again.
        await tool(c, "Select");
        await tap(canvas, CAM, 22, 3);
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 1n, col: 2n }))).toBe(true));
        await retypeNumber(c, "row", "col", "3");
        expect(refused(c)).toBe(m.keyRefused({ refusal: "unheld", name: "1-2", kind: "rope", why: "busy" }));
        expect(refused(c)).toBe("1-2 isn't changed: the ropes naming it take no edit now — try again in a moment");
        expect(within(field(c, "row", "col")).getByRole<HTMLInputElement>("spinbutton").value).toBe("2");
        expect(isSelected(c, "spots", spot({ row: 1n, col: 2n }))).toBe(true);
        // The Save landed: the same edit moves 1-2 under (1, 3), the rope along row 1 with it.
        await act(async () => { saving.release(); });
        await settle();
        await waitFor(() => expect(unsaved(c)).toBe(false));
        await retypeNumber(c, "row", "col", "3");
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 1n, col: 3n }))).toBe(true));
        expect(await save(c)).toEqual([fx.keyedRopes.name, fx.placedSpots.name].sort(compareText));
        const placed = withRows(spots, compareFor(fx.SpotKey), [[{ row: 1n, col: 3n }, { name: "1-2", row: 1n, col: 3n, x: 22.0, y: 3.0 }]]);
        placed.delete({ row: 1n, col: 2n });
        expect(printFor(fx.placedSpots.type)(await h.read(fx.placedSpots))).toBe(printFor(fx.placedSpots.type)(placed));
        expect(printFor(fx.keyedRopes.type)(await h.read(fx.keyedRopes))).toBe(printFor(fx.keyedRopes.type)(withRows(ropes, compareNumber, [
            [1n, { from: { row: 1n, col: 1n }, to: { row: 1n, col: 3n }, note: "Along row 1" }],
            [2n, { from: { row: 2n, col: 1n }, to: { row: 1n, col: 1n }, note: "" }],
        ])));
    });

    test("keyed by their ends, as the pipes' `key` builds them: Connect keys a pipe by its ends, one between mixers a pipe joins already refused, naming it; an end changed moves the pipe under its new ends, still selected; one building a key a pipe holds is refused, naming it; and Save writes each under its key", async () => {
        const pipes = await h.read(fx.joinedPipes);
        const ends = printFor(fx.PipeEnds);
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const mixers = $.let(Data.bind(fx.keyedMixers));
            const pipesBound = $.let(Record.bind(fx.joinedPipes));
            return Schematic({
                id: "keyedPipes",
                inspector: true,
                extent: fx.KEYED_FLOOR,
                items: { mixers: Schematic.items(mixers, { name: "Mixer", icon: "network-wired", x: "x", y: "y", label: "name" }) },
                links: {
                    pipes: Schematic.links(pipesBound, {
                        name: "Pipe", icon: "link", from: { field: "from", of: "mixers" }, to: { field: "to", of: "mixers" }, key: (row) => ({ from: row.from, to: row.to }),
                    }),
                },
            });
        }))) }, "mixers", "10B");
        // M1 and M2 stand 2 m apart: at Fit each draws as its pin, which the canvas hits itself.
        const canvas = canvasOf(c);
        hits(c, [["mixers", "10B", 8, 10]]);
        await tool(c, "Connect");
        // M2 to M1: a pipe there already — refused, naming it.
        await drag(canvas, [12, 3], [10, 3]);
        expect(refused(c)).toBe(m.keyRefused({ refusal: "taken", kind: "pipe", name: "M2 → M1" }));
        expect(refused(c)).toBe("A pipe M2 → M1 is there already");
        expect(unsaved(c)).toBe(false);
        // M1 to 10B: a pipe under its ends, which Details shows, selected through what M1 is joined to.
        await drag(canvas, [10, 3], [8, 10]);
        expect(unsaved(c)).toBe(true);
        await tool(c, "Select");
        await tap(canvas, CAM, 10, 3);
        const made = entityId({ kind: "pipes", key: ends({ from: "M1", to: "10B" }) });
        const join = await waitFor(() => {
            const found = [...inspector(c).querySelectorAll<HTMLElement>("[data-inspector-join]")].find((el) => keyEqual(el.getAttribute("data-inspector-join") ?? "", made));
            expect(found).toBeDefined();
            return found!;
        });
        await click(join);
        await waitFor(() => expect(title(c)).toBe("M1 → 10B"));
        // Its start moved to M2: the pipe under M2 → 10B, Details still on it.
        await choose(c, "ends", "from", "M2");
        await waitFor(() => expect(title(c)).toBe("M2 → 10B"));
        // Its end moved to M1: M2 to M1 is a pipe already — refused, naming it, and the pipe stays as it was.
        await choose(c, "ends", "to", "M1");
        expect([refused(c), title(c)]).toEqual(["A pipe M2 → M1 is there already", "M2 → 10B"]);
        expect(await save(c)).toEqual([fx.joinedPipes.name]);
        expect(printFor(fx.joinedPipes.type)(await h.read(fx.joinedPipes)))
            .toBe(printFor(fx.joinedPipes.type)(withRows(pipes, compareFor(fx.PipeEnds), [[{ from: "M2", to: "10B" }, { from: "M2", to: "10B", note: "" }]])));
    });

    test("keyed by the mixers it feeds, as the lines' `key` builds it: a Shift session's line moves under its new key as a Shift-drag adds a mixer, and the next Shift-drag adds an oven to the line there, never a hose of its own; and Save writes the one line (#1584)", async () => {
        const lines = await h.read(fx.sidedLines);
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const slice = $.let(Slice.bindRecords("schematic.keyed.lines", {
                floorCards: { source: Data.bindPaged(fx.floorCards, { indexes: ["schematic_floor_cards_by_name"] }) },
            }));
            const ovensBound = $.let(Record.bind(fx.keyedOvens));
            const mixers = $.let(Data.bind(fx.keyedMixers));
            const hosesBound = $.let(Record.bind(fx.keyedHoses));
            const linesBound = $.let(Record.bind(fx.sidedLines));
            const cards = $.let(Data.bind(fx.floorCards));
            return Schematic({
                id: "keyedLines",
                extent: fx.KEYED_FLOOR,
                slice: { slice },
                items: {
                    ovens: Schematic.items(ovensBound, {
                        name: "Oven", icon: "server", x: "x", y: "y", label: "name",
                        templates: Schematic.templates(cards.read(), { name: (row) => row.name, values: (row) => row.values, source: "floorCards" }),
                    }),
                    mixers: Schematic.items(mixers, { name: "Mixer", icon: "network-wired", x: "x", y: "y", label: "name" }),
                },
                links: {
                    hoses: Schematic.links(hosesBound, {
                        name: "Hose", icon: "link", from: { field: "from", of: { oven: "ovens", mixer: "mixers" } }, to: { field: "to", of: { oven: "ovens", mixer: "mixers" } },
                    }),
                },
                nets: {
                    lines: Schematic.nets(linesBound, {
                        name: "Line", icon: "plug", sources: { field: "supply", of: "ovens" }, destinations: { field: "fed", of: "mixers" }, key: (row) => row.fed.stringJoin("+"),
                    }),
                },
                library: [Schematic.library.templates()],
            });
        }))) });
        // The card's ⏎: oven 101 at the view's centre, 14 × 7 m.
        await openTab(c, "start", "Templates");
        await enter(libraryCard(c, entityId({ kind: "ovens", key: "spare" })));
        await waitFor(() => expect(isSelected(c, "ovens", "101")).toBe(true));
        // Oven 11 to M1: a hose. Shift-dragged on to M2, the session grows into the line M1+M2, absorbing it; and on to 10B,
        // its sides build it M1+M2+10B, which it moves under.
        const canvas = canvasOf(c);
        hits(c, [["ovens", "11", 4, 4], ["ovens", "101", 14, 7], ["mixers", "10B", 8, 10], ["mixers", "M1", 10, 3], ["mixers", "M2", 12, 3]]);
        await tool(c, "Connect");
        await drag(canvas, [4, 4], [10, 3]);
        await drag(canvas, [4, 4], [12, 3], true);
        await drag(canvas, [4, 4], [8, 10], true);
        // Oven 101 Shift-dragged into M2: it joins the line under its new key, upstream.
        await drag(canvas, [14, 7], [12, 3], true);
        expect(refused(c)).toBeUndefined();
        expect(await save(c)).toEqual([fx.keyedOvens.name, fx.sidedLines.name].sort(compareText));
        expect(printFor(fx.sidedLines.type)(await h.read(fx.sidedLines))).toBe(printFor(fx.sidedLines.type)(withRows(lines, compareText, [
            ["M1+M2+10B", { supply: new SortedSet([11n, 101n], compareNumber), fed: ["M1", "M2", "10B"], name: "" }],
        ])));
    });

    test("keyed by DateTime, a card's ⏎ holds a new bay under a placeholder — Save waiting, Issues listing it, Connect from it refused — until its key is typed in the inspector, which moves it there, still selected; a chute from it then is one past the chutes' largest; and Save writes each under its key", async () => {
        vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2026-11-07T08:00:00.000Z"));
        try {
            const bays = await h.read(fx.timedBays), chutes = await h.read(fx.timedChutes);
            const time = printFor(DateTimeType);
            const eight = new Date("2026-11-07T08:00:00.000Z");
            const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const slice = $.let(Slice.bindRecords("schematic.keyed.bays", {
                    floorCards: { source: Data.bindPaged(fx.floorCards, { indexes: ["schematic_floor_cards_by_name"] }) },
                }));
                const baysBound = $.let(Record.bind(fx.timedBays));
                const mixers = $.let(Data.bind(fx.keyedMixers));
                const chutesBound = $.let(Record.bind(fx.timedChutes));
                const cards = $.let(Data.bind(fx.floorCards));
                return Schematic({
                    id: "keyedBays",
                    inspector: true,
                    extent: fx.KEYED_FLOOR,
                    slice: { slice },
                    items: {
                        bays: Schematic.items(baysBound, {
                            name: "Bay", icon: "truck", x: "x", y: "y", label: "name",
                            templates: Schematic.templates(cards.read(), { name: (row) => row.name, values: (row) => row.values, source: "floorCards" }),
                        }),
                        mixers: Schematic.items(mixers, { name: "Mixer", icon: "network-wired", x: "x", y: "y", label: "name" }),
                    },
                    links: { chutes: Schematic.links(chutesBound, { name: "Chute", icon: "link", from: { field: "from", of: "bays" }, to: { field: "to", of: "mixers" } }) },
                    library: [Schematic.library.templates()],
                });
            }))) }, "bays", time(fx.EARLY));
            // The card's ⏎: a bay at the view's centre under a placeholder — no time East prints — selected, and Save waits.
            await openTab(c, "start", "Templates");
            await enter(libraryCard(c, entityId({ kind: "bays", key: "spare" })));
            const waiting = await selectedItem(c);
            expect([waiting.kind, parseFor(DateTimeType)(waiting.key).success]).toEqual(["bays", false]);
            expect(saveButton(c).disabled).toBe(true);
            // Issues lists it, saying so.
            await openTab(c, "end", "Issues");
            expect(issueRows(c)).toEqual([[m.issueWhere({ kind: "Bay", name: "Spare" }), m.keyPlaceholder({ name: "bay" })]]);
            expect(m.keyPlaceholder({ name: "bay" })).toBe("Type this bay's key: Save waits for it");
            // A chute from it to M1: refused under M1, saying so, and nothing recorded.
            const canvas = canvasOf(c);
            hits(c, [["bays", waiting.key, 14, 7], ["mixers", "M1", 10, 3]]);
            await tool(c, "Connect");
            await act(async () => { pointer(canvas, "pointerDown", 14, 7); pointer(canvas, "pointerMove", 10, 3); });
            expect(c.querySelector("[data-schematic-refusal] [data-drag-caption][data-refused]")?.textContent).toBe(m.placeholderRefused({ kind: "bay" }));
            expect(m.placeholderRefused({ kind: "bay" })).toBe("Type the new bay's key first");
            await act(async () => { pointer(canvas, "pointerUp", 10, 3); });
            await settle();
            // Its key typed: Go to issue selects it, and its key field — washed while it waits — takes Set, this minute; the bay
            // moves under it, still selected.
            await tool(c, "Select");
            await click(inspector(c).querySelector("[data-inspector-issue]")!);
            await openTab(c, "end", "Details");
            const key = field(c, "key", "key");
            expect([key.getAttribute("data-editor"), key.hasAttribute("data-issue")]).toEqual(["datetime", true]);
            await click(key.querySelector("[data-field-set]")!);
            await waitFor(() => expect(isSelected(c, "bays", time(eight))).toBe(true));
            expect(card(c, "bays", waiting.key)).toBeNull();
            expect(saveButton(c).disabled).toBe(false);
            // A chute from it now: one past 5.
            hits(c, [["bays", time(eight), 14, 7], ["mixers", "M1", 10, 3]]);
            await tool(c, "Connect");
            await drag(canvas, [14, 7], [10, 3]);
            expect(await save(c)).toEqual([fx.timedBays.name, fx.timedChutes.name].sort(compareText));
            const compareTime = compareFor(DateTimeType);
            expect(printFor(fx.timedBays.type)(await h.read(fx.timedBays)))
                .toBe(printFor(fx.timedBays.type)(withRows(bays, compareTime, [[eight, { name: "Spare", x: 14.0, y: 7.0 }]])));
            expect(printFor(fx.timedChutes.type)(await h.read(fx.timedChutes)))
                .toBe(printFor(fx.timedChutes.type)(withRows(chutes, compareNumber, [[6n, { from: eight, to: "M1", note: "" }]])));
        } finally {
            vi.useRealTimers();
        }
    });

    test("read through the rail, a new bay under a placeholder waits on as another session's Save moves the bays' record: the other's bay is drawn, the placeholder still waits, its key typed moves it, and Save writes it beside the other's", async () => {
        vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2026-11-07T08:00:00.000Z"));
        try {
            const bays = await h.read(fx.timedBays);
            const time = printFor(DateTimeType);
            const eight = new Date("2026-11-07T08:00:00.000Z"), late = new Date("2026-11-07T14:00:00.000Z");
            const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const slice = $.let(Slice.bindRecords("schematic.keyed.railedBays", {
                    bays: { source: Data.bindPaged(fx.timedBays, { indexes: ["schematic_timed_bays_by_name"] }) },
                    floorCards: { source: Data.bindPaged(fx.floorCards, { indexes: ["schematic_floor_cards_by_name"] }) },
                }));
                const baysBound = $.let(Record.bind(fx.timedBays));
                const bayEntries = $.let(Data.bindPaged(fx.timedBays));
                const cards = $.let(Data.bind(fx.floorCards));
                return Schematic({
                    id: "keyedRailedBays",
                    inspector: true,
                    extent: fx.KEYED_FLOOR,
                    slice: { slice },
                    items: {
                        bays: Schematic.items(baysBound, {
                            name: "Bay", icon: "truck", x: "x", y: "y", label: "name", entries: bayEntries,
                            templates: Schematic.templates(cards.read(), { name: (row) => row.name, values: (row) => row.values, source: "floorCards" }),
                        }),
                    },
                    library: [Schematic.library.templates()],
                });
            }))) }, "bays", time(fx.EARLY));
            await openTab(c, "start", "Templates");
            await enter(libraryCard(c, entityId({ kind: "bays", key: "spare" })));
            const waiting = await selectedItem(c);
            // Another session adds the Late bay: the bays' record moves under the drafts, and its bay is drawn.
            await h.patch(fx.timedBays, withRows(bays, compareFor(DateTimeType), [[late, { name: "Late bay", x: 6.0, y: 12.0 }]]));
            await waitFor(() => expect(card(c, "bays", time(late))).not.toBeNull());
            // The placeholder waits on, and Save with it.
            expect([card(c, "bays", waiting.key) !== null, saveButton(c).disabled]).toEqual([true, true]);
            // Its key typed: the bay under this minute, and Save writes it beside the other session's.
            await click(field(c, "key", "key").querySelector("[data-field-set]")!);
            await waitFor(() => expect(isSelected(c, "bays", time(eight))).toBe(true));
            expect(await save(c)).toEqual([fx.timedBays.name]);
            expect(printFor(fx.timedBays.type)(await h.read(fx.timedBays))).toBe(printFor(fx.timedBays.type)(withRows(bays, compareFor(DateTimeType), [
                [late, { name: "Late bay", x: 6.0, y: 12.0 }], [eight, { name: "Spare", x: 14.0, y: 7.0 }],
            ])));
        } finally {
            vi.useRealTimers();
        }
    });

    test("keyed by Blob, which no form types, no crate is added: the crates' card drags nowhere, its line saying why, and ⏎ on it drops nothing", async () => {
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const slice = $.let(Slice.bindRecords("schematic.keyed.crates", {
                floorCards: { source: Data.bindPaged(fx.floorCards, { indexes: ["schematic_floor_cards_by_name"] }) },
            }));
            const crates = $.let(Record.bind(fx.taggedCrates));
            const cards = $.let(Data.bind(fx.floorCards));
            return Schematic({
                id: "keyedCrates",
                extent: fx.KEYED_FLOOR,
                slice: { slice },
                items: {
                    crates: Schematic.items(crates, {
                        name: "Crate", icon: "box", x: "x", y: "y", label: "name",
                        templates: Schematic.templates(cards.read(), { name: (row) => row.name, values: (row) => row.values, source: "floorCards" }),
                    }),
                },
                library: [Schematic.library.templates()],
            });
        }))) }, "crates", printFor(BlobType)(fx.CRATE_7));
        const why = m.keysUntyped({ name: "crate", type: "Blob" });
        expect(why).toBe("Crates are keyed by Blob, which can't be typed — give the kind `key` to add them");
        await openTab(c, "start", "Templates");
        const cardEl = libraryCard(c, entityId({ kind: "crates", key: "spare" }));
        expect([cardEl.hasAttribute("data-draggable"), cardEl.textContent?.includes(why)]).toEqual([false, true]);
        await enter(cardEl);
        expect(unsaved(c)).toBe(false);
        expect(h.requests("mutate")).toEqual([]);
    });
});

// ============================================================================
// A key of several parts, a deleted row's key, a shift and a stored key (#1581)
// ============================================================================

/** The floor's pegs, keyed by a row and a column the viewer types, and its one card. */
const pegFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const slice = $.let(Slice.bindRecords("schematic.keyed.pegs", {
        floorCards: { source: Data.bindPaged(fx.floorCards, { indexes: ["schematic_floor_cards_by_name"] }) },
    }));
    const pegs = $.let(Record.bind(fx.typedPegs));
    const cards = $.let(Data.bind(fx.floorCards));
    return Schematic({
        id: "keyedPegs",
        inspector: true,
        extent: fx.KEYED_FLOOR,
        slice: { slice },
        items: {
            pegs: Schematic.items(pegs, {
                name: "Peg", icon: "pallet", x: "x", y: "y", label: "name",
                templates: Schematic.templates(cards.read(), { name: (row) => row.name, values: (row) => row.values, source: "floorCards" }),
            }),
        },
        library: [Schematic.library.templates()],
    });
}))) };

describe("a key of several parts, a deleted row's key, a shift and a key stored apart from its fields (#1581)", () => {
    test("a key of two parts is typed a part at a time and set whole: its row alone is no key, so 2-0, which a peg holds, refuses nothing, and the new peg waits under its placeholder, Save with it, until Set key takes 2-2; and Save writes it", async () => {
        const pegs = await h.read(fx.typedPegs);
        const peg = printFor(fx.SpotKey);
        const c = await open(pegFloor, "pegs", peg({ row: 2n, col: 0n }));
        await openTab(c, "start", "Templates");
        await enter(libraryCard(c, entityId({ kind: "pegs", key: "spare" })));
        const waiting = await selectedItem(c);
        expect(saveButton(c).disabled).toBe(true);
        // Its row typed 2: no key yet — nothing refused, the peg waits on, and Save with it.
        await retypeNumber(c, "key", "key.row", "2");
        expect([refused(c), card(c, "pegs", waiting.key) !== null, saveButton(c).disabled]).toEqual([undefined, true, true]);
        // Its column typed 2, then Set key: the peg under 2-2, still selected.
        await retypeNumber(c, "key", "key.col", "2");
        expect(isSelected(c, "pegs", waiting.key)).toBe(true);
        await click(inspector(c).querySelector("[data-inspector-key-set]")!);
        await waitFor(() => expect(isSelected(c, "pegs", peg({ row: 2n, col: 2n }))).toBe(true));
        expect([card(c, "pegs", waiting.key), saveButton(c).disabled]).toEqual([null, false]);
        expect(await save(c)).toEqual([fx.typedPegs.name]);
        expect(printFor(fx.typedPegs.type)(await h.read(fx.typedPegs)))
            .toBe(printFor(fx.typedPegs.type)(withRows(pegs, compareFor(fx.SpotKey), [[{ row: 2n, col: 2n }, { name: "Spare", x: 14.0, y: 7.0 }]])));
    });

    test("a key a peg deleted this session held is free: 0-2 deleted, a new peg's key set to 0-2 takes it, and Save writes the new peg there", async () => {
        const pegs = await h.read(fx.typedPegs);
        const peg = printFor(fx.SpotKey);
        const c = await open(pegFloor, "pegs", peg({ row: 0n, col: 2n }));
        const canvas = canvasOf(c);
        hits(c, [["pegs", peg({ row: 0n, col: 2n }), 10, 12]]);
        await tap(canvas, CAM, 10, 12);
        await waitFor(() => expect(isSelected(c, "pegs", peg({ row: 0n, col: 2n }))).toBe(true));
        await click(inspector(c).querySelector("[data-inspector-action='delete']")!);
        expect(card(c, "pegs", peg({ row: 0n, col: 2n }))).toBeNull();
        // A new peg, its key set to 0-2: free again.
        await openTab(c, "start", "Templates");
        await enter(libraryCard(c, entityId({ kind: "pegs", key: "spare" })));
        await selectedItem(c);
        await retypeNumber(c, "key", "key.row", "0");
        await retypeNumber(c, "key", "key.col", "2");
        await click(inspector(c).querySelector("[data-inspector-key-set]")!);
        await waitFor(() => expect(isSelected(c, "pegs", peg({ row: 0n, col: 2n }))).toBe(true));
        expect(refused(c)).toBeUndefined();
        expect(await save(c)).toEqual([fx.typedPegs.name]);
        expect(printFor(fx.typedPegs.type)(await h.read(fx.typedPegs)))
            .toBe(printFor(fx.typedPegs.type)(withRows(pegs, compareFor(fx.SpotKey), [[{ row: 0n, col: 2n }, { name: "Spare", x: 14.0, y: 7.0 }]])));
    });

    test("keyed by the cell their centre stands in, two tiles dragged one cell along together shift: West moves under East's key as East leaves it, nothing refused and no tile lost; and Save writes both under their new cells, West's old one gone", async () => {
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const tiles = $.let(Record.bind(fx.cellTiles));
            return Schematic({
                id: "keyedTiles",
                extent: fx.KEYED_FLOOR,
                items: { tiles: Schematic.items(tiles, { name: "Tile", icon: "pallet", x: "x", y: "y", label: "name", key: (row) => East.Float.roundFloor(row.x.divide(4.0)) }) },
            });
        }))) }, "tiles", "2");
        // West, then East with Shift: both selected.
        const canvas = canvasOf(c);
        hits(c, [["tiles", "2", 10, 3], ["tiles", "3", 14, 3]]);
        await tap(canvas, CAM, 10, 3);
        await act(async () => { pointer(canvas, "pointerDown", 14, 3, true); pointer(canvas, "pointerUp", 14, 3, true); });
        await settle();
        await waitFor(() => expect([isSelected(c, "tiles", "2"), isSelected(c, "tiles", "3")]).toEqual([true, true]));
        // Both a cell east: West into cell 3 as East leaves it for cell 4.
        await tool(c, "Move");
        await drag(canvas, [10, 3], [14, 3]);
        expect([refused(c), unsaved(c)]).toEqual([undefined, true]);
        expect(await save(c)).toEqual([fx.cellTiles.name]);
        const names = printFor(DictType(IntegerType, StringType));
        const saved = await h.read(fx.cellTiles);
        expect(names(new SortedMap([...saved].map(([cell, tile]) => [cell, tile.name] as const), compareNumber)))
            .toBe(names(new SortedMap([[3n, "West"], [4n, "East"]], compareNumber)));
    });

    test("a spot an app stored under 3-1, its column 5, edited back to column 1 stays under its key, refusing nothing; and Save writes its column", async () => {
        const spot = printFor(fx.SpotKey);
        const spots = withRows(await h.read(fx.placedSpots), compareFor(fx.SpotKey), [[{ row: 3n, col: 1n }, { name: "3-1", row: 3n, col: 5n, x: 6.0, y: 10.0 }]]);
        await h.patch(fx.placedSpots, spots);
        const c = await open({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const spotsBound = $.let(Record.bind(fx.placedSpots));
            return Schematic({
                id: "keyedStored",
                inspector: true,
                extent: fx.KEYED_FLOOR,
                items: { spots: Schematic.items(spotsBound, { name: "Spot", icon: "pallet", x: "x", y: "y", label: "name", key: (row) => ({ row: row.row, col: row.col }) }) },
            });
        }))) }, "spots", spot({ row: 3n, col: 1n }));
        hits(c, [["spots", spot({ row: 3n, col: 1n }), 6, 10]]);
        await tap(canvasOf(c), CAM, 6, 10);
        await waitFor(() => expect(isSelected(c, "spots", spot({ row: 3n, col: 1n }))).toBe(true));
        await retypeNumber(c, "row", "col", "1");
        expect([refused(c), isSelected(c, "spots", spot({ row: 3n, col: 1n })), unsaved(c)]).toEqual([undefined, true, true]);
        expect(await save(c)).toEqual([fx.placedSpots.name]);
        expect(printFor(fx.placedSpots.type)(await h.read(fx.placedSpots)))
            .toBe(printFor(fx.placedSpots.type)(withRows(spots, compareFor(fx.SpotKey), [[{ row: 3n, col: 1n }, { name: "3-1", row: 3n, col: 1n, x: 6.0, y: 10.0 }]])));
    });
});
