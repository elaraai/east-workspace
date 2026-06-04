/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * JSX runtime for e3-ui — a passthrough to the east-ui runtime, which owns the
 * JSX authoring surface (the runtime + tags live in `@elaraai/east-ui` so
 * east-ui's own examples can be authored as `.tsx`).
 *
 * Kept so `jsxImportSource: "@elaraai/e3-ui"` keeps resolving for existing e3
 * consumers; the semantics are identical to `@elaraai/east-ui/jsx-runtime`.
 *
 * @packageDocumentation
 */

export * from "@elaraai/east-ui/jsx-runtime";
