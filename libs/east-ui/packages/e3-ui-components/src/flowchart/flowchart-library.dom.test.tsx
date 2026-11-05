/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The library pane (#1501, `Flowchart Records Spec.md` R14, D5, D8), over the
 * depot's records on e3 itself: the tabs `library` lists, in its order, each
 * with its count, and no pane when it lists none — and no Flows tab, the
 * Flowchart drawing one flowchart; the rail's count, the first tab's; each
 * kind's cards — the Steps, Transitions and Lanes tabs, named in the
 * flowchart's words unless the author names them — and an author's: its name,
 * the line under it, the tab's icon or the kind's, grouped by their group;
 * each kind's card a drag source, and an author's when its tab declares a
 * drop; a click selecting a card and a second letting it go; the search; every
 * empty state; each tab following its own source of the rail, a kind's and an
 * author's alike; each tab its own bound data, apart from the flowchart's
 * drafts and from the other tabs; and each kind's card, and an author's,
 * dropped on the canvas and saved on e3.
 *
 * Each kind's cards are a record of their own, read whole beside their source
 * of the flowchart's one `Slice.bindRecords`, which the tab follows by its
 * cards' keys. What a drop does where it lands, step by step, is
 * `flowchart-drop.dom.test.tsx`'s; the drop's logic is `drop.test.ts`'s.
 *
 * jsdom lays nothing out. Each tab's Library alone is measured, as the e3
 * harness measures it, so its virtualizer lays out its cards; the canvas
 * measures 0×0, and each point a card is dropped at is read from where it
 * draws the depot (`drawn.test-utils.ts`).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import {
    DictType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, some, variant,
    type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceStateType, Slice, type UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages } from "@elaraai/east-ui-components";
import { announced, layOut, pointAt } from "@elaraai/east-ui-components/testing";
import { Data, Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { reloadPage } from "../e3-web-mount.test-utils.js";
import { between, gapBefore } from "./drawn.test-utils.js";
import { act, enabled, flowchartHarness, press, settle, type FlowchartTestProps } from "./flowchart.test-utils.js";
import { measureLibrary } from "./library-measure.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness();
measureLibrary();

const m = flowchartMessages;
const SAVE = editingMessages.apply();
const compareString = compareFor(StringType);

// ── The depot's records, as e3 holds them ────────────────────────────────

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

// ── The depot's flowchart, built over its records ────────────────────────

/**
 * The depot as `flowchartDepot` builds it — its states and transitions read
 * through their sources and edited through their patch doors, the parcels'
 * flow shown; its lanes and decisions read whole; each kind's cards a record
 * of their own — with a library of its own, in another order: the Lanes tab;
 * the example's Owners tab, a card dropped on a decision's diamond making its
 * owner the decision's; the Steps tab named Step cards, with an icon of its
 * own; the Transitions tab; an author's Desks tab, which declares no drop; and
 * an author's Step names tab over the states' cards record, following its
 * source, a card dropped on a state naming it as the card does.
 */
const ownLibraryDepot = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
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
            Flowchart.library.lanes(),
            Flowchart.library.tab(owners.read(), {
                name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
                drop: (o) => Flowchart.patch(ex.DepotDecision, { owner: o.name }),
            }),
            Flowchart.library.states({ name: "Step cards", icon: "box" }),
            Flowchart.library.transitions(),
            Flowchart.library.tab(owners.read(), { name: "Desks", label: (o) => o.desk }),
            Flowchart.library.tab(steps.read(), {
                name: "Step names", icon: "tag", source: "stepCards", label: (c) => c.name,
                drop: (c) => Flowchart.patch(ex.DepotState, { name: c.values.name }),
            }),
        ],
        name: "depot",
    };
};

/** Each kind's cards none, as its record holding no row reads. */
const NO_STEP_CARDS: ValueTypeOf<DictType<StringType, typeof ex.StepCard>> = new SortedMap([], compareString);
const NO_MOVE_CARDS: ValueTypeOf<DictType<StringType, typeof ex.MoveCard>> = new SortedMap([], compareString);
const NO_LANE_CARDS: ValueTypeOf<DictType<StringType, typeof ex.LaneCard>> = new SortedMap([], compareString);

