/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A pie's slices as it draws them (#1671, CHT-7): its slices of a positive
 * value, largest first; the first `top` of them; then one Other slice for the
 * rest — and for whatever the pie's total holds past them — each with its
 * share of the total and its colour, by the chart rules: the series order by
 * rank, `--brand-d` first, and Other in `--ink-5`.
 *
 * It draws nothing: the renderer (`index.tsx`) draws what this gives.
 *
 * @packageDocumentation
 */

import { FloatType, compareFor, type ValueTypeOf } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";

/** A pie, decoded. */
export type PieValue = ValueTypeOf<typeof Chart.Spec.Types.Pie>;

/** How many slices a pie draws before Other, when it names no number. */
export const PIE_TOP = 4;

/** The series colours, in the chart rules' order: a slice takes the one of its rank. */
export const PIE_SERIES_COLORS: readonly string[] = ["series.1", "series.2", "series.3", "series.4", "series.5"];

/** Other's colour: `--ink-5`. */
export const PIE_OTHER_COLOR = "series.other";

/** One slice as it draws. */
export interface PieSlice {
    /** What it stands for: its key, or Other's label. */
    readonly key: string;
    /** Its value. */
    readonly value: number;
    /** Its share of the total, from 0 to 1. */
    readonly share: number;
    /** Its colour: a theme token, or the slice's own. */
    readonly color: string;
    /** Whether it is Other: every slice past the first ones, and the total's rest. */
    readonly other: boolean;
}

/** A pie as it draws: its slices, in their order from twelve o'clock, and the total they are shares of. */
export interface PieShown {
    /** The slices, largest first, Other last. */
    readonly slices: readonly PieSlice[];
    /** The total: the pie's own when it is more than its slices' sum, else that sum. */
    readonly total: number;
}

const compareFloat = compareFor(FloatType);

/**
 * A pie's slices as it draws them.
 *
 * @param pie - The pie
 * @param otherLabel - Other's label when the pie names none
 * @returns The slices largest first, the first `top` then Other, each with its share and colour; and the total
 *
 * @remarks
 * - A slice of no positive value is not drawn, and counts towards nothing.
 * - Slices of one value keep the order they were given in.
 * - The total is the pie's `total` when it is more than the slices' sum —
 *   what is past their sum is Other's — and the sum otherwise.
 * - Other is drawn only when it holds something.
 */
export function pieSlicesOf(pie: PieValue, otherLabel: string): PieShown {
    const positive = pie.data.filter((slice) => compareFloat(slice.value, 0) > 0);
    // Largest first: `sort` is stable, so slices of one value keep their order.
    const ranked = [...positive].sort((a, b) => compareFloat(b.value, a.value));
    const top = pie.top.type === "some" ? Math.max(0, Number(pie.top.value)) : PIE_TOP;
    const shown = ranked.slice(0, top);
    const sum = positive.reduce((total, slice) => total + slice.value, 0);
    const total = pie.total.type === "some" && compareFloat(pie.total.value, sum) > 0 ? pie.total.value : sum;
    const shareOf = (value: number) => (total > 0 ? value / total : 0);
    const slices: PieSlice[] = shown.map((slice, rank) => ({
        key: slice.key,
        value: slice.value,
        share: shareOf(slice.value),
        color: slice.color.type === "some" ? slice.color.value : PIE_SERIES_COLORS[rank % PIE_SERIES_COLORS.length]!,
        other: false,
    }));
    // What the drawn slices leave of the total: Other, when it holds anything a sum's rounding did not make.
    const rest = total - shown.reduce((held, slice) => held + slice.value, 0);
    if (rest > total * 1e-9) {
        slices.push({ key: pie.other.type === "some" ? pie.other.value : otherLabel, value: rest, share: shareOf(rest), color: PIE_OTHER_COLOR, other: true });
    }
    return { slices, total };
}
