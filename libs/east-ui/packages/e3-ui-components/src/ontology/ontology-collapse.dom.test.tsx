/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What the Ontology table's collapses hide is inert while they are shut
 * (#1270): a row's flow detail, a group's body and the graph warnings stay
 * mounted, so they animate open and shut, and each is `inert` — out of the tab
 * order, the accessibility tree and the pointer's way — until it opens. jsdom
 * holds the attribute; the showcase's `ontology-table.spec.ts` what Chromium
 * does with it.
 */

import { describe, test, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, variant } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { OntologyTable } from "./OntologyTable.js";
import type { Ontology, OntologyLink, OntologyNode } from "./types.js";

afterEach(cleanup);

/** A node named by its id. */
const node = (id: string, type: OntologyNode["type"]): OntologyNode => ({ id, name: id, description: none, type });

/** A link between two nodes. */
const link = (id: string, source: string, target: string, type: OntologyLink["type"]): OntologyLink => ({ id, source, target, type });

/** Two processes driving one objective, beside a KPI that measures nothing: one group of two rows, and graph warnings. */
const ONTOLOGY: Ontology = {
    nodes: [
        node("Grow", variant("objective", null)),
        node("Buy", variant("process", null)),
        node("Sell", variant("process", null)),
        node("Goods", variant("resource", null)),
        node("Idle", variant("kpi", null)),
    ],
    links: [
        link("l1", "Buy", "Goods", variant("produces", null)),
        link("l2", "Sell", "Goods", variant("uses", null)),
        link("l3", "Buy", "Grow", variant("drives", null)),
        link("l4", "Sell", "Grow", variant("drives", null)),
    ],
    metadata: none,
};

/** Each collapse's region, in the page's order: its kind, and whether it is inert and open. */
const regions = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-ontology-collapse]")]
    .map((el) => [el.getAttribute("data-ontology-collapse"), el.hasAttribute("inert"), el.hasAttribute("data-open")]);

describe("the Ontology table's collapses (#1270)", () => {
    test("what a shut collapse hides is inert, and opening it lifts that — a row's flow detail, the graph warnings and a group's body", () => {
        const { container, getByText } = render(
            <ChakraProvider value={system}>
                <OntologyTable ontology={ONTOLOGY} onSelectNode={() => {}} />
            </ChakraProvider>,
        );
        // At rest: the graph warnings and both rows' details shut, the group open.
        expect(regions(container)).toEqual([
            ["lints", true, false], ["group", false, true], ["detail", true, false], ["detail", true, false],
        ]);
        // The first row opened — the row whose detail the next table row holds: its detail open, the other shut.
        const detail = container.querySelector<HTMLElement>("[data-ontology-collapse='detail']")!;
        fireEvent.click(detail.closest("tr")!.previousElementSibling!);
        expect(regions(container)).toEqual([
            ["lints", true, false], ["group", false, true], ["detail", false, true], ["detail", true, false],
        ]);
        // The graph warnings opened.
        fireEvent.click(getByText(/graph warnings/));
        expect(regions(container)[0]).toEqual(["lints", false, true]);
        // The group shut from its header — the row above its body: its body inert, the open detail under it with it.
        const body = container.querySelector<HTMLElement>("[data-ontology-collapse='group']")!;
        fireEvent.click(body.parentElement!.previousElementSibling!);
        expect(regions(container)).toEqual([
            ["lints", false, true], ["group", true, false], ["detail", false, true], ["detail", true, false],
        ]);
        expect(detail.closest("[inert]")).toBe(body);
    });
});
