/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The details' words and axes (#1510, `Flowchart Records Spec.md` R28, R29,
 * R36, R41) — pure: what a card, a label, the legend and the inspector print of
 * a read, in the app's locale, and the ticks an axis draws across its width.
 *
 * - **Durations** (R41): from the read's unit — `0` alone; under an hour in
 *   minutes, under a day in hours, whole weeks in weeks, else days: `15m`,
 *   `4h`, `2d`, `1w` — the number in the app's locale.
 * - **A bin** by its edges — `4h – 8h`; the last, open — `1w or more`.
 * - **A histogram's caption** (R36): where half and nine in ten of its counts
 *   fall — the first bin whose count so far reaches each, within its end, or,
 *   reaching the open last bin, over its edge.
 * - **A share** (R29): a whole percent; above nothing but under one percent,
 *   `<1%`.
 * - **The axis** (R28): the first edge, then the app's ticks — each printed
 *   from the unit, the last edge's ending in +, its bin open; or the app's own
 *   words, as given — or, without any, round durations it has room for. Each
 *   sits where `axisAt` puts it, a pixel in from there but the first; one that
 *   would pass the axis's end ends there, drawn from the end so its words
 *   end there whatever they measure; one too close to the tick before
 *   it, or to the last, is left out — never the first, and the last only where
 *   it meets the first. The visual spec's `ticksFor`.
 *
 * @packageDocumentation
 */

import { FloatType, SortedSet, compareFor, equalFor, lessFor } from "@elaraai/east";
import { axisAt, type FlowchartBins } from "./details.js";
import type { FlowchartDurationStep, FlowchartMarkWord, FlowchartWords } from "./messages.js";

const compareFloat = compareFor(FloatType);
const sameFloat = equalFor(FloatType);
const lessFloat = lessFor(FloatType);

/** A histogram's durations' unit, as its read gives it. */
export type FlowchartDurationUnit = "minutes" | "hours" | "days";

/** Each unit, in minutes. */
const IN_MINUTES: { readonly [U in FlowchartDurationUnit]: number } = { minutes: 1, hours: 60, days: 1440 };
/** An hour, a day and a week, in minutes. */
const HOUR = 60;
const DAY = 1440;
const WEEK = 10080;

/** A duration in the step it prints in, and its number there. */
export interface FlowchartDuration {
    /** Its step: `zero` alone, else minutes, hours, days or whole weeks. */
    readonly step: FlowchartDurationStep;
    /** Its number in that step. */
    readonly n: number;
}

/**
 * The step a duration prints in (R41): `0` alone; under an hour, minutes;
 * under a day, hours; whole weeks, weeks; else days.
 *
 * @param value - The duration, in its unit
 * @param unit - The read's unit
 * @returns Its step, and its number there
 */
export function durationOf(value: number, unit: FlowchartDurationUnit): FlowchartDuration {
    const minutes = value * IN_MINUTES[unit];
    if (isZero(minutes)) return { step: "zero", n: 0 };
    const size = Math.abs(minutes);
    if (lessFloat(size, HOUR)) return { step: "minutes", n: minutes };
    if (lessFloat(size, DAY)) return { step: "hours", n: minutes / HOUR };
    if (isZero(minutes % WEEK)) return { step: "weeks", n: minutes / WEEK };
    return { step: "days", n: minutes / DAY };
}

/** Nothing, either side of it. */
function isZero(n: number): boolean {
    return sameFloat(n, 0) || sameFloat(n, -0);
}

/**
 * A duration as the details print it (R41) — `15m`, `4h`, `2d`, `1w`, `0`.
 *
 * @param value - The duration, in its unit
 * @param unit - The read's unit
 * @param words - The flowchart's words
 * @returns Its words
 */
export function durationText(value: number, unit: FlowchartDurationUnit, words: FlowchartWords): string {
    const { step, n } = durationOf(value, unit);
    return words.m.detailsDuration({ step, n: words.number(n) });
}

/**
 * A bin's words, by its place (R41): its edges — `4h – 8h` — or, the last,
 * open — `1w or more`.
 *
 * @param edges - The flowchart's bins' edges, ascending
 * @param bin - The bin's place
 * @param unit - The read's unit
 * @param words - The flowchart's words
 * @returns Its words
 */
export function binText(edges: readonly number[], bin: number, unit: FlowchartDurationUnit, words: FlowchartWords): string {
    const from = durationText(edges[bin]!, unit, words);
    return words.m.detailsBin({ from, to: bin >= edges.length - 1 ? undefined : durationText(edges[bin + 1]!, unit, words) });
}

/**
 * A histogram's caption (R36, R41): where half and nine in ten of its counts
 * fall — `Half within 4h · nine in ten within 2d`; `over 1w` where they reach
 * the open last bin.
 *
 * @param edges - The flowchart's bins' edges, ascending
 * @param counts - The row's count in each bin
 * @param unit - The read's unit
 * @param words - The flowchart's words
 * @returns The caption; `undefined` where nothing is counted
 */