/** The depot with each kind's cards none — each list still following its source — and the example's library. */
const bareDepot = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const states = $.let(Record.bind(ex.depotStates));
    const stateEntries = $.let(Data.bindPaged(ex.depotStates));
    const transitions = $.let(Record.bind(ex.depotTransitions));
    const transitionEntries = $.let(Data.bindPaged(ex.depotTransitions));
    const lanes = $.let(Record.bind(ex.depotLanes));
    const decisions = $.let(Record.bind(ex.depotDecisions));
    // Each kind's cards none: each list still follows its source.
    const steps = $.const(NO_STEP_CARDS, DictType(StringType, ex.StepCard));
    const moves = $.const(NO_MOVE_CARDS, DictType(StringType, ex.MoveCard));
    const laneRows = $.const(NO_LANE_CARDS, DictType(StringType, ex.LaneCard));
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
            templates: Flowchart.templates(steps, { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "stepCards" }),
        }),
        transitions: Flowchart.transitions(transitions, {
            name: "Transition", icon: "arrow-right-long", entries: transitionEntries, from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind,
            templates: Flowchart.templates(moves, { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "moveCards" }),
        }),
        lanes: Flowchart.lanes(lanes, {
            label: "label", order: "seq",
            templates: Flowchart.templates(laneRows, { name: (c) => c.name, group: (c) => some(c.group), values: (c) => c.values, source: "laneCards" }),
        }),
        decisions: Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) }),
        library: [
            Flowchart.library.states(), Flowchart.library.transitions(), Flowchart.library.lanes(),
            Flowchart.library.tab(owners.read(), {
                name: "Owners", icon: "user-tie", label: (o) => o.name, meta: (o) => some(o.desk),
                drop: (o) => Flowchart.patch(ex.DepotDecision, { owner: o.name }),
            }),
        ],
        name: "depot",
    };
};

/** The depot's states in their lanes, the library left out. */
const unlistedDepot = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const states = $.let(Record.bind(ex.depotStates));
    const lanes = $.let(Record.bind(ex.depotLanes));
    return { states: Flowchart.states(states, { label: "name", lane: "phase", order: "seq" }), lanes: Flowchart.lanes(lanes, { label: "label", order: "seq" }) };
};

/** The depot's states in their lanes, the library listing no tab. */
const noTabsDepot = ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const states = $.let(Record.bind(ex.depotStates));
    const lanes = $.let(Record.bind(ex.depotLanes));
    return { states: Flowchart.states(states, { label: "name", lane: "phase", order: "seq" }), lanes: Flowchart.lanes(lanes, { label: "label", order: "seq" }), library: [] };
};

/** The depot as the example shows it, under the drag layer an app mounts once at its root. */
const mountDepot = () => h.mountExample(ex.flowchartDepot, { drag: true, storageKey: "flowchart.library" });

/** A depot of the test's own, under the drag layer. */
const mountOwn = (depot: ($: BlockBuilder<UIComponentType>) => FlowchartTestProps) => h.mountFlowchart(depot, { drag: true, storageKey: "flowchart.library" });

// ── Reading the library ──────────────────────────────────────────────────

/** The library pane. */
const pane = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-frame-slot='start']");

/** The pane's tabs, as their rows draw them: each its name and count. */
const tabs = (container: HTMLElement) => [...pane(container)!.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);

/** Opens a tab, by its name. */
async function openTab(container: HTMLElement, name: string) {
    const tab = [...pane(container)!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    await act(async () => { fireEvent.click(tab); });
    await settle();
}

/** The open tab's panel. */
const panel = (container: HTMLElement) => pane(container)!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** A panel's group heads: each label and its count. */
const heads = (container: HTMLElement) => [...panel(container).querySelectorAll("[data-library-head]")]
    .map((head) => [head.children[0]!.textContent, head.children[1]!.textContent]);

/** A card's body: its name and the line under it — the card's block that is neither its grip nor its icon's tile. */
const bodyOf = (card: Element) => [...card.children].find((el) => el.tagName === "DIV" && el.querySelector(":scope > svg") === null)!;

/** The open panel's cards, in order: each card's key, its name and the line under it, its icon, whether it drags, and whether it is selected. */
const cards = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")].map((card) => {
    const body = bodyOf(card);
    const tile = [...card.children].find((el) => el.tagName === "DIV" && el.querySelector(":scope > svg") !== null);
    const svg = tile?.querySelector("svg");
    return {
        key: card.getAttribute("data-library-item"),
        label: body.children[0]!.textContent,
        meta: body.children[1]?.textContent ?? null,
        icon: svg === undefined || svg === null ? null : `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`,
        drags: card.hasAttribute("data-draggable"),
        grip: card.querySelector("[data-drag-grip] svg")?.getAttribute("data-icon") ?? null,
        placed: card.hasAttribute("data-placed"),
    };
});

