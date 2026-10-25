/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The eye as one item of a builder's toolbar (#1409, D4) — in the trailing
 * cluster, listed immediately before the history item, so it sits beside
 * Undo, Redo, Discard and Save in every fold: it has one form, so it never
 * folds, and its rank is the history item's, so the rail and the segments
 * fold first and these two last; on a phone it sits beside the history item.
 *
 * @packageDocumentation
 */

import { HISTORY_RANK } from "../editing/history-item.js";
import type { ToolbarItem } from "../toolbar/index.js";
import { OptimiseButton, type OptimiseButtonProps } from "./button.js";

/** The eye's rank: the history item's, so the two fold last — and the eye, of one form, not at all. */
export const OPTIMISE_RANK = HISTORY_RANK;

/**
 * The eye's toolbar item: list it in a builder's toolbar immediately before
 * its history item.
 *
 * @param props - The button's props ({@link OptimiseButtonProps})
 * @returns The item, keyed `optimise`, on the end side
 */
export function optimiseToolbarItem(props: OptimiseButtonProps): ToolbarItem {
    return {
        key: "optimise",
        side: "end",
        forms: [<OptimiseButton {...props} />],
        rank: OPTIMISE_RANK,
        // Its one form's width moves with its size alone.
        version: props.size ?? "md",
    };
}
