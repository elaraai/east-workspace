/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic's editing on e3 itself (#1388, `Schematic Builder Spec.md`
 * §7): each gesture one step of one history over a session per record, Save
 * writing each record through its patch door. Move moves the selection
 * rigidly, clamped to the extent, Esc or a lost pointer putting it back (SC8),
 * and writes each rack's centre alone (SC2); Connect records a run under a key
 * minted new, and a draft whose end no field holds goes danger in its words
 * (SC7, SC9); a Shift session grows into a trunk, absorbing the run it grew
 * from, as one step Undo takes back (SC9); Retarget writes the end it moves,
 * though a tap on that end selects the item there, Extend adds a destination,
 * Del on a leg removes its rack and on a net deletes it (SC10); Del on racks deletes them with every run and feed leg
 * naming one (SC5, D7); Save sends each record's changes as its own request,
 * one refused keeping its drafts while the others commit (SC6); a drawing
 * bound read only takes no gesture (SC14); and a draft the rail narrows out
 * stays in its session and saves, showing again where its draft has it when
 * the rail lets it back (SC23).
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import {
    ArrayType, East, StringType, decodeBeast2For, defaultValue, encodeBeast2For, equalFor, none, printFor, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { at, card, drawingCounts, fitted, layOutCanvas, tap, unsaved } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The camera the canvas fits the data centre's 28 × 14 m drawing with. */
const CAM = fitted(28, 14);

const rackEqual = equalFor(ex.DcRack);
const fibreEqual = equalFor(ex.DcFibre);
const printText = printFor(StringType);
const printRefs = printFor(ArrayType(Schematic.Types.Ref));

/**
 * Where each card the tests press sits — by kind, key and centre in metres — and its box, as the canvas reckons it with no
 * page to lay it out (`tierSize`): its own width, a rack 60px tall (its model, its load's meter and figure), a frame 37px
 * (its kind) — the box a run's end meets it at (#1403). The power distribution units, whose 1.2 m holds no card's words at
 * Fit, draw as their pins, which the canvas hits itself (#1393).
 */
const CARDS: readonly (readonly [kind: string, key: string, x: number, y: number, w: number, h: number])[] = [
    ["racks", "A01", 2.4, 2.9, 3.2, 60], ["racks", "A02", 6.0, 2.9, 3.2, 60], ["racks", "A03", 9.6, 2.9, 3.2, 60], ["racks", "A04", 13.2, 2.9, 3.2, 60],
    ["racks", "A05", 16.8, 2.9, 3.2, 60], ["network", "MMR-1", 24.2, 2.9, 4.0, 37], ["network", "ODF-1", 8.4, 9.6, 12.8, 37],
    ["network", "CORE-1", 23.2, 9.7, 4.0, 37],
];

/** ODF-1's top edge, in metres: where u1, down from A01, meets it — its handle there once it is selected (#1403). */
const ODF1_TOP = 9.6 - 37 / 2 / CAM.ppu;

/** Lets each card answer anywhere in its box, as a page would hit it: where a drag presses and lets go. */
function hits(container: HTMLElement) {
    const found = CARDS.flatMap(([kind, key, x, y, w, h]) => {
        const el = card(container, kind, key);
        if (el === null) return [];
        const { clientX, clientY } = at(CAM, x, y);
        return [[el, clientX, clientY, (w * CAM.ppu) / 2, h / 2] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y, hw, hh]) => Math.abs(px - x) <= hw && Math.abs(py - y) <= hh)?.[0] ?? null);
}

/** The canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** Mounts an example, and waits until its racks are drawn and laid out for a press. */
async function open(example: { fn: { toIR(): unknown } }) {
    const ui = await h.mount(example);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A01")).not.toBeNull());
    hits(ui.container);
    fireEvent.pointerEnter(canvasOf(ui.container));
    return ui;
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

/** Picks a tool from the toolbar. */
async function tool(container: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("radio", { name })); });
}

/** Presses one of the history's buttons, and lets what it sends settle. */
async function history(container: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(within(slot(container, "toolbar")).getByRole("button", { name })); });
    await settle();
}

