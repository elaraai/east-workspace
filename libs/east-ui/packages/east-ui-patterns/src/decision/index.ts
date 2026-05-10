/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Decision.*` family — patterns about the user's decision.
 *
 * @remarks
 * Members:
 *  - `Decision.Brief` (Decide mode) — anchor; the structured-argument
 *    presentation of a model recommendation.
 *  - `Decision.Queue` (Observe mode, planned) — prioritised list of
 *    decisions awaiting action.
 *  - `Decision.Journal` (Frame & trust mode, planned) — the user's record
 *    of decisions in their own voice.
 *
 * @packageDocumentation
 */

import { Brief } from "./brief/component.js";

export * from "./brief/index.js";

/**
 * The Decision family namespace. Use `Decision.Brief.Root({ … })` to
 * construct a brief; `Decision.Brief.Component` is the renderer-registration
 * carrier.
 */
export const Decision = {
    Brief,
} as const;