/** The open panel's cards' keys, in order. */
const cardKeys = (container: HTMLElement) => cards(container).map((c) => c.key);

/** A card of the open panel, by its key. */
const card = (container: HTMLElement, key: string) => panel(container).querySelector<HTMLElement>(`[data-library-item="${key}"]`)!;

/** Types in the open panel's search. */
async function search(container: HTMLElement, text: string) {
    await act(async () => { fireEvent.change(within(panel(container)).getByRole("textbox", { name: "Search library" }), { target: { value: text } }); });
}

/** The open panel's search box. */
const searchBox = (container: HTMLElement) => within(panel(container)).getByRole("textbox", { name: "Search library" }) as HTMLInputElement;

/** The open panel's empty state: its icon, its title and the line under it, or `null` while cards show. */
const emptyState = (container: HTMLElement) => {
    const empty = panel(container).querySelector<HTMLElement>("[data-library-empty]");
    if (empty === null) return null;
    const title = within(empty).getByRole("heading");
    const svg = empty.querySelector("svg");
    return [svg === null ? null : `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`, title.textContent, title.nextElementSibling?.textContent ?? null];
};

/** Collapses the pane to its rail, and reads the rail: its icon's place, its count and its name. */
async function collapse(container: HTMLElement) {
    await act(async () => { fireEvent.click(within(pane(container)!).getByRole("button", { name: `Collapse ${m.libraryPane()}` })); });
    await settle();
    const rail = pane(container)!.querySelector(`[title='${m.libraryPane()}']`)!;
    return { parts: [...rail.children].map((part) => part.textContent), icon: rail.querySelector("svg")!.getAttribute("data-icon") };
}

/** The lanes the canvas draws, by key, in their order. */
const laneKeys = (container: HTMLElement) => [...container.querySelectorAll("[data-flowchart-lane]")].map((el) => el.getAttribute("data-flowchart-lane"));

// ── The rail's narrowing, as the rail writes it ──────────────────────────

type Where = ValueTypeOf<typeof RecordSliceStateType>["where"];
const printString = printFor(StringType);

/** The rail's choice of the cards of one group. */
const inGroup = (group: string): Where => new SortedMap([["group", variant("values", [printString(group)])]], compareString);

/** Writes the narrowing of one of the depot's sources, as the rail does. */
async function narrow(source: string, where: Where) {
    const key = `flowchart.depot.${source}`;
    const store = StateRuntime.getStore();
    const state = decodeBeast2For(RecordSliceStateType)(store.read(key)!);
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)({ ...state, preset: none, where })); });
    await settle();
}

// ── Dropping a card on the canvas ────────────────────────────────────────

/** The canvas's drop cell, laid out at the client origin, larger than its drawing: a pointer's client point is the canvas's own. */
const cell = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>("[data-frame-slot='main'] [data-drag-cell]")!;
const BOX = { left: 0, top: 0, width: 4000, height: 4000 };

/** Carries a card to a point of the canvas with the mouse — held down, carried past the 4px a drag starts after — and drops it there. */
async function dropAt(container: HTMLElement, from: HTMLElement, at: { x: number; y: number }): Promise<void> {
    pointAt(null);
    act(() => { fireEvent.pointerDown(from, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }); });
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 6 }); });
    layOut(new Map([[cell(container), BOX]]));
    act(() => { fireEvent.pointerMove(document, { pointerId: 1, pointerType: "mouse", clientX: at.x, clientY: at.y }); });
    act(() => { fireEvent.pointerUp(document, { pointerId: 1, pointerType: "mouse", clientX: at.x, clientY: at.y }); });
    await settle();
}

/** A decision's diamond, where the canvas draws it: the middle of the transition it governs. */
function diamondOf(container: HTMLElement, key: string): { x: number; y: number } {
    const transform = container.querySelector(`[data-flowchart-trigger="${key}"]`)!.getAttribute("transform")!;
    const [, x, y] = /translate\(([^,]+),([^)]+)\)/.exec(transform)!;
    return { x: parseFloat(x!), y: parseFloat(y!) };
}

