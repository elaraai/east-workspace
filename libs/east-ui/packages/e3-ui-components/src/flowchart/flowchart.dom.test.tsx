/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @vitest-environment jsdom */

/**
 * Flowchart renderer mount smoke test — proves the hook graph (declaration
 * order / TDZ) and that every root field decodes. jsdom has no layout: the
 * body measures 0×0 once as it mounts and the ResizeObserver stub reports
 * nothing after, so the canvas lays out at that size; the chrome (eyebrow /
 * footer) renders and the value-replace path re-renders.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { some, none, variant } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { EastChakraFlowchart, type FlowchartValue } from "./index.js";

beforeAll(() => {
    class RO {
        observe(): void { /* noop */ }
        unobserve(): void { /* noop */ }
        disconnect(): void { /* noop */ }
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
});

afterEach(cleanup);

const state = (key: string, lane: string, members: bigint | null = null): FlowchartValue["states"][number] => ({
    key,
    label: some(`${key} label`),
    lane,
    members: members !== null ? some(members) : none,
    notes: none,
});

const link = (from: string, to: string, kind: "planned" | "observed" = "planned"): FlowchartValue["links"][number] => ({
    key: some(`${from}→${to}`),
    from,
    to,
    kind: some(variant(kind, null)),
    trigger: from === "IND" ? some("route") : none,
    evidence: some({ volume: some(17350.0), count: some(386n), measuredAt: some(new Date("2026-06-30T00:00:00Z")), unit: some("parcels") }),
});

const LINKS: FlowchartValue["links"] = [link("IND", "CH*"), link("CH*", "SRD", "observed"), link("IND", "IND"), link("SRD", "GONE")];

function mkValue(links: FlowchartValue["links"] = LINKS): FlowchartValue {
    return {
        states: [state("IND", "induct"), state("CH*", "sort", 14n), state("SRD", "sort")],
        links,
        lanes: [{ key: "induct", label: some("Induct") }, { key: "sort", label: none }],
        triggers: [{ key: "route", label: "route", letter: none, owner: some("sort-planner"), queue: some(["IND"]), outcomes: none }],
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
        readOnly: none,
    };
}

describe("EastChakraFlowchart", () => {
    it("mounts, decodes every root field, and renders the chrome", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={mkValue()} storageKey="test.flowchart" />
            </ChakraProvider>,
        );
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
        const first = mkValue();
        const { container, rerender } = render(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={first} storageKey="test.flowchart" />
            </ChakraProvider>,
        );
        const next = mkValue(first.links.slice(0, 2));
        rerender(
            <ChakraProvider value={system}>
                <EastChakraFlowchart value={next} storageKey="test.flowchart" />
            </ChakraProvider>,
        );
        expect(container.textContent?.replace(/\s+/g, "")).toContain("2links");
    });
});
