/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's editing over the app's records, on e3 (#1503, `Flowchart
 * Records Spec.md` R8–R12, D1–D3, D6): one history over a session a record —
 * the states', the transitions', the lanes' and the decisions' — every gesture
 * one step of it, a gesture across records one step too, undone, redone and
 * discarded by the history item and by ⌘Z, ⇧⌘Z and ⌘Y from anywhere in the
 * frame but a field.
 *
 * - **Each gesture writes its roles' fields alone** (R8), every other field as
 *   it was, in the record of what it touches: "+ LANE", a lane's header
 *   double-clicked into its rename (a click selects the lane), its × (off
 *   while a state stands in it, its tooltip saying why), the "+ STATE" ghost, a
 *   state dragged between two cards of a lane, a state double-clicked into its
 *   rename, Duplicate, a handle dragged to a state (the `canConnect` veto, the
 *   in-place drop and a repeat holding as before), and the form's fields.
 * - **Keys** (R9, D1–D3): a saved state's key is printed, never a field; one
 *   the Flowchart holds is refused in the + STATE editor and in the form; a
 *   new transition's is minted and never drawn; and a new key a state the
 *   rail hides holds is checked with e3 by key, an issue holding Save off.
 * - **Del's reach** (R10, D6): a state's Del takes every transition the
 *   flowchart holds naming it — one the rail hides is left, Issues listing it
 *   once it is read — and its key out of each decision's queue, several
 *   states one step; a decision's Del clears it from the transitions naming it
 *   — never in a field being typed into.
 * - **Drafts out of view** (R11): a draft the rail hides waits in its session,
 *   Issues listing it, and Save writes it with the rest.
 * - **Save** (R12): each record's changes through its own patch door, a
 *   request of its own — a refusal keeping that record's drafts beside the
 *   others' commits, the app's ready check holding Save off, a Save another
 *   session overtakes waiting on a choice, a write with no answer resending
 *   the same request on Retry, the record moving under the drafts carrying
 *   them over, and a remount drawing what e3 holds.
 *
 * Each key the Flowchart acts on goes no further than it, and an Escape typed
 * elsewhere on the page acts on nothing of it (#1398).
 *
 * jsdom lays nothing out: the canvas measures 0×0 at the client origin, so a
 * pointer's coordinates are the canvas's own, and each card stands where
 * `layout.ts` puts it — a drag is driven from the cards' own boxes.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    BooleanType, East, SortedMap, StringType, compareFor, decodeBeast2For, defaultValue, encodeBeast2For, none, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages, formatters } from "@elaraai/east-ui-components";
import { Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { conflictCards, reloadPage, slot } from "../e3-web-mount.test-utils.js";
import { offering } from "../shared/schedule/keys.test-utils.js";
import { act, enabled, flowchartHarness, press, settle, toolbar } from "./flowchart.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness();

const m = flowchartMessages;
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();
const DISCARD = editingMessages.discard();
const words = formatters("en-US");
const count = (n: number): string => words.number(n);

/** A new lane's label, as the Flowchart words it in the tests' locale. */
const laneLabel = (n: number): string => m.newLane({ n, count: count(n) });
/** The footer's count of the changes waiting on Save. */
const pendingText = (n: number): string => ` · ${m.footerPending({ n, count: count(n) })}`;

/** The depot's lanes' headers, in their order. */
const HEADS = ["INTAKE", "INDUCT", "SORT", "HOLD", "DISPATCH"];
/** The depot's DSP → DLV, naming a state e3 holds none of: an unresolved end, which Issues lists beside anything else. */
const DLV_END = {
    issue: "end", where: m.issueWhere({ kind: "Transition", name: "DSP → DLV" }),
    message: m.issueText({ issue: "end", link: "DSP → DLV", missing: ["DLV"] }), kind: "warning",
};

const printStates = printFor(ex.depotStates.type);
const printTransitions = printFor(ex.depotTransitions.type);
const printLanes = printFor(ex.depotLanes.type);
const printDecisions = printFor(ex.depotDecisions.type);
const printQueued = printFor(ex.depotQueuedDecisions.type);
const printText = printFor(StringType);
const compareText = compareFor(StringType);
const decodeRail = decodeBeast2For(RecordSliceStateType);
const encodeRail = encodeBeast2For(RecordSliceStateType);

/**
 * A record's rows with some changed: each key given its new row, or taken
 * away for `undefined`.
 *
 * @param rows - The rows as they were
 * @param changes - The rows changed, by key
 * @returns The rows
 */
function changed<V>(rows: ReadonlyMap<string, V>, changes: { readonly [key: string]: V | undefined }): Map<string, V> {
    const out: Map<string, V> = new SortedMap<string, V>(rows, compareText);
    for (const [key, row] of Object.entries(changes)) {
        if (row === undefined) out.delete(key);
        else out.set(key, row);
    }
    return out;
}

// ── The flowcharts ──────────────────────────────────────────────────────────

/** The depot's rail narrowed to one flow, both its states and its transitions, as its preset narrows them — written as the rail writes it. */
async function narrowFlow(flow: string): Promise<void> {
    const store = StateRuntime.getStore();
    const where: ValueTypeOf<typeof RecordSliceStateType>["where"] = new SortedMap([["flow", variant("values", [printText(flow)])]], compareText);
    await act(async () => {
        for (const source of ["states", "transitions"]) {
            const key = `flowchart.depot.${source}`;
            const held = store.read(key);
            const state = held === undefined ? { where, preset: none, resolution: none } : { ...decodeRail(held), preset: none, where };
            store.write(key, encodeRail(state));
        }
    });
    await settle();
}

// ── What the canvas shows, and its gestures ─────────────────────────────────

const node = (c: HTMLElement, key: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);
const laneHeads = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-lane]")].map((el) => el.textContent);
const linkKeys = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-link]")].map((el) => el.getAttribute("data-flowchart-link")).sort();
const pending = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-pending]")?.textContent ?? null;
const canvasBox = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>("[data-flowchart-scroll]")!;
const laneSelected = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-lane-selected]")?.getAttribute("data-flowchart-lane-selected") ?? null;
const banners = (c: HTMLElement): (string | null)[] => [...slot(c, "banners").querySelectorAll("[data-session-banner]")].map((b) => b.getAttribute("data-session-banner"));

/** A card's centre on the canvas, as its box places it. */
function centre(c: HTMLElement, key: string): { x: number; y: number } {
    const card = node(c, key)!;
    return {
        x: parseFloat(card.style.left) + parseFloat(card.style.width) / 2,
        y: parseFloat(card.style.top) + parseFloat(card.style.height) / 2,
    };
}

/** A handle's hit target on a state's side. */
const handle = (c: HTMLElement, key: string, side: "left" | "right" | "top" | "bottom"): Element =>
    c.querySelector(`[data-flowchart-ports="${key}"] [data-flowchart-handle="${side}"]`)!;

/** Fires a gesture's events, and lets the sessions and the renders settle. */
async function gesture(fire: () => void): Promise<void> {
    await act(async () => { fire(); });
    await settle();
}

async function addLane(c: HTMLElement): Promise<void> {
    await gesture(() => { fireEvent.click(c.querySelector("[data-flowchart-addlane]")!); });
}

/** A lane's header double-clicked into its rename, a label typed, and ⏎. */
async function renameLane(c: HTMLElement, key: string, label: string): Promise<void> {
    await gesture(() => { fireEvent.doubleClick(c.querySelector(`[data-flowchart-lane="${key}"]`)!); });
    const input = c.querySelector<HTMLInputElement>("[data-flowchart-lane-edit]")!;
    await gesture(() => { fireEvent.change(input, { target: { value: label } }); });
    await gesture(() => { fireEvent.keyDown(input, { key: "Enter" }); });
}

/** The "+ STATE" ghost of a lane clicked into its editor, a key and a label typed, and ⏎. */
async function addState(c: HTMLElement, lane: string, key: string, label: string): Promise<void> {
    await gesture(() => { fireEvent.pointerEnter(c.querySelector(`[data-flowchart-band="${lane}"]`)!); });
    await gesture(() => { fireEvent.click(c.querySelector(`[data-flowchart-ghoststate="${lane}"]`)!); });
    const code = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-key]")!;
    const name = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!;
    await gesture(() => { fireEvent.change(code, { target: { value: key } }); });
    await gesture(() => { fireEvent.change(name, { target: { value: label } }); });
    await gesture(() => { fireEvent.keyDown(code, { key: "Enter" }); });
}

/** A state double-clicked into its editor, a label typed, and ⏎. */
async function renameState(c: HTMLElement, key: string, label: string): Promise<void> {
    await gesture(() => { fireEvent.doubleClick(node(c, key)!); });
    const input = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!;
    await gesture(() => { fireEvent.change(input, { target: { value: label } }); });
    await gesture(() => { fireEvent.keyDown(input, { key: "Enter" }); });
}

/** A pointer pressed on an element at a point of the canvas, moved to another, and let go there. */
async function drag(el: Element, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    await act(async () => { fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 0, clientX: from.x, clientY: from.y }); });
    await act(async () => { fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: to.x, clientY: to.y }); });
    await act(async () => { fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse", clientX: to.x, clientY: to.y }); });
    await settle();
}

/** Selects something on the canvas, and presses a key in it. */
async function selectAndPress(c: HTMLElement, target: Element, key: string): Promise<void> {
    await gesture(() => { fireEvent.click(target); });
    await gesture(() => { fireEvent.keyDown(canvasBox(c), { key }); });
}

/** Presses Save, and gives the records it wrote, each a request of its own, by name. */
async function save(): Promise<(string | undefined)[]> {
    const from = h.requests("mutate").length;
    await press(SAVE);
    return h.requests("mutate").slice(from).map((request) => request.record).sort();
}

// ── The inspector ───────────────────────────────────────────────────────────

/** The inspector's open tab's panel. */
const inspector = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** Opens one of the inspector's tabs, by its name. */
async function openTab(c: HTMLElement, name: string): Promise<void> {
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `) === true);
    if (tab === undefined) throw new Error(`no inspector tab ${name}`);
    await gesture(() => { fireEvent.click(tab); });
}

