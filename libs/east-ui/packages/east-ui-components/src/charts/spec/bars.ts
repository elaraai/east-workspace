/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How wide a chart's bars are (the chart rules, `guidelines/charts.md`): a
 * column is at most 18px wide and a horizontal bar at most 12px thick,
 * whatever room its band has; the bars at one x sit side by side, centred on
 * it. The renderer (`index.tsx`) draws by it and a click is read against it
 * (`hit.ts`), so the two agree.
 *
 * @packageDocumentation
 */

/** The widest a column is drawn, in px. */
export const COLUMN_MAX = 18;

/** The thickest a horizontal bar is drawn, in px. */
export const BAR_MAX = 12;

/** The hairline between bars side by side at one x, in px. */
const GROUP_GAP = 1.5;

/** The bars at one x, along the domain axis. */
export interface BarSlots {
    /** Where the first bar starts, from the x's centre. */
    readonly start: number;
    /** One bar's slot: the next bar starts a slot on. */
    readonly slot: number;
    /** A bar's size within its slot. */
    readonly size: number;
}

/**
 * The bars at one x: `count` slots side by side, centred on the x's centre.
 *
 * @param bandWidth - The room the x has along the domain axis
 * @param count - How many bars sit side by side there: one for a stack
 * @param horizontal - Whether the bars run across: a horizontal frame
 * @returns Where the first bar starts from the centre, a slot's pitch and a bar's size
 */
export function barSlots(bandWidth: number, count: number, horizontal: boolean): BarSlots {
    const n = Math.max(1, count);
    const gap = n > 1 ? GROUP_GAP : 0;
    const slot = Math.min(bandWidth / n, (horizontal ? BAR_MAX : COLUMN_MAX) + gap);
    return { start: -(slot * n) / 2, slot, size: Math.max(1, slot - gap) };
}
