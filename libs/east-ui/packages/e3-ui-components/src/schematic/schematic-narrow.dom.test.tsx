/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's narrow layout on e3 itself (#1394, `Schematic Builder Spec.md`
 * §9, D15, SC25), over the data centre's floor. Below 480px of main nothing
 * registers to drag — no library card drags, the canvas is no drop cell, and a
 * selected run draws no handle, a press at its end re-targeting nothing — and
 * the tools hold no Move or Connect, the one held kept for a wider main;
 * resizing keeps the selection and the drafts. Details takes the gestures'
 * place: an item's Connect to… records a run as a Connect drag does, one step
 * Save writes, and the host's veto refuses a pair in the footer's words; the
 * Backlog's card picked is an item with no position, whose Place — or a tap on
 * the card — puts it at the canvas's centre, selected, its fields Details' then.
 * A run's ends and a trunk's sides are held to the veto at any width, as their
 * gestures are.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin — its width, as main's, the harness's
 * (`width`) — and each card the tests press answers at its centre.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrayType, East, defaultValue, equalFor, printFor, some, variant } from "@elaraai/east";
import { State } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot, width } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
import { at, card, fitted, layOutCanvas, near, tap, unsaved } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The camera the canvas fits the data centre's 28 × 14 m drawing with. */
const CAM = fitted(28, 14);

/** ODF-1's top edge, in metres — where u1, down from A01, meets it: its handle there once it is selected (#1403). */
const ODF1_TOP = 9.6 - 37 / 2 / CAM.ppu;

const rackEqual = equalFor(ex.DcRack);
const fibreEqual = equalFor(ex.DcFibre);
const trunkEqual = equalFor(ex.DcTrunk);
const printRefs = printFor(ArrayType(Schematic.Types.Ref));
const SAVE = editingMessages.apply();

/** What nothing on a narrow main may carry: a drag source or a drop target. */
const DRAG = "[data-draggable], [data-drag-cell]";

/**
 * Where each card the tests press sits, by kind, key and centre in metres. The power distribution units and the cooling
 * units, whose boxes hold no card's words at Fit, draw as their pins, which the canvas hits itself (#1393).
 */
const CENTRES: readonly (readonly [kind: string, key: string, x: number, y: number])[] = [
    ["racks", "A01", 2.4, 2.9], ["racks", "A02", 6.0, 2.9], ["racks", "A03", 9.6, 2.9], ["racks", "A04", 13.2, 2.9], ["racks", "A05", 16.8, 2.9],
    ["network", "MMR-1", 24.2, 2.9], ["network", "ODF-1", 8.4, 9.6],
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
    canvasLayout.hits((px, py) => found.find(([, x, y]) => near(CAM, px, py, x, y))?.[0]
        ?? (px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvas : null));
}

/** Mounts the data centre, and waits until its racks are drawn and laid out for a press. */
async function open() {
    const ui = await h.mount(ex.schematicDataCentre);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    hits(ui.container);
    fireEvent.pointerEnter(canvasOf(ui.container));
    return ui;
}

/** Lays main out at a width, and lets the cards that draw there answer a press. */
async function mainAt(container: HTMLElement, px: number) {
    await width(px);
    hits(container);
}

/** Which layout the Schematic is in: `narrow` below 480px of main, else `wide`. */
const layout = (container: HTMLElement) => container.querySelector("[data-schematic]")?.getAttribute("data-schematic-layout");

/** The tools the toolbar's strip holds, by their words. */
const tools = (container: HTMLElement) => [...slot(container, "toolbar").querySelectorAll("[data-schematic-seg='tools'] [role=radio]")].map((radio) => radio.textContent);

/** Picks a tool from the toolbar. */
async function tool(container: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name })); });
}

/** A pointer event on the canvas at a world point. */
function pointer(canvas: Element, type: "pointerDown" | "pointerMove" | "pointerUp", x: number, y: number, shiftKey = false) {
    fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerUp" ? 0 : 1, shiftKey, ...at(CAM, x, y) });
}

