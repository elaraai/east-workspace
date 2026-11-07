/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's inspector, Issues and Find state over the depot's records
 * (#1504, `Flowchart Records Spec.md` R15, R16, R17; R9, R11, R12, R13), on
 * e3 itself (`flowchart.test-utils.tsx`): each record bound through its patch
 * door, so a Save is a real commit, and the rail's narrowing read through
 * the states' and the transitions' sources.
 *
 * - **The pane** — on by default, `inspector={false}` taking it away; its
 *   tabs Details and Issues, Issues with its count; collapsed, a rail with its
 *   icon, the issue count and what is selected.
 * - **Every view** — a state, a ghost (an end no state is keyed by), a
 *   transition, a decision, a lane, several states, and nothing selected: the
 *   flowchart (R15). A row shows its key, printed; its roles under their words,
 *   edited through the canvas's own edits — a lane chosen from the lanes, an
 *   end from the states drawn — and its kind's form over the fields no role
 *   writes (R16); a new row's key is the viewer's to change until Save (R9).
 * - **Issues** — an end no state is keyed by, a state whose lane names none, a
 *   transition whose decision names none, a draft the rail hides with the
 *   choice hiding it, a `ready` refusal, a new key e3 holds and a Save's
 *   conflict, each selecting what it names; Go to issue on a hidden draft
 *   clears just its choices and selects it once drawn (R11, R16).
 * - **Find state** — the states drawn by key and label, those the rail hides
 *   by key through e3: a hidden pick clears just its choice and selects the
 *   state once drawn (R17).
 * - **Read only** — over records bound read only, or `readOnly`: every field
 *   printed, no gesture (R13); and **a kind's own Details** in its form's
 *   place, read only the form again.
 * - **The reads** (#1510, R33, R35–R37) — after the head and before the form,
 *   in the details' order and in full: the figures side by side in one stats
 *   grid, every other read under its title with its total; every tag in its
 *   look; the histogram on the app's axis, its caption where half and nine in
 *   ten fall — or the bin under the pointer or focus, the bins one stop on the
 *   keyboard; a list by value, each line's note, the first 8 then Show n more
 *   and Show fewer; *no data* where there is no row; beside a kind's own
 *   Details, and read only.
 *
 * jsdom lays nothing out: the canvas places its cards by its own layout, and
 * the panes keep the place they open in.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    East, FunctionType, NullType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant,
    type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { MutationResultType, ResponseType } from "@elaraai/e3-types";
import { Button, RecordSliceStateType, Text, UIComponentType, type RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { StateRuntime, editingMessages, formatters, getSomeorUndefined } from "@elaraai/east-ui-components";
import { Data, Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import type { E3Request } from "../e3-web.test-utils.js";
import { reloadPage, slot } from "../e3-web-mount.test-utils.js";
import { act, enabled, flowchartHarness, press, settle, toolbar, type FlowchartTestProps } from "./flowchart.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness();

const m = flowchartMessages;
const WORDS = formatters("en-US");
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();
const printText = printFor(StringType);
const compareString = compareFor(StringType);
const stateEqual = equalFor(ex.DepotState);
const transitionEqual = equalFor(ex.DepotTransition);
const laneEqual = equalFor(ex.DepotLane);
const decisionEqual = equalFor(ex.DepotDecision);
const statesEqual = equalFor(ex.depotStates.type);

/** The depot's rail, as `Slice.bindRecords` keys it. */
const DEPOT = "flowchart.depot";
/** The states' record, as its dataset's requests name it. */
const STATES = `records.${ex.depotStates.name}`;

/**
 * A record's rows with one row set.
 *
 * @param rows - The rows, as e3 holds them
 * @param key - The row's key
 * @param row - Its row
 * @returns The rows, the one set
 */
function withRow<V>(rows: ReadonlyMap<string, V>, key: string, row: V): SortedMap<string, V> {
    const out = new SortedMap<string, V>(rows, compareString);
    out.set(key, row);
    return out;
}

// ── The rail ──────────────────────────────────────────────────────────────

type Where = ValueTypeOf<RecordSliceWhereType>;

/** A narrowing: each field's values chosen, printed as the rail prints them. */
function where(choices: { readonly [field: string]: readonly string[] }): Where {
    return new SortedMap(Object.entries(choices).map(([field, values]) => [field, variant("values", values.map((value) => printText(value)))]), compareString);
}

/** Writes a source of the depot's rail, as its chips do, and settles. */
async function narrow(source: string, next: Where): Promise<void> {
    const key = `${DEPOT}.${source}`;
    const store = StateRuntime.getStore();
    const held = store.read(key);
    const state = held === undefined ? { where: next, preset: none, resolution: none } : { ...decodeBeast2For(RecordSliceStateType)(held), preset: none, where: next };
    await act(async () => { store.write(key, encodeBeast2For(RecordSliceStateType)(state)); });
    await settle();
}

/** A source of the depot's rail, as the rail holds it. */
const whereOf = (source: string): Where => decodeBeast2For(RecordSliceStateType)(StateRuntime.getStore().read(`${DEPOT}.${source}`)!).where;

/** A read by key's body, as the request log holds it: the keys it reads, each as East prints it, in East's order. */
const keysOf = (request: E3Request): string[] =>
    [...((JSON.parse(new TextDecoder().decode(request.body)) as { keys?: string[] }).keys ?? [])].sort(compareString);

// ── Reading the flowchart ─────────────────────────────────────────────────

const node = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-flowchart-node="${key}"]`);
const link = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-flowchart-link="${key}"]`);
const selected = (c: HTMLElement, key: string): boolean => node(c, key)?.hasAttribute("data-selected") === true;
/** The lane heads, as the canvas prints them. */
const laneHeads = (c: HTMLElement) => [...c.querySelectorAll("[data-flowchart-lane-head] [data-flowchart-lane]")].map((el) => el.textContent);
/** The lanes the canvas draws a header for, by key. */
const laneKeys = (c: HTMLElement) => [...c.querySelectorAll("[data-flowchart-lane-head]")].map((el) => el.getAttribute("data-flowchart-lane-head") ?? "");
/** What waits on Save, as the footer counts it. */
const pending = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-pending]")?.textContent ?? null;
const pendingOf = (n: number): string => ` · ${m.footerPending({ n, count: WORDS.number(n) })}`;
/** What the footer says of a gesture refused. */
const footerMessage = (c: HTMLElement): string => c.querySelector("[data-flowchart-message]")?.textContent ?? "";

/** The inspector pane. */
const pane = (c: HTMLElement): HTMLElement | null => c.querySelector<HTMLElement>("[data-frame-slot='end']");
/** Its open tab's panel. */
const panel = (c: HTMLElement): HTMLElement => pane(c)!.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** Its tabs, as their names and counts read. */
const tabs = (c: HTMLElement) => [...pane(c)!.querySelectorAll("[role='tab']")].map((t) => t.textContent);
/** What Details shows. */
const showing = (c: HTMLElement) => panel(c).querySelector("[data-flowchart-inspector]")?.getAttribute("data-flowchart-inspector") ?? null;
/** Details' head: what it shows, and its name. */
const head = (c: HTMLElement) => [
    panel(c).querySelector("[data-inspector-what]")?.textContent ?? null,
    panel(c).querySelector("[data-inspector-name]")?.textContent ?? null,
];
/** Details' chip: Pending, New, No state row. */
const chip = (c: HTMLElement): string | null => panel(c).querySelector("[data-inspector-chip]")?.textContent ?? null;
/** A form's fields in order — the roles' or the kind's — each its key and its editor. */
const editors = (c: HTMLElement, form: "roles" | "fields") => [...panel(c).querySelectorAll(`[data-inspector-form="${form}"] [data-field]`)]
    .map((el) => `${el.getAttribute("data-field") ?? ""}:${el.getAttribute("data-editor") ?? ""}`);
/** A form's fields' words, in order. */
const labels = (c: HTMLElement, form: "roles" | "fields") => [...panel(c).querySelectorAll(`[data-inspector-form="${form}"] [data-field]`)]
    .map((el) => el.querySelector("label")?.textContent ?? null);
/** A field of Details, by its key. */
const field = (c: HTMLElement, key: string): HTMLElement => panel(c).querySelector<HTMLElement>(`[data-field="${key}"]`)!;
/** A field's text box. */
const box = (c: HTMLElement, key: string): HTMLInputElement => within(field(c, key)).getByRole("textbox") as HTMLInputElement;
/** A gesture's button in Details. */
const action = (c: HTMLElement, name: "duplicate" | "delete"): HTMLButtonElement | null => panel(c).querySelector(`[data-inspector-action="${name}"]`);
/** The transitions Details lists, by their keys. */
const links = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-inspector-link]")].map((el) => el.getAttribute("data-inspector-link"));
/** The transitions Details lists, each as it reads: its ends, then its kind, its decision and its evidence. */
const linkTexts = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-inspector-link]")].map((el) => el.textContent);
/** The groups of a state's transitions: each its head, then its transitions' keys. */
const linkGroups = (c: HTMLElement) => [...panel(c).querySelectorAll<HTMLElement>("[data-inspector-link-list]")].map((list) => [
    panel(c).querySelector(`[data-inspector-link-group="${list.getAttribute("data-inspector-link-list") ?? ""}"]`)?.textContent ?? null,
    ...[...list.querySelectorAll("[data-inspector-link]")].map((el) => el.getAttribute("data-inspector-link")),
]);
/** The head over the transitions Details lists. */
const linksTitle = (c: HTMLElement) => panel(c).querySelector("[data-inspector-links]")?.firstElementChild?.textContent ?? null;
/** Issues, each as it reads: what it names, what it says and how, and the rail's choices hiding it. */
const issues = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-inspector-issue]")].map((el) => [
    el.querySelector("span:first-child")?.textContent ?? null,
    el.querySelector("[data-kind]")?.textContent ?? null,
    el.querySelector("[data-kind]")?.getAttribute("data-kind") ?? null,
    ...(el.querySelector("[data-inspector-issue-hidden]") === null ? [] : [el.querySelector("[data-inspector-issue-hidden]")!.textContent]),
]);
/** DSP → DLV's issue: its far end no state is keyed by. */
const DLV_ISSUE = [m.issueWhere({ kind: "Transition", name: "DSP → DLV" }), m.issueText({ issue: "end", link: "DSP → DLV", missing: ["DLV"] }), "warning"];

