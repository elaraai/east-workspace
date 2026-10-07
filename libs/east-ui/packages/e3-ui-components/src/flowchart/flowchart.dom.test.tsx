/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @vitest-environment jsdom */

/**
 * Flowchart renderer mount tests — prove the hook graph (declaration order /
 * TDZ), that every payload field decodes, that the flowchart is laid out in
 * its frame (#1245): its toolbar's items, the canvas in main, the footer's
 * counts — narrowed by the host's slice, the open flow's name, the last save
 * — the panes only when given, LR · TD and find state, each pick revealing
 * its state; and that the
 * canvas draws the flow its source holds (#1244): the host's one flow, the
 * host's flows by name, a record of flows read where the flowchart renders —
 * a lone flow its one entry — over many flows the one `open` names, else the
 * first by name. jsdom has no layout: the body measures 0×0 once as it mounts
 * and the ResizeObserver stub reports nothing after, so the canvas lays out
 * at that size, and the toolbar folds nothing.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { SortedMap, StringType, compareFor, some, none, variant, type ValueTypeOf } from "@elaraai/east";
import { UIStore, buildSliceHandle, formatters, system } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { sliceConfig } from "@elaraai/east-ui-components/testing";
import { flowchartKeys, type FlowchartLibraryTabType } from "@elaraai/e3-ui/internal";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { EastChakraFlowchart, openFlow, type FlowchartCanvasValue, type FlowchartFlowValue, type FlowchartValue } from "./index.js";

beforeAll(() => {
    class RO {
        observe(): void { /* noop */ }
        unobserve(): void { /* noop */ }
        disconnect(): void { /* noop */ }
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

const state = (key: string, lane: string, members: bigint | null = null): FlowchartFlowValue["states"][number] => ({
    key,
    label: some(`${key} label`),
    lane,
    members: members !== null ? some(members) : none,
    notes: none,
});

const link = (from: string, to: string, kind: "planned" | "observed" = "planned"): FlowchartFlowValue["links"][number] => ({
    key: some(`${from}→${to}`),
    from,
    to,
    kind: some(variant(kind, null)),
    trigger: from === "IND" ? some("route") : none,
    evidence: some({ volume: some(17350.0), count: some(386n), measuredAt: some(new Date("2026-06-30T00:00:00Z")), unit: some("parcels") }),
});

const LINKS: FlowchartFlowValue["links"] = [link("IND", "CH*"), link("CH*", "SRD", "observed"), link("IND", "IND"), link("SRD", "GONE")];

/** The sort flow: three states over two lanes, a decision, an in-place loop and an unresolved end. */
function sortFlow(links: FlowchartFlowValue["links"] = LINKS): FlowchartFlowValue {
    return {
        description: none,
        lanes: [{ key: "induct", label: some("Induct") }, { key: "sort", label: none }],
        states: [state("IND", "induct"), state("CH*", "sort", 14n), state("SRD", "sort")],
        links,
        triggers: [{ key: "route", label: "route", letter: none, owner: some("sort-planner"), queue: some(["IND"]), outcomes: none }],
    };
}

/** The returns flow: two states, one transition. */
const RETURNS: FlowchartFlowValue = {
    description: some("From the counter back to the sender"),
    lanes: [{ key: "counter", label: none }],
    states: [state("RCV", "counter"), state("INS", "counter")],
    links: [link("RCV", "INS")],
    triggers: [],
};

const CANVAS: FlowchartCanvasValue = {
    orientation: some(variant("LR", null)),
    freshness: some({ label: "evidence-2026.06", date: some(new Date("2026-06-30T00:00:00Z")) }),
    minimap: none,
    legend: some(true),
    density: none,
    slice: none,
    stateHover: none,
    linkHover: none,
    triggerHover: none,
    onSelectState: none,
    onSelectLink: none,
    onSelectTrigger: none,
    onTracePath: none,
    linkMode: some(variant("connect", null)),
    onCreateLink: none,
    onDeleteLink: none,
    canConnect: none,
    onAddLane: none,
    onRenameLane: none,
    onDeleteLane: none,
    onAddState: none,
    onEditState: none,
    onMoveState: none,
};

