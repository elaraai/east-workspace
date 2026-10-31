/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The warn ring a part wears while it holds a conflict not yet chosen, as the
 * builders' recipes draw it: the optimiser's highlight in the warn colour, at
 * the part's own edge — outside a mark, a card, a node or a tile, inside a
 * cell — over the highlight and a state's own ring where a part holds both,
 * and beside a selection or a keyboard focus, never under it.
 */

import { describe, expect, test } from "vitest";
import { CONFLICT_RING, CONFLICT_RING_INSET, CONFLICT_RING_INSIDE_FOCUS } from "./conflict-ring.js";
import { allocationBuilderSlotRecipe } from "./slot-recipes/allocationBuilder.js";
import { calendarSlotRecipe } from "./slot-recipes/calendar.js";
import { flowchartSlotRecipe } from "./slot-recipes/flowchart.js";
import { optimiseSlotRecipe } from "./slot-recipes/optimise.js";
import { planSlotRecipe } from "./slot-recipes/plan.js";
import { planElementConflict } from "./slot-recipes/plan/focus.js";
import { rosterBuilderSlotRecipe } from "./slot-recipes/rosterBuilder.js";
import { schematicSlotRecipe } from "./slot-recipes/schematic.js";
import { sheetSlotRecipe } from "./slot-recipes/sheet.js";
import { snapGridSlotRecipe } from "./slot-recipes/snapGrid.js";

type Styles = Readonly<Record<string, unknown>>;
/** A slot's styles. */
const slot = (recipe: { readonly base?: unknown }, name: string): Styles => (recipe.base as Readonly<Record<string, Styles>>)[name]!;
/** A rule's box shadow. */
const shadow = (styles: Styles, selector: string): unknown => (styles[selector] as Styles | undefined)?.boxShadow;
/** A rule's outline offset. */
const outlineOffset = (styles: Styles, selector: string): unknown => (styles[selector] as Styles | undefined)?.outlineOffset;
/** A pattern for a box shadow list that starts with these shadows. */
const startingWith = (shadows: string): RegExp => new RegExp(`^${shadows.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, `);

