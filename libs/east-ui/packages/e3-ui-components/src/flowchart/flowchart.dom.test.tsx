/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @vitest-environment jsdom */

/**
 * Flowchart renderer mount tests — prove the hook graph (declaration order /
 * TDZ), that every payload field decodes, and that the canvas draws the flow
 * its source holds (#1244): the host's one flow, the host's flows by name, a
 * record of flows read where the flowchart renders — a lone flow its one
 * entry — over many flows the one `open` names, else the first by name.
 * jsdom has no layout: the body measures 0×0 once as it mounts and the
 * ResizeObserver stub reports nothing after, so the canvas lays out at that
 * size; the chrome (eyebrow / footer) renders and the value-replace path
 * re-renders.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { SortedMap, StringType, compareFor, some, none, variant } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { EastChakraFlowchart, openFlow, type FlowchartCanvasValue, type FlowchartFlowValue, type FlowchartValue } from "./index.js";

beforeAll(() => {
    class RO {
        observe(): void { /* noop */ }
        unobserve(): void { /* noop */ }
        disconnect(): void { /* noop */ }
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
});

afterEach(cleanup);

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
    height: some("480"),
    maxHeight: none,
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

describe("EastChakraFlowchart", () => {
    it("mounts, decodes every payload field, and renders the chrome", () => {
        const { container } = mount(payload(hostFlow(sortFlow())));
        expect(container.querySelector("[data-flowchart-root]")).not.toBeNull();
        expect(container.querySelector("[data-flowchart-eyebrow]")).not.toBeNull();
        const footer = container.querySelector("[data-flowchart-footer]");
        expect(footer).not.toBeNull();
        // The footer counts narrowed ROWS (4, incl. the ↻-folded self-loop);
        // the ghost adds unresolved. textContent concatenates spans.
        expect(footer?.textContent?.replace(/\s+/g, "")).toContain("4links");
        expect(footer?.textContent).toContain("1 unresolved");
        // Orientation segment + freshness chip decode.
        expect(container.textContent).toContain("LR");
        expect(container.textContent).toContain("evidence-2026.06");
    });

    it("re-renders in place on value replace with the same storageKey", () => {
        const { container, rerender } = mount(payload(hostFlow(sortFlow())));
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={payload(hostFlow(sortFlow(LINKS.slice(0, 2))))} storageKey="test.flowchart" />
            </ChakraProvider>,
        );
        expect(container.textContent?.replace(/\s+/g, "")).toContain("2links");
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

    it("an empty record of flows draws an empty canvas", () => {
        const empty = new SortedMap<string, FlowchartFlowValue>([], compareFor(StringType));
        const { container } = mount(payload(variant("record", { read: () => empty, history: HISTORY, commit: { patch: PATCH } })));
        expect(container.querySelector("[data-flowchart-root]")).not.toBeNull();
        expect(stateKeys(container)).toEqual([]);
    });

    it("a record that cannot be read says why, in place of the canvas", () => {
        const read = (): typeof FLOWS => { throw new Error("the record is not loaded"); };
        const { container } = mount(payload(variant("record", { read, history: HISTORY, commit: { patch: PATCH } })));
        expect(container.textContent).toContain("The flows could not be read: the record is not loaded");
        expect(container.querySelector("[data-flowchart-root]")).toBeNull();
    });

    it("openFlow names the open flow by East's order of names", () => {
        const [a, b, upper] = [sortFlow(), { ...RETURNS }, { ...RETURNS }];
        const byName = new SortedMap<string, FlowchartFlowValue>([["b", b], ["a", a], ["C", upper]], compareFor(StringType));
        expect(openFlow(byName, none)).toBe(upper);
        expect(openFlow(byName, some("a"))).toBe(a);
        expect(openFlow(byName, some("Gone"))).toBe(upper);
        expect(openFlow(new SortedMap([], compareFor(StringType)), some("a"))).toBeUndefined();
    });
});
