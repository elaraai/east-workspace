/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Ontology editor's table draws Font Awesome's solid icons, never a
 * Feather icon (#1263): the graph warnings' banner, a group's chevron and its
 * warning count, and on each row the cycle's badge, the chevron and the
 * warning, then in its flow detail the upstream, downstream, cycle and
 * warning heads — each in the square the Feather icon took (the
 * `ontologyMark` recipe's size).
 */

import { describe, test, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, variant } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { declaredStyle, foreignIcons } from "@elaraai/east-ui-components/testing";
import { OntologyTable } from "./OntologyTable.js";
import type { Ontology, OntologyLink, OntologyNode } from "./types.js";

afterEach(cleanup);

/** A node named by its id. */
const node = (id: string, type: OntologyNode["type"]): OntologyNode => ({ id, name: id, description: none, type });

/** A link between two nodes. */
const link = (id: string, source: string, target: string, type: OntologyLink["type"]): OntologyLink => ({ id, source, target, type });

/**
 * Two processes in a resource cycle — Buy makes the goods Sell sells, Sell
 * makes the cash Buy spends — each driving one objective and neither
 * measured nor decided, beside a KPI that measures nothing: the table draws
 * every icon it has.
 */
const ONTOLOGY: Ontology = {
    nodes: [
        node("Grow", variant("objective", null)),
        node("Buy", variant("process", null)),
        node("Sell", variant("process", null)),
        node("Goods", variant("resource", null)),
        node("Cash", variant("resource", null)),
        node("Idle", variant("kpi", null)),
    ],
    links: [
        link("l1", "Buy", "Goods", variant("produces", null)),
        link("l2", "Sell", "Goods", variant("uses", null)),
        link("l3", "Sell", "Cash", variant("produces", null)),
        link("l4", "Buy", "Cash", variant("uses", null)),
        link("l5", "Buy", "Grow", variant("drives", null)),
        link("l6", "Sell", "Grow", variant("drives", null)),
    ],
    metadata: none,
};

describe("the Ontology table's icons (#1263)", () => {
    test("every icon is a Font Awesome solid icon, in the square the Feather icon took", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <OntologyTable ontology={ONTOLOGY} onSelectNode={() => {}} />
            </ChakraProvider>,
        );
        // Each mark: its icon, the square it takes (its font, and the icon as
        // wide), and the icon it draws.
        const marks = [...container.querySelectorAll<HTMLElement>("[data-ontology-mark]")].map((mark) => {
            const svg = mark.querySelector("svg");
            return [
                mark.getAttribute("data-ontology-mark"), declaredStyle(mark, "font-size"), declaredStyle(mark, "--fa-width"),
                `${svg?.getAttribute("data-prefix")} ${svg?.getAttribute("data-icon")}`,
            ];
        });
        /** A row's marks: its cycle badge, chevron and warning, then its flow detail's heads. */
        const row = [
            ["arrows-rotate", "11px"], ["chevron-down", "12px"], ["triangle-exclamation", "13px"],
            ["arrow-up", "11px"], ["arrow-down", "11px"], ["arrows-rotate", "11px"], ["triangle-exclamation", "11px"],
        ];
        expect(marks).toEqual([
            // The graph warnings' banner: its warning and its chevron.
            ["triangle-exclamation", "12px"], ["chevron-down", "11px"],
            // The group's chevron and its warning count.
            ["chevron-down", "14px"], ["triangle-exclamation", "12px"],
            // Buy, then Sell.
            ...row, ...row,
        ].map(([icon, size]) => [icon, size, "1em", `fas ${icon}`]));
        expect(foreignIcons(container)).toEqual([]);
    });
});
