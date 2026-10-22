/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's drag and drop on e3 itself (#1390, `Schematic Builder
 * Spec.md` §7, §8, SC4, SC11–SC14), through the page's drag layer and its test
 * seams: a rack template dropped on the floor adds a rack where it lands, its
 * key minted new, selected — the ghost saying where, one step one Undo takes
 * back, Save writing it (SC12); a backlog row placed where it is dropped
 * (SC4); a fibre template dropped on a run writing its values, never its ends
 * or its key (SC11); an owner's card dropped on a rack — the rack marked while
 * the drag rests on it — setting the rack's owner; every refusal in its words,
 * dropping nothing; a drawing read only refusing every drop (SC14); ⏎ on a
 * card dropping it on the selection — every selected rack, as one step — or
 * at the view's centre, refused in the footer where the selection holds
 * nothing of its kind; on a touch screen a tap on the selected card doing
 * what ⏎ does; and Connect taking the selected fibre template's values
 * (§4.3).
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin, so a pointer's client point is the
 * canvas's own; each rack card answers at its centre, and the canvas
 * everywhere else on it.
 */

import { afterEach, expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { ArrayType, East, defaultValue, equalFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { announced, stubScrollIntoView } from "@elaraai/east-ui-components/testing";
import { Data, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { at, card, layOutCanvas, tap } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();
stubScrollIntoView();

/** The data centre's px a metre: its 28 × 14 m drawing fitted to the canvas's 1080 × 540 px. */
const PPU = 1080 / 28;

const rackEqual = equalFor(ex.DcRack);
const fibreEqual = equalFor(ex.DcFibre);
const endEqual = equalFor(ex.DcEnd);
const printRefs = printFor(ArrayType(Schematic.Types.Ref));
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();

/** Where each card the tests press sits, by kind, key and centre in metres. */
const CENTRES: readonly (readonly [kind: string, key: string, x: number, y: number])[] = [
    ["racks", "A01", 2.4, 2.9], ["racks", "A02", 6.0, 2.9], ["racks", "A03", 9.6, 2.9], ["racks", "A04", 13.2, 2.9], ["racks", "A05", 16.8, 2.9],
    ["network", "MMR-1", 24.2, 2.9], ["network", "ODF-1", 8.4, 9.6], ["pdus", "PDU-A", 1.6, 4.2], ["pdus", "PDU-B", 18.6, 4.2],
];

/** The canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** Lets each card answer at its centre, and the canvas everywhere else on it, as a page would hit them. */
function hits(container: HTMLElement) {
    const canvas = canvasOf(container);
    const found = CENTRES.flatMap(([kind, key, x, y]) => {
        const el = card(container, kind, key);
        return el === null ? [] : [[el, x, y] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y]) => Math.hypot(px - x * PPU, py - y * PPU) < 4)?.[0]
        ?? (px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvas : null));
}

/** Mounts an example, and waits until its racks are drawn and laid out for a press. */
async function open(example: { fn: { toIR(): unknown } }) {
    const ui = await h.mount(example);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    hits(ui.container);
    fireEvent.pointerEnter(canvasOf(ui.container));
    return ui;
}

// ── The library ─────────────────────────────────────────────────────────────

/** The library pane. */
const pane = (container: HTMLElement) => slot(container, "start");

/** Opens a tab, by its name. */
async function openTab(container: HTMLElement, name: string) {
    const tab = [...pane(container).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    await act(async () => { fireEvent.click(tab); });
    await settle();
}

/** A card of the open tab, by its key. */
function libraryCard(container: HTMLElement, key: string): HTMLElement {
    const found = pane(container).querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-library-item=${JSON.stringify(key)}]`);
    if (found === null) throw new Error(`no card ${key}`);
    return found;
}

/** A template's card's key: its kind's slot and its key, printed. */
const templateKey = (kind: string, key: string) => entityId({ kind, key });

// ── Dragging ────────────────────────────────────────────────────────────────

