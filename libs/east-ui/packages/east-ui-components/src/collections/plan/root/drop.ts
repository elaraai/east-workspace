/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas as a drag TARGET: library cards land on a row at an instant, and
 * the canvas's own runs, chips, tiles and marks move and resize on it (#825).
 * Rows register their own cells (`RowShell`); this registers the surface
 * those cells name and hands every completed drag to the editing session,
 * which drafts it into the entry its row came from (#880).
 *
 * A target is a named surface (cells are addressed `surface × row × slot`). A
 * Library's cards reach the canvas by the root's `id`, so a card lands only on
 * a canvas that declares one (the root's `id` is `none` otherwise, #824). The
 * canvas's own runs, chips, tiles and marks move with or without it (#825):
 * with no `id` the canvas names a surface of its own, which no card can reach.
 * Either way the editing session must be able to take the gesture — a drop
 * with nowhere to go is a gesture that silently loses work — or nothing
 * registers, so no row lights up and no drag can complete against a canvas
 * that cannot act on it. `canDrop` still vets every drop — at the pointer, and
 * once more before it is delivered — before it becomes a draft.
 *
 * @packageDocumentation
 */

import { useId, useMemo } from "react";
import { getSomeorUndefined } from "../../../utils.js";
import { useDragTarget, type DragEventValue } from "../../../dnd/drag-layer";
import { useIRCanDrop, type CanDropFn } from "../../../dnd/ir-can-drop";
import type { PlanRootValue } from "../model.js";
import type { PlanRowDrop } from "../rows/RowShell.js";

/**
 * Register the canvas as a drop target while its editing session takes a
 * gesture — named by its `id`, or by a surface of its own for its elements'
 * moves when it declares none.
 *
 * @param value - The latest root (its `id`, `canDrop`)
 * @param sources - The library ids accepted for `add` drags (data-stable)
 * @param onDrop - Where a completed drag goes — a card's drop, an element's move or resize (stable)
 * @param enabled - Whether the editing session takes a gesture now
 * @returns The per-row drop registration every droppable row shares, or
 *   `undefined` when the canvas is not a target
 */
export function usePlanDropTarget(
    value: PlanRootValue,
    sources: readonly string[],
    onDrop: (event: DragEventValue) => void,
    enabled: boolean,
): PlanRowDrop | undefined {
    const own = useId();
    const declared = enabled ? getSomeorUndefined(value.id) : undefined;
    const id = enabled ? declared ?? `plan-canvas${own}` : undefined;
    const canDropFn = useMemo(
        () => getSomeorUndefined(value.canDrop) as CanDropFn | undefined,
        [value.canDrop],
    );
    // The canvas's veto — the verdict-caching bridge every target shares, so
    // a drag resting over a bucket asks the predicate once, not per move.
    const veto = useIRCanDrop(canDropFn);
    const targetConfig = useMemo(() => (id !== undefined ? {
        id,
        // Cards reach a canvas by its declared id alone.
        sources: declared !== undefined ? [...sources] : [],
        // A card lands (`add`); the canvas's own elements move and resize on
        // it (#825) — each row says which it takes (`RowShell`'s `accepts`).
        kinds: { add: declared !== undefined, move: true, resize: true },
        onDrag: onDrop,
    } : null), [id, declared, sources, onDrop]);
    useDragTarget(targetConfig);
    // One registration shared by every droppable row — the per-row part of
    // the coordinate is the row itself, which `RowShell` already knows.
    return useMemo<PlanRowDrop | undefined>(
        () => (id !== undefined ? { surface: id, cards: declared !== undefined, canDrop: veto } : undefined),
        [id, declared, veto],
    );
}
