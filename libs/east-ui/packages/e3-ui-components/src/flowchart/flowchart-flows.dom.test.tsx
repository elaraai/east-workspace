/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The flows (#1246, `Flowchart Builder Spec.md` decision 5, §9.5, FB12–FB16,
 * FB42, FB43): the Flows tab — every flow by name, each card its name and its
 * description or its counts, the open flow placed, a flow with drafts
 * Pending — a click opening a flow, which a remount keeps; a `flow` the
 * flowchart doesn't hold named in a banner above main until the viewer opens
 * a flow or the record gains the name; LR · TD the viewer's, kept under the
 * flowchart's name; "+ New flow", refusing a name the flowchart holds, and
 * opening a new flow, one lane, as a draft insert that the history item's
 * commit commits to the record and Discard drops; each flow's drafts kept
 * while another is open, the history item acting on the open flow's; an empty
 * record's one "+ New flow", main's; and no Flows tab, and no new flow, where
 * there are no flows by name to list or the flowchart does not edit.
 *
 * The record's tests run the flowchart through its carrier over a record in
 * memory, bound with its patch mutation, as an app binds one — its Save the
 * payload's, `Record.onApply`'s keyed form — so a commit is a real one
 * (`flowchart.test-utils.tsx`).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { SortedMap, StringType, compareFor, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { UIStore, editingMessages, system } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
import { commits, enabled, mountRecord, press, readRecord, recordHarness, settle } from "./flowchart.test-utils.js";
import { EastChakraFlowchart, type FlowchartFlowValue, type FlowchartValue } from "./index.js";
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

// Each test its own UI store: the flow it opens, and its sessions, stay its own.
beforeEach(() => {
    initializeStore(new UIStore());
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

type Flows = ValueTypeOf<typeof Flowchart.Types.Flows>;

const m = flowchartMessages;
const flowsEqual = equalFor(Flowchart.Types.Flows);

/** The depot's flows: the inbound one with its description, the returns one with none — its card shows its counts. */
const FLOWS: Flows = Flowchart.values({
    "Inbound parcels": {
        description: "From the trailer to the van",
        lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }],
        states: [{ key: "ARV", label: "Arrived", lane: "intake" }, { key: "SRT", label: "Sorting", lane: "sort" }],
        links: [{ from: "ARV", to: "SRT" }],
    },
    "Returns": {
        lanes: [{ key: "counter", label: "Counter" }],
        states: [{ key: "RCV", label: "Received", lane: "counter" }, { key: "INS", label: "Inspected", lane: "counter" }],
        links: [{ from: "RCV", to: "INS", kind: "observed" }],
    },
});

/** A new flow's one lane's label. */
const LANE_1 = m.newLane({ n: 1, count: "1" });

/** A new flow, as "+ New flow" starts one: one lane, nothing else. */
const NIGHT: FlowchartFlowValue = { description: none, lanes: [{ key: "lane-1", label: some(LANE_1) }], states: [], links: [], triggers: [] };

/** Every state card the canvas draws, by its key. */
const stateKeys = (container: HTMLElement): (string | null)[] =>
    [...container.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node"));

/** The canvas's lane headers, as it draws them. */
const laneHeads = (container: HTMLElement): (string | null)[] =>
    [...container.querySelectorAll("[data-flowchart-lane]")].map((el) => el.textContent);

/** The Flows tab's cards: each its name, its line, and whether it is placed, and its chip. */
function cards(container: HTMLElement) {
    return [...container.querySelectorAll("[data-frame-slot='start'] [data-library-item]")].map((card) => ({
        name: card.getAttribute("data-library-item"),
        line: card.querySelectorAll("span")[1]?.textContent ?? null,
        placed: card.hasAttribute("data-placed"),
        chip: card.querySelector("[data-tone]")?.textContent ?? null,
    }));
}

/** Clicks a flow's card in the Flows tab, as a pointer does. */
async function openCard(container: HTMLElement, name: string) {
    await act(async () => { fireEvent.click(container.querySelector(`[data-frame-slot='start'] [data-library-item="${name}"]`)!); });
    await settle();
}

/** The Flows tab's name and count, as its tab draws them. */
const flowsTab = (container: HTMLElement): string | null =>
    container.querySelector("[data-frame-slot='start'] [role='tab']")!.textContent;

/** "+ New flow", from the first of its buttons: opens its popover, and hands back the popover and its name field. */
async function newFlowPopover(container: HTMLElement) {
    await act(async () => { fireEvent.click(container.querySelector("[data-flowchart-new-flow]")!); });
    await settle();
    const popover = within(await screen.findByRole("dialog"));
    return { popover, name: popover.getByRole("textbox", { name: m.flowName() }) as HTMLInputElement };
}

/** Names a new flow in "+ New flow"'s popover, and creates it: the popover closes once the flowchart has it. */
async function createFlow(container: HTMLElement, name: string) {
    const { popover, name: field } = await newFlowPopover(container);
    await act(async () => { fireEvent.change(field, { target: { value: name } }); });
    await act(async () => { fireEvent.click(popover.getByRole("button", { name: m.createFlow() })); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await settle();
}

// ── The flowchart over a payload, as the renderer takes it ─────────────────

/** A payload over a source, the canvas's options all left out. */
function payload(source: FlowchartValue["source"], options: Partial<Pick<FlowchartValue, "library" | "readOnly" | "name" | "open">> = {}): FlowchartValue {
    return {
        canvas: {
            orientation: none, freshness: none, minimap: none, legend: some(false), density: none, slice: none,
            onSelectState: none, onSelectLink: none, onSelectTrigger: none,
            onTracePath: none, canConnect: none,
        },
        source,
        open: options.open ?? none,
        library: options.library ?? [variant("flows", null)],
        inspector: none,
        readOnly: options.readOnly ?? false,
        name: options.name ?? none,
    };
}

/** A record of the flows given, whose patch write and Apply are never reached: the tests over it make no commit. */
function recordOf(flows: Flows): FlowchartValue["source"] {
    return variant("record", {
        read: () => flows,
        history: () => none,
        commit: { patch: async () => variant("committed", { commitHash: "c", stateHash: "s" }) },
        apply: async () => variant("applied", { revision: none }),
    });
}

/** A record of the depot's flows. */
const RECORD_SOURCE = recordOf(FLOWS);

function mount(value: FlowchartValue): RenderResult {
    return render(
        <ChakraProvider value={system}>
            <EastChakraFlowchart value={value} storageKey="flowchart.flows" />
        </ChakraProvider>,
    );
}

describe("the Flows tab (#1246, FB13)", () => {
    test("lists every flow by name: its name and its description, or its counts; the open flow — the first by name — placed", async () => {
        const { container } = mount(payload(RECORD_SOURCE));
        await settle();
        expect(cards(container)).toEqual([
            { name: "Inbound parcels", line: "From the trailer to the van", placed: true, chip: null },
            { name: "Returns", line: "1 lane · 2 states · 1 transition", placed: false, chip: null },
        ]);
        // The tab counts them, and the canvas shows the open flow.
        expect(flowsTab(container)).toBe(`${m.flowsTab()} 2`);
        expect(stateKeys(container)).toEqual(["ARV", "SRT"]);
    });

    test("its search reads names and descriptions", async () => {
        const { container } = mount(payload(RECORD_SOURCE));
        await settle();
        const search = container.querySelector("[data-frame-slot='start'] input[aria-label='Search library']") as HTMLInputElement;
        expect(search.placeholder).toBe(`Search 2 ${m.flowNoun({ n: 2 })}…`);
        await act(async () => { fireEvent.change(search, { target: { value: "trailer" } }); });
        expect(cards(container).map((c) => c.name)).toEqual(["Inbound parcels"]);
        await act(async () => { fireEvent.change(search, { target: { value: "returns" } }); });
        expect(cards(container).map((c) => c.name)).toEqual(["Returns"]);
    });

    test("a click opens a flow on the canvas, placing its card — and a remount keeps it open (FB12)", async () => {
        const first = mount(payload(RECORD_SOURCE));
        await settle();
        await openCard(first.container, "Returns");
        expect(stateKeys(first.container)).toEqual(["RCV", "INS"]);
        expect(cards(first.container).map((c) => [c.name, c.placed])).toEqual([["Inbound parcels", false], ["Returns", true]]);
        // The footer names the open flow.
        expect(first.container.querySelector("[data-flowchart-flow]")!.textContent).toBe("Returns");
        first.unmount();
        const again = mount(payload(RECORD_SOURCE));
        await settle();
        expect(stateKeys(again.container)).toEqual(["RCV", "INS"]);
    });

    test("the flow opened wins over `flow`, the one the payload opens first; a name the flowchart does not hold is passed over", async () => {
        const { container } = mount(payload(RECORD_SOURCE, { open: some("Returns") }));
        await settle();
        expect(stateKeys(container)).toEqual(["RCV", "INS"]);
        await openCard(container, "Inbound parcels");
        expect(stateKeys(container)).toEqual(["ARV", "SRT"]);
        cleanup();
        const lost = mount(payload(RECORD_SOURCE, { open: some("Gone") }));
        await settle();
        expect(stateKeys(lost.container)).toEqual(["ARV", "SRT"]);
    });

    test("two flowcharts keep their open flows apart by name", async () => {
        const depot = mount(payload(RECORD_SOURCE, { name: some("depot") }));
        await settle();
        await openCard(depot.container, "Returns");
        depot.unmount();
        const other = mount(payload(RECORD_SOURCE, { name: some("night") }));
        await settle();
        expect(stateKeys(other.container)).toEqual(["ARV", "SRT"]);
    });
});

describe("a `flow` the flowchart doesn't hold (#1246, FB42)", () => {
    /** The banner above main naming the flow asked for. */
    const banner = (container: HTMLElement) => container.querySelector("[data-frame-slot='banners'] [data-flowchart-banner='missing']");

    test("the canvas shows the next rule's flow, and a banner above main names the flow asked for and the one shown", async () => {
        const { container } = mount(payload(RECORD_SOURCE, { open: some("Gone") }));
        await settle();
        expect(stateKeys(container)).toEqual(["ARV", "SRT"]);
        expect(banner(container)!.textContent).toBe(m.flowMissing({ name: "Gone", shown: "Inbound parcels" }));
        cleanup();
        // Over a record with no flow, it names the flow asked for alone.
        const empty = mount(payload(recordOf(new SortedMap([], compareFor(StringType))), { open: some("Gone") }));
        await settle();
        expect(banner(empty.container)!.textContent).toBe(m.flowMissing({ name: "Gone", shown: undefined }));
    });

    test("it stays while that holds, and goes once the viewer opens a flow", async () => {
        const { container } = mount(payload(RECORD_SOURCE, { open: some("Gone") }));
        await settle();
        await act(async () => { fireEvent.change(container.querySelector("[data-frame-slot='start'] input[aria-label='Search library']")!, { target: { value: "returns" } }); });
        expect(banner(container)).not.toBeNull();
        await openCard(container, "Returns");
        expect(banner(container)).toBeNull();
        expect(stateKeys(container)).toEqual(["RCV", "INS"]);
    });

    test("it goes once the record gains that name, which opens", async () => {
        const { container, rerender } = mount(payload(RECORD_SOURCE, { open: some("Gone") }));
        await settle();
        expect(banner(container)).not.toBeNull();
        const gained = new SortedMap(FLOWS, compareFor(StringType));
        gained.set("Gone", NIGHT);
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={payload(recordOf(gained), { open: some("Gone") })} storageKey="flowchart.flows" />
            </ChakraProvider>,
        );
        await settle();
        expect(banner(container)).toBeNull();
        expect(laneHeads(container)).toEqual([LANE_1.toUpperCase()]);
    });
});

describe("LR · TD, the viewer's (#1246, FB43)", () => {
    /** LR · TD's checked segment. */
    const checked = (container: HTMLElement) => container.querySelector("[data-flowchart-seg='orientation'] [aria-checked='true']")?.textContent ?? null;
    /** Picks a segment, as a pointer does. */
    const pick = async (container: HTMLElement, orientation: "LR" | "TD") => {
        await act(async () => { fireEvent.click(within(container).getByRole("radio", { name: orientation })); });
        await settle();
    };
    /** A payload whose canvas gives an orientation. */
    const turned = (value: FlowchartValue, orientation: "LR" | "TD"): FlowchartValue =>
        ({ ...value, canvas: { ...value.canvas, orientation: some(variant(orientation, null)) } });

    test("kept in the UI store under the flowchart's name: a remount keeps the viewer's pick, and a flowchart of another name has its own", async () => {
        const first = mount(payload(RECORD_SOURCE));
        await settle();
        expect(checked(first.container)).toBe("LR");
        await pick(first.container, "TD");
        expect(checked(first.container)).toBe("TD");
        first.unmount();
        const again = mount(payload(RECORD_SOURCE));
        await settle();
        expect(checked(again.container)).toBe("TD");
        again.unmount();
        const other = mount(payload(RECORD_SOURCE, { name: some("night") }));
        await settle();
        expect(checked(other.container)).toBe("LR");
    });

    test("the payload's orientation shows until the viewer picks; then the pick holds against the host's", async () => {
        const { container, rerender } = mount(turned(payload(RECORD_SOURCE), "TD"));
        const host = async (orientation: "LR" | "TD") => {
            rerender(
                <ChakraProvider value={system}>
                    <EastChakraFlowchart value={turned(payload(RECORD_SOURCE), orientation)} storageKey="flowchart.flows" />
                </ChakraProvider>,
            );
            await settle();
        };
        await settle();
        expect(checked(container)).toBe("TD");
        // No pick yet: the host's new orientation shows.
        await host("LR");
        expect(checked(container)).toBe("LR");
        await pick(container, "TD");
        expect(checked(container)).toBe("TD");
        // Picked: the host turning it again changes nothing.
        await host("TD");
        await host("LR");
        expect(checked(container)).toBe("TD");
    });
});

describe("\"+ New flow\" (#1246, FB14)", () => {
    test("opens the shared name popover under the Flows tab's cards, and refuses a name the flowchart holds, with the reason", async () => {
        const { container } = mount(payload(RECORD_SOURCE));
        await settle();
        const button = container.querySelector("[data-frame-slot='start'] [data-flowchart-new-flow]")!;
        expect(button.textContent).toBe(m.newFlow());
        expect(button.querySelector("svg[data-icon='plus']")).not.toBeNull();
        const { popover, name } = await newFlowPopover(container);
        expect(popover.getByText(m.flowNameMissing())).toBeTruthy();
        await act(async () => { fireEvent.change(name, { target: { value: "Returns" } }); });
        expect(popover.getByText(m.flowNameTaken({ name: "Returns" })).id).toBe(name.getAttribute("aria-describedby"));
        expect((popover.getByRole("button", { name: m.createFlow() }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.change(name, { target: { value: "Night shift" } }); });
        expect((popover.getByRole("button", { name: m.createFlow() }) as HTMLButtonElement).disabled).toBe(false);
    });

    test("a read-only flowchart starts no new flow, and has no history item", async () => {
        const { container } = mount(payload(RECORD_SOURCE, { readOnly: true }));
        await settle();
        expect(cards(container)).toHaveLength(2);
        expect(container.querySelector("[data-flowchart-new-flow]")).toBeNull();
        expect(container.querySelector("[data-toolbar-item='history']")).toBeNull();
    });
});

describe("no Flows tab where there are no flows by name (#1246, FB16)", () => {
    test("over one flow — the host's — the canvas shows it, with no library and no new flow", async () => {
        const { container } = mount(payload(variant("data", variant("flow", { value: FLOWS.get("Returns")!, apply: none })), { library: [] }));
        await settle();
        expect(stateKeys(container)).toEqual(["RCV", "INS"]);
        expect(container.querySelector("[data-frame-slot='start']")).toBeNull();
        expect(container.querySelector("[data-flowchart-new-flow]")).toBeNull();
    });

    test("over the host's flows by name the Flows tab lists them, and a click opens one; read only, it starts no new flow", async () => {
        const { container } = mount(payload(variant("data", variant("flows", { value: FLOWS, apply: none }))));
        await settle();
        expect(cards(container).map((c) => c.name)).toEqual(["Inbound parcels", "Returns"]);
        await openCard(container, "Returns");
        expect(stateKeys(container)).toEqual(["RCV", "INS"]);
        expect(container.querySelector("[data-flowchart-new-flow]")).toBeNull();
        expect(container.querySelector("[data-toolbar-item='history']")).toBeNull();
    });
});

describe("a new flow over a record (#1246, FB14)", () => {
    test("opens empty, one lane, as a draft insert: Pending in the tab, and the history item's commit commits it to the record as one patch", async () => {
        const harness = recordHarness(FLOWS);
        const { container } = await mountRecord();
        expect(cards(container).map((c) => c.name)).toEqual(["Inbound parcels", "Returns"]);
        expect(enabled(editingMessages.apply())).toBe(false);
        await createFlow(container, "Night shift");
        // Open, one lane, nothing else; listed by name, placed and Pending.
        expect(laneHeads(container)).toEqual([LANE_1.toUpperCase()]);
        expect(stateKeys(container)).toEqual([]);
        expect(cards(container)).toEqual([
            { name: "Inbound parcels", line: "From the trailer to the van", placed: false, chip: null },
            { name: "Night shift", line: "1 lane · 0 states · 0 transitions", placed: true, chip: m.flowPending() },
            { name: "Returns", line: "1 lane · 2 states · 1 transition", placed: false, chip: null },
        ]);
        expect(flowsTab(container)).toBe(`${m.flowsTab()} 3`);
        expect(readRecord(harness).has("Night shift")).toBe(false);
        // The commit: one patch, the flow inserted by name.
        expect(enabled(editingMessages.apply())).toBe(true);
        await press(editingMessages.apply());
        const expected = new SortedMap(FLOWS, compareFor(StringType));
        expected.set("Night shift", NIGHT);
        expect(flowsEqual(readRecord(harness), expected)).toBe(true);
        expect((await commits(harness))).toEqual(["patch", "$init"]);
        // Read back as the commit left it: no longer Pending, nothing to commit.
        expect(cards(container).find((c) => c.name === "Night shift")).toEqual({ name: "Night shift", line: "1 lane · 0 states · 0 transitions", placed: true, chip: null });
        expect(enabled(editingMessages.apply())).toBe(false);
        expect(laneHeads(container)).toEqual([LANE_1.toUpperCase()]);
    }, 30_000);

    test("a new flow's name, not yet committed, is refused for another, with the reason", async () => {
        recordHarness(FLOWS);
        const { container } = await mountRecord();
        await createFlow(container, "Night shift");
        const { popover, name } = await newFlowPopover(container);
        await act(async () => { fireEvent.change(name, { target: { value: "Night shift" } }); });
        expect(popover.getByText(m.flowNameTaken({ name: "Night shift" })).id).toBe(name.getAttribute("aria-describedby"));
        expect((popover.getByRole("button", { name: m.createFlow() }) as HTMLButtonElement).disabled).toBe(true);
    }, 30_000);

    test("Discard drops it: it leaves the tab, the record never held it, and the first flow by name is open again", async () => {
        const harness = recordHarness(FLOWS);
        const { container } = await mountRecord();
        await createFlow(container, "Night shift");
        expect(cards(container).map((c) => c.name)).toContain("Night shift");
        await press(editingMessages.discard());
        expect(cards(container).map((c) => c.name)).toEqual(["Inbound parcels", "Returns"]);
        expect(stateKeys(container)).toEqual(["ARV", "SRT"]);
        expect(flowsEqual(readRecord(harness), FLOWS)).toBe(true);
        expect((await commits(harness))).toEqual(["$init"]);
    }, 30_000);
});

describe("each flow its own session (#1246, FB15)", () => {
    test("a new flow left for another keeps its draft, and the history item acts on the open flow's alone", async () => {
        const harness = recordHarness(FLOWS);
        const { container } = await mountRecord();
        await createFlow(container, "Night shift");
        await createFlow(container, "Day shift");
        // Both Pending, each in its own session; the open one is the last made.
        expect(cards(container).filter((c) => c.chip !== null).map((c) => c.name)).toEqual(["Day shift", "Night shift"]);
        // Another flow open: nothing to undo, discard or commit there — the drafts are the new flows'.
        await openCard(container, "Returns");
        expect(stateKeys(container)).toEqual(["RCV", "INS"]);
        expect([enabled(editingMessages.undo()), enabled(editingMessages.discard()), enabled(editingMessages.apply())]).toEqual([false, false, false]);
        expect(cards(container).filter((c) => c.chip !== null).map((c) => c.name)).toEqual(["Day shift", "Night shift"]);
        // Back to one: its draft is there, and commits alone.
        await openCard(container, "Night shift");
        expect(laneHeads(container)).toEqual([LANE_1.toUpperCase()]);
        expect(enabled(editingMessages.apply())).toBe(true);
        await press(editingMessages.apply());
        expect([...readRecord(harness).keys()]).toEqual(["Inbound parcels", "Night shift", "Returns"]);
        expect(cards(container).filter((c) => c.chip !== null).map((c) => c.name)).toEqual(["Day shift"]);
        // The other's draft is still its own, and Discard drops it alone.
        await openCard(container, "Day shift");
        await press(editingMessages.discard());
        expect(cards(container).map((c) => c.name)).toEqual(["Inbound parcels", "Night shift", "Returns"]);
        expect([...readRecord(harness).keys()]).toEqual(["Inbound parcels", "Night shift", "Returns"]);
    }, 30_000);

    test("an empty record: the Flows tab says so, with no button; main's empty state carries the one \"+ New flow\", and a flow made there opens", async () => {
        const harness = recordHarness(new SortedMap([], compareFor(StringType)));
        const { container } = await mountRecord();
        const main = () => container.querySelector("[data-frame-slot='main']")!;
        expect(main().querySelector("[data-flowchart-no-flows]")).not.toBeNull();
        expect(main().textContent).toContain(m.flowsEmpty());
        // The tab's empty state only says so — no button, no foot (FB28); the one "+ New flow" is main's (§7).
        const tab = container.querySelector("[data-frame-slot='start']")!;
        expect(tab.querySelector("[data-flowchart-no-flows]")!.textContent).toContain(m.flowsEmpty());
        expect(tab.querySelector("[data-flowchart-new-flow]")).toBeNull();
        expect(tab.querySelector("[data-flowchart-flows]")).toBeNull();
        expect([...container.querySelectorAll("[data-flowchart-new-flow]")]
            .map((button) => button.closest("[data-frame-slot]")!.getAttribute("data-frame-slot"))).toEqual(["main"]);
        await act(async () => { fireEvent.click(main().querySelector("[data-flowchart-new-flow]")!); });
        await settle();
        const popover = within(screen.getByRole("dialog"));
        await act(async () => { fireEvent.change(popover.getByRole("textbox", { name: m.flowName() }), { target: { value: "Night shift" } }); });
        await act(async () => { fireEvent.click(popover.getByRole("button", { name: m.createFlow() })); });
        await settle();
        expect(main().querySelector("[data-flowchart-no-flows]")).toBeNull();
        expect(laneHeads(container)).toEqual([LANE_1.toUpperCase()]);
        await press(editingMessages.apply());
        expect([...readRecord(harness).keys()]).toEqual(["Night shift"]);
    }, 30_000);
});
