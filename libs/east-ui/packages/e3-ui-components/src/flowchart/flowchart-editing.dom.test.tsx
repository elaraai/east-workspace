/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The flowchart's editing (#1247, `Flowchart Builder Spec.md` §9.6,
 * FB17–FB24): every gesture on the canvas one transaction of the open flow's
 * editing session — "+ LANE", a lane's header renamed, its × (off while the
 * lane holds states, its tooltip saying why), the "+ STATE" ghost, a state
 * double-clicked into its editor (a new key rekeying its transitions and the
 * decisions' queues), a state dragged across lanes, a handle dragged to a
 * state (the `canConnect` veto, the in-place drop and a repeat holding as
 * before), and Del on the selected state, transition or decision, never in a
 * field being typed into — each undone, redone and discarded by the history
 * item and by ⌘Z, ⇧⌘Z and ⌘Y from anywhere in the frame but a field; two of
 * one key holding Save off, the history item counting the issue; the footer
 * counting the changes waiting on Save; Save's outcomes — a conflict and a
 * refusal keeping every draft under its banner, a write with no answer
 * resending the same request on Retry, and the source moving under the drafts
 * making them out of date, with Discard in its banner; and the commit itself:
 * over a record one patch through its patch mutation, and over the host's
 * flows — by name, or one — one patch of its value through its `onApply`, the
 * drafts retiring once each reads back as the commit left it.
 *
 * jsdom lays nothing out: the canvas measures 0×0, so its lanes are 166px
 * wide from the left edge and its states sit where `layout.ts` puts them, and
 * a pointer's coordinates are the canvas's own — a drag is driven by them.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    BlobType, East, OptionType, PatchType, SortedMap, StringType, applyFor, compareFor, decodeBeast2For, equalFor, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Editing, Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, UIStore, editingMessages, formatters, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import * as edits from "./edits.js";
import { commits, enabled, mountRecord, press, readRecord, recordHarness, settle, toolbar } from "./flowchart.test-utils.js";
import { EastChakraFlowchart, type FlowchartValue } from "./index.js";
import { flowchartMessages } from "./messages.js";

// jsdom lacks the ResizeObserver the panes and the canvas reach for, and the matchMedia the tooltips do.
beforeAll(() => {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    (globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
});

// Each test its own UI store: its sessions, and its open flow, stay its own.
beforeEach(() => {
    initializeStore(new UIStore());
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

type Flow = ValueTypeOf<typeof Flowchart.Types.Flow>;
type Flows = ValueTypeOf<typeof Flowchart.Types.Flows>;
type UIValue = ValueTypeOf<typeof UIComponentType>;
type Answer = ValueTypeOf<typeof Editing.Types.ApplyResult>;

/** How a captured Save is answered: with the source's answer, or by a write that gets none. */
type Reply = { readonly answer: Answer } | { readonly lost: string };

const m = flowchartMessages;
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();
const DISCARD = editingMessages.discard();
const flowEqual = equalFor(Flowchart.Types.Flow);
const flowsEqual = equalFor(Flowchart.Types.Flows);
const blobEqual = equalFor(BlobType);
const nameEqual = equalFor(StringType);
const decodeBatch = decodeBeast2For(Editing.Types.ChangeSet(Flowchart.Types.Flow, StringType));
const applyEntry = applyFor(OptionType(Flowchart.Types.Flow));

/** A new lane's label, as the flowchart words it in the tests' locale. */
const laneLabel = (n: number): string => m.newLane({ n, count: formatters("en-US").number(n) });

/** The sort flow: three lanes, the last empty; a decision queueing IND; a keyed, a keyless and an in-place transition. */
const SORT_INPUT = {
    lanes: [{ key: "induct", label: "Induct" }, { key: "sort", label: "Sort" }, { key: "hold", label: "Hold" }],
    states: [
        { key: "IND", label: "Inducting", lane: "induct" },
        { key: "CH*", label: "Sort chutes", lane: "sort", members: 14n },
        { key: "SRD", label: "Sorted", lane: "sort" },
    ],
    links: [
        { key: "IND→CH*", from: "IND", to: "CH*", trigger: "route" },
        { from: "CH*", to: "SRD", kind: "observed" },
        { from: "IND", to: "IND" },
    ],
    triggers: [{ key: "route", label: "route", owner: "sort-planner", queue: ["IND", "SRD"] }],
} as const satisfies Parameters<typeof Flowchart.value>[0];

/** The returns flow, which the sort flow's edits never touch. */
const RETURNS_INPUT = {
    lanes: [{ key: "counter", label: "Counter" }],
    states: [{ key: "RCV", label: "Received", lane: "counter" }],
    links: [],
} as const satisfies Parameters<typeof Flowchart.value>[0];

const SORT: Flow = Flowchart.value(SORT_INPUT);
const FLOWS: Flows = Flowchart.values({ "Sort": SORT_INPUT, "Returns": RETURNS_INPUT });

/** The flows with one flow replaced. */
function withFlow(flows: Flows, name: string, flow: Flow): Flows {
    const out = new SortedMap(flows, compareFor(StringType));
    out.set(name, flow);
    return out;
}

// ── The flowchart over a source whose Save is captured ─────────────────────

/**
 * A record of flows whose Save is captured: each batch's bytes, replied to in
 * turn by the replies given — the source's answer, or a write that gets none —
 * and then applied.
 */
function captured(read: () => Flows, replies: Reply[] = []) {
    const sent: Uint8Array[] = [];
    const source: FlowchartValue["source"] = variant("record", {
        read,
        history: () => none,
        commit: { patch: async () => variant("committed", { commitHash: "c", stateHash: "s" }) },
        apply: async (bytes: Uint8Array) => {
            sent.push(bytes);
            const reply = replies.shift();
            if (reply === undefined) return variant("applied", { revision: none });
            if ("lost" in reply) throw new Error(reply.lost);
            return reply.answer;
        },
    });
    return { source, sent };
}

/** A payload over a source, the sort flow open, its canvas's options left out but `canConnect`. */
function payload(source: FlowchartValue["source"], canConnect?: (from: string, to: string) => boolean): FlowchartValue {
    return {
        canvas: {
            orientation: none, freshness: none, minimap: none, legend: some(false), density: none, slice: none,
            stateHover: none, linkHover: none, triggerHover: none, onSelectState: none, onSelectLink: none, onSelectTrigger: none,
            onTracePath: none, canConnect: canConnect === undefined ? none : some(canConnect),
        },
        source,
        open: some("Sort"),
        library: [],
        inspector: false,
        readOnly: false,
        name: none,
    };
}

async function mount(value: FlowchartValue): Promise<RenderResult> {
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraFlowchart value={value} storageKey="flowchart.editing" />
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

/**
 * The open flow as the last Save sent it: the batch's label, its one change's
 * entry, and that change applied to the flow it began from.
 */
function lastSave(sent: readonly Uint8Array[], before: Flow): { label: string; id: string; flow: Flow | undefined } {
    const batch = decodeBatch(sent[sent.length - 1]!);
    expect(batch.changes).toHaveLength(1);
    const change = batch.changes[0]!;
    const after = applyEntry(some(before), change.patch);
    return { label: batch.label, id: change.id, flow: after.type === "some" ? after.value : undefined };
}

/** Saves, and expects the open flow sent as one change under its name, as `expected`, named by its last gesture. */
async function expectSaved(sent: Uint8Array[], expected: Flow, label: string): Promise<void> {
    await press(SAVE);
    const saved = lastSave(sent, SORT);
    expect([saved.label, saved.id]).toEqual([label, "Sort"]);
    expect(saved.flow !== undefined && flowEqual(saved.flow, expected), "the flow Save sent").toBe(true);
}

// ── What the canvas shows, and its gestures ─────────────────────────────────

const stateKeys = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node"));
const laneHeads = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-lane]")].map((el) => el.textContent);
const linkKeys = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-link]")].map((el) => el.getAttribute("data-flowchart-link"));
const pending = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-pending]")?.textContent ?? null;
const canvasBox = (c: HTMLElement): HTMLElement => c.querySelector("[data-flowchart-scroll]") as HTMLElement;
const node = (c: HTMLElement, key: string): HTMLElement => c.querySelector(`[data-flowchart-node="${key}"]`) as HTMLElement;

/** Runs a gesture's events, and lets the session and the renders settle. */
async function gesture(run: () => void): Promise<void> {
    await act(async () => { run(); });
    await settle();
}

async function addLane(c: HTMLElement): Promise<void> {
    await gesture(() => { fireEvent.click(c.querySelector("[data-flowchart-addlane]")!); });
}

async function renameLane(c: HTMLElement, key: string, label: string): Promise<void> {
    await gesture(() => { fireEvent.click(c.querySelector(`[data-flowchart-lane="${key}"]`)!); });
    const input = c.querySelector("[data-flowchart-lane-edit]") as HTMLInputElement;
    await gesture(() => { fireEvent.change(input, { target: { value: label } }); });
    await gesture(() => { fireEvent.keyDown(input, { key: "Enter" }); });
}

/** Fills the inline state editor — its key, then its label — and commits it with ⏎. */
async function fillEditor(c: HTMLElement, key: string, label: string): Promise<void> {
    const [code, name] = [...c.querySelectorAll("[data-flowchart-stateeditor] input")] as HTMLInputElement[];
    await gesture(() => { fireEvent.change(code!, { target: { value: key } }); });
    await gesture(() => { fireEvent.change(name!, { target: { value: label } }); });
    await gesture(() => { fireEvent.keyDown(code!, { key: "Enter" }); });
}

async function addState(c: HTMLElement, lane: string, key: string, label: string): Promise<void> {
    await gesture(() => { fireEvent.pointerEnter(c.querySelector(`[data-flowchart-band="${lane}"]`)!); });
    await gesture(() => { fireEvent.click(c.querySelector(`[data-flowchart-ghoststate="${lane}"]`)!); });
    await fillEditor(c, key, label);
}

async function editState(c: HTMLElement, key: string, next: string, label: string): Promise<void> {
    await gesture(() => { fireEvent.doubleClick(node(c, key)); });
    await fillEditor(c, next, label);
}

/** A pointer pressed on an element at a point of the canvas, moved to another, and let go there. */
async function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await act(async () => { fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 0, clientX: from.x, clientY: from.y }); });
    await act(async () => { fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: to.x, clientY: to.y }); });
    await act(async () => { fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse", clientX: to.x, clientY: to.y }); });
    await settle();
}

// Where `layout.ts` puts the sort flow's states over a canvas 0px wide: lanes
// 166px wide, a state 116×40 centred in its lane, rows 96px apart.
const AT = {
    IND: { x: 83, y: 76 },
    "CH*": { x: 249, y: 76 },
    SRD: { x: 249, y: 172 },
    hold: { x: 415, y: 120 },
} as const;

/** A handle's hit target on a state's side. */
const handle = (c: HTMLElement, key: string, side: "left" | "right" | "top" | "bottom"): Element =>
    c.querySelector(`[data-flowchart-ports="${key}"] [data-flowchart-handle="${side}"]`)!;

/** Selects something on the canvas, and presses a key in it. */
async function selectAndPress(c: HTMLElement, target: Element, key: string): Promise<void> {
    await gesture(() => { fireEvent.click(target); });
    await gesture(() => { fireEvent.keyDown(canvasBox(c), { key }); });
}

// ============================================================================
// Every gesture one transaction (FB17–FB20)
// ============================================================================

describe("every gesture is one transaction of the open flow's session (FB17)", () => {
    test("+ LANE adds a lane, Font Awesome's plus over its word: Undo takes it away, Redo puts it back, and Save sends it as the open flow's update by name", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        const button = container.querySelector("[data-flowchart-addlane]")!;
        expect([button.getAttribute("aria-label"), button.textContent]).toEqual([m.addLane(), m.laneWord()]);
        expect(button.querySelector("svg[data-prefix='fas'][data-icon='plus']")).not.toBeNull();
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 0, count: "0" })}`);
        await addLane(container);
        expect(laneHeads(container)).toEqual(["INDUCT", "SORT", "HOLD", laneLabel(4).toUpperCase()]);
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 1, count: "1" })}`);
        await press(UNDO);
        expect(laneHeads(container)).toEqual(["INDUCT", "SORT", "HOLD"]);
        expect(enabled(SAVE)).toBe(false);
        await press(REDO);
        expect(laneHeads(container)).toHaveLength(4);
        await expectSaved(sent, edits.addLane(SORT, laneLabel).flow, m.editLabel({ edit: "addLane" }));
    });

    test("a lane's header is renamed in place: ⏎ commits it", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await renameLane(container, "sort", "Sortation");
        expect(laneHeads(container)).toEqual(["INDUCT", "SORTATION", "HOLD"]);
        await expectSaved(sent, edits.renameLane(SORT, "sort", "Sortation"), m.editLabel({ edit: "renameLane" }));
    });

    test("a lane's × — Font Awesome's xmark — deletes a lane holding no state", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        const close = container.querySelector("[data-flowchart-lane-delete='hold']")!;
        expect(close.querySelector("svg[data-prefix='fas'][data-icon='xmark']")).not.toBeNull();
        expect([close.textContent, close.getAttribute("aria-label"), close.getAttribute("aria-disabled")]).toEqual(["", m.deleteLane({ label: "Hold" }), null]);
        await gesture(() => { fireEvent.click(close); });
        expect(laneHeads(container)).toEqual(["INDUCT", "SORT"]);
        await expectSaved(sent, edits.deleteLane(SORT, "hold")!, m.editLabel({ edit: "deleteLane" }));
    });

    test("the + STATE ghost — Font Awesome's plus beside its word — opens the editor, and ⏎ adds the state at the end of its lane", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await gesture(() => { fireEvent.pointerEnter(container.querySelector("[data-flowchart-band='hold']")!); });
        const ghost = container.querySelector("[data-flowchart-ghoststate='hold']")!;
        expect([ghost.textContent, ghost.querySelector("svg[data-prefix='fas'][data-icon='plus']") !== null]).toEqual([m.stateWord(), true]);
        await addState(container, "hold", "HLD", "Held");
        expect(stateKeys(container)).toEqual(["IND", "CH*", "SRD", "HLD"]);
        await expectSaved(sent, edits.addState(SORT, "hold", "HLD", "Held"), m.editLabel({ edit: "addState" }));
    });

    test("a flow's last lane deleted leaves its band row, whose + LANE gives it a lane again — the stand-in band has no ×, no header to rename and no ghost", async () => {
        const lone = Flowchart.values({ "Sort": { lanes: [{ key: "intake", label: "Intake" }], states: [], links: [] } });
        const { source } = captured(() => lone);
        const { container } = await mount(payload(source));
        await gesture(() => { fireEvent.click(container.querySelector("[data-flowchart-lane-delete='intake']")!); });
        expect(container.querySelector("[data-flowchart-canvas]")).not.toBeNull();
        expect(container.querySelectorAll("[data-flowchart-lane-delete], [data-flowchart-band]")).toHaveLength(0);
        await gesture(() => { fireEvent.click(container.querySelector("[data-flowchart-lane]")!); });
        expect(container.querySelector("[data-flowchart-lane-edit]")).toBeNull();
        await addLane(container);
        expect(laneHeads(container)).toEqual([laneLabel(1).toUpperCase()]);
    });

    test("a state dragged across lanes is moved", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await drag(node(container, "SRD"), AT.SRD, AT.hold);
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 1, count: "1" })}`);
        await expectSaved(sent, edits.moveState(SORT, "SRD", "hold"), m.editLabel({ edit: "moveState" }));
    });

    test("Del deletes the selected state with its transitions in and out", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await selectAndPress(container, node(container, "CH*"), "Delete");
        expect(stateKeys(container)).toEqual(["IND", "SRD"]);
        expect(linkKeys(container)).toEqual([]);
        await expectSaved(sent, edits.deleteState(SORT, "CH*"), m.editLabel({ edit: "deleteState" }));
    });

    test("Del deletes the selected transition, and Backspace the selected decision, cleared from the transitions it governs", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await selectAndPress(container, container.querySelector("[data-flowchart-link='CH*→SRD#1']")!, "Delete");
        expect(linkKeys(container)).toEqual(["IND→CH*"]);
        await selectAndPress(container, container.querySelector("[data-flowchart-trigger='route']")!, "Backspace");
        expect(container.querySelector("[data-flowchart-trigger]")).toBeNull();
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 3, count: "3" })}`);
        await expectSaved(sent, edits.deleteDecision(edits.deleteLink(SORT, "CH*→SRD#1"), "route"), m.editLabel({ edit: "deleteDecision" }));
    });

    test("Del is the canvas's alone: pressed in a field — find state's, a lane's header being renamed — it deletes nothing", async () => {
        const { source } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await gesture(() => { fireEvent.click(container.querySelector("[data-flowchart-link='IND→CH*']")!); });
        const find = container.querySelector("[data-toolbar-item='seek'] input")!;
        await gesture(() => { fireEvent.keyDown(find, { key: "Backspace" }); });
        await gesture(() => { fireEvent.click(container.querySelector("[data-flowchart-lane='sort']")!); });
        await gesture(() => { fireEvent.keyDown(container.querySelector("[data-flowchart-lane-edit]")!, { key: "Delete" }); });
        // Both still drawn — the selected one last, on top.
        expect(linkKeys(container)).toEqual(["CH*→SRD#1", "IND→CH*"]);
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 0, count: "0" })}`);
    });
});

describe("a state's new key, and connecting (FB18, FB20)", () => {
    test("a state double-clicked into its editor takes a new key, which rekeys its transitions' ends and the decisions' queues in the same transaction", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await editState(container, "IND", "INX", "Inducted");
        expect(stateKeys(container)).toEqual(["INX", "CH*", "SRD"]);
        // The state, its two transitions and the decision queueing it — four changes, one transaction.
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 4, count: "4" })}`);
        await press(UNDO);
        expect(stateKeys(container)).toEqual(["IND", "CH*", "SRD"]);
        expect(enabled(UNDO)).toBe(false);
        await press(REDO);
        await expectSaved(sent, edits.editState(SORT, "IND", "INX", "Inducted"), m.editLabel({ edit: "editState" }));
    });

    test("a handle dragged to another state connects them: a transition of the default type, keyed <from>→<to>", async () => {
        const { source, sent } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await drag(handle(container, "SRD", "left"), AT.SRD, AT.IND);
        expect(linkKeys(container)).toContain("SRD→IND");
        await expectSaved(sent, edits.connect(SORT, "SRD", "IND").flow, m.editLabel({ edit: "connect" }));
    });

    test("a drop on the state it left is its in-place transition; a drop that would repeat a transition, or that canConnect vetoes, adds nothing", async () => {
        const { source, sent } = captured(() => FLOWS, []);
        const { container } = await mount(payload(source, (_from, to) => !nameEqual(to, "IND")));
        // Repeat: IND → CH* is there already.
        await drag(handle(container, "IND", "right"), AT.IND, AT["CH*"]);
        // Vetoed: nothing goes into IND.
        await drag(handle(container, "SRD", "left"), AT.SRD, AT.IND);
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 0, count: "0" })}`);
        // In place: SRD onto SRD, its ↻ badge.
        await drag(handle(container, "SRD", "left"), AT.SRD, AT.SRD);
        expect(node(container, "SRD").querySelector("[data-flowchart-inplace]")!.textContent).toContain("1");
        await expectSaved(sent, edits.connect(SORT, "SRD", "SRD").flow, m.editLabel({ edit: "connect" }));
    });
});

// ============================================================================
// A lane holding states (FB19), the history item and its keys (FB21), and
// what holds Save off (FB22)
// ============================================================================

describe("a lane holding states, the history item and its keys", () => {
    test("a lane holding states can't be deleted: its × is off, and its tooltip says why (FB19)", async () => {
        const { source } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        const close = container.querySelector("[data-flowchart-lane-delete='sort']")!;
        expect([close.getAttribute("aria-disabled"), close.hasAttribute("data-disabled")]).toEqual(["true", true]);
        await gesture(() => { fireEvent.click(close); });
        expect(laneHeads(container)).toEqual(["INDUCT", "SORT", "HOLD"]);
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 0, count: "0" })}`);
        fireEvent.pointerMove(close);
        const tip = await screen.findByRole("tooltip");
        expect([tip.textContent, close.getAttribute("aria-describedby")]).toEqual([m.laneHoldsStates({ n: 2, count: "2" }), tip.id]);
    });

    test("⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in the frame — the canvas, the toolbar — but never in a field being typed into (FB21)", async () => {
        const { source } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await addLane(container);
        const find = container.querySelector("[data-toolbar-item='seek'] input")!;
        await gesture(() => { fireEvent.keyDown(find, { key: "z", metaKey: true }); });
        expect(laneHeads(container)).toHaveLength(4);
        await gesture(() => { fireEvent.keyDown(canvasBox(container), { key: "z", metaKey: true }); });
        expect(laneHeads(container)).toHaveLength(3);
        await gesture(() => { fireEvent.keyDown(canvasBox(container), { key: "z", metaKey: true, shiftKey: true }); });
        expect(laneHeads(container)).toHaveLength(4);
        await gesture(() => { fireEvent.keyDown(toolbar().getByRole("button", { name: UNDO }), { key: "z", ctrlKey: true }); });
        expect(laneHeads(container)).toHaveLength(3);
        await gesture(() => { fireEvent.keyDown(canvasBox(container), { key: "y", ctrlKey: true }); });
        expect(laneHeads(container)).toHaveLength(4);
    });

    test("the history item shows the issue count, Undo, Redo, Discard and Save; two states of one key hold Save off until one is rekeyed (FB21, FB22)", async () => {
        const { source } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        const history = within(container.querySelector("[data-toolbar-item='history']") as HTMLElement);
        expect(history.getAllByRole("button").map((b) => b.getAttribute("aria-label")))
            .toEqual([editingMessages.issues({ n: 0, count: "0" }), UNDO, REDO, DISCARD, SAVE]);
        await addState(container, "hold", "SRD", "Again");
        expect(history.getByRole("button", { name: editingMessages.issues({ n: 1, count: "1" }) })).toBeTruthy();
        expect(enabled(SAVE)).toBe(false);
        // The state drawn under the key — the new one — given its own.
        await editState(container, "SRD", "HLD", "Held");
        expect(stateKeys(container)).toEqual(["IND", "CH*", "SRD", "HLD"]);
        expect(history.getByRole("button", { name: editingMessages.issues({ n: 0, count: "0" }) })).toBeTruthy();
        expect(enabled(SAVE)).toBe(true);
    });

    test("Discard drops every draft", async () => {
        const { source } = captured(() => FLOWS);
        const { container } = await mount(payload(source));
        await addLane(container);
        await selectAndPress(container, node(container, "IND"), "Delete");
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 5, count: "5" })}`);
        await press(DISCARD);
        expect([laneHeads(container), stateKeys(container), pending(container)])
            .toEqual([["INDUCT", "SORT", "HOLD"], ["IND", "CH*", "SRD"], ` · ${m.footerPending({ n: 0, count: "0" })}`]);
    });
});

// ============================================================================
// Save's outcomes (FB23)
// ============================================================================

describe("Save's outcomes (FB23)", () => {
    const issue = { entry: "Sort", row: none, field: none, message: "Changed since this edit began" };

    test("a conflict keeps every draft and says so in its banner", async () => {
        const { source } = captured(() => FLOWS, [{ answer: variant("conflict", [issue]) }]);
        const { container } = await mount(payload(source));
        await addLane(container);
        await press(SAVE);
        const banner = container.querySelector("[data-frame-slot='banners'] [data-session-banner='conflict']")!;
        expect(banner.textContent).toContain(editingMessages.bannerConflict({ n: 1, count: "1" }));
        expect(banner.textContent).toContain(editingMessages.bannerIssue({ where: "Sort", message: issue.message }));
        expect([laneHeads(container).length, pending(container)]).toEqual([4, ` · ${m.footerPending({ n: 1, count: "1" })}`]);
    });

    test("a refusal keeps every draft and gives its reason in its banner", async () => {
        const { source } = captured(() => FLOWS, [{ answer: variant("rejected", [{ ...issue, message: "The write failed: no lane-4 here" }]) }]);
        const { container } = await mount(payload(source));
        await addLane(container);
        await press(SAVE);
        const banner = container.querySelector("[data-session-banner='rejected']")!;
        expect(banner.textContent).toContain(editingMessages.bannerRejected());
        expect(banner.textContent).toContain("The write failed: no lane-4 here");
        expect(laneHeads(container)).toHaveLength(4);
    });

    test("a write with no answer turns Save into Retry, which resends the same request", async () => {
        const { source, sent } = captured(() => FLOWS, [{ lost: "the write got no answer" }]);
        const { container } = await mount(payload(source));
        await addLane(container);
        await press(SAVE);
        const banner = container.querySelector("[data-session-banner='unknown']")!;
        expect(banner.textContent).toContain(editingMessages.bannerUnknown());
        expect(toolbar().queryByRole("button", { name: SAVE })).toBeNull();
        await press(editingMessages.retryRequest());
        expect(sent).toHaveLength(2);
        expect(blobEqual(sent[0]!, sent[1]!), "the same request").toBe(true);
        expect(container.querySelector("[data-session-banner='unknown']")).toBeNull();
    });

    test("the source moving under pending drafts makes them out of date: Save is off, and the banner's Discard takes the source as it stands", async () => {
        const { source } = captured(() => FLOWS);
        const { container, rerender } = await mount(payload(source));
        await addLane(container);
        // Another write renames the empty lane.
        const moved = withFlow(FLOWS, "Sort", edits.renameLane(SORT, "hold", "Holding"));
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={payload(captured(() => moved).source)} storageKey="flowchart.editing" />
            </ChakraProvider>,
        );
        await settle();
        const banner = container.querySelector("[data-session-banner='stale']")!;
        expect(banner.textContent).toContain(editingMessages.bannerStale());
        expect(enabled(SAVE)).toBe(false);
        await gesture(() => { fireEvent.click(banner.querySelector("[data-banner-action='discard']")!); });
        expect(container.querySelector("[data-session-banner='stale']")).toBeNull();
        expect(laneHeads(container)).toEqual(["INDUCT", "SORT", "HOLDING"]);
    });
});

// ============================================================================
// The commit (FB22): over a record, and over the host's flows
// ============================================================================

describe("Save's commit (FB22, FB23)", () => {
    test("over a record, one patch through its patch mutation: the open flow's update by name; the drafts retire once the record reads it back", async () => {
        const harness = recordHarness(FLOWS);
        const { container } = await mountRecord({ flow: "Sort", library: [Flowchart.library.flows()] });
        await addLane(container);
        await renameLane(container, "sort", "Sortation");
        // The open flow's card is Pending in the Flows tab while its drafts are.
        expect(container.querySelector("[data-frame-slot='start'] [data-library-item='Sort'] [data-tone]")!.textContent).toBe(m.flowPending());
        await press(SAVE);
        const expected = withFlow(FLOWS, "Sort", edits.renameLane(edits.addLane(SORT, laneLabel).flow, "sort", "Sortation"));
        expect(flowsEqual(readRecord(harness), expected)).toBe(true);
        expect(await commits(harness)).toEqual(["patch", "$init"]);
        await waitFor(() => expect(pending(container)).toBe(` · ${m.footerPending({ n: 0, count: "0" })}`));
        expect(enabled(SAVE)).toBe(false);
        expect(laneHeads(container)).toEqual(["INDUCT", "SORTATION", "HOLD", laneLabel(4).toUpperCase()]);
        expect(container.querySelector("[data-frame-slot='start'] [data-library-item='Sort'] [data-tone]")).toBeNull();
    }, 30_000);

    test("a new flow takes gestures as its drafts: Save inserts it, as its gestures left it, by name", async () => {
        const harness = recordHarness(FLOWS);
        const { container } = await mountRecord({ flow: "Sort", library: [Flowchart.library.flows()] });
        await gesture(() => { fireEvent.click(container.querySelector("[data-frame-slot='start'] [data-flowchart-new-flow]")!); });
        const popover = within(await screen.findByRole("dialog"));
        await gesture(() => { fireEvent.change(popover.getByRole("textbox", { name: m.flowName() }), { target: { value: "Night shift" } }); });
        await gesture(() => { fireEvent.click(popover.getByRole("button", { name: m.createFlow() })); });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await settle();
        await addState(container, "lane-1", "NGT", "Night intake");
        expect(stateKeys(container)).toEqual(["NGT"]);
        await press(SAVE);
        const night = edits.addState(edits.addLane({ description: none, lanes: [], states: [], links: [], triggers: [] }, laneLabel).flow, "lane-1", "NGT", "Night intake");
        expect(flowsEqual(readRecord(harness), withFlow(FLOWS, "Night shift", night))).toBe(true);
        expect(await commits(harness)).toEqual(["patch", "$init"]);
    }, 30_000);

    const FLOWS_KEY = "flowchart.editing.host-flows";
    const FLOW_KEY = "flowchart.editing.host-flow";

    /** The host's flows by name in a State, which its onApply writes with the patch it is handed. */
    const hostFlows = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const flows = $.let(State.bind([Flowchart.Types.Flows], FLOWS_KEY, FLOWS));
        const onApply = $.const(East.asyncFunction([PatchType(Flowchart.Types.Flows)], Editing.Types.ApplyResult, ($2, patch) => {
            $2(flows.write(East.applyPatch(flows.read(), patch)));
            return variant("applied", { revision: none });
        }));
        return Flowchart({ data: flows.read(), flow: "Sort", onApply });
    }))), getRegisteredPlatformImplementations());

    /** The host's one flow in a State, which its onApply writes with the patch it is handed. */
    const hostFlow = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const flow = $.let(State.bind([Flowchart.Types.Flow], FLOW_KEY, SORT));
        const onApply = $.const(East.asyncFunction([PatchType(Flowchart.Types.Flow)], Editing.Types.ApplyResult, ($2, patch) => {
            $2(flow.write(East.applyPatch(flow.read(), patch)));
            return variant("applied", { revision: none });
        }));
        return Flowchart({ data: flow.read(), onApply });
    }))), getRegisteredPlatformImplementations());

    const readHostFlows = East.compile(East.function([], Flowchart.Types.Flows, ($) => {
        const flows = $.const(State.bind([Flowchart.Types.Flows], FLOWS_KEY, FLOWS));
        return flows.read();
    }), getRegisteredPlatformImplementations());

    const readHostFlow = East.compile(East.function([], Flowchart.Types.Flow, ($) => {
        const flow = $.const(State.bind([Flowchart.Types.Flow], FLOW_KEY, SORT));
        return flow.read();
    }), getRegisteredPlatformImplementations());

    async function mountHost(ui: () => UIValue): Promise<RenderResult> {
        const utils = render(
            <ChakraProvider value={system}>
                <EastChakraComponent value={ui()} storageKey="flowchart-host" />
            </ChakraProvider>,
        );
        await settle();
        return utils;
    }

    test("over the host's flows by name, one patch of the flows through its onApply — the other flows as they were — and the drafts retire once the host's value reads back", async () => {
        const { container } = await mountHost(hostFlows);
        expect(stateKeys(container)).toEqual(["IND", "CH*", "SRD"]);
        await selectAndPress(container, node(container, "CH*"), "Delete");
        await press(SAVE);
        expect(flowsEqual(readHostFlows(), withFlow(FLOWS, "Sort", edits.deleteState(SORT, "CH*")))).toBe(true);
        await waitFor(() => expect(pending(container)).toBe(` · ${m.footerPending({ n: 0, count: "0" })}`));
        expect([stateKeys(container), enabled(SAVE)]).toEqual([["IND", "SRD"], false]);
    }, 30_000);

    test("over the host's one flow, the flow's own patch through its onApply, and the drafts retire once it reads back", async () => {
        const { container } = await mountHost(hostFlow);
        await editState(container, "IND", "INX", "Inducted");
        await press(SAVE);
        expect(flowEqual(readHostFlow(), edits.editState(SORT, "IND", "INX", "Inducted"))).toBe(true);
        await waitFor(() => expect(pending(container)).toBe(` · ${m.footerPending({ n: 0, count: "0" })}`));
        expect([stateKeys(container), enabled(SAVE)]).toEqual([["INX", "CH*", "SRD"], false]);
    }, 30_000);
});
