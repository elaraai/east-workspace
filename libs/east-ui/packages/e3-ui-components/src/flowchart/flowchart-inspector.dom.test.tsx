/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's inspector (#1250, `Flowchart Builder Spec.md` §5.3, §9.9,
 * FB35–FB38, FB44, FB45), over a record of flows in memory bound with its
 * patch mutation, so a Save is a real commit (`flowchart.test-utils.tsx`):
 *
 * - **the pane** — on by default, `inspector={false}` taking it away; its
 *   tabs Details and Issues, Issues with its count; collapsed, a rail with its
 *   icon, the issue count and what is selected (FB35, FB44);
 * - **every view of §5.3** — a state, a transition, a decision, a lane (a
 *   click on its header, the user ruled on 2026-10-08), several states, and
 *   nothing: the open flow — each field by the shared input its East type
 *   takes, and every edit one transaction, tinted and Pending, Undo taking it
 *   back: a state's new key rekeying its transitions and the decisions'
 *   queues, a lane's moving its states, a decision's renaming it on the
 *   transitions it governs; Duplicate and Delete; the flow renamed — refused
 *   for a name it holds, or none, the footer saying why — described,
 *   duplicated and deleted, each committed by Save as one patch (FB36);
 * - **Issues** — the open flow's, each a click selecting what it names; two
 *   of one key blocking Save; a Save's conflict while it stands (FB37);
 * - **read only** — over the host's data, or `readOnly`: every field
 *   printed, no gesture (FB38);
 * - **a kind's own Details** — the author's, in place of the form, its
 *   `update` one transaction; read only, writing nothing (FB45).
 *
 * jsdom lays nothing out: the canvas measures 0×0, and the panes keep the
 * place they open in.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, FunctionType, NullType, PatchType, SortedMap, StringType, compareFor, diffFor, equalFor, none, some, variant, type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Button, Editing, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { UIStore, editingMessages, formatters, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import * as edits from "./edits.js";
import { commitOther, commits, enabled, mountRecord, press, readRecord, recordHarness, settle, type RecordHarness } from "./flowchart.test-utils.js";
import { EastChakraFlowchart, type FlowchartValue } from "./index.js";
import { flowchartMessages } from "./messages.js";

// jsdom lacks the ResizeObserver the panes and the canvas reach for, the matchMedia the popovers do, and a listbox's scroll.
beforeAll(() => {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    (globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
    Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };
});

// Each test its own UI store: its sessions, its open flow and its panes stay its own.
beforeEach(() => {
    initializeStore(new UIStore());
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

type Flow = ValueTypeOf<typeof Flowchart.Types.Flow>;
type Flows = ValueTypeOf<typeof Flowchart.Types.Flows>;

const m = flowchartMessages;
const WORDS = formatters("en-US");
const SAVE = editingMessages.apply();
const UNDO = editingMessages.undo();
const flowEqual = equalFor(Flowchart.Types.Flow);
const flowsEqual = equalFor(Flowchart.Types.Flows);

// ── The flows ─────────────────────────────────────────────────────────────

/**
 * The sort flow: three lanes, the last empty; a class of chutes; a decision
 * on IND → CH*, its evidence measured; an observed CH* → SRD; and SRD → GONE,
 * naming a state the flow has none of — its one issue.
 */
const SORT_INPUT = {
    description: "From the belt to the chutes",
    lanes: [{ key: "induct", label: "Induct" }, { key: "sort", label: "Sort" }, { key: "hold", label: "Hold" }],
    states: [
        { key: "IND", label: "Inducting", lane: "induct" },
        { key: "CH*", label: "Sort chutes", lane: "sort", members: 14n, notes: "One per postcode area" },
        { key: "SRD", label: "Sorted", lane: "sort" },
    ],
    links: [
        { key: "IND→CH*", from: "IND", to: "CH*", trigger: "route",
          evidence: { volume: 17350.0, count: 386n, measuredAt: new Date("2026-06-30T00:00:00Z"), unit: "parcels" } },
        { from: "CH*", to: "SRD", kind: "observed" },
        { from: "SRD", to: "GONE" },
    ],
    triggers: [{ key: "route", label: "route", letter: "R", owner: "sort-planner", queue: ["IND"] }],
} as const satisfies Parameters<typeof Flowchart.value>[0];

const SORT: Flow = Flowchart.value(SORT_INPUT);
const RETURNS_INPUT = { lanes: [{ key: "counter", label: "Counter" }], states: [{ key: "RCV", label: "Received", lane: "counter" }], links: [] } as const;
const FLOWS: Flows = Flowchart.values({ "Sort": SORT_INPUT, "Returns": RETURNS_INPUT });

/** The flows with one flow replaced, or taken away. */
function withFlow(name: string, flow: Flow | undefined, flows: Flows = FLOWS): Flows {
    const out = new SortedMap(flows, compareFor(StringType));
    if (flow === undefined) out.delete(name);
    else out.set(name, flow);
    return out;
}

/** The sort flow open over the record, the Flows tab listed. */
const SORT_OPEN = { flow: "Sort", library: [Flowchart.library.flows()] };

/** The record of flows, as another writer commits to it. */
const FLOWS_RECORD = { name: "depot_flows", type: Flowchart.Types.Flows, initial: FLOWS };
const diffFlows = diffFor(Flowchart.Types.Flows);

/** A night shift's flow, which another write makes. */
const NIGHT: Flow = Flowchart.value({ lanes: [{ key: "night", label: "Night" }], states: [{ key: "NGT", label: "Night intake", lane: "night" }], links: [] });

/** A record of flows that reads `flows`, its Save answered by `answer`. */
function answering(flows: Flows, answer: () => Promise<ValueTypeOf<typeof Editing.Types.ApplyResult>>): FlowchartValue["source"] {
    return variant("record", {
        read: () => flows,
        history: () => none,
        commit: { patch: async () => variant("committed", { commitHash: "c", stateHash: "s" }) },
        apply: async () => answer(),
    });
}

/** The record in memory, and the flowchart over it — the sort flow open, its inspector on by default. */
async function mountSort(props: Parameters<typeof mountRecord>[0] = SORT_OPEN): Promise<{ container: HTMLElement; harness: RecordHarness }> {
    const harness = recordHarness(FLOWS);
    const { container } = await mountRecord(props);
    return { container, harness };
}

/** A payload of the flows, as the renderer takes it: the sort flow open, over `source`. */
function payload(source: FlowchartValue["source"], options: Partial<Pick<FlowchartValue, "inspector" | "readOnly">> = {}): FlowchartValue {
    return {
        canvas: {
            orientation: none, freshness: none, minimap: none, legend: some(false), density: none, slice: none,
            onSelectState: none, onSelectLink: none, onSelectTrigger: none, onTracePath: none, canConnect: none,
        },
        source,
        open: some("Sort"),
        library: [],
        inspector: options.inspector ?? some({ state: none, transition: none }),
        readOnly: options.readOnly ?? false,
        name: none,
    };
}

async function mount(value: FlowchartValue): Promise<RenderResult> {
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraFlowchart value={value} storageKey="flowchart.inspector" />
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

// ── Reading the flowchart ─────────────────────────────────────────────────

const node = (c: HTMLElement, key: string): HTMLElement => c.querySelector(`[data-flowchart-node="${key}"]`) as HTMLElement;
const stateKeys = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node"));
const laneHeads = (c: HTMLElement): (string | null)[] => [...c.querySelectorAll("[data-flowchart-lane]")].map((el) => el.textContent);
const pending = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-pending]")?.textContent ?? null;
const pendingOf = (n: number): string => ` · ${m.footerPending({ n, count: WORDS.number(n) })}`;
const footerMessage = (c: HTMLElement): string => c.querySelector("[data-flowchart-message]")?.textContent ?? "";
const footerFlow = (c: HTMLElement): string | null => c.querySelector("[data-flowchart-flow]")?.textContent ?? null;
const cards = (c: HTMLElement) => [...c.querySelectorAll("[data-frame-slot='start'] [data-library-item]")].map((card) => ({
    name: card.getAttribute("data-library-item"),
    label: card.querySelectorAll("span")[0]?.textContent ?? null,
    chip: card.querySelector("[data-tone]")?.textContent ?? null,
}));

/** The inspector pane. */
const pane = (c: HTMLElement): HTMLElement | null => c.querySelector<HTMLElement>("[data-frame-slot='end']");
/** Its open tab's panel. */
const panel = (c: HTMLElement): HTMLElement => pane(c)!.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** Its tabs, as their names and counts read. */
const tabs = (c: HTMLElement): (string | null)[] => [...pane(c)!.querySelectorAll("[role='tab']")].map((t) => t.textContent);
/** What Details shows. */
const showing = (c: HTMLElement): string | null => panel(c).querySelector("[data-flowchart-inspector]")?.getAttribute("data-flowchart-inspector") ?? null;
/** Details' head: what it shows, and its name. */
const head = (c: HTMLElement): (string | null)[] => [
    panel(c).querySelector("[data-inspector-what]")?.textContent ?? null,
    panel(c).querySelector("[data-inspector-name]")?.textContent ?? null,
];
/** Details' chip: Pending, New, Deleted, No state row. */
const chip = (c: HTMLElement): string | null => panel(c).querySelector("[data-inspector-chip]")?.textContent ?? null;
/** The form's fields in order, each its key and its editor. */
const editors = (c: HTMLElement): string[] => [...panel(c).querySelectorAll("[data-inspector-fields='form'] [data-field]")]
    .map((el) => `${el.getAttribute("data-field")}:${el.getAttribute("data-editor")}`);
/** A field of the form, by its key. */
const field = (c: HTMLElement, key: string): HTMLElement => panel(c).querySelector<HTMLElement>(`[data-inspector-fields='form'] [data-field="${key}"]`)!;
/** A field's text box. */
const box = (c: HTMLElement, key: string): HTMLInputElement => within(field(c, key)).getByRole("textbox") as HTMLInputElement;
/** A gesture's button in Details. */
const action = (c: HTMLElement, name: "duplicate" | "delete"): HTMLButtonElement | null => panel(c).querySelector(`[data-inspector-action="${name}"]`);
/** The transitions Details lists, by the keys they go by. */
const links = (c: HTMLElement): (string | null)[] => [...panel(c).querySelectorAll("[data-inspector-link]")].map((el) => el.getAttribute("data-inspector-link"));

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

/** Picks a choice of a select in Details, by its field and its words — in the listbox its trigger controls. */
async function choose(c: HTMLElement, key: string, name: string): Promise<void> {
    const trigger = field(c, key).querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await act(async () => { fireEvent.click(trigger); });
    const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    await act(async () => { fireEvent.click(within(listbox).getByRole("option", { name })); });
    await settle();
}

/** Opens one of the inspector's tabs, by its name. */
async function openTab(c: HTMLElement, name: string): Promise<void> {
    const tab = [...pane(c)!.querySelectorAll("[role='tab']")].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no inspector tab ${name}`);
    await click(tab);
}

// ============================================================================
// The pane (FB35, FB44)
// ============================================================================

describe("the pane (#1250, FB35, FB44)", () => {
    test("is on by default — no prop — its tabs Details and Issues, Issues with its count; collapsed, a rail with its icon, the issue count and what is selected", async () => {
        const { container } = await mountSort();
        expect(tabs(container)).toEqual(["Details", "Issues 1"]);
        expect(showing(container)).toBe("flow");
        await click(node(container, "CH*"));
        await click(within(pane(container)!).getByRole("button", { name: `Collapse ${m.inspectorPane()}` }));
        expect(pane(container)!.hasAttribute("data-collapsed")).toBe(true);
        const detail = pane(container)!.querySelector<HTMLElement>("[data-dock-detail]")!;
        expect(detail.textContent).toBe("State · CH*");
        const rail = detail.parentElement!;
        expect(rail.querySelector('svg[data-icon="sliders"]')).not.toBeNull();
        expect(within(rail).getByText("1")).toBeTruthy();
    }, 30_000);

    test("`inspector={false}` takes it away; `true` gives it, as no prop does", async () => {
        recordHarness(FLOWS);
        const off = await mountRecord({ ...SORT_OPEN, inspector: false });
        expect(pane(off.container)).toBeNull();
        expect(off.container.querySelector("[data-frame-slot='start']")).not.toBeNull();
        cleanup();
        initializeStore(new UIStore());
        recordHarness(FLOWS);
        const on = await mountRecord({ ...SORT_OPEN, inspector: true });
        expect(tabs(on.container)).toEqual(["Details", "Issues 1"]);
    }, 30_000);
});

// ============================================================================
// Details: a state (§5.3)
// ============================================================================

describe("Details: a state (§5.3, FB36)", () => {
    test("its head, its fields — key, label, lane, members, notes — each by the input its type takes, and its transitions in and out, each selecting it", async () => {
        const { container } = await mountSort();
        await click(node(container, "CH*"));
        expect(showing(container)).toBe("state");
        expect(head(container)).toEqual(["State · CH*", "Sort chutes"]);
        expect(chip(container)).toBeNull();
        expect(editors(container)).toEqual(["key:text", "label:text", "lane:reference", "members:number", "notes:text"]);
        expect([box(container, "key").value, box(container, "label").value, box(container, "notes").value]).toEqual(["CH*", "Sort chutes", "One per postcode area"]);
        expect(within(field(container, "members")).getByRole("spinbutton").getAttribute("aria-valuenow")).toBe("14");
        // The lane a select over the flow's lanes.
        expect(field(container, "lane").querySelector("[data-scope=select][data-part=trigger]")!.textContent).toContain("Sort");
        expect(links(container)).toEqual(["IND→CH*", "CH*→SRD#1"]);
        expect([...panel(container).querySelectorAll("[data-inspector-link]")].map((el) => el.textContent)).toEqual(["IND → CH*planned · route", "CH* → SRDobserved"]);
        // A transition listed selects it.
        await click(panel(container).querySelector("[data-inspector-link='CH*→SRD#1']")!);
        expect([showing(container), head(container)[0]]).toEqual(["transition", "Transition · CH* → SRD"]);
    }, 30_000);

    test("an edit is one transaction, tinted and Pending: a new key rekeys its transitions and the decisions' queues; Undo takes it back; Save commits it", async () => {
        const { container, harness } = await mountSort();
        await click(node(container, "IND"));
        await retype(container, "key", "INX");
        expect(stateKeys(container)).toContain("INX");
        // The state, its transition and the decision queueing it: three changes, one transaction — and the selection follows it.
        expect(pending(container)).toBe(pendingOf(3));
        expect([head(container)[0], chip(container)]).toEqual(["State · INX", "Pending"]);
        expect([field(container, "key").hasAttribute("data-dirty"), field(container, "label").hasAttribute("data-dirty")]).toEqual([true, false]);
        await press(UNDO);
        expect(stateKeys(container)).toContain("IND");
        expect(enabled(UNDO)).toBe(false);
        // The label: Pending, the field tinted against the record.
        await click(node(container, "IND"));
        await retype(container, "label", "Inducted");
        expect([chip(container), field(container, "label").hasAttribute("data-dirty"), field(container, "key").hasAttribute("data-dirty")]).toEqual(["Pending", true, false]);
        await press(SAVE);
        expect(flowEqual(readRecord(harness).get("Sort")!, edits.editState(SORT, "IND", "IND", "Inducted"))).toBe(true);
        expect(await commits(harness)).toEqual(["patch", "$init"]);
    }, 30_000);

    test("its lane a select over the flow's lanes, its members a number with Set and Clear, its notes — each one transaction", async () => {
        const { container } = await mountSort();
        await click(node(container, "SRD"));
        await choose(container, "lane", "Hold");
        // Drawn in the hold lane, the third, 166px wide from 332px: its first row.
        expect([node(container, "SRD").style.left, node(container, "SRD").style.top]).toEqual(["357px", "56px"]);
        // No members: Set gives it its least, one.
        expect(field(container, "members").querySelector("[data-field-set]")).not.toBeNull();
        await click(field(container, "members").querySelector("[data-field-set]")!);
        expect(node(container, "SRD").textContent).toContain("×1");
        await click(field(container, "members").querySelector("[data-field-clear]")!);
        expect(node(container, "SRD").textContent).not.toContain("×");
        await retype(container, "notes", "Held for customs");
        expect(pending(container)).toBe(pendingOf(1));
        // Four edits, four transactions.
        for (let i = 0; i < 4; i++) await press(UNDO);
        expect(enabled(UNDO)).toBe(false);
    }, 30_000);

    test("an empty key is refused, the footer saying why, and the field shows the key again", async () => {
        const { container } = await mountSort();
        await click(node(container, "SRD"));
        await retype(container, "key", "");
        expect(footerMessage(container)).toBe(m.inspectorRefused({ why: "emptyKey", what: "state" }));
        expect(box(container, "key").value).toBe("SRD");
        expect(pending(container)).toBe(pendingOf(0));
    }, 30_000);

    test("Duplicate puts a copy right after it, in its lane, selected; Delete takes it with its transitions, and selects nothing", async () => {
        const { container } = await mountSort();
        await click(node(container, "CH*"));
        await click(action(container, "duplicate")!);
        expect(stateKeys(container).filter((k) => k !== "GONE")).toEqual(["IND", "CH*", "CH*-2", "SRD"]);
        expect(head(container)).toEqual(["State · CH*-2", "Sort chutes"]);
        await click(action(container, "delete")!);
        expect(stateKeys(container)).not.toContain("CH*-2");
        await click(node(container, "CH*"));
        await click(action(container, "delete")!);
        expect(stateKeys(container)).not.toContain("CH*");
        expect(container.querySelectorAll("[data-flowchart-link]")).toHaveLength(1);
        expect(showing(container)).toBe("flow");
    }, 30_000);

    test("a state no row stands for — an unresolved transition's end — says so, with its transitions; Delete takes them away", async () => {
        const { container } = await mountSort();
        await click(node(container, "GONE"));
        expect([showing(container), head(container)[0], chip(container)]).toEqual(["ghost", "State · GONE", m.inspectorChip({ state: "noRow" })]);
        expect(links(container)).toEqual(["SRD→GONE#2"]);
        await click(action(container, "delete")!);
        expect(stateKeys(container)).not.toContain("GONE");
        expect(tabs(container)).toEqual(["Details", "Issues 0"]);
    }, 30_000);
});

// ============================================================================
// Details: a transition (§5.3)
// ============================================================================

describe("Details: a transition (§5.3, FB36)", () => {
    test("its ends selects over the flow's states, its kind Planned · Observed, its decision a select with none, its key; its evidence read only", async () => {
        const { container } = await mountSort();
        await click(container.querySelector("[data-flowchart-link='IND→CH*']")!);
        expect(showing(container)).toBe("transition");
        expect(head(container)).toEqual(["Transition · IND → CH*", "Inducting → Sort chutes"]);
        expect(editors(container)).toEqual(["from:reference", "to:reference", "kind:select", "trigger:reference", "key:text"]);
        expect(box(container, "key").value).toBe("IND→CH*");
        const evidence = panel(container).querySelector<HTMLElement>("[data-inspector-evidence]")!;
        expect([...evidence.querySelectorAll("[data-field]")].map((el) => [el.getAttribute("data-field"), el.getAttribute("data-editor"), el.querySelector("input")?.value]))
            .toEqual([
                ["volume", "readonly", "17,350 parcels"],
                ["count", "readonly", "386"],
                ["measured", "readonly", WORDS.dateTime(new Date("2026-06-30T00:00:00Z"))],
            ]);
    }, 30_000);

    test("each edit one transaction: its kind, its decision — none among them — its ends and its key, the selection following the key it goes by", async () => {
        const { container, harness } = await mountSort();
        await click(container.querySelector("[data-flowchart-link='CH*→SRD#1']")!);
        await choose(container, "kind", m.kindLabel({ kind: "planned" }));
        await choose(container, "trigger", "route");
        expect(container.querySelector("[data-flowchart-trigger='route']")).not.toBeNull();
        await choose(container, "to", "IND · Inducting");
        // Keyless, it goes by its ends and its place: CH*→IND#1 now, still selected.
        expect(head(container)[0]).toBe("Transition · CH* → IND");
        await retype(container, "key", "back");
        expect(container.querySelector("[data-flowchart-link='back']")).not.toBeNull();
        await choose(container, "trigger", m.noDecision());
        expect(pending(container)).toBe(pendingOf(1));
        for (let i = 0; i < 5; i++) await press(UNDO);
        expect(enabled(UNDO)).toBe(false);
        for (let i = 0; i < 5; i++) await press(editingMessages.redo());
        await press(SAVE);
        const saved = readRecord(harness).get("Sort")!;
        expect(saved.links[1]).toEqual({ key: some("back"), from: "CH*", to: "IND", kind: some(variant("planned", null)), trigger: none, evidence: none });
    }, 30_000);

    test("Delete deletes it, and selects nothing", async () => {
        const { container } = await mountSort();
        await click(container.querySelector("[data-flowchart-link='IND→CH*']")!);
        await click(action(container, "delete")!);
        expect(container.querySelector("[data-flowchart-link='IND→CH*']")).toBeNull();
        expect(showing(container)).toBe("flow");
    }, 30_000);
});

// ============================================================================
// Details: a decision (§5.3)
// ============================================================================

describe("Details: a decision (§5.3, FB36)", () => {
    test("its key, label, letter, owner, queue — tags over the flow's states — and outcomes; the transitions it governs; a new key renaming it on them; Delete clearing it from them", async () => {
        const { container, harness } = await mountSort();
        await click(container.querySelector("[data-flowchart-trigger='route']")!);
        expect(showing(container)).toBe("decision");
        expect(head(container)).toEqual(["Decision · R", "route"]);
        expect(editors(container)).toEqual(["key:text", "label:text", "letter:text", "owner:text", "queue:tags", "outcomes:text"]);
        expect([...field(container, "queue").querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["IND", "CH*", "SRD"]);
        expect(links(container)).toEqual(["IND→CH*"]);
        // A state queued, as a tag typed and Entered.
        const user = userEvent.setup();
        const input = field(container, "queue").querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
        await user.click(input);
        await user.type(input, "SRD{Enter}");
        await settle();
        await retype(container, "key", "routing");
        expect(container.querySelector("[data-flowchart-trigger='routing']")).not.toBeNull();
        expect(head(container)[0]).toBe("Decision · R");
        await press(SAVE);
        const saved = readRecord(harness).get("Sort")!;
        expect([saved.triggers[0]!.key, saved.triggers[0]!.queue, saved.links[0]!.trigger]).toEqual(["routing", some(["IND", "SRD"]), some("routing")]);
        await click(action(container, "delete")!);
        expect(container.querySelector("[data-flowchart-trigger]")).toBeNull();
        expect(showing(container)).toBe("flow");
    }, 30_000);
});

// ============================================================================
// Details: a lane (§5.3; a click on its header, the user's ruling, 2026-10-08)
// ============================================================================

describe("Details: a lane (§5.3, FB36)", () => {
    test("a click on its header selects it: its key — a new key moving its states — and label; how many states it holds; Delete off while it holds any, saying why", async () => {
        const { container, harness } = await mountSort();
        await click(container.querySelector("[data-flowchart-lane='sort']")!);
        expect(showing(container)).toBe("lane");
        expect(head(container)).toEqual(["Lane · Sort", null]);
        expect(editors(container)).toEqual(["key:text", "label:text"]);
        expect(panel(container).querySelector("[data-inspector-fact='lane']")!.textContent).toBe(m.inspectorLaneStates({ n: 2, count: "2" }));
        expect(action(container, "delete")!.disabled).toBe(true);
        expect(panel(container).querySelector("[data-inspector-why]")!.textContent).toBe(m.laneHoldsStates({ n: 2, count: "2" }));
        await retype(container, "key", "sorting");
        await retype(container, "label", "Sorting");
        expect(laneHeads(container)).toEqual(["INDUCT", "SORTING", "HOLD"]);
        expect(head(container)[0]).toBe("Lane · Sorting");
        await press(SAVE);
        expect(flowEqual(readRecord(harness).get("Sort")!, edits.renameLane(edits.rekeyLane(SORT, "sort", "sorting"), "sorting", "Sorting"))).toBe(true);
        // An empty lane: its Delete on.
        await click(container.querySelector("[data-flowchart-lane='hold']")!);
        expect(action(container, "delete")!.disabled).toBe(false);
        await click(action(container, "delete")!);
        expect(laneHeads(container)).toEqual(["INDUCT", "SORTING"]);
        expect(showing(container)).toBe("flow");
    }, 30_000);
});

// ============================================================================
// Details: several states (§5.3)
// ============================================================================

describe("Details: several states (§5.3, FB36)", () => {
    test("a shift-click puts a state into a selection of several: their count; a lane every one moves to; Delete takes them all — each one transaction", async () => {
        const { container } = await mountSort();
        await click(node(container, "IND"));
        await click(node(container, "SRD"), { shiftKey: true });
        expect(showing(container)).toBe("several");
        expect(panel(container).querySelector("[data-inspector-several]")!.textContent).toBe("2 states");
        expect([node(container, "IND").hasAttribute("data-selected"), node(container, "SRD").hasAttribute("data-selected")]).toEqual([true, true]);
        await choose(container, "lane", "Hold");
        expect(pending(container)).toBe(pendingOf(2));
        await click(action(container, "delete")!);
        expect(stateKeys(container).filter((k) => k !== "GONE")).toEqual(["CH*"]);
        await press(UNDO);
        await press(UNDO);
        expect(pending(container)).toBe(pendingOf(0));
        // A shift-click on a state selected takes it out: the one left is selected alone.
        await click(node(container, "IND"));
        await click(node(container, "CH*"), { shiftKey: true });
        await click(node(container, "IND"), { shiftKey: true });
        expect([showing(container), head(container)[0]]).toEqual(["state", "State · CH*"]);
    }, 30_000);
});

// ============================================================================
// Details: nothing selected — the open flow (§5.3)
// ============================================================================

describe("Details: nothing selected — the open flow (§5.3, FB36)", () => {
    test("over many flows: its name and description, Duplicate and Delete, its counts, its last save and who made it, and three hints", async () => {
        const { container } = await mountSort();
        expect(showing(container)).toBe("flow");
        expect(head(container)).toEqual(["Flow", "Sort"]);
        expect(editors(container)).toEqual(["name:text", "description:text"]);
        expect([box(container, "name").value, box(container, "description").value]).toEqual(["Sort", "From the belt to the chutes"]);
        expect([action(container, "duplicate") !== null, action(container, "delete") !== null]).toEqual([true, true]);
        expect([...panel(container).querySelectorAll("[data-count]")].map((el) => [el.getAttribute("data-count"), el.textContent]))
            .toEqual([["lanes", "3Lanes"], ["states", "3States"], ["transitions", "3Transitions"], ["decisions", "1Decision"]]);
        expect(panel(container).querySelector("[data-inspector-split]")!.textContent).toBe("1 planned · 1 observed · 1 unresolved");
        // The in-memory record commits its first state at the epoch, as "memory".
        expect(panel(container).querySelector("[data-inspector-saved]")!.textContent).toBe(m.inspectorSaved({ when: WORDS.dateTime(new Date(0)), by: "memory" }));
        expect([...panel(container).querySelectorAll("li")].map((li) => li.textContent)).toEqual([m.inspectorHint({ n: 1 }), m.inspectorHint({ n: 2 }), m.inspectorHint({ n: 3 })]);
        // Esc, or a click where nothing is, comes back here.
        await click(node(container, "IND"));
        await click(container.querySelector("[data-flowchart-canvas]")!);
        expect(showing(container)).toBe("flow");
    }, 30_000);

    test("a new description is one transaction, which Save commits", async () => {
        const { container, harness } = await mountSort();
        await retype(container, "description", "From the belt to the hold");
        expect([pending(container), chip(container)]).toEqual([pendingOf(1), "Pending"]);
        await press(SAVE);
        expect(flowEqual(readRecord(harness).get("Sort")!, { ...SORT, description: some("From the belt to the hold") })).toBe(true);
    }, 30_000);

    test("a new name renames the flow, one transaction — refused for a name the flowchart holds, or none — and Save commits it as one patch, the flow then open under its new name", async () => {
        const { container, harness } = await mountSort();
        await retype(container, "name", "Returns");
        expect(footerMessage(container)).toBe(m.inspectorRefused({ why: "nameTaken", name: "Returns" }));
        expect(box(container, "name").value).toBe("Sort");
        await retype(container, "name", "");
        expect(footerMessage(container)).toBe(m.inspectorRefused({ why: "emptyName" }));
        await retype(container, "name", "Sorting");
        // Renamed as a draft: the footer and the card say its new name, the card Pending, one change waiting.
        expect([footerFlow(container), pending(container), head(container)[1], chip(container)]).toEqual(["Sorting", pendingOf(1), "Sorting", "Pending"]);
        expect(cards(container).find((card) => card.name === "Sort")).toEqual({ name: "Sort", label: "Sorting", chip: m.flowPending() });
        // Its canvas edits go on under its new name.
        await click(node(container, "SRD"));
        await retype(container, "label", "Sorted out");
        await click(container.querySelector("[data-flowchart-canvas]")!);
        // Through the Save the open flow is the one renamed — never another, while the record moves under its drafts: every name the footer shows.
        const shown: string[] = [];
        const watch = new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === "characterData" && record.target.parentElement?.closest("[data-flowchart-flow]") !== null && record.oldValue !== null) shown.push(record.oldValue);
                for (const added of record.addedNodes) {
                    const flow = added instanceof Element ? (added.matches("[data-flowchart-flow]") ? added : added.querySelector("[data-flowchart-flow]")) : null;
                    if (flow !== null) shown.push(flow.textContent ?? "");
                }
            }
        });
        watch.observe(container, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
        await press(SAVE);
        watch.disconnect();
        shown.push(footerFlow(container) ?? "");
        expect(shown.filter((name) => name !== "Sorting")).toEqual([]);
        expect(flowsEqual(readRecord(harness), withFlow("Sorting", edits.editState(SORT, "SRD", "SRD", "Sorted out"), withFlow("Sort", undefined)))).toBe(true);
        expect(await commits(harness)).toEqual(["patch", "$init"]);
        // Open under its new name, nothing waiting.
        expect([footerFlow(container), pending(container)]).toEqual(["Sorting", pendingOf(0)]);
        expect(cards(container).map((card) => [card.name, card.chip])).toEqual([["Returns", null], ["Sorting", null]]);
        expect(stateKeys(container)).toContain("SRD");
    }, 30_000);

    test("a rename whose Save is answered with a conflict is not followed: its drafts undone, a flow of that name another write makes leaves the open flow where it is", async () => {
        const issue = { entry: "Sort", row: none, field: none, message: "Changed since this edit began" };
        const conflict = async () => variant("conflict", [issue]);
        const { container, rerender } = await mount(payload(answering(FLOWS, conflict)));
        await retype(container, "name", "Sorting");
        await press(SAVE);
        expect(container.querySelector("[data-session-banner='conflict']")).not.toBeNull();
        await press(UNDO);
        expect([footerFlow(container), pending(container)]).toEqual(["Sort", pendingOf(0)]);
        // Another write makes a flow of the name the rename asked for.
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={payload(answering(withFlow("Sorting", NIGHT), conflict))} storageKey="flowchart.inspector" />
            </ChakraProvider>,
        );
        await settle();
        expect([footerFlow(container), stateKeys(container).filter((k) => k !== "GONE")]).toEqual(["Sort", ["IND", "CH*", "SRD"]]);
    }, 30_000);

    test("a rename whose Save got no answer is followed once its Retry is seen through: the record reading back the flow under its new name", async () => {
        let sends = 0;
        const answer = async (): Promise<ValueTypeOf<typeof Editing.Types.ApplyResult>> => {
            sends += 1;
            if (sends === 1) throw new Error("the write got no answer");
            return variant("applied", { revision: none });
        };
        const { container, rerender } = await mount(payload(answering(FLOWS, answer)));
        await retype(container, "name", "Sorting");
        await press(SAVE);
        expect(container.querySelector("[data-session-banner='unknown']")).not.toBeNull();
        await press(editingMessages.retryRequest());
        expect(sends).toBe(2);
        // The record reads back as the Save left it: the flow under its new name.
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={payload(answering(withFlow("Sorting", SORT, withFlow("Sort", undefined)), answer))} storageKey="flowchart.inspector" />
            </ChakraProvider>,
        );
        await settle();
        expect([footerFlow(container), pending(container), head(container)]).toEqual(["Sorting", pendingOf(0), ["Flow", "Sorting"]]);
    }, 30_000);

    test("a flow deleted and saved is done with: made again by another write, it opens as that write left it, with nothing to confirm", async () => {
        const { container, harness } = await mountSort();
        await click(action(container, "delete")!);
        await press(SAVE);
        expect(footerFlow(container)).toBe("Returns");
        await commitOther(harness, FLOWS_RECORD, diffFlows(readRecord(harness), withFlow("Sort", NIGHT, readRecord(harness))));
        await settle();
        await click(container.querySelector("[data-frame-slot='start'] [data-library-item='Sort']")!);
        expect([footerFlow(container), stateKeys(container), pending(container)]).toEqual(["Sort", ["NGT"], pendingOf(0)]);
        expect([container.querySelector("[data-flowchart-deleted]"), enabled(SAVE)]).toEqual([null, false]);
    }, 30_000);

    test("Duplicate opens a copy as a new flow, Pending, which Save inserts", async () => {
        const { container, harness } = await mountSort();
        await click(action(container, "duplicate")!);
        expect(footerFlow(container)).toBe("Sort copy");
        expect([head(container)[1], chip(container)]).toEqual(["Sort copy", "New"]);
        expect(cards(container).map((card) => [card.name, card.chip])).toEqual([["Returns", null], ["Sort", null], ["Sort copy", m.flowPending()]]);
        await press(SAVE);
        expect(flowEqual(readRecord(harness).get("Sort copy")!, SORT)).toBe(true);
    }, 30_000);

    test("Delete deletes it: main says so and Details too; Undo brings it back; Save removes it from the record, and the next flow opens", async () => {
        const { container, harness } = await mountSort();
        await click(action(container, "delete")!);
        expect(container.querySelector("[data-frame-slot='main'] [data-flowchart-deleted]")!.textContent).toContain(m.flowDeleted({ part: "title", name: "Sort" }));
        expect([showing(container), chip(container)]).toEqual(["deleted", m.inspectorChip({ state: "deleted" })]);
        await press(UNDO);
        expect(container.querySelector("[data-flowchart-deleted]")).toBeNull();
        expect(stateKeys(container)).toContain("CH*");
        await click(action(container, "delete")!);
        await press(SAVE);
        expect([...readRecord(harness).keys()]).toEqual(["Returns"]);
        expect(stateKeys(container)).toEqual(["RCV"]);
        expect(footerFlow(container)).toBe("Returns");
        // Its session saw its Save through, and keeps nothing of it: a new flow of its name starts with its one lane alone.
        await click(container.querySelector("[data-frame-slot='start'] [data-flowchart-new-flow]")!);
        const popover = within(await screen.findByRole("dialog"));
        await act(async () => { fireEvent.change(popover.getByRole("textbox", { name: m.flowName() }), { target: { value: "Sort" } }); });
        await click(popover.getByRole("button", { name: m.createFlow() }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await settle();
        expect([footerFlow(container), laneHeads(container), stateKeys(container), pending(container)])
            .toEqual(["Sort", [m.newLane({ n: 1, count: WORDS.number(1) }).toUpperCase()], [], pendingOf(1)]);
        expect([showing(container), chip(container)]).toEqual(["flow", m.inspectorChip({ state: "new" })]);
        // Its history holds the new flow alone: one Undo takes it, and there is nothing more to undo.
        await press(UNDO);
        expect(enabled(UNDO)).toBe(false);
    }, 30_000);

    test("over one flow: its description alone — no name, no Duplicate, no Delete", async () => {
        const host = East.compile(East.function([], Flowchart.Types.Payload, (_$) => Flowchart.Payload({
            data: SORT, onApply: East.asyncFunction([PatchType(Flowchart.Types.Flow)], Editing.Types.ApplyResult, (_$2) => variant("applied", { revision: none })),
        })), getRegisteredPlatformImplementations())() as FlowchartValue;
        const { container } = await mount(host);
        expect([showing(container), head(container)]).toEqual(["flow", ["Flow", null]]);
        expect(editors(container)).toEqual(["description:text"]);
        expect([action(container, "duplicate"), action(container, "delete")]).toEqual([null, null]);
    }, 30_000);
});

// ============================================================================
// Issues (FB37)
// ============================================================================

describe("Issues (FB37)", () => {
    test("lists the open flow's issues — two of one key blocking Save, the rest warnings — each a click selecting what it names", async () => {
        const { container } = await mountSort();
        await openTab(container, "Issues");
        const issues = () => [...panel(container).querySelectorAll("[data-inspector-issue]")].map((el) => [
            el.querySelector("span:first-child")?.textContent, el.querySelector("[data-kind]")?.textContent, el.querySelector("[data-kind]")?.getAttribute("data-kind"),
        ]);
        expect(issues()).toEqual([["Transition · SRD → GONE", "SRD → GONE names GONE, which the flow has no state of", "warning"]]);
        await click(panel(container).querySelector("[data-inspector-issue]")!);
        // Selected: Details shows it.
        await openTab(container, "Details");
        expect([showing(container), head(container)[0]]).toEqual(["transition", "Transition · SRD → GONE"]);
        // Two states of one key: blocking, first; Save off.
        await click(node(container, "IND"));
        await retype(container, "key", "SRD");
        await openTab(container, "Issues");
        expect(issues()[0]).toEqual(["State · SRD", m.duplicateKey({ what: "state", key: "SRD" }), "invalid"]);
        expect(tabs(container)).toEqual(["Details", "Issues 2"]);
        expect(enabled(SAVE)).toBe(false);
        // The history item's issue selects what it names, too.
        await openTab(container, "Details");
        await click(container.querySelector("[data-flowchart-canvas]")!);
        await press(editingMessages.issues({ n: 1, count: "1" }));
        expect([showing(container), head(container)[0]]).toEqual(["state", "State · SRD"]);
    }, 30_000);

    test("a Save's conflict is listed, blocking, while it stands", async () => {
        const issue = { entry: "Sort", row: none, field: none, message: "Changed since this edit began" };
        const source: FlowchartValue["source"] = variant("record", {
            read: () => FLOWS,
            history: () => none,
            commit: { patch: async () => variant("committed", { commitHash: "c", stateHash: "s" }) },
            apply: async () => variant("conflict", [issue]),
        });
        const { container } = await mount(payload(source));
        await click(container.querySelector("[data-flowchart-addlane]")!);
        await press(SAVE);
        await openTab(container, "Issues");
        const first = panel(container).querySelector("[data-inspector-issue]")!;
        expect([first.querySelector("span:first-child")?.textContent, first.querySelector("[data-kind]")?.textContent, first.querySelector("[data-kind]")?.getAttribute("data-kind")])
            .toEqual(["Sort", "Changed since this edit began", "invalid"]);
        expect(tabs(container)).toEqual(["Details", "Issues 2"]);
    }, 30_000);
});

// ============================================================================
// Read only (FB38)
// ============================================================================

describe("read only (FB38)", () => {
    test("over the host's flows without onApply, Details shows every field printed and edits none: no Set or Clear, no Duplicate, no Delete", async () => {
        const host = East.compile(East.function([], Flowchart.Types.Payload, (_$) => Flowchart.Payload({ data: FLOWS, flow: "Sort" })),
            getRegisteredPlatformImplementations())() as FlowchartValue;
        const { container } = await mount(host);
        expect(editors(container)).toEqual(["name:readonly", "description:readonly"]);
        expect([action(container, "duplicate"), action(container, "delete")]).toEqual([null, null]);
        for (const target of ["[data-flowchart-node='CH*']", "[data-flowchart-link='IND→CH*']", "[data-flowchart-trigger='route']", "[data-flowchart-lane='sort']"]) {
            await click(container.querySelector(target)!);
            // Every value printed — a decision's queue keeping its tags, read only.
            expect(editors(container).every((e) => e.endsWith(":readonly") || e === "queue:tags"), target).toBe(true);
            expect(panel(container).querySelector("[data-field-set], [data-field-clear], [data-inspector-action]"), target).toBeNull();
        }
        await click(container.querySelector("[data-flowchart-trigger='route']")!);
        expect(field(container, "queue").querySelector("[data-scope=tags-input][data-part=root]")!.hasAttribute("data-readonly")).toBe(true);
        await click(container.querySelector("[data-flowchart-node='CH*']")!);
        expect(editors(container)).toEqual(["key:readonly", "label:readonly", "lane:readonly", "members:readonly", "notes:readonly"]);
        expect(box(container, "lane").value).toBe("Sort");
    }, 30_000);

    test("with `readOnly`, over a record, the same", async () => {
        const { container } = await mountSort({ ...SORT_OPEN, readOnly: true });
        await click(node(container, "SRD"));
        expect(editors(container)).toEqual(["key:readonly", "label:readonly", "lane:readonly", "members:readonly", "notes:readonly"]);
        expect(panel(container).querySelector("[data-inspector-action]")).toBeNull();
    }, 30_000);
});

// ============================================================================
// A kind's own Details (FB45)
// ============================================================================

describe("a kind's own Details (FB45)", () => {
    /** The sort flow with a state's own Details — a button that makes the state a class of three, its update one transaction — read only, or not. */
    const own = (readOnly: boolean) => ($: BlockBuilder<UIComponentType>) => {
        const state = $.const(East.function([Flowchart.Types.State, FunctionType([Flowchart.Types.State], NullType)], UIComponentType, ($2, s, update) => {
            const grow = $2.const(East.function([], NullType, ($3) => {
                const edited = $3.const({ key: s.key, label: s.label, lane: s.lane, members: some(3n), notes: s.notes }, Flowchart.Types.State);
                $3(update(edited));
            }));
            return Button.Root(Text.Root(East.str`Make ${s.key} a class of three`), { onClick: grow });
        }));
        return { ...SORT_OPEN, readOnly, inspector: { state } };
    };

    test("a state's own Details show in place of its form, and their update writes the edited state back as one transaction; a transition's Details stay its form", async () => {
        const { container, harness } = await mountSort(own(false));
        await click(node(container, "SRD"));
        const custom = panel(container).querySelector<HTMLElement>("[data-inspector-fields='custom']")!;
        expect(panel(container).querySelector("[data-inspector-fields='form']")).toBeNull();
        await click(within(custom).getByRole("button", { name: "Make SRD a class of three" }));
        expect(node(container, "SRD").textContent).toContain("×3");
        expect(pending(container)).toBe(pendingOf(1));
        await press(UNDO);
        expect(node(container, "SRD").textContent).not.toContain("×");
        await press(editingMessages.redo());
        await press(SAVE);
        expect(edits.stateRow(readRecord(harness).get("Sort")!, "SRD")!.members).toEqual(some(3n));
        await click(container.querySelector("[data-flowchart-link='IND→CH*']")!);
        expect(editors(container)[0]).toBe("from:reference");
    }, 30_000);

    test("read only, their update writes nothing", async () => {
        const { container } = await mountSort(own(true));
        await click(node(container, "SRD"));
        await click(within(panel(container)).getByRole("button", { name: "Make SRD a class of three" }));
        expect(node(container, "SRD").textContent).not.toContain("×");
    }, 30_000);
});
