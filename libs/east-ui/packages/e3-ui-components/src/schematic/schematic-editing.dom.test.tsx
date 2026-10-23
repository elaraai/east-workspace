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
 * Extend adds a destination, Del on a leg removes its rack and on a net
 * deletes it (SC10); Del on racks deletes them with every run and feed leg
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
import { at, card, layOutCanvas, tap } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The data centre's px a metre: its 28 × 14 m drawing fitted to the canvas's 1080 × 540 px. */
const PPU = 1080 / 28;

const rackEqual = equalFor(ex.DcRack);
const fibreEqual = equalFor(ex.DcFibre);
const printText = printFor(StringType);
const printRefs = printFor(ArrayType(Schematic.Types.Ref));

/** Where each card the tests press sits, by kind, key and centre in metres. */
const CENTRES: readonly (readonly [kind: string, key: string, x: number, y: number])[] = [
    ["racks", "A01", 2.4, 2.9], ["racks", "A02", 6.0, 2.9], ["racks", "A03", 9.6, 2.9], ["racks", "A04", 13.2, 2.9], ["racks", "A05", 16.8, 2.9],
    ["network", "MMR-1", 24.2, 2.9], ["network", "ODF-1", 8.4, 9.6], ["pdus", "PDU-A", 1.6, 4.2], ["pdus", "PDU-B", 18.6, 4.2],
];

/** Lets each card answer at its centre, as a page would hit it: where a drag presses and lets go. */
function hits(container: HTMLElement) {
    const found = CENTRES.flatMap(([kind, key, x, y]) => {
        const el = card(container, kind, key);
        return el === null ? [] : [[el, x, y] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y]) => Math.hypot(px - x * PPU, py - y * PPU) < 4)?.[0] ?? null);
}

/** The canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** A footer line, by its attribute; `undefined` while there is none. */
const footer = (container: HTMLElement, attribute: string) => slot(container, "footer").querySelector(`[${attribute}]`)?.textContent ?? undefined;

/** The changes waiting on Save, as the footer says them. */
const pending = (container: HTMLElement) => footer(container, "data-schematic-pending");

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
    fireEvent[type](canvas, { pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerUp" ? 0 : 1, shiftKey, ...at(PPU, x, y) });
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
    await tap(canvas, PPU, 2.4, 2.9);
    await act(async () => { pointer(canvas, "pointerDown", 6.0, 2.9, true); pointer(canvas, "pointerUp", 6.0, 2.9, true); });
    await tool(container, "Move");
    const stored = await h.read(ex.schematicRacks);
    // Five metres left of A01: it stops at the floor's edge, and A02 keeps its 3.6 m from it.
    await drag(canvas, [2.4, 2.9], [-2.6, 2.9]);
    expect(pending(container)).toBe("2 pending");
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
    expect(pending(container)).toBe("2 pending");
    // Save: one request, the racks', each moved rack's centre written and every other field of it as it was.
    await history(container, editingMessages.apply());
    expect(mutated()).toEqual(["schematic_racks"]);
    const saved = await h.read(ex.schematicRacks);
    movedTo(saved.get("A01"), stored.get("A01")!, 0, 2.9);
    movedTo(saved.get("A02"), stored.get("A02")!, 3.6, 2.9);
    for (const untouched of ["A03", "A04", "A05", "A06", "A07"]) expect(rackEqual(saved.get(untouched)!, stored.get(untouched)!)).toBe(true);
    expect(pending(container)).toBeUndefined();
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
    // A rack to a power distribution unit: a fibre run ends at none — the target rings danger, the draft says why, and letting go records nothing.
    await act(async () => { pointer(canvas, "pointerDown", 16.8, 2.9); pointer(canvas, "pointerMove", 18.6, 4.2); });
    expect(card(container, "pdus", "PDU-B")!.hasAttribute("data-forbidden")).toBe(true);
    expect(container.querySelector("[data-schematic-refusal] [data-drag-caption][data-refused]")?.textContent).toBe("Fibre run can't end at PDU-B");
    await act(async () => { pointer(canvas, "pointerUp", 18.6, 4.2); });
    expect(container.querySelector("[data-schematic-refusal]")).toBeNull();
    expect(pending(container)).toBeUndefined();
    // A rack to the meet-me room's frame: a run, recorded.
    await drag(canvas, [16.8, 2.9], [24.2, 2.9]);
    expect(footer(container, 'data-schematic-count="links"')).toBe("7 links");
    expect(pending(container)).toBe("1 pending");
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
    const count = (sort: string) => footer(container, `data-schematic-count="${sort}"`);
    await tool(container, "Connect");
    await drag(canvas, [16.8, 2.9], [24.2, 2.9]);
    expect([count("links"), count("nets")]).toEqual(["7 links", "2 nets"]);
    // A04 to the same frame, Shift held: two racks gathered into one frame — a trunk, the run gone into it.
    await drag(canvas, [13.2, 2.9], [24.2, 2.9], true);
    expect([count("links"), count("nets")]).toEqual(["6 links", "3 nets"]);
    expect(pending(container)).toBe("1 pending");
    // One step: Undo puts the run back, the trunk gone; Redo grows it again.
    await key(container, { key: "z", metaKey: true });
    expect([count("links"), count("nets")]).toEqual(["7 links", "2 nets"]);
    await key(container, { key: "z", metaKey: true, shiftKey: true });
    expect([count("links"), count("nets")]).toEqual(["6 links", "3 nets"]);
    const runs = await h.read(ex.schematicFibre);
    await history(container, editingMessages.apply());
    // Save sends the trunk alone: the run it absorbed was never saved.
    expect(mutated()).toEqual(["schematic_trunks"]);
    const trunks = [...(await h.read(ex.schematicTrunks)).values()];
    expect(trunks).toHaveLength(1);
    expect(equalFor(ex.DcTrunk)(trunks[0]!, { ...defaultValue<typeof ex.DcTrunk>(ex.DcTrunk), racks: ["A05", "A04"], frames: ["MMR-1"] })).toBe(true);
    expect(equalFor(ex.schematicFibre.type)(await h.read(ex.schematicFibre), runs)).toBe(true);
});

