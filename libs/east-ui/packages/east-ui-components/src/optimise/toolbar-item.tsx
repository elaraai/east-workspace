/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The eye as one item of a builder's toolbar (#1409, D4) — in the trailing
 * cluster, listed immediately before the history item, so it sits beside
 * Undo, Redo, Discard and Save in every fold of the ladder: the rail and the
 * segments fold first, the history item last, and the eye takes no step of
 * the ladder at all; on a phone it sits beside the history item (R27).
 *
 * The eye never leaves the toolbar (ruled 27 Oct 2026, "Into the View
 * menu"). Its item has one form, so it never folds of itself. A builder whose
 * View bundles the period's controls on a phone — the Roster's, the
 * Allocation's — gives it one step, a rung of the row's floor
 * ({@link OPTIMISE_RANK}): only where the whole ladder, and the rail's icon
 * dropping its caret, still leave the row too wide does the eye go into the
 * View, as its entry there (`OptimiseEntry`) — the eye's step and the View's
 * step that draws the entry sharing one bundle, so the two apply together.
 * The history and Save stay in the row — a frame a 294px parent holds, with a
 * rail beside them.
 *
 * @packageDocumentation
 */

import { FLOOR_RANK, type ToolbarItem } from "../toolbar/index.js";
import { OptimiseButton, type OptimiseButtonProps } from "./button.js";

/**
 * The rank of the eye's step into its builder's View: a rung of the row's
 * floor, after the rail's icon drops its caret (`FLOOR_RANK`), so the eye keeps
 * its place beside the history item in every fold of the ladder and goes into
 * the View only where nothing else lets the row fit. A builder whose View
 * takes the eye's entry (`OptimiseEntry`) gives the eye's item a second form,
 * none, and its View the step that draws the entry, both at this rank in one
 * bundle of the builder's — as the Roster's and the Allocation's do; a
 * builder with no such View gives the eye no step.
 */
export const OPTIMISE_RANK = FLOOR_RANK + 1;

/**
 * The eye's toolbar item: list it in a builder's toolbar immediately before
 * its history item. It has one form, the eye — a builder whose View takes the
 * eye's entry gives it its step into the View ({@link OPTIMISE_RANK}).
 *
 * @param props - The button's props ({@link OptimiseButtonProps})
 * @returns The item, keyed `optimise`, on the end side
 */
export function optimiseToolbarItem(props: OptimiseButtonProps): ToolbarItem {
    return {
        key: "optimise",
        side: "end",
        forms: [<OptimiseButton {...props} />],
        // Its one form's width moves with its size alone.
        version: props.size ?? "md",
    };
}
