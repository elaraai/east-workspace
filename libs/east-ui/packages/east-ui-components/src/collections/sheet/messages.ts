/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the Sheet says itself (#861) — ONE typed message table, the
 * Plan's #820 table's twin. The toolbar and the view tabs, the header, the
 * rows, bands and gap pills, the strip, the editor and the link cells, the
 * footer and the history bar, the insertion chips, the message each gesture
 * leaves, and the words it gives a reader for what it shows only by look all
 * come from here. What the AUTHOR wrote — a column's header, a group's noun,
 * a register's labels, a lock's tag, a footer item — is data, and never
 * passes through it; neither does what an input GRAMMAR reads (the date and
 * link grammars keep their forms).
 *
 * Each message is a function of named parameters, so a translation can put
 * them where its grammar wants them and choose its own plural forms. Numbers
 * arrive already formatted for the sheet's locale (the shared formatters,
 * #850); `n` is the raw count beside a formatted `count`, for plural rules. A
 * row's number is its identifier and arrives as written.
 *
 * English is the default. A host overrides any subset for a subtree with
 * {@link SheetMessagesProvider}; the locale numbers format in comes from
 * react-aria's `I18nProvider` above the app (the browser's otherwise).
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { editingMessages, type EditHistoryWord, type EditingMessages } from "../../editing/messages.js";
import { pluralKind } from "./link/grammar.js";

/** A date column's level, as the words name it (#844). */
export type SheetLevelWord = "week" | "day" | "range" | "time";

/** Which half of a link cell. */
export type SheetHalfWord = "from" | "to";

/** Where an actual instant stands against the wanted date (#844). */
export type SheetToneWord = "on" | "late" | "early";

/** The history bar's states that say something — the shared editing session's (#879). */
export type SheetHistoryWord = EditHistoryWord;

/** What a view narrows by, as its hover title names it (B§8). */
export type SheetScopeWord = "query" | "range" | "filter" | "none";

/** How the arity half's named members stand against the implied count (B§4.6). */
export type SheetArityWord = "short" | "exact" | "over";

/**
 * The Sheet's message table — its own words, and the editing session's
 * ({@link EditingMessages}, #879: the history bar and the draft issues), so a
 * host translates the sheet's history bar where it translates the sheet.
 *
 * @remarks
 * Parameters named `count`, `from`, `to`, `total`, `loaded`, `rows`, `cols`,
 * `skipped`, `page` and `pages` are numbers already formatted for the locale;
 * `n` is the raw number beside them, for plural rules. `number` is a row's
 * number, as written. `noun` / `nouns` are the host's words for a group
 * (#844), `header` a column's header, `name` a view's name — the author's.
 */
export interface SheetMessages extends EditingMessages {
    // ── Counting ───────────────────────────────────────────────────────────
    /** A count of the host's groups — `3 plans`. */
    countNoun: (p: { n: number; count: string; noun: string; nouns: string }) => string;
    /** The word for a group when the sheet declares none. */
    groupNoun: () => string;
    /** Its plural. */
    groupNouns: () => string;

    // ── The toolbar (§7) ───────────────────────────────────────────────────
    /** The context switch's accessible name. */
    contextSwitch: () => string;
    /** The context switch's label. */
    contextLabel: () => string;
    /** A context option — `none`, `±1`. */
    contextOption: (p: { n: number; count: string }) => string;
    /** The lens's count line — `3 matches · 2 context`. */
    lensCount: (p: { n: number; count: string; context: string | undefined }) => string;
    /** The badge on a paged sheet's narrowing chrome, which sees only the loaded rows. */
    scopeBadge: () => string;

    // ── The view tabs (B§8) ────────────────────────────────────────────────
    /** The tablist's accessible name. */
    tabList: () => string;
    /** The whole-sheet tab. */
    tabAll: () => string;
    /** The whole-sheet tab's hover title. */
    tabAllTitle: () => string;
    /** A view's hover title: what it narrows by, and the gestures it takes. */
    viewTitle: (p: { scope: SheetScopeWord; query: string; context: string | undefined }) => string;
    /** A new view's name when there is no query to name it from — stored with the view. */
    viewName: (p: { seq: string }) => string;
    /** The rename box's accessible name. */
    tabRename: () => string;
    /** The dirty dot's title. */
    tabDirty: () => string;
    /** A tab's close control. */
    tabClose: () => string;
    /** The folded tabs' menu button — `+2`. */
    tabMore: (p: { n: number; count: string }) => string;
    /** The same button's accessible name. */
    tabMoreName: (p: { n: number; count: string }) => string;
    /** The same button's title. */
    tabMoreTitle: () => string;
    /** `+ tab`'s label. */
    tabAdd: () => string;
    /** `+ tab`'s accessible name. */
    tabAddName: () => string;
    /** `+ tab`'s title — with a query set, or without one. */
    tabAddTitle: (p: { query: boolean }) => string;

    // ── The history bar and the draft issues: the editing session's
    // (`EditingMessages`) ────────────────────────────────────────────────────

