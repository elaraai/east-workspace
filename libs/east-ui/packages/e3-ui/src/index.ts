/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/e3-ui — e3 + UI bridge.
 *
 * Provides:
 * - `Data.bind` — workspace-scoped dataset read/write/has from UI code
 * - `ui()` — first-class UI task (e3.task with kind: "ui")
 * - `DataManifestType` — manifest type for reads/writes metadata
 *
 * @packageDocumentation
 */

export { Data } from './data.js';
export { ui } from './ui.js';
export { DataManifestType, type DataManifest, encodeManifest, decodeManifest } from './manifest.js';
