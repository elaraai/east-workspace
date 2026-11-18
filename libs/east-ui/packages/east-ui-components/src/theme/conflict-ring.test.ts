/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The warn ring a part wears while it holds a conflict not yet chosen, as the
 * builders' recipes draw it: the optimiser's highlight in the warn colour, at
 * the part's own edge — outside a mark, a card, a node or a tile, inside a
 * cell — over the highlight and a state's own ring where a part holds both,
 * and beside a selection or a keyboard focus, never under it. A mark, a card,
 * a node or a tile whose row holds a number outside its field's bounds wears
 * it too, in every one of those states (#1585).
 */

import { describe, expect, test } from "vitest";
import { CONFLICT_RING, CONFLICT_RING_INSET, CONFLICT_RING_INSIDE_FOCUS } from "./conflict-ring.js";
import { allocationBuilderSlotRecipe } from "./slot-recipes/allocationBuilder.js";
import { calendarSlotRecipe } from "./slot-recipes/calendar.js";
import { flowchartSlotRecipe } from "./slot-recipes/flowchart.js";
import { optimiseSlotRecipe } from "./slot-recipes/optimise.js";
import { planSlotRecipe } from "./slot-recipes/plan.js";
import { planElementConflict } from "./slot-recipes/plan/focus.js";
import { recordSlotRecipe } from "./slot-recipes/record.js";
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

/**
 * How strong a rule's selector is past its slot's class, as CSS weighs it: an attribute test each, `:is(…)` its
 * strongest argument, and `:where(…)` nothing.
 *
 * @param selector - The rule's selector, `&` its slot
 * @returns Its weight
 */
function weight(selector: string): number {
    let total = 0;
    for (let i = 0; i < selector.length; i++) {
        const group = selector.startsWith(":where(", i) ? "where" : selector.startsWith(":is(", i) ? "is" : undefined;
        if (group !== undefined) {
            const start = selector.indexOf("(", i) + 1;
            let depth = 1, end = start;
            for (; depth > 0; end++) depth += selector[end] === "(" ? 1 : selector[end] === ")" ? -1 : 0;
            if (group === "is") total += Math.max(...selector.slice(start, end - 1).split(",").map((part) => weight(part.trim())));
            i = end - 1;
        } else if (selector[i] === "[") total++;
    }
    return total;
}

describe("the conflict ring", () => {
    test("is the optimiser's highlight in the warn colour: 1px at the part's edge and a soft glow, outside it or inside it", () => {
        const glow = "color-mix(in oklch, {colors.status.warn} 45%, transparent)";
        expect(CONFLICT_RING).toBe(`0 0 0 1px {colors.status.warn}, 0 0 8px 1px ${glow}`);
        expect(CONFLICT_RING_INSET).toBe(`inset 0 0 0 1px {colors.status.warn}, inset 0 0 8px 0 ${glow}`);
    });

    test("a cell wears it inside, where cells sit edge to edge: the Sheet's, its bands', the Record's and the Plan's table cells, hovered too", () => {
        expect(shadow(slot(sheetSlotRecipe, "cell"), "&[data-conflict]")).toBe(CONFLICT_RING_INSET);
        expect(shadow(slot(sheetSlotRecipe, "groupCell"), "&[data-conflict]")).toBe(CONFLICT_RING_INSET);
        expect(shadow(slot(recordSlotRecipe, "cell"), "&[data-conflict]")).toBe(CONFLICT_RING_INSET);
        const cell = slot(planSlotRecipe, "tableCellText");
        expect(shadow(cell, "&[data-conflict]")).toBe(CONFLICT_RING_INSET);
        expect(shadow(cell, "&[data-conflict][data-typed]:hover:not(:focus-visible)")).toBe(CONFLICT_RING_INSET);
    });

    test("a Plan table cell holding a conflict sits on its row's plain surface, so a row's selection tint under it never greys the glow, and it reads warm as the Sheet's cell does on its paper", () => {
        expect((slot(planSlotRecipe, "tableCellText")["&[data-conflict]"] as Styles).background).toBe("bg.surface");
    });

    test("beside a selection or a keyboard focus, never under it: a cell's 2px of brand at its edge, the warn just inside it; a ring a part draws at its own edge just outside the warn", () => {
        expect(CONFLICT_RING_INSIDE_FOCUS).toBe("inset 0 0 0 3px {colors.status.warn}, inset 0 0 8px 2px color-mix(in oklch, {colors.status.warn} 45%, transparent)");
        // The Sheet's selection is a layer of its own over the cell, 2px of brand inside its edge.
        for (const name of ["cell", "groupCell"]) expect(shadow(slot(sheetSlotRecipe, name), "&[data-conflict][data-selected]"), name).toBe(CONFLICT_RING_INSIDE_FOCUS);
        expect(shadow(slot(planSlotRecipe, "tableCellText"), "&[data-conflict]:focus-visible")).toBe(`inset 0 0 0 2px {colors.brand.solid}, ${CONFLICT_RING_INSIDE_FOCUS}`);
        // The Record's active cell rings itself: the brand at its edge, as the Plan's focused cell's.
        expect(shadow(slot(recordSlotRecipe, "cell"), "&[data-conflict][data-active]")).toBe(`inset 0 0 0 2px {colors.brand.solid}, ${CONFLICT_RING_INSIDE_FOCUS}`);
        expect(outlineOffset(slot(rosterBuilderSlotRecipe, "tile"), "&[data-selected]:is([data-conflict], [data-bounds])")).toBe("1px");
        expect(outlineOffset(slot(schematicSlotRecipe, "item"), "&[data-selected]:is([data-conflict], [data-bounds])")).toBe("1px");
        // The grid's selected tile is outlined 4px out (#1672): past the warn its frame wears at its own edge.
        expect([outlineOffset(slot(snapGridSlotRecipe, "tile"), "&[data-selected]"), shadow(slot(snapGridSlotRecipe, "frame"), "[data-conflict] > &")]).toEqual(["4px", CONFLICT_RING]);
    });

    test("over a state's own ring: an overlap's, a match's; a drafted tile's, a confirmed mark's and a diamond's edge inside it", () => {
        expect(shadow(slot(calendarSlotRecipe, "event"), "&[data-overlap]:is([data-conflict], [data-bounds])")).toBe(CONFLICT_RING);
        const card = slot(schematicSlotRecipe, "item");
        expect(shadow(card, "&[data-emphasis]:is([data-conflict], [data-bounds])")).toMatch(startingWith(CONFLICT_RING));
        expect(shadow(card, "&[data-emphasis=pulse]:is([data-conflict], [data-bounds])")).toMatch(startingWith(CONFLICT_RING));
        const pulse = Object.keys(card).indexOf("&[data-emphasis=pulse]:is([data-conflict], [data-bounds])");
        expect(pulse, "a pulse's after a static match's, which it would otherwise take").toBeGreaterThan(Object.keys(card).indexOf("&[data-emphasis]:is([data-conflict], [data-bounds])"));
        expect(shadow(slot(rosterBuilderSlotRecipe, "tile"), "&[data-drafted]:is([data-conflict], [data-bounds]):not([data-added]):not([data-moved])"))
            .toBe(`inset 0 0 0 1.5px {colors.brand.solid}, ${CONFLICT_RING}`);
        for (const [name, edge] of [["bar", "1.5px"], ["tile", "1px"], ["cardChip", "1px"]] as const) {
            expect(shadow(slot(planSlotRecipe, name), "&:is([data-conflict], [data-bounds])[data-state='appr']"), name).toBe(`inset 0 0 0 ${edge} {colors.brand.solid}, ${CONFLICT_RING}`);
        }
        // A diamond's edge is one property: the brand, or its status's tone (#1541), inside the warn either way.
        expect(slot(planSlotRecipe, "diamond")["--diamond-edge"]).toBe("{colors.brand.solid}");
        expect(shadow(slot(planSlotRecipe, "diamond"), "&:is([data-conflict], [data-bounds])")).toBe(`inset 0 0 0 1.5px var(--diamond-edge), ${CONFLICT_RING}`);
    });

    test("on a Plan item its status's ring gives way to it, and an item its status draws open keeps its own ring inside it (#1541)", () => {
        const open = "inset 0 0 0 1.5px var(--status-ink)";
        for (const name of ["bar", "tile", "cardChip"]) {
            const box = slot(planSlotRecipe, name);
            expect(shadow(box, "&:is([data-conflict], [data-bounds])[data-ring]:where([data-tone]:not([data-draft]))"), name).toBe(`${open}, ${CONFLICT_RING}`);
            // Each ring a box wears is written after the one it takes the place of, and is as strong: its status's, an
            // overlap's — a danger status's own in an overlap pair — then the conflict's: plain, on a confirmed box, on an
            // open one.
            const keys = Object.keys(box);
            const rings = [
                "&[data-tone]", "&[data-overlap]", "&[data-overlap][data-state='appr']", "&[data-overlap][data-ring]:where([data-tone]:not([data-draft]))",
                "&[data-overlap]:where([data-tone='danger'])", "&[data-overlap][data-state='appr']:where([data-tone='danger'])",
                "&[data-overlap][data-ring]:where([data-tone='danger']:not([data-draft]))",
                "&:is([data-conflict], [data-bounds])", "&:is([data-conflict], [data-bounds])[data-state='appr']",
                "&:is([data-conflict], [data-bounds])[data-ring]:where([data-tone]:not([data-draft]))",
            ];
            const order = rings.map((key) => keys.indexOf(key));
            expect(order.every((at) => at >= 0), name).toBe(true);
            expect(order, name).toEqual([...order].sort((a, b) => a - b));
            // No rule of an overlap outweighs the conflict's it stands before: a danger status in an overlap pair holding a
            // conflict wears the conflict's ring, on a plain, a confirmed or an open box.
            expect(rings.map(weight), name).toEqual([1, 1, 2, 2, 1, 2, 2, 1, 2, 2]);
        }
        // The danger keeps its ring in an overlap pair — inside a confirmed box's too.
        const bar = slot(planSlotRecipe, "bar");
        expect(shadow(bar, "&[data-overlap]:where([data-tone='danger'])")).toBe("0 0 0 1.5px var(--status-ink)");
        expect(shadow(bar, "&[data-overlap][data-state='appr']:where([data-tone='danger'])")).toBe("inset 0 0 0 1.5px {colors.brand.solid}, 0 0 0 1.5px var(--status-ink)");
        expect(shadow(slot(planSlotRecipe, "milestoneDot"), "&[data-tone][data-ring]:is([data-conflict], [data-bounds])")).toBe(`${open}, ${CONFLICT_RING}`);
    });

    test("a bin holding a conflict rises over the link layer when hovered or selected, as any bin does", () => {
        const keys = Object.keys(slot(allocationBuilderSlotRecipe, "card"));
        expect(keys.indexOf("&:hover, &[data-selected], &:focus-within")).toBeGreaterThan(keys.indexOf("&:is([data-conflict], [data-bounds])"));
    });

    test("a mark, a card, a node and a tile wear it outside, over what is beside them", () => {
        expect(planElementConflict).toEqual({ "&:is([data-conflict], [data-bounds])": { boxShadow: CONFLICT_RING, zIndex: 3 } });
        for (const [recipe, name] of [[calendarSlotRecipe, "card"], [rosterBuilderSlotRecipe, "card"], [allocationBuilderSlotRecipe, "agendaCard"]] as const) {
            expect(shadow(slot(recipe, name), "&:is([data-conflict], [data-bounds])"), name).toBe(CONFLICT_RING);
        }
        expect(shadow(slot(calendarSlotRecipe, "card"), "&[data-overlap]:is([data-conflict], [data-bounds])")).toBe(CONFLICT_RING);
        expect(shadow(slot(allocationBuilderSlotRecipe, "bar"), "&[data-kind=load][data-conflict]")).toBe(CONFLICT_RING);
        expect(shadow(slot(allocationBuilderSlotRecipe, "agendaBin"), "&:is([data-conflict], [data-bounds])")).toBe(CONFLICT_RING);
        expect(shadow(slot(schematicSlotRecipe, "item"), "&:is([data-conflict], [data-bounds])")).toBe(CONFLICT_RING);
        expect(shadow(slot(flowchartSlotRecipe, "node"), "&:is([data-conflict], [data-bounds])")).toBe(CONFLICT_RING);
        expect(shadow(slot(snapGridSlotRecipe, "frame"), "[data-conflict] > &")).toBe(CONFLICT_RING);
    });

    test("a mark, a card, a node or a tile whose row holds a number outside its field's bounds wears it in every state the conflict's is drawn in (#1585)", () => {
        const parts = [
            [planSlotRecipe, ["bar", "diamond", "milestoneDot", "exceptionTri", "markIcon", "tile", "cardChip"]], [calendarSlotRecipe, ["event", "card"]],
            [rosterBuilderSlotRecipe, ["assignment", "tile", "card"]], [allocationBuilderSlotRecipe, ["card", "tableRow", "agendaCard", "agendaBin"]],
            [schematicSlotRecipe, ["item"]], [flowchartSlotRecipe, ["node"]],
        ] as const;
        for (const [recipe, names] of parts) {
            for (const name of names) {
                const rules = Object.keys(slot(recipe, name)).filter((key) => key.includes("data-conflict"));
                expect(rules.length, name).toBeGreaterThan(0);
                expect(rules.filter((key) => !key.includes(":is([data-conflict], [data-bounds])")), name).toEqual([]);
            }
        }
    });

    test("over the optimiser's highlight, the conflict's ring is drawn first, on top", () => {
        const landing = slot(optimiseSlotRecipe, "landing");
        expect(shadow(landing, "&[data-optimise-lit] [data-op=add][data-conflict], &[data-optimise-lit] [data-op=chg][data-conflict]")).toMatch(startingWith(CONFLICT_RING));
        expect(shadow(landing, "&[data-optimise-lit] [data-fill=cell][data-op=add][data-conflict], &[data-optimise-lit] [data-fill=cell][data-op=chg][data-conflict]"))
            .toMatch(startingWith(CONFLICT_RING_INSET));
    });

    test("nothing reaches past a part's edge: no layer outside it, no row lifted over its neighbours, no plot let out", () => {
        const recipes = [sheetSlotRecipe, recordSlotRecipe, planSlotRecipe, calendarSlotRecipe, rosterBuilderSlotRecipe, allocationBuilderSlotRecipe, schematicSlotRecipe, flowchartSlotRecipe, snapGridSlotRecipe];
        const keys = (styles: unknown): string[] => styles === null || typeof styles !== "object" ? []
            : Object.entries(styles as Styles).flatMap(([key, value]) => [key, ...keys(value)]);
        const reaching = recipes.flatMap((recipe) => keys(recipe.base)).filter((key) => /\[data-conflict\][^,]*::before|:has\(.*\[data-conflict\]\)/.test(key));
        expect(reaching).toEqual([]);
    });
});
