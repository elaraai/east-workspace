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
import { SliceCohortModeType, SliceCohortPickerType } from "./types.js";

export { SliceCohortModeType, SliceCohortPickerType } from "./types.js";

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
    /** Render density — defaults to the surrounding rail, else `focused`. */
    density?: "compact" | "focused";
    /** Render the editor popover open on mount (for static snapshots; `manage` mode only). */
    editOpen?: SubtypeExprOrValue<BooleanType>;
    /**
     * Interaction mode (#163): `toggle` = pure on/off preset bar (no
     * authoring affordances); `manage` (default) = toggling chips plus the
     * pencil / `+ cohort` authoring flow.
     */
    mode?: "toggle" | "manage";
    /** Show the `+ cohort` authoring pill. Defaults to true in `manage` mode, false in `toggle`. */
    allowCreate?: SubtypeExprOrValue<BooleanType>;
}

/** Options for `Slice.Presets` — `Slice.Cohort` pinned to `mode: "toggle"`. */
export type SlicePresetsOptions = Omit<SliceCohortOptions, "mode">;

/**
 * Creates a `Slice.Cohort` — developer-defined, toggleable segment chips bound
 * to a slice. Each cohort in `state.cohorts` renders as a chip (swatch · name ·
 * live count, active ones brand-tinted); the chip's **primary click toggles the
 * cohort on/off** via `slice.toggleCohort(id)`. In `manage` mode (the default)
 * a secondary pencil opens the editor popover (clauses + Apply / Remove) and a
 * `+ cohort` pill authors new ones; `mode: "toggle"` renders a pure preset bar
 * with no authoring affordances. Cohort sizes come from `slice.cohortCounts()`.
 *
 * @param options - The bound slice plus mode / authoring / detail-meta options
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
        mode:            options.mode !== undefined ? some(variant(options.mode, null)) : none,
        allowCreate:     options.allowCreate !== undefined ? some(options.allowCreate) : none,
    }), UIComponentType);
}

/**
 * Creates a `Slice.Presets` — a curated, read-only preset bar: `Slice.Cohort`
 * pinned to `mode: "toggle"`. Chips are pure on/off switches with live counts;
 * no authoring affordances render.
 *
 * @param options - The bound slice plus detail-meta options (mode is pinned)
 * @returns An East expression of type `UIComponentType`
 */
function createSlicePresets(
    options: SlicePresetsOptions,
): ExprType<UIComponentType> {
    return createSliceCohort({ ...options, mode: "toggle" });
}

/** `Slice.Cohort` — toggleable saved-segment chips + popover authoring. */
export const SliceCohort = {
    Root: createSliceCohort,
    Types: {
        Cohort: SliceCohortPickerType,
        Mode: SliceCohortModeType,
    },
} as const;

/** `Slice.Presets` — the curated toggle-only preset bar (`Slice.Cohort` with `mode: "toggle"`). */
export const SlicePresets = {
    Root: createSlicePresets,
    Types: {
        Cohort: SliceCohortPickerType,
        Mode: SliceCohortModeType,
    },
} as const;