    // ── The header ─────────────────────────────────────────────────────────
    /** The row numbers' column head. */
    headerNumber: () => string;
    /** The fold-all's accessible name — `Fold 3 plans`. */
    foldAll: (p: { folded: boolean; groups: string }) => string;
    /** The fold-all's title. */
    foldAllTitle: (p: { folded: boolean; groups: string; noun: string }) => string;
    /** The band title's column, where a column names it (the strip, a band cell's title). */
    titleColumn: () => string;

    // ── Rows ───────────────────────────────────────────────────────────────
    /** A row's name — its gutter's accessible name. */
    rowName: (p: { number: string }) => string;
    /** A line's name in its group. */
    lineName: (p: { number: string; group: string }) => string;
    /** A row's gutter title — with the copilot's fill waiting on it, or not. */
    rowTitle: (p: { fills: boolean }) => string;
    /** A row's checkbox. */
    selectRow: (p: { number: string; group: string | undefined }) => string;
    /** A line's sub-row chevron's accessible name. */
    subRows: (p: { open: boolean; n: number; count: string; line: string }) => string;
    /** Its title. */
    subRowsTitle: (p: { open: boolean; n: number; count: string; noun: string }) => string;
    /** The gutter's fill button. */
    fillRow: () => string;
    /** Its title. */
    fillRowTitle: () => string;
    /** A new row's discard button. */
    discardRow: () => string;
    /** A fill's take button. */
    take: (p: { header: string }) => string;
    /** Its title — the fill's provenance, when it has one. */
    takeTitle: (p: { meta: string | undefined }) => string;
    /** A suggested row's name. */
    proposalName: (p: { number: string }) => string;
    /** Its gutter title. */
    proposalTitle: () => string;
    /** Its checkbox. */
    proposalSelect: () => string;
    /** Its add button. */
    proposalAccept: () => string;
    /** The add button's title. */
    proposalAcceptTitle: () => string;
    /** Its reject button. */
    proposalReject: () => string;
    /** The reject button's title. */
    proposalRejectTitle: () => string;
    /** An author check that reported a state without saying why. */
    issueAuthor: (p: { state: string }) => string;
    /** A row check that threw. */
    issueRowCheck: (p: { reason: string }) => string;
    /** A group check that threw. */
    issueGroupCheck: (p: { reason: string }) => string;
    /** The footer's line for an issue the history bar went to. */
    issueAt: (p: { where: string; message: string }) => string;

    // ── Bands, gaps, failures ──────────────────────────────────────────────
    /** An unloaded run's pill. */
    bandUnloaded: (p: { n: number; count: string; loading: boolean }) => string;
    /** A failed read's retry. */
    retry: () => string;
    /** A window whose read failed (#853). */
    windowFailed: (p: { from: string; to: string; reason: string }) => string;
    /** A row that threw as it drew. */
    rowFailed: (p: { number: string; reason: string }) => string;
    /** A paged source that failed before anything landed. */
    noSource: (p: { reason: string }) => string;
    /** How far a gap control reaches — `+3`. */
    gapMore: (p: { n: number; count: string }) => string;
    /** The gap's top control. */
    gapAfter: (p: { n: number; count: string; row: string }) => string;
    /** Its title. */
    gapAfterTitle: (p: { row: string }) => string;
    /** The gap's bottom control. */
    gapBefore: (p: { n: number; count: string; row: string }) => string;
    /** Its title. */
    gapBeforeTitle: (p: { row: string }) => string;
    /** The gap's count — `12 hidden`. */
    gapHidden: (p: { n: number; count: string }) => string;
    /** The count's title. */
    gapHiddenTitle: () => string;
    /** The gap's show-everything control. */
    gapAll: () => string;
    /** Its accessible name and title. */
    gapAllName: () => string;

    // ── Grouped rows (#740) ────────────────────────────────────────────────
    /** A band's rowheader — `plan 2, 5 lines`. */
    groupName: (p: { noun: string; number: string; n: number; count: string }) => string;
    /** Its gutter title. */
    groupTitle: (p: { noun: string }) => string;
    /** Its checkbox. */
    groupSelect: (p: { noun: string; title: string }) => string;
    /** A new group's discard button. */
    groupDiscard: (p: { noun: string }) => string;
    /** Its chevron's accessible name. */
    groupFold: (p: { folded: boolean; noun: string }) => string;
    /** Its chevron's title. */
    groupFoldTitle: (p: { folded: boolean }) => string;
    /** A group with no title. */
    untitled: () => string;
    /** A band cell's title — its column's header and its value. */
    bandCellTitle: (p: { header: string; value: string }) => string;

    // ── Insertion ──────────────────────────────────────────────────────────
    /** The insertion chips' group. */
    insertHere: () => string;
    /** The row chip's accessible name — a line on a grouped sheet. */
    insertRow: (p: { ordered: boolean; line: boolean }) => string;
    /** Its title. */
    insertRowTitle: (p: { ordered: boolean; line: boolean }) => string;
    /** The group chip's accessible name. */
    insertGroup: (p: { ordered: boolean; noun: string }) => string;
    /** Its title. */
    insertGroupTitle: (p: { ordered: boolean; noun: string }) => string;
    /** The insertion strip's group. */
    insertStrip: () => string;
    /** Insert above the selection. */
    insertAbove: () => string;
    /** Insert below it — or add one, in key order. */
    insertBelow: (p: { ordered: boolean }) => string;
    /** A new group. */
    insertNewGroup: (p: { noun: string }) => string;

