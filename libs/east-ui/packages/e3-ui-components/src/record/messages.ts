/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's own words (`Record - DX Proposal.md` SL1, ST8, EM1, C1–C10,
 * FR5, FR6, AD1–AD7, SP1–SP6, FT1, IN2–IN4, IN7–IN9): its select column's,
 * a new row's required cell's, its empty state's, its cells' — their hovers,
 * an age's and an audit's, the words for no one and for no value where a
 * column gives none, and a mark's after a cell's own — and its toolbar's, its status line's, its strip's, its
 * footer's and its inspector's, each in the Record's word for its rows. Every
 * other word it shows is the Sheet's, but the message of an empty field a new
 * row needs, which the Record says its own way in the Sheet's place.
 *
 * @packageDocumentation
 */

import { withArticle } from "../shared/article.js";

/** What an age counts. */
type AgeUnit = "hours" | "days" | "weeks";

/** An age's unit, one and many. */
const UNITS: Readonly<Record<AgeUnit, readonly [string, string]>> = {
    hours: ["hour", "hours"],
    days: ["day", "days"],
    weeks: ["week", "weeks"],
};

/** A count of rows in the Record's word for them, one and many: `1 person`, `2 people`. */
function counted(p: { n: number; count: string; noun: string; nouns: string }): string {
    return `${p.count} ${p.n === 1 ? p.noun : p.nouns}`;
}

/** A count of changes: `1 change`, `3 changes`. */
function changesOf(n: number, count: string): string {
    return `${count} ${n === 1 ? "change" : "changes"}`;
}

/** What an Apply sends (AD4): the fields it changes and on how many rows the record holds, the rows it adds, and those it deletes. */
export interface RecordTally {
    /** How many fields it changes on rows the record holds. */
    readonly changes: number;
    /** On how many of them. */
    readonly changed: number;
    /** How many new rows. */
    readonly added: number;
    /** How many rows it deletes. */
    readonly deleted: number;
}

/** A line's words, parts of them in the line's strong ink: the footer's `N of M people`, its N strong. */
export type RecordLineText = readonly (string | { readonly strong: string })[];