/** Picks a card up with the mouse, off the canvas: pressed, and carried past the 4px a drag starts after. */
function pickUp(cardEl: HTMLElement): void {
    act(() => { fireEvent.pointerDown(cardEl, { pointerId: 1, pointerType: "mouse", button: 0, clientX: -100, clientY: -100 }); });
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: -100, clientY: -94 }); });
}

/** Rests the drag at a world point of the canvas. */
function restOn(x: number, y: number): void {
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", ...at(PPU, x, y) }); });
}

/** Drops where the drag rests, and lets the Schematic settle. */
async function release(x: number, y: number): Promise<void> {
    act(() => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", ...at(PPU, x, y) }); });
    await settle();
}

/** What the ghost says: its caption, and whether it says why not — `null` while the ghost goes alone. */
const caption = () => {
    const el = document.querySelector(".east-drag-ghost [data-drag-caption]");
    return el === null ? null : { text: el.textContent, refused: el.hasAttribute("data-refused") };
};

/** Presses ⏎ on a card, as the keyboard does. */
async function enter(cardEl: HTMLElement): Promise<void> {
    cardEl.focus();
    await act(async () => { fireEvent.keyDown(cardEl, { key: "Enter", code: "Enter" }); });
    await settle();
}

// ── Reading the Schematic ───────────────────────────────────────────────────

/** A footer line, by its attribute; `undefined` while there is none. */
const footer = (container: HTMLElement, attribute: string) => slot(container, "footer").querySelector(`[${attribute}]`)?.textContent ?? undefined;

/** The changes waiting on Save, as the footer says them. */
const pending = (container: HTMLElement) => footer(container, "data-schematic-pending");

/** Why the last gesture was refused, as the footer says it. */
const refused = (container: HTMLElement) => footer(container, "data-schematic-refused");

/** Presses one of the history's buttons, and lets what it sends settle. */
async function history(container: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name })); });
    await settle();
}

/** Reads what the data centre's host keeps of the selection: its State, read through East. */
const readKeptSelection = East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
    return kept.read();
}), getRegisteredPlatformImplementations());

/** What the data centre's host keeps of the selection, decoded. */
const keptSelection = () => readKeptSelection();

/** The racks a test's drops leave, by key: the record as Save wrote it. */
async function savedRacks() {
    return h.read(ex.schematicRacks);
}

/** A rack as the data centre's 42U template makes it, at a point. */
const NEW_42U = (x: number, y: number): ValueTypeOf<typeof ex.DcRack> => ({
    name: "New 42U rack", x: some(x), y: some(y), w: 3.2, h: 1.2, model: "42U · 8 kW", hall: "Cage A", system: "power", owner: "",
});

afterEach(() => {
    window.matchMedia = MATCH_MEDIA;
});

/** The page's matchMedia, as the harness gives it. */
const MATCH_MEDIA = window.matchMedia;

// ============================================================================
// An item template, and a backlog row, onto the floor (SC12, SC4)
// ============================================================================

test("a rack template dropped on the floor adds a rack where it lands, its key minted new and selected; the ghost says where; one step one Undo takes back; Save writes it (SC12)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await openTab(container, "Templates");
    const cardEl = libraryCard(container, templateKey("racks", "r42"));
    expect(cardEl.hasAttribute("data-draggable")).toBe(true);
    pickUp(cardEl);
    // Picked up, over nothing: the ghost alone.
    expect(caption()).toBeNull();
    // Over Cage A's clear floor above the racks: the zone holding the point, and the point to the centimetre.
    restOn(12.0, 1.0);
    expect(caption()).toEqual({ text: "Cage A · 12.00, 1.00 m", refused: false });
    expect(canvasOf(container).hasAttribute("data-drop-active")).toBe(true);
    // Over the hot aisle, a hatched band that holds no item: the point alone.
    restOn(5.0, 13.4);
    expect(caption()).toEqual({ text: "5.00, 13.40 m", refused: false });
    restOn(12.0, 1.0);
    const stored = await savedRacks();
    await release(12.0, 1.0);
    expect(announced()).toBe("42U rack · 8 kW was dropped on Cage A · 12.00, 1.00 m.");
    // A rack under a key minted new, drawn where it landed and selected — the host hears it.
    await waitFor(() => expect(keptSelection()).toHaveLength(1));
    const added = keptSelection()[0]!;
    expect(added.kind).toBe("racks");
    expect(added.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    await waitFor(() => expect(card(container, "racks", added.key)?.hasAttribute("data-selected")).toBe(true));
    expect(pending(container)).toBe("1 pending");
    // One step: Undo takes it back whole.
    await history(container, UNDO);
    expect(card(container, "racks", added.key)).toBeNull();
    expect(pending(container)).toBeUndefined();
    await act(async () => { fireEvent.keyDown(canvasOf(container), { key: "z", metaKey: true, shiftKey: true }); });
    await settle();
    await waitFor(() => expect(card(container, "racks", added.key)).not.toBeNull());
    await history(container, SAVE);
    const saved = await savedRacks();
    expect([...saved.keys()].filter((key) => !stored.has(key))).toEqual([added.key]);
    expect(rackEqual(saved.get(added.key)!, NEW_42U(12.0, 1.0))).toBe(true);
});