/** A payload over `source`, its canvas the one above. */
function payload(source: FlowchartValue["source"], open: FlowchartValue["open"] = none): FlowchartValue {
    return { canvas: CANVAS, source, open, library: [], inspector: false, readOnly: false, name: none };
}

/** The host's one flow. */
const hostFlow = (flow: FlowchartFlowValue): FlowchartValue["source"] => variant("data", variant("flow", { value: flow, onApply: none }));

/** The depot's flows by name. */
const FLOWS = new SortedMap<string, FlowchartFlowValue>([["Sort", sortFlow()], ["Returns", RETURNS]], compareFor(StringType));

/** A record's history and patch write, as the record runtime decodes them — unused until the flowchart commits (#1247). */
const HISTORY = () => none;
const PATCH = async () => variant("committed", { commitHash: "c", stateHash: "s" });

/** A record of the depot's flows, its history the commits given. */
function record(history: () => ReturnType<typeof HISTORY> | ReturnType<typeof committed> = HISTORY): FlowchartValue["source"] {
    return variant("record", { read: () => FLOWS, history, commit: { patch: PATCH } });
}

/** A history, newest first, whose newest commit was made `at` and the one before it long before. */
function committed(at: Date) {
    const newest: ValueTypeOf<typeof RecordCommitInfoType> = {
        hash: "c2", parent: some("c1"), state: "s2", mutation: "patch", actor: "planner", at, delta: none,
    };
    const first: ValueTypeOf<typeof RecordCommitInfoType> = {
        hash: "c1", parent: none, state: "s1", mutation: "patch", actor: "planner", at: new Date("2026-01-05T09:00:00Z"), delta: none,
    };
    return some([newest, first]);
}

function mount(value: FlowchartValue) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraFlowchart value={value} storageKey="test.flowchart" />
        </ChakraProvider>,
    );
}

/** Every state card drawn, by its key. */
const stateKeys = (container: HTMLElement): (string | null)[] =>
    [...container.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node"));

/** The toolbar's items, in the row's order, as the toolbar says it laid them out. */
const toolbarItems = (container: HTMLElement): string[] =>
    (container.querySelector("[data-toolbar]")?.getAttribute("data-toolbar-state") ?? "").split(";").filter((part) => part !== "").map((part) => part.split("=")[0]!);

/** The footer's words. */
const footerText = (container: HTMLElement): string => container.querySelector("[data-frame-slot='footer'] [data-flowchart-footer]")?.textContent ?? "";

describe("EastChakraFlowchart", () => {
    it("mounts, decodes every payload field, and lays the flowchart out in its frame: the toolbar's items, the canvas in main, the footer's counts", () => {
        const { container } = mount(payload(hostFlow(sortFlow())));
        const frame = container.querySelector("[data-flowchart-root] > [data-builder-frame]");
        expect(frame).not.toBeNull();
        // One toolbar, the frame's: find state, LR · TD, the freshness chip — no eyebrow of the canvas's own.
        expect(toolbarItems(container)).toEqual(["seek", "orientation", "freshness"]);
        expect(container.querySelectorAll("[data-toolbar]")).toHaveLength(1);
        expect(frame!.querySelector("[data-frame-slot='toolbar'] [data-toolbar-item='seek'] input")).not.toBeNull();
        const segments = [...container.querySelectorAll("[data-flowchart-seg='orientation'] [role='radio']")];
        expect(segments.map((s) => [s.textContent, s.getAttribute("aria-checked")])).toEqual([["LR", "true"], ["TD", "false"]]);
        const chip = container.querySelector("[data-toolbar-item='freshness'] [data-flowchart-freshness]")!;
        expect(chip.textContent).toBe(`evidence-2026.06${formatters("en-US").monthDay(new Date("2026-06-30T00:00:00Z"))}`);
        // The canvas fills main.
        expect(frame!.querySelector("[data-frame-slot='main'] > [data-flowchart-body]")).not.toBeNull();
        expect(stateKeys(container)).toEqual(["IND", "CH*", "SRD", "GONE"]);
        // The footer counts the flow's ROWS (4, the ↻-folded in-place loop
        // among them); the ghost's transition counts as unresolved. One flow: no name.
        expect(footerText(container).replace(/\s+/g, "")).toMatch(/^4links/);
        expect(footerText(container)).toContain("1 planned · 1 observed · 1 unresolved");
        expect(container.querySelector("[data-flowchart-flow]")).toBeNull();
        // No pane: no library listed, no inspector given.
        expect(frame!.querySelector("[data-frame-slot='start'], [data-frame-slot='end']")).toBeNull();
    });

    it("re-renders in place on value replace with the same storageKey", () => {
        const { container, rerender } = mount(payload(hostFlow(sortFlow())));
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={payload(hostFlow(sortFlow(LINKS.slice(0, 2))))} storageKey="test.flowchart" />
            </ChakraProvider>,
        );
        expect(footerText(container).replace(/\s+/g, "")).toMatch(/^2links/);
    });

    it("the payload's readOnly takes the canvas's edit affordances away", () => {
        const editable: FlowchartCanvasValue = { ...CANVAS, onAddLane: some(() => null) };
        const { container } = mount({ ...payload(hostFlow(sortFlow())), canvas: editable });
        expect(container.querySelector("[data-flowchart-addlane]")).not.toBeNull();
        cleanup();
        const { container: shut } = mount({ ...payload(hostFlow(sortFlow())), canvas: editable, readOnly: true });
        expect(shut.querySelector("[data-flowchart-addlane]")).toBeNull();
        expect(stateKeys(shut)).toContain("CH*");
    });

    it("a flowchart without a freshness chip has none on its toolbar, and one over an empty flow has no find state", () => {
        const { container } = mount({ ...payload(hostFlow({ ...sortFlow(), states: [], links: [] })), canvas: { ...CANVAS, freshness: none } });
        expect(toolbarItems(container)).toEqual(["orientation"]);
        expect(stateKeys(container)).toEqual([]);
        // The canvas's box stays in main, measured, for the flow that comes.
        expect(container.querySelector("[data-frame-slot='main'] > [data-flowchart-body]")).not.toBeNull();
    });
});

