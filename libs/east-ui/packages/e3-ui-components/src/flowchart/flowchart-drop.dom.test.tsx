/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's drag and drop (#1501, `Flowchart Records Spec.md` R14),
 * through the page's drag layer and its test seams, over the depot's records
 * on e3 itself: a state's card dropped on a lane at the row under the pointer —
 * the ghost saying where, the lane washed and the landing line drawn — adding
 * a state from the card's values, keyed `state-<n>`, its order between the
 * states it lands between, and selected; a lane's card adding a lane where it
 * lands; a transition's card giving the transition it lands on its values, the
 * transition taking the brand wash; an author's card setting its fields on a
 * decision's diamond, a state and a lane's header; every refusal in its words,
 * red, dropping nothing; a read-only flowchart refusing every drop; a card
 * carried over the canvas raising no dimming and no "+ STATE" ghost; ⏎ on a
 * card dropping it on the canvas's selection — a lane's card on the lane a
 * click on its header selected — refused, the footer saying why, and
 * scrolling the state it adds into view, where a pointer's drop leaves the
 * view be; on a touch screen a tap on the selected card doing what ⏎ does; and
 * each drop one transaction, one Undo taking it back, Save committing it
 * through the record's patch door.
 *
 * Where a point lands, what each card's drop plans and the edits it makes are
 * `drop.test.ts`'s; these tests are the page's side of it.
 *
 * jsdom lays nothing out: the canvas measures 0×0 and draws the parcels' flow,
 * two states a lane, the example's cards as tall as their details — so each
 * point a drag rests on, and each place a test expects, is read from the
 * drawing (`drawn.test-utils.ts`). The canvas's drop cell is laid out at the
 * client origin, so a pointer's client point is the canvas's own. Each tab's
 * Library alone is measured, as the e3 harness measures it, so its virtualizer
 * lays out its cards.
 */

import { afterEach, describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import {
    DictType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, none, printFor, some, variant,
    type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Slice, type UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { announced, layOut, pointAt, stubScrollIntoView } from "@elaraai/east-ui-components/testing";
import { Data, Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { reloadPage } from "../e3-web-mount.test-utils.js";
import type { E3Request } from "../e3-web.test-utils.js";
import {
    bandOf, between, cardBox, centreOf, drawnUnder, headOf, headerOf, laneOf, middleOf, node, rowOf, rowsOf, stateKeys, tail, topOf, under,
} from "./drawn.test-utils.js";
import { act, enabled, flowchartHarness, press, settle, type FlowchartTestProps } from "./flowchart.test-utils.js";
import { measureLibrary } from "./library-measure.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness();
measureLibrary();

stubScrollIntoView();

afterEach(() => {
    pointAt(null);
});

const m = flowchartMessages;
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();
const compareString = compareFor(StringType);

// ── The depot's records, as e3 holds them ────────────────────────────────

type State = ValueTypeOf<typeof ex.DepotState>;
type Transition = ValueTypeOf<typeof ex.DepotTransition>;
type Lane = ValueTypeOf<typeof ex.DepotLane>;
type Decision = ValueTypeOf<typeof ex.DepotDecision>;

const printStates = printFor(DictType(StringType, ex.DepotState));
const printTransitions = printFor(DictType(StringType, ex.DepotTransition));
const printLanes = printFor(DictType(StringType, ex.DepotLane));
const printDecisions = printFor(DictType(StringType, ex.DepotDecision));

/** A record's rows with some set: each given row under its key, the rest as they were. */
function withRows<V>(rows: Iterable<readonly [string, V]>, set: readonly (readonly [string, V])[]): SortedMap<string, V> {
    const next = new SortedMap<string, V>([...rows].map(([key, row]) => [key, row] as [string, V]), compareString);
    for (const [key, row] of set) next.set(key, row);
    return next;
}

/** The desk card's state, where it lands: its card's values, its lane and its order. */
const desk = (phase: string, seq: number): State => ({ name: "Exception desk", phase, seq, slots: none, flow: "Parcels" });

/** ARV → SCN as the reroute card leaves it: its ends kept, the rest the card's values. */
const REROUTED: Transition = {
    src: "ARV", dst: "SCN", kind: variant("observed", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels",
};

// ── The depot's flowchart, built over its records ────────────────────────

/** A row of the Slots tab: a count of interchangeable states. */
const SlotRow = StructType({ label: StringType, slots: OptionType(IntegerType) });
/** A row of the Names tab: a lane's name. */
const NameRow = StructType({ label: StringType });

/**
 * The depot as `flowchartDepot` builds it — its states and transitions read
 * through their sources, the parcels' flow shown; its lanes and decisions read
 * whole; each kind's cards a record of their own; the example's library — read
 * only: no gesture, drop or inspector edit.
 */
const readOnlyDepot = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const states = $.let(Record.bind(ex.depotStates));
    const stateEntries = $.let(Data.bindPaged(ex.depotStates));
    const transitions = $.let(Record.bind(ex.depotTransitions));
    const transitionEntries = $.let(Data.bindPaged(ex.depotTransitions));
    const lanes = $.let(Record.bind(ex.depotLanes));
    const decisions = $.let(Record.bind(ex.depotDecisions));
    const steps = $.let(Data.bind(ex.stepCards));
    const moves = $.let(Data.bind(ex.moveCards));
    const laneRows = $.let(Data.bind(ex.laneCards));
    const owners = $.let(Data.bind(ex.decisionOwners));
    const slice = $.let(Slice.bindRecords("flowchart.depot", {
        states: {
            source: Data.bindPaged(ex.depotStates, { indexes: ["flowchart_states_by_flow", "flowchart_states_by_lane"] }),
            fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] }, phase: { label: "Lane" } },
            initial: { flow: ["Parcels"] },
        },
        transitions: {
            source: Data.bindPaged(ex.depotTransitions, { indexes: ["flowchart_transitions_by_flow"] }),
            fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
            initial: { flow: ["Parcels"] },
        },
        stepCards: { source: Data.bindPaged(ex.stepCards, { indexes: ["flowchart_step_cards_by_group"] }), fields: { group: { label: "Group" } } },
        moveCards: { source: Data.bindPaged(ex.moveCards, { indexes: ["flowchart_move_cards_by_group"] }), fields: { group: { label: "Group" } } },
        laneCards: { source: Data.bindPaged(ex.laneCards, { indexes: ["flowchart_lane_cards_by_group"] }), fields: { group: { label: "Group" } } },
    }));
    return {
        slice: { slice },
        states: Flowchart.states(states, {
            name: "State", icon: "circle-nodes", entries: stateEntries, label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
            templates: Flowchart.templates(steps.read(), { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards" }),
        }),
        transitions: Flowchart.transitions(transitions, {
            name: "Transition", icon: "arrow-right-long", entries: transitionEntries, from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind,
            templates: Flowchart.templates(moves.read(), { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "moveCards" }),
        }),
        lanes: Flowchart.lanes(lanes, {
            label: "label", order: "seq",
            templates: Flowchart.templates(laneRows.read(), { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "laneCards" }),
        }),
        decisions: Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) }),
        library: [
            Flowchart.library.states(), Flowchart.library.transitions(), Flowchart.library.lanes(),
            Flowchart.library.tab(owners.read(), {
                name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
                drop: (o) => Flowchart.patch(ex.DepotDecision, { owner: o.name }),
            }),
        ],
        readOnly: true,
        name: "depot",
    };
};