test("a backlog row dropped on the floor is placed where it lands, and selected; the Backlog lists it no more (SC4)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await openTab(container, "Backlog");
    pickUp(libraryCard(container, entityId({ kind: "racks", key: "A06" })));
    restOn(18.0, 1.0);
    expect(caption()).toEqual({ text: "Cage A · 18.00, 1.00 m", refused: false });
    await release(18.0, 1.0);
    expect(announced()).toBe("A06 was dropped on Cage A · 18.00, 1.00 m.");
    await waitFor(() => expect(card(container, "racks", "A06")?.hasAttribute("data-selected")).toBe(true));
    expect(printRefs(keptSelection())).toBe(printRefs([{ kind: "racks", key: "A06" }]));
    expect([...pane(container).querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)[1]).toBe("Backlog 1");
    const stored = await savedRacks();
    await history(container, SAVE);
    expect(rackEqual((await savedRacks()).get("A06")!, { ...stored.get("A06")!, x: some(18.0), y: some(1.0) })).toBe(true);
});

// ============================================================================
// A link template onto a run (SC11), an author's card onto a rack
// ============================================================================

test("a fibre template dropped on a run writes its values over it, never its ends or its key; anywhere but on a run it is refused, naming where it lands (SC11)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await openTab(container, "Templates");
    pickUp(libraryCard(container, templateKey("fibre", "oob")));
    // Over the floor and over a rack: no run under it.
    restOn(14.0, 12.0);
    expect(caption()).toEqual({ text: "Drop onto a fibre run", refused: true });
    expect(canvasOf(container).hasAttribute("data-drop-invalid")).toBe(true);
    restOn(9.6, 2.9);
    expect(caption()).toEqual({ text: "Drop onto a fibre run", refused: true });
    // u3 runs down from A03, then across to ODF-1: on its line.
    restOn(9.6, 6.0);
    expect(caption()).toEqual({ text: "onto A03 → ODF-1", refused: false });
    const stored = await h.read(ex.schematicFibre);
    await release(9.6, 6.0);
    expect(announced()).toBe("Out-of-band management was dropped on A03 → ODF-1.");
    expect(pending(container)).toBe("1 pending");
    await history(container, SAVE);
    const saved = await h.read(ex.schematicFibre);
    expect([...saved.keys()]).toEqual([...stored.keys()]);
    // Its ends as they were, every other field the template's.
    expect(fibreEqual(saved.get("u3")!, {
        from: variant("rack", "A03"), to: variant("frame", "ODF-1"), path: [], label: some("OOB mgmt"), speed: none, cable: variant("logical", null), system: "network",
    })).toBe(true);
});