// ============================================================================
// The tabs (R14)
// ============================================================================

describe("the library's tabs (R14)", () => {
    test("the library holds the tabs `library` lists, in its order, each with its count — and no Flows tab, the Flowchart drawing one flowchart; collapsed, it is a rail with the first tab's count", async () => {
        const { container } = await mountDepot();
        expect(tabs(container)).toEqual([
            `${m.libraryTab({ tab: "states" })} 3`, `${m.libraryTab({ tab: "transitions" })} 3`, `${m.libraryTab({ tab: "lanes" })} 2`, "Owners 3",
        ]);
        // One flowchart: no tab lists flows, and nothing draws a flows tab's pane or its empty state.
        expect(container.querySelector("[data-flowchart-library='flows'], [data-flowchart-no-flows]")).toBeNull();
        expect(await collapse(container)).toEqual({ parts: ["", "3", m.libraryPane()], icon: "layer-group" });
    });

    test("in another order, the tabs follow it — a kind's tab taking the name and icon it is given — and the rail counts the first tab's cards", async () => {
        const { container } = await mountOwn(ownLibraryDepot);
        expect(tabs(container)).toEqual([
            `${m.libraryTab({ tab: "lanes" })} 2`, "Owners 3", "Step cards 3", `${m.libraryTab({ tab: "transitions" })} 3`, "Desks 3", "Step names 3",
        ]);
        await openTab(container, "Step cards");
        expect(cards(container).map((c) => c.icon)).toEqual(["fas box", "fas box", "fas box"]);
        expect((await collapse(container)).parts).toEqual(["", "2", m.libraryPane()]);
    });

    test("a library left out or empty draws no start pane; main and the footer are where they were", async () => {
        for (const depot of [unlistedDepot, noTabsDepot]) {
            reloadPage();
            const { container } = await mountOwn(depot);
            expect(pane(container)).toBeNull();
            expect(container.querySelector("[data-frame-slot='main'] [data-flowchart-canvas]")).not.toBeNull();
            expect(container.querySelector("[data-frame-slot='footer']")).not.toBeNull();
        }
    });
});

// ============================================================================
// Each tab's cards (R14, D5, D8)
// ============================================================================