/** The issues Issues lists, each its word, where it is, what it says, and whether it holds Save off. */
const issues = (c: HTMLElement) => [...inspector(c).querySelectorAll("[data-inspector-issue]")].map((el) => ({
    issue: el.getAttribute("data-inspector-issue"),
    where: el.firstElementChild?.textContent ?? null,
    message: el.querySelector("[data-kind]")?.textContent ?? null,
    kind: el.querySelector("[data-kind]")?.getAttribute("data-kind") ?? null,
}));

/** A form of Details — its roles' or its fields' — each field its key and its editor. */
const editors = (c: HTMLElement, form: "roles" | "fields"): string[] => [...inspector(c).querySelectorAll(`[data-inspector-form="${form}"] [data-field]`)]
    .map((el) => `${el.getAttribute("data-field")}:${el.getAttribute("data-editor")}`);

/** Types a field's new text in a form of Details and commits it with ⏎. */
async function retype(c: HTMLElement, form: "roles" | "fields", field: string, text: string): Promise<void> {
    const user = userEvent.setup();
    const box = within(inspector(c).querySelector<HTMLElement>(`[data-inspector-form="${form}"] [data-field="${field}"]`)!).getByRole("textbox");
    await user.clear(box);
    if (text !== "") await user.type(box, text);
    await user.type(box, "{Enter}");
    await settle();
}

// ============================================================================
// Each gesture writes its roles' fields alone (R8)
// ============================================================================

