/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared rail-affordance resolution for every slice-chrome host (standalone
 * `Slice.Rail`, and the Table / Gantt / Library / Chart chrome). Keeps the
 * "auto-surface saved cohorts" rule in one place instead of the five hand-copied
 * ternaries it used to live in.
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";

/**
 * The affordance kinds a slice-chrome host mounts, given the author's configured
 * kinds and the live slice state.
 *
 * A `cohort` surface is appended when the slice carries saved cohorts and the
 * author didn't already mount one — but `presets` **is** the cohort surface
 * (`Slice.Cohort` pinned to toggle mode over the same `state.cohorts`), so
 * listing `presets` already counts and must not trigger a second, duplicate
 * `cohort` band (#319). Hosts still filter out the natively-rendered
 * `brush` / `legend` kinds at their own call site.
 *
 * @param configuredKinds - the affordance kinds the author listed, in order
 * @param state - the decoded slice state (read for `cohorts`)
 * @returns the kinds to mount, with an auto-appended `cohort` only when warranted
 */
export function railAffordanceKinds(
    configuredKinds: ReadonlyArray<string>,
    state: ValueTypeOf<typeof Slice.Types.State>,
): string[] {
    const hasCohortSurface = configuredKinds.some(k => k === "cohort" || k === "presets");
    return state.cohorts.length > 0 && !hasCohortSurface
        ? [...configuredKinds, "cohort"]
        : [...configuredKinds];
}
