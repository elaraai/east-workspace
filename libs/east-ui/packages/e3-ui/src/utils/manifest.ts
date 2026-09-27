/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Data manifest for UI tasks — declares which datasets a UI binds to via
 * `Data.bind()` / `Data.bindPaged()`, which named functions it calls via
 * `Func.bind()`, and which records it binds via `Record.bind()`. A UI task
 * carries it as its task object's `ui` role, so the type lives in e3-types
 * beside the task object and is re-exported here.
 *
 * @packageDocumentation
 */

export { DataManifestType, type DataManifest } from '@elaraai/e3-types';
