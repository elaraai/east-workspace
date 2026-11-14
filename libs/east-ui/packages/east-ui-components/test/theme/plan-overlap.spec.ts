/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The overlap ring (#1198, `Plan Builder Spec.md` PB51). An event in an
 * overlap pair wears one 1.5px warn ring on every mark it can draw as: a bar,
 * a tile, a card chip, a milestone and a mark's icon. A mark with a ring of its
 * own keeps it — a confirmed mark's inset brand ring inside the warn ring, a
 * danger status's ring, the worse, in its place (#1541: on a bar and a chip as
 * on a tile), an open item's own ring inside the warn — and an exception's
 * triangle, the warn mark already, draws none. The showcase measures the
 * bar's ring in both themes (`plan-frame.spec.ts`) and every status's with it
 * (`plan-status.spec.ts`); this holds every mark's rules.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { system } from "../../src/theme/index.js";
import { PLAN_OVERLAP_RING } from "../../src/theme/slot-recipes/plan/focus.js";
import { PLAN_STATUS_OPEN_RING, PLAN_STATUS_RING } from "../../src/theme/slot-recipes/plan/status.js";

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

test("a danger status in an overlap pair keeps its own ring on a bar, a tile and a chip, a confirmed one too, and an open item its ring inside the warn (#1541)", () => {
    for (const slot of ["bar", "tile", "cardChip"]) {
        // A status's ring is one rule, in the colour its tone sets; the overlap's takes its place, written after it.
        assert.equal(shadow(slot, "&[data-tone]"), PLAN_STATUS_RING, slot);
        assert.ok(after(slot, "&[data-tone]", "&[data-overlap]"), slot);
        // A danger's, the worse, stands in the overlap's place: its rule after the confirmed overlap's, and as strong.
        assert.equal(shadow(slot, "&[data-overlap][data-tone='danger']"), PLAN_STATUS_RING, slot);
        assert.ok(after(slot, "&[data-overlap][data-state='appr']", "&[data-overlap][data-tone='danger']"), slot);
        // An open item keeps its ring inside the warn.
        assert.equal(shadow(slot, "&[data-overlap][data-ring]:where([data-tone]:not([data-draft]))"), `${PLAN_STATUS_OPEN_RING}, ${PLAN_OVERLAP_RING}`, slot);
    }
});