describe("each gesture is one step, writing its roles' fields alone in the record of what it touches (R8)", () => {
    test("+ LANE — Font Awesome's plus over its word — adds lane-6, labelled Lane 6, one past the last: Undo takes it away, Redo puts it back, and Save writes the lanes' record alone", async () => {
        const before = await h.read(ex.depotLanes);
        const commits = await h.commits(ex.depotLanes);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        const button = c.querySelector("[data-flowchart-addlane]")!;
        expect([button.getAttribute("aria-label"), button.textContent]).toEqual([m.addLane(), m.laneWord()]);
        expect(button.querySelector("svg[data-prefix='fas'][data-icon='plus']")).not.toBeNull();
        expect(pending(c)).toBe(pendingText(0));
        await addLane(c);
        expect(laneHeads(c)).toEqual([...HEADS, laneLabel(6).toUpperCase()]);
        expect(pending(c)).toBe(pendingText(1));
        await press(UNDO);
        expect(laneHeads(c)).toEqual(HEADS);
        expect(enabled(SAVE)).toBe(false);
        await press(REDO);
        expect(laneHeads(c)).toEqual([...HEADS, laneLabel(6).toUpperCase()]);
        expect(await save()).toEqual([ex.depotLanes.name]);
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(changed(before, { "lane-6": { label: laneLabel(6), seq: 6 } })));
        expect(await h.commits(ex.depotLanes)).toEqual(["patch", ...commits]);
        // The draft retires once the record reads it back.
        await waitFor(() => expect(pending(c)).toBe(pendingText(0)));
        expect([enabled(SAVE), laneHeads(c)]).toEqual([false, [...HEADS, laneLabel(6).toUpperCase()]]);
    });

    test("a lane's header clicked selects the lane and renames nothing; double-clicked, it is renamed in place, ⏎ writing its label alone", async () => {
        const before = await h.read(ex.depotLanes);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await gesture(() => { fireEvent.click(c.querySelector("[data-flowchart-lane='sort']")!); });
        expect([c.querySelector("[data-flowchart-lane-edit]"), laneSelected(c)]).toEqual([null, "sort"]);
        await renameLane(c, "sort", "Sortation");
        expect(laneHeads(c)).toEqual(["INTAKE", "INDUCT", "SORTATION", "HOLD", "DISPATCH"]);
        expect(await save()).toEqual([ex.depotLanes.name]);
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(changed(before, { sort: { ...before.get("sort")!, label: "Sortation" } })));
    });

    test("a lane's × — Font Awesome's xmark — deletes a lane no state stands in", async () => {
        const before = await h.read(ex.depotLanes);
        await h.patch(ex.depotLanes, changed(before, { overflow: { label: "Overflow", seq: 6 } }));
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        const close = c.querySelector("[data-flowchart-lane-delete='overflow']")!;
        expect(close.querySelector("svg[data-prefix='fas'][data-icon='xmark']")).not.toBeNull();
        expect([close.textContent, close.getAttribute("aria-label"), close.getAttribute("aria-disabled")]).toEqual(["", m.deleteLane({ label: "Overflow" }), null]);
        await gesture(() => { fireEvent.click(close); });
        expect(laneHeads(c)).toEqual(HEADS);
        expect(await save()).toEqual([ex.depotLanes.name]);
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(before));
    });

    test("the + STATE ghost — Font Awesome's plus beside its word — opens its lane's editor, ⏎ adding the state one past the lane's last, every other field its type's default; the app's check holds Save off, the history item counting the issue, until the form gives it its flow", async () => {
        const before = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        const history = within(c.querySelector<HTMLElement>("[data-toolbar-item='history']")!);
        expect(history.getAllByRole("button").map((b) => b.getAttribute("aria-label")))
            .toEqual([editingMessages.issues({ n: 0, count: "0" }), UNDO, REDO, DISCARD, SAVE]);
        await gesture(() => { fireEvent.pointerEnter(c.querySelector("[data-flowchart-band='hold']")!); });
        const ghost = c.querySelector("[data-flowchart-ghoststate='hold']")!;
        expect([ghost.textContent, ghost.querySelector("svg[data-prefix='fas'][data-icon='plus']") !== null]).toEqual([m.stateWord(), true]);
        await addState(c, "hold", "QRT", "Quarantined");
        expect(node(c, "QRT")?.textContent).toContain("Quarantined");
        // The app's check on the drafted state: it names no flow, so Save waits, and Issues says why.
        expect(history.getByRole("button", { name: editingMessages.issues({ n: 1, count: "1" }) })).toBeTruthy();
        expect(enabled(SAVE)).toBe(false);
        await openTab(c, "Issues");
        expect(issues(c)).toEqual([{ issue: "ready", where: m.issueWhere({ kind: "State", name: "QRT" }), message: "Give the state its flow", kind: "invalid" }, DLV_END]);
        // The form's fields — those no role writes — give it its flow.
        await openTab(c, "Details");
        await retype(c, "fields", "flow", "Parcels");
        expect(history.getByRole("button", { name: editingMessages.issues({ n: 0, count: "0" }) })).toBeTruthy();
        expect(enabled(SAVE)).toBe(true);
        expect(await save()).toEqual([ex.depotStates.name]);
        expect(printStates(await h.read(ex.depotStates)))
            .toBe(printStates(changed(before, { QRT: { name: "Quarantined", phase: "hold", seq: 4, slots: none, flow: "Parcels" } })));
    });

    test("a state dragged between two cards of another lane is moved there: its lane, and the middle of their orders, every other field as it was", async () => {
        const before = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        const held = centre(c, "HLD"), cleared = centre(c, "CLR");
        await drag(node(c, "SRD")!, centre(c, "SRD"), { x: held.x, y: (held.y + cleared.y) / 2 });
        expect(pending(c)).toBe(pendingText(1));
        expect(await save()).toEqual([ex.depotStates.name]);
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(before, { SRD: { ...before.get("SRD")!, phase: "hold", seq: 1.5 } })));
    });

    test("a state double-clicked into its editor shows its key fixed — a saved row's key is printed, never a field — and ⏎ writes its label alone (D1)", async () => {
        const before = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await gesture(() => { fireEvent.doubleClick(node(c, "SCN")!); });
        const editor = c.querySelector("[data-flowchart-stateeditor]")!;
        const key = editor.querySelector("[data-flowchart-key]")!;
        expect([key instanceof HTMLInputElement, key.textContent, editor.querySelectorAll("input").length]).toEqual([false, "SCN", 1]);
        const input = editor.querySelector<HTMLInputElement>("[data-flowchart-label]")!;
        await gesture(() => { fireEvent.change(input, { target: { value: "Scanned in" } }); });
        await gesture(() => { fireEvent.keyDown(input, { key: "Enter" }); });
        expect([c.querySelector("[data-flowchart-stateeditor]"), node(c, "SCN")?.textContent?.includes("Scanned in")]).toEqual([null, true]);
        // The form prints a saved state's key, and gives its label a field.
        await gesture(() => { fireEvent.click(node(c, "SCN")!); });
        expect(editors(c, "roles")).toEqual(["key:readonly", "label:text", "lane:reference"]);
        expect(await save()).toEqual([ex.depotStates.name]);
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(before, { SCN: { ...before.get("SCN")!, name: "Scanned in" } })));
    });

    test("Duplicate puts the state after itself in its lane, under its key made unique, every other field as it has them", async () => {
        const before = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await gesture(() => { fireEvent.click(node(c, "SRD")!); });
        await gesture(() => { fireEvent.click(inspector(c).querySelector("[data-inspector-action='duplicate']")!); });
        expect(node(c, "SRD-2")?.hasAttribute("data-selected")).toBe(true);
        expect(await save()).toEqual([ex.depotStates.name]);
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(before, { "SRD-2": { ...before.get("SRD")!, seq: 3 } })));
    });

    test("a handle dragged to another state connects them: a transition keyed new and never drawn — its ends, every other field its type's default", async () => {
        const before = await h.read(ex.depotTransitions);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        offering(["minted-1"]);
        await drag(handle(c, "SRD", "left"), centre(c, "SRD"), centre(c, "IND"));
        expect(linkKeys(c)).toContain("minted-1");
        // Named by its ends everywhere: its key is drawn nowhere.
        expect(c.textContent).not.toContain("minted-1");
        expect(await save()).toEqual([ex.depotTransitions.name]);
        expect(printTransitions(await h.read(ex.depotTransitions)))
            .toBe(printTransitions(changed(before, { "minted-1": { ...defaultValue(ex.DepotTransition), src: "SRD", dst: "IND" } })));
    });

    test("a drop on the state it left is its in-place transition; a drop repeating a transition, or one canConnect vetoes, adds nothing", async () => {
        const before = await h.read(ex.depotTransitions);
        // The editing example's flowchart, with a `canConnect` refusing every transition into IND.
        const { container: c } = await h.mountFlowchart(($) => {
            const states = $.let(Record.bind(ex.depotStates));
            const transitions = $.let(Record.bind(ex.depotTransitions));
            const lanes = $.let(Record.bind(ex.depotLanes));
            const decisions = $.let(Record.bind(ex.depotDecisions));
            return {
                states: Flowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots }),
                transitions: Flowchart.transitions(transitions, { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind }),
                lanes: Flowchart.lanes(lanes, { label: "label", order: "seq" }),
                decisions: Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) }),
                canConnect: East.function([StringType, StringType], BooleanType, (_$, _from, to) => East.equal(to, "IND").not()),
                name: "depotEditing",
            };
        });
        // A repeat: IND → CH* is there already.
        await drag(handle(c, "IND", "right"), centre(c, "IND"), centre(c, "CH*"));
        // Vetoed: nothing goes into IND.
        await drag(handle(c, "SRD", "left"), centre(c, "SRD"), centre(c, "IND"));
        expect(pending(c)).toBe(pendingText(0));
        // In place: SRD onto SRD, its ↻ badge.
        offering(["minted-2"]);
        await drag(handle(c, "SRD", "left"), centre(c, "SRD"), centre(c, "SRD"));
        expect(c.querySelector("[data-flowchart-inplace='SRD']")?.textContent).toContain("1");
        expect(await save()).toEqual([ex.depotTransitions.name]);
        expect(printTransitions(await h.read(ex.depotTransitions)))
            .toBe(printTransitions(changed(before, { "minted-2": { ...defaultValue(ex.DepotTransition), src: "SRD", dst: "SRD" } })));
    });

    test("a state naming a lane the Flowchart holds none of stands in No lane, which takes no lane's gesture — no ×, no rename, no selection, no + STATE — and + LANE adds the next lane before it", async () => {
        const lanes = await h.read(ex.depotLanes);
        await h.patch(ex.depotLanes, changed(lanes, { hold: undefined }));
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        const heads = ["INTAKE", "INDUCT", "SORT", "DISPATCH"];
        expect(laneHeads(c)).toEqual([...heads, m.noLaneBand().toUpperCase()]);
        expect([...c.querySelectorAll("[data-flowchart-lane-delete]")].map((el) => el.getAttribute("data-flowchart-lane-delete")))
            .toEqual(["intake", "induct", "sort", "dispatch"]);
        expect([...c.querySelectorAll("[data-flowchart-band]")].map((el) => el.getAttribute("data-flowchart-band")))
            .toEqual(["intake", "induct", "sort", "dispatch"]);
        const noLane = [...c.querySelectorAll("[data-flowchart-lane]")].at(-1)!;
        await gesture(() => { fireEvent.doubleClick(noLane); });
        expect(c.querySelector("[data-flowchart-lane-edit]")).toBeNull();
        await gesture(() => { fireEvent.click(noLane); });
        expect(laneSelected(c)).toBeNull();
        await addLane(c);
        expect(laneHeads(c)).toEqual([...heads, laneLabel(5).toUpperCase(), m.noLaneBand().toUpperCase()]);
    });
});