/** A key pressed on the canvas — ⌘Z and the rest — and what it records settled. */
async function key(container: HTMLElement, init: { key: string; metaKey?: boolean; shiftKey?: boolean }) {
    await act(async () => { fireEvent.keyDown(canvasOf(container), init); });
    await settle();
}

/**
 * Shows the drawing in the inspector's Details, its counts with it: the Select tool held, which ends a Connect's
 * session, and Esc, which clears the selection.
 */
async function seeDrawing(container: HTMLElement) {
    await tool(container, "Select");
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    await settle();
}

/** Del, with the pointer over the canvas. */
async function del() {
    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });
    await settle();
}

/** A rack's row as Save leaves it: its centre near a point, and every other field as it was (SC2). */
function movedTo(saved: ValueTypeOf<typeof ex.DcRack> | undefined, stored: ValueTypeOf<typeof ex.DcRack>, x: number, y: number) {
    expect(saved).toBeDefined();
    if (saved!.x.type !== "some" || saved!.y.type !== "some") throw new Error("the rack is unplaced");
    expect(saved!.x.value).toBeCloseTo(x, 9);
    expect(saved!.y.value).toBeCloseTo(y, 9);
    expect(rackEqual(saved!, { ...stored, x: saved!.x, y: saved!.y })).toBe(true);
}

/** The mutations a test's Saves sent, by the record each wrote. */
const mutated = () => h.requests("mutate").map((request) => request.record);

/** Reads what the data centre's host keeps of the selection: its State, read through East. */
const readKeptSelection = East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
    return kept.read();
}), getRegisteredPlatformImplementations());

/** What the data centre's host keeps of the selection, as East prints it. */
const keptSelection = () => printRefs(readKeptSelection());

// ── Move (SC8, SC2) ─────────────────────────────────────────────────────────

test("Move moves the selection rigidly, clamped to the extent, as one step on release; Esc or a lost pointer puts it back; Save writes each rack's centre alone (SC8, SC2)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    // A01, and A02 beside it: a tap selects, Shift extends.
    await tap(canvas, CAM, 2.4, 2.9);
    await act(async () => { pointer(canvas, "pointerDown", 6.0, 2.9, true); pointer(canvas, "pointerUp", 6.0, 2.9, true); });
    await tool(container, "Move");
    const stored = await h.read(ex.schematicRacks);
    // Five metres left of A01: it stops at the floor's edge, and A02 keeps its 3.6 m from it.
    await drag(canvas, [2.4, 2.9], [-2.6, 2.9]);
    expect(unsaved(container)).toBe(true);
    // Esc mid-drag: A04 goes back where it was, and nothing is recorded.
    const a04 = card(container, "racks", "A04")!.style.transform;
    await act(async () => { pointer(canvas, "pointerDown", 13.2, 2.9); pointer(canvas, "pointerMove", 13.2, 6.0); });
    expect(card(container, "racks", "A04")!.style.transform).not.toBe(a04);
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(card(container, "racks", "A04")!.style.transform).toBe(a04);
    await act(async () => { pointer(canvas, "pointerUp", 13.2, 6.0); });
    // A lost pointer: A05 goes back too.
    const a05 = card(container, "racks", "A05")!.style.transform;
    await act(async () => { pointer(canvas, "pointerDown", 16.8, 2.9); pointer(canvas, "pointerMove", 16.8, 6.0); });
    expect(card(container, "racks", "A05")!.style.transform).not.toBe(a05);
    await act(async () => { fireEvent.pointerCancel(canvas, { pointerId: 1, pointerType: "mouse" }); });
    expect(card(container, "racks", "A05")!.style.transform).toBe(a05);
    // Save: one request, the racks', each moved rack's centre written and every other field of it as it was — A04 and
    // A05, put back, among the racks it leaves as they were.
    await history(container, editingMessages.apply());
    expect(mutated()).toEqual(["schematic_racks"]);
    const saved = await h.read(ex.schematicRacks);
    movedTo(saved.get("A01"), stored.get("A01")!, 0, 2.9);
    movedTo(saved.get("A02"), stored.get("A02")!, 3.6, 2.9);
    for (const untouched of ["A03", "A04", "A05", "A06", "A07"]) expect(rackEqual(saved.get(untouched)!, stored.get(untouched)!)).toBe(true);
    expect(unsaved(container)).toBe(false);
});

