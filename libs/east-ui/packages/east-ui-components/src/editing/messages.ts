/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session's own words (#879) — the history bar's, and the
 * renderer's own draft issues'. Every editable collection's message table
 * carries them (the Sheet's `SheetMessages` extends {@link EditingMessages}),
 * so a host translates the history bar where it translates the collection, and
 * the bar speaks whatever words its collection hands it.
 *
 * Two kinds of text leave the renderer in canonical English, whatever the
 * viewer reads — the draft issues the patch events carry to the host, and the
 * session's own error — and are read back where they show
 * ({@link sessionErrorText}, the collection's issue text).
 *
 * @packageDocumentation
 */

import type { Formatters } from "../format/index.js";

/** The history bar's states that say something. */
export type EditHistoryWord = "stale" | "carrying" | "applying" | "unknown" | "reconciling" | "rejected" | "conflict";

/**
 * The editing session's message table — the history bar and the draft
 * issues.
 *
 * @remarks
 * `count` is a number already formatted for the locale; `n` is the raw number
 * beside it, for plural rules.
 */
export interface EditingMessages {
    /** The bar's status line. */
    historyStatus: (p: { status: EditHistoryWord }) => string;
    /** The issues button — `2 issues`. */
    issues: (p: { n: number; count: string }) => string;
    /** Its tooltip. */
    issuesTip: (p: { n: number; count: string }) => string;
    /** Undo. */
    undo: () => string;
    /** Undo's tooltip. */
    undoTip: () => string;
    /** Redo. */
    redo: () => string;
    /** Redo's tooltip. */
    redoTip: () => string;
    /** Discard. */
    discard: () => string;
    /** Discard's tooltip. */
    discardTip: () => string;
    /** Ask the source again for the confirmed revision. */
    retryRefresh: () => string;
    /** Send the same request again. */
    retryRequest: () => string;
    /** Save: what sends the drafts as one checked batch — the session's `apply`. */
    apply: () => string;
    /** A source that saved a batch without its committed revision. */
    applyNoRevision: () => string;
    /** Save's tooltip while conflicts wait to be chosen — `Choose 2 conflicts to save`. */
    applySettleFirst: (p: { n: number; count: string }) => string;
    /** The conflicts button — `2 conflicts`. */
    conflicts: (p: { n: number; count: string }) => string;
    /** Its tooltip. */
    conflictsTip: (p: { n: number; count: string }) => string;
    /** The conflicts popover's head — `Conflicts · 2`. */
    conflictsHead: (p: { n: number; count: string }) => string;
    /** The popover's head before its count — and while the newest data is read, alone. */
    conflictsTitle: () => string;
    /** The button's Tooltip while a run of the optimiser is out. */
    conflictsLockedTip: (p: { n: number; count: string }) => string;
    /** Opens a long value in place. */
    conflictShowAll: () => string;
    /** Folds it again. */
    conflictShowLess: () => string;
    /** Its first words: what happened, and what to do. */
    conflictsIntro: () => string;
    /** Every conflict chosen — `All 2 conflicts chosen. Save is on.` */
    conflictsSettled: (p: { n: number; count: string }) => string;
    /** Every conflict chosen, and nothing left to save: each choice took the newer value. */
    conflictsSettledNothing: (p: { n: number; count: string }) => string;
    /** Said as conflicts appear, to a screen reader. */
    conflictsAppeared: (p: { n: number; count: string }) => string;
    /** Keep every one's draft value. */
    conflictsKeepAll: () => string;
    /** Take every one's newer value. */
    conflictsTakeAll: () => string;
    /** The draft's side. */
    conflictYours: () => string;
    /** The newer side. */
    conflictTheirs: () => string;
    /** What both began from — `was 442`. */
    conflictWas: (p: { value: string }) => string;
    /** Where the data names no one who changed it. */
    conflictChangedSince: () => string;
    /** Go to the entry. */
    conflictGoTo: () => string;
    /** A range card's label: an item's start and end, read as one. */
    conflictDates: () => string;
    /** A conflict, as the issue a collection goes to. */
    issueConflict: () => string;
    /** The banner while a reload would lose the drafts: the tab's storage refused them, and why. */
    bannerUnkept: (p: { reason: "unavailable" | "full" | "unreadable" | "unwritable" }) => string;
    /** The banner over drafts a reload kept that could not be restored, and why. */
    bannerLost: (p: { reason: "schema" | "unreadable" }) => string;
    /** The banner while conflicts wait — `2 of your changes conflict with newer changes`. */
    bannerConflicts: (p: { n: number; count: string }) => string;
    /** A session banner's word, before its message: what it is, in mono capitals. */
    bannerWord: (p: { kind: "conflict" | "rejected" | "unconfirmed" | "stale" | "unkept" }) => string;
    /** The banner's action: open the conflicts. */
    conflictsChoose: () => string;
    /** Why the choices are off while an optimiser run is out. */
    conflictsLocked: () => string;
    /** A conflict settled for the draft's value — `kept yours: 500`. */
    conflictKept: (p: { value: string }) => string;
    /** A conflict settled for the newer value — `used theirs: 450`. */
    conflictTaken: (p: { value: string }) => string;
    /** An entry removed. */
    conflictRemoved: () => string;
    /** A value cleared. */
    conflictCleared: () => string;
    /** Empty text. */
    conflictEmpty: () => string;
    /** Nothing. */
    conflictNone: () => string;
    /** A flag set. */
    conflictYes: () => string;
    /** A flag not set. */
    conflictNo: () => string;
    /** A list's item, counting from one — `Item 3`. */
    conflictItem: (p: { n: number; count: string }) => string;
    /** A list's size — `12 items`. */
    conflictItems: (p: { n: number; count: string }) => string;
    /** A set's or a map's size — `12 entries`. */
    conflictEntries: (p: { n: number; count: string }) => string;
    /** A series of numbers' size — `48 numbers`. */
    conflictNumbers: (p: { n: number; count: string }) => string;
    /** A grid's size — `12 × 4 grid`. */
    conflictGrid: (p: { rows: string; cols: string }) => string;
    /** A tree. */
    conflictTree: () => string;
    /** A file — `File · 2,400 bytes`. */
    conflictFile: (p: { size: string }) => string;
    /** A field whose text could not be read. */
    issueInvalid: (p: { value: string }) => string;
    /** A draft field with no value. */
    issueRequired: () => string;
    /** An entry a Save's conflict names, which the session read changed, where its source gave no words for it (#1199). */
    issueChanged: () => string;
    /** A Save's conflict where the session read no entry changed, and its source said nothing of itself (#1199). */
    issueSourceChanged: () => string;
    /** The banner over a Save the source found conflicts in — `Not saved — 2 conflicts with newer changes`. */
    bannerConflict: (p: { n: number; count: string }) => string;
    /** The banner over a Save the source refused. */
    bannerRejected: () => string;
    /** The banner over a write with no answer. */
    bannerUnknown: () => string;
    /** The banner over a Save whose result could not be read back. */
    bannerConfirmFailed: () => string;
    /** The banner over drafts the source moved under, where they are not carried over to it. */
    bannerStale: () => string;
    /** One of a Save's issues in its banner — `J-0002: Changed since this edit began`; `where` is empty for the source as a whole. */
    bannerIssue: (p: { where: string; message: string }) => string;
    /** The issues a banner leaves out — `and 4 more`. */
    bannerMore: (p: { n: number; count: string }) => string;
    /** A banner's title naming the source it reports on, where a history holds several (#1194) — `Print job: Not saved — 1 conflict with newer changes`. */
    bannerSource: (p: { source: string; title: string }) => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The English table — the default every collection's table spreads. */
export const editingMessages: EditingMessages = {
    historyStatus: ({ status }) => {
        switch (status) {
            case "stale": return "Changed elsewhere — discard your changes to go on";
            case "carrying": return "Checking your changes against the newest data";
            case "applying": return "Saving…";
            case "unknown": return "No answer yet — retry to find out whether it saved";
            case "reconciling": return "Saved — reading it back…";
            case "rejected": return "Not saved — change what's flagged, then save again";
            case "conflict": return "Conflicts — choose which changes to keep";
        }
    },
    issues: ({ n, count }) => `${count} ${plural(n, "issue", "issues")}`,
    issuesTip: ({ n, count }) => `${count} ${plural(n, "issue", "issues")} · Go to first issue`,
    undo: () => "Undo",
    undoTip: () => "Undo · Ctrl+Z / ⌘Z",
    redo: () => "Redo",
    redoTip: () => "Redo · Ctrl+Shift+Z / ⌘⇧Z",
    discard: () => "Discard",
    discardTip: () => "Discard changes",
    retryRefresh: () => "Retry refresh",
    retryRequest: () => "Retry request",
    apply: () => "Save",
    applyNoRevision: () => "Saved, but it could not be confirmed — reload to see the newest",
    applySettleFirst: ({ n, count }) => `Choose ${count} ${plural(n, "conflict", "conflicts")} to save`,
    conflicts: ({ n, count }) => `${count} ${plural(n, "conflict", "conflicts")}`,
    conflictsTip: ({ n, count }) => `${count} ${plural(n, "conflict", "conflicts")} · Choose which changes to keep`,
    conflictsHead: ({ count }) => `Conflicts · ${count}`,
    conflictsTitle: () => "Conflicts",
    conflictsLockedTip: ({ n, count }) => `${count} ${plural(n, "conflict", "conflicts")} · Choices are off while the optimiser runs`,
    conflictShowAll: () => "Show all",
    conflictShowLess: () => "Show less",
    conflictsIntro: () => "Someone else changed these while you were editing. Choose which version to keep. Save is off until every one is chosen.",
    conflictsSettled: ({ n, count }) => (n === 1 ? "The conflict is chosen. Save is on." : `All ${count} conflicts chosen. Save is on.`),
    conflictsSettledNothing: ({ n, count }) => (n === 1 ? "The conflict is chosen. Nothing is left to save." : `All ${count} conflicts chosen. Nothing is left to save.`),
    conflictsAppeared: ({ n, count }) => `${count} of your ${plural(n, "changes conflicts", "changes conflict")} with newer changes. Save is off until you choose.`,
    conflictsKeepAll: () => "Keep all mine",
    conflictsTakeAll: () => "Use all theirs",
    conflictYours: () => "Yours",
    conflictTheirs: () => "Theirs",
    conflictWas: ({ value }) => `was ${value}`,
    conflictChangedSince: () => "Changed since you started editing",
    conflictGoTo: () => "Go to",
    conflictDates: () => "Dates",
    issueConflict: () => "Someone else changed this too — choose which version to keep",
    bannerUnkept: ({ reason }) => (reason === "full" ? "A reload would lose these changes: this tab's storage is full. Save them soon."
        : reason === "unavailable" ? "A reload would lose these changes: this browser keeps nothing for this tab. Save them soon."
        : "A reload would lose these changes: they could not be kept. Save them soon."),
    bannerLost: ({ reason }) => (reason === "schema" ? "Changes from before the reload could not be restored: the data's shape has changed since."
        : "Changes from before the reload could not be restored."),
    bannerConflicts: ({ n, count }) => `${count} of your ${plural(n, "changes conflicts", "changes conflict")} with newer changes`,
    bannerWord: ({ kind }) => ({ conflict: "Conflict", rejected: "Rejected", unconfirmed: "Unconfirmed", stale: "Out of date", unkept: "Not kept" })[kind],
    conflictsChoose: () => "Choose",
    conflictsLocked: () => "Choices are off while the optimiser runs",
    conflictKept: ({ value }) => `kept yours: ${value}`,
    conflictTaken: ({ value }) => `used theirs: ${value}`,
    conflictRemoved: () => "Removed",
    conflictCleared: () => "Cleared",
    conflictEmpty: () => "Empty",
    conflictNone: () => "None",
    conflictYes: () => "Yes",
    conflictNo: () => "No",
    conflictItem: ({ count }) => `Item ${count}`,
    conflictItems: ({ n, count }) => `${count} ${plural(n, "item", "items")}`,
    conflictEntries: ({ n, count }) => `${count} ${plural(n, "entry", "entries")}`,
    conflictNumbers: ({ n, count }) => `${count} ${plural(n, "number", "numbers")}`,
    conflictGrid: ({ rows, cols }) => `${rows} × ${cols} grid`,
    conflictTree: () => "Tree",
    conflictFile: ({ size }) => `File · ${size} bytes`,
    issueInvalid: ({ value }) => `Invalid input: ${value}`,
    issueRequired: () => "A value is required",
    issueChanged: () => "Changed since this edit began",
    issueSourceChanged: () => "Someone else changed this since you started editing",
    bannerConflict: ({ n, count }) => `Not saved — ${count} ${plural(n, "conflict", "conflicts")} with newer changes`,
    bannerRejected: () => "These changes weren't saved",
    bannerUnknown: () => "No answer — your changes may have been saved",
    bannerConfirmFailed: () => "Saved — the result could not be read back",
    bannerStale: () => "Someone else saved this while you were editing, and your changes can't be combined with theirs. Discard them to go on.",
    bannerIssue: ({ where, message }) => (where === "" ? message : `${where}: ${message}`),
    bannerMore: ({ n, count }) => `and ${count} more ${plural(n, "issue", "issues")}`,
    bannerSource: ({ source, title }) => `${source}: ${title}`,
};

/** The words an editing surface speaks: a table carrying the editing messages, and its locale's formatters. */
export interface EditingWords extends Formatters {
    /** The message table in effect. */
    m: EditingMessages;
}

/**
 * The renderer's own draft issues, in their canonical English — the text the
 * patch events carry to the host, read back where they show.
 */
export const DRAFT_ISSUE_TEXT = {
    required: editingMessages.issueRequired(),
    invalid: (value: string): string => editingMessages.issueInvalid({ value }),
} as const;

/**
 * The editing session's own text, in its canonical English — its error, which
 * the history bar shows in the surface's words, and the issues it names a
 * conflict's entries with where the source gave no words of its own (#1199),
 * read back where they show as the draft issues are.
 */
export const SESSION_TEXT = {
    noRevision: editingMessages.applyNoRevision(),
    changed: editingMessages.issueChanged(),
    sourceChanged: editingMessages.issueSourceChanged(),
    conflict: editingMessages.issueConflict(),
} as const;

/**
 * The session's error as the history bar shows it: its own, in the surface's
 * words; a host's or a source's, as written.
 *
 * @param error - The session's error
 * @param w - The words
 * @returns The text to show
 */
export function sessionErrorText(error: string, w: EditingWords): string {
    return error === SESSION_TEXT.noRevision ? w.m.applyNoRevision() : error;
}