test("an owner's card dropped on a rack sets its owner, the rack marked while the drag rests on it; on another kind's item it is refused (Schematic.patch)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await openTab(container, "Owners");
    pickUp(libraryCard(container, "elmway"));
    restOn(1.6, 4.2);
    expect(caption()).toEqual({ text: "Drop onto a rack", refused: true });
    expect(card(container, "pdus", "PDU-A")!.hasAttribute("data-drop-target")).toBe(false);
    restOn(9.6, 2.9);
    expect(caption()).toEqual({ text: "onto A03", refused: false });
    expect(card(container, "racks", "A03")!.hasAttribute("data-drop-target")).toBe(true);
    const stored = await savedRacks();
    await release(9.6, 2.9);
    expect(announced()).toBe("Elmway College was dropped on A03.");
    // The drag over, nothing stays marked; the drop selects nothing.
    expect(container.querySelector("[data-drop-target]")).toBeNull();
    expect(keptSelection()).toEqual([]);
    await history(container, SAVE);
    expect(rackEqual((await savedRacks()).get("A03")!, { ...stored.get("A03")!, owner: "Elmway College" })).toBe(true);
});

/** The data centre's racks bound read only, beside its owners' tab. */
const readOnlyRacks = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bind(ex.schematicRacks));
    const owners = $.let(Data.bind(ex.schematicOwners));
    return Schematic({
        id: "readOnlyDrops",
        extent: { width: 28, height: 14 },
        items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }) },
        library: [Schematic.library.tab(owners.read(), {
            name: "Owners", icon: "building", label: (o) => o.name, drop: (o) => Schematic.patch(ex.DcRack, { owner: o.name }),
        })],
    });
}))) };

test("racks bound read only refuse every drop of a card that lands on them, the ghost saying why; dropping, and ⏎, change nothing (SC14)", async () => {
    const { container } = await open(readOnlyRacks);
    await openTab(container, "Owners");
    pickUp(libraryCard(container, "elmway"));
    restOn(9.6, 2.9);
    expect(caption()).toEqual({ text: "Racks are read only", refused: true });
    await release(9.6, 2.9);
    expect(announced()).toBe("Elmway College was not dropped.");
    await tap(canvasOf(container), PPU, 9.6, 2.9);
    await enter(libraryCard(container, "elmway"));
    expect(refused(container)).toBe("Racks are read only");
    expect(h.requests("mutate")).toEqual([]);
});

// ============================================================================
// ⏎ on a card, and a tap on a touch screen (SC13)
// ============================================================================

test("⏎ on an owner's card sets it on the selected rack — on every selected rack, as one step — and, with none selected, is refused in the footer until one lands (SC13)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await openTab(container, "Owners");
    await enter(libraryCard(container, "northwind"));
    expect(refused(container)).toBe("Drop onto a rack");
    expect(pending(container)).toBeUndefined();
    // A02, Harbour Labs', selected: ⏎ hands it to Northwind Media, the footer's line goes.
    await tap(canvas, PPU, 6.0, 2.9);
    await enter(libraryCard(container, "northwind"));
    expect(refused(container)).toBeUndefined();
    expect(pending(container)).toBe("1 pending");
    // A04, Northwind Media's, and A05, Elmway College's, selected — a tap and a Shift-tap: ⏎ hands both to Harbour Labs, one step.
    await tap(canvas, PPU, 13.2, 2.9);
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, shiftKey: true, ...at(PPU, 16.8, 2.9) });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, shiftKey: true, ...at(PPU, 16.8, 2.9) });
    });
    await waitFor(() => expect(keptSelection()).toHaveLength(2));
    await enter(libraryCard(container, "harbour"));
    expect(pending(container)).toBe("3 pending");
    await history(container, UNDO);
    expect(pending(container)).toBe("1 pending");
    await act(async () => { fireEvent.keyDown(canvas, { key: "z", metaKey: true, shiftKey: true }); });
    await settle();
    const stored = await savedRacks();
    await history(container, SAVE);
    const saved = await savedRacks();
    expect(rackEqual(saved.get("A02")!, { ...stored.get("A02")!, owner: "Northwind Media" })).toBe(true);
    for (const key of ["A04", "A05"]) expect(rackEqual(saved.get(key)!, { ...stored.get(key)!, owner: "Harbour Labs" })).toBe(true);
});

