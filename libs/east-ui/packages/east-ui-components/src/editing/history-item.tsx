/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The history item (#988) — the editing session's history bar as one item of
 * the shared toolbar (#952), the same in every editable collection: the Sheet,
 * the Plan and the Layout take it from here rather than each building its own
 * mount.
 *
 * @packageDocumentation
 */
import { DEFAULT_RANK, type ToolbarItem } from "../toolbar/index.js";
import { HistoryBar, type HistoryBarProps } from "./HistoryBar.js";

/**
 * The rank of the history item's one fold step. It folds after every step a
 * collection's own items take: the status line and the issues button say what
 * an Apply did, so they stay while anything else can give way.
 */
export const HISTORY_RANK = DEFAULT_RANK;

/**
 * The history item: the bar at the end of a collection's toolbar, in two
 * forms, widest first — the status line, the issues button, then Undo, Redo,
 * Discard and Apply; then the buttons alone.
 *
 * @typeParam W - The collection's projection of an entry
 * @param props - The bar's props: the session, the collection's words, and its callbacks
 * @returns The item, keyed `history`, on the end side
 */
export function historyToolbarItem<W>(props: HistoryBarProps<W>): ToolbarItem {
    const { session } = props;
    const readiness = session.readiness;
    const issues = readiness.type === "ready" ? session.issues.length : readiness.value.length;
    return {
        key: "history",
        side: "end",
        forms: [<HistoryBar {...props} buttonsOnly={false} />, <HistoryBar {...props} buttonsOnly />],
        rank: HISTORY_RANK,
        // The full form's width moves with its status line, its issue count and its error.
        version: `${session.stale ? "stale" : session.status}|${issues}|${session.error ?? ""}`,
    };
}
