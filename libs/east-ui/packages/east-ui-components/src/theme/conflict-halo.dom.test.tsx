/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The warn halo a part holding a conflict not yet chosen wears, as the theme's rules draw it: 1px, 4px outside the
 * part, all the way round wherever the part stands. Each test draws a slot and reads the rules the theme inserted for
 * its class, the class written `&`.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Box, ChakraProvider } from "@chakra-ui/react";
import { system } from "./index.js";
import { useSlotStyles } from "./slot-styles.js";

afterEach(cleanup);

function Drawn({ recipe, slot }: { recipe: string; slot: string }) {
    const styles = useSlotStyles(recipe);
    return <Box css={styles[slot]} data-drawn="" />;
}

/** Every style rule in a list, those inside the theme's cascade layers too. */
function* styleRules(rules: CSSRuleList): Generator<CSSStyleRule> {
    for (const rule of rules) {
        if (rule instanceof CSSStyleRule) yield rule;
        else if ("cssRules" in rule) yield* styleRules((rule as CSSGroupingRule).cssRules);
    }
}

/** The declarations of each rule the theme holds for a slot's class, by its selector, the class written `&`. */
function rulesOf(recipe: string, slot: string): Map<string, string> {
    const { container } = render(<ChakraProvider value={system}><Drawn recipe={recipe} slot={slot} /></ChakraProvider>);
    const name = container.querySelector("[data-drawn]")!.className.split(" ").find((c) => c.startsWith("css-"))!;
    const rules = new Map<string, string>();
    for (const sheet of document.styleSheets) {
        for (const rule of styleRules(sheet.cssRules)) {
            if (rule.selectorText.includes(`.${name}`)) rules.set(rule.selectorText.replaceAll(`.${name}`, "&").replaceAll('"', ""), rule.style.cssText);
        }
    }
    return rules;
}

describe("the conflict halo", () => {
    test("a Sheet cell's goes all the way round: its row rides over the rows beside it, and beside the sticky header or gutter that side runs along the cell's edge", () => {
        expect(rulesOf("sheet", "root").get("& [data-slot=virtualRow]:has([data-conflict])")).toMatch(/z-index: 1/);
        const cell = rulesOf("sheet", "cell");
        expect(cell.get("&[data-conflict]::before")).toMatch(/top: -5px; right: calc\(-6px\); bottom: -5px; left: -5px;.*border-radius: var\(--chakra-radii-sm\);/);
        expect(cell.get("[data-first]>&[data-conflict]::before")).toMatch(/^top: var\(--chakra-spacing-0\);$/);
        expect(cell.get("[data-slot=gutter]+&[data-conflict]::before")).toMatch(/^left: var\(--chakra-spacing-0\);$/);
        expect(rulesOf("sheet", "groupCell").get("[data-first] &[data-conflict]::before")).toMatch(/^top: var\(--chakra-spacing-0\);$/);
    });

    test("a Plan table cell's stands 4px outside it, its corner a cell's, and the plot holding it lets it out above and below, still clipping across, a side at its edge running along it", () => {
        const cell = rulesOf("plan", "tableCellHalo");
        expect(cell.get("&[data-conflict]::before")).toMatch(/top: -5px; right: -5px; bottom: -5px; left: -5px;.*border-radius: var\(--chakra-radii-sm\);/);
        expect([cell.get("&[data-start]::before"), cell.get("&[data-end]::before")]).toEqual(["left: var(--chakra-spacing-0);", "right: var(--chakra-spacing-0);"]);
        const plot = rulesOf("plan", "plot").get("&:has([data-conflict])");
        expect(plot).toMatch(/overflow-x: clip;/);
        expect(plot).toMatch(/overflow-y: visible;/);
    });

    test("a phone's cards wear it, the Roster's and the Allocation's as the Calendar's, and a bin on a card outside its rule", () => {
        for (const [recipe, slot] of [["calendar", "card"], ["rosterBuilder", "card"], ["allocationBuilder", "agendaCard"]] as const) {
            expect(rulesOf(recipe, slot).get("&[data-conflict]")).toMatch(/outline: 1px solid .*outline-offset: 4px;/);
        }
        expect(rulesOf("allocationBuilder", "agendaBin").get("&[data-conflict]::before")).toMatch(/top: calc\(-6px\); right: -5px; bottom: -5px; left: -5px;/);
    });

    test("a Plan mark's label stands clear of the mark's", () => {
        expect(rulesOf("plan", "markLabel").get("[data-conflict]+&")).toMatch(/^margin-left: 6px;$/);
    });

    test("a page editor's tile wears it, its corner the frame's plus 4", () => {
        expect(rulesOf("snapGrid", "tile").get("&[data-conflict]::before")).toMatch(/top: -5px; right: -5px; bottom: -5px; left: -5px;.*border-radius: calc\(var\(--chakra-radii-lg\) \+ 4px\);/);
    });

    test("a Flowchart node's and a Schematic item's stand 4px outside their borders, a selected node's outside its wider one", () => {
        const node = rulesOf("flowchart", "node");
        expect(node.get("&[data-conflict]::before")).toMatch(/top: calc\(-6px\); right: calc\(-6px\); bottom: calc\(-6px\); left: calc\(-6px\);.*border-radius: calc\(var\(--chakra-radii-md\) \+ 4px\);/);
        expect(node.get("&[data-selected][data-conflict]::before")).toMatch(/top: calc\(-6.5px\); right: calc\(-6.5px\); bottom: calc\(-6.5px\); left: calc\(-6.5px\);/);
        expect(rulesOf("schematic", "item").get("&[data-conflict]::before")).toMatch(/top: calc\(-6px\); right: calc\(-6px\); bottom: calc\(-6px\); left: calc\(-6px\);.*border-radius: calc\(var\(--chakra-radii-sm\) \+ 4px\);/);
    });
});