describe("LR · TD and find state (#1245)", () => {
    /** Each lane header's anchor: middle across the top in LR, start down the side in TD. */
    const anchors = (container: HTMLElement) => [...container.querySelectorAll("[data-flowchart-lane]")].map((el) => el.getAttribute("text-anchor"));

    it("LR · TD turns the canvas: a pick checks its segment and lays the lanes out down the side", () => {
        const { container } = mount(payload(hostFlow(sortFlow())));
        expect(anchors(container)).toEqual(["middle", "middle"]);
        fireEvent.click(screen.getByRole("radio", { name: "TD" }));
        expect(screen.getByRole("radio", { name: "TD" }).getAttribute("aria-checked")).toBe("true");
        expect(anchors(container)).toEqual(["start", "start"]);
    });

    it("the host's orientation seeds LR · TD, and a new one from the host turns the canvas again", () => {
        const td: FlowchartCanvasValue = { ...CANVAS, orientation: some(variant("TD", null)) };
        const { container, rerender } = mount({ ...payload(hostFlow(sortFlow())), canvas: td });
        expect(screen.getByRole("radio", { name: "TD" }).getAttribute("aria-checked")).toBe("true");
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={payload(hostFlow(sortFlow()))} storageKey="test.flowchart" />
            </ChakraProvider>,
        );
        expect(anchors(container)).toEqual(["middle", "middle"]);
    });

    it("find state finds the open flow's states by key and by label, and a pick selects the state", async () => {
        const { container } = mount(payload(hostFlow(sortFlow())));
        const box = within(container).getByPlaceholderText("Search keys");
        await userEvent.type(box, "lab");
        // Every label holds the text: three states, in their keys' order.
        await waitFor(() => expect(within(container).getByText("3 matches")).toBeTruthy());
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["CH* · CH* label", "IND · IND label", "SRD · SRD label"]);
        await userEvent.clear(box);
        await userEvent.type(box, "sr");
        await waitFor(() => expect(screen.getByText("SRD · SRD label")).toBeTruthy());
        fireEvent.click(screen.getByText("SRD · SRD label"));
        await waitFor(() => expect(container.querySelector('[data-flowchart-node="SRD"]')!.hasAttribute("data-selected")).toBe(true));
        // Each pick reveals its state: a second selects the state it lands on.
        await userEvent.clear(box);
        await userEvent.type(box, "in");
        await waitFor(() => expect(screen.getByText("IND · IND label")).toBeTruthy());
        fireEvent.click(screen.getByText("IND · IND label"));
        await waitFor(() => expect(container.querySelector('[data-flowchart-node="IND"]')!.hasAttribute("data-selected")).toBe(true));
        expect(container.querySelector('[data-flowchart-node="SRD"]')!.hasAttribute("data-selected")).toBe(false);
    });
});