// ── Gestures ──────────────────────────────────────────────────────────────

/** Clicks an element, as a pointer does, and lets the flowchart settle. */
async function click(el: Element, init: { shiftKey?: boolean } = {}): Promise<void> {
    await act(async () => { fireEvent.click(el, init); });
    await settle();
}

/** Types a field's new text and commits it with ⏎. */
async function retype(c: HTMLElement, key: string, text: string): Promise<void> {
    const user = userEvent.setup();
    await user.clear(box(c, key));
    if (text !== "") await user.type(box(c, key), text);
    await user.type(box(c, key), "{Enter}");
    await settle();
}

/** A select's listbox, opened from its field's trigger. */
async function listboxOf(c: HTMLElement, key: string): Promise<HTMLElement> {
    const trigger = field(c, key).querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await act(async () => { fireEvent.click(trigger); });
    return document.getElementById(trigger.getAttribute("aria-controls")!)!;
}

/** Picks a choice in Details, by its field and its words: a radio of a radio group, else in its select's listbox. */
async function choose(c: HTMLElement, key: string, name: string): Promise<void> {
    const item = [...field(c, key).querySelectorAll<HTMLElement>("[data-field-choice=radio] [data-scope=radio-group][data-part=item]")].find((i) => i.textContent === name);
    if (item !== undefined) {
        await act(async () => { fireEvent.click(item.querySelector("input")!); });
        await settle();
        return;
    }
    const listbox = await listboxOf(c, key);
    await act(async () => { fireEvent.click(within(listbox).getByRole("option", { name })); });
    await settle();
}