/** A drag on the canvas from one world point to another, let go there. */
async function drag(canvas: Element, from: readonly [number, number], to: readonly [number, number], shiftKey = false) {
    await act(async () => {
        pointer(canvas, "pointerDown", from[0], from[1], shiftKey);
        pointer(canvas, "pointerMove", to[0], to[1], shiftKey);
        pointer(canvas, "pointerUp", to[0], to[1], shiftKey);
    });
    await settle();
}

/** Presses one of the history's buttons, and lets what it sends settle. */
async function history(container: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name })); });
    await settle();
}

/** Clicks an element, as a pointer does, and lets the Schematic settle. */
async function click(el: Element): Promise<void> {
    await act(async () => { fireEvent.click(el); });
    await settle();
}

/** Reads what the data centre's host keeps of the selection: its State, read through East. */
const readKeptSelection = East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
    return kept.read();
}), getRegisteredPlatformImplementations());

/** What the data centre's host keeps of the selection, as East prints it. */
const keptSelection = () => printRefs(readKeptSelection());

/** A footer line, by its attribute; `undefined` while there is none. */
const footer = (container: HTMLElement, attribute: string) => slot(container, "footer").querySelector(`[${attribute}]`)?.textContent ?? undefined;

// ── The library ─────────────────────────────────────────────────────────────

/** The library pane, opened from its rail where it is collapsed. */
async function library(container: HTMLElement): Promise<HTMLElement> {
    const start = slot(container, "start");
    if (start.hasAttribute("data-collapsed")) await click(within(start).getByRole("button", { name: "Expand Library" }));
    return start;
}

/** Opens a tab of the library, by its name. */
async function libraryTab(container: HTMLElement, name: string) {
    const start = await library(container);
    const tab = [...start.querySelectorAll<HTMLElement>("[role='tab']")].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    await click(tab);
}

