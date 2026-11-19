/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A pie's slices as it draws them (#1671, CHT-7): its slices of a positive
 * value, largest first; the first `top` of them; then one Other slice for the
 * rest — and for whatever the pie's total holds past them — each with its
 * share of the total and its colour, by the chart rules: the series order by
 * rank, `--brand-d` first, and Other in `--ink-5`. And a donut's ring and
 * what of its centre fits its hole at its size (#1692).
 *
 * It draws nothing: the renderer (`pie-frame.tsx`) draws what this gives.
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

/** A donut's ring as its mock draws it (CHT-7): 26 px across its 176. */
export const DONUT_RING = 26;

/** The share of a donut's width its ring takes: the mock's. */
const DONUT_RING_SHARE = DONUT_RING / 176;

/**
 * A donut's ring (#1692): the mock's 26 px, and in a donut smaller than the
 * mock's its share of that donut's width, so a small donut keeps a hole its
 * total can stand in.
 *
 * @param diameter - The donut's width, in px
 * @returns Its ring's width, in whole px
 */
export function donutRing(diameter: number): number {
    return Math.min(DONUT_RING, Math.round(diameter * DONUT_RING_SHARE));
}

/** The sizes a donut's total steps down through, in px, as a KPI's number does: 26, 20, then 16. */
export type DonutTotalSize = 26 | 20 | 16;

/** What of its centre a donut draws: its total at a size, and whether its caption stands under it. */
export interface DonutCentre {
    readonly size: DonutTotalSize;
    readonly caption: boolean;
}

/** A mono face's advance, of its size: what a line of a donut's centre is measured by, as a KPI's number is. */
const MONO_ADVANCE = 0.615;

/** The caption's size, in px: mono 10. */
const CAPTION_PX = 10;

/** Between the total's line and the caption's, in px. */
const CAPTION_GAP = 5;

/** What a centre's lines keep clear of its ring, in px. */
const RING_CLEAR = 2;

/** A total's centre over its caption, about the hole's: 6 px over it. Alone, a total is on it. */
export const DONUT_TOTAL_Y = -6;

/**
 * Where a caption stands under a total of a size, about the hole's centre: 5 px under the total's line.
 *
 * @param size - The total's size
 * @returns The caption's centre, in px down from the hole's
 */
export function donutCaptionY(size: DonutTotalSize): number {
    return DONUT_TOTAL_Y + size / 2 + CAPTION_GAP + CAPTION_PX / 2;
}

/**
 * What of a donut's centre fits in its hole (#1692): its total at 26 px over
 * its caption, then at 20 px over it, then at 20 px alone, then at 16 px alone
 * — the largest whose every line lies inside the hole, clear of the ring, at
 * each corner of its line's box. A donut too small for even its smallest total
 * leaves its centre empty; its legend's note, where it has one, says the total.
 *
 * @param hole - The hole's radius, in px
 * @param total - The total, as it prints
 * @param caption - Its caption, where it has one
 * @returns What of its centre it draws; `undefined` for nothing
 */
export function donutCentre(hole: number, total: string, caption: string | undefined): DonutCentre | undefined {
    const room = hole - RING_CLEAR;
    // A line of glyphs centred across, its em box about a height: inside the hole at its corners.
    const inside = (chars: number, px: number, y: number) => {
        const half = (chars * MONO_ADVANCE * px) / 2;
        const far = Math.abs(y) + px / 2;
        return room > 0 && half * half + far * far <= room * room;
    };
    const steps: readonly DonutCentre[] = caption === undefined
        ? [{ size: 26, caption: false }, { size: 20, caption: false }, { size: 16, caption: false }]
        : [{ size: 26, caption: true }, { size: 20, caption: true }, { size: 20, caption: false }, { size: 16, caption: false }];
    return steps.find((step) => (step.caption
        ? inside(total.length, step.size, DONUT_TOTAL_Y) && inside((caption ?? "").length, CAPTION_PX, donutCaptionY(step.size))
        : inside(total.length, step.size, 0)));
}
