/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's words in its locale (#861) — the message table in effect
 * (`messages.ts`) and the number and date formatters its parameters are
 * filled from: the shared format module's (#850), so the Sheet prints numbers
 * exactly as every other component in the app does. The Plan's `words.ts`
 * twin.
 *
 * Two kinds of text reach the screen from outside React, and both are
 * resolved here, at render, so what is stored never knows a locale:
 *
 * - **The message a gesture leaves** — the reducer's {@link SheetNotice}: a
 *   message's id and its parameters, counts raw. {@link noticeText} words it.
 * - **The renderer's own readiness issues** — a draft field with no value, a
 *   text that could not be read, an author check that failed. They cross the
 *   wire to the host in the patch events, where their text is canonical
 *   English (stable, whatever the viewer reads), so the display reads them
 *   back ({@link issueText}) and words them in the table's language. An
 *   author's own issue is the author's text, and shows as written.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { formatters, useFormatters, type Formatters } from "../../format/index.js";
import { sheetMessages, useSheetMessages, type SheetMessages } from "./messages.js";
import type { SheetNotice, SheetRowRef } from "./sheet-types.js";

/** The Sheet's words: its message table, and its locale's formatters. */
export interface SheetWords extends Formatters {
    /** The message table in effect. */
    m: SheetMessages;
}

/**
 * Build the words for a locale and a message table.
 *
 * @param locale - The BCP 47 locale
 * @param m - The message table
 * @returns The words
 */
export function sheetWords(locale: string, m: SheetMessages): SheetWords {
    return { ...formatters(locale), m };
}

/** The words a sheet speaks with no provider above it: English, in `en-US`. */
export const SHEET_WORDS: SheetWords = sheetWords("en-US", sheetMessages);

/**
 * The sheet's words — its locale (react-aria's `useLocale`, through the
 * shared formatters) and the message table in effect
 * (`SheetMessagesProvider`), one object per change of either.
 *
 * @returns The words
 */
export function useSheetWords(): SheetWords {
    const f = useFormatters();
    const m = useSheetMessages();
    return useMemo(() => ({ ...f, m }), [f, m]);
}

/**
 * A row, in words — `row 4`, or on a grouped sheet `line 3 of Line 2 week 8`.
 *
 * @param ref - The row
 * @param w - The words
 * @returns The text
 */
export function rowRefText(ref: SheetRowRef, w: SheetWords): string {
    return ref.line
        ? w.m.rowRef({ line: true, number: String(ref.number), title: ref.title, noun: ref.noun ?? w.m.groupNoun() })
        : w.m.rowRef({ line: false, number: String(ref.number), title: undefined, noun: w.m.groupNoun() });
}

/**
 * The footer's line for the message a gesture left.
 *
 * @param notice - The message
 * @param w - The words
 * @returns The text
 */
