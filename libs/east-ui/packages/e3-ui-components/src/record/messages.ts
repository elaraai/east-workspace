/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record grid's own words (`Record - DX Proposal.md` SL1, ST8, EM1,
 * C1–C10): its select column's, a new row's required cell's, its empty
 * state's, and its cells' — their hovers, an age's and an audit's, and the
 * words for no one and for no value where a column gives none. Every other
 * word it shows is the Sheet's.
 *
 * @packageDocumentation
 */

/** What an age counts. */
type AgeUnit = "hours" | "days" | "weeks";

/** An age's unit, one and many. */
const UNITS: Readonly<Record<AgeUnit, readonly [string, string]>> = {
    hours: ["hour", "hours"],
    days: ["day", "days"],
    weeks: ["week", "weeks"],
};

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
    /** A title's hover: the title, and the row's key. */
    titleTitle: (p: { title: string; id: string }) => string;
    /** A person cell with no one in it, where its column gives no words of its own. */
    unassigned: () => string;
    /** A cell with no value, where its column gives no words of its own. */
    absent: () => string;
    /** A cycle's or a toggle's hover: its column, the state it holds, and — while a draft changed it — the record's. */
    stateTitle: (p: { header: string; state: string; was: string | undefined }) => string;
    /** The dot of an age at its column's threshold. */
    stale: () => string;
    /** An age's hover: the count, and once it is stale, the threshold. */
    ageTitle: (p: { count: string; one: boolean; unit: AgeUnit; stale: boolean; threshold: string | undefined }) => string;
    /** An audit's verb and who, beside its date in blame mode. */
    auditMeta: (p: { verb: string; by: string }) => string;
    /** An audit's hover: when, to the minute, then the verb and who. */
    auditTitle: (p: { when: string; verb: string; by: string }) => string;
    /** An audit while the row's drafts change its fields. */
    pending: () => string;
    /** How many fields they change: `2 changes` in blame mode, `2` in date mode. */
    pendingMeta: (p: { count: string; one: boolean; blame: boolean }) => string;
    /** A pending audit's hover. */
    pendingTitle: (p: { count: string }) => string;
}

/** The Record grid's words in English. */
export const recordMessages: RecordMessages = {
    tickAll: ({ all }) => (all ? "Deselect all" : "Select all shown"),
    tickRow: ({ name, ticked }) => `${ticked ? "Deselect" : "Select"} ${name}`,
    required: ({ header }) => `${header} · required`,
    emptyTitle: ({ nouns, query }) => `No ${nouns} match the ${query ? "search" : "filters"}`,
    emptyClear: ({ query }) => `Clear the ${query ? "search" : "filters"} →`,
    titleTitle: ({ title, id }) => `${title} · ${id}`,
    unassigned: () => "Unassigned",
    absent: () => "—",
    stateTitle: ({ header, state, was }) => (was === undefined ? `${header} · ${state}` : `${header} · ${state} · was ${was}`),
    stale: () => "Stale",
    ageTitle: ({ count, one, unit, stale, threshold }) => {
        const age = `${count} ${UNITS[unit][one ? 0 : 1]}`;
        return !stale ? age : threshold === undefined ? `Stale · ${age}` : `Stale · ${age} · threshold ${threshold}`;
    },
    // The parts a row holds, the empty ones left out.
    auditMeta: ({ verb, by }) => [verb, by].filter((part) => part !== "").join(" · "),
    auditTitle: ({ when, verb, by }) => [when, verb, by].filter((part) => part !== "").join(" · "),
    pending: () => "Pending",
    pendingMeta: ({ count, one, blame }) => (blame ? `${count} ${one ? "change" : "changes"}` : count),
    pendingTitle: ({ count }) => `${count} pending`,
};