/**
 * The depot as `flowchartDepot` builds it, its states and transitions edited
 * through their patch doors, its library the example's and an author's two:
 * the Slots tab, onto a state, its count of slots; and the Names tab, onto a
 * lane's header, its name.
 */
const authorsDepot = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const states = $.let(Record.bind(ex.depotStates));
    const stateEntries = $.let(Data.bindPaged(ex.depotStates));
    const transitions = $.let(Record.bind(ex.depotTransitions));
    const transitionEntries = $.let(Data.bindPaged(ex.depotTransitions));
    const lanes = $.let(Record.bind(ex.depotLanes));
    const decisions = $.let(Record.bind(ex.depotDecisions));
    const steps = $.let(Data.bind(ex.stepCards));
    const moves = $.let(Data.bind(ex.moveCards));
    const laneRows = $.let(Data.bind(ex.laneCards));
    const owners = $.let(Data.bind(ex.decisionOwners));
    const slots = $.const(new SortedMap([["twelve", { label: "12 slots", slots: some(12n) }]], compareString), DictType(StringType, SlotRow));
    const names = $.const(new SortedMap([["sortation", { label: "Sortation" }]], compareString), DictType(StringType, NameRow));
    const slice = $.let(Slice.bindRecords("flowchart.depot", {
        states: {
            source: Data.bindPaged(ex.depotStates, { indexes: ["flowchart_states_by_flow", "flowchart_states_by_lane"] }),
            fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] }, phase: { label: "Lane" } },
            initial: { flow: ["Parcels"] },
        },
        transitions: {
            source: Data.bindPaged(ex.depotTransitions, { indexes: ["flowchart_transitions_by_flow"] }),
            fields: { flow: { label: "Flow", hints: ["Parcels", "Returns"] } },
            initial: { flow: ["Parcels"] },
        },
        stepCards: { source: Data.bindPaged(ex.stepCards, { indexes: ["flowchart_step_cards_by_group"] }), fields: { group: { label: "Group" } } },
        moveCards: { source: Data.bindPaged(ex.moveCards, { indexes: ["flowchart_move_cards_by_group"] }), fields: { group: { label: "Group" } } },
        laneCards: { source: Data.bindPaged(ex.laneCards, { indexes: ["flowchart_lane_cards_by_group"] }), fields: { group: { label: "Group" } } },
    }));
    return {
        slice: { slice },
        states: Flowchart.states(states, {
            name: "State", icon: "circle-nodes", entries: stateEntries, label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
            templates: Flowchart.templates(steps.read(), { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards" }),
        }),
        transitions: Flowchart.transitions(transitions, {
            name: "Transition", icon: "arrow-right-long", entries: transitionEntries, from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind,
            templates: Flowchart.templates(moves.read(), { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "moveCards" }),
        }),
        lanes: Flowchart.lanes(lanes, {
            label: "label", order: "seq",
            templates: Flowchart.templates(laneRows.read(), { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "laneCards" }),
        }),
        decisions: Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) }),
        library: [
            Flowchart.library.states(), Flowchart.library.transitions(), Flowchart.library.lanes(),
            Flowchart.library.tab(owners.read(), {
                name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
                drop: (o) => Flowchart.patch(ex.DepotDecision, { owner: o.name }),
            }),
            Flowchart.library.tab(slots, {
                name: "Slots", icon: "table-cells", label: (r) => r.label, drop: (r) => Flowchart.patch(ex.DepotState, { slots: r.slots }),
            }),
            Flowchart.library.tab(names, {
                name: "Names", icon: "tag", label: (r) => r.label, drop: (r) => Flowchart.patch(ex.DepotLane, { label: r.label }),
            }),
        ],
        name: "depot",
    };
};