/** The Record's message table. */
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
    /** A cell's words — its hover, its strip's — with its mark's after them (#1560): `Competent · locked: licence`. */
    marked: (p: { text: string | undefined; words: string; lock: boolean }) => string;
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
    /** The rows, where the Record names them no other way: one and many. */
    rowNoun: () => { singular: string; plural: string };
    /** Add's words (FR6). */
    add: () => string;
    /** Add's hover: what it drafts. */
    addTip: (p: { noun: string }) => string;
    /** Delete's words (FR6). */
    delete: () => string;
    /** Delete's hover: how many rows it deletes, or how to choose them. */
    deleteTip: (p: { n: number; count: string }) => string;
    /** The status line once Add has drafted a row (AD1). */
    added: (p: { noun: string }) => string;
    /** The status line once Add drafted nothing: the field no person can set that the app left empty (AD2). */
    cantAdd: (p: { noun: string; label: string }) => string;
    /**
     * The status line once new rows took new keys as they were saved, another save having added rows under theirs
     * (#1583): the first's keys, and how many.
     */
    renumbered: (p: { from: string; to: string; n: number; count: string; noun: string; nouns: string }) => string;
    /** The status line once Delete has taken rows out (AD5). */
    deleted: (p: { n: number; count: string; noun: string; nouns: string }) => string;
    /** The status line once Undo has put deleted rows back (AD5). */
    restored: (p: { n: number; count: string; noun: string; nouns: string }) => string;
    /** The status line once Undo has taken a step back (AD7). */
    undid: () => string;
    /** The status line once Redo has taken a step again (AD7). */
    redid: () => string;
    /** The status line once Discard has dropped every draft (AD6). */
    discarded: (p: { n: number; count: string }) => string;
    /** The status line once Apply's batch is written (AD4): what it sent, each count in words by `count`. */
    applied: (p: { tally: RecordTally; count: (n: number) => string; noun: string; nouns: string }) => string;
    /** The status line once Issues has taken the ring to the first (AD3): the empty fields, or every issue where the app's refusals are among them. */
    issues: (p: { n: number; count: string; refused: boolean }) => string;
    /** The status line while rows are ticked (FR5). */
    selected: (p: { count: string; of: string }) => string;
    /** The footer's rows (FT1): the narrowing's, of the record's — the first strong. */
    shownOf: (p: { shown: string; total: string; n: number; noun: string; nouns: string }) => RecordLineText;
    /** The footer's stale note (FT1): how many rows the first age column with a threshold says are stale. */
    staleNote: (p: { count: string; threshold: string; unit: AgeUnit; one: boolean }) => string;
    /** The strip over nothing (SP1): what a click on a cell does, and on a row. */
    stripRest: (p: { steps: boolean; inspector: boolean }) => string;
    /** The strip's keys where the cell takes none of its own: the ring's moves. */
    stripMove: () => string;
    /** The strip's label over a cell holding a state (SP2): its column, and the state. */
    stripState: (p: { header: string; state: string }) => string;
    /** The strip over a cycle (SP2): the row, the state's name, what the record holds while a draft changed it, and — where it steps — where a click and a ⇧-click take it. */
    stripCycle: (p: { name: string; meta: string; was: string | undefined; next: string | undefined; previous: string | undefined }) => string;
    /** A cycle's keys (SP2): Space steps, the members' one-key labels set, ⌫ sets the first. */
    stripCycleKeys: (p: { set: string | undefined; first: string }) => string;
    /** The strip over a toggle or a boolean: the row, what the record holds while a draft changed it, and — where it flips — what a click sets. */
    stripFlip: (p: { name: string; was: string | undefined; next: string | undefined }) => string;
    /** A toggle's or a boolean's keys. */
    stripFlipKeys: () => string;
    /** A boolean's state in words, where a toggle says its own. */
    booleanWord: (p: { on: boolean }) => string;
    /** The strip's label over a title (SP3): the Record's word for a row, and its key. */
    stripTitle: (p: { noun: string; id: string }) => string;
    /** The strip over a title (SP3): the title, a word of the row's, and where its details are. */
    stripTitleText: (p: { title: string; detail: string | undefined; inspector: boolean }) => string;
    /** The strip over an age (SP4): what it counts, and its threshold — or, stale, for how long. */
    stripAge: (p: { unit: AgeUnit; count: string; one: boolean; stale: boolean; threshold: string | undefined }) => string;
    /** The strip over an audit while the row's drafts change its fields (SP5). */
    stripPending: (p: { count: string }) => string;
    /** The strip over a new row's empty field a person must fill (SP6): what Apply waits for, and how the field is set. */
    stripRequired: (p: { noun: string; how: { cycle: string } | "click" | "inspector" | undefined }) => string;
    /** A new row's field's keys (SP6). */
    stripRemoveRow: () => string;
    /** A Sheet kind's keys, at rest: ⏎ edits, where it edits. */
    stripEdit: (p: { editable: boolean }) => string;
    /** The inspector's chip on a row whose drafts change its fields (IN2): how many. */
    detailsPending: (p: { count: string }) => string;
    /** The inspector's counts with no row selected (IN8): the rows shown, the drafts pending, the rows stale. */
    detailsStat: (p: { stat: "shown" | "pending" | "stale" }) => string;
    /** The inspector with no row selected (IN8): where a row's fields show. */
    detailsHint: () => string;
    /** The inspector's section of the fields of a column group with no label (IN4). */
    otherGroup: () => string;
    /** An empty field a new row needs, as its Details' issues and the Issues tab say it (IN3, IN9). */
    fieldRequired: () => string;
    /** A new row with no title yet, as the Issues tab and the banners name it (IN9): `New person`. */
    newRow: (p: { noun: string }) => string;
    /** The status line once Duplicate has drafted a copy of a row (IN7): the row copied, by its name. */
    duplicated: (p: { name: string }) => string;
}