// ── Retarget, Extend, and Del on a leg and on a net (SC10) ──────────────────

test("Retarget writes the end of the run it moves, and every other field of it stands; an end no field holds goes danger first (SC10)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    // u1 runs from A01 down to ODF-1's level, then across to it: a tap on its path selects it.
    await tap(canvas, PPU, 5.2, 9.6);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "fibre", key: "u1" }])));
    // Its end at ODF-1 is a handle: pressed, the run's end follows the pointer — over PDU-A, refused; on to MMR-1, let go.
    await act(async () => { pointer(canvas, "pointerDown", 8.4, 9.6); pointer(canvas, "pointerMove", 1.6, 4.2); });
    expect(container.querySelector("[data-schematic-refusal]")?.textContent).toBe("Fibre run can't end at PDU-A");
    await act(async () => { pointer(canvas, "pointerMove", 24.2, 2.9); pointer(canvas, "pointerUp", 24.2, 2.9); });
    await settle();
    expect(pending(container)).toBe("1 pending");
    const stored = await h.read(ex.schematicFibre);
    await history(container, editingMessages.apply());
    expect(fibreEqual((await h.read(ex.schematicFibre)).get("u1")!, { ...stored.get("u1")!, to: variant("frame", "MMR-1") })).toBe(true);
});

test("Extend adds a rack to a selected feed; Del on a leg takes its rack off the feed, and on a feed deletes it (SC10)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    const kept = keptSelection;
    // Feed A's bar runs under A01 to A03: a tap on it selects the feed.
    await tap(canvas, PPU, 4.2, 3.8);
    await waitFor(() => expect(kept()).toBe(printRefs([{ kind: "feeds", key: "feed-a" }])));
    // Shift-drag from one of its racks to A04: A04 joins its fed side.
    await tool(container, "Connect");
    await drag(canvas, [6.0, 2.9], [13.2, 2.9], true);
    expect(pending(container)).toBe("1 pending");
    // Feed B's leg to A05, tapped: Del takes A05 off it.
    await tool(container, "Select");
    await tap(canvas, PPU, 16.8, 3.5);
    await waitFor(() => expect(kept()).toBe(printRefs([{ kind: "feeds", key: "feed-b" }])));
    await del();
    expect(pending(container)).toBe("2 pending");
    // Feed A, tapped on its bar: Del deletes it.
    await tap(canvas, PPU, 4.2, 3.8);
    await waitFor(() => expect(kept()).toBe(printRefs([{ kind: "feeds", key: "feed-a" }])));
    await del();
    expect(footer(container, 'data-schematic-count="nets"')).toBe("1 net");
    await history(container, editingMessages.apply());
    const feeds = await h.read(ex.schematicFeeds);
    expect([...feeds.keys()]).toEqual(["feed-b"]);
    expect(feeds.get("feed-b")!.racks).toEqual(["A04"]);
});

