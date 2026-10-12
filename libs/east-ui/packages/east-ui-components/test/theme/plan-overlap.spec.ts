/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The overlap ring (#1198, `Plan Builder Spec.md` PB51). An event in an
 * overlap pair wears one 1.5px warn ring on every mark it can draw as: a bar,
 * a tile, a card chip, a milestone and a mark's icon. A mark with a ring of its
 * own keeps it — a confirmed mark's inset brand ring inside the warn ring, a
 * danger tile's ring, the worse, in its place — and an exception's triangle,
 * the warn mark already, draws none. The showcase measures the bar's ring in
 * both themes (`plan-frame.spec.ts`); this holds every mark's rules.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { system } from "../../src/theme/index.js";
import { PLAN_OVERLAP_RING } from "../../src/theme/slot-recipes/plan/focus.js";

type Rules = Readonly<Record<string, unknown>>;

/** The Plan recipe's slots, as the theme holds them: each slot's rules, by selector. */
const PLAN: Readonly<Record<string, Rules>> = Object.fromEntries(
    Object.entries(system._config.theme?.slotRecipes?.["plan"]?.base ?? {}).map(([slot, rules]) => [slot, { ...rules }]));

/** A slot's rule for a selector — its box shadow. */
const shadow = (slot: string, selector: string): unknown => (PLAN[slot]?.[selector] as Rules | undefined)?.["boxShadow"];

/** Whether `later` is declared after `earlier` in a slot's rules — of two selectors as specific, the later wins. */
const after = (slot: string, earlier: string, later: string): boolean => {
    const keys = Object.keys(PLAN[slot]!);
    return keys.indexOf(earlier) >= 0 && keys.indexOf(earlier) < keys.indexOf(later);
};

test("every mark an event draws wears the warn ring in an overlap pair, and an exception's triangle none", () => {
    const missing = ["bar", "tile", "cardChip", "milestoneDot", "markIcon"]
        .filter((slot) => shadow(slot, "&[data-overlap]") !== PLAN_OVERLAP_RING);
    assert.deepEqual(missing, []);
    assert.equal(PLAN["exceptionTri"]?.["&[data-overlap]"], undefined);
});

test("a confirmed mark in an overlap pair keeps its own inset ring inside the warn ring", () => {
    const wrong = ["bar", "tile", "cardChip"].filter((slot) => {
        const own = shadow(slot, "&[data-state='appr']");
        return typeof own !== "string" || !own.startsWith("inset ")
            || shadow(slot, "&[data-overlap][data-state='appr']") !== `${own}, ${PLAN_OVERLAP_RING}`;
    });
    assert.deepEqual(wrong, []);
});

test("a danger tile in an overlap pair keeps its danger ring, a confirmed one too", () => {
    assert.equal(shadow("tile", "&[data-overlap][data-tone='danger']"), shadow("tile", "&[data-tone='danger']"));
    assert.ok(after("tile", "&[data-overlap][data-state='appr']", "&[data-overlap][data-tone='danger']"));
});
