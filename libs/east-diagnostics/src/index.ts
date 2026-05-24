/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
export type * from "./types.js";
export * from "./rules/index.js";
export { runEastRules } from "./run.js";
export { createDiagnosticsService } from "./service.js";
export type { DiagnosticsService, DiagnosticsServiceOptions } from "./service.js";