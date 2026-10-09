/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The toolbar's fold model (#952) — pure, so the choice it makes is a function
 * of the numbers it is given: the row's width, the gap between items, and the
 * widths the toolbar has measured. Nothing here reads the page.
 *
 * A toolbar is one row of items. An item has forms, widest first; each fold
 * step (form `i` → `i + 1`) has a rank. The fold SEQUENCE is every item's
 * steps, ordered by rank, ties in item order; the toolbar renders the
 * shortest prefix of it whose row fits. An item's own steps apply in order:
 * a step ranked below an earlier step of its item waits for that one.
 *
 * Steps of several items that share a BUNDLE apply together (#1229): a chip
 * that takes the place of several controls draws in the same step that hides
 * them, so no prefix the toolbar renders splits a bundle — it takes all of its
 * steps or none. A bundle's steps share one rank, so they sit side by side in
 * the sequence; were they to differ, the bundle would apply as one at its last
 * step's place, every step between its first and its last applying with it.
 *
 * @packageDocumentation
 */

/** Slack, in CSS px, for sub-pixel widths when a row is compared with its box. */
export const FIT_TOLERANCE_PX = 0.5;

/** One item, as the fold model sees it. */
export interface FoldItem {
    /** How many forms the item has — at least one. */
    readonly forms: number;
    /** Each fold step's rank: `ranks[i]` is the step from form `i` to form `i + 1`. */
    readonly ranks: readonly number[];
    /** The forms that draw nothing (the item hides): they take no width and no gap. */
    readonly empty: readonly boolean[];
    /** The form the item keeps while it holds an open overlay, else `undefined`. */
    readonly held: number | undefined;
    /** Each fold step's bundle, when it has one: `bundles[i]` is the step from form `i` to `i + 1`. */
    readonly bundles?: readonly (string | undefined)[] | undefined;
}

/** One fold step: which item folds, to which form, at what rank, and the bundle it applies with. */
export interface FoldStep {
    readonly item: number;
    readonly to: number;
    readonly rank: number;
    readonly bundle?: string | undefined;
}

/**
 * Every item's fold steps, in the order the toolbar applies them: by rank,
 * ties in item order. A held item takes no steps — it keeps its form.
 *
 * @param items - The toolbar's items, in their order
 * @returns The fold sequence
 */
export function foldSequence(items: readonly FoldItem[]): FoldStep[] {
    const steps: FoldStep[] = [];
    items.forEach((it, item) => {
        if (it.held !== undefined) return;
        // An item's steps apply in order, so a step never ranks below the one before it.
        let floor = -Infinity;
        for (let to = 1; to < it.forms; to++) {
            floor = Math.max(floor, it.ranks[to - 1] ?? 0);
            const bundle = it.bundles?.[to - 1];
            steps.push(bundle === undefined ? { item, to, rank: floor } : { item, to, rank: floor, bundle });
        }
    });
    // Stable: equal ranks keep item order, and an item's steps their own order.
    return steps.sort((a, b) => a.rank - b.rank);
}

/**
 * Whether applying the first `folds` steps of the sequence would split a
 * bundle: take some of its steps and leave the rest. With a bundle's steps at
 * sequence indices `i1 < … < im`, a prefix of length `folds` splits it when
 * `i1 < folds ≤ im`.
 *
 * @param sequence - The fold sequence ({@link foldSequence})
 * @param folds - How many steps would apply
 * @returns Whether that prefix splits a bundle
 */
export function splitsBundle(sequence: readonly FoldStep[], folds: number): boolean {
    const first = new Map<string, number>();
    const last = new Map<string, number>();
    sequence.forEach((step, i) => {
        if (step.bundle === undefined) return;
        if (!first.has(step.bundle)) first.set(step.bundle, i);
        last.set(step.bundle, i);
    });
    for (const [bundle, i1] of first) {
        if (i1 < folds && folds <= last.get(bundle)!) return true;
    }
    return false;
}

/**
 * The form each item takes once the first `folds` steps of the sequence apply.
 *
 * @param items - The toolbar's items
 * @param sequence - Their fold sequence ({@link foldSequence})
 * @param folds - How many steps apply
 * @returns Each item's form index
 */
export function formsAt(items: readonly FoldItem[], sequence: readonly FoldStep[], folds: number): number[] {
    const out = items.map((it) => it.held ?? 0);
    for (let k = 0; k < folds && k < sequence.length; k++) {
        const step = sequence[k]!;
        out[step.item] = step.to;
    }
    return out;
}

/**
 * The width a row of items takes in the given forms: every drawn form's
 * width, and one gap between each two drawn items.
 *
 * @param items - The toolbar's items
 * @param forms - Each item's form index
 * @param widthOf - A form's width, in CSS px
 * @param gap - The gap between two items, in CSS px
 * @returns The row's width, in CSS px
 */
export function rowWidth(
    items: readonly FoldItem[],
    forms: readonly number[],
    widthOf: (item: number, form: number) => number,
    gap: number,
): number {
    let total = 0;
    let drawn = 0;
    items.forEach((it, i) => {
        const form = forms[i]!;
        if (it.empty[form] === true) return;
        total += widthOf(i, form);
        drawn += 1;
    });
    return total + gap * Math.max(0, drawn - 1);
}

/**
 * How many steps of the sequence to apply: the fewest whose row fits the
 * box, never a number that splits a bundle ({@link splitsBundle}). When even
 * the last does not fit, every step applies — the row then clips at its end.
 *
 * @param items - The toolbar's items
 * @param sequence - Their fold sequence
 * @param widthOf - A form's width, in CSS px (known, or an estimate — {@link estimateWidth})
 * @param available - The row's box, in CSS px
 * @param gap - The gap between two items, in CSS px
 * @returns The number of steps to apply
 */
export function chooseFolds(
    items: readonly FoldItem[],
    sequence: readonly FoldStep[],
    widthOf: (item: number, form: number) => number,
    available: number,
    gap: number,
): number {
    for (let folds = 0; folds < sequence.length; folds++) {
        if (splitsBundle(sequence, folds)) continue;
        if (rowWidth(items, formsAt(items, sequence, folds), widthOf, gap) <= available + FIT_TOLERANCE_PX) return folds;
    }
    return sequence.length;
}

/**
 * A form's width, for choosing: the width measured for it, else the widest
 * measured of its NARROWER forms — a lower bound, since a form is never
 * narrower than the ones that fold from it — else 0.
 *
 * @remarks
 * Estimating low is what lets the toolbar settle without trying on screen:
 * a choice made on lower bounds is never folded further than it must be, so
 * if its row fits once measured it is the right one, and if it does not, the
 * measurement just taken rules it out and the next choice folds further.
 * Each pass measures at least one form it had not, so the passes end.
 *
 * @param measured - The item's measured widths, by form
 * @param form - The form wanted
 * @returns Its width, or a lower bound for it, in CSS px
 */
export function estimateWidth(measured: ReadonlyMap<number, number>, form: number): number {
    const known = measured.get(form);
    if (known !== undefined) return known;
    let bound = 0;
    for (const [f, px] of measured) if (f > form && px > bound) bound = px;
    return bound;
}