/** A card of the library's open tab, by its key. */
function libraryCard(container: HTMLElement, key: string): HTMLElement {
    const found = slot(container, "start").querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-library-item=${JSON.stringify(key)}]`);
    if (found === null) throw new Error(`no card ${key}`);
    return found;
}

/** The library's tabs, as their names and counts read. */
const libraryTabs = (container: HTMLElement) => [...slot(container, "start").querySelectorAll("[role='tab']")].map((t) => t.textContent);

// ── The inspector ───────────────────────────────────────────────────────────

/** The inspector's open tab's panel. */
const panel = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** What Details shows. */
const showing = (c: HTMLElement): string | null => panel(c).querySelector("[data-schematic-inspector]")?.getAttribute("data-schematic-inspector") ?? null;
/** Details' head: its kind, its name, where it stands and its chip. */
const head = (c: HTMLElement) => ({
    kind: panel(c).querySelector("[data-inspector-kind]")?.textContent ?? null,
    title: panel(c).querySelector("[data-inspector-title]")?.textContent ?? null,
    when: panel(c).querySelector("[data-inspector-when]")?.textContent ?? null,
    chip: panel(c).querySelector("[data-inspector-marks] > [data-state]")?.textContent ?? null,
});
/** A section of Details: `row`, `position`, `connect`, `ends`, `sides`. */
const section = (c: HTMLElement, name: string): HTMLElement | null => panel(c).querySelector<HTMLElement>(`[data-inspector-fields="${name}"]`);
/** A section's fields in order, each its key and its editor. */
const editors = (c: HTMLElement, name: string): string[] => [...section(c, name)!.querySelectorAll("[data-field]")]
    .map((el) => `${el.getAttribute("data-field")}:${el.getAttribute("data-editor")}`);
/** A field of a section, by its key. */
const field = (c: HTMLElement, name: string, key: string): HTMLElement => section(c, name)!.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
/** A gesture's button in Details. */
const action = (c: HTMLElement, name: string): HTMLButtonElement | null => panel(c).querySelector(`[data-inspector-action="${name}"]`);
/** What an item is joined to, as Details lists it, by the entities' ids. */
const joins = (c: HTMLElement): (string | null)[] => [...panel(c).querySelectorAll("[data-inspector-join]")].map((el) => el.getAttribute("data-inspector-join"));
/** A net's side, as its tags list it. */
const tags = (c: HTMLElement, key: string) => [...field(c, "sides", key).querySelectorAll("[data-scope=tags-input][data-part=item-text]")].map((el) => el.textContent);

/**
 * Picks a choice of a Chooser in Details, by its section, its field and its words.
 *
 * @returns Every choice it offered, by its words
 */
async function choose(c: HTMLElement, name: string, key: string, option: string): Promise<(string | null)[]> {
    const trigger = field(c, name, key).querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await act(async () => { fireEvent.click(trigger); });
    const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    const offered = within(listbox).getAllByRole("option").map((choice) => choice.textContent);
    await act(async () => { fireEvent.click(within(listbox).getByRole("option", { name: option })); });
    await settle();
    return offered;
}

/** Types a text field's new text and commits it with ⏎. */
async function retype(c: HTMLElement, name: string, key: string, text: string): Promise<void> {
    const user = userEvent.setup();
    const box = within(field(c, name, key)).getByRole("textbox");
    await user.clear(box);
    await user.type(box, `${text}{Enter}`);
    await settle();
}

// ============================================================================
// Nothing drags (SC25, D15)
// ============================================================================

test("below 480px of main nothing registers to drag — no card drags, the canvas is no drop cell, a selected run draws no handle and a press at its end re-targets nothing — and the tools hold no Move or Connect, the one held kept for a wider main (SC25, D15)", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    await library(container);
    // Wide: the cards drag, the canvas is the drops' one cell, every tool offered; Move held.
    expect(layout(container)).toBe("wide");
    expect(container.querySelector("[data-draggable]")).not.toBeNull();
    expect(canvas.hasAttribute("data-drag-cell")).toBe(true);
    expect(tools(container)).toEqual(["Select", "Zoom box", "Marquee", "Connect", "Move"]);
    await tool(container, "Move");
    expect(canvas.getAttribute("data-tool")).toBe("move");
    // u1, down from A01 to ODF-1's top, tapped on its path: selected, its handles drawn.
    await tap(canvas, CAM, 2.4, 6.0);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "fibre", key: "u1" }])));
    expect(canvas.getAttribute("data-link-handles")).toBe(entityId({ kind: "fibre", key: "u1" }));
    // Narrow: nothing to drag; the tools Select, Zoom box and Marquee, Move in force as Select; u1 still selected, no handle.
    await mainAt(container, 479);
    expect(layout(container)).toBe("narrow");
    expect(container.querySelector(DRAG)).toBeNull();
    expect(tools(container)).toEqual(["Select", "Zoom box", "Marquee"]);
    expect(canvas.getAttribute("data-tool")).toBe("select");
    expect(keptSelection()).toBe(printRefs([{ kind: "fibre", key: "u1" }]));
    expect(canvas.hasAttribute("data-link-handles")).toBe(false);
    // A press on its end at ODF-1's top, carried to MMR-1: a pan, the run's end where it was.
    await drag(canvas, [2.4, ODF1_TOP], [24.2, 2.9]);
    expect(container.querySelector("[data-schematic-refusal]")).toBeNull();
    expect(unsaved(container)).toBe(false);
    // Wide again: Move held still, the cards dragging again and the canvas the drops' cell, u1's handles drawn.
    await mainAt(container, 900);
    expect(layout(container)).toBe("wide");
    expect(canvas.getAttribute("data-tool")).toBe("move");
    expect(container.querySelector("[data-draggable]")).not.toBeNull();
    expect(canvas.hasAttribute("data-drag-cell")).toBe(true);
    expect(canvas.getAttribute("data-link-handles")).toBe(entityId({ kind: "fibre", key: "u1" }));
});

test("resizing across 480px of main keeps the selection and the drafts: A03's owner retyped, it stays selected and pending, narrow and wide again, and Save writes it", async () => {
    const { container } = await open();
    await tap(canvasOf(container), CAM, 9.6, 2.9);
    await retype(container, "row", "owner", "Harbour Labs");
    const standing = () => [card(container, "racks", "A03")?.hasAttribute("data-selected"), head(container).title, head(container).chip, unsaved(container)];
    expect(standing()).toEqual([true, "A03", "Pending", true]);
    await mainAt(container, 479);
    expect(standing()).toEqual([true, "A03", "Pending", true]);
    await mainAt(container, 900);
    expect(standing()).toEqual([true, "A03", "Pending", true]);
    const stored = await h.read(ex.schematicRacks);
    await history(container, SAVE);
    expect(rackEqual((await h.read(ex.schematicRacks)).get("A03")!, { ...stored.get("A03")!, owner: "Harbour Labs" })).toBe(true);
});

// ============================================================================
// Details' actions (SC25, D15)
// ============================================================================

test("below 480px of main an item's Connect to… records a run from it as a Connect drag does, one step Save writes, the Chooser clear again; the host's veto refuses a pair in the footer's words, recording nothing (SC25, D15)", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    // Wide, A05 selected: no Connect to… — the canvas connects.
    await tap(canvas, CAM, 16.8, 2.9);
    expect(head(container).title).toBe("A05");
    expect(section(container, "connect")).toBeNull();
    await mainAt(container, 479);
    // One link kind runs from a rack, the fibre run: the Chooser alone, over the items its end holds — not A05 itself.
    expect(head(container).title).toBe("A05");
    expect(editors(container, "connect")).toEqual(["to:reference"]);
    const offered = await choose(container, "connect", "to", "MMR-1 · Network frame");
    expect(offered).toContain("A04 · Rack");
    expect(offered).toContain("ODF-1 · Network frame");
    expect(offered).not.toContain("A05 · Rack");
    // One step: the run waits on Save, A05 joined to it, and the Chooser holds no item again.
    expect(unsaved(container)).toBe(true);
    expect(joins(container).filter((id) => id?.startsWith('(kind="fibre"'))).toHaveLength(1);
    expect(field(container, "connect", "to").querySelector("[data-scope=select][data-part=trigger]")!.textContent).not.toContain("MMR-1");
    const stored = await h.read(ex.schematicFibre);
    await history(container, SAVE);
    const saved = await h.read(ex.schematicFibre);
    const added = [...saved.keys()].filter((run) => !stored.has(run));
    expect(added).toHaveLength(1);
    // Its key minted new, its ends written, every other field its type's default — as a Connect drag writes it.
    expect(added[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(fibreEqual(saved.get(added[0]!)!, { ...defaultValue<typeof ex.DcFibre>(ex.DcFibre), from: variant("rack", "A05"), to: variant("frame", "MMR-1") })).toBe(true);
    // From ODF-1, a frame: a run to MMR-1 would join two frames — refused in the veto's words, nothing recorded.
    await tap(canvas, CAM, 8.4, 9.6);
    expect(head(container).title).toBe("ODF-1");
    await choose(container, "connect", "to", "MMR-1 · Network frame");
    expect(footer(container, "data-schematic-refused")).toBe("Two frames are joined by a cross-connect");
    expect(unsaved(container)).toBe(false);
});

test("below 480px of main the Backlog's card picked is an item with no position in Details, and its Place puts it at the canvas's centre, selected, its fields then Details'; a tap on the selected card places another the same (SC25, SC13)", async () => {
    const { container } = await open();
    await mainAt(container, 479);
    await libraryTab(container, "Backlog");
    const a06 = entityId({ kind: "racks", key: "A06" }), a07 = entityId({ kind: "racks", key: "A07" });
    expect(libraryCard(container, a06).hasAttribute("data-draggable")).toBe(false);
    // A06 picked: Details shows it, with no position, and its Place.
    await click(libraryCard(container, a06));
    expect(showing(container)).toBe("unplaced");
    expect(head(container)).toEqual({ kind: "Rack", title: "A06", when: "Not placed", chip: null });
    await click(action(container, "place")!);
    // At the canvas's centre, selected: Details shows the rack, its fields its own to edit; the Backlog one fewer.
    await waitFor(() => expect(showing(container)).toBe("item"));
    expect(head(container).title).toBe("A06");
    expect(editors(container, "row")).toEqual(["model:text", "hall:text", "owner:text"]);
    expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A06" }]));
    expect(libraryTabs(container)[1]).toBe("Backlog 1");
    // A07 picked — Details shows it, the canvas letting go of A06 — and tapped again: its ⏎, placed the same.
    await click(libraryCard(container, a07));
    expect([showing(container), head(container).title, keptSelection()]).toEqual(["unplaced", "A07", printRefs([])]);
    await click(libraryCard(container, a07));
    await waitFor(() => expect(head(container).title).toBe("A07"));
    expect(showing(container)).toBe("item");
    expect(libraryTabs(container)[1]).toBe("Backlog 0");
    const stored = await h.read(ex.schematicRacks);
    await history(container, SAVE);
    // The view's centre: the fitted floor's middle, 14 × 7 m.
    const saved = await h.read(ex.schematicRacks);
    for (const key of ["A06", "A07"]) expect(rackEqual(saved.get(key)!, { ...stored.get(key)!, x: some(14.0), y: some(7.0) }), key).toBe(true);
});

// ============================================================================
// The veto over Details' ends and sides (#1394)
// ============================================================================

test("a run's ends and a trunk's sides are held to the host's veto as their gestures are: refused, the footer says why, the Chooser and the tags as they stood, and nothing recorded", async () => {
    const { container } = await open();
    const canvas = canvasOf(container);
    // u3, A03 → ODF-1, tapped on its line: its start moved onto MMR-1 would join two frames — refused.
    await tap(canvas, CAM, 9.6, 6.0);
    expect(showing(container)).toBe("link");
    await choose(container, "ends", "from", "MMR-1 · Network frame");
    expect(footer(container, "data-schematic-refused")).toBe("Two frames are joined by a cross-connect");
    expect(head(container).title).toBe("A03 → ODF-1");
    expect(unsaved(container)).toBe(false);
    // A trunk of A05 and A04 into ODF-1, grown as a Shift session grows one.
    await tool(container, "Connect");
    await drag(canvas, [16.8, 2.9], [8.4, 9.6]);
    await drag(canvas, [13.2, 2.9], [8.4, 9.6], true);
    await tool(container, "Select");
    await tap(canvas, CAM, 16.8, 2.9);
    const trunk = joins(container).find((id) => id?.startsWith('(kind="trunks"'));
    expect(trunk).toBeDefined();
    await click(panel(container).querySelector(`[data-inspector-join=${JSON.stringify(trunk)}]`)!);
    expect(showing(container)).toBe("net");
    expect([tags(container, "sources"), tags(container, "destinations")]).toEqual([["A05", "A04"], ["ODF-1"]]);
    // CORE-1 added to its frames: a trunk never lands on the core — refused, its frames as they stood.
    const user = userEvent.setup();
    const input = field(container, "sides", "destinations").querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
    await user.click(input);
    await user.type(input, "CORE-1{Enter}");
    await settle();
    expect(footer(container, "data-schematic-refused")).toBe("A trunk lands on a fibre frame, never the core");
    expect(tags(container, "destinations")).toEqual(["ODF-1"]);
    // MMR-1 added instead: taken, one step; Save writes the trunk with it.
    await user.click(field(container, "sides", "destinations").querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!);
    await user.type(field(container, "sides", "destinations").querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!, "MMR-1{Enter}");
    await settle();
    expect(footer(container, "data-schematic-refused")).toBeUndefined();
    expect(tags(container, "destinations")).toEqual(["ODF-1", "MMR-1"]);
    await history(container, SAVE);
    const trunks = [...(await h.read(ex.schematicTrunks)).values()];
    expect(trunks).toHaveLength(1);
    expect(trunkEqual(trunks[0]!, { ...defaultValue<typeof ex.DcTrunk>(ex.DcTrunk), racks: ["A05", "A04"], frames: ["ODF-1", "MMR-1"] })).toBe(true);
});