/** The depot as the example shows it, under the page's drag layer. */
const mountDepot = () => h.mountExample(ex.flowchartDepot, { drag: true, storageKey: "flowchart.drop" });

/** A depot of the test's own, under the page's drag layer. */
const mountOwn = (depot: ($: BlockBuilder<UIComponentType>) => FlowchartTestProps) => h.mountFlowchart(depot, { drag: true, storageKey: "flowchart.drop" });

// ── Reading the flowchart ────────────────────────────────────────────────

/** A decision's diamond, where the canvas draws it: the middle of the transition it governs. */
function diamondOf(c: HTMLElement, key: string): { x: number; y: number } {
    const transform = c.querySelector(`[data-flowchart-trigger="${key}"]`)!.getAttribute("transform")!;
    const [, x, y] = /translate\(([^,]+),([^)]+)\)/.exec(transform)!;
    return { x: parseFloat(x!), y: parseFloat(y!) };
}
/** A transition's line as the canvas draws it: the path under the one a pointer takes. */
const lineOf = (c: HTMLElement, key: string): Element => c.querySelector(`[data-flowchart-link="${key}"]`)!.previousElementSibling!;
/** The lanes' headers, as the canvas writes them. */
const laneHeads = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-lane]")].map((el) => el.textContent);
const pending = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-pending]")?.textContent ?? null;
/** What the footer says of the changes waiting on Save. */
const pendingSays = (n: number): string => ` · ${m.footerPending({ n, count: n.toLocaleString("en-US") })}`;
const footerMessage = (c: HTMLElement): string => c.querySelector("[data-flowchart-message]")?.textContent ?? "";
/** The canvas's drop cell: the box its drawing stands in. */
const cell = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-frame-slot='main'] [data-drag-cell]")!;
const pane = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-frame-slot='start']")!;
/** What the drag leaves marked on the canvas: a lane's wash, a landing line, a gap's line, a transition's wash, a target. */
const MARKS = "[data-flowchart-droplane], [data-flowchart-landing], [data-flowchart-gap], [data-flowchart-dropwash], [data-drop-target]";
/** The states' details read by key: a row's search, its page and the rows themselves. */
const EVIDENCE = `records.${ex.stateEvidence.name}`;
const evidenceRead = (request: E3Request): boolean => request.dataset === EVIDENCE && (request.kind === "rows" || request.kind === "find" || request.kind === "page");

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

/** Selects what a click on it selects, and lets the flowchart settle. */
async function click(target: Element): Promise<void> {
    await act(async () => { fireEvent.click(target); });
    await settle();
}

// ── Dragging ──────────────────────────────────────────────────────────────

/** The canvas laid out at the client origin, larger than its drawing. */
const BOX = { left: 0, top: 0, width: 4000, height: 4000 };

/** Picks a card up with the mouse: held down, and carried past the 4px a drag starts after. */
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

/** Carries a card to a point of the canvas and drops it there. */
async function dropAt(c: HTMLElement, card: HTMLElement, at: { x: number; y: number }): Promise<void> {
    pickUp(card);
    restOn(c, at);
    await release(at);
}