test("a Move over a rack another session changed rewrites the rack as the record now holds it: the other session's fields stand (SC2)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    // Another session hands A03 to a new owner.
    const racks = await h.read(ex.schematicRacks);
    await h.patch(ex.schematicRacks, new Map([...racks, ["A03", { ...racks.get("A03")!, owner: "Harbour Labs" }]]));
    await tool(container, "Move");
    await drag(canvasOf(container), [9.6, 2.9], [9.6, 5.0]);
    await history(container, editingMessages.apply());
    const saved = await h.read(ex.schematicRacks);
    movedTo(saved.get("A03"), { ...racks.get("A03")!, owner: "Harbour Labs" }, 9.6, 5.0);
});

// ── Connect and its Shift session (SC9, SC7) ────────────────────────────────

test("Connect records a fibre run under a key minted new; an end its field holds no item of refuses the draft in its words (SC9, SC7)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await tool(container, "Connect");
    // A rack to a power distribution unit, drawn as its pin: a fibre run ends at none — the draft goes danger, saying why
    // under PDU-B, and letting go records nothing.
    await act(async () => { pointer(canvas, "pointerDown", 16.8, 2.9); pointer(canvas, "pointerMove", 18.6, 4.2); });
    expect(canvas.hasAttribute("data-forbidden")).toBe(true);
    expect(container.querySelector("[data-schematic-refusal] [data-drag-caption][data-refused]")?.textContent).toBe("Fibre run can't end at PDU-B");
    await act(async () => { pointer(canvas, "pointerUp", 18.6, 4.2); });
    expect(container.querySelector("[data-schematic-refusal]")).toBeNull();
    expect(unsaved(container)).toBe(false);
    // A rack to the meet-me room's frame: a run, recorded and drawn.
    await drag(canvas, [16.8, 2.9], [24.2, 2.9]);
    expect(unsaved(container)).toBe(true);
    await seeDrawing(container);
    expect(drawingCounts(container).links).toBe("7");
    const stored = await h.read(ex.schematicFibre);
    await history(container, editingMessages.apply());
    const saved = await h.read(ex.schematicFibre);
    const added = [...saved.keys()].filter((run) => !stored.has(run));
    expect(added).toHaveLength(1);
    // Its key is minted new (`crypto.randomUUID()`), its ends written, every other field its type's default.
    expect(added[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(fibreEqual(saved.get(added[0]!)!, {
        ...defaultValue<typeof ex.DcFibre>(ex.DcFibre), from: variant("rack", "A05"), to: variant("frame", "MMR-1"),
    })).toBe(true);
});

test("a Shift-drag grows the session into a fibre trunk, absorbing the run it grew from, one step Undo takes back (SC9)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    // The links and the nets drawn, as the drawing's Details counts them: read once the session is over, nothing selected.
    const count = async () => {
        await seeDrawing(container);
        const { links, nets } = drawingCounts(container);
        return [links, nets];
    };
    await tool(container, "Connect");
    await drag(canvas, [16.8, 2.9], [24.2, 2.9]);
    // A04 to the same frame, Shift held: two racks gathered into one frame — a trunk, the run gone into it.
    await drag(canvas, [13.2, 2.9], [24.2, 2.9], true);
    expect(await count()).toEqual(["6", "3"]);
    // One step: Undo puts the run back, the trunk gone; Redo grows it again.
    await key(container, { key: "z", metaKey: true });
    expect(await count()).toEqual(["7", "2"]);
    await key(container, { key: "z", metaKey: true, shiftKey: true });
    expect(await count()).toEqual(["6", "3"]);
    const runs = await h.read(ex.schematicFibre);
    await history(container, editingMessages.apply());
    // Save sends the trunk alone: the run it absorbed was never saved.
    expect(mutated()).toEqual(["schematic_trunks"]);
    const trunks = [...(await h.read(ex.schematicTrunks)).values()];
    expect(trunks).toHaveLength(1);
    expect(equalFor(ex.DcTrunk)(trunks[0]!, { ...defaultValue<typeof ex.DcTrunk>(ex.DcTrunk), racks: ["A05", "A04"], frames: ["MMR-1"] })).toBe(true);
    expect(equalFor(ex.schematicFibre.type)(await h.read(ex.schematicFibre), runs)).toBe(true);
});