export function noticeText(notice: SheetNotice, w: SheetWords): string {
    const { m } = w;
    const noun = (x: string | undefined) => x ?? m.groupNoun();
    const nouns = (x: string | undefined) => x ?? m.groupNouns();
    switch (notice.id) {
        case "groupOpened": return m.noticeGroupOpened({ noun: noun(notice.noun) });
        case "groupFolded": return m.noticeGroupFolded({ noun: noun(notice.noun) });
        case "groupsOpened":
        case "groupsFolded": {
            const groups = m.countNoun({ n: notice.n, count: w.number(notice.n), noun: noun(notice.noun), nouns: nouns(notice.nouns) });
            return notice.id === "groupsOpened" ? m.noticeGroupsOpened({ groups }) : m.noticeGroupsFolded({ groups });
        }
        case "subRowsShownAll": return m.noticeSubRowsShownAll({ n: notice.n, count: w.number(notice.n), noun: noun(notice.noun) });
        case "subRowsHidAll": return m.noticeSubRowsHidAll({ noun: noun(notice.noun) });
        case "subRowsShown": return m.noticeSubRowsShown({ n: notice.n, count: w.number(notice.n) });
        case "subRowsHid": return m.noticeSubRowsHid();
        case "membersAdded": return m.noticeMembersAdded({ n: notice.n, count: w.number(notice.n) });
        case "membersRemoved": return m.noticeMembersRemoved({ n: notice.n, count: w.number(notice.n) });
        case "predictedTaken": return m.noticePredictedTaken({ n: notice.n, count: w.number(notice.n) });
        case "lockedHalf": return m.noticeLockedHalf({ driver: notice.driver ?? m.thisRow() });
        case "rowLeft": return m.noticeRowLeft();
        case "tabSaved": return m.noticeTabSaved({ name: notice.name, query: notice.query });
        case "tabClosed": return m.noticeTabClosed({ name: notice.name, active: notice.active });
        case "tabUpdated": return m.noticeTabUpdated({ name: notice.name });
        case "tabReverted": return m.noticeTabReverted();
        case "fillTaken": return m.noticeFillTaken({ column: notice.column, meta: notice.meta });
        case "rowFilled": return m.noticeRowFilled({ n: notice.n, count: w.number(notice.n), row: rowRefText(notice.row, w) });
        case "proposalTaken": return m.noticeProposalTaken({ label: notice.label, more: notice.more });
        case "proposalRejected": return m.noticeProposalRejected({ to: notice.to, from: notice.from });
        case "fillDismissed": return m.noticeFillDismissed({ column: notice.column });
        case "proposalDeselected": return m.noticeProposalDeselected();
        case "rowFillDismissed": return m.noticeRowFillDismissed();
        case "deleted": return m.noticeDeleted({
            n: notice.n, count: w.number(notice.n), what: notice.what, noun: noun(notice.noun), nouns: nouns(notice.nouns), again: notice.again,
        });
        case "pasted": return m.noticePasted({ rows: w.number(notice.rows), cols: w.number(notice.cols), n: notice.skipped, skipped: w.number(notice.skipped) });
        case "copied": return m.noticeCopied({ rows: w.number(notice.rows), cols: w.number(notice.cols) });
        case "discarded": return m.noticeDiscarded();
        case "newRow": return m.noticeNewRow();
        case "newGroup": return m.noticeNewGroup({ noun: noun(notice.noun) });
        case "issue": return m.issueAt({ where: notice.where, message: issueText(notice.message, w) });
        case "text": return notice.text;
    }
}

/**
 * The renderer's own readiness issues, in their canonical English — the text
 * the patch events carry to the host. Built here and read back here
 * ({@link issueText}), so the two never drift.
 */
export const ISSUE_TEXT = {
    required: sheetMessages.issueRequired(),
    invalid: (value: string): string => sheetMessages.issueInvalid({ value }),
    author: (state: string): string => sheetMessages.issueAuthor({ state }),
    rowCheck: (reason: string): string => sheetMessages.issueRowCheck({ reason }),
    groupCheck: (reason: string): string => sheetMessages.issueGroupCheck({ reason }),
} as const;

/**
 * The editing session's own error text, in its canonical English — what the
 * session holds; the history bar shows it in the sheet's words.
 */
export const SESSION_TEXT = {
    noRevision: sheetMessages.applyNoRevision(),
} as const;

/**
 * The session's error as the history bar shows it: its own, in the sheet's
 * words; a host's or a source's, as written.
 *
 * @param error - The session's error
 * @param w - The words
 * @returns The text to show
 */
export function sessionErrorText(error: string, w: SheetWords): string {
    return error === SESSION_TEXT.noRevision ? w.m.applyNoRevision() : error;
}

/** The canonical forms' fixed heads, to read an issue back by. */
const INVALID_HEAD = ISSUE_TEXT.invalid("");
const AUTHOR_HEAD = ISSUE_TEXT.author("");
const ROW_CHECK_HEAD = ISSUE_TEXT.rowCheck("");
const GROUP_CHECK_HEAD = ISSUE_TEXT.groupCheck("");

/**
 * An issue's text as the sheet shows it: the renderer's own issue, read back
 * from its canonical form ({@link ISSUE_TEXT}) and worded in the table's
 * language; any other issue — an author's — as written.
 *
 * @param message - The issue's text, as the readiness carries it
 * @param w - The words
 * @returns The text to show
 */
export function issueText(message: string, w: SheetWords): string {
    const { m } = w;
    if (message === ISSUE_TEXT.required) return m.issueRequired();
    if (message.startsWith(INVALID_HEAD)) return m.issueInvalid({ value: message.slice(INVALID_HEAD.length) });
    if (message.startsWith(AUTHOR_HEAD)) return m.issueAuthor({ state: message.slice(AUTHOR_HEAD.length) });
    if (message.startsWith(ROW_CHECK_HEAD)) return m.issueRowCheck({ reason: message.slice(ROW_CHECK_HEAD.length) });
    if (message.startsWith(GROUP_CHECK_HEAD)) return m.issueGroupCheck({ reason: message.slice(GROUP_CHECK_HEAD.length) });
    return message;
}
