/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a host's runtime can say of a source read whole (#1599): the
 * collection the source holds now, once the host has read it since the source
 * last answered a Save of this page's.
 *
 * A collection read whole does not say which state of its source it is. A
 * Save's own entries tell, where the collection holds one as the Save left
 * it. But every entry of a Save put back exactly as it was by another write
 * reads as a collection from before the Save, and so does one read before it
 * landed: the editing session, left to tell them apart by what the collection
 * holds, waited for good on the one and could take the other for it. A host
 * that knows when it read its source says so here — its runtime registers
 * what it knows, by the source's id — and the session then takes a Save as
 * read back only at a collection that is the one its source holds since it
 * answered (`EditSession.reconcile`).
 *
 * @packageDocumentation
 */

/**
 * A source's whole collection as its host holds it now, once the host has
 * read it since the source last answered a Save of this page's: its bytes, at
 * the type an editing session's snapshot of it has. `undefined` until then. A
 * tracked read: what reads it is run again as the answer changes.
 */
export type SettledSource = () => Uint8Array | undefined;

/** How the host's runtime says what a source read whole holds, when it can. */
let settledOf: ((sourceId: string) => SettledSource | undefined) | undefined;

/**
 * Register how a host says what its sources read whole hold, each once it has
 * been read since it last answered a Save.
 *
 * @param resolve - What a source holds, by the source's id as its editing
 *   declaration names it; `undefined` for a source the runtime cannot say it of
 */
export function registerSettledSources(resolve: (sourceId: string) => SettledSource | undefined): void {
    settledOf = resolve;
}

/**
 * What a source read whole holds now, where its host can say.
 *
 * @param sourceId - The source's id, as its editing declaration names it
 * @returns The source's reader; `undefined` where no host says it of the source
 */
export function settledSourceOf(sourceId: string): SettledSource | undefined {
    return settledOf?.(sourceId);
}