/** The words a refused draft shows under the item it would end at; `undefined` while none is refused. */
const refusedCaption = (container: HTMLElement) => container.querySelector("[data-schematic-refusal] [data-drag-caption][data-refused]")?.textContent ?? undefined;

/** A drag's press and its move onto a world point, Shift held, its release still to come: what its draft shows there. */
async function dragOnto(canvas: Element, from: readonly [number, number], to: readonly [number, number]) {
    await act(async () => { pointer(canvas, "pointerDown", from[0], from[1], true); pointer(canvas, "pointerMove", to[0], to[1], true); });
}

test("a Shift-drag gathering a run into a trunk is held to the host's veto in every leg it would leave: the run onto the core refuses it in the veto's words, nothing recorded (SC9, D34)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await tool(container, "Connect");
    // A03 to the core: a plain run, which the veto allows.
    await drag(canvas, [9.6, 2.9], [23.2, 9.7]);
    expect(unsaved(container)).toBe(true);
    // Shift-dragged on from A03 to the fibre frame: the trunk the session would grow into lands on the core too — the
    // draft goes danger in the veto's words, though A03 → ODF-1 alone would land.
    await dragOnto(canvas, [9.6, 2.9], [8.4, 9.6]);
    expect(canvas.hasAttribute("data-forbidden")).toBe(true);
    expect(refusedCaption(container)).toBe("A trunk lands on a fibre frame, never the core");
    await act(async () => { pointer(canvas, "pointerUp", 8.4, 9.6, true); });
    await settle();
    expect(refusedCaption(container)).toBeUndefined();
    // Nothing recorded: the run alone waits on Save, and no trunk.
    await seeDrawing(container);
    expect([drawingCounts(container).links, drawingCounts(container).nets]).toEqual(["7", "2"]);
    await history(container, editingMessages.apply());
    expect(mutated()).toEqual(["schematic_fibre"]);
    expect((await h.read(ex.schematicTrunks)).size).toBe(0);
});

test("a Shift-drag growing an open trunk is held to the veto in each pair it newly joins: from a frame the trunk holds to another, each of its racks joins it — never asked as two frames (SC9, D34)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await tool(container, "Connect");
    await drag(canvas, [16.8, 2.9], [24.2, 2.9]);
    await drag(canvas, [13.2, 2.9], [24.2, 2.9], true);
    // From MMR-1, which the trunk holds, Shift-dragged to the fibre frame: A05 and A04 land on it too, as the veto allows.
    await dragOnto(canvas, [24.2, 2.9], [8.4, 9.6]);
    expect(refusedCaption(container)).toBeUndefined();
    await act(async () => { pointer(canvas, "pointerUp", 8.4, 9.6, true); });
    await settle();
    // Onto the core: each of its racks would land there — refused, nothing recorded.
    await dragOnto(canvas, [24.2, 2.9], [23.2, 9.7]);
    expect(refusedCaption(container)).toBe("A trunk lands on a fibre frame, never the core");
    await act(async () => { pointer(canvas, "pointerUp", 23.2, 9.7, true); });
    await settle();
    await history(container, editingMessages.apply());
    const trunks = [...(await h.read(ex.schematicTrunks)).values()];
    expect(trunks).toHaveLength(1);
    expect(equalFor(ex.DcTrunk)(trunks[0]!, { ...defaultValue<typeof ex.DcTrunk>(ex.DcTrunk), racks: ["A05", "A04"], frames: ["MMR-1", "ODF-1"] })).toBe(true);
});

