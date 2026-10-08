/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The flowchart's drag and drop (#1249, `Flowchart Builder Spec.md` §9.8,
 * §10, FB30–FB34), through the page's drag layer and its test seams, over a
 * record of flows in memory bound with its patch mutation: a state template
 * dropped on a lane at the row under the pointer — the ghost saying where, the
 * lane washed and the landing line drawn — its key the card's, made unique or
 * minted, the new state selected; a transition template retyping the
 * transition it lands on, which takes the brand wash; an author's card setting
 * its fields on a decision's diamond, a state and a lane's header; every
 * refusal in its words, red, dropping nothing; a read-only flowchart refusing
 * every drop; a card carried over the canvas raising no hover card, no
 * dimming and no "+ STATE" ghost; ⏎ on a card dropping it on the canvas's
 * selection — refused, the footer saying why — and scrolling the state it
 * adds into view, where a pointer's drop leaves the view be; on a touch screen
 * a tap on the selected card doing what ⏎ does; and each drop one
 * transaction, one Undo taking it back, Save committing it through the record.
 *
 * jsdom lays nothing out: the canvas measures 0×0, so its lanes are 166px wide
 * from the left edge and its states sit where `layout.ts` puts them; the
 * canvas's drop cell is laid out at the client origin, so a pointer's client
 * point is the canvas's own.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DictType, East, SortedMap, StringType, StructType, compareFor, equalFor, none, some, variant,
    type BlockBuilder, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Text, UIComponentType } from "@elaraai/east-ui/internal";