describe("each tab's cards (R14, D5, D8)", () => {
    test("the Steps tab lists one card per row of the states' cards record, in its keys' order: its name, the states' icon, grouped by its group, each a drag source", async () => {
        const { container } = await mountDepot();
        // The groups in the order their first cards come: the chutes' key first.
        expect(heads(container)).toEqual([["Sort", "1"], ["Hold", "1"], ["Intake", "1"]]);
        expect(cards(container)).toEqual([
            { key: "chutes", label: "Sort chutes", meta: null, icon: "fas circle-nodes", drags: true, grip: "grip-vertical", placed: false },
            { key: "desk", label: "Exception desk", meta: null, icon: "fas circle-nodes", drags: true, grip: "grip-vertical", placed: false },
            { key: "scan", label: "Scan point", meta: null, icon: "fas circle-nodes", drags: true, grip: "grip-vertical", placed: false },
        ]);
    });

    test("the Transitions and Lanes tabs, named in the flowchart's words, list their kinds' cards, each a drag source", async () => {
        const { container } = await mountDepot();
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        expect(heads(container)).toEqual([["Kinds", "2"], ["Decisions", "1"]]);
        expect(cards(container)).toEqual([
            { key: "planned", label: "Planned", meta: null, icon: "fas arrow-right-long", drags: true, grip: "grip-vertical", placed: false },
            { key: "reroute", label: "Observed reroute", meta: null, icon: "fas arrow-right-long", drags: true, grip: "grip-vertical", placed: false },
            { key: "routed", label: "Routed by the sort plan", meta: null, icon: "fas arrow-right-long", drags: true, grip: "grip-vertical", placed: false },
        ]);
        await openTab(container, m.libraryTab({ tab: "lanes" }));
        expect(heads(container)).toEqual([["Lanes", "2"]]);
        expect(cards(container).map(({ key, label, drags }) => ({ key, label, drags }))).toEqual([
            { key: "check", label: "Quality check", drags: true },
            { key: "returns", label: "Returns", drags: true },
        ]);
    });

    test("an author's card is a drag source when its tab declares a drop; without one it is read, never dragged — no grip, no icon unless the tab gives one", async () => {
        const { container } = await mountOwn(ownLibraryDepot);
        await openTab(container, "Owners");
        expect(cards(container)).toEqual([
            { key: "cd", label: "customs-desk", meta: "Customs", icon: "fas user-tie", drags: true, grip: "grip-vertical", placed: false },
            { key: "ns", label: "night-supervisor", meta: "Night shift", icon: "fas user-tie", drags: true, grip: "grip-vertical", placed: false },
            { key: "sp", label: "sort-planner", meta: "Sort office", icon: "fas user-tie", drags: true, grip: "grip-vertical", placed: false },
        ]);
        await openTab(container, "Desks");
        expect(cards(container)).toEqual([
            { key: "cd", label: "Customs", meta: null, icon: null, drags: false, grip: null, placed: false },
            { key: "ns", label: "Night shift", meta: null, icon: null, drags: false, grip: null, placed: false },
            { key: "sp", label: "Sort office", meta: null, icon: null, drags: false, grip: null, placed: false },
        ]);
    });

    test("a click selects a card, a click on another moves the selection, and a click on the selected card lets it go — each tab its own selection", async () => {
        const { container } = await mountDepot();
        const placed = () => cards(container).flatMap((c) => (c.placed ? [c.key] : []));
        await act(async () => { fireEvent.click(card(container, "desk")); });
        expect(placed()).toEqual(["desk"]);
        await act(async () => { fireEvent.click(card(container, "chutes")); });
        expect(placed()).toEqual(["chutes"]);
        // Another tab's selection is its own: the steps' stays while an owner is picked.
        await openTab(container, "Owners");
        await act(async () => { fireEvent.click(card(container, "ns")); });
        expect(placed()).toEqual(["ns"]);
        await openTab(container, m.libraryTab({ tab: "states" }));
        expect(placed()).toEqual(["chutes"]);
        await act(async () => { fireEvent.click(card(container, "chutes")); });
        expect(placed()).toEqual([]);
        expect(panel(container).querySelector("[data-placed]")).toBeNull();
    });

    test("a tab's search reads a kind's card by its name and an author's by its key, label and line, its box counting the cards", async () => {
        const { container } = await mountDepot();
        expect(searchBox(container).placeholder).toBe(`Search 3 ${m.libraryNoun({ tab: "states", n: 3 })}…`);
        await search(container, "chutes");
        expect(cardKeys(container)).toEqual(["chutes"]);
        await search(container, "point");
        expect(cardKeys(container)).toEqual(["scan"]);
        await openTab(container, "Owners");
        expect(searchBox(container).placeholder).toBe(`Search 3 ${m.libraryNoun({ tab: "tab", n: 3 })}…`);
        await search(container, "night shift");
        expect(cardKeys(container)).toEqual(["ns"]);
        await search(container, "cd");
        expect(cardKeys(container)).toEqual(["cd"]);
    });
});

// ============================================================================
// An empty tab (R14)
// ============================================================================

describe("an empty tab says so (R14)", () => {
    test("in the shared empty state, with Font Awesome's open box: No cards for each kind's tab, Nothing in an author's tab, and No matches for a search that hides every card", async () => {
        await h.write(ex.decisionOwners, new SortedMap([], compareString));
        const { container } = await mountOwn(bareDepot);
        expect(tabs(container)).toEqual([
            `${m.libraryTab({ tab: "states" })} 0`, `${m.libraryTab({ tab: "transitions" })} 0`, `${m.libraryTab({ tab: "lanes" })} 0`, "Owners 0",
        ]);
        expect(emptyState(container)).toEqual(["fas box-open", "No cards", m.libraryEmptyHint({ tab: "states", name: m.libraryTab({ tab: "states" }) })]);
        expect(m.libraryEmptyHint({ tab: "states", name: "" })).toBe("No state card to drag onto a lane.");
        for (const tab of ["transitions", "lanes"] as const) {
            await openTab(container, m.libraryTab({ tab }));
            expect(emptyState(container)).toEqual(["fas box-open", "No cards", m.libraryEmptyHint({ tab, name: m.libraryTab({ tab }) })]);
        }
        await openTab(container, "Owners");
        expect(emptyState(container)).toEqual(["fas box-open", "Nothing in Owners", "Owners lists nothing yet."]);
        // The page reloaded keeps the tab it had open: the Steps tab, its cards there.
        reloadPage();
        const full = await mountDepot();
        await openTab(full.container, m.libraryTab({ tab: "states" }));
        expect(emptyState(full.container)).toBeNull();
        await search(full.container, "zz");
        expect(emptyState(full.container)).toEqual(["fas box-open", "No matches", 'Nothing matches "zz".']);
    });
});

