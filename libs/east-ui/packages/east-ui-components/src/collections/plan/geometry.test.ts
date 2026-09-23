/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's ONE geometry table (#817): the model computes row heights from
 * it, and the recipe reads the same numbers as the CSS variables the canvas
 * writes — so a height can no longer be one number in the model and another
 * in the recipe.
 */

import { describe, test, expect } from "vitest";
import { none, variant } from "@elaraai/east";
import { planSlotRecipe } from "../../theme/slot-recipes/plan.js";
import { PLAN_GEOMETRY, planGeometry, planGeometryStyle, planGeometryVar, type PlanGeometry } from "./geometry.js";
import { rowHeight, type PlanRowValue } from "./model.js";

/** Every `var(--plan-…)` a style object reads, however deep. */
function varsIn(style: unknown, out = new Set<string>()): Set<string> {
    if (typeof style === "string") {
        for (const m of style.matchAll(/var\((--plan-[a-z-]+)\)/g)) out.add(m[1]!);
    } else if (style !== null && typeof style === "object") {
        for (const v of Object.values(style)) varsIn(v, out);
    }
    return out;
}

const v = (key: keyof PlanGeometry) => `var(${planGeometryVar(key)})`;
const slot = (name: string) => (planSlotRecipe.base as Record<string, Record<string, unknown>>)[name]!;

describe("the Plan geometry table (#817)", () => {
    test("the canvas writes every entry as its variable, in px", () => {
        const style = planGeometryStyle(PLAN_GEOMETRY.default);
        expect(Object.keys(style)).toHaveLength(Object.keys(PLAN_GEOMETRY.default).length);
        expect(style["--plan-row-h"]).toBe("32px");
        expect(style["--plan-strip-mark-h"]).toBe("7px");
        expect(style["--plan-heat-inset-h"]).toBe("3px");
        expect(planGeometryStyle(PLAN_GEOMETRY.dense)["--plan-row-h"]).toBe("24px");
    });

    test("every geometry variable the recipe reads is one the canvas writes", () => {
        const written = new Set(Object.keys(planGeometryStyle(PLAN_GEOMETRY.default)));
        const read = varsIn(planSlotRecipe.base);
        expect(read.size).toBeGreaterThan(15);
        expect([...read].filter((name) => !written.has(name))).toEqual([]);
    });

    test("each height the model also computes is drawn from its variable, never a pixel literal", () => {
        // The rule under a row sits inside its height — its plot cell, where
        // the link ribbons centre on its bars, is the row less it (#818).
        expect(slot("row").borderBottomWidth).toBe(v("rule"));
        expect(slot("rail").height).toBe(v("rail"));
        expect(slot("focusGap").height).toBe(v("gap"));
        expect(slot("groupBand").minHeight).toBe(v("group"));
        expect(slot("toneCell").height).toBe(v("stripMark"));
        expect((slot("bar")["&[data-ctx]"] as Record<string, unknown>).height).toBe(v("stripMark"));
        expect((slot("tile")["&[data-ctx]"] as Record<string, unknown>).height).toBe(v("stripMark"));
        expect((slot("cardChip")["&[data-ctx]"] as Record<string, unknown>).height).toBe(v("stripMark"));
        expect((slot("heatCell")["&[data-ctx]"] as Record<string, unknown>).height).toBe(v("stripMark"));
        expect(slot("rollBand").height).toBe(v("rollBar"));
        expect(slot("heatCell").top).toBe(v("heatInset"));
        expect(slot("heatCell").bottom).toBe(v("heatInset"));
        expect(slot("heatCell").minHeight).toBe(v("heatCellMin"));
        expect(slot("tile").height).toBe(v("tile"));
        expect(slot("cardChip").height).toBe(v("chip"));
        expect(slot("weightBar").height).toBe(v("weight"));
        expect(slot("segmentTrack").height).toBe(v("segment"));
        expect(slot("toolbar").minHeight).toBe(v("toolbar"));
        expect(slot("brushRow").height).toBe(v("brush"));
        expect(slot("ruler").height).toBe(v("ruler"));
        expect(slot("narrowRuler").height).toBe(v("ruler"));
        expect(slot("footer").minHeight).toBe(v("footer"));
        // The unloaded run's rule reads as rows — one rule per row height.
        expect(String(slot("windowBand").backgroundImage)).toContain(v("row"));
    });

    test("density is geometry — the recipe carries no density variant", () => {
        expect(planSlotRecipe.variants).toBeUndefined();
        expect(planSlotRecipe.defaultVariants).toBeUndefined();
    });

    test("dense tightens the shared row and the bars in it; every other height holds", () => {
        const differ = (Object.keys(PLAN_GEOMETRY.default) as (keyof PlanGeometry)[])
            .filter((key) => PLAN_GEOMETRY.default[key] !== PLAN_GEOMETRY.dense[key]);
        expect(differ.sort()).toEqual(["bar", "row"]);
        expect(planGeometry(true)).toBe(PLAN_GEOMETRY.dense);
        expect(planGeometry(false)).toBe(PLAN_GEOMETRY.default);
    });

    test("rowHeight reads the density's table", () => {
        const row = {
            key: "r", parent: none,
            gutter: { label: "R", id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
            kind: variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none }),
            pinned: none, height: none, status: none, approval: none, expand: none,
        } as unknown as PlanRowValue;
        const at = (dense: boolean) => rowHeight({ row, depth: 0, collapsed: false }, dense, new Set());
        expect(at(false)).toBe(PLAN_GEOMETRY.default.row);
        expect(at(true)).toBe(PLAN_GEOMETRY.dense.row);
    });
});