// ============================================================================
// Del's reach (R10, D6)
// ============================================================================

describe("Del's reach (R10, D6)", () => {
    test("Del deletes the selected state and every transition naming it, one step across their two records: Undo and Redo take both back and forth, and Save writes each through its own door", async () => {
        const states = await h.read(ex.depotStates), transitions = await h.read(ex.depotTransitions);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        const links = linkKeys(c);
        await selectAndPress(c, node(c, "CH*")!, "Delete");
        expect(node(c, "CH*")).toBeNull();
        expect(linkKeys(c)).toEqual(links.filter((key) => key !== "l4" && key !== "l5" && key !== "l12"));
        expect(pending(c)).toBe(pendingText(4));
        await press(UNDO);
        expect([node(c, "CH*") !== null, linkKeys(c), pending(c)]).toEqual([true, links, pendingText(0)]);
        expect(enabled(UNDO)).toBe(false);
        await press(REDO);
        expect([node(c, "CH*"), pending(c)]).toEqual([null, pendingText(4)]);
        expect(await save()).toEqual([ex.depotStates.name, ex.depotTransitions.name].sort());
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(states, { "CH*": undefined })));
        expect(printTransitions(await h.read(ex.depotTransitions))).toBe(printTransitions(changed(transitions, { l4: undefined, l5: undefined, l12: undefined })));
    });

    test("Del deletes the selected transition, and Backspace the selected decision, cleared from each transition naming it", async () => {
        const transitions = await h.read(ex.depotTransitions), decisions = await h.read(ex.depotDecisions);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await selectAndPress(c, c.querySelector("[data-flowchart-link='l13']")!, "Delete");
        expect(linkKeys(c)).not.toContain("l13");
        await selectAndPress(c, c.querySelector("[data-flowchart-trigger='route']")!, "Backspace");
        expect([c.querySelector("[data-flowchart-trigger='route']"), c.querySelector("[data-flowchart-trigger='customs']") !== null]).toEqual([null, true]);
        // The transition, the decision, and the transition it governed.
        expect(pending(c)).toBe(pendingText(3));
        expect(await save()).toEqual([ex.depotDecisions.name, ex.depotTransitions.name].sort());
        expect(printTransitions(await h.read(ex.depotTransitions)))
            .toBe(printTransitions(changed(transitions, { l13: undefined, l4: { ...transitions.get("l4")!, trigger: none } })));
        expect(printDecisions(await h.read(ex.depotDecisions))).toBe(printDecisions(changed(decisions, { route: undefined })));
    });

    test("Del deletes a selected lane no state stands in — one a state stands in stays, selected — and several states shift-clicked together, one step: each, every transition naming one, and each key in a decision's queue", async () => {
        const lanes = await h.read(ex.depotLanes);
        await h.patch(ex.depotLanes, changed(lanes, { overflow: { label: "Overflow", seq: 6 } }));
        const states = await h.read(ex.depotStates), transitions = await h.read(ex.depotTransitions), queued = await h.read(ex.depotQueuedDecisions);
        // The editing example's flowchart over the decisions with the states queued at each.
        const { container: c } = await h.mountFlowchart(($) => {
            const states = $.let(Record.bind(ex.depotStates));
            const transitions = $.let(Record.bind(ex.depotTransitions));
            const lanes = $.let(Record.bind(ex.depotLanes));
            const queued = $.let(Record.bind(ex.depotQueuedDecisions));
            return {
                states: Flowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots }),
                transitions: Flowchart.transitions(transitions, { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind }),
                lanes: Flowchart.lanes(lanes, { label: "label", order: "seq" }),
                decisions: Flowchart.decisions(queued, { label: (d) => d.name, owner: (d) => some(d.owner), queue: "queue" }),
                name: "depotEditing",
            };
        });
        // A lane a state stands in: Del leaves it, selected.
        await selectAndPress(c, c.querySelector("[data-flowchart-lane='sort']")!, "Delete");
        expect([laneHeads(c), laneSelected(c)]).toEqual([[...HEADS, "OVERFLOW"], "sort"]);
        // The empty lane: deleted, and nothing selected.
        await selectAndPress(c, c.querySelector("[data-flowchart-lane='overflow']")!, "Delete");
        expect([laneHeads(c), laneSelected(c)]).toEqual([HEADS, null]);
        // Two states, the second shift-clicked in: both deleted, one step.
        await gesture(() => { fireEvent.click(node(c, "IND")!); });
        await gesture(() => { fireEvent.click(node(c, "SRD")!, { shiftKey: true }); });
        await gesture(() => { fireEvent.keyDown(canvasBox(c), { key: "Delete" }); });
        expect([node(c, "IND"), node(c, "SRD")]).toEqual([null, null]);
        // The lane; the two states, their seven transitions and the queue holding both.
        expect(pending(c)).toBe(pendingText(11));
        await press(UNDO);
        expect([node(c, "IND") !== null, node(c, "SRD") !== null, pending(c)]).toEqual([true, true, pendingText(1)]);
        await press(REDO);
        expect(await save()).toEqual([ex.depotLanes.name, ex.depotQueuedDecisions.name, ex.depotStates.name, ex.depotTransitions.name].sort());
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(lanes));
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(states, { IND: undefined, SRD: undefined })));
        expect(printTransitions(await h.read(ex.depotTransitions))).toBe(printTransitions(changed(transitions, {
            l2: undefined, l3: undefined, l4: undefined, l5: undefined, l6: undefined, l11: undefined, l13: undefined,
        })));
        expect(printQueued(await h.read(ex.depotQueuedDecisions))).toBe(printQueued(changed(queued, { route: { ...queued.get("route")!, queue: [] } })));
    });

    test("a state's Del leaves a transition the rail hides that names it — Save keeps it on e3 — and Issues lists it, an unresolved end, once the rail shows it", async () => {
        const transitions = await h.read(ex.depotTransitions);
        // A returns' transition out of a parcels' state: the rail, on the parcels' flow, hides it.
        await h.patch(ex.depotTransitions, changed(transitions, { r3: { ...transitions.get("r2")!, src: "SRD", dst: "INS" } }));
        const states = await h.read(ex.depotStates), held = await h.read(ex.depotTransitions);
        const { container: c } = await h.mountExample(ex.flowchartDepot);
        await selectAndPress(c, node(c, "SRD")!, "Delete");
        // The state, and the three transitions the flowchart holds naming it.
        expect([node(c, "SRD"), pending(c)]).toEqual([null, pendingText(4)]);
        expect(await save()).toEqual([ex.depotStates.name, ex.depotTransitions.name].sort());
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(states, { SRD: undefined })));
        expect(printTransitions(await h.read(ex.depotTransitions))).toBe(printTransitions(changed(held, { l5: undefined, l6: undefined, l13: undefined })));
        // The returns' flow: the transition read, its end no state e3 holds.
        await narrowFlow("Returns");
        await openTab(c, "Issues");
        await waitFor(() => expect(issues(c)).toContainEqual({
            issue: "end", where: m.issueWhere({ kind: "Transition", name: "SRD → INS" }),
            message: m.issueText({ issue: "end", link: "SRD → INS", missing: ["SRD"] }), kind: "warning",
        }));
    });

    test("Del is the canvas's alone: pressed in a field — Find's, a lane's header being renamed — it deletes nothing", async () => {
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await gesture(() => { fireEvent.click(c.querySelector("[data-flowchart-link='l13']")!); });
        const find = c.querySelector("[data-toolbar-item='seek'] input")!;
        await gesture(() => { fireEvent.keyDown(find, { key: "Backspace" }); });
        await gesture(() => { fireEvent.doubleClick(c.querySelector("[data-flowchart-lane='sort']")!); });
        await gesture(() => { fireEvent.keyDown(c.querySelector("[data-flowchart-lane-edit]")!, { key: "Delete" }); });
        expect(linkKeys(c)).toContain("l13");
        expect(pending(c)).toBe(pendingText(0));
    });
});

