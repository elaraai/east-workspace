/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session (#879) — one transaction session for every editable
 * collection, over the `Editing` contract of `@elaraai/east-ui`: drafts, one
 * undoable transaction per gesture, and Apply as one checked, idempotent
 * batch. A collection projects its entries (`W`) and supplies its gestures;
 * the session, its React hook and its history bar are the same everywhere. A
 * builder whose entries live in several sources keeps a session per source
 * and one history over them (`EditHistory`, `useEditHistory`, #1194).
 *
 * @packageDocumentation
 */

export {
    EditSession,
    type EditSessionBinding,
    type EntryVersion,
    type EntryUpdate,
    type EditIssue,
    type Placement,
    type Origin,
} from "./session.js";
export { EditHistory, type EditHistoryPart } from "./history.js";
export {
    useEditHistory,
    type EditHistorySource,
    type EditHistoryPaged,
    type EditHistoryJoined,
    type EditHistoryState,
} from "./use-edit-history.js";
export { historyKeyOf } from "./kept.js";
export {
    liftDraft,
    normalizeDraft,
    presentDraft,
    CLEAN_DRAFT,
    type BatchReadiness,
    type DraftPresentation,
    type DraftToPresent,
} from "./draft.js";
export {
    useEditSession,
    type EditingValue,
    type EditSource,
    type EditSessionOptions,
} from "./use-edit-session.js";
export { HistoryBar, type HistoryAction, type HistoryBarProps } from "./HistoryBar.js";
export { historyToolbarItem, HISTORY_RANK } from "./history-item.js";
export { SessionBanners, type SessionBannersProps } from "./banners.js";
export { historyShortcut, typedInto, type HistoryKeyPress } from "./shortcuts.js";
export {
    editingMessages,
    DRAFT_ISSUE_TEXT,
    SESSION_TEXT,
    sessionErrorText,
    type EditingMessages,
    type EditingWords,
    type EditHistoryWord,
} from "./messages.js";