test("an Extend of a selected trunk is held to the veto in each pair it newly joins: dragged from a frame it holds to the fibre frame, it joins its racks to it; onto the core, refused (SC10, D34)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await tool(container, "Connect");
    await drag(canvas, [16.8, 2.9], [24.2, 2.9]);
    await drag(canvas, [13.2, 2.9], [24.2, 2.9], true);
    // The session over, the trunk selected from what A05 is joined to, in Details.
    await tool(container, "Select");
    await tap(canvas, CAM, 16.8, 2.9);
    const join = slot(container, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden]) [data-inspector-join^='(kind=\"trunks\"']")!;
    await act(async () => { fireEvent.click(join); });
    await settle();
    await waitFor(() => expect(keptSelection()).toMatch(/^\[\(kind="trunks", key="/u));
    // Shift-dragged from MMR-1, a member, to the fibre frame: an Extend, its racks landing on it.
    await tool(container, "Connect");
    await dragOnto(canvas, [24.2, 2.9], [8.4, 9.6]);
    expect(refusedCaption(container)).toBeUndefined();
    await act(async () => { pointer(canvas, "pointerUp", 8.4, 9.6, true); });
    await settle();
    // From A05 onto the core: refused in the veto's words.
    await dragOnto(canvas, [16.8, 2.9], [23.2, 9.7]);
    expect(refusedCaption(container)).toBe("A trunk lands on a fibre frame, never the core");
    await act(async () => { pointer(canvas, "pointerUp", 23.2, 9.7, true); });
    await settle();
    await history(container, editingMessages.apply());
    const trunks = [...(await h.read(ex.schematicTrunks)).values()];
    expect(trunks).toHaveLength(1);
    expect(equalFor(ex.DcTrunk)(trunks[0]!, { ...defaultValue<typeof ex.DcTrunk>(ex.DcTrunk), racks: ["A05", "A04"], frames: ["MMR-1", "ODF-1"] })).toBe(true);
});

// ── Retarget, Extend, and Del on a leg and on a net (SC10) ──────────────────

test("Retarget writes the end of the run it moves, and every other field of it stands; an end no field holds goes danger first (SC10)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    // u1 runs down from A01's foot to ODF-1's top (#1403): a tap on its path selects it.
    await tap(canvas, CAM, 2.4, 6.0);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "fibre", key: "u1" }])));
    // Its end on ODF-1's top edge is a handle: pressed, the run's end follows the pointer — over PDU-A, refused; on to MMR-1, let go.
    await act(async () => { pointer(canvas, "pointerDown", 2.4, ODF1_TOP); pointer(canvas, "pointerMove", 1.6, 4.2); });
    expect(container.querySelector("[data-schematic-refusal]")?.textContent).toBe("Fibre run can't end at PDU-A");
    await act(async () => { pointer(canvas, "pointerMove", 24.2, 2.9); pointer(canvas, "pointerUp", 24.2, 2.9); });
    await settle();
    expect(unsaved(container)).toBe(true);
    const stored = await h.read(ex.schematicFibre);
    await history(container, editingMessages.apply());
    expect(fibreEqual((await h.read(ex.schematicFibre)).get("u1")!, { ...stored.get("u1")!, to: variant("frame", "MMR-1") })).toBe(true);
});

test("a tap on a selected run's end selects the item there and records nothing: only a press that moves retargets it (SC10)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await tap(canvas, CAM, 2.4, 6.0);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "fibre", key: "u1" }])));
    // u1's end on ODF-1's top edge is a handle, and ODF-1 is under it: let go where it was pressed, the press is a tap.
    await tap(canvas, CAM, 2.4, ODF1_TOP + 1 / CAM.ppu);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "network", key: "ODF-1" }])));
    expect(unsaved(container)).toBe(false);
});