    // ── The footer (B§9) ───────────────────────────────────────────────────
    /** A grouped sheet's count line — `3 plans · 14 lines`, and `· 2 loose rows` when rows stand between the groups (#846). */
    summary: (p: { groups: string; n: number; lines: string; nLoose: number; loose: string; nSub: number; subRows: string }) => string;
    /** The transport line — `600 loaded of 1,000`. */
    transport: (p: { loaded: string; total: string | undefined }) => string;
    /** The same line while a window is on its way. */
    transportLoading: (p: { line: string }) => string;
    /** The transport line's failure (#853). */
    transportFailed: (p: { reason: string }) => string;
    /** The key hint — a selected suggestion. */
    hintProposal: () => string;
    /** The key hint — the ring on a band. */
    hintBand: (p: { noun: string }) => string;
    /** The key hint — the ring on a line with sub rows. */
    hintSubRows: (p: { open: boolean; n: number; count: string; noun: string }) => string;
    /** The key hint — whole rows selected. */
    hintRows: (p: { n: number; count: string }) => string;
    /** The key hint — fills waiting. */
    hintFills: () => string;
    /** The key hint — suggested rows waiting. */
    hintSuggestedRows: () => string;
    /** The key hint. */
    hintDefault: () => string;

    // ── The strip (B§9) ────────────────────────────────────────────────────
    /** What an empty field accepts — `START · accepts`. */
    stripAccepts: (p: { header: string }) => string;
    /** A link column's label, naming the half. */
    stripHalf: (p: { header: string; half: SheetHalfWord | undefined }) => string;
    /** The predicted members' label. */
    stripPredicted: (p: { header: string }) => string;
    /** The armed candidate's label — `⌥]` when there are others to step to. */
    stripArmed: (p: { header: string; many: boolean }) => string;
    /** The pending suggestions' label. */
    stripSuggested: () => string;
    /** A typed text no register member matches. */
    stripNoMatch: () => string;
    /** What a date field accepts. */
    stripDate: () => string;
    /** Its form. */
    stripDateForm: () => string;
    /** A date not yet whole. */
    stripIncomplete: () => string;
    /** What a number field accepts. */
    stripNumber: (p: { unit: boolean }) => string;
    /** A text that could not be read. */
    stripUnrecognised: () => string;
    /** What a custom column accepts when it says nothing. */
    stripValue: () => string;
    /** The days between the base column's date and this one. */
    stripDays: (p: { n: number; count: string }) => string;
    /** A predicted member's title. */
    stripAdd: (p: { label: string }) => string;
    /** The suggested rows chip — `+2 rows`. */
    stripRows: (p: { n: number; count: string }) => string;
    /** The pending rows' header. */
    stripRowsHeader: () => string;
    /** A provider still thinking. */
    stripPending: (p: { header: string }) => string;
    /** Its title. */
    stripPendingTitle: (p: { header: string }) => string;
    /** The keys — a text kept as typed. */
    stripKeysTyped: () => string;
    /** The keys — a menu with nothing armed. */
    stripKeysFilter: () => string;
    /** The keys — the armed candidate. */
    stripKeysTake: (p: { many: boolean; index: string; total: string }) => string;
    /** The keys — an empty date field. */
    stripKeysDateEmpty: () => string;
    /** The keys — an incomplete date. */
    stripKeysDate: () => string;
    /** The keys — a value to commit. */
    stripKeysCommit: () => string;
    /** The keys — a number field. */
    stripKeysStep: () => string;
    /** The keys — a custom column. */
    stripKeysParse: () => string;
    /** The keys — predicted members. */
    stripKeysPredicted: () => string;
    /** The keys — a link's armed candidate. */
    stripKeysLinkTake: (p: { many: boolean; index: string; total: string; single: boolean }) => string;
    /** The keys — a link half with nothing to offer. */
    stripKeysLinkAdd: (p: { single: boolean }) => string;
    /** The keys — the pending suggestions. */
    stripKeysSuggested: () => string;
    /** The keys — a resting cell's detail. */
    stripKeysDetail: (p: { date: boolean }) => string;
    /** The pager's title. */
    stripPager: (p: { n: number; count: string; page: string; pages: string }) => string;
    /** The pager's page — `1/3`. */
    stripPage: (p: { page: string; pages: string }) => string;
    /** The pager's back button. */
    stripPrevious: () => string;
    /** The pager's forward button. */
    stripNext: () => string;

    // ── The editor (B§4.4) ─────────────────────────────────────────────────
    /** An enum's list with nothing in it. */
    editorNoOptions: () => string;
    /** A date's time box. */
    editorTime: () => string;
    /** Its placeholder. */
    editorTimePlaceholder: () => string;
    /** A locked half's warning, in the editor. */
    editorLocked: (p: { half: SheetHalfWord }) => string;
    /** The register editor's badge over its candidates — `2/5`. */
    editorBadge: (p: { index: string; total: string }) => string;