describe("the conflict ring", () => {
    test("is the optimiser's highlight in the warn colour: 1px at the part's edge and a soft glow, outside it or inside it", () => {
        const glow = "color-mix(in oklch, {colors.status.warn} 45%, transparent)";
        expect(CONFLICT_RING).toBe(`0 0 0 1px {colors.status.warn}, 0 0 8px 1px ${glow}`);
        expect(CONFLICT_RING_INSET).toBe(`inset 0 0 0 1px {colors.status.warn}, inset 0 0 8px 0 ${glow}`);
    });

    test("a cell wears it inside, where cells sit edge to edge: the Sheet's, its bands', and the Plan's table cells, hovered too", () => {
        expect(shadow(slot(sheetSlotRecipe, "cell"), "&[data-conflict]")).toBe(CONFLICT_RING_INSET);
        expect(shadow(slot(sheetSlotRecipe, "groupCell"), "&[data-conflict]")).toBe(CONFLICT_RING_INSET);
        const cell = slot(planSlotRecipe, "tableCellText");
        expect(shadow(cell, "&[data-conflict]")).toBe(CONFLICT_RING_INSET);
        expect(shadow(cell, "&[data-conflict][data-typed]:hover:not(:focus-visible)")).toBe(CONFLICT_RING_INSET);
    });

    test("beside a selection or a keyboard focus, never under it: a cell's 2px of brand at its edge, the warn just inside it; a ring a part draws at its own edge just outside the warn", () => {
        expect(CONFLICT_RING_INSIDE_FOCUS).toBe("inset 0 0 0 3px {colors.status.warn}, inset 0 0 8px 2px color-mix(in oklch, {colors.status.warn} 45%, transparent)");
        // The Sheet's selection is a layer of its own over the cell, 2px of brand inside its edge.
        for (const name of ["cell", "groupCell"]) expect(shadow(slot(sheetSlotRecipe, name), "&[data-conflict][data-selected]"), name).toBe(CONFLICT_RING_INSIDE_FOCUS);
        expect(shadow(slot(planSlotRecipe, "tableCellText"), "&[data-conflict]:focus-visible")).toBe(`inset 0 0 0 2px {colors.brand.solid}, ${CONFLICT_RING_INSIDE_FOCUS}`);
        expect(outlineOffset(slot(rosterBuilderSlotRecipe, "tile"), "&[data-selected][data-conflict]")).toBe("1px");
        expect(outlineOffset(slot(schematicSlotRecipe, "item"), "&[data-selected][data-conflict]")).toBe("1px");
        expect(shadow(slot(snapGridSlotRecipe, "frame"), "[data-selected][data-conflict] > &")).toBe(`${CONFLICT_RING}, {shadows.focus}`);
    });

    test("over a state's own ring: an overlap's, a match's; a drafted tile's, a confirmed mark's and a diamond's edge inside it", () => {
        expect(shadow(slot(calendarSlotRecipe, "event"), "&[data-overlap][data-conflict]")).toBe(CONFLICT_RING);
        const card = slot(schematicSlotRecipe, "item");
        expect(shadow(card, "&[data-emphasis][data-conflict]")).toMatch(startingWith(CONFLICT_RING));
        expect(shadow(card, "&[data-emphasis=pulse][data-conflict]")).toMatch(startingWith(CONFLICT_RING));
        const pulse = Object.keys(card).indexOf("&[data-emphasis=pulse][data-conflict]");
        expect(pulse, "a pulse's after a static match's, which it would otherwise take").toBeGreaterThan(Object.keys(card).indexOf("&[data-emphasis][data-conflict]"));
        expect(shadow(slot(rosterBuilderSlotRecipe, "tile"), "&[data-drafted][data-conflict]:not([data-added]):not([data-moved])"))
            .toBe(`inset 0 0 0 1.5px {colors.brand.solid}, ${CONFLICT_RING}`);
        for (const [name, edge] of [["bar", "1.5px"], ["tile", "1px"], ["cardChip", "1px"]] as const) {
            expect(shadow(slot(planSlotRecipe, name), "&[data-conflict][data-state='appr']"), name).toBe(`inset 0 0 0 ${edge} {colors.brand.solid}, ${CONFLICT_RING}`);
        }
        expect(shadow(slot(planSlotRecipe, "diamond"), "&[data-conflict]")).toBe(`inset 0 0 0 1.5px {colors.brand.solid}, ${CONFLICT_RING}`);
    });

    test("a bin holding a conflict rises over the link layer when hovered or selected, as any bin does", () => {
        const keys = Object.keys(slot(allocationBuilderSlotRecipe, "card"));
        expect(keys.indexOf("&:hover, &[data-selected], &:focus-within")).toBeGreaterThan(keys.indexOf("&[data-conflict]"));
    });

    test("a mark, a card, a node and a tile wear it outside, over what is beside them", () => {
        expect(planElementConflict).toEqual({ "&[data-conflict]": { boxShadow: CONFLICT_RING, zIndex: 3 } });
        for (const [recipe, name] of [[calendarSlotRecipe, "card"], [rosterBuilderSlotRecipe, "card"], [allocationBuilderSlotRecipe, "agendaCard"]] as const) {
            expect(shadow(slot(recipe, name), "&[data-conflict]"), name).toBe(CONFLICT_RING);
        }
        expect(shadow(slot(calendarSlotRecipe, "card"), "&[data-overlap][data-conflict]")).toBe(CONFLICT_RING);
        expect(shadow(slot(allocationBuilderSlotRecipe, "bar"), "&[data-kind=load][data-conflict]")).toBe(CONFLICT_RING);
        expect(shadow(slot(allocationBuilderSlotRecipe, "agendaBin"), "&[data-conflict]")).toBe(CONFLICT_RING);
        expect(shadow(slot(schematicSlotRecipe, "item"), "&[data-conflict]")).toBe(CONFLICT_RING);
        expect(shadow(slot(flowchartSlotRecipe, "node"), "&[data-conflict]")).toBe(CONFLICT_RING);
        expect(shadow(slot(snapGridSlotRecipe, "frame"), "[data-conflict] > &")).toBe(CONFLICT_RING);
    });

    test("over the optimiser's highlight, the conflict's ring is drawn first, on top", () => {
        const landing = slot(optimiseSlotRecipe, "landing");
        expect(shadow(landing, "&[data-optimise-lit] [data-op=add][data-conflict], &[data-optimise-lit] [data-op=chg][data-conflict]")).toMatch(startingWith(CONFLICT_RING));
        expect(shadow(landing, "&[data-optimise-lit] [data-fill=cell][data-op=add][data-conflict], &[data-optimise-lit] [data-fill=cell][data-op=chg][data-conflict]"))
            .toMatch(startingWith(CONFLICT_RING_INSET));
    });

    test("nothing reaches past a part's edge: no layer outside it, no row lifted over its neighbours, no plot let out", () => {
        const recipes = [sheetSlotRecipe, planSlotRecipe, calendarSlotRecipe, rosterBuilderSlotRecipe, allocationBuilderSlotRecipe, schematicSlotRecipe, flowchartSlotRecipe, snapGridSlotRecipe];
        const keys = (styles: unknown): string[] => styles === null || typeof styles !== "object" ? []
            : Object.entries(styles as Styles).flatMap(([key, value]) => [key, ...keys(value)]);
        const reaching = recipes.flatMap((recipe) => keys(recipe.base)).filter((key) => /\[data-conflict\][^,]*::before|:has\(.*\[data-conflict\]\)/.test(key));
        expect(reaching).toEqual([]);
    });
});
