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
 * An item can be HELD to a range of its forms: one holding an open overlay to
 * its one form, and a member of a bundle another item holds to the side of
 * that bundle's step the bundle stands on — its other steps its own to take
 * (`./index.tsx`). It starts at the range's least form and takes only the
 * steps inside it.
 *
 * Below the ladder lies the row's FLOOR (hand retest, 27 Oct 2026): a step
 * ranked at {@link FLOOR_RANK} or past it is a rung of the floor, not of the
 * ladder. The toolbar takes a floor rung only once every step of the ladder
 * has applied — the history's last among them — and the row still does not
 * fit, so a row the ladder fits never takes one; its rungs give what the
 * ladder keeps (the rail's icon its caret, the Elara eye its place), so the
 * history and Save stay in the row where the ladder alone would run it past
 * its end. An item's rungs follow its ladder steps ({@link ladderMost}).
 *
 * @packageDocumentation
 */

/** Slack, in CSS px, for sub-pixel widths when a row is compared with its box. */
export const FIT_TOLERANCE_PX = 0.5;

/**
 * The first rank of the row's floor: a fold step at this rank or past it is a
 * rung of the floor, taken only once the whole ladder has applied and the row
 * still does not fit (see the module docs). Every ladder rank lies below it —
 * the rail's 0–7, a host's from 10, the history's 100.
 */
export const FLOOR_RANK = 1000;

/**
 * The narrowest form an item's ladder takes it to: the form before its first
 * floor step ({@link FLOOR_RANK}), or its last form where it has none. An
 * item's steps apply in order, so every step after its first floor step is a
 * floor step too.
 *
 * @param item - The item
 * @returns The form index its ladder ends at
 */
export function ladderMost(item: FoldItem): number {
    let floor = -Infinity;
    for (let to = 1; to < item.forms; to++) {
        floor = Math.max(floor, item.ranks[to - 1] ?? 0);
        if (floor >= FLOOR_RANK) return to - 1;
    }
    return item.forms - 1;
}

/**
 * An item kept to its ladder: held to the forms its ladder steps reach, never
 * a floor rung — the forms it is held to already, where something holds it,
 * and no further than {@link ladderMost} — unless it is held past them, which
 * keeps it where it is held.
 *
 * @param item - The item
 * @returns The item, its floor rungs out of reach
 */
export function onLadder(item: FoldItem): FoldItem {
    const most = ladderMost(item);
    const range = item.held ?? { least: 0, most: item.forms - 1 };
    if (range.most <= most) return item;
    return { ...item, held: { least: range.least, most: Math.max(most, range.least) } };
}

/** The forms an item is held to, each a form index: its least and its most. */
export interface FoldRange {
    /** The widest form it may take: the steps up to it stand applied. */
    readonly least: number;
    /** The narrowest form it may take: the steps past it stand unapplied. */
    readonly most: number;
}

/** One item, as the fold model sees it. */
export interface FoldItem {
    /** How many forms the item has — at least one. */
    readonly forms: number;
    /** Each fold step's rank: `ranks[i]` is the step from form `i` to form `i + 1`. */
    readonly ranks: readonly number[];
    /** The forms that draw nothing (the item hides): they take no width and no gap. */
    readonly empty: readonly boolean[];
    /** The forms the item is held to while something holds it — `{ least: f, most: f }` keeps form `f` — else `undefined`. */
    readonly held: FoldRange | undefined;
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
 * ties in item order. A held item takes only the steps inside the range it is
 * held to — one held to a single form takes none.
 *
 * @param items - The toolbar's items, in their order
 * @returns The fold sequence
 */
export function foldSequence(items: readonly FoldItem[]): FoldStep[] {
    const steps: FoldStep[] = [];
    items.forEach((it, item) => {
        const least = it.held?.least ?? 0, most = it.held?.most ?? it.forms - 1;
        // An item's steps apply in order, so a step never ranks below the one before it.
        let floor = -Infinity;
        for (let to = least + 1; to <= most; to++) {
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
 * The form each item takes once the first `folds` steps of the sequence apply:
 * a held item from the least form it is held to.
 *
 * @param items - The toolbar's items
 * @param sequence - Their fold sequence ({@link foldSequence})
 * @param folds - How many steps apply
 * @returns Each item's form index
 */
export function formsAt(items: readonly FoldItem[], sequence: readonly FoldStep[], folds: number): number[] {
    const out = items.map((it) => it.held?.least ?? 0);
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
 * the last does not fit, every step applies — the toolbar then takes the
 * floor's rungs, where it has kept them out of the sequence ({@link onLadder}),
 * and past those the row clips at its end.
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