/** Opens one of the inspector's tabs, by its name. */
async function openTab(c: HTMLElement, name: string): Promise<void> {
    const tab = [...pane(c)!.querySelectorAll("[role='tab']")].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no inspector tab ${name}`);
    await click(tab);
}


// ── Find state ────────────────────────────────────────────────────────────

/** Find state's box, in the toolbar's row. */
const findBox = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
const findInput = (c: HTMLElement) => findBox(c).querySelector<HTMLInputElement>("input")!;

/** Types into Find's box, a key at a time, as a person does. */
async function typeIntoFind(c: HTMLElement, text: string): Promise<void> {
    const input = findInput(c);
    for (const key of text) {
        const typed = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(typed));
    }
}

/** Find's list, its lines as they read: the listbox its box controls — a select of Details lists its own choices. */
const lines = (c: HTMLElement) => [...(document.getElementById(findInput(c).getAttribute("aria-controls")!)?.querySelectorAll('[role="option"]') ?? [])]
    .map((option) => option.textContent);

// ── Mounting ──────────────────────────────────────────────────────────────

/** Mounts an example as a ui task draws it — the depot unless given — and waits until the canvas draws `first`. */
async function open(example: { fn: { toIR(): unknown } } = ex.flowchartDepot, first = "ARV"): Promise<HTMLElement> {
    const { container } = await h.mountExample(example);
    await waitFor(() => expect(node(container, first)).not.toBeNull());
    return container;
}

/** The depot's states, transitions and lanes bound through their patch doors and read whole, with the props given. */
const records = (extra: { readonly inspector?: boolean; readonly readOnly?: boolean } = {}) => ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
    const states = $.let(Record.bind(ex.depotStates));
    const transitions = $.let(Record.bind(ex.depotTransitions));
    const lanes = $.let(Record.bind(ex.depotLanes));
    return {
        states: Flowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots }),
        transitions: Flowchart.transitions(transitions, { from: "src", to: "dst", kind: (t) => t.kind }),
        lanes: Flowchart.lanes(lanes, { label: "label", order: "seq" }),
        ...extra,
    };
};

/** Mounts a flowchart the test builds, and waits until the canvas draws `first`. */
async function mountRecords(props: ($: BlockBuilder<UIComponentType>) => FlowchartTestProps, first = "ARV"): Promise<HTMLElement> {
    const { container } = await h.mountFlowchart(props);
    await waitFor(() => expect(node(container, first)).not.toBeNull());
    return container;
}

// ============================================================================
// The pane
// ============================================================================

describe("the pane (R16)", () => {
    test("is on by default — no prop — its tabs Details and Issues, Issues with its count; collapsed, a rail with its icon, the issue count and what is selected", async () => {
        const c = await open();
        expect(tabs(c)).toEqual(["Details", "Issues 1"]);
        expect(showing(c)).toBe("flowchart");
        await click(node(c, "CH*")!);
        await click(within(pane(c)!).getByRole("button", { name: `Collapse ${m.inspectorPane()}` }));
        expect(pane(c)!.hasAttribute("data-collapsed")).toBe(true);
        const detail = pane(c)!.querySelector<HTMLElement>("[data-dock-detail]")!;
        expect(detail.textContent).toBe("State · CH*");
        const rail = detail.parentElement!;
        expect(rail.querySelector('svg[data-icon="sliders"]')).not.toBeNull();
        expect(within(rail).getByText("1")).toBeTruthy();
    });

    test("`inspector={false}` takes it away; `true` gives it, as no prop does", async () => {
        const off = await mountRecords(records({ inspector: false }));
        expect([pane(off), off.querySelector("[data-frame-slot='main']") !== null]).toEqual([null, true]);
        reloadPage();
        const on = await mountRecords(records({ inspector: true }));
        expect(tabs(on)).toEqual(["Details", "Issues 1"]);
    });
});

// ============================================================================
// Details: a state, and a ghost
// ============================================================================

describe("Details: a state (R16, R9)", () => {
    test("its key printed, its roles under their words — a lane chosen from the lanes — its kind's form over the fields no role writes, and its transitions In, Out and In place, each selecting it", async () => {
        const c = await open();
        await click(node(c, "CH*")!);
        expect(showing(c)).toBe("state");
        expect([head(c), chip(c)]).toEqual([["State · CH*", "Sort chutes (class)"], null]);
        expect([editors(c, "roles"), editors(c, "fields")]).toEqual([["key:readonly", "label:text", "lane:reference"], ["slots:number", "flow:text"]]);
        expect(labels(c, "roles")).toEqual([m.inspectorField({ field: "key" }), m.inspectorField({ field: "label" }), "Lane"]);
        expect([box(c, "key").value, box(c, "label").value, box(c, "flow").value]).toEqual(["CH*", "Sort chutes (class)", "Parcels"]);
        expect(within(field(c, "slots")).getByRole("spinbutton").getAttribute("aria-valuenow")).toBe("14");
        expect(field(c, "lane").querySelector("[data-scope=select][data-part=trigger]")!.textContent).toContain("Sort");
        // IND's transitions in their groups, each with its kind, its decision and its evidence's volume (R37).
        await click(node(c, "IND")!);
        expect(linksTitle(c)).toBe(m.inspectorSection({ section: "transitions", n: 4, count: "4", name: "Transition" }));
        expect(linkGroups(c)).toEqual([
            [m.inspectorSection({ section: "in", n: 1, count: "1", name: "" }), "l2"],
            [m.inspectorSection({ section: "out", n: 2, count: "2", name: "" }), "l11", "l4"],
            [m.inspectorSection({ section: "inPlace", n: 1, count: "1", name: "" }), "l3"],
        ]);
        expect(linkTexts(c)).toEqual([
            `SCN → IND${m.inspectorLinkKind({ kind: "planned", decision: undefined })}${m.inspectorVolume({ volume: "18,390 parcels" })}`,
            `IND → LBL${m.inspectorLinkKind({ kind: "observed", decision: undefined })}${m.inspectorVolume({ volume: "980 parcels" })}`,
            `IND → CH*${m.inspectorLinkKind({ kind: "planned", decision: "route" })}${m.inspectorVolume({ volume: "17,350 parcels" })}`,
            `IND → IND${m.inspectorLinkKind({ kind: "observed", decision: undefined })}${m.inspectorVolume({ volume: undefined })}`,
        ]);
        // A transition listed selects it.
        await click(panel(c).querySelector("[data-inspector-link='l3']")!);
        expect([showing(c), head(c)[0]]).toEqual(["transition", "Transition · IND → IND"]);
    });

    test("a label typed is one step, Pending and tinted against the record; Undo takes it back; Save commits the states through their patch door, every other field as it was (R8)", async () => {
        const before = await h.commits(ex.depotStates);
        const stored = await h.read(ex.depotStates);
        const c = await open();
        await click(node(c, "IND")!);
        await retype(c, "label", "Inducted twice");
        expect(node(c, "IND")!.textContent).toContain("Inducted twice");
        expect([pending(c), chip(c)]).toEqual([pendingOf(1), m.inspectorChip({ state: "pending" })]);
        expect([field(c, "label").hasAttribute("data-dirty"), field(c, "key").hasAttribute("data-dirty")]).toEqual([true, false]);
        await press(UNDO);
        expect([node(c, "IND")!.textContent?.includes("twice"), enabled(UNDO)]).toEqual([false, false]);
        await press(REDO);
        await press(SAVE);
        expect(statesEqual(await h.read(ex.depotStates), withRow(stored, "IND", { ...stored.get("IND")!, name: "Inducted twice" }))).toBe(true);
        expect(await h.commits(ex.depotStates)).toEqual(["patch", ...before]);
        expect([pending(c), chip(c)]).toEqual([pendingOf(0), null]);
    });

    test("its lane chosen from the lanes, its slots set and cleared, its flow typed: each one step, through the canvas's own edits (R8)", async () => {
        const stored = await h.read(ex.depotStates);
        const c = await open(ex.flowchartDepotEditing);
        await click(node(c, "SRD")!);
        await choose(c, "lane", "Hold");
        // Drawn in the Hold lane, with HLD.
        expect(node(c, "SRD")!.style.left).toBe(node(c, "HLD")!.style.left);
        // No slots: Set gives it some, Clear takes them away.
        expect(field(c, "slots").querySelector("[data-field-clear]")).toBeNull();
        await click(field(c, "slots").querySelector("[data-field-set]")!);
        const set = within(field(c, "slots")).getByRole("spinbutton").getAttribute("aria-valuenow") ?? "";
        expect(node(c, "SRD")!.textContent).toContain(`×${set}`);
        await click(field(c, "slots").querySelector("[data-field-clear]")!);
        expect(node(c, "SRD")!.textContent).not.toContain("×");
        await retype(c, "flow", "Returns");
        expect(pending(c)).toBe(pendingOf(1));
        // Four edits, four steps.
        for (let i = 0; i < 4; i++) await press(UNDO);
        expect([enabled(UNDO), pending(c)]).toEqual([false, pendingOf(0)]);
        for (let i = 0; i < 4; i++) await press(REDO);
        await press(SAVE);
        const saved = (await h.read(ex.depotStates)).get("SRD")!;
        expect(stateEqual(saved, { ...stored.get("SRD")!, phase: "hold", flow: "Returns", seq: saved.seq })).toBe(true);
    });

    test("a new state's key — a duplicate's — is the viewer's to change in the form until Save, refused when empty or held by another; once saved, it is printed (R9)", async () => {
        const stored = await h.read(ex.depotStates);
        const c = await open(ex.flowchartDepotEditing);
        await click(node(c, "CH*")!);
        await click(action(c, "duplicate")!);
        expect([head(c), chip(c), editors(c, "roles")[0]]).toEqual([["State · CH*-2", "Sort chutes (class)"], m.inspectorChip({ state: "new" }), "key:text"]);
        await retype(c, "key", "");
        expect([footerMessage(c), box(c, "key").value]).toEqual([m.inspectorKeyRefused({ name: "state", key: "", why: "empty" }), "CH*-2"]);
        await retype(c, "key", "SRD");
        expect([footerMessage(c), box(c, "key").value]).toEqual([m.inspectorKeyRefused({ name: "state", key: "SRD", why: "taken" }), "CH*-2"]);
        await retype(c, "key", "CH2");
        expect([node(c, "CH*-2"), selected(c, "CH2"), head(c)[0]]).toEqual([null, true, "State · CH2"]);
        await press(SAVE);
        const saved = (await h.read(ex.depotStates)).get("CH2")!;
        expect(stateEqual(saved, { ...stored.get("CH*")!, seq: saved.seq })).toBe(true);
        // Saved, its key is printed.
        expect(editors(c, "roles")[0]).toBe("key:readonly");
    });

    test("Delete takes it with every transition naming it, and selects nothing", async () => {
        const c = await open(ex.flowchartDepotEditing);
        await click(node(c, "CH*")!);
        await click(action(c, "delete")!);
        expect([node(c, "CH*"), link(c, "l4"), link(c, "l5"), link(c, "l12")]).toEqual([null, null, null, null]);
        expect([showing(c), pending(c)]).toEqual(["flowchart", pendingOf(4)]);
    });

    test("an end no state is keyed by — a ghost — says so, with its transitions; Delete takes them away", async () => {
        const c = await open();
        await click(node(c, "DLV")!);
        expect([showing(c), head(c), chip(c)]).toEqual(["ghost", ["State · DLV", "DLV"], m.inspectorChip({ state: "noRow" })]);
        expect(panel(c).querySelector("[data-inspector-fact='ghost']")!.textContent)
            .toBe(m.inspectorNoRow({ n: 1, count: "1", key: "DLV", state: "state", transition: "transition" }));
        expect(links(c)).toEqual(["l10"]);
        await click(action(c, "delete")!);
        expect([node(c, "DLV"), link(c, "l10"), showing(c)]).toEqual([null, null, "flowchart"]);
        expect(tabs(c)).toEqual(["Details", "Issues 0"]);
    });
});

// ============================================================================
// Details: a transition
// ============================================================================

describe("Details: a transition (R16)", () => {
    test("its ends and its decision under their words, its kind's form over the fields no role writes, and its evidence read only", async () => {
        const measured = getSomeorUndefined((await h.read(ex.depotTransitions)).get("l4")!.at);
        const c = await open();
        await click(link(c, "l4")!);
        expect(showing(c)).toBe("transition");
        expect(head(c)).toEqual(["Transition · IND → CH*", "Inducted → Sort chutes (class)"]);
        expect([editors(c, "roles"), editors(c, "fields")]).toEqual([["from:reference", "to:reference", "decision:reference"], ["kind:select", "flow:text"]]);
        expect(labels(c, "roles")).toEqual([m.inspectorField({ field: "from" }), m.inspectorField({ field: "to" }), "Decision"]);
        const evidence = panel(c).querySelector<HTMLElement>("[data-inspector-evidence]")!;
        expect([...evidence.querySelectorAll("[data-field]")].map((el) => [el.getAttribute("data-field"), el.getAttribute("data-editor"), el.querySelector("input")?.value]))
            .toEqual([
                ["volume", "readonly", "17,350 parcels"],
                ["count", "readonly", "386"],
                ["measured", "readonly", measured === undefined ? null : WORDS.dateTime(measured)],
            ]);
    });

    test("each edit one step — its decision, none among them; its end, chosen from the states drawn; its kind — and Save commits the transitions through their patch door", async () => {
        const stored = await h.read(ex.depotTransitions);
        const c = await open(ex.flowchartDepotEditing);
        await click(link(c, "l5")!);
        await choose(c, "decision", "route");
        // Its far end: every state drawn, each by its key and its label, in the order the states are placed.
        const listbox = await listboxOf(c, "to");
        expect(within(listbox).getAllByRole("option").map((option) => option.textContent)).toEqual([
            "ARV · Arrived", "CH* · Sort chutes (class)", "HLD · Held", "IND · Inducted", "LDD · Loaded",
            "CLR · Cleared", "DSP · Dispatched", "LBL · Relabelled", "SCN · Scanned", "SRD · Sorted",
            "INS · Inspected", "RCV · Received", "RSD · Resent",
        ]);
        await act(async () => { fireEvent.click(within(listbox).getByRole("option", { name: "IND · Inducted" })); });
        await settle();
        expect(head(c)[0]).toBe("Transition · CH* → IND");
        await choose(c, "kind", "Observed");
        await choose(c, "decision", m.noDecision());
        expect(pending(c)).toBe(pendingOf(1));
        for (let i = 0; i < 4; i++) await press(UNDO);
        expect(enabled(UNDO)).toBe(false);
        for (let i = 0; i < 4; i++) await press(REDO);
        await press(SAVE);
        expect(transitionEqual((await h.read(ex.depotTransitions)).get("l5")!, { ...stored.get("l5")!, dst: "IND", kind: variant("observed", null), trigger: none })).toBe(true);
    });

    test("Delete deletes it, and selects nothing", async () => {
        const c = await open();
        await click(link(c, "l4")!);
        await click(action(c, "delete")!);
        expect([link(c, "l4"), showing(c)]).toEqual([null, "flowchart"]);
    });
});

// ============================================================================
// Details: a decision, a lane, several states
// ============================================================================

describe("Details: a decision, a lane, several states (R16, R9)", () => {
    test("a decision: its key printed, its kind's form, the transitions it governs; an edit one step, which Save commits; Delete clears it from them, both records saved", async () => {
        const decisionsBefore = await h.commits(ex.depotDecisions);
        const transitions = await h.read(ex.depotTransitions);
        const c = await open();
        await click(c.querySelector("[data-flowchart-trigger='route']")!);
        expect(showing(c)).toBe("decision");
        expect(head(c)).toEqual(["Decision · R", "route"]);
        expect([editors(c, "roles"), editors(c, "fields")]).toEqual([["key:readonly"], ["name:text", "owner:text"]]);
        expect([box(c, "key").value, box(c, "owner").value]).toEqual(["route", "sort-planner"]);
        expect([linksTitle(c), links(c)]).toEqual([m.inspectorSection({ section: "governs", n: 1, count: "1", name: "Transition" }), ["l4"]]);
        await retype(c, "owner", "night-supervisor");
        expect(pending(c)).toBe(pendingOf(1));
        await press(SAVE);
        expect(decisionEqual((await h.read(ex.depotDecisions)).get("route")!, { name: "route", owner: "night-supervisor" })).toBe(true);
        expect(await h.commits(ex.depotDecisions)).toEqual(["patch", ...decisionsBefore]);
        // Deleted: its diamond goes, and it is cleared from the transition it governed.
        await click(action(c, "delete")!);
        expect([c.querySelector("[data-flowchart-trigger='route']"), showing(c), pending(c)]).toEqual([null, "flowchart", pendingOf(2)]);
        await press(SAVE);
        expect((await h.read(ex.depotDecisions)).has("route")).toBe(false);
        expect(transitionEqual((await h.read(ex.depotTransitions)).get("l4")!, { ...transitions.get("l4")!, trigger: none })).toBe(true);
    });

    test("a lane, a click on its header: its key printed, its label, how many states it holds, and Delete off while it holds any, saying why; a rename one step, which Save commits", async () => {
        const c = await open();
        await click(c.querySelector("[data-flowchart-lane='sort']")!);
        expect([showing(c), head(c)]).toEqual(["lane", ["Lane · Sort", null]]);
        expect([editors(c, "roles"), editors(c, "fields")]).toEqual([["key:readonly", "label:text"], []]);
        expect(panel(c).querySelector("[data-inspector-fact='lane']")!.textContent).toBe(m.inspectorLaneStates({ n: 2, count: "2", name: "state" }));
        expect(action(c, "delete")!.disabled).toBe(true);
        expect(panel(c).querySelector("[data-inspector-why]")!.textContent).toBe(m.laneHoldsStates({ n: 2, count: "2", name: "state" }));
        await retype(c, "label", "Sorting");
        expect([laneHeads(c), head(c)[0]]).toEqual([["INTAKE", "INDUCT", "SORTING", "HOLD", "DISPATCH"], "Lane · Sorting"]);
        await press(SAVE);
        expect(laneEqual((await h.read(ex.depotLanes)).get("sort")!, { label: "Sorting", seq: 3 })).toBe(true);
    });

    test("a new lane: its key the viewer's to change until Save, refused when empty or held by another; empty, its Delete takes it away (R9)", async () => {
        const c = await open();
        const was = laneKeys(c);
        await click(c.querySelector("[data-flowchart-addlane]")!);
        expect(laneKeys(c)).toEqual([...was, "lane-6"]);
        await click(c.querySelector("[data-flowchart-lane='lane-6']")!);
        expect([head(c), chip(c), editors(c, "roles")]).toEqual([
            [m.inspectorWhat({ what: "row", kind: "Lane", name: m.newLane({ n: 6, count: "6" }) }), null], m.inspectorChip({ state: "new" }), ["key:text", "label:text"],
        ]);
        await retype(c, "key", "");
        expect([footerMessage(c), box(c, "key").value]).toEqual([m.inspectorKeyRefused({ name: "lane", key: "", why: "empty" }), "lane-6"]);
        await retype(c, "key", "intake");
        expect([footerMessage(c), box(c, "key").value]).toEqual([m.inspectorKeyRefused({ name: "lane", key: "intake", why: "taken" }), "lane-6"]);
        await retype(c, "key", "yard");
        expect(laneKeys(c)).toEqual([...was, "yard"]);
        await press(SAVE);
        expect(laneEqual((await h.read(ex.depotLanes)).get("yard")!, { label: m.newLane({ n: 6, count: "6" }), seq: 6 })).toBe(true);
        // Saved and holding no state: its key printed, its Delete on.
        expect([editors(c, "roles")[0], action(c, "delete")!.disabled]).toEqual(["key:readonly", false]);
        await click(action(c, "delete")!);
        expect([laneKeys(c), showing(c)]).toEqual([was, "flowchart"]);
    });

    test("several states, a shift-click putting one into the selection: their count; a lane every one moves to; Delete takes them all — each one step", async () => {
        const c = await open(ex.flowchartDepotEditing);
        await click(node(c, "IND")!);
        await click(node(c, "SRD")!, { shiftKey: true });
        expect(showing(c)).toBe("several");
        expect(panel(c).querySelector("[data-inspector-several]")!.textContent).toBe(m.inspectorWhat({ what: "several", n: 2, count: "2", name: "state" }));
        expect([selected(c, "IND"), selected(c, "SRD")]).toEqual([true, true]);
        await choose(c, "lane", "Hold");
        expect(pending(c)).toBe(pendingOf(2));
        await click(action(c, "delete")!);
        expect([node(c, "IND"), node(c, "SRD"), showing(c)]).toEqual([null, null, "flowchart"]);
        await press(UNDO);
        await press(UNDO);
        expect(pending(c)).toBe(pendingOf(0));
        // A shift-click on a state selected takes it out: the one left is selected alone.
        await click(node(c, "IND")!);
        await click(node(c, "CH*")!, { shiftKey: true });
        await click(node(c, "IND")!, { shiftKey: true });
        expect([showing(c), head(c)[0]]).toEqual(["state", "State · CH*"]);
    });
});

// ============================================================================
// Nothing selected: the flowchart (R15)
// ============================================================================

describe("Details: nothing selected — the flowchart (R15)", () => {
    test("it names the flowchart: the lanes, states, transitions and decisions it holds, counted; planned · observed · unresolved; each record's last save and who made it; and its hints — a click where nothing is coming back here", async () => {
        // A clock from 14:02 of one day, moving on, so e3 stamps another session's save of the states on the day the flowchart calls today.
        vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
        vi.setSystemTime(new Date("2026-10-06T14:02:00Z"));
        try {
            const stored = await h.read(ex.depotStates);
            await h.patch(ex.depotStates, withRow(stored, "SCN", { ...stored.get("SCN")!, name: "Scanned in" }));
            const newest = async (record: { readonly name: string }) => (await h.history(record)).commits[0]!;
            const [states, transitions, lanes, decisions] = [await newest(ex.depotStates), await newest(ex.depotTransitions), await newest(ex.depotLanes), await newest(ex.depotDecisions)];
            const c = await open();
            expect([showing(c), head(c)]).toEqual(["flowchart", [m.inspectorWhat({ what: "flowchart" }), null]]);
            expect([...panel(c).querySelectorAll("[data-count]")].map((el) => [el.getAttribute("data-count"), el.textContent])).toEqual([
                ["lanes", `5${m.inspectorCount({ name: "Lane", n: 5 })}`],
                ["states", `10${m.inspectorCount({ name: "State", n: 10 })}`],
                ["transitions", `13${m.inspectorCount({ name: "Transition", n: 13 })}`],
                ["decisions", `2${m.inspectorCount({ name: "Decision", n: 2 })}`],
            ]);
            // IND → IND stands in place: neither planned nor observed between two states.
            expect(panel(c).querySelector("[data-inspector-fact='split']")!.textContent).toBe(m.inspectorSplit({ planned: "9", observed: "2", unresolved: "1" }));
            // The states' last save today, its time and the session that made it; the deploy's, on its day, by no one.
            expect([...panel(c).querySelectorAll("[data-inspector-saved]")].map((el) => [el.getAttribute("data-inspector-saved"), el.textContent])).toEqual([
                ["states", m.inspectorSaved({ name: "State", when: WORDS.time(states.at), by: "another session" })],
                ["transitions", m.inspectorSaved({ name: "Transition", when: WORDS.dateTime(transitions.at), by: undefined })],
                ["lanes", m.inspectorSaved({ name: "Lane", when: WORDS.dateTime(lanes.at), by: undefined })],
                ["decisions", m.inspectorSaved({ name: "Decision", when: WORDS.dateTime(decisions.at), by: undefined })],
            ]);
            expect([...panel(c).querySelectorAll("li")].map((li) => li.textContent)).toEqual(([1, 2, 3] as const).map((n) => m.inspectorHint({ n, edits: true })));
            // A click where nothing is comes back here.
            await click(node(c, "IND")!);
            await click(c.querySelector("[data-flowchart-canvas]")!);
            expect(showing(c)).toBe("flowchart");
        } finally {
            vi.useRealTimers();
        }
    });
});

// ============================================================================
// Issues (R16)
// ============================================================================

describe("Issues (R16)", () => {
    test("an end no state is keyed by, a state whose lane names none of the lanes and a transition whose decision names none of the decisions — the state's first, then the transitions' in key order — each a click selecting what it names", async () => {
        const states = await h.read(ex.depotStates);
        await h.patch(ex.depotStates, withRow(states, "LDD", { ...states.get("LDD")!, phase: "yard" }));
        const transitions = await h.read(ex.depotTransitions);
        await h.patch(ex.depotTransitions, withRow(transitions, "l8", { ...transitions.get("l8")!, trigger: some("night") }));
        const c = await open();
        // LDD stands in the last band, No lane.
        expect(c.querySelector("[data-flowchart-band-kind='noLane'] [data-flowchart-lane]")?.textContent).toBe(m.noLaneBand().toUpperCase());
        await openTab(c, "Issues");
        expect(tabs(c)).toEqual(["Details", "Issues 3"]);
        expect(issues(c)).toEqual([
            [m.issueWhere({ kind: "State", name: "LDD" }), m.issueText({ issue: "lane", state: "LDD", lane: "yard" }), "warning"],
            DLV_ISSUE,
            [m.issueWhere({ kind: "Transition", name: "CLR → LDD" }), m.issueText({ issue: "decision", link: "CLR → LDD", decision: "night" }), "warning"],
        ]);
        const goTo = async (i: number) => {
            await click(panel(c).querySelectorAll("[data-inspector-issue]")[i]!);
            await openTab(c, "Details");
            const shown = [showing(c), head(c)[0]];
            await openTab(c, "Issues");
            return shown;
        };
        expect(await goTo(0)).toEqual(["state", "State · LDD"]);
        expect(await goTo(1)).toEqual(["transition", "Transition · DSP → DLV"]);
        expect(await goTo(2)).toEqual(["transition", "Transition · CLR → LDD"]);
    });

    test("a draft the rail hides is listed with the choice hiding it; Go to issue clears just that choice and selects it once drawn (R11, the shared hidden pick)", async () => {
        const c = await open(ex.flowchartDepot, "CLR");
        await click(node(c, "CLR")!);
        await retype(c, "label", "Cleared at the desk");
        await narrow("states", where({ flow: ["Returns"] }));
        await waitFor(() => expect(node(c, "CLR")).toBeNull());
        await openTab(c, "Issues");
        await waitFor(() => expect(issues(c)).toEqual([[
            m.issueWhere({ kind: "State", name: "CLR" }), m.issueText({ issue: "waiting", name: "CLR" }), "warning",
            m.hiddenBy({ filters: ["Flow: Returns"], also: [] }),
        ]]));
        await click(panel(c).querySelector("[data-inspector-issue]")!);
        // The states' choice cleared — the transitions' kept, the returns' transitions still hidden — and CLR selected once drawn.
        await waitFor(() => expect(whereOf("states").size).toBe(0));
        await waitFor(() => expect(selected(c, "CLR")).toBe(true));
        expect([link(c, "r1"), link(c, "l7") !== null]).toEqual([null, true]);
        await openTab(c, "Details");
        expect([head(c), chip(c)]).toEqual([["State · CLR", "Cleared at the desk"], m.inspectorChip({ state: "pending" })]);
    });

    test("a ready refusal holds Save off — listed first, blocking — until the field it names is given; the history item's issue selects what it names too (R12)", async () => {
        const stored = await h.read(ex.depotStates);
        const c = await open(ex.flowchartDepotEditing);
        await click(node(c, "CLR")!);
        await click(action(c, "duplicate")!);
        expect(head(c)[0]).toBe("State · CLR-2");
        await retype(c, "flow", "");
        await openTab(c, "Issues");
        expect(issues(c)).toEqual([[m.issueWhere({ kind: "State", name: "CLR-2" }), "Give the state its flow", "invalid"], DLV_ISSUE]);
        expect([tabs(c), enabled(SAVE)]).toEqual([["Details", "Issues 2"], false]);
        // The history item's issue selects it too.
        await openTab(c, "Details");
        await click(c.querySelector("[data-flowchart-canvas]")!);
        expect(showing(c)).toBe("flowchart");
        await press(editingMessages.issues({ n: 1, count: "1" }));
        expect([showing(c), head(c)[0]]).toEqual(["state", "State · CLR-2"]);
        // Given its flow, it is ready: Save writes it.
        await retype(c, "flow", "Parcels");
        expect(enabled(SAVE)).toBe(true);
        await press(SAVE);
        const saved = (await h.read(ex.depotStates)).get("CLR-2")!;
        expect(stateEqual(saved, { ...stored.get("CLR")!, seq: saved.seq })).toBe(true);
    });

    test("a new key e3 holds — a state the rail hides is keyed so — holds Save off, listed first, asked of e3 by key; a new key in the form clears it (R9)", async () => {
        const c = await open(ex.flowchartDepot, "CLR");
        await click(node(c, "CLR")!);
        await click(action(c, "duplicate")!);
        await retype(c, "key", "RCV");
        await openTab(c, "Issues");
        // Asked of e3 by key through the states' source, in a request of its own; then held off.
        await waitFor(() => expect(h.requests("rows", STATES).map(keysOf)).toContainEqual([printText("RCV")]), { timeout: 5_000 });
        await waitFor(() => expect(issues(c)).toEqual([[m.issueWhere({ kind: "State", name: "RCV" }), m.keyHeld({ sort: "states", key: "RCV" }), "invalid"], DLV_ISSUE]), { timeout: 5_000 });
        expect(enabled(SAVE)).toBe(false);
        await openTab(c, "Details");
        await retype(c, "key", "RCX");
        await openTab(c, "Issues");
        await waitFor(() => expect(issues(c)).toEqual([DLV_ISSUE]));
        expect(enabled(SAVE)).toBe(true);
        await press(SAVE);
        expect((await h.read(ex.depotStates)).has("RCX")).toBe(true);
    });

    test("a Save e3 refuses is listed first, blocking, while it stands (R12)", async () => {
        const c = await open();
        await click(c.querySelector("[data-flowchart-lane='sort']")!);
        await retype(c, "label", "Sorting");
        // e3's answer to the lanes' write arrives saying the mutation is invalid: the session hears a refusal.
        const refused = encodeBeast2For(ResponseType(MutationResultType))(variant("success", { outcome: variant("invalid", { message: "The lanes are held for review" }) }));
        const stop = h.e3.fail((request) => request.kind === "mutate" && request.record === ex.depotLanes.name, { alter: () => new Uint8Array(refused) });
        // e3 commits the write whose answer the fault alters: the lanes read again would hold the label saved, and the
        // draft settle on it before its refusal is listed — where a write e3 refuses leaves the lanes as they were. The
        // lanes' reads wait until it is.
        const reads = h.e3.hold((request) => request.kind === "read" && request.dataset === `records.${ex.depotLanes.name}`);
        await press(SAVE);
        await openTab(c, "Issues");
        // The write can reach e3 after the Save's click has settled, as a slow runner sends it: the refusal stays in
        // place until the issue it raises is listed.
        const said = () => `banners: ${[...c.querySelectorAll("[data-session-banner]")].map((b) => b.getAttribute("data-session-banner")).join(", ")}; `
            + `issues: ${issues(c).map((issue) => issue.join(" | ")).join("; ")}`;
        const first = () => {
            const issue = panel(c).querySelector<HTMLElement>("[data-inspector-issue]");
            return [issue?.getAttribute("data-inspector-issue"), issue?.querySelector("[data-kind]")?.textContent, issue?.querySelector("[data-kind]")?.getAttribute("data-kind")];
        };
        await waitFor(() => expect(first(), said()).toEqual(["save", "The lanes are held for review", "invalid"]), { timeout: 15_000 });
        reads.release();
        stop();
    });
});

// ============================================================================
// Find state (R17)
// ============================================================================

describe("Find state (R17)", () => {
    test("finds the states drawn by key and by label, and by key through e3 one the rail hides, with the choice hiding it: its pick clears just that choice and selects the state once drawn", async () => {
        const c = await open();
        // A state drawn, by its label.
        await typeIntoFind(c, "relab");
        await waitFor(() => expect(lines(c)).toEqual(["LBL · Relabelled"]));
        fireEvent.keyDown(findInput(c), { key: "Enter" });
        await waitFor(() => expect(selected(c, "LBL")).toBe(true));
        await act(async () => { fireEvent.click(findBox(c).querySelector("button[aria-label='Clear search']")!); });
        await settle();
        // RCV, a state of the returns' flow, which the rail hides.
        await typeIntoFind(c, "RCV");
        await waitFor(() => expect(lines(c)).toEqual([`RCV · Received · ${m.hiddenBy({ filters: ["Flow: Parcels"], also: [] })}`]), { timeout: 5_000 });
        fireEvent.keyDown(findInput(c), { key: "Enter" });
        // The states' choice cleared, the transitions' kept, and RCV selected once drawn.
        await waitFor(() => expect(whereOf("states").size).toBe(0));
        await waitFor(() => expect(selected(c, "RCV")).toBe(true));
        expect(link(c, "r1")).toBeNull();
        expect(head(c)).toEqual(["State · RCV", "Received"]);
    });

    test("over states read whole, no source of the rail naming them — the phone's — finds the states drawn, and its pick selects the state", async () => {
        const c = await open(ex.flowchartDepotPhone, "SCN");
        await typeIntoFind(c, "SCN");
        await waitFor(() => expect(lines(c)).toEqual(["SCN · Scanned"]));
        fireEvent.keyDown(findInput(c), { key: "Enter" });
        await waitFor(() => expect(selected(c, "SCN")).toBe(true));
    });
});

// ============================================================================
// Read only (R13)
// ============================================================================

describe("read only (R13)", () => {
    test("over records bound read only, Details prints every field and edits none: no Set or Clear, no Duplicate, no Delete", async () => {
        const c = await open(ex.flowchartDwell);
        for (const target of ["[data-flowchart-node='CH*']", "[data-flowchart-link='l4']", "[data-flowchart-lane='sort']"]) {
            await click(c.querySelector(target)!);
            const all = [...editors(c, "roles"), ...editors(c, "fields")];
            expect(all.length > 0 && all.every((editor) => editor.endsWith(":readonly")), `${target}: ${all.join(", ")}`).toBe(true);
            expect(panel(c).querySelector("[data-field-set], [data-field-clear], [data-inspector-action]"), target).toBeNull();
        }
        await click(node(c, "CH*")!);
        expect([editors(c, "roles"), editors(c, "fields")]).toEqual([["key:readonly", "label:readonly", "lane:readonly"], ["slots:readonly", "flow:readonly"]]);
        expect(box(c, "lane").value).toBe("Sort");
    });

    test("with `readOnly`, over records that write, the same", async () => {
        const c = await mountRecords(records({ readOnly: true }), "SRD");
        await click(node(c, "SRD")!);
        expect([editors(c, "roles"), editors(c, "fields")]).toEqual([["key:readonly", "label:readonly", "lane:readonly"], ["slots:readonly", "flow:readonly"]]);
        expect(panel(c).querySelector("[data-inspector-action], [data-field-set], [data-field-clear]")).toBeNull();
    });
});

// ============================================================================
// A kind's own Details (R16)
// ============================================================================

describe("a kind's own Details (R16)", () => {
    /** The depot's records with the states' own Details — a button that makes the state a class of three, its update one step — read only, or not. */
    const own = (readOnly: boolean) => ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
        const details = $.const(East.function([ex.DepotState, FunctionType([ex.DepotState], NullType)], UIComponentType, ($2, s, update) => {
            const grow = $2.const(East.function([], NullType, ($3) => {
                const edited = $3.const({ name: s.name, phase: s.phase, seq: s.seq, slots: some(3n), flow: s.flow }, ex.DepotState);
                $3(update(edited));
            }));
            return Button.Root(Text.Root(East.str`Make ${s.name} a class of three`), { onClick: grow });
        }));
        const states = $.let(Record.bind(ex.depotStates));
        return {
            ...records({ readOnly })($),
            states: Flowchart.states(states, { label: "name", lane: "phase", order: "seq", members: (s) => s.slots, inspector: details }),
        };
    };

    test("a state's own Details show in place of its form, their update one step, which Save commits; a transition's Details stay its form", async () => {
        const stored = await h.read(ex.depotStates);
        const c = await mountRecords(own(false), "SRD");
        await click(node(c, "SRD")!);
        const custom = panel(c).querySelector<HTMLElement>("[data-inspector-fields='custom']")!;
        expect([panel(c).querySelector("[data-inspector-form='fields']"), editors(c, "roles")]).toEqual([null, ["key:readonly", "label:text", "lane:reference"]]);
        await click(within(custom).getByRole("button", { name: "Make Sorted a class of three" }));
        expect([node(c, "SRD")!.textContent?.includes("×3"), pending(c)]).toEqual([true, pendingOf(1)]);
        await press(UNDO);
        expect(node(c, "SRD")!.textContent).not.toContain("×");
        await press(REDO);
        await press(SAVE);
        expect(stateEqual((await h.read(ex.depotStates)).get("SRD")!, { ...stored.get("SRD")!, slots: some(3n) })).toBe(true);
        // Bound by its ends and its kind alone, every other field of the transition is a field of its form.
        await click(link(c, "l4")!);
        expect([panel(c).querySelector("[data-inspector-fields='custom']"), editors(c, "fields")])
            .toEqual([null, ["kind:select", "trigger:text", "volume:number", "n:number", "at:datetime", "flow:text"]]);
    });

    test("read only, the kind's form prints the row in their place", async () => {
        const c = await mountRecords(own(true), "SRD");
        await click(node(c, "SRD")!);
        expect([panel(c).querySelector("[data-inspector-fields='custom']"), editors(c, "fields")]).toEqual([null, ["slots:readonly", "flow:readonly"]]);
    });
});

// ============================================================================
// The reads (R33, R35–R37)
// ============================================================================

describe("Details: the reads (R33, R35–R37)", () => {
    /** Details' parts, in the order they draw: the head, the reads, the forms — or a kind's own Details — then a state's transitions or a transition's evidence. */
    const parts = (c: HTMLElement) => [...panel(c).querySelectorAll(
        "[data-inspector-what], [data-inspector-reads], [data-inspector-fields], [data-inspector-links], [data-inspector-evidence]",
    )].map((el) => (el.hasAttribute("data-inspector-what") ? "head"
        : el.hasAttribute("data-inspector-reads") ? "reads"
            : el.hasAttribute("data-inspector-fields") ? `fields:${el.getAttribute("data-inspector-fields") ?? ""}`
                : el.hasAttribute("data-inspector-links") ? "transitions" : "evidence"));
    /** The reads' box. */
    const reads = (c: HTMLElement): HTMLElement | null => panel(c).querySelector<HTMLElement>("[data-inspector-reads]");
    /** Waits until the row's reads have landed. */
    const landed = (c: HTMLElement) => waitFor(() => expect(reads(c)?.getAttribute("data-reads")).toBe("landed"));
    /** The stats grid's figures: each its value — or what it says in its place — its unit, and its label. */
    const stats = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-read-stats] [data-pane-read]")].map((el) => [
        el.querySelector("[data-read-value]")?.textContent ?? el.querySelector("[data-read-empty]")?.textContent ?? null,
        el.querySelector("[data-read-unit]")?.textContent ?? null,
        el.querySelector("[data-read-label]")?.textContent ?? null,
    ]);
    /** Every other read, in order: its place in the details, its kind, its title and its total. */
    const others = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-inspector-reads] [data-pane-read]:not([data-read='figure'])")].map((el) => [
        Number(el.getAttribute("data-pane-read")), el.getAttribute("data-read"),
        el.querySelector("[data-read-label]")?.textContent ?? null, el.querySelector("[data-read-total]")?.textContent ?? null,
    ]);
    /** One read, by its place in the details. */
    const read = (c: HTMLElement, index: number): HTMLElement => panel(c).querySelector<HTMLElement>(`[data-pane-read='${index}']`)!;
    /** A tags read's tags: each its words and its look. */
    const tagsOf = (el: HTMLElement) => [...el.querySelectorAll("[data-flowchart-tag]")].map((tag) => [tag.textContent, tag.getAttribute("data-look")]);
    /** A list's lines: each its name, its note, its value and its share. */
    const linesOf = (el: HTMLElement) => [...el.querySelectorAll("[data-list-row]")].map((row) => [
        row.children[0]!.children[0]!.textContent, row.children[0]!.children[1]?.textContent ?? null, row.children[1]!.textContent, row.children[2]!.textContent,
    ]);
    /** The histogram's bins, a slot each. */
    const bins = (c: HTMLElement) => [...panel(c).querySelectorAll<HTMLElement>("[data-pane-bars] [role='listitem']")];
    /** The bins darkened: the one under the pointer or focus. */
    const active = (c: HTMLElement) => bins(c).flatMap((bin, i) => (bin.hasAttribute("data-active") ? [i] : []));
    /** What the histogram's caption says. */
    const caption = (c: HTMLElement) => panel(c).querySelector("[data-pane-caption]")?.textContent ?? null;
    /** Where half and nine in ten of the sort chutes' parcels fall. */
    const CHUTES_MARKS = "Half within 1h · nine in ten within 4h";

    test("a state's reads stand after its head, in the details' order and in full — its figures side by side in one stats grid, every other read under its title with its total — before its form and its transitions (R35, R36)", async () => {
        const c = await open();
        await click(node(c, "CH*")!);
        await landed(c);
        expect(parts(c)).toEqual(["head", "reads", "fields:row", "transitions"]);
        // Still in state is the inspector's alone: beside Parcels in the grid, each its value and its unit — Still in
        // state has none — over its label.
        expect(stats(c)).toEqual([["18,290", "parcels", "Parcels"], ["140", null, "Still in state"]]);
        expect(others(c)).toEqual([
            [2, "tags", "Flags", "1"], [3, "tags", "Equipment", "2"], [4, "tags", "Shifts", "4"],
            [5, "histogram", "Time in state", "18,290 parcels"], [6, "list", "Service", "18,290 parcels"], [7, "list", "Exceptions", "67 parcels"],
        ]);
        // Every tag, each in its definition's look.
        expect([2, 3, 4].map((i) => tagsOf(read(c, i)))).toEqual([
            [["At risk", "wash"]],
            [["Conveyor", "wash"], ["Scanner", "wash"]],
            [["Early", "wash"], ["Late", "wash"], ["Night", "recipe"], ["Weekend", "neutral"]],
        ]);
        // The histogram across the pane: a slot a bin on the app's axis, and where half and nine in ten of its parcels fall.
        expect([bins(c).length, [...read(c, 5).querySelectorAll("[data-pane-axis] [data-tick]")].map((tick) => tick.textContent), caption(c)])
            .toEqual([12, ["0", "1h", "12h", "2d", "1w+"], CHUTES_MARKS]);
        // Each list by value, every line: its name, its value and its share.
        expect([linesOf(read(c, 6)), linesOf(read(c, 7))]).toEqual([
            [["Standard", null, "10,425", "57%"], ["Priority", null, "4,390", "24%"], ["Economy", null, "2,378", "13%"], ["International", null, "1,097", "6%"]],
            [["Missort", null, "41", "61%"], ["Chute full", null, "26", "39%"]],
        ]);
    });

    test("the histogram's bin under the pointer or focus darkens, its caption its span, its count and its share; the bins are one stop on the keyboard, the arrows, Home and End moving between them (R36, R41)", async () => {
        const c = await open();
        await click(node(c, "CH*")!);
        await landed(c);
        expect(bins(c).map((bin) => bin.tabIndex)).toEqual([0, ...Array<number>(11).fill(-1)]);
        await act(async () => { fireEvent.pointerEnter(bins(c)[2]!); });
        expect([active(c), caption(c)]).toEqual([[2], "30m – 1h · 6,218 parcels · 34%"]);
        await act(async () => { fireEvent.pointerLeave(bins(c)[2]!); });
        expect([active(c), caption(c)]).toEqual([[], CHUTES_MARKS]);
        // Focused, the first bin is the one stop; each key moves the focus, and the stop with it.
        await act(async () => { bins(c)[0]!.focus(); });
        expect([active(c), caption(c)]).toEqual([[0], "0 – 15m · 1,463 parcels · 8%"]);
        const step = async (key: string) => {
            await act(async () => { fireEvent.keyDown(document.activeElement!, { key }); });
            return [bins(c).indexOf(document.activeElement as HTMLElement), active(c), caption(c)];
        };
        expect(await step("ArrowRight")).toEqual([1, [1], "15m – 30m · 4,024 parcels · 22%"]);
        expect(await step("End")).toEqual([11, [11], "1w or more · 0 parcels · 0%"]);
        expect(await step("ArrowDown")).toEqual([11, [11], "1w or more · 0 parcels · 0%"]);
        expect(await step("ArrowLeft")).toEqual([10, [10], "4d – 1w · 0 parcels · 0%"]);
        expect(await step("Home")).toEqual([0, [0], "0 – 15m · 1,463 parcels · 8%"]);
        expect(await step("ArrowUp")).toEqual([0, [0], "0 – 15m · 1,463 parcels · 8%"]);
        expect(bins(c).map((bin) => bin.tabIndex)).toEqual([0, ...Array<number>(11).fill(-1)]);
        // The focus gone, the caption says where half and nine in ten fall again.
        await act(async () => { (document.activeElement as HTMLElement).blur(); });
        expect([active(c), caption(c)]).toEqual([[], CHUTES_MARKS]);
    });

    test("a transition's reads stand before its evidence: each list by value, its note beside its name, the first 8 then Show n more — and Show fewer once open (R35, R36)", async () => {
        const c = await open();
        await click(link(c, "l1")!);
        await landed(c);
        expect(parts(c)).toEqual(["head", "reads", "fields:row", "evidence"]);
        expect([stats(c), others(c)]).toEqual([[], [
            [0, "list", "Region", "18,460 parcels"], [1, "list", "Service", "18,460 parcels"], [2, "list", "Origin", "18,460 parcels"],
        ]]);
        // Region: four lines, none more to show.
        expect([linesOf(read(c, 0)), read(c, 0).querySelector("[data-pane-more]")]).toEqual([[
            ["Metro", null, "8,491", "46%"], ["Regional", null, "6,092", "33%"], ["Remote", null, "2,769", "15%"], ["Overseas", null, "1,108", "6%"],
        ], null]);
        // Origin: eleven lines, each its note — the first 8, then Show 3 more.
        const origins = read(c, 2);
        const more = origins.querySelector<HTMLButtonElement>("[data-pane-more]")!;
        expect([linesOf(origins).length, linesOf(origins)[0], more.textContent, more.getAttribute("aria-expanded")])
            .toEqual([8, ["Air hub", "84 late", "5,350", "29%"], "Show 3 more", "false"]);
        await click(more);
        expect([linesOf(origins).length, linesOf(origins)[10], more.textContent, more.getAttribute("aria-expanded")])
            .toEqual([11, ["Locker bank", "0 late", "265", "1%"], "Show fewer", "true"]);
        await click(more);
        expect([linesOf(origins).length, more.textContent, more.getAttribute("aria-expanded")]).toEqual([8, "Show 3 more", "false"]);
    });

    test("a state there is no row of says no data under Details, where its reads would go (R33)", async () => {
        const c = await open();
        await click(node(c, "DSP")!);
        await waitFor(() => expect(reads(c)?.getAttribute("data-reads")).toBe("none"));
        expect([parts(c), reads(c)!.textContent, reads(c)!.querySelector("[data-read-empty]")?.textContent])
            .toEqual([["head", "reads", "fields:row", "transitions"], `${m.detailsTitle()}${m.detailsNoData()}`, m.detailsNoData()]);
    });

    /** The depot's records, the states' parcels and exceptions their details, read whole — with their own Details, or not — read only, or not. */
    const detailed = (options: { readonly readOnly: boolean; readonly own: boolean }) => ($: BlockBuilder<UIComponentType>): FlowchartTestProps => {
        const evidence = $.let(Data.bind(ex.stateEvidence));
        const states = $.let(Record.bind(ex.depotStates));
        const inspector = $.const(East.function([ex.DepotState, FunctionType([ex.DepotState], NullType)], UIComponentType, (_$2, s, _update) =>
            Text.Root(East.str`${s.name}'s own Details`)));
        return {
            ...records({ readOnly: options.readOnly })($),
            states: Flowchart.states(states, {
                label: "name", lane: "phase", order: "seq", members: (s) => s.slots,
                details: Flowchart.details(evidence, {
                    details: [
                        Flowchart.figure("parcels", { label: "Parcels", unit: "parcels" }),
                        Flowchart.list("exceptions", { label: "Exceptions", unit: "parcels", show: "inspector" }),
                    ],
                }),
                ...(options.own ? { inspector } : {}),
            }),
        };
    };

    test("beside a kind's own Details its reads stand after the head, then the roles' form and the own Details in its form's place, then its transitions; read only, the reads the same and every field printed (R35, R13)", async () => {
        const c = await mountRecords(detailed({ readOnly: false, own: true }), "SRD");
        await click(node(c, "CH*")!);
        await landed(c);
        expect(parts(c)).toEqual(["head", "reads", "fields:row", "fields:custom", "transitions"]);
        expect([stats(c), others(c)]).toEqual([[["18,290", "parcels", "Parcels"]], [[1, "list", "Exceptions", "67 parcels"]]]);
        expect(panel(c).querySelector("[data-inspector-fields='custom']")!.textContent).toBe("Sort chutes (class)'s own Details");
        reloadPage();
        const ro = await mountRecords(detailed({ readOnly: true, own: true }), "SRD");
        await click(node(ro, "CH*")!);
        await landed(ro);
        expect(parts(ro)).toEqual(["head", "reads", "fields:row", "transitions"]);
        expect([stats(ro), others(ro)]).toEqual([[["18,290", "parcels", "Parcels"]], [[1, "list", "Exceptions", "67 parcels"]]]);
        const all = [...editors(ro, "roles"), ...editors(ro, "fields")];
        expect(all.length > 0 && all.every((editor) => editor.endsWith(":readonly")), all.join(", ")).toBe(true);
        expect(panel(ro).querySelector("[data-inspector-action], [data-field-set], [data-field-clear]")).toBeNull();
    });
});
