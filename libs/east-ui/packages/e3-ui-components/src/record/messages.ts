/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record grid's own words (`Record - DX Proposal.md` SL1, ST8, EM1): its
 * select column's, a new row's required cell's and its empty state's. Every
 * other word it shows is the Sheet's.
 *
 * @packageDocumentation
 */

/** The Record grid's message table. */
export interface RecordMessages {
    /** The header's box: every row shown ticked, it unticks them all. */
    tickAll: (p: { all: boolean }) => string;
    /** A row's box, by the row's name. */
    tickRow: (p: { name: string; ticked: boolean }) => string;
    /** A new row's empty cell a person must fill. */
    required: (p: { header: string }) => string;
    /** Nothing shown: the rail's search matches no row — else its filters. */
    emptyTitle: (p: { nouns: string; query: boolean }) => string;
    /** Nothing shown: clears the search — else the filters. */
    emptyClear: (p: { query: boolean }) => string;
}

/** The Record grid's words in English. */
export const recordMessages: RecordMessages = {
    tickAll: ({ all }) => (all ? "Deselect all" : "Select all shown"),
    tickRow: ({ name, ticked }) => `${ticked ? "Deselect" : "Select"} ${name}`,
    required: ({ header }) => `${header} · required`,
    emptyTitle: ({ nouns, query }) => `No ${nouns} match the ${query ? "search" : "filters"}`,
    emptyClear: ({ query }) => `Clear the ${query ? "search" : "filters"} →`,
};