/** What the ghost says: its caption, and whether it says why not — `null` while the ghost goes alone. */
const caption = () => {
    const el = document.querySelector("[data-drag-caption]");
    return el === null ? null : { text: el.textContent, refused: el.hasAttribute("data-refused") };
};

/** ⏎ on a card, as the keyboard gives it. */
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

// ============================================================================
// A state's card onto a lane, a lane's card between the lanes (R14)
// ============================================================================

describe("a state's card dropped on a lane (R14)", () => {
    test("lands at the row under the pointer, after the states above it: the ghost says where, the lane takes its wash and the landing line is drawn where it lands; dropped, a state is added from the card's values, keyed state-<n> and ordered between its neighbours, and selected — one transaction, one Undo taking it back — and Save commits it through the states' patch door alone", async () => {
        const { container } = await mountDepot();
        const deployed = { states: await h.read(ex.depotStates), stateCommits: await h.commits(ex.depotStates), transitionCommits: await h.commits(ex.depotTransitions) };
        await openTab(container, m.libraryTab({ tab: "states" }));
        // In intake: between ARV and SCN, where ARV → SCN's line passes too; above ARV's middle; and past the lanes.
        const [at, top, past] = [between(container, "ARV", "SCN"), topOf(container, "ARV"), tail(container)];
        const [intake, arv, head, first] = [bandOf(container, "intake"), cardBox(container, "ARV"), headOf(container, "intake"), rowsOf(container)[0]!];
        pickUp(cardOf(container, "desk"));
        // Picked up, over nothing: the ghost alone.
        expect(caption()).toBeNull();
        restOn(container, at);
        expect(caption()).toEqual({ text: "after ARV in Intake", refused: false });
        expect(cell(container).hasAttribute("data-drop-active")).toBe(true);
        // The intake lane's band, washed.
        const wash = container.querySelector<HTMLElement>("[data-flowchart-droplane]")!;
        expect([wash.getAttribute("data-flowchart-droplane"), wash.style.left, wash.style.top, wash.style.width]).toEqual(["intake", `${intake.x}px`, `${intake.y}px`, `${intake.w}px`]);
        // Between ARV and SCN, across the state's footprint, in the middle of the gap.
        const line = container.querySelector<HTMLElement>("[data-flowchart-landing]")!;
        expect([line.getAttribute("data-flowchart-landing"), line.style.left, line.style.top, line.style.width, line.style.height]).toEqual(["1", `${arv.x}px`, `${at.y}px`, `${arv.w}px`, ""]);
        // Above ARV's middle: before it, the line in the middle of the gap under the lane's header.
        restOn(container, top);
        expect(caption()).toEqual({ text: "at the start of Intake", refused: false });
        const start = container.querySelector<HTMLElement>("[data-flowchart-landing]")!;
        expect([start.getAttribute("data-flowchart-landing"), start.style.top]).toEqual(["0", `${(head.y + head.h + first.start) / 2}px`]);
        // The + LANE tail is no lane: refused, red.
        restOn(container, past);
        expect(caption()).toEqual({ text: "Drop onto a lane", refused: true });
        expect(cell(container).hasAttribute("data-drop-invalid")).toBe(true);
        restOn(container, at);
        await release(at);
        expect([drawnUnder(container, "state-11", "ARV"), drawnUnder(container, "SCN", "state-11")]).toEqual([true, true]);
        expect(node(container, "state-11").hasAttribute("data-selected")).toBe(true);
        expect(announced()).toBe("Exception desk was dropped on Intake, after ARV.");
        // The drag over, nothing stays marked.
        expect(container.querySelector(MARKS)).toBeNull();
        expect(pending(container)).toBe(pendingSays(1));
        // One transaction: one Undo takes it back whole.
        const added = stateKeys(container);
        await press(UNDO);
        expect([container.querySelector("[data-flowchart-node='state-11']"), drawnUnder(container, "SCN", "ARV"), enabled(UNDO)]).toEqual([null, true, false]);
        await press(REDO);
        expect(stateKeys(container)).toEqual(added);
        await press(SAVE);
        // Its card's values, in intake, its order between ARV's 1 and SCN's 2.
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(withRows(deployed.states, [["state-11", desk("intake", 1.5)]])));
        expect([await h.commits(ex.depotStates), await h.commits(ex.depotTransitions)]).toEqual([["patch", ...deployed.stateCommits], deployed.transitionCommits]);
    });

    test("each state it adds is keyed state-<n>, the next number no state holds; a lane's card at the tail adds a lane at the end of the lanes, and in a lane holding no state a state's card lands in its first row — four drops, four transactions", async () => {
        const { container } = await mountDepot();
        const deployed = { states: await h.read(ex.depotStates), lanes: await h.read(ex.depotLanes) };
        await openTab(container, m.libraryTab({ tab: "states" }));
        // Under hold's two states: after CLR, and then, under it, after the state the first drop added.
        for (const _ of [1, 2]) await dropAt(container, cardOf(container, "desk"), under(container, "hold"));
        expect([drawnUnder(container, "state-11", "CLR"), drawnUnder(container, "state-12", "state-11")]).toEqual([true, true]);
        // A lane's card at the tail: its line down the gap past the last lane.
        await openTab(container, m.libraryTab({ tab: "lanes" }));
        const [past, dispatch] = [tail(container), bandOf(container, "dispatch")];
        pickUp(cardOf(container, "check"));
        restOn(container, past);
        expect(caption()).toEqual({ text: "at the end of the lanes", refused: false });
        const gap = container.querySelector<HTMLElement>("[data-flowchart-gap]")!;
        expect([gap.getAttribute("data-flowchart-gap"), gap.style.left, gap.style.top]).toEqual(["5", `${dispatch.x + dispatch.w}px`, "0px"]);
        await release(past);
        expect(laneHeads(container)).toContain("QUALITY CHECK");
        expect(announced()).toBe("Quality check was dropped on the end of the lanes.");
        // The new lane holds no state: a state's card lands in its first row.
        await openTab(container, m.libraryTab({ tab: "states" }));
        const quality = middleOf(bandOf(container, "lane-6"));
        pickUp(cardOf(container, "scan"));
        restOn(container, quality);
        expect(caption()).toEqual({ text: "in Quality check", refused: false });
        await release(quality);
        expect([laneOf(container, "state-13"), rowOf(container, "state-13")]).toEqual(["lane-6", 0]);
        // Four drops, four transactions.
        const dropped = stateKeys(container);
        for (let i = 0; i < 4; i++) await press(UNDO);
        expect([container.querySelector("[data-flowchart-node^='state-']"), laneHeads(container).includes("QUALITY CHECK"), enabled(UNDO)]).toEqual([null, false, false]);
        for (let i = 0; i < 4; i++) await press(REDO);
        expect(stateKeys(container)).toEqual(dropped);
        await press(SAVE);
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(withRows(deployed.states, [
            ["state-11", desk("hold", 3)],
            ["state-12", desk("hold", 4)],
            ["state-13", { name: "Scan point", phase: "lane-6", seq: 1, slots: none, flow: "Parcels" }],
        ])));
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(withRows<Lane>(deployed.lanes, [["lane-6", { label: "Quality check", seq: 6 }]])));
    });

    test("a read-only flowchart refuses every drop — a state's card on a lane, a transition's on a transition — the ghost saying why, and dropping changes nothing; ⏎ on a card is refused, the footer saying why", async () => {
        const { container } = await mountOwn(readOnlyDepot);
        const shown = stateKeys(container);
        const at = between(container, "ARV", "SCN");
        await openTab(container, m.libraryTab({ tab: "states" }));
        pickUp(cardOf(container, "desk"));
        restOn(container, at);
        expect(caption()).toEqual({ text: "States are read only", refused: true });
        expect(container.querySelector(MARKS)).toBeNull();
        await release(at);
        expect(stateKeys(container)).toEqual(shown);
        expect(announced()).toBe("Exception desk was not dropped.");
        await enter(cardOf(container, "desk"));
        expect([stateKeys(container), footerMessage(container)]).toEqual([shown, "States are read only"]);
        // A transition's card on a transition: no wash, and the transition keeps its kind — planned, solid.
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        pickUp(cardOf(container, "reroute"));
        restOn(container, at);
        expect(caption()).toEqual({ text: "Transitions are read only", refused: true });
        expect(container.querySelector(MARKS)).toBeNull();
        await release(at);
        expect(announced()).toBe("Observed reroute was not dropped.");
        expect(lineOf(container, "l1").hasAttribute("stroke-dasharray")).toBe(false);
    });
});