test("Extend adds a rack to a selected feed; Del on a leg takes its rack off the feed, and on a feed deletes it (SC10)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    const kept = keptSelection;
    // Feed A's bar runs under A01 to A03: a tap on it selects the feed.
    await tap(canvas, CAM, 4.2, 3.8);
    await waitFor(() => expect(kept()).toBe(printRefs([{ kind: "feeds", key: "feed-a" }])));
    // Shift-drag from one of its racks to A04: A04 joins its fed side.
    await tool(container, "Connect");
    await drag(canvas, [6.0, 2.9], [13.2, 2.9], true);
    expect(unsaved(container)).toBe(true);
    // Feed B's leg to A05, tapped where it shows — between the bar, 3.8 m down, and A05's card, its head (#1403): Del takes
    // A05 off it.
    await tool(container, "Select");
    await tap(canvas, CAM, 16.8, 3.775);
    await waitFor(() => expect(kept()).toBe(printRefs([{ kind: "feeds", key: "feed-b" }])));
    await del();
    expect(unsaved(container)).toBe(true);
    // Feed A, tapped on its bar: Del deletes it.
    await tap(canvas, CAM, 4.2, 3.8);
    await waitFor(() => expect(kept()).toBe(printRefs([{ kind: "feeds", key: "feed-a" }])));
    await del();
    await seeDrawing(container);
    expect(drawingCounts(container).nets).toBe("1");
    await history(container, editingMessages.apply());
    const feeds = await h.read(ex.schematicFeeds);
    expect([...feeds.keys()]).toEqual(["feed-b"]);
    expect(feeds.get("feed-b")!.racks).toEqual(["A04"]);
});

// ── Del on racks (SC5, D7) and Save per record (SC6) ────────────────────────

test("Del on a rack deletes it with every run and feed leg naming it, one step Undo restores; Save sends each record as its own request (SC5, SC6)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await tap(canvas, CAM, 2.4, 2.9);
    await del();
    // A01 goes, with u1, its run to ODF-1, and its leg of feed A: three records' rows, one step.
    expect(card(container, "racks", "A01")).toBeNull();
    await seeDrawing(container);
    expect(drawingCounts(container).links).toBe("5");
    await key(container, { key: "z", metaKey: true });
    expect(card(container, "racks", "A01")).not.toBeNull();
    // Undone whole: the run is back, and nothing waits on Save.
    await seeDrawing(container);
    expect(drawingCounts(container).links).toBe("6");
    expect(unsaved(container)).toBe(false);
    await key(container, { key: "z", metaKey: true, shiftKey: true });
    expect(card(container, "racks", "A01")).toBeNull();
    await history(container, editingMessages.apply());
    // Each record's changes in a request of its own.
    expect([...mutated()].sort()).toEqual(["schematic_feeds", "schematic_fibre", "schematic_racks"]);
    expect((await h.read(ex.schematicRacks)).has("A01")).toBe(false);
    expect((await h.read(ex.schematicFibre)).has("u1")).toBe(false);
    expect((await h.read(ex.schematicFeeds)).get("feed-a")!.racks).toEqual(["A02", "A03"]);
});

/** The floor's racks beside fibre runs whose patch door refuses every change, with the inspector: what a Save over both is answered. */
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

test("a record whose door refuses its Save keeps its drafts, in a banner saying why, and the others' commits stand (SC6)", async () => {
    const { container } = await open(frozenFloor);
    const canvas = canvasOf(container);
    const stored = { racks: await h.read(ex.schematicRacks), runs: await h.read(ex.schematicFrozenFibre) };
    await tool(container, "Move");
    await drag(canvas, [9.6, 2.9], [9.6, 5.0]);
    await tool(container, "Connect");
    await drag(canvas, [16.8, 2.9], [24.2, 2.9]);
    expect(unsaved(container)).toBe(true);
    await history(container, editingMessages.apply());
    // The racks committed; the runs refused, their draft kept, the banner naming why.
    movedTo((await h.read(ex.schematicRacks)).get("A03"), stored.racks.get("A03")!, 9.6, 5.0);
    expect(equalFor(ex.schematicFrozenFibre.type)(await h.read(ex.schematicFrozenFibre), stored.runs)).toBe(true);
    const refused = slot(container, "banners").querySelector('[data-session-banner="rejected"]')?.textContent;
    expect(refused).toContain("Fibre run");
    expect(refused).toContain("the fibre runs are frozen");
    // The run's draft waits on Save still, drawn.
    expect(unsaved(container)).toBe(true);
    await seeDrawing(container);
    expect(drawingCounts(container).links).toBe("7");
});