import { DragLayerProvider, UIStore, editingMessages, formatters, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { announced, layOut, pointAt, stubScrollIntoView } from "@elaraai/east-ui-components/testing";
import { Flowchart } from "@elaraai/e3-ui/internal";
import * as edits from "./edits.js";
import { enabled, mountRecord, press, readRecord, recordHarness, settle, type RecordHarness } from "./flowchart.test-utils.js";
import { EastChakraFlowchart, type FlowchartValue } from "./index.js";
import { NODE_H, NODE_W, computeLayout, type FlowchartLayout } from "./layout.js";
import { flowchartMessages } from "./messages.js";
import { buildModel } from "./model.js";

// jsdom lacks the ResizeObserver the panes and the canvas reach for, and the matchMedia the popovers do.
beforeAll(() => {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    (globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
});
stubScrollIntoView();

// Each test its own UI store: the flow it opens, its sessions and its panes stay its own.
beforeEach(() => {
    initializeStore(new UIStore());
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    pointAt(null);
});

type Flow = ValueTypeOf<typeof Flowchart.Types.Flow>;
type Flows = ValueTypeOf<typeof Flowchart.Types.Flows>;

const m = flowchartMessages;
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();
const flowEqual = equalFor(Flowchart.Types.Flow);
const keyEqual = equalFor(StringType);

// ── The flow, and the library's rows ─────────────────────────────────────

/** The sort flow: two states in intake, the chutes in sort, an empty hold lane; a decision on SCN → CH*. */
const SORT_INPUT = {
    lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "hold", label: "Hold" }],
    states: [
        { key: "ARV", label: "Arrived", lane: "intake" },
        { key: "SCN", label: "Scanned", lane: "intake" },
        { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
    ],
    links: [
        { from: "ARV", to: "SCN" },
        { key: "SCN→CH*", from: "SCN", to: "CH*", trigger: "route" },
    ],
    triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
} as const satisfies Parameters<typeof Flowchart.value>[0];

const SORT: Flow = Flowchart.value(SORT_INPUT);
/** The sort flow, opened first, and the returns flow beside it. */
const FLOWS: Flows = Flowchart.values({
    "Sort": SORT_INPUT,
    "Returns": { lanes: [{ key: "counter", label: "Counter" }], states: [{ key: "RCV", label: "Received", lane: "counter" }], links: [] },
});

/** A step type; the second has no code of its own, so its state's key is minted. */
const StepRow = StructType({ code: StringType, name: StringType });
const STEPS: ValueTypeOf<typeof StepRow>[] = [{ code: "HLD", name: "Held" }, { code: "", name: "Step" }];
/** A transition type, by name. */
const MoveRow = StructType({ kind: Flowchart.Types.Kind });
const MOVES = new SortedMap<string, ValueTypeOf<typeof MoveRow>>([["Observed", { kind: variant("observed", null) }]], compareFor(StringType));
/** A role that owns a decision. */
const OwnerRow = StructType({ role: StringType, name: StringType });
const OWNERS: ValueTypeOf<typeof OwnerRow>[] = [{ role: "customs-desk", name: "Customs desk" }];
/** A note a state takes. */
const NoteRow = StructType({ text: StringType });
const NOTES: ValueTypeOf<typeof NoteRow>[] = [{ text: "Checked at the bay" }];
/** A name a lane takes. */
const NameRow = StructType({ label: StringType });
const NAMES: ValueTypeOf<typeof NameRow>[] = [{ label: "Sortation" }];

/**
 * The sort flow opened first, with its library: the Flows tab, the step
 * types, the transition types, and the author's owners (onto a decision),
 * notes (onto a state) and names (onto a lane's header) — each tab over its
 * rows, bound in the block.
 */
function depot<T extends EastType>($: BlockBuilder<T>) {
    const steps = $.const(STEPS, ArrayType(StepRow));
    const moves = $.const(MOVES, DictType(StringType, MoveRow));
    const owners = $.const(OWNERS, ArrayType(OwnerRow));
    const notes = $.const(NOTES, ArrayType(NoteRow));
    const names = $.const(NAMES, ArrayType(NameRow));
    return {
        flow: "Sort",
        library: [
            Flowchart.library.flows(),
            Flowchart.library.states(steps, {
                name: "Steps", icon: "box", key: (s) => s.name, label: (s) => s.name, meta: (s) => some(s.code),
                drop: (s) => Flowchart.patch(Flowchart.Types.State, { key: s.code, label: some(s.name) }),
            }),
            Flowchart.library.transitions(moves, {
                icon: "arrow-right", key: (_mv, name) => name, label: (_mv, name) => name,
                drop: (mv) => Flowchart.patch(Flowchart.Types.Link, { kind: some(mv.kind) }),
            }),
            Flowchart.library.tab(owners, {
                name: "Owners", icon: "user-tie", key: (o) => o.role, label: (o) => o.name,
                drop: (o) => Flowchart.patch(Flowchart.Types.Trigger, { owner: some(o.role) }),
            }),
            Flowchart.library.tab(notes, {
                name: "Notes", icon: "note-sticky", key: (n) => n.text, label: (n) => n.text,
                drop: (n) => Flowchart.patch(Flowchart.Types.State, { notes: some(n.text) }),
            }),
            Flowchart.library.tab(names, {
                name: "Names", icon: "tag", key: (n) => n.label, label: (n) => n.label,
                drop: (n) => Flowchart.patch(Flowchart.Types.Lane, { label: some(n.label) }),
            }),
        ],
    };
}

/** The sort flow over a record, its library listed, under the page's drag layer. */
async function mountDepot(): Promise<{ container: HTMLElement; harness: RecordHarness }> {
    const harness = recordHarness(FLOWS);
    const { container } = await mountRecord(depot, { drag: true });
    return { container, harness };
}

/** The sort flow as the host's read-only flows — no `onApply` — its library listed, under the page's drag layer. */
async function mountReadOnly(): Promise<RenderResult> {
    const value = East.compile(East.function([], Flowchart.Types.Payload, ($) => Flowchart.Payload({ data: FLOWS, ...depot($) })),
        getRegisteredPlatformImplementations())() as FlowchartValue;
    const utils = render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <EastChakraFlowchart value={value} storageKey="flowchart.drop" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

/** Where the canvas draws the sort flow in jsdom: lanes 166px wide, rows 96px apart from 56px down, the legend's strip under them. */
const LAYOUT: FlowchartLayout = computeLayout(buildModel(SORT, formatters("en-US")), { width: 0, orientation: "LR", legendPad: 122 });
const routeOf = (key: string) => LAYOUT.routes.find((r) => keyEqual(r.key, key))!;
const centreOf = (key: string) => { const r = LAYOUT.nodes.get(key)!; return { x: r.cx, y: r.cy }; };

/** In intake, between ARV's middle and SCN's — ARV → SCN's line runs there too. */
const BETWEEN = { x: 83, y: 124 };
/** The + LANE tail: no lane. */
const TAIL = { x: LAYOUT.laneTail.x + LAYOUT.laneTail.w / 2, y: 200 };
/** The hold lane, which holds no state. */
const HOLD = { x: 415, y: 120 };
/** The sort lane's header. */
const SORT_HEAD = { x: 249, y: 20 };
/** The sort lane, under its header and clear of the chutes. */
const SORT_BODY = { x: 249, y: 200 };

// ── Reading the flowchart ────────────────────────────────────────────────

const stateKeys = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node"));
const node = (c: HTMLElement, key: string): HTMLElement => c.querySelector(`[data-flowchart-node="${key}"]`) as HTMLElement;
/** Whether a state is drawn in another's lane, the next row down. */
const drawnUnder = (c: HTMLElement, key: string, above: string): boolean =>
    node(c, key).style.left === node(c, above).style.left && parseFloat(node(c, key).style.top) - parseFloat(node(c, above).style.top) === 96;
const pending = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-pending]")?.textContent ?? null;
const footerMessage = (c: HTMLElement): string => c.querySelector("[data-flowchart-message]")?.textContent ?? "";
/** The canvas's drop cell: the box its drawing stands in. */
const cell = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-frame-slot='main'] [data-drag-cell]")!;
const pane = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-frame-slot='start']")!;

