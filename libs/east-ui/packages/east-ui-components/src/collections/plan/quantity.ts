/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Quantities as words (#824) — a run's or a link's `quantity` is ONE value
 * with its unit and how it prints, so the caption a bar or a ribbon shows and
 * the total a rollup band sums can never disagree.
 *
 * A caption is the quantity's `text` when the author wrote one; otherwise its
 * value through its `format` (the canvas's plain number without one), in the
 * canvas's locale, then its unit. Totals sum unit by unit — tonnes never add
 * to hours — each unit printing through the format its first member declares.
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import type { TickFormatOpt } from "../../format/index.js";
import type { PlanWords } from "./words.js";

/** A decoded quantity (derived from the East type, never mirrored). */
export type PlanQuantityValue = ValueTypeOf<typeof Plan.Types.Quantity>;

/**
 * A quantity's caption — `96 t`.
 *
 * @param q - The quantity
 * @param w - The canvas's words
 * @returns Its `text`, else its value through its format, then its unit
 */
export function quantityText(q: PlanQuantityValue, w: PlanWords): string {
    if (q.text.type === "some") return q.text.value;
    return w.m.quantity({ value: w.value(q.value, getSomeorUndefined(q.format)), unit: getSomeorUndefined(q.unit) });
}

/** One unit's total. */
export interface PlanQuantityTotal {
    /** The unit — `undefined` for quantities that declare none. */
    unit: string | undefined;
    /** The sum of the unit's values. */
    value: number;
    /** How the total prints — the format the unit's first member declares. */
    format: TickFormatOpt;
}

/**
 * Sum quantities unit by unit.
 *
 * @param quantities - The quantities
 * @returns One total per unit, in the order the units first appear
 */
export function totalsByUnit(quantities: readonly PlanQuantityValue[]): PlanQuantityTotal[] {
    const out: PlanQuantityTotal[] = [];
    const byUnit = new Map<string | undefined, PlanQuantityTotal>();
    for (const q of quantities) {
        const unit = getSomeorUndefined(q.unit);
        const total = byUnit.get(unit);
        if (total !== undefined) {
            total.value += q.value;
        } else {
            const first: PlanQuantityTotal = { unit, value: q.value, format: getSomeorUndefined(q.format) };
            byUnit.set(unit, first);
            out.push(first);
        }
    }
    return out;
}

/**
 * Totals as one caption — `208 t · 12 h`.
 *
 * @param totals - The totals ({@link totalsByUnit})
 * @param w - The canvas's words
 * @returns The caption
 */
export function totalsText(totals: readonly PlanQuantityTotal[], w: PlanWords): string {
    return w.m.quantities({
        parts: totals.map((t) => w.m.quantity({ value: w.value(t.value, t.format), unit: t.unit })),
    });
}