test("⏎ on a rack template adds the rack at the view's centre, selected — never picked up", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await openTab(container, "Templates");
    const cardEl = libraryCard(container, templateKey("racks", "r48"));
    const stored = await savedRacks();
    await enter(cardEl);
    expect(cardEl.hasAttribute("data-dragging")).toBe(false);
    await waitFor(() => expect(keptSelection()).toHaveLength(1));
    const added = keptSelection()[0]!;
    await waitFor(() => expect(card(container, "racks", added.key)?.hasAttribute("data-selected")).toBe(true));
    await history(container, SAVE);
    // The view's centre: the fitted floor's middle, 14 × 7 m.
    expect(rackEqual((await savedRacks()).get(added.key)!, {
        name: "New 48U rack", x: some(14.0), y: some(7.0), w: 3.2, h: 1.2, model: "48U · 12 kW", hall: "Cage A", system: "power", owner: "",
    })).toBe(true);
    expect((await savedRacks()).size).toBe(stored.size + 1);
});

test("on a touch screen a tap on the selected card does what ⏎ does, and leaves it selected — a tap on another card only moves the selection (SC13)", async () => {
    window.matchMedia = ((query: string) => ({
        matches: query === "(pointer: coarse)", media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    })) as unknown as typeof window.matchMedia;
    const { container } = await open(ex.schematicDataCentre);
    await tap(canvasOf(container), PPU, 6.0, 2.9);
    await openTab(container, "Owners");
    const picked = () => ["elmway", "harbour", "northwind"].filter((key) => libraryCard(container, key).hasAttribute("data-placed"));
    const touch = async (key: string) => {
        await act(async () => { fireEvent.click(libraryCard(container, key)); });
        await settle();
    };
    // The first tap selects a card; a tap on another moves the selection: nothing dropped yet.
    await touch("elmway");
    expect([picked(), pending(container)]).toEqual([["elmway"], undefined]);
    await touch("northwind");
    expect([picked(), pending(container)]).toEqual([["northwind"], undefined]);
    // A tap on the selected card drops it on the selected rack, A02, and leaves it selected.
    await touch("northwind");
    expect([picked(), pending(container)]).toEqual([["northwind"], "1 pending"]);
    const stored = await savedRacks();
    await history(container, SAVE);
    expect(rackEqual((await savedRacks()).get("A02")!, { ...stored.get("A02")!, owner: "Northwind Media" })).toBe(true);
});

// ============================================================================
// Connect takes the selected template's values (§4.3, SC9)
// ============================================================================

test("Connect records a run with the values of the fibre template the library has selected, and its type's defaults once it is let go (SC9)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await openTab(container, "Templates");
    await act(async () => { fireEvent.click(libraryCard(container, templateKey("fibre", "uplink"))); });
    await settle();
    expect(libraryCard(container, templateKey("fibre", "uplink")).hasAttribute("data-placed")).toBe(true);
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name: "Connect" })); });
    const drag = async (from: readonly [number, number], to: readonly [number, number]) => {
        await act(async () => {
            fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(PPU, from[0], from[1]) });
            fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, ...at(PPU, to[0], to[1]) });
            fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, ...at(PPU, to[0], to[1]) });
        });
        await settle();
    };
    const stored = await h.read(ex.schematicFibre);
    await drag([16.8, 2.9], [24.2, 2.9]);
    // Let go of the template: the next run takes its type's defaults.
    await act(async () => { fireEvent.click(libraryCard(container, templateKey("fibre", "uplink"))); });
    await settle();
    await drag([13.2, 2.9], [24.2, 2.9]);
    await history(container, SAVE);
    const saved = await h.read(ex.schematicFibre);
    const added = [...saved].filter(([key]) => !stored.has(key)).map(([, run]) => run);
    expect(added).toHaveLength(2);
    const byEnd = (rack: string) => added.find((run) => endEqual(run.from, variant("rack", rack)))!;
    expect(fibreEqual(byEnd("A05"), {
        from: variant("rack", "A05"), to: variant("frame", "MMR-1"), path: [], label: some("uplink"), speed: some("100G"), cable: variant("fibre", null), system: "network",
    })).toBe(true);
    expect(fibreEqual(byEnd("A04"), { ...defaultValue<typeof ex.DcFibre>(ex.DcFibre), from: variant("rack", "A04"), to: variant("frame", "MMR-1") })).toBe(true);
});
