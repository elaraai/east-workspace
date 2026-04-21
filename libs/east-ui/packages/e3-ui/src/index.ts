/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/e3-ui — e3 + UI bridge (render-side, browser-safe).
 *
 * Provides:
 * - `Data.bind` — workspace-scoped dataset read/write/has from UI code
 * - `DataManifestType` — manifest type for reads/writes metadata
 *
 * The author-side `ui()` factory lives at `@elaraai/e3-ui/ui` because it
 * pulls in `@elaraai/e3` (which depends on Node-only modules like yazl).
 * Separating it keeps this entry tree-shakeable for browser bundles.
 *
 * @packageDocumentation
 */

export { Data } from './data.js';
export { DataManifestType, type DataManifest, encodeManifest, decodeManifest } from './manifest.js';
export { deriveManifest } from './derive.js';
