/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart's narrowing (#1346): one rail over its `Slice.bindRecords`,
 * each source filtering every place its records appear — the `flows` source
 * the Flows tab, which pages what it narrows the record to and counts it
 * (`Flows 683 of 2,048`); each templates list's source its tab's cards; the
 * author's tab the source it names — each tab saying so when its source
 * empties it, with that source's Clear filters; the open flow read by its
 * name whatever the narrowing, its drafts kept; a Save that takes a flow out
 * of the narrowing reported in the footer's shared notice; the Flows tab's
 * own search finding within the narrowing, the rail and every count as they
 * were; the flows paged, counted, searched and saved through their indexes
 * and reads by name, never read whole; the examples mounted as they are; and
 * the flows' functions holding the `flows` source alone, never the whole slice
 * (#1343). Over the examples' records in memory and the paging service over
 * their indexes (`flowchart.test-utils.tsx`), the flowchart in a Reactive root
 * as a ui task draws it, the rail written as its chips write it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, IntegerType, OptionType, SortedMap, StringType, compareFor, encodeBeast2For, equalFor, printFor, some, variant, type EastIR } from "@elaraai/east";
import { Reactive, RecordSlicesChromeType, Slice, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { EastChakraComponent, UIStore, editingMessages, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { Data, Flowchart, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { WORKSPACE, exampleRecord, recordHarness, servedRecord, settle, type RecordHarness } from "./flowchart.test-utils.js";
import { pathText } from "../platform/record-paging.test-utils.js";
import { flowchartMessages } from "./messages.js";

// jsdom lacks the ResizeObserver the panes and the canvas reach for, and the matchMedia the popovers do.
beforeAll(() => {
    class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
    (globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
});

/** The examples' records, in memory: the route flows, the depot's, and the library's templates and roles. */
const RECORDS = [ex.indexedFlows, ex.depotFlows, ex.stepTemplates, ex.moveTemplates, ex.decisionOwners];
/** The flows' indexes, as the rail's `flows` source lists them. */
const FLOW_INDEXES = [ex.flowsByName, ex.flowsByDescription, ex.flowsByDescriptionName, ex.flowsByStateCount, ex.flowsByDescriptionStateCount, ex.flowsByLane, ex.flowsByDecisionOwner];
/** The route flows' dataset, by its path's text: paged through its indexes, never read whole. */
const FLOWS_PATH = pathText(ex.indexedFlows.path);

let harness: RecordHarness;

// Each test its own UI store, its own records and its own paged windows.
beforeEach(() => {
    initializeStore(new UIStore());
    harness = recordHarness(new SortedMap([], compareFor(StringType)), RECORDS.map(exampleRecord), [
        servedRecord(ex.indexedFlows, FLOW_INDEXES),
        servedRecord(ex.stepTemplates, [ex.stepsByKind]),
        servedRecord(ex.moveTemplates, [ex.movesByKind]),
        servedRecord(ex.decisionOwners, [ex.ownersByDesk]),
    ]);
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

const m = flowchartMessages;
const printText = printFor(StringType);
const printDescription = printFor(OptionType(StringType));
const printCount = printFor(IntegerType);
const stringEqual = equalFor(StringType);

/** The rail's key: the flowchart's and the test's writes share it. */
const KEY = "flowchart_narrowing_dom";

/** The rail's `flows` source: the route flows through their indexes, found by name in the Flows tab's own search. */
const flowsSource = () => ({
    source: Data.bindPaged(ex.indexedFlows, { indexes: FLOW_INDEXES }), label: "Flows",
    fields: {
        description: { label: "Description" }, stateCount: { label: "State count" }, lane: { label: "Lane" },
        decisionOwner: { label: "Decision owner" }, name: { label: "Name" },
    },
    search: ["name", "description", "lane", "decisionOwner"] as ("name" | "description" | "lane" | "decisionOwner")[],
});

/** The rail's sources: the flows, and each templates record and the roles. */
const sources = () => ({
    flows: flowsSource(),
    steps: { source: Data.bindPaged(ex.stepTemplates, { indexes: [ex.stepsByKind] }), label: "Steps",
        fields: { kind: { label: "Step kind", hints: ["Intake", "Sort", "Hold", "Load"] } } },
    moves: { source: Data.bindPaged(ex.moveTemplates, { indexes: [ex.movesByKind] }), label: "Transitions", fields: { kind: { label: "Transition kind" } } },
    owners: { source: Data.bindPaged(ex.decisionOwners, { indexes: [ex.ownersByDesk] }), label: "Owners",
        fields: { desk: { label: "Desk", hints: ["Sort hall", "Hold bay"] } } },
});

/**
 * The route flows under one rail, the Flows tab paging its `flows` source and
 * the library's templates lists and its Owners tab following theirs — in a
 * Reactive root, so a narrowing written to the rail builds the flowchart again.
 */
const flowchart = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const flows = $.let(Record.bind(ex.indexedFlows, [ex.indexedFlowsPatch]));
    const steps = $.let(Data.bind(ex.stepTemplates));
    const moves = $.let(Data.bind(ex.moveTemplates));
    const owners = $.let(Data.bind(ex.decisionOwners));
    const slice = $.let(Slice.bindRecords(KEY, sources()));
    return Flowchart({
        record: flows, slice: { slice, affordances: ["fields", "summary"] }, name: "narrowing",
        library: [
            Flowchart.library.flows(),
            Flowchart.library.states(steps.read(), {
                name: "Steps", icon: "box", source: "steps", label: (s) => s.name, group: (s) => s.kind,
                drop: (s, code) => Flowchart.patch(Flowchart.Types.State, { key: code, label: some(s.name) }),
            }),
            Flowchart.library.transitions(moves.read(), {
                source: "moves", label: (_m, name) => name, drop: (mv) => Flowchart.patch(Flowchart.Types.Link, { kind: some(mv.kind) }),
            }),
            Flowchart.library.tab(owners.read(), {
                name: "Owners", icon: "user-tie", source: "owners", key: (_o, role) => role, label: (o) => o.name,
                drop: (_o, role) => Flowchart.patch(Flowchart.Types.Trigger, { owner: some(role) }),
            }),
        ],
    });
}))) };

/** The rail as a test writes it: the same sources under the flowchart's key, each part's controls as the toolbar's chips use them. */
const rail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({ slice: Slice.bindRecords(KEY, sources()) }))),
    getRegisteredPlatformImplementations());
