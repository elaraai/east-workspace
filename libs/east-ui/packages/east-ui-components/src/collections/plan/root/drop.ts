/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas as a drag TARGET: library cards land on a row at an instant.
 * Rows register their own cells (`RowShell`); this registers the surface
 * those cells name and hands every completed drag to the editing session,
 * which drafts it into the entry its row came from (#880).
 *
 * A target needs an `id` (cells are addressed `surface × row × slot`, and an
 * unnamed surface cannot be addressed — the root's `id` is `none` then, #824)
 * and an editing session that can take the gesture: a drop with nowhere to
 * go is a gesture that silently loses work. Missing either ⇒ no registration
 * at all, so no row lights up and no drag can complete against a canvas that
 * cannot act on it. `canDrop` still vets every drop — at the pointer, and
 * once more before it is delivered — before it becomes a draft.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { getSomeorUndefined } from "../../../utils.js";
import { useDragTarget, type DragEventValue } from "../../../dnd/drag-layer";
import { type CanDropFn } from "../../../dnd/ir-can-drop";
import type { PlanRootValue } from "../model.js";
import type { PlanRowDrop } from "../rows/RowShell.js";

/**
 * Register the canvas as a drop target, when it declares one.
 *
 * @param value - The latest root (its `id`, `canDrop`)
 * @param sources - The library ids accepted for `add` drags (data-stable)
 * @param onDrop - Where a completed drop goes — the editing session's gesture (stable)
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
    const id = enabled ? getSomeorUndefined(value.id) : undefined;
    const canDropFn = useMemo(
        () => getSomeorUndefined(value.canDrop) as CanDropFn | undefined,
        [value.canDrop],
    );
    const targetConfig = useMemo(() => (id !== undefined ? {
        id,
        sources: [...sources],
        // `add` only. `move` / `resize` need a drag to START on the canvas — a
        // draggable run bar or chip — and nothing here begins one, so declaring
        // them would advertise a capability with no gesture behind it.
        kinds: { add: true },
        onDrag: onDrop,
    } : null), [id, sources, onDrop]);
    useDragTarget(targetConfig);
    // One registration shared by every droppable row — the per-row part of
    // the coordinate is the row itself, which `RowShell` already knows.
    return useMemo<PlanRowDrop | undefined>(
        () => (id !== undefined ? { surface: id, canDrop: canDropFn } : undefined),
        [id, canDropFn],
    );
}