export function marksText(edges: readonly number[], counts: readonly number[], unit: FlowchartDurationUnit, words: FlowchartWords): string | undefined {
    const total = counts.reduce((sum, n) => sum + n, 0);
    if (edges.length === 0 || !lessFloat(0, total)) return undefined;
    let running = 0;
    let half = edges.length - 1;
    let nine = edges.length - 1;
    let halfFound = false;
    let nineFound = false;
    counts.forEach((n, i) => {
        running += n;
        if (!halfFound && !lessFloat(running, 0.5 * total)) { half = i; halfFound = true; }
        if (!nineFound && !lessFloat(running, 0.9 * total)) { nine = i; nineFound = true; }
    });
    const mark = (bin: number): FlowchartMarkWord => (bin >= edges.length - 1
        ? { where: "over", at: durationText(edges[edges.length - 1]!, unit, words) }
        : { where: "within", at: durationText(edges[bin + 1]!, unit, words) });
    return words.m.detailsMarks({ half: mark(half), nine: mark(nine) });
}

/**
 * A share in the app's locale (R29, R41): a whole percent — above nothing but
 * under one percent, `<1%`.
 *
 * @param share - The share, 0 to 1
 * @param words - The flowchart's words
 * @returns Its words
 */
export function shareText(share: number, words: FlowchartWords): string {
    return lessFloat(0, share) && lessFloat(share, 0.01) ? words.m.detailsShareUnder({ least: words.percent(0.01) }) : words.percent(share);
}

/** One tick an axis draws: its words, where they start across the axis, and how wide they draw — in px. */
export interface FlowchartTick {
    /** Its words. */
    readonly text: string;
    /** Where its words start, from the axis's start: by the estimate, where it ends at the axis's end. */
    readonly x: number;
    /** How wide they draw, by the estimate. */
    readonly w: number;
    /**
     * Whether it ends at the axis's end, its words going no further whatever
     * they measure: drawn from the end, since a browser that rounds each
     * character to a whole pixel draws them wider than the estimate.
     */
    readonly end: boolean;
}

/** A tick the app lists: where it is, in the read's unit, and its own words where it gives them. */
export interface FlowchartTickAt {
    /** Where it is. */
    readonly at: number;
    /** The app's words for it; `undefined`, printed from the unit. */
    readonly label: string | undefined;
}

/** A tick's text a character, on a card, in px: mono 9.5, the visual spec's. */
export const CARD_TICK_CHAR = 5.7;
/** A tick's text a character, in the inspector, in px: mono 10, the visual spec's. */
export const PANE_TICK_CHAR = 6;
/** The least room between two ticks' words, in px: the visual spec's. */
const TICK_GAP = 6;

/**
 * The round durations an axis names where the app lists no ticks (R28), in
 * minutes: minutes, hours, a day, days and weeks.
 */
const ROUND: readonly number[] = [1, 5, 15, 30, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 12 * HOUR, DAY, 2 * DAY, 4 * DAY, WEEK, 2 * WEEK, 4 * WEEK, 8 * WEEK, 13 * WEEK, 26 * WEEK, 52 * WEEK];

/**
 * The ticks an axis draws across its width (R28; see the module docs): the
 * first edge, then the app's ticks or round durations, each placed where
 * `axisAt` puts it, those that do not fit left out.
 *
 * @param bins - The flowchart's bins
 * @param unit - The read's unit
 * @param ticks - The ticks the app lists; `undefined`, round durations
 * @param width - The axis's width, in px
 * @param char - A tick's text a character, in px
 * @param words - The flowchart's words
 * @returns The ticks drawn, in order
 */
export function axisTicks(
    bins: FlowchartBins, unit: FlowchartDurationUnit, ticks: readonly FlowchartTickAt[] | undefined, width: number, char: number, words: FlowchartWords,
): FlowchartTick[] {
    const edges = bins.edges;
    if (edges.length === 0 || !lessFloat(0, width)) return [];
    const first = edges[0]!;
    const last = edges[edges.length - 1]!;
    const listed: FlowchartTickAt[] = ticks !== undefined
        ? [...ticks].sort((a, b) => compareFloat(a.at, b.at))
        : ROUND.map((minutes) => ({ at: minutes / IN_MINUTES[unit], label: undefined })).filter((tick) => !lessFloat(last, tick.at));
    // Each place once, past the first edge: the first edge's tick is the first.
    const seen = new SortedSet<number>([first], compareFloat);
    const named = listed.filter((tick) => {
        if (!lessFloat(first, tick.at) || seen.has(tick.at)) return false;
        seen.add(tick.at);
        return true;
    });
    const placed = [{ at: first, label: undefined }, ...named].map(({ at, label }): FlowchartTick => {
        const printed = durationText(at, unit, words);
        const text = label ?? (sameFloat(at, last) ? words.m.detailsOpen({ at: printed }) : printed);
        const w = [...text].length * char;
        let x = axisAt(bins, at) * width;
        if (lessFloat(0, x)) x += 1;
        const end = lessFloat(width, x + w);
        if (end) x = width - w;
        return { text, x, w, end };
    });
    const head = placed[0]!;
    if (placed.length === 1) return [head];
    const tail = placed[placed.length - 1]!;
    // The last only where it meets the first; past it, nothing in between that would crowd it.
    const withTail = !lessFloat(tail.x, head.x + head.w + TICK_GAP);
    const stop = withTail ? tail.x : Number.POSITIVE_INFINITY;
    const out: FlowchartTick[] = [head];
    let end = head.x + head.w;
    for (const tick of placed.slice(1, -1)) {
        if (lessFloat(tick.x, end + TICK_GAP) || lessFloat(stop, tick.x + tick.w + TICK_GAP)) continue;
        out.push(tick);
        end = tick.x + tick.w;
    }
    if (withTail) out.push(tail);
    return out;
}
