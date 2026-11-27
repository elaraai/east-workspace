/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a reader of a schedule's events keeps of what its view has left
 * (#1797): the spans it read of the rows no read of it wants any more, so a
 * view going back to them reads nothing. One rule for every reader that holds
 * its events by block and level — the event kinds' (`cells.ts`) and a Plan's
 * nested rows' (`plan/root/nested.ts`).
 *
 * A reader holds every span its latest read wants: what a view may draw is
 * its own cap's to say. Of the spans no longer wanted it keeps the most
 * recently wanted, while together they weigh at most
 * {@link SCHEDULE_EVENT_CAP} — a span weighs its entries and one more, so a
 * span of no entry still takes a place — and lets go of every one before
 * them: the least recently wanted first, and never a newer one for an older
 * that would fit. What a reader keeps is so at most as much again as a view
 * may draw, however far the view goes.
 *
 * @packageDocumentation
 */

import { SCHEDULE_EVENT_CAP } from "@elaraai/e3-ui/internal";

/**
 * The spans a reader keeps of those its latest read no longer wants (see the
 * module docs): the most recently wanted of them, while they fit.
 *
 * @param unwanted - The spans no longer wanted, each by its name, the least recently wanted first
 * @param entries - How many entries a span holds
 * @returns Those kept, in the order given: every span from the oldest that fits with all after it
 * @typeParam S - A reader's span
 */
export function scheduleSpansKept<S>(unwanted: readonly (readonly [string, S])[], entries: (span: S) => number): (readonly [string, S])[] {
    let weight = 0;
    let first = unwanted.length;
    while (first > 0) {
        weight += entries(unwanted[first - 1]![1]) + 1;
        if (weight > SCHEDULE_EVENT_CAP) break;
        first -= 1;
    }
    return unwanted.slice(first);
}
