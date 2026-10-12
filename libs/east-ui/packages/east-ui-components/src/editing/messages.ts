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
export type EditHistoryWord = "stale" | "applying" | "unknown" | "reconciling" | "rejected" | "conflict";

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
    /** A field whose text could not be read. */
    issueInvalid: (p: { value: string }) => string;
    /** A draft field with no value. */
    issueRequired: () => string;
    /** An entry a Save's conflict names, which the session read changed, where its source gave no words for it (#1199). */
    issueChanged: () => string;
    /** A Save's conflict where the session read no entry changed, and its source said nothing of itself (#1199). */
    issueSourceChanged: () => string;
    /** The banner over a Save the source found conflicts in — `Save stopped — 2 conflicts with the source`. */
    bannerConflict: (p: { n: number; count: string }) => string;
    /** The banner over a Save the source refused. */
    bannerRejected: () => string;
    /** The banner over a write with no answer. */
    bannerUnknown: () => string;
    /** The banner over a Save whose result could not be read back. */
    bannerConfirmFailed: () => string;
    /** The banner over drafts the source moved under. */
    bannerStale: () => string;
    /** One of a Save's issues in its banner — `J-0002: Changed since this edit began`; `where` is empty for the source as a whole. */
    bannerIssue: (p: { where: string; message: string }) => string;
    /** The issues a banner leaves out — `and 4 more`. */
    bannerMore: (p: { n: number; count: string }) => string;
    /** A banner's title naming the source it reports on, where a history holds several (#1194) — `Print job: Save stopped — 1 conflict with the source`. */
    bannerSource: (p: { source: string; title: string }) => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The English table — the default every collection's table spreads. */
export const editingMessages: EditingMessages = {
    historyStatus: ({ status }) => {
        switch (status) {
            case "stale": return "Source changed — review or discard these drafts";
            case "applying": return "Saving…";
            case "unknown": return "Awaiting confirmation — retry the same request";
            case "reconciling": return "Saved — loading the confirmed revision…";
            case "rejected": return "Changes rejected — revise the draft before saving";
            case "conflict": return "Source conflict — review or discard these drafts";
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
    applyNoRevision: () => "The source saved the batch without its committed revision; recover this request before continuing",
    issueInvalid: ({ value }) => `Invalid input: ${value}`,
    issueRequired: () => "A value is required",
    issueChanged: () => "Changed since this edit began",
    issueSourceChanged: () => "The source changed since this edit began",
    bannerConflict: ({ n, count }) => `Save stopped — ${count} ${plural(n, "conflict", "conflicts")} with the source`,
    bannerRejected: () => "The source refused these changes",
    bannerUnknown: () => "No answer from the source — the changes may have been saved",
    bannerConfirmFailed: () => "Saved — the result could not be read back",
    bannerStale: () => "The source changed under these drafts — Save is off, and nothing is rebased",
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