    // ── Links (B§4) ────────────────────────────────────────────────────────
    /** An empty live half's label. */
    halfLabel: (p: { half: SheetHalfWord }) => string;
    /** A live half's title. */
    halfTitle: (p: { half: SheetHalfWord }) => string;
    /** A locked half's title — `Machining has no source · in place`. */
    halfNone: (p: { driver: string; half: SheetHalfWord; lock: string | undefined }) => string;
    /** The row whose driver says nothing, in a message about it. */
    thisRow: () => string;
    /** A counted member's count in the kind it resolves to — `4 machines`. */
    countedMembers: (p: { n: number; count: string; kind: string | undefined }) => string;
    /** A counted member names no one in particular. */
    unassigned: () => string;
    /** A range's span — `6 machines`. */
    rangeSpan: (p: { n: number; count: string; kind: string | undefined }) => string;
    /** A range candidate's meta — `→ 6 machines: M2140, …`. */
    candidateRange: (p: { n: number; count: string; kind: string; names: string }) => string;
    /** The enumerate alternative's meta. */
    candidateEnumerate: (p: { n: number; count: string }) => string;
    /** The placeholder candidate's meta. */
    candidateTbc: () => string;
    /** The predicted counted member's enumerate alternative. */
    enumerateInstead: () => string;
    /** A kind that resolves by code, in the grammar line. */
    grammarCode: (p: { kind: string }) => string;
    /** The counted form, in the grammar line. */
    grammarCounted: () => string;
    /** A range, in the grammar line. */
    grammarRange: () => string;
    /** The arity line (B§4.6) — `4 × CNC lathe implied · 3 named so far`. */
    arity: (p: { count: string; key: string; named: string; state: SheetArityWord }) => string;
    /** The `exists` check's flag. */
    notInRegister: (p: { key: string }) => string;

    // ── Dates at a level (#844) ────────────────────────────────────────────
    /** A level's tag beside the date. */
    whenTag: (p: { level: SheetLevelWord }) => string;
    /** What a level accepts. */
    whenAccepts: (p: { level: SheetLevelWord }) => string;
    /** The forms it takes. */
    whenAcceptsForms: (p: { level: SheetLevelWord }) => string;
    /** An actual instant's tag — `+2d`, `−3h`, or on time. */
    actualTag: (p: { tone: SheetToneWord; n: number; count: string; unit: "d" | "h" }) => string;
    /** The same in words — `3 hours late`. */
    actualWords: (p: { tone: SheetToneWord; n: number; count: string; unit: "d" | "h" }) => string;
    /** When the work happened. */
    detailHappened: (p: { when: string }) => string;
    /** A date that has happened with nothing wanted. */
    detailNoWanted: () => string;
    /** Its title. */
    detailHappenedTitle: (p: { when: string }) => string;
    /** The wanted date. */
    detailWanted: (p: { text: string; tag: string }) => string;
    /** The title of a date that has happened against a wanted one. */
    detailTitle: (p: { when: string; text: string; tag: string; words: string }) => string;

