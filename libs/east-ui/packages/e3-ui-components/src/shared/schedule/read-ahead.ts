/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A period builder's neighbouring periods, read ahead (#1398, CL7): once the
 * period in view has landed — every read it needs — its reader reads the next
 * period's and the previous period's too, so a one-step move to either finds
 * its reads landed and shows it at once, with no placeholder. The Roster's
 * weeks, the Allocation's days and the Calendar's days, weeks and months read
 * so.
 *
 * They are read in a tracked read of their own beside the period's
 * (`useReadAhead`), which keeps them while they are neighbours: the paging
 * runtime aborts a read no reader waits on any longer
 * (`platform/paged-runtime.ts`), so a newer navigation drops the reads of the
 * periods it moved away from, a period passed through in rapid steps among
 * them; and a page of theirs landing re-runs that read alone, never the
 * period's. Nothing is read ahead until the period itself has landed, so its
 * own pages go first; each read's pages are asked concurrently once its count
 * is known (`PagedScan`, up to four in flight). A neighbour's read is never
 * its period's display: what it reads is kept by its tracked reads, and a
 * failure there is said once it is the period in view, by that period's own
 * read.
 *
 * @packageDocumentation
 */

/**
 * Read a period's neighbours ahead, once the period itself has landed (see
 * the module docs). Called inside a tracked read: `useReadAhead`'s.
 *
 * @param landed - Whether every read the period in view needs has landed: until then nothing is read ahead
 * @param neighbours - The periods read ahead, nearest first: the next, then the previous
 * @param read - Reads one neighbour's reads, as the period's own read reads its period's; what it answers is not used
 * @typeParam P - What names a period: its first day, or its range
 */
export function readAhead<P>(landed: boolean, neighbours: readonly P[], read: (period: P) => void): void {
    if (!landed) return;
    for (const period of neighbours) {
        try {
            read(period);
        } catch {
            // A neighbour's failure is not the period in view's: its read says it once it is the period in view.
        }
    }
}
