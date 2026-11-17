/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 */

/**
 * Where a links focus draws a row the canvas does not hold (#823, #1680's
 * review): a row of a paged source's evicted window at its window's offset in
 * its block's band — or, the band folded with the focus's other rows, at the
 * band they fold into.
 */

import { describe, test, expect } from "vitest";
import { none, variant } from "@elaraai/east";
import { placedBeyond, ribbonBody } from "./ribbon-layout.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { toCanvasRows, type PlanBodyItem, type PlanWireRow } from "../model.js";
import { rowId } from "../plan.test-utils.js";

const G = PLAN_GEOMETRY.default;

/** A span row at a test key. */
const rowItem = (key: string): PlanBodyItem => ({
    kind: "row",
    row: {
        row: toCanvasRows([{
            id: rowId(key), parent: none,
            gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
            kind: variant("span", { runs: [], decisions: [], ports: [], rollup: none }),
            collapsed: false, pinned: false, height: none, status: none, expand: none,
        } as unknown as PlanWireRow])[0]!,
        depth: 1, collapsed: false,
    },
});
const focusBand = (role: "upstream" | "focused" | "downstream" | "others", open: boolean): PlanBodyItem =>
    ({ kind: "focus", band: { role, count: 1, open } });
const headBand: PlanBodyItem = { kind: "band", band: { block: 0, at: "head", from: 0, to: 199, px: 640 } };

describe("a row the canvas folded with a links focus's other rows (#1680's review)", () => {
    test("the others' band, folded, is where such a row is drawn: a bar centred in its plot cell — the band less its rule", () => {
        const items = [focusBand("upstream", true), focusBand("focused", true), rowItem("f"), focusBand("downstream", true), focusBand("others", false)];
        const body = ribbonBody(items, [26, 26, 32, 26, 26], G);
        // Under 26 + 26 + 32 + 26: the band's 25px plot cell over its rule, a 20px bar centred in it.
        expect(body.folded).toBe(110 + (26 - G.rule - G.bar) / 2);
        // Opened, the body holds its rows, the paged runs among them: nothing is folded.
        const open = ribbonBody([...items.slice(0, 4), focusBand("others", true), headBand], [26, 26, 32, 26, 26, 640], G);
        expect(open.folded).toBeUndefined();
        // And no links focus folds nothing.
        expect(ribbonBody([rowItem("f")], [32], G).folded).toBeUndefined();
    });

    test("a row of an evicted window sits at its window's offset in its block's band; the band folded, at the others' band; neither, nowhere", () => {
        const place = { block: 0, at: "head", px: 20 * 32 };
        // The others' band open: its rows follow it, the head band first.
        const open = ribbonBody([focusBand("focused", true), rowItem("f"), focusBand("others", true), headBand], [26, 32, 26, 640], G);
        expect(placedBeyond(place, open)).toEqual({ y: 26 + 32 + 26 + 20 * 32 });
        // Folded: the band is not in the body — the row is at the others' band.
        const folded = ribbonBody([focusBand("focused", true), rowItem("f"), focusBand("others", false)], [26, 32, 26], G);
        expect(placedBeyond(place, folded)).toEqual({ y: folded.folded });
        // A canvas with neither — no links focus folding, no band of that block's end — draws it nowhere.
        expect(placedBeyond(place, ribbonBody([rowItem("f")], [32], G))).toBeUndefined();
    });
});