// ── Read only (SC14) ────────────────────────────────────────────────────────

/** The data centre's racks, bound with their patch door, in a Schematic read only. */
const readOnlyRacks = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    return Schematic({
        id: "readOnly",
        readOnly: true,
        extent: { width: 28, height: 14 },
        items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }) },
    });
}))) };

test("a drawing bound read only — or a Schematic read only — takes no gesture: no history, no Move or Connect, and Del deletes nothing (SC14)", async () => {
    for (const example of [ex.schematicFloor, readOnlyRacks]) {
        const { container, unmount } = await open(example);
        const tools = [...slot(container, "toolbar").querySelectorAll("[data-schematic-seg='tools'] [role=radio]")].map((radio) => radio.textContent);
        expect(tools).toEqual(["Select", "Zoom box", "Marquee"]);
        expect(slot(container, "toolbar").querySelector("[data-toolbar-item='history']")).toBeNull();
        await tap(canvasOf(container), CAM, 2.4, 2.9);
        await waitFor(() => expect(card(container, "racks", "A01")!.hasAttribute("data-selected")).toBe(true));
        await del();
        expect(card(container, "racks", "A01")).not.toBeNull();
        expect(mutated()).toEqual([]);
        unmount();
    }
});

// ── Drafts the rail hides (SC23) ────────────────────────────────────────────

/** The data centre's racks read through their source of the rail, a narrowed-out rack hidden — as it is by default (§10.3). */
const narrowedRacks = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const rackEntries = $.let(Data.bindPaged(ex.schematicRacks));
    const slice = $.let(Slice.bindRecords("schematic.editing.narrowed", {
        racks: { source: Data.bindPaged(ex.schematicRacks, { indexes: [ex.schematicRacksByOwner] }), fields: { owner: { label: "Owner" } } },
    }));
    return Schematic({
        id: "narrowed",
        extent: { width: 28, height: 14 },
        slice: { slice },
        items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", entries: rackEntries }) },
    });
}))) };

/** Its racks' narrowing, as the rail keeps it. */
const RACKS_SLICE = "schematic.editing.narrowed.racks";
type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];

/** Writes the racks' narrowing, as the rail does. */
async function narrow(where: Where) {
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(RACKS_SLICE)!);
    await act(async () => { store.write(RACKS_SLICE, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

test("a draft the rail narrows out waits in its session and Save sends it; let back in, it shows where its draft has it (SC23)", async () => {
    const { container } = await open(narrowedRacks);
    const stored = await h.read(ex.schematicRacks);
    await tool(container, "Move");
    // A03, Northwind Media's, moved down into the clear floor below its row, where its card draws whole.
    await drag(canvasOf(container), [9.6, 2.9], [9.6, 5.0]);
    const moved = card(container, "racks", "A03")!.style.transform;
    // The rail narrows to Harbour Labs' racks: A03 isn't drawn, and its draft waits.
    const harbour: Where = new Map([["owner", variant("values", [printText("Harbour Labs")])]]);
    await narrow(harbour);
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    expect(card(container, "racks", "A01")).not.toBeNull();
    expect(unsaved(container)).toBe(true);
    // Let back in, it shows where its draft has it.
    await narrow(new Map());
    await waitFor(() => expect(card(container, "racks", "A03")?.style.transform).toBe(moved));
    // Narrowed out again, Save sends it all the same.
    await narrow(harbour);
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    await history(container, editingMessages.apply());
    movedTo((await h.read(ex.schematicRacks)).get("A03"), stored.get("A03")!, 9.6, 5.0);
    expect(unsaved(container)).toBe(false);
});