// ============================================================================
// A drag over the canvas
// ============================================================================

describe("a card carried over the canvas", () => {
    test("raises no dimming and no + STATE ghost — picked up while the pointer rests on a state, it lets go of that state's dimming; the drag over, each comes back", async () => {
        const { container } = await mountDepot();
        const ghost = () => container.querySelector("[data-flowchart-ghoststate]")?.getAttribute("data-flowchart-ghoststate") ?? null;
        /** CH*'s opacity: no transition joins it to ARV, so the pointer on ARV dims it. */
        const chutes = () => node(container, "CH*").style.opacity;
        await openTab(container, m.libraryTab({ tab: "states" }));
        // At rest: the pointer on ARV dims CH*.
        act(() => { fireEvent.pointerEnter(node(container, "ARV")); });
        expect(chutes()).toBe("0.45");
        // A card picked up: ARV lets go of its dimming.
        pickUp(cardOf(container, "desk"));
        expect(chutes()).toBe("1");
        // Carried over the canvas: a state dims nothing; a lane raises no ghost.
        act(() => { fireEvent.pointerEnter(node(container, "ARV")); });
        act(() => { fireEvent.pointerEnter(container.querySelector("[data-flowchart-band='hold']")!); });
        expect([chutes(), ghost()]).toEqual(["1", null]);
        // The drag over: the lane under the pointer shows its ghost, and a state its dimming.
        const past = tail(container);
        restOn(container, past);
        await release(past);
        expect(ghost()).toBe("hold");
        act(() => { fireEvent.pointerEnter(node(container, "ARV")); });
        expect(chutes()).toBe("0.45");
        // No hover card ever: the inspector shows what is selected.
        expect(container.querySelector("[data-flowchart-hovercard]")).toBeNull();
    });
});