// ============================================================================
// Each tab follows its own source of the rail (R14, D8)
// ============================================================================

describe("each tab follows its own source of the rail (R14, D8)", () => {
    test("the rail's choice of the step cards' group narrows the Steps tab and an author's tab over the same record, counting what each shows, and leaves the other tabs; a choice that leaves none says so, and its Clear brings them back, the other sources keeping theirs", async () => {
        const { container } = await mountOwn(ownLibraryDepot);
        // The Steps tab is named Step cards here; the Step names tab is an author's over the same record.
        const STEPS = "Step cards";
        const MOVES = m.libraryTab({ tab: "transitions" });
        /** The tabs, the step cards' two counting what the step cards' source shows, the Transitions tab what the move cards' shows. */
        const counted = (steps: string, moves: string) => [
            `${m.libraryTab({ tab: "lanes" })} 2`, "Owners 3", `${STEPS} ${steps}`, `${MOVES} ${moves}`, "Desks 3", `Step names ${steps}`,
        ];
        expect(tabs(container)).toEqual(counted("3", "3"));
        // The sort group: the Steps tab and the author's tab each show the chutes alone.
        await narrow("stepCards", inGroup("Sort"));
        expect(tabs(container)).toEqual(counted("1 of 3", "3"));
        await openTab(container, STEPS);
        expect(cardKeys(container)).toEqual(["chutes"]);
        await openTab(container, "Step names");
        expect(cards(container)).toEqual([{ key: "chutes", label: "Sort chutes", meta: null, icon: "fas tag", drags: true, grip: "grip-vertical", placed: false }]);
        // The move cards' own source: the Transitions tab follows it, and the Steps tab keeps its own.
        await narrow("moveCards", inGroup("Decisions"));
        expect(tabs(container)).toEqual(counted("1 of 3", "1 of 3"));
        await openTab(container, MOVES);
        expect(cardKeys(container)).toEqual(["routed"]);
        // A group no step card holds: the Steps tab says the rail hides every card, and how to see them.
        await narrow("stepCards", inGroup("Dispatch"));
        await openTab(container, STEPS);
        expect(emptyState(container)).toEqual(["fas box-open", m.libraryNarrowed({ tab: "states", name: "step cards" }), m.libraryNarrowedHint({ tab: "states", name: "step cards" })]);
        expect(m.libraryNarrowed({ tab: "states", name: "step cards" })).toBe("The rail hides every card in step cards");
        // Its one button clears the step cards' choice alone.
        await act(async () => { fireEvent.click(within(panel(container).querySelector<HTMLElement>("[data-library-empty]")!).getByRole("button")); });
        await settle();
        expect(tabs(container)).toEqual(counted("3", "1 of 3"));
        expect(cardKeys(container)).toEqual(["chutes", "desk", "scan"]);
    });
});

// ============================================================================
// Each tab its own bound data (R14)
// ============================================================================

describe("each tab its own bound data (R14)", () => {
    test("the owners another session writes move the Owners tab's cards alone: the flowchart's draft and the other tabs stay; a Save of the flowchart moves no tab's cards", async () => {
        const { container } = await mountDepot();
        const deployed = await h.read(ex.depotLanes);
        const STEPS = m.libraryTab({ tab: "states" });
        const keysOf = async (tab: string) => { await openTab(container, tab); return cardKeys(container); };
        expect(tabs(container)).toEqual([`${STEPS} 3`, `${m.libraryTab({ tab: "transitions" })} 3`, `${m.libraryTab({ tab: "lanes" })} 2`, "Owners 3"]);
        // A draft on the flowchart: a lane added.
        await act(async () => { fireEvent.click(container.querySelector("[data-flowchart-addlane]")!); });
        await settle();
        expect(laneKeys(container)).toEqual(["intake", "induct", "sort", "hold", "dispatch", "lane-6"]);
        expect(enabled(SAVE)).toBe(true);
        // Another session takes the night shift off the owners: the Owners tab lists two — and only it moves.
        const owners = new SortedMap([...await h.read(ex.decisionOwners)], compareString);
        owners.delete("ns");
        await h.write(ex.decisionOwners, owners);
        expect(tabs(container)).toEqual([`${STEPS} 3`, `${m.libraryTab({ tab: "transitions" })} 3`, `${m.libraryTab({ tab: "lanes" })} 2`, "Owners 2"]);
        expect(await keysOf("Owners")).toEqual(["cd", "sp"]);
        expect(await keysOf(STEPS)).toEqual(["chutes", "desk", "scan"]);
        // The draft is still there, and still waits on Save.
        expect(laneKeys(container)).toEqual(["intake", "induct", "sort", "hold", "dispatch", "lane-6"]);
        expect(enabled(SAVE)).toBe(true);
        // Saved: the lanes record takes the lane; no tab's cards move.
        await press(SAVE);
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(withRows(deployed, [["lane-6", { label: m.newLane({ n: 6, count: "6" }), seq: 6 }]])));
        expect(tabs(container)).toEqual([`${STEPS} 3`, `${m.libraryTab({ tab: "transitions" })} 3`, `${m.libraryTab({ tab: "lanes" })} 2`, "Owners 2"]);
        expect(await keysOf(STEPS)).toEqual(["chutes", "desk", "scan"]);
    });
});