/** The rail's parts, bound once: a source's part by its name. */
function railParts() {
    const chrome = rail();
    return (source: string) => chrome.slice.parts.find((part) => stringEqual(part.source, source))!.slice;
}

/** Mounts an example, or the test's flowchart, as a ui task draws it. */
function mount(example: { fn: { toIR(): unknown } }): RenderResult {
    const program = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile(getRegisteredPlatformImplementations());
    return render(<ChakraProvider value={system}><EastChakraComponent value={program()} storageKey="flowchart.narrowing" /></ChakraProvider>);
}

/** A region of the frame. */
const slot = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-builder-frame] [data-frame-slot="${name}"]`);
/** The library's tabs, as they read: each name and its count. */
const tabs = (container: HTMLElement) => [...slot(container, "start")!.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
/** The library's open panel. */
const panel = (container: HTMLElement) => slot(container, "start")!.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
/** The open panel's cards' keys, in order. */
const cardKeys = (container: HTMLElement) => [...panel(container).querySelectorAll<HTMLElement>("[data-library-item]")].map((card) => card.getAttribute("data-library-item"));
/** The open flow, as the footer names it. */
const openFlow = (container: HTMLElement) => container.querySelector("[data-flowchart-flow]")?.textContent ?? null;
/** The changes waiting on Save, as the footer counts them. */
const pending = (container: HTMLElement) => container.querySelector("[data-flowchart-pending]")?.textContent ?? null;

/** Opens a library tab, by its name. */
async function openTab(container: HTMLElement, name: string) {
    const tab = [...slot(container, "start")!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    await act(async () => { fireEvent.click(tab); });
    await settle();
}

/** Presses one of the history item's buttons, by its words. */
async function press(container: HTMLElement, name: string) {
    const button = within(slot(container, "toolbar")!).getByRole("button", { name });
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

const FLOWS_TAB = m.flowsTab();
const TRANSITIONS_TAB = m.libraryTab({ tab: "transitions" });

describe("the Flows tab pages the `flows` source (#1346)", () => {
    test("it lists and counts every flow while nothing narrows, and `683 of 2,048` while the rail narrows them; the collapsed rail's badge is what it shows", async () => {
        const { container } = mount(flowchart);
        const part = railParts();
        await waitFor(() => expect(tabs(container)[0]).toBe(`${FLOWS_TAB} 2,048`));
        await waitFor(() => expect(cardKeys(container)[0]).toBe("FLOW-10000"));
        await act(async () => { part("flows").choose("description", [printDescription(some("Inbound parcels"))]); });
        await waitFor(() => expect(tabs(container)[0]).toBe(`${FLOWS_TAB} 683 of 2,048`));
        // Every third flow is inbound: the list pages the narrowing, in its order.
        await waitFor(() => expect(cardKeys(container).slice(0, 3)).toEqual(["FLOW-10000", "FLOW-10003", "FLOW-10006"]));
        // The other sources narrow nothing: their tabs count their records whole.
        expect(tabs(container).slice(1)).toEqual(["Steps 5", `${TRANSITIONS_TAB} 3`, "Owners 2"]);
        fireEvent.click(within(slot(container, "start")!).getByRole("button", { name: `Collapse ${m.libraryPane()}` }));
        await settle();
        const badge = slot(container, "start")!.querySelector<HTMLElement>("[data-dock-badge]")!;
        expect(badge.getAttribute("title")).toBe("683");
        // Paged and counted through the indexes alone: the flows are never read whole, as the templates are, which
        // the Steps list reads whole beside them.
        expect([harness.wholeReads.includes(FLOWS_PATH), harness.wholeReads.includes(pathText(ex.stepTemplates.path))]).toEqual([false, true]);
    });

    test("while the rail leaves it no flow, it says so, with Clear filters for the `flows` source alone", async () => {
        const { container } = mount(flowchart);
        const part = railParts();
        await waitFor(() => expect(tabs(container)[0]).toBe(`${FLOWS_TAB} 2,048`));
        await act(async () => {
            part("steps").choose("kind", [printText("Hold")]);
            part("flows").range("stateCount", printCount(100n), printCount(200n));
        });
        await waitFor(() => expect(tabs(container)[0]).toBe(`${FLOWS_TAB} 0 of 2,048`));
        const said = await waitFor(() => panel(container).querySelector<HTMLElement>("[data-library-empty]")!);
        expect(within(said).getByText(m.flowsFiltered({ part: "title" }))).toBeTruthy();
        expect(within(said).getByText(m.flowsFiltered({ part: "hint" }))).toBeTruthy();
        await act(async () => { fireEvent.click(within(said).getByRole("button", { name: "Clear filters" })); });
        await settle();
        await waitFor(() => expect(tabs(container)[0]).toBe(`${FLOWS_TAB} 2,048`));
        // The flows' choices cleared; the steps' kept.
        expect([part("flows").read().where.size, part("steps").read().where.size]).toEqual([0, 1]);
        expect(tabs(container)[1]).toBe("Steps 1 of 5");
    });
});

describe("each other source narrows the tab that names it (#1346)", () => {
    test("the templates lists and the Owners tab show the cards their sources show, counted; a source the rail empties says so, with its own Clear filters", async () => {
        const { container } = mount(flowchart);
        const part = railParts();
        await waitFor(() => expect(tabs(container)).toEqual([`${FLOWS_TAB} 2,048`, "Steps 5", `${TRANSITIONS_TAB} 3`, "Owners 2"]));
        await act(async () => {
            part("steps").choose("kind", [printText("Intake")]);
            part("moves").choose("kind", [printFor(Flowchart.Types.Kind)(variant("observed", null))]);
            part("owners").choose("desk", [printText("Hold bay")]);
        });
        await waitFor(() => expect(tabs(container)).toEqual([`${FLOWS_TAB} 2,048`, "Steps 2 of 5", `${TRANSITIONS_TAB} 1 of 3`, "Owners 1 of 2"]));
        await openTab(container, "Steps");
        expect(cardKeys(container)).toEqual(["ARV", "SCN"]);
        await openTab(container, TRANSITIONS_TAB);
        expect(cardKeys(container)).toEqual(["Observed"]);
        await openTab(container, "Owners");
        expect(cardKeys(container)).toEqual(["customs-desk"]);
        // A kind no step has: the tab says so, and its Clear filters clears the steps' source alone.
        await openTab(container, "Steps");
        await act(async () => { part("steps").choose("kind", [printText("Load"), printText("Hold")]); });
        await waitFor(() => expect(tabs(container)[1]).toBe("Steps 2 of 5"));
        await act(async () => { part("steps").choose("kind", [printText("Nowhere")]); });
        await waitFor(() => expect(tabs(container)[1]).toBe("Steps 0 of 5"));
        const said = panel(container).querySelector<HTMLElement>("[data-library-empty]")!;
        await act(async () => { fireEvent.click(within(said).getByRole("button", { name: "Clear filters" })); });
        await settle();
        await waitFor(() => expect(tabs(container)[1]).toBe("Steps 5"));
        expect([part("steps").read().where.size, part("moves").read().where.size, part("owners").read().where.size]).toEqual([0, 1, 1]);
    });
});

describe("the open flow, its drafts and its Save (#1346)", () => {
    test("the open flow stays open, its drafts kept, while the rail narrows it away; the Flows tab marks it Pending again once it shows", async () => {
        const { container } = mount(flowchart);
        const part = railParts();
        await waitFor(() => expect(cardKeys(container)).toContain("FLOW-10001"));
        await act(async () => { fireEvent.click(panel(container).querySelector('[data-library-item="FLOW-10001"]')!); });
        await settle();
        await waitFor(() => expect(openFlow(container)).toBe("FLOW-10001"));
        // A draft: a lane added.
        await act(async () => { fireEvent.click(container.querySelector("[data-flowchart-addlane]")!); });
        await settle();
        expect(pending(container)).toBe(` · ${m.footerPending({ n: 1, count: "1" })}`);
        // The rail narrows it away: FLOW-10001's description is Returns.
        await act(async () => { part("flows").choose("description", [printDescription(some("Inbound parcels"))]); });
        await waitFor(() => expect(cardKeys(container)[0]).toBe("FLOW-10000"));
        expect(cardKeys(container)).not.toContain("FLOW-10001");
        expect([openFlow(container), pending(container)]).toEqual(["FLOW-10001", ` · ${m.footerPending({ n: 1, count: "1" })}`]);
        // Cleared: listed again, its draft Pending.
        await act(async () => { part("flows").clearAll(); });
        await waitFor(() => expect(panel(container).querySelector('[data-library-item="FLOW-10001"] [data-tone]')?.textContent).toBe(m.flowPending()));
    });

    test("a Save that takes the open flow out of the narrowing confirms by its name, and the footer says one flow left the view", async () => {
        const { container } = mount(flowchart);
        const part = railParts();
        // FLOW-10001 holds four states; the rail keeps flows of four.
        await act(async () => { part("flows").range("stateCount", printCount(4n), printCount(5n)); });
        await waitFor(() => expect(cardKeys(container)[0]).toBe("FLOW-10001"));
        await act(async () => { fireEvent.click(panel(container).querySelector('[data-library-item="FLOW-10001"]')!); });
        await settle();
        await waitFor(() => expect(container.querySelectorAll("[data-flowchart-node]")).toHaveLength(4));
        await act(async () => { fireEvent.click(container.querySelector('[data-flowchart-node="CHK"]')!); });
        await act(async () => { fireEvent.keyDown(container.querySelector("[data-flowchart-scroll]")!, { key: "Delete" }); });
        await settle();
        expect(container.querySelectorAll("[data-flowchart-node]")).toHaveLength(3);
        await press(container, editingMessages.apply());
        await waitFor(() => expect(container.querySelector("[data-record-save-notice]")?.textContent).toBe("1 flow left this view"));
        // Still open, read by its name, its Save seen through.
        expect([openFlow(container), pending(container)]).toEqual(["FLOW-10001", ` · ${m.footerPending({ n: 0, count: "0" })}`]);
        const { commits } = await harness.memory.history(WORKSPACE, ex.indexedFlows.name, undefined);
        expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
        // Its Save confirmed, and its exit counted, by reads of the flow and seeks of the indexes: never the flows whole.
        expect(harness.wholeReads).not.toContain(FLOWS_PATH);
    });
});

describe("the Flows tab's own search (#1340, ruling 11; #1346)", () => {
    /** The Flows tab's search box. */
    const searchBox = (container: HTMLElement) => within(panel(container)).getByRole("textbox", { name: "Search flows by name" }) as HTMLInputElement;

    test("finds a flow by its name within the narrowing — the rail, its count and the tab's count as they were — and says how many it hides, with Show all", async () => {
        const { container } = mount(flowchart);
        const part = railParts();
        await waitFor(() => expect(cardKeys(container)[0]).toBe("FLOW-10000"));
        expect(searchBox(container).placeholder).toBe("Search 2,048 flows by name…");
        await act(async () => { fireEvent.change(searchBox(container), { target: { value: "FLOW-1050" } }); });
        await waitFor(() => expect(cardKeys(container)).toEqual(Array.from({ length: 10 }, (_x, i) => `FLOW-1050${i}`)));
        expect(panel(container).querySelector("[data-library-search-hidden]")!.textContent).toBe("2,038 hidden by filter · Show all");
        // The tab's own: the rail narrows nothing, and the tab counts every flow still.
        expect([part("flows").read().where.size, tabs(container)[0]]).toEqual([0, `${FLOWS_TAB} 2,048`]);
        // Within the narrowing: the inbound flows of the ten.
        await act(async () => { part("flows").choose("description", [printDescription(some("Inbound parcels"))]); });
        await waitFor(() => expect(cardKeys(container)).toEqual(["FLOW-10501", "FLOW-10504", "FLOW-10507"]));
        expect(tabs(container)[0]).toBe(`${FLOWS_TAB} 683 of 2,048`);
        // Found through the indexes, never over the flows read whole.
        expect(harness.wholeReads).not.toContain(FLOWS_PATH);
        await act(async () => { fireEvent.click(within(panel(container)).getByRole("button", { name: "Show all" })); });
        await waitFor(() => expect(cardKeys(container).slice(0, 2)).toEqual(["FLOW-10000", "FLOW-10003"]));
        expect(searchBox(container).value).toBe("");
    });

    test("the rail's choices that no index combines with a name say so, naming them, with the rail's Clear filters", async () => {
        const { container } = mount(flowchart);
        const part = railParts();
        await waitFor(() => expect(cardKeys(container)[0]).toBe("FLOW-10000"));
        await act(async () => { part("flows").range("stateCount", printCount(4n), printCount(6n)); });
        await waitFor(() => expect(tabs(container)[0]).toMatch(/ of 2,048$/));
        await act(async () => { fireEvent.change(searchBox(container), { target: { value: "FLOW-1" } }); });
        const said = await waitFor(() => {
            const empty = panel(container).querySelector<HTMLElement>("[data-library-empty]");
            expect(empty).not.toBeNull();
            return empty!;
        });
        expect(within(said).getByText("No search with these filters")).toBeTruthy();
        expect(within(said).getByText("Clear the filters on State count to search by Name and Description.")).toBeTruthy();
        await act(async () => { fireEvent.click(within(said).getByRole("button", { name: "Clear filters" })); });
        await settle();
        await waitFor(() => expect(cardKeys(container)[0]).toBe("FLOW-10000"));
        expect(part("flows").read().where.size).toBe(0);
    });
});

describe("the examples, mounted as they are (#1346)", () => {
    test("the library example's rail narrows its templates and its Owners tab, a source each; its Flows tab lists the depot's flows read whole", async () => {
        const { container } = mount(ex.flowchartLibrary);
        await waitFor(() => expect(tabs(container)).toEqual([`${FLOWS_TAB} 2`, "Steps 5", `${TRANSITIONS_TAB} 3`, "Owners 2"]));
        const sourcesOnRail = new Set([...slot(container, "toolbar")!.querySelectorAll("[data-record-slice-source]")].map((el) => el.getAttribute("data-record-slice-source")));
        expect([...sourcesOnRail].sort()).toEqual(["moves", "owners", "steps"]);
    });

    test("the record indexes example pages and counts its 2,048 flows through its `flows` source", async () => {
        const { container } = mount(ex.flowchartRecordIndexes);
        await waitFor(() => expect(tabs(container)).toEqual([`${FLOWS_TAB} 2,048`]));
        await waitFor(() => expect(cardKeys(container)[0]).toBe("FLOW-10000"));
        expect(harness.requests.some((request) => request.startsWith(`${FLOWS_PATH} `))).toBe(true);
        expect(harness.wholeReads).not.toContain(FLOWS_PATH);
    });
});

/**
 * The route flows' payload over `flows` and the step templates, the steps'
 * second kind hint `hint`: two such payloads are one program, the same code,
 * and differ only in that hint, as data.
 */
const payloadHinting = (hint: string) => East.compile(East.function([], Flowchart.Types.Payload, ($) => {
    const flows = $.let(Record.bind(ex.indexedFlows, [ex.indexedFlowsPatch]));
    const steps = $.let(Data.bind(ex.stepTemplates));
    const slice = $.let(Slice.bindRecords(`${KEY}.own`, {
        flows: flowsSource(),
        steps: { source: Data.bindPaged(ex.stepTemplates, { indexes: [ex.stepsByKind] }), fields: { kind: { label: "Kind", hints: ["Intake", hint] } } },
    }));
    return Flowchart.Payload({
        record: flows, slice: { slice },
        library: [Flowchart.library.flows(), Flowchart.library.states(steps.read(), {
            source: "steps", label: (s) => s.name, drop: (_s, code) => Flowchart.patch(Flowchart.Types.State, { key: code }),
        })],
    });
}), getRegisteredPlatformImplementations())();

describe("the flows' functions hold their own source alone (#1343, #1346)", () => {
    test("the Flows tab's window, the read of a flow by its name and the tab's own search encode alike however much another source holds", () => {
        // A function captures what it reads, and a payload encodes, and its decode compiles, each capture once for each
        // function holding it: flows paged through the slice would carry every other source's methods and config in each.
        const encodeSlice = encodeBeast2For(Flowchart.Types.Payload.fields.slice);
        const encodeSource = encodeBeast2For(Flowchart.Types.Source);
        // Built from one call site: East's source map holds where a program was built, and two lines would differ there.
        const built = ["Hold", Array.from({ length: 400 }, (_x, i) => `holding bay ${i}`).join(", ")].map((hint) => payloadHinting(hint));
        const short = built[0]!, long = built[1]!;
        // The rail holds the hint, some two thousand bytes of it as beast2 packs it.
        expect(encodeSlice(long.slice).length - encodeSlice(short.slice).length).toBeGreaterThan(1_000);
        // The flows' paged arm holds none of it.
        if (long.source.type !== "paged") throw new Error(`expected the paged arm, got ${long.source.type}`);
        expect(encodeSource(long.source)).toEqual(encodeSource(short.source));
    });
});