// ── Del on racks (SC5, D7) and Save per record (SC6) ────────────────────────

test("Del on a rack deletes it with every run and feed leg naming it, one step Undo restores; Save sends each record as its own request (SC5, SC6)", async () => {
    const { container } = await open(ex.schematicDataCentre);
    const canvas = canvasOf(container);
    await tap(canvas, PPU, 2.4, 2.9);
    await del();
    // A01 goes, with u1, its run to ODF-1, and its leg of feed A: three records' rows, one step.
    expect(card(container, "racks", "A01")).toBeNull();
    expect(footer(container, 'data-schematic-count="links"')).toBe("5 links");
    expect(pending(container)).toBe("3 pending");
    await key(container, { key: "z", metaKey: true });
    expect(card(container, "racks", "A01")).not.toBeNull();
    expect(footer(container, 'data-schematic-count="links"')).toBe("6 links");
    expect(pending(container)).toBeUndefined();
    await key(container, { key: "z", metaKey: true, shiftKey: true });
    expect(card(container, "racks", "A01")).toBeNull();
    await history(container, editingMessages.apply());
    // Each record's changes in a request of its own.
    expect([...mutated()].sort()).toEqual(["schematic_feeds", "schematic_fibre", "schematic_racks"]);
    expect((await h.read(ex.schematicRacks)).has("A01")).toBe(false);
    expect((await h.read(ex.schematicFibre)).has("u1")).toBe(false);
    expect((await h.read(ex.schematicFeeds)).get("feed-a")!.racks).toEqual(["A02", "A03"]);
});

/** The floor's racks beside fibre runs whose patch door refuses every change: what a Save over both is answered. */
const frozenFloor = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, [ex.schematicRacksPatch]));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const fibre = $.let(Record.bind(ex.schematicFrozenFibre, [ex.schematicFrozenFibrePatch]));
    const ends = { field: "from", of: { rack: "racks", frame: "network" } } as const;
    return Schematic({
        id: "frozen",
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
    expect(pending(container)).toBe("2 pending");
    await history(container, editingMessages.apply());
    // The racks committed; the runs refused, their draft kept, the banner naming why.
    movedTo((await h.read(ex.schematicRacks)).get("A03"), stored.racks.get("A03")!, 9.6, 5.0);
    expect(equalFor(ex.schematicFrozenFibre.type)(await h.read(ex.schematicFrozenFibre), stored.runs)).toBe(true);
    const refused = slot(container, "banners").querySelector('[data-session-banner="rejected"]')?.textContent;
    expect(refused).toContain("Fibre run");
    expect(refused).toContain("the fibre runs are frozen");
    expect(pending(container)).toBe("1 pending");
    expect(footer(container, 'data-schematic-count="links"')).toBe("7 links");
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
        await tap(canvasOf(container), PPU, 2.4, 2.9);
        await waitFor(() => expect(card(container, "racks", "A01")!.hasAttribute("data-selected")).toBe(true));
        await del();
        expect(card(container, "racks", "A01")).not.toBeNull();
        expect(pending(container)).toBeUndefined();
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
    expect(pending(container)).toBe("1 pending");
    // Let back in, it shows where its draft has it.
    await narrow(new Map());
    await waitFor(() => expect(card(container, "racks", "A03")?.style.transform).toBe(moved));
    // Narrowed out again, Save sends it all the same.
    await narrow(harbour);
    await waitFor(() => expect(card(container, "racks", "A03")).toBeNull());
    await history(container, editingMessages.apply());
    movedTo((await h.read(ex.schematicRacks)).get("A03"), stored.get("A03")!, 9.6, 5.0);
    expect(pending(container)).toBeUndefined();
});