// ============================================================================
// A lane a state stands in, the history item and its keys
// ============================================================================

describe("a lane a state stands in, the history item and its keys", () => {
    test("a lane a state stands in can't be deleted: its × is off, and its tooltip says why", async () => {
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        const close = c.querySelector("[data-flowchart-lane-delete='sort']")!;
        expect([close.getAttribute("aria-disabled"), close.hasAttribute("data-disabled")]).toEqual(["true", true]);
        await gesture(() => { fireEvent.click(close); });
        expect([laneHeads(c), pending(c)]).toEqual([HEADS, pendingText(0)]);
        await act(async () => { fireEvent.pointerMove(close); });
        const tip = await screen.findByRole("tooltip");
        expect([tip.textContent, close.getAttribute("aria-describedby")]).toEqual([m.laneHoldsStates({ n: 2, count: "2" }), tip.id]);
    });

    test("⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in the frame — the canvas, the toolbar — but never in a field being typed into", async () => {
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await addLane(c);
        const find = c.querySelector("[data-toolbar-item='seek'] input")!;
        await gesture(() => { fireEvent.keyDown(find, { key: "z", metaKey: true }); });
        expect(laneHeads(c)).toHaveLength(6);
        await gesture(() => { fireEvent.keyDown(canvasBox(c), { key: "z", metaKey: true }); });
        expect(laneHeads(c)).toHaveLength(5);
        await gesture(() => { fireEvent.keyDown(canvasBox(c), { key: "z", metaKey: true, shiftKey: true }); });
        expect(laneHeads(c)).toHaveLength(6);
        await gesture(() => { fireEvent.keyDown(toolbar().getByRole("button", { name: UNDO }), { key: "z", ctrlKey: true }); });
        expect(laneHeads(c)).toHaveLength(5);
        await gesture(() => { fireEvent.keyDown(canvasBox(c), { key: "y", ctrlKey: true }); });
        expect(laneHeads(c)).toHaveLength(6);
    });

    test("Discard drops every draft, in every record", async () => {
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await addLane(c);
        await selectAndPress(c, node(c, "IND")!, "Delete");
        // The lane; the state and its four transitions.
        expect(pending(c)).toBe(pendingText(6));
        await press(DISCARD);
        expect([laneHeads(c), node(c, "IND") !== null, pending(c)]).toEqual([HEADS, true, pendingText(0)]);
    });
});

