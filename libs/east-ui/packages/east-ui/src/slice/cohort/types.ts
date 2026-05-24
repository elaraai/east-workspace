/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { OptionType, StringType, BooleanType, StructType } from "@elaraai/east";
import { SliceBindType, SliceDensityType } from "../../platform/slice/index.js";

/**
 * `Slice.Cohort` data — a saved-segment pill bound to a slice.
 *
 * Cohorts and their applied state live in the slice (`state.cohorts` /
 * `state.activeCohorts`); the component renders one brand-tinted pill per cohort
 * (name · resolved count) plus a `+ cohort` pill. Clicking a pill opens the
 * `Slice.Edit` popover — the predicate editor (clause list + a builder driven by
 * `slice.fields()`) lives **entirely** in that overlay, never inline, so the
 * surface never re-flows. Editing commits via `slice.defineCohort` /
 * `slice.updateCohort`; `Remove cohort` drops it.
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
 *                             (for static snapshots).
 */
export const SliceCohortPickerType = StructType({
    slice:           SliceBindType,
    createdBy:       OptionType(StringType),
    lastEdited:      OptionType(StringType),
    reevaluateEvery: OptionType(StringType),
    density:         OptionType(SliceDensityType),
    editOpen:        OptionType(BooleanType),
});
export type SliceCohortPickerType = typeof SliceCohortPickerType;
