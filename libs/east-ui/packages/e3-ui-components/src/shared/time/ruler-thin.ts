/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a ruler's labels it draws (#1269): where its columns are narrower
 * than their labels, every k-th — k the smallest step at which every label it
 * draws fits whole, with a gap between two — and each period's first column
 * (a week's Monday under days, a month's first week under weeks, a year's
 * January under months) always among them, as the user ruled. Where even the
 * periods' first columns crowd each other, each draws that clears the one
 * drawn before it, and no other label does. A preferred label — the narrow
 * ruler's now bucket, which wears the brand where a chip has no room — draws
 * wherever it clears every period's first column drawn, and the labels it
 * crowds give way to it.
 *
 * A label is centred on its column, and may run past it into the columns
 * either side, which draw none. One that would run past the track's start or
 * end sits against its own column's edge there instead; one that cannot lie
 * inside the track either way draws nowhere.
 *
 * Pure: decided from the labels' widths as the ruler measured them, each
 * drawn whole.
 *
 * @packageDocumentation
 */

/** One column's label, as the ruler measured it. */
export interface RulerLabel {
    /** The column's centre, in px. */
    readonly centre: number;
    /** The column's inside start edge, in px: where its label sits when, centred, it would run past the track's start. */
    readonly start: number;
    /** The column's inside end edge, in px: where its label sits when, centred, it would run past the track's end. */
    readonly end: number;
    /** The label's width, drawn whole, in px. */
    readonly width: number;
    /** Whether the column starts a period: its label draws unless it crowds the period's first column drawn before it. */
    readonly anchor: boolean;
    /** Whether the column's label draws wherever it clears every period's first column drawn. */
    readonly prefer: boolean;
}

/** Where a label sits against its column: centred on it, or against its start or its end edge. */
export type RulerAlign = "centre" | "start" | "end";

/** What the ruler draws: each column's label shown or not, and where it sits. */
export interface RulerFit {
    /** Whether each column's label is drawn. */
    readonly shown: readonly boolean[];
    /** Where each column's label sits. */
    readonly align: readonly RulerAlign[];
}

/** A width within a hundredth of a pixel fits: the widths are measured, and summed. */
const SLACK = 0.01;

/**
 * A label's box on the track, and where it sits: centred on its column, or —
 * where centred it would run past the track's start or end — against its own
 * column's edge there. `undefined` where neither keeps it inside the track.
 */
function place(label: RulerLabel, track: { left: number; right: number }): { left: number; right: number; align: RulerAlign } | undefined {
    const left = label.centre - label.width / 2;
    const right = left + label.width;
    const inside = (l: number, r: number) => l >= track.left - SLACK && r <= track.right + SLACK;
    if (left < track.left - SLACK) {
        return inside(label.start, label.start + label.width)
            ? { left: label.start, right: label.start + label.width, align: "start" } : undefined;
    }
    if (right > track.right + SLACK) {
        return inside(label.end - label.width, label.end)
            ? { left: label.end - label.width, right: label.end, align: "end" } : undefined;
    }
    return { left, right, align: "centre" };
}

/**
 * The labels a ruler draws — see the module docs.
 *
 * @param labels - Each column's label, in order
 * @param track - The track's ends, in px
 * @param gap - The room between two labels, in px
 * @returns Which labels draw, and where each sits
 */
export function thinTicks(labels: readonly RulerLabel[], track: { left: number; right: number }, gap: number): RulerFit {
    const boxes = labels.map((label) => place(label, track));
    const align = boxes.map((box) => box?.align ?? "centre");
    /** Whether label `a`, placed before label `b`, keeps the gap from it. */
    const apart = (a: number, b: number) => boxes[a]!.right + gap <= boxes[b]!.left + SLACK;
    /** Whether a run of labels, by index in order, fits: each one placed, and each clear of the one before by the gap. */
    const fits = (run: readonly number[]) => run.every((i, j) => boxes[i] !== undefined && (j === 0 || apart(run[j - 1]!, i)));
    const shownOf = (run: readonly number[]): RulerFit => {
        const on = new Set(run);
        return { shown: labels.map((_, i) => on.has(i)), align };
    };
    // The periods' first columns: each that clears the one drawn before it.
    const anchors = labels.flatMap((label, i) => (label.anchor && boxes[i] !== undefined ? [i] : []));
    const held: number[] = [];
    for (const i of anchors) if (held.length === 0 || apart(held[held.length - 1]!, i)) held.push(i);
    const everyAnchor = held.length === anchors.length;
    // And each preferred label clear of every label held before it.
    labels.forEach((label, i) => {
        if (!label.prefer || label.anchor || boxes[i] === undefined) return;
        if (held.every((h) => (h < i ? apart(h, i) : apart(i, h)))) held.push(i);
    });
    held.sort((a, b) => a - b);
    if (!everyAnchor) return shownOf(held);
    // Every k-th column from each period's first, beside them: the smallest k that fits.
    const isHeld = new Set(held);
    for (let k = 1; k <= labels.length; k++) {
        const run: number[] = [];
        let base = 0;
        labels.forEach((label, i) => {
            if (label.anchor) base = i;
            if (isHeld.has(i) || (!label.anchor && (i - base) % k === 0 && boxes[i] !== undefined)) run.push(i);
        });
        // A label that crowds one that always draws gives way to it.
        const clear = run.filter((i, j) => {
            if (isHeld.has(i)) return true;
            const next = run[j + 1];
            const prev = run[j - 1];
            return !(next !== undefined && isHeld.has(next) && !apart(i, next))
                && !(prev !== undefined && isHeld.has(prev) && !apart(prev, i));
        });
        if (fits(clear)) return shownOf(clear);
    }
    return shownOf(held);
}