// ============================================================================
// Every key the Flowchart acts on goes no further than it (#1398)
// ============================================================================

describe("the keys the Flowchart acts on go no further than it (#1398)", () => {
    /** Each key that reaches the window — the last thing a key reaches, where the page around a builder hears it — while `presses` presses keys. */
    async function heard(presses: () => Promise<void>): Promise<string[]> {
        const keys: string[] = [];
        const listen = (event: KeyboardEvent) => { keys.push(event.key); };
        window.addEventListener("keydown", listen);
        try {
            await presses();
        } finally {
            window.removeEventListener("keydown", listen);
        }
        return keys;
    }
    /** Presses a key on an element, letting the renders settle. */
    const pressOn = (el: Element, key: string, held: { metaKey?: boolean } = {}) => gesture(() => { fireEvent.keyDown(el, { key, ...held }); });
    const selected = (c: HTMLElement, key: string) => node(c, key)!.hasAttribute("data-selected");

    test("Escape and Del in the canvas, ⌘Z, and a state's editor's ⏎ and Escape each act and go no further; an Escape with nothing to put back goes on", async () => {
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await gesture(() => { fireEvent.click(node(c, "IND")!); });
        expect(selected(c, "IND")).toBe(true);
        expect(await heard(() => pressOn(canvasBox(c), "Escape")), "Escape in the canvas").toEqual([]);
        expect(selected(c, "IND")).toBe(false);
        expect(await heard(() => selectAndPress(c, node(c, "CH*")!, "Delete")), "Del in the canvas").toEqual([]);
        expect(node(c, "CH*")).toBeNull();
        expect(await heard(() => pressOn(canvasBox(c), "z", { metaKey: true })), "⌘Z in the canvas").toEqual([]);
        expect(node(c, "CH*")).not.toBeNull();
        for (const key of ["Escape", "Enter"]) {
            await gesture(() => { fireEvent.doubleClick(node(c, "SRD")!); });
            const label = c.querySelector("[data-flowchart-stateeditor] input")!;
            expect(await heard(() => pressOn(label, key)), `${key} in a state's editor`).toEqual([]);
            expect(c.querySelector("[data-flowchart-stateeditor]"), key).toBeNull();
        }
        // Nothing selected, dimmed or drawn: Escape does nothing, and goes on as it came.
        expect(await heard(() => pressOn(canvasBox(c), "Escape")), "Escape with nothing to put back").toEqual(["Escape"]);
    });

    test("an Escape typed elsewhere on the page never acts on the canvas; one from the page itself, nothing focused, does only while the pointer is over the canvas", async () => {
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await gesture(() => { fireEvent.click(node(c, "IND")!); });
        // A control of the page's own, outside the frame.
        const elsewhere = document.createElement("button");
        document.body.appendChild(elsewhere);
        try {
            await pressOn(elsewhere, "Escape");
            expect(selected(c, "IND"), "an Escape on a control of the page").toBe(true);
            await pressOn(document.body, "Escape");
            expect(selected(c, "IND"), "an Escape from the page, the pointer elsewhere").toBe(true);
            await gesture(() => { fireEvent.pointerEnter(c.querySelector("[data-flowchart-body]")!); });
            await pressOn(document.body, "Escape");
            expect(selected(c, "IND"), "an Escape from the page, the pointer over the canvas").toBe(false);
        } finally {
            elsewhere.remove();
        }
    });
});

// ============================================================================
// Keys (R9, D1–D3)
// ============================================================================

describe("a new row's key (R9, D2, D3)", () => {
    test("a key the Flowchart holds is refused in the + STATE editor, which stays open, and in the form; a new state's key is the form's to change until Save", async () => {
        const before = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await gesture(() => { fireEvent.pointerEnter(c.querySelector("[data-flowchart-band='hold']")!); });
        await gesture(() => { fireEvent.click(c.querySelector("[data-flowchart-ghoststate='hold']")!); });
        const code = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-key]")!;
        await gesture(() => { fireEvent.change(code, { target: { value: "SRD" } }); });
        expect([code.getAttribute("aria-invalid"), code.getAttribute("title")]).toEqual(["true", m.stateKeyTaken({ key: "SRD" })]);
        await gesture(() => { fireEvent.keyDown(code, { key: "Enter" }); });
        expect([c.querySelector("[data-flowchart-stateeditor]") !== null, pending(c)]).toEqual([true, pendingText(0)]);
        // A key no row takes: ⏎ adds the state, selected.
        await gesture(() => { fireEvent.change(code, { target: { value: "QRT" } }); });
        expect(code.hasAttribute("aria-invalid")).toBe(false);
        await gesture(() => { fireEvent.keyDown(code, { key: "Enter" }); });
        expect([c.querySelector("[data-flowchart-stateeditor]"), node(c, "QRT")?.hasAttribute("data-selected")]).toEqual([null, true]);
        // Its key is a field of the form until Save: one the Flowchart holds refused, the footer saying why; another taken.
        expect(editors(c, "roles")).toEqual(["key:text", "label:text", "lane:reference"]);
        await retype(c, "roles", "key", "SRD");
        expect(c.querySelector("[data-flowchart-message]")?.textContent).toBe(m.inspectorKeyRefused({ name: "state", key: "SRD", why: "taken" }));
        expect(node(c, "QRT")).not.toBeNull();
        await retype(c, "roles", "key", "QRX");
        expect([node(c, "QRT"), node(c, "QRX")?.hasAttribute("data-selected")]).toEqual([null, true]);
        await retype(c, "fields", "flow", "Parcels");
        expect(await save()).toEqual([ex.depotStates.name]);
        expect(printStates(await h.read(ex.depotStates)))
            .toBe(printStates(changed(before, { QRX: { name: "", phase: "hold", seq: 4, slots: none, flow: "Parcels" } })));
    });

    test("a new state keyed as one the rail hides is checked with e3 by key, in one request: the key e3 holds is an issue holding Save off, and changing it in the form clears it", async () => {
        const before = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepot);
        // The parcels' flow: the returns' states hidden.
        expect([node(c, "SCN") !== null, node(c, "RCV")]).toEqual([true, null]);
        const from = h.requests().length;
        await addState(c, "intake", "RCV", "Rechecked");
        expect(node(c, "RCV")?.textContent).toContain("Rechecked");
        const asked = h.requests().slice(from).filter((request) => request.dataset === `records.${ex.depotStates.name}` && request.kind !== "dataset-status");
        expect(asked.map((request) => request.kind), "the requests asking e3 for the new key").toHaveLength(1);
        await openTab(c, "Issues");
        await waitFor(() => expect(issues(c)).toEqual([
            { issue: "ready", where: m.issueWhere({ kind: "State", name: "RCV" }), message: m.keyHeld({ sort: "states", key: "RCV" }), kind: "invalid" }, DLV_END,
        ]));
        expect(enabled(SAVE)).toBe(false);
        // Its key changed in the form: the state under its new key, the issue gone, Save on.
        await openTab(c, "Details");
        await retype(c, "roles", "key", "RTN");
        expect([node(c, "RCV"), node(c, "RTN") !== null]).toEqual([null, true]);
        await waitFor(() => expect(enabled(SAVE)).toBe(true));
        expect(await save()).toEqual([ex.depotStates.name]);
        expect(printStates(await h.read(ex.depotStates)))
            .toBe(printStates(changed(before, { RTN: { name: "Rechecked", phase: "intake", seq: 3, slots: none, flow: "" } })));
    });
});