// ============================================================================
// Each card dropped and saved on e3 (R14)
// ============================================================================

describe("each tab's card dropped on the canvas and saved on e3 (R14)", () => {
    test("a state's card adds a state from its values in the lane it lands in, a transition's gives the transition its values, a lane's adds a lane where it lands, and an owner's makes the owner the decision's — one Save writing each record through its patch door", async () => {
        const { container } = await mountDepot();
        const records = [ex.depotStates, ex.depotTransitions, ex.depotLanes, ex.depotDecisions] as const;
        const deployed = {
            states: await h.read(ex.depotStates), transitions: await h.read(ex.depotTransitions),
            lanes: await h.read(ex.depotLanes), decisions: await h.read(ex.depotDecisions),
            commits: await Promise.all(records.map((record) => h.commits(record))),
        };
        // A transition's card on ARV → SCN, between the two: its values given, its ends kept.
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        await dropAt(container, card(container, "reroute"), between(container, "ARV", "SCN"));
        expect(announced()).toBe("Observed reroute was dropped on ARV → SCN.");
        // An owner's card on the route decision's diamond.
        await openTab(container, "Owners");
        await dropAt(container, card(container, "ns"), diamondOf(container, "route"));
        expect(announced()).toBe("night-supervisor was dropped on decision route.");
        // A state's card between ARV and SCN.
        await openTab(container, m.libraryTab({ tab: "states" }));
        await dropAt(container, card(container, "desk"), between(container, "ARV", "SCN"));
        expect(announced()).toBe("Exception desk was dropped on Intake, after ARV.");
        // A lane's card in the gap before Sort.
        await openTab(container, m.libraryTab({ tab: "lanes" }));
        await dropAt(container, card(container, "check"), gapBefore(container, "sort"));
        expect(announced()).toBe("Quality check was dropped on the gap before Sort.");
        expect(laneKeys(container)).toEqual(["intake", "induct", "lane-6", "sort", "hold", "dispatch"]);
        expect(container.querySelector("[data-flowchart-pending]")?.textContent).toBe(` · ${m.footerPending({ n: 4, count: "4" })}`);
        await press(SAVE);
        // Each record as its card left it, each written once.
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(withRows(deployed.states, [
            ["state-11", { name: "Exception desk", phase: "intake", seq: 1.5, slots: none, flow: "Parcels" }],
        ])));
        expect(printTransitions(await h.read(ex.depotTransitions))).toBe(printTransitions(withRows(deployed.transitions, [
            ["l1", { src: "ARV", dst: "SCN", kind: variant("observed", null), trigger: none, volume: none, n: none, at: none, flow: "Parcels" }],
        ])));
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(withRows(deployed.lanes, [["lane-6", { label: "Quality check", seq: 2.5 }]])));
        expect(printDecisions(await h.read(ex.depotDecisions))).toBe(printDecisions(withRows<Decision>(deployed.decisions, [
            ["route", { name: "route", owner: "night-supervisor" }],
        ])));
        expect(await Promise.all(records.map((record) => h.commits(record)))).toEqual(deployed.commits.map((commits) => ["patch", ...commits]));
        expect(enabled(SAVE)).toBe(false);
    });
});
