/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas as a drag TARGET: library cards land on a row at an instant.
 * Rows register their own cells (`RowShell`); this registers the surface
 * those cells name and funnels every completed drag to the controller, which
 * reports it to the host.
 *
 * A target needs BOTH an `id` (cells are addressed `surface × row × slot`, and
 * an unnamed surface cannot be addressed) and an `onDrag` (a drop with nowhere
 * to report is a gesture that silently loses work). Missing either ⇒ no
 * registration at all, so no row lights up and no drag can complete against a
 * canvas that cannot act on it.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { getSomeorUndefined } from "../../../utils.js";
import { useDragTarget } from "../../../dnd/drag-layer";
import { type CanDropFn } from "../../../dnd/ir-can-drop";
import type { PlanController } from "../controller/index.js";
import type { PlanRootValue } from "../model.js";
import type { PlanRowDrop } from "../rows/RowShell.js";

/**
 * Register the canvas as a drop target, when it declares one.
 *
 * @param value - The latest root (its `id`, `onDrag`, `canDrop`)
 * @param sources - The library ids accepted for `add` drags (data-stable)
 * @param controller - Where a completed drop is reported
 * @returns The per-row drop registration every droppable row shares, or
 *   `undefined` when the canvas is not a target
 */
export function usePlanDropTarget(
    value: PlanRootValue,
    sources: readonly string[],
    controller: PlanController,
): PlanRowDrop | undefined {
    const dropEligible = value.onDrag.type === "some" && value.id !== "";
    const canDropFn = useMemo(
        () => getSomeorUndefined(value.canDrop) as CanDropFn | undefined,
        [value.canDrop],
    );
    const targetConfig = useMemo(() => (dropEligible ? {
        id: value.id,
        sources: [...sources],
        // `add` only. `move` / `resize` need a drag to START on the canvas — a
        // draggable run bar or chip — and nothing here begins one, so declaring
        // them would advertise a capability with no gesture behind it.
        kinds: { add: true },
        onDrag: controller.drop,
    } : null), [dropEligible, value.id, sources, controller]);
    useDragTarget(targetConfig);
    // One registration shared by every droppable row — the per-row part of
    // the coordinate is the row itself, which `RowShell` already knows.
    return useMemo<PlanRowDrop | undefined>(
        () => (dropEligible ? { surface: value.id, canDrop: canDropFn } : undefined),
        [dropEligible, value.id, canDropFn],
    );
}