/** The Record's words in English. */
export const recordMessages: RecordMessages = {
    tickAll: ({ all }) => (all ? "Deselect all" : "Select all shown"),
    tickRow: ({ name, ticked }) => `${ticked ? "Deselect" : "Select"} ${name}`,
    required: ({ header }) => `${header} · required`,
    emptyTitle: ({ nouns, query }) => `No ${nouns} match the ${query ? "search" : "filters"}`,
    emptyClear: ({ query }) => `Clear the ${query ? "search" : "filters"} →`,
    titleTitle: ({ title, id }) => `${title} · ${id}`,
    unassigned: () => "Unassigned",
    absent: () => "—",
    marked: ({ text, words, lock }) => [text ?? "", lock ? (words === "" ? "locked" : `locked: ${words}`) : words].filter((part) => part !== "").join(" · "),
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
    rowNoun: () => ({ singular: "row", plural: "rows" }),
    add: () => "Add",
    addTip: ({ noun }) => `Add ${withArticle(noun)}`,
    delete: () => "Delete",
    deleteTip: ({ n, count }) => (n === 0 ? "Tick rows to delete them" : `Delete ${count} selected`),
    added: ({ noun }) => `Added ${withArticle(noun)}`,
    cantAdd: ({ noun, label }) => `Can't add ${withArticle(noun)} — the app gives no ${label}`,
    renumbered: ({ from, to, n, count, noun, nouns }) => (n === 1 ? `${from} was taken by another save — the new ${noun} is ${to}`
        : `${count} new ${nouns} renumbered — their keys were taken by another save`),
    deleted: (p) => `Deleted ${counted(p)} · Apply writes it, Undo restores`,
    restored: (p) => `Restored ${counted(p)}`,
    undid: () => "Undid one change",
    redid: () => "Redid one change",
    discarded: ({ n, count }) => `Discarded ${changesOf(n, count)}`,
    // `Applied 3 changes to 2 people · added 1 · deleted 1`: what leads, then the rest, each part only where there is one.
    applied: ({ tally, count, noun, nouns }) => {
        const parts: string[] = [];
        if (tally.changes > 0) parts.push(`${changesOf(tally.changes, count(tally.changes))} to ${counted({ n: tally.changed, count: count(tally.changed), noun, nouns })}`);
        if (tally.added > 0) parts.push(parts.length === 0 ? `${count(tally.added)} new ${tally.added === 1 ? noun : nouns}` : `added ${count(tally.added)}`);
        if (tally.deleted > 0) {
            parts.push(parts.length === 0 ? `the deletion of ${counted({ n: tally.deleted, count: count(tally.deleted), noun, nouns })}` : `deleted ${count(tally.deleted)}`);
        }
        return parts.length === 0 ? "Applied" : `Applied ${parts.join(" · ")}`;
    },
    issues: ({ n, count, refused }) => (refused ? `${count} ${n === 1 ? "issue holds" : "issues hold"} Apply` : `${count} required ${n === 1 ? "field" : "fields"} empty`),
    selected: ({ count, of }) => `${count} selected of ${of}`,
    shownOf: ({ shown, total, n, noun, nouns }) => [{ strong: shown }, ` of ${total} ${n === 1 ? noun : nouns}`],
    staleNote: ({ count, threshold, unit, one }) => `${count} stale · no update in ${threshold} ${UNITS[unit][one ? 0 : 1]}`,
    stripRest: ({ steps, inspector }) => (steps && inspector ? "Click a cell to step it · select a row to open it in the inspector"
        : steps ? "Click a cell to step it" : inspector ? "Select a row to open it in the inspector" : ""),
    stripMove: () => "↑ ↓ ← → move",
    stripState: ({ header, state }) => `${header} · ${state}`,
    // The parts the cell has, in order: `A. Morgan · Supervised · was 0 · click → 2 · ⇧-click → 0`.
    stripCycle: ({ name, meta, was, next, previous }) => [name, meta, was === undefined ? "" : `was ${was}`, next === undefined ? "" : `click → ${next}`,
        previous === undefined ? "" : `⇧-click → ${previous}`].filter((part) => part !== "").join(" · "),
    stripCycleKeys: ({ set, first }) => (set === undefined ? `space next · ⌫ ${first}` : `space next · ${set} set · ⌫ ${first}`),
    stripFlip: ({ name, was, next }) => [name, was === undefined ? "" : `was ${was}`, next === undefined ? "" : `click → ${next}`].filter((part) => part !== "").join(" · "),
    stripFlipKeys: () => "space flips",
    booleanWord: ({ on }) => (on ? "yes" : "no"),
    stripTitle: ({ noun, id }) => `${noun} · ${id}`,
    stripTitleText: ({ title, detail, inspector }) => [title, detail ?? "", inspector ? "details in the inspector" : ""].filter((part) => part !== "").join(" · "),
    stripAge: ({ unit, count, one, stale, threshold }) => {
        const counted = UNITS[unit];
        if (stale) return threshold === undefined ? `Stale · no change for ${count} ${counted[one ? 0 : 1]}` : `Stale · no change for ${count} ${counted[one ? 0 : 1]} · threshold ${threshold}`;
        const since = `${counted[1].charAt(0).toUpperCase()}${counted[1].slice(1)} since the last change`;
        return threshold === undefined ? since : `${since} · stale from ${threshold}`;
    },
    stripPending: ({ count }) => `${count} pending · applies with the history bar`,
    stripRequired: ({ noun, how }) => {
        const waits = `Required · Apply waits for every field of a new ${noun}`;
        return how === undefined ? waits : how === "click" ? `${waits} · click sets it` : how === "inspector" ? `${waits} · set it in the inspector` : `${waits} · click sets ${how.cycle}`;
    },
    stripRemoveRow: () => "⌘Z removes the row",
    stripEdit: ({ editable }) => (editable ? "⏎ edit · ↑ ↓ ← → move" : "↑ ↓ ← → move"),
    detailsPending: ({ count }) => `${count} pending`,
    detailsStat: ({ stat }) => (stat === "shown" ? "Shown" : stat === "pending" ? "Pending" : "Stale"),
    detailsHint: () => "Select a row to see its fields here.",
    otherGroup: () => "Other",
    fieldRequired: () => "Required",
    newRow: ({ noun }) => `New ${noun}`,
    duplicated: ({ name }) => `Duplicated ${name}`,
};
