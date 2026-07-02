/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { OptionType, StringType, BooleanType, StructType, NullType, VariantType } from "@elaraai/east";
import { SliceBindType, SliceDensityType } from "../../platform/slice/index.js";

/**
 * Interaction mode for `Slice.Cohort` (#163).
 *
 * @property toggle - Chips are pure on/off switches with counts — a curated
 *                    preset bar. No authoring: the `+ cohort` pill, the edit
 *                    pencil, and Remove are hidden.
 * @property manage - Chips still toggle on primary click, and authoring is
 *                    available via the secondary pencil + `+ cohort` pill
 *                    (today's editing flow). The default.
 */
export const SliceCohortModeType = VariantType({
    toggle: NullType,
    manage: NullType,
});
export type SliceCohortModeType = typeof SliceCohortModeType;

/**
 * `Slice.Cohort` data — developer-defined, toggleable segment pills bound to a
 * slice.
 *
 * Cohorts and their applied state live in the slice (`state.cohorts` /
 * `state.activeCohorts`); the component renders one pill per cohort (swatch ·
 * name · resolved count, active ones brand-tinted). The pill's **primary click
 * toggles the cohort on/off** via `slice.toggleCohort(id)`. In `manage` mode a
 * secondary pencil opens the `Slice.Edit` popover — the predicate editor
 * (clause list + a builder driven by `slice.fields()`) lives **entirely** in
 * that overlay, never inline, so the surface never re-flows. Editing commits
 * via `slice.defineCohort` / `slice.updateCohort`; `Remove cohort` drops it.
 *
 * @property slice           - Bound slice closure; reads `state.cohorts` /
 *                             `state.activeCohorts`, toggles via `toggleCohort`,
 *                             authors via `defineCohort` / `updateCohort`.
 * @property createdBy       - Optional author shown in the editor popover.
 * @property lastEdited      - Optional last-edited label shown in the editor popover.
 * @property reevaluateEvery - Optional re-evaluation cadence (e.g. `"every 10 min"`).
 * @property density         - `compact` (pill) or `focused` (pill — the editor is
 *                             always the popover). Defaults via the surrounding frame.
 * @property editOpen        - When true, the editor popover renders open on mount
 *                             (for static snapshots; `manage` mode only).
 * @property mode            - `toggle` = pure preset bar (no authoring); `manage`
 *                             (default) = toggling chips + pencil/`+ cohort` authoring.
 * @property allowCreate     - Show the `+ cohort` authoring pill. Defaults to
 *                             true in `manage` mode, false in `toggle` mode.
 */
export const SliceCohortPickerType = StructType({
    slice:           SliceBindType,
    createdBy:       OptionType(StringType),
    lastEdited:      OptionType(StringType),
    reevaluateEvery: OptionType(StringType),
    density:         OptionType(SliceDensityType),
    editOpen:        OptionType(BooleanType),
    mode:            OptionType(SliceCohortModeType),
    allowCreate:     OptionType(BooleanType),
});
export type SliceCohortPickerType = typeof SliceCohortPickerType;
