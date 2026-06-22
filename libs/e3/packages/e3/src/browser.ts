/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `@elaraai/e3/browser` — the browser-safe authoring core.
 *
 * Re-exports every e3 authoring builder + type that is free of Node-only
 * dependencies (no `node:fs` / `node:crypto` / `yazl`) — i.e. everything on the
 * main `@elaraai/e3` entry EXCEPT the file/zip IO (`e3.export` / `export_`,
 * `sha256File`, `sha256Bytes`, `hashToPath`, `addObject`) and the default `e3`
 * object (which references `export_`).
 *
 * This exists so UI libraries (e.g. `@elaraai/e3-ui`) can import the `task`
 * builder for `ui()` without dragging `node:fs` into a browser bundle (issue
 * #99). App authors keep using the main `@elaraai/e3` entry exactly as before —
 * this is an additive, internal entry, not a replacement.
 *
 * @packageDocumentation
 */

export type {
  DataTreeDef,
  DatasetDef,
  DatasetsOf,
  FunctionDef,
  MutationDef,
  RecordDef,
  TaskDef,
  PackageDef,
  PackageItem,
  MergeDatasets,
} from './types.js';

// Runner selection types + pure helpers (no Node IO).
export type {
  Runner,
  FunctionRunner,
  Platform,
  EastPyPlatform,
  EastNodePlatform,
  EastCPlatform,
} from './runner.js';
export { runnerToCommand, runnerToVariant, DEFAULT_RUNNER } from './runner.js';

// Authoring builders + their singleton trees — all browser-safe (they build
// in-memory East IR; only `export_`/`sha256` touch node:fs, and are omitted).
export { input, inputsTree } from './input.js';
export { record, recordsTree } from './record.js';
export { mutation } from './mutation.js';
export { task, customTask, tasksTree } from './task.js';
export { function_ } from './function.js';
export { package_ as package } from './package.js';
