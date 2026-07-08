/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Maps a task's `state` / `status` and a milestone's `kind` East-variant
 * tags to the semantic colour token the SVG renderer resolves via
 * `useToken`. The tags are runtime data, so the colour can't live in a
 * recipe variant; these maps are the routing layer (tag → existing theme
 * token — never a raw hex).
 *
 * Since #262 a task carries the shared event lifecycle
 * (`PlannerStateType`) plus an orthogonal risk/status tint:
 * - `state` picks the **treatment** (solid committed, dashed proposals,
 *   ghosted model suggestions, struck removals/rejections) and the base
 *   colour.
 * - `status` (when present) overrides the **colour only** — the old
 *   `atRisk` red is `status: "danger"` — keeping the state's treatment,
 *   exactly like the Planner's per-event `tone` tint.
 */

import { match, type ValueTypeOf } from "@elaraai/east";
import type { Gantt } from "@elaraai/east-ui/internal";

/** The five lifecycle treatments a bar can wear (the Planner state grammar). */
export type GanttStateKey = "committed" | "proposedAdded" | "proposedModel" | "proposedRemoved" | "rejected";

/** Map a task's audit state to its treatment key. */
export function ganttStateKey(state: ValueTypeOf<typeof Gantt.Types.State>): GanttStateKey {
    return match(state, {
        committed: () => "committed" as GanttStateKey,
        rejected: () => "rejected" as GanttStateKey,
        proposed: (flavour) => match(flavour, {
            added: () => "proposedAdded" as GanttStateKey,
            model: () => "proposedModel" as GanttStateKey,
            removed: () => "proposedRemoved" as GanttStateKey,
        }, "proposedAdded" as GanttStateKey),
    }, "committed" as GanttStateKey);
}

/** Lifecycle treatment key → base semantic colour token (bar border + progress fill). */
export const GANTT_STATE_COLOR: Record<GanttStateKey, string> = {
    committed: "fg.success",
    proposedAdded: "fg.info",
    proposedModel: "fg.info",
    proposedRemoved: "fg.info",
    rejected: "fg.subtle",
};

/** Risk/status tag → semantic colour tint (overrides the state colour only). */
export const GANTT_STATUS_TINT: Record<string, string> = {
    success: "fg.success",
    warning: "fg.warning",
    danger: "fg.danger",
    info: "fg.info",
    neutral: "fg.subtle",
};

/** Per-treatment SVG stroke dash (undefined = solid). Dashed = drafts. */
export const GANTT_STATE_DASH: Record<GanttStateKey, string | undefined> = {
    committed: undefined,
    proposedAdded: "5 3",
    proposedModel: "3 3",
    proposedRemoved: "3 3",
    rejected: undefined,
};

/** Per-treatment bar opacity (model suggestions + removals/rejections ghost out). */
export const GANTT_STATE_OPACITY: Record<GanttStateKey, number> = {
    committed: 1,
    proposedAdded: 1,
    proposedModel: 0.75,
    proposedRemoved: 0.6,
    rejected: 0.55,
};

/** Treatments that draw the strike line across the bar (proposed deletions + rejections). */
export const GANTT_STATE_STRIKE: Record<GanttStateKey, boolean> = {
    committed: false,
    proposedAdded: false,
    proposedModel: false,
    proposedRemoved: true,
    rejected: true,
};

/** Milestone kind tag → semantic colour token (diamond fill + label). */
export const MILESTONE_KIND: Record<string, string> = {
    interim: "fg.warning",
    release: "fg.info",
};
