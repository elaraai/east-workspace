/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    BooleanType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import { SliceCohortPickerType } from "./types.js";

export { SliceCohortPickerType } from "./types.js";

/** Options for `Slice.Cohort`. */
export interface SliceCohortOptions {
    /** The bound slice (from `Slice.bind`). */
    slice: SubtypeExprOrValue<SliceBindType>;
    /** Author shown in the editor popover. */
    createdBy?: SubtypeExprOrValue<StringType>;
    /** Last-edited label shown in the editor popover. */
    lastEdited?: SubtypeExprOrValue<StringType>;
    /** Re-evaluation cadence (e.g. `"every 10 min"`). */
    reevaluateEvery?: SubtypeExprOrValue<StringType>;
    /** Render density — defaults to the surrounding `Slice.Frame`, else `focused`. */
    density?: "compact" | "focused";
    /** Render the editor popover open on mount (for static snapshots). */
    editOpen?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Creates a `Slice.Cohort` — saved-segment chips bound to a slice. Each cohort
 * in `state.cohorts` renders as a chip (active ones brand-tinted with a remove
 * `×`); clicking toggles it via `slice.toggleCohort(id)`. The focused cohort's
 * AND-ed predicate clauses render in a detail block with Edit / Apply / Remove
 * actions. Cohort sizes are host-computed and passed via `counts`.
 *
 * @param slice   - The bound slice (from `Slice.bind`)
 * @param options - Optional `counts` / detail meta / `builderOpen`
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
 *
 * const view = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const slice = $.let(Slice.bind([EventType], "demo.events", cfg, Slice.state({
 *             cohorts: [{
 *                 id: "power-users", name: "Power users",
 *                 filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })],
 *             }],
 *             activeCohorts: new Set(["power-users"]),
 *         })));
 *         return Slice.Cohort.Root({
 *             slice,
 *             reevaluateEvery: "every 10 min",
 *         });
 *     })),
 * );
 * ```
 */
function createSliceCohort(
    options: SliceCohortOptions,
): ExprType<UIComponentType> {
    return East.value(variant("SliceCohort", {
        slice:           options.slice,
        createdBy:       options.createdBy !== undefined ? some(options.createdBy) : none,
        lastEdited:      options.lastEdited !== undefined ? some(options.lastEdited) : none,
        reevaluateEvery: options.reevaluateEvery !== undefined ? some(options.reevaluateEvery) : none,
        density:         options.density !== undefined ? some(variant(options.density, null)) : none,
        editOpen:        options.editOpen !== undefined ? some(options.editOpen) : none,
    }), UIComponentType);
}

/** `Slice.Cohort` — saved-segment chips + focused-cohort predicate detail. */
export const SliceCohort = {
    Root: createSliceCohort,
    Types: {
        Cohort: SliceCohortPickerType,
    },
} as const;
