/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's inspector on e3 itself (#1391, `Schematic Builder Spec.md`
 * §9, SC15, SC16): given `inspector`, the end pane's Details and Issues.
 * Details shows the drawing with nothing selected — its counts, and each
 * record's last save with who made it; an item — its head, its kind's form
 * over the fields no role writes, its details record's form, its position and
 * Unplace, what it is joined to, each selecting it, and Delete; a kind's own
 * Details in place of its form, its `update` one step; a zone's form; a link's
 * ends as Choosers; a net's sides as tags, an emptied side refused; a net's
 * leg and Remove; several, by kind, and Delete — every edit one step of the
 * history, a field its drafts changed tinted, Save writing it. Read only, every
 * field shows and none edits. Enter, or a double-click on an entity, opens
 * Details. Issues lists the drawing's issues — an item outside the extent, a
 * footprint past its box, a run naming a frame no kind holds, a layer's colour
 * naming no theme colour — and the app's check refusing a row and a Save's
 * refusal, each selecting what it names.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin, and each card the tests press answers at
 * its centre.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrayType, East, StringType, equalFor, printFor, some, variant } from "@elaraai/east";
import { Editing, Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { at, card, drawingCounts, layOutCanvas, tap, unsaved } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The data centre's px a metre: its 28 × 14 m drawing fitted to the canvas's 1080 × 540 px. */
const PPU = 1080 / 28;

const rackEqual = equalFor(ex.DcRack);
const feedEqual = equalFor(ex.DcFeed);
const printRefs = printFor(ArrayType(Schematic.Types.Ref));
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();

/** Where each card the tests press sits, by kind, key and centre in metres. */
const CENTRES: readonly (readonly [kind: string, key: string, x: number, y: number])[] = [
    ["racks", "A01", 2.4, 2.9], ["racks", "A02", 6.0, 2.9], ["racks", "A03", 9.6, 2.9], ["racks", "A04", 13.2, 2.9], ["racks", "A05", 16.8, 2.9],
    ["network", "MMR-1", 24.2, 2.9], ["network", "ODF-1", 8.4, 9.6], ["pdus", "PDU-A", 1.6, 4.2], ["pdus", "PDU-B", 18.6, 4.2],
    ["cooling", "CRAH-1", 3.0, 11.9], ["cooling", "CRAH-2", 9.0, 11.9], ["cooling", "CRAH-3", 15.0, 11.9],
];

/** The canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** Lets each card answer at its centre, as a page would hit it, and the canvas everywhere else on it. */
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

// ── The pane ────────────────────────────────────────────────────────────────

/** The inspector pane. */
const pane = (c: HTMLElement): HTMLElement => slot(c, "end");
/** Its open tab's panel. */
const panel = (c: HTMLElement): HTMLElement => pane(c).querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** Its tabs, as their names and counts read. */
const tabs = (c: HTMLElement): (string | null)[] => [...pane(c).querySelectorAll("[role='tab']")].map((t) => t.textContent);
/** What Details shows. */
const showing = (c: HTMLElement): string | null => panel(c).querySelector("[data-schematic-inspector]")?.getAttribute("data-schematic-inspector") ?? null;
/** Details' head: its kind, its name, where it stands, its status and its chip. */
const head = (c: HTMLElement) => ({
    kind: panel(c).querySelector("[data-inspector-kind]")?.textContent ?? null,
    title: panel(c).querySelector("[data-inspector-title]")?.textContent ?? null,
    when: panel(c).querySelector("[data-inspector-when]")?.textContent ?? null,
    status: panel(c).querySelector("[data-inspector-status]")?.textContent ?? null,
    chip: panel(c).querySelector("[data-inspector-marks] > [data-state]")?.textContent ?? null,
});
/** A section of Details: `row`, `details`, `position`, `ends`, `sides`. */
const section = (c: HTMLElement, name: string): HTMLElement | null => panel(c).querySelector<HTMLElement>(`[data-inspector-fields="${name}"]`);
/** A section's fields in order, each its key and its editor. */
const editors = (c: HTMLElement, name: string): string[] => [...section(c, name)!.querySelectorAll("[data-field]")]
    .map((el) => `${el.getAttribute("data-field")}:${el.getAttribute("data-editor")}`);
/** A field of a section, by its key. */
const field = (c: HTMLElement, name: string, key: string): HTMLElement => section(c, name)!.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
/** A gesture's button in Details. */
const action = (c: HTMLElement, name: "delete" | "unplace" | "remove"): HTMLButtonElement | null => panel(c).querySelector(`[data-inspector-action="${name}"]`);
/** What an item is joined to, as Details lists it, by the entities' ids. */
const joins = (c: HTMLElement): (string | null)[] => [...panel(c).querySelectorAll("[data-inspector-join]")].map((el) => el.getAttribute("data-inspector-join"));
/** A footer line, by its attribute; `undefined` while there is none. */
const footer = (c: HTMLElement, attribute: string) => slot(c, "footer").querySelector(`[${attribute}]`)?.textContent ?? undefined;

/** Clicks an element, as a pointer does, and lets the Schematic settle. */
async function click(el: Element): Promise<void> {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** Presses one of the history's buttons, and lets what it sends settle. */
async function history(c: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("button", { name })); });
    await settle();
}

