/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Maps a task's `status` / milestone's `kind` East-variant tag to the
 * semantic colour token the SVG renderer resolves via `useToken`. The
 * tags are runtime data, so the colour can't live in a recipe variant;
 * these maps are the routing layer (tag → existing theme token — never a
 * raw hex).
 */

/** Task schedule-status tag → semantic colour token (bar border + progress fill). */
export const GANTT_STATUS: Record<string, string> = {
    committed: "fg.success",
    proposed: "fg.info",
    atRisk: "fg.danger",
};

/** Milestone kind tag → semantic colour token (diamond fill + label). */
export const MILESTONE_KIND: Record<string, string> = {
    interim: "fg.warning",
    release: "fg.info",
};
