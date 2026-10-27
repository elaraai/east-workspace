/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The eye as one item of a builder's toolbar (#1409, D4) — in the trailing
 * cluster, listed immediately before the history item, so it sits beside
 * Undo, Redo, Discard and Save in every fold of the ladder: the rail and the
 * segments fold first, the history item last, and the eye takes no step of
 * the ladder at all; on a phone it sits beside the history item (R27). Its one
 * step is a rung of the row's floor (`FLOOR_RANK`, hand retest, 27 Oct 2026):
 * only where the whole ladder, and the rail's icon dropping its caret, still
 * leave the row too wide does the eye leave it, so the history and Save stay
 * in the row — a frame a 294px parent holds, with a rail beside them.
 *
 * @packageDocumentation
 */

import { FLOOR_RANK, type ToolbarItem } from "../toolbar/index.js";
import { OptimiseButton, type OptimiseButtonProps } from "./button.js";

/**
 * The rank of the eye's one step, out of the row: a rung of its floor, after
 * the rail's icon drops its caret (`FLOOR_RANK`) — so it keeps its place beside
 * the history item in every fold of the ladder, and leaves the row only where
 * nothing else lets the row fit.
 */
export const OPTIMISE_RANK = FLOOR_RANK + 1;

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
        // The eye; and, at the row's floor alone, none.
        forms: [<OptimiseButton {...props} />, null],
        rank: OPTIMISE_RANK,
        // Its one form's width moves with its size alone.
        version: props.size ?? "md",
    };
}