/** Opens one of the inspector's tabs, by its name. */
async function openTab(c: HTMLElement, name: string): Promise<void> {
    const tab = [...pane(c).querySelectorAll("[role='tab']")].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no inspector tab ${name}`);
    await click(tab);
}

/** Types a text field's new text and commits it with ⏎. */
async function retype(c: HTMLElement, name: string, key: string, text: string): Promise<void> {
    const user = userEvent.setup();
    const box = within(field(c, name, key)).getByRole("textbox");
    await user.clear(box);
    if (text !== "") await user.type(box, text);
    await user.type(box, "{Enter}");
    await settle();
}

/** Types a number field's new value, a key at a time — the shared input writes back on a frame — and commits it with ⏎. */
async function retypeNumber(c: HTMLElement, name: string, key: string, text: string): Promise<void> {
    const user = userEvent.setup();
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
    await act(async () => { fireEvent.click(within(listbox).getByRole("option", { name: option })); });
    await settle();
}

/** Reads what the data centre's host keeps of the selection: its State, read through East. */
const readKeptSelection = East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
    return kept.read();
}), getRegisteredPlatformImplementations());

/** What the data centre's host keeps of the selection, as East prints it. */
const keptSelection = () => printRefs(readKeptSelection());

// ============================================================================
// The pane, and nothing selected: the drawing
// ============================================================================

test("given `inspector`, the end pane holds Details and Issues; nothing selected, Details shows the drawing — its counts, and each record's last save with who made it", async () => {
    const { container } = await open(ex.schematicDataCentre);
    expect(tabs(container)).toEqual(["Details", "Issues 0"]);
    expect(showing(container)).toBe("drawing");
    const counts = () => [...panel(container).querySelectorAll("[data-inspector-counts] [data-count]")]
        .map((el) => [el.getAttribute("data-count"), el.children[0]?.textContent, el.children[1]?.textContent]);
    expect(counts()).toEqual([
        ["racks", "5", "Rack"], ["network", "3", "Network frame"], ["cooling", "3", "Cooling unit"], ["pdus", "2", "Power distribution unit"],
        ["zones", "5", "Zones"], ["links", "6", "Links"], ["nets", "2", "Nets"],
    ]);
    // A rack's owner changed and saved: the drawing says when its record was saved, and by whom.
    await tap(canvasOf(container), PPU, 9.6, 2.9);
    await retype(container, "row", "owner", "Harbour Labs");
    await history(container, SAVE);
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    await settle();
    expect(showing(container)).toBe("drawing");
    await waitFor(() => expect(panel(container).querySelector("[data-inspector-saved='racks']")?.textContent).toMatch(/^Rack saved .+ by \S/u));
});

// ============================================================================
// An item (SC15)
// ============================================================================

test("an item: its head, its kind's form over the fields no role writes, its details', its position and what it is joined to; a field edited is one step, tinted, Undo taking it back, Save writing it", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await tap(canvasOf(container), PPU, 9.6, 2.9);
    expect(showing(container)).toBe("item");
    expect(head(container)).toEqual({ kind: "Rack", title: "A03", when: "Cage A · 9.60, 2.90 m", status: "OK", chip: null });
    // The rack's own fields — its name the label, its centre and box the position's, its system its layer: none of them here.
    expect(editors(container, "row")).toEqual(["model:text", "hall:text", "owner:text"]);
    expect(editors(container, "details")).toEqual(["kw:number", "capacity:number", "alarm:select"]);
    expect(editors(container, "position")).toEqual(["x:number", "y:number"]);
    expect(joins(container)).toEqual(['(kind="fibre", key="u3")', '(kind="feeds", key="feed-a")']);
    // The owner, retyped: one step, Pending, the field tinted against the record.
    await retype(container, "row", "owner", "Harbour Labs");
    expect(unsaved(container)).toBe(true);
    expect(head(container).chip).toBe("Pending");
    expect(field(container, "row", "owner").hasAttribute("data-dirty")).toBe(true);
    await history(container, UNDO);
    expect(unsaved(container)).toBe(false);
    expect(head(container).chip).toBeNull();
    expect(field(container, "row", "owner").hasAttribute("data-dirty")).toBe(false);
    await history(container, REDO);
    const stored = await h.read(ex.schematicRacks);
    await history(container, SAVE);
    expect(rackEqual((await h.read(ex.schematicRacks)).get("A03")!, { ...stored.get("A03")!, owner: "Harbour Labs" })).toBe(true);
    // What it is joined to selects: its feed.
    await click(panel(container).querySelector("[data-inspector-join='(kind=\"feeds\", key=\"feed-a\")']")!);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "feeds", key: "feed-a" }])));
    expect(showing(container)).toBe("net");
});

test("its details record's form writes the item's details row, and its position its centre, each one step; Unplace takes it off the drawing into the backlog", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await tap(canvas, PPU, 9.6, 2.9);
    // A03's capacity, in its load: the details record's own session.
    await retypeNumber(container, "details", "capacity", "9.5");
    expect(unsaved(container)).toBe(true);
    // Its x: the card moves.
    const before = card(container, "racks", "A03")!.style.transform;
    await retypeNumber(container, "position", "x", "10.6");
    expect(card(container, "racks", "A03")!.style.transform).not.toBe(before);
    const loads = await h.read(ex.schematicRackLoads);
    const racks = await h.read(ex.schematicRacks);
    await history(container, SAVE);
    expect(equalFor(ex.DcLoad)((await h.read(ex.schematicRackLoads)).get("A03")!, { ...loads.get("A03")!, capacity: 9.5 })).toBe(true);
    expect(rackEqual((await h.read(ex.schematicRacks)).get("A03")!, { ...racks.get("A03")!, x: some(10.6) })).toBe(true);
    // A04 unplaced: drawn nowhere, listed in the backlog, and Details shows the drawing again.
    await tap(canvas, PPU, 13.2, 2.9);
    expect(head(container).title).toBe("A04");
    await click(action(container, "unplace")!);
    expect(card(container, "racks", "A04")).toBeNull();
    expect(showing(container)).toBe("drawing");
    expect([...slot(container, "start").querySelectorAll("[role='tab']")].map((t) => t.textContent)[1]).toBe("Backlog 3");
    expect(unsaved(container)).toBe(true);
});

test("a kind's own Details shows in place of its form, and its update is one step Save writes", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await tap(canvasOf(container), PPU, 9.0, 11.9);
    expect(head(container).title).toBe("CRAH-2");
    const own = () => section(container, "row")!;
    expect(own().querySelector("[data-field]")).toBeNull();
    expect(own().textContent).toContain("CRAH-2 holds 22.0 °C");
    await click(within(own()).getByRole("button", { name: "Lower the setpoint by 1 °C" }));
    expect(unsaved(container)).toBe(true);
    await waitFor(() => expect(own().textContent).toContain("CRAH-2 holds 21.0 °C"));
    expect(head(container).chip).toBe("Pending");
    const stored = await h.read(ex.schematicCooling);
    await history(container, SAVE);
    expect(equalFor(ex.DcCooling)((await h.read(ex.schematicCooling)).get("CRAH-2")!, { ...stored.get("CRAH-2")!, setpoint: 21.0 })).toBe(true);
});

/** The data centre's racks beside their loads bound read only, read whole, with the inspector. */
const readOnlyLoads = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const loads = $.let(Data.bind(ex.schematicRackLoads));
    return Schematic({
        id: "readOnlyLoads",
        inspector: true,
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                details: Schematic.details(loads, { meter: (l) => ({ value: l.kw, max: l.capacity }) }),
            }),
        },
    });
}))) };

/** The same, in a Schematic read only. */
const readOnlyFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const loads = $.let(Data.bind(ex.schematicRackLoads));
    return Schematic({
        id: "readOnlyFloor",
        inspector: true,
        readOnly: true,
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                details: Schematic.details(loads, { meter: (l) => ({ value: l.kw, max: l.capacity }) }),
            }),
        },
    });
}))) };

test("read only, every field shows and none edits: details bound read only beside a kind that writes, and every record of a Schematic read only", async () => {
    {
        const { container, unmount } = await open(readOnlyLoads);
        await tap(canvasOf(container), PPU, 9.6, 2.9);
        expect(editors(container, "row")).toEqual(["model:text", "hall:text", "owner:text"]);
        expect(editors(container, "details")).toEqual(["kw:readonly", "capacity:readonly", "alarm:readonly"]);
        expect(action(container, "delete")).not.toBeNull();
        unmount();
    }
    const { container } = await open(readOnlyFloor);
    await tap(canvasOf(container), PPU, 9.6, 2.9);
    expect(showing(container)).toBe("item");
    expect(editors(container, "row")).toEqual(["model:readonly", "hall:readonly", "owner:readonly"]);
    expect(editors(container, "details")).toEqual(["kw:readonly", "capacity:readonly", "alarm:readonly"]);
    expect(editors(container, "position")).toEqual(["x:readonly", "y:readonly"]);
    expect(panel(container).querySelector("[data-inspector-action]")).toBeNull();
    expect(h.requests("mutate")).toEqual([]);
});

// ============================================================================
// A zone, a link, a net and its leg, several
// ============================================================================

test("a zone shows its form; a link its ends as Choosers over the items of its slots, a new end one step, and Delete", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    // The areas ride the structure layer, which its author locks: unlocked in the Layers tab, Cage A's clear floor
    // above its racks selects it.
    const layersTab = [...slot(container, "start").querySelectorAll("[role='tab']")].find((t) => t.textContent?.startsWith("Layers"))!;
    await click(layersTab);
    await click(slot(container, "start").querySelector("[data-schematic-layer='structure'] [data-layer-toggle='lock']")!);
    await tap(canvas, PPU, 12.0, 1.0);
    expect(showing(container)).toBe("zone");
    expect(head(container)).toEqual({ kind: "Area", title: "Cage A", when: "19.60 × 4.60 m", status: null, chip: null });
    expect(editors(container, "row")).toEqual(["kind:readonly"]);
    // u3, from A03 to ODF-1, tapped on its line: its ends, each a Chooser.
    await tap(canvas, PPU, 9.6, 6.0);
    expect(showing(container)).toBe("link");
    expect(head(container)).toEqual({ kind: "Fibre run", title: "u3", when: "A03 → ODF-1", status: null, chip: null });
    expect(editors(container, "ends")).toEqual(["from:reference", "to:reference"]);
    await choose(container, "ends", "to", "MMR-1 · Network frame");
    expect(unsaved(container)).toBe(true);
    expect(head(container).when).toBe("A03 → MMR-1");
    const stored = await h.read(ex.schematicFibre);
    await history(container, SAVE);
    expect(equalFor(ex.DcFibre)((await h.read(ex.schematicFibre)).get("u3")!, { ...stored.get("u3")!, to: variant("frame", "MMR-1") })).toBe(true);
    // Delete: the run goes, one step.
    await click(action(container, "delete")!);
    expect(showing(container)).toBe("drawing");
    expect(drawingCounts(container).links).toBe("5");
});

test("a net shows its sides as tags, a member taken off one step and an emptied side refused in the footer's words; a leg shows its item, and Remove takes it off its side", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    // Feed A's bar, under A01 to A03.
    await tap(canvas, PPU, 4.2, 3.8);
    expect(showing(container)).toBe("net");
    expect(head(container)).toEqual({ kind: "Power feed", title: "PDU-A · A side", when: "1 source → 3 destinations", status: null, chip: null });
    const tags = (key: string) => [...field(container, "sides", key).querySelectorAll("[data-scope=tags-input][data-part=item-text]")].map((el) => el.textContent);
    expect([tags("sources"), tags("destinations")]).toEqual([["PDU-A"], ["A01", "A02", "A03"]]);
    // A03 taken off the fed side.
    await click(field(container, "sides", "destinations").querySelectorAll("[data-part=item-delete-trigger]")[2]!);
    expect(unsaved(container)).toBe(true);
    expect(tags("destinations")).toEqual(["A01", "A02"]);
    // Its only source taken off: refused, the footer saying why, the side as it was.
    await click(field(container, "sides", "sources").querySelector("[data-part=item-delete-trigger]")!);
    expect(footer(container, "data-schematic-refused")).toBe("A net keeps one source at least: Delete takes the net");
    expect(tags("sources")).toEqual(["PDU-A"]);
    // Feed B's leg to A05, tapped: its item, and Remove.
    await tap(canvas, PPU, 16.8, 3.5);
    expect(showing(container)).toBe("leg");
    expect(head(container).when).toBe("Destination leg");
    expect(panel(container).querySelector("[data-inspector-member] [data-inspector-join]")?.textContent).toBe("A05Destination leg");
    await click(action(container, "remove")!);
    expect(showing(container)).toBe("net");
    const stored = await h.read(ex.schematicFeeds);
    await history(container, SAVE);
    // Feed A without A03, its source as it was — the emptied side refused — and feed B without A05: every other field as it was.
    const feeds = await h.read(ex.schematicFeeds);
    expect(feedEqual(feeds.get("feed-a")!, { ...stored.get("feed-a")!, racks: ["A01", "A02"] })).toBe(true);
    expect(feedEqual(feeds.get("feed-b")!, { ...stored.get("feed-b")!, racks: ["A04"] })).toBe(true);
});

test("several show how many of each kind, and Delete takes them all with what names them, as one step; the selection moving between kinds shows each in turn", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    // A rack, then a power unit, then a frame: each kind's Details in turn, each its own row.
    await tap(canvas, PPU, 9.6, 2.9);
    expect(head(container).title).toBe("A03");
    await tap(canvas, PPU, 1.6, 4.2);
    expect(head(container)).toMatchObject({ kind: "Power distribution unit", title: "PDU-A" });
    expect(editors(container, "row")).toEqual(["kind:readonly"]);
    await tap(canvas, PPU, 8.4, 9.6);
    expect(head(container)).toMatchObject({ kind: "Network frame", title: "ODF-1" });
    // A01, and A02 Shift-tapped beside it.
    await tap(canvas, PPU, 2.4, 2.9);
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, shiftKey: true, ...at(PPU, 6.0, 2.9) });
        fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, shiftKey: true, ...at(PPU, 6.0, 2.9) });
    });
    await settle();
    expect(showing(container)).toBe("several");
    expect(panel(container).querySelector("[data-inspector-several]")?.textContent).toBe("2 selected");
    expect([...panel(container).querySelectorAll("[data-inspector-count]")].map((el) => el.textContent)).toEqual(["2 racks"]);
    // Delete: both racks, their three runs and their feed legs — six rows, one step.
    await click(action(container, "delete")!);
    expect(card(container, "racks", "A01")).toBeNull();
    expect(card(container, "racks", "A02")).toBeNull();
    // Their three runs went with them, and their legs of feed A, which feeds A03 still.
    expect(showing(container)).toBe("drawing");
    expect(drawingCounts(container)).toEqual({ racks: "3", network: "3", cooling: "3", pdus: "2", zones: "5", links: "3", nets: "2" });
    // One step: Undo takes back all six rows, and nothing waits on Save.
    await history(container, UNDO);
    expect(unsaved(container)).toBe(false);
});

test("Enter on the canvas, or a double-click on an entity, opens what is selected in Details — the pane too, collapsed; with nothing selected Enter does nothing", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await click(within(pane(container)).getByRole("button", { name: "Collapse Inspector" }));
    expect(pane(container).hasAttribute("data-collapsed")).toBe(true);
    // Nothing selected: Enter opens nothing.
    await act(async () => { fireEvent.keyDown(canvas, { key: "Enter" }); });
    await settle();
    expect(pane(container).hasAttribute("data-collapsed")).toBe(true);
    // A03 selected: Enter opens the pane on Details.
    await tap(canvas, PPU, 9.6, 2.9);
    await act(async () => { fireEvent.keyDown(canvas, { key: "Enter" }); });
    await settle();
    expect(pane(container).hasAttribute("data-collapsed")).toBe(false);
    expect(showing(container)).toBe("item");
    // On Issues, a double-click on a rack opens Details.
    await openTab(container, "Issues");
    expect(showing(container)).toBeNull();
    await act(async () => { fireEvent.doubleClick(canvas, at(PPU, 13.2, 2.9)); });
    await settle();
    expect(pane(container).querySelector("[role='tab'][aria-selected='true']")?.textContent).toBe("Details");
    expect(showing(container)).toBe("item");
});

// ============================================================================
// Issues (SC16)
// ============================================================================

/** The Issues tab's rows: each what it names and what it says, and whether it blocks. */
const issueRows = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-inspector-issue]")].map((el) => [
    el.children[0]?.textContent, el.children[1]?.textContent, el.children[1]?.getAttribute("data-kind"),
]);

test("Issues lists the drawing's issues — an item outside the extent, a footprint past its box, a run naming a frame no kind holds, a layer's colour naming no theme colour — each selecting what it names", async () => {
    const { container } = await open(ex.schematicDataCentre);
    await openTab(container, "Issues");
    expect(panel(container).querySelector("[data-inspector-no-issues]")).not.toBeNull();
    // Another session's commits: A05 past the floor's east edge, CRAH-1 wider than its box, u1 to a frame no row stands
    // for, and the power layer's colour a token the theme holds none of.
    const racks = await h.read(ex.schematicRacks);
    await h.patch(ex.schematicRacks, new Map([...racks, ["A05", { ...racks.get("A05")!, x: some(30.0) }]]));
    const cooling = await h.read(ex.schematicCooling);
    await h.patch(ex.schematicCooling, new Map([...cooling, ["CRAH-1", { ...cooling.get("CRAH-1")!, radius: 1.0 }]]));
    const fibre = await h.read(ex.schematicFibre);
    await h.patch(ex.schematicFibre, new Map([...fibre, ["u1", { ...fibre.get("u1")!, to: variant("frame", "ODF-9") }]]));
    const systems = await h.read(ex.schematicSystems);
    await h.patch(ex.schematicSystems, new Map([...systems, ["power", { ...systems.get("power")!, colour: "heat.9" }]]));
    await waitFor(() => expect(issueRows(container)).toHaveLength(4), { timeout: 10_000 });
    expect(tabs(container)[1]).toBe("Issues 4");
    expect(issueRows(container)).toEqual([
        ["Rack · A05", "Outside the drawing", "warning"],
        ["Cooling unit · CRAH-1", "Its shape reaches past its box", "warning"],
        ["Fibre run · u1", "Names Network frame ODF-9, which no network frame holds", "warning"],
        ["Layer · Power", "Its colour, heat.9, is no theme colour: it draws its tone", "warning"],
    ]);
    const issue = (i: number) => panel(container).querySelectorAll("[data-inspector-issue]")[i]!;
    await click(issue(2));
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "fibre", key: "u1" }])));
    await click(issue(0));
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A05" }])));
    // A layer is no entity: its issue selects nothing.
    await click(issue(3));
    await waitFor(() => expect(keptSelection()).toBe(printRefs([])));
});

/** The data centre's racks, a rack let to no one held back by the app's own check, with the inspector. */
const checkedRacks = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    // A rack is let to someone: one whose owner is emptied holds Save, its field named.
    const owned = $.const(East.function([ex.DcRack, StringType], Editing.Types.Readiness, ($2, rack, _key) => {
        $2.if(rack.owner.equal(""), ($3) => {
            $3.return(East.value(variant("incomplete", [{ field: "owner", message: "A rack is let to someone" }]), Editing.Types.Readiness));
        });
        return East.value(variant("ready", null), Editing.Types.Readiness);
    }));
    return Schematic({
        id: "checked",
        inspector: true,
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                ready: (rack, key) => owned(rack, key),
            }),
        },
    });
}))) };

test("the app's check refusing a drafted row blocks in Issues, naming its field, and selects the row's item", async () => {
    const { container } = await open(checkedRacks);
    await tap(canvasOf(container), PPU, 9.6, 2.9);
    await retype(container, "row", "owner", "");
    expect(unsaved(container)).toBe(true);
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    await settle();
    await openTab(container, "Issues");
    expect(issueRows(container)).toEqual([["Rack · A03", "owner: A rack is let to someone", "invalid"]]);
    await click(panel(container).querySelector("[data-inspector-issue]")!);
    await waitFor(() => expect(card(container, "racks", "A03")?.hasAttribute("data-selected")).toBe(true));
});

/** The floor's racks beside fibre runs whose patch door refuses every change, with the inspector. */
const frozenFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const fibre = $.let(Record.bind(ex.schematicFrozenFibre, [ex.schematicFrozenFibrePatch]));
    const ends = { field: "from", of: { rack: "racks", frame: "network" } } as const;
    return Schematic({
        id: "frozen",
        inspector: true,
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
        links: { fibre: Schematic.links(fibre, { name: "Fibre run", icon: "bolt", via: "path", from: ends, to: { ...ends, field: "to" } }) },
    });
}))) };

test("a Save its record's door refuses blocks in Issues, in the source's words, while it stands", async () => {
    const { container } = await open(frozenFloor);
    // u3, tapped on its line: its label edited — a change of the run the door refuses.
    await tap(canvasOf(container), PPU, 9.6, 6.0);
    expect(showing(container)).toBe("link");
    await retype(container, "row", "system", "power");
    expect(unsaved(container)).toBe(true);
    await history(container, SAVE);
    await openTab(container, "Issues");
    const rows = issueRows(container);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(([where, , kind]) => where?.startsWith("Fibre run · ") === true && kind === "invalid")).toBe(true);
    expect(rows.some(([, said]) => said?.includes("the fibre runs are frozen") === true)).toBe(true);
    expect(unsaved(container)).toBe(true);
});