/** Opens a library tab, by its name. */
async function openTab(c: HTMLElement, name: string): Promise<void> {
    const tab = [...pane(c).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    await act(async () => { fireEvent.click(tab); });
    await settle();
}

/** A card of the open tab, by its key. */
function cardOf(c: HTMLElement, key: string): HTMLElement {
    const card = pane(c).querySelector<HTMLElement>(`[role="tabpanel"]:not([hidden]) [data-library-item="${key}"]`);
    if (card === null) throw new Error(`no card ${key}`);
    return card;
}

// ── Dragging ──────────────────────────────────────────────────────────────

/** The canvas laid out at the client origin, larger than its drawing. */
const BOX = { left: 0, top: 0, width: 4000, height: 4000 };

/** Picks a card up with the mouse: pressed, and carried past the 4px a drag starts after (FB30). */
function pickUp(card: HTMLElement): void {
    pointAt(null);
    act(() => { fireEvent.pointerDown(card, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); });
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 6 }); });
}

/** Rests the drag at a point of the canvas. */
function restOn(c: HTMLElement, at: { x: number; y: number }): void {
    layOut(new Map([[cell(c), BOX]]));
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: at.x, clientY: at.y }); });
}

/** Drops where the drag rests, and lets the flowchart settle. */
async function release(at: { x: number; y: number }): Promise<void> {
    act(() => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: at.x, clientY: at.y }); });
    await settle();
}

/** What the ghost says: its caption, and whether it says why not — `null` while the ghost goes alone. */
const caption = () => {
    const el = document.querySelector("[data-drag-caption]");
    return el === null ? null : { text: el.textContent, refused: el.hasAttribute("data-refused") };
};

/** Presses ⏎ on a card, as the keyboard does. */
async function enter(card: HTMLElement): Promise<void> {
    card.focus();
    await act(async () => { fireEvent.keyDown(card, { key: "Enter", code: "Enter" }); });
    await settle();
}

/** A touch screen, for one test: `(pointer: coarse)` matches. */
function touchScreen(): () => void {
    const saved = window.matchMedia;
    window.matchMedia = ((query: string) => ({
        matches: query === "(pointer: coarse)", media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    })) as unknown as typeof window.matchMedia;
    return () => { window.matchMedia = saved; };
}

