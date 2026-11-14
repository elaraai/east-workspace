/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A box of a fixed height that holds one line of words (#1636): its line is
 * the room inside its edge, so the words start a whole number of pixels under
 * the edge and the two land on the screen's pixels together. The Record's
 * chips, its legend's, its initials, its title's count and its checkbox are
 * each such a box at every density, and no part of the Record's recipe centres
 * a line of `1` in a fixed height again. What the page lays out from it is
 * measured in the browser (`record-cells.spec.ts`).
 */

import { describe, expect, test } from "vitest";
import { oneLineBox } from "./one-line-box.js";
import { recordSlotRecipe } from "./slot-recipes/record.js";

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
