/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The library pane (#1248, `Flowchart Builder Spec.md` decisions 6–8, §4.2,
 * §8, §9.7, FB25–FB29), over payloads e3-ui builds — each data tab's cards
 * read from its own rows, decoded as the carrier hands them over: the tabs
 * `library` lists, in its order, each with its count, and no pane when it
 * lists none; the rail's count, the first tab's; the state and transition
 * templates' and the author's cards — label, meta, the tab's icon, grouped by
 * their group — an unnamed template tab named in the flowchart's words; each
 * template card a drag source, and an author's when its tab declares a drop;
 * a click selecting a card and a second letting it go; the search over key,
 * label and meta; every empty state; and each tab its own bound data, apart
 * from the flows and from the other tabs (the user, 2026-10-08) — a template
 * record committed to moves its tab's cards alone, the open flow's drafts
 * kept, and a Save of the flows moves no tab's cards.
 *
 * Templates are records (#1346): each templates list's rows are a Dict, each
 * card keyed by its row's key, and each list names its source of the
 * flowchart's one `Slice.bindRecords`, here over the examples' templates
 * records, paged through their indexes on e3 (#1376). Nothing narrows them
 * here, so each list shows the rows it is given whole; the narrowing's own
 * tests are `flowchart-narrowing.dom.test.tsx`'s.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, within, type RenderResult } from "@testing-library/react";
import {
    ArrayType, DictType, East, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { UIStore, editingMessages } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { Data, Flowchart } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { act, enabled, flowchartHarness, press, settle, type PayloadFunction } from "./flowchart.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness();

// jsdom lacks the ResizeObserver the panes and the canvas reach for, and the matchMedia the popovers do.
beforeAll(() => {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    (globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
});

// Each test its own UI store — the flow it opens, its sessions and its panes stay its own — and its own workspace on e3.
beforeEach(() => {
    initializeStore(new UIStore());
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

type Flows = ValueTypeOf<typeof Flowchart.Types.Flows>;

const m = flowchartMessages;

/** The depot's flows: two, so the Flows tab counts 2. */
const FLOWS: Flows = Flowchart.values({
    "Inbound parcels": {
        description: "From the trailer to the van",
        lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }],
        states: [{ key: "ARV", label: "Arrived", lane: "intake" }, { key: "SRT", label: "Sorting", lane: "sort" }],
        links: [{ from: "ARV", to: "SRT" }],
    },
    "Returns": {
        lanes: [{ key: "counter", label: "Counter" }],
        states: [{ key: "RCV", label: "Received", lane: "counter" }],
        links: [],
    },
});

/** A step type: the state templates' row, keyed by its code in its templates record. */
const StepRow = StructType({ code: StringType, name: StringType, kind: StringType, slots: OptionType(IntegerType) });
type Step = ValueTypeOf<typeof StepRow>;
/** The step types, by code: in the record's key order. */
const STEPS = new SortedMap<string, Step>([
    ["HLD", { code: "HLD", name: "Held", kind: "Hold", slots: none }],
    ["CH*", { code: "CH*", name: "Sort chutes", kind: "Sort", slots: some(14n) }],
    ["CLR", { code: "CLR", name: "Cleared", kind: "Hold", slots: none }],
], compareFor(StringType));
/** A transition type, by name. */
const MoveRow = StructType({ kind: Flowchart.Types.Kind, note: StringType });
type Move = ValueTypeOf<typeof MoveRow>;
const MOVES = new SortedMap<string, Move>([
    ["Observed", { kind: variant("observed", null), note: "Mined from the scans" }],
    ["Planned", { kind: variant("planned", null), note: "The designed path" }],
], compareFor(StringType));
/** A role that owns a decision. */
const OwnerRow = StructType({ role: StringType, desk: StringType });
const OWNERS: ValueTypeOf<typeof OwnerRow>[] = [{ role: "customs-desk", desk: "Hold bay" }, { role: "sort-planner", desk: "Sort hall" }];

/** What a payload's library reads: each data tab's rows, or none. */
interface Rows {
    readonly steps?: SortedMap<string, Step>;
    readonly moves?: SortedMap<string, Move>;
    readonly owners?: readonly ValueTypeOf<typeof OwnerRow>[];
}

/** The tabs a payload lists, by name: the Flows tab, the step types, the transition types, the author's Owners (a drop) and Desks (none). */
type TabName = "flows" | "steps" | "moves" | "owners" | "desks";

/**
 * A flowchart's payload as e3-ui builds it, over the host's flows by name or a
 * record of none: its library the tabs named, in that order, each over the
 * rows given, each templates list naming its source of the one rail.
 */
function payload(tabs: readonly TabName[], rows: Rows = {}, flows: Flows = FLOWS): PayloadFunction {
    return East.function([], Flowchart.Types.Payload, ($) => {
        const steps = $.const(rows.steps ?? STEPS, DictType(StringType, StepRow));
        const moves = $.const(rows.moves ?? MOVES, DictType(StringType, MoveRow));
        const owners = $.const([...(rows.owners ?? OWNERS)], ArrayType(OwnerRow));
        // The rail holds a source for each templates list listed, and no other: a source nothing names is refused.
        const named = [
            ...(tabs.includes("steps") ? [["steps", { source: Data.bindPaged(ex.stepTemplates, { indexes: [ex.stepsByKind] }) }] as const] : []),
            ...(tabs.includes("moves") ? [["moves", { source: Data.bindPaged(ex.moveTemplates, { indexes: [ex.movesByKind] }) }] as const] : []),
        ];
        const slice = named.length === 0 ? undefined : { slice: $.let(Slice.bindRecords("flowchart.library", Object.fromEntries(named) as never)) };
        const tab = (name: TabName) => {
            switch (name) {
                case "flows": return Flowchart.library.flows();
                case "steps": return Flowchart.library.states(steps, {
                    name: "Steps", icon: "box", source: "steps",
                    label: (s) => s.name, meta: (s) => some(s.code), group: (s) => s.kind,
                    drop: (s) => Flowchart.patch(Flowchart.Types.State, { key: s.code, label: some(s.name), members: s.slots }),
                });
                case "moves": return Flowchart.library.transitions(moves, {
                    icon: "arrow-right", source: "moves",
                    label: (_m, name) => name, meta: (mv) => some(mv.note),
                    drop: (mv) => Flowchart.patch(Flowchart.Types.Link, { kind: some(mv.kind) }),
                });
                case "owners": return Flowchart.library.tab(owners, {
                    name: "Owners", icon: "user-tie",
                    key: (o) => o.role, label: (o) => o.role, meta: (o) => some(o.desk),
                    drop: (o) => Flowchart.patch(Flowchart.Types.Trigger, { owner: some(o.role) }),
                });
                case "desks": return Flowchart.library.tab(owners, { name: "Desks", key: (o) => o.role, label: (o) => o.desk });
            }
        };
        return Flowchart.Payload({ data: flows, library: tabs.map(tab), ...(slice === undefined ? {} : { slice }) });
    });
}

/** The flowchart over a payload, under the drag layer an app mounts once at its root, as the showcase does. */
function mount(payload: PayloadFunction): Promise<RenderResult> {
    return h.mountPayload(payload, { drag: true, storageKey: "flowchart.library" });
}

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

/** A card of the open panel, by its key. */
const card = (container: HTMLElement, key: string) => panel(container).querySelector<HTMLElement>(`[data-library-item="${key}"]`)!;

/** Types in the open panel's search. */
async function search(container: HTMLElement, text: string) {
    await act(async () => { fireEvent.change(within(panel(container)).getByRole("textbox", { name: "Search library" }), { target: { value: text } }); });
}

/** The open panel's empty state: its icon, its title and the line under it, or `null` while cards show. */
const emptyState = (container: HTMLElement) => {
    const empty = panel(container).querySelector<HTMLElement>("[data-library-empty], [data-flowchart-no-flows]");
    if (empty === null) return null;
    const title = within(empty).getByRole("heading");
    const svg = empty.querySelector("svg");
    return [svg === null ? null : `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`, title.textContent, title.nextElementSibling?.textContent ?? null];
};

describe("the library's tabs (#1248, FB25, FB29)", () => {
    test("the library holds the tabs `library` lists, in its order, each with its count; collapsed, it is a rail with the first tab's count", async () => {
        const { container } = await mount(payload(["flows", "steps", "moves", "owners"]));
        expect(tabs(container)).toEqual([`${m.flowsTab()} 2`, "Steps 3", `${m.libraryTab({ tab: "transitions" })} 2`, "Owners 2"]);
        fireEvent.click(within(pane(container)!).getByRole("button", { name: `Collapse ${m.libraryPane()}` }));
        await settle();
        const rail = pane(container)!.querySelector(`[title='${m.libraryPane()}']`)!;
        expect([...rail.children].map((part) => part.textContent)).toEqual(["", "2", m.libraryPane()]);
        expect(rail.querySelector("svg")!.getAttribute("data-icon")).toBe("layer-group");
    });

    test("in another order, the tabs follow it, and the rail counts the first tab's cards — a template tab's", async () => {
        const { container } = await mount(payload(["owners", "flows", "steps"], { owners: OWNERS.slice(0, 1) }));
        expect(tabs(container)).toEqual(["Owners 1", `${m.flowsTab()} 2`, "Steps 3"]);
        fireEvent.click(within(pane(container)!).getByRole("button", { name: `Collapse ${m.libraryPane()}` }));
        await settle();
        expect([...pane(container)!.querySelector(`[title='${m.libraryPane()}']`)!.children].map((part) => part.textContent)).toEqual(["", "1", m.libraryPane()]);
    });

    test("a library left out or empty draws no start pane; main and the footer are where they were", async () => {
        const { container } = await mount(payload([]));
        expect(pane(container)).toBeNull();
        expect(container.querySelector("[data-frame-slot='main'] [data-flowchart-canvas]")).not.toBeNull();
        expect(container.querySelector("[data-frame-slot='footer']")).not.toBeNull();
    });
});

describe("each data tab's cards (#1248, FB26, FB27)", () => {
    test("the state templates list one card per row of their record, in its keys' order: its label, its meta under it, the tab's icon, grouped by its group", async () => {
        const { container } = await mount(payload(["flows", "steps"]));
        await openTab(container, "Steps");
        // The groups in the order their first cards come: the chutes' key first.
        expect(heads(container)).toEqual([["Sort", "1"], ["Hold", "2"]]);
        expect(cards(container)).toEqual([
            { key: "CH*", label: "Sort chutes", meta: "CH*", icon: "fas box", drags: true, grip: "grip-vertical", placed: false },
            { key: "CLR", label: "Cleared", meta: "CLR", icon: "fas box", drags: true, grip: "grip-vertical", placed: false },
            { key: "HLD", label: "Held", meta: "HLD", icon: "fas box", drags: true, grip: "grip-vertical", placed: false },
        ]);
    });

    test("an unnamed template tab is named in the flowchart's words; its cards, a Dict's rows, in their keys' order, each a drag source", async () => {
        const { container } = await mount(payload(["moves"]));
        expect(tabs(container)).toEqual([`${m.libraryTab({ tab: "transitions" })} 2`]);
        expect(heads(container)).toEqual([]);
        expect(cards(container)).toEqual([
            { key: "Observed", label: "Observed", meta: "Mined from the scans", icon: "fas arrow-right", drags: true, grip: "grip-vertical", placed: false },
            { key: "Planned", label: "Planned", meta: "The designed path", icon: "fas arrow-right", drags: true, grip: "grip-vertical", placed: false },
        ]);
    });

    test("an author's card is a drag source when its tab declares a drop; without one it is read, never dragged — no grip, no icon unless the tab gives one", async () => {
        const { container } = await mount(payload(["owners", "desks"]));
        expect(cards(container)).toEqual([
            { key: "customs-desk", label: "customs-desk", meta: "Hold bay", icon: "fas user-tie", drags: true, grip: "grip-vertical", placed: false },
            { key: "sort-planner", label: "sort-planner", meta: "Sort hall", icon: "fas user-tie", drags: true, grip: "grip-vertical", placed: false },
        ]);
        await openTab(container, "Desks");
        expect(cards(container)).toEqual([
            { key: "customs-desk", label: "Hold bay", meta: null, icon: null, drags: false, grip: null, placed: false },
            { key: "sort-planner", label: "Sort hall", meta: null, icon: null, drags: false, grip: null, placed: false },
        ]);
    });

    test("a click selects a card, a click on another moves the selection, and a click on the selected card lets it go — each tab its own selection", async () => {
        const { container } = await mount(payload(["steps", "owners"]));
        const placed = () => cards(container).filter((c) => c.placed).map((c) => c.key);
        await act(async () => { fireEvent.click(card(container, "HLD")); });
        expect(placed()).toEqual(["HLD"]);
        await act(async () => { fireEvent.click(card(container, "CH*")); });
        expect(placed()).toEqual(["CH*"]);
        // Another tab's selection is its own: the steps' stays while an owner is picked.
        await openTab(container, "Owners");
        await act(async () => { fireEvent.click(card(container, "sort-planner")); });
        expect(placed()).toEqual(["sort-planner"]);
        await openTab(container, "Steps");
        expect(placed()).toEqual(["CH*"]);
        await act(async () => { fireEvent.click(card(container, "CH*")); });
        expect(placed()).toEqual([]);
        expect(panel(container).querySelector("[data-placed]")).toBeNull();
    });

    test("a tab's search reads each card's key, label and meta, its box counting the cards in the tab's noun", async () => {
        const { container } = await mount(payload(["steps", "owners"]));
        const box = within(panel(container)).getByRole("textbox", { name: "Search library" }) as HTMLInputElement;
        expect(box.placeholder).toBe(`Search 3 ${m.libraryNoun({ tab: "states", n: 3 })}…`);
        await search(container, "chutes");
        expect(cards(container).map((c) => c.key)).toEqual(["CH*"]);
        await search(container, "clr");
        expect(cards(container).map((c) => c.key)).toEqual(["CLR"]);
        await openTab(container, "Owners");
        expect((within(panel(container)).getByRole("textbox", { name: "Search library" }) as HTMLInputElement).placeholder)
            .toBe(`Search 2 ${m.libraryNoun({ tab: "tab", n: 2 })}…`);
        await search(container, "hold bay");
        expect(cards(container).map((c) => c.key)).toEqual(["customs-desk"]);
    });
});

describe("an empty tab says so (#1248, FB28)", () => {
    test("in the shared empty state: No flows, No templates for either template tab, Nothing in an author's tab — each with Font Awesome's open box, or the flow's icon — and No matches for a search that hides every card", async () => {
        const { container } = await mount(payload(["flows", "steps", "moves", "owners"], { steps: new SortedMap([], compareFor(StringType)), moves: new SortedMap([], compareFor(StringType)), owners: [] },
            new SortedMap([], compareFor(StringType))));
        expect(tabs(container)).toEqual([`${m.flowsTab()} 0`, "Steps 0", `${m.libraryTab({ tab: "transitions" })} 0`, "Owners 0"]);
        expect(emptyState(container)).toEqual(["fas diagram-project", m.flowsEmpty(), m.flowsEmptyHint({ canAdd: false })]);
        await openTab(container, "Steps");
        expect(emptyState(container)).toEqual(["fas box-open", m.libraryEmpty({ tab: "states", name: "Steps" }), m.libraryEmptyHint({ tab: "states", name: "Steps" })]);
        expect(m.libraryEmpty({ tab: "states", name: "Steps" })).toBe("No templates");
        await openTab(container, m.libraryTab({ tab: "transitions" }));
        expect(emptyState(container)).toEqual(["fas box-open", "No templates", m.libraryEmptyHint({ tab: "transitions", name: m.libraryTab({ tab: "transitions" }) })]);
        await openTab(container, "Owners");
        expect(emptyState(container)).toEqual(["fas box-open", "Nothing in Owners", m.libraryEmptyHint({ tab: "tab", name: "Owners" })]);
        cleanup();
        const full = await mount(payload(["steps"]));
        expect(emptyState(full.container)).toBeNull();
        await search(full.container, "zz");
        expect(emptyState(full.container)).toEqual(["fas box-open", "No matches", 'Nothing matches "zz".']);
    });
});

// ── Each tab its own bound data, apart from the flows and the other tabs ──

/** The step types as the examples' templates record holds them for this test, another session's commit leaving two: by key. */
const STEP_ROWS = new SortedMap([
    ["hold", { name: "Held", kind: "Hold", slots: none }],
    ["chutes", { name: "Sort chutes", kind: "Sort", slots: some(14n) }],
], compareFor(StringType));

describe("each tab its own bound data (#1248, the user, 2026-10-08)", () => {
    test("a template record committed to moves its tab's cards alone: the open flow's drafts, the Flows tab and the other tabs stay; a Save of the flows moves no tab's cards", async () => {
        await h.commitFlows(FLOWS);
        await h.patch(ex.stepTemplates, STEP_ROWS);
        const { container } = await h.mountRecord(($) => {
            // The step types read whole, as a tab its own bound data — beside its source's pages.
            const steps = $.let(Data.bind(ex.stepTemplates));
            const owners = $.const([...OWNERS], ArrayType(OwnerRow));
            const slice = $.let(Slice.bindRecords("flowchart.library.own", { steps: { source: Data.bindPaged(ex.stepTemplates, { indexes: [ex.stepsByKind] }) } }));
            return {
                slice: { slice },
                library: [
                    Flowchart.library.flows(),
                    Flowchart.library.states(steps.read(), {
                        name: "Steps", icon: "box", source: "steps", label: (s) => s.name,
                        drop: (_s, code) => Flowchart.patch(Flowchart.Types.State, { key: code }),
                    }),
                    Flowchart.library.tab(owners, { name: "Owners", key: (o) => o.role, label: (o) => o.role }),
                ],
            };
        });
        const stepKeys = async () => { await openTab(container, "Steps"); return cards(container).map((c) => c.key); };
        const ownerKeys = async () => { await openTab(container, "Owners"); return cards(container).map((c) => c.key); };
        expect(tabs(container)).toEqual([`${m.flowsTab()} 2`, "Steps 2", "Owners 2"]);
        // Each card keyed by its row's key in the templates record (#1346).
        expect(await stepKeys()).toEqual(["chutes", "hold"]);
        // A draft on the open flow: a lane added.
        await act(async () => { fireEvent.click(container.querySelector("[data-flowchart-addlane]")!); });
        await settle();
        const lanes = () => [...container.querySelectorAll("[data-flowchart-lane]")].map((el) => el.getAttribute("data-flowchart-lane"));
        expect(lanes()).toEqual(["intake", "sort", "lane-3"]);
        expect(enabled(editingMessages.apply())).toBe(true);
        // Another writer adds a step type: the Steps tab lists it — and only it moves.
        const added = new SortedMap([...await h.read(ex.stepTemplates)], compareFor(StringType));
        added.set("cleared", { name: "Cleared", kind: "Hold", slots: none });
        await h.patch(ex.stepTemplates, added);
        expect(tabs(container)).toEqual([`${m.flowsTab()} 2`, "Steps 3", "Owners 2"]);
        expect(await stepKeys()).toEqual(["chutes", "cleared", "hold"]);
        expect(await ownerKeys()).toEqual(["customs-desk", "sort-planner"]);
        // The open flow's draft is still there, and still waits on Save.
        expect(lanes()).toEqual(["intake", "sort", "lane-3"]);
        expect(enabled(editingMessages.apply())).toBe(true);
        // Saved: the flows record takes the lane; no tab's cards move.
        await press(editingMessages.apply());
        expect((await h.flows()).get("Inbound parcels")!.lanes.map((l) => l.key)).toEqual(["intake", "sort", "lane-3"]);
        expect(tabs(container)).toEqual([`${m.flowsTab()} 2`, "Steps 3", "Owners 2"]);
        expect(await stepKeys()).toEqual(["chutes", "cleared", "hold"]);
    });
});