/** The state Held adds, under a key and in a lane. */
const held = (key: string, lane: string) => ({ key, label: some("Held"), lane, members: none, notes: none });

// ============================================================================
// A state template onto a lane (FB30, FB31)
// ============================================================================

describe("a state template dropped on a lane (FB30, FB31)", () => {
    test("lands at the row under the pointer, after the states above it: the ghost says where, the lane takes its wash and the landing line runs where it lands; dropped, the state is added and selected — one transaction, one Undo taking it back — and Save commits it", async () => {
        const { container, harness } = await mountDepot();
        await openTab(container, "Steps");
        pickUp(cardOf(container, "Held"));
        // Picked up, over nothing: the ghost alone.
        expect(caption()).toBeNull();
        restOn(container, BETWEEN);
        expect(caption()).toEqual({ text: "after ARV in Intake", refused: false });
        expect(cell(container).hasAttribute("data-drop-active")).toBe(true);
        const wash = container.querySelector<HTMLElement>("[data-flowchart-droplane]")!;
        expect([wash.getAttribute("data-flowchart-droplane"), wash.style.left, wash.style.top, wash.style.width]).toEqual(["intake", "0px", "0px", "166px"]);
        // Between ARV and SCN, across the state's footprint, in the middle of the gap.
        const line = container.querySelector<HTMLElement>("[data-flowchart-landing]")!;
        expect([line.getAttribute("data-flowchart-landing"), line.style.left, line.style.top, line.style.width, line.style.height]).toEqual(["1", "25px", "124px", "116px", ""]);
        // Above ARV's middle: before it, the line under the lane's header.
        restOn(container, { x: 83, y: 60 });
        expect(caption()).toEqual({ text: "at the start of Intake", refused: false });
        expect([container.querySelector("[data-flowchart-landing]")!.getAttribute("data-flowchart-landing"), (container.querySelector("[data-flowchart-landing]") as HTMLElement).style.top])
            .toEqual(["0", "48px"]);
        // The + LANE tail is no lane: refused, red.
        restOn(container, TAIL);
        expect(caption()).toEqual({ text: "Drop onto a lane", refused: true });
        expect(cell(container).hasAttribute("data-drop-invalid")).toBe(true);
        restOn(container, BETWEEN);
        await release(BETWEEN);
        expect(stateKeys(container)).toEqual(["ARV", "HLD", "SCN", "CH*"]);
        expect(node(container, "HLD").hasAttribute("data-selected")).toBe(true);
        expect(announced()).toBe("Held was dropped on Intake, after ARV.");
        // The drag over, nothing stays marked.
        expect(container.querySelector("[data-flowchart-droplane], [data-flowchart-landing], [data-drop-target]")).toBeNull();
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 1, count: "1" })}`);
        // One transaction: one Undo takes it back whole.
        await press(UNDO);
        expect(stateKeys(container)).toEqual(["ARV", "SCN", "CH*"]);
        expect(enabled(UNDO)).toBe(false);
        await press(REDO);
        expect(stateKeys(container)).toEqual(["ARV", "HLD", "SCN", "CH*"]);
        await press(SAVE);
        expect(flowEqual(readRecord(harness).get("Sort")!, edits.insertState(SORT, 1, held("HLD", "intake")))).toBe(true);
    }, 30_000);

    test("its key is the card's, made unique where the flow holds it — HLD-2 — or minted where the card gives none; in a lane holding no state, it lands in its first row", async () => {
        const { container, harness } = await mountDepot();
        await openTab(container, "Steps");
        for (const _ of [1, 2]) {
            pickUp(cardOf(container, "Held"));
            restOn(container, HOLD);
            await release(HOLD);
        }
        expect(stateKeys(container)).toEqual(["ARV", "SCN", "CH*", "HLD", "HLD-2"]);
        pickUp(cardOf(container, "Step"));
        restOn(container, { x: 249, y: 60 });
        expect(caption()).toEqual({ text: "at the start of Sort", refused: false });
        await release({ x: 249, y: 60 });
        expect(stateKeys(container)).toEqual(["ARV", "SCN", "state-6", "CH*", "HLD", "HLD-2"]);
        // Three drops, three transactions.
        for (let i = 0; i < 3; i++) await press(UNDO);
        expect([stateKeys(container), enabled(UNDO)]).toEqual([["ARV", "SCN", "CH*"], false]);
        for (let i = 0; i < 3; i++) await press(REDO);
        await press(SAVE);
        const saved = readRecord(harness).get("Sort")!;
        expect(saved.states.map((s) => [s.key, s.lane])).toEqual([["ARV", "intake"], ["SCN", "intake"], ["state-6", "sort"], ["CH*", "sort"], ["HLD", "hold"], ["HLD-2", "hold"]]);
    }, 30_000);

    test("a read-only flowchart refuses every drop — a step's card on a lane, a transition's on a transition — the ghost saying why, and dropping changes nothing; ⏎ on a card is refused, the footer saying why", async () => {
        const { container } = await mountReadOnly();
        await openTab(container, "Steps");
        pickUp(cardOf(container, "Held"));
        restOn(container, BETWEEN);
        expect(caption()).toEqual({ text: "The flowchart is read only", refused: true });
        expect(container.querySelector("[data-flowchart-droplane], [data-flowchart-landing]")).toBeNull();
        await release(BETWEEN);
        expect(stateKeys(container)).toEqual(["ARV", "SCN", "CH*"]);
        expect(announced()).toBe("Held was not dropped.");
        await enter(cardOf(container, "Held"));
        expect([stateKeys(container), footerMessage(container)]).toEqual([["ARV", "SCN", "CH*"], "The flowchart is read only"]);
        // A transition's card on a transition: no wash, and the transition keeps its kind — planned, solid.
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        pickUp(cardOf(container, "Observed"));
        restOn(container, routeOf("ARV→SCN#0").mid);
        expect(caption()).toEqual({ text: "The flowchart is read only", refused: true });
        expect(container.querySelector("[data-flowchart-dropwash]")).toBeNull();
        await release(routeOf("ARV→SCN#0").mid);
        expect(announced()).toBe("Observed was not dropped.");
        expect(container.querySelector('[data-flowchart-link="ARV→SCN#0"]')!.previousElementSibling!.hasAttribute("stroke-dasharray")).toBe(false);
    }, 30_000);
});

// ============================================================================
// A drag over the canvas (FB30)
// ============================================================================

describe("a card carried over the canvas (FB30)", () => {
    test("raises no hover card, no dimming and no + STATE ghost — picked up while the pointer rests on a state, it lets go of that state's card and dimming; the drag over, each comes back", async () => {
        recordHarness(FLOWS);
        const { container } = await mountRecord(($) => {
            const stateHover = $.const(East.function([StringType], UIComponentType, (_$2, key) => Text.Root(key)));
            return { ...depot($), stateHover };
        }, { drag: true });
        const hoverCard = () => container.querySelector("[data-flowchart-hovercard]")?.textContent ?? null;
        const ghost = () => container.querySelector("[data-flowchart-ghoststate]")?.getAttribute("data-flowchart-ghoststate") ?? null;
        /** CH*'s opacity: no transition joins it to ARV, so the pointer on ARV dims it. */
        const chutes = () => node(container, "CH*").style.opacity;
        const wait = (ms: number) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
        await openTab(container, "Steps");
        // At rest: the pointer on ARV dims CH*, and ARV's card opens after its 400ms.
        act(() => { fireEvent.pointerEnter(node(container, "ARV")); });
        await waitFor(() => expect(hoverCard()).toBe("ARV"));
        expect(chutes()).toBe("0.45");
        // A card picked up: ARV lets go of its card and its dimming.
        pickUp(cardOf(container, "Held"));
        expect([hoverCard(), chutes()]).toEqual([null, "1"]);
        // Carried over the canvas: a state raises no card and dims nothing; a lane raises no ghost.
        act(() => { fireEvent.pointerEnter(node(container, "ARV")); });
        act(() => { fireEvent.pointerEnter(container.querySelector("[data-flowchart-band='hold']")!); });
        await wait(500);
        expect([hoverCard(), chutes(), ghost()]).toEqual([null, "1", null]);
        // The drag over: the lane under the pointer shows its ghost, and a state its card and its dimming.
        restOn(container, TAIL);
        await release(TAIL);
        expect(ghost()).toBe("hold");
        act(() => { fireEvent.pointerEnter(node(container, "ARV")); });
        await waitFor(() => expect(hoverCard()).toBe("ARV"));
        expect(chutes()).toBe("0.45");
    }, 30_000);
});

// ============================================================================
// A transition template onto a transition (FB32)
// ============================================================================

describe("a transition template dropped on a transition (FB32)", () => {
    test("retypes it — connect, then retype — the transition taking the brand wash while the drag rests on it; anywhere else refused: Drop onto a transition", async () => {
        const { container, harness } = await mountDepot();
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        pickUp(cardOf(container, "Observed"));
        restOn(container, centreOf("CH*"));
        expect(caption()).toEqual({ text: "Drop onto a transition", refused: true });
        expect(container.querySelector("[data-flowchart-dropwash]")).toBeNull();
        restOn(container, routeOf("ARV→SCN#0").mid);
        expect(caption()).toEqual({ text: "onto ARV → SCN", refused: false });
        const wash = container.querySelector("[data-flowchart-dropwash]")!;
        expect([wash.getAttribute("data-flowchart-dropwash"), wash.getAttribute("d")])
            .toEqual(["ARV→SCN#0", container.querySelector('[data-flowchart-link="ARV→SCN#0"]')!.getAttribute("d")]);
        await release(routeOf("ARV→SCN#0").mid);
        expect(announced()).toBe("Observed was dropped on ARV → SCN.");
        expect(container.querySelector("[data-flowchart-dropwash]")).toBeNull();
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 1, count: "1" })}`);
        await press(UNDO);
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 0, count: "0" })}`);
        await press(REDO);
        await press(SAVE);
        expect(flowEqual(readRecord(harness).get("Sort")!, { ...SORT, links: [{ ...SORT.links[0]!, kind: some(variant("observed", null)) }, SORT.links[1]!] })).toBe(true);
    }, 30_000);
});

// ============================================================================
// An author's cards (FB33)
// ============================================================================

describe("an author's card lands where its drop's type says (FB33)", () => {
    test("on a decision's diamond, a state and a lane's header — each taking the brand while the drag rests there — setting its fields; refused elsewhere, naming where it lands; each one transaction", async () => {
        const { container, harness } = await mountDepot();
        const diamond = routeOf("SCN→CH*").mid;
        // The owner: onto the route decision's diamond.
        await openTab(container, "Owners");
        pickUp(cardOf(container, "customs-desk"));
        restOn(container, centreOf("CH*"));
        expect(caption()).toEqual({ text: "Drop onto a decision", refused: true });
        restOn(container, diamond);
        expect(caption()).toEqual({ text: "onto decision route", refused: false });
        expect(container.querySelector('[data-flowchart-trigger="route"]')!.hasAttribute("data-drop-target")).toBe(true);
        await release(diamond);
        expect(container.querySelector("[data-drop-target]")).toBeNull();
        // The note: onto a state.
        await openTab(container, "Notes");
        pickUp(cardOf(container, "Checked at the bay"));
        restOn(container, SORT_HEAD);
        expect(caption()).toEqual({ text: "Drop onto a state", refused: true });
        restOn(container, centreOf("CH*"));
        expect(caption()).toEqual({ text: "onto CH*", refused: false });
        expect(node(container, "CH*").hasAttribute("data-drop-target")).toBe(true);
        await release(centreOf("CH*"));
        // The name: onto the sort lane's header, the lane washed and no landing line.
        await openTab(container, "Names");
        pickUp(cardOf(container, "Sortation"));
        restOn(container, SORT_BODY);
        expect(caption()).toEqual({ text: "Drop onto a lane's header", refused: true });
        restOn(container, SORT_HEAD);
        expect(caption()).toEqual({ text: "onto lane Sort", refused: false });
        expect([container.querySelector("[data-flowchart-droplane]")!.getAttribute("data-flowchart-droplane"), container.querySelector("[data-flowchart-landing]")])
            .toEqual(["sort", null]);
        await release(SORT_HEAD);
        expect([...container.querySelectorAll("[data-flowchart-lane]")].map((el) => el.textContent)).toEqual(["INTAKE", "SORTATION", "HOLD"]);
        // Three drops, three transactions.
        for (let i = 0; i < 3; i++) await press(UNDO);
        expect(enabled(UNDO)).toBe(false);
        for (let i = 0; i < 3; i++) await press(REDO);
        await press(SAVE);
        expect(flowEqual(readRecord(harness).get("Sort")!, {
            ...SORT,
            lanes: [SORT.lanes[0]!, { ...SORT.lanes[1]!, label: some("Sortation") }, SORT.lanes[2]!],
            states: [SORT.states[0]!, SORT.states[1]!, { ...SORT.states[2]!, notes: some("Checked at the bay") }],
            triggers: [{ ...SORT.triggers[0]!, owner: some("customs-desk") }],
        })).toBe(true);
    }, 30_000);
});

// ============================================================================
// ⏎ on a card, and a tap on a touch screen (FB34)
// ============================================================================

describe("⏎ on a card drops it on the canvas's selection (FB34)", () => {
    test("a state template after the selected state, in its lane, selected — never picked up; a card the selection takes no such drop of is refused, the footer saying why, until a drop lands", async () => {
        const { container, harness } = await mountDepot();
        await act(async () => { fireEvent.click(node(container, "SCN")); });
        await settle();
        await openTab(container, "Steps");
        const card = cardOf(container, "Held");
        await enter(card);
        // After the lane's last state: at the end of the flow's states, drawn in intake under SCN.
        expect(stateKeys(container)).toEqual(["ARV", "SCN", "CH*", "HLD"]);
        expect(drawnUnder(container, "HLD", "SCN")).toBe(true);
        expect(node(container, "HLD").hasAttribute("data-selected")).toBe(true);
        expect(card.hasAttribute("data-dragging")).toBe(false);
        // HLD selected: a transition card has no transition to retype.
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        await enter(cardOf(container, "Observed"));
        expect(footerMessage(container)).toBe("Drop onto a transition");
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 1, count: "1" })}`);
        // A transition selected: retyped, and the footer's line goes.
        await act(async () => { fireEvent.click(container.querySelector('[data-flowchart-link="ARV→SCN#0"]')!); });
        await settle();
        await enter(cardOf(container, "Observed"));
        expect(footerMessage(container)).toBe("");
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 2, count: "2" })}`);
        // The diamond selected: an owner's card sets its owner.
        await act(async () => { fireEvent.click(container.querySelector('[data-flowchart-trigger="route"]')!); });
        await settle();
        await openTab(container, "Owners");
        await enter(cardOf(container, "customs-desk"));
        // Three drops, three transactions; Save commits them.
        await press(SAVE);
        expect(flowEqual(readRecord(harness).get("Sort")!, {
            ...SORT,
            states: [...SORT.states, held("HLD", "intake")],
            links: [{ ...SORT.links[0]!, kind: some(variant("observed", null)) }, SORT.links[1]!],
            triggers: [{ ...SORT.triggers[0]!, owner: some("customs-desk") }],
        })).toBe(true);
    }, 30_000);

    test("the footer's line says why a ⏎ was refused until another flow opens", async () => {
        const { container } = await mountDepot();
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        // Nothing selected: no transition to retype.
        await enter(cardOf(container, "Observed"));
        expect(footerMessage(container)).toBe("Drop onto a transition");
        await openTab(container, m.flowsTab());
        await act(async () => { fireEvent.click(cardOf(container, "Returns")); });
        await settle();
        expect([stateKeys(container), footerMessage(container)]).toEqual([["RCV"], ""]);
    }, 30_000);

    test("with nothing selected, a state template lands at the end of the first lane; after a state between two others, between them", async () => {
        const { container } = await mountDepot();
        await openTab(container, "Steps");
        await enter(cardOf(container, "Held"));
        expect(stateKeys(container)).toEqual(["ARV", "SCN", "CH*", "HLD"]);
        expect(drawnUnder(container, "HLD", "SCN")).toBe(true);
        expect(node(container, "HLD").hasAttribute("data-selected")).toBe(true);
        // ARV selected: after it, before SCN.
        await act(async () => { fireEvent.click(node(container, "ARV")); });
        await settle();
        await enter(cardOf(container, "Held"));
        expect(stateKeys(container)).toEqual(["ARV", "HLD-2", "SCN", "CH*", "HLD"]);
        expect([drawnUnder(container, "HLD-2", "ARV"), drawnUnder(container, "SCN", "HLD-2")]).toEqual([true, true]);
    }, 30_000);

    test("⏎ scrolls the state it adds to the middle of the canvas's view; a state dropped where the pointer is leaves the view where it stands", async () => {
        const { container } = await mountDepot();
        const scroll = container.querySelector<HTMLElement>("[data-flowchart-scroll]")!;
        /** A state's middle: where a view of jsdom's 0×0 scrolls to, to hold it in its middle. */
        const middle = (key: string) => [parseFloat(node(container, key).style.left) + NODE_W / 2, parseFloat(node(container, key).style.top) + NODE_H / 2];
        await openTab(container, "Steps");
        pickUp(cardOf(container, "Held"));
        restOn(container, HOLD);
        await release(HOLD);
        expect(node(container, "HLD").hasAttribute("data-selected")).toBe(true);
        expect([scroll.scrollLeft, scroll.scrollTop]).toEqual([0, 0]);
        // ⏎, HLD selected: HLD-2 after it, in hold's next row, scrolled to.
        await enter(cardOf(container, "Held"));
        expect(node(container, "HLD-2").hasAttribute("data-selected")).toBe(true);
        expect([scroll.scrollLeft, scroll.scrollTop]).toEqual(middle("HLD-2"));
    }, 30_000);

    test("on a touch screen a tap on the selected card does what ⏎ does, and leaves it selected — a tap on another card only moves the selection; on a fine pointer a second click lets it go, and drops nothing", async () => {
        const restore = touchScreen();
        try {
            const { container } = await mountDepot();
            await act(async () => { fireEvent.click(node(container, "SCN")); });
            await settle();
            await openTab(container, "Steps");
            const tap = async (key: string) => {
                await act(async () => { fireEvent.click(cardOf(container, key)); });
                await settle();
            };
            const placed = () => ["Held", "Step"].filter((key) => cardOf(container, key).hasAttribute("data-placed"));
            // The first tap selects a card; a tap on another moves the selection: nothing dropped yet.
            await tap("Held");
            expect([placed(), stateKeys(container)]).toEqual([["Held"], ["ARV", "SCN", "CH*"]]);
            await tap("Step");
            expect([placed(), stateKeys(container)]).toEqual([["Step"], ["ARV", "SCN", "CH*"]]);
            // A tap on the selected card drops it after the selected state, and leaves it selected.
            await tap("Step");
            expect([placed(), stateKeys(container)]).toEqual([["Step"], ["ARV", "SCN", "CH*", "state-4"]]);
            expect(drawnUnder(container, "state-4", "SCN")).toBe(true);
        } finally {
            restore();
        }
        cleanup();
        initializeStore(new UIStore());
        const fine = await mountDepot();
        await openTab(fine.container, "Steps");
        for (const _ of [1, 2]) {
            await act(async () => { fireEvent.click(cardOf(fine.container, "Held")); });
            await settle();
        }
        expect([cardOf(fine.container, "Held").hasAttribute("data-placed"), stateKeys(fine.container)]).toEqual([false, ["ARV", "SCN", "CH*"]]);
    }, 30_000);
});
