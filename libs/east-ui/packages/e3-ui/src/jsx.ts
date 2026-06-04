/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * east-ui JSX tags, re-exported for e3 authoring.
 *
 * The tags (and the JSX runtime) live in `@elaraai/east-ui` so that east-ui's
 * own examples can be authored as `.tsx`. This module re-exports them so
 * `@elaraai/e3-ui/jsx` — and, via `ui.ts`, the single `@elaraai/e3-ui/ui`
 * import — keep working unchanged for e3 dashboards.
 *
 * @packageDocumentation
 */

export * from "@elaraai/east-ui/jsx";
