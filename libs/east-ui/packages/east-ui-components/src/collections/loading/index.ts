/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared loading parts (#1398) — one way to show a read in flight or
 * failed, in every builder: the unloaded run, the placeholder shapes and
 * card, the region wash, a failure said once in place, the reveal's one clock,
 * and their words. The footer's loading line is the builder frame's
 * (`layout/builder-frame/loading-line.tsx`); the retained treatment is the
 * `loading` recipe's parts (`retainedRow`, `retainedColumn`).
 *
 * @packageDocumentation
 */

export { REVEAL_DELAY_MS, REVEAL_HOLD_MS, REVEAL_IDLE, revealStep, useLoadingReveal, type RevealState, type RevealStep, type RevealTimings } from "./reveal.js";
export { barShare, runRows, runView, type RunGeometry, type RunGroup, type RunSlot, type RunView } from "./run-rows.js";
export {
    LoadingFailedBox, LoadingFailedLine, LoadingWash, PlaceholderCard, PlaceholderShape, placeholderAlign, useLoadingStyles,
    type LoadingFailedBoxProps, type LoadingFailedLineProps, type LoadingRetry, type LoadingWashProps, type PlaceholderCardProps,
    type PlaceholderKind, type PlaceholderShapeProps,
} from "./parts.js";
export { UnloadedRun, type RunCell, type RunFailure, type UnloadedRunProps } from "./unloaded-run.js";
export { loadingMessages, type LoadingMessages } from "./messages.js";
