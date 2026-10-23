/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared loading parts' own words (#1398): the footer line's short forms
 * and its Retry, a cut legend's end, and what a failed run says in place. What
 * a builder's line says in full — `Loading work orders 8,301–8,500`,
 * `Loading 12–18 Mar`, `Couldn't read Wed 12 May` — is the builder's, in its
 * own words table, in its record's noun.
 *
 * @packageDocumentation
 */

/** The shared loading parts' words. */
export interface LoadingMessages {
    /** The footer line's short form while a read is in flight — `Loading…`. */
    loading: () => string;
    /** Its short form while a narrowing is in flight — `Filtering…`. */
    filtering: () => string;
    /** Its short form for a read that failed, before its Retry — `Couldn't read`. */
    failed: () => string;
    /** The Retry the line and a failed run offer — `Retry`. */
    retry: () => string;
    /** What ends a legend the rail cut short — `…`. */
    more: () => string;
}

/** The shared loading parts' words, in English. */
export const loadingMessages: LoadingMessages = {
    loading: () => "Loading…",
    filtering: () => "Filtering…",
    failed: () => "Couldn't read",
    retry: () => "Retry",
    more: () => "…",
};
