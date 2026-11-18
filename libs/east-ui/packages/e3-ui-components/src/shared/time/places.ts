/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Places along an axis (#1680's review): for each mark on a line, the next
 * place past it — where the room its label may run in ends, so one mark's
 * words never run over the next mark (`Plan Spec.md` K7, "labels print when
 * there is room"). Marks that stand together share the one place past them.
 * The numbers are any domain's (the scale's fractions, px), so this knows
 * nothing of time.
 *
 * @packageDocumentation
 */

/**
 * Each place's next place past it along the line.
 *
 * @param places - The places, in any order
 * @returns For each place, in the order given, the least place past it; `undefined` for the last, and for those that
 *   stand with it
 */
export function nextPlaces(places: readonly number[]): (number | undefined)[] {
    const order = places.map((_, i) => i).sort((a, b) => places[a]! - places[b]!);
    const next = new Array<number | undefined>(places.length).fill(undefined);
    // Walked from the line's end: the least place past those walked so far, moved on as a place short of it is reached.
    let ahead: number | undefined;
    for (let k = order.length - 1; k >= 0; k--) {
        const later = order[k + 1];
        if (later !== undefined && places[later]! > places[order[k]!]!) ahead = places[later]!;
        next[order[k]!] = ahead;
    }
    return next;
}