describe("the frame's panes and footer (#1245)", () => {
    const LIBRARY: ValueTypeOf<FlowchartLibraryTabType>[] = [
        variant("flows", null),
        variant("states", { name: "Steps", icon: some("box"), cards: [] }),
    ];

    it("a library that lists tabs is the start pane, its tabs in order; an inspector given is the end pane", () => {
        const { container } = mount({ ...payload(record()), library: LIBRARY, inspector: true });
        const start = container.querySelector("[data-frame-slot='start']")!;
        expect([...start.querySelectorAll("[role='tab']")].map((t) => t.textContent)).toEqual(["Flows", "Steps"]);
        expect(container.querySelector("[data-frame-slot='end']")!.textContent).toContain("Inspector");
    });

    it("the panes' collapsed state is kept under the flowchart's name", async () => {
        const collapsed = (container: HTMLElement) => container.querySelector("[data-frame-slot='start'] [data-collapsed]") !== null;
        const depot: FlowchartValue = { ...payload(record()), library: LIBRARY, name: some("depot") };
        const { container } = mount(depot);
        expect(collapsed(container)).toBe(false);
        await act(async () => { fireEvent.click(within(container).getByRole("button", { name: "Collapse Library" })); });
        expect(collapsed(container)).toBe(true);
        expect(Object.keys(localStorage).some((key) => key.startsWith(`${flowchartKeys("depot").frame}.start`))).toBe(true);
        cleanup();
        // Mounted again under its name, it opens as the viewer left it; another flowchart keeps its own.
        expect(collapsed(mount(depot).container)).toBe(true);
        cleanup();
        expect(collapsed(mount({ ...depot, name: some("returns") }).container)).toBe(false);
    });

    it("over many flows the footer leads with the open flow's name; over a record it says when the record was last saved", () => {
        const today = new Date();
        const { container } = mount(payload(record(() => committed(today)), some("Returns")));
        expect(container.querySelector("[data-flowchart-flow]")!.textContent).toBe("Returns");
        expect(container.querySelector("[data-flowchart-saved]")!.textContent).toBe(` · saved ${formatters("en-US").time(today)}`);
        cleanup();
        // Saved another day: its date and its time.
        const before = new Date("2026-06-30T14:02:00Z");
        const { container: older } = mount(payload(record(() => committed(before))));
        expect(older.querySelector("[data-flowchart-flow]")!.textContent).toBe("Returns");
        expect(older.querySelector("[data-flowchart-saved]")!.textContent).toBe(` · saved ${formatters("en-US").dateTime(before)}`);
        cleanup();
        // Over the host's flows, no save to say.
        const { container: hosts } = mount(payload(variant("data", variant("flows", { value: FLOWS, onApply: none })), some("Sort")));
        expect(hosts.querySelector("[data-flowchart-flow]")!.textContent).toBe("Sort");
        expect(hosts.querySelector("[data-flowchart-saved]")).toBeNull();
    });

    it("while the host's slice narrows the transitions, the footer says from how many, and by what share", () => {
        initializeStore(new UIStore());
        const cfg = sliceConfig({
            at: variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none }),
        }, { rangeFieldId: some("at") });
        const initial = {
            range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        };
        // The host's three scans; the flow it builds from the rows the slice keeps holds one transition.
        const scans = [{ at: new Date("2026-05-04T00:00:00Z") }, { at: new Date("2026-06-01T00:00:00Z") }, { at: new Date("2026-07-15T00:00:00Z") }];
        const handle = buildSliceHandle("flowchart.footer.narrowed", cfg, initial as never, scans as never, none) as never as { setRange(r: unknown): void };
        const canvas: FlowchartCanvasValue = { ...CANVAS, slice: some({ slice: handle as never, affordances: [variant("filter", null)] }) };
        const { container } = mount({ ...payload(hostFlow(sortFlow(LINKS.slice(0, 1)))), canvas });
        expect(footerText(container)).not.toContain("narrowed");
        act(() => {
            handle.setRange(some(variant("datetime", { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-08-01T00:00:00Z") })));
        });
        // One of three kept: two in three narrowed away.
        expect(footerText(container)).toContain(`1link· narrowed from 3 ·−${formatters("en-US").percent(1 - 1 / 3)}`);
    });
});

describe("the flow the source holds (#1244)", () => {
    it("over the host's flows, the canvas shows the flow `open` names", () => {
        const { container } = mount(payload(variant("data", variant("flows", { value: FLOWS, onApply: none })), some("Sort")));
        expect(stateKeys(container)).toContain("CH*");
        expect(stateKeys(container)).not.toContain("RCV");
    });

    it("over many flows, with none named — or one the flows do not hold — the canvas shows the first by name", () => {
        for (const open of [none, some("Gone")]) {
            const { container } = mount(payload(variant("data", variant("flows", { value: FLOWS, onApply: none })), open));
            expect(stateKeys(container)).toEqual(["RCV", "INS"]);
            cleanup();
        }
    });

    it("over a record of flows, the canvas reads the record where it renders", () => {
        let reads = 0;
        const read = (): typeof FLOWS => { reads++; return FLOWS; };
        const { container } = mount(payload(variant("record", { read, history: HISTORY, commit: { patch: PATCH } }), some("Sort")));
        expect(reads).toBeGreaterThan(0);
        expect(stateKeys(container)).toContain("SRD");
    });

    it("a lone flow is a record of flows with one entry, and the canvas shows it", () => {
        const one = new SortedMap<string, FlowchartFlowValue>([["Returns", RETURNS]], compareFor(StringType));
        const { container } = mount(payload(variant("record", { read: () => one, history: HISTORY, commit: { patch: PATCH } })));
        expect(stateKeys(container)).toEqual(["RCV", "INS"]);
    });

    it("an empty record of flows draws an empty canvas, in its frame", () => {
        const empty = new SortedMap<string, FlowchartFlowValue>([], compareFor(StringType));
        const { container } = mount(payload(variant("record", { read: () => empty, history: HISTORY, commit: { patch: PATCH } })));
        expect(container.querySelector("[data-flowchart-root] > [data-builder-frame]")).not.toBeNull();
        expect(stateKeys(container)).toEqual([]);
    });

    it("a flow that comes after an empty record is drawn: the canvas's box was measured while it was empty", () => {
        const empty = new SortedMap<string, FlowchartFlowValue>([], compareFor(StringType));
        const { container, rerender } = mount(payload(variant("record", { read: () => empty, history: HISTORY, commit: { patch: PATCH } })));
        expect(stateKeys(container)).toEqual([]);
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={payload(record(), some("Sort"))} storageKey="test.flowchart" />
            </ChakraProvider>,
        );
        expect(stateKeys(container)).toEqual(["IND", "CH*", "SRD", "GONE"]);
    });

    it("a record that cannot be read says why, in its frame's main, in place of the canvas", () => {
        const read = (): typeof FLOWS => { throw new Error("the record is not loaded"); };
        const { container } = mount(payload(variant("record", { read, history: HISTORY, commit: { patch: PATCH } })));
        const main = container.querySelector("[data-flowchart-root] [data-frame-slot='main']")!;
        expect(main.textContent).toContain("The flows could not be read: the record is not loaded");
        expect(container.querySelector("[data-flowchart-body]")).toBeNull();
    });

    it("openFlow names the open flow by East's order of names", () => {
        const [a, b, upper] = [sortFlow(), { ...RETURNS }, { ...RETURNS }];
        const byName = new SortedMap<string, FlowchartFlowValue>([["b", b], ["a", a], ["C", upper]], compareFor(StringType));
        expect(openFlow(byName, none)).toEqual({ name: "C", flow: upper });
        expect(openFlow(byName, none)!.flow).toBe(upper);
        expect(openFlow(byName, some("a"))).toEqual({ name: "a", flow: a });
        expect(openFlow(byName, some("Gone"))!.name).toBe("C");
        expect(openFlow(new SortedMap([], compareFor(StringType)), some("a"))).toBeUndefined();
    });
});
