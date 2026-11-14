/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A box of a fixed height that holds one line of words (#1636): its line is
 * the room inside its edge, so the words start a whole number of pixels under
 * the edge and the two land on the screen's pixels together. The Record's
 * chips, its legend's, its initials, its title's count and its checkbox are
 * each such a box at every density, and so are the other chips and key caps:
 * a tag's chip, the rail's search hint, the bare `kbd`, every control of a
 * toolbar's row that holds words (a chip, a segment, a stepper, the Sheet's
 * tabs), and the Sheet's insert choices, its small tags and its action menu's
 * key caps. No part of their recipes centres a line of `1` in a fixed height
 * again. What the page lays out from them is measured in the browser
 * (`record-cells.spec.ts`, `one-line-words.spec.ts`).
 */

import { describe, expect, test } from "vitest";
import { globalCss } from "./global-css.js";
import { oneLineBox } from "./one-line-box.js";
import { chipRecipe } from "./recipes/chip.js";
import { recordSlotRecipe } from "./slot-recipes/record.js";
import { segSlotRecipe } from "./slot-recipes/seg.js";
import { sheetSlotRecipe } from "./slot-recipes/sheet.js";
import { sheetActionSlotRecipe } from "./slot-recipes/sheetAction.js";
import { sliceFrameSlotRecipe } from "./slot-recipes/sliceFrame.js";
import { stepperSlotRecipe } from "./slot-recipes/stepper.js";
import { tagsInputSlotRecipe } from "./slot-recipes/tagsInput.js";
import { IN_TOOLBAR_ROW, TOOLBAR_CONTROL_HEIGHT, toolbarControlBox } from "./toolbar-row.js";

type Styles = Readonly<Record<string, unknown>>;

/** Whether a value is a style object: a slot's styles, or a rule nested in them. */
const isStyles = (value: unknown): value is Styles => value !== null && typeof value === "object" && !Array.isArray(value);

/** The Record's slots at rest. */
const base = recordSlotRecipe.base as Readonly<Record<string, Styles>>;

/** What a density changes of each slot. */
const densities = (recordSlotRecipe.variants as { readonly density: Readonly<Record<string, Readonly<Record<string, Styles>>>> }).density;

/** A slot's height and its line's at a density: the density's own where it sets them, else the slot's at rest. */
const box = (slot: string, density: string): readonly [unknown, unknown] => {
    const styles = { ...base[slot], ...densities[density]![slot] };
    return [styles.height, styles.lineHeight];
};

describe("a one-line box", () => {
    test("its line is the room inside its edge: the height less the edge at the top and at the bottom", () => {
        expect(oneLineBox(22)).toEqual({ height: "22px", lineHeight: "20px" });
        expect(oneLineBox(15)).toEqual({ height: "15px", lineHeight: "13px" });
        expect(oneLineBox(44, 1.5)).toEqual({ height: "44px", lineHeight: "41px" });
    });

    test("a box with no edge has a line its own height", () => {
        expect(oneLineBox(16, 0)).toEqual({ height: "16px", lineHeight: "16px" });
    });

    test("the Record's chip is one at every density: 22 tall with a 20 line, 15 with a 13 line at compact and condensed", () => {
        expect(box("chip", "comfortable")).toEqual(["22px", "20px"]);
        expect(box("chip", "compact")).toEqual(["15px", "13px"]);
        expect(box("chip", "condensed")).toEqual(["15px", "13px"]);
    });

    test("the Record's initials are one at every density: 24 tall with a 22 line, 20 with an 18 line at compact and condensed", () => {
        expect(box("avatar", "comfortable")).toEqual(["24px", "22px"]);
        expect(box("avatar", "compact")).toEqual(["20px", "18px"]);
        expect(box("avatar", "condensed")).toEqual(["20px", "18px"]);
    });

    test("the Record's legend chip, its title's count and its checkbox are each one", () => {
        for (const density of Object.keys(densities)) {
            expect(box("legendChip", density), density).toEqual(["15px", "13px"]);
            expect(box("titleCount", density), density).toEqual(["16px", "16px"]);
            expect(box("box", density), density).toEqual(["14px", "12px"]);
            expect(box("tick", density), density).toEqual(["14px", "12px"]);
        }
    });

    test("a density that changes a one-line box's height sets its line with it", () => {
        const stale = Object.entries(densities).flatMap(([density, slots]) => Object.entries(slots)
            .filter(([slot, styles]) => "height" in styles && "lineHeight" in base[slot]! && !("lineHeight" in styles))
            .map(([slot]) => `${slot} at ${density}`));
        expect(stale).toEqual([]);
    });

    test("no part of the Record's recipe centres a line of 1 in a fixed height: its words would start at a fraction of a pixel under its edge", () => {
        const found: string[] = [];
        const walk = (where: string, styles: Styles): void => {
            const line = styles.lineHeight;
            if (typeof styles.height === "string" && /^[\d.]+px$/.test(styles.height) && (line === "1" || line === 1)) found.push(where);
            for (const [key, value] of Object.entries(styles)) if (isStyles(value)) walk(`${where} › ${key}`, value);
        };
        for (const [slot, styles] of Object.entries(base)) walk(slot, styles);
        for (const [density, slots] of Object.entries(densities)) for (const [slot, styles] of Object.entries(slots)) walk(`${slot} at ${density}`, { ...base[slot], ...styles });
        // An icon's own square (`fontAwesomeSize`) is as tall as its glyph: a line of 1 is the square.
        expect(found.filter((where) => !/svg$/.test(where))).toEqual([]);
    });
});