// ============================================================================
// Drafts out of view (R11)
// ============================================================================

describe("a draft the rail hides (R11)", () => {
    test("waits in its session, Issues listing it; Save writes it with the rest, and a remount draws what e3 holds", async () => {
        const before = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepot);
        await renameState(c, "SCN", "Scanned in");
        expect(pending(c)).toBe(pendingText(1));
        // The returns' flow: SCN, a parcels' state, hidden, its draft waiting.
        await narrowFlow("Returns");
        await waitFor(() => expect([node(c, "SCN"), node(c, "RCV") !== null]).toEqual([null, true]));
        expect(pending(c)).toBe(pendingText(1));
        await openTab(c, "Issues");
        expect(issues(c)).toContainEqual({
            issue: "waiting", where: m.issueWhere({ kind: "State", name: "SCN" }), message: m.issueText({ issue: "waiting", name: "SCN" }), kind: "warning",
        });
        expect(enabled(SAVE)).toBe(true);
        expect(await save()).toEqual([ex.depotStates.name]);
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(before, { SCN: { ...before.get("SCN")!, name: "Scanned in" } })));
        await waitFor(() => expect(pending(c)).toBe(pendingText(0)));
        // A remount: a page of its own, on the parcels' flow, drawing what e3 holds.
        reloadPage();
        const { container: again } = await h.mountExample(ex.flowchartDepot);
        await waitFor(() => expect(node(again, "SCN")?.textContent).toContain("Scanned in"));
        expect(pending(again)).toBe(pendingText(0));
    });
});

// ============================================================================
// Save (R12)
// ============================================================================