// ============================================================================
// A transition's card onto a transition (R14)
// ============================================================================

describe("a transition's card dropped on a transition (R14)", () => {
    test("gives it the card's values, its ends kept — the transition taking the brand wash while the drag rests on it; anywhere else refused: Drop onto a transition", async () => {
        const { container } = await mountDepot();
        const deployed = await h.read(ex.depotTransitions);
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        pickUp(cardOf(container, "reroute"));
        restOn(container, centreOf(container, "CH*"));
        expect(caption()).toEqual({ text: "Drop onto a transition", refused: true });
        expect(container.querySelector("[data-flowchart-dropwash]")).toBeNull();
        // ARV → SCN's line passes between the two states.
        const at = between(container, "ARV", "SCN");
        restOn(container, at);
        expect(caption()).toEqual({ text: "onto ARV → SCN", refused: false });
        const wash = container.querySelector("[data-flowchart-dropwash]")!;
        expect([wash.getAttribute("data-flowchart-dropwash"), wash.getAttribute("d")])
            .toEqual(["l1", container.querySelector('[data-flowchart-link="l1"]')!.getAttribute("d")]);
        await release(at);
        expect(announced()).toBe("Observed reroute was dropped on ARV → SCN.");
        expect(container.querySelector("[data-flowchart-dropwash]")).toBeNull();
        // Observed now: its line dashed.
        expect(lineOf(container, "l1").getAttribute("stroke-dasharray")).toBe("5 4");
        expect(pending(container)).toBe(pendingSays(1));
        await press(UNDO);
        expect([pending(container), lineOf(container, "l1").hasAttribute("stroke-dasharray")]).toEqual([pendingSays(0), false]);
        await press(REDO);
        await press(SAVE);
        expect(printTransitions(await h.read(ex.depotTransitions))).toBe(printTransitions(withRows(deployed, [["l1", REROUTED]])));
    });
});

// ============================================================================
// An author's cards (R14)
// ============================================================================

describe("an author's card lands where its drop's type says (R14)", () => {
    test("on a decision's diamond, a state and a lane's header — each taking the brand while the drag rests there — setting its fields; refused elsewhere, naming where it lands; each one transaction", async () => {
        const { container } = await mountOwn(authorsDepot);
        const deployed = { states: await h.read(ex.depotStates), lanes: await h.read(ex.depotLanes), decisions: await h.read(ex.depotDecisions) };
        const diamond = diamondOf(container, "route");
        // The owner: onto the route decision's diamond.
        await openTab(container, "Owners");
        pickUp(cardOf(container, "ns"));
        restOn(container, centreOf(container, "CH*"));
        expect(caption()).toEqual({ text: "Drop onto a decision", refused: true });
        restOn(container, diamond);
        expect(caption()).toEqual({ text: "onto decision route", refused: false });
        expect(container.querySelector('[data-flowchart-trigger="route"]')!.hasAttribute("data-drop-target")).toBe(true);
        await release(diamond);
        expect(container.querySelector("[data-drop-target]")).toBeNull();
        // The slots: onto a state.
        const [sortHead, sortBody] = [headerOf(container, "sort"), under(container, "sort")];
        await openTab(container, "Slots");
        pickUp(cardOf(container, "twelve"));
        restOn(container, sortHead);
        expect(caption()).toEqual({ text: "Drop onto a state", refused: true });
        restOn(container, centreOf(container, "CH*"));
        expect(caption()).toEqual({ text: "onto CH*", refused: false });
        expect(node(container, "CH*").hasAttribute("data-drop-target")).toBe(true);
        await release(centreOf(container, "CH*"));
        // The name: onto the sort lane's header, the lane washed and no landing line.
        await openTab(container, "Names");
        pickUp(cardOf(container, "sortation"));
        restOn(container, sortBody);
        expect(caption()).toEqual({ text: "Drop onto a lane's header", refused: true });
        restOn(container, sortHead);
        expect(caption()).toEqual({ text: "onto lane Sort", refused: false });
        expect([container.querySelector("[data-flowchart-droplane]")!.getAttribute("data-flowchart-droplane"), container.querySelector("[data-flowchart-landing]")])
            .toEqual(["sort", null]);
        await release(sortHead);
        expect(laneHeads(container).slice(0, 5)).toEqual(["INTAKE", "INDUCT", "SORTATION", "HOLD", "DISPATCH"]);
        // Three drops, three transactions.
        for (let i = 0; i < 3; i++) await press(UNDO);
        expect(enabled(UNDO)).toBe(false);
        for (let i = 0; i < 3; i++) await press(REDO);
        await press(SAVE);
        expect(printDecisions(await h.read(ex.depotDecisions))).toBe(printDecisions(withRows<Decision>(deployed.decisions, [["route", { name: "route", owner: "night-supervisor" }]])));
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(withRows(deployed.states, [["CH*", { ...deployed.states.get("CH*")!, slots: some(12n) }]])));
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(withRows(deployed.lanes, [["sort", { label: "Sortation", seq: 3 }]])));
    });
});

