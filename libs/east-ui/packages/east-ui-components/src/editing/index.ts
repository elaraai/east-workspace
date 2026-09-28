/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session (#879) — one transaction session for every editable
 * collection, over the `Editing` contract of `@elaraai/east-ui`: drafts, one
 * undoable transaction per gesture, and Apply as one checked, idempotent
 * batch. A collection projects its entries (`W`) and supplies its gestures;
 * the session, its React hook and its history bar are the same everywhere.
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
export {
    editingMessages,
    DRAFT_ISSUE_TEXT,
    SESSION_TEXT,
    sessionErrorText,
    type EditingMessages,
    type EditingWords,
    type EditHistoryWord,
} from "./messages.js";
