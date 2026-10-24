/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a builder's footer rail fits its items on one line (#1398, CL3): its
 * legend — or its hints, or the Plan's counts — and the loading line in its
 * own slot at the rail's trailing end. The rail never wraps and never cuts a
 * word:
 *
 * 1. the legend stays whole and in place; hints (the Sheet's) end at a whole
 *    hint, then "…";
 * 2. the loading line shows its full text if it fits whole;
 * 3. else its short form ("Loading…", "Filtering…", "Couldn't read · Retry")
 *    if that fits whole;
 * 4. else the dot alone, its full text kept for screen readers — a failure's
 *    floor being the dot and Retry, "● Retry";
 * 5. and where even that leaves the legend no room (a rail under 480px), the
 *    legend ends at a whole item, then "…", and the line shows its short form.
 *
 * Nothing on the rail takes an ellipsis inside a word. The line's text is cut
 * when it is wider than its share of the rail (the recipe's `max-width`), and
 * a cut counts as not fitting, as an overflow of the rail does.
 *
 * This is the order of the design's `fitFoot` (`docs/proposals/loading-1398/
 * guidelines/cards/loading-parts.js`), as pure arithmetic over widths the
 * caller measures from the rendered recipe — never widths written here.
 *
 * @packageDocumentation
 */

/** How the loading line shows: its full text, its short form, or its dot alone (a failure's dot and Retry). */
export type LoadingLineForm = "full" | "short" | "dot";

/** What a rail is made of, measured: every width in CSS px. */
export interface FooterFitInput {
    /** The rail's content width: its width less its inline padding. */
    readonly available: number;
    /** The gap between the rail's items, as its recipe sets it. */
    readonly gap: number;
    /**
     * Each item the rail keeps whole and never cuts — a count, a Save's notice — in order, at its natural width; an item
     * that takes the rail's slack (the Sheet's message) at none, as it shrinks to the room the fit leaves it.
     */
    readonly fixed: readonly number[];
    /** The legend's items — or the hints, or the Plan's counts — each whole, in order. */
    readonly units: readonly number[];
    /**
     * The gap between two units: the rail's own where each unit is an item of
     * the rail (a legend), none where they run on in one item as words do (the
     * Sheet's hints, each carrying its own ` · `). The units are one item of
     * the rail either way.
     */
    readonly unitGap: number;
    /** The "…" that ends a cut legend. */
    readonly more: number;
    /** Whether the units are hints, which end at a whole hint whenever the line needs the room; a legend ends only where it cannot fit beside the line's short form. */
    readonly hints: boolean;
    /** The loading line's natural width in each form; `undefined` while nothing is in flight or failed. */
    readonly line: { readonly full: number; readonly short: number; readonly dot: number } | undefined;
    /** The share of the rail the line may take before its text is cut (the recipe's `max-width`, 64%). */
    readonly lineCap: number;
}

/** How a rail fits: how many units stay, and the form the line shows in. */
export interface FooterFit {
    /** How many of the units stay, from the first; the rest are cut, and "…" ends the legend. */
    readonly kept: number;
    /** The form the loading line shows in. */
    readonly form: LoadingLineForm;
}

/** A rail measured as fitting before anything is measured: every unit kept, the line whole. */
export const FOOTER_UNFIT: FooterFit = { kept: Number.POSITIVE_INFINITY, form: "full" };

/** The tolerance a measure is taken at: a rounding's px never cuts an item. */
const SLACK = 1;

/**
 * How a rail fits its items on one line — see the module docs.
 *
 * @param input - The rail's items, measured
 * @returns How many units stay, and the line's form
 */
export function fitFooter(input: FooterFitInput): FooterFit {
    const { available, gap, fixed, units, unitGap, more, hints, line, lineCap } = input;
    const n = units.length;
    let fixedWidth = 0;
    for (const w of fixed) fixedWidth += w;
    /** The rail's width with `kept` units, the line in `form`: each item and the gaps between them, the units one item. */
    const width = (kept: number, form: LoadingLineForm): number => {
        let w = fixedWidth;
        let items = fixed.length;
        for (let i = 0; i < kept; i++) w += units[i]!;
        if (kept > 0) {
            w += (kept - 1) * unitGap;
            items += 1;
        }
        if (kept < n) {
            w += more;
            items += 1;
        }
        if (line !== undefined) {
            w += line[form];
            items += 1;
        }
        return w + Math.max(0, items - 1) * gap;
    };
    const over = (kept: number, form: LoadingLineForm) => width(kept, form) > available + SLACK;
    // The line's text is cut past its share of the rail; its dot alone carries no text to cut.
    const cut = (form: LoadingLineForm) => line !== undefined && form !== "dot" && line[form] > lineCap * available + SLACK;
    const bad = (kept: number, form: LoadingLineForm) => over(kept, form) || cut(form);

    let kept = n;
    // Nothing in flight: the legend alone, whole unless the rail cannot hold it.
    if (line === undefined) {
        while (kept > 1 && over(kept, "full")) kept -= 1;
        return { kept, form: "full" };
    }
    // Hints give way to the line's full text, a whole hint at a time.
    if (hints) while (kept > 1 && bad(kept, "full")) kept -= 1;
    if (!bad(kept, "full")) return { kept, form: "full" };
    if (!bad(kept, "short")) return { kept, form: "short" };
    if (!bad(kept, "dot")) return { kept, form: "dot" };
    // Where even the dot leaves the legend no room, the legend ends at a whole item and the line keeps its short form.
    while (kept > 1 && bad(kept, "short")) kept -= 1;
    return { kept, form: "short" };
}