describe("Save (R12)", () => {
    test("writes each record's changes through its own patch door, a request a record; the drafts retire as each reads back, and a remount draws what e3 holds", async () => {
        const lanes = await h.read(ex.depotLanes), states = await h.read(ex.depotStates);
        const commits = [await h.commits(ex.depotLanes), await h.commits(ex.depotStates)];
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await addLane(c);
        await renameLane(c, "sort", "Sortation");
        await renameState(c, "SCN", "Scanned in");
        expect(pending(c)).toBe(pendingText(3));
        expect(await save()).toEqual([ex.depotLanes.name, ex.depotStates.name].sort());
        expect(printLanes(await h.read(ex.depotLanes)))
            .toBe(printLanes(changed(lanes, { "lane-6": { label: laneLabel(6), seq: 6 }, sort: { ...lanes.get("sort")!, label: "Sortation" } })));
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(states, { SCN: { ...states.get("SCN")!, name: "Scanned in" } })));
        expect([await h.commits(ex.depotLanes), await h.commits(ex.depotStates)]).toEqual([["patch", ...commits[0]!], ["patch", ...commits[1]!]]);
        await waitFor(() => expect(pending(c)).toBe(pendingText(0)));
        expect(enabled(SAVE)).toBe(false);
        // A remount: a page of its own, drawing what e3 holds.
        reloadPage();
        const { container: again } = await h.mountExample(ex.flowchartDepotEditing);
        expect(laneHeads(again)).toEqual(["INTAKE", "INDUCT", "SORTATION", "HOLD", "DISPATCH", laneLabel(6).toUpperCase()]);
        expect([node(again, "SCN")?.textContent?.includes("Scanned in"), pending(again)]).toEqual([true, pendingText(0)]);
    });

    test("a record whose door refuses its Save keeps its drafts, in a banner saying why, and the other records' commits stand", async () => {
        const states = await h.read(ex.depotStates), fixed = await h.read(ex.depotFixedLanes);
        // The editing example's flowchart over the lanes as the sort plan fixes them: their door refuses every change.
        const { container: c } = await h.mountFlowchart(($) => {
            const states = $.let(Record.bind(ex.depotStates));
            const transitions = $.let(Record.bind(ex.depotTransitions));
            const fixedLanes = $.let(Record.bind(ex.depotFixedLanes));
            const decisions = $.let(Record.bind(ex.depotDecisions));
            return {
                states: Flowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots }),
                transitions: Flowchart.transitions(transitions, { from: "src", to: "dst", decision: "trigger", kind: (t) => t.kind }),
                lanes: Flowchart.lanes(fixedLanes, { label: "label", order: "seq" }),
                decisions: Flowchart.decisions(decisions, { label: (d) => d.name, owner: (d) => some(d.owner) }),
                name: "depotEditing",
            };
        });
        await renameState(c, "SCN", "Scanned in");
        await addLane(c);
        expect(await save()).toEqual([ex.depotFixedLanes.name, ex.depotStates.name].sort());
        // The states committed; the lanes refused, as they were.
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(states, { SCN: { ...states.get("SCN")!, name: "Scanned in" } })));
        expect(printLanes(await h.read(ex.depotFixedLanes))).toBe(printLanes(fixed));
        expect(banners(c)).toEqual(["rejected"]);
        const refused = slot(c, "banners").querySelector("[data-session-banner='rejected']")!.textContent;
        expect(refused).toContain(editingMessages.bannerRejected());
        expect(refused).toContain("the lanes are fixed by the sort plan");
        // The lane's draft waits on Save still, drawn; the state's retired.
        await waitFor(() => expect(pending(c)).toBe(pendingText(1)));
        expect(laneHeads(c)).toEqual([...HEADS, laneLabel(6).toUpperCase()]);
    });

    test("a Save another session's write overtakes, on the row both changed, waits on a choice — its draft kept, Save held off — and the draft chosen saves over theirs", async () => {
        const lanes = await h.read(ex.depotLanes);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await renameLane(c, "sort", "Sortation");
        await h.race(ex.depotLanes, () => { fireEvent.click(toolbar().getByRole("button", { name: SAVE })); },
            (now) => changed(now, { sort: { ...now.get("sort")!, label: "Sorting" } }));
        await waitFor(() => expect(banners(c)).toEqual(["conflicts"]));
        expect(slot(c, "banners").textContent).toContain(editingMessages.bannerConflicts({ n: 1, count: "1" }));
        // Save waits aria-disabled while a conflict does, never disabled: it keeps the focus, and its tooltip says why.
        expect(toolbar().getByRole("button", { name: SAVE }).getAttribute("aria-disabled")).toBe("true");
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(changed(lanes, { sort: { ...lanes.get("sort")!, label: "Sorting" } })));
        const [card, ...more] = await conflictCards(c);
        expect(more).toEqual([]);
        await gesture(() => { fireEvent.click(card!.radio("draft")); });
        expect(await save()).toEqual([ex.depotLanes.name]);
        expect(printLanes(await h.read(ex.depotLanes))).toBe(printLanes(changed(lanes, { sort: { ...lanes.get("sort")!, label: "Sortation" } })));
    });

    test("a Save with no answer turns into Retry, which resends the same request — written once — and the next Save is a request of its own", async () => {
        const lanes = await h.read(ex.depotLanes);
        const commits = await h.commits(ex.depotLanes);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await addLane(c);
        // Every answer to the lanes' patch is lost on its way back: it reaches e3, and the client asks again under the
        // same key until it gives up, which leaves the write unknown.
        const losing = h.e3.fail((request) => request.kind === "mutate" && request.record === ex.depotLanes.name, "lost");
        await act(async () => { fireEvent.click(toolbar().getByRole("button", { name: SAVE })); });
        const unknown = () => slot(c, "banners").querySelector("[data-session-banner='unknown']");
        await waitFor(() => expect(unknown()).not.toBeNull(), { timeout: 15_000 });
        expect(unknown()!.textContent).toContain(editingMessages.bannerUnknown());
        expect(toolbar().queryByRole("button", { name: SAVE })).toBeNull();
        losing();
        await press(editingMessages.retryRequest());
        await waitFor(() => expect(pending(c)).toBe(pendingText(0)));
        expect(banners(c)).toEqual([]);
        const retried = h.requests("mutate", ex.depotLanes.name).map((request) => request.idempotencyKey);
        expect(retried.length, "the client's asks and the Retry").toBeGreaterThan(1);
        expect(retried[0]).toBeDefined();
        expect(new Set(retried).size, "the Retry sends the same request").toBe(1);
        await addLane(c);
        await press(SAVE);
        await waitFor(() => expect(pending(c)).toBe(pendingText(0)));
        const keys = h.requests("mutate", ex.depotLanes.name).map((request) => request.idempotencyKey);
        expect(keys).toHaveLength(retried.length + 1);
        expect(keys[retried.length], "the next Save is a new one").not.toBe(retried[0]);
        // Written once each: the Retry's write and the next Save's.
        expect(await h.commits(ex.depotLanes)).toEqual(["patch", "patch", ...commits]);
        expect(printLanes(await h.read(ex.depotLanes)))
            .toBe(printLanes(changed(lanes, { "lane-6": { label: laneLabel(6), seq: 6 }, "lane-7": { label: laneLabel(7), seq: 7 } })));
    });

    test("a reload keeps the drafts in this tab: the lane added is drawn as it was, still to save", async () => {
        const first = await h.mountExample(ex.flowchartDepotEditing);
        await addLane(first.container);
        expect(laneHeads(first.container)).toEqual([...HEADS, laneLabel(6).toUpperCase()]);
        // A reload: the page and its UI store go; the tab's storage stays.
        reloadPage();
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await waitFor(() => expect(laneHeads(c)).toEqual([...HEADS, laneLabel(6).toUpperCase()]));
        expect([pending(c), enabled(SAVE)]).toEqual([pendingText(1), true]);
    });

    test("the record moving under pending drafts carries them over: another session's rename stands beside the lane drafted here, and Save is on", async () => {
        const lanes = await h.read(ex.depotLanes);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await addLane(c);
        await h.patch(ex.depotLanes, changed(lanes, { hold: { ...lanes.get("hold")!, label: "Holding" } }));
        expect(banners(c)).toEqual([]);
        expect(laneHeads(c)).toEqual(["INTAKE", "INDUCT", "SORT", "HOLDING", "DISPATCH", laneLabel(6).toUpperCase()]);
        expect([pending(c), enabled(SAVE)]).toEqual([pendingText(1), true]);
    });

    test("a lane renamed here and otherwise by another session is a conflict named by the lane's label, never its key, and its Go to selects the lane", async () => {
        const lanes = await h.read(ex.depotLanes);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await renameLane(c, "sort", "Sortation");
        await h.patch(ex.depotLanes, changed(lanes, { sort: { ...lanes.get("sort")!, label: "Sorting" } }));
        const [card, ...more] = await conflictCards(c);
        expect(more).toEqual([]);
        expect(card!.item).toBe("Sortation");
        expect(laneSelected(c)).toBeNull();
        await gesture(() => { fireEvent.click(card!.goTo()); });
        expect(laneSelected(c)).toBe("sort");
    });

    test("a state moved to one lane here and to another by another session is one conflict, at its lane alone — each side and what it was named by the lane's label, never its key; its order, moved here only, carried — and the draft chosen saves over theirs", async () => {
        const states = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        const held = centre(c, "HLD"), cleared = centre(c, "CLR");
        await drag(node(c, "SRD")!, centre(c, "SRD"), { x: held.x, y: (held.y + cleared.y) / 2 });
        // Another session's move: its lane alone, its order as it was — the one field both changed.
        await h.patch(ex.depotStates, changed(states, { SRD: { ...states.get("SRD")!, phase: "induct" } }));
        const [card, ...more] = await conflictCards(c);
        expect([card!.item, card!.yours, card!.theirs, more]).toEqual(["SRD", "Yours, Hold", "Theirs, Induct, Changed since you started editing · was Sort", []]);
        expect(node(c, "SRD")!.hasAttribute("data-conflict")).toBe(true);
        await gesture(() => { fireEvent.click(card!.radio("draft")); });
        expect(await save()).toEqual([ex.depotStates.name]);
        expect(printStates(await h.read(ex.depotStates))).toBe(printStates(changed(states, { SRD: { ...states.get("SRD")!, phase: "hold", seq: 1.5 } })));
    });

    test("a state renamed here and otherwise by another session wears the conflict's ring until a choice is made", async () => {
        const states = await h.read(ex.depotStates);
        const { container: c } = await h.mountExample(ex.flowchartDepotEditing);
        await renameState(c, "SCN", "Scanned here");
        await h.patch(ex.depotStates, changed(states, { SCN: { ...states.get("SCN")!, name: "Scanned there" } }));
        const [card, ...more] = await conflictCards(c);
        expect([card!.item, more]).toEqual(["SCN", []]);
        expect(node(c, "SCN")!.hasAttribute("data-conflict")).toBe(true);
        await gesture(() => { fireEvent.click(card!.radio("source")); });
        expect(node(c, "SCN")!.hasAttribute("data-conflict")).toBe(false);
        expect(node(c, "SCN")!.textContent).toContain("Scanned there");
    });
});