// ============================================================================
// ⏎ on a card, and a tap on a touch screen (R14)
// ============================================================================

describe("⏎ on a card drops it on the canvas's selection (R14)", () => {
    test("a state's card after the selected state, in its lane, selected — never picked up; a card the selection takes no such drop of is refused, the footer saying why, until a drop lands", async () => {
        const { container } = await mountDepot();
        const deployed = { states: await h.read(ex.depotStates), transitions: await h.read(ex.depotTransitions), decisions: await h.read(ex.depotDecisions) };
        await click(node(container, "SCN"));
        await openTab(container, m.libraryTab({ tab: "states" }));
        const card = cardOf(container, "desk");
        await enter(card);
        // After the lane's last state: drawn in intake under SCN.
        expect(drawnUnder(container, "state-11", "SCN")).toBe(true);
        expect(node(container, "state-11").hasAttribute("data-selected")).toBe(true);
        expect(card.hasAttribute("data-dragging")).toBe(false);
        // The new state selected: a transition's card has no transition to give its values.
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        await enter(cardOf(container, "reroute"));
        expect(footerMessage(container)).toBe("Drop onto a transition");
        expect(pending(container)).toBe(pendingSays(1));
        // A transition selected: it takes the card's values, and the footer's line goes.
        await click(container.querySelector('[data-flowchart-link="l1"]')!);
        await enter(cardOf(container, "reroute"));
        expect(footerMessage(container)).toBe("");
        expect(pending(container)).toBe(pendingSays(2));
        // The diamond selected: an owner's card sets its owner.
        await click(container.querySelector('[data-flowchart-trigger="route"]')!);
        await openTab(container, "Owners");
        await enter(cardOf(container, "ns"));
        expect(pending(container)).toBe(pendingSays(3));
        // Three drops, three transactions; Save commits each record's.
        await press(SAVE);
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(withRows(deployed.states, [["state-11", desk("intake", 3)]])));
        expect(printTransitions(await h.read(ex.depotTransitions))).toBe(printTransitions(withRows(deployed.transitions, [["l1", REROUTED]])));
        expect(printDecisions(await h.read(ex.depotDecisions))).toBe(printDecisions(withRows<Decision>(deployed.decisions, [["route", { name: "route", owner: "night-supervisor" }]])));
    });

    test("a lane's header card lands on the lane a click on its header selected: with a state selected it is refused, the footer saying why; with the lane, it names the lane, one transaction", async () => {
        const { container } = await mountOwn(authorsDepot);
        const deployed = await h.read(ex.depotLanes);
        await openTab(container, "Names");
        // A state selected: no lane's header to set the name on.
        await click(node(container, "SCN"));
        await enter(cardOf(container, "sortation"));
        expect(footerMessage(container)).toBe("Drop onto a lane's header");
        // The sort lane's header clicked: the lane selected, and ⏎ names it.
        await click(container.querySelector("[data-flowchart-lane='sort']")!);
        expect(container.querySelector("[data-flowchart-lane-selected]")!.getAttribute("data-flowchart-lane-selected")).toBe("sort");
        await enter(cardOf(container, "sortation"));
        expect(laneHeads(container).slice(0, 5)).toEqual(["INTAKE", "INDUCT", "SORTATION", "HOLD", "DISPATCH"]);
        expect([footerMessage(container), pending(container)]).toEqual(["", pendingSays(1)]);
        await press(SAVE);
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(withRows(deployed, [["sort", { label: "Sortation", seq: 3 }]])));
    });

    test("with a lane selected, a state's card lands at the end of that lane", async () => {
        const { container } = await mountDepot();
        await click(container.querySelector("[data-flowchart-lane='hold']")!);
        await openTab(container, m.libraryTab({ tab: "states" }));
        await enter(cardOf(container, "desk"));
        // The hold lane, the fourth: its third row, under HLD and CLR.
        expect([laneOf(container, "state-11"), rowOf(container, "state-11"), drawnUnder(container, "state-11", "CLR")]).toEqual(["hold", 2, true]);
        expect(node(container, "state-11").hasAttribute("data-selected")).toBe(true);
    });

    test("with nothing selected, a state's card lands at the end of the first lane; after a state between two others, between them", async () => {
        const { container } = await mountDepot();
        await openTab(container, m.libraryTab({ tab: "states" }));
        await enter(cardOf(container, "desk"));
        expect(drawnUnder(container, "state-11", "SCN")).toBe(true);
        expect(node(container, "state-11").hasAttribute("data-selected")).toBe(true);
        // ARV selected: after it, before SCN.
        await click(node(container, "ARV"));
        await enter(cardOf(container, "desk"));
        expect([drawnUnder(container, "state-12", "ARV"), drawnUnder(container, "SCN", "state-12"), drawnUnder(container, "state-11", "SCN")]).toEqual([true, true, true]);
    });

    test("⏎ scrolls the state it adds to the middle of the canvas's view once its card's details land, at the height it then takes; a state dropped where the pointer is leaves the view where it stands", async () => {
        const { container } = await mountDepot();
        const scroll = container.querySelector<HTMLElement>("[data-flowchart-scroll]")!;
        /** A state's middle: where a view of jsdom's 0×0 scrolls to, to hold it in its middle. */
        const middle = (key: string) => { const at = centreOf(container, key); return [at.x, at.y]; };
        /** Whether a state's card draws a placeholder where its reads go, and whether it says no data. */
        const reads = (key: string) => [node(container, key).querySelector("[data-place]") !== null, node(container, key).querySelector("[data-card-empty]") !== null];
        await openTab(container, m.libraryTab({ tab: "states" }));
        await dropAt(container, cardOf(container, "desk"), under(container, "hold"));
        expect(node(container, "state-11").hasAttribute("data-selected")).toBe(true);
        expect([scroll.scrollLeft, scroll.scrollTop]).toEqual([0, 0]);
        // ⏎, its details' row held on its way: the new state selected, the next after it in hold's next row, its
        // card a placeholder where its reads go — and the view waits for them.
        const read = h.e3.hold(evidenceRead);
        await enter(cardOf(container, "desk"));
        expect(drawnUnder(container, "state-12", "state-11")).toBe(true);
        expect(node(container, "state-12").hasAttribute("data-selected")).toBe(true);
        expect([read.held > 0, reads("state-12"), scroll.scrollLeft, scroll.scrollTop]).toEqual([true, [true, false], 0, 0]);
        // Its row landed — it has none, so no data — the card takes its height, and the view brings it to its middle.
        read.release();
        await settle();
        expect([reads("state-12"), [scroll.scrollLeft, scroll.scrollTop]]).toEqual([[false, true], middle("state-12")]);
    });

    test("on a touch screen a tap on the selected card does what ⏎ does, and leaves it selected — a tap on another card only moves the selection; on a fine pointer a second click lets it go, and drops nothing", async () => {
        const restore = touchScreen();
        try {
            const { container } = await mountDepot();
            const shown = stateKeys(container);
            await click(node(container, "SCN"));
            await openTab(container, m.libraryTab({ tab: "states" }));
            const tap = (key: string) => click(cardOf(container, key));
            const placed = () => ["scan", "chutes", "desk"].filter((key) => cardOf(container, key).hasAttribute("data-placed"));
            // The first tap selects a card; a tap on another moves the selection: nothing dropped yet.
            await tap("desk");
            expect([placed(), stateKeys(container)]).toEqual([["desk"], shown]);
            await tap("scan");
            expect([placed(), stateKeys(container)]).toEqual([["scan"], shown]);
            // A tap on the selected card drops it after the selected state, and leaves it selected.
            await tap("scan");
            expect(placed()).toEqual(["scan"]);
            expect(drawnUnder(container, "state-11", "SCN")).toBe(true);
        } finally {
            restore();
        }
        // On a fine pointer, in a tab of its own: nothing kept from the touch screen's drop.
        reloadPage();
        sessionStorage.clear();
        const fine = await mountDepot();
        const shown = stateKeys(fine.container);
        await openTab(fine.container, m.libraryTab({ tab: "states" }));
        for (const _ of [1, 2]) await click(cardOf(fine.container, "desk"));
        expect([cardOf(fine.container, "desk").hasAttribute("data-placed"), stateKeys(fine.container)]).toEqual([false, shown]);
        expect(fine.container.querySelector("[data-flowchart-node='state-11']")).toBeNull();
    });
});