/** A part's styles, or a rule nested in them, by the keys down to it. */
const at = (styles: unknown, ...keys: string[]): Styles => {
    let found = styles;
    for (const key of keys) found = (found as Readonly<Record<string, unknown>>)[key];
    if (!isStyles(found)) throw new Error(`no styles at ${keys.join(" › ")}`);
    return found;
};

/** A part's height and its line's. */
const sized = (styles: Styles): readonly [unknown, unknown] => [styles.height, styles.lineHeight];

describe("a control of a toolbar's row that holds words", () => {
    test("is a one-line box as tall as every control there: its line 26 inside an edge, 28 with none", () => {
        expect(TOOLBAR_CONTROL_HEIGHT).toBe("28px");
        expect(toolbarControlBox()).toEqual({ height: "28px", lineHeight: "26px" });
        expect(toolbarControlBox(0)).toEqual({ height: "28px", lineHeight: "28px" });
    });

    test("a chip is one in the row, in its 1px edge", () => {
        expect(sized(at(chipRecipe.base, IN_TOOLBAR_ROW))).toEqual(["28px", "26px"]);
    });

    test("a segment fills its strip's 26 of room in the row, its label on a line as tall", () => {
        expect(at(segSlotRecipe.base, "root", IN_TOOLBAR_ROW).height).toBe("28px");
        expect(at(segSlotRecipe.base, "item", IN_TOOLBAR_ROW)).toEqual({ paddingBlock: "0", lineHeight: "26px" });
    });

    test("a stepper is one at both sizes, in its 1px edge", () => {
        expect(sized(at(stepperSlotRecipe.variants, "size", "sm", "root"))).toEqual(["28px", "26px"]);
        expect(sized(at(stepperSlotRecipe.variants, "size", "md", "root"))).toEqual(["28px", "26px"]);
    });

    test("the Sheet's tabs are each one: a tab, `+n` and the folded strip with no edge, `+ TAB` in its 1px edge", () => {
        const sheet = sheetSlotRecipe.base;
        expect(sized(at(sheet, "tab"))).toEqual(["28px", "28px"]);
        expect(sized(at(sheet, "tabMore"))).toEqual(["28px", "28px"]);
        expect(sized(at(sheet, "tabMenu"))).toEqual(["28px", "28px"]);
        expect(sized(at(sheet, "tabAdd"))).toEqual(["28px", "26px"]);
    });
});

describe("a chip or a key cap", () => {
    test("a tag's chip is a one-line box: 22 tall with a 20 line, the typed box beside it as tall", () => {
        expect(sized(at(tagsInputSlotRecipe.base, "itemPreview"))).toEqual(["22px", "20px"]);
        expect(at(tagsInputSlotRecipe.base, "input").height).toBe("22px");
    });

    test("the rail's search hint is one: 16 tall with a 14 line", () => {
        expect(sized(at(sliceFrameSlotRecipe.base, "searchKbd"))).toEqual(["16px", "14px"]);
    });

    test("a bare kbd is one: 20 tall with an 18 line", () => {
        expect(sized(at(globalCss, "kbd"))).toEqual(["20px", "18px"]);
    });

    test("the Sheet action menu's key cap is one: 20 tall with an 18 line", () => {
        expect(sized(at(sheetActionSlotRecipe.base, "menuKbd"))).toEqual(["20px", "18px"]);
    });

    test("the Sheet's insert choice, its checkbox, its toolbar badge, its lock tags and a phone's band status are each one", () => {
        const sheet = sheetSlotRecipe.base;
        expect(sized(at(sheet, "insertChoice"))).toEqual(["22px", "20px"]);
        expect(sized(at(sheet, "checkbox"))).toEqual(["14px", "12px"]);
        expect(sized(at(sheet, "toolbarBadge"))).toEqual(["20px", "20px"]);
        expect(sized(at(sheet, "lockTag"))).toEqual(["20px", "20px"]);
        expect(sized(at(sheet, "lockWarn"))).toEqual(["20px", "20px"]);
        expect(sized(at(sheet, "halfLabel"))).toEqual(["20px", "20px"]);
        expect(sized(at(sheet, "groupCell", "[data-sheet-card][data-phone] &"))).toEqual(["22px", "22px"]);
    });

    test("none of their recipes centres a line of 1 in a fixed height: its words would start at a fraction of a pixel under its edge", () => {
        const found: string[] = [];
        const walk = (where: string, styles: Styles): void => {
            const line = styles.lineHeight;
            // An icon's own square (`fontAwesomeSize`) is as tall as its glyph: a line of 1 is the square.
            const square = styles.height === styles.fontSize;
            if (typeof styles.height === "string" && /^[\d.]+px$/.test(styles.height) && (line === "1" || line === 1) && !square) found.push(where);
            for (const [key, value] of Object.entries(styles)) if (isStyles(value)) walk(`${where} › ${key}`, value);
        };
        const recipes = {
            chip: chipRecipe, seg: segSlotRecipe, stepper: stepperSlotRecipe, sheet: sheetSlotRecipe, sheetAction: sheetActionSlotRecipe,
            sliceFrame: sliceFrameSlotRecipe, tagsInput: tagsInputSlotRecipe, kbd: { base: at(globalCss, "kbd") },
        };
        for (const [name, recipe] of Object.entries(recipes)) {
            walk(`${name} at rest`, at(recipe, "base"));
            if ("variants" in recipe) walk(`${name}'s variants`, at(recipe, "variants"));
        }
        expect(found).toEqual([]);
    });
});