    // ── What each gesture leaves (the footer's message) ────────────────────
    /** A row, as a message names it — `row 4`, `line 3 of Line 2 week 8`. */
    rowRef: (p: { line: boolean; number: string; title: string | undefined; noun: string }) => string;
    /** A group opened. */
    noticeGroupOpened: (p: { noun: string }) => string;
    /** A group folded. */
    noticeGroupFolded: (p: { noun: string }) => string;
    /** Every group opened. */
    noticeGroupsOpened: (p: { groups: string }) => string;
    /** Every group folded. */
    noticeGroupsFolded: (p: { groups: string }) => string;
    /** Every line's sub rows shown. */
    noticeSubRowsShownAll: (p: { n: number; count: string; noun: string }) => string;
    /** Every line's sub rows hidden. */
    noticeSubRowsHidAll: (p: { noun: string }) => string;
    /** A line's sub rows shown. */
    noticeSubRowsShown: (p: { n: number; count: string }) => string;
    /** A line's sub rows hidden. */
    noticeSubRowsHid: () => string;
    /** Members added to a link half. */
    noticeMembersAdded: (p: { n: number; count: string }) => string;
    /** Members removed from a link half. */
    noticeMembersRemoved: (p: { n: number; count: string }) => string;
    /** Predicted members taken. */
    noticePredictedTaken: (p: { n: number; count: string }) => string;
    /** A hop into a locked half. */
    noticeLockedHalf: (p: { driver: string }) => string;
    /** An editor whose row left the sheet closed (#877). */
    noticeRowLeft: () => string;
    /** A view saved — with a query, or without one. */
    noticeTabSaved: (p: { name: string; query: boolean }) => string;
    /** A view closed — the active one, or another. */
    noticeTabClosed: (p: { name: string; active: boolean }) => string;
    /** A view updated to the current search. */
    noticeTabUpdated: (p: { name: string }) => string;
    /** A view's search reverted. */
    noticeTabReverted: () => string;
    /** A fill taken. */
    noticeFillTaken: (p: { column: string; meta: string | undefined }) => string;
    /** A row filled. */
    noticeRowFilled: (p: { n: number; count: string; row: string }) => string;
    /** A suggested row taken. */
    noticeProposalTaken: (p: { label: string | undefined; more: boolean }) => string;
    /** A suggested row rejected. */
    noticeProposalRejected: (p: { to: string | undefined; from: string | undefined }) => string;
    /** A fill dismissed. */
    noticeFillDismissed: (p: { column: string }) => string;
    /** A selected suggestion let go. */
    noticeProposalDeselected: () => string;
    /** The row fill dismissed. */
    noticeRowFillDismissed: () => string;
    /** Rows, lines or groups deleted — `again`: the group is left empty, ⌫ again removes it. */
    noticeDeleted: (p: { n: number; count: string; what: "rows" | "lines" | "groups"; noun: string; nouns: string; again: boolean }) => string;
    /** A paste. */
    noticePasted: (p: { rows: string; cols: string; n: number; skipped: string }) => string;
    /** A copy. */
    noticeCopied: (p: { rows: string; cols: string }) => string;
    /** A new row discarded. */
    noticeDiscarded: () => string;
    /** A new row. */
    noticeNewRow: () => string;
    /** A new group. */
    noticeNewGroup: (p: { noun: string }) => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The English table — the default: the editing session's words, then the sheet's own. */
export const sheetMessages: SheetMessages = {
    ...editingMessages,
    countNoun: ({ n, count, noun, nouns }) => `${count} ${plural(n, noun, nouns)}`,
    groupNoun: () => "group",
    groupNouns: () => "groups",

    contextSwitch: () => "Context rows either side of a hit",
    contextLabel: () => "context",
    contextOption: ({ n, count }) => (n === 0 ? "none" : `±${count}`),
    lensCount: ({ n, count, context }) => `${count} ${plural(n, "match", "matches")}${context !== undefined ? ` · ${context} context` : ""}`,
    scopeBadge: () => "loaded rows only",

    tabList: () => "Views",
    tabAll: () => "All",
    tabAllTitle: () => "Every row — the whole sheet",
    viewTitle: ({ scope, query, context }) => {
        const what = scope === "query" ? `"${query}"${context !== undefined ? ` · ±${context}` : ""}`
            : scope === "range" ? "a date window"
                : scope === "filter" ? "a filter"
                    : "no filter — the whole sheet";
        return `${what} · live · double-click renames · middle-click closes`;
    },
    viewName: ({ seq }) => `view ${seq}`,
    tabRename: () => "Rename tab",
    tabDirty: () => "Unsaved query — ⏎ updates this tab · esc reverts",
    tabClose: () => "Close tab",
    tabMore: ({ count }) => `+${count}`,
    tabMoreName: ({ n, count }) => `${count} more ${plural(n, "view", "views")}`,
    tabMoreTitle: () => "More views",
    tabAdd: () => "tab",
    tabAddName: () => "New tab from this view",
    tabAddTitle: ({ query }) => (query
        ? "New tab from this search — query, context and expanded bands, evaluated live"
        : "New tab — no filter yet; search inside it and ⏎ to scope it"),

    headerNumber: () => "#",
    foldAll: ({ folded, groups }) => (folded ? `Open ${groups}` : `Fold ${groups}`),
    foldAllTitle: ({ folded, groups, noun }) => `${folded ? "Open" : "Fold"} ${groups} — ⌥ on a chevron, ⇧Space on a ${noun}`,
    titleColumn: () => "Title",

    rowName: ({ number }) => `Row ${number}`,
    lineName: ({ number, group }) => `Line ${number} of ${group}`,
    rowTitle: ({ fills }) => (fills ? "Click the number to select the row · the button fills it" : "Select whole row — delete removes it"),
    selectRow: ({ number, group }) => (group !== undefined ? `Select row ${number} in ${group}` : `Select row ${number}`),
    subRows: ({ open, n, count, line }) => `${open ? "Hide" : "Show"} the ${count} ${plural(n, "row", "rows")} under line ${line}`,
    subRowsTitle: ({ open, n, count, noun }) => `${open ? "Hide" : "Show"} the ${count} ${plural(n, "row", "rows")} under this line — Space · ⌥ every line in the ${noun}`,
    fillRow: () => "Fill this row",
    fillRowTitle: () => "Fill this row — ⌘⏎",
    discardRow: () => "Discard new row",
    take: ({ header }) => `Take ${header}`,
    takeTitle: ({ meta }) => `Take — ${meta ?? "suggested"}`,
    proposalName: ({ number }) => `Suggested row ${number}`,
    proposalTitle: () => "Suggested row — ✓ adds it, × rejects it",
    proposalSelect: () => "Select this suggested row",
    proposalAccept: () => "Add this suggested row",
    proposalAcceptTitle: () => "Add this row to the plan — ⏎",
    proposalReject: () => "Reject this suggestion",
    proposalRejectTitle: () => "Reject — not offered after this activity again — ⌫",
    issueAuthor: ({ state }) => `Author check reports ${state}`,
    issueRowCheck: ({ reason }) => `Row readiness failed: ${reason}`,
    issueGroupCheck: ({ reason }) => `Group readiness failed: ${reason}`,
    issueAt: ({ where, message }) => `${where}: ${message}`,

    bandUnloaded: ({ count, loading }) => `${count} ${loading ? "loading" : "not loaded"}`,
    retry: () => "Retry",
    windowFailed: ({ from, to, reason }) => `Elements ${from}–${to} could not be read — ${reason}`,
    rowFailed: ({ number, reason }) => `Row ${number} could not be drawn — ${reason}`,
    noSource: ({ reason }) => `NO ROWS — the paged source could not be read. ${reason} `,
    gapMore: ({ count }) => `+${count}`,
    gapAfter: ({ count, row }) => `Show ${count} more after row ${row}`,
    gapAfterTitle: ({ row }) => `Show the rows just after row ${row}`,
    gapBefore: ({ count, row }) => `Show ${count} more before row ${row}`,
    gapBeforeTitle: ({ row }) => `Show the rows just before row ${row}`,
    gapHidden: ({ count }) => `${count} hidden`,
    gapHiddenTitle: () => "Expand — each click reaches further",
    gapAll: () => "all",
    gapAllName: () => "Show every hidden row",

    groupName: ({ noun, number, n, count }) => `${noun} ${number}, ${count} ${plural(n, "line", "lines")}`,
    groupTitle: ({ noun }) => `Select the ${noun}'s lines — delete removes them`,
    groupSelect: ({ noun, title }) => `Select ${noun} ${title}`,
    groupDiscard: ({ noun }) => `Discard new ${noun}`,
    groupFold: ({ folded, noun }) => (folded ? `Open the ${noun}` : `Fold the ${noun}`),
    groupFoldTitle: ({ folded }) => (folded ? "Open — Space · ⌥ opens all" : "Fold — Space · ⌥ folds all"),
    untitled: () => "Untitled",
    bandCellTitle: ({ header, value }) => `${header} — ${value}`,

    insertHere: () => "Insert here",
    insertRow: ({ ordered, line }) => (ordered ? `Insert ${line ? "line" : "row"} before` : `Add ${line ? "line" : "row"}`),
    insertRowTitle: ({ ordered, line }) => (ordered ? `Insert a ${line ? "line" : "row"} here` : `Add a ${line ? "line" : "row"} in key order`),
    insertGroup: ({ ordered, noun }) => (ordered ? `New ${noun}` : `Add ${noun}`),
    insertGroupTitle: ({ ordered, noun }) => (ordered ? `Start a new ${noun} at the nearest ${noun} boundary` : `Add a ${noun} in key order`),
    insertStrip: () => "Row insertion",
    insertAbove: () => "Insert above",
    insertBelow: ({ ordered }) => (ordered ? "Insert below" : "Add row"),
    insertNewGroup: ({ noun }) => `New ${noun}`,

    summary: ({ groups, n, lines, nLoose, loose, nSub, subRows }) =>
        `${groups} · ${lines} ${plural(n, "line", "lines")}${nLoose > 0 ? ` · ${loose} loose ${plural(nLoose, "row", "rows")}` : ""}${nSub > 0 ? ` · ${subRows} sub ${plural(nSub, "row", "rows")}` : ""}`,
    transport: ({ loaded, total }) => (total !== undefined ? `${loaded} loaded of ${total}` : `${loaded} loaded`),
    transportLoading: ({ line }) => `${line} · Loading…`,
    transportFailed: ({ reason }) => ` · could not be read — ${reason} `,
    hintProposal: () => "⏎ adds the selected row · ⌫ rejects it · esc deselects",
    hintBand: ({ noun }) => `⏎ renames the ${noun} · Space folds it · ⇧Space folds all · click its number to select its lines`,
    hintSubRows: ({ open, n, count, noun }) => `Space ${open ? "hides" : "shows"} its ${count} sub ${plural(n, "row", "rows")} · ⇧Space every line's in the ${noun} · ⏎ edit`,
    hintRows: ({ n, count }) => `${count} ${plural(n, "row", "rows")} selected · ⌫ deletes them · ⌘C copies`,
    hintFills: () => "⇥ walks the fills · ⌘⏎ fills the row · ⌘⇧⏎ takes everything · esc dismisses",
    hintSuggestedRows: () => "⏎ adds the next suggested row · click a row to select it · esc dismisses",
    hintDefault: () => "⏎ edit · esc cancel · click a row number to select it · ⌘C / ⌘V round-trips with Excel",

    stripAccepts: ({ header }) => `${header} · accepts`,
    stripHalf: ({ header, half }) => (half === undefined ? header : `${header} · ${half}`),
    stripPredicted: ({ header }) => `${header} · predicted`,
    stripArmed: ({ header, many }) => `${many ? "⌥] " : ""}${header}`,
    stripSuggested: () => "suggested",
    stripNoMatch: () => "no register match — kept as typed",
    stripDate: () => "a date",
    stripDateForm: () => "dd / mm / yyyy",
    stripIncomplete: () => "incomplete",
    stripNumber: ({ unit }) => (unit ? "number + unit" : "number"),
    stripUnrecognised: () => "unrecognised",
    stripValue: () => "a value",
    stripDays: ({ n, count }) => `${count} ${plural(Math.abs(n), "day", "days")}`,
    stripAdd: ({ label }) => `Add ${label}`,
    stripRows: ({ n, count }) => `+${count} ${plural(n, "row", "rows")}`,
    stripRowsHeader: () => "rows",
    stripPending: ({ header }) => `${header} ⋯`,
    stripPendingTitle: ({ header }) => `${header} — thinking`,
    stripKeysTyped: () => "⏎ commit as typed",
    stripKeysFilter: () => "type to filter · ⌥↓ to pick · click any",
    stripKeysTake: ({ many, index, total }) => `${many ? `${index} of ${total} · ` : ""}⇥ take`,
    stripKeysDateEmpty: () => "digits fill a segment · ↑↓ step it · ⇥ next",
    stripKeysDate: () => "digits fill a segment · ⇥ next",
    stripKeysCommit: () => "⏎ commit · esc cancel",
    stripKeysStep: () => "↑↓ step · ⏎ commit",
    stripKeysParse: () => "type to parse",
    stripKeysPredicted: () => "⇥ one · ⌘→ all · or type",
    stripKeysLinkTake: ({ many, index, total, single }) =>
        `${many ? `${index} of ${total} · ` : ""}⇥ take · , next${single ? "" : " · > hops to the To half"} · ⌘→ rest`,
    stripKeysLinkAdd: ({ single }) => `, adds${single ? "" : " · > hops to the To half"} · ⏎ done`,
    stripKeysSuggested: () => "⇥ walk · ⌘⏎ row · ⌘⇧⏎ all · esc",
    stripKeysDetail: ({ date }) => (date ? "⏎ edits the wanted date" : "⏎ edit"),
    stripPager: ({ count, page, pages }) => `${count} options · page ${page} of ${pages}`,
    stripPage: ({ page, pages }) => `${page}/${pages}`,
    stripPrevious: () => "Previous options",
    stripNext: () => "More options",

    editorNoOptions: () => "no options",
    editorTime: () => "Time",
    editorTimePlaceholder: () => "hh:mm",
    editorLocked: ({ half }) => `This ${half === "from" ? "source" : "destination"} is locked — anything here is kept but flagged`,
    editorBadge: ({ index, total }) => `${index}/${total}`,

    halfLabel: ({ half }) => half,
    halfTitle: ({ half }) => (half === "from" ? "From" : "To"),
    halfNone: ({ driver, half, lock }) => `${driver} has no ${half === "from" ? "source" : "destination"}${lock !== undefined ? ` · ${lock}` : ""}`,
    thisRow: () => "This row",
    countedMembers: ({ n, count, kind }) => (kind !== undefined ? `${count} ${n === 1 ? kind : pluralKind(kind)}` : count),
    unassigned: () => "unassigned",
    rangeSpan: ({ count, kind }) => `${count} ${kind !== undefined ? pluralKind(kind) : "members"}`,
    candidateRange: ({ count, kind, names }) => `→ ${count} ${pluralKind(kind)}: ${names}`,
    candidateEnumerate: ({ count }) => `enumerate · ${count} members`,
    candidateTbc: () => "to confirm",
    enumerateInstead: () => "name them now instead of leaving them to the scheduler",
    grammarCode: ({ kind }) => `${kind} code`,
    grammarCounted: () => "N x kind",
    grammarRange: () => "a range",
    arity: ({ count, key, named, state }) =>
        `${count} × ${key} implied · ${named} ${state === "short" ? "named so far" : state === "over" ? "named — more than the quantity needs" : "named"}`,
    notInRegister: ({ key }) => `${key} is not in the register`,

    whenTag: ({ level }) => (level === "week" ? "wk" : level),
    whenAccepts: ({ level }) => {
        switch (level) {
            case "week": return "a week — any day in it";
            case "day": return "a day";
            case "range": return "one end of the days it can run in";
            case "time": return "a day and a time";
        }
    },
    whenAcceptsForms: ({ level }) => {
        switch (level) {
            case "week": return "22/3 · fri · +7d · shown as its Monday";
            case "day": return "22/3 · fri · +3d";
            case "range": return "18/3 here, 22/3 at the other end";
            case "time": return "22/3 19:00 · fri 07:30";
        }
    },
    actualTag: ({ tone, count, unit }) => (tone === "on" ? "actual" : `${tone === "late" ? "+" : "−"}${count}${unit}`),
    actualWords: ({ tone, n, count, unit }) => (tone === "on" ? "on time"
        : `${count} ${unit === "d" ? plural(n, "day", "days") : plural(n, "hour", "hours")} ${tone}`),
    detailHappened: ({ when }) => `happened ${when}`,
    detailNoWanted: () => "no wanted date",
    detailHappenedTitle: ({ when }) => `Happened ${when} — no wanted date`,
    detailWanted: ({ text, tag }) => `wanted ${text} · ${tag}`,
    detailTitle: ({ when, text, tag, words }) => `Happened ${when} — wanted ${text} (${tag}) · ${words}`,

    rowRef: ({ line, number, title, noun }) => (line ? `line ${number} of ${title ?? `the ${noun}`}` : `row ${number}`),
    noticeGroupOpened: ({ noun }) => `Opened the ${noun}`,
    noticeGroupFolded: ({ noun }) => `Folded the ${noun} — Space or the chevron opens it`,
    noticeGroupsOpened: ({ groups }) => `Opened ${groups}`,
    noticeGroupsFolded: ({ groups }) => `Folded ${groups} — the corner, ⌥ on a chevron or ⇧Space opens them`,
    noticeSubRowsShownAll: ({ n, count, noun }) => `Showing the sub rows under ${count} ${plural(n, "line", "lines")} of the ${noun} — ⇧Space hides them`,
    noticeSubRowsHidAll: ({ noun }) => `Hid the sub rows under the ${noun}'s lines`,
    noticeSubRowsShown: ({ n, count }) => `Showing ${count} sub ${plural(n, "row", "rows")} under the line — Space hides them`,
    noticeSubRowsHid: () => "Hid the sub rows — Space shows them",
    noticeMembersAdded: ({ n, count }) => `Added ${count} ${plural(n, "member", "members")}`,
    noticeMembersRemoved: ({ n, count }) => `${count} ${plural(n, "member", "members")} removed`,
    noticePredictedTaken: ({ n, count }) => `Took ${count} predicted ${plural(n, "member", "members")}`,
    noticeLockedHalf: ({ driver }) => `${driver} has no destination — kept, but flagged`,
    noticeRowLeft: () => "The edited row left the sheet — its edit was not kept",
    noticeTabSaved: ({ name, query }) => (query
        ? `Saved tab "${name}" — a live view: rows that match join it as the sheet changes`
        : `Saved tab "${name}" — no filter; type a search and ⏎ to scope it`),
    noticeTabClosed: ({ name, active }) => (active ? `Closed "${name}" — back to the whole sheet` : `Closed "${name}"`),
    noticeTabUpdated: ({ name }) => `Tab "${name}" now saves this search`,
    noticeTabReverted: () => "Reverted to the tab's saved search",
    noticeFillTaken: ({ column, meta }) => `Took ${column} — ${meta ?? "suggested"}`,
    noticeRowFilled: ({ n, count, row }) => `Filled ${count} ${plural(n, "cell", "cells")} on ${row}`,
    noticeProposalTaken: ({ label, more }) => `Took ${label ?? "the suggested row"}${more ? " — next one suggested below" : ""}`,
    noticeProposalRejected: ({ to, from }) => `Rejected — ${to ?? "that row"} will not be suggested after ${from ?? "this"} again`,
    noticeFillDismissed: ({ column }) => `Dismissed — ${column} will not be suggested again on this row`,
    noticeProposalDeselected: () => "Deselected — esc again dismisses every suggestion",
    noticeRowFillDismissed: () => "Row fill dismissed — esc again for the suggested rows",
    noticeDeleted: ({ n, count, what, noun, nouns, again }) => {
        const deleted = what === "groups" ? `${count} ${plural(n, noun, nouns)}`
            : `${count} ${what === "lines" ? plural(n, "line", "lines") : plural(n, "row", "rows")}`;
        return `Deleted ${deleted}${again ? ` — ⌫ again removes the ${noun}` : ""}`;
    },
    noticePasted: ({ rows, cols, n, skipped }) => `Pasted ${rows}×${cols} from clipboard${n > 0 ? ` · ${skipped} unrecognised` : ""}`,
    noticeCopied: ({ rows, cols }) => `Copied ${rows}×${cols} to clipboard`,
    noticeDiscarded: () => "Discarded new row",
    noticeNewRow: () => "New row",
    noticeNewGroup: ({ noun }) => `New ${noun}`,
};

const SheetMessagesContext = createContext<SheetMessages>(sheetMessages);

/**
 * The message table in effect — {@link sheetMessages} with every
 * {@link SheetMessagesProvider} above overriding it.
 *
 * @returns The table
 */
export function useSheetMessages(): SheetMessages {
    return useContext(SheetMessagesContext);
}

/** Props of {@link SheetMessagesProvider}. */
export interface SheetMessagesProviderProps {
    /** The messages to override — any subset; the rest come from the table above. */
    messages: Partial<SheetMessages>;
    /** The subtree the overrides apply to. */
    children?: ReactNode;
}

/**
 * Override the Sheet's words for a subtree — a translation, or a house style.
 * Providers nest: each overrides the table the one above it resolved.
 *
 * @remarks
 * The overrides are read by identity: define them once (module scope, or a
 * memo), as below. A new object on every render hands every sheet beneath a
 * new table, and each re-derives all of its words.
 *
 * @param props - The overrides and the subtree
 * @returns The provider
 *
 * @example
 * ```tsx
 * const GERMAN: Partial<SheetMessages> = {
 *     tabAll: () => "Alle",
 *     scopeBadge: () => "nur geladene Zeilen",
 *     transport: ({ loaded, total }) => (total !== undefined ? `${loaded} von ${total} geladen` : `${loaded} geladen`),
 * };
 *
 * <I18nProvider locale="de-DE">
 *     <SheetMessagesProvider messages={GERMAN}>
 *         <EastChakraComponent value={sheet} />
 *     </SheetMessagesProvider>
 * </I18nProvider>
 * ```
 */
export function SheetMessagesProvider({ messages, children }: SheetMessagesProviderProps) {
    const parent = useSheetMessages();
    const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
    return createElement(SheetMessagesContext.Provider, { value }, children);
}
